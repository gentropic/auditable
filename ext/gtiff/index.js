// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/gtiff — Minimal WASM-free GeoTIFF reader — classic TIFF, strips+tiles, none/LZW/deflate/PackBits, predictors 2+3, overview pyramid, geo identity (scale+tiepoint+EPSG, never reprojection)

// ── src/lzw.js ──

// TIFF-variant LZW (Compression=5): MSB-first packed codes, Clear=256,
// EOI=257, code width grows 9→12 bits with the TIFF "early change" (the
// width bumps when the NEXT code would hit (1<<width)-1, one entry before
// the table is actually full — the historical off-by-one every writer ships).

function lzwDecode(src, dstLen) {
  const out = new Uint8Array(dstLen);
  const CLEAR = 256, EOI = 257;
  // dictionary as (prefix code, appended byte) pairs — no byte-array churn
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let next = 258, width = 9;
  let bitBuf = 0, bitCnt = 0, ip = 0, op = 0;
  let prev = -1;

  const emit = (code) => {
    let sp = 0, c = code;
    while (c >= 256) { stack[sp++] = suffix[c]; c = prefix[c]; }
    stack[sp++] = c;
    const first = c;
    while (sp > 0 && op < dstLen) out[op++] = stack[--sp];
    return first;
  };

  while (ip < src.length && op < dstLen) {
    bitBuf = (bitBuf << 8) | src[ip++];
    bitCnt += 8;
    while (bitCnt >= width) {
      const code = (bitBuf >>> (bitCnt - width)) & ((1 << width) - 1);
      bitCnt -= width;
      if (code === EOI) return out;
      if (code === CLEAR) { next = 258; width = 9; prev = -1; continue; }
      let first;
      if (code < next) {
        first = emit(code);
      } else if (code === next && prev >= 0) {
        // the KwKwK case: entry being defined is prev + first byte of prev
        let c = prev;
        while (c >= 256) c = prefix[c];
        prefix[next] = prev; suffix[next] = c;
        first = emit(next);
        prev = code; next++;
        if (next === (1 << width) - 1 && width < 12) width++;   // early change: bump as entry 2^w-1 is defined (libtiff-verified)
        continue;
      } else {
        throw new Error(`gtiff: corrupt LZW stream (code ${code} ≥ table ${next})`);
      }
      if (prev >= 0 && next < 4096) { prefix[next] = prev; suffix[next] = first; next++; }
      prev = code;
      if (next === (1 << width) - 1 && width < 12) width++;   // early change: bump as entry 2^w-1 is defined (libtiff-verified)
    }
  }
  return out;
}

// ── src/codec.js ──

// Segment codecs shared by strips and tiles: PackBits, Deflate (native
// DecompressionStream — the reason this reader can stay WASM-free), and the
// two predictors. A "segment" is one strip or one tile: predictors run per
// SEGMENT row (width = the segment's row width, not the image's).


function packbitsDecode(src, dstLen) {
  const out = new Uint8Array(dstLen);
  let ip = 0, op = 0;
  while (ip < src.length && op < dstLen) {
    const n = (src[ip++] << 24) >> 24;                     // sign-extend
    if (n >= 0) { for (let i = 0; i <= n && ip < src.length; i++) out[op++] = src[ip++]; }
    else if (n !== -128) { const v = src[ip++]; for (let i = 0; i < 1 - n; i++) out[op++] = v; }
  }
  return out;
}

async function inflate(src, format) {
  const ds = new DecompressionStream(format);
  const stream = new Blob([src]).stream().pipeThrough(ds);
  const chunks = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let op = 0;
  for (const c of chunks) { out.set(c, op); op += c.length; }
  return out;
}

// COMPRESSION tag → decoder. 8 and 32946 are both zlib-wrapped deflate.
async function decodeSegment(compression, src, dstLen) {
  switch (compression) {
    // COPY (never a view into the file) — downstream undoes predictors and
    // swaps endianness IN PLACE, and segments may be decoded more than once
    case 1: { const o = new Uint8Array(dstLen); o.set(src.subarray(0, Math.min(dstLen, src.length))); return o; }
    case 5: return lzwDecode(src, dstLen);
    case 8: case 32946: return inflate(src, 'deflate');
    case 32773: return packbitsDecode(src, dstLen);
    default: throw new Error(`gtiff: unsupported compression ${compression} (have: none, LZW, deflate, PackBits)`);
  }
}

// Predictor 2 — horizontal differencing on SAMPLE values, per row.
function undoPredictor2(bytes, rowWidth, rows, bytesPerSample, samplesPerPixel, littleEndian) {
  const spp = samplesPerPixel;
  if (bytesPerSample === 1) {
    for (let r = 0; r < rows; r++) {
      const off = r * rowWidth * spp;
      for (let i = spp; i < rowWidth * spp; i++) bytes[off + i] = (bytes[off + i] + bytes[off + i - spp]) & 0xff;
    }
  } else if (bytesPerSample === 2) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let r = 0; r < rows; r++) {
      const off = r * rowWidth * spp * 2;
      for (let i = spp; i < rowWidth * spp; i++) {
        const at = off + i * 2, prevAt = at - spp * 2;
        v.setUint16(at, (v.getUint16(at, littleEndian) + v.getUint16(prevAt, littleEndian)) & 0xffff, littleEndian);
      }
    }
  } else if (bytesPerSample === 4) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let r = 0; r < rows; r++) {
      const off = r * rowWidth * spp * 4;
      for (let i = spp; i < rowWidth * spp; i++) {
        const at = off + i * 4, prevAt = at - spp * 4;
        v.setUint32(at, (v.getUint32(at, littleEndian) + v.getUint32(prevAt, littleEndian)) >>> 0, littleEndian);
      }
    }
  } else throw new Error(`gtiff: predictor 2 with ${bytesPerSample}-byte samples`);
}

