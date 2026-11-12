// micro — keeping a project FOLDER in its by-kind layout: tidy a flat (legacy) project
// into kind subfolders, and scan the folder for data dropped in by hand or by another
// tool (the folder as an inbox).
import { S, _fileHandles, layerById } from './state.js';
import { microConfirm } from './prompts.js';
import { layerFiles, relPathFor, basename, resolveFileHandle, removeFileAt, joinPath, resolveDhFile } from './paths.js';
import { markProjectDirty, saveProject } from './project.js';
import { descFromElement } from './manifest.js';
import { openDrillholeLayer } from './open.js';
import { createLayerGroup } from './tree.js';
import { dhGroupName, openFilesDialog } from './open-dialog.js';
import { loadRecipes } from './recipes.js';
const $ = (s) => document.querySelector(s);

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
