// micro RECIPE LIBRARY — recipes and routines outside any project (routines v2; decided with Arthur
// 2026-11-22): a personal library in the browser (IndexedDB), kept apart from a project's own
// recipes/; a routine run straight from it without a project; a pack exported and imported as ONE
// self-contained YAML or as a zip.
//
// The PACK is the one internal form: { v, main: recipe, recipes: [recipe…], tables: { path: Blob } } —
// a routine, every recipe it names, and the parameter tables it reads (each `from:`). The YAML and
// the zip are two encodings of it (a binary table — an xlsx — needs the zip).
//
// A run WITHOUT a project writes into a run root of its own (runrecord.js runRoot): a folder picked
// for it, or an in-memory one whose outputs you choose and download as a zip. The library keeps each
// such run's record and its report tables (small), and seeds them into the next run's root — so the
// baseline, comparisons and the cache work without a project too.
import { S } from './state.js';
import { floatWin } from './windows.js';
import { microConfirm } from './prompts.js';
import { resolveFileHandle } from './paths.js';
import { pickDirectory, deliverBlob } from './hostio.js';
import { _idb } from './element-store.js';
import { createMemDir } from './gpu-restore.js';
import { createZipStreamWriter, openZipRanged, blobSource } from '../../../ext/archive/src/zipstream.js';
import { emit as yamlEmit, parse as yamlParse } from '../../../ext/yaml/index.js';
import { RECIPE_TOOLS, recipeSlug, recipeYaml, jsToYamlNode, yamlToJs, runRoutine, runRecipe, loadRecipes, routineSubst } from './recipes.js';
import { openInputsDialog } from './routine-ui.js';

const $ = (s) => document.querySelector(s);
const KEY = 'routine-library';
const RUNS_KEPT = 20;                                       // per routine, in the library

// ── the store ──
async function lib() { const v = await _idb.get(KEY); return v && v.packs ? v : { packs: {}, runs: {} }; }
async function libSave(v) { await _idb.setStrict(KEY, v); }
export async function libraryList() { return Object.values((await lib()).packs).sort((a, b) => a.main.name.localeCompare(b.main.name)); }
export async function libraryGet(name) { return (await lib()).packs[name] || null; }
export async function libraryPut(pack) { const v = await lib(); v.packs[pack.main.name] = pack; await libSave(v); return pack; }
export async function libraryDelete(name) { const v = await lib(); delete v.packs[name]; await libSave(v); }

// ── building a pack from the project ──
const tablePathsOf = (params) => {
  const out = new Set();
  const walk = (steps) => { for (const st of steps || []) { if (!st || typeof st !== 'object') continue; if (st.each && typeof st.each === 'object' && st.each.from) out.add(String(st.each.from).split('#')[0]); if (st.params) for (const p of [].concat(st.params)) if (p && p.from) out.add(String(p.from).split('#')[0]); if (Array.isArray(st.steps)) walk(st.steps); } };
  if (params && params.params) for (const p of [].concat(params.params)) if (p && p.from) out.add(String(p.from).split('#')[0]);
  walk(params && params.steps);
  return [...out];
};
const recipeNamesOf = (params) => { const out = new Set(); const walk = (steps) => { for (const st of steps || []) { if (!st) continue; if (st.recipe) out.add(String(st.recipe)); if (Array.isArray(st.steps)) walk(st.steps); } }; walk(params && params.steps); return [...out]; };
const plainRecipe = (r) => ({ name: r.name, tool: r.tool, params: JSON.parse(JSON.stringify(r.params || {})), ...(Array.isArray(r.inputs) && r.inputs.length ? { inputs: JSON.parse(JSON.stringify(r.inputs)) } : {}) });

