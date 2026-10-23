// The integrity checks of the .xz format: CRC32 (also the LZ encoder's hash table), CRC64 and
// SHA-256, each incremental (check.c, crc32_*.c, crc64_*.c, sha256.c of liblzma, in effect —
// these are the standard algorithms, written for JavaScript). CRC64 runs on two 32-bit halves.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// CRC32: reflected, polynomial 0xEDB88320
export const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, crc = 0, start = 0, end = buf.length) {
  let c = ~crc >>> 0;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// CRC64 (ECMA-182, reflected — polynomial 0xC96C5795D7870F42), as two 32-bit tables
const CRC64_LO = new Uint32Array(256), CRC64_HI = new Uint32Array(256);
{
  const pLo = 0xd7870f42, pHi = 0xc96c5795;
  for (let i = 0; i < 256; i++) {
    let lo = i, hi = 0;
    for (let k = 0; k < 8; k++) {
      const bit = lo & 1;
      lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
      hi = hi >>> 1;
      if (bit) { lo = (lo ^ pLo) >>> 0; hi = (hi ^ pHi) >>> 0; }
    }
    CRC64_LO[i] = lo; CRC64_HI[i] = hi;
  }
}

// state: [lo, hi] of the running CRC (pre-inverted); returns the new state
export function crc64Update(state, buf, start = 0, end = buf.length) {
  let lo = state[0], hi = state[1];
  for (let i = start; i < end; i++) {
    const idx = (lo ^ buf[i]) & 0xff;
    const nlo = ((lo >>> 8) | ((hi & 0xff) << 24)) >>> 0;
    const nhi = hi >>> 8;
    lo = (nlo ^ CRC64_LO[idx]) >>> 0;
    hi = (nhi ^ CRC64_HI[idx]) >>> 0;
  }
  return [lo, hi];
}

// ── SHA-256 (FIPS 180-4) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }
  update(data, start = 0, end = data.length) {
    this.total += end - start;
    let i = start;
    if (this.bufLen) {
      while (i < end && this.bufLen < 64) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    while (i + 64 <= end) { this._block(data, i); i += 64; }
    while (i < end) this.buf[this.bufLen++] = data[i++];
    return this;
  }
  digest() {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const n = pad.length;
    const hiBits = Math.floor(bits / 0x100000000), loBits = bits >>> 0;
    pad[n - 8] = hiBits >>> 24; pad[n - 7] = hiBits >>> 16; pad[n - 6] = hiBits >>> 8; pad[n - 5] = hiBits;
    pad[n - 4] = loBits >>> 24; pad[n - 3] = loBits >>> 16; pad[n - 2] = loBits >>> 8; pad[n - 1] = loBits;
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(32);
    for (let j = 0; j < 8; j++) {
      out[j * 4] = this.h[j] >>> 24; out[j * 4 + 1] = this.h[j] >>> 16;
      out[j * 4 + 2] = this.h[j] >>> 8; out[j * 4 + 3] = this.h[j];
    }
    return out;
  }
  _block(d, o) {
    const w = this.w, h = this.h;
    for (let t = 0; t < 16; t++) w[t] = (d[o + t * 4] << 24) | (d[o + t * 4 + 1] << 16) | (d[o + t * 4 + 2] << 8) | d[o + t * 4 + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += dd; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
}

// the check IDs of the format, and their sizes on disk
export const CHECK_NONE = 0, CHECK_CRC32 = 1, CHECK_CRC64 = 4, CHECK_SHA256 = 10;
export const CHECK_ID_MAX = 15;
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
export const checkSize = (id) => CHECK_SIZES[id];
export const isCheckSupported = (id) => id === CHECK_NONE || id === CHECK_CRC32 || id === CHECK_CRC64 || id === CHECK_SHA256;

// an incremental check of type id: update(bytes), finish() → its bytes as stored (little-endian
// for the CRCs, as liblzma writes them)
export class Check {
  constructor(id) {
    this.id = id;
    if (id === CHECK_CRC32) this.crc = 0;
    else if (id === CHECK_CRC64) this.st = [0xffffffff, 0xffffffff];
    else if (id === CHECK_SHA256) this.sha = new Sha256();
  }
  update(buf, start = 0, end = buf.length) {
    if (this.id === CHECK_CRC32) this.crc = crc32(buf, this.crc, start, end);
    else if (this.id === CHECK_CRC64) this.st = crc64Update(this.st, buf, start, end);
    else if (this.id === CHECK_SHA256) this.sha.update(buf, start, end);
  }
  finish() {
    if (this.id === CHECK_NONE) return new Uint8Array(0);
    if (this.id === CHECK_CRC32) { const c = this.crc, o = new Uint8Array(4); o[0] = c; o[1] = c >>> 8; o[2] = c >>> 16; o[3] = c >>> 24; return o; }
    if (this.id === CHECK_CRC64) {
      const lo = ~this.st[0] >>> 0, hi = ~this.st[1] >>> 0, o = new Uint8Array(8);
      o[0] = lo; o[1] = lo >>> 8; o[2] = lo >>> 16; o[3] = lo >>> 24; o[4] = hi; o[5] = hi >>> 8; o[6] = hi >>> 16; o[7] = hi >>> 24;
      return o;
    }
    return this.sha.digest();
  }
}
