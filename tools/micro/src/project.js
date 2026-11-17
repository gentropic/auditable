// micro — the PROJECT lifecycle: a project is a folder of readable files plus project.json.
// Save writes the manifest and copies sources in; open restores every layer from it;
// close and new. A project as one file (backup, packs, restore) is src/project-pack.js,
// what a save optimizes first is src/optimize.js, keeping the folder in its by-kind
// layout (tidy, scan for new data) is src/project-folder.js, and the remembered
// projects are src/recents.js.
import { S, _fileHandles, activeLayer, layerById, requestRender } from './state.js';
import { applyColTypes, attrRowCountOf, layerHeaderOf, layerTableHeader } from './records.js';
import { basename, fmtSize, joinPath, kindDir, layerBytes, layerFiles, layerRelpath, relPathFor, resolveDhFile, resolveFileHandle } from './paths.js';
import { microModelOf } from './lineage.js';
import { _qualifyReopen, settleQualifyReopens } from './coltypes.js';
import { addPaintColorOptions } from './paint.js';
import { ruleModeOf, runRules, syncRuleMode } from './rules.js';
import { applyCatLegend, restoreHiddenCats } from './categories.js';
import { applyRamp } from './ramp.js';
import { setColOf, structureAfterEdit } from './structure-ui.js';
import { colStatsComplete, ensureSourceHash, holdStoredValues, isStoredCat, matColSourceHash, paintRecount, scanColumns } from './columns.js';
import { _idb, loadElement, persistElement } from './element-store.js';
import { buildDhSetManifest, descFromElement, dhElementName } from './manifest.js';
import { sameSource, sidecarMatches, sourceHash, staleWhy } from './identity.js';
import { zonesToJSON } from '../../../ext/condenser/src/main.js';
import { readSurferGrd } from './grid-io.js';
import { loadRecipes } from './recipes.js';
import { openGradeTonnage } from './gt.js';
import { openSwath } from './swath.js';
import { openStats } from './stats.js';
import { openCrosstab } from './xtab.js';
import { openXyPlot } from './xyplot.js';
import { menuXY } from './menu.js';
import { microChoose, microConfirm } from './prompts.js';
import { openBlob, openDrillholeLayer, reopenDhChan } from './open.js';
import { reopenBlockChan } from './open-blocks.js';
import { CONTEXT_TRI_CAP } from './open-mesh.js';
import { applyHoleFilter, ensureDhSetGroups, restoreSetDerived, noteCollarStyle } from './drillholes.js';
import { applyTreeVisibility, treeFromManifest, treeToManifest, followLayer } from './tree.js';
import { renderLayers } from './layers-panel.js';
import { captureLayerSurface, recolorSurface } from './surfaces.js';
import { ensureValueTex, valueTexEligible, valueTexWant } from './color.js';
import { flushViewsScenes, loadViewsScenes } from './views.js';
import { writeGridDisplayCache } from './meshexport.js';
import { pickDirectory, rehydrateHandle } from './hostio.js';
import { refilterLayer } from './filter.js';
import { createView, applyViewColor, canView } from './layerviews.js';
import { viewCatData } from './viewcat.js';
import { closeAllLayers } from './layers.js';
const $ = (s) => document.querySelector(s);
import { applyCamera, captureCamera } from './camera.js';
import { applyLayerSelection } from './selection.js';
import { applySection, captureSection } from './section.js';
import { rememberProject, PROJECTS_KEY } from './recents.js';
import { savePackAsFolder } from './project-pack.js';
import { maybeAutoOptimize, maybeAutoPackMeshes } from './optimize.js';

