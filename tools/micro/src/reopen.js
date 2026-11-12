// micro — REOPENING a layer in place: a layer that is read again (a new mapping, another
// interpretation, fresh bytes from disk) keeps its identity — its place in the tree, its
// name, its file handle — and its styling. The capture/restore pairs live here, with the
// three ways in: reopen with a mapping, reinterpret as another kind, reload from disk.
import { S, _fileHandles, layerById } from './state.js';
import { pinEvictLayer } from './columns.js';
import { applyColTypes, layerBlob, layerTableHeader } from './records.js';
import { refreshProps } from './props.js';
import { addPaintColorOptions, paintActiveCol } from './paint.js';
import { ruleModeOf, runRules, syncRuleMode } from './rules.js';
import { applyCatLegend, applyCatVisibility } from './categories.js';
import { applyRamp, rampCfgOf } from './ramp.js';
import { openBlob, openBlocksBlob, openDmBlob, openParquetBlocks } from './open.js';
import { markProjectDirty } from './project.js';
import { mapColumns } from '../../../ext/condenser/src/main.js';
import { basename } from './paths.js';
import { invalidateWholeHoles } from './drillholes.js';
import { applyLayerSurface, captureLayerSurface } from './surfaces.js';
import { layerReplaced, renderLayers, treeSlotOf } from './tree.js';
import { menuXY } from './menu.js';
import { setLayerColorSel } from './color.js';
import { refilterLayer } from './filter.js';
import { closeAttrTable } from './attrtable.js';
const $ = (s) => document.querySelector(s);

// ── identity that MUST survive a single-blob reopen ──
// setGridBand · applyLayerSurface · reopenAs all tear a grid/block layer down and
// re-open it from the same blob. These are the ONE list of fields that must ride
// through unchanged, so a reopen can't silently drop one the way reopenAs used to
// drop `visible`. Data-representation styling that legitimately resets on a
// reinterpret (colour/filter/ramps) is deliberately NOT preserved here.
// re-read a layer as a NEW layer: open FIRST, remove the old one only once the new
// one stands. Four paths (Reinterpret as, Reload from disk, a grid band, a grid's
// surface/points switch) removed first, so a failed open lost the layer, and then
// adopted "whatever is active now" as the result, grafting the lost layer's label,
// handle and visibility onto an unrelated one. reopenDh was fixed to this order
// first; now it is everyone's. Resolves to the new layer, or null (original kept).
export async function reopenReplacing(L, blob, open) {
  const keep = captureReopenIdentity(L);
  preregisterReopenHandle(blob, keep);
  let lid2 = null;
  try { lid2 = await open(); } catch { lid2 = null; }      // openBlob reports its own failure on the status line
  const L2 = lid2 != null ? layerById(lid2) : null;
  if (!L2 || L2 === L) return L2 === L ? L : null;
  S.renderer.removeLayer(L.id);
  S.layers = S.layers.filter((l) => l.id !== L.id);
  pinEvictLayer(L.id);
  return restoreReopenIdentity(L2, keep);                  // label · visible · handle · storage + its tree slot (layerReplaced)
}

export function captureReopenIdentity(L) {
  return { label: L.label, visible: L.visible, handle: L.handle, storage: L.storage, oldId: L.id, slot: treeSlotOf(L.id) };
}

export function preregisterReopenHandle(blob, keep) {   // openBlob reads _fileHandles → must run BEFORE it
  if (keep.handle && blob && typeof blob === 'object') _fileHandles.set(blob, keep.handle);
}

export function restoreReopenIdentity(L2, keep) {        // call with the fresh active layer AFTER openBlob
  if (!L2) return L2;
  if (keep.label) L2.label = keep.label;
  L2.storage = keep.storage;
  if (keep.handle) L2.handle = keep.handle;
  if (keep.visible === false) { L2.visible = false; S.renderer.setLayerVisible(L2.id, false); }
  if (keep.oldId != null) layerReplaced(keep.oldId, L2.id, keep.slot);
  return L2;
}

