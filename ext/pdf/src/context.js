// A CanvasRenderingContext2D that writes a PDF page. The point: anything in GCU that draws on a
// canvas — @gcu/plot (replaying a draw list), micro's legends and scale bars, compo's furniture —
// draws a PDF page with the same code, and the result is VECTOR: paths are PDF paths, text is
// text (the standard fonts, fonts.js), images are image XObjects at their own resolution.
//
// The user space is the canvas one: origin top-left, y down, units = points unless the page was
// opened with units:'mm' (then a millimetre). Path points are transformed to page space as they
// are added (canvas semantics: a transform changes only what comes after), so line widths and
// dashes are scaled by the transform's scale when stroked.
//
// Supported: paths (moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect closePath),
// fill (nonzero / evenodd), stroke, clip, fillRect strokeRect, fillText strokeText measureText
// (with maxWidth), drawImage (3/5/9 args; ImageData-like {width, height, data}, a canvas, an
// ImageBitmap/image in a browser, or {jpeg, width, height}), putImageData, save/restore, the
// transform calls, line width / cap / join / miter / dash, globalAlpha and rgba alpha,
// imageSmoothingEnabled. Not expressible in PDF here — and SAID so once each, never silently
// dropped: gradients and patterns (the first colour stop is used), shadows, filters, composite
// operations other than source-over, Path2D. clearRect does nothing: a PDF page has no pixels.

import { parseCssColor } from './color.js';
import { parseFont, encodeRuns, textWidth, pdfString, baselineShift } from './fonts.js';

const KAPPA = 0.5522847498307936;
// numbers as PDF writes them: short, never an exponent, no -0
export function num(v) {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  if (r === 0) return '0';
  let s = r.toFixed(4);
  s = s.replace(/\.?0+$/, '');
  return s;
}
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const invert = (m) => {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
};
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

const DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
  lineDashOffset: 0, globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
  direction: 'ltr', imageSmoothingEnabled: true, imageSmoothingQuality: 'low', globalCompositeOperation: 'source-over',
  shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
};

export class PdfContext2D {
  // page: the PdfPage (owns resources + the content stream); base: page space ← user space
  constructor(page, base) {
    this._page = page;
    this._doc = page._doc;
    this._base = base.slice();
    this._m = base.slice();
    this._st = { ...DEFAULTS, dash: [] };
    this._stack = [];
    this._path = [];                                       // page-space segments
    this._cur = null;                                      // page-space current point
    this._start = null;                                    // page-space subpath start
    this._alpha = 1;                                       // the ca/CA last set at THIS q-level ([fill, stroke])
    this._alphaS = 1;
    this.canvas = { width: page.width, height: page.height };
    // drawImage reads {width, height, data} directly — a draw-list replayer (plot's replay) hands
    // rasters over as pixels instead of going through an OffscreenCanvas
    this.acceptsImageData = true;
  }

