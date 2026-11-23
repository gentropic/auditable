// micro — a layer's CATEGORIES: what its classes are (LAS classes or a category
// column), how many records each holds, which are hidden, and the legend that groups,
// names and colours them. The class list draws them (src/props-style.js).
import { categoryPalettePixels, palettePixels, coordNum } from '../../../ext/condenser/src/main.js';
import { stageGate } from './props.js';
import { paintActiveCol, applyPaintPalette, paintBlankVis } from './paint.js';
import { ruleModeOf, applyRuleVisibility, applyRulePalette } from './rules.js';
import { calcDisplayCol } from './calc.js';
import { S, requestRender } from './state.js';
import { markProjectDirty } from './project.js';
import { layerHeaderOf, layerRows } from './records.js';
import { viewCatName, viewCatData, ensureViewCat, VIEW_CAT_MAX } from './viewcat.js';

// LAS classification names (ASPRS standard 0–18)
const LAS_CLASSES = ['never classified', 'unclassified', 'ground', 'low vegetation', 'medium vegetation', 'high vegetation', 'building', 'low point (noise)', 'reserved', 'water', 'rail', 'road surface', 'reserved', 'wire — guard', 'wire — conductor', 'transmission tower', 'wire connector', 'bridge deck', 'high noise'];
export function layerClassInfo(L) {
  const d = L.docs || {};
  const vc = viewCatName(L);
  if (vc) {                                                 // a view classing by its own column (src/viewcat.js)
    const v = viewCatData(L), px = categoryPalettePixels(256);
    const names = v ? v.names : [];
    return {
      kind: 'dict', names, codes: names.map((_, i) => i).filter((i) => names[i] != null),
      colorAt: (c) => (c === VIEW_CAT_MAX ? 'rgb(85,90,95)' : `rgb(${px[c * 4]},${px[c * 4 + 1]},${px[c * 4 + 2]})`),
      column: vc, countable: true, pending: !v,
    };
  }
  const h = (d.blockDoc || d.dhDoc || d.stringsDoc || {}).header;
  if (h && h.categories && h.categories.length) {
    const px = categoryPalettePixels(256);
    return {
      kind: 'dict', names: h.categories, codes: h.categories.map((_, i) => i),
      colorAt: (c) => `rgb(${px[c * 4]},${px[c * 4 + 1]},${px[c * 4 + 2]})`,
      column: h.columns && h.mapping && h.mapping.cat != null ? h.columns[h.mapping.cat] : 'category',
      countable: !!(d.dhDoc || d.blockDoc),
    };
  }
  if (d.lasDoc) {
    const px = palettePixels();
    return {
      kind: 'las', names: LAS_CLASSES, codes: LAS_CLASSES.map((_, i) => i),
      colorAt: (c) => `rgb(${px[c * 4]},${px[c * 4 + 1]},${px[c * 4 + 2]})`,
      column: 'classification', countable: false,
    };
  }
  return null;
}
export function applyCatVisibility(L, force) {
  if (!force) return stageGate(L, () => applyCatVisibility(L, true));
  if (ruleModeOf(L)) return applyRuleVisibility(L, true);  // rule mode: the vis texture is indexed by RULE code
  if (paintActiveCol(L) || calcDisplayCol(L)) { S.renderer.setLayerCatVisibility(L.id, paintBlankVis(L, paintActiveCol(L) || calcDisplayCol(L))); requestRender(); return; }   // paint mode: no code eyes
  if (!L.catHidden || !L.catHidden.size) S.renderer.setLayerCatVisibility(L.id, null);
  else {
    const v = new Uint8Array(256).fill(1);
    for (const c of L.catHidden) v[c & 255] = 0;
    S.renderer.setLayerCatVisibility(L.id, v);
  }
  markProjectDirty(); requestRender();
}
export function restoreHiddenCats(L, arr) {
  if (!arr || !arr.length) return;
  const h = layerHeaderOf(L);
  const vc = viewCatData(L);
  const dict = vc ? vc.names : h && h.categories;
  L.catHidden = new Set(arr.map((v) => (typeof v === 'number' ? v : dict ? dict.indexOf(v) : -1)).filter((c) => c >= 0));
  if (L.catHidden.size) applyCatVisibility(L, true);
}
// counts fill in async — the eyes never wait on a sweep
export async function ensureCatCounts(L, info) {
  if (viewCatName(L)) { const v = viewCatData(L) || await ensureViewCat(L); return v ? { counts: v.counts, total: v.total } : null; }
  if (L._catCounts || !info.countable) return L._catCounts || null;
  const counts = new Map();
  let total = 0;
  const d = L.docs;
  if (d.dhDoc) {
    const dh = d.dhDoc, ci = dh.header.mapping.cat;
    const code = new Map(info.names.map((n, i) => [n, i]));
    for (let i = 0; i < dh.header.count; i++) {
      const f = dh.fetchRecord(i);
      const c = code.get(String(f[ci]).trim());
      if (c != null) { counts.set(c, (counts.get(c) || 0) + 1); total++; }
    }
  } else if (d.blockDoc) {
    // ONE loop for all three block sources. It was two — a `.dm` branch and a
    // delimited branch with an identical body — and Parquet, being neither, fell
    // into the delimited one and had its binary bytes parsed as text. The Classes
    // tab then showed counts of zero or nonsense beside category NAMES that were
    // perfectly correct (those come from the footer), which is the hardest kind of
    // wrong to notice. layerRows already abstracts the row source, so asking it
    // fixes the bug and deletes the duplication together.
    const m = d.blockDoc.header.mapping;
    const code = new Map(info.names.map((n, i) => [n, i]));
    for await (const batch of layerRows(L, null)) {   /* rows ok: category counts: placed blocks only, not numbered */
      for (const f of batch) {
        if (!Number.isFinite(coordNum(f[m.x])) || !Number.isFinite(coordNum(f[m.y])) || !Number.isFinite(coordNum(f[m.z]))) continue;
        const c = code.get(String(f[m.cat]).trim());
        if (c != null) counts.set(c, (counts.get(c) || 0) + 1);
        total++;
      }
    }
  }
  L._catCounts = { counts, total };
  return L._catCounts;
}
// ── the CATEGORY LEGEND (§10 categorized): entries decoupled from the raw
// column values — each owns a color, a label, and a SET of member values
// (grouping = one row, one color, eyes toggle every member code). Removed
// values fall into an automatic grey "other" bucket. Colors bake into a
// per-layer palette texture; the class codes on the GPU never change. ──
export const rgbCssToHex = (css) => {
  const m2 = String(css).match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m2 ? '#' + [1, 2, 3].map((i) => (+m2[i]).toString(16).padStart(2, '0')).join('') : '#888888';
};
function defaultLegendEntries(info) {
  return info.codes.map((c) => ({ label: String(info.names[c]) || '(blank)', values: [info.kind === 'las' ? c : String(info.names[c])], color: rgbCssToHex(info.colorAt(c)) }));
}
export function legendOf(L, info) {
  if (L.catLegend && L.catLegend.col === info.column) return L.catLegend;
  return { col: info.column, entries: defaultLegendEntries(info), otherColor: '#555a5f' };
}
export function ensureLegend(L, info) {
  if (!L.catLegend || L.catLegend.col !== info.column) L.catLegend = legendOf(L, info);
  return L.catLegend;
}
export const legendCodesOf = (info, e) => e.values.map((v) => (typeof v === 'number' ? v : info.names.indexOf(v))).filter((c) => c >= 0);
export function applyCatLegend(L, force) {
  if (!force) return stageGate(L, () => applyCatLegend(L, true));
  if (ruleModeOf(L)) return applyRulePalette(L, true);     // rule mode: the palette holds RULE colors
  { const pc = paintActiveCol(L); if (pc) return applyPaintPalette(L, pc); }   // paint mode: painted-value colors
  const info = layerClassInfo(L);
  if (!info) return;
  const leg = L.catLegend && L.catLegend.col === info.column ? L.catLegend : null;
  if (!leg && viewCatName(L)) {                            // a view's own classes: its palette is always baked (the shared
    const px = categoryPalettePixels(256);                  // category palette exists only once some layer is categorized)
    px[VIEW_CAT_MAX * 4] = 85; px[VIEW_CAT_MAX * 4 + 1] = 90; px[VIEW_CAT_MAX * 4 + 2] = 95; px[VIEW_CAT_MAX * 4 + 3] = 255;
    S.renderer.setLayerPalette(L.id, px, 256); requestRender(); return;
  }
  if (!leg) { S.renderer.setLayerPalette(L.id, null); requestRender(); return; }
  const width = info.kind === 'las' ? 32 : 256;
  const px = new Uint8Array(width * 4);
  const put = (c, hex) => {
    const n = parseInt(hex.slice(1), 16);
    px[c * 4] = (n >> 16) & 255; px[c * 4 + 1] = (n >> 8) & 255; px[c * 4 + 2] = n & 255; px[c * 4 + 3] = 255;
  };
  for (let c = 0; c < width; c++) put(c, leg.otherColor || '#555a5f');   // uncovered → the other bucket
  for (const e of leg.entries) for (const c of legendCodesOf(info, e)) if (c < width) put(c, e.color);
  S.renderer.setLayerPalette(L.id, px, width);
  requestRender();
}