// ── derived styling that survives a DATA-PRESERVING reopen ──
// re-desurvey (reopenDh) · re-map (reopenWithMapping) · re-channel (reopenDhChan)
// all keep the SAME columns, so the user's derived styling should ride through.
// captureLayerStyling / applyLayerStyling are the ONE list. Determinism note: the
// reopen feeds the STRUCTURAL params (mapping / desurvey config) INTO the open, so
// nothing is re-sniffed-and-guessed — colTypes especially is RE-ASSERTED here on
// top of whatever the loader inferred, so a reopen (and by extension a reload) is
// deterministic from saved state, not from a heuristic. reopenDhChan used to skip
// this → a re-channel silently kept the loader's inferred colTypes.
export function captureLayerStyling(L, { clearCats = false } = {}) {
  return {
    colTypes: L.colTypes, qualify: L.qualify, calcCols: L.calcCols, ramps: L.ramps,
    catHidden: clearCats ? null : L.catHidden, catLegend: clearCats ? null : L.catLegend,
    rules: L.rules, ruleHidden: L.ruleHidden, paintCols: L.paintCols,
    // a re-desurvey/re-map/re-channel keeps the SAME rows, so these survive too.
    // They were dropped on every re-desurvey — most consequentially the interval
    // filter, hole filter and color-by, which a method/dip comparison silently
    // reset each time.
    filterExpr: L.filterExpr, colorSel: L.colorSel,
    holeFilter: L.holeFilter, _holeIds: L._holeIds, _holeMask: L._holeMask,
    opacity: L.opacity, clip: L.clip, gtUnits: L.gtUnits,
    legend: L.legend, legendTitle: L.legendTitle, edges: L.edges, _recHide: L._recHide,
    catChoices: L.catChoices,
  };
}

export function applyLayerStyling(L2, keep, { clearCats = false } = {}) {
  if (!L2) return L2;
  L2.colTypes = keep.colTypes; L2.qualify = keep.qualify; applyColTypes(L2);
  L2.calcCols = keep.calcCols;
  L2.ramps = keep.ramps; if (rampCfgOf(L2)) applyRamp(L2, true);
  if (clearCats) { L2.catHidden = null; L2.catLegend = null; S.renderer.setLayerCatVisibility(L2.id, null); S.renderer.setLayerPalette(L2.id, null); }
  else {
    if (keep.catHidden && keep.catHidden.size) { L2.catHidden = keep.catHidden; applyCatVisibility(L2, true); }
    if (keep.catLegend) { L2.catLegend = keep.catLegend; applyCatLegend(L2, true); }
  }
  if (keep.rules) { L2.rules = keep.rules; L2.ruleHidden = keep.ruleHidden; L2._rulesDirty = true; if (ruleModeOf(L2)) { S.renderer.setLayerRuleMode(L2.id, true); runRules(L2, true); } }
  if (keep.paintCols) { L2.paintCols = keep.paintCols; addPaintColorOptions(L2); if (paintActiveCol(L2)) syncRuleMode(L2); }
  // the rows are unchanged, so re-apply the row-scoped view state
  if (keep.opacity != null) { L2.opacity = keep.opacity; S.renderer.setLayerOpacity(L2.id, keep.opacity); }
  if (keep.clip) L2.clip = keep.clip;
  if (keep.gtUnits) L2.gtUnits = keep.gtUnits;
  if (keep.legend != null) L2.legend = keep.legend;
  if (keep.legendTitle != null) L2.legendTitle = keep.legendTitle;
  if (keep.edges != null) L2.edges = keep.edges;
  if (keep._recHide) L2._recHide = keep._recHide;
  if (keep.catChoices) { L2.catChoices = keep.catChoices; addPaintColorOptions(L2); }
  if (keep.holeFilter) { L2.holeFilter = keep.holeFilter; L2._holeIds = keep._holeIds; L2._holeMask = keep._holeMask; }
  if (keep.colorSel && [...$('#colorBy').options].some((o) => o.value === keep.colorSel)) { L2.colorSel = keep.colorSel; setLayerColorSel(L2, keep.colorSel); }
  if (keep.filterExpr) { L2.filterExpr = keep.filterExpr; }        // the sweep is driven by the caller when this layer is active
  return L2;
}

