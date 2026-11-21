// The common marks: fill_between / fill_betweenx, step (and plot's drawstyle), errorbar,
// axhspan / axvspan, annotate, and axhline / axvline's axes-fraction ends. Each registers a
// trace kind (axes.js _KINDS) for its autoscale and its drawing, so axes.js stays the core.

import { Axes, _KINDS, _hooks, _plainOpts, _lenErr, _result } from './axes.js';
import { _col, _isArrayLike, _traceRange } from './data.js';
import { _cssColor } from './color.js';
import { parseFormat, dashArray } from './format.js';
import { _warn } from './opts.js';
import { _font } from './style.js';

// ── fill_between(x, y1, y2 = 0, {where, step, interpolate, color | facecolor, edgecolor,
// linewidth, alpha, label}) — the band between two curves; fill_betweenx(y, x1, x2 = 0) is
// the same turned on its side. NaN or a false `where` splits the band into pieces. ──
function _fillBetween(ax, fn, horiz, t, a, b, opts) {
  const o = ax._opts(fn, opts);
  const T = ax._axisCol(horiz ? 'y' : 'x', t), n = T.length;
  const col = (v, name) => {
    if (v == null) return new Float64Array(n);
    if (!_isArrayLike(v)) return new Float64Array(n).fill(+v);
    const c = _col(v);
    if (c.length !== n) throw _lenErr(fn, name, c.length, horiz ? 'y' : 'x', n);
    return c;
  };
  const A = col(a, horiz ? 'x1' : 'y1'), B = col(b, horiz ? 'x2' : 'y2');
  let where = null;
  if (o.where != null) { where = Array.from(o.where, Boolean); if (where.length !== n) throw _lenErr(fn, 'where', where.length, horiz ? 'y' : 'x', n); }
  if (o.facecolor) o.color = _cssColor(o.facecolor);
  if (!o.color) o.color = ax._nextColor();
  if (o.step != null && !['pre', 'post', 'mid'].includes(o.step)) _warn(`${fn}.step.${o.step}`, `${fn}(): step must be 'pre', 'post' or 'mid'`, ax._strict);
  const trace = { type: 'fill_between', t: T, a: A, b: B, where, horiz, opts: o };
  ax._traces.push(trace);
  return _result(ax, [], { _trace: trace });
}
Axes.prototype.fill_between = function (x, y1, y2, opts) {
  if (_plainOpts(y2)) { opts = y2; y2 = opts.y2; }
  return _fillBetween(this, 'fill_between', false, x, y1, y2 == null ? 0 : y2, opts);
};
Axes.prototype.fill_betweenx = function (y, x1, x2, opts) {
  if (_plainOpts(x2)) { opts = x2; x2 = opts.x2; }
  return _fillBetween(this, 'fill_betweenx', true, y, x1, x2 == null ? 0 : x2, opts);
};

// the vertices of a stepped curve (matplotlib's drawstyle steps-pre / -post / -mid)
function _stepped(T, V, where) {
  const n = T.length;
  if (n < 2) return [Float64Array.from(T), Float64Array.from(V)];
  if (where === 'mid') {
    const t = new Float64Array(2 * n), v = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const l = i === 0 ? T[0] : (T[i - 1] + T[i]) / 2, r = i === n - 1 ? T[n - 1] : (T[i] + T[i + 1]) / 2;
      t[2 * i] = l; t[2 * i + 1] = r; v[2 * i] = V[i]; v[2 * i + 1] = V[i];
    }
    return [t, v];
  }
  const t = new Float64Array(2 * n - 1), v = new Float64Array(2 * n - 1);
  t[0] = T[0]; v[0] = V[0];
  for (let i = 1; i < n; i++) {
    // pre: jump at the start of each interval (x[i-1] → x[i] at y[i]); post: at its end
    t[2 * i - 1] = where === 'post' ? T[i] : T[i - 1]; v[2 * i - 1] = where === 'post' ? V[i - 1] : V[i];
    t[2 * i] = T[i]; v[2 * i] = V[i];
  }
  return [t, v];
}

