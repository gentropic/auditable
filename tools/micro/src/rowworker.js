// micro rowworker — a Parquet model's ONE-ROW reads (the pick, the record panel,
// the record's position) off the page.
//
// One row of a Parquet file costs its whole row group: hyparquet decodes each
// column chunk up to the row (a chunk is usually one page), ~0.3 s for a
// million-row group — and that ran on the page, so every click froze it. Here a
// worker does the read, and keeps the group it decoded, so the next click in
// the same group is immediate. The worker goes away after a minute without a
// read (and its group with it); a new read starts it again.
//
// parquetRow(P, rec) → { name: value } | null — P is the layer's blockDoc.parquet
// ({ buf, meta, names, rowGroups }). Same values as readParquetRow (int64 → Number).
// Where a worker can't start (file://), the page reads, as before.
import { readParquetRow } from '../../../ext/parquet/index.js';
import { libUrl, groupStarts } from './pqpool.js';

const IDLE_MS = 60000;
const CACHE_CELLS = 16_000_000;                             // rows × columns kept decoded at most (one group)
const _readers = new WeakMap();                             // P → reader

function workerSource() {
  return `import * as Q from ${JSON.stringify(libUrl('parquet', '../../../ext/parquet/index.js'))};
let file = null, meta = null, names = null, starts = null, cap = 0, cache = null;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') { ({ file, meta, names, starts, cap } = data); self.postMessage({ type: 'ready' }); return; }
  const i = data.i;
  try {
    let lo = 0, hi = starts.length - 2;                     // the group holding row i
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= i) lo = m; else hi = m - 1; }
    const s = starts[lo], e = starts[lo + 1];
    if (i < s || i >= e) { self.postMessage({ id: data.id, row: null }); return; }
    if (!cache || cache.g !== lo) {
      if ((e - s) * names.length > cap) {                   // too big to keep: the one row
        cache = null;
        const row = await Q.readParquetRow(file, i, meta);
        self.postMessage({ id: data.id, row }); return;
      }
      cache = null;
      cache = { g: lo, s, cols: await Q.readParquetRange(file, names, s, e, meta) };
    }
    const row = {};
    for (const n of names) row[n] = cache.cols[n][i - s];
    self.postMessage({ id: data.id, row });
  } catch (err) { self.postMessage({ id: data.id, error: (err && err.message) || String(err) }); }
};
`;
}

async function startReader(P) {
  if (typeof Worker === 'undefined') return null;
  let url, w;
  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    w = new Worker(url, { type: 'module' });
  } catch { if (url) URL.revokeObjectURL(url); return null; }
  const starts = [...groupStarts(P.rowGroups), P.rowGroups.reduce((t, rg) => t + rg.rowCount, 0)];
  const ok = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    w.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(t); res(true); } };
    w.onerror = (e) => { e.preventDefault(); clearTimeout(t); res(false); };
    try { w.postMessage({ type: 'init', file: P.buf, meta: P.meta, names: P.names, starts, cap: CACHE_CELLS }); } catch { clearTimeout(t); res(false); }
  });
  URL.revokeObjectURL(url);
  if (!ok) { w.terminate(); return null; }
  const waiting = new Map();
  let seq = 0, idle = null, dead = false;
  const fail = (msg) => { dead = true; for (const [, f] of waiting) f.reject(new Error(msg)); waiting.clear(); };
  w.onmessage = ({ data }) => {
    const f = waiting.get(data.id); if (!f) return;
    waiting.delete(data.id);
    if (data.error) f.reject(new Error(data.error)); else f.resolve(data.row);
  };
  w.onerror = (e) => { e.preventDefault(); fail(e.message || 'row reader failed'); };
  const r = {
    get dead() { return dead; },
    read(i) {
      clearTimeout(idle);
      idle = setTimeout(() => { if (!waiting.size) { dead = true; w.terminate(); _readers.delete(P); } }, IDLE_MS);
      return new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); w.postMessage({ id, i }); });
    },
  };
  return r;
}

export async function parquetRow(P, rec) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let rp = _readers.get(P);
    if (!rp) { rp = startReader(P); _readers.set(P, rp); }
    const r = await rp;
    if (!r) break;                                          // no workers here (kept as null: not retried)
    if (r.dead) { _readers.delete(P); continue; }           // idled out: start a fresh one
    try { return await r.read(rec); } catch { _readers.delete(P); break; }   // failed: the page reads this one
  }
  return readParquetRow(P.buf, rec, P.meta);
}
