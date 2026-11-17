// micro — GPU RESTORE after the system takes the graphics context away (Android
// under memory pressure, a laptop waking, a driver reset). Every layer's GPU copy
// is gone, and condenser keeps no CPU copy (never-resident), so the view has to be
// re-streamed from the sources. Rather than a second, per-kind replay path, this
// rides the most exercised one there is: the session is SAVED as a project into an
// in-memory folder (files linked by reference — nothing is copied, a multi-GB model
// stays on disk), a fresh renderer is made on the restored context, and the
// project is OPENED from that folder: layers, styling, filters, calc and painted
// columns, selections, views, sections and the camera come back exactly as a
// project reopen brings them. The user's own project folder (if any) is left
// untouched and stays the session's project, marked as having unsaved changes.
import { S } from './state.js';
import { openProjectDir, saveProject, setSilentSave } from './project.js';
const $ = (s) => document.querySelector(s);

// ── an in-memory folder, shaped like a FileSystemDirectoryHandle (the subset
// micro's save and open use) ─────────────────────────────────────────────────
class MemFile {
  constructor(dir, name) { this.kind = 'file'; this.name = name; this._dir = dir; this._blob = new Blob([]); this._mtime = Date.now(); }
  async getFile() { return new File([this._blob], this.name, { lastModified: this._mtime, type: this._blob.type }); }
  async createWritable() {
    const parts = [];
    const norm = (d) => (d && d.type === 'write' ? d.data : d);
    const store = () => { this._blob = new Blob(parts); this._mtime = Date.now(); };
    const ws = new WritableStream({ write(chunk) { parts.push(norm(chunk)); }, close() { store(); } });
    ws.write = async (d) => { parts.push(norm(d)); };
    ws.close = async () => { store(); };
    ws.seek = async () => {}; ws.truncate = async () => {};
    return ws;
  }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
  async isSameEntry(o) { return o === this; }
}
class MemDir {
  constructor(name, parent = null) { this.kind = 'directory'; this.name = name; this._kids = new Map(); this._parent = parent; this._memory = true; }
  async getDirectoryHandle(name, { create = false } = {}) {
    let k = this._kids.get(name);
    if (!k) { if (!create) throw new DOMException(`${name} not found`, 'NotFoundError'); k = new MemDir(name, this); this._kids.set(name, k); }
    if (k.kind !== 'directory') throw new DOMException(`${name} is a file`, 'TypeMismatchError');
    return k;
  }
  async getFileHandle(name, { create = false } = {}) {
    let k = this._kids.get(name);
    if (!k) { if (!create) throw new DOMException(`${name} not found`, 'NotFoundError'); k = new MemFile(this, name); this._kids.set(name, k); }
    if (k.kind !== 'file') throw new DOMException(`${name} is a folder`, 'TypeMismatchError');
    return k;
  }
  async removeEntry(name) { if (!this._kids.delete(name)) throw new DOMException(`${name} not found`, 'NotFoundError'); }
  async *entries() { for (const [k, v] of this._kids) yield [k, v]; }
  async *values() { for (const v of this._kids.values()) yield v; }
  async *keys() { for (const k of this._kids.keys()) yield k; }
  [Symbol.asyncIterator]() { return this.entries(); }
  async resolve(h) {
    const walk = (d, path) => { for (const [k, v] of d._kids) { if (v === h) return [...path, k]; if (v.kind === 'directory') { const r = walk(v, [...path, k]); if (r) return r; } } return null; };
    return walk(this, []);
  }
  async queryPermission() { return 'granted'; }
  async requestPermission() { return 'granted'; }
  async isSameEntry(o) { return o === this; }
  // a file whose bytes ARE this blob — linked, not copied (copyLayerIn takes this door)
  async _linkBlob(rel, blob) {
    const segs = rel.split('/').filter(Boolean);
    let d = this; for (let i = 0; i < segs.length - 1; i++) d = await d.getDirectoryHandle(segs[i], { create: true });
    const f = await d.getFileHandle(segs[segs.length - 1], { create: true });
    f._blob = blob; f._mtime = blob.lastModified || Date.now();
    return f;
  }
}
export const createMemDir = (name) => new MemDir(name);

let _busy = null;
/**
 * Rebuild the view on a restored context. H.recreate() makes the new renderer
 * (the app's side — it owns the canvas, the EDL pass and the bindings).
 * Resolves to the number of layers brought back.
 */
export function recoverSession(H, { onStatus = null } = {}) {
  if (_busy) return _busy;
  _busy = (async () => {
    const say = (t) => { if (onStatus) onStatus(t); $('#meta').textContent = t; };
    try {
      if (!S.layers.length) { H.recreate(); return 0; }
      const prev = S.project, wasDirty = !!(prev && prev.dirty);
      const mem = createMemDir((prev && prev.name) || 'session');
      say('graphics back — rebuilding the view…');
      setSilentSave(true);
      S.project = { dir: mem, name: mem.name, dirty: false };
      try { await saveProject(); } finally { setSilentSave(false); }
      H.recreate();
      await openProjectDir(mem);
      const n = S.layers.length;
      // the session's project is the user's folder again (or none), with unsaved
      // changes: its layers now read through the in-memory folder
      if (prev && !prev.pack) S.project = { ...prev, dirty: true };
      else if (prev) S.project = prev;
      else S.project = null;
      dispatchEvent(new Event('micro:project-dirty'));
      void wasDirty;
      say(`graphics back — ${n} layer${n === 1 ? '' : 's'} rebuilt`);
      return n;
    } finally { _busy = null; }
  })();
  return _busy;
}
