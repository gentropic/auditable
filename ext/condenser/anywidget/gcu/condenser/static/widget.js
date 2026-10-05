// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/widget.js

// ── ../index.js ──

// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/condenser — Streaming no-preprocess renderer for massive spatial elements (point clouds, block models): stream-parse → quantize → chunk → prefix-LOD → progressive accumulation → EDL. The engine under micro.

// ── src/io/las.js ──

// @gcu/condenser — LAS provider (uncompressed point record formats 0–3 and 6–8).
// Header-driven: the public header block gives bbox, count, format, and scale/offset
// up front — no discovery pass. streamChunks() parses chunk-at-a-time from a
// ReadableStream, never holding raw file bytes beyond the current chunk (+ a
// partial-record carry). Positions come out as WORLD f64 (scale·raw + offset);
// frame-local quantization happens downstream in chunks.js — providers know
// formats, condenser knows rendering, nothing else crosses the seam.
//
// Provider contract (micro-spec §2.4):
//   openLas(blob) → { header, streamChunks(opts): AsyncIterable<RawChunk> }
//   RawChunk = { count, x, y, z: Float64Array, intensity: Uint16Array,
//                classification: Uint8Array, rgb: Uint8Array(3N) | null,
//                recStart: number }   — recStart = record index of element 0.

const RECLEN = { 0: 20, 1: 28, 2: 26, 3: 34, 6: 30, 7: 36, 8: 38 };
const RGB_OFF = { 2: 20, 3: 28, 7: 30, 8: 30 };

class LasFormatError extends Error {
  constructor(msg) { super(msg); this.name = 'LasFormatError'; }
}

// Parse the public header block from the file's first bytes (≥ 375 recommended).
function parseLasHeader(bytes) {
  const dv = bytes instanceof DataView ? bytes : new DataView(bytes.buffer ? bytes.buffer : bytes, bytes.byteOffset || 0, bytes.byteLength);
  if (dv.byteLength < 227) throw new LasFormatError('file too small for a LAS header');
  if (dv.getUint8(0) !== 0x4C || dv.getUint8(1) !== 0x41 || dv.getUint8(2) !== 0x53 || dv.getUint8(3) !== 0x46) {
    throw new LasFormatError('not a LAS file (no LASF signature)');
  }
  const verMajor = dv.getUint8(24), verMinor = dv.getUint8(25);
  const headerSize = dv.getUint16(94, true);
  const pointOffset = dv.getUint32(96, true);
  const fmtByte = dv.getUint8(104);
  if (fmtByte & 0x80) throw new LasFormatError('LAZ (compressed) — not supported; export uncompressed LAS');
  const format = fmtByte & 0x3f;
  if (!(format in RECLEN)) throw new LasFormatError(`unsupported point record format ${format} (supported: 0–3, 6–8)`);
  const recordLen = dv.getUint16(105, true);
  if (recordLen < RECLEN[format]) throw new LasFormatError(`record length ${recordLen} < format ${format} minimum ${RECLEN[format]}`);
  const legacyCount = dv.getUint32(107, true);
  let count = legacyCount;
  if (verMinor >= 4 && headerSize >= 255 && dv.byteLength >= 255) {
    const c64 = dv.getBigUint64(247, true);
    if (c64 > 0n) count = Number(c64);                    // 1.4 files may zero the legacy field
  }
  const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
  const offset = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
  // bbox stored max/min interleaved per axis
  const bbox = {
    min: [dv.getFloat64(187, true), dv.getFloat64(203, true), dv.getFloat64(219, true)],
    max: [dv.getFloat64(179, true), dv.getFloat64(195, true), dv.getFloat64(211, true)],
  };
  return {
    kind: 'las', version: `${verMajor}.${verMinor}`, format, recordLen,
    count, pointOffset, scale, offset, bbox,
    hasRgb: format in RGB_OFF,
    attributes: ['intensity', 'classification', ...(format in RGB_OFF ? ['rgb'] : [])],
  };
}

// Decode `n` fixed-size records from dv starting at byte 0 into columnar arrays.
// RGB: LAS stores u16 per channel, but many files carry 8-bit values in the low
// byte. Decode as u16, decide once per chunk (any channel > 255 → 16-bit → >>8),
// or accept a `forceRgb16` override (sticky across chunks — see streamChunks).
function decodeLasRecords(dv, header, n, recStart, { forceRgb16 = false } = {}) {
  const { format, recordLen, scale, offset } = header;
  const clsOff = format >= 6 ? 16 : 15;
  const rgbOff = RGB_OFF[format];
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const intensity = new Uint16Array(n), classification = new Uint8Array(n);
  const rgb16 = rgbOff != null ? new Uint16Array(3 * n) : null;
  for (let i = 0; i < n; i++) {
    const o = i * recordLen;
    x[i] = dv.getInt32(o, true) * scale[0] + offset[0];
    y[i] = dv.getInt32(o + 4, true) * scale[1] + offset[1];
    z[i] = dv.getInt32(o + 8, true) * scale[2] + offset[2];
    intensity[i] = dv.getUint16(o + 12, true);
    classification[i] = dv.getUint8(o + clsOff);
    if (rgb16) {
      rgb16[i * 3] = dv.getUint16(o + rgbOff, true);
      rgb16[i * 3 + 1] = dv.getUint16(o + rgbOff + 2, true);
      rgb16[i * 3 + 2] = dv.getUint16(o + rgbOff + 4, true);
    }
  }
  let rgb = null, rgbIs16 = forceRgb16;
  if (rgb16) {
    if (!rgbIs16) { for (let k = 0; k < rgb16.length; k++) if (rgb16[k] > 255) { rgbIs16 = true; break; } }
    rgb = new Uint8Array(3 * n);
    if (rgbIs16) for (let k = 0; k < rgb16.length; k++) rgb[k] = rgb16[k] >> 8;
    else rgb.set(rgb16);                                   // values ≤255 fit as-is
  }
  return { count: n, x, y, z, intensity, classification, rgb, recStart, rgbIs16 };
}

/**
 * Open a LAS Blob/File. Reads the header up front (one small slice), then
 * streamChunks() yields RawChunks of ≤ chunkPoints records, parsing from a
 * fresh ReadableStream (a cold re-runnable recipe — call it again for a second
 * sweep). Carries partial records across stream chunk boundaries.
 */
async function openLas(blob, { headerBytes = 512 } = {}) {
  const head = new DataView(await blob.slice(0, Math.min(headerBytes, blob.size)).arrayBuffer());
  const header = parseLasHeader(head);
  const recordLen = header.recordLen;

  async function* streamChunks({ chunkPoints = 1 << 20, signal } = {}) {
    const stream = blob.slice(header.pointOffset).stream();
    const reader = stream.getReader();
    let carry = new Uint8Array(0);
    let recDone = 0;
    let rgb16 = false;                                     // sticky: once 16-bit color is seen, stay >>8
    try {
      while (recDone < header.count) {
        const { done, value } = await reader.read();
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (done) break;
        let buf = value;
        if (carry.length) {                                // stitch the partial record from last read
          const joined = new Uint8Array(carry.length + value.length);
          joined.set(carry, 0); joined.set(value, carry.length);
          buf = joined; carry = new Uint8Array(0);
        }
        let avail = Math.floor(buf.length / recordLen);
        if (avail * recordLen < buf.length) carry = buf.slice(avail * recordLen);
        avail = Math.min(avail, header.count - recDone);
        let off = 0;
        while (avail > 0) {
          const n = Math.min(avail, chunkPoints);
          const dv = new DataView(buf.buffer, buf.byteOffset + off, n * recordLen);
          const chunk = decodeLasRecords(dv, header, n, recDone, { forceRgb16: rgb16 });
          if (chunk.rgbIs16) rgb16 = true;                 // sticky: once 16-bit color is seen, stay >>8
          yield chunk;
          recDone += n; off += n * recordLen; avail -= n;
        }
      }
    } finally {
      reader.releaseLock();
      try { await stream.cancel(); } catch { /* already done */ }
    }
  }

  return { header, streamChunks };
}

// ── ../frame/src/frame.js ──

// @gcu/frame — the coordinate-frame contract for the whole GCU geometry stack.
//
// Geological work lives at projected-coordinate magnitudes (UTM easting ~5e5,
// northing ~7.7e6, RL ~1e3). Two failures follow and share one cause — doing math
// and rendering directly in those large numbers:
//   • the float32 wall — at northing 7.7e6 a 32-bit float resolves to ~1 m, so any
//     GPU/Float32Array path jitters and z-fights;
//   • catastrophic cancellation — derived quantities (lengths, cross products,
//     intersection params) lose relative precision, and a fixed ε like 1e-9 is
//     meaningless against operands of magnitude 1e6.
// The fix is to work in a small-magnitude LOCAL frame and keep the offset to WORLD
// as explicit, inspectable metadata. This module is that contract — a tiny value
// type plus pure functions, zero-dependency, that every coordinate-bearing package
// can speak.
//
// A Frame has two faculties with different reach:
//   1. numerical framing — the world↔local offset (`origin`), for the precision path
//      (dee/voxmesh/groma/regula/dxf/moncad compute in it; it gates every F32 downcast);
//   2. coordinate identity — the `crs` descriptor + `units`, universal provenance so
//      "what do these world numbers mean" is never silent.
//
// HARD BOUNDARY: frame NAMES a CRS, it never CHANGES one. Reprojection (datum shifts,
// projection changes) is a geodetic operation that lives elsewhere (spinifex/proj4
// today, a future @gcu/proj if it ever becomes a stack primitive). Crossing CRS here
// throws — see `delta`. A working offset is a translation for numerical convenience,
// not a reprojection.
//
// Points and origins are ARRAYS — [x, y] or [x, y, z] — matching the rest of the tree
// (dee.origin, grid.origin, flat Float64/Float32 vertex buffers), not the {x,y,z}
// objects the prose spec sketches. The frame is pure translation: rotation/scale are
// deliberately out of scope (a block model's own dip/rake orientation is intrinsic
// model geometry, a separate concern from the local frame — never conflated).

// A Frame value. `origin` is the WORLD coordinate of the local origin, so
// `local = world − origin`. `crs` is an optional projection descriptor (e.g. an EPSG
// code) — null means "unstated", which opts out of cross-frame CRS checking. `units`
// defaults to metres.
function makeFrame({ origin, crs = null, units = 'm' } = {}) {
  const o = origin ? Array.from(origin, Number) : [0, 0, 0];
  while (o.length < 3) o.push(0);
  return { origin: o.slice(0, 3), crs, units };
}

// The identity frame: origin at world zero. World == local. Useful as a default and
// as the "already in world coordinates" marker.
const WORLD = makeFrame({ origin: [0, 0, 0] });

// Normalise a CRS code for IDENTITY comparison: uppercase + strip a leading `EPSG:`, so
// `'EPSG:31983'`, `'epsg:31983'`, and `'31983'` all compare equal. It lives HERE, not in a
// geo/reprojection layer: frame is zero-dep and sits *under* any such layer, so importing a
// helper from geo would invert the dependency. A reprojection layer's richer code resolution
// is a superset built on this. Comparison only — the stored `crs` keeps its original spelling.
function canonCrs(code) {
  return code == null ? null : String(code).trim().toUpperCase().replace(/^EPSG:/, '');
}

// Two frames describe the same projection iff their (canonicalised) CRS agree (a null CRS on
// either side is a wildcard — you can't assert a mismatch you never declared) and their units
// match. This is the gate that keeps a frame shift from masquerading as a reprojection.
function sameProjection(a, b) {
  const ca = canonCrs(a.crs), cb = canonCrs(b.crs);
  if (ca != null && cb != null && ca !== cb) return false;
  return (a.units ?? 'm') === (b.units ?? 'm');
}

// Full structural equality: same origin, (canonicalised) CRS, and units.
function frameEq(a, b) {
  return canonCrs(a.crs) === canonCrs(b.crs) && (a.units ?? 'm') === (b.units ?? 'm') &&
    a.origin[0] === b.origin[0] && a.origin[1] === b.origin[1] && a.origin[2] === b.origin[2];
}

// ── Point transforms (single [x,y] or [x,y,z]) ──────────────────────────────────

// World → local: subtract the origin component-wise. Round-trips losslessly with
// `toWorld` at f64 (invariant 3) — exact when the origin is chosen near the data, the
// intended use.
function toLocal(worldPt, frame) {
  const o = frame.origin, r = new Array(worldPt.length);
  for (let i = 0; i < worldPt.length; i++) r[i] = worldPt[i] - (o[i] || 0);
  return r;
}

// Local → world: add the origin back. The inverse of `toLocal`.
function toWorld(localPt, frame) {
  const o = frame.origin, r = new Array(localPt.length);
  for (let i = 0; i < localPt.length; i++) r[i] = localPt[i] + (o[i] || 0);
  return r;
}

// ── Bulk buffer transforms (flat x,y,z,x,y,z,… arrays) ──────────────────────────
// These consolidate the hand-rolled F64-recentre loops currently duplicated in the
// dee importers (lfm/msh adapters): subtract the origin at full f64 precision and hand
// the small local magnitudes to the F32/GPU downcast. The one hard rule of §5 —
// anything bound for a Float32Array passes through the local frame FIRST — is this
// call. Returns a NEW Float64Array; input is never mutated.

function toLocalCoords(coords, frame, { stride = 3 } = {}) {
  const o = frame.origin, out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] - (o[j] || 0);
  return out;
}

function toWorldCoords(coords, frame, { stride = 3 } = {}) {
  const o = frame.origin, out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] + (o[j] || 0);
  return out;
}

// ── Choosing an origin ──────────────────────────────────────────────────────────

// Pick a sticky origin from world-coordinate bounds. Default strategy 'centroid'
// (bbox centre); 'floor' keeps locals strictly positive (handy across tiled exports).
// The result is rounded to `round` so the anchor reads as a "nice" number in logs and
// diffs rather than an arbitrary fractional point. bounds = { min:[…], max:[…] }.
// The origin is chosen ONCE per document/session and is sticky — recomputing it
// per-operation drifts the frame and invalidates cached geometry (§4).
function originFromBounds(bounds, { round = 1, strategy = 'centroid' } = {}) {
  const { min, max } = bounds, n = Math.min(min.length, max.length), o = [];
  for (let i = 0; i < n; i++) {
    const c = strategy === 'floor' ? min[i] : (min[i] + max[i]) / 2;
    o.push(round ? Math.round(c / round) * round : c);
  }
  while (o.length < 3) o.push(0);
  return o.slice(0, 3);
}

// Convenience: a Frame straight from bounds (origin via `originFromBounds`, carrying
// the given CRS/units).
function frameFromBounds(bounds, opts = {}) {
  return makeFrame({
    origin: originFromBounds(bounds, opts),
    crs: opts.crs ?? null,
    units: opts.units ?? 'm',
  });
}

// ── Frame-relative tolerance ────────────────────────────────────────────────────

// A tolerance scaled to the working extent, so coincidence / parallel / on-curve tests
// stay meaningful at any magnitude — a fixed absolute 1e-9 is meaningless against UTM
// operands, the same failure class as the original silent-shift bug. `extent` is the
// working span (e.g. the local bbox diagonal); `rel` is the relative floor. Feeds the
// @gcu/regula tolerance model. Note exact sign/orientation tests stay EXACT (groma
// predicates) — this ε is only for constructed quantities.
function extentTolerance(frame, extent, { rel = 1e-9 } = {}) {
  const e = Math.abs(extent) || 1;
  return { eps: rel * e, rel, extent: e, units: frame.units };
}

// ── Frame ↔ frame ───────────────────────────────────────────────────────────────

// The translation to add to a point expressed local-in `from` to re-express it
// local-in `to`:  localTo = localFrom + (fromOrigin − toOrigin). Throws if the frames
// describe different projections — moving between those is a reprojection, which frame
// does not perform (the hard boundary).
function delta(from, to) {
  if (!sameProjection(from, to)) {
    throw new Error(
      `frame.delta: frames differ in CRS/units (${from.crs}/${from.units} → ${to.crs}/${to.units}); ` +
      'that is a reprojection, which @gcu/frame does not perform',
    );
  }
  return [
    from.origin[0] - to.origin[0],
    from.origin[1] - to.origin[1],
    from.origin[2] - to.origin[2],
  ];
}

// Declare an artifact's frame WITHOUT moving its coordinates (invariant 2: a coordinate
// expressed in a local frame always carries an inspectable origin). Shallow, pure —
// returns a copy with `.frame` stamped. Re-EXPRESSING coordinates into a different
// frame is `rebaseCoords`, a separate and logged transform.
function withFrame(artifact, frame) {
  return { ...artifact, frame };
}

// Re-express a flat coordinate buffer from one frame into another. Returns BOTH the new
// Float64Array and a provenance record — rebasing is an explicit, accountable transform
// (invariants 4/5), so you cannot get the moved coordinates without the record of what
// moved them (the same "numbers plus an account of what I did to them" discipline as
// the DXF contract). Throws via `delta` on a CRS/units mismatch. Pure; input untouched.
function rebaseCoords(coords, from, to, { stride = 3 } = {}) {
  const d = delta(from, to);
  const out = new Float64Array(coords.length);
  for (let i = 0; i < coords.length; i += stride)
    for (let j = 0; j < stride; j++) out[i + j] = coords[i + j] + (d[j] || 0);
  return { coords: out, record: rebaseRecord(from, to, d) };
}

// A provenance entry for a rebase — what the caller pushes onto its frame log.
function rebaseRecord(from, to, d) {
  return {
    op: 'rebase',
    from: { origin: [...from.origin], crs: from.crs, units: from.units },
    to: { origin: [...to.origin], crs: to.crs, units: to.units },
    delta: d,
  };
}

// ── src/core/morton.js ──

// @gcu/condenser — Morton (Z-order) keys + a radix sort over indices.
// Batch-wise spatial chunking (micro-spec §2.1.3): quantize each point to a
// 10-bit lattice per axis against the batch bbox, interleave to a 30-bit key,
// radix-sort an index array by key (three 10-bit passes, ping-pong — sorting
// indices, not elements, avoids the 2× transient), then slice the sorted order
// into chunks. Points that are near in space land in the same chunk → tight
// chunk AABBs → frustum culling and front-to-back order fall out.

// Spread the low 10 bits of v so there are two zero bits between each.
function part1by2(v) {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x30000ff;
  v = (v | (v << 8)) & 0x300f00f;
  v = (v | (v << 4)) & 0x30c30c3;
  v = (v | (v << 2)) & 0x9249249;
  return v;
}

// 30-bit Morton key from 10-bit lattice coordinates.
function mortonKey(ix, iy, iz) {
  return (part1by2(iz) << 2) | (part1by2(iy) << 1) | part1by2(ix);
}

// Keys for a batch: quantize x/y/z (f64, any space — only intra-batch
// consistency matters) to 10 bits against the batch extent.
function mortonKeys(x, y, z, n) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];
    if (z[i] < minZ) minZ = z[i]; if (z[i] > maxZ) maxZ = z[i];
  }
  const sx = maxX > minX ? 1023 / (maxX - minX) : 0;
  const sy = maxY > minY ? 1023 / (maxY - minY) : 0;
  const sz = maxZ > minZ ? 1023 / (maxZ - minZ) : 0;
  const keys = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    keys[i] = mortonKey(((x[i] - minX) * sx) | 0, ((y[i] - minY) * sy) | 0, ((z[i] - minZ) * sz) | 0);
  }
  return keys;
}

// Radix sort 0..n-1 by keys[] — three 10-bit passes, counting sort each,
// ping-pong index buffers. Stable; returns the sorted index array.
function radixSortIndices(keys, n) {
  let src = new Uint32Array(n), dst = new Uint32Array(n);
  for (let i = 0; i < n; i++) src[i] = i;
  const counts = new Uint32Array(1024);
  for (let pass = 0; pass < 3; pass++) {
    const shift = pass * 10;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[(keys[src[i]] >>> shift) & 0x3ff]++;
    let sum = 0;
    for (let b = 0; b < 1024; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
    for (let i = 0; i < n; i++) dst[counts[(keys[src[i]] >>> shift) & 0x3ff]++] = src[i];
    const t = src; src = dst; dst = t;
  }
  return src;
}

// ── src/core/chunks.js ──

// @gcu/condenser — the chunk store: RawChunks (world f64, from a provider) →
// render-ready Chunks (frame-local uint16 positions + attributes + record index).
//
// Frame-local first (micro-spec Addendum A.1): one @gcu/frame per document, chosen
// from the header bbox; everything downstream (chunk bboxes, camera, clip uniforms)
// lives at small local magnitudes so the f32/GPU path never sees a 7.7e6 northing.
// The frame is pure translation with CRS identity — publish world coordinates by
// adding the origin back at the boundary.
//
// The invariant everything rests on (micro-spec §2.1.4): after building, elements
// inside a chunk are RANDOMLY PERMUTED, so any prefix of a chunk is a uniform
// random subsample of that chunk's region. Prefix-LOD, progressive accumulation,
// and budget-capped drawing all read prefixes and inherit their correctness from
// this shuffle. Seeded PRNG (mulberry32) → deterministic for tests.
//
// Chunking is BATCH-MORTON (§2.1.3): accumulate ~batchSize elements, Morton-radix-
// sort the batch, slice the sorted order into chunks → spatially tight chunk AABBs
// (frustum culling + front-to-back fall out) while peak CPU memory stays bounded
// by batchSize × constant — never proportional to the file (§3 heap bound).
//
// Chunk = {
//   count, bboxLocal: Float64Array(6) [minX,minY,minZ,maxX,maxY,maxZ],
//   pos: Uint16Array(3N)  — quantized against bboxLocal (denormalize in-shader),
//   intensity: Uint16Array, classification: Uint8Array, rgb: Uint8Array(3N)|null,
//   recIdx: Uint32Array   — row number in the source file: THE join key (§4).
// }


// mulberry32 — tiny seeded PRNG; good enough for a decorrelating shuffle.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher–Yates permutation of 0..n-1.
function shuffledIndices(n, rnd) {
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// In-place Fisher–Yates over an existing index array (a gather list).
function shuffleInPlace(idx, rnd) {
  for (let i = idx.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// Pick the document frame from a provider header (bbox in world coords). CRS is
// identity metadata only — condenser never reprojects.
function documentFrame(header, { crs = null } = {}) {
  const b = header.bbox;
  if (b && Number.isFinite(b.min[0]) && Number.isFinite(b.max[0]) && (b.max[0] || b.min[0])) {
    return frameFromBounds({ min: b.min, max: b.max }, { crs, round: 1 });
  }
  return makeFrame({ origin: [0, 0, 0], crs });            // no usable bbox → identity
}

/**
 * Build one render Chunk from columnar source arrays. `indices` is an optional
 * gather list (element ids into the columns — e.g. one Morton-ordered slice of a
 * batch); omitted → all elements. The gather list is SHUFFLED (in a copy) before
 * the single gather-quantize pass — gather and shuffle cost one pass together.
 */
function buildChunk({ x, y, z, intensity, classification, rgb, recIdx }, frame, rnd, indices = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  // pass 1 — frame-local bbox (f64 subtract BEFORE any narrowing — the one hard rule)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k;
    const px = x[i] - o[0], py = y[i] - o[1], pz = z[i] - o[2];
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }
  const sx = maxX > minX ? 65535 / (maxX - minX) : 0;
  const sy = maxY > minY ? 65535 / (maxY - minY) : 0;
  const sz = maxZ > minZ ? 65535 / (maxZ - minZ) : 0;
  // pass 2 — shuffle the gather order, then gather + quantize in one sweep
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const pos = new Uint16Array(3 * n);
  const outI = new Uint16Array(n), outC = new Uint8Array(n), outR = new Uint32Array(n);
  const outRgb = rgb ? new Uint8Array(3 * n) : null;
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    pos[k * 3] = ((x[i] - o[0] - minX) * sx + 0.5) | 0;
    pos[k * 3 + 1] = ((y[i] - o[1] - minY) * sy + 0.5) | 0;
    pos[k * 3 + 2] = ((z[i] - o[2] - minZ) * sz + 0.5) | 0;
    outI[k] = intensity[i];
    outC[k] = classification[i];
    outR[k] = recIdx[i];
    if (outRgb) { outRgb[k * 3] = rgb[i * 3]; outRgb[k * 3 + 1] = rgb[i * 3 + 1]; outRgb[k * 3 + 2] = rgb[i * 3 + 2]; }
  }
  return {
    count: n,
    bboxLocal: Float64Array.of(minX, minY, minZ, maxX, maxY, maxZ),
    pos, intensity: outI, classification: outC, rgb: outRgb, recIdx: outR,
  };
}

// Denormalize one quantized element back to frame-local f64 (tests + picking).
function chunkLocalPosition(chunk, k) {
  const b = chunk.bboxLocal;
  const d = (v, mn, mx) => (mx > mn ? mn + (v / 65535) * (mx - mn) : mn);
  return [
    d(chunk.pos[k * 3], b[0], b[3]),
    d(chunk.pos[k * 3 + 1], b[1], b[4]),
    d(chunk.pos[k * 3 + 2], b[2], b[5]),
  ];
}

/**
 * ChunkBuilder — feed RawChunks as they stream in; emits finished Chunks via
 * onChunk. Batch-Morton by default: elements accumulate to ~batchSize, the batch
 * is Morton-sorted and sliced into chunkSize chunks (each internally shuffled).
 * `morton: false` slices in arrival order instead (still shuffled). flush()
 * emits the remainder and returns the document summary.
 */
function createChunkBuilder({ frame, chunkSize = 1 << 20, batchSize = 0, morton = true, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;               // default: 4 chunks per spatial batch
  let pend = [];                                           // pending RawChunk column slices
  let pendCount = 0;
  const doc = { count: 0, bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity), hasRgb: false };

  const concat = (Type, parts, per) => {
    const out = new Type(pendCount * per);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const emitChunk = (chunk) => {
    doc.count += chunk.count;
    doc.hasRgb = doc.hasRgb || !!chunk.rgb;
    const b = doc.bboxLocal, cb = chunk.bboxLocal;
    for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
    onChunk(chunk);
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((p) => p.x), 1),
      y: concat(Float64Array, pend.map((p) => p.y), 1),
      z: concat(Float64Array, pend.map((p) => p.z), 1),
      intensity: concat(Uint16Array, pend.map((p) => p.intensity), 1),
      classification: concat(Uint8Array, pend.map((p) => p.classification), 1),
      rgb: pend.every((p) => p.rgb) ? concat(Uint8Array, pend.map((p) => p.rgb), 3) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx), 1),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = morton ? radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n) : null;
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(start + chunkSize, n);
      const slice = order ? order.subarray(start, end)
        : Uint32Array.from({ length: end - start }, (_, i) => start + i);
      emitChunk(buildChunk(cols, frame, rnd, slice));
    }
  };

  return {
    push(raw) {
      // record indices: the provider may supply raw.recIdx directly (RAW record
      // numbers, gaps allowed — .dm skips bad rows but keeps true row numbers so
      // O(1) record fetch works); default = recStart + i (gapless providers).
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i;
      }
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const slice = (a, per = 1) => (a ? a.subarray(taken * per, (taken + n) * per) : null);
        pend.push({ x: slice(raw.x), y: slice(raw.y), z: slice(raw.z), intensity: slice(raw.intensity), classification: slice(raw.classification), rgb: slice(raw.rgb, 3), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/core/blocks.js ──

// @gcu/condenser — block-model chunks: IJK-exact representation (micro-spec §2.5).
//
// For a REGULAR uniform grid, a block's centroid is fully determined by its integer
// IJK: center = grid.originLocal + ijk · size, where originLocal is the CENTROID of
// block (0,0,0) — the centroid convention throughout. Chunks store raw uint16 IJK
// (not bbox-normalized lattice positions), so reconstruction is EXACT — and IJK is
// itself useful for the grid-view join. Half-dims are a chunk-level uniform (all
// blocks one size) for a REGULAR grid. SUB-BLOCKED models use the same IJK scheme
// against a FINE lattice (pitch = min dim /2) plus a per-block u8 size code into a
// shared half-dim palette (chunk.dim + chunk.dimPalette); centroids stay exact.
//
// Attributes per block: one SCALAR channel (grade — f32 in, quantized u16 against
// the chunk's min/max, range carried per chunk) + one CATEGORY channel (u8 codes
// from the provider's dictionary, ≤255 distinct) + uint32 record index (the join).
// The intra-chunk shuffle invariant (§2.1.4) applies unchanged.
//
// BlockChunk = {
//   kind: 'blocks', count,
//   grid: { originLocal: [x,y,z], size: [dx,dy,dz] },   — shared, frame-local
//   ijk: Uint16Array(3N), chan: Uint16Array(N), chanRange: [min,max],
//   cat: Uint8Array(N), recIdx: Uint32Array(N),
//   bboxLocal: Float64Array(6)                          — outer faces, for culling
// }


// Grid from three axes (world coords) + a frame → the block-chunk grid descriptor.
// origin here is the centroid of block (0,0,0), frame-local.
function makeBlockGrid(axes, frame) {
  const o = frame.origin;
  return {
    originLocal: [axes[0].origin - o[0], axes[1].origin - o[1], axes[2].origin - o[2]],
    size: [axes[0].pitch || 1, axes[1].pitch || 1, axes[2].pitch || 1],
    count: [axes[0].count, axes[1].count, axes[2].count],
  };
}

/**
 * Build one BlockChunk from columnar world-space block centroids + attributes.
 * `indices` = optional gather list (a Morton slice); shuffled like point chunks.
 * IJK is computed against the grid; anything off-lattice snaps to the nearest
 * cell (the provider validated regularity during discovery).
 */
function buildBlockChunk({ x, y, z, chan, cat, recIdx, dim }, grid, frame, rnd, indices = null, dimPalette = null) {
  const n = indices ? indices.length : x.length;
  const o = frame.origin;
  const [gx, gy, gz] = grid.originLocal, [sx, sy, sz] = grid.size;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const ijk = new Uint16Array(3 * n);
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  const sub = !!(dim && dimPalette);                        // sub-blocked → per-block size code
  const outDim = sub ? new Uint8Array(n) : null;
  // chan range over this chunk (quantize against it — per-chunk min/max, §2.1.2)
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = cMax > cMin ? 65535 / (cMax - cMin) : 0;
  let minI = 65535, minJ = 65535, minK = 65535, maxI = 0, maxJ = 0, maxK = 0;
  // sub-blocked: track actual box faces (variable half-dims) for the cull bbox
  let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    const bi = Math.max(0, Math.round((x[i] - o[0] - gx) / sx));
    const bj = Math.max(0, Math.round((y[i] - o[1] - gy) / sy));
    const bk = Math.max(0, Math.round((z[i] - o[2] - gz) / sz));
    ijk[k * 3] = bi; ijk[k * 3 + 1] = bj; ijk[k * 3 + 2] = bk;
    if (bi < minI) minI = bi; if (bi > maxI) maxI = bi;
    if (bj < minJ) minJ = bj; if (bj > maxJ) maxJ = bj;
    if (bk < minK) minK = bk; if (bk > maxK) maxK = bk;
    const cv = chan[i];
    outChan[k] = Number.isFinite(cv) ? ((cv - cMin) * cScale + 0.5) | 0 : 0;
    outCat[k] = cat ? cat[i] : 0;
    outR[k] = recIdx[i];
    if (sub) {
      const dc = dim[i]; outDim[k] = dc;
      const h = dimPalette[dc] || [sx / 2, sy / 2, sz / 2];
      const cx = gx + bi * sx, cy = gy + bj * sy, cz = gz + bk * sz;
      if (cx - h[0] < fx0) fx0 = cx - h[0]; if (cx + h[0] > fx1) fx1 = cx + h[0];
      if (cy - h[1] < fy0) fy0 = cy - h[1]; if (cy + h[1] > fy1) fy1 = cy + h[1];
      if (cz - h[2] < fz0) fz0 = cz - h[2]; if (cz + h[2] > fz1) fz1 = cz + h[2];
    }
  }
  // culling bbox = outer faces of the extreme blocks (variable-size when sub-blocked)
  const bboxLocal = sub
    ? Float64Array.of(fx0, fy0, fz0, fx1, fy1, fz1)
    : Float64Array.of(
        gx + minI * sx - sx / 2, gy + minJ * sy - sy / 2, gz + minK * sz - sz / 2,
        gx + maxI * sx + sx / 2, gy + maxJ * sy + sy / 2, gz + maxK * sz + sz / 2,
      );
  const chunk = { kind: 'blocks', count: n, grid, ijk, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal };
  if (sub) { chunk.dim = outDim; chunk.dimPalette = dimPalette; }
  return chunk;
}

// Exact centroid of element k, frame-local (tests + picking).
function blockLocalCenter(chunk, k) {
  const g = chunk.grid;
  return [
    g.originLocal[0] + chunk.ijk[k * 3] * g.size[0],
    g.originLocal[1] + chunk.ijk[k * 3 + 1] * g.size[1],
    g.originLocal[2] + chunk.ijk[k * 3 + 2] * g.size[2],
  ];
}

/**
 * BlockChunkBuilder — same shape as createChunkBuilder but for block RawChunks
 * ({ count, x, y, z, chan: Float32Array|Float64Array, cat: Uint8Array|null,
 * recStart }). Batch-Morton, sliced, shuffled. Tracks the document chan range
 * (for the color ramp) alongside the local bbox.
 */
function createBlockChunkBuilder({ frame, grid, dimPalette = null, chunkSize = 1 << 20, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
    chanRange: [Infinity, -Infinity],
  };
  const concat = (Type, parts, per = 1) => {
    const out = new Type(pendCount * per);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((p) => p.x)),
      y: concat(Float64Array, pend.map((p) => p.y)),
      z: concat(Float64Array, pend.map((p) => p.z)),
      chan: concat(Float64Array, pend.map((p) => p.chan)),
      cat: pend.every((p) => p.cat) ? concat(Uint8Array, pend.map((p) => p.cat)) : null,
      dim: dimPalette && pend.every((p) => p.dim) ? concat(Uint8Array, pend.map((p) => p.dim)) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildBlockChunk(cols, grid, frame, rnd, slice, dimPalette);
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      if (chunk.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = chunk.chanRange[0];
      if (chunk.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = chunk.chanRange[1];
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      // record indices: the provider may supply raw.recIdx directly (RAW record
      // numbers, gaps allowed — .dm skips bad rows but keeps true row numbers so
      // O(1) record fetch works); default = recStart + i (gapless providers).
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i;
      }
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), dim: s(raw.dim), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/grid/infer.js ──

// @gcu/condenser — grid inference (the grid layer): recover a regular lattice
// from what a provider's discovery sweep observed. Home of the axis inference
// today and the rotated-basis inference tomorrow (micro-rotated-models spec:
// cluster nearest-neighbour centroid displacements → U/V/W generators).

/**
 * Infer a regular grid from per-axis distinct centroid values (collected by a
 * provider's discovery sweep). Returns { origin (CENTROID of block 0 — i.e. the
 * first lattice value), pitch, count } per axis, or null when the axis isn't a
 * consistent lattice. `values` must be sorted ascending, deduped.
 */
function inferAxis(values, { rel = 1e-6 } = {}) {
  if (!values.length) return null;
  if (values.length === 1) return { origin: values[0], pitch: 0, count: 1 };
  let pitch = Infinity;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0 && d < pitch) pitch = d;
  }
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  const span = values[values.length - 1] - values[0];
  const count = Math.round(span / pitch) + 1;
  if (count > 65535) return null;                          // beyond u16 IJK — not this path
  const eps = Math.max(pitch * 1e-3, Math.abs(values[0]) * rel);
  for (const v of values) {
    const k = Math.round((v - values[0]) / pitch);
    if (Math.abs(values[0] + k * pitch - v) > eps) return null;   // off-lattice → not regular
  }
  return { origin: values[0], pitch, count };
}

// ── src/grid/grid-join.js ──

// @gcu/condenser — grid compatibility + volume-weighted resample (micro join).
//
// A regular grid axis = { origin, pitch, count }, origin = block-0 CENTROID
// (condenser convention). Cell i spans world [origin+(i-0.5)·pitch,
// origin+(i+0.5)·pitch].
//
// Two grids are COMPATIBLE (per axis) when they share a common lattice
// g = gcd(pitchA, pitchB) (both pitches integer multiples of g) AND their
// origins are phase-aligned on g (offset an integer multiple of g). Then every
// cell decomposes exactly into g-cells and a source→target resample is EXACT
// (integer g-unit overlap weights, no float fuzz):
//   - source coarser than target → refine-replicate,
//   - source finer  → aggregate,
//   - non-nested but common-lattice (e.g. 10 & 12 on g=2) → exact mixed weights.
// Incompatible (no small common lattice, or off-phase) → refused with a reason.
//
// v1: axis-aligned grids. Rotated grids must share azimuth (not modelled here).

const REL = 1e-6;                                          // relative tolerance

// tolerant Euclidean gcd of two positive floats
function floatGcd(a, b, tol) {
  a = Math.abs(a); b = Math.abs(b);
  if (a < b) { const t = a; a = b; b = t; }
  let guard = 0;
  while (b > tol && guard++ < 1000) { const r = a % b; a = b; b = r; }
  return a;
}

// Per-axis source→target overlap map. Returns { ok, reason } or
// { ok:true, g, sp, tp, map:[[{t,w}...] per source index], nested }.
// map[si] = target cells overlapping source cell si, w = overlap in g-units.
function axisMap(src, tgt, opts = {}) {
  // degenerate (single-plane) axis: trivial pass-through
  if (src.count === 1 && tgt.count === 1) return { ok: true, g: 1, sp: 1, tp: 1, map: [[{ t: 0, w: 1 }]], nested: true };
  if (!(src.pitch > 0) || !(tgt.pitch > 0)) return { ok: false, reason: 'a single-plane axis cannot join a multi-cell axis' };
  const tol = opts.tol || REL * Math.max(src.pitch, tgt.pitch, 1);
  const g = floatGcd(src.pitch, tgt.pitch, tol);
  if (!(g > tol)) return { ok: false, reason: 'no common lattice (pitches share no usable factor)' };
  const sp = Math.round(src.pitch / g), tp = Math.round(tgt.pitch / g);
  const capped = opts.cap || 4096;
  if (sp > capped || tp > capped) return { ok: false, reason: `pitches ${src.pitch} and ${tgt.pitch} share no small common lattice (would need a ${g} unit grid)` };
  // g-units measured from the target lattice low face (cell-0 low boundary)
  const ref = tgt.origin - tgt.pitch / 2;
  const srcLow0 = src.origin - src.pitch / 2;
  const phaseF = (srcLow0 - ref) / g;
  if (Math.abs(phaseF - Math.round(phaseF)) > 1e-4) return { ok: false, reason: `origins off-phase by ${(+(phaseF - Math.round(phaseF)) * g).toFixed(4)} on the ${g} lattice` };
  const p0 = Math.round(phaseF);
  const map = new Array(src.count);
  for (let si = 0; si < src.count; si++) {
    const lo = p0 + si * sp, hi = lo + sp;
    const t0 = Math.floor(lo / tp), t1 = Math.floor((hi - 1) / tp);
    const lst = [];
    for (let ti = Math.max(0, t0); ti <= Math.min(tgt.count - 1, t1); ti++) {
      const ov = Math.min(hi, (ti + 1) * tp) - Math.max(lo, ti * tp);
      if (ov > 0) lst.push({ t: ti, w: ov });
    }
    map[si] = lst;
  }
  return { ok: true, g, sp, tp, map, nested: (sp % tp === 0 || tp % sp === 0) };
}

// Are two whole grids (each { x, y, z } of axes) compatible? → { ok, reason,
// axes:[ax,ay,az], nested }. Uses each axis as source vs the other as target
// (symmetric compatibility — direction doesn't change compatibility).
function gridsCompatible(A, B, opts = {}) {
  const axes = [];
  let nested = true;
  for (const k of ['x', 'y', 'z']) {
    const m = axisMap(A[k], B[k], opts);
    if (!m.ok) return { ok: false, reason: `${k.toUpperCase()}: ${m.reason}` };
    axes.push(m); nested = nested && m.nested;
  }
  return { ok: true, axes, nested };
}

// Build a resampler from source axes → target axes. Returns { ok, reason } or a
// resampler with dense target accumulators. Numeric ops: mean (weighted), sum,
// count, coverage. Categorical: majority (weighted vote).
function makeResampler(srcAxes, tgtAxes, opts = {}) {
  const X = axisMap(srcAxes.x, tgtAxes.x, opts);
  const Y = axisMap(srcAxes.y, tgtAxes.y, opts);
  const Z = axisMap(srcAxes.z, tgtAxes.z, opts);
  for (const [k, m] of [['X', X], ['Y', Y], ['Z', Z]]) if (!m.ok) return { ok: false, reason: `${k}: ${m.reason}` };
  const nx = tgtAxes.x.count, ny = tgtAxes.y.count, nz = tgtAxes.z.count;
  const cells = nx * ny * nz;
  const idxOf = (ti, tj, tk) => ti + nx * (tj + ny * tk);
  // full target-cell g-volume, for coverage (= tp_x·tp_y·tp_z)
  const fullW = X.tp * Y.tp * Z.tp;
  const nested = X.nested && Y.nested && Z.nested;
  return {
    ok: true, nx, ny, nz, cells, idxOf, fullW, nested, X, Y, Z,
    newAcc: () => ({ sum: new Float64Array(cells), w: new Float64Array(cells) }),
    // scatter one NUMERIC source cell (si,sj,sk index in the SOURCE lattice)
    scatter(si, sj, sk, v, wt, acc) {
      const xm = X.map[si], ym = Y.map[sj], zm = Z.map[sk];
      if (!xm || !ym || !zm) return;
      for (const { t: ti, w: wi } of xm) for (const { t: tj, w: wj } of ym) for (const { t: tk, w: wk } of zm) {
        const w = wi * wj * wk * wt; if (w <= 0) continue;
        const idx = idxOf(ti, tj, tk); acc.sum[idx] += v * w; acc.w[idx] += w;
      }
    },
    // finalize numeric → { out: Float64Array(cells), coverage: Float32Array, present: Uint8Array }
    finalize(acc, op = 'mean') {
      const out = new Float64Array(cells), coverage = new Float32Array(cells), present = new Uint8Array(cells);
      for (let i = 0; i < cells; i++) {
        const w = acc.w[i]; if (w <= 0) { out[i] = NaN; continue; }
        present[i] = 1; coverage[i] = Math.min(1, w / fullW);
        out[i] = op === 'sum' ? acc.sum[i] : op === 'count' ? acc.w[i] : op === 'coverage' ? coverage[i] : acc.sum[i] / w;   // mean default
      }
      return { out, coverage, present };
    },
    // categorical: separate vote accumulator (Map per touched cell)
    newCatAcc: () => new Map(),                             // idx → Map(code → weight)
    scatterCat(si, sj, sk, code, wt, votes) {
      const xm = X.map[si], ym = Y.map[sj], zm = Z.map[sk];
      if (!xm || !ym || !zm) return;
      for (const { t: ti, w: wi } of xm) for (const { t: tj, w: wj } of ym) for (const { t: tk, w: wk } of zm) {
        const w = wi * wj * wk * wt; if (w <= 0) continue;
        const idx = idxOf(ti, tj, tk);
        let m = votes.get(idx); if (!m) { m = new Map(); votes.set(idx, m); }
        m.set(code, (m.get(code) || 0) + w);
      }
    },
    finalizeCat(votes) {   // → { out: Int32Array(cells) of winning code (-1 empty), tie: Uint8Array }
      const out = new Int32Array(cells).fill(-1), tie = new Uint8Array(cells);
      for (const [idx, m] of votes) {
        let best = -1, bw = -1, tied = false;
        for (const [code, w] of m) { if (w > bw + 1e-9) { best = code; bw = w; tied = false; } else if (Math.abs(w - bw) <= 1e-9) tied = true; }
        out[idx] = best; tie[idx] = tied ? 1 : 0;
      }
      return { out, tie };
    },
  };
}

// Box → grid volume-weighted aggregator (sub-blocked reconcile). A sub-blocked
// model has no source LATTICE — it's a set of variable-size axis-aligned boxes.
// This scatters each box (world centroid + half-dims) onto a regular TARGET grid
// weighted by geometric OVERLAP VOLUME, so a sub-blocked model aggregates up to
// any compatible regular grid — the PARENT grid being the natural choice (each
// sub-block lands wholly in its parent cell). Reuses the same acc/finalize shape
// as makeResampler, so the reconcile Δ-map machinery is identical. The caller
// controls WHICH boxes scatter (a selection/filter): just skip the ones it wants
// excluded — volume weighting handles partial parent coverage correctly.
function makeBoxAggregator(tgt, opts = {}) {
  const nx = tgt.x.count, ny = tgt.y.count, nz = tgt.z.count;
  const cells = nx * ny * nz;
  const idxOf = (ti, tj, tk) => ti + nx * (tj + ny * tk);
  // world volume of a full target cell (degenerate axes factor out as 1)
  const cellVol = ['x', 'y', 'z'].reduce((p, k) => p * (tgt[k].pitch > 0 ? tgt[k].pitch : 1), 1);
  // target cells overlapping world interval [lo,hi] on one axis → [{ i, ov }]
  const axisCells = (ax, lo, hi) => {
    if (!(ax.pitch > 0)) return [{ i: 0, ov: 1 }];           // single-plane axis: unit overlap (factors out)
    const low0 = ax.origin - ax.pitch / 2;
    const first = Math.floor((lo - low0) / ax.pitch);
    const last = Math.floor((hi - low0) / ax.pitch - 1e-9);
    const out = [];
    for (let i = Math.max(0, first); i <= Math.min(ax.count - 1, last); i++) {
      const cLo = low0 + i * ax.pitch, cHi = cLo + ax.pitch;
      const ov = Math.min(hi, cHi) - Math.max(lo, cLo);
      if (ov > 1e-12) out.push({ i, ov });
    }
    return out;
  };
  return {
    ok: true, nx, ny, nz, cells, idxOf, cellVol,
    newAcc: () => ({ sum: new Float64Array(cells), w: new Float64Array(cells) }),
    // scatter one box (world centroid cx,cy,cz + half-dims hx,hy,hz), value v,
    // extra weight wt (e.g. 0 to exclude). Accumulates v·overlapVol and overlapVol.
    scatterBox(cx, cy, cz, hx, hy, hz, v, wt, acc) {
      if (!(wt > 0) || !Number.isFinite(v)) return;
      const xs = axisCells(tgt.x, cx - hx, cx + hx);
      if (!xs.length) return;
      const ys = axisCells(tgt.y, cy - hy, cy + hy);
      if (!ys.length) return;
      const zs = axisCells(tgt.z, cz - hz, cz + hz);
      for (const X of xs) for (const Y of ys) for (const Z of zs) {
        const w = X.ov * Y.ov * Z.ov * wt; if (w <= 0) continue;
        const idx = idxOf(X.i, Y.i, Z.i); acc.sum[idx] += v * w; acc.w[idx] += w;
      }
    },
    // → { out: Float64Array (NaN where empty), coverage: Float32Array (w/cellVol),
    // present: Uint8Array }. op: 'mean' (default) | 'sum' | 'volume' | 'coverage'.
    finalize(acc, op = 'mean') {
      const out = new Float64Array(cells), coverage = new Float32Array(cells), present = new Uint8Array(cells);
      for (let i = 0; i < cells; i++) {
        const w = acc.w[i]; if (w <= 0) { out[i] = NaN; continue; }
        present[i] = 1; coverage[i] = cellVol > 0 ? Math.min(1, w / cellVol) : 1;
        out[i] = op === 'sum' ? acc.sum[i] : op === 'volume' ? w : op === 'coverage' ? coverage[i] : acc.sum[i] / w;
      }
      return { out, coverage, present };
    },
    // categorical: volume-weighted majority vote (parity with makeResampler)
    newCatAcc: () => new Map(),                              // idx → Map(code → volume)
    scatterCatBox(cx, cy, cz, hx, hy, hz, code, wt, votes) {
      if (!(wt > 0)) return;
      const xs = axisCells(tgt.x, cx - hx, cx + hx); if (!xs.length) return;
      const ys = axisCells(tgt.y, cy - hy, cy + hy); if (!ys.length) return;
      const zs = axisCells(tgt.z, cz - hz, cz + hz);
      for (const X of xs) for (const Y of ys) for (const Z of zs) {
        const w = X.ov * Y.ov * Z.ov * wt; if (w <= 0) continue;
        const idx = idxOf(X.i, Y.i, Z.i);
        let m = votes.get(idx); if (!m) { m = new Map(); votes.set(idx, m); }
        m.set(code, (m.get(code) || 0) + w);
      }
    },
    finalizeCat(votes) {
      const out = new Int32Array(cells).fill(-1), tie = new Uint8Array(cells);
      for (const [idx, m] of votes) {
        let best = -1, bw = -1, tied = false;
        for (const [code, w] of m) { if (w > bw + 1e-9) { best = code; bw = w; tied = false; } else if (Math.abs(w - bw) <= 1e-9) tied = true; }
        out[idx] = best; tie[idx] = tied ? 1 : 0;
      }
      return { out, tie };
    },
  };
}

// A common target lattice covering the union of N grids AND compatible with all.
// grids: [{x,y,z}]. resolution: 'finest' | 'coarsest' | 'gcd' | number(pitch,
// per-axis via {x,y,z}). Returns { ok, reason } or { x, y, z } target axes.
function commonLattice(grids, opts = {}) {
  if (!grids.length) return { ok: false, reason: 'no grids' };
  const res = opts.resolution || 'finest';
  const out = {};
  for (const k of ['x', 'y', 'z']) {
    const ax = grids.map((G) => G[k]);
    const real = ax.filter((a) => a.pitch > 0);            // count-1 with a real pitch still counts
    if (!real.length) { out[k] = { origin: ax[0].origin, pitch: ax[0].pitch || 0, count: 1 }; continue; }
    const tol = REL * Math.max(...real.map((a) => a.pitch), 1);
    // common g across all real axes
    let g = real[0].pitch;
    for (const a of real) g = floatGcd(g, a.pitch, tol);
    if (!(g > tol)) return { ok: false, reason: `${k.toUpperCase()}: grids share no common lattice` };
    // all origins must share the same residue mod g (pairwise phase alignment)
    const low = (a) => a.origin - a.pitch / 2;
    const r0 = ((low(real[0]) % g) + g) % g;
    for (const a of real) {
      const r = ((low(a) % g) + g) % g;
      let d = Math.abs(r - r0); d = Math.min(d, g - d);
      if (d > 1e-4 + tol) return { ok: false, reason: `${k.toUpperCase()}: grids are off-phase (can't share a lattice)` };
    }
    // choose target pitch
    let tp;
    if (res === 'gcd') tp = g;
    else if (res === 'coarsest') tp = Math.max(...real.map((a) => a.pitch));
    else if (typeof res === 'object' && res && res[k] != null) tp = res[k];
    else if (typeof res === 'number') tp = res;
    else tp = Math.min(...real.map((a) => a.pitch));        // 'finest'
    const kk = Math.round(tp / g);
    if (Math.abs(kk * g - tp) > 1e-4 + tol || kk < 1) return { ok: false, reason: `${k.toUpperCase()}: resolution ${tp} is not a multiple of the common lattice ${g}` };
    tp = kk * g;
    // union extent (low faces / high faces)
    const uLo = Math.min(...ax.map((a) => a.origin - (a.pitch || 0) / 2));
    const uHi = Math.max(...ax.map((a) => a.origin + (a.count - 0.5) * (a.pitch || 0)));
    // anchor target low face at the shared residue near uLo
    const L = r0 + Math.floor((uLo - r0) / tp) * tp;
    const count = Math.max(1, Math.ceil((uHi - L) / tp - 1e-6));
    if (count > 65535) return { ok: false, reason: `${k.toUpperCase()}: ${count} cells at pitch ${tp} exceeds the grid limit` };
    out[k] = { origin: L + tp / 2, pitch: tp, count };
  }
  return { ok: true, ...out };
}

// ── src/io/blockmodel.js ──

// @gcu/condenser — delimited block-model provider (CSV/GSLIB-ish exports).
// Centroid columns (XC/YC/ZC by convention, overridable) + one scalar grade
// channel + one categorical channel. A CSV carries no header bbox, so this
// provider runs an honest TWO-SWEEP recipe (both cold-re-runnable over the
// Blob): sweep 1 (discovery) parses coordinates only → per-axis distinct
// values → regular-grid inference (§2.5); sweep 2 streams full RawChunks.
// Sub-blocked / off-lattice models fail grid inference and should be routed
// to the points pipeline by the caller (header.grid === null).
//
// openBlockModel(blob, { mapping? }) → { header, streamChunks }
//   header = { kind:'blockmodel', count, bbox, grid|null, columns, mapping,
//              categories: string[]|null (code → value, ≤255) }
//   RawChunk = { count, x, y, z: Float64Array, chan: Float64Array,
//                cat: Uint8Array|null, recStart }


const X_RE$blockmodel = /^(x|xc|xcent(er|re)?|xmid|east(ing)?|xworld|centroid_?x)$/i;
const Y_RE$blockmodel = /^(y|yc|ycent(er|re)?|ymid|north(ing)?|yworld|centroid_?y)$/i;
const Z_RE$blockmodel = /^(z|zc|zcent(er|re)?|zmid|elev(ation)?|rl|level|zworld|centroid_?z)$/i;
const DIM_RE = /^(d[xyz]|[xyz]inc|[xyz]size|[xyz]dim|dim_?[xyz])$/i;
const DIMX_RE = /^(dx|xinc|xsize|xdim|dim_?x)$/i;
const DIMY_RE = /^(dy|yinc|ysize|ydim|dim_?y)$/i;
const DIMZ_RE = /^(dz|zinc|zsize|zdim|dim_?z)$/i;
const NONGRADE_RE = /^(ijk|id|index|row|i|j|k|dens|density|sg|topo|pct|proportion)$/i;

const WS = 'ws';                                           // whitespace-delimiter sentinel ('\s' in a string is just 's')
const splitter = (delim) => (delim === WS ? (l) => l.trim().split(/\s+/) : (l) => l.split(delim));

// Detect delimiter + header from the first text block.
function sniffDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(0, 24);
  if (!lines.length) throw new Error('blockmodel: no data lines');
  let best = null;
  for (const d of [',', ';', '\t', WS]) {
    const split = splitter(d);
    const counts = lines.map((l) => split(l).length);
    const n = counts[0];
    if (n < 2) continue;
    if (counts.every((c) => c === n) && (!best || n > best.n)) best = { delim: d, n };
  }
  if (!best) throw new Error('blockmodel: no consistent delimiter found');
  const first = splitter(best.delim)(lines[0]).map((s) => s.trim());
  const numericish = (s) => s !== '' && !Number.isNaN(Number(s));
  const hasHeader = first.some((s) => !numericish(s));
  return { delim: best.delim, header: hasHeader ? first : null, columns: best.n };
}

// Pick column roles from names. Returns null when centroids can't be identified.
function mapColumns(header) {
  if (!header) return null;
  const find = (re) => header.findIndex((h) => re.test(h.trim()));
  const x = find(X_RE$blockmodel), y = find(Y_RE$blockmodel), z = find(Z_RE$blockmodel);
  if (x < 0 || y < 0 || z < 0) return null;
  const taken = new Set([x, y, z]);
  header.forEach((h, i) => { if (DIM_RE.test(h.trim())) taken.add(i); });
  let chan = -1;
  for (let i = 0; i < header.length; i++) {
    if (!taken.has(i) && !NONGRADE_RE.test(header[i].trim())) { chan = i; break; }
  }
  return { x, y, z, chan: chan >= 0 ? chan : null, cat: null };
}

// Async generator over the blob's data lines (cold recipe — call again for the
// next sweep). Skips blanks + '#'; yields trimmed field arrays in batches so the
// consumer controls pacing. Exported: the filter sweep (a mask by record index)
// re-reads raw rows through the same path.
async function* lineFields(blob, delim, hasHeader, { signal, onProgress } = {}) {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader();
  const split = splitter(delim);
  let carry = '', first = hasHeader, bytesSeen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (done) break;
      bytesSeen += value.length;
      const text = carry + value;
      const lines = text.split('\n');
      carry = lines.pop();
      const batch = [];
      for (let l of lines) {
        if (l.endsWith('\r')) l = l.slice(0, -1);
        if (!l || l[0] === '#') continue;
        if (first) { first = false; continue; }
        batch.push(split(l));
      }
      if (onProgress) onProgress(bytesSeen, blob.size);
      if (batch.length) yield batch;
    }
    if (carry && carry[0] !== '#' && carry.trim() && !first) yield [split(carry)];
  } finally { reader.releaseLock(); }
}

// Byte-tracking sibling of lineFields for the discovery sweep: yields
// { fields, at } batches where at[i] is the ABSOLUTE byte offset of that data
// line's first byte. 0x0A never occurs inside a UTF-8 multi-byte sequence, so
// byte-level line splitting is exact; text still decodes in BULK per chunk
// (per-line decode would be ~50× slower at 50M rows). These offsets feed the
// sparse record index (fetchDelimitedRecord) — the pick join on big CSVs.
async function* lineFieldsWithOffsets(blob, delim, hasHeader, { signal, onProgress } = {}) {
  const reader = blob.stream().getReader();
  const dec = new TextDecoder();
  const split = splitter(delim);
  let carryText = '', carryAt = 0, pos = 0, first = hasHeader, bytesSeen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (done) break;
      bytesSeen += value.length;
      // newline BYTE positions in this chunk (absolute)
      const nl = [];
      for (let j = 0; j < value.length; j++) if (value[j] === 10) nl.push(pos + j);
      const text = carryText + dec.decode(value, { stream: true });
      const lines = text.split('\n');
      const nextCarry = lines.pop();                       // == nl.length complete lines remain
      const fields = [], at = [];
      for (let i = 0; i < lines.length; i++) {
        const start = i === 0 ? carryAt : nl[i - 1] + 1;
        let l = lines[i];
        if (l.endsWith('\r')) l = l.slice(0, -1);
        if (!l || l[0] === '#') continue;
        if (first) { first = false; continue; }
        fields.push(split(l)); at.push(start);
      }
      carryText = nextCarry;
      carryAt = nl.length ? nl[nl.length - 1] + 1 : carryAt;
      pos += value.length;
      if (onProgress) onProgress(bytesSeen, blob.size);
      if (fields.length) yield { fields, at };
    }
    const tail = carryText + dec.decode();                 // flush any held-back multi-byte bytes
    if (tail && tail[0] !== '#' && tail.trim() && !first) yield { fields: [split(tail.endsWith('\r') ? tail.slice(0, -1) : tail)], at: [carryAt] };
  } finally { reader.releaseLock(); }
}

// O(anchors) record fetch: jump to the nearest preceding anchor, walk forward
// applying the SAME accept predicate as the sweeps (blank/# skipped in the
// reader; non-finite coords skipped here — record numbers count accepted rows
// only). Reads ~indexEvery lines instead of the whole file.
async function fetchDelimitedRecord(blob, header, rec) {
  const idx = header.index;
  if (!idx || !idx.offsets.length || rec < 0 || rec >= header.count) return null;
  const a = Math.min(Math.floor(rec / idx.k), idx.offsets.length - 1);
  let remaining = rec - a * idx.k;
  const m = header.mapping;
  const split = splitter(header.delim);
  const reader = blob.slice(idx.offsets[a]).stream().pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const lines = done ? (carry ? [carry] : []) : (carry + value).split('\n');
      if (!done) carry = lines.pop();
      for (let l of lines) {
        if (l.endsWith('\r')) l = l.slice(0, -1);
        if (!l || l[0] === '#') continue;
        const f = split(l);
        const xv = +f[m.x], yv = +f[m.y], zv = +f[m.z];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (remaining === 0) return f;
        remaining--;
      }
      if (done) return null;
    }
  } finally { reader.releaseLock(); }
}

const CAP_DISTINCT = 300000;                               // per-axis discovery cap

// sweep 2 as a shared factory: the same cold-recipe stream whether the header
// came from a live discovery or a cached `discovered` payload (sidecars)
function makeDelimitedStream(blob, delim, hasHeaderRow, map, catCol, catCode, dimInfo = null) {
  const r10 = (v) => Number(v.toPrecision(10));
  return async function* streamChunks({ chunkPoints = 1 << 18, signal: s2, onProgress: op2 } = {}) {
    const alloc = () => ({ x: new Float64Array(chunkPoints), y: new Float64Array(chunkPoints), z: new Float64Array(chunkPoints), chan: new Float64Array(chunkPoints), cat: catCode ? new Uint8Array(chunkPoints) : null, dim: dimInfo ? new Uint8Array(chunkPoints) : null });
    let buf = alloc(), fill = 0, recStart = 0;
    for await (const batch of lineFields(blob, delim, hasHeaderRow, { signal: s2, onProgress: op2 })) {
      for (const f of batch) {
        const xv = +f[map.x], yv = +f[map.y], zv = +f[map.z];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        buf.x[fill] = xv; buf.y[fill] = yv; buf.z[fill] = zv;
        buf.chan[fill] = map.chan != null ? +f[map.chan] : 0;
        if (buf.cat) { const c = catCode.get((f[catCol] || '').trim()); buf.cat[fill] = c === undefined ? 0 : c; }
        if (buf.dim) { const key = `${r10(+f[dimInfo.cols.x])},${r10(+f[dimInfo.cols.y])},${r10(+f[dimInfo.cols.z])}`; const c = dimInfo.code.get(key); buf.dim[fill] = c === undefined ? 0 : c; }
        fill++;
        if (fill === chunkPoints) {
          yield { count: fill, x: buf.x, y: buf.y, z: buf.z, chan: buf.chan, cat: buf.cat, dim: buf.dim, recStart };
          recStart += fill; buf = alloc(); fill = 0;
        }
      }
    }
    if (fill) yield { count: fill, x: buf.x.subarray(0, fill), y: buf.y.subarray(0, fill), z: buf.z.subarray(0, fill), chan: buf.chan.subarray(0, fill), cat: buf.cat ? buf.cat.subarray(0, fill) : null, dim: buf.dim ? buf.dim.subarray(0, fill) : null, recStart };
  };
}

async function openBlockModel(blob, { mapping = null, discovered = null, sample = 512 * 1024, indexEvery = 1024, signal, onProgress } = {}) {
  // a cached discovery (project sidecars / channel re-streams): skip sweep 1
  // entirely — the header is rebuilt from the payload, sweep 2 streams as usual
  if (discovered) {
    const header = {
      ...discovered,
      bbox: { min: [...discovered.bbox.min], max: [...discovered.bbox.max] },
      index: discovered.index
        ? { k: discovered.index.k, offsets: discovered.index.offsets instanceof Float64Array ? discovered.index.offsets : Float64Array.from(discovered.index.offsets) }
        : undefined,
    };
    const map2 = header.mapping;
    const catCode2 = header.categories ? new Map(header.categories.map((v, i) => [v, i])) : null;
    // sub-blocked: rebuild the size-code map from the persisted half-dim palette (×2)
    const r10b = (v) => Number(v.toPrecision(10));
    const dimInfo2 = header.subBlocked && header.dimCols && header.dimPalette
      ? { cols: header.dimCols, code: new Map(header.dimPalette.map((hd, i) => [`${r10b(hd[0] * 2)},${r10b(hd[1] * 2)},${r10b(hd[2] * 2)}`, i])) }
      : null;
    return { header, streamChunks: makeDelimitedStream(blob, header.delim, header.hasHeaderRow, map2, map2.cat, catCode2, dimInfo2) };
  }
  const head = await blob.slice(0, Math.min(sample, blob.size)).text();
  const sniff = sniffDelimited(head);
  // headerless numeric files (XYZ dumps): columns 0/1/2 = x/y/z, a 4th numeric = the
  // scalar channel; names generated so schema/filter/autocomplete still work.
  if (!sniff.header && sniff.columns >= 3) {
    sniff.header = Array.from({ length: sniff.columns }, (_, i) => (i === 0 ? 'X' : i === 1 ? 'Y' : i === 2 ? 'Z' : `V${i + 1}`));
    sniff.generated = true;
    if (!mapping) mapping = { x: 0, y: 1, z: 2, chan: sniff.columns > 3 ? 3 : null, cat: null };
  }
  const map = mapping || mapColumns(sniff.header);
  if (!map) throw new Error('blockmodel: could not identify X/Y/Z centroid columns — pass a mapping');

  // mapColumns picks the channel BY NAME (first leftover column) — a text
  // column (XC,YC,ZC,LITO) would claim it, killing both the channel and the
  // category detection below (which skips map.chan). Demote a non-numeric
  // AUTO pick; an explicit mapping stays the caller's call.
  if (!mapping && map.chan != null && sniff.header) {
    const lines0 = head.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(1, 40);
    const split0 = splitter(sniff.delim);
    const vals0 = lines0.map((l) => (split0(l)[map.chan] || '').trim()).filter(Boolean);
    if (vals0.length && vals0.every((v) => Number.isNaN(Number(v)))) map.chan = null;
  }

  // auto category: first column whose head-sample values are all non-numeric
  let catCol = map.cat;
  if (catCol == null && sniff.header) {
    const lines = head.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(1, 40);
    const split = splitter(sniff.delim);
    for (let i = 0; i < sniff.columns && catCol == null; i++) {
      if (i === map.x || i === map.y || i === map.z || i === map.chan) continue;
      const vals = lines.map((l) => (split(l)[i] || '').trim()).filter(Boolean);
      if (vals.length && vals.every((v) => Number.isNaN(Number(v)))) catCol = i;
    }
  }

  // per-block dimension columns (DX/DY/DZ, XINC…) → the model may be SUB-BLOCKED
  // (variable box size). Discovery tracks the fine pitch (min dim/axis) + the
  // distinct (dx,dy,dz) triples that become the size-code palette.
  const dimCols = sniff.header ? { x: sniff.header.findIndex((h) => DIMX_RE.test(h.trim())), y: sniff.header.findIndex((h) => DIMY_RE.test(h.trim())), z: sniff.header.findIndex((h) => DIMZ_RE.test(h.trim())) } : { x: -1, y: -1, z: -1 };
  const hasDims = dimCols.x >= 0 && dimCols.y >= 0 && dimCols.z >= 0;
  const minDim = [Infinity, Infinity, Infinity];
  const dimSet = new Set();

  // ── sweep 1: discovery — axis distincts + extents + category dictionary ──
  const ax = [new Set(), new Set(), new Set()];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const catCounts = new Map();
  const round10 = (v) => Number(v.toPrecision(10));
  let count = 0;
  const hasHeaderRow = !!sniff.header && !sniff.generated;
  const anchors = [];                                      // sparse record index: byte offset of every indexEvery-th accepted row
  for await (const { fields, at } of lineFieldsWithOffsets(blob, sniff.delim, hasHeaderRow, { signal, onProgress })) {
    for (let fi = 0; fi < fields.length; fi++) {
      const f = fields[fi];
      const xv = +f[map.x], yv = +f[map.y], zv = +f[map.z];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
      if (count % indexEvery === 0) anchors.push(at[fi]);
      count++;
      if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
      if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
      if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
      if (ax[0].size < CAP_DISTINCT) ax[0].add(round10(xv));
      if (ax[1].size < CAP_DISTINCT) ax[1].add(round10(yv));
      if (ax[2].size < CAP_DISTINCT) ax[2].add(round10(zv));
      if (catCol != null && catCounts.size <= 256) { const v = (f[catCol] || '').trim(); if (v) catCounts.set(v, (catCounts.get(v) || 0) + 1); }
      if (hasDims) {
        const dx = +f[dimCols.x], dy = +f[dimCols.y], dz = +f[dimCols.z];
        if (dx > 0 && dy > 0 && dz > 0) {
          if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
          if (dimSet.size <= 300) dimSet.add(`${round10(dx)},${round10(dy)},${round10(dz)}`);
        }
      }
    }
  }

  const axes = ax.map((s) => (s.size < CAP_DISTINCT ? inferAxis([...s].sort((a, b) => a - b)) : null));
  let grid = axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;

  // ── sub-blocked detection ── dims vary → fine-lattice IJK (pitch = min dim /2,
  // so every power-of-2 sub-block centroid lands on it) + a size-code palette.
  // Off the fine lattice (non-power-of-2 splits) → leave it null → points fallback.
  let subBlocked = false, dimPalette = null, dimInfo = null;
  if (hasDims && dimSet.size > 1 && Number.isFinite(minDim[0])) {
    const finePitch = [minDim[0] / 2, minDim[1] / 2, minDim[2] / 2];
    const fineAxes = [0, 1, 2].map((a) => {
      if (ax[a].size >= CAP_DISTINCT || !(finePitch[a] > 0)) return null;
      const vals = [...ax[a]].sort((u, v) => u - v);
      const origin = vals[0], pitch = finePitch[a];
      const cnt = Math.round((vals[vals.length - 1] - origin) / pitch) + 1;
      if (cnt > 65535) return null;
      const eps = Math.max(pitch * 1e-3, Math.abs(origin) * 1e-6);
      for (const v of vals) if (Math.abs(origin + Math.round((v - origin) / pitch) * pitch - v) > eps) return null;
      return { origin, pitch, count: cnt };
    });
    if (fineAxes.every(Boolean)) {
      subBlocked = true;
      const dims = [...dimSet].slice(0, 256).map((k) => k.split(',').map(Number));
      dimPalette = dims.map(([dx, dy, dz]) => [dx / 2, dy / 2, dz / 2]);       // half-dims (box radius)
      dimInfo = { cols: dimCols, code: new Map(dims.map((d, i) => [`${round10(d[0])},${round10(d[1])},${round10(d[2])}`, i])) };
      grid = { x: fineAxes[0], y: fineAxes[1], z: fineAxes[2] };                // fine lattice → IJK
    }
  }
  const categories = catCol != null && catCounts.size > 0 && catCounts.size <= 255
    ? [...catCounts.keys()].sort() : null;
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;

  // every plausible scalar column (numeric in the head sample, not a coord/dim) —
  // the UI offers these as color channels; switching re-runs sweep 2 only.
  const numericColumns = [];
  if (sniff.header) {
    const lines2 = head.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).slice(1, 40);
    const split2 = splitter(sniff.delim);
    for (let i = 0; i < sniff.columns; i++) {
      if (i === map.x || i === map.y || i === map.z || DIM_RE.test(sniff.header[i].trim())) continue;
      const vals = lines2.map((l) => (split2(l)[i] || '').trim()).filter(Boolean);
      if (vals.length && vals.every((v) => !Number.isNaN(Number(v)))) numericColumns.push({ i, name: sniff.header[i] });
    }
  }
  const header = {
    kind: 'blockmodel', count,
    bbox: { min, max },
    grid,                                                   // null → not a regular grid (points fallback)
    subBlocked, dimPalette, dimCols: subBlocked ? dimCols : null,   // variable-size boxes: half-dim palette + size-code per block
    columns: sniff.header, mapping: { ...map, cat: categories ? catCol : null },
    delim: sniff.delim, hasHeaderRow,                       // for external sweeps (the filter mask)
    index: { k: indexEvery, offsets: Float64Array.from(anchors) },   // sparse line-offset index (fetchDelimitedRecord)
    numericColumns,
    categories,
    attributes: [
      ...(map.chan != null && sniff.header ? [sniff.header[map.chan]] : []),
      ...(categories && sniff.header ? [sniff.header[catCol]] : []),
    ],
  };

  // ── sweep 2 (cold recipe): the shared stream factory ──
  const streamChunks = makeDelimitedStream(blob, sniff.delim, hasHeaderRow, map, catCol, catCode, dimInfo);

  return { header, streamChunks };
}

// ── the TABLE provider: a delimited file with NO geometry ─────────────────────
// Not every table in a project is spatial — a join source, a parameter table, a
// cut-off/density lookup, a price deck, an analysis result. This reads one as a
// plain tabular document: columns, a row count, numeric-column detection, and
// the line index `fetchDelimitedRecord` needs. No coordinates, no bbox, no
// chunks — nothing here reaches the renderer.
async function openTable(blob, { signal, onProgress } = {}) {
  const sniff = sniffDelimited(await blob.slice(0, 64 * 1024).text());   // { delim, header: [names]|null, columns: n }
  const hasHeaderRow = !!sniff.header;
  const columns = sniff.header
    ? sniff.header.map((h, i) => String(h).trim() || `col${i + 1}`)
    : Array.from({ length: sniff.columns }, (_, i) => `col${i + 1}`);
  // one pass: count the rows and sample each column's type (a column is numeric
  // when ≥90% of its non-empty values parse — the same tolerance the block
  // provider uses, so mixed columns with a stray 'n/a' still read as numbers)
  const stat = columns.map(() => ({ n: 0, num: 0 }));
  let count = 0;
  for await (const batch of lineFields(blob, sniff.delim, hasHeaderRow, { signal, onProgress })) {
    for (const f of batch) {
      for (let i = 0; i < columns.length && i < f.length; i++) {
        const v = f[i];
        if (v === '' || v == null) continue;
        stat[i].n++;
        if (Number.isFinite(+v)) stat[i].num++;
      }
      count++;
    }
  }
  const numericColumns = [];
  for (let i = 0; i < columns.length; i++) if (stat[i].n && stat[i].num / stat[i].n >= 0.9) numericColumns.push({ i, name: columns[i] });
  // a table needs ROWS. Prose lands here with a plausible-looking delimiter and
  // no data — "0 rows · 10 columns" is not a table, it is a misread file.
  if (!count) throw new Error('no data rows — this does not look like a table');
  return { header: { table: true, columns, count, delim: sniff.delim, hasHeaderRow, numericColumns, mapping: null, grid: null, bbox: null } };
}

// ── ../drillhole/src/desurvey.js ──

// @gcu/drillhole — desurvey: collar + survey stations → the 3D hole trace, and a
// method-consistent position at any down-hole depth.
//
// Conventions (D1): azimuth = degrees clockwise from north; dip = MINING convention,
// positive DOWN (normalizeSurveys flips neg-down files; detectDipConvention infers
// from the median); depths/lengths in any consistent unit (metres in practice).
// World frame: x = east, y = north, z = up.
//
// Reverse-vendored from BMA (A7 Phase 0, Arthur 2026-06-11) — developed there in the
// concat-source style, always intended to live here. BMA + dee re-vendor from here now.

// Unit tangent from azimuth/dip (mining pos-down): x east, y north, z up.
function dhTangent$index(azDeg, dipDeg) {
  let az = azDeg * Math.PI / 180, dip = dipDeg * Math.PI / 180;
  let c = Math.cos(dip);
  return [Math.sin(az) * c, Math.cos(az) * c, -Math.sin(dip)];
}

// 'pos-down' (mining: +60 = 60° below horizontal) vs 'neg-down' (signed math: -60 =
// below). Inferred from the median dip — exploration holes point down, so the sign of
// the bulk tells the convention.
function dhDetectDipConvention$index(surveys) {
  let dips = [];
  for (let i = 0; i < surveys.length; i++) {
    let d = surveys[i].dip;
    if (typeof d === 'number' && isFinite(d) && d !== 0) dips.push(d);
  }
  if (dips.length === 0) return 'pos-down';
  dips.sort(function(a, b) { return a - b; });
  let med = dips[Math.floor(dips.length / 2)];
  return med < 0 ? 'neg-down' : 'pos-down';
}

// Sort, dedupe (last wins), normalize dip to pos-down, synthesize a station at depth 0
// when the list starts deeper (copies the first attitude). Returns { stations:
// [{depth, az, dip}], dupCount, badCount }.
function dhNormalizeSurveys$index(rawSurveys, dipConvention) {
  let flip = dipConvention === 'neg-down' ? -1 : 1;
  let clean = [], badCount = 0;
  for (let i = 0; i < rawSurveys.length; i++) {
    let s = rawSurveys[i];
    let depth = s.depth, az = s.az, dip = s.dip * flip;
    if (!isFinite(depth) || depth < 0 || !isFinite(az) || !isFinite(dip) || Math.abs(dip) > 90.000001) {
      badCount++;
      continue;
    }
    clean.push({ depth: depth, az: az, dip: dip });
  }
  clean.sort(function(a, b) { return a.depth - b.depth; });
  let stations = [], dupCount = 0;
  for (let j = 0; j < clean.length; j++) {
    if (stations.length && Math.abs(stations[stations.length - 1].depth - clean[j].depth) < 1e-9) {
      stations[stations.length - 1] = clean[j]; // last wins
      dupCount++;
    } else {
      stations.push(clean[j]);
    }
  }
  if (stations.length && stations[0].depth > 1e-9) {
    stations.unshift({ depth: 0, az: stations[0].az, dip: stations[0].dip });
  }
  return { stations: stations, dupCount: dupCount, badCount: badCount };
}

// Desurvey one hole. Methods:
// - 'minimumCurvature' (default): circular-arc model, RF = (2/θ)·tan(θ/2)
// - 'balancedTangential': the same without RF — averages the two end tangents per
//   segment (matches legacy desurveys from several packages)
// - 'tangential': straight segments along the LOWER station's attitude (sparse/legacy
//   surveys; matches dee's simple-tangential seed)
// collar = [x, y, z]; stations from dhNormalizeSurveys (pos-down). Returns { method,
// depths, px, py, pz, tx, ty, tz, dogleg, dls } — tangents + method ride along so
// dhPositionAt interpolates consistently. `dogleg[k]` is the angular change (degrees)
// between stations k−1 and k; `dls[k]` is the dogleg SEVERITY in °/30 length-units (the
// metric drilling-QC convention — multiply by ⅓ for °/10 m, or recompute from `dogleg`
// for °/100 ft). Both are geometry of the survey attitudes — independent of `method` —
// so they're the same whichever desurvey you pick. dogleg[0] = dls[0] = 0.
function dhDesurveyHole$index(collar, stations, method) {
  method = method || 'minimumCurvature';
  let n = stations.length;
  let out = {
    method: method,
    depths: new Float64Array(n),
    px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n),
    tx: new Float64Array(n), ty: new Float64Array(n), tz: new Float64Array(n),
    dogleg: new Float64Array(n), dls: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.depths[i] = stations[i].depth;
    let t = dhTangent$index(stations[i].az, stations[i].dip);
    out.tx[i] = t[0]; out.ty[i] = t[1]; out.tz[i] = t[2];
  }
  out.px[0] = collar[0]; out.py[0] = collar[1]; out.pz[0] = collar[2];

  for (let k = 1; k < n; k++) {
    let dl = out.depths[k] - out.depths[k - 1];
    // dogleg angle between the two station tangents — drives both the min-curvature RF
    // and the QC severity, and is the same for every method (it's the survey geometry).
    let dot = out.tx[k - 1] * out.tx[k] + out.ty[k - 1] * out.ty[k] + out.tz[k - 1] * out.tz[k];
    let doglegRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    out.dogleg[k] = doglegRad * 180 / Math.PI;
    out.dls[k] = dl > 1e-12 ? out.dogleg[k] / dl * 30 : 0;
    if (method === 'tangential') {
      out.px[k] = out.px[k - 1] + dl * out.tx[k];
      out.py[k] = out.py[k - 1] + dl * out.ty[k];
      out.pz[k] = out.pz[k - 1] + dl * out.tz[k];
    } else {
      let rf = 1; // balanced tangential
      // minimum curvature: RF = (2/θ)·tan(θ/2)
      if (method !== 'balancedTangential') rf = doglegRad > 1e-6 ? (2 / doglegRad) * Math.tan(doglegRad / 2) : 1;
      out.px[k] = out.px[k - 1] + 0.5 * dl * (out.tx[k - 1] + out.tx[k]) * rf;
      out.py[k] = out.py[k - 1] + 0.5 * dl * (out.ty[k - 1] + out.ty[k]) * rf;
      out.pz[k] = out.pz[k - 1] + 0.5 * dl * (out.tz[k - 1] + out.tz[k]) * rf;
    }
  }
  return out;
}

// Position at an arbitrary down-hole depth, consistent with the hole's desurvey method
// (depths between stations land on the SAME path the stations were placed on):
// - minimumCurvature: arc-correct (D2) — the closed-form integral of the slerp of the
//   end tangents: p(s) = p1 + L/(θ·sinθ)·[(cos(θ−φ) − cosθ)·d1 + (1 − cosφ)·d2],
//   φ = θ·s/L (at s = L this reduces to the RF endpoint formula; the harness pins
//   mid-segment points to an analytic circle at 1e-14)
// - tangential: straight along the lower station's attitude (how the segment was built)
// - balancedTangential: linear along the segment chord
// Beyond the last station: straight extrapolation along the last tangent (standard
// practice — intervals routinely outrun the survey).
function dhPositionAt$index(hole, depth) {
  let d = hole.depths, n = d.length;
  if (n === 0) return null;
  if (depth <= d[0]) {
    let s0 = depth - d[0]; // above collar station (negative) — straight
    return [hole.px[0] + s0 * hole.tx[0], hole.py[0] + s0 * hole.ty[0], hole.pz[0] + s0 * hole.tz[0]];
  }
  if (depth >= d[n - 1]) {
    let sE = depth - d[n - 1];
    return [hole.px[n - 1] + sE * hole.tx[n - 1], hole.py[n - 1] + sE * hole.ty[n - 1], hole.pz[n - 1] + sE * hole.tz[n - 1]];
  }
  // binary search: segment [lo, lo+1] with d[lo] <= depth < d[lo+1]
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    let mid = (lo + hi) >> 1;
    if (d[mid] <= depth) lo = mid; else hi = mid;
  }
  let L = d[lo + 1] - d[lo], s = depth - d[lo];
  if (L < 1e-12) return [hole.px[lo], hole.py[lo], hole.pz[lo]];

  if (hole.method === 'tangential') {
    return [
      hole.px[lo] + s * hole.tx[lo + 1],
      hole.py[lo] + s * hole.ty[lo + 1],
      hole.pz[lo] + s * hole.tz[lo + 1],
    ];
  }
  if (hole.method === 'balancedTangential') {
    let t = s / L;
    return [
      hole.px[lo] + t * (hole.px[lo + 1] - hole.px[lo]),
      hole.py[lo] + t * (hole.py[lo + 1] - hole.py[lo]),
      hole.pz[lo] + t * (hole.pz[lo + 1] - hole.pz[lo]),
    ];
  }

  let d1 = [hole.tx[lo], hole.ty[lo], hole.tz[lo]];
  let d2 = [hole.tx[lo + 1], hole.ty[lo + 1], hole.tz[lo + 1]];
  let dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  let theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (theta < 1e-9) {
    return [hole.px[lo] + s * d1[0], hole.py[lo] + s * d1[1], hole.pz[lo] + s * d1[2]];
  }
  let phi = theta * s / L;
  let kk = L / (theta * Math.sin(theta));
  let a = (Math.cos(theta - phi) - Math.cos(theta)) * kk;
  let b = (1 - Math.cos(phi)) * kk;
  return [
    hole.px[lo] + a * d1[0] + b * d2[0],
    hole.py[lo] + a * d1[1] + b * d2[1],
    hole.pz[lo] + a * d1[2] + b * d2[2],
  ];
}

// ── ../drillhole/src/validate.js ──

// @gcu/drillhole — validate: join + check the three tables. Nothing is silently
// dropped; every exclusion lands in the report with a count and a BHID list.
//
// The collar+survey join (dhJoinHoles) and per-hole station normalization
// (dhNormalizeHoleStations) are factored out so the point-sample locator
// (dhDesurveySamples) reuses the exact same hole-building — one join, two consumers.


// Build the per-hole structure from collars + surveys (NOT normalized yet — callers
// normalize only the holes that pass their own gate, so a skipped hole doesn't accrue
// advisory counts). Returns { holes: bhid→{bhid,collar,eoh,rawSurveys}, order: [] }.
function dhJoinHoles$index(tables, dipConvention, hit) {
  let holes = {}, order = [];
  for (let ci = 0; ci < (tables.collars || []).length; ci++) {
    let c0 = tables.collars[ci];
    let bid = String(c0.bhid).trim();
    if (!bid) { hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', null); continue; }
    if (!isFinite(c0.x) || !isFinite(c0.y) || !isFinite(c0.z)) {
      hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', bid);
      continue;
    }
    if (holes[bid]) { hit('dup-collar', 'Duplicate collar BHIDs (first kept)', bid); continue; }
    holes[bid] = { bhid: bid, collar: [c0.x, c0.y, c0.z], eoh: isFinite(c0.eoh) ? c0.eoh : null, rawSurveys: [] };
    order.push(bid);
  }
  for (let si = 0; si < (tables.surveys || []).length; si++) {
    let s0 = tables.surveys[si];
    let sb = String(s0.bhid).trim();
    let h = holes[sb];
    if (!h) { hit('orphan-survey', 'Survey rows whose BHID has no collar (excluded)', sb); continue; }
    h.rawSurveys.push({ depth: s0.depth, az: s0.az, dip: s0.dip });
  }
  return { holes: holes, order: order };
}

// Normalize one hole's raw surveys → hole.stations (pos-down, sorted, deduped, depth-0
// synthesized), with the no-usable-survey straight-down fallback and the survey-side
// past-EOH advisory. Counts ride into `hit`. Mutates + returns the hole.
function dhNormalizeHoleStations$index(hole, dipConvention, hit) {
  let norm = dhNormalizeSurveys$index(hole.rawSurveys, dipConvention);
  if (norm.badCount) for (let bi = 0; bi < norm.badCount; bi++) hit('bad-survey', 'Survey rows with non-numeric depth/azimuth or |dip| > 90 (excluded)', hole.bhid);
  if (norm.dupCount) for (let di = 0; di < norm.dupCount; di++) hit('dup-survey-depth', 'Duplicate survey depths in a hole (last kept)', hole.bhid);
  if (norm.stations.length === 0) {
    hit('collar-no-survey', 'Holes with no usable survey (desurveyed straight down)', hole.bhid);
    norm.stations = [{ depth: 0, az: 0, dip: 90 }];
  }
  hole.stations = norm.stations;
  if (hole.eoh != null && norm.stations[norm.stations.length - 1].depth > hole.eoh + 1e-9) {
    hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hole.bhid);
  }
  return hole;
}

// tables = {
//   collars:  [{ bhid, x, y, z, eoh }],            // eoh optional/null
//   surveys:  [{ bhid, depth, az, dip }],          // dip raw (per file)
//   intervals: { bhid: [], from: [], to: [],
//                cols: [{ name, type: 'num'|'cat', values: [] }] }
// }
// opts = { dipConvention: 'auto'|'pos-down'|'neg-down', method }
function dhValidate$index(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention$index(tables.surveys || []);

  let joined = dhJoinHoles$index(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].iv = [];

  // intervals
  let iv = tables.intervals || { bhid: [], from: [], to: [], cols: [] };
  let nIv = iv.bhid.length;
  for (let ii = 0; ii < nIv; ii++) {
    let ib = String(iv.bhid[ii]).trim();
    let h2 = holes[ib];
    if (!h2) { hit('orphan-interval', 'Interval rows whose BHID has no collar (excluded)', ib); continue; }
    let f = iv.from[ii], t = iv.to[ii];
    if (!isFinite(f) || !isFinite(t) || f < 0 || t <= f) {
      hit('bad-interval', 'Interval rows with FROM ≥ TO, negative or non-numeric depths (excluded)', ib);
      continue;
    }
    h2.iv.push(ii);
  }

  // per-hole structure (normalize only the holes that have intervals)
  let ready = [];
  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.iv.length === 0) { hit('collar-no-intervals', 'Collars with no interval rows (hole skipped)', hh.bhid); continue; }

    dhNormalizeHoleStations$index(hh, dipConvention, hit);

    // interval-side past-EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.iv.length; ei++) {
        if (iv.to[hh.iv[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    // overlap flag (composited as-is; SUPPORT double-counts — flagged per hole)
    let idx = hh.iv.slice().sort(function(a, b) { return iv.from[a] - iv.from[b]; });
    for (let vi = 1; vi < idx.length; vi++) {
      if (iv.from[idx[vi]] < iv.to[idx[vi - 1]] - 1e-9) {
        hit('overlap', 'Holes with overlapping intervals (composited as-is; SUPPORT double-counts)', hh.bhid);
        break;
      }
    }
    hh.iv = idx;
    ready.push(hh);
  }

  return { holes: ready, checks: checks, dipConvention: dipConvention, intervals: iv };
}

// ── ../drillhole/src/samples.js ──

// @gcu/drillhole — point-sample locator. Some data is point-support, not intervals:
// single-depth assays (handheld XRF, density readings) or already-composited samples
// re-imported. Compositing (length-weighting into windows) doesn't apply — you just
// want each sample placed in 3D on the desurveyed trace. This is that path; it reuses
// the same collar+survey join + station normalization as dhValidate.


// tables = { collars, surveys, samples: { bhid:[], depth:[], cols:[{name,type,values}] } }
// opts   = { dipConvention, method }
// Returns { header: ['BHID','X','Y','Z','DEPTH', ...cols], rows, report } — one located
// row per valid sample (sorted down-hole within each hole), with the same non-silent
// consistency report style as the interval pipeline.
function dhDesurveySamples$index(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention$index(tables.surveys || []);

  let joined = dhJoinHoles$index(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].smp = [];

  // samples → per-hole index lists
  let smp = tables.samples || { bhid: [], depth: [], cols: [] };
  let cols = smp.cols || [];
  let nS = smp.bhid.length;
  for (let ii = 0; ii < nS; ii++) {
    let bid = String(smp.bhid[ii]).trim();
    let h = holes[bid];
    if (!h) { hit('orphan-sample', 'Sample rows whose BHID has no collar (excluded)', bid); continue; }
    let d = smp.depth[ii];
    if (!isFinite(d) || d < 0) { hit('bad-sample', 'Sample rows with negative or non-numeric depth (excluded)', bid); continue; }
    h.smp.push(ii);
  }

  let header = ['BHID', 'X', 'Y', 'Z', 'DEPTH'];
  for (let hc = 0; hc < cols.length; hc++) header.push(cols[hc].name);
  let rows = [];
  let nHoles = 0;

  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.smp.length === 0) { hit('collar-no-samples', 'Collars with no sample rows (hole skipped)', hh.bhid); continue; }
    dhNormalizeHoleStations$index(hh, dipConvention, hit);
    let path = dhDesurveyHole$index(hh.collar, hh.stations, opts.method);
    nHoles++;

    // EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.smp.length; ei++) {
        if (smp.depth[hh.smp[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Sample depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    let idx = hh.smp.slice().sort(function(a, b) { return smp.depth[a] - smp.depth[b]; });
    for (let k = 0; k < idx.length; k++) {
      let ii = idx[k], d = smp.depth[ii];
      let pos = dhPositionAt$index(path, d);
      let row = [hh.bhid, pos[0], pos[1], pos[2], d];
      for (let c = 0; c < cols.length; c++) row.push(cols[c].values[ii]);
      rows.push(row);
    }
  }

  let checkList = [];
  for (let k in checks) checkList.push(checks[k]);
  return { header: header, rows: rows, report: { checks: checkList, nHoles: nHoles, nSamples: rows.length, dipConvention: dipConvention } };
}

// ── src/io/drillholes.js ──

// @gcu/condenser — drillhole provider: collar + survey + interval tables →
// desurveyed interval midpoints as an element layer (micro-layers spec §5).
// The math is @gcu/drillhole's (minimum curvature / balanced tangential /
// tangential, dip-convention detection, the non-silent consistency report);
// this module is table intake + the identity plumbing.
//
// THE IDENTITY: record N == interval-table row N. desurveySamples returns
// rows depth-sorted per hole, so a hidden __row column threads the original
// row index through — recIdx survives the sort, and pick/measure/filter all
// join back to the source assay row.
//
// Tables are read FULLY into memory (drillhole files are 10³–10⁶ rows — the
// streaming machinery is for the 10⁸ element tables), which also makes
// fetchRecord O(1) and channel switches free.


const BHID_RE = /^(bhid|holeid|hole_?id|dhid|dh_?id|hole|collar_?id|id)$/i;
const X_RE$drillholes = /^(x|xc|xcollar|east(ing)?|utm_?e)$/i;
const Y_RE$drillholes = /^(y|yc|ycollar|north(ing)?|utm_?n)$/i;
const Z_RE$drillholes = /^(z|zc|zcollar|elev(ation)?|rl)$/i;
const AT_RE = /^(at|depth|dist(ance)?|md|measured_?depth)$/i;
const AZ_RE = /^(az|azm|azim(uth)?|brg|bearing)$/i;
const DIP_RE = /^(dip|incl(ination)?|plunge)$/i;
const FROM_RE = /^(from|depfrom|depth_?from|de)$/i;
const TO_RE = /^(to|depto|depth_?to|a)$/i;
const EOH_RE = /^(eoh|depth|maxdepth|max_?depth|td|total_?depth|length)$/i;

const find = (header, re) => header.findIndex((h) => re.test(String(h).trim()));

// Classify one delimited header as collar / survey / intervals (or null).
// Survey and intervals are keyed on their unambiguous columns (AZ+DIP / FROM+TO);
// collar is BHID + coordinates. Returns { role, mapping }.
function classifyDrillholeHeader(header) {
  if (!header) return null;
  const bhid = find(header, BHID_RE);
  if (bhid < 0) return null;
  const from = find(header, FROM_RE), to = find(header, TO_RE);
  if (from >= 0 && to >= 0) return { role: 'intervals', mapping: { bhid, from, to } };
  const az = find(header, AZ_RE), dip = find(header, DIP_RE), at = find(header, AT_RE);
  if (az >= 0 && dip >= 0) return { role: 'survey', mapping: { bhid, at: at >= 0 ? at : -1, az, dip } };
  const x = find(header, X_RE$drillholes), y = find(header, Y_RE$drillholes), z = find(header, Z_RE$drillholes);
  if (x >= 0 && y >= 0 && z >= 0) {
    let eoh = -1;
    header.forEach((h, i) => { if (eoh < 0 && i !== x && i !== y && i !== z && EOH_RE.test(String(h).trim())) eoh = i; });
    return { role: 'collar', mapping: { bhid, x, y, z, eoh } };
  }
  return null;
}

// Read a delimited blob fully: { columns, rows } (field arrays, header skipped).
async function readDelimited(blob, { sample = 256 * 1024 } = {}) {
  const head = await blob.slice(0, Math.min(sample, blob.size)).text();
  const sniff = sniffDelimited(head);
  if (!sniff.header) throw new Error('drillholes: table has no header row');
  const rows = [];
  for await (const batch of lineFields(blob, sniff.delim, true)) {
    for (const f of batch) rows.push(f);
  }
  return { columns: sniff.header.map((c) => String(c).trim()), rows };
}

// Sniff a set of blobs into drillhole roles. Returns { collar, survey,
// intervals } of { blob, name, columns, mapping } when all three distinct
// roles are present, else null.
async function sniffDrillholeFiles(files) {
  const out = {};
  for (const f of files) {
    let sniff;
    try { sniff = sniffDelimited(await f.slice(0, 64 * 1024).text()); } catch { continue; }
    const cls = classifyDrillholeHeader(sniff.header);
    if (cls && !out[cls.role]) out[cls.role] = { blob: f, name: f.name || cls.role, columns: sniff.header.map((c) => String(c).trim()), mapping: cls.mapping };
  }
  return out.collar && out.survey && out.intervals ? out : null;
}

/**
 * openDrillholes({ collar, survey, intervals }, opts) — each input is a Blob.
 * opts: mappings { collar: {bhid,x,y,z,eoh}, survey: {bhid,at,az,dip},
 * intervals: {bhid,from,to} } (sniffed when omitted), method
 * ('minimumCurvature' | 'balancedTangential' | 'tangential'), dipConvention
 * ('auto' | 'pos-down' | 'neg-down'), chan (interval column index for the
 * grade channel; default = first numeric non-key column), cat (category
 * column index; default = first all-text non-key column).
 *
 * → { header, streamChunks, fetchRecord }
 *   header = { kind:'drillholes', count (ORIGINAL interval rows), bbox,
 *              columns, mapping {chan, cat}, numericColumns, categories,
 *              attributes, report, method, dipConvention, holes }
 *   RawChunk = { count, x, y, z, chan, cat, recIdx } (blockmodel shape —
 *              the page's centroids-as-points path renders it)
 *   fetchRecord(rec) → the ORIGINAL interval row (O(1), in memory)
 */
async function openDrillholes({ collar, survey, intervals }, opts = {}) {
  const tCollar = await readDelimited(collar);
  const tSurvey = await readDelimited(survey);
  const tIv = await readDelimited(intervals);
  const m = {
    collar: (opts.mappings && opts.mappings.collar) || (classifyDrillholeHeader(tCollar.columns) || {}).mapping,
    survey: (opts.mappings && opts.mappings.survey) || (classifyDrillholeHeader(tSurvey.columns) || {}).mapping,
    intervals: (opts.mappings && opts.mappings.intervals) || (classifyDrillholeHeader(tIv.columns) || {}).mapping,
  };
  if (!m.collar || m.collar.x == null) throw new Error('drillholes: collar columns not identified (need BHID + X/Y/Z)');
  if (!m.survey || m.survey.az == null) throw new Error('drillholes: survey columns not identified (need BHID + AZ + DIP)');
  if (!m.intervals || m.intervals.from == null) throw new Error('drillholes: interval columns not identified (need BHID + FROM + TO)');

  // @gcu/drillhole table shapes
  const collars = tCollar.rows.map((r) => ({
    bhid: r[m.collar.bhid], x: +r[m.collar.x], y: +r[m.collar.y], z: +r[m.collar.z],
    eoh: m.collar.eoh >= 0 ? +r[m.collar.eoh] : undefined,
  }));
  const surveys = tSurvey.rows.map((r) => ({
    bhid: r[m.survey.bhid], depth: m.survey.at >= 0 ? +r[m.survey.at] : 0, az: +r[m.survey.az], dip: +r[m.survey.dip],
  }));

  const n = tIv.rows.length;
  const keyCols = new Set([m.intervals.bhid, m.intervals.from, m.intervals.to]);
  // numeric / categorical detection over a head sample of the interval table
  const probe = tIv.rows.slice(0, 200);
  const numericCols = [], textCols = [];
  tIv.columns.forEach((name, i) => {
    if (keyCols.has(i)) return;
    const vals = probe.map((r) => (r[i] || '').trim()).filter(Boolean);
    if (!vals.length) return;
    if (vals.every((v) => !Number.isNaN(Number(v)))) numericCols.push({ i, name });
    else if (vals.every((v) => Number.isNaN(Number(v)))) textCols.push({ i, name });
  });
  const chan = opts.chan != null ? opts.chan : (numericCols[0] ? numericCols[0].i : null);
  const catCol = opts.cat != null ? opts.cat : (textCols[0] ? textCols[0].i : null);

  // samples = BOTH interval endpoints (2 per row): the desurveyed FROM and TO
  // positions are the capsule segment, arc-correct via positionAt; the render
  // midpoint derives as (A+B)/2. __row + __end thread the source row and
  // which endpoint through the per-hole depth sort (the identity).
  const bhid = new Array(2 * n), depth = new Float64Array(2 * n);
  const rowIdx = new Float64Array(2 * n), endIdx = new Float64Array(2 * n);
  const chanVals = new Float64Array(n), catVals = catCol != null ? new Array(n) : null;
  const catCounts = new Map();
  for (let i = 0; i < n; i++) {
    const r = tIv.rows[i];
    const hb = r[m.intervals.bhid];
    bhid[2 * i] = hb; bhid[2 * i + 1] = hb;
    depth[2 * i] = +r[m.intervals.from]; depth[2 * i + 1] = +r[m.intervals.to];
    rowIdx[2 * i] = i; rowIdx[2 * i + 1] = i;
    endIdx[2 * i] = 0; endIdx[2 * i + 1] = 1;
    chanVals[i] = chan != null ? +r[chan] : 0;
    if (catVals) { const v = (r[catCol] || '').trim(); catVals[i] = v; if (v && catCounts.size <= 256) catCounts.set(v, (catCounts.get(v) || 0) + 1); }
  }
  const samples = { bhid, depth, cols: [{ name: '__row', values: rowIdx }, { name: '__end', values: endIdx }] };

  const ds = dhDesurveySamples$index({ collars, surveys, samples }, { method: opts.method || 'minimumCurvature', dipConvention: opts.dipConvention || 'auto' });

  // the interval-shape checks (overlaps, inverted from/to…) come from validate
  const iv = {
    bhid, from: tIv.rows.map((r) => +r[m.intervals.from]), to: tIv.rows.map((r) => +r[m.intervals.to]), cols: [],
  };
  let report = ds.report;
  try {
    const v = dhValidate$index({ collars, surveys, intervals: iv }, { dipConvention: opts.dipConvention || 'auto' });
    const seen = new Set(report.checks.map((c) => c.id));
    const extra = Object.values(v.checks || {}).filter((c) => !seen.has(c.id));
    report = { ...report, checks: report.checks.concat(extra) };
  } catch { /* validate's report is a bonus, not a gate */ }

  const categories = catCounts.size > 0 && catCounts.size <= 255 ? [...catCounts.keys()].sort() : null;
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;

  // pair the placed endpoints back into SEGMENTS keyed by source row
  const endA = new Map(), endB = new Map();               // src row → [x,y,z]
  for (let k = 0; k < ds.rows.length; k++) {
    const row = ds.rows[k];
    const src = row[5] | 0, end = row[6] | 0;             // __row, __end
    (end === 0 ? endA : endB).set(src, [row[1], row[2], row[3]]);
  }
  const placedRows = [];
  for (const [src, a] of endA) if (endB.has(src)) placedRows.push(src);
  placedRows.sort((x, y) => x - y);
  const nP = placedRows.length;
  const ax = new Float64Array(nP), ay = new Float64Array(nP), az = new Float64Array(nP);
  const bx = new Float64Array(nP), by = new Float64Array(nP), bz = new Float64Array(nP);
  const px = new Float64Array(nP), py = new Float64Array(nP), pz = new Float64Array(nP);
  const pChan = new Float64Array(nP), pCat = catCode ? new Uint8Array(nP) : null;
  const pRec = new Uint32Array(nP);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < nP; k++) {
    const src = placedRows[k];
    const A = endA.get(src), B = endB.get(src);
    ax[k] = A[0]; ay[k] = A[1]; az[k] = A[2];
    bx[k] = B[0]; by[k] = B[1]; bz[k] = B[2];
    px[k] = (A[0] + B[0]) / 2; py[k] = (A[1] + B[1]) / 2; pz[k] = (A[2] + B[2]) / 2;
    pChan[k] = Number.isFinite(chanVals[src]) ? chanVals[src] : 0;
    if (pCat) { const c = catCode.get(catVals[src]); pCat[k] = c === undefined ? 0 : c; }
    pRec[k] = src;
    for (let a2 = 0; a2 < 3; a2++) {
      if (A[a2] < min[a2]) min[a2] = A[a2]; if (A[a2] > max[a2]) max[a2] = A[a2];
      if (B[a2] < min[a2]) min[a2] = B[a2]; if (B[a2] > max[a2]) max[a2] = B[a2];
    }
  }

  let cLo = Infinity, cHi = -Infinity;
  for (let k = 0; k < nP; k++) { const v = pChan[k]; if (v < cLo) cLo = v; if (v > cHi) cHi = v; }
  const header = {
    kind: 'drillholes', count: n,
    bbox: { min, max },
    chanRange: [cLo === Infinity ? 0 : cLo, cHi === -Infinity ? 1 : cHi],
    columns: tIv.columns,
    mapping: { x: -1, y: -1, z: -1, chan, cat: categories ? catCol : null },
    intervalMapping: m.intervals,                          // resolved bhid/from/to (role badges + joins)
    // the collar/survey tables, so a host can re-map their columns and
    // re-desurvey — the interval table above is only a third of the mapping
    collarColumns: tCollar.columns, surveyColumns: tSurvey.columns,
    collarMapping: m.collar, surveyMapping: m.survey,
    numericColumns: numericCols,
    categories,
    attributes: [
      ...(chan != null ? [tIv.columns[chan]] : []),
      ...(categories ? [tIv.columns[catCol]] : []),
    ],
    report, method: opts.method || 'minimumCurvature', dipConvention: report.dipConvention,
    holes: report.nHoles, placed: nP,
  };

  async function* streamChunks({ chunkPoints = 1 << 18 } = {}) {
    for (let at = 0; at < nP; at += chunkPoints) {
      const k = Math.min(chunkPoints, nP - at);
      yield {
        count: k,
        // midpoints (points mode / section center / measure)
        x: px.subarray(at, at + k), y: py.subarray(at, at + k), z: pz.subarray(at, at + k),
        // segment endpoints (sticks mode)
        ax: ax.subarray(at, at + k), ay: ay.subarray(at, at + k), az: az.subarray(at, at + k),
        bx: bx.subarray(at, at + k), by: by.subarray(at, at + k), bz: bz.subarray(at, at + k),
        chan: pChan.subarray(at, at + k), cat: pCat ? pCat.subarray(at, at + k) : null,
        recIdx: pRec.subarray(at, at + k),
      };
    }
  }

  const fetchRecord = (rec) => (rec >= 0 && rec < n ? tIv.rows[rec] : null);
  // the placed midpoint of a source row (measure across layers) — null for
  // rows that never placed (orphans)
  const recToPlaced = new Map();
  for (let k = 0; k < nP; k++) recToPlaced.set(pRec[k], k);
  const recordPosition = (rec) => {
    const k = recToPlaced.get(rec >>> 0);
    return k === undefined ? null : [px[k], py[k], pz[k]];
  };

  return { header, streamChunks, fetchRecord, recordPosition };
}

/**
 * openDrillholeTraces({ collar, survey }, opts) — the bare hole PATHS: each
 * hole's collar→EOH trace desurveyed at its survey stations (+ 0 and EOH),
 * rendered as consecutive stick SEGMENTS. recIdx = the collar row (a hole), so
 * pick → the collar record. No interval data — this is the geometry a set owns,
 * so a drillhole set shows full coverage even where an assay table has gaps.
 * → { header, streamChunks, fetchRecord } — RawChunk in the sticks shape.
 */
async function openDrillholeTraces({ collar, survey }, opts = {}) {
  const tCollar = await readDelimited(collar);
  const tSurvey = await readDelimited(survey);
  const mc = (opts.mappings && opts.mappings.collar) || (classifyDrillholeHeader(tCollar.columns) || {}).mapping;
  const ms = (opts.mappings && opts.mappings.survey) || (classifyDrillholeHeader(tSurvey.columns) || {}).mapping;
  if (!mc || mc.x == null) throw new Error('drillhole traces: collar columns not identified (need BHID + X/Y/Z)');
  if (!ms || ms.az == null) throw new Error('drillhole traces: survey columns not identified (need BHID + AZ + DIP)');
  const collars = tCollar.rows.map((r) => ({
    bhid: r[mc.bhid], x: +r[mc.x], y: +r[mc.y], z: +r[mc.z], eoh: mc.eoh >= 0 ? +r[mc.eoh] : undefined,
  }));
  const surveys = tSurvey.rows.map((r) => ({ bhid: r[ms.bhid], depth: ms.at >= 0 ? +r[ms.at] : 0, az: +r[ms.az], dip: +r[ms.dip] }));

  // per hole: sample depths = {0} ∪ survey station depths ∪ {EOH}; EOH from the
  // collar when present, else the deepest survey station
  const depthsOf = new Map(), holeIdx = new Map(), maxSurvey = new Map();
  collars.forEach((c, i) => { if (!depthsOf.has(c.bhid)) { depthsOf.set(c.bhid, new Set([0])); holeIdx.set(c.bhid, i); } });
  for (const s of surveys) { if (depthsOf.has(s.bhid)) { depthsOf.get(s.bhid).add(s.depth); maxSurvey.set(s.bhid, Math.max(maxSurvey.get(s.bhid) || 0, s.depth)); } }
  for (const c of collars) { if (depthsOf.has(c.bhid)) { const eoh = c.eoh != null && Number.isFinite(c.eoh) ? c.eoh : maxSurvey.get(c.bhid); if (eoh) depthsOf.get(c.bhid).add(eoh); } }

  const sBhid = [], sDepth = [], sRow = [], sSeq = [];
  for (const [hb, ds] of depthsOf) {
    const sorted = [...ds].filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
    sorted.forEach((d, k) => { sBhid.push(hb); sDepth.push(d); sRow.push(holeIdx.get(hb)); sSeq.push(k); });
  }
  const samples = { bhid: sBhid, depth: Float64Array.from(sDepth), cols: [{ name: '__row', values: Float64Array.from(sRow) }, { name: '__seq', values: Float64Array.from(sSeq) }] };
  const ds = dhDesurveySamples$index({ collars, surveys, samples }, { method: opts.method || 'minimumCurvature', dipConvention: opts.dipConvention || 'auto' });

  // group placed points by hole, order by __seq, connect consecutive → segments
  const perHole = new Map();
  for (const row of ds.rows) { const hi = row[5] | 0, sq = row[6] | 0; if (!perHole.has(hi)) perHole.set(hi, []); perHole.get(hi).push([sq, row[1], row[2], row[3]]); }
  let nSeg = 0;
  for (const pts of perHole.values()) { pts.sort((a, b) => a[0] - b[0]); nSeg += Math.max(0, pts.length - 1); }
  const ax = new Float64Array(nSeg), ay = new Float64Array(nSeg), az = new Float64Array(nSeg);
  const bx = new Float64Array(nSeg), by = new Float64Array(nSeg), bz = new Float64Array(nSeg);
  const px = new Float64Array(nSeg), py = new Float64Array(nSeg), pz = new Float64Array(nSeg);
  const pChan = new Float64Array(nSeg), pRec = new Uint32Array(nSeg);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let si = 0;
  for (const [hi, pts] of perHole) {
    for (let k = 0; k + 1 < pts.length; k++, si++) {
      const a = pts[k], b = pts[k + 1];
      ax[si] = a[1]; ay[si] = a[2]; az[si] = a[3]; bx[si] = b[1]; by[si] = b[2]; bz[si] = b[3];
      px[si] = (a[1] + b[1]) / 2; py[si] = (a[2] + b[2]) / 2; pz[si] = (a[3] + b[3]) / 2;
      pRec[si] = hi; pChan[si] = 0;
      for (const pt of [a, b]) for (let d = 0; d < 3; d++) { const v = pt[d + 1]; if (v < min[d]) min[d] = v; if (v > max[d]) max[d] = v; }
    }
  }
  const header = {
    kind: 'drillholeTraces', count: nSeg, holes: depthsOf.size,
    bbox: { min, max }, chanRange: [0, 1],
    columns: tCollar.columns, collarMapping: mc, surveyMapping: ms,
    method: opts.method || 'minimumCurvature', dipConvention: ds.report ? ds.report.dipConvention : (opts.dipConvention || 'auto'),
  };
  async function* streamChunks({ chunkPoints = 1 << 16 } = {}) {
    for (let at = 0; at < nSeg; at += chunkPoints) {
      const k = Math.min(chunkPoints, nSeg - at);
      yield {
        count: k,
        x: px.subarray(at, at + k), y: py.subarray(at, at + k), z: pz.subarray(at, at + k),
        ax: ax.subarray(at, at + k), ay: ay.subarray(at, at + k), az: az.subarray(at, at + k),
        bx: bx.subarray(at, at + k), by: by.subarray(at, at + k), bz: bz.subarray(at, at + k),
        chan: pChan.subarray(at, at + k), cat: null, recIdx: pRec.subarray(at, at + k),
      };
    }
  }
  const fetchRecord = (rec) => (rec >= 0 && rec < tCollar.rows.length ? tCollar.rows[rec] : null);
  // a trace record is a hole; its position is the collar (endpoint 0). Coarse
  // but correct — the same "fall back to the centroid" the picker uses when a hit
  // has no face. Was a hard `() => null`, which made Measure silently no-op on a
  // trace segment.
  const recordPosition = (rec) => {
    const c = collars[rec];
    return c && Number.isFinite(c.x) ? [c.x, c.y, c.z] : null;
  };
  return { header, streamChunks, fetchRecord, recordPosition };
}

// ── src/core/sticks.js ──

// @gcu/condenser — stick chunks: drillhole interval SEGMENTS (desurveyed
// endpoint pairs) as instanced capsule impostors (micro-layers spec §6).
// Same chunk discipline as blocks/points: batch-Morton on the midpoints,
// intra-chunk shuffle (any prefix = a uniform subsample), per-chunk channel
// quantization. Coordinates stay Float32 frame-local — stick counts are
// 10³–10⁶, so the uint16 squeeze isn't needed and endpoints stay exact
// to ~mm at frame-local magnitudes.


/**
 * Build one StickChunk from columnar world-space endpoints + attributes.
 * raw = { ax..az, bx..bz (endpoints), x,y,z (midpoints), chan, cat, recIdx }.
 * `indices` = optional gather list (a Morton slice); shuffled like the others.
 */
function buildStickChunk(raw, frame, rnd, indices = null) {
  const n = indices ? indices.length : raw.x.length;
  const o = frame.origin;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const seg = new Float32Array(6 * n);                     // ax ay az bx by bz, frame-local
  const outChan = new Uint16Array(n), outCat = new Uint8Array(n), outR = new Uint32Array(n);
  let cMin = Infinity, cMax = -Infinity;
  for (let k = 0; k < n; k++) { const v = raw.chan[perm[k]]; if (Number.isFinite(v)) { if (v < cMin) cMin = v; if (v > cMax) cMax = v; } }
  if (!Number.isFinite(cMin)) { cMin = 0; cMax = 0; }
  const cScale = cMax > cMin ? 65535 / (cMax - cMin) : 0;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    const A = [raw.ax[i] - o[0], raw.ay[i] - o[1], raw.az[i] - o[2]];
    const B = [raw.bx[i] - o[0], raw.by[i] - o[1], raw.bz[i] - o[2]];
    seg[k * 6] = A[0]; seg[k * 6 + 1] = A[1]; seg[k * 6 + 2] = A[2];
    seg[k * 6 + 3] = B[0]; seg[k * 6 + 4] = B[1]; seg[k * 6 + 5] = B[2];
    for (let a = 0; a < 3; a++) {
      if (A[a] < bb[a]) bb[a] = A[a]; if (A[a] > bb[a + 3]) bb[a + 3] = A[a];
      if (B[a] < bb[a]) bb[a] = B[a]; if (B[a] > bb[a + 3]) bb[a + 3] = B[a];
    }
    const cv = raw.chan[i];
    outChan[k] = Number.isFinite(cv) ? ((cv - cMin) * cScale + 0.5) | 0 : 0;
    outCat[k] = raw.cat ? raw.cat[i] : 0;
    outR[k] = raw.recIdx[i];
  }
  // NB: the culling bbox covers the SEGMENTS; the renderer pads it by the
  // current stick radius at cull time (the radius is a live per-layer knob).
  return { kind: 'sticks', count: n, seg, chan: outChan, chanRange: [cMin, cMax], cat: outCat, recIdx: outR, bboxLocal: Float64Array.from(bb) };
}

// Exact midpoint of element k, frame-local (tests + pick verification).
function stickLocalCenter(chunk, k) {
  const s = chunk.seg;
  return [(s[k * 6] + s[k * 6 + 3]) / 2, (s[k * 6 + 1] + s[k * 6 + 4]) / 2, (s[k * 6 + 2] + s[k * 6 + 5]) / 2];
}

/**
 * StickChunkBuilder — the blocks builder's shape over segment RawChunks
 * ({ count, ax..bz, x,y,z, chan, cat, recIdx }). Batch-Morton on midpoints,
 * sliced, shuffled.
 */
function createStickChunkBuilder({ frame, chunkSize = 1 << 17, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
    chanRange: [Infinity, -Infinity],
  };
  const concat = (Type, parts) => {
    const out = new Type(parts.reduce((t, p) => t + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {
      ax: concat(Float64Array, pend.map((p) => p.ax)), ay: concat(Float64Array, pend.map((p) => p.ay)), az: concat(Float64Array, pend.map((p) => p.az)),
      bx: concat(Float64Array, pend.map((p) => p.bx)), by: concat(Float64Array, pend.map((p) => p.by)), bz: concat(Float64Array, pend.map((p) => p.bz)),
      x: concat(Float64Array, pend.map((p) => p.x)), y: concat(Float64Array, pend.map((p) => p.y)), z: concat(Float64Array, pend.map((p) => p.z)),
      chan: concat(Float64Array, pend.map((p) => p.chan)),
      cat: pend.every((p) => p.cat) ? concat(Uint8Array, pend.map((p) => p.cat)) : null,
      recIdx: concat(Uint32Array, pend.map((p) => p.recIdx)),
    };
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildStickChunk(cols, frame, rnd, slice);
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      if (chunk.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = chunk.chanRange[0];
      if (chunk.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = chunk.chanRange[1];
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      let recIdx = raw.recIdx;
      if (!recIdx) {
        recIdx = new Uint32Array(raw.count);
        for (let i = 0; i < raw.count; i++) recIdx[i] = (raw.recStart || 0) + i;
      }
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const s = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ ax: s(raw.ax), ay: s(raw.ay), az: s(raw.az), bx: s(raw.bx), by: s(raw.by), bz: s(raw.bz), x: s(raw.x), y: s(raw.y), z: s(raw.z), chan: s(raw.chan), cat: s(raw.cat), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// ── src/core/gl-util.js ──

// @gcu/condenser — shared GL scaffolding (used by the splat + impostor pipelines).
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('condenser shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function makeProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('condenser link: ' + gl.getProgramInfoLog(p));
  return p;
}

// ── src/core/gl-sticks.js ──

// @gcu/condenser — capsule impostors for drillhole sticks (micro-layers §6).
// gl-blocks' trick with a different intersection: one instanced quad per
// SEGMENT, billboarded to enclose the capsule's silhouette (spanned by the
// segment axis and the axis⊥view direction), fragment ray-capsule test with a
// real gl_FragDepth + surface normal (headlight shading). <2px → splat
// demotion; a cheap no-gl_FragDepth program serves fully-demoted far chunks.
// Radius is a live per-layer uniform (world meters) — the "stick thickness"
// knob. Mask / section / picked-glow / repaint identical to blocks.


// 4×4-Bayer screen-door opacity (see gl-mesh / gl-blocks): see-through without
// alpha blending — real depth writes stay correct, no back-to-front sort.
const SCREENDOOR$gl_sticks = `
uniform float uOpacity;
const float _BAYER[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
bool _screendoor() { if (uOpacity >= 0.999) return false; int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2); return uOpacity < (_BAYER[bi] + 0.5) / 16.0; }`;

const VERT$gl_sticks = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;          // segment start, frame-local
layout(location=1) in vec3 aB;          // segment end
layout(location=2) in float aChan;      // uint16 normalized (per-chunk range)
layout(location=3) in float aCat;       // uint8 raw
layout(location=4) in uint aRec;        // uint32 partitioned record id
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uRadius;                  // stick radius, world meters
uniform float uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform vec3 uFwd;
uniform int uColorMode;                 // 0 elevation | 1 channel | 2 category | 3 solid
uniform vec2 uZRange;
uniform vec2 uChanChunk;                // chunk chan min/span (dequantize)
uniform vec2 uChanDoc;                  // doc chan min/span (ramp)
uniform sampler2D uRamp;
uniform sampler2D uPalette;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uSel;
uniform float uSelOn;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code replaces the category
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)
uniform uvec2 uRepaint;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vA;
flat out vec3 vB;
flat out vec4 vColor;
flat out float vMode;                   // 0 = capsule, 1 = splat
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = (aA + aB) * 0.5;
  vec3 axis = aB - aA;
  float len = max(length(axis), 1e-6);
  vec3 u = axis / len;
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  vec3 viewDir = uOrtho > 0.5 ? uFwd : (center - uEye) / dist;
  // quad plane: the segment axis × the axis-perpendicular-to-view — encloses
  // the capsule silhouette. Axis ∥ view → any perpendicular works.
  vec3 v = cross(u, viewDir);
  float vl = length(v);
  v = vl > 1e-4 ? v / vl : normalize(abs(u.z) < 0.9 ? cross(u, vec3(0.0, 0.0, 1.0)) : cross(u, vec3(1.0, 0.0, 0.0)));
  float pxR = (len * 0.5 + uRadius) * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // section cull: keep any capsule that TOUCHES the slab (segment support along
  // the normal + radius) — the fragment shader clips exactly (see gl-blocks).
  float secSupp = demoted > 0.5 ? 0.0 : (abs(dot(axis, uSecPlane.xyz)) * 0.5 + uRadius);
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp) ? 1.0 : 0.0;
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp;
  if (demoted > 0.5) {                                   // splat: camera-facing square at the center
    float quadR = max(uPointPx * 0.5, min(pxR, uPointPx * 2.0)) * distEff / uPerspScale;
    vec3 sv = normalize(cross(viewDir, v));
    wp = center + (v * corner.x + sv * corner.y) * quadR;
  } else {
    wp = center + u * (corner.x * (len * 0.5 + uRadius)) + v * (corner.y * uRadius);
  }
  gl_Position = uViewProj * vec4(wp, 1.0);
  vA = aA; vB = aB; vMode = demoted; vCorner = corner; vWorldPos = wp;
  if (uColorMode == 0) {
    float t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 1) {
    float cv = uChanChunk.x + aChan * uChanChunk.y;
    float t = clamp((cv - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / 256.0, 0.5));
  } else {
    vColor = vec4(0.62, 0.63, 0.66, 1.0);
  }
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    if (texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const FRAG$gl_sticks = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform float uRadius;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
out vec4 outColor;
${SCREENDOOR$gl_sticks}
void main() {
  if (vCull > 0.5) discard;
  if (_screendoor()) discard;           // per-layer opacity (screen-door)
  if (vMode > 0.5) {                    // demoted splat
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outColor = vColor;
    return;
  }
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  // ray-capsule (body cylinder + cap spheres)
  vec3 ba = vB - vA;
  vec3 oa = ro - vA;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - uRadius * uRadius * baba;
  float h = b * b - a * c;
  float t = -1.0;
  vec3 n = vec3(0.0);
  if (h >= 0.0) {
    float tb = (-b - sqrt(h)) / max(a, 1e-9);
    float y = baoa + tb * bard;
    if (y > 0.0 && y < baba && tb > 0.0) {
      t = tb;
      vec3 p = ro + rd * t;
      n = (p - vA - ba * (y / baba)) / uRadius;
    }
  }
  if (t < 0.0) {                        // the caps: try both, keep the nearest forward hit
    for (int i = 0; i < 2; i++) {
      vec3 capC = i == 0 ? vA : vB;
      vec3 o2 = ro - capC;
      float b2 = dot(rd, o2);
      float c2 = dot(o2, o2) - uRadius * uRadius;
      float h2 = b2 * b2 - c2;
      if (h2 >= 0.0) {
        float t2 = -b2 - sqrt(h2);
        if (t2 > 0.0 && (t < 0.0 || t2 < t)) {
          t = t2;
          n = (ro + rd * t2 - capC) / uRadius;
        }
      }
    }
  }
  if (t < 0.0) discard;
  // TRUE SECTION on the capsule (convex, so one inside-test at the slab face is
  // exact): a hit outside the slab either becomes the flat cut CROSS-SECTION at
  // the face, or the capsule never overlaps the slab and the pixel is gone.
  float cutFace = 0.0;
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(dc + t * den) > uSecCfg.y) {
      if (abs(den) < 1e-9) discard;
      float sIn = min((-uSecCfg.y - dc) / den, (uSecCfg.y - dc) / den);
      if (sIn <= t) discard;                               // hit past the slab exit
      vec3 q = ro + rd * sIn;                              // at the slab face: still inside?
      vec3 qa = q - vA;
      float yq = clamp(dot(qa, ba) / baba, 0.0, 1.0);
      if (length(qa - ba * yq) > uRadius) discard;
      t = sIn;
      n = uSecPlane.xyz * -sign(den);
      cutFace = 1.0;
    }
  }
  vec3 p = ro + rd * t;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  float shade = (0.55 + 0.45 * max(dot(n, uLightDir), 0.0)) * (cutFace > 0.5 ? 0.85 : 1.0);
  outColor = vec4(vColor.rgb * shade, vColor.a);
}`;

const FRAG_CHEAP$gl_sticks = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
out vec4 outColor;
${SCREENDOOR$gl_sticks}
void main() {
  if (vCull > 0.5) discard;
  if (_screendoor()) discard;
  if (dot(vCorner, vCorner) > 1.0) discard;
  outColor = vColor;
}`;

function createSticksPipeline(gl) {
  const mkProg = (frag) => {
    const prog = makeProgram(gl, VERT$gl_sticks, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), eye: U('uEye'), radius: U('uRadius'), opacity: U('uOpacity'),
      perspScale: U('uPerspScale'), demotePx: U('uDemotePx'), pointPx: U('uPointPx'), fixedSplat: U('uFixedSplat'),
      colorMode: U('uColorMode'), zRange: U('uZRange'), chanChunk: U('uChanChunk'), chanDoc: U('uChanDoc'),
      ramp: U('uRamp'), palette: U('uPalette'), lightDir: U('uLightDir'),
      mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
      catVis: U('uCatVis'), catVisOn: U('uCatVisOn'), sel: U('uSel'), selOn: U('uSelOn'),
      rule: U('uRule'), ruleOn: U('uRuleOn'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      ortho: U('uOrtho'), fwd: U('uFwd'), orthoRay: U('uOrthoRay'), backoff: U('uBackoff'),
    } };
  };
  const full = mkProg(FRAG$gl_sticks), cheap = mkProg(FRAG_CHEAP$gl_sticks);
  let active = full;

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mkBuf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const bSeg = mkBuf(chunk.seg), bChan = mkBuf(chunk.chan), bCat = mkBuf(chunk.cat), bRec = mkBuf(chunk.recIdx);
    gl.bindVertexArray(null);
    return {
      kind: 'sticks', vao, buffers: [bSeg, bChan, bCat, bRec],
      bSeg, bChan, bCat, bRec,
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
      chanRange: chunk.chanRange,
    };
  }

  function drawSlice(c, first, k, useCheap = false) {
    const pp = useCheap ? cheap : full;
    if (pp !== active) { gl.useProgram(pp.prog); active = pp; }
    const uni = active.uni;
    gl.uniform1f(uni.fixedSplat, useCheap ? 1 : 0);
    gl.bindVertexArray(c.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, first * 24);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, first * 24 + 12);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, true, 0, first * 2);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, first);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, first * 4);
    gl.vertexAttribDivisor(4, 1);
    const span = c.chanRange[1] - c.chanRange[0];
    gl.uniform2f(uni.chanChunk, c.chanRange[0], span > 0 ? span : 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
  }

  function begin(cam, { pointPx, colorMode, zRange, chanDoc, ramp, palette, viewportH, maskTex = null, isolate = false, pointsView = false, picked = 0xFFFFFFFF, pickedLayer = 0xFFFFFFFF, layer = 0, section = null, radius = 1, catVisTex = null, selTex = null, ruleTex = null, opacity = 1 }) {
    const s = cam.state;
    for (const pp of [full, cheap]) {
      gl.useProgram(pp.prog);
      const uni = pp.uni;
      gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
      gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
      const v = s.view;
      let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
      const l2 = Math.hypot(lx, ly, lz) || 1;
      gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
      gl.uniform1f(uni.radius, radius);
      gl.uniform1f(uni.opacity, Math.max(0.02, Math.min(1, opacity)));   // per-layer screen-door opacity
      gl.uniform1f(uni.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uni.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uni.backoff, s.radius * 2);
      }
      gl.uniform1f(uni.demotePx, 2.0);
      gl.uniform1f(uni.pointPx, pointPx * (window.devicePixelRatio || 1));
      gl.uniform1i(uni.colorMode, colorMode);
      gl.uniform2f(uni.zRange, zRange[0], zRange[1]);
      gl.uniform2f(uni.chanDoc, chanDoc[0], chanDoc[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
      gl.uniform1f(uni.fixedSplat, pointsView ? 1 : 0);
      gl.uniform1ui(uni.picked, picked >>> 0);
      gl.uniform1ui(uni.pickedLayer, pickedLayer >>> 0);
      gl.uniform1ui(uni.layer, layer >>> 0);              // this draw's layer — the id no longer hides in aRec
      gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
      gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
      gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
      gl.uniform1f(uni.filterOn, maskTex ? 1 : 0);
      gl.uniform1f(uni.isolate, isolate ? 1 : 0);
      if (maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uni.mask, 4); }
      gl.uniform1f(uni.catVisOn, catVisTex ? 1 : 0);
      if (catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, catVisTex); gl.uniform1i(uni.catVis, 5); }
      gl.uniform1f(uni.selOn, selTex ? 1 : 0);
      if (selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, selTex); gl.uniform1i(uni.sel, 6); }
      gl.uniform1f(uni.ruleOn, ruleTex ? 1 : 0);
      if (ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ruleTex); gl.uniform1i(uni.rule, 7); }
    }
    active = full;
    gl.useProgram(full.prog);
  }

  function setRepaint(a, b) {
    for (const pp of [full, cheap]) { gl.useProgram(pp.prog); gl.uniform2ui(pp.uni.repaint, a >>> 0, b >>> 0); }
    if (active) gl.useProgram(active.prog);
  }

  return { upload, drawSlice, begin, setRepaint };
}

// ── ../msh/msh.js ──

// @gcu/msh — ARANZ-1.0 mesh file (.msh) reader and writer.
// Single-file ESM, zero runtime deps. Works in browsers and Node 18+.
//
// Format (self-describing):
//
//   %ARANZ-1.0\n
//   \n
//   [index]\n
//   <Name> <Type> <Components> <Count>;\n
//   ...
//   \n
//   [binary]<12-byte signature><binary data in declared order, little-endian>
//
// The [index] section declares each binary array by name, element type
// (Double | Integer), components per element (e.g. 3 for 3D vertices),
// and element count. The [binary] section starts with a fixed 12-byte
// signature whose meaning is undocumented; we preserve it verbatim on
// round-trip. See the README for the bytes we've observed and our best
// guesses about their meaning (short version: probably an ARANZ-internal
// format sentinel; opaque to us).
//
// Common arrays in practice (single triangulated mesh per file):
//   Location   Double  3   N    — flat XYZ, length 3*N
//   Tri        Integer 3   M    — flat IJK indices, length 3*M
//
// Coordinates are returned unmodified — typically a UTM-like grid in
// metres. Recentring is a rendering concern, not a parsing one (WebGL
// f32 precision drops at the absolute coordinate magnitudes typical of
// UTM, so renderers should subtract a centroid before uploading).
//
// SPDX-License-Identifier: BSD-3-Clause
// Reference: vendor format, no public spec; reverse-engineered from
// MacPass HG/LG and other Leapfrog Geo / Edge exports. ARANZ Geo was
// the original developer (now Seequent / Bentley).

/** Magic line at the start of every .msh file. */
const MSH_MAGIC = '%ARANZ-1.0';

/** Section headers we recognise (case-sensitive). */
const SECTION_INDEX  = '[index]';
const SECTION_BINARY = '[binary]';

/** Length of the opaque-magic prefix that sits between '[binary]' and
 *  the first array's bytes. See README "12-byte signature" section. */
const BINARY_PREFIX_LENGTH = 12;

/** The signature observed across all files we've seen — preserved on
 *  writeback when the caller doesn't supply their own. Probably an
 *  ARANZ-internal format sentinel; we don't interpret it. */
const DEFAULT_BINARY_SIGNATURE = new Uint8Array([
  0xFF, 0x0F, 0xF0, 0x00, 0x1B, 0xDE, 0x83, 0x42,
  0xCA, 0xC0, 0xF3, 0x3F,
]);

/** Type catalog. Maps the index-declared Type name to its byte width
 *  and a constructor for the typed-array we'll hand back. Little-endian
 *  is assumed throughout; we don't write any other endianness either. */
const MSH_TYPES = {
  Double:  { bytes: 8, ctor: Float64Array, kind: 'float' },
  Float:   { bytes: 4, ctor: Float32Array, kind: 'float' },
  Integer: { bytes: 4, ctor: Int32Array,   kind: 'int'   },
  Long:    { bytes: 8, ctor: BigInt64Array, kind: 'int'  },
  Short:   { bytes: 2, ctor: Int16Array,   kind: 'int'   },
  Byte:    { bytes: 1, ctor: Uint8Array,   kind: 'int'   },
};

/** Thrown on any MSH-specific failure: bad magic, malformed index,
 *  unsupported type, declared/decoded size mismatch, out-of-range
 *  triangle indices. */
class MSHError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MSHError';
  }
}

/** @typedef {Object} MSHArray
 *  @property {string} type        e.g. "Double", "Integer"
 *  @property {number} components  values per element (3 for 3D vertex / triangle)
 *  @property {number} count       element count (vertices, triangles, ...)
 *  @property {TypedArray} data    flat values, length = components * count.
 *                                  Float64Array for Double, Int32Array for
 *                                  Integer, etc. */

/** @typedef {Object} MSHResult
 *  @property {string} version              From the magic line; '1.0' in practice.
 *  @property {Map<string,MSHArray>} arrays Declared arrays, keyed by name in
 *                                          DECLARATION ORDER (Map iteration
 *                                          preserves insertion order).
 *  @property {Uint8Array} binarySignature  The 12 bytes between '[binary]'
 *                                          and the first array. Preserved
 *                                          for byte-identical round-trip.
 *  @property {Float64Array=} vertices      Convenience: the first Double-3
 *                                          array (typically named "Location"),
 *                                          if present.
 *  @property {Int32Array=} triangles       Convenience: the first Integer-3
 *                                          array (typically "Tri"), if present. */

/** Read an .msh ArrayBuffer / Uint8Array and return a fully decoded
 *  {@link MSHResult}. Throws {@link MSHError} on any structural problem.
 *  @param {ArrayBuffer|Uint8Array} input
 *  @param {Object} [opts]
 *  @param {boolean} [opts.validateIndices=true]  Bounds-check triangle
 *      indices against vertex count. Set false to skip if you have a
 *      file with non-Location/Tri arrays whose meaning we can't infer.
 *  @returns {Promise<MSHResult>}
 */
async function readMSH(input, opts = {}) {
  const bytes = _coerceBytes(input);
  const validateIndices = opts.validateIndices !== false;

  // 1. Find the [binary] header by locating its literal bytes — the
  //    section header sits on its own line in practice, but the binary
  //    data starts IMMEDIATELY after the closing ']' (no newline).
  const binaryHeaderStart = _indexOfBytes(bytes, SECTION_BINARY);
  if (binaryHeaderStart < 0) {
    throw new MSHError('missing [binary] section header');
  }
  const binaryStart = binaryHeaderStart + SECTION_BINARY.length;

  // 2. Decode the text header (everything before [binary]) as UTF-8
  //    and parse out the magic + index declarations.
  const headerText = new TextDecoder('utf-8').decode(bytes.subarray(0, binaryHeaderStart));
  const { version, declarations } = _parseTextHeader(headerText);

  // 3. Capture the 12-byte signature.
  if (binaryStart + BINARY_PREFIX_LENGTH > bytes.length) {
    throw new MSHError('binary section truncated before signature');
  }
  const binarySignature = bytes.slice(binaryStart, binaryStart + BINARY_PREFIX_LENGTH);

  // 4. Walk declarations in order, slicing the appropriate number of
  //    bytes per array. Little-endian — we copy into a fresh typed
  //    array rather than view-aliasing the source so the result is
  //    independent of the input buffer (the caller may free it).
  let cursor = binaryStart + BINARY_PREFIX_LENGTH;
  const arrays = new Map();
  for (const decl of declarations) {
    const info = MSH_TYPES[decl.type];
    if (!info) {
      throw new MSHError(`unsupported type "${decl.type}" for array "${decl.name}"`);
    }
    const totalValues = decl.components * decl.count;
    const totalBytes = totalValues * info.bytes;
    if (cursor + totalBytes > bytes.length) {
      throw new MSHError(
        `array "${decl.name}" declared ${totalBytes} bytes but file has only ${bytes.length - cursor} remaining`
      );
    }
    const data = _readTypedArray(bytes, cursor, totalValues, info);
    arrays.set(decl.name, {
      type: decl.type,
      components: decl.components,
      count: decl.count,
      data,
    });
    cursor += totalBytes;
  }
  // Trailing bytes? Real files don't have any, but tolerate up to 8
  // bytes of alignment padding (some writers append a record terminator).
  const trailing = bytes.length - cursor;
  if (trailing > 8) {
    throw new MSHError(`${trailing} unexpected bytes after the last declared array`);
  }

  const result = { version, arrays, binarySignature };

  // 5. Convenience accessors. Pick the FIRST Double-3 array as
  //    vertices and the FIRST Integer-3 array as triangles. Files with
  //    multiple Double-3 arrays (e.g. per-vertex normals) would need
  //    the caller to reach into `arrays` directly — we don't try to
  //    guess from names alone.
  let vertices, triangles;
  for (const [, arr] of arrays) {
    if (!vertices && arr.type === 'Double' && arr.components === 3) {
      vertices = arr.data;
    } else if (!triangles && arr.type === 'Integer' && arr.components === 3) {
      triangles = arr.data;
    }
  }
  if (vertices) result.vertices = vertices;
  if (triangles) result.triangles = triangles;

  // 6. Validation: every triangle index must reference a real vertex.
  //    Catches truncation / corruption that survived the size checks
  //    (e.g. a swapped array order).
  if (validateIndices && vertices && triangles) {
    const vCount = vertices.length / 3 | 0;
    for (let i = 0; i < triangles.length; i++) {
      const idx = triangles[i];
      if (idx < 0 || idx >= vCount) {
        throw new MSHError(
          `triangle index ${idx} at position ${i} is out of range (0..${vCount - 1})`
        );
      }
    }
  }

  return result;
}

/** Serialise an {@link MSHResult} (or a synthesised mesh) back to bytes.
 *  Round-trips byte-identical when given a result from readMSH that
 *  hasn't been modified.
 *  @param {Object} input
 *  @param {string} [input.version='1.0']
 *  @param {Map<string,MSHArray>|Object<string,MSHArray>} input.arrays
 *  @param {Uint8Array} [input.binarySignature]   12-byte prefix; defaults
 *      to the canonical observed signature.
 *  @returns {Promise<Uint8Array>}
 */
async function writeMSH(input) {
  const version = input.version || '1.0';
  const arrays = input.arrays instanceof Map
    ? input.arrays
    : new Map(Object.entries(input.arrays || {}));
  if (arrays.size === 0) {
    throw new MSHError('writeMSH: at least one declared array is required');
  }
  const signature = input.binarySignature || DEFAULT_BINARY_SIGNATURE;
  if (signature.length !== BINARY_PREFIX_LENGTH) {
    throw new MSHError(`binarySignature must be ${BINARY_PREFIX_LENGTH} bytes`);
  }

  // 1. Validate every array AND compute total binary length so we can
  //    allocate once. Keeps the writer single-pass and predictable.
  let binaryLen = BINARY_PREFIX_LENGTH;
  const orderedDeclarations = [];
  for (const [name, arr] of arrays) {
    const info = MSH_TYPES[arr.type];
    if (!info) {
      throw new MSHError(`writeMSH: unsupported type "${arr.type}" for array "${name}"`);
    }
    const declaredValues = arr.components * arr.count;
    if (!arr.data || arr.data.length !== declaredValues) {
      throw new MSHError(
        `writeMSH: array "${name}" declares ${declaredValues} values but data has ${arr.data?.length ?? 0}`
      );
    }
    orderedDeclarations.push({ name, ...arr, info });
    binaryLen += declaredValues * info.bytes;
  }

  // 2. Build the text header.
  const lines = [];
  lines.push(`%ARANZ-${version}`);
  lines.push('');
  lines.push(SECTION_INDEX);
  for (const decl of orderedDeclarations) {
    lines.push(`${decl.name} ${decl.type} ${decl.components} ${decl.count};`);
  }
  lines.push('');
  // The binary section header has NO trailing newline — the magic
  // signature starts immediately after the closing ']' (matching what
  // the readers in the wild expect, including the one this is based on).
  // Join with \n and append the literal '[binary]' separately so we
  // don't accidentally add one.
  const headerText = lines.join('\n') + '\n' + SECTION_BINARY;
  const headerBytes = new TextEncoder().encode(headerText);

  // 3. Allocate the final buffer and copy in:
  //    [header][signature][array 0 bytes][array 1 bytes]...
  const out = new Uint8Array(headerBytes.length + binaryLen);
  out.set(headerBytes, 0);
  let cursor = headerBytes.length;
  out.set(signature, cursor);
  cursor += BINARY_PREFIX_LENGTH;
  for (const decl of orderedDeclarations) {
    _writeTypedArray(out, cursor, decl.data, decl.info);
    cursor += decl.data.length * decl.info.bytes;
  }
  return out;
}

// ── internals ──

function _coerceBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && input.buffer instanceof ArrayBuffer) {
    // Other typed-array view: use its underlying buffer slice.
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new MSHError('readMSH: input must be ArrayBuffer or Uint8Array');
}

function _indexOfBytes(haystack, needleString) {
  // Search for an ASCII substring in a Uint8Array. Used to find the
  // [binary] header; we don't decode the whole file as UTF-8 because
  // the binary section will contain arbitrary bytes that may form
  // partial-UTF-8 sequences and corrupt the decoder.
  const needle = new TextEncoder().encode(needleString);
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function _parseTextHeader(text) {
  // Magic must be the first non-empty content line.
  const lines = text.split('\n');
  if (lines.length === 0 || !lines[0].startsWith('%ARANZ-')) {
    throw new MSHError('missing %ARANZ-N magic line');
  }
  const version = lines[0].slice('%ARANZ-'.length).trim();
  // Walk lines looking for [index]. Everything between [index] and the
  // next bracketed-section header (we expect [binary]) is declarations.
  let inIndex = false;
  const declarations = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      if (line === SECTION_INDEX) { inIndex = true; continue; }
      // Any other bracketed section ends the index. (We only know
      // about [binary] here, but other vendors might extend later.)
      inIndex = false;
      continue;
    }
    if (!inIndex) continue;
    declarations.push(_parseDeclaration(line));
  }
  if (declarations.length === 0) {
    throw new MSHError('[index] section is missing or empty');
  }
  return { version, declarations };
}

function _parseDeclaration(line) {
  // Shape: "<Name> <Type> <Components> <Count>;"
  // Name can contain spaces in theory (vendor-defined); we treat the
  // trailing ';' as the terminator and walk backwards through the
  // 3 numeric / type tokens. Anything before them is the name.
  const stripped = line.endsWith(';') ? line.slice(0, -1).trim() : line.trim();
  const tokens = stripped.split(/\s+/);
  if (tokens.length < 4) {
    throw new MSHError(`malformed index declaration: "${line}"`);
  }
  const count      = parseInt(tokens[tokens.length - 1], 10);
  const components = parseInt(tokens[tokens.length - 2], 10);
  const type       = tokens[tokens.length - 3];
  const name       = tokens.slice(0, tokens.length - 3).join(' ');
  if (!Number.isFinite(count) || count < 0
      || !Number.isFinite(components) || components < 1
      || !name) {
    throw new MSHError(`malformed index declaration: "${line}"`);
  }
  return { name, type, components, count };
}

function _readTypedArray(bytes, offset, length, info) {
  // The src bytes may not be aligned to the typed-array's stride, and
  // even when aligned, slicing into a fresh buffer guarantees the
  // returned array is independent of the input (we make NO promises
  // about the lifetime of the input ArrayBuffer). Copy bytes then
  // build the typed view on the copy.
  const totalBytes = length * info.bytes;
  const buf = new ArrayBuffer(totalBytes);
  new Uint8Array(buf).set(bytes.subarray(offset, offset + totalBytes));
  // BigInt64Array constructor takes (buffer, byteOffset, length).
  // All others same shape.
  return new info.ctor(buf, 0, length);
}

function _writeTypedArray(dst, offset, src, info) {
  // src is already a typed array (Float64Array etc.). We need its raw
  // bytes copied into dst at the given byte offset. The simplest path
  // is to view the SAME bytes via Uint8Array and let .set() handle
  // the copy.
  const view = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  // Sanity check: declared values × stride MUST match.
  if (view.byteLength !== src.length * info.bytes) {
    throw new MSHError(
      `writeMSH: typed-array stride mismatch (got ${view.byteLength}, expected ${src.length * info.bytes})`
    );
  }
  dst.set(view, offset);
}

// ── src/io/ply.js ──

// @gcu/condenser — PLY point-cloud provider (ascii + binary_little_endian).
// Reads the vertex element only (meshes: faces are ignored — micro shows the
// vertices). PLY carries no header bbox, so this provider runs a discovery
// sweep (bbox + intensity range) before streaming — both cold recipes over
// the Blob, same shape as the delimited provider. RawChunks match the LAS
// shape so the points pipeline + chunk builder are reused verbatim:
//   { count, x, y, z: Float64Array, intensity: Uint16Array,
//     classification: Uint8Array, rgb: Uint8Array(3n)|null, recStart }
//
// openPly(blob) → { header, streamChunks, fetchRecord }
//   header = { kind:'ply', format, count, bbox, columns, attributes, ply:{…} }
//   fetchRecord(rec) → [values in property order] (O(1) binary, sweep ascii)
//
// Honest limits: binary_big_endian and list-typed VERTEX properties throw;
// the vertex element must come first (a variable-size element before it
// would make the binary offset unknowable).

const TYPES$index = {
  char: [1, 'getInt8'], int8: [1, 'getInt8'],
  uchar: [1, 'getUint8'], uint8: [1, 'getUint8'],
  short: [2, 'getInt16'], int16: [2, 'getInt16'],
  ushort: [2, 'getUint16'], uint16: [2, 'getUint16'],
  int: [4, 'getInt32'], int32: [4, 'getInt32'],
  uint: [4, 'getUint32'], uint32: [4, 'getUint32'],
  float: [4, 'getFloat32'], float32: [4, 'getFloat32'],
  double: [8, 'getFloat64'], float64: [8, 'getFloat64'],
};

// Parse the ASCII header block. Returns null when 'end_header' isn't in the
// sample (caller retries with a bigger slice).
function parsePlyHeader(text) {
  const endAt = text.indexOf('end_header');
  if (endAt < 0) return null;
  const nl = text.indexOf('\n', endAt);
  if (nl < 0) return null;
  const lines = text.slice(0, endAt).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'ply') throw new Error('ply: missing magic');
  let format = null;
  const elements = [];
  for (const l of lines.slice(1)) {
    const f = l.split(/\s+/);
    if (f[0] === 'format') {
      if (f[1] === 'ascii') format = 'ascii';
      else if (f[1] === 'binary_little_endian') format = 'binary_le';
      else throw new Error(`ply: unsupported format ${f[1]}`);
    } else if (f[0] === 'element') {
      elements.push({ name: f[1], count: +f[2], props: [] });
    } else if (f[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw new Error('ply: property before element');
      if (f[1] === 'list') el.props.push({ name: f[4], list: true, countType: f[2], idxType: f[3] });
      else el.props.push({ name: f[2], type: f[1] });
    }
    // 'comment' / 'obj_info' — skipped
  }
  if (!format) throw new Error('ply: no format line');
  const vertex = elements[0];
  if (!vertex || vertex.name !== 'vertex') throw new Error('ply: vertex must be the first element');
  let stride = 0;
  for (const p of vertex.props) {
    if (p.list) throw new Error('ply: list-typed vertex property unsupported');
    const t = TYPES$index[p.type];
    if (!t) throw new Error(`ply: unknown type ${p.type}`);
    p.size = t[0]; p.getter = t[1]; p.offset = stride;
    stride += t[0];
  }
  return { format, count: vertex.count, props: vertex.props, stride, dataOffset: nl + 1, elements };
}

const findProp = (props, ...names) => {
  for (const n of names) { const p = props.find((q) => q.name.toLowerCase() === n); if (p) return p; }
  return null;
};

async function openPly(blob, { signal, onProgress } = {}) {
  // header is ASCII even for binary files — sample up front, grow if needed
  let sampleLen = 64 * 1024, ply = null;
  for (;;) {
    const text = new TextDecoder('latin1').decode(await blob.slice(0, Math.min(sampleLen, blob.size)).arrayBuffer());
    ply = parsePlyHeader(text);
    if (ply) break;
    if (sampleLen >= blob.size) throw new Error('ply: no end_header');
    sampleLen *= 4;
  }
  const { props, stride, count } = ply;
  const px = findProp(props, 'x'), py = findProp(props, 'y'), pz = findProp(props, 'z');
  if (!px || !py || !pz) throw new Error('ply: vertex needs x/y/z properties');
  const pr = findProp(props, 'red', 'r', 'diffuse_red'), pg = findProp(props, 'green', 'g', 'diffuse_green'), pb = findProp(props, 'blue', 'b', 'diffuse_blue');
  const hasRgb = !!(pr && pg && pb);
  const pi = findProp(props, 'intensity', 'scalar_intensity', 'quality', 'confidence');
  const idx = { x: props.indexOf(px), y: props.indexOf(py), z: props.indexOf(pz), i: pi ? props.indexOf(pi) : -1, r: pr ? props.indexOf(pr) : -1, g: pg ? props.indexOf(pg) : -1, b: pb ? props.indexOf(pb) : -1 };
  const ascii = ply.format === 'ascii';

  // ── record iteration (cold recipe): yields batches of decoded raw fields ──
  // binary: DataView slabs; ascii: line stream. Both yield {fields, recStart}
  // where fields[k] is a Float64Array per needed property.
  const NEED = [...new Set([idx.x, idx.y, idx.z, idx.i, idx.r, idx.g, idx.b].filter((v) => v >= 0))];
  async function* recordBatches(batchRecords, s2, op2) {
    const alloc = () => { const o = {}; for (const k of NEED) o[k] = new Float64Array(batchRecords); return o; };
    if (!ascii) {
      let rec = 0;
      while (rec < count) {
        if (s2 && s2.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const n = Math.min(batchRecords, count - rec);
        const off = ply.dataOffset + rec * stride;
        const dv = new DataView(await blob.slice(off, off + n * stride).arrayBuffer());
        const fields = alloc();
        for (const k of NEED) {
          const p = props[k], g = p.getter, po = p.offset, col = fields[k];
          for (let i = 0; i < n; i++) col[i] = dv[g](i * stride + po, true);
        }
        if (op2) op2(off + n * stride, blob.size);
        yield { fields, n, recStart: rec };
        rec += n;
      }
    } else {
      const reader = blob.slice(ply.dataOffset).stream().pipeThrough(new TextDecoderStream()).getReader();
      let carry = '', rec = 0, fields = alloc(), n = 0, seen = ply.dataOffset;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (s2 && s2.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          const lines = done ? (carry ? [carry] : []) : (carry + value).split('\n');
          if (!done) { carry = lines.pop(); seen += value.length; }
          for (const l of lines) {
            if (rec + n >= count) break;                    // face lines follow — stop at the vertex count
            const t = l.trim();
            if (!t) continue;
            const f = t.split(/\s+/);
            for (const k of NEED) fields[k][n] = +f[k];
            n++;
            if (n === batchRecords) { yield { fields, n, recStart: rec }; rec += n; fields = alloc(); n = 0; }
          }
          if (op2) op2(Math.min(seen, blob.size), blob.size);
          if (done || rec + n >= count) break;
        }
        if (n) yield { fields, n, recStart: rec };
      } finally { reader.releaseLock(); }
    }
  }

  // ── discovery sweep: bbox + intensity range ──
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let iMin = Infinity, iMax = -Infinity;
  for await (const { fields, n } of recordBatches(1 << 16, signal, onProgress)) {
    const xs = fields[idx.x], ys = fields[idx.y], zs = fields[idx.z], is = idx.i >= 0 ? fields[idx.i] : null;
    for (let i = 0; i < n; i++) {
      const xv = xs[i], yv = ys[i], zv = zs[i];
      if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
      if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
      if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
      if (is) { const v = is[i]; if (v < iMin) iMin = v; if (v > iMax) iMax = v; }
    }
  }
  const iScale = idx.i >= 0 && iMax > iMin ? 65535 / (iMax - iMin) : 0;

  const header = {
    kind: 'ply', format: ply.format, count,
    bbox: { min, max },
    columns: props.map((p) => p.name),
    attributes: [...(pi ? [pi.name] : []), ...(hasRgb ? ['rgb'] : [])],
    hasRgb,
    ply: { props, stride, dataOffset: ply.dataOffset, ascii },
  };

  // ── streaming sweep (cold recipe): LAS-shaped RawChunks ──
  async function* streamChunks({ chunkPoints = 1 << 18, signal: s2, onProgress: op2 } = {}) {
    for await (const { fields, n, recStart } of recordBatches(chunkPoints, s2, op2)) {
      const intensity = new Uint16Array(n);
      if (idx.i >= 0) { const is = fields[idx.i]; for (let i = 0; i < n; i++) intensity[i] = ((is[i] - iMin) * iScale) | 0; }
      let rgb = null;
      if (hasRgb) {
        rgb = new Uint8Array(3 * n);
        const rs = fields[idx.r], gs = fields[idx.g], bs = fields[idx.b];
        for (let i = 0; i < n; i++) { rgb[3 * i] = rs[i]; rgb[3 * i + 1] = gs[i]; rgb[3 * i + 2] = bs[i]; }
      }
      yield {
        count: n,
        x: fields[idx.x].subarray(0, n), y: fields[idx.y].subarray(0, n), z: fields[idx.z].subarray(0, n),
        intensity, classification: new Uint8Array(n), rgb, recStart,
      };
    }
  }

  // ── record fetch (the pick join): O(1) binary, early-exit sweep ascii ──
  async function fetchRecord(rec) {
    if (rec < 0 || rec >= count) return null;
    if (!ascii) {
      const off = ply.dataOffset + rec * stride;
      const dv = new DataView(await blob.slice(off, off + stride).arrayBuffer());
      return props.map((p) => dv[p.getter](p.offset, true));
    }
    const reader = blob.slice(ply.dataOffset).stream().pipeThrough(new TextDecoderStream()).getReader();
    let carry = '', at = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        const lines = done ? (carry ? [carry] : []) : (carry + value).split('\n');
        if (!done) carry = lines.pop();
        for (const l of lines) {
          const t = l.trim();
          if (!t) continue;
          if (at === rec) return t.split(/\s+/).map(Number);
          at++;
        }
        if (done) return null;
      }
    } finally { reader.releaseLock(); }
  }

  return { header, streamChunks, fetchRecord };
}

// ── src/io/mesh-io.js ──

// @gcu/condenser — context-tier mesh providers (micro-layers §7, tier 1).
// Wireframes, solids, TINs: whole-file reads into { vertices, triangles },
// then buildMeshChunk rebases to frame-local Float32 for the static indexed
// pipeline (gl-mesh.js). The tier is bounded by design — huge triangle-soup
// scans (photogrammetry) belong to the roadmapped streaming tier, which gets
// the full Morton/prefix treatment. Context meshes carry no records: scenery.
//
// Providers (each → { header, vertices: Float64Array(3n), triangles: Uint32Array(3m) }):
//   openMsh(blob)      — Leapfrog ARANZ-1.0 .msh via @gcu/msh
//   openObj(blob)      — Wavefront OBJ (v/f; fans n-gons; negative indices)
//   openPlyMesh(blob)  — PLY with a face element (ascii + binary_little_endian)
// header = { kind:'mesh', format, vertexCount, triCount, bbox:{min,max}, vertexColumns }
//
// PLY additionally returns `attrs` — one typed array per non-coordinate vertex
// property, named as the file named them, with `header.vertexColumns` listing
// them in file order. That is where a painted mesh's red/green/blue lives, and
// where nx/ny/nz and per-vertex quality live, so the vertex record space has
// real columns rather than only coordinates. OBJ and .msh declare no per-vertex
// attributes in their formats, so they report an empty list.


function meshBbox(vertices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = vertices[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function meshHeader(format, vertices, triangles) {
  return {
    kind: 'mesh', format,
    vertexCount: (vertices.length / 3) | 0,
    triCount: (triangles.length / 3) | 0,
    bbox: meshBbox(vertices),
    vertexColumns: [],            // per-vertex attribute names carried by the file
  };
}

// A per-vertex attribute keeps the width the file declared: a painted mesh's
// red/green/blue is three bytes per vertex, and widening it to Float64 would
// cost 24 on a model with millions of them.
const ARRAY_FOR = {
  char: Int8Array, int8: Int8Array, uchar: Uint8Array, uint8: Uint8Array,
  short: Int16Array, int16: Int16Array, ushort: Uint16Array, uint16: Uint16Array,
  int: Int32Array, int32: Int32Array, uint: Uint32Array, uint32: Uint32Array,
  float: Float32Array, float32: Float32Array, double: Float64Array, float64: Float64Array,
};

// ── Leapfrog .msh ──
async function openMsh(blob) {
  const msh = await readMSH(new Uint8Array(await blob.arrayBuffer()));
  if (!msh.vertices || !msh.triangles) throw new Error('msh: no vertex/triangle arrays found');
  const vertices = Float64Array.from(msh.vertices);
  const triangles = Uint32Array.from(msh.triangles);
  return { header: meshHeader('msh', vertices, triangles), vertices, triangles };
}

// ── Wavefront OBJ — v + f only (groups/materials are the records roadmap) ──
async function openObj(blob) {
  const text = await blob.text();
  const vx = [], tris = [];
  let nv = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const f = line.split(/\s+/);
      vx.push(+f[1], +f[2], +f[3]);
      nv++;
    } else if (line.startsWith('f ')) {
      const f = line.split(/\s+/);
      const ix = [];
      for (let k = 1; k < f.length; k++) {
        // "v", "v/vt", "v//vn", "v/vt/vn" — the vertex index leads; negatives
        // count back from the vertices seen so far (OBJ spec)
        let v = parseInt(f[k], 10);
        if (!Number.isFinite(v) || v === 0) continue;
        if (v < 0) v = nv + v; else v = v - 1;
        ix.push(v);
      }
      for (let k = 2; k < ix.length; k++) tris.push(ix[0], ix[k - 1], ix[k]);   // fan
    }
  }
  if (!nv || !tris.length) throw new Error('obj: no v/f geometry found');
  const vertices = Float64Array.from(vx);
  const triangles = Uint32Array.from(tris);
  for (let i = 0; i < triangles.length; i++) if (triangles[i] >= nv) throw new Error(`obj: face index ${triangles[i]} out of range (${nv} vertices)`);
  return { header: meshHeader('obj', vertices, triangles), vertices, triangles };
}

// ── PLY with faces — reuses ply.js's header parse (vertex first, face after) ──
async function openPlyMesh(blob) {
  let sampleLen = 64 * 1024, ply = null;
  for (;;) {
    const text = new TextDecoder('latin1').decode(await blob.slice(0, Math.min(sampleLen, blob.size)).arrayBuffer());
    ply = parsePlyHeader(text);
    if (ply) break;
    if (sampleLen >= blob.size) throw new Error('ply: no end_header');
    sampleLen *= 4;
  }
  const face = ply.elements.find((e) => e.name === 'face');
  if (!face || !face.count) throw new Error('ply: no face element (points file — use openPly)');
  const px = ply.props.findIndex((p) => p.name.toLowerCase() === 'x');
  const py = ply.props.findIndex((p) => p.name.toLowerCase() === 'y');
  const pz = ply.props.findIndex((p) => p.name.toLowerCase() === 'z');
  if (px < 0 || py < 0 || pz < 0) throw new Error('ply: vertex needs x/y/z');
  const nv = ply.count;
  const vertices = new Float64Array(3 * nv);
  const tris = [];
  const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const GETTERS = { 1: 'getUint8', 2: 'getUint16', 4: 'getUint32' };

  // Every vertex property that is not a coordinate becomes a per-vertex column:
  // red/green/blue from a painted mesh, nx/ny/nz, quality, confidence, whatever
  // the producing tool wrote. These are the mesh's own data and dropping them
  // was silent loss — a painted outcrop's set colors live here.
  const attrProps = ply.props
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== px && i !== py && i !== pz)
    .map(({ p, i }) => ({ ...p, field: i, arr: new (ARRAY_FOR[p.type] || Float64Array)(nv) }));
  const attrs = {};
  for (const a of attrProps) attrs[a.name] = a.arr;

  if (ply.format === 'ascii') {
    const text = await blob.text();
    const lines = text.slice(ply.dataOffset).split('\n');
    let at = 0, rec = 0;
    while (rec < nv && at < lines.length) {
      const t = lines[at++].trim();
      if (!t) continue;
      const f = t.split(/\s+/);
      vertices[3 * rec] = +f[px]; vertices[3 * rec + 1] = +f[py]; vertices[3 * rec + 2] = +f[pz];
      for (const a of attrProps) a.arr[rec] = +f[a.field];
      rec++;
    }
    let fc = 0;
    while (fc < face.count && at < lines.length) {
      const t = lines[at++].trim();
      if (!t) continue;
      const f = t.split(/\s+/);
      const k = +f[0];
      for (let j = 2; j < k; j++) tris.push(+f[1], +f[j], +f[j + 1]);   // fan
      fc++;
    }
  } else {
    const bytes = await blob.arrayBuffer();
    const dv = new DataView(bytes);
    for (let i = 0; i < nv; i++) {
      const base = ply.dataOffset + i * ply.stride;
      vertices[3 * i] = dv[ply.props[px].getter](base + ply.props[px].offset, true);
      vertices[3 * i + 1] = dv[ply.props[py].getter](base + ply.props[py].offset, true);
      vertices[3 * i + 2] = dv[ply.props[pz].getter](base + ply.props[pz].offset, true);
      for (const a of attrProps) a.arr[i] = dv[a.getter](base + a.offset, true);
    }
    // faces: sequential walk (variable-size records). Only the vertex-index
    // list is kept; other per-face properties are stepped over.
    let off = ply.dataOffset + nv * ply.stride;
    // counts + indices are unsigned in practice (int32 indices are non-negative)
    const rd = (size) => { const v = dv[GETTERS[size]](off, true); off += size; return v; };
    for (let i = 0; i < face.count; i++) {
      for (const p of face.props) {
        if (p.list) {
          const cs = SIZES[p.countType] || 1, is = SIZES[p.idxType] || 4;
          const k = rd(cs);
          if (/vertex_ind/i.test(p.name) || face.props.length === 1) {
            const ix = new Array(k);
            for (let j = 0; j < k; j++) ix[j] = rd(is);
            for (let j = 2; j < k; j++) tris.push(ix[0], ix[j - 1], ix[j]);
          } else off += k * is;
        } else {
          const sz = SIZES[p.type] || 4;
          off += sz;
        }
      }
    }
  }
  if (!tris.length) throw new Error('ply: face element yielded no triangles');
  const triangles = Uint32Array.from(tris);
  for (let i = 0; i < triangles.length; i++) if (triangles[i] >= nv) throw new Error(`ply: face index ${triangles[i]} out of range (${nv} vertices)`);
  const header = meshHeader(ply.format === 'ascii' ? 'ply-ascii' : 'ply-binary', vertices, triangles);
  header.vertexColumns = attrProps.map((a) => a.name);
  return { header, vertices, triangles, attrs };
}

// ── src/core/mesh-geom.js ──

// @gcu/condenser — mesh GEOMETRY builders (core: no I/O). World-f64 vertices
// → frame-local Float32 chunks for the static indexed pipeline (gl-mesh.js),
// plus the heightfield triangulator (a regular grid IS a single-valued
// surface). The file readers (.msh/.obj/.ply) live in io/mesh-io.js.
// ── world f64 → one frame-local GPU-ready chunk ──
// Float32 positions are safe at frame-local magnitudes (the whole point of
// @gcu/frame); indices stay u32. Context meshes are ONE chunk — they draw
// whole on clear frames, no prefix, no budget.
function buildMeshChunk({ vertices, triangles, frame }) {
  const o = frame ? frame.origin : [0, 0, 0];
  const n = (vertices.length / 3) | 0;
  const pos = new Float32Array(3 * n);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = vertices[3 * i + k] - o[k];
      pos[3 * i + k] = v;
      if (v < bb[k]) bb[k] = v;
      if (v > bb[k + 3]) bb[k + 3] = v;
    }
  }
  return {
    kind: 'mesh',
    pos,
    idx: triangles instanceof Uint32Array ? triangles : Uint32Array.from(triangles),
    count: (triangles.length / 3) | 0,                     // elements = triangles
    vertexCount: n,
    bboxLocal: Float64Array.from(bb),
  };
}

// A regular grid IS a single-valued heightfield — triangulate its lattice into a
// mesh chunk with per-vertex smooth normals (grid-gradient central differences)
// and a per-vertex value (the caller maps it to a color via its own colormap).
// Quads touching a nodata corner are dropped → clean holes. Coords are frame-
// local. Strided to a display cap by the caller (bounded triangle count).
// flatZ (a world elevation) makes a FLAT horizontal sheet at that z instead of a
// heightfield — for a 2D data grid (grade/geochem) with no DEM; `values` stays the
// grid value so the caller still colors by it, and the normal is straight up.
function buildHeightfieldMesh(grid, { stride = 1, frame = null, flatZ = null } = {}) {
  const { nx, ny, data, x0, y0, dx, dy, nodata } = grid;
  const o = (frame && frame.origin) || [0, 0, 0];
  const flat = flatZ != null, flatLocal = flat ? flatZ - o[2] : 0;
  const isBad = (v) => Number.isNaN(v) || (nodata != null && (nodata >= 1.7e38 ? v >= 1.7014e38 : v === nodata));
  const cols = Math.floor((nx - 1) / stride) + 1, rows = Math.floor((ny - 1) / stride) + 1;
  const vidx = new Int32Array(rows * cols).fill(-1);
  let nv = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isBad(data[Math.min(ny - 1, r * stride) * nx + Math.min(nx - 1, c * stride)])) vidx[r * cols + c] = nv++;
  }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), values = new Float32Array(nv);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const zAt = (r, c) => { const v = data[Math.min(ny - 1, Math.max(0, r * stride)) * nx + Math.min(nx - 1, Math.max(0, c * stride))]; return isBad(v) ? NaN : v; };
  const sx = 2 * stride * dx, sy = 2 * stride * dy;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const vi = vidx[r * cols + c]; if (vi < 0) continue;
    const gr = Math.min(ny - 1, r * stride), gc = Math.min(nx - 1, c * stride), z = data[gr * nx + gc];
    const px = (x0 + gc * dx) - o[0], py = (y0 - gr * dy) - o[1], pz = flat ? flatLocal : z - o[2];
    pos[vi * 3] = px; pos[vi * 3 + 1] = py; pos[vi * 3 + 2] = pz; values[vi] = z;
    if (px < bb[0]) bb[0] = px; if (py < bb[1]) bb[1] = py; if (pz < bb[2]) bb[2] = pz;
    if (px > bb[3]) bb[3] = px; if (py > bb[4]) bb[4] = py; if (pz > bb[5]) bb[5] = pz;
    if (flat) { normal[vi * 3] = 0; normal[vi * 3 + 1] = 0; normal[vi * 3 + 2] = 1; continue; }   // flat sheet → up
    // heightfield normal N = (-∂z/∂x, -∂z/∂y, 1); y decreases as row increases
    let zl = zAt(r, c - 1), zr = zAt(r, c + 1), zdn = zAt(r - 1, c), zup = zAt(r + 1, c);
    if (Number.isNaN(zl)) zl = z; if (Number.isNaN(zr)) zr = z; if (Number.isNaN(zdn)) zdn = z; if (Number.isNaN(zup)) zup = z;
    const nX = -(zr - zl) / sx, nY = -(zdn - zup) / sy, nZ = 1, nl = Math.hypot(nX, nY, nZ) || 1;
    normal[vi * 3] = nX / nl; normal[vi * 3 + 1] = nY / nl; normal[vi * 3 + 2] = nZ / nl;
  }
  const tris = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = vidx[r * cols + c], b = vidx[r * cols + c + 1], d = vidx[(r + 1) * cols + c], e = vidx[(r + 1) * cols + c + 1];
    if (a < 0 || b < 0 || d < 0 || e < 0) continue;        // drop quads touching nodata → clean holes
    tris.push(a, d, b, b, d, e);
  }
  return { kind: 'mesh', pos, idx: Uint32Array.from(tris), normal, values, count: (tris.length / 3) | 0, vertexCount: nv, bboxLocal: Float64Array.from(bb) };
}

// ── src/core/gl-mesh.js ──

// @gcu/condenser — the context-mesh pipeline (micro-layers §7, tier 1).
// Static indexed triangles: one VAO + element buffer per mesh, drawn whole on
// clear frames (no prefix, no budget — the tier is bounded at open). Flat
// shading comes from screen-space derivatives (no normals buffer), two-sided
// (geological wireframes are rarely consistently wound). The section cut is
// PER-PIXEL — a triangle crossing the plane is clipped at it, not dropped —
// which is exactly the sectioned-solid view. Opacity is 4×4-Bayer screen-door:
// depth-correct, blend-free, safe under progressive accumulation and EDL.


const VERT$gl_mesh = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // frame-local vertex
layout(location=1) in vec3 aColor;      // per-vertex rgb (heightfield drape); ignored when uVColor=0
layout(location=2) in vec3 aNormal;     // per-vertex normal (smooth relief); ignored when uVNormal=0
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out vec3 vColor;
out vec3 vNormal;
out float vSecDist;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vWorldPos = aPos;
  vColor = aColor;
  vNormal = aNormal;
  vSecDist = dot(aPos, uSecPlane.xyz) - uSecPlane.w;
}`;

// Per-vertex drape (uVColor) + smooth normals (uVNormal) are OPT-IN — default 0
// keeps the flat-shaded solid-tint behavior byte-for-byte. The heightfield
// surface sets both: vColor from a colormap, vNormal from the grid gradient, and
// the normal's z is divided by uZExag (inverse-transpose of the display z-scale)
// so lighting matches the vertically-exaggerated relief.
const SHADE_COMMON = `
uniform vec4 uTint;                     // rgb + opacity
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform float uVColor;                  // 0/1 use vColor
uniform float uVNormal;                 // 0/1 use vNormal (else flat derivative)
uniform float uZExag;                   // vertical exaggeration (for the normal correction)
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
vec3 shadeSurface() {
  vec3 n = (uVNormal > 0.5)
    ? normalize(vec3(vNormal.xy, vNormal.z / max(uZExag, 1e-4)))   // exaggeration-correct
    : normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));          // flat shading
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;                                    // two-sided
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  vec3 base = (uVColor > 0.5) ? vColor : uTint.rgb;
  return base * shade;
}`;

const FRAG$gl_mesh = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vColor;
in vec3 vNormal;
in float vSecDist;
uniform vec2 uSecCfg;                   // x: on, y: half-thickness
${SHADE_COMMON}
out vec4 outColor;
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;   // per-pixel plane cut
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  outColor = vec4(shadeSurface(), 1.0);
}`;

// TRACE-OVER-THE-WALL variant, used while the layer is sectioned: with blocks
// cutting TRUE at the slab plane (gl-blocks), the mesh inside the slab sits
// BEHIND the painted cut wall and would be fully occluded — and the mesh AT the
// plane is edge-on (invisible). This program pulls each in-slab fragment's DEPTH
// onto the camera-side slab face (minus an epsilon), so the whole in-slab mesh
// projects onto the section and draws over the wall — the wireframe-trace-on-a-
// section-plot look. Color/shading unchanged; costs early-z only while sectioned.
const FRAG_OVERLAY$gl_mesh = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vColor;
in vec3 vNormal;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform mat4 uViewProj;
uniform vec3 uFwd;
uniform float uOrtho;
${SHADE_COMMON}
out vec4 outColor;
void main() {
  if (abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  outColor = vec4(shadeSurface(), 1.0);
  gl_FragDepth = gl_FragCoord.z;
  float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;
  if (abs(dcEye) > uSecCfg.y) {                            // eye outside the slab → a wall may occlude
    float side = sign(dcEye);
    vec3 q; bool front = false;
    if (uOrtho > 0.5) {                                    // parallel rays: march back along the view dir
      float den = dot(uFwd, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float s = (vSecDist - side * uSecCfg.y) / den;
        if (s > 0.0) { q = vWorldPos - uFwd * s; front = true; }
      }
    } else {
      vec3 rdm = vWorldPos - uEye;
      float den = dot(rdm, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float tF = (side * uSecCfg.y - dcEye) / den;       // where the eye ray crosses the near face
        if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
      }
    }
    if (front) {
      vec4 clipQ = uViewProj * vec4(q, 1.0);
      gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
    }
  }
}`;

function createMeshPipeline(gl) {
  const mk = (frag) => {
    const prog = makeProgram(gl, VERT$gl_mesh, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      tint: U('uTint'), lightDir: U('uLightDir'), eye: U('uEye'),
      fwd: U('uFwd'), ortho: U('uOrtho'),
      vColor: U('uVColor'), vNormal: U('uVNormal'), zExag: U('uZExag'),
    } };
  };
  const base = mk(FRAG$gl_mesh), overlay = mk(FRAG_OVERLAY$gl_mesh);

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const bPos = gl.createBuffer(); bufs.push(bPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (chunk.color) {                                     // heightfield drape: per-vertex rgb (loc 1)
      const bCol = gl.createBuffer(); bufs.push(bCol);
      gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.color, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    }
    if (chunk.normal) {                                    // smooth relief: per-vertex normal (loc 2)
      const bNrm = gl.createBuffer(); bufs.push(bNrm);
      gl.bindBuffer(gl.ARRAY_BUFFER, bNrm);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.normal, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    }
    const bIdx = gl.createBuffer(); bufs.push(bIdx);       // stays bound in the VAO
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return {
      kind: 'mesh', vao, buffers: bufs,
      count: chunk.count, idxCount: chunk.idx.length,
      hasColor: !!chunk.color, hasNormal: !!chunk.normal,
      bboxLocal: chunk.bboxLocal, cursor: 0,
    };
  }

  // per-layer uniforms — tint [r,g,b] 0..1, opacity 0..1, section may be null.
  // Sectioned → the overlay program (depth flattened onto the slab face so the
  // trace draws over the true-cut block wall); unsectioned → the base program.
  function begin(cam, { tint = [0.62, 0.64, 0.66], opacity = 1, section = null, vcolor = false, vnormal = false }) {
    const s = cam.state;
    const { prog, uni } = section ? overlay : base;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
    gl.uniform1f(uni.vColor, vcolor ? 1 : 0);              // heightfield drape colors
    gl.uniform1f(uni.vNormal, vnormal ? 1 : 0);            // smooth grid normals
    gl.uniform1f(uni.zExag, s.zExag || 1);                 // normal correction under exaggeration
    gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
    // the headlight of blocks/sticks: eye direction + a little up
    const v = s.view;
    let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
    const l2 = Math.hypot(lx, ly, lz) || 1;
    gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
    gl.uniform4f(uni.tint, tint[0], tint[1], tint[2], Math.max(0.02, Math.min(1, opacity)));
    gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
    gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
    if (uni.fwd) {
      const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
      const fl = Math.hypot(...f) || 1;
      gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
    }
  }

  function draw(c) {
    gl.bindVertexArray(c.vao);
    gl.drawElements(gl.TRIANGLES, c.idxCount, gl.UNSIGNED_INT, 0);
  }

  return { upload, begin, draw };
}

// ── src/core/soup-geom.js ──

// @gcu/condenser — streaming-tier meshes (micro-layers §7, tier 2): TRIANGLE
// SOUP under the full chunk discipline. Photogrammetry-scale meshes (10⁷–10⁸
// tris) get what points get: batch-Morton on centroids, intra-chunk shuffle
// (any prefix = a uniform subsample — valid because triangle size
// anti-correlates with mesh size: a mesh is huge BECAUSE its triangles are
// pixel-scale, and pixel-scale triangles subsample like points), per-chunk u16
// quantization (~18 B/tri resident), budgeted progressive accumulation.
// Flat shading needs no stored normals (screen-space derivatives in-shader).
// Soup carries no records in v1 — context semantics at scale.
//
// Precision: streamed vertices are kept Float32 LOCAL to a provisional origin
// (the first vertex) — world-f32 at UTM magnitudes loses ~1 m, local-f32 keeps
// mm — and re-widened to world f64 on emit for the frame-local rebase.


/**
 * Build one SoupChunk from columnar world-space corners + centroids.
 * raw = { ax..az, bx..bz, cx..cz (corners), x,y,z (centroids) }.
 * Corners are u16-quantized against the chunk bbox (the points trick ×3).
 */
function buildSoupChunk(raw, frame, rnd, indices = null) {
  const n = indices ? indices.length : raw.x.length;
  const o = frame.origin;
  const perm = indices ? shuffleInPlace(Uint32Array.from(indices), rnd) : shuffledIndices(n, rnd);
  const C = [raw.ax, raw.ay, raw.az, raw.bx, raw.by, raw.bz, raw.cx, raw.cy, raw.cz];
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    for (let c = 0; c < 9; c++) {
      const a = c % 3, v = C[c][i] - o[a];
      if (v < bb[a]) bb[a] = v;
      if (v > bb[a + 3]) bb[a + 3] = v;
    }
  }
  const sx = bb[3] > bb[0] ? 65535 / (bb[3] - bb[0]) : 0;
  const sy = bb[4] > bb[1] ? 65535 / (bb[4] - bb[1]) : 0;
  const sz = bb[5] > bb[2] ? 65535 / (bb[5] - bb[2]) : 0;
  const S = [sx, sy, sz];
  const tri = new Uint16Array(9 * n);
  for (let k = 0; k < n; k++) {
    const i = perm[k];
    for (let c = 0; c < 9; c++) {
      const a = c % 3;
      tri[k * 9 + c] = ((C[c][i] - o[a] - bb[a]) * S[a] + 0.5) | 0;
    }
  }
  return { kind: 'soup', count: n, tri, bboxLocal: Float64Array.from(bb) };
}

// Exact centroid of element k, frame-local (tests).
function soupLocalCentroid(chunk, k) {
  const b = chunk.bboxLocal, t = chunk.tri;
  const d = (v, a) => (b[a + 3] > b[a] ? b[a] + (v / 65535) * (b[a + 3] - b[a]) : b[a]);
  const out = [0, 0, 0];
  for (let c = 0; c < 9; c++) out[c % 3] += d(t[k * 9 + c], c % 3) / 3;
  return out;
}

/**
 * SoupChunkBuilder — the sticks builder's shape over triangle RawChunks
 * ({ count, ax..cz, x,y,z }). Batch-Morton on centroids, sliced, shuffled.
 */
function createSoupChunkBuilder({ frame, chunkSize = 1 << 17, batchSize = 0, seed = 1, onChunk }) {
  const rnd = mulberry32(seed);
  const batchN = batchSize || chunkSize * 4;
  let pend = [], pendCount = 0;
  const doc = {
    count: 0,
    bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity),
  };
  const concat = (Type, parts) => {
    const out = new Type(parts.reduce((t, p) => t + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const COLS = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z'];
  const flushBatch = () => {
    if (!pendCount) return;
    const cols = {};
    for (const c of COLS) cols[c] = concat(Float64Array, pend.map((p) => p[c]));
    const n = pendCount;
    pend = []; pendCount = 0;
    const order = radixSortIndices(mortonKeys(cols.x, cols.y, cols.z, n), n);
    for (let start = 0; start < n; start += chunkSize) {
      const slice = order.subarray(start, Math.min(start + chunkSize, n));
      const chunk = buildSoupChunk(cols, frame, rnd, slice);
      doc.count += chunk.count;
      const b = doc.bboxLocal, cb = chunk.bboxLocal;
      for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
      onChunk(chunk);
    }
  };
  return {
    push(raw) {
      let taken = 0;
      while (taken < raw.count) {
        const room = batchN - pendCount;
        const n = Math.min(room, raw.count - taken);
        const part = {};
        for (const c of COLS) part[c] = raw[c].subarray(taken, taken + n);
        pend.push(part);
        pendCount += n; taken += n;
        if (pendCount >= batchN) flushBatch();
      }
    },
    flush() { flushBatch(); return doc; },
    get doc() { return doc; },
  };
}

// world f64 corner columns from a resolved index triple against local-f32
// vertices + their origin (the precision dance in the header comment)
function emitBatch(verts, vo, ia, ib, ic, n) {
  const out = { count: n };
  for (const c of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'cx', 'cy', 'cz', 'x', 'y', 'z']) out[c] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = ia[i] * 3, b = ib[i] * 3, c = ic[i] * 3;
    const AX = vo[0] + verts[a], AY = vo[1] + verts[a + 1], AZ = vo[2] + verts[a + 2];
    const BX = vo[0] + verts[b], BY = vo[1] + verts[b + 1], BZ = vo[2] + verts[b + 2];
    const CX = vo[0] + verts[c], CY = vo[1] + verts[c + 1], CZ = vo[2] + verts[c + 2];
    out.ax[i] = AX; out.ay[i] = AY; out.az[i] = AZ;
    out.bx[i] = BX; out.by[i] = BY; out.bz[i] = BZ;
    out.cx[i] = CX; out.cy[i] = CY; out.cz[i] = CZ;
    out.x[i] = (AX + BX + CX) / 3; out.y[i] = (AY + BY + CY) / 3; out.z[i] = (AZ + BZ + CZ) / 3;
  }
  return out;
}

/**
 * Soup-stream an ALREADY-PARSED mesh (oversized .msh/.obj — their formats are
 * whole-file reads anyway; the vertices are transient, the soup is resident).
 * Yields RawChunks for createSoupChunkBuilder.
 */
async function* soupFromMesh({ vertices, triangles }, { batchTris = 1 << 16 } = {}) {
  const nv = (vertices.length / 3) | 0;
  const vo = nv ? [vertices[0], vertices[1], vertices[2]] : [0, 0, 0];
  const verts = new Float32Array(3 * nv);
  for (let i = 0; i < nv; i++) {
    verts[3 * i] = vertices[3 * i] - vo[0];
    verts[3 * i + 1] = vertices[3 * i + 1] - vo[1];
    verts[3 * i + 2] = vertices[3 * i + 2] - vo[2];
  }
  const nt = (triangles.length / 3) | 0;
  const ia = new Uint32Array(batchTris), ib = new Uint32Array(batchTris), ic = new Uint32Array(batchTris);
  let n = 0;
  for (let t = 0; t < nt; t++) {
    ia[n] = triangles[3 * t]; ib[n] = triangles[3 * t + 1]; ic[n] = triangles[3 * t + 2];
    n++;
    if (n === batchTris) { yield emitBatch(verts, vo, ia, ib, ic, n); n = 0; }
  }
  if (n) yield emitBatch(verts, vo, ia, ib, ic, n);
}

// ── src/io/soup-io.js ──

// @gcu/condenser — the streaming triangle-soup PROVIDER (io): openPlySoup
// walks a photogrammetry-scale PLY in two passes, neither holding the file,
// and emits RawChunk batches for core/soup-geom's builder. The geometry
// discipline (Morton, shuffle, quantize) lives in core/soup-geom.js.


/**
 * openPlySoup(blob) — the TRUE streaming provider (binary_le + ascii PLY, the
 * formats photogrammetry exports). Two passes over the blob, neither holding
 * the file: (1) the vertex block → local-f32 xyz (12 B/vertex transient RAM —
 * the honest open-time cost; freed when streaming ends), (2) the face block
 * walked in slabs, fanned, emitted as RawChunk batches.
 * → { header, streamChunks } — header = { kind:'mesh', soup:true, format,
 *    vertexCount, triCount(≈ faces, exact after stream), bbox }
 */
async function openPlySoup(blob, { onProgress } = {}) {
  let sampleLen = 64 * 1024, ply = null;
  for (;;) {
    const text = new TextDecoder('latin1').decode(await blob.slice(0, Math.min(sampleLen, blob.size)).arrayBuffer());
    ply = parsePlyHeader(text);
    if (ply) break;
    if (sampleLen >= blob.size) throw new Error('ply: no end_header');
    sampleLen *= 4;
  }
  const face = ply.elements.find((e) => e.name === 'face');
  if (!face || !face.count) throw new Error('ply: no face element');
  const px = ply.props.find((p) => p.name.toLowerCase() === 'x');
  const py = ply.props.find((p) => p.name.toLowerCase() === 'y');
  const pz = ply.props.find((p) => p.name.toLowerCase() === 'z');
  if (!px || !py || !pz) throw new Error('ply: vertex needs x/y/z');
  const nv = ply.count, ascii = ply.format === 'ascii';
  const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const GETTERS = { 1: 'getUint8', 2: 'getUint16', 4: 'getUint32' };

  // ── pass 1: vertices → local f32 (+ bbox in world f64) ──
  const verts = new Float32Array(3 * nv);
  const vo = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let faceStart;                                            // byte offset where faces begin (binary) / line index (ascii)
  let asciiLines = null;
  if (!ascii) {
    const SLAB = 1 << 23;                                   // 8 MB windows
    let seen = 0;
    while (seen < nv) {
      const n = Math.min(Math.floor(SLAB / ply.stride) || 1, nv - seen);
      const off = ply.dataOffset + seen * ply.stride;
      const dv = new DataView(await blob.slice(off, off + n * ply.stride).arrayBuffer());
      for (let i = 0; i < n; i++) {
        const X = dv[px.getter](i * ply.stride + px.offset, true);
        const Y = dv[py.getter](i * ply.stride + py.offset, true);
        const Z = dv[pz.getter](i * ply.stride + pz.offset, true);
        if (seen === 0 && i === 0) { vo[0] = X; vo[1] = Y; vo[2] = Z; }
        const k = (seen + i) * 3;
        verts[k] = X - vo[0]; verts[k + 1] = Y - vo[1]; verts[k + 2] = Z - vo[2];
        if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
        if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
        if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
      }
      seen += n;
      if (onProgress) onProgress(off + n * ply.stride, blob.size);
    }
    faceStart = ply.dataOffset + nv * ply.stride;
  } else {
    // ascii: one decode, line-split (ascii photogrammetry at soup scale is
    // rare; the binary path is the load-bearing one)
    const text = await blob.text();
    asciiLines = text.slice(ply.dataOffset).split('\n');
    const xi = ply.props.indexOf(px), yi = ply.props.indexOf(py), zi = ply.props.indexOf(pz);
    let rec = 0, at = 0;
    while (rec < nv && at < asciiLines.length) {
      const t = asciiLines[at++].trim();
      if (!t) continue;
      const f = t.split(/\s+/);
      const X = +f[xi], Y = +f[yi], Z = +f[zi];
      if (rec === 0) { vo[0] = X; vo[1] = Y; vo[2] = Z; }
      verts[rec * 3] = X - vo[0]; verts[rec * 3 + 1] = Y - vo[1]; verts[rec * 3 + 2] = Z - vo[2];
      if (X < min[0]) min[0] = X; if (X > max[0]) max[0] = X;
      if (Y < min[1]) min[1] = Y; if (Y > max[1]) max[1] = Y;
      if (Z < min[2]) min[2] = Z; if (Z > max[2]) max[2] = Z;
      rec++;
    }
    faceStart = at;
  }

  const header = {
    kind: 'mesh', soup: true, format: ascii ? 'ply-ascii' : 'ply-binary',
    vertexCount: nv, triCount: face.count, faces: face.count,
    bbox: { min, max },
  };

  // ── pass 2: the face walk → RawChunk batches ──
  async function* streamChunks({ batchTris = 1 << 16, signal, onProgress: op2 } = {}) {
    const ia = new Uint32Array(batchTris), ib = new Uint32Array(batchTris), ic = new Uint32Array(batchTris);
    let n = 0, tris = 0;
    const flushTo = function* (force) {
      if (n && (force || n === batchTris)) { const b = emitBatch(verts, vo, ia, ib, ic, n); tris += n; n = 0; yield b; }
    };
    const pushFan = function* (ix, k) {
      for (let j = 2; j < k; j++) {
        ia[n] = ix[0]; ib[n] = ix[j - 1]; ic[n] = ix[j];
        n++;
        if (n === batchTris) yield* flushTo(true);
      }
    };
    if (!ascii) {
      const MAXREC = 4 + 255 * 8;                           // count + a generous n-gon
      const SLAB = 1 << 23;
      let base = faceStart, carry = new Uint8Array(0), done = 0;
      const ix = new Uint32Array(256);
      while (done < face.count && base < blob.size) {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const take = Math.min(SLAB, blob.size - base);
        const slab = new Uint8Array(carry.length + take);
        slab.set(carry, 0);
        slab.set(new Uint8Array(await blob.slice(base, base + take).arrayBuffer()), carry.length);
        base += take;
        const dv = new DataView(slab.buffer);
        let off = 0;
        const last = base >= blob.size;
        while (done < face.count && (last ? off < slab.length : off + MAXREC <= slab.length)) {
          let rOff = off, bad = false;
          for (const pr of face.props) {
            if (pr.list) {
              const cs = SIZES[pr.countType] || 1, is = SIZES[pr.idxType] || 4;
              if (rOff + cs > slab.length) { bad = true; break; }
              const k = dv[GETTERS[cs]](rOff, true); rOff += cs;
              if (rOff + k * is > slab.length) { bad = true; break; }
              if (/vertex_ind/i.test(pr.name) || face.props.length === 1) {
                for (let j = 0; j < k; j++) ix[j] = dv[GETTERS[is]](rOff + j * is, true);
                rOff += k * is;
                yield* pushFan(ix, k);
              } else rOff += k * is;
            } else {
              rOff += SIZES[pr.type] || 4;
              if (rOff > slab.length) { bad = true; break; }
            }
          }
          if (bad) break;
          off = rOff;
          done++;
        }
        carry = slab.subarray(off);
        if (op2) op2(base, blob.size);
      }
    } else {
      let at = faceStart, fc = 0;
      while (fc < face.count && at < asciiLines.length) {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const t = asciiLines[at++].trim();
        if (!t) continue;
        const f = t.split(/\s+/);
        const k = +f[0];
        const ix = new Uint32Array(k);
        for (let j = 0; j < k; j++) ix[j] = +f[1 + j];
        yield* pushFan(ix, k);
        fc++;
      }
    }
    yield* flushTo(true);
    header.triCount = tris + n;                             // exact after the stream (fans expand quads)
  }

  return { header, streamChunks };
}

// ── src/core/gl-soup.js ──

// @gcu/condenser — the streaming-mesh (triangle soup) pipeline (micro-layers
// §7 tier 2). The points pipeline's shape over TRIANGLES: u16 positions
// dequantized against the chunk bbox, prefix slices (first/k in TRIANGLE
// units), budgeted accumulation. The fragment shader is gl-mesh's: derivative
// flat shading, two-sided, Bayer screen-door opacity, per-pixel section cut.


const VERT$gl_soup = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // u16 normalized against the chunk bbox
uniform mat4 uViewProj;
uniform vec3 uBoxMin;
uniform vec3 uBoxSpan;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out float vSecDist;
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  vWorldPos = p;
  vSecDist = dot(p, uSecPlane.xyz) - uSecPlane.w;
}`;

const FRAG$gl_soup = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec2 uSecCfg;
uniform vec4 uTint;
uniform vec3 uLightDir;
uniform vec3 uEye;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  outColor = vec4(uTint.rgb * shade, 1.0);
}`;

// sectioned variant: flatten in-slab fragment depth onto the camera-side slab
// face so the streamed-mesh trace draws over the true-cut block wall (gl-mesh's
// FRAG_OVERLAY, same math — see the rationale there)
const FRAG_OVERLAY$gl_soup = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform vec4 uTint;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform mat4 uViewProj;
uniform vec3 uFwd;
uniform float uOrtho;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  if (abs(vSecDist) > uSecCfg.y) discard;
  if (uTint.a < 0.999) {
    int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2);
    if (uTint.a < (BAYER[bi] + 0.5) / 16.0) discard;
  }
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 vd = normalize(uEye - vWorldPos);
  if (dot(n, vd) < 0.0) n = -n;
  float shade = 0.42 + 0.58 * max(dot(n, uLightDir), 0.0);
  outColor = vec4(uTint.rgb * shade, 1.0);
  gl_FragDepth = gl_FragCoord.z;
  float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;
  if (abs(dcEye) > uSecCfg.y) {
    float side = sign(dcEye);
    vec3 q; bool front = false;
    if (uOrtho > 0.5) {
      float den = dot(uFwd, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float s = (vSecDist - side * uSecCfg.y) / den;
        if (s > 0.0) { q = vWorldPos - uFwd * s; front = true; }
      }
    } else {
      vec3 rdm = vWorldPos - uEye;
      float den = dot(rdm, uSecPlane.xyz);
      if (abs(den) > 1e-9) {
        float tF = (side * uSecCfg.y - dcEye) / den;
        if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
      }
    }
    if (front) {
      vec4 clipQ = uViewProj * vec4(q, 1.0);
      gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
    }
  }
}`;

function createSoupPipeline(gl) {
  const mk = (frag) => {
    const prog = makeProgram(gl, VERT$gl_soup, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), boxMin: U('uBoxMin'), boxSpan: U('uBoxSpan'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
      tint: U('uTint'), lightDir: U('uLightDir'), eye: U('uEye'),
      fwd: U('uFwd'), ortho: U('uOrtho'),
    } };
  };
  const base = mk(FRAG$gl_soup), overlay = mk(FRAG_OVERLAY$gl_soup);
  let uni = base.uni;                                      // drawSlice uses the ACTIVE program's locations

  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, chunk.tri, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindVertexArray(null);
    return {
      kind: 'soup', vao, buffers: [b],
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
    };
  }

  function begin(cam, { tint = [0.62, 0.64, 0.66], opacity = 1, section = null }) {
    const s = cam.state;
    const pp = section ? overlay : base;
    uni = pp.uni;
    gl.useProgram(pp.prog);
    gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
    gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
    const v = s.view;
    let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
    const l2 = Math.hypot(lx, ly, lz) || 1;
    gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
    gl.uniform4f(uni.tint, tint[0], tint[1], tint[2], Math.max(0.02, Math.min(1, opacity)));
    gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
    gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
    if (uni.fwd) {
      const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
      const fl = Math.hypot(...f) || 1;
      gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
    }
  }

  // first/k in TRIANGLES — the prefix invariant rides the shuffled build order
  function drawSlice(c, first, k) {
    gl.bindVertexArray(c.vao);
    gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
    gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
    gl.drawArrays(gl.TRIANGLES, first * 3, k * 3);
  }

  return { upload, begin, drawSlice };
}

// ── src/core/gl-blocks.js ──

// @gcu/condenser — box impostors for block models (micro-spec §2.3).
// One screen-aligned quad per block (instanced TRIANGLE_STRIP — no point-sprite
// size cap): the vertex shader expands a camera-basis billboard sized to the
// block's bounding sphere; the fragment shader ray-intersects the block's ACTUAL
// AABB analytically (slab test), discards on miss, writes correct gl_FragDepth
// and the face normal on hit → pixel-perfect cube silhouettes and correct
// inter-block occlusion at one quad per block. Face-normal flat shading; EDL
// does the rest on top.
//
// LOD demotion: a block whose projected radius falls below ~2 px renders as a
// plain circular splat (no ray test) — near field looks like blocks, far field
// looks like the dense cloud it visually is (§2.3).
//
// WebGL2 has no baseInstance, so accumulation slices [first, first+k) work by
// re-pointing the instance attributes at byte offsets before each draw — the
// chunk's VAO records the new pointers (cheap: 3 pointer calls per chunk-draw).
//
// TRUE SECTIONS: the section slab clips the ray-box interval analytically in the
// fragment shader (a couple of dots + interval min/max on top of the existing
// slab test) — a block straddling the plane shows its CUT INTERIOR (flat, plane
// normal, slightly darkened) instead of vanishing or poking through. The vertex
// cull keeps anything TOUCHING the slab (box support radius along the normal);
// demoted splats keep the centroid test (sub-pixel, and a splat can't clip).
//
// Positions are IJK-exact (§2.5): center = uGridOrigin + aIjk · uGridSize, with
// uGridOrigin the frame-local centroid of block (0,0,0).


const VERT$gl_blocks = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;        // uint16 raw (integer lattice)
layout(location=1) in float aChan;      // uint16 normalized (per-chunk range)
layout(location=2) in float aCat;       // uint8 raw
layout(location=3) in uint aRec;        // uint32 record index (the join key)
layout(location=4) in uint aDim;        // uint8 size code → uDimPalette (sub-blocked)
uniform mat4 uViewProj;
uniform vec3 uEye, uRight, uUp;
uniform vec3 uGridOrigin, uGridSize;
uniform sampler2D uDimPalette;          // Nx1 RGBA32F: per-code half-dims (box radius)
uniform float uSubBlock;                // 1 = variable-size boxes (read aDim → palette)
uniform float uPerspScale;              // persp: px/world at distance 1; ortho: px/world flat
uniform float uOrtho;                   // 1 = orthographic (skip the /dist)
uniform float uDemotePx, uPointPx;
uniform int uColorMode;                 // 0 elevation | 1 grade | 2 category | 3 solid
uniform vec2 uZRange;
uniform vec2 uChanChunk;                // this chunk's [min, span] (dequantize aChan)
uniform vec2 uChanDoc;                  // document [min, span] (ramp normalization)
uniform sampler2D uRamp;
uniform sampler2D uPalette;
uniform sampler2D uMask;                // filter bitmask by record index (8192-wide)
uniform float uFilterOn, uIsolate;
uniform sampler2D uSel;
uniform float uSelOn;
uniform sampler2D uCatVis;              // 256x1 per-class visibility
uniform float uCatVisOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code replaces the category
uniform sampler2D uChanTex;             // OPT-IN: raw f32 VALUE by record index (8192-wide rows) —
uniform float uChanTexOn;               // replaces aChan; how a never-materialized grade gets drawn
uniform float uForceSplat;              // 1 = whole chunk demoted (cheap far-field path)
uniform float uFixedSplat;              // 1 = points view: fixed-px splats regardless of block size
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)                   // record index to highlight (0xFFFFFFFF = none)
uniform uvec2 uRepaint;                 // repaint pass: draw ONLY these two records (both 0xFFFFFFFF = off)
uniform vec4 uSecPlane;                 // section plane: xyz = unit normal, w = offset (frame-local)
uniform vec2 uSecCfg;                   // x: 0 = off, 1 = slab; y: slab half-thickness
flat out vec3 vCenter;
flat out vec3 vHalf;
flat out vec4 vColor;
flat out float vMode;                   // 0 = impostor, 1 = splat
flat out float vCull;
flat out float vPxR;                    // projected radius (edge-line fade near demotion)
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = uGridOrigin + aIjk * uGridSize;
  vec3 half_ = uSubBlock > 0.5 ? texelFetch(uDimPalette, ivec2(int(aDim), 0), 0).rgb : uGridSize * 0.5;
  float r = length(half_);
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;              // ortho: size is distance-free
  float pxR = r * uPerspScale / distEff;
  float demoted = max(max(pxR < uDemotePx ? 1.0 : 0.0, uForceSplat), uFixedSplat);
  // filter mask: dim (default) or cull (isolate)
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // section cull: keep any box that TOUCHES the slab (support radius of the box
  // along the plane normal) — the fragment shader then clips the ray interval
  // EXACTLY, so straddling blocks show their true cut instead of vanishing.
  // Demoted splats can't clip, so they keep the centroid test (sub-pixel there).
  float secSupp = demoted > 0.5 ? 0.0 : dot(half_, abs(uSecPlane.xyz));
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp) ? 1.0 : 0.0;
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  float quadR = uFixedSplat > 0.5
    ? uPointPx * 0.5 * distEff / uPerspScale
    : mix(r, max(uPointPx * 0.5, pxR) * distEff / uPerspScale, demoted);
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp = center + (uRight * corner.x + uUp * corner.y) * quadR;
  gl_Position = uViewProj * vec4(wp, 1.0);
  vCenter = center; vHalf = half_; vMode = demoted; vCorner = corner; vWorldPos = wp; vPxR = pxR;
  if (uColorMode == 0) {
    float t = clamp((center.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 1) {
    int cr = int(aRec);
    float v = uChanTexOn > 0.5
      ? texelFetch(uChanTex, ivec2(cr & 8191, cr >> 13), 0).r
      : uChanChunk.x + aChan * uChanChunk.y;
    float t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / 256.0, 0.5));
  } else {
    vColor = vec4(0.62, 0.63, 0.66, 1.0);
  }
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    if (texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);   // context mode: dim non-matching (still legible)
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);   // picked: hot magenta — the hue viridis doesn't have
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // repaint pass: everything else clips out
}`;

// 4×4-Bayer screen-door opacity (same as gl-mesh): drops a fraction of pixels by a
// stable dither → "see through" the model WITHOUT alpha blending, so real depth
// writes + occlusion stay correct and no back-to-front sort is needed.
const SCREENDOOR$gl_blocks = `
uniform float uOpacity;
const float _BAYER[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
bool _screendoor() { if (uOpacity >= 0.999) return false; int bi = (int(gl_FragCoord.x) & 3) + ((int(gl_FragCoord.y) & 3) << 2); return uOpacity < (_BAYER[bi] + 0.5) / 16.0; }`;

const FRAG$gl_blocks = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
flat in float vPxR;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;                      // view direction (ortho rays are parallel)
uniform float uOrthoRay;                // 1 = ortho: origin per fragment, direction = uFwd
uniform float uBackoff;                 // how far behind the quad the ortho ray starts
uniform vec3 uLightDir;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform float uEdges;                   // 1 = draw block edge lines (View toggle)
out vec4 outColor;
${SCREENDOOR$gl_blocks}
void main() {
  if (vCull > 0.5) discard;             // isolate mode: filtered-out block
  if (_screendoor()) discard;           // per-layer opacity (screen-door)
  if (vMode > 0.5) {                    // demoted splat: circular mask, rasterizer depth
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outColor = vColor;
    return;
  }
  // ray-AABB slab test in frame-local space (perspective: from the eye;
  // orthographic: parallel rays -- origin backed off along the view direction)
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  vec3 inv = 1.0 / rd;                  // IEEE inf on axis-parallel rays is fine here
  vec3 t0 = (vCenter - vHalf - ro) * inv;
  vec3 t1 = (vCenter + vHalf - ro) * inv;
  vec3 tmin3 = min(t0, t1), tmax3 = max(t0, t1);
  float tin = max(max(tmin3.x, tmin3.y), tmin3.z);
  float tout = min(min(tmax3.x, tmax3.y), tmax3.z);
  if (tin > tout || tout < 0.0) discard;
  // face normal = the slab that produced the BOX entry (chosen pre-clip)
  vec3 n = vec3(0.0);
  if (tin == tmin3.x) n = vec3(-sign(rd.x), 0.0, 0.0);
  else if (tin == tmin3.y) n = vec3(0.0, -sign(rd.y), 0.0);
  else n = vec3(0.0, 0.0, -sign(rd.z));
  // TRUE SECTION: intersect the ray-box interval with the ray-slab interval.
  // When the slab plane replaces the box entry, the visible surface is the CUT
  // INTERIOR — flat, plane normal, slightly darkened — so a thin section reads
  // as a continuous painted wall instead of a ragged centroid subset.
  float cutFace = 0.0;
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(den) < 1e-9) { if (abs(dc) > uSecCfg.y) discard; }
    else {
      float ta = (-uSecCfg.y - dc) / den, tb = (uSecCfg.y - dc) / den;
      float sIn = min(ta, tb), sOut = max(ta, tb);
      if (sIn > tin) { tin = sIn; cutFace = -sign(den); }
      tout = min(tout, sOut);
      if (tin > tout || tout < 0.0) discard;
    }
  }
  float t = tin > 0.0 ? tin : tout;     // inside the box → exit face
  bool onCut = cutFace != 0.0 && t == tin;
  if (onCut) n = uSecPlane.xyz * cutFace;
  vec3 p = ro + rd * t;
  vec4 clip = uViewProj * vec4(p, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  float shade = (0.55 + 0.45 * max(dot(n, uLightDir), 0.0)) * (onCut ? 0.85 : 1.0);
  // BLOCK EDGES (toggle): the hit point in box-local coords — on a face, one
  // axis sits at ±1 and the SECOND-largest → 1 marks an edge; on a cut face
  // (interior) the LARGEST → 1 outlines the cut polygon (block boundaries on
  // the section wall). fwidth gives a ~screen-constant line; fade the effect
  // out as the block shrinks toward demotion so the far field stays clean.
  if (uEdges > 0.5) {
    vec3 a2 = abs(p - vCenter) / vHalf;
    float m1 = max(a2.x, max(a2.y, a2.z));
    float m2 = max(min(a2.x, a2.y), min(max(a2.x, a2.y), a2.z));
    float e = onCut ? m1 : m2;
    float dpx = (1.0 - e) / max(fwidth(e), 1e-6);          // distance to the edge in pixels
    float edge = 1.0 - clamp(dpx * 0.7 - 0.3, 0.0, 1.0);   // ~1.5 px, soft falloff
    edge *= clamp((vPxR - 5.0) / 8.0, 0.0, 1.0);           // fade below ~13 px projected radius
    shade *= 1.0 - 0.4 * edge;
  }
  outColor = vec4(vColor.rgb * shade, vColor.a);
}`;

// Far-field fragment: splat only, NO gl_FragDepth anywhere → early-z stays
// enabled for these draws — the perf lever for distant chunks (§2.3 mitigation).
const FRAG_CHEAP$gl_blocks = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in vec4 vColor;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uLightDir;
uniform mat4 uViewProj;
out vec4 outColor;
${SCREENDOOR$gl_blocks}
void main() {
  if (vCull > 0.5) discard;
  if (_screendoor()) discard;
  if (dot(vCorner, vCorner) > 1.0) discard;
  outColor = vColor;
}`;

// Golden-angle hue walk → visually distinct category colors (code → color).
function categoryPalettePixels(n = 256) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const h = (i * 137.508) % 360, s = 0.55, l = 0.58;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    out[i * 4] = Math.round((r + m) * 255); out[i * 4 + 1] = Math.round((g + m) * 255); out[i * 4 + 2] = Math.round((b + m) * 255); out[i * 4 + 3] = 255;
  }
  return out;
}

function createBlocksPipeline(gl) {
  const mkProg = (frag) => {
    const prog = makeProgram(gl, VERT$gl_blocks, frag);
    const U = (n) => gl.getUniformLocation(prog, n);
    return { prog, uni: {
      viewProj: U('uViewProj'), eye: U('uEye'), right: U('uRight'), up: U('uUp'),
      gridOrigin: U('uGridOrigin'), gridSize: U('uGridSize'),
      dimPalette: U('uDimPalette'), subBlock: U('uSubBlock'), opacity: U('uOpacity'),
      perspScale: U('uPerspScale'), demotePx: U('uDemotePx'), pointPx: U('uPointPx'),
      colorMode: U('uColorMode'), zRange: U('uZRange'), chanChunk: U('uChanChunk'), chanDoc: U('uChanDoc'),
      ramp: U('uRamp'), palette: U('uPalette'), lightDir: U('uLightDir'),
      mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), forceSplat: U('uForceSplat'), fixedSplat: U('uFixedSplat'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
      catVis: U('uCatVis'), catVisOn: U('uCatVisOn'), sel: U('uSel'), selOn: U('uSelOn'),
      rule: U('uRule'), ruleOn: U('uRuleOn'),
      chanTex: U('uChanTex'), chanTexOn: U('uChanTexOn'),
      secPlane: U('uSecPlane'), secCfg: U('uSecCfg'), edges: U('uEdges'),
      ortho: U('uOrtho'), fwd: U('uFwd'), orthoRay: U('uOrthoRay'), backoff: U('uBackoff'),
    } };
  };
  const full = mkProg(FRAG$gl_blocks), cheap = mkProg(FRAG_CHEAP$gl_blocks);
  let active = full;

  // Upload one BlockChunk → buffers + a VAO whose instance pointers get re-aimed
  // per slice. CPU arrays are free to die after this returns.
  function upload(chunk) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mkBuf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const bIjk = mkBuf(chunk.ijk), bChan = mkBuf(chunk.chan), bCat = mkBuf(chunk.cat);
    const bRec = mkBuf(chunk.recIdx);                      // filter-mask lookup + pick pass
    const sub = !!(chunk.dim && chunk.dimPalette);
    const bDim = sub ? mkBuf(chunk.dim) : null;            // per-block u8 size code
    gl.bindVertexArray(null);
    // sub-blocked: a small Nx1 RGBA32F palette of half-dims (box radii). NEAREST
    // sampling of a float texture is core WebGL2 (only float RENDER needs an ext).
    let dimTex = null;
    if (sub) {
      const pal = chunk.dimPalette, data = new Float32Array(pal.length * 4);
      for (let i = 0; i < pal.length; i++) { data[i * 4] = pal[i][0]; data[i * 4 + 1] = pal[i][1]; data[i * 4 + 2] = pal[i][2]; }
      dimTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, dimTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, pal.length, 1, 0, gl.RGBA, gl.FLOAT, data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    }
    return {
      kind: 'blocks', vao, buffers: sub ? [bIjk, bChan, bCat, bRec, bDim] : [bIjk, bChan, bCat, bRec],
      bIjk, bChan, bCat, bRec, bDim, dimTex, dimPalette: sub ? chunk.dimPalette : null,
      count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0,
      grid: chunk.grid, chanRange: chunk.chanRange,
    };
  }

  // Aim the instance attributes at element `first` and draw k instances.
  // useCheap: the whole chunk projects below the demotion threshold, so the
  // no-gl_FragDepth program (early-z enabled) draws it as forced splats.
  function drawSlice(c, first, k, useCheap = false) {
    const pp = useCheap ? cheap : full;
    if (pp !== active) { gl.useProgram(pp.prog); active = pp; }
    const uni = active.uni;
    gl.uniform1f(uni.forceSplat, useCheap ? 1 : 0);
    gl.bindVertexArray(c.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, first * 6);
    gl.vertexAttribDivisor(0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, true, 0, first * 2);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, first);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, first * 4);
    gl.vertexAttribDivisor(3, 1);
    if (c.dimTex) {                                         // sub-blocked: per-block size code + palette
      gl.bindBuffer(gl.ARRAY_BUFFER, c.bDim);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_BYTE, 0, first);
      gl.vertexAttribDivisor(4, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, c.dimTex);
      gl.uniform1f(uni.subBlock, 1);
    } else {
      gl.disableVertexAttribArray(4);
      // A disabled `in uint aDim` reads the generic current value, which defaults to
      // FLOAT — a type mismatch vs the uint declaration (GL_INVALID_OPERATION at draw).
      // Give it a valid uint default; aDim is unused when uSubBlock=0, so 0 is a no-op.
      gl.vertexAttribI4ui(4, 0, 0, 0, 0);
      gl.uniform1f(uni.subBlock, 0);
    }
    gl.uniform3f(uni.gridOrigin, c.grid.originLocal[0], c.grid.originLocal[1], c.grid.originLocal[2]);
    gl.uniform3f(uni.gridSize, c.grid.size[0], c.grid.size[1], c.grid.size[2]);
    const span = c.chanRange[1] - c.chanRange[0];
    gl.uniform2f(uni.chanChunk, c.chanRange[0], span > 0 ? span : 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
  }

  // Per-frame program state (called once before the chunk loop) — set on BOTH
  // programs so drawSlice can switch freely between full and cheap.
  function begin(cam, { pointPx, colorMode, zRange, chanDoc, ramp, palette, viewportH, maskTex = null, isolate = false, pointsView = false, picked = 0xFFFFFFFF, pickedLayer = 0xFFFFFFFF, layer = 0, section = null, catVisTex = null, selTex = null, ruleTex = null, chanTex = null, opacity = 1, edges = false }) {
    const s = cam.state;
    for (const pp of [full, cheap]) {
      gl.useProgram(pp.prog);
      const uni = pp.uni;
      gl.uniformMatrix4fv(uni.viewProj, false, s.viewProj);
      gl.uniform3f(uni.eye, s.eye[0], s.eye[1], s.eye[2]);
      const v = s.view;                                    // camera basis = view-matrix rotation rows
      gl.uniform3f(uni.right, v[0], v[4], v[8]);
      gl.uniform3f(uni.up, v[1], v[5], v[9]);
      // headlight, slightly above the view direction
      let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
      const l2 = Math.hypot(lx, ly, lz) || 1;
      gl.uniform3f(uni.lightDir, lx / l2, ly / l2, lz / l2);
      gl.uniform1f(uni.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uni.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uni.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uni.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uni.backoff, s.radius * 2);
      }
      gl.uniform1f(uni.demotePx, 2.0);
      gl.uniform1f(uni.pointPx, pointPx * (window.devicePixelRatio || 1));
      gl.uniform1i(uni.colorMode, colorMode);
      gl.uniform2f(uni.zRange, zRange[0], zRange[1]);
      gl.uniform2f(uni.chanDoc, chanDoc[0], chanDoc[1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.dimPalette, 2);   // unit 2 = per-chunk sub-block half-dims; a complete default so regular draws never sample incomplete
      gl.uniform1f(uni.subBlock, 0);
      gl.uniform1f(uni.opacity, Math.max(0.02, Math.min(1, opacity)));   // per-layer screen-door opacity
      gl.uniform1f(uni.fixedSplat, pointsView ? 1 : 0);
      gl.uniform1ui(uni.picked, picked >>> 0);
      gl.uniform1ui(uni.pickedLayer, pickedLayer >>> 0);
      gl.uniform1ui(uni.layer, layer >>> 0);              // this draw's layer — the id no longer hides in aRec
      gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
      gl.uniform4f(uni.secPlane, section ? section.n[0] : 0, section ? section.n[1] : 0, section ? section.n[2] : 1, section ? section.d : 0);
      gl.uniform2f(uni.secCfg, section ? 1 : 0, section ? section.half : 0);
      gl.uniform1f(uni.edges, edges ? 1 : 0);
      gl.uniform1f(uni.filterOn, maskTex ? 1 : 0);
      gl.uniform1f(uni.isolate, isolate ? 1 : 0);
      if (maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uni.mask, 4); }
      gl.uniform1f(uni.catVisOn, catVisTex ? 1 : 0);
      if (catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, catVisTex); gl.uniform1i(uni.catVis, 5); }
      gl.uniform1f(uni.selOn, selTex ? 1 : 0);
      if (selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, selTex); gl.uniform1i(uni.sel, 6); }
      gl.uniform1f(uni.ruleOn, ruleTex ? 1 : 0);
      if (ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ruleTex); gl.uniform1i(uni.rule, 7); }
      gl.uniform1f(uni.chanTexOn, chanTex ? 1 : 0);
      if (chanTex) { gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, chanTex); gl.uniform1i(uni.chanTex, 8); }
    }
    active = full;
    gl.useProgram(full.prog);
  }

  // The pick-repaint pass (gl.js): both programs get the target pair, then the
  // lazily-tracked active program is restored so drawSlice's cache stays honest.
  function setRepaint(a, b) {
    for (const pp of [full, cheap]) { gl.useProgram(pp.prog); gl.uniform2ui(pp.uni.repaint, a >>> 0, b >>> 0); }
    if (active) gl.useProgram(active.prog);
  }

  return { upload, drawSlice, begin, setRepaint };
}

// ── src/core/gl-pick.js ──

// @gcu/condenser — GPU ID-buffer picking. On click, the visible chunks re-render
// once into an offscreen target with the fragment shaders outputting the RECORD
// INDEX encoded as RGBA8 instead of a color, scissored to the cursor pixel; one
// readPixels + decode gives the exact element under the cursor. The SAME analytic
// geometry that renders decides the pick — the impostor's ray-AABB test and real
// depth writes resolve which block face is hit, pixel-perfect at any zoom. No CPU
// spatial index. The record index is THE join key (micro-spec §4): a pick is a
// row number in the source file.


// no encoder: the pick target is RG32UI (R = record, G = layer + face), so the
// ids go out as integers instead of being smeared across four bytes and
// reassembled. The layer needs 6 bits and has 32, so the FACE of the hit rides
// in the spare ones — the fragment shader already solved the ray-box entry to
// write true depth, and throwing that away meant the CPU had to re-derive it
// (a second ray-AABB + sub-block dims + slab clip, drifting from what was drawn).
//
//   G = (layer & 0xFFFF) | (face << 16)
//   face: 0=−X 1=+X 2=−Y 3=+Y 4=−Z 5=+Z, 6 = the SECTION CUT wall, 7 = none
//
// Naming the face names the PLANE, so the exact hit point is ray ∩ plane — one
// line on the CPU, and it agrees with the pixel by construction.
const ENCODE = '';
const PACK = `
const uint NO_FACE = 7u;
uint packId(uint layer, uint face) { return (layer & 0xFFFFu) | (face << 16); }`;

// ── points ──
const PICK_VERT_PTS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in float aClass;
layout(location=4) in uint aRec;
uniform mat4 uViewProj;
uniform vec3 uBoxMin, uBoxSpan;
uniform float uPointPx;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform sampler2D uRule;
uniform float uRuleOn;
flat out uint vRec;
flat out float vCull;
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = uPointPx;
  vRec = aRec;
  vCull = (uSecCfg.x > 0.5 && abs(dot(p, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y) ? 1.0 : 0.0;
  if (uFilterOn > 0.5 && uIsolate > 0.5) {
    int rec = int(aRec);
    if (texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r < 0.5) vCull = 1.0;   // isolated-away isn't pickable
  }
  float cls = aClass;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
}`;
const PICK_FRAG_PTS = `#version 300 es
precision highp float;
flat in uint vRec;
flat in float vCull;
uniform uint uLayer;                    // the layer is per-DRAW, not per-element
out uvec4 outId;                        // R = record (full uint32), G = layer | face<<16
${PACK}
void main() {
  if (vCull > 0.5) discard;
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);   // a splat has no face
}`;

// ── blocks (geometry identical to gl-blocks; color replaced by the encoded id) ──
const PICK_VERT_BLK = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;
layout(location=2) in float aCat;
layout(location=3) in uint aRec;
layout(location=4) in uint aDim;
uniform mat4 uViewProj;
uniform vec3 uEye, uRight, uUp;
uniform vec3 uGridOrigin, uGridSize;
uniform sampler2D uDimPalette;
uniform float uSubBlock;
uniform float uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform sampler2D uRule;
uniform float uRuleOn;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vCenter;
flat out vec3 vHalf;
flat out uint vRec;
flat out float vMode;
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = uGridOrigin + aIjk * uGridSize;
  vec3 half_ = uSubBlock > 0.5 ? texelFetch(uDimPalette, ivec2(int(aDim), 0), 0).rgb : uGridSize * 0.5;
  float r = length(half_);
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  float pxR = r * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float quadR = uFixedSplat > 0.5
    ? uPointPx * 0.5 * distEff / uPerspScale
    : mix(r, max(uPointPx * 0.5, pxR) * distEff / uPerspScale, demoted);
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp = center + (uRight * corner.x + uUp * corner.y) * quadR;
  gl_Position = uViewProj * vec4(wp, 1.0);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  // touch-the-slab cull (support radius) — the fragment clips exactly, matching
  // the visual true-section cut so the cut wall is pickable
  float secSupp = demoted > 0.5 ? 0.0 : dot(half_, abs(uSecPlane.xyz));
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp) ? 1.0 : 0.0;
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);   // hidden (isolated or sectioned) isn't pickable
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  vCenter = center; vHalf = half_; vRec = aRec; vMode = demoted; vCorner = corner; vWorldPos = wp;
}`;
const PICK_FRAG_BLK = `#version 300 es
precision highp float;
flat in vec3 vCenter;
flat in vec3 vHalf;
flat in uint vRec;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform uint uLayer;
out uvec4 outId;
${PACK}
void main() {
  if (vCull > 0.5) discard;
  if (vMode > 0.5) {
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);  // demoted to a splat: no box, no face
    return;
  }
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (vCenter - vHalf - ro) * inv;
  vec3 t1 = (vCenter + vHalf - ro) * inv;
  vec3 tmin3 = min(t0, t1), tmax3 = max(t0, t1);
  float tin = max(max(tmin3.x, tmin3.y), tmin3.z);
  float tout = min(min(tmax3.x, tmax3.y), tmax3.z);
  if (tin > tout || tout < 0.0) discard;
  float tinBox = tin;                                    // the box entry, before any slab clip
  // clip by the section slab — the visible CUT surface is what picks (gl-blocks)
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(den) < 1e-9) { if (abs(dc) > uSecCfg.y) discard; }
    else {
      float ta = (-uSecCfg.y - dc) / den, tb = (uSecCfg.y - dc) / den;
      tin = max(tin, min(ta, tb));
      tout = min(tout, max(ta, tb));
      if (tin > tout || tout < 0.0) discard;
    }
  }
  float t = tin > 0.0 ? tin : tout;
  vec4 clip = uViewProj * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  // WHICH FACE the eye ray entered through: the axis that WON the box entry,
  // signed by the ray's direction along it (travelling +x → you hit the −X face).
  // If the slab clip pushed the entry past the box's own, you are looking at the
  // CUT, not a face. tin ≤ 0 means the eye is inside the block — no face.
  uint face = NO_FACE;
  if (tin > 0.0) {
    if (tin > tinBox + 1e-5) face = 6u;                  // the section cut wall
    else {
      uint ax = (tmin3.x >= tmin3.y && tmin3.x >= tmin3.z) ? 0u : ((tmin3.y >= tmin3.z) ? 1u : 2u);
      float rda = ax == 0u ? rd.x : (ax == 1u ? rd.y : rd.z);
      face = ax * 2u + (rda > 0.0 ? 0u : 1u);
    }
  }
  outId = uvec4(vRec, packId(uLayer, face), 0u, 0u);
}`;

// ── sticks (capsule geometry identical to gl-sticks; color = the encoded id) ──
const PICK_VERT_STK = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=3) in float aCat;
layout(location=4) in uint aRec;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uRadius, uPerspScale, uDemotePx, uPointPx, uFixedSplat, uOrtho;
uniform vec3 uFwd;
uniform sampler2D uMask;
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;
uniform float uCatVisOn;
uniform sampler2D uRule;
uniform float uRuleOn;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
flat out vec3 vA;
flat out vec3 vB;
flat out uint vRec;
flat out float vMode;
flat out float vCull;
out vec2 vCorner;
out vec3 vWorldPos;
void main() {
  vec3 center = (aA + aB) * 0.5;
  vec3 axis = aB - aA;
  float len = max(length(axis), 1e-6);
  vec3 u = axis / len;
  float dist = max(distance(uEye, center), 1e-3);
  float distEff = uOrtho > 0.5 ? 1.0 : dist;
  vec3 viewDir = uOrtho > 0.5 ? uFwd : (center - uEye) / dist;
  vec3 v = cross(u, viewDir);
  float vl = length(v);
  v = vl > 1e-4 ? v / vl : normalize(abs(u.z) < 0.9 ? cross(u, vec3(0.0, 0.0, 1.0)) : cross(u, vec3(1.0, 0.0, 0.0)));
  float pxR = (len * 0.5 + uRadius) * uPerspScale / distEff;
  float demoted = max(pxR < uDemotePx ? 1.0 : 0.0, uFixedSplat);
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
  }
  float secSupp = demoted > 0.5 ? 0.0 : (abs(dot(axis, uSecPlane.xyz)) * 0.5 + uRadius);
  float secCull = (uSecCfg.x > 0.5 && abs(dot(center, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y + secSupp) ? 1.0 : 0.0;
  vCull = max((uIsolate > 0.5 && m < 0.5) ? 1.0 : 0.0, secCull);
  float cls = aCat;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec3 wp;
  if (demoted > 0.5) {
    float quadR = max(uPointPx * 0.5, min(pxR, uPointPx * 2.0)) * distEff / uPerspScale;
    vec3 sv = normalize(cross(viewDir, v));
    wp = center + (v * corner.x + sv * corner.y) * quadR;
  } else {
    wp = center + u * (corner.x * (len * 0.5 + uRadius)) + v * (corner.y * uRadius);
  }
  gl_Position = uViewProj * vec4(wp, 1.0);
  vA = aA; vB = aB; vRec = aRec; vMode = demoted; vCorner = corner; vWorldPos = wp;
}`;
const PICK_FRAG_STK = `#version 300 es
precision highp float;
flat in vec3 vA;
flat in vec3 vB;
flat in uint vRec;
flat in float vMode;
flat in float vCull;
in vec2 vCorner;
in vec3 vWorldPos;
uniform vec3 uEye;
uniform vec3 uFwd;
uniform float uOrthoRay;
uniform float uBackoff;
uniform float uRadius;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform uint uLayer;
out uvec4 outId;
${PACK}
void main() {
  if (vCull > 0.5) discard;
  if (vMode > 0.5) {
    if (dot(vCorner, vCorner) > 1.0) discard;
    gl_FragDepth = gl_FragCoord.z;
    outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);
    return;
  }
  vec3 ro = uOrthoRay > 0.5 ? vWorldPos - uFwd * uBackoff : uEye;
  vec3 rd = uOrthoRay > 0.5 ? uFwd : normalize(vWorldPos - uEye);
  vec3 ba = vB - vA;
  vec3 oa = ro - vA;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa);
  float rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard;
  float b = baba * rdoa - baoa * bard;
  float c = baba * oaoa - baoa * baoa - uRadius * uRadius * baba;
  float h = b * b - a * c;
  float t = -1.0;
  if (h >= 0.0) {
    float tb = (-b - sqrt(h)) / max(a, 1e-9);
    float y = baoa + tb * bard;
    if (y > 0.0 && y < baba && tb > 0.0) t = tb;
  }
  if (t < 0.0) {
    for (int i = 0; i < 2; i++) {
      vec3 capC = i == 0 ? vA : vB;
      vec3 o2 = ro - capC;
      float b2 = dot(rd, o2);
      float c2 = dot(o2, o2) - uRadius * uRadius;
      float h2 = b2 * b2 - c2;
      if (h2 >= 0.0) {
        float t2 = -b2 - sqrt(h2);
        if (t2 > 0.0 && (t < 0.0 || t2 < t)) t = t2;
      }
    }
  }
  if (t < 0.0) discard;
  // section clip (convexity trick, matches gl-sticks): a hit outside the slab is
  // either the cut cross-section at the face or not pickable at all
  if (uSecCfg.x > 0.5) {
    float den = dot(rd, uSecPlane.xyz);
    float dc = dot(ro, uSecPlane.xyz) - uSecPlane.w;
    if (abs(dc + t * den) > uSecCfg.y) {
      if (abs(den) < 1e-9) discard;
      float sIn = min((-uSecCfg.y - dc) / den, (uSecCfg.y - dc) / den);
      if (sIn <= t) discard;
      vec3 q = ro + rd * sIn;
      vec3 qa = q - vA;
      float yq = clamp(dot(qa, ba) / baba, 0.0, 1.0);
      if (length(qa - ba * yq) > uRadius) discard;
      t = sIn;
    }
  }
  vec4 clip = uViewProj * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  outId = uvec4(vRec, packId(uLayer, NO_FACE), 0u, 0u);   // a capsule has no axis-aligned face
}`;

const NO_LAYER = 0xFFFFFFFF;                                // the layer channel's miss sentinel

// The G channel's contract, in ONE place. Anything that reads the pick buffer —
// pick(), pickRegion()'s callers, a rubber-band sweep — unpacks through these.
const layerOfId = (g) => (g >>> 0) & 0xFFFF;
const faceOfId = (g) => ((g >>> 16) & 7);
const isMiss = (g) => (g >>> 0) === NO_LAYER;
const NO_FACE = 7;
const FACE_CUT = 6;
// unit normals per face code, and the human name. index 6/7 have no normal.
const FACE_NORMALS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], null, null];
const FACE_NAMES = ['−X (west)', '+X (east)', '−Y (south)', '+Y (north)', '−Z (bottom)', '+Z (top)', 'section cut', '—'];
const MISS_CLEAR = new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF, 0, 0]);

// ── meshes ──
// A mesh has NO per-row records: it is a bag of triangles, not rows of a table.
// So the ID buffer answers only WHICH mesh (record = 0), and the CPU raycasts
// that mesh's BVH for the triangle + the exact point (winding's raycastBVH).
// WebGL2 has no gl_PrimitiveID, and un-indexing a mesh purely to carry a
// per-vertex triangle id would triple its vertex memory — for a click.
//
// The geometry and the SECTION behavior mirror gl-mesh exactly (including the
// trace-over-the-wall depth flatten): you must pick what you see, or the ID
// buffer is lying.
const PICK_VERT_MSH = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec4 uSecPlane;
out vec3 vWorldPos;
out float vSecDist;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vWorldPos = aPos;
  vSecDist = dot(aPos, uSecPlane.xyz) - uSecPlane.w;
}`;
const PICK_FRAG_MSH = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in float vSecDist;
uniform vec4 uSecPlane;
uniform vec2 uSecCfg;
uniform mat4 uViewProj;
uniform vec3 uEye, uFwd;
uniform float uOrtho;
uniform uint uLayer;
out uvec4 outId;
${PACK}
void main() {
  if (uSecCfg.x > 0.5 && abs(vSecDist) > uSecCfg.y) discard;
  gl_FragDepth = gl_FragCoord.z;
  if (uSecCfg.x > 0.5) {                                   // the visual flattens the in-slab trace onto the
    float dcEye = dot(uEye, uSecPlane.xyz) - uSecPlane.w;  // camera-side wall; the pick must agree or you
    if (abs(dcEye) > uSecCfg.y) {                          // would see a trace you cannot click
      float side = sign(dcEye);
      vec3 q; bool front = false;
      if (uOrtho > 0.5) {
        float den = dot(uFwd, uSecPlane.xyz);
        if (abs(den) > 1e-9) {
          float t = (vSecDist - side * uSecCfg.y) / den;
          if (t > 0.0) { q = vWorldPos - uFwd * t; front = true; }
        }
      } else {
        vec3 rdm = vWorldPos - uEye;
        float den = dot(rdm, uSecPlane.xyz);
        if (abs(den) > 1e-9) {
          float tF = (side * uSecCfg.y - dcEye) / den;
          if (tF > 0.0 && tF < 1.0) { q = uEye + rdm * tF; front = true; }
        }
      }
      if (front) {
        vec4 clipQ = uViewProj * vec4(q, 1.0);
        gl_FragDepth = clamp(clipQ.z / clipQ.w * 0.5 + 0.5, 0.0, 1.0) - 3e-5;
      }
    }
  }
  outId = uvec4(0u, packId(uLayer, NO_FACE), 0u, 0u);      // record 0: the CPU resolves the triangle
}`;

function createPickPipeline(gl) {
  const msh = makeProgram(gl, PICK_VERT_MSH, PICK_FRAG_MSH);
  const uMsh = {
    viewProj: gl.getUniformLocation(msh, 'uViewProj'), secPlane: gl.getUniformLocation(msh, 'uSecPlane'),
    secCfg: gl.getUniformLocation(msh, 'uSecCfg'), eye: gl.getUniformLocation(msh, 'uEye'),
    fwd: gl.getUniformLocation(msh, 'uFwd'), ortho: gl.getUniformLocation(msh, 'uOrtho'),
    layer: gl.getUniformLocation(msh, 'uLayer'),
  };
  const pts = makeProgram(gl, PICK_VERT_PTS, PICK_FRAG_PTS);
  const blk = makeProgram(gl, PICK_VERT_BLK, PICK_FRAG_BLK);
  const stk = makeProgram(gl, PICK_VERT_STK, PICK_FRAG_STK);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const uPts = { layer: U(pts, 'uLayer'), viewProj: U(pts, 'uViewProj'), boxMin: U(pts, 'uBoxMin'), boxSpan: U(pts, 'uBoxSpan'), pointPx: U(pts, 'uPointPx'), secPlane: U(pts, 'uSecPlane'), secCfg: U(pts, 'uSecCfg'), mask: U(pts, 'uMask'), filterOn: U(pts, 'uFilterOn'), isolate: U(pts, 'uIsolate'), catVis: U(pts, 'uCatVis'), catVisOn: U(pts, 'uCatVisOn'), rule: U(pts, 'uRule'), ruleOn: U(pts, 'uRuleOn') };
  const uBlk = {
    layer: U(blk, 'uLayer'),
    viewProj: U(blk, 'uViewProj'), eye: U(blk, 'uEye'), right: U(blk, 'uRight'), up: U(blk, 'uUp'),
    gridOrigin: U(blk, 'uGridOrigin'), gridSize: U(blk, 'uGridSize'),
    dimPalette: U(blk, 'uDimPalette'), subBlock: U(blk, 'uSubBlock'),
    perspScale: U(blk, 'uPerspScale'), demotePx: U(blk, 'uDemotePx'), pointPx: U(blk, 'uPointPx'), fixedSplat: U(blk, 'uFixedSplat'),
    ortho: U(blk, 'uOrtho'), fwd: U(blk, 'uFwd'), orthoRay: U(blk, 'uOrthoRay'), backoff: U(blk, 'uBackoff'),
    mask: U(blk, 'uMask'), filterOn: U(blk, 'uFilterOn'), isolate: U(blk, 'uIsolate'),
    catVis: U(blk, 'uCatVis'), catVisOn: U(blk, 'uCatVisOn'), rule: U(blk, 'uRule'), ruleOn: U(blk, 'uRuleOn'),
    secPlane: U(blk, 'uSecPlane'), secCfg: U(blk, 'uSecCfg'),
  };
  const uStk = {
    layer: U(stk, 'uLayer'),
    viewProj: U(stk, 'uViewProj'), eye: U(stk, 'uEye'), radius: U(stk, 'uRadius'),
    perspScale: U(stk, 'uPerspScale'), demotePx: U(stk, 'uDemotePx'), pointPx: U(stk, 'uPointPx'), fixedSplat: U(stk, 'uFixedSplat'),
    ortho: U(stk, 'uOrtho'), fwd: U(stk, 'uFwd'), orthoRay: U(stk, 'uOrthoRay'), backoff: U(stk, 'uBackoff'),
    mask: U(stk, 'uMask'), filterOn: U(stk, 'uFilterOn'), isolate: U(stk, 'uIsolate'),
    catVis: U(stk, 'uCatVis'), catVisOn: U(stk, 'uCatVisOn'), rule: U(stk, 'uRule'), ruleOn: U(stk, 'uRuleOn'),
    secPlane: U(stk, 'uSecPlane'), secCfg: U(stk, 'uSecCfg'),
  };
  let fbo = null, colorTex = null, depthTex = null, w = 0, h = 0;

  function ensure(width, height) {
    if (fbo && width === w && height === h) return;
    w = width; h = height;
    if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(colorTex); gl.deleteTexture(depthTex); }
    colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    // RG32UI: R = record (a full uint32), G = layer. Integer target → the ids are
    // read back as integers, with no byte packing anywhere.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, w, h, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // depth is a TEXTURE (not a renderbuffer): the deferred re-shade resolve
    // samples it to unproject each pixel's exact hit point (block edge lines)
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Pick at device pixel (px, py) (GL origin, bottom-left). Draws each chunk's
   * CURRENT accumulated prefix (you pick what you can see), scissored to the
   * pixel. Returns the record index, or null.
   */
  // the shared ID-buffer pass: scissored to (px,py,w,h), leaves the FBO bound
  // for the caller's readPixels. pick() reads 1px; pickRegion() reads the block.
  function renderInto(px, py, w2, h2, chunks, cam, { pointPx, blocksAsPoints = false, layerStates = null, section = null, viewportW, viewportH }) {
    const stateOf = (id) => (layerStates && layerStates.get(id)) || { maskTex: null, isolate: false };
    const byLayer = (arr) => {
      const m = new Map();
      for (const c of arr) { const id = c._layer || 0; let g = m.get(id); if (!g) m.set(id, g = []); g.push(c); }
      return m;
    };
    // per layer: an exempt layer (st.sectioned === false) picks whole
    const setSec = (u, st) => {
      let s = st && st.sectioned === false ? null : section;
      const pm = st ? st.sectioned : true;
      if (s && (pm === 'front' || pm === 'behind') && s.d0 !== undefined) { const H = Math.max(1e5, 8 * (s.half || 1)); s = { ...s, d: pm === 'front' ? s.d0 + H : s.d0 - H, half: H }; }
      gl.uniform4f(u.secPlane, s ? s.n[0] : 0, s ? s.n[1] : 0, s ? s.n[2] : 1, s ? s.d : 0);
      gl.uniform2f(u.secCfg, s ? 1 : 0, s ? s.half : 0);
    };
    // a mesh's section is a TRACE band at the true plane, not the fat half-space
    // slab the blocks use (gl.js meshSecOf) — mirror it or the pick disagrees
    // with the picture on exactly the views geologists spend their day in.
    const setSecMesh = (u, st) => {
      let s2 = st && st.sectioned === false ? null : section;
      const pm = st ? st.sectioned : true;
      const clip = s2 && (pm === 'front' || pm === 'behind' ? pm : s2.clip);
      if (s2 && (clip === 'front' || clip === 'behind') && s2.d0 !== undefined) {
        s2 = { ...s2, d: s2.d0, half: Math.max(0.01, s2.traceHalf || 1) };
      }
      gl.uniform4f(u.secPlane, s2 ? s2.n[0] : 0, s2 ? s2.n[1] : 0, s2 ? s2.n[2] : 1, s2 ? s2.d : 0);
      gl.uniform2f(u.secCfg, s2 ? 1 : 0, s2 ? s2.half : 0);
    };
    // hidden classes aren't pickable (same texture the visual pass culls by)
    const setCatVis = (u, st) => {
      const t = st && st.catVisTex;
      gl.uniform1f(u.catVisOn, t ? 1 : 0);
      if (t) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u.catVis, 5); }
    };
    // rule mode: the code substitutes for the class, so hidden RULES cull too
    const setRule = (u, st) => {
      const t = st && st.ruleOn && st.ruleTex;
      gl.uniform1f(u.ruleOn, t ? 1 : 0);
      if (t) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u.rule, 7); }
    };
    ensure(viewportW, viewportH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(px, py, w2, h2);
    gl.clearBufferuiv(gl.COLOR, 0, MISS_CLEAR);            // layer = NO_LAYER → "nothing here"
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const s = cam.state;
    const dpp = pointPx * (window.devicePixelRatio || 1);

    const ptsChunks = chunks.filter((c) => c.kind === 'points' && c.cursor > 0);
    if (ptsChunks.length) {
      gl.useProgram(pts);
      gl.uniformMatrix4fv(uPts.viewProj, false, s.viewProj);
      gl.uniform1f(uPts.pointPx, dpp);
      for (const [id, group] of byLayer(ptsChunks)) {
      const st = stateOf(id);
      gl.uniform1ui(uPts.layer, id >>> 0);
      setSec(uPts, st);
      setCatVis(uPts, st);
      setRule(uPts, st);
      gl.uniform1f(uPts.filterOn, st.maskTex ? 1 : 0);
      gl.uniform1f(uPts.isolate, st.isolate ? 1 : 0);
      if (st.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st.maskTex); gl.uniform1i(uPts.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        // wire the recIdx buffer as attr 4 (idempotent; the visual program ignores it)
        gl.bindBuffer(gl.ARRAY_BUFFER, c.buffers[c.buffers.length - 1]);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
        gl.uniform3f(uPts.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
        gl.uniform3f(uPts.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
        gl.drawArrays(gl.POINTS, 0, c.cursor);
      }
      }
    }

    const blkChunks = chunks.filter((c) => c.kind === 'blocks' && c.cursor > 0);
    if (blkChunks.length) {
      gl.useProgram(blk);
      gl.uniformMatrix4fv(uBlk.viewProj, false, s.viewProj);
      gl.uniform3f(uBlk.eye, s.eye[0], s.eye[1], s.eye[2]);
      const v = s.view;
      gl.uniform3f(uBlk.right, v[0], v[4], v[8]);
      gl.uniform3f(uBlk.up, v[1], v[5], v[9]);
      gl.uniform1f(uBlk.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uBlk.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uBlk.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uBlk.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uBlk.backoff, s.radius * 2);
      }
      gl.uniform1f(uBlk.demotePx, 2.0);
      gl.uniform1f(uBlk.pointPx, dpp);
      gl.uniform1f(uBlk.fixedSplat, blocksAsPoints ? 1 : 0);
      gl.uniform1i(uBlk.dimPalette, 2);                     // unit 2 = sub-block half-dims (per-chunk below)
      for (const [id, group] of byLayer(blkChunks)) {
        gl.uniform1ui(uBlk.layer, id >>> 0);
      const st = stateOf(id);
      setSec(uBlk, st);
      setCatVis(uBlk, st);
      setRule(uBlk, st);
      gl.uniform1f(uBlk.filterOn, st.maskTex ? 1 : 0);
      gl.uniform1f(uBlk.isolate, st.isolate ? 1 : 0);
      if (st.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st.maskTex); gl.uniform1i(uBlk.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, 0);
        gl.vertexAttribDivisor(3, 1);
        if (c.dimTex) {
          gl.bindBuffer(gl.ARRAY_BUFFER, c.bDim);
          gl.enableVertexAttribArray(4);
          gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_BYTE, 0, 0);
          gl.vertexAttribDivisor(4, 1);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, c.dimTex);
          gl.uniform1f(uBlk.subBlock, 1);
        } else {
          gl.disableVertexAttribArray(4);
          gl.vertexAttribI4ui(4, 0, 0, 0, 0);   // uint default for the disabled `in uint aDim` (see gl-blocks.js)
          gl.uniform1f(uBlk.subBlock, 0);
        }
        gl.uniform3f(uBlk.gridOrigin, c.grid.originLocal[0], c.grid.originLocal[1], c.grid.originLocal[2]);
        gl.uniform3f(uBlk.gridSize, c.grid.size[0], c.grid.size[1], c.grid.size[2]);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.cursor);
      }
      }
    }

    const stkChunks = chunks.filter((c) => c.kind === 'sticks' && c.cursor > 0);
    if (stkChunks.length) {
      gl.useProgram(stk);
      gl.uniformMatrix4fv(uStk.viewProj, false, s.viewProj);
      gl.uniform3f(uStk.eye, s.eye[0], s.eye[1], s.eye[2]);
      gl.uniform1f(uStk.perspScale, s.ortho ? (viewportH / 2) / s.halfH : (viewportH / 2) / Math.tan(s.fovY / 2));
      gl.uniform1f(uStk.ortho, s.ortho ? 1 : 0);
      gl.uniform1f(uStk.orthoRay, s.ortho ? 1 : 0);
      {
        const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
        const fl = Math.hypot(...f) || 1;
        gl.uniform3f(uStk.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
        gl.uniform1f(uStk.backoff, s.radius * 2);
      }
      gl.uniform1f(uStk.demotePx, 2.0);
      gl.uniform1f(uStk.pointPx, dpp);
      gl.uniform1f(uStk.fixedSplat, blocksAsPoints ? 1 : 0);
      for (const [id, group] of byLayer(stkChunks)) {
        gl.uniform1ui(uStk.layer, id >>> 0);
      const st2 = stateOf(id);
      setSec(uStk, st2);
      setCatVis(uStk, st2);
      setRule(uStk, st2);
      gl.uniform1f(uStk.radius, (st2 && st2.stickRadius) || 1);
      gl.uniform1f(uStk.filterOn, st2.maskTex ? 1 : 0);
      gl.uniform1f(uStk.isolate, st2.isolate ? 1 : 0);
      if (st2.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, st2.maskTex); gl.uniform1i(uStk.mask, 4); }
      for (const c of group) {
        gl.bindVertexArray(c.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bSeg);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribDivisor(0, 1);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.vertexAttribDivisor(1, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
        gl.vertexAttribDivisor(4, 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.cursor);
      }
      }
    }

    // ── meshes: WHICH mesh, not which triangle (the CPU's job) ──
    // Policy lives with the app: a layer may declare itself pickable. The default
    // is OPAQUE-ONLY, and that is deliberate — you make a context surface
    // see-through precisely so you can work on what is behind it, so a 50%
    // topography must not steal the click meant for the block under it.
    const mshChunks = chunks.filter((c) => c.kind === 'mesh' && c.idxCount > 0);
    if (mshChunks.length) {
      gl.useProgram(msh);
      gl.uniformMatrix4fv(uMsh.viewProj, false, s.viewProj);
      gl.uniform3f(uMsh.eye, s.eye[0], s.eye[1], s.eye[2]);
      const f = [s.target[0] - s.eye[0], s.target[1] - s.eye[1], s.target[2] - s.eye[2]];
      const fl = Math.hypot(...f) || 1;
      gl.uniform3f(uMsh.fwd, f[0] / fl, f[1] / fl, f[2] / fl);
      gl.uniform1f(uMsh.ortho, s.ortho ? 1 : 0);
      for (const [id, group] of byLayer(mshChunks)) {
        const st = stateOf(id);
        const pickable = st.meshPickable != null ? st.meshPickable : (st.meshOpacity == null || st.meshOpacity >= 0.95);
        if (!pickable) continue;
        gl.uniform1ui(uMsh.layer, id >>> 0);
        setSecMesh(uMsh, st);                              // the TRACE band, exactly as gl.js's meshSecOf draws it
        for (const c of group) {
          gl.bindVertexArray(c.vao);
          gl.drawElements(gl.TRIANGLES, c.idxCount, gl.UNSIGNED_INT, 0);
        }
      }
    }

    gl.disable(gl.SCISSOR_TEST);
  }

  // → { layer, rec } or null. Both come straight out of the integer target: no
  // byte reassembly, and the RECORD may use the full 32-bit range because the
  // miss sentinel now lives in the LAYER channel.
  function pick(px, py, chunks, cam, opts) {
    renderInto(px, py, 1, 1, chunks, cam, opts);
    const out = new Uint32Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (out[1] === NO_LAYER) return null;
    const g = out[1] >>> 0;
    return { layer: g & 0xFFFF, rec: out[0] >>> 0, face: (g >>> 16) & 7 };
  }

  // one ID-buffer pass over a RECT (device px, GL bottom-left origin) — the
  // marquee/lasso read. Same programs, same per-layer gates; returns the raw
  // RGBA block (rows bottom-up); the caller masks by polygon and decodes.
  // the marquee/lasso read: a Uint32Array of 4 components per pixel (rows
  // bottom-up) — [0] = record, [1] = layer | face<<16 (NO_LAYER = nothing there;
  // unpack with layerOfId/faceOfId, never by reading [1] raw)
  function pickRegion(px, py, w2, h2, chunks, cam, opts) {
    renderInto(px, py, w2, h2, chunks, cam, opts);
    const out = new Uint32Array(w2 * h2 * 4);
    gl.readPixels(px, py, w2, h2, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return out;
  }

  // deferred re-shade (gl-resolve.js): render the FULL-VIEWPORT id buffer and
  // hand back the target texture itself — NO readPixels; the resolve pass
  // samples it on the GPU. The texture stays owned by this pipeline; later
  // pick()/pickRegion() calls repaint scissored regions of it with the same
  // camera + geometry, so within one capture generation (camera and structure
  // frozen — the caller invalidates on any moving frame) the content stays
  // consistent. Leaves FBO at null; the caller restores its own target.
  function captureViewport(chunks, cam, opts) {
    renderInto(0, 0, opts.viewportW, opts.viewportH, chunks, cam, opts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return { tex: colorTex, depth: depthTex, w, h };
  }

  return { pick, pickRegion, captureViewport, NO_LAYER };
}

// ── ../dm/src/dm.js ──

// @gcu/dm — Datamine .DM file reader (READ-ONLY). Zero-dependency, browser-native.
//
// Provenance / legal: the format is reverse-engineered from two public,
// independent sources — VMine.com's format description (explicitly NOT from
// Constellation/Datamine copyright material) and Jeremy Maccelari's BSD-licensed
// ParaViewGeo `dmfile.h` (1999). The .DM file format is excluded from copyright
// under the EU Software Directive. Full spec + references: SPEC.md. MIT.
//
// Two sub-formats share the .dm extension: Single Precision (SP, 2048-byte pages,
// Float32, 4-byte words) and Extended Precision (EP, 4096-byte pages, Float64,
// 8-byte words). Page 1 = Data Definition (fields); pages 2+ = packed records.
// The last 16 bytes of every page are a legacy security block (skipped). Both
// variants leave 508 usable words per page.

class DMFormatError extends Error {
  constructor(msg) { super(msg); this.name = 'DMFormatError'; }
}

const USABLE_WORDS = 508;      // per page, both SP and EP (16-byte security tail)
const SENTINEL = 0.9e30;       // |value| above this = a Datamine special (missing/inf/trace)

const toDV = (b) => (b instanceof DataView ? b : new DataView(b.buffer ? b.buffer : b, b.byteOffset || 0, b.byteLength));

// Read N words as text: 4 ASCII chars per word (in EP, the first 4 bytes of each
// 8-byte word; the rest is padding). Non-printable bytes dropped; result trimmed.
function readText(dv, off, nWords, ws) {
  let s = '';
  for (let w = 0; w < nWords; w++) {
    const base = off + w * ws;
    for (let b = 0; b < 4; b++) {
      if (base + b >= dv.byteLength) break;
      const ch = dv.getUint8(base + b);
      if (ch >= 32 && ch < 127) s += String.fromCharCode(ch);
    }
  }
  return s.trim();
}

// Recover an EP extended field name (>8, up to 24 chars), or null if the entry
// isn't flagged long. EP-only: SP's 4-byte words have no high half. Leapfrog and
// other modern exporters hide chars 9–24 in bytes a legacy 8-char reader skips,
// flagged by ASCII "LONG" in the high half of the type word — so old readers
// still see a valid 8-char name (the encoding is purely additive). Chars 1–8 =
// low halves of words 0–1; 9–16 = their high halves; 17–24 = word 5 (low then
// high). Internal spaces kept; trailing pad stripped. Reverse-engineered from
// real Leapfrog EP exports (independent byte observation), not from Datamine
// copyright material. See SPEC §3.2.1.
function readLongName(dv, o, ws) {
  if (ws !== 8) return null;                              // EP-only mechanism
  if (o + ws * 5 + 8 > dv.byteLength) return null;        // truncated buffer → legacy path
  const flag = o + ws * 2 + 4;                            // high half of the type word
  const LONG = [0x4C, 0x4F, 0x4E, 0x47];                  // "LONG"
  for (let b = 0; b < 4; b++) if (dv.getUint8(flag + b) !== LONG[b]) return null;
  const segs = [o, o + ws, o + 4, o + ws + 4, o + ws * 5, o + ws * 5 + 4];
  //           low(w0) low(w1) high(w0) high(w1) low(w5)   high(w5)
  let s = '';
  for (const base of segs)
    for (let b = 0; b < 4; b++) {
      const c = dv.getUint8(base + b);
      s += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' ';
    }
  return s.replace(/\s+$/, '') || null;                   // strip trailing pad, keep internal spaces
}

const FMTS = [['sp', 'le'], ['sp', 'be'], ['ep', 'le'], ['ep', 'be']];
const wordSize = (p) => (p === 'ep' ? 8 : 4);
const pageSize = (p) => (p === 'ep' ? 4096 : 2048);
const dateOffOf = (p) => (p === 'ep' ? 192 : 96);

/**
 * Detect { precision: 'sp'|'ep', byteOrder: 'le'|'be' } from the file head
 * (≥ one page recommended), or null if it isn't a recognizable .dm. There's no
 * magic number: validate NVAR (1–500, integral) + a printable first field name.
 */
function detectDM(bytes) {
  const dv = toDV(bytes);
  for (const [precision, byteOrder] of FMTS) {
    const ws = wordSize(precision), isLE = byteOrder === 'le';
    const fcOff = dateOffOf(precision) + ws;                         // NVAR position
    if (fcOff + ws > dv.byteLength) continue;
    const fc = precision === 'ep' ? dv.getFloat64(fcOff, isLE) : dv.getFloat32(fcOff, isLE);
    const n = Math.round(fc);
    if (n < 1 || n > 500 || Math.abs(fc - n) > 0.01) continue;
    const fieldStart = dateOffOf(precision) + ws * 4;
    let printable = fieldStart + 4 <= dv.byteLength;
    for (let b = 0; printable && b < 4; b++) { const c = dv.getUint8(fieldStart + b); if (c < 32 || c >= 127) printable = false; }
    if (printable) return { precision, byteOrder };
  }
  return null;
}

/**
 * Parse the Data Definition (page 1) into a header: field schema, record layout,
 * and counts. `fmt` (from detectDM) is optional — detected if omitted. `bytes`
 * need only cover the first page.
 */
function parseHeader(bytes, fmt) {
  const dv = toDV(bytes);
  const f = fmt || detectDM(bytes);
  if (!f) throw new DMFormatError('not a recognizable .dm file (no SP/EP + endianness matched)');
  const { precision, byteOrder } = f;
  const ws = wordSize(precision), ps = pageSize(precision), isLE = byteOrder === 'le';
  const readNum = precision === 'ep' ? (o) => dv.getFloat64(o, isLE) : (o) => dv.getFloat32(o, isLE);

  const dateOff = dateOffOf(precision);
  const filename = readText(dv, 0, 2, ws);
  const description = readText(dv, precision === 'ep' ? 32 : 16, 20, ws);
  const dateNum = Math.round(readNum(dateOff));
  const nvar = Math.round(readNum(dateOff + ws));
  const lastPage = Math.round(readNum(dateOff + ws * 2));
  const lastRec = Math.round(readNum(dateOff + ws * 3));
  if (nvar < 1 || nvar > 256) throw new DMFormatError(`NVAR out of range: ${nvar}`);

  // Field-definition entries (28 bytes SP / 56 EP each; alpha >4 chars span
  // multiple entries sharing a name with incrementing WORDNO).
  const fieldStart = dateOff + ws * 4, fieldSize = ws * 7;
  const raw = [];
  for (let i = 0; i < nvar; i++) {
    const o = fieldStart + i * fieldSize;
    if (o + fieldSize > ps) break;                                   // single-page DD (spec §3.2)
    raw.push({
      name: readLongName(dv, o, ws) ?? readText(dv, o, 2, ws),   // §3.2.1 EP long names, else legacy 8-char
      type: (readText(dv, o + ws * 2, 1, ws).charAt(0) || 'N').toUpperCase(),
      sw: Math.round(readNum(o + ws * 3)),
      wordno: Math.round(readNum(o + ws * 4)),
      def: readNum(o + ws * 6),
    });
  }

  // Reconstruct logical columns (group entries by name).
  const map = new Map();
  for (const e of raw) {
    if (!map.has(e.name)) map.set(e.name, { name: e.name, type: e.type, entries: [] });
    map.get(e.name).entries.push(e);
  }
  let maxLen = 0;
  const columns = [];
  for (const c of map.values()) {
    const sorted = c.entries.slice().sort((a, b) => a.wordno - b.wordno);
    const sw = sorted.map((e) => e.sw);
    for (const p of sw) if (p > maxLen) maxLen = p;
    const isConstant = sorted[0].sw === 0;
    let constantValue = null;
    if (isConstant) {
      if (c.type === 'A') constantValue = decodeAlphaDefault(sorted, precision, isLE);
      else { const v = sorted[0].def; constantValue = Math.abs(v) > SENTINEL ? null : v; }
    }
    columns.push({ name: c.name, type: c.type, sw, width: c.type === 'A' ? sw.length * 4 : undefined, isConstant, constantValue });
  }

  const recordsPerPage = maxLen > 0 ? Math.floor(USABLE_WORDS / maxLen) : 0;
  const recordCount = lastPage > 1 ? (lastPage - 2) * recordsPerPage + lastRec : lastRec;

  return {
    precision, byteOrder, wordSize: ws, pageSize: ps,
    filename, description, date: dmDate(dateNum),
    nvar, lastPage, lastRec, maxLen, recordsPerPage, recordCount,
    columns,
    schema: columns.map((c) => ({ name: c.name, type: c.type === 'A' ? 'string' : 'number' })),
  };
}

function decodeAlphaDefault(entries, precision, isLE) {
  let s = '';
  const buf = new ArrayBuffer(precision === 'ep' ? 8 : 4);
  const dv = new DataView(buf);
  for (const e of entries) {
    if (precision === 'ep') dv.setFloat64(0, e.def, isLE); else dv.setFloat32(0, e.def, isLE);
    for (let b = 0; b < 4; b++) { const c = dv.getUint8(b); if (c >= 32 && c < 127) s += String.fromCharCode(c); }
  }
  return s.trim();
}

function dmDate(n) {
  if (!n || n < 10000) return null;                                 // 10000×year + 100×month + day
  const year = Math.floor(n / 10000), month = Math.floor((n % 10000) / 100), day = n % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Byte range of record `i` (0-based) in the file — a contiguous slice (records
 *  never span a page). Read it and pass to decodeRecord. */
function recordRange(h, i) {
  const dataPage = Math.floor(i / h.recordsPerPage) + 2;            // 1-based; page 1 = DD
  const recInPage = i % h.recordsPerPage;
  return { offset: (dataPage - 1) * h.pageSize + recInPage * h.maxLen * h.wordSize, length: h.maxLen * h.wordSize };
}

/** Read ONE field of the record whose words begin at byte `recBase` in `dv`:
 *  number | null (missing/sentinel) for numeric columns, trimmed string for
 *  alpha, the header value for constants (no body access). This is the strided
 *  projection primitive — a caller reads a single COLUMN by striding recBase =
 *  pageBase + r·maxLen·wordSize across records, decoding only the field it wants
 *  instead of the whole record. `dv` may span many records (a page run); the
 *  offsets are relative to recBase. */
function readField(dv, h, col, recBase) {
  if (col.isConstant) return col.constantValue;
  const ws = h.wordSize, isLE = h.byteOrder === 'le';
  if (col.type === 'A') {
    let s = '';
    for (const sw of col.sw) { const b0 = recBase + (sw - 1) * ws; for (let b = 0; b < 4; b++) { if (b0 + b >= dv.byteLength) break; const c = dv.getUint8(b0 + b); if (c >= 32 && c < 127) s += String.fromCharCode(c); } }
    return s.trim();
  }
  const off = recBase + (col.sw[0] - 1) * ws;
  if (off + ws > dv.byteLength) return null;
  const v = h.precision === 'ep' ? dv.getFloat64(off, isLE) : dv.getFloat32(off, isLE);
  return Math.abs(v) > SENTINEL ? null : v;
}

/** Decode one record's word slice (from recordRange) into positional values:
 *  number | null (missing/sentinel) for numeric columns, string for alpha. */
function decodeRecord(bytes, h) {
  const dv = toDV(bytes);
  return h.columns.map((col) => readField(dv, h, col, 0));   // record bytes start at 0
}

/**
 * Whole-file convenience: detect + parse + record access over an ArrayBuffer /
 * Uint8Array. For huge files prefer the windowed path (detectDM → parseHeader →
 * recordRange → decodeRecord over a File you slice).
 */
function readDM(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.byteLength < 2048) throw new DMFormatError('file too small for a .dm page');
  const fmt = detectDM(u8.subarray(0, Math.min(4096, u8.byteLength)));
  if (!fmt) throw new DMFormatError('not a recognizable .dm file');
  const h = parseHeader(u8, fmt);
  const sliceRec = (i) => { const { offset, length } = recordRange(h, i); return u8.subarray(offset, offset + length); };
  return {
    filename: h.filename, description: h.description, date: h.date,
    precision: h.precision, byteOrder: h.byteOrder, fields: h.schema, recordCount: h.recordCount, header: h,
    getRecord(i) {
      if (i < 0 || i >= h.recordCount) return null;
      const vals = decodeRecord(sliceRec(i), h);
      const obj = {};
      h.columns.forEach((c, k) => { obj[c.name] = vals[k]; });
      return obj;
    },
    getColumns() {
      const n = h.recordCount;
      const out = {};
      const numArr = h.precision === 'ep' ? Float64Array : Float32Array;
      h.columns.forEach((c, k) => {
        if (c.isConstant) { out[c.name] = c.constantValue; return; }
        out[c.name] = c.type === 'A' ? new Array(n) : new numArr(n);
      });
      for (let i = 0; i < n; i++) {
        const vals = decodeRecord(sliceRec(i), h);
        h.columns.forEach((c, k) => {
          if (c.isConstant) return;
          if (c.type === 'A') out[c.name][i] = vals[k];
          else out[c.name][i] = vals[k] == null ? NaN : vals[k];     // missing → NaN in typed arrays
        });
      }
      return out;
    },
    * [Symbol.iterator]() { for (let i = 0; i < h.recordCount; i++) yield this.getRecord(i); },
  };
}

// ── src/io/dm-provider.js ──

// @gcu/condenser — Datamine .dm block-model provider, over @gcu/dm's windowed
// reader (micro-spec Addendum A.2). The DD page carries the grid definition as
// implicit constants (XMORIG/YMORIG/ZMORIG corner origin, XINC/YINC/ZINC block
// dims, NX/NY/NZ counts), so — unlike CSV — there is NO discovery sweep: grid,
// bbox, and schema are known from the first page. Centroids come from XC/YC/ZC
// per-record fields; the centroid of block (0,0,0) is MORIG + INC/2.
//
// Record indices are RAW record numbers (rows with missing coordinates are
// skipped but their numbers are not reused), so recordRange gives O(1) fetch of
// any picked record. Categories (first alpha column) build their dictionary
// incrementally during the single streaming sweep (≤255 distinct).
//
// v1 scope: regular uniform grids (INC as DD constants). Sub-blocked models
// (per-record INC) and non-model .dm files are a later milestone.


const DEF_NAMES = new Set(['IJK', 'XC', 'YC', 'ZC', 'XINC', 'YINC', 'ZINC', 'XMORIG', 'YMORIG', 'ZMORIG', 'NX', 'NY', 'NZ']);

// `cached` (a sidecar's discovery results: { grid, bbox, subBlocked, dimPalette,
// categories }) skips the full-file discovery sweep — a 13 GB sub-blocked model
// reopens straight to streaming. Callers own freshness (name+size match).
async function openDmModel(blob, { mapping = null, forcePoints = false, onProgress = null, cached = null } = {}) {
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  const fmt = detectDM(head);
  if (!fmt) throw new Error('dm: not a recognizable .dm file');
  const h = parseHeader(head, fmt);
  const names = h.columns.map((c) => c.name);
  const idx = (n) => names.indexOf(n);
  const constVal = (n) => { const c = h.columns[idx(n)]; return c && c.isConstant ? c.constantValue : null; };

  const xc = idx('XC') >= 0 ? idx('XC') : idx('X');
  const yc = idx('YC') >= 0 ? idx('YC') : idx('Y');
  const zc = idx('ZC') >= 0 ? idx('ZC') : idx('Z');
  if (xc < 0 || yc < 0 || zc < 0) throw new Error('dm: no XC/YC/ZC centroid fields — not a block model export');

  // Decoded-record batches (a cold recipe). Reads ~4 MB page runs sequentially;
  // yields { recStart, rows } with RAW record numbering (recStart + k, no skips
  // here). Full decode — every field of every record. For a column-selective op
  // (a filter, a grade scan, the render stream) prefer columnBatches, which
  // strides only the fields it needs (≈ 3–30× less work; see bench-formats).
  async function* recordBatches({ signal } = {}) {
    const pagesPer = Math.max(1, Math.floor((4 << 20) / h.pageSize));
    for (let page = 2; page <= h.lastPage; page += pagesPer) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const pEnd = Math.min(page + pagesPer - 1, h.lastPage);
      const bytes = new Uint8Array(await blob.slice((page - 1) * h.pageSize, pEnd * h.pageSize).arrayBuffer());
      const rows = [];
      for (let pg = page; pg <= pEnd; pg++) {
        const nRec = pg === h.lastPage ? h.lastRec : h.recordsPerPage;
        const base = (pg - page) * h.pageSize;
        for (let r = 0; r < nRec; r++) {
          rows.push(decodeRecord(bytes.subarray(base + r * h.maxLen * h.wordSize, base + (r + 1) * h.maxLen * h.wordSize), h));
        }
      }
      yield { recStart: (page - 2) * h.recordsPerPage, rows };
    }
  }

  // PROJECTED batches — decode only the requested column indices by striding each
  // field's fixed word-offset across records (no whole-record decode, no per-row
  // allocation). Numeric col → Float64Array (NaN = missing); alpha col → string[]
  // (''=missing); constants come free from the header. Yields { recStart, count,
  // cols } where cols[idx] is the array for column `idx`. Same RAW numbering as
  // recordBatches (recStart + k over ALL records, skips resolved by the caller).
  // opts.shouldRead(recStart, count): PUSHDOWN hook — return false and the whole
  // page-run is skipped BEFORE any I/O (sidecar band stats prove no record in
  // the run can match a filter — parquet's row-group skip, retrofitted onto .dm)
  async function* columnBatches(colIdxs, { signal, shouldRead = null } = {}) {
    const ids = [...new Set(colIdxs)];
    const cols = ids.map((i) => h.columns[i]), alpha = cols.map((c) => c.type === 'A');
    const pagesPer = Math.max(1, Math.floor((4 << 20) / h.pageSize));
    for (let page = 2; page <= h.lastPage; page += pagesPer) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const pEnd = Math.min(page + pagesPer - 1, h.lastPage);
      if (shouldRead) {
        let totalR = 0;
        for (let pg = page; pg <= pEnd; pg++) totalR += pg === h.lastPage ? h.lastRec : h.recordsPerPage;
        if (!shouldRead((page - 2) * h.recordsPerPage, totalR)) continue;
      }
      const bytes = new Uint8Array(await blob.slice((page - 1) * h.pageSize, pEnd * h.pageSize).arrayBuffer());
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let total = 0;
      for (let pg = page; pg <= pEnd; pg++) total += pg === h.lastPage ? h.lastRec : h.recordsPerPage;
      const out = cols.map((c, ci) => (alpha[ci] ? new Array(total) : new Float64Array(total)));
      let w = 0;
      for (let pg = page; pg <= pEnd; pg++) {
        const nRec = pg === h.lastPage ? h.lastRec : h.recordsPerPage, pageBase = (pg - page) * h.pageSize;
        for (let r = 0; r < nRec; r++) {
          const recBase = pageBase + r * h.maxLen * h.wordSize;
          for (let ci = 0; ci < cols.length; ci++) { const v = readField(dv, h, cols[ci], recBase); out[ci][w] = alpha[ci] ? (v == null ? '' : v) : (v == null ? NaN : v); }
          w++;
        }
      }
      const cobj = {}; ids.forEach((idx, ci) => { cobj[idx] = out[ci]; });
      yield { recStart: (page - 2) * h.recordsPerPage, count: total, cols: cobj };
    }
  }

  // the grid, straight from the DD (corner origin → centroid convention).
  // A regular model carries the grid as DD constants (XMORIG/XINC/NX…) → no sweep.
  // A SUB-BLOCKED model has per-record XINC/YINC/ZINC (not constants) → a discovery
  // sweep finds the fine lattice (pitch = min dim /2) + a size palette, exactly
  // like the CSV provider → variable-size boxes. Anything else → points (grid:null).
  const mor = [constVal('XMORIG'), constVal('YMORIG'), constVal('ZMORIG')];
  const inc = [constVal('XINC'), constVal('YINC'), constVal('ZINC')];
  const cnt = [constVal('NX'), constVal('NY'), constVal('NZ')];
  const regular = !forcePoints && mor.every(Number.isFinite) && inc.every((v) => Number.isFinite(v) && v > 0) && cnt.every((v) => Number.isFinite(v) && v >= 1);
  // per-record dim columns (non-constant XINC/YINC/ZINC) → sub-block candidate
  const incIdx = { x: idx('XINC'), y: idx('YINC'), z: idx('ZINC') };
  const perRecDims = !regular && !forcePoints && incIdx.x >= 0 && incIdx.y >= 0 && incIdx.z >= 0
    && !h.columns[incIdx.x].isConstant && !h.columns[incIdx.y].isConstant && !h.columns[incIdx.z].isConstant;
  let grid = null, bbox, subBlocked = false, dimPalette = null, dimCode = null;
  if (cached && cached.bbox && !forcePoints) {
    // sidecar-cached discovery: trust it wholesale (freshness is the caller's contract)
    grid = cached.grid || null; bbox = cached.bbox;
    subBlocked = !!cached.subBlocked;
    dimPalette = cached.dimPalette || null;
    if (subBlocked && dimPalette) {
      const r10c = (v) => Number(v.toPrecision(10));
      dimCode = new Map(dimPalette.map((h2, i) => [`${r10c(h2[0] * 2)},${r10c(h2[1] * 2)},${r10c(h2[2] * 2)}`, i]));
    }
  } else if (regular) {
    grid = {
      x: { origin: mor[0] + inc[0] / 2, pitch: inc[0], count: Math.round(cnt[0]) },
      y: { origin: mor[1] + inc[1] / 2, pitch: inc[1], count: Math.round(cnt[1]) },
      z: { origin: mor[2] + inc[2] / 2, pitch: inc[2], count: Math.round(cnt[2]) },
    };
    bbox = { min: [mor[0], mor[1], mor[2]], max: [mor[0] + inc[0] * cnt[0], mor[1] + inc[1] * cnt[1], mor[2] + inc[2] * cnt[2]] };
  } else {
    const CAP = 300000, r10 = (v) => Number(v.toPrecision(10));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const ax = [new Set(), new Set(), new Set()];            // axis distinct centroids (for the fine lattice)
    const minDim = [Infinity, Infinity, Infinity], dimSet = new Set();
    const sweepCols = perRecDims ? [xc, yc, zc, incIdx.x, incIdx.y, incIdx.z] : [xc, yc, zc];
    for await (const { recStart, count, cols } of columnBatches(sweepCols)) {
      if (onProgress) onProgress({ phase: 'discovery', done: recStart + count, total: h.recordCount });
      const X = cols[xc], Y = cols[yc], Z = cols[zc], DX = perRecDims ? cols[incIdx.x] : null, DY = perRecDims ? cols[incIdx.y] : null, DZ = perRecDims ? cols[incIdx.z] : null;
      for (let k = 0; k < count; k++) {
        const xv = X[k], yv = Y[k], zv = Z[k];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
        if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
        if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
        if (perRecDims) {
          if (ax[0].size < CAP) ax[0].add(r10(xv)); if (ax[1].size < CAP) ax[1].add(r10(yv)); if (ax[2].size < CAP) ax[2].add(r10(zv));
          const dx = DX[k], dy = DY[k], dz = DZ[k];
          if (dx > 0 && dy > 0 && dz > 0) {
            if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
            if (dimSet.size <= 300) dimSet.add(`${r10(dx)},${r10(dy)},${r10(dz)}`);
          }
        }
      }
    }
    if (!Number.isFinite(min[0])) throw new Error('dm: no finite XC/YC/ZC centroids');
    bbox = { min, max };
    // sub-blocked: fine lattice (pitch = minDim/2) + size palette — same rule as CSV
    if (perRecDims && dimSet.size > 1 && Number.isFinite(minDim[0])) {
      const finePitch = [minDim[0] / 2, minDim[1] / 2, minDim[2] / 2];
      const fineAxes = [0, 1, 2].map((a) => {
        if (ax[a].size >= CAP || !(finePitch[a] > 0)) return null;
        const vals = [...ax[a]].sort((u, v) => u - v);
        const origin = vals[0], pitch = finePitch[a];
        const c = Math.round((vals[vals.length - 1] - origin) / pitch) + 1;
        if (c > 65535) return null;
        const eps = Math.max(pitch * 1e-3, Math.abs(origin) * 1e-6);
        for (const v of vals) if (Math.abs(origin + Math.round((v - origin) / pitch) * pitch - v) > eps) return null;
        return { origin, pitch, count: c };
      });
      if (fineAxes.every(Boolean)) {
        subBlocked = true;
        const dims = [...dimSet].slice(0, 256).map((k) => k.split(',').map(Number));
        dimPalette = dims.map(([dx, dy, dz]) => [dx / 2, dy / 2, dz / 2]);
        dimCode = new Map(dims.map((d, i) => [`${r10(d[0])},${r10(d[1])},${r10(d[2])}`, i]));
        grid = { x: fineAxes[0], y: fineAxes[1], z: fineAxes[2] };
      }
    }
  }

  // channels: every per-record numeric non-definition column; first alpha = category
  const numericColumns = h.columns
    .map((c, i) => ({ c, i }))
    .filter((o) => o.c.type === 'N' && !o.c.isConstant && !DEF_NAMES.has(o.c.name))
    .map((o) => ({ i: o.i, name: o.c.name }));
  const chan = mapping && mapping.chan != null ? mapping.chan : (numericColumns[0] ? numericColumns[0].i : null);
  // category: an explicit mapping.cat wins (any column — numeric domain codes
  // dict-encode as strings below); default = the first non-constant alpha
  const catIdx = mapping && mapping.cat != null ? mapping.cat : h.columns.findIndex((c) => c.type === 'A' && !c.isConstant);
  // a sidecar's categories describe the column it was written for — a re-keyed
  // cat must rebuild its dict during the sweep, not inherit the old column's
  const cachedCats = cached && cached.categories && (!cached.mapping || cached.mapping.cat == null || cached.mapping.cat === catIdx) ? cached.categories : null;
  const categories = catIdx >= 0 ? (cachedCats ? [...cachedCats] : []) : null;   // fills incrementally during the sweep (or prefilled from a sidecar)
  const catCode = catIdx >= 0 ? new Map(categories.map((v, i) => [v, i])) : null;

  const header = {
    kind: 'blockmodel', count: h.recordCount,
    bbox, grid, subBlocked, dimPalette, dimCols: subBlocked ? incIdx : null,
    columns: names,
    mapping: { x: xc, y: yc, z: zc, chan, cat: catIdx >= 0 ? catIdx : null },
    numericColumns, categories,
    attributes: [...(chan != null ? [names[chan]] : []), ...(catIdx >= 0 ? [names[catIdx]] : [])],
    dm: h,                                                  // the @gcu/dm header: O(1) record fetch + the filter sweep
  };

  const r10s = (v) => Number(v.toPrecision(10));
  async function* streamChunks({ chunkPoints = 1 << 18, signal, onProgress } = {}) {
    const alloc = () => ({
      x: new Float64Array(chunkPoints), y: new Float64Array(chunkPoints), z: new Float64Array(chunkPoints),
      chan: new Float64Array(chunkPoints), cat: catCode ? new Uint8Array(chunkPoints) : null,
      dim: dimCode ? new Uint8Array(chunkPoints) : null,
      recIdx: new Uint32Array(chunkPoints),
    });
    // project ONLY the fields the render needs (coords + grade + category + dims)
    // — not all N columns. On the real Leapfrog .dm that's ~6 of 14+.
    const streamCols = [xc, yc, zc];
    if (chan != null) streamCols.push(chan);
    if (catIdx >= 0) streamCols.push(catIdx);
    if (dimCode) streamCols.push(incIdx.x, incIdx.y, incIdx.z);
    let buf = alloc(), fill = 0, done = 0;
    for await (const { recStart, count, cols } of columnBatches(streamCols, { signal })) {
      const X = cols[xc], Y = cols[yc], Z = cols[zc];
      const CH = chan != null ? cols[chan] : null, CA = catIdx >= 0 ? cols[catIdx] : null;
      const DX = dimCode ? cols[incIdx.x] : null, DY = dimCode ? cols[incIdx.y] : null, DZ = dimCode ? cols[incIdx.z] : null;
      for (let k = 0; k < count; k++) {
        const xv = X[k], yv = Y[k], zv = Z[k];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;   // skipped, raw number NOT reused
        buf.x[fill] = xv; buf.y[fill] = yv; buf.z[fill] = zv;
        buf.chan[fill] = CH ? CH[k] : 0;                   // NaN already when missing
        if (buf.cat) {
          const raw = CA[k];                               // '' when missing; a NUMERIC cat column dict-encodes as strings
          const v = raw == null || raw === '' || (typeof raw === 'number' && !Number.isFinite(raw)) ? '' : String(raw);
          let code = catCode.get(v);
          if (code === undefined) {
            if (catCode.size < 255) { code = catCode.size; catCode.set(v, code); categories.push(v); }
            else code = 0;
          }
          buf.cat[fill] = code;
        }
        if (buf.dim) { const c = dimCode.get(`${r10s(DX[k])},${r10s(DY[k])},${r10s(DZ[k])}`); buf.dim[fill] = c === undefined ? 0 : c; }
        buf.recIdx[fill] = recStart + k;                   // RAW record number — the join key
        fill++;
        if (fill === chunkPoints) {
          yield { count: fill, x: buf.x, y: buf.y, z: buf.z, chan: buf.chan, cat: buf.cat, dim: buf.dim, recIdx: buf.recIdx, recStart: 0 };
          buf = alloc(); fill = 0;
        }
      }
      done += count;
      if (onProgress) onProgress(done, h.recordCount);
    }
    if (fill) {
      yield {
        count: fill, x: buf.x.subarray(0, fill), y: buf.y.subarray(0, fill), z: buf.z.subarray(0, fill),
        chan: buf.chan.subarray(0, fill), cat: buf.cat ? buf.cat.subarray(0, fill) : null,
        dim: buf.dim ? buf.dim.subarray(0, fill) : null,
        recIdx: buf.recIdx.subarray(0, fill), recStart: 0,
      };
    }
  }

  return { header, streamChunks, recordBatches, columnBatches };
}

// O(1) fetch of one record by RAW record number (the pick → inspector path).
async function fetchDmRecord(blob, h, rec) {
  const { offset, length } = recordRange(h, rec);
  const bytes = new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
  return decodeRecord(bytes, h);                           // positional values, h.columns order
}

// ── Datamine WIREFRAME (triangulated surface / DTM / solid) ──────────────────
// A Datamine wireframe is a PAIR of .dm files: a POINTS file (XP/YP/ZP + PID) and
// a TRIANGLES file (PID1/PID2/PID3 indexing the points by id), by convention named
// <base>pt.dm / <base>tr.dm. Together they're an indexed mesh — the same
// { vertices, triangles } shape the OBJ/MSH/PLY providers return, so buildMeshChunk
// and the whole mesh pipeline take it unchanged.

// Peek a .dm's column names without the block-model requirement (openDmModel throws
// for non-block-model files). Returns names[] or null if not a recognizable .dm.
async function peekDmColumns(blob) {
  const head = new Uint8Array(await blob.slice(0, Math.min(8192, blob.size)).arrayBuffer());
  const fmt = detectDM(head);
  if (!fmt) return null;
  try { return parseHeader(head, fmt).columns.map((c) => c.name); } catch { return null; }
}

// Classify a .dm by its fields: a wireframe points half, a triangle half, or null.
function dmWireframeRole(names) {
  if (!names) return null;
  const has = (n) => names.some((c) => String(c).toUpperCase() === n);
  if (has('PID1') && has('PID2') && has('PID3')) return 'triangles';
  if (has('PID') && has('XP') && has('YP') && has('ZP')) return 'points';
  return null;
}

// Join a points file + a triangles file into a mesh. Reads both whole (wireframes
// are small — 2–4 k records is typical); maps PID → 0-based vertex index (gaps ok);
// drops any triangle whose vertices don't resolve (reports the count). Multiple
// GROUPs merge into one mesh for v1.
async function openDmWireframe(ptBlob, trBlob) {
  const pb = new Uint8Array(await ptBlob.arrayBuffer());
  const ph = parseHeader(pb, detectDM(pb) || {});
  const pu = ph.columns.map((c) => c.name.toUpperCase());
  const xi = pu.indexOf('XP'), yi = pu.indexOf('YP'), zi = pu.indexOf('ZP'), pid = pu.indexOf('PID');
  if (xi < 0 || yi < 0 || zi < 0 || pid < 0) throw new Error('dm wireframe: the points file needs XP/YP/ZP/PID');
  const idxOfPid = new Map();
  const vx = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let i = 0; i < ph.recordCount; i++) {
    const { offset, length } = recordRange(ph, i);
    const v = decodeRecord(pb.subarray(offset, offset + length), ph);
    const id = v[pid], x = v[xi], y = v[yi], z = v[zi];
    if (id == null || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    idxOfPid.set(id, n++); vx.push(x, y, z);
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  }
  const tb = new Uint8Array(await trBlob.arrayBuffer());
  const th = parseHeader(tb, detectDM(tb) || {});
  const tu = th.columns.map((c) => c.name.toUpperCase());
  const a = tu.indexOf('PID1'), b = tu.indexOf('PID2'), c = tu.indexOf('PID3');
  if (a < 0 || b < 0 || c < 0) throw new Error('dm wireframe: the triangles file needs PID1/PID2/PID3');
  const tri = [];
  let dropped = 0;
  for (let i = 0; i < th.recordCount; i++) {
    const { offset, length } = recordRange(th, i);
    const r = decodeRecord(tb.subarray(offset, offset + length), th);
    const i1 = idxOfPid.get(r[a]), i2 = idxOfPid.get(r[b]), i3 = idxOfPid.get(r[c]);
    if (i1 == null || i2 == null || i3 == null || i1 === i2 || i2 === i3 || i1 === i3) { dropped++; continue; }
    tri.push(i1, i2, i3);
  }
  if (!n || !tri.length) throw new Error('dm wireframe: no resolvable triangles');
  const vertices = Float64Array.from(vx), triangles = Uint32Array.from(tri);
  return { header: { kind: 'mesh', format: 'dm-wireframe', vertexCount: n, triCount: triangles.length / 3 | 0, bbox: { min, max }, dropped }, vertices, triangles };
}

// ── src/core/camera.js ──

// @gcu/condenser — minimal mat4 math + an orbit camera. Raw WebGL2 needs ~four
// matrix ops, not a scene graph (dee's camera is Three-coupled — micro-spec §5
// says borrow the *math*, and the math is textbook, so it lives here).
// Column-major Float32Array(16), GL convention. All coordinates FRAME-LOCAL —
// the document frame keeps magnitudes small enough for f32 uniforms.

function mat4Perspective(fovYRad, aspect, near, far) {
  const f = 1 / Math.tan(fovYRad / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4Ortho(halfH, aspect, near, far) {
  const halfW = halfH * aspect, m = new Float32Array(16);
  m[0] = 1 / halfW; m[5] = 1 / halfH;
  m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near);
  m[15] = 1;
  return m;
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz; m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[1] = yx; m[5] = yy; m[9] = yz; m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[2] = zx; m[6] = zy; m[10] = zz; m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mat4Multiply(a, b) {                       // a·b (both column-major)
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return m;
}

// General 4×4 inverse (cofactor expansion, column-major). Used to unproject
// (pixel, depth) → world in the deferred re-shade resolve; the viewProj is
// always invertible for a real camera. Returns null on a singular matrix.
function mat4Inverse(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return null;
  const d = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= d;
  return inv;
}

// Frustum planes from a viewProj matrix (Gribb–Hartmann, column-major): six
// [a,b,c,d] rows — a point is inside when a·x+b·y+c·z+d ≥ 0 for all six.
function frustumPlanes(m) {
  const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
  return [add(r3, r0), sub(r3, r0), add(r3, r1), sub(r3, r1), add(r3, r2), sub(r3, r2)];
}

// Conservative AABB-vs-frustum: positive-vertex test — the box is out only when
// its most-positive corner for some plane is still behind that plane.
function aabbInFrustum(planes, b) {                 // b = [minX,minY,minZ,maxX,maxY,maxZ]
  for (const [a, bb, c, d] of planes) {
    const px = a > 0 ? b[3] : b[0], py = bb > 0 ? b[4] : b[1], pz = c > 0 ? b[5] : b[2];
    if (a * px + bb * py + c * pz + d < 0) return false;
  }
  return true;
}

function transformPoint(m, p) {                     // m · [p,1] → perspective divide
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/**
 * Orbit camera: target + spherical (radius, theta around Z, phi from the XY
 * plane). Z-up (geology convention). Produces eye/view/proj; near/far adapt to
 * the orbit radius each update (dee's depth-precision trick).
 */
function createOrbitCamera({ fovY = 45 * Math.PI / 180 } = {}) {
  const c = {
    target: [0, 0, 0], radius: 100, theta: Math.PI / 4, phi: Math.PI / 5, fovY,
    aspect: 1, near: 0.1, far: 1e6,
    ortho: false, halfH: 0,                                // ortho: half-height = radius·tan(fovY/2) — toggling keeps apparent size at the target
    zExag: 1,                                              // vertical exaggeration: a GLOBAL scene z-scale folded into viewProj (all layers stay registered; queries stay in real coords — see update())
    eye: [0, 0, 0], view: null, proj: null, viewProj: null,
  };
  const EPS = 0.01;
  function update() {
    c.phi = Math.max(-Math.PI / 2 + EPS, Math.min(Math.PI / 2 - EPS, c.phi));
    c.radius = Math.max(0.05, c.radius);
    const cp = Math.cos(c.phi);
    c.eye = [
      c.target[0] + c.radius * cp * Math.cos(c.theta),
      c.target[1] + c.radius * cp * Math.sin(c.theta),
      c.target[2] + c.radius * Math.sin(c.phi),
    ];
    // near at radius/4000: on a km-scale fitted model the old /1000 put the
    // clip plane METRES in front of the camera — visible slicing when panning
    // close past geometry. /4000 keeps depth precision under a block size at
    // the far end of a 24-bit buffer (error ~ z²/(near·2²⁴): ~3 m at z=10 km
    // with near 2.5 m) while clipping 4× closer.
    c.near = Math.max(c.radius / 4000, 0.01);
    c.far = c.radius * 100;
    c.view = mat4LookAt(c.eye, c.target, [0, 0, 1]);
    c.halfH = c.radius * Math.tan(c.fovY / 2);
    c.proj = c.ortho ? mat4Ortho(c.halfH, c.aspect, c.near, c.far) : mat4Perspective(c.fovY, c.aspect, c.near, c.far);
    c.viewProj = mat4Multiply(c.proj, c.view);
    // Vertical exaggeration: fold a world-space z-scale into viewProj, pivoted at
    // the target's z (so the look-at point stays fixed). viewProj·M means every
    // vertex is z-scaled AT DRAW ONLY — shaders still test real z for section
    // culling (before viewProj), pick is the ID-buffer (real recIdx), measure
    // reads source records, and unproject uses inverse(viewProj) which yields real
    // coords. One matrix, all layers registered, every query honest.
    if (c.zExag && c.zExag !== 1) {
      const S = c.zExag, tz = c.target[2];                 // z' = tz + (z-tz)·S  ⇒  column-major z-scale about tz
      c.viewProj = mat4Multiply(c.viewProj, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, S, 0, 0, 0, tz * (1 - S), 1]);
    }
    return c;
  }
  return {
    get state() { return c; },
    update,
    setAspect(a) { c.aspect = a || 1; return update(); },
    orbit(dTheta, dPhi) { c.theta += dTheta; c.phi += dPhi; return update(); },
    dolly(f) { c.radius *= f; return update(); },
    pan(dxPx, dyPx, viewportH) {                           // screen px → world at target depth
      const s = 2 * c.radius * Math.tan(c.fovY / 2) / (viewportH || 1);
      const ct = Math.cos(c.theta), st = Math.sin(c.theta), sp = Math.sin(c.phi), cp = Math.cos(c.phi);
      // camera right = (-st, ct, 0); camera up ≈ (-ct·sp, -st·sp, cp)
      c.target[0] += (-st) * (-dxPx * s) + (-ct * sp) * (dyPx * s);
      c.target[1] += (ct) * (-dxPx * s) + (-st * sp) * (dyPx * s);
      // vertical exaggeration stretches displayed z by zExag, so a real-z move
      // shows amplified — divide the up-vector's z contribution by zExag so the
      // grabbed point tracks the cursor 1:1 (M⁻¹ of the up-move; x/y are unscaled).
      // In plan view cp=0 → no change, as it should be.
      c.target[2] += cp * (dyPx * s) / (c.zExag || 1);
      return update();
    },
    setOrtho(on) { c.ortho = !!on; return update(); },
    fit(bbox) {                                            // frame a local-space bbox
      c.target = [(bbox[0] + bbox[3]) / 2, (bbox[1] + bbox[4]) / 2, (bbox[2] + bbox[5]) / 2];
      const dx = bbox[3] - bbox[0], dy = bbox[4] - bbox[1], dz = bbox[5] - bbox[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      c.radius = (d / 2) / Math.tan(c.fovY / 2) * 1.2;
      return update();
    },
  };
}

// Wire standard mouse/touch input onto an orbit camera. Returns a detach fn.
// left-drag orbit · right-drag / shift-drag pan · wheel dolly.
function attachOrbitInput(canvas, cam, { onChange } = {}) {
  // pointers tracked by id: one = orbit (or pan with right-button/shift),
  // two = the touch grammar — pinch dollies, the centroid pans, twist orbits
  // theta. touch-action:none or the browser eats the gestures first.
  canvas.style.touchAction = 'none';
  const pts = new Map();
  let mode = null, lx = 0, ly = 0;
  let pinch = null;                                        // { span, cx, cy, angle }
  const pinchState = () => {
    const [a, b] = [...pts.values()];
    return {
      span: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };
  const down = (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pts.size === 2) { pinch = pinchState(); mode = 'pinch'; return; }
    if (pts.size > 2) return;                              // third finger: ignore
    mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
    lx = e.clientX; ly = e.clientY;
  };
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pts.size >= 2) {
      const now = pinchState();
      cam.dolly(pinch.span / now.span > 0 ? pinch.span / now.span : 1);
      cam.pan(now.cx - pinch.cx, now.cy - pinch.cy, canvas.clientHeight);
      let dA = now.angle - pinch.angle;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      if (!cam.state.orbitLock) cam.orbit(-dA, 0);         // twist: grab-the-world (locked views don't twist)
      pinch = now;
      if (onChange) onChange();
      return;
    }
    if (!mode || mode === 'pinch') return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    // orbitLock (state flag): 2D/section-locked views — drags PAN instead of
    // orbiting, so a locked plan/section can't be knocked off-plane by a drag
    if (mode === 'orbit') { if (cam.state.orbitLock) cam.pan(dx, dy, canvas.clientHeight); else cam.orbit(-dx * 0.006, dy * 0.006); }
    else cam.pan(dx, dy, canvas.clientHeight);
    if (onChange) onChange();
  };
  const up = (e) => {
    pts.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    if (pts.size >= 2) { pinch = pinchState(); return; }   // still pinching with others
    if (pts.size === 1) {                                  // pinch → single: re-anchor, no jump
      const rest = [...pts.values()][0];
      mode = 'orbit'; lx = rest.x; ly = rest.y; pinch = null;
      return;
    }
    mode = null; pinch = null;
  };
  const wheel = (e) => { e.preventDefault(); cam.dolly(Math.pow(1.0015, e.deltaY)); if (onChange) onChange(); };
  const ctx = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', ctx);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', ctx);
  };
}

// ── src/core/gl-resolve.js ──

// @gcu/condenser — DEFERRED RE-SHADE (render-paths spec §2). Once the scene
// has converged, the pick pipeline's full-viewport (record, layer|face) id
// buffer is kept as a texture, and COSMETIC changes — ramp, clip, color
// mode, filter (dim), selection, chanTex values — run ONE fullscreen resolve
// pass per element layer instead of re-rasterizing the geometry. O(pixels)
// at any model size: a ramp drag over a 50M-block model recolors at refresh
// rate instead of restarting the accumulation.
//
// Two GPU pieces, no CPU data needed:
//   bake    — per layer, scatter each element's (z, value, category, rgb) to
//             its RECORD's texel in an 8192-wide RGBA32F attribute texture
//             (one point-draw over the layer's chunks; works for streamed
//             models whose columns were never CPU-resident).
//   resolve — fullscreen triangle per layer: id → attr texel → the SAME
//             color math the raster shaders use (parity by construction,
//             including the raster shaders' per-kind wash order), written
//             into the EDL color buffer; `discard` leaves background /
//             mesh / other-layer pixels untouched, and the untouched EDL
//             depth still shades the presented frame.
//
// Blocks' per-face impostor lighting reconstructs from the id buffer's FACE
// code (gl-pick names the plane the eye ray entered): shade = (0.55 +
// 0.45·max(n·L,0)) · (cut ? 0.85 : 1) — the exact gl-blocks formula. Splat-
// demoted pixels (NO_FACE) stay unlit, exactly as rasterized. Out of scope
// (the caller falls back to re-raster): block EDGE lines (need the intra-face
// hit position), opacity < 1 (screen-door), catVis / isolate (they CULL
// geometry, so the id buffer itself goes stale), sticks / soup layers.


const TEXW = 8192;

// ── bake shaders: element → its record's texel ──────────────────────────────
const BAKE_VERT_BLOCKS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aIjk;
layout(location=1) in float aChan;
layout(location=2) in float aCat;
layout(location=3) in uint aRec;
uniform vec3 uGridOrigin, uGridSize;
uniform vec2 uChanChunk;                 // this chunk's [min, span] (dequantize aChan)
uniform vec2 uTexSize;
flat out vec4 vAttr;
void main() {
  int rec = int(aRec);
  vec2 px = vec2(float(rec & 8191) + 0.5, float(rec >> 13) + 0.5);
  gl_Position = vec4(px / uTexSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float z = uGridOrigin.z + aIjk.z * uGridSize.z;
  vAttr = vec4(z, uChanChunk.x + aChan * uChanChunk.y, aCat, 0.0);
}`;

const BAKE_VERT_POINTS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aIntensity;
layout(location=2) in float aClass;
layout(location=3) in vec3 aRgb;
layout(location=4) in uint aRec;
uniform vec3 uBoxMin, uBoxSpan;
uniform vec2 uTexSize;
flat out vec4 vAttr;
void main() {
  int rec = int(aRec);
  vec2 px = vec2(float(rec & 8191) + 0.5, float(rec >> 13) + 0.5);
  gl_Position = vec4(px / uTexSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float z = uBoxMin.z + aPos.z * uBoxSpan.z;
  // rgb packs into one float exactly (24 bits fit f32's 24-bit mantissa)
  float rgb = floor(aRgb.r * 255.0 + 0.5) + floor(aRgb.g * 255.0 + 0.5) * 256.0 + floor(aRgb.b * 255.0 + 0.5) * 65536.0;
  vAttr = vec4(z, aIntensity, aClass, rgb);
}`;

const BAKE_FRAG = `#version 300 es
precision highp float;
flat in vec4 vAttr;
out vec4 outAttr;
void main() { outAttr = vAttr; }`;

// ── the resolve pass: id → attrs → the raster shaders' color math ──────────
const RESOLVE_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const RESOLVE_FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uId;                  // RG32UI: R = record, G = layer | face<<16 (NO_LAYER = miss)
uniform sampler2D uAttr;                 // baked (z, value, cat, rgbPacked) by record
uniform sampler2D uRamp, uPalette, uMask, uSel, uRule, uChanTex;
uniform sampler2D uDepth;                // the capture's hit depths (edge-line unproject)
uniform uint uLayerId, uPicked, uPickedLayer;
uniform int uKind;                       // 0 = points, 1 = blocks
uniform int uColorMode;
uniform vec2 uZRange, uChanDoc;
uniform float uPaletteN, uIntensityScale;
uniform float uFilterOn, uSelOn, uRuleOn, uChanTexOn;
uniform vec3 uLightDir, uCutNormal;
uniform vec3 uFaceN[6];                  // gl-pick's FACE_NORMALS
uniform float uEdgesOn, uOrtho, uPerspScale;
uniform mat4 uInvVP;                     // inverse viewProj: (pixel, depth) → world hit point
uniform vec2 uViewport;
uniform vec3 uEyePos, uGridOrigin, uGridSize;   // the blocks layer's lattice (regular grids only)
out vec4 outColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  uvec2 id = texelFetch(uId, px, 0).rg;
  if (id.g == 0xFFFFFFFFu) discard;                        // background: untouched
  uint layer = id.g & 0xFFFFu;
  if (layer != uLayerId) discard;                          // mesh / other layers: untouched
  int rec = int(id.r);
  ivec2 at = ivec2(rec & 8191, rec >> 13);
  vec4 attr = texelFetch(uAttr, at, 0);
  float cls = attr.z;
  if (uRuleOn > 0.5) cls = floor(texelFetch(uRule, at, 0).r * 255.0 + 0.5);
  vec4 col;
  if (uColorMode == 0) {                                   // elevation (both kinds)
    float t = clamp((attr.x - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    col = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 1) {
    if (uKind == 1) {                                      // blocks: grade (doc-normalized)
      float v = uChanTexOn > 0.5 ? texelFetch(uChanTex, at, 0).r : attr.y;
      float t = clamp((v - uChanDoc.x) / max(uChanDoc.y, 1e-6), 0.0, 1.0);
      col = texture(uRamp, vec2(t, 0.5));
    } else {                                               // points: intensity
      float t = clamp(attr.y * uIntensityScale, 0.0, 1.0);
      col = texture(uRamp, vec2(t, 0.5));
    }
  } else if (uColorMode == 2) {                            // category / classification
    col = texture(uPalette, vec2((cls + 0.5) / uPaletteN, 0.5));
  } else {
    if (uKind == 1) col = vec4(0.62, 0.63, 0.66, 1.0);     // blocks: solid
    else {                                                 // points: rgb (unpack)
      float p3 = attr.w;
      float b = floor(p3 / 65536.0); p3 -= b * 65536.0;
      float g = floor(p3 / 256.0); p3 -= g * 256.0;
      col = vec4(p3 / 255.0, g / 255.0, b / 255.0, 1.0);
    }
  }
  float m = 1.0;
  if (uFilterOn > 0.5) m = texelFetch(uMask, at, 0).r > 0.5 ? 1.0 : 0.0;
  float selHit = uSelOn > 0.5 ? texelFetch(uSel, at, 0).r : 0.0;
  // wash order matches each kind's raster shader EXACTLY: gl.js points dim
  // THEN sel-wash; gl-blocks sel-washes THEN dims. Only both-at-once pixels
  // differ between the orders, but parity is the contract here.
  if (uKind == 1) {
    if (selHit > 0.5) col = vec4(mix(col.rgb, vec3(1.0, 0.85, 0.3), 0.55), col.a);
    if (uFilterOn > 0.5 && m < 0.5) col = vec4(col.rgb * 0.3, col.a);
  } else {
    if (uFilterOn > 0.5 && m < 0.5) col = vec4(col.rgb * 0.3, col.a);
    if (selHit > 0.5) col = vec4(mix(col.rgb, vec3(1.0, 0.85, 0.3), 0.55), col.a);
  }
  if (id.r == uPicked && layer == uPickedLayer) col = vec4(mix(col.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, col.a);
  float shade = 1.0;
  if (uKind == 1) {                                        // blocks: per-face impostor lighting
    uint face = (id.g >> 16) & 7u;
    if (face < 6u) shade = 0.55 + 0.45 * max(dot(uFaceN[face], uLightDir), 0.0);
    else if (face == 6u) shade = (0.55 + 0.45 * max(dot(uCutNormal, uLightDir), 0.0)) * 0.85;   // the section cut wall
    // face 7 (NO_FACE): a demoted splat — unlit, as rasterized (and no edges)
    // BLOCK EDGE LINES (gl-blocks' exact math): the capture depth gives back
    // the hit point — unproject it, snap the block center from the face plane
    // + the regular lattice, and the box-local coords fall out. Sub-blocked
    // models (per-block half-dims) can't reconstruct the center this way and
    // fall back to the re-raster before we get here.
    if (uEdgesOn > 0.5 && face < 7u) {
      float dz = texelFetch(uDepth, px, 0).r;
      vec2 xy = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
      vec4 hp = uInvVP * vec4(xy, dz * 2.0 - 1.0, 1.0);
      vec3 p = hp.xyz / hp.w;
      vec3 half_ = uGridSize * 0.5;
      // the pixel ray (also perturbed rays below, for the analytic derivative)
      vec4 rA = uInvVP * vec4(xy, -1.0, 1.0);
      vec4 rB = uInvVP * vec4(xy, 1.0, 1.0);
      vec3 ro = rA.xyz / rA.w, rd = rB.xyz / rB.w - ro;
      float pv = 0.0; int ax = 0;
      if (face < 6u) {
        // depth only PICKS the lattice face plane; the position comes from
        // re-intersecting the ray with that exact plane (no 24-bit jitter)
        ax = int(face >> 1);
        float o0 = uGridOrigin[ax] - half_[ax];
        pv = o0 + round((p[ax] - o0) / uGridSize[ax]) * uGridSize[ax];
        if (abs(rd[ax]) > 1e-12) p = ro + rd * ((pv - ro[ax]) / rd[ax]);
        p[ax] = pv;
      }
      vec3 base = face < 6u ? p - uFaceN[face] * half_ : p;   // face pixel: step inward; cut pixel: already interior
      vec3 center = uGridOrigin + vec3(round((base.x - uGridOrigin.x) / uGridSize.x), round((base.y - uGridOrigin.y) / uGridSize.y), round((base.z - uGridOrigin.z) / uGridSize.z)) * uGridSize;
      vec3 a2 = abs(p - center) / half_;
      float m1 = max(a2.x, max(a2.y, a2.z));
      float m2 = max(min(a2.x, a2.y), min(max(a2.x, a2.y), a2.z));
      float e = face == 6u ? m1 : m2;
      // ANALYTIC screen derivative of e: fwidth() cancels at block seams (e is
      // symmetric across them — …0.8, 1.0 │ 1.0, 0.8…), erasing the lines
      // exactly where they live; the raster never sees that because each
      // impostor is its own primitive with helper-invocation derivatives. So
      // evaluate e at the hardware's own 2×2 QUAD positions — rays through the
      // quad-aligned pixels, intersected with THIS pixel's plane — and
      // difference them ourselves. Quad alignment matters: it reproduces the
      // raster's per-quad-shared derivative, phase and all.
      float cutD = dot(p, uCutNormal);
      vec2 qb = floor(gl_FragCoord.xy * 0.5) * 2.0 + 0.5;
      float eq[3];
      for (int k = 0; k < 3; k++) {
        vec2 fxy = k == 0 ? qb : (k == 1 ? qb + vec2(1.0, 0.0) : qb + vec2(0.0, 1.0));
        vec2 nxy = (fxy / uViewport) * 2.0 - 1.0;
        vec4 qA = uInvVP * vec4(nxy, -1.0, 1.0);
        vec4 qB = uInvVP * vec4(nxy, 1.0, 1.0);
        vec3 qo = qA.xyz / qA.w, qd = qB.xyz / qB.w - qo;
        vec3 q;
        if (face < 6u) { float den = qd[ax]; q = abs(den) > 1e-12 ? qo + qd * ((pv - qo[ax]) / den) : p; }
        else { float den = dot(qd, uCutNormal); q = abs(den) > 1e-9 ? qo + qd * ((cutD - dot(qo, uCutNormal)) / den) : p; }
        vec3 aq = abs(q - center) / half_;
        float q1 = max(aq.x, max(aq.y, aq.z));
        float q2 = max(min(aq.x, aq.y), min(max(aq.x, aq.y), aq.z));
        eq[k] = face == 6u ? q1 : q2;
      }
      float fw = abs(eq[1] - eq[0]) + abs(eq[2] - eq[0]);
      float dpx = (1.0 - e) / max(fw, 1e-6);
      float edge = 1.0 - clamp(dpx * 0.7 - 0.3, 0.0, 1.0);
      float distE = uOrtho > 0.5 ? 1.0 : max(distance(uEyePos, center), 1e-3);
      float pxR = length(half_) * uPerspScale / distE;
      edge *= clamp((pxR - 5.0) / 8.0, 0.0, 1.0);          // fade toward demotion, as rasterized
      shade *= 1.0 - 0.4 * edge;
    }
  }
  outColor = vec4(col.rgb * shade, col.a);
}`;

function createResolvePipeline(gl) {
  // the bake target is RGBA32F — color-renderable only with this extension;
  // absent (rare on WebGL2-era GPUs) the whole feature quietly disables and
  // every cosmetic change re-rasters, exactly as before.
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');
  const bakeBlocks = makeProgram(gl, BAKE_VERT_BLOCKS, BAKE_FRAG);
  const bakePoints = makeProgram(gl, BAKE_VERT_POINTS, BAKE_FRAG);
  const resolveProg = makeProgram(gl, RESOLVE_VERT, RESOLVE_FRAG);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const uB = { gridOrigin: U(bakeBlocks, 'uGridOrigin'), gridSize: U(bakeBlocks, 'uGridSize'), chanChunk: U(bakeBlocks, 'uChanChunk'), texSize: U(bakeBlocks, 'uTexSize') };
  const uP = { boxMin: U(bakePoints, 'uBoxMin'), boxSpan: U(bakePoints, 'uBoxSpan'), texSize: U(bakePoints, 'uTexSize') };
  const uR = {
    id: U(resolveProg, 'uId'), attr: U(resolveProg, 'uAttr'), ramp: U(resolveProg, 'uRamp'), palette: U(resolveProg, 'uPalette'),
    mask: U(resolveProg, 'uMask'), sel: U(resolveProg, 'uSel'), rule: U(resolveProg, 'uRule'), chanTex: U(resolveProg, 'uChanTex'),
    layerId: U(resolveProg, 'uLayerId'), picked: U(resolveProg, 'uPicked'), pickedLayer: U(resolveProg, 'uPickedLayer'),
    kind: U(resolveProg, 'uKind'), colorMode: U(resolveProg, 'uColorMode'), zRange: U(resolveProg, 'uZRange'), chanDoc: U(resolveProg, 'uChanDoc'),
    paletteN: U(resolveProg, 'uPaletteN'), intensityScale: U(resolveProg, 'uIntensityScale'),
    filterOn: U(resolveProg, 'uFilterOn'), selOn: U(resolveProg, 'uSelOn'), ruleOn: U(resolveProg, 'uRuleOn'), chanTexOn: U(resolveProg, 'uChanTexOn'),
    lightDir: U(resolveProg, 'uLightDir'), cutNormal: U(resolveProg, 'uCutNormal'), faceN: U(resolveProg, 'uFaceN'),
    depth: U(resolveProg, 'uDepth'), edgesOn: U(resolveProg, 'uEdgesOn'), ortho: U(resolveProg, 'uOrtho'), perspScale: U(resolveProg, 'uPerspScale'),
    invVP: U(resolveProg, 'uInvVP'), viewport: U(resolveProg, 'uViewport'), eyePos: U(resolveProg, 'uEyePos'),
    gridOrigin: U(resolveProg, 'uGridOrigin'), gridSize: U(resolveProg, 'uGridSize'),
  };
  const IDENT4 = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const bakeFbo = gl.createFramebuffer();
  const bakes = new Map();                                 // layerId → { tex, h }
  const faceFlat = new Float32Array(18);
  for (let i = 0; i < 6; i++) { const n = FACE_NORMALS[i]; faceFlat[i * 3] = n[0]; faceFlat[i * 3 + 1] = n[1]; faceFlat[i * 3 + 2] = n[2]; }

  // one bake VAO per blocks chunk: the same buffers the instanced VAO uses, but
  // re-pointed per-VERTEX (divisor 0) so one gl.POINTS draw scatters every block
  function blocksBakeVao(c) {
    if (c._bakeVao) return c._bakeVao;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bIjk); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bChan); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_SHORT, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bCat); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.bRec); gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, 0, 0);
    gl.bindVertexArray(null);
    c._bakeVao = vao;
    return vao;
  }

  return {
    ok: floatOk,
    // (re)bake one layer's attribute texture from its resident chunks.
    // maxRec = 1 + the highest record index the caller has seen for the layer.
    // Leaves the FBO at null and the viewport at the bake size — the caller
    // (inside the EDL sceneDraw) restores its own binding + viewport after.
    bakeLayer(layerId, chunksOfLayer, maxRec) {
      if (!floatOk || !chunksOfLayer.length || !maxRec) return null;
      const h = Math.max(1, Math.ceil(maxRec / TEXW));
      let b = bakes.get(layerId);
      if (!b || b.h < h) {
        if (b) gl.deleteTexture(b.tex);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEXW, h, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        b = { tex, h };
        bakes.set(layerId, b);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.tex, 0);
      gl.viewport(0, 0, TEXW, b.h);
      gl.disable(gl.DEPTH_TEST);
      const kind = chunksOfLayer[0].kind;
      if (kind === 'blocks') {
        gl.useProgram(bakeBlocks);
        gl.uniform2f(uB.texSize, TEXW, b.h);
        for (const c of chunksOfLayer) {
          const g = c.grid;
          gl.uniform3f(uB.gridOrigin, g.originLocal[0], g.originLocal[1], g.originLocal[2]);
          gl.uniform3f(uB.gridSize, g.size[0], g.size[1], g.size[2]);
          const span = c.chanRange[1] - c.chanRange[0];
          gl.uniform2f(uB.chanChunk, c.chanRange[0], span > 0 ? span : 0);
          gl.bindVertexArray(blocksBakeVao(c));
          gl.drawArrays(gl.POINTS, 0, c.count);
        }
      } else {
        gl.useProgram(bakePoints);
        gl.uniform2f(uP.texSize, TEXW, b.h);
        for (const c of chunksOfLayer) {
          const bb = c.bboxLocal;
          gl.uniform3f(uP.boxMin, bb[0], bb[1], bb[2]);
          gl.uniform3f(uP.boxSpan, bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
          gl.bindVertexArray(c.vao);                       // per-vertex layout already, locations match
          gl.drawArrays(gl.POINTS, 0, c.count);
        }
      }
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return b;
    },
    hasBake(layerId) { return bakes.has(layerId); },
    dropBake(layerId) { const b = bakes.get(layerId); if (b) { gl.deleteTexture(b.tex); bakes.delete(layerId); } },
    // one fullscreen pass for one layer, into the CURRENTLY BOUND framebuffer
    // (the EDL color buffer). `u` carries the same per-layer values the raster
    // path's begin/setup functions computed. Depth stays untouched.
    resolveLayer(idTex, layerId, u) {
      const b = bakes.get(layerId);
      if (!b) return false;
      gl.useProgram(resolveProg);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const bind = (unit, loc, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); };
      bind(0, uR.id, idTex);
      bind(1, uR.attr, b.tex);
      bind(2, uR.ramp, u.ramp);
      bind(3, uR.palette, u.palette);
      // every float sampler MUST land on a float texture: an unset sampler
      // uniform defaults to unit 0 — the INTEGER id texture — and that type
      // mismatch silently kills the whole draw (GL_INVALID_OPERATION). The
      // ramp parks the unused ones; their On-flags gate actual sampling.
      bind(4, uR.mask, u.mask || u.ramp);
      bind(5, uR.sel, u.sel || u.ramp);
      bind(6, uR.rule, u.rule || u.ramp);
      bind(7, uR.chanTex, u.chanTex || u.ramp);
      bind(8, uR.depth, (u.edges && u.depth) || u.ramp);   // depth-as-sampler2D: .r is the depth (compare mode NONE)
      gl.uniform1f(uR.edgesOn, u.edges && u.depth ? 1 : 0);
      gl.uniform1f(uR.ortho, u.ortho ? 1 : 0);
      gl.uniform1f(uR.perspScale, u.perspScale || 1);
      gl.uniformMatrix4fv(uR.invVP, false, u.invVP || IDENT4);
      gl.uniform2f(uR.viewport, u.viewportW || 1, u.viewportH || 1);
      gl.uniform3f(uR.eyePos, u.eye ? u.eye[0] : 0, u.eye ? u.eye[1] : 0, u.eye ? u.eye[2] : 0);
      gl.uniform3f(uR.gridOrigin, u.grid ? u.grid.originLocal[0] : 0, u.grid ? u.grid.originLocal[1] : 0, u.grid ? u.grid.originLocal[2] : 0);
      gl.uniform3f(uR.gridSize, u.grid ? u.grid.size[0] : 1, u.grid ? u.grid.size[1] : 1, u.grid ? u.grid.size[2] : 1);
      gl.uniform1ui(uR.layerId, layerId >>> 0);
      gl.uniform1ui(uR.picked, u.picked >>> 0);
      gl.uniform1ui(uR.pickedLayer, u.pickedLayer >>> 0);
      gl.uniform1i(uR.kind, u.kind === 'blocks' ? 1 : 0);
      gl.uniform1i(uR.colorMode, u.colorMode | 0);
      gl.uniform2f(uR.zRange, u.zRange[0], u.zRange[1]);
      gl.uniform2f(uR.chanDoc, u.chanDoc[0], u.chanDoc[1]);
      gl.uniform1f(uR.paletteN, u.paletteN);
      gl.uniform1f(uR.intensityScale, u.intensityScale);
      gl.uniform1f(uR.filterOn, u.mask ? 1 : 0);
      gl.uniform1f(uR.selOn, u.sel ? 1 : 0);
      gl.uniform1f(uR.ruleOn, u.rule ? 1 : 0);
      gl.uniform1f(uR.chanTexOn, u.chanTex ? 1 : 0);
      gl.uniform3f(uR.lightDir, u.lightDir[0], u.lightDir[1], u.lightDir[2]);
      gl.uniform3f(uR.cutNormal, u.cutNormal[0], u.cutNormal[1], u.cutNormal[2]);
      gl.uniform3fv(uR.faceN, faceFlat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      return true;
    },
    clear() { for (const b of bakes.values()) gl.deleteTexture(b.tex); bakes.clear(); },
  };
}

// ── src/core/gl.js ──

// @gcu/condenser — the WebGL2 splat renderer. Raw GL, no scene graph: per-chunk
// VAOs over the quantized buffers (positions stay uint16 on the GPU — denormalized
// in the vertex shader against per-chunk bbox uniforms), circular point splats,
// color-by as a mode uniform + LUT texture (switching color source is a uniform/
// texture swap, never a buffer re-upload — micro-spec §2.2).
//
// Prefix-LOD (M1 form): a global per-frame element budget split across visible
// chunks proportionally; each chunk draws its FIRST k elements — correct as a
// uniform subsample because chunks.js shuffled them (the §2.1.4 invariant).


const VERT$gl = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;        // uint16 normalized -> 0..1
layout(location=1) in float aIntensity; // uint16 normalized
layout(location=2) in float aClass;     // uint8, raw (0..255)
layout(location=3) in vec3 aRgb;        // uint8 normalized
layout(location=4) in uint aRec;        // uint32 record index (highlight + mask lookups)
uniform uint uPicked;                   // picked RECORD (0xFFFFFFFF = none)
uniform uint uPickedLayer;              // …and the layer it belongs to
uniform uint uLayer;                    // this draw's layer (per-draw, not per-element)                   // record index to highlight (0xFFFFFFFF = none)
uniform uvec2 uRepaint;                 // repaint pass: draw ONLY these two records (both 0xFFFFFFFF = off)
uniform vec4 uSecPlane;                 // section plane: xyz = unit normal, w = offset (frame-local)
uniform vec2 uSecCfg;                   // x: 0 = off, 1 = slab; y: slab half-thickness
uniform mat4 uViewProj;
uniform vec3 uBoxMin, uBoxSpan;
uniform float uPointPx;
uniform int uColorMode;                 // 0 elevation | 1 intensity | 2 classification | 3 rgb
uniform vec2 uZRange;                   // document local z min/span (elevation ramp)
uniform float uIntensityScale;          // 1 / (p98-ish max, normalized units)
uniform sampler2D uRamp;                // 256x1 continuous ramp
uniform sampler2D uPalette;             // classification / category palette
uniform float uPaletteN;                // its width (32 = LAS classes, 256 = category dict)
uniform sampler2D uMask;                // filter bitmask by record index (8192-wide)
uniform float uFilterOn, uIsolate;
uniform sampler2D uCatVis;              // 256x1 per-class visibility (layer properties)
uniform float uCatVisOn;
uniform sampler2D uSel;                 // selection bitmask by record index (8192-wide)
uniform float uSelOn;
uniform sampler2D uRule;                // rule-code byte by record index (8192-wide)
uniform float uRuleOn;                  // rule mode: the code REPLACES the class for palette + eyes
out vec4 vColor;
flat out float vCull;
void main() {
  vec3 p = uBoxMin + aPos * uBoxSpan;
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = uPointPx;
  vCull = (uSecCfg.x > 0.5 && abs(dot(p, uSecPlane.xyz) - uSecPlane.w) > uSecCfg.y) ? 1.0 : 0.0;
  float m = 1.0;
  if (uFilterOn > 0.5) {
    int rec = int(aRec);
    m = texelFetch(uMask, ivec2(rec & 8191, rec >> 13), 0).r > 0.5 ? 1.0 : 0.0;
    if (uIsolate > 0.5 && m < 0.5) vCull = 1.0;
  }
  float cls = aClass;
  if (uRuleOn > 0.5) {
    int rr = int(aRec);
    cls = floor(texelFetch(uRule, ivec2(rr & 8191, rr >> 13), 0).r * 255.0 + 0.5);
  }
  if (uCatVisOn > 0.5 && texelFetch(uCatVis, ivec2(int(cls) & 255, 0), 0).r < 0.5) vCull = 1.0;
  float selHit = 0.0;
  if (uSelOn > 0.5) {
    int rs = int(aRec);
    selHit = texelFetch(uSel, ivec2(rs & 8191, rs >> 13), 0).r;
  }
  if (uColorMode == 0) {
    float t = clamp((p.z - uZRange.x) / max(uZRange.y, 1e-6), 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 1) {
    float t = clamp(aIntensity * uIntensityScale, 0.0, 1.0);
    vColor = texture(uRamp, vec2(t, 0.5));
  } else if (uColorMode == 2) {
    vColor = texture(uPalette, vec2((cls + 0.5) / uPaletteN, 0.5));
  } else {
    vColor = vec4(aRgb, 1.0);
  }
  if (uFilterOn > 0.5 && m < 0.5) vColor = vec4(vColor.rgb * 0.3, vColor.a);   // context mode: dim non-matching
  if (selHit > 0.5) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.85, 0.3), 0.55), vColor.a);   // selected: warm gold wash
  if (aRec == uPicked && uLayer == uPickedLayer) vColor = vec4(mix(vColor.rgb, vec3(1.0, 0.15, 0.7), 0.85) + 0.1, vColor.a);   // picked: hot magenta — the hue viridis doesn't have
  if ((uRepaint.x != 0xFFFFFFFFu || uRepaint.y != 0xFFFFFFFFu) && aRec != uRepaint.x && aRec != uRepaint.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // repaint pass: everything else clips out
}`;

const FRAG$gl = `#version 300 es
precision highp float;
in vec4 vColor;
flat in float vCull;
out vec4 outColor;
void main() {
  if (vCull > 0.5) discard;             // outside the section slab
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;        // circular splat
  outColor = vColor;
}`;


// ── LUTs ──
// A small viridis-ish ramp (Switchboard-friendly; perceptual enough for v0.1).
const RAMP_STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
function rampPixels(n = 256, stops = RAMP_STOPS) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (stops.length - 1), k = Math.min(stops.length - 2, t | 0), f = t - k;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}
// Standard LAS classification palette (0..18+; index = class code).
const CLASS_COLORS = {
  0: [140, 144, 153], 1: [170, 170, 170], 2: [161, 124, 82], 3: [122, 168, 100],
  4: [90, 150, 70], 5: [60, 130, 60], 6: [200, 105, 84], 7: [220, 80, 80],
  8: [180, 180, 90], 9: [74, 120, 176], 10: [200, 160, 60], 11: [110, 110, 120],
  12: [235, 100, 60], 13: [180, 140, 200], 14: [140, 120, 220], 15: [120, 200, 200],
  16: [200, 200, 120], 17: [160, 90, 160], 18: [230, 150, 150],
};
function palettePixels(n = 32) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = CLASS_COLORS[i] || [200, 60, 200];           // unknown classes scream magenta, quietly
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

function lutTexture(gl, pixels, n) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  return t;
}

// Upload one chunk's buffers → a VAO. CPU copies are the caller's to release —
// after this returns, the GPU owns the data (§2.1.5 CPU-release). recIdx goes up
// too (an unattached buffer, wired by the M5 pick pass) so nothing per-element
// has to stay resident in JS.
function uploadChunk(gl, chunk) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (data, loc, size, type, normalized) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    return b;
  };
  const buffers = [
    buf(chunk.pos, 0, 3, gl.UNSIGNED_SHORT, true),
    buf(chunk.intensity, 1, 1, gl.UNSIGNED_SHORT, true),
    buf(chunk.classification, 2, 1, gl.UNSIGNED_BYTE, false),
  ];
  if (chunk.rgb) buffers.push(buf(chunk.rgb, 3, 3, gl.UNSIGNED_BYTE, true));
  else { gl.disableVertexAttribArray(3); gl.vertexAttrib3f(3, 0.7, 0.7, 0.7); }
  const recBuf = gl.createBuffer();                        // highlight + pick lookups, GPU-resident
  gl.bindBuffer(gl.ARRAY_BUFFER, recBuf);
  gl.bufferData(gl.ARRAY_BUFFER, chunk.recIdx, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
  buffers.push(recBuf);
  gl.bindVertexArray(null);
  return { kind: 'points', vao, buffers, count: chunk.count, bboxLocal: chunk.bboxLocal, cursor: 0 };
}

/**
 * createRenderer(canvas) — owns the GL context, program, LUTs, and the chunk
 * list; draw(cam, opts) renders one frame (into the current framebuffer — the
 * EDL pass wraps it). Chunks arrive via addChunk() as the stream lands.
 *
 * M2 state machine (§2.2): each frame classifies as MOVING (camera/viewport/
 * uniform changed since last frame) or STILL.
 *   moving → clear + draw a per-chunk PREFIX: k_i = budget · w_i/Σw where w_i is
 *   the chunk's projected screen weight ((radius/dist)², floored so the coarse
 *   global prefix never disappears), front-to-back over the frustum-culled set.
 *   still  → no clear; draw the NEXT SLICE of each unfinished visible chunk
 *   (progressive accumulation into the persistent FBO) until converged.
 * New chunks stream INTO the accumulation (no clear — they just draw behind).
 * All of it is correct because chunk prefixes are uniform subsamples (§2.1.4).
 */
function createRenderer(canvas, { background = [0.07, 0.07, 0.07, 1] } = {}) {
  // preserveDrawingBuffer: the viewport is also the screenshot-export surface
  // (micro-spec §6) and readPixels-after-frame is how the smoke verifies renders;
  // the cost is one buffer copy per composite — negligible next to the splat pass.
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('condenser: WebGL2 unavailable');
  const prog = makeProgram(gl, VERT$gl, FRAG$gl);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uni = {
    viewProj: U('uViewProj'), boxMin: U('uBoxMin'), boxSpan: U('uBoxSpan'),
    pointPx: U('uPointPx'), colorMode: U('uColorMode'), zRange: U('uZRange'),
    intensityScale: U('uIntensityScale'), ramp: U('uRamp'), palette: U('uPalette'), picked: U('uPicked'), pickedLayer: U('uPickedLayer'), layer: U('uLayer'), repaint: U('uRepaint'),
    secPlane: U('uSecPlane'), secCfg: U('uSecCfg'),
    mask: U('uMask'), filterOn: U('uFilterOn'), isolate: U('uIsolate'), paletteN: U('uPaletteN'),
    catVis: U('uCatVis'), catVisOn: U('uCatVisOn'),
    sel: U('uSel'), selOn: U('uSelOn'),
    rule: U('uRule'), ruleOn: U('uRuleOn'),
  };
  const ramp = lutTexture(gl, rampPixels(), 256);
  const palette = lutTexture(gl, palettePixels(), 32);   // LAS classification (points)
  let catPalette = null;                                  // category palette (blocks), lazy
  let blocksPipe = null;                                  // impostor pipeline, lazy
  let sticksPipe = null;                                  // capsule pipeline, lazy
  let meshPipe = null;                                    // context-mesh pipeline, lazy
  let soupPipe = null;                                    // streaming-mesh (soup) pipeline, lazy
  let pickPipe = null;                                    // ID-buffer pick pipeline, lazy
  let resolvePipe = null;                                 // deferred re-shade pipeline, lazy (gl-resolve.js)
  const chunks = [];
  let docBbox = null;                                     // scene bbox (fit + the shared elevation ramp)
  let pickedRec = 0xFFFFFFFF;                             // highlighted RECORD (sentinel = none)
  let pickedLayer = 0xFFFFFFFF;                           // …and its layer (the pair IS the identity now)
  const repaintSet = new Set();                           // records to repaint over a converged frame
  let lastConverged = false;
  // ── layers (micro-layers spec §1): each opened dataset is a layer with its own
  // visibility, filter mask, compaction set, and color ranges. recIdx is
  // PARTITIONED — (layerId << 29) | record — so one ID buffer serves all layers
  // (§3). Single-layer callers never notice: layer 0 shifts by zero and every
  // API defaults to it. ──
  const layers = new Map();                               // id → per-layer state
  // a layer's view of the section: false = exempt, 'front'/'behind' = keep that
  // side only (a half-space is a slab with the far face pushed past the data —
  // same trick the global clip uses, but per layer, derived from sec.d0)
  const layerSecOf = (ls, sec) => {
    const m = ls.sectioned;
    if (!sec || m === false) return m === false ? null : sec;
    if ((m === 'front' || m === 'behind') && sec.d0 !== undefined) {
      const H = Math.max(1e5, 8 * (sec.half || 1));
      return { ...sec, d: m === 'front' ? sec.d0 + H : sec.d0 - H, half: H, clip: m, traceHalf: sec.traceHalf || (sec.half < 9e4 ? sec.half : 1) };
    }
    return sec;
  };
  // meshes render their section as a TRACE flattened onto the wall — for a
  // half-space clip the slab half is ~1e5 (it swallows the scene), so the
  // trace band narrows to the TRUE plane ± traceHalf; slab sections already
  // carry the right width
  const meshSecOf = (ls, sec) => {
    const s2 = layerSecOf(ls, sec);
    if (!s2 || !(s2.clip === 'front' || s2.clip === 'behind') || s2.d0 === undefined) return s2;
    return { ...s2, d: s2.d0, half: Math.max(0.01, s2.traceHalf || 1) };
  };
  function layerOf(id) {
    let l = layers.get(id);
    if (!l) {
      l = { visible: true, set: 'base', maskTex: null, maskH: 0, isolate: false,
            intensityMax: 1, docChan: [Infinity, -Infinity], catN: 0, stickRadius: 1, sectioned: true,
            meshTint: [0.62, 0.64, 0.66], meshOpacity: 1, opacity: 1, catVisTex: null, rampTex: null, paletteTex: null, paletteW: 0, selTex: null, selH: 0,
            ruleTex: null, ruleH: 0, ruleOn: false,
            chanTex: null, chanTexRange: null };
      layers.set(id, l);
    }
    return l;
  }
  const activeChunk = (c) => { const l = layers.get(c._layer); return !!l && l.visible && c._set === l.set; };
  const freeChunk = (c) => { gl.deleteVertexArray(c.vao); if (c._bakeVao) gl.deleteVertexArray(c._bakeVao); c.buffers.forEach((b) => gl.deleteBuffer(b)); };
  const byLayer = (arr) => {
    const m = new Map();
    for (const c of arr) { let g = m.get(c._layer); if (!g) m.set(c._layer, g = []); g.push(c); }
    return m;
  };
  // accumulation state
  const lastVP = new Float32Array(16);
  let lastKey = '', needClear = true, lastVisible = 0;
  // deferred re-shade state (gl-resolve.js): a COSMETIC change (ramp, clip,
  // color mode, dim-filter, selection, chanTex values) over a converged frame
  // resolves per-pixel from the captured id buffer instead of re-rastering.
  // Dirt is tracked PER LAYER: a ramp drag on the block model must not care
  // that a drillhole (sticks) layer shares the scene — untouched layers keep
  // their accumulated pixels, and only a change to an UNRESOLVABLE layer
  // falls back to the re-raster.
  const cosmeticDirtyLayers = new Set();                  // layers a cosmetic setter touched
  const lastCosSig = new Map();                           // layer → view-opts signature last rastered/resolved
  let idCapture = null;                                   // { tex, w, h } from pickPipe.captureViewport
  const layerMaxRec = new Map();                          // layer → 1 + highest record index seen
  const bakeDirty = new Set();                            // layers whose attr bake is stale
  let resolves = 0;                                       // resolve passes run (harness observability)
  const trackRec = (layer, recIdx) => {
    let m = layerMaxRec.get(layer) || 0;
    for (let i = 0; i < recIdx.length; i++) if (recIdx[i] >= m) m = recIdx[i] + 1;
    layerMaxRec.set(layer, m);
    bakeDirty.add(layer);
  };

  const vpChanged = (vp) => {
    for (let i = 0; i < 16; i++) if (vp[i] !== lastVP[i]) { lastVP.set(vp); return true; }
    return false;
  };

  return {
    gl,
    // background clear color (also the figure/screenshot backdrop, since EDL
    // passes through background pixels untouched). rgba 0-1; a moving frame
    // re-clears so it takes effect next redraw.
    setBackground(rgba) { if (rgba && rgba.length >= 3) { background[0] = rgba[0]; background[1] = rgba[1]; background[2] = rgba[2]; background[3] = rgba[3] != null ? rgba[3] : 1; needClear = true; } },
    get background() { return [background[0], background[1], background[2], background[3]]; },
    get chunkCount() { return chunks.reduce((s, c) => s + (activeChunk(c) ? 1 : 0), 0); },
    get elementCount() { return chunks.reduce((s, c) => s + (activeChunk(c) ? c.count : 0), 0); },
    // ALL resident chunks (hidden layers + inactive sets included — they hold
    // their buffers), so the number is what the GPU is actually carrying
    get vramBytes() { return chunks.reduce((s, c) => s + (c.bytes || 0), 0); },
    layerVramBytes(layer) { return chunks.reduce((s, c) => s + (c._layer === layer ? (c.bytes || 0) : 0), 0); },
    get accumulated() { return chunks.reduce((s, c) => s + (activeChunk(c) ? c.cursor : 0), 0); },   // elements in the current accumulation
    get resolveCount() { return resolves; },               // deferred re-shade passes run (harness observability)
    addChunk(chunk, set = 'base', layer = 0) {
      const ls = layerOf(layer);
      idCapture = null;                                   // new geometry: the captured id buffer is stale
      // recIdx stays RAW — the layer rides a per-draw uniform, so there is no
      // per-element rewrite here any more (and no 3-bit ceiling on layers)
      // honest VRAM accounting: every typed array in the CPU chunk becomes a
      // GPU buffer (bboxLocal's 48 B is noise) — summed here, read as vramBytes
      let cb = 0;
      for (const k in chunk) { const v = chunk[k]; if (v && v.buffer && v.byteLength) cb += v.byteLength; }
      if (chunk.kind === 'mesh') {                        // context tier: static, recordless, whole-draw
        if (!meshPipe) meshPipe = createMeshPipeline(gl);
        const up = meshPipe.upload(chunk); up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);
        needClear = true;                                 // draw it into a fresh accumulation
        return;
      }
      if (chunk.kind === 'soup') {                        // streaming tier: budgeted like points
        if (!soupPipe) soupPipe = createSoupPipeline(gl);
        const up = soupPipe.upload(chunk); up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);                                  // streams INTO the accumulation, no clear
        return;
      }
      if (chunk.kind === 'blocks' || chunk.kind === 'sticks') {
        if (chunk.kind === 'blocks' && !blocksPipe) blocksPipe = createBlocksPipeline(gl);
        if (chunk.kind === 'sticks' && !sticksPipe) sticksPipe = createSticksPipeline(gl);
        const up = (chunk.kind === 'blocks' ? blocksPipe : sticksPipe).upload(chunk);
        up._set = set; up._layer = layer; up.bytes = cb;
        chunks.push(up);                                   // GPU owns it now
        if (chunk.kind === 'blocks' && chunk.recIdx) trackRec(layer, chunk.recIdx);   // re-shade bake bookkeeping
        if (set === 'base') {                              // compact chunks never tighten the ramp
          if (chunk.chanRange[0] < ls.docChan[0]) ls.docChan[0] = chunk.chanRange[0];
          if (chunk.chanRange[1] > ls.docChan[1]) ls.docChan[1] = chunk.chanRange[1];
        }
        return;
      }
      const up = uploadChunk(gl, chunk); up._set = set; up._layer = layer; up.bytes = cb;
      chunks.push(up);                                     // GPU owns it now; CPU copy dies with the caller
      if (chunk.recIdx) trackRec(layer, chunk.recIdx);     // re-shade bake bookkeeping (points)
      if (set === 'base') {
        let m = 0; const a = chunk.intensity;
        for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
        ls.intensityMax = Math.max(ls.intensityMax, m);
      }
    },
    setCategories(n) {                                     // block category palette (golden-angle hues)
      if (n > 0 && !catPalette) catPalette = lutTexture(gl, categoryPalettePixels(256), 256);
    },
    // Filter bitmask by RECORD INDEX within the layer (micro-spec section 4).
    // mask = Uint8Array (0|1 per source row) or null to clear; isolate: true
    // discards non-matching, false dims them.
    setFilter(mask, { isolate = false } = {}, layer = 0) {
      const ls = layerOf(layer);
      const culled = isolate || (ls.isolate && !!ls.maskTex);   // isolate CULLS (now or before) → geometry changes
      ls.isolate = isolate;
      if (!mask) {
        if (ls.maskTex) { gl.deleteTexture(ls.maskTex); ls.maskTex = null; }
      } else {
        const W = 8192, H = Math.max(1, Math.ceil(mask.length / W));
        const padded = new Uint8Array(W * H);
        for (let i = 0; i < mask.length; i++) padded[i] = mask[i] ? 255 : 0;
        if (ls.maskTex && H === ls.maskH) {
          gl.bindTexture(gl.TEXTURE_2D, ls.maskTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, padded);
        } else {
          if (ls.maskTex) gl.deleteTexture(ls.maskTex);
          ls.maskTex = gl.createTexture(); ls.maskH = H;
          gl.bindTexture(gl.TEXTURE_2D, ls.maskTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, padded);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
      }
      if (culled) needClear = true; else cosmeticDirtyLayers.add(layer);   // dim-mode filter is a re-shade, not a re-raster
    },
    setDocBbox(b) { docBbox = b; },
    // Filter compaction (per layer): 'compact' chunks hold ONLY matching elements
    // (record ids preserved), so the render budget runs over the matches instead
    // of shader-discarding the rest. Base chunks stay resident — clearing is instant.
    setActiveSet(set, layer = 0) { const ls = layerOf(layer); if (set !== ls.set) { ls.set = set; needClear = true; } },
    get activeSet() { return layerOf(0).set; },            // legacy single-layer read
    clearCompact(layer = 0) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        if (c._layer !== layer || c._set !== 'compact') continue;
        freeChunk(c);
        chunks.splice(i, 1);
      }
      const ls = layerOf(layer);
      if (ls.set === 'compact') { ls.set = 'base'; needClear = true; }
    },
    // points layers with a CATEGORY dict color class codes through the 256-wide
    // golden-angle palette instead of the 32-entry LAS classification table
    setLayerCats(layer, n) { const ls = layerOf(layer); if (ls.catN !== (n || 0)) { ls.catN = n || 0; cosmeticDirtyLayers.add(layer); } },
    // stick thickness (world meters) — a live per-layer knob
    setLayerStickRadius(layer, r) { const ls = layerOf(layer); const v = Math.max(0.05, +r || 1); if (ls.stickRadius !== v) { ls.stickRadius = v; needClear = true; } },
    layerStickRadius(layer) { return layerOf(layer).stickRadius; },
    layerChanRange(layer) { const ls = layers.get(layer); return ls && ls.docChan[0] !== Infinity ? [ls.docChan[0], ls.docChan[1]] : null; },
    // per-layer section participation: an exempt layer draws (and picks) whole
    // while the others are slabbed — e.g. topo kept for context during sectioning
    setLayerSectioned(layer, mode) { const ls = layerOf(layer); const v = mode === undefined ? true : mode; if (ls.sectioned !== v) { ls.sectioned = v; needClear = true; } },
    layerSectioned(layer) { const m = layerOf(layer).sectioned; return m === undefined ? true : m; },
    
    // context-mesh style: tint [r,g,b] 0..1 + opacity 0..1 (Bayer screen-door)
    setLayerMeshStyle(layer, { tint, opacity } = {}) {
      const ls = layerOf(layer);
      if (tint) ls.meshTint = tint;
      if (opacity != null) ls.meshOpacity = Math.max(0.02, Math.min(1, +opacity));
      needClear = true;
    },
    layerMeshStyle(layer) { const ls = layerOf(layer); return { tint: ls.meshTint, opacity: ls.meshOpacity }; },
    // per-layer opacity for blocks (box impostors) + sticks (drillholes) — applied
    // as a screen-door dither in their shaders (see-through, no alpha-blend ordering).
    // Is this mesh layer PICKABLE? null = the default (opaque meshes pick, see-through
    // ones don't — you made it see-through to work on what is behind it). The app
    // overrides per layer: micro turns the ACTIVE mesh on, so selecting a surface in
    // the tree is what makes it clickable.
    setLayerPickable(layer, v) { layerOf(layer).meshPickable = v == null ? null : !!v; },
    layerPickable(layer) { const v = layerOf(layer).meshPickable; return v === undefined ? null : v; },
    setLayerOpacity(layer, opacity) { const ls = layerOf(layer); const v = Math.max(0.02, Math.min(1, +opacity)); ls.opacity = v; ls.meshOpacity = v; needClear = true; },   // ONE knob: mesh-family layers read meshOpacity
    // block-edge override: null = follow the draw-level blockEdges flag, true/false = force
    setLayerEdges(layer, v) { const ls = layerOf(layer); const nv = v == null ? null : !!v; if (ls.edges !== nv) { ls.edges = nv; needClear = true; } },
    layerEdges(layer) { const v = layerOf(layer).edges; return v === undefined ? null : v; },
    layerOpacity(layer) { return layerOf(layer).opacity; },
    // per-layer SELECTION bitmask (spec §15): same texture shape as the filter
    // mask; selected elements get a warm tint in every element program
    setLayerSelection(layer, mask) {
      const ls = layerOf(layer);
      if (!mask) {
        if (ls.selTex) { gl.deleteTexture(ls.selTex); ls.selTex = null; ls.selH = 0; }
      } else {
        const W = 8192, H = Math.max(1, Math.ceil(mask.length / W));
        const padded = new Uint8Array(W * H);
        for (let i = 0; i < mask.length; i++) padded[i] = mask[i] ? 255 : 0;
        if (ls.selTex && H === ls.selH) {
          gl.bindTexture(gl.TEXTURE_2D, ls.selTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, padded);
        } else {
          if (ls.selTex) gl.deleteTexture(ls.selTex);
          ls.selTex = gl.createTexture(); ls.selH = H;
          gl.bindTexture(gl.TEXTURE_2D, ls.selTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, padded);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
      }
      cosmeticDirtyLayers.add(layer);                                // a wash, not a cull — re-shade path
    },
    // per-layer RULE CODES (spec §10.4): one byte per record — which styling
    // rule claimed it (0 = none/else, 1..255 = rule order). Same texture shape
    // as the filter mask, but the byte is a VALUE, not a bit: in rule mode it
    // substitutes for the class code, so the palette, the per-class eyes, and
    // pick culling all compose without new machinery.
    setLayerRuleCodes(layer, codes) {
      const ls = layerOf(layer);
      if (!codes) {
        if (ls.ruleTex) { gl.deleteTexture(ls.ruleTex); ls.ruleTex = null; ls.ruleH = 0; }
      } else {
        const W = 8192, H = Math.max(1, Math.ceil(codes.length / W));
        const padded = new Uint8Array(W * H);
        padded.set(codes);
        if (ls.ruleTex && H === ls.ruleH) {
          gl.bindTexture(gl.TEXTURE_2D, ls.ruleTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, padded);
        } else {
          if (ls.ruleTex) gl.deleteTexture(ls.ruleTex);
          ls.ruleTex = gl.createTexture(); ls.ruleH = H;
          gl.bindTexture(gl.TEXTURE_2D, ls.ruleTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, W, H, 0, gl.RED, gl.UNSIGNED_BYTE, padded);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
      }
      // rule codes recolor (cosmetic) — but when class EYES are active they
      // also re-CULL through catVis, which the captured id buffer can't follow
      if (ls.ruleOn && ls.catVisTex) needClear = true; else cosmeticDirtyLayers.add(layer);
    },
    // rule mode on/off per layer — kept separate from the codes so switching
    // categorized ⇄ rule-based is a flag flip, no re-upload
    setLayerRuleMode(layer, on) {
      const ls = layerOf(layer);
      if (ls.ruleOn !== !!on) {
        ls.ruleOn = !!on;
        if (ls.catVisTex) needClear = true; else cosmeticDirtyLayers.add(layer);   // eyes re-index on the flip
      }
    },
    // per-layer CATEGORY palette (legend colors/groups baked app-side).
    // pixels = Uint8Array(width*4) RGBA (width 256 for dict layers, 32 for LAS
    // classification — it must match what uPaletteN samples), null = built-ins.
    setLayerPalette(layer, pixels, width = 256) {
      const ls = layerOf(layer);
      if (!pixels) {
        if (ls.paletteTex) { gl.deleteTexture(ls.paletteTex); ls.paletteTex = null; ls.paletteW = 0; }
      } else if (!ls.paletteTex || ls.paletteW !== width) {
        if (ls.paletteTex) gl.deleteTexture(ls.paletteTex);
        ls.paletteTex = lutTexture(gl, pixels, width);
        ls.paletteW = width;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, ls.paletteTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      cosmeticDirtyLayers.add(layer);
    },
    // per-layer color ramp LUT (layer properties: presets + baked breakpoints).
    // pixels = Uint8Array(256*4) RGBA, or null to fall back to the built-in ramp.
    // OPT-IN: drive block color from an R32F VALUE texture (one texel per record,
    // 8192-wide rows) instead of the baked aChan buffer. `range` = [lo, hi] for the
    // ramp normalization — a computed texture has no docChan of its own. Pass a
    // null texture to fall back to aChan. The caller OWNS the texture (create,
    // render into, delete); the renderer only samples it.
    setLayerChanTex(layer, tex, range = null) {
      const ls = layerOf(layer);
      ls.chanTex = tex || null;
      ls.chanTexRange = (tex && range) ? [range[0], Math.max(1e-9, range[1] - range[0])] : null;
      cosmeticDirtyLayers.add(layer);
    },
    setLayerRamp(layer, pixels) {
      const ls = layerOf(layer);
      if (!pixels) {
        if (ls.rampTex) { gl.deleteTexture(ls.rampTex); ls.rampTex = null; }
      } else if (!ls.rampTex) {
        ls.rampTex = lutTexture(gl, pixels, 256);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, ls.rampTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      cosmeticDirtyLayers.add(layer);
    },
    // per-CLASS visibility (layer properties): vis = Uint8Array(256) of 0|1, or
    // null to clear. GPU-side — the class code already rides every element as
    // an attribute, so eyes are a texture update: no sweeps, any element count.
    // Composes with the filter mask (both are cull paths); hidden classes
    // don't pick either (gl-pick reads the same texture).
    setLayerCatVisibility(layer, vis) {
      const ls = layerOf(layer);
      if (!vis) {
        if (ls.catVisTex) { gl.deleteTexture(ls.catVisTex); ls.catVisTex = null; }
      } else {
        const px = new Uint8Array(256);
        for (let i = 0; i < 256; i++) px[i] = vis[i] ? 255 : 0;
        if (!ls.catVisTex) {
          ls.catVisTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, px);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, px);
        }
      }
      needClear = true;
    },
    setLayerVisible(layer, on) {
      const ls = layerOf(layer);
      if (ls.visible !== !!on) { ls.visible = !!on; needClear = true; }
    },
    removeLayer(layer) {
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i]._layer !== layer) continue;
        freeChunk(chunks[i]);
        chunks.splice(i, 1);
      }
      const ls = layers.get(layer);
      if (ls && ls.maskTex) gl.deleteTexture(ls.maskTex);
      if (ls && ls.catVisTex) gl.deleteTexture(ls.catVisTex);
      if (ls && ls.rampTex) gl.deleteTexture(ls.rampTex);
      if (ls && ls.paletteTex) gl.deleteTexture(ls.paletteTex);
      if (ls && ls.selTex) gl.deleteTexture(ls.selTex);
      if (ls && ls.ruleTex) gl.deleteTexture(ls.ruleTex);
      layers.delete(layer);
      if (resolvePipe) resolvePipe.dropBake(layer);
      layerMaxRec.delete(layer); bakeDirty.delete(layer);
      lastCosSig.delete(layer); cosmeticDirtyLayers.delete(layer);
      needClear = true;
    },
    layerElementCount(layer) {
      const ls = layers.get(layer);
      if (!ls) return 0;
      return chunks.reduce((s, c) => s + (c._layer === layer && c._set === ls.set ? c.count : 0), 0);
    },
    invalidate() { needClear = true; },
    // Pick/unpick over a CONVERGED frame repaints just the affected elements
    // (a depth-LEQUAL pass where everything else clips out) instead of
    // restarting the accumulation — same total vertex work, none of the
    // de-densify blink. Mid-accumulation falls back to the clear.
    // { layer, rec } — or null for "nothing picked". The pair IS the identity:
    // record 5 of layer 2 and record 5 of layer 3 are different elements.
    setPicked(pick) {
      const next = pick == null ? 0xFFFFFFFF : (pick.rec >>> 0);
      const nextL = pick == null ? 0xFFFFFFFF : (pick.layer >>> 0);
      if (next === pickedRec && nextL === pickedLayer) return;
      const prev = pickedRec;
      pickedRec = next; pickedLayer = nextL;
      if (lastConverged && !needClear) {
        if (prev !== 0xFFFFFFFF) repaintSet.add(prev);
        if (next !== 0xFFFFFFFF) repaintSet.add(next);
        if (repaintSet.size > 2) { repaintSet.clear(); needClear = true; }   // rapid multi-pick: one redraw is cheaper
      } else needClear = true;
    },
    // GPU pick at CSS coordinates → PARTITIONED record id | null. Draws each
    // visible layer's accumulated prefix into a scissored offscreen target with
    // the record id as the color (gl-pick.js) — you pick exactly what you see.
    // marquee/lasso support (spec §15): render the ID buffer once over a CSS
    // rect and hand back the raw pixels — the app polygon-masks and decodes.
    pickRegion(cssRect, cam, { pointPx = 2.5, blocksAsPoints = false, section = null } = {}) {
      if (!chunks.length) return null;
      if (!pickPipe) pickPipe = createPickPipeline(gl);
      const dpr = window.devicePixelRatio || 1;
      const x = Math.max(0, Math.round(cssRect.x * dpr));
      const yTop = Math.round(cssRect.y * dpr);
      const w = Math.min(canvas.width - x, Math.round(cssRect.w * dpr));
      const h = Math.min(canvas.height, Math.round(cssRect.h * dpr));
      const y = Math.max(0, canvas.height - yTop - h);
      if (w <= 0 || h <= 0) return null;
      const data = pickPipe.pickRegion(x, y, w, h, chunks.filter(activeChunk), cam, {
        pointPx, blocksAsPoints, layerStates: layers,
        section: section && section.on ? section : null,
        viewportW: canvas.width, viewportH: canvas.height,
      });
      return { data, w, h, dpr };                          // rows bottom-up (GL), NO_HIT = 0xFFFFFFFF
    },
    pick(cssX, cssY, cam, { pointPx = 2.5, blocksAsPoints = false, section = null } = {}) {
      if (!chunks.length) return null;
      if (!pickPipe) pickPipe = createPickPipeline(gl);
      const dpr = window.devicePixelRatio || 1;
      const px = Math.round(cssX * dpr), py = Math.round(canvas.height - cssY * dpr - 1);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
      return pickPipe.pick(px, py, chunks.filter(activeChunk), cam, {
        pointPx, blocksAsPoints, layerStates: layers,
        section: section && section.on ? section : null,
        viewportW: canvas.width, viewportH: canvas.height,
      });
    },
    clearChunks() {
      for (const c of chunks) freeChunk(c);
      chunks.length = 0; needClear = true;
      for (const ls of layers.values()) { if (ls.maskTex) gl.deleteTexture(ls.maskTex); if (ls.catVisTex) gl.deleteTexture(ls.catVisTex); if (ls.rampTex) gl.deleteTexture(ls.rampTex); if (ls.paletteTex) gl.deleteTexture(ls.paletteTex); if (ls.selTex) gl.deleteTexture(ls.selTex); if (ls.ruleTex) gl.deleteTexture(ls.ruleTex); }
      layers.clear();
      if (resolvePipe) resolvePipe.clear();
      layerMaxRec.clear(); bakeDirty.clear(); idCapture = null;
      lastCosSig.clear(); cosmeticDirtyLayers.clear();
    },
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; needClear = true; }
      return [w, h];
    },
    // Draw one frame into the CURRENT framebuffer (the EDL pass owns the target).
    // opts.layerOpts = { [id]: { colorMode, clip } } overrides the global color
    // opts per layer (absent → the globals, so single-layer callers are unchanged).
    // Returns { drawn, converged, visible }.
    draw(cam, { budget = 3_000_000, pointPx = 2.5, colorMode = 0, blocksAsPoints = false, blockEdges = false, section = null, clip = null, layerOpts = null } = {}) {
      const vp = cam.state.viewProj;
      const sec = section && section.on ? section : null;
      const secKey = sec ? `${sec.n.join(',')}|${sec.d}|${sec.half}` : 'off';
      // the old single draw key, SPLIT: structural changes re-raster; cosmetic
      // ones (color mode, clip, per-layer view opts — plus whatever the
      // cosmetic setters touched) can deferred-re-shade over the converged frame
      const structKey = `${pointPx}|${blocksAsPoints ? 'P' : 'B'}${blockEdges ? 'E' : ''}|${secKey}|${canvas.width}x${canvas.height}`;
      let moving = vpChanged(vp) || structKey !== lastKey || needClear;

      const db = docBbox || Float64Array.of(0, 0, 0, 1, 1, 1);
      // per-layer view opts (color mode + clip); the globals when not overridden
      const lopt = (id) => (layerOpts && layerOpts[id]) || { colorMode, clip };
      // elevation ramp = the SCENE z range (layers share vertical space) + clip
      const zRangeOf = (o) => {
        const zLo = o.clip && o.clip[0] != null && o.colorMode === 0 ? o.clip[0] : db[2];
        const zHi = o.clip && o.clip[1] != null && o.colorMode === 0 ? o.clip[1] : db[5];
        return [zLo, Math.max(zHi - zLo, 1e-6)];
      };

      // per-layer cosmetic DIRT: explicit setter dirt + drift in the view opts
      // this layer's raster consumed (color mode + clip, global or per-layer).
      // Hidden layers can't change pixels; meshes ignore color opts entirely
      // (their cosmetics go through setLayerMeshStyle → needClear).
      const sigOf = (id) => { const o = lopt(id); return `${o.colorMode}|${o.clip ? `${o.clip[0]}~${o.clip[1]}` : 'a'}`; };
      const kindBy = new Map(), subBy = new Set();
      for (const c of chunks) if (activeChunk(c)) {
        if (!kindBy.has(c._layer)) kindBy.set(c._layer, c.kind);
        if (c.dimPalette) subBy.add(c._layer);             // sub-blocked: variable half-dims
      }
      const dirty = new Set(cosmeticDirtyLayers);
      for (const id of kindBy.keys()) if (lastCosSig.get(id) !== sigOf(id)) dirty.add(id);
      for (const id of [...dirty]) { const k = kindBy.get(id); if (!k || k === 'mesh') dirty.delete(id); }

      // ── DEFERRED RE-SHADE (gl-resolve.js): cosmetic changes over a CONVERGED
      // frame become one fullscreen resolve pass per DIRTY layer — O(pixels) at
      // any model size. Untouched layers (a drillhole sticks layer while the
      // block ramp drags) keep their accumulated pixels; only a change to a
      // layer the id buffer can't express (sticks/soup recolor, culling,
      // opacity, edges) falls through to the re-raster. ──
      if (!moving && dirty.size && lastConverged) {
        if (!resolvePipe) resolvePipe = createResolvePipeline(gl);
        resolveOk: if (resolvePipe.ok) {
          let bail = false;
          const groups = new Map();
          for (const id of dirty) {
            const ls = layerOf(id), k = kindBy.get(id);
            if (k !== 'points' && k !== 'blocks') { bail = true; break; }   // a sticks/soup recolor must re-raster
            if (ls.opacity < 0.999) { bail = true; break; }   // screen-door holes aren't in the id buffer
            // edge lines RESOLVE for regular grids (the capture depth unprojects
            // the hit point, the lattice snaps the center); sub-blocked models
            // have per-block half-dims the depth alone can't recover
            if (k === 'blocks' && (ls.edges != null ? ls.edges : blockEdges) && subBy.has(id)) { bail = true; break; }
            groups.set(id, []);
            // NOTE: isolate filters and class eyes (catVis) are FINE here even
            // though they cull — changing them goes through needClear, so at
            // this point they are unchanged since the capture and the id
            // buffer already reflects the culled geometry.
          }
          if (bail || !groups.size) break resolveOk;
          const act = chunks.filter(activeChunk);
          for (const c of act) { const g = groups.get(c._layer); if (g) g.push(c); }
          // capture the id buffer LAZILY — ids don't depend on cosmetics, so the
          // pre-change converged geometry still yields the correct capture; a
          // still scene that never gets a cosmetic poke never pays for one
          if (!pickPipe) pickPipe = createPickPipeline(gl);
          const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
          if (!idCapture || idCapture.w !== canvas.width || idCapture.h !== canvas.height) {
            idCapture = pickPipe.captureViewport(act, cam, {
              pointPx, blocksAsPoints, layerStates: layers,
              section: sec, viewportW: canvas.width, viewportH: canvas.height,
            });
          }
          for (const [id, group] of groups) {              // (re)bake stale attr textures
            if (!resolvePipe.hasBake(id) || bakeDirty.has(id)) {
              resolvePipe.bakeLayer(id, group, layerMaxRec.get(id) || 0);
              bakeDirty.delete(id);
            }
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);     // back to the EDL target
          gl.viewport(0, 0, canvas.width, canvas.height);
          // headlight — the exact formula blocksPipe.begin computes
          const s = cam.state, v = s.view;
          let lx = s.eye[0] - s.target[0], ly = s.eye[1] - s.target[1], lz = s.eye[2] - s.target[2];
          const ll = Math.hypot(lx, ly, lz) || 1;
          lx = lx / ll + v[1] * 0.4; ly = ly / ll + v[5] * 0.4; lz = lz / ll + v[9] * 0.4;
          const l2 = Math.hypot(lx, ly, lz) || 1;
          const lightDir = [lx / l2, ly / l2, lz / l2];
          const invVP = mat4Inverse(vp);                   // edge-line unproject
          const perspScale = s.ortho ? (canvas.height / 2) / s.halfH : (canvas.height / 2) / Math.tan(s.fovY / 2);
          for (const [id, group] of groups) {
            const ls = layerOf(id), o = lopt(id), zr = zRangeOf(o);
            let u;
            if (group[0].kind === 'blocks') {
              const cLo = o.clip && o.clip[0] != null && o.colorMode === 1 ? o.clip[0] : (ls.docChan[0] === Infinity ? 0 : ls.docChan[0]);
              const cHi = o.clip && o.clip[1] != null && o.colorMode === 1 ? o.clip[1] : ls.docChan[1];
              // the cut wall faces the viewer: the section normal signed toward the eye
              const lsec = layerSecOf(ls, sec);
              let cutN = [0, 0, 1];
              if (lsec) {
                const sgn = Math.sign(s.eye[0] * lsec.n[0] + s.eye[1] * lsec.n[1] + s.eye[2] * lsec.n[2] - lsec.d) || 1;
                cutN = [lsec.n[0] * sgn, lsec.n[1] * sgn, lsec.n[2] * sgn];
              }
              u = {
                kind: 'blocks', colorMode: o.colorMode, zRange: zr,
                chanDoc: ls.chanTex && ls.chanTexRange ? ls.chanTexRange : [cLo, cHi > cLo ? cHi - cLo : 1],
                paletteN: 256, intensityScale: 1,
                ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette,
                mask: ls.maskTex, sel: ls.selTex, rule: ls.ruleOn ? ls.ruleTex : null, chanTex: ls.chanTex,
                picked: pickedRec, pickedLayer, lightDir, cutNormal: cutN,
                edges: ls.edges != null ? ls.edges : blockEdges, depth: idCapture.depth,
                invVP, viewportW: canvas.width, viewportH: canvas.height,
                eye: [s.eye[0], s.eye[1], s.eye[2]], ortho: s.ortho, perspScale,
                grid: group[0].grid,
              };
            } else {
              u = {
                kind: 'points', colorMode: o.colorMode, zRange: zr, chanDoc: [0, 1],
                paletteN: ls.paletteTex ? ls.paletteW : (ls.catN || 32),
                intensityScale: 65535 / (ls.intensityMax || 1),
                ramp: ls.rampTex || ramp, palette: ls.paletteTex || (ls.catN && catPalette ? catPalette : palette),
                mask: ls.maskTex, sel: ls.selTex, rule: ls.ruleOn ? ls.ruleTex : null, chanTex: null,
                picked: pickedRec, pickedLayer, lightDir: [0, 0, 1], cutNormal: [0, 0, 1],
              };
            }
            resolvePipe.resolveLayer(idCapture.tex, id, u);
          }
          resolves++;
          for (const id of kindBy.keys()) lastCosSig.set(id, sigOf(id));
          cosmeticDirtyLayers.clear();
          // repaintSet stays: a pending pick highlight on a NON-resolved layer
          // is repainted by the next still frame's repaint pass
          return { drawn: 0, converged: true, visible: lastVisible, resolved: true };
        }
      }
      if (dirty.size) moving = true;                       // no resolve → a cosmetic change re-rasters
      lastKey = structKey; needClear = false;
      for (const id of kindBy.keys()) lastCosSig.set(id, sigOf(id));
      cosmeticDirtyLayers.clear();
      if (moving) { repaintSet.clear(); idCapture = null; }   // full redraw covers pending repaint; the capture is stale

      // frustum-cull + front-to-back over chunk bboxes (tight, thanks to Morton)
      const planes = frustumPlanes(vp);
      const eye = cam.state.eye;
      const visible = [];
      const padBox = new Float64Array(6);
      for (const c of chunks) {
        if (!activeChunk(c)) continue;
        let cullBox = c.bboxLocal;
        if (c.kind === 'sticks') {
          const r = layerOf(c._layer).stickRadius;
          for (let i = 0; i < 3; i++) { padBox[i] = c.bboxLocal[i] - r; padBox[i + 3] = c.bboxLocal[i + 3] + r; }
          cullBox = padBox;
        }
        if (!aabbInFrustum(planes, cullBox)) { if (moving) c.cursor = 0; continue; }
        const b = c.bboxLocal;
        const cx = (b[0] + b[3]) / 2 - eye[0], cy = (b[1] + b[4]) / 2 - eye[1], cz = (b[2] + b[5]) / 2 - eye[2];
        const dist = Math.max(Math.hypot(cx, cy, cz), cam.state.near);
        const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 || 1;
        c._dist = dist;
        c._w = Math.min(1, (r / dist) * (r / dist));       // projected-area weight
        visible.push(c);
      }
      visible.sort((a, b) => a._dist - b._dist);           // front-to-back
      lastVisible = visible.length;
      const sumW = visible.reduce((s, c) => s + c._w, 0) || 1;

      gl.enable(gl.DEPTH_TEST);
      if (moving) {
        gl.clearColor(background[0], background[1], background[2], background[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        for (const c of visible) c.cursor = 0;
      }

      // this frame's allotment per chunk: budget share by projected weight, floored
      // so distant chunks keep a sparse presence (coarse prefix always on)
      const allot = (c) => {
        const share = Math.max(Math.min(c.count, 1000), Math.floor(budget * (c._w / sumW)));
        const first = moving ? 0 : c.cursor;
        return [first, Math.min(c.count - first, share)];
      };
      let drawn = 0, converged = true;
      // pending pick repaint: one extra full-geometry pass at depth LEQUAL —
      // lands exactly on the element's already-accumulated pixels
      const rp = !moving && repaintSet.size
        ? [...repaintSet, 0xFFFFFFFF, 0xFFFFFFFF].slice(0, 2).map((v) => v >>> 0) : null;

      // context meshes first: static occluders drawn WHOLE on clear frames (or
      // when freshly streamed in) — early-z then rejects points behind them.
      // On still frames their cursor == count, so accumulation skips them.
      const msh = visible.filter((c) => c.kind === 'mesh');
      if (msh.length) {
        for (const [id, group] of byLayer(msh)) {
          if (!group.some((c) => moving || c.cursor === 0)) continue;
          const ls = layerOf(id);
          meshPipe.begin(cam, { tint: ls.meshTint, opacity: ls.meshOpacity, section: meshSecOf(ls, sec),
            vcolor: group.some((c) => c.hasColor), vnormal: group.some((c) => c.hasNormal) });   // heightfield drape + smooth normals
          for (const c of group) {
            if (!(moving || c.cursor === 0)) continue;
            meshPipe.draw(c);
            c.cursor = c.count;
            drawn += c.count;
          }
        }
        gl.bindVertexArray(null);
      }

      // streaming-tier meshes: budgeted prefixes like points (the shuffle makes
      // any prefix a uniform subsample of the soup), drawn before points so the
      // surface occludes early
      const soup = visible.filter((c) => c.kind === 'soup');
      if (soup.length) {
        for (const [id, group] of byLayer(soup)) {
          const ls = layerOf(id);
          soupPipe.begin(cam, { tint: ls.meshTint, opacity: ls.meshOpacity, section: meshSecOf(ls, sec) });
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              soupPipe.drawSlice(c, first, k);
              drawn += k; c.cursor = first + k;
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        gl.bindVertexArray(null);
      }

      const pts = visible.filter((c) => c.kind === 'points');
      if (pts.length) {
        const ptsGroups = byLayer(pts);
        gl.useProgram(prog);
        gl.uniformMatrix4fv(uni.viewProj, false, vp);
        gl.uniform1f(uni.pointPx, pointPx * (window.devicePixelRatio || 1));
        gl.uniform1ui(uni.picked, pickedRec);
        gl.uniform1ui(uni.pickedLayer, pickedLayer);
        gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ramp); gl.uniform1i(uni.ramp, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, palette); gl.uniform1i(uni.palette, 1);
        // per-layer uniforms + slices (front-to-back preserved within each group)
        const setupPtsLayer = (id) => {
          const ls = layerOf(id), o = lopt(id), zr = zRangeOf(o);
          gl.uniform1ui(uni.layer, id >>> 0);
          const lsec = layerSecOf(ls, sec);
          gl.uniform4f(uni.secPlane, lsec ? lsec.n[0] : 0, lsec ? lsec.n[1] : 0, lsec ? lsec.n[2] : 1, lsec ? lsec.d : 0);
          gl.uniform2f(uni.secCfg, lsec ? 1 : 0, lsec ? lsec.half : 0);
          gl.uniform1i(uni.colorMode, o.colorMode);
          gl.uniform2f(uni.zRange, zr[0], zr[1]);
          gl.uniform1f(uni.intensityScale, 65535 / (ls.intensityMax || 1));
          gl.uniform1f(uni.paletteN, ls.paletteTex ? ls.paletteW : (ls.catN || 32));
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, ls.paletteTex || (ls.catN && catPalette ? catPalette : palette));
          gl.uniform1i(uni.palette, 1);
          gl.uniform1f(uni.filterOn, ls.maskTex ? 1 : 0);
          gl.uniform1f(uni.isolate, ls.isolate ? 1 : 0);
          if (ls.maskTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ls.maskTex); gl.uniform1i(uni.mask, 4); }
          gl.uniform1f(uni.catVisOn, ls.catVisTex ? 1 : 0);
          if (ls.catVisTex) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ls.catVisTex); gl.uniform1i(uni.catVis, 5); }
          gl.uniform1f(uni.selOn, ls.selTex ? 1 : 0);
          if (ls.selTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ls.selTex); gl.uniform1i(uni.sel, 6); }
          gl.uniform1f(uni.ruleOn, ls.ruleOn && ls.ruleTex ? 1 : 0);
          if (ls.ruleOn && ls.ruleTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, ls.ruleTex); gl.uniform1i(uni.rule, 7); }
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ls.rampTex || ramp); gl.uniform1i(uni.ramp, 0);
        };
        for (const [id, group] of ptsGroups) {
          setupPtsLayer(id);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
              gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
              gl.bindVertexArray(c.vao);
              gl.drawArrays(gl.POINTS, first, k);
              drawn += k; c.cursor = first + k;
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          gl.uniform2ui(uni.repaint, rp[0], rp[1]);
          for (const [id, group] of ptsGroups) {
            setupPtsLayer(id);
            for (const c of group) {
              gl.uniform3f(uni.boxMin, c.bboxLocal[0], c.bboxLocal[1], c.bboxLocal[2]);
              gl.uniform3f(uni.boxSpan, c.bboxLocal[3] - c.bboxLocal[0], c.bboxLocal[4] - c.bboxLocal[1], c.bboxLocal[5] - c.bboxLocal[2]);
              gl.bindVertexArray(c.vao);
              gl.drawArrays(gl.POINTS, 0, c.count);
            }
          }
          gl.uniform2ui(uni.repaint, 0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }

      const blks = visible.filter((c) => c.kind === 'blocks');
      if (blks.length) {
        const blkGroups = byLayer(blks);
        const perspScale = (canvas.height / 2) / Math.tan(cam.state.fovY / 2);
        const cheapOf = (c) => {
          // the whole chunk below the demotion threshold → the cheap program
          // (no gl_FragDepth → early-z stays on): the far-field perf lever
          const b = c.bboxLocal;
          const bboxR = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
          // sub-blocked: fine grid.size is the min pitch — use the largest box radius
          const rBlock = c.dimPalette
            ? Math.max(...c.dimPalette.map((h) => Math.hypot(h[0], h[1], h[2])))
            : Math.hypot(c.grid.size[0], c.grid.size[1], c.grid.size[2]) / 2;
          const distNear = Math.max(cam.state.near, c._dist - bboxR);
          return blocksAsPoints || rBlock * perspScale / distNear < 2.0;
        };
        const beginLayer = (id) => {
          const ls = layerOf(id), o = lopt(id);
          const cLo = o.clip && o.clip[0] != null && o.colorMode === 1 ? o.clip[0] : (ls.docChan[0] === Infinity ? 0 : ls.docChan[0]);
          const cHi = o.clip && o.clip[1] != null && o.colorMode === 1 ? o.clip[1] : ls.docChan[1];
          blocksPipe.begin(cam, {
            pointPx, colorMode: o.colorMode, zRange: zRangeOf(o),
            chanDoc: ls.chanTex && ls.chanTexRange ? ls.chanTexRange : [cLo, cHi > cLo ? cHi - cLo : 1],
            ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette, viewportH: canvas.height,
            maskTex: ls.maskTex, isolate: ls.isolate, pointsView: blocksAsPoints, picked: pickedRec, pickedLayer, layer: id,
            section: layerSecOf(ls, sec),
            catVisTex: ls.catVisTex, selTex: ls.selTex, ruleTex: ls.ruleOn ? ls.ruleTex : null,
            chanTex: ls.chanTex,
            opacity: ls.opacity, edges: ls.edges != null ? ls.edges : blockEdges,   // per-layer override, else the View toggle
          });
        };
        for (const [id, group] of blkGroups) {
          beginLayer(id);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              blocksPipe.drawSlice(c, first, k, cheapOf(c));
              drawn += k; c.cursor = first + k;
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          for (const [id, group] of blkGroups) {
            beginLayer(id);                                // begin resets uRepaint — set it after, per layer
            blocksPipe.setRepaint(rp[0], rp[1]);
            for (const c of group) blocksPipe.drawSlice(c, 0, c.count, cheapOf(c));
          }
          blocksPipe.setRepaint(0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }
      const stks = visible.filter((c) => c.kind === 'sticks');
      if (stks.length) {
        const stkGroups = byLayer(stks);
        const perspScale2 = cam.state.ortho ? (canvas.height / 2) / cam.state.halfH : (canvas.height / 2) / Math.tan(cam.state.fovY / 2);
        const cheapOf2 = (c) => {
          // whole chunk under the demotion threshold → the no-fragdepth program
          const ls = layerOf(c._layer);
          const b = c.bboxLocal;
          const bboxR = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
          const distNear = Math.max(cam.state.near, c._dist - bboxR);
          // a generous per-chunk proxy: the layer radius at the chunk's nearest point
          return blocksAsPoints || (ls.stickRadius * 4) * perspScale2 / (cam.state.ortho ? 1 : distNear) < 2.0;
        };
        const beginStkLayer = (id) => {
          const ls = layerOf(id), o = lopt(id);
          const cLo = o.clip && o.clip[0] != null && o.colorMode === 1 ? o.clip[0] : (ls.docChan[0] === Infinity ? 0 : ls.docChan[0]);
          const cHi = o.clip && o.clip[1] != null && o.colorMode === 1 ? o.clip[1] : ls.docChan[1];
          sticksPipe.begin(cam, {
            pointPx, colorMode: o.colorMode, zRange: zRangeOf(o),
            chanDoc: [cLo, cHi > cLo ? cHi - cLo : 1],
            ramp: ls.rampTex || ramp, palette: ls.paletteTex || catPalette || palette, viewportH: canvas.height,
            maskTex: ls.maskTex, isolate: ls.isolate, pointsView: blocksAsPoints, picked: pickedRec, pickedLayer, layer: id,
            section: layerSecOf(ls, sec),
            radius: ls.stickRadius, catVisTex: ls.catVisTex, selTex: ls.selTex, ruleTex: ls.ruleOn ? ls.ruleTex : null,
            opacity: ls.opacity,
          });
        };
        for (const [id, group] of stkGroups) {
          beginStkLayer(id);
          for (const c of group) {
            const [first, k] = allot(c);
            if (k > 0) {
              sticksPipe.drawSlice(c, first, k, cheapOf2(c));
              drawn += k; c.cursor = first + k;
            }
            if (c.cursor < c.count) converged = false;
          }
        }
        if (rp) {
          gl.depthFunc(gl.LEQUAL);
          for (const [id, group] of stkGroups) {
            beginStkLayer(id);
            sticksPipe.setRepaint(rp[0], rp[1]);
            for (const c of group) sticksPipe.drawSlice(c, 0, c.count, cheapOf2(c));
          }
          sticksPipe.setRepaint(0xFFFFFFFF, 0xFFFFFFFF);
          gl.depthFunc(gl.LESS);
        }
      }
      if (rp) repaintSet.clear();
      lastConverged = converged;
      gl.bindVertexArray(null);
      return { drawn, converged, visible: lastVisible };
    },
  };
}

// ── src/core/edl.js ──

// @gcu/condenser — Eye-Dome Lighting post-pass (Boucheny 2009 / Ribes & Boucheny).
// The scene renders into an offscreen framebuffer (color + depth texture); a
// fullscreen pass compares each pixel's log-linear depth against its neighbors
// and darkens where neighbors are closer — unlit points read as a surface.
// Mandatory in M1 (micro-spec §2.2): without it a point cloud reads as noise.


const QUAD_VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {                          // fullscreen triangle, no buffers
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const EDL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uTexel;                   // 1/size
uniform vec2 uNearFar;
uniform float uOrtho;                  // 1 = orthographic (depth is already linear)
uniform float uStrength;               // 0 = off-look, ~1 default
uniform float uRadius;                 // sample radius in pixels
out vec4 outColor;

float linDepth(float d) {              // depth buffer -> linear eye-space z
  float n = uNearFar.x, f = uNearFar.y;
  if (uOrtho > 0.5) return n + d * (f - n);
  return (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
}
void main() {
  vec4 col = texture(uColor, vUv);
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { outColor = col; return; }              // background: untouched
  float zc = log2(max(linDepth(d), 1e-6));
  float ob = 0.0;
  const vec2 DIRS[8] = vec2[8](vec2(1.,0.), vec2(-1.,0.), vec2(0.,1.), vec2(0.,-1.),
                               vec2(.7,.7), vec2(-.7,.7), vec2(.7,-.7), vec2(-.7,-.7));
  for (int i = 0; i < 8; i++) {
    float dn = texture(uDepth, vUv + DIRS[i] * uTexel * uRadius).r;
    float zn = dn >= 1.0 ? zc + 4.0 : log2(max(linDepth(dn), 1e-6));   // background neighbor = far
    ob += max(0.0, zc - zn);
  }
  float shade = exp(-uStrength * 60.0 * ob / 8.0);
  outColor = vec4(col.rgb * shade, col.a);
}`;

function createEdl(gl) {
  const prog = makeProgram(gl, QUAD_VERT, EDL_FRAG);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uni = { color: U('uColor'), depth: U('uDepth'), texel: U('uTexel'), nearFar: U('uNearFar'), ortho: U('uOrtho'), strength: U('uStrength'), radius: U('uRadius') };
  let fbo = null, colorTex = null, depthTex = null, w = 0, h = 0;

  function ensure(width, height) {
    if (width === w && height === h && fbo) return;
    w = width; h = height;
    if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(colorTex); gl.deleteTexture(depthTex); }
    const tex = (ifmt, fmt, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    colorTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    depthTex = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return {
    // Render `sceneDraw()` through the EDL pipeline onto the default framebuffer.
    // ALWAYS goes via the FBO — progressive accumulation (§2.2) needs a persistent
    // depth buffer, which the default framebuffer doesn't guarantee; EDL-disabled
    // is strength 0 (exp(0) ≡ passthrough), so there's exactly one path.
    render(width, height, cam, sceneDraw, { enabled = true, strength = 1.0, radius = 1.4 } = {}) {
      ensure(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      const result = sceneDraw();                          // the splat pass, into the FBO (may draw 0 when converged)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, colorTex); gl.uniform1i(uni.color, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, depthTex); gl.uniform1i(uni.depth, 3);
      gl.uniform2f(uni.texel, 1 / w, 1 / h);
      gl.uniform2f(uni.nearFar, cam.state.near, cam.state.far);
      gl.uniform1f(uni.ortho, cam.state.ortho ? 1 : 0);
      gl.uniform1f(uni.strength, enabled ? strength : 0);
      gl.uniform1f(uni.radius, radius);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      return result;
    },
  };
}

// ── src/main.js ──

// @gcu/condenser — streaming no-preprocess renderer for massive spatial elements.
// The engine under micro (the scope over lamina's slide). Curated public surface.
//
// Three layers (see core.js for the engine-only entry):
//   core/ — chunk builders + GL pipelines + camera + EDL + Morton. Zero I/O.
//   io/   — file providers (LAS, PLY, delimited/dm block models, drillholes, meshes).
//   grid/ — lattice inference + the join/resample/reconcile engine.
// mesh export (micro): the ARANZ writer rides the already-inlined @gcu/msh

// ── ../../drillhole/src/desurvey.js ──

// @gcu/drillhole — desurvey: collar + survey stations → the 3D hole trace, and a
// method-consistent position at any down-hole depth.
//
// Conventions (D1): azimuth = degrees clockwise from north; dip = MINING convention,
// positive DOWN (normalizeSurveys flips neg-down files; detectDipConvention infers
// from the median); depths/lengths in any consistent unit (metres in practice).
// World frame: x = east, y = north, z = up.
//
// Reverse-vendored from BMA (A7 Phase 0, Arthur 2026-06-11) — developed there in the
// concat-source style, always intended to live here. BMA + dee re-vendor from here now.

// Unit tangent from azimuth/dip (mining pos-down): x east, y north, z up.
function dhTangent$desurvey(azDeg, dipDeg) {
  let az = azDeg * Math.PI / 180, dip = dipDeg * Math.PI / 180;
  let c = Math.cos(dip);
  return [Math.sin(az) * c, Math.cos(az) * c, -Math.sin(dip)];
}

// 'pos-down' (mining: +60 = 60° below horizontal) vs 'neg-down' (signed math: -60 =
// below). Inferred from the median dip — exploration holes point down, so the sign of
// the bulk tells the convention.
function dhDetectDipConvention$desurvey(surveys) {
  let dips = [];
  for (let i = 0; i < surveys.length; i++) {
    let d = surveys[i].dip;
    if (typeof d === 'number' && isFinite(d) && d !== 0) dips.push(d);
  }
  if (dips.length === 0) return 'pos-down';
  dips.sort(function(a, b) { return a - b; });
  let med = dips[Math.floor(dips.length / 2)];
  return med < 0 ? 'neg-down' : 'pos-down';
}

// Sort, dedupe (last wins), normalize dip to pos-down, synthesize a station at depth 0
// when the list starts deeper (copies the first attitude). Returns { stations:
// [{depth, az, dip}], dupCount, badCount }.
function dhNormalizeSurveys$desurvey(rawSurveys, dipConvention) {
  let flip = dipConvention === 'neg-down' ? -1 : 1;
  let clean = [], badCount = 0;
  for (let i = 0; i < rawSurveys.length; i++) {
    let s = rawSurveys[i];
    let depth = s.depth, az = s.az, dip = s.dip * flip;
    if (!isFinite(depth) || depth < 0 || !isFinite(az) || !isFinite(dip) || Math.abs(dip) > 90.000001) {
      badCount++;
      continue;
    }
    clean.push({ depth: depth, az: az, dip: dip });
  }
  clean.sort(function(a, b) { return a.depth - b.depth; });
  let stations = [], dupCount = 0;
  for (let j = 0; j < clean.length; j++) {
    if (stations.length && Math.abs(stations[stations.length - 1].depth - clean[j].depth) < 1e-9) {
      stations[stations.length - 1] = clean[j]; // last wins
      dupCount++;
    } else {
      stations.push(clean[j]);
    }
  }
  if (stations.length && stations[0].depth > 1e-9) {
    stations.unshift({ depth: 0, az: stations[0].az, dip: stations[0].dip });
  }
  return { stations: stations, dupCount: dupCount, badCount: badCount };
}

// Desurvey one hole. Methods:
// - 'minimumCurvature' (default): circular-arc model, RF = (2/θ)·tan(θ/2)
// - 'balancedTangential': the same without RF — averages the two end tangents per
//   segment (matches legacy desurveys from several packages)
// - 'tangential': straight segments along the LOWER station's attitude (sparse/legacy
//   surveys; matches dee's simple-tangential seed)
// collar = [x, y, z]; stations from dhNormalizeSurveys (pos-down). Returns { method,
// depths, px, py, pz, tx, ty, tz, dogleg, dls } — tangents + method ride along so
// dhPositionAt interpolates consistently. `dogleg[k]` is the angular change (degrees)
// between stations k−1 and k; `dls[k]` is the dogleg SEVERITY in °/30 length-units (the
// metric drilling-QC convention — multiply by ⅓ for °/10 m, or recompute from `dogleg`
// for °/100 ft). Both are geometry of the survey attitudes — independent of `method` —
// so they're the same whichever desurvey you pick. dogleg[0] = dls[0] = 0.
function dhDesurveyHole$desurvey(collar, stations, method) {
  method = method || 'minimumCurvature';
  let n = stations.length;
  let out = {
    method: method,
    depths: new Float64Array(n),
    px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n),
    tx: new Float64Array(n), ty: new Float64Array(n), tz: new Float64Array(n),
    dogleg: new Float64Array(n), dls: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.depths[i] = stations[i].depth;
    let t = dhTangent$desurvey(stations[i].az, stations[i].dip);
    out.tx[i] = t[0]; out.ty[i] = t[1]; out.tz[i] = t[2];
  }
  out.px[0] = collar[0]; out.py[0] = collar[1]; out.pz[0] = collar[2];

  for (let k = 1; k < n; k++) {
    let dl = out.depths[k] - out.depths[k - 1];
    // dogleg angle between the two station tangents — drives both the min-curvature RF
    // and the QC severity, and is the same for every method (it's the survey geometry).
    let dot = out.tx[k - 1] * out.tx[k] + out.ty[k - 1] * out.ty[k] + out.tz[k - 1] * out.tz[k];
    let doglegRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    out.dogleg[k] = doglegRad * 180 / Math.PI;
    out.dls[k] = dl > 1e-12 ? out.dogleg[k] / dl * 30 : 0;
    if (method === 'tangential') {
      out.px[k] = out.px[k - 1] + dl * out.tx[k];
      out.py[k] = out.py[k - 1] + dl * out.ty[k];
      out.pz[k] = out.pz[k - 1] + dl * out.tz[k];
    } else {
      let rf = 1; // balanced tangential
      // minimum curvature: RF = (2/θ)·tan(θ/2)
      if (method !== 'balancedTangential') rf = doglegRad > 1e-6 ? (2 / doglegRad) * Math.tan(doglegRad / 2) : 1;
      out.px[k] = out.px[k - 1] + 0.5 * dl * (out.tx[k - 1] + out.tx[k]) * rf;
      out.py[k] = out.py[k - 1] + 0.5 * dl * (out.ty[k - 1] + out.ty[k]) * rf;
      out.pz[k] = out.pz[k - 1] + 0.5 * dl * (out.tz[k - 1] + out.tz[k]) * rf;
    }
  }
  return out;
}

// Position at an arbitrary down-hole depth, consistent with the hole's desurvey method
// (depths between stations land on the SAME path the stations were placed on):
// - minimumCurvature: arc-correct (D2) — the closed-form integral of the slerp of the
//   end tangents: p(s) = p1 + L/(θ·sinθ)·[(cos(θ−φ) − cosθ)·d1 + (1 − cosφ)·d2],
//   φ = θ·s/L (at s = L this reduces to the RF endpoint formula; the harness pins
//   mid-segment points to an analytic circle at 1e-14)
// - tangential: straight along the lower station's attitude (how the segment was built)
// - balancedTangential: linear along the segment chord
// Beyond the last station: straight extrapolation along the last tangent (standard
// practice — intervals routinely outrun the survey).
function dhPositionAt$desurvey(hole, depth) {
  let d = hole.depths, n = d.length;
  if (n === 0) return null;
  if (depth <= d[0]) {
    let s0 = depth - d[0]; // above collar station (negative) — straight
    return [hole.px[0] + s0 * hole.tx[0], hole.py[0] + s0 * hole.ty[0], hole.pz[0] + s0 * hole.tz[0]];
  }
  if (depth >= d[n - 1]) {
    let sE = depth - d[n - 1];
    return [hole.px[n - 1] + sE * hole.tx[n - 1], hole.py[n - 1] + sE * hole.ty[n - 1], hole.pz[n - 1] + sE * hole.tz[n - 1]];
  }
  // binary search: segment [lo, lo+1] with d[lo] <= depth < d[lo+1]
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    let mid = (lo + hi) >> 1;
    if (d[mid] <= depth) lo = mid; else hi = mid;
  }
  let L = d[lo + 1] - d[lo], s = depth - d[lo];
  if (L < 1e-12) return [hole.px[lo], hole.py[lo], hole.pz[lo]];

  if (hole.method === 'tangential') {
    return [
      hole.px[lo] + s * hole.tx[lo + 1],
      hole.py[lo] + s * hole.ty[lo + 1],
      hole.pz[lo] + s * hole.tz[lo + 1],
    ];
  }
  if (hole.method === 'balancedTangential') {
    let t = s / L;
    return [
      hole.px[lo] + t * (hole.px[lo + 1] - hole.px[lo]),
      hole.py[lo] + t * (hole.py[lo + 1] - hole.py[lo]),
      hole.pz[lo] + t * (hole.pz[lo + 1] - hole.pz[lo]),
    ];
  }

  let d1 = [hole.tx[lo], hole.ty[lo], hole.tz[lo]];
  let d2 = [hole.tx[lo + 1], hole.ty[lo + 1], hole.tz[lo + 1]];
  let dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  let theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (theta < 1e-9) {
    return [hole.px[lo] + s * d1[0], hole.py[lo] + s * d1[1], hole.pz[lo] + s * d1[2]];
  }
  let phi = theta * s / L;
  let kk = L / (theta * Math.sin(theta));
  let a = (Math.cos(theta - phi) - Math.cos(theta)) * kk;
  let b = (1 - Math.cos(phi)) * kk;
  return [
    hole.px[lo] + a * d1[0] + b * d2[0],
    hole.py[lo] + a * d1[1] + b * d2[1],
    hole.pz[lo] + a * d1[2] + b * d2[2],
  ];
}

// ── ../../drillhole/src/validate.js ──

// @gcu/drillhole — validate: join + check the three tables. Nothing is silently
// dropped; every exclusion lands in the report with a count and a BHID list.
//
// The collar+survey join (dhJoinHoles) and per-hole station normalization
// (dhNormalizeHoleStations) are factored out so the point-sample locator
// (dhDesurveySamples) reuses the exact same hole-building — one join, two consumers.


// Build the per-hole structure from collars + surveys (NOT normalized yet — callers
// normalize only the holes that pass their own gate, so a skipped hole doesn't accrue
// advisory counts). Returns { holes: bhid→{bhid,collar,eoh,rawSurveys}, order: [] }.
function dhJoinHoles$validate(tables, dipConvention, hit) {
  let holes = {}, order = [];
  for (let ci = 0; ci < (tables.collars || []).length; ci++) {
    let c0 = tables.collars[ci];
    let bid = String(c0.bhid).trim();
    if (!bid) { hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', null); continue; }
    if (!isFinite(c0.x) || !isFinite(c0.y) || !isFinite(c0.z)) {
      hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', bid);
      continue;
    }
    if (holes[bid]) { hit('dup-collar', 'Duplicate collar BHIDs (first kept)', bid); continue; }
    holes[bid] = { bhid: bid, collar: [c0.x, c0.y, c0.z], eoh: isFinite(c0.eoh) ? c0.eoh : null, rawSurveys: [] };
    order.push(bid);
  }
  for (let si = 0; si < (tables.surveys || []).length; si++) {
    let s0 = tables.surveys[si];
    let sb = String(s0.bhid).trim();
    let h = holes[sb];
    if (!h) { hit('orphan-survey', 'Survey rows whose BHID has no collar (excluded)', sb); continue; }
    h.rawSurveys.push({ depth: s0.depth, az: s0.az, dip: s0.dip });
  }
  return { holes: holes, order: order };
}

// Normalize one hole's raw surveys → hole.stations (pos-down, sorted, deduped, depth-0
// synthesized), with the no-usable-survey straight-down fallback and the survey-side
// past-EOH advisory. Counts ride into `hit`. Mutates + returns the hole.
function dhNormalizeHoleStations$validate(hole, dipConvention, hit) {
  let norm = dhNormalizeSurveys$desurvey(hole.rawSurveys, dipConvention);
  if (norm.badCount) for (let bi = 0; bi < norm.badCount; bi++) hit('bad-survey', 'Survey rows with non-numeric depth/azimuth or |dip| > 90 (excluded)', hole.bhid);
  if (norm.dupCount) for (let di = 0; di < norm.dupCount; di++) hit('dup-survey-depth', 'Duplicate survey depths in a hole (last kept)', hole.bhid);
  if (norm.stations.length === 0) {
    hit('collar-no-survey', 'Holes with no usable survey (desurveyed straight down)', hole.bhid);
    norm.stations = [{ depth: 0, az: 0, dip: 90 }];
  }
  hole.stations = norm.stations;
  if (hole.eoh != null && norm.stations[norm.stations.length - 1].depth > hole.eoh + 1e-9) {
    hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hole.bhid);
  }
  return hole;
}

// tables = {
//   collars:  [{ bhid, x, y, z, eoh }],            // eoh optional/null
//   surveys:  [{ bhid, depth, az, dip }],          // dip raw (per file)
//   intervals: { bhid: [], from: [], to: [],
//                cols: [{ name, type: 'num'|'cat', values: [] }] }
// }
// opts = { dipConvention: 'auto'|'pos-down'|'neg-down', method }
function dhValidate$validate(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention$desurvey(tables.surveys || []);

  let joined = dhJoinHoles$validate(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].iv = [];

  // intervals
  let iv = tables.intervals || { bhid: [], from: [], to: [], cols: [] };
  let nIv = iv.bhid.length;
  for (let ii = 0; ii < nIv; ii++) {
    let ib = String(iv.bhid[ii]).trim();
    let h2 = holes[ib];
    if (!h2) { hit('orphan-interval', 'Interval rows whose BHID has no collar (excluded)', ib); continue; }
    let f = iv.from[ii], t = iv.to[ii];
    if (!isFinite(f) || !isFinite(t) || f < 0 || t <= f) {
      hit('bad-interval', 'Interval rows with FROM ≥ TO, negative or non-numeric depths (excluded)', ib);
      continue;
    }
    h2.iv.push(ii);
  }

  // per-hole structure (normalize only the holes that have intervals)
  let ready = [];
  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.iv.length === 0) { hit('collar-no-intervals', 'Collars with no interval rows (hole skipped)', hh.bhid); continue; }

    dhNormalizeHoleStations$validate(hh, dipConvention, hit);

    // interval-side past-EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.iv.length; ei++) {
        if (iv.to[hh.iv[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    // overlap flag (composited as-is; SUPPORT double-counts — flagged per hole)
    let idx = hh.iv.slice().sort(function(a, b) { return iv.from[a] - iv.from[b]; });
    for (let vi = 1; vi < idx.length; vi++) {
      if (iv.from[idx[vi]] < iv.to[idx[vi - 1]] - 1e-9) {
        hit('overlap', 'Holes with overlapping intervals (composited as-is; SUPPORT double-counts)', hh.bhid);
        break;
      }
    }
    hh.iv = idx;
    ready.push(hh);
  }

  return { holes: ready, checks: checks, dipConvention: dipConvention, intervals: iv };
}

// ── ../../drillhole/src/samples.js ──

// @gcu/drillhole — point-sample locator. Some data is point-support, not intervals:
// single-depth assays (handheld XRF, density readings) or already-composited samples
// re-imported. Compositing (length-weighting into windows) doesn't apply — you just
// want each sample placed in 3D on the desurveyed trace. This is that path; it reuses
// the same collar+survey join + station normalization as dhValidate.


// tables = { collars, surveys, samples: { bhid:[], depth:[], cols:[{name,type,values}] } }
// opts   = { dipConvention, method }
// Returns { header: ['BHID','X','Y','Z','DEPTH', ...cols], rows, report } — one located
// row per valid sample (sorted down-hole within each hole), with the same non-silent
// consistency report style as the interval pipeline.
function dhDesurveySamples$samples(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention$desurvey(tables.surveys || []);

  let joined = dhJoinHoles$validate(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].smp = [];

  // samples → per-hole index lists
  let smp = tables.samples || { bhid: [], depth: [], cols: [] };
  let cols = smp.cols || [];
  let nS = smp.bhid.length;
  for (let ii = 0; ii < nS; ii++) {
    let bid = String(smp.bhid[ii]).trim();
    let h = holes[bid];
    if (!h) { hit('orphan-sample', 'Sample rows whose BHID has no collar (excluded)', bid); continue; }
    let d = smp.depth[ii];
    if (!isFinite(d) || d < 0) { hit('bad-sample', 'Sample rows with negative or non-numeric depth (excluded)', bid); continue; }
    h.smp.push(ii);
  }

  let header = ['BHID', 'X', 'Y', 'Z', 'DEPTH'];
  for (let hc = 0; hc < cols.length; hc++) header.push(cols[hc].name);
  let rows = [];
  let nHoles = 0;

  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.smp.length === 0) { hit('collar-no-samples', 'Collars with no sample rows (hole skipped)', hh.bhid); continue; }
    dhNormalizeHoleStations$validate(hh, dipConvention, hit);
    let path = dhDesurveyHole$desurvey(hh.collar, hh.stations, opts.method);
    nHoles++;

    // EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.smp.length; ei++) {
        if (smp.depth[hh.smp[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Sample depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    let idx = hh.smp.slice().sort(function(a, b) { return smp.depth[a] - smp.depth[b]; });
    for (let k = 0; k < idx.length; k++) {
      let ii = idx[k], d = smp.depth[ii];
      let pos = dhPositionAt$desurvey(path, d);
      let row = [hh.bhid, pos[0], pos[1], pos[2], d];
      for (let c = 0; c < cols.length; c++) row.push(cols[c].values[ii]);
      rows.push(row);
    }
  }

  let checkList = [];
  for (let k in checks) checkList.push(checks[k]);
  return { header: header, rows: rows, report: { checks: checkList, nHoles: nHoles, nSamples: rows.length, dipConvention: dipConvention } };
}

// ── src/parquet-blocks.js ──

// via='files' Parquet block models — micro's openParquetBlocks ported onto the
// widget's RemoteBlob. The blob is sliced by range for every read (footer, then
// row group by row group), so a multi-GB file costs no residency anywhere: not
// in the kernel, not in the page. A micro-written file is SELF-DESCRIBING (the
// `micro:model` kv carries grid + bbox + categories), so opening micro's own
// optimized store skips discovery entirely — the loop closes.

// @gcu/parquet rides EMBEDDED AS SOURCE and is imported once via a blob URL on
// first use: it is a vendored minified rollup bundle whose ALIASED exports
// (`export{e as parquetInfoAsync}`) @gcu/build's source merge cannot rewire.
// Still self-contained — nothing is fetched at runtime. The marker below is
// substituted by build.js with the bundle's JSON-stringified source.
const PQ_SRC = "const e=[\"BOOLEAN\",\"INT32\",\"INT64\",\"INT96\",\"FLOAT\",\"DOUBLE\",\"BYTE_ARRAY\",\"FIXED_LEN_BYTE_ARRAY\"],t=[\"PLAIN\",\"GROUP_VAR_INT\",\"PLAIN_DICTIONARY\",\"RLE\",\"BIT_PACKED\",\"DELTA_BINARY_PACKED\",\"DELTA_LENGTH_BYTE_ARRAY\",\"DELTA_BYTE_ARRAY\",\"RLE_DICTIONARY\",\"BYTE_STREAM_SPLIT\"],n=[\"REQUIRED\",\"OPTIONAL\",\"REPEATED\"],r=[\"UTF8\",\"MAP\",\"MAP_KEY_VALUE\",\"LIST\",\"ENUM\",\"DECIMAL\",\"DATE\",\"TIME_MILLIS\",\"TIME_MICROS\",\"TIMESTAMP_MILLIS\",\"TIMESTAMP_MICROS\",\"UINT_8\",\"UINT_16\",\"UINT_32\",\"UINT_64\",\"INT_8\",\"INT_16\",\"INT_32\",\"INT_64\",\"JSON\",\"BSON\",\"INTERVAL\"],i=[\"UNCOMPRESSED\",\"SNAPPY\",\"GZIP\",\"LZO\",\"BROTLI\",\"LZ4\",\"ZSTD\",\"LZ4_RAW\"],o=[\"DATA_PAGE\",\"INDEX_PAGE\",\"DICTIONARY_PAGE\",\"DATA_PAGE_V2\"],f=[\"SPHERICAL\",\"VINCENTY\",\"THOMAS\",\"ANDOYER\",\"KARNEY\"];function a(e){const t=s(e);if(1===t.type)return{type:\"Point\",coordinates:l(e,t)};if(2===t.type)return{type:\"LineString\",coordinates:u(e,t)};if(3===t.type)return{type:\"Polygon\",coordinates:c(e,t)};if(4===t.type){const n=[];for(let r=0;r<t.count;r++)n.push(l(e,s(e)));return{type:\"MultiPoint\",coordinates:n}}if(5===t.type){const n=[];for(let r=0;r<t.count;r++)n.push(u(e,s(e)));return{type:\"MultiLineString\",coordinates:n}}if(6===t.type){const n=[];for(let r=0;r<t.count;r++)n.push(c(e,s(e)));return{type:\"MultiPolygon\",coordinates:n}}if(7===t.type){const n=[];for(let r=0;r<t.count;r++)n.push(a(e));return{type:\"GeometryCollection\",geometries:n}}throw new Error(`Unsupported geometry type: ${t.type}`)}function s(e){const{view:t}=e,n=1===t.getUint8(e.offset++),r=t.getUint32(e.offset,n);e.offset+=4;const i=r%1e3,o=Math.floor(r/1e3);let f=0;i>1&&i<=7&&(f=t.getUint32(e.offset,n),e.offset+=4);let a=2;return o&&a++,3===o&&a++,{littleEndian:n,type:i,dim:a,count:f}}function l(e,t){const n=[];for(let r=0;r<t.dim;r++){const r=e.view.getFloat64(e.offset,t.littleEndian);e.offset+=8,n.push(r)}return n}function u(e,t){const n=[];for(let r=0;r<t.count;r++)n.push(l(e,t));return n}function c(e,t){const{view:n}=e,r=[];for(let i=0;i<t.count;i++){const i=n.getUint32(e.offset,t.littleEndian);e.offset+=4,r.push(u(e,{...t,count:i}))}return r}const d=new TextDecoder,p={timestampFromMilliseconds:e=>new Date(Number(e)),timestampFromMicroseconds:e=>new Date(Number(e/1000n)),timestampFromNanoseconds:e=>new Date(Number(e/1000000n)),dateFromDays:e=>new Date(864e5*e),stringFromBytes:e=>e&&d.decode(e),jsonFromBytes:e=>e&&JSON.parse(d.decode(e)),geometryFromBytes:e=>e&&a({view:new DataView(e.buffer,e.byteOffset,e.byteLength),offset:0}),geographyFromBytes:e=>e&&a({view:new DataView(e.buffer,e.byteOffset,e.byteLength),offset:0}),uuidFromBytes(e){if(!e)return;const t=Array.from(e,e=>e.toString(16).padStart(2,\"0\")).join(\"\");return t.slice(0,8)+\"-\"+t.slice(8,12)+\"-\"+t.slice(12,16)+\"-\"+t.slice(16,20)+\"-\"+t.slice(20,32)}};function _(e,t,n,r){if(t&&n.endsWith(\"_DICTIONARY\")){let n=e;e instanceof Uint8Array&&!(t instanceof Uint8Array)&&(n=new t.constructor(e.length));for(let r=0;r<e.length;r++)n[r]=t[e[r]];return n}return y(e,r)}function y(e,t){const{element:n,parsers:r,utf8:i=!0,schemaPath:o}=t,{type:f,converted_type:a,logical_type:s}=n,l=\"REQUIRED\"!==n.repetition_type,u=o?.some(e=>\"VARIANT\"===e.element.logical_type?.type);if(u&&\"BYTE_ARRAY\"===f&&\"UTF8\"!==a&&\"STRING\"!==s?.type)return e;if(\"DECIMAL\"===a){const t=10**-(n.scale||0),r=new Array(e.length);for(let n=0;n<r.length;n++)e[n]instanceof Uint8Array?r[n]=h(e[n])*t:r[n]=Number(e[n])*t;return r}if(!a&&\"INT96\"===f)return Array.from(e).map(e=>{return r.timestampFromNanoseconds(86400000000000n*(((t=e)>>64n)-2440588n)+(0xffffffffffffffffn&t));var t});if(\"DATE\"===a)return Array.from(e).map(e=>r.dateFromDays(e));if(\"TIMESTAMP_MILLIS\"===a)return Array.from(e).map(e=>r.timestampFromMilliseconds(e));if(\"TIMESTAMP_MICROS\"===a)return Array.from(e).map(e=>r.timestampFromMicroseconds(e));if(\"JSON\"===a)return e.map(e=>r.jsonFromBytes(e));if(\"BSON\"===a)throw new Error(\"parquet bson not supported\");if(\"INTERVAL\"===a)throw new Error(\"parquet interval not supported\");if(\"GEOMETRY\"===s?.type)return e.map(e=>r.geometryFromBytes(e));if(\"GEOGRAPHY\"===s?.type)return e.map(e=>r.geographyFromBytes(e));if(\"UUID\"===s?.type)return e.map(e=>r.uuidFromBytes(e));if(\"UTF8\"===a||\"STRING\"===s?.type||i&&\"BYTE_ARRAY\"===f)return e.map(e=>r.stringFromBytes(e));if(\"UINT_64\"===a||\"INTEGER\"===s?.type&&64===s.bitWidth&&!s.isSigned){if(e instanceof BigInt64Array)return new BigUint64Array(e.buffer,e.byteOffset,e.length);const t=l?new Array(e.length):new BigUint64Array(e.length);for(let n=0;n<t.length;n++)t[n]=e[n];return t}if(\"UINT_32\"===a||\"INTEGER\"===s?.type&&32===s.bitWidth&&!s.isSigned){if(e instanceof Int32Array)return new Uint32Array(e.buffer,e.byteOffset,e.length);const t=l?new Array(e.length):new Uint32Array(e.length);for(let n=0;n<t.length;n++)t[n]=e[n]<0?4294967296+e[n]:e[n];return t}if(\"FLOAT16\"===s?.type)return Array.from(e).map(m);if(\"TIMESTAMP\"===s?.type){const{unit:t}=s;let n=r.timestampFromMilliseconds;\"MICROS\"===t&&(n=r.timestampFromMicroseconds),\"NANOS\"===t&&(n=r.timestampFromNanoseconds);const i=new Array(e.length);for(let t=0;t<i.length;t++)i[t]=n(e[t]);return i}return e}function h(e){if(!e.length)return 0;let t=0n;for(const n of e)t=256n*t+BigInt(n);const n=8*e.length;return t>=2n**BigInt(n-1)&&(t-=2n**BigInt(n)),Number(t)}function m(e){if(!e)return;const t=e[1]<<8|e[0],n=t>>15?-1:1,r=t>>10&31,i=1023&t;return 0===r?n*2**-14*(i/1024):31===r?i?NaN:n*(1/0):n*2**(r-15)*(1+i/1024)}function g(e,t,n){const r=e[t],i=[];let o=1;if(r.num_children)for(;i.length<r.num_children;){const r=e[t+o],f=g(e,t+o,[...n,r.name]);o+=f.count,i.push(f)}return{count:o,element:r,children:i,path:n}}function w(e,t){let n=g(e,0,[]);const r=[n];for(const e of t){const i=n.children.find(t=>t.element.name===e);if(!i)throw new Error(`parquet schema element not found: ${t}`);r.push(i),n=i}return r}function A(e){const t=[];return function e(n){if(n.children.length)for(const t of n.children)e(t);else t.push(n.path.join(\".\"))}(e),t}function E(e){let t=0;for(const{element:n}of e)\"REPEATED\"===n.repetition_type&&t++;return t}function v(e){let t=0;for(const{element:n}of e.slice(1))\"REQUIRED\"!==n.repetition_type&&t++;return t}function I(e){if(2!==e.length)return!1;const[,t]=e;return\"REPEATED\"!==t.element.repetition_type&&!t.children.length}function b(e){const t={};let n=0;for(;e.offset<e.view.byteLength;){const r=e.view.getUint8(e.offset++),i=15&r;if(0===i)break;const o=r>>4;n=o?n+o:U(e),t[`field_${n}`]=T(e,i)}return t}function T(e,t){switch(t){case 1:return!0;case 2:return!1;case 3:return e.view.getInt8(e.offset++);case 4:case 5:return U(e);case 6:return L(e);case 7:{const t=e.view.getFloat64(e.offset,!0);return e.offset+=8,t}case 8:{const t=N(e),n=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=t,n}case 9:{const t=e.view.getUint8(e.offset++),n=15&t;let r=t>>4;15===r&&(r=N(e));const i=1===n||2===n,o=new Array(r);for(let t=0;t<r;t++)o[t]=i?1===T(e,3):T(e,n);return o}case 12:return b(e);default:throw new Error(`thrift unhandled type: ${t}`)}}function N(e){let t=0,n=0;for(;;){const r=e.view.getUint8(e.offset++);if(t|=(127&r)<<n,!(128&r))return t;n+=7}}function U(e){const t=N(e);return t>>>1^-(1&t)}function L(e){const t=function(e){let t=0n,n=0n;for(;;){const r=e.view.getUint8(e.offset++);if(t|=BigInt(127&r)<<n,!(128&r))return t;n+=7n}}(e);return t>>1n^-(1n&t)}const O=new TextDecoder;function B(e){return e&&O.decode(e)}async function R(e,{parsers:t,initialFetchSize:n=524288,geoparquet:r=!0}={}){if(!(e&&e.byteLength>=0))throw new Error(\"parquet expected AsyncBuffer\");const i=Math.max(0,e.byteLength-n),o=await e.slice(i,e.byteLength),f=new DataView(o);if(827474256!==f.getUint32(o.byteLength-4,!0))throw new Error(\"parquet file invalid (footer != PAR1)\");const a=f.getUint32(o.byteLength-8,!0);if(a>e.byteLength-8)throw new Error(`parquet metadata length ${a} exceeds available buffer ${e.byteLength-8}`);if(a+8>n){const n=e.byteLength-a-8,f=await e.slice(n,i),s=new ArrayBuffer(a+8),l=new Uint8Array(s);return l.set(new Uint8Array(f)),l.set(new Uint8Array(o),i-n),D(s,{parsers:t,geoparquet:r})}return D(o,{parsers:t,geoparquet:r})}function D(f,{parsers:a,geoparquet:s=!0}={}){if(!(f instanceof ArrayBuffer))throw new Error(\"parquet expected ArrayBuffer\");const l=new DataView(f);if(a={...p,...a},l.byteLength<8)throw new Error(\"parquet file is too short\");if(827474256!==l.getUint32(l.byteLength-4,!0))throw new Error(\"parquet file invalid (footer != PAR1)\");const u=l.byteLength-8,c=l.getUint32(u,!0);if(c>l.byteLength-8)throw new Error(`parquet metadata length ${c} exceeds available buffer ${l.byteLength-8}`);const d=b({view:l,offset:u-c}),_=d.field_1,y=d.field_2.map(t=>({type:e[t.field_1],type_length:t.field_2,repetition_type:n[t.field_3],name:B(t.field_4),num_children:t.field_5,converted_type:r[t.field_6],scale:t.field_7,precision:t.field_8,field_id:t.field_9,logical_type:S(t.field_10)})),h=y.filter(e=>e.type),m=d.field_3,g=d.field_4.map(n=>({columns:n.field_1.map((n,r)=>({file_path:B(n.field_1),file_offset:n.field_2,meta_data:n.field_3&&{type:e[n.field_3.field_1],encodings:n.field_3.field_2?.map(e=>t[e]),path_in_schema:n.field_3.field_3.map(B),codec:i[n.field_3.field_4],num_values:n.field_3.field_5,total_uncompressed_size:n.field_3.field_6,total_compressed_size:n.field_3.field_7,key_value_metadata:n.field_3.field_8?.map(e=>({key:B(e.field_1),value:B(e.field_2)})),data_page_offset:n.field_3.field_9,index_page_offset:n.field_3.field_10,dictionary_page_offset:n.field_3.field_11,statistics:P(n.field_3.field_12,h[r],a),encoding_stats:n.field_3.field_13?.map(e=>({page_type:o[e.field_1],encoding:t[e.field_2],count:e.field_3})),bloom_filter_offset:n.field_3.field_14,bloom_filter_length:n.field_3.field_15,size_statistics:n.field_3.field_16&&{unencoded_byte_array_data_bytes:n.field_3.field_16.field_1,repetition_level_histogram:n.field_3.field_16.field_2,definition_level_histogram:n.field_3.field_16.field_3},geospatial_statistics:n.field_3.field_17&&{bbox:n.field_3.field_17.field_1&&{xmin:n.field_3.field_17.field_1.field_1,xmax:n.field_3.field_17.field_1.field_2,ymin:n.field_3.field_17.field_1.field_3,ymax:n.field_3.field_17.field_1.field_4,zmin:n.field_3.field_17.field_1.field_5,zmax:n.field_3.field_17.field_1.field_6,mmin:n.field_3.field_17.field_1.field_7,mmax:n.field_3.field_17.field_1.field_8},geospatial_types:n.field_3.field_17.field_2}},offset_index_offset:n.field_4,offset_index_length:n.field_5,column_index_offset:n.field_6,column_index_length:n.field_7,crypto_metadata:n.field_8,encrypted_column_metadata:n.field_9})),total_byte_size:n.field_2,num_rows:n.field_3,sorting_columns:n.field_4?.map(e=>({column_idx:e.field_1,descending:e.field_2,nulls_first:e.field_3})),file_offset:n.field_5,total_compressed_size:n.field_6,ordinal:n.field_7})),w=d.field_5?.map(e=>({key:B(e.field_1),value:B(e.field_2)})),A=B(d.field_6);return s&&function(e,t){const n=new Map,r=t?.find(({key:e})=>\"geo\"===e)?.value,i=(r&&JSON.parse(r)?.columns)??{};for(const[e,t]of Object.entries(i)){if(\"WKB\"!==t.encoding)continue;const r=\"spherical\"===t.edges?\"GEOGRAPHY\":\"GEOMETRY\",i=t.crs?.id??t.crs?.ids?.[0],o=i?`${i.authority}:${i.code.toString()}`:void 0;n.set(e,{type:r,crs:o})}for(let t=1;t<e.length;t++){const{logical_type:r,name:i,num_children:o,type:f}=e[t];o?t+=o:\"BYTE_ARRAY\"!==f||r||(e[t].logical_type=n.get(i))}}(y,w),{version:_,schema:y,num_rows:m,row_groups:g,key_value_metadata:w,created_by:A,metadata_length:c}}function M({schema:e}){return w(e,[])[0]}function S(e){return e?.field_1?{type:\"STRING\"}:e?.field_2?{type:\"MAP\"}:e?.field_3?{type:\"LIST\"}:e?.field_4?{type:\"ENUM\"}:e?.field_5?{type:\"DECIMAL\",scale:e.field_5.field_1,precision:e.field_5.field_2}:e?.field_6?{type:\"DATE\"}:e?.field_7?{type:\"TIME\",isAdjustedToUTC:e.field_7.field_1,unit:x(e.field_7.field_2)}:e?.field_8?{type:\"TIMESTAMP\",isAdjustedToUTC:e.field_8.field_1,unit:x(e.field_8.field_2)}:e?.field_10?{type:\"INTEGER\",bitWidth:e.field_10.field_1,isSigned:e.field_10.field_2}:e?.field_11?{type:\"NULL\"}:e?.field_12?{type:\"JSON\"}:e?.field_13?{type:\"BSON\"}:e?.field_14?{type:\"UUID\"}:e?.field_15?{type:\"FLOAT16\"}:e?.field_16?{type:\"VARIANT\",specification_version:e.field_16.field_1}:e?.field_17?{type:\"GEOMETRY\",crs:B(e.field_17.field_1)}:e?.field_18?{type:\"GEOGRAPHY\",crs:B(e.field_18.field_1),algorithm:f[e.field_18.field_2]}:e}function x(e){if(e.field_1)return\"MILLIS\";if(e.field_2)return\"MICROS\";if(e.field_3)return\"NANOS\";throw new Error(\"parquet time unit required\")}function P(e,t,n){return e&&{max:Y(e.field_1,t,n),min:Y(e.field_2,t,n),null_count:e.field_3,distinct_count:e.field_4,max_value:Y(e.field_5,t,n),min_value:Y(e.field_6,t,n),is_max_value_exact:e.field_7,is_min_value_exact:e.field_8}}function Y(e,t,n){const{type:r,converted_type:i,logical_type:o}=t;if(void 0===e)return e;if(\"BOOLEAN\"===r)return 1===e[0];if(\"BYTE_ARRAY\"===r)return n.stringFromBytes(e);const f=new DataView(e.buffer,e.byteOffset,e.byteLength);return\"FLOAT\"===r&&4===f.byteLength?f.getFloat32(0,!0):\"DOUBLE\"===r&&8===f.byteLength?f.getFloat64(0,!0):\"INT32\"===r&&\"DATE\"===i?n.dateFromDays(f.getInt32(0,!0)):\"INT64\"===r&&\"TIMESTAMP_MILLIS\"===i?n.timestampFromMilliseconds(f.getBigInt64(0,!0)):\"INT64\"===r&&\"TIMESTAMP_MICROS\"===i?n.timestampFromMicroseconds(f.getBigInt64(0,!0)):\"INT64\"===r&&\"TIMESTAMP\"===o?.type&&\"NANOS\"===o?.unit?n.timestampFromNanoseconds(f.getBigInt64(0,!0)):\"INT64\"===r&&\"TIMESTAMP\"===o?.type&&\"MICROS\"===o?.unit?n.timestampFromMicroseconds(f.getBigInt64(0,!0)):\"INT64\"===r&&\"TIMESTAMP\"===o?.type?n.timestampFromMilliseconds(f.getBigInt64(0,!0)):\"INT32\"===r&&4===f.byteLength?f.getInt32(0,!0):\"INT64\"===r&&8===f.byteLength?f.getBigInt64(0,!0):\"DECIMAL\"===i?h(e)*10**-(t.scale||0):\"FLOAT16\"===o?.type?m(e):\"UUID\"===o?.type?n.uuidFromBytes(e):e}function F(e){const t=b(e);return{page_locations:t.field_1.map(e=>({offset:e.field_1,compressed_page_size:e.field_2,first_row_index:e.field_3})),unencoded_byte_array_data_bytes:t.field_2}}const $=0xffffffffffffffffn,k=0x9e3779b185ebca87n,C=0xc2b2ae3d27d4eb4fn,G=0x165667b19e3779f9n,q=0x85ebca77c2b2ae63n,j=0x27d4eb2f165667c5n;function V(e,t){return(e<<t|e>>64n-t)&$}function z(e,t){return(e=V(e=e+t*C&$,31n))*k&$}function Z(e,t){return(e^=z(0n,t))*k+q&$}function X(e,t=0n){const n=new DataView(e.buffer,e.byteOffset,e.byteLength),r=e.byteLength;let i,o=0;if(r>=32){let e=t+k+C&$,f=t+C&$,a=t,s=t-k&$;for(;o+32<=r;)e=z(e,n.getBigUint64(o,!0)),o+=8,f=z(f,n.getBigUint64(o,!0)),o+=8,a=z(a,n.getBigUint64(o,!0)),o+=8,s=z(s,n.getBigUint64(o,!0)),o+=8;i=V(e,1n)+V(f,7n)+V(a,12n)+V(s,18n)&$,i=Z(i,e),i=Z(i,f),i=Z(i,a),i=Z(i,s)}else i=t+j&$;for(i=i+BigInt(r)&$;o+8<=r;)i^=z(0n,n.getBigUint64(o,!0)),i=V(i,27n)*k+q&$,o+=8;for(o+4<=r&&(i^=BigInt(n.getUint32(o,!0))*k&$,i=V(i,23n)*C+G&$,o+=4);o<r;)i^=BigInt(n.getUint8(o))*j&$,i=V(i,11n)*k&$,o+=1;return i^=i>>33n,i=i*C&$,i^=i>>29n,i=i*G&$,i^=i>>32n,i}const H=new TextEncoder,J=new Uint32Array([1203114875,1150766481,2284105051,2729912477,1884591559,770785867,2667333959,1550580529]);function Q(e,t){const n=function(e,t){return Number((e>>32n)*BigInt(t)>>32n)}(t,e.length>>3)<<3,r=function(e){const t=new Uint32Array(8),n=0|Number(0xffffffffn&e);for(let e=0;e<8;e++)t[e]=1<<(Math.imul(n,J[e])>>>27);return t}(t);for(let t=0;t<8;t++)if(0===(e[n+t]&r[t]))return!1;return!0}function W(e){const t=b(e),n=t.field_1;if(\"number\"!=typeof n||n<=0||n%32!=0)return;if(!t.field_2?.field_1)return;if(!t.field_3?.field_1)return;if(!t.field_4?.field_1)return;const{view:r,offset:i}=e;if(i+n>r.byteLength)throw new Error(`parquet bloom filter truncated: need ${n} bytes, have ${r.byteLength-i}`);const o=new Uint32Array(n>>2);for(let e=0;e<o.length;e++)o[e]=r.getUint32(i+4*e,!0);return e.offset=i+n,{numBytes:n,blocks:o}}function K(e,t){if(null==e)return;const{type:n,converted_type:r,logical_type:i}=t;if(\"BOOLEAN\"===n){if(\"boolean\"!=typeof e)return;return X(new Uint8Array([e?1:0]))}if(\"FLOAT\"===n){if(\"number\"!=typeof e)return;const t=new ArrayBuffer(4);return new DataView(t).setFloat32(0,e,!0),X(new Uint8Array(t))}if(\"DOUBLE\"===n){if(\"number\"!=typeof e)return;const t=new ArrayBuffer(8);return new DataView(t).setFloat64(0,e,!0),X(new Uint8Array(t))}if(\"INT32\"===n){if(\"DATE\"===r||\"DECIMAL\"===r||\"TIME_MILLIS\"===r)return;if(\"DATE\"===i?.type||\"TIME\"===i?.type||\"DECIMAL\"===i?.type)return;if(\"number\"!=typeof e||!Number.isInteger(e))return;const t=new ArrayBuffer(4);return new DataView(t).setInt32(0,0|e,!0),X(new Uint8Array(t))}if(\"INT64\"===n){if(\"TIMESTAMP_MILLIS\"===r||\"TIMESTAMP_MICROS\"===r)return;if(\"TIME_MICROS\"===r||\"DECIMAL\"===r)return;if(\"TIMESTAMP\"===i?.type||\"TIME\"===i?.type||\"DECIMAL\"===i?.type)return;let t;if(\"bigint\"==typeof e)t=e;else{if(\"number\"!=typeof e||!Number.isSafeInteger(e))return;t=BigInt(e)}const n=new ArrayBuffer(8);return new DataView(n).setBigUint64(0,BigInt.asUintN(64,t),!0),X(new Uint8Array(n))}if(\"BYTE_ARRAY\"===n){if(\"JSON\"===r||\"BSON\"===r||\"DECIMAL\"===r)return;if(\"JSON\"===i?.type||\"BSON\"===i?.type||\"VARIANT\"===i?.type)return;if(\"GEOMETRY\"===i?.type||\"GEOGRAPHY\"===i?.type)return;return\"string\"==typeof e?X(H.encode(e)):e instanceof Uint8Array?X(e):void 0}if(\"FIXED_LEN_BYTE_ARRAY\"===n){if(\"DECIMAL\"===r||\"INTERVAL\"===r)return;if(\"DECIMAL\"===i?.type||\"UUID\"===i?.type||\"FLOAT16\"===i?.type)return;if(\"GEOMETRY\"===i?.type||\"GEOGRAPHY\"===i?.type)return;return e instanceof Uint8Array?X(e):void 0}}function ee(e){const t=new Set;return te(e,t),t}function te(e,t){if(e)if(\"$and\"in e&&Array.isArray(e.$and))for(const n of e.$and)te(n,t);else if(\"$or\"in e&&Array.isArray(e.$or))for(const n of e.$or)te(n,t);else if(!(\"$nor\"in e))for(const[n,r]of Object.entries(e))n.startsWith(\"$\")||(\"object\"!=typeof r||null===r||Array.isArray(r)||\"$eq\"in r||\"$in\"in r)&&t.add(n)}function ne(e){if(void 0===e)return null;if(\"bigint\"==typeof e)return Number(e);if(Object.is(e,-0))return 0;if(Array.isArray(e))return e.map(ne);if(e instanceof Uint8Array)return Array.from(e);if(e instanceof Date)return e.toISOString();if(e instanceof Object){const t={};for(const n of Object.keys(e))void 0!==e[n]&&(t[n]=ne(e[n]));return t}return e}function re(e,t){for(let n=0;n<t.length;n+=1e4)e.push(...t.slice(n,n+1e4))}function ie(e,t,n=!0){if(n?e===t:e==t)return!0;if(!e||!t||\"object\"!=typeof e||\"object\"!=typeof t)return!1;if(e instanceof Uint8Array&&t instanceof Uint8Array){if(e.length!==t.length)return!1;for(let n=0;n<e.length;n++)if(e[n]!==t[n])return!1;return!0}if(Array.isArray(e)&&Array.isArray(t)){if(e.length!==t.length)return!1;for(let r=0;r<e.length;r++)if(!ie(e[r],t[r],n))return!1;return!0}const r=Object.keys(e);if(r.length!==Object.keys(t).length)return!1;for(const i of r)if(!ie(e[i],t[i],n))return!1;return!0}function oe(e){if(!e)return[];if(1===e.length)return e[0];const t=[];for(const n of e)re(t,n);return t}function fe(e){if(!e)return[];const t=[];return\"$and\"in e&&Array.isArray(e.$and)?t.push(...e.$and.flatMap(fe)):\"$or\"in e&&Array.isArray(e.$or)?t.push(...e.$or.flatMap(fe)):\"$nor\"in e&&Array.isArray(e.$nor)?t.push(...e.$nor.flatMap(fe)):t.push(...Object.keys(e).map(e=>e.split(\".\")[0])),[...new Set(t)]}function ae(e,t,n=!0){return\"$and\"in t&&Array.isArray(t.$and)?t.$and.every(t=>ae(e,t,n)):\"$or\"in t&&Array.isArray(t.$or)?t.$or.some(t=>ae(e,t,n)):\"$nor\"in t&&Array.isArray(t.$nor)?!t.$nor.some(t=>ae(e,t,n)):Object.entries(t).every(([t,r])=>{const i=function(e,t){let n=e;for(const e of t.split(\".\"))n=n?.[e];return n}(e,t);return\"object\"!=typeof r||null===r||Array.isArray(r)?ie(i,r,n):Object.entries(r||{}).every(([e,r])=>\"$gt\"===e?i>r:\"$gte\"===e?i>=r:\"$lt\"===e?i<r:\"$lte\"===e?i<=r:\"$eq\"===e?ie(i,r,n):\"$ne\"===e?!ie(i,r,n):\"$in\"===e?Array.isArray(r)&&r.includes(i):\"$nin\"===e?Array.isArray(r)&&!r.includes(i):\"$not\"!==e||!ae({[t]:i},{[t]:r},n))})}function se({rowGroup:e,physicalColumns:t,filter:n,strict:r=!0,bloomFilters:i,schemaElements:o}){if(!n)return!1;if(\"$and\"in n&&Array.isArray(n.$and))return n.$and.some(n=>se({rowGroup:e,physicalColumns:t,filter:n,strict:r,bloomFilters:i,schemaElements:o}));if(\"$or\"in n&&Array.isArray(n.$or))return n.$or.every(n=>se({rowGroup:e,physicalColumns:t,filter:n,strict:r,bloomFilters:i,schemaElements:o}));if(\"$nor\"in n&&Array.isArray(n.$nor))return!1;for(const[f,a]of Object.entries(n)){const n=t.indexOf(f);if(-1===n)continue;const s=e.columns[n].meta_data?.statistics,{min:l,max:u,min_value:c,max_value:d}=s||{},p=void 0!==c?c:l,_=void 0!==d?d:u,y=void 0!==p&&void 0!==_,h=i?.[f],m=o?.[f];for(const[e,t]of Object.entries(a||{})){if(y){if(\"$gt\"===e&&_<=t)return!0;if(\"$gte\"===e&&_<t)return!0;if(\"$lt\"===e&&p>=t)return!0;if(\"$lte\"===e&&p>t)return!0;if(\"$eq\"===e&&(t<p||t>_))return!0;if(\"$ne\"===e&&ie(p,_,r)&&ie(p,t,r))return!0;if(\"$in\"===e&&Array.isArray(t)&&t.every(e=>e<p||e>_))return!0;if(\"$nin\"===e&&Array.isArray(t)&&ie(p,_,r)&&t.includes(p))return!0}if(h&&m){if(\"$eq\"===e){const e=K(t,m);if(void 0!==e&&!Q(h.blocks,e))return!0}if(\"$in\"===e&&Array.isArray(t)&&t.length>0){let e=!0;for(const n of t){const t=K(n,m);if(void 0===t||Q(h.blocks,t)){e=!1;break}}if(e)return!0}}}}return!1}const le=new TextDecoder,ue=new WeakMap;function ce(e,t=p){if(Array.isArray(e))return e.map(e=>ce(e,t));if(\"object\"!=typeof e)return e;if(\"metadata\"in e){const n=function(e){let t=ue.get(e.buffer);t||(t=new Map,ue.set(e.buffer,t));const n=`${e.byteOffset}:${e.byteLength}`,r=t.get(n);if(r)return r;const i=pe(e),o=i.view.getUint8(i.offset++),f=15&o;if(1!==f)throw new Error(`parquet unsupported variant metadata version: ${f}`);const a=1==(o>>4&1),s=1+(o>>6&3),l=_e(i,s),u=new Array(l+1);for(let e=0;e<u.length;e++)u[e]=_e(i,s);const c=i.offset,d=new Array(l);for(let t=0;t<l;t++){const n=u[t],r=u[t+1],i=new Uint8Array(e.buffer,e.byteOffset+c+n,r-n);d[t]=le.decode(i)}const p={dictionary:d,sorted:a};return t.set(n,p),p}(e.metadata),r=e.typed_value&&de(e.typed_value,n,t),i=e.value&&ye(pe(e.value),n,t);return r&&i?{...i,...r}:r??i}return e}function de(e,t,n){if(e instanceof Date)return e;if(e&&\"object\"==typeof e&&!Array.isArray(e)&&!(e instanceof Uint8Array)){if(\"typed_value\"in e&&null!==e.typed_value&&void 0!==e.typed_value)return de(e.typed_value,t,n);if(\"value\"in e&&e.value instanceof Uint8Array)return ye(pe(e.value),t,n);if(\"typed_value\"in e||\"value\"in e)return null;const r={};for(const[i,o]of Object.entries(e))t.dictionary.includes(i)&&(r[i]=de(o,t,n));return r}return e instanceof Uint8Array?ye(pe(e),t,n):Array.isArray(e)?e.map(e=>de(e,t,n)):e}function pe(e){return{view:new DataView(e.buffer,e.byteOffset,e.byteLength),offset:0}}function _e(e,t){let n=0;for(let r=0;r<t;r++)n|=e.view.getUint8(e.offset+r)<<8*r;return e.offset+=t,n}function ye(e,t,n){const r=e.view.getUint8(e.offset++),i=3&r,o=r>>2;if(0===i)return function(e,t,n){switch(t){case 0:return null;case 1:return!0;case 2:return!1;case 3:{const t=e.view.getInt8(e.offset);return e.offset+=1,t}case 4:{const t=e.view.getInt16(e.offset,!0);return e.offset+=2,t}case 5:{const t=e.view.getInt32(e.offset,!0);return e.offset+=4,t}case 6:{const t=e.view.getBigInt64(e.offset,!0);return e.offset+=8,t}case 7:{const t=e.view.getFloat64(e.offset,!0);return e.offset+=8,t}case 8:return he(e,4);case 9:return he(e,8);case 10:return he(e,16);case 11:{const t=e.view.getInt32(e.offset,!0);return e.offset+=4,n.dateFromDays(t)}case 12:case 13:{const t=e.view.getBigInt64(e.offset,!0);return e.offset+=8,n.timestampFromMicroseconds(t)}case 14:{const t=e.view.getFloat32(e.offset,!0);return e.offset+=4,t}case 15:return me(e);case 16:{const t=me(e);return le.decode(t)}case 17:{const t=e.view.getBigInt64(e.offset,!0);return e.offset+=8,t}case 18:case 19:{const t=e.view.getBigInt64(e.offset,!0);return e.offset+=8,n.timestampFromNanoseconds(t)}case 20:{const t=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,16);e.offset+=16;const n=Array.from(t,e=>e.toString(16).padStart(2,\"0\")).join(\"\");return`${n.slice(0,8)}-${n.slice(8,12)}-${n.slice(12,16)}-${n.slice(16,20)}-${n.slice(20)}`}default:throw new Error(`parquet unsupported variant primitive type: ${t}`)}}(e,o,n);if(2===i)return function(e,t,n,r){const i=1+(3&t),o=1+(t>>2&3),f=t>>4&1?_e(e,4):e.view.getUint8(e.offset++),a=new Array(f);for(let t=0;t<f;t++)a[t]=_e(e,o);const s=new Array(f+1);for(let t=0;t<s.length;t++)s[t]=_e(e,i);const l={};for(let t=0;t<f;t++){const i=n.dictionary[a[t]],o={view:e.view,offset:e.offset+s[t]};l[i]=ye(o,n,r)}return e.offset+=s[s.length-1],l}(e,o,t,n);if(3===i)return function(e,t,n,r){const i=(3&t)+1,o=_e(e,t>>2&1?4:1),f=new Array(o+1);for(let t=0;t<f.length;t++)f[t]=_e(e,i);const a=e.offset,s=new Array(o);for(let t=0;t<o;t++){const i={view:e.view,offset:a+f[t]};s[t]=ye(i,n,r)}return e.offset=a+f[f.length-1],s}(e,o,t,n);const f=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,o);return e.offset+=o,le.decode(f)}function he(e,t){const n=e.view.getUint8(e.offset);let r;if(e.offset+=1,4===t)r=BigInt(e.view.getInt32(e.offset,!0)),e.offset+=4;else if(8===t)r=e.view.getBigInt64(e.offset,!0),e.offset+=8;else{const t=e.view.getBigUint64(e.offset,!0);r=e.view.getBigInt64(e.offset+8,!0)<<64n|t,e.offset+=16}return Number(r)*10**-n}function me(e){const t=e.view.getUint32(e.offset,!0);e.offset+=4;const n=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=t,n}function ge(e,t,n,r,i){const o=v(i);if(!t?.length&&!n.length){if(!o||!r.length)return r;t=new Array(r.length).fill(o)}const f=t?.length||n.length,a=i.map(({element:e})=>e.repetition_type);let s=0;const l=[e];let u=e,c=0,d=0,p=0;if(n[0])for(;c<a.length-2&&p<n[0];)c++,\"REQUIRED\"!==a[c]&&(u=u.at(-1),l.push(u),d++),\"REPEATED\"===a[c]&&p++;for(let e=0;e<f;e++){const i=t?.length?t[e]:o,f=n[e];for(;c&&(f<p||\"REPEATED\"!==a[c]);)\"REQUIRED\"!==a[c]&&(l.pop(),d--),\"REPEATED\"===a[c]&&p--,c--;for(u=l.at(-1);(c<a.length-2||\"REPEATED\"===a[c+1])&&(d<i||\"REQUIRED\"===a[c+1]);){if(c++,\"REQUIRED\"!==a[c]){const e=[];u.push(e),u=e,l.push(e),d++}\"REPEATED\"===a[c]&&p++}i===o?u.push(r[s++]):c===a.length-2?u.push(null):u.push([])}if(!e.length)for(let e=0;e<o;e++){const e=[];u.push(e),u=e}return e}function we(e,t,n,r=0){const i=t.path.join(\".\"),o=\"OPTIONAL\"===t.element.repetition_type,f=o?r+1:r;if(function(e){if(!e)return!1;if(\"LIST\"!==e.element.converted_type)return!1;if(e.children.length>1)return!1;const t=e.children[0];return!(t.children.length>1)&&\"REPEATED\"===t.element.repetition_type}(t)){let a=t.children[0],s=f;1===a.children.length&&(a=a.children[0],s++),we(e,a,n,s);const l=a.path.join(\".\"),u=e.get(l);if(!u)throw new Error(\"parquet list column missing values\");return o&&Ae(u,r),e.set(i,u),void e.delete(l)}if(function(e){if(!e)return!1;if(\"MAP\"!==e.element.converted_type)return!1;if(e.children.length>1)return!1;const t=e.children[0];if(2!==t.children.length)return!1;if(\"REPEATED\"!==t.element.repetition_type)return!1;const n=t.children.find(e=>\"key\"===e.element.name);if(\"REPEATED\"===n?.element.repetition_type)return!1;const r=t.children.find(e=>\"value\"===e.element.name);return\"REPEATED\"!==r?.element.repetition_type}(t)){const a=t.children[0].element.name;we(e,t.children[0].children[0],n,f+1),we(e,t.children[0].children[1],n,f+1);const s=e.get(`${i}.${a}.key`),l=e.get(`${i}.${a}.value`);if(!s)throw new Error(\"parquet map column missing keys\");if(!l)throw new Error(\"parquet map column missing values\");if(s.length!==l.length)throw new Error(\"parquet map column key/value length mismatch\");const u=Ee(s,l,f);return o&&Ae(u,r),e.delete(`${i}.${a}.key`),e.delete(`${i}.${a}.value`),void e.set(i,u)}if(t.children.length){const f=\"REQUIRED\"===t.element.repetition_type?r:r+1,a={};for(const r of t.children){we(e,r,n,f);const t=e.get(r.path.join(\".\"));if(!t)throw new Error(\"parquet struct missing child data\");a[r.element.name]=t}for(const n of t.children)e.delete(n.path.join(\".\"));let s=ve(a,f);\"VARIANT\"===t.element.logical_type?.type&&(s=ce(s,n)),o&&Ae(s,r),e.set(i,s)}}function Ae(e,t){for(let n=0;n<e.length;n++)t?Ae(e[n],t-1):e[n]=e[n][0]}function Ee(e,t,n){const r=[];for(let i=0;i<e.length;i++)if(n)r.push(Ee(e[i],t[i],n-1));else if(e[i]){const n={};for(let r=0;r<e[i].length;r++){const o=t[i][r];n[e[i][r]]=void 0===o?null:o}r.push(n)}else r.push(void 0);return r}function ve(e,t){const n=Object.keys(e),r=e[n[0]]?.length,i=[];for(let o=0;o<r;o++){const f={};for(const t of n){if(e[t].length!==r)throw new Error(\"parquet struct parsing error\");f[t]=e[t][o]}t?i.push(ve(f,t-1)):i.push(f)}return i}function Ie(e,t,n){const r=n instanceof Int32Array,i=N(e),o=N(e);N(e);let f=L(e),a=0;n[a++]=r?Number(f):f;const s=i/o;for(;a<t;){const i=L(e),l=new Uint8Array(o);for(let t=0;t<o;t++)l[t]=e.view.getUint8(e.offset++);for(let u=0;u<o&&a<t;u++){const o=BigInt(l[u]);if(o){let l=0n,u=s;const c=(1n<<o)-1n;for(;u&&a<t;){let t=BigInt(e.view.getUint8(e.offset))>>l&c;for(l+=o;l>=8;)l-=8n,e.offset++,l&&(t|=BigInt(e.view.getUint8(e.offset))<<o-l&c);f+=i+t,n[a++]=r?Number(f):f,u--}u&&(e.offset+=Math.ceil((u*Number(o)+Number(l))/8))}else for(let e=0;e<s&&a<t;e++)f+=i,n[a++]=r?Number(f):f}}}function be(e,t,n){const r=new Int32Array(t);Ie(e,t,r);for(let i=0;i<t;i++)n[i]=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,r[i]),e.offset+=r[i]}function Te(e,t,n,r){void 0===r&&(r=e.view.getUint32(e.offset,!0),e.offset+=4);const i=e.offset;let o=0;for(;o<n.length;){const r=N(e);if(1&r)o=Ue(e,r,t,n,o);else{const i=r>>>1;Ne(e,i,t,n,o),o+=i}}e.offset=i+r}function Ne(e,t,n,r,i){const o=n+7>>3;let f=0;for(let t=0;t<o;t++)f|=e.view.getUint8(e.offset++)<<(t<<3);for(let e=0;e<t;e++)r[i+e]=f}function Ue(e,t,n,r,i){let o=t>>1<<3;const f=(1<<n)-1;let a=0;if(e.offset<e.view.byteLength)a=e.view.getUint8(e.offset++);else if(f)throw new Error(`parquet bitpack offset ${e.offset} out of range`);let s=8,l=0;for(;o;)l>8?(l-=8,s-=8,a>>>=8):s-l<n?(a|=e.view.getUint8(e.offset)<<s,e.offset++,s+=8):(i<r.length&&(r[i++]=a>>l&f),o--,l+=n);return i}function Le(e,t,n,r){const i=function(e,t){switch(e){case\"INT32\":case\"FLOAT\":return 4;case\"INT64\":case\"DOUBLE\":return 8;case\"FIXED_LEN_BYTE_ARRAY\":if(!t)throw new Error(\"parquet byteWidth missing type_length\");return t;default:throw new Error(`parquet unsupported type: ${e}`)}}(n,r),o=new Uint8Array(t*i);for(let n=0;n<i;n++)for(let r=0;r<t;r++)o[r*i+n]=e.view.getUint8(e.offset++);if(\"FLOAT\"===n)return new Float32Array(o.buffer);if(\"DOUBLE\"===n)return new Float64Array(o.buffer);if(\"INT32\"===n)return new Int32Array(o.buffer);if(\"INT64\"===n)return new BigInt64Array(o.buffer);if(\"FIXED_LEN_BYTE_ARRAY\"===n){const e=new Array(t);for(let n=0;n<t;n++)e[n]=o.subarray(n*i,(n+1)*i);return e}throw new Error(`parquet byte_stream_split unsupported type: ${n}`)}function Oe(e,t,n,r){if(0===n)return[];if(\"BOOLEAN\"===t)return function(e,t){const n=new Array(t);for(let r=0;r<t;r++){const t=e.offset+(r/8|0),i=r%8,o=e.view.getUint8(t);n[r]=!!(o&1<<i)}return e.offset+=Math.ceil(t/8),n}(e,n);if(\"INT32\"===t)return function(e,t){const n=(e.view.byteOffset+e.offset)%4?new Int32Array(Be(e.view.buffer,e.view.byteOffset+e.offset,4*t)):new Int32Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=4*t,n}(e,n);if(\"INT64\"===t)return function(e,t){const n=(e.view.byteOffset+e.offset)%8?new BigInt64Array(Be(e.view.buffer,e.view.byteOffset+e.offset,8*t)):new BigInt64Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=8*t,n}(e,n);if(\"INT96\"===t)return function(e,t){const n=new Array(t);for(let r=0;r<t;r++){const t=e.view.getBigInt64(e.offset+12*r,!0),i=e.view.getInt32(e.offset+12*r+8,!0);n[r]=BigInt(i)<<64n|t}return e.offset+=12*t,n}(e,n);if(\"FLOAT\"===t)return function(e,t){const n=(e.view.byteOffset+e.offset)%4?new Float32Array(Be(e.view.buffer,e.view.byteOffset+e.offset,4*t)):new Float32Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=4*t,n}(e,n);if(\"DOUBLE\"===t)return function(e,t){const n=(e.view.byteOffset+e.offset)%8?new Float64Array(Be(e.view.buffer,e.view.byteOffset+e.offset,8*t)):new Float64Array(e.view.buffer,e.view.byteOffset+e.offset,t);return e.offset+=8*t,n}(e,n);if(\"BYTE_ARRAY\"===t)return function(e,t){const n=new Array(t);for(let r=0;r<t;r++){const t=e.view.getUint32(e.offset,!0);e.offset+=4,n[r]=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,t),e.offset+=t}return n}(e,n);if(\"FIXED_LEN_BYTE_ARRAY\"===t){if(!r)throw new Error(\"parquet missing fixed length\");return function(e,t,n){const r=new Array(t);for(let i=0;i<t;i++)r[i]=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,n),e.offset+=n;return r}(e,n,r)}throw new Error(`parquet unhandled type: ${t}`)}function Be(e,t,n){const r=new ArrayBuffer(n);return new Uint8Array(r).set(new Uint8Array(e,t,n)),r}const Re=[0,255,65535,16777215,4294967295];function De(e,t,n,r,i){for(let o=0;o<i;o++)n[r+o]=e[t+o]}function Me(e,t){const n=e.byteLength,r=t.byteLength;let i=0,o=0;for(;i<n;){const t=e[i];if(i++,t<128)break}if(r&&i>=n)throw new Error(\"invalid snappy length header\");for(;i<n;){const r=e[i];let f=0;if(i++,i>=n)throw new Error(\"missing eof marker\");if(3&r){let a=0;switch(3&r){case 1:f=4+(r>>>2&7),a=e[i]+(r>>>5<<8),i++;break;case 2:if(n<=i+1)throw new Error(\"snappy error end of input\");f=(r>>>2)+1,a=e[i]+(e[i+1]<<8),i+=2;break;case 3:if(n<=i+3)throw new Error(\"snappy error end of input\");f=(r>>>2)+1,a=e[i]+(e[i+1]<<8)+(e[i+2]<<16)+(e[i+3]<<24),i+=4}if(0===a||isNaN(a))throw new Error(`invalid offset ${a} pos ${i} inputLength ${n}`);if(a>o)throw new Error(\"cannot copy from before start of buffer\");De(t,o-a,t,o,f),o+=f}else{let f=(r>>>2)+1;if(f>60){if(i+3>=n)throw new Error(\"snappy error literal pos + 3 >= inputLength\");const t=f-60;f=e[i]+(e[i+1]<<8)+(e[i+2]<<16)+(e[i+3]<<24),f=1+(f&Re[t]),i+=t}if(i+f>n)throw new Error(\"snappy error literal exceeds input length\");De(e,i,t,o,f),i+=f,o+=f}}if(o!==r)throw new Error(\"premature end of input\")}function Se(e,t,n,r){let i;const o=r?.[n];if(\"UNCOMPRESSED\"===n)i=e;else if(o)i=o(e,t);else{if(\"SNAPPY\"!==n)throw new Error(`parquet unsupported compression codec: ${n}`);i=new Uint8Array(t),Me(e,i)}if(i?.length!==t)throw new Error(`parquet decompressed page length ${i?.length} does not match header ${t}`);return i}function xe(e){return 32-Math.clz32(e)}function Pe(e,{groupStart:t,selectStart:n,selectEnd:r},i,o){const{pathInSchema:f,schemaPath:a}=i,s=I(a),l=[];let u,c,d=0,p=0;const _=o&&(()=>{c&&o({pathInSchema:f,columnData:c,rowStart:t+d-c.length,rowEnd:t+d})});for(;(s?d<r:e.offset<e.view.byteLength-1)&&!(e.offset>=e.view.byteLength-1);){const t=Fe(e);if(\"DICTIONARY_PAGE\"===t.type){const{data:n}=Ye(e,t,i,u,void 0,0);n&&(u=y(n,i))}else{const r=c?.length||0,o=Ye(e,t,i,u,c,n-d);o.skipped?(l.length||(p+=o.skipped),d+=o.skipped):o.data&&c===o.data?d+=o.data.length-r:o.data&&o.data.length&&(_?.(),l.push(o.data),d+=o.data.length,c=o.data)}}return _?.(),{data:l,skipped:p}}function Ye(e,t,n,r,i,o){const{type:f,element:a,schemaPath:s,codec:l,compressors:u}=n,c=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,t.compressed_page_size);if(e.offset+=t.compressed_page_size,\"DATA_PAGE\"===t.type){const e=t.data_page_header;if(!e)throw new Error(\"parquet data page header is undefined\");if(o>e.num_values&&I(s))return{skipped:e.num_values};const f=Se(c,Number(t.uncompressed_page_size),l,u),{definitionLevels:a,repetitionLevels:d,dataPage:p}=function(e,t,{type:n,element:r,schemaPath:i}){const o=new DataView(e.buffer,e.byteOffset,e.byteLength),f={view:o,offset:0};let a;const s=function(e,t,n){if(n.length>1){const r=E(n);if(r){const n=new Array(t.num_values);return Te(e,xe(r),n),n}}return[]}(f,t,i),{definitionLevels:l,numNulls:u}=function(e,t,n){const r=v(n);if(!r)return{definitionLevels:[],numNulls:0};const i=new Array(t.num_values);Te(e,xe(r),i);let o=t.num_values;for(const e of i)e===r&&o--;return 0===o&&(i.length=0),{definitionLevels:i,numNulls:o}}(f,t,i),c=t.num_values-u;if(\"PLAIN\"===t.encoding)a=Oe(f,n,c,r.type_length);else if(\"PLAIN_DICTIONARY\"===t.encoding||\"RLE_DICTIONARY\"===t.encoding||\"RLE\"===t.encoding){const e=\"BOOLEAN\"===n?1:o.getUint8(f.offset++);e?(a=new Array(c),\"BOOLEAN\"===n?(Te(f,e,a),a=a.map(e=>!!e)):Te(f,e,a,o.byteLength-f.offset)):a=new Uint8Array(c)}else if(\"BYTE_STREAM_SPLIT\"===t.encoding)a=Le(f,c,n,r.type_length);else if(\"DELTA_BINARY_PACKED\"===t.encoding)a=\"INT32\"===n?new Int32Array(c):new BigInt64Array(c),Ie(f,c,a);else{if(\"DELTA_LENGTH_BYTE_ARRAY\"!==t.encoding)throw new Error(`parquet unsupported encoding: ${t.encoding}`);a=new Array(c),be(f,c,a)}return{definitionLevels:l,repetitionLevels:s,dataPage:a}}(f,e,n),y=_(p,r,e.encoding,n);return{skipped:0,data:ge(Array.isArray(i)?i:[],a,d,y,s)}}if(\"DATA_PAGE_V2\"===t.type){const e=t.data_page_header_v2;if(!e)throw new Error(\"parquet data page header v2 is undefined\");if(o>e.num_rows)return{skipped:e.num_values};const{definitionLevels:f,repetitionLevels:a,dataPage:l}=function(e,t,n){const r={view:new DataView(e.buffer,e.byteOffset,e.byteLength),offset:0},{type:i,element:o,schemaPath:f,codec:a,compressors:s}=n,l=t.data_page_header_v2;if(!l)throw new Error(\"parquet data page header v2 is undefined\");const u=function(e,t,n){const r=E(n);if(!r)return[];const i=new Array(t.num_values);return Te(e,xe(r),i,t.repetition_levels_byte_length),i}(r,l,f);r.offset=l.repetition_levels_byte_length;const c=function(e,t,n){const r=v(n);if(r){const n=new Array(t.num_values);return Te(e,xe(r),n,t.definition_levels_byte_length),n}}(r,l,f),d=t.uncompressed_page_size-l.definition_levels_byte_length-l.repetition_levels_byte_length;let p=e.subarray(r.offset);!1!==l.is_compressed&&(p=Se(p,d,a,s));const _=new DataView(p.buffer,p.byteOffset,p.byteLength),y={view:_,offset:0};let h;const m=l.num_values-l.num_nulls;if(\"PLAIN\"===l.encoding)h=Oe(y,i,m,o.type_length);else if(\"RLE\"===l.encoding)h=new Array(m),Te(y,1,h),h=h.map(e=>!!e);else if(\"PLAIN_DICTIONARY\"===l.encoding||\"RLE_DICTIONARY\"===l.encoding){const e=_.getUint8(y.offset++);h=new Array(m),Te(y,e,h,d-1)}else if(\"DELTA_BINARY_PACKED\"===l.encoding)h=\"INT32\"===i?new Int32Array(m):new BigInt64Array(m),Ie(y,m,h);else if(\"DELTA_LENGTH_BYTE_ARRAY\"===l.encoding)h=new Array(m),be(y,m,h);else if(\"DELTA_BYTE_ARRAY\"===l.encoding)h=new Array(m),function(e,t,n){const r=new Int32Array(t);Ie(e,t,r);const i=new Int32Array(t);Ie(e,t,i);for(let o=0;o<t;o++){const t=new Uint8Array(e.view.buffer,e.view.byteOffset+e.offset,i[o]);r[o]?(n[o]=new Uint8Array(r[o]+i[o]),n[o].set(n[o-1].subarray(0,r[o])),n[o].set(t,r[o])):n[o]=t,e.offset+=i[o]}}(y,m,h);else{if(\"BYTE_STREAM_SPLIT\"!==l.encoding)throw new Error(`parquet unsupported encoding: ${l.encoding}`);h=Le(y,m,i,o.type_length)}return{definitionLevels:c,repetitionLevels:u,dataPage:h}}(c,t,n),u=_(l,r,e.encoding,n);return{skipped:0,data:ge(Array.isArray(i)?i:[],f,a,u,s)}}if(\"DICTIONARY_PAGE\"===t.type){const e=t.dictionary_page_header;if(!e)throw new Error(\"parquet dictionary page header is undefined\");const n=Se(c,Number(t.uncompressed_page_size),l,u);return{skipped:0,data:Oe({view:new DataView(n.buffer,n.byteOffset,n.byteLength),offset:0},f,e.num_values,a.type_length)}}throw new Error(`parquet unsupported page type: ${t.type}`)}function Fe(e){const n=b(e);return{type:o[n.field_1],uncompressed_page_size:n.field_2,compressed_page_size:n.field_3,crc:n.field_4,data_page_header:n.field_5&&{num_values:n.field_5.field_1,encoding:t[n.field_5.field_2],definition_level_encoding:t[n.field_5.field_3],repetition_level_encoding:t[n.field_5.field_4],statistics:n.field_5.field_5&&{max:n.field_5.field_5.field_1,min:n.field_5.field_5.field_2,null_count:n.field_5.field_5.field_3,distinct_count:n.field_5.field_5.field_4,max_value:n.field_5.field_5.field_5,min_value:n.field_5.field_5.field_6}},index_page_header:n.field_6,dictionary_page_header:n.field_7&&{num_values:n.field_7.field_1,encoding:t[n.field_7.field_2],is_sorted:n.field_7.field_3},data_page_header_v2:n.field_8&&{num_values:n.field_8.field_1,num_nulls:n.field_8.field_2,num_rows:n.field_8.field_3,encoding:t[n.field_8.field_4],definition_levels_byte_length:n.field_8.field_5,repetition_levels_byte_length:n.field_8.field_6,is_compressed:void 0===n.field_8.field_7||n.field_8.field_7,statistics:n.field_8.field_8}}}async function $e({asyncColumns:e},t,n,r,i){const o=await Promise.all(e.map(e=>e.data.then(({skipped:e,data:t})=>({skipped:e,data:oe(t)})))),f=n-t;if(\"object\"===i){const n=Array(f);for(let r=0;r<f;r++){const i={};for(let n=0;n<e.length;n++){const{data:f,skipped:a}=o[n];i[e[n].pathInSchema[0]]=f[t+r-a]}n[r]=i}return n}const a=e.map(e=>e.pathInSchema[0]).filter(e=>!r||r.includes(e)),s=r??a,l=s.map(t=>e.findIndex(e=>e.pathInSchema[0]===t)),u=Array(f);for(let n=0;n<f;n++){const r=Array(e.length);for(let e=0;e<s.length;e++){const i=l[e];if(i<0)throw new Error(`parquet column not found: ${s[e]}`);const{data:f,skipped:a}=o[i];r[e]=f[t+n-a]}u[n]=r}return u}async function ke(e){e.metadata??=await R(e.file,e);const{rowStart:t=0,rowEnd:n,columns:r,onChunk:i,onComplete:o,rowFormat:f,filter:a,filterStrict:s=!0}=e;if(a&&\"object\"!==f)throw new Error('parquet filter requires rowFormat: \"object\"');const l=fe(a);if(l.length){const t=M(e.metadata).children.map(e=>e.element.name),n=l.filter(e=>!t.includes(e));if(n.length)throw new Error(`parquet filter columns not found: ${n.join(\", \")}`)}let u=r,c=!1;if(r&&a){const e=l.filter(e=>!r.includes(e));e.length&&(u=[...r,...e],c=!0)}let d=u!==r?{...e,columns:u}:e;d=await async function(e){if(!e.useBloomFilters)return e;if(!e.filter||!e.metadata)return e;const t=M(e.metadata),n={};for(const e of t.children)n[e.element.name]=e.element;const r=await async function({file:e,metadata:t,filter:n,filterStrict:r=!0}){const i=t.row_groups.map(()=>({})),o=ee(n);if(0===o.size)return i;const f=A(M(t)),a=[];return t.row_groups.forEach((t,s)=>{if(!se({rowGroup:t,physicalColumns:f,filter:n,strict:r}))for(const n of o){const r=f.indexOf(n);if(-1===r)continue;const o=t.columns[r]?.meta_data;if(!o?.bloom_filter_offset||!o.bloom_filter_length)continue;const l=Number(o.bloom_filter_offset),u=l+o.bloom_filter_length;a.push((async()=>{const t=await e.slice(l,u),r=W({view:new DataView(t),offset:0});r&&(i[s][n]=r)})())}}),a.length&&await Promise.all(a),i}({file:e.file,metadata:e.metadata,filter:e.filter,filterStrict:e.filterStrict});return{...e,bloomFiltersByGroup:r,schemaElements:n}}(d);const _=function(e){if(!e.metadata)throw new Error(\"parquet requires metadata\");const t=function({metadata:e,rowStart:t=0,rowEnd:n=1/0,columns:r,filter:i,filterStrict:o=!0,useOffsetIndex:f=!1,bloomFiltersByGroup:a,schemaElements:s}){if(!e)throw new Error(\"parquetPlan requires metadata\");const l=[],u=[],c=[],d=A(M(e));let p=0,_=0;for(const y of e.row_groups){const e=Number(y.num_rows),h=p+e,m=a?.[_];if(e>0&&h>t&&p<n&&!se({rowGroup:y,physicalColumns:d,filter:i,strict:o,bloomFilters:m,schemaElements:s})){const i=[];for(const e of y.columns){const o=e.meta_data;if(e.file_path)throw new Error(\"parquet file_path not supported\");if(!o)throw new Error(\"parquet column metadata is undefined\");if(!r||r.includes(o.path_in_schema[0])){const r=o.dictionary_page_offset||o.data_page_offset,a=Number(r),s=Number(r+o.total_compressed_size);if(f&&e.offset_index_offset&&e.offset_index_length&&(t>p||n<h)){const t=Number(e.offset_index_offset);i.push({columnMetadata:o,offsetIndex:{startByte:t,endByte:t+e.offset_index_length},range:{startByte:a,endByte:s}})}else i.push({columnMetadata:o,range:{startByte:a,endByte:s}})}}const o=Math.max(t-p,0),a=Math.min(n-p,e);let s;l.push({chunks:i,rowGroup:y,groupStart:p,groupRows:e,selectStart:o,selectEnd:a});for(const e of i)if(\"offsetIndex\"in e)c.push(e.offsetIndex);else{const{range:t}=e;r?u.push(t):s&&t.endByte-s.startByte<=2097152?s.endByte=t.endByte:(s&&u.push(s),s={...t})}s&&u.push(s)}p=h,_++}return isFinite(n)||(n=p),u.push(...c),{metadata:e,rowStart:t,rowEnd:n,columns:r,fetches:u,groups:l}}(e);return e.file=function(e,{fetches:t}){const n=t.map(({startByte:t,endByte:n})=>e.slice(t,n));return{byteLength:e.byteLength,slice(r,i=e.byteLength){const o=t.findIndex(({startByte:e,endByte:t})=>e<=r&&i<=t);if(o<0)return e.slice(r,i);if(t[o].startByte!==r||t[o].endByte!==i){const e=r-t[o].startByte,f=i-t[o].startByte;return n[o]instanceof Promise?n[o].then(t=>t.slice(e,f)):n[o].slice(e,f)}return n[o]}}}(e.file,t),t.groups.map(n=>function(e,{metadata:t},n){const r=[];for(const i of n.chunks){const{data_page_offset:o,dictionary_page_offset:f,path_in_schema:a}=i.columnMetadata,s=w(t.schema,a),l={pathInSchema:a,element:s[s.length-1].element,schemaPath:s,parsers:{...p,...e.parsers},...e,...i.columnMetadata};let{startByte:u,endByte:c}=i.range;\"offsetIndex\"in i?r.push({pathInSchema:a,data:Promise.resolve(e.file.slice(i.offsetIndex.startByte,i.offsetIndex.endByte)).then(async t=>{const{selectStart:r,selectEnd:i}=n,a=F({view:new DataView(t),offset:0}).page_locations;let s=-1;const d=f||o<a[0].offset;for(let e=0;e<a.length;e++){const t=a[e],o=Number(t.first_row_index),f=e+1<a.length?Number(a[e+1].first_row_index):n.groupRows;s<0&&!d&&f>r&&(u=Number(t.offset),s=o),o<i&&(c=Number(t.offset)+t.compressed_page_size)}s<0&&(s=0);const p=await e.file.slice(u,c),_={view:new DataView(p),offset:0},y=s?{...n,groupStart:n.groupStart+s,selectStart:n.selectStart-s,selectEnd:n.selectEnd-s}:n,{data:h,skipped:m}=Pe(_,y,l,e.onPage);return{data:h,skipped:s+m}})}):r.push({pathInSchema:a,data:Promise.resolve(e.file.slice(u,c)).then(t=>Pe({view:new DataView(t),offset:0},n,l,e.onPage))})}return{groupStart:n.groupStart,groupRows:n.groupRows,asyncColumns:r}}(e,t,n))}(d);if(!o&&!i)return void await Ce(_);const y=M(e.metadata),h=_.map(t=>function(e,t,n){const{asyncColumns:r}=e;n={...p,...n};const i=[];for(const e of t.children)if(e.children.length){const t=r.filter(t=>t.pathInSchema[0]===e.element.name);if(!t.length)continue;i.push({pathInSchema:e.path,data:(async()=>{const r=await Promise.all(t.map(e=>e.data)),i=new Map;let o=1/0;for(let e=0;e<t.length;e++){const n=oe(r[e].data);i.set(t[e].pathInSchema.join(\".\"),n),o=Math.min(o,n.length)}for(const[e,t]of i)t.length>o&&i.set(e,t.slice(0,o));we(i,e,n);const f=i.get(e.element.name);if(!f)throw new Error(\"parquet column data not assembled\");return{data:[f],skipped:0}})()})}else{const t=r.find(t=>t.pathInSchema[0]===e.element.name);t&&i.push(t)}return{...e,asyncColumns:i}}(t,y,e.parsers));if(i)for(const e of h)for(const t of e.asyncColumns)t.data.then(({data:n,skipped:r})=>{let o=e.groupStart+r;for(const e of n)i({columnName:t.pathInSchema[0],columnData:e,rowStart:o,rowEnd:o+e.length}),o+=e.length},()=>{});if(o){await Ce(h);const e=[];for(const i of h){const o=Math.max(t-i.groupStart,0),d=Math.min((n??1/0)-i.groupStart,i.groupRows),p=\"object\"===f?await $e(i,o,d,u,\"object\"):await $e(i,o,d,r,\"array\");if(a){for(const t of p)if(ae(t,a,s)){if(c&&r)for(const e of l)r.includes(e)||delete t[e];e.push(t)}}else re(e,p)}o(e)}else await Ce(h)}async function Ce(e){const t=e.flatMap(e=>e.asyncColumns.map(e=>e.data)),n=(await Promise.allSettled(t)).find(e=>\"rejected\"===e.status);if(n)throw n.reason}function Ge(e){return new Promise((t,n)=>{ke({...e,rowFormat:\"object\",onComplete:t}).catch(n)})}function qe(e=1024){return this.buffer=new ArrayBuffer(e),this.view=new DataView(this.buffer),this.offset=0,this.index=0,this}function je(e,t,n){const r=e[t],i=[];let o=1;if(r.num_children)for(;i.length<r.num_children;){const r=e[t+o],f=je(e,t+o,[...n,r.name]);o+=f.count,i.push(f)}return{count:o,element:r,children:i,path:n}}function Ve(e,t){let n=je(e,0,[]);const r=[n];for(const e of t){const i=n.children.find(t=>t.element.name===e);if(!i)throw new Error(`parquet schema element not found: ${t}`);r.push(i),n=i}return r}function ze(e){if(!e)return!1;if(\"LIST\"!==e.element.converted_type)return!1;if(e.children.length>1)return!1;const t=e.children[0];return!(t.children.length>1)&&\"REPEATED\"===t.element.repetition_type}function Ze(e){if(!e)return!1;if(\"MAP\"!==e.element.converted_type)return!1;if(e.children.length>1)return!1;const t=e.children[0];if(2!==t.children.length)return!1;if(\"REPEATED\"!==t.element.repetition_type)return!1;const n=t.children.find(e=>\"key\"===e.element.name);if(\"REPEATED\"===n?.element.repetition_type)return!1;const r=t.children.find(e=>\"value\"===e.element.name);return\"REPEATED\"!==r?.element.repetition_type}qe.prototype.ensure=function(e){if(this.index+e>this.buffer.byteLength){const t=Math.max(2*this.buffer.byteLength,this.index+e),n=new ArrayBuffer(t);new Uint8Array(n).set(new Uint8Array(this.buffer)),this.buffer=n,this.view=new DataView(this.buffer)}},qe.prototype.finish=function(){},qe.prototype.getBuffer=function(){return this.buffer.slice(0,this.index)},qe.prototype.getBytes=function(){return new Uint8Array(this.buffer,0,this.index)},qe.prototype.appendUint8=function(e){this.ensure(this.index+1),this.view.setUint8(this.index,e),this.offset++,this.index++},qe.prototype.appendUint32=function(e){this.ensure(this.index+4),this.view.setUint32(this.index,e,!0),this.offset+=4,this.index+=4},qe.prototype.appendInt32=function(e){this.ensure(this.index+4),this.view.setInt32(this.index,e,!0),this.offset+=4,this.index+=4},qe.prototype.appendInt64=function(e){this.ensure(this.index+8),this.view.setBigInt64(this.index,BigInt(e),!0),this.offset+=8,this.index+=8},qe.prototype.appendFloat32=function(e){this.ensure(this.index+8),this.view.setFloat32(this.index,e,!0),this.offset+=4,this.index+=4},qe.prototype.appendFloat64=function(e){this.ensure(this.index+8),this.view.setFloat64(this.index,e,!0),this.offset+=8,this.index+=8},qe.prototype.appendBuffer=function(e){this.appendBytes(new Uint8Array(e))},qe.prototype.appendBytes=function(e){this.ensure(this.index+e.length),new Uint8Array(this.buffer,this.index,e.length).set(e),this.offset+=e.length,this.index+=e.length},qe.prototype.appendVarInt=function(e){for(;;){if(!(-128&e))return void this.appendUint8(e);this.appendUint8(127&e|128),e>>>=7}},qe.prototype.appendVarBigInt=function(e){for(;;){if(0n==(-128n&e))return void this.appendUint8(Number(e));this.appendUint8(Number(0x7fn&e|0x80n)),e>>=7n}},qe.prototype.appendZigZag=function(e){\"number\"==typeof e?this.appendVarInt(e<<1^e>>31):this.appendVarBigInt(e<<1n^e>>63n)};const Xe=0xffffffffffffffffn,He=0x9e3779b185ebca87n,Je=0xc2b2ae3d27d4eb4fn,Qe=0x165667b19e3779f9n,We=0x85ebca77c2b2ae63n,Ke=0x27d4eb2f165667c5n;function et(e,t){return(e<<t|e>>64n-t)&Xe}function tt(e,t){return(e=et(e=e+t*Je&Xe,31n))*He&Xe}function nt(e,t){return(e^=tt(0n,t))*He+We&Xe}function rt(e,t=0n){const n=new DataView(e.buffer,e.byteOffset,e.byteLength),r=e.byteLength;let i,o=0;if(r>=32){let e=t+He+Je&Xe,f=t+Je&Xe,a=t,s=t-He&Xe;for(;o+32<=r;)e=tt(e,n.getBigUint64(o,!0)),o+=8,f=tt(f,n.getBigUint64(o,!0)),o+=8,a=tt(a,n.getBigUint64(o,!0)),o+=8,s=tt(s,n.getBigUint64(o,!0)),o+=8;i=et(e,1n)+et(f,7n)+et(a,12n)+et(s,18n)&Xe,i=nt(i,e),i=nt(i,f),i=nt(i,a),i=nt(i,s)}else i=t+Ke&Xe;for(i=i+BigInt(r)&Xe;o+8<=r;)i^=tt(0n,n.getBigUint64(o,!0)),i=et(i,27n)*He+We&Xe,o+=8;for(o+4<=r&&(i^=BigInt(n.getUint32(o,!0))*He&Xe,i=et(i,23n)*Je+Qe&Xe,o+=4);o<r;)i^=BigInt(n.getUint8(o))*Ke&Xe,i=et(i,11n)*He&Xe,o+=1;return i^=i>>33n,i=i*Je&Xe,i^=i>>29n,i=i*Qe&Xe,i^=i>>32n,i}const it=new TextEncoder;function ot(e,t){ft(e,12,t)}function ft(e,t,n){if(1!==t&&2!==t)if(3===t&&\"number\"==typeof n)e.appendUint8(n);else if(5===t&&\"number\"==typeof n)e.appendZigZag(n);else if(6===t&&\"bigint\"==typeof n)e.appendZigZag(n);else if(7===t&&\"number\"==typeof n)e.appendFloat64(n);else if(8===t&&\"string\"==typeof n){const t=(new TextEncoder).encode(n);e.appendVarInt(t.length),e.appendBytes(t)}else if(8===t&&n instanceof Uint8Array)e.appendVarInt(n.byteLength),e.appendBytes(n);else if(9===t&&Array.isArray(n)){const t=function(e){let t=0;for(const n of e){let e=at(n);if(1===e&&(e=2),t||(t=e),7===t&&5===e&&(e=7),5===t&&7===e&&(t=7),e!==t)throw new Error(`thrift invalid type for list element: ${n} (expected type ${t})`)}return t??3}(n);if(n.length>14?(e.appendUint8(240|t),e.appendVarInt(n.length)):e.appendUint8(n.length<<4|t),2===t)for(const t of n)e.appendUint8(t?1:0);else for(const r of n)ft(e,t,r)}else{if(12!==t||\"object\"!=typeof n)throw new Error(`thrift invalid type ${t} for value ${n}`);{let t=0;for(const[r,i]of Object.entries(n)){if(void 0===i)continue;const n=parseInt(r.replace(/^field_/,\"\"),10);if(Number.isNaN(n))throw new Error(`thrift invalid field name: ${r}. Expected \"field_###\"`);const o=at(i),f=n-t;if(f<=0)throw new Error(`thrift non-monotonic field id: fid=${n}, lastFid=${t}`);f>15?(e.appendUint8(o),e.appendZigZag(n)):e.appendUint8(f<<4|o),ft(e,o,i),t=n}e.appendUint8(0)}}}function at(e){if(!0===e)return 1;if(!1===e)return 2;if(Number.isInteger(e))return 5;if(\"number\"==typeof e)return 7;if(\"bigint\"==typeof e)return 6;if(\"string\"==typeof e)return 8;if(e instanceof Uint8Array)return 8;if(Array.isArray(e))return 9;if(e&&\"object\"==typeof e)return 12;throw new Error(`Cannot determine thrift compact type for: ${e}`)}const st=new Uint32Array([1203114875,1150766481,2284105051,2729912477,1884591559,770785867,2667333959,1550580529]);function lt(e,t){const n=function(e,t){return Number((e>>32n)*BigInt(t)>>32n)}(t,e.length>>3)<<3,r=function(e){const t=new Uint32Array(8),n=0|Number(0xffffffffn&e);for(let e=0;e<8;e++)t[e]=1<<(Math.imul(n,st[e])>>>27);return t}(t);for(let t=0;t<8;t++)e[n+t]|=r[t]}class ut{constructor(e,{fpp:t=.01,maxBytes:n=1048576}={}){this.element=e,this.fpp=t,this.maxBytes=n,this.hashes=new Set,this.skipped=0}insert(e){if(null==e)return;const t=function(e,t){if(null==e)return;const{type:n,converted_type:r,logical_type:i}=t;if(\"BOOLEAN\"===n){if(\"boolean\"!=typeof e)return;return rt(new Uint8Array([e?1:0]))}if(\"FLOAT\"===n){if(\"number\"!=typeof e)return;const t=new ArrayBuffer(4);return new DataView(t).setFloat32(0,e,!0),rt(new Uint8Array(t))}if(\"DOUBLE\"===n){if(\"number\"!=typeof e)return;const t=new ArrayBuffer(8);return new DataView(t).setFloat64(0,e,!0),rt(new Uint8Array(t))}if(\"INT32\"===n){if(\"DATE\"===r||\"DECIMAL\"===r||\"TIME_MILLIS\"===r)return;if(\"DATE\"===i?.type||\"TIME\"===i?.type||\"DECIMAL\"===i?.type)return;if(\"number\"!=typeof e||!Number.isInteger(e))return;const t=new ArrayBuffer(4);return new DataView(t).setInt32(0,0|e,!0),rt(new Uint8Array(t))}if(\"INT64\"===n){if(\"TIMESTAMP_MILLIS\"===r||\"TIMESTAMP_MICROS\"===r)return;if(\"TIME_MICROS\"===r||\"DECIMAL\"===r)return;if(\"TIMESTAMP\"===i?.type||\"TIME\"===i?.type||\"DECIMAL\"===i?.type)return;let t;if(\"bigint\"==typeof e)t=e;else{if(\"number\"!=typeof e||!Number.isSafeInteger(e))return;t=BigInt(e)}const n=new ArrayBuffer(8);return new DataView(n).setBigUint64(0,BigInt.asUintN(64,t),!0),rt(new Uint8Array(n))}if(\"BYTE_ARRAY\"===n){if(\"JSON\"===r||\"BSON\"===r||\"DECIMAL\"===r)return;if(\"JSON\"===i?.type||\"BSON\"===i?.type||\"VARIANT\"===i?.type)return;if(\"GEOMETRY\"===i?.type||\"GEOGRAPHY\"===i?.type)return;return\"string\"==typeof e?rt(it.encode(e)):e instanceof Uint8Array?rt(e):void 0}if(\"FIXED_LEN_BYTE_ARRAY\"===n){if(\"DECIMAL\"===r||\"INTERVAL\"===r)return;if(\"DECIMAL\"===i?.type||\"UUID\"===i?.type||\"FLOAT16\"===i?.type)return;if(\"GEOMETRY\"===i?.type||\"GEOGRAPHY\"===i?.type)return;return e instanceof Uint8Array?rt(e):void 0}}(e,this.element);void 0!==t?this.hashes.add(t):this.skipped++}finalize(){if(this.skipped>0||0===this.hashes.size)return;const e=function(e,t){if(!(t>0&&t<1))throw new Error(`bloom filter fpp must be in (0, 1), got ${t}`);if(!(e>=0))throw new Error(`bloom filter ndv must be >= 0, got ${e}`);const n=-8*e/Math.log(1-t**(1/8));let r=Math.ceil(n);(!isFinite(r)||r>1073741824)&&(r=1073741824),r=256*Math.ceil(r/256);let i=r>>3;return i<32&&(i=32),i<1024&&(i=function(e){let t=1;for(;t<e;)t<<=1;return t}(i)),i}(this.hashes.size,this.fpp);if(e>this.maxBytes)return;const t=new Uint32Array(e>>2);for(const e of this.hashes)lt(t,e);return t}}function ct(e,t){if(t.length%8!=0)throw new Error(`bloom filter block count must be a multiple of 8 uint32 words, got ${t.length}`);ot(e,{field_1:t.byteLength,field_2:{field_1:{}},field_3:{field_1:{}},field_4:{field_1:{}}});for(let n=0;n<t.length;n++)e.appendUint32(t[n])}const dt=[\"BOOLEAN\",\"INT32\",\"INT64\",\"INT96\",\"FLOAT\",\"DOUBLE\",\"BYTE_ARRAY\",\"FIXED_LEN_BYTE_ARRAY\"],pt=[\"PLAIN\",\"GROUP_VAR_INT\",\"PLAIN_DICTIONARY\",\"RLE\",\"BIT_PACKED\",\"DELTA_BINARY_PACKED\",\"DELTA_LENGTH_BYTE_ARRAY\",\"DELTA_BYTE_ARRAY\",\"RLE_DICTIONARY\",\"BYTE_STREAM_SPLIT\"],_t=[\"REQUIRED\",\"OPTIONAL\",\"REPEATED\"],yt=[\"UTF8\",\"MAP\",\"MAP_KEY_VALUE\",\"LIST\",\"ENUM\",\"DECIMAL\",\"DATE\",\"TIME_MILLIS\",\"TIME_MICROS\",\"TIMESTAMP_MILLIS\",\"TIMESTAMP_MICROS\",\"UINT_8\",\"UINT_16\",\"UINT_32\",\"UINT_64\",\"INT_8\",\"INT_16\",\"INT_32\",\"INT_64\",\"JSON\",\"BSON\",\"INTERVAL\"],ht=[\"UNCOMPRESSED\",\"SNAPPY\",\"GZIP\",\"LZO\",\"BROTLI\",\"LZ4\",\"ZSTD\",\"LZ4_RAW\"],mt=[\"DATA_PAGE\",\"INDEX_PAGE\",\"DICTIONARY_PAGE\",\"DATA_PAGE_V2\"],gt=[\"UNORDERED\",\"ASCENDING\",\"DESCENDING\"],wt=[\"SPHERICAL\",\"VINCENTY\",\"THOMAS\",\"ANDOYER\",\"KARNEY\"];function At(e,t){const n=t.length;if(0===n)return e.appendVarInt(128),e.appendVarInt(4),e.appendVarInt(0),void e.appendVarInt(0);if(\"number\"!=typeof t[0]&&\"bigint\"!=typeof t[0])throw new Error(\"deltaBinaryPack only supports number or bigint arrays\");e.appendVarInt(128),e.appendVarInt(4),e.appendVarInt(n),e.appendZigZag(t[0]);let r=1;for(;r<n;){const i=Math.min(r+128,n),o=i-r,f=new BigInt64Array(o);let a=BigInt(t[r])-BigInt(t[r-1]);f[0]=a;for(let e=1;e<o;e++){const n=BigInt(t[r+e])-BigInt(t[r+e-1]);f[e]=n,n<a&&(a=n)}e.appendZigZag(a);const s=new Uint8Array(4);for(let e=0;e<4;e++){const t=32*e,n=Math.min(t+32,o);let r=0n;for(let e=t;e<n;e++){const t=f[e]-a;t>r&&(r=t)}s[e]=Et(r)}e.appendBytes(s);for(let t=0;t<4;t++){const n=s[t];if(0===n)continue;const r=32*t,i=Math.min(r+32,o);let l=0n,u=0;for(let t=0;t<32;t++)for(l|=(r+t<i?f[r+t]-a:0n)<<BigInt(u),u+=n;u>=8;)e.appendUint8(Number(0xffn&l)),l>>=8n,u-=8}r=i}}function Et(e){if(0n===e)return 0;let t=0;for(;e>0n;)t++,e>>=1n;return t}function vt(e,t,n){const r=e.offset;let i=0,o=0,f=0;for(;f<t.length;){let r=1;const a=t[f];for(;f+r<t.length&&t[f+r]===a;)r++;r>=8?(i&&(bt(e,t,o,i,n),i=0),It(e,a,r,n),f+=r):(0===i&&(o=f),i++,f+=8)}return i&&bt(e,t,o,i,n),e.offset-r}function It(e,t,n,r){e.appendVarInt(n<<1);const i=r+7>>3;for(let n=0;n<i;n++)e.appendUint8(t>>(n<<3)&255)}function bt(e,t,n,r,i){if(e.appendVarInt(r<<1|1),0===i)return;const o=(1<<i)-1;let f=0,a=0;const s=8*r;for(let r=0;r<s;r++){const s=n+r;for(f|=(s<t.length?t[s]&o:0)<<a,a+=i;a>=8;)e.appendUint8(255&f),f>>>=8,a-=8}a>0&&e.appendUint8(255&f)}function Tt(e,t,n,r){if(\"BOOLEAN\"===n)!function(e,t){let n=0;for(let r=0;r<t.length;r++){const i=t[r];if(\"boolean\"!=typeof i)throw new Error(\"parquet expected boolean value, got \"+i);const o=r%8;i&&(n|=1<<o),7===o&&(e.appendUint8(n),n=0)}t.length%8&&e.appendUint8(n)}(e,t);else if(\"INT32\"===n)!function(e,t){for(const n of t){if(!Number.isSafeInteger(n))throw new Error(\"parquet expected integer value, got \"+n);if(n<-2147483648||n>2147483647)throw new Error(\"parquet expected int32 value, got \"+n);e.appendInt32(n)}}(e,t);else if(\"INT64\"===n)!function(e,t){for(const n of t){if(\"bigint\"!=typeof n)throw new Error(\"parquet expected bigint value, got \"+n);e.appendInt64(n)}}(e,t);else if(\"FLOAT\"===n)!function(e,t){for(const n of t){if(\"number\"!=typeof n)throw new Error(\"parquet expected number value, got \"+n);e.appendFloat32(n)}}(e,t);else if(\"DOUBLE\"===n)!function(e,t){for(const n of t){if(\"number\"!=typeof n)throw new Error(\"parquet expected number value, got \"+n);e.appendFloat64(n)}}(e,t);else if(\"BYTE_ARRAY\"===n)!function(e,t){for(const n of t){let t=n;if(\"string\"==typeof t&&(t=(new TextEncoder).encode(n)),!(t instanceof Uint8Array))throw new Error(\"parquet expected Uint8Array value, got \"+typeof t);e.appendUint32(t.length),e.appendBytes(t)}}(e,t);else{if(\"FIXED_LEN_BYTE_ARRAY\"!==n)throw new Error(`parquet unsupported type: ${n}`);if(!r)throw new Error(\"parquet FIXED_LEN_BYTE_ARRAY expected type_length\");!function(e,t,n){for(const r of t){if(!(r instanceof Uint8Array))throw new Error(\"parquet expected Uint8Array value, got \"+typeof r);if(r.length!==n)throw new Error(`parquet expected Uint8Array of length ${n}`);e.appendBytes(r)}}(e,t,r)}}const Nt=new TextEncoder,Ut=-(2n**63n),Lt=2n**63n-1n,Ot=new Uint8Array([0]),Bt=new Set([\"value\",\"typed_value\"]),Rt=new Map,Dt=Ct([]);function Mt(e,t,n){if(n?.required)for(let t=0;t<e.length;t++)if(void 0===e[t])throw new Error(`required variant column ${n.name} has undefined value at index ${t}`);const r=t&&$t(t);if(r){const t=new Map;return e.map(e=>{if(void 0===e)return null;const n=new Set;kt(e,n);const{metadata:i,keyIndex:o}=function(e,t){if(0===e.size)return{metadata:Dt,keyIndex:Rt};const n=[...e].sort(),r=n.join(\"\\0\"),i=t.get(r);if(i)return i;const o=Ct(n),f=new Map;for(let e=0;e<n.length;e++)f.set(n[e],e);const a={metadata:o,keyIndex:f};return t.set(r,a),a}(n,t);return{metadata:i,...St(e,r,o,!0)}})}const i=function(e){const t=new Set;return kt(e,t),[...t].sort()}(e),o=Ct(i),f=new Map;for(let e=0;e<i.length;e++)f.set(i[e],e);return e.map(e=>void 0===e?null:{metadata:o,value:Gt(e,f)})}function St(e,t,n,r){if(null==e)return{value:Ot,typed_value:null};if(Array.isArray(t)){if(!Array.isArray(e))return{value:Gt(e,n),typed_value:null};const r=t[0];return{value:null,typed_value:e.map(e=>St(e,r,n,!1))}}if(\"object\"==typeof t){if(\"object\"!=typeof e||Array.isArray(e)||e instanceof Date||e instanceof Uint8Array)return{value:Gt(e,n),typed_value:null};const i={};let o=!1;for(const n of Object.keys(e))n in t||void 0===e[n]||(i[n]=e[n],o=!0);if(o&&!r)return{value:Gt(e,n),typed_value:null};const f=Object.keys(t);if(f.some(t=>(!Object.prototype.hasOwnProperty.call(e,t)||void 0===e[t])&&n.has(t)))return{value:Gt(e,n),typed_value:null};const a={};for(const r of f)Object.prototype.hasOwnProperty.call(e,r)&&void 0!==e[r]&&(a[r]=St(e[r],t[r],n,!1));return{value:o?Gt(i,n):null,typed_value:a}}return function(e,t){if(null==e)return!1;switch(t){case\"BOOLEAN\":return\"boolean\"==typeof e;case\"INT32\":return\"number\"==typeof e&&Number.isInteger(e)&&e>=-2147483648&&e<=2147483647;case\"INT64\":return\"bigint\"==typeof e&&e>=Ut&&e<=Lt;case\"FLOAT\":case\"DOUBLE\":return\"number\"==typeof e;case\"STRING\":return\"string\"==typeof e;case\"TIMESTAMP\":return e instanceof Date;default:return!1}}(e,t)?{value:null,typed_value:e}:{value:Gt(e,n),typed_value:null}}function xt(e){const t=Yt(e,0);if(void 0===t||\"object\"!=typeof t)return;const n=$t(t);return void 0===n||Pt(n)>256?void 0:n}function Pt(e){if(Array.isArray(e))return e.length?Pt(e[0]):0;if(e&&\"object\"==typeof e){let t=0;for(const n of Object.keys(e))t+=Pt(e[n]);return t}return 1}function Yt(e,t){const n=[];for(const t of e)null!=t&&n.push(t);if(!n.length)return;if(n.some(Ft)){if(t>=3)return;const e=new Map;for(const t of n)if(Ft(t))for(const[n,r]of Object.entries(t)){if(void 0===r)continue;const t=e.get(n);t?t.push(r):e.set(n,[r])}const r={};for(const[n,i]of e){const e=Yt(i,t+1);void 0!==e&&(r[n]=e)}return Object.keys(r).length>0?r:void 0}if(n.every(Array.isArray)){if(t>=3)return;const e=[];for(const t of n)for(const n of t)e.push(n);const r=Yt(e,t+1);return void 0===r?void 0:[r]}let r;for(const e of n){if(Array.isArray(e))return;const t=e instanceof Date?\"date\":typeof e;if(void 0===r)r=t;else if(r!==t)return}return r?function(e){switch(e){case\"boolean\":return\"BOOLEAN\";case\"string\":return\"STRING\";case\"number\":return\"DOUBLE\";case\"bigint\":return\"INT64\";case\"date\":return\"TIMESTAMP\";default:return}}(r):void 0}function Ft(e){return!(\"object\"!=typeof e||null===e||Array.isArray(e)||e instanceof Date||e instanceof Uint8Array)}function $t(e){if(Array.isArray(e)){const t=e.length?$t(e[0]):void 0;return void 0===t?void 0:[t]}if(\"object\"==typeof e){const t={};for(const[n,r]of Object.entries(e)){if(Bt.has(n))continue;const e=$t(r);void 0!==e&&(t[n]=e)}return Object.keys(t).length>0?t:void 0}return e}function kt(e,t){if(null!=e)if(Array.isArray(e))for(const n of e)kt(n,t);else if(!(e instanceof Date||e instanceof Uint8Array)&&\"object\"==typeof e)for(const n of Object.keys(e))t.add(n),kt(e[n],t)}function Ct(e){const t=e.length,n=new Array(t);let r=0;for(let i=0;i<t;i++){const t=Nt.encode(e[i]);n[i]=t,r+=t.length}const i=jt(r),o=17|i-1<<6,f=new Uint8Array(1+i+(t+1)*i+r);let a=0;f[a++]=o;for(let e=0;e<i;e++)f[a++]=t>>8*e&255;let s=0;for(let e=0;e<t;e++){for(let e=0;e<i;e++)f[a++]=s>>8*e&255;s+=n[e].length}for(let e=0;e<i;e++)f[a++]=s>>8*e&255;for(let e=0;e<t;e++)f.set(n[e],a),a+=n[e].length;return f}function Gt(e,t){const n=new qe(8);return qt(e,n,t),n.getBytes()}function qt(e,t,n){if(null!=e)if(!0!==e)if(!1!==e){if(\"bigint\"==typeof e){if(e<Ut||e>Lt)throw new RangeError(`variant bigint out of int64 range: ${e}`);return t.appendUint8(24),void t.appendInt64(e)}if(\"number\"==typeof e){if(Number.isInteger(e)){if(e>=-128&&e<=127)return t.appendUint8(12),void t.appendUint8(255&e);if(e>=-32768&&e<=32767)return t.appendUint8(16),void Vt(t,e,2);if(e>=-2147483648&&e<=2147483647)return t.appendUint8(20),void t.appendInt32(e)}return t.appendUint8(28),void t.appendFloat64(e)}if(\"string\"==typeof e){const n=Nt.encode(e);return void(n.length<=63?(t.appendUint8(n.length<<2|1),t.appendBytes(n)):(t.appendUint8(64),t.appendUint32(n.length),t.appendBytes(n)))}if(e instanceof Date)return t.appendUint8(52),void t.appendInt64(1000n*BigInt(e.getTime()));if(e instanceof Uint8Array)return t.appendUint8(60),t.appendUint32(e.length),void t.appendBytes(e);if(Array.isArray(e))!function(e,t,n){const r=e.length,i=new qe(8),o=new Array(r+1);o[0]=0;for(let t=0;t<r;t++)qt(e[t],i,n),o[t+1]=i.index;const f=jt(o[r]),a=r>255?1:0;t.appendUint8((f-1|a<<2)<<2|3),a?t.appendUint32(r):t.appendUint8(r);for(const e of o)Vt(t,e,f);t.appendBytes(i.getBytes())}(e,t,n);else{if(\"object\"!=typeof e)throw new Error(`variant cannot encode value: ${e}`);!function(e,t,n){const r=Object.keys(e).filter(t=>void 0!==e[t]).map(e=>{const t=n.get(e);if(void 0===t)throw new Error(`variant key not in dictionary: ${e}`);return{id:t,key:e}});r.sort((e,t)=>e.id-t.id);const i=r.length,o=jt(i>0?r[i-1].id:0),f=new qe(8),a=new Array(i+1);a[0]=0;for(let t=0;t<i;t++)qt(e[r[t].key],f,n),a[t+1]=f.index;const s=jt(a[i]),l=i>255?1:0;t.appendUint8((s-1|o-1<<2|l<<4)<<2|2),l?t.appendUint32(i):t.appendUint8(i);for(const{id:e}of r)Vt(t,e,o);for(const e of a)Vt(t,e,s);t.appendBytes(f.getBytes())}(e,t,n)}}else t.appendUint8(8);else t.appendUint8(4);else t.appendUint8(0)}function jt(e){return e<=255?1:e<=65535?2:e<=16777215?3:4}function Vt(e,t,n){for(let r=0;r<n;r++)e.appendUint8(t>>8*r&255)}function zt({columnData:e,schemaOverrides:t}){const n=[{name:\"root\",num_children:e.length}];for(const{name:r,data:i,type:o,nullable:f,shredding:a}of e)if(t?.[r]){const e=t[r];if(o||void 0!==f)throw new Error(`cannot provide both type and schema override for column ${r}`);if(e.name!==r)throw new Error(`schema override for column ${r} must have matching name, got ${e.name}`);if(\"FIXED_LEN_BYTE_ARRAY\"===e.type&&!e.type_length)throw new Error(\"schema override for FIXED_LEN_BYTE_ARRAY must include type_length\");if(e.num_children)throw new Error(\"schema override does not support nested types\");n.push(e)}else if(\"VARIANT\"===o){const e=!1===f?\"REQUIRED\":\"OPTIONAL\",t=a&&!0!==a?$t(a):void 0;t?n.push({name:r,repetition_type:e,num_children:3,logical_type:{type:\"VARIANT\"}},{name:\"metadata\",type:\"BYTE_ARRAY\",repetition_type:\"REQUIRED\"},{name:\"value\",type:\"BYTE_ARRAY\",repetition_type:\"OPTIONAL\"},...Zt(t)):n.push({name:r,repetition_type:e,num_children:2,logical_type:{type:\"VARIANT\"}},{name:\"metadata\",type:\"BYTE_ARRAY\",repetition_type:\"REQUIRED\"},{name:\"value\",type:\"BYTE_ARRAY\",repetition_type:\"OPTIONAL\"})}else o?n.push(Ht(r,o,f)):n.push(Jt(r,i.slice(0,1e3)));return n}function Zt(e){if(Array.isArray(e))return[{name:\"typed_value\",repetition_type:\"OPTIONAL\",converted_type:\"LIST\",num_children:1},{name:\"list\",repetition_type:\"REPEATED\",num_children:1},{name:\"element\",repetition_type:\"REQUIRED\",num_children:2},{name:\"value\",type:\"BYTE_ARRAY\",repetition_type:\"OPTIONAL\"},...Zt(e[0])];if(\"object\"==typeof e){const t=Object.keys(e),n=[{name:\"typed_value\",repetition_type:\"OPTIONAL\",num_children:t.length}];for(const r of t)n.push({name:r,repetition_type:\"OPTIONAL\",num_children:2},{name:\"value\",type:\"BYTE_ARRAY\",repetition_type:\"OPTIONAL\"},...Zt(e[r]));return n}return[Xt(e)]}function Xt(e){switch(e){case\"STRING\":return{name:\"typed_value\",type:\"BYTE_ARRAY\",converted_type:\"UTF8\",repetition_type:\"OPTIONAL\"};case\"INT32\":return{name:\"typed_value\",type:\"INT32\",repetition_type:\"OPTIONAL\"};case\"INT64\":return{name:\"typed_value\",type:\"INT64\",repetition_type:\"OPTIONAL\"};case\"DOUBLE\":return{name:\"typed_value\",type:\"DOUBLE\",repetition_type:\"OPTIONAL\"};case\"FLOAT\":return{name:\"typed_value\",type:\"FLOAT\",repetition_type:\"OPTIONAL\"};case\"BOOLEAN\":return{name:\"typed_value\",type:\"BOOLEAN\",repetition_type:\"OPTIONAL\"};case\"TIMESTAMP\":return{name:\"typed_value\",type:\"INT64\",converted_type:\"TIMESTAMP_MICROS\",repetition_type:\"OPTIONAL\"};default:throw new Error(`unsupported shredded field type: ${e}`)}}function Ht(e,t,n){const r=!1===n?\"REQUIRED\":\"OPTIONAL\";return\"STRING\"===t?{name:e,type:\"BYTE_ARRAY\",converted_type:\"UTF8\",repetition_type:r}:\"JSON\"===t?{name:e,type:\"BYTE_ARRAY\",converted_type:\"JSON\",repetition_type:r}:\"TIMESTAMP\"===t?{name:e,type:\"INT64\",converted_type:\"TIMESTAMP_MILLIS\",repetition_type:r}:\"UUID\"===t?{name:e,type:\"FIXED_LEN_BYTE_ARRAY\",type_length:16,logical_type:{type:\"UUID\"},repetition_type:r}:\"FLOAT16\"===t?{name:e,type:\"FIXED_LEN_BYTE_ARRAY\",type_length:2,logical_type:{type:\"FLOAT16\"},repetition_type:r}:\"GEOMETRY\"===t?{name:e,type:\"BYTE_ARRAY\",logical_type:{type:\"GEOMETRY\"},repetition_type:r}:\"GEOGRAPHY\"===t?{name:e,type:\"BYTE_ARRAY\",logical_type:{type:\"GEOGRAPHY\"},repetition_type:r}:{name:e,type:t,repetition_type:r}}function Jt(e,t){let n,r,i=\"REQUIRED\";if(t instanceof Int32Array)return{name:e,type:\"INT32\",repetition_type:i};if(t instanceof BigInt64Array)return{name:e,type:\"INT64\",repetition_type:i};if(t instanceof Float32Array)return{name:e,type:\"FLOAT\",repetition_type:i};if(t instanceof Float64Array)return{name:e,type:\"DOUBLE\",repetition_type:i};for(const e of t)if(null==e)i=\"OPTIONAL\";else{let t,i;if(\"boolean\"==typeof e)t=\"BOOLEAN\";else if(\"bigint\"==typeof e)t=\"INT64\";else if(Number.isInteger(e))t=\"INT32\";else if(\"number\"==typeof e)t=\"DOUBLE\";else if(e instanceof Uint8Array)t=\"BYTE_ARRAY\";else if(\"string\"==typeof e)t=\"BYTE_ARRAY\",i=\"UTF8\";else if(e instanceof Date)t=\"INT64\",i=\"TIMESTAMP_MILLIS\";else{if(\"object\"!=typeof e)throw new Error(`cannot determine parquet type for: ${e}`);t=\"BYTE_ARRAY\",i=\"JSON\"}if(void 0===n)n=t,r=i;else if(\"INT32\"===n&&\"DOUBLE\"===t)n=\"DOUBLE\";else if(\"DOUBLE\"===n&&\"INT32\"===t)t=\"DOUBLE\";else if(n!==t||r!==i)throw new Error(`parquet cannot write mixed types: ${r??n} and ${i??t}`)}return n||(n=\"BYTE_ARRAY\",i=\"OPTIONAL\"),{name:e,type:n,repetition_type:i,converted_type:r}}function Qt(e){if(Array.isArray(e)&&e.every(e=>\"number\"==typeof e))return e;throw new Error(\"Expected number array for BYTE_STREAM_SPLIT encoding\")}function Wt({writer:e,column:t,encoding:n,pageData:r}){const{columnName:i,element:o,codec:f,compressors:a}=t,{type:s,type_length:l,repetition_type:u}=o;if(!s)throw new Error(`column ${i} cannot determine type`);if(\"REPEATED\"===u)throw new Error(`column ${i} repeated types not supported`);const c=new qe,{definition_levels_byte_length:d,repetition_levels_byte_length:p,num_nulls:_,num_values:y,num_rows:h}=function(e,t,n){const{schemaPath:r}=t,{values:i,definitionLevels:o,repetitionLevels:f,maxDefinitionLevel:a}=n,s=o.length||i.length;let l=0,u=0;if(f.length)for(let e=0;e<f.length;e++)0===f[e]&&u++;else u=i.length;if(o.length)for(let e=0;e<o.length;e++)o[e]<a&&l++;const c=function(e){let t=0;for(const n of e)\"REPEATED\"===n.repetition_type&&t++;return t}(r);let d=0;c&&(d=vt(e,f,Math.ceil(Math.log2(c+1))));let p=0;return a&&(p=vt(e,o,Math.ceil(Math.log2(a+1)))),{definition_levels_byte_length:p,repetition_levels_byte_length:d,num_values:s,num_nulls:l,num_rows:u}}(c,t,r),m=_?r.values.filter(e=>null!=e):r.values,g=new qe;if(\"PLAIN\"===n)Tt(g,m,s,l);else if(\"RLE\"===n){if(\"BOOLEAN\"!==s)throw new Error(\"RLE encoding only supported for BOOLEAN type\");const e=new qe;vt(e,m,1),g.appendUint32(e.offset),g.appendBytes(e.getBytes())}else if(\"PLAIN_DICTIONARY\"===n||\"RLE_DICTIONARY\"===n){let e=0;for(const t of m)t>e&&(e=t);const t=Math.ceil(Math.log2(e+1));g.appendUint8(t),vt(g,m,t)}else if(\"DELTA_BINARY_PACKED\"===n){if(\"INT32\"!==s&&\"INT64\"!==s)throw new Error(\"DELTA_BINARY_PACKED encoding only supported for INT32 and INT64 types\");At(g,m)}else if(\"DELTA_LENGTH_BYTE_ARRAY\"===n){if(\"BYTE_ARRAY\"!==s)throw new Error(\"DELTA_LENGTH_BYTE_ARRAY encoding only supported for BYTE_ARRAY type\");!function(e,t){const n=new Int32Array(t.length);for(let e=0;e<t.length;e++){const r=t[e];if(!(r instanceof Uint8Array))throw new Error(\"deltaLengthByteArray expects Uint8Array values\");n[e]=r.length}At(e,n);for(const n of t)e.appendBytes(n)}(g,m)}else if(\"DELTA_BYTE_ARRAY\"===n){if(\"BYTE_ARRAY\"!==s)throw new Error(\"DELTA_BYTE_ARRAY encoding only supported for BYTE_ARRAY type\");!function(e,t){if(0===t.length)return At(e,[]),void At(e,[]);const n=new Int32Array(t.length),r=new Int32Array(t.length),i=new Array(t.length);if(!(t[0]instanceof Uint8Array))throw new Error(\"deltaByteArray expects Uint8Array values\");n[0]=0,r[0]=t[0].length,i[0]=t[0];for(let e=1;e<t.length;e++){const o=t[e-1],f=t[e];if(!(f instanceof Uint8Array))throw new Error(\"deltaByteArray expects Uint8Array values\");let a=0;const s=Math.min(o.length,f.length);for(;a<s&&o[a]===f[a];)a++;n[e]=a,r[e]=f.length-a,i[e]=f.subarray(a)}At(e,n),At(e,r);for(const t of i)e.appendBytes(t)}(g,m)}else{if(\"BYTE_STREAM_SPLIT\"!==n)throw new Error(`parquet unsupported encoding: ${n}`);!function(e,t,n,r){const i=t.length;let o,f;if(\"FLOAT\"===n){const e=t instanceof Float32Array?t:new Float32Array(Qt(t));o=new Uint8Array(e.buffer,e.byteOffset,e.byteLength),f=4}else if(\"DOUBLE\"===n){const e=t instanceof Float64Array?t:new Float64Array(Qt(t));o=new Uint8Array(e.buffer,e.byteOffset,e.byteLength),f=8}else if(\"INT32\"===n){const e=t instanceof Int32Array?t:new Int32Array(Qt(t));o=new Uint8Array(e.buffer,e.byteOffset,e.byteLength),f=4}else if(\"INT64\"===n){const e=function(e){if(e instanceof BigInt64Array)return e;if(Array.isArray(e)&&e.every(e=>\"bigint\"==typeof e))return new BigInt64Array(e);throw new Error(\"Expected bigint array for BYTE_STREAM_SPLIT encoding\")}(t);o=new Uint8Array(e.buffer,e.byteOffset,e.byteLength),f=8}else{if(\"FIXED_LEN_BYTE_ARRAY\"!==n)throw new Error(`parquet byte_stream_split unsupported type: ${n}`);if(!r)throw new Error(\"parquet byte_stream_split missing type_length\");f=r,o=new Uint8Array(i*f);for(let e=0;e<i;e++)o.set(t[e],e*f)}for(let t=0;t<f;t++)for(let n=0;n<i;n++)e.appendUint8(o[n*f+t])}(g,m,s,l)}const w=g.getBytes(),A=a[f]?.(w)??w;Kt(e,{type:\"DATA_PAGE_V2\",uncompressed_page_size:c.offset+g.offset,compressed_page_size:c.offset+A.length,data_page_header_v2:{num_values:y,num_nulls:_,num_rows:h,encoding:n,definition_levels_byte_length:d,repetition_levels_byte_length:p,is_compressed:!!f}}),e.appendBytes(c.getBytes()),e.appendBytes(A)}function Kt(e,t){ot(e,{field_1:mt.indexOf(t.type),field_2:t.uncompressed_page_size,field_3:t.compressed_page_size,field_4:t.crc,field_5:t.data_page_header&&{field_1:t.data_page_header.num_values,field_2:pt.indexOf(t.data_page_header.encoding),field_3:pt.indexOf(t.data_page_header.definition_level_encoding),field_4:pt.indexOf(t.data_page_header.repetition_level_encoding)},field_7:t.dictionary_page_header&&{field_1:t.dictionary_page_header.num_values,field_2:pt.indexOf(t.dictionary_page_header.encoding)},field_8:t.data_page_header_v2&&{field_1:t.data_page_header_v2.num_values,field_2:t.data_page_header_v2.num_nulls,field_3:t.data_page_header_v2.num_rows,field_4:pt.indexOf(t.data_page_header_v2.encoding),field_5:t.data_page_header_v2.definition_levels_byte_length,field_6:t.data_page_header_v2.repetition_levels_byte_length,field_7:!!t.data_page_header_v2.is_compressed&&void 0}})}function en(e,t,n){if(null==e)return 0;if(\"BOOLEAN\"===t)return.125;if(\"INT32\"===t||\"FLOAT\"===t)return 4;if(\"INT64\"===t||\"DOUBLE\"===t)return 8;if(\"INT96\"===t)return 12;if(\"FIXED_LEN_BYTE_ARRAY\"===t)return n??0;if(\"BYTE_ARRAY\"===t){if(e instanceof Uint8Array)return e.byteLength;if(\"string\"==typeof e)return e.length}return 0}function tn(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e[n],t=Math.imul(t,16777619);return t>>>0}function nn(e,t){if(e.length!==t.length)return!1;for(let n=0;n<e.length;n++)if(e[n]!==t[n])return!1;return!0}function rn(e,t){if(\"GeometryCollection\"===t.type){for(const n of t.geometries||[])e=rn(e,n);return e}return on(e,t.coordinates)}function on(e,t){if(\"number\"==typeof t[0])return e=fn(e,\"xmin\",\"xmax\",t[0]),e=fn(e,\"ymin\",\"ymax\",t[1]),t.length>2&&(e=fn(e,\"zmin\",\"zmax\",t[2])),t.length>3&&(e=fn(e,\"mmin\",\"mmax\",t[3])),e;for(const n of t)e=on(e,n);return e}function fn(e,t,n,r){if(void 0===r||!Number.isFinite(r))return e;e||(e={});const i=e[t],o=e[n];return(void 0===i||r<i)&&(e[t]=r),(void 0===o||r>o)&&(e[n]=r),e}function an(e){const t=sn[e.type];if(void 0===t)throw new Error(`unknown geometry type: ${e.type}`);const n=ln(e);if(2===n)return t;if(3===n)return t+1e3;if(4===n)return t+3e3;throw new Error(`unsupported geometry dimensions: ${n}`)}const sn={Point:1,LineString:2,Polygon:3,MultiPoint:4,MultiLineString:5,MultiPolygon:6,GeometryCollection:7};function ln(e){if(\"GeometryCollection\"===e.type){let t=0;for(const n of e.geometries||[])t=Math.max(t,ln(n));return t||2}return un(e.coordinates)}function un(e){if(!e.length)return 2;if(\"number\"==typeof e[0])return e.length;let t=0;for(const n of e)t=Math.max(t,un(n));return t||2}function cn(e){if(void 0===e)return null;if(\"bigint\"==typeof e)return Number(e);if(Object.is(e,-0))return 0;if(Array.isArray(e))return e.map(cn);if(e instanceof Uint8Array)return Array.from(e);if(e instanceof Date)return e.toISOString();if(e instanceof Object){const t={};for(const n of Object.keys(e))void 0!==e[n]&&(t[n]=cn(e[n]));return t}return e}function dn(e){const t=new qe;return pn(t,e),t.getBytes()}function pn(e,t){if(\"object\"!=typeof t)throw new Error(\"geometry values must be GeoJSON geometries\");const n=function(e){if(\"Point\"===e)return 1;if(\"LineString\"===e)return 2;if(\"Polygon\"===e)return 3;if(\"MultiPoint\"===e)return 4;if(\"MultiLineString\"===e)return 5;if(\"MultiPolygon\"===e)return 6;if(\"GeometryCollection\"===e)return 7;throw new Error(`unknown geometry type: ${e}`)}(t.type),r=hn(t);let i=0;if(3===r)i=1;else if(4===r)i=3;else if(r>4)throw new Error(`unsupported geometry dimensions: ${r}`);if(e.appendUint8(1),e.appendUint32(n+1e3*i),\"Point\"===t.type)_n(e,t.coordinates,r);else if(\"LineString\"===t.type)yn(e,t.coordinates,r);else if(\"Polygon\"===t.type){e.appendUint32(t.coordinates.length);for(const n of t.coordinates)yn(e,n,r)}else if(\"MultiPoint\"===t.type){e.appendUint32(t.coordinates.length);for(const n of t.coordinates)pn(e,{type:\"Point\",coordinates:n})}else if(\"MultiLineString\"===t.type){e.appendUint32(t.coordinates.length);for(const n of t.coordinates)pn(e,{type:\"LineString\",coordinates:n})}else if(\"MultiPolygon\"===t.type){e.appendUint32(t.coordinates.length);for(const n of t.coordinates)pn(e,{type:\"Polygon\",coordinates:n})}else{if(\"GeometryCollection\"!==t.type)throw new Error(\"unsupported geometry type\");e.appendUint32(t.geometries.length);for(const n of t.geometries)pn(e,n)}}function _n(e,t,n){if(t.length<n)throw new Error(\"geometry position dimensions mismatch\");for(let r=0;r<n;r++)e.appendFloat64(t[r])}function yn(e,t,n){e.appendUint32(t.length);for(const r of t)_n(e,r,n)}function hn(e){if(\"GeometryCollection\"===e.type){let t=0;for(const n of e.geometries)t=Math.max(t,hn(n));return t||2}return mn(e.coordinates)}function mn(e){if(!Array.isArray(e))return 2;if(!e.length)return 2;if(\"number\"==typeof e[0])return e.length;let t=0;for(const n of e)t=Math.max(t,mn(n));return t||2}const gn=864e5;function wn(e,t){const{type:n,converted_type:r,logical_type:i}=e;if(\"DECIMAL\"===r){const n=10**(e.scale||0);return t.map(t=>{if(null==t)return t;if(\"number\"!=typeof t)throw new Error(\"DECIMAL must be a number\");return In(e,BigInt(Math.round(t*n)))})}if(\"DATE\"===r)return Array.from(t).map(e=>e instanceof Date?Math.floor(e.getTime()/gn):e);if(\"TIMESTAMP_MILLIS\"===r)return Array.from(t).map(e=>null==e?e:e instanceof Date?BigInt(e.getTime()):BigInt(e));if(\"TIMESTAMP_MICROS\"===r)return Array.from(t).map(e=>null==e?e:e instanceof Date?BigInt(1e3*e.getTime()):BigInt(e));if(\"JSON\"===r){if(!Array.isArray(t))throw new Error(\"JSON must be an array\");const e=new TextEncoder;return t.map(t=>void 0===t?void 0:e.encode(JSON.stringify(cn(t))))}if(\"UTF8\"===r){if(!Array.isArray(t))throw new Error(\"strings must be an array\");const e=new TextEncoder;return t.map(t=>\"string\"==typeof t?e.encode(t):t)}if(\"UINT_32\"===r||\"INTEGER\"===i?.type&&32===i.bitWidth&&!i.isSigned)return t instanceof Uint32Array?t:t instanceof Int32Array?new Uint32Array(t.buffer,t.byteOffset,t.length):Array.from(t).map(e=>{if(null==e)return e;if(!Number.isSafeInteger(e))throw new Error(\"expected integer value, got \"+e);if(e<0||e>4294967295)throw new Error(\"expected uint32 value, got \"+e);return e>2147483647?e-4294967296:e});if(\"FLOAT16\"===i?.type){if(\"FIXED_LEN_BYTE_ARRAY\"!==n)throw new Error(\"FLOAT16 must be FIXED_LEN_BYTE_ARRAY type\");if(2!==e.type_length)throw new Error(\"FLOAT16 expected type_length to be 2 bytes\");return Array.from(t).map(bn)}if(\"UUID\"===i?.type){if(!Array.isArray(t))throw new Error(\"UUID must be an array\");if(\"FIXED_LEN_BYTE_ARRAY\"!==n)throw new Error(\"UUID must be FIXED_LEN_BYTE_ARRAY type\");if(16!==e.type_length)throw new Error(\"UUID expected type_length to be 16 bytes\");return t.map(An)}if(\"TIMESTAMP\"===i?.type)return Array.from(t).map(e=>{if(null==e)return e;if(e instanceof Date){const t=BigInt(e.getTime());return\"NANOS\"===i.unit?1000000n*t:\"MICROS\"===i.unit?1000n*t:t}return BigInt(e)});if(\"GEOMETRY\"===i?.type||\"GEOGRAPHY\"===i?.type){if(!Array.isArray(t))throw new Error(\"geometry must be an array\");return t.map(e=>null==e?e:dn(e))}return t}function An(e){if(null!=e){if(e instanceof Uint8Array)return e;if(\"string\"==typeof e){if(!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(e))throw new Error(\"UUID must be a valid UUID string\");e=e.replace(/-/g,\"\").toLowerCase();const t=new Uint8Array(16);for(let n=0;n<16;n++)t[n]=parseInt(e.slice(2*n,2*n+2),16);return t}throw new Error(\"UUID must be a string or Uint8Array\")}}function En(e,t){if(null==e)return;const{type:n}=t;return(\"BYTE_ARRAY\"!==n&&\"FIXED_LEN_BYTE_ARRAY\"!==n||\"UUID\"===t.logical_type?.type||!((e instanceof Uint8Array?e:(new TextEncoder).encode(e.toString())).length>16))&&void 0}function vn(e,t,n){if(null==e)return;const{type:r,converted_type:i}=t;if(\"BOOLEAN\"===r)return new Uint8Array([e?1:0]);if(\"UUID\"===t.logical_type?.type&&(\"string\"==typeof e||e instanceof Uint8Array))return An(e);if(\"DECIMAL\"===i){if(\"number\"!=typeof e)throw new Error(\"DECIMAL must be a number\");const n=10**(t.scale||0),r=In(t,BigInt(Math.round(e*n)));if(r instanceof Uint8Array)return r;if(\"number\"==typeof r){const e=new ArrayBuffer(4);return new DataView(e).setFloat32(0,r,!0),new Uint8Array(e)}if(\"bigint\"==typeof r){const e=new ArrayBuffer(8);return new DataView(e).setBigInt64(0,r,!0),new Uint8Array(e)}}if(\"BYTE_ARRAY\"===r||\"FIXED_LEN_BYTE_ARRAY\"===r)return function(e,t){if(e.length<=16)return e;const n=e.slice(0,16);if(!t)return n;let r=n.length-1;for(;r>=0&&255===n[r];)r--;if(r<0)return;const i=n.slice(0,r+1);return i[r]+=1,i}(e instanceof Uint8Array?e:(new TextEncoder).encode(e.toString()),n);if(\"FLOAT\"===r&&\"number\"==typeof e){const t=new ArrayBuffer(4);return new DataView(t).setFloat32(0,e,!0),new Uint8Array(t)}if(\"DOUBLE\"===r&&\"number\"==typeof e){const t=new ArrayBuffer(8);return new DataView(t).setFloat64(0,e,!0),new Uint8Array(t)}if(\"INT32\"===r&&\"number\"==typeof e){const t=new ArrayBuffer(4);return new DataView(t).setInt32(0,e,!0),new Uint8Array(t)}if(\"INT64\"===r&&\"bigint\"==typeof e){const t=new ArrayBuffer(8);return new DataView(t).setBigInt64(0,e,!0),new Uint8Array(t)}if(\"INT32\"===r&&\"DATE\"===i&&e instanceof Date){const t=new ArrayBuffer(4);return new DataView(t).setInt32(0,Math.floor(e.getTime()/gn),!0),new Uint8Array(t)}if(\"INT64\"===r&&\"TIMESTAMP_MILLIS\"===i&&e instanceof Date){const t=new ArrayBuffer(8);return new DataView(t).setBigInt64(0,BigInt(e.getTime()),!0),new Uint8Array(t)}if(\"INT64\"===r&&\"TIMESTAMP_MICROS\"===i&&e instanceof Date){const t=new ArrayBuffer(8);return new DataView(t).setBigInt64(0,BigInt(1e3*e.getTime()),!0),new Uint8Array(t)}if(\"INT64\"===r&&\"TIMESTAMP\"===t.logical_type?.type&&e instanceof Date){const n=BigInt(e.getTime()),{unit:r}=t.logical_type;let i=n;\"NANOS\"===r?i=1000000n*n:\"MICROS\"===r&&(i=1000n*n);const o=new ArrayBuffer(8);return new DataView(o).setBigInt64(0,i,!0),new Uint8Array(o)}throw new Error(`unsupported type for statistics: ${r} with value ${e}`)}function In({type:e,type_length:t},n){if(\"INT32\"===e)return Number(n);if(\"INT64\"===e)return n;if(\"FIXED_LEN_BYTE_ARRAY\"===e&&!t)throw new Error(\"fixed length byte array type_length is required\");if(!t&&!n)return new Uint8Array;const r=[];for(;;){const e=Number(0xffn&n);if(r.unshift(e),n>>=8n,t){if(r.length>=t)break}else{const t=128&e;if(!t&&0n===n||t&&-1n===n)break}}return new Uint8Array(r)}function bn(e){if(null==e)return;if(\"number\"!=typeof e)throw new Error(\"parquet float16 expected number value\");if(Number.isNaN(e))return new Uint8Array([0,126]);const t=e<0||Object.is(e,-0)?1:0,n=Math.abs(e);if(!isFinite(n))return new Uint8Array([0,t<<7|124]);if(0===n)return new Uint8Array([0,t<<7]);const r=new ArrayBuffer(4);new Float32Array(r)[0]=n;const i=new Uint32Array(r)[0];let o=i>>>23&255,f=8388607&i;if(o-=127,o<-14){f=(8388608|f)>>-14-o+13,1&f&&(f+=1);const e=t<<15|f;return new Uint8Array([255&e,e>>8])}if(o>15)return new Uint8Array([0,t<<7|124]);let a=o+15;if(f+=4096,8388608&f&&(f=0,31===++a))return new Uint8Array([0,t<<7|124]);const s=t<<15|a<<10|f>>13;return new Uint8Array([255&s,s>>8])}function Tn({writer:e,column:t,pageData:n}){const{columnName:r,element:i,schemaPath:o,stats:f,pageSize:a,encoding:s}=t,{type:l,type_length:u}=i;if(!l)throw new Error(`column ${r} cannot determine type`);const{values:c,definitionLevels:d,repetitionLevels:p,maxDefinitionLevel:_}=n,y=e.offset,h=[],m=\"GEOMETRY\"===i?.logical_type?.type||\"GEOGRAPHY\"===i?.logical_type?.type,g=f?Nn(c):void 0,w=f&&m?function(e){const t=new Set;let n,r;for(const r of e)if(null!=r){if(\"object\"!=typeof r)throw new Error(\"geospatial column expects GeoJSON geometries\");n=rn(n,r),t.add(an(r))}const{xmin:i,ymin:o,xmax:f,ymax:a}=n??{};if(void 0!==i&&void 0!==o&&void 0!==f&&void 0!==a&&(r={...n,xmin:i,ymin:o,xmax:f,ymax:a}),t.size||r)return{bbox:r,geospatial_types:t.size?Array.from(t).sort((e,t)=>e-t):[]}}(c):void 0;let A,E;if(t.bloomFilter){const e=\"object\"==typeof t.bloomFilter?t.bloomFilter:void 0,n=new ut(i,e);for(const e of c)n.insert(e);A=n.finalize()}const{dictionary:v,indexes:I}=function(e,t,n,r,i){if(r&&\"RLE_DICTIONARY\"!==r)return{};if(\"BOOLEAN\"===t)return{};const o=e.slice(0,1e3),f=new Set;for(const e of o)f.add(e instanceof Uint8Array?tn(e):e);if(0===f.size||f.size/o.length>.5)return{};const a=[],s=new Array(e.length),l=new Map,u=new Map;let c=0;for(let r=0;r<e.length;r++){const o=e[r];if(null==o)continue;let f;if(o instanceof Uint8Array){const e=tn(o),t=u.get(e);if(t)for(const e of t)if(nn(a[e],o)){f=e;break}if(void 0===f){if(c+=o.byteLength,i&&c>i)return{};f=a.length,a.push(o),t?t.push(f):u.set(e,[f])}}else if(f=l.get(o),void 0===f){if(c+=en(o,t,n),i&&c>i)return{};f=a.length,a.push(o),l.set(o,f)}s[r]=f}return{dictionary:a,indexes:s}}(c,l,u,s,a);let b,T,N=l;v&&I?(T=I,N=\"INT32\",b=\"RLE_DICTIONARY\",E=BigInt(e.offset),function(e,t,n){const{element:r,codec:i,compressors:o}=t,{type:f,type_length:a}=r;if(!f)throw new Error(`column ${t.columnName} cannot determine type`);const s=new qe;Tt(s,n,f,a);const l=s.getBytes(),u=o[i]?.(l)??l;Kt(e,{type:\"DICTIONARY_PAGE\",uncompressed_page_size:l.byteLength,compressed_page_size:u.byteLength,dictionary_page_header:{num_values:n.length,encoding:\"PLAIN\"}}),e.appendBytes(u)}(e,t,wn(i,v))):(T=wn(i,c),b=s??(\"BOOLEAN\"===l&&c.length>16?\"RLE\":\"PLAIN\")),h.push(b);const U=function(e,t,n,r){if(!r)return[{start:0,end:e.length}];const i=[];let o=0,f=0;for(let a=0;a<e.length;a++){const s=en(e[a],t,n);f+=s,f>=r&&a>o&&(i.push({start:o,end:a}),o=a,f=s)}return o<e.length&&i.push({start:o,end:e.length}),i}(T,N,u,a),L=t.columnIndex&&U.length>1?{null_pages:[],min_values:[],max_values:[],boundary_order:\"UNORDERED\",null_counts:[]}:void 0,O=t.offsetIndex&&U.length>1?{page_locations:[]}:void 0,B=BigInt(e.offset);let R,D,M,S=0n,x=0,P=!0,Y=!0;for(const{start:n,end:r}of U){const o=e.offset;if(Wt({writer:e,column:t,encoding:b,pageData:{values:T.slice(n,r),definitionLevels:d.slice(n,r),repetitionLevels:p.slice(n,r),maxDefinitionLevel:_}}),L){const e=c.slice(n,r),{min_value:t,max_value:o,null_count:f=0n}=Nn(e);L.null_pages.push(f===BigInt(r-n)),L.min_values.push(vn(t,i,!1)??new Uint8Array),L.max_values.push(vn(o,i,!0)??new Uint8Array),L.null_counts?.push(f),void 0!==R&&void 0!==t&&(R>t&&(P=!1),R<t&&(Y=!1)),void 0!==D&&void 0!==o&&(D>o&&(P=!1),D<o&&(Y=!1)),R=t,D=o}if(O){if(p.length)for(let e=x+1;e<=n;e++)0===p[e]&&S++;else S=BigInt(n);O.page_locations.push({offset:BigInt(o),compressed_page_size:e.offset-o,first_row_index:S})}x=n}return L&&(P?L.boundary_order=\"ASCENDING\":Y&&(L.boundary_order=\"DESCENDING\")),f&&(M=[],void 0!==E&&M.push({page_type:\"DICTIONARY_PAGE\",encoding:\"PLAIN\",count:1}),M.push({page_type:\"DATA_PAGE_V2\",encoding:b,count:U.length})),{chunk:{meta_data:{type:l,encodings:h,path_in_schema:o.slice(1).map(e=>e.name),codec:t.codec??\"UNCOMPRESSED\",num_values:BigInt(c.length),total_compressed_size:BigInt(e.offset-y),total_uncompressed_size:BigInt(e.offset-y),data_page_offset:B,dictionary_page_offset:E,statistics:g,encoding_stats:M,geospatial_statistics:w},file_offset:BigInt(y)},columnIndex:L,offsetIndex:O,bloomFilter:A}}function Nn(e){let t,n,r=0n;for(const i of e)null!=i?\"object\"!=typeof i&&(\"number\"==typeof i&&Number.isNaN(i)||((void 0===t||i<t)&&(t=i),(void 0===n||i>n)&&(n=i))):r++;return 0===t&&(t=-0),0===n&&(n=0),{min_value:t,max_value:n,null_count:r}}function Un(e,t){const n=e.map(e=>e.element);if(e.length<2)throw new Error(\"parquet schema path must include column\");const r=[],i=[],o=function(e){let t=0;for(const{element:n}of e.slice(1))\"REQUIRED\"!==n.repetition_type&&t++;return t}(e);if(2===e.length&&0===o)return{values:t,definitionLevels:r,repetitionLevels:i,maxDefinitionLevel:o};if(2===e.length&&1===o){const e=new Array(t.length);for(let n=0;n<t.length;n++)e[n]=null===t[n]||void 0===t[n]?0:1;return{values:t,definitionLevels:e,repetitionLevels:i,maxDefinitionLevel:o}}const f=new Array(e.length);let a=0;for(let t=0;t<e.length;t++)f[t]=a,\"REPEATED\"===n[t].repetition_type&&a++;const s=[];for(const e of t)l(1,e,0,0,!1);return{values:s,definitionLevels:r,repetitionLevels:i,maxDefinitionLevel:o};function l(t,o,a,c,d){const p=n[t],_=p.repetition_type||\"REQUIRED\";if(t===e.length-1){if(null==o){if(\"REQUIRED\"===_&&!d)throw new Error(\"parquet required value is undefined\");r.push(a)}else r.push(\"REQUIRED\"===_?a:a+1);return i.push(c),void s.push(o)}if(\"REPEATED\"===_){if(null==o){if(!d)throw new Error(\"parquet required value is undefined\");return void l(t+1,void 0,a,c,!0)}if(!Array.isArray(o))throw new Error(`parquet repeated field ${p.name} must be an array`);if(!o.length)return void l(t+1,void 0,a,c,!0);const r=Ze(e[t-1]),i=n[t+1];for(let e=0;e<o.length;e++){let n=o[e];r&&n&&\"object\"==typeof n&&i&&(n=n[i.name]),l(t+1,n,a+1,0===e?c:f[t]+1,!1)}return}if(\"OPTIONAL\"!==_)if(null==o){if(!d)throw new Error(\"parquet required value is undefined\");l(t+1,void 0,a,c,!0)}else l(t+1,u(t,o),a,c,!1);else if(null==o)l(t+1,void 0,a,c,!0);else{const n=u(t,o),r=null==n,i=ze(e[t])||Ze(e[t]);l(t+1,n,p.num_children&&!p.type&&!i||!r?a+1:a,c,r)}}function u(t,r){if(null==r)return;const i=n[t+1];if(i){if(ze(e[t]))return r;if(Ze(e[t]))return function(e,t){if(e instanceof Map)return Array.from(e.entries(),([e,t])=>({key:e,value:t}));if(Array.isArray(e))return e.map(e=>{if(e&&\"object\"==typeof e&&\"key\"in e&&\"value\"in e)return e;if(Array.isArray(e)&&2===e.length)return{key:e[0],value:e[1]};throw new Error(\"parquet map entry must provide key and value\")});if(\"object\"==typeof e)return Object.entries(e).map(([e,t])=>({key:e,value:t}));throw new Error(`parquet map field ${t.name} must be Map, array, or object`)}(r,n[t]);if(\"object\"==typeof r&&!Array.isArray(r))return r[i.name];throw new Error(`parquet expected struct, got ${r}`)}}}function Ln(e,t,n){if(!n||n.min_values.length<=1)return;const r=e.offset;ot(e,{field_1:n.null_pages,field_2:n.min_values,field_3:n.max_values,field_4:gt.indexOf(n.boundary_order),field_5:n.null_counts}),t.column_index_offset=BigInt(r),t.column_index_length=e.offset-r}function On(e,t,n){if(!n||n.page_locations.length<=1)return;const r=e.offset;ot(e,{field_1:n.page_locations.map(e=>({field_1:e.offset,field_2:e.compressed_page_size,field_3:e.first_row_index}))}),t.offset_index_offset=BigInt(r),t.offset_index_length=e.offset-r}function Bn(e,t){const n=Ve(e,t);return n[n.length-1].element}function Rn(e){if(e)return\"STRING\"===e.type?{field_1:{}}:\"MAP\"===e.type?{field_2:{}}:\"LIST\"===e.type?{field_3:{}}:\"ENUM\"===e.type?{field_4:{}}:\"DECIMAL\"===e.type?{field_5:{field_1:e.scale,field_2:e.precision}}:\"DATE\"===e.type?{field_6:{}}:\"TIME\"===e.type?{field_7:{field_1:e.isAdjustedToUTC,field_2:Dn(e.unit)}}:\"TIMESTAMP\"===e.type?{field_8:{field_1:e.isAdjustedToUTC,field_2:Dn(e.unit)}}:\"INTEGER\"===e.type?{field_10:{field_1:e.bitWidth,field_2:e.isSigned}}:\"NULL\"===e.type?{field_11:{}}:\"JSON\"===e.type?{field_12:{}}:\"BSON\"===e.type?{field_13:{}}:\"UUID\"===e.type?{field_14:{}}:\"FLOAT16\"===e.type?{field_15:{}}:\"VARIANT\"===e.type?{field_16:{}}:\"GEOMETRY\"===e.type?{field_17:{field_1:e.crs}}:\"GEOGRAPHY\"===e.type?{field_18:{field_1:e.crs,field_2:e.algorithm&&wt.indexOf(e.algorithm)}}:void 0}function Dn(e){return\"NANOS\"===e?{field_3:{}}:\"MICROS\"===e?{field_2:{}}:{field_1:{}}}const Mn=new Array(15);function Sn(e){const t=new qe;t.appendVarInt(e.length);let n=0;for(;n<e.length;){const r=Math.min(e.length-n,65536);Cn(t,e,n,r),n+=r}return t.getBytes()}function xn(e,t){return 506832829*e>>>t}function Pn(e,t){return e[t]+(e[t+1]<<8)+(e[t+2]<<16)+(e[t+3]<<24)}function Yn(e,t,n){return e[t]===e[n]&&e[t+1]===e[n+1]&&e[t+2]===e[n+2]&&e[t+3]===e[n+3]}function Fn(e,t,n,r){r<=60?e.appendUint8(r-1<<2):r<256?(e.appendUint8(240),e.appendUint8(r-1)):(e.appendUint8(244),e.appendUint8(r-1&255),e.appendUint8(r-1>>>8)),e.appendBytes(t.subarray(n,n+r))}function $n(e,t,n){n<12&&t<2048?(e.appendUint8(1+(n-4<<2)+(t>>>8<<5)),e.appendUint8(255&t)):(e.appendUint8(2+(n-1<<2)),e.appendUint8(255&t),e.appendUint8(t>>>8))}function kn(e,t,n){for(;n>=68;)$n(e,t,64),n-=64;n>64&&($n(e,t,60),n-=60),$n(e,t,n)}function Cn(e,t,n,r){let i=1;for(;1<<i<=r&&i<=14;)i++;i--;const o=32-i;Mn[i]??=new Uint16Array(1<<i);const f=Mn[i];f.fill(0);const a=n+r;let s;const l=n;let u,c,d,p,_,y,h,m,g,w,A,E=n,v=!0;if(r>=15)for(s=a-15,c=xn(Pn(t,++n),o);v;){_=32,d=n;do{if(u=c,y=_>>>5,_++,d=(n=d)+y,n>s){v=!1;break}c=xn(Pn(t,d),o),p=l+f[u],f[u]=n-l}while(!Yn(t,n,p));if(!v)break;Fn(e,t,E,n-E);do{for(h=n,m=4;n+m<a&&t[n+m]===t[p+m];)m++;if(n+=m,g=h-p,kn(e,g,m),E=n,n>=s){v=!1;break}w=xn(Pn(t,n-1),o),f[w]=n-1-l,A=xn(Pn(t,n),o),p=l+f[A],f[A]=n-l}while(Yn(t,n,p));if(!v)break;c=xn(Pn(t,++n),o)}E<a&&Fn(e,t,E,a-E)}function Gn({writer:e,schema:t,codec:n=\"SNAPPY\",compressors:r,statistics:i=!0,kvMetadata:o}){this.writer=e,this.schema=t,this.codec=n,this.compressors={SNAPPY:Sn,...r},this.statistics=i,this.kvMetadata=o,this.row_groups=[],this.num_rows=0n,this.pendingIndexes=[],this.writer.appendUint32(827474256)}function qn(e,t){return Array.isArray(e)?e[Math.min(t,e.length-1)]:e}function jn({columnDataRows:e,rowGroupSize:t}){if(Array.isArray(t)&&!t.length)throw new Error(\"rowGroupSize array cannot be empty\");const n=[];let r=0,i=0;for(;i<e;){const o=qn(t,r);n.push({groupStartIndex:i,groupSize:Math.min(o,e-i)}),i+=o,r++}return n}function Vn(e){const t=[];return function e(n){const r=n[n.length-1];if(r.children.length)for(const t of r.children)e([...n,t]);else t.push(n)}(e),t}function zn(e){const t=new qe;return function({writer:e,columnData:t,schema:n,codec:r=\"SNAPPY\",compressors:i,statistics:o=!0,rowGroupSize:f=[1e3,1e5],kvMetadata:a,pageSize:s=1048576}){if(t=t.map(e=>{if(!0===e.shredding&&\"VARIANT\"===e.type){const t=xt(Array.from(e.data));return t?{...e,shredding:t}:{...e,shredding:void 0}}if(void 0!==e.shredding&&!0!==e.shredding&&\"VARIANT\"===e.type){const t=$t(e.shredding);return t?{...e,shredding:t}:{...e,shredding:void 0}}return e}),n){if(t.some(({type:e})=>e))throw new Error(\"cannot provide both schema and columnData type\")}else n=zt({columnData:t});const l=new Gn({writer:e,schema:n,codec:r,compressors:i,statistics:o,kvMetadata:a}),u=l.write({columnData:t,rowGroupSize:f,pageSize:s});u?u.then(()=>l.finish()):l.finish()}({...e,writer:t}),t.getBuffer()}Gn.prototype.write=function({columnData:e,rowGroupSize:t=[1e3,1e5],pageSize:n=1048576}){const r=e[0]?.data?.length||0;let i;for(const{groupStartIndex:o,groupSize:f}of jn({columnDataRows:r,rowGroupSize:t})){const t=()=>{const t=this.writer.offset,i=[];for(let t=0;t<e.length;t++){const{name:a,data:s,encoding:l,codec:u=this.codec,columnIndex:c=!1,offsetIndex:d=!0,shredding:p,bloomFilter:_}=e[t];if(c&&!d)throw new Error(\"parquet ColumnIndex cannot be present without OffsetIndex\");if(s.length!==r)throw new Error(\"parquet columns must have the same length\");const y=s.slice(o,o+f),h=Ve(this.schema,[a]),m=Vn(h),g=h.at(-1)?.element,w=p&&!0!==p?p:void 0,A=\"VARIANT\"===g?.logical_type?.type,E=\"REQUIRED\"===g?.repetition_type,v=A?Mt(Array.from(y),w,{name:a,required:E}):y;for(const e of m){const t=e.map(e=>e.element),r={columnName:t.slice(1).map(e=>e.name).join(\".\"),element:t[t.length-1],schemaPath:t,codec:u,compressors:this.compressors,stats:this.statistics,pageSize:n,columnIndex:c,offsetIndex:d,encoding:l,bloomFilter:_},o=Un(e,v),f=Tn({writer:this.writer,column:r,pageData:o});i.push(f.chunk),this.pendingIndexes.push(f)}}return this.num_rows+=BigInt(f),this.row_groups.push({columns:i,total_byte_size:BigInt(this.writer.offset-t),num_rows:BigInt(f)}),this.writer.flush?.()};if(i)i=i.then(t);else{const e=t();e&&(i=Promise.resolve(e))}}return i},Gn.prototype.finish=function(){!function(e,t){for(const{chunk:n,columnIndex:r}of t)Ln(e,n,r);for(const{chunk:n,offsetIndex:r}of t)On(e,n,r)}(this.writer,this.pendingIndexes),function(e,t){for(const{chunk:n,bloomFilter:r}of t){if(!r||!n.meta_data)continue;const t=e.offset;ct(e,r),n.meta_data.bloom_filter_offset=BigInt(t),n.meta_data.bloom_filter_length=e.offset-t}}(this.writer,this.pendingIndexes);const e={version:2,created_by:\"hyparquet\",schema:this.schema,num_rows:this.num_rows,row_groups:this.row_groups,metadata_length:0,key_value_metadata:this.kvMetadata};return delete e.metadata_length,function(e,t){const n={field_1:t.version,field_2:t.schema.map(e=>({field_1:e.type&&dt.indexOf(e.type),field_2:e.type_length,field_3:e.repetition_type&&_t.indexOf(e.repetition_type),field_4:e.name,field_5:e.num_children,field_6:e.converted_type&&yt.indexOf(e.converted_type),field_7:e.scale,field_8:e.precision,field_9:e.field_id,field_10:Rn(e.logical_type)})),field_3:t.num_rows,field_4:t.row_groups.map(e=>({field_1:e.columns.map(e=>{return{field_1:e.file_path,field_2:e.file_offset,field_3:e.meta_data&&{field_1:dt.indexOf(e.meta_data.type),field_2:e.meta_data.encodings.map(e=>pt.indexOf(e)),field_3:e.meta_data.path_in_schema,field_4:ht.indexOf(e.meta_data.codec),field_5:e.meta_data.num_values,field_6:e.meta_data.total_uncompressed_size,field_7:e.meta_data.total_compressed_size,field_8:e.meta_data.key_value_metadata&&e.meta_data.key_value_metadata.map(e=>({field_1:e.key,field_2:e.value})),field_9:e.meta_data.data_page_offset,field_10:e.meta_data.index_page_offset,field_11:e.meta_data.dictionary_page_offset,field_12:e.meta_data.statistics&&(n=e.meta_data.statistics,r=Bn(t.schema,e.meta_data.path_in_schema),{field_1:vn(n.max,r,!0),field_2:vn(n.min,r,!1),field_3:n.null_count,field_4:n.distinct_count,field_5:vn(n.max_value,r,!0),field_6:vn(n.min_value,r,!1),field_7:n.is_max_value_exact??En(n.max_value??n.max,r),field_8:n.is_min_value_exact??En(n.min_value??n.min,r)}),field_13:e.meta_data.encoding_stats&&e.meta_data.encoding_stats.map(e=>({field_1:mt.indexOf(e.page_type),field_2:pt.indexOf(e.encoding),field_3:e.count})),field_14:e.meta_data.bloom_filter_offset,field_15:e.meta_data.bloom_filter_length,field_16:e.meta_data.size_statistics&&{field_1:e.meta_data.size_statistics.unencoded_byte_array_data_bytes,field_2:e.meta_data.size_statistics.repetition_level_histogram,field_3:e.meta_data.size_statistics.definition_level_histogram},field_17:e.meta_data.geospatial_statistics&&{field_1:e.meta_data.geospatial_statistics.bbox&&{field_1:e.meta_data.geospatial_statistics.bbox.xmin,field_2:e.meta_data.geospatial_statistics.bbox.xmax,field_3:e.meta_data.geospatial_statistics.bbox.ymin,field_4:e.meta_data.geospatial_statistics.bbox.ymax,field_5:e.meta_data.geospatial_statistics.bbox.zmin,field_6:e.meta_data.geospatial_statistics.bbox.zmax,field_7:e.meta_data.geospatial_statistics.bbox.mmin,field_8:e.meta_data.geospatial_statistics.bbox.mmax},field_2:e.meta_data.geospatial_statistics.geospatial_types}},field_4:e.offset_index_offset,field_5:e.offset_index_length,field_6:e.column_index_offset,field_7:e.column_index_length,field_9:e.encrypted_column_metadata};var n,r}),field_2:e.total_byte_size,field_3:e.num_rows,field_4:e.sorting_columns&&e.sorting_columns.map(e=>({field_1:e.column_idx,field_2:e.descending,field_3:e.nulls_first})),field_5:e.file_offset,field_6:e.total_compressed_size})),field_5:t.key_value_metadata&&t.key_value_metadata.map(e=>({field_1:e.key,field_2:e.value})),field_6:t.created_by},r=e.offset;ot(e,n);const i=e.offset-r;e.appendUint32(i)}(this.writer,e),this.writer.appendUint32(827474256),this.writer.finish()};var Zn=Uint8Array,Xn=Uint16Array,Hn=Int32Array,Jn=new Zn([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Qn=new Zn([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Wn=new Zn([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Kn=function(e,t){for(var n=new Xn(31),r=0;r<31;++r)n[r]=t+=1<<e[r-1];var i=new Hn(n[30]);for(r=1;r<30;++r)for(var o=n[r];o<n[r+1];++o)i[o]=o-n[r]<<5|r;return{b:n,r:i}},er=Kn(Jn,2),tr=er.b,nr=er.r;tr[28]=258,nr[258]=28;for(var rr=Kn(Qn,0),ir=rr.b,or=rr.r,fr=new Xn(32768),ar=0;ar<32768;++ar){var sr=(43690&ar)>>1|(21845&ar)<<1;sr=(61680&(sr=(52428&sr)>>2|(13107&sr)<<2))>>4|(3855&sr)<<4,fr[ar]=((65280&sr)>>8|(255&sr)<<8)>>1}var lr=function(e,t,n){for(var r=e.length,i=0,o=new Xn(t);i<r;++i)e[i]&&++o[e[i]-1];var f,a=new Xn(t);for(i=1;i<t;++i)a[i]=a[i-1]+o[i-1]<<1;if(n){f=new Xn(1<<t);var s=15-t;for(i=0;i<r;++i)if(e[i])for(var l=i<<4|e[i],u=t-e[i],c=a[e[i]-1]++<<u,d=c|(1<<u)-1;c<=d;++c)f[fr[c]>>s]=l}else for(f=new Xn(r),i=0;i<r;++i)e[i]&&(f[i]=fr[a[e[i]-1]++]>>15-e[i]);return f},ur=new Zn(288);for(ar=0;ar<144;++ar)ur[ar]=8;for(ar=144;ar<256;++ar)ur[ar]=9;for(ar=256;ar<280;++ar)ur[ar]=7;for(ar=280;ar<288;++ar)ur[ar]=8;var cr=new Zn(32);for(ar=0;ar<32;++ar)cr[ar]=5;var dr=lr(ur,9,0),pr=lr(ur,9,1),_r=lr(cr,5,0),yr=lr(cr,5,1),hr=function(e){for(var t=e[0],n=1;n<e.length;++n)e[n]>t&&(t=e[n]);return t},mr=function(e,t,n){var r=t/8|0;return(e[r]|e[r+1]<<8)>>(7&t)&n},gr=function(e,t){var n=t/8|0;return(e[n]|e[n+1]<<8|e[n+2]<<16)>>(7&t)},wr=function(e){return(e+7)/8|0},Ar=function(e,t,n){return(null==n||n>e.length)&&(n=e.length),new Zn(e.subarray(t,n))},Er=[\"unexpected EOF\",\"invalid block type\",\"invalid length/literal\",\"invalid distance\",\"stream finished\",\"no stream handler\",,\"no callback\",\"invalid UTF-8 data\",\"extra field too long\",\"date not in range 1980-2099\",\"filename too long\",\"stream finishing\",\"invalid zip data\"],vr=function(e,t,n){var r=new Error(t||Er[e]);if(r.code=e,Error.captureStackTrace&&Error.captureStackTrace(r,vr),!n)throw r;return r},Ir=function(e,t,n){n<<=7&t;var r=t/8|0;e[r]|=n,e[r+1]|=n>>8},br=function(e,t,n){n<<=7&t;var r=t/8|0;e[r]|=n,e[r+1]|=n>>8,e[r+2]|=n>>16},Tr=function(e,t){for(var n=[],r=0;r<e.length;++r)e[r]&&n.push({s:r,f:e[r]});var i=n.length,o=n.slice();if(!i)return{t:Dr,l:0};if(1==i){var f=new Zn(n[0].s+1);return f[n[0].s]=1,{t:f,l:1}}n.sort(function(e,t){return e.f-t.f}),n.push({s:-1,f:25001});var a=n[0],s=n[1],l=0,u=1,c=2;for(n[0]={s:-1,f:a.f+s.f,l:a,r:s};u!=i-1;)a=n[n[l].f<n[c].f?l++:c++],s=n[l!=u&&n[l].f<n[c].f?l++:c++],n[u++]={s:-1,f:a.f+s.f,l:a,r:s};var d=o[0].s;for(r=1;r<i;++r)o[r].s>d&&(d=o[r].s);var p=new Xn(d+1),_=Nr(n[u-1],p,0);if(_>t){r=0;var y=0,h=_-t,m=1<<h;for(o.sort(function(e,t){return p[t.s]-p[e.s]||e.f-t.f});r<i;++r){var g=o[r].s;if(!(p[g]>t))break;y+=m-(1<<_-p[g]),p[g]=t}for(y>>=h;y>0;){var w=o[r].s;p[w]<t?y-=1<<t-p[w]++-1:++r}for(;r>=0&&y;--r){var A=o[r].s;p[A]==t&&(--p[A],++y)}_=t}return{t:new Zn(p),l:_}},Nr=function(e,t,n){return-1==e.s?Math.max(Nr(e.l,t,n+1),Nr(e.r,t,n+1)):t[e.s]=n},Ur=function(e){for(var t=e.length;t&&!e[--t];);for(var n=new Xn(++t),r=0,i=e[0],o=1,f=function(e){n[r++]=e},a=1;a<=t;++a)if(e[a]==i&&a!=t)++o;else{if(!i&&o>2){for(;o>138;o-=138)f(32754);o>2&&(f(o>10?o-11<<5|28690:o-3<<5|12305),o=0)}else if(o>3){for(f(i),--o;o>6;o-=6)f(8304);o>2&&(f(o-3<<5|8208),o=0)}for(;o--;)f(i);o=1,i=e[a]}return{c:n.subarray(0,r),n:t}},Lr=function(e,t){for(var n=0,r=0;r<t.length;++r)n+=e[r]*t[r];return n},Or=function(e,t,n){var r=n.length,i=wr(t+2);e[i]=255&r,e[i+1]=r>>8,e[i+2]=255^e[i],e[i+3]=255^e[i+1];for(var o=0;o<r;++o)e[i+o+4]=n[o];return 8*(i+4+r)},Br=function(e,t,n,r,i,o,f,a,s,l,u){Ir(t,u++,n),++i[256];for(var c=Tr(i,15),d=c.t,p=c.l,_=Tr(o,15),y=_.t,h=_.l,m=Ur(d),g=m.c,w=m.n,A=Ur(y),E=A.c,v=A.n,I=new Xn(19),b=0;b<g.length;++b)++I[31&g[b]];for(b=0;b<E.length;++b)++I[31&E[b]];for(var T=Tr(I,7),N=T.t,U=T.l,L=19;L>4&&!N[Wn[L-1]];--L);var O,B,R,D,M=l+5<<3,S=Lr(i,ur)+Lr(o,cr)+f,x=Lr(i,d)+Lr(o,y)+f+14+3*L+Lr(I,N)+2*I[16]+3*I[17]+7*I[18];if(s>=0&&M<=S&&M<=x)return Or(t,u,e.subarray(s,s+l));if(Ir(t,u,1+(x<S)),u+=2,x<S){O=lr(d,p,0),B=d,R=lr(y,h,0),D=y;var P=lr(N,U,0);for(Ir(t,u,w-257),Ir(t,u+5,v-1),Ir(t,u+10,L-4),u+=14,b=0;b<L;++b)Ir(t,u+3*b,N[Wn[b]]);u+=3*L;for(var Y=[g,E],F=0;F<2;++F){var $=Y[F];for(b=0;b<$.length;++b){var k=31&$[b];Ir(t,u,P[k]),u+=N[k],k>15&&(Ir(t,u,$[b]>>5&127),u+=$[b]>>12)}}}else O=dr,B=ur,R=_r,D=cr;for(b=0;b<a;++b){var C=r[b];if(C>255){br(t,u,O[257+(k=C>>18&31)]),u+=B[k+257],k>7&&(Ir(t,u,C>>23&31),u+=Jn[k]);var G=31&C;br(t,u,R[G]),u+=D[G],G>3&&(br(t,u,C>>5&8191),u+=Qn[G])}else br(t,u,O[C]),u+=B[C]}return br(t,u,O[256]),u+B[256]},Rr=new Hn([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),Dr=new Zn(0),Mr=function(){for(var e=new Int32Array(256),t=0;t<256;++t){for(var n=t,r=9;--r;)n=(1&n&&-306674912)^n>>>1;e[t]=n}return e}(),Sr=function(e,t,n){for(;n;++t)e[t]=n,n>>>=8};function xr(e,t){t||(t={});var n=function(){var e=-1;return{p:function(t){for(var n=e,r=0;r<t.length;++r)n=Mr[255&n^t[r]]^n>>>8;e=n},d:function(){return~e}}}(),r=e.length;n.p(e);var i,o=function(e,t,n,r,i){if(!i&&(i={l:1},t.dictionary)){var o=t.dictionary.subarray(-32768),f=new Zn(o.length+e.length);f.set(o),f.set(e,o.length),e=f,i.w=o.length}return function(e,t,n,r,i,o){var f=o.z||e.length,a=new Zn(r+f+5*(1+Math.ceil(f/7e3))+i),s=a.subarray(r,a.length-i),l=o.l,u=7&(o.r||0);if(t){u&&(s[0]=o.r>>3);for(var c=Rr[t-1],d=c>>13,p=8191&c,_=(1<<n)-1,y=o.p||new Xn(32768),h=o.h||new Xn(_+1),m=Math.ceil(n/3),g=2*m,w=function(t){return(e[t]^e[t+1]<<m^e[t+2]<<g)&_},A=new Hn(25e3),E=new Xn(288),v=new Xn(32),I=0,b=0,T=o.i||0,N=0,U=o.w||0,L=0;T+2<f;++T){var O=w(T),B=32767&T,R=h[O];if(y[B]=R,h[O]=B,U<=T){var D=f-T;if((I>7e3||N>24576)&&(D>423||!l)){u=Br(e,s,0,A,E,v,b,N,L,T-L,u),N=I=b=0,L=T;for(var M=0;M<286;++M)E[M]=0;for(M=0;M<30;++M)v[M]=0}var S=2,x=0,P=p,Y=B-R&32767;if(D>2&&O==w(T-Y))for(var F=Math.min(d,D)-1,$=Math.min(32767,T),k=Math.min(258,D);Y<=$&&--P&&B!=R;){if(e[T+S]==e[T+S-Y]){for(var C=0;C<k&&e[T+C]==e[T+C-Y];++C);if(C>S){if(S=C,x=Y,C>F)break;var G=Math.min(Y,C-2),q=0;for(M=0;M<G;++M){var j=T-Y+M&32767,V=j-y[j]&32767;V>q&&(q=V,R=j)}}}Y+=(B=R)-(R=y[B])&32767}if(x){A[N++]=268435456|nr[S]<<18|or[x];var z=31&nr[S],Z=31&or[x];b+=Jn[z]+Qn[Z],++E[257+z],++v[Z],U=T+S,++I}else A[N++]=e[T],++E[e[T]]}}for(T=Math.max(T,U);T<f;++T)A[N++]=e[T],++E[e[T]];u=Br(e,s,l,A,E,v,b,N,L,T-L,u),l||(o.r=7&u|s[u/8|0]<<3,u-=7,o.h=h,o.p=y,o.i=T,o.w=U)}else{for(T=o.w||0;T<f+l;T+=65535){var X=T+65535;X>=f&&(s[u/8|0]=l,X=f),u=Or(s,u+1,e.subarray(T,X))}o.i=f}return Ar(a,0,r+wr(u)+i)}(e,null==t.level?6:t.level,null==t.mem?i.l?Math.ceil(1.5*Math.max(8,Math.min(13,Math.log(e.length)))):20:12+t.mem,n,r,i)}(e,t,10+((i=t).filename?i.filename.length+1:0),8),f=o.length;return function(e,t){var n=t.filename;if(e[0]=31,e[1]=139,e[2]=8,e[8]=t.level<2?4:9==t.level?2:0,e[9]=3,0!=t.mtime&&Sr(e,4,Math.floor(new Date(t.mtime||Date.now())/1e3)),n){e[3]=8;for(var r=0;r<=n.length;++r)e[r+10]=n.charCodeAt(r)}}(o,t),Sr(o,f-8,n.d()),Sr(o,f-4,r),o}var Pr=\"undefined\"!=typeof TextDecoder&&new TextDecoder;try{Pr.decode(Dr,{stream:!0})}catch(e){}var Yr=ArrayBuffer,Fr=Uint8Array,$r=Uint16Array,kr=Int16Array,Cr=Int32Array,Gr=function(e,t,n){if(Fr.prototype.slice)return Fr.prototype.slice.call(e,t,n);(null==t||t<0)&&(t=0),(null==n||n>e.length)&&(n=e.length);var r=new Fr(n-t);return r.set(e.subarray(t,n)),r},qr=function(e,t,n,r){if(Fr.prototype.fill)return Fr.prototype.fill.call(e,t,n,r);for((null==n||n<0)&&(n=0),(null==r||r>e.length)&&(r=e.length);n<r;++n)e[n]=t;return e},jr=function(e,t,n,r){if(Fr.prototype.copyWithin)return Fr.prototype.copyWithin.call(e,t,n,r);for((null==n||n<0)&&(n=0),(null==r||r>e.length)&&(r=e.length);n<r;)e[t++]=e[n++]},Vr=[\"invalid zstd data\",\"window size too large (>2046MB)\",\"invalid block type\",\"FSE accuracy too high\",\"match distance too far back\",\"unexpected EOF\"],zr=function(e,t,n){var r=new Error(t||Vr[e]);if(r.code=e,Error.captureStackTrace&&Error.captureStackTrace(r,zr),!n)throw r;return r},Zr=function(e,t,n){for(var r=0,i=0;r<n;++r)i|=e[t++]<<(r<<3);return i},Xr=function(e,t){var n,r=e[0]|e[1]<<8|e[2]<<16;if(3126568==r&&253==e[3]){var i=e[4],o=i>>5&1,f=i>>2&1,a=3&i,s=i>>6;8&i&&zr(0);var l=6-o,u=3==a?4:a,c=Zr(e,l,u),d=s?1<<s:o,p=Zr(e,l+=u,d)+(1==s&&256),_=p;if(!o){var y=1<<10+(e[5]>>3);_=y+(y>>3)*(7&e[5])}_>2145386496&&zr(1);var h=new Fr((1==t?p||_:t?0:_)+12);return h[0]=1,h[4]=4,h[8]=8,{b:l+d,y:0,l:0,d:c,w:t&&1!=t?t:h.subarray(12),e:_,o:new Cr(h.buffer,0,3),u:p,c:f,m:Math.min(131072,_)}}if(25481893==(r>>4|e[3]<<20))return(((n=e)[4]|n[5]<<8|n[6]<<16|n[7]<<24)>>>0)+8;zr(0)},Hr=function(e){for(var t=0;1<<t<=e;++t);return t-1},Jr=function(e,t,n){var r=4+(t<<3),i=5+(15&e[t]);i>n&&zr(3);for(var o=1<<i,f=o,a=-1,s=-1,l=-1,u=o,c=new Yr(512+(o<<2)),d=new kr(c,0,256),p=new $r(c,0,256),_=new $r(c,512,o),y=512+(o<<1),h=new Fr(c,y,o),m=new Fr(c,y+o);a<255&&f>0;){var g=Hr(f+1),w=r>>3,A=(1<<g+1)-1,E=(e[w]|e[w+1]<<8|e[w+2]<<16)>>(7&r)&A,v=(1<<g)-1,I=A-f-1,b=E&v;if(b<I?(r+=g,E=b):(r+=g+1,E>v&&(E-=I)),d[++a]=--E,-1==E?(f+=E,h[--u]=a):f-=E,!E)do{var T=r>>3;s=(e[T]|e[T+1]<<8)>>(7&r)&3,r+=2,a+=s}while(3==s)}(a>255||f)&&zr(0);for(var N=0,U=(o>>1)+(o>>3)+3,L=o-1,O=0;O<=a;++O){var B=d[O];if(B<1)p[O]=-B;else for(l=0;l<B;++l){h[N]=O;do{N=N+U&L}while(N>=u)}}for(N&&zr(0),l=0;l<o;++l){var R=p[h[l]]++,D=m[l]=i-Hr(R);_[l]=(R<<D)-o}return[r+7>>3,{b:i,s:h,n:m,t:_}]},Qr=Jr(new Fr([81,16,99,140,49,198,24,99,12,33,196,24,99,102,102,134,70,146,4]),0,6)[1],Wr=Jr(new Fr([33,20,196,24,99,140,33,132,16,66,8,33,132,16,66,8,33,68,68,68,68,68,68,68,68,36,9]),0,6)[1],Kr=Jr(new Fr([32,132,16,66,102,70,68,68,68,68,36,73,2]),0,5)[1],ei=function(e,t){for(var n=e.length,r=new Cr(n),i=0;i<n;++i)r[i]=t,t+=1<<e[i];return r},ti=new Fr(new Cr([0,0,0,0,16843009,50528770,134678020,202050057,269422093]).buffer,0,36),ni=ei(ti,0),ri=new Fr(new Cr([0,0,0,0,0,0,0,0,16843009,50528770,117769220,185207048,252579084,16]).buffer,0,53),ii=ei(ri,3),oi=function(e,t,n){var r=e.length,i=t.length,o=e[r-1],f=(1<<n.b)-1,a=-n.b;o||zr(0);for(var s=0,l=n.b,u=(r<<3)-8+Hr(o)-l,c=-1;u>a&&c<i;){var d=u>>3;s=(s<<l|(e[d]|e[d+1]<<8|e[d+2]<<16)>>(7&u))&f,t[++c]=n.s[s],u-=l=n.n[s]}u==a&&c+1==i||zr(0)},fi=function(e,t,n){var r=6,i=t.length+3>>2,o=i<<1,f=i+o;oi(e.subarray(r,r+=e[0]|e[1]<<8),t.subarray(0,i),n),oi(e.subarray(r,r+=e[2]|e[3]<<8),t.subarray(i,o),n),oi(e.subarray(r,r+=e[4]|e[5]<<8),t.subarray(o,f),n),oi(e.subarray(r),t.subarray(f),n)},ai=function(e,t,n){var r,i=t.b,o=e[i],f=o>>1&3;t.l=1&o;var a=o>>3|e[i+1]<<5|e[i+2]<<13,s=(i+=3)+a;if(1==f){if(i>=e.length)return;return t.b=i+1,n?(qr(n,e[i],t.y,t.y+=a),n):qr(new Fr(a),e[i])}if(!(s>e.length)){if(0==f)return t.b=s,n?(n.set(e.subarray(i,s),t.y),t.y+=a,n):Gr(e,i,s);if(2==f){var l=e[i],u=3&l,c=l>>2&3,d=l>>4,p=0,_=0;u<2?1&c?d|=e[++i]<<4|(2&c&&e[++i]<<12):d=l>>3:(_=c,c<2?(d|=(63&e[++i])<<4,p=e[i]>>6|e[++i]<<2):2==c?(d|=e[++i]<<4|(3&e[++i])<<12,p=e[i]>>2|e[++i]<<6):(d|=e[++i]<<4|(63&e[++i])<<12,p=e[i]>>6|e[++i]<<2|e[++i]<<10)),++i;var y=n?n.subarray(t.y,t.y+t.m):new Fr(t.m),h=y.length-d;if(0==u)y.set(e.subarray(i,i+=d),h);else if(1==u)qr(y,e[i++],h);else{var m=t.h;if(2==u){var g=function(e,t){var n=0,r=-1,i=new Fr(292),o=e[t],f=i.subarray(0,256),a=i.subarray(256,268),s=new $r(i.buffer,268);if(o<128){var l=Jr(e,t+1,6),u=l[0],c=l[1],d=u<<3,p=e[t+=o];p||zr(0);for(var _=0,y=0,h=c.b,m=h,g=(++t<<3)-8+Hr(p);!((g-=h)<d);){var w=g>>3;if(_+=(e[w]|e[w+1]<<8)>>(7&g)&(1<<h)-1,f[++r]=c.s[_],(g-=m)<d)break;y+=(e[w=g>>3]|e[w+1]<<8)>>(7&g)&(1<<m)-1,f[++r]=c.s[y],h=c.n[_],_=c.t[_],m=c.n[y],y=c.t[y]}++r>255&&zr(0)}else{for(r=o-127;n<r;n+=2){var A=e[++t];f[n]=A>>4,f[n+1]=15&A}++t}var E=0;for(n=0;n<r;++n)(T=f[n])>11&&zr(0),E+=T&&1<<T-1;var v=Hr(E)+1,I=1<<v,b=I-E;for(b&b-1&&zr(0),f[r++]=Hr(b)+1,n=0;n<r;++n){var T=f[n];++a[f[n]=T&&v+1-T]}var N=new Fr(I<<1),U=N.subarray(0,I),L=N.subarray(I);for(s[v]=0,n=v;n>0;--n){var O=s[n];qr(L,n,O,s[n-1]=O+a[n]*(1<<v-n))}for(s[0]!=I&&zr(0),n=0;n<r;++n){var B=f[n];if(B){var R=s[B];qr(U,n,R,s[B]=R+(1<<v-B))}}return[t,{n:L,b:v,s:U}]}(e,i);p+=i-(i=g[0]),t.h=m=g[1]}else m||zr(0);(_?fi:oi)(e.subarray(i,i+=p),y.subarray(h),m)}var w=e[i++];if(w){255==w?w=32512+(e[i++]|e[i++]<<8):w>127&&(w=w-128<<8|e[i++]);var A=e[i++];3&A&&zr(0);for(var E=[Wr,Kr,Qr],v=2;v>-1;--v){var I=A>>2+(v<<1)&3;if(1==I){var b=new Fr([0,0,e[i++]]);E[v]={s:b.subarray(2,3),n:b.subarray(0,1),t:new $r(b.buffer,0,1),b:0}}else 2==I?(i=(r=Jr(e,i,9-(1&v)))[0],E[v]=r[1]):3==I&&(t.t||zr(0),E[v]=t.t[v])}var T=t.t=E,N=T[0],U=T[1],L=T[2],O=e[s-1];O||zr(0);var B=(s<<3)-8+Hr(O)-L.b,R=B>>3,D=0,M=(e[R]|e[R+1]<<8)>>(7&B)&(1<<L.b)-1,S=(e[R=(B-=U.b)>>3]|e[R+1]<<8)>>(7&B)&(1<<U.b)-1,x=(e[R=(B-=N.b)>>3]|e[R+1]<<8)>>(7&B)&(1<<N.b)-1;for(++w;--w;){var P=L.s[M],Y=L.n[M],F=N.s[x],$=N.n[x],k=U.s[S],C=U.n[S],G=1<<k,q=G+((e[R=(B-=k)>>3]|e[R+1]<<8|e[R+2]<<16|e[R+3]<<24)>>>(7&B)&G-1);R=(B-=ri[F])>>3;var j=ii[F]+((e[R]|e[R+1]<<8|e[R+2]<<16)>>(7&B)&(1<<ri[F])-1);R=(B-=ti[P])>>3;var V=ni[P]+((e[R]|e[R+1]<<8|e[R+2]<<16)>>(7&B)&(1<<ti[P])-1);if(R=(B-=Y)>>3,M=L.t[M]+((e[R]|e[R+1]<<8)>>(7&B)&(1<<Y)-1),R=(B-=$)>>3,x=N.t[x]+((e[R]|e[R+1]<<8)>>(7&B)&(1<<$)-1),R=(B-=C)>>3,S=U.t[S]+((e[R]|e[R+1]<<8)>>(7&B)&(1<<C)-1),q>3)t.o[2]=t.o[1],t.o[1]=t.o[0],t.o[0]=q-=3;else{var z=q-(0!=V);z?(q=3==z?t.o[0]-1:t.o[z],z>1&&(t.o[2]=t.o[1]),t.o[1]=t.o[0],t.o[0]=q):q=t.o[0]}for(v=0;v<V;++v)y[D+v]=y[h+v];h+=V;var Z=(D+=V)-q;if(Z<0){var X=-Z,H=t.e+Z;for(X>j&&(X=j),v=0;v<X;++v)y[D+v]=t.w[H+v];D+=X,j-=X,Z=0}for(v=0;v<j;++v)y[D+v]=y[Z+v];D+=j}if(D!=h)for(;h<y.length;)y[D++]=y[h++];else D=y.length;n?t.y+=D:y=Gr(y,0,D)}else if(n){if(t.y+=d,h)for(v=0;v<d;++v)y[v]=y[h+v]}else h&&(y=Gr(y,h));return t.b=s,y}zr(2)}};const si={GZIP:e=>{return o=function(e){31==e[0]&&139==e[1]&&8==e[2]||vr(6,\"invalid gzip data\");var t=e[3],n=10;4&t&&(n+=2+(e[10]|e[11]<<8));for(var r=(t>>3&1)+(t>>4&1);r>0;r-=!e[n++]);return n+(2&t)}(t=e),o+8>t.length&&vr(6,\"invalid gzip data\"),function(e,t,n,r){var i=e.length;if(!i||t.f&&!t.l)return n||new Zn(0);var o=!n,f=o||2!=t.i,a=t.i;o&&(n=new Zn(3*i));var s=function(e){var t=n.length;if(e>t){var r=new Zn(Math.max(2*t,e));r.set(n),n=r}},l=t.f||0,u=t.p||0,c=t.b||0,d=t.l,p=t.d,_=t.m,y=t.n,h=8*i;do{if(!d){l=mr(e,u,1);var m=mr(e,u+1,3);if(u+=3,!m){var g=e[(O=wr(u)+4)-4]|e[O-3]<<8,w=O+g;if(w>i){a&&vr(0);break}f&&s(c+g),n.set(e.subarray(O,w),c),t.b=c+=g,t.p=u=8*w,t.f=l;continue}if(1==m)d=pr,p=yr,_=9,y=5;else if(2==m){var A=mr(e,u,31)+257,E=mr(e,u+10,15)+4,v=A+mr(e,u+5,31)+1;u+=14;for(var I=new Zn(v),b=new Zn(19),T=0;T<E;++T)b[Wn[T]]=mr(e,u+3*T,7);u+=3*E;var N=hr(b),U=(1<<N)-1,L=lr(b,N,1);for(T=0;T<v;){var O,B=L[mr(e,u,U)];if(u+=15&B,(O=B>>4)<16)I[T++]=O;else{var R=0,D=0;for(16==O?(D=3+mr(e,u,3),u+=2,R=I[T-1]):17==O?(D=3+mr(e,u,7),u+=3):18==O&&(D=11+mr(e,u,127),u+=7);D--;)I[T++]=R}}var M=I.subarray(0,A),S=I.subarray(A);_=hr(M),y=hr(S),d=lr(M,_,1),p=lr(S,y,1)}else vr(1);if(u>h){a&&vr(0);break}}f&&s(c+131072);for(var x=(1<<_)-1,P=(1<<y)-1,Y=u;;Y=u){var F=(R=d[gr(e,u)&x])>>4;if((u+=15&R)>h){a&&vr(0);break}if(R||vr(2),F<256)n[c++]=F;else{if(256==F){Y=u,d=null;break}var $=F-254;if(F>264){var k=Jn[T=F-257];$=mr(e,u,(1<<k)-1)+tr[T],u+=k}var C=p[gr(e,u)&P],G=C>>4;if(C||vr(3),u+=15&C,S=ir[G],G>3&&(k=Qn[G],S+=gr(e,u)&(1<<k)-1,u+=k),u>h){a&&vr(0);break}f&&s(c+131072);var q=c+$;if(c<S){var j=0-S,V=Math.min(S,q);for(j+c<0&&vr(3);c<V;++c)n[c]=r[j+c]}for(;c<q;++c)n[c]=n[c-S]}}t.l=d,t.p=Y,t.b=c,t.f=l,d&&(l=1,t.m=_,t.d=p,t.n=y)}while(!l);return c!=n.length&&o?Ar(n,0,c):n.subarray(0,c)}(t.subarray(o,-8),{i:2},new Zn((i=(r=t).length,(r[i-4]|r[i-3]<<8|r[i-2]<<16|r[i-1]<<24)>>>0)),n);var t,n,r,i,o},ZSTD:e=>function(e,t){for(var n=[],r=+!t,i=0,o=0;e.length;){var f=Xr(e,r||t);if(\"object\"==typeof f){for(r?(t=null,f.w.length==f.u&&(n.push(t=f.w),o+=f.u)):(n.push(t),f.e=0);!f.l;){var a=ai(e,f,t);a||zr(5),t?f.e=f.y:(n.push(a),o+=a.length,jr(f.w,0,a.length),f.w.set(a,f.w.length-a.length))}i=f.b+4*f.c}else i=f;e=e.subarray(i)}return function(e,t){if(1==e.length)return e[0];for(var n=new Fr(t),r=0,i=0;r<e.length;++r){var o=e[r];n.set(o,i),i+=o.length}return n}(n,o)}(e)},li={GZIP:e=>xr(e)};function ui(e){return di(D(e instanceof Uint8Array?e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength):e))}async function ci(e){return di(await R(Ei(e)))}function di(e){const t=e.row_groups&&e.row_groups[0],n=e=>(e.meta_data&&e.meta_data.path_in_schema||[]).join(\".\"),r=(t&&t.columns||[]).map(e=>({name:n(e),type:e.meta_data&&e.meta_data.type,codec:e.meta_data&&e.meta_data.codec})),i=(e.row_groups||[]).map(e=>({rowCount:Number(e.num_rows),columns:(e.columns||[]).reduce((e,t)=>{const r=t.meta_data,i=r&&r.statistics||{};return e[n(t)]={min:i.min_value,max:i.max_value,nulls:null!=i.null_count?Number(i.null_count):void 0},e},{})}));return{rowCount:Number(e.num_rows),columns:r,rowGroups:i,codec:r[0]&&r[0].codec,meta:e}}async function pi(e,t={}){return Ge({file:Ei(e),compressors:si,...t})}async function _i(e,t={}){let n=null;return await ke({file:Ei(e),compressors:si,rowFormat:\"object\",...t,onComplete:e=>{n=e}}),n}async function yi(e,t){const n=ui(e),r=t||n.columns.map(e=>e.name),i={};for(const t of r){const n=[];await ke({file:Ei(e),compressors:si,columns:[t],onComplete:e=>{for(const t of e)n.push(t[0])}}),i[t]=n}return i}async function hi(e,t,n,r,i){const o={};for(const f of t){const t=[];await ke({file:Ei(e),compressors:si,metadata:i,columns:[f],rowStart:n,rowEnd:r,onComplete:e=>{for(const n of e)t.push(n[0])}}),o[f]=t}return o}async function*mi(e,t,n,r){const i=n||(await ci(e)).rowGroups;let o=0;for(const n of i){const i=n.rowCount;yield{start:o,count:i,cols:await hi(e,t,o,o+i,r)},o+=i}}async function gi(e,t,n){return(await pi(e,{rowStart:t,rowEnd:t+1,metadata:n}))[0]||null}function wi({schema:e=null,columnTypes:t=null,codec:n=\"SNAPPY\",kvMetadata:r}={}){const i=[],o=new qe;o.flush=function(){this.index&&(i.push(this.getBuffer()),this.index=0)};let f=null,a=e;const s=e=>{for(const t of e)if(null!=t)return\"number\"==typeof t?\"DOUBLE\":\"boolean\"==typeof t?\"BOOLEAN\":\"bigint\"==typeof t?\"INT64\":\"STRING\";return\"STRING\"};return{write(e){if(!f){if(!a){const n=e.map(e=>({...e,type:t&&t[e.name]||e.type||s(e.data)}));a=zt({columnData:n})}f=new Gn({writer:o,schema:a,codec:n,compressors:li,statistics:!0,kvMetadata:r})}f.write({columnData:e,rowGroupSize:e[0]&&e[0].data.length||1})},finish(){if(!f)throw new Error(\"parquet blob writer: nothing written\");return f.finish(),o.flush(),new Blob(i,{type:\"application/vnd.apache.parquet\"})}}}function Ai({columnData:e,rowGroupSize:t=65536,codec:n=\"SNAPPY\",kvMetadata:r}={}){const i=e.map(e=>{if(e.type)return e;const t=e.data;for(let n=0;n<t.length;n++){const r=t[n];if(\"number\"==typeof r&&Number.isFinite(r)&&!Number.isInteger(r))return{...e,type:\"DOUBLE\"}}return e});return zn({columnData:i,rowGroupSize:t,codec:n,compressors:li,statistics:!0,kvMetadata:r})}function Ei(e){if(e&&\"function\"==typeof e.slice&&\"number\"==typeof e.byteLength&&!(e instanceof Uint8Array))return e;if(\"undefined\"!=typeof Blob&&e instanceof Blob)return{byteLength:e.size,slice:async(t,n)=>e.slice(t,null==n?e.size:n).arrayBuffer()};const t=e instanceof Uint8Array?e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength):e;return{byteLength:t.byteLength,slice:async(e,n)=>t.slice(e,n)}}export{wi as createParquetBlobWriter,ui as parquetInfo,ci as parquetInfoAsync,D as parquetMetadata,R as parquetMetadataAsync,ke as parquetRead,Ge as parquetReadObjects,M as parquetSchema,zn as parquetWriteBuffer,si as readCompressors,pi as readParquet,yi as readParquetColumnMap,_i as readParquetColumns,hi as readParquetRange,gi as readParquetRow,zt as schemaFromColumnData,Me as snappyUncompress,mi as streamParquetColumns,ne as toJson,li as writeCompressors,Ai as writeParquet};\n";
let _pq = null;
async function pqMod() {
  if (!_pq) {
    const url = URL.createObjectURL(new Blob([PQ_SRC], { type: 'text/javascript' }));
    // a controlled dynamic-import site (the bundler forbids the literal form;
    // a strict no-eval CSP lands in buildFileLayer's catch with an honest hud)
    const dynImport = new Function('u', 'return import(u)');
    try { _pq = await dynImport(url); } finally { URL.revokeObjectURL(url); }
  }
  return _pq;
}

const _pqNum = (t) => /INT|FLOAT|DOUBLE|DECIMAL/.test(t || '');

async function openParquetBlocks(blob, { map = null } = {}) {
  const { parquetInfoAsync, streamParquetColumns } = await pqMod();
  // hyparquet wants an AsyncBuffer; RemoteBlob speaks Blob (size/slice) — one
  // wrapper and every read below range-reads through it
  const buf = { byteLength: blob.size, slice: (s, e) => blob.slice(s, e == null ? blob.size : e).arrayBuffer() };
  const info = await parquetInfoAsync(buf);
  const names = info.columns.map((c) => c.name);
  const typeOf = {};
  info.columns.forEach((c) => { typeOf[c.name] = c.type; });
  if (names.length < 3) throw new Error('parquet: need at least 3 columns (X, Y, Z)');
  // column roles: the caller's NAMES (via='files' map) override the auto-sniff
  const mapping = mapColumns(names) || { x: 0, y: 1, z: 2, chan: names.length > 3 ? 3 : null, cat: null };
  if (map) {
    const idx = (nm) => (nm == null ? -1 : names.indexOf(nm));
    for (const [k, mk] of [['x', 'x'], ['y', 'y'], ['z', 'z'], ['chan', 'value'], ['cat', 'category']]) {
      const i = idx(map[mk]);
      if (i >= 0) mapping[k] = i;
    }
  }
  if (mapping.x == null || mapping.y == null || mapping.z == null) throw new Error('parquet: could not identify X/Y/Z centroid columns');
  if (mapping.chan != null && !_pqNum(typeOf[names[mapping.chan]])) mapping.chan = null;
  if (mapping.cat == null) {
    for (let i = 0; i < names.length; i++) {
      if (i === mapping.x || i === mapping.y || i === mapping.z || i === mapping.chan) continue;
      if (!_pqNum(typeOf[names[i]])) { mapping.cat = i; break; }
    }
  }
  const xN = names[mapping.x], yN = names[mapping.y], zN = names[mapping.z];
  const chanN = mapping.chan != null ? names[mapping.chan] : null;
  const catN = mapping.cat != null ? names[mapping.cat] : null;
  const N = info.rowCount;
  if (!N) throw new Error('parquet: empty table');

  // micro-written files describe themselves — kv `micro:model` = grid + bbox +
  // categories, so no discovery sweep at all
  let kvModel = null;
  try {
    const e = (info.meta.key_value_metadata || []).find((x) => x.key === 'micro:model');
    if (e) kvModel = JSON.parse(e.value);
  } catch { /* a foreign file */ }
  let grid = null, categories = null, min, max;
  if (kvModel && kvModel.bbox) {
    grid = kvModel.grid || null;
    categories = kvModel.categories || null;
    min = [...kvModel.bbox.min]; max = [...kvModel.bbox.max];
  } else {
    // discovery: ONE streamed pass over coords (+ cat) — a row group resident
    // at a time, nothing retained
    const CAP = 100000, r10 = (v) => Number(v.toPrecision(10));
    min = [Infinity, Infinity, Infinity]; max = [-Infinity, -Infinity, -Infinity];
    const ax = [new Set(), new Set(), new Set()];
    const catSet = catN ? new Set() : null;
    const discCols = catN ? [xN, yN, zN, catN] : [xN, yN, zN];
    for await (const { count, cols } of streamParquetColumns(buf, discCols, info.rowGroups, info.meta)) {
      const X = cols[xN], Y = cols[yN], Z = cols[zN], C = catN ? cols[catN] : null;
      for (let i = 0; i < count; i++) {
        const xv = +X[i], yv = +Y[i], zv = +Z[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
        if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
        if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
        if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
        if (ax[0].size < CAP) ax[0].add(r10(xv));
        if (ax[1].size < CAP) ax[1].add(r10(yv));
        if (ax[2].size < CAP) ax[2].add(r10(zv));
        if (catSet && catSet.size <= 256) { const v = C[i]; if (v != null && v !== '') catSet.add(String(v)); }
      }
    }
    const axes = ax.map((set) => (set.size < CAP ? inferAxis([...set].sort((a, b) => a - b)) : null));
    grid = axes.every(Boolean) ? { x: axes[0], y: axes[1], z: axes[2] } : null;
    categories = catSet && catSet.size > 0 && catSet.size <= 255 ? [...catSet].sort() : null;
  }
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;
  const header = { kind: 'blockmodel', count: N, bbox: { min, max }, grid, columns: names, mapping, categories, parquet: true };

  async function* streamChunks() {
    const cnames = [xN, yN, zN, ...(chanN ? [chanN] : []), ...(catN ? [catN] : [])];
    for await (const { start, count, cols } of streamParquetColumns(buf, cnames, info.rowGroups, info.meta)) {
      const X = cols[xN], Y = cols[yN], Z = cols[zN], CH = chanN ? cols[chanN] : null, CA = catN ? cols[catN] : null;
      const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
      const cat = catCode ? new Uint8Array(count) : null, recIdx = new Uint32Array(count);
      for (let i = 0; i < count; i++) {
        x[i] = +X[i]; y[i] = +Y[i]; z[i] = +Z[i];
        chan[i] = CH ? +CH[i] : 0;
        if (cat) cat[i] = catCode.get(String(CA[i] ?? '')) ?? 0;
        recIdx[i] = start + i;
      }
      yield { count, x, y, z, chan, cat, recIdx, recStart: start };
    }
  }
  return { header, streamChunks };
}

// ── src/toolbar.js ──

// @gcu/condenser anywidget — the in-view toolbar.
//
// Scope rule: a notebook widget must not become micro. What earns a button is
// what is AWKWARD OR IMPOSSIBLE from Python — mouse-driven geometry (the knife),
// things you need while looking (the pick readout, the legend), and the camera
// moves you would otherwise fiddle with by hand. Everything a line of Python
// does well (ramps, clips, thresholds) stays in Python.
//
// Nothing here is decorative: no external CSS, no icon font, inline SVG only,
// and every control round-trips through the model traits so the notebook sees
// what you did — toggling a layer here really does set `w["topo"].visible`.

const ICON = {
  fit: 'M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9',
  view: 'M1 7s2.2-3.9 6-3.9S13 7 13 7s-2.2 3.9-6 3.9S1 7 1 7z M7 8.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z',
  ortho: 'M2.5 3.5h9v7h-9z M2.5 3.5 5 1.5h9v7l-2.5 2',
  pick: 'M3 1.5 11 7l-3.4.7L9 11.8l-1.6.7-1.4-4L3 11z',
  knife: 'M1.5 12.5 8 6l4.5-4.5L11 7l-6 6z M8 6l3 3',
  rect: 'M2 2.5h3M9 2.5h3M11.5 5v3M11.5 9v0M2 11.5h3M9 11.5h3M2.5 5v3M2.5 9v.5',
  lasso: 'M7 2c3 0 5.5 1.7 5.5 3.9S10 9.8 7 9.8 1.5 8.1 1.5 5.9 4 2 7 2z M4.6 9.3c-.5 1.2-.2 2.4.9 3',
  measure: 'M1.5 8.5 8.5 1.5l4 4-7 7z M4 6l1.5 1.5M6.5 3.5 8 5',
  through: 'M2.5 4h5v6h-5z M7.5 7h4M9.5 5.2 11.8 7 9.5 8.8',
  layers: 'M7 1.5 12.5 4.6 7 7.7 1.5 4.6z M1.5 7.4 7 10.5l5.5-3.1M1.5 10.2 7 13.3l5.5-3.1',
  camera: 'M1.5 4.5h2.5l1-1.5h4l1 1.5h2.5v7h-11z M7 9.8a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  close: 'M3.5 3.5l7 7M10.5 3.5l-7 7',
};

const svg = (d) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
  stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const CSS = `
.cdt { position:absolute; left:6px; top:6px; display:flex; gap:2px; z-index:4;
  background:rgba(22,22,22,.86); border:1px solid #333; border-radius:4px; padding:2px;
  font:11px ui-monospace,Menlo,Consolas,monospace; backdrop-filter:blur(3px); }
.cdt button { all:unset; box-sizing:border-box; width:24px; height:22px; display:grid; place-items:center;
  color:#b9b9b9; border-radius:3px; cursor:pointer; }
.cdt button:hover { background:#2e2e2e; color:#e8e8e8; }
.cdt button[aria-pressed="true"] { background:#c8781f; color:#141414; }
.cdt .sep { width:1px; background:#3a3a3a; margin:2px 1px; }
.cdpop { position:absolute; left:6px; top:34px; z-index:5; min-width:172px; max-height:220px; overflow:auto;
  background:rgba(22,22,22,.96); border:1px solid #3a3a3a; border-radius:4px; padding:5px 6px;
  font:11px ui-monospace,Menlo,Consolas,monospace; color:#cfcfcf; backdrop-filter:blur(3px); }
.cdpop h4 { margin:0 0 5px; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#8a8a8a; font-weight:600; }
.cdpop label { display:flex; align-items:center; gap:6px; padding:2px 0; cursor:pointer; }
.cdpop label:hover { color:#fff; }
.cdpop input[type=checkbox] { accent-color:#c8781f; margin:0; }
.cdpop .k { color:#7d7d7d; }
.cdpop .row { display:flex; justify-content:space-between; gap:8px; padding:1px 0; }
.cdpop button.opt { all:unset; display:block; padding:3px 5px; border-radius:3px; cursor:pointer; color:#cfcfcf; }
.cdpop button.opt:hover { background:#2e2e2e; color:#fff; }
.cdsec { position:absolute; left:6px; bottom:26px; z-index:4; display:flex; align-items:center; gap:6px;
  background:rgba(22,22,22,.88); border:1px solid #333; border-radius:4px; padding:3px 7px;
  font:11px ui-monospace,Menlo,Consolas,monospace; color:#c4c4c4; backdrop-filter:blur(3px);
  user-select:none; }
/* FIXED width. The readout is the only elastic thing in this bar, and it sits
   BEFORE the slider — letting it resize as the number changes (N 300 -> N -28.03)
   walks the slider out from under the cursor mid-drag. Monospace + a fixed ch
   box keeps the thumb exactly where the hand left it. */
.cdsec .lbl { flex:0 0 12ch; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  font-variant-numeric:tabular-nums; }
.cdsec input[type=range] { flex:0 0 130px; width:130px; accent-color:#c8781f; }
.cdsec button { all:unset; cursor:pointer; color:#8a8a8a; padding:0 2px; }
.cdsec button:hover { color:#e0705a; }
.cdpick { position:absolute; right:6px; top:6px; z-index:4; max-width:210px;
  background:rgba(22,22,22,.9); border:1px solid #333; border-radius:4px; padding:5px 7px;
  font:11px ui-monospace,Menlo,Consolas,monospace; color:#d2d2d2; backdrop-filter:blur(3px); }
.cdpick .t { color:#c8781f; margin-bottom:2px; }
.cdpick .row { display:flex; justify-content:space-between; gap:10px; }
.cdpick .k { color:#7d7d7d; }
.cdleg { position:absolute; right:6px; bottom:6px; z-index:3; display:flex; align-items:center; gap:5px;
  font:10px ui-monospace,Menlo,Consolas,monospace; color:#a8a8a8; text-shadow:0 1px 2px #000; }
.cdleg canvas { display:block; width:96px; height:8px; border:1px solid #444; border-radius:1px; }
.cdlegramp { display:flex; align-items:center; gap:5px; }
.cdlegname { color:#c8781f; margin-right:2px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cdcats { display:flex; flex-direction:column; gap:1px; max-height:170px; overflow:auto;
  background:rgba(22,22,22,.85); border:1px solid #333; border-radius:4px; padding:4px 6px; }
.cdcat { display:flex; align-items:center; gap:5px; cursor:pointer; padding:1px 2px; border-radius:2px; white-space:nowrap; }
.cdcat:hover { background:#ffffff14; }
.cdcat .sw { width:9px; height:9px; border:1px solid #555; border-radius:1px; flex:none; }
.cdcat.off { opacity:.45; }
.cdcat.off span:last-child { text-decoration:line-through; }
.cdknife { position:absolute; inset:0; z-index:2; pointer-events:none; }
`;

const fmt = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1e5 || (a < 0.01 && a > 0) ? v.toExponential(2) : String(Math.round(v * 100) / 100);
};

/**
 * createToolbar(host, api) — api is the widget's own surface:
 *   layers()      → [{ name, kind, visible, hasValue, range, ramp }]
 *   setStyle(i,p) → patch a layer's style (round-trips to Python)
 *   fit(), setView(name), toggleOrtho() → bool, isOrtho()
 *   getSection() / setSection(s) / sectionRange() → [lo, hi] along the normal
 *   knife(x1,y1,x2,y2) → set a section from a screen-space drag
 *   selectRect / selectLasso → region selection (rows go back to Python)
 *   measure → two-click distance / bearing / plunge
 *   snapshot()
 *   onToolChange(tool)
 */
function createToolbar(host, api) {
  const style = document.createElement('style');
  style.textContent = CSS;
  host.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'cdt';
  host.appendChild(bar);

  let pop = null, tool = 'orbit';
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  const mkPop = () => { closePop(); pop = document.createElement('div'); pop.className = 'cdpop'; host.appendChild(pop); return pop; };

  const btn = (icon, title, onClick, toggles) => {
    const b = document.createElement('button');
    b.innerHTML = svg(ICON[icon]);
    b.title = title;
    if (toggles) b.setAttribute('aria-pressed', 'false');
    b.onclick = (e) => { e.stopPropagation(); onClick(b); };
    bar.appendChild(b);
    return b;
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'sep'; bar.appendChild(s); };

  // ── camera ──
  btn('fit', 'Fit the view to the data', () => { closePop(); api.fit(); });

  const viewBtn = btn('view', 'Standard views', () => {
    if (pop && pop.dataset.k === 'view') return closePop();
    const p = mkPop(); p.dataset.k = 'view';
    p.innerHTML = '<h4>view</h4>';
    for (const [k, label] of [['plan', 'Plan (down)'], ['north', 'Looking north'], ['east', 'Looking east'], ['iso', 'Isometric']]) {
      const b = document.createElement('button');
      b.className = 'opt'; b.textContent = label;
      b.onclick = () => { api.setView(k); closePop(); };
      p.appendChild(b);
    }
    const r = viewBtn.getBoundingClientRect(), h = host.getBoundingClientRect();
    p.style.left = `${r.left - h.left}px`;
  });

  const orthoBtn = btn('ortho', 'Parallel projection (for sections)', (b) => {
    closePop();
    const on = api.toggleOrtho();
    b.setAttribute('aria-pressed', String(on));
  }, true);

  sep();

  // ── tools ──
  const TOOLS = {};
  const setTool = (t) => {
    tool = tool === t ? 'orbit' : t;
    for (const [k, b] of Object.entries(TOOLS)) b.setAttribute('aria-pressed', String(tool === k));
    api.onToolChange(tool);
  };
  const pickBtn = btn('pick', 'Pick: click an element to inspect it', () => { closePop(); setTool('pick'); }, true);
  const rectBtn = btn('rect', 'Rectangle select: drag a box (shift adds)', () => { closePop(); setTool('rect'); }, true);
  const lassoBtn = btn('lasso', 'Lasso select: draw around elements (shift adds)', () => { closePop(); setTool('lasso'); }, true);
  const throughBtn = btn('through', 'Select through: catch everything in the swept volume, not just the visible surface', (b) => {
    closePop();
    const on = api.toggleThrough();
    b.setAttribute('aria-pressed', String(on));
  }, true);
  const measureBtn = btn('measure', 'Measure: click two elements for distance, bearing and plunge', () => { closePop(); setTool('measure'); }, true);
  const knifeBtn = btn('knife', 'Knife: drag a line to cut a section along it', () => { closePop(); setTool('knife'); }, true);
  pickBtn.setAttribute('aria-pressed', 'true');            // picking is the default posture
  tool = 'pick';

  Object.assign(TOOLS, { pick: pickBtn, rect: rectBtn, lasso: lassoBtn, measure: measureBtn, knife: knifeBtn });

  sep();

  // ── layers ──
  const layersBtn = btn('layers', 'Layers', () => {
    if (pop && pop.dataset.k === 'layers') return closePop();
    const p = mkPop(); p.dataset.k = 'layers';
    p.innerHTML = '<h4>layers</h4>';
    api.layers().forEach((L, i) => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = L.visible !== false;
      cb.onchange = () => api.setStyle(i, { visible: cb.checked });
      const nm = document.createElement('span');
      nm.textContent = L.name;
      const kd = document.createElement('span');
      kd.className = 'k'; kd.style.marginLeft = 'auto';
      kd.textContent = L.kind === 'drillholes' ? 'holes' : L.kind;
      lab.append(cb, nm, kd);
      p.appendChild(lab);
    });
    const r = layersBtn.getBoundingClientRect(), h = host.getBoundingClientRect();
    p.style.left = `${Math.max(4, r.left - h.left - 60)}px`;
  });

  btn('camera', 'Save a PNG of the view', () => { closePop(); api.snapshot(); });

  host.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !bar.contains(e.target)) closePop(); }, true);

  // ── the section bar (only while a section exists) ──
  const secBar = document.createElement('div');
  secBar.className = 'cdsec';
  secBar.style.display = 'none';
  const secLabel = document.createElement('span');
  secLabel.className = 'lbl';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '500';
  const thick = document.createElement('input');
  thick.type = 'number'; thick.min = '0.1'; thick.step = '1';
  thick.style.cssText = 'width:48px;background:#232323;color:#ccc;border:1px solid #3a3a3a;border-radius:2px;font:inherit;padding:1px 3px;';
  const clearBtn = document.createElement('button');
  clearBtn.innerHTML = svg(ICON.close); clearBtn.title = 'Clear the section';
  secBar.append(secLabel, slider, thick, clearBtn);
  host.appendChild(secBar);

  let range = [0, 1];
  slider.oninput = () => {
    const s = api.getSection(); if (!s) return;
    const t = +slider.value / 1000;
    api.setSection({ ...s, position: range[0] + t * (range[1] - range[0]) });
  };
  thick.onchange = () => {
    const s = api.getSection(); if (!s) return;
    api.setSection({ ...s, thickness: Math.max(0.1, +thick.value || 10) });
  };
  clearBtn.onclick = () => api.setSection(null);

  // ── the pick readout ──
  const pickBox = document.createElement('div');
  pickBox.className = 'cdpick';
  pickBox.style.display = 'none';
  host.appendChild(pickBox);

  // ── the color legend (a ramp, or a category swatch list with eye toggles) ──
  const leg = document.createElement('div');
  leg.className = 'cdleg';
  leg.style.display = 'none';
  const legLo = document.createElement('span'), legHi = document.createElement('span');
  const legTitle = document.createElement('span');
  legTitle.className = 'cdlegname';
  const legCv = document.createElement('canvas'); legCv.width = 96; legCv.height = 8;
  const legRamp = document.createElement('div');
  legRamp.className = 'cdlegramp';
  legRamp.append(legTitle, legLo, legCv, legHi);
  const legCats = document.createElement('div');
  legCats.className = 'cdcats';
  leg.append(legRamp, legCats);
  host.appendChild(leg);

  // ── the knife rubber band ──
  const NS = 'http://www.w3.org/2000/svg';
  const bandEl = document.createElementNS(NS, 'svg');
  bandEl.setAttribute('class', 'cdknife');
  bandEl.setAttribute('width', '100%');                    // an SVG with no size
  bandEl.setAttribute('height', '100%');                   // gets a 300x150 box and CLIPS the line
  const line = document.createElementNS(NS, 'line');
  const rect = document.createElementNS(NS, 'rect');
  const poly = document.createElementNS(NS, 'polyline');
  const meas = document.createElementNS(NS, 'line');
  for (const el of [line, rect, poly, meas]) {
    el.setAttribute('stroke', '#c8781f');
    el.setAttribute('stroke-width', '1.6');
    el.setAttribute('fill', 'none');
  }
  line.setAttribute('stroke-dasharray', '6 4');
  rect.setAttribute('stroke-dasharray', '5 3');
  meas.setAttribute('stroke', '#e8e8e8');
  meas.setAttribute('stroke-dasharray', '4 3');
  const capA = document.createElementNS(NS, 'circle');
  const capB = document.createElementNS(NS, 'circle');
  for (const c of [capA, capB]) { c.setAttribute('r', '3'); c.setAttribute('fill', '#c8781f'); }
  bandEl.append(rect, poly, line, meas, capA, capB);
  const hideAll = () => { for (const el of [line, rect, poly, meas, capA, capB]) el.setAttribute('visibility', 'hidden'); };
  hideAll();
  bandEl.style.display = 'none';
  host.appendChild(bandEl);

  return {
    get tool() { return tool; },
    // one band, four shapes: 'line' (knife) · 'rect' · 'poly' (lasso) ·
    // 'measure'. Passing nothing clears it.
    setBand(kind, a, b) {
      hideAll();
      if (!kind) { bandEl.style.display = 'none'; return; }
      bandEl.style.display = '';
      if (kind === 'rect') {
        rect.setAttribute('x', Math.min(a[0], b[0])); rect.setAttribute('y', Math.min(a[1], b[1]));
        rect.setAttribute('width', Math.abs(b[0] - a[0])); rect.setAttribute('height', Math.abs(b[1] - a[1]));
        rect.setAttribute('visibility', 'visible');
        return;
      }
      if (kind === 'poly') {
        poly.setAttribute('points', a.map((p) => `${p[0]},${p[1]}`).join(' '));
        poly.setAttribute('visibility', 'visible');
        return;
      }
      const el = kind === 'measure' ? meas : line;
      el.setAttribute('x1', a[0]); el.setAttribute('y1', a[1]);
      el.setAttribute('x2', b[0]); el.setAttribute('y2', b[1]);
      el.setAttribute('visibility', 'visible');
      for (const [c, p] of [[capA, a], [capB, b]]) {
        c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]);
        c.setAttribute('fill', kind === 'measure' ? '#e8e8e8' : '#c8781f');
        c.setAttribute('visibility', 'visible');
      }
    },
    clearTool() {
      tool = 'pick';
      for (const [k, b] of Object.entries(TOOLS)) b.setAttribute('aria-pressed', String(k === 'pick'));
      api.onToolChange(tool);
    },
    // pick info → the readout (null hides it)
    showPick(info) {
      if (!info) { pickBox.style.display = 'none'; return; }
      const rows = info.rows.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`).join('');
      pickBox.innerHTML = `<div class="t">${info.title}</div>${rows}`;
      pickBox.style.display = '';
    },
    // section state → the scrub bar
    syncSection(sec, extent) {
      if (!sec) { secBar.style.display = 'none'; return; }
      range = extent || [0, 1];
      secBar.style.display = '';
      const axis = sec.axis ? sec.axis.toUpperCase() : 'N';
      secLabel.textContent = `${axis} ${fmt(sec.position)}`;
      const span = range[1] - range[0] || 1;
      slider.value = String(Math.round(((sec.position - range[0]) / span) * 1000));
      if (document.activeElement !== thick) thick.value = String(sec.thickness);
    },
    // the ramp + range of the first value-colored visible layer
    syncLegend(info) {
      if (!info) { leg.style.display = 'none'; return; }
      leg.style.display = '';
      if (info.cats) {                                     // categorical: swatch rows, click = class eye
        legRamp.style.display = 'none';
        legCats.style.display = '';
        legCats.textContent = '';
        for (const c of info.cats) {
          const row = document.createElement('div');
          row.className = 'cdcat' + (c.hidden ? ' off' : '');
          row.title = c.hidden ? 'show' : 'hide';
          const sw = document.createElement('span');
          sw.className = 'sw';
          sw.style.background = `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`;
          const lb = document.createElement('span');
          lb.textContent = c.label;
          row.append(sw, lb);
          row.onclick = () => { if (info.onToggle) info.onToggle(c.label); };
          legCats.appendChild(row);
        }
        return;
      }
      legCats.style.display = 'none';
      legRamp.style.display = '';
      legTitle.textContent = info.label || '';
      legTitle.style.display = info.label ? '' : 'none';
      legLo.textContent = fmt(info.range[0]);
      legHi.textContent = fmt(info.range[1]);
      const g = legCv.getContext('2d');
      const img = g.createImageData(96, 1);
      for (let i = 0; i < 96; i++) {
        const t = Math.min(255, Math.round((i / 95) * 255));
        img.data[i * 4] = info.pixels[t * 4];
        img.data[i * 4 + 1] = info.pixels[t * 4 + 1];
        img.data[i * 4 + 2] = info.pixels[t * 4 + 2];
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.drawImage(legCv, 0, 0, 96, 1, 0, 0, 96, 8);
    },
    syncOrtho(on) { orthoBtn.setAttribute('aria-pressed', String(!!on)); },
    syncThrough(on) { throughBtn.setAttribute('aria-pressed', String(!!on)); },
    destroy() { closePop(); [style, bar, secBar, pickBox, leg, bandEl].forEach((n) => n.remove()); },
  };
}

// ── src/widget.js ──

// @gcu/condenser — the anywidget (Jupyter) front half. Glue only: it decodes
// the packed columnar payload, feeds each layer through the engine's chunk
// builders, and drives one progressive render loop per widget instance. All
// the rendering intelligence (Morton order, prefix LOD, box impostors, capsule
// impostors, EDL, true sections, the ID-buffer pick) is @gcu/condenser/core,
// unchanged — the SAME engine micro ships, so a notebook and the desktop tool
// agree by construction. Drillholes desurvey through @gcu/drillhole, also the
// same code, so a hole lands in the same place in both.
//
// anywidget contract: default-export an object with render({model, el}),
// returning a cleanup function. `_payload` is one atomic Bytes blob holding
// EVERY layer against ONE shared frame; `_styles` is a per-layer style dict.


// ── ramp presets. rampPixels' default is the viridis-ish walk; these are the
// few a geologist reaches for. Kept here (not in the engine) because they are
// a PRESENTATION choice — micro has its own richer set in its own UI. ──
const RAMPS = {
  viridis: null,                                           // the engine default
  magma: [[0, 0, 4], [80, 18, 123], [182, 54, 121], [252, 137, 97], [252, 253, 191]],
  turbo: [[48, 18, 59], [28, 156, 220], [96, 252, 100], [249, 190, 60], [122, 4, 3]],
  grays: [[20, 20, 20], [90, 90, 90], [150, 150, 150], [205, 205, 205], [250, 250, 250]],
  spectral: [[94, 79, 162], [102, 194, 165], [255, 255, 191], [253, 174, 97], [158, 1, 66]],
  fire: [[10, 5, 40], [120, 20, 90], [220, 80, 40], [250, 180, 50], [255, 250, 200]],
};
RAMPS.greys = RAMPS.grays;    // matplotlib spells it 'Greys'; don't punish the muscle memory

const TYPES$widget = { f64: Float64Array, f32: Float32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array };

// ── the wire format (mirrors gcu_condenser/__init__.py's _pack) ──
//   'CDNS' | u32 version | u32 headerLen | header JSON (utf-8) | pad | body
// Column offsets are RELATIVE TO THE BODY START, which both sides derive as
// (12 + headerLen) rounded up to 8 — self-describing without the offsets
// depending on the header's own length. ONE blob keeps a data change ATOMIC.
function decodePayload(raw) {
  if (!raw) return null;
  const buf = raw instanceof ArrayBuffer ? raw : (raw.buffer || raw);
  const base = raw.byteOffset || 0;
  const len = raw.byteLength != null ? raw.byteLength : (buf ? buf.byteLength : 0);
  if (!buf || len < 12) return null;
  const dv = new DataView(buf, base, len);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CDNS') return null;
  const headerLen = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, base + 12, headerLen)));
  const bodyStart = (12 + headerLen + 7) & ~7;
  const all = {};
  for (const [name, c] of Object.entries(head.cols || {})) {
    const T = TYPES$widget[c.type];
    if (T) all[name] = new T(buf, base + bodyStart + c.off, c.len);
  }
  const layers = (head.layers || []).map((L) => {
    const cols = {};
    for (const [name, key] of Object.entries(L.cols || {})) if (all[key]) cols[name] = all[key];
    return { ...L, cols };
  });
  return { frame: head.frame, frame_auto: !!head.frame_auto, layers };
}

// ── via='files': a Blob-shaped window onto jupyter-server's /files/ endpoint,
// which serves byte ranges on the session cookie — so the engine's own file
// providers (CSV/.dm/LAS/PLY, the same code micro ships) read straight from
// the notebook's folder with ZERO kernel involvement. Only the Blob surface
// the io layer actually touches is implemented: size/slice/arrayBuffer/text/
// stream. A server that ignores Range (plain static hosting) still works —
// the 200 fallback skips to the window.
class RemoteBlob {
  constructor(url, start, end) { this.url = url; this._start = start; this._end = end; }
  get size() { return this._end - this._start; }
  slice(a = 0, b = this.size) {
    const n = this.size;
    const s = Math.min(n, Math.max(0, a < 0 ? n + a : a));
    const e = Math.min(n, Math.max(s, b < 0 ? n + b : b));
    return new RemoteBlob(this.url, this._start + s, this._start + e);
  }
  async arrayBuffer() {
    if (this.size <= 0) return new ArrayBuffer(0);
    const res = await fetch(this.url, { headers: { Range: `bytes=${this._start}-${this._end - 1}` } });
    if (!res.ok) throw new Error(`files: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (res.status === 206) return buf;
    return buf.slice(this._start, this._end);              // Range ignored → cut the window out
  }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
  stream() {
    const { url, _start, _end } = this;
    let reader = null, skip = 0, left = _end - _start;
    return new ReadableStream({
      async start() {
        const res = await fetch(url, { headers: { Range: `bytes=${_start}-${_end - 1}` } });
        if (!res.ok || !res.body) throw new Error(`files: HTTP ${res.status}`);
        if (res.status !== 206) skip = _start;             // Range ignored → skip up to the window
        reader = res.body.getReader();
      },
      async pull(ctrl) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || left <= 0) { ctrl.close(); return; }
          let v = value;
          if (skip > 0) {
            if (v.length <= skip) { skip -= v.length; continue; }
            v = v.subarray(skip); skip = 0;
          }
          if (v.length > left) v = v.subarray(0, left);
          left -= v.length;
          ctrl.enqueue(v);
          return;
        }
      },
      cancel() { if (reader) reader.cancel().catch(() => {}); },
    });
  }
}

// probe the /files/ candidates (and a hub-style base prefix derived from the
// page URL) until one answers a byte range; null when none does
async function resolveFilesBlob(file) {
  const prefixes = ['/files/'];
  const m = (typeof document !== 'undefined' ? document.location.pathname : '').match(/^(.+?)\/(lab|notebooks|voila|tree)\b/);
  if (m && m[1]) prefixes.push(`${m[1]}/files/`);
  for (const cand of file.candidates || []) {
    for (const pre of prefixes) {
      const url = pre + cand.split('/').map(encodeURIComponent).join('/');
      try {
        const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
        if (!res.ok) continue;
        let size = file.size || 0;
        const cr = res.headers.get('Content-Range');
        if (cr) { const mm = cr.match(/\/(\d+)\s*$/); if (mm) size = +mm[1]; }
        else if (res.status === 200) {
          const cl = +res.headers.get('Content-Length') || 0;
          if (cl > 1) size = cl;                           // the server sent the whole file
        }
        if (size > 0) return new RemoteBlob(url, 0, size);
      } catch { /* next candidate */ }
    }
  }
  return null;
}

// which engine color mode a `color` choice means, per element kind. The engine
// numbers differ by pipeline (points: 1 = intensity, blocks/sticks: 1 = grade),
// so the widget speaks names and translates here.
function modeOf(color, kind, cols) {
  if (color === 'value' && (cols.value || cols.value_u16)) return 1;
  if (color === 'category' && cols.cat) return 2;
  if (color === 'rgb' && cols.rgb && kind === 'points') return 3;
  if (color === 'flat') return kind === 'points' ? 0 : 3;  // blocks/sticks: 3 = solid
  return 0;                                                // 'z' (elevation)
}

// the section trait → the engine's frame-local plane. `position` is a WORLD
// coordinate along the normal (that is what a geologist types), so the frame
// origin comes off it here.
function normalOf(sec) {
  let n = sec.normal;
  if (!n) {
    const ax = sec.axis;
    if (!ax) return null;
    n = ax === 'x' ? [1, 0, 0] : ax === 'y' ? [0, 1, 0] : [0, 0, 1];
  }
  const L = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / L, n[1] / L, n[2] / L];
}
function sectionOf(sec, origin) {
  if (!sec) return null;
  const n = normalOf(sec);
  if (!n) return null;
  const d = (+sec.position || 0) - (n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2]);
  const half = Math.max(0.01, (+sec.thickness || 10) / 2);
  return { on: true, n, d, half, d0: d, clip: 'slab', traceHalf: half };
}

// ── drillholes: three tables → desurveyed capsule segments ──
// The interval FROM and TO depths are located as two point-samples on the
// desurveyed trace (arc-correct via positionAt), then paired back into a
// segment keyed by source row — the same construction condenser's own file
// provider uses, so notebook and micro place a hole identically.
function drillholeSegments(head, cols) {
  const nC = cols.c_bhid.length, nS = cols.s_bhid.length, n = cols.i_bhid.length;
  const collars = new Array(nC);
  for (let i = 0; i < nC; i++) {
    collars[i] = { bhid: String(cols.c_bhid[i]), x: cols.c_x[i], y: cols.c_y[i], z: cols.c_z[i] };
    if (cols.c_eoh) collars[i].eoh = cols.c_eoh[i];
  }
  const surveys = new Array(nS);
  for (let i = 0; i < nS; i++) surveys[i] = { bhid: String(cols.s_bhid[i]), depth: cols.s_depth[i], az: cols.s_az[i], dip: cols.s_dip[i] };

  const bhid = new Array(2 * n), depth = new Float64Array(2 * n);
  const rowIdx = new Float64Array(2 * n), endIdx = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const hb = String(cols.i_bhid[i]);
    bhid[2 * i] = hb; bhid[2 * i + 1] = hb;
    depth[2 * i] = cols.i_from[i]; depth[2 * i + 1] = cols.i_to[i];
    rowIdx[2 * i] = i; rowIdx[2 * i + 1] = i;
    endIdx[2 * i] = 0; endIdx[2 * i + 1] = 1;
  }
  const ds = dhDesurveySamples$samples(
    { collars, surveys, samples: { bhid, depth, cols: [{ name: '__row', values: rowIdx }, { name: '__end', values: endIdx }] } },
    { method: head.method || 'minimumCurvature', dipConvention: head.dip_convention || 'auto' },
  );

  const endA = new Map(), endB = new Map();                // src row → [x,y,z]
  for (const row of ds.rows) (row[6] | 0) === 0 ? endA.set(row[5] | 0, [row[1], row[2], row[3]]) : endB.set(row[5] | 0, [row[1], row[2], row[3]]);
  const placed = [];
  for (const src of endA.keys()) if (endB.has(src)) placed.push(src);
  placed.sort((a, b) => a - b);
  const k = placed.length;
  const out = {
    count: k,
    ax: new Float64Array(k), ay: new Float64Array(k), az: new Float64Array(k),
    bx: new Float64Array(k), by: new Float64Array(k), bz: new Float64Array(k),
    x: new Float64Array(k), y: new Float64Array(k), z: new Float64Array(k),
    chan: new Float64Array(k), cat: cols.cat ? new Uint8Array(k) : null,
    recIdx: new Uint32Array(k),
  };
  for (let i = 0; i < k; i++) {
    const s = placed[i], A = endA.get(s), B = endB.get(s);
    out.ax[i] = A[0]; out.ay[i] = A[1]; out.az[i] = A[2];
    out.bx[i] = B[0]; out.by[i] = B[1]; out.bz[i] = B[2];
    out.x[i] = (A[0] + B[0]) / 2; out.y[i] = (A[1] + B[1]) / 2; out.z[i] = (A[2] + B[2]) / 2;
    out.chan[i] = cols.value && Number.isFinite(cols.value[s]) ? cols.value[s] : 0;
    if (out.cat) out.cat[i] = cols.cat[s];
    out.recIdx[i] = s;                                     // the INTERVAL row — the pick's join key
  }
  return out;
}

const fmtN = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1e5 || (a < 0.01 && a > 0) ? v.toExponential(2) : String(Math.round(v * 100) / 100);
};

// ── the WORKER half: this same bundle, booted as a module worker (from
// import.meta.url, so nothing extra ships). Chunk building — Morton keys,
// radix sort, quantize, shuffle — runs here while streaming, so a multi-
// million-row cd.open never stutters the notebook; the GPU upload stays with
// the page. The main side mirrors every push into resident columns first, so
// a worker failure just rebuilds inline from those — the fallback is free. ──
if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  let wb = null;
  const ship = (c) => {
    const transfers = new Set();
    for (const k in c) { const v = c[k]; if (v && ArrayBuffer.isView(v)) transfers.add(v.buffer); }
    self.postMessage({ chunk: c }, [...transfers]);
  };
  self.onmessage = (e) => {
    const m = e.data;
    try {
      if (m.init) {
        const frame = { origin: m.init.frameOrigin, crs: null, units: 'm' };
        wb = m.init.kind === 'blocks'
          ? createBlockChunkBuilder({
            frame, chunkSize: 1 << 18, seed: 1,
            grid: makeBlockGrid(m.init.axes.map(([origin, pitch, count]) => ({ origin, pitch, count })), frame),
            dimPalette: m.init.dimPalette || null,
            onChunk: ship,
          })
          : createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: ship });
      } else if (m.push) {
        wb.push(m.push);
        wb.flush();                                        // progressive at message granularity
      } else if (m.eof) {
        const doc = wb.flush();
        self.postMessage({ done: {
          count: doc.count, bboxLocal: [...doc.bboxLocal],
          chanRange: doc.chanRange ? [...doc.chanRange] : null,
        } });
      }
    } catch (err) {
      self.postMessage({ err: String((err && err.message) || err) });
    }
  };
}

// anywidget wants a DEFAULT export; @gcu/build emits named exports only (its
// rename-on-collision pass needs names). So this is named, and build.js appends
// the one-line `export default { render }` footer to the bundle.
function render({ model, el }) {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:100%;background:#121212;border-radius:3px;overflow:hidden;';
  // right-drag PANS, so JupyterLab's own context menu must stay out of the way.
  // This attribute is the supported hook: JupyterLab's handler does
  // `el.closest('[data-jp-suppress-context-menu]')` and stands down if it hits.
  host.setAttribute('data-jp-suppress-context-menu', 'true');
  host.addEventListener('contextmenu', (e) => e.preventDefault());
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  host.appendChild(canvas);
  // figure chrome + hole labels: a 2D overlay redrawn with every frame and
  // COMPOSITED into snapshots (DOM chrome would be lost by toDataURL)
  const deco = document.createElement('canvas');
  deco.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
  host.appendChild(deco);
  const hud = document.createElement('div');
  hud.className = 'cdhud';
  hud.style.cssText = 'position:absolute;left:6px;bottom:5px;font:11px ui-monospace,Menlo,Consolas,monospace;color:#8b8b8b;pointer-events:none;text-shadow:0 1px 2px #000;z-index:1;';
  host.appendChild(hud);
  el.appendChild(host);

  let renderer = null, edl = null, cam = null, detach = null, raf = 0, ro = null, tb = null;
  let payload = null, disposed = false, needFit = false, converged = false;
  let docBbox = null;
  let streams = null, streamEpoch = '';                    // cd.open(): layer → stream state, this view's epoch
  let fileQueue = Promise.resolve();                       // via='files' layers build sequentially (frame adoption)
  let fileMsg = null;                                      // a files-mode failure, pinned on the hud
  let userCam = false;                                     // the user framed a shot — auto-fit must not steal it
  const kinds = [];

  try {
    renderer = createRenderer(canvas, { background: [0.07, 0.07, 0.07, 1] });
    edl = createEdl(renderer.gl);
    cam = createOrbitCamera();
  } catch (e) {                                            // no WebGL2 (headless CI, locked-down VM)
    host.style.height = '80px';
    hud.style.cssText += 'position:static;padding:10px;color:#d07a5c;';
    hud.textContent = `condenser: ${e.message}`;
    return () => { el.innerHTML = ''; };
  }

  const styles = () => model.get('_styles') || [];
  const styleAt = (i) => styles()[i] || {};
  const viewOpts = () => {                                 // point size / points-view are VIEW-wide in the engine
    let pointPx = 2.5, asPoints = false;
    for (const s of styles()) if (s.visible !== false) { pointPx = Math.max(pointPx, s.point_size || 0); asPoints = asPoints || !!s.as_points; }
    return { pointPx, asPoints };
  };

  // ── the decorations overlay: hole labels + north arrow + scale bar. Redrawn
  // with every frame (2D, cheap) and COMPOSITED into snapshots. Coordinates
  // are frame-local, projected through the camera's viewProj — which already
  // carries the z-exaggeration, so labels track the stretched display. ──
  const drawOverlay = (w, h, dpr) => {
    if (deco.width !== w || deco.height !== h) { deco.width = w; deco.height = h; }
    const g = deco.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!payload) return;
    const W = w / dpr, H = h / dpr;
    g.save();
    g.scale(dpr, dpr);
    const vp = cam.state.viewProj;
    const proj = (X, Y, Z) => {
      const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
      if (cw <= 1e-9) return null;
      return [((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * W,
        (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * H];
    };
    const o = payload.frame;
    const halo = (text, x, y) => {
      g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 3; g.lineJoin = 'round';
      g.strokeText(text, x, y);
      g.fillText(text, x, y);
    };

    // hole labels (labels=True on a drillhole layer): BHIDs at the collars
    g.font = '10px ui-monospace,Menlo,Consolas,monospace';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillStyle = '#e4e4e4';
    styles().forEach((s, i) => {
      const L = payload.layers[i];
      if (!L || L.kind !== 'drillholes' || !s.labels || s.visible === false || !L._collars) return;
      let drawn2 = 0;
      for (const c of L._collars) {
        if (drawn2 >= 400) break;                          // a 10k-hole campaign is a texture, not labels
        const p = proj(c.x - o[0], c.y - o[1], c.z - o[2]);
        if (!p || p[0] < -20 || p[0] > W + 20 || p[1] < -10 || p[1] > H + 10) continue;
        halo(c.name, p[0], p[1] - 4);
        g.fillRect(p[0] - 1, p[1] - 2, 2, 2);              // the collar tick
        drawn2++;
      }
    });

    if (model.get('decorations') === false) { g.restore(); return; }
    // scale at the CAMERA TARGET depth: unproject a 100-px screen step on the
    // plane through the target, z divided back by zExag → REAL meters
    const t = cam.state.target;
    const inv = mat4Inverse(vp);
    const tp = proj(t[0], t[1], t[2]);
    if (inv && tp) {
      const cwT = vp[3] * t[0] + vp[7] * t[1] + vp[11] * t[2] + vp[15];
      const ndcZ = (vp[2] * t[0] + vp[6] * t[1] + vp[10] * t[2] + vp[14]) / cwT;
      const un = (sx, sy) => {
        const nx = (sx / W) * 2 - 1, ny = 1 - (sy / H) * 2;
        const x = inv[0] * nx + inv[4] * ny + inv[8] * ndcZ + inv[12];
        const y = inv[1] * nx + inv[5] * ny + inv[9] * ndcZ + inv[13];
        const z = inv[2] * nx + inv[6] * ny + inv[10] * ndcZ + inv[14];
        const w2 = inv[3] * nx + inv[7] * ny + inv[11] * ndcZ + inv[15];
        return [x / w2, y / w2, z / w2];
      };
      const p1 = un(tp[0], tp[1]), p2 = un(tp[0] + 100, tp[1]);
      const ze = cam.state.zExag || 1;
      const m100 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], (p2[2] - p1[2]) / ze);
      if (m100 > 1e-9 && Number.isFinite(m100)) {
        const pxPerM = 100 / m100;
        let len = Math.pow(10, Math.floor(Math.log10(120 / pxPerM)));
        for (const k of [5, 2, 1]) if (len * k * pxPerM <= 160) { len *= k; break; }
        const px = len * pxPerM;
        const label = len >= 1000 ? `${len / 1000} km` : `${len} m`;
        const bx0 = W / 2 - px / 2, by0 = H - 14;
        for (const [col, lw] of [['rgba(0,0,0,.7)', 4], ['#d8d8d8', 1.6]]) {
          g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'butt';
          g.beginPath();
          g.moveTo(bx0, by0); g.lineTo(bx0 + px, by0);
          g.moveTo(bx0, by0 - 4); g.lineTo(bx0, by0 + 4);
          g.moveTo(bx0 + px, by0 - 4); g.lineTo(bx0 + px, by0 + 4);
          g.stroke();
        }
        g.fillStyle = '#cfcfcf';
        halo(label, W / 2, by0 - 5);

        // north arrow, left of the bar — world +Y projected at the target.
        // Looking ALONG north the projection collapses: fade it rather than spin
        const np = proj(t[0], t[1] + m100, t[2]);
        if (np) {
          const dxn = np[0] - tp[0], dyn = np[1] - tp[1];
          const ln = Math.hypot(dxn, dyn);
          const alpha = Math.max(0, Math.min(1, ln / 40));
          if (alpha > 0.05) {
            const ang = Math.atan2(dyn, dxn);
            const cxN = bx0 - 30, cyN = by0 - 6;
            g.globalAlpha = alpha;
            g.save();
            g.translate(cxN, cyN); g.rotate(ang);
            g.beginPath();
            g.moveTo(11, 0); g.lineTo(-6, 4.5); g.lineTo(-3, 0); g.lineTo(-6, -4.5); g.closePath();
            g.fillStyle = '#d8d8d8'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 2;
            g.stroke(); g.fill();
            g.restore();
            g.fillStyle = '#d8d8d8';
            halo('N', cxN + Math.cos(ang) * 19, cyN + Math.sin(ang) * 19 + 4);
            g.globalAlpha = 1;
          }
        }
      }
    }
    g.restore();
  };

  const draw = () => {
    raf = 0;
    if (disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; renderer.invalidate(); }
    cam.setAspect(w / h);
    if (needFit && docBbox) { cam.fit(docBbox); needFit = false; }

    const layerOpts = {};
    styles().forEach((s, i) => {
      const cols = payload && payload.layers[i] ? payload.layers[i].cols : {};
      layerOpts[i] = { colorMode: modeOf(s.color, kinds[i], cols), clip: s.clip && s.clip.length === 2 ? s.clip : null };
    });
    const vo = viewOpts();
    const opts = {
      budget: model.get('budget') || 3_000_000,
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints, blockEdges: false,
      section: sectionOf(model.get('section'), (payload && payload.frame) || [0, 0, 0]),
      clip: null, layerOpts,
    };
    const r = edl.render(w, h, cam, () => renderer.draw(cam, opts),
      { enabled: model.get('edl') !== false, strength: model.get('edl_strength') != null ? model.get('edl_strength') : 1.0 });
    converged = r.converged;
    if (payload) {
      const tot = renderer.elementCount, acc = renderer.accumulated;
      const n = payload.layers.length;
      const what = n === 1
        ? (kinds[0] === 'blocks' ? 'blocks' : kinds[0] === 'drillholes' ? 'intervals'
          : kinds[0] === 'mesh' || kinds[0] === 'surface' ? 'triangles' : 'points')
        : `elements · ${n} layers`;
      hud.textContent = fileMsg || (converged ? `${tot.toLocaleString()} ${what}` : `${tot.toLocaleString()} · ${Math.round((100 * acc) / (tot || 1))}%`);
    }
    drawOverlay(w, h, dpr);
    pushCamera();                                          // debounced by value — idle frames are free
    if (!converged) schedule();
  };
  const schedule = () => { if (!raf && !disposed) raf = requestAnimationFrame(draw); };
  const invalidate = () => { renderer.invalidate(); schedule(); };

  // ── load: payload → chunk builders → GPU, one engine layer per data layer ──
  const load = () => {
    renderer.clearChunks();
    payload = null; docBbox = null; kinds.length = 0;
    if (streams) for (const k in streams) { const stw = streams[k] && streams[k].worker; if (stw) try { stw.terminate(); } catch { /* gone */ } }
    streams = null; streamEpoch = Math.random().toString(36).slice(2);
    fileQueue = Promise.resolve(); fileMsg = null;
    const p = decodePayload(model.get('_payload'));
    if (!p || !p.layers.length) { hud.textContent = 'no data'; if (tb) { tb.showPick(null); tb.syncLegend(null); } schedule(); return; }
    payload = p;
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

    p.layers.forEach((L, i) => {
      kinds[i] = L.kind;
      const lb = buildLayer(L, i);
      if (lb) {
        for (let a = 0; a < 3; a++) {
          if (lb[a] < bb[a]) bb[a] = lb[a];
          if (lb[a + 3] > bb[a + 3]) bb[a + 3] = lb[a + 3];
        }
      }
    });

    if (Number.isFinite(bb[0])) {                          // files-only views have no bbox YET
      docBbox = Float64Array.from(bb);
      renderer.setDocBbox(docBbox);
      if (!userCam) needFit = true;                        // never steal a framed shot on a data change
    }
    applyStyles();
    if (tb) { tb.showPick(null); syncChrome(); }
    invalidate();
    if (streams) model.send({ type: 'ready', epoch: streamEpoch });
  };

  // merge a layer's local bbox as it becomes known (files-mode discovery)
  const mergeBbox = (lb) => {
    if (!docBbox) docBbox = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (let a = 0; a < 3; a++) {
      if (lb[a] < docBbox[a]) docBbox[a] = lb[a];
      if (lb[a + 3] > docBbox[a + 3]) docBbox[a + 3] = lb[a + 3];
    }
    if (Number.isFinite(docBbox[0])) {
      renderer.setDocBbox(docBbox);
      if (!userCam) needFit = true;
    }
  };

  // ── via='files': discover + stream a file BROWSER-SIDE through the engine's
  // providers — the kernel never reads a byte. Sequential across layers: the
  // FIRST discovery may set the shared frame (payload.frame_auto). ──
  // the shared epilogue: a files layer finished discovering/streaming — frame
  // bookkeeping was done by the caller; here the styles, chrome, and the
  // kernel's view of what the browser found.
  const finishFileLayer = (L, i, doc) => {
    if (doc && doc.bboxLocal && Number.isFinite(doc.bboxLocal[0])) mergeBbox(doc.bboxLocal);
    applyStyles();
    if (tb) syncChrome();
    invalidate();
    try {                                                  // the kernel learns what the browser found
      const info = { ...(model.get('_file_info') || {}) };
      info[i] = { count: L.count, value_range: L.value_range || null,
        cat_labels: L.cat_labels || null, cat_n: L.cat_n || null };
      model.set('_file_info', info);
      model.save_changes();
    } catch { /* a detached test model */ }
  };
  const adoptFrame = (header) => {                         // a files-only view takes the first real frame
    if (payload.frame_auto) {
      payload.frame = documentFrame(header).origin;
      payload.frame_auto = false;
    }
    const frame = { origin: payload.frame, crs: null, units: 'm' };
    if (header.bbox && Number.isFinite(header.bbox.min[0])) {
      mergeBbox(Float64Array.of(
        header.bbox.min[0] - frame.origin[0], header.bbox.min[1] - frame.origin[1], header.bbox.min[2] - frame.origin[2],
        header.bbox.max[0] - frame.origin[0], header.bbox.max[1] - frame.origin[1], header.bbox.max[2] - frame.origin[2]));
    }
    return frame;
  };

  const buildFileLayer = async (L, i) => {
    const epoch = streamEpoch;
    try {
      // drillholes: THREE files (collar / survey / intervals) → desurveyed
      // capsules, the provider's own column sniff + optional value/category names
      if (L.file.drillholes) {
        const fd = L.file.drillholes;
        const [cb, sb, ib] = await Promise.all([resolveFilesBlob(fd.collar), resolveFilesBlob(fd.survey), resolveFilesBlob(fd.intervals)]);
        if (epoch !== streamEpoch || disposed) return;
        if (!cb || !sb || !ib) {
          fileMsg = `${L.file.name}: /files unreachable — jupyter-server serves it; elsewhere stream via the kernel`;
          schedule();
          return;
        }
        const opts = { method: fd.method || 'minimumCurvature', dipConvention: fd.dip_convention || 'auto' };
        const fm0 = L.file.map || null;
        if (fm0 && (fm0.value || fm0.category)) {          // value/category BY NAME → interval column indices
          const tIv = await readDelimited(ib.slice(0, Math.min(65536, ib.size)));
          const idx = (nm) => tIv.columns.findIndex((h2) => h2.trim() === nm);
          if (fm0.value) { const k2 = idx(fm0.value); if (k2 >= 0) opts.chan = k2; }
          if (fm0.category) { const k2 = idx(fm0.category); if (k2 >= 0) opts.cat = k2; }
        }
        const { header, streamChunks, recordPosition } = await openDrillholes({ collar: cb, survey: sb, intervals: ib }, opts);
        if (epoch !== streamEpoch || disposed) return;
        const frame = adoptFrame(header);
        kinds[i] = 'drillholes';
        const b = createStickChunkBuilder({ frame, chunkSize: 1 << 16, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        for await (const rc of streamChunks()) {
          if (epoch !== streamEpoch || disposed) return;
          b.push(rc);
        }
        const doc = b.flush();
        if (header.categories) { L.cat_labels = header.categories; L.cat_n = header.categories.length; renderer.setCategories(L.cat_n); }
        L.count = header.count;
        if (header.chanRange && Number.isFinite(header.chanRange[0])) L.value_range = header.chanRange;
        L._posAt = (r) => recordPosition(r);               // measure / readout off the desurveyed midpoints
        finishFileLayer(L, i, doc);
        return;
      }

      const blob = await resolveFilesBlob(L.file);
      if (epoch !== streamEpoch || disposed) return;
      if (!blob) {
        fileMsg = `${L.file.name}: /files unreachable — jupyter-server serves it; elsewhere stream via the kernel`;
        schedule();
        return;
      }
      const ext2 = (L.file.name.match(/\.([a-z0-9]+)$/i) || [0, ''])[1].toLowerCase();
      const fm = L.file.map || null;
      let opened;
      if (ext2 === 'parquet' || ext2 === 'pq') {
        opened = await openParquetBlocks(blob, { map: fm });
      } else if (ext2 === 'dm') {
        let mapping = null;
        if (fm && (fm.value || fm.category)) {             // .dm maps chan/cat by field name
          const names = await peekDmColumns(blob);
          if (names) {
            mapping = {};
            if (fm.value) { const k2 = names.indexOf(fm.value); if (k2 >= 0) mapping.chan = k2; }
            if (fm.category) { const k2 = names.indexOf(fm.category); if (k2 >= 0) mapping.cat = k2; }
          }
        }
        opened = await openDmModel(blob, { mapping });
      } else if (ext2 === 'las') {
        opened = await openLas(blob);
      } else if (ext2 === 'ply') {
        opened = await openPly(blob);
      } else {
        let mapping = null;
        if (fm) {                                          // delimited: names → sniffed column indices
          const sniff = sniffDelimited(await blob.slice(0, Math.min(65536, blob.size)).text());
          if (sniff.header) {
            const idx = (nm) => (nm == null ? -1 : sniff.header.findIndex((h2) => h2.trim() === nm));
            mapping = { ...(mapColumns(sniff.header) || {}) };
            for (const [k2, mk] of [['x', 'x'], ['y', 'y'], ['z', 'z'], ['chan', 'value'], ['cat', 'category']]) {
              const k3 = idx(fm[mk]);
              if (k3 >= 0) mapping[k2] = k3;
            }
            if (!(mapping.x >= 0 && mapping.y >= 0 && mapping.z >= 0)) mapping = null;
          }
        }
        opened = await openBlockModel(blob, { mapping });
      }
      if (epoch !== streamEpoch || disposed) return;
      const { header, streamChunks } = opened;
      const isBlocks = !!header.grid;
      if (!isBlocks && !(ext2 === 'las' || ext2 === 'ply')) {
        fileMsg = `${L.file.name}: not a regular block lattice — open resident, or as points via the kernel`;
        schedule();
        return;
      }
      const frame = adoptFrame(header);
      let b;
      if (isBlocks) {
        kinds[i] = 'blocks';
        const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], frame);
        b = createBlockChunkBuilder({
          frame, grid, chunkSize: 1 << 18, seed: 1,
          dimPalette: header.dimPalette || null,
          onChunk: (c) => renderer.addChunk(c, 'base', i),
        });
        if (header.categories) {
          L.cat_labels = header.categories;
          L.cat_n = header.categories.length;
          renderer.setCategories(L.cat_n);
        }
      } else {
        kinds[i] = 'points';
        b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        L.cols.value_u16 = L.cols.value_u16 || new Uint16Array(0);   // 'value' → the intensity channel
      }
      let got = 0;
      for await (const rc of streamChunks({ chunkPoints: 1 << 18 })) {
        if (epoch !== streamEpoch || disposed) return;
        b.push(rc);
        b.flush();                                         // progressive, chunk by chunk
        got += rc.count;
        invalidate();
      }
      const doc = b.flush();
      L.count = header.count || got;
      if (isBlocks && doc && Number.isFinite(doc.chanRange[0])) L.value_range = [doc.chanRange[0], doc.chanRange[1]];
      finishFileLayer(L, i, doc);
    } catch (e) {
      fileMsg = `${L.file.name}: ${e.message}`;
      schedule();
    }
  };

  // the ACTIVE value channel: a layer may ship several (value=["FE","SIO2"]);
  // the style's `value` names the live one, and switching re-aliases
  // L.cols.value / value_u16 / value_range so EVERY reader (the GPU build,
  // threshold, pick readout, legend) sees the chosen channel.
  const resolveChannel = (L, s) => {
    const names = L.value_channels || [];
    if (!names.length) return;
    if (!L._chans) {
      L._chans = names.map((nm, k) => ({
        name: nm,
        value: L.cols[k === 0 ? 'value' : 'value' + k],
        u16: L.cols[k === 0 ? 'value_u16' : 'value_u16_' + k],
        range: (L.value_ranges || [L.value_range])[k] || L.value_range,
      }));
    }
    let k = s && s.value ? L._chans.findIndex((c) => c.name === s.value) : 0;
    if (k < 0) k = 0;
    const c = L._chans[k];
    L.cols.value = c.value;
    if (c.u16) L.cols.value_u16 = c.u16;
    L.value_range = c.range;
    L._active = c.name;
  };

  // one layer → engine chunks. Shared by load() and rebuildLayer() (a channel
  // switch rebuilds just its own layer from the already-resident columns).
  // Returns the layer's local bbox (null while a streamed layer has no rows).
  const buildLayer = (L, i) => {
    if (L.file) {                                          // via='files': async browser-side read
      fileQueue = fileQueue.then(() => buildFileLayer(L, i));
      return null;
    }
    const frame = { origin: payload.frame, crs: null, units: 'm' };
    const cols = L.cols;
    resolveChannel(L, styleAt(i));
    let doc = null;
    if (L.kind === 'blocks') {
        const grid = makeBlockGrid(L.axes.map(([origin, pitch, count]) => ({ origin, pitch, count })), frame);
        const b = createBlockChunkBuilder({
          frame, grid, chunkSize: 1 << 18, seed: 1,
          dimPalette: L.dim_palette || null,               // sub-blocked: per-code half-dims
          onChunk: (c) => renderer.addChunk(c, 'base', i),
        });
        if (L.streamed) {
          // cd.open(): header-only in the payload — rows arrive as wire-v3
          // chunks over custom messages, pushed into this SAME builder with a
          // running recStart (progressive render for free). JS keeps only
          // ijk + value + cat (~11 B/block); positions reconstruct lazily.
          const n = L.count;
          const st = {
            b, got: 0, done: false, kind: 'blocks',
            i: new Uint16Array(n), j: new Uint16Array(n), k: new Uint16Array(n),
            dim: L.dim_palette ? new Uint8Array(n) : null,
            value: L.value_range ? new Float32Array(n) : null,
            cat: L.cat_n ? new Uint8Array(n) : null,
          };
          (streams = streams || {})[i] = st;
          if (st.value) L.cols.value = st.value;           // threshold/legend read these
          if (st.cat) L.cols.cat = st.cat;
          const [[x0, xp], [y0, yp], [z0, zp]] = L.axes;
          L._posAt = (r) => [x0 + st.i[r] * xp, y0 + st.j[r] * yp, z0 + st.k[r] * zp];
          L._ijk = { st, x0, xp, y0, yp, z0, zp };
          st.worker = spawnStreamWorker(L, i, st, {
            kind: 'blocks', frameOrigin: [...frame.origin], axes: L.axes, dimPalette: L.dim_palette || null,
          });
          if (L.cat_n) renderer.setCategories(L.cat_n);
          if (L.bbox) {                                    // header bbox (world) seeds the fit before rows land
            doc = { bboxLocal: Float64Array.from(L.bbox.map((v, a) => v - frame.origin[a % 3])) };
          }
        } else {
          let bx = cols.x, by = cols.y, bz = cols.z;
          if (L.pos === 'ijk') {
            // wire v3: u16 lattice indices → exact f64 coords (origin + index·pitch,
            // computed here in f64 — quantization without loss). Stashed as _pos so
            // the pick readout / measure / select-through read reconstructed coords.
            const [[x0, xp], [y0, yp], [z0, zp]] = L.axes;
            const n = L.count, I = cols.i, J = cols.j, K = cols.k;
            bx = new Float64Array(n); by = new Float64Array(n); bz = new Float64Array(n);
            for (let q = 0; q < n; q++) { bx[q] = x0 + I[q] * xp; by[q] = y0 + J[q] * yp; bz[q] = z0 + K[q] * zp; }
            L._pos = { x: bx, y: by, z: bz };
          }
          b.push({ count: L.count, x: bx, y: by, z: bz, chan: cols.value || null, cat: cols.cat || null, dim: cols.dim || null, recStart: 0 });
          doc = b.flush();
          if (L.cat_n) renderer.setCategories(L.cat_n);
        }
      } else if (L.kind === 'surface') {
        // a regular 2D grid → shaded relief (smooth normals, nodata holes),
        // colored by its own elevation or by the drape grid through the layer
        // ramp + clip. Rebuilt by rebuildLayer when ramp/clip/color change —
        // a DEM-sized mesh rebuilds in milliseconds.
        const grid = {
          nx: L.nx, ny: L.ny, data: cols.grid,
          x0: L.x0, y0: L.y0, dx: L.dx, dy: L.dy,
          nodata: L.nodata == null ? null : L.nodata,
        };
        const stride = L.stride || Math.max(1, Math.ceil(Math.sqrt((L.nx * L.ny * 2) / 2_000_000)));
        const m = buildHeightfieldMesh(grid, { stride, frame, flatZ: L.flat_z != null ? L.flat_z : null });
        if (m) {
          const s = styleAt(i);
          const hex = String(s.color || '').replace('#', '');
          if (hex.length !== 6) {                          // 'value': ramp the drape (or the elevation itself)
            let vals = m.values;
            if (L.drape && cols.drape) {
              // mirrors buildHeightfieldMesh's vertex walk (same stride, same
              // DEM-nodata skip) to sample the drape at each kept vertex
              const nd = grid.nodata;
              const bad = (v) => Number.isNaN(v) || (nd != null && (nd >= 1.7e38 ? v >= 1.7014e38 : v === nd));
              const cN = Math.floor((L.nx - 1) / stride) + 1, rN = Math.floor((L.ny - 1) / stride) + 1;
              const dv = [];
              for (let r = 0; r < rN; r++) {
                for (let c2 = 0; c2 < cN; c2++) {
                  const gr = Math.min(L.ny - 1, r * stride), gc = Math.min(L.nx - 1, c2 * stride);
                  if (bad(cols.grid[gr * L.nx + gc])) continue;
                  dv.push(cols.drape[gr * L.nx + gc]);
                }
              }
              vals = Float32Array.from(dv);
            }
            const range = (s.clip && s.clip.length === 2) ? s.clip : (L.value_range || [0, 1]);
            const px = rampPixels(256, RAMPS[s.ramp || 'viridis'] || undefined);
            const span = range[1] - range[0] || 1;
            const color = new Float32Array(vals.length * 3);
            for (let q = 0; q < vals.length; q++) {
              const t = Math.max(0, Math.min(255, Math.round(((vals[q] - range[0]) / span) * 255)));
              color[q * 3] = px[t * 4] / 255; color[q * 3 + 1] = px[t * 4 + 1] / 255; color[q * 3 + 2] = px[t * 4 + 2] / 255;
            }
            m.color = color;
          }
          L._surfKey = `${s.color}|${s.ramp}|${s.clip}`;   // rebuild trigger (see applyStyles)
          doc = m;
          renderer.addChunk(m, 'base', i);
        }
      } else if (L.kind === 'mesh') {
        // context tier: scenery, recordless, drawn whole. Vertices arrive f32
        // about the mesh's own center — add the f64 origin back, then
        // buildMeshChunk rebases to the SHARED frame (so meshes co-register
        // with the data layers and mine-grid coordinates stay exact).
        const [ox, oy, oz] = L.pos_origin || [0, 0, 0];
        const vertices = new Float64Array(cols.verts.length);
        for (let q = 0; q < cols.verts.length; q += 3) {
          vertices[q] = ox + cols.verts[q]; vertices[q + 1] = oy + cols.verts[q + 1]; vertices[q + 2] = oz + cols.verts[q + 2];
        }
        doc = buildMeshChunk({ vertices, triangles: cols.tris, frame });
        renderer.addChunk(doc, 'base', i);
      } else if (L.kind === 'drillholes') {
        if (!L._collars) {                                 // labels: BHID + world collar position
          const names = L.hole_names || [];
          L._collars = [];
          for (let q = 0; q < cols.c_bhid.length; q++) {
            const code = cols.c_bhid[q];
            L._collars.push({ name: names[code] != null ? names[code] : `#${code}`, x: cols.c_x[q], y: cols.c_y[q], z: cols.c_z[q] });
          }
        }
        // the desurvey is GEOMETRY — cache it; a value-channel switch only
        // needs the chan column re-read from the active channel by record
        let seg = L._seg;
        if (!seg) {
          seg = L._seg = drillholeSegments(L, cols);
        } else if (cols.value) {
          for (let q = 0; q < seg.count; q++) {
            const s2 = seg.recIdx[q];
            seg.chan[q] = Number.isFinite(cols.value[s2]) ? cols.value[s2] : 0;
          }
        }
        // the desurvey computes these, so stash the interval midpoints by ROW:
        // measure and the readout need a position for a drillhole pick too
        L._pos = { x: new Float64Array(L.count), y: new Float64Array(L.count), z: new Float64Array(L.count) };
        for (let q = 0; q < seg.count; q++) {
          const r = seg.recIdx[q];
          L._pos.x[r] = seg.x[q]; L._pos.y[r] = seg.y[q]; L._pos.z[r] = seg.z[q];
        }
        const b = createStickChunkBuilder({ frame, chunkSize: 1 << 16, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        b.push({ count: seg.count, ax: seg.ax, ay: seg.ay, az: seg.az, bx: seg.bx, by: seg.by, bz: seg.bz,
          x: seg.x, y: seg.y, z: seg.z, chan: seg.chan, cat: seg.cat, recIdx: seg.recIdx });
        doc = b.flush();
        if (L.cat_n) renderer.setCategories(L.cat_n);
      } else if (L.streamed) {
        // cd.open(kind='points'): f32 local positions stay RESIDENT (~17 B/pt —
        // a cloud has no lattice to reconstruct from), value/cat beside them;
        // the u16 intensity each chunk needs is quantized here from the
        // header's value_range.
        const b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        const n = L.count;
        const st = {
          b, got: 0, done: false, kind: 'points',
          x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
          value: L.value_range ? new Float32Array(n) : null,
          cat: L.cat_n ? new Uint8Array(n) : null,
        };
        (streams = streams || {})[i] = st;
        if (st.value) L.cols.value = st.value;
        if (st.cat) L.cols.cat = st.cat;
        const [ox, oy, oz] = L.pos_origin || [0, 0, 0];
        L._posAt = (r) => [ox + st.x[r], oy + st.y[r], oz + st.z[r]];
        L._pstream = { st, ox, oy, oz };
        st.worker = spawnStreamWorker(L, i, st, { kind: 'points', frameOrigin: [...frame.origin] });
        if (L.cat_n) renderer.setLayerCats(i, L.cat_n);
        if (L.bbox) doc = { bboxLocal: Float64Array.from(L.bbox.map((v, a) => v - frame.origin[a % 3])) };
      } else {
        const b = createChunkBuilder({ frame, chunkSize: 1 << 19, seed: 1, onChunk: (c) => renderer.addChunk(c, 'base', i) });
        let px = cols.x, py = cols.y, pz = cols.z;
        if (L.pos_origin) {
          // wire v3: f32 positions about the layer's bbox center — add the f64
          // origin back BEFORE the engine sees a coordinate (the float32 wall
          // never applies). Stashed as _pos for readout / measure / select-through.
          const [ox, oy, oz] = L.pos_origin;
          const n = L.count;
          px = new Float64Array(n); py = new Float64Array(n); pz = new Float64Array(n);
          for (let q = 0; q < n; q++) { px[q] = ox + cols.x[q]; py[q] = oy + cols.y[q]; pz[q] = oz + cols.z[q]; }
          L._pos = { x: px, y: py, z: pz };
        }
        b.push({
          count: L.count, x: px, y: py, z: pz,
          intensity: cols.value_u16 || new Uint16Array(L.count),
          classification: cols.cat || new Uint8Array(L.count),
          rgb: cols.rgb || null, recStart: 0,
        });
        doc = b.flush();
        if (L.cat_n) renderer.setLayerCats(i, L.cat_n);
      }
      return doc && doc.bboxLocal ? doc.bboxLocal : null;
  };

  // a value-channel switch rebuilds ONE layer's chunks from the resident
  // columns — no re-send from the kernel, the camera stays put
  const rebuildLayer = (i) => {
    const L = payload && payload.layers[i];
    if (!L || L.streamed || L.file) return;                // streamed/files layers carry one channel
    renderer.removeLayer(i);
    buildLayer(L, i);
    invalidate();
  };

  const quantIntensity = (vals, range, n) => {             // points color from u16 intensity
    const out = new Uint16Array(n);
    if (!vals || !range) return out;
    const [lo, hi] = range;
    const span = hi - lo || 1;
    for (let q = 0; q < n; q++) {
      const v = vals[q];
      out[q] = Number.isFinite(v) ? Math.max(0, Math.min(65535, Math.round(((v - lo) / span) * 65535))) : 0;
    }
    return out;
  };

  // ── the stream worker: chunk building off the main thread. The resident
  // columns are ALWAYS written first, so a worker failure at any point just
  // rebuilds inline from them — behavior-identical, only slower. ──
  const streamWorkerFail = (L, i, st, wk) => {
    try { wk.terminate(); } catch { /* gone */ }
    if (st.worker !== wk) return;
    st.worker = null;                                      // later chunks go inline
    renderer.removeLayer(i);
    const n = st.got;
    if (n) {
      if (st.kind === 'points') {
        const { ox, oy, oz } = L._pstream;
        const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
        for (let q = 0; q < n; q++) { x[q] = ox + st.x[q]; y[q] = oy + st.y[q]; z[q] = oz + st.z[q]; }
        st.b.push({ count: n, x, y, z, intensity: quantIntensity(st.value, L.value_range, n),
          classification: st.cat ? st.cat.subarray(0, n) : new Uint8Array(n), rgb: null, recStart: 0 });
      } else {
        const { x0, xp, y0, yp, z0, zp } = L._ijk;
        const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
        for (let q = 0; q < n; q++) { x[q] = x0 + st.i[q] * xp; y[q] = y0 + st.j[q] * yp; z[q] = z0 + st.k[q] * zp; }
        st.b.push({ count: n, x, y, z, chan: st.value ? st.value.subarray(0, n) : new Float32Array(n),
          cat: st.cat ? st.cat.subarray(0, n) : null, dim: st.dim ? st.dim.subarray(0, n) : null, recStart: 0 });
      }
      st.b.flush();
    }
    invalidate();
  };
  const spawnStreamWorker = (L, i, st, init) => {
    try {
      if (typeof Worker === 'undefined' || !import.meta.url) return null;
      const wk = new Worker(import.meta.url, { type: 'module' });
      wk.onmessage = (e) => {
        const m = e.data;
        if (disposed || !streams || streams[i] !== st) { try { wk.terminate(); } catch { /* gone */ } return; }
        if (m.chunk) {
          renderer.addChunk(m.chunk, 'base', i);
          invalidate();
        } else if (m.done) {
          if (m.done.bboxLocal && Number.isFinite(m.done.bboxLocal[0])) mergeBbox(Float64Array.from(m.done.bboxLocal));
          applyStyles();
          if (tb) syncChrome();
          invalidate();
          try { wk.terminate(); } catch { /* gone */ }
        } else if (m.err) {
          streamWorkerFail(L, i, st, wk);
        }
      };
      wk.onerror = () => streamWorkerFail(L, i, st, wk);
      wk.postMessage({ init });
      console.log('gcu.condenser: worker chunk builder engaged');
      return wk;
    } catch { return null; }                               // file://, odd CSP — inline is identical
  };

  // ── streamed chunks (cd.open): epoch-guarded wire-v3 batches into the open
  // builder — each push lands a chunk on the GPU, so the model renders as it
  // arrives, exactly like the engine streaming a file in micro. ──
  const asTyped = (b, T, n) => {
    if (!b) return null;
    const buf = ArrayBuffer.isView(b) ? b.buffer : b;
    const off = ArrayBuffer.isView(b) ? b.byteOffset : 0;
    if (off % T.BYTES_PER_ELEMENT === 0) return new T(buf, off, n);
    return new T(new Uint8Array(buf, off, n * T.BYTES_PER_ELEMENT).slice().buffer);
  };
  const onCustom = (content, buffers) => {
    if (disposed || !content || !streams || !payload) return;
    if (content.epoch !== streamEpoch) return;             // a stale stream another view requested
    const li = content.layer, st = streams[li];
    const L = payload.layers[li];
    if (!st || !L || st.done) return;
    if (content.type === 'chunk') {
      const names = content.cols || [];
      const cap = st.kind === 'points' ? st.x.length : st.i.length;
      const take = Math.min(content.rows >>> 0, cap - st.got);
      if (take <= 0) return;
      const TA = st.kind === 'points'
        ? { x: Float32Array, y: Float32Array, z: Float32Array, value: Float32Array, cat: Uint8Array }
        : { i: Uint16Array, j: Uint16Array, k: Uint16Array, dim: Uint8Array, value: Float32Array, cat: Uint8Array };
      const got = {};
      names.forEach((nm, bi) => { if (TA[nm]) got[nm] = asTyped(buffers[bi], TA[nm], take); });
      if (st.value && got.value) st.value.set(got.value.subarray(0, take), st.got);
      if (st.cat && got.cat) st.cat.set(got.cat.subarray(0, take), st.got);
      let raw;                                             // the builder push, worker or inline
      if (st.kind === 'points') {
        if (!got.x || !got.y || !got.z) return;
        st.x.set(got.x.subarray(0, take), st.got);
        st.y.set(got.y.subarray(0, take), st.got);
        st.z.set(got.z.subarray(0, take), st.got);
        const { ox, oy, oz } = L._pstream;
        const px2 = new Float64Array(take), py2 = new Float64Array(take), pz2 = new Float64Array(take);
        for (let q = 0; q < take; q++) { px2[q] = ox + got.x[q]; py2[q] = oy + got.y[q]; pz2[q] = oz + got.z[q]; }
        // the points pipeline colors from u16 intensity: quantize this batch
        // against the header's value range (fixed, so chunks agree)
        raw = { count: take, x: px2, y: py2, z: pz2,
          intensity: got.value ? quantIntensity(got.value, L.value_range, take) : new Uint16Array(take),
          classification: got.cat ? got.cat.slice(0, take) : new Uint8Array(take),
          rgb: null, recStart: st.got };
      } else {
        if (!got.i || !got.j || !got.k) return;
        st.i.set(got.i.subarray(0, take), st.got);
        st.j.set(got.j.subarray(0, take), st.got);
        st.k.set(got.k.subarray(0, take), st.got);
        if (st.dim && got.dim) st.dim.set(got.dim.subarray(0, take), st.got);
        const { x0, xp, y0, yp, z0, zp } = L._ijk;
        const bx = new Float64Array(take), by = new Float64Array(take), bz = new Float64Array(take);
        for (let q = 0; q < take; q++) {
          bx[q] = x0 + got.i[q] * xp; by[q] = y0 + got.j[q] * yp; bz[q] = z0 + got.k[q] * zp;
        }
        raw = { count: take, x: bx, y: by, z: bz,
          chan: got.value ? got.value.slice(0, take) : new Float32Array(take),   // the builder concats chan unconditionally
          cat: got.cat ? got.cat.slice(0, take) : null,
          dim: got.dim ? got.dim.slice(0, take) : null, recStart: st.got };
      }
      st.got += take;
      if (st.worker) {
        // Morton/quantize OFF the main thread; raw's arrays are fresh copies,
        // so they transfer — zero main-thread sort work per message
        const t2 = new Set();
        for (const k2 in raw) { const v = raw[k2]; if (v && ArrayBuffer.isView(v)) t2.add(v.buffer); }
        st.worker.postMessage({ push: raw }, [...t2]);
      } else {
        st.b.push(raw);
        st.b.flush();                                      // emit NOW — progressive at message granularity
        invalidate();                                      // new chunks restart the accumulation
      }
    } else if (content.type === 'eof') {
      st.done = true;
      if (st.worker) {
        st.worker.postMessage({ eof: true });              // its 'done' finishes bbox/styles/chrome
        return;
      }
      const doc = st.b.flush();
      if (doc && doc.bboxLocal && docBbox) {
        for (let a = 0; a < 3; a++) {
          if (doc.bboxLocal[a] < docBbox[a]) docBbox[a] = doc.bboxLocal[a];
          if (doc.bboxLocal[a + 3] > docBbox[a + 3]) docBbox[a + 3] = doc.bboxLocal[a + 3];
        }
        renderer.setDocBbox(docBbox);
      }
      applyStyles();                                       // threshold masks now see the full column
      if (tb) syncChrome();                                // legend over the final values
      invalidate();
    }
  };

  // ── styles: everything the engine keeps per LAYER ──
  const applyStyles = () => {
    if (!payload) return;
    styles().forEach((s, i) => {                           // chunk-rebuilding changes first
      const L = payload.layers[i];
      if (!L) return;
      if (L.kind === 'surface') {                          // surface color bakes into vertices
        if (L._surfKey != null && L._surfKey !== `${s.color}|${s.ramp}|${s.clip}`) rebuildLayer(i);
        return;
      }
      if (!L.value_channels || L.value_channels.length < 2) return;
      const want = s.value && L.value_channels.includes(s.value) ? s.value : L.value_channels[0];
      if (L._active && want !== L._active) rebuildLayer(i);   // value-channel switch
    });
    styles().forEach((s, i) => {
      const L = payload.layers[i];
      if (!L) return;
      renderer.setLayerVisible(i, s.visible !== false);
      renderer.setLayerOpacity(i, s.opacity == null ? 1 : s.opacity);
      renderer.setLayerSectioned(i, s.sectioned === undefined ? true : s.sectioned);
      const stops = RAMPS[s.ramp || 'viridis'];
      renderer.setLayerRamp(i, stops ? rampPixels(256, stops) : null);
      if (L.kind === 'blocks') renderer.setLayerEdges(i, !!s.block_edges);
      if (L.kind === 'drillholes') renderer.setLayerStickRadius(i, s.radius || 1.5);
      if (L.kind === 'mesh' || L.kind === 'surface') {
        const hx = String(s.color || '').replace('#', '');  // mesh/surface hex color is a TINT, not a mode
        if (hx.length === 6) {
          const v2 = parseInt(hx, 16);
          renderer.setLayerMeshStyle(i, { tint: [((v2 >> 16) & 255) / 255, ((v2 >> 8) & 255) / 255, (v2 & 255) / 255] });
        }
      }
      // per-class eyes: GPU-side cull by category code; composes with the
      // threshold mask, and hidden classes don't pick either
      const hid = s.categories_hidden;
      if (L.cat_labels && hid && hid.length) {
        const vis = new Uint8Array(256).fill(1);
        for (const lb of hid) { const k = L.cat_labels.indexOf(lb); if (k >= 0) vis[k] = 0; }
        renderer.setLayerCatVisibility(i, vis);
      } else {
        renderer.setLayerCatVisibility(i, null);
      }
      const v = L.cols.value, t = s.threshold;
      if (v && t && t.length === 2) {
        const mask = new Uint8Array(v.length);
        for (let q = 0; q < v.length; q++) mask[q] = (v[q] >= t[0] && v[q] <= t[1]) ? 1 : 0;
        renderer.setFilter(mask, { isolate: s.filter_mode !== 'dim' }, i);
      } else {
        renderer.setFilter(null, {}, i);
      }
    });
    schedule();
  };

  const applyBackground = () => {
    const hex = String(model.get('background') || '#121212').replace('#', '');
    if (hex.length !== 6) return;
    const v = parseInt(hex, 16);
    renderer.setBackground([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1]);
    schedule();
  };
  const applyHeight = () => { host.style.height = `${model.get('height') || 460}px`; invalidate(); };
  const applyZExag = () => {                               // display-only: queries stay in real coords
    cam.state.zExag = Math.max(0.1, +model.get('z_exaggeration') || 1);
    cam.update();
    invalidate();
  };

  // ── the camera as PYTHON STATE, in geologist terms. azimuth = bearing of the
  // VIEW direction (from north, clockwise); plunge positive downward; target in
  // WORLD coordinates. Orbit math: eye = target + r·[cosφcosθ, cosφsinθ, sinφ],
  // so the view's horizontal direction is (−cosθ, −sinθ) and plunge = φ. ──
  const camToDict = () => {
    const c = cam.state, o = (payload && payload.frame) || [0, 0, 0];
    const az = (Math.atan2(-Math.cos(c.theta), -Math.sin(c.theta)) * 180 / Math.PI + 360) % 360;
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      azimuth: r2(az), plunge: r2(c.phi * 180 / Math.PI), distance: r2(c.radius),
      target: [r2(c.target[0] + o[0]), r2(c.target[1] + o[1]), r2(c.target[2] + o[2])],
      ortho: !!c.ortho,
    };
  };
  let camLast = '';
  const pushCamera = () => {                               // called from draw(): debounce-by-value
    if (disposed) return;
    const j = JSON.stringify(camToDict());
    if (j === camLast) return;
    camLast = j;
    try { model.set('camera', JSON.parse(j)); model.save_changes(); } catch { /* detached */ }
  };
  const applyCamera = () => {
    const v = model.get('camera') || {};
    if (!Object.keys(v).length) return;
    const cur = camToDict();
    if (['azimuth', 'plunge', 'distance', 'ortho'].every((k) => v[k] == null || JSON.stringify(v[k]) === JSON.stringify(cur[k]))
      && (v.target == null || JSON.stringify(v.target) === JSON.stringify(cur.target))) return;   // our own echo
    const c = cam.state;
    if (v.azimuth != null) { const az = (+v.azimuth) * Math.PI / 180; c.theta = Math.atan2(-Math.cos(az), -Math.sin(az)); }
    if (v.plunge != null) c.phi = Math.max(-Math.PI / 2 + 0.011, Math.min(Math.PI / 2 - 0.011, (+v.plunge) * Math.PI / 180));
    if (v.distance != null) c.radius = Math.max(0.05, +v.distance);
    if (v.target) {
      const o = (payload && payload.frame) || [0, 0, 0];
      c.target = [v.target[0] - o[0], v.target[1] - o[1], v.target[2] - o[2]];
    }
    if (v.ortho != null) { cam.setOrtho(!!v.ortho); if (tb) tb.syncOrtho(!!v.ortho); }
    cam.update();
    userCam = true;                                        // a SET camera is sacred
    needFit = false;
    invalidate();
  };

  // ── the section's world extent along its normal, for the scrub slider ──
  const sectionExtent = (sec) => {
    if (!payload || !docBbox) return [0, 1];
    const n = normalOf(sec) || [0, 1, 0], o = payload.frame;
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 8; c++) {
      const p = [docBbox[(c & 1) ? 3 : 0], docBbox[(c & 2) ? 4 : 1], docBbox[(c & 4) ? 5 : 2]];
      const d = (p[0] + o[0]) * n[0] + (p[1] + o[1]) * n[1] + (p[2] + o[2]) * n[2];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi];
  };

  // the legend follows the first VISIBLE layer colored by value (a ramp) or by
  // category (a swatch list whose rows toggle that class's visibility)
  const CAT_PX = categoryPalettePixels(256);               // the SAME palette the shaders sample
  const toggleCat = (li, label) => {
    const next = styles().map((s, k) => {
      if (k !== li) return s;
      const hid = new Set(s.categories_hidden || []);
      if (hid.has(label)) hid.delete(label); else hid.add(label);
      return { ...s, categories_hidden: [...hid] };
    });
    model.set('_styles', next);                            // round-trips to the Python Layer
    model.save_changes();
    applyStyles();
    syncChrome();
  };
  const legendInfo = () => {
    const st = styles();
    for (let i = 0; i < st.length; i++) {
      const s = st[i], L = payload && payload.layers[i];
      if (!L || s.visible === false) continue;
      if (s.color === 'value') {
        const range = (s.clip && s.clip.length === 2) ? s.clip : (L.value_range || null);
        if (!range) continue;
        const stops = RAMPS[s.ramp || 'viridis'];
        // the ramp needs a NAME — with channel switching, "0.2 — 34" alone is ambiguous
        const label = (L._active && L._active !== 'value') ? L._active : (s.name || null);
        return { range, pixels: rampPixels(256, stops || undefined), label };
      }
      if (s.color === 'category' && L.cat_labels && L.cat_labels.length) {
        const hid = new Set(s.categories_hidden || []);
        return {
          cats: L.cat_labels.map((lb, k) => ({
            label: lb, rgb: [CAT_PX[k * 4], CAT_PX[k * 4 + 1], CAT_PX[k * 4 + 2]], hidden: hid.has(lb),
          })),
          onToggle: (lb) => toggleCat(i, lb),
        };
      }
    }
    return null;
  };

  const syncChrome = () => {
    if (!tb) return;
    const sec = model.get('section');
    tb.syncSection(sec, sec ? sectionExtent(sec) : null);
    tb.syncLegend(legendInfo());
    tb.syncOrtho(cam.state.ortho);
  };

  // camera presets — ONE implementation, shared by the toolbar and w.look()
  const setView = (k) => {
    const c = cam.state;
    if (k === 'plan') { c.theta = -Math.PI / 2; c.phi = Math.PI / 2 - 0.001; }
    else if (k === 'north') { c.theta = -Math.PI / 2; c.phi = 0; }
    else if (k === 'south') { c.theta = Math.PI / 2; c.phi = 0; }
    else if (k === 'east') { c.theta = Math.PI; c.phi = 0; }
    else if (k === 'west') { c.theta = 0; c.phi = 0; }
    else { c.theta = Math.PI / 4; c.phi = Math.PI / 5; }
    cam.update();
    userCam = true;                                        // a chosen view is a framed shot
    needFit = true; invalidate();
  };

  // the stored camera state. Applied on CHANGE *and* at load: a widget
  // displayed a second time (any cell whose value is the Viewer) builds a fresh
  // view, and it must not come up pointing somewhere else than its sibling.
  const applyView = () => {
    const v = model.get('_view') || {};
    if (v.name) setView(v.name);
    if (v.ortho != null) { cam.setOrtho(!!v.ortho); if (tb) tb.syncOrtho(!!v.ortho); }
    invalidate();
  };

  // GL + the decorations overlay composited — labels/scale bar/north arrow
  // belong in the figure. Shared by the toolbar button and w.snapshot().
  const compositeBlob = () => new Promise((res, rej) => {
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    const g2 = tmp.getContext('2d');
    g2.drawImage(canvas, 0, 0);                            // preserveDrawingBuffer keeps this valid
    if (deco.width) g2.drawImage(deco, 0, 0, tmp.width, tmp.height);
    tmp.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png');
  });

  // ── the toolbar ──
  const buildToolbar = () => {
    if (tb) { tb.destroy(); tb = null; }
    if (model.get('toolbar') === false) return;
    tb = createToolbar(host, {
      layers: () => (payload ? payload.layers.map((L, i) => ({ name: styleAt(i).name || L.kind, kind: L.kind, visible: styleAt(i).visible !== false })) : []),
      setStyle: (i, patch) => {
        const next = styles().map((s, k) => (k === i ? { ...s, ...patch } : s));
        model.set('_styles', next);                        // syncs back to the Python Layer
        model.save_changes();
        applyStyles();
        syncChrome();
      },
      fit: () => { needFit = true; invalidate(); },
      setView,
      toggleOrtho: () => { const on = !cam.state.ortho; cam.setOrtho(on); invalidate(); return on; },
      isOrtho: () => cam.state.ortho,
      getSection: () => model.get('section'),
      setSection: (s) => { model.set('section', s); model.save_changes(); syncChrome(); invalidate(); },
      snapshot: () => {
        schedule();
        requestAnimationFrame(async () => {
          try {
            const b = await compositeBlob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'condenser.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          } catch (e) { hud.textContent = `snapshot failed: ${e.message}`; }
        });
      },
      onToolChange: (t) => {
        tb.setBand(null);
        measA = null;
        canvas.style.cursor = (t === 'knife' || t === 'rect' || t === 'lasso' || t === 'measure') ? 'crosshair' : '';
      },
      clearSelection: () => { selected.clear(); pushSelection(); if (tb) tb.showPick(null); },
      toggleThrough: () => {
        const on = !model.get('select_through');
        model.set('select_through', on);
        model.save_changes();
        return on;
      },
    });
    syncChrome();
  };

  // ── pointer: pick / knife (the toolbar decides which) ──
  const relXY = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  // unproject a screen point onto the horizontal plane through the camera target
  const groundAt = (sx, sy) => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const inv = mat4Inverse(cam.state.viewProj);
    if (!inv) return null;
    const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2;
    const un = (z) => {
      const x = inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12];
      const y = inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13];
      const zz = inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14];
      const ww = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15];
      return [x / ww, y / ww, zz / ww];
    };
    const a = un(-1), b = un(1);
    const dz = b[2] - a[2];
    const tz = cam.state.target[2];
    if (Math.abs(dz) < 1e-9) return [a[0], a[1], tz];
    const t = (tz - a[2]) / dz;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tz];
  };

  const doKnife = (a, b) => {
    const p1 = groundAt(a[0], a[1]), p2 = groundAt(b[0], b[1]);
    if (!p1 || !p2) return;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const n = [-dy / len, dx / len, 0];                    // horizontal perpendicular to the drag
    const o = payload ? payload.frame : [0, 0, 0];
    const position = (p1[0] + o[0]) * n[0] + (p1[1] + o[1]) * n[1] + (p1[2] + o[2]) * n[2];
    const cur = model.get('section') || {};
    model.set('section', { normal: n, position, thickness: cur.thickness || 20 });
    model.save_changes();
    syncChrome();
    invalidate();
  };

  const pickInfo = (hit) => {
    if (!hit || !payload) return null;
    const L = payload.layers[hit.layer];
    if (!L) return null;
    const c = L.cols, r = hit.rec;
    const name = styleAt(hit.layer).name || L.kind;
    const rows = [];
    if (L.kind === 'drillholes') {
      const names = L.hole_names || [];
      const code = c.i_bhid ? c.i_bhid[r] : null;
      rows.push(['hole', code != null && names[code] != null ? names[code] : `#${code}`]);
      if (c.i_from) rows.push(['from–to', `${fmtN(c.i_from[r])} – ${fmtN(c.i_to[r])}`]);
    } else {
      const pc = L._pos || c;                              // wire v3 reconstructs into _pos
      const p3 = L._posAt ? L._posAt(r) : (pc.x ? [pc.x[r], pc.y[r], pc.z[r]] : null);
      if (p3) rows.push(['x y z', `${fmtN(p3[0])} ${fmtN(p3[1])} ${fmtN(p3[2])}`]);
    }
    if (c.value) rows.push([L._active && L._active !== 'value' ? L._active : 'value', fmtN(c.value[r])]);
    if (c.cat && L.cat_labels) rows.push(['category', L.cat_labels[c.cat[r]] ?? String(c.cat[r])]);
    rows.push(['row', String(r)]);
    return { title: name, rows };
  };

  // a record's WORLD position (blocks/points carry their columns; drillholes
  // get theirs from the desurvey stash above)
  const posOf = (li, rec) => {
    const L = payload && payload.layers[li];
    if (!L) return null;
    if (L._posAt) return L._posAt(rec);                    // streamed: lattice reconstruction
    const c = L._pos || L.cols;
    if (!c || !c.x) return null;
    return [c.x[rec], c.y[rec], c.z[rec]];
  };

  const pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const xa = poly[a][0], ya = poly[a][1], xb = poly[b][0], yb = poly[b][1];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  };

  // ── region selection. The ID buffer already answers "which record is at this
  // pixel" for the whole viewport, so a marquee is: render the region's ids,
  // keep the pixels inside the shape, and collect the records. Which means what
  // you select is exactly what you can SEE — occluded elements are not caught,
  // the same contract as a click. ──
  const selected = new Map();                              // layer → Set(row)
  const packSelection = () => {
    let n = 0, total = 0;
    for (const set of selected.values()) if (set.size) { n++; total += set.size; }
    const buf = new ArrayBuffer(4 + n * 8 + total * 4);
    const dv = new DataView(buf);
    dv.setUint32(0, n, true);
    let off = 4;
    for (const [li, set] of selected) {
      if (!set.size) continue;
      dv.setUint32(off, li, true); dv.setUint32(off + 4, set.size, true);
      off += 8;
      for (const r of set) { dv.setUint32(off, r, true); off += 4; }
    }
    return buf;
  };
  const pushSelection = () => {
    styles().forEach((_s, i) => {
      const L = payload && payload.layers[i];
      const set = selected.get(i);
      if (!L) return;
      if (!set || !set.size) { renderer.setLayerSelection(i, null); return; }
      const mask = new Uint8Array(L.count);
      for (const r of set) if (r < mask.length) mask[r] = 1;
      renderer.setLayerSelection(i, mask);
    });
    model.set('_sel_rows', new DataView(packSelection()));
    model.save_changes();
    schedule();
  };
  // ── SELECT THROUGH: the swept volume, not the visible surface.
  //
  // The ID buffer only ever names the FRONT-MOST element per pixel, so a
  // surface selection cannot reach what is behind. Through-mode projects every
  // record to the screen and tests the shape instead — the same construction
  // micro's selectVolume uses, minus the streaming, because the widget already
  // holds the columns.
  //
  // It defeats OCCLUSION, which is the point — but not display state: a hidden
  // layer, an isolate-filtered element or a block outside the section slab is
  // not merely hidden behind something, it is not being shown, so the tube does
  // not take it. (micro's version tests only layer visibility; this is the
  // stricter reading and the one that matches what you can see.)
  const selectThrough = (rectCss, polyCss, additive) => {
    const vp = cam.state.viewProj, o = payload.frame;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    const secAll = sectionOf(model.get('section'), o);
    if (!additive) selected.clear();
    styles().forEach((sty, li) => {
      const L = payload.layers[li];
      if (!L || sty.visible === false) return;
      const A = L._ijk || null;                            // streamed blocks: lattice accessor, only rows that arrived
      const P = L._pstream || null;                        // streamed points: resident local f32 + origin
      const c = L._pos || L.cols;
      if (!A && !P && (!c || !c.x)) return;
      const val = L.cols.value, th = sty.threshold;
      const iso = !!(val && th && th.length === 2 && sty.filter_mode !== 'dim');
      const sec = sty.sectioned === false ? null : secAll;
      let set = selected.get(li);
      if (!set) selected.set(li, set = new Set());
      const n = A ? A.st.got : P ? P.st.got : Math.min(L.count, c.x.length);
      for (let r = 0; r < n; r++) {
        if (iso && !(val[r] >= th[0] && val[r] <= th[1])) continue;
        let X, Y, Z;
        if (A) { X = A.x0 + A.st.i[r] * A.xp - o[0]; Y = A.y0 + A.st.j[r] * A.yp - o[1]; Z = A.z0 + A.st.k[r] * A.zp - o[2]; }
        else if (P) { X = P.ox + P.st.x[r] - o[0]; Y = P.oy + P.st.y[r] - o[1]; Z = P.oz + P.st.z[r] - o[2]; }
        else { X = c.x[r] - o[0]; Y = c.y[r] - o[1]; Z = c.z[r] - o[2]; }
        if (sec && Math.abs(X * sec.n[0] + Y * sec.n[1] + Z * sec.n[2] - sec.d) > sec.half) continue;
        const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
        if (cw <= 1e-9) continue;                          // behind the eye
        const px = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * W;
        if (px < rectCss.x || px > rectCss.x + rectCss.w) continue;
        const py = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * H;
        if (py < rectCss.y || py > rectCss.y + rectCss.h) continue;
        if (polyCss && !pointInPoly(px, py, polyCss)) continue;
        set.add(r);
      }
    });
    pushSelection();
    reportSelection();
  };

  const reportSelection = () => {
    if (!tb) return;
    const counts = [...selected.entries()].filter(([, v]) => v.size)
      .map(([li, v]) => [styleAt(li).name || `layer ${li}`, v.size.toLocaleString()]);
    tb.showPick(counts.length ? { title: model.get('select_through') ? 'selected (through)' : 'selected', rows: counts } : null);
  };

  const selectRegion = (rectCss, polyCss, additive) => {
    if (!payload) return;
    if (model.get('select_through')) return selectThrough(rectCss, polyCss, additive);
    const vo = viewOpts();
    const reg = renderer.pickRegion(rectCss, cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    if (!additive) selected.clear();
    if (reg && reg.data) {
      const { data, w: rw, h: rh, dpr } = reg;
      for (let row = 0; row < rh; row++) {
        for (let col = 0; col < rw; col++) {
          const i = (row * rw + col) * 4;
          const g = data[i + 1] >>> 0;
          if (g === 0xFFFFFFFF) continue;                  // nothing at this pixel
          if (polyCss) {                                   // lasso: rows are BOTTOM-UP
            const cx = rectCss.x + col / dpr;
            const cy = rectCss.y + (rh - 1 - row) / dpr;
            if (!pointInPoly(cx, cy, polyCss)) continue;
          }
          const li = g & 0xFFFF;
          let set = selected.get(li);
          if (!set) selected.set(li, set = new Set());
          set.add(data[i] >>> 0);
        }
      }
    }
    pushSelection();
    reportSelection();
  };

  // ── measure: two picks, then distance + bearing + plunge (the numbers a
  // geologist actually wants off two points) ──
  let measA = null;
  const doMeasure = (hit, xy) => {
    if (!hit) return;
    const p = posOf(hit.layer, hit.rec);
    if (!p) return;
    if (!measA) { measA = { p, xy }; if (tb) { tb.setBand('measure', xy, xy); tb.showPick({ title: 'measure', rows: [['from', `${fmtN(p[0])} ${fmtN(p[1])} ${fmtN(p[2])}`], ['', 'click a second element']] }); } return; }
    const a = measA.p, b = p;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dist = Math.hypot(dx, dy, dz);
    const horiz = Math.hypot(dx, dy);
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;   // from north, clockwise
    const plunge = -Math.atan2(dz, horiz) * 180 / Math.PI;              // + is downward
    model.set('measurement', {
      from: [a[0], a[1], a[2]], to: [b[0], b[1], b[2]],
      distance: dist, dx, dy, dz, bearing, plunge,
    });
    model.save_changes();
    if (tb) {
      tb.setBand('measure', measA.xy, xy);
      tb.showPick({ title: 'measure', rows: [
        ['distance', fmtN(dist)], ['dx dy dz', `${fmtN(dx)} ${fmtN(dy)} ${fmtN(dz)}`],
        ['bearing', `${fmtN(bearing)}\u00b0`], ['plunge', `${fmtN(plunge)}\u00b0`],
      ] });
    }
    measA = null;
  };

  let down = null, dragging = false, lasso = null;
  const DRAG_TOOLS = { knife: 'line', rect: 'rect', lasso: 'poly' };
  const onDown = (e) => {
    const t = tb ? tb.tool : 'pick';
    down = { xy: relXY(e), t, shift: e.shiftKey };
    if (DRAG_TOOLS[t]) {
      dragging = true;
      lasso = t === 'lasso' ? [relXY(e)] : null;
      e.stopPropagation(); e.preventDefault();
    }
  };
  const onMove = (e) => {
    if (!dragging || !down) return;
    e.stopPropagation();
    const xy = relXY(e);
    const kind = DRAG_TOOLS[down.t];
    if (kind === 'poly') {
      const last = lasso[lasso.length - 1];
      if (Math.hypot(xy[0] - last[0], xy[1] - last[1]) > 3) lasso.push(xy);
      if (tb) tb.setBand('poly', lasso);
    } else if (tb) tb.setBand(kind, down.xy, xy);
  };
  const onUp = (e) => {
    if (!down) return;
    const xy = relXY(e);
    const moved = Math.hypot(xy[0] - down.xy[0], xy[1] - down.xy[1]);
    if (dragging) {
      e.stopPropagation();
      dragging = false;
      const t0 = down.t, add = down.shift, a = down.xy, path = lasso;
      lasso = null; down = null;
      if (tb) tb.setBand(null);
      if (t0 === 'lasso') {
        // a lasso ENDS WHERE IT STARTED, so start-to-end displacement is ~0 for
        // every real loop — the twitch test has to be the path's EXTENT.
        if (!path || path.length < 3) return;
        const xsL = path.map((q) => q[0]), ysL = path.map((q) => q[1]);
        const x0 = Math.min(...xsL), y0 = Math.min(...ysL);
        const bw = Math.max(...xsL) - x0, bh = Math.max(...ysL) - y0;
        if (Math.max(bw, bh) < 8) return;
        selectRegion({ x: x0, y: y0, w: bw, h: bh }, path, add);
        return;
      }
      if (moved <= 8) return;                              // a twitch is not a gesture
      if (t0 === 'knife') { doKnife(a, xy); if (tb) tb.clearTool(); return; }
      if (t0 === 'rect') {
        selectRegion({ x: Math.min(a[0], xy[0]), y: Math.min(a[1], xy[1]), w: Math.abs(xy[0] - a[0]), h: Math.abs(xy[1] - a[1]) }, null, add);
      }
      return;
    }
    const t = down.t;
    down = null;
    if ((t !== 'pick' && t !== 'measure') || moved > 4 || !payload) return;   // a drag is navigation
    const vo = viewOpts();
    const hit = renderer.pick(xy[0], xy[1], cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    if (t === 'measure') { doMeasure(hit, xy); schedule(); return; }
    renderer.setPicked(hit || null);
    model.set('selection', hit ? { layer: hit.layer, name: styleAt(hit.layer).name || '', row: hit.rec } : {});
    model.save_changes();
    if (tb) tb.showPick(pickInfo(hit));
    schedule();
  };
  // hover readout (opt-in): the pick box follows the cursor — inspection
  // without clicking. Throttled; only under the plain pick tool.
  let hoverAt = 0;
  const onHover = (e) => {
    if (!model.get('hover') || !payload || !tb || dragging || down) return;
    if (tb.tool !== 'pick') return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const [hx, hy] = relXY(e);
    const vo = viewOpts();
    const hit = renderer.pick(hx, hy, cam, {
      pointPx: vo.pointPx, blocksAsPoints: vo.asPoints,
      section: sectionOf(model.get('section'), payload.frame),
    });
    tb.showPick(hit ? pickInfo(hit) : null);
  };
  const onHoverLeave = () => { if (model.get('hover') && tb) tb.showPick(null); };
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('pointerleave', onHoverLeave);

  // capture on the HOST so the knife can pre-empt the orbit handlers bound to
  // the canvas (capture runs parent → target)
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);

  detach = attachOrbitInput(canvas, cam, { onChange: () => { userCam = true; schedule(); if (tb) tb.syncOrtho(cam.state.ortho); } });

  const subs = [
    ['change:_payload', load],
    ['change:_styles', () => { applyStyles(); syncChrome(); invalidate(); }],
    ['change:section', () => { syncChrome(); invalidate(); }],
    ['change:background', applyBackground],
    ['change:height', applyHeight],
    ['change:z_exaggeration', applyZExag],
    ['change:decorations', invalidate],
    ['change:toolbar', buildToolbar],
    ['change:edl', invalidate], ['change:edl_strength', invalidate], ['change:budget', invalidate],
    ['change:_fit', () => { needFit = true; invalidate(); }],
    ['change:_clear_sel', () => { selected.clear(); pushSelection(); if (tb) tb.showPick(null); }],
    ['change:select_through', () => { if (tb) tb.syncThrough(model.get('select_through')); }],
    ['change:_view', applyView],
    ['change:camera', applyCamera],
    ['change:hover', () => { if (!model.get('hover') && tb) tb.showPick(null); }],
    ['change:_snapshot_req', () => {                       // w.snapshot(): PNG bytes back to the kernel
      schedule();
      requestAnimationFrame(async () => {
        try {
          const b = await compositeBlob();
          model.set('snapshot_png', new DataView(await b.arrayBuffer()));
          model.save_changes();
        } catch { /* headless contexts without toBlob */ }
      });
    }],
    ['msg:custom', onCustom],
  ];
  for (const [ev, fn] of subs) model.on(ev, fn);

  ro = new ResizeObserver(() => invalidate());
  ro.observe(host);
  applyHeight();
  applyBackground();
  applyZExag();                                            // a re-displayed widget must match its stored state
  buildToolbar();
  if (tb) tb.syncThrough(model.get('select_through'));
  load();
  applyView();                                             // match any camera state already on the widget
  applyCamera();                                           // a stored numeric camera wins over the preset

  return () => {
    disposed = true;
    if (streams) for (const k in streams) { const stw = streams[k] && streams[k].worker; if (stw) try { stw.terminate(); } catch { /* gone */ } }
    if (raf) cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    if (detach) detach();
    if (tb) tb.destroy();
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('pointermove', onMove, true);
    host.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointermove', onHover);
    canvas.removeEventListener('pointerleave', onHoverLeave);
    for (const [ev, fn] of subs) model.off(ev, fn);
    try { renderer.clearChunks(); } catch { /* context already gone */ }
    const lose = renderer.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    el.innerHTML = '';
  };
}

export {
  render,
};

export default { render };
