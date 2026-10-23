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

const RC_TOP_VALUE = 1 << 24, RC_BIT_MODEL_TOTAL_BITS = 11, RC_BIT_MODEL_TOTAL = 1 << 11, RC_MOVE_BITS = 5;
const STATES = 12, LIT_STATES = 7, POS_STATES_MAX = 16;
const LITERAL_CODER_SIZE = 0x300, LITERAL_CODERS_MAX = 16;
const MATCH_LEN_MIN = 2;
const LEN_LOW_SYMBOLS = 8, LEN_MID_SYMBOLS = 8, LEN_HIGH_SYMBOLS = 256;
const DIST_STATES = 4, DIST_SLOTS = 64, DIST_MODEL_START = 4, DIST_MODEL_END = 14, FULL_DISTANCES = 128;
const ALIGN_BITS = 4, ALIGN_SIZE = 16;
const LC_CHOICE = 0, LC_CHOICE2 = 1, LC_LOW = 2, LC_MID = LC_LOW + POS_STATES_MAX * LEN_LOW_SYMBOLS, LC_HIGH = LC_MID + POS_STATES_MAX * LEN_MID_SYMBOLS;
const LC_SIZE = LC_HIGH + LEN_HIGH_SYMBOLS;
const IN_REQUIRED = 21;
const UINT32_MAX = 0xffffffff;

export class LzmaDataError extends Error {
  constructor(msg = 'Corrupt input data') { super(msg); this.name = 'LzmaDataError'; }
}
const NEED = { need: true };   // thrown when a symbol runs out of input (undone, retried later)

const updateLiteral = (s) => (s <= 3 ? 0 : s <= 9 ? s - 3 : s - 6);

// the input: buf[pos .. end); `final` — no more will come
export class InputBuffer {
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
export class LzmaCore {
  constructor(dictSize) {
    this.dict = new Dict(dictSize);
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
    const half = RC_BIT_MODEL_TOTAL >>> 1;
    for (const a of [this.literal, this.isMatch, this.isRep, this.isRep0, this.isRep1, this.isRep2, this.isRep0Long,
      this.distSlot, this.distSpecial, this.distAlign, this.matchLen, this.repLen]) a.fill(half);
    this.reps = [0, 0, 0, 0];
    this.state = 0;
    this.pendingLen = 0;
    this.rcReset();
  }
  rcReset() { this.range = UINT32_MAX; this.code = 0; this.initLeft = 5; }

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
    if (this.range < RC_TOP_VALUE) {
      if (inp.pos === inp.end) throw NEED;
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | inp.buf[inp.pos++]) >>> 0;
    }
  }
  _bit(inp, arr, idx) {
    this._normalize(inp);
    const prob = arr[idx];
    const bound = Math.imul(this.range >>> RC_BIT_MODEL_TOTAL_BITS, prob) >>> 0;
    if (this.log) this.log.push(arr, idx, prob);
    if (this.code < bound) {
      this.range = bound;
      arr[idx] = prob + ((RC_BIT_MODEL_TOTAL - prob) >>> RC_MOVE_BITS);
      return 0;
    }
    this.range = (this.range - bound) >>> 0;
    this.code = (this.code - bound) >>> 0;
    arr[idx] = prob - (prob >>> RC_MOVE_BITS);
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
    if (this._bit(inp, lc, LC_CHOICE) === 0) return MATCH_LEN_MIN + this._bittree(inp, lc, LC_LOW + posState * LEN_LOW_SYMBOLS, 3);
    if (this._bit(inp, lc, LC_CHOICE2) === 0) return MATCH_LEN_MIN + LEN_LOW_SYMBOLS + this._bittree(inp, lc, LC_MID + posState * LEN_MID_SYMBOLS, 3);
    return MATCH_LEN_MIN + LEN_LOW_SYMBOLS + LEN_MID_SYMBOLS + this._bittree(inp, lc, LC_HIGH, 8);
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
    if (this._bit(inp, this.isMatch, state * POS_STATES_MAX + posState) === 0) {
      // a literal
      const prev = d.full ? d.get(0) : 0;
      const sub = 3 * ((((((d.total << 8) + prev) >>> 0) & this.literalMask) << this.lc) >>> 0);
      let symbol;
      if (state < LIT_STATES) {
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
      this.state = updateLiteral(state);
      this._putByte(symbol & 0xff, out);
      return 'lit';
    }
    let len;
    if (this._bit(inp, this.isRep, state) === 0) {
      // a match: length, then distance
      len = this._len(inp, this.matchLen, posState);
      const distState = len < DIST_STATES + MATCH_LEN_MIN ? len - MATCH_LEN_MIN : DIST_STATES - 1;
      const slot = this._bittree(inp, this.distSlot, distState * DIST_SLOTS, 6);
      let dist;
      if (slot < DIST_MODEL_START) {
        dist = slot;
      } else {
        const limit = (slot >>> 1) - 1;
        dist = ((2 | (slot & 1)) << limit) >>> 0;
        if (slot < DIST_MODEL_END) {
          dist = (dist + this._bittreeReverse(inp, this.distSpecial, dist - slot - 1, limit)) >>> 0;
        } else {
          dist = (dist + ((this._direct(inp, limit - ALIGN_BITS) << ALIGN_BITS) >>> 0)) >>> 0;
          dist = (dist + this._bittreeReverse(inp, this.distAlign, 0, ALIGN_BITS)) >>> 0;
          if (dist === UINT32_MAX) {
            if (!allowEopm) throw new LzmaDataError();
            return 'eopm';
          }
        }
      }
      if (dist >= d.full) throw new LzmaDataError();
      this.reps = [dist, this.reps[0], this.reps[1], this.reps[2]];
      this.state = state < LIT_STATES ? 7 : 10;
    } else {
      if (d.full === 0) throw new LzmaDataError();
      if (this._bit(inp, this.isRep0, state) === 0) {
        if (this._bit(inp, this.isRep0Long, state * POS_STATES_MAX + posState) === 0) {
          // a short rep: one byte from rep0
          this.state = state < LIT_STATES ? 9 : 11;
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
      this.state = state < LIT_STATES ? 8 : 11;
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
    if (this.range < RC_TOP_VALUE) {
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
      const r = this._symbol(inp, { buf: new Uint8Array(LEN_HIGH_SYMBOLS + 32), pos: 0, end: 1 }, true);
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
export function lclppbDecode(byte) {
  if (byte > (4 * 5 + 4) * 9 + 8) return null;
  const pb = Math.floor(byte / (9 * 5));
  byte -= pb * 9 * 5;
  const lp = Math.floor(byte / 9);
  const lc = byte - lp * 9;
  if (lc + lp > 4) return null;
  return [lc, lp, pb];
}

export function lzma2DictSize(prop) {
  if (prop & 0xc0 || prop > 40) return null;
  if (prop === 40) return UINT32_MAX;
  return ((2 | (prop & 1)) * 2 ** (prop / 2 + 11 | 0)) >>> 0;
}
