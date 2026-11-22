// type: the page's fonts, sized in points on a millimetre context (a leaf: kinds and world both use it)
export const SANS = "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONO = "'Space Mono', 'JetBrains Mono', Consolas, monospace";
export const PT = 25.4 / 72;                                      // mm per point
export const INK = '#1a1a1a';
export const fontMm = (pt, { mono = false, bold = false } = {}) => `${bold ? 'bold ' : ''}${(pt * PT).toFixed(3)}px ${mono ? MONO : SANS}`;

