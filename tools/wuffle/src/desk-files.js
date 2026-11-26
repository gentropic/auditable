// wuffle desk — files in and out. Measurements (any delimited text; io.js reads it, never refusing) become
// datasets drawn on the active net. A project is a `.zip.wuffle` (project-file.js: the /project tree zipped,
// plus /home): opening one replaces the current project IN PLACE (the views keep their listeners), Save
// writes one. Between saves the project is kept quietly in this browser (IndexedDB) and comes back when the
// page reopens. Save as page writes a wuffle.html with the project INSIDE (page.js) — a page that carries
// one opens it, and File → Open takes any wuffle page and reads just its project. Opening is by picker,
// by drop on the window, or the built-in sample.

import { alert } from '../../../ext/dialog/index.js';
import { readTable } from './io.js';
import { writeProject, readProject, isZip } from './project-file.js';
import { projectBlock, projectFromPage, pageWithProject, blockText, isPage, hashText } from './page.js';
import { gather, verifyLog, describe } from './field-log.js';

// ── the autosave: one key in one IndexedDB store; every access may fail (private window, blocked storage) ──
const DB = 'wuffle', STORE = 'autosave';
// the slot: a page that CARRIES a project autosaves under that project's identity, so edits to a page
// someone sent survive a reload, and a different page never inherits them
const embedded = () => (typeof document !== 'undefined' ? document.getElementById('wuffle-project') : null);
const KEY = (() => { const b = embedded(); return b ? `page:${hashText(b.textContent.replace(/\s/g, ''))}` : 'project'; })();
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
  /** a field log (+ its .sig, + its photos) → an ORIGINAL kept verbatim + the datasets read from it, one undo step → the check */
  const addFieldLog = async ({ log, sig, photos }) => {
    const text = new TextDecoder().decode(log.bytes);
    const day = (text.match(/\b(\d{4}-\d{2}-\d{2})T/) || [])[1];
    const verdict = await verifyLog(log.bytes, sig?.bytes || null);
    let first = null;
    p.batch(`open field log ${log.name}`, () => {
      const oid = p.addOriginal({ name: day ? `field ${day}` : log.name.replace(/\.[^.]+$/, ''), file: log.name, bytes: log.bytes, sig: sig?.bytes || null,
        photos: photos.map((f) => ({ name: f.name, bytes: f.bytes })) });
      const o = p.original(oid);
      for (const s of readTable(text, o.name)) {
        const id = p.addDataset({ ...s, lineage: { op: 'field log', original: o.name, file: log.name, sources: [{ id: null, name: `field/${o.name}/${log.name}` }], at: new Date().toISOString() } }); first = first || id;
        if (!p.activeDiagram) p.addDiagram('net');
        p.addLayer(p.activeDiagram, id);
      }
    });
    if (first && onOpened) onOpened(first);
    return verdict;
  };
  /** another Project replaces this one IN PLACE, so every listener stays attached */
  const adopt = (q) => {
    Object.assign(p, { name: q.name, datasets: q.datasets, originals: q.originals, diagrams: q.diagrams, layers: q.layers, figures: q.figures, selection: q.selection, activeDiagram: q.activeDiagram, _seq: q._seq });
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
  const open = async (picked) => {
    const files = [];
    for (const f of picked) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    // a field log gathers its .sig and photos from the same drop; everything else opens on its own
    const { logs, rest, stray } = gather(files);
    for (const g of logs) {
      const v = await addFieldLog(g);
      const missing = g.wanted - g.photos.length;
      onStatus(`opened field log ${g.log.name} — ${describe(v)}${g.photos.length ? ` · ${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}` : ''}${missing > 0 ? ` (${missing} named in the log weren't in the drop)` : ''}`);
      if (v.state === 'mismatch') await alert(`${g.log.name}: the signature does not match.\n\n${v.why}\n\nThe log is open, kept exactly as it came, but don't treat it as the phone's record.`);
    }
    if (stray.length && !logs.length && !rest.length) onStatus(`${stray.map((f) => f.name).join(', ')}: open them together with the field log they belong to`);
    for (const f of rest) {
      const bytes = f.bytes;
      const head = new TextDecoder().decode(bytes.subarray(0, 200));
      if (isPage(head)) {                                   // a wuffle page: its project, never its code
        try {
          const zip = await projectFromPage(new TextDecoder().decode(bytes));
          if (!zip) { await alert(`${f.name} is a page without a wuffle project in it`); continue; }
          const w = await loadProject(zip);
          onStatus(`opened the project inside ${f.name}${w.length ? ` — ${w.length} skipped` : ''}`);
        } catch (e) { await alert(`${f.name}: ${e.message}`); }
        continue;
      }
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

  /** a wuffle.html with this project inside — needs the built page (the loader keeps it; the dev tree has none) */
  const pageHtml = async () => pageWithProject(window.__wufflePage, await projectBlock(await bytesOf(), p.name), p.name);
  const canSavePage = () => typeof window !== 'undefined' && !!window.__wufflePage;
  const savePage = async () => {
    if (!canSavePage()) { await alert('Save as page works from the built wuffle.html (the development tree has no page to copy).'); return; }
    download(new Blob([await pageHtml()], { type: 'text/html' }), `${safeName(p.name)}.wuffle.html`);
    onStatus(`saved ${safeName(p.name)}.wuffle.html — one file, the project inside`);
  };

  // ── autosave: a second after the last change (the model's or /home's), the whole project into IndexedDB ──
  let timer = null, restoring = false;
  const schedule = () => { if (restoring) return; clearTimeout(timer); timer = setTimeout(async () => { await autosaveStore.put({ at: Date.now(), name: p.name, bytes: await bytesOf() }); }, 1000); };
  p.on(schedule);
  home?.onChange(schedule);
  /** on boot: the last session back, if there is one → true */
  const restore = async () => {
    const s = await autosaveStore.get();
    if (!s?.bytes) {                                        // nothing autosaved: the project this page carries, if any
      const b = embedded(); if (!b) return false;
      restoring = true;
      try { await loadProject(await projectFromPage(b.outerHTML)); onStatus('opened the project inside this page'); return true; }
      catch (e) { onStatus(`the project inside this page didn't open: ${e.message}`); return false; }
      finally { restoring = false; }
    }
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
  picker.type = 'file'; picker.multiple = true; picker.accept = '.csv,.txt,.tsv,.dat,.wuffle,.zip,.html,.sig,.jpg,.jpeg'; picker.hidden = true;
  picker.onchange = () => { open([...picker.files]); picker.value = ''; };
  root.append(picker);

  let veil = null;
  const hide = () => { veil?.remove(); veil = null; };
  root.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    if (!veil) { veil = document.createElement('div'); veil.className = 'wdrop'; veil.textContent = 'drop measurements, a .zip.wuffle project or a wuffle page'; dropHost.append(veil); }
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) hide(); });
  root.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); hide(); open([...e.dataTransfer.files]); });

  return { addData, loadProject, adopt, open, save, savePage, pageHtml, canSavePage, bytesOf, restore, newProject, pick: () => picker.click() };
}
