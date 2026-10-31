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
// Two SOURCES, one engine: a Parquet model's row groups, and a Datamine .dm's
// page RUNS (condenser dmPageRuns / readDmRun: ~4 MB of fixed-size pages, only
// the needed fields decoded by striding). Both number every record (rowIsRecord),
// so a unit's start is its first record. CSV keeps the row path.
import { readParquetRange } from '../../../ext/parquet/index.js';
import { dmPageRuns, readDmRun } from '../../../ext/condenser/src/main.js';
import { startParquetPool, defaultPoolSize, groupStarts } from './pqpool.js';
import * as CV from './chunkview.js';
import * as kernels from './kernels.js';
import { layerTableHeader, schemaExt, calcOrder } from './records.js';
import { chunkSpecOf, chunkPageOf, expandedDeps, ensureStoredValues } from './columns.js';
import * as E from '../../../ext/expr/index.js';
import * as sluice from '../../../ext/sluice/index.js';
const { parse } = E;

export function canScanColumnar(L) { const bd = L && L.docs && L.docs.blockDoc; return !!(bd && (bd.parquet || (bd.header && bd.header.dm))); }
// the units a source is read in, and how the page reads one (the workers read the
// same unit their own way — src/pqpool.js)
function sourceOf(L, readCols) {
  const bd = L.docs.blockDoc, h = layerTableHeader(L);
  if (bd.parquet) {
    const P = bd.parquet, starts = groupStarts(P.rowGroups);
    return {
      names: P.names, file: P.buf, meta: P.meta, desc: { kind: 'parquet' },
      units: P.rowGroups.map((rg, g) => ({ start: starts[g], count: rg.rowCount, rg })),
      read: (u) => readParquetRange(P.buf, readCols, u.start, u.start + u.count, P.meta),
    };
  }
  const dmh = bd.header.dm, idx = readCols.map((n) => h.columns.indexOf(n));
  return {
    names: h.columns, file: bd.blob, meta: null, desc: { kind: 'dm', h: dmh, idx },
    units: dmPageRuns(dmh).map((run) => ({ start: run.start, count: run.count, run })),
    read: async (u) => { const r = await readDmRun(bd.blob, dmh, idx, u.run); const o = {}; readCols.forEach((n, k) => { o[n] = r.cols[idx[k]]; }); return o; },
  };
}

// exprs: the expression TEXTS the job evaluates (their columns are what's read);
// extraCols: base column names read regardless (coordinates, sub-block dims);
// mask: a per-record scope mask or null; onProgress(done, total, where);
// skipGroup(g, unit) → true skips a unit unread (pushdown) — unit.rg is a
// Parquet row group's footer entry; every unit has { start, count };
// onPart(g, part, start): each partial handed over IN GROUP ORDER as soon as
// the groups before it are in, then dropped (a filter's matches needn't all be
// held) — without it the partials come back in `parts`. onPart may return a
// promise: the next job isn't sent until it settles (BACKPRESSURE — a slow
// consumer holds at most a few groups, never the whole model).
export async function scanColumnar(L, { kernel, params, exprs, extraCols = [], mask = null, onProgress = null, signal = null, skipGroup = null, onPart = null }) {
  const h = layerTableHeader(L);
  const needL = new Set(extraCols.map((c) => String(c).toLowerCase()));
  for (const x of exprs) { if (!x) continue; let ast; try { ast = parse(x); } catch { continue; } for (const d of expandedDeps(L, ast)) needL.add(d); }
  await ensureStoredValues(L, needL);                       // materialized inputs resident (evicted → blanks otherwise)
  const readCols = (L.docs.blockDoc.parquet ? L.docs.blockDoc.parquet.names : h.columns).filter((n) => needL.has(String(n).toLowerCase()));
  const src = sourceOf(L, readCols);
  const schema = schemaExt(L, h);
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  const calcs = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase())).map((it) => ({ slot: baseLen + paintLen + it.idx, expr: it.c.expr }));
  const spec = chunkSpecOf(L, h, needL);
  const kp = { ...params, schema };
  const K = kernels[kernel + 'Kernel'];
  const units = src.units;
  const keep = units.map((u, g) => !(skipGroup && skipGroup(g, u.rg || u)));
  const todo = units.map((u, g) => g).filter((g) => keep[g]);
  const total = todo.reduce((t, g) => t + units[g].count, 0);
  const parts = new Array(units.length);
  let done = 0, next = 0, chain = Promise.resolve();
  const deliver = () => (chain = chain.then(async () => {  // hand over everything ready, in group order, one at a time
    if (!onPart) return;
    while (next < units.length && (!keep[next] || parts[next] !== undefined)) {
      const g = next++;
      if (keep[g]) { const part = parts[g]; parts[g] = null; await onPart(g, part, units[g].start); }
    }
  }));
  if (!todo.length) { if (onProgress) onProgress(0, 0, 'nothing to read'); return { parts, where: 'nothing to read', workers: 0, skipped: units.length }; }
  const pool = await startParquetPool({ file: src.file, meta: src.meta, task: 'scan', p: { kernel, params: kp, calcs, spec, readCols, source: src.desc }, n: defaultPoolSize(todo.length), signal });
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
          const g = todo[qi++], start = units[g].start, count = units[g].count;
          const page = chunkPageOf(L, spec, start, count, { copy: true });
          const m = mask ? mask.slice(start, start + count) : null;
          const transfer = [...page.filter(Boolean).map((a2) => a2.buffer), ...(m ? [m.buffer] : [])];
          parts[g] = await pool.run({ start, count, run: units[g].run || null, page, mask: m, transfer });
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
        const start = units[g].start, count = units[g].count;
        const cols = readCols.length ? await src.read(units[g]) : {};
        const view = CV.chunkView(spec, cols, chunkPageOf(L, spec, start, count), count, ctx.calcFns);
        parts[g] = k.group(ctx, view, count, mask ? mask.subarray(start, start + count) : null);
        done += count; if (onProgress) onProgress(done, total, where);
        await deliver();
        await new Promise((z) => setTimeout(z));             // one group per task: the page stays live
      }
    }
  } finally { if (pool) pool.close(); }
  return { parts, where, workers: pool ? pool.size : 0, skipped: units.length - todo.length };
}