_KINDS.fill_between = {
  z: 1, patch: true,
  extent(ax, tr, axis, log, take) {
    const own = tr.horiz ? axis === 'y' : axis === 'x';
    const r = own ? [_traceRange(tr, 't', tr.t, log)] : [_traceRange(tr, 'a', tr.a, log), _traceRange(tr, 'b', tr.b, log)];
    for (const q of r) if (q.n) { take(log ? q.minPos : q.lo); take(q.hi); }
  },
  render(ax, ctx, tr, xScale, yScale) {
    const o = tr.opts, n = tr.t.length;
    const P = (t, v) => (tr.horiz ? [xScale.transform(v), yScale.transform(t)] : [xScale.transform(t), yScale.transform(v)]);
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color;
    ctx.beginPath();
    // each run of drawable points (finite, `where` true) is one closed piece
    let i = 0;
    while (i < n) {
      const ok = (k) => (!tr.where || tr.where[k]) && tr.t[k] - tr.t[k] === 0 && tr.a[k] - tr.a[k] === 0 && tr.b[k] - tr.b[k] === 0;
      if (!ok(i)) { i++; continue; }
      let j = i;
      while (j + 1 < n && ok(j + 1)) j++;
      let T = tr.t.subarray(i, j + 1), A = tr.a.subarray(i, j + 1), B = tr.b.subarray(i, j + 1);
      if (o.step) { const s1 = _stepped(T, A, o.step), s2 = _stepped(T, B, o.step); T = s1[0]; A = s1[1]; B = s2[1]; }
      let [x, y] = P(T[0], A[0]);
      ctx.moveTo(x, y);
      for (let k = 1; k < T.length; k++) { [x, y] = P(T[k], A[k]); ctx.lineTo(x, y); }
      for (let k = T.length - 1; k >= 0; k--) { [x, y] = P(T[k], B[k]); ctx.lineTo(x, y); }
      ctx.closePath();
      i = j + 1;
    }
    ctx.fill();
    if (o.edgecolor && o.edgecolor !== 'none') { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.stroke(); }
    ctx.restore();
  },
};

// ── step(x, y, fmt?, {where = 'pre'}) — and plot(…, {drawstyle: 'steps-post'}) ──
Axes.prototype.step = function (x, y, fmtOrOpts, opts) {
  if (!_isArrayLike(y)) { opts = fmtOrOpts; fmtOrOpts = y; y = x; x = undefined; }
  let fmt = typeof fmtOrOpts === 'string' ? fmtOrOpts : null;
  if (_plainOpts(fmtOrOpts)) opts = fmtOrOpts;
  const o = _plainOpts(opts) ? { ...opts } : {};
  const where = o.where || 'pre';
  delete o.where;
  if (!['pre', 'post', 'mid'].includes(where)) _warn('step.where.' + where, `step(): where must be 'pre', 'post' or 'mid', not '${where}'`, this._strict);
  o.drawstyle = `steps-${where}`;
  return fmt ? this.plot(x === undefined ? _col(y).map((_, i) => i) : x, y, fmt, o) : this.plot(x === undefined ? _col(y).map((_, i) => i) : x, y, o);
};
// plot's drawstyle: the line's vertices are replaced by the stepped ones at ingress
export function _applyDrawstyle(ax, trace) {
  const ds = trace.opts.drawstyle;
  if (!ds || ds === 'default') { delete trace.opts.drawstyle; return; }
  const m = /^steps(?:-(pre|post|mid))?$/.exec(ds);
  if (!m) { _warn('plot.drawstyle.' + ds, `plot(): drawstyle '${ds}' is not supported; use 'default', 'steps-pre', 'steps-mid' or 'steps-post'`, ax._strict); delete trace.opts.drawstyle; return; }
  const [t, v] = _stepped(trace.x, trace.y, m[1] || 'pre');
  trace.x = t; trace.y = v;
}

