// micro menubar — the File / View / Data / Tools / Help menus and the burger, plus the small
// menus they share with the palette (bookmarks, scenes, windows). Every verb here also has a
// palette command (test/micro-palette.test.mjs). A feature adds rows with contributeMenu
// (src/commands.js). Carved from index.html (2026-11-24).
import { trusted } from './html.js';
import { PHI_MAX, setZExag } from './camera.js';
import { PROJ_NAME, projectionMenuItems } from './projection.js';
import { S, requestRender, activeLayer } from './state.js';
import { hasRecords } from './records.js';
import { pinStats, pinBudgetBytes, setPinBudget } from './columns.js';
import { fmtSize } from './paths.js';
import { syncFilterClear, applyBlockFilter } from './filter.js';
import { _isMobile, raiseWindow } from './windows.js';
import { openSectionSeries } from './section-series.js';
import { recipesMenuItems } from './recipes.js';
import { setPropTab, openProps } from './props.js';
import { newProject, openProjectPicker, saveProject, saveProjectAs, closeProject } from './project.js';
import { scanFolderForNewData, tidyProject } from './project-folder.js';
import { _autoOptimize, setAutoOptimize, _autoPack, setAutoPack } from './optimize.js';
import { openProjectPack, backupProject, restoreProject } from './project-pack.js';
import { openDhDialog } from './open-dialog.js';
import { openDecoPanel } from './deco.js';
import { toggleLayersPanel } from './layers-panel.js';
import { applyView, saveViewAs, removeBookmark, applyScene, saveSceneAs, removeScene } from './views.js';
import { armMeasure, _measureTP, toggleMeasureTP } from './overlay.js';
import { microConfirm } from './prompts.js';
import { menuAt, menuXY } from './menu.js';
import { openWfrDialog } from './meshexport.js';
import { openNewDialog } from './gridtools.js';
import { openExportDialog } from './export-dialog.js';
import { openSolidDialog, openDomainsDialog } from './bygeom-ui.js';
import { showHelp, HELP_TOUCH, HELP_KEYS, HELP_ANALYSIS, sealedInfo, checkForUpdates, showAbout } from './help.js';
import { openCalcWindow } from './calc.js';
import { showFileInfo, showMemoryInfo } from './fileinfo.js';
import { openSettingsWindow } from './settings.js';
import { THEME_PREFS, _themePref, setTheme, customTheme } from './theme.js';
import { openThemeEditor } from './theme-editor.js';
import { openTurntable } from './turntable.js';
import { openComposer, refreshAllFigures } from './composer.js';
import { openFilePicker, _remember, _recents, openRecent, clearRecents, setRemember } from './recents.js';
import { openAttrTable } from './attrtable.js';
import { armSelect, _selThrough, setSelThrough, clearSelection } from './selection.js';
import { openPaintPalette } from './paint.js';
import { toggleSection, viewAlongSection, scrubSection } from './section.js';
import { setView, cam, _viewMode, setViewMode, _blockEdges, setBlockEdges } from './viewport.js';
import { compassMenu } from './compass.js';
import { openSample } from './samples.js';
import { menuContributions } from './commands.js';

const $ = (s) => document.querySelector(s);

