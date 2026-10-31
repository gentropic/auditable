// @gcu/scan colacc — the per-column statistics accumulator.
//
// ZERO imports, like kernels.js: the page and the workers push values through
// this one definition (the worker bundle carries it too), so their states merge.
// sl = the @gcu/sluice exports. Numbers: welford + t-digest; text: topK +
// cardinality. States are plain data (structured-cloneable) and merge.

export const STAT_SLICE = 65536;

export function makeColAcc(sl) {
  const W = sl.welford(), TD = sl.tdigest(), TK = sl.topK({ limit: 500 }), CD = sl.cardinality({ limit: 4096 });
  const buf = new Float64Array(STAT_SLICE);
  const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v)));
  return {
    create: (isNum) => (isNum ? { num: true, w: W.create(), td: TD.create(), nulls: 0 }
      : { num: false, top: TK.create(), card: CD.create(), nulls: 0 }),
    pushNumber(c, v) {
      const x = num(v);
      if (!Number.isFinite(x)) { c.nulls++; return; }
      W.push(c.w, x); TD.push(c.td, x);
    },
    // a slice [a, b) of a column batch (b − a ≤ STAT_SLICE): welford per value,
    // the t-digest once for the slice (a native sort + one merge)
    pushNumbers(c, arr, a, b) {
      let m = 0;
      for (let k = a; k < b; k++) {
        const x = num(arr[k]);
        if (!Number.isFinite(x)) { c.nulls++; continue; }
        W.push(c.w, x);
        buf[m++] = x;
      }
      if (m) TD.pushArray(c.td, buf, 0, m);
    },
    pushText(c, v) {
      const sv = v == null ? '' : String(v).trim();
      if (!sv) { c.nulls++; return; }
      TK.push(c.top, sv); CD.push(c.card, sv);
    },
    merge(c, o) {
      if (c.num) { c.w = W.merge(c.w, o.w); c.td = TD.merge(c.td, o.td); }
      else { c.top = TK.merge(c.top, o.top); c.card = CD.merge(c.card, o.card); }
      c.nulls += o.nulls;
    },
    result(c, rows) {
      if (c.num) {
        const w = W.result(c.w), td = TD.result(c.td);
        const q = (p) => sl.quantileFromCentroids(td.centroids, td.count, p);
        return { kind: 'num', n: w.count, nulls: c.nulls, mean: w.mean, std: w.std, min: w.min, max: w.max, p25: q(0.25), p50: q(0.5), p75: q(0.75), centroids: td.centroids, total: td.count };
      }
      const t = TK.result(c.top);
      return { kind: 'txt', n: rows - c.nulls, nulls: c.nulls, distinct: t.distinct, overflow: t.overflow, top: t.top(5) };
    },
  };
}