// Predictor 3 — floating-point: each row was byte-plane-shuffled (all MSBs,
// then next bytes…, big-endian planes) and horizontally byte-diffed. Undo =
// cumulative-sum the row bytes, then de-shuffle back to per-sample order.
function undoPredictor3(bytes, rowWidth, rows, bytesPerSample, samplesPerPixel, littleEndian) {
  const w = rowWidth * samplesPerPixel;                    // samples per row
  const rowBytes = w * bytesPerSample;
  const tmp = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const off = r * rowBytes;
    for (let i = 1; i < rowBytes; i++) bytes[off + i] = (bytes[off + i] + bytes[off + i - 1]) & 0xff;
    tmp.set(bytes.subarray(off, off + rowBytes));
    for (let i = 0; i < w; i++) {
      for (let b = 0; b < bytesPerSample; b++) {
        // plane b holds byte b (big-endian significance) of every sample
        const src = tmp[b * w + i];
        bytes[off + i * bytesPerSample + (littleEndian ? bytesPerSample - 1 - b : b)] = src;
      }
    }
  }
}

// ── src/read.js ──

// @gcu/gtiff — a minimal, WASM-free GeoTIFF reader. Classic TIFF (little or
// big endian), strips AND tiles, compression none/LZW/deflate/PackBits,
// predictors 2 (horizontal) and 3 (floating point), sample formats
// uint/int/float at 8/16/32/64 bits. The IFD chain is exposed as
// images[0..n] — a COG's overview pyramid arrives for free (coarse level
// first = an instant full-extent surface; refinement can come later).
// Geo-referencing is IDENTITY ONLY (@gcu/frame's rule): pixel scale +
// tiepoint + EPSG code out, never a reprojection. Total-function ethos:
// structural failures throw with a plain message, ignorable oddities land
// in warnings.


const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const PLATFORM_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// A byte SOURCE: random access by (offset, length) without holding the file. A
// Blob/File is read in slices (a multi-GB DEM never becomes one ArrayBuffer — past
// ~2 GB the browser refuses that read outright); bytes in memory are subarrayed.
// The head is cached: IFDs, tag arrays and a COG's whole directory live there.
const HEAD_CACHE = 1 << 20;
async function byteSource(input, headCache = HEAD_CACHE) {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const size = input.size;
    const head = new Uint8Array(await input.slice(0, Math.min(size, headCache)).arrayBuffer());
    return {
      size, lazy: true,
      async read(off, len) {
        if (off + len <= head.length) return head.subarray(off, off + len);
        return new Uint8Array(await input.slice(off, Math.min(size, off + len)).arrayBuffer());
      },
    };
  }
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  return { size: bytes.length, lazy: false, read: async (off, len) => bytes.subarray(off, Math.min(bytes.length, off + len)) };
}

// segments → [segment, raw bytes] in order, with NEARBY segments coalesced into one
// read (a strip-per-row TIFF has a strip per row; one slice read each would be
// tens of thousands of reads). Gaps up to COALESCE_GAP are read through; a run
// stops at COALESCE_MAX.
const COALESCE_GAP = 64 << 10, COALESCE_MAX = 16 << 20;
async function* segmentBytes(src, segs) {
  if (!src.lazy) { for (const s of segs) yield [s, await src.read(s.off, s.len)]; return; }
  let i = 0;
  while (i < segs.length) {
    let j = i + 1, lo = segs[i].off, hi = segs[i].off + segs[i].len;
    while (j < segs.length) {
      const s = segs[j];
      if (s.off < hi || s.off - hi > COALESCE_GAP || Math.max(hi, s.off + s.len) - lo > COALESCE_MAX) break;
      hi = Math.max(hi, s.off + s.len); j++;
    }
    const buf = await src.read(lo, hi - lo);
    for (let k = i; k < j; k++) yield [segs[k], buf.subarray(segs[k].off - lo, segs[k].off - lo + segs[k].len)];
    i = j;
  }
}