$('#mFile').onclick = () => {
  const items = [
    { label: 'New project…', action: newProject },
    { label: 'Open…', kbd: '', action: openFilePicker },
    { label: 'File info…', kbd: 'i', action: showFileInfo },
    { label: 'Convert to .wfr…', action: () => openWfrDialog() },
  ];
  items.push({ sep: true });
  const isPack = !!(S.project && S.project.pack);
  if (S.hasFSAA) items.push({ label: 'Open project folder…', action: openProjectPicker });
  items.push({ label: 'Open project pack…', action: () => openProjectPack() });
  if (S.hasFSAA) {
    items.push(
      { label: isPack ? 'Save as a project folder…' : S.project ? `Save project${S.project.dirty ? ' •' : ''}` : 'Save project', kbd: 'Ctrl+S', action: saveProject },
      ...(isPack ? [] : [{ label: 'Save project as…', action: saveProjectAs },
        { label: 'Scan folder for new data…', action: scanFolderForNewData },
        { label: 'Tidy project folder…', action: tidyProject }]));
  }
  if (S.project) items.push({ label: 'Back up project…', action: () => backupProject() });
  if (S.hasFSAA) items.push({ label: 'Restore project from backup…', action: () => restoreProject() });
  if (S.project) items.push({ label: `Close project (${S.project.name})`, action: async () => { if (S.project.dirty && !(await microConfirm('close project', `“${S.project.name}” has unsaved changes — close it anyway? The layers stay open; the files on disk are untouched.`, 'Close'))) return; closeProject(); } });
  if (_remember && _recents.length) {
    items.push({ sep: true });
    for (const e of _recents.slice(0, 10)) items.push({ label: (e.handle ? '' : '↻ ') + e.name, action: () => openRecent(e) });
    items.push({ label: 'Clear recents', action: clearRecents });
  }
  items.push(
    { sep: true },
    { label: (_remember ? '✓ ' : '') + 'Remember recent files', action: () => setRemember(!_remember) },
    { sep: true },
    { label: 'Sample data', submenu: [
      { label: 'Bench scan — 2M points', action: () => openSample(2_000_000) },
      { label: 'Bench scan — 10M points', action: () => openSample(10_000_000) },
      { label: 'Bench scan — 50M points', action: () => openSample(50_000_000) },
      { label: 'Block model — 2M', action: () => $('#sampleBlocks').onclick() },
    ] },
    { sep: true },
    { label: 'Composer…', action: () => openComposer() },
    ...(S.figures.length ? [{ label: 'Figures', submenu: () => [
      ...S.figures.map((f) => ({ label: f.name + (f.doc.template ? '  ★' : ''), action: () => openComposer(f.name) })),
      { sep: true },
      { label: 'Refresh all figures', action: () => refreshAllFigures() },
    ] }] : []),
    { label: 'Save viewport PNG', action: () => $('#btnShot').click() },
  );
  items.push(...menuContributions('file'));
  menuAt($('#mFile'), items);
};
$('#btnBurger').onclick = () => menuAt($('#btnBurger'), [
  { label: 'File', action: () => setTimeout(() => $('#mFile').click(), 0) },
  { label: 'Data', action: () => setTimeout(() => $('#mData').click(), 0) },
  { label: 'Tools', action: () => setTimeout(() => $('#mTools').click(), 0) },
  { label: 'View', action: () => setTimeout(() => $('#mView').click(), 0) },
  { label: 'Help', action: () => setTimeout(() => $('#mHelp').click(), 0) },
  { sep: true },
  { label: 'Layers panel', action: () => toggleLayersPanel() },
]);
$('#mView').onclick = () => menuAt($('#mView'), [
  { label: 'Fit', kbd: 'f', action: () => $('#btnFit').click() },
  { sep: true },
  { label: 'Look north', kbd: 'n', action: () => setView(-Math.PI / 2, 0) },
  { label: 'Look south', kbd: 's', action: () => setView(Math.PI / 2, 0) },
  { label: 'Look east', kbd: 'e', action: () => setView(Math.PI, 0) },
  { label: 'Look west', kbd: 'w', action: () => setView(0, 0) },
  { label: 'Plan (down)', kbd: 'd', action: () => setView(cam.state.theta, PHI_MAX) },
  { label: 'From below', kbd: 'u', action: () => setView(cam.state.theta, -PHI_MAX) },
  { sep: true },
  { label: (cam.state.ortho ? '' : '✓ ') + 'Perspective', kbd: 'o', action: () => { cam.setOrtho(false); requestRender(); } },
  { label: (cam.state.ortho ? '✓ ' : '') + 'Orthographic', kbd: 'o', action: () => { cam.setOrtho(true); requestRender(); } },
  { sep: true },
  { label: (_viewMode === 'boxes' ? '✓ ' : '') + 'Blocks as boxes', action: () => setViewMode('boxes') },
  { label: (_viewMode === 'points' ? '✓ ' : '') + 'Blocks as points', action: () => setViewMode('points') },
  { label: (_blockEdges ? '✓ ' : '') + 'Block edges', kbd: '⇧B', action: () => setBlockEdges(!_blockEdges) },
  { label: `Projection: ${S.projection ? S.projection + ' (' + PROJ_NAME[S.projection] + ')' : 'off'}`, submenu: () => projectionMenuItems() },
  { label: `Point budget: ${$('#budget').selectedOptions[0].textContent}`, submenu: () => [...$('#budget').options].map((o) => ({
    label: (o.selected ? '✓ ' : '') + o.textContent,
    action: () => { const b2 = $('#budget'); b2.value = o.value; b2.dispatchEvent(new Event('input')); b2.dispatchEvent(new Event('change')); },
  })) },
  { sep: true },
  { label: 'Layers panel', kbd: 'p', action: () => toggleLayersPanel() },
  { label: 'Compass…', action: () => { const r = $('#compass').getBoundingClientRect(); compassMenu(r.left - 40, r.top - 8); } },
  { label: 'Vertical exaggeration', submenu: () => [1, 2, 3, 5, 10, 20].map((s) => ({ label: (cam.state.zExag === s ? '✓ ' : '') + (s === 1 ? 'off (1×)' : s + '×'), action: () => setZExag(s) })) },
  { label: 'Filter column cache', submenu: () => {
    let cur = 'auto'; try { cur = localStorage.getItem('micro.pinBudget') || 'auto'; } catch { /* private */ }
    const st = pinStats();
    return [
      ...[['off', 'off (always re-scan)'], ['auto', `auto (${(pinBudgetBytes() / 1048576) | 0} MB)`], ['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB']]
        .map(([v, lab]) => ({ label: (cur === v ? '✓ ' : '') + lab, action: () => { setPinBudget(v); $('#meta').textContent = `filter column cache: ${v === 'off' ? 'off' : v === 'auto' ? 'auto' : v + ' MB'} · ${fmtSize(pinStats().bytes)} pinned`; } })),
      { label: `— ${fmtSize(st.bytes)} pinned · ${st.cols} column${st.cols === 1 ? '' : 's'}`, action: () => {} },
    ];
  } },
  { label: 'Decorations & figure…', action: () => openDecoPanel() },
  { label: 'Turntable video…', action: () => openTurntable() },
  { label: 'Section series…', action: () => openSectionSeries() },
  { label: 'Theme', submenu: () => [...THEME_PREFS().map(([v, lab]) => ({ label: (_themePref === v ? '✓ ' : '') + lab, action: () => (v === 'custom-new' ? openThemeEditor() : setTheme(v)) })), ...(customTheme() ? [{ sep: true }, { label: 'Edit custom theme…', action: () => openThemeEditor() }] : [])] },
  { label: 'Windows…', action: () => windowsMenu($('#mView')) },
  { sep: true },
  { label: 'Bookmarks', submenu: () => bookmarksMenuItems() },
  { label: 'Scenes', submenu: () => scenesMenuItems() },
  ...menuContributions('view'),
]);
// bookmarks = viewpoints (camera + section); the g-leader jumps: g·digit recalls a slot, g·Shift+digit saves one
export function bookmarksMenuItems() {
  const items = S.views.map((v, i) => ({ label: `⤷ ${v.name}`, kbd: i < 9 ? String(i + 1) : undefined, action: () => applyView(v) }));
  if (items.length) items.push({ sep: true });
  items.push({ label: 'Save bookmark…', action: saveViewAs });
  if (S.views.length) items.push({ label: 'Remove bookmark', submenu: () => S.views.map((v) => ({ label: v.name, action: () => removeBookmark(v) })) });
  return items;
}
// scenes = full working state (visibility + colour + filter, + optional selection)
export function scenesMenuItems() {
  const items = S.scenes.map((s) => ({ label: `◆ ${s.name}`, action: () => applyScene(s) }));
  if (items.length) items.push({ sep: true });
  items.push({ label: 'Save scene…', action: () => saveSceneAs(false) });
  if (S.layers.some((L) => L._selMask && L._selCount)) items.push({ label: 'Save scene (with selection)…', action: () => saveSceneAs(true) });
  if (S.scenes.length) items.push({ label: 'Remove scene', submenu: () => S.scenes.map((s) => ({ label: s.name, action: () => removeScene(s) })) });
  return items;
}
// Data = the dataset's interpretation + derived state (lamina's grammar:
// intake wizards, the properties panel's deep tabs, filter state)
export function clearFilter() { $('#filter').value = ''; syncFilterClear(); applyBlockFilter(''); }
export const openPropsTab = (tab) => {
  if (!S.layers.length) return;
  setPropTab(tab);
  openProps();
};
$('#mData').onclick = () => menuAt($('#mData'), [
  { label: 'Import drillholes…', action: () => openDhDialog(null) },
  { label: 'New grid / block model…', action: () => openNewDialog() },
  { sep: true },
  { label: 'Layer properties…', action: () => { if (S.layers.length) openProps(); } },
  { label: 'Source (mapping / desurvey)…', action: () => openPropsTab('source') },
  { label: 'Calculated columns…', action: () => openCalcWindow(activeLayer()) },
  { label: 'Scan columns', action: () => {
    openPropsTab('columns');
    const b = [...document.querySelectorAll('.pp-scan')].find((el) => /scan/.test(el.textContent));
    if (b) b.click();
  } },
  { sep: true },
  { label: 'Attribute table', kbd: 't', action: () => { const L = activeLayer(); if (L && hasRecords(L)) openAttrTable(L); } },
  { label: 'Paint to column…', kbd: 'b', action: () => { const L = activeLayer(); if (L) openPaintPalette(L); } },
  { sep: true },
  { label: 'Filter…', kbd: '/', action: () => $('#filter').focus() },
  { label: 'Clear filter', action: () => clearFilter() },
  { sep: true },
  { label: 'Export rows…', action: () => openExportDialog(activeLayer()) },
  ...menuContributions('data'),
]);