export function markProjectDirty() {
  if (!S.project) return;
  S.project.dirtyGen = (S.project.dirtyGen || 0) + 1;     // an edit DURING a save must survive the save marking clean
  if (!S.project.dirty) { S.project.dirty = true; updateProjectTitle(); }
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

// the layers that ARE files — what a save copies, references and indexes. A
// view (src/layerviews.js) is display state over its model's file: its entry in
// project.json says whose, and what it shows.
export const fileLayers = () => S.layers.filter((L) => L.viewOf == null && !L.collarOf);   // a view is its model's file; collars are the set's

// a view's entry: its model (by manifest index) + its display — never data
function viewEntry(L, indexOf) {
  return {
    viewOf: indexOf.get(L.viewOf), name: L.name, label: L.label,
    colorSel: L.colorSel, catCol: L.catCol || undefined, offset: L.offset || undefined,
    clip: L.clip, filter: L.filterExpr || '', visible: L.visible,
    sectioned: (() => { const m = S.renderer.layerSectioned(L.id); return m === true ? undefined : m; })(),
    opacity: (L.opacity != null && L.opacity !== 1) ? L.opacity : undefined,
    edges: L.edges != null ? L.edges : undefined,
    legend: L.legend || undefined, legendTitle: (L.legendTitle && L.legendTitle.trim()) || undefined,
    recHide: (L._recHide && L._recHide.size) ? [...L._recHide] : undefined,
    gtUnits: L.gtUnits || undefined, analysis: L.analysis || undefined,
    hiddenCats: L.catHidden && L.catHidden.size
      ? [...L.catHidden].map((c) => { const vc = viewCatData(L), h2 = layerHeaderOf(L), dict = vc ? vc.names : h2 && h2.categories; return dict && dict[c] != null ? dict[c] : c; })
      : undefined,
    holeFilter: (L.dh && L.holeFilter) || undefined,
    ramps: L.ramps && Object.keys(L.ramps).length ? L.ramps : undefined,
    catLegend: L.catLegend || undefined,
    rules: L.rules && L.rules.list && L.rules.list.length ? L.rules : undefined,
    ruleHidden: L.ruleHidden && L.ruleHidden.size ? [...L.ruleHidden] : undefined,
  };
}

export function projectManifest() {
  const listed = S.layers.filter((L) => !L.derivedOf && !L.collarOf && !L.trace && (L.viewOf == null || layerById(L.viewOf)));   // traces and collars: the set remembers them
  for (const L of S.layers) if (L.collarOf) noteCollarStyle(L);   // the set remembers how its collars look
  const indexOf = new Map(listed.map((L, i) => [L.id, i]));
  return {
    app: 'micro', version: 1, name: S.project.name,
    layers: listed.map((L) => L.viewOf != null ? viewEntry(L, indexOf) : ({
      source: L._relpath || L.name,
      dh: L.dh && L.docs.dhDoc ? (L._setPath ? { set: L._setPath, interval: L._intervalName } : {
        collar: basename(layerFiles(L)[0].name), survey: basename(layerFiles(L)[1].name), intervals: basename(layerFiles(L)[2].name),
        config: L.docs.dhDoc.config,
      }) : undefined,
      label: L.label && L.label !== L.name ? L.label : undefined,
      external: L.storage === 'external' || undefined,
      colorSel: L.colorSel, clip: L.clip, filter: L.filterExpr || '', visible: L.visible,
      offset: L.offset || undefined,                       // drawn displaced (an exploded view) — display only
      catChoices: L.catChoices && L.catChoices.length ? L.catChoices : undefined,
      sectioned: (() => { const m = S.renderer.layerSectioned(L.id); return m === true ? undefined : m; })(),
      kind: (L.kind === 'mesh' && !L.gridSurface) ? 'mesh'
        : L.kind === 'table' ? 'table'
          : L.docs.stringsDoc ? (L.docs.stringsDoc.header.kind === 'strings' ? 'strings' : 'dxf-points') : undefined,
      sheet: L._sheet || undefined,                        // an xlsx layer reopens THIS worksheet   // a grid-surface is kind 'mesh' but reopens as a grid (gridSurface flag)
      tint: L.kind === 'mesh' ? L.tint : undefined,
      opacity: (L.opacity != null && L.opacity !== 1) ? L.opacity : undefined,   // any kind (mesh/blocks/drillholes)
      pointScale: S.renderer.layerPointScale(L.id) !== 1 ? S.renderer.layerPointScale(L.id) : undefined,   // a points layer's glyph size
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
      // the RLE paint + selection above are POSITIONAL (record i → value i): the
      // source they were made on, so a reopen over different rows refuses them
      recordsAt: (L._selMask && L._selCount) || (L.paintCols && L.paintCols.some((c) => !c.mat && !isStoredCat(c))) ? matColSourceHash(L) : undefined,
      lineage: L.lineage || undefined,                     // provenance chain (how this layer was made)
      // parsing intent: the column mapping (incl. a re-keyed category) —
      // indices are stable because the file rides in the project. .dm too:
      // its restore threads mapping through openDmBlob (chan + cat honored).
      mapping: L.docs.blockDoc ? L.docs.blockDoc.header.mapping : undefined,
    })),
    camera: captureCamera(),
    section: captureSection(),
    // bookmarks + scenes now live as files in bookmarks/ and scenes/ (not in
    // project.json) — see flushViewsScenes / loadViewsScenes
    tree: (() => {                                         // groups (§4.1) — layers by manifest index
      return treeToManifest(indexOf);                      // layers by the same index as layers: above
    })(),
  };
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
    { label: `Copy “${L.name}”${L.dh ? ' (collar + survey + intervals)' : ''} (${fmtSize(layerBytes(L))}) into ${S.project.name}/`, action: async () => { $('#meta').textContent = `copying ${L.name}…`; try { await copyLayerIn(L, S.project.dir); } catch (e) { $('#meta').textContent = `copied ${L.name}, but its columns did NOT save — ${e.message}; save the project again`; markProjectDirty(); renderLayers(); return; } markProjectDirty(); $('#meta').textContent = `copied ${L.name} into the project (${fmtSize(layerBytes(L))})`; renderLayers(); } },
    { label: 'Cancel', action: () => {} },
  ]), 0);
}

