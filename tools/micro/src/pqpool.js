// micro pqpool — a pool of module workers over ONE Parquet file, for the jobs
// that read a whole model: column statistics, the open's discovery sweep, the
// open's render decode, and the analysis SCANS (a kernel from src/kernels.js over
// the chunk view from src/chunkview.js — src/colscan.js drives them). Each job is
// one row group.
//
// The worker bodies are SELF-CONTAINED functions embedded with toString(), so
// they can't close over this module: what they need comes in through init.
// Where workers can't start (file://, where they can't import the page's blob
// modules; an old browser; a clone failure), startParquetPool resolves null and
// the caller does the work on the page, as before.
import { readParquetRange } from '../../../ext/parquet/index.js';
import * as sluice from '../../../ext/sluice/index.js';
import * as expr from '../../../ext/expr/index.js';
import * as chunkview from './chunkview.js';
import * as kernels from './kernels.js';

// keep the libraries reachable from this module's graph (the worker imports
// them by URL; the static imports keep the build's registry entries honest)
void readParquetRange; void sluice; void expr; void chunkview; void kernels;

// where a library lives, for a worker to import: the built file maps '#name'
// to a blob URL in its import map; the dev tree has no such entry, so the
// path relative to this module is the answer there
function libUrl(name, devRel) {
  try { const u = import.meta.resolve('#' + name); if (/^(blob|https?|file):/.test(u)) return u; } catch { /* not mapped */ }
  return new URL(devRel, import.meta.url).href;
}

export function defaultPoolSize(groups) {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(groups, 6, hc - 1));
}

// ── the discovery job: what the open's sweep collects, for one row group ──────
// Must give, merged in group order, exactly what the page's sequential sweep
// gives: per-axis distinct centroids rounded to 10 digits (capped), bbox, the
// category values (capped at 257, as the page's `size <= 256` add), the
// smallest size per axis and the distinct size keys, and the first `res`
// valid centroids.
export function discoverGroup(p, cols, count, res) {
  const r10 = (v) => Number(v.toPrecision(10));
  const dimKey = (a, b, c) => `${r10(a)},${r10(b)},${r10(c)}`;   // = condenser grid/infer.js dimKey
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], C = p.catN ? cols[p.catN] : null;
  const DX = p.dN ? cols[p.dN[0]] : null, DY = p.dN ? cols[p.dN[1]] : null, DZ = p.dN ? cols[p.dN[2]] : null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const ax = [new Set(), new Set(), new Set()], seen = [new Set(), new Set(), new Set()];
  const cats = C ? new Set() : null, dims = DX ? new Set() : null, minDim = [Infinity, Infinity, Infinity];
  const out = res > 0 ? new Float64Array(res * 3) : null;
  let nres = 0, valid = 0;
  const add = (a, v) => {
    if (ax[a].size >= p.cap) return;
    const s = seen[a];
    if (s.size < p.cap * 4) { if (s.has(v)) return; s.add(v); }
    ax[a].add(r10(v));
  };
  for (let i = 0; i < count; i++) {
    const xv = +X[i], yv = +Y[i], zv = +Z[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    valid++;
    if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
    if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
    if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
    add(0, xv); add(1, yv); add(2, zv);
    if (nres < res) { out[nres * 3] = xv; out[nres * 3 + 1] = yv; out[nres * 3 + 2] = zv; nres++; }
    if (cats && cats.size <= 256) { const v = C[i]; if (v != null && v !== '') cats.add(String(v)); }
    if (DX) {
      const dx = +DX[i], dy = +DY[i], dz = +DZ[i];
      if (dx > 0 && dy > 0 && dz > 0) {
        if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
        if (dims.size <= p.dimMax) dims.add(dimKey(dx, dy, dz));
      }
    }
  }
  return {
    valid, min, max, ax: ax.map((s) => [...s]),
    cats: cats ? [...cats] : null, dims: dims ? [...dims] : null, minDim,
    res: out ? out.subarray(0, nres * 3) : null,
  };
}

