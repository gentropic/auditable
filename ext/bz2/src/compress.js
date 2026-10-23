// The bzip2 compressor: bzlib.c's input side (the initial run-length coding into blocks) and
// compress.c (MTF + run coding, Huffman table selection, the bit stream), bzip2 1.0.8 ported
// line for line — so the bytes are libbzip2's, down to where a compress() call's output ends
// (its bit writer empties only before a write, so up to three whole bytes wait for the next).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

import { BZ2_CRC32_TABLE as CRC } from './tables.js';
import { blockSort, N_OVERSHOOT } from './blocksort.js';
import { makeCodeLengths, assignCodes, MAX_ALPHA_SIZE } from './huffman.js';

const RUNA = 0, RUNB = 1;
const N_GROUPS = 6, G_SIZE = 50, N_ITERS = 4;
const MAX_SELECTORS = 2 + ((900000 / G_SIZE) | 0);
const LESSER_ICOST = 0, GREATER_ICOST = 15;

export class Compressor {
  // blockSize100k 1..9 (the compresslevel); workFactor 0..250 (0 = the default, 30)
  constructor(blockSize100k = 9, workFactor = 0) {
    if (!(Number.isInteger(blockSize100k) && blockSize100k >= 1 && blockSize100k <= 9)) {
      throw new RangeError('bz2: compresslevel must be between 1 and 9');
    }
    if (!(Number.isInteger(workFactor) && workFactor >= 0 && workFactor <= 250)) {
      throw new RangeError('bz2: workFactor must be between 0 and 250');
    }
    const n = 100000 * blockSize100k;
    this.blockSize100k = blockSize100k;
    this.workFactor = workFactor === 0 ? 30 : workFactor;
    this.nblockMAX = n - 19;
    this.block = new Uint8Array(n + N_OVERSHOOT);
    this.quadrant = new Uint16Array(n + N_OVERSHOOT);
    this.ptr = new Int32Array(n);
    this.eclass = new Int32Array(n);
    this.ftab = new Int32Array(65537);
    this.mtfv = new Uint16Array(n + 1);
    this.inUse = new Uint8Array(256);
    this.unseqToSeq = new Uint8Array(256);
    this.mtfFreq = new Int32Array(MAX_ALPHA_SIZE);
    this.len = Array.from({ length: N_GROUPS }, () => new Uint8Array(MAX_ALPHA_SIZE));
    this.code = Array.from({ length: N_GROUPS }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.rfreq = Array.from({ length: N_GROUPS }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.selector = new Uint8Array(MAX_SELECTORS);
    this.selectorMtf = new Uint8Array(MAX_SELECTORS);
    // the output: whole bytes, and the bits not yet a byte
    this.out = new Uint8Array(1024);
    this.numZ = 0;
    this.bsBuff = 0;
    this.bsLive = 0;
    this.blockNo = 0;
    this.combinedCRC = 0;
    this.finished = false;
    // the run being coded (init_RL): no char yet
    this.stateInCh = 256;
    this.stateInLen = 0;
    this._prepareNewBlock();
  }

  // feed bytes (BZ_RUN); returns the stream bytes completed so far
  compress(data) {
    if (this.finished) throw new Error('bz2: compressor already finished');
    for (let i = 0; i < data.length; i++) {
      this._addChar(data[i]);
      if (this.nblock >= this.nblockMAX) {
        this._compressBlock(false);
        this._prepareNewBlock();
      }
    }
    return this._take();
  }

  // the end of the stream (BZ_FINISH): the last block, the trailer, the last bits
  flush() {
    if (this.finished) throw new Error('bz2: compressor already finished');
    this.finished = true;
    this._flushRL();
    this._compressBlock(true);
    return this._take();
  }

  _take() {
    const r = this.out.slice(0, this.numZ);
    this.numZ = 0;
    return r;
  }

  _prepareNewBlock() {
    this.nblock = 0;
    this.blockCRC = 0xffffffff;
    this.inUse.fill(0);
    this.blockNo++;
  }

  // ADD_CHAR_TO_BLOCK
  _addChar(ch) {
    if (ch !== this.stateInCh && this.stateInLen === 1) {
      const c = this.stateInCh;
      this.blockCRC = ((this.blockCRC << 8) ^ CRC[(this.blockCRC >>> 24) ^ c]) >>> 0;
      this.inUse[c] = 1;
      this.block[this.nblock++] = c;
      this.stateInCh = ch;
    } else if (ch !== this.stateInCh || this.stateInLen === 255) {
      if (this.stateInCh < 256) this._addPairToBlock();
      this.stateInCh = ch;
      this.stateInLen = 1;
    } else {
      this.stateInLen++;
    }
  }

  _addPairToBlock() {
    const ch = this.stateInCh, n = this.stateInLen, block = this.block;
    let crc = this.blockCRC;
    for (let i = 0; i < n; i++) crc = ((crc << 8) ^ CRC[(crc >>> 24) ^ ch]) >>> 0;
    this.blockCRC = crc;
    this.inUse[ch] = 1;
    if (n <= 3) {
      for (let i = 0; i < n; i++) block[this.nblock++] = ch;
    } else {
      this.inUse[n - 4] = 1;
      for (let i = 0; i < 4; i++) block[this.nblock++] = ch;
      block[this.nblock++] = n - 4;
    }
  }

  _flushRL() {
    if (this.stateInCh < 256) this._addPairToBlock();
    this.stateInCh = 256;
    this.stateInLen = 0;
  }

  // ── the bit stream (bsW: empty whole bytes first, then add n bits of v) ──

  _bsW(n, v) {
    while (this.bsLive >= 8) {
      if (this.numZ === this.out.length) {
        const o = new Uint8Array(this.out.length * 2);
        o.set(this.out);
        this.out = o;
      }
      this.out[this.numZ++] = this.bsBuff >>> 24;
      this.bsBuff = (this.bsBuff << 8) >>> 0;
      this.bsLive -= 8;
    }
    this.bsBuff = (this.bsBuff | (v << (32 - this.bsLive - n))) >>> 0;
    this.bsLive += n;
  }

  _bsPutUInt32(u) {
    this._bsW(8, (u >>> 24) & 0xff);
    this._bsW(8, (u >>> 16) & 0xff);
    this._bsW(8, (u >>> 8) & 0xff);
    this._bsW(8, u & 0xff);
  }

  _bsFinishWrite() {
    while (this.bsLive > 0) {
      if (this.numZ === this.out.length) {
        const o = new Uint8Array(this.out.length * 2);
        o.set(this.out);
        this.out = o;
      }
      this.out[this.numZ++] = this.bsBuff >>> 24;
      this.bsBuff = (this.bsBuff << 8) >>> 0;
      this.bsLive -= 8;
    }
  }

  // BZ2_compressBlock
  _compressBlock(isLastBlock) {
    if (this.nblock > 0) {
      this.blockCRC = (~this.blockCRC) >>> 0;
      this.combinedCRC = (((this.combinedCRC << 1) | (this.combinedCRC >>> 31)) ^ this.blockCRC) >>> 0;
      this.origPtr = blockSort(this);
    }
    if (this.blockNo === 1) {
      this._bsW(8, 0x42); this._bsW(8, 0x5a); this._bsW(8, 0x68);   // 'BZh'
      this._bsW(8, 0x30 + this.blockSize100k);
    }
    if (this.nblock > 0) {
      this._bsW(8, 0x31); this._bsW(8, 0x41); this._bsW(8, 0x59);
      this._bsW(8, 0x26); this._bsW(8, 0x53); this._bsW(8, 0x59);
      this._bsPutUInt32(this.blockCRC);
      this._bsW(1, 0);   // not randomised
      this._bsW(24, this.origPtr);
      this._generateMTFValues();
      this._sendMTFValues();
    }
    if (isLastBlock) {
      this._bsW(8, 0x17); this._bsW(8, 0x72); this._bsW(8, 0x45);
      this._bsW(8, 0x38); this._bsW(8, 0x50); this._bsW(8, 0x90);
      this._bsPutUInt32(this.combinedCRC);
      this._bsFinishWrite();
    }
  }

  _generateMTFValues() {
    const yy = new Uint8Array(256);
    const { ptr, block, mtfv, mtfFreq, unseqToSeq } = this;
    const nblock = this.nblock;
    let i, j, zPend, wr;

    // makeMaps_e
    let nInUse = 0;
    for (i = 0; i < 256; i++) if (this.inUse[i]) unseqToSeq[i] = nInUse++;
    this.nInUse = nInUse;
    const EOB = nInUse + 1;
    for (i = 0; i <= EOB; i++) mtfFreq[i] = 0;

    wr = 0;
    zPend = 0;
    for (i = 0; i < nInUse; i++) yy[i] = i;

    const putRun = () => {
      zPend--;
      while (true) {
        if (zPend & 1) { mtfv[wr++] = RUNB; mtfFreq[RUNB]++; } else { mtfv[wr++] = RUNA; mtfFreq[RUNA]++; }
        if (zPend < 2) break;
        zPend = ((zPend - 2) / 2) | 0;
      }
      zPend = 0;
    };

    for (i = 0; i < nblock; i++) {
      j = ptr[i] - 1; if (j < 0) j += nblock;
      const llI = unseqToSeq[block[j]];
      if (yy[0] === llI) {
        zPend++;
      } else {
        if (zPend > 0) putRun();
        // move llI to the front; j its old position
        let rtmp = yy[1];
        yy[1] = yy[0];
        let p = 1;
        while (llI !== rtmp) {
          p++;
          const rtmp2 = rtmp;
          rtmp = yy[p];
          yy[p] = rtmp2;
        }
        yy[0] = rtmp;
        mtfv[wr++] = p + 1;
        mtfFreq[p + 1]++;
      }
    }
    if (zPend > 0) putRun();
    mtfv[wr++] = EOB;
    mtfFreq[EOB]++;
    this.nMTF = wr;
  }

  _sendMTFValues() {
    const { mtfv, len, code, rfreq, selector, selectorMtf } = this;
    const nMTF = this.nMTF;
    const alphaSize = this.nInUse + 2;
    const cost = new Uint16Array(N_GROUPS);
    const fave = new Int32Array(N_GROUPS);
    let v, t, i, j, gs, ge, bt, bc, iter, nSelectors, nGroups, minLen, maxLen, selCtr;

    for (t = 0; t < N_GROUPS; t++) for (v = 0; v < alphaSize; v++) len[t][v] = GREATER_ICOST;

    // how many coding tables
    if (!(nMTF > 0)) throw new Error('bz2: internal error 3001');
    if (nMTF < 200) nGroups = 2;
    else if (nMTF < 600) nGroups = 3;
    else if (nMTF < 1200) nGroups = 4;
    else if (nMTF < 2400) nGroups = 5;
    else nGroups = 6;

    // an initial set of coding tables
    {
      let nPart = nGroups, remF = nMTF, tFreq, aFreq;
      gs = 0;
      while (nPart > 0) {
        tFreq = (remF / nPart) | 0;
        ge = gs - 1;
        aFreq = 0;
        while (aFreq < tFreq && ge < alphaSize - 1) {
          ge++;
          aFreq += this.mtfFreq[ge];
        }
        if (ge > gs && nPart !== nGroups && nPart !== 1 && ((nGroups - nPart) % 2 === 1)) {
          aFreq -= this.mtfFreq[ge];
          ge--;
        }
        for (v = 0; v < alphaSize; v++) len[nPart - 1][v] = (v >= gs && v <= ge) ? LESSER_ICOST : GREATER_ICOST;
        nPart--;
        gs = ge + 1;
        remF -= aFreq;
      }
    }

    // up to N_ITERS passes improving the tables
    for (iter = 0; iter < N_ITERS; iter++) {
      for (t = 0; t < nGroups; t++) fave[t] = 0;
      for (t = 0; t < nGroups; t++) for (v = 0; v < alphaSize; v++) rfreq[t][v] = 0;
      nSelectors = 0;
      gs = 0;
      while (true) {
        if (gs >= nMTF) break;
        ge = gs + G_SIZE - 1;
        if (ge >= nMTF) ge = nMTF - 1;
        // this group's cost under each table (the C's 6-table fast path computes the same)
        for (t = 0; t < nGroups; t++) cost[t] = 0;
        for (i = gs; i <= ge; i++) {
          const icv = mtfv[i];
          for (t = 0; t < nGroups; t++) cost[t] += len[t][icv];
        }
        // the cheapest table: this group's selector
        bc = 999999999; bt = -1;
        for (t = 0; t < nGroups; t++) if (cost[t] < bc) { bc = cost[t]; bt = t; }
        fave[bt]++;
        selector[nSelectors++] = bt;
        for (i = gs; i <= ge; i++) rfreq[bt][mtfv[i]]++;
        gs = ge + 1;
      }
      // recompute the tables from what each was chosen for (maxLen 17, since bzip2 1.0.3)
      for (t = 0; t < nGroups; t++) makeCodeLengths(len[t], rfreq[t], alphaSize, 17);
    }
    if (!(nSelectors < 32768 && nSelectors <= MAX_SELECTORS)) throw new Error('bz2: internal error 3003');

    // MTF values for the selectors
    {
      const pos = new Uint8Array(N_GROUPS);
      for (i = 0; i < nGroups; i++) pos[i] = i;
      for (i = 0; i < nSelectors; i++) {
        const llI = selector[i];
        j = 0;
        let tmp = pos[j];
        while (llI !== tmp) {
          j++;
          const tmp2 = tmp;
          tmp = pos[j];
          pos[j] = tmp2;
        }
        pos[0] = tmp;
        selectorMtf[i] = j;
      }
    }

    // the actual codes
    for (t = 0; t < nGroups; t++) {
      minLen = 32;
      maxLen = 0;
      for (i = 0; i < alphaSize; i++) {
        if (len[t][i] > maxLen) maxLen = len[t][i];
        if (len[t][i] < minLen) minLen = len[t][i];
      }
      if (maxLen > 17 || minLen < 1) throw new Error('bz2: internal error 3004');
      assignCodes(code[t], len[t], minLen, maxLen, alphaSize);
    }

    // the mapping table
    {
      const inUse16 = new Uint8Array(16);
      for (i = 0; i < 16; i++) for (j = 0; j < 16; j++) if (this.inUse[i * 16 + j]) inUse16[i] = 1;
      for (i = 0; i < 16; i++) this._bsW(1, inUse16[i]);
      for (i = 0; i < 16; i++) {
        if (inUse16[i]) for (j = 0; j < 16; j++) this._bsW(1, this.inUse[i * 16 + j]);
      }
    }

    // the selectors
    this._bsW(3, nGroups);
    this._bsW(15, nSelectors);
    for (i = 0; i < nSelectors; i++) {
      for (j = 0; j < selectorMtf[i]; j++) this._bsW(1, 1);
      this._bsW(1, 0);
    }

    // the coding tables, as deltas
    for (t = 0; t < nGroups; t++) {
      let curr = len[t][0];
      this._bsW(5, curr);
      for (i = 0; i < alphaSize; i++) {
        while (curr < len[t][i]) { this._bsW(2, 2); curr++; }
        while (curr > len[t][i]) { this._bsW(2, 3); curr--; }
        this._bsW(1, 0);
      }
    }

    // and the block data proper
    selCtr = 0;
    gs = 0;
    while (true) {
      if (gs >= nMTF) break;
      ge = gs + G_SIZE - 1;
      if (ge >= nMTF) ge = nMTF - 1;
      const sl = len[selector[selCtr]], sc = code[selector[selCtr]];
      for (i = gs; i <= ge; i++) this._bsW(sl[mtfv[i]], sc[mtfv[i]]);
      gs = ge + 1;
      selCtr++;
    }
  }
}
