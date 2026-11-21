// Ticks and their labels, sized to the axis's PIXEL length and measured, so labels never overlap and margins can be measured from them.
//
// An axis's ticks come from, in order:
//   1. set_xticks(values, labels?, {rotation}) — exactly those (a label list may be shorter);
//   2. a category axis (strings given as x or y) — one tick per category, labelled;
//   3. the scale — at most one tick per 55 px on x, per 32 px on y, as many round ones as fit.
// Labels that would collide are fixed: numeric ticks get fewer; categories rotate 45°, and
// if they still collide only every k-th is labelled (the ticks stay).


import { _textW } from './style.js';
import { _dateTicks, strftime, AutoMinorLocator } from './ticker.js';
import { _niceTicks, _fmtStep } from './nice.js';
export { _niceTicks, _fmtStep };

// a category axis: labels in first-appearance order, each at the integer position 0, 1, 2 …
export class _Categories {
  constructor() { this.list = []; this.index = new Map(); }
  // an array of labels (strings or numbers-as-labels) → their positions
  positions(arr) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null || (typeof v === 'number' && v !== v)) { out[i] = NaN; continue; }
      const key = String(v);
      let k = this.index.get(key);
      if (k === undefined) { k = this.list.length; this.list.push(key); this.index.set(key, k); }
      out[i] = k;
    }
    return out;
  }
}

// does this column hold labels rather than numbers (matplotlib: strings make a category axis)
export function _isCategorical(arr) {
  if (!arr || typeof arr === 'string' || ArrayBuffer.isView(arr)) return false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    return typeof v === 'string';
  }
  return false;
}

// does this column hold Dates (a date axis)
export function _isDateCol(arr) {
  if (!arr || typeof arr === 'string' || ArrayBuffer.isView(arr)) return false;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v == null) continue; return v instanceof Date; }
  return false;
}

// numbers as a scale formats them: a common precision for the set
export function _fmtTicks(scale, values) {
  if (!scale.log && values.length > 1) return _fmtStep(values, Math.abs(values[1] - values[0]));
  const f = scale.tickFormat();
  return values.map((v) => f(v));
}

// the ticks of one axis: { values, labels, rot (degrees), extent (px the labels take
// perpendicular to the axis), along (the widest label along the axis) }
// `ax`: the Axes; `axis`: 'x' | 'y'; `scale`; `len`: the axis length in px; `ctx` to measure
export function _tickSpec(ax, axis, scale, len, ctx, font, fontPx) {
  const custom = axis === 'x' ? ax._xticks : ax._yticks;
  const cats = axis === 'x' ? ax._xcats : ax._ycats;
  ctx.font = font;
  const W = (s) => _textW(font, s);
  const [d0, d1] = scale.domain;
  const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
  const inside = (v) => v >= lo - Math.abs(hi - lo) * 1e-9 && v <= hi + Math.abs(hi - lo) * 1e-9;
  let values, labels, rot = 0, fixedRot = false, thin = 1;

  if (custom && custom.rotation != null) { rot = custom.rotation === 'vertical' ? 90 : +custom.rotation || 0; fixedRot = true; }
  // the axis's ticker (axis.js): a locator and formatter set on ax.xaxis / ax.yaxis, minor ticks
  const tk = ax._ticker ? ax._ticker(axis) : null;
  const date = (axis === 'x' ? ax._xdate : ax._ydate) && !scale.log;
  const fmtCtx = (vals) => ({ step: vals.step || (vals.length > 1 ? Math.abs(vals[1] - vals[0]) : hi - lo), values: vals, range: hi - lo, date });
  const formatted = (vals, F) => { const c = fmtCtx(vals); return vals.map((v, i) => F.format(v, i, c)); };
  if (custom && custom.values) {
    values = Array.from(custom.values, Number);
    labels = custom.labels ? values.map((_, i) => (custom.labels[i] != null ? String(custom.labels[i]) : ''))
      : tk && tk.majorF ? formatted(values, tk.majorF) : date ? _dateLabels(values) : _fmtTicks(scale, values);
  } else if (cats && cats.list.length) {
    values = cats.list.map((_, i) => i);
    labels = cats.list.slice();
  } else {
    const per = axis === 'x' ? 55 : 32;
    let count = Math.max(2, Math.min(12, Math.floor(len / per) + 1));
    for (;;) {
      if (tk && tk.majorL) {
        values = tk.majorL.tick_values(lo, hi, { count, log: !!scale.log });
        labels = date ? _dateLabels(values) : scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (values.length > 1 ? Math.abs(values[1] - values[0]) : hi - lo));
      } else if (date) {
        ({ values, labels } = _dateTicks(lo, hi, count));
      } else {
        values = scale.log ? scale.ticks() : _niceTicks(lo, hi, count);
        labels = scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (hi - lo));
      }
      if (tk && tk.majorF) labels = formatted(values, tk.majorF);
      // a locator says where the ticks go: no thinning
      if (axis === 'y' || count <= 2 || scale.log || (tk && tk.majorL)) break;
      // x: shrink the count until neighbouring labels clear each other by 8 px
      const px = values.map((v) => scale.transform(v));
      let ok = true;
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(px[i] - px[i - 1]) < (W(labels[i]) + W(labels[i - 1])) / 2 + 8) { ok = false; break; }
      }
      if (ok) break;
      count--;
    }
  }
  const keep = values.map((v) => v - v === 0 && inside(v));
  values = values.filter((_, i) => keep[i]);
  labels = labels.filter((_, i) => keep[i]);
  const widths = labels.map(W);
  const maxW = widths.length ? Math.max(...widths) : 0;

  if (axis === 'x' && !fixedRot && values.length > 1) {
    // labels that collide flat: rotate 45° (only for labels, e.g. categories — numbers were
    // thinned above); if they still collide, label every k-th
    const px = values.map((v) => scale.transform(v));
    let minGap = Infinity;
    for (let i = 1; i < px.length; i++) minGap = Math.min(minGap, Math.abs(px[i] - px[i - 1]));
    if (minGap < maxW + 6) {
      rot = 45;
      const need = fontPx * 1.15;                      // rotated 45°, neighbours clear by their height / sin
      if (minGap * Math.SQRT1_2 < need) thin = Math.ceil(need / (minGap * Math.SQRT1_2));
    }
  }
  if (thin > 1) labels = labels.map((l, i) => (i % thin === 0 ? l : ''));

  const r = (rot * Math.PI) / 180;
  const extent = axis === 'x'
    ? (rot ? maxW * Math.abs(Math.sin(r)) + fontPx * Math.abs(Math.cos(r)) : fontPx)
    : maxW;
  // minor ticks: a minor locator, or minorticks_on() (AutoMinorLocator), between the majors;
  // unlabelled unless a minor formatter says otherwise
  let minor = null, minorLabels = null;
  if (tk && (tk.minorL || tk.minorOn) && !(cats && cats.list.length)) {
    const L = tk.minorL || new AutoMinorLocator();
    const majors = new Set(values.map((v) => +v.toPrecision(10)));
    minor = L.tick_values(lo, hi, { majors: values, log: !!scale.log }).filter((v) => inside(v) && !majors.has(+v.toPrecision(10)));
    if (tk.minorF) minorLabels = formatted(minor, tk.minorF);
  }
  const params = ax._tickParams ? ax._tickParams[axis] || null : null;
  return { values, labels, rot, extent, maxW, widths, minor, minorLabels, params };
}

