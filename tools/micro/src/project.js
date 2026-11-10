// micro — the PROJECT lifecycle: a project is a folder (or a pack) of readable files plus
// project.json. Save writes the manifest and copies sources in; open restores every layer
// from it; tidy and scan-for-new-data keep the folder in its by-kind layout; backup and
// restore move a whole project as one file. The app still owns the selection and the
// section, and hands those in as hooks.
import { S, _fileHandles, activeLayer, layerById, requestRender } from './state.js';
import { applyColTypes, attrRowCountOf, layerBlob, layerHeaderOf, layerTableHeader } from './records.js';
import { basename, fmtSize, joinPath, kindDir, layerBytes, layerFiles, layerRelpath, relPathFor, removeFileAt, resolveDhFile, resolveFileHandle } from './paths.js';
import { convertLayerToParquet } from './export.js';
import { isWfrName } from './wfr-io.js';
import { baseName as wfrBase, handleSink, packLayers } from './wfr-write.js';
import { microModelOf, mkLineage } from './lineage.js';
import { _qualifyReopen, addPaintColorOptions, applyCatLegend, applyRamp, restoreHiddenCats, ruleModeOf, runRules, settleQualifyReopens, syncRuleMode } from './props.js';
import { setColOf, structureAfterEdit } from './structure-ui.js';
import { colStatsComplete, ensureSourceHash, isStoredCat, paintRecount, scanColumns } from './columns.js';
import { _idb, loadElement, persistElement } from './element-store.js';
import { buildDhSetManifest, descFromElement, dhElementName } from './manifest.js';
import { sidecarMatches, sourceHash } from './identity.js';
import { zonesToJSON } from '../../../ext/condenser/src/main.js';
import { readSurferGrd } from './grid-io.js';
import { loadRecipes } from './recipes.js';
import { openGradeTonnage } from './gt.js';
import { openSwath } from './swath.js';
import { openStats } from './stats.js';
import { openCrosstab } from './xtab.js';
import { openXyPlot } from './xyplot.js';
import { BACKUP_EXT, BACKUP_MIME, inventoryProject, openPack, readBackup, restoreBackup, writeBackup, writeTree } from './backup.js';
import { shell } from '../../../ext/leadacid/index.js';
import { menuXY } from './menu.js';
import { microChoose, microConfirm } from './prompts.js';
import { CONTEXT_TRI_CAP, openBlob, openDrillholeLayer, openWfrFile, reopenBlockChan } from './open.js';
import { applyHoleFilter, ensureDhSetGroups } from './drillholes.js';
import { applyTreeVisibility, createLayerGroup, renderLayers, treeFromManifest, treeToManifest } from './tree.js';
import { captureLayerSurface, recolorSurface } from './surfaces.js';
import { dhGroupName, openFilesDialog } from './open-dialog.js';
import { ensureValueTex, valueTexEligible } from './color.js';
import { flushViewsScenes, loadViewsScenes } from './views.js';
import { wfrExportable, writeGridDisplayCache } from './meshexport.js';
import { deliverBlob, pickDirectory, rehydrateHandle } from './hostio.js';
import { refilterLayer } from './filter.js';
import { closeAllLayers, recomputeUnion } from './layers.js';
const $ = (s) => document.querySelector(s);
import { applyCamera, captureCamera } from './camera.js';
// the app's side, passed in once (setProjectHooks): applyLayerSelection, applySection, captureSection
let H = {};
export function setProjectHooks(h) { H = h; }

export const PROJECTS_KEY = '__projects__';

export function markProjectDirty() {
  if (S.project && !S.project.dirty) { S.project.dirty = true; updateProjectTitle(); }
}

// "Parquet is the project store": on save, non-Parquet block models get
// reordered to Morton-sorted spatial Parquet (the same in-place op as the
// layer-menu "Optimize to spatial Parquet"), behind a one-time remembered
// confirm. Painting stays editable. The manual menu action is the per-layer
// escape hatch; the remembered choice is resettable from Tools → Settings.
export let _autoOptimize = (() => { try { return localStorage.getItem('micro.autoOptimize'); } catch { return null; } })();   // 'on' | 'off' | null (unasked)

export function setAutoOptimize(v) { _autoOptimize = v; try { if (v == null) localStorage.removeItem('micro.autoOptimize'); else localStorage.setItem('micro.autoOptimize', v); } catch { /* private mode */ } }   // null = ask again

export let _autoOptimizeSkip = false;

// auto-optimize-on-save leaves models above this for an EXPLICIT conversion
// (the layer menu): the external sort has no memory ceiling, but rewriting a
// multi-GB file in the middle of a save is a surprise nobody wants.
export const OPTIMIZE_MAX_BLOCKS = 8_000_000;

// the EXPLICIT conversion dialog (less magic): per-layer rows naming the path
// it will take (Morton-sorted vs streamed file-order), a VISIBLE keep-original
// choice (orphan removal used to be silent), and the auto-on-save preference
// set where its meaning is in front of you. Resolves { layers, keepOriginal,
// auto } or null (Not now / ×).
export function openOptimizeDialog(cands, { fromSave = false } = {}) {
  return new Promise((resolve) => {
    const body = $('#opDlgBody'); body.textContent = '';
    const rows = cands.map((L) => {
      const h = layerTableHeader(L), big = h.count > OPTIMIZE_MAX_BLOCKS;
      const row = document.createElement('div'); row.className = 'op-row';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = L.label || L.name;
      const d = document.createElement('span'); d.className = 'd'; d.textContent = `${fmtSize(layerBlob(L) ? layerBlob(L).size : 0)} · ${h.count.toLocaleString()} blocks`;
      const path = document.createElement('span'); path.className = 'path'; path.textContent = '→ Morton-sorted (spatial index)';
      path.title = `reordered on the Morton curve — the footer becomes a 3D spatial index${big ? '. A big model: sorted externally in bounded memory, which takes a while' : ''}`;
      row.append(cb, nm, d, path); body.append(row);
      return { L, cb };
    });
    const opts = document.createElement('div'); opts.className = 'op-opts';
    const mkOpt = (label, checked, title) => { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked; if (title) l.title = title; l.append(c, document.createTextNode(label)); opts.append(l); return c; };
    const keepC = mkOpt('keep the original file in the project (otherwise it is removed after the parquet saves)', false);
    const autoC = fromSave ? mkOpt('do this automatically on every save (models under 8M blocks)', _autoOptimize === 'on') : null;
    body.append(opts);
    const note = document.createElement('div'); note.className = 'op-note';
    note.textContent = 'What happens: the layer swaps to the parquet in place — painting stays editable, filters re-apply, lineage records the conversion. The parquet self-describes (grid, categories, frame) and its footer is the query index.';
    body.append(note);
    const done = (res) => { $('#opDlg').classList.remove('show'); $('#opGo').onclick = $('#opNot').onclick = $('#opCancel').onclick = null; resolve(res); };
    $('#opGo').onclick = () => done({ layers: rows.filter((r) => r.cb.checked).map((r) => r.L), keepOriginal: keepC.checked, auto: autoC ? autoC.checked : null });
    $('#opNot').onclick = () => done(null);
    $('#opCancel').onclick = () => done(null);
    $('#opDlgMsg').textContent = fromSave ? 'asked once — the checkbox below makes it standing' : '';
    $('#opDlg').classList.add('show');
  });
}

export async function maybeAutoOptimize() {
  let cands = S.layers.filter((L) => L.docs.blockDoc && !L.docs.blockDoc.parquet && layerTableHeader(L) && (layerTableHeader(L).mapping || {}).x != null);
  const big = cands.filter((L) => layerTableHeader(L).count > OPTIMIZE_MAX_BLOCKS);
  if (big.length) { $('#meta').textContent = `optimize: ${big.map((L) => L.label || L.name).join(', ')} over ${(OPTIMIZE_MAX_BLOCKS / 1e6)}M blocks — kept as-is (convert explicitly via the layer menu: it sorts in bounded memory, but takes a while)`; cands = cands.filter((L) => !big.includes(L)); }
  if (!cands.length) return;
  let choice = _autoOptimize, picked = cands, keepOriginal = false;
  if (choice == null) {
    if (_autoOptimizeSkip) return;
    const res = await openOptimizeDialog(cands, { fromSave: true });
    if (!res) { _autoOptimizeSkip = true; return; }           // Not now / ×: ask again next session, not never (Settings has never)
    if (res.auto) setAutoOptimize('on');                    // unticked: converted this once; a NEW model still asks
    picked = res.layers; keepOriginal = res.keepOriginal;
    if (!picked.length) return;
  } else if (choice !== 'on') return;
  for (const L of picked) { $('#meta').textContent = `optimizing ${L.name}…`; try { await convertLayerToParquet(L, { keepOriginal }); } catch (e) { $('#meta').textContent = `optimize ${L.name}: ${e.message}`; } }
}

// ── meshes are .wfr in a project — the mesh twin of "Parquet is the project store" ──
// On save, mesh / strings / pegs layers whose source isn't already a .wfr are packed into
// meshes/<source>.wfr (one file per SOURCE: a DXF's surface, strings and pegs share one) and
// re-open in place from their element — same layer id, label, tint, visibility, legend; lineage
// records the store. Asked once (remembered); Tools → Settings changes it. Source files already in
// the project are KEPT: packing never deletes data on its own (Tidy is the explicit verb).
export let _autoPack = (() => { try { return localStorage.getItem('micro.autoPackMeshes'); } catch { return null; } })();   // 'on' | 'off' | null

export function setAutoPack(v) { _autoPack = v; try { if (v == null) localStorage.removeItem('micro.autoPackMeshes'); else localStorage.setItem('micro.autoPackMeshes', v); } catch { /* private mode */ } }   // null = ask again

export let _autoPackSkip = false;

export const packableMesh = (L) => wfrExportable(L) && !L.gridSurface && !isWfrName(L.name) && layerFiles(L).some((fd) => fd.blob);