function readValues(view, bytes, off, type, count, le) {
  const size = TYPE_SIZE[type] || 1;
  const total = size * count;
  // values ≤ 4 bytes live inline in the entry, else the entry holds an offset
  return decodeValues(view, bytes, total <= 4 ? off : view.getUint32(off, le), type, count, le);
}
function decodeValues(view, bytes, at, type, count, le) {
  const size = TYPE_SIZE[type] || 1;
  if (type === 2) {                                        // ASCII (NUL-terminated)
    let s = '';
    for (let i = 0; i < count; i++) { const c = bytes[at + i]; if (c === 0) break; s += String.fromCharCode(c); }
    return s;
  }
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const p = at + i * size;
    switch (type) {
      case 1: case 7: out[i] = bytes[p]; break;
      case 3: out[i] = view.getUint16(p, le); break;
      case 4: out[i] = view.getUint32(p, le); break;
      case 5: out[i] = view.getUint32(p, le) / view.getUint32(p + 4, le); break;
      case 6: out[i] = view.getInt8(p); break;
      case 8: out[i] = view.getInt16(p, le); break;
      case 9: out[i] = view.getInt32(p, le); break;
      case 10: out[i] = view.getInt32(p, le) / view.getInt32(p + 4, le); break;
      case 11: out[i] = view.getFloat32(p, le); break;
      case 12: out[i] = view.getFloat64(p, le); break;
      default: out[i] = 0;
    }
  }
  return out;
}

function swapBytes(bytes, bytesPerSample) {
  if (bytesPerSample === 2) {
    for (let i = 0; i < bytes.length; i += 2) { const t = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = t; }
  } else if (bytesPerSample === 4) {
    for (let i = 0; i < bytes.length; i += 4) {
      let t = bytes[i]; bytes[i] = bytes[i + 3]; bytes[i + 3] = t;
      t = bytes[i + 1]; bytes[i + 1] = bytes[i + 2]; bytes[i + 2] = t;
    }
  } else if (bytesPerSample === 8) {
    for (let i = 0; i < bytes.length; i += 8) for (let b = 0; b < 4; b++) { const t = bytes[i + b]; bytes[i + b] = bytes[i + 7 - b]; bytes[i + 7 - b] = t; }
  }
}

function typedView(buffer, fmt, bps) {
  if (fmt === 3) return bps === 64 ? new Float64Array(buffer) : new Float32Array(buffer);
  if (fmt === 2) return bps === 8 ? new Int8Array(buffer) : bps === 16 ? new Int16Array(buffer) : new Int32Array(buffer);
  return bps === 8 ? new Uint8Array(buffer) : bps === 16 ? new Uint16Array(buffer) : new Uint32Array(buffer);
}

function parseGeo(tags, warnings) {
  const geo = { origin: null, scale: null, pixelIsPoint: false, crs: null, nodata: null };
  const scale = tags.get(33550);                           // ModelPixelScale
  const tie = tags.get(33922);                             // ModelTiepoint
  const xf = tags.get(34264);                              // ModelTransformation
  if (scale && tie) {
    geo.scale = [scale[0], scale[1]];
    // tiepoint maps raster (i,j) → model (X,Y); normalize to raster (0,0)
    geo.origin = [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]];
  } else if (xf) {
    if (xf[1] !== 0 || xf[4] !== 0) warnings.push('rotated ModelTransformation — axis-aligned reading only, geo dropped');
    else { geo.origin = [xf[3], xf[7]]; geo.scale = [xf[0], -xf[5]]; }
  }
  const dir = tags.get(34735);                             // GeoKeyDirectory
  if (dir && dir.length >= 4) {
    const n = dir[3];
    for (let k = 0; k < n; k++) {
      const id = dir[4 + k * 4], loc = dir[5 + k * 4], val = dir[7 + k * 4];
      if (loc !== 0) continue;                             // only inline short keys matter to us
      if (id === 1025 && val === 2) geo.pixelIsPoint = true;
      if (id === 3072 && val > 0 && val < 32767) geo.crs = `EPSG:${val}`;
      if (id === 2048 && !geo.crs && val > 0 && val < 32767) geo.crs = `EPSG:${val}`;
    }
  }
  const nd = tags.get(42113);                              // GDAL_NODATA (ascii)
  if (typeof nd === 'string') { const v = parseFloat(nd); if (Number.isFinite(v)) geo.nodata = v; else if (/^\s*[+-]?nan\s*$/i.test(nd)) geo.nodata = NaN; }   // GDAL writes "nan" for float rasters
  return geo;
}

