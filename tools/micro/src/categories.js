// micro — a layer's CATEGORIES: what its classes are (LAS classes or a category
// column), how many records each holds, which are hidden, and the legend that groups,
// names and colours them. The class list draws them (src/props-style.js).
import { categoryPalettePixels, palettePixels, coordNum } from '../../../ext/condenser/src/main.js';
import { stageGate } from './props.js';
import { paintActiveCol, applyPaintPalette, paintBlankVis } from './paint.js';
import { ruleModeOf, applyRuleVisibility, applyRulePalette } from './rules.js';
import { calcDisplayCol, calcSelOf } from './calc.js';
import { noDataOf } from './ramp.js';
import { S, requestRender } from './state.js';
import { markProjectDirty } from './project.js';
import { layerHeaderOf, layerRows } from './records.js';
import { viewCatName, viewCatData, ensureViewCat, VIEW_CAT_MAX } from './viewcat.js';

// LAS classification names (ASPRS standard 0–18)
const LAS_CLASSES = ['never classified', 'unclassified', 'ground', 'low vegetation', 'medium vegetation', 'high vegetation', 'building', 'low point (noise)', 'reserved', 'water', 'rail', 'road surface', 'reserved', 'wire — guard', 'wire — conductor', 'transmission tower', 'wire connector', 'bridge deck', 'high noise'];
export function layerClassInfo(L) {
  const d = L.docs || {};
  const tn = textCalcSel(L);
  if (tn) {                                                 // a text ƒ column: its live classes (src/calc.js realizes them)
    const col = calcCatCol(L), px = categoryPalettePixels(256);
    const names = col ? col.dict : [];
    return {
      kind: 'dict', calc: tn, names, codes: names.map((_, i) => i).filter((i) => i > 0),
      colorAt: (c) => { const k = ((c - 1) & 255) * 4; return `rgb(${px[k]},${px[k + 1]},${px[k + 2]})`; },
      column: tn, countable: true, pending: !col,
    };
  }
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
// ── a TEXT ƒ column coloured by class. Its legend + hidden classes live per ƒ column in
// L.calcCats[name] = { legend: {col, entries, otherColor}, hidden: [values], seen: [values] } —
// keyed by VALUE, never by code, because a re-realization (the expression edited, an input
// changed) renumbers the classes. Persisted with the project (project.js). ──
export function textCalcSel(L) {
  const n = calcSelOf(L);
  return n && (L.calcCols || []).some((c) => c.name === n && c.ty === 'string') ? n : null;
}
export function calcCatCol(L) { const c = calcDisplayCol(L); return c && c.cat ? c : null; }
function calcStore(L, name, create) {
  if (!L.calcCats) { if (!create) return null; L.calcCats = {}; }
  if (!L.calcCats[name]) { if (!create) return null; L.calcCats[name] = { hidden: [] }; }
  return L.calcCats[name];
}
// after each realization: values the legend has never offered join it (next palette colour);
// entries whose values are all absent now sink to the end — kept, so their colour comes back
// with them, but not listed (the class list and the legends skip entries with no records)
export function syncCalcLegend(L, name, dict) {
  const st = calcStore(L, name, true);
  if (!st.legend) st.legend = { col: name, entries: [], otherColor: '#555a5f' };
  const leg = st.legend, px = categoryPalettePixels(256);
  const seen = new Set((st.seen || []).map(String));
  for (const e of leg.entries) for (const v of e.values) seen.add(String(v));
  for (let c = 1; c < dict.length; c++) {
    const v = dict[c];
    if (seen.has(v)) continue;
    const k = (leg.entries.length & 255) * 4;
    leg.entries.push({ label: v, values: [v], color: rgbCssToHex(`rgb(${px[k]},${px[k + 1]},${px[k + 2]})`) });
    seen.add(v);
  }
  const have = new Set(dict.slice(1));
  const live = (e) => e.values.some((v) => have.has(String(v)));
  leg.entries = [...leg.entries.filter(live), ...leg.entries.filter((e) => !live(e))];
  st.seen = [...seen];
}
// the colour each class of `dict` carries in the ƒ column's legend (by code; null = none)
export function calcClassColors(L, name, dict) {
  const st = calcStore(L, name), out = dict.map(() => null);
  if (!st || !st.legend) return out;
  for (const e of st.legend.entries) for (const v of e.values) { const c = dict.indexOf(String(v)); if (c > 0) out[c] = e.color; }
  return out;
}
// the hidden-class set the class list, the legends and the selection read: the layer's
// category codes, or — for a text ƒ — a code view over the ƒ column's hidden VALUES
export function classHidden(L, info) {
  if (!info || !info.calc) { if (!L.catHidden) L.catHidden = new Set(); return L.catHidden; }
  const st = calcStore(L, info.calc, true);
  if (!Array.isArray(st.hidden)) st.hidden = [];
  const vals = st.hidden, names = info.names;
  return {
    has: (c) => c > 0 && names[c] != null && vals.includes(names[c]),
    add: (c) => { const v = names[c]; if (c > 0 && v != null && !vals.includes(v)) vals.push(v); },
    delete: (c) => { const k = vals.indexOf(names[c]); if (k >= 0) vals.splice(k, 1); },
    get size() { let n = 0; for (let c = 1; c < names.length; c++) if (vals.includes(names[c])) n++; return n; },
    *[Symbol.iterator]() { for (let c = 1; c < names.length; c++) if (vals.includes(names[c])) yield c; },
  };
}
// the legend the user has edited/stored for these classes, or null (defaults are derived)
export function storedLegend(L, info) {
  if (info.calc) { const st = calcStore(L, info.calc); return (st && st.legend) || null; }
  return L.catLegend && L.catLegend.col === info.column ? L.catLegend : null;
}
export function resetLegend(L, info) {
  if (info.calc) {
    const st = calcStore(L, info.calc);
    if (st) { delete st.legend; st.seen = []; }
    const col = calcCatCol(L); if (col) syncCalcLegend(L, info.calc, col.dict);   // back to the default colours, by value
    applyCatLegend(L, true);
  } else { L.catLegend = null; S.renderer.setLayerPalette(L.id, null); }
  markProjectDirty(); requestRender();
}
function applyCalcCatVisibility(L, col) {
  const info = layerClassInfo(L), hid = classHidden(L, info), hideBlank = noDataOf(L).hide;
  if (!hid.size && !hideBlank) S.renderer.setLayerCatVisibility(L.id, null);
  else {
    const v = new Uint8Array(256).fill(1);
    for (const c of hid) v[c & 255] = 0;
    if (hideBlank) v[0] = 0;                               // a blank result: the style tab's no-data row
    S.renderer.setLayerCatVisibility(L.id, v);
  }
}
function applyCalcCatPalette(L) {
  const info = layerClassInfo(L), leg = legendOf(L, info);
  const px = new Uint8Array(256 * 4);
  const put = (c, hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    px[c * 4] = (n >> 16) & 255; px[c * 4 + 1] = (n >> 8) & 255; px[c * 4 + 2] = n & 255; px[c * 4 + 3] = 255;
  };
  for (let c = 1; c < 256; c++) put(c, leg.otherColor || '#555a5f');
  put(0, noDataOf(L).color);                               // code 0 = a blank result
  for (const e of leg.entries) for (const c of legendCodesOf(info, e)) if (c > 0 && c < 256) put(c, e.color);
  S.renderer.setLayerPalette(L.id, px, 256);
  requestRender();
}
export function applyCatVisibility(L, force) {
  if (!force) return stageGate(L, () => applyCatVisibility(L, true));
  if (ruleModeOf(L)) return applyRuleVisibility(L, true);  // rule mode: the vis texture is indexed by RULE code
  if (textCalcSel(L)) {                                     // a text ƒ: its own hidden classes (nothing until realized)
    if (calcCatCol(L)) applyCalcCatVisibility(L);
    markProjectDirty(); requestRender(); return;
  }
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
  if (info && info.calc) {                                  // the realization counted them
    const tc = calcCatCol(L); if (!tc) return null;
    const counts = new Map(); tc.counts.forEach((n, c) => { if (c > 0 && n) counts.set(c, n); });
    return { counts, total: tc.count };
  }
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
  const st = storedLegend(L, info); if (st) return st;
  return { col: info.column, entries: defaultLegendEntries(info), otherColor: '#555a5f' };
}
export function ensureLegend(L, info) {
  if (info.calc) {                                          // a text ƒ: stored per column, by value
    if (info.pending) return legendOf(L, info);             // nothing realized yet — never store an empty legend
    const st = calcStore(L, info.calc, true);
    if (!st.legend) st.legend = legendOf(L, info);
    return st.legend;
  }
  if (!L.catLegend || L.catLegend.col !== info.column) L.catLegend = legendOf(L, info);
  return L.catLegend;
}
export const legendCodesOf = (info, e) => e.values.map((v) => (typeof v === 'number' ? v : info.names.indexOf(v))).filter((c) => c >= 0);
export function applyCatLegend(L, force) {
  if (!force) return stageGate(L, () => applyCatLegend(L, true));
  if (ruleModeOf(L)) return applyRulePalette(L, true);     // rule mode: the palette holds RULE colors
  { const pc = paintActiveCol(L); if (pc) return applyPaintPalette(L, pc); }   // paint mode: painted-value colors
  if (textCalcSel(L)) { if (calcCatCol(L)) applyCalcCatPalette(L); return; }   // a text ƒ: its class legend
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
