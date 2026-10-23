// The filters before (or, decoding, after) LZMA: delta (delta_*.c) and the branch / call /
// jump converters (simple_coder.c and simple/*.c — x86, PowerPC, IA-64, ARM, ARM-Thumb, ARM64,
// SPARC, RISC-V) of liblzma 5.8.1, ported. A coder fills out[outPos..outSize) from its `next` —
// the input, or another coder — and reports whether that was the end; liblzma's chain the same
// way round, encoding and decoding alike.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

export const RUN = 0, FINISH = 3;

// the raw input of an encoder chain: set .data / .pos, then pull
export class InputSource {
  constructor() { this.data = new Uint8Array(0); this.pos = 0; }
  code(out, outPos, outSize, action) {
    const n = Math.min(this.data.length - this.pos, outSize - outPos);
    if (n > 0) out.set(this.data.subarray(this.pos, this.pos + n), outPos);
    this.pos += n;
    return { pos: outPos + n, end: action !== RUN && this.pos === this.data.length };
  }
}

// ── delta ──
export class DeltaCoder {
  constructor(next, dist, isEncoder) {
    if (!(dist >= 1 && dist <= 256)) throw new RangeError('lzma: delta distance must be 1..256');
    this.next = next; this.distance = dist; this.isEncoder = isEncoder;
    this.history = new Uint8Array(256); this.pos = 0;
  }
  code(out, outPos, outSize, action) {
    const r = this.next.code(out, outPos, outSize, action);
    const h = this.history, d = this.distance;
    if (this.isEncoder) {
      for (let i = outPos; i < r.pos; ++i) {
        const tmp = h[(d + this.pos) & 0xff];
        h[this.pos-- & 0xff] = out[i];
        out[i] = (out[i] - tmp) & 0xff;
      }
    } else {
      for (let i = outPos; i < r.pos; ++i) {
        out[i] = (out[i] + h[(d + this.pos) & 0xff]) & 0xff;
        h[this.pos-- & 0xff] = out[i];
      }
    }
    return r;
  }
}

// ── BCJ: simple_coder.c's buffering around a filter kernel ──
export class SimpleCoder {
  // kernel(state, nowPos, isEncoder, buffer, start, size) → bytes filtered
  constructor(next, kernel, unfilteredMax, alignment, isEncoder, startOffset = 0, state = null) {
    if (startOffset & (alignment - 1)) throw new RangeError('lzma: start_offset is not aligned for this filter');
    this.next = next; this.kernel = kernel; this.isEncoder = isEncoder; this.state = state;
    this.nowPos = startOffset >>> 0;
    this.allocated = 2 * unfilteredMax;
    this.buffer = new Uint8Array(this.allocated);
    this.endWasReached = false;
    this.pos = 0; this.filtered = 0; this.size = 0;
  }
  _callFilter(buf, start, size) {
    const filtered = this.kernel(this.state, this.nowPos, this.isEncoder, buf, start, size);
    this.nowPos = (this.nowPos + filtered) >>> 0;
    return filtered;
  }
  _copyOrCode(out, outPos, outSize, action) {
    const r = this.next.code(out, outPos, outSize, action);
    if (r.end) this.endWasReached = true;
    return r.pos;
  }
  code(out, outPos, outSize, action) {
    if (this.pos < this.filtered) {
      const n = Math.min(this.filtered - this.pos, outSize - outPos);
      out.set(this.buffer.subarray(this.pos, this.pos + n), outPos);
      this.pos += n; outPos += n;
      if (this.pos < this.filtered) return { pos: outPos, end: false };
      if (this.endWasReached) return { pos: outPos, end: true };
    }
    this.filtered = 0;
    const outAvail = outSize - outPos;
    const bufAvail = this.size - this.pos;
    if (outAvail > bufAvail || bufAvail === 0) {
      const outStart = outPos;
      if (bufAvail > 0) out.set(this.buffer.subarray(this.pos, this.pos + bufAvail), outPos);
      outPos += bufAvail;
      outPos = this._copyOrCode(out, outPos, outSize, action);
      const size = outPos - outStart;
      const filtered = size === 0 ? 0 : this._callFilter(out, outStart, size);
      const unfiltered = size - filtered;
      this.pos = 0;
      this.size = unfiltered;
      if (this.endWasReached) {
        this.size = 0;
      } else if (unfiltered > 0) {
        outPos -= unfiltered;
        this.buffer.set(out.subarray(outPos, outPos + unfiltered), 0);
      }
    } else if (this.pos > 0) {
      this.buffer.copyWithin(0, this.pos, this.pos + bufAvail);
      this.size -= this.pos;
      this.pos = 0;
    }
    if (this.size > 0) {
      this.size = this._copyOrCode(this.buffer, this.size, this.allocated, action);
      this.filtered = this._callFilter(this.buffer, 0, this.size);
      if (this.endWasReached) this.filtered = this.size;
      const n = Math.min(this.filtered - this.pos, outSize - outPos);
      out.set(this.buffer.subarray(this.pos, this.pos + n), outPos);
      this.pos += n; outPos += n;
    }
    return { pos: outPos, end: this.endWasReached && this.pos === this.size };
  }
}

