// the classic-script builds (index.classic.js) carry exactly the module's exports, on their global
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { toClassic } from '../ext/classic-wrap.mjs';

const runClassic = (file) => {
  const ctx = vm.createContext({ console, URL, Blob: globalThis.Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, queueMicrotask, performance });
  vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx, { filename: file });
  return ctx;
};

for (const [file, mod, global] of [
  ['../ext/plot/index.classic.js', '../ext/plot/index.js', 'gcuPlot'],
  ['../ext/condenser/view/index.classic.js', '../ext/condenser/view/index.js', 'gcuCondenser'],
]) {
  test(`${global}: the classic build exposes the module's exports`, async () => {
    const M = await import(mod), G = runClassic(file)[global];
    assert.ok(G, `${global} is set`);
    assert.deepEqual(Object.keys(G).sort(), Object.keys(M).sort());
    assert.ok(Object.isFrozen(G));
    for (const k of Object.keys(M)) assert.equal(typeof G[k], typeof M[k], k);
  });
}

test('gcuPlot draws: a figure records into a context', () => {
  const P = runClassic('../ext/plot/index.classic.js').gcuPlot;
  const [fig, ax] = P.subplots();
  ax.plot([0, 1, 2], [1, 3, 2]);
  assert.equal(typeof fig, 'object');
});

test('gcuCondenser: the classic worker boots as classic, the module one as module', () => {
  const cls = readFileSync(new URL('../ext/condenser/view/index.classic.js', import.meta.url), 'utf8');
  const esm = readFileSync(new URL('../ext/condenser/view/index.js', import.meta.url), 'utf8');
  assert.match(cls, /const WORKER_TYPE = 'classic';/);
  assert.match(esm, /const WORKER_TYPE = 'module';/);
  assert.ok(!/import\.meta/.test(cls), 'no import.meta left in the classic build');
  for (const s of [cls, esm]) assert.ok(!/new Function\('u'/.test(s), 'no eval-backed dynamic import');
});

test('toClassic refuses what it cannot wrap faithfully', () => {
  assert.throws(() => toClassic("import x from 'y';\nexport { x };", { global: 'G' }), /static import/);
  assert.throws(() => toClassic('export function f() {}\nexport { f };', { global: 'G' }), /other than the footer/);
  assert.throws(() => toClassic('const a = 1;', { global: 'G' }), /footer/);
  assert.throws(() => toClassic('const a = 1;\nexport { a };', { global: 'G', replace: [['nope', 'x']] }), /matched 0 times/);
  const out = toClassic('const a = 1, b = import.meta.url;\nexport { a, b as c };', { global: 'G' });
  const ctx = vm.createContext({}); vm.runInContext(out, ctx);
  assert.deepEqual({ ...ctx.G }, { a: 1, c: '' });
});
