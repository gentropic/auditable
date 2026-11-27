// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/pdf — A small PDF writer (zero dependencies, no WASM) with a CanvasRenderingContext2D-compatible drawing context: code that draws on a canvas draws a vector PDF page — paths as PDF paths, text in the standard fonts, images as image XObjects at their own resolution. Multi-page documents, transparency, clipping, dashes, deflate via the platform's CompressionStream. For figures, report pages and atlases from GCU tools.

// ── src/color.js ──

// CSS colour strings → [r, g, b] in 0..1 plus an alpha, for the PDF operators (rg / RG and an
// ExtGState's ca / CA). The forms canvas code actually hands a context: #rgb #rgba #rrggbb
// #rrggbbaa, rgb()/rgba() with commas or spaces (numbers or percentages, a slash alpha), and
// the named colours. Anything else is null — the context warns and keeps the previous colour.

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', teal: '#008080', navy: '#000080', fuchsia: '#ff00ff',
  purple: '#800080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  dimgray: '#696969', dimgrey: '#696969', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b',
  steelblue: '#4682b4', tomato: '#ff6347', coral: '#ff7f50', crimson: '#dc143c', khaki: '#f0e68c',
  salmon: '#fa8072', tan: '#d2b48c', beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa', whitesmoke: '#f5f5f5',
  slategray: '#708090', slategrey: '#708090', skyblue: '#87ceeb', royalblue: '#4169e1', seagreen: '#2e8b57',
  forestgreen: '#228b22', darkorange: '#ff8c00', chocolate: '#d2691e', sienna: '#a0522d', firebrick: '#b22222',
};

const chan = (s, max) => (String(s).endsWith('%') ? (parseFloat(s) / 100) * max : parseFloat(s));

// → { rgb: [r, g, b] 0..1, a: 0..1 } or null
function parseCssColor(c) {
  if (c == null) return null;
  let s = String(c).trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return { rgb: [0, 0, 0], a: 0 };
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    const v = [0, 2, 4, 6].map((k) => (k < h.length ? parseInt(h.slice(k, k + 2), 16) : 255));
    return { rgb: [v[0] / 255, v[1] / 255, v[2] / 255], a: v[3] / 255 };
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const rgb = parts.slice(0, 3).map((p) => Math.max(0, Math.min(255, chan(p, 255))) / 255);
    const a = parts.length > 3 ? Math.max(0, Math.min(1, chan(parts[3], 1))) : 1;
    return rgb.every((v) => v === v) && a === a ? { rgb, a } : null;
  }
  return null;
}

// ── src/fonts.js ──

// The PDF STANDARD fonts — Helvetica, Courier, Times, each with a bold face — which every PDF
// reader carries, so nothing is embedded and a page stays a few KB. A CSS font string picks one:
// a monospace stack → Courier, a serif stack → Times, anything else → Helvetica. Courier is
// exactly 0.6 em a glyph, which is the advance @gcu/plot lays every label out with, so a plot's
// text lands where its layout put it.
//
// Text is encoded WinAnsi (the standard fonts' encoding): ASCII and Latin-1 as themselves, the
// typographic marks (– — ‘ ’ “ ” • … € ™) in 128–159, and a few characters GCU text uses that the
// encoding lacks substituted by their plain forms (− → -, ≥ → >=, → → ->). Anything else is
// replaced by '?' and reported once, by the caller — an embedded font is the fix for those.

