// @gcu/lfm — Leapfrog Model File (.lfm) reader and writer.
// Single-file ESM, zero runtime deps. Browser-only (uses DOMParser,
// DecompressionStream/CompressionStream, crypto.subtle, TextEncoder/
// TextDecoder).
//
// Format: UTF-8 XML descriptor, then a 3-byte separator (0x0A 0x5C 0x30),
// then a binary section of concatenated little-endian zlib streams. The
// XML declares each stream's offset/size/numElements/datatype, plus a
// SHA-256 of the binary section. See SPEC-lfm-reader.md.
//
// SPDX-License-Identifier: BSD-3-Clause
// Reference: https://www.leapfrog3d.com/leapfrogmodelfile

/** XML namespace for every Leapfrog model file element. */
const LFM_NS = 'http://www.leapfrog3d.com/leapfrogmodelfile';

/** End-of-XML sentinel. The descriptor ends here; binary follows. */
const CLOSE_TAG = '</leapfrogModelFile>';

/** Thrown on any LFM-specific failure: malformed file, bad checksum,
 *  unsupported datatype/compression/endian, out-of-range indices, etc.
 *  Other thrown values (e.g. DecompressionStream errors) bubble up
 *  unwrapped, since they already carry meaningful messages. */
export class LFMError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LFMError';
  }
}

/** @typedef {Object} LFMColour - 8-bit RGB as stored in the file.
 *  @property {number} r 0..255
 *  @property {number} g 0..255
 *  @property {number} b 0..255 */

/** @typedef {Object} LFMMesh
 *  @property {string} name                Full mesh name from the file.
 *  @property {LFMColour} colour           File's stored RGB.
 *  @property {Object<string,string>} attributes  meshAttribute name→value
 *                                          map. Common keys: "Volume" (m³),
 *                                          "Area" (m²), "comments". Values
 *                                          are strings; numeric coercion is
 *                                          the consumer's job.
 *  @property {Float64Array} vertices      Flat XYZ, length = 3 * vCount.
 *                                          Coordinates are in the file's
 *                                          native CRS (typically UTM-like,
 *                                          metres). NOT recentred.
 *  @property {Int32Array} triangles       Flat IJK indices, length = 3 * tCount.
 *  @property {number} vCount              vertices.length / 3
 *  @property {number} tCount              triangles.length / 3 */

/** @typedef {Object} LFMResult
 *  @property {string} collectionName      <collectionOfMeshes><name>
 *  @property {string} version             <leapfrogModelFile version="…">
 *  @property {LFMMesh[]} meshes
 *  @property {Object} binary              Provenance for diagnostics.
 *  @property {number} binary.length       Declared binary section length.
 *  @property {string} binary.sha256       Hex digest from <binaryInfo>.
 *  @property {boolean} binary.checksumOk  Always true if readLFM resolved.
 *  @property {number} binary.xmlBytes     Length of the XML descriptor.
 *  @property {number} binary.fileBytes    Total file size. */

/** @typedef {Object} ReadOptions
 *  @property {(message: string) => void} [onProgress]  Coarse status string
 *           emitted at "verifying SHA-256" and per-mesh decode boundaries.
 *           Best-effort, not a stable enum. */

/**
 * Parse an LFM file. The whole file is decoded eagerly — for typical
 * geological deliverables (a few MB to a few hundred MB) this is fine.
 * Lazy per-mesh decoding can be added later without breaking the result
 * shape.
 *
 * @param {ArrayBuffer | Uint8Array} input
 * @param {ReadOptions} [options]
 * @returns {Promise<LFMResult>}
 */
