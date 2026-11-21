// Distributions, tier 2: violinplot, hexbin, hist2d — matplotlib's algorithms.
//
// - violinplot: a Gaussian KDE per dataset (bandwidth by Scott's rule, n^-1/5 × the sample
//   std, as matplotlib's mlab.GaussianKDE; 'silverman', a number or a function too), evaluated
//   at `points` values from the data's min to its max, scaled so the widest point is
//   widths / 2 each side. Extrema, medians, means and quantiles as lines across, half the width.
// - hexbin: matplotlib's lattice exactly — two offset rectangular lattices, each point to the
//   nearer centre (the 3:1 metric), so counts match matplotlib's for the same gridsize and
//   extent. With no C every hexagon of the extent is drawn, empty ones at the bottom of the
//   colour map (bins='log' leaves them clear); with C, reduce_C_function (mean) of the values
//   in each.
// - hist2d: numpy's histogram2d (even bins, the last edge inclusive), drawn as a pcolormesh;
//   returns [h, xedges, yedges, image], h[i][j] the count of x bin i and y bin j.

import { Axes, _KINDS, _plainOpts, _lenErr, _result } from './axes.js';
import { _col, _isArrayLike } from './data.js';
import { _cssColor, _cmapLut, getCmap } from './color.js';
import { _indexer } from './norm.js';
import { _warn, _checkOpts } from './opts.js';
import { _datasets } from './box.js';

// ── violinplot ──
const _finiteSorted = (d) => { const v = []; for (let i = 0; i < d.length; i++) { const x = +d[i]; if (x - x === 0) v.push(x); } return v.sort((a, b) => a - b); };
function _vpct(v, p) { const n = v.length; if (!n) return NaN; const k = (n - 1) * p, f = Math.floor(k), c = Math.min(n - 1, f + 1); return v[f] + (v[c] - v[f]) * (k - f); }

// the KDE of sorted values at `points` coordinates between min and max
export function _violinStats(v, points, bw) {
  const n = v.length;
  const out = { coords: [], vals: [], mean: NaN, median: NaN, min: NaN, max: NaN, n };
  if (!n) return out;
  let mean = 0; for (const x of v) mean += x; mean /= n;
  let ss = 0; for (const x of v) ss += (x - mean) * (x - mean);
  const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  Object.assign(out, { mean, median: _vpct(v, 0.5), min: v[0], max: v[n - 1] });
  const factor = typeof bw === 'function' ? bw(v) : typeof bw === 'number' ? bw
    : bw === 'silverman' ? Math.pow((n * 3) / 4, -0.2) : Math.pow(n, -0.2);
  const h = factor * std;
  if (!(h > 0)) return out;                                 // constant data: lines only
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  for (let k = 0; k < points; k++) {
    const c = points > 1 ? v[0] + ((v[n - 1] - v[0]) * k) / (points - 1) : v[0];
    let s = 0;
    for (let i = 0; i < n; i++) { const z = (c - v[i]) / h; if (z > -8 && z < 8) s += Math.exp(-0.5 * z * z); }
    out.coords.push(c); out.vals.push(s * norm);
  }
  return out;
}

