// micro project backups — the whole project folder as ONE file, `<name>.zip.micro`.
//
// The file is a plain ZIP (rename it .zip and any tool opens it):
//   mimetype            stored, first, bare — application/vnd.gentropic.micro-project
//                       (the EPUB / ODF / .wfr convention: the type is readable at a fixed offset)
//   micro-backup.json   what it is: project name, when, which build, full or lean, the file list
//   project/…           the folder, every file at its relative path
//
// Streamed both ways through @gcu/archive's zipstream (Zip64, stored, CRC-checked on
// restore), so a project with multi-GB models never sits in memory. "Lean" skips only
// what micro rebuilds by itself — the discovery/stats cache (*.meta.json) and the
// GeoTIFF display cache (*.disp.grd / *.disp.json); everything else in the folder is
// data, including hand-dropped files the folder-as-inbox scan would pick up and the
// .cols/ sidecars (painted and materialized columns).
//
// A backup is also a PROJECT PACK: openPack() gives a directory handle over it that
// the project open path reads like a folder. Members are stored, so each file is a
// slice of the pack — nothing is unpacked. Writes during the session land in memory
// beside it (the pack itself is never changed); writeTree() puts the whole tree,
// changes included, into a real folder. Restoring is exactly that, straight after open.
import { createZipStreamWriter, openZipRanged, blobSource } from '../../../ext/archive/src/zipstream.js';

export const BACKUP_MIME = 'application/vnd.gentropic.micro-project';
export const BACKUP_EXT = '.zip.micro';
export const isBackupName = (name) => /\.micro$/i.test(String(name || ''));
const LEAN_SKIP = /(\.meta\.json|\.disp\.grd|\.disp\.json)$/i;
const CACHE_STAMPED = /\.(meta|disp)\.json$/i;              // caches that name their data file's size + mtime
const ROOT = 'project/';

// every file under dir, depth-first, sorted by path (stable archives); lean splits off the caches
export async function inventoryProject(dir, { lean = false } = {}) {
  const files = [], skipped = [];
  const walk = async (d, prefix) => {
    const kids = [];
    for await (const [name, h] of d.entries()) kids.push([name, h]);
    kids.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [name, h] of kids) {
      const path = prefix + name;
      if (h.kind === 'directory') { await walk(h, path + '/'); continue; }
      const f = await h.getFile();
      const rec = { path, size: f.size, lastModified: f.lastModified, handle: h };
      (lean && LEAN_SKIP.test(name) ? skipped : files).push(rec);
    }
  };
  await walk(dir, '');
  const sum = (a) => a.reduce((t, r) => t + r.size, 0);
  return { files, skipped, bytes: sum(files), skippedBytes: sum(skipped) };
}

// sink: { write(u8) } or a WritableStream. onProgress({ path, done, total, index, count })
export async function writeBackup(dir, sink, { lean = false, name, build, linked = [], onProgress, signal } = {}) {
  const inv = await inventoryProject(dir, { lean });
  if (!inv.files.some((r) => r.path === 'project.json')) throw new Error('this folder has no project.json — save the project first');
  const w = createZipStreamWriter(sink);
  await w.add('mimetype', BACKUP_MIME, { aligned: false });
  const info = {
    format: 1, app: 'micro', project: name || dir.name, created: new Date().toISOString(), build: build || null,
    lean: !!lean, root: ROOT,
    // mtime exactly: the zip's DOS time is 2 s coarse, and the cache sidecars compare exactly
    files: inv.files.map((r) => ({ path: r.path, size: r.size, mtime: r.lastModified })),
    skipped: inv.skipped.map((r) => r.path),
    linked,                                                // layers that live OUTSIDE the folder — not in this backup
  };
  await w.add('micro-backup.json', JSON.stringify(info, null, 1), { aligned: false, mtime: Date.now() });
  let done = 0;
  for (let i = 0; i < inv.files.length; i++) {
    if (signal && signal.aborted) throw new DOMException('backup cancelled', 'AbortError');
    const r = inv.files[i];
    const f = await r.handle.getFile();
    if (f.size !== r.size) throw new Error(`${r.path} changed while the backup was being written — try again`);
    const m = w.begin(ROOT + r.path, { aligned: false, mtime: r.lastModified });
    const rd = f.stream().getReader();
    for (;;) {
      const { done: end, value } = await rd.read(); if (end) break;
      await m.write(value); done += value.length;
      if (onProgress) onProgress({ path: r.path, done, total: inv.bytes, index: i, count: inv.files.length });
      if (signal && signal.aborted) { rd.cancel().catch(() => {}); throw new DOMException('backup cancelled', 'AbortError'); }
    }
    await m.end();
  }
  const res = await w.finish();
  return { size: res.size, files: inv.files.length, bytes: inv.bytes, skipped: inv.skipped.length, skippedBytes: inv.skippedBytes };
}

