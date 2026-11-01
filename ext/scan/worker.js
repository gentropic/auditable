// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/worker-main.js
// @gcu/scan — Kernels over a block model's records — grade-tonnage, swath, statistics, filters, values, positions — columnar and parallel, never resident. Parquet row groups, Datamine .dm page runs and indexed delimited runs (with zone-map skipping) on a pool of module workers, the same kernel on the page where workers can't run, partials merged in unit order so the answer never depends on which. Zero imports: its libraries (parquet, condenser, expr, sluice) are injected.

// ── src/kernels.js ──

// @gcu/scan kernels — the per-chunk computations (grade-tonnage, swath, stats,
// filter, values, positions), shared by the page and the workers (worker.js, run.js).
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
const GT_BINS_TARGET = 20000, GT_BINS_CAP = 400000;
const gtEdge = (k, e) => (e >= 0 ? k * 10 ** e : k / 10 ** -e);          // a decimal edge, exactly as typed
function gtBinOf(g, e) {                                   // the largest k with edge(k) ≤ g
  let k = Math.floor(e >= 0 ? g / 10 ** e : g * 10 ** -e);
  while (gtEdge(k + 1, e) <= g) k++;
  while (gtEdge(k, e) > g) k--;
  return k;
}
function gtAccumulator() {
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
function gtAbove(se, cN) {
  let K = gtBinOf(cN, se.e); if (gtEdge(K, se.e) < cN) K++;
  let lo = 0, hi = se.keys.length; while (lo < hi) { const md = (lo + hi) >> 1; if (se.keys[md] >= K) lo = md + 1; else hi = md; }
  return [se.cw[lo], se.cwg[lo]];
}
// the cutoffs (axis units): nCut+1 round values, a common multiple of every
// series' fine step, from a round value ≤ the data minimum to one ≥ its maximum
// (overshooting it by ~25% at most)
function gtCuts(scanSeries, nCut, factorOf) {
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
function gtKernel(E, CV) {
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
      const vol = volumes(ctx, view, n, (i, key) => CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n))));
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
function gtPartial(acc) {
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
function gtMerge(parts) {
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

// ── the SWATH kernel ─────────────────────────────────────────────────────────
// params: { schema, series: [{ grade, weight, filter }], dirs: [[dx,dy,dz]…],
// fineOrigin: [..], fineW: [..], coords: [x, y, z] (names), vol: { base, dims } }.
// One chunk → per series, per direction, the fine bins' {Σw, Σwg, n} as
// transferable arrays + the series' row count. Same arithmetic as scanSwath's
// row path: the block's support × the weight, a fine bin per (t − origin) / width.
function swathKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema, ix = (nm) => sch.findIndex((c) => c.name === nm);
      const one = (txt, bool) => { if (!txt) return null; return bool ? E.compileChunkBool(txt, sch, { decimal: '.' }) : E.compileChunk(txt, sch, { decimal: '.' }); };
      return {
        params, calcFns: CV.compileCalcs(E, calcs, sch),
        series: params.series.map((s) => ({ grade: one(s.grade), weight: one(s.weight), filter: one(s.filter, true) })),
        cIdx: params.coords.map(ix), dimIdx: params.vol.dims ? params.vol.dims.map(ix) : null, scratch: {},
      };
    },
    group(ctx, view, n, mask) {
      const { params } = ctx, sc = ctx.scratch, dirs = params.dirs;
      const num = (i, key) => CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n)));
      const X = num(ctx.cIdx[0], 'x'), Y = num(ctx.cIdx[1], 'y'), Z = num(ctx.cIdx[2], 'z');
      const vol = volumes(ctx, view, n, num);
      return ctx.series.map((se, k) => {
        const g = CV.chunkNumbers(se.grade(view, n), n, sc['g' + k] || (sc['g' + k] = new Float64Array(n)));
        const w = se.weight ? CV.chunkNumbers(se.weight(view, n), n, sc['w' + k] || (sc['w' + k] = new Float64Array(n))) : null;
        const f = se.filter ? se.filter(view, n) : null;
        const fine = dirs.map(() => new Map());
        let cnt = 0;
        for (let i = 0; i < n; i++) {
          if (mask && !mask[i]) continue;
          const x = X[i], y = Y[i], z = Z[i]; if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
          if (f && f[i] !== 1) continue;
          const gv = g[i]; if (!Number.isFinite(gv)) continue;
          const wv = (w ? (w[i] || 0) : 1) * (vol ? vol[i] : params.vol.base); if (!(wv > 0)) continue;
          for (let di = 0; di < dirs.length; di++) {
            const d = dirs[di], t = x * d[0] + y * d[1] + z * d[2], bi = Math.floor((t - params.fineOrigin[di]) / params.fineW[di]);
            let e = fine[di].get(bi); if (!e) { e = [0, 0, 0]; fine[di].set(bi, e); }
            e[0] += wv; e[1] += wv * gv; e[2]++;
          }
          cnt++;
        }
        return { n: cnt, fine: fine.map((mp) => { const keys = Float64Array.from(mp.keys()), sw = new Float64Array(keys.length), swg = new Float64Array(keys.length), nn = new Float64Array(keys.length); let i = 0; for (const e of mp.values()) { sw[i] = e[0]; swg[i] = e[1]; nn[i] = e[2]; i++; } return { keys, sw, swg, n: nn }; }) };
      });
    },
  };
}
// partials (chunk order) → per series { n, fine: [Map(bin → { sw, swg, n })] per direction }
function swathMerge(parts, nSeries, nDirs) {
  const out = [];
  for (let k = 0; k < nSeries; k++) {
    const fine = Array.from({ length: nDirs }, () => new Map()); let cnt = 0;
    for (const p of parts) {
      const s = p && p[k]; if (!s) continue;
      cnt += s.n;
      s.fine.forEach((fd, di) => { for (let i = 0; i < fd.keys.length; i++) { const kb = fd.keys[i]; let e = fine[di].get(kb); if (!e) { e = { sw: 0, swg: 0, n: 0 }; fine[di].set(kb, e); } e.sw += fd.sw[i]; e.swg += fd.swg[i]; e.n += fd.n[i]; } });
    }
    out.push({ n: cnt, fine });
  }
  return out;
}

