// Ticks and their labels, sized to the axis's PIXEL length and measured, so labels never overlap and margins can be measured from them.
//
// An axis's ticks come from, in order:
//   1. set_xticks(values, labels?, {rotation}) — exactly those (a label list may be shorter);
//   2. a category axis (strings given as x or y) — one tick per category, labelled;
//   3. the scale — at most one tick per 55 px on x, per 32 px on y, as many round ones as fit.
// Labels that would collide are fixed: numeric ticks get fewer; categories rotate 45°, and
// if they still collide only every k-th is labelled (the ticks stay).


import { _textW } from './style.js';

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

// at most `count` round ticks inside [lo, hi], as many as fit: the smallest step of 1, 2, 2.5
// or 5 × a power of ten that gives no more than `count` (and at least two while the range
// allows) — matplotlib's MaxNLocator idea
export function _niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const n = (step) => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1;
  const e0 = Math.floor(Math.log10(span)) - 3;
  let step = null;
  for (let e = e0; e <= e0 + 5 && step == null; e++) {
    for (const m of [1, 2, 2.5, 5]) {
      const s = m * Math.pow(10, e);
      if (n(s) <= Math.max(2, count)) { step = s; break; }
    }
  }
  if (step == null) step = Math.pow(10, e0 + 6);
  const a = Math.ceil(lo / step - 1e-9), b = Math.floor(hi / step + 1e-9);
  const out = [];
  for (let k = a; k <= b && out.length < 200; k++) out.push(+(k * step).toPrecision(12));
  out.step = step;
  return out;
}

// labels for ticks with this step: just the decimals the step needs; plain digits up to 1e9
// (a northing reads 8200100, as matplotlib prints it), exponents past that or below 1e-4
export function _fmtStep(values, step) {
  const big = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (big >= 1e9 || (big > 0 && big < 1e-4)) return values.map((v) => (v === 0 ? '0' : v.toExponential(Math.max(0, Math.min(3, Math.round(-Math.log10(step / big)))))));
  let dec = 0;
  while (dec < 10 && Math.abs(step * Math.pow(10, dec) - Math.round(step * Math.pow(10, dec))) > 1e-6 * Math.max(1, step * Math.pow(10, dec))) dec++;
  return values.map((v) => { const s = v.toFixed(dec); return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s; });
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
  if (custom && custom.values) {
    values = Array.from(custom.values, Number);
    labels = custom.labels ? values.map((_, i) => (custom.labels[i] != null ? String(custom.labels[i]) : '')) : _fmtTicks(scale, values);
  } else if (cats && cats.list.length) {
    values = cats.list.map((_, i) => i);
    labels = cats.list.slice();
  } else {
    const per = axis === 'x' ? 55 : 32;
    let count = Math.max(2, Math.min(12, Math.floor(len / per) + 1));
    for (;;) {
      values = scale.log ? scale.ticks() : _niceTicks(lo, hi, count);
      labels = scale.log ? _fmtTicks(scale, values) : _fmtStep(values, values.step || (hi - lo));
      if (axis === 'y' || count <= 2 || scale.log) break;
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
  return { values, labels, rot, extent, maxW, widths };
}

// draw one axis's ticks and labels. side: 'bottom' | 'top' | 'left' | 'right'
export function _drawTicks(ctx, spec, scale, side, plot, color, tickColor, font) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 1;
  const { values, labels, rot } = spec;
  for (let i = 0; i < values.length; i++) {
    const p = scale.transform(values[i]);
    ctx.beginPath();
    if (side === 'bottom') { ctx.moveTo(p, plot.y + plot.h); ctx.lineTo(p, plot.y + plot.h + 4); }
    else if (side === 'top') { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y - 4); }
    else if (side === 'left') { ctx.moveTo(plot.x - 4, p); ctx.lineTo(plot.x, p); }
    else { ctx.moveTo(plot.x + plot.w, p); ctx.lineTo(plot.x + plot.w + 4, p); }
    ctx.stroke();
    const s = labels[i];
    if (!s) continue;
    if (side === 'bottom' || side === 'top') {
      const y = side === 'bottom' ? plot.y + plot.h + 6 : plot.y - 6;
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
      ctx.fillText(s, side === 'left' ? plot.x - 6 : plot.x + plot.w + 6, p);
    }
  }
}
