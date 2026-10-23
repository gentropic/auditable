// The Burrows–Wheeler sort: blocksort.c of bzip2 1.0.8, ported line for line. The order it
// leaves equal rotations in decides origPtr, so a different (correct) sort would write a valid
// but different stream; this one writes libbzip2's bytes. bzip2's arrays alias one another
// (the block is the bytes of arr2, mtfv the halves of arr1); here each is its own array, which
// the C's own access pattern makes equivalent.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

const N_RADIX = 2, N_QSORT = 12, N_SHELL = 18;
export const N_OVERSHOOT = N_RADIX + N_QSORT + N_SHELL + 2;

// ── fallback O(N log(N)^2) sort, for repetitive blocks ──

function fallbackSimpleSort(fmap, eclass, lo, hi) {
  let i, j, tmp, ecTmp;
  if (lo === hi) return;
  if (hi - lo > 3) {
    for (i = hi - 4; i >= lo; i--) {
      tmp = fmap[i];
      ecTmp = eclass[tmp];
      for (j = i + 4; j <= hi && ecTmp > eclass[fmap[j]]; j += 4) fmap[j - 4] = fmap[j];
      fmap[j - 4] = tmp;
    }
  }
  for (i = hi - 1; i >= lo; i--) {
    tmp = fmap[i];
    ecTmp = eclass[tmp];
    for (j = i + 1; j <= hi && ecTmp > eclass[fmap[j]]; j++) fmap[j - 1] = fmap[j];
    fmap[j - 1] = tmp;
  }
}

const FALLBACK_QSORT_SMALL_THRESH = 10;
const FALLBACK_QSORT_STACK_SIZE = 100;
const fStackLo = new Int32Array(FALLBACK_QSORT_STACK_SIZE);
const fStackHi = new Int32Array(FALLBACK_QSORT_STACK_SIZE);

function fallbackQSort3(fmap, eclass, loSt, hiSt) {
  let unLo, unHi, ltLo, gtHi, n, m, sp, lo, hi, med, r3, t;
  let r = 0;
  const stackLo = fStackLo, stackHi = fStackHi;
  sp = 0;
  stackLo[sp] = loSt; stackHi[sp] = hiSt; sp++;
  while (sp > 0) {
    if (!(sp < FALLBACK_QSORT_STACK_SIZE - 1)) throw new Error('bz2: internal error 1004');
    sp--; lo = stackLo[sp]; hi = stackHi[sp];
    if (hi - lo < FALLBACK_QSORT_SMALL_THRESH) {
      fallbackSimpleSort(fmap, eclass, lo, hi);
      continue;
    }
    // random partitioning (Sedgewick's 7621 / 32768)
    r = ((r * 7621) + 1) % 32768;
    r3 = r % 3;
    if (r3 === 0) med = eclass[fmap[lo]];
    else if (r3 === 1) med = eclass[fmap[(lo + hi) >> 1]];
    else med = eclass[fmap[hi]];

    unLo = ltLo = lo;
    unHi = gtHi = hi;
    while (true) {
      while (true) {
        if (unLo > unHi) break;
        n = eclass[fmap[unLo]] - med;
        if (n === 0) { t = fmap[unLo]; fmap[unLo] = fmap[ltLo]; fmap[ltLo] = t; ltLo++; unLo++; continue; }
        if (n > 0) break;
        unLo++;
      }
      while (true) {
        if (unLo > unHi) break;
        n = eclass[fmap[unHi]] - med;
        if (n === 0) { t = fmap[unHi]; fmap[unHi] = fmap[gtHi]; fmap[gtHi] = t; gtHi--; unHi--; continue; }
        if (n < 0) break;
        unHi--;
      }
      if (unLo > unHi) break;
      t = fmap[unLo]; fmap[unLo] = fmap[unHi]; fmap[unHi] = t; unLo++; unHi--;
    }
    if (gtHi < ltLo) continue;

    n = Math.min(ltLo - lo, unLo - ltLo); vswap(fmap, lo, unLo - n, n);
    m = Math.min(hi - gtHi, gtHi - unHi); vswap(fmap, unLo, hi - m + 1, m);
    n = lo + unLo - ltLo - 1;
    m = hi - (gtHi - unHi) + 1;
    if (n - lo > hi - m) {
      stackLo[sp] = lo; stackHi[sp] = n; sp++;
      stackLo[sp] = m; stackHi[sp] = hi; sp++;
    } else {
      stackLo[sp] = m; stackHi[sp] = hi; sp++;
      stackLo[sp] = lo; stackHi[sp] = n; sp++;
    }
  }
}

