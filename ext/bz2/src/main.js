// @gcu/bz2 — bzip2, both ways, in plain JavaScript: libbzip2 1.0.8 ported, so a stream it writes
// is byte for byte the one libbzip2 (and CPython's bz2, and the bzip2 tool) writes, and what it
// reads it reads as they do — streamed, a maxLength at a time, with libbzip2's unusedData.
//
//   compress(bytes, level = 9)       → a .bz2 stream
//   decompress(bytes)                → the data of one or more concatenated streams
//   new Compressor(level)            .compress(bytes) → bytes so far; .flush() → the rest
//   new Decompressor()               .decompress(bytes, maxLength = -1); .eof, .needsInput,
//                                    .unusedData (CPython's BZ2Decompressor, member for member)

import { Compressor } from './compress.js';
import { Decompressor, BzDataError } from './decompress.js';

export { Compressor, Decompressor, BzDataError };

export function compress(data, level = 9) {
  const c = new Compressor(level);
  const a = c.compress(data), b = c.flush();
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// as CPython's bz2.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
export function decompress(data) {
  const parts = [];
  let total = 0;
  while (data.length) {
    const d = new Decompressor();
    let res;
    try { res = d.decompress(data); } catch (e) {
      if (parts.length && e instanceof BzDataError) break;
      throw e;
    }
    parts.push(res); total += res.length;
    if (!d.eof) throw new Error('bz2: compressed data ended before the end-of-stream marker was reached');
    data = d.unusedData;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
