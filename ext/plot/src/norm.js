// Colour normalisation (matplotlib.colors' norms) and the colorbar.
//
// A norm maps a data value to t ∈ [0, 1] along the colour map: Normalize (linear), LogNorm,
// TwoSlopeNorm (diverging about a centre), CenteredNorm, BoundaryNorm (discrete classes).
// Every colour-mapped trace — scatter, imshow, pcolormesh, contour(f) — resolves ONE norm per
// render (its vmin / vmax filled from the data where not given), and the colorbar draws that
// same norm, so the bar can't disagree with the plot.

import { _niceTicks, _fmtStep } from './ticks.js';
import { getCmap, _cmapLut, _colorBytes } from './color.js';
import { _textW } from './style.js';

const _log10 = Math.log10;

export class Normalize {
  constructor(vmin = null, vmax = null, clip = false) {
    if (vmin && typeof vmin === 'object') ({ vmin = null, vmax = null, clip = false } = vmin);
    this.vmin = vmin; this.vmax = vmax; this.clip = clip;
  }
  // data → t (outside [0, 1] when the value is; NaN: no colour)
  call(v) { const d = this.vmax - this.vmin; return d ? (v - this.vmin) / d : 0.5; }
  inverse(t) { return this.vmin + t * (this.vmax - this.vmin); }
  get scaled() { return this.vmin != null && this.vmax != null; }
  // a copy with the missing ends filled (the data's range); norms given by the caller are
  // never changed, so one norm can serve several figures
  _resolved(lo, hi) { const n = Object.create(Object.getPrototypeOf(this)); Object.assign(n, this); if (n.vmin == null) n.vmin = lo; if (n.vmax == null) n.vmax = hi; return n; }
  get _key() { return `${this.constructor.name}|${this.vmin}|${this.vmax}`; }
  _ticks(n) { const t = _niceTicks(Math.min(this.vmin, this.vmax), Math.max(this.vmin, this.vmax), n); return { values: Array.from(t), labels: _fmtStep(Array.from(t), t.step || 1) }; }
}

export class LogNorm extends Normalize {
  call(v) {
    if (!(v > 0)) return NaN;
    const a = _log10(this.vmin), b = _log10(this.vmax);
    return b - a ? (_log10(v) - a) / (b - a) : 0.5;
  }
  inverse(t) { const a = _log10(this.vmin), b = _log10(this.vmax); return Math.pow(10, a + t * (b - a)); }
  _ticks() {
    const lo = Math.ceil(_log10(this.vmin) - 1e-9), hi = Math.floor(_log10(this.vmax) + 1e-9);
    const values = [];
    for (let e = lo; e <= hi; e++) values.push(Math.pow(10, e));
    if (values.length < 2) for (const m of [2, 5]) for (let e = lo - 1; e <= hi; e++) { const v = m * Math.pow(10, e); if (v >= this.vmin && v <= this.vmax) values.push(v); }
    values.sort((a, b) => a - b);
    return { values, labels: values.map((v) => { const e = Math.round(_log10(v)); return Math.abs(Math.pow(10, e) - v) < v * 1e-9 && (e < -3 || e > 4) ? `1e${e}` : String(+v.toPrecision(6)); }) };
  }
}

// diverging about vcenter: each side spans half the map
export class TwoSlopeNorm extends Normalize {
  constructor(vcenter, vmin = null, vmax = null) {
    if (vcenter && typeof vcenter === 'object') ({ vcenter, vmin = null, vmax = null } = vcenter);
    super(vmin, vmax);
    this.vcenter = +vcenter;
  }
  call(v) {
    const c = this.vcenter;
    if (v < c) return c - this.vmin ? 0.5 * (v - this.vmin) / (c - this.vmin) : 0.5;
    return this.vmax - c ? 0.5 + 0.5 * (v - c) / (this.vmax - c) : 0.5;
  }
  inverse(t) { const c = this.vcenter; return t < 0.5 ? this.vmin + (t / 0.5) * (c - this.vmin) : c + ((t - 0.5) / 0.5) * (this.vmax - c); }
  _resolved(lo, hi) { const n = super._resolved(Math.min(lo, this.vcenter), Math.max(hi, this.vcenter)); return n; }
  get _key() { return `TwoSlope|${this.vmin}|${this.vcenter}|${this.vmax}`; }
}

// symmetric about vcenter: halfrange from the data's furthest value unless given
export class CenteredNorm extends Normalize {
  constructor(vcenter = 0, halfrange = null) {
    if (vcenter && typeof vcenter === 'object') ({ vcenter = 0, halfrange = null } = vcenter);
    super(); this.vcenter = +vcenter; this.halfrange = halfrange;
  }
  _resolved(lo, hi) {
    const n = Object.create(CenteredNorm.prototype); Object.assign(n, this);
    const h = this.halfrange != null ? +this.halfrange : Math.max(Math.abs(lo - this.vcenter), Math.abs(hi - this.vcenter)) || 1;
    n.vmin = this.vcenter - h; n.vmax = this.vcenter + h;
    return n;
  }
}

