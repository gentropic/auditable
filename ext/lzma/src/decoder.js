// Decoders: LZMA2 chunks and LZMA1 over LzmaCore, the filter chain over them, and the formats
// CPython's lzma reads — .xz (stream_decoder.c, block_decoder.c, block_header_decoder.c,
// index_hash.c, stream_flags_decoder.c), .lzma (alone_decoder.c), raw, and auto (the first byte
// tells .xz from .lzma) — each with CPython's LZMADecompressor face: decompress(data, maxLength),
// eof, needsInput, unusedData, check.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

import { LzmaCore, LzmaDataError, InputBuffer, lclppbDecode, lzma2DictSize } from './lzma-decoder.js';
import { makeFilterCoder, FILTER_LZMA1, FILTER_LZMA2, FILTER_DELTA, isBcj, RUN } from './filters.js';
import { Check, crc32, checkSize, isCheckSupported } from './check.js';
import { LzmaError, lzmaOptions, OPTIONS_ERROR } from './encoder.js';

export const CHECK_UNKNOWN = 16;
const FORMAT_ERROR = 'Input format not supported by decoder';
const DATA_ERROR = 'Corrupt input data';
const MEMLIMIT_ERROR = 'Memory usage limit exceeded';

// ── LZMA2 (lzma2_decoder.c): chunks, each LZMA or stored, with resets ──
const C_CONTROL = 0, C_UNC1 = 1, C_UNC2 = 2, C_COMP0 = 3, C_COMP1 = 4, C_PROPS = 5, C_LZMA = 6, C_COPY = 7, C_END = 8;
class Lzma2Source {
  constructor(inp, dictSize) {
    this.inp = inp;
    this.core = new LzmaCore(dictSize);
    this.seq = C_CONTROL;
    this.needProperties = true;
    this.needDictionaryReset = true;
    this.unc = 0; this.comp = 0; this.next = 0;
  }
  code(out, outPos, outSize) {
    const inp = this.inp, core = this.core;
    const o = { buf: out, pos: outPos, end: outSize };
    while (true) {
      if (this.seq === C_END) return { pos: o.pos, end: true };
      if (this.seq !== C_LZMA && this.seq !== C_COPY && inp.pos === inp.end) return { pos: o.pos, end: false };
      switch (this.seq) {
        case C_CONTROL: {
          const control = inp.buf[inp.pos++];
          if (control === 0x00) { this.seq = C_END; return { pos: o.pos, end: true }; }
          if (control >= 0xe0 || control === 1) {
            this.needProperties = true;
            this.needDictionaryReset = true;
          } else if (this.needDictionaryReset) {
            throw new LzmaDataError();
          }
          if (control >= 0x80) {
            this.unc = (control & 0x1f) << 16;
            this.seq = C_UNC1;
            if (control >= 0xc0) {
              this.needProperties = false;
              this.next = C_PROPS;
            } else if (this.needProperties) {
              throw new LzmaDataError();
            } else {
              this.next = C_LZMA;
              if (control >= 0xa0) core.resetState(core.lc, core.lp, core.pb);
              else core.rcReset();
            }
          } else {
            if (control > 2) throw new LzmaDataError();
            this.seq = C_COMP0;
            this.next = C_COPY;
          }
          if (this.needDictionaryReset) {
            this.needDictionaryReset = false;
            core.dict.reset();
          }
          break;
        }
        case C_UNC1: this.unc += inp.buf[inp.pos++] << 8; this.seq = C_UNC2; break;
        case C_UNC2: this.unc += inp.buf[inp.pos++] + 1; this.seq = C_COMP0; break;
        case C_COMP0: this.comp = inp.buf[inp.pos++] << 8; this.seq = C_COMP1; break;
        case C_COMP1:
          this.comp += inp.buf[inp.pos++] + 1;
          this.seq = this.next;
          if (this.seq === C_COPY) this.unc = this.comp;
          break;
        case C_PROPS: {
          const p = lclppbDecode(inp.buf[inp.pos++]);
          if (!p) throw new LzmaDataError();
          core.resetState(p[0], p[1], p[2]);
          this.seq = C_LZMA;
          break;
        }
        case C_LZMA: {
          // (the chunk's compressed bytes bound the input: none of the next chunk's is read)
          const end = inp.end, start = inp.pos;
          inp.end = Math.min(end, inp.pos + this.comp);
          const complete = inp.end - inp.pos === this.comp;
          try {
            if (core.initLeft > 0 && !core.rcInit(inp)) { this.comp -= inp.pos - start; return { pos: o.pos, end: false }; }
            if (this.unc > 0) {
              const before = o.pos;
              const r = core.decode(inp, o, this.unc, false);
              this.unc -= o.pos - before;
              if (r.why === 'out') { this.comp -= inp.pos - start; return { pos: o.pos, end: false }; }
              if (r.why === 'input') {
                if (complete) throw new LzmaDataError();
                this.comp -= inp.pos - start;
                return { pos: o.pos, end: false };
              }
              if (r.why === 'eopm') throw new LzmaDataError();
            }
            if (this.unc === 0) {
              const f = core.finishCheck(inp);
              if (f === false) throw new LzmaDataError();
              if (f === 'input') {
                if (complete) throw new LzmaDataError();
                this.comp -= inp.pos - start;
                return { pos: o.pos, end: false };
              }
            }
          } finally { inp.end = end; }
          this.comp -= inp.pos - start;
          if (this.comp !== 0) throw new LzmaDataError();
          this.seq = C_CONTROL;
          break;
        }
        case C_COPY: {
          // a stored chunk: its bytes into the dictionary and out
          const n = Math.min(this.unc, inp.end - inp.pos, o.end - o.pos);
          const d = core.dict;
          for (let i = 0; i < n; i++) { const b = inp.buf[inp.pos++]; d.put(b); o.buf[o.pos++] = b; }
          this.unc -= n;
          if (this.unc !== 0) return { pos: o.pos, end: false };
          this.seq = C_CONTROL;
          break;
        }
      }
    }
  }
}

