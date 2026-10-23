// The bzip2 decompressor: decompress.c (one block's Huffman / MTF / run decoding, then the
// inverse BWT) and bzlib.c's output side (the run-length decoding, CRCs), bzip2 1.0.8 ported.
// Input is consumed as libbzip2 consumes it — a byte at a time, only when bits are needed — so
// what's left over (unusedData) and when more input is wanted (needsInput) are libbzip2's, and
// so CPython's. The block parser is a generator: it pauses wherever the input runs out, the
// C's save-and-return-by-state machinery in another form.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

import { BZ2_CRC32_TABLE as CRC, BZ2_RNUMS } from './tables.js';
import { createDecodeTables, MAX_ALPHA_SIZE, MAX_CODE_LEN } from './huffman.js';

const RUNA = 0, RUNB = 1;
const N_GROUPS = 6, G_SIZE = 50;
const MAX_SELECTORS = 2 + ((900000 / G_SIZE) | 0);

// libbzip2's BZ_DATA_ERROR / BZ_DATA_ERROR_MAGIC
export class BzDataError extends Error {
  constructor(magic = false) {
    super(magic ? 'bz2: not a bzip2 stream' : 'bz2: invalid data stream');
    this.name = 'BzDataError';
    this.magic = magic;
  }
}

const NEED_INPUT = 1, BLOCK_READY = 2, STREAM_END = 3;

export class Decompressor {
  constructor() {
    this.eof = false;
    this.needsInput = true;
    this.unusedData = new Uint8Array(0);
    this._in = new Uint8Array(0);   // input not yet consumed
    this._pos = 0;
    this._parser = this._parse();
    this._state = 'parse';          // 'parse' | 'output'
    this._calculatedCombinedCRC = 0;
    this._storedCombinedCRC = 0;
    this._broken = null;
  }

  // CPython's BZ2Decompressor.decompress: everything the input decodes to, or at most maxLength
  // bytes of it (maxLength < 0: no limit); input it hasn't reached yet is kept for later
  decompress(data, maxLength = -1) {
    if (this.eof) throw new Error('bz2: end of stream already reached');
    if (this._broken) throw this._broken;
    // the unconsumed input, then the new
    if (this._pos < this._in.length) {
      const rest = this._in.subarray(this._pos);
      const b = new Uint8Array(rest.length + data.length);
      b.set(rest); b.set(data, rest.length);
      this._in = b;
    } else {
      this._in = data instanceof Uint8Array ? data : Uint8Array.from(data);
    }
    this._pos = 0;

    const out = new _Out(maxLength);
    try {
      // BZ2_bzDecompress, called until the stream ends, the input is used up, or the output is full
      while (true) {
        if (this._state === 'output') {
          if (this._unRLE(out)) throw new BzDataError();
          if (this._nblockUsed === this._nblock + 1 && this._stateOutLen === 0) {
            this._blockCRC = (~this._blockCRC) >>> 0;
            if (this._blockCRC !== this._storedBlockCRC) throw new BzDataError();
            this._calculatedCombinedCRC = (((this._calculatedCombinedCRC << 1) | (this._calculatedCombinedCRC >>> 31)) ^ this._blockCRC) >>> 0;
            this._state = 'parse';
          } else if (!out.full()) {
            continue;   // (out grew: more room)
          } else {
            break;      // the output is at maxLength
          }
        }
        const r = this._parser.next().value;
        if (r === STREAM_END) {
          if (this._calculatedCombinedCRC !== this._storedCombinedCRC) throw new BzDataError();
          this.eof = true;
          break;
        }
        if (r === NEED_INPUT) break;
        this._state = 'output';   // BLOCK_READY
      }
    } catch (e) {
      this._broken = e;
      throw e;
    }

    const avail = this._in.length - this._pos;
    if (this.eof) {
      this.needsInput = false;
      if (avail > 0) this.unusedData = this._in.slice(this._pos);
    } else {
      this.needsInput = avail === 0;
    }
    return out.result();
  }

