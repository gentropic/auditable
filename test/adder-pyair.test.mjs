// The precompiled frozen modules (ext/adder/gen-pyair.js): the hot set bundled in
// ext/adder/src/stdlib-pyair.js, the rest in ext/adder/batteries.js. Each must be what compiling its
// .py gives NOW — a compiler change that alters a module's output fails here until
// `node ext/adder/gen-pyair.js` (or the adder build, which runs it) is rerun — and an import on AIR
// must run it instead of compiling. Batteries are taken only by the build that made them.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const A = await import('../ext/adder/src/index.js');
A.attachAir(await import('../ext/air/index.js'));
const { compileModuleSource } = await import('../ext/adder/src/runner.js');
const { frozenPyCompiled, frozenPyBuild } = await import('../ext/adder/src/builtins.js');
const batteries = (await import('../ext/adder/batteries.js')).default;
const hot = Object.keys(frozenPyCompiled);

const pylib = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ext', 'adder', 'pylib');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
function sourceOf(name) {
  const parts = name.split('.');
  const f = path.join(pylib, ...parts) + '.py';
  if (fs.existsSync(f)) return { src: fs.readFileSync(f, 'utf8'), pkg: parts.slice(0, -1).join('.') };
  return { src: fs.readFileSync(path.join(pylib, ...parts, '__init__.py'), 'utf8'), pkg: name };
}
const reimport = (names) => `import sys\nfor k in [k for k in sys.modules if ${names.map((n) => `k == ${JSON.stringify(n)} or k.startswith(${JSON.stringify(n + '.')})`).join(' or ')}]: del sys.modules[k]\n`;

describe('adder precompiled frozen modules (stdlib-pyair.js, batteries.js)', () => {
  it('there are some, and each is what its .py compiles to now', () => {
    assert.ok(hot.includes('_collections_abc') && hot.includes('dataclasses') && hot.includes('json'), hot.join(', '));
    assert.ok('unittest.case' in batteries.modules && 'doctest' in batteries.modules, Object.keys(batteries.modules).join(', '));
    const all = { ...Object.fromEntries(hot.map((n) => [n, frozenPyCompiled[n]])), ...batteries.modules };
    const stale = [];
    for (const [name, art] of Object.entries(all)) {
      const { src, pkg } = sourceOf(name);
      const c = compileModuleSource(src.replace(/\r\n/g, '\n'), { kind: 'module', package: pkg });
      if (hash(c.body) !== art.emit) stale.push(name);
    }
    assert.deepEqual(stale, [], `stale artifacts — run: node ext/adder/gen-pyair.js`);
    // ...and both files come from the same run
    assert.equal(batteries.build, frozenPyBuild.id);
  });

  it('an import on AIR runs the precompiled module; on the tree-walker, the .py', async () => {
    const art = frozenPyCompiled['json.encoder'];
    delete art._made;
    const tree = await A.run('import json\nout = json.dumps({"a": [1, 2.5, None]}, sort_keys=True)', { engine: 'tree' });
    assert.equal(tree.out, '{"a": [1, 2.5, null]}');
    assert.equal(art._made, undefined);
    const air = await A.run(reimport(['json']) + 'import json\nout = json.dumps({"a": [1, 2.5, None]}, sort_keys=True)', { engine: 'auto' });
    assert.equal(air.out, '{"a": [1, 2.5, null]}');
    assert.ok(art._made, 'json.encoder ran from its artifact');
  });

  it('batteries: refused from another build, taken from this one, then imported from', async () => {
    assert.equal(A.addPrecompiled({ build: 'another', modules: batteries.modules }), 0);
    assert.equal(frozenPyCompiled['difflib'], undefined);
    const n = A.addPrecompiled(batteries);
    assert.equal(n, Object.keys(batteries.modules).length);
    assert.equal(A.addPrecompiled(batteries), 0, 'a second time adds nothing');
    const art = frozenPyCompiled['difflib'];
    assert.equal(art, batteries.modules['difflib']);
    delete art._made;
    const r = await A.run(reimport(['difflib']) + 'import difflib\nout = difflib.SequenceMatcher(None, "abcd", "bcde").ratio()', { engine: 'auto' });
    assert.equal(r.out, 0.75);
    assert.ok(art._made, 'difflib ran from its artifact');
  });
});
