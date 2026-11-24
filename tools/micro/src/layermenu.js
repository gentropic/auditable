// the layer context menu and the actions behind it: fit, remove, mesh tier, tint, opacity
import { S, layerById, requestRender } from './state.js';
import { microConfirm, microPrompt } from './prompts.js';
import { removeLayerUI, setActiveLayer } from './layers.js';
import { createLayerGroup, showNode, treeMoveStep } from './tree.js';
import { _lpSel, lpSelIds, moveLayerToGroupMenu, renderLayers, secModeLabel, sectionModeItems } from './layers-panel.js';
import { menuXY } from './menu.js';
import { openBatchRename, renameActiveLayer } from './rename.js';
import { openMeshExportDialog, writeGridDisplayCache } from './meshexport.js';
import { openGridExportDialog } from './grid-export.js';
import { canChangeFile, canReloadLayer, changeLayerFile, reinterpretMenu, reinterpretOptions, reloadLayerFromDisk } from './reopen.js';
import { hasRecords, layerTableHeader } from './records.js';
import { openAttrTable } from './attrtable.js';
import { numericColsOf } from './analysis.js';
import { openStats } from './stats.js';
import { openXyPlot } from './xyplot.js';
import { gridAxesOf } from './grid-ops.js';
import { openGradeTonnage } from './gt.js';
import { openCrosstab } from './xtab.js';
import { openSwath } from './swath.js';
import { showFileInfo } from './fileinfo.js';
import { openLineageWindow } from './lineage-ui.js';
import { openExportDialog } from './export-dialog.js';
import { openProps, stageGate } from './props.js';
import { copyStyle, pasteStyle, saveStyleFile, loadStyleFile } from './style-clip.js';
import { materializeCalcCol } from './calc.js';
import { applyHoleFilter, dhSetGroupOf } from './drillholes.js';
import { peekCollarCols } from './manifest.js';
import { canCopyIntoProject, copyLayerIntoProject, markProjectDirty } from './project.js';
import { openOptimizeDialog } from './optimize.js';
import { setDmOrigin } from './open-blocks.js';
import { convertLayerToParquet } from './export.js';
import { scanColumns } from './columns.js';
import { openSolidDialog } from './bygeom-ui.js';
import { isView, canView, createView, viewsOf, modelOf } from './layerviews.js';
import { openMeshGridDialog, openSurfaceTools, surfaceableLayers } from './gridtools.js';
import { openMeshQa } from './meshqa.js';
import { isPointCloud, openPcGridDialog } from './pcgrid.js';
import { openModelQa } from './modelqa.js';
import { openComposite } from './composite-ui.js';
import { openPairing } from './pairing.js';
import { openGradeShell } from './shells.js';
import { openContact, isDhLayer, isBlockLayer } from './contact.js';
import { openFactors, isBlockModel as factorsModel } from './factors.js';
import { openStructure } from './structure-ui.js';
import { fmtSize, layerBytes } from './paths.js';
import { CONTEXT_TRI_CAP, openMeshDoc } from './open-mesh.js';
import { hexToRgb01 } from './color.js';
import { recolorSurface } from './surfaces.js';
import { filterToSelection, selectionToColumn } from './selection.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setLayermenuHooks): _blockEdges
let H = {};
export function setLayermenuHooks(h) { H = h; }

// the menu verbs the command palette shares (its commands: src/command-list.js) — one body each
// a lone drillhole layer's hole filter (a set's goes through drillholes.js filterHolesSet)
export async function filterHolesLayer(L) {
  const cc = await peekCollarCols(L.docs.dhDoc).catch(() => []);
  const v = await microPrompt('hole filter — an expression over the COLLAR columns (empty clears)', L.holeFilter || '', { expr: () => ({ columns: cc.map((c) => ({ name: c.name, type: c.type === 'number' ? 'number' : 'string' })) }) });
  if (v == null) return;
  const r = await applyHoleFilter(L, v);
  $('#meta').textContent = r && r.err ? `hole filter: ${r.err}` : (r && r.holes != null ? `hole filter: ${r.holes} of ${r.total} holes` : 'hole filter cleared');
}
// a block model's stats + band index (written as a sidecar on the next save)
export async function buildLayerIndex(L) {
  await scanColumns(L, (a2, b2) => { $('#meta').textContent = `indexing ${L.label || L.name} — ${b2 ? Math.round(100 * a2 / b2) : 0}%…`; }, { bands: !L.docs.blockDoc.parquet });
  $('#meta').textContent = `indexed ${L.label || L.name} — stats + band index ready (written as a sidecar on the next project save)`;
  markProjectDirty();
}
// a decimated GeoTIFF's Surfer display-cache sidecar (fast reopen) — needs a project folder
export const canBuildDisplayCache = (L) => !!(L && L.docs.gridDoc && L.docs.gridDoc.source && !L.docs.gridDoc.fullRes && S.project && /\.(tif|tiff)$/i.test(L.name));
export async function buildDisplayCache(L) {
  try { const why = await writeGridDisplayCache(L, S.project.dir); $('#meta').textContent = why ? `display cache: ${why}` : `display cache written · ${L.name}.disp.grd`; } catch (e) { $('#meta').textContent = `display cache — ${e.message}`; }
}
export function fitLayer(L) { if (L.bboxLocal) { S.cam.fit(L.bboxLocal); requestRender(); } }