// ── errorbar(x, y, {yerr, xerr, fmt = '', ecolor, elinewidth, capsize = 0, capthick,
// barsabove, label, …line options}) → [line, caps, bars] with .lines. yerr / xerr: a number,
// one per point, or [lower, upper] (two arrays, or two numbers). ──
function _errCols(v, n, name) {
  if (v == null) return null;
  if (!_isArrayLike(v)) { const c = new Float64Array(n).fill(Math.abs(+v)); return [c, c]; }
  if (v.length === 2 && (_isArrayLike(v[0]) || _isArrayLike(v[1])) && n !== 2) {
    const lo = _isArrayLike(v[0]) ? _col(v[0]) : new Float64Array(n).fill(+v[0]);
    const hi = _isArrayLike(v[1]) ? _col(v[1]) : new Float64Array(n).fill(+v[1]);
    if (lo.length !== n || hi.length !== n) throw new Error(`plot: errorbar: ${name} as [lower, upper] needs ${n} values in each`);
    return [lo, hi];
  }
  if (v.length === 2 && _isArrayLike(v[0]) && n === 2) return [_col(v[0]), _col(v[1])];
  const c = _col(v);
  if (c.length !== n) throw _lenErr('errorbar', name, c.length, 'x', n);
  return [c, c];
}
Axes.prototype.errorbar = function (x, y, opts) {
  const o0 = _plainOpts(opts) ? { ...opts } : {};
  const X = this._axisCol('x', x), Y = this._axisCol('y', y), n = X.length;
  if (Y.length !== n) throw _lenErr('errorbar', 'x', n, 'y', Y.length);
  const yerr = _errCols(o0.yerr, n, 'yerr'), xerr = _errCols(o0.xerr, n, 'xerr');
  const fmt = o0.fmt == null ? '' : o0.fmt;
  const errOpts = { ecolor: o0.ecolor, elinewidth: o0.elinewidth, capsize: o0.capsize ?? 0, capthick: o0.capthick, barsabove: o0.barsabove, alpha: o0.alpha };
  for (const k of ['yerr', 'xerr', 'fmt', 'ecolor', 'elinewidth', 'capsize', 'capthick', 'barsabove', 'errorevery', 'lolims', 'uplims', 'xlolims', 'xuplims']) delete o0[k];
  // the data line (or markers): an ordinary plot trace, so it legends and picks as one;
  // fmt 'none' draws no line, only the bars
  let line = null;
  if (fmt !== 'none') {
    if (fmt) this.plot(X, Y, fmt, o0); else this.plot(X, Y, o0);
    line = this._traces[this._traces.length - 1];
  }
  const color = _cssColor(errOpts.ecolor) || (line ? line.opts.color : _cssColor(o0.color) || this._nextColor());
  const tr = { type: 'errorbar', x: X, y: Y, yerr, xerr, color, opts: { ...errOpts, zorder: o0.zorder } };
  this._traces.push(tr);
  return _result(this, [line, [], []], { lines: [line, [], []], _trace: tr });
};
_KINDS.errorbar = {
  z: 2,
  extent(ax, tr, axis, log, take) {
    const P = axis === 'x' ? tr.x : tr.y, E = axis === 'x' ? tr.xerr : tr.yerr;
    for (let i = 0; i < P.length; i++) { const v = P[i]; take(E ? v - E[0][i] : v); take(E ? v + E[1][i] : v); }
  },
  render(ax, ctx, tr, xScale, yScale) {
    const o = tr.opts;
    const cap = ((o.capsize || 0) * ax._dpi) / 72 / 2;       // capsize is the cap's full length in points
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.strokeStyle = tr.color;
    ctx.lineWidth = o.elinewidth != null ? (o.elinewidth * ax._dpi) / 72 : 1.5 * ax._dpi / 72;
    ctx.beginPath();
    for (let i = 0; i < tr.x.length; i++) {
      const xv = tr.x[i], yv = tr.y[i];
      if (xv - xv !== 0 || yv - yv !== 0) continue;
      const px = xScale.transform(xv), py = yScale.transform(yv);
      if (tr.yerr) {
        const a = yScale.transform(yv - tr.yerr[0][i]), b = yScale.transform(yv + tr.yerr[1][i]);
        if (a - a === 0 && b - b === 0) {
          ctx.moveTo(px, a); ctx.lineTo(px, b);
          if (cap) { ctx.moveTo(px - cap, a); ctx.lineTo(px + cap, a); ctx.moveTo(px - cap, b); ctx.lineTo(px + cap, b); }
        }
      }
      if (tr.xerr) {
        const a = xScale.transform(xv - tr.xerr[0][i]), b = xScale.transform(xv + tr.xerr[1][i]);
        if (a - a === 0 && b - b === 0) {
          ctx.moveTo(a, py); ctx.lineTo(b, py);
          if (cap) { ctx.moveTo(a, py - cap); ctx.lineTo(a, py + cap); ctx.moveTo(b, py - cap); ctx.lineTo(b, py + cap); }
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  },
};

// ── axhspan(ymin, ymax, {xmin = 0, xmax = 1}) / axvspan(xmin, xmax, {ymin = 0, ymax = 1}):
// a band across the axes, its other extent a fraction of the axes ──
function _span(ax, fn, horiz, lo, hi, opts) {
  const o = ax._opts(fn, opts);
  if (o.facecolor) o.color = _cssColor(o.facecolor);
  if (!o.color) o.color = ax._theme.cycle[0];
  const tr = { type: 'span', horiz, lo: +lo, hi: +hi, f0: horiz ? (o.xmin ?? 0) : (o.ymin ?? 0), f1: horiz ? (o.xmax ?? 1) : (o.ymax ?? 1), opts: o };
  ax._traces.push(tr);
  return _result(ax, [], { _trace: tr });
}
Axes.prototype.axhspan = function (ymin, ymax, opts) { return _span(this, 'axhspan', true, ymin, ymax, opts); };
Axes.prototype.axvspan = function (xmin, xmax, opts) { return _span(this, 'axvspan', false, xmin, xmax, opts); };
_KINDS.span = {
  z: 1, patch: true,
  extent(ax, tr, axis, log, take) { if (tr.horiz ? axis === 'y' : axis === 'x') { take(tr.lo); take(tr.hi); } },
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.fillStyle = o.color;
    let x0, x1, y0, y1;
    if (tr.horiz) { y0 = yScale.transform(tr.lo); y1 = yScale.transform(tr.hi); x0 = rect.x + tr.f0 * rect.w; x1 = rect.x + tr.f1 * rect.w; }
    else { x0 = xScale.transform(tr.lo); x1 = xScale.transform(tr.hi); y0 = rect.y + (1 - tr.f0) * rect.h; y1 = rect.y + (1 - tr.f1) * rect.h; }
    if ([x0, x1, y0, y1].every((v) => v - v === 0)) {
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (o.edgecolor && o.edgecolor !== 'none') { ctx.strokeStyle = _cssColor(o.edgecolor); ctx.lineWidth = o.linewidth || 1; ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
    }
    ctx.restore();
  },
};

// ── annotate(text, xy, {xytext, xycoords = 'data', textcoords, arrowprops, ha, va, fontsize,
// color}) — xycoords / textcoords: 'data', 'axes fraction', 'offset points' (textcoords);
// arrowprops {arrowstyle: '->' | '-|>' | '-' | '<-' | '<->', color, lw, shrink} ──
Axes.prototype.annotate = function (text, xy, opts) {
  if (_plainOpts(xy) && opts == null) { opts = xy; xy = opts.xy; }
  const o = _plainOpts(opts) ? { ...opts } : {};
  for (const k of Object.keys(o)) {
    if (!['xytext', 'xycoords', 'textcoords', 'arrowprops', 'ha', 'va', 'horizontalalignment', 'verticalalignment', 'fontsize', 'color', 'alpha', 'zorder', 'fontweight', 'rotation', '_kw'].includes(k)) _warn('annotate.' + k, `annotate(): '${k}' is not supported`, this._strict);
  }
  const tr = { type: 'annotate', text: String(text), xy: Array.from(xy, Number), opts: o };
  this._traces.push(tr);
  return _result(this, [], { _trace: tr });
};
_KINDS.annotate = {
  z: 3, noclip: true,
  render(ax, ctx, tr, xScale, yScale, rect) {
    const o = tr.opts, th = ax._theme;
    const at = (p, coords) => {
      if (coords === 'axes fraction') return [rect.x + p[0] * rect.w, rect.y + (1 - p[1]) * rect.h];
      if (coords === 'figure pixels') return [p[0], p[1]];
      return [xScale.transform(p[0]), yScale.transform(p[1])];
    };
    const P = at(tr.xy, o.xycoords || 'data');
    let T = P;
    if (o.xytext) {
      const tc = o.textcoords || o.xycoords || 'data';
      if (tc === 'offset points' || tc === 'offset pixels') {
        const k = tc === 'offset points' ? ax._dpi / 72 : 1;
        T = [P[0] + o.xytext[0] * k, P[1] - o.xytext[1] * k];
      } else T = at(o.xytext, tc);
    }
    if (![...P, ...T].every((v) => v - v === 0)) return;
    const color = _cssColor(o.color) || ax._textColor || th.foreground;
    ctx.save();
    if (o.arrowprops && o.xytext) {
      const ap = o.arrowprops, style = ap.arrowstyle || '-|>';
      ctx.strokeStyle = _cssColor(ap.color || ap.facecolor) || color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = ap.lw ?? ap.linewidth ?? 1;
      const dx = P[0] - T[0], dy = P[1] - T[1], L = Math.hypot(dx, dy);
      if (L > 1) {
        const ux = dx / L, uy = dy / L, s0 = 8, s1 = ap.shrink != null ? ap.shrink * L : 2;
        const a = [T[0] + ux * s0, T[1] + uy * s0], b = [P[0] - ux * s1, P[1] - uy * s1];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const head = (q, dir) => {
          const hx = q[0], hy = q[1], h = 8, w = 3.5, bx = hx - dir[0] * h, by = hy - dir[1] * h;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(bx - dir[1] * w, by + dir[0] * w); ctx.lineTo(bx + dir[1] * w, by - dir[0] * w); ctx.closePath();
          if (style.includes('|>')) ctx.fill();
          else { ctx.beginPath(); ctx.moveTo(bx - dir[1] * w, by + dir[0] * w); ctx.lineTo(hx, hy); ctx.lineTo(bx + dir[1] * w, by - dir[0] * w); ctx.stroke(); }
        };
        if (style.endsWith('>')) head(b, [ux, uy]);
        if (style.startsWith('<')) head(a, [-ux, -uy]);
      }
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.font = o.fontsize != null && typeof o.fontsize === 'number' ? `${o.fontweight === 'bold' ? 'bold ' : ''}${o.fontsize}px ${th.mono}` : _font(th, 0, o.fontweight === 'bold');
    const ha = o.ha || o.horizontalalignment, va = o.va || o.verticalalignment;
    ctx.textAlign = { center: 'center', left: 'left', right: 'right' }[ha] || (o.xytext ? 'center' : 'left');
    ctx.textBaseline = { center: 'middle', top: 'top', bottom: 'bottom', baseline: 'alphabetic' }[va] || (o.xytext ? 'middle' : 'alphabetic');
    ctx.fillText(tr.text, T[0], T[1]);
    ctx.restore();
  },
};

// ── axhline / axvline with xmin / xmax (ymin / ymax): their extent across the axes, as a
// fraction of it ──
Axes.prototype.axhline = function (y, opts) {
  const o = this._opts('axhline', opts);
  if (o.linewidth == null) o.linewidth = 1;
  this._traces.push({ type: 'hline', y: y == null ? 0 : +y, opts: o });
  return _result(this, [], {});
};
Axes.prototype.axvline = function (x, opts) {
  const o = this._opts('axvline', opts);
  if (o.linewidth == null) o.linewidth = 1;
  this._traces.push({ type: 'vline', x: x == null ? 0 : +x, opts: o });
  return _result(this, [], {});
};
Axes.prototype._renderHline = function (ctx, trace, xScale, yScale, plotX, plotW) {
  const py = yScale.transform(trace.y);
  if (py - py !== 0) return;
  const o = trace.opts, f0 = o.xmin ?? 0, f1 = o.xmax ?? 1;
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.strokeStyle = o.color || this._theme.muted;
  ctx.lineWidth = o.linewidth || 1;
  ctx.setLineDash(dashArray(o.linestyle));
  ctx.beginPath(); ctx.moveTo(plotX + f0 * plotW, py); ctx.lineTo(plotX + f1 * plotW, py); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
Axes.prototype._renderVline = function (ctx, trace, xScale, yScale, plotY, plotH) {
  const px = xScale.transform(trace.x);
  if (px - px !== 0) return;
  const o = trace.opts, f0 = o.ymin ?? 0, f1 = o.ymax ?? 1;
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.strokeStyle = o.color || this._theme.muted;
  ctx.lineWidth = o.linewidth || 1;
  ctx.setLineDash(dashArray(o.linestyle));
  ctx.beginPath(); ctx.moveTo(px, plotY + (1 - f0) * plotH); ctx.lineTo(px, plotY + (1 - f1) * plotH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};
_hooks.drawstyle = _applyDrawstyle;
void parseFormat;
