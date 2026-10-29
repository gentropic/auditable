// @gcu/sluice — t-digest streaming approximate quantiles.
//
// Chosen over P² because it MERGES cleanly (the parallel-scan requirement).
// result() ships plain centroids; quantileFromCentroids() answers any p later
// — the "worker accumulates → ships centroids → client queries arbitrary p
// without re-scanning" pattern.

const DEFAULT_COMPRESSION = 100;
const BUFFER_SIZE = 2000;

// tdigest() accumulator. State: { centroids:[{mean,count}], buffer:[v…], totalCount, k }.
// push() ignores weight (weighted quantiles are out of scope for v1).
export function tdigest({ compression = DEFAULT_COMPRESSION } = {}) {
  return {
    create: () => ({ centroids: [], buffer: [], totalCount: 0, k: compression }),
    push: (s, v) => {
      if (!Number.isFinite(v)) return;
      s.buffer.push(v);
      s.totalCount++;
      if (s.buffer.length >= BUFFER_SIZE) flush(s);
    },
    // a whole column chunk at once (typed array or plain array; non-finite
    // values and nulls skipped) — a native numeric sort, then one merge pass
    // that builds centroids without an object per value. Same digest as
    // pushing each value, several times faster on large chunks.
    pushArray: (s, arr, start = 0, end = arr.length) => {
      const b = new Float64Array(end - start);
      let m = 0;
      for (let i = start; i < end; i++) { const v = arr[i]; if (Number.isFinite(v)) b[m++] = v; }
      if (!m) return 0;
      if (s.buffer.length) flush(s);
      const sorted = b.subarray(0, m).sort();
      s.totalCount += m;
      s.centroids = mergeSorted(sorted, s.centroids, s.totalCount, s.k);
      return m;
    },
    merge: (a, b) => {
      const k = a.k || b.k || DEFAULT_COMPRESSION;
      const entries = [
        ...a.centroids.map((c) => ({ mean: c.mean, count: c.count })),
        ...a.buffer.map((v) => ({ mean: v, count: 1 })),
        ...b.centroids.map((c) => ({ mean: c.mean, count: c.count })),
        ...b.buffer.map((v) => ({ mean: v, count: 1 })),
      ];
      entries.sort((x, y) => x.mean - y.mean);
      const total = a.totalCount + b.totalCount;
      return { centroids: compress(entries, total, k), buffer: [], totalCount: total, k };
    },
    result: (s) => {
      flush(s);
      return { count: s.totalCount, centroids: s.centroids.map((c) => [c.mean, c.count]) };
    },
  };
}

function flush(s) {
  if (s.buffer.length === 0) return;
  s.buffer.sort((a, b) => a - b);
  const merged = [];
  let bi = 0, ci = 0;
  while (bi < s.buffer.length || ci < s.centroids.length) {
    if (bi < s.buffer.length && (ci >= s.centroids.length || s.buffer[bi] <= s.centroids[ci].mean)) {
      merged.push({ mean: s.buffer[bi], count: 1 }); bi++;
    } else {
      merged.push({ mean: s.centroids[ci].mean, count: s.centroids[ci].count }); ci++;
    }
  }
  s.buffer = [];
  s.centroids = compress(merged, s.totalCount, s.k);
}

// sorted singletons ∪ existing centroids → compressed centroids, in one pass
// (compress()'s rule, fed from two sorted sources instead of a merged list).
function mergeSorted(vals, cents, totalCount, k) {
  const out = [];
  let last = null, cum = 0, vi = 0, ci = 0;
  const n = vals.length, nc = cents.length;
  while (vi < n || ci < nc) {
    let mean, count;
    if (vi < n && (ci >= nc || vals[vi] <= cents[ci].mean)) { mean = vals[vi++]; count = 1; }
    else { mean = cents[ci].mean; count = cents[ci].count; ci++; }
    if (last) {
      const q = cum / totalCount;
      const maxSize = Math.max(1, Math.floor(4 * totalCount * q * (1 - q) / k));
      if (last.count + count <= maxSize) {
        const c2 = last.count + count;
        last.mean += (mean - last.mean) * count / c2;
        last.count = c2;
        cum += count;
        continue;
      }
    }
    last = { mean, count };
    out.push(last);
    cum += count;
  }
  return out;
}

