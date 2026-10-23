// The LZ encoder's window and match finders: lz_encoder.c + lz_encoder_mf.c of liblzma 5.8.1,
// ported line for line (hash chains hc3 / hc4, binary trees bt2 / bt3 / bt4). Positions are
// uint32 arithmetic as in the C (`>>> 0` where a subtraction may wrap).
//
// From xz / liblzma 5.8.1 (0BSD) — see LICENSE.

import { CRC32_TABLE as HASH_TABLE } from './check.js';

export const MF_HC3 = 0x03, MF_HC4 = 0x04, MF_BT2 = 0x12, MF_BT3 = 0x13, MF_BT4 = 0x14;
const HASH_2_SIZE = 1 << 10, HASH_3_SIZE = 1 << 16;
const HASH_2_MASK = HASH_2_SIZE - 1, HASH_3_MASK = HASH_3_SIZE - 1;
const FIX_3_HASH_SIZE = HASH_2_SIZE, FIX_4_HASH_SIZE = HASH_2_SIZE + HASH_3_SIZE;
const EMPTY_HASH_VALUE = 0;
const MUST_NORMALIZE_POS = 0xffffffff;

export const RUN = 0, SYNC_FLUSH = 1, FINISH = 3;

const memcmplen = (buf, a, b, len, limit) => {
  while (len < limit && buf[a + len] === buf[b + len]) ++len;
  return len;
};

export class MatchFinder {
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
    this.action = RUN;
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
        lenBest = memcmplen(this.buffer, p1, p2, lenBest, limit);
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
        const len = memcmplen(buf, pb, cur, 1, lenLimit);
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
    const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen(buf, cur - delta2, cur, lenBest, lenLimit);
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
      const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
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
    const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (HASH_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
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
      lenBest = memcmplen(buf, cur - delta2, cur, lenBest, lenLimit);
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
      const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (HASH_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
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
        len = memcmplen(buf, pb, cur, len + 1, lenLimit);
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
        len = memcmplen(buf, pb, cur, len + 1, lenLimit);
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
    const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8)) & this.hashMask) >>> 0;
    const delta2 = (pos - this.hash[hash2]) >>> 0;
    const curMatch = this.hash[FIX_3_HASH_SIZE + hashValue];
    this.hash[hash2] = pos;
    this.hash[FIX_3_HASH_SIZE + hashValue] = pos;
    let lenBest = 2;
    if (delta2 < this.cyclicSize && buf[cur - delta2] === buf[cur]) {
      lenBest = memcmplen(buf, cur, cur - delta2, lenBest, lenLimit);
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
      const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
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
    const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
    const hash2 = temp & HASH_2_MASK;
    const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
    const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (HASH_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
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
      lenBest = memcmplen(buf, cur, cur - delta2, lenBest, lenLimit);
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
      const temp = HASH_TABLE[buf[cur]] ^ buf[cur + 1];
      const hash2 = temp & HASH_2_MASK;
      const hash3 = (temp ^ (buf[cur + 2] << 8)) & HASH_3_MASK;
      const hashValue = ((temp ^ (buf[cur + 2] << 8) ^ (HASH_TABLE[buf[cur + 3]] << 5)) & this.hashMask) >>> 0;
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