// per-record block support (sub-block dims → volume), = analysis.js volumeAt;
// null when every block has the constant volume
function volumes(ctx, view, n, num) {
  if (!ctx.dimIdx) return null;
  const sc = ctx.scratch, base = ctx.params.vol.base;
  const dx = num(ctx.dimIdx[0], 'dx'), dy = num(ctx.dimIdx[1], 'dy'), dz = num(ctx.dimIdx[2], 'dz');
  const vol = sc.vol && sc.vol.length >= n ? sc.vol : (sc.vol = new Float64Array(n));
  for (let i = 0; i < n; i++) { const v = Math.abs((dx[i] || 0) * (dy[i] || 0) * (dz[i] || 0)); vol[i] = v > 0 ? v : base; }
  return vol;
}

// ── weighted moments, numerically stable ──
// { sw, mean, m2 } by West's weighted Welford update, and Chan's merge between
// partials. Σwx² − (Σwx)²/Σw cancelled most of its digits when a column's spread is
// small next to its mean (SG ≈ 2.7 ± 0.16: ~1e-10 relative, and order-dependent);
// this keeps the spread itself, so page, workers and any chunking agree to ~1e-15.
// Population variance (m2 / Σw), as before.
function momentAdd(a, x, w) {
  a.sw += w;
  const d = x - a.mean;
  a.mean += d * (w / a.sw);
  a.m2 += w * d * (x - a.mean);
}
function momentMerge(a, b) {
  if (!b.sw) return;
  if (!a.sw) { a.sw = b.sw; a.mean = b.mean; a.m2 = b.m2; return; }
  const sw = a.sw + b.sw, d = b.mean - a.mean;
  a.mean += d * (b.sw / sw);
  a.m2 += b.m2 + d * d * (a.sw * b.sw / sw);
  a.sw = sw;
}
const momentStd = (a) => (a.sw > 0 ? Math.sqrt(Math.max(0, a.m2 / a.sw)) : NaN);

