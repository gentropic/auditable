// bzip2 via @gcu/bz2 — libbzip2 1.0.8 ported to JavaScript, both ways. Its output
// is byte-identical to bzip2's (and CPython's bz2), and it carries no Wasm.
//
// At dev time the import below resolves through ESM directly. At build time the
// import is stripped and `_gcuBz2` is the namespaced, inlined @gcu/bz2 bundle (see
// ext/archive/build.js's "inlined @gcu codecs" section).

import * as _gcuBz2 from '../../bz2/index.js';

// Single-shot decompress. Concatenated streams (as `cat a.bz2 b.bz2` makes, and as
// pbzip2 writes) decode to their concatenation, as bunzip2 does.
export async function unbz2Bytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('unbz2Bytes: expected Uint8Array');
  return _gcuBz2.decompress(u8);
}

// Single-shot compress. opts.level is bzip2's block size, 1..9 (×100 KB); 9 is
// bzip2's default.
export async function bz2Bytes(u8, opts = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('bz2Bytes: expected Uint8Array');
  const level = typeof opts.level === 'number' ? Math.max(1, Math.min(9, opts.level | 0)) : 9;
  return _gcuBz2.compress(u8, level);
}

// Derive an inner filename for single-file .bz2 archives — strip '.bz2'
// (or '.tbz' / '.tbz2' → '.tar'). Mirrors gz.js / zst.js / xz.js.
export function _bz2InnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.tbz2')) return sourceName.slice(0, -5) + '.tar';
  if (lower.endsWith('.tbz'))  return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.bz2'))  return sourceName.slice(0, -4);
  return sourceName;
}
