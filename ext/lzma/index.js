// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/lzma — xz / LZMA in plain JavaScript, both directions: liblzma 5.8.1 ported, so what it writes is byte-identical to the xz tool's and CPython's lzma (every preset, the extreme ones, .xz / .lzma / raw, CRC32 / CRC64 / SHA-256, the delta and branch filters), and it reads them as liblzma does — streamed, with maxLength, needsInput and unusedData. No Wasm, no dependencies.

// ── src/lzma-encoder.js ──

// The LZMA encoder: range_encoder.h, price.h / price_tablegen.c, fastpos.h, lzma_encoder.c,
// lzma_encoder_optimum_fast.c and lzma_encoder_optimum_normal.c of liblzma 5.8.1, ported line
// for line — the parser's choices decide the bytes, so they are liblzma's. A probability is an
// index into one of the coder's Uint16Arrays; the range encoder queues (array, index, bit).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// ── constants (lzma_common.h, range_common.h, price.h) ──
const RC_SHIFT_BITS = 8, RC_TOP_VALUE$lzma_encoder = 1 << 24;
const RC_BIT_MODEL_TOTAL_BITS$lzma_encoder = 11, RC_BIT_MODEL_TOTAL$lzma_encoder = 1 << 11, RC_MOVE_BITS$lzma_encoder = 5;
const RC_MOVE_REDUCING_BITS = 4, RC_BIT_PRICE_SHIFT_BITS = 4;
const RC_INFINITY_PRICE = 1 << 30;
const RC_SYMBOLS_MAX = 53;
const RC_BIT_0 = 0, RC_BIT_1 = 1, RC_DIRECT_0 = 2, RC_DIRECT_1 = 3, RC_FLUSH = 4;

const STATES$lzma_encoder = 12, LIT_STATES$lzma_encoder = 7;
const POS_STATES_MAX$lzma_encoder = 16;
const LITERAL_CODER_SIZE$lzma_encoder = 0x300, LITERAL_CODERS_MAX$lzma_encoder = 16;
const MATCH_LEN_MIN$lzma_encoder = 2;
const LEN_LOW_BITS = 3, LEN_LOW_SYMBOLS$lzma_encoder = 8, LEN_MID_BITS = 3, LEN_MID_SYMBOLS$lzma_encoder = 8, LEN_HIGH_BITS = 8, LEN_HIGH_SYMBOLS$lzma_encoder = 256;
const LEN_SYMBOLS = LEN_LOW_SYMBOLS$lzma_encoder + LEN_MID_SYMBOLS$lzma_encoder + LEN_HIGH_SYMBOLS$lzma_encoder;
const MATCH_LEN_MAX = MATCH_LEN_MIN$lzma_encoder + LEN_SYMBOLS - 1;   // 273
const DIST_STATES$lzma_encoder = 4, DIST_SLOT_BITS = 6, DIST_SLOTS$lzma_encoder = 64;
const DIST_MODEL_START$lzma_encoder = 4, DIST_MODEL_END$lzma_encoder = 14;
const FULL_DISTANCES$lzma_encoder = 1 << 7;
const ALIGN_BITS$lzma_encoder = 4, ALIGN_SIZE$lzma_encoder = 16, ALIGN_MASK = 15;
const REPS = 4;
const OPTS = 1 << 12;
const LOOP_INPUT_MAX = OPTS + 1;
const LZMA2_CHUNK_MAX = 1 << 16;
const UINT32_MAX$lzma_encoder = 0xffffffff;

// state transitions
const updateLiteral$lzma_encoder = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);
const updateLiteralNormal = (s) => (s <= 3 ? 0 : s - 3);
const updateLiteralMatched = (s) => (s <= 9 ? s - 3 : s - 6);
const updateMatch = (s) => (s < LIT_STATES$lzma_encoder ? 7 : 10);
const updateLongRep = (s) => (s < LIT_STATES$lzma_encoder ? 8 : 11);
const updateShortRep = (s) => (s < LIT_STATES$lzma_encoder ? 9 : 11);
const isLiteralState = (s) => s < LIT_STATES$lzma_encoder;
const getDistState = (len) => (len < DIST_STATES$lzma_encoder + MATCH_LEN_MIN$lzma_encoder ? len - MATCH_LEN_MIN$lzma_encoder : DIST_STATES$lzma_encoder - 1);

// get_dist_slot (fastpos.h's HAVE_SMALL form — the same values as its table)
function getDistSlot(dist) {
  if (dist <= 4) return dist;
  const i = 31 - Math.clz32(dist);
  return (i + i) + ((dist >>> (i - 1)) & 1);
}