// readGTiff(Blob | File | ArrayBuffer | Uint8Array). A Blob is NEVER read whole:
// the IFD chain and tag arrays come from slices, pixels from coalesced segment
// reads — so a DEM bigger than any one buffer opens, and a window costs its tiles.
async function readGTiff(input, { headCache } = {}) {
  const src = await byteSource(input, headCache);
  if (src.size < 8) throw new Error('gtiff: not a TIFF (too short)');
  const hb = await src.read(0, 8);
  const hv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
  const bo = hv.getUint16(0, false);
  const le = bo === 0x4949;                                // 'II'
  if (!le && bo !== 0x4d4d) throw new Error('gtiff: not a TIFF (bad byte-order mark)');
  const magic = hv.getUint16(2, le);
  if (magic === 43) throw new Error('gtiff: BigTIFF not supported yet (classic TIFF only)');
  if (magic !== 42) throw new Error(`gtiff: not a TIFF (magic ${magic})`);

  const warnings = [];
  const ifds = [];
  let off = hv.getUint32(4, le);
  while (off && ifds.length < 64) {
    if (off + 2 > src.size) { warnings.push(`IFD offset ${off} past the end of the file — chain cut`); break; }
    const cb = await src.read(off, 2);
    const count = new DataView(cb.buffer, cb.byteOffset, 2).getUint16(0, le);
    const eb = await src.read(off + 2, count * 12 + 4);
    const ev = new DataView(eb.buffer, eb.byteOffset, eb.byteLength);
    const tags = new Map();
    for (let i = 0; i < count; i++) {
      const e = i * 12;
      const tag = ev.getUint16(e, le), type = ev.getUint16(e + 2, le), n = ev.getUint32(e + 4, le);
      if (!TYPE_SIZE[type]) continue;
      const total = TYPE_SIZE[type] * n;
      if (total <= 4) { tags.set(tag, readValues(ev, eb, e + 8, type, n, le)); continue; }
      const vb = await src.read(ev.getUint32(e + 8, le), total);  // out-of-line values (tile offsets, geokeys…)
      tags.set(tag, decodeValues(new DataView(vb.buffer, vb.byteOffset, vb.byteLength), vb, 0, type, n, le));
    }
    ifds.push(tags);
    off = ev.byteLength >= count * 12 + 4 ? ev.getUint32(count * 12, le) : 0;
  }
  if (!ifds.length) throw new Error('gtiff: no IFDs');

  const mkImage = (tags) => {
    const one = (t, d) => { const v = tags.get(t); return v == null ? d : (typeof v === 'string' ? v : v[0]); };
    const width = one(256), height = one(257);
    if (!width || !height) return null;                    // not an image IFD
    const bps = one(258, 1), compression = one(259, 1), spp = one(277, 1);
    const fmt = one(339, 1), predictor = one(317, 1), planar = one(284, 1);
    const tileW = one(322, 0), tileH = one(323, 0);
    const img = {
      width, height, bitsPerSample: bps, sampleFormat: fmt, samplesPerPixel: spp,
      compression, predictor, tiled: tileW > 0,
      tileWidth: tileW || undefined, tileHeight: tileH || undefined,
      reduced: (one(254, 0) & 1) === 1,
      // the strip/tile segments overlapping a pixel window (all of them if no
      // window) — each { off, len, x0, y0, w, rows } in image pixel space
      segments(win) {
        const list = [];
        const hit = (x0, y0, w, rows) => !win || (x0 < win.x + win.width && x0 + w > win.x && y0 < win.y + win.height && y0 + rows > win.y);
        if (tileW > 0) {
          const offs = tags.get(324) || [], counts = tags.get(325) || [];
          const across = Math.ceil(width / tileW);
          for (let i = 0; i < offs.length; i++) {
            const x0 = (i % across) * tileW, y0 = Math.floor(i / across) * tileH;
            if (hit(x0, y0, tileW, tileH)) list.push({ off: offs[i], len: counts[i], x0, y0, w: tileW, rows: tileH });
          }
        } else {
          const offs = tags.get(273) || [], counts = tags.get(279) || [];
          const rps = one(278, height);
          for (let i = 0; i < offs.length; i++) {
            const y0 = i * rps, rows = Math.min(rps, height - y0);
            if (hit(0, y0, width, rows)) list.push({ off: offs[i], len: counts[i], x0: 0, y0, w: width, rows });
          }
        }
        return list;
      },
      // decode one segment → native-endian bytes, predictor undone
      async decodeSeg(s, bytesPer, raw) {
        if (!raw) raw = await src.read(s.off, s.len);
        const seg = await decodeSegment(compression, raw, s.w * s.rows * spp * bytesPer);
        if (predictor === 2) undoPredictor2(seg, s.w, s.rows, bytesPer, spp, le);
        else if (predictor === 3) undoPredictor3(seg, s.w, s.rows, bytesPer, spp, le);
        else if (predictor !== 1) throw new Error(`gtiff: predictor ${predictor} not supported`);
        if (le !== PLATFORM_LE && bytesPer > 1) swapBytes(seg, bytesPer);
        return seg;
      },
      // assemble a pixel window [x,y,width,height] (default = the whole image)
      // by decoding ONLY the overlapping segments. Cheap random-access on a
      // tiled image / COG overview; strips still decode a whole strip-row.
      async readWindow(win, band = 0) {
        if (planar !== 1) throw new Error('gtiff: planar (band-separate) layout not supported');
        if (![8, 16, 32, 64].includes(bps)) throw new Error(`gtiff: ${bps}-bit samples not supported`);
        if (fmt === 3 && bps < 32) throw new Error('gtiff: half-float not supported');
        const bytesPer = bps / 8;
        const w = win ? { x: Math.max(0, win.x | 0), y: Math.max(0, win.y | 0) } : { x: 0, y: 0 };
        w.width = win ? Math.min((win.width | 0), width - w.x) : width;
        w.height = win ? Math.min((win.height | 0), height - w.y) : height;
        if (w.width <= 0 || w.height <= 0) throw new Error('gtiff: empty window');
        const out = new Uint8Array(w.width * w.height * spp * bytesPer);
        const rowOut = w.width * spp * bytesPer;
        const segs = this.segments(win ? w : null);
        if (!segs.length) throw new Error('gtiff: no strip/tile offsets');
        for await (const [s, raw] of segmentBytes(src, segs)) {
          const seg = await this.decodeSeg(s, bytesPer, raw);
          const rowSeg = s.w * spp * bytesPer;
          const oc0 = Math.max(s.x0, w.x), oc1 = Math.min(s.x0 + s.w, Math.min(w.x + w.width, width));
          const or0 = Math.max(s.y0, w.y), or1 = Math.min(s.y0 + s.rows, Math.min(w.y + w.height, height));
          const copyW = (oc1 - oc0) * spp * bytesPer;
          if (copyW <= 0) continue;
          for (let r = or0; r < or1; r++) {
            const srcOff = (r - s.y0) * rowSeg + (oc0 - s.x0) * spp * bytesPer;
            out.set(seg.subarray(srcOff, srcOff + copyW), (r - w.y) * rowOut + (oc0 - w.x) * spp * bytesPer);
          }
        }
        let data = typedView(out.buffer, fmt, bps);
        if (spp > 1) {                                     // deinterleave the chosen band from chunky
          const bi = Math.max(0, Math.min(spp - 1, band | 0));
          const one = typedView(new ArrayBuffer(w.width * w.height * bytesPer), fmt, bps);
          for (let i = 0; i < w.width * w.height; i++) one[i] = data[i * spp + bi];
          data = one;
        }
        return { data, x: w.x, y: w.y, width: w.width, height: w.height };
      },
      async read(band = 0) { return (await this.readWindow(null, band)).data; },
      // decode the WHOLE image at 1/step resolution, one segment at a time —
      // bounded memory (one tile/strip + the coarse output), so ANY size TIFF
      // (overview or not, tiled or stripped) yields a display grid. Nodes are
      // taken on the step lattice (rows/cols ≡ 0 mod step); band 0 of chunky.
      async readDecimated(step, band = 0) {
        step = Math.max(1, step | 0);
        const bi = Math.max(0, Math.min(spp - 1, band | 0));
        if (step === 1) return { data: await this.read(bi), width, height, step: 1, dnx: width, dny: height };
        if (planar !== 1) throw new Error('gtiff: planar (band-separate) layout not supported');
        if (![8, 16, 32, 64].includes(bps)) throw new Error(`gtiff: ${bps}-bit samples not supported`);
        if (fmt === 3 && bps < 32) throw new Error('gtiff: half-float not supported');
        const bytesPer = bps / 8;
        const dnx = Math.ceil(width / step), dny = Math.ceil(height / step);
        const outBytes = new Uint8Array(dnx * dny * bytesPer);
        const outView = typedView(outBytes.buffer, fmt, bps);
        const segs = this.segments(null);
        if (!segs.length) throw new Error('gtiff: no strip/tile offsets');
        for await (const [s, raw] of segmentBytes(src, segs)) {
          const seg = await this.decodeSeg(s, bytesPer, raw);
          const segView = typedView(seg.buffer, fmt, bps);   // native-endian samples
          const r0 = Math.ceil(s.y0 / step) * step, r1 = Math.min(s.y0 + s.rows, height);
          const c0 = Math.ceil(s.x0 / step) * step, c1 = Math.min(s.x0 + s.w, width);
          for (let r = r0; r < r1; r += step) {
            const segRow = (r - s.y0) * s.w * spp, outRow = (r / step) * dnx;
            for (let c = c0; c < c1; c += step) outView[outRow + c / step] = segView[segRow + (c - s.x0) * spp + bi];
          }
        }
        return { data: outView, width, height, step, dnx, dny };
      },
    };
    return img;
  };

  const images = ifds.map(mkImage).filter(Boolean);
  if (!images.length) throw new Error('gtiff: no image IFDs');
  return { images, geo: parseGeo(ifds[0], warnings), warnings, littleEndian: le };
}