export async function packFromProject(r) {
  const main = plainRecipe(r), recipes = [], tables = {}, missing = [];
  if (r.tool === 'routine') {
    for (const nm of recipeNamesOf(r.params)) { const x = S.recipes.find((q) => q.name === nm); if (x) recipes.push(plainRecipe(x)); else missing.push(`recipe “${nm}”`); }
    for (const path of tablePathsOf(r.params)) {
      try { const fh = await resolveFileHandle(S.project.dir, path).catch(() => resolveFileHandle(S.project.dir, 'recipes/' + path)); tables[path] = await fh.getFile(); }
      catch { missing.push(`table “${path}”`); }
    }
  }
  return { v: 1, main, recipes, tables, ...(missing.length ? { missing } : {}) };
}

// ── encodings ──
const isText = (path, blob) => /\.(csv|tsv|txt)$/i.test(path) || /^text\//.test(blob.type || '');
export async function packToYaml(pack) {
  const tables = {};
  for (const [path, blob] of Object.entries(pack.tables || {})) {
    if (!isText(path, blob)) throw new Error(`“${path}” is not a text table — export this one as a zip`);
    tables[path] = await blob.text();
  }
  const root = jsToYamlNode({ ...pack.main, bundle: { recipes: pack.recipes || [], tables } });
  if (root.entries.length) root.entries[0].value.leadingComments = [' a micro recipe pack: the recipe, the recipes it uses and its parameter tables (bundle). Import it with Recipes → Library… → Import.'];
  return yamlEmit(root);
}
export async function packToZip(pack) {
  const chunks = [], w = createZipStreamWriter({ write: (b) => { chunks.push(b.slice()); } }), enc = (s) => new TextEncoder().encode(s), now = Date.now();
  await w.add('micro-pack.json', enc(JSON.stringify({ v: 1, main: `${recipeSlug(pack.main.name)}.yaml` }, null, 1)), { aligned: false, mtime: now });
  await w.add(`${recipeSlug(pack.main.name)}.yaml`, enc(recipeYaml(pack.main)), { aligned: false, mtime: now });
  for (const r of pack.recipes || []) await w.add(`recipes/${recipeSlug(r.name)}.yaml`, enc(recipeYaml(r)), { aligned: false, mtime: now });
  for (const [path, blob] of Object.entries(pack.tables || {})) await w.add(`tables/${path}`, new Uint8Array(await blob.arrayBuffer()), { aligned: false, mtime: now });
  await w.finish();
  return new Blob(chunks, { type: 'application/zip' });
}
const asRecipe = (j, where) => {
  if (!j || !j.name || !RECIPE_TOOLS[j.tool] || !j.params) throw new Error(`${where}: not a micro recipe (name, tool, params)`);
  return plainRecipe(j);
};
export async function packFromFile(file) {
  if (/\.zip$/i.test(file.name) || (file.type || '').includes('zip')) {
    const zip = await openZipRanged(blobSource(file)), txt = async (e) => new TextDecoder().decode(await zip.bytes(e));
    const me = zip.entries.get('micro-pack.json'); if (!me) throw new Error('not a micro recipe pack (no micro-pack.json inside)');
    const meta = JSON.parse(await txt(me)), mainE = zip.entries.get(meta.main); if (!mainE) throw new Error(`the pack names ${meta.main}, which isn't in it`);
    const main = asRecipe(yamlToJs(yamlParse(await txt(mainE))), meta.main), recipes = [], tables = {};
    for (const e of zip.list()) {
      if (e.dir) continue;
      if (e.name.split('/').some((s) => s === '..')) throw new Error(`refusing an unsafe path in the pack: ${e.name}`);
      if (e.name.startsWith('recipes/') && /\.ya?ml$/i.test(e.name)) recipes.push(asRecipe(yamlToJs(yamlParse(await txt(e))), e.name));
      else if (e.name.startsWith('tables/')) tables[e.name.slice(7)] = new Blob([await zip.bytes(e)]);
    }
    return { v: 1, main, recipes, tables };
  }
  const j = yamlToJs(yamlParse(await file.text()));
  const b = (j && j.bundle) || {}, main = asRecipe({ ...j, bundle: undefined }, file.name);
  const tables = Object.fromEntries(Object.entries(b.tables || {}).map(([p, t]) => [p, new Blob([String(t)], { type: 'text/csv' })]));
  return { v: 1, main, recipes: (b.recipes || []).map((r, i) => asRecipe(r, `bundle recipe ${i + 1}`)), tables };
}

