// micro command list — the app's own palette commands: the ones no feature module registers
// itself (src/commands.js has the registry). The ORDER here is the palette's order: a string is a
// slot for a command another module registers. Carved from index.html (2026-11-24).
import { registerCommands } from './commands.js';
import { PHI_MAX } from './camera.js';
import { activeLayer, S, layerById, requestRender } from './state.js';
import { layerTableHeader, hasRecords } from './records.js';
import { scanColumns } from './columns.js';
import { convertLayerToParquet } from './export.js';
import { openSectionSeries } from './section-series.js';
import { setLang, LANG } from './i18n.js';
import { recipesMenuItems, openCheckAllRecipes } from './recipes.js';
import { openRoutineWindow } from './routine-ui.js';
import { setPropTab, openProps, _propOpen, renderProps } from './props.js';
import { copyStyle, pasteStyle, saveStyleFile, loadStyleFile } from './style-clip.js';
import { newProject, saveProject, canCopyIntoProject, copyLayerIntoProject, markProjectDirty, openProjectPicker, saveProjectAs } from './project.js';
import { tidyProject, scanFolderForNewData } from './project-folder.js';
import { packableMesh, packLayersToWfr, openOptimizeDialog } from './optimize.js';
import { backupProject, openProjectPack, restoreProject } from './project-pack.js';
import { setDmOrigin } from './open-blocks.js';
import { openDhDialog } from './open-dialog.js';
import { canReloadLayer, reloadLayerFromDisk, canChangeFile, changeLayerFile, reinterpretOptions, reinterpretMenu } from './reopen.js';
import { exportFigure, openDecoPanel, setDeco, _deco, setLayerLegend, saveDeco, drawDecorations, _bgColor, setBg } from './deco.js';
import { applyTreeVisibility, showNode, groupAt, groupPathOf, groupLayerIds } from './tree.js';
import { renderLayers, _lpSel, lpSelIds, toggleLayersPanel, moveLayerToGroupMenu } from './layers-panel.js';
import { saveViewAs, saveSceneAs } from './views.js';
import { armMeasure } from './overlay.js';
import { microPrompt } from './prompts.js';
import { menuXY } from './menu.js';
import { openWfrDialog, wfrExportable, openMeshExportDialog } from './meshexport.js';
import { openGridExportDialog } from './grid-export.js';
import { openNewDialog, surfaceableLayers, openSurfaceTools, openMeshGridDialog } from './gridtools.js';
import { openExportDialog } from './export-dialog.js';
import { openSolidDialog, openDomainsDialog } from './bygeom-ui.js';
import { openCalcWindow } from './calc.js';
import { showMemoryInfo, showFileInfo } from './fileinfo.js';
import { openSettingsWindow } from './settings.js';
import { setTheme, resolvedTheme } from './theme.js';
import { openThemeEditor } from './theme-editor.js';
import { openExplode } from './explode.js';
import { openTurntable } from './turntable.js';
import { openRecipeForm } from './recipe-form.js';
import { openLibraryWindow } from './library.js';
import { openRunsWindow } from './runs-ui.js';
import { refreshAllFigures, openComposer } from './composer.js';
import { openLineageWindow } from './lineage-ui.js';
import { openFilePicker, _remember, _recents, clearRecents } from './recents.js';
import { renameActiveLayer, openBatchRename } from './rename.js';
import { openAttrTable } from './attrtable.js';
import { setActiveLayer } from './layers.js';
import { canView, createView, isView } from './layerviews.js';
import { confirmRemoveLayer, fitLayer, meshTintMenu, buildLayerIndex, canBuildDisplayCache, buildDisplayCache } from './layermenu.js';
import { selectionToColumn, filterToSelection, armSelect, setSelThrough, _selThrough, clearSelection } from './selection.js';
import { openPaintPalette } from './paint.js';
import { currentSection, toggleSection, viewAlongSection, scrubSection } from './section.js';
import { setBlockEdges, _blockEdges, setView, cam } from './viewport.js';
import { compassMenu } from './compass.js';
import { canPlace, openPlacementDialog } from './placement-ui.js';
import { windowsMenu, cascadeWindows, closeAllWindows, openPropsTab, clearFilter, bookmarksMenuItems, scenesMenuItems } from './menubar.js';