// advance widths, 1/1000 em, for codes 32..126
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
// widths for the non-ASCII WinAnsi characters that aren't an accented letter (those take their
// base letter's): per family [helvetica, times]; Courier is 600 throughout
const EXTRA = {
  ' ': [278, 250], '×': [584, 564], '÷': [584, 564], '°': [400, 400], '±': [584, 564], 'µ': [556, 500],
  '·': [278, 250], '–': [556, 500], '—': [1000, 1000], '‘': [222, 333], '’': [222, 333], '“': [333, 444], '”': [333, 444],
  '•': [350, 350], '…': [1000, 1000], '€': [556, 500], '™': [1000, 980], '¹': [333, 300], '²': [333, 300], '³': [333, 300],
  '¼': [834, 750], '½': [834, 750], '¾': [834, 750], '©': [737, 760], '®': [737, 760], '§': [556, 500], '¶': [537, 453],
  '¢': [556, 500], '£': [556, 500], '¥': [556, 500], 'ß': [611, 500], '¿': [611, 444], '¡': [333, 333], '«': [556, 500], '»': [556, 500],
};
// WinAnsi codes 128..159
const WIN_HIGH = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
// characters neither WinAnsi nor Symbol has, written as their plain forms
const SUBST = { 'μ': 'µ', '∙': '·', '⋅': '·', ' ': ' ', ' ': ' ', ' ': ' ' };

// The standard SYMBOL font — every PDF reader carries it, like the others — has the Greek alphabet and the
// mathematical signs WinAnsi lacks: κ α σ for the statistics, ≥ ≤ → for the notation. Text is written in runs:
// what WinAnsi encodes in the page's font, these in Symbol (its own built-in encoding). [code, width /1000 em]
// from the Symbol AFM. (SUBST above now holds only what neither font has.)
const SYMBOL = {
  'α': [0x61, 631], 'β': [0x62, 549], 'γ': [0x67, 411], 'δ': [0x64, 494], 'ε': [0x65, 439], 'ζ': [0x7a, 494], 'η': [0x68, 603], 'θ': [0x71, 521],
  'ι': [0x69, 329], 'κ': [0x6b, 549], 'λ': [0x6c, 549], 'ν': [0x6e, 521], 'ξ': [0x78, 493], 'ο': [0x6f, 549], 'π': [0x70, 549], 'ρ': [0x72, 549],
  'σ': [0x73, 603], 'ς': [0x56, 439], 'τ': [0x74, 439], 'υ': [0x75, 576], 'φ': [0x66, 521], 'χ': [0x63, 549], 'ψ': [0x79, 686], 'ω': [0x77, 686],
  'Γ': [0x47, 603], 'Δ': [0x44, 612], 'Θ': [0x51, 741], 'Λ': [0x4c, 686], 'Ξ': [0x58, 645], 'Π': [0x50, 768], 'Σ': [0x53, 592], 'Υ': [0xa1, 620],
  'Φ': [0x46, 763], 'Ψ': [0x59, 795], 'Ω': [0x57, 768], 'ϕ': [0x6a, 603], 'ϑ': [0x4a, 631],
  '≥': [0xb3, 549], '≤': [0xa3, 549], '≠': [0xb9, 549], '≈': [0xbb, 549], '≡': [0xba, 549], '∞': [0xa5, 713], '∝': [0xb5, 713],
  '→': [0xae, 987], '←': [0xac, 987], '↑': [0xad, 603], '↓': [0xaf, 603], '↔': [0xab, 1042], '⇒': [0xde, 987], '⇐': [0xdc, 987],
  '−': [0x2d, 549], '′': [0xa2, 247], '″': [0xb2, 411], '√': [0xd6, 549], '∑': [0xe5, 713], '∏': [0xd5, 823], '∂': [0xb6, 494],
  '∫': [0xf2, 274], '∇': [0xd1, 713], '∈': [0xce, 713], '∉': [0xcf, 713], '∩': [0xc7, 768], '∪': [0xc8, 768], '⊂': [0xcc, 713],
  '∧': [0xd9, 603], '∨': [0xda, 603], '∀': [0x22, 713], '∃': [0x24, 549], '∅': [0xc6, 823], '∠': [0xd0, 768],
  '⊥': [0x5e, 658], '∴': [0x5c, 863], '∼': [0x7e, 549],
};
const isSymbolChar = (ch) => Object.prototype.hasOwnProperty.call(SYMBOL, ch);
/** text → runs: { symbol: bool, codes, text, missing } — WinAnsi runs for the page's font, Symbol runs for SYMBOL's */
function encodeRuns(text) {
  const runs = [], missing = new Set();
  let cur = null;
  for (const ch of String(text)) {
    const sym = isSymbolChar(ch);
    if (!cur || cur.symbol !== sym) { cur = { symbol: sym, codes: [], text: '' }; runs.push(cur); }
    if (sym) { cur.codes.push(SYMBOL[ch][0]); cur.text += ch; }
    else { const e = encodeWinAnsi(ch); cur.codes.push(...e.codes); cur.text += e.text; for (const m of e.missing) missing.add(m); }
  }
  return { runs, missing };
}