// ── LZMA1 (.lzma, raw): an end marker, or a known size (then a marker may follow — allowEopm) ──
class Lzma1Source {
  constructor(inp, o, size, allowEopm) {
    this.inp = inp;
    this.core = new LzmaCore(Math.max(o.dictSize, 4096));
    this.core.resetState(o.lc, o.lp, o.pb);
    this.left = size;          // Infinity: unknown — the end marker ends it
    this.allowEopm = allowEopm;
    this.stage = 'data';       // 'data' → 'finish' (the size reached) → 'marker' → 'done'
  }
  code(out, outPos, outSize) {
    const inp = this.inp, core = this.core;
    const o = { buf: out, pos: outPos, end: outSize };
    if (this.stage === 'done') return { pos: o.pos, end: true };
    if (core.initLeft > 0 && !core.rcInit(inp)) return { pos: o.pos, end: false };
    if (this.stage === 'data') {
      if (this.left > 0) {
        const before = o.pos;
        const r = core.decode(inp, o, this.left, this.left === Infinity || this.allowEopm);
        this.left -= o.pos - before;
        if (r.why === 'eopm') { this.stage = 'done'; return { pos: o.pos, end: true }; }
        if (r.why !== 'limit') return { pos: o.pos, end: false };
      }
      this.stage = 'finish';
    }
    if (this.stage === 'finish') {
      const f = core.finishCheck(inp);
      if (f === 'input') return { pos: o.pos, end: false };
      if (f === true) { this.stage = 'done'; return { pos: o.pos, end: true }; }
      if (!this.allowEopm) throw new LzmaDataError();
      this.stage = 'marker';
    }
    if (core.expectEopm(inp) === 'input') return { pos: o.pos, end: false };
    this.stage = 'done';
    return { pos: o.pos, end: true };
  }
}

// the decoder chain for filters (first applied last): the LZ source at the bottom
function decoderChain(filters, inp, lzSource) {
  let src = lzSource;
  for (let i = filters.length - 2; i >= 0; i--) src = makeFilterCoder(filters[i], src, false);
  return src;
}

const memusage = (dictSize) => dictSize + 32768;