// ── import into the project: recipe files + tables; nothing of yours is overwritten ──
export async function packIntoProject(pack) {
  if (!S.project || !S.project.dir) throw new Error('open a project first');
  const wrote = [], kept = [];
  const put = async (path, data, same) => {
    const ex = await resolveFileHandle(S.project.dir, path).then((h) => h.getFile(), () => null);
    if (ex) { if (!(await same(ex))) kept.push(path); return; }
    const fh = await resolveFileHandle(S.project.dir, path, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); wrote.push(path);
  };
  for (const r of [pack.main, ...(pack.recipes || [])]) { const y = recipeYaml(r); await put(`recipes/${recipeSlug(r.name)}.yaml`, y, async (f) => (await f.text()) === y); }
  for (const [path, blob] of Object.entries(pack.tables || {})) await put(path, blob, async (f) => f.size === blob.size && (await f.text()) === (await blob.text()));
  await loadRecipes(S.project.dir);
  return { wrote, kept };
}

// ── runs without a project ──
const RUN_TEXT = /\.(json|tsv|csv|txt)$/i;
async function seedRuns(root, routine) {                     // this routine's earlier records → runs/ of the in-memory root
  for (const run of ((await lib()).runs[routine] || [])) for (const [rel, text] of Object.entries(run.files)) {
    const fh = await resolveFileHandle(root, `${run.dir}/${rel}`, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close();
  }
}
async function storeRun(root, rec) {                         // the record + its small text outputs, into the library
  const files = {};
  let d = root; for (const s of rec.dir.split('/')) d = await d.getDirectoryHandle(s);
  for await (const [nm, h] of d.entries()) { if (h.kind !== 'file' || !RUN_TEXT.test(nm)) continue; const f = await h.getFile(); if (f.size < 2 << 20) files[nm] = await f.text(); }
  const v = await lib(), list = (v.runs[rec.routine.name] || []).filter((x) => x.dir !== rec.dir);
  list.push({ dir: rec.dir, files }); v.runs[rec.routine.name] = list.slice(-RUNS_KEPT);
  await libSave(v);
}
// every file of a run (in a root) → [{ name, size, blob }]
async function runFiles(root, dir) {
  let d = root; for (const s of dir.split('/')) d = await d.getDirectoryHandle(s);
  const out = []; for await (const [nm, h] of d.entries()) if (h.kind === 'file') { const f = await h.getFile(); out.push({ name: nm, size: f.size, blob: f }); }
  return out.sort((a, b) => (a.name === 'run.json' ? -1 : b.name === 'run.json' ? 1 : a.name.localeCompare(b.name)));
}
// choose what goes in the zip: the record always; reports and files as you like
export async function offerRunOutputs(root, rec) {
  const files = await runFiles(root, rec.dir), folder = rec.dir.split('/').pop();
  const win = floatWin({ title: `outputs · ${rec.routine.name}`, sub: `${rec.status} · ${files.length} file${files.length === 1 ? '' : 's'}`, x: 180, y: 120, w: 440, h: Math.min(140 + files.length * 22, innerHeight - 160) });
  win.el.dataset.runOutputs = '1';
  const boxes = files.map((f) => {
    const row = document.createElement('label'); row.className = 'rf-row'; row.style.gridTemplateColumns = '20px minmax(0,1fr) 80px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.disabled = f.name === 'run.json';   // the record always goes
    const nm = document.createElement('span'); nm.textContent = f.name + (f.name === 'run.json' ? '  (the record — always)' : '');
    const sz = document.createElement('span'); sz.textContent = f.size >= 1 << 20 ? `${(f.size / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`;
    row.append(cb, nm, sz); win.body.append(row); return { f, cb };
  });
  const bar = document.createElement('div'); bar.className = 'rw-bar';
  const go = document.createElement('button'); go.className = 'awin-btn'; go.textContent = 'Download zip';
  go.onclick = async () => {
    const chunks = [], w = createZipStreamWriter({ write: (b) => { chunks.push(b.slice()); } });
    for (const { f, cb } of boxes) if (cb.checked) await w.add(`${folder}/${f.name}`, new Uint8Array(await f.blob.arrayBuffer()), { aligned: false, mtime: Date.now() });
    await w.finish();
    const blob = new Blob(chunks, { type: 'application/zip' }); win.el._zip = blob;
    await deliverBlob(blob, `${folder}.zip`);
  };
  bar.append(go); win.body.append(bar);
  return win;
}
// run a pack's routine without a project. mode: 'folder' (pick one — it becomes the run root, like a
// project) | 'zip' (in memory; choose the outputs at the end). inputs: given up front (else the dialog)
export async function runWithoutProject(pack, mode = 'zip', { inputs = null, root = null } = {}) {
  const r = pack.main;
  if (r.tool !== 'routine') throw new Error('only a routine runs on its own — a single recipe needs a project (or put it in a routine)');
  let runRoot = root;
  if (!runRoot && mode === 'folder') { runRoot = await pickDirectory(); if (!runRoot) return null; }
  if (!runRoot) { runRoot = createMemDir('library-run'); await seedRuns(runRoot, r.name); }
  const opts = {
    root: runRoot, pack: { recipes: pack.recipes || [], tables: pack.tables || {} },
    onFinish: async (status, rec) => { if (mode === 'zip') { await storeRun(runRoot, rec); runRoot._lastRun = rec; if (!root) await offerRunOutputs(runRoot, rec); } },
    onAccept: async () => { if (mode === 'zip' && runRoot._lastRun) await storeRun(runRoot, runRoot._lastRun); },
  };
  if (Array.isArray(r.inputs) && r.inputs.length && !inputs) { openInputsDialog(r, opts); return runRoot; }
  const run = inputs ? { ...r, inputs: undefined, _inputs: inputs, params: routineSubst(JSON.parse(JSON.stringify(r.params)), inputs) } : r;
  await runRoutine(run, opts);
  return runRoot;
}

// ── the Library window ──
let _win = null;
const pickFile = () => new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.yaml,.yml,.zip'; i.onchange = () => res(i.files[0] || null); i.click(); });
export async function exportPack(pack, as = 'yaml') {
  const nm = recipeSlug(pack.main.name);
  if (as === 'zip') return deliverBlob(await packToZip(pack), `${nm}.zip`);
  return deliverBlob(new Blob([await packToYaml(pack)], { type: 'text/yaml' }), `${nm}.yaml`);
}
export async function importPackFile(file, into) {
  const pack = await packFromFile(file);
  if (into === 'project') { const r = await packIntoProject(pack); $('#meta').textContent = `imported “${pack.main.name}” into the project — wrote ${r.wrote.length} file${r.wrote.length === 1 ? '' : 's'}${r.kept.length ? `; kept your own: ${r.kept.join(', ')}` : ''}`; return r; }
  await libraryPut(pack); $('#meta').textContent = `“${pack.main.name}” is in the library`; return pack;
}
export async function openLibraryWindow() {
  if (_win) { await _win._render(); return _win; }
  const win = _win = floatWin({ title: 'recipe library', sub: '', x: 120, y: 80, w: 640, h: 440, onClose: () => { _win = null; } });
  win.el.dataset.library = '1';
  const btn = (t, title, fn) => { const b = document.createElement('button'); b.className = 'awin-btn'; b.textContent = t; b.title = title; b.onclick = async () => { try { await fn(); } catch (e) { $('#meta').textContent = `library: ${e.message}`; } await win._render(); }; return b; };
  win._render = async () => {
    win.body.textContent = '';
    const packs = await libraryList(), hasProject = !!(S.project && S.project.dir);
    win.sub.textContent = `${packs.length} in the library${hasProject ? ` · ${S.recipes.length} in this project` : ' · no project open'}`;
    const head = (t) => { const h = document.createElement('div'); h.className = 'sw-h'; h.textContent = t; win.body.append(h); };
    const row = (label, ...buttons) => { const r = document.createElement('div'); r.className = 'rw-bar'; r.style.flexWrap = 'wrap'; const s = document.createElement('span'); s.className = 'lbl'; s.style.flex = '1 1 200px'; s.textContent = label; r.append(s, ...buttons); win.body.append(r); return r; };
    head('library — yours in this browser, apart from any project');
    if (!packs.length) row('empty — add from a project below, or Import a pack');
    for (const p of packs) {
      const extra = [p.recipes && p.recipes.length ? `${p.recipes.length} recipe${p.recipes.length === 1 ? '' : 's'}` : '', Object.keys(p.tables || {}).length ? `${Object.keys(p.tables).length} table${Object.keys(p.tables).length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      const r = row(`${p.main.name} · ${RECIPE_TOOLS[p.main.tool] || p.main.tool}${extra ? ` (${extra})` : ''}`,
        ...(p.main.tool === 'routine' ? [
          ...(hasProject ? [btn('Run in project', 'run it on this project’s layers, writing its run into the project', () => runRecipe(p.main, true, { pack: { recipes: p.recipes || [], tables: p.tables || {} } }))] : []),
          btn('Run → zip', 'without a project: choose the outputs at the end, download them as a zip', () => runWithoutProject(p, 'zip')),
          btn('Run → folder…', 'without a project: pick a folder; the run is written there', () => runWithoutProject(p, 'folder')),
        ] : []),
        ...(hasProject ? [btn('Into project', 'copy it (and its recipes and tables) into this project', async () => { const res = await packIntoProject(p); $('#meta').textContent = `“${p.main.name}” → the project: wrote ${res.wrote.length}${res.kept.length ? `, kept your own ${res.kept.join(', ')}` : ''}`; })] : []),
        btn('YAML', 'export as one self-contained YAML', () => exportPack(p, 'yaml')),
        btn('zip', 'export as a zip pack', () => exportPack(p, 'zip')),
        btn('Delete', 'remove it from the library', async () => { if (await microConfirm('delete from the library', `Remove “${p.main.name}” from this browser's library?`, 'Delete')) await libraryDelete(p.main.name); }));
      r.dataset.pack = p.main.name;
    }
    if (hasProject) {
      head('this project — its recipes/ folder');
      if (!S.recipes.length) row('none yet');
      for (const r of S.recipes) {
        const rr = row(`${r.name} · ${RECIPE_TOOLS[r.tool] || r.tool}`,
          btn('To library', 'copy it (with the recipes and tables it uses) into the library', async () => { const pk = await packFromProject(r); await libraryPut(pk); $('#meta').textContent = `“${r.name}” is in the library${pk.missing ? ` (missing: ${pk.missing.join(', ')})` : ''}`; }),
          btn('YAML', 'export as one self-contained YAML', async () => exportPack(await packFromProject(r), 'yaml')),
          btn('zip', 'export as a zip pack', async () => exportPack(await packFromProject(r), 'zip')));
        rr.dataset.recipe = r.name;
      }
    }
    const bar = document.createElement('div'); bar.className = 'rw-bar'; bar.style.marginTop = '8px';
    bar.append(btn('Import…', 'a .yaml or .zip pack → the library', async () => { const f = await pickFile(); if (f) await importPackFile(f, 'library'); }));
    if (hasProject) bar.append(btn('Import into project…', 'a .yaml or .zip pack → this project’s recipes/', async () => { const f = await pickFile(); if (f) await importPackFile(f, 'project'); }));
    win.body.append(bar);
  };
  await win._render();
  return win;
}