// discrete classes: the value's bin among `boundaries` picks one of `ncolors` colours spread
// along the map (ncolors = the listed map's N for one colour per class)
export class BoundaryNorm extends Normalize {
  constructor(boundaries, ncolors = 256, clip = false) {
    if (boundaries && !Array.isArray(boundaries) && !ArrayBuffer.isView(boundaries) && typeof boundaries === 'object') ({ boundaries, ncolors = 256, clip = false } = boundaries);
    const b = Array.from(boundaries, Number);
    if (b.length < 2) throw new Error('plot: BoundaryNorm needs at least two boundaries');
    super(b[0], b[b.length - 1], clip);
    this.boundaries = b; this.ncolors = ncolors;
  }
  // the class index of a value: 0 … nb-1; below / above the boundaries take the end classes
  _bin(v) {
    const b = this.boundaries, nb = b.length - 1;
    if (v < b[0]) return -1;
    if (v >= b[nb]) return v === b[nb] ? nb - 1 : nb;
    let lo = 0, hi = nb - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= v) lo = m; else hi = m - 1; }
    return lo;
  }
  call(v) {
    if (v !== v) return NaN;
    const nb = this.boundaries.length - 1;
    const i = Math.max(0, Math.min(nb - 1, this._bin(v)));
    const idx = nb > 1 ? Math.round((i * (this.ncolors - 1)) / (nb - 1)) : (this.ncolors - 1) / 2;
    return (idx + 0.5) / this.ncolors;
  }
  inverse(t) { return this.boundaries[0] + t * (this.boundaries[this.boundaries.length - 1] - this.boundaries[0]); }
  _resolved() { return this; }
  get _key() { return `Boundary|${this.boundaries.join(',')}|${this.ncolors}`; }
  _ticks() { const v = this.boundaries.slice(); let step = Infinity; for (let i = 1; i < v.length; i++) step = Math.min(step, Math.abs(v[i] - v[i - 1])); return { values: v, labels: _fmtStep(v, step) }; }
}

// a norm option (an instance, 'linear', 'log') with vmin / vmax and the data's range → the norm
// this render uses
export function _resolveNorm(norm, vmin, vmax, lo, hi, minPos) {
  if (norm === 'log') norm = new LogNorm();
  else if (norm === 'linear' || norm == null) norm = new Normalize();
  else if (typeof norm === 'string') throw new Error(`plot: norm '${norm}' is not supported; use a Normalize, LogNorm, TwoSlopeNorm, CenteredNorm or BoundaryNorm, or 'linear' / 'log'`);
  const n = norm._resolved(norm instanceof LogNorm ? (minPos ?? lo) : lo, hi);
  if (vmin != null && !(norm instanceof BoundaryNorm)) n.vmin = +vmin;
  if (vmax != null && !(norm instanceof BoundaryNorm)) n.vmax = +vmax;
  if (n.vmin === n.vmax && !(n instanceof BoundaryNorm)) { n.vmin -= 0.5; n.vmax += 0.5; }
  return n;
}

// value → LUT index 0–255, -1 for no colour; the linear case inlined (the hot loops call this
// for every point or cell)
export function _indexer(norm) {
  if (norm.constructor === Normalize) {
    const lo = norm.vmin, k = norm.vmax !== norm.vmin ? 256 / (norm.vmax - norm.vmin) : 0;
    return (v) => { if (v !== v) return -1; const q = k ? ((v - lo) * k) | 0 : 128; return q < 0 ? 0 : q > 255 ? 255 : q; };
  }
  return (v) => { if (v !== v) return -1; const t = norm.call(v); if (t !== t) return -1; const q = (t * 256) | 0; return q < 0 ? 0 : q > 255 ? 255 : q; };
}

