// micro chunkworker — condenser's block chunk builder (Morton sort + LOD shuffle +
// packing) run OFF the page. The same builder, the same batches, the same seed, so
// the same chunks as building them on the page — only the page no longer freezes
// for the half second a 2M-block batch takes (the filter's compaction did, three or
// four times per filter on a big model).
//
// startChunkBuilder(opts) → { push(raw), flush() → Promise<doc>, close(), offPage }
// opts: createBlockChunkBuilder's { frame, grid, dimPalette, chunkSize, batchSize,
// seed } + onChunk(chunk). push() TRANSFERS raw's arrays (the caller must not reuse
// them). Where a worker can't start (file://, an old browser), the page builds as
// before (offPage false), behind the same async face.
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
let b = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      b = C.createBlockChunkBuilder({ ...data.o, onChunk: (c) => self.postMessage({ type: 'chunk', c }, buffersOf(c)) });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'push') b.push(data.raw);
    else if (data.type === 'flush') { const doc = b.flush(); self.postMessage({ type: 'flushed', doc }); }
  } catch (e) { self.postMessage({ type: 'error', message: e && e.message || String(e) }); }
};
`;
}

export async function startChunkBuilder({ frame, grid, dimPalette = null, chunkSize, batchSize, seed, onChunk }) {
  const o = { frame: { origin: Array.from(frame.origin) }, grid, dimPalette, chunkSize, batchSize, seed };
  let closed = false;
  const onPage = () => {
    const pb = createBlockChunkBuilder({ ...o, frame, onChunk: (c) => { if (!closed) onChunk(c); } });
    return { offPage: false, push: (raw) => { if (!closed) pb.push(raw); }, flush: async () => pb.flush(), close: () => { closed = true; } };
  };
  if (typeof Worker === 'undefined') return onPage();
  let url, w;
  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    w = new Worker(url, { type: 'module' });
  } catch { if (url) URL.revokeObjectURL(url); return onPage(); }
  const ok = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    w.onmessage = ({ data }) => { if (data.type === 'ready') { clearTimeout(t); res(true); } else if (data.type === 'error') { clearTimeout(t); res(false); } };
    w.onerror = (e) => { e.preventDefault(); clearTimeout(t); res(false); };
    try { w.postMessage({ type: 'init', o }); } catch { clearTimeout(t); res(false); }
  });
  URL.revokeObjectURL(url);
  if (!ok) { w.terminate(); return onPage(); }
  let flushWaiter = null, failure = null;
  w.onmessage = ({ data }) => {
    if (data.type === 'chunk') { if (!closed) onChunk(data.c); }      // a closed builder's late chunks are dropped
    else if (data.type === 'flushed') { const f = flushWaiter; flushWaiter = null; if (f) f.resolve(data.doc); }
    else if (data.type === 'error') { failure = new Error(data.message); if (flushWaiter) flushWaiter.reject(failure); }
  };
  w.onerror = (e) => { e.preventDefault(); failure = new Error(e.message || 'chunk worker failed'); if (flushWaiter) flushWaiter.reject(failure); };
  return {
    offPage: true,
    push(raw) { if (closed || failure) return; w.postMessage({ type: 'push', raw }, buffersOf(raw)); },
    // chunks arrive before 'flushed' (one channel, in order), so when this resolves every chunk is in
    flush() {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => { flushWaiter = { resolve, reject }; w.postMessage({ type: 'flush' }); });
    },
    close() { closed = true; w.terminate(); },
  };
}
