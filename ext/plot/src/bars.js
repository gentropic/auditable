// Bars and histograms: bar, barh, hist, bar_label.
//
// A bar trace keeps the columns as given (x + heights for bar, y + widths for barh) plus the
// base each bar stands on (bottom / left) and its thickness, and answers one question for the
// renderer, the autoscale and the picker alike: its rectangles in data coordinates.
//
// Histograms (numpy's counting, data.js / axes.js _hist) share one set of bins across every
// dataset passed, as matplotlib does; several datasets draw side by side, or stacked.

import { Axes, _KINDS, _plainOpts, _lenErr, _result } from './axes.js';
import { _col, _isArrayLike, _traceRange } from './data.js';
import { _cssColor } from './color.js';
import { _warn } from './opts.js';
import { _font } from './style.js';
import { dashArray } from './format.js';

const _num = (v, i) => (_isArrayLike(v) ? +v[i] : +v);
const _pick = (v, i) => (Array.isArray(v) ? v[i % v.length] : v);

// ── bar / barh ──
// bar(x, height, {width = 0.8, bottom = 0, align = 'center' | 'edge', color, edgecolor,
// linewidth, tick_label, label}) → a BarContainer: an array of the bars (each with
// get_x / get_y / get_width / get_height), .datavalues, .axes. Anything else read off it is
// the axes', so ax.bar(…).set_title(…) still chains.
function _bar(ax, orient, pos, size, opts) {
  const fn = orient === 'v' ? 'bar' : 'barh';
  const o = ax._opts(fn, opts);
  const P = ax._axisCol(orient === 'v' ? 'x' : 'y', pos), S = _col(size);
  if (P.length !== S.length) throw _lenErr(fn, orient === 'v' ? 'x' : 'y', P.length, orient === 'v' ? 'height' : 'width', S.length);
  const thickKey = orient === 'v' ? 'width' : 'height', baseKey = orient === 'v' ? 'bottom' : 'left';
  const thick = o[thickKey] == null ? 0.8 : _isArrayLike(o[thickKey]) ? _col(o[thickKey]) : +o[thickKey];
  const base = o[baseKey] == null ? null : _isArrayLike(o[baseKey]) ? _col(o[baseKey]) : +o[baseKey];
  if (o.align != null && o.align !== 'center' && o.align !== 'edge') _warn(`${fn}.align.${o.align}`, `${fn}(): align must be 'center' or 'edge', not '${o.align}'`, ax._strict);
  if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
  else if (!o.color) o.color = ax._nextColor();
  if (Array.isArray(o.edgecolor)) o.edgecolor = o.edgecolor.map(_cssColor);
  else if (o.edgecolor) o.edgecolor = _cssColor(o.edgecolor);
  const trace = orient === 'v' ? { type: 'bar', x: P, heights: S, opts: o } : { type: 'barh', y: P, widths: S, opts: o };
  trace.orient = orient; trace.thick = thick; trace.base = base;
  ax._traces.push(trace);
  // tick_label: labels at the bars' positions
  if (o.tick_label != null) {
    const labels = Array.isArray(o.tick_label) ? o.tick_label : Array.from(P, () => o.tick_label);
    ax[orient === 'v' ? 'set_xticks' : 'set_yticks'](Array.from(P), labels);
  }
  const rects = _barRects(trace);
  const patches = [];
  for (let i = 0; i < P.length; i++) {
    const r = { x: rects.x0[i], y: rects.y0[i], width: rects.x1[i] - rects.x0[i], height: rects.y1[i] - rects.y0[i] };
    patches.push({ ...r, get_x: () => r.x, get_y: () => r.y, get_width: () => r.width, get_height: () => r.height, get_xy: () => [r.x, r.y] });
  }
  return _result(ax, patches, { datavalues: S, orientation: orient === 'v' ? 'vertical' : 'horizontal', _trace: trace, patches,
    __repr__: () => `<BarContainer object of ${patches.length} artists>` });
}

