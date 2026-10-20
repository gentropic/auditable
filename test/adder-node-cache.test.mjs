// @gcu/adder/node-cache: the compile cache persisted to disk, across real processes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setCompileStore } from '../ext/adder/src/index.js';

const ADDER = pathToFileURL(path.resolve('ext/adder/src/index.js')).href;
const CACHE = pathToFileURL(path.resolve('ext/adder/src/node-cache.js')).href;
const AIR = path.resolve('ext/air/index.js');

// one process: a frozen module compiled from source (difflib isn't in the hot set), exec strings
// (namedtuple's generated __new__, a plain exec) — counting the store's hits and writes
const CHILD = `
const A = await import(${JSON.stringify(ADDER)});
const { nodeCompileStore } = await import(${JSON.stringify(CACHE)});
A.attachAir(await import(${JSON.stringify(pathToFileURL(AIR).href)}));
const [dir, air] = process.argv.slice(2);
const s = nodeCompileStore({ dir, air });
let hits = 0, sets = 0;
A.setCompileStore({ get: (k) => { const v = s.get(k); if (v !== undefined) hits++; return v; }, set: (k, v) => { sets++; s.set(k, v); } });
const r = await A.run(\`import difflib
from collections import namedtuple
P = namedtuple('P', 'x y')
ns = {}
exec("def f(x):\\\\n    return x * 3\\\\n", ns)
out = (difflib.SequenceMatcher(None, 'abcd', 'abxd').ratio(), P(1, 2).y, ns['f'](5))\`, { engine: 'auto' });
console.log(JSON.stringify({ hits, sets, out: r.out, id: s.id }));
`;

function runChild(dir, air) {
  const script = path.join(dir, '..', 'child.mjs');
  fs.writeFileSync(script, CHILD);
  return JSON.parse(execFileSync(process.execPath, [script, dir, air], { encoding: 'utf8' }).trim().split('\n').pop());
}

test('a second process takes every compile from the disk store; another compiler identity takes none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adder-cache-'));
  try {
    const dir = path.join(root, 'cache');
    const first = runChild(dir, AIR);
    assert.ok(first.sets >= 3, `first process wrote ${first.sets}`);
    assert.equal(first.hits, 0);
    assert.deepEqual(first.out, [0.75, 2, 15]);
    const second = runChild(dir, AIR);
    assert.equal(second.sets, 0);
    assert.equal(second.hits, first.sets);
    assert.deepEqual(second.out, first.out);
    assert.equal(second.id, first.id);
    // the same sources under a changed compiler (an AIR bundle that differs by a byte): all misses
    const air2 = path.join(root, 'air-changed.js');
    fs.writeFileSync(air2, fs.readFileSync(AIR, 'utf8') + '\n// changed\n');
    const third = runChild(dir, air2);
    assert.notEqual(third.id, first.id);
    assert.equal(third.hits, 0);
    assert.equal(third.sets, first.sets);
    // a corrupt entry is a miss, not an error
    for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), '{not json');
    const fourth = runChild(dir, AIR);
    assert.deepEqual(fourth.out, first.out);
    assert.equal(fourth.hits, first.sets);   // read (and counted) but unusable → recompiled and rewritten
    assert.equal(fourth.sets, first.sets);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the store stays under its cap, least recently used out first', async () => {
  const { nodeCompileStore } = await import(CACHE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adder-cache-cap-'));
  try {
    const s = nodeCompileStore({ dir, air: AIR, maxBytes: 64 * 1024 });
    for (let i = 0; i < 40; i++) s.set(`k${i}`, 'x'.repeat(4096));
    const total = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
    assert.ok(total <= 64 * 1024 + 4096 * 16, `total ${total}`);
    assert.equal(s.get('k39'), 'x'.repeat(4096));
    assert.equal(s.get('k0'), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('setCompileStore refuses what isn\'t a store', () => {
  assert.throws(() => setCompileStore({ get() {} }), TypeError);
  setCompileStore(null);
});