// ── the output, grown to maxLength (or without limit) ──
class Out {
  constructor(max) {
    this.max = max < 0 ? Infinity : max;
    this.buf = new Uint8Array(Math.min(this.max, 1 << 14));
    this.pos = 0;
  }
  room() { return this.buf.length - this.pos; }
  full() { return this.pos >= this.max; }
  grow() {
    const n = Math.min(this.max, Math.max(this.buf.length * 2, 1 << 14));
    if (n <= this.buf.length) return false;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
    return true;
  }
  result() { return this.buf.slice(0, this.pos); }
}

// the CPython-faced decompressor around a `step(out)` that returns 'end' | 'input' | 'out'
class Decompressor {
  constructor() {
    this.eof = false;
    this.needsInput = true;
    this.unusedData = new Uint8Array(0);
    this.check = CHECK_UNKNOWN;
    this.inp = new InputBuffer();
    this._broken = null;
  }
  decompress(data, maxLength = -1) {
    if (this.eof) throw new Error('lzma: end of stream already reached');
    if (this._broken) throw this._broken;
    const inp = this.inp;
    const rest = inp.buf.subarray(inp.pos, inp.end);
    const b = new Uint8Array(rest.length + data.length);
    b.set(rest); b.set(data, rest.length);
    inp.buf = b; inp.pos = 0; inp.end = b.length;
    const out = new Out(maxLength);
    let why;
    try {
      while (true) {
        why = this._step(out);
        if (why === 'end') { this.eof = true; break; }
        if (why === 'out') { if (out.full() || !out.grow()) break; continue; }
        break;   // 'input'
      }
    } catch (e) {
      this._broken = e instanceof LzmaDataError ? new LzmaError(DATA_ERROR) : e;
      throw this._broken;
    }
    if (this.eof) {
      this.needsInput = false;
      if (inp.pos < inp.end) this.unusedData = inp.buf.slice(inp.pos, inp.end);
    } else if (why === 'input' || inp.pos === inp.end) {
      // (input held inside a symbol not yet whole is consumed, as liblzma's range decoder has it)
      this.needsInput = !out.full();
    } else {
      this.needsInput = false;
    }
    return out.result();
  }
  // pull from a chain into out: 'end' | 'input' | 'out'
  _pull(chain, out) {
    if (out.room() === 0) return 'out';
    const r = chain.code(out.buf, out.pos, Math.min(out.buf.length, out.max), RUN);
    const made = r.pos - out.pos;
    out.pos = r.pos;
    this._lastMade = made;
    if (r.end) return 'end';
    if (out.room() === 0) return 'out';
    return 'input';
  }
}

// ── raw ──
export class RawDecoder extends Decompressor {
  constructor(filters, memlimit = Infinity) {
    super();
    if (!filters.length || filters.length > 4) throw new LzmaError(OPTIONS_ERROR);
    const last = filters[filters.length - 1];
    const o = lzmaOptions(last);
    if (memusage(o.dictSize) > memlimit) throw new LzmaError(MEMLIMIT_ERROR);
    const lz = last.id === FILTER_LZMA2 ? new Lzma2Source(this.inp, o.dictSize) : new Lzma1Source(this.inp, o, Infinity, true);
    if (last.id === FILTER_LZMA2) lz.core.resetState(o.lc, o.lp, o.pb);
    this.chain = decoderChain(filters, this.inp, lz);
    this.check = 0;   // (CHECK_NONE)
  }
  _step(out) {
    const r = this._pull(this.chain, out);
    return r;
  }
}

