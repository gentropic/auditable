// SVG EXPORT — a page as an SVG document: the frames draw through a 2D context that writes SVG elements instead of
// pixels (as the PDF export writes PDF operators), so every kind — the host's too — comes out as vectors, editable in
// Inkscape or Illustrator. Pictures are embedded (data: URLs); text stays text.
//
// The context records paths in user units (mm) and writes each with the CURRENT transform as a matrix; a clip opens
// a <g clip-path>, closed when the save it belongs to is restored. Measuring text needs a real canvas (a browser);
// without one, an estimate.

import { renderPage, ensureImages } from './render.js';
import { pageDims } from './model.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.abs(v) < 1e-9 ? '0' : String(+(+v).toFixed(4)));
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

// "bold italic 3.175px "Barlow", sans-serif" → { weight, style, size, family }
function parseFont(f) {
  const m = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*)([\d.]+)px\s+(.+)$/.exec(String(f || ''));
  if (!m) return { weight: 'normal', style: 'normal', size: 3, family: 'sans-serif' };
  const pre = m[1];
  return { weight: /bold|[6-9]00/.test(pre) ? 'bold' : 'normal', style: /italic|oblique/.test(pre) ? 'italic' : 'normal', size: +m[2], family: m[3].replace(/"/g, "'") };
}

class SvgContext2D {
  constructor(measure) {
    this._out = []; this._defs = []; this._ids = 0; this._measure = measure;
    this._m = [1, 0, 0, 1, 0, 0]; this._stack = []; this._open = 0;
    Object.assign(this, { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
      font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', imageSmoothingEnabled: true });
    this._dash = []; this._path = '';
    this.acceptsImageData = false;
  }
  // ── state ──
  save() { this._stack.push({ m: [...this._m], dash: [...this._dash], open: this._open, st: { fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, globalAlpha: this.globalAlpha, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline } }); this._open = 0; }
  restore() {
    const s = this._stack.pop(); if (!s) return;
    while (this._open > 0) { this._out.push('</g>'); this._open--; }   // the clips this save opened
    this._m = s.m; this._dash = s.dash; this._open = s.open; Object.assign(this, s.st);
  }
  translate(x, y) { this._m = mul(this._m, [1, 0, 0, 1, x, y]); }
  scale(x, y) { this._m = mul(this._m, [x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._m = mul(this._m, [c, s, -s, c, 0, 0]); }
  transform(a, b, c, d, e, f) { this._m = mul(this._m, [a, b, c, d, e, f]); }
  setTransform(a, b, c, d, e, f) { this._m = typeof a === 'object' && a ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]; }
  resetTransform() { this._m = [1, 0, 0, 1, 0, 0]; }
  getTransform() { const [a, b, c, d, e, f] = this._m; return { a, b, c, d, e, f }; }
  setLineDash(d) { this._dash = [...(d || [])]; }
  getLineDash() { return [...this._dash]; }
  // ── paths (user units) ──
  beginPath() { this._path = ''; }
  moveTo(x, y) { this._path += `M${n(x)} ${n(y)}`; }
  lineTo(x, y) { this._path += `L${n(x)} ${n(y)}`; }
  closePath() { this._path += 'Z'; }
  bezierCurveTo(a, b, c, d, e, f) { this._path += `C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)}`; }
  quadraticCurveTo(a, b, c, d) { this._path += `Q${n(a)} ${n(b)} ${n(c)} ${n(d)}`; }
  rect(x, y, w, h) { this._path += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`; }
  roundRect(x, y, w, h, r = 0) { const rr = Math.min(Math.abs(+(Array.isArray(r) ? r[0] : r) || 0), Math.abs(w) / 2, Math.abs(h) / 2); if (!rr) return this.rect(x, y, w, h);
    this._path += `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)}V${n(y + h - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - rr)} ${n(y + h)}H${n(x + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}V${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`; }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    // sampled into segments: exact enough at print size, and one code path for arcs of any sweep
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI; if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const k = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 32))), cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= k; i++) {
      const t = a0 + (sweep * i) / k, px = rx * Math.cos(t), py = ry * Math.sin(t), x = cx + px * cr - py * sr, y = cy + px * sr + py * cr;
      this._path += `${i === 0 && !this._path ? 'M' : 'L'}${n(x)} ${n(y)}`;   // (an arc after a point joins it, as on a canvas)
    }
  }
  arcTo(x1, y1) { this.lineTo(x1, y1); }
  _tf() { const [a, b, c, d, e, f] = this._m; return a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0 ? '' : ` transform="matrix(${[a, b, c, d, e, f].map(n).join(' ')})"`; }
  _alpha() { return this.globalAlpha < 1 ? this.globalAlpha : null; }
  _paint(kind) {
    const style = this[kind === 'fill' ? 'fillStyle' : 'strokeStyle'];
    if (typeof style !== 'string') return '';
    const op = this._alpha();
    if (kind === 'fill') return ` fill="${esc(style)}" stroke="none"${op != null ? ` fill-opacity="${n(op)}"` : ''}`;
    return ` fill="none" stroke="${esc(style)}" stroke-width="${n(this.lineWidth)}" stroke-linecap="${this.lineCap}" stroke-linejoin="${this.lineJoin}"${this._dash.length ? ` stroke-dasharray="${this._dash.map(n).join(' ')}"` : ''}${op != null ? ` stroke-opacity="${n(op)}"` : ''}`;
  }
  fill(rule) { if (this._path) this._out.push(`<path d="${this._path}"${this._paint('fill')}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this._tf()}/>`); }
  stroke() { if (this._path) this._out.push(`<path d="${this._path}"${this._paint('stroke')}${this._tf()}/>`); }
  clip() {
    const id = `c${++this._ids}`;
    this._defs.push(`<clipPath id="${id}"><path d="${this._path || 'M0 0'}"${this._tf()}/></clipPath>`);
    this._out.push(`<g clip-path="url(#${id})">`); this._open++;
  }
  fillRect(x, y, w, h) { const p = this._path; this.beginPath(); this.rect(x, y, w, h); this.fill(); this._path = p; }
  strokeRect(x, y, w, h) { const p = this._path; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this._path = p; }
  clearRect() { /* a page starts blank; nothing to clear */ }
  // ── text ──
  measureText(t) { if (this._measure) { this._measure.font = this.font; return this._measure.measureText(String(t)); } const f = parseFont(this.font); return { width: String(t).length * f.size * 0.52 }; }
  fillText(t, x, y) { this._text(t, x, y, this._paint('fill')); }
  strokeText(t, x, y) { this._text(t, x, y, this._paint('stroke')); }
  _text(t, x, y, paint) {
    const f = parseFont(this.font), al = this.textAlign;
    const anchor = al === 'center' ? 'middle' : (al === 'right' || al === 'end') ? 'end' : 'start';
    const base = { top: 'text-before-edge', hanging: 'hanging', middle: 'central', bottom: 'text-after-edge', ideographic: 'ideographic' }[this.textBaseline];
    this._out.push(`<text x="${n(x)}" y="${n(y)}" font-family="${esc(f.family)}" font-size="${n(f.size)}"${f.weight !== 'normal' ? ` font-weight="${f.weight}"` : ''}${f.style !== 'normal' ? ` font-style="${f.style}"` : ''} text-anchor="${anchor}"${base ? ` dominant-baseline="${base}"` : ''} xml:space="preserve"${paint}${this._tf()}>${esc(t)}</text>`);
  }
  // ── pictures: a data: URL each ──
  drawImage(src, a, b, c, d, e, f, g, h) {
    const url = dataUrlOf(src); if (!url) return;
    const iw = src.naturalWidth || src.videoWidth || src.width, ih = src.naturalHeight || src.videoHeight || src.height;
    let sx = 0, sy = 0, sw = iw, sh = ih, dx, dy, dw, dh;
    if (e === undefined) { dx = a; dy = b; dw = c ?? iw; dh = d ?? ih; } else { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g; dh = h; }
    const op = this._alpha();
    this._out.push(`<svg x="${n(dx)}" y="${n(dy)}" width="${n(dw)}" height="${n(dh)}" viewBox="${n(sx)} ${n(sy)} ${n(sw)} ${n(sh)}" preserveAspectRatio="none" overflow="hidden"${this._tf()}${op != null ? ` opacity="${n(op)}"` : ''}><image width="${n(iw)}" height="${n(ih)}" href="${url}"${this.imageSmoothingEnabled === false ? ' style="image-rendering:pixelated"' : ''}/></svg>`);
  }
  // a link: an <a> over the rectangle (the SVG equivalent of the PDF's)
  link(x, y, w, h, url) { if (!/^(https?:|mailto:)/i.test(String(url))) return false; this._out.push(`<a href="${esc(url)}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="transparent"${this._tf()}/></a>`); return true; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  isPointInPath() { return false; }
}
function dataUrlOf(src) {
  if (!src) return null;
  if (typeof src.src === 'string' && /^data:/.test(src.src)) return src.src;
  if (typeof document === 'undefined') return null;
  try {
    const iw = src.naturalWidth || src.videoWidth || src.width, ih = src.naturalHeight || src.videoHeight || src.height;
    const cv = Object.assign(document.createElement('canvas'), { width: iw, height: ih });
    cv.getContext('2d').drawImage(src, 0, 0);
    return cv.toDataURL('image/png');
  } catch { return null; }
}

/** a compo document → an SVG string (mm units: width/height in mm, viewBox in mm). opts.env as renderPage's */
export async function exportSVG(doc, opts = {}) {
  const env = opts.env || {};
  if (env.prepare) await env.prepare(doc, { dpi: opts.dpi || 200, page: 1 });   // a host re-renders its pictures (micro's 3D views)
  await ensureImages(doc);
  const [W, H] = pageDims(doc.page);
  const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  const ctx = new SvgContext2D(measure);
  renderPage(doc, ctx, { ...env, page: 1, pages: 1 });
  while (ctx._stack.length) ctx.restore();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(W)}mm" height="${n(H)}mm" viewBox="0 0 ${n(W)} ${n(H)}">\n`
    + `<title>${esc(doc.title || 'figure')}</title>\n${ctx._defs.length ? `<defs>${ctx._defs.join('')}</defs>\n` : ''}${ctx._out.join('\n')}\n</svg>\n`;
}
export { SvgContext2D };
