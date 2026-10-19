// The precompiled frozen modules (ext/adder/src/stdlib-pyair.js, made by ext/adder/gen-pyair.js):
// each must be what compiling its .py gives NOW — a compiler change that alters a module's output
// fails here until `node ext/adder/gen-pyair.js` (or the adder build, which runs it) is rerun —
// and an import on AIR must run it instead of compiling.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const A = await import('../ext/adder/src/index.js');
A.attachAir(await import('../ext/air/index.js'));
const { compileModuleSource } = await import('../ext/adder/src/runner.js');
const { frozenPyCompiled } = await import('../ext/adder/src/builtins.js');

const pylib = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ext', 'adder', 'pylib');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
function sourceOf(name) {
  const parts = name.split('.');
  const f = path.join(pylib, ...parts) + '.py';
  if (fs.existsSync(f)) return { src: fs.readFileSync(f, 'utf8'), pkg: parts.slice(0, -1).join('.') };
  return { src: fs.readFileSync(path.join(pylib, ...parts, '__init__.py'), 'utf8'), pkg: name };
}

describe('adder precompiled frozen modules (stdlib-pyair.js)', () => {
  it('there are some, and each is what its .py compiles to now', () => {
    const names = Object.keys(frozenPyCompiled);
    assert.ok(names.includes('_collections_abc') && names.includes('dataclasses') && names.includes('json'), names.join(', '));
    const stale = [];
    for (const name of names) {
      const { src, pkg } = sourceOf(name);
      const c = compileModuleSource(src.replace(/\r\n/g, '\n'), { kind: 'module', package: pkg });
      if (hash(c.body) !== frozenPyCompiled[name].emit) stale.push(name);
    }
    assert.deepEqual(stale, [], `stale artifacts — run: node ext/adder/gen-pyair.js`);
  });

  it('an import on AIR runs the precompiled module; on the tree-walker, the .py', async () => {
    const art = frozenPyCompiled['json.encoder'];
    delete art._made;
    const tree = await A.run('import json\nout = json.dumps({"a": [1, 2.5, None]}, sort_keys=True)', { engine: 'tree' });
    assert.equal(tree.out, '{"a": [1, 2.5, null]}');
    assert.equal(art._made, undefined);
    const air = await A.run('import sys\nfor k in [k for k in sys.modules if k == "json" or k.startswith("json.")]: del sys.modules[k]\n' +
      'import json\nout = json.dumps({"a": [1, 2.5, None]}, sort_keys=True)', { engine: 'auto' });
    assert.equal(air.out, '{"a": [1, 2.5, null]}');
    assert.ok(art._made, 'json.encoder ran from its artifact');
  });
});
