// @gcu/scan run — a kernel over every unit of a source, COLUMNAR and parallel.
//
// The caller has planned the job: which columns to read (readCols — only those),
// the chunk view's spec, the calc columns in evaluation order (calcs), and how to
// slice the page-resident columns (painted codes, materialized values) for a unit
// (page). Every unit is one job: on the pool when workers run here, or on the
// page one unit per task when they can't (file://) — the same view and the same
// kernel either way. Partials come back IN UNIT ORDER, so the answer is the same
// with or without workers, run to run.
//
// D = { expr, sluice } (the page fallback's kernel); urls = the pool's (pool.js).
//
// job = {
//   source,                 sources.js
//   kernel, params,         a kernel name (kernels.js: '<name>Kernel') + its params
//   calcs, spec, readCols,  the plan
//   page(start, count, { copy }) → per-paint slices (null → none),
//   mask,                   a per-record scope mask or null
//   skipGroup(g, unit),     true skips a unit unread (pushdown; unit.rg is a
//                           Parquet row group's footer entry)
//   onPart(g, part, start), each partial IN UNIT ORDER as soon as the units before
//                           it are in, then dropped — without it they come back in
//                           `parts`. May return a promise: the next job waits for it
//                           (BACKPRESSURE — a slow consumer holds a few units, never
//                           the whole model)
//   onProgress(done, total, where), signal
// }
// → { parts, where, workers, skipped, zonesSkipped, zones }
import { startPool, defaultPoolSize } from './pool.js';
import * as kernels from './kernels.js';
import * as CV from './chunkview.js';

const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

export async function run(D, urls, { source: src, kernel, params, calcs = [], spec, readCols, page = null, mask = null, onProgress = null, signal = null, skipGroup = null, onPart = null }) {
  const K = kernels[kernel + 'Kernel'];
  if (!K) throw new Error(`scan: no kernel '${kernel}'`);
  const zs = src.zones;
  const zonesSkipped = zs ? zs.n - src.units.reduce((t, u) => t + Math.ceil(u.count / zs.k), 0) : 0;
  const units = src.units;
  const keep = units.map((u, g) => !(skipGroup && skipGroup(g, u.rg || u)));
  const todo = units.map((u, g) => g).filter((g) => keep[g]);
  const total = todo.reduce((t, g) => t + units[g].count, 0);
  const parts = new Array(units.length);
  const slice = (start, count, opts) => (page ? page(start, count, opts) : []);
  let done = 0, next = 0, chain = Promise.resolve();
  const deliver = () => (chain = chain.then(async () => {   // hand over everything ready, in unit order, one at a time
    if (!onPart) return;
    while (next < units.length && (!keep[next] || parts[next] !== undefined)) {
      const g = next++;
      if (keep[g]) { const part = parts[g]; parts[g] = null; await onPart(g, part, units[g].start); }
    }
  }));
  if (!todo.length) { if (onProgress) onProgress(0, 0, 'nothing to read'); return { parts, where: 'nothing to read', workers: 0, skipped: units.length, zonesSkipped, zones: zs ? zs.n : 0 }; }
  const pool = await startPool(urls, { file: src.file, meta: src.meta, task: 'scan', p: { kernel, params, calcs, spec, readCols, source: src.desc }, n: defaultPoolSize(todo.length), signal });
  const where = pool ? `on ${pool.size} worker${pool.size === 1 ? '' : 's'}` : 'on this page';
  if (onProgress) onProgress(0, total, where);
  try {
    if (pool) {
      // at most two jobs per worker in flight: the page slices are copied as
      // jobs go out, not all at once, and out-of-order partials stay few
      let qi = 0;
      const feed = async () => {
        while (qi < todo.length) {
          if (signal && signal.aborted) throw abort();
          const g = todo[qi++], start = units[g].start, count = units[g].count;
          const pg = slice(start, count, { copy: true });
          const m = mask ? mask.slice(start, start + count) : null;
          const transfer = [...pg.filter(Boolean).map((a2) => a2.buffer), ...(m ? [m.buffer] : [])];
          parts[g] = await pool.run({ start, count, run: units[g].run || null, page: pg, mask: m, transfer });
          done += count; if (onProgress) onProgress(done, total, where);
          await deliver();
        }
      };
      await Promise.all(Array.from({ length: Math.min(todo.length, pool.size * 2) }, feed));
    } else {
      const k = K(D.expr, CV, D.sluice);
      const ctx = k.init(params, calcs);
      for (const g of todo) {
        if (signal && signal.aborted) throw abort();
        const start = units[g].start, count = units[g].count;
        const cols = readCols.length ? await src.read(units[g]) : {};
        const view = CV.chunkView(spec, cols, slice(start, count), count, ctx.calcFns);
        parts[g] = k.group(ctx, view, count, mask ? mask.subarray(start, start + count) : null);
        done += count; if (onProgress) onProgress(done, total, where);
        await deliver();
        await new Promise((z) => setTimeout(z));             // one unit per task: the page stays live
      }
    }
  } finally { if (pool) pool.close(); }
  return { parts, where, workers: pool ? pool.size : 0, skipped: units.length - todo.length, zonesSkipped, zones: zs ? zs.n : 0 };
}
