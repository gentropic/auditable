// micro — VIEWS of a layer: one model shown more than once, each showing its
// own colour, filter, clip, ramp, opacity and visibility, with ONE copy of the data.
// Leapfrog makes you load a block model twice for this; Isatis lets you look at
// it twice. Opening the file twice doubles the GPU memory and splits the model:
// a column painted on one copy isn't on the other.
//
// A view is a layer in S.layers like any other (its own id, its own tree row,
// its own renderer layer state), plus `viewOf` = the model's id. The renderer
// draws the model's chunks under the view's state (condenser setLayerViewOf),
// so a view costs only its per-record textures.
//
// What a view SHARES it does not copy: the fields below are accessors that
// read and write the MODEL's. Code anywhere does `L.paintCols = [...]` or
// `L._selMask = m`; on a copy that would quietly fork the data. Through an
// accessor it lands on the model, and the model's other views see it.
// Everything else is the view's own, and is display state.
//
// Which layers can be viewed: block models (boxes or points) and drillhole
// intervals, the kinds every colour path reaches through a value texture.
// A view is one level deep (no views of views).
import { S, layerById, requestRender } from './state.js';
import { allocLayerId, LAYER_CAP, setActiveLayer, removeLayerUI } from './layers.js';
import { renderLayers } from './layers-panel.js';
import { applyTreeVisibility } from './tree.js';
import { markProjectDirty } from './project.js';
import { setLayerColorBy, colorByName } from './color.js';
import { applyCatLegend } from './categories.js';
import { applyRamp } from './ramp.js';
const $ = (s) => document.querySelector(s);

// the model's DATA (file, records, every column, the selection, provenance) —
// read and written through to the model
export const VIEW_SHARED = [
  'docs', 'kind', 'dh', 'bboxLocal',
  'calcCols', '_calcFns', 'paintCols', '_paintVer', '_paintUndo', '_paintRedo', 'dataCols',
  'colTypes', 'qualify', '_qualFn', '_qualH', 'catChoices', '_catCounts',
  '_colStats', '_bands', '_lastScan', '_colsUnread', '_elementExtra',
  '_selMask', '_selCount', '_selShadow', '_selRedoBox',
  'lineage', 'handle', 'storage', '_relpath', 'memoryOnly', 'files', '_optimizedOrphan',
];

export const isView = (L) => !!L && L.viewOf != null;
export const modelOf = (L) => (isView(L) ? layerById(L.viewOf) : L);
export const viewsOf = (L) => (L ? S.layers.filter((v) => v.viewOf === L.id) : []);
// the model and its views — every layer drawing these records
export const familyOf = (L) => { const M = modelOf(L); return M ? [M, ...viewsOf(M)] : []; };
// the id a record-keyed cache belongs to (the data's, not the display's)
export const dataIdOf = (id) => { const L = layerById(id); return isView(L) ? L.viewOf : id; };

export function canView(L) {
  if (!L || isView(L) || L.derivedOf || L.trace) return false;
  const d = L.docs || {};
  return !!(d.blockDoc || (L.dh && d.dhDoc));
}

