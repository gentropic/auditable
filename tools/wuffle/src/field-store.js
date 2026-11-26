// wuffle FIELD — the log kept on the phone between visits. The compass held its measurements in memory
// only, so a reload, a closed tab or Android reclaiming the page lost every reading not yet published.
// Now the log and its photos go into IndexedDB after every change and come back when the page opens.
// Every access may fail (private window, blocked storage): the compass then works as before, in memory.

const DB = 'wuffle-field', STORE = 'kept', KEY = 'log';

function open() {
  return new Promise((res, rej) => {
    let r; try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  try { return await new Promise((res, rej) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); }
  finally { db.close(); }
}

/** the kept log → { log: entry[], photos: [[i, Blob]] } or null */
export const loadKept = () => run('readonly', (s) => s.get(KEY)).catch(() => null);

// writes are serialized and coalesced: a burst of measurements costs one write at the end
let pending = null, writing = false;
async function flush() {
  if (writing) return; writing = true;
  try { while (pending) { const v = pending; pending = null; await run('readwrite', (s) => (v.log.length ? s.put(v, KEY) : s.delete(KEY))).catch(() => null); } }
  finally { writing = false; }
}
/** keep the log (entries are plain objects; photos a Map i → Blob) */
export function keep(log, photos) {
  pending = { log: log.map((e) => ({ ...e })), photos: [...photos].filter(([i]) => log.some((e) => e.i === i)), at: Date.now() };
  flush();
}
/** resolves once every pending write has landed (for the smokes) */
export async function settled() { while (pending || writing) await new Promise((r) => setTimeout(r, 20)); }