// ── the STATS kernel ─────────────────────────────────────────────────────────
// params: { schema, cols: [expr…] (quoted names), groupBy: expr | null, weight:
// expr | null }. One chunk → the groups in FIRST-SEEN order (so merging chunks in
// order reproduces the row path's group order and its 256-group cap), each with
// per column { n, sw, mean, m2, min, max } + a t-digest state (sluice). Moments
// are weighted; quantiles unweighted — as the window says.
function statsKernel(E, CV, SL) {
  const TD = SL.tdigest();
  return {
    init(params, calcs) {
      const sch = params.schema, one = (txt) => (txt ? E.compileChunk(txt, sch, { decimal: '.' }) : null);
      return { params, TD, calcFns: CV.compileCalcs(E, calcs, sch), cols: params.cols.map(one), groupBy: one(params.groupBy), weight: one(params.weight), scratch: {} };
    },
    group(ctx, view, n, mask) {
      const sc = ctx.scratch;
      const xs = ctx.cols.map((c, s) => CV.chunkNumbers(c(view, n), n, sc['c' + s] || (sc['c' + s] = new Float64Array(n))));
      const gv = ctx.groupBy ? ctx.groupBy(view, n).buf : null;
      const w = ctx.weight ? CV.chunkNumbers(ctx.weight(view, n), n, sc.w || (sc.w = new Float64Array(n))) : null;
      const groups = new Map(); let overflow = false;
      for (let i = 0; i < n; i++) {
        if (mask && !mask[i]) continue;
        let g = '';
        if (gv) { const v = gv[i]; g = v == null || v === '' || (typeof v === 'number' && v !== v) ? '—' : String(v); }
        let A = groups.get(g);
        if (!A) { if (groups.size >= 256) { overflow = true; continue; } A = xs.map(() => ({ n: 0, sw: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, vals: [] })); groups.set(g, A); }
        const wt = w ? (w[i] || 0) : 1;
        if (!(wt > 0)) continue;
        for (let s = 0; s < xs.length; s++) {
          const x = xs[s][i]; if (!Number.isFinite(x)) continue;
          const a = A[s];
          a.n++; momentAdd(a, x, wt);
          if (x < a.min) a.min = x; if (x > a.max) a.max = x;
          a.vals.push(x);
        }
      }
      const out = [];
      for (const [g, A] of groups) out.push([g, A.map((a) => { const td = TD.create(); if (a.vals.length) TD.pushArray(td, a.vals); return { n: a.n, sw: a.sw, mean: a.mean, m2: a.m2, min: a.min, max: a.max, td }; })]);
      return { groups: out, overflow };
    },
  };
}
// partials (chunk order) → { groups: Map(key → [acc per column]), overflow }
function statsMerge(SL, parts) {
  const TD = SL.tdigest(), groups = new Map(); let overflow = false;
  for (const p of parts) {
    if (!p) continue;
    if (p.overflow) overflow = true;
    for (const [g, accs] of p.groups) {
      let A = groups.get(g);
      if (!A) { if (groups.size >= 256) { overflow = true; continue; } groups.set(g, accs); continue; }
      accs.forEach((b, s) => {
        const a = A[s];
        a.n += b.n; momentMerge(a, b);
        if (b.min < a.min) a.min = b.min; if (b.max > a.max) a.max = b.max;
        a.td = TD.merge(a.td, b.td);
      });
    }
  }
  return { groups, overflow };
}

// ── CROSS-TAB: the resource table — tonnage, metal and count by a GROUP (a
// category, a paint column, a domain) × GRADE BINS between cutoffs. A group's
// cells are one Float64Array of [w, wg, n] per slot: slot 0 below the first
// cutoff, slot k in [edges[k-1], edges[k]), slot E (= edges.length) at or above
// the last, and slot E+1 the rows with NO grade (blank) — their tonnage still
// counts, so the table's total is the model's. Additive: a merge adds.
// params = { schema, group, grade, weight, filter, dScale, vol, edges }
const XTAB_GROUPS_CAP = 256;
// the slot of a grade under ascending `edges` (blank → the last slot)
function xtabSlot(edges, g) {
  if (!Number.isFinite(g)) return edges.length + 1;
  let lo = 0, hi = edges.length;                           // the number of edges ≤ g
  while (lo < hi) { const m = (lo + hi) >> 1; if (edges[m] <= g) lo = m + 1; else hi = m; }
  return lo;
}
// one row into the groups map → false once the cap refuses a NEW group
function xtabAdd(groups, key, edges, g, w) {
  let A = groups.get(key);
  if (!A) { if (groups.size >= XTAB_GROUPS_CAP) return false; A = new Float64Array(3 * (edges.length + 2)); groups.set(key, A); }
  const s = 3 * xtabSlot(edges, g);
  A[s] += w; if (Number.isFinite(g)) A[s + 1] += w * g; A[s + 2]++;
  return true;
}
const xtabKey = (v) => (v == null || v === '' || (typeof v === 'number' && v !== v) ? '—' : String(v));
function crosstabKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema;
      const one = (txt, bool) => { if (!txt) return null; return bool ? E.compileChunkBool(txt, sch, { decimal: '.' }) : E.compileChunk(txt, sch, { decimal: '.' }); };
      return {
        params, calcFns: CV.compileCalcs(E, calcs, sch),
        group: one(params.group), grade: one(params.grade), weight: one(params.weight), filter: one(params.filter, true),
        dimIdx: params.vol.dims ? params.vol.dims.map((nm) => sch.findIndex((c) => c.name === nm)) : null,
        scratch: {},
      };
    },
    group(ctx, view, n, mask) {
      const { params } = ctx, sc = ctx.scratch;
      const vol = volumes(ctx, view, n, (i, key) => CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n))));
      const g = CV.chunkNumbers(ctx.grade(view, n), n, sc.g || (sc.g = new Float64Array(n)));
      const w = ctx.weight ? CV.chunkNumbers(ctx.weight(view, n), n, sc.w || (sc.w = new Float64Array(n))) : null;
      const gv = ctx.group ? ctx.group(view, n).buf : null;
      const f = ctx.filter ? ctx.filter(view, n) : null;
      const groups = new Map(); let overflow = false;
      for (let i = 0; i < n; i++) {
        if (mask && !mask[i]) continue;
        if (f && f[i] !== 1) continue;
        const wv = (w ? ((w[i] || 0) * params.dScale) : 1) * (vol ? vol[i] : params.vol.base);   // a blank density reads 0 → skipped, as GT does
        if (!(wv > 0)) continue;
        if (!xtabAdd(groups, gv ? xtabKey(gv[i]) : '', params.edges, g[i], wv)) overflow = true;
      }
      return { groups: [...groups], overflow };
    },
  };
}
// partials (chunk order) → { groups: Map(key → cells), overflow }
function crosstabMerge(parts) {
  const groups = new Map(); let overflow = false;
  for (const p of parts) {
    if (!p) continue;
    if (p.overflow) overflow = true;
    for (const [k, c] of p.groups) {
      const A = groups.get(k);
      if (!A) { if (groups.size >= XTAB_GROUPS_CAP) { overflow = true; continue; } groups.set(k, Float64Array.from(c)); continue; }
      for (let i = 0; i < A.length; i++) A[i] += c[i];
    }
  }
  return { groups, overflow };
}