// the UI's remove (context menu, palette): a layer carrying its OWN columns —
// painted, calculated, joined — loses them with it (the file on disk is never
// touched, but those exist nowhere else until a save), so that asks first. The
// host API and the open paths call removeLayerUI directly, without asking.
export async function confirmRemoveLayer(id) {
  const L = layerById(id); if (!L) return;
  if (isView(L)) { removeLayerUI(id); return; }           // display only — the data stays with its model
  const vs = viewsOf(L);
  if (vs.length && !(await microConfirm('remove layer', `Remove “${L.label || L.name}”? Its view${vs.length === 1 ? '' : 's'} (${vs.map((v) => v.label).join(', ')}) go${vs.length === 1 ? 'es' : ''} with it.`, 'Remove', 'Cancel'))) return;
  const own = [...(L.paintCols || []).filter((c) => c.name !== '_swath'), ...(L.calcCols || [])].map((c) => c.name);
  if (own.length && !(await microConfirm('remove layer', `Remove “${L.label || L.name}”? Its ${own.length} column${own.length === 1 ? '' : 's'} of its own (${own.slice(0, 6).join(', ')}${own.length > 6 ? ', …' : ''}) go${own.length === 1 ? 'es' : ''} with it${S.project && !S.project.dirty ? ' from this session (the saved project still has them until the next save)' : ''}. The file on disk is untouched.`, 'Remove'))) return;
  removeLayerUI(id);
}

