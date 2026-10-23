// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/bz2 — bzip2 in plain JavaScript, both directions: a line-for-line port of libbzip2 1.0.8, so the streams it writes are byte-identical to bzip2's (and CPython's bz2) and it reads them as libbzip2 does — streamed, with maxLength, needsInput and unusedData. No WebAssembly, no dependencies.

// ── src/tables.js ──

// bzip2's tables. BZ2_RNUMS is randtable.c's BZ2_rNums, copied — the randomisation of
// blocks written by bzip2 before 0.9.5 (decoders still have to undo it). The CRC is bzip2's:
// CRC-32 with the 0x04c11db7 polynomial, most significant bit first (crctable.c, computed here).

const BZ2_RNUMS = new Int32Array([
  619, 720, 127, 481, 931, 816, 813, 233, 566, 247, 985, 724, 205, 454, 863, 491,
  741, 242, 949, 214, 733, 859, 335, 708, 621, 574, 73, 654, 730, 472, 419, 436,
  278, 496, 867, 210, 399, 680, 480, 51, 878, 465, 811, 169, 869, 675, 611, 697,
  867, 561, 862, 687, 507, 283, 482, 129, 807, 591, 733, 623, 150, 238, 59, 379,
  684, 877, 625, 169, 643, 105, 170, 607, 520, 932, 727, 476, 693, 425, 174, 647,
  73, 122, 335, 530, 442, 853, 695, 249, 445, 515, 909, 545, 703, 919, 874, 474,
  882, 500, 594, 612, 641, 801, 220, 162, 819, 984, 589, 513, 495, 799, 161, 604,
  958, 533, 221, 400, 386, 867, 600, 782, 382, 596, 414, 171, 516, 375, 682, 485,
  911, 276, 98, 553, 163, 354, 666, 933, 424, 341, 533, 870, 227, 730, 475, 186,
  263, 647, 537, 686, 600, 224, 469, 68, 770, 919, 190, 373, 294, 822, 808, 206,
  184, 943, 795, 384, 383, 461, 404, 758, 839, 887, 715, 67, 618, 276, 204, 918,
  873, 777, 604, 560, 951, 160, 578, 722, 79, 804, 96, 409, 713, 940, 652, 934,
  970, 447, 318, 353, 859, 672, 112, 785, 645, 863, 803, 350, 139, 93, 354, 99,
  820, 908, 609, 772, 154, 274, 580, 184, 79, 626, 630, 742, 653, 282, 762, 623,
  680, 81, 927, 626, 789, 125, 411, 521, 938, 300, 821, 78, 343, 175, 128, 250,
  170, 774, 972, 275, 999, 639, 495, 78, 352, 126, 857, 956, 358, 619, 580, 124,
  737, 594, 701, 612, 669, 112, 134, 694, 363, 992, 809, 743, 168, 974, 944, 375,
  748, 52, 600, 747, 642, 182, 862, 81, 344, 805, 988, 739, 511, 655, 814, 334,
  249, 515, 897, 955, 664, 981, 649, 113, 974, 459, 893, 228, 433, 837, 553, 268,
  926, 240, 102, 654, 459, 51, 686, 754, 806, 760, 493, 403, 415, 394, 687, 700,
  946, 670, 656, 610, 738, 392, 760, 799, 887, 653, 978, 321, 576, 617, 626, 502,
  894, 679, 243, 440, 680, 879, 194, 572, 640, 724, 926, 56, 204, 700, 707, 151,
  457, 449, 797, 195, 791, 558, 945, 679, 297, 59, 87, 824, 713, 663, 412, 693,
  342, 606, 134, 108, 571, 364, 631, 212, 174, 643, 304, 329, 343, 97, 430, 751,
  497, 314, 983, 374, 822, 928, 140, 206, 73, 263, 980, 736, 876, 478, 430, 305,
  170, 514, 364, 692, 829, 82, 855, 953, 676, 246, 369, 970, 294, 750, 807, 827,
  150, 790, 288, 923, 804, 378, 215, 828, 592, 281, 565, 555, 710, 82, 896, 831,
  547, 261, 524, 462, 293, 465, 502, 56, 661, 821, 976, 991, 658, 869, 905, 758,
  745, 193, 768, 550, 608, 933, 378, 286, 215, 979, 792, 961, 61, 688, 793, 644,
  986, 403, 106, 366, 905, 644, 372, 567, 466, 434, 645, 210, 389, 550, 919, 135,
  780, 773, 635, 389, 707, 100, 626, 958, 165, 504, 920, 176, 193, 713, 857, 265,
  203, 50, 668, 108, 645, 990, 626, 197, 510, 357, 358, 850, 858, 364, 936, 638,
]);