export async function copyLayerIn(L, dir) {
  // a loose layer's stored columns live in browser storage, keyed by the loose
  // identity; once it is a project layer they are read from the folder. Load and
  // hold them across the switch, and write them at the new home right away.
  const hold = await holdStoredValues(L);
  try { await copyLayerFiles(L, dir); } finally { hold.release(); }
  renderLayers();
}
async function copyLayerFiles(L, dir) {
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
  if (S.project && S.project.dir === dir && (layerTableHeader(L) || (L.docs && L.docs.gridDoc))) await persistElement(L);   // throws → the caller reports it
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
  // a save can MOVE stored columns (optimize, pack, copy-in, a first persist):
  // every materialized column stays resident until the save is done
  const holds = [];
  try {
    for (const L of fileLayers()) holds.push(await holdStoredValues(L));
    return await saveProjectInner();
  } finally { for (const h of holds) h.release(); }
}
async function saveProjectInner() {
  const dir = S.project.dir;
  try {
    if (dir.requestPermission && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') { $('#meta').textContent = 'project: write permission denied'; return; }
    await maybeAutoOptimize();                              // reorder block models to spatial Parquet BEFORE triage, so the parquet is what's referenced/copied
    await maybeAutoPackMeshes();                            // and meshes/strings/pegs into meshes/*.wfr (written in place, so triage sees them in-project)
    // A just-optimized layer's bytes are now Parquet but its handle was dropped
    // (convertLayerToParquet). Write the Parquet INTO the project + delete the old
    // source here — so triage sees a clean in-project layer (no spurious "copy
    // outside files in?" prompt) and the folder shows the .parquet only.
    for (const L of fileLayers()) {
      if (!L.memoryOnly) continue;
      const orphan = L._optimizedOrphan;
      L._optimizedOrphan = null;
      try {
        await copyLayerIn(L, dir);                          // writes models/<name>.parquet, sets L.handle + storage 'project'
        L.memoryOnly = false;
        const segs = orphan && dir.resolve ? await dir.resolve(orphan) : null;
        const keep = await layerRelpath(L, dir);
        if (segs && segs.length && segs.join('/') !== keep) {
          let d = dir; for (let i = 0; i < segs.length - 1; i++) d = await d.getDirectoryHandle(segs[i]);
          const leaf = segs[segs.length - 1];
          await d.removeEntry(leaf);                         // drop the pre-optimize CSV/.dm
          try { await d.removeEntry(leaf + '.meta.json'); } catch { /* no sidecar */ }   // + its derived-cache sidecar
        }
      } catch { /* falls back to normal triage; an orphan is harmless clutter */ }
    }
    const outside = [], mustCopy = [];
    for (const L of fileLayers()) {
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
      if (allIn) L.memoryOnly = false;
      else if (L.memoryOnly) mustCopy.push(L);             // bytes made in this session: nothing on disk to link to
      else outside.push(L);
    }
    for (const L of mustCopy) {
      $('#meta').textContent = `project: writing ${L.name}…`;
      await copyLayerIn(L, dir); L.memoryOnly = false;
    }
    if (outside.length && await askCopyOutside(outside) === 'copy') {
      for (const L of outside) { $('#meta').textContent = `project: copying ${L.name}…`; await copyLayerIn(L, dir); }
    }
    // record each layer's real path for the manifest + write the drillhole-set
    // descriptor (the one compound load: three CSVs + desurvey config → .holes.json)
    for (const L of fileLayers()) {
      L._relpath = undefined; L._setPath = undefined;
      if (L.storage === 'external') { L._relpath = basename(L.name); continue; }
      if (L.storage !== 'project') continue;
      if (!L.dh) L._relpath = await layerRelpath(L, dir);
    }
    // drillhole sets: group dh layers by _setKey → ONE .holes.json per set with
    // an intervals[] array (multiple interval tables share one collar+survey)
    const dhGroups = new Map();
    for (const L of fileLayers()) {
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
    for (const L of fileLayers()) { try { await writeGridDisplayCache(L, dir); } catch { /* cache, never a failure */ } }
    // the element manifest + its columns: NOT derived — paint is hand-brushed, a
    // calc is authored, a join brought another file's values. A failure here is
    // reported (and the project stays unsaved), never swallowed.
    const colFails = [];
    const genAtPersist = S.project.dirtyGen || 0;          // edits after this point are NOT in what gets written
    for (const L of fileLayers()) {
      if (!(layerTableHeader(L) || (L.docs && L.docs.gridDoc))) continue;
      try { await persistElement(L); } catch (e) { colFails.push(`${L.label || L.name}: ${e && e.message || e}`); }
    }
    // derived-cache sidecars (spec section 12): the discovery header + column
    // stats + BAND min/max travel WITH the data — reopening skips the discovery
    // sweep, the styling/statistics UIs wake up already scanned, and .dm filters
    // get parquet-style pushdown (bands prove page-runs can't match). Built here
    // when missing — the one full read per file, ever (size-keyed). CSV + .dm +
    // parquet all get one; parquet skips bands (its footer already has them).
    for (const L of fileLayers()) {
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
    // columns that didn't save, or an edit made while the save ran (the long
    // indexing pass after persist): still unsaved work
    S.project.dirty = colFails.length > 0 || (S.project.dirtyGen || 0) !== genAtPersist;
    updateProjectTitle();
    renderLayers();
    rememberProject(dir);                                  // refresh the stored links alongside
    const ext = fileLayers().filter((L) => L.storage === 'external').length;
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
// a view (src/layerviews.js) over a model this load opened: its display state,
// in the order the model's own restore uses (filter, then colour, then the rest)
async function restoreView(ls, i, idAt) {
  plRow(i, 'loading…');
  const M = layerById(idAt[ls.viewOf]);
  if (!M || !canView(M)) { plRow(i, 'skipped — its layer did not open', 'skip'); return; }
  let V;
  try {
    V = await createView(M, { name: ls.name, label: ls.label, colorSel: ls.colorSel, catCol: ls.catCol, offset: ls.offset, clip: ls.clip, visible: ls.visible,
      opacity: ls.opacity, edges: ls.edges, ramps: ls.ramps, catLegend: ls.catLegend }, { activate: false, apply: false });
  } catch (e) { plRow(i, `skipped — ${e.message}`, 'skip'); return; }
  if (ls.holeFilter) { try { await applyHoleFilter(V, ls.holeFilter); } catch { /* collar missing → no mask */ } }
  await refilterLayer(V, ls.filter);
  if (ls.sectioned != null && ls.sectioned !== true) S.renderer.setLayerSectioned(V.id, ls.sectioned);
  try { await applyViewColor(V); } catch (e) { (M._colsUnread || (M._colsUnread = [])).push({ name: `view “${V.label}” colour`, why: e.message }); }
  restoreHiddenCats(V, ls.hiddenCats);                     // after the colour: a view's own classes exist once its column is read
  if (ls.legend) V.legend = true;
  if (ls.legendTitle) V.legendTitle = ls.legendTitle;
  if (ls.recHide) V._recHide = new Set(ls.recHide);
  await restoreStyleExtras(V, ls);
  idAt[i] = V.id;
  plRow(i, 'done', 'done');
}

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
  // positional state saved on another version of the source (edited on disk,
  // same row count or not) would land on the wrong records: refuse it, say so
  let positionalOk = true;
  if (ls.recordsAt && (ls.paintCols || ls.sel)) {
    await ensureSourceHash(L);
    const cur = matColSourceHash(L);
    if (!sameSource(ls.recordsAt, cur)) {
      positionalOk = false;
      const what = [...(ls.paintCols || []).map((c) => c.name), ...(ls.sel ? ['the selection'] : [])].join(', ');
      (L._colsUnread || (L._colsUnread = [])).push({ name: what, why: `${staleWhy(ls.recordsAt, cur)} — painted per record on the old file` });
    }
  }
  if (ls.paintCols && positionalOk) {
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
  if (ls.sel && positionalOk) { L._selMask = rleDecode(ls.sel, attrRowCountOf(L)); applyLayerSelection(L); }
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
    nm.textContent = ls.viewOf != null ? `view · ${ls.label || ls.name}` : ls.dh ? (ls.dh.collar ? `${ls.dh.collar} + survey + intervals` : basename(ls.dh.set || 'drillhole set')) : ls.source;
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
    const viewRows = [];                                   // views open after every model has
    for (let i = 0; i < mf.layers.length; i++) {
      const ls = mf.layers[i];
      if (ls.viewOf != null) { viewRows.push(i); continue; }
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
          if (Array.isArray(ls.offset) && ls.offset.some((v) => +v)) { Ld.offset = ls.offset.map(Number); S.renderer.setLayerOffset(Ld.id, Ld.offset); }
          restoreHiddenCats(Ld, ls.hiddenCats);
          if (ls.ramps) { Ld.ramps = ls.ramps; applyRamp(Ld, true); }
          if (ls.catLegend) { Ld.catLegend = ls.catLegend; applyCatLegend(Ld, true); }
          if (Array.isArray(ls.catChoices)) { Ld.catChoices = ls.catChoices; addPaintColorOptions(Ld); }
          if (ls.colorSel && [...$('#colorBy').options].some((o) => o.value === ls.colorSel)) { Ld.colorSel = ls.colorSel; $('#colorBy').value = ls.colorSel; syncRuleMode(Ld); }
          let Lc = Ld;                                   // an interval column the sticks don't carry: its value texture
          if (String(ls.colorSel || '').startsWith('chan:') && +ls.colorSel.slice(5) !== Ld.docs.dhDoc.header.mapping.chan) {
            const ok = valueTexEligible(Ld) ? await ensureValueTex(Ld, ls.colorSel) : null;
            if (ok === null) Lc = (await reopenDhChan(+ls.colorSel.slice(5), Ld)) && layerById(followLayer(Ld.id)) || Ld;
          }
          await restoreStyleExtras(Lc, ls);
          idAt[i] = Lc.id;
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
        // the dropdown first: an ACTIVE layer's colour is read from it, and a texture
        // that finishes against the old value is discarded as superseded
        if (L.id === S.activeId) $('#colorBy').value = ls.colorSel;
        if (ls.colorSel.startsWith('chan:') && valueTexWant(L, ls.colorSel) != null) {   // a column the chunks don't carry (a cloud: any column)
          const ok = valueTexEligible(L) ? await ensureValueTex(L, ls.colorSel) : null;
          if (ok === null && L.docs.blockDoc && +ls.colorSel.slice(5) !== L.docs.blockDoc.header.mapping.chan) await reopenBlockChan(L.docs.blockDoc, +ls.colorSel.slice(5), { keepFilter: false });
        }
        if ([...$('#colorBy').options].some((o) => o.value === ls.colorSel)) $('#colorBy').value = ls.colorSel;
      }
      if (String(L.colorSel || '').startsWith('calc:')) { applyRamp(L, true); syncRuleMode(L); }   // realize + color the ƒ channel
      if (ls.clip && (ls.clip[0] || ls.clip[1])) { L.clip = [String(ls.clip[0] || ''), String(ls.clip[1] || '')]; $('#clipMin').value = L.clip[0]; $('#clipMax').value = L.clip[1]; }
      await refilterLayer(L, ls.filter);
      if (ls.visible === false) { L.visible = false; applyTreeVisibility(); }
      if (ls.sectioned != null && ls.sectioned !== true) S.renderer.setLayerSectioned(L.id, ls.sectioned);
      if (ls.pointScale) { S.renderer.setLayerPointScale(L.id, ls.pointScale); L.pointScale = ls.pointScale; }
      if (Array.isArray(ls.offset) && ls.offset.some((v) => +v)) { L.offset = ls.offset.map(Number); S.renderer.setLayerOffset(L.id, L.offset); }
      restoreHiddenCats(L, ls.hiddenCats);
      if (ls.ramps) { L.ramps = ls.ramps; applyRamp(L, true); }
      if (ls.catLegend) { L.catLegend = ls.catLegend; applyCatLegend(L, true); }
      await restoreStyleExtras(L, ls);
      idAt[i] = L.id;
      plRow(i, 'done', 'done');
    }
    for (const i of viewRows) await restoreView(mf.layers[i], i, idAt);
    if (mf.tree) treeFromManifest(mf.tree, idAt);
    ensureDhSetGroups();                                   // pre-set-group projects: solo dh layers get their element group
    await restoreSetDerived();                             // each set's traces and collars, as they were shown
    applyCamera(mf.camera);
    applySection(mf.section);
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
