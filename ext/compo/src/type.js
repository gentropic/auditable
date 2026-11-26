// type: the page's fonts, sized in points on a millimetre context (a leaf: kinds and world both use it)
export const SANS = "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONO = "'Space Mono', 'JetBrains Mono', Consolas, monospace";
export const SERIF = "Georgia, 'Times New Roman', Times, serif";
export const PT = 25.4 / 72;                                      // mm per point
export const INK = '#1a1a1a';
// a CSS font for the canvas — and for @gcu/pdf, which reads the same string: italic / bold pick the standard
// face (Helvetica-Oblique, Times-BoldItalic …), the first family picks sans / mono / serif
export const fontMm = (pt, { mono = false, serif = false, bold = false, italic = false } = {}) =>
  `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : serif ? SERIF : SANS}`;
