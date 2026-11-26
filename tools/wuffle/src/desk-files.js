// wuffle desk — files in and out. Measurements (any delimited text; io.js reads it, never refusing) become
// datasets drawn on the active net. A project is a `.zip.wuffle` (project-file.js: the /project tree zipped,
// plus /home): opening one replaces the current project IN PLACE (the views keep their listeners), Save
// writes one. Between saves the project is kept quietly in this browser (IndexedDB) and comes back when the
// page reopens. Opening is by picker, by drop on the window, or the built-in sample.

import { alert } from '../../../ext/dialog/index.js';
import { readTable } from './io.js';
import { writeProject, readProject, isZip } from './project-file.js';

// ── the autosave: one key in one IndexedDB store; every access may fail (private window, blocked storage) ──
const DB = 'wuffle', STORE = 'autosave', KEY = 'project';
function idb() {
  return new Promise((res, rej) => {
    let r; try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((res, rej) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  } finally { db.close(); }
}
export const autosaveStore = {
  get: () => idbDo('readonly', (s) => s.get(KEY)).catch(() => null),
  put: (v) => idbDo('readwrite', (s) => s.put(v, KEY)).catch(() => null),
  clear: () => idbDo('readwrite', (s) => s.delete(KEY)).catch(() => null),
};

const download = (blob, name) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const safeName = (s) => String(s || 'untitled').replace(/[^\w.-]+/g, '_');

/**
 * @param home { list(): Promise<[{path, bytes}]>, restore(files): Promise, onChange(fn) } — the console's /home
 */
export function createFiles(root, { project: p, dropHost, onOpened, home = null, onStatus = () => {} }) {
  /** text → dataset(s), each drawn on the active net (made if there is none) → the first dataset's id */
  const addData = (text, name) => {
    const specs = readTable(text, String(name).replace(/\.[^.]+$/, ''));
    let first = null;
    p.batch(`open ${name}`, () => {                         // the data and its layer: one undo step
      for (const s of specs) {
        const id = p.addDataset(s); first = first || id;
        if (!p.activeDiagram) p.addDiagram('net');
        p.addLayer(p.activeDiagram, id);
      }
    });
    if (first && onOpened) onOpened(first);
    return first;
  };
  /** another Project replaces this one IN PLACE, so every listener stays attached */
  const adopt = (q) => {
    Object.assign(p, { name: q.name, datasets: q.datasets, diagrams: q.diagrams, layers: q.layers, figures: q.figures, selection: q.selection, activeDiagram: q.activeDiagram, _seq: q._seq });
    p.clearHistory();
    p._emit('project-loaded');
  };
  /** a .zip.wuffle's bytes → the project (and its home files) → warnings */
  const loadProject = async (bytes) => {
    const { project: q, home: files, warnings } = await readProject(bytes);
    adopt(q);
    if (home) await home.restore(files);
    return warnings;
  };
  const open = async (files) => {
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (isZip(bytes)) {
        try {
          const w = await loadProject(bytes);
          onStatus(`opened ${f.name}${w.length ? ` — ${w.length} thing${w.length === 1 ? '' : 's'} skipped` : ''}`);
          if (w.length) await alert(`${f.name} opened, but:\n\n${w.join('\n')}`);
        } catch (e) { await alert(`${f.name}: ${e.message}`); }
        continue;
      }
      addData(new TextDecoder().decode(bytes), f.name);
    }
  };
  const bytesOf = async () => writeProject(p, { home: home ? await home.list() : [] });
  const save = async () => {
    download(new Blob([await bytesOf()], { type: 'application/zip' }), `${safeName(p.name)}.zip.wuffle`);
    onStatus(`saved ${safeName(p.name)}.zip.wuffle`);
  };

  // ── autosave: a second after the last change (the model's or /home's), the whole project into IndexedDB ──
  let timer = null, restoring = false;
  const schedule = () => { if (restoring) return; clearTimeout(timer); timer = setTimeout(async () => { await autosaveStore.put({ at: Date.now(), name: p.name, bytes: await bytesOf() }); }, 1000); };
  p.on(schedule);
  home?.onChange(schedule);
  /** on boot: the last session back, if there is one → true */
  const restore = async () => {
    const s = await autosaveStore.get();
    if (!s?.bytes) return false;
    restoring = true;
    try { await loadProject(s.bytes); onStatus(`restored your last session (${new Date(s.at).toLocaleString()})`); return true; }
    catch { return false; }
    finally { restoring = false; }
  };
  /** File → New project: an empty project, /home emptied, the autosave cleared (the menu confirms first: Undo can't bring it back) */
  const newProject = async () => {
    adopt(new (p.constructor)({ name: 'untitled' }));
    if (home) await home.restore([]);
    await autosaveStore.clear();
  };

  const picker = document.createElement('input');
  picker.type = 'file'; picker.multiple = true; picker.accept = '.csv,.txt,.tsv,.dat,.wuffle,.zip'; picker.hidden = true;
  picker.onchange = () => { open([...picker.files]); picker.value = ''; };
  root.append(picker);

  let veil = null;
  const hide = () => { veil?.remove(); veil = null; };
  root.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    if (!veil) { veil = document.createElement('div'); veil.className = 'wdrop'; veil.textContent = 'drop measurements or a .zip.wuffle project'; dropHost.append(veil); }
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) hide(); });
  root.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); hide(); open([...e.dataTransfer.files]); });

  return { addData, loadProject, adopt, open, save, bytesOf, restore, newProject, pick: () => picker.click() };
}