// ── the decode job: one row group as the chunk builder's typed arrays ─────────
// Same conversion as the page's streamChunks (openParquetBlocks).
export function decodeGroup(p, cols, start, count, codes) {
  const r10 = (v) => Number(v.toPrecision(10));
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], CH = p.chanN ? cols[p.chanN] : null, CA = p.catN ? cols[p.catN] : null;
  const DX = p.sizeN ? cols[p.sizeN[0]] : null, DY = p.sizeN ? cols[p.sizeN[1]] : null, DZ = p.sizeN ? cols[p.sizeN[2]] : null;
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
  const cat = codes.cat ? new Uint8Array(count) : null, dim = codes.dim ? new Uint8Array(count) : null, recIdx = new Uint32Array(count);
  const memo = new Map();
  const dimCode = (dx, dy, dz) => {
    let my = memo.get(dx); if (!my) memo.set(dx, my = new Map());
    let mz = my.get(dy); if (!mz) my.set(dy, mz = new Map());
    let c = mz.get(dz); if (c === undefined) mz.set(dz, c = codes.dim.get(`${r10(dx)},${r10(dy)},${r10(dz)}`) ?? 0);
    return c;
  };
  // a row without a usable centroid isn't drawn; record numbers stay RAW
  let m = 0;
  for (let i = 0; i < count; i++) {
    const xv = +X[i], yv = +Y[i], zv = +Z[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    x[m] = xv; y[m] = yv; z[m] = zv;
    chan[m] = CH ? +CH[i] : 0;
    if (cat) cat[m] = codes.cat.get(String(CA[i] ?? '')) ?? 0;
    if (dim) dim[m] = dimCode(+DX[i], +DY[i], +DZ[i]);
    recIdx[m++] = start + i;
  }
  // trimmed copies, not views: the transfer list moves whole buffers
  const cut = (a) => (a && m < count ? a.slice(0, m) : a);
  return { count: m, x: cut(x), y: cut(y), z: cut(z), chan: cut(chan), cat: cut(cat), dim: cut(dim), recIdx: cut(recIdx), recStart: start };
}

function workerSource(makeColAcc) {
  return `import * as PQ from ${JSON.stringify(libUrl('parquet', '../../../ext/parquet/index.js'))};
import * as SL from ${JSON.stringify(libUrl('sluice', '../../../ext/sluice/index.js'))};
const makeColAcc = ${makeColAcc.toString()};
const discoverGroup = ${discoverGroup.toString()};
const decodeGroup = ${decodeGroup.toString()};
let file = null, meta = null, task = null, p = null, st = null, acc = null, codes = null, misfit = null;
let CV = null, kern = null, kctx = null, CD = null;
// every ArrayBuffer under a result, for the transfer list (a scan partial's bins)
const buffersOf = (o, out = []) => {
  if (o && ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); }
  else if (Array.isArray(o)) for (const x of o) buffersOf(x, out);
  else if (o && typeof o === 'object') for (const k in o) buffersOf(o[k], out);
  return out;
};
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      ({ file, meta, task, p } = data);
      // the lattice check runs condenser's own latticeMisfit, imported only here
      if (task === 'check') misfit = (await import(${JSON.stringify(libUrl('condenser', '../../../ext/condenser/src/main.js'))})).latticeMisfit;
      if (task === 'stats') { acc = makeColAcc(SL); st = p.cols.map((c) => acc.create(c.num)); }
      if (task === 'scan') {
        const [E, cv, K] = await Promise.all([
          import(${JSON.stringify(libUrl('expr', '../../../ext/expr/index.js'))}),
          import(${JSON.stringify(libUrl('chunkview', './chunkview.js'))}),
          import(${JSON.stringify(libUrl('kernels', './kernels.js'))}),
        ]);
        CV = cv; kern = K[p.kernel + 'Kernel'](E, CV, SL); kctx = kern.init(p.params, p.calcs);
        // a .dm source: condenser's run reader (fields decoded by striding)
        if (p.source && p.source.kind === 'dm') CD = await import(${JSON.stringify(libUrl('condenser', '../../../ext/condenser/src/main.js'))});
      }
      if (task === 'decode') codes = {
        cat: p.categories ? new Map(p.categories.map((v, i) => [v, i])) : null,
        dim: p.dimKeys ? new Map(p.dimKeys.map((k, i) => [k, i])) : null,
      };
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'job') {
      const { id, start, count } = data;
      if (task === 'stats') {
        // one column at a time: a whole group's columns at once is a bigger heap
        for (let k = 0; k < p.cols.length; k++) {
          const name = p.cols[k].name;
          const arr = (await PQ.readParquetRange(file, [name], start, start + count, meta))[name];
          if (p.cols[k].num) for (let a = 0; a < count; a += 65536) acc.pushNumbers(st[k], arr, a, Math.min(count, a + 65536));
          else for (let i = 0; i < count; i++) acc.pushText(st[k], arr[i]);
        }
        self.postMessage({ type: 'result', id, out: { count } });
      } else if (task === 'discover') {
        const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
        const out = discoverGroup(p, cols, count, data.res || 0);
        self.postMessage({ type: 'result', id, out }, out.res ? [out.res.buffer] : []);
      } else if (task === 'check') {
        // the first centroid in this group off the declared lattice (records RAW)
        const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
        const X = cols[p.cols[0]], Y = cols[p.cols[1]], Z = cols[p.cols[2]];
        let bad = null;
        for (let i = 0; i < count && !bad; i++) { const xv = +X[i], yv = +Y[i], zv = +Z[i]; if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) bad = misfit(p.grid, xv, yv, zv, start + i); }
        self.postMessage({ type: 'result', id, out: { bad } });
      } else if (task === 'scan') {
        // the needed columns of this group → the chunk view → the kernel's partial
        let cols = {};
        if (p.readCols.length && p.source && p.source.kind === 'dm') {
          const r = await CD.readDmRun(file, p.source.h, p.source.idx, data.run);
          p.readCols.forEach((n, k) => { cols[n] = r.cols[p.source.idx[k]]; });
        } else if (p.readCols.length) cols = await PQ.readParquetRange(file, p.readCols, start, start + count, meta);
        const view = CV.chunkView(p.spec, cols, data.page || [], count, kctx.calcFns);
        const out = kern.group(kctx, view, count, data.mask || null);
        self.postMessage({ type: 'result', id, out }, buffersOf(out));
      } else if (task === 'decode') {
        const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
        const out = decodeGroup(p, cols, start, count, codes);
        const tr = [out.x.buffer, out.y.buffer, out.z.buffer, out.chan.buffer, out.recIdx.buffer];
        if (out.cat) tr.push(out.cat.buffer); if (out.dim) tr.push(out.dim.buffer);
        self.postMessage({ type: 'result', id, out }, tr);
      }
    } else if (data.type === 'finish') {
      self.postMessage({ type: 'final', out: task === 'stats' ? st : null });
    }
  } catch (e) { self.postMessage({ type: 'error', id: data && data.id, message: e && e.message || String(e) }); }
};
`;
}

