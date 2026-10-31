// @gcu/scan pool — module workers over ONE file, for the jobs that read a whole
// model: column statistics, a Parquet open's discovery sweep and render decode,
// a declared lattice's check, and the analysis SCANS. Each job is one unit (a
// row group, a .dm page run, a delimited run).
//
// Each worker is `import { serve } from <the worker bundle>; serve(self, load)`, and
// gets its libraries' URLs at init (urls: { worker, parquet, sluice, condenser,
// expr }). Where workers can't start (file://, where a blob worker can't import
// the page's blob modules; an old browser; a clone failure), startPool resolves
// null and the caller does the work on the page.

const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

export function defaultPoolSize(units) {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(units, 6, hc - 1));
}
export const groupStarts = (rowGroups) => { const s = []; let a = 0; for (const rg of rowGroups) { s.push(a); a += rg.rowCount; } return s; };

// Start `n` workers on `file` for one task. Resolves to a pool, or null when
// workers can't run here. pool.run(job) → the job's result (a FIFO queue feeds
// free workers); pool.finish() → each worker's final payload; pool.close().
export async function startPool(urls, { file, meta = null, task, p, n, signal = null }) {
  if (typeof Worker === 'undefined' || !(n >= 1) || !urls || !urls.worker) return null;
  const libs = { parquet: urls.parquet, sluice: urls.sluice, condenser: urls.condenser, expr: urls.expr };
  let url;
  try { url = URL.createObjectURL(new Blob([`import { serve } from ${JSON.stringify(urls.worker)};\nserve(self, (u) => import(u));\n`], { type: 'text/javascript' })); } catch { return null; }
  const workers = [];
  const close = () => { for (const w of workers) w.terminate(); workers.length = 0; };
  try {
    const ready = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(url, { type: 'module' });
      workers.push(w);
      ready.push(new Promise((res) => {
        const t = setTimeout(() => res(false), 15000);
        w.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(t); res(true); } else if (data.type === 'error') { clearTimeout(t); res(false); } };
        w.onerror = (e) => { e.preventDefault(); clearTimeout(t); res(false); };
      }));
      w.postMessage({ type: 'init', file, meta, task, p, libs });
    }
    if (!(await Promise.all(ready)).every(Boolean)) { close(); return null; }
  } catch { close(); return null; } finally { URL.revokeObjectURL(url); }

  const free = [...workers], queue = [], pending = new Map();
  let nextId = 0, failed = null;
  const fail = (err) => {
    if (failed) return;
    failed = err;
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    for (const q of queue) q.reject(err);
    queue.length = 0;
  };
  if (signal) { if (signal.aborted) fail(abortError()); else signal.addEventListener('abort', () => fail(abortError()), { once: true }); }
  const pump = () => {
    while (free.length && queue.length) {
      const w = free.pop(), q = queue.shift();
      pending.set(q.id, { ...q, w });
      w.postMessage({ type: 'job', id: q.id, ...q.job }, q.job.transfer || []);
    }
  };
  for (const w of workers) {
    w.onmessage = ({ data }) => {
      if (data.type === 'result') {
        const q = pending.get(data.id);
        if (!q) return;
        pending.delete(data.id); free.push(w); q.resolve(data.out); pump();
      } else if (data.type === 'error') fail(new Error(data.message));
    };
    w.onerror = (e) => { e.preventDefault(); fail(new Error(e.message || 'scan worker failed')); };
  }
  return {
    size: workers.length,
    run(job) {
      if (failed) return Promise.reject(failed);
      return new Promise((resolve, reject) => { queue.push({ id: nextId++, job, resolve, reject }); pump(); });
    },
    // every worker's final payload (the stats states); call once all runs settled
    finish() {
      if (failed) return Promise.reject(failed);
      return Promise.all(workers.map((w) => new Promise((resolve, reject) => {
        w.onmessage = ({ data }) => { if (data.type === 'final') resolve(data.out); else if (data.type === 'error') reject(new Error(data.message)); };
        w.postMessage({ type: 'finish' });
      })));
    },
    close,
  };
}
