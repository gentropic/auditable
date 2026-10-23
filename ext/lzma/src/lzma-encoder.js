// The LZMA encoder: range_encoder.h, price.h / price_tablegen.c, fastpos.h, lzma_encoder.c,
// lzma_encoder_optimum_fast.c and lzma_encoder_optimum_normal.c of liblzma 5.8.1, ported line
// for line — the parser's choices decide the bytes, so they are liblzma's. A probability is an
// index into one of the coder's Uint16Arrays; the range encoder queues (array, index, bit).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// ── constants (lzma_common.h, range_common.h, price.h) ──
const RC_SHIFT_BITS = 8, RC_TOP_VALUE = 1 << 24;
const RC_BIT_MODEL_TOTAL_BITS = 11, RC_BIT_MODEL_TOTAL = 1 << 11, RC_MOVE_BITS = 5;
const RC_MOVE_REDUCING_BITS = 4, RC_BIT_PRICE_SHIFT_BITS = 4;
const RC_INFINITY_PRICE = 1 << 30;
const RC_SYMBOLS_MAX = 53;
const RC_BIT_0 = 0, RC_BIT_1 = 1, RC_DIRECT_0 = 2, RC_DIRECT_1 = 3, RC_FLUSH = 4;

const STATES = 12, LIT_STATES = 7;
const POS_STATES_MAX = 16;
const LITERAL_CODER_SIZE = 0x300, LITERAL_CODERS_MAX = 16;
const MATCH_LEN_MIN = 2;
const LEN_LOW_BITS = 3, LEN_LOW_SYMBOLS = 8, LEN_MID_BITS = 3, LEN_MID_SYMBOLS = 8, LEN_HIGH_BITS = 8, LEN_HIGH_SYMBOLS = 256;
const LEN_SYMBOLS = LEN_LOW_SYMBOLS + LEN_MID_SYMBOLS + LEN_HIGH_SYMBOLS;
export const MATCH_LEN_MAX = MATCH_LEN_MIN + LEN_SYMBOLS - 1;   // 273
const DIST_STATES = 4, DIST_SLOT_BITS = 6, DIST_SLOTS = 64;
const DIST_MODEL_START = 4, DIST_MODEL_END = 14;
const FULL_DISTANCES = 1 << 7;
const ALIGN_BITS = 4, ALIGN_SIZE = 16, ALIGN_MASK = 15;
const REPS = 4;
export const OPTS = 1 << 12;
export const LOOP_INPUT_MAX = OPTS + 1;
export const LZMA2_CHUNK_MAX = 1 << 16;
const UINT32_MAX = 0xffffffff;

// state transitions
const updateLiteral = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);
const updateLiteralNormal = (s) => (s <= 3 ? 0 : s - 3);
const updateLiteralMatched = (s) => (s <= 9 ? s - 3 : s - 6);
const updateMatch = (s) => (s < LIT_STATES ? 7 : 10);
const updateLongRep = (s) => (s < LIT_STATES ? 8 : 11);
const updateShortRep = (s) => (s < LIT_STATES ? 9 : 11);
const isLiteralState = (s) => s < LIT_STATES;
const getDistState = (len) => (len < DIST_STATES + MATCH_LEN_MIN ? len - MATCH_LEN_MIN : DIST_STATES - 1);

// get_dist_slot (fastpos.h's HAVE_SMALL form — the same values as its table)
export function getDistSlot(dist) {
  if (dist <= 4) return dist;
  const i = 31 - Math.clz32(dist);
  return (i + i) + ((dist >>> (i - 1)) & 1);
}

// lzma_rc_prices (price_tablegen.c)
const RC_PRICES = (() => {
  const t = new Uint8Array(RC_BIT_MODEL_TOTAL >>> RC_MOVE_REDUCING_BITS);
  for (let i = (1 << RC_MOVE_REDUCING_BITS) / 2; i < RC_BIT_MODEL_TOTAL; i += 1 << RC_MOVE_REDUCING_BITS) {
    const cyclesBits = RC_BIT_PRICE_SHIFT_BITS;
    let w = i, bitCount = 0;
    for (let j = 0; j < cyclesBits; ++j) {
      w = Math.imul(w, w) >>> 0;
      bitCount <<= 1;
      while (w >= (1 << 16)) { w >>>= 1; ++bitCount; }
    }
    t[i >> RC_MOVE_REDUCING_BITS] = (RC_BIT_MODEL_TOTAL_BITS << cyclesBits) - 15 - bitCount;
  }
  return t;
})();
const bitPrice = (prob, bit) => RC_PRICES[(prob ^ ((-bit) & (RC_BIT_MODEL_TOTAL - 1))) >>> RC_MOVE_REDUCING_BITS];
const bit0Price = (prob) => RC_PRICES[prob >>> RC_MOVE_REDUCING_BITS];
const bit1Price = (prob) => RC_PRICES[(prob ^ (RC_BIT_MODEL_TOTAL - 1)) >>> RC_MOVE_REDUCING_BITS];
function bittreePrice(probs, base, bitLevels, symbol) {
  let price = 0;
  symbol += 1 << bitLevels;
  do {
    const bit = symbol & 1;
    symbol >>>= 1;
    price += bitPrice(probs[base + symbol], bit);
  } while (symbol !== 1);
  return price;
}
function bittreeReversePrice(probs, base, bitLevels, symbol) {
  let price = 0, modelIndex = 1;
  do {
    const bit = symbol & 1;
    symbol >>>= 1;
    price += bitPrice(probs[base + modelIndex], bit);
    modelIndex = (modelIndex << 1) + bit;
  } while (--bitLevels !== 0);
  return price;
}
const directPrice = (bits) => bits << RC_BIT_PRICE_SHIFT_BITS;