export async function packLayersToWfr(Ls) {
  if (!S.project || !Ls.length) return 0;
  const dir = S.project.dir, mdir = await dir.getDirectoryHandle('meshes', { create: true });
  const exists = async (n) => { try { await mdir.getFileHandle(n); return true; } catch { return false; } };
  const groups = new Map();                                   // one .wfr per source blob
  for (const L of Ls) { const b = layerFiles(L).map((fd) => fd.blob).find(Boolean); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(L); }
  let packed = 0;
  for (const members of groups.values()) {
    const base = wfrBase(members[0].name);
    let fname = `${base}.wfr`;
    for (let i = 2; await exists(fname); i++) fname = `${base}-${i}.wfr`;
    const fh = await mdir.getFileHandle(fname, { create: true });
    const sink = await handleSink(fh);
    let res;
    try {
      res = await packLayers({ sink, layers: members, onProgress: (p) => { $('#meta').textContent = p.phase === 'reading' ? `storing ${p.source} as .wfr${p.total ? ` — ${Math.round(100 * p.bytes / p.total)}%` : '…'}` : `storing ${fname} — writing…`; } });
      await sink.close();
    } catch (e) {
      await sink.abort(); await mdir.removeEntry(fname).catch(() => {});
      $('#meta').textContent = `store as .wfr: ${members.map((L) => L.label || L.name).join(', ')} — ${e.message}`;
      continue;
    }
    const file = await fh.getFile();
    _fileHandles.set(file, fh);
    for (const L of members) {
      const els = res.elementsOf.get(L);
      if (!els || els.length !== 1) continue;                 // a source that split into several elements stays as it was
      const keep = { label: L.label, visible: L.visible, tint: L.tint, opacity: L.opacity, catLegend: L.catLegend, lineage: L.lineage, sectioned: S.renderer.layerSectioned(L.id) };
      S.renderer.removeLayer(L.id);
      L.docs = {};
      L.name = fname; L.handle = fh; L.storage = 'project';
      await openWfrFile(file, fname, { layer: L.id, first: false, element: els[0], tint: keep.tint, opacity: keep.opacity });
      if (keep.label) L.label = keep.label;
      L.lineage = mkLineage('store', { format: 'wfr', file: `meshes/${fname}`, element: els[0] }, [keep.lineage]);
      if (keep.visible === false) { L.visible = false; S.renderer.setLayerVisible(L.id, false); }
      if (keep.sectioned != null && keep.sectioned !== true) S.renderer.setLayerSectioned(L.id, keep.sectioned);
      if (keep.catLegend) { L.catLegend = keep.catLegend; applyCatLegend(L, true); }
      packed++;
    }
  }
  recomputeUnion(); renderLayers(); markProjectDirty(); requestRender();
  return packed;
}

export async function maybeAutoPackMeshes() {
  const cands = S.layers.filter(packableMesh);
  if (!cands.length || _autoPack === 'off') return;
  if (_autoPack == null) {
    if (_autoPackSkip) return;                             // "Not now" holds for this session
    const a = await microChoose('store meshes as .wfr',
      `${cands.length} mesh/strings/points layer${cands.length === 1 ? '' : 's'} (${cands.map((L) => L.label || L.name).slice(0, 4).join(', ')}${cands.length > 4 ? ', …' : ''}) can be stored in the project as .wfr — bricked, a fraction of the size, quick to reopen, attributes kept. Source files already in the project are kept. Settings → "store meshes as .wfr on save" changes your answer later.`,
      [{ label: 'Never', value: 'never', quiet: true }, { label: 'Not now', value: 'skip' }, { label: 'Yes', value: 'once' }, { label: 'Yes, always', value: 'always' }]);
    if (a === 'never') { setAutoPack('off'); return; }
    if (a === 'always') setAutoPack('on');
    else if (a !== 'once') { _autoPackSkip = true; return; }   // Not now / × / Esc: ask again next session
  }
  const n = await packLayersToWfr(cands);
  if (n) $('#meta').textContent = `stored ${n} layer${n === 1 ? '' : 's'} as .wfr in meshes/`;
}

export function updateProjectTitle() {
  document.title = S.project ? `micro — ${S.project.name}${S.project.pack ? ' (pack, read-only)' : ''}${S.project.dirty ? ' •' : ''}` : 'micro';
}

// selection masks persist run-length encoded (alternating 0-run/1-run lengths)
export function rleEncode(mask) {
  const runs = [];
  let cur = 0, run = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === cur) run++;
    else { runs.push(run); cur = v; run = 1; }
  }
  runs.push(run);
  return runs;
}

export function rleDecode(runs, n) {
  const m = new Uint8Array(n);
  let at = 0, v = 0;
  for (const r of runs) { if (v) m.fill(1, at, Math.min(n, at + r)); at += r; v ^= 1; }
  return m;
}

// painted-column codes are BYTES (0..255), so their RLE carries the value:
// [value, run, value, run, …]
export function rleEncodeBytes(codes) {
  const runs = [];
  let cur = codes.length ? codes[0] : 0, run = 0;
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] === cur) run++;
    else { runs.push(cur, run); cur = codes[i]; run = 1; }
  }
  if (codes.length) runs.push(cur, run);
  return runs;
}

export function rleDecodeBytes(runs, n) {
  const m = new Uint8Array(n);
  let at = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const v = runs[i], r = runs[i + 1];
    if (v) m.fill(v, at, Math.min(n, at + r));
    at += r;
  }
  return m;
}

export function projectManifest() {
  return {
    app: 'micro', version: 1, name: S.project.name,
    layers: S.layers.filter((L) => !L.derivedOf).map((L) => ({
      source: L._relpath || L.name,
      dh: L.dh && L.docs.dhDoc ? (L._setPath ? { set: L._setPath, interval: L._intervalName } : {
        collar: basename(layerFiles(L)[0].name), survey: basename(layerFiles(L)[1].name), intervals: basename(layerFiles(L)[2].name),
        config: L.docs.dhDoc.config,
      }) : undefined,
      label: L.label && L.label !== L.name ? L.label : undefined,
      external: L.storage === 'external' || undefined,
      colorSel: L.colorSel, clip: L.clip, filter: L.filterExpr || '', visible: L.visible,
      catChoices: L.catChoices && L.catChoices.length ? L.catChoices : undefined,
      sectioned: (() => { const m = S.renderer.layerSectioned(L.id); return m === true ? undefined : m; })(),
      kind: (L.kind === 'mesh' && !L.gridSurface) ? 'mesh'
        : L.kind === 'table' ? 'table'
          : L.docs.stringsDoc ? (L.docs.stringsDoc.header.kind === 'strings' ? 'strings' : 'dxf-points') : undefined,
      sheet: L._sheet || undefined,                        // an xlsx layer reopens THIS worksheet   // a grid-surface is kind 'mesh' but reopens as a grid (gridSurface flag)
      tint: L.kind === 'mesh' ? L.tint : undefined,
      opacity: (L.opacity != null && L.opacity !== 1) ? L.opacity : undefined,   // any kind (mesh/blocks/drillholes)
      recHide: (L._recHide && L._recHide.size) ? [...L._recHide] : undefined,   // record-panel hidden fields (view pref)
      legend: L.legend || undefined, legendTitle: (L.legendTitle && L.legendTitle.trim()) || undefined,   // per-layer figure legend
      edges: L.edges != null ? L.edges : undefined,        // per-layer block-edge override (tri-state; absent = follow View)
      gtUnits: L.gtUnits || undefined,                     // grade-tonnage unit declarations (grade unit, density col/const + unit)
      analysis: L.analysis || undefined,                   // GT/swath window setups (series by layer NAME) + pinned-open state + geometry
      ...captureLayerSurface(L),   // gridSurface · drape · flatZ · faceted · band — the ONE surface-state source (shared with scenes; parity-tested)
      soup: (L.kind === 'mesh' && L.docs.meshDoc && L.docs.meshDoc.header.soup) || undefined,
      exact: (L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup && L.docs.meshDoc.header.triCount > CONTEXT_TRI_CAP) || undefined,   // promoted past the cap
      traces: L.kind === 'mesh' && L.traces && L.traces.length ? L.traces.map((t) => ({ set: (setColOf(L) || { dict: [] }).dict[t.set] || '', pts: t.pts, path: t.path })) : undefined,   // fracture traces: file-vertex indices, set by NAME
      element: ((L.docs.meshDoc || L.docs.stringsDoc || {}).header || {}).element ?? undefined,   // a .wfr layer reopens ITS element of a shared file
      hiddenCats: L.catHidden && L.catHidden.size
        ? [...L.catHidden].map((c) => { const h2 = layerHeaderOf(L); return h2 && h2.categories && h2.categories[c] != null ? h2.categories[c] : c; })
        : undefined,
      colTypes: L.colTypes && Object.keys(L.colTypes).length ? L.colTypes : undefined,
      qualify: L.qualify && Object.keys(L.qualify).length ? L.qualify : undefined,
      holeFilter: (L.dh && L.holeFilter) || undefined,     // the collars-location predicate (view state)
      // calcCols live in the ELEMENT manifest (spec rule 10) — read here only as legacy
      ramps: L.ramps && Object.keys(L.ramps).length ? L.ramps : undefined,
      catLegend: L.catLegend || undefined,
      rules: L.rules && L.rules.list && L.rules.list.length ? L.rules : undefined,
      ruleHidden: L.ruleHidden && L.ruleHidden.size ? [...L.ruleHidden] : undefined,
      paintCols: L.paintCols && L.paintCols.some((c) => !c.mat && !isStoredCat(c))   // sidecar columns (matcols + stored categories) persist as Parquet, not RLE
        ? L.paintCols.filter((c) => !c.mat && !isStoredCat(c)).map((c) => ({ name: c.name, kind: c.kind, dict: c.dict, colors: c.colors, blankColor: c.blankColor, lineage: c.lineage || undefined, rle: rleEncodeBytes(c.codes) }))
        : undefined,
      sel: L._selMask && L._selCount ? rleEncode(L._selMask) : undefined,
      lineage: L.lineage || undefined,                     // provenance chain (how this layer was made)
      // parsing intent: the column mapping (incl. a re-keyed category) —
      // indices are stable because the file rides in the project. .dm too:
      // its restore threads mapping through openDmBlob (chan + cat honored).
      mapping: L.docs.blockDoc ? L.docs.blockDoc.header.mapping : undefined,
    })),
    camera: captureCamera(),
    section: H.captureSection(),
    // bookmarks + scenes now live as files in bookmarks/ and scenes/ (not in
    // project.json) — see flushViewsScenes / loadViewsScenes
    tree: (() => {                                         // groups (§4.1) — layers by manifest index
      const idOf = new Map(S.layers.filter((L) => !L.derivedOf).map((L, i) => [L.id, i]));   // same filter as layers: above
      return treeToManifest(idOf);
    })(),
  };
}