// ── the FILTER kernel ────────────────────────────────────────────────────────
// params: { schema, expr, coords: [x, y, z] (names), chan: name | null, cat: name
// | null, categories: [label…] | null, tee: [name…] | null }. One chunk → the
// match mask (1 = matches AND has finite coordinates — the renderer's own rule,
// so a null coordinate is never a phantom block at 0,0,0), the matched records'
// render data for compaction (x, y, z, channel, category code, offset), and, when
// the pin cache wants them, the decoded columns (numbers as Float64, text as a
// local dictionary + codes the page re-keys).
function filterKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema, ix = (nm) => (nm == null ? -1 : sch.findIndex((c) => c.name === nm));
      return {
        params, calcFns: CV.compileCalcs(E, calcs, sch), test: E.compileChunkBool(params.expr, sch, { decimal: '.' }),
        c: params.coords.map(ix), chan: ix(params.chan), cat: ix(params.cat),
        catCode: params.categories ? new Map(params.categories.map((v, i) => [v, i])) : null,
        tee: (params.tee || []).map((nm) => [nm, ix(nm)]), scratch: {},
      };
    },
    group(ctx, view, n) {
      const sc = ctx.scratch;
      const num = (i, key) => (i < 0 ? null : CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n))));
      const mk = ctx.test(view, n);
      const X = num(ctx.c[0], 'x'), Y = num(ctx.c[1], 'y'), Z = num(ctx.c[2], 'z'), CH = num(ctx.chan, 'ch');
      const C = ctx.cat >= 0 ? view[ctx.cat] : null;
      const mask = new Uint8Array(n);
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (mk[i] !== 1) continue;
        if (!Number.isFinite(X[i]) || !Number.isFinite(Y[i]) || !Number.isFinite(Z[i])) continue;
        mask[i] = 1; k++;
      }
      const mx = new Float64Array(k), my = new Float64Array(k), mz = new Float64Array(k), mch = new Float64Array(k), rec = new Uint32Array(k);
      const mcat = ctx.catCode && C ? new Uint8Array(k) : null;
      for (let i = 0, j = 0; i < n; i++) {
        if (!mask[i]) continue;
        mx[j] = X[i]; my[j] = Y[i]; mz[j] = Z[i];
        mch[j] = CH && Number.isFinite(CH[i]) ? CH[i] : 0;
        if (mcat) mcat[j] = ctx.catCode.get(String(C[i] ?? '').trim()) ?? 0;
        rec[j] = i; j++;
      }
      let tee = null;
      if (ctx.tee.length) {
        tee = {};
        for (const [nm, i] of ctx.tee) {
          const src = i >= 0 ? view[i] : null;
          if (!src) { tee[nm] = null; continue; }
          let kind = null;
          for (let q = 0; q < n && kind === null; q++) { const v = src[q]; if (v != null) kind = typeof v === 'number' ? 'num' : 'str'; }
          if (kind !== 'str') { const d = new Float64Array(n); for (let q = 0; q < n; q++) { const v = src[q]; d[q] = v == null ? NaN : +v; } tee[nm] = { data: d }; continue; }
          const dict = [''], map = new Map([['', 0]]), codes = new Uint16Array(n);
          let ok = true;
          for (let q = 0; q < n; q++) {
            const v = src[q] == null ? '' : String(src[q]); let c = map.get(v);
            if (c === undefined) { if (dict.length > 65535) { ok = false; break; } c = dict.length; dict.push(v); map.set(v, c); }
            codes[q] = c;
          }
          tee[nm] = ok ? { dict, codes } : null;
        }
      }
      return { mask, hits: k, match: { x: mx, y: my, z: mz, chan: mch, cat: mcat, rec }, tee };
    },
  };
}