// every bar's rectangle in data coordinates (x0 ≤ x1 not guaranteed: a negative height runs down)
function _barRects(t) {
  const c = t._cache || (t._cache = {});
  if (c.rects) return c.rects;
  const v = t.orient === 'v', P = v ? t.x : t.y, S = v ? t.heights : t.widths, n = P.length;
  const edge = t.opts.align === 'edge';
  const a0 = new Float64Array(n), a1 = new Float64Array(n), b0 = new Float64Array(n), b1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = _num(t.thick, i), base = t.base == null ? 0 : _num(t.base, i);
    a0[i] = edge ? P[i] : P[i] - w / 2; a1[i] = edge ? P[i] + w : P[i] + w / 2;
    b0[i] = base; b1[i] = base + S[i];
  }
  return (c.rects = v ? { x0: a0, x1: a1, y0: b0, y1: b1 } : { x0: b0, x1: b1, y0: a0, y1: a1 });
}

function _drawRects(ax, ctx, R, xScale, yScale, colorOf, opts, alpha) {
  ctx.globalAlpha = alpha;
  const lw = opts.linewidth;
  for (let i = 0; i < R.x0.length; i++) {
    const X0 = xScale.transform(R.x0[i]), X1 = xScale.transform(R.x1[i]);
    const Y0 = yScale.transform(yScale.log && !(R.y0[i] > 0) ? yScale.domain[0] : R.y0[i]);
    const Y1 = yScale.transform(R.y1[i]);
    if (X0 - X0 !== 0 || X1 - X1 !== 0 || Y0 - Y0 !== 0 || Y1 - Y1 !== 0) continue;
    const x = Math.min(X0, X1), y = Math.min(Y0, Y1), w = Math.abs(X1 - X0), h = Math.abs(Y1 - Y0);
    const fc = colorOf(i);
    if (fc && fc !== 'none') { ctx.fillStyle = fc; ctx.fillRect(x, y, w, h); }
    const ec = _pick(opts.edgecolor, i);
    if (ec && ec !== 'none') { ctx.strokeStyle = ec; ctx.lineWidth = lw == null ? 1 : _pick(lw, i); ctx.strokeRect(x, y, w, h); }
  }
  ctx.globalAlpha = 1;
}

// the bar (or bin) under a pixel: vertical bars by column, horizontal by row (the whole
// column / row, above or beside the bar too — the bar is the column's subject)
function _pickRects(ax, t, R, px, py, kind) {
  const v = ax.view, vert = t.orient !== 'h';
  for (let i = R.x0.length - 1; i >= 0; i--) {
    const a = vert ? v.xScale.transform(R.x0[i]) : v.yScale.transform(R.y0[i]);
    const b = vert ? v.xScale.transform(R.x1[i]) : v.yScale.transform(R.y1[i]);
    const p = vert ? px : py;
    if (p >= Math.min(a, b) && p <= Math.max(a, b)) return i;
  }
  void kind;
  return -1;
}

const _barKind = {
  z: 1, patch: true,
  extent(ax, t, axis, log, take, stick) {
    const R = _barRects(t);
    const along = t.orient === 'v' ? axis === 'x' : axis === 'y';
    const [A, B] = axis === 'x' ? [R.x0, R.x1] : [R.y0, R.y1];
    for (let i = 0; i < A.length; i++) { take(A[i]); take(B[i]); }
    if (!along && t.base == null && !log) stick(0);
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts;
    _drawRects(ax, ctx, _barRects(t), xScale, yScale, (i) => _pick(o.color, i), o, o.alpha != null ? o.alpha : 1);
  },
  pick(ax, t, px, py) {
    const i = _pickRects(ax, t, _barRects(t), px, py);
    if (i < 0) return null;
    return t.orient === 'v'
      ? { kind: 'bar', index: i, x: t.x[i], y: t.heights[i] }
      : { kind: 'bar', index: i, x: t.widths[i], y: t.y[i] };
  },
};
_KINDS.bar = _barKind;
_KINDS.barh = _barKind;

