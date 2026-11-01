// @gcu/scan parquet-jobs — a Parquet model's whole-file jobs: the open's
// discovery sweep, a declared lattice's check, the open's render decode (in
// row-group order, bounded), and the column statistics. Discovery, check and
// decode run on the pool when workers can, else on the page — the SAME per-group
// task either way (tasks.js), so the caller never keeps a copy of the loop.
// parquetStats still resolves null without workers (the caller's page scan also
// takes bands, which the pool doesn't).
import { startPool, defaultPoolSize, groupStarts, abortError } from './pool.js';
import { makeColAcc } from './colacc.js';
import { discoverGroup, checkGroup, decodeGroup, decodeCodes } from './tasks.js';

// the page path: a row group read at a time, a macrotask between groups (the UI
// paints, a cancel lands)
async function* pageGroups(D, { file, meta, rowGroups, cols, signal }) {
  const starts = groupStarts(rowGroups);
  for (let g = 0; g < rowGroups.length; g++) {
    if (signal && signal.aborted) throw abortError();
    const start = starts[g], count = rowGroups[g].rowCount;
    yield { start, count, cols: await D.parquet.readParquetRange(file, cols, start, start + count, meta) };
    await new Promise((r) => setTimeout(r));
  }
}

// every group's discovery summary (tasks.js discoverGroup), in group order.
// `res` centroids are asked of the leading groups only: the reservoir is the
// first valid centroids, and the first group almost always holds them all.
export async function discoverParquet(urls, D, { file, meta, rowGroups, p, res, onProgress, signal }) {
  if (!rowGroups.length) return [];
  const resAt = (start) => (start < 4 * res ? res : 0);
  let done = 0;
  const pool = await startPool(urls, { file, meta, task: 'discover', p, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) {
    const out = [];
    for await (const { start, count, cols } of pageGroups(D, { file, meta, rowGroups, cols: p.cols, signal })) {
      out.push(discoverGroup(D.condenser, p, cols, count, resAt(start)));
      done += count; if (onProgress) onProgress(done);
    }
    return out;
  }
  try {
    const starts = groupStarts(rowGroups);
    return await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount, res: resAt(starts[g]) })
      .then((out) => { done += rg.rowCount; if (onProgress) onProgress(done); return out; })));
  } finally { pool.close(); }
}

// a declared lattice checked against every centroid → { bad }: the FIRST misfit
// in record order (the lowest group's first). The page stops at the first.
export async function checkLattice(urls, D, { file, meta, rowGroups, cols, grid, signal }) {
  const p = { cols, grid };
  if (!rowGroups.length) return { bad: null };
  const pool = await startPool(urls, { file, meta, task: 'check', p, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) {
    for await (const g of pageGroups(D, { file, meta, rowGroups, cols, signal })) {
      const bad = checkGroup(D.condenser, p, g.cols, g.start, g.count);
      if (bad) return { bad };
    }
    return { bad: null };
  }
  try {
    const starts = groupStarts(rowGroups);
    const outs = await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount })));
    return { bad: (outs.find((o) => o.bad) || { bad: null }).bad };
  } finally { pool.close(); }
}

// the render decode (tasks.js decodeGroup), yielded IN ROW-GROUP ORDER. On the
// pool at most one group is in flight per worker (bounded memory), and the pool
// closes when the stream ends or is abandoned; on the page, a group at a time.
export async function* decodeParquet(urls, D, { file, meta, rowGroups, p, signal }) {
  const pool = rowGroups.length ? await startPool(urls, { file, meta, task: 'decode', p, n: defaultPoolSize(rowGroups.length), signal }) : null;
  if (!pool) {
    const codes = decodeCodes(p);
    for await (const g of pageGroups(D, { file, meta, rowGroups, cols: p.cols, signal })) yield decodeGroup(D.condenser, p, g.cols, g.start, g.count, codes);
    return;
  }
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