// ── the VALUES kernel ────────────────────────────────────────────────────────
// params: { schema, expr (a column name quoted, or a calc's text), blank, coords }.
// One chunk → the value of every record as Float32 (what the colour-by texture
// holds: one texel per record), a blank written as `blank`, + the min/max over
// the records that are DRAWN (finite x, y, z — the renderer's rule), so the
// colour range is the one the chunks would have carried.
function valuesKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema;
      return { params, calcFns: CV.compileCalcs(E, calcs, sch), val: E.compileChunk(params.expr, sch, { decimal: '.' }),
        c: (params.coords || []).map((nm) => sch.findIndex((c) => c.name === nm)), scratch: {} };
    },
    group(ctx, view, n) {
      const sc = ctx.scratch;
      const V = CV.chunkNumbers(ctx.val(view, n), n, sc.v || (sc.v = new Float64Array(n)));
      const num = (i, key) => CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n)));
      const C = ctx.c.length === 3 && ctx.c.every((i) => i >= 0) ? [num(ctx.c[0], 'x'), num(ctx.c[1], 'y'), num(ctx.c[2], 'z')] : null;
      const v = new Float32Array(n), blank = ctx.params.blank;
      let lo = Infinity, hi = -Infinity, finite = 0;
      for (let i = 0; i < n; i++) {
        const x = V[i];
        if (!Number.isFinite(x)) { v[i] = blank; continue; }
        v[i] = x;
        if (C && !(Number.isFinite(C[0][i]) && Number.isFinite(C[1][i]) && Number.isFinite(C[2][i]))) continue;   // not drawn: not in the range
        if (x < lo) lo = x; if (x > hi) hi = x; finite++;
      }
      return { v, lo, hi, finite };
    },
  };
}

// ── the POSITIONS kernel ─────────────────────────────────────────────────────
// params: { schema, coords: [x, y, z] (names) }. One chunk → the coordinates of
// the records that HAVE them (finite x, y, z — the renderer's rule) + their
// offsets in the chunk. A block with no X is not a block at the origin.
function positionsKernel(E, CV) {
  return {
    init(params, calcs) {
      const sch = params.schema;
      return { params, calcFns: CV.compileCalcs(E, calcs, sch), c: params.coords.map((nm) => sch.findIndex((c) => c.name === nm)), scratch: {} };
    },
    group(ctx, view, n) {
      const sc = ctx.scratch;
      const num = (i, key) => CV.chunkNumbers({ buf: view[i] || [] }, n, sc[key] || (sc[key] = new Float64Array(n)));
      const X = num(ctx.c[0], 'x'), Y = num(ctx.c[1], 'y'), Z = num(ctx.c[2], 'z');
      let k = 0;
      for (let i = 0; i < n; i++) if (Number.isFinite(X[i]) && Number.isFinite(Y[i]) && Number.isFinite(Z[i])) k++;
      const x = new Float64Array(k), y = new Float64Array(k), z = new Float64Array(k), rec = new Uint32Array(k);
      for (let i = 0, j = 0; i < n; i++) {
        if (!(Number.isFinite(X[i]) && Number.isFinite(Y[i]) && Number.isFinite(Z[i]))) continue;
        x[j] = X[i]; y[j] = Y[i]; z[j] = Z[i]; rec[j] = i; j++;
      }
      return { x, y, z, rec };
    },
  };
}

// ── src/chunkview.js ──

// @gcu/scan chunkview — THE view of a chunk of records that every expression sees:
// the base columns by name, then the stored derived columns (painted labels /
// ratio fractions / materialized values), then the calc columns evaluated in
// dependency order. Positions follow schemaExt (base · paint · calc).
//
// ZERO imports on purpose: the page uses it (micro's columns.js census) and so do
// the scan workers (worker.js), and a module worker has no import map, so
// anything it imports must arrive by URL. What it needs (@gcu/expr's compileChunk)
// is passed in. One definition on both sides — the semantics can't drift apart.