const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

// Start `n` workers on `file` for one task. Resolves to a pool, or null when
// workers can't run here. pool.run(job) → the job's result (a FIFO queue feeds
// free workers); pool.finish() → each worker's final payload; pool.close().
export async function startParquetPool({ file, meta, task, p, n, makeColAcc, signal }) {
  if (typeof Worker === 'undefined' || !(n >= 1)) return null;
  let url;
  try { url = URL.createObjectURL(new Blob([workerSource(makeColAcc || (() => null))], { type: 'text/javascript' })); } catch { return null; }
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
      w.postMessage({ type: 'init', file, meta, task, p });
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
    w.onerror = (e) => { e.preventDefault(); fail(new Error(e.message || 'parquet worker failed')); };
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

// The open's discovery sweep on the pool: every group's summary, in group
// order. null → workers can't run here (the caller sweeps on the page).
// `res` centroids are asked of the leading groups only: the reservoir is the
// first valid centroids, and the first group almost always holds them all.
export async function discoverParquetInWorkers({ file, meta, rowGroups, p, res, onProgress, signal }) {
  if (!rowGroups.length) return null;
  const pool = await startParquetPool({ file, meta, task: 'discover', p, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    let done = 0;
    return await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount, res: starts[g] < 4 * res ? res : 0 })
      .then((out) => { done += rg.rowCount; if (onProgress) onProgress(done); return out; })));
  } finally { pool.close(); }
}

// A declared lattice checked against every centroid on the pool. → { bad }
// with the FIRST misfit in record order (the lowest group's first), the same
// message the page's sequential check gives; null → workers can't run here.
export async function checkLatticeInWorkers({ file, meta, rowGroups, cols, grid, signal }) {
  if (!rowGroups.length) return null;
  const pool = await startParquetPool({ file, meta, task: 'check', p: { cols, grid }, n: defaultPoolSize(rowGroups.length), signal });
  if (!pool) return null;
  try {
    const starts = groupStarts(rowGroups);
    const outs = await Promise.all(rowGroups.map((rg, g) => pool.run({ start: starts[g], count: rg.rowCount })));
    return { bad: (outs.find((o) => o.bad) || { bad: null }).bad };
  } finally { pool.close(); }
}

// The open's render decode on the pool, yielded IN ROW-GROUP ORDER with at most
// one group in flight per worker (bounded memory). The pool is the caller's;
// this closes it when the stream ends or is abandoned.
export async function* decodeParquetInWorkers(pool, rowGroups) {
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

export const groupStarts =(rowGroups) => { const s = []; let a = 0; for (const rg of rowGroups) { s.push(a); a += rg.rowCount; } return s; };