// → { zip, info, members, bytes }; refuses anything that isn't a micro backup
export async function readBackup(blob) {
  let zip;
  try { zip = await openZipRanged(blobSource(blob)); } catch (e) { throw new Error(`not a micro backup (${e.message})`); }
  const mt = zip.entries.get('mimetype');
  if (!mt || new TextDecoder().decode(await zip.bytes(mt)).trim() !== BACKUP_MIME) throw new Error('not a micro backup (no micro mimetype inside)');
  const ie = zip.entries.get('micro-backup.json');
  const info = ie ? JSON.parse(new TextDecoder().decode(await zip.bytes(ie))) : {};
  if (info.format != null && info.format > 1) throw new Error(`this backup was made by a newer micro (format ${info.format})`);
  const members = zip.list().filter((e) => e.name.startsWith(ROOT) && !e.dir && e.name.length > ROOT.length);
  if (!members.some((e) => e.name === ROOT + 'project.json')) throw new Error('this backup has no project.json inside — damaged or not a project');
  for (const e of members) {
    const rel = e.name.slice(ROOT.length);
    if (rel.split('/').some((s) => s === '' || s === '.' || s === '..') || rel.includes('\\')) throw new Error(`refusing an unsafe path in the backup: ${e.name}`);
  }
  const bytes = members.reduce((t, e) => t + e.size, 0);
  return { zip, info, members, bytes };
}

// ── the pack as a directory ──
// The shape of the File System Access handles the project code already walks
// (kind/name, getDirectoryHandle/getFileHandle with {create}, entries/values/keys,
// removeEntry, resolve, isSameEntry, getFile, createWritable — a WritableStream
// with write/close/abort of its own, so both w.write() and pipeTo(w) work), over
// a node tree: a file node is either a pack member or a Blob written this session.
const _zsNotFound = (what) => new DOMException(`${what} was not found in the pack`, 'NotFoundError');
const _zsMismatch = (what) => new DOMException(`${what} is not what was asked for`, 'TypeMismatchError');

function _packPart(d) {
  if (d && d.type === 'write') d = d.data;                  // the {type:'write', data} form
  if (d == null) return new Uint8Array(0);
  if (typeof d === 'string' || d instanceof Blob) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d.slice(0));
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));   // the caller may reuse its buffer
  return String(d);
}