// spec: { base: [name…], paints: [{ name, kind, mat, dict, need }] } — paints in
// L.paintCols order; `need` false skips the column (left null, as the census did).
// page: per paint index, the chunk's slice — Uint8 codes, or the materialized
// Float32 values (null = evicted → blank). calcFns: [{ slot, fn }] from compileCalcs.
function chunkView(spec, baseByName, page, n, calcFns) {
  const base = spec.base, pcs = spec.paints;
  const out = new Array(base.length + pcs.length + (spec.calcCount || 0)).fill(null);
  for (let i = 0; i < base.length; i++) { const c = baseByName[base[i]]; if (c) out[i] = c; }
  for (let j = 0; j < pcs.length; j++) {
    const pc = pcs[j];
    if (!pc.need) continue;
    const src = page[j];
    if (pc.mat) { out[base.length + j] = src || null; continue; }
    const a = new Array(n);
    if (!src) { a.fill(pc.kind === 'ratio' ? 0 : ''); out[base.length + j] = a; continue; }
    for (let i = 0; i < n; i++) { const code = src[i] || 0; a[i] = pc.kind === 'ratio' ? +(code / 255).toFixed(3) : ((code && pc.dict[code]) || ''); }
    out[base.length + j] = a;
  }
  if (calcFns) for (const { slot, fn } of calcFns) { const { buf } = fn(out, n); out[slot] = buf; }
  return out;
}

// calcs: [{ slot, expr }] in dependency order (calcOrder) → [{ slot, fn }]. A calc
// that won't compile reads blank, as everywhere.
function compileCalcs(E, calcs, schema) {
  return calcs.map(({ slot, expr }) => {
    let fn; try { fn = E.compileChunk(expr, schema, { decimal: '.' }); } catch { fn = () => ({ t: 'raw', buf: [] }); }
    return { slot, fn };
  });
}

// a chunk result as numbers for the analyses: compileChunk hands back a Float64
// buffer (blank = NaN) or raw values, where a blank is '' or null — MISSING, never
// 0 (unary plus would say 0). Same rule as records.js numOf.
function chunkNumbers(r, n, out) {
  const buf = r.buf;
  if (buf instanceof Float64Array) return buf;
  const o = out && out.length >= n ? out : new Float64Array(n);
  if (r.t === 'bool' && ArrayBuffer.isView(buf)) {         // 0 / 1, and 2 = blank
    for (let i = 0; i < n; i++) o[i] = buf[i] === 2 ? NaN : buf[i];
    return o;
  }
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    o[i] = typeof v === 'number' ? v : v == null || (typeof v === 'string' && v.trim() === '') ? NaN : +v;   // true → 1, false → 0, as numOf
  }
  return o;
}

// ── src/colacc.js ──

// @gcu/scan colacc — the per-column statistics accumulator.
//
// ZERO imports, like kernels.js: the page and the workers push values through
// this one definition (the worker bundle carries it too), so their states merge.
// sl = the @gcu/sluice exports. Numbers: welford + t-digest; text: topK +
// cardinality. States are plain data (structured-cloneable) and merge.

const STAT_SLICE = 65536;

function makeColAcc(sl) {
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

// ── src/tasks.js ──

// @gcu/scan tasks — the per-unit jobs a Parquet model's open runs: the discovery
// summary of one row group, and its render decode. ZERO imports: condenser's
// coordNum and dimKey come in as `cd`, so the worker and the page read a
// coordinate and key a block size by ONE definition (they were copies, three
// times over, embedded into the worker with toString()).

// ── discovery: what the open's sweep collects, for one row group ──────────────
// Merged in group order, exactly what a sequential sweep gives: per-axis distinct
// centroids rounded to 10 digits (capped), bbox, the category values (capped at
// 257), the smallest size per axis and the distinct size keys, and the first
// `res` valid centroids.
function discoverGroup(cd, p, cols, count, res) {
  const cn = cd.coordNum, r10 = (v) => Number(v.toPrecision(10));
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], C = p.catN ? cols[p.catN] : null;
  const DX = p.dN ? cols[p.dN[0]] : null, DY = p.dN ? cols[p.dN[1]] : null, DZ = p.dN ? cols[p.dN[2]] : null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const ax = [new Set(), new Set(), new Set()], seen = [new Set(), new Set(), new Set()];
  const cats = C ? new Set() : null, dims = DX ? new Set() : null, minDim = [Infinity, Infinity, Infinity];
  const out = res > 0 ? new Float64Array(res * 3) : null;
  let nres = 0, valid = 0;
  const add = (a, v) => {
    if (ax[a].size >= p.cap) return;
    const s = seen[a];
    if (s.size < p.cap * 4) { if (s.has(v)) return; s.add(v); }
    ax[a].add(r10(v));
  };
  for (let i = 0; i < count; i++) {
    const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    valid++;
    if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
    if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
    if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
    add(0, xv); add(1, yv); add(2, zv);
    if (nres < res) { out[nres * 3] = xv; out[nres * 3 + 1] = yv; out[nres * 3 + 2] = zv; nres++; }
    if (cats && cats.size <= 256) { const v = C[i]; if (v != null && v !== '') cats.add(String(v)); }
    if (DX) {
      const dx = +DX[i], dy = +DY[i], dz = +DZ[i];
      if (dx > 0 && dy > 0 && dz > 0) {
        if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
        if (dims.size <= p.dimMax) dims.add(cd.dimKey(dx, dy, dz));
      }
    }
  }
  return {
    valid, min, max, ax: ax.map((s) => [...s]),
    cats: cats ? [...cats] : null, dims: dims ? [...dims] : null, minDim,
    res: out ? out.subarray(0, nres * 3) : null,
  };
}