function vswap(a, p1, p2, n) {
  while (n > 0) { const t = a[p1]; a[p1] = a[p2]; a[p2] = t; p1++; p2++; n--; }
}

// fmap gets the sorted order of block[0 .. nblock-1]; eclass and bhtab are scratch
function fallbackSort(fmap, block, eclass, bhtab, nblock) {
  const ftab = new Int32Array(257);
  const ftabCopy = new Int32Array(256);
  let H, i, j, k, l, r, cc, cc1, nNotDone, nBhtab;
  const SET_BH = (zz) => { bhtab[zz >> 5] |= (1 << (zz & 31)); };
  const CLEAR_BH = (zz) => { bhtab[zz >> 5] &= ~(1 << (zz & 31)); };
  const ISSET_BH = (zz) => (bhtab[zz >> 5] & (1 << (zz & 31))) !== 0;

  // initial 1-char radix sort: the initial fmap and BH bits
  for (i = 0; i < nblock; i++) ftab[block[i]]++;
  for (i = 0; i < 256; i++) ftabCopy[i] = ftab[i];
  for (i = 1; i < 257; i++) ftab[i] += ftab[i - 1];
  for (i = 0; i < nblock; i++) {
    j = block[i];
    k = ftab[j] - 1;
    ftab[j] = k;
    fmap[k] = i;
  }
  nBhtab = 2 + ((nblock / 32) | 0);
  for (i = 0; i < nBhtab; i++) bhtab[i] = 0;
  for (i = 0; i < 256; i++) SET_BH(ftab[i]);

  // sentinel bits for block-end detection
  for (i = 0; i < 32; i++) { SET_BH(nblock + 2 * i); CLEAR_BH(nblock + 2 * i + 1); }

  // the log(N) loop: an "exponential radix sort" after Manber-Myers
  H = 1;
  while (true) {
    j = 0;
    for (i = 0; i < nblock; i++) {
      if (ISSET_BH(i)) j = i;
      k = fmap[i] - H; if (k < 0) k += nblock;
      eclass[k] = j;
    }
    nNotDone = 0;
    r = -1;
    while (true) {
      // the next non-singleton bucket
      k = r + 1;
      while (ISSET_BH(k) && (k & 0x1f)) k++;
      if (ISSET_BH(k)) {
        while (bhtab[k >> 5] === -1) k += 32;
        while (ISSET_BH(k)) k++;
      }
      l = k - 1;
      if (l >= nblock) break;
      while (!ISSET_BH(k) && (k & 0x1f)) k++;
      if (!ISSET_BH(k)) {
        while (bhtab[k >> 5] === 0) k += 32;
        while (!ISSET_BH(k)) k++;
      }
      r = k - 1;
      if (r >= nblock) break;
      // [l, r] bracket the current bucket
      if (r > l) {
        nNotDone += (r - l + 1);
        fallbackQSort3(fmap, eclass, l, r);
        // scan the bucket, generating header bits
        cc = -1;
        for (i = l; i <= r; i++) {
          cc1 = eclass[fmap[i]];
          if (cc !== cc1) { SET_BH(i); cc = cc1; }
        }
      }
    }
    H *= 2;
    if (H > nblock || nNotDone === 0) break;
  }
  // (the C reconstructs the block here, which its eclass overwrote; ours is separate)
}

// ── the main O(N^2 log(N)) sort, faster for "normal" blocks ──