export async function readLFM(input, options = {}) {
  const { onProgress, verify = true } = options;
  const layout = await readLFMLayout(input);
  const src = layout._src;

  if (verify) {
    onProgress?.('verifying SHA-256');
    const actualSha = await binarySha256(src, layout.binaryStart, layout.binaryLength, onProgress);
    if (actualSha !== layout.sha256) {
      throw new LFMError(
        `SHA-256 mismatch\n  expected ${layout.sha256}\n  got      ${actualSha}`);
    }
  }

  // ── walk meshes ───────────────────────────────────────────────────
  const meshes = [];
  for (let i = 0; i < layout.meshes.length; i++) {
    const lm = layout.meshes[i];
    const name = lm.name;
    onProgress?.(`decoding mesh ${i + 1}/${layout.meshes.length}`);

    const vertices  = await decodeBlock(src, layout.binaryStart, lm.verticesBlock, 'Float64Array', name);
    const triangles = await decodeBlock(src, layout.binaryStart, lm.trianglesBlock, 'Int32Array',   name);

    if (vertices.length  % 3 !== 0)
      throw new LFMError(`${name}: vertex scalar count ${vertices.length} not divisible by 3`);
    if (triangles.length % 3 !== 0)
      throw new LFMError(`${name}: triangle scalar count ${triangles.length} not divisible by 3`);

    const vCount = vertices.length / 3;
    const tCount = triangles.length / 3;
    let maxIdx = -1, minIdx = Infinity;
    for (let k = 0; k < triangles.length; k++) {
      if (triangles[k] > maxIdx) maxIdx = triangles[k];
      if (triangles[k] < minIdx) minIdx = triangles[k];
    }
    if (vCount > 0 && (maxIdx >= vCount || minIdx < 0)) {
      throw new LFMError(
        `${name}: triangle index out of range [${minIdx},${maxIdx}] vs ${vCount} vertices`);
    }

    meshes.push({ name, colour: lm.colour, attributes: lm.attributes, vertices, triangles, vCount, tCount });
  }

  return {
    collectionName: layout.collectionName,
    version: layout.version,
    meshes,
    binary: {
      length: layout.binaryLength,
      sha256: layout.sha256,
      checksumOk: !!verify,
      xmlBytes: layout.xmlBytes,
      fileBytes: src.size,
    },
  };
}

/**
 * readLFMLayout(input) — the descriptor WITHOUT decoding a single block: the
 * collection, each mesh's name / colour / attributes / counts and its vertex +
 * triangle block declarations ({ offset, size, numElements, datatype }, offsets
 * relative to `binaryStart`). A Blob/File is read in slices — the XML head, never
 * the binary section — so a multi-GB model costs nothing to describe, and a
 * streaming consumer can inflate one block at a time (lfmBlockStream).
 * @param {Blob | ArrayBuffer | Uint8Array} input
 */