// recent projects on the empty state (chips, like recent files)
export async function renderEmptyProjects() {
  const el = $('#emptyProjects'); if (!el) return;
  el.textContent = '';
  if (!S.hasFSAA) return;
  let list = [];
  try { list = (await _idb.get(PROJECTS_KEY)) || []; } catch { /* ignore */ }
  if (!list.length) return;
  const lab = document.createElement('span'); lab.className = 'er-label'; lab.textContent = 'projects:';
  el.appendChild(lab);
  for (const e of list.slice(0, 6)) {
    const chip = document.createElement('a'); chip.className = 'er-chip';
    chip.textContent = e.pack ? `${e.name} · pack` : e.name;
    chip.title = e.pack ? `open the pack ${e.handle && e.handle.name || ''} (read-only)` : 'open project';
    chip.onclick = () => (e.pack ? openPackFromHandle(e.handle) : openProjectDir(e.handle));
    el.appendChild(chip);
  }
}

// a pack opened from a file the browser can hand back (a picker, a drop, recents)
// joins the recent projects as itself — reopening reads the same file, read-only
export async function rememberPack(handle, name) {
  try {
    const list = (await _idb.get(PROJECTS_KEY)) || [];
    const next = [{ name, handle, pack: true }].concat(list.filter((e) => e.name !== name || !e.pack)).slice(0, 8);
    await _idb.set(PROJECTS_KEY, next);
    renderEmptyProjects();
  } catch { /* best-effort */ }
}

export async function openPackFromHandle(h) {
  try {
    if (h.queryPermission && await h.queryPermission({ mode: 'read' }) !== 'granted' && h.requestPermission) await h.requestPermission({ mode: 'read' });
    const f = await h.getFile();
    _fileHandles.set(f, h);
    return await openProjectPack(f);
  } catch (e) { $('#meta').textContent = `open pack: ${h.name} can't be read any more (moved or deleted?) — ${e.message || e}`; return null; }
}

export async function rememberProject(dir) {
  if (dir && dir._pack) return;                            // a pack is opened from its file, not remembered as a folder
  try {
    const list = (await _idb.get(PROJECTS_KEY)) || [];
    const links = {};
    for (const L of S.layers) if (L.storage === 'external' && L.handle) links[L.name] = L.handle;
    const next = [{ name: dir.name, handle: dir, links }].concat(list.filter((e) => e.name !== dir.name || e.pack)).slice(0, 8);
    await _idb.set(PROJECTS_KEY, next);
    renderEmptyProjects();
  } catch { /* best-effort */ }
}

export async function saveProjectAs() {
  if (S.project && S.project.pack) return savePackAsFolder();
  if (!S.hasFSAA) return;
  let dir;
  try { dir = await pickDirectory(); } catch { return; }   // cancelled
  S.project = { dir, name: dir.name, dirty: false };
  await saveProject();
  rememberProject(dir);
}

// Storage triage on save (GIS semantics — copying is CONSENT, never a side
// effect): a layer is IN the folder (dir.resolve on its handle, or a same-name
// same-size file already there) → plain reference; OUTSIDE with a handle →
// LINKED (the handle persists in this browser's IDB; the manifest says
// external — honest that the folder alone doesn't carry it); outside without
// a handle (drag-drops, generated samples) can only be copied or located again
// on reopen. One compact menu covers all outside layers per save.
// (fmtSize / layerBytes / layerFiles / basename / joinPath / kindDir / relPathFor /
// resolveFileHandle / removeFileAt / layerRelpath / resolveDhFile / dhSetName live in src/paths.js)
// the copy-into-project verb (layer context menu + the command palette): one
// SIZED consent step (never copy without consent — the G1 storage rule), then
// copyLayerIn routes the file to its kind folder.
export function canCopyIntoProject(L) { return !!(S.project && !S.project.pack && L && L.storage !== 'project' && L.storage !== 'volatile' && layerFiles(L).length); }

export function copyLayerIntoProject(L) {
  if (!canCopyIntoProject(L)) { $('#meta').textContent = S.project && S.project.pack ? 'copy: a project pack is read-only — save it as a folder first' : S.project ? 'copy: this layer is already in the project (or has no file)' : 'copy: open a project folder first'; return; }
  setTimeout(() => menuXY(innerWidth / 2 - 120, innerHeight / 3, [
    { label: `Copy “${L.name}”${L.dh ? ' (collar + survey + intervals)' : ''} (${fmtSize(layerBytes(L))}) into ${S.project.name}/`, action: async () => { $('#meta').textContent = `copying ${L.name}…`; await copyLayerIn(L, S.project.dir); markProjectDirty(); $('#meta').textContent = `copied ${L.name} into the project (${fmtSize(layerBytes(L))})`; renderLayers(); } },
    { label: 'Cancel', action: () => {} },
  ]), 0);
}

export async function copyLayerIn(L, dir) {
  const kd = kindDir(L);
  for (const fd of layerFiles(L)) {
    const rel = joinPath(kd, basename(fd.name));
    let exists = null;
    try { exists = await resolveFileHandle(dir, rel); } catch { /* not there */ }
    if (exists) { const f = await exists.getFile(); if (sameSourceFile(f, fd.blob)) { if (!L.dh) L.handle = exists; continue; } }
    const fh = await resolveFileHandle(dir, rel, { create: true });
    const w = await fh.createWritable();
    await fd.blob.stream().pipeTo(w);
    _copiedBlobs.add(fd.blob);
    if (!L.dh) L.handle = fh;
  }
  L.storage = 'project';
  renderLayers();
}

export function askCopyOutside(outside) {
  return new Promise((res) => {
    const loose = outside.length - outside.filter((L) => L.handle).length;
    // one file can back several layers (a streamed DXF's surface/strings/points
    // siblings) — list and size each FILE once; copyLayerIn copies it once too
    const files = [], seen = new Set();
    for (const L of outside) for (const fd of layerFiles(L)) { if (!seen.has(fd.blob)) { seen.add(fd.blob); files.push(fd); } }
    const total = files.reduce((t, fd) => t + fd.blob.size, 0);
    const body = $('#svDlgBody');
    body.textContent = '';
    const note = document.createElement('div'); note.className = 'ex-row';
    note.textContent = `${outside.length} layer${outside.length > 1 ? 's' : ''} (${fmtSize(total)}) live${outside.length > 1 ? '' : 's'} outside the project folder:`;
    body.appendChild(note);
    {
      for (const fd of files) {
        const row = document.createElement('div'); row.className = 'sv-row';
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = fd.name; nm.title = fd.name;
        const sz = document.createElement('span'); sz.className = 'sz'; sz.textContent = fmtSize(fd.blob.size);
        row.append(nm, sz);
        body.appendChild(row);
      }
    }
    const hint = document.createElement('div'); hint.className = 'pp-note';
    hint.textContent = loose
      ? `copying makes the project self-contained; linking leaves them in place (${loose} without a saved handle will need locating on reopen)`
      : 'copying makes the project self-contained; linking leaves them in place (this browser remembers where)';
    body.appendChild(hint);
    const finish = (v) => { $('#svDlg').classList.remove('show'); res(v); };
    $('#svCopy').onclick = () => finish('copy');
    $('#svLink').onclick = () => finish('link');
    $('#svCancel').onclick = () => finish('link');         // dismiss = the non-destructive default, as before
    $('#svDlg').classList.add('show');
  });
}

// bytes micro itself copied into a folder (copy into project, a pack saved as a
// folder): the copy has a new mtime by nature, so neither the in-folder test nor a
// cache sidecar may hold the source's own stamp against it
export const _copiedBlobs = new WeakSet();

// the stamp a cache sidecar records: the file ON DISK's, when micro made that file
// from these bytes; the source's own otherwise (an edit on disk must not inherit a cache)
export async function cacheStamp(dir, rel, blob) {
  if (_copiedBlobs.has(blob)) { try { const f = await (await resolveFileHandle(dir, rel)).getFile(); if (f.size === blob.size) return f.lastModified; } catch { /* not there */ } }
  return blob.lastModified || 0;
}

// Does an on-disk file identify as THIS layer's source? Size, plus last-modified
// when the in-memory blob carries one (a File does; a synthetic/converted blob
// does not). Narrows the old size-only test, which aliased any two same-name,
// same-size files onto one — collapsing unrelated data. A mismatch is safe: the
// layer just writes its own (correct) bytes instead of aliasing.
export function sameSourceFile(diskFile, blob) {
  if (diskFile.size !== blob.size) return false;
  if (_copiedBlobs.has(blob)) return true;                 // micro wrote that copy from these bytes: a new mtime, the same file
  if (blob.lastModified && diskFile.lastModified) return diskFile.lastModified === blob.lastModified;
  return true;   // one side has no timestamp — size is all we can compare
}

