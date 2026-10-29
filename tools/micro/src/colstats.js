// micro colstats — the per-column statistics accumulator, and the scan that runs
// it over a Parquet file's row groups on the worker pool (src/pqpool.js).
//
// makeColAcc is SELF-CONTAINED on purpose (no closure over this module): the
// pool embeds its source into the worker with toString(), so the page and the
// workers push values through one definition, and their states merge.
import * as sluice from '../../../ext/sluice/index.js';
import { startParquetPool, defaultPoolSize, groupStarts } from './pqpool.js';

export const STAT_SLICE = 65536;

// sl = the @gcu/sluice exports. Numbers: welford + t-digest; text: topK +
// cardinality. States are plain data (structured-cloneable) and merge.
export function makeColAcc(sl) {
  const W = sl.welford(), TD = sl.tdigest(), TK = sl.topK({ limit: 500 }), CD = sl.cardinality({ limit: 4096 });
  const SLICE = 65536;
  const buf = new Float64Array(SLICE);
  const num = (v) => (typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v)));
  return {
    create: (isNum) => (isNum ? { num: true, w: W.create(), td: TD.create(), nulls: 0 }
      : { num: false, top: TK.create(), card: CD.create(), nulls: 0 }),
    pushNumber(c, v) {
      const x = num(v);
      if (!Number.isFinite(x)) { c.nulls++; return; }
      W.push(c.w, x); TD.push(c.td, x);
    },
    // a slice [a, b) of a column batch (b − a ≤ 65536): welford per value, the
    // t-digest once for the slice (a native sort + one merge)
    pushNumbers(c, arr, a, b) {
      let m = 0;
      for (let k = a; k < b; k++) {
        const x = num(arr[k]);
        if (!Number.isFinite(x)) { c.nulls++; continue; }
        W.push(c.w, x);
        buf[m++] = x;
      }
      if (m) TD.pushArray(c.td, buf, 0, m);
    },
    pushText(c, v) {
      const sv = v == null ? '' : String(v).trim();
      if (!sv) { c.nulls++; return; }
      TK.push(c.top, sv); CD.push(c.card, sv);
    },
    merge(c, o) {
      if (c.num) { c.w = W.merge(c.w, o.w); c.td = TD.merge(c.td, o.td); }
      else { c.top = TK.merge(c.top, o.top); c.card = CD.merge(c.card, o.card); }
      c.nulls += o.nulls;
    },
    result(c, rows) {
      if (c.num) {
        const w = W.result(c.w), td = TD.result(c.td);
        const q = (p) => sl.quantileFromCentroids(td.centroids, td.count, p);
        return { kind: 'num', n: w.count, nulls: c.nulls, mean: w.mean, std: w.std, min: w.min, max: w.max, p25: q(0.25), p50: q(0.5), p75: q(0.75), centroids: td.centroids, total: td.count };
      }
      const t = TK.result(c.top);
      return { kind: 'txt', n: rows - c.nulls, nulls: c.nulls, distinct: t.distinct, overflow: t.overflow, top: t.top(5) };
    },
  };
}

export const colAcc = () => makeColAcc(sluice);

// Scan `cols` ([{ name, num }]) of a Parquet file across a pool of workers
// (src/pqpool.js), row groups handed out one at a time. Resolves to the merged
// states (one per column, in order), or null when workers can't run here
// (file://, an old browser, a clone failure) — the caller then scans on the
// main thread. onProgress(rowsDone); signal aborts (rejects with AbortError).
export async function scanParquetInWorkers({ file, meta, rowGroups, cols, signal, onProgress, maxWorkers }) {
  if (!rowGroups.length) return null;
  const pool = await startParquetPool({ file, meta, task: 'stats', p: { cols }, n: maxWorkers || defaultPoolSize(rowGroups.length), makeColAcc, signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    let done = 0;
    await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount }).then(({ count }) => { done += count; if (onProgress) onProgress(done); })));
    const acc = colAcc();
    const merged = cols.map((c) => acc.create(c.num));
    for (const st of await pool.finish()) st.forEach((s, k) => acc.merge(merged[k], s));
    return merged;
  } finally { pool.close(); }
}