$('#mTools').onclick = () => menuAt($('#mTools'), [
  { label: 'Measure…', kbd: 'm', action: armMeasure },
  { label: (_measureTP ? '✓ ' : '') + 'Measure trend & plunge', action: toggleMeasureTP },
  { sep: true },
  { label: 'Select — rectangle', kbd: 'r', action: () => armSelect('rect') },
  { label: 'Select — lasso', kbd: 'v', action: () => armSelect('lasso') },
  { label: (_selThrough ? '✓ ' : '') + 'Select through (volume)', action: () => setSelThrough(!_selThrough) },
  { label: 'Select by solid / surface…', action: () => openSolidDialog(null) },
  { label: 'Assign domains…', action: () => openDomainsDialog() },
  { label: 'Clear selection', kbd: 'Esc', action: () => clearSelection() },
  { sep: true },
  { label: 'Recipes', submenu: () => recipesMenuItems() },
  { sep: true },
  { label: 'Section on/off', kbd: 'x', action: toggleSection },
  { label: 'Along the section', kbd: 'l', action: viewAlongSection },
  { label: 'Scrub section back', kbd: ',', action: () => scrubSection(-1) },
  { label: 'Scrub section forward', kbd: '.', action: () => scrubSection(1) },
  { sep: true },
  { label: (_autoOptimize === 'on' ? '✓ ' : '') + 'Auto-optimize block models to spatial Parquet on save', action: () => setAutoOptimize(_autoOptimize === 'on' ? 'off' : 'on') },
  { label: (_autoPack === 'on' ? '✓ ' : '') + 'Store meshes as .wfr on save', action: () => setAutoPack(_autoPack === 'on' ? 'off' : 'on') },
  { label: 'Settings…', action: openSettingsWindow },
  { label: 'Memory…', action: showMemoryInfo },
  ...menuContributions('tools'),
]);

