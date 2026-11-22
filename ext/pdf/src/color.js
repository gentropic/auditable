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
export function parseCssColor(c) {
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