const BZ2_CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

// ── src/blocksort.js ──

// The Burrows–Wheeler sort: blocksort.c of bzip2 1.0.8, ported line for line. The order it
// leaves equal rotations in decides origPtr, so a different (correct) sort would write a valid
// but different stream; this one writes libbzip2's bytes. bzip2's arrays alias one another
// (the block is the bytes of arr2, mtfv the halves of arr1); here each is its own array, which
// the C's own access pattern makes equivalent.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

const N_RADIX = 2, N_QSORT = 12, N_SHELL = 18;
const N_OVERSHOOT = N_RADIX + N_QSORT + N_SHELL + 2;

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
function blockSort(s) {
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

// ── src/huffman.js ──

// Huffman code lengths and canonical codes: huffman.c of bzip2 1.0.8, ported line for line
// (the tie-breaking of its heap decides the lengths, hence the stream's bytes).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

const MAX_ALPHA_SIZE = 258;
const MAX_CODE_LEN = 23;

const heap = new Int32Array(MAX_ALPHA_SIZE + 2);
const weight = new Int32Array(MAX_ALPHA_SIZE * 2);
const parent = new Int32Array(MAX_ALPHA_SIZE * 2);

// len[0 .. alphaSize-1] ← code lengths for freq, none longer than maxLen
function makeCodeLengths(len, freq, alphaSize, maxLen) {
  let nNodes, nHeap, n1, n2, i, j, k, tooLong;
  const upheap = (z) => {
    let zz = z;
    const tmp = heap[zz];
    while (weight[tmp] < weight[heap[zz >> 1]]) {
      heap[zz] = heap[zz >> 1];
      zz >>= 1;
    }
    heap[zz] = tmp;
  };
  const downheap = (z) => {
    let zz = z, yy;
    const tmp = heap[zz];
    while (true) {
      yy = zz << 1;
      if (yy > nHeap) break;
      if (yy < nHeap && weight[heap[yy + 1]] < weight[heap[yy]]) yy++;
      if (weight[tmp] < weight[heap[yy]]) break;
      heap[zz] = heap[yy];
      zz = yy;
    }
    heap[zz] = tmp;
  };

  for (i = 0; i < alphaSize; i++) weight[i + 1] = (freq[i] === 0 ? 1 : freq[i]) << 8;

  while (true) {
    nNodes = alphaSize;
    nHeap = 0;
    heap[0] = 0;
    weight[0] = 0;
    parent[0] = -2;
    for (i = 1; i <= alphaSize; i++) {
      parent[i] = -1;
      nHeap++;
      heap[nHeap] = i;
      upheap(nHeap);
    }
    while (nHeap > 1) {
      n1 = heap[1]; heap[1] = heap[nHeap]; nHeap--; downheap(1);
      n2 = heap[1]; heap[1] = heap[nHeap]; nHeap--; downheap(1);
      nNodes++;
      parent[n1] = parent[n2] = nNodes;
      // ADDWEIGHTS: the weights add, the depth is one more than the deeper's
      const w1 = weight[n1], w2 = weight[n2];
      weight[nNodes] = ((w1 & 0xffffff00) + (w2 & 0xffffff00)) | (1 + Math.max(w1 & 0xff, w2 & 0xff));
      parent[nNodes] = -1;
      nHeap++;
      heap[nHeap] = nNodes;
      upheap(nHeap);
    }

    tooLong = false;
    for (i = 1; i <= alphaSize; i++) {
      j = 0;
      k = i;
      while (parent[k] >= 0) { k = parent[k]; j++; }
      len[i - 1] = j;
      if (j > maxLen) tooLong = true;
    }
    if (!tooLong) break;

    // too long: flatten the frequencies and go again
    for (i = 1; i <= alphaSize; i++) {
      j = weight[i] >> 8;
      j = 1 + ((j / 2) | 0);
      weight[i] = j << 8;
    }
  }
}

function assignCodes(code, length, minLen, maxLen, alphaSize) {
  let vec = 0;
  for (let n = minLen; n <= maxLen; n++) {
    for (let i = 0; i < alphaSize; i++) if (length[i] === n) { code[i] = vec; vec++; }
    vec <<= 1;
  }
}

function createDecodeTables(limit, base, perm, length, minLen, maxLen, alphaSize) {
  let pp = 0, i, j, vec;
  for (i = minLen; i <= maxLen; i++) {
    for (j = 0; j < alphaSize; j++) if (length[j] === i) { perm[pp] = j; pp++; }
  }
  for (i = 0; i < MAX_CODE_LEN; i++) base[i] = 0;
  for (i = 0; i < alphaSize; i++) base[length[i] + 1]++;
  for (i = 1; i < MAX_CODE_LEN; i++) base[i] += base[i - 1];
  for (i = 0; i < MAX_CODE_LEN; i++) limit[i] = 0;
  vec = 0;
  for (i = minLen; i <= maxLen; i++) {
    vec += (base[i + 1] - base[i]);
    limit[i] = vec - 1;
    vec <<= 1;
  }
  for (i = minLen + 1; i <= maxLen; i++) base[i] = ((limit[i - 1] + 1) << 1) - base[i];
}

// ── src/compress.js ──

// The bzip2 compressor: bzlib.c's input side (the initial run-length coding into blocks) and
// compress.c (MTF + run coding, Huffman table selection, the bit stream), bzip2 1.0.8 ported
// line for line — so the bytes are libbzip2's, down to where a compress() call's output ends
// (its bit writer empties only before a write, so up to three whole bytes wait for the next).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.


const RUNA$compress = 0, RUNB$compress = 1;
const N_GROUPS$compress = 6, G_SIZE$compress = 50, N_ITERS = 4;
const MAX_SELECTORS$compress = 2 + ((900000 / G_SIZE$compress) | 0);
const LESSER_ICOST = 0, GREATER_ICOST = 15;

class Compressor {
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
    this.len = Array.from({ length: N_GROUPS$compress }, () => new Uint8Array(MAX_ALPHA_SIZE));
    this.code = Array.from({ length: N_GROUPS$compress }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.rfreq = Array.from({ length: N_GROUPS$compress }, () => new Int32Array(MAX_ALPHA_SIZE));
    this.selector = new Uint8Array(MAX_SELECTORS$compress);
    this.selectorMtf = new Uint8Array(MAX_SELECTORS$compress);
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
      this.blockCRC = ((this.blockCRC << 8) ^ BZ2_CRC32_TABLE[(this.blockCRC >>> 24) ^ c]) >>> 0;
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
    for (let i = 0; i < n; i++) crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
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
        if (zPend & 1) { mtfv[wr++] = RUNB$compress; mtfFreq[RUNB$compress]++; } else { mtfv[wr++] = RUNA$compress; mtfFreq[RUNA$compress]++; }
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
    const cost = new Uint16Array(N_GROUPS$compress);
    const fave = new Int32Array(N_GROUPS$compress);
    let v, t, i, j, gs, ge, bt, bc, iter, nSelectors, nGroups, minLen, maxLen, selCtr;

    for (t = 0; t < N_GROUPS$compress; t++) for (v = 0; v < alphaSize; v++) len[t][v] = GREATER_ICOST;

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
        ge = gs + G_SIZE$compress - 1;
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
    if (!(nSelectors < 32768 && nSelectors <= MAX_SELECTORS$compress)) throw new Error('bz2: internal error 3003');

    // MTF values for the selectors
    {
      const pos = new Uint8Array(N_GROUPS$compress);
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
      ge = gs + G_SIZE$compress - 1;
      if (ge >= nMTF) ge = nMTF - 1;
      const sl = len[selector[selCtr]], sc = code[selector[selCtr]];
      for (i = gs; i <= ge; i++) this._bsW(sl[mtfv[i]], sc[mtfv[i]]);
      gs = ge + 1;
      selCtr++;
    }
  }
}

// ── src/decompress.js ──

// The bzip2 decompressor: decompress.c (one block's Huffman / MTF / run decoding, then the
// inverse BWT) and bzlib.c's output side (the run-length decoding, CRCs), bzip2 1.0.8 ported.
// Input is consumed as libbzip2 consumes it — a byte at a time, only when bits are needed — so
// what's left over (unusedData) and when more input is wanted (needsInput) are libbzip2's, and
// so CPython's. The block parser is a generator: it pauses wherever the input runs out, the
// C's save-and-return-by-state machinery in another form.
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.


const RUNA$decompress = 0, RUNB$decompress = 1;
const N_GROUPS$decompress = 6, G_SIZE$decompress = 50;
const MAX_SELECTORS$decompress = 2 + ((900000 / G_SIZE$decompress) | 0);

// libbzip2's BZ_DATA_ERROR / BZ_DATA_ERROR_MAGIC
class BzDataError extends Error {
  constructor(magic = false) {
    super(magic ? 'bz2: not a bzip2 stream' : 'bz2: invalid data stream');
    this.name = 'BzDataError';
    this.magic = magic;
  }
}

const NEED_INPUT = 1, BLOCK_READY = 2, STREAM_END = 3;

class Decompressor {
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
    const selectorMtf = new Uint8Array(MAX_SELECTORS$decompress), selector = new Uint8Array(MAX_SELECTORS$decompress);
    const len = Array.from({ length: N_GROUPS$decompress }, () => new Uint8Array(MAX_ALPHA_SIZE));
    const limit = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_CODE_LEN));
    const base = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_CODE_LEN));
    const perm = Array.from({ length: N_GROUPS$decompress }, () => new Int32Array(MAX_ALPHA_SIZE));
    const minLens = new Int32Array(N_GROUPS$decompress);
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
      if (nGroups < 2 || nGroups > N_GROUPS$decompress) { self._pos = inPos; throw new BzDataError(); }
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
        if (i < MAX_SELECTORS$decompress) selectorMtf[i] = j;
      }
      if (nSelectors > MAX_SELECTORS$decompress) nSelectors = MAX_SELECTORS$decompress;
      {
        const pos = new Uint8Array(N_GROUPS$decompress);
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
          groupPos = G_SIZE$decompress;
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
        if (nextSym === RUNA$decompress || nextSym === RUNB$decompress) {
          // a run of the front symbol: RUNA / RUNB digits, bijective base 2
          if (this._runN === undefined) { this._runEs = -1; this._runN = 1; }
          if (this._runN >= 2 * 1024 * 1024) { self._pos = inPos; throw new BzDataError(); }
          this._runEs += (nextSym === RUNA$decompress ? 1 : 2) * this._runN;
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
          this._blockCRC = ((this._blockCRC << 8) ^ BZ2_CRC32_TABLE[(this._blockCRC >>> 24) ^ this._stateOutCh]) >>> 0;
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
          crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
          runLen--;
        }
        eqOne = true;
      }
      while (true) {
        if (eqOne) {
          // s_state_out_len_eq_one: the run's last byte
          if (n === cap) { runLen = 1; break outer; }
          buf[n++] = ch;
          crc = ((crc << 8) ^ BZ2_CRC32_TABLE[(crc >>> 24) ^ ch]) >>> 0;
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

// ── src/main.js ──

// @gcu/bz2 — bzip2, both ways, in plain JavaScript: libbzip2 1.0.8 ported, so a stream it writes
// is byte for byte the one libbzip2 (and CPython's bz2, and the bzip2 tool) writes, and what it
// reads it reads as they do — streamed, a maxLength at a time, with libbzip2's unusedData.
//
//   compress(bytes, level = 9)       → a .bz2 stream
//   decompress(bytes)                → the data of one or more concatenated streams
//   new Compressor(level)            .compress(bytes) → bytes so far; .flush() → the rest
//   new Decompressor()               .decompress(bytes, maxLength = -1); .eof, .needsInput,
//                                    .unusedData (CPython's BZ2Decompressor, member for member)



function compress(data, level = 9) {
  const c = new Compressor(level);
  const a = c.compress(data), b = c.flush();
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

// as CPython's bz2.decompress: stream after stream; trailing bytes that aren't one are ignored,
// a stream cut short is an error
function decompress(data) {
  const parts = [];
  let total = 0;
  while (data.length) {
    const d = new Decompressor();
    let res;
    try { res = d.decompress(data); } catch (e) {
      if (parts.length && e instanceof BzDataError) break;
      throw e;
    }
    parts.push(res); total += res.length;
    if (!d.eof) throw new Error('bz2: compressed data ended before the end-of-stream marker was reached');
    data = d.unusedData;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export {
  Compressor,
  Decompressor,
  BzDataError,
  compress,
  decompress,
};