Axes.prototype.violinplot = function (dataset, opts) {
  if (_plainOpts(dataset) && opts == null && dataset.dataset != null) { opts = dataset; dataset = opts.dataset; }
  const o = _plainOpts(opts) ? { ...opts } : {};
  const known = ['positions', 'vert', 'orientation', 'widths', 'showmeans', 'showextrema', 'showmedians', 'quantiles', 'points', 'bw_method', 'side', 'zorder', '_kw'];
  for (const k of Object.keys(o)) if (!known.includes(k)) _warn('violinplot.' + k, `violinplot() has no option '${k}'`, this._strict);
  const { sets, labels } = _datasets(dataset);
  const horiz = o.vert === false || o.orientation === 'horizontal';
  const positions = o.positions ? Array.from(o.positions, Number) : sets.map((_, i) => i + 1);
  if (positions.length !== sets.length) throw _lenErr('violinplot', 'positions', positions.length, 'dataset', sets.length);
  const widths = o.widths == null ? positions.map(() => 0.5) : _isArrayLike(o.widths) ? Array.from(o.widths, Number) : positions.map(() => +o.widths);
  const points = o.points || 100;
  const qs = o.quantiles ? (Array.isArray(o.quantiles[0]) || ArrayBuffer.isView(o.quantiles[0]) ? o.quantiles.map((q) => Array.from(q, Number)) : sets.map(() => Array.from(o.quantiles, Number))) : null;
  const sorted = sets.map(_finiteSorted);
  const stats = sorted.map((v) => _violinStats(v, points, o.bw_method));
  const color = this._nextColor();
  const trace = {
    type: 'violin', stats, positions, widths, horiz, qs, sorted, side: o.side || 'both',
    show: { means: !!o.showmeans, extrema: o.showextrema !== false, medians: !!o.showmedians },
    body: stats.map(() => ({ facecolor: color, edgecolor: null, alpha: 0.3 })),
    lines: { cmeans: { color }, cmins: { color }, cmaxes: { color }, cbars: { color }, cmedians: { color }, cquantiles: { color } },
    opts: { zorder: o.zorder, label: undefined, color },
  };
  this._traces.push(trace);
  if (labels) this[horiz ? 'set_yticks' : 'set_xticks'](positions, labels);
  // matplotlib's returns: bodies you restyle (set_facecolor / set_edgecolor / set_alpha), the
  // line collections (set_color / set_linewidth)
  const body = (i) => ({
    set_facecolor(c) { trace.body[i].facecolor = _cssColor(c); return this; },
    set_edgecolor(c) { trace.body[i].edgecolor = c === 'none' ? null : _cssColor(c); return this; },
    set_alpha(a) { trace.body[i].alpha = a == null ? 1 : +a; return this; },
    set_linewidth(w) { trace.body[i].linewidth = +w; return this; },
    get_facecolor: () => trace.body[i].facecolor,
  });
  const coll = (k) => ({
    set_color(c) { trace.lines[k].color = _cssColor(c); return this; },
    set_linewidth(w) { trace.lines[k].linewidth = +w; return this; },
    set_linestyle(s) { trace.lines[k].linestyle = s; return this; },
  });
  const out = { bodies: stats.map((_, i) => body(i)), stats: stats.map((s) => ({ mean: s.mean, median: s.median, min: s.min, max: s.max, coords: s.coords, vals: s.vals })) };
  if (trace.show.extrema) { out.cmins = coll('cmins'); out.cmaxes = coll('cmaxes'); out.cbars = coll('cbars'); }
  if (trace.show.means) out.cmeans = coll('cmeans');
  if (trace.show.medians) out.cmedians = coll('cmedians');
  if (qs) out.cquantiles = coll('cquantiles');
  return _result(this, [], out);
};

