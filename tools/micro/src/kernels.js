// micro kernels — the per-chunk computations of the analysis windows, shared by
// the page and the scan workers (src/pqpool.js, src/colscan.js).
//
// ZERO imports, like chunkview.js: a module worker has no import map, so what a
// kernel needs (@gcu/expr, the chunk view) is passed in. A kernel turns one chunk
// (a Parquet row group, a .dm page run) into a PARTIAL, and partials merge in
// chunk order — so the answer is the same whether a worker or the page computed
// each chunk, and the same run to run.

// ── grade-tonnage, never resident and exact ──
// One streamed pass per series into a SPARSE histogram whose bin edges are the
// multiples of a fine power-of-ten step h = 10^e, each bin holding the exact Σw
// and Σw·g of what fell in it. Tonnage and mean grade at a cutoff that is a bin
// edge are then EXACT — no approximation, at any model size, in memory bounded
// by the occupied bins (a span far wider than first guessed coarsens ×10, which
// keeps every edge an edge). The cutoffs are ROUND (1·2·5 × 10ⁿ, a multiple of
// every series' h), so every one is an edge: exactly nCut+1 of them, covering
// the data from a round value at or below its minimum. Exact when the series'
// units convert by powers of ten (% · ppm · g/t · fraction); a non-decimal
// conversion (oz/t) lands within one fine bin (~1/20000 of the range).
// (It replaced pushing every (g, w) into JS arrays and sorting them — 130 s and
// a 69 s freeze at 60M blocks.)
export const GT_BINS_TARGET = 20000, GT_BINS_CAP = 400000;
export const gtEdge = (k, e) => (e >= 0 ? k * 10 ** e : k / 10 ** -e);          // a decimal edge, exactly as typed
export function gtBinOf(g, e) {                                   // the largest k with edge(k) ≤ g
  let k = Math.floor(e >= 0 ? g / 10 ** e : g * 10 ** -e);
  while (gtEdge(k + 1, e) <= g) k++;
  while (gtEdge(k, e) > g) k--;
  return k;
}
export function gtAccumulator() {
  const se = { e: null, bins: new Map(), n: 0, gmin: Infinity, gmax: -Infinity, pend: [] };
  const put = (g, w) => {
    const k = gtBinOf(g, se.e);
    const b = se.bins.get(k);
    if (b) { b[0] += w; b[1] += w * g; } else se.bins.set(k, [w, w * g]);
    if (se.bins.size > GT_BINS_CAP) {                       // wider than guessed: ×10, edges stay edges
      se.e++;
      const old = se.bins; se.bins = new Map();
      for (const [k2, b2] of old) { const k3 = Math.floor(k2 / 10), t = se.bins.get(k3); if (t) { t[0] += b2[0]; t[1] += b2[1]; } else se.bins.set(k3, [b2[0], b2[1]]); }
    }
  };
  const settle = () => {                                    // the fine step from the first values' spread
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < se.pend.length; i += 2) { const g = se.pend[i]; if (g < lo) lo = g; if (g > hi) hi = g; }
    const span = hi >= lo ? Math.max(hi - lo, Math.abs(hi) * 1e-9, 1e-12) : 1;   // nothing pending → any finite step
    se.e = Math.floor(Math.log10(span / GT_BINS_TARGET));
    const pend = se.pend; se.pend = null;
    for (let i = 0; i < pend.length; i += 2) put(pend[i], pend[i + 1]);
  };
  se.add = (g, w) => {
    se.n++; if (g < se.gmin) se.gmin = g; if (g > se.gmax) se.gmax = g;
    if (se.pend) { se.pend.push(g, w); if (se.pend.length >= 1 << 17) settle(); return; }
    put(g, w);
  };
  // → descending bin keys + cumulative Σw / Σw·g above each (the shape the plot reads)
  se.finish = () => {
    if (se.pend) settle();
    const keys = Float64Array.from(se.bins.keys()).sort().reverse();
    const cw = new Float64Array(keys.length + 1), cwg = new Float64Array(keys.length + 1);
    for (let i = 0; i < keys.length; i++) { const b = se.bins.get(keys[i]); cw[i + 1] = cw[i] + b[0]; cwg[i + 1] = cwg[i] + b[1]; }
    se.keys = keys; se.cw = cw; se.cwg = cwg; se.bins = null;
    if (se.e == null) se.e = 0;
  };
  return se;
}
// Σw / Σw·g of everything at or above cutoff cN (native units): bins from the
// first edge ≥ cN up
export function gtAbove(se, cN) {
  let K = gtBinOf(cN, se.e); if (gtEdge(K, se.e) < cN) K++;
  let lo = 0, hi = se.keys.length; while (lo < hi) { const md = (lo + hi) >> 1; if (se.keys[md] >= K) lo = md + 1; else hi = md; }
  return [se.cw[lo], se.cwg[lo]];
}
// the cutoffs (axis units): nCut+1 round values, a common multiple of every
// series' fine step, from a round value ≤ the data minimum to one ≥ its maximum
// (overshooting it by ~25% at most)
export function gtCuts(scanSeries, nCut, factorOf) {
  let gmin = Infinity, gmax = -Infinity, fine = 0;
  for (const se of scanSeries) {
    if (!se.n) continue;
    const f = factorOf(se);
    gmin = Math.min(gmin, se.gmin * f); gmax = Math.max(gmax, se.gmax * f);
    fine = Math.max(fine, 10 ** se.e * Math.abs(f));
  }
  if (!(gmax >= gmin)) return null;
  const N = Math.max(1, nCut | 0);
  if (gmax === gmin) return [gmin];
  // step = m·10^j, m from a DENSE round set (1·2·5 alone overshot the data by up
  // to ×2.5 — half the chart flat), ≥ fine and ≥ the span / N. m has one decimal,
  // so a cut is (i·10m)·10^(j−1): integer arithmetic, exactly the decimal typed.
  // A step must also be a whole multiple of the fine bin (10^(j−1) ≥ fine) so
  // every cut stays an edge.
  let j = Math.floor(Math.log10(Math.max((gmax - gmin) / N, fine))), mi = 0;
  const M10 = [10, 12, 15, 20, 25, 30, 40, 50, 60, 80];
  const stepOf = () => (j - 1 >= 0 ? M10[mi] * 10 ** (j - 1) : M10[mi] / 10 ** (1 - j));
  const cutOf = (i) => (j - 1 >= 0 ? i * M10[mi] * 10 ** (j - 1) : (i * M10[mi]) / 10 ** (1 - j));
  const unit = j - 1 >= 0 ? 10 ** (j - 1) : 1 / 10 ** (1 - j);
  for (let guard = 0; guard < 200; guard++) {
    const step = stepOf();
    if (unit >= fine * (1 - 1e-9) && step * N >= (gmax - gmin) * (1 - 1e-12)) {
      let L0 = Math.floor(gmin / step);                    // the largest round cut ≤ gmin, by the same exact arithmetic
      while (cutOf(L0 + 1) <= gmin) L0++;
      while (cutOf(L0) > gmin) L0--;
      if (cutOf(L0 + N) >= gmax) { const cuts = []; for (let i = 0; i <= N; i++) cuts.push(cutOf(L0 + i)); return cuts; }
    }
    if (++mi === M10.length) { mi = 0; j++; }
  }
  const cuts = []; for (let i = 0; i <= N; i++) cuts.push(gmin + (gmax - gmin) * i / N);   // unreachable in practice
  return cuts;
}