  // ── state ──
  _set(k, v) { this._st[k] = v; }
  get fillStyle() { return this._st.fillStyle; } set fillStyle(v) { this._paint(v, 'fillStyle'); }
  get strokeStyle() { return this._st.strokeStyle; } set strokeStyle(v) { this._paint(v, 'strokeStyle'); }
  _paint(v, k) {
    if (v && typeof v === 'object') {
      this._warn('gradient', 'gradients and patterns are not drawn yet — the first colour stop is used');
      v = v._stops && v._stops.length ? v._stops[0][1] : '#000000';
    }
    if (parseCssColor(v)) this._st[k] = v;
    else this._warn('color:' + v, `colour '${v}' is not a CSS colour this context reads — kept the previous one`);
  }
  get lineWidth() { return this._st.lineWidth; } set lineWidth(v) { if (v > 0 && Number.isFinite(+v)) this._st.lineWidth = +v; }
  get lineCap() { return this._st.lineCap; } set lineCap(v) { if (['butt', 'round', 'square'].includes(v)) this._st.lineCap = v; }
  get lineJoin() { return this._st.lineJoin; } set lineJoin(v) { if (['miter', 'round', 'bevel'].includes(v)) this._st.lineJoin = v; }
  get miterLimit() { return this._st.miterLimit; } set miterLimit(v) { if (v > 0) this._st.miterLimit = +v; }
  get lineDashOffset() { return this._st.lineDashOffset; } set lineDashOffset(v) { if (Number.isFinite(+v)) this._st.lineDashOffset = +v; }
  get globalAlpha() { return this._st.globalAlpha; } set globalAlpha(v) { if (v >= 0 && v <= 1) this._st.globalAlpha = +v; }
  get font() { return this._st.font; } set font(v) { this._st.font = String(v); }
  get textAlign() { return this._st.textAlign; } set textAlign(v) { this._st.textAlign = v; }
  get textBaseline() { return this._st.textBaseline; } set textBaseline(v) { this._st.textBaseline = v; }
  get direction() { return this._st.direction; } set direction(v) { this._st.direction = v; }
  get imageSmoothingEnabled() { return this._st.imageSmoothingEnabled; } set imageSmoothingEnabled(v) { this._st.imageSmoothingEnabled = !!v; }
  get imageSmoothingQuality() { return this._st.imageSmoothingQuality; } set imageSmoothingQuality(v) { this._st.imageSmoothingQuality = v; }
  get globalCompositeOperation() { return this._st.globalCompositeOperation; }
  set globalCompositeOperation(v) { if (v !== 'source-over') this._warn('composite', `globalCompositeOperation '${v}' is not drawn — PDF pages composite source-over`); }
  get shadowBlur() { return this._st.shadowBlur; } set shadowBlur(v) { if (+v > 0) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get shadowColor() { return this._st.shadowColor; } set shadowColor(v) { this._st.shadowColor = v; }
  get shadowOffsetX() { return 0; } set shadowOffsetX(v) { if (+v) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get shadowOffsetY() { return 0; } set shadowOffsetY(v) { if (+v) this._warn('shadow', 'shadows are not drawn in PDF'); }
  get filter() { return 'none'; } set filter(v) { if (v && v !== 'none') this._warn('filter', 'canvas filters are not drawn in PDF'); }
  setLineDash(a) { const d = Array.from(a || [], Number).filter((v) => v >= 0 && Number.isFinite(v)); this._st.dash = d.length % 2 ? d.concat(d) : d; }
  getLineDash() { return this._st.dash.slice(); }

  save() {
    this._stack.push({ st: { ...this._st, dash: this._st.dash.slice() }, m: this._m.slice(), alpha: this._alpha, alphaS: this._alphaS });
    this._out('q');
  }
  restore() {
    const s = this._stack.pop(); if (!s) return;
    this._st = s.st; this._m = s.m; this._alpha = s.alpha; this._alphaS = s.alphaS;
    this._out('Q');
  }

  // ── transforms ──
  translate(x, y) { this._m = mul(this._m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this._m = mul(this._m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._m = mul(this._m, [c, s, -s, c, 0, 0]); }
  transform(a, b, c, d, e, f) { this._m = mul(this._m, [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) {
    if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
    this._m = mul(this._base, [a, b, c, d, e, f]);
  }
  resetTransform() { this._m = this._base.slice(); }
  getTransform() { const u = mul(invert(this._base), this._m); return { a: u[0], b: u[1], c: u[2], d: u[3], e: u[4], f: u[5] }; }

  // ── paths (page space as they're added) ──
  beginPath() { this._path = []; this._cur = null; this._start = null; }
  moveTo(x, y) { const p = apply(this._m, x, y); this._path.push(['m', p[0], p[1]]); this._cur = p; this._start = p; }
  lineTo(x, y) {
    if (!this._cur) return this.moveTo(x, y);
    const p = apply(this._m, x, y); this._path.push(['l', p[0], p[1]]); this._cur = p;
  }
  bezierCurveTo(x1, y1, x2, y2, x, y) {
    if (!this._cur) this.moveTo(x1, y1);
    const a = apply(this._m, x1, y1), b = apply(this._m, x2, y2), p = apply(this._m, x, y);
    this._path.push(['c', a[0], a[1], b[0], b[1], p[0], p[1]]); this._cur = p;
  }
  quadraticCurveTo(cx, cy, x, y) {
    if (!this._cur) this.moveTo(cx, cy);
    const u = apply(invert(this._m), this._cur[0], this._cur[1]);
    this.bezierCurveTo(u[0] + (2 / 3) * (cx - u[0]), u[1] + (2 / 3) * (cy - u[1]), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
  }
  closePath() { if (this._cur) { this._path.push(['h']); this._cur = this._start; } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x, y, w, h, r = 0) {
    const rr = Math.min(Math.abs(Array.isArray(r) ? r[0] || 0 : +r || 0), Math.abs(w) / 2, Math.abs(h) / 2);
    if (!rr) return this.rect(x, y, w, h);
    this.moveTo(x + rr, y); this.arcTo(x + w, y, x + w, y + h, rr); this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr); this.arcTo(x, y, x + w, y, rr); this.closePath();
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    if (rx < 0 || ry < 0) return;
    let sweep = a1 - a0;
    const TAU = Math.PI * 2;
    if (!ccw) { if (sweep < 0) sweep = (sweep % TAU) + TAU; if (a1 - a0 >= TAU) sweep = TAU; }
    else { if (sweep > 0) sweep = (sweep % TAU) - TAU; if (a0 - a1 >= TAU) sweep = -TAU; }
    if (sweep > TAU) sweep = TAU; if (sweep < -TAU) sweep = -TAU;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const pt = (t) => { const x = rx * Math.cos(t), y = ry * Math.sin(t); return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
    const d = (t) => { const x = -rx * Math.sin(t), y = ry * Math.cos(t); return [x * cr - y * sr, x * sr + y * cr]; };
    const p0 = pt(a0);
    if (this._cur) this.lineTo(p0[0], p0[1]); else this.moveTo(p0[0], p0[1]);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / n, k = (4 / 3) * Math.tan(step / 4);
    let t = a0;
    for (let i = 0; i < n; i++) {
      const t1 = t + step, q0 = pt(t), q1 = pt(t1), d0 = d(t), d1 = d(t1);
      this.bezierCurveTo(q0[0] + k * d0[0], q0[1] + k * d0[1], q1[0] - k * d1[0], q1[1] - k * d1[1], q1[0], q1[1]);
      t = t1;
    }
  }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  arcTo(x1, y1, x2, y2, r) {
    if (!this._cur) return this.moveTo(x1, y1);
    const [x0, y0] = apply(invert(this._m), this._cur[0], this._cur[1]);
    const v1x = x0 - x1, v1y = y0 - y1, v2x = x2 - x1, v2y = y2 - y1;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    const cross = v1x * v2y - v1y * v2x;
    if (!r || !l1 || !l2 || Math.abs(cross) < 1e-9) return this.lineTo(x1, y1);
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2))));
    const t = r / Math.tan(ang / 2);
    const p1 = [x1 + (v1x / l1) * t, y1 + (v1y / l1) * t], p2 = [x1 + (v2x / l2) * t, y1 + (v2y / l2) * t];
    // the centre sits along the bisector, r away from both lines
    const bx = v1x / l1 + v2x / l2, by = v1y / l1 + v2y / l2, bl = Math.hypot(bx, by);
    const dc = Math.hypot(t, r);
    const c = [x1 + (bx / bl) * dc, y1 + (by / bl) * dc];
    const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]), a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    this.lineTo(p1[0], p1[1]);
    this.arc(c[0], c[1], r, a0, a1, cross > 0);
  }

  // ── painting ──
  fill(rule) {
    if (rule && typeof rule === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    if (!this._path.length) return;
    this._paintPath(this._path, rule === 'evenodd' ? 'f*' : 'f', true, false);
  }
  stroke(p) {
    if (p && typeof p === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    if (!this._path.length) return;
    this._paintPath(this._path, 'S', false, true);
  }
  clip(rule) {
    if (rule && typeof rule === 'object') return this._warn('path2d', 'Path2D is not supported — build the path on the context');
    this._out(this._pathOps(this._path) + (rule === 'evenodd' ? ' W* n' : ' W n'));
  }
  fillRect(x, y, w, h) { const seg = this._rectSeg(x, y, w, h); this._paintPath(seg, 'f', true, false); }
  strokeRect(x, y, w, h) { const seg = this._rectSeg(x, y, w, h); this._paintPath(seg, 'S', false, true); }
  clearRect() { /* a PDF page has no pixels to clear */ }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }

  _rectSeg(x, y, w, h) {
    const m = this._m, a = apply(m, x, y), b = apply(m, x + w, y), c = apply(m, x + w, y + h), d = apply(m, x, y + h);
    return [['m', ...a], ['l', ...b], ['l', ...c], ['l', ...d], ['h']];
  }
  _pathOps(seg) {
    return seg.map((s) => (s[0] === 'h' ? 'h' : s.slice(1).map(num).join(' ') + ' ' + s[0])).join('\n');
  }
  _colorOps(fill, stroke) {
    const parts = [];
    let fa = 1, sa = 1;
    if (fill) { const c = parseCssColor(this._st.fillStyle); parts.push(c.rgb.map(num).join(' ') + ' rg'); fa = c.a * this._st.globalAlpha; }
    if (stroke) { const c = parseCssColor(this._st.strokeStyle); parts.push(c.rgb.map(num).join(' ') + ' RG'); sa = c.a * this._st.globalAlpha; }
    const wantF = fill ? fa : this._alpha, wantS = stroke ? sa : this._alphaS;
    if (wantF !== this._alpha || wantS !== this._alphaS) {
      parts.push(`/${this._page._gs(wantF, wantS)} gs`);
      this._alpha = wantF; this._alphaS = wantS;
    }
    return { ops: parts.join(' '), visible: (fill ? fa : 1) > 0 && (stroke ? sa : 1) > 0 };
  }
  _strokeOps() {
    const s = scaleOf(this._m);
    const cap = { butt: 0, round: 1, square: 2 }[this._st.lineCap], join = { miter: 0, round: 1, bevel: 2 }[this._st.lineJoin];
    const dash = this._st.dash.length ? `[${this._st.dash.map((v) => num(v * s)).join(' ')}] ${num(this._st.lineDashOffset * s)} d` : '[] 0 d';
    return `${num(this._st.lineWidth * s)} w ${cap} J ${join} j ${num(this._st.miterLimit)} M ${dash}`;
  }
  _paintPath(seg, op, fill, stroke) {
    const col = this._colorOps(fill, stroke);
    if (!col.visible) return;
    this._out(`${col.ops}${stroke ? ' ' + this._strokeOps() : ''}\n${this._pathOps(seg)}\n${op}`);
  }

  // ── text ──
  measureText(text) {
    const f = parseFont(this._st.font);
    const w = textWidth(f.name, f.size, text);
    return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 0.72 * f.size, actualBoundingBoxDescent: 0.21 * f.size, fontBoundingBoxAscent: 0.8 * f.size, fontBoundingBoxDescent: 0.2 * f.size };
  }
  fillText(text, x, y, maxWidth) { this._text(text, x, y, maxWidth, 0); }
  strokeText(text, x, y, maxWidth) { this._text(text, x, y, maxWidth, 1); }
  _text(text, x, y, maxWidth, mode) {
    const f = parseFont(this._st.font);
    const enc = encodeRuns(text);                        // the page's font, with Greek and maths in Symbol runs
    if (enc.missing.size) this._warn('glyph:' + [...enc.missing].join(''), `characters ${[...enc.missing].map((c) => `“${c}”`).join(' ')} aren't in the standard PDF fonts — written as '?' (an embedded font would carry them)`);
    if (!enc.runs.some((r) => r.codes.length)) return;
    let w = textWidth(f.name, f.size, text);
    let sx = 1;
    if (maxWidth != null && maxWidth > 0 && w > maxWidth) { sx = maxWidth / w; w = maxWidth; }
    const align = this._st.textAlign, rtl = this._st.direction === 'rtl';
    const dx = align === 'center' ? -w / 2 : (align === 'right' || (align === 'end' && !rtl) || (align === 'start' && rtl)) ? -w : 0;
    const dy = baselineShift(this._st.textBaseline, f.size);
    // text space: x right, y UP (glyphs upright) — flip the y-down user space under the anchor
    const tm = mul(this._m, [sx, 0, 0, -1, x + dx, y + dy]);
    const col = this._colorOps(mode === 0, mode === 1);
    if (!col.visible) return;
    const sw = mode === 1 ? ` ${num(this._st.lineWidth * scaleOf(this._m))} w` : '';
    // one text object; a run switches font (Tj advances by each glyph's width, so the runs follow on). The first
    // run's font is set BEFORE the text matrix, as it always was — `… Tf <m> Tm (text) Tj` — so a string with no
    // Greek in it reads exactly as before; only a switch mid-string adds a Tf between the Tjs
    const runs = enc.runs.filter((r) => r.codes.length); if (!runs.length) return;
    const tf = (r) => `/${this._page._font(r.symbol ? 'Symbol' : f.name)} ${num(f.size)} Tf`;
    const shows = runs.map((r, i) => `${i ? tf(r) + ' ' : ''}${pdfString(r.codes)} Tj`);
    this._out(`${col.ops}${sw}\nBT ${tf(runs[0])} ${mode} Tr ${tm.map(num).join(' ')} Tm ${shows.join(' ')} ET`);
  }

  // ── images ──
  /** a LINK over a rectangle of the user space: clickable in a PDF reader (a canvas has no such thing — callers check
   *  for ctx.link). Only http(s) and mailto: a figure is not a place for javascript: or file links. → true if added */
  link(x, y, w, h, url) {
    if (!/^(https?:|mailto:)/i.test(String(url || '').trim())) { this._warn('link', `not a web or mail link: ${String(url).slice(0, 60)}`); return false; }
    const m = this._m, pt = (px, py) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
    const cs = [pt(x, y), pt(x + w, y), pt(x, y + h), pt(x + w, y + h)];
    const xs = cs.map((q) => q[0]), ys = cs.map((q) => q[1]);
    this._page._links.push({ rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], url: String(url).trim() });
    return true;
  }
  drawImage(src, a, b, c, d, e, f, g, h) {
    let sx = 0, sy = 0, sw, sh, dx, dy, dw, dh;
    const iw = src && (src.naturalWidth || src.videoWidth || src.width), ih = src && (src.naturalHeight || src.videoHeight || src.height);
    if (!iw || !ih) return;
    if (e === undefined) { dx = a; dy = b; dw = c === undefined ? iw : c; dh = d === undefined ? ih : d; sw = iw; sh = ih; }
    else { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g; dh = h; }
    const img = this._page._image(src, sx, sy, sw, sh, this._st.imageSmoothingEnabled, (k, m) => this._warn(k, m));
    if (!img) return;
    // the unit square (row 0 at the top, y = 1) onto the destination rect, y-down user space
    const cm = mul(this._m, [dw, 0, 0, -dh, dx, dy + dh]);
    const ga = this._st.globalAlpha;
    let gs = '';
    if (ga !== this._alpha) { gs = `/${this._page._gs(ga, this._alphaS)} gs `; this._alpha = ga; }
    if (ga <= 0) return;
    this._out(`q ${gs}${cm.map(num).join(' ')} cm /${img} Do Q`);
  }
  putImageData(imageData, dx, dy) {
    const m = this._m; this._m = this._base.slice();
    this.drawImage(imageData, dx, dy);
    this._m = m;
  }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData() { throw new Error('@gcu/pdf: getImageData — a PDF page has no pixels to read'); }

  // gradients / patterns: accepted (so canvas code runs) and drawn as their first stop, with a word
  createLinearGradient() { return this._gradient(); }
  createRadialGradient() { return this._gradient(); }
  createConicGradient() { return this._gradient(); }
  createPattern() { return this._gradient(); }
  _gradient() { const g = { _stops: [], addColorStop(o, c) { this._stops.push([o, c]); this._stops.sort((p, q) => p[0] - q[0]); } }; return g; }

  _out(s) { this._page._ops.push(s); }
  _warn(key, msg) { this._doc._warn(key, msg); }
}

// exposed for tests
export const _matrix = { mul, apply, invert, KAPPA };
