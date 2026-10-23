// xz via @gcu/lzma — liblzma 5.8.1 ported to JavaScript, both ways. What it writes
// is byte-identical to xz's (and CPython's lzma) at the same preset, and it carries
// no Wasm — so a strict-CSP host (no 'wasm-unsafe-eval') reads and writes .xz.
//
// At dev time the import below resolves through ESM directly. At build time the
// import is stripped and `_gcuLzma` is the namespaced, inlined @gcu/lzma bundle (see
// ext/archive/build.js's "inlined @gcu codecs" section).

import * as _gcuLzma from '../../lzma/index.js';

// Single-shot decompress. Reads .xz (and legacy .lzma) as xz does: concatenated
// streams decode to their concatenation, and every integrity check is verified.
export async function unxzBytes(u8) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('unxzBytes: expected Uint8Array');
  return _gcuLzma.decompress(u8);
}

// Single-shot compress to .xz with a CRC64 check, as `xz` writes. opts.level is the
// preset, 0..9 (xz's default is 6); opts.extreme is `xz -e`.
export async function xzBytes(u8, opts = {}) {
  if (!(u8 instanceof Uint8Array)) throw new TypeError('xzBytes: expected Uint8Array');
  let preset = typeof opts.level === 'number' ? Math.max(0, Math.min(9, opts.level | 0)) : 6;
  if (opts.extreme) preset |= _gcuLzma.PRESET_EXTREME;
  return _gcuLzma.compress(u8, { format: 'xz', preset });
}

// Derive an inner filename for single-file .xz archives — strip '.xz' (or
// '.txz' → '.tar'). Mirrors gz.js / zst.js for consistency.
export function _xzInnerName(sourceName) {
  if (!sourceName) return 'data';
  const lower = sourceName.toLowerCase();
  if (lower.endsWith('.txz')) return sourceName.slice(0, -4) + '.tar';
  if (lower.endsWith('.xz'))  return sourceName.slice(0, -3);
  return sourceName;
}
