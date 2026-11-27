// wuffle → @gcu/stereonet: a diagram's layers as the core's plain layer inputs. The ONE place wuffle's model
// meets the shared core; pure, so a figure export or a test builds the same scene the desk draws.

import { orientations } from './io.js';
import { rowsWhere } from './calc.js';
import { PALETTE } from './palette.js';

// a numeric ramp for colour by a column (low → high): perceptually even, readable on light and dark
const RAMP = ['#3b4cc0', '#5f9de8', '#6cc4a8', '#d9c94a', '#e0723a', '#b4232c'];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
  return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
}
const num = (v) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; };
/**
 * colour by a column: { column, mode: 'cat' | 'num' } → row → colour (null: the layer's own), and the key
 * (what each colour means — a legend's entries). Categories take the palette in the order the values sort.
 */
export function colorByOf(ds, cb, keep = null) {
  if (!cb || !cb.column || !ds.columns.includes(cb.column)) return null;
  const vals = ds.rows.map((r) => r[cb.column]);
  // cb.filtered: the ramp's range and the categories come from the rows the filter keeps, not every row
  const seen = cb.filtered && keep ? vals.filter((_, i) => keep.has(i)) : vals;
  if (cb.mode === 'num') {
    const xs = seen.map(num).filter((v) => v != null); if (!xs.length) return null;
    const lo = cb.min != null ? +cb.min : Math.min(...xs), hi = cb.max != null ? +cb.max : Math.max(...xs), span = hi - lo || 1;
    return { of: (row) => { const v = num(vals[row]); return v == null ? null : rampColor((v - lo) / span); }, key: { kind: 'ramp', lo, hi, stops: RAMP.slice() } };
  }
  const cats = [...new Set(seen.map((v) => String(v ?? '')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const colours = new Map(cats.map((c, i) => [c, (cb.colors && cb.colors[c]) || PALETTE[i % PALETTE.length]]));
  return { of: (row) => colours.get(String(vals[row] ?? '')) || null, key: { kind: 'cat', entries: cats.map((c) => ({ label: c || '(blank)', color: colours.get(c) })) } };
}
/** size by a column: { column, min, max } (symbol sizes) → row → size */
export function sizeByOf(ds, sb) {
  if (!sb || !sb.column || !ds.columns.includes(sb.column)) return null;
  const vals = ds.rows.map((r) => num(r[sb.column])), xs = vals.filter((v) => v != null); if (!xs.length) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs), a = sb.min > 0 ? +sb.min : 2, b = sb.max > 0 ? +sb.max : 10;
  return (row) => (vals[row] == null ? null : a + ((vals[row] - lo) / (hi - lo || 1)) * (b - a));
}
/** the rows a layer's filter keeps (a Set), or null for all — a filter that doesn't read keeps everything */
export function layerFilterRows(ds, expr) {
  if (!expr || !String(expr).trim()) return null;
  try { return new Set(rowsWhere(ds, expr)); } catch { return null; }
}

/** @returns {object[]} layers for stereonetCore(…).buildScene, in draw order */
export function sceneLayers(project, diagramId) {
  return project.layersOf(diagramId).map((L) => {
    const ds = project.dataset(L.datasetId);
    // a label per row when the layer draws labels: the chosen column's value, else the row number (1-based)
    const lab = L.elements.labels?.on ? (L.elements.labels.column && ds.columns.includes(L.elements.labels.column) ? (row) => String(ds.rows[row][L.elements.labels.column] ?? '') : (row) => String(row + 1)) : null;
    // a weight per datum when the dataset names a weight column (a Terzaghi correction, a length): contours use it
    const wcol = ds.roles && ds.roles.weight && ds.columns.includes(ds.roles.weight) ? ds.roles.weight : null;
    const wOf = (row) => { const v = +ds.rows[row][wcol]; return Number.isFinite(v) && v >= 0 ? v : 0; };
    const st = L.style || {}, keep = layerFilterRows(ds, st.filter), cby = colorByOf(ds, st.colorBy, keep), sby = sizeByOf(ds, st.sizeBy);
    const data = orientations(ds).map((o, row) => {
      if (!o || (keep && !keep.has(row))) return null;
      const c = cby ? cby.of(row) : null, z = sby ? sby(row) : null;
      return { row, ...o, ...(lab ? { label: lab(row) } : {}), ...(wcol ? { weight: wOf(row) } : {}), ...(c ? { color: c } : {}), ...(z != null ? { size: z } : {}) };
    }).filter(Boolean);
    const dash = st.lineDash && st.lineDash !== 'solid' ? st.lineDash : null;
    return { id: L.id, datasetId: ds.id, kind: ds.kind, visible: L.visible, color: st.color, size: st.size,
      ...(st.symbol && st.symbol !== 'circle' ? { symbol: st.symbol } : {}), ...(st.hollow ? { hollow: true } : {}), ...(st.opacity != null && st.opacity < 1 ? { opacity: st.opacity } : {}),
      ...(st.lineColor || st.lineWidth || dash ? { lines: { ...(st.lineColor ? { color: st.lineColor } : {}), ...(st.lineWidth ? { width: st.lineWidth } : {}), ...(dash ? { dash } : {}) } } : {}),
      ...(st.contourWidth ? { contourWidth: st.contourWidth } : {}), ...(st.labelSize ? { labelSize: st.labelSize } : {}), ...(st.labelsSelectedOnly ? { labelsSelectedOnly: true } : {}),
      elements: L.elements, data, selected: project.selected(ds.id) };
  });
}