// Convenience: one IFD → a north-up grid. x0/y0 are the coordinates of
// SAMPLE (0,0)'s CENTER (PixelIsArea shifts half a cell in from the corner
// origin; PixelIsPoint means the origin IS the node); row r's centre is
// y0 − r·dy with dy POSITIVE. Overview levels inherit IFD0's geo, scaled.
async function gridFromGTiff(g, level = 0, band = 0) {
  const img = g.images[level];
  const data = await img.read(band);
  const f = g.images[0].width / img.width;                 // overview scale factor
  let x0 = null, y0 = null, dx = 1, dy = 1;
  if (g.geo.origin && g.geo.scale) {
    dx = g.geo.scale[0] * f; dy = g.geo.scale[1] * f;
    const half = g.geo.pixelIsPoint ? 0 : 0.5;
    x0 = g.geo.origin[0] + half * dx;
    y0 = g.geo.origin[1] - half * dy;
  }
  return { nx: img.width, ny: img.height, data, x0, y0, dx, dy, nodata: g.geo.nodata, crs: g.geo.crs, pixelIsPoint: g.geo.pixelIsPoint, bands: img.samplesPerPixel, band };
}

// geo of a level as functions (no pixel decode): world ↔ pixel, cell size
function levelGeo(g, level = 0) {
  const img = g.images[level];
  const f = g.images[0].width / img.width;
  const dx = (g.geo.scale ? g.geo.scale[0] : 1) * f, dy = (g.geo.scale ? g.geo.scale[1] : 1) * f;
  const half = g.geo.pixelIsPoint ? 0 : 0.5;
  const x0 = g.geo.origin ? g.geo.origin[0] + half * dx : half * dx;         // sample (0,0) CENTRE
  const y0 = g.geo.origin ? g.geo.origin[1] - half * dy : -half * dy;
  return { nx: img.width, ny: img.height, x0, y0, dx, dy };
}

