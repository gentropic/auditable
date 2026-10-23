// Encoders over a filter chain, in the three formats CPython's lzma writes: .xz (stream_encoder.c,
// block_encoder.c, block_header_encoder.c, index_encoder.c, stream_flags_encoder.c), .lzma
// (alone_encoder.c) and raw (filter_encoder.c) — liblzma 5.8.1's, ported, so the bytes are its.
// The output only grows: every coder below resumes where it stopped when it filled it.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

import { LzmaEncoder } from './lzma-encoder.js';
import { Lzma2Encoder, lzma2Props, lzma1Props } from './lzma2-encoder.js';
import { MatchFinder, RUN, MF_HC3, MF_HC4, MF_BT4 } from './lz-encoder.js';
import { InputSource, makeFilterCoder, FILTER_LZMA1, FILTER_LZMA2, FILTER_DELTA, isBcj } from './filters.js';
import { Check, crc32, checkSize, isCheckSupported, CHECK_ID_MAX } from './check.js';

export const FINISH = 3;
export const PRESET_DEFAULT = 6, PRESET_EXTREME = 0x80000000;

export class LzmaError extends Error {
  constructor(message) { super(message); this.name = 'LzmaError'; }
}
export const OPTIONS_ERROR = 'Invalid or unsupported options';

// lzma_lzma_preset: the LZMA options of a preset 0..9 (| PRESET_EXTREME)
export function presetOptions(preset) {
  const level = preset & 0x1f, flags = (preset & ~0x1f) >>> 0;
  if (level > 9 || (flags & ~PRESET_EXTREME)) throw new LzmaError(`Invalid compression preset: ${preset >>> 0}`);
  const dictPow2 = [18, 20, 21, 22, 22, 23, 23, 24, 25, 26];
  const o = { lc: 3, lp: 0, pb: 2, dictSize: 2 ** dictPow2[level] };
  if (level <= 3) {
    o.mode = 'fast';
    o.mf = level === 0 ? MF_HC3 : MF_HC4;
    o.niceLen = level <= 1 ? 128 : 273;
    o.depth = [4, 8, 24, 48][level];
  } else {
    o.mode = 'normal';
    o.mf = MF_BT4;
    o.niceLen = level === 4 ? 16 : level === 5 ? 32 : 64;
    o.depth = 0;
  }
  if (flags & PRESET_EXTREME) {
    o.mode = 'normal';
    o.mf = MF_BT4;
    if (level === 3 || level === 5) { o.niceLen = 192; o.depth = 0; } else { o.niceLen = 273; o.depth = 512; }
  }
  return o;
}

// a filter's property bytes (lzma_properties_encode)
export function filterProps(f) {
  if (f.id === FILTER_LZMA2) return Uint8Array.of(lzma2Props(f.dictSize));
  if (f.id === FILTER_LZMA1) return lzma1Props(f);
  if (f.id === FILTER_DELTA) {
    const dist = f.dist ?? 1;
    if (!(dist >= 1 && dist <= 256)) throw new LzmaError(OPTIONS_ERROR);
    return Uint8Array.of(dist - 1);
  }
  if (isBcj(f.id)) {
    const s = f.start_offset ?? 0;
    return s === 0 ? new Uint8Array(0) : Uint8Array.of(s, s >>> 8, s >>> 16, s >>> 24);
  }
  throw new LzmaError(OPTIONS_ERROR);
}

// lzma_validate_chain: 1..4 filters, the last (and only the last) LZMA1 / LZMA2
export function validateChain(filters) {
  if (!filters.length || filters.length > 4) throw new LzmaError(OPTIONS_ERROR);
  filters.forEach((f, i) => {
    const isLz = f.id === FILTER_LZMA1 || f.id === FILTER_LZMA2;
    const known = isLz || f.id === FILTER_DELTA || isBcj(f.id);
    if (!known || isLz !== (i === filters.length - 1)) throw new LzmaError(OPTIONS_ERROR);
  });
}

function vliEncode(v, out) {
  let n = BigInt(v);
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) b |= 0x80;
    out.push(b);
  } while (n !== 0n);
}
const vliSize = (v) => { const a = []; vliEncode(v, a); return a.length; };