const $ = (s) => document.querySelector(s);

// ⇧H solo: hide everything but the active layer; ⇧H again restores the previous
// visibility set. If the ACTIVE layer changed while soloed ([ ] stepping), ⇧H
// re-solos the new one instead of restoring — so ⇧H · ] · ⇧H · ] · ⇧H walks the
// layers one at a time, and a final ⇧H (same layer) brings everything back.
let _solo = null;                                          // { id, prev: Map(id→visible) }
export function soloActiveLayer() {
  const La = activeLayer(); if (!La) return;
  if (_solo && _solo.id === La.id) {
    for (const L of S.layers) if (_solo.prev.has(L.id)) L.visible = _solo.prev.get(L.id);
    _solo = null;
    $('#meta').textContent = 'solo off';
  } else {
    if (!_solo) {
      if (S.layers.length < 2) { $('#meta').textContent = 'solo: only one layer'; return; }
      _solo = { id: La.id, prev: new Map(S.layers.map((L) => [L.id, L.visible])) };
    } else _solo.id = La.id;                               // re-solo the new active, keep the original snapshot
    for (const L of S.layers) L.visible = L.id === La.id;
    $('#meta').textContent = `solo — ${La.label || La.name} (⇧H restores)`;
  }
  applyTreeVisibility(); renderLayers();
}