Axes.prototype.bar = function (x, height, opts) { return _bar(this, 'v', x, height, opts); };
Axes.prototype.barh = function (y, width, opts) { return _bar(this, 'h', y, width, opts); };

// ── bar_label(container, labels?, {fmt, padding, label_type, color, fontsize, rotation}) ──
// fmt: '%g' (default), any %-format, a '{:.1f}' format, or a function
export function _fmtValue(fmt, v) {
  if (typeof fmt === 'function') return String(fmt(v));
  if (fmt == null) fmt = '%g';
  const f = String(fmt);
  let m = /^(.*?)\{(?:[^:}]*):?(,?)(?:\.(\d+))?([fgedn%]?)\}(.*)$/.exec(f);
  if (m) return m[1] + _numFmt(v, m[4] || 'g', m[3] == null ? null : +m[3], !!m[2]) + m[5];
  m = /^(.*?)%[-+ 0#]*\d*(?:\.(\d+))?([dfgeis%])(.*)$/.exec(f);
  if (m) return m[1] + (m[3] === 's' ? String(v) : _numFmt(v, m[3] === 'i' ? 'd' : m[3], m[2] == null ? null : +m[2], false)) + m[4];
  return f;
}
function _numFmt(v, type, prec, comma) {
  if (!(v - v === 0)) return String(v);
  let s;
  if (type === 'd') s = Math.round(v).toString();
  else if (type === 'f') s = v.toFixed(prec ?? 6);
  else if (type === 'e') s = v.toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2');
  else if (type === '%') s = (v * 100).toFixed(prec ?? 6) + '%';
  else { s = String(+v.toPrecision(prec || 6)); }
  if (comma) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d != null ? '.' + d : ''); }
  return s;
}

Axes.prototype.bar_label = function (container, labels, opts) {
  if (_plainOpts(labels)) { opts = labels; labels = opts.labels; }
  const t = container && container._trace;
  if (!t || (t.type !== 'bar' && t.type !== 'barh')) throw new TypeError('plot: bar_label(container): give it what bar() or barh() returned');
  const o = _plainOpts(opts) ? { ...opts } : {};
  this._traces.push({ type: 'bar_label', of: t, labels: labels != null ? Array.from(labels) : null, opts: o });
  return _result(this, [], {});
};
_KINDS.bar_label = {
  z: 3, noclip: true,
  render(ax, ctx, tr, xScale, yScale) {
    const t = tr.of, o = tr.opts, R = _barRects(t), th = ax._theme;
    const S = t.orient === 'v' ? t.heights : t.widths;
    const pad = ((o.padding || 0) * ax._dpi) / 72 + 2;
    ctx.save();
    ctx.fillStyle = _cssColor(o.color) || ax._textColor || th.foreground;
    ctx.font = o.fontsize != null ? `${o.fontsize}px ${th.mono}` : _font(th, -1);
    for (let i = 0; i < S.length; i++) {
      if (!(S[i] - S[i] === 0)) continue;
      const s = tr.labels ? (tr.labels[i] == null ? '' : String(tr.labels[i])) : _fmtValue(o.fmt, S[i]);
      if (!s) continue;
      const cx = (xScale.transform(R.x0[i]) + xScale.transform(R.x1[i])) / 2, cy = (yScale.transform(R.y0[i]) + yScale.transform(R.y1[i])) / 2;
      let x = cx, y = cy;
      const center = o.label_type === 'center';
      if (t.orient === 'v') {
        ctx.textAlign = 'center';
        if (center) ctx.textBaseline = 'middle';
        else {
          const end = yScale.transform(R.y1[i]), up = yScale.transform(R.y1[i]) <= yScale.transform(R.y0[i]);
          y = up ? end - pad : end + pad; ctx.textBaseline = up ? 'bottom' : 'top';
        }
      } else {
        ctx.textBaseline = 'middle';
        if (center) ctx.textAlign = 'center';
        else {
          const end = xScale.transform(R.x1[i]), right = end >= xScale.transform(R.x0[i]);
          x = right ? end + pad : end - pad; ctx.textAlign = right ? 'left' : 'right';
        }
      }
      ctx.fillText(s, x, y);
    }
    ctx.restore();
  },
};

