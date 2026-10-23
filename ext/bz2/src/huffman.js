// Huffman code lengths and canonical codes: huffman.c of bzip2 1.0.8, ported line for line
// (the tie-breaking of its heap decides the lengths, hence the stream's bytes).
//
// Ported from bzip2/libbzip2 1.0.8, Copyright (C) 1996-2019 Julian Seward — see LICENSE.

export const MAX_ALPHA_SIZE = 258;
export const MAX_CODE_LEN = 23;

const heap = new Int32Array(MAX_ALPHA_SIZE + 2);
const weight = new Int32Array(MAX_ALPHA_SIZE * 2);
const parent = new Int32Array(MAX_ALPHA_SIZE * 2);

// len[0 .. alphaSize-1] ← code lengths for freq, none longer than maxLen
export function makeCodeLengths(len, freq, alphaSize, maxLen) {
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

export function assignCodes(code, length, minLen, maxLen, alphaSize) {
  let vec = 0;
  for (let n = minLen; n <= maxLen; n++) {
    for (let i = 0; i < alphaSize; i++) if (length[i] === n) { code[i] = vec; vec++; }
    vec <<= 1;
  }
}

export function createDecodeTables(limit, base, perm, length, minLen, maxLen, alphaSize) {
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
