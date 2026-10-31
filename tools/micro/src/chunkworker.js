// micro chunkworker — condenser's block chunk builder (Morton sort + LOD shuffle +
// packing) run OFF the page. The same builder, the same batches, the same seed, so
// the same chunks as building them on the page — only the page no longer freezes
// for the half second a 2M-block batch takes (the filter's compaction did, three or
// four times per filter on a big model).
//
// startChunkBuilder(opts) → { push(raw) → Promise?, flush() → Promise<doc>, close(), offPage, workers }
// opts: createBlockChunkBuilder's { frame, grid, dimPalette, chunkSize, batchSize,
// seed, seedPerBatch } + onChunk(chunk). With one worker, push() TRANSFERS raw's
// arrays (the caller must not reuse them). Where a worker can't start (file://, an
// old browser), the page builds as before (offPage false), behind the same async face.
//
// opts.workers > 1 (needs seedPerBatch): SEVERAL workers, one Morton BATCH each.
// The page gathers records into batches exactly where the builder would cut them
// (copying, so raw arrays are left alone), a worker turns each into its chunks
// (condenser buildBlockBatch, the batch's own seed), and the chunks are handed on
// in BATCH ORDER — so the chunks, and their order, are the page builder's. push()
// then returns a promise while enough batches are in flight (backpressure: a few
// batches held, never the model).
import { createBlockChunkBuilder } from '../../../ext/condenser/src/main.js';
import { libUrl } from './pqpool.js';

const buffersOf = (o, out = []) => {
  if (o && ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); }
  else if (Array.isArray(o)) for (const x of o) buffersOf(x, out);
  else if (o && typeof o === 'object') for (const k in o) buffersOf(o[k], out);
  return out;
};

function workerSource() {
  return `import * as C from ${JSON.stringify(libUrl('condenser', '../../../ext/condenser/src/main.js'))};
const buffersOf = ${buffersOf.toString()};
let b = null, o = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'batch') {                           // parallel mode: one whole batch → its chunks
      const chunks = C.buildBlockBatch(data.cols, data.n, { grid: o.grid, frame: o.frame, dimPalette: o.dimPalette, chunkSize: o.chunkSize, rnd: C.mulberry32(C.batchSeed(o.seed, data.k)) });
      self.postMessage({ type: 'batch', k: data.k, chunks }, buffersOf(chunks));
    } else if (data.type === 'initBatch') { o = data.o; self.postMessage({ type: 'ready' }); }
    else if (data.type === 'init') {
      b = C.createBlockChunkBuilder({ ...data.o, onChunk: (c) => self.postMessage({ type: 'chunk', c }, buffersOf(c)) });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'push') b.push(data.raw);
    else if (data.type === 'flush') { const doc = b.flush(); self.postMessage({ type: 'flushed', doc }); }
  } catch (e) { self.postMessage({ type: 'error', message: e && e.message || String(e) }); }
};
`;
}

// one module worker, initialised (type 'init' | 'initBatch') → the worker, or null
async function spawn(type, o) {
  let url, w;
  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    w = new Worker(url, { type: 'module' });
  } catch { if (url) URL.revokeObjectURL(url); return null; }
  const ok = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    w.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(t); res(true); } else if (data.type === 'error') { clearTimeout(t); res(false); } };
    w.onerror = (e) => { e.preventDefault(); clearTimeout(t); res(false); };
    try { w.postMessage({ type, o }); } catch { clearTimeout(t); res(false); }
  });
  URL.revokeObjectURL(url);
  if (!ok) { w.terminate(); return null; }
  return w;
}