// rotation i1 > rotation i2, as far as the block and the quadrant tell; budget[0] counts work
function mainGtU(i1, i2, block, quadrant, nblock, budget) {
  let k, c1, c2, s1, s2;
  for (let n = 0; n < 12; n++) {
    c1 = block[i1]; c2 = block[i2];
    if (c1 !== c2) return c1 > c2;
    i1++; i2++;
  }
  k = nblock + 8;
  do {
    for (let n = 0; n < 8; n++) {
      c1 = block[i1]; c2 = block[i2];
      if (c1 !== c2) return c1 > c2;
      s1 = quadrant[i1]; s2 = quadrant[i2];
      if (s1 !== s2) return s1 > s2;
      i1++; i2++;
    }
    if (i1 >= nblock) i1 -= nblock;
    if (i2 >= nblock) i2 -= nblock;
    k -= 8;
    budget[0]--;
  } while (k >= 0);
  return false;
}

// Knuth's increments
const INCS = [1, 4, 13, 40, 121, 364, 1093, 3280, 9841, 29524, 88573, 265720, 797161, 2391484];

function mainSimpleSort(ptr, block, quadrant, nblock, lo, hi, d, budget) {
  let i, j, h, hp, v;
  const bigN = hi - lo + 1;
  if (bigN < 2) return;
  hp = 0;
  while (INCS[hp] < bigN) hp++;
  hp--;
  for (; hp >= 0; hp--) {
    h = INCS[hp];
    i = lo + h;
    while (true) {
      // (the C unrolls three copies of this; the budget is looked at after each third)
      for (let c = 0; c < 3; c++) {
        if (i > hi) break;
        v = ptr[i];
        j = i;
        while (mainGtU(ptr[j - h] + d, v + d, block, quadrant, nblock, budget)) {
          ptr[j] = ptr[j - h];
          j = j - h;
          if (j <= (lo + h - 1)) break;
        }
        ptr[j] = v;
        i++;
      }
      if (i > hi) break;
      if (budget[0] < 0) return;
    }
  }
}

function mmed3(a, b, c) {
  let t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) {
    b = c;
    if (a > b) b = a;
  }
  return b;
}

const MAIN_QSORT_SMALL_THRESH = 20;
const MAIN_QSORT_DEPTH_THRESH = N_RADIX + N_QSORT;
const MAIN_QSORT_STACK_SIZE = 100;
const mStackLo = new Int32Array(MAIN_QSORT_STACK_SIZE);
const mStackHi = new Int32Array(MAIN_QSORT_STACK_SIZE);
const mStackD = new Int32Array(MAIN_QSORT_STACK_SIZE);