// ── the range encoder: symbols queued, then encoded (rc_encode) into out ──
// out: { buf: Uint8Array, pos, size } (the LZMA2 chunk buffer, or a growable stream buffer)
class RangeEncoder {
  constructor() {
    this.symbols = new Uint8Array(RC_SYMBOLS_MAX);
    this.probArr = new Array(RC_SYMBOLS_MAX).fill(null);
    this.probIdx = new Int32Array(RC_SYMBOLS_MAX);
    this.reset();
  }
  reset() {
    this.low = 0;           // (a uint64 in the C: up to 2^40 here, a double holds it)
    this.cacheSize = 1;
    this.range = UINT32_MAX;
    this.cache = 0;
    this.outTotal = 0;
    this.count = 0;
    this.pos = 0;
  }
  forget() { this.count = 0; }
  bit(arr, idx, bit) {
    this.symbols[this.count] = bit;
    this.probArr[this.count] = arr;
    this.probIdx[this.count] = idx;
    ++this.count;
  }
  bittree(arr, base, bitCount, symbol) {
    let modelIndex = 1;
    do {
      const bit = (symbol >>> --bitCount) & 1;
      this.bit(arr, base + modelIndex, bit);
      modelIndex = (modelIndex << 1) + bit;
    } while (bitCount !== 0);
  }
  bittreeReverse(arr, base, bitCount, symbol) {
    let modelIndex = 1;
    do {
      const bit = symbol & 1;
      symbol >>>= 1;
      this.bit(arr, base + modelIndex, bit);
      modelIndex = (modelIndex << 1) + bit;
    } while (--bitCount !== 0);
  }
  direct(value, bitCount) {
    do {
      this.symbols[this.count++] = RC_DIRECT_0 + ((value >>> --bitCount) & 1);
    } while (bitCount !== 0);
  }
  flush() {
    for (let i = 0; i < 5; ++i) this.symbols[this.count++] = RC_FLUSH;
  }
  _shiftLow(out) {
    const lowLo = this.low % 0x100000000, lowHi = Math.floor(this.low / 0x100000000);
    if (lowLo < 0xff000000 || lowHi !== 0) {
      do {
        if (out.pos === out.size) return true;
        out.buf[out.pos] = (this.cache + lowHi) & 0xff;
        ++out.pos;
        ++this.outTotal;
        this.cache = 0xff;
      } while (--this.cacheSize !== 0);
      this.cache = (lowLo >>> 24) & 0xff;
    }
    ++this.cacheSize;
    this.low = (lowLo & 0x00ffffff) * 256;
    return false;
  }
  // true: out is full (try again with more room)
  encode(out) {
    while (this.pos < this.count) {
      if (this.range < RC_TOP_VALUE) {
        if (this._shiftLow(out)) return true;
        this.range = (this.range << RC_SHIFT_BITS) >>> 0;
      }
      switch (this.symbols[this.pos]) {
        case RC_BIT_0: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          this.range = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS, prob) >>> 0;
          prob += (RC_BIT_MODEL_TOTAL - prob) >>> RC_MOVE_BITS;
          arr[idx] = prob;
          break;
        }
        case RC_BIT_1: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          const bound = Math.imul(prob, this.range >>> RC_BIT_MODEL_TOTAL_BITS) >>> 0;
          this.low += bound;
          this.range = (this.range - bound) >>> 0;
          prob -= prob >>> RC_MOVE_BITS;
          arr[idx] = prob;
          break;
        }
        case RC_DIRECT_0:
          this.range >>>= 1;
          break;
        case RC_DIRECT_1:
          this.range >>>= 1;
          this.low += this.range;
          break;
        case RC_FLUSH:
          this.range = UINT32_MAX;
          do {
            if (this._shiftLow(out)) return true;
          } while (++this.pos < this.count);
          this.reset();
          return false;
      }
      ++this.pos;
    }
    this.count = 0;
    this.pos = 0;
    return false;
  }
  // rc_encode_dummy: would encoding what's queued (and the flush) pass outLimit bytes?
  encodeDummy(outLimit) {
    let low = this.low, cacheSize = this.cacheSize, range = this.range, cache = this.cache, outPos = this.outTotal;
    let pos = this.pos;
    const shift = () => {
      const lowLo = low % 0x100000000, lowHi = Math.floor(low / 0x100000000);
      if (lowLo < 0xff000000 || lowHi !== 0) {
        do {
          if (outPos === outLimit) return true;
          ++outPos;
          cache = 0xff;
        } while (--cacheSize !== 0);
        cache = (lowLo >>> 24) & 0xff;
      }
      ++cacheSize;
      low = (lowLo & 0x00ffffff) * 256;
      return false;
    };
    while (true) {
      if (range < RC_TOP_VALUE) {
        if (shift()) return true;
        range = (range << RC_SHIFT_BITS) >>> 0;
      }
      if (pos === this.count) break;
      switch (this.symbols[pos]) {
        case RC_BIT_0: range = Math.imul(range >>> RC_BIT_MODEL_TOTAL_BITS, this.probArr[pos][this.probIdx[pos]]) >>> 0; break;
        case RC_BIT_1: {
          const bound = Math.imul(this.probArr[pos][this.probIdx[pos]], range >>> RC_BIT_MODEL_TOTAL_BITS) >>> 0;
          low += bound;
          range = (range - bound) >>> 0;
          break;
        }
        case RC_DIRECT_0: range >>>= 1; break;
        case RC_DIRECT_1: range >>>= 1; low += range; break;
      }
      ++pos;
    }
    for (pos = 0; pos < 5; ++pos) if (shift()) return true;
    return false;
  }
  pending() { return this.cacheSize + 5 - 1; }
}