// the FINEST IFD level whose pixel count ≤ cap (fall back to the coarsest) —
// pick a display resolution within a decode budget. images[0] is full res;
// [1..n] are the overview pyramid (coarser as index grows), if present.
function pickOverviewForCap(g, cap) {
  let fin = -1;                                            // finest level whose pixels ≤ cap
  for (let i = 0; i < g.images.length; i++) {
    const px = g.images[i].width * g.images[i].height;
    if (px <= cap && (fin < 0 || g.images[i].width > g.images[fin].width)) fin = i;
  }
  // none fits → the coarsest (smallest) level, the best we can do within budget
  return fin >= 0 ? fin : g.images.reduce((c, im, i, a) => im.width * im.height < a[c].width * a[c].height ? i : c, 0);
}

// a WORLD bbox [minX, minY, maxX, maxY] → the level-`level` pixel window
// covering it (clamped), padded by `pad` cells for bilinear edges
function windowForWorldBbox(g, level, bbox, pad = 1) {
  const lg = levelGeo(g, level);
  const c0 = Math.floor((bbox[0] - lg.x0) / lg.dx) - pad;
  const c1 = Math.ceil((bbox[2] - lg.x0) / lg.dx) + pad;
  const r0 = Math.floor((lg.y0 - bbox[3]) / lg.dy) - pad;   // maxY → smallest row
  const r1 = Math.ceil((lg.y0 - bbox[1]) / lg.dy) + pad;
  const x = Math.max(0, c0), y = Math.max(0, r0);
  return { x, y, width: Math.min(lg.nx, c1 + 1) - x, height: Math.min(lg.ny, r1 + 1) - y };
}

// decode a pixel window of a level → a north-up grid (origin shifted to the
// window's sample (0,0) CENTRE). Only the overlapping tiles are decoded.
async function gridWindowFromGTiff(g, level, win, band = 0) {
  const img = g.images[level];
  const r = await img.readWindow(win, band);
  const lg = levelGeo(g, level);
  return { nx: r.width, ny: r.height, data: r.data, x0: lg.x0 + r.x * lg.dx, y0: lg.y0 - r.y * lg.dy, dx: lg.dx, dy: lg.dy, nodata: g.geo.nodata, crs: g.geo.crs, pixelIsPoint: g.geo.pixelIsPoint };
}

// the decimation step so a level fits a pixel cap (bounded-memory display of a
// huge non-overview raster). 1 if it already fits.
function stepForCap(g, level, cap) {
  const img = g.images[level];
  return Math.max(1, Math.ceil(Math.sqrt((img.width * img.height) / Math.max(1, cap))));
}

// decode a WHOLE level at 1/step resolution → a north-up grid (cell size ×
// step, origin unchanged — sample (0,0) is on the step lattice). One segment
// resident at a time; the display path for any-size TIFFs.
async function gridDecimatedFromGTiff(g, level, step, band = 0) {
  const img = g.images[level];
  const r = await img.readDecimated(step, band);
  const lg = levelGeo(g, level);
  return { nx: r.dnx, ny: r.dny, data: r.data, x0: lg.x0, y0: lg.y0, dx: lg.dx * r.step, dy: lg.dy * r.step, nodata: g.geo.nodata, crs: g.geo.crs, pixelIsPoint: g.geo.pixelIsPoint };
}

// ── src/write.js ──

// @gcu/gtiff — a minimal, WASM-free GeoTIFF WRITER: one band, float32, classic
// little-endian TIFF, strips or square tiles, compression none or deflate (the
// platform's CompressionStream — no bundled zlib, no WASM, so Sealed tools keep
// their claim), predictor 3 optional. Geo tags: ModelPixelScale + ModelTiepoint
// always (PixelIsArea, the tiepoint at the north-west CORNER), GDAL_NODATA when a
// nodata value is given, and a GeoKeyDirectory ONLY for a known EPSG code — a
// CRS is never invented (@gcu/frame's rule: identity, never a guess).
//
// Grid in = the reader's convention: { nx, ny, data, x0, y0, dx, dy } — row 0 is
// the NORTH row, x0/y0 the centre of sample (0,0), dy positive.

const LE = true;