export async function saveProject() {
  if (!S.project) return saveProjectAs();
  if (S.project.pack) return savePackAsFolder();
  const dir = S.project.dir;
  try {
    if (dir.requestPermission && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') { $('#meta').textContent = 'project: write permission denied'; return; }
    await maybeAutoOptimize();                              // reorder block models to spatial Parquet BEFORE triage, so the parquet is what's referenced/copied
    await maybeAutoPackMeshes();                            // and meshes/strings/pegs into meshes/*.wfr (written in place, so triage sees them in-project)
    // A just-optimized layer's bytes are now Parquet but its handle was dropped
    // (convertLayerToParquet). Write the Parquet INTO the project + delete the old
    // source here — so triage sees a clean in-project layer (no spurious "copy
    // outside files in?" prompt) and the folder shows the .parquet only.
    for (const L of S.layers) {
      const orphan = L._optimizedOrphan; if (!orphan) continue;
      L._optimizedOrphan = null;
      try {
        await copyLayerIn(L, dir);                          // writes models/<name>.parquet, sets L.handle + storage 'project'
        const segs = dir.resolve ? await dir.resolve(orphan) : null;
        const keep = await layerRelpath(L, dir);
        if (segs && segs.length && segs.join('/') !== keep) {
          let d = dir; for (let i = 0; i < segs.length - 1; i++) d = await d.getDirectoryHandle(segs[i]);
          const leaf = segs[segs.length - 1];
          await d.removeEntry(leaf);                         // drop the pre-optimize CSV/.dm
          try { await d.removeEntry(leaf + '.meta.json'); } catch { /* no sidecar */ }   // + its derived-cache sidecar
        }
      } catch { /* falls back to normal triage; an orphan is harmless clutter */ }
    }
    const outside = [];
    for (const L of S.layers) {
      const flist = layerFiles(L);
      if (!flist.length) { L.storage = 'volatile'; continue; }   // samples: nothing to reference
      let allIn = true;
      for (const fd of flist) {
        let inFolder = false;
        if (!L.dh && L.handle && dir.resolve) { try { inFolder = !!(await dir.resolve(L.handle)); } catch { /* not a descendant */ } }
        if (!inFolder) {
          for (const rel of [relPathFor(L, fd.name), basename(fd.name)]) {   // canonical kind folder, then legacy root
            try {
              const ex = await resolveFileHandle(dir, rel);
              const f = await ex.getFile();
              if (sameSourceFile(f, fd.blob)) { inFolder = true; if (!L.dh) L.handle = ex; break; }
            } catch { /* not there */ }
          }
        }
        if (!inFolder) allIn = false;
      }
      L.storage = allIn ? 'project' : 'external';
      if (!allIn) outside.push(L);
    }
    if (outside.length && await askCopyOutside(outside) === 'copy') {
      for (const L of outside) { $('#meta').textContent = `project: copying ${L.name}…`; await copyLayerIn(L, dir); }
    }
    // record each layer's real path for the manifest + write the drillhole-set
    // descriptor (the one compound load: three CSVs + desurvey config → .holes.json)
    for (const L of S.layers) {
      L._relpath = undefined; L._setPath = undefined;
      if (L.storage === 'external') { L._relpath = basename(L.name); continue; }
      if (L.storage !== 'project') continue;
      if (!L.dh) L._relpath = await layerRelpath(L, dir);
    }
    // drillhole sets: group dh layers by _setKey → ONE .holes.json per set with
    // an intervals[] array (multiple interval tables share one collar+survey)
    const dhGroups = new Map();
    for (const L of S.layers) {
      if (!(L.dh && L.docs.dhDoc && L.storage === 'project')) continue;
      const key = L._setKey || ('solo:' + L.id);
      if (!dhGroups.has(key)) dhGroups.set(key, []);
      dhGroups.get(key).push(L);
    }
    for (const members of dhGroups.values()) {
      const rep = members[0];
      const setRel = joinPath('drillholes', dhElementName(rep));
      try {
        for (const L of members) await ensureSourceHash(L);   // the set manifest records each member's source by content
        const elem = await buildDhSetManifest(members);
        const dh2 = await resolveFileHandle(dir, setRel, { create: true });
        const w = await dh2.createWritable(); await w.write(JSON.stringify(elem, null, 2) + '\n'); await w.close();
        for (const L of members) { L._setPath = setRel; L._intervalName = L._intervalName || basename(layerFiles(L)[2].name); }
      } catch { /* inline fallback in the manifest */ }
    }
    // grid display-cache sidecars: the decimated/overview DISPLAY grid, stored
    // as compact Surfer binary so a huge DEM's project reopens WITHOUT
    // re-decimating the source (eval still windows the source at full res)
    for (const L of S.layers) { try { await writeGridDisplayCache(L, dir); } catch { /* cache, never a failure */ } }
    // the element manifest + its columns: NOT derived — paint is hand-brushed, a
    // calc is authored, a join brought another file's values. A failure here is
    // reported (and the project stays unsaved), never swallowed.
    const colFails = [];
    for (const L of S.layers) {
      if (!(layerTableHeader(L) || (L.docs && L.docs.gridDoc))) continue;
      try { await persistElement(L); } catch (e) { colFails.push(`${L.label || L.name}: ${e && e.message || e}`); }
    }
    // derived-cache sidecars (spec section 12): the discovery header + column
    // stats + BAND min/max travel WITH the data — reopening skips the discovery
    // sweep, the styling/statistics UIs wake up already scanned, and .dm filters
    // get parquet-style pushdown (bands prove page-runs can't match). Built here
    // when missing — the one full read per file, ever (size-keyed). CSV + .dm +
    // parquet all get one; parquet skips bands (its footer already has them).
    for (const L of S.layers) {
      const doc = L.docs.blockDoc;
      if (!doc || L.storage !== 'project') continue;
      try {
        const h = doc.header;
        const isPq = !!doc.parquet, isDmL = !!h.dm;
        if (!colStatsComplete(L) || (!L._bands && !isPq)) {
          $('#meta').textContent = `indexing ${L.label || L.name}…`;
          await scanColumns(L, (a, b) => { $('#meta').textContent = `indexing ${L.label || L.name} — ${b ? Math.round(100 * a / b) : 0}%…`; }, { bands: !isPq });
        }
        const meta = {
          v: isDmL || isPq ? 2 : 4, size: doc.blob.size, mtime: await cacheStamp(dir, L._relpath || relPathFor(L, L.name), doc.blob), hash: (await sourceHash(doc.blob)) || undefined,
          header: isDmL
            ? { kind: 'dm', count: h.count, bbox: h.bbox, grid: h.grid, subBlocked: h.subBlocked || false, dimPalette: h.dimPalette || null, categories: h.categories || null }
            : isPq
              ? { ...microModelOf(h), kind: 'parquet', count: h.count }
              : {
                kind: h.kind, count: h.count, bbox: h.bbox, grid: h.grid, lattice: h.lattice || null,
                subBlocked: h.subBlocked || false, dimPalette: h.dimPalette || null, dimCols: h.dimCols || null,
                columns: h.columns, mapping: h.mapping, delim: h.delim, decimal: h.decimal || '.', hasHeaderRow: h.hasHeaderRow,
                numericColumns: h.numericColumns, categories: h.categories, attributes: h.attributes,
                index: h.index ? { k: h.index.k, offsets: [...h.index.offsets] } : undefined,
                dropped: h.dropped || null,
                zones: zonesToJSON(h.zones) || undefined,
              },
          colStats: L._colStats || undefined,
          bands: L._bands || undefined,
        };
        const mh = await resolveFileHandle(dir, (L._relpath || relPathFor(L, L.name)) + '.meta.json', { create: true });
        const mw = await mh.createWritable();
        await mw.write(JSON.stringify(meta));
        await mw.close();
      } catch { /* sidecars are a cache, never a failure */ }
    }
    await flushViewsScenes(dir);                            // bookmarks/ + scenes/ — write any not yet persisted
    const fh = await dir.getFileHandle('project.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(projectManifest(), null, 2) + '\n');
    await w.close();
    S.project.dirty = colFails.length > 0;                 // columns that didn't save: still unsaved work
    updateProjectTitle();
    renderLayers();
    rememberProject(dir);                                  // refresh the stored links alongside
    const ext = S.layers.filter((L) => L.storage === 'external').length;
    if (colFails.length) {
      $('#meta').textContent = `project saved — but the columns of ${colFails.length} layer${colFails.length === 1 ? '' : 's'} did NOT save`;
      microChoose('columns not saved', `The project file is written, but these layers' columns (paint, ƒ, joined) could not be stored — ${colFails.join(' · ')}. They are still here in this session. Save again, or export the layer, before closing.`, [{ label: 'OK', value: true }]);
    } else $('#meta').textContent = `project saved — ${S.project.name}/project.json${ext ? ` · ${ext} linked outside the folder` : ''}`;
  } catch (e) {
    $('#meta').textContent = `project save failed — ${e.message}`;
  }
}

// rules + painted columns + selection restore — shared by the delimited and
// drillhole project-restore branches (all three are per-record layer state)
export async function restoreStyleExtras(L, ls) {
  if (ls.lineage) L.lineage = ls.lineage;                  // provenance survives project round trips
  // drillhole layers `continue` past the shared post-open restore block, so these
  // per-layer fields were dropped on every reload — most consequentially gtUnits,
  // the grade-unit / density declaration that changes what grade-tonnage MEANS.
  // restoreStyleExtras is the one place the dh branch does reach; restore them here.
  if (L.dh) {
    if (ls.opacity != null) { L.opacity = ls.opacity; S.renderer.setLayerOpacity(L.id, ls.opacity); }
    if (ls.clip) L.clip = ls.clip;
    if (ls.gtUnits) L.gtUnits = ls.gtUnits;
    if (ls.legend != null) L.legend = ls.legend;
    if (ls.legendTitle != null) L.legendTitle = ls.legendTitle;
    if (ls.edges != null) L.edges = ls.edges;
    if (ls.recHide) L._recHide = ls.recHide;
  }
  if (ls.analysis) L.analysis = ls.analysis;               // GT/swath setups (windows reopen after all layers land — series may span them)
  if (ls.rules) {
    L.rules = ls.rules;
    L.ruleHidden = new Set(ls.ruleHidden || []);
    if (ruleModeOf(L)) { S.renderer.setLayerRuleMode(L.id, true); await runRules(L, true); }   // declarative: codes rebuild by sweep
  }
  if (ls.paintCols) {
    const n2 = attrRowCountOf(L);
    const restored = ls.paintCols.map((c) => ({ name: c.name, kind: c.kind || undefined, dict: c.dict.slice(), colors: (c.colors || []).slice(), blankColor: c.blankColor, lineage: c.lineage || undefined, codes: rleDecodeBytes(c.rle || [], n2) }));
    const names = new Set(restored.map((c) => c.name.toLowerCase()));
    L.paintCols = [...restored, ...(L.paintCols || []).filter((c) => !names.has(c.name.toLowerCase()))];   // MERGE — sidecar-loaded columns survive
    for (const pc of L.paintCols) paintRecount(pc);
    addPaintColorOptions(L);
    if (L.kind === 'mesh' && setColOf(L)) structureAfterEdit(L);   // painted sets show on the rock again
    // colorSel 'paint:…' couldn't land earlier (its option only exists now)
    if (ls.colorSel && ls.colorSel.startsWith('paint:')) {
      L.colorSel = ls.colorSel;
      if (L.id === S.activeId && [...$('#colorBy').options].some((o) => o.value === ls.colorSel)) $('#colorBy').value = ls.colorSel;
      syncRuleMode(L);
    }
  }
  if (ls.sel) { L._selMask = rleDecode(ls.sel, attrRowCountOf(L)); H.applyLayerSelection(L); }
  if (ls.traces && L.kind === 'mesh') {                   // after the paint: a trace's set resolves by name in SET
    const col = setColOf(L);
    L.traces = ls.traces.map((t) => ({ set: col ? Math.max(0, col.dict.indexOf(t.set)) : 0, pts: t.pts, path: t.path }));
    structureAfterEdit(L);
  }
}

// the load dialog: every manifest layer as a row, live status per row (the
// footer's messages mirror into the active row, so multi-second restores are
// visible even without watching the statusbar). Clean loads close themselves;
// skips/errors hold the dialog open so they're actually SEEN.
export const _plState = { rows: null, obs: null, active: -1 };

export function plStart(layers, name) {
  const body = $('#plDlgBody');
  body.textContent = '';
  $('#plDlg').querySelector('.hd span').textContent = `opening project · ${name}`;
  _plState.rows = layers.map((ls) => {
    const row = document.createElement('div'); row.className = 'pl-row';
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = ls.dh ? (ls.dh.collar ? `${ls.dh.collar} + survey + intervals` : basename(ls.dh.set || 'drillhole set')) : ls.source;
    nm.title = nm.textContent;
    const st = document.createElement('span'); st.className = 'st'; st.textContent = 'waiting…';
    row.append(nm, st);
    body.appendChild(row);
    return { row, st };
  });
  _plState.active = -1;
  // mirror the statusbar into the active row (sweeps, sub-steps — free detail)
  _plState.obs = new MutationObserver(() => {
    const a = _plState.rows && _plState.rows[_plState.active];
    if (a && !a.row.classList.contains('done') && !a.row.classList.contains('skip')) a.st.textContent = $('#meta').textContent;
  });
  _plState.obs.observe($('#meta'), { childList: true, characterData: true, subtree: true });
  $('#plDlg').classList.add('show');
}

export function plRow(i, status, cls) {
  _plState.active = i;
  const r = _plState.rows && _plState.rows[i];
  if (!r) return;
  r.st.textContent = status;
  if (cls) r.row.classList.add(cls);
}

export function plEnd() {
  if (_plState.obs) { _plState.obs.disconnect(); _plState.obs = null; }
  const dirty = _plState.rows && _plState.rows.some((r) => r.row.classList.contains('skip'));
  if (!dirty) $('#plDlg').classList.remove('show');        // clean load: out of the way
  _plState.rows = null; _plState.active = -1;
}

export async function openProjectDir(dir, { pack = null } = {}) {
  try {
    dir = await rehydrateHandle(dir);                       // an IDB clone of a shell tree handle → live (web handles pass through)
    if (dir.requestPermission && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') { $('#meta').textContent = 'project: permission denied'; return; }
    const mf = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    if (mf.app !== 'micro') { $('#meta').textContent = 'not a micro project (project.json says otherwise)'; return; }
    S.project = { dir, name: dir.name, dirty: false, pack };
    await loadViewsScenes(dir, mf.views);                   // bookmarks/ + scenes/ (legacy mf.views migrated)
    closeAllLayers();
    $('#empty').style.display = 'none';
    let links = {};
    try { const list = (await _idb.get(PROJECTS_KEY)) || []; const e = list.find((x) => x.name === dir.name && !x.pack); links = (e && e.links) || {}; } catch { /* none */ }
    plStart(mf.layers, dir.name);
    const idAt = [];                                       // manifest index → restored layer id
    for (let i = 0; i < mf.layers.length; i++) {
      const ls = mf.layers[i];
      plRow(i, 'loading…');
      if (ls.dh) {
        // drillholes restore from the three files + config — via the .holes.json
        // descriptor (paths relative to its folder) or the legacy inline form
        let dhRef = ls.dh, setDir = '', ivName = null;
        if (ls.dh.set) {
          try {
            setDir = ls.dh.set.split('/').slice(0, -1).join('/');
            const raw = JSON.parse(await (await (await resolveFileHandle(dir, ls.dh.set)).getFile()).text());
            const desc = descFromElement(raw) || raw;      // <set>.element.json (v1) or legacy .holes.json
            const ivs = Array.isArray(desc.intervals) ? desc.intervals : [desc.intervals];   // multi-interval sets
            ivName = ls.dh.interval && ivs.includes(ls.dh.interval) ? ls.dh.interval : ivs[0];
            dhRef = { collar: desc.collar, survey: desc.survey, intervals: ivName, config: desc.config };
          } catch { $('#meta').textContent = `project: drillhole set “${ls.dh.set}” missing/invalid — layer skipped`; plRow(i, 'skipped — set missing', 'skip'); continue; }
        }
        const dhFiles = {};
        let missing = null;
        for (const role of ['collar', 'survey', 'intervals']) {
          try { dhFiles[role] = await resolveDhFile(dir, setDir, dhRef[role]); }
          catch { missing = dhRef[role]; break; }
        }
        if (missing) { $('#meta').textContent = `project: drillhole file “${missing}” missing from the folder — layer skipped`; plRow(i, `skipped — ${missing} missing`, 'skip'); continue; }
        await openDrillholeLayer(dhFiles, dhRef.config || {}, S.layers.length ? 'add' : 'replace');
        const Ld = activeLayer();
        if (Ld) {
          Ld.storage = 'project';
          if (ls.dh.set) { Ld._setPath = ls.dh.set; Ld._setKey = ls.dh.set; Ld._intervalName = ivName; }   // group siblings; rescan won't re-offer
          if (ls.label) Ld.label = ls.label;
          if (ls.colTypes) { Ld.colTypes = ls.colTypes; applyColTypes(Ld); }
          if (ls.qualify) { Ld.qualify = ls.qualify; Ld._qualFn = undefined; _qualifyReopen.push(Ld.id); }
          try { await loadElement(Ld, dir); } catch (e) { (Ld._colsUnread || (Ld._colsUnread = [])).push({ name: 'columns', why: e && e.message || String(e) }); }   // ƒ + matcols BEFORE filter/color (both may reference them); never blocks the load, always reported
          if (ls.calcCols && !(Ld.calcCols || []).length) Ld.calcCols = ls.calcCols;   // legacy projects (no element manifest)
          addPaintColorOptions(Ld);
          if (ls.holeFilter) { try { await applyHoleFilter(Ld, ls.holeFilter); } catch { /* collar missing → no mask */ } }
          await refilterLayer(Ld, ls.filter);
          if (ls.visible === false) { Ld.visible = false; S.renderer.setLayerVisible(Ld.id, false); }
          if (ls.sectioned != null && ls.sectioned !== true) S.renderer.setLayerSectioned(Ld.id, ls.sectioned);
          restoreHiddenCats(Ld, ls.hiddenCats);
          if (ls.ramps) { Ld.ramps = ls.ramps; applyRamp(Ld, true); }
          if (ls.catLegend) { Ld.catLegend = ls.catLegend; applyCatLegend(Ld, true); }
          if (Array.isArray(ls.catChoices)) { Ld.catChoices = ls.catChoices; addPaintColorOptions(Ld); }
          if (ls.colorSel && [...$('#colorBy').options].some((o) => o.value === ls.colorSel)) { Ld.colorSel = ls.colorSel; $('#colorBy').value = ls.colorSel; syncRuleMode(Ld); }
          await restoreStyleExtras(Ld, ls);
          idAt[i] = Ld.id;
        }
        plRow(i, 'done', 'done');
        continue;
      }
      let file = null, handle = null;
      if (ls.external) {
        handle = links[ls.source] || null;
        if (handle) {
          try {
            if (handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted' && handle.requestPermission) await handle.requestPermission({ mode: 'read' });
            file = await handle.getFile();
          } catch { file = null; }
        }
        if (!file) {                                       // link lost (other browser / dropped file) → locate or skip
          const act = await new Promise((res) => menuXY(innerWidth / 2 - 120, innerHeight / 3, [
            { label: `Locate “${ls.source}”…`, action: () => res('locate') },
            { label: 'Skip this layer', action: () => res(null) },
          ], () => res(null)));
          if (act === 'locate') {
            try { const [h] = await window.showOpenFilePicker(); handle = h; file = await h.getFile(); } catch { /* cancelled */ }
          }
          if (!file) { $('#meta').textContent = `project: “${ls.source}” skipped (linked outside the folder)`; plRow(i, 'skipped — linked outside, not located', 'skip'); continue; }
        }
      } else {
        try { handle = await resolveFileHandle(dir, ls.source); file = await handle.getFile(); }
        catch { $('#meta').textContent = `project: “${ls.source}” missing from the folder — skipped`; plRow(i, 'skipped — missing from the folder', 'skip'); continue; }
      }
      if (handle) _fileHandles.set(file, handle);
      // a mesh-bearing .ply saved as a POINTS layer must reopen as points
      const overR = ls.kind === 'mesh'
        // a DXF surface reopens as JUST the surface (a streamed DXF would otherwise
        // bring its strings/points siblings back a second time)
        ? { tint: ls.tint, opacity: ls.opacity, forceSoup: !!ls.soup, forceContext: !!ls.exact, ...(/\.dxf$/i.test(ls.source) ? { asKind: 'mesh' } : {}) }
        : ls.kind === 'table'
          ? (ls.sheet ? { sheet: ls.sheet } : { asKind: 'table' })
          : ls.kind === 'strings' ? { asKind: 'lines' }
            : ls.kind === 'dxf-points' ? { asKind: 'points' }
              : (/\.ply$/i.test(ls.source) ? { forcePoints: true } : (ls.mapping ? { mapping: ls.mapping } : {}));
      if (ls.gridSurface) { overR.asKind = 'surface'; if (ls.flatZ != null) overR.flatZ = ls.flatZ; if (ls.faceted) overR.smooth = false; }   // a grid saved as a surface reopens as one (relief/flat, smooth/faceted; drape applied post-load)
      if (ls.band) overR.band = ls.band;                    // multi-band GeoTIFF: the chosen band
      if (ls.element != null) overR.element = ls.element;   // a .wfr layer: just its element
      // grid display-cache: matching source size → display from the sidecar,
      // skipping the re-decimation (eval still windows the source full res)
      if (ls.kind !== 'mesh' && /\.(tif|tiff)$/i.test(ls.source)) {
        try {
          const jj = JSON.parse(await (await (await resolveFileHandle(dir, ls.source + '.disp.json')).getFile()).text());
          // size alone cannot identify a band — every band of a multi-band GeoTIFF
          // shares one file size, so a cache built while viewing band A was being
          // served for band B: right numbers under the cursor (eval windows the
          // source at full res), wrong picture on screen. Caches written before
          // this carry no `band`, so they only match band 0.
          if (jj && jj.v === 1 && sidecarMatches(jj, file, jj.hash ? await sourceHash(file) : null) && (jj.band || 0) === (ls.band || 0)) {
            const grd = await readSurferGrd(await (await resolveFileHandle(dir, ls.source + '.disp.grd')).getFile());
            overR.displayCache = grd;
          }
        } catch { /* no cache — decimate as usual */ }
      }
      // the sidecar cache: matching size → skip the discovery sweep entirely
      // (CSV rebuilds its whole header incl. the line index; .dm/parquet take
      // the cached grid/bbox/palette/categories via opts.cached)
      let sidecar = null;
      if (ls.kind !== 'mesh' && /\.(csv|txt|dat|asc|xyz|pts|dm|parquet|pq)$/i.test(ls.source)) {
        try {
          const mh = await resolveFileHandle(dir, ls.source + '.meta.json');
          const mj = JSON.parse(await (await mh.getFile()).text());
          // size alone cannot tell an edited file from an untouched one — any rewrite
          // preserving the byte count defeated this. The content hash decides when the
          // sidecar has one (a byte-identical copy matches whatever its mtime; a
          // same-size edit doesn't); older sidecars fall back to the mtime, then size.
          // v3: a delimited discovery made under the coordinate rule (a blank coordinate
          // is no record); an older one counted such rows, so it's rebuilt
          const binHdr = mj && mj.header && (mj.header.kind === 'dm' || mj.header.kind === 'parquet');
          if (mj && (mj.v === 4 || ((mj.v === 1 || mj.v === 2) && binHdr)) && sidecarMatches(mj, file, mj.hash ? await sourceHash(file) : null)) {
            sidecar = mj;
            if (mj.header && (mj.header.kind === 'dm' || mj.header.kind === 'parquet')) overR.cached = mj.header;
            else overR.discovered = mj.header;
          }
        } catch { /* no sidecar — full discovery as usual */ }
      }
      const _got = await openBlob(file, basename(ls.source), i === 0 || !S.layers.length ? 'replace' : 'add', null, overR);
      { const Lx = layerById(_got); if (Lx) { Lx.storage = ls.external ? 'external' : 'project'; if (ls.label) Lx.label = ls.label; if (ls.opacity != null && Lx.kind !== 'mesh') { Lx.opacity = ls.opacity; S.renderer.setLayerOpacity(Lx.id, ls.opacity); } if (ls.recHide && ls.recHide.length) Lx._recHide = new Set(ls.recHide); if (ls.legend) Lx.legend = true; if (ls.legendTitle) Lx.legendTitle = ls.legendTitle; if (ls.edges != null) { Lx.edges = ls.edges; S.renderer.setLayerEdges(Lx.id, ls.edges); } if (ls.gtUnits) Lx.gtUnits = ls.gtUnits; } }   // mesh opacity rides overR
      const L = layerById(_got);
      if (!L) { plRow(i, 'failed to open', 'skip'); continue; }   // that open failed; its layer rolled back
      if (ls.drape && L.gridSurface) L._pendingDrape = ls.drape;   // apply after ALL layers land (the drape grid may come later)
      if (sidecar && sidecar.colStats) L._colStats = sidecar.colStats;   // the styling/statistics UIs wake up scanned
      if (sidecar && sidecar.bands) L._bands = sidecar.bands;            // .dm/CSV filter pushdown substrate
      if (ls.colTypes) { L.colTypes = ls.colTypes; applyColTypes(L); }
      if (ls.qualify) { L.qualify = ls.qualify; L._qualFn = undefined; _qualifyReopen.push(L.id); }
      try { await loadElement(L, dir); } catch (e) { (L._colsUnread || (L._colsUnread = [])).push({ name: 'columns', why: e && e.message || String(e) }); }   // ƒ + matcols BEFORE filter/color (both may reference them); never blocks the load, always reported
      if (ls.calcCols && !(L.calcCols || []).length) L.calcCols = ls.calcCols;   // legacy projects (no element manifest)
      if (Array.isArray(ls.catChoices)) L.catChoices = ls.catChoices;
      addPaintColorOptions(L);
      // color channel first (may re-stream), then filter (sweeps), then the rest
      if (ls.colorSel && ls.colorSel !== $('#colorBy').value && [...$('#colorBy').options].some((o) => o.value === ls.colorSel)) {
        L.colorSel = ls.colorSel;
        if (ls.colorSel.startsWith('chan:') && L.docs.blockDoc && +ls.colorSel.slice(5) !== L.docs.blockDoc.header.mapping.chan) {
          const ok = valueTexEligible(L) ? await ensureValueTex(L, ls.colorSel) : null;
          if (ok === null) await reopenBlockChan(L.docs.blockDoc, +ls.colorSel.slice(5), { keepFilter: false });
        }
        if ([...$('#colorBy').options].some((o) => o.value === ls.colorSel)) $('#colorBy').value = ls.colorSel;
      }
      if (String(L.colorSel || '').startsWith('calc:')) { applyRamp(L, true); syncRuleMode(L); }   // realize + color the ƒ channel
      if (ls.clip && (ls.clip[0] || ls.clip[1])) { L.clip = [String(ls.clip[0] || ''), String(ls.clip[1] || '')]; $('#clipMin').value = L.clip[0]; $('#clipMax').value = L.clip[1]; }
      await refilterLayer(L, ls.filter);
      if (ls.visible === false) { L.visible = false; applyTreeVisibility(); }
      if (ls.sectioned != null && ls.sectioned !== true) S.renderer.setLayerSectioned(L.id, ls.sectioned);
      restoreHiddenCats(L, ls.hiddenCats);
      if (ls.ramps) { L.ramps = ls.ramps; applyRamp(L, true); }
      if (ls.catLegend) { L.catLegend = ls.catLegend; applyCatLegend(L, true); }
      await restoreStyleExtras(L, ls);
      idAt[i] = L.id;
      plRow(i, 'done', 'done');
    }
    if (mf.tree) treeFromManifest(mf.tree, idAt);
    ensureDhSetGroups();                                   // pre-set-group projects: solo dh layers get their element group
    applyCamera(mf.camera);
    H.applySection(mf.section);
    // drapes come after ALL layers land — the drape grid may load later than its surface
    for (const L of S.layers) {
      if (!L._pendingDrape) continue;
      const g = S.layers.find((x) => x.name === L._pendingDrape && x.docs && x.docs.gridDoc && x.docs.gridDoc.grid);
      L._pendingDrape = null;
      if (g) { try { recolorSurface(L, g); } catch { /* drape grid gone/incompatible → stays elevation */ } }
    }
    await settleQualifyReopens();                          // stored <x / >x policies: re-read a channel the open coloured by the default
    await loadRecipes(dir);                               // recipes/ *.yaml → Tools → Recipes
    // pinned analysis windows come back configured (after ALL layers landed —
    // series may reference other layers). Run stays manual: no surprise scans.
    for (const L of S.layers) {
      const a = L.analysis;
      if (!a || !a.open || !a.open.length) continue;
      if (a.open.includes('gt')) { try { openGradeTonnage(L); } catch { /* layer no longer qualifies */ } }
      if (a.open.includes('swath')) { try { openSwath(L); } catch { /* same */ } }
      if (a.open.includes('stats')) { try { openStats(L); } catch { /* same */ } }
      if (a.open.includes('xtab')) { try { openCrosstab(L); } catch { /* same */ } }
      if (a.open.includes('xy')) { try { openXyPlot(L); } catch { /* same */ } }
    }
    renderLayers();
    S.project.dirty = false;
    updateProjectTitle();
    rememberProject(dir);
    plEnd();
    $('#meta').textContent = `project “${S.project.name}”${pack ? ' (pack, read-only)' : ''} — ${S.layers.length} layer${S.layers.length === 1 ? '' : 's'}`;
    const unread = S.layers.flatMap((L) => (L._colsUnread || []).map((u) => `${L.label || L.name} · ${u.name}: ${u.why}`));
    if (unread.length) {
      $('#meta').textContent += ` — ${unread.length} stored column${unread.length === 1 ? '' : 's'} not read`;
      microChoose('stored columns not read', `The project opened, but these stored columns could not be read — ${unread.join(' · ')}`, [{ label: 'OK', value: true }]);
    }
    requestRender();
    return true;
  } catch (e) {
    plEnd();
    $('#meta').textContent = `project open failed — ${e.message}`;
    return false;
  }
}

export async function openProjectPicker() {
  if (!S.hasFSAA) return;
  try { await openProjectDir(await pickDirectory()); } catch { /* cancelled */ }
}

// the tab closing (or reloading) with work only this session holds: a dirty
// project, or — without one — any layer carrying its own painted / calculated
// columns. The browser shows its own "leave site?" prompt; nothing else is stopped.
export function unsavedWork() {
  if (S.project) return !!S.project.dirty && !S.project.pack;
  return S.layers.some((L) => (L.paintCols || []).some((c) => c.name !== '_swath') || (L.calcCols || []).length > 0);
}

export function closeProject() { if (S.project && S.project.pack && S.project.pack.abort) S.project.pack.abort.abort(); S.project = null; S.views = []; S.scenes = []; updateProjectTitle(); }

// Tidy: migrate an already-saved project's files into their kind subfolders
// (drillholes / models / clouds / meshes / grids), carrying sidecars along and
// rewriting project.json + the drillhole descriptors. Files are MOVED (not
// copied), confirmed first; external/linked layers stay put.
// ── project backups: the folder as one `<name>-<date>.zip.micro` (src/backup.js) ──
// Made from the FOLDER, so it holds the last save; linked layers (outside the
// folder) aren't in it and are named. Streamed to a picked file (the web), to
// Downloads (the shell) or, for a host, to a stream it hands in — never resident.
// Host calls pass { lean, to, save } and get no dialogs.
export const backupStamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

export function progressMeta(verb) {
  let t = 0;
  return (p) => {
    const now = performance.now(); if (now - t < 200 && p.done < p.total) return; t = now;
    $('#meta').textContent = `${verb}… ${p.total ? Math.round(100 * p.done / p.total) : 100}% · ${p.index + 1}/${p.count} · ${p.path}`;
  };
}

export async function backupProject({ lean = null, to = null, save = null, host = false } = {}) {
  if (!S.project) { if (host) throw new Error('micro: no project is open'); $('#meta').textContent = 'back up: open or save a project first'; return null; }
  if (S.project.dirty) {
    let a = save == null ? null : (save ? 'save' : 'as-is');
    if (a == null && !host) a = await microChoose('back up project', `${S.project.name} has unsaved changes. A backup is made from the project folder, so on its own it holds the last save.`,
      [{ label: 'Cancel', value: null }, { label: 'Back up the last save', value: 'as-is' }, { label: 'Save, then back up', value: 'save' }]);
    if (a == null && !host) return null;
    if (a === 'save') await saveProject();
  }
  const dir = S.project.dir;
  const linked = S.layers.filter((L) => L.storage === 'external').map((L) => L.label || L.name);
  if (lean == null && !host) {
    const inv = await inventoryProject(dir, { lean: true });   // both sizes from one walk
    const n = inv.files.length + inv.skipped.length, full = inv.bytes + inv.skippedBytes;
    const msg = `${S.project.name}: ${n} file${n === 1 ? '' : 's'}, ${fmtSize(full)}.`
      + (inv.skipped.length ? ` Lean leaves out ${inv.skipped.length} cache file${inv.skipped.length === 1 ? '' : 's'} micro rebuilds by itself (${fmtSize(inv.skippedBytes)}); a big model is then re-read once when the project opens.` : '')
      + (linked.length ? ` Not in the backup: ${linked.length} layer${linked.length === 1 ? '' : 's'} linked from outside the folder (${linked.slice(0, 3).join(', ')}${linked.length > 3 ? ', …' : ''}) — to include ${linked.length === 1 ? 'it' : 'them'}, save the project and choose “Copy into project”.` : '');
    const a = await microChoose('back up project', msg, [{ label: 'Cancel', value: null },
      ...(inv.skipped.length ? [{ label: `Lean (${fmtSize(inv.bytes)})`, value: 'lean' }] : []), { label: `Full (${fmtSize(full)})`, value: 'full' }]);
    if (!a) return null;
    lean = a === 'lean';
  }
  const fname = `${S.project.name.replace(/[\/:*?"<>|]+/g, '_')}-${backupStamp()}${BACKUP_EXT}`;
  // the sink: ours to close or abort, whatever is behind it
  let ws = null, parts = null, handle = null;
  try {
    if (to && typeof to.createWritable === 'function') ws = await to.createWritable();
    else if (to && typeof to.getWriter === 'function') ws = to;
    else if (to) throw new Error('micro: backupProject `to` must be a WritableStream or a FileSystemFileHandle');
    else if (host) parts = [];
    else if (shell.present) ws = shell.publishStream(fname, { collection: 'Downloads', mime: BACKUP_MIME });
    else if (window.showSaveFilePicker) {
      handle = await window.showSaveFilePicker({ suggestedName: fname, types: [{ description: 'micro project backup', accept: { [BACKUP_MIME]: ['.micro'] } }] });
      ws = await handle.createWritable();
    } else parts = [];
  } catch (e) { if (e && e.name === 'AbortError') return null; if (host) throw e; $('#meta').textContent = `back up: can't write there — ${e.message || e}`; return null; }
  const wr = ws ? ws.getWriter() : null;
  const sink = wr ? { write: (b) => wr.write(b) } : { write: (b) => { parts.push(b.slice()); } };
  let res;
  try {
    res = await writeBackup(dir, sink, { lean: !!lean, name: S.project.name, build: S.build, linked, onProgress: progressMeta('backing up') });
    if (wr) await wr.close();
  } catch (e) {
    if (wr) { try { await wr.abort(); } catch { /* gone */ } }
    if (host) throw e;
    $('#meta').textContent = `back up failed: ${e.message || e}`; return null;
  }
  const out = { name: handle ? handle.name : fname, size: res.size, files: res.files, lean: !!lean, linked };
  if (ws && ws.result) { try { const r = await ws.result; out.name = r.name || out.name; } catch { /* the shell reports its own */ } }
  if (parts) out.blob = new Blob(parts, { type: BACKUP_MIME });
  if (!host) {
    $('#meta').textContent = `backed up ${S.project.name} → ${out.name} (${fmtSize(res.size)}, ${res.files} files${lean ? ', lean' : ''})${linked.length ? ` · ${linked.length} linked layer${linked.length === 1 ? '' : 's'} not included` : ''}`;
    if (parts) await deliverBlob(out.blob, fname);
  }
  return out;
}

// ── project packs: a .zip.micro opened as the project, read-only, nothing unpacked ──
// Each file is a slice of the pack (src/backup.js openPack). Changes in the session
// — bookmarks, recipes, painted columns — live in memory beside it; Save writes the
// whole project, changes included, into an empty folder and carries on there. A
// slice skips the CRC, so the pack is read through once in the background and the
// verdict goes to the status line (and to a host as micro:pack-checked).
export const pickBackupFile = async () => {
  try {
    if (window.showOpenFilePicker) { const [h] = await window.showOpenFilePicker({ types: [{ description: 'micro project pack', accept: { [BACKUP_MIME]: ['.micro'] } }] }); const f = await h.getFile(); _fileHandles.set(f, h); return f; }
    return await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.micro'; i.onchange = () => res(i.files[0] || null); i.click(); });
  } catch { return null; }
};

export function packSummary(blob, info, members, bytes) {
  const when = info.created ? new Date(info.created).toLocaleString() : 'unknown date';
  const lk = info.linked || [];
  return `${blob.name || 'backup'}: “${info.project || '?'}”, backed up ${when}${info.lean ? ' (lean)' : ''} — ${members.length} files, ${fmtSize(bytes)}.`
    + (lk.length ? ` It doesn't hold ${lk.length} layer${lk.length === 1 ? '' : 's'} that were linked from outside the folder (${lk.slice(0, 3).join(', ')}${lk.length > 3 ? ', …' : ''}); the project will ask where they are.` : '')
    + (S.project && S.project.dirty ? ` This closes ${S.project.name}, which has unsaved changes.` : '');
}

// a .zip.micro opened like any file (drop, Open…, "open with"): look, or unpack
export async function openPackFile(blob) {
  let rb;
  try { rb = await readBackup(blob); } catch (e) { $('#meta').textContent = `open: ${e.message}`; return null; }
  const a = await microChoose('project pack', packSummary(blob, rb.info || {}, rb.members, rb.bytes)
    + ' Open it read-only to look around (nothing is unpacked), or unpack it into an empty folder to work in it.',
    [{ label: 'Cancel', value: null }, ...(S.hasFSAA ? [{ label: 'Unpack to a folder…', value: 'unpack' }] : []), { label: 'Open (read-only)', value: 'open' }]);
  if (a === 'unpack') return restoreProject(blob, null, { asked: true });
  if (a === 'open') return openProjectPack(blob, { asked: true });
  return null;
}

export async function openProjectPack(blob = null, { host = false, asked = false } = {}) {
  const fail = (m) => { if (host) throw new Error(`micro: ${m}`); $('#meta').textContent = `open pack: ${m}`; return null; };
  if (!blob) { blob = await pickBackupFile(); if (!blob) return null; }
  let pack;
  try { pack = await openPack(blob); } catch (e) { return fail(e.message); }
  if (!host && !asked && S.project && S.project.dirty
    && !(await microConfirm('open project pack', `This closes ${S.project.name}, which has unsaved changes.`, 'Open pack', 'Cancel'))) return null;
  if (S.project && S.project.pack && S.project.pack.abort) S.project.pack.abort.abort();
  if (!(await openProjectDir(pack.dir, { pack }))) return fail($('#meta').textContent.replace(/^project open failed — /, '') || 'the project in the pack did not open');
  updateProjectTitle();
  { const h = !host && _fileHandles.get(blob); if (h) rememberPack(h, pack.dir.name); }
  pack.abort = new AbortController();
  pack.check = pack.verify({ signal: pack.abort.signal }).then((v) => {
    pack.checked = v;
    dispatchEvent(new CustomEvent('micro:pack-checked', { detail: { name: blob.name || pack.dir.name, ok: v.ok, files: v.files, bad: v.bad } }));
    if (!S.project || S.project.pack !== pack) return v;
    if (v.ok) $('#meta').textContent = `pack checked — ${v.files} files intact`;
    else {
      $('#meta').textContent = `pack DAMAGED — ${v.bad.length} file${v.bad.length === 1 ? '' : 's'} fail their checksum: ${v.bad.map((b) => b.path).slice(0, 3).join(', ')}${v.bad.length > 3 ? ', …' : ''}`;
      if (!host) microChoose('project pack damaged', `${v.bad.length} of the ${v.files} files in ${blob.name || 'the pack'} don't match the checksum they were written with, so what micro shows from them may be wrong: ${v.bad.map((b) => b.path).join(', ')}.`, [{ label: 'OK', value: true }]);
    }
    return v;
  }, (e) => { if (e && e.name !== 'AbortError') $('#meta').textContent = `pack check failed — ${e.message || e}`; return null; });
  return { name: pack.dir.name, files: pack.members.length, bytes: pack.bytes, info: pack.info, checked: pack.check };
}

// Save on a pack: the whole tree (the pack's files + this session's changes) into
// an empty folder, which then becomes the project; a normal save writes the rest
export async function savePackAsFolder({ dest = null, host = false } = {}) {
  const pack = S.project.pack;
  if (!dest && !S.hasFSAA) { $('#meta').textContent = "save: a project pack is read-only here — this browser can't write project folders"; return null; }
  if (!host && !dest) {
    const ok = await microChoose('save project', `${S.project.name} is a project pack, opened read-only. To keep your changes, save it as a project folder: pick an empty folder and micro writes the whole project there (${fmtSize(pack.bytes)}), then carries on working in it. The pack itself stays as it is.`,
      [{ label: 'Cancel', value: false }, { label: 'Choose folder…', value: true }]);
    if (!ok) return null;
  }
  if (!dest) { try { dest = await pickDirectory(); } catch { return null; } }
  const src = S.project.dir;
  try { await writeTree(src, dest, { onProgress: progressMeta('saving the pack as a folder') }); }
  catch (e) { if (host) throw e; $('#meta').textContent = `save failed — ${e.message || e}`; return null; }
  // the layers' files are now in dest: point them there, and say they're micro's copies
  for (const L of S.layers) {
    for (const fd of layerFiles(L)) _copiedBlobs.add(fd.blob);
    if (L.handle && L.handle._pack && L.handle._path) { try { L.handle = await resolveFileHandle(dest, L.handle._path.join('/')); } catch { /* triage finds it by path */ } }
  }
  if (pack.abort) pack.abort.abort();
  S.project = { dir: dest, name: dest.name, dirty: true };
  updateProjectTitle();
  await saveProject();
  rememberProject(dest);
  return { name: dest.name };
}

// restore: a .zip.micro → an EMPTY folder → opened as the project
export async function restoreProject(blob = null, dest = null, { host = false, asked = false } = {}) {
  const fail = (m) => { if (host) throw new Error(`micro: ${m}`); $('#meta').textContent = `restore: ${m}`; return null; };
  if (!dest && !S.hasFSAA) return fail("this browser can't write project folders");
  if (!blob) { blob = await pickBackupFile(); if (!blob) return null; }
  let rb;
  try { rb = await readBackup(blob); } catch (e) { return fail(e.message); }
  if (!host && !asked) {
    if (!(await microChoose('restore project', packSummary(blob, rb.info || {}, rb.members, rb.bytes) + ' Next, pick an empty folder to restore it into.',
      [{ label: 'Cancel', value: false }, { label: 'Choose folder…', value: true }]))) return null;
  }
  if (!dest) { try { dest = await pickDirectory(); } catch { return null; } }
  let res;
  try { res = await restoreBackup(blob, dest, { onProgress: progressMeta('restoring') }); } catch (e) { return fail(e.message || String(e)); }
  await openProjectDir(dest);
  if (S.hasFSAA) rememberProject(dest);
  if (!host) $('#meta').textContent = `restored ${(rb.info && rb.info.project) || 'the project'} into ${dest.name} (${res.files} files, ${fmtSize(res.bytes)})`;
  return { name: dest.name, files: res.files, bytes: res.bytes, info: rb.info };
}

export async function tidyProject() {
  if (!S.project) { $('#meta').textContent = 'tidy: save the project to a folder first'; return; }
  const dir = S.project.dir;
  const ok = await microConfirm('Tidy project folder',
    'Move each layer file into its kind subfolder (drillholes / models / clouds / meshes / grids), carry its sidecars along, and rewrite project.json. Files are moved, not copied. External/linked layers stay where they are.',
    'Tidy', 'Cancel');
  if (!ok) return;
  try {
    if (dir.requestPermission && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') { $('#meta').textContent = 'tidy: write permission denied'; return; }
    let moved = 0, collided = 0;
    const claimed = new Map();                                      // target path → the curRel that took it, this pass
    for (const L of S.layers) {
      if (L.storage !== 'project') continue;
      for (const fd of layerFiles(L)) {
        const target = relPathFor(L, fd.name);
        let curRel = null;                                          // where the file is now
        if (!L.dh && L.handle && dir.resolve) { try { const p = await dir.resolve(L.handle); if (p) curRel = p.join('/'); } catch { /* not a descendant */ } }
        if (!curRel) { for (const c of [target, basename(fd.name)]) { try { await resolveFileHandle(dir, c); curRel = c; break; } catch { /* not there */ } } }
        if (!curRel || curRel === target) { if (curRel === target) claimed.set(target, curRel); continue; }   // not found, or already placed
        // two layers of the same kind sharing a basename would land on ONE path —
        // the second used to OVERWRITE the first's just-moved file (data loss).
        // Refuse the collision, leave the file where it is, and report it.
        const taken = claimed.get(target);
        if (taken != null && taken !== curRel) { collided++; $('#meta').textContent = `tidy: “${basename(fd.name)}” collides in ${target.split('/')[0]}/ — left in place`; continue; }
        claimed.set(target, curRel);
        // STREAMED copy (pipeTo closes the writable): a whole-file read here failed
        // outright on a multi-GB source, part-way through tidying the folder
        const srcFile = await (await resolveFileHandle(dir, curRel)).getFile();
        const nh = await resolveFileHandle(dir, target, { create: true });
        await srcFile.stream().pipeTo(await nh.createWritable());
        if (!L.dh) L.handle = nh;
        for (const suf of ['.meta.json', '.disp.grd', '.disp.json']) {   // sidecars ride along
          try {
            const sf = await (await resolveFileHandle(dir, curRel + suf)).getFile();
            const sh = await resolveFileHandle(dir, target + suf, { create: true });
            await sf.stream().pipeTo(await sh.createWritable());
            await removeFileAt(dir, curRel + suf);
          } catch { /* no such sidecar */ }
        }
        await removeFileAt(dir, curRel);
        moved++;
      }
    }
    markProjectDirty();
    await saveProject();                                            // rewrites project.json + writes descriptors at the new paths
    $('#meta').textContent = (moved ? `project tidied — ${moved} file${moved === 1 ? '' : 's'} moved into kind folders` : 'project already tidy')
      + (collided ? ` · ${collided} left in place (name collision — rename to move)` : '');
  } catch (e) { $('#meta').textContent = `tidy failed — ${e.message}`; }
}

// Folder-as-inbox: rescan the project folder for data files dropped in by hand
// or by another tool, and add the ones not already loaded. A .holes.json is a
// complete drillhole set (loaded directly); other data files go through the
// normal open dialog (header detection + mapping + loose-trio sniff). The
// containing kind folder is the intended type hint; open-dispatch is by content.
export async function scanFolderForNewData() {
  if (!S.project) { $('#meta').textContent = 'scan: open or save a project first'; return; }
  const dir = S.project.dir;
  try {
    if (dir.requestPermission && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') { $('#meta').textContent = 'scan: permission denied'; return; }
    // what current layers already use: name:size (file identity) + the resolved
    // path of each layer's handle (set at push time, so it holds even while a
    // block model is still discovering and its blob isn't populated yet)
    const referenced = new Set(), refPaths = new Set();
    for (const L of S.layers) {
      for (const fd of layerFiles(L)) if (fd.blob) referenced.add(basename(fd.name) + ':' + fd.blob.size);
      if (L.handle && dir.resolve) { try { const pp = await dir.resolve(L.handle); if (pp) refPaths.add(pp.join('/')); } catch { /* not a descendant */ } }
    }
    const found = [];
    const walk = async (d, prefix) => {
      for await (const [name, h] of d.entries()) {
        const p = prefix ? prefix + '/' + name : name;
        if (h.kind === 'directory') await walk(h, p);
        else found.push({ path: p, name, handle: h });
      }
    };
    await walk(dir, '');
    // a sidecar is not new data: element manifests, the cache sidecars, and
    // ANYTHING inside a `<layer>.cols/` folder (the materialized-column Parquets).
    // Without the .cols rule an orphaned matcol fragment — left behind by a tidy
    // or a layer removal — was re-offered to the user as a top-level data layer.
    const isSidecar = (fullPath, n) => n === 'project.json'
      || /(\.meta\.json|\.disp\.grd|\.disp\.json|\.element\.json)$/i.test(n)
      || /\.cols\//i.test(fullPath);
    const isData = (n) => /\.(las|ply|xyz|pts|csv|txt|dat|parquet|pq|dm|obj|msh|lfm|tif|tiff|grd|asc)$/i.test(n);
    // new drillhole-set descriptors (claim their member CSVs so they don't also
    // show up as loose files)
    const claimed = new Set();
    const newSets = [];
    found.sort((a, b2) => /\.element\.json$/i.test(b2.name) - /\.element\.json$/i.test(a.name));   // element first: it claims the files an old .holes.json would re-offer
    for (const e of found) {
      if (!/\.(holes|element)\.json$/i.test(e.name)) continue;
      let desc;
      try {
        const raw = JSON.parse(await (await e.handle.getFile()).text());
        desc = /\.element\.json$/i.test(e.name) ? descFromElement(raw) : (raw && raw.kind === 'drillholes' ? raw : null);
      } catch { continue; }
      if (!desc) continue;
      const setDir = e.path.split('/').slice(0, -1).join('/');
      if (claimed.has(joinPath(setDir, desc.collar))) continue;   // the element manifest already owns this set
      const ivs = Array.isArray(desc.intervals) ? desc.intervals : [desc.intervals];
      claimed.add(joinPath(setDir, desc.collar)); claimed.add(joinPath(setDir, desc.survey));
      for (const iv of ivs) claimed.add(joinPath(setDir, iv));
      if (S.layers.some((L) => L.dh && L._setPath === e.path)) continue;   // already loaded
      newSets.push({ e, desc, setDir, ivs });
    }
    // loose data files not referenced by a layer and not part of a descriptor
    const looseFiles = [];
    for (const e of found) {
      if (!isData(e.name) || isSidecar(e.path, e.name) || claimed.has(e.path) || refPaths.has(e.path)) continue;
      const file = await e.handle.getFile();
      if (referenced.has(basename(e.name) + ':' + file.size)) continue;
      _fileHandles.set(file, e.handle);                       // so opened layers ride the folder handle (no re-copy)
      looseFiles.push(file);
    }
    // load complete drillhole sets directly (no decisions needed)
    for (const s of newSets) {
      try {
        const collar = await resolveDhFile(dir, s.setDir, s.desc.collar);
        const survey = await resolveDhFile(dir, s.setDir, s.desc.survey);
        const ids = [];
        for (const iv of s.ivs) {                            // one dh layer per interval table, sharing the set
          const intervals = await resolveDhFile(dir, s.setDir, iv);
          const _got = await openDrillholeLayer({ collar, survey, intervals }, s.desc.config || {}, S.layers.length ? 'add' : 'replace');
          const L = layerById(_got); if (L) { L.storage = 'project'; L._setPath = s.e.path; L._setKey = s.e.path; L._intervalName = iv; ids.push(L.id); }
        }
        if (ids.length) createLayerGroup(dhGroupName(s.desc.collar), ids, { collapsed: false, dhSet: true });
      } catch (err) { $('#meta').textContent = `scan: “${s.e.name}” — ${err.message}`; }
    }
    if (looseFiles.length) await openFilesDialog(looseFiles);   // the dialog is the confirmation for loose files
    const nRcp = S.recipes.length;
    await loadRecipes(dir);                                 // recipes dropped into recipes/ arrive via the same inbox
    const rcpNew = S.recipes.length - nRcp;
    const total = newSets.length + looseFiles.length + Math.max(0, rcpNew);
    if (!total) $('#meta').textContent = 'scan: no new data files in the folder';
    else { markProjectDirty(); if (!looseFiles.length) $('#meta').textContent = `scan: added ${[newSets.length ? `${newSets.length} drillhole set${newSets.length === 1 ? '' : 's'}` : '', rcpNew > 0 ? `${rcpNew} recipe${rcpNew === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ') || 'nothing'}`; }
  } catch (e) { $('#meta').textContent = `scan failed — ${e.message}`; }
}

// File → New project: back to the empty slate. Confirmed — it closes every
// layer and drops the project link; nothing on disk is touched.
export async function newProject() {
  if (!S.layers.length && !S.project) { $('#meta').textContent = 'already a fresh slate'; return; }
  const parts = [];
  if (S.layers.length) parts.push(`${S.layers.length} layer${S.layers.length === 1 ? '' : 's'}`);
  if (S.project) parts.push(`the project link (${S.project.name})`);
  const warn = S.project && S.project.dirty ? ' Unsaved project changes will be lost.' : '';
  if (!(await microConfirm('new project', `This closes ${parts.join(' and ')}.${warn} Files on disk are untouched.`))) return;
  closeAllLayers();
  closeProject();
  if ($('#secMode').value !== 'off') { $('#secMode').value = 'off'; $('#secMode').dispatchEvent(new Event('input')); }
  $('#empty').style.display = '';
  $('#meta').textContent = 'new project';
  requestRender();
}