// ── check: the first centroid in one group off a declared lattice ─────────────
// p = { cols: [x, y, z], grid }; records RAW (start + i) → a misfit message or null
function checkGroup(cd, p, cols, start, count) {
  const X = cols[p.cols[0]], Y = cols[p.cols[1]], Z = cols[p.cols[2]], cn = cd.coordNum;
  let bad = null;
  for (let i = 0; i < count && !bad; i++) { const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]); if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) bad = cd.latticeMisfit(p.grid, xv, yv, zv, start + i); }
  return bad;
}

// ── decode: one row group as the chunk builder's typed arrays ─────────────────
// the code maps a decode job's params name (built once per worker, or per job on the page)
function decodeCodes(p) {
  return {
    cat: p.categories ? new Map(p.categories.map((v, i) => [v, i])) : null,
    dim: p.dimKeys ? new Map(p.dimKeys.map((k, i) => [k, i])) : null,
  };
}
// codes = { cat: Map(value → code) | null, dim: Map(dimKey → palette index) | null }.
// A row without a usable centroid isn't drawn; record numbers stay RAW.
function decodeGroup(cd, p, cols, start, count, codes) {
  const cn = cd.coordNum;
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], CH = p.chanN ? cols[p.chanN] : null, CA = p.catN ? cols[p.catN] : null;
  const DX = p.sizeN ? cols[p.sizeN[0]] : null, DY = p.sizeN ? cols[p.sizeN[1]] : null, DZ = p.sizeN ? cols[p.sizeN[2]] : null;
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
  const cat = codes.cat ? new Uint8Array(count) : null, dim = codes.dim ? new Uint8Array(count) : null, recIdx = new Uint32Array(count);
  const memo = new Map();
  const dimCode = (dx, dy, dz) => {
    let my = memo.get(dx); if (!my) memo.set(dx, my = new Map());
    let mz = my.get(dy); if (!mz) my.set(dy, mz = new Map());
    let c = mz.get(dz); if (c === undefined) mz.set(dz, c = codes.dim.get(cd.dimKey(dx, dy, dz)) ?? 0);
    return c;
  };
  let m = 0;
  for (let i = 0; i < count; i++) {
    const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    x[m] = xv; y[m] = yv; z[m] = zv;
    chan[m] = CH ? (CH[i] == null ? NaN : +CH[i]) : 0;    // a null grade is missing (NaN), not 0
    if (cat) cat[m] = codes.cat.get(String(CA[i] ?? '')) ?? 0;
    if (dim) dim[m] = dimCode(+DX[i], +DY[i], +DZ[i]);
    recIdx[m++] = start + i;
  }
  // trimmed copies, not views: the transfer list moves whole buffers
  const cut = (a) => (a && m < count ? a.slice(0, m) : a);
  return { count: m, x: cut(x), y: cut(y), z: cut(z), chan: cut(chan), cat: cut(cat), dim: cut(dim), recIdx: cut(recIdx), recStart: start };
}

// ── src/worker.js ──

const kernels = Object.freeze({ GT_BINS_TARGET, GT_BINS_CAP, gtEdge, gtBinOf, gtAccumulator, gtAbove, gtCuts, gtKernel, gtPartial, gtMerge, swathKernel, swathMerge, momentAdd, momentMerge, momentStd, statsKernel, statsMerge, XTAB_GROUPS_CAP, xtabSlot, xtabAdd, xtabKey, crosstabKernel, crosstabMerge, filterKernel, valuesKernel, positionsKernel });
const CV = Object.freeze({ chunkView, compileCalcs, chunkNumbers });
// @gcu/scan worker — the body of every pool worker, a real module (it used to be
// a template string with functions pasted in by toString(), where a module-scope
// reference worked on the page and threw only in the worker).
//
// The worker bundle (worker.js at the package root) has ZERO static imports: a
// module worker started from a blob has no import map, so its libraries arrive
// as URLs in the init message (`libs`) and are imported then — parquet + sluice
// always, condenser for a .dm / delimited source, a lattice check or a decode,
// expr for a scan. Kernels, the chunk view, the accumulator and the tasks are
// this bundle's own code: one definition on the page and in the worker.