// the 3-way string quicksort of Sedgewick and Bentley
function mainQSort3(ptr, block, quadrant, nblock, loSt, hiSt, dSt, budget) {
  let unLo, unHi, ltLo, gtHi, n, m, med, sp, lo, hi, d, t;
  const stackLo = mStackLo, stackHi = mStackHi, stackD = mStackD;
  const nextLo = [0, 0, 0], nextHi = [0, 0, 0], nextD = [0, 0, 0];
  const size = (a) => nextHi[a] - nextLo[a];
  const swapNext = (a, b) => {
    let z = nextLo[a]; nextLo[a] = nextLo[b]; nextLo[b] = z;
    z = nextHi[a]; nextHi[a] = nextHi[b]; nextHi[b] = z;
    z = nextD[a]; nextD[a] = nextD[b]; nextD[b] = z;
  };

  sp = 0;
  stackLo[sp] = loSt; stackHi[sp] = hiSt; stackD[sp] = dSt; sp++;
  while (sp > 0) {
    if (!(sp < MAIN_QSORT_STACK_SIZE - 2)) throw new Error('bz2: internal error 1001');
    sp--; lo = stackLo[sp]; hi = stackHi[sp]; d = stackD[sp];
    if (hi - lo < MAIN_QSORT_SMALL_THRESH || d > MAIN_QSORT_DEPTH_THRESH) {
      mainSimpleSort(ptr, block, quadrant, nblock, lo, hi, d, budget);
      if (budget[0] < 0) return;
      continue;
    }
    med = mmed3(block[ptr[lo] + d], block[ptr[hi] + d], block[ptr[(lo + hi) >> 1] + d]);

    unLo = ltLo = lo;
    unHi = gtHi = hi;
    while (true) {
      while (true) {
        if (unLo > unHi) break;
        n = block[ptr[unLo] + d] - med;
        if (n === 0) { t = ptr[unLo]; ptr[unLo] = ptr[ltLo]; ptr[ltLo] = t; ltLo++; unLo++; continue; }
        if (n > 0) break;
        unLo++;
      }
      while (true) {
        if (unLo > unHi) break;
        n = block[ptr[unHi] + d] - med;
        if (n === 0) { t = ptr[unHi]; ptr[unHi] = ptr[gtHi]; ptr[gtHi] = t; gtHi--; unHi--; continue; }
        if (n < 0) break;
        unHi--;
      }
      if (unLo > unHi) break;
      t = ptr[unLo]; ptr[unLo] = ptr[unHi]; ptr[unHi] = t; unLo++; unHi--;
    }

    if (gtHi < ltLo) {
      stackLo[sp] = lo; stackHi[sp] = hi; stackD[sp] = d + 1; sp++;
      continue;
    }

    n = Math.min(ltLo - lo, unLo - ltLo); vswap(ptr, lo, unLo - n, n);
    m = Math.min(hi - gtHi, gtHi - unHi); vswap(ptr, unLo, hi - m + 1, m);
    n = lo + unLo - ltLo - 1;
    m = hi - (gtHi - unHi) + 1;

    nextLo[0] = lo; nextHi[0] = n; nextD[0] = d;
    nextLo[1] = m; nextHi[1] = hi; nextD[1] = d;
    nextLo[2] = n + 1; nextHi[2] = m - 1; nextD[2] = d + 1;

    if (size(0) < size(1)) swapNext(0, 1);
    if (size(1) < size(2)) swapNext(1, 2);
    if (size(0) < size(1)) swapNext(0, 1);

    for (let q = 0; q < 3; q++) { stackLo[sp] = nextLo[q]; stackHi[sp] = nextHi[q]; stackD[sp] = nextD[q]; sp++; }
  }
}

const SETMASK = 1 << 21;
const CLEARMASK = ~SETMASK;