// EPSG code → GeoTIFF model type. The EPSG registry puts geographic 2D/3D CRSs in
// 4000–4999 (4326 WGS 84, 4674 SIRGAS 2000, 4269 NAD83, 4979…); projected ones
// live elsewhere (UTM 326xx/327xx, SIRGAS UTM 319xx, 2000–3999, 5000+). The few
// projected codes inside 4000–4999 (4087, 4088 — equidistant cylindrical) are
// listed. No database is carried: this is the identity the code states.
const PROJECTED_4XXX = new Set([4087, 4088]);
function epsgModelType(code) {
  if (!(code > 0 && code < 32767)) return null;
  return code >= 4000 && code < 5000 && !PROJECTED_4XXX.has(code) ? 'geographic' : 'projected';
}

const parseEpsg = (crs) => {
  if (crs == null) return null;
  const m = /^\s*EPSG\s*:\s*(\d+)\s*$/i.exec(String(crs));
  if (!m) return null;
  const code = +m[1];
  return code > 0 && code < 32767 ? code : null;
};

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('gtiff: deflate needs CompressionStream (not available here) — write uncompressed');
  const cs = new CompressionStream('deflate');            // zlib-wrapped = TIFF compression 8
  const out = new Response(cs.readable).arrayBuffer();
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await out);
}

// predictor 3, encode side (the mirror of codec.js undoPredictor3): byte-plane
// shuffle each row (plane b = byte b of every sample, big-endian significance),
// then horizontal byte differencing across the row
function applyPredictor3(bytes, rowWidth, rows) {
  const B = 4, w = rowWidth, rowBytes = w * B;
  const tmp = new Uint8Array(rowBytes);
  for (let r = 0; r < rows; r++) {
    const off = r * rowBytes;
    for (let i = 0; i < w; i++) for (let b = 0; b < B; b++) tmp[b * w + i] = bytes[off + i * B + (B - 1 - b)];   // LE sample → BE planes
    for (let i = rowBytes - 1; i > 0; i--) tmp[i] = (tmp[i] - tmp[i - 1]) & 0xff;
    bytes.set(tmp, off);
  }
}

/**
 * writeGeoTiff(grid, opts) → Promise<Uint8Array>
 *   opts.compression  'none' | 'deflate'          (default 'deflate')
 *   opts.predictor    1 | 3                        (default 3 with deflate; ignored uncompressed)
 *   opts.layout       'strips' | 'tiles'           (default 'strips')
 *   opts.tileSize     tile edge, a multiple of 16  (default 256)
 *   opts.nodata       number (NaN allowed) | null  — written as GDAL_NODATA; cells that
 *                     are NaN or equal to grid.nodata (or ≥1.7014e38 for a Surfer blank)
 *                     become this value
 *   opts.crs          'EPSG:n' — GeoKeys only for a known EPSG code; anything else → none
 *   opts.description  ImageDescription text (e.g. provenance JSON)
 *   opts.software     Software tag
 * The result's `.info` = { crs, geoKeys, compression, layout, segments }.
 */