// ── hist ──
// numpy's bin rules for bins='auto' and its named estimators
function _binCount(rule, data, lo, hi) {
  const v = [];
  for (let i = 0; i < data.length; i++) { const x = data[i]; if (x >= lo && x <= hi) v.push(x); }
  const n = v.length;
  if (n < 2 || !(hi > lo)) return 1;
  const range = hi - lo;
  // every rule is a bin WIDTH, turned into a count as numpy does: ceil(range / width)
  const count = (w) => (w > 0 ? Math.max(1, Math.ceil(range / w)) : 1);
  const iqr = () => {
    v.sort((a, b) => a - b);
    const q = (p) => { const k = (n - 1) * p, f = Math.floor(k); return v[f] + (v[Math.min(n - 1, f + 1)] - v[f]) * (k - f); };
    return q(0.75) - q(0.25);
  };
  const sd = () => { let m = 0; for (const x of v) m += x; m /= n; let s = 0; for (const x of v) s += (x - m) * (x - m); return Math.sqrt(s / n); };
  const sturges = range / (Math.log2(n) + 1), sqrt = range / Math.sqrt(n);
  const fd = () => 2 * iqr() / Math.cbrt(n);
  switch (rule) {
    case 'sturges': return count(sturges);
    case 'sqrt': return count(sqrt);
    case 'rice': return count(range / (2 * Math.cbrt(n)));
    case 'scott': return count(Math.cbrt(24 * Math.sqrt(Math.PI) / n) * sd());
    case 'fd': return count(fd());
    // numpy ≥ 2: the narrower of Sturges and a relaxed Freedman–Diaconis (never under half
    // the sqrt rule's width, so a small IQR can't explode the bin count)
    case 'auto': return count(Math.min(Math.max(fd(), sqrt / 2), sturges));
    default: return null;
  }
}