// ── the colorbar ──
// the ticks a colorbar of height h draws: given ticks, or the norm's own
export function _cbTicks(norm, h, opts) {
  let ticks;
  if (opts.ticks != null) {
    const v = Array.from(opts.ticks, Number);
    let step = Infinity; for (let i = 1; i < v.length; i++) step = Math.min(step, Math.abs(v[i] - v[i - 1]));
    ticks = { values: v, labels: _fmtStep(v, step === Infinity ? 1 : step) };
  } else ticks = norm._ticks(Math.max(2, Math.floor(h / 32) + 1));
  if (opts.format) {
    const f = opts.format;
    ticks.labels = ticks.values.map((v) => (typeof f === 'function' ? String(f(v)) : _cbFmt(f, v)));
  }
  return ticks;
}
function _cbFmt(f, v) {
  const m = /%[-+ 0#]*\d*(?:\.(\d+))?([dfgeE%])/.exec(f);
  if (m) {
    const p = m[1] == null ? null : +m[1];
    const s = m[2] === 'd' ? String(Math.round(v)) : m[2] === 'f' ? v.toFixed(p ?? 6) : m[2] === 'e' || m[2] === 'E' ? v.toExponential(p ?? 6) : m[2] === '%' ? (v * 100).toFixed(p ?? 0) + '%' : String(+v.toPrecision(p || 6));
    return f.replace(m[0], s);
  }
  const b = /\{(?:[^:}]*):?(,?)(?:\.(\d+))?([fgde%]?)\}/.exec(f);
  if (b) {
    const p = b[2] == null ? null : +b[2];
    let s = b[3] === 'f' ? v.toFixed(p ?? 6) : b[3] === 'e' ? v.toExponential(p ?? 6) : b[3] === 'd' ? String(Math.round(v)) : b[3] === '%' ? (v * 100).toFixed(p ?? 0) + '%' : String(+v.toPrecision(p || 6));
    if (b[1]) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d != null ? '.' + d : ''); }
    return f.replace(b[0], s);
  }
  return String(v);
}
export function _cbLabelsW(ticks, font) { return ticks.labels.reduce((m, s) => Math.max(m, _textW(font, s)), 0); }

// draw a vertical colorbar in [x, y, w, h]: the map through the norm (bands for BoundaryNorm
// and listed maps), extend triangles at the ends, ticks and labels on the right, the label
// rotated beyond them
export function _drawColorbar(ctx, x, y, w, h, cmap, norm, ticks, opts) {
  const fn = getCmap(cmap), lut = _cmapLut(cmap);
  const colorAt = (t) => {
    if (lut) { const q = Math.max(0, Math.min(255, (t * 256) | 0)) * 4; return `rgb(${lut[q]},${lut[q + 1]},${lut[q + 2]})`; }
    return fn(t);
  };
  const ext = opts.extend || 'neither';
  const tri = Math.min(w * 1.2, h * 0.06);
  const top = ext === 'max' || ext === 'both' ? tri : 0, bot = ext === 'min' || ext === 'both' ? tri : 0;
  const by = y + top, bh = h - top - bot;
  // where a value sits along the bar: discrete classes stand evenly (matplotlib's 'uniform')
  const discrete = norm instanceof BoundaryNorm;
  const posOf = (v) => {
    if (discrete) {
      const b = norm.boundaries, nb = b.length - 1;
      let i = 0; while (i < nb - 1 && v > b[i + 1]) i++;
      const f = (v - b[i]) / (b[i + 1] - b[i] || 1);
      return by + bh * (1 - (i + Math.max(0, Math.min(1, f))) / nb);
    }
    const t = norm.call(v);
    return by + bh * (1 - t);
  };
  if (discrete) {
    const b = norm.boundaries, nb = b.length - 1;
    for (let i = 0; i < nb; i++) {
      ctx.fillStyle = opts.bandColors ? opts.bandColors[i] : colorAt(norm.call((b[i] + b[i + 1]) / 2));
      const y0 = by + bh * (1 - (i + 1) / nb);
      ctx.fillRect(x, y0, w, bh / nb + 0.5);
    }
  } else {
    const n = Math.max(1, Math.floor(bh));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colorAt(1 - (i + 0.5) / n);
      ctx.fillRect(x, by + (i * bh) / n, w, bh / n + 0.6);
    }
  }
  // the ends beyond the norm: matplotlib's extend arrows, in the end colours
  if (top) { ctx.fillStyle = opts.extColors ? opts.extColors[1] : colorAt(1); ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, by); ctx.closePath(); ctx.fill(); }
  if (bot) { ctx.fillStyle = opts.extColors ? opts.extColors[0] : colorAt(0); ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x + w, by + bh); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = opts.frameColor; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, by); if (top) ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, by);
  ctx.lineTo(x + w, by + bh); if (bot) ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, by + bh); ctx.closePath();
  ctx.stroke();
  // ticks
  ctx.fillStyle = opts.textColor; ctx.font = opts.font;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = opts.frameColor;
  const lo = Math.min(norm.vmin, norm.vmax), hi = Math.max(norm.vmin, norm.vmax);
  for (let i = 0; i < ticks.values.length; i++) {
    const v = ticks.values[i];
    if (!(v >= lo - Math.abs(hi - lo) * 1e-9 && v <= hi + Math.abs(hi - lo) * 1e-9)) continue;
    const py = posOf(v);
    if (py - py !== 0) continue;
    ctx.beginPath(); ctx.moveTo(x + w, py); ctx.lineTo(x + w + 3, py); ctx.stroke();
    ctx.fillText(ticks.labels[i], x + w + 5, py);
  }
  if (opts.label) {
    ctx.save();
    ctx.font = opts.labelFont || opts.font;
    ctx.translate(x + w + 5 + opts.labelsW + 6, y + h / 2);
    ctx.rotate(-Math.PI / 2);                              // reads bottom to top, like a ylabel
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(opts.label, 0, 0);
    ctx.restore();
  }
}
void _colorBytes;