_KINDS.violin = {
  z: 2, patch: true,
  extent(ax, t, axis, log, take) {
    const along = t.horiz ? axis === 'y' : axis === 'x';
    t.stats.forEach((s, i) => {
      if (along) { take(t.positions[i] - t.widths[i] / 2); take(t.positions[i] + t.widths[i] / 2); }
      else { take(s.min); take(s.max); }
    });
  },
  render(ax, ctx, t, xScale, yScale) {
    const P = (a, v) => (t.horiz ? [xScale.transform(v), yScale.transform(a)] : [xScale.transform(a), yScale.transform(v)]);
    ctx.save();
    t.stats.forEach((s, i) => {
      const p = t.positions[i], w = t.widths[i], b = t.body[i];
      if (s.vals.length) {
        let vmax = 0; for (const v of s.vals) if (v > vmax) vmax = v;
        const k = (0.5 * w) / vmax, n = s.coords.length;
        const right = t.side !== 'low', left = t.side !== 'high';
        ctx.beginPath();
        for (let j = 0; j < n; j++) { const q = P(p + (right ? s.vals[j] * k : 0), s.coords[j]); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        for (let j = n - 1; j >= 0; j--) { const q = P(p - (left ? s.vals[j] * k : 0), s.coords[j]); ctx.lineTo(q[0], q[1]); }
        ctx.closePath();
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = b.facecolor; ctx.fill();
        ctx.globalAlpha = 1;
        if (b.edgecolor) { ctx.strokeStyle = b.edgecolor; ctx.lineWidth = b.linewidth || 1; ctx.stroke(); }
      }
      // the lines across: half the width, matplotlib's
      const seg = (key, v, half = w / 4) => {
        const L = t.lines[key], a = P(p - half, v), c = P(p + half, v);
        if (!(a[0] - a[0] === 0 && a[1] - a[1] === 0)) return;
        ctx.strokeStyle = L.color; ctx.lineWidth = L.linewidth || 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      };
      if (t.show.extrema && s.n) {
        seg('cmins', s.min); seg('cmaxes', s.max);
        const L = t.lines.cbars, a = P(p, s.min), c = P(p, s.max);
        ctx.strokeStyle = L.color; ctx.lineWidth = L.linewidth || 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
      if (t.show.medians && s.n) seg('cmedians', s.median);
      if (t.show.means && s.n) seg('cmeans', s.mean);
      if (t.qs && t.qs[i]) for (const q of t.qs[i]) seg('cquantiles', _vpct(t.sorted[i], q), w / 8);
    });
    ctx.restore();
  },
  legend(ax, t) { return { patch: true, color: t.body[0] && t.body[0].facecolor }; },
  pick(ax, t, px, py) {
    const v = ax.view;
    for (let i = 0; i < t.positions.length; i++) {
      const p = t.positions[i], w = t.widths[i];
      const a = (t.horiz ? v.yScale : v.xScale).transform(p - w / 2), b = (t.horiz ? v.yScale : v.xScale).transform(p + w / 2);
      const q = t.horiz ? py : px;
      if (q >= Math.min(a, b) && q <= Math.max(a, b)) { const s = t.stats[i]; return { kind: 'violin', index: i, x: t.horiz ? s.median : p, y: t.horiz ? p : s.median, value: s.median }; }
    }
    return null;
  },
};

// ── hexbin ──
// matplotlib's mtransforms.nonsingular: a zero-width range opens by 10 %
function _nonsingular(lo, hi) {
  if (!(hi - lo > 1e-12 * Math.max(Math.abs(lo), Math.abs(hi), 1e-300))) {
    if (lo === 0 && hi === 0) return [-0.1, 0.1];
    return [lo - 0.1 * Math.abs(lo), hi + 0.1 * Math.abs(hi)];
  }
  return [lo, hi];
}

Axes.prototype.hexbin = function (x, y, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  _checkOpts('hexbin', o, this._strict);
  const X = _col(x), Y = _col(y), n = X.length;
  if (Y.length !== n) throw _lenErr('hexbin', 'y', Y.length, 'x', n);
  const C = o.C != null ? _col(o.C) : null;
  if (C && C.length !== n) throw _lenErr('hexbin', 'C', C.length, 'x', n);
  const gs = o.gridsize == null ? 100 : o.gridsize;
  const [nx, ny] = _isArrayLike(gs) ? [Math.max(1, Math.round(gs[0])), Math.max(1, Math.round(gs[1]))] : [Math.max(1, Math.round(gs)), Math.max(1, Math.floor(gs / Math.sqrt(3)))];
  let xmin, xmax, ymin, ymax;
  if (o.extent) [xmin, xmax, ymin, ymax] = Array.from(o.extent, Number);
  else {
    xmin = Infinity; xmax = -Infinity; ymin = Infinity; ymax = -Infinity;
    for (let i = 0; i < n; i++) { const a = X[i], b = Y[i]; if (a - a !== 0 || b - b !== 0) continue; if (a < xmin) xmin = a; if (a > xmax) xmax = a; if (b < ymin) ymin = b; if (b > ymax) ymax = b; }
    if (xmin > xmax) { xmin = 0; xmax = 1; ymin = 0; ymax = 1; }
    [xmin, xmax] = _nonsingular(xmin, xmax); [ymin, ymax] = _nonsingular(ymin, ymax);
  }
  const pad = 1e-9 * (xmax - xmin);
  xmin -= pad; xmax += pad;
  const sx = (xmax - xmin) / nx, sy = (ymax - ymin) / ny;
  const nx1 = nx + 1, ny1 = ny + 1, n1 = nx1 * ny1, n2 = nx * ny;
  const count = new Float64Array(n1 + n2);
  const reduce = typeof o.reduce_C_function === 'function' ? o.reduce_C_function : null;
  const sum = C ? new Float64Array(n1 + n2) : null;
  const lists = C && reduce ? Array.from({ length: n1 + n2 }, () => []) : null;
  for (let i = 0; i < n; i++) {
    const a = X[i], b = Y[i];
    if (a - a !== 0 || b - b !== 0) continue;
    if (C && C[i] - C[i] !== 0) continue;
    const ix = (a - xmin) / sx, iy = (b - ymin) / sy;
    const ix1 = Math.round(ix), iy1 = Math.round(iy), ix2 = Math.floor(ix), iy2 = Math.floor(iy);
    // numpy rounds halves to even; Math.round rounds them up — on exact halves only
    const r1 = (v, r) => (Math.abs(v - Math.trunc(v)) === 0.5 ? 2 * Math.round(v / 2) : r);
    const jx1 = r1(ix, ix1), jy1 = r1(iy, iy1);
    const d1 = (ix - jx1) ** 2 + 3 * (iy - jy1) ** 2, d2 = (ix - ix2 - 0.5) ** 2 + 3 * (iy - iy2 - 0.5) ** 2;
    let k = -1;
    if (d1 < d2) { if (jx1 >= 0 && jx1 < nx1 && jy1 >= 0 && jy1 < ny1) k = jx1 * ny1 + jy1; }
    else if (ix2 >= 0 && ix2 < nx && iy2 >= 0 && iy2 < ny) k = n1 + ix2 * ny + iy2;
    if (k < 0) continue;
    count[k]++;
    if (sum) sum[k] += C[i];
    if (lists) lists[k].push(C[i]);
  }
  const accum = new Float64Array(n1 + n2);
  const mincnt = o.mincnt == null ? (C ? 1 : null) : +o.mincnt;
  for (let k = 0; k < n1 + n2; k++) {
    if (mincnt != null && count[k] < mincnt) { accum[k] = NaN; continue; }
    accum[k] = !C ? count[k] : lists ? reduce(lists[k]) : count[k] ? sum[k] / count[k] : NaN;
  }
  const cx = new Float64Array(n1 + n2), cy = new Float64Array(n1 + n2);
  for (let i = 0; i < nx1; i++) for (let j = 0; j < ny1; j++) { const k = i * ny1 + j; cx[k] = xmin + i * sx; cy[k] = ymin + j * sy; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const k = n1 + i * ny + j; cx[k] = xmin + (i + 0.5) * sx; cy[k] = ymin + (j + 0.5) * sy; }
  if (o.bins === 'log' && o.norm == null) o.norm = 'log';
  else if (o.bins != null && o.bins !== 'log') _warn('hexbin.bins', "hexbin(): bins='log' or None (a count or edges isn't supported yet; use norm=BoundaryNorm(...))", this._strict);
  if (o.xscale === 'log' || o.yscale === 'log') _warn('hexbin.xscale', 'hexbin(): log-scaled bins are not supported yet', this._strict);
  const tr = { type: 'hexbin', cx, cy, accum, sx, sy, ext: [xmin, xmax, ymin, ymax], counts: count, opts: o, cmapped: true };
  this._traces.push(tr);
  const out = _result(this, [], { _trace: tr, get_array: () => accum.filter((v) => v === v), get_offsets: () => Array.from(cx, (v, k) => [v, cy[k]]).filter((_, k) => accum[k] === accum[k]), __repr__: () => '<matplotlib.collections.PolyCollection>' });
  return out;
};

// the six corners of a hexagon of the lattice, in units of (sx, sy) — matplotlib's
const _HEX = [[0.5, -0.5 / 3], [0.5, 0.5 / 3], [0, 1 / 3], [-0.5, 0.5 / 3], [-0.5, -0.5 / 3], [0, -1 / 3]];

_KINDS.hexbin = {
  z: 0, cmap: true,
  crange(ax, t) {
    let lo = Infinity, hi = -Infinity, minPos = Infinity;
    for (const v of t.accum) if (v - v === 0) { if (v < lo) lo = v; if (v > hi) hi = v; if (v > 0 && v < minPos) minPos = v; }
    return { lo, hi, minPos: minPos === Infinity ? undefined : minPos };
  },
  // matplotlib autoscales a hexbin tight to its hexagons
  extent(ax, t, axis, log, take, stick) {
    const [x0, x1, y0, y1] = t.ext;
    const a = axis === 'x' ? x0 - t.sx / 2 : y0 - t.sy / 3, b = axis === 'x' ? x1 + t.sx / 2 : y1 + t.sy / 3;
    take(a); take(b); stick(a); stick(b);
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts, norm = ax._cmapNorm(t), at = _indexer(norm);
    const cm = o.cmap || ax._theme.ramp || 'viridis', lut = _cmapLut(cm), fn = lut ? null : getCmap(cm);
    const colorOf = (q) => (lut ? `rgb(${lut[q * 4]},${lut[q * 4 + 1]},${lut[q * 4 + 2]})` : fn((q + 0.5) / 256));
    // one path per colour: at most 256 fills, however many hexagons
    const buckets = new Map();
    const linear = !xScale.log && !yScale.log;
    const off = _HEX.map(([u, v]) => [u * t.sx * xScale.a, v * t.sy * yScale.a]);
    for (let k = 0; k < t.accum.length; k++) {
      const q = at(t.accum[k]);
      if (q < 0) continue;
      let list = buckets.get(q);
      if (!list) buckets.set(q, (list = []));
      list.push(k);
    }
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    const ec = o.edgecolors != null && o.edgecolors !== 'face' ? (o.edgecolors === 'none' ? null : _cssColor(o.edgecolors)) : 'face';
    for (const q of [...buckets.keys()].sort((a, b) => a - b)) {
      ctx.beginPath();
      for (const k of buckets.get(q)) {
        if (linear) {
          const X = xScale.transform(t.cx[k]), Y = yScale.transform(t.cy[k]);
          ctx.moveTo(X + off[0][0], Y + off[0][1]);
          for (let s = 1; s < 6; s++) ctx.lineTo(X + off[s][0], Y + off[s][1]);
        } else {
          for (let s = 0; s < 6; s++) {
            const X = xScale.transform(t.cx[k] + _HEX[s][0] * t.sx), Y = yScale.transform(t.cy[k] + _HEX[s][1] * t.sy);
            if (s) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
          }
        }
        ctx.closePath();
      }
      const c = colorOf(q);
      ctx.fillStyle = c; ctx.fill();
      // matplotlib's edgecolors='face': a hairline of the fill closes the seams
      if (ec === 'face') { ctx.strokeStyle = c; ctx.lineWidth = o.linewidths != null ? +o.linewidths : 0.5; ctx.stroke(); }
      else if (ec) { ctx.strokeStyle = ec; ctx.lineWidth = o.linewidths != null ? +o.linewidths : 0.5; ctx.stroke(); }
    }
    ctx.restore();
  },
  // the hexagon under the pointer: its centre, count and value
  pick(ax, t, px, py) {
    const v = ax.view, X = v.xScale.inverse(px), Y = v.yScale.inverse(py);
    let best = -1, bd = Infinity;
    const [x0, , y0] = t.ext, ix = (X - x0) / t.sx, iy = (Y - y0) / t.sy;
    for (let k = 0; k < t.accum.length; k++) {
      const dx = (t.cx[k] - x0) / t.sx - ix;
      if (Math.abs(dx) > 1) continue;
      const dy = (t.cy[k] - y0) / t.sy - iy, d = dx * dx + 3 * dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    if (best < 0 || bd > 1 || !(t.accum[best] === t.accum[best])) return null;
    return { kind: 'hexbin', index: best, x: t.cx[best], y: t.cy[best], value: t.accum[best], count: t.counts[best] };
  },
};

// ── hist2d ──
function _edges(data, bins, range, name) {
  if (_isArrayLike(bins)) { const e = Float64Array.from(bins, Number); if (e.length < 2) throw new Error(`hist2d: ${name} edges need at least 2 values`); return e; }
  let lo, hi;
  if (range) [lo, hi] = range.map(Number);
  else { lo = Infinity; hi = -Infinity; for (const v of data) if (v - v === 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(lo <= hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const nb = Math.max(1, Math.round(+bins || 10)), e = new Float64Array(nb + 1);
  for (let i = 0; i <= nb; i++) e[i] = lo + ((hi - lo) * i) / nb;
  return e;
}
const _binOf = (e, v) => {
  const n = e.length - 1;
  if (!(v >= e[0] && v <= e[n])) return -1;
  if (v === e[n]) return n - 1;                             // the last edge is inclusive (numpy)
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v >= e[m]) lo = m; else hi = m; }
  return lo;
};

Axes.prototype.hist2d = function (x, y, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  _checkOpts('hist2d', o, this._strict);
  const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
  if (Y.length !== n) throw _lenErr('hist2d', 'y', Y.length, 'x', n);
  const W = o.weights != null ? _col(o.weights) : null;
  if (W && W.length !== n) throw _lenErr('hist2d', 'weights', W.length, 'x', n);
  // bins: n · [nx, ny] · edges · [xedges, yedges] — numpy's rule: a length-2 sequence is one
  // per axis, anything else is for both
  const B = o.bins == null ? 10 : o.bins;
  const [bx, by] = _isArrayLike(B) && B.length === 2 ? [B[0], B[1]] : [B, B];
  const rx = o.range ? o.range[0] : null, ry = o.range ? o.range[1] : null;
  const ex = _edges(X, bx, rx, 'x'), ey = _edges(Y, by, ry, 'y');
  const nxb = ex.length - 1, nyb = ey.length - 1;
  const h = Array.from({ length: nxb }, () => new Float64Array(nyb));
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = _binOf(ex, X[i]), b = _binOf(ey, Y[i]);
    if (a < 0 || b < 0) continue;
    const w = W ? W[i] : 1;
    if (!(w - w === 0)) continue;
    h[a][b] += w; total += w;
  }
  if (o.density && total > 0) for (let a = 0; a < nxb; a++) for (let b = 0; b < nyb; b++) h[a][b] /= total * (ex[a + 1] - ex[a]) * (ey[b + 1] - ey[b]);
  // the image: h transposed (rows are y), cmin / cmax masked
  const C = new Float64Array(nxb * nyb);
  for (let b = 0; b < nyb; b++) for (let a = 0; a < nxb; a++) {
    const v = h[a][b];
    C[b * nxb + a] = (o.cmin != null && v < o.cmin) || (o.cmax != null && v > o.cmax) ? NaN : v;
  }
  const pm = {};
  for (const k of ['cmap', 'norm', 'vmin', 'vmax', 'alpha', 'label', 'zorder']) if (o[k] !== undefined) pm[k] = o[k];
  const C2 = Array.from({ length: nyb }, (_, b) => C.subarray(b * nxb, (b + 1) * nxb));
  const image = this.pcolormesh(ex, ey, C2, pm);
  return _result(this, [h, ex, ey, image], { h, xedges: ex, yedges: ey, image, _trace: image._trace });
};
