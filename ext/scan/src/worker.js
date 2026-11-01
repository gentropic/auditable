// @gcu/scan worker — the body of every pool worker, a real module (it used to be
// a template string with functions pasted in by toString(), where a module-scope
// reference worked on the page and threw only in the worker).
//
// The worker bundle (worker.js at the package root) has ZERO static imports: a
// module worker started from a blob has no import map, so its libraries arrive
// as URLs in the init message (`libs`) and are imported then — parquet + sluice
// always, condenser for a .dm / delimited source, a lattice check or a decode,
// expr for a scan. Kernels, the chunk view, the accumulator and the tasks are
// this bundle's own code: one definition on the page and in the worker.
import * as kernels from './kernels.js';
import * as CV from './chunkview.js';
import { makeColAcc } from './colacc.js';
import { discoverGroup, decodeGroup, checkGroup, decodeCodes } from './tasks.js';

// every ArrayBuffer under a result, for the transfer list (a scan partial's bins)
function buffersOf(o, out = []) {
  if (o && ArrayBuffer.isView(o)) { if (!out.includes(o.buffer)) out.push(o.buffer); }
  else if (Array.isArray(o)) for (const x of o) buffersOf(x, out);
  else if (o && typeof o === 'object') for (const k in o) buffersOf(o[k], out);
  return out;
}

// load(url) imports a library: the pool's bootstrap passes `(u) => import(u)` (a bundle may not
// carry a dynamic import — @gcu/build E006 — and it needn't: the bootstrap is a string)
export function serve(self, load) {
  let file = null, meta = null, task = null, p = null, st = null, acc = null, codes = null;
  let PQ = null, SL = null, CD = null, kern = null, kctx = null;
  self.onmessage = async ({ data }) => {
    try {
      if (data.type === 'init') {
        ({ file, meta, task, p } = data);
        const libs = data.libs;
        [PQ, SL] = await Promise.all([load(libs.parquet), load(libs.sluice)]);
        const needCD = task === 'check' || task === 'discover' || task === 'decode' || (task === 'scan' && p.source && (p.source.kind === 'dm' || p.source.kind === 'csv'));
        if (needCD) CD = await load(libs.condenser);
        if (task === 'stats') { acc = makeColAcc(SL); st = p.cols.map((c) => acc.create(c.num)); }
        if (task === 'scan') { const E = await load(libs.expr); kern = kernels[p.kernel + 'Kernel'](E, CV, SL); kctx = kern.init(p.params, p.calcs); }
        if (task === 'decode') codes = decodeCodes(p);
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
          const out = discoverGroup(CD, p, cols, count, data.res || 0);
          self.postMessage({ type: 'result', id, out }, out.res ? [out.res.buffer] : []);
        } else if (task === 'check') {
          const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
          self.postMessage({ type: 'result', id, out: { bad: checkGroup(CD, p, cols, start, count) } });
        } else if (task === 'scan') {
          // the needed columns of this unit → the chunk view → the kernel's partial
          let cols = {};
          if (p.readCols.length && p.source && p.source.kind === 'dm') {
            const r = await CD.readDmRun(file, p.source.h, p.source.idx, data.run);
            p.readCols.forEach((n, k) => { cols[n] = r.cols[p.source.idx[k]]; });
          } else if (p.readCols.length && p.source && p.source.kind === 'csv') {
            const r = await CD.readDelimitedRun(file, data.run, p.source.o);
            p.readCols.forEach((n, k) => { cols[n] = r[k]; });
          } else if (p.readCols.length) cols = await PQ.readParquetRange(file, p.readCols, start, start + count, meta);
          const view = CV.chunkView(p.spec, cols, data.page || [], count, kctx.calcFns);
          const out = kern.group(kctx, view, count, data.mask || null);
          self.postMessage({ type: 'result', id, out }, buffersOf(out));
        } else if (task === 'decode') {
          const cols = await PQ.readParquetRange(file, p.cols, start, start + count, meta);
          const out = decodeGroup(CD, p, cols, start, count, codes);
          const tr = [out.x.buffer, out.y.buffer, out.z.buffer, out.chan.buffer, out.recIdx.buffer];
          if (out.cat) tr.push(out.cat.buffer); if (out.dim) tr.push(out.dim.buffer);
          self.postMessage({ type: 'result', id, out }, tr);
        }
      } else if (data.type === 'finish') {
        self.postMessage({ type: 'final', out: task === 'stats' ? st : null });
      }
    } catch (e) { self.postMessage({ type: 'error', id: data && data.id, message: (e && e.message) || String(e) }); }
  };
}