// block holds nblock bytes plus N_OVERSHOOT of room; ptr gets the sorted order (or the sort is
// abandoned: budget[0] < 0)
function mainSort(ptr, block, quadrant, ftab, nblock, budget) {
  let i, j, k, ss, sb, c1, numQSorted, s;
  const runningOrder = new Int32Array(256);
  const bigDone = new Uint8Array(256);
  const copyStart = new Int32Array(256);
  const copyEnd = new Int32Array(256);
  const BIGFREQ = (b) => ftab[(b + 1) << 8] - ftab[b << 8];

  // the 2-byte frequency table
  for (i = 65536; i >= 0; i--) ftab[i] = 0;
  j = block[0] << 8;
  for (i = nblock - 1; i >= 0; i--) {
    quadrant[i] = 0;
    j = (j >> 8) | (block[i] << 8);
    ftab[j]++;
  }
  for (i = 0; i < N_OVERSHOOT; i++) {
    block[nblock + i] = block[i];
    quadrant[nblock + i] = 0;
  }

  // complete the initial radix sort
  for (i = 1; i <= 65536; i++) ftab[i] += ftab[i - 1];
  s = block[0] << 8;
  for (i = nblock - 1; i >= 0; i--) {
    s = ((s >> 8) | (block[i] << 8)) & 0xffff;
    j = ftab[s] - 1;
    ftab[s] = j;
    ptr[j] = i;
  }

  // the running order, from smallest to largest big bucket
  for (i = 0; i <= 255; i++) { bigDone[i] = 0; runningOrder[i] = i; }
  {
    let vv, h = 1;
    do h = 3 * h + 1; while (h <= 256);
    do {
      h = (h / 3) | 0;
      for (i = h; i <= 255; i++) {
        vv = runningOrder[i];
        j = i;
        while (BIGFREQ(runningOrder[j - h]) > BIGFREQ(vv)) {
          runningOrder[j] = runningOrder[j - h];
          j = j - h;
          if (j <= (h - 1)) break;
        }
        runningOrder[j] = vv;
      }
    } while (h !== 1);
  }

  // the main sorting loop
  numQSorted = 0;
  for (i = 0; i <= 255; i++) {
    ss = runningOrder[i];

    // Step 1: complete the big bucket [ss] by quicksorting any unsorted small buckets [ss, j]
    for (j = 0; j <= 255; j++) {
      if (j !== ss) {
        sb = (ss << 8) + j;
        if (!(ftab[sb] & SETMASK)) {
          const lo = ftab[sb] & CLEARMASK;
          const hi = (ftab[sb + 1] & CLEARMASK) - 1;
          if (hi > lo) {
            mainQSort3(ptr, block, quadrant, nblock, lo, hi, N_RADIX, budget);
            numQSorted += (hi - lo + 1);
            if (budget[0] < 0) return;
          }
        }
        ftab[sb] |= SETMASK;
      }
    }
    if (bigDone[ss]) throw new Error('bz2: internal error 1006');

    // Step 2: scan the big bucket [ss] to synthesise the order of the small buckets [t, ss]
    for (j = 0; j <= 255; j++) {
      copyStart[j] = ftab[(j << 8) + ss] & CLEARMASK;
      copyEnd[j] = (ftab[(j << 8) + ss + 1] & CLEARMASK) - 1;
    }
    for (j = ftab[ss << 8] & CLEARMASK; j < copyStart[ss]; j++) {
      k = ptr[j] - 1; if (k < 0) k += nblock;
      c1 = block[k];
      if (!bigDone[c1]) ptr[copyStart[c1]++] = k;
    }
    for (j = (ftab[(ss + 1) << 8] & CLEARMASK) - 1; j > copyEnd[ss]; j--) {
      k = ptr[j] - 1; if (k < 0) k += nblock;
      c1 = block[k];
      if (!bigDone[c1]) ptr[copyEnd[c1]--] = k;
    }
    if (!((copyStart[ss] - 1 === copyEnd[ss]) || (copyStart[ss] === 0 && copyEnd[ss] === nblock - 1))) {
      throw new Error('bz2: internal error 1007');
    }
    for (j = 0; j <= 255; j++) ftab[(j << 8) + ss] |= SETMASK;

    // Step 3: [ss] is done; record that, and update the quadrant descriptors
    bigDone[ss] = 1;
    if (i < 255) {
      const bbStart = ftab[ss << 8] & CLEARMASK;
      const bbSize = (ftab[(ss + 1) << 8] & CLEARMASK) - bbStart;
      let shifts = 0;
      while ((bbSize >> shifts) > 65534) shifts++;
      for (j = bbSize - 1; j >= 0; j--) {
        const a2update = ptr[bbStart + j];
        const qVal = (j >> shifts) & 0xffff;
        quadrant[a2update] = qVal;
        if (a2update < N_OVERSHOOT) quadrant[a2update + nblock] = qVal;
      }
      if (!(((bbSize - 1) >> shifts) <= 65535)) throw new Error('bz2: internal error 1002');
    }
  }
}

// BZ2_blockSort: s = { ptr, block, quadrant, ftab, eclass, nblock, workFactor } → origPtr
export function blockSort(s) {
  const { ptr, block, quadrant, ftab, nblock } = s;
  if (nblock < 10000) {
    fallbackSort(ptr, block, s.eclass, ftab, nblock);
  } else {
    let wfact = s.workFactor;
    if (wfact < 1) wfact = 1;
    if (wfact > 100) wfact = 100;
    const budget = [nblock * (((wfact - 1) / 3) | 0)];
    mainSort(ptr, block, quadrant, ftab, nblock, budget);
    if (budget[0] < 0) fallbackSort(ptr, block, s.eclass, ftab, nblock);
  }
  for (let i = 0; i < nblock; i++) if (ptr[i] === 0) return i;
  throw new Error('bz2: internal error 1003');
}