// The layer's right-click menu. The top level is short — what you reach for most
// (zoom, rename, show/hide, properties, table, filter) — and everything else sits in
// a submenu named like the menubar / palette groups: Analyse · Geometry · Select ·
// Views, then Display · Data & file · Move. A submenu with nothing in it for this
// layer is left out. layerMenuSections(L, x, y) builds the tree (the smoke walks it,
// so an item can't silently vanish); layerMenu opens it.
export function layerMenuSections(L, x, y) {
  const selN = _lpSel.size;
  const view = isView(L);
  const dh = !!(L.dh && L.docs.dhDoc && !L.trace);
  const grid = gridAxesOf(L);
  const opacity = () => ({ label: `Opacity (${Math.round((L.opacity != null ? L.opacity : 1) * 100)}%)`, submenu: () => opacityMenuItems(L) });
  const h = L.kind === 'mesh' && L.docs.meshDoc && L.docs.meshDoc.header;   // a mesh's header (null while it loads)

  // ── Analyse: the analyses that apply to this kind ──
  const analyse = [
    ...(layerTableHeader(L) && numericColsOf(L).length ? [{ label: 'Stats…', action: () => openStats(L) }, { label: 'Scatter / Q-Q…', action: () => openXyPlot(L) }] : []),
    ...(!grid && dh ? [{ label: 'Grade-tonnage…', action: () => openGradeTonnage(L) }] : []),   // length-weighted (src/analysis.js supportContextOf)
    ...(grid ? [{ label: 'Grade-tonnage…', action: () => openGradeTonnage(L) }, { label: 'Resource cross-tab…', action: () => openCrosstab(L) }, { label: 'Swath plot…', action: () => openSwath(L) }] : []),
    ...(grid && !view ? [{ label: 'Grade shell…', action: () => openGradeShell(L) }, { label: 'Block vs sample…', action: () => openPairing(L) }] : []),
    // contact analysis: grade binned by distance to a domain boundary (down the holes, or to a wireframe)
    ...(!view && isDhLayer(L) && numericColsOf(L).length ? [{ label: 'Contact plot…', action: () => openContact(L, { mode: 'downhole' }) }] : []),
    ...(!view && (isDhLayer(L) || isBlockLayer(L)) && numericColsOf(L).length ? [{ label: 'Distance to a surface…', action: () => openContact(L, { mode: 'surface' }) }] : []),
    // reconciliation: F1 / F2 / F3 totals inside the mined volume, per period (this layer = the resource model)
    ...(!view && factorsModel(L) ? [{ label: 'Reconciliation factors…', action: () => openFactors(L) }] : []),
    ...(!view && L.docs && L.docs.blockDoc ? [{ label: 'Model QA…', action: () => openModelQa(L) }] : []),
    ...(!view && dh ? [{ label: 'Composite…', action: () => openComposite(L) }] : []),
    ...(h ? [{ label: 'Mesh QA / volume…', action: () => openMeshQa(L) }] : []),
    ...(h && !L.derivedOf ? [{ label: 'Structural analysis…', action: () => openStructure(L) }] : []),
  ];

  // ── Geometry: a surface or a solid acting on other layers, or made into another one ──
  const geometry = [
    ...(L.docs.gridDoc ? [{ label: 'Flag / ratio by this surface…', action: () => openSolidDialog(L) }] : []),
    ...(h && !h.soup ? [{ label: 'Select by this solid…', action: () => openSolidDialog(L) }, { label: 'Rasterize to grid…', action: () => openMeshGridDialog(L) }] : []),
    ...(isPointCloud(L) && !view ? [{ label: 'Grid points to DEM…', action: () => openPcGridDialog(L) }] : []),
    ...(L.docs.gridDoc || (h && !h.soup) ? [{ label: 'Extend to footprint…', action: () => openSurfaceTools('extend', L) },
      ...(surfaceableLayers().length >= 2 ? [{ label: 'Combine surfaces…', action: () => openSurfaceTools('combine', L) }] : [])] : []),
  ];

  // ── Select: the filter and the selection, turned into each other or into a column ──
  const select = [
    ...(L._filterMask ? [{ label: 'Filter → selection', action: () => filterToSelection(L) }] : []),
    ...(L._selCount ? [{ label: `Selection → column… (${L._selCount.toLocaleString()} rows)`, action: () => selectionToColumn(L) }] : []),
  ];

  // ── Views: the same model shown again ──
  const views = canView(L) ? [
    { label: 'New view of this layer', action: () => createView(L).catch((e) => { $('#meta').textContent = `view — ${e.message}`; }) },
    { label: 'New view beside it', action: () => createView(L, { beside: true }).catch((e) => { $('#meta').textContent = `view — ${e.message}`; }) },
  ] : [];

  // ── Display: how this layer draws ──
  const display = [
    ...(L.kind !== 'mesh' && (L.docs.blockDoc || L.dh) ? [opacity()] : []),
    ...(drawnAsPointChunks(L) ? [{ label: `Point size (×${S.renderer.layerPointScale(L.id)})`, submenu: () => pointScaleMenuItems(L) }] : []),
    ...(L.dh ? [{ label: `Stick radius… (${S.renderer.layerStickRadius(L.id)} m)`, action: async () => {
      const v = await microPrompt('stick radius (metres)', String(S.renderer.layerStickRadius(L.id)));
      const r = parseFloat(v);
      if (Number.isFinite(r) && r > 0) {
        S.renderer.setLayerStickRadius(L.id, r);             // the context-menu path stays live (no panel involved)
        if (L.docs.dhDoc) L.docs.dhDoc.config.radius = r;   // persists via the project manifest
        markProjectDirty(); requestRender();
      }
    } }] : []),
    ...(L.kind === 'mesh' ? [
      { label: 'Tint…', action: () => setTimeout(() => meshTintMenu(L, x, y), 0) },
      opacity(),
    ] : []),
    ...(L.gridSurface ? [{ label: 'Drape', submenu: () => {
      const grids = S.layers.filter((g) => g !== L && g.docs && g.docs.gridDoc && g.docs.gridDoc.grid);
      return [{ label: (L.drapeSource ? '' : '✓ ') + 'elevation', action: () => recolorSurface(L, null) },
        ...(grids.length ? grids.map((g) => ({ label: (L.drapeSource === g.name ? '✓ ' : '') + (g.label || g.name), action: () => recolorSurface(L, g) })) : [{ label: '(load another grid to drape over it)', action: () => {} }])];
    } }] : []),
    ...(L.docs.blockDoc ? [{
      label: `Block edges: ${L.edges == null ? 'auto' : L.edges ? 'on' : 'off'}`,
      submenu: () => [[null, `auto (follow View${H._blockEdges ? ' — on' : ' — off'})`], [true, 'on'], [false, 'off']].map(([v, t]) => ({
        label: ((L.edges === v || (v === null && L.edges == null)) ? '✓ ' : '') + t,
        action: () => { L.edges = v; S.renderer.setLayerEdges(L.id, v); markProjectDirty(); requestRender(); },
      })),
    }] : []),
    { label: 'Cut by sections' + secModeLabel(S.renderer.layerSectioned(L.id)), submenu: () => sectionModeItems(L) },
    // a style travels by NAME (src/style-clip.js): onto another layer, another model, another project
    { label: 'Style', submenu: () => [
      { label: 'Copy style', action: () => copyStyle(L) },
      { label: 'Paste style', action: () => pasteStyle(L) },
      { label: 'Save style…', action: () => saveStyleFile(L) },
      { label: 'Load style…', action: () => loadStyleFile(L) },
    ] },
  ];

  // ── Data & file: where the layer comes from, how it is stored, and what leaves it ──
  const data = [
    ...(!view && reinterpretOptions(L).length ? [{ label: 'Reinterpret as…', action: () => setTimeout(() => reinterpretMenu(L, x, y), 0) }] : []),
    ...(!view && canReloadLayer(L) ? [{ label: 'Reload from disk', action: () => reloadLayerFromDisk(L) }] : []),
    ...(canChangeFile(L) ? [{ label: 'Change file…', action: () => changeLayerFile(L) }] : []),
    // a rotated Datamine model placed in world: where its local origin sits (an anonymised file carries none)
    ...(!view && L.docs && L.docs.blockDoc && L.docs.blockDoc.header.dmRotationApplied ? [{ label: 'Datamine origin…', action: async () => { if (await setDmOrigin(L)) markProjectDirty(); } }] : []),
    ...(L.dh && L.docs.dhDoc && !dhSetGroupOf(L.id) ? [{ label: (L.holeFilter ? '✓ ' : '') + 'Filter holes…', action: () => filterHolesLayer(L) }] : []),
    ...(!view && (L.calcCols || []).length ? [{ label: 'Materialize calc column', submenu: () => (L.calcCols || []).map((c) => ({ label: `${c.name} → stored`, action: () => materializeCalcCol(L, c.name) })) }] : []),
    ...(view ? [] : L.docs.blockDoc && !(L.docs.blockDoc.parquet) ? [{ label: 'Store as Parquet…', action: async () => { const res = await openOptimizeDialog([L]); if (res && res.layers.length) await convertLayerToParquet(L, { keepOriginal: res.keepOriginal }); } }] : []),
    ...(L.docs.blockDoc && !view ? [{ label: 'Build index (stats + pushdown)…', action: () => buildLayerIndex(L) }] : []),
    ...(h ? (() => {                                       // the mesh tier: exact (indexed f32) ⇄ streamed (u16 soup)
      const now = S.renderer.layerVramBytes(L.id);
      if (!h.soup) return [{ label: `Convert to streamed (${fmtSize(now)} → ~${fmtSize(h.triCount * 18)})`, action: () => convertMeshLayer(L, true) }];   // u16 soup: 9 coords × 2 B
      return [{ label: `Convert to exact (${fmtSize(now)} → ~${fmtSize(exactMeshBytes(h))})${h.triCount > CONTEXT_TRI_CAP ? ' — over the usual cap' : ''}`, action: () => convertMeshLayer(L, false) }];
    })() : []),
    ...(L.docs.gridDoc && canBuildDisplayCache(L) ? [{ label: 'Build display cache', action: () => buildDisplayCache(L) }] : []),
    ...(!view && canCopyIntoProject(L) ? [{ label: `Copy into project (${fmtSize(layerBytes(L))})`, action: () => copyLayerIntoProject(L) }] : []),
    ...(layerTableHeader(L) ? [{ label: 'Export rows…', action: () => openExportDialog(L) }] : []),
    ...(h ? [{ label: 'Export mesh…', action: () => openMeshExportDialog([L]) }] : []),
    ...(L.docs.gridDoc ? [{ label: 'Export grid…', action: () => openGridExportDialog(L) }] : []),
    { label: 'File info…', action: () => { setActiveLayer(L.id); showFileInfo(); } },
    ...(L.lineage ? [{ label: 'Lineage…', action: () => openLineageWindow(L) }] : []),
  ];

  const sub = (label, items) => (items.length ? [{ label, submenu: () => items }] : []);
  return [
    ...(selN >= 2 && _lpSel.has(L.id) ? [
      { label: `Group ${selN} selected…`, action: async () => {
        const v = await microPrompt('group name', 'group');
        if (!v || !v.trim()) return;
        const ids = lpSelIds();
        _lpSel.clear();
        createLayerGroup(v.trim(), ids, { collapsed: false });
      } },
      { label: `Rename ${selN} selected…`, action: () => openBatchRename(lpSelIds().map(layerById)) },
      ...(() => {
        const meshSel = lpSelIds().map(layerById).filter((m) => m && m.kind === 'mesh' && m.docs.meshDoc);
        return meshSel.length >= 2 ? [{ label: `Export ${meshSel.length} meshes…`, action: () => openMeshExportDialog(meshSel) }] : [];
      })(),
      { sep: true },
    ] : []),
    // a VIEW: what it is, and where its file's verbs live
    ...(view ? [{ label: `View of “${(modelOf(L) || {}).label || (modelOf(L) || {}).name}” — select it`, action: () => setActiveLayer(L.viewOf) }, { sep: true }] : []),
    ...(L.kind === 'table' ? [] : [{ label: 'Zoom to layer', action: () => fitLayer(L) }]),
    { label: view ? 'Rename view…' : 'Rename layer…', kbd: 'F2', action: () => renameActiveLayer(L) },
    { label: L.visible ? 'Hide layer' : 'Show layer', action: () => showNode(L.id, !L.visible) },
    { label: 'Properties…', action: () => { setActiveLayer(L.id); openProps(); } },
    ...(hasRecords(L) ? [{ label: 'Attribute table…', kbd: 't', action: () => openAttrTable(L) }] : []),
    ...(hasRecords(L) ? [{ label: 'Filter…', kbd: '/', action: () => { setActiveLayer(L.id); $('#filter').focus(); } }] : []),
    { sep: true },
    ...sub('Analyse', analyse),
    ...sub('Geometry', geometry),
    ...sub('Select', select),
    ...sub('Views', views),
    { sep: true },
    ...sub('Display', display),
    ...sub('Data & file', data),
    { label: 'Move', submenu: () => [
      { label: 'Up', action: () => treeMoveStep(L.id, -1) },
      { label: 'Down', action: () => treeMoveStep(L.id, 1) },
      { label: 'To group…', action: () => setTimeout(() => moveLayerToGroupMenu(L, x, y), 0) },
    ] },
    { label: view ? 'Remove view' : 'Remove layer', action: () => confirmRemoveLayer(L.id) },
  ];
}