  // ── the block parser (BZ2_decompress) ──
  // yields NEED_INPUT when it runs out of bytes (resumed with more in this._in from _pos), and
  // BLOCK_READY when a block is decoded into tt; returns STREAM_END after the trailer
  *_parse() {
    let bsBuff = 0, bsLive = 0;
    let input = this._in, inPos = this._pos;
    // GET_BITS, inline where it's hot; this is the general form
    const self = this;
    let v;

    // (each `while (bsLive < n)` below is GET_BITS: pull bytes, pausing for more input)
    // stream header
    for (const want of [0x42, 0x5a, 0x68]) {
      while (bsLive < 8) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      v = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
      if (v !== want) { self._pos = inPos; throw new BzDataError(true); }
    }
    while (bsLive < 8) {
      if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
      bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
    }
    let blockSize100k = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
    if (blockSize100k < 0x31 || blockSize100k > 0x39) { self._pos = inPos; throw new BzDataError(true); }
    blockSize100k -= 0x30;
    this._blockSize100k = blockSize100k;
    const tt = new Uint32Array(blockSize100k * 100000);
    this._tt = tt;

    const inUse16 = new Uint8Array(16), inUse = new Uint8Array(256), seqToUnseq = new Uint8Array(256);
    const selectorMtf = new Uint8Array(MAX_SELECTORS), selector = new Uint8Array(MAX_SELECTORS);
    const len = Array.from({ length: N_GROUPS }, () => new Uint8Array(MAX_ALPHA_SIZE));
    const limit = Array.from({ length: N_GROUPS }, () => new Int32Array(MAX_CODE_LEN));
    const base = Array.from({ length: N_GROUPS }, () => new Int32Array(MAX_CODE_LEN));
    const perm = Array.from({ length: N_GROUPS }, () => new Int32Array(MAX_ALPHA_SIZE));
    const minLens = new Int32Array(N_GROUPS);
    const unzftab = new Int32Array(256), cftab = new Int32Array(257);
    const mtf = new Uint8Array(256);

    while (true) {
      // a block header (0x314159265359) or the stream trailer (0x177245385090)
      const magic = [];
      for (let b = 0; b < 6; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        v = (bsBuff >>> (bsLive - 8)) & 0xff; bsLive -= 8;
        magic.push(v);
        const want = (b === 0 ? (v === 0x17 ? TRAILER : BLOCK) : magic[0] === 0x17 ? TRAILER : BLOCK)[b];
        if (v !== want) { self._pos = inPos; throw new BzDataError(); }
      }
      // the CRC that follows either
      let crc = 0;
      for (let b = 0; b < 4; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        crc = ((crc << 8) | ((bsBuff >>> (bsLive - 8)) & 0xff)) >>> 0; bsLive -= 8;
      }
      if (magic[0] === 0x17) {
        this._storedCombinedCRC = crc;
        self._pos = inPos;
        return STREAM_END;
      }
      this._storedBlockCRC = crc;

      // randomised?, origPtr
      while (bsLive < 1) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      const blockRandomised = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
      let origPtr = 0;
      for (let b = 0; b < 3; b++) {
        while (bsLive < 8) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        origPtr = (origPtr << 8) | ((bsBuff >>> (bsLive - 8)) & 0xff); bsLive -= 8;
      }
      if (origPtr > 10 + 100000 * blockSize100k) { self._pos = inPos; throw new BzDataError(); }

      // the mapping table
      for (let i = 0; i < 16; i++) {
        while (bsLive < 1) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        inUse16[i] = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
      }
      inUse.fill(0);
      for (let i = 0; i < 16; i++) {
        if (!inUse16[i]) continue;
        for (let j = 0; j < 16; j++) {
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          if ((bsBuff >>> (bsLive - 1)) & 1) inUse[i * 16 + j] = 1;
          bsLive -= 1;
        }
      }
      let nInUse = 0;
      for (let i = 0; i < 256; i++) if (inUse[i]) seqToUnseq[nInUse++] = i;
      if (nInUse === 0) { self._pos = inPos; throw new BzDataError(); }
      const alphaSize = nInUse + 2;

      // the selectors
      while (bsLive < 3) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      const nGroups = (bsBuff >>> (bsLive - 3)) & 7; bsLive -= 3;
      if (nGroups < 2 || nGroups > N_GROUPS) { self._pos = inPos; throw new BzDataError(); }
      while (bsLive < 15) {
        if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
        bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
      }
      let nSelectors = (bsBuff >>> (bsLive - 15)) & 0x7fff; bsLive -= 15;
      if (nSelectors < 1) { self._pos = inPos; throw new BzDataError(); }
      for (let i = 0; i < nSelectors; i++) {
        let j = 0;
        while (true) {
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          const bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
          if (bit === 0) break;
          j++;
          if (j >= nGroups) { self._pos = inPos; throw new BzDataError(); }
        }
        // (more than MAX_SELECTORS can't be used, but some writers round up: ignore them)
        if (i < MAX_SELECTORS) selectorMtf[i] = j;
      }
      if (nSelectors > MAX_SELECTORS) nSelectors = MAX_SELECTORS;
      {
        const pos = new Uint8Array(N_GROUPS);
        for (let q = 0; q < nGroups; q++) pos[q] = q;
        for (let i = 0; i < nSelectors; i++) {
          let q = selectorMtf[i];
          const tmp = pos[q];
          while (q > 0) { pos[q] = pos[q - 1]; q--; }
          pos[0] = tmp;
          selector[i] = tmp;
        }
      }

      // the coding tables
      for (let t = 0; t < nGroups; t++) {
        while (bsLive < 5) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        let curr = (bsBuff >>> (bsLive - 5)) & 0x1f; bsLive -= 5;
        for (let i = 0; i < alphaSize; i++) {
          while (true) {
            if (curr < 1 || curr > 20) { self._pos = inPos; throw new BzDataError(); }
            while (bsLive < 1) {
              if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
              bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
            }
            let bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
            if (bit === 0) break;
            while (bsLive < 1) {
              if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
              bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
            }
            bit = (bsBuff >>> (bsLive - 1)) & 1; bsLive -= 1;
            if (bit === 0) curr++; else curr--;
          }
          len[t][i] = curr;
        }
      }
      for (let t = 0; t < nGroups; t++) {
        let minLen = 32, maxLen = 0;
        for (let i = 0; i < alphaSize; i++) {
          if (len[t][i] > maxLen) maxLen = len[t][i];
          if (len[t][i] < minLen) minLen = len[t][i];
        }
        createDecodeTables(limit[t], base[t], perm[t], len[t], minLen, maxLen, alphaSize);
        minLens[t] = minLen;
      }

      // the MTF values
      const EOB = nInUse + 1;
      const nblockMAX = 100000 * blockSize100k;
      let groupNo = -1, groupPos = 0;
      let gSel = 0, gMinlen = 0, gLimit = null, gBase = null, gPerm = null;
      unzftab.fill(0);
      for (let i = 0; i < 256; i++) mtf[i] = i;
      let nblock = 0;
      let nextSym;

      // GET_MTF_VAL, written out at its three uses
      while (true) {
        if (groupPos === 0) {
          groupNo++;
          if (groupNo >= nSelectors) { self._pos = inPos; throw new BzDataError(); }
          groupPos = G_SIZE;
          gSel = selector[groupNo];
          gMinlen = minLens[gSel]; gLimit = limit[gSel]; gPerm = perm[gSel]; gBase = base[gSel];
        }
        groupPos--;
        let zn = gMinlen;
        while (bsLive < zn) {
          if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
          bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
        }
        let zvec = (bsBuff >>> (bsLive - zn)) & ((1 << zn) - 1); bsLive -= zn;
        while (true) {
          if (zn > 20) { self._pos = inPos; throw new BzDataError(); }
          if (zvec <= gLimit[zn]) break;
          zn++;
          while (bsLive < 1) {
            if (inPos >= input.length) { self._pos = inPos; yield NEED_INPUT; input = self._in; inPos = self._pos; continue; }
            bsBuff = (bsBuff << 8) | input[inPos++]; bsLive += 8;
          }
          zvec = (zvec << 1) | ((bsBuff >>> (bsLive - 1)) & 1); bsLive -= 1;
        }
        if (zvec - gBase[zn] < 0 || zvec - gBase[zn] >= MAX_ALPHA_SIZE) { self._pos = inPos; throw new BzDataError(); }
        nextSym = gPerm[zvec - gBase[zn]];

        if (nextSym === EOB) break;
        if (nextSym === RUNA || nextSym === RUNB) {
          // a run of the front symbol: RUNA / RUNB digits, bijective base 2
          if (this._runN === undefined) { this._runEs = -1; this._runN = 1; }
          if (this._runN >= 2 * 1024 * 1024) { self._pos = inPos; throw new BzDataError(); }
          this._runEs += (nextSym === RUNA ? 1 : 2) * this._runN;
          this._runN *= 2;
          continue;
        }
        if (this._runN !== undefined) {
          nblock = this._flushRun(nblock, nblockMAX, seqToUnseq[mtf[0]], unzftab, tt, inPos);
        }
        if (nblock >= nblockMAX) { self._pos = inPos; throw new BzDataError(); }
        // uc = MTF(nextSym - 1)
        const nn = nextSym - 1;
        const uc = mtf[nn];
        mtf.copyWithin(1, 0, nn);
        mtf[0] = uc;
        const b = seqToUnseq[uc];
        unzftab[b]++;
        tt[nblock++] = b;
      }
      if (this._runN !== undefined) {
        nblock = this._flushRun(nblock, nblockMAX, seqToUnseq[mtf[0]], unzftab, tt, inPos);
      }

      // now nblock is known: a better check of origPtr
      if (origPtr < 0 || origPtr >= nblock) { self._pos = inPos; throw new BzDataError(); }
      for (let i = 0; i <= 255; i++) {
        if (unzftab[i] < 0 || unzftab[i] > nblock) { self._pos = inPos; throw new BzDataError(); }
      }
      cftab[0] = 0;
      for (let i = 1; i <= 256; i++) cftab[i] = unzftab[i - 1];
      for (let i = 1; i <= 256; i++) cftab[i] += cftab[i - 1];
      for (let i = 0; i <= 256; i++) {
        if (cftab[i] < 0 || cftab[i] > nblock) { self._pos = inPos; throw new BzDataError(); }
      }
      for (let i = 1; i <= 256; i++) {
        if (cftab[i - 1] > cftab[i]) { self._pos = inPos; throw new BzDataError(); }
      }

      // T^(-1), in the high 24 bits of tt beside each byte
      for (let i = 0; i < nblock; i++) {
        const uc = tt[i] & 0xff;
        tt[cftab[uc]] |= (i << 8);
        cftab[uc]++;
      }
      this._stateOutLen = 0;
      this._stateOutCh = 0;
      this._blockCRC = 0xffffffff;
      this._nblock = nblock;
      this._tPos = tt[origPtr] >>> 8;
      this._nblockUsed = 0;
      this._randomised = blockRandomised;
      if (blockRandomised) {
        this._rNToGo = 0; this._rTPos = 0;
        if (this._getFast()) { self._pos = inPos; throw new BzDataError(); }
        this._k0 = this._got; this._nblockUsed++;
        this._randUpd(); this._k0 ^= this._randMask();
      } else {
        if (this._getFast()) { self._pos = inPos; throw new BzDataError(); }
        this._k0 = this._got; this._nblockUsed++;
      }
      self._pos = inPos;
      yield BLOCK_READY;
      input = self._in; inPos = self._pos;
    }
  }