// (the italics come after the uprights, so a page's F1…F6 tags stay what they were; Symbol after them)
const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold', 'Times-Roman', 'Times-Bold',
  'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Courier-Oblique', 'Courier-BoldOblique', 'Times-Italic', 'Times-BoldItalic', 'Symbol'];

// a CSS font string → { name (a standard font), size (px of the user space), mono, serif, bold, italic }
function parseFont(css) {
  const s = String(css || '10px sans-serif');
  const m = /(\d+(?:\.\d+)?)px/.exec(s);
  const size = m ? +m[1] : 10;
  const pre = s.slice(0, m ? m.index : s.length);
  const bold = /\b(bold|bolder|[6-9]00)\b/.test(pre), italic = /\b(italic|oblique)\b/.test(pre);
  const fam = (m ? s.slice(m.index + m[0].length) : s).replace(/^\s*\/\s*[\d.]+\w*/, '').toLowerCase();
  // the FIRST family decides (a stack's fallbacks don't): 'Space Mono', … monospace → mono
  const first = (fam.split(',')[0] || '').trim();
  const mono = /mono|courier|consol|menlo|code|fixed|typewriter/.test(first) || (/\bmonospace\b/.test(fam) && !/sans|serif|helvetica|arial|barlow|system-ui/.test(first));
  const serif = !mono && (/(^|[^-])\bserif\b|times|georgia|garamond|cambria|book/.test(first) && !/sans/.test(first));
  const name = mono ? (bold ? (italic ? 'Courier-BoldOblique' : 'Courier-Bold') : (italic ? 'Courier-Oblique' : 'Courier'))
    : serif ? (bold ? (italic ? 'Times-BoldItalic' : 'Times-Bold') : (italic ? 'Times-Italic' : 'Times-Roman'))
      : (bold ? (italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (italic ? 'Helvetica-Oblique' : 'Helvetica'));
  return { name, size, mono, serif, bold, italic };
}

const baseLetter = (ch) => { const d = ch.normalize('NFD'); return d.length > 1 && d.charCodeAt(0) < 128 ? d[0] : null; };

// the width of ONE (already encodable) character in 1/1000 em. The obliques share their upright's metrics
// exactly (Helvetica, Courier); Times-Italic's are close to Times-Roman's, which stand in for them
function charWidth(name, ch) {
  if (name.startsWith('Courier')) return 600;
  const tbl = name.startsWith('Helvetica-Bold') ? HELVB : name.startsWith('Times') ? TIMES : HELV;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tbl[c - 32];
  const e = EXTRA[ch];
  if (e) return name.startsWith('Times') ? e[1] : e[0];
  const b = baseLetter(ch);
  if (b) return tbl[b.charCodeAt(0) - 32];
  return name.startsWith('Times') ? 500 : 556;
}

// text → { codes: WinAnsi byte values, text: the encodable string, missing: Set of characters replaced by '?' }
function encodeWinAnsi(text) {
  const codes = [], missing = new Set();
  let out = '';
  for (const ch0 of String(text)) {
    const sub = SUBST[ch0];
    for (const ch of sub != null ? sub : ch0) {
      const c = ch.codePointAt(0);
      let code;
      if (c >= 32 && c <= 126) code = c;
      else if (c >= 160 && c <= 255) code = c;
      else if (WIN_HIGH[ch] != null) code = WIN_HIGH[ch];
      else if (c === 9) code = 32;
      else { code = 63; missing.add(ch); }
      codes.push(code);
      out += code === 63 && ch !== '?' ? '?' : ch;
    }
  }
  return { codes, text: out, missing };
}

// the advance of a string, in the font's units × size (1/1000 em · px → px)
function textWidth(name, size, text) {
  let w = 0;
  for (const r of encodeRuns(text).runs) {
    if (r.symbol) for (const ch of r.text) w += SYMBOL[ch][1];
    else for (const ch of r.text) w += charWidth(name, ch);
  }
  return (w / 1000) * size;
}

// a PDF literal string from WinAnsi codes: ( ) \ escaped, bytes ≥ 128 as octal
function pdfString(codes) {
  let s = '(';
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

// the vertical offset (in px, positive = down in the canvas' y-down space) from the anchor y to the
// baseline, per textBaseline — the em box's proportions (ascent 0.8, descent 0.2), as browsers use
function baselineShift(baseline, size) {
  switch (baseline) {
    case 'top': return 0.8 * size;
    case 'hanging': return 0.8 * size;
    case 'middle': return 0.3 * size;
    case 'bottom': return -0.2 * size;
    case 'ideographic': return -0.2 * size;
    default: return 0;                                   // alphabetic
  }
}

// ── src/context.js ──

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


const KAPPA = 0.5522847498307936;
// numbers as PDF writes them: short, never an exponent, no -0
function num(v) {
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

class PdfContext2D {
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
    // one text object; a run switches font (Tj advances by each glyph's width, so the runs follow on)
    const shows = enc.runs.filter((r) => r.codes.length).map((r) => `/${this._page._font(r.symbol ? 'Symbol' : f.name)} ${num(f.size)} Tf ${pdfString(r.codes)} Tj`);
    this._out(`${col.ops}${sw}\nBT ${mode} Tr ${tm.map(num).join(' ')} Tm ${shows.join(' ')} ET`);
  }

  // ── images ──
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
const _matrix = { mul, apply, invert, KAPPA };

// ── src/sizes.js ──

// Page sizes and units. PDF works in POINTS (1/72 in); a page is given in points, and these turn
// the paper names and millimetres people think in into them.

const PT_PER_MM = 72 / 25.4;
const mm = (v) => v * PT_PER_MM;

// width × height in mm, portrait
const MM = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};
const PAGE_SIZES = Object.fromEntries(Object.entries(MM).map(([k, [w, h]]) => [k, [mm(w), mm(h)]]));

// pageSize('A4') · pageSize('A3', 'landscape') · pageSize([200, 150]) → [w, h] in points. A named size
// is portrait unless told otherwise; a custom [w, h] stays as given unless an orientation is named.
function pageSize(size = 'A4', orientation = null, units = 'mm') {
  let wh;
  if (Array.isArray(size)) wh = units === 'pt' ? size.slice(0, 2) : size.slice(0, 2).map(mm);
  else {
    const key = Object.keys(MM).find((k) => k.toLowerCase() === String(size).toLowerCase());
    if (!key) throw new Error(`@gcu/pdf: no page size '${size}' (${Object.keys(MM).join(', ')}, or [w, h])`);
    wh = PAGE_SIZES[key].slice();
  }
  const [a, b] = wh;
  if (orientation == null) return Array.isArray(size) ? [a, b] : [Math.min(a, b), Math.max(a, b)];
  return orientation === 'landscape' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

// ── src/document.js ──

// The document: pages, the resources they share (fonts, transparency states, images — each
// written once however many pages use it), and the file. `save()` is async because content and
// images are deflated with the platform's CompressionStream (no bundled zlib, no WASM).


const enc = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// a PDF text string: ASCII as a literal, anything else as UTF-16BE hex with a BOM
function textString(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return '<' + hex + '>';
}
const pdfDate = (d) => {
  const p = (n, k = 2) => String(n).padStart(k, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};
// a short content hash for the trailer /ID (FNV-1a, two lanes)
function idHash(chunks) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { a = Math.imul(a ^ c[i], 16777619) >>> 0; b = Math.imul(b ^ c[i], 2246822519) >>> 0; }
  return [a, b, a ^ b, (a + b) >>> 0].map((v) => v.toString(16).padStart(8, '0')).join('');
}

class PdfPage {
  constructor(doc, width, height, units) {
    this._doc = doc;
    this.width = width; this.height = height;              // points
    this._ops = [];
    this._fonts = new Map(); this._gss = new Map(); this._images = new Map();
    this._units = units;
  }
  // a 2D context over this page; units 'pt' (default) or 'mm' for the user space
  getContext(kind = '2d', { units } = {}) {
    if (kind !== '2d') throw new Error(`@gcu/pdf: only a '2d' context (got '${kind}')`);
    const u = units || this._units || 'pt', k = u === 'mm' ? 72 / 25.4 : 1;
    // user space (y down, from the top-left) → PDF page space (y up, from the bottom-left)
    return new PdfContext2D(this, [k, 0, 0, -k, 0, this.height]);
  }
  _font(name) {
    if (!this._fonts.has(name)) this._fonts.set(name, 'F' + (STANDARD_FONTS.indexOf(name) + 1));
    return this._fonts.get(name);
  }
  _gs(ca, CA) {
    const key = `${num(ca)}/${num(CA)}`;
    if (!this._gss.has(key)) this._gss.set(key, { name: 'GS' + (this._doc._gsKeys.indexOf(key) >= 0 ? this._doc._gsKeys.indexOf(key) : this._doc._gsKeys.push(key) - 1), ca, CA });
    return this._gss.get(key).name;
  }
  _image(src, sx, sy, sw, sh, smooth, warn) {
    const img = this._doc._imageOf(src, sx, sy, sw, sh, smooth, warn);
    if (!img) return null;
    this._images.set(img.name, img);
    return img.name;
  }
}

class PdfDocument {
  // { title, author, subject, keywords, creator, created (Date or ISO string — for reproducible output),
  //   compress (default true), onWarn(msg), strict (warnings throw) }
  constructor(opts = {}) {
    this.opts = { compress: true, ...opts };
    this.pages = [];
    this.warnings = [];
    this._warned = new Set();
    this._gsKeys = [];
    this._imgs = [];                                       // { name, w, h, rgb, alpha, jpeg, smooth }
    this._imgCache = new WeakMap();
    this._files = [];                                      // attachments: { name, bytes, mime, description, relationship }
  }
  // attach a file to the document (PDF 2.0 / PDF/A-3 style: an embedded file, listed in the
  // catalog's EmbeddedFiles and /AF). data: a string (UTF-8) or bytes. relationship: Source,
  // Data, Alternative, Supplement or Unspecified (default Source — what the page was made from).
  attach(name, data, { mime = 'application/octet-stream', description = '', relationship = 'Source' } = {}) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    this._files.push({ name: String(name), bytes, mime, description, relationship });
    return this;
  }
  // addPage() → A4 portrait · addPage('A3', 'landscape') · addPage([w, h]) in mm · addPage({ width, height }) in points
  addPage(size = 'A4', orientation = null, { units = 'pt' } = {}) {
    let w, h;
    if (size && typeof size === 'object' && !Array.isArray(size)) { w = +size.width; h = +size.height; }
    else [w, h] = pageSize(size, orientation, 'mm');
    if (!(w > 0 && h > 0)) throw new Error('@gcu/pdf: a page needs a positive width and height');
    const p = new PdfPage(this, w, h, units);
    this.pages.push(p);
    return p;
  }

  _warn(key, msg) {
    if (this.opts.strict) throw new Error('@gcu/pdf: ' + msg);
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.warnings.push(msg);
    if (this.opts.onWarn) this.opts.onWarn(msg);
  }

  // pixels (or JPEG bytes) for an image source, cropped; cached per source + crop
  _imageOf(src, sx, sy, sw, sh, smooth, warn) {
    const key = `${sx},${sy},${sw},${sh},${smooth ? 1 : 0}`;
    const byKey = typeof src === 'object' && src ? (this._imgCache.get(src) || this._imgCache.set(src, new Map()).get(src)) : null;
    if (byKey && byKey.has(key)) return byKey.get(key);
    let rec = null;
    if (src.jpeg) {
      if (sx || sy || sw !== src.width || sh !== src.height) warn('jpegcrop', 'a cropped JPEG source is drawn whole (crop needs decoded pixels)');
      rec = { jpeg: src.jpeg instanceof Uint8Array ? src.jpeg : new Uint8Array(src.jpeg), w: src.width, h: src.height, smooth };
    } else {
      const px = pixelsOf(src);
      if (!px) { warn('imgsrc', 'drawImage: a source this context can\'t read pixels from (give ImageData, a canvas, an ImageBitmap or {jpeg, width, height})'); return null; }
      const x0 = Math.max(0, Math.round(sx)), y0 = Math.max(0, Math.round(sy));
      const w = Math.max(1, Math.min(px.width - x0, Math.round(sw))), h = Math.max(1, Math.min(px.height - y0, Math.round(sh)));
      const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
      let anyAlpha = false;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = ((y0 + r) * px.width + x0 + c) * 4, o = r * w + c;
        rgb[o * 3] = px.data[i]; rgb[o * 3 + 1] = px.data[i + 1]; rgb[o * 3 + 2] = px.data[i + 2];
        const a = px.data[i + 3]; alpha[o] = a; if (a !== 255) anyAlpha = true;
      }
      rec = { rgb, alpha: anyAlpha ? alpha : null, w, h, smooth };
    }
    rec.name = 'Im' + (this._imgs.push(rec) - 1);
    if (byKey) byKey.set(key, rec);
    return rec;
  }

  // → Uint8Array of the PDF file
  async save() {
    const objs = [];                                       // [id] = { dict, stream? } (1-based)
    const add = (o) => { objs.push(o); return objs.length; };
    const catalogId = add(null), pagesId = add(null);
    const compress = this.opts.compress !== false;
    const stream = async (dict, bytes) => {
      if (compress) { const z = await deflate(bytes); if (z) return { dict: `${dict} /Filter /FlateDecode /Length ${z.length}`, bytes: z }; }
      return { dict: `${dict} /Length ${bytes.length}`, bytes };
    };
    // shared resources: fonts used anywhere, gs states, images
    const fontsUsed = new Set(); for (const p of this.pages) for (const n of p._fonts.keys()) fontsUsed.add(n);
    const fontIds = {};
    for (const n of fontsUsed) fontIds[n] = add({ dict: `<< /Type /Font /Subtype /Type1 /BaseFont /${n}${n === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding'} >>` });   // Symbol keeps its own built-in encoding
    const gsIds = {};
    this._gsKeys.forEach((k, i) => { const [ca, CA] = k.split('/'); gsIds['GS' + i] = add({ dict: `<< /Type /ExtGState /ca ${ca} /CA ${CA} >>` }); });
    const imgIds = {};
    for (const im of this._imgs) {
      if (im.jpeg) {
        imgIds[im.name] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Interpolate ${im.smooth} /Length ${im.jpeg.length} >>`, bytes: im.jpeg });
        continue;
      }
      let smask = '';
      if (im.alpha) {
        const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate ${im.smooth}`, im.alpha);
        const sid = add({ dict: s.dict + ' >>', bytes: s.bytes });
        smask = ` /SMask ${sid} 0 R`;
      }
      const s = await stream(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${im.smooth}${smask}`, im.rgb);
      imgIds[im.name] = add({ dict: s.dict + ' >>', bytes: s.bytes });
    }
    // pages
    const pageIds = [];
    for (const p of this.pages) {
      const content = await stream('<<', enc(p._ops.join('\n')));
      const cid = add({ dict: content.dict + ' >>', bytes: content.bytes });
      const res = [];
      if (p._fonts.size) res.push(`/Font << ${[...p._fonts].map(([n, tag]) => `/${tag} ${fontIds[n]} 0 R`).join(' ')} >>`);
      if (p._gss.size) res.push(`/ExtGState << ${[...p._gss.values()].map((g) => `/${g.name} ${gsIds[g.name]} 0 R`).join(' ')} >>`);
      if (p._images.size) res.push(`/XObject << ${[...p._images.keys()].map((n) => `/${n} ${imgIds[n]} 0 R`).join(' ')} >>`);
      pageIds.push(add({ dict: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << ${res.join(' ')} >> /Contents ${cid} 0 R >>` }));
    }
    objs[pagesId - 1] = { dict: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>` };
    // attachments: an EmbeddedFile stream + a file spec each; the catalog lists them (sorted by name)
    const fileSpecs = [];
    for (const f of this._files) {
      const mimeName = f.mime.replace(/[^\w.+-]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
      const st = await stream(`<< /Type /EmbeddedFile /Subtype /${mimeName} /Params << /Size ${f.bytes.length} >>`, f.bytes);
      const eid = add({ dict: st.dict + ' >>', bytes: st.bytes });
      const sid = add({ dict: `<< /Type /Filespec /F ${textString(f.name)} /UF ${textString(f.name)}${f.description ? ` /Desc ${textString(f.description)}` : ''} /EF << /F ${eid} 0 R /UF ${eid} 0 R >> /AFRelationship /${f.relationship} >>` });
      fileSpecs.push({ name: f.name, id: sid });
    }
    fileSpecs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const names = fileSpecs.length ? ` /Names << /EmbeddedFiles << /Names [${fileSpecs.map((f) => `${textString(f.name)} ${f.id} 0 R`).join(' ')}] >> >> /AF [${fileSpecs.map((f) => `${f.id} 0 R`).join(' ')}]` : '';
    objs[catalogId - 1] = { dict: `<< /Type /Catalog /Pages ${pagesId} 0 R${names} >>` };
    const o = this.opts, info = [];
    for (const [k, v] of [['Title', o.title], ['Author', o.author], ['Subject', o.subject], ['Keywords', o.keywords], ['Creator', o.creator]]) if (v) info.push(`/${k} ${textString(v)}`);
    info.push(`/Producer ${textString('@gcu/pdf')}`);
    info.push(`/CreationDate (${pdfDate(o.created instanceof Date ? o.created : o.created ? new Date(o.created) : new Date())})`);
    const infoId = add({ dict: `<< ${info.join(' ')} >>` });

    // the file: header, objects, xref, trailer
    const chunks = [enc('%PDF-1.7\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let at = chunks[0].length + chunks[1].length;
    const offsets = [];
    objs.forEach((ob, i) => {
      offsets[i] = at;
      const head = enc(`${i + 1} 0 obj\n${ob.dict}\n`);
      chunks.push(head); at += head.length;
      if (ob.bytes) {
        const s0 = enc('stream\n'), s1 = enc('\nendstream\n');
        chunks.push(s0, ob.bytes, s1); at += s0.length + ob.bytes.length + s1.length;
      }
      const tail = enc('endobj\n'); chunks.push(tail); at += tail.length;
    });
    const id = idHash(chunks);
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${at}\n%%EOF\n`;
    chunks.push(enc(xref));
    const total = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(total);
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}