// re-open a delimited layer with a patched column mapping (X/Y/Z/cat re-keys)
export async function reopenWithMapping(L, patch, { clearCats = false } = {}) {
  const doc = L.docs.blockDoc; if (!doc) return;
  closeAttrTable(L.id);
  const m = { ...doc.header.mapping, ...patch };
  const style = captureLayerStyling(L, { clearCats });                // id is reused in place (layer: L.id) → identity intact, styling only
  const ropts = {
    layer: L.id, first: false, forcePoints: doc.forcePoints,
    mapping: { x: m.x, y: m.y, z: m.z, chan: m.chan, cat: m.cat },
    catChanged: m.cat !== doc.header.mapping.cat,          // a cached category list is another column's
  };
  // .dm resolves columns by chan/cat indices (x/y/z come from the DD page)
  if (doc.header.dm) {
    await openDmBlob(doc.blob, doc.name, { layer: L.id, first: false, forcePoints: doc.forcePoints, chan: m.chan, cat: m.cat });
    applyLayerStyling(layerById(L.id), style, { clearCats });
    markProjectDirty();
    refreshProps();
    return;
  }
  // A Parquet-backed layer MUST re-open through its own provider. openBlocksBlob
  // with no provider falls back to the delimited reader, which sniffs Parquet
  // bytes as text, finds no rows, and replaces a perfectly good document with an
  // empty one — the layer keeps its columns and its count but draws nothing.
  // (The reload-from-disk path below already guards `!doc.parquet`; this one did
  // not, so changing the display or category column on any Parquet model emptied
  // it, as did the re-key that runs at the end of an auto-optimize.)
  if (doc.parquet) await openParquetBlocks(doc.blob, doc.name, ropts);
  else await openBlocksBlob(doc.blob, doc.name, ropts);
  applyLayerStyling(layerById(L.id), style, { clearCats });
  markProjectDirty();
  refreshProps();
}

// reinterpret a loaded layer as a different kind (block model ↔ points, ply
// points ↔ mesh) — re-open its source blob through openBlob with an asKind
// override. Grid-from-table isn't a provider yet, so it's not offered.
export function reinterpretOptions(L) {
  if (!L || L.dh) return [];
  const d = L.docs || {};
  if (d.tableDoc) {
    const cols = (layerTableHeader(L) || {}).columns || [];
    return mapColumns(cols) ? [{ kind: 'blocks', label: 'block model (use its X/Y/Z)' }, { kind: 'points', label: 'points (use its X/Y/Z)' }] : [];
  }
  if (d.gridDoc) return L.gridSurface ? [{ kind: 'points', label: 'points (elevation)' }] : [{ kind: 'surface', label: 'surface (shaded relief)' }];
  if (d.blockDoc) return [...(d.blockDoc.forcePoints ? [{ kind: 'blocks', label: 'block model' }] : [{ kind: 'points', label: 'points' }]), { kind: 'table', label: 'table (drop the geometry)' }];
  if (d.plyDoc) return [{ kind: 'mesh', label: 'mesh' }];
  if (d.meshDoc && /\.ply$/i.test(L.name)) return [{ kind: 'points', label: 'points' }];
  if (/\.dxf$/i.test(L.name)) {
    const cur = d.stringsDoc ? (d.stringsDoc.header.kind === 'strings' ? 'lines' : 'points') : 'mesh';
    const c = (d.stringsDoc ? d.stringsDoc.header.dxfCounts : d.meshDoc && d.meshDoc.header.dxfCounts) || {};
    return [
      ...(c.triangles && cur !== 'mesh' ? [{ kind: 'mesh', label: 'mesh (3DFACE surfaces)' }] : []),
      ...(c.strings && cur !== 'lines' ? [{ kind: 'lines', label: 'design strings (capsules)' }] : []),
      ...(c.points && cur !== 'points' ? [{ kind: 'points', label: 'points (pegs)' }] : []),
    ];
  }
  return [];
}

export async function reopenAs(L, kind) {
  let blob = layerBlob(L); if (!blob) { $('#meta').textContent = 'reinterpret: no source for this layer'; return; }
  let name = L.name;
  // an XLSX sheet promoted to geometry: the block provider streams bytes, so the
  // sheet materializes to a delimited blob AT THIS MOMENT — the explicit act,
  // not on the way in (opening a workbook never guesses at coordinates)
  if (L.docs.tableDoc && L.docs.tableDoc.xlsx && (kind === 'blocks' || kind === 'points')) {
    const doc = L.docs.tableDoc.xlsx, h = doc.header;
    const esc = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    let csv = h.columns.map(esc).join(',') + '\n';
    for (let r = 0; r < h.count; r++) csv += doc.at(r).map(esc).join(',') + '\n';
    blob = new Blob([csv], { type: 'text/csv' });
    name = `${basename(L.name).replace(/\.xlsx$/i, '')}-${h.sheet}.csv`;
  }
  const L2 = await reopenReplacing(L, blob, () => openBlob(blob, name, 'add', null, { asKind: kind }));   // incl. visible — reinterpreting a hidden layer used to bring it back visible
  renderLayers(); markProjectDirty();
  return L2;
}

export function reinterpretMenu(L, x, y) { menuXY(x, y, reinterpretOptions(L).map((o) => ({ label: `→ ${o.label}`, action: () => reopenAs(L, o.kind) }))); }

