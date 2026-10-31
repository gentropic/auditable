// micro colscan — the analysis windows' scans, COLUMNAR and parallel.
//
// A tool hands over the expressions it needs and a kernel (src/kernels.js); the
// planner works out the dependency cone once: which Parquet columns to read (and
// only those), which calc columns to evaluate in what order, which page-resident
// columns (painted codes, materialized values) are involved. Then every row group
// is one job: on the worker pool (src/pqpool.js) when workers run here, or on the
// page one group per task when they can't (file://) — the same view and the same
// kernel either way. Partials merge IN GROUP ORDER, so the answer is the same
// with or without workers, run to run.
//
// Parquet only here: rows ARE records (blockCaps.rowIsRecord), so a group's start
// offset is its first record. (.dm page runs join as a second source; CSV keeps
// the row path.)
import { readParquetRange } from '../../../ext/parquet/index.js';
import { startParquetPool, defaultPoolSize, groupStarts } from './pqpool.js';
import * as CV from './chunkview.js';
import * as kernels from './kernels.js';
import { layerTableHeader, schemaExt, calcOrder } from './records.js';
import { chunkSpecOf, chunkPageOf, expandedDeps, ensureStoredValues } from './columns.js';
import * as E from '../../../ext/expr/index.js';
import * as sluice from '../../../ext/sluice/index.js';
const { parse } = E;

export function canScanColumnar(L) { return !!(L && L.docs && L.docs.blockDoc && L.docs.blockDoc.parquet); }

// exprs: the expression TEXTS the job evaluates (their columns are what's read);
// extraCols: base column names read regardless (coordinates, sub-block dims);
// mask: a per-record scope mask or null; onProgress(done, total, where);
// skipGroup(g, rowGroup) → true skips a group unread (footer pushdown);
// onPart(g, part, start): each partial handed over IN GROUP ORDER as soon as
// the groups before it are in, then dropped (a filter's matches needn't all be
// held) — without it the partials come back in `parts`. onPart may return a
// promise: the next job isn't sent until it settles (BACKPRESSURE — a slow
// consumer holds at most a few groups, never the whole model).
export async function scanColumnar(L, { kernel, params, exprs, extraCols = [], mask = null, onProgress = null, signal = null, skipGroup = null, onPart = null }) {
  const bd = L.docs.blockDoc, P = bd.parquet, h = layerTableHeader(L);
  const needL = new Set(extraCols.map((c) => String(c).toLowerCase()));
  for (const x of exprs) { if (!x) continue; let ast; try { ast = parse(x); } catch { continue; } for (const d of expandedDeps(L, ast)) needL.add(d); }
  await ensureStoredValues(L, needL);                       // materialized inputs resident (evicted → blanks otherwise)
  const readCols = P.names.filter((n) => needL.has(String(n).toLowerCase()));
  const schema = schemaExt(L, h);
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  const calcs = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase())).map((it) => ({ slot: baseLen + paintLen + it.idx, expr: it.c.expr }));
  const spec = chunkSpecOf(L, h, needL);
  const kp = { ...params, schema };
  const K = kernels[kernel + 'Kernel'];
  const rowGroups = P.rowGroups, starts = groupStarts(rowGroups);
  const keep = rowGroups.map((rg, g) => !(skipGroup && skipGroup(g, rg)));
  const todo = rowGroups.map((rg, g) => g).filter((g) => keep[g]);
  const total = todo.reduce((t, g) => t + rowGroups[g].rowCount, 0);
  const parts = new Array(rowGroups.length);
  let done = 0, next = 0, chain = Promise.resolve();
  const deliver = () => (chain = chain.then(async () => {  // hand over everything ready, in group order, one at a time
    if (!onPart) return;
    while (next < rowGroups.length && (!keep[next] || parts[next] !== undefined)) {
      const g = next++;
      if (keep[g]) { const part = parts[g]; parts[g] = null; await onPart(g, part, starts[g]); }
    }
  }));
  if (!todo.length) { if (onProgress) onProgress(0, 0, 'nothing to read'); return { parts, where: 'nothing to read', workers: 0, skipped: rowGroups.length }; }
  const pool = await startParquetPool({ file: P.buf, meta: P.meta, task: 'scan', p: { kernel, params: kp, calcs, spec, readCols }, n: defaultPoolSize(todo.length), signal });
  const where = pool ? `on ${pool.size} worker${pool.size === 1 ? '' : 's'}` : 'on this page';
  if (onProgress) onProgress(0, total, where);
  const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
  try {
    if (pool) {
      // at most two jobs per worker in flight: the page slices are copied as
      // jobs go out, not all at once, and out-of-order partials stay few
      let qi = 0;
      const feed = async () => {
        while (qi < todo.length) {
          if (signal && signal.aborted) throw abort();
          const g = todo[qi++], start = starts[g], count = rowGroups[g].rowCount;
          const page = chunkPageOf(L, spec, start, count, { copy: true });
          const m = mask ? mask.slice(start, start + count) : null;
          const transfer = [...page.filter(Boolean).map((a2) => a2.buffer), ...(m ? [m.buffer] : [])];
          parts[g] = await pool.run({ start, count, page, mask: m, transfer });
          done += count; if (onProgress) onProgress(done, total, where);
          await deliver();
        }
      };
      await Promise.all(Array.from({ length: Math.min(todo.length, pool.size * 2) }, feed));
    } else {
      const k = K(E, CV, sluice);
      const ctx = k.init(kp, calcs);
      for (const g of todo) {
        if (signal && signal.aborted) throw abort();
        const start = starts[g], count = rowGroups[g].rowCount;
        const cols = readCols.length ? await readParquetRange(P.buf, readCols, start, start + count, P.meta) : {};
        const view = CV.chunkView(spec, cols, chunkPageOf(L, spec, start, count), count, ctx.calcFns);
        parts[g] = k.group(ctx, view, count, mask ? mask.subarray(start, start + count) : null);
        done += count; if (onProgress) onProgress(done, total, where);
        await deliver();
        await new Promise((z) => setTimeout(z));             // one group per task: the page stays live
      }
    }
  } finally { if (pool) pool.close(); }
  return { parts, where, workers: pool ? pool.size : 0, skipped: rowGroups.length - todo.length };
}