// every ArrayBuffer under a result, for the transfer list (a scan partial's bins)
function buffersOf(o, out = []) {
  if (o && ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); }
  else if (Array.isArray(o)) for (const x of o) buffersOf(x, out);
  else if (o && typeof o === 'object') for (const k in o) buffersOf(o[k], out);
  return out;
}

// load(url) imports a library: the pool's bootstrap passes `(u) => import(u)` (a bundle may not
// carry a dynamic import — @gcu/build E006 — and it needn't: the bootstrap is a string)
function serve(self, load) {
  let file = null, meta = null, task = null, p = null, st = null, acc = null, codes = null;
  let PQ = null, SL = null, CD = null, kern = null, kctx = null;
  self.onmessage = async ({ data }) => {
    try {
      if (data.type === 'init') {
        ({ file, meta, task, p } = data);
        const libs = data.libs;
        [PQ, SL] = await Promise.all([load(libs.parquet), load(libs.sluice)]);
        const needCD = task === 'check' || task === 'discover' || task === 'decode' || (task === 'scan' && p.source && (p.source.kind === 'dm' || p.source.kind === 'csv'));
        if (needCD) CD = await load(libs.condenser);
        if (task === 'stats') { acc = makeColAcc(SL); st = p.cols.map((c) => acc.create(c.num)); }
        if (task === 'scan') { const E = await load(libs.expr); kern = kernels[p.kernel + 'Kernel'](E, CV, SL); kctx = kern.init(p.params, p.calcs); }
        if (task === 'decode') codes = decodeCodes(p);
        self.postMessage({ type: 'ready' });
      } else if (data.type === 'job') {
        const { id, start, count } = data;
        if (task === 'stats') {
          // one column at a time: a whole group's columns at once is a bigger heap
          for (let k = 0; k < p.cols.length; k++) {
            const name = p.cols[k].name;
            const arr = (await PQ.readParquetRange(file, [name], start, start + count, meta))[name];
            if (p.cols[k].num) for (let a = 0; a < count; a += 65536) acc.pushNumbers(st[k], arr, a, Math.min(count, a + 65536));
            else for (let i = 0; i < count; i++) acc.pushText(st[k], arr[i]);
          }
          self.postMessage({ type: 'result', id, out: { count } });
        } else if (task === 'discover') {
          const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
          const out = discoverGroup(CD, p, cols, count, data.res || 0);
          self.postMessage({ type: 'result', id, out }, out.res ? [out.res.buffer] : []);
        } else if (task === 'check') {
          const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
          self.postMessage({ type: 'result', id, out: { bad: checkGroup(CD, p, cols, start, count) } });
        } else if (task === 'scan') {
          // the needed columns of this unit → the chunk view → the kernel's partial
          let cols = {};
          if (p.readCols.length && p.source && p.source.kind === 'dm') {
            const r = await CD.readDmRun(file, p.source.h, p.source.idx, data.run);
            p.readCols.forEach((n, k) => { cols[n] = r.cols[p.source.idx[k]]; });
          } else if (p.readCols.length && p.source && p.source.kind === 'csv') {
            const r = await CD.readDelimitedRun(file, data.run, p.source.o);
            p.readCols.forEach((n, k) => { cols[n] = r[k]; });
          } else if (p.readCols.length) cols = await PQ.readParquetRange(file, p.readCols, start, start + count, meta);
          const view = CV.chunkView(p.spec, cols, data.page || [], count, kctx.calcFns);
          const out = kern.group(kctx, view, count, data.mask || null);
          self.postMessage({ type: 'result', id, out }, buffersOf(out));
        } else if (task === 'decode') {
          const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
          const out = decodeGroup(CD, p, cols, start, count, codes);
          const tr = [out.x.buffer, out.y.buffer, out.z.buffer, out.chan.buffer, out.recIdx.buffer];
          if (out.cat) tr.push(out.cat.buffer); if (out.dim) tr.push(out.dim.buffer);
          self.postMessage({ type: 'result', id, out }, tr);
        }
      } else if (data.type === 'finish') {
        self.postMessage({ type: 'final', out: task === 'stats' ? st : null });
      }
    } catch (e) { self.postMessage({ type: 'error', id: data && data.id, message: (e && e.message) || String(e) }); }
  };
}

// ── src/worker-main.js ──

// @gcu/scan — the worker bundle's entry (worker.js at the package root): what a
// pool worker imports. Zero static imports beyond this package's own code.

export {
  serve,
};