// lzma_rc_prices (price_tablegen.c)
const RC_PRICES = (() => {
  const t = new Uint8Array(RC_BIT_MODEL_TOTAL$lzma_encoder >>> RC_MOVE_REDUCING_BITS);
  for (let i = (1 << RC_MOVE_REDUCING_BITS) / 2; i < RC_BIT_MODEL_TOTAL$lzma_encoder; i += 1 << RC_MOVE_REDUCING_BITS) {
    const cyclesBits = RC_BIT_PRICE_SHIFT_BITS;
    let w = i, bitCount = 0;
    for (let j = 0; j < cyclesBits; ++j) {
      w = Math.imul(w, w) >>> 0;
      bitCount <<= 1;
      while (w >= (1 << 16)) { w >>>= 1; ++bitCount; }
    }
    t[i >> RC_MOVE_REDUCING_BITS] = (RC_BIT_MODEL_TOTAL_BITS$lzma_encoder << cyclesBits) - 15 - bitCount;
  }
  return t;
})();
const bitPrice = (prob, bit) => RC_PRICES[(prob ^ ((-bit) & (RC_BIT_MODEL_TOTAL$lzma_encoder - 1))) >>> RC_MOVE_REDUCING_BITS];
const bit0Price = (prob) => RC_PRICES[prob >>> RC_MOVE_REDUCING_BITS];
const bit1Price = (prob) => RC_PRICES[(prob ^ (RC_BIT_MODEL_TOTAL$lzma_encoder - 1)) >>> RC_MOVE_REDUCING_BITS];
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
    this.range = UINT32_MAX$lzma_encoder;
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
      if (this.range < RC_TOP_VALUE$lzma_encoder) {
        if (this._shiftLow(out)) return true;
        this.range = (this.range << RC_SHIFT_BITS) >>> 0;
      }
      switch (this.symbols[this.pos]) {
        case RC_BIT_0: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          this.range = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder, prob) >>> 0;
          prob += (RC_BIT_MODEL_TOTAL$lzma_encoder - prob) >>> RC_MOVE_BITS$lzma_encoder;
          arr[idx] = prob;
          break;
        }
        case RC_BIT_1: {
          const arr = this.probArr[this.pos], idx = this.probIdx[this.pos];
          let prob = arr[idx];
          const bound = Math.imul(prob, this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder) >>> 0;
          this.low += bound;
          this.range = (this.range - bound) >>> 0;
          prob -= prob >>> RC_MOVE_BITS$lzma_encoder;
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
          this.range = UINT32_MAX$lzma_encoder;
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
      if (range < RC_TOP_VALUE$lzma_encoder) {
        if (shift()) return true;
        range = (range << RC_SHIFT_BITS) >>> 0;
      }
      if (pos === this.count) break;
      switch (this.symbols[pos]) {
        case RC_BIT_0: range = Math.imul(range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder, this.probArr[pos][this.probIdx[pos]]) >>> 0; break;
        case RC_BIT_1: {
          const bound = Math.imul(this.probArr[pos][this.probIdx[pos]], range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_encoder) >>> 0;
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
const LC_CHOICE$lzma_encoder = 0, LC_CHOICE2$lzma_encoder = 1, LC_LOW$lzma_encoder = 2, LC_MID$lzma_encoder = 2 + POS_STATES_MAX$lzma_encoder * LEN_LOW_SYMBOLS$lzma_encoder, LC_HIGH$lzma_encoder = LC_MID$lzma_encoder + POS_STATES_MAX$lzma_encoder * LEN_MID_SYMBOLS$lzma_encoder;
class LengthEncoder {
  constructor() {
    this.probs = new Uint16Array(LC_HIGH$lzma_encoder + LEN_HIGH_SYMBOLS$lzma_encoder);
    this.prices = new Uint32Array(POS_STATES_MAX$lzma_encoder * LEN_SYMBOLS);
    this.tableSize = 0;
    this.counters = new Uint32Array(POS_STATES_MAX$lzma_encoder);
  }
  reset(numPosStates, fastMode) {
    this.probs.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    if (!fastMode) for (let ps = 0; ps < numPosStates; ++ps) this.updatePrices(ps);
  }
  updatePrices(posState) {
    const tableSize = this.tableSize, p = this.probs;
    this.counters[posState] = tableSize;
    const a0 = bit0Price(p[LC_CHOICE$lzma_encoder]);
    const a1 = bit1Price(p[LC_CHOICE$lzma_encoder]);
    const b0 = a1 + bit0Price(p[LC_CHOICE2$lzma_encoder]);
    const b1 = a1 + bit1Price(p[LC_CHOICE2$lzma_encoder]);
    const base = posState * LEN_SYMBOLS;
    let i;
    for (i = 0; i < tableSize && i < LEN_LOW_SYMBOLS$lzma_encoder; ++i) this.prices[base + i] = a0 + bittreePrice(p, LC_LOW$lzma_encoder + posState * LEN_LOW_SYMBOLS$lzma_encoder, LEN_LOW_BITS, i);
    for (; i < tableSize && i < LEN_LOW_SYMBOLS$lzma_encoder + LEN_MID_SYMBOLS$lzma_encoder; ++i) this.prices[base + i] = b0 + bittreePrice(p, LC_MID$lzma_encoder + posState * LEN_MID_SYMBOLS$lzma_encoder, LEN_MID_BITS, i - LEN_LOW_SYMBOLS$lzma_encoder);
    for (; i < tableSize; ++i) this.prices[base + i] = b1 + bittreePrice(p, LC_HIGH$lzma_encoder, LEN_HIGH_BITS, i - LEN_LOW_SYMBOLS$lzma_encoder - LEN_MID_SYMBOLS$lzma_encoder);
  }
  encode(rc, posState, len, fastMode) {
    const p = this.probs;
    len -= MATCH_LEN_MIN$lzma_encoder;
    if (len < LEN_LOW_SYMBOLS$lzma_encoder) {
      rc.bit(p, LC_CHOICE$lzma_encoder, 0);
      rc.bittree(p, LC_LOW$lzma_encoder + posState * LEN_LOW_SYMBOLS$lzma_encoder, LEN_LOW_BITS, len);
    } else {
      rc.bit(p, LC_CHOICE$lzma_encoder, 1);
      len -= LEN_LOW_SYMBOLS$lzma_encoder;
      if (len < LEN_MID_SYMBOLS$lzma_encoder) {
        rc.bit(p, LC_CHOICE2$lzma_encoder, 0);
        rc.bittree(p, LC_MID$lzma_encoder + posState * LEN_MID_SYMBOLS$lzma_encoder, LEN_MID_BITS, len);
      } else {
        rc.bit(p, LC_CHOICE2$lzma_encoder, 1);
        len -= LEN_MID_SYMBOLS$lzma_encoder;
        rc.bittree(p, LC_HIGH$lzma_encoder, LEN_HIGH_BITS, len);
      }
    }
    if (!fastMode) if (--this.counters[posState] === 0) this.updatePrices(posState);
  }
  price(len, posState) { return this.prices[posState * LEN_SYMBOLS + len - MATCH_LEN_MIN$lzma_encoder]; }
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
class LzmaEncoder {
  constructor(options, { isLzma1 = false } = {}) {
    if (!(options.lc <= 4 && options.lp <= 4 && options.lc + options.lp <= 4 && options.pb <= 4)) throw new RangeError('lzma: invalid lc / lp / pb');
    if (!(options.niceLen >= MATCH_LEN_MIN$lzma_encoder && options.niceLen <= MATCH_LEN_MAX)) throw new RangeError('lzma: invalid nice_len');
    this.rc = new RangeEncoder();
    this.reps = new Uint32Array(REPS);
    this.matches = Array.from({ length: MATCH_LEN_MAX + 1 }, () => ({ len: 0, dist: 0 }));
    this.matchesCount = 0;
    this.longestMatchLength = 0;
    this.literal = new Uint16Array(LITERAL_CODERS_MAX$lzma_encoder * LITERAL_CODER_SIZE$lzma_encoder);
    this.isMatch = new Uint16Array(STATES$lzma_encoder * POS_STATES_MAX$lzma_encoder);
    this.isRep = new Uint16Array(STATES$lzma_encoder);
    this.isRep0 = new Uint16Array(STATES$lzma_encoder);
    this.isRep1 = new Uint16Array(STATES$lzma_encoder);
    this.isRep2 = new Uint16Array(STATES$lzma_encoder);
    this.isRep0Long = new Uint16Array(STATES$lzma_encoder * POS_STATES_MAX$lzma_encoder);
    this.distSlot = new Uint16Array(DIST_STATES$lzma_encoder * DIST_SLOTS$lzma_encoder);
    this.distSpecial = new Uint16Array(FULL_DISTANCES$lzma_encoder - DIST_MODEL_END$lzma_encoder);
    this.distAlign = new Uint16Array(ALIGN_SIZE$lzma_encoder);
    this.matchLenEncoder = new LengthEncoder();
    this.repLenEncoder = new LengthEncoder();
    this.distSlotPrices = new Uint32Array(DIST_STATES$lzma_encoder * DIST_SLOTS$lzma_encoder);
    this.distPrices = new Uint32Array(DIST_STATES$lzma_encoder * FULL_DISTANCES$lzma_encoder);
    this.alignPrices = new Uint32Array(ALIGN_SIZE$lzma_encoder);
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
      this.matchLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN$lzma_encoder;
      this.repLenEncoder.tableSize = niceLen + 1 - MATCH_LEN_MIN$lzma_encoder;
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
    this.literal.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isMatch.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep0Long.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep0.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep1.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.isRep2.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distSpecial.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distSlot.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.distAlign.fill(RC_BIT_MODEL_TOTAL$lzma_encoder >>> 1);
    this.matchLenEncoder.reset(1 << options.pb, this.fastMode);
    this.repLenEncoder.reset(1 << options.pb, this.fastMode);
    this.matchPriceCount = (UINT32_MAX$lzma_encoder / 2) >>> 0;
    this.alignPriceCount = (UINT32_MAX$lzma_encoder / 2) >>> 0;
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
    this.rc.bittree(this.distSlot, distState * DIST_SLOTS$lzma_encoder, DIST_SLOT_BITS, distSlot);
    if (distSlot >= DIST_MODEL_START$lzma_encoder) {
      const footerBits = (distSlot >>> 1) - 1;
      const base = ((2 | (distSlot & 1)) << footerBits) >>> 0;
      const distReduced = (distance - base) >>> 0;
      if (distSlot < DIST_MODEL_END$lzma_encoder) {
        this.rc.bittreeReverse(this.distSpecial, base - distSlot - 1, footerBits, distReduced);
      } else {
        this.rc.direct(distReduced >>> ALIGN_BITS$lzma_encoder, footerBits - ALIGN_BITS$lzma_encoder);
        this.rc.bittreeReverse(this.distAlign, 0, ALIGN_BITS$lzma_encoder, distReduced & ALIGN_MASK);
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
      this.rc.bit(this.isRep0Long, s * POS_STATES_MAX$lzma_encoder + posState, len !== 1 ? 1 : 0);
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
    if (back === UINT32_MAX$lzma_encoder) {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 0);
      this._literal(mf, position);
    } else {
      this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 1);
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
    this.rc.bit(this.isMatch, s * POS_STATES_MAX$lzma_encoder + posState, 1);
    this.rc.bit(this.isRep, s, 0);
    this._match(posState, UINT32_MAX$lzma_encoder, MATCH_LEN_MIN$lzma_encoder);
  }

  // lzma_lzma_encode: 'ok' (needs more input, or out filled), or 'end' (flushed: a chunk, or
  // the stream). limit: UINT32_MAX, or the LZMA2 chunk's uncompressed limit
  encode(mf, out, limit) {
    if (!this.isInitialized && !this._encodeInit(mf)) return 'ok';
    if (this.rc.encode(out)) return 'ok';
    if (this.isFlushed) return 'end';
    const back = { v: 0 }, len = { v: 0 };
    while (true) {
      if (limit !== UINT32_MAX$lzma_encoder
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
    if (bufAvail < 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return; }

    let repLen = 0, repIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) continue;
      const len = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
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
    if (lenMain < 2 || bufAvail <= 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return; }

    this.longestMatchLength = mf.mfFind(matches);
    this.matchesCount = mf._count;
    if (this.longestMatchLength >= 2) {
      const newDist = matches[this.matchesCount - 1].dist;
      if ((this.longestMatchLength >= lenMain && newDist < backMain)
          || (this.longestMatchLength === lenMain + 1 && !changePair(backMain, newDist))
          || (this.longestMatchLength > lenMain + 1)
          || (this.longestMatchLength + 1 >= lenMain && lenMain >= 3 && changePair(newDist, backMain))) {
        backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
        return;
      }
    }
    ++buf;
    const limit = Math.max(2, lenMain - 1);
    for (let i = 0; i < REPS; ++i) {
      if (memcmplen$lzma_encoder(b, buf, buf - this.reps[i] - 1, 0, limit) === limit) {
        backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
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
    return bit0Price(this.isRep0[state]) + bit0Price(this.isRep0Long[state * POS_STATES_MAX$lzma_encoder + posState]);
  }

  _getPureRepPrice(repIndex, state, posState) {
    let price;
    if (repIndex === 0) {
      price = bit0Price(this.isRep0[state]);
      price += bit1Price(this.isRep0Long[state * POS_STATES_MAX$lzma_encoder + posState]);
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
    if (dist < FULL_DISTANCES$lzma_encoder) {
      price = this.distPrices[distState * FULL_DISTANCES$lzma_encoder + dist];
    } else {
      const distSlot = getDistSlot(dist);
      price = this.distSlotPrices[distState * DIST_SLOTS$lzma_encoder + distSlot] + this.alignPrices[dist & ALIGN_MASK];
    }
    price += this.matchLenEncoder.price(len, posState);
    return price;
  }

  _fillDistPrices() {
    for (let distState = 0; distState < DIST_STATES$lzma_encoder; ++distState) {
      const dsp = distState * DIST_SLOTS$lzma_encoder;
      for (let distSlot = 0; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] = bittreePrice(this.distSlot, distState * DIST_SLOTS$lzma_encoder, DIST_SLOT_BITS, distSlot);
      }
      for (let distSlot = DIST_MODEL_END$lzma_encoder; distSlot < this.distTableSize; ++distSlot) {
        this.distSlotPrices[dsp + distSlot] += directPrice(((distSlot >>> 1) - 1) - ALIGN_BITS$lzma_encoder);
      }
      for (let i = 0; i < DIST_MODEL_START$lzma_encoder; ++i) this.distPrices[distState * FULL_DISTANCES$lzma_encoder + i] = this.distSlotPrices[dsp + i];
    }
    for (let i = DIST_MODEL_START$lzma_encoder; i < FULL_DISTANCES$lzma_encoder; ++i) {
      const distSlot = getDistSlot(i);
      const footerBits = (distSlot >>> 1) - 1;
      const base = (2 | (distSlot & 1)) << footerBits;
      const price = bittreeReversePrice(this.distSpecial, base - distSlot - 1, footerBits, i - base);
      for (let distState = 0; distState < DIST_STATES$lzma_encoder; ++distState) {
        this.distPrices[distState * FULL_DISTANCES$lzma_encoder + i] = price + this.distSlotPrices[distState * DIST_SLOTS$lzma_encoder + distSlot];
      }
    }
    this.matchPriceCount = 0;
  }

  _fillAlignPrices() {
    for (let i = 0; i < ALIGN_SIZE$lzma_encoder; ++i) this.alignPrices[i] = bittreeReversePrice(this.distAlign, 0, ALIGN_BITS$lzma_encoder, i);
    this.alignPriceCount = 0;
  }

  _backward(lenRes, backRes, cur) {
    const opts = this.opts;
    this.optsEndIndex = cur;
    let posMem = opts[cur].posPrev;
    let backMem = opts[cur].backPrev;
    do {
      if (opts[cur].prev1IsLiteral) {
        opts[posMem].backPrev = UINT32_MAX$lzma_encoder; opts[posMem].prev1IsLiteral = false;   // make_literal
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
    if (bufAvail < 2) { backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1; return UINT32_MAX$lzma_encoder; }
    const buf = mf.readPos - 1;
    const repLens = this._repLens;
    let repMaxIndex = 0;
    for (let i = 0; i < REPS; ++i) {
      const bufBack = buf - this.reps[i] - 1;
      if (b[buf] !== b[bufBack] || b[buf + 1] !== b[bufBack + 1]) { repLens[i] = 0; continue; }
      repLens[i] = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
      if (repLens[i] > repLens[repMaxIndex]) repMaxIndex = i;
    }
    if (repLens[repMaxIndex] >= niceLen) {
      backRes.v = repMaxIndex;
      lenRes.v = repLens[repMaxIndex];
      mf.mfSkip(lenRes.v - 1);
      return UINT32_MAX$lzma_encoder;
    }
    if (lenMain >= niceLen) {
      backRes.v = matches[matchesCount - 1].dist + REPS;
      lenRes.v = lenMain;
      mf.mfSkip(lenMain - 1);
      return UINT32_MAX$lzma_encoder;
    }
    const currentByte = b[buf];
    const matchByte = b[buf - this.reps[0] - 1];
    if (lenMain < 2 && currentByte !== matchByte && repLens[repMaxIndex] < 2) {
      backRes.v = UINT32_MAX$lzma_encoder; lenRes.v = 1;
      return UINT32_MAX$lzma_encoder;
    }
    const state = this.state;
    opts[0].state = state;
    const posState = position & this.posMask;
    opts[1].price = bit0Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    opts[1].backPrev = UINT32_MAX$lzma_encoder; opts[1].prev1IsLiteral = false;   // make_literal
    const matchPrice = bit1Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState]);
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
      return UINT32_MAX$lzma_encoder;
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
      state = updateLiteral$lzma_encoder(state);
    } else {
      state = opts[posPrev].state;
    }
    if (posPrev === cur - 1) {
      if (opts[cur].backPrev === 0) state = updateShortRep(state);   // is_short_rep
      else state = updateLiteral$lzma_encoder(state);
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
        + bit0Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState])
        + this._getLiteralPrice(position, b[buf - 1], !isLiteralState(state), matchByte, currentByte);
    let nextIsLiteral = false;
    if (curAnd1Price < opts[cur + 1].price) {
      opts[cur + 1].price = curAnd1Price;
      opts[cur + 1].posPrev = cur;
      opts[cur + 1].backPrev = UINT32_MAX$lzma_encoder; opts[cur + 1].prev1IsLiteral = false;   // make_literal
      nextIsLiteral = true;
    }
    const matchPrice = curPrice + bit1Price(this.isMatch[state * POS_STATES_MAX$lzma_encoder + posState]);
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
      const lenTest = memcmplen$lzma_encoder(b, buf, bufBack, 1, limit) - 1;
      if (lenTest >= 2) {
        let state2 = updateLiteral$lzma_encoder(state);
        const posStateNext = (position + 1) & this.posMask;
        const nextRepMatchPrice = curAnd1Price
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
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
      let lenTest = memcmplen$lzma_encoder(b, buf, bufBack, 2, bufAvail);
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
      if (lenTest2 < limit) lenTest2 = memcmplen$lzma_encoder(b, buf, bufBack, lenTest2, limit);
      lenTest2 -= lenTest + 1;
      if (lenTest2 >= 2) {
        let state2 = updateLongRep(state);
        let posStateNext = (position + lenTest) & this.posMask;
        const curAndLenLiteralPrice = price
            + this.repLenEncoder.price(lenTest, posState)
            + bit0Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
            + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
        state2 = updateLiteral$lzma_encoder(state2);
        posStateNext = (position + lenTest + 1) & this.posMask;
        const nextRepMatchPrice = curAndLenLiteralPrice
            + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
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
          if (lenTest2 < limit) lenTest2 = memcmplen$lzma_encoder(b, buf, bufBack, lenTest2, limit);
          lenTest2 -= lenTest + 1;
          if (lenTest2 >= 2) {
            let state2 = updateMatch(state);
            let posStateNext = (position + lenTest) & this.posMask;
            const curAndLenLiteralPrice = curAndLenPrice
                + bit0Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
                + this._getLiteralPrice(position + lenTest, b[buf + lenTest - 1], true, b[bufBack + lenTest], b[buf + lenTest]);
            state2 = updateLiteral$lzma_encoder(state2);
            posStateNext = (posStateNext + 1) & this.posMask;
            const nextRepMatchPrice = curAndLenLiteralPrice
                + bit1Price(this.isMatch[state2 * POS_STATES_MAX$lzma_encoder + posStateNext])
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
      if (this.alignPriceCount >= ALIGN_SIZE$lzma_encoder) this._fillAlignPrices();
    }
    let lenEnd = this._helper1(mf, backRes, lenRes, position);
    if (lenEnd === UINT32_MAX$lzma_encoder) return;
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

function memcmplen$lzma_encoder(buf, a, b, len, limit) {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
}

// lzma_lzma_lclppb_encode
const lclppbByte = (o) => (o.pb * 5 + o.lp) * 9 + o.lc;

// ── src/check.js ──

// The integrity checks of the .xz format: CRC32 (also the LZ encoder's hash table), CRC64 and
// SHA-256, each incremental (check.c, crc32_*.c, crc64_*.c, sha256.c of liblzma, in effect —
// these are the standard algorithms, written for JavaScript). CRC64 runs on two 32-bit halves.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

// CRC32: reflected, polynomial 0xEDB88320
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0, start = 0, end = buf.length) {
  let c = ~crc >>> 0;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// CRC64 (ECMA-182, reflected — polynomial 0xC96C5795D7870F42), as two 32-bit tables
const CRC64_LO = new Uint32Array(256), CRC64_HI = new Uint32Array(256);
{
  const pLo = 0xd7870f42, pHi = 0xc96c5795;
  for (let i = 0; i < 256; i++) {
    let lo = i, hi = 0;
    for (let k = 0; k < 8; k++) {
      const bit = lo & 1;
      lo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
      hi = hi >>> 1;
      if (bit) { lo = (lo ^ pLo) >>> 0; hi = (hi ^ pHi) >>> 0; }
    }
    CRC64_LO[i] = lo; CRC64_HI[i] = hi;
  }
}

// state: [lo, hi] of the running CRC (pre-inverted); returns the new state
function crc64Update(state, buf, start = 0, end = buf.length) {
  let lo = state[0], hi = state[1];
  for (let i = start; i < end; i++) {
    const idx = (lo ^ buf[i]) & 0xff;
    const nlo = ((lo >>> 8) | ((hi & 0xff) << 24)) >>> 0;
    const nhi = hi >>> 8;
    lo = (nlo ^ CRC64_LO[idx]) >>> 0;
    hi = (nhi ^ CRC64_HI[idx]) >>> 0;
  }
  return [lo, hi];
}

// ── SHA-256 (FIPS 180-4) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }
  update(data, start = 0, end = data.length) {
    this.total += end - start;
    let i = start;
    if (this.bufLen) {
      while (i < end && this.bufLen < 64) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    while (i + 64 <= end) { this._block(data, i); i += 64; }
    while (i < end) this.buf[this.bufLen++] = data[i++];
    return this;
  }
  digest() {
    const bits = this.total * 8;
    const pad = new Uint8Array((this.bufLen < 56 ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const n = pad.length;
    const hiBits = Math.floor(bits / 0x100000000), loBits = bits >>> 0;
    pad[n - 8] = hiBits >>> 24; pad[n - 7] = hiBits >>> 16; pad[n - 6] = hiBits >>> 8; pad[n - 5] = hiBits;
    pad[n - 4] = loBits >>> 24; pad[n - 3] = loBits >>> 16; pad[n - 2] = loBits >>> 8; pad[n - 1] = loBits;
    const total = this.total;
    this.update(pad);
    this.total = total;
    const out = new Uint8Array(32);
    for (let j = 0; j < 8; j++) {
      out[j * 4] = this.h[j] >>> 24; out[j * 4 + 1] = this.h[j] >>> 16;
      out[j * 4 + 2] = this.h[j] >>> 8; out[j * 4 + 3] = this.h[j];
    }
    return out;
  }
  _block(d, o) {
    const w = this.w, h = this.h;
    for (let t = 0; t < 16; t++) w[t] = (d[o + t * 4] << 24) | (d[o + t * 4 + 1] << 16) | (d[o + t * 4 + 2] << 8) | d[o + t * 4 + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += dd; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
}

// the check IDs of the format, and their sizes on disk
const CHECK_NONE = 0, CHECK_CRC32 = 1, CHECK_CRC64 = 4, CHECK_SHA256 = 10;
const CHECK_ID_MAX = 15;
const CHECK_SIZES = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
const checkSize = (id) => CHECK_SIZES[id];
const isCheckSupported = (id) => id === CHECK_NONE || id === CHECK_CRC32 || id === CHECK_CRC64 || id === CHECK_SHA256;

// an incremental check of type id: update(bytes), finish() → its bytes as stored (little-endian
// for the CRCs, as liblzma writes them)
class Check {
  constructor(id) {
    this.id = id;
    if (id === CHECK_CRC32) this.crc = 0;
    else if (id === CHECK_CRC64) this.st = [0xffffffff, 0xffffffff];
    else if (id === CHECK_SHA256) this.sha = new Sha256();
  }
  update(buf, start = 0, end = buf.length) {
    if (this.id === CHECK_CRC32) this.crc = crc32(buf, this.crc, start, end);
    else if (this.id === CHECK_CRC64) this.st = crc64Update(this.st, buf, start, end);
    else if (this.id === CHECK_SHA256) this.sha.update(buf, start, end);
  }
  finish() {
    if (this.id === CHECK_NONE) return new Uint8Array(0);
    if (this.id === CHECK_CRC32) { const c = this.crc, o = new Uint8Array(4); o[0] = c; o[1] = c >>> 8; o[2] = c >>> 16; o[3] = c >>> 24; return o; }
    if (this.id === CHECK_CRC64) {
      const lo = ~this.st[0] >>> 0, hi = ~this.st[1] >>> 0, o = new Uint8Array(8);
      o[0] = lo; o[1] = lo >>> 8; o[2] = lo >>> 16; o[3] = lo >>> 24; o[4] = hi; o[5] = hi >>> 8; o[6] = hi >>> 16; o[7] = hi >>> 24;
      return o;
    }
    return this.sha.digest();
  }
}

// ── src/lz-encoder.js ──

// The LZ encoder's window and match finders: lz_encoder.c + lz_encoder_mf.c of liblzma 5.8.1,
// ported line for line (hash chains hc3 / hc4, binary trees bt2 / bt3 / bt4). Positions are
// uint32 arithmetic as in the C (`>>> 0` where a subtraction may wrap).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const MF_HC3 = 0x03, MF_HC4 = 0x04, MF_BT2 = 0x12, MF_BT3 = 0x13, MF_BT4 = 0x14;
const HASH_2_SIZE = 1 << 10, HASH_3_SIZE = 1 << 16;
const HASH_2_MASK = HASH_2_SIZE - 1, HASH_3_MASK = HASH_3_SIZE - 1;
const FIX_3_HASH_SIZE = HASH_2_SIZE, FIX_4_HASH_SIZE = HASH_2_SIZE + HASH_3_SIZE;
const EMPTY_HASH_VALUE = 0;
const MUST_NORMALIZE_POS = 0xffffffff;

const RUN$lz_encoder = 0, SYNC_FLUSH = 1, FINISH$lz_encoder = 3;

const memcmplen$lz_encoder = (buf, a, b, len, limit) => {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
};

class MatchFinder {
  // opts: { beforeSize, dictSize, afterSize, matchLenMax, niceLen, matchFinder, depth }
  constructor(opts) {
    const { beforeSize, dictSize, afterSize, matchLenMax, niceLen, matchFinder } = opts;
    if (dictSize < 4096 || dictSize > (1 << 30) + (1 << 29) || niceLen > matchLenMax) throw new RangeError('lzma: invalid LZ options');
    this.keepSizeBefore = beforeSize + dictSize;
    this.keepSizeAfter = afterSize + matchLenMax;
    let reserve = (dictSize / 2) >>> 0;
    if (reserve > (1 << 30)) reserve = (reserve / 2) >>> 0;
    reserve += (((beforeSize + matchLenMax + afterSize) / 2) >>> 0) + (1 << 19);
    this.size = this.keepSizeBefore + reserve + this.keepSizeAfter;
    this.matchLenMax = matchLenMax;
    this.niceLen = niceLen;
    this.cyclicSize = dictSize + 1;
    this.matchFinder = matchFinder;
    switch (matchFinder) {
      case MF_HC3: this.find = this._hc3Find; this.skip = this._hc3Skip; break;
      case MF_HC4: this.find = this._hc4Find; this.skip = this._hc4Skip; break;
      case MF_BT2: this.find = this._bt2Find; this.skip = this._bt2Skip; break;
      case MF_BT3: this.find = this._bt3Find; this.skip = this._bt3Skip; break;
      case MF_BT4: this.find = this._bt4Find; this.skip = this._bt4Skip; break;
      default: throw new RangeError('lzma: invalid match finder');
    }
    const hashBytes = matchFinder & 0x0f;
    const isBt = (matchFinder & 0x10) !== 0;
    let hs;
    if (hashBytes === 2) {
      hs = 0xffff;
    } else {
      hs = dictSize - 1;
      hs |= hs >>> 1; hs |= hs >>> 2; hs |= hs >>> 4; hs |= hs >>> 8;
      hs >>>= 1;
      hs |= 0xffff;
      if (hs > (1 << 24)) {
        if (hashBytes === 3) hs = (1 << 24) - 1;
        else hs >>>= 1;
      }
    }
    this.hashMask = hs >>> 0;
    ++hs;
    if (hashBytes > 2) hs += HASH_2_SIZE;
    if (hashBytes > 3) hs += HASH_3_SIZE;
    this.hashCount = hs;
    this.sonsCount = isBt ? this.cyclicSize * 2 : this.cyclicSize;
    this.depth = opts.depth;
    if (!this.depth) this.depth = isBt ? 16 + ((niceLen / 2) >>> 0) : 4 + ((niceLen / 4) >>> 0);

    // (lz_encoder_init)
    this.buffer = new Uint8Array(this.size);
    this.offset = this.cyclicSize;
    this.readPos = 0;
    this.readAhead = 0;
    this.readLimit = 0;
    this.writePos = 0;
    this.pending = 0;
    this.hash = new Uint32Array(this.hashCount);
    // (son is indexed only below the cyclic position it has reached — 2 per position for the
    // binary trees — so it grows with the data instead of starting at its full, dictionary-sized
    // length, which liblzma leaves to the OS to commit lazily)
    this._sonPer = isBt ? 2 : 1;
    this.son = new Uint32Array(Math.min(this.sonsCount, this._sonPer * 65536));
    this.cyclicPos = 0;
    this.action = RUN$lz_encoder;
  }

  avail() { return this.writePos - this.readPos; }
  unencoded() { return this.writePos - this.readPos + this.readAhead; }
  position() { return this.readPos - this.readAhead; }

  // fill_window (move_window first when due): produce(buffer, writePos, size) writes input into
  // the window — the input itself, or what the filters before this one make of it — and returns
  // the new writePos and whether that was the end (the action's: FINISH, all input consumed)
  fill(produce, action) {
    if (this.readPos >= this.size - this.keepSizeAfter) this._moveWindow();
    const r = produce(this.buffer, this.writePos, this.size);
    this.writePos = r.pos;
    if (r.end) {
      this.action = action;
      this.readLimit = this.writePos;
    } else if (this.writePos > this.keepSizeAfter) {
      this.readLimit = this.writePos - this.keepSizeAfter;
    }
    if (this.pending > 0 && this.readPos < this.readLimit) {
      const pending = this.pending;
      this.pending = 0;
      this.readPos -= pending;
      this.skip(pending);
    }
  }

  _moveWindow() {
    const moveOffset = ((this.readPos - this.keepSizeBefore) & ~15) >>> 0;
    const moveSize = this.writePos - moveOffset;
    this.buffer.copyWithin(0, moveOffset, moveOffset + moveSize);
    this.offset = (this.offset + moveOffset) >>> 0;
    this.readPos -= moveOffset;
    this.readLimit -= moveOffset;
    this.writePos -= moveOffset;
  }

  // lzma_mf_find: the matches at the current position (into matches[], a { len, dist } array);
  // returns [count, lenBest]
  mfFind(matches) {
    const count = this.find(matches);
    let lenBest = 0;
    if (count > 0) {
      lenBest = matches[count - 1].len;
      if (lenBest === this.niceLen) {
        let limit = this.avail() + 1;
        if (limit > this.matchLenMax) limit = this.matchLenMax;
        const p1 = this.readPos - 1;
        const p2 = p1 - matches[count - 1].dist - 1;
        lenBest = memcmplen$lz_encoder(this.buffer, p1, p2, lenBest, limit);
      }
    }
    ++this.readAhead;
    this._count = count;
    return lenBest;
  }

  mfSkip(amount) {
    if (amount !== 0) {
      this.skip(amount);
      this.readAhead += amount;
    }
  }

  _growSon() {
    const n = Math.min(this.sonsCount, this.son.length * 2);
    const s = new Uint32Array(n);
    s.set(this.son);
    this.son = s;
  }

  _normalize() {
    const subvalue = (MUST_NORMALIZE_POS - this.cyclicSize) >>> 0;
    const h = this.hash, s = this.son;
    for (let i = 0; i < this.hashCount; ++i) h[i] = h[i] <= subvalue ? EMPTY_HASH_VALUE : h[i] - subvalue;
    for (let i = 0; i < s.length; ++i) s[i] = s[i] <= subvalue ? EMPTY_HASH_VALUE : s[i] - subvalue;
    this.offset = (this.offset - subvalue) >>> 0;
  }

  _movePos() {
    if (++this.cyclicPos === this.cyclicSize) this.cyclicPos = 0;
    if ((this.cyclicPos + 1) * this._sonPer > this.son.length) this._growSon();
    ++this.readPos;
    if (((this.readPos + this.offset) >>> 0) === 0xffffffff) this._normalize();
  }

  _movePending() {
    ++this.readPos;
    ++this.pending;
  }

  // header(): the length limit, or -1 when there is too little input (move_pending done)
  _header(isBt, lenMin) {
    let lenLimit = this.avail();
    if (this.niceLen <= lenLimit) {
      lenLimit = this.niceLen;
    } else if (lenLimit < lenMin || (isBt && this.action === SYNC_FLUSH)) {
      this._movePending();
      return -1;
    }
    return lenLimit;
  }

  // ── hash chains ──

  _hcFindFunc(lenLimit, pos, cur, curMatch, depth, matches, mc, lenBest) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    son[cyclicPos] = curMatch;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) return mc;
      const pb = cur - delta;
      curMatch = son[cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)];
      if (buf[pb + lenBest] === buf[cur + lenBest] && buf[pb] === buf[cur]) {
        const len = memcmplen$lz_encoder(buf, pb, cur, 1, lenLimit);
        if (lenBest < len) {
          lenBest = len;
          matches[mc].len = len;
          matches[mc].dist = delta - 1;
          ++mc;
          if (len === lenLimit) return mc;
        }
      }
    }
  }

  _hc3Find(matches) {
    const lenLimit = this._header(false, 3);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen$lz_encoder(buf, cur - delta2, cur, lenBest, lenLimit);
      matches[0].len = lenBest;
      matches[0].dist = delta2 - 1;
      mc = 1;
      if (lenBest === lenLimit) {
        this.son[this.cyclicPos] = curMatch;
        this._movePos();
        return 1;
      }
    }
    mc = this._hcFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _hc3Skip(amount) {
    const buf = this.buffer;
    do {
      if (this.avail() < 3) { this._movePending(); continue; }
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
      this.son[this.cyclicPos] = curMatch;
      this._movePos();
    } while (--amount !== 0);
  }

  _hc4Find(matches) {
    const lenLimit = this._header(false, 4);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
    let delta2 = (pos - this.hash[hash2]) >>> 0;
    const delta3 = (pos - this.hash[FIX_3_HASH_SIZE + hash3]) >>> 0;
    const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hash3] = pos;
    this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
    let lenBest = 1;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = 2;
      matches[0].len = 2;
      matches[0].dist = delta2 - 1;
      mc = 1;
    }
    if (delta2 !== delta3 && delta3 < this.cyclicSize && buf[cur - delta3] === buf[cur]) {
      lenBest = 3;
      matches[mc++].dist = delta3 - 1;
      delta2 = delta3;
    }
    if (mc !== 0) {
      lenBest = memcmplen$lz_encoder(buf, cur - delta2, cur, lenBest, lenLimit);
      matches[mc - 1].len = lenBest;
      if (lenBest === lenLimit) {
        this.son[this.cyclicPos] = curMatch;
        this._movePos();
        return mc;
      }
    }
    if (lenBest < 3) lenBest = 3;
    mc = this._hcFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _hc4Skip(amount) {
    const buf = this.buffer;
    do {
      if (this.avail() < 4) { this._movePending(); continue; }
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hash3] = pos;
      this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
      this.son[this.cyclicPos] = curMatch;
      this._movePos();
    } while (--amount !== 0);
  }

  // ── binary trees ──

  _btFindFunc(lenLimit, pos, cur, curMatch, depth, matches, mc, lenBest) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    let ptr0 = (cyclicPos << 1) + 1;
    let ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) {
        son[ptr0] = EMPTY_HASH_VALUE;
        son[ptr1] = EMPTY_HASH_VALUE;
        return mc;
      }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)) << 1;
      const pb = cur - delta;
      let len = Math.min(len0, len1);
      if (buf[pb + len] === buf[cur + len]) {
        len = memcmplen$lz_encoder(buf, pb, cur, len + 1, lenLimit);
        if (lenBest < len) {
          lenBest = len;
          matches[mc].len = len;
          matches[mc].dist = delta - 1;
          ++mc;
          if (len === lenLimit) {
            son[ptr1] = son[pair];
            son[ptr0] = son[pair + 1];
            return mc;
          }
        }
      }
      if (buf[pb + len] < buf[cur + len]) {
        son[ptr1] = curMatch;
        ptr1 = pair + 1;
        curMatch = son[ptr1];
        len1 = len;
      } else {
        son[ptr0] = curMatch;
        ptr0 = pair;
        curMatch = son[ptr0];
        len0 = len;
      }
    }
  }

  _btSkipFunc(lenLimit, pos, cur, curMatch, depth) {
    const son = this.son, buf = this.buffer, cyclicPos = this.cyclicPos, cyclicSize = this.cyclicSize;
    let ptr0 = (cyclicPos << 1) + 1;
    let ptr1 = cyclicPos << 1;
    let len0 = 0, len1 = 0;
    while (true) {
      const delta = (pos - curMatch) >>> 0;
      if (depth-- === 0 || delta >= cyclicSize) {
        son[ptr0] = EMPTY_HASH_VALUE;
        son[ptr1] = EMPTY_HASH_VALUE;
        return;
      }
      const pair = (cyclicPos - delta + (delta > cyclicPos ? cyclicSize : 0)) << 1;
      const pb = cur - delta;
      let len = Math.min(len0, len1);
      if (buf[pb + len] === buf[cur + len]) {
        len = memcmplen$lz_encoder(buf, pb, cur, len + 1, lenLimit);
        if (len === lenLimit) {
          son[ptr1] = son[pair];
          son[ptr0] = son[pair + 1];
          return;
        }
      }
      if (buf[pb + len] < buf[cur + len]) {
        son[ptr1] = curMatch;
        ptr1 = pair + 1;
        curMatch = son[ptr1];
        len1 = len;
      } else {
        son[ptr0] = curMatch;
        ptr0 = pair;
        curMatch = son[ptr0];
        len0 = len;
      }
    }
  }

  _bt2Find(matches) {
    const lenLimit = this._header(true, 2);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    const hashValue = buf[cur] | (buf[cur + 1] << 8);
    const curMatch = this.hash[hashValue];
    this.hash[hashValue] = pos;
    const mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, 0, 1);
    this._movePos();
    return mc;
  }

  _bt2Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 2);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const hashValue = buf[cur] | (buf[cur + 1] << 8);
      const curMatch = this.hash[hashValue];
      this.hash[hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  _bt3Find(matches) {
    const lenLimit = this._header(true, 3);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen$lz_encoder(buf, cur, cur - delta2, lenBest, lenLimit);
      matches[0].len = lenBest;
      matches[0].dist = delta2 - 1;
      mc = 1;
      if (lenBest === lenLimit) {
        this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
        this._movePos();
        return 1;
      }
    }
    mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _bt3Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 3);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  _bt4Find(matches) {
    const lenLimit = this._header(true, 4);
    if (lenLimit < 0) return 0;
    const buf = this.buffer, cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
    let mc = 0;
    const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
    let delta2 = (pos - this.hash[hash2]) >>> 0;
    const delta3 = (pos - this.hash[FIX_3_HASH_SIZE + hash3]) >>> 0;
    const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hash3] = pos;
    this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
    let lenBest = 1;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = 2;
      matches[0].len = 2;
      matches[0].dist = delta2 - 1;
      mc = 1;
    }
    if (delta2 !== delta3 && delta3 < this.cyclicSize && buf[cur - delta3] === buf[cur]) {
      lenBest = 3;
      matches[mc++].dist = delta3 - 1;
      delta2 = delta3;
    }
    if (mc !== 0) {
      lenBest = memcmplen$lz_encoder(buf, cur, cur - delta2, lenBest, lenLimit);
      matches[mc - 1].len = lenBest;
      if (lenBest === lenLimit) {
        this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
        this._movePos();
        return mc;
      }
    }
    if (lenBest < 3) lenBest = 3;
    mc = this._btFindFunc(lenLimit, pos, cur, curMatch, this.depth, matches, mc, lenBest);
    this._movePos();
    return mc;
  }

  _bt4Skip(amount) {
    const buf = this.buffer;
    do {
      const lenLimit = this._header(true, 4);
      if (lenLimit < 0) continue;
      const cur = this.readPos, pos = (this.readPos + this.offset) >>> 0;
      const temp = CRC32_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (CRC32_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
      const curMatch = this.hash[FIX_4_HASH_SIZE + hashValue];
      this.hash[hash2] = pos;
      this.hash[FIX_3_HASH_SIZE + hash3] = pos;
      this.hash[FIX_4_HASH_SIZE + hashValue] = pos;
      this._btSkipFunc(lenLimit, pos, cur, curMatch, this.depth);
      this._movePos();
    } while (--amount !== 0);
  }

  // mf_read (an uncompressed LZMA2 chunk): `left` bytes ending at readPos
  readBack(left) {
    return this.buffer.subarray(this.readPos - left, this.readPos);
  }
}