async function startParallel(o, K, onChunk, onPage) {
  const ws = (await Promise.all(Array.from({ length: K }, () => spawn('initBatch', o)))).filter(Boolean);
  if (!ws.length) return onPage();
  const batchN = o.batchSize || o.chunkSize * 4;
  const doc = { count: 0, bboxLocal: Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity), chanRange: [Infinity, -Infinity] };
  let pend = [], pendCount = 0, k = 0, next = 0, closed = false, failure = null;
  const done = new Map(), free = [...ws], queue = [];
  let waiters = [], flushWaiter = null;
  const inFlight = () => k - next;                         // batches cut but not yet handed on
  const wake = () => {
    if (failure) { for (const r of waiters) r.reject(failure); waiters = []; if (flushWaiter) flushWaiter.reject(failure); return; }
    if (inFlight() < ws.length * 2) { for (const r of waiters) r.resolve(); waiters = []; }
    if (flushWaiter && !pendCount && next === k) { const f = flushWaiter; flushWaiter = null; f.resolve(doc); }
  };
  const deliver = () => {
    while (done.has(next)) {
      const chunks = done.get(next); done.delete(next); next++;
      for (const c of chunks) {
        doc.count += c.count;
        const b = doc.bboxLocal, cb = c.bboxLocal;
        for (let i = 0; i < 3; i++) { if (cb[i] < b[i]) b[i] = cb[i]; if (cb[i + 3] > b[i + 3]) b[i + 3] = cb[i + 3]; }
        if (c.chanRange[0] < doc.chanRange[0]) doc.chanRange[0] = c.chanRange[0];
        if (c.chanRange[1] > doc.chanRange[1]) doc.chanRange[1] = c.chanRange[1];
        if (!closed) onChunk(c);
      }
    }
    wake();
  };
  const pump = () => {
    while (free.length && queue.length) {
      const w = free.pop(), job = queue.shift();
      w.postMessage({ type: 'batch', ...job }, buffersOf(job.cols));
    }
  };
  for (const w of ws) {
    w.onmessage = ({ data }) => {
      if (data.type === 'batch') { done.set(data.k, data.chunks); free.push(w); pump(); deliver(); }
      else if (data.type === 'error') { failure = new Error(data.message); wake(); }
    };
    w.onerror = (e) => { e.preventDefault(); failure = new Error(e.message || 'chunk worker failed'); wake(); };
  }
  const concat = (Type, parts) => { const out = new Type(pendCount); let off = 0; for (const a of parts) { out.set(a, off); off += a.length; } return out; };
  const cut = () => {                                      // the pending records → one batch (the builder's flushBatch, minus the build)
    if (!pendCount) return;
    const cols = {
      x: concat(Float64Array, pend.map((q) => q.x)), y: concat(Float64Array, pend.map((q) => q.y)), z: concat(Float64Array, pend.map((q) => q.z)),
      chan: concat(Float64Array, pend.map((q) => q.chan)),
      cat: pend.every((q) => q.cat) ? concat(Uint8Array, pend.map((q) => q.cat)) : null,
      dim: o.dimPalette && pend.every((q) => q.dim) ? concat(Uint8Array, pend.map((q) => q.dim)) : null,
      recIdx: concat(Uint32Array, pend.map((q) => q.recIdx)),
    };
    queue.push({ k: k++, cols, n: pendCount });
    pend = []; pendCount = 0;
    pump();
  };
  return {
    offPage: true, workers: ws.length,
    push(raw) {
      if (closed) return;
      if (failure) return Promise.reject(failure);
      let recIdx = raw.recIdx;
      if (!recIdx) { recIdx = new Uint32Array(raw.count); for (let i = 0; i < raw.count; i++) recIdx[i] = raw.recStart + i; }
      let taken = 0;
      while (taken < raw.count) {                          // cut exactly where the builder would
        const n = Math.min(batchN - pendCount, raw.count - taken);
        const sl = (a) => (a ? a.subarray(taken, taken + n) : null);
        pend.push({ x: sl(raw.x), y: sl(raw.y), z: sl(raw.z), chan: sl(raw.chan), cat: sl(raw.cat), dim: sl(raw.dim), recIdx: recIdx.subarray(taken, taken + n) });
        pendCount += n; taken += n;
        if (pendCount >= batchN) cut();
      }
      if (inFlight() >= ws.length * 2) return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    flush() {
      if (failure) return Promise.reject(failure);
      cut();
      return new Promise((resolve, reject) => { flushWaiter = { resolve, reject }; wake(); });
    },
    close() { closed = true; for (const w of ws) w.terminate(); },
  };
}

export async function startChunkBuilder({ frame, grid, dimPalette = null, chunkSize, batchSize, seed, seedPerBatch = false, workers = 1, onChunk }) {
  const o = { frame: { origin: Array.from(frame.origin) }, grid, dimPalette, chunkSize, batchSize, seed, seedPerBatch };
  let closed = false;
  const onPage = () => {
    const pb = createBlockChunkBuilder({ ...o, frame, onChunk: (c) => { if (!closed) onChunk(c); } });
    return { offPage: false, workers: 0, push: (raw) => { if (!closed) pb.push(raw); }, flush: async () => pb.flush(), close: () => { closed = true; } };
  };
  if (typeof Worker === 'undefined') return onPage();
  if (workers > 1 && seedPerBatch) return startParallel(o, workers, onChunk, onPage);
  const w = await spawn('init', o);
  if (!w) return onPage();
  let flushWaiter = null, failure = null;
  w.onmessage = ({ data }) => {
    if (data.type === 'chunk') { if (!closed) onChunk(data.c); }      // a closed builder's late chunks are dropped
    else if (data.type === 'flushed') { const f = flushWaiter; flushWaiter = null; if (f) f.resolve(data.doc); }
    else if (data.type === 'error') { failure = new Error(data.message); if (flushWaiter) flushWaiter.reject(failure); }
  };
  w.onerror = (e) => { e.preventDefault(); failure = new Error(e.message || 'chunk worker failed'); if (flushWaiter) flushWaiter.reject(failure); };
  return {
    offPage: true, workers: 1,
    push(raw) { if (closed || failure) return; w.postMessage({ type: 'push', raw }, buffersOf(raw)); },
    // chunks arrive before 'flushed' (one channel, in order), so when this resolves every chunk is in
    flush() {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => { flushWaiter = { resolve, reject }; w.postMessage({ type: 'flush' }); });
    },
    close() { closed = true; w.terminate(); },
  };
}