class PackFileHandle {
  constructor(pack, node, path) { this._pack = pack; this._node = node; this._path = path; }
  get kind() { return 'file'; }
  get name() { return this._node.name; }
  async isSameEntry(o) { return !!o && o._node === this._node; }
  async getFile() { return this._pack.fileOf(this._node); }
  async createWritable() {
    const node = this._node, pack = this._pack, parts = [];
    let settled = false;
    const commit = () => {
      if (settled) return; settled = true;
      node.blob = new File(parts, node.name, { lastModified: Date.now() }); node.entry = null;
      pack.changed.add(this._path.join('/'));
    };
    const ws = new WritableStream({ write(c) { parts.push(_packPart(c)); }, close() { commit(); }, abort() { settled = true; } });
    ws.write = async (d) => { if (settled) throw new TypeError('this writable is closed'); parts.push(_packPart(d)); };
    ws.close = async () => commit();
    ws.abort = async () => { settled = true; };
    return ws;
  }
}
class PackDirHandle {
  constructor(pack, node, path) { this._pack = pack; this._node = node; this._path = path; }
  get kind() { return 'directory'; }
  get name() { return this._node.name; }
  async isSameEntry(o) { return !!o && o._node === this._node; }
  _wrap(node, name) { const p = this._path.concat(name); return node.kids ? new PackDirHandle(this._pack, node, p) : new PackFileHandle(this._pack, node, p); }
  async getDirectoryHandle(name, { create = false } = {}) {
    let n = this._node.kids.get(name);
    if (n && !n.kids) throw _zsMismatch(name);
    if (!n) { if (!create) throw _zsNotFound(name); n = { name, kids: new Map() }; this._node.kids.set(name, n); }
    return this._wrap(n, name);
  }
  async getFileHandle(name, { create = false } = {}) {
    let n = this._node.kids.get(name);
    if (n && n.kids) throw _zsMismatch(name);
    if (!n) {
      if (!create) throw _zsNotFound(name);
      n = { name, blob: new File([], name), entry: null }; this._node.kids.set(name, n);
      this._pack.changed.add(this._path.concat(name).join('/'));
    }
    return this._wrap(n, name);
  }
  async removeEntry(name, { recursive = false } = {}) {
    const n = this._node.kids.get(name);
    if (!n) throw _zsNotFound(name);
    if (n.kids && n.kids.size && !recursive) throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
    this._node.kids.delete(name);
    this._pack.changed.add(this._path.concat(name).join('/'));
  }
  async *entries() { for (const [name, n] of [...this._node.kids]) yield [name, this._wrap(n, name)]; }
  async *values() { for (const [, h] of this.entries()) yield h; }
  async *keys() { for (const name of [...this._node.kids.keys()]) yield name; }
  [Symbol.asyncIterator]() { return this.entries(); }
  async resolve(h) {
    if (!h || h._pack !== this._pack) return null;
    const a = this._path, b = h._path;
    if (b.length < a.length || a.some((s, i) => s !== b[i])) return null;
    return b.slice(a.length);
  }
}

// → { dir, info, zip, members, bytes, changed, verify(opts) }. dir is the project's root.
export async function openPack(blob) {
  const { zip, info, members, bytes } = await readBackup(blob);
  const stamp = new Map((info.files || []).map((f) => [f.path, f.mtime]));
  const root = { name: info.project || String(blob.name || 'project').replace(/\.zip\.micro$|\.micro$/i, ''), kids: new Map() };
  for (const e of members) {
    const parts = e.name.slice(ROOT.length).split('/'), fname = parts.pop();
    let d = root;
    for (const p of parts) { let k = d.kids.get(p); if (!k) { k = { name: p, kids: new Map() }; d.kids.set(p, k); } d = k; }
    const rel = e.name.slice(ROOT.length);
    d.kids.set(fname, { name: fname, entry: e, blob: null, mtime: stamp.get(rel) ?? e.mtime });
  }
  const pack = {
    blob, info, zip, members, bytes, changed: new Set(),
    // a member as a File: a slice of the pack when stored (no copy, ranged reads go
    // straight to the pack's bytes), unpacked once when something compressed it
    async fileOf(node) {
      if (node.blob) return node.blob;
      const e = node.entry;
      if (!node._file) {
        if (e.method === 0) {
          const r = await zip.dataRange(e);
          node._file = new File([blob.slice(r.offset, r.offset + r.size)], node.name, { lastModified: node.mtime });
        } else node._file = new File([await new Response(zip.stream(e)).blob()], node.name, { lastModified: node.mtime });
      }
      return node._file;
    },
    // read every member through its CRC — what a slice skips. → { ok, files, bad: [{ path, message }] }
    async verify({ onProgress, signal } = {}) {
      const bad = []; let done = 0;
      for (let i = 0; i < members.length; i++) {
        if (signal && signal.aborted) throw new DOMException('check cancelled', 'AbortError');
        const e = members[i];
        try {
          const rd = zip.stream(e).getReader();
          for (;;) { const { done: end, value } = await rd.read(); if (end) break; done += value.length; if (onProgress) onProgress({ path: e.name.slice(ROOT.length), done, total: bytes, index: i, count: members.length }); }
        } catch (err) { bad.push({ path: e.name.slice(ROOT.length), message: err.message || String(err) }); }
      }
      return { ok: !bad.length, files: members.length, bad };
    },
  };
  pack.dir = new PackDirHandle(pack, root, []);
  return pack;
}

