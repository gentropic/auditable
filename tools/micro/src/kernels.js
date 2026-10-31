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

// ── the SWATH kernel ─────────────────────────────────────────────────────────
// params: { schema, series: [{ grade, weight, filter }], dirs: [[dx,dy,dz]…],
// fineOrigin: [..], fineW: [..], coords: [x, y, z] (names), vol: { base, dims } }.
// One chunk → per series, per direction, the fine bins' {Σw, Σwg, n} as
// transferable arrays + the series' row count. Same arithmetic as scanSwath's
// row path: the block's support × the weight, a fine bin per (t − origin) / width.
export function swathKernel(E, CV) {
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
export function swathMerge(parts, nSeries, nDirs) {
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

// ── the STATS kernel ─────────────────────────────────────────────────────────
// params: { schema, cols: [expr…] (quoted names), groupBy: expr | null, weight:
// expr | null }. One chunk → the groups in FIRST-SEEN order (so merging chunks in
// order reproduces the row path's group order and its 256-group cap), each with
// per column { n, sw, swx, swx2, min, max } + a t-digest state (sluice). Moments
// are weighted; quantiles unweighted — as the window says.
export function statsKernel(E, CV, SL) {
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
        if (!A) { if (groups.size >= 256) { overflow = true; continue; } A = xs.map(() => ({ n: 0, sw: 0, swx: 0, swx2: 0, min: Infinity, max: -Infinity, vals: [] })); groups.set(g, A); }
        const wt = w ? (w[i] || 0) : 1;
        if (!(wt > 0)) continue;
        for (let s = 0; s < xs.length; s++) {
          const x = xs[s][i]; if (!Number.isFinite(x)) continue;
          const a = A[s];
          a.n++; a.sw += wt; a.swx += wt * x; a.swx2 += wt * x * x;
          if (x < a.min) a.min = x; if (x > a.max) a.max = x;
          a.vals.push(x);
        }
      }
      const out = [];
      for (const [g, A] of groups) out.push([g, A.map((a) => { const td = TD.create(); if (a.vals.length) TD.pushArray(td, a.vals); return { n: a.n, sw: a.sw, swx: a.swx, swx2: a.swx2, min: a.min, max: a.max, td }; })]);
      return { groups: out, overflow };
    },
  };
}
// partials (chunk order) → { groups: Map(key → [acc per column]), overflow }
export function statsMerge(SL, parts) {
  const TD = SL.tdigest(), groups = new Map(); let overflow = false;
  for (const p of parts) {
    if (!p) continue;
    if (p.overflow) overflow = true;
    for (const [g, accs] of p.groups) {
      let A = groups.get(g);
      if (!A) { if (groups.size >= 256) { overflow = true; continue; } groups.set(g, accs); continue; }
      accs.forEach((b, s) => {
        const a = A[s];
        a.n += b.n; a.sw += b.sw; a.swx += b.swx; a.swx2 += b.swx2;
        if (b.min < a.min) a.min = b.min; if (b.max > a.max) a.max = b.max;
        a.td = TD.merge(a.td, b.td);
      });
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
export function filterKernel(E, CV) {
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

// ── the POSITIONS kernel ─────────────────────────────────────────────────────
// params: { schema, coords: [x, y, z] (names) }. One chunk → the coordinates of
// the records that HAVE them (finite x, y, z — the renderer's rule) + their
// offsets in the chunk. A block with no X is not a block at the origin.
export function positionsKernel(E, CV) {
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