// ── .lzma: 13-byte header, then LZMA1 ──
export class AloneDecoder extends Decompressor {
  // picky (as the auto decoder is): the dictionary size 2^n or 2^n + 2^(n-1), a known size < 2^38
  constructor(memlimit = Infinity, picky = false) { super(); this.memlimit = memlimit; this.picky = picky; this.src = null; this.check = 0; }
  _step(out) {
    const inp = this.inp;
    if (!this.src) {
      // (checked as its bytes come, as liblzma reads it: a bad first byte fails at once)
      const have = inp.end - inp.pos;
      if (have >= 1 && !lclppbDecode(inp.buf[inp.pos])) throw new LzmaError(FORMAT_ERROR);
      if (have >= 5 && this.picky) {
        const ds = (inp.buf[inp.pos + 1] | (inp.buf[inp.pos + 2] << 8) | (inp.buf[inp.pos + 3] << 16) | (inp.buf[inp.pos + 4] << 24)) >>> 0;
        let d = ds - 1;
        d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
        if (ds !== 0xffffffff && ((d >>> 0) + 1) !== ds) throw new LzmaError(FORMAT_ERROR);
      }
      if (have < 13) return 'input';
      const h = inp.buf.subarray(inp.pos, inp.pos + 13);
      const p = lclppbDecode(h[0]);
      const dictSize = (h[1] | (h[2] << 8) | (h[3] << 16) | (h[4] << 24)) >>> 0;
      let size = 0n;
      for (let i = 12; i >= 5; i--) size = (size << 8n) | BigInt(h[i]);
      const unknown = size === 0xffffffffffffffffn;
      if (this.picky) {
        if (dictSize !== 0xffffffff) {
          let d = dictSize - 1;
          d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
          if (((d >>> 0) + 1) !== dictSize) throw new LzmaError(FORMAT_ERROR);
        }
        if (!unknown && size >= (1n << 38n)) throw new LzmaError(FORMAT_ERROR);
      }
      if (memusage(dictSize) > this.memlimit) throw new LzmaError(MEMLIMIT_ERROR);
      inp.pos += 13;
      this.src = new Lzma1Source(inp, { dictSize, lc: p[0], lp: p[1], pb: p[2] }, unknown ? Infinity : Number(size), true);
    }
    return this._pull(this.src, out);
  }
}

// ── .xz ──
const S_HEADER = 0, S_BLOCK_START = 1, S_BLOCK_HEADER = 2, S_BLOCK = 3, S_PADDING = 4, S_CHECK = 5, S_INDEX = 6, S_FOOTER = 7;
const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];

function vliDecode(buf, pos, end) {
  let v = 0n, shift = 0n;
  for (let i = 0; i < 9; i++) {
    if (pos + i >= end) return null;
    const b = buf[pos + i];
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) {
      if (b === 0 && i > 0) throw new LzmaDataError();
      return [v, i + 1];
    }
    shift += 7n;
  }
  throw new LzmaDataError();
}

