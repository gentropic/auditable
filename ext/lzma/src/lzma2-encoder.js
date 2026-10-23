// The LZMA2 encoder: lzma2_encoder.c of liblzma 5.8.1, ported — LZMA in chunks of at most 2 MiB
// uncompressed / 64 KiB compressed, each stored uncompressed instead when that is smaller; plus
// the LZMA2 / LZMA1 property bytes.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

import { LzmaEncoder, LZMA2_CHUNK_MAX, getDistSlot, lclppbByte } from './lzma-encoder.js';
import { MatchFinder, RUN } from './lz-encoder.js';

const LZMA2_UNCOMPRESSED_MAX = 1 << 21;
const LZMA2_HEADER_MAX = 6, LZMA2_HEADER_UNCOMPRESSED = 3;
const SEQ_INIT = 0, SEQ_LZMA_ENCODE = 1, SEQ_LZMA_COPY = 2, SEQ_UNCOMPRESSED_HEADER = 3, SEQ_UNCOMPRESSED_COPY = 4;

// lzma_lzma2_props_encode: the dictionary size as one byte
export function lzma2Props(dictSize) {
  let d = Math.max(dictSize, 4096) - 1;
  d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
  d >>>= 0;
  return d === 0xffffffff ? 40 : getDistSlot(d + 1) - 24;
}

// lzma_lzma_props_encode (LZMA1 / .lzma): lc/lp/pb byte, then the dictionary size LE
export function lzma1Props(o) {
  const out = new Uint8Array(5);
  out[0] = lclppbByte(o);
  out[1] = o.dictSize; out[2] = o.dictSize >>> 8; out[3] = o.dictSize >>> 16; out[4] = o.dictSize >>> 24;
  return out;
}

// LZMA2 over a window: write(data, finishing) consumes input; pull(out) emits the stream
export class Lzma2Encoder {
  constructor(options) {
    this.opt = options;
    this.lzma = new LzmaEncoder(options);
    const lz = LzmaEncoder.lzOptions(options);
    // (lzma2_encoder_init: room for a whole chunk before the dictionary)
    if (lz.beforeSize + lz.dictSize < LZMA2_CHUNK_MAX) lz.beforeSize = LZMA2_CHUNK_MAX - lz.dictSize;
    this.mf = new MatchFinder(lz);
    this.sequence = SEQ_INIT;
    this.needProperties = true;
    this.needStateReset = false;
    this.needDictionaryReset = true;
    this.uncompressedSize = 0;
    this.compressedSize = 0;
    this.bufPos = 0;
    this.buf = new Uint8Array(LZMA2_HEADER_MAX + LZMA2_CHUNK_MAX);
  }

  _headerLzma() {
    let pos;
    if (this.needProperties) {
      pos = 0;
      this.buf[pos] = this.needDictionaryReset ? 0x80 + (3 << 5) : 0x80 + (2 << 5);
    } else {
      pos = 1;
      this.buf[pos] = this.needStateReset ? 0x80 + (1 << 5) : 0x80;
    }
    this.bufPos = pos;
    let size = this.uncompressedSize - 1;
    this.buf[pos++] += size >>> 16;
    this.buf[pos++] = (size >>> 8) & 0xff;
    this.buf[pos++] = size & 0xff;
    size = this.compressedSize - 1;
    this.buf[pos++] = size >>> 8;
    this.buf[pos++] = size & 0xff;
    if (this.needProperties) this.buf[pos] = lclppbByte(this.opt);
    this.needProperties = false;
    this.needStateReset = false;
    this.needDictionaryReset = false;
    this.compressedSize += LZMA2_HEADER_MAX;
  }

  _headerUncompressed() {
    this.buf[0] = this.needDictionaryReset ? 1 : 2;
    this.needDictionaryReset = false;
    this.buf[1] = (this.uncompressedSize - 1) >>> 8;
    this.buf[2] = (this.uncompressedSize - 1) & 0xff;
    this.bufPos = 0;
  }

  // lzma2_encode, writing into out { buf, pos, size }: 'ok' (more input wanted, or out full),
  // 'end' (the end marker written, at FINISH)
  code(out) {
    const mf = this.mf;
    while (out.pos < out.size) {
      switch (this.sequence) {
        case SEQ_INIT: {
          if (mf.unencoded() === 0) {
            if (mf.action !== RUN) { out.buf[out.pos++] = 0; return 'end'; }
            return 'ok';
          }
          if (this.needStateReset) this.lzma.reset(this.opt);
          this.uncompressedSize = 0;
          this.compressedSize = 0;
          this.sequence = SEQ_LZMA_ENCODE;
        }
        // falls through
        case SEQ_LZMA_ENCODE: {
          const left = LZMA2_UNCOMPRESSED_MAX - this.uncompressedSize;
          let limit;
          if (left < mf.matchLenMax) limit = 0;
          else limit = (mf.readPos - mf.readAhead + left - mf.matchLenMax) >>> 0;
          const readStart = mf.readPos - mf.readAhead;
          // (the LZMA output is the chunk buffer past its header: its size test counts from there)
          const chunk = { buf: this._body || (this._body = this.buf.subarray(LZMA2_HEADER_MAX)), pos: this.compressedSize, size: LZMA2_CHUNK_MAX };
          const ret = this.lzma.encode(mf, chunk, limit);
          this.compressedSize = chunk.pos;
          this.uncompressedSize += mf.readPos - mf.readAhead - readStart;
          if (ret !== 'end') return 'ok';
          if (this.compressedSize >= this.uncompressedSize) {
            this.uncompressedSize += mf.readAhead;
            mf.readAhead = 0;
            this._headerUncompressed();
            this.needStateReset = true;
            this.sequence = SEQ_UNCOMPRESSED_HEADER;
            break;
          }
          this._headerLzma();
          this.sequence = SEQ_LZMA_COPY;
        }
        // falls through
        case SEQ_LZMA_COPY: {
          const end = this.compressedSize;
          const n = Math.min(end - this.bufPos, out.size - out.pos);
          out.buf.set(this.buf.subarray(this.bufPos, this.bufPos + n), out.pos);
          this.bufPos += n; out.pos += n;
          if (this.bufPos !== end) return 'ok';
          this.sequence = SEQ_INIT;
          break;
        }
        case SEQ_UNCOMPRESSED_HEADER: {
          const n = Math.min(LZMA2_HEADER_UNCOMPRESSED - this.bufPos, out.size - out.pos);
          out.buf.set(this.buf.subarray(this.bufPos, this.bufPos + n), out.pos);
          this.bufPos += n; out.pos += n;
          if (this.bufPos !== LZMA2_HEADER_UNCOMPRESSED) return 'ok';
          this.sequence = SEQ_UNCOMPRESSED_COPY;
        }
        // falls through
        case SEQ_UNCOMPRESSED_COPY: {
          // mf_read: the chunk's bytes, ending at the read position
          const n = Math.min(out.size - out.pos, this.uncompressedSize);
          out.buf.set(mf.buffer.subarray(mf.readPos - this.uncompressedSize, mf.readPos - this.uncompressedSize + n), out.pos);
          out.pos += n;
          this.uncompressedSize -= n;
          if (this.uncompressedSize !== 0) return 'ok';
          this.sequence = SEQ_INIT;
          break;
        }
      }
    }
    return 'ok';
  }
}
