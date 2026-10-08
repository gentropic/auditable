// NodeBackend — @gcu/vfs over a real directory via node:fs (node ≥ 20; bun/deno through their node
// compat). NOT part of the browser bundle (deliberately absent from main.js, so node:fs never leaks
// into index.js) — import it from the node entry, which registers the type on import:
//
//   import { VFS } from '@gcu/vfs';
//   import '@gcu/vfs/node';                                   // → BACKEND_TYPES.node
//   const vfs = await VFS.create({ type: 'node', root: '/srv/weir' });
//
// Semantics mirror MemoryBackend / HandleBackend (same stat shape, sorted readdir, 'bytes' vs utf8,
// the same VFSError codes). One deliberate difference: writeFile is ATOMIC (write a sibling temp
// file, fsync, rename over the target) — a store on disk is read by OTHER processes (a sync daemon,
// a second weir, a backup), and none of them may ever observe a half-written file. A crashed
// write leaves at most a `*.vfstmp` sibling, which readdir hides.
//
// Spec: auditable/spec_inbox/vfs-node-backend-spec.md (from weir's headless fetcher, SYNC.md §9).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { Readable } from 'node:stream';
import { VFSError } from './error.js';
import { path } from './path.js';
import { Backend } from './backend.js';
import { BACKEND_TYPES } from './vfs.js';

const TMP_SUFFIX = '.vfstmp';
const MAPPED = new Set(['ENOENT', 'EEXIST', 'EISDIR', 'ENOTDIR', 'ENOTEMPTY', 'EACCES', 'ENOSPC']);

function err(code, p, detail) {
  return new VFSError(code, p, detail ? `${code}: ${p} (${detail})` : undefined);
}

class NodeBackend extends Backend {
  static type = 'node';

  constructor(config = {}) {
    super();
    this._root = nodePath.resolve(String((config && config.root) || '.'));
  }

  toConfig() { return { type: 'node', root: this._root }; }
  get root() { return this._root; }

  async init() { await fsp.mkdir(this._root, { recursive: true }); }
  async destroy() {}

  // VFS path → absolute path under root. Anything that resolves outside root is refused (EACCES):
  // the VFS path space is the directory, never the host filesystem.
  _abs(p) {
    const n = path.normalize(p);
    const abs = nodePath.resolve(this._root, '.' + n);
    const rel = nodePath.relative(this._root, abs);
    if (rel.startsWith('..') || nodePath.isAbsolute(rel)) throw err('EACCES', p, 'escapes root');
    return abs;
  }

  _map(e, p) {
    if (e && e.name === 'VFSError') return e;
    const code = e && e.code;
    if (code === 'EPERM') return err('EACCES', p);
    if (MAPPED.has(code)) return err(code, p);
    return err('EIO', p, e && e.message);
  }

  async readFile(p, encoding) {
    try {
      const b = await fsp.readFile(this._abs(p));
      return encoding === 'bytes' ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b.toString('utf8');
    } catch (e) { throw this._map(e, p); }
  }

  // Atomic: tmp sibling → fsync → rename over the target. ENOENT if the parent is missing, EISDIR
  // if the target is a directory (both as the other backends report them).
  async writeFile(p, content) {
    const abs = this._abs(p);
    const data = typeof content === 'string' ? content : content instanceof Uint8Array ? content : content == null ? '' : String(content);
    const tmp = `${abs}.${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${TMP_SUFFIX}`;
    try {
      const st = await fsp.stat(abs).catch(() => null);
      if (st && st.isDirectory()) throw err('EISDIR', p);
      const fh = await fsp.open(tmp, 'w');
      try { await fh.writeFile(data); await fh.sync().catch(() => {}); } finally { await fh.close(); }
      await fsp.rename(tmp, abs);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw this._map(e, p);
    }
  }

  async stat(p) {
    try {
      const st = await fsp.stat(this._abs(p));
      return { type: st.isDirectory() ? 'directory' : 'file', size: st.isDirectory() ? 0 : st.size, created: st.birthtime, modified: st.mtime, mode: st.mode & 0o777 };
    } catch (e) { throw this._map(e, p); }
  }

  async lstat(p) {
    try {
      const abs = this._abs(p);
      const st = await fsp.lstat(abs);
      const r = { type: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : 'file', size: st.isDirectory() ? 0 : st.size, created: st.birthtime, modified: st.mtime, mode: st.mode & 0o777 };
      if (st.isSymbolicLink()) r.target = await fsp.readlink(abs);
      return r;
    } catch (e) { throw this._map(e, p); }
  }

