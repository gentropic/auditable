// @gcu/condenser — an EXTERNAL Morton sort: records in, records back out in
// Z-order, whatever the model size, in bounded memory.
//
// Sorting in memory meant holding every column of every record at once (boxed
// JS values, 16-24 B each: ~2 GB at the 8M-block ceiling micro had to impose,
// with bigger models written unsorted). Here:
//   push    — each record's key is its 30-bit Morton key against a FIXED bbox
//             (so keys from any pass compare); the record lands in the BUCKET of
//             its key's top bits, staged a few thousand records at a time and
//             SPILLED as a Blob part (keys · source record numbers · numbers as
//             Float64 · strings as JSON). The browser pages large Blob data to
//             disk itself — no file permission, no OPFS.
//   batches — bucket by bucket (buckets ARE key ranges, so their order is the
//             global order), read back, radix-sort by the full key (stable), and
//             yield groups of `groupSize` records with their source record
//             numbers (`recs`) — the permutation a caller applies to anything
//             else it keeps per record.
// Peak memory ≈ one bucket (target records × columns) + the staging buffers.
import { mortonKey, radixSortIndices } from './morton.js';

// opts: { bbox: { min:[x,y,z], max:[x,y,z] }, n (expected records), kinds:
// ['num'|'str', …] per column, target (records per bucket, ~1M), staging (bytes
// of staging across buckets, ~64 MB) }
export function createMortonSorter({ bbox, n = 0, kinds, target = 1 << 20, staging = 64 << 20 }) {
  const nc = kinds.length, isNum = kinds.map((k) => k === 'num');
  const lo = bbox.min, hi = bbox.max;
  const sc = [0, 1, 2].map((a) => (hi[a] > lo[a] ? 1023 / (hi[a] - lo[a]) : 0));
  const q = (v, a) => { const t = ((v - lo[a]) * sc[a]) | 0; return t < 0 ? 0 : t > 1023 ? 1023 : t; };
  // 2 bits of slack over n/target: real models fill their bbox unevenly
  const bits = Math.max(0, Math.min(15, Math.ceil(Math.log2(Math.max(1, n / target))) + 2));
  const B = 1 << bits, shift = 30 - bits;
  const chunk = Math.max(256, Math.min(1 << 14, Math.floor(staging / (B * (nc + 1) * 8))));
  const buckets = Array.from({ length: B }, () => ({ parts: [], n: 0, keys: null, recs: null, cols: null, c: 0 }));
  const enc = new TextEncoder(), dec = new TextDecoder();
  let total = 0;
  const stage = (bk) => {
    bk.keys = new Uint32Array(chunk); bk.recs = new Uint32Array(chunk);
    bk.cols = kinds.map((k) => (k === 'num' ? new Float64Array(chunk) : new Array(chunk)));
    bk.c = 0;
  };
  const spill = (bk) => {
    const c = bk.c; if (!c) return;
    const pieces = [bk.keys.slice(0, c), bk.recs.slice(0, c)], strLens = [];
    for (let j = 0; j < nc; j++) {
      if (isNum[j]) pieces.push(bk.cols[j].slice(0, c));
      else { const b = enc.encode(JSON.stringify(bk.cols[j].slice(0, c))); strLens.push(b.length); pieces.push(b); }
    }
    bk.parts.push({ blob: new Blob(pieces), c, strLens });
    stage(bk);
  };
  return {
    bits, buckets: B,
    get count() { return total; },
    // values: one per column — a number or null for 'num', a string or null for 'str'
    push(x, y, z, values, rec) {
      const key = mortonKey(q(x, 0), q(y, 1), q(z, 2)) >>> 0;
      const bk = buckets[key >>> shift];
      if (!bk.keys) stage(bk);
      const i = bk.c++;
      bk.keys[i] = key; bk.recs[i] = rec;
      for (let j = 0; j < nc; j++) { const v = values[j]; bk.cols[j][i] = isNum[j] ? (v == null ? NaN : v) : (v == null ? null : v); }
      bk.n++; total++;
      if (bk.c === chunk) spill(bk);
    },
    // → async iterator of { count, cols: [Array(count)] (numbers or null / strings
    //   or null), recs: Uint32Array(count) }, in Morton order
    async *batches(groupSize = 1 << 16) {
      for (const bk of buckets) spill(bk);
      let gCols = kinds.map(() => []), gRecs = [], gN = 0;
      const flush = function* () { if (gN) { yield { count: gN, cols: gCols, recs: Uint32Array.from(gRecs) }; gCols = kinds.map(() => []); gRecs = []; gN = 0; } };
      for (const bk of buckets) {
        if (!bk.n) continue;
        const m = bk.n, keys = new Uint32Array(m), recs = new Uint32Array(m);
        const cols = kinds.map((k) => (k === 'num' ? new Float64Array(m) : new Array(m)));
        let at = 0;
        for (const pt of bk.parts) {
          const buf = await pt.blob.arrayBuffer(), c = pt.c;
          keys.set(new Uint32Array(buf, 0, c), at); recs.set(new Uint32Array(buf, 4 * c, c), at);
          let off = 8 * c, s = 0;
          for (let j = 0; j < nc; j++) {
            if (isNum[j]) { cols[j].set(new Float64Array(buf.slice(off, off + 8 * c)), at); off += 8 * c; }
            else { const arr = JSON.parse(dec.decode(new Uint8Array(buf, off, pt.strLens[s]))); off += pt.strLens[s++]; for (let i = 0; i < c; i++) cols[j][at + i] = arr[i]; }
          }
          at += c;
        }
        bk.parts = null;                                   // the bucket's spill is consumed
        const order = radixSortIndices(keys, m);
        for (let r = 0; r < m; r++) {
          const i = order[r];
          for (let j = 0; j < nc; j++) { const v = cols[j][i]; gCols[j].push(isNum[j] ? (v !== v ? null : v) : v); }
          gRecs.push(recs[i]); gN++;
          if (gN === groupSize) yield* flush();
        }
      }
      yield* flush();
    },
  };
}