// ── the length encoder ──
// probs: [0] choice, [1] choice2, [2 + ps*8 ..] low, [2 + 128 + ps*8 ..] mid, [2 + 256 ..] high
const LC_CHOICE = 0, LC_CHOICE2 = 1, LC_LOW = 2, LC_MID = 2 + POS_STATES_MAX * LEN_LOW_SYMBOLS, LC_HIGH = LC_MID + POS_STATES_MAX * LEN_MID_SYMBOLS;
class LengthEncoder {
  constructor() {
    this.probs = new Uint16Array(LC_HIGH + LEN_HIGH_SYMBOLS);
    this.prices = new Uint32Array(POS_STATES_MAX * LEN_SYMBOLS);
    this.tableSize = 0;
    this.counters = new Uint32Array(POS_STATES_MAX);
  }
  reset(numPosStates, fastMode) {
    this.probs.fill(RC_BIT_MODEL_TOTAL >>> 1);
    if (!fastMode) for (let ps = 0; ps < numPosStates; ++ps) this.updatePrices(ps);
  }
  updatePrices(posState) {
    const tableSize = this.tableSize, p = this.probs;
    this.counters[posState] = tableSize;
    const a0 = bit0Price(p[LC_CHOICE]);
    const a1 = bit1Price(p[LC_CHOICE]);
    const b0 = a1 + bit0Price(p[LC_CHOICE2]);
    const b1 = a1 + bit1Price(p[LC_CHOICE2]);
    const base = posState * LEN_SYMBOLS;
    let i;
    for (i = 0; i < tableSize && i < LEN_LOW_SYMBOLS; ++i) this.prices[base + i] = a0 + bittreePrice(p, LC_LOW + posState * LEN_LOW_SYMBOLS, LEN_LOW_BITS, i);
    for (; i < tableSize && i < LEN_LOW_SYMBOLS + LEN_MID_SYMBOLS; ++i) this.prices[base + i] = b0 + bittreePrice(p, LC_MID + posState * LEN_MID_SYMBOLS, LEN_MID_BITS, i - LEN_LOW_SYMBOLS);
    for (; i < tableSize; ++i) this.prices[base + i] = b1 + bittreePrice(p, LC_HIGH, LEN_HIGH_BITS, i - LEN_LOW_SYMBOLS - LEN_MID_SYMBOLS);
  }
  encode(rc, posState, len, fastMode) {
    const p = this.probs;
    len -= MATCH_LEN_MIN;
    if (len < LEN_LOW_SYMBOLS) {
      rc.bit(p, LC_CHOICE, 0);
      rc.bittree(p, LC_LOW + posState * LEN_LOW_SYMBOLS, LEN_LOW_BITS, len);
    } else {
      rc.bit(p, LC_CHOICE, 1);
      len -= LEN_LOW_SYMBOLS;
      if (len < LEN_MID_SYMBOLS) {
        rc.bit(p, LC_CHOICE2, 0);
        rc.bittree(p, LC_MID + posState * LEN_MID_SYMBOLS, LEN_MID_BITS, len);
      } else {
        rc.bit(p, LC_CHOICE2, 1);
        len -= LEN_MID_SYMBOLS;
        rc.bittree(p, LC_HIGH, LEN_HIGH_BITS, len);
      }
    }
    if (!fastMode) if (--this.counters[posState] === 0) this.updatePrices(posState);
  }
  price(len, posState) { return this.prices[posState * LEN_SYMBOLS + len - MATCH_LEN_MIN]; }
}

class Optimal {
  constructor() {
    this.state = 0;
    this.prev1IsLiteral = false;
    this.prev2 = false;
    this.posPrev2 = 0;
    this.backPrev2 = 0;
    this.price = 0;
    this.posPrev = 0;
    this.backPrev = 0;
    this.backs = new Uint32Array(REPS);
  }
}

// options: { dictSize, lc, lp, pb, mode ('fast' | 'normal'), niceLen, mf, depth }
export class LzmaEncoder {
  constructor(options, { isLzma1 = false } = {}) {
    if (!(options.lc <= 4 && options.lp <= 4 && options.lc + options.lp <= 4 && options.pb <= 4)) throw new RangeError('lzma: invalid lc / lp / pb');
    if (!(options.niceLen >= MATCH_LEN_MIN && options.niceLen <= MATCH_LEN_MAX)) throw new RangeError('lzma: invalid nice_len');
    this.rc = new RangeEncoder();
    this.reps = new Uint32Array(REPS);
    this.matches = Array.from({ length: MATCH_LEN_MAX + 1 }, () => ({ len: 0, dist: 0 }));
    this.matchesCount = 0;
    this.longestMatchLength = 0;
    this.literal = new Uint16Array(LITERAL_CODERS_MAX * LITERAL_CODER_SIZE);
    this.isMatch = new Uint16Array(STATES * POS_STATES_MAX);
    this.isRep = new Uint16Array(STATES);
    this.isRep0 = new Uint16Array(STATES);
    this.isRep1 = new Uint16Array(STATES);
    this.isRep2 = new Uint16Array(STATES);
    this.isRep0Long = new Uint16Array(STATES * POS_STATES_MAX);
    this.distSlot = new Uint16Array(DIST_STATES * DIST_SLOTS);
    this.distSpecial = new Uint16Array(FULL_DISTANCES - DIST_MODEL_END);
    this.distAlign = new Uint16Array(ALIGN_SIZE);
    this.matchLenEncoder = new LengthEncoder();
    this.repLenEncoder = new LengthEncoder();
    this.distSlotPrices = new Uint32Array(DIST_STATES * DIST_SLOTS);
    this.distPrices = new Uint32Array(DIST_STATES * FULL_DISTANCES);
    this.alignPrices = new Uint32Array(ALIGN_SIZE);
    this.opts = Array.from({ length: OPTS }, () => new Optimal());
    this._repLens = new Uint32Array(REPS);
    this._repsTmp = new Uint32Array(REPS);

    // (lzma_lzma_encoder_create)
    if (options.mode === 'fast') {
      this.fastMode = true;
    } else {
      this.fastMode = false;
      let logSize = 0;
      while ((2 ** logSize) < options.dictSize) ++logSize;
      this.distTableSize = logSize * 2;
      const niceLen = Math.max(options.mf & 0x0f, options.niceLen);
      this.matchLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN;
      this.repLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN;
    }
    this.isInitialized = false;   // (a preset dictionary would set it: not supported)
    this.isFlushed = false;
    this.uncompSize = 0;
    this.outLimit = 0;
    this.useEopm = isLzma1;
    this.reset(options);
  }

  // lz options for the window this encoder needs (set_lz_options)
  static lzOptions(options) {
    return {
      beforeSize: OPTS, dictSize: options.dictSize, afterSize: LOOP_INPUT_MAX, matchLenMax: MATCH_LEN_MAX,
      niceLen: Math.max(options.mf & 0x0f, options.niceLen), matchFinder: options.mf, depth: options.depth || 0,
    };
  }