// hist(x, {bins = 10 | 'auto' | … | edges, range, weights, density, cumulative, histtype =
// 'bar' | 'barstacked' | 'step' | 'stepfilled', orientation, bottom, log, stacked, rwidth,
// align, color, label, …}) → [n, bins, patches] (and the axes' methods, for chaining). x may be
// one array or a list of arrays: one set of bins for all, side by side or stacked.
Axes.prototype.hist = function (data, opts) {
  const o = this._opts('hist', opts);
  const multi = Array.isArray(data) && data.length > 0 && _isArrayLike(data[0]);
  const sets = multi ? data.map((d) => _col(d)) : [_col(data)];
  const W = o.weights == null ? null : multi ? o.weights.map((w) => (w == null ? null : _col(w))) : [_col(o.weights)];
  if (W) W.forEach((w, k) => { if (w && w.length !== sets[k].length) throw _lenErr('hist', 'weights', w.length, 'x', sets[k].length); });
  const histtype = o.histtype || 'bar';
  if (!['bar', 'barstacked', 'step', 'stepfilled'].includes(histtype)) _warn(`hist.histtype.${histtype}`, `hist(): histtype must be 'bar', 'barstacked', 'step' or 'stepfilled', not '${histtype}'`, this._strict);
  const stacked = !!o.stacked || histtype === 'barstacked';
  const horiz = o.orientation === 'horizontal';
  // one set of bins for every dataset
  let lo, hi, bins = o.bins == null ? 10 : o.bins;
  if (_isArrayLike(bins) && typeof bins !== 'string') bins = _col(bins);
  else {
    if (o.range) { lo = +o.range[0]; hi = +o.range[1]; }
    else {
      lo = Infinity; hi = -Infinity;
      sets.forEach((d) => { const r = _traceRange({ _cache: {} }, 'd', d); if (r.n) { lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi); } });
      if (!(lo <= hi)) { lo = 0; hi = 1; }
    }
    if (typeof bins === 'string') {
      let all = sets[0];
      if (sets.length > 1) { all = new Float64Array(sets.reduce((s, d) => s + d.length, 0)); let at = 0; for (const d of sets) { all.set(d, at); at += d.length; } }
      const nb = _binCount(bins, all, lo, hi);
      if (nb == null) { _warn('hist.bins.' + bins, `hist(): bins='${bins}' is not a rule plot knows (auto, fd, sturges, sqrt, rice, scott); using 10`, this._strict); bins = 10; }
      else bins = nb;
    }
  }
  if (o.log) this[horiz ? '_xscale' : '_yscale'] = 'log';
  const colors = Array.isArray(o.color) ? o.color.map(_cssColor) : null;
  const labels = Array.isArray(o.label) ? o.label : null;
  const traces = [];
  sets.forEach((D, k) => {
    const to = { ...o, bins, histtype, weights: W ? W[k] : undefined };
    if (lo != null) to.range = [lo, hi];
    to.color = colors ? colors[k % colors.length] : k === 0 && o.color && !colors ? o.color : this._nextColor();
    to.label = labels ? labels[k] : k === 0 ? o.label : undefined;
    delete to.stacked;
    const t = { type: 'hist', data: D, opts: to, slot: { k, n: sets.length, stacked, horiz }, below: stacked && k > 0 ? traces[k - 1] : null };
    traces.push(t);
    this._traces.push(t);
  });
  const res = traces.map((t) => _histBars(this, t));
  const n = multi ? res.map((r) => Float64Array.from(r.counts)) : Float64Array.from(res[0].counts);
  const edges = Float64Array.from(res[0].edges);
  const nBars = (edges.length - 1) * traces.length;
  const patches = _result(this, [], { _traces: traces, __repr__: () => `<BarContainer object of ${nBars} artists>` });
  const arr = (a) => `array([${Array.from(a, (v) => (Number.isInteger(v) ? v + '.' : String(v))).join(', ')}])`;
  // matplotlib returns the tuple (n, bins, patches); at the end of a cell it prints as one
  const __repr__ = () => `(${multi ? '[' + n.map(arr).join(', ') + ']' : arr(n)}, ${arr(edges)}, ${patches.__repr__()})`;
  return _result(this, [n, edges, patches], { n, bins: edges, patches, counts: n, edges, __repr__ });
};

// a histogram trace's bars: its bins, counts and the base each stands on (stacked on the
// dataset below, or on bottom)
function _histBars(ax, t) {
  const c = t._cache || (t._cache = {});
  if (c.bars) return c.bars;
  const { edges, counts } = ax._hist(t);
  const nb = counts.length, base = new Float64Array(nb);
  if (t.below) { const b = _histBars(ax, t.below); for (let i = 0; i < nb; i++) base[i] = b.base[i] + b.counts[i]; }
  else if (t.opts.bottom != null) for (let i = 0; i < nb; i++) base[i] = _num(t.opts.bottom, i);
  return (c.bars = { edges, counts, base });
}

// the rectangles a 'bar' histogram draws: side by side for several unstacked datasets
function _histRects(ax, t) {
  const c = t._cache || (t._cache = {});
  if (c.hrects) return c.hrects;
  const { edges, counts, base } = _histBars(ax, t);
  const { k, n, stacked, horiz } = t.slot;
  const nb = counts.length;
  const total = t.opts.rwidth != null ? +t.opts.rwidth : (n > 1 && !stacked ? 0.8 : 1);
  const each = stacked ? total : total / n;
  const off = stacked ? (1 - total) / 2 : (1 - total) / 2 + k * each;
  const shift = t.opts.align === 'left' ? -0.5 : t.opts.align === 'right' ? 0.5 : 0;
  const a0 = new Float64Array(nb), a1 = new Float64Array(nb), b0 = new Float64Array(nb), b1 = new Float64Array(nb);
  for (let i = 0; i < nb; i++) {
    const w = edges[i + 1] - edges[i], e = edges[i] + shift * w;
    a0[i] = e + off * w; a1[i] = e + (off + each) * w;
    b0[i] = base[i]; b1[i] = base[i] + counts[i];
  }
  return (c.hrects = horiz ? { x0: b0, x1: b1, y0: a0, y1: a1 } : { x0: a0, x1: a1, y0: b0, y1: b1 });
}

