// the layer lifecycle: ids, the active layer, the union bbox, closing one layer or all of them
import { S, layerById, requestRender } from './state.js';
import { documentFrame } from '../../../ext/condenser/src/main.js';
import { clearUndo } from './undo.js';
import { pinEvictLayer } from './columns.js';
import { closeCompactBuilder, resetFilterState, syncFilterClear } from './filter.js';
import { dropValueTex, setColorLabels } from './color.js';
import { _attrTables, closeAttrTable } from './attrtable.js';
import { clearMeasure } from './overlay.js';
import { renderLayers } from './tree.js';
import { syncMeshPickable } from './surfaces.js';
import { addPaintColorOptions } from './props.js';
const $ = (s) => document.querySelector(s);

export const rendererDocBbox = () => S.docBbox || Float64Array.of(0, 0, 0, 1, 1, 1);

export function fitFromHeader(header, first = true) {
  // the FIRST dataset plants the document frame; later layers REBASE into it
  // (pure world-true translation — micro-layers spec §2). No reprojection ever.
  if (!S.frame) S.frame = documentFrame(header, { crs: null });
  const o = S.frame.origin, b = header.bbox;
  const local = Float64Array.of(b.min[0] - o[0], b.min[1] - o[1], b.min[2] - o[2], b.max[0] - o[0], b.max[1] - o[1], b.max[2] - o[2]);
  if (first) { S.docBbox = local; S.cam.fit(local); }
  else if (S.docBbox) {
    // adding a layer never yanks the camera — but a WILDLY disjoint bbox is a
    // wrong-file / wrong-CRS smell worth flagging (it still loads)
    const ext = Math.max(S.docBbox[3] - S.docBbox[0], S.docBbox[4] - S.docBbox[1]) || 1;
    const dx = (local[0] + local[3]) / 2 - (S.docBbox[0] + S.docBbox[3]) / 2;
    const dy = (local[1] + local[4]) / 2 - (S.docBbox[1] + S.docBbox[4]) / 2;
    if (Math.hypot(dx, dy) > ext * 10) $('#meta').textContent = `⚠ ${Math.round(Math.hypot(dx, dy) / 1000)} km from the current data — different area or CRS?`;
  }
}

// ── layers (micro-layers spec §1): see src/state.js — S.layers/S.activeId. One
// layer open == exactly the old single-doc behavior (ids 0-shifted, panel hidden).
export const LAYER_CAP = 64;                                     // a UI limit now, not an arithmetic one

export const allocLayerId = () => {
  // one pool. The old 7-layer ceiling came from packing the layer into 3 spare
  // bits of the 32-bit pick id; the layer rides a per-draw uniform now (the pick
  // target is RG32UI: record + layer), so nothing is scarce here.
  for (let i = 0; i < LAYER_CAP; i++) if (!layerById(i)) return i;
  return null;
};

export function closeAllLayers() {
  clearUndo();                                             // the history names layers that are going
  for (const L of S.layers) { pinEvictLayer(L.id); closeCompactBuilder(L.id); dropValueTex(L); }   // nothing pinned (or still compacting, or a value texture) survives a clear
  for (const [lid] of _attrTables) closeAttrTable(lid);
  S.renderer.clearChunks(); S.renderer.setPicked(null);
  S.layers = []; S.activeId = 0; S.frame = null; S.docBbox = null;
  resetFilterState();
  $('#filter').value = ''; syncFilterClear();
  $('#recPanel').classList.remove('show');
  clearMeasure();
  renderLayers();
}

export function recomputeUnion() {
  let u = null;
  for (const L of S.layers) {
    const b = L.bboxLocal; if (!b) continue;
    if (!u) u = Float64Array.from(b);
    else for (let i = 0; i < 3; i++) { if (b[i] < u[i]) u[i] = b[i]; if (b[i + 3] > u[i + 3]) u[i + 3] = b[i + 3]; }
  }
  S.docBbox = u;
  if (u) S.renderer.setDocBbox(u);
}

// sync the shared controls (color/clip/filter) to the active layer
export function setActiveLayer(id) {
  const L = layerById(id); if (!L) return;
  S.activeId = id;
  syncMeshPickable();                                      // selecting a surface is what makes it clickable
  const d = L.docs || {};
  setColorLabels(d.blockDoc ? d.blockDoc.header : d.dhDoc ? d.dhDoc.header : d.lasDoc ? { kind: 'las' } : d.plyDoc ? d.plyDoc.header : null);
  addPaintColorOptions(L);
  if (L.colorSel != null && [...$('#colorBy').options].some((o) => o.value === L.colorSel)) $('#colorBy').value = L.colorSel;
  $('#clipMin').value = L.clip[0]; $('#clipMax').value = L.clip[1];
  $('#filter').value = L.filterExpr || ''; syncFilterClear();
  renderLayers();
}

export function removeLayerUI(id) {
  dispatchEvent(new Event('micro:project-dirty'));
  closeAttrTable(id);
  { const Lr = layerById(id); if (Lr) dropValueTex(Lr); }
  S.renderer.removeLayer(id);
  // pinned columns outlive their layer otherwise — a leak, and worse: layer ids
  // come from a recycled 64-slot pool, so a NEW layer taking a freed id could be
  // served a dead layer's cached values whenever the size:rowCount guard happened
  // to match (two exports of the same shape, a re-imported template).
  pinEvictLayer(id); closeCompactBuilder(id);
  S.layers = S.layers.filter((l) => l.id !== id);
  recomputeUnion();
  if (!S.layers.length) { closeAllLayers(); $('#empty').style.display = ''; $('#meta').textContent = ''; dispatchEvent(new CustomEvent('micro:layer-removed', { detail: { id } })); return; }
  if (S.activeId === id) setActiveLayer(S.layers[0].id);
  renderLayers(); requestRender();
  dispatchEvent(new CustomEvent('micro:layer-removed', { detail: { id } }));
}

// Is layer `lid` on screen? Its own switch, and the switch of every group above it
// in the tree. A layer the tree does not hold answers with its own switch.
export function layerShown(lid) {
  let shown = null;
  const walk = (arr, on) => {                              // applyTreeVisibility's own walk
    for (const nd of arr) {
      if (typeof nd === 'number') { if (nd === lid) shown = !!(on && (layerById(nd) || {}).visible); }
      else walk(nd.children, on && nd.visible);
    }
  };
  walk(S.layerTree, true);
  return shown == null ? !!(layerById(lid) || {}).visible : shown;
}