// ── the kernels (buffer[start .. start + size)) ──

const test86 = (b) => b === 0 || b === 0xff;
const MASK_TO_BIT_NUMBER = [0, 1, 2, 2, 3];
function x86(s, nowPos, isEncoder, buf, start, size) {
  let prevMask = s.prevMask, prevPos = s.prevPos;
  if (size < 5) return 0;
  if (((nowPos - prevPos) >>> 0) > 5) prevPos = (nowPos - 5) >>> 0;
  const limit = size - 5;
  let bp = 0;
  while (bp <= limit) {
    let b = buf[start + bp];
    if (b !== 0xe8 && b !== 0xe9) { ++bp; continue; }
    const offset = (nowPos + bp - prevPos) >>> 0;
    prevPos = (nowPos + bp) >>> 0;
    if (offset > 5) {
      prevMask = 0;
    } else {
      for (let i = 0; i < offset; ++i) { prevMask &= 0x77; prevMask <<= 1; }
    }
    b = buf[start + bp + 4];
    if (test86(b) && (prevMask >>> 1) <= 4 && (prevMask >>> 1) !== 3) {
      let src = ((b << 24) | (buf[start + bp + 3] << 16) | (buf[start + bp + 2] << 8) | buf[start + bp + 1]) >>> 0;
      let dest;
      while (true) {
        if (isEncoder) dest = (src + (nowPos + bp + 5)) >>> 0;
        else dest = (src - (nowPos + bp + 5)) >>> 0;
        if (prevMask === 0) break;
        const i = MASK_TO_BIT_NUMBER[prevMask >>> 1];
        b = (dest >>> (24 - i * 8)) & 0xff;
        if (!test86(b)) break;
        src = (dest ^ ((2 ** (32 - i * 8)) - 1)) >>> 0;
      }
      buf[start + bp + 4] = ~(((dest >>> 24) & 1) - 1) & 0xff;
      buf[start + bp + 3] = dest >>> 16;
      buf[start + bp + 2] = dest >>> 8;
      buf[start + bp + 1] = dest;
      bp += 5;
      prevMask = 0;
    } else {
      ++bp;
      prevMask |= 1;
      if (test86(b)) prevMask |= 0x10;
    }
  }
  s.prevMask = prevMask; s.prevPos = prevPos;
  return bp;
}

function powerpc(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if ((buf[o] >>> 2) === 0x12 && (buf[o + 3] & 3) === 1) {
      const src = (((buf[o] & 3) << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | (buf[o + 3] & ~3)) >>> 0;
      const dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
      buf[o] = 0x48 | ((dest >>> 24) & 0x03);
      buf[o + 1] = dest >>> 16;
      buf[o + 2] = dest >>> 8;
      buf[o + 3] = (buf[o + 3] & 0x03) | (dest & 0xff);
    }
  }
  return i;
}