// RGBA pixels of an image source: ImageData-like, a canvas (any kind), an ImageBitmap/image
function pixelsOf(src) {
  if (src && src.data && src.width && src.height && src.data.length >= src.width * src.height * 4) return src;
  if (src && typeof src.getContext === 'function') {
    try { const g = src.getContext('2d'); if (g && g.getImageData) return g.getImageData(0, 0, src.width, src.height); } catch { /* a WebGL canvas: below */ }
  }
  const w = src && (src.naturalWidth || src.videoWidth || src.width), h = src && (src.naturalHeight || src.videoHeight || src.height);
  if (!w || !h) return null;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0); return g.getImageData(0, 0, w, h);
  } catch { return null; }
}

// ── reading attachments back: enough of a PDF reader for files that keep their objects in the
// open (this writer's, and most simple PDFs; not object streams or encrypted files). Returns
// [{ name, bytes, mime, description }]. ──
async function readAttachments(pdfBytes) {
  const u8 = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  let text = ''; for (let i = 0; i < u8.length; i += 65536) text += String.fromCharCode.apply(null, u8.subarray(i, i + 65536));
  const objAt = new Map();                                 // object number → offset of "n 0 obj" (the last one wins: incremental updates)
  for (const m of text.matchAll(/(?:^|[\r\n\s])(\d+)\s+0\s+obj\b/g)) objAt.set(+m[1], m.index + m[0].length);
  const dictOf = (n) => { const at = objAt.get(n); if (at == null) return null; const end = text.indexOf('endobj', at); return text.slice(at, end < 0 ? undefined : end); };
  const strOf = (src) => {                                  // a literal (…) or hex <…> string → JS string
    if (!src) return '';
    if (src[0] === '<') { const hex = src.slice(1, -1).replace(/\s/g, ''); const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16)); if (b[0] === 0xfe && b[1] === 0xff) { let s2 = ''; for (let i = 2; i + 1 < b.length; i += 2) s2 += String.fromCharCode((b[i] << 8) | b[i + 1]); return s2; } return String.fromCharCode(...b); }
    return src.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[c] || (/^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c));
  };
  const STR = '(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)';
  const out = [];
  for (const [n] of objAt) {
    const d = dictOf(n); if (!d || !/\/Type\s*\/Filespec/.test(d)) continue;
    const name = strOf((new RegExp('/UF\\s*' + STR).exec(d) || new RegExp('/F\\s*' + STR).exec(d) || [])[1]);
    const desc = strOf((new RegExp('/Desc\\s*' + STR).exec(d) || [])[1]);
    const ef = /\/EF\s*<<[^>]*?\/F\s+(\d+)\s+0\s+R/.exec(d); if (!ef) continue;
    const sd = dictOf(+ef[1]); if (!sd) continue;
    const at = objAt.get(+ef[1]), sIdx = text.indexOf('stream', at);
    const len = +(/\/Length\s+(\d+)/.exec(sd) || [])[1];
    let start = sIdx + 6; if (text[start] === '\r') start++; if (text[start] === '\n') start++;
    let bytes = u8.slice(start, start + len);
    if (/\/Filter\s*\/FlateDecode/.test(sd)) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    const mime = ((/\/Subtype\s*\/([^\s/>]+)/.exec(sd) || [])[1] || '').replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    out.push({ name, bytes, mime, description: desc });
  }
  return out;
}

// ── src/main.js ──

// @gcu/pdf — a small PDF writer with a canvas-2D context. See README.md.

export {
  PdfDocument,
  PdfPage,
  readAttachments,
  PdfContext2D,
  pageSize,
  PAGE_SIZES,
  mm,
  PT_PER_MM,
  parseFont,
  textWidth,
  encodeWinAnsi,
  encodeRuns,
  isSymbolChar,
  STANDARD_FONTS,
  parseCssColor,
};
