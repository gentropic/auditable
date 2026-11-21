// boxplot — matplotlib's, statistic for statistic.
//
// The statistics are matplotlib's cbook.boxplot_stats: quartiles by linear interpolation
// (numpy's default percentile method), whiskers at the furthest datum within whis × IQR of the
// box (Tukey; whis = [p_lo, p_hi] gives percentiles instead), fliers beyond them, NaN left out.
// boxplot returns them, so a caller can print the medians it drew: { medians, boxes, whiskers,
// caps, fliers, means, stats } — each artist list with matplotlib's get_ydata / get_xdata.

import { Axes, _KINDS, _plainOpts, _result } from './axes.js';
import { _col, _isArrayLike } from './data.js';
import { _cssColor } from './color.js';
import { _MARKERS, _markerShape, _pathMarker } from './raster.js';
import { _warn } from './opts.js';

// the linear-interpolation percentile of sorted values (numpy's default)
function _pct(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const k = (n - 1) * p, f = Math.floor(k), c = Math.min(n - 1, f + 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

export function _boxStats(data, whis = 1.5, label = null) {
  const v = [];
  for (let i = 0; i < data.length; i++) { const x = +data[i]; if (x - x === 0) v.push(x); }
  v.sort((a, b) => a - b);
  const n = v.length;
  if (!n) return { mean: NaN, med: NaN, q1: NaN, q3: NaN, iqr: NaN, whislo: NaN, whishi: NaN, cilo: NaN, cihi: NaN, fliers: [], label, n: 0 };
  let mean = 0;
  for (const x of v) mean += x;
  mean /= n;
  const q1 = _pct(v, 0.25), med = _pct(v, 0.5), q3 = _pct(v, 0.75), iqr = q3 - q1;
  let lo, hi;
  if (Array.isArray(whis)) { lo = _pct(v, whis[0] / 100); hi = _pct(v, whis[1] / 100); }
  else if (whis === 'range') { lo = v[0]; hi = v[n - 1]; }
  else { lo = q1 - whis * iqr; hi = q3 + whis * iqr; }
  // the whiskers end at data: the lowest value ≥ lo, the highest ≤ hi (matplotlib clips them
  // to the box when nothing qualifies)
  let whislo = q1, whishi = q3;
  for (const x of v) if (x >= lo) { whislo = Math.min(x, q1); break; }
  for (let i = n - 1; i >= 0; i--) if (v[i] <= hi) { whishi = Math.max(v[i], q3); break; }
  const fliers = v.filter((x) => x < whislo || x > whishi);
  const ci = 1.57 * iqr / Math.sqrt(n);
  return { mean, med, q1, q3, iqr, whislo, whishi, cilo: med - ci, cihi: med + ci, fliers, label, n };
}

// x: one array, a list of arrays, or a mapping { label: array }
export function _datasets(x) {
  if (x && typeof x === 'object' && !_isArrayLike(x) && !Array.isArray(x)) {
    if (typeof x.to_numpy === 'function' && x.columns) {        // a DataFrame: one box per column
      const cols = Array.from(x.columns);
      return { sets: cols.map((c) => _col(x.get ? x.get(c) : x[c])), labels: cols.map(String) };
    }
    const keys = Object.keys(x).filter((k) => k !== '_kw');
    return { sets: keys.map((k) => _col(x[k])), labels: keys };
  }
  if (Array.isArray(x) && x.length && _isArrayLike(x[0])) return { sets: x.map((d) => _col(d)), labels: null };
  return { sets: [_col(x)], labels: null };
}

const _lineObj = (xs, ys) => ({ get_xdata: () => xs.slice(), get_ydata: () => ys.slice(), xdata: xs, ydata: ys });

Axes.prototype.boxplot = function (x, opts) {
  const o = _plainOpts(opts) ? { ...opts } : {};
  const known = ['whis', 'labels', 'tick_labels', 'vert', 'orientation', 'showfliers', 'showmeans', 'meanline', 'widths', 'positions', 'patch_artist', 'boxprops', 'medianprops', 'whiskerprops', 'capprops', 'flierprops', 'meanprops', 'manage_ticks', 'showcaps', 'showbox', 'zorder', 'notch', 'sym', 'bootstrap', 'usermedians', 'conf_intervals', 'autorange', 'capwidths', '_kw'];
  for (const k of Object.keys(o)) if (!known.includes(k)) _warn('boxplot.' + k, `boxplot() has no option '${k}'`, this._strict);
  for (const k of ['notch', 'bootstrap', 'usermedians', 'conf_intervals']) if (o[k]) _warn('boxplot.' + k, `boxplot(): '${k}' is not supported yet`, this._strict);
  const { sets, labels: keyLabels } = _datasets(x);
  const n = sets.length;
  const labels = o.tick_labels || o.labels || keyLabels;
  const horiz = o.vert === false || o.orientation === 'horizontal';
  const positions = o.positions ? Array.from(o.positions, Number) : sets.map((_, i) => i + 1);
  const span = positions.length > 1 ? Math.max(...positions) - Math.min(...positions) : 1;
  const wdef = Math.min(0.5, Math.max(0.15, 0.15 * span));
  const widths = o.widths == null ? positions.map(() => wdef) : _isArrayLike(o.widths) ? Array.from(o.widths, Number) : positions.map(() => +o.widths);
  const whis = o.whis == null ? 1.5 : o.whis;
  const stats = sets.map((d, i) => _boxStats(d, whis, labels ? String(labels[i]) : null));
  const trace = {
    type: 'boxplot', stats, positions, widths, horiz,
    showfliers: o.showfliers !== false, showmeans: !!o.showmeans, meanline: !!o.meanline,
    showcaps: o.showcaps !== false, showbox: o.showbox !== false, patch: !!o.patch_artist,
    props: { box: o.boxprops || {}, median: o.medianprops || {}, whisker: o.whiskerprops || {}, cap: o.capprops || {}, flier: o.flierprops || {}, mean: o.meanprops || {} },
    colors: { box: null, fill: this._theme.cycle[0], median: this._theme.cycle[1], mean: this._theme.cycle[2] },
    opts: { zorder: o.zorder, label: undefined },
  };
  this._traces.push(trace);
  // ticks at the positions, labelled (matplotlib's manage_ticks)
  if (o.manage_ticks !== false) this[horiz ? 'set_yticks' : 'set_xticks'](positions, labels ? labels.map(String) : positions.map((p) => String(p)));
  // matplotlib's artists, as data
  const P = (a, b) => (horiz ? [b, a] : [a, b]);
  const medians = [], boxes = [], whiskers = [], caps = [], fliers = [], means = [];
  stats.forEach((s, i) => {
    const p = positions[i], w = widths[i];
    const m = P([p - w / 2, p + w / 2], [s.med, s.med]); medians.push(_lineObj(m[0], m[1]));
    const b = P([p - w / 2, p + w / 2, p + w / 2, p - w / 2, p - w / 2], [s.q1, s.q1, s.q3, s.q3, s.q1]); boxes.push(_lineObj(b[0], b[1]));
    const w1 = P([p, p], [s.q1, s.whislo]), w2 = P([p, p], [s.q3, s.whishi]); whiskers.push(_lineObj(w1[0], w1[1]), _lineObj(w2[0], w2[1]));
    const c1 = P([p - w / 4, p + w / 4], [s.whislo, s.whislo]), c2 = P([p - w / 4, p + w / 4], [s.whishi, s.whishi]); caps.push(_lineObj(c1[0], c1[1]), _lineObj(c2[0], c2[1]));
    const f = P(s.fliers.map(() => p), s.fliers); fliers.push(_lineObj(f[0], f[1]));
    const mn = P([p], [s.mean]); means.push(_lineObj(mn[0], mn[1]));
  });
  const out = { medians, boxes, whiskers, caps, fliers, means, stats };
  return _result(this, [], out);
};

_KINDS.boxplot = {
  z: 2, patch: true,
  extent(ax, t, axis, log, take) {
    const along = t.horiz ? axis === 'y' : axis === 'x';
    t.stats.forEach((s, i) => {
      if (along) { take(t.positions[i] - t.widths[i] / 2); take(t.positions[i] + t.widths[i] / 2); }
      else { take(s.whislo); take(s.whishi); if (t.showfliers) for (const f of s.fliers) take(f); if (t.showmeans) take(s.mean); }
    });
  },
  render(ax, ctx, t, xScale, yScale) {
    const th = ax._theme, fg = ax._textColor || th.foreground;
    const pr = t.props;
    const col = (p, dflt) => _cssColor(p.color) || dflt;
    const lw = (p, d = 1) => (p.linewidth ?? p.lw ?? d);
    const P = (a, v) => (t.horiz ? [xScale.transform(v), yScale.transform(a)] : [xScale.transform(a), yScale.transform(v)]);
    const seg = (a0, v0, a1, v1) => { const p = P(a0, v0), q = P(a1, v1); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
    ctx.save();
    t.stats.forEach((s, i) => {
      if (!s.n) return;
      const p = t.positions[i], w = t.widths[i];
      // the box: filled with patch_artist (matplotlib: C0), else an outline
      if (t.showbox) {
        const a = P(p - w / 2, s.q1), b = P(p + w / 2, s.q3);
        const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), W = Math.abs(b[0] - a[0]), H = Math.abs(b[1] - a[1]);
        if (t.patch) { ctx.fillStyle = _cssColor(pr.box.facecolor) || t.colors.fill; ctx.fillRect(x, y, W, H); }
        ctx.strokeStyle = col(pr.box, _cssColor(pr.box.edgecolor) || fg); ctx.lineWidth = lw(pr.box);
        ctx.strokeRect(x, y, W, H);
      }
      // whiskers and caps
      ctx.strokeStyle = col(pr.whisker, fg); ctx.lineWidth = lw(pr.whisker);
      ctx.beginPath(); seg(p, s.q1, p, s.whislo); seg(p, s.q3, p, s.whishi); ctx.stroke();
      if (t.showcaps) {
        ctx.strokeStyle = col(pr.cap, fg); ctx.lineWidth = lw(pr.cap);
        ctx.beginPath(); seg(p - w / 4, s.whislo, p + w / 4, s.whislo); seg(p - w / 4, s.whishi, p + w / 4, s.whishi); ctx.stroke();
      }
      // the median (matplotlib: C1, the orange line)
      ctx.strokeStyle = col(pr.median, t.colors.median); ctx.lineWidth = lw(pr.median, 1.5);
      ctx.beginPath(); seg(p - w / 2, s.med, p + w / 2, s.med); ctx.stroke();
      // fliers: open circles
      if (t.showfliers && s.fliers.length) {
        const m = pr.flier.marker && _MARKERS.includes(pr.flier.marker) ? pr.flier.marker : 'o';
        const r = ((pr.flier.markersize ?? 6) * ax._dpi) / 144;
        ctx.strokeStyle = _cssColor(pr.flier.markeredgecolor) || fg; ctx.lineWidth = 1;
        const fc = _cssColor(pr.flier.markerfacecolor);
        for (const f of s.fliers) {
          const q = P(p, f);
          ctx.beginPath(); _pathMarker(ctx, _markerShape(m, r), q[0], q[1]);
          if (fc && fc !== 'none') { ctx.fillStyle = fc; ctx.fill(); }
          ctx.stroke();
        }
      }
      // the mean: a triangle (matplotlib: C2), or a dashed line with meanline
      if (t.showmeans) {
        const mc = _cssColor(pr.mean.markerfacecolor || pr.mean.color) || t.colors.mean;
        if (t.meanline) { ctx.strokeStyle = mc; ctx.setLineDash([4, 3]); ctx.beginPath(); seg(p - w / 2, s.mean, p + w / 2, s.mean); ctx.stroke(); ctx.setLineDash([]); }
        else { const q = P(p, s.mean); ctx.fillStyle = mc; ctx.beginPath(); _pathMarker(ctx, _markerShape(pr.mean.marker || '^', ((pr.mean.markersize ?? 6) * ax._dpi) / 144), q[0], q[1]); ctx.fill(); }
      }
    });
    ctx.restore();
  },
  pick(ax, t, px, py) {
    const v = ax.view;
    for (let i = 0; i < t.positions.length; i++) {
      const p = t.positions[i], w = t.widths[i];
      const a = t.horiz ? v.yScale.transform(p - w / 2) : v.xScale.transform(p - w / 2), b = t.horiz ? v.yScale.transform(p + w / 2) : v.xScale.transform(p + w / 2);
      const q = t.horiz ? py : px;
      if (q >= Math.min(a, b) && q <= Math.max(a, b)) { const s = t.stats[i]; return { kind: 'box', index: i, x: t.horiz ? s.med : p, y: t.horiz ? p : s.med, value: s.med, stats: s }; }
    }
    return null;
  },
};