export function layerMenu(L, x, y) { menuXY(x, y, layerMenuSections(L, x, y)); }

// tier conversion: re-open the SAME blob through the other tier, keeping the
// layer's identity (id, label, style, visibility, section exemption). Exact
// (indexed f32) trades VRAM for survey-true vertices; streamed (u16 soup)
// trades ~8 mm-per-chunk quantization for ~2-3× less VRAM + budgeted draw.
// the exact tier's GPU cost: indexed f32 positions + u32 triangle indices
export function exactMeshBytes(h) { return (h.vertexCount || h.triCount / 2) * 12 + h.triCount * 12; }

export async function convertMeshLayer(L, toSoup, { confirmed = false } = {}) {
  const md = L.docs.meshDoc; if (!md) return false;
  const h = md.header;
  // PROMOTE-TO-CONTEXT: a mesh over the cap opened streamed, which keeps no CPU geometry.
  // The exact tier is still possible — it costs memory, so it is the user's call, stated
  // up front, with no hard ceiling (a 20M-triangle outcrop on a workstation is legitimate).
  if (!toSoup && h.triCount > CONTEXT_TRI_CAP && !confirmed) {
    const ok = await microConfirm('Load the exact mesh?',
      `${h.triCount.toLocaleString()} triangles is over the ${CONTEXT_TRI_CAP.toLocaleString()} micro loads exactly by default, so it opened streamed. ` +
      `The exact tier keeps the whole mesh: about ${fmtSize(exactMeshBytes(h))} of GPU memory, plus the file's geometry in this tab while it loads. ` +
      'Structural analysis, solid queries and rasterizing need it. A large mesh can make the tab slow, or run out of memory on a small device.',
      'Load exact', 'Cancel');
    if (!ok) return false;
  }
  const keep = { visible: L.visible, sectioned: S.renderer.layerSectioned(L.id) };
  S.renderer.removeLayer(L.id);                              // frees chunks + layer state
  $('#meta').textContent = `${md.name} — converting to ${toSoup ? 'streamed' : 'exact'}…`;
  try {
    await openMeshDoc(md.blob, md.name, { layer: L.id, first: false, tint: L.tint, opacity: L.opacity, forceSoup: toSoup, forceContext: !toSoup });
    if (!keep.visible) { L.visible = false; S.renderer.setLayerVisible(L.id, false); }
    if (keep.sectioned !== true) S.renderer.setLayerSectioned(L.id, keep.sectioned);
    renderLayers(); markProjectDirty(); requestRender();
    return true;
  } catch (e) { $('#meta').textContent = `${md.name} — ${e.message}`; return false; }
}