// the growing output
class Out {
  constructor() { this.buf = new Uint8Array(1 << 16); this.pos = 0; this.size = this.buf.length; }
  grow() {
    const b = new Uint8Array(this.buf.length * 2);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b; this.size = b.length;
  }
  push(bytes) { while (this.pos + bytes.length > this.size) this.grow(); this.buf.set(bytes, this.pos); this.pos += bytes.length; }
  take() { const r = this.buf.slice(0, this.pos); this.pos = 0; return r; }
}

// ── the raw encoder: the filters, then LZMA1 / LZMA2 over the window (lz_encode) ──
class RawEncoder {
  constructor(filters) {
    validateChain(filters);
    this.input = new InputSource();
    let src = this.input;
    for (let i = 0; i < filters.length - 1; i++) src = makeFilterCoder(filters[i], src, true);
    this.source = src;
    const last = filters[filters.length - 1];
    const o = lzmaOptions(last);
    if (last.id === FILTER_LZMA2) {
      this.lz = new Lzma2Encoder(o);
      this.mf = this.lz.mf;
    } else {
      const lzma = new LzmaEncoder(o, { isLzma1: true });
      this.mf = new MatchFinder(LzmaEncoder.lzOptions(o));
      const mf = this.mf;
      this.lz = { code: (out) => lzma.encode(mf, out, 0xffffffff) };
    }
    this.action = RUN;
  }
  // feed data (consumed as it goes); 'end' once FINISH has been encoded to the end
  code(data, out, action) {
    this.input.data = data;
    this.input.pos = 0;
    const mf = this.mf;
    const produce = (buf, writePos, size) => this.source.code(buf, writePos, size, action);
    while (true) {
      while (out.pos < out.size && (this.input.pos < this.input.data.length || action !== RUN)) {
        if (mf.action === RUN && mf.readPos >= mf.readLimit) mf.fill(produce, action);
        const ret = this.lz.code(out);
        if (ret !== 'ok') { mf.action = RUN; return ret; }
      }
      if (out.pos < out.size) return 'ok';   // the input is used up
      out.grow();
    }
  }
}

// the LZMA options of an LZMA1 / LZMA2 filter spec (a preset, with the spec's fields over it)
export function lzmaOptions(f) {
  const o = presetOptions(f.preset ?? PRESET_DEFAULT);
  for (const k of ['dictSize', 'lc', 'lp', 'pb', 'mode', 'niceLen', 'mf', 'depth']) if (f[k] !== undefined && f[k] !== null) o[k] = f[k];
  if (!(o.dictSize >= 4096 && o.dictSize <= (1 << 30) + (1 << 29))) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.lc <= 4 && o.lp <= 4 && o.lc + o.lp <= 4 && o.pb <= 4)) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.niceLen >= 2 && o.niceLen <= 273) || !['fast', 'normal'].includes(o.mode)) throw new LzmaError(OPTIONS_ERROR);
  if (![0x03, 0x04, 0x12, 0x13, 0x14].includes(o.mf)) throw new LzmaError(OPTIONS_ERROR);
  return o;
}

// ── raw: the filter chain's output, nothing around it ──
export class RawStreamEncoder {
  constructor(filters) { this.raw = new RawEncoder(filters); this.out = new Out(); }
  compress(data) { this.raw.code(data, this.out, RUN); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH); return this.out.take(); }
}

// ── .lzma (LZMA_Alone): 13-byte header (props, dictionary size rounded up, size unknown) ──
export class AloneEncoder {
  constructor(lzmaFilter) {
    const o = lzmaOptions(lzmaFilter);
    let d = o.dictSize - 1;
    d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
    d >>>= 0;
    if (d !== 0xffffffff) ++d;
    const header = new Uint8Array(13);
    header.set(lzma1Props({ ...o, dictSize: 0 }).subarray(0, 1));
    header[1] = d; header[2] = d >>> 8; header[3] = d >>> 16; header[4] = d >>> 24;
    header.fill(0xff, 5);
    this.raw = new RawEncoder([{ ...lzmaFilter, id: FILTER_LZMA1 }]);
    this.out = new Out();
    this.out.push(header);
  }
  compress(data) { this.raw.code(data, this.out, RUN); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH); return this.out.take(); }
}

