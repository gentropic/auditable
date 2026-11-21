// Axes — trace storage, layout computation, canvas rendering, picking.
//
// HOW A RENDER IS FAST. Columns arrive through _col (data.js) and are never copied again.
// Each trace caches what it derives — its finite ranges, histogram counts, colour indices, an
// image's RGBA, a scatter's raster, its pixel positions — on itself, keyed by whatever the
// result depends on (the view, vmin/vmax, …), so drawing the same view twice only re-blits.
// Hot loops never call scale.transform(): they use the scale's fold (px = a·v + b) inline.
//
// HOW BIG FIGURES DRAW. Scatters up to _engine.rasterMin points draw as canvas paths (batched into
// a few fill calls when nothing overlaps visibly differently: alpha 1, no edge). Past that
// they rasterize: one antialiased stamp per point, composited in data order into one image
// (raster.js), which is one blit live and one 'image' op in a draw list. Lines longer than 4
// points per device pixel are decimated min/max per pixel column (M4: identical pixels).
// Images always go through one RGBA buffer, never one fillRect per cell.
//
// NOTHING NON-FINITE POISONS ANYTHING. NaN and ±Inf never reach a range; a line breaks at a
// NaN (matplotlib's rule); a NaN colour value draws nothing; NaN cells are transparent; a log
// axis ignores values ≤ 0.

import { LinearScale, LogScale } from './scale.js';
import { getCmap, renderColorbar, _cmapLut, _colorBytes, _cssColor } from './color.js';
import { parseFormat, dashArray, _noLine } from './format.js';
import { _style, _snapshotStyle, _font, _textW } from './style.js';
import { _Categories, _isCategorical, _tickSpec, _drawTicks } from './ticks.js';
import { isRecordingContext } from './record.js';
import { _col, _isArrayLike, _isNumericCol, _traceRange, _isMonotonic, _arange, _fmtCount } from './data.js';
import { _checkOpts, _resolveAliases, _warn, _noop } from './opts.js';
import { _MARKERS, _markerShape, _pathMarker, _rasterPoints, _blit } from './raster.js';
import { _buildGrid, _queryGrid } from './pick.js';

// The fast-path thresholds (measured: bench/BENCH.md). Scatters with more than rasterMin points
// rasterize; lines with more than 4 vertices per device pixel decimate. Tests turn them off
// to compare the fast paths against the plain ones.
export const _engine = { rasterMin: 4000, m4: true, batch: true };
const _M4_SUB = 4;          // M4 columns per device pixel (see _pathM4)

// Trace kinds beyond the core ones register here (marks.js, box.js, contour.js, …), so each
// lives in its own module: { extent(ax, trace, axis, log, take, stick), render(ax, ctx, trace,
// xScale, yScale, rect), z (the default zorder), cmap (it colour-maps: a colorbar follows it),
// legend(ax, trace) → a legend entry }. take(v) widens the range; stick(v) is a sticky edge
// that the margins stop at (matplotlib's sticky_edges: bars at 0, images at their extent).
export const _KINDS = {};

// matplotlib's default zorders: images 0, patches and collections 1, lines 2, text 3. Traces
// draw in zorder, ties in the order they were added.
const _ZORDER = { imshow: 0, bar: 1, barh: 1, hist: 1, scatter: 1, line: 2, hline: 2, vline: 2, text: 3 };

function _plainOpts(o) {
  // an options object, as opposed to a column or a format string
  return o != null && typeof o === 'object' && !_isArrayLike(o);
}

function _lenErr(fn, a, na, b, nb) {
  return new Error(`plot: ${fn}: ${a} has ${_fmtCount(na)} values but ${b} has ${_fmtCount(nb)}`);
}

// fold a column through a scale into pixel positions (NaN for anything not drawable)
function _project(arr, s, out) {
  const a = s.a, b = s.b, n = arr.length;
  if (s.log) {
    for (let i = 0; i < n; i++) { const v = arr[i]; out[i] = v > 0 && v !== Infinity ? a * Math.log10(v) + b : NaN; }
  } else {
    for (let i = 0; i < n; i++) { const v = arr[i]; out[i] = v - v === 0 ? a * v + b : NaN; }
  }
  return out;
}

// matplotlib's named font sizes, as px relative to the theme's base size
const _FONTSIZES = { 'xx-small': -4, 'x-small': -3, small: -2, medium: 0, large: 2, 'x-large': 4, 'xx-large': 6 };

export class Axes {
  constructor(theme) {
    this._theme = theme || _snapshotStyle();
    this._traces = [];
    this._title = null;
    this._xlabel = null;
    this._ylabel = null;
    this._xlim = null;
    this._ylim = null;
    this._grid = false;
    this._gridOpts = {};
    this._legend = false;
    this._legendOpts = {};
    this._colorbar = false;
    this._colorbarOpts = {};
    this._aspect = 'auto';
    this._colorIdx = 0;
    this._strict = false;
    this._dpi = 100;             // the figure's, for sizes given in points (markers)
    this._xticks = null;         // set_xticks: { values, labels, rotation }
    this._yticks = null;
    this._xcats = null;          // a category axis (strings as x): _Categories
    this._ycats = null;
    this._xinv = false;          // invert_xaxis()
    this._yinv = false;
    this._xmargin = 0.05;        // ax.margins(): the share of the data range added each side
    this._ymargin = 0.05;
    this._axisOn = true;         // axis('off') hides the frame, ticks and axis labels
    this._shared = { x: null, y: null };   // subplots(sharex / sharey): every axes sharing that axis
    this.view = null;            // set by a render: { x, y, w, h, xScale, yScale }
  }

  _nextColor() {
    const cyc = this._theme.cycle || _style.cycle;
    return cyc[this._colorIdx++ % cyc.length];
  }