  // lzma_lzma_encoder_reset
  reset(options) {
    this.posMask = (1 << options.pb) - 1;
    this.literalContextBits = options.lc;
    this.literalMask = ((0x100 << options.lp) - (0x100 >>> options.lc)) >>> 0;
    this.rc.reset();
    this.state = 0;
    this.reps.fill(0);
    this.literal.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isMatch.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isRep0Long.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isRep.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isRep0.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isRep1.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.isRep2.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.distSpecial.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.distSlot.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.distAlign.fill(RC_BIT_MODEL_TOTAL >>> 1);
    this.matchLenEncoder.reset(1 << options.pb, this.fastMode);
    this.repLenEncoder.reset(1 << options.pb, this.fastMode);
    this.matchPriceCount = (UINT32_MAX / 2) >>> 0;
    this.alignPriceCount = (UINT32_MAX / 2) >>> 0;
    this.optsEndIndex = 0;
    this.optsCurrentIndex = 0;
  }

  literalSubcoder(pos, prevByte) {
    return 3 * ((((((pos << 8) + prevByte) >>> 0) & this.literalMask) << this.literalContextBits) >>> 0);
  }

  // ── encoding a symbol ──

  _literalMatched(sub, matchByte, symbol) {
    let offset = 0x100;
    symbol += 1 << 8;
    do {
      matchByte <<= 1;
      const matchBit = matchByte & offset;
      const subcoderIndex = offset + matchBit + (symbol >>> 8);
      const bit = (symbol >>> 7) & 1;
      this.rc.bit(this.literal, sub + subcoderIndex, bit);
      symbol <<= 1;
      offset &= ~(matchByte ^ symbol);
    } while (symbol < (1 << 16));
  }

  _literal(mf, position) {
    const buf = mf.buffer;
    const curByte = buf[mf.readPos - mf.readAhead];
    const sub = this.literalSubcoder(position, buf[mf.readPos - mf.readAhead - 1]);
    if (isLiteralState(this.state)) {
      this.state = updateLiteralNormal(this.state);
      this.rc.bittree(this.literal, sub, 8, curByte);
    } else {
      this.state = updateLiteralMatched(this.state);
      const matchByte = buf[mf.readPos - this.reps[0] - 1 - mf.readAhead];
      this._literalMatched(sub, matchByte, curByte);
    }
  }

  _match(posState, distance, len) {
    this.state = updateMatch(this.state);
    this.matchLenEncoder.encode(this.rc, posState, len, this.fastMode);
    const distSlot = getDistSlot(distance);
    const distState = getDistState(len);
    this.rc.bittree(this.distSlot, distState * DIST_SLOTS, DIST_SLOT_BITS, distSlot);
    if (distSlot >= DIST_MODEL_START) {
      const footerBits = (distSlot >>> 1) - 1;
      const base = ((2 | (distSlot & 1)) << footerBits) >>> 0;
      const distReduced = (distance - base) >>> 0;
      if (distSlot < DIST_MODEL_END) {
        this.rc.bittreeReverse(this.distSpecial, base - distSlot - 1, footerBits, distReduced);
      } else {
        this.rc.direct(distReduced >>> ALIGN_BITS, footerBits - ALIGN_BITS);
        this.rc.bittreeReverse(this.distAlign, 0, ALIGN_BITS, distReduced & ALIGN_MASK);
        ++this.alignPriceCount;
      }
    }
    this.reps[3] = this.reps[2];
    this.reps[2] = this.reps[1];
    this.reps[1] = this.reps[0];
    this.reps[0] = distance;
    ++this.matchPriceCount;
  }

  _repMatch(posState, rep, len) {
    const s = this.state;
    if (rep === 0) {
      this.rc.bit(this.isRep0, s, 0);
      this.rc.bit(this.isRep0Long, s * POS_STATES_MAX + posState, len !== 1 ? 1 : 0);
    } else {
      const distance = this.reps[rep];
      this.rc.bit(this.isRep0, s, 1);
      if (rep === 1) {
        this.rc.bit(this.isRep1, s, 0);
      } else {
        this.rc.bit(this.isRep1, s, 1);
        this.rc.bit(this.isRep2, s, rep - 2);
        if (rep === 3) this.reps[3] = this.reps[2];
        this.reps[2] = this.reps[1];
      }
      this.reps[1] = this.reps[0];
      this.reps[0] = distance;
    }
    if (len === 1) {
      this.state = updateShortRep(this.state);
    } else {
      this.repLenEncoder.encode(this.rc, posState, len, this.fastMode);
      this.state = updateLongRep(this.state);
    }
  }