const IA64_BRANCH_TABLE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 6, 6, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 0, 0];
function ia64(s, nowPos, isEncoder, buf, start, size) {
  size &= ~15;
  let i;
  for (i = 0; i < size; i += 16) {
    const o = start + i;
    const mask = IA64_BRANCH_TABLE[buf[o] & 0x1f];
    let bitPos = 5;
    for (let slot = 0; slot < 3; ++slot, bitPos += 41) {
      if (((mask >>> slot) & 1) === 0) continue;
      const bytePos = bitPos >>> 3;
      const bitRes = BigInt(bitPos & 7);
      let instruction = 0n;
      for (let j = 0; j < 6; ++j) instruction |= BigInt(buf[o + j + bytePos]) << BigInt(8 * j);
      let instNorm = instruction >> bitRes;
      if (((instNorm >> 37n) & 0xfn) === 5n && ((instNorm >> 9n) & 7n) === 0n) {
        let src = Number((instNorm >> 13n) & 0xfffffn);
        src |= Number((instNorm >> 36n) & 1n) << 20;
        src = (src << 4) >>> 0;
        let dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
        dest >>>= 4;
        instNorm &= ~(0x8fffffn << 13n);
        instNorm |= BigInt(dest & 0xfffff) << 13n;
        instNorm |= BigInt(dest & 0x100000) << (36n - 20n);
        instruction &= (1n << bitRes) - 1n;
        instruction |= instNorm << bitRes;
        for (let j = 0; j < 6; j++) buf[o + j + bytePos] = Number((instruction >> BigInt(8 * j)) & 0xffn);
      }
    }
  }
  return i;
}

function arm(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if (buf[o + 3] === 0xeb) {
      let src = ((buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o]) >>> 0;
      src = (src << 2) >>> 0;
      let dest = isEncoder ? (nowPos + i + 8 + src) >>> 0 : (src - (nowPos + i + 8)) >>> 0;
      dest >>>= 2;
      buf[o + 2] = dest >>> 16;
      buf[o + 1] = dest >>> 8;
      buf[o] = dest;
    }
  }
  return i;
}

function armthumb(s, nowPos, isEncoder, buf, start, size) {
  if (size < 4) return 0;
  size -= 4;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    if ((buf[o + 1] & 0xf8) === 0xf0 && (buf[o + 3] & 0xf8) === 0xf8) {
      let src = (((buf[o + 1] & 7) << 19) | (buf[o] << 11) | ((buf[o + 3] & 7) << 8) | buf[o + 2]) >>> 0;
      src = (src << 1) >>> 0;
      let dest = isEncoder ? (nowPos + i + 4 + src) >>> 0 : (src - (nowPos + i + 4)) >>> 0;
      dest >>>= 1;
      buf[o + 1] = 0xf0 | ((dest >>> 19) & 0x7);
      buf[o] = dest >>> 11;
      buf[o + 3] = 0xf8 | ((dest >>> 8) & 0x7);
      buf[o + 2] = dest;
      i += 2;
    }
  }
  return i;
}

const rd32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const wr32le = (b, o, v) => { b[o] = v; b[o + 1] = v >>> 8; b[o + 2] = v >>> 16; b[o + 3] = v >>> 24; };
const rd32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const wr32be = (b, o, v) => { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; };

function arm64(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    let pc = (nowPos + i) >>> 0;
    let instr = rd32le(buf, o);
    if ((instr >>> 26) === 0x25) {
      const src = instr;
      instr = 0x94000000;
      pc >>>= 2;
      if (!isEncoder) pc = (0 - pc) >>> 0;
      instr = (instr | ((src + pc) & 0x03ffffff)) >>> 0;
      wr32le(buf, o, instr);
    } else if (((instr & 0x9f000000) >>> 0) === 0x90000000) {
      const src = (((instr >>> 29) & 3) | ((instr >>> 3) & 0x001ffffc)) >>> 0;
      if (((src + 0x00020000) & 0x001c0000) !== 0) continue;
      instr = (instr & 0x9000001f) >>> 0;
      pc >>>= 12;
      if (!isEncoder) pc = (0 - pc) >>> 0;
      const dest = (src + pc) >>> 0;
      instr |= (dest & 3) << 29;
      instr |= (dest & 0x0003fffc) << 3;
      instr |= ((0 - (dest & 0x00020000)) >>> 0) & 0x00e00000;
      wr32le(buf, o, instr >>> 0);
    }
  }
  return i;
}