async function writeGeoTiff(grid, opts = {}) {
  const { nx, ny, data, x0, y0, dx, dy } = grid;
  if (!(nx > 0 && ny > 0) || !data || data.length < nx * ny) throw new Error('gtiff write: grid needs nx, ny and nx·ny values');
  const compression = opts.compression === 'none' ? 'none' : 'deflate';
  const predictor = compression === 'deflate' ? (opts.predictor === 1 ? 1 : 3) : 1;
  const tiled = opts.layout === 'tiles';
  const tile = tiled ? Math.max(16, Math.round((opts.tileSize || 256) / 16) * 16) : 0;
  const outNd = opts.nodata === undefined ? (grid.nodata ?? null) : opts.nodata;
  const srcNd = grid.nodata;
  const isBad = (v) => Number.isNaN(v) || (srcNd != null && (srcNd >= 1.7e38 ? v >= 1.7014e38 : v === srcNd));
  const fill = outNd == null ? NaN : outNd;

  // ── the segments: strips of ~256 KB of raw samples, or tile×tile tiles ──
  const segs = [];                                          // { x0, y0, w, h } in pixels
  let rowsPerStrip = 0;
  if (tiled) {
    for (let ty = 0; ty < ny; ty += tile) for (let tx = 0; tx < nx; tx += tile) segs.push({ x0: tx, y0: ty, w: tile, h: tile });
  } else {
    rowsPerStrip = Math.max(1, Math.min(ny, Math.floor((256 << 10) / (nx * 4))));
    for (let y = 0; y < ny; y += rowsPerStrip) segs.push({ x0: 0, y0: y, w: nx, h: Math.min(rowsPerStrip, ny - y) });
  }
  const encoded = [];
  for (const s of segs) {
    const raw = new Uint8Array(s.w * s.h * 4);
    const dv = new DataView(raw.buffer);
    for (let r = 0; r < s.h; r++) {
      const gr = s.y0 + r;
      for (let c = 0; c < s.w; c++) {
        const gc = s.x0 + c;
        let v = 0;                                          // tile padding past the edge: zeros (TIFF leaves it undefined)
        if (gr < ny && gc < nx) { v = data[gr * nx + gc]; if (isBad(v)) v = fill; }
        dv.setFloat32((r * s.w + c) * 4, v, LE);
      }
    }
    if (predictor === 3) applyPredictor3(raw, s.w, s.h);
    encoded.push(compression === 'deflate' ? await deflate(raw) : raw);
  }

  // ── tags ──
  const epsg = parseEpsg(opts.crs);
  const model = epsg ? epsgModelType(epsg) : null;
  const tags = [];                                          // [tag, type, values]  type: 2 ascii · 3 short · 4 long · 12 double
  const T = (tag, type, values) => tags.push([tag, type, values]);
  T(256, 4, [nx]); T(257, 4, [ny]);
  T(258, 3, [32]);
  T(259, 3, [compression === 'deflate' ? 8 : 1]);
  T(262, 3, [1]);                                           // BlackIsZero
  if (opts.description) T(270, 2, String(opts.description));
  if (!tiled) T(273, 4, segs.map(() => 0));                 // StripOffsets — patched below
  T(277, 3, [1]);
  if (!tiled) { T(278, 4, [rowsPerStrip]); T(279, 4, encoded.map((e) => e.length)); }
  T(284, 3, [1]);
  if (opts.software) T(305, 2, String(opts.software));
  if (predictor === 3) T(317, 3, [3]);
  if (tiled) { T(322, 3, [tile]); T(323, 3, [tile]); T(324, 4, segs.map(() => 0)); T(325, 4, encoded.map((e) => e.length)); }
  T(339, 3, [3]);                                           // IEEE float
  if (x0 != null && y0 != null && dx && dy) {
    T(33550, 12, [dx, dy, 0]);
    T(33922, 12, [0, 0, 0, x0 - dx / 2, y0 + dy / 2, 0]);   // PixelIsArea: raster (0,0) = the NW corner
  }
  if (epsg) {
    // KeyDirectory header [version 1, revision 1.0, nkeys], then keys [id, location 0, count 1, value]
    const keys = [[1024, model === 'geographic' ? 2 : 1], [1025, 1], [model === 'geographic' ? 2048 : 3072, epsg]];
    T(34735, 3, [1, 1, 0, keys.length, ...keys.flatMap(([id, v]) => [id, 0, 1, v])]);
  }
  if (outNd != null) T(42113, 2, Number.isNaN(outNd) ? 'nan' : String(outNd));
  tags.sort((a, b) => a[0] - b[0]);

  // ── layout: header · IFD · out-of-line values · segment data ──
  const SZ = { 2: 1, 3: 2, 4: 4, 12: 8 };
  const valBytes = (type, values) => (type === 2 ? values.length + 1 : values.length * SZ[type]);
  const ifdOff = 8, ifdLen = 2 + tags.length * 12 + 4;
  let at = ifdOff + ifdLen;
  const extOff = new Map();
  for (const t of tags) {
    const n = valBytes(t[1], t[2]);
    if (n > 4) { if (at & 1) at++; extOff.set(t, at); at += n; }
  }
  if (at & 1) at++;
  const segOffs = [];
  for (const e of encoded) { segOffs.push(at); at += e.length; }
  if (at > 0xFFFFFFFF) throw new Error('gtiff write: over 4 GB — classic TIFF cannot hold it (BigTIFF not written yet)');
  const offTag = tags.find((t) => t[0] === (tiled ? 324 : 273));
  offTag[2] = segOffs;

  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; v.setUint16(2, 42, LE); v.setUint32(4, ifdOff, LE);
  v.setUint16(ifdOff, tags.length, LE);
  const putVals = (p, type, values) => {
    if (type === 2) { for (let i = 0; i < values.length; i++) out[p + i] = values.charCodeAt(i) & 0xff; out[p + values.length] = 0; return; }
    values.forEach((x, i) => {
      if (type === 3) v.setUint16(p + i * 2, x, LE);
      else if (type === 4) v.setUint32(p + i * 4, x, LE);
      else v.setFloat64(p + i * 8, x, LE);
    });
  };
  tags.forEach((t, i) => {
    const e = ifdOff + 2 + i * 12, [tag, type, values] = t;
    const count = type === 2 ? values.length + 1 : values.length;
    v.setUint16(e, tag, LE); v.setUint16(e + 2, type, LE); v.setUint32(e + 4, count, LE);
    if (extOff.has(t)) { v.setUint32(e + 8, extOff.get(t), LE); putVals(extOff.get(t), type, values); }
    else putVals(e + 8, type, values);
  });
  v.setUint32(ifdOff + 2 + tags.length * 12, 0, LE);       // one IFD
  encoded.forEach((e, i) => out.set(e, segOffs[i]));
  out.info = { crs: epsg ? `EPSG:${epsg}` : null, geoKeys: !!epsg, model, compression, predictor, layout: tiled ? 'tiles' : 'strips', segments: segs.length };
  return out;
}

// ── src/main.js ──

// @gcu/gtiff — module manifest (build concat order).

export {
  lzwDecode,
  packbitsDecode,
  decodeSegment,
  undoPredictor2,
  undoPredictor3,
  readGTiff,
  gridFromGTiff,
  levelGeo,
  pickOverviewForCap,
  windowForWorldBbox,
  gridWindowFromGTiff,
  stepForCap,
  gridDecimatedFromGTiff,
  epsgModelType,
  writeGeoTiff,
};