export class XzDecoder extends Decompressor {
  constructor(memlimit = Infinity) {
    super();
    this.memlimit = memlimit;
    this.seq = S_HEADER;
    this.records = [];
  }
  _need(n) { return this.inp.end - this.inp.pos >= n; }
  _step(out) {
    const inp = this.inp;
    while (true) {
      switch (this.seq) {
        case S_HEADER: {
          if (!this._need(12)) return 'input';
          const h = inp.buf.subarray(inp.pos, inp.pos + 12);
          for (let i = 0; i < 6; i++) if (h[i] !== MAGIC[i]) throw new LzmaError(FORMAT_ERROR);
          const crc = (h[8] | (h[9] << 8) | (h[10] << 16) | (h[11] << 24)) >>> 0;
          if (crc32(h, 0, 6, 8) !== crc) throw new LzmaDataError();
          if (h[6] !== 0 || (h[7] & 0xf0)) throw new LzmaError(OPTIONS_ERROR);
          this.flags = [h[6], h[7]];
          this.check = h[7];
          inp.pos += 12;
          this.seq = S_BLOCK_START;
          break;
        }
        case S_BLOCK_START: {
          if (!this._need(1)) return 'input';
          if (inp.buf[inp.pos] === 0x00) { this.seq = S_INDEX; break; }
          this.headerSize = (inp.buf[inp.pos] + 1) * 4;
          this.seq = S_BLOCK_HEADER;
          break;
        }
        case S_BLOCK_HEADER: {
          if (!this._need(this.headerSize)) return 'input';
          this._blockHeader(inp.buf.subarray(inp.pos, inp.pos + this.headerSize));
          inp.pos += this.headerSize;
          this.seq = S_BLOCK;
          break;
        }
        case S_BLOCK: {
          // (the input buffer is rebuilt per call: measure what this pull took)
          const before = out.pos, inStart = inp.pos;
          const r = this._pull(this.chain, out);
          if (out.pos > before) this.blockCheck.update(out.buf, before, out.pos);
          this.blockUncompressed += out.pos - before;
          this.blockCompressed += inp.pos - inStart;
          if (this.declUncompressed !== null && this.blockUncompressed > this.declUncompressed) throw new LzmaDataError();
          if (this.declCompressed !== null && this.blockCompressed > this.declCompressed) throw new LzmaDataError();
          if (r !== 'end') return r;
          if (this.declUncompressed !== null && this.blockUncompressed !== this.declUncompressed) throw new LzmaDataError();
          if (this.declCompressed !== null && this.blockCompressed !== this.declCompressed) throw new LzmaDataError();
          this.seq = S_PADDING;
          break;
        }
        case S_PADDING: {
          // (the index records the block's size before its padding)
          while ((this.blockCompressed + this.padded) & 3) {
            if (!this._need(1)) return 'input';
            if (inp.buf[inp.pos++] !== 0) throw new LzmaDataError();
            ++this.padded;
          }
          this.seq = S_CHECK;
          this.unpaddedNoCheck = this.headerSize + this.blockCompressed;
          break;
        }
        case S_CHECK: {
          const n = checkSize(this.check);
          if (!this._need(n)) return 'input';
          if (isCheckSupported(this.check) && this.check !== 0) {
            const want = this.blockCheck.finish();
            for (let i = 0; i < n; i++) if (inp.buf[inp.pos + i] !== want[i]) throw new LzmaDataError();
          }
          inp.pos += n;
          this.records.push([BigInt(this.unpaddedNoCheck + n), BigInt(this.blockUncompressed)]);
          this.seq = S_BLOCK_START;
          break;
        }
        case S_INDEX: {
          // (read whole: indicator, count, records, padding, CRC32)
          const r = this._index();
          if (r === null) return 'input';
          this.indexSize = r;
          this.seq = S_FOOTER;
          break;
        }
        case S_FOOTER: {
          if (!this._need(12)) return 'input';
          const f = inp.buf.subarray(inp.pos, inp.pos + 12);
          if (f[10] !== 0x59 || f[11] !== 0x5a) throw new LzmaDataError();
          const crc = (f[0] | (f[1] << 8) | (f[2] << 16) | (f[3] << 24)) >>> 0;
          if (crc32(f, 0, 4, 10) !== crc) throw new LzmaDataError();
          const backward = ((f[4] | (f[5] << 8) | (f[6] << 16) | (f[7] << 24)) >>> 0) + 1;
          if (backward * 4 !== this.indexSize) throw new LzmaDataError();
          if (f[8] !== this.flags[0] || f[9] !== this.flags[1]) throw new LzmaDataError();
          inp.pos += 12;
          return 'end';
        }
      }
    }
  }
  _blockHeader(h) {
    const size = h.length;
    const crc = (h[size - 4] | (h[size - 3] << 8) | (h[size - 2] << 16) | (h[size - 1] << 24)) >>> 0;
    if (crc32(h, 0, 0, size - 4) !== crc) throw new LzmaDataError();
    const flags = h[1];
    if (flags & 0x3c) throw new LzmaError(OPTIONS_ERROR);
    let pos = 2;
    const end = size - 4;
    this.declCompressed = null; this.declUncompressed = null;
    if (flags & 0x40) { const v = vliDecode(h, pos, end); if (!v || v[0] === 0n) throw new LzmaDataError(); this.declCompressed = Number(v[0]); pos += v[1]; }
    if (flags & 0x80) { const v = vliDecode(h, pos, end); if (!v) throw new LzmaDataError(); this.declUncompressed = Number(v[0]); pos += v[1]; }
    const count = (flags & 3) + 1;
    const filters = [];
    for (let i = 0; i < count; i++) {
      const idv = vliDecode(h, pos, end); if (!idv) throw new LzmaDataError(); pos += idv[1];
      const psv = vliDecode(h, pos, end); if (!psv) throw new LzmaDataError(); pos += psv[1];
      const ps = Number(psv[0]);
      if (pos + ps > end) throw new LzmaDataError();
      filters.push(decodeFilterProps(idv[0], h.subarray(pos, pos + ps)));
      pos += ps;
    }
    for (; pos < end; pos++) if (h[pos] !== 0) throw new LzmaError(OPTIONS_ERROR);
    const last = filters[filters.length - 1];
    if (last.id !== FILTER_LZMA2) throw new LzmaError(OPTIONS_ERROR);
    for (let i = 0; i < filters.length - 1; i++) if (!(filters[i].id === FILTER_DELTA || isBcj(filters[i].id))) throw new LzmaError(OPTIONS_ERROR);
    if (memusage(last.dictSize) > this.memlimit) throw new LzmaError(MEMLIMIT_ERROR);
    this.chain = decoderChain(filters, this.inp, new Lzma2Source(this.inp, last.dictSize));
    this.blockCheck = new Check(isCheckSupported(this.check) ? this.check : 0);
    this.blockCompressed = 0;
    this.blockUncompressed = 0;
    this.padded = 0;
  }