// ── Reload from disk — the missing verb between Scan folder (NEW files only)
// and Reinterpret-as (re-reads the in-memory blob). Re-getFile()s FRESH bytes
// from the layer's handle and re-opens through its existing config: mapping,
// styling, calc/paint columns, surface state, filter all ride through.
// Out of scope (compound sources): drillhole sets, dm wireframe pairs.
export function canReloadLayer(L) {
  if (!L || L.dh) return false;                              // compound (collar+survey+intervals)
  if (!L.handle || !L.handle.getFile) return false;          // drag-dropped blobs are snapshots — no path
  const md = L.docs && L.docs.meshDoc;
  if (md && ((md.header && md.header.format) || md.format) === 'dm-wireframe') return false;   // two files
  return true;
}

export async function reloadLayerFromDisk(L) {
  if (!canReloadLayer(L)) {
    $('#meta').textContent = L && L.dh ? 'reload: a drillhole set is a compound source — use the set menu (re-desurvey / add interval table) or re-import'
      : 'reload: this layer has no file handle (drag-dropped data is a snapshot — open the file again)';
    return;
  }
  let fresh;
  try {
    if (L.handle.queryPermission && (await L.handle.queryPermission({ mode: 'read' })) === 'prompt') await L.handle.requestPermission({ mode: 'read' });
    fresh = await L.handle.getFile();
  } catch (e) { $('#meta').textContent = `reload: can't read ${L.name} — ${e.message}`; return; }
  const old2 = layerBlob(L);
  const sizeNote = old2 && fresh.size !== old2.size ? ' · size changed — painted/materialized columns may be stale (positional)' : '';
  const doc = L.docs.blockDoc;
  closeAttrTable(L.id);
  if (doc && !doc.header.dm && !doc.parquet) {
    // delimited blocks/points: IN PLACE, keeping the column mapping (the
    // reopenWithMapping flow, just with fresh bytes) — identity untouched
    const style = captureLayerStyling(L);
    const m = doc.header.mapping;
    await openBlocksBlob(fresh, L.name, {
      layer: L.id, first: false, forcePoints: doc.forcePoints,
      mapping: { x: m.x, y: m.y, z: m.z, chan: m.chan, cat: m.cat },
    });
    const L2 = layerById(L.id);
    applyLayerStyling(L2, style);
    // Fresh bytes invalidate everything DERIVED from the old ones. This branch
    // reuses the layer object, so nothing is cleared for free: the column stats,
    // the filter-pushdown bands and the JS-side filter mask all survived a reload
    // of different data and were then persisted into the project on the next save.
    // The size-diff note above is the only hint, and a same-size edit gives none.
    if (L2) {
      L2._colStats = null;
      L2._bands = null;
      L2._catCounts = null;
      L2._filterMask = null;                               // the GPU filter was cleared by the re-open; keep JS in step
      if (L2.dh) invalidateWholeHoles(L2);                 // the section's crossing holes too (next frame recomputes)
      L2._selMask = null; L2._selCount = 0;                // and the selection's GPU twin was cleared too — same reasoning, missed first pass
      pinEvictLayer(L2.id);                                // pinned columns belong to the OLD bytes
    }
    // re-sweep against the fresh bytes — any layer (applyBlockFilter used to act on
    // the active layer only, and a background one was left unfiltered until refocused)
    await refilterLayer(L2);                               // the filter scan posts its own status
    $('#meta').textContent = `reloaded ${(L2 && (L2.label || L2.name)) || L.name} from disk${sizeNote}`;
  } else {
    // dm / parquet / mesh / grid / las / ply: remove → re-open fresh → restore
    const style = captureLayerStyling(L);
    const surf = captureLayerSurface(L);
    const filterExpr = L.filterExpr;
    // a DXF layer is ONE kind of what its file holds — reopen that kind, not the dominant one
    const sd = L.docs.stringsDoc;
    const dxfAs = /\.dxf$/i.test(L.name) ? (sd ? (sd.header.kind === 'strings' ? 'lines' : 'points') : 'mesh') : null;
    const L2 = await reopenReplacing(L, fresh, () => openBlob(fresh, L.name, 'add', null, dxfAs ? { asKind: dxfAs } : doc && doc.forcePoints ? { asKind: 'points' } : undefined));
    if (L2) {
      applyLayerStyling(L2, style);
      await applyLayerSurface(L2, surf);
      L2.filterExpr = filterExpr;
      await refilterLayer(L2, filterExpr);                 // any layer (was: only if it had been the active one)
    }
    renderLayers();
    $('#meta').textContent = `reloaded ${(L2 && (L2.label || L2.name)) || L.name} from disk${sizeNote}`;
  }
  markProjectDirty();
  refreshProps();
}
