import { vfsError } from './error.js';
import { path } from './path.js';
import { Backend } from './backend.js';

const MAX_SYMLINK_DEPTH = 40;

// A node's inode number (stat's ino): one per node, kept across renames — what tells two paths
// to the same file (through a symlink) apart from two files.
const _inos = new WeakMap();
let _nextIno = 1;
function _inoOf(node) {
  let n = _inos.get(node);
  if (n === undefined) _inos.set(node, n = _nextIno++);
  return n;
}

function _makeNode(type, content) {
  const now = new Date();
  const node = {
    _meta: {
      type,
      size: 0,
      created: now,
      modified: now,
      accessed: now,
      mode: type === 'directory' ? 0o755 : 0o644,
      owner: 'user',
      group: 'staff',
    },
  };
  if (type === 'directory') {
    node._children = new Map();
  } else if (type === 'file') {
    node._content = content !== undefined ? content : '';
    node._meta.size = typeof node._content === 'string'
      ? new TextEncoder().encode(node._content).byteLength
      : node._content.byteLength;
  } else if (type === 'symlink') {
    node._target = content || '';
  }
  return node;
}

class MemoryBackend extends Backend {
  static type = 'memory';

  constructor() {
    super();
    this._root = _makeNode('directory');
  }

  _segments(p) {
    const n = path.normalize(p);
    if (n === '/') return [];
    return n.split('/').filter(Boolean);
  }

  // Walk segs from the root: the node they name and its canonical path (no symlinks in it). A
  // symlink on the way is followed — its target read from the directory holding it when relative,
  // as POSIX resolves one — and so is the last one when followLast. depth: symlinks followed so far
  // in the whole resolution (past MAX_SYMLINK_DEPTH it is a loop: ELOOP).
  _walk(segs, followLast, p, depth = 0) {
    let node = this._root, at = [];
    for (let i = 0; i < segs.length; i++) {
      if (node._meta.type !== 'directory') throw vfsError('ENOTDIR', p);
      const child = node._children.get(segs[i]);
      if (!child) throw vfsError('ENOENT', p);
      if (child._meta.type === 'symlink' && (i < segs.length - 1 || followLast)) {
        if (++depth > MAX_SYMLINK_DEPTH) throw vfsError('ELOOP', p);
        const t = child._target;
        const r = this._walk(this._segments(t.startsWith('/') ? t : '/' + [...at, t].join('/')), true, p, depth);
        node = r.node; at = r.at; depth = r.depth;
      } else {
        node = child; at = [...at, segs[i]];
      }
    }
    return { node, at, depth };
  }

  _resolve(p, followSymlinks = true) {
    return this._walk(this._segments(p), followSymlinks, p).node;
  }

  _resolveParent(p) {
    const segs = this._segments(p);
    if (segs.length === 0) throw vfsError('EEXIST', '/');
    const name = segs.pop();
    const node = this._walk(segs, true, p).node;
    if (node._meta.type !== 'directory') throw vfsError('ENOTDIR', p);
    return [node, name];
  }

  async readFile(p, encoding) {
    const node = this._resolve(p);
    if (node._meta.type === 'directory') throw vfsError('EISDIR', p);
    if (node._meta.type === 'symlink') throw vfsError('ENOENT', p);
    const content = node._content;
    if (encoding === 'bytes') {
      if (content instanceof Uint8Array) return new Uint8Array(content);
      return new TextEncoder().encode(content);
    }
    if (content instanceof Uint8Array) return new TextDecoder().decode(content);
    return content;
  }

  // Resident bytes → a range is a cheap subarray (no re-read).
  get rangeReadable() { return true; }
  async readRange(p, offset, length) {
    const b = await this.readFile(p, 'bytes');
    return b.subarray(offset, offset + length);
  }

  async writeFile(p, content) {
    const [parent, name] = this._resolveParent(p);
    const existing = parent._children.get(name);
    if (existing && existing._meta.type === 'directory') throw vfsError('EISDIR', p);

    const node = existing || _makeNode('file');
    node._content = content;
    node._meta.type = 'file';
    node._meta.modified = new Date();
    node._meta.size = typeof content === 'string'
      ? new TextEncoder().encode(content).byteLength
      : (content instanceof Uint8Array ? content.byteLength : 0);
    if (!existing) {
      node._meta.created = new Date();
    }
    parent._children.set(name, node);
  }