  async mkdir(p, opts) {
    const abs = this._abs(p);
    try {
      if (opts && opts.recursive) { await fsp.mkdir(abs, { recursive: true }); return; }
      await fsp.mkdir(abs);
    } catch (e) { throw this._map(e, p); }
  }

  async readdir(p) {
    try {
      const names = await fsp.readdir(this._abs(p));
      return names.filter((n) => !n.endsWith(TMP_SUFFIX)).sort();
    } catch (e) { throw this._map(e, p); }
  }

  async rmdir(p, opts) {
    const abs = this._abs(p);
    try {
      const st = await fsp.stat(abs);
      if (!st.isDirectory()) throw err('ENOTDIR', p);
      if (opts && opts.recursive) { await fsp.rm(abs, { recursive: true, force: false }); return; }
      await fsp.rmdir(abs);
    } catch (e) { throw this._map(e, p); }
  }

  async unlink(p) {
    const abs = this._abs(p);
    try {
      const st = await fsp.stat(abs);
      if (st.isDirectory()) throw err('EISDIR', p);
      await fsp.unlink(abs);
    } catch (e) { throw this._map(e, p); }
  }

  async rename(oldP, newP) {
    try { await fsp.rename(this._abs(oldP), this._abs(newP)); }
    catch (e) { throw this._map(e, oldP); }
  }

  async touch(p) {
    const abs = this._abs(p);
    try {
      const st = await fsp.stat(abs).catch(() => null);
      if (st) { const t = new Date(); await fsp.utimes(abs, t, t); return; }
      await this.writeFile(p, '');
    } catch (e) { throw this._map(e, p); }
  }

  async exists(p) {
    try { await fsp.access(this._abs(p)); return true; }
    catch (e) { if (e && e.name === 'VFSError') throw e; return false; }
  }

  async symlink(target, p) {
    try { await fsp.symlink(target, this._abs(p)); }
    catch (e) { throw this._map(e, p); }
  }
  async readlink(p) {
    try { return await fsp.readlink(this._abs(p)); }
    catch (e) { throw this._map(e, p); }
  }
  async chmod(p, mode) {
    try { await fsp.chmod(this._abs(p), mode); }
    catch (e) { throw this._map(e, p); }
  }
  async chown(p, owner, group) {
    if (typeof owner !== 'number' || typeof group !== 'number') return;   // node wants numeric ids; names are a no-op
    try { await fsp.chown(this._abs(p), owner, group); }
    catch (e) { throw this._map(e, p); }
  }

  // Same { getReader, [asyncIterator] } shape as HandleBackend / FetchBackend.
  createReadStream(p) {
    const abs = this._abs(p);
    const self = this;
    return {
      async getReader() { return Readable.toWeb(fs.createReadStream(abs)).getReader(); },
      [Symbol.asyncIterator]() {
        const it = fs.createReadStream(abs)[Symbol.asyncIterator]();
        return { async next() { try { const r = await it.next(); return r.done ? r : { done: false, value: new Uint8Array(r.value.buffer, r.value.byteOffset, r.value.byteLength) }; } catch (e) { throw self._map(e, p); } } };
      },
    };
  }

  // A streaming writer (NOT atomic — use writeFile for whole-file atomic replace).
  async createWriter(p) {
    const abs = this._abs(p);
    let fh;
    try { fh = await fsp.open(abs, 'w'); } catch (e) { throw this._map(e, p); }
    return {
      async write(chunk) { await fh.write(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); },
      async close() { await fh.close(); },
      async abort() { await fh.close().catch(() => {}); await fsp.rm(abs, { force: true }).catch(() => {}); },
    };
  }

  // Seek: read exactly [offset, offset+length) without touching the rest of the file.
  async readRange(p, offset, length) {
    let fh;
    try {
      fh = await fsp.open(this._abs(p), 'r');
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } catch (e) { throw this._map(e, p); }
    finally { if (fh) await fh.close().catch(() => {}); }
  }

  async toFile(p) {
    const bytes = await this.readFile(p, 'bytes');
    return new File([bytes], nodePath.basename(p) || 'file');
  }

  async estimate() {
    try {
      const sf = await fsp.statfs(this._root);
      return { used: Number(sf.blocks - sf.bfree) * Number(sf.bsize), available: Number(sf.bavail) * Number(sf.bsize) };
    } catch { return { used: 0, available: Infinity }; }
  }

  get persistent() { return true; }
  get streamable() { return true; }
  get estimatable() { return true; }
  get rangeReadable() { return true; }
  get recursiveRemove() { return true; }
  get symlinks() { return true; }
  get portable() { return true; }
}

BACKEND_TYPES.node = NodeBackend;

export { NodeBackend };
