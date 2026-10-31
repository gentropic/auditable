// @gcu/scan parquet-jobs — a Parquet model's whole-file jobs on the pool: the
// open's discovery sweep, a declared lattice's check, the open's render decode
// (in row-group order, bounded), and the column statistics. Each resolves null
// when workers can't run here; the caller then does the work on the page.
import { startPool, defaultPoolSize, groupStarts } from './pool.js';
import { makeColAcc } from './colacc.js';

// every group's discovery summary (tasks.js discoverGroup), in group order.
// `res` centroids are asked of the leading groups only: the reservoir is the
// first valid centroids, and the first group almost always holds them all.
export async function discoverParquet(urls, { file, meta, rowGroups, p, res, onProgress, signal }) {
  if (!rowGroups.length) return null;
  const pool = await startPool(urls, { file, meta, task: 'discover', p, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    let done = 0;
    return await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount, res: starts[g] < 4 * res ? res : 0 })
      .then((out) => { done += rg.rowCount; if (onProgress) onProgress(done); return out; })));
  } finally { pool.close(); }
}

// a declared lattice checked against every centroid → { bad }: the FIRST misfit
// in record order (the lowest group's first)
export async function checkLattice(urls, { file, meta, rowGroups, cols, grid, signal }) {
  if (!rowGroups.length) return null;
  const pool = await startPool(urls, { file, meta, task: 'check', p: { cols, grid }, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    const outs = await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount })));
    return { bad: (outs.find((o) => o.bad) || { bad: null }).bad };
  } finally { pool.close(); }
}

// the render decode (tasks.js decodeGroup) on a 'decode' pool the caller started,
// yielded IN ROW-GROUP ORDER with at most one group in flight per worker
// (bounded memory); closes the pool when the stream ends or is abandoned
export async function* decodeParquet(pool, rowGroups) {
  const starts = groupStarts(rowGroups), inflight = [];
  let next = 0;
  const fill = () => { while (next < rowGroups.length && inflight.length < pool.size) { const g = next++; const pr = pool.run({ start: starts[g], count: rowGroups[g].rowCount }); pr.catch(() => {}); inflight.push(pr); } };
  try {
    fill();
    while (inflight.length) {
      const out = await inflight.shift();
      fill();
      yield out;
    }
  } finally { pool.close(); }
}

// `cols` ([{ name, num }]) of a Parquet file, row groups handed out one at a
// time → the merged accumulator states (colacc.js), one per column, in order.
export async function parquetStats(urls, sluice, { file, meta, rowGroups, cols, signal, onProgress, maxWorkers }) {
  if (!rowGroups.length) return null;
  const pool = await startPool(urls, { file, meta, task: 'stats', p: { cols }, n: maxWorkers || defaultPoolSize(rowGroups.length), signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    let done = 0;
    await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount }).then(({ count }) => { done += count; if (onProgress) onProgress(done); })));
    const acc = makeColAcc(sluice);
    const merged = cols.map((c) => acc.create(c.num));
    for (const st of await pool.finish()) st.forEach((s, k) => acc.merge(merged[k], s));
    return merged;
  } finally { pool.close(); }
}