// ── command palette (GCU noun-first model): one searchable registry over every
// verb, context-aware via when(ctx). The discoverability surface that ties the
// menubar / context menus / keyboard together. Ctrl/⌘K or the ⌘K button. ──
registerCommands([
  { id: 'open', group: 'File', title: 'Open file…', kw: 'load import csv las ply parquet dm tif grd xyz obj msh', run: () => openFilePicker() },
  { id: 'new', group: 'File', title: 'New grid / block model…', kw: 'create empty cover common lattice', run: () => openNewDialog() },
  { id: 'newproj', group: 'File', title: 'New project (clear)', kw: 'reset slate', run: () => newProject() },
  { id: 'save', group: 'File', title: 'Save project', kw: 'store', when: () => S.hasFSAA, run: () => saveProject() },
  // on Firefox/Safari the whole projects story is unavailable (no File System
  // Access API) — say so instead of the commands just not existing
  { id: 'nofs', group: 'File', title: 'Save / open project (needs Chrome or Edge)', kw: 'store firefox safari unsupported', when: () => !S.hasFSAA,
    run: () => { $('#meta').textContent = 'projects need the File System Access API — use Chrome or Edge to save/open a project folder. Viewing, filtering and analysis work in any browser.'; } },
  { id: 'tidy', group: 'File', title: 'Tidy project folder', kw: 'organize subfolders kind reorganize move drillholes models clouds meshes grids', when: () => S.hasFSAA && !!S.project && !S.project.pack, run: () => tidyProject() },
  { id: 'backup', group: 'File', title: 'Back up project', kw: 'backup zip archive export whole project copy move machine .zip.micro save', when: () => !!S.project, run: () => backupProject() },
  { id: 'open-pack', group: 'File', title: 'Open project pack (read-only)', kw: 'open pack backup zip .zip.micro read-only view look without unpacking', when: () => true, run: () => openProjectPack() },
  { id: 'restore', group: 'File', title: 'Restore project from backup', kw: 'restore backup zip unzip import project .zip.micro unpack', when: () => S.hasFSAA, run: () => restoreProject() },
  { id: 'scan', group: 'File', title: 'Scan folder for new data', kw: 'import inbox dropped rescan pick up new files refresh', when: () => S.hasFSAA && !!S.project && !S.project.pack, run: () => scanFolderForNewData() },
  { id: 'png', group: 'File', title: 'Save viewport PNG', kw: 'screenshot image capture', run: () => $('#btnShot').click() },
  { id: 'style-copy', group: 'Layer', title: 'Copy style', kw: 'style symbology legend classes colours ramp copy', when: () => !!activeLayer(), run: () => copyStyle(activeLayer()) },
  { id: 'style-paste', group: 'Layer', title: 'Paste style', kw: 'style symbology legend classes colours ramp paste apply', when: () => !!activeLayer(), run: () => pasteStyle(activeLayer()) },
  { id: 'style-save', group: 'Layer', title: 'Save style…', kw: 'style symbology file export json', when: () => !!activeLayer(), run: () => saveStyleFile(activeLayer()) },
  { id: 'style-load', group: 'Layer', title: 'Load style…', kw: 'style symbology file import json', when: () => !!activeLayer(), run: () => loadStyleFile(activeLayer()) },
  { id: 'figure', group: 'File', title: 'Export figure (PNG)…', kw: 'decorations scale bar north legend title report', run: () => exportFigure() },
  { id: 'section-series', group: 'File', title: 'Export a section series…', kw: 'sections serial every pack sheets plates pdf print figures review slices zip', when: () => $('#secMode').value !== 'off', run: () => openSectionSeries() },
  { id: 'refresh-figures', group: 'File', title: 'Refresh all figures — render every composer 3D view again with the data as it is now', kw: 'composer figure update stale rerender atlas report', when: () => S.figures.length > 0, run: () => refreshAllFigures() },
  { id: 'composer', group: 'File', title: 'Composer — lay out a page (3D views, legends, scale bars, captions, plots) → PDF / PNG…', kw: 'page layout figure atlas pdf print report a4 a3 map compose plate', run: () => openComposer() },
  { id: 'turntable', group: 'File', title: 'Record a turntable video…', kw: 'orbit spin rotate movie animation webm mp4 presentation linkedin', run: () => openTurntable() },
  'structure', 'shell', 'pairing', 'composite', 'modelqa', 'meshqa', 'scatter', 'qq', 'xtab', 'dhqa', 'proj-max', 'proj-min', 'proj-mean', 'proj-off',
  { id: 'blockedges', group: 'View', title: 'Toggle block edges', kw: 'borders lines wireframe outline grid', when: (c) => c.L && !!c.L.docs.blockDoc, run: () => setBlockEdges(!_blockEdges) },
  { id: 'secfollow', group: 'View', title: 'Section: camera follows the scrub', kw: 'walk slicer step through benches follow', when: () => !!currentSection(), run: () => { const c = $('#secFollow'); c.checked = !c.checked; c.dispatchEvent(new Event('input')); $('#meta').textContent = `section follow ${c.checked ? 'on' : 'off'}`; } },
  { id: 'sec2d', group: 'View', title: 'Section: 2D lock (face-on, ortho, no orbit)', kw: 'paper plan flat lock rotation', when: () => !!currentSection(), run: () => { const c = $('#sec2D'); c.checked = !c.checked; c.dispatchEvent(new Event('input')); } },
  { id: 'solo', group: 'View', title: 'Solo the active layer', kw: 'hide others isolate only', when: (c) => c.L && S.layers.length > 1, run: () => soloActiveLayer() },
  { id: 'copyin', group: 'File', title: 'Copy layer into project…', kw: 'import move file folder store persist', when: (c) => canCopyIntoProject(c.L), run: (c) => copyLayerIntoProject(c.L) },
  { id: 'new-view', group: 'Layer', title: 'New view of this layer', kw: 'twice duplicate show again second colour column side by side isatis', when: (c) => canView(c.L), run: (c) => createView(c.L).catch((e) => { $('#meta').textContent = `view — ${e.message}`; }) },
  { id: 'new-view-beside', group: 'Layer', title: 'New view beside this layer', kw: 'side by side next to two columns compare offset', when: (c) => canView(c.L), run: (c) => createView(c.L, { beside: true }).catch((e) => { $('#meta').textContent = `view — ${e.message}`; }) },
  { id: 'view-model', group: 'Layer', title: 'Select the layer this view shows', kw: 'model source parent', when: (c) => isView(c.L), run: (c) => setActiveLayer(c.L.viewOf) },
  { id: 'rename', group: 'Layer', title: 'Rename layer…', kw: 'label title F2', when: (c) => !!c.L, run: (c) => renameActiveLayer(c.L) },
  { id: 'rename-batch', group: 'Layer', title: 'Rename layers…', kw: 'batch prefix suffix regex replace', when: () => S.layers.length >= 2, run: () => openBatchRename(_lpSel.size >= 2 ? lpSelIds().map(layerById) : S.layers.slice()) },
  { id: 'sel-column', group: 'Layer', title: 'Selection → column…', kw: 'materialize save flag 0 1 paint selected', when: (c) => !!(c.L && c.L._selCount), run: (c) => selectionToColumn(c.L) },
  { id: 'filter-sel', group: 'Layer', title: 'Filter → selection', kw: 'matches convert select expression reproducible', when: (c) => !!(c.L && c.L._filterMask), run: (c) => filterToSelection(c.L) },
  { id: 'run-recipe', group: 'Analysis', title: 'Run recipe…', kw: 'saved yaml grade-tonnage swath analysis rerun', when: () => S.recipes.length > 0, run: () => setTimeout(() => menuXY(innerWidth / 2 - 130, innerHeight / 3, recipesMenuItems()), 0) },
  { id: 'new-routine', group: 'Analysis', title: 'New routine…', kw: 'recipes sequence batch each parameter table month-end', when: () => !!S.project, run: () => openRoutineWindow(null) },
  { id: 'reload-layer', group: 'Layers', title: 'Reload active layer from disk', kw: 'refresh re-read file changed external edit', when: () => canReloadLayer(activeLayer()), run: () => reloadLayerFromDisk(activeLayer()) },
  { id: 'placement', group: 'Layers', title: 'Placement of the active layer…', kw: 'place helmert similarity shift rotate scale control points gcp mine grid local utm fit crs georeference transform move', when: () => canPlace(activeLayer()), run: () => openPlacementDialog(activeLayer()) },
  { id: 'dm-origin', group: 'Layers', title: 'Datamine origin of the active layer…', kw: 'rotated datamine dm world origin x0 y0 z0 place anonymised isatis', when: () => { const L = activeLayer(); return !!(L && L.docs && L.docs.blockDoc && L.docs.blockDoc.header.dmRotationApplied); }, run: async () => { if (await setDmOrigin(activeLayer())) markProjectDirty(); } },
  { id: 'change-file', group: 'Layers', title: 'Change file of the active layer…', kw: 'relink swap replace source new month model keep styling', when: () => canChangeFile(activeLayer()), run: () => changeLayerFile(activeLayer()) },
  { id: 'surf-extend', group: 'Layer', title: 'Extend surface to footprint…', kw: 'grow cover topo grid mesh fill trend', when: () => surfaceableLayers().length > 0, run: (cx) => openSurfaceTools('extend', cx.L) },
  { id: 'surf-combine', group: 'Layer', title: 'Combine surfaces…', kw: 'min max priority mean merge patch topo union overlap', when: () => surfaceableLayers().length >= 2, run: (cx) => openSurfaceTools('combine', cx.L) },
  'stats',
  { id: 'convert-wfr', group: 'File', title: 'Convert files to .wfr…', kw: 'wireframe mesh dxf ply obj msh lfm datamine convert pack', run: () => openWfrDialog() },
  { id: 'pack-wfr', group: 'File', title: 'Store meshes in the project as .wfr', kw: 'wireframe pack optimize meshes project compact', when: () => !!S.project && S.layers.some(packableMesh), run: async () => { const n = await packLayersToWfr(S.layers.filter(packableMesh)); $('#meta').textContent = n ? `stored ${n} layer${n === 1 ? '' : 's'} as .wfr in meshes/ — save the project to keep it` : 'nothing stored'; } },
  { id: 'export-wfr', group: 'Layer', title: 'Export as .wfr…', kw: 'wireframe mesh strings points save pack', when: () => S.layers.some(wfrExportable), run: (c) => { const sel = lpSelIds().map(layerById).filter(wfrExportable); openWfrDialog({ layers: sel.length ? sel : (wfrExportable(c.L) ? [c.L] : S.layers.filter(wfrExportable)) }); } },
  { id: 'export-mesh', group: 'Layer', title: 'Export mesh(es)…', kw: 'obj ply msh lfm wavefront leapfrog save', when: () => S.layers.some((L) => L.kind === 'mesh' && L.docs.meshDoc), run: (c) => {
    const sel = lpSelIds().map(layerById).filter((x) => x && x.kind === 'mesh' && x.docs.meshDoc);
    openMeshExportDialog(sel.length ? sel : (c.L && c.L.kind === 'mesh' ? [c.L] : S.layers.filter((L) => L.kind === 'mesh' && L.docs.meshDoc)));
  } },
  { id: 'decopanel', group: 'View', title: 'Decorations & figure…', kw: 'legend scale bar north title background export panel', run: () => openDecoPanel() },
  { id: 'decoscale', group: 'View', title: 'Toggle scale bar', kw: 'decoration ruler', run: () => setDeco('scale', !_deco.scale) },
  { id: 'deconorth', group: 'View', title: 'Toggle north arrow', kw: 'decoration compass', run: () => setDeco('north', !_deco.north) },
  { id: 'decolegend', group: 'View', title: 'Toggle legend (active layer)', kw: 'decoration ramp colours key', run: () => { const L = activeLayer(); if (L) setLayerLegend(L, !L.legend); } },
  { id: 'decotitle', group: 'View', title: 'Set figure title…', kw: 'decoration caption', run: async () => { const t = await microPrompt('figure title', _deco.titleText || ''); if (t != null) { _deco.titleText = t; _deco.title = !!t; saveDeco(); drawDecorations(); } } },
  { id: 'theme', group: 'View', title: 'Theme: switch light / dark', kw: 'light dark theme mode appearance day night bright', run: () => setTheme(resolvedTheme() === 'light' ? 'dark' : 'light') },
  { id: 'language', group: 'View', title: 'Language: English / Português', kw: 'idioma lingua portugues portuguese english ingles interface pt br', run: () => setLang(LANG === 'pt' ? 'en' : 'pt') },
  { id: 'theme-edit', group: 'View', title: 'Theme: edit a custom theme…', kw: 'custom colours colors palette accent high contrast import export theme file', run: () => openThemeEditor() },
  { id: 'theme-system', group: 'View', title: 'Theme: follow the system', kw: 'light dark theme auto os system appearance', run: () => setTheme('system') },
  { id: 'bg', group: 'View', title: 'Background colour…', kw: 'clear white black print paper', run: async () => { const v = ((await microPrompt('background (hex) — e.g. #ffffff for print', _bgColor)) || '').trim(); if (/^#?[0-9a-fA-F]{6}$/.test(v)) setBg(v.startsWith('#') ? v : '#' + v); } },
  { id: 'windows', group: 'View', title: 'Windows…', kw: 'focus find list float', when: () => document.querySelector('.fwin'), run: () => windowsMenu({ x: innerWidth / 2 - 90, y: 60 }) },
  { id: 'wincascade', group: 'View', title: 'Cascade windows', kw: 'arrange tidy tile', when: () => document.querySelector('.fwin'), run: () => cascadeWindows() },
  { id: 'winclose', group: 'View', title: 'Close all windows', kw: 'dismiss tidy', when: () => document.querySelector('.fwin'), run: () => closeAllWindows() },
  { id: 'fit', group: 'View', title: 'Fit view', kw: 'zoom extent', run: () => $('#btnFit').click() },
  { id: 'plan', group: 'View', title: 'Plan view (looking down)', kw: 'top', run: () => setView(cam.state.theta, PHI_MAX) },
  { id: 'section', group: 'View', title: 'Section on / off', kw: 'slice clip', run: () => toggleSection() },
  { id: 'along', group: 'View', title: 'Look along the section', kw: 'face on', run: () => viewAlongSection() },
  { id: 'ortho', group: 'View', title: 'Toggle orthographic', kw: 'perspective parallel', run: () => { cam.setOrtho(!cam.state.ortho); requestRender(); } },
  { id: 'panel', group: 'View', title: 'Toggle layers panel', kw: 'tree', run: () => toggleLayersPanel() },
  { id: 'selrect', group: 'Select', title: 'Select — rectangle', kw: 'box pick', run: () => armSelect('rect') },
  { id: 'sellasso', group: 'Select', title: 'Select — lasso', kw: 'freehand pick', run: () => armSelect('lasso') },
  { id: 'selthrough', group: 'Select', title: 'Toggle select-through (volume)', kw: 'occluded tube', run: () => setSelThrough(!_selThrough) },
  { id: 'selclear', group: 'Select', title: 'Clear selection', kw: 'deselect', run: () => clearSelection() },
  { id: 'solid', group: 'Select', title: 'Select by solid / surface…', kw: 'winding flag ratio fraction inside', when: () => S.layers.some((L) => L.kind === 'mesh'), run: () => openSolidDialog(null) },
  { id: 'domains', group: 'Select', title: 'Assign domains…', kw: 'coded model solids', when: () => S.layers.some((L) => L.kind === 'mesh'), run: () => openDomainsDialog() },
  'gt', 'swath', 'validate', 'contact', 'contactsurf', 'factors',
  { id: 'join', group: 'Analyse', title: 'Join / reconcile…', kw: 'merge compare delta reconciliation spatial key', when: (c) => c.L && layerTableHeader(c.L), run: (c) => { setActiveLayer(c.L.id); setPropTab('join'); openProps(); } },
  { id: 'table', group: 'Analyse', title: 'Attribute table…', kw: 'rows data grid', when: (c) => c.L && hasRecords(c.L), run: (c) => openAttrTable(c.L) },
  { id: 'filter', group: 'Analyse', title: 'Filter…', kw: 'query where expression', when: (c) => c.L && layerTableHeader(c.L), run: (c) => { setActiveLayer(c.L.id); $('#filter').focus(); } },
  { id: 'scancols', group: 'Analyse', title: 'Scan columns (stats)', kw: 'histogram quantiles mean', when: (c) => c.L && layerTableHeader(c.L), run: (c) => scanColumns(c.L).then(() => { if (_propOpen) renderProps(); }).catch((e) => { $('#meta').textContent = `scan columns: ${e.message}`; }) },
  { id: 'measure', group: 'Analyse', title: 'Measure…', kw: 'distance ruler', run: () => armMeasure() },
  { id: 'props', group: 'Layer', title: 'Properties…', kw: 'style colour clip', when: (c) => c.L, run: (c) => { setActiveLayer(c.L.id); openProps(); } },
  { id: 'lineage', group: 'Layer', title: 'Lineage…', kw: 'provenance audit report history derivation', when: (c) => c.L && c.L.lineage, run: (c) => openLineageWindow(c.L) },
  { id: 'optimize', group: 'Layer', title: 'Store as Parquet…', kw: 'optimize morton index materialize convert spatial', when: (c) => c.L && !isView(c.L) && c.L.docs.blockDoc && !c.L.docs.blockDoc.parquet, run: async (c) => { const res = await openOptimizeDialog([c.L]); if (res && res.layers.length) await convertLayerToParquet(c.L, { keepOriginal: res.keepOriginal }); } },
  { id: 'paint', group: 'Layer', title: 'Paint column…', kw: 'brush domain category', when: (c) => c.L && layerTableHeader(c.L), run: (c) => openPaintPalette(c.L) },
  { id: 'export', group: 'Layer', title: 'Export rows…', kw: 'csv parquet save out', when: (c) => c.L && layerTableHeader(c.L), run: (c) => openExportDialog(c.L) },
  { id: 'hide', group: 'Layer', title: 'Hide / show layer', kw: 'visible toggle', when: (c) => c.L, run: (c) => showNode(c.L.id, !c.L.visible) },
  { id: 'remove', group: 'Layer', title: 'Remove layer', kw: 'delete close', when: (c) => c.L, run: (c) => confirmRemoveLayer(c.L.id) },
  { id: 'settings', group: 'Tools', title: 'Settings…', kw: 'preferences options prefs background budget selection compute', run: () => openSettingsWindow() },
  { id: 'memory', group: 'Tools', title: 'Memory…', kw: 'vram usage ram', run: () => showMemoryInfo() },
  'sealed', 'update', 'helpwork', 'helptouch', 'helpkeys',
  // ── the menus' verbs, mirrored — test/micro-palette.test.mjs fails when a menu label has no command here ──
  { id: 'proj-open', group: 'File', title: 'Open project folder…', kw: 'project folder directory load open existing', when: () => S.hasFSAA, run: () => openProjectPicker() },
  { id: 'save-as', group: 'File', title: 'Save project as…', kw: 'store new folder copy duplicate elsewhere', when: () => S.hasFSAA && !(S.project && S.project.pack), run: () => saveProjectAs() },
  { id: 'fileinfo', group: 'File', title: 'File info…', kw: 'header format size columns rows bbox extent crs details metadata', when: (c) => !!c.L, run: () => showFileInfo() },
  { id: 'recents-clear', group: 'File', title: 'Clear recents', kw: 'recent files history forget list', when: () => _remember && _recents.length > 0, run: () => clearRecents() },
  { id: 'import-dh', group: 'File', title: 'Import drillholes…', kw: 'drillhole collar survey assay interval lithology desurvey holes boreholes trio', run: () => openDhDialog(null) },
  { id: 'source', group: 'Layer', title: 'Source (mapping / desurvey)…', kw: 'mapping columns coordinates x y z roles header desurvey reread', when: () => S.layers.length > 0, run: () => openPropsTab('source') },
  { id: 'calc', group: 'Layer', title: 'Calculated columns…', kw: 'calc expression formula derived new column f fx compute', when: (c) => !!(c.L && layerTableHeader(c.L)), run: (c) => openCalcWindow(c.L) },
  { id: 'filter-clear', group: 'Analyse', title: 'Clear filter', kw: 'reset remove query expression show all', when: () => !!$('#filter').value, run: () => clearFilter() },
  { id: 'zoom-layer', group: 'View', title: 'Zoom to layer', kw: 'fit extent frame focus centre center', when: (c) => !!(c.L && c.L.kind !== 'table'), run: (c) => fitLayer(c.L) },
  { id: 'look-n', group: 'View', title: 'Look north', kw: 'view direction camera facing azimuth', run: () => setView(-Math.PI / 2, 0) },
  { id: 'look-s', group: 'View', title: 'Look south', kw: 'view direction camera facing azimuth', run: () => setView(Math.PI / 2, 0) },
  { id: 'look-e', group: 'View', title: 'Look east', kw: 'view direction camera facing azimuth', run: () => setView(Math.PI, 0) },
  { id: 'look-w', group: 'View', title: 'Look west', kw: 'view direction camera facing azimuth', run: () => setView(0, 0) },
  { id: 'look-up', group: 'View', title: 'From below (looking up)', kw: 'underneath bottom view camera upward', run: () => setView(cam.state.theta, -PHI_MAX) },
  { id: 'sec-back', group: 'View', title: 'Scrub section back', kw: 'step previous slice bench move section', when: () => !!currentSection(), run: () => scrubSection(-1) },
  { id: 'sec-fwd', group: 'View', title: 'Scrub section forward', kw: 'step next slice bench move section', when: () => !!currentSection(), run: () => scrubSection(1) },
  { id: 'compass', group: 'View', title: 'Compass…', kw: 'north arrow corner position size overlay', run: () => { const r = $('#compass').getBoundingClientRect(); compassMenu(r.left - 40, r.top - 8); } },
  { id: 'bm-save', group: 'View', title: 'Save bookmark…', kw: 'viewpoint camera position remember store view', run: () => saveViewAs() },
  { id: 'bm-go', group: 'View', title: 'Go to bookmark…', kw: 'viewpoint camera recall apply saved view jump', when: () => S.views.length > 0, run: () => setTimeout(() => menuXY(innerWidth / 2 - 130, innerHeight / 3, bookmarksMenuItems()), 0) },
  { id: 'scene-save', group: 'View', title: 'Save scene…', kw: 'state visibility colours filter remember store snapshot', run: () => saveSceneAs(false) },
  { id: 'scene-save-sel', group: 'View', title: 'Save scene (with selection)…', kw: 'state visibility colours filter selected remember store snapshot', when: () => S.layers.some((L) => L._selMask && L._selCount), run: () => saveSceneAs(true) },
  { id: 'scene-go', group: 'View', title: 'Apply scene…', kw: 'state recall restore saved scene visibility colours', when: () => S.scenes.length > 0, run: () => setTimeout(() => menuXY(innerWidth / 2 - 130, innerHeight / 3, scenesMenuItems()), 0) },
  { id: 'reinterpret', group: 'Layer', title: 'Reinterpret as…', kw: 'open as points blocks mesh surface grid reopen kind type', when: (c) => !!(c.L && !isView(c.L) && reinterpretOptions(c.L).length), run: (c) => setTimeout(() => reinterpretMenu(c.L, innerWidth / 2 - 130, innerHeight / 3), 0) },
  { id: 'group-move', group: 'Layer', title: 'New group / move layer to group…', kw: 'folder group organize tree into move root leave', when: (c) => !!c.L, run: (c) => setTimeout(() => moveLayerToGroupMenu(c.L, innerWidth / 2 - 130, innerHeight / 3), 0) },
  { id: 'explode', group: 'Layer', title: 'Explode…', kw: 'group spread apart offset separate displace exploded view', when: (c) => { const g = c.L && groupAt(groupPathOf(c.L.id)); return !!(g && groupLayerIds(g).length >= 2); }, run: (c) => openExplode(groupAt(groupPathOf(c.L.id))) },
  { id: 'tint', group: 'Layer', title: 'Tint…', kw: 'mesh colour color wireframe solid surface shade', when: (c) => !!(c.L && c.L.kind === 'mesh'), run: (c) => setTimeout(() => meshTintMenu(c.L, innerWidth / 2 - 130, innerHeight / 3), 0) },
  { id: 'build-index', group: 'Layer', title: 'Build index (stats + pushdown)…', kw: 'index stats band sidecar pushdown faster filter scan', when: (c) => !!(c.L && c.L.docs.blockDoc && !isView(c.L)), run: (c) => buildLayerIndex(c.L) },
  { id: 'rasterize', group: 'Layer', title: 'Rasterize to grid…', kw: 'mesh surface to grid dem raster heightfield topo convert', when: (c) => !!(c.L && c.L.kind === 'mesh' && c.L.docs.meshDoc && c.L.docs.meshDoc.header && !c.L.docs.meshDoc.header.soup), run: (c) => openMeshGridDialog(c.L) },
  { id: 'export-grid', group: 'Layer', title: 'Export grid…', kw: 'asc arcgis esri surfer grd geotiff tif flt hdr xyz csv nodes raster grid save dem export', when: (c) => !!(c.L && c.L.docs.gridDoc), run: (c) => openGridExportDialog(c.L) },
  { id: 'disp-cache', group: 'Layer', title: 'Build display cache', kw: 'geotiff tif overview fast reopen grd sidecar preview', when: (c) => canBuildDisplayCache(c.L), run: (c) => buildDisplayCache(c.L) },
  'dh-filter', 'dh-interval', 'dh-redesurvey', 'dh-traces', 'dh-collars', 'dh-broadcast',
  { id: 'recipe-new', group: 'Analysis', title: 'New recipe…', kw: 'recipe yaml analysis save create automate', when: () => !!S.project, run: () => openRecipeForm() },
  { id: 'library', group: 'Analysis', title: 'Library…', kw: 'recipes routines library shared without project import export', run: () => openLibraryWindow() },
  { id: 'runs', group: 'Analysis', title: 'Runs…', kw: 'routine runs history record past results tracker', when: () => !!S.project, run: () => openRunsWindow() },
  { id: 'recipes-check', group: 'Analysis', title: 'Check all recipes…', kw: 'validate recipes routines verify broken columns layers', when: () => !!S.project && S.recipes.length > 0, run: () => openCheckAllRecipes() },
  'about', 'docs', 'card',
], { order: true });
