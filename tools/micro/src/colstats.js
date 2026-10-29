// micro colstats — the per-column statistics accumulator, and a worker pool that
// runs it over a Parquet file's row groups off the main thread.
//
// makeColAcc is SELF-CONTAINED on purpose (no closure over this module): the
// pool embeds its source into the worker with toString(), so the page and the
// workers push values through one definition, and their states merge.
import { readParquetRange } from '../../../ext/parquet/index.js';
import * as sluice from '../../../ext/sluice/index.js';

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

// where a library lives, for a worker to import: the built file maps '#name'
// to a blob URL in its import map; the dev tree has no such entry, so the
// path relative to this module is the answer there
function libUrl(name, devRel) {
  try { const u = import.meta.resolve('#' + name); if (/^(blob|https?|file):/.test(u)) return u; } catch { /* not mapped */ }
  return new URL(devRel, import.meta.url).href;
}

// keep the parquet reader reachable from this module's graph (the worker
// imports it by URL; the static import keeps the build's registry entry honest)
void readParquetRange;

function workerSource() {
  return `import * as PQ from ${JSON.stringify(libUrl('parquet', '../../../ext/parquet/index.js'))};
import * as SL from ${JSON.stringify(libUrl('sluice', '../../../ext/sluice/index.js'))};
const makeColAcc = ${makeColAcc.toString()};
const acc = makeColAcc(SL);
let file = null, meta = null, cols = null, st = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      ({ file, meta, cols } = data);
      st = cols.map((c) => acc.create(c.num));
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'job') {
      const { start, count } = data;
      for (let k = 0; k < cols.length; k++) {
        const name = cols[k].name;
        const arr = (await PQ.readParquetRange(file, [name], start, start + count, meta))[name];
        if (cols[k].num) for (let a = 0; a < count; a += 65536) acc.pushNumbers(st[k], arr, a, Math.min(count, a + 65536));
        else for (let i = 0; i < count; i++) acc.pushText(st[k], arr[i]);
      }
      self.postMessage({ type: 'done', count });
    } else if (data.type === 'finish') {
      self.postMessage({ type: 'states', st });
    }
  } catch (e) { self.postMessage({ type: 'error', message: e && e.message || String(e) }); }
};
`;
}

// Scan `cols` ([{ name, num }]) of a Parquet file across a pool of workers,
// row groups handed out one at a time. Resolves to the merged states (one per
// column, in order), or null when workers can't run here (file://, an old
// browser, a clone failure) — the caller then scans on the main thread.
// onProgress(rowsDone); signal aborts (rejects with AbortError).
export async function scanParquetInWorkers({ file, meta, rowGroups, cols, signal, onProgress, maxWorkers }) {
  if (typeof Worker === 'undefined' || !rowGroups.length) return null;
  const n = Math.max(1, Math.min(rowGroups.length, maxWorkers || Math.max(1, Math.min(6, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1))));
  let url;
  try { url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' })); } catch { return null; }
  const workers = [];
  const kill = () => { for (const w of workers) w.terminate(); };
  try {
    // start every worker; any that fails to come up means the pool can't run here
    const ready = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(url, { type: 'module' });
      workers.push(w);
      ready.push(new Promise((res) => {
        const t = setTimeout(() => res(false), 15000);
        w.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(t); res(true); } else if (data.type === 'error') { clearTimeout(t); res(false); } };
        w.onerror = (e) => { e.preventDefault(); clearTimeout(t); res(false); };
      }));
      try { w.postMessage({ type: 'init', file, meta, cols }); } catch { kill(); return null; }
    }
    if (!(await Promise.all(ready)).every(Boolean)) { kill(); return null; }
    URL.revokeObjectURL(url);
    const starts = []; { let s = 0; for (const rg of rowGroups) { starts.push(s); s += rg.rowCount; } }
    let next = 0, done = 0;
    const acc = colAcc();
    const merged = cols.map((c) => acc.create(c.num));
    await new Promise((resolve, reject) => {
      let finished = 0;
      const onAbort = () => reject(Object.assign(new Error('scan cancelled'), { name: 'AbortError' }));
      if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
      const feed = (w) => {
        if (next < rowGroups.length) { const g = next++; w.postMessage({ type: 'job', start: starts[g], count: rowGroups[g].rowCount }); }
        else w.postMessage({ type: 'finish' });
      };
      for (const w of workers) {
        w.onmessage = ({ data }) => {
          if (data.type === 'done') { done += data.count; if (onProgress) onProgress(done); feed(w); }
          else if (data.type === 'states') {
            data.st.forEach((s, k) => acc.merge(merged[k], s));
            if (++finished === workers.length) resolve();
          } else if (data.type === 'error') reject(new Error(data.message));
        };
        w.onerror = (e) => { e.preventDefault(); reject(new Error(e.message || 'scan worker failed')); };
        feed(w);
      }
    });
    return merged;
  } finally { kill(); }
}
