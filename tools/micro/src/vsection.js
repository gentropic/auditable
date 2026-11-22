// micro VECTOR SECTIONS — a section through a block model as vector cells: every block the section
// plane cuts, as the rectangle it makes on that plane, in its legend colour. For a figure: crisp
// at any zoom, editable in Illustrator / Inkscape, a fraction of a 300-dpi raster.
//
// Scope (v1): an axis-aligned section (plan, N–S, E–W), a block model on an axis-aligned lattice
// (regular or sub-blocked; not a rotated one), coloured by a numeric ramp (continuous or classed)
// or by categories. The layer's filter applies (filtered-out blocks are left out). Same-colour
// neighbours along a row merge into one cell, so a large section stays small.
import { layerRecords, layerTableHeader, schemaExt, numOf } from './records.js';
import { volumeContextOf } from './analysis.js';
import { gridAxesOf } from './grid-ops.js';
import { colorSelOf, rampCfgOf, classBreaks, classIndex, classColor, noDataOf } from './ramp.js';
import { colorByName } from './color.js';
import { legendSpec } from './deco.js';

// the plane, in the section's own (u, v) — w is the axis it cuts across
export const SEC_AXES = { plan: { w: 2, u: 0, v: 1 }, ns: { w: 0, u: 1, v: 2 }, ew: { w: 1, u: 0, v: 2 } };

// a record's colour, the way the legend paints it — null: not drawn (no data hidden, or a mode
// this can't paint)
export function colourerOf(L) {
  const spec = legendSpec(L), sel = String(colorSelOf(L));
  if (!spec) return null;
  const nd = noDataOf(L), ndColor = nd.hide ? null : nd.color;
  if (spec.kind === 'ramp') {
    const { lut, lo, hi } = spec, clip = [parseFloat(L.clip && L.clip[0]), parseFloat(L.clip && L.clip[1])];
    const hex = (k) => '#' + [lut[k * 4], lut[k * 4 + 1], lut[k * 4 + 2]].map((x) => x.toString(16).padStart(2, '0')).join('');
    const cache = new Array(256);
    return { numeric: true, of: (v) => {
      if (!Number.isFinite(v)) return ndColor;
      if ((Number.isFinite(clip[0]) && v < clip[0]) || (Number.isFinite(clip[1]) && v > clip[1])) return null;   // clipped: not shown
      const k = Math.max(0, Math.min(255, Math.round(((v - lo) / ((hi - lo) || 1)) * 255)));
      return cache[k] || (cache[k] = hex(k));
    } };
  }
  if (spec.kind === 'classes' && (sel.startsWith('chan:') || sel.startsWith('calc:'))) {    // a classed ramp
    const cfg = rampCfgOf(L) || {}, br = classBreaks(cfg), hidden = cfg.hide || [];
    return { numeric: true, of: (v) => { if (!Number.isFinite(v)) return ndColor; const k = classIndex(br, v); return hidden[k] ? null : classColor(cfg, br, k); } };
  }
  if (spec.kind === 'classes' && (sel === 'cat' || sel.startsWith('catcol:'))) {
    const by = new Map(spec.entries.map((e) => [String(e.label), e.color]));
    return { numeric: false, of: (v) => (v == null || v === '' ? ndColor : by.get(String(v)) || null) };
  }
  return null;
}

// the cells one block layer makes on the section → { rects: [u0, v0, u1, v1, …], colors: [i…],
// palette: ['#…'], blocks, merged } — or throws saying why it can't
export async function sectionCells(L, sec, { max = 150000 } = {}) {
  const ax = SEC_AXES[sec && sec.mode];
  if (!ax) throw new Error('vector sections need an axis section — plan, N–S or E–W');
  const ga = gridAxesOf(L);
  if (!ga) throw new Error(`${L.label || L.name} is not a block model on a lattice`);
  if (ga.rot) throw new Error(`${L.label || L.name} is a rotated model — not yet as vectors`);
  const col = colourerOf(L);
  if (!col) throw new Error(`${L.label || L.name}: vector sections colour by a ramp or by categories — not by this colour mode`);
  const h = layerTableHeader(L), m = h && h.mapping;
  if (!m || m.x == null) throw new Error(`${L.label || L.name} has no coordinate columns`);
  const schema = schemaExt(L, h), vname = colorByName(L), vi = schema.findIndex((c) => c.name === vname);
  if (vi < 0) throw new Error(`${L.label || L.name}: no column “${vname}”`);
  const ci = [m.x, m.y, m.z], pitch = [ga.x.pitch, ga.y.pitch, ga.z.pitch].map((p) => Math.abs(+p) || 1);
  const vc = volumeContextOf(L), dc = vc.dc ? [vc.dc.x, vc.dc.y, vc.dc.z] : null;
  const mask = L.filterExpr && L._filterMask ? L._filterMask : null, d0 = +sec.position;
  const raw = [];                                           // u0, v0, u1, v1, colour
  const palette = [], pIdx = new Map();
  let blocks = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (mask && !(rec < mask.length && mask[rec])) continue;
    const half = dc ? dc.map((c, i) => { const d = Math.abs(+f[c]); return (d > 0 ? d : pitch[i]) / 2; }) : [pitch[0] / 2, pitch[1] / 2, pitch[2] / 2];
    const cw = +f[ci[ax.w]];
    if (!(cw - half[ax.w] <= d0 && d0 < cw + half[ax.w])) continue;   // the plane cuts this block (half-open: a face on the plane counts once)
    const v = col.numeric ? numOf(f[vi]) : f[vi];
    const c = col.of(v); if (!c) continue;
    let k = pIdx.get(c); if (k == null) { k = palette.length; palette.push(c); pIdx.set(c, k); }
    const cu = +f[ci[ax.u]], cv = +f[ci[ax.v]];
    raw.push([cu - half[ax.u], cv - half[ax.v], cu + half[ax.u], cv + half[ax.v], k]);
    if (++blocks > max * 4) throw new Error(`${blocks.toLocaleString()}+ blocks on this section — too many for vectors; keep it raster`);
  }
  // merge runs along u: same row (v0, v1), same colour, touching
  raw.sort((a, b) => a[1] - b[1] || a[3] - b[3] || a[0] - b[0]);
  const rects = [], colors = [];
  for (const r of raw) {
    const n = colors.length;
    if (n && colors[n - 1] === r[4] && rects[n * 4 - 3] === r[1] && rects[n * 4 - 1] === r[3] && Math.abs(rects[n * 4 - 2] - r[0]) < 1e-6) { rects[n * 4 - 2] = r[2]; continue; }
    rects.push(r[0], r[1], r[2], r[3]); colors.push(r[4]);
  }
  if (colors.length > max) throw new Error(`${colors.length.toLocaleString()} cells on this section — too many for vectors; keep it raster`);
  return { rects, colors, palette, blocks, merged: colors.length };
}
