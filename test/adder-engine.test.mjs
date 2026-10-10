// adder's engine option: run(code, { engine }) tree-walks ('tree'), AIR-compiles ('air', after
// attachAir), or compiles when it can and tree-walks otherwise ('auto'). The sandbox (host /
// remote / budget) holds in compiled code too: the lowerer emits _py.tick(line) before every
// statement, so `steps` counts what the tree-walker counts. @gcu/adder/air is a thin layer
// over the same path. Node, no window.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../ext/adder/src/index.js');
A.attachAir(await import('../ext/air/index.js'));

async function both(code) {
  const res = {};
  for (const engine of ['tree', 'auto']) {
    const out = [];
    let used = null;
    const scope = await A.run(code, { engine, stdout: (s) => out.push(s), onEngine: (e) => { used = e; } });
    res[engine] = { scope, out: out.join(''), used };
  }
  return res;
}
const plainScope = (s) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== 'function' && !(v && v._pyClass)))));

const PROGRAMS = {
  arithmetic: 's = 0\nfor i in range(1000):\n    s += i * i % 7\nprint(s, 7 // 2, -7 // 2, 7 % -3, 2 ** 10)',
  recursion: 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nr = fib(15)\nprint(r)',
  closures: 'def make(k):\n    def add(x):\n        return x + k\n    return add\nadd3 = make(3)\nv = [add3(i) for i in range(4)]\nprint(v)',
  classes: 'class P:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n    def norm2(self):\n        return self.x ** 2 + self.y ** 2\n    def __repr__(self):\n        return f"P({self.x}, {self.y})"\np = P(3, 4)\nn = p.norm2()\nprint(p, n)',
  comprehensions: 'd = {k: k * k for k in range(5) if k % 2 == 0}\ns = sorted({x % 3 for x in range(10)})\nprint(d, s, [c.upper() for c in "abc"])',
  strings: 'w = "Hello, World"\nprint(w.lower().split(", "), w[::-1], w[2:5], len(w), f"{3.14159:.2f}|{42:>5}|")',
  exceptions: 'def safe(a, b):\n    try:\n        return a / b\n    except ZeroDivisionError as e:\n        return str(e)\nout = [safe(1, 2), safe(1, 0)]\nprint(out)',
  generators: 'def gen(n):\n    for i in range(n):\n        yield i * 2\ntotal = sum(gen(5))\nprint(total, list(gen(3)))',
  sorting: 'people = [("ana", 31), ("bo", 25), ("cy", 31)]\nby = sorted(people, key=lambda t: (-t[1], t[0]))\nprint(by, max(people, key=lambda t: t[1])[0])',
  whileElse: 'i = 0\nwhile i < 5:\n    i += 1\n    if i == 9:\n        break\nelse:\n    print("no break", i)',
};

for (const [name, code] of Object.entries(PROGRAMS)) {
  test(`auto compiles and agrees with the tree-walker: ${name}`, async () => {
    const r = await both(code);
    assert.equal(r.tree.used, 'tree');
    assert.equal(r.auto.used, 'air', `${name} fell back to the tree-walker`);
    assert.equal(r.auto.out, r.tree.out);
    assert.deepEqual(plainScope(r.auto.scope), plainScope(r.tree.scope));
  });
}

test('the budget holds in compiled code: steps, wall clock, and an except cannot swallow it', async () => {
  const used = [];
  const opts = (budget) => ({ engine: 'auto', budget, onEngine: (e) => used.push(e) });
  await assert.rejects(A.run('while True:\n    pass', opts({ steps: 1000 })), (e) => e.pyType === 'BudgetExceeded' && /1000 statements/.test(e.message));
  await assert.rejects(A.run('while True:\n    pass', opts({ ms: 100 })), (e) => e.pyType === 'BudgetExceeded' && /100 ms/.test(e.message));
  await assert.rejects(A.run('try:\n    while True:\n        pass\nexcept Exception:\n    caught = 1\nafter = 2', opts({ steps: 500 })),
    (e) => e.pyType === 'BudgetExceeded');
  assert.deepEqual([...new Set(used)], ['air']);
  // the same program counts the same statements either way
  let treeErr, airErr;
  try { await A.run('x = 0\nfor i in range(100):\n    x += 1', { engine: 'tree', budget: { steps: 150 } }); } catch (e) { treeErr = e.message; }
  try { await A.run('x = 0\nfor i in range(100):\n    x += 1', { engine: 'air', budget: { steps: 150 } }); } catch (e) { airErr = e.message; }
  assert.equal(airErr, treeErr);
});

test('compiled code is much faster than tree-walking, budget ticks included', async () => {
  const code = 's = 0\nfor i in range(200000):\n    s += i * 2';
  let t = performance.now();
  await A.run(code, { engine: 'tree', budget: { steps: 1e9 } });
  const tree = performance.now() - t;
  t = performance.now();
  await A.run(code, { engine: 'air', budget: { steps: 1e9 } });
  const air = performance.now() - t;
  assert.ok(air * 5 < tree, `air ${air.toFixed(0)} ms vs tree ${tree.toFixed(0)} ms`);
});

test('host: false and remote: false hold in compiled code', async () => {
  await assert.rejects(A.run('import js', { engine: 'air', host: false }), (e) => e.pyType === 'ModuleNotFoundError');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network'); };
  try {
    await assert.rejects(A.run('import some_remote_thing', { engine: 'air', remote: false }), (e) => e.pyType === 'ModuleNotFoundError');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 0);
});

test('auto tree-walks a trace and an undefined name, and says why', async () => {
  const seen = [];
  const onEngine = (e, why) => seen.push([e, why]);
  await A.run('a = 1', { engine: 'auto', budget: { onStep: () => {} }, onEngine });
  assert.deepEqual(seen.at(-1), ['tree', 'trace']);
  await assert.rejects(A.run('print(nope)', { engine: 'auto', onEngine }), (e) => e.pyType === 'NameError');
  assert.equal(seen.at(-1)[0], 'tree');
  assert.match(seen.at(-1)[1], /free name nope/);
  await assert.rejects(A.run('a = 1', { engine: 'air', budget: { onStep: () => {} } }), /onStep/);
  await assert.rejects(A.run('a = 1', { engine: 'warp' }), /engine must be/);
});

test('@gcu/adder/air honours the sandbox through the same path', async () => {
  const B = await import('../ext/adder/src/air.js');
  await assert.rejects(B.run('while True:\n    pass', { budget: { steps: 100 } }), (e) => e.pyType === 'BudgetExceeded');
  await assert.rejects(B.run('import js', { host: false }), (e) => e.pyType === 'ModuleNotFoundError');
  assert.equal(await B.evalExpr('sum(range(10))'), 45);
  const c = await B.compile('y = x * 2');
  assert.equal((await c.run({ globals: { x: 21 } })).y, 42);
  await assert.rejects(c.run({ budget: { onStep: () => {} } }), /tree-walker/);
});