// a name nothing else answers to (scenes, recipes and routines find layers by name)
function uniqueName(base) {
  const taken = new Set(S.layers.flatMap((L) => [L.name, L.label]));
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base} (${k})`)) return `${base} (${k})`;
}

const display = (L) => ({
  colorSel: L.colorSel, clip: [...(L.clip || ['', ''])],
  ramps: L.ramps ? structuredClone(L.ramps) : undefined,
  catLegend: L.catLegend ? structuredClone(L.catLegend) : undefined,
  opacity: L.opacity, edges: L.edges,
});

// → the view (a layer). `state` is the view's display: { name, label, colorSel,
// clip, filter, visible, opacity, edges, ramps, catLegend } — absent fields start
// as the model's (colour, clip, ramps, opacity, edges) or neutral (no filter).
// The colour is applied before this resolves.
export async function createView(model, state = {}, { activate = true, apply = true } = {}) {
  if (!canView(model)) throw new Error(`“${model ? model.label || model.name : '?'}” can't be viewed (block models and drillholes can)`);
  const id = allocLayerId();
  if (id == null) throw new Error(`layer limit reached (${LAYER_CAP}) — remove one first`);
  const base = { ...display(model), ...Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined)) };
  const V = {
    id, viewOf: model.id,
    name: '', label: '',
    colorSel: base.colorSel ?? null, clip: base.clip || ['', ''], filterExpr: '',
    visible: state.visible !== false,
  };
  if (base.ramps) V.ramps = base.ramps;
  if (base.catLegend) V.catLegend = base.catLegend;
  if (base.opacity != null) V.opacity = base.opacity;
  if (base.edges != null) V.edges = base.edges;
  for (const k of VIEW_SHARED) {
    Object.defineProperty(V, k, {
      enumerable: false, configurable: false,
      get() { const M = layerById(V.viewOf); return M ? M[k] : undefined; },
      set(v) { const M = layerById(V.viewOf); if (M) M[k] = v; },
    });
  }
  S.layers.push(V);
  S.renderer.setLayerViewOf(id, model.id);
  syncRendererData(V);
  // name: what it shows ("model · CU"), unless the caller names it
  const what = state.label || state.name || `${model.label || model.name} · ${colorByName(V) || 'view'}`;
  V.label = uniqueName(state.label || what);
  V.name = state.name && !S.layers.some((L) => L !== V && (L.name === state.name || L.label === state.name)) ? state.name : V.label;
  if (V.opacity != null) S.renderer.setLayerOpacity(id, V.opacity);
  if (V.edges != null) S.renderer.setLayerEdges(id, V.edges);
  if (apply) await applyViewColor(V);
  if (state.filter) { const { refilterLayer } = await import('./filter.js'); await refilterLayer(V, state.filter); }
  applyTreeVisibility();
  if (activate) setActiveLayer(id); else renderLayers();
  markProjectDirty();
  requestRender();
  dispatchEvent(new CustomEvent('micro:layer-added', { detail: { id, viewOf: model.id } }));
  return V;
}

// the per-layer renderer state micro sets at OPEN time (not colour) — a view
// draws the same data, so it starts with the model's
function syncRendererData(V) {
  const M = layerById(V.viewOf); if (!M) return;
  const R = S.renderer;
  if (M.dh && M.docs.dhDoc) {
    R.setLayerCats(V.id, M.docs.dhDoc.header.categories ? 256 : 0);
    R.setLayerStickRadius(V.id, R.layerStickRadius(M.id));
  }
  R.setLayerSectioned(V.id, R.layerSectioned(M.id));
}

export async function applyViewColor(V) {
  if (V.colorSel != null) await setLayerColorBy(V, V.colorSel);
  else applyRamp(V, true);
  if (V.catLegend) applyCatLegend(V, true);
}

// the model was REPLACED (a re-desurvey opens a new layer and retires the old
// id): its views follow the new one. A replacement that can't be viewed (a
// reinterpret to another kind) takes its views with it.
addEventListener('micro:layer-replaced', async (e) => {
  const { from, to } = e.detail || {};
  const M = layerById(to);
  for (const V of S.layers.filter((v) => v.viewOf === from)) {
    if (!canView(M)) { removeLayerUI(V.id); continue; }
    V.viewOf = to;
    S.renderer.setLayerViewOf(V.id, to);
    syncRendererData(V);
    try { await applyViewColor(V); } catch (err) { $('#meta').textContent = `view “${V.label}”: ${err.message}`; }
  }
  renderLayers(); requestRender();
});

// the model re-read its file IN PLACE (same id: a reload, a re-map, a channel
// re-stream). The renderer re-proxies the new chunks by itself; what a view
// derived from the OLD records — its filter mask, its colour texture — is
// rebuilt here.
addEventListener('micro:layer-reread', async (e) => {
  const M = layerById(e.detail && e.detail.id);
  if (!M || isView(M)) return;
  for (const V of viewsOf(M)) {
    syncRendererData(V);
    try {
      const { refilterLayer } = await import('./filter.js');
      V._filterMask = null;
      await refilterLayer(V);
      await applyViewColor(V);
    } catch (err) { $('#meta').textContent = `view “${V.label}”: ${err.message}`; }
  }
  renderLayers(); requestRender();
});