  _index() {
    const inp = this.inp;
    const buf = inp.buf;
    let pos = inp.pos;
    const end = inp.end;
    if (pos >= end) return null;
    if (buf[pos] !== 0x00) throw new LzmaDataError();
    pos++;
    const cv = vliDecode(buf, pos, end); if (!cv) return null; pos += cv[1];
    if (Number(cv[0]) !== this.records.length) throw new LzmaDataError();
    for (const [unpadded, uncompressed] of this.records) {
      const a = vliDecode(buf, pos, end); if (!a) return null; pos += a[1];
      const b = vliDecode(buf, pos, end); if (!b) return null; pos += b[1];
      if (a[0] !== unpadded || b[0] !== uncompressed) throw new LzmaDataError();
    }
    while ((pos - inp.pos) & 3) { if (pos >= end) return null; if (buf[pos++] !== 0) throw new LzmaDataError(); }
    if (pos + 4 > end) return null;
    const crc = (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
    if (crc32(buf, 0, inp.pos, pos) !== crc) throw new LzmaDataError();
    pos += 4;
    const size = pos - inp.pos;
    inp.pos = pos;
    return size;
  }
}

// a filter's options from its ID and property bytes (lzma_properties_decode)
export function decodeFilterProps(id, props) {
  const n = typeof id === 'bigint' ? id : BigInt(id);
  if (n === BigInt(FILTER_LZMA2)) {
    if (props.length !== 1) throw new LzmaError(OPTIONS_ERROR);
    const dictSize = lzma2DictSize(props[0]);
    if (dictSize === null) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_LZMA2, dictSize };
  }
  if (n === FILTER_LZMA1) {
    if (props.length !== 5) throw new LzmaError(OPTIONS_ERROR);
    const p = lclppbDecode(props[0]);
    if (!p) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_LZMA1, lc: p[0], lp: p[1], pb: p[2], dictSize: (props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0 };
  }
  if (n === BigInt(FILTER_DELTA)) {
    if (props.length !== 1) throw new LzmaError(OPTIONS_ERROR);
    return { id: FILTER_DELTA, dist: props[0] + 1 };
  }
  const small = Number(n);
  if (n < 0x100n && isBcj(small)) {
    if (props.length === 0) return { id: small };
    if (props.length !== 4) throw new LzmaError(OPTIONS_ERROR);
    return { id: small, start_offset: (props[0] | (props[1] << 8) | (props[2] << 16) | (props[3] << 24)) >>> 0 };
  }
  throw new LzmaError(OPTIONS_ERROR);
}

// ── auto: .xz by its first byte, .lzma otherwise (auto_decoder.c) ──
export class AutoDecoder extends Decompressor {
  constructor(memlimit = Infinity) { super(); this.memlimit = memlimit; this.inner = null; }
  _step(out) {
    if (!this.inner) {
      if (this.inp.pos === this.inp.end) return 'input';
      this.inner = this.inp.buf[this.inp.pos] === 0xfd ? new XzDecoder(this.memlimit) : new AloneDecoder(this.memlimit, true);
      this.inner.inp = this.inp;
      this.inner._pull = this._pull.bind(this.inner);
    }
    const r = this.inner._step(out);
    this.check = this.inner.check;
    return r;
  }
}
