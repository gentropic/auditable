// A persistent store for adder's compile cache, on the local disk — Node only (not part of the
// browser bundle). What AIR made of a module or an exec / eval string outlives the process: the
// next process that imports the same source skips the parse and the lowering.
//
//   import { setCompileStore } from '@gcu/adder';
//   import { nodeCompileStore } from '@gcu/adder/node-cache';
//   setCompileStore(nodeCompileStore());
//
// Opt-in: adder never writes to the disk unless asked. Entries are keyed by a hash of the source
// and of the compiler itself (every file of adder's src/ plus the @gcu/air bundle), so a compiler
// change never serves a stale entry. Entries are JS that adder runs: the directory is created
// readable by its owner only, as CPython's __pycache__ relies on.
//   opts.dir       where (default: $XDG_CACHE_HOME/gcu-adder, %LOCALAPPDATA%\gcu-adder, ~/.cache/gcu-adder)
//   opts.maxBytes  the directory's cap; least recently used entries go past it (default 256 MB)
//   opts.air       the @gcu/air bundle's path or URL, when import.meta.resolve can't find it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function _defaultDir() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'gcu-adder');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'gcu-adder');
  return path.join(os.homedir(), '.cache', 'gcu-adder');
}

// the compiler's identity: adder's sources and AIR's bundle, hashed
function _compilerId(airOpt) {
  const h = createHash('sha256');
  const src = path.dirname(fileURLToPath(import.meta.url));
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.js')).sort()) h.update(f).update('\0').update(fs.readFileSync(path.join(src, f))).update('\0');
  let air = airOpt;
  if (!air) {
    try { air = import.meta.resolve('@gcu/air'); } catch {
      throw new TypeError("nodeCompileStore: can't find @gcu/air to fingerprint it; pass { air: <path to its index.js> }");
    }
  }
  h.update(fs.readFileSync(String(air).startsWith('file:') ? fileURLToPath(air) : air));
  return h.digest('hex').slice(0, 16);
}

export function nodeCompileStore(opts = {}) {
  const dir = path.resolve(opts.dir || _defaultDir());
  const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
  const id = _compilerId(opts.air);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (key) => path.join(dir, createHash('sha256').update(id).update('\0').update(key).digest('hex') + '.json');
  let written = 0;

  // past the cap, the least recently used go (an entry read is touched: its mtime is its last use)
  function prune() {
    let entries;
    try { entries = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => { const p = path.join(dir, n); const s = fs.statSync(p); return { p, size: s.size, t: s.mtimeMs }; }); } catch { return; }
    let total = entries.reduce((a, e) => a + e.size, 0);
    if (total <= maxBytes) return;
    entries.sort((a, b) => a.t - b.t);
    for (const e of entries) {
      if (total <= maxBytes * 0.9) break;
      try { fs.unlinkSync(e.p); total -= e.size; } catch {}
    }
  }
  prune();

  return {
    id, dir,
    get(key) {
      const p = file(key);
      let s;
      try { s = fs.readFileSync(p, 'utf8'); } catch { return undefined; }
      try { const now = new Date(); fs.utimesSync(p, now, now); } catch {}
      return s;
    },
    set(key, value) {
      const p = file(key);
      // written whole or not at all: two processes compiling the same source never see half an entry
      const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        fs.writeFileSync(tmp, value, { mode: 0o600 });
        fs.renameSync(tmp, p);
      } catch { try { fs.unlinkSync(tmp); } catch {} return; }
      written += value.length;
      if (written > maxBytes / 16) { written = 0; prune(); }
    },
  };
}