$('#mHelp').onclick = () => menuAt($('#mHelp'), [
  ...(_isMobile() ? [{ label: 'Touch…', action: () => showHelp('touch', trusted(HELP_TOUCH)) }] : []),   // a phone first: no keys to speak of
  { label: 'Keyboard & mouse…', action: () => showHelp('keyboard & mouse', trusted(HELP_KEYS)) },
  { label: 'Analysis & workbench…', action: () => showHelp('analysis & workbench', trusted(HELP_ANALYSIS)) },
  { label: 'Full documentation ↗', action: () => window.open('https://gentropic.org/micro/docs/', '_blank', 'noopener') },
  ...(_isMobile() ? [] : [{ label: 'Shortcut card (print) ↗', action: () => window.open('https://gentropic.org/micro/docs/card.html', '_blank', 'noopener') }]),
  { label: 'Why it’s Sealed (security)…', action: () => sealedInfo() },
  { label: 'Check for updates…', action: () => checkForUpdates() },
  { label: 'About micro', action: () => showAbout() },
  ...menuContributions('help'),
]);
// ── window management: as the float windows multiply (GT · swath · validate ·
// lineage · table · paint), a place to find, focus, tidy, and dismiss them. ──
const openFloatWins = () => [...document.querySelectorAll('.fwin')];
const winTitle = (el) => { const t = el.querySelector('.fwin-head .t'); return t ? t.textContent : 'window'; };

export function cascadeWindows() {
  const ws = openFloatWins(); if (!ws.length) { $('#meta').textContent = 'no open windows'; return; }
  ws.forEach((el, i) => { el.style.left = (44 + i * 30) + 'px'; el.style.top = (74 + i * 30) + 'px'; raiseWindow(el); });
  $('#meta').textContent = `cascaded ${ws.length} window${ws.length > 1 ? 's' : ''}`;
}
export function closeAllWindows() {
  const ws = openFloatWins();
  for (const el of ws) { const bts = el.querySelectorAll('.fwin-head button'); if (bts.length) bts[bts.length - 1].click(); }
  $('#meta').textContent = ws.length ? `closed ${ws.length} window${ws.length > 1 ? 's' : ''}` : 'no open windows';
}
export function windowsMenu(anchor) {
  const r = (anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x || 120, bottom: anchor.y || 60 });
  const ws = openFloatWins();
  const items = ws.length
    ? ws.map((el) => ({ label: (el._chip ? '– ' : '') + winTitle(el), action: () => raiseWindow(el) }))
    : [{ label: 'no open windows', action: () => {} }];
  if (ws.length) items.push({ sep: true }, { label: 'Cascade', action: cascadeWindows }, { label: 'Close all', action: closeAllWindows });
  menuXY(r.left, r.bottom + 2, items);
}