  _encodeSymbol(mf, back, len, position) {
    const posState = position & this.posMask;
    const s = this.state;
    if (back === UINT32_MAX) {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX + posState, 0);
      this._literal(mf, position);
    } else {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX + posState, 1);
      if (back < REPS) {
        this.rc.bit(this.isRep, s, 1);
        this._repMatch(posState, back, len);
      } else {
        this.rc.bit(this.isRep, s, 0);
        this._match(posState, back - REPS, len);
      }
    }
    mf.readAhead -= len;
  }

  _encodeInit(mf) {
    if (mf.readPos === mf.readLimit) {
      if (mf.action === 0) return false;   // RUN: nothing to do yet
    } else {
      mf.mfSkip(1);
      mf.readAhead = 0;
      this.rc.bit(this.isMatch, 0, 0);
      this.rc.bittree(this.literal, 0, 8, mf.buffer[0]);
      ++this.uncompSize;
    }
    this.isInitialized = true;
    return true;
  }

  _encodeEopm(position) {
    const posState = position & this.posMask;
    const s = this.state;
    this.rc.bit(this.isMatch, s * POS_STATES_MAX + posState, 1);
    this.rc.bit(this.isRep, s, 0);
    this._match(posState, UINT32_MAX, MATCH_LEN_MIN);
  }

  // lzma_lzma_encode: 'ok' (needs more input, or out filled), or 'end' (flushed: a chunk, or
  // the stream). limit: UINT32_MAX, or the LZMA2 chunk's uncompressed limit
  encode(mf, out, limit) {
    if (!this.isInitialized && !this._encodeInit(mf)) return 'ok';
    if (this.rc.encode(out)) return 'ok';
    if (this.isFlushed) return 'end';
    const back = { v: 0 }, len = { v: 0 };
    while (true) {
      if (limit !== UINT32_MAX
          && ((mf.readPos - mf.readAhead) >>> 0 >= limit
            || out.pos + this.rc.pending() >= LZMA2_CHUNK_MAX - LOOP_INPUT_MAX)) break;
      if (mf.readPos >= mf.readLimit) {
        if (mf.action === 0) return 'ok';
        if (mf.readAhead === 0) break;
      }
      if (this.fastMode) this._optimumFast(mf, back, len);
      else this._optimumNormal(mf, back, len, this.uncompSize >>> 0);
      this._encodeSymbol(mf, back.v, len.v, this.uncompSize >>> 0);
      if (this.outLimit !== 0 && this.rc.encodeDummy(this.outLimit)) {
        this.rc.forget();
        break;
      }
      this.uncompSize += len.v;
      if (this.rc.encode(out)) return 'ok';
    }
    if (this.useEopm) this._encodeEopm(this.uncompSize >>> 0);
    this.rc.flush();
    if (this.rc.encode(out)) {
      this.isFlushed = true;
      return 'ok';
    }
    return 'end';
  }

  // ── lzma_encoder_optimum_fast.c ──
  _optimumFast(mf, backRes, lenRes) {
    const niceLen = mf.niceLen;
    const matches = this.matches;
    let lenMain, matchesCount;
    if (mf.readAhead === 0) {
      lenMain = mf.mfFind(matches);
      matchesCount = mf._count;
    } else {
      lenMain = this.longestMatchLength;
      matchesCount = this.matchesCount;
    }
    const b = mf.buffer;
    let buf = mf.readPos - 1;
    const bufAvail = Math.min(mf.avail() + 1, MATCH_LEN_MAX);
    if (bufAvail < 2) { backRes.v = UINT32_MAX; lenRes.v = 1; return; }

    let repLen = 0, repIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) continue;
      const len = memcmplen(b, buf, bufBack, 2, bufAvail);
      if (len >= niceLen) {
        backRes.v = i; lenRes.v = len;
        mf.mfSkip(len - 1);
        return;
      }
      if (len > repLen) { repIndex = i; repLen = len; }
    }
    if (lenMain >= niceLen) {
      backRes.v = matches[matchesCount - 1].dist + REPS;
      lenRes.v = lenMain;
      mf.mfSkip(lenMain - 1);
      return;
    }
    let backMain = 0;
    if (lenMain >= 2) {
      backMain = matches[matchesCount - 1].dist;
      while (matchesCount > 1 && lenMain === matches[matchesCount - 2].len + 1) {
        if (!changePair(matches[matchesCount - 2].dist, backMain)) break;
        --matchesCount;
        lenMain = matches[matchesCount - 1].len;
        backMain = matches[matchesCount - 1].dist;
      }
      if (lenMain === 2 && backMain >= 0x80) lenMain = 1;
    }
    if (repLen >= 2) {
      if (repLen + 1 >= lenMain
          || (repLen + 2 >= lenMain && backMain > (1 << 9))
          || (repLen + 3 >= lenMain && backMain > (1 << 15))) {
        backRes.v = repIndex; lenRes.v = repLen;
        mf.mfSkip(repLen - 1);
        return;
      }
    }
    if (lenMain < 2 || bufAvail <= 2) { backRes.v = UINT32_MAX; lenRes.v = 1; return; }

    this.longestMatchLength = mf.mfFind(matches);
    this.matchesCount = mf._count;
    if (this.longestMatchLength >= 2) {
      const newDist = matches[this.matchesCount - 1].dist;
      if ((this.longestMatchLength >= lenMain && newDist < backMain)
          || (this.longestMatchLength === lenMain + 1 && !changePair(backMain, newDist))
          || (this.longestMatchLength > lenMain + 1)
          || (this.longestMatchLength + 1 >= lenMain && lenMain >= 3 && changePair(newDist, backMain))) {
        backRes.v = UINT32_MAX; lenRes.v = 1;
        return;
      }
    }
    ++buf;
    const limit = Math.max(2, lenMain - 1);
    for (let i = 0; i < REPS; ++i) {
      if (memcmplen(b, buf, buf - this.reps[i] - 1, 0, limit) === limit) {
        backRes.v = UINT32_MAX; lenRes.v = 1;
        return;
      }
    }
    backRes.v = backMain + REPS;
    lenRes.v = lenMain;
    mf.mfSkip(lenMain - 2);
  }

  // ── lzma_encoder_optimum_normal.c ──

  _getLiteralPrice(pos, prevByte, matchMode, matchByte, symbol) {
    const sub = this.literalSubcoder(pos, prevByte);
    const p = this.literal;
    let price = 0;
    if (!matchMode) {
      price = bittreePrice(p, sub, 8, symbol);
    } else {
      let offset = 0x100;
      symbol += 1 << 8;
      do {
        matchByte <<= 1;
        const matchBit = matchByte & offset;
        const subcoderIndex = offset + matchBit + (symbol >>> 8);
        const bit = (symbol >>> 7) & 1;
        price += bitPrice(p[sub + subcoderIndex], bit);
        symbol <<= 1;
        offset &= ~(matchByte ^ symbol);
      } while (symbol < (1 << 16));
    }
    return price;
  }

  _getShortRepPrice(state, posState) {
    return bit0Price(this.isRep0[state]) + bit0Price(this.isRep0Long[state * POS_STATES_MAX + posState]);
  }

  _getPureRepPrice(repIndex, state, posState) {
    let price;
    if (repIndex === 0) {
      price = bit0Price(this.isRep0[state]);
      price += bit1Price(this.isRep0Long[state * POS_STATES_MAX + posState]);
    } else {
      price = bit1Price(this.isRep0[state]);
      if (repIndex === 1) {
        price += bit0Price(this.isRep1[state]);
      } else {
        price += bit1Price(this.isRep1[state]);
        price += bitPrice(this.isRep2[state], repIndex - 2);
      }
    }
    return price;
  }

  _getRepPrice(repIndex, len, state, posState) {
    return this.repLenEncoder.price(len, posState) + this._getPureRepPrice(repIndex, state, posState);
  }

  _getDistLenPrice(dist, len, posState) {
    const distState = getDistState(len);
    let price;
    if (dist < FULL_DISTANCES) {
      price = this.distPrices[distState * FULL_DISTANCES + dist];
    } else {
      const distSlot = getDistSlot(dist);
      price = this.distSlotPrices[distState * DIST_SLOTS + distSlot] + this.alignPrices[dist & ALIGN_MASK];
    }
    price += this.matchLenEncoder.price(len, posState);
    return price;
  }

  _fillDistPrices() {
    for (let distState = 0; distState < DIST_STATES; ++distState) {
      const dsp = distState * DIST_SLOTS;
      for (let distSlot = 0; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] = bittreePrice(this.distSlot, distState * DIST_SLOTS, DIST_SLOT_BITS, distSlot);
      }
      for (let distSlot = DIST_MODEL_END; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] += directPrice(((distSlot >>> 1) - 1) - ALIGN_BITS);
      }
      for (let i = 0; i < DIST_MODEL_START; ++i) this.distPrices[distState * FULL_DISTANCES + i] = this.distSlotPrices[dsp + i];
    }
    for (let i = DIST_MODEL_START; i < FULL_DISTANCES; ++i) {
      const distSlot = getDistSlot(i);
      const footerBits = (distSlot >>> 1) - 1;
      const base = (2 | (distSlot & 1)) << footerBits;
      const price = bittreeReversePrice(this.distSpecial, base - distSlot - 1, footerBits, i - base);
      for (let distState = 0; distState < DIST_STATES; ++distState) {
        this.distPrices[distState * FULL_DISTANCES + i] = price + this.distSlotPrices[distState * DIST_SLOTS + distSlot];
      }
    }
    this.matchPriceCount = 0;
  }

  _fillAlignPrices() {
    for (let i = 0; i < ALIGN_SIZE; ++i) this.alignPrices[i] = bittreeReversePrice(this.distAlign, 0, ALIGN_BITS, i);
    this.alignPriceCount = 0;
  }

  _backward(lenRes, backRes, cur) {
    const opts = this.opts;
    this.optsEndIndex = cur;
    let posMem = opts[cur].posPrev;
    let backMem = opts[cur].backPrev;
    do {
      if (opts[cur].prev1IsLiteral) {
        opts[posMem].backPrev = UINT32_MAX; opts[posMem].prev1IsLiteral = false;   // make_literal
        opts[posMem].posPrev = posMem - 1;
        if (opts[cur].prev2) {
          opts[posMem - 1].prev1IsLiteral = false;
          opts[posMem - 1].posPrev = opts[cur].posPrev2;
          opts[posMem - 1].backPrev = opts[cur].backPrev2;
        }
      }
      const posPrev = posMem;
      const backCur = backMem;
      backMem = opts[posPrev].backPrev;
      posMem = opts[posPrev].posPrev;
      opts[posPrev].backPrev = backCur;
      opts[posPrev].posPrev = cur;
      cur = posPrev;
    } while (cur !== 0);
    this.optsCurrentIndex = opts[0].posPrev;
    lenRes.v = opts[0].posPrev;
    backRes.v = opts[0].backPrev;
  }

  _helper1(mf, backRes, lenRes, position) {
    const niceLen = mf.niceLen;
    const matches = this.matches, opts = this.opts, b = mf.buffer;
    let lenMain, matchesCount;
    if (mf.readAhead === 0) {
      lenMain = mf.mfFind(matches);
      matchesCount = mf._count;
    } else {
      lenMain = this.longestMatchLength;
      matchesCount = this.matchesCount;
    }
    const bufAvail = Math.min(mf.avail() + 1, MATCH_LEN_MAX);
    if (bufAvail < 2) { backRes.v = UINT32_MAX; lenRes.v = 1; return UINT32_MAX; }
    const buf = mf.readPos - 1;
    const repLens = this._repLens;
    let repMaxIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) { repLens[i] = 0; continue; }
      repLens[i] = memcmplen(b, buf, bufBack, 2, bufAvail);
      if (repLens[i] > repLens[repMaxIndex]) repMaxIndex = i;
    }
    if (repLens[repMaxIndex] >= niceLen) {
      backRes.v = repMaxIndex;
      lenRes.v = repLens[repMaxIndex];
      mf.mfSkip(lenRes.v - 1);
      return UINT32_MAX;
    }
    if (lenMain >= niceLen) {
      backRes.v = matches[matchesCount - 1].dist + REPS;
      lenRes.v = lenMain;
      mf.mfSkip(lenMain - 1);
      return UINT32_MAX;
    }
    const currentByte = b[buf];
    const matchByte = b[buf - this.reps[0] - 1];
    if (lenMain < 2 && currentByte !== matchByte && repLens[repMaxIndex] < 2) {
      backRes.v = UINT32_MAX; lenRes.v = 1;
      return UINT32_MAX;
    }
    const state = this.state;
    opts[0].state = state;
    const posState = position & this.posMask;
    opts[1].price = bit0Price(this.isMatch[state * POS_STATES_MAX + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    opts[1].backPrev = UINT32_MAX; opts[1].prev1IsLiteral = false;   // make_literal
    const matchPrice = bit1Price(this.isMatch[state * POS_STATES_MAX + posState]);
    const repMatchPrice = matchPrice + bit1Price(this.isRep[state]);
    if (matchByte === currentByte) {
      const shortRepPrice = repMatchPrice + this._getShortRepPrice(state, posState);
      if (shortRepPrice < opts[1].price) {
        opts[1].price = shortRepPrice;
        opts[1].backPrev = 0; opts[1].prev1IsLiteral = false;   // make_short_rep
      }
    }
    const lenEnd = Math.max(lenMain, repLens[repMaxIndex]);
    if (lenEnd < 2) {
      backRes.v = opts[1].backPrev;
      lenRes.v = 1;
      return UINT32_MAX;
    }
    opts[1].posPrev = 0;
    for (let i = 0; i < REPS; ++i) opts[0].backs[i] = this.reps[i];
    let len = lenEnd;
    do {
      opts[len].price = RC_INFINITY_PRICE;
    } while (--len >= 2);
    for (let i = 0; i < REPS; ++i) {
      let repLen = repLens[i];
      if (repLen < 2) continue;
      const price = repMatchPrice + this._getPureRepPrice(i, state, posState);
      do {
        const curAndLenPrice = price + this.repLenEncoder.price(repLen, posState);
        if (curAndLenPrice < opts[repLen].price) {
          opts[repLen].price = curAndLenPrice;
          opts[repLen].posPrev = 0;
          opts[repLen].backPrev = i;
          opts[repLen].prev1IsLiteral = false;
        }
      } while (--repLen >= 2);
    }
    const normalMatchPrice = matchPrice + bit0Price(this.isRep[state]);
    len = repLens[0] >= 2 ? repLens[0] + 1 : 2;
    if (len <= lenMain) {
      let i = 0;
      while (len > matches[i].len) ++i;
      for (; ; ++len) {
        const dist = matches[i].dist;
        const curAndLenPrice = normalMatchPrice + this._getDistLenPrice(dist, len, posState);
        if (curAndLenPrice < opts[len].price) {
          opts[len].price = curAndLenPrice;
          opts[len].posPrev = 0;
          opts[len].backPrev = dist + REPS;
          opts[len].prev1IsLiteral = false;
        }
        if (len === matches[i].len) if (++i === matchesCount) break;
      }
    }
    return lenEnd;
  }

  _helper2(reps, b, buf, lenEnd, position, cur, niceLen, bufAvailFull) {
    const opts = this.opts, matches = this.matches;
    let matchesCount = this.matchesCount;
    let newLen = this.longestMatchLength;
    let posPrev = opts[cur].posPrev;
    let state;
    if (opts[cur].prev1IsLiteral) {
      --posPrev;
      if (opts[cur].prev2) {
        state = opts[opts[cur].posPrev2].state;
        if (opts[cur].backPrev2 < REPS) state = updateLongRep(state);
        else state = updateMatch(state);
      } else {
        state = opts[posPrev].state;
      }
      state = updateLiteral(state);
    } else {
      state = opts[posPrev].state;
    }
    if (posPrev === cur - 1) {
      if (opts[cur].backPrev === 0) state = updateShortRep(state);   // is_short_rep
      else state = updateLiteral(state);
    } else {
      let pos;
      if (opts[cur].prev1IsLiteral && opts[cur].prev2) {
        posPrev = opts[cur].posPrev2;
        pos = opts[cur].backPrev2;
        state = updateLongRep(state);
      } else {
        pos = opts[cur].backPrev;
        if (pos < REPS) state = updateLongRep(state);
        else state = updateMatch(state);
      }
      if (pos < REPS) {
        reps[0] = opts[posPrev].backs[pos];
        let i;
        for (i = 1; i <= pos; ++i) reps[i] = opts[posPrev].backs[i - 1];
        for (; i < REPS; ++i) reps[i] = opts[posPrev].backs[i];
      } else {
        reps[0] = pos - REPS;
        for (let i = 1; i < REPS; ++i) reps[i] = opts[posPrev].backs[i - 1];
      }
    }
    opts[cur].state = state;
    for (let i = 0; i < REPS; ++i) opts[cur].backs[i] = reps[i];
    const curPrice = opts[cur].price;
    const currentByte = b[buf];
    const matchByte = b[buf - reps[0] - 1];
    const posState = position & this.posMask;
    const curAnd1Price = curPrice
        + bit0Price(this.isMatch[state * POS_STATES_MAX + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    let nextIsLiteral = false;
    if (curAnd1Price < opts[cur + 1].price) {
      opts[cur + 1].price = curAnd1Price;
      opts[cur + 1].posPrev = cur;
      opts[cur + 1].backPrev = UINT32_MAX; opts[cur + 1].prev1IsLiteral = false;   // make_literal
      nextIsLiteral = true;
    }
    const matchPrice = curPrice + bit1Price(this.isMatch[state * POS_STATES_MAX + posState]);
    const repMatchPrice = matchPrice + bit1Price(this.isRep[state]);
    if (matchByte === currentByte && !(opts[cur + 1].posPrev < cur && opts[cur + 1].backPrev === 0)) {
      const shortRepPrice = repMatchPrice + this._getShortRepPrice(state, posState);
      if (shortRepPrice <= opts[cur + 1].price) {
        opts[cur + 1].price = shortRepPrice;
        opts[cur + 1].posPrev = cur;
        opts[cur + 1].backPrev = 0; opts[cur + 1].prev1IsLiteral = false;   // make_short_rep
        nextIsLiteral = true;
      }
    }
    if (bufAvailFull < 2) return lenEnd;
    const bufAvail = Math.min(bufAvailFull, niceLen);
    if (!nextIsLiteral && matchByte !== currentByte) {
      const bufBack = buf - reps[0] - 1;
      const limit = Math.min(bufAvailFull, niceLen + 1);
      const lenTest = memcmplen(b, buf, bufBack, 1, limit) - 1;
      if (lenTest >= 2) {
        let state2 = updateLiteral(state);
        const posStateNext = (position + 1) & this.posMask;
        const nextRepMatchPrice = curAnd1Price
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX + posStateNext])
            + bit1Price(this.isRep[state2]);
        const offset = cur + 1 + lenTest;
        while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
        const curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest, state2, posStateNext);
        if (curAndLenPrice < opts[offset].price) {
          opts[offset].price = curAndLenPrice;
          opts[offset].posPrev = cur + 1;
          opts[offset].backPrev = 0;
          opts[offset].prev1IsLiteral = true;
          opts[offset].prev2 = false;
        }
      }
    }
    let startLen = 2;
    for (let repIndex = 0; repIndex < REPS; ++repIndex) {
      const bufBack = buf - reps[repIndex] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) continue;
      let lenTest = memcmplen(b, buf, bufBack, 2, bufAvail);
      while (lenEnd < cur + lenTest) opts[++lenEnd].price = RC_INFINITY_PRICE;
      const lenTestTemp = lenTest;
      const price = repMatchPrice + this._getPureRepPrice(repIndex, state, posState);
      do {
        const curAndLenPrice = price + this.repLenEncoder.price(lenTest, posState);
        if (curAndLenPrice < opts[cur + lenTest].price) {
          opts[cur + lenTest].price = curAndLenPrice;
          opts[cur + lenTest].posPrev = cur;
          opts[cur + lenTest].backPrev = repIndex;
          opts[cur + lenTest].prev1IsLiteral = false;
        }
      } while (--lenTest >= 2);
      lenTest = lenTestTemp;
      if (repIndex === 0) startLen = lenTest + 1;
      let lenTest2 = lenTest + 1;
      const limit = Math.min(bufAvailFull, lenTest2 + niceLen);
      if (lenTest2 < limit) lenTest2 = memcmplen(b, buf, bufBack, lenTest2, limit);
      lenTest2 -= lenTest + 1;
      if (lenTest2 >= 2) {
        let state2 = updateLongRep(state);
        let posStateNext = (position + lenTest) & this.posMask;
        const curAndLenLiteralPrice = price
            + this.repLenEncoder.price(lenTest, posState)
            + bit0Price(this.isMatch[state2 * POS_STATES_MAX + posStateNext])
            + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
        state2 = updateLiteral(state2);
        posStateNext = (position + lenTest + 1) & this.posMask;
        const nextRepMatchPrice = curAndLenLiteralPrice
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX + posStateNext])
            + bit1Price(this.isRep[state2]);
        const offset = cur + lenTest + 1 + lenTest2;
        while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
        const curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest2, state2, posStateNext);
        if (curAndLenPrice < opts[offset].price) {
          opts[offset].price = curAndLenPrice;
          opts[offset].posPrev = cur + lenTest + 1;
          opts[offset].backPrev = 0;
          opts[offset].prev1IsLiteral = true;
          opts[offset].prev2 = true;
          opts[offset].posPrev2 = cur;
          opts[offset].backPrev2 = repIndex;
        }
      }
    }
    if (newLen > bufAvail) {
      newLen = bufAvail;
      matchesCount = 0;
      while (newLen > matches[matchesCount].len) ++matchesCount;
      matches[matchesCount++].len = newLen;
    }
    if (newLen >= startLen) {
      const normalMatchPrice = matchPrice + bit0Price(this.isRep[state]);
      while (lenEnd < cur + newLen) opts[++lenEnd].price = RC_INFINITY_PRICE;
      let i = 0;
      while (startLen > matches[i].len) ++i;
      for (let lenTest = startLen; ; ++lenTest) {
        const curBack = matches[i].dist;
        let curAndLenPrice = normalMatchPrice + this._getDistLenPrice(curBack, lenTest, posState);
        if (curAndLenPrice < opts[cur + lenTest].price) {
          opts[cur + lenTest].price = curAndLenPrice;
          opts[cur + lenTest].posPrev = cur;
          opts[cur + lenTest].backPrev = curBack + REPS;
          opts[cur + lenTest].prev1IsLiteral = false;
        }
        if (lenTest === matches[i].len) {
          const bufBack = buf - curBack - 1;
          let lenTest2 = lenTest + 1;
          const limit = Math.min(bufAvailFull, lenTest2 + niceLen);
          if (lenTest2 < limit) lenTest2 = memcmplen(b, buf, bufBack, lenTest2, limit);
          lenTest2 -= lenTest + 1;
          if (lenTest2 >= 2) {
            let state2 = updateMatch(state);
            let posStateNext = (position + lenTest) & this.posMask;
            const curAndLenLiteralPrice = curAndLenPrice
                + bit0Price(this.isMatch[state2 * POS_STATES_MAX + posStateNext])
                + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
            state2 = updateLiteral(state2);
            posStateNext = (posStateNext + 1) & this.posMask;
            const nextRepMatchPrice = curAndLenLiteralPrice
                + bit1Price(this.isMatch[state2 * POS_STATES_MAX + posStateNext])
                + bit1Price(this.isRep[state2]);
            const offset = cur + lenTest + 1 + lenTest2;
            while (lenEnd < offset) opts[++lenEnd].price = RC_INFINITY_PRICE;
            curAndLenPrice = nextRepMatchPrice + this._getRepPrice(0, lenTest2, state2, posStateNext);
            if (curAndLenPrice < opts[offset].price) {
              opts[offset].price = curAndLenPrice;
              opts[offset].posPrev = cur + lenTest + 1;
              opts[offset].backPrev = 0;
              opts[offset].prev1IsLiteral = true;
              opts[offset].prev2 = true;
              opts[offset].posPrev2 = cur;
              opts[offset].backPrev2 = curBack + REPS;
            }
          }
          if (++i === matchesCount) break;
        }
      }
    }
    return lenEnd;
  }

  _optimumNormal(mf, backRes, lenRes, position) {
    const opts = this.opts;
    if (this.optsEndIndex !== this.optsCurrentIndex) {
      lenRes.v = opts[this.optsCurrentIndex].posPrev - this.optsCurrentIndex;
      backRes.v = opts[this.optsCurrentIndex].backPrev;
      this.optsCurrentIndex = opts[this.optsCurrentIndex].posPrev;
      return;
    }
    if (mf.readAhead === 0) {
      if (this.matchPriceCount >= (1 << 7)) this._fillDistPrices();
      if (this.alignPriceCount >= ALIGN_SIZE) this._fillAlignPrices();
    }
    let lenEnd = this._helper1(mf, backRes, lenRes, position);
    if (lenEnd === UINT32_MAX) return;
    const reps = this._repsTmp;
    reps.set(this.reps);
    let cur;
    for (cur = 1; cur < lenEnd; ++cur) {
      this.longestMatchLength = mf.mfFind(this.matches);
      this.matchesCount = mf._count;
      if (this.longestMatchLength >= mf.niceLen) break;
      lenEnd = this._helper2(reps, mf.buffer, mf.readPos - 1, lenEnd, (position + cur) >>> 0, cur, mf.niceLen,
        Math.min(mf.avail() + 1, OPTS - 1 - cur));
    }
    this._backward(lenRes, backRes, cur);
  }
}

const changePair = (smallDist, bigDist) => (bigDist >>> 7) > smallDist;

function memcmplen(buf, a, b, len, limit) {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
}

// lzma_lzma_lclppb_encode
export const lclppbByte = (o) => (o.pb * 5 + o.lp) * 9 + o.lc;