function sparc(s, nowPos, isEncoder, buf, start, size) {
  size &= ~3;
  let i;
  for (i = 0; i < size; i += 4) {
    const o = start + i;
    if ((buf[o] === 0x40 && (buf[o + 1] & 0xc0) === 0x00) || (buf[o] === 0x7f && (buf[o + 1] & 0xc0) === 0xc0)) {
      let src = rd32be(buf, o);
      src = (src << 2) >>> 0;
      let dest = isEncoder ? (nowPos + i + src) >>> 0 : (src - (nowPos + i)) >>> 0;
      dest >>>= 2;
      dest = ((((0 - ((dest >>> 22) & 1)) << 22) & 0x3fffffff) | (dest & 0x3fffff) | 0x40000000) >>> 0;
      wr32be(buf, o, dest);
    }
  }
  return i;
}

const notAuipcPair = (auipc, inst2) => ((((auipc << 8) ^ ((inst2 - 3) >>> 0)) & 0xf8003) >>> 0) !== 0;
const notSpecialAuipc = (auipc, rs1) => ((((auipc - 0x3117) << 18) >>> 0) >= (rs1 & 0x1d));
function riscvEncode(s, nowPos, isEncoder, buf, start, size) {
  if (size < 8) return 0;
  size -= 8;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    let inst = buf[o];
    if (inst === 0xef) {
      const b1 = buf[o + 1];
      if ((b1 & 0x0d) !== 0) continue;
      const b2 = buf[o + 2], b3 = buf[o + 3];
      const pc = (nowPos + i) >>> 0;
      let addr = ((b1 & 0xf0) << 8) | ((b2 & 0x0f) << 16) | ((b2 & 0x10) << 7) | ((b2 & 0xe0) >>> 4) | ((b3 & 0x7f) << 4) | ((b3 & 0x80) << 13);
      addr = (addr + pc) >>> 0;
      buf[o + 1] = (b1 & 0x0f) | ((addr >>> 13) & 0xf0);
      buf[o + 2] = addr >>> 9;
      buf[o + 3] = addr >>> 1;
      i += 4 - 2;
    } else if ((inst & 0x7f) === 0x17) {
      inst = (inst | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
      if (inst & 0xe80) {
        const inst2 = rd32le(buf, o + 4);
        if (notAuipcPair(inst, inst2)) { i += 6 - 2; continue; }
        let addr = (inst & 0xfffff000) >>> 0;
        addr = (addr + (inst2 >>> 20) - ((inst2 >>> 19) & 0x1000)) >>> 0;
        addr = (addr + nowPos + i) >>> 0;
        inst = (0x17 | (2 << 7) | (inst2 << 12)) >>> 0;
        wr32le(buf, o, inst);
        wr32be(buf, o + 4, addr);
      } else {
        const fakeRs1 = inst >>> 27;
        if (notSpecialAuipc(inst, fakeRs1)) { i += 4 - 2; continue; }
        const fakeAddr = rd32le(buf, o + 4);
        const fakeInst2 = ((inst >>> 12) | (fakeAddr << 20)) >>> 0;
        inst = (0x17 | (fakeRs1 << 7) | (fakeAddr & 0xfffff000)) >>> 0;
        wr32le(buf, o, inst);
        wr32le(buf, o + 4, fakeInst2);
      }
      i += 8 - 2;
    }
  }
  return i;
}
function riscvDecode(s, nowPos, isEncoder, buf, start, size) {
  if (size < 8) return 0;
  size -= 8;
  let i;
  for (i = 0; i <= size; i += 2) {
    const o = start + i;
    let inst = buf[o];
    if (inst === 0xef) {
      const b1 = buf[o + 1];
      if ((b1 & 0x0d) !== 0) continue;
      const b2 = buf[o + 2], b3 = buf[o + 3];
      const pc = (nowPos + i) >>> 0;
      let addr = (((b1 & 0xf0) << 13) | (b2 << 9) | (b3 << 1)) >>> 0;
      addr = (addr - pc) >>> 0;
      buf[o + 1] = (b1 & 0x0f) | ((addr >>> 8) & 0xf0);
      buf[o + 2] = ((addr >>> 16) & 0x0f) | ((addr >>> 7) & 0x10) | ((addr << 4) & 0xe0);
      buf[o + 3] = ((addr >>> 4) & 0x7f) | ((addr >>> 13) & 0x80);
      i += 4 - 2;
    } else if ((inst & 0x7f) === 0x17) {
      let inst2;
      inst = (inst | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
      if (inst & 0xe80) {
        inst2 = rd32le(buf, o + 4);
        if (notAuipcPair(inst, inst2)) { i += 6 - 2; continue; }
        let addr = (inst & 0xfffff000) >>> 0;
        addr = (addr + (inst2 >>> 20)) >>> 0;
        inst = (0x17 | (2 << 7) | (inst2 << 12)) >>> 0;
        inst2 = addr;
      } else {
        const rs1 = inst >>> 27;
        if (notSpecialAuipc(inst, rs1)) { i += 4 - 2; continue; }
        let addr = rd32be(buf, o + 4);
        addr = (addr - (nowPos + i)) >>> 0;
        inst2 = ((inst >>> 12) | (addr << 20)) >>> 0;
        inst = (0x17 | (rs1 << 7) | ((addr + 0x800) & 0xfffff000)) >>> 0;
      }
      wr32le(buf, o, inst);
      wr32le(buf, o + 4, inst2);
      i += 8 - 2;
    }
  }
  return i;
}

// the filter IDs of the format
export const FILTER_DELTA = 0x03, FILTER_X86 = 0x04, FILTER_POWERPC = 0x05, FILTER_IA64 = 0x06,
  FILTER_ARM = 0x07, FILTER_ARMTHUMB = 0x08, FILTER_SPARC = 0x09, FILTER_ARM64 = 0x0a, FILTER_RISCV = 0x0b,
  FILTER_LZMA1 = 0x4000000000000001n, FILTER_LZMA2 = 0x21;

// id → [kernel (or [enc, dec]), unfilteredMax, alignment]
const BCJ = {
  [FILTER_X86]: [x86, 5, 1], [FILTER_POWERPC]: [powerpc, 4, 4], [FILTER_IA64]: [ia64, 16, 16],
  [FILTER_ARM]: [arm, 4, 4], [FILTER_ARMTHUMB]: [armthumb, 4, 2], [FILTER_ARM64]: [arm64, 4, 4],
  [FILTER_SPARC]: [sparc, 4, 4], [FILTER_RISCV]: [[riscvEncode, riscvDecode], 8, 2],
};
export const isBcj = (id) => Object.hasOwn(BCJ, id);

// a coder for filter {id, options} over next
export function makeFilterCoder(f, next, isEncoder) {
  if (f.id === FILTER_DELTA) return new DeltaCoder(next, f.dist ?? 1, isEncoder);
  const spec = BCJ[f.id];
  if (!spec) throw new RangeError(`lzma: unsupported filter ${f.id}`);
  const [k, unfilteredMax, alignment] = spec;
  const kernel = Array.isArray(k) ? (isEncoder ? k[0] : k[1]) : k;
  const state = f.id === FILTER_X86 ? { prevMask: 0, prevPos: (-5) >>> 0 } : null;
  return new SimpleCoder(next, kernel, unfilteredMax, alignment, isEncoder, f.start_offset ?? 0, state);
}