  async unlink(p) {
    const [parent, name] = this._resolveParent(p);
    const child = parent._children.get(name);
    if (!child) throw vfsError('ENOENT', p);
    if (child._meta.type === 'directory') throw vfsError('EISDIR', p);
    parent._children.delete(name);
  }

  async rename(oldP, newP) {
    const [oldParent, oldName] = this._resolveParent(oldP);
    const child = oldParent._children.get(oldName);
    if (!child) throw vfsError('ENOENT', oldP);

    const [newParent, newName] = this._resolveParent(newP);
    const existingNew = newParent._children.get(newName);

    // Can't overwrite a non-empty directory
    if (existingNew && existingNew._meta.type === 'directory' && existingNew._children.size > 0) {
      throw vfsError('ENOTEMPTY', newP);
    }
    // Can't overwrite a directory with a file
    if (existingNew && existingNew._meta.type === 'directory' && child._meta.type !== 'directory') {
      throw vfsError('EISDIR', newP);
    }

    oldParent._children.delete(oldName);
    child._meta.modified = new Date();
    newParent._children.set(newName, child);
  }

  async stat(p) {
    const node = this._resolve(p);
    const m = node._meta;
    return {
      type: m.type,
      size: m.size,
      created: m.created,
      modified: m.modified,
      accessed: m.accessed || m.modified,
      mode: m.mode,
      owner: m.owner,
      group: m.group,
      ino: _inoOf(node),
    };
  }

  async lstat(p) {
    const node = this._resolve(p, false);
    const m = node._meta;
    const result = {
      type: m.type,
      size: m.size,
      created: m.created,
      modified: m.modified,
      accessed: m.accessed || m.modified,
      mode: m.mode,
      owner: m.owner,
      group: m.group,
      ino: _inoOf(node),
    };
    if (m.type === 'symlink') result.target = node._target;
    return result;
  }

  async mkdir(p, opts) {
    if (opts && opts.recursive) return this._mkdirRecursive(p);
    const [parent, name] = this._resolveParent(p);
    if (parent._children.has(name)) throw vfsError('EEXIST', p);
    parent._children.set(name, _makeNode('directory'));
  }

  async _mkdirRecursive(p) {
    const segs = this._segments(p);
    let node = this._root;
    for (const seg of segs) {
      if (node._meta.type !== 'directory') throw vfsError('ENOTDIR', p);
      if (!node._children.has(seg)) {
        node._children.set(seg, _makeNode('directory'));
      }
      node = node._children.get(seg);
    }
  }

  async readdir(p) {
    const node = this._resolve(p);
    if (node._meta.type !== 'directory') throw vfsError('ENOTDIR', p);
    return [...node._children.keys()].sort();
  }

  async rmdir(p) {
    const [parent, name] = this._resolveParent(p);
    const child = parent._children.get(name);
    if (!child) throw vfsError('ENOENT', p);
    if (child._meta.type !== 'directory') throw vfsError('ENOTDIR', p);
    if (child._children.size > 0) throw vfsError('ENOTEMPTY', p);
    parent._children.delete(name);
  }

  async symlink(target, p) {
    const [parent, name] = this._resolveParent(p);
    if (parent._children.has(name)) throw vfsError('EEXIST', p);
    const node = _makeNode('symlink', target);
    parent._children.set(name, node);
  }

  async readlink(p) {
    const node = this._resolve(p, false);
    if (node._meta.type !== 'symlink') throw vfsError('ENOENT', p, 'not a symlink');
    return node._target;
  }

  async chmod(p, mode) {
    const node = this._resolve(p);
    node._meta.mode = mode;
  }

  async utime(p, atime, mtime) {
    const node = this._resolve(p);
    node._meta.accessed = new Date(atime * 1000);
    node._meta.modified = new Date(mtime * 1000);
  }

  async chown(p, owner, group) {
    const node = this._resolve(p);
    if (owner !== undefined) node._meta.owner = owner;
    if (group !== undefined) node._meta.group = group;
  }

  async estimate() {
    return { used: this._calcSize(this._root), available: Infinity };
  }

  _calcSize(node) {
    if (node._meta.type === 'file') return node._meta.size;
    if (node._meta.type !== 'directory') return 0;
    let total = 0;
    for (const child of node._children.values()) {
      total += this._calcSize(child);
    }
    return total;
  }

  get symlinks() { return true; }
}

export { MemoryBackend };
