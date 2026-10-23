// @gcu/lzma — xz / LZMA in plain JavaScript, both ways: liblzma 5.8.1 ported, so what it writes
// is byte for byte what liblzma (the xz tool, CPython's lzma) writes, and it reads what they read
// — .xz with its checks, .lzma, raw LZMA1 / LZMA2, and the delta and branch filters — streamed,
// as CPython's LZMACompressor / LZMADecompressor, member for member.
//
//   compress(bytes, { format, check, preset, filters })   → bytes
//   decompress(bytes, { format, memlimit, filters })      → bytes (concatenated streams too)
//   new Compressor({ format, check, preset, filters })    .compress(bytes), .flush()
//   new Decompressor({ format, memlimit, filters })       .decompress(bytes, maxLength = -1);
//                                                        .eof .needsInput .unusedData .check
//
// format: 'xz' (default) | 'alone' | 'raw' (filters required) | 'auto' (decoding: .xz or .lzma).
// A filter is { id, ...options }: FILTER_LZMA2 / FILTER_LZMA1 { preset, dictSize, lc, lp, pb,
// mode ('fast' | 'normal'), niceLen, mf, depth }, FILTER_DELTA { dist }, the BCJ filters
// { start_offset }.

import { XzEncoder, AloneEncoder, RawStreamEncoder, LzmaError, PRESET_DEFAULT, PRESET_EXTREME, validateChain, filterProps, presetOptions, lzmaOptions } from './encoder.js';
import { XzDecoder, AloneDecoder, RawDecoder, AutoDecoder, CHECK_UNKNOWN, decodeFilterProps } from './decoder.js';
import { CHECK_NONE, CHECK_CRC32, CHECK_CRC64, CHECK_SHA256, CHECK_ID_MAX, isCheckSupported } from './check.js';
import {
  FILTER_LZMA1, FILTER_LZMA2, FILTER_DELTA, FILTER_X86, FILTER_POWERPC, FILTER_IA64, FILTER_ARM,
  FILTER_ARMTHUMB, FILTER_SPARC, FILTER_ARM64, FILTER_RISCV,
} from './filters.js';
import { MF_HC3, MF_HC4, MF_BT2, MF_BT3, MF_BT4 } from './lz-encoder.js';

export {
  LzmaError, PRESET_DEFAULT, PRESET_EXTREME, CHECK_NONE, CHECK_CRC32, CHECK_CRC64, CHECK_SHA256,
  CHECK_ID_MAX, CHECK_UNKNOWN, isCheckSupported, FILTER_LZMA1, FILTER_LZMA2, FILTER_DELTA,
  FILTER_X86, FILTER_POWERPC, FILTER_IA64, FILTER_ARM, FILTER_ARMTHUMB, FILTER_SPARC, FILTER_ARM64,
  FILTER_RISCV, MF_HC3, MF_HC4, MF_BT2, MF_BT3, MF_BT4, filterProps, decodeFilterProps, validateChain,
  presetOptions,
};
// an LZMA1 / LZMA2 filter's options in full: its preset (default 6), then the fields it gives
export const resolveLzmaOptions = (f) => ({ ...lzmaOptions(f), id: f.id });

export class Compressor {
  constructor({ format = 'xz', check = -1, preset = null, filters = null } = {}) {
    if (format === 'xz') {
      const c = check === -1 ? CHECK_CRC64 : check;
      this._e = new XzEncoder(filters || [{ id: FILTER_LZMA2, preset: preset ?? PRESET_DEFAULT }], c);
    } else if (format === 'alone') {
      if (check !== -1 && check !== CHECK_NONE) throw new LzmaError('Invalid or unsupported options');
      if (filters && (filters.length !== 1 || filters[0].id !== FILTER_LZMA1)) throw new LzmaError('Invalid filter chain for FORMAT_ALONE - must be a single LZMA1 filter');
      this._e = new AloneEncoder(filters ? filters[0] : { preset: preset ?? PRESET_DEFAULT });
    } else if (format === 'raw') {
      if (!filters) throw new LzmaError('Must specify filters for FORMAT_RAW');
      if (check !== -1 && check !== CHECK_NONE) throw new LzmaError('Invalid or unsupported options');
      this._e = new RawStreamEncoder(filters);
    } else {
      throw new LzmaError('Invalid container format');
    }
  }
  compress(data) { return this._e.compress(data); }
  flush() { return this._e.flush(); }
}

export function Decompressor({ format = 'auto', memlimit = null, filters = null } = {}) {
  const ml = memlimit === null || memlimit === undefined ? Infinity : memlimit;
  if (format === 'raw') {
    if (!filters) throw new LzmaError('Must specify filters for FORMAT_RAW');
    return new RawDecoder(filters, ml);
  }
  if (filters) throw new LzmaError('Cannot specify filters except with FORMAT_RAW');
  if (format === 'xz') return new XzDecoder(ml);
  if (format === 'alone') return new AloneDecoder(ml);
  if (format === 'auto') return new AutoDecoder(ml);
  throw new LzmaError('Invalid container format');
}

export function compress(data, opts = {}) {
  const c = new Compressor(opts);
  return concat([c.compress(data), c.flush()]);
}

// as CPython's lzma.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
export function decompress(data, opts = {}) {
  const parts = [];
  while (true) {
    const d = Decompressor(opts);
    let res;
    try { res = d.decompress(data); } catch (e) {
      if (parts.length && e instanceof LzmaError) break;
      throw e;
    }
    parts.push(res);
    if (!d.eof) throw new LzmaError('Compressed data ended before the end-of-stream marker was reached');
    data = d.unusedData;
    if (!data.length) break;
  }
  return concat(parts);
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
