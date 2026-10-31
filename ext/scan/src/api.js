// @gcu/scan api — createScan binds the libraries and the worker URLs once.
//
//   const scan = createScan({
//     deps: { parquet, condenser, expr, sluice },        // the modules, for the page
//     urls: { worker, parquet, condenser, expr, sluice }, // where a worker imports them
//   });
//
// Neither bundle imports anything: index.js (the page) gets its libraries here,
// worker.js gets theirs as URLs at a worker's init. That is what keeps the
// package registry- and file://-friendly, and testable in Node by injection.
// Without urls.worker (or without Worker) every job runs on the page.
import { run } from './run.js';
import { parquetSource, delimitedSource, dmSource } from './sources.js';
import { zoneKeep } from './zones.js';
import { startPool } from './pool.js';
import { discoverParquet, checkLattice, decodeParquet, parquetStats } from './parquet-jobs.js';
import { makeColAcc } from './colacc.js';
import { discoverGroup, decodeGroup } from './tasks.js';

export function createScan({ deps, urls = {} } = {}) {
  const D = deps || {};
  for (const k of ['parquet', 'condenser', 'expr', 'sluice']) if (!D[k]) throw new Error(`createScan: deps.${k} is required`);
  return {
    run: (job) => run(D, urls, job),
    sources: {
      parquet: (P, readCols) => parquetSource(D, P, readCols),
      delimited: (blob, h, o, readCols, opts) => delimitedSource(D, blob, h, o, readCols, opts),
      dm: (blob, dmh, names, readCols) => dmSource(D, blob, dmh, names, readCols),
    },
    zoneKeep: (zs, opts) => zoneKeep(D, zs, opts),
    startPool: (opts) => startPool(urls, opts),
    discoverParquet: (opts) => discoverParquet(urls, opts),
    checkLattice: (opts) => checkLattice(urls, opts),
    decodeParquet,
    parquetStats: (opts) => parquetStats(urls, D.sluice, opts),
    colAcc: () => makeColAcc(D.sluice),
    // the tasks, for a page that runs them itself (where workers can't)
    discoverGroup: (p, cols, count, res) => discoverGroup(D.condenser, p, cols, count, res),
    decodeGroup: (p, cols, start, count, codes) => decodeGroup(D.condenser, p, cols, start, count, codes),
  };
}