// ── src/lzma2-encoder.js ──

// The LZMA2 encoder: lzma2_encoder.c of liblzma 5.8.1, ported — LZMA in chunks of at most 2 MiB
// uncompressed / 64 KiB compressed, each stored uncompressed instead when that is smaller; plus
// the LZMA2 / LZMA1 property bytes.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const LZMA2_UNCOMPRESSED_MAX = 1 << 21;
const LZMA2_HEADER_MAX = 6, LZMA2_HEADER_UNCOMPRESSED = 3;
const SEQ_INIT = 0, SEQ_LZMA_ENCODE = 1, SEQ_LZMA_COPY = 2, SEQ_UNCOMPRESSED_HEADER = 3, SEQ_UNCOMPRESSED_COPY = 4;

// lzma_lzma2_props_encode: the dictionary size as one byte
function lzma2Props(dictSize) {
  let d = Math.max(dictSize, 4096) - 1;
  d |= d >>> 2; d |= d >>> 3; d |= d >>> 4; d |= d >>> 8; d |= d >>> 16;
  d >>>= 0;
  return d === 0xffffffff ? 40 : getDistSlot(d + 1) - 24;
}

// lzma_lzma_props_encode (LZMA1 / .lzma): lc/lp/pb byte, then the dictionary size LE
function lzma1Props(o) {
  const out = new Uint8Array(5);
  out[0] = lclppbByte(o);
  out[1] = o.dictSize; out[2] = o.dictSize >>> 8; out[3] = o.dictSize >>> 16; out[4] = o.dictSize >>> 24;
  return out;
}

