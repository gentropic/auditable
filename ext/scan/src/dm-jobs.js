// @gcu/scan dm-jobs — a Datamine .dm's OPEN on the pool: the discovery sweep and the
// render decode, one unit (a run of whole pages — condenser dmOpenRuns) per job.
// The per-unit work is condenser's (dmDiscoverRun / dmDecodeRun — the same kernels
// its own one-thread runner calls), so the open's answer can't depend on who read
// it. Together these are a condenser dm RUNNER ({ discover, decode }, see
// condenser openDmModel's `runner`); without workers they fall back to that
// one-thread runner.
//
// ONE pool serves both sweeps: the open's discovery is followed, a moment later, by
// its decode of the same file, and starting a second set of workers cost a visible
// share of the open (~0.6 s of module loading on a 6-worker pool). After a
// discovery the pool is PARKED for that file + header; a decode of the same pair
// takes it, anything else (another file, the time running out) closes it.
import { startPool, defaultPoolSize, abortError } from './pool.js';

const PARK_MS = 15000;
let parked = null;                                         // { file, h, pool, timer }
const unpark = () => { if (!parked) return null; clearTimeout(parked.timer); const p = parked; parked = null; return p; };
function park(file, h, pool) {
  const old = unpark(); if (old) old.pool.close();
  const me = { file, h, pool, timer: null };
  me.timer = setTimeout(() => { if (parked === me) { parked = null; pool.close(); } }, PARK_MS);
  parked = me;
}
async function dmPool(urls, file, h, n) {
  const p = unpark();
  if (p && p.file === file && p.h === h) return p.pool;
  if (p) p.pool.close();
  return startPool(urls, { file, task: 'dmopen', p: { h }, n });
}

// every unit's discovery summary, in unit order (the caller merges in that order)
export async function discoverDm(urls, D, { file, h, p, units, onProgress, signal }) {
  if (!units.length) return [];
  const pool = await dmPool(urls, file, h, defaultPoolSize(units.length));
  globalThis.__dmOpenWorkers = pool ? pool.size : 0;       // smoke hook: who read the last open
  if (!pool) return D.condenser.dmPageRunner.discover({ file, h, p, units, onProgress, signal });
  let ok = false;
  try {
    let done = 0;
    const out = await Promise.all(units.map((u) => pool.run({ op: 'discover', k: p, run: u, res: u.res || 0 })
      .then((r) => { if (signal && signal.aborted) throw abortError(); done += u.count; if (onProgress) onProgress(done); return r; })));
    ok = true;
    return out;
  } finally { if (ok) park(file, h, pool); else pool.close(); }
}

// the decoded units, yielded IN UNIT ORDER. Two units in flight per worker (one
// decoding, one queued — the workers never wait on the page), bounded: a slow
// consumer holds a few units, never the model. The pool closes when the stream
// ends or is abandoned.
export async function* decodeDm(urls, D, { file, h, p, units, signal }) {
  const pool = units.length ? await dmPool(urls, file, h, defaultPoolSize(units.length)) : null;
  globalThis.__dmOpenWorkers = pool ? pool.size : 0;
  if (!pool) { yield* D.condenser.dmPageRunner.decode({ file, h, p, units, signal }); return; }
  const inflight = [];
  let next = 0;
  const fill = () => { while (next < units.length && inflight.length < pool.size * 2) { const pr = pool.run({ op: 'decode', k: p, run: units[next++] }); pr.catch(() => {}); inflight.push(pr); } };
  try {
    fill();
    while (inflight.length) {
      if (signal && signal.aborted) throw abortError();
      const out = await inflight.shift();
      fill();
      yield out;
    }
  } finally { pool.close(); }
}