// copy a whole project tree (a pack's, or any directory handle's) into dest, which
// must not hold a project and must not already have any of the files. Pack members
// that weren't changed stream from the pack CRC-checked. Afterwards each cache
// sidecar that described its data file's ORIGINAL stamp is rebased onto the copy's
// (a copy is a new file to the platform — without this a Full backup restored
// would re-read every model once, like a lean one).
export async function writeTree(src, dest, { onProgress, signal } = {}) {
  const pack = src._pack || null;
  const files = [];
  const walk = async (d, prefix) => {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, prefix + name + '/');
      else files.push({ path: prefix + name, h });
    }
  };
  await walk(src, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  try { await dest.getFileHandle('project.json'); throw new Error('that folder already holds a micro project — pick an empty one'); }
  catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'TypeError') throw e; }
  const dirOf = async (parts, create) => { let d = dest; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; };
  for (const r of files) {                                  // collisions first: nothing written if one exists
    const parts = r.path.split('/'), fname = parts.pop();
    try { const d = await dirOf(parts, false); await d.getFileHandle(fname); throw new Error(`that folder already has ${r.path} — pick an empty one`); }
    catch (err) { if (err.name !== 'NotFoundError' && err.name !== 'TypeError') throw err; }
  }
  const srcStamp = new Map();
  for (const r of files) r.file = await r.h.getFile();
  const total = files.reduce((t, r) => t + r.file.size, 0);
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    if (signal && signal.aborted) throw new DOMException('copy cancelled', 'AbortError');
    const r = files[i], parts = r.path.split('/'), fname = parts.pop();
    srcStamp.set(r.path, r.file.lastModified);
    const node = r.h._node;
    const stream = pack && node && node.entry ? pack.zip.stream(node.entry) : r.file.stream();
    const fh = await (await dirOf(parts, true)).getFileHandle(fname, { create: true });
    const ws = await fh.createWritable();
    try {
      const rd = stream.getReader();
      for (;;) {
        const { done: end, value } = await rd.read(); if (end) break;
        await ws.write(value); done += value.length;
        if (onProgress) onProgress({ path: r.path, done, total, index: i, count: files.length });
      }
      await ws.close();
    } catch (err) { try { await ws.abort(); } catch { /* already closed */ } throw err; }
  }
  // the rebase: a sidecar names { size, mtime } of the file it caches
  for (const r of files) {
    if (!CACHE_STAMPED.test(r.path)) continue;
    const dataPath = r.path.replace(CACHE_STAMPED, '');
    const orig = srcStamp.get(dataPath);
    if (orig == null) continue;
    try {
      const parts = r.path.split('/'), fname = parts.pop();
      const fh = await (await dirOf(parts, false)).getFileHandle(fname);
      const j = JSON.parse(await (await fh.getFile()).text());
      if (!j || typeof j.mtime !== 'number' || !j.mtime) continue;
      const dparts = dataPath.split('/'), dname = dparts.pop();
      const copy = await (await (await dirOf(dparts, false)).getFileHandle(dname)).getFile();
      // exact when the pack recorded mtimes; within the zip's 2 s DOS grain when not
      if (j.size !== copy.size || Math.abs(j.mtime - orig) > (pack && !(pack.info.files || []).some((f) => f.mtime != null) ? 2000 : 0)) continue;
      j.mtime = copy.lastModified;
      const w = await fh.createWritable(); await w.write(JSON.stringify(j)); await w.close();
    } catch { /* a cache — leave it to rebuild itself */ }
  }
  return { files: files.length, bytes: total };
}

// unpack into dest: refuses a folder that already holds a project, or any file the
// backup would overwrite; every member is CRC-checked as it streams
export async function restoreBackup(blob, dest, { onProgress, signal } = {}) {
  const pack = await openPack(blob);
  const res = await writeTree(pack.dir, dest, { onProgress, signal });
  return { info: pack.info, files: res.files, bytes: res.bytes };
}
