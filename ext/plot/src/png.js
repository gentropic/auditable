// PNG bytes from RGBA, in plain JS: no canvas, no CompressionStream (it is async, and absent in
// some hosts), no dependency. toSVG embeds a draw list's `image` ops with it, so an SVG of a
// raster is built the same in a worker, in Node, and on the page — byte for byte.
//
// Deflate here is one fixed-Huffman block over an LZ77 pass (3-byte hash heads, a chain capped
// at 16 links): a third of a good zlib's speed and a few percent larger, and deterministic. Each
// row takes the PNG filter (none, Sub or Up) with the smallest sum of absolute bytes, the usual
// heuristic; colour-mapped rasters repeat a lot, so Up is often all zeros.

let _CRC = null;
function _crc32(bytes, start, end) {
  if (!_CRC) {
    _CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = _CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── deflate, fixed Huffman ──
const _LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const _LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const _DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const _DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
let _LIT = null, _LITLEN = null, _DIST = null, _LCODE = null;
function _rev(v, n) { let r = 0; for (let i = 0; i < n; i++) { r = (r << 1) | (v & 1); v >>= 1; } return r; }
function _tables() {
  _LIT = new Uint16Array(288); _LITLEN = new Uint8Array(288);
  for (let i = 0; i < 288; i++) {
    let code, len;
    if (i < 144) { code = 0x30 + i; len = 8; } else if (i < 256) { code = 0x190 + i - 144; len = 9; } else if (i < 280) { code = i - 256; len = 7; } else { code = 0xc0 + i - 280; len = 8; }
    _LIT[i] = _rev(code, len); _LITLEN[i] = len;
  }
  _DIST = new Uint8Array(30);
  for (let i = 0; i < 30; i++) _DIST[i] = _rev(i, 5);
  _LCODE = new Uint8Array(259);                       // match length → its code index (0–28)
  for (let c = 0; c < 29; c++) for (let l = _LBASE[c]; l < (c === 28 ? 259 : _LBASE[c + 1]); l++) _LCODE[l] = c;
  _LCODE[258] = 28;
}
function _distCode(d) { let lo = 0, hi = 29; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (_DBASE[m] <= d) lo = m; else hi = m - 1; } return lo; }

export function _deflate(data) {
  if (!_LIT) _tables();
  const n = data.length;
  let out = new Uint8Array(Math.max(64, (n >> 1) + 64)), o = 0, bits = 0, nb = 0;
  const put = (v, len) => {
    bits |= v << nb; nb += len;
    while (nb >= 8) {
      if (o >= out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; }
      out[o++] = bits & 255; bits >>>= 8; nb -= 8;
    }
  };
  const lit = (c) => put(_LIT[c], _LITLEN[c]);
  put(1, 1); put(1, 2);                                // BFINAL, BTYPE = fixed Huffman
  const HBITS = 15, HSIZE = 1 << HBITS, WIN = 32768, MAXCHAIN = 16;
  const head = new Int32Array(HSIZE).fill(-1), prev = new Int32Array(WIN);
  const hash = (i) => (((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HSIZE - 1));
  let i = 0;
  while (i < n) {
    let best = 0, dist = 0;
    if (i + 2 < n) {
      const h = hash(i);
      let j = head[h], chain = 0;
      const limit = Math.min(258, n - i);
      while (j >= 0 && i - j <= WIN && chain++ < MAXCHAIN) {
        if (data[j + best] === data[i + best]) {
          let l = 0;
          while (l < limit && data[j + l] === data[i + l]) l++;
          if (l > best) { best = l; dist = i - j; if (l === limit) break; }
        }
        j = prev[j & (WIN - 1)];
      }
      prev[i & (WIN - 1)] = head[h]; head[h] = i;
    }
    if (best >= 3) {
      const c = _LCODE[best];
      lit(257 + c);
      if (_LEXTRA[c]) put(best - _LBASE[c], _LEXTRA[c]);
      const dc = _distCode(dist);
      put(_DIST[dc], 5);
      if (_DEXTRA[dc]) put(dist - _DBASE[dc], _DEXTRA[dc]);
      // index the bytes the match covered, so later matches can start inside it
      for (let k = 1; k < best; k++) { const p = i + k; if (p + 2 < n) { const h = hash(p); prev[p & (WIN - 1)] = head[h]; head[h] = p; } }
      i += best;
    } else { lit(data[i]); i++; }
  }
  lit(256);
  if (nb) put(0, 8 - nb);
  return out.subarray(0, o);
}

function _zlib(data) {
  const d = _deflate(data);
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const out = new Uint8Array(d.length + 6);
  out[0] = 0x78; out[1] = 0x01;
  out.set(d, 2);
  const ad = ((b << 16) | a) >>> 0;
  out[d.length + 2] = ad >>> 24; out[d.length + 3] = (ad >>> 16) & 255; out[d.length + 4] = (ad >>> 8) & 255; out[d.length + 5] = ad & 255;
  return out;
}

// RGBA (w × h × 4 bytes) → PNG bytes
export function encodePNG(rgba, w, h) {
  const stride = w * 4, raw = new Uint8Array((stride + 1) * h);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < h; y++) {
    const r = y * stride;
    let bestF = 0, bestS = Infinity;
    for (let f = 0; f < 3; f++) {
      const c = cand[f]; let s = 0;
      for (let x = 0; x < stride; x++) {
        const v = rgba[r + x], left = x >= 4 ? rgba[r + x - 4] : 0, up = y ? rgba[r - stride + x] : 0;
        const q = (f === 0 ? v : f === 1 ? v - left : v - up) & 255;
        c[x] = q; s += q < 128 ? q : 256 - q;
      }
      if (s < bestS) { bestS = s; bestF = f; }
    }
    raw[y * (stride + 1)] = bestF;
    raw.set(cand[bestF], y * (stride + 1) + 1);
  }
  const idat = _zlib(raw);
  const chunks = [['IHDR', _ihdr(w, h)], ['IDAT', idat], ['IEND', new Uint8Array(0)]];
  let len = 8; for (const [, d] of chunks) len += 12 + d.length;
  const out = new Uint8Array(len);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  for (const [type, d] of chunks) {
    const n = d.length;
    out[o] = n >>> 24; out[o + 1] = (n >>> 16) & 255; out[o + 2] = (n >>> 8) & 255; out[o + 3] = n & 255;
    for (let k = 0; k < 4; k++) out[o + 4 + k] = type.charCodeAt(k);
    out.set(d, o + 8);
    const c = _crc32(out, o + 4, o + 8 + n);
    out[o + 8 + n] = c >>> 24; out[o + 9 + n] = (c >>> 16) & 255; out[o + 10 + n] = (c >>> 8) & 255; out[o + 11 + n] = c & 255;
    o += 12 + n;
  }
  return out;
}
function _ihdr(w, h) {
  const d = new Uint8Array(13);
  d[0] = w >>> 24; d[1] = (w >>> 16) & 255; d[2] = (w >>> 8) & 255; d[3] = w & 255;
  d[4] = h >>> 24; d[5] = (h >>> 16) & 255; d[6] = (h >>> 8) & 255; d[7] = h & 255;
  d[8] = 8; d[9] = 6;                                  // 8-bit RGBA; compression, filter, interlace 0
  return d;
}