_KINDS.hist = {
  z: 1, patch: true,
  extent(ax, t, axis, log, take, stick) {
    const { edges, counts, base } = _histBars(ax, t);
    const horiz = t.slot.horiz;
    const binsAxis = horiz ? axis === 'y' : axis === 'x';
    if (binsAxis) {
      const sh = t.opts.align === 'left' ? -0.5 : t.opts.align === 'right' ? 0.5 : 0;
      take(edges[0] + sh * (edges[1] - edges[0])); take(edges[edges.length - 1] + sh * (edges[edges.length - 1] - edges[edges.length - 2] || 0));
    } else {
      for (let i = 0; i < counts.length; i++) { take(base[i] + counts[i]); if (!log) take(base[i]); }
      if (!log && !t.below && t.opts.bottom == null) stick(0);
    }
  },
  render(ax, ctx, t, xScale, yScale) {
    const o = t.opts, ht = o.histtype;
    if (ht === 'bar' || ht === 'barstacked' || !ht) {
      _drawRects(ax, ctx, _histRects(ax, t), xScale, yScale, () => o.color, o, o.alpha != null ? o.alpha : 1);
      return;
    }
    // step / stepfilled: the outline of the bins, from the base along the tops and back
    const { edges, counts, base } = _histBars(ax, t), horiz = t.slot.horiz, nb = counts.length;
    const P = (along, value) => (horiz ? [xScale.transform(value), yScale.transform(along)] : [xScale.transform(along), yScale.transform(value)]);
    const floor = (v) => ((horiz ? xScale : yScale).log && !(v > 0) ? (horiz ? xScale : yScale).domain[0] : v);
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.beginPath();
    let [x, y] = P(edges[0], floor(base[0]));
    ctx.moveTo(x, y);
    for (let i = 0; i < nb; i++) {
      [x, y] = P(edges[i], base[i] + counts[i]); ctx.lineTo(x, y);
      [x, y] = P(edges[i + 1], base[i] + counts[i]); ctx.lineTo(x, y);
    }
    [x, y] = P(edges[nb], floor(base[nb - 1])); ctx.lineTo(x, y);
    if (ht === 'stepfilled') {
      for (let i = nb - 1; i >= 0; i--) { [x, y] = P(edges[i + 1], floor(base[i])); ctx.lineTo(x, y); [x, y] = P(edges[i], floor(base[i])); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = o.color; ctx.fill();
      if (o.edgecolor) { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.stroke(); }
    } else {
      ctx.strokeStyle = o.edgecolor ? _cssColor(o.edgecolor) : o.color;
      ctx.lineWidth = o.linewidth || 1.5;
      ctx.setLineDash(dashArray(o.linestyle));
      ctx.stroke();
    }
    ctx.restore();
  },
  pick(ax, t, px, py) {
    const R = _histRects(ax, t), i = _pickRects(ax, { orient: t.slot.horiz ? 'h' : 'v' }, R, px, py);
    if (i < 0) return null;
    const { edges, counts } = _histBars(ax, t);
    return { kind: 'bin', index: i, x: (edges[i] + edges[i + 1]) / 2, y: counts[i], edges: [edges[i], edges[i + 1]] };
  },
  legend(ax, t) { return { patch: t.opts.histtype !== 'step', color: t.opts.color }; },
};