// ── the grade-tonnage KERNEL ─────────────────────────────────────────────────
// params: { schema, series: [{ grade, weight, filter }] (expression texts; grade
// is already a quoted name or an expression), dScale (density unit → t/m³), vol:
// { base, dims: [nameX, nameY, nameZ] | null } }. One chunk → per series the
// accumulator's bins as transferable arrays.
export function gtKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema;
      const one = (txt, bool) => { if (!txt) return null; return bool ? E.compileChunkBool(txt, sch, { decimal: '.' }) : E.compileChunk(txt, sch, { decimal: '.' }); };
      return {
        params, calcFns: CV.compileCalcs(E, calcs, sch),
        series: params.series.map((s) => ({ grade: one(s.grade), weight: one(s.weight), filter: one(s.filter, true) })),
        dimIdx: params.vol.dims ? params.vol.dims.map((nm) => sch.findIndex((c) => c.name === nm)) : null,
        scratch: {},
      };
    },
    // view: the chunk's columns (chunkview); mask: the scope mask slice or null
    group(ctx, view, n, mask) {
      const { params } = ctx, sc = ctx.scratch;
      let vol = null;
      if (ctx.dimIdx) {
        const dx = CV.chunkNumbers({ buf: view[ctx.dimIdx[0]] || [] }, n, sc.dx || (sc.dx = new Float64Array(n)));
        const dy = CV.chunkNumbers({ buf: view[ctx.dimIdx[1]] || [] }, n, sc.dy || (sc.dy = new Float64Array(n)));
        const dz = CV.chunkNumbers({ buf: view[ctx.dimIdx[2]] || [] }, n, sc.dz || (sc.dz = new Float64Array(n)));
        vol = sc.vol && sc.vol.length >= n ? sc.vol : (sc.vol = new Float64Array(n));
        for (let i = 0; i < n; i++) { const v = Math.abs((dx[i] || 0) * (dy[i] || 0) * (dz[i] || 0)); vol[i] = v > 0 ? v : params.vol.base; }   // = analysis.js volumeAt
      }
      return ctx.series.map((se, k) => {
        const acc = gtAccumulator();
        const g = CV.chunkNumbers(se.grade(view, n), n, sc['g' + k] || (sc['g' + k] = new Float64Array(n)));
        const w = se.weight ? CV.chunkNumbers(se.weight(view, n), n, sc['w' + k] || (sc['w' + k] = new Float64Array(n))) : null;
        const f = se.filter ? se.filter(view, n) : null;
        for (let i = 0; i < n; i++) {
          if (mask && !mask[i]) continue;
          if (f && f[i] !== 1) continue;
          const gv = g[i]; if (!Number.isFinite(gv)) continue;
          const wv = (w ? ((w[i] || 0) * params.dScale) : 1) * (vol ? vol[i] : params.vol.base);   // a blank density reads 0 → skipped, as the row path
          if (!(wv > 0)) continue;
          acc.add(gv, wv);
        }
        return gtPartial(acc);
      });
    },
  };
}
// an accumulator's state as plain transferable data
export function gtPartial(acc) {
  if (acc.pend) {                                            // never settled (few values): settle now
    acc.finish();
    return { e: acc.e, keys: acc.keys, w: binDiffs(acc.cw), wg: binDiffs(acc.cwg), n: acc.n, gmin: acc.gmin, gmax: acc.gmax };
  }
  const keys = Float64Array.from(acc.bins.keys()), w = new Float64Array(keys.length), wg = new Float64Array(keys.length);
  let i = 0; for (const b of acc.bins.values()) { w[i] = b[0]; wg[i] = b[1]; i++; }
  return { e: acc.e, keys, w, wg, n: acc.n, gmin: acc.gmin, gmax: acc.gmax };
}
const binDiffs = (c) => { const o = new Float64Array(c.length - 1); for (let i = 0; i < o.length; i++) o[i] = c[i + 1] - c[i]; return o; };
// partials (chunk order) → one finished accumulator: every partial brought to the
// coarsest step among them (×10 merges keep every edge an edge), bins added in order
export function gtMerge(parts) {
  const live = parts.filter((p) => p && p.n);
  const acc = gtAccumulator();
  if (!live.length) { acc.finish(); return acc; }
  const e = Math.max(...live.map((p) => p.e));
  const bins = new Map();
  for (const p of live) {
    const f = 10 ** (e - p.e);
    for (let i = 0; i < p.keys.length; i++) {
      const k = Math.floor(p.keys[i] / f), t = bins.get(k);
      if (t) { t[0] += p.w[i]; t[1] += p.wg[i]; } else bins.set(k, [p.w[i], p.wg[i]]);
    }
    acc.n += p.n; if (p.gmin < acc.gmin) acc.gmin = p.gmin; if (p.gmax > acc.gmax) acc.gmax = p.gmax;
  }
  acc.e = e; acc.bins = bins; acc.pend = null;
  acc.finish();
  return acc;
}