export async function readLFMLayout(input) {
  const src = byteSource(input);
  // ── XML descriptor (headers are small: the close tag sits in the first 8 MB) ──
  const head = await src.read(0, Math.min(src.size, 8 * 1024 * 1024 + 64));
  const xmlEnd = findCloseTag(head);
  if (xmlEnd < 0) throw new LFMError('not an LFM file: no </leapfrogModelFile> tag');
  const xmlText = new TextDecoder('utf-8').decode(head.subarray(0, xmlEnd));
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = xml.querySelector('parsererror');
  if (perr) throw new LFMError('XML parse failure: ' + perr.textContent.split('\n')[0]);

  // ── binaryInfo ────────────────────────────────────────────────────
  const binfo = xml.getElementsByTagNameNS(LFM_NS, 'binaryInfo')[0];
  if (!binfo) throw new LFMError('missing <binaryInfo>');
  const endian      = binfo.getAttribute('endian');
  const compression = binfo.getAttribute('compression');
  const length      = parseInt(binfo.getAttribute('length'), 10);
  const expectedSha = binfo.getAttribute('sha256checksum');
  if (endian !== 'little')    throw new LFMError(`unsupported endian "${endian}"`);
  if (compression !== 'zlib') throw new LFMError(`unsupported compression "${compression}"`);
  if (!Number.isFinite(length)) throw new LFMError('missing/invalid binary length');

  // ── locate binary section ────────────────────────────────────────
  // Past XML close + 3-byte separator (0x0A 0x5C 0x30), the binary
  // section starts at the first zlib magic. Scanning is more robust
  // than trusting the separator's exact form.
  const after = await src.read(xmlEnd, 64);
  const rel = findZlibMagic(after, 0);
  if (rel < 0) throw new LFMError('no zlib stream after XML descriptor');
  const bs = xmlEnd + rel;
  if (bs + length > src.size) throw new LFMError('binary section truncated');

  const collection = xml.getElementsByTagNameNS(LFM_NS, 'collectionOfMeshes')[0];
  if (!collection) throw new LFMError('missing <collectionOfMeshes>');
  const collectionName =
    collection.getElementsByTagNameNS(LFM_NS, 'name')[0]?.textContent ?? '';
  const block = (decl, meshName) => {
    const b = {
      datatype: decl.getAttribute('datatype'),
      offset: parseInt(decl.getAttribute('offset'), 10),
      size: parseInt(decl.getAttribute('size'), 10),
      numElements: parseInt(decl.getAttribute('numElements'), 10),
      tag: decl.localName,
    };
    if (!Number.isFinite(b.offset) || !Number.isFinite(b.size) || !Number.isFinite(b.numElements)) {
      throw new LFMError(`${meshName}: malformed block declaration on <${decl.localName}>`);
    }
    return b;
  };
  const meshes = [];
  const ams = collection.getElementsByTagNameNS(LFM_NS, 'attributedMesh');
  for (let i = 0; i < ams.length; i++) {
    const am   = ams[i];
    const mesh = am.getElementsByTagNameNS(LFM_NS, 'mesh')[0];
    const name = mesh.getElementsByTagNameNS(LFM_NS, 'name')[0].textContent;
    const c = mesh.getElementsByTagNameNS(LFM_NS, 'colour')[0];
    const colour = {
      r: parseInt(c.getAttribute('red'),   10),
      g: parseInt(c.getAttribute('green'), 10),
      b: parseInt(c.getAttribute('blue'),  10),
    };
    const attributes = {};
    for (const ma of am.getElementsByTagNameNS(LFM_NS, 'meshAttribute')) {
      attributes[ma.getAttribute('name')] = ma.getAttribute('value');
    }
    const verticesBlock = block(mesh.getElementsByTagNameNS(LFM_NS, 'vertices')[0], name);
    const trianglesBlock = block(mesh.getElementsByTagNameNS(LFM_NS, 'triangles')[0], name);
    meshes.push({
      name, colour, attributes, verticesBlock, trianglesBlock,
      vCount: verticesBlock.numElements / 3, tCount: trianglesBlock.numElements / 3,
    });
  }
  const out = {
    collectionName, version: xml.documentElement.getAttribute('version') ?? '?',
    meshes, binaryStart: bs, binaryLength: length, sha256: expectedSha, xmlBytes: xmlEnd, fileBytes: src.size,
  };
  Object.defineProperty(out, '_src', { value: src });      // the byte source, for readLFM / lfmBlockStream
  return out;
}

/**
 * verifyLFM(input, layout, { onProgress }) — the binary section's SHA-256 against
 * the descriptor's, throwing LFMError on a mismatch. readLFM does this itself; a
 * streaming consumer (lfmBlockStream) calls it first. Incremental over slices for
 * a section too big to digest in one WebCrypto call.
 */
export async function verifyLFM(input, layout, { onProgress } = {}) {
  const actual = await binarySha256(layout._src || byteSource(input), layout.binaryStart, layout.binaryLength, onProgress);
  if (actual !== layout.sha256) throw new LFMError(`SHA-256 mismatch\n  expected ${layout.sha256}\n  got      ${actual}`);
  return true;
}

/**
 * lfmBlockStream(input, layout, block) → a ReadableStream of the block's
 * DECOMPRESSED bytes, inflated as they're read — a multi-hundred-MB triangle
 * block never exists whole. `block` is a layout mesh's verticesBlock or
 * trianglesBlock. Chunk boundaries are arbitrary (a value may straddle two).
 */
export function lfmBlockStream(input, layout, block) {
  const at = layout.binaryStart + block.offset;
  const raw = typeof Blob !== 'undefined' && input instanceof Blob
    ? input.slice(at, at + block.size)
    : new Blob([byteSource(input).bytes.subarray(at, at + block.size)]);
  return raw.stream().pipeThrough(new DecompressionStream('deflate'));
}

// A byte SOURCE: random access without holding the file. A Blob/File is read in
// slices (a multi-GB .lfm never becomes one ArrayBuffer); bytes are subarrayed.
function byteSource(input) {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { size: input.size, read: async (off, len) => new Uint8Array(await input.slice(off, off + len).arrayBuffer()) };
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return { size: bytes.length, bytes, read: async (off, len) => bytes.subarray(off, Math.min(bytes.length, off + len)) };
}

