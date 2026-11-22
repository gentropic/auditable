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
// characters the encoding lacks, written as their plain forms
const SUBST = { '−': '-', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '≠': '!=', '≈': '~', '′': "'", '″': '"', 'μ': 'µ', '∙': '·', '⋅': '·', ' ': ' ', ' ': ' ', ' ': ' ' };

export const STANDARD_FONTS = ['Helvetica', 'Helvetica-Bold', 'Courier', 'Courier-Bold', 'Times-Roman', 'Times-Bold'];

// a CSS font string → { name (a standard font), size (px of the user space), mono, serif, bold }
export function parseFont(css) {
  const s = String(css || '10px sans-serif');
  const m = /(\d+(?:\.\d+)?)px/.exec(s);
  const size = m ? +m[1] : 10;
  const bold = /\b(bold|bolder|[6-9]00)\b/.test(s.slice(0, m ? m.index : s.length));
  const fam = (m ? s.slice(m.index + m[0].length) : s).replace(/^\s*\/\s*[\d.]+\w*/, '').toLowerCase();
  // the FIRST family decides (a stack's fallbacks don't): 'Space Mono', … monospace → mono
  const first = (fam.split(',')[0] || '').trim();
  const mono = /mono|courier|consol|menlo|code|fixed|typewriter/.test(first) || (/\bmonospace\b/.test(fam) && !/sans|serif|helvetica|arial|barlow|system-ui/.test(first));
  const serif = !mono && (/(^|[^-])\bserif\b|times|georgia|garamond|cambria|book/.test(first) && !/sans/.test(first));
  const name = mono ? (bold ? 'Courier-Bold' : 'Courier') : serif ? (bold ? 'Times-Bold' : 'Times-Roman') : (bold ? 'Helvetica-Bold' : 'Helvetica');
  return { name, size, mono, serif, bold };
}

const baseLetter = (ch) => { const d = ch.normalize('NFD'); return d.length > 1 && d.charCodeAt(0) < 128 ? d[0] : null; };

// the width of ONE (already encodable) character in 1/1000 em
function charWidth(name, ch) {
  if (name.startsWith('Courier')) return 600;
  const tbl = name === 'Helvetica-Bold' ? HELVB : name.startsWith('Times') ? TIMES : HELV;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return tbl[c - 32];
  const e = EXTRA[ch];
  if (e) return name.startsWith('Times') ? e[1] : e[0];
  const b = baseLetter(ch);
  if (b) return tbl[b.charCodeAt(0) - 32];
  return name.startsWith('Times') ? 500 : 556;
}

// text → { codes: WinAnsi byte values, text: the encodable string, missing: Set of characters replaced by '?' }
export function encodeWinAnsi(text) {
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
export function textWidth(name, size, text) {
  const { text: t } = encodeWinAnsi(text);
  let w = 0;
  for (const ch of t) w += charWidth(name, ch);
  return (w / 1000) * size;
}

// a PDF literal string from WinAnsi codes: ( ) \ escaped, bytes ≥ 128 as octal
export function pdfString(codes) {
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
export function baselineShift(baseline, size) {
  switch (baseline) {
    case 'top': return 0.8 * size;
    case 'hanging': return 0.8 * size;
    case 'middle': return 0.3 * size;
    case 'bottom': return -0.2 * size;
    case 'ideographic': return -0.2 * size;
    default: return 0;                                   // alphabetic
  }
}