// labels for date ticks a locator placed: the format their spacing reads in
function _dateLabels(values) {
  if (!values.length) return [];
  const d = values.length > 1 ? Math.abs(values[1] - values[0]) : 864e5;
  const fmt = d >= 360 * 864e5 ? '%Y' : d >= 28 * 864e5 ? '%Y-%m' : d >= 864e5 ? '%Y-%m-%d' : d >= 6e4 ? '%H:%M' : d >= 1e3 ? '%H:%M:%S' : '%H:%M:%S.%f';
  return values.map((t) => strftime(t, fmt));
}

// draw one axis's ticks and labels. side: 'bottom' | 'top' | 'left' | 'right'
// tick_params: { major: {length, direction, width, color}, minor: {…} } per axis; length in px
// (4 major, 2 minor), direction 'out' (default) | 'in' | 'inout'
export function _drawTicks(ctx, spec, scale, side, plot, color, tickColor, font) {
  ctx.font = font;
  ctx.fillStyle = color;
  const { values, labels, rot } = spec;
  const P = spec.params || {}, maj = P.major || {}, mnr = P.minor || {};
  // one tick mark at p: out of the frame, into it, or across it
  const mark = (p, len, dir) => {
    const a = dir === 'in' ? 0 : len, b = dir === 'out' || !dir ? 0 : len;   // outward, inward
    ctx.beginPath();
    if (side === 'bottom') { ctx.moveTo(p, plot.y + plot.h - b); ctx.lineTo(p, plot.y + plot.h + a); }
    else if (side === 'top') { ctx.moveTo(p, plot.y + b); ctx.lineTo(p, plot.y - a); }
    else if (side === 'left') { ctx.moveTo(plot.x - a, p); ctx.lineTo(plot.x + b, p); }
    else { ctx.moveTo(plot.x + plot.w + a, p); ctx.lineTo(plot.x + plot.w - b, p); }
    ctx.stroke();
  };
  if (spec.minor && spec.minor.length) {
    ctx.strokeStyle = mnr.color || tickColor;
    ctx.lineWidth = mnr.width != null ? mnr.width : 0.8;
    const len = mnr.length != null ? mnr.length : 2;
    for (const v of spec.minor) { const p = scale.transform(v); if (p - p === 0) mark(p, len, mnr.direction); }
  }
  ctx.strokeStyle = maj.color || tickColor;
  ctx.lineWidth = maj.width != null ? maj.width : 1;
  const len = maj.length != null ? maj.length : 4;
  const gap = 2 + (maj.direction === 'in' ? 0 : len);   // labels clear the mark
  for (let i = 0; i < values.length; i++) {
    const p = scale.transform(values[i]);
    mark(p, len, maj.direction);
    const s = labels[i];
    if (!s) continue;
    if (side === 'bottom' || side === 'top') {
      const y = side === 'bottom' ? plot.y + plot.h + gap : plot.y - gap;
      if (rot) {                                       // rotated: the label's END sits under the tick
        ctx.save();
        ctx.translate(p, y);
        ctx.rotate((side === 'bottom' ? -1 : 1) * rot * Math.PI / 180);
        ctx.textAlign = 'right';
        ctx.textBaseline = side === 'bottom' ? 'top' : 'bottom';
        ctx.fillText(s, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = side === 'bottom' ? 'top' : 'bottom';
        ctx.fillText(s, p, y);
      }
    } else {
      ctx.textAlign = side === 'left' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, side === 'left' ? plot.x - gap : plot.x + plot.w + gap, p);
    }
  }
}