  // es copies of the run's byte into the block
  _flushRun(nblock, nblockMAX, uc, unzftab, tt, inPos) {
    let es = this._runEs + 1;
    this._runN = undefined;
    unzftab[uc] += es;
    while (es > 0) {
      if (nblock >= nblockMAX) { this._pos = inPos; throw new BzDataError(); }
      tt[nblock++] = uc;
      es--;
    }
    return nblock;
  }

  // BZ_GET_FAST: the next byte of the block into _got (true: corrupt)
  _getFast() {
    if (this._tPos >= 100000 * this._blockSize100k) return true;
    this._tPos = this._tt[this._tPos];
    this._got = this._tPos & 0xff;
    this._tPos >>>= 8;
    return false;
  }
  _randUpd() {
    if (this._rNToGo === 0) {
      this._rNToGo = BZ2_RNUMS[this._rTPos];
      this._rTPos++;
      if (this._rTPos === 512) this._rTPos = 0;
    }
    this._rNToGo--;
  }
  _randMask() { return this._rNToGo === 1 ? 1 : 0; }

  // unRLE_obuf_to_output_FAST: the block's bytes, its 4-byte runs expanded, into out (true:
  // corrupt). The structure — where it stops when out is full — is the C's.
  _unRLE(out) {
    const save1 = this._nblock + 1;
    if (this._randomised) {
      while (true) {
        // finish the current run
        while (true) {
          if (out.full()) return false;
          if (this._stateOutLen === 0) break;
          out.push(this._stateOutCh);
          this._blockCRC = ((this._blockCRC << 8) ^ CRC[(this._blockCRC >>> 24) ^ this._stateOutCh]) >>> 0;
          this._stateOutLen--;
        }
        if (this._nblockUsed === save1) return false;
        if (this._nblockUsed > save1) return true;
        this._stateOutLen = 1;
        this._stateOutCh = this._k0;
        let k1;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        this._stateOutLen = 2;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        this._stateOutLen = 3;
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        if (this._nblockUsed === save1) continue;
        if (k1 !== this._k0) { this._k0 = k1; continue; }
        if (this._getFast()) return true; k1 = this._got; this._randUpd();
        k1 ^= this._randMask(); this._nblockUsed++;
        this._stateOutLen = k1 + 4;
        if (this._getFast()) return true; this._k0 = this._got; this._randUpd();
        this._k0 ^= this._randMask(); this._nblockUsed++;
      }
    }

    // the common case, with the state in locals (as the C keeps it in registers)
    let crc = this._blockCRC, ch = this._stateOutCh, runLen = this._stateOutLen;
    let used = this._nblockUsed, k0 = this._k0, tPos = this._tPos, k1;
    const tt = this._tt, tLimit = 100000 * this._blockSize100k;
    let corrupt = false;
    const buf = out.buf;
    let n = out.n;
    const cap = out.cap;
    outer: while (true) {
      let eqOne = false;
      if (runLen > 0) {
        // the run's bytes but its last
        while (true) {
          if (n === cap) break outer;
          if (runLen === 1) break;
          buf[n++] = ch;
          crc = ((crc << 8) ^ CRC[(crc >>> 24) ^ ch]) >>> 0;
          runLen--;
        }
        eqOne = true;
      }
      while (true) {
        if (eqOne) {
          // s_state_out_len_eq_one: the run's last byte
          if (n === cap) { runLen = 1; break outer; }
          buf[n++] = ch;
          crc = ((crc << 8) ^ CRC[(crc >>> 24) ^ ch]) >>> 0;
          eqOne = false;
        }
        if (used > save1) { corrupt = true; break outer; }
        if (used === save1) { runLen = 0; break outer; }
        ch = k0;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (k1 !== k0) { k0 = k1; eqOne = true; continue; }
        if (used === save1) { eqOne = true; continue; }
        runLen = 2;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (used === save1) continue outer;
        if (k1 !== k0) { k0 = k1; continue outer; }
        runLen = 3;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        if (used === save1) continue outer;
        if (k1 !== k0) { k0 = k1; continue outer; }
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k1 = tPos & 0xff; tPos >>>= 8; used++;
        runLen = k1 + 4;
        if (tPos >= tLimit) { corrupt = true; break outer; }
        tPos = tt[tPos]; k0 = tPos & 0xff; tPos >>>= 8; used++;
        continue outer;
      }
    }
    out.n = n;
    this._blockCRC = crc; this._stateOutCh = ch; this._stateOutLen = runLen;
    this._nblockUsed = used; this._k0 = k0; this._tPos = tPos;
    return corrupt;
  }
}

const BLOCK = [0x31, 0x41, 0x59, 0x26, 0x53, 0x59];
const TRAILER = [0x17, 0x72, 0x45, 0x38, 0x50, 0x90];

// the output: grows until max bytes (max < 0: without limit)
class _Out {
  constructor(max) {
    this.max = max < 0 ? Infinity : max;
    this.buf = new Uint8Array(Math.min(this.max, 1024));
    this.n = 0;
    this.cap = this.buf.length;
  }
  full() {
    if (this.n < this.cap) return false;
    if (this.cap >= this.max) return true;
    this._grow();
    return false;
  }
  push(b) { this.buf[this.n++] = b; }
  _grow() {
    const c = Math.min(this.max, Math.max(this.cap * 2, 1024));
    const b = new Uint8Array(c);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
    this.cap = c;
  }
  result() { return this.buf.slice(0, this.n); }
}