// The binary section's SHA-256. Whole-buffer WebCrypto when it can be one buffer
// (in memory already, or ≤ 256 MB); past that, the incremental SHA-256 below
// over 8 MB slices — WebCrypto has no incremental digest, and a single read of a
// multi-GB section is exactly what the browser refuses.
const WHOLE_DIGEST_MAX = 256 * 1024 * 1024;
async function binarySha256(src, start, length, onProgress) {
  if (src.bytes || length <= WHOLE_DIGEST_MAX) return sha256Hex(await src.read(start, length));
  const h = createSha256();
  const SLAB = 8 * 1024 * 1024;
  for (let at = 0; at < length; at += SLAB) {
    h.update(await src.read(start + at, Math.min(SLAB, length - at)));
    onProgress?.(`verifying SHA-256 ${Math.round(100 * Math.min(length, at + SLAB) / length)}%`);
  }
  return h.hex();
}

// Incremental SHA-256 (FIPS 180-4), for sections too big to digest in one call.
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function createSha256() {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const buf = new Uint8Array(64);
  let bufLen = 0, total = 0;
  const block = (b, o) => {
    for (let i = 0; i < 16; i++) W[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15], w2 = W[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b2 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b2) ^ (a & c) ^ (b2 & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b2; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  };
  return {
    update(data) {
      let i = 0;
      total += data.length;
      if (bufLen) {
        while (bufLen < 64 && i < data.length) buf[bufLen++] = data[i++];
        if (bufLen === 64) { block(buf, 0); bufLen = 0; }
      }
      for (; i + 64 <= data.length; i += 64) block(data, i);
      while (i < data.length) buf[bufLen++] = data[i++];
      return this;
    },
    hex() {
      const bits = total * 8;
      const pad = new Uint8Array(((bufLen < 56 ? 56 : 120) - bufLen) + 8);
      pad[0] = 0x80;
      const hi = Math.floor(bits / 2 ** 32), lo = bits >>> 0;
      const n = pad.length;
      pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
      pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
      total -= pad.length;                                   // padding isn't message length
      this.update(pad);
      return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

function findCloseTag(bytes) {
  const tag = new TextEncoder().encode(CLOSE_TAG);
  const limit = Math.min(bytes.length, 8 * 1024 * 1024); // headers should be small
  outer: for (let i = 0; i <= limit - tag.length; i++) {
    for (let j = 0; j < tag.length; j++) {
      if (bytes[i + j] !== tag[j]) continue outer;
    }
    return i + tag.length;
  }
  return -1;
}

function findZlibMagic(bytes, from) {
  // Leapfrog emits zlib default-compression: 0x78 0x9C. A strict scan
  // is safe in practice; if other CMF/FLG combinations ever appear,
  // tighten to "0x78 followed by a byte that makes a valid CMF check".
  for (let i = from; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x78 && bytes[i + 1] === 0x9c) return i;
  }
  return -1;
}

async function inflate(compressedBytes) {
  // WHATWG "deflate" = RFC 1950 zlib (with header). Despite the name,
  // this is exactly what LFM uses; "deflate-raw" is RFC 1951.
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function sha256Hex(bytes) {
  // SubtleCrypto wants a contiguous buffer; non-zero-offset views must
  // be copied before hashing.
  const slice = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  const hash = await crypto.subtle.digest('SHA-256', slice);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function decodeBlock(src, binaryStart, blk, typeName, meshName) {
  const { datatype, offset, size, numElements: numEl } = blk;
  if (datatype !== '3float64' && datatype !== '3int32') {
    throw new LFMError(`${meshName}: unsupported datatype "${datatype}"`);
  }
  const expectedScalarBytes = typeName === 'Float64Array' ? 8 : 4;

  const compressed   = await src.read(binaryStart + offset, size);
  const decompressed = await inflate(compressed);
  if (decompressed.length !== numEl * expectedScalarBytes) {
    throw new LFMError(
      `${meshName}: <${blk.tag}> decompressed to ${decompressed.length}B, ` +
      `expected ${numEl * expectedScalarBytes}B (${numEl} × ${expectedScalarBytes})`);
  }

  // Response.arrayBuffer() returns a fresh, byteOffset=0 ArrayBuffer,
  // so the typed-array view is alignment-safe with no copy.
  return typeName === 'Float64Array'
    ? new Float64Array(decompressed.buffer)
    : new Int32Array(decompressed.buffer);
}

// ════════════════════════════════════════════════════════════════════
// Writer
// ════════════════════════════════════════════════════════════════════

/** @typedef {Object} LFMMeshInput
 *  @property {string} name
 *  @property {LFMColour} [colour]                  Defaults to mid-grey.
 *  @property {Object<string,string|number>} [attributes]  Numeric values
 *           are coerced to string. Pass-through; no synthesis of Volume/Area.
 *  @property {Float64Array | Float32Array | number[]} vertices
 *           Flat XYZ. Float32 / regular arrays are promoted to Float64
 *           (the format only stores 3float64). Passing Float32 means you
 *           already paid the precision cost — the writer doesn't add any.
 *  @property {Int32Array | Uint32Array | number[]} triangles
 *           Flat IJK indices. Uint32 / regular arrays are converted to Int32. */

/** @typedef {Object} WriteInput
 *  @property {string} [collectionName]
 *  @property {LFMMeshInput[]} meshes
 *  @property {string} [version]                    Defaults to "1.0". */

/** @typedef {Object} WriteOptions
 *  @property {(message: string) => void} [onProgress] */

/**
 * Build an LFM file from a (collection name, meshes) input. Returns an
 * ArrayBuffer the caller can save as `.lfm` directly. The output passes
 * the same validation `readLFM` runs (SHA-256 verification, length and
 * index checks).
 *
 * Compression is whatever `CompressionStream("deflate")` decides —
 * typically default zlib level. Round-trips are NOT byte-identical with
 * Leapfrog's own output (different compressor, different SHA-256), but
 * are semantically identical: same vertices, triangles, colours, and
 * attributes.
 *
 * Endianness assumption: the host runs little-endian (every modern
 * consumer machine does). On a big-endian host this would emit
 * byte-swapped vertex/triangle data; if that ever matters, switch the
 * raw-byte builds below to DataView writes.
 *
 * @param {WriteInput} input
 * @param {WriteOptions} [options]
 * @returns {Promise<ArrayBuffer>}
 */
export async function writeLFM(input, options = {}) {
  const { onProgress } = options;
  const { collectionName = '', meshes = [], version = '1.0' } = input;

  // ── 1. Normalise + validate every mesh, compress its blocks ──────
  // Each mesh contributes two blocks in order: vertices, then triangles.
  // We capture the compressed bytes plus numElements (scalar count) so we
  // can fill in the XML offsets/sizes after concatenation.
  const blocks = [];                         // {compressed, numElements, kind}
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (!m || typeof m.name !== 'string') {
      throw new LFMError(`mesh #${i}: missing or invalid name`);
    }
    onProgress?.(`compressing mesh ${i + 1}/${meshes.length}`);

    const verts = ensureFloat64(m.vertices, `${m.name}.vertices`);
    const tris  = ensureInt32(m.triangles,  `${m.name}.triangles`);
    if (verts.length % 3 !== 0)
      throw new LFMError(`${m.name}: vertices length ${verts.length} not divisible by 3`);
    if (tris.length % 3 !== 0)
      throw new LFMError(`${m.name}: triangles length ${tris.length} not divisible by 3`);

    const vCount = verts.length / 3;
    if (vCount > 0) {
      let maxIdx = -1, minIdx = Infinity;
      for (let k = 0; k < tris.length; k++) {
        if (tris[k] > maxIdx) maxIdx = tris[k];
        if (tris[k] < minIdx) minIdx = tris[k];
      }
      if (tris.length > 0 && (maxIdx >= vCount || minIdx < 0)) {
        throw new LFMError(
          `${m.name}: triangle index out of range [${minIdx},${maxIdx}] vs ${vCount} vertices`);
      }
    }

    blocks.push({
      kind: 'vertices',
      numElements: verts.length,
      compressed: await deflate(asBytes(verts)),
    });
    blocks.push({
      kind: 'triangles',
      numElements: tris.length,
      compressed: await deflate(asBytes(tris)),
    });
  }

  // ── 2. Compute offsets, concat the binary section ────────────────
  let cursor = 0;
  for (const b of blocks) { b.offset = cursor; cursor += b.compressed.length; }
  const binaryLength = cursor;
  const binary = new Uint8Array(binaryLength);
  for (const b of blocks) binary.set(b.compressed, b.offset);

  // ── 3. SHA-256 of the binary section ─────────────────────────────
  onProgress?.('computing SHA-256');
  const sha = await sha256Hex(binary);

  // ── 4. Build XML descriptor with all attributes filled in ────────
  const xml = buildXml({ collectionName, meshes, blocks, binaryLength, sha, version });
  const xmlBytes = new TextEncoder().encode(xml);

  // ── 5. Concatenate XML + 3-byte separator + binary section ───────
  const sep = new Uint8Array([0x0A, 0x5C, 0x30]);
  const out = new Uint8Array(xmlBytes.length + sep.length + binary.length);
  out.set(xmlBytes, 0);
  out.set(sep, xmlBytes.length);
  out.set(binary, xmlBytes.length + sep.length);

  // Detach so the caller owns a clean ArrayBuffer (typed-array .buffer
  // can be larger than the view; here they're identical, but explicit is
  // less surprising).
  return out.buffer;
}

// ────────────────────────────────────────────────────────────────────
// Writer internals
// ────────────────────────────────────────────────────────────────────

function ensureFloat64(arr, label) {
  if (arr == null) throw new LFMError(`${label}: missing`);
  if (arr instanceof Float64Array) return arr;
  // Float32Array, Array, Uint8Array (raw bytes — unlikely but harmless),
  // anything iterable of numbers. Float64Array constructor accepts all.
  return new Float64Array(arr);
}

function ensureInt32(arr, label) {
  if (arr == null) throw new LFMError(`${label}: missing`);
  if (arr instanceof Int32Array) return arr;
  return new Int32Array(arr);
}

function asBytes(typedArr) {
  // Aliased view over the same memory — no copy. CompressionStream
  // tolerates non-zero byteOffsets.
  return new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength);
}

async function deflate(data) {
  // Symmetric with inflate(): WHATWG "deflate" = RFC 1950 zlib (header
  // + Adler-32). Output starts with 0x78 0x9C-ish CMF/FLG, which the
  // reader's findZlibMagic finds.
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data]).stream().pipeThrough(cs);
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

function buildXml({ collectionName, meshes, blocks, binaryLength, sha, version }) {
  const out = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<leapfrogModelFile version="${escAttr(version)}"` +
    ` xmlns="${LFM_NS}"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xsi:schemaLocation="${LFM_NS} http://www.leapfrog3d.com/xml_schemas/leapfrogmodelfile.xsd">`
  );
  out.push(`  <leapfrogObject>`);
  out.push(`    <collectionOfMeshes>`);
  out.push(`      <name>${escText(collectionName)}</name>`);

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const vBlock = blocks[i * 2];
    const tBlock = blocks[i * 2 + 1];
    const c = m.colour ?? { r: 128, g: 128, b: 128 };

    out.push(`      <attributedMesh>`);
    out.push(`        <mesh>`);
    out.push(`          <name>${escText(m.name)}</name>`);
    out.push(
      `          <vertices datatype="3float64"` +
      ` offset="${vBlock.offset}"` +
      ` size="${vBlock.compressed.length}"` +
      ` numElements="${vBlock.numElements}"/>`
    );
    out.push(
      `          <triangles datatype="3int32"` +
      ` offset="${tBlock.offset}"` +
      ` size="${tBlock.compressed.length}"` +
      ` numElements="${tBlock.numElements}"/>`
    );
    out.push(
      `          <colour red="${c.r | 0}" green="${c.g | 0}" blue="${c.b | 0}"/>`
    );
    out.push(`        </mesh>`);

    const attrs = m.attributes ?? {};
    for (const [name, value] of Object.entries(attrs)) {
      out.push(
        `        <meshAttribute name="${escAttr(name)}" value="${escAttr(value)}"/>`
      );
    }
    out.push(`      </attributedMesh>`);
  }

  out.push(`    </collectionOfMeshes>`);
  out.push(`  </leapfrogObject>`);
  out.push(
    `  <binaryInfo endian="little" compression="zlib"` +
    ` length="${binaryLength}"` +
    ` sha256checksum="${sha}"/>`
  );
  out.push(`</leapfrogModelFile>`);
  return out.join('\n');
}

function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}
function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