// LZMA2 over a window: write(data, finishing) consumes input; pull(out) emits the stream
class Lzma2Encoder {
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
            if (mf.action !== RUN$lz_encoder) { out.buf[out.pos++] = 0; return 'end'; }
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

// ── src/filters.js ──

// The filters before (or, decoding, after) LZMA: delta (delta_*.c) and the branch / call /
// jump converters (simple_coder.c and simple/*.c — x86, PowerPC, IA-64, ARM, ARM-Thumb, ARM64,
// SPARC, RISC-V) of liblzma 5.8.1, ported. A coder fills out[outPos..outSize) from its `next` —
// the input, or another coder — and reports whether that was the end; liblzma's chain the same
// way round, encoding and decoding alike.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

const RUN$filters = 0, FINISH$filters = 3;

// the raw input of an encoder chain: set .data / .pos, then pull
class InputSource {
  constructor() { this.data = new Uint8Array(0); this.pos = 0; }
  code(out, outPos, outSize, action) {
    const n = Math.min(this.data.length - this.pos, outSize - outPos);
    if (n > 0) out.set(this.data.subarray(this.pos, this.pos + n), outPos);
    this.pos += n;
    return { pos: outPos + n, end: action !== RUN$filters && this.pos === this.data.length };
  }
}

// ── delta ──
class DeltaCoder {
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
class SimpleCoder {
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
const FILTER_DELTA = 0x03, FILTER_X86 = 0x04, FILTER_POWERPC = 0x05, FILTER_IA64 = 0x06,
  FILTER_ARM = 0x07, FILTER_ARMTHUMB = 0x08, FILTER_SPARC = 0x09, FILTER_ARM64 = 0x0a, FILTER_RISCV = 0x0b,
  FILTER_LZMA1 = 0x4000000000000001n, FILTER_LZMA2 = 0x21;

// id → [kernel (or [enc, dec]), unfilteredMax, alignment]
const BCJ = {
  [FILTER_X86]: [x86, 5, 1], [FILTER_POWERPC]: [powerpc, 4, 4], [FILTER_IA64]: [ia64, 16, 16],
  [FILTER_ARM]: [arm, 4, 4], [FILTER_ARMTHUMB]: [armthumb, 4, 2], [FILTER_ARM64]: [arm64, 4, 4],
  [FILTER_SPARC]: [sparc, 4, 4], [FILTER_RISCV]: [[riscvEncode, riscvDecode], 8, 2],
};
const isBcj = (id) => Object.hasOwn(BCJ, id);

// a coder for filter {id, options} over next
function makeFilterCoder(f, next, isEncoder) {
  if (f.id === FILTER_DELTA) return new DeltaCoder(next, f.dist ?? 1, isEncoder);
  const spec = BCJ[f.id];
  if (!spec) throw new RangeError(`lzma: unsupported filter ${f.id}`);
  const [k, unfilteredMax, alignment] = spec;
  const kernel = Array.isArray(k) ? (isEncoder ? k[0] : k[1]) : k;
  const state = f.id === FILTER_X86 ? { prevMask: 0, prevPos: (-5) >>> 0 } : null;
  return new SimpleCoder(next, kernel, unfilteredMax, alignment, isEncoder, f.start_offset ?? 0, state);
}

// ── src/encoder.js ──

// Encoders over a filter chain, in the three formats CPython's lzma writes: .xz (stream_encoder.c,
// block_encoder.c, block_header_encoder.c, index_encoder.c, stream_flags_encoder.c), .lzma
// (alone_encoder.c) and raw (filter_encoder.c) — liblzma 5.8.1's, ported, so the bytes are its.
// The output only grows: every coder below resumes where it stopped when it filled it.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const FINISH$encoder = 3;
const PRESET_DEFAULT = 6, PRESET_EXTREME = 0x80000000;

class LzmaError extends Error {
  constructor(message) { super(message); this.name = 'LzmaError'; }
}
const OPTIONS_ERROR = 'Invalid or unsupported options';

// lzma_lzma_preset: the LZMA options of a preset 0..9 (| PRESET_EXTREME)
function presetOptions(preset) {
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
function filterProps(f) {
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
function validateChain(filters) {
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
class Out$encoder {
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
    this.action = RUN$lz_encoder;
  }
  // feed data (consumed as it goes); 'end' once FINISH has been encoded to the end
  code(data, out, action) {
    this.input.data = data;
    this.input.pos = 0;
    const mf = this.mf;
    const produce = (buf, writePos, size) => this.source.code(buf, writePos, size, action);
    while (true) {
      while (out.pos < out.size && (this.input.pos < this.input.data.length || action !== RUN$lz_encoder)) {
        if (mf.action === RUN$lz_encoder && mf.readPos >= mf.readLimit) mf.fill(produce, action);
        const ret = this.lz.code(out);
        if (ret !== 'ok') { mf.action = RUN$lz_encoder; return ret; }
      }
      if (out.pos < out.size) return 'ok';   // the input is used up
      out.grow();
    }
  }
}

// the LZMA options of an LZMA1 / LZMA2 filter spec (a preset, with the spec's fields over it)
function lzmaOptions(f) {
  const o = presetOptions(f.preset ?? PRESET_DEFAULT);
  for (const k of ['dictSize', 'lc', 'lp', 'pb', 'mode', 'niceLen', 'mf', 'depth']) if (f[k] !== undefined && f[k] !== null) o[k] = f[k];
  if (!(o.dictSize >= 4096 && o.dictSize <= (1 << 30) + (1 << 29))) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.lc <= 4 && o.lp <= 4 && o.lc + o.lp <= 4 && o.pb <= 4)) throw new LzmaError(OPTIONS_ERROR);
  if (!(o.niceLen >= 2 && o.niceLen <= 273) || !['fast', 'normal'].includes(o.mode)) throw new LzmaError(OPTIONS_ERROR);
  if (![0x03, 0x04, 0x12, 0x13, 0x14].includes(o.mf)) throw new LzmaError(OPTIONS_ERROR);
  return o;
}

// ── raw: the filter chain's output, nothing around it ──
class RawStreamEncoder {
  constructor(filters) { this.raw = new RawEncoder(filters); this.out = new Out$encoder(); }
  compress(data) { this.raw.code(data, this.out, RUN$lz_encoder); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH$encoder); return this.out.take(); }
}

// ── .lzma (LZMA_Alone): 13-byte header (props, dictionary size rounded up, size unknown) ──
class AloneEncoder {
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
    this.out = new Out$encoder();
    this.out.push(header);
  }
  compress(data) { this.raw.code(data, this.out, RUN$lz_encoder); return this.out.take(); }
  flush() { this.raw.code(new Uint8Array(0), this.out, FINISH$encoder); return this.out.take(); }
}

// ── .xz ──
const HEADER_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const FOOTER_MAGIC = [0x59, 0x5a];

function streamFlags(check) { return [0x00, check]; }
function le32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

function streamHeader(check) {
  const flags = streamFlags(check);
  return Uint8Array.from([...HEADER_MAGIC, ...flags, ...le32(crc32(Uint8Array.from(flags)))]);
}

// lzma_block_header_size + lzma_block_header_encode (sizes unknown, as the stream encoder writes)
function blockHeader(filters) {
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

function indexAndFooter(records, check) {
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

class XzEncoder {
  // filters: the chain (last LZMA2); check: 0 none, 1 CRC32, 4 CRC64, 10 SHA-256
  constructor(filters, check) {
    if (!(check >= 0 && check <= CHECK_ID_MAX)) throw new LzmaError('Invalid or unsupported options');
    if (!isCheckSupported(check)) throw new LzmaError('Unsupported integrity check');
    validateChain(filters);
    if (filters[filters.length - 1].id !== FILTER_LZMA2) throw new LzmaError(OPTIONS_ERROR);
    this.filters = filters.map((f) => (f.id === FILTER_LZMA2 ? { ...f, ...lzmaOptions(f) } : f));
    this.check = check;
    this.out = new Out$encoder();
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
      this._code(data, RUN$lz_encoder);
    }
    return this.out.take();
  }
  flush() {
    if (this.block) {
      this._code(new Uint8Array(0), FINISH$encoder);
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

// ── src/lzma-decoder.js ──

// The LZMA and LZMA2 decoders (lzma_decoder.c, lzma2_decoder.c, lz_decoder.c of liblzma 5.8.1,
// in effect): the format as liblzma reads it, with its checks — the range coder's first byte
// zero, an end that leaves it finished, distances inside the dictionary, LZMA2's chunk sizes
// exact.
//
// The input may stop anywhere, even inside a symbol; liblzma saves its place bit by bit. Here a
// symbol is decoded straight through when enough input is at hand (a symbol needs at most 21
// bytes), and with an undo log when not: if the input runs out inside it, the symbol is undone
// and tried again with more. Input taken into a symbol counts as consumed either way, as liblzma's
// range decoder has taken it — so needs_input and unused_data come out as CPython's.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

const RC_TOP_VALUE$lzma_decoder = 1 << 24, RC_BIT_MODEL_TOTAL_BITS$lzma_decoder = 11, RC_BIT_MODEL_TOTAL$lzma_decoder = 1 << 11, RC_MOVE_BITS$lzma_decoder = 5;
const STATES$lzma_decoder = 12, LIT_STATES$lzma_decoder = 7, POS_STATES_MAX$lzma_decoder = 16;
const LITERAL_CODER_SIZE$lzma_decoder = 0x300, LITERAL_CODERS_MAX$lzma_decoder = 16;
const MATCH_LEN_MIN$lzma_decoder = 2;
const LEN_LOW_SYMBOLS$lzma_decoder = 8, LEN_MID_SYMBOLS$lzma_decoder = 8, LEN_HIGH_SYMBOLS$lzma_decoder = 256;
const DIST_STATES$lzma_decoder = 4, DIST_SLOTS$lzma_decoder = 64, DIST_MODEL_START$lzma_decoder = 4, DIST_MODEL_END$lzma_decoder = 14, FULL_DISTANCES$lzma_decoder = 128;
const ALIGN_BITS$lzma_decoder = 4, ALIGN_SIZE$lzma_decoder = 16;
const LC_CHOICE$lzma_decoder = 0, LC_CHOICE2$lzma_decoder = 1, LC_LOW$lzma_decoder = 2, LC_MID$lzma_decoder = LC_LOW$lzma_decoder + POS_STATES_MAX$lzma_decoder * LEN_LOW_SYMBOLS$lzma_decoder, LC_HIGH$lzma_decoder = LC_MID$lzma_decoder + POS_STATES_MAX$lzma_decoder * LEN_MID_SYMBOLS$lzma_decoder;
const LC_SIZE = LC_HIGH$lzma_decoder + LEN_HIGH_SYMBOLS$lzma_decoder;
const IN_REQUIRED = 21;
const UINT32_MAX$lzma_decoder = 0xffffffff;

class LzmaDataError extends Error {
  constructor(msg = 'Corrupt input data') { super(msg); this.name = 'LzmaDataError'; }
}
const NEED = { need: true };   // thrown when a symbol runs out of input (undone, retried later)

const updateLiteral$lzma_decoder = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);

// the input: buf[pos .. end); `final` — no more will come
class InputBuffer {
  constructor() { this.buf = new Uint8Array(0); this.pos = 0; this.end = 0; }
  avail() { return this.end - this.pos; }
}

// the dictionary: a window of the last `size` bytes out, growing to that size as output comes
class Dict {
  constructor(size) {
    this.size = size;
    this.buf = new Uint8Array(Math.min(size, 1 << 16));
    this.pos = 0;     // next write (wraps once buf has reached size)
    this.full = 0;    // bytes valid since the last reset (≤ size)
    this.total = 0;   // bytes since the last reset, mod 2^32 (the position LZMA's contexts see)
  }
  reset() { this.pos = 0; this.full = 0; this.total = 0; }
  put(b) {
    if (this.pos === this.buf.length) {
      if (this.buf.length < this.size) {
        const nb = new Uint8Array(Math.min(this.size, this.buf.length * 2));
        nb.set(this.buf);
        this.buf = nb;
      } else this.pos = 0;
    }
    this.buf[this.pos++] = b;
    if (this.full < this.size) ++this.full;
    this.total = (this.total + 1) >>> 0;
  }
  // the byte `dist` + 1 back
  get(dist) {
    let i = this.pos - dist - 1;
    if (i < 0) i += this.buf.length;
    return this.buf[i];
  }
}

// one LZMA coder's state: probabilities, state, reps, range decoder; output into a Dict and out
class LzmaCore {
  constructor(dictSize) {
    this.dict = new Dict(dictSize);
    this.literal = new Uint16Array(LITERAL_CODERS_MAX$lzma_decoder * LITERAL_CODER_SIZE$lzma_decoder);
    this.isMatch = new Uint16Array(STATES$lzma_decoder * POS_STATES_MAX$lzma_decoder);
    this.isRep = new Uint16Array(STATES$lzma_decoder);
    this.isRep0 = new Uint16Array(STATES$lzma_decoder);
    this.isRep1 = new Uint16Array(STATES$lzma_decoder);
    this.isRep2 = new Uint16Array(STATES$lzma_decoder);
    this.isRep0Long = new Uint16Array(STATES$lzma_decoder * POS_STATES_MAX$lzma_decoder);
    this.distSlot = new Uint16Array(DIST_STATES$lzma_decoder * DIST_SLOTS$lzma_decoder);
    this.distSpecial = new Uint16Array(FULL_DISTANCES$lzma_decoder - DIST_MODEL_END$lzma_decoder);
    this.distAlign = new Uint16Array(ALIGN_SIZE$lzma_decoder);
    this.matchLen = new Uint16Array(LC_SIZE);
    this.repLen = new Uint16Array(LC_SIZE);
    this.reps = [0, 0, 0, 0];
    this.state = 0;
    this.range = 0; this.code = 0; this.initLeft = 5;
    this.pendingLen = 0;   // a match cut short by the output's end: what remains of it
    this.log = null;       // the undo log, while a symbol may run out of input
  }

  // lzma_decoder_reset
  resetState(lc, lp, pb) {
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.posMask = (1 << pb) - 1;
    this.literalMask = ((0x100 << lp) - (0x100 >>> lc)) >>> 0;
    const half = RC_BIT_MODEL_TOTAL$lzma_decoder >>> 1;
    for (const a of [this.literal, this.isMatch, this.isRep, this.isRep0, this.isRep1, this.isRep2, this.isRep0Long,
      this.distSlot, this.distSpecial, this.distAlign, this.matchLen, this.repLen]) a.fill(half);
    this.reps = [0, 0, 0, 0];
    this.state = 0;
    this.pendingLen = 0;
    this.rcReset();
  }
  rcReset() { this.range = UINT32_MAX$lzma_decoder; this.code = 0; this.initLeft = 5; }

  // rc_read_init: the first 5 bytes (the first one zero); false while input is short
  rcInit(inp) {
    while (this.initLeft > 0) {
      if (inp.pos === inp.end) return false;
      if (this.initLeft === 5 && inp.buf[inp.pos] !== 0x00) throw new LzmaDataError();
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
      --this.initLeft;
    }
    return true;
  }

  _normalize(inp) {
    if (this.range < RC_TOP_VALUE$lzma_decoder) {
      if (inp.pos === inp.end) throw NEED;
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
    }
  }
  _bit(inp, arr, idx) {
    this._normalize(inp);
    const prob = arr[idx];
    const bound = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS$lzma_decoder, prob) >>> 0;
    if (this.log) this.log.push(arr, idx, prob);
    if (this.code < bound) {
      this.range = bound;
      arr[idx] = prob + ((RC_BIT_MODEL_TOTAL$lzma_decoder - prob) >>> RC_MOVE_BITS$lzma_decoder);
      return 0;
    }
    this.range = (this.range - bound) >>> 0;
    this.code = (this.code - bound) >>> 0;
    arr[idx] = prob - (prob >>> RC_MOVE_BITS$lzma_decoder);
    return 1;
  }
  _bittree(inp, arr, base, bits) {
    let symbol = 1;
    for (let i = 0; i < bits; i++) symbol = (symbol << 1) | this._bit(inp, arr, base + symbol);
    return symbol - (1 << bits);
  }
  _bittreeReverse(inp, arr, base, bits) {
    let symbol = 1, result = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this._bit(inp, arr, base + symbol);
      symbol = (symbol << 1) | bit;
      result |= bit << i;
    }
    return result;
  }
  _direct(inp, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      this._normalize(inp);
      this.range >>>= 1;
      const t = this.code >= this.range ? 1 : 0;
      if (t) this.code = (this.code - this.range) >>> 0;
      result = ((result << 1) | t) >>> 0;
    }
    return result;
  }
  _len(inp, lc, posState) {
    if (this._bit(inp, lc, LC_CHOICE$lzma_decoder) === 0) return MATCH_LEN_MIN$lzma_decoder + this._bittree(inp, lc, LC_LOW$lzma_decoder + posState * LEN_LOW_SYMBOLS$lzma_decoder, 3);
    if (this._bit(inp, lc, LC_CHOICE2$lzma_decoder) === 0) return MATCH_LEN_MIN$lzma_decoder + LEN_LOW_SYMBOLS$lzma_decoder + this._bittree(inp, lc, LC_MID$lzma_decoder + posState * LEN_MID_SYMBOLS$lzma_decoder, 3);
    return MATCH_LEN_MIN$lzma_decoder + LEN_LOW_SYMBOLS$lzma_decoder + LEN_MID_SYMBOLS$lzma_decoder + this._bittree(inp, lc, LC_HIGH$lzma_decoder, 8);
  }

  // copy what a match still has to give into the dictionary and out
  _copy(out) {
    const d = this.dict, dist = this.reps[0];
    let n = Math.min(this.pendingLen, out.end - out.pos);
    this.pendingLen -= n;
    while (n-- > 0) {
      const b = d.get(dist);
      d.put(b);
      out.buf[out.pos++] = b;
    }
  }

  // decode symbols into out until: out is full ('out'), `limit` bytes have come out ('limit' —
  // LZMA2's chunk size, LZMA1's known size; Infinity for none), the end marker ('eopm'), or the
  // input runs out ('input'). allowEopm: an end marker may come (it is an error else)
  decode(inp, out, limit, allowEopm) {
    if (this.afterEopm) return this._eopmFinish(inp);
    if (this.pendingLen) {
      const before = out.pos;
      this._copy(out);
      limit -= out.pos - before;
      if (this.pendingLen) return { why: 'out', produced: out.pos - before };
    }
    const start = out.pos;
    const d = this.dict;
    let produced = 0;
    while (true) {
      if (produced >= limit) return { why: 'limit', produced };
      if (out.pos === out.end) return { why: 'out', produced };
      // a symbol: straight through with input to spare, else with an undo log
      const careful = inp.end - inp.pos < IN_REQUIRED;
      const snap = careful ? this._snapshot(inp, out) : null;
      try {
        const r = this._symbol(inp, out, allowEopm);
        if (careful) this.log = null;
        if (r === 'eopm') { this.afterEopm = true; return this._eopmFinish(inp); }
      } catch (e) {
        if (e !== NEED) throw e;
        this._undo(snap, inp, out);
        return { why: 'input', produced: out.pos - start };
      }
      produced = out.pos - start;
      if (produced > limit) throw new LzmaDataError();
    }
  }

  // after the end marker: one more normalization, and the range decoder finished (SEQ_EOPM)
  _eopmFinish(inp) {
    const f = this.finishCheck(inp);
    if (f === 'input') return { why: 'input', produced: 0 };
    if (f === false) throw new LzmaDataError();
    this.afterEopm = false;
    return { why: 'eopm', produced: 0 };
  }

  _snapshot(inp, out) {
    this.log = [];
    const d = this.dict;
    return { range: this.range, code: this.code, state: this.state, reps: this.reps.slice(), pendingLen: this.pendingLen,
      inPos: inp.pos, outPos: out.pos, dpos: d.pos, dfull: d.full, dtotal: d.total, dlen: d.buf.length };
  }
  _undo(s, inp, out) {
    const log = this.log;
    for (let i = log.length - 3; i >= 0; i -= 3) log[i][log[i + 1]] = log[i + 2];
    this.log = null;
    this.range = s.range; this.code = s.code; this.state = s.state; this.reps = s.reps; this.pendingLen = s.pendingLen;
    // (the input taken stays taken: it is kept, and the symbol re-read from it — see decode's
    // caller, which carries the bytes from snapshot.inPos over)
    inp.pos = s.inPos;
    out.pos = s.outPos;
    const d = this.dict;
    d.pos = s.dpos; d.full = s.dfull; d.total = s.dtotal;
  }

  _symbol(inp, out, allowEopm) {
    const d = this.dict;
    const posState = d.total & this.posMask;
    const state = this.state;
    if (this._bit(inp, this.isMatch, state * POS_STATES_MAX$lzma_decoder + posState) === 0) {
      // a literal
      const prev = d.full ? d.get(0) : 0;
      const sub = 3 * ((((((d.total << 8) + prev) >>> 0) & this.literalMask) << this.lc) >>> 0);
      let symbol;
      if (state < LIT_STATES$lzma_decoder) {
        symbol = 1;
        do symbol = (symbol << 1) | this._bit(inp, this.literal, sub + symbol); while (symbol < 0x100);
      } else {
        let matchByte = d.get(this.reps[0]);
        let offset = 0x100;
        symbol = 1;
        do {
          matchByte <<= 1;
          const matchBit = matchByte & offset;
          const bit = this._bit(inp, this.literal, sub + offset + matchBit + symbol);
          symbol = (symbol << 1) | bit;
          offset &= bit ? matchBit : ~matchBit;
        } while (symbol < 0x100);
      }
      this.state = updateLiteral$lzma_decoder(state);
      this._putByte(symbol & 0xff, out);
      return 'lit';
    }
    let len;
    if (this._bit(inp, this.isRep, state) === 0) {
      // a match: length, then distance
      len = this._len(inp, this.matchLen, posState);
      const distState = len < DIST_STATES$lzma_decoder + MATCH_LEN_MIN$lzma_decoder ? len - MATCH_LEN_MIN$lzma_decoder : DIST_STATES$lzma_decoder - 1;
      const slot = this._bittree(inp, this.distSlot, distState * DIST_SLOTS$lzma_decoder, 6);
      let dist;
      if (slot < DIST_MODEL_START$lzma_decoder) {
        dist = slot;
      } else {
        const limit = (slot >>> 1) - 1;
        dist = ((2 | (slot & 1)) << limit) >>> 0;
        if (slot < DIST_MODEL_END$lzma_decoder) {
          dist = (dist + this._bittreeReverse(inp, this.distSpecial, dist - slot - 1, limit)) >>> 0;
        } else {
          dist = (dist + ((this._direct(inp, limit - ALIGN_BITS$lzma_decoder) << ALIGN_BITS$lzma_decoder) >>> 0)) >>> 0;
          dist = (dist + this._bittreeReverse(inp, this.distAlign, 0, ALIGN_BITS$lzma_decoder)) >>> 0;
          if (dist === UINT32_MAX$lzma_decoder) {
            if (!allowEopm) throw new LzmaDataError();
            return 'eopm';
          }
        }
      }
      if (dist >= d.full) throw new LzmaDataError();
      this.reps = [dist, this.reps[0], this.reps[1], this.reps[2]];
      this.state = state < LIT_STATES$lzma_decoder ? 7 : 10;
    } else {
      if (d.full === 0) throw new LzmaDataError();
      if (this._bit(inp, this.isRep0, state) === 0) {
        if (this._bit(inp, this.isRep0Long, state * POS_STATES_MAX$lzma_decoder + posState) === 0) {
          // a short rep: one byte from rep0
          this.state = state < LIT_STATES$lzma_decoder ? 9 : 11;
          this._putByte(d.get(this.reps[0]), out);
          return 'shortrep';
        }
      } else {
        let dist;
        if (this._bit(inp, this.isRep1, state) === 0) {
          dist = this.reps[1];
          this.reps = [dist, this.reps[0], this.reps[2], this.reps[3]];
        } else if (this._bit(inp, this.isRep2, state) === 0) {
          dist = this.reps[2];
          this.reps = [dist, this.reps[0], this.reps[1], this.reps[3]];
        } else {
          dist = this.reps[3];
          this.reps = [dist, this.reps[0], this.reps[1], this.reps[2]];
        }
      }
      len = this._len(inp, this.repLen, posState);
      this.state = state < LIT_STATES$lzma_decoder ? 8 : 11;
    }
    this.pendingLen = len;
    this._copy(out);
    return 'match';
  }

  // (a symbol writes only once all its bits are read: one cut short has written nothing)
  _putByte(b, out) {
    const d = this.dict;
    d.put(b);
    out.buf[out.pos++] = b;
  }

  // at a known end (LZMA2's chunk, LZMA1's size): is the range decoder finished — after the one
  // normalization that may still be due? true / false, or 'input' when that byte isn't here yet
  finishCheck(inp) {
    if (this.range < RC_TOP_VALUE$lzma_decoder) {
      if (inp.pos === inp.end) return 'input';
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
    }
    return this.code === 0;
  }

  // the end marker, where one must come (LZMA1 with its size reached, the coder unfinished):
  // 'eopm', or 'input' (undone, to retry); any other symbol is an error
  expectEopm(inp) {
    if (this.afterEopm) return this._eopmFinish(inp).why;
    const snap = this._snapshot(inp, { pos: 0 });
    try {
      const r = this._symbol(inp, { buf: new Uint8Array(LEN_HIGH_SYMBOLS$lzma_decoder + 32), pos: 0, end: 1 }, true);
      this.log = null;
      if (r !== 'eopm') throw new LzmaDataError();
      this.afterEopm = true;
      return this._eopmFinish(inp).why;
    } catch (e) {
      if (e !== NEED) { this.log = null; throw e; }
      this._undo(snap, inp, { pos: 0 });
      return 'input';
    }
  }
}

// lclppb byte → [lc, lp, pb] (lzma_lzma_lclppb_decode)
function lclppbDecode(byte) {
  if (byte > (4 * 5 + 4) * 9 + 8) return null;
  const pb = Math.floor(byte / (9 * 5));
  byte -= pb * 9 * 5;
  const lp = Math.floor(byte / 9);
  const lc = byte - lp * 9;
  if (lc + lp > 4) return null;
  return [lc, lp, pb];
}

function lzma2DictSize(prop) {
  if (prop & 0xc0 || prop > 40) return null;
  if (prop === 40) return UINT32_MAX$lzma_decoder;
  return ((2 | (prop & 1)) * 2 ** (prop / 2 + 11 | 0)) >>> 0;
}

// ── src/decoder.js ──

// Decoders: LZMA2 chunks and LZMA1 over LzmaCore, the filter chain over them, and the formats
// CPython's lzma reads — .xz (stream_decoder.c, block_decoder.c, block_header_decoder.c,
// index_hash.c, stream_flags_decoder.c), .lzma (alone_decoder.c), raw, and auto (the first byte
// tells .xz from .lzma) — each with CPython's LZMADecompressor face: decompress(data, maxLength),
// eof, needsInput, unusedData, check.
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.


const CHECK_UNKNOWN = 16;
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
class Out$decoder {
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
class Decompressor$decoder {
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
    const out = new Out$decoder(maxLength);
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
    const r = chain.code(out.buf, out.pos, Math.min(out.buf.length, out.max), RUN$filters);
    const made = r.pos - out.pos;
    out.pos = r.pos;
    this._lastMade = made;
    if (r.end) return 'end';
    if (out.room() === 0) return 'out';
    return 'input';
  }
}

// ── raw ──
class RawDecoder extends Decompressor$decoder {
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
class AloneDecoder extends Decompressor$decoder {
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

class XzDecoder extends Decompressor$decoder {
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
function decodeFilterProps(id, props) {
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
class AutoDecoder extends Decompressor$decoder {
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

// ── src/main.js ──

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


// an LZMA1 / LZMA2 filter's options in full: its preset (default 6), then the fields it gives
const resolveLzmaOptions = (f) => ({ ...lzmaOptions(f), id: f.id });

class Compressor {
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

function Decompressor$main({ format = 'auto', memlimit = null, filters = null } = {}) {
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

function compress(data, opts = {}) {
  const c = new Compressor(opts);
  return concat([c.compress(data), c.flush()]);
}

// as CPython's lzma.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
function decompress(data, opts = {}) {
  const parts = [];
  while (true) {
    const d = Decompressor$main(opts);
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

export {
  LzmaError,
  PRESET_DEFAULT,
  PRESET_EXTREME,
  CHECK_NONE,
  CHECK_CRC32,
  CHECK_CRC64,
  CHECK_SHA256,
  CHECK_ID_MAX,
  CHECK_UNKNOWN,
  isCheckSupported,
  FILTER_LZMA1,
  FILTER_LZMA2,
  FILTER_DELTA,
  FILTER_X86,
  FILTER_POWERPC,
  FILTER_IA64,
  FILTER_ARM,
  FILTER_ARMTHUMB,
  FILTER_SPARC,
  FILTER_ARM64,
  FILTER_RISCV,
  MF_HC3,
  MF_HC4,
  MF_BT2,
  MF_BT3,
  MF_BT4,
  filterProps,
  decodeFilterProps,
  validateChain,
  presetOptions,
  resolveLzmaOptions,
  Compressor,
  Decompressor$main as Decompressor,
  compress,
  decompress,
};
