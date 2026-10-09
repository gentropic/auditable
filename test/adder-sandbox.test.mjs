// adder as a library sandbox (spec_inbox/lang/adder-sandbox-spec.md §4): host access off,
// remote imports off (no fetch call, ever), a step / wall-clock budget with a per-statement
// hook, and registerModule without `window`. Runs in Node with no DOM shim on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { run, evalExpr, compile, registerModule, unregisterModule, AdderError } = await import('../ext/adder/src/index.js');

const rejectsWith = async (p, pyType, re) => {
  let err = null;
  try { await p; } catch (e) { err = e; }
  assert.ok(err, 'expected a throw');
  assert.equal(err.pyType, pyType, err.message);
  if (re) assert.match(err.message, re);
  return err;
};

test('host: false hides the js module; the default keeps it', async () => {
  await rejectsWith(run('import js', { host: false }), 'ModuleNotFoundError', /No module named 'js'/);
  await rejectsWith(run('from js import console', { host: false }), 'ModuleNotFoundError');
  const r = await run('import js\nok = js is not None');
  assert.equal(r.ok, true);
  // the rest of the standard set is untouched
  const m = await run('import math, json, re\nv = math.floor(2.5)', { host: false });
  assert.equal(m.v, 2);
});

test('remote: false never calls fetch — sys.path URL bases and string-literal URL imports', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('fetch must not be called'); };
  const { adderModules } = await import('../ext/adder/src/builtins.js');
  const pathBefore = adderModules.sys.path.slice();     // sys.path is process-wide; put it back
  try {
    const e1 = await rejectsWith(run('import sys\nsys.path.append("https://example.invalid/")\nimport nothing', { remote: false }), 'ModuleNotFoundError');
    assert.match(e1.message, /remote imports are off/);
    const e2 = await rejectsWith(run('import "https://example.invalid/x.py" as x', { remote: false }), 'ModuleNotFoundError');
    assert.match(e2.message, /remote imports are off/);
    assert.equal(calls, 0, 'no fetch call');
    // the default still tries the network (and fails honestly in this test)
    await rejectsWith(run('import "https://example.invalid/x.py" as x'), 'ModuleNotFoundError');
    assert.ok(calls > 0, 'the default path did reach fetch');
  } finally { globalThis.fetch = realFetch; adderModules.sys.path.length = 0; adderModules.sys.path.push(...pathBefore); }
});

test('a local-only not-found keeps the plain message', async () => {
  const e = await rejectsWith(run('import nothing_here', { remote: false }), 'ModuleNotFoundError');
  assert.doesNotMatch(e.message, /remote imports are off/);
});

test('budget.steps stops a runaway loop fast; the budget stays spent', async () => {
  const t0 = performance.now();
  const e = await rejectsWith(run('while True: pass', { budget: { steps: 1000 } }), 'BudgetExceeded');
  assert.match(e.message, /1000 statements/);
  assert.ok(performance.now() - t0 < 500, `took ${(performance.now() - t0).toFixed(0)} ms`);
  // catching it does not resume: the next boundary raises again
  const code = 'n = 0\ntry:\n    while True:\n        n += 1\nexcept Exception as ex:\n    pass\nn = -1\n';
  await rejectsWith(run(code, { budget: { steps: 50 } }), 'BudgetExceeded');
});

test('budget.ms stops on the wall clock', async () => {
  const t0 = performance.now();
  const e = await rejectsWith(run('while True: pass', { budget: { ms: 50 } }), 'BudgetExceeded');
  assert.match(e.message, /50 ms/);
  const took = performance.now() - t0;
  assert.ok(took < 400, `took ${took.toFixed(0)} ms`);
});

test('a budget large enough lets a normal program finish, and is per call', async () => {
  const r = await run('s = 0\nfor i in range(100):\n    s += i\n', { budget: { steps: 10000 } });
  assert.equal(r.s, 4950);
  const r2 = await run('x = 1', { budget: { steps: 10000 } });
  assert.equal(r2.x, 1);
  assert.equal(await evalExpr('2 + 3', { budget: { steps: 10 } }), 5);
  const c = compile('y = 7');
  assert.equal((await c.run({ budget: { steps: 5 } })).y, 7);
});

test('onStep sees a line for each statement and a scope that shows x after x = 1', async () => {
  const seen = [];
  await run('x = 1\ny = x + 1\nz = y * 2\n', { budget: { onStep: (ev) => seen.push({ line: ev.line, kind: ev.kind, hasX: ev.scope.has('x'), x: ev.scope.has('x') ? ev.scope.get('x') : undefined, names: ev.scope.names() }) } });
  assert.deepEqual(seen.map((s) => s.line), [1, 2, 3]);
  assert.ok(seen.every((s) => s.kind === 'Assign'));
  assert.equal(seen[0].hasX, false);                    // called BEFORE the statement runs
  assert.equal(seen[1].x, 1);
  assert.ok(seen[2].names.includes('y'));
});

test('registerModule makes a module importable with no window; dotted names walk in', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  registerModule('fake', { answer: 42, sub: { z: 'zed' }, fn: (a) => a * 2 });
  try {
    const r = await run('import fake\ny = fake.answer\nd = fake.fn(21)');
    assert.equal(r.y, 42);
    assert.equal(r.d, 42);
    const r2 = await run('from fake.sub import z');
    assert.equal(r2.z, 'zed');
    const r3 = await run('import fake.sub as s\nw = s.z');
    assert.equal(r3.w, 'zed');
    // a registered module wins over a built-in of the same name, and host: false does not hide it
    registerModule('js', { fetch: 'nope' });
    const r4 = await run('import js\nv = js.fetch', { host: false });
    assert.equal(r4.v, 'nope');
  } finally {
    unregisterModule('fake'); unregisterModule('js');
  }
  await rejectsWith(run('import fake'), 'ModuleNotFoundError');
});

test('the sandbox options are restored after the call', async () => {
  await rejectsWith(run('import js', { host: false }), 'ModuleNotFoundError');
  const r = await run('import js\nok = True');
  assert.equal(r.ok, true);
  await rejectsWith(run('while True: pass', { budget: { steps: 10 } }), 'BudgetExceeded');
  const r2 = await run('s = 0\nfor i in range(5000):\n    s += 1\n');   // no budget: runs past 10 statements
  assert.equal(r2.s, 5000);
  assert.ok(AdderError);
});