// mesh styling: a small preset palette (geology-ish) + custom hex; opacity is
// Bayer screen-door in the pipeline, so any value is depth-correct
export const MESH_TINTS = [['Grey', '#9ea3a8'], ['Sand', '#c9a86a'], ['Rust', '#b0563a'], ['Green', '#5c8a5a'], ['Blue', '#5b7fa6'], ['Violet', '#8a6fae'], ['Brown', '#8a6a4f']];

export function setMeshTint(L, hex) { L.tint = hex; stageGate(L, () => { S.renderer.setLayerMeshStyle(L.id, { tint: hexToRgb01(hex) }); requestRender(); }); markProjectDirty(); }

export function meshTintMenu(L, x, y) {
  menuXY(x, y, [
    ...MESH_TINTS.map(([label, hex]) => ({ label: (L.tint === hex ? '✓ ' : '') + label, action: () => setMeshTint(L, hex) })),
    { sep: true },
    { label: 'Custom…', action: async () => {
      const v = ((await microPrompt('tint (hex)', L.tint || '#9ea3a8')) || '').trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) setMeshTint(L, v.startsWith('#') ? v : '#' + v);
    } },
  ]);
}

// per-layer opacity, kind-aware: meshes screen-door via meshStyle, blocks/sticks
// via setLayerOpacity (both are Bayer dither in-shader — see-through, no blend order).
export function applyLayerOpacity(L, v) {
  L.opacity = v;
  if (L.kind === 'mesh') S.renderer.setLayerMeshStyle(L.id, { opacity: v });
  else S.renderer.setLayerOpacity(L.id, v);
  markProjectDirty(); requestRender();
}

// a layer drawn as POINTS (clouds, point-drawn models, collars) has its own
// glyph size — a multiple of the global point size, drawn and picked at it
export function drawnAsPointChunks(L) {
  const d = (L && L.docs) || {};
  if (L && L.viewOf != null) return false;                 // (a view's points are its model's chunks)
  if (d.lasDoc || d.plyDoc) return true;
  const bd = d.blockDoc;
  return !!bd && (!bd.grid || !!bd.forcePoints);
}
export function setLayerPointScale(L, k) {
  S.renderer.setLayerPointScale(L.id, k);
  L.pointScale = S.renderer.layerPointScale(L.id);
  markProjectDirty(); requestRender();
}
export const pointScaleMenuItems = (L) => [1, 2, 3, 5, 8].map((k) => ({
  label: (S.renderer.layerPointScale(L.id) === k ? '✓ ' : '') + '×' + k,
  action: () => setLayerPointScale(L, k),
}));
export const opacityMenuItems = (L) => [100, 75, 50, 25].map((pc) => ({
  label: (Math.round((L.opacity != null ? L.opacity : 1) * 100) === pc ? '✓ ' : '') + pc + '%',
  action: () => applyLayerOpacity(L, pc / 100),
}));