// ── .xz ──
const HEADER_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const FOOTER_MAGIC = [0x59, 0x5a];

function streamFlags(check) { return [0x00, check]; }
function le32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

export function streamHeader(check) {
  const flags = streamFlags(check);
  return Uint8Array.from([...HEADER_MAGIC, ...flags, ...le32(crc32(Uint8Array.from(flags)))]);
}

// lzma_block_header_size + lzma_block_header_encode (sizes unknown, as the stream encoder writes)
export function blockHeader(filters) {
  const ff = [];
  for (const f of filters) {
    const props = filterProps(f);
    vliEncode(f.id, ff);
    vliEncode(props.length, ff);
    ff.push(...props);
  }
  const size = 1 + 1 + 4 + ff.length;
  const headerSize = (size + 3) & ~3;
  const out = new Uint8Array(headerSize);
  out[0] = (headerSize - 4) / 4;
  out[1] = filters.length - 1;
  out.set(ff, 2);
  const crc = crc32(out, 0, 0, headerSize - 4);
  out.set(le32(crc), headerSize - 4);
  return out;
}

export function indexAndFooter(records, check) {
  const idx = [0x00];
  vliEncode(records.length, idx);
  for (const r of records) { vliEncode(r.unpadded, idx); vliEncode(r.uncompressed, idx); }
  while ((idx.length + 4) & 3) idx.push(0);
  const index = Uint8Array.from(idx);
  const indexFull = new Uint8Array(index.length + 4);
  indexFull.set(index);
  indexFull.set(le32(crc32(index)), index.length);
  const backward = indexFull.length / 4 - 1;
  const ft = [...le32(backward), ...streamFlags(check)];
  const footer = Uint8Array.from([...le32(crc32(Uint8Array.from(ft))), ...ft, ...FOOTER_MAGIC]);
  return [indexFull, footer];
}

export class XzEncoder {
  // filters: the chain (last LZMA2); check: 0 none, 1 CRC32, 4 CRC64, 10 SHA-256
  constructor(filters, check) {
    if (!(check >= 0 && check <= CHECK_ID_MAX)) throw new LzmaError('Invalid or unsupported options');
    if (!isCheckSupported(check)) throw new LzmaError('Unsupported integrity check');
    validateChain(filters);
    if (filters[filters.length - 1].id !== FILTER_LZMA2) throw new LzmaError(OPTIONS_ERROR);
    this.filters = filters.map((f) => (f.id === FILTER_LZMA2 ? { ...f, ...lzmaOptions(f) } : f));
    this.check = check;
    this.out = new Out();
    this.out.push(streamHeader(check));
    this.records = [];
    this.block = null;   // the open block: { raw, check, compressed, uncompressed, headerSize }
  }
  _openBlock() {
    const header = blockHeader(this.filters);
    this.out.push(header);
    this.block = { raw: new RawEncoder(this.filters), check: new Check(this.check), compressed: 0, uncompressed: 0, headerSize: header.length };
  }
  _code(data, action) {
    const b = this.block;
    const start = this.out.pos;
    const ret = b.raw.code(data, this.out, action);
    b.compressed += this.out.pos - start;
    b.uncompressed += data.length;
    if (data.length) b.check.update(data);
    return ret;
  }
  compress(data) {
    // (stream_encode's SEQ_BLOCK_INIT: a block starts when there is input)
    if (data.length) {
      if (!this.block) this._openBlock();
      this._code(data, RUN);
    }
    return this.out.take();
  }
  flush() {
    if (this.block) {
      this._code(new Uint8Array(0), FINISH);
      const b = this.block;
      // (the block's compressed size is the data's: the index records it before the padding)
      this.records.push({ unpadded: b.headerSize + b.compressed + checkSize(this.check), uncompressed: b.uncompressed });
      for (let c = b.compressed; c & 3; ++c) this.out.push(Uint8Array.of(0));
      this.out.push(b.check.finish());
      this.block = null;
    }
    const [index, footer] = indexAndFooter(this.records, this.check);
    this.out.push(index);
    this.out.push(footer);
    return this.out.take();
  }
}

export { vliEncode, vliSize };
