// natra in a worker (spec_inbox/lang/natra-worker-spec.md): the host hands natra the atra
// compiler and alpack (attachAtra / natra({ atra, alpack })), or compiled kernels
// (natra({ modules })), and natra then needs neither `window` nor `import()`.
// Each test imports a fresh natra instance (query string) so module state does not leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

let fresh = 0;
const freshNatra = () => import(`../ext/natra/index.js?fresh=${++fresh}`);

async function asWorker(fn) {
  globalThis.importScripts = () => { throw new Error('importScripts called'); };
  try { return await fn(); } finally { delete globalThis.importScripts; }
}

test('in a worker with nothing attached, natra refuses and names the fix', async () => {
  const { natra } = await freshNatra();
  await asWorker(async () => {
    await assert.rejects(natra(), /host calls attachAtra\(atra, alpack\)/);
  });
});

test('attachAtra in a worker: adder runs numpy-shaped natra, answers match numpy', async () => {
  const { atra } = await import('../ext/atra/index.js');
  const alpack = await import('../ext/atra/lib/alpack.src.js');
  const lib = await freshNatra();
  const { natraAdder, attachNatra } = await import('../ext/natra/adder.js');
  const { run, registerModule, unregisterModule } = await import('../ext/adder/src/index.js');
  await asWorker(async () => {
    lib.attachAtra(atra, alpack);           // the module or the source string both work
    try { attachNatra(lib); } catch { /* the bridge is a singleton across test files */ }
    registerModule('natra', natraAdder);
    try {
      const r = await run([
        'import natra as np',
        'x = np.array([1.0, 2.0, 3.0]).mean()',
        'inv = np.linalg.inv(np.array([[4.0, 7.0], [2.0, 6.0]])).tolist()',
        'rnd = np.round(np.array([1.0, 0.3333, 0.125]), 2).tolist()',
        'w = np.linalg.eigh(np.array([[2.0, 1.0], [1.0, 2.0]]))[0].tolist()',
      ].join('\n'));
      assert.equal(r.x, 2);
      const close = (a, b) => a.flat().every((v, i) => Math.abs(v - b.flat()[i]) < 1e-12);
      assert.ok(close(r.inv, [[0.6, -0.7], [-0.2, 0.4]]), JSON.stringify(r.inv));
      assert.deepEqual(r.rnd, [1, 0.33, 0.12]);   // numpy: half to even
      assert.ok(close(r.w, [1, 3]), JSON.stringify(r.w));
    } finally { unregisterModule('natra'); }
  });
});

test('natra({ atra, alpack }) is the same hand-off as attachAtra', async () => {
  const { atra } = await import('../ext/atra/index.js');
  const { all } = await import('../ext/atra/lib/alpack.src.js');
  const { natra } = await freshNatra();
  await asWorker(async () => {
    const ctx = await natra({ atra, alpack: all });
    const r = ctx.scope((o) => ctx.toArray(o.matmul(ctx.array([[1, 2], [3, 4]]), ctx.array([[1], [1]]))));
    assert.equal(r.flat().join(), '3,7');
  });
});

test('compiled kernels cross into a real worker that never loads atra', async () => {
  const { natra } = await freshNatra();
  const { kernels } = await natra.compiledModules();
  assert.ok(kernels instanceof WebAssembly.Module);
  const src = `
    const { parentPort, workerData } = require('node:worker_threads');
    globalThis.importScripts = () => {};   // look like a browser worker: no atra import allowed
    (async () => {
      const { natra } = await import(workerData.url);
      const ctx = await natra({ modules: { kernels: workerData.kernels } });
      const a = ctx.array([1, 2, 3, 4]);
      const out = ctx.scope((o) => ({ sum: o.sum(a), det: o.det(ctx.array([[2, 1], [1, 3]])) }));
      parentPort.postMessage(out);
    })().catch((e) => parentPort.postMessage({ error: String(e.message || e) }));
  `;
  const url = new URL('../ext/natra/index.js', import.meta.url).href;
  const w = new Worker(src, { eval: true, workerData: { url, kernels } });
  const msg = await new Promise((res, rej) => { w.once('message', res); w.once('error', rej); });
  await w.terminate();
  assert.equal(msg.error, undefined, msg.error);
  assert.equal(msg.sum, 10);
  assert.ok(Math.abs(msg.det - 5) < 1e-12);
});

test('a second context in one realm reuses the compiled kernels', async () => {
  const { natra } = await freshNatra();
  const a = await natra();
  const t = performance.now();
  const b = await natra();
  assert.ok(performance.now() - t < 20, 'second context should not recompile');
  // separate memories: arrays in one do not appear in the other
  a.array([1, 2, 3]);
  assert.equal(b.toArray(b.array([9])).join(), '9');
});