function compress(centroids, totalCount, k) {
  if (centroids.length <= 1) return centroids;
  const out = [{ mean: centroids[0].mean, count: centroids[0].count }];
  let cum = centroids[0].count;
  for (let i = 1; i < centroids.length; i++) {
    const c = centroids[i];
    const last = out[out.length - 1];
    // the k1 size bound: a centroid at quantile q may hold 4·N·q(1−q)/δ points,
    // so the digest keeps O(δ) centroids whatever N is. (It read 4·δ·q(1−q),
    // which caps a centroid near δ points: N/20 centroids, quadratic flushes.)
    const q = cum / totalCount;
    const maxSize = Math.max(1, Math.floor(4 * totalCount * q * (1 - q) / k));
    if (last.count + c.count <= maxSize) {
      const nc = last.count + c.count;
      last.mean += (c.mean - last.mean) * c.count / nc;
      last.count = nc;
    } else {
      out.push({ mean: c.mean, count: c.count });
    }
    cum += c.count;
  }
  return out;
}

// Query a quantile from shipped/cached centroids ([[mean,count]…]) + total count.
export function quantileFromCentroids(centroids, totalCount, q) {
  const n = centroids.length;
  if (n === 0 || totalCount === 0) return null;
  if (n === 1) return centroids[0][0];
  if (q <= 0) return centroids[0][0];
  if (q >= 1) return centroids[n - 1][0];
  const target = q * totalCount;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    const cMean = centroids[i][0], cCount = centroids[i][1];
    const mid = cum + cCount / 2;
    if (target < mid) {
      if (i === 0) return cMean;
      const pMean = centroids[i - 1][0], pCount = centroids[i - 1][1];
      const prevMid = cum - pCount / 2;
      const t = (target - prevMid) / (mid - prevMid);
      return pMean + t * (cMean - pMean);
    }
    cum += cCount;
  }
  return centroids[n - 1][0];
}

// The digest's CDF from shipped centroids: x → how many values lie below x,
// piecewise-linear through each centroid's midpoint (a centroid's mass spread
// around its mean, not piled on it). Precomputed once, then O(log n) per x.
export function cdfFromCentroids(centroids, totalCount) {
  const n = centroids.length;
  const means = new Float64Array(n), mids = new Float64Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) { means[i] = centroids[i][0]; mids[i] = cum + centroids[i][1] / 2; cum += centroids[i][1]; }
  const total = totalCount || cum;
  return (x) => {
    if (!n || x < means[0]) return 0;
    if (x >= means[n - 1]) return x === means[n - 1] ? mids[n - 1] : total;
    let a = 0, b = n - 1;                                  // means[a] <= x < means[b]
    while (b - a > 1) { const m = (a + b) >> 1; if (means[m] <= x) a = m; else b = m; }
    const span = means[b] - means[a];
    return span > 0 ? mids[a] + (x - means[a]) / span * (mids[b] - mids[a]) : mids[a];
  };
}

// counts in `bins` equal bins over [lo, hi] from shipped centroids, through the
// CDF above. Values beyond the range land in the end bins (a clipped view).
export function histogramFromCentroids(centroids, totalCount, lo, hi, bins) {
  const out = new Float64Array(bins);
  if (!centroids.length || !(hi > lo)) { if (bins) out[0] = totalCount || 0; return out; }
  const F = cdfFromCentroids(centroids, totalCount);
  const total = totalCount || centroids.reduce((s, c) => s + c[1], 0);
  let prev = 0;
  for (let k = 0; k < bins; k++) {
    const next = k === bins - 1 ? total : F(lo + (hi - lo) * (k + 1) / bins);
    out[k] = Math.max(0, next - prev);
    prev = Math.max(prev, next);
  }
  return out;
}

// Convenience: quantile of a live tdigest state.
export function quantile(state, q) {
  flush(state);
  return quantileFromCentroids(state.centroids.map((c) => [c.mean, c.count]), state.totalCount, q);
}
