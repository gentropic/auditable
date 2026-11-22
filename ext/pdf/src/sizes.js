// Page sizes and units. PDF works in POINTS (1/72 in); a page is given in points, and these turn
// the paper names and millimetres people think in into them.

export const PT_PER_MM = 72 / 25.4;
export const mm = (v) => v * PT_PER_MM;

// width × height in mm, portrait
const MM = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
};
export const PAGE_SIZES = Object.fromEntries(Object.entries(MM).map(([k, [w, h]]) => [k, [mm(w), mm(h)]]));

// pageSize('A4') · pageSize('A3', 'landscape') · pageSize([200, 150]) → [w, h] in points. A named size
// is portrait unless told otherwise; a custom [w, h] stays as given unless an orientation is named.
export function pageSize(size = 'A4', orientation = null, units = 'mm') {
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