  // copy, check and alias-resolve an options object for function `fn`
  _opts(fn, opts, keepC) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    _checkOpts(fn, o, this._strict);
    if (keepC) { const c = o.c; delete o.c; _resolveAliases(o); if (c !== undefined) o.c = c; }
    else _resolveAliases(o);
    if (o.color != null) o.color = _cssColor(o.color);
    return o;
  }

  _checkMarker(fn, m) {
    if (m == null || _MARKERS.includes(m)) return m;
    _warn(`${fn}.marker.${m}`, `${fn}(): marker '${m}' is not supported; use one of ${_MARKERS.join(' ')}`, this._strict);
    return 'o';
  }

  // plot(y) · plot(y, fmt) · plot(x, y) · plot(x, y, fmt) · plot(x, y, fmt, opts) · plot(x, y, opts)
  plot(x, y, fmtOrOpts, opts) {
    if (!_isArrayLike(y)) {                        // plot(y …): x is 0 … n-1
      opts = fmtOrOpts; fmtOrOpts = y; y = x; x = undefined;
    }
    let fmt = null;
    if (typeof fmtOrOpts === 'string') fmt = fmtOrOpts;
    else if (_plainOpts(fmtOrOpts)) opts = fmtOrOpts;
    const o = this._opts('plot', opts);
    if (o.fmt) { fmt = o.fmt; delete o.fmt; }
    if (fmt) { const f = parseFormat(fmt); for (const k in f) if (o[k] === undefined) o[k] = k === 'color' ? _cssColor(f[k]) : f[k]; }
    if (!o.color) o.color = this._nextColor();
    o.marker = this._checkMarker('plot', o.marker);
    const Y = this._axisCol('y', y);
    const X = x === undefined ? _arange(Y.length) : this._axisCol('x', x);
    if (X.length !== Y.length) throw _lenErr('plot', 'x', X.length, 'y', Y.length);
    this._traces.push({ type: 'line', x: X, y: Y, opts: o });
    return this;
  }

  // scatter(x, y, opts) · scatter(x, y, s, c, opts) — matplotlib's positional s and c too
  scatter(x, y, sOrOpts, c, opts) {
    let o;
    if (_plainOpts(sOrOpts)) o = this._opts('scatter', sOrOpts, true);
    else {
      o = this._opts('scatter', opts, true);
      if (sOrOpts != null) o.s = sOrOpts;
      if (c != null) o.c = c;
    }
    const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
    if (Y.length !== n) throw _lenErr('scatter', 'x', n, 'y', Y.length);
    const trace = { type: 'scatter', x: X, y: Y, opts: o, cvals: null, colors: null, s: null };
    // c: a colour, numbers to colour-map, or one colour per point
    let cc = o.c;
    if (cc === undefined && o.color != null && _isArrayLike(o.color)) { cc = o.color; delete o.color; }
    // an RGB(A) tuple: 3 or 4 numbers in [0, 1], when there aren't that many points
    const tuple = (Array.isArray(cc) || ArrayBuffer.isView(cc)) && (cc.length === 3 || cc.length === 4) && n !== cc.length
      && Array.prototype.every.call(cc, (v) => typeof v === 'number' && v >= 0 && v <= 1);
    if (cc != null && typeof cc !== 'string' && !tuple) {
      const col = _col(cc);
      if (col.length !== n) throw _lenErr('scatter', 'c', col.length, 'x', n);
      if (_isNumericCol(col)) trace.cvals = col;
      else trace.colors = col.map(_cssColor);
      delete o.c;
    } else if (cc != null) {
      o.color = _cssColor(cc);
      delete o.c;
    }
    if (!o.color && !trace.cvals && !trace.colors) o.color = this._nextColor();
    if (o.s != null && typeof o.s !== 'number') {
      const s = _col(o.s);
      if (s.length !== n) throw _lenErr('scatter', 's', s.length, 'x', n);
      trace.s = s;
    }
    o.marker = this._checkMarker('scatter', o.marker);
    this._traces.push(trace);
    return this;
  }

  bar(x, heights, opts) {
    const o = this._opts('bar', opts);
    if (!o.color) o.color = this._nextColor();
    const X = this._axisCol('x', x), H = _col(heights);
    if (X.length !== H.length) throw _lenErr('bar', 'x', X.length, 'height', H.length);
    if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
    this._traces.push({ type: 'bar', x: X, heights: H, opts: o });
    return this;
  }

  barh(y, widths, opts) {
    const o = this._opts('barh', opts);
    if (!o.color) o.color = this._nextColor();
    const Yc = this._axisCol('y', y), W = _col(widths);
    if (Yc.length !== W.length) throw _lenErr('barh', 'y', Yc.length, 'width', W.length);
    if (Array.isArray(o.color)) o.color = o.color.map(_cssColor);
    this._traces.push({ type: 'barh', y: Yc, widths: W, opts: o });
    return this;
  }

  hist(data, opts) {
    const o = this._opts('hist', opts);
    if (!o.color) o.color = this._nextColor();
    // several datasets (a list of arrays) aren't drawn side by side yet: say so, draw the first
    if (Array.isArray(data) && data.length && _isArrayLike(data[0])) {
      _warn('hist.multi', 'hist(): several datasets are not supported yet; drawing the first', this._strict);
      data = data[0];
    }
    const D = _col(data);
    if (o.bins != null && typeof o.bins !== 'number') {
      if (typeof o.bins === 'string') {
        _warn('hist.bins.' + o.bins, `hist(): bins='${o.bins}' is not supported yet; using 10 bins`, this._strict);
        o.bins = 10;
      } else o.bins = _col(o.bins);
    }
    if (o.weights != null) {
      o.weights = _col(o.weights);
      if (o.weights.length !== D.length) throw _lenErr('hist', 'weights', o.weights.length, 'x', D.length);
    }
    this._traces.push({ type: 'hist', data: D, opts: o });
    return this;
  }

  // matshow — render a 2D matrix as a heatmap. Accepts diverse inputs:
  // a sadpan DataFrame (uses .to_numpy()), a natra ndarray, a
  // Float64Array with .shape, a nested JS array, or already-flat data
  // with shape. Extracts flat data + nx + ny + passes through to imshow.
  matshow(data, opts) {
    const o = _plainOpts(opts) ? { ...opts } : {};
    let flat, nx, ny;
    // sadpan DataFrame
    if (data && data._tbl && typeof data.to_numpy === 'function') {
      const arr2d = data.to_numpy();
      ny = arr2d.shape[0];
      nx = arr2d.shape[1];
      flat = arr2d.data instanceof Float64Array ? arr2d.data : Float64Array.from([].concat(...arr2d.tolist()));
    } else if (data instanceof Float64Array && Array.isArray(data.shape) && data.shape.length === 2) {
      ny = data.shape[0]; nx = data.shape[1]; flat = data;
    } else if (data && data.data instanceof Float64Array && Array.isArray(data.shape) && data.shape.length === 2) {
      ny = data.shape[0]; nx = data.shape[1]; flat = data.data;
    } else if (data && data._nd && data._arr && data._arr.ndim === 2) {
      const a = data._arr;
      ny = a.shape[0]; nx = a.shape[1];
      flat = new Float64Array(a.memory.buffer, a.ptr, ny * nx).slice();
    } else if (Array.isArray(data) && Array.isArray(data[0])) {
      ny = data.length;
      nx = data[0].length;
      flat = new Float64Array(ny * nx);
      for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) flat[i * nx + j] = data[i][j] == null ? NaN : data[i][j];
    } else {
      // Fall back to imshow as-is and let it complain.
      return this.imshow(data, undefined, undefined, opts);
    }
    // matshow defaults to 'upper' origin (row 0 at top) — opposite of
    // imshow's default. honor unless caller explicitly set otherwise.
    if (!o.origin) o.origin = 'upper';
    // Aspect equal so cells render as squares.
    if (this._aspect === 'auto') this._aspect = 'equal';
    return this.imshow(flat, nx, ny, o);
  }

  // imshow(data, nx, ny, opts): a flat row-major grid of nx × ny values
  imshow(data, nx, ny, opts) {
    if (typeof nx !== 'number' || typeof ny !== 'number') {
      throw new Error('plot: imshow: give the grid size, imshow(data, nx, ny, opts), with data flat and row-major; for a 2D array use matshow(Z)');
    }
    const o = this._opts('imshow', opts);
    const D = _col(data);
    if (D.length !== nx * ny) throw new Error(`plot: imshow: data has ${_fmtCount(D.length)} values but nx × ny is ${_fmtCount(nx * ny)}`);
    if (o.interpolation != null && !['nearest', 'none', 'bilinear', 'antialiased'].includes(o.interpolation)) {
      _warn('imshow.interp.' + o.interpolation, `imshow(): interpolation '${o.interpolation}' is not supported; use 'nearest' or 'bilinear'`, this._strict);
    }
    if (o.extent != null) {
      const e = Array.from(_col(o.extent));
      if (e.length !== 4) throw new Error('plot: imshow: extent must be [x0, x1, y0, y1]');
      o.extent = e;
    }
    if (o.aspect != null) this._aspect = o.aspect;
    this._traces.push({ type: 'imshow', data: D, nx, ny, opts: o });
    // default to equal aspect for grid data (matches matplotlib)
    if (this._aspect === 'auto') this._aspect = 'equal';
    return this;
  }

  axhline(y, opts) {
    const o = this._opts('axhline', opts);
    if (o.linewidth == null) o.linewidth = 1;
    this._traces.push({ type: 'hline', y, opts: o });
    return this;
  }

  axvline(x, opts) {
    const o = this._opts('axvline', opts);
    if (o.linewidth == null) o.linewidth = 1;
    this._traces.push({ type: 'vline', x, opts: o });
    return this;
  }

  // vlines(x, ymin, ymax) — vertical line segments. x can be scalar or
  // array. Implemented as line traces (x=[x_i,x_i] y=[ymin,ymax]) so no
  // new trace type is needed.
  vlines(x, ymin, ymax, opts) {
    const xs = _col(x);
    const o = this._opts('vlines', opts);
    if (!o.color && o.colors) o.color = _cssColor(Array.isArray(o.colors) ? o.colors[0] : o.colors);
    delete o.colors;
    if (!o.color) o.color = this._nextColor();
    for (const xv of xs) {
      this._traces.push({ type: 'line', x: Float64Array.of(xv, xv), y: Float64Array.of(ymin, ymax), opts: { ...o } });
    }
    return this;
  }

  hlines(y, xmin, xmax, opts) {
    const ys = _col(y);
    const o = this._opts('hlines', opts);
    if (!o.color && o.colors) o.color = _cssColor(Array.isArray(o.colors) ? o.colors[0] : o.colors);
    delete o.colors;
    if (!o.color) o.color = this._nextColor();
    for (const yv of ys) {
      this._traces.push({ type: 'line', x: Float64Array.of(xmin, xmax), y: Float64Array.of(yv, yv), opts: { ...o } });
    }
    return this;
  }

  text(x, y, text, opts) {
    const o = this._opts('text', opts);
    if (o.horizontalalignment && !o.ha) o.ha = o.horizontalalignment;
    if (o.verticalalignment && !o.va) o.va = o.verticalalignment;
    this._traces.push({ type: 'text', x, y, text, opts: o });
    return this;
  }

  set_title(text, opts) { this._title = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  set_xlabel(text, opts) { this._xlabel = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  set_ylabel(text, opts) { this._ylabel = { text, opts: _checkOpts('label', opts, this._strict) }; return this; }
  // set_xlim(left, right) · set_xlim([left, right]) · set_xlim({left: 0}) (keyword, as adder
  // passes it). A missing end keeps what it was (matplotlib: set_xlim(left=0)); null means
  // "from the data". left > right is an inverted axis. Shared axes (subplots(sharex)) all move.
  set_xlim(lo, hi) { this._setLim('x', lo, hi, 'left', 'right', 'xmin', 'xmax'); return this; }
  set_ylim(lo, hi) { this._setLim('y', lo, hi, 'bottom', 'top', 'ymin', 'ymax'); return this; }
  _setLim(axis, lo, hi, kLo, kHi, kMin, kMax) {
    if (_plainOpts(lo)) { const o = lo; lo = o[kLo] !== undefined ? o[kLo] : o[kMin]; hi = o[kHi] !== undefined ? o[kHi] : o[kMax]; }
    else if (_isArrayLike(lo) && hi === undefined) { hi = lo[1]; lo = lo[0]; }
    const key = axis === 'x' ? '_xlim' : '_ylim';
    const cur = this[key] || [null, null];
    const lim = [lo === undefined ? cur[0] : lo, hi === undefined ? cur[1] : hi];
    for (const ax of this._group(axis)) { ax[key] = lim.slice(); ax[axis === 'x' ? '_xinv' : '_yinv'] = false; }
  }
  // the limits as drawn (inverted axes give [high, low], as matplotlib does)
  get_xlim() { return this._getLim('x'); }
  get_ylim() { return this._getLim('y'); }
  _getLim(axis) {
    const v = this.view;
    if (v) { const d = (axis === 'x' ? v.xScale : v.yScale).domain; return (axis === 'x' ? v.xinv : v.yinv) ? [d[1], d[0]] : d.slice(); }
    const R = this._axisRange(axis, (axis === 'x' ? this._xscale : this._yscale) === 'log');
    return R.inv ? [R.hi, R.lo] : [R.lo, R.hi];
  }
  invert_xaxis() { for (const ax of this._group('x')) ax._xinv = !ax._xinv; return this; }
  invert_yaxis() { for (const ax of this._group('y')) ax._yinv = !ax._yinv; return this; }
  xaxis_inverted() { const l = this.get_xlim(); return l[0] > l[1]; }
  yaxis_inverted() { const l = this.get_ylim(); return l[0] > l[1]; }
  // margins(m) · margins(x, y) · margins({x, y}) · margins() → [x, y]
  margins(x, y) {
    if (x === undefined) return [this._xmargin, this._ymargin];
    if (_plainOpts(x)) { y = x.y; x = x.x; }
    else if (y === undefined) y = x;
    if (x != null) this._xmargin = +x;
    if (y != null) this._ymargin = +y;
    return this;
  }
  // axis('off' | 'on' | 'equal' | 'scaled' | 'image' | 'tight' | [x0, x1, y0, y1]) → the limits
  axis(arg) {
    if (arg != null && _plainOpts(arg)) { const o = arg; arg = o.option ?? null; if (o.xmin != null || o.xmax != null) this.set_xlim(o.xmin, o.xmax); if (o.ymin != null || o.ymax != null) this.set_ylim(o.ymin, o.ymax); }
    if (_isArrayLike(arg) && arg.length === 4) { this.set_xlim(arg[0], arg[1]); this.set_ylim(arg[2], arg[3]); }
    else if (arg === false || arg === 'off') this._axisOn = false;
    else if (arg === true || arg === 'on') this._axisOn = true;
    else if (arg === 'equal' || arg === 'scaled' || arg === 'square') this._aspect = 'equal';
    else if (arg === 'image') { this._aspect = 'equal'; this._xmargin = this._ymargin = 0; }
    else if (arg === 'tight') { this._xmargin = this._ymargin = 0; }
    else if (arg === 'auto' || arg === 'normal') this._aspect = 'auto';
    else if (arg != null) _warn('axis.' + arg, `axis('${arg}') is not supported; use 'off', 'on', 'equal', 'scaled', 'image', 'tight', 'auto' or [x0, x1, y0, y1]`, this._strict);
    return [...this.get_xlim(), ...this.get_ylim()];
  }
  // set_xticks(ticks, labels?, {rotation}) — exactly these ticks; [] for none. Labels may also
  // come later from set_xticklabels.
  set_xticks(ticks, labels, opts) { this._setTicks('x', ticks, labels, opts); return this; }
  set_yticks(ticks, labels, opts) { this._setTicks('y', ticks, labels, opts); return this; }
  set_xticklabels(labels, opts) { this._setTickLabels('x', labels, opts); return this; }
  set_yticklabels(labels, opts) { this._setTickLabels('y', labels, opts); return this; }
  get_xticks() { return this._ticksNow('x').values.slice(); }
  get_yticks() { return this._ticksNow('y').values.slice(); }
  get_xticklabels() { return this._ticksNow('x').labels.slice(); }
  get_yticklabels() { return this._ticksNow('y').labels.slice(); }
  _setTicks(axis, ticks, labels, opts) {
    if (_plainOpts(labels)) { opts = labels; labels = opts.labels; }
    const o = _plainOpts(opts) ? opts : {};
    const t = { values: Array.from(ticks == null ? [] : _isArrayLike(ticks) ? ticks : [ticks], Number), labels: labels != null ? Array.from(labels, (l) => (l == null ? '' : String(l))) : null, rotation: o.rotation ?? null };
    this[axis === 'x' ? '_xticks' : '_yticks'] = t;
  }
  _setTickLabels(axis, labels, opts) {
    const o = _plainOpts(opts) ? opts : {};
    const key = axis === 'x' ? '_xticks' : '_yticks';
    const cur = this[key] || { values: this._ticksNow(axis).values.slice(), rotation: null };
    this[key] = { values: cur.values, labels: Array.from(labels || [], (l) => (l == null ? '' : String(l))), rotation: o.rotation ?? cur.rotation };
  }
  // the ticks as the last render chose them (or as set)
  _ticksNow(axis) {
    const set = axis === 'x' ? this._xticks : this._yticks;
    if (set && set.labels) return set;
    const spec = axis === 'x' ? this._lastXt : this._lastYt;
    if (spec) return spec;
    if (set) return { values: set.values, labels: set.values.map(String) };
    return { values: [], labels: [] };
  }
  // tick_params(axis, {labelrotation}) — the part of it that sets what plot draws
  tick_params(opts) {
    const o = _plainOpts(opts) ? opts : {};
    const which = o.axis || 'both';
    if (o.labelrotation != null) for (const a of (which === 'both' ? ['x', 'y'] : [which])) {
      const key = a === 'x' ? '_xticks' : '_yticks';
      this[key] = { ...(this[key] || { values: null, labels: null }), rotation: o.labelrotation };
    }
    for (const k of Object.keys(o)) if (k !== 'axis' && k !== 'labelrotation' && k !== '_kw') _warn('tick_params.' + k, `tick_params(): '${k}' is not supported yet (only axis and labelrotation)`, this._strict);
    return this;
  }
  // every axes that shares this one's `axis` (subplots(sharex / sharey)), this one included
  _group(axis) { return this._shared[axis] || [this]; }
  // a column for `axis`: numbers, or labels that make (or extend) that axis's categories
  _axisCol(axis, arr) {
    if (!_isCategorical(arr)) return _col(arr);
    const key = axis === 'x' ? '_xcats' : '_ycats';
    if (!this[key]) {
      const cats = new _Categories();
      for (const ax of this._group(axis)) if (!ax[key]) ax[key] = cats;
    }
    return this[key].positions(arr);
  }
  set_xscale(scale) { this._checkScale(scale); this._xscale = scale; return this; }
  set_yscale(scale) { this._checkScale(scale); this._yscale = scale; return this; }
  _checkScale(scale) {
    if (scale !== 'linear' && scale !== 'log') _warn('scale.' + scale, `set_xscale/set_yscale('${scale}') is not supported; use 'linear' or 'log'`, this._strict);
  }
  set_zorder(_n) { _noop('set_zorder', this._strict); return this; }
  set_aspect(aspect) { this._aspect = aspect; return this; }

  // twinx() — a sister axes that shares this one's x-scale, has its own y-scale, and renders
  // overlaid in the same rect with its y-axis on the right edge (dual-y plots). The twin is
  // NOT added to the figure's axes grid — its parent renders it as part of its own pass.
  twinx() {
    const t = new Axes(this._theme);
    t._strict = this._strict;
    t._twinOf = this;
    t._dpi = this._dpi;
    t._xscale = this._xscale;
    t._xlim = this._xlim;
    this._twin = t;
    return t;
  }
  // twiny() — the mirror: shares y, has its own x-scale, its x-axis along the top edge
  twiny() {
    const t = new Axes(this._theme);
    t._strict = this._strict;
    t._twinOf = this;
    t._dpi = this._dpi;
    t._yscale = this._yscale;
    t._ylim = this._ylim;
    this._twinY = t;
    return t;
  }

  legend(opts) { this._legend = true; this._legendOpts = _checkOpts('legend', _plainOpts(opts) ? opts : {}, this._strict); return this; }

  colorbar(opts) { this._colorbar = true; this._colorbarOpts = _checkOpts('colorbar', _plainOpts(opts) ? opts : {}, this._strict); return this; }

  // grid() · grid(False) · grid(True, {alpha}) · grid({alpha}) (adder kwargs arrive as the first arg)
  grid(on, opts) {
    if (_plainOpts(on)) { opts = on; on = opts.visible !== undefined ? opts.visible : opts.b !== undefined ? opts.b : true; }
    this._grid = on !== false;
    if (opts) {
      const o = { ...opts }; delete o.visible; delete o.b;
      this._gridOpts = _resolveAliases(_checkOpts('grid', o, this._strict));
    }
    return this;
  }

  // ── view ──────────────────────────────────────────────────────────────────────────────────

  _needView(fn) {
    if (!this.view) throw new Error(`plot: ax.${fn} needs a drawn figure — call fig.show() or fig.draw(ctx) first`);
    return this.view;
  }
  // data → pixel (CSS px in the figure), and back
  toPixel(x, y) { const v = this._needView('toPixel'); return [v.xScale.transform(x), v.yScale.transform(y)]; }
  toData(px, py) { const v = this._needView('toData'); return [v.xScale.inverse(px), v.yScale.inverse(py)]; }

  // --- rendering ---

  // One pass lays the axes out with estimated margins and chooses the ticks for that size;
  // the next measures the real tick labels, titles and axis labels and lays it out again
  // (until the margins settle, at most three passes). Callers that need a grid of cells to
  // line up pass _margins = { left, right, top, bottom } and skip the measuring.
  _render(ctx, rect, env) {
    const dpr = (env && env.dpr) || 1;
    const th = this._theme;
    // per-Axes overrides (_bgcolor, _textColor, _gridColor, _frameColor) still win
    const bgcolor = this._bgcolor || th.background;
    const textColor = this._textColor || th.foreground;
    const gridColor = this._gridColor || th.grid;
    const frameColor = this._frameColor || th.frame;
    const fs = th.font_size || 11;
    const fTick = _font(th, -1), fLab = _font(th, 0), fTitle = _font(th, 2);
    const xLog = this._xscale === 'log', yLog = this._yscale === 'log';
    const XR = this._axisRange('x', xLog), YR = this._axisRange('y', yLog);
    const cb = this._colorbar ? this._colorbarInfo(ctx, fTick) : null;

    let m = this._margins
      ? { left: this._margins.left ?? 42, right: this._margins.right ?? 12, top: this._margins.top ?? 8, bottom: this._margins.bottom ?? 26 }
      : { left: 42, right: cb ? 70 : 12, top: this._title ? 24 : 8, bottom: 26 };
    let L = null;
    for (let pass = 0; pass < 3; pass++) {
      L = this._layout(ctx, rect, m, XR, YR, xLog, yLog, fTick, fs);
      if (!L || this._margins) break;
      const next = this._measure(rect, L, cb, fs);
      if (Math.abs(next.left - m.left) < 1 && Math.abs(next.right - m.right) < 1 && Math.abs(next.top - m.top) < 1 && Math.abs(next.bottom - m.bottom) < 1) break;
      m = next;
    }
    if (!L) return;
    const { plotX, plotY, plotW, plotH, fullPlotY, fullPlotH, xScale, yScale, xt, yt } = L;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    this._lastXt = xt; this._lastYt = yt;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale, yScale, dpr, xinv: L.xinv, yinv: L.yinv };
    const on = this._axisOn;

    // axes background
    if (on && bgcolor !== 'none' && bgcolor !== 'transparent') {
      ctx.fillStyle = bgcolor;
      ctx.fillRect(plotX, plotY, plotW, plotH);
    }

    // grid, at the ticks
    if (this._grid && on) {
      const g = this._gridOpts;
      ctx.strokeStyle = _cssColor(g.color) || gridColor;
      ctx.lineWidth = g.linewidth || 0.5;
      ctx.globalAlpha = g.alpha != null ? g.alpha : 0.8;
      ctx.setLineDash(dashArray(g.linestyle));
      const which = g.axis || 'both';
      if (which !== 'y') for (const v of xt.values) {
        const px = xScale.transform(v);
        ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
      }
      if (which !== 'x') for (const v of yt.values) {
        const py = yScale.transform(v);
        ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // own traces (clipped to the plot area), then the twins' (with their own axis)
    const lastCmapTrace = this._renderTraces(ctx, xScale, yScale, plotX, plotY, plotW, plotH, dpr);
    if (this._twin) this._twin._renderAsTwin(ctx, xScale, plotX, plotY, plotW, plotH, dpr, L.twinYt);
    if (this._twinY) this._twinY._renderAsTwinY(ctx, yScale, plotX, plotY, plotW, plotH, dpr, L.twinXt);

    if (on) {
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(plotX, plotY, plotW, plotH);
      if (!this._hideXTicks) _drawTicks(ctx, this._xtickLabelsOff ? { ...xt, labels: xt.labels.map(() => '') } : xt, xScale, 'bottom', plot, textColor, frameColor, fTick);
      if (!this._hideYTicks) _drawTicks(ctx, this._ytickLabelsOff ? { ...yt, labels: yt.labels.map(() => '') } : yt, yScale, 'left', plot, textColor, frameColor, fTick);
    }

    // title (above a top twin axis, when there is one)
    if (this._title) {
      ctx.fillStyle = textColor;
      ctx.font = fTitle;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const above = L.twinXt ? 6 + L.twinXt.extent + 4 + (this._twinY._xlabel ? fs + 6 : 0) : 0;
      ctx.fillText(this._title.text, plotX + plotW / 2, plotY - 6 - above);
    }
    if (on && this._xlabel) {
      ctx.fillStyle = textColor;
      ctx.font = fLab;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const below = this._hideXTicks ? 4 : 6 + xt.extent + 6;
      ctx.fillText(this._xlabel.text, plotX + plotW / 2, plotY + plotH + below);
    }
    if (on && this._ylabel) {
      ctx.save();
      ctx.fillStyle = textColor;
      ctx.font = fLab;
      const left = this._hideYTicks ? 4 : 4 + 6 + yt.maxW + 6;
      ctx.translate(plotX - left, plotY + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._ylabel.text, 0, 0);
      ctx.restore();
    }

    if (this._legend) this._renderLegend(ctx, plotX, plotY, plotW, plotH);

    // colorbar — pinned right of the plot, full pre-aspect height (it doesn't shrink with an
    // equal-aspect image)
    if (cb && lastCmapTrace) {
      const cbX = rect.x + rect.w - m.right + 10;
      const { vmin, vmax } = this._cmapRange(lastCmapTrace);
      if (vmin - vmin === 0 && vmax - vmax === 0) {
        renderColorbar(ctx, cbX, fullPlotY, 12, fullPlotH, lastCmapTrace.opts.cmap || th.ramp || 'viridis', vmin, vmax, {
          textColor, font: fTick, label: this._colorbarOpts.label, labelFont: fLab, labelOffset: 12 + 6 + cb.labelsW + 6,
        });
      }
    }
  }

  // the plot rect for margins m, the scales (equal aspect applied), and the ticks for that size
  _layout(ctx, rect, m, XR, YR, xLog, yLog, fTick, fs) {
    let plotX = rect.x + m.left, plotY = rect.y + m.top;
    let plotW = rect.x + rect.w - m.right - plotX, plotH = rect.y + rect.h - m.bottom - plotY;
    if (plotW <= 1 || plotH <= 1) return null;
    const fullPlotY = plotY, fullPlotH = plotH;
    let { lo: xlo, hi: xhi } = XR, { lo: ylo, hi: yhi } = YR;
    // equal aspect: an image-led axes (matshow, a raster map) SHRINKS the plot rect so cells are
    // square; anything else WIDENS the data range, as matplotlib's adjustable='datalim' does
    if (this._aspect === 'equal' && !xLog && !yLog) {
      const dataW = xhi - xlo, dataH = yhi - ylo;
      const sx = plotW / dataW, sy = plotH / dataH;
      if (this._traces.some((t) => t.type === 'imshow' || (_KINDS[t.type] && _KINDS[t.type].image))) {
        const k = Math.min(sx, sy), nw = dataW * k, nh = dataH * k;
        plotX += (plotW - nw) / 2; plotY += (plotH - nh) / 2; plotW = nw; plotH = nh;
      } else if (sx < sy) {
        const c = (ylo + yhi) / 2, half = plotH / sx / 2; ylo = c - half; yhi = c + half;
      } else {
        const c = (xlo + xhi) / 2, half = plotW / sy / 2; xlo = c - half; xhi = c + half;
      }
    }
    const xScale = this._scaleOf(xlo, xhi, XR.inv, plotX, plotX + plotW, xLog);
    const yScale = this._scaleOf(ylo, yhi, YR.inv, plotY + plotH, plotY, yLog);
    const xt = _tickSpec(this, 'x', xScale, plotW, ctx, fTick, fs - 1);
    const yt = _tickSpec(this, 'y', yScale, plotH, ctx, fTick, fs - 1);
    let twinYt = null, twinXt = null;
    if (this._twin) { const ys = this._twin._ownScale('y', plotY + plotH, plotY); if (ys) twinYt = _tickSpec(this._twin, 'y', ys, plotH, ctx, fTick, fs - 1); }
    if (this._twinY) { const xs = this._twinY._ownScale('x', plotX, plotX + plotW); if (xs) twinXt = _tickSpec(this._twinY, 'x', xs, plotW, ctx, fTick, fs - 1); }
    return { plotX, plotY, plotW, plotH, fullPlotY, fullPlotH, xScale, yScale, xt, yt, twinYt, twinXt, xinv: XR.inv, yinv: YR.inv };
  }

  // the margins this layout's labels need
  _measure(rect, L, cb, fs) {
    const on = this._axisOn, xt = L.xt, yt = L.yt;
    let left = 6, right = 10, top = 8, bottom = 6;
    if (on && !this._hideYTicks) left = 4 + 6 + (this._ytickLabelsOff ? 0 : yt.maxW) + 6;
    if (on && this._ylabel) left += fs + 4;
    if (on && !this._hideXTicks) bottom = 6 + (this._xtickLabelsOff ? 0 : xt.extent) + 4;
    if (on && this._xlabel) bottom += fs + 8;
    if (this._title) top += fs + 2 + 6;
    if (L.twinXt) { top += 6 + L.twinXt.extent + 4; if (this._twinY._xlabel) top += fs + 6; }
    if (L.twinYt) right = Math.max(right, 4 + 6 + L.twinYt.maxW + 6 + (this._twin._ylabel ? fs + 4 : 0));
    if (cb) right = Math.max(right, 10 + 12 + 6 + cb.labelsW + 6 + (this._colorbarOpts.label ? fs + 4 : 0));
    // x tick labels hang past the ends of the axis: half a flat label, a whole rotated one
    if (on && !this._hideXTicks && !this._xtickLabelsOff && xt.values.length) {
      const k = xt.rot ? Math.cos((xt.rot * Math.PI) / 180) : 0.5;
      for (let i = 0; i < xt.values.length; i++) {
        if (!xt.labels[i]) continue;
        const p = L.xScale.transform(xt.values[i]);
        const a = p - xt.widths[i] * k, b = xt.rot ? p : p + xt.widths[i] * k;
        if (a < rect.x + 2) left += rect.x + 2 - a;
        if (b > rect.x + rect.w - 2) right += b - (rect.x + rect.w - 2);
      }
    }
    return { left, right, top, bottom };
  }

  _scaleOf(lo, hi, inv, r0, r1, log) {
    const range = inv ? [r1, r0] : [r0, r1];
    return log ? new LogScale(_logBounds(lo, hi), range) : new LinearScale([lo, hi], range);
  }

  // the colorbar's labels, measured: the right margin depends on them
  _colorbarInfo(ctx, fTick) {
    let tr = null;
    for (const t of this._traces) if (t.type === 'imshow' || t.cvals || (_KINDS[t.type] && _KINDS[t.type].cmap && t.cmapped !== false)) tr = t;
    if (!tr) return null;
    const { vmin, vmax } = this._cmapRange(tr);
    if (!(vmin - vmin === 0 && vmax - vmax === 0)) return null;
    ctx.font = fTick;
    const sc = new LinearScale([Math.min(vmin, vmax), Math.max(vmin, vmax)], [0, 1]);
    let w = 0;
    for (const v of [vmin, vmax, ...sc.ticks(5)]) w = Math.max(w, _textW(fTick, sc.tickFormat()(v)));
    return { labelsW: w };
  }

  // ── ranges ────────────────────────────────────────────────────────────────────────────────
  // The drawn range of one axis: { lo, hi (lo < hi), inv }. Explicit limits (null ends from
  // the data), else the data's extent widened by the margins. inv: left > right as given, or
  // flipped by invert_xaxis().
  _axisRange(axis, log) {
    const lim = axis === 'x' ? this._xlim : this._ylim;
    let [a, b] = lim ? this._limits(lim, axis, log) : this._autoExtent(axis, log);
    let inv = a > b;
    if (axis === 'x' ? this._xinv : this._yinv) inv = !inv;
    let lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo - lo !== 0 || hi - hi !== 0) { lo = log ? 1 : 0; hi = log ? 10 : 1; }
    if (lo === hi) { if (log) { lo /= 10; hi *= 10; } else { lo -= 0.5; hi += 0.5; } }
    return { lo, hi, inv };
  }

  // explicit limits, with a None (null) end filled from the data
  _limits(lim, axis, log) {
    let [lo, hi] = lim;
    if (lo == null || hi == null) {
      const [dlo, dhi] = this._autoExtent(axis, log);
      if (lo == null) lo = hi != null && hi < dlo ? dhi : dlo;
      if (hi == null) hi = lo != null && lo > dhi ? dlo : dhi;
    }
    return [lo, hi];
  }

  // the data extent along `axis` of every axes sharing it (subplots sharing, a twin), widened
  // by the margins — except where a sticky edge stops it (bars at 0, an image's extent)
  _autoExtent(axis, log) {
    const members = new Set(this._group(axis));
    const twin = axis === 'x' ? this._twin : this._twinY;
    if (twin) members.add(twin);
    let lo = Infinity, hi = -Infinity;
    const sticky = [];
    for (const ax of members) {
      const r = ax._rawExtent(axis, log);
      if (r.lo < lo) lo = r.lo;
      if (r.hi > hi) hi = r.hi;
      for (const v of r.sticky) sticky.push(v);
    }
    if (!(lo <= hi)) return log ? [1, 10] : [0, 1];
    const m = axis === 'x' ? this._xmargin : this._ymargin;
    let plo, phi;
    if (log) { const f = Math.pow(hi / lo, m); plo = lo / f; phi = hi * f; }
    else { const pad = (hi - lo) * m; plo = lo - pad; phi = hi + pad; }
    for (const v of sticky) { if (v <= lo && v > plo) plo = v; if (v >= hi && v < phi) phi = v; }
    return [plo, phi];
  }

  // vmin / vmax of a colour-mapped trace: the options, or the finite data range
  _cmapRange(trace) {
    let vmin = trace.opts.vmin, vmax = trace.opts.vmax;
    if (vmin == null || vmax == null) {
      const r = trace.type === 'imshow' ? this._imshowRange(trace) : _traceRange(trace, 'c', trace.cvals);
      if (vmin == null) vmin = r.lo;
      if (vmax == null) vmax = r.hi;
    }
    return { vmin, vmax };
  }

  _imshowRange(trace) {
    const c = trace._cache || (trace._cache = {});
    if (c.range_img) return c.range_img;
    const nodata = trace.opts.nodata;
    if (nodata == null) return (c.range_img = _traceRange(trace, 'data', trace.data));
    let lo = Infinity, hi = -Infinity;
    const d = trace.data;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v - v !== 0 || v === nodata) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (c.range_img = { lo, hi });
  }

  // Render this axes' traces into the given plot rect, clipped. Returns
  // the last trace that contributed a colormap (for colorbar rendering).
  // Shared with the twin overlay paths.
  _renderTraces(ctx, xScale, yScale, plotX, plotY, plotW, plotH, dpr = 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();
    const rect = { x: plotX, y: plotY, w: plotW, h: plotH, dpr };
    let lastCmapTrace = null;
    const order = this._traces.map((t, i) => [t.opts && t.opts.zorder != null ? +t.opts.zorder : (_ZORDER[t.type] ?? (_KINDS[t.type] ? _KINDS[t.type].z ?? 1 : 1)), i]);
    order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, ti] of order) {
      const trace = this._traces[ti];
      switch (trace.type) {
        case 'imshow': this._renderImshow(ctx, trace, xScale, yScale, rect); lastCmapTrace = trace; break;
        case 'line': this._renderLine(ctx, trace, xScale, yScale, rect); break;
        case 'scatter': this._renderScatter(ctx, trace, xScale, yScale, rect); if (trace.cvals) lastCmapTrace = trace; break;
        case 'bar': this._renderBar(ctx, trace, xScale, yScale); break;
        case 'barh': this._renderBarh(ctx, trace, xScale, yScale); break;
        case 'hist': this._renderHist(ctx, trace, xScale, yScale); break;
        case 'hline': this._renderHline(ctx, trace, xScale, yScale, plotX, plotW); break;
        case 'vline': this._renderVline(ctx, trace, xScale, yScale, plotY, plotH); break;
        case 'text': this._renderText(ctx, trace, xScale, yScale, rect); break;
        default: {
          const k = _KINDS[trace.type];
          if (k) { k.render(this, ctx, trace, xScale, yScale, rect); if (k.cmap && trace.cmapped !== false) lastCmapTrace = trace; }
        }
      }
    }
    ctx.restore();
    return lastCmapTrace;
  }

  // the y-scale of a twin that only has its own y (twinx), or x (twiny)
  _ownScale(axis, r0, r1) {
    const log = (axis === 'x' ? this._xscale : this._yscale) === 'log';
    const lim = axis === 'x' ? this._xlim : this._ylim;
    if (!lim && !this._traces.length) return null;
    const R = this._axisRange(axis, log);
    return this._scaleOf(R.lo, R.hi, R.inv, r0, r1, log);
  }

  // Render as a twinx overlay — shares the parent's xScale, uses own y-scale, draws the
  // y-axis ticks/label on the right edge of the rect. Title/xlabel/legend belong to parent.
  _renderAsTwin(ctx, parentXScale, plotX, plotY, plotW, plotH, dpr = 1, spec) {
    const yScale = this._ownScale('y', plotY + plotH, plotY);
    if (!yScale) return;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale: parentXScale, yScale, dpr };
    this._renderTraces(ctx, parentXScale, yScale, plotX, plotY, plotW, plotH, dpr);
    const th = this._theme, tc = this._textColor || th.foreground, fc = this._frameColor || th.frame;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    if (spec) _drawTicks(ctx, spec, yScale, 'right', plot, tc, fc, _font(th, -1));
    // the right ylabel, rotated +90° so it reads top to bottom (matplotlib's right axis)
    if (this._ylabel) {
      ctx.save();
      ctx.fillStyle = tc;
      ctx.font = _font(th, 0);
      ctx.translate(plotX + plotW + 4 + 6 + (spec ? spec.maxW : 0) + 6, plotY + plotH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._ylabel.text, 0, 0);
      ctx.restore();
    }
  }

  // a twiny overlay: shares the parent's y, its own x along the TOP edge
  _renderAsTwinY(ctx, parentYScale, plotX, plotY, plotW, plotH, dpr = 1, spec) {
    const xScale = this._ownScale('x', plotX, plotX + plotW);
    if (!xScale) return;
    this.view = { x: plotX, y: plotY, w: plotW, h: plotH, xScale, yScale: parentYScale, dpr };
    this._renderTraces(ctx, xScale, parentYScale, plotX, plotY, plotW, plotH, dpr);
    const th = this._theme, tc = this._textColor || th.foreground, fc = this._frameColor || th.frame;
    const plot = { x: plotX, y: plotY, w: plotW, h: plotH };
    if (spec) _drawTicks(ctx, spec, xScale, 'top', plot, tc, fc, _font(th, -1));
    if (this._xlabel) {
      ctx.fillStyle = tc;
      ctx.font = _font(th, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this._xlabel.text, plotX + plotW / 2, plotY - 6 - (spec ? spec.extent : 0) - 6);
    }
  }

  // { lo, hi, sticky } of everything this axes draws along `axis` (no margins). `log`: only
  // positive values count. sticky: edges the margins must not cross (bars and histograms at
  // 0, images at their extent). Kept: _dataExtent, the padded range (callers outside plot).
  _rawExtent(axis, log = false) {
    let lo = Infinity, hi = -Infinity;
    const sticky = [];
    const take = (v) => { if (v - v === 0 && (!log || v > 0)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    const stick = (v) => { if (v - v === 0 && (!log || v > 0)) sticky.push(v); };
    const takeRange = (r) => { if (!r.n) return; take(log ? r.minPos : r.lo); take(r.hi); };
    for (const trace of this._traces) {
      switch (trace.type) {
        case 'line':
        case 'scatter':
          takeRange(_traceRange(trace, axis, axis === 'x' ? trace.x : trace.y, log));
          break;
        case 'bar': {
          if (axis === 'x') {
            const r = _traceRange(trace, 'x', trace.x), w = typeof trace.opts.width === 'number' ? trace.opts.width : 0.8;
            if (r.n) { take(r.lo - w / 2); take(r.hi + w / 2); }
          } else {
            if (!log) { take(0); stick(0); }
            takeRange(_traceRange(trace, 'h', trace.heights, log));
          }
          break;
        }
        case 'barh': {
          if (axis === 'y') {
            const r = _traceRange(trace, 'y', trace.y), h = typeof trace.opts.height === 'number' ? trace.opts.height : 0.8;
            if (r.n) { take(r.lo - h / 2); take(r.hi + h / 2); }
          } else {
            if (!log) { take(0); stick(0); }
            takeRange(_traceRange(trace, 'w', trace.widths, log));
          }
          break;
        }
        case 'hist': {
          const { edges, counts } = this._hist(trace);
          if (axis === 'x') { take(edges[0]); take(edges[edges.length - 1]); }
          else { if (!log) { take(0); stick(0); } for (const c of counts) take(c); }
          break;
        }
        case 'imshow': {
          const e = this._imshowExtent(trace);
          const [a, b] = axis === 'x' ? [e[0], e[1]] : [e[2], e[3]];
          take(a); take(b); stick(a); stick(b);
          break;
        }
        case 'hline': if (axis === 'y') take(trace.y); break;
        case 'vline': if (axis === 'x') take(trace.x); break;
        case 'text': if (!trace.opts.transform) take(axis === 'x' ? trace.x : trace.y); break;
        default: { const k = _KINDS[trace.type]; if (k && k.extent) k.extent(this, trace, axis, log, take, stick); }
      }
    }
    return { lo, hi, sticky };
  }
  _dataExtent(axis, log = false) { return this._autoExtent(axis, log); }

  _imshowExtent(trace) {
    return trace.opts.extent || [0, trace.nx, 0, trace.ny];
  }

  // ── histogram ─────────────────────────────────────────────────────────────────────────────
  // Counted once per trace (traces are immutable) in one pass: uniform bins index directly,
  // given edges binary-search. numpy's rules: the last bin includes its right edge; NaN and
  // values outside the range are left out; a value that rounds into the wrong bin is moved
  // back (numpy's own correction), so counts match numpy.histogram exactly.
  _hist(trace) {
    const c = trace._cache || (trace._cache = {});
    if (c.hist) return c.hist;
    const data = trace.data, o = trace.opts, w = o.weights || null;
    let edges;
    if (o.bins != null && typeof o.bins !== 'number') {
      edges = Array.from(o.bins);
    } else {
      const nb = Math.max(1, (o.bins || 10) | 0);
      let lo, hi;
      if (o.range) { lo = +o.range[0]; hi = +o.range[1]; }
      else { const r = _traceRange(trace, 'data', data); lo = r.n ? r.lo : 0; hi = r.n ? r.hi : 1; }
      if (lo === hi) { lo -= 0.5; hi += 0.5; }
      edges = new Array(nb + 1);
      const step = (hi - lo) / nb;
      for (let i = 0; i <= nb; i++) edges[i] = lo + i * step;
      edges[nb] = hi;
    }
    const nb = edges.length - 1;
    const counts = new Float64Array(Math.max(0, nb));
    if (nb > 0) {
      const lo = edges[0], hi = edges[nb];
      const uniform = typeof o.bins !== 'object' || o.bins == null;
      const E = Float64Array.from(edges);
      const k = nb / (hi - lo), len = data.length;
      if (uniform && !w) {
        const ic = _countUniform(data, lo, hi, nb, E);
        for (let b = 0; b < nb; b++) counts[b] = ic[b];
      } else {
        for (let i = 0; i < len; i++) {
          const v = data[i];
          if (!(v >= lo && v <= hi)) continue;
          let b;
          if (uniform) {
            b = ((v - lo) * k) | 0;
            if (b >= nb) b = nb - 1;
            if (v < E[b]) b--;
            else if (b < nb - 1 && v >= E[b + 1]) b++;
          } else {
            let L = 0, R = nb - 1;                           // largest b with edges[b] <= v
            while (L < R) { const m = (L + R + 1) >> 1; if (E[m] <= v) L = m; else R = m - 1; }
            b = L;
          }
          counts[b] += w ? w[i] : 1;
        }
      }
    }
    let out = Array.from(counts);
    if (o.density) {
      let total = 0;
      for (const v of out) total += v;
      out = out.map((v, i) => (total > 0 ? v / (total * (edges[i + 1] - edges[i])) : 0));
    }
    if (o.cumulative) {
      let acc = 0;
      out = out.map((v, i) => (acc += o.density ? v * (edges[i + 1] - edges[i]) : v));
    }
    return (c.hist = { edges, counts: out });
  }

  // kept for callers that read them (plt.hist's return value, tests)
  _computeHistBins(trace) { return { bins: this._hist(trace).edges }; }
  _computeHistCounts(trace) { return this._hist(trace).counts; }

  // --- trace renderers ---

  // a trace's pixel positions at this view (cached until the view changes)
  _positions(trace, xs, ys) {
    const key = `${xs.domain}|${xs.range}|${xs.log}|${ys.domain}|${ys.range}|${ys.log}`;
    const c = trace._cache || (trace._cache = {});
    if (c.pos && c.pos.key === key) return c.pos;
    const n = trace.x.length;
    const X = new Float32Array(n), Y = new Float32Array(n);
    if (!xs.log && !ys.log) {
      // one pass for both columns (the common case); a point with either coordinate
      // non-finite gets NaN for both
      const x = trace.x, y = trace.y, ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b;
      for (let i = 0; i < n; i++) {
        const xv = x[i], yv = y[i];
        if (xv - xv === 0 && yv - yv === 0) { X[i] = ax * xv + bx; Y[i] = ay * yv + by; }
        else { X[i] = NaN; Y[i] = NaN; }
      }
    } else {
      _project(trace.x, xs, X);
      _project(trace.y, ys, Y);
      for (let i = 0; i < n; i++) if (X[i] !== X[i] || Y[i] !== Y[i]) { X[i] = NaN; Y[i] = NaN; }
    }
    return (c.pos = { key, X, Y, grid: null });
  }

  _renderLine(ctx, trace, xScale, yScale, rect) {
    const { x, y, opts } = trace;
    if (!x.length) return;
    const color = opts.color || this._theme.cycle[0];
    const alpha = opts.alpha != null ? opts.alpha : 1;
    if (!_noLine(opts.linestyle)) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = opts.linewidth || 1.5;
      const dash = dashArray(opts.linestyle);
      ctx.setLineDash(dash);
      const n = x.length, dpr = rect.dpr;
      const c = trace._cache || (trace._cache = {});
      if (c.mono === undefined) c.mono = _isNumericCol(x) && _isMonotonic(x);
      const m4 = _engine.m4 && !dash.length && c.mono && n > 4 * _M4_SUB * rect.w * dpr;
      const build = (target) => (m4 ? this._pathM4(target, x, y, xScale, yScale, dpr) : this._pathFull(target, x, y, xScale, yScale));
      if (n > 1000 && typeof Path2D !== 'undefined' && !isRecordingContext(ctx)) {
        // a long line on a real canvas: build its path once per view, then a redraw is one
        // stroke (a draw list has no Path2D, so recording still writes the vertices out)
        const key = `${xScale.domain}|${xScale.range}|${yScale.domain}|${yScale.range}|${dpr}|${m4}`;
        if (!c.path || c.path.key !== key) { const p = new Path2D(); build(p); c.path = { key, p }; }
        ctx.stroke(c.path.p);
      } else {
        ctx.beginPath();
        build(ctx);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // markers
    if (opts.marker) {
      // markersize: the diameter in points, default 6 (matplotlib's lines.markersize)
      const r = ((opts.markersize || 6) * this._dpi) / 144;
      const face = opts.markerfacecolor ? _cssColor(opts.markerfacecolor) : color;
      const edge = opts.markeredgecolor ? { color: _cssColor(opts.markeredgecolor), width: ((opts.markeredgewidth ?? 1) * this._dpi) / 72 } : null;   // points, as matplotlib's
      const pos = this._positions(trace, xScale, yScale);
      this._drawPoints(ctx, trace, pos, rect, { marker: opts.marker, radius: r, uniform: face, alpha, edge, cacheKey: 'mk' });
    }
  }

  // every vertex; a non-finite point (or ≤ 0 on a log axis) lifts the pen
  _pathFull(ctx, x, y, xs, ys) {
    const ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b, xl = xs.log, yl = ys.log;
    let pen = false;
    for (let i = 0; i < x.length; i++) {
      const xv = x[i], yv = y[i];
      const X = xl ? (xv > 0 ? ax * Math.log10(xv) + bx : NaN) : ax * xv + bx;
      const Y = yl ? (yv > 0 ? ay * Math.log10(yv) + by : NaN) : ay * yv + by;
      if (X - X !== 0 || Y - Y !== 0) { pen = false; continue; }
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    }
  }

  // M4 decimation for long lines with non-decreasing x: per column, keep the first, the min,
  // the max and the last vertex, in index order; a NaN still breaks the line. The columns are
  // QUARTER device pixels: M4 at whole pixels is exact for aliased 1-px lines, but an
  // antialiased stroke over a dense column zigzags across its whole width, and one vertical
  // stroke per pixel draws a visibly thinner, lopsided band. Four per pixel keeps that spread
  // for ~16 vertices per pixel — still a few thousand for a figure, however long the line.
  _pathM4(ctx, x, y, xs, ys, dpr) {
    const ax = xs.a, bx = xs.b, ay = ys.a, by = ys.b, xl = xs.log, yl = ys.log;
    let pen = false, col = NaN, iF = -1, iL = -1, iMin = -1, iMax = -1, yMin = 0, yMax = 0;
    const emit = (i) => {
      const xv = x[i], yv = y[i];
      const X = xl ? ax * Math.log10(xv) + bx : ax * xv + bx;
      const Y = yl ? ay * Math.log10(yv) + by : ay * yv + by;
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    };
    const flush = () => {
      if (iF < 0) return;
      const ids = [iF, iMin, iMax, iL].sort((p, q) => p - q);
      let last = -1;
      for (const i of ids) if (i !== last) { emit(i); last = i; }
      iF = -1;
    };
    for (let i = 0; i < x.length; i++) {
      const xv = x[i], yv = y[i];
      const X = xl ? (xv > 0 ? ax * Math.log10(xv) + bx : NaN) : ax * xv + bx;
      const Y = yl ? (yv > 0 ? ay * Math.log10(yv) + by : NaN) : ay * yv + by;
      if (X - X !== 0 || Y - Y !== 0) { flush(); pen = false; col = NaN; continue; }
      const k = Math.floor(X * dpr * _M4_SUB);
      if (k !== col) { flush(); col = k; iF = iL = iMin = iMax = i; yMin = yMax = Y; continue; }
      iL = i;
      if (Y < yMin) { yMin = Y; iMin = i; }
      if (Y > yMax) { yMax = Y; iMax = i; }
    }
    flush();
  }

  _renderScatter(ctx, trace, xScale, yScale, rect) {
    const o = trace.opts;
    const pos = this._positions(trace, xScale, yScale);
    // s is matplotlib's: the marker's AREA in points², default 36 (lines.markersize²). Its
    // diameter is √s points, so the radius in px is √s · dpi / 144.
    const rk = this._dpi / 144;
    const sz = trace.s ? trace.s : (typeof o.s === 'number' ? o.s : 36);
    const radius = typeof sz === 'number' ? Math.sqrt(sz) * rk : sz;   // per-point: resolved in _drawPoints
    const alpha = o.alpha != null ? o.alpha : 1;
    let edge = null;
    if (o.edgecolor != null && o.edgecolor !== 'none') {
      // edge width in points (matplotlib's); 0.5 px when not given
      edge = { color: o.edgecolor === 'face' ? 'face' : _cssColor(o.edgecolor), width: o.linewidth != null ? (o.linewidth * this._dpi) / 72 : 0.5 };
    }
    const spec = { marker: o.marker || 'o', radius, rk, alpha, edge, cacheKey: 'sc' };
    if (trace.cvals) {
      const { vmin, vmax } = this._cmapRange(trace);
      spec.cmap = { name: o.cmap || 'viridis', vmin, vmax };
    } else if (trace.colors) spec.list = trace.colors;
    else spec.uniform = o.color;
    this._drawPoints(ctx, trace, pos, rect, spec);
  }

  // colour-map indices for a trace (0–255, -1 for NaN), cached on (cmap, vmin, vmax)
  _cmapIdx(trace, vmin, vmax) {
    const c = trace._cache || (trace._cache = {});
    const key = `${vmin}|${vmax}`;
    if (c.cidx && c.cidx.key === key) return c.cidx.idx;
    const v = trace.cvals, n = v.length, idx = new Int16Array(n);
    const k = vmax !== vmin ? 256 / (vmax - vmin) : 0;
    for (let i = 0; i < n; i++) {
      const val = v[i];
      if (val !== val) { idx[i] = -1; continue; }
      let q = k ? ((val - vmin) * k) | 0 : 128;
      idx[i] = q < 0 ? 0 : q > 255 ? 255 : q;
    }
    c.cidx = { key, idx };
    return idx;
  }

  // Draw a set of markers: vector paths for a few, one raster for many (see the header).
  //   spec: { marker, radius (px or per-point s column), alpha, edge, uniform | cmap | list, cacheKey }
  _drawPoints(ctx, trace, pos, rect, spec) {
    const n = pos.X.length;
    if (!n) return;
    const perPoint = typeof spec.radius !== 'number';
    // resolve the colour source into bytes, if it can be rasterized at all
    let lut = null, idx = null, uni = null, bytes = null, cmapFn = null;
    if (spec.cmap) {
      cmapFn = getCmap(spec.cmap.name);
      lut = _cmapLut(spec.cmap.name);
    } else if (spec.list) {
      const c = trace._cache || (trace._cache = {});
      if (c.listBytes === undefined) {
        const b = new Uint8ClampedArray(n * 4);
        let ok = true;
        for (let i = 0; i < n && ok; i++) { const v = _colorBytes(spec.list[i]); if (!v) ok = false; else b.set(v, i * 4); }
        c.listBytes = ok ? b : null;
      }
      bytes = c.listBytes;
    } else uni = _colorBytes(spec.uniform);
    const rasterizable = (spec.cmap ? !!lut : spec.list ? !!bytes : !!uni) && (!spec.edge || spec.edge.color === 'face' || !!_colorBytes(spec.edge.color));
    if (n > _engine.rasterMin && rasterizable && this._rasterPoints(ctx, trace, pos, rect, spec, { lut, uni, bytes })) return;

    // ── vector ──
    if (spec.cmap) idx = this._cmapIdx(trace, spec.cmap.vmin, spec.cmap.vmax);
    const alpha = spec.alpha;
    const fillOf = (i) => spec.cmap ? (lut ? null : cmapFn(idx[i] < 0 ? NaN : (idx[i] + 0.5) / 256)) : spec.list ? spec.list[i] : spec.uniform;
    const rOf = (i) => (perPoint ? Math.sqrt(spec.radius[i]) * spec.rk : spec.radius);
    const X = pos.X, Y = pos.Y;
    if (_engine.batch && alpha >= 1 && !spec.edge && !perPoint) {
      // batch: one path per colour (colour-mapped points group into ≤ 256 LUT colours; within
      // a colour, overlap order is data order, across colours it is colour order)
      const shape = _markerShape(spec.marker, spec.radius);
      const stroke = shape.kind === 'strokes';
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        if (X[i] !== X[i]) continue;
        let key;
        if (spec.cmap) { if (idx[i] < 0) continue; key = idx[i]; } else key = spec.list ? spec.list[i] : 0;
        let g = groups.get(key); if (!g) groups.set(key, (g = [])); g.push(i);
      }
      const keys = spec.cmap ? Array.from(groups.keys()).sort((a, b) => a - b) : Array.from(groups.keys());
      for (const k of keys) {
        const color = spec.cmap ? (lut ? `rgb(${lut[k * 4]},${lut[k * 4 + 1]},${lut[k * 4 + 2]})` : cmapFn((k + 0.5) / 256)) : spec.list ? k : spec.uniform;
        ctx.beginPath();
        for (const i of groups.get(k)) _pathMarker(ctx, shape, X[i], Y[i]);
        if (stroke) { ctx.strokeStyle = color; ctx.lineWidth = shape.lw; ctx.stroke(); }
        else { ctx.fillStyle = color; ctx.fill(); }
      }
      return;
    }
    // per point: alpha < 1 or an edge — each marker composites over the last, as matplotlib's do
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      if (X[i] !== X[i]) continue;
      if (spec.cmap && idx[i] < 0) continue;
      const shape = _markerShape(spec.marker, rOf(i));
      let fill = fillOf(i);
      if (fill == null) fill = `rgb(${lut[idx[i] * 4]},${lut[idx[i] * 4 + 1]},${lut[idx[i] * 4 + 2]})`;
      ctx.beginPath();
      _pathMarker(ctx, shape, X[i], Y[i]);
      if (shape.kind === 'strokes') { ctx.strokeStyle = fill; ctx.lineWidth = shape.lw; ctx.stroke(); continue; }
      ctx.fillStyle = fill;
      ctx.fill();
      if (spec.edge) {
        ctx.strokeStyle = spec.edge.color === 'face' ? fill : spec.edge.color;
        ctx.lineWidth = spec.edge.width;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // the raster path for many points; false if this host can't blit (caller draws vectors)
  _rasterPoints(ctx, trace, pos, rect, spec, col) {
    const dpr = rect.dpr;
    const W = Math.max(1, Math.round(rect.w * dpr)), H = Math.max(1, Math.round(rect.h * dpr));
    const c = trace._cache || (trace._cache = {});
    const holderKey = 'raster_' + spec.cacheKey;
    const key = `${pos.key}|${W}x${H}|${dpr}|${spec.cmap ? spec.cmap.vmin + ',' + spec.cmap.vmax + ',' + spec.cmap.name : ''}|${spec.alpha}`;
    let h = c[holderKey];
    if (!h || h.key !== key) {
      const n = pos.X.length;
      let rad;
      if (typeof spec.radius === 'number') rad = spec.radius * dpr;
      else { rad = new Float32Array(n); for (let i = 0; i < n; i++) rad[i] = Math.sqrt(spec.radius[i]) * spec.rk * dpr; }
      let colors;
      if (col.lut) {
        // the same LUT entry _cmapIdx gives: ((v - vmin) · 256 / (vmax - vmin)), and the
        // middle entry when vmin = vmax
        const { vmin, vmax } = spec.cmap;
        colors = vmax !== vmin ? { lut: col.lut, vals: trace.cvals, vmin, vk: 256 / (vmax - vmin) } : { lut: col.lut, vals: trace.cvals, vmin: vmin - 0.5, vk: 256 };
      } else colors = col.bytes ? { bytes: col.bytes } : { uniform: col.uni };
      const edge = spec.edge ? { bytes: spec.edge.color === 'face' ? 'face' : _colorBytes(spec.edge.color), width: spec.edge.width * dpr } : null;
      const rgba = _rasterPoints(W, H, pos.X, pos.Y, rect.x, rect.y, dpr, rad, spec.marker, colors, spec.alpha, edge);
      h = c[holderKey] = { key, rgba, W, H };
    }
    return _blit(ctx, rect.x, rect.y, rect.w, rect.h, h.W, h.H, h.rgba, h, false);
  }

  _renderBar(ctx, trace, xScale, yScale) {
    const { x, heights, opts } = trace;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    ctx.globalAlpha = alpha;
    const py0 = yScale.transform(0);
    for (let i = 0; i < x.length; i++) {
      const bw = _isArrayLike(opts.width) ? opts.width[i] : (opts.width || 0.8);
      const xv = x[i], hv = heights[i];
      if (xv - xv !== 0 || hv - hv !== 0) continue;
      const px = xScale.transform(xv - bw / 2);
      const pw = xScale.transform(xv + bw / 2) - px;
      const py = yScale.transform(hv);
      ctx.fillStyle = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color;
      ctx.fillRect(px, py, pw, py0 - py);
      if (opts.edgecolor) {
        ctx.strokeStyle = _cssColor(opts.edgecolor);
        ctx.lineWidth = opts.linewidth || 1;
        ctx.strokeRect(px, py, pw, py0 - py);
      }
    }
    ctx.globalAlpha = 1;
  }

  _renderBarh(ctx, trace, xScale, yScale) {
    const { y, widths, opts } = trace;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    ctx.globalAlpha = alpha;
    const px0 = xScale.transform(0);
    for (let i = 0; i < y.length; i++) {
      const bh = _isArrayLike(opts.height) ? opts.height[i] : (opts.height || 0.8);
      const yv = y[i], wv = widths[i];
      if (yv - yv !== 0 || wv - wv !== 0) continue;
      const py = yScale.transform(yv + bh / 2);
      const ph = yScale.transform(yv - bh / 2) - py;
      const px = xScale.transform(wv);
      ctx.fillStyle = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color;
      ctx.fillRect(px0, py, px - px0, ph);
      if (opts.edgecolor) {
        ctx.strokeStyle = _cssColor(opts.edgecolor);
        ctx.lineWidth = opts.linewidth || 1;
        ctx.strokeRect(px0, py, px - px0, ph);
      }
    }
    ctx.globalAlpha = 1;
  }

  _renderHist(ctx, trace, xScale, yScale) {
    const { edges, counts } = this._hist(trace);
    const alpha = trace.opts.alpha != null ? trace.opts.alpha : 0.8;
    ctx.fillStyle = trace.opts.color;
    ctx.globalAlpha = alpha;
    const py0 = yScale.transform(yScale.log ? yScale.domain[0] : 0);
    for (let i = 0; i < counts.length; i++) {
      if (!(counts[i] > 0) && yScale.log) continue;
      const px0 = xScale.transform(edges[i]);
      const px1 = xScale.transform(edges[i + 1]);
      const py = yScale.transform(counts[i]);
      ctx.fillRect(px0, py, px1 - px0, py0 - py);
      if (trace.opts.edgecolor) {
        ctx.strokeStyle = _cssColor(trace.opts.edgecolor);
        ctx.lineWidth = trace.opts.linewidth || 1;
        ctx.strokeRect(px0, py, px1 - px0, py0 - py);
      }
    }
    ctx.globalAlpha = 1;
  }

  // An image is ONE RGBA buffer (built with the colour map's LUT, cached on the trace until
  // vmin / vmax / cmap / origin change), blitted into its extent: one drawImage live, one
  // 'image' op recorded. NaN and nodata cells are transparent.
  _renderImshow(ctx, trace, xScale, yScale) {
    const { data, nx, ny, opts } = trace;
    const nodata = opts.nodata;
    const origin = opts.origin || 'lower';
    const cmapName = opts.cmap || 'viridis';
    const { vmin, vmax } = this._cmapRange(trace);
    const c = trace._cache || (trace._cache = {});
    const key = `${vmin}|${vmax}|${origin}|${nodata}`;
    let img = c.img;
    if (!img || img.key !== key || img.cmap !== cmapName) {
      const rgba = new Uint8ClampedArray(nx * ny * 4);
      const lut = _cmapLut(cmapName), fn = lut ? null : getCmap(cmapName);
      const vr = vmax - vmin, k = vr ? 256 / vr : 0;
      for (let iy = 0; iy < ny; iy++) {
        // image row 0 is the TOP: origin='lower' puts data row ny-1 there
        const row = origin === 'lower' ? ny - 1 - iy : iy;
        for (let ix = 0; ix < nx; ix++) {
          const v = data[iy * nx + ix];
          if (v - v !== 0 || (nodata != null && v === nodata)) continue;   // transparent
          const o = (row * nx + ix) * 4;
          if (lut) {
            let q = k ? ((v - vmin) * k) | 0 : 128;
            q = (q < 0 ? 0 : q > 255 ? 255 : q) * 4;
            rgba[o] = lut[q]; rgba[o + 1] = lut[q + 1]; rgba[o + 2] = lut[q + 2]; rgba[o + 3] = lut[q + 3];
          } else {
            const b = _colorBytes(fn(vr ? (v - vmin) / vr : 0.5));
            if (b) { rgba[o] = b[0]; rgba[o + 1] = b[1]; rgba[o + 2] = b[2]; rgba[o + 3] = b[3]; }
          }
        }
      }
      img = c.img = { key, cmap: cmapName, rgba };
    }
    const e = this._imshowExtent(trace);
    const x0 = xScale.transform(e[0]), x1 = xScale.transform(e[1]);
    const yA = yScale.transform(e[2]), yB = yScale.transform(e[3]);
    const smooth = opts.interpolation === 'bilinear' || opts.interpolation === 'antialiased';
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    const ok = _blit(ctx, Math.min(x0, x1), Math.min(yA, yB), Math.abs(x1 - x0), Math.abs(yB - yA), nx, ny, img.rgba, img, smooth);
    if (!ok) this._imshowCells(ctx, img.rgba, nx, ny, x0, x1, yA, yB);
    ctx.globalAlpha = 1;
  }

  // last resort for a context that can't take an image: one fillRect per cell
  _imshowCells(ctx, rgba, nx, ny, x0, x1, yA, yB) {
    const left = Math.min(x0, x1), top = Math.min(yA, yB);
    const cw = Math.abs(x1 - x0) / nx, ch = Math.abs(yB - yA) / ny;
    for (let r = 0; r < ny; r++) for (let q = 0; q < nx; q++) {
      const o = (r * nx + q) * 4;
      if (!rgba[o + 3]) continue;
      ctx.fillStyle = `rgba(${rgba[o]},${rgba[o + 1]},${rgba[o + 2]},${rgba[o + 3] / 255})`;
      ctx.fillRect(left + q * cw, top + r * ch, cw + 0.5, ch + 0.5);
    }
  }

  _renderHline(ctx, trace, xScale, yScale, plotX, plotW) {
    const py = yScale.transform(trace.y);
    if (py - py !== 0) return;
    ctx.globalAlpha = trace.opts.alpha != null ? trace.opts.alpha : 1;
    ctx.strokeStyle = trace.opts.color || this._theme.muted;
    ctx.lineWidth = trace.opts.linewidth || 1;
    ctx.setLineDash(dashArray(trace.opts.linestyle));
    ctx.beginPath(); ctx.moveTo(plotX, py); ctx.lineTo(plotX + plotW, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _renderVline(ctx, trace, xScale, yScale, plotY, plotH) {
    const px = xScale.transform(trace.x);
    if (px - px !== 0) return;
    ctx.globalAlpha = trace.opts.alpha != null ? trace.opts.alpha : 1;
    ctx.strokeStyle = trace.opts.color || this._theme.muted;
    ctx.lineWidth = trace.opts.linewidth || 1;
    ctx.setLineDash(dashArray(trace.opts.linestyle));
    ctx.beginPath(); ctx.moveTo(px, plotY); ctx.lineTo(px, plotY + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // text(x, y, s): x, y in data coordinates, or with {transform: 'axes'} (matplotlib's
  // ax.transAxes) as fractions of the axes, 0–1 from the lower left
  _renderText(ctx, trace, xScale, yScale, rect) {
    const o = trace.opts, axes = o.transform === 'axes' || o.transform === 'transAxes';
    const px = axes ? rect.x + trace.x * rect.w : xScale.transform(trace.x);
    const py = axes ? rect.y + (1 - trace.y) * rect.h : yScale.transform(trace.y);
    if (px - px !== 0 || py - py !== 0) return;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color || this._textColor || this._theme.foreground;
    const fsz = o.fontsize != null ? (typeof o.fontsize === 'number' ? o.fontsize : _FONTSIZES[o.fontsize] ?? 0) : null;
    ctx.font = `${o.fontweight === 'bold' ? 'bold ' : ''}${fsz != null ? (typeof o.fontsize === 'number' ? fsz : (this._theme.font_size || 11) + fsz) : (this._theme.font_size || 11)}px ${this._theme.mono}`;
    ctx.textAlign = { center: 'center', left: 'left', right: 'right' }[o.ha] || 'left';
    ctx.textBaseline = { center: 'middle', baseline: 'alphabetic', top: 'top', bottom: 'bottom' }[o.va] || 'alphabetic';
    ctx.translate(px, py);
    if (o.rotation) ctx.rotate((-(o.rotation === 'vertical' ? 90 : +o.rotation || 0) * Math.PI) / 180);
    ctx.fillText(String(trace.text), 0, 0);
    ctx.restore();
  }

  _renderLegend(ctx, plotX, plotY, plotW, plotH) {
    const th = this._theme;
    const entries = [];
    for (const t of this._traces) {
      if (!t.opts.label) continue;
      let color = t.opts.color;
      if (!color && t.cvals) color = getCmap(t.opts.cmap || 'viridis')(0.5);
      if (!color && t.colors) color = t.colors[0];
      entries.push({ label: String(t.opts.label), color: color || th.cycle[0], type: t.type, marker: t.opts.marker, noLine: _noLine(t.opts.linestyle) });
    }
    if (!entries.length) return;

    ctx.font = _font(th, -1);
    const lineH = (th.font_size || 11) + 4;
    const padding = 6;
    let maxW = 0;
    for (const e of entries) {
      const w = _textW(ctx.font, e.label);
      if (w > maxW) maxW = w;
    }
    const boxW = maxW + 24 + padding * 2;
    const boxH = entries.length * lineH + padding * 2;

    // position: default top-right. matplotlib's numeric codes map to the names; 'best'
    // (code 0) is upper right until placement that avoids the data lands.
    const _LOC = ['upper right', 'upper right', 'upper left', 'lower left', 'lower right', 'right', 'center left', 'center right', 'lower center', 'upper center', 'center'];
    let loc = this._legendOpts.loc ?? 'upper right';
    if (typeof loc === 'number') loc = _LOC[loc] || 'upper right';
    loc = String(loc);
    if (loc === 'best') loc = 'upper right';
    let lx, ly;
    if (loc.includes('right')) lx = plotX + plotW - boxW - 6;
    else if (loc.includes('left')) lx = plotX + 6;
    else lx = plotX + (plotW - boxW) / 2;
    if (loc.includes('upper') || loc.includes('top')) ly = plotY + 6;
    else if (loc.includes('lower') || loc.includes('bottom')) ly = plotY + plotH - boxH - 6;
    else ly = plotY + (plotH - boxH) / 2;

    ctx.fillStyle = th.panel;
    ctx.fillRect(lx, ly, boxW, boxH);
    ctx.strokeStyle = th.panel_border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, ly, boxW, boxH);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ey = ly + padding + i * lineH + lineH / 2;
      ctx.fillStyle = e.color;
      if (e.type === 'scatter' || (e.type === 'line' && e.marker && e.noLine)) {
        ctx.beginPath(); _pathMarker(ctx, _markerShape(e.marker || 'o', 3), lx + padding + 7, ey);
        if (e.marker === '+' || e.marker === 'x') { ctx.strokeStyle = e.color; ctx.lineWidth = 1.5; ctx.stroke(); } else ctx.fill();
      } else {
        ctx.fillRect(lx + padding, ey - 1, 14, 2);
      }
      ctx.fillStyle = this._textColor || th.foreground;
      ctx.fillText(e.label, lx + padding + 18, ey);
    }
  }

  // ── picking ───────────────────────────────────────────────────────────────────────────────
  // ax.pick(px, py, {radius}) → the nearest thing drawn under (px, py), in CSS px of the
  // figure, after a render. Markers win over line vertices, which win over bars (picked by
  // column), which win over image cells. Searches this axes' traces and its twins'.
  //   → { axes, trace, traceIndex, kind, index, x, y, c, s, label, value } | null
  pick(px, py, opts) {
    const radius = (opts && opts.radius != null) ? opts.radius : 8;
    this._needView('pick');
    const owners = [this, this._twin, this._twinY].filter((a) => a && a.view);
    const best = { marker: null, vertex: null };
    for (const ax of owners) {
      const v = ax.view;
      ax._traces.forEach((t, ti) => {
        const isMarker = t.type === 'scatter' || (t.type === 'line' && t.opts.marker);
        if (t.type !== 'scatter' && t.type !== 'line') return;
        const pos = ax._positions(t, v.xScale, v.yScale);
        if (!pos.grid) pos.grid = _buildGrid(pos.X, pos.Y, v.x, v.y, v.w, v.h, 32);
        const hit = _queryGrid(pos.grid, px, py, radius);
        if (!hit) return;
        const slot = isMarker ? 'marker' : 'vertex';
        if (!best[slot] || hit.d <= best[slot].d) best[slot] = { ax, t, ti, i: hit.index, d: hit.d };
      });
    }
    const pt = best.marker || best.vertex;
    if (pt) {
      const t = pt.t, i = pt.i;
      return {
        axes: pt.ax, trace: t, traceIndex: pt.ti, kind: t.type === 'scatter' ? 'marker' : best.marker ? 'marker' : 'vertex', index: i,
        x: t.x[i], y: t.y[i],
        c: t.cvals ? t.cvals[i] : t.colors ? t.colors[i] : (t.opts.color ?? null),
        s: t.s ? t.s[i] : (typeof t.opts.s === 'number' ? t.opts.s : null),
        label: t.opts.label ?? null,
      };
    }
    // bars and histogram bins, by column (the last drawn wins: it is on top)
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      if (px < v.x || px > v.x + v.w || py < v.y || py > v.y + v.h) continue;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti];
        if (t.type === 'bar') {
          for (let i = t.x.length - 1; i >= 0; i--) {
            const bw = _isArrayLike(t.opts.width) ? t.opts.width[i] : (t.opts.width || 0.8);
            const a = v.xScale.transform(t.x[i] - bw / 2), b = v.xScale.transform(t.x[i] + bw / 2);
            if (px >= Math.min(a, b) && px <= Math.max(a, b)) return { axes: ax, trace: t, traceIndex: ti, kind: 'bar', index: i, x: t.x[i], y: t.heights[i], c: null, s: null, label: t.opts.label ?? null };
          }
        } else if (t.type === 'barh') {
          for (let i = t.y.length - 1; i >= 0; i--) {
            const bh = _isArrayLike(t.opts.height) ? t.opts.height[i] : (t.opts.height || 0.8);
            const a = v.yScale.transform(t.y[i] - bh / 2), b = v.yScale.transform(t.y[i] + bh / 2);
            if (py >= Math.min(a, b) && py <= Math.max(a, b)) return { axes: ax, trace: t, traceIndex: ti, kind: 'bar', index: i, x: t.widths[i], y: t.y[i], c: null, s: null, label: t.opts.label ?? null };
          }
        } else if (t.type === 'hist') {
          const { edges, counts } = ax._hist(t);
          const xv = v.xScale.inverse(px);
          for (let i = 0; i < counts.length; i++) {
            if (xv >= edges[i] && xv <= edges[i + 1]) return { axes: ax, trace: t, traceIndex: ti, kind: 'bin', index: i, x: (edges[i] + edges[i + 1]) / 2, y: counts[i], edges: [edges[i], edges[i + 1]], c: null, s: null, label: t.opts.label ?? null };
          }
        }
      }
    }
    // image cells
    for (const ax of owners.slice().reverse()) {
      const v = ax.view;
      for (let ti = ax._traces.length - 1; ti >= 0; ti--) {
        const t = ax._traces[ti];
        if (t.type !== 'imshow') continue;
        const e = ax._imshowExtent(t);
        const xv = v.xScale.inverse(px), yv = v.yScale.inverse(py);
        const fx = (xv - e[0]) / (e[1] - e[0]), fy = (yv - e[2]) / (e[3] - e[2]);
        if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) continue;
        const col = Math.floor(fx * t.nx);
        // data row: origin 'lower' puts row 0 at the extent's y0
        const up = Math.floor(fy * t.ny);
        const row = (t.opts.origin || 'lower') === 'lower' ? up : t.ny - 1 - up;
        const index = row * t.nx + col;
        const cx = e[0] + ((col + 0.5) / t.nx) * (e[1] - e[0]), cy = e[2] + ((up + 0.5) / t.ny) * (e[3] - e[2]);
        return { axes: ax, trace: t, traceIndex: ti, kind: 'cell', index, col, row, x: cx, y: cy, value: t.data[index], c: null, s: null, label: t.opts.label ?? null };
      }
    }
    return null;
  }
}

// The common histogram, in its own function so the engine optimizes this loop alone: uniform
// bins, no weights, integer counts. numpy's correction (a value that rounds into the
// neighbouring bin is moved back) is only needed within a hair of an edge, so the edges are
// read only there.
// (The hot path never reassigns b — engines keep it a small integer then — and counts into
// nb + 1 slots, so v = hi needs no branch: slot nb folds into the last bin at the end.)
function _countUniform(data, lo, hi, nb, E) {
  const ic = new Uint32Array(nb + 1), k = nb / (hi - lo), len = data.length;
  for (let i = 0; i < len; i++) {
    const v = data[i];
    if (!(v >= lo && v <= hi)) continue;                     // NaN fails both
    const f = (v - lo) * k;
    const b = f | 0;
    const frac = f - b;
    if (frac < 1e-6 || frac > 0.999999) { ic[_binExact(v, b, nb, E)]++; continue; }
    ic[b]++;
  }
  ic[nb - 1] += ic[nb];
  return ic.subarray(0, nb);
}

// the bin of v by the real edges, from a guess b that may be one off (numpy's correction)
function _binExact(v, b, nb, E) {
  if (b >= nb) b = nb - 1;
  if (v < E[b]) b--;
  else if (b < nb - 1 && v >= E[b + 1]) b++;
  return b;
}

// Log scale needs strictly-positive bounds; clamp lo (falling back to hi/1e6 or 1e-9).
function _logBounds(lo, hi) {
  let l = lo, h = hi;
  if (!(l > 0)) l = h > 0 ? h / 1e6 : 1e-9;
  if (!(h > l)) h = l * 10;
  return [l, h];
}
