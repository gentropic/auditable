#!/usr/bin/env node
// Precompiles the frozen stdlib for AIR: each pylib module AIR-compiled exactly as an import
// compiles it (runner.js compileModuleSource), then its local names mangled by terser (mangle only
// — no other transform: gzip pays mostly for the compiler's unique temp names). An import of one
// of these on AIR then skips parse, lowering, passes and emission; the tree-walker still runs the .py.
//   src/stdlib-pyair.js — the HOT list, what most programs import: in the adder bundle
//   batteries.js        — every other module AIR can compile (unittest, doctest, pydoc, difflib, …):
//                         plain data, `export default { build, modules }`, which a host hands to
//                         addPrecompiled() (@gcu/adder/batteries)
//
// Each artifact records `emit`, a hash of the UNMANGLED emitted JS; `build` hashes every module's
// `emit`, so batteries are taken only by an adder whose compiler gave the same output for all of
// them. test/adder-pyair.test.mjs recompiles every module and compares, so a compiler change that
// alters any output fails the test until this runs again (build.js runs it on every build). The
// same hash lets a rerun reuse an artifact whose output didn't change — and terser is loaded only
// when one did (the publish workflow builds without node_modules).
//   node ext/adder/gen-pyair.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pylib = path.join(here, 'pylib');
const outHot = path.join(here, 'src', 'stdlib-pyair.js');
const outBatteries = path.join(here, 'batteries.js');

// the bundled set: what a typical program pulls in
export const HOT = [
  '__future__', '_collections_abc', 'collections', 'dataclasses', 'heapq', 'bisect',
  'json', 'json.decoder', 'json.encoder', 'json.scanner',
  'argparse', 'glob', 'shutil', 'fnmatch', 'genericpath', 'ntpath', 'pathlib', 'pathlib._abc', 'pathlib._local',
  'importlib._bootstrap', 'importlib._bootstrap_external',
];

const imp = (p) => import(pathToFileURL(path.join(here, p)).href);
const A = await imp('src/index.js');
A.attachAir(await imp('../air/index.js'));
const { compileModuleSource } = await imp('src/runner.js');
let minify = null;   // terser, when an artifact has to be made

// every pylib module, as the frozen loader names it (gen-pylib.js): a.b for a/b.py, a for a/__init__.py
function allModules() {
  const names = [];
  (function walk(dir, parts) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { if (name !== '__pycache__') walk(full, [...parts, name]); continue; }
      if (name.endsWith('.py')) names.push((name === '__init__.py' ? parts : [...parts, name.slice(0, -3)]).join('.'));
    }
  })(pylib, []);
  return names;
}
// a module's .py and package, as the frozen loader sees them (eval.js findModule)
function sourceOf(name) {
  const parts = name.split('.');
  const asFile = path.join(pylib, ...parts) + '.py';
  if (fs.existsSync(asFile)) return { src: fs.readFileSync(asFile, 'utf8'), pkg: parts.slice(0, -1).join('.') };
  return { src: fs.readFileSync(path.join(pylib, ...parts, '__init__.py'), 'utf8'), pkg: name };
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);

// the previous artifacts: reused when the emitted JS is unchanged
const prev = {};
for (const f of [outHot, outBatteries]) {
  if (!fs.existsSync(f)) continue;
  const m = fs.readFileSync(f, 'utf8').match(/^\/\/ DATA\n([\s\S]*)\n\/\/ END DATA$/m);
  if (m) Object.assign(prev, JSON.parse(m[1]));
}

const hot = {}, batteries = {}, skipped = [];
for (const name of allModules()) {
  const { src, pkg } = sourceOf(name);
  let c;
  try { c = compileModuleSource(src.replace(/\r\n/g, '\n'), { kind: 'module', package: pkg }); } catch (e) {
    if (HOT.includes(name)) throw e;
    skipped.push(name);     // AIR can't lower it (a star import): it tree-walks, as before
    continue;
  }
  const emit = hash(c.body);
  let art = prev[name];
  if (!art || art.emit !== emit) {
    if (!minify) ({ minify } = createRequire(import.meta.url)('terser'));
    const fnSrc = `(${c.async ? 'async ' : ''}function (_py${c.imports.map((n) => ', ' + n).join('')}) {\n${c.body}\n})`;
    const r = await minify(fnSrc, { mangle: true, compress: false, ecma: 2022, format: { comments: false, ecma: 2022 } });
    art = { emit, imports: c.imports, doc: c.doc, code: r.code.replace(/;$/, '') };
  }
  (HOT.includes(name) ? hot : batteries)[name] = art;
}
// the compiler's identity, as far as these modules can tell: what it made of each of them
const build = hash(Object.keys({ ...hot, ...batteries }).sort().map((n) => `${n}:${(hot[n] || batteries[n]).emit}`).join('\n'));

const data = (o) => JSON.stringify(o, null, 0).replace(/^\{/, '{\n').replace(/,"(?=[^"]+":\{"emit")/g, ',\n"');
function write(file, js) {
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (before !== js) fs.writeFileSync(file, js);
  return `${(js.length / 1024).toFixed(0)} KB${before === js ? ' (unchanged)' : ''}`;
}
const hotSize = write(outHot, `// GENERATED by ext/adder/gen-pyair.js from ext/adder/pylib/ — do not edit; run the script.
// AIR-compiled frozen modules (${HOT.join(', ')}): see gen-pyair.js.

import { frozenPyCompiled, frozenPyBuild } from './builtins.js';

const _frozenPyairData =
// DATA
${data(hot)}
// END DATA
;
Object.assign(frozenPyCompiled, _frozenPyairData);
frozenPyBuild.id = ${JSON.stringify(build)};
`);
const batSize = write(outBatteries, `// GENERATED by ext/adder/gen-pyair.js from ext/adder/pylib/ — do not edit; run the script.
// @gcu/adder/batteries: the rest of the frozen stdlib, AIR-compiled (${Object.keys(batteries).length} modules).
// Plain data — hand it to adder: addPrecompiled(batteries). Taken only by the adder build it was
// made with (\`build\`); any other compiles these modules on import, as without it.

const modules =
// DATA
${data(batteries)}
// END DATA
;
export default { build: ${JSON.stringify(build)}, modules };
`);
console.log(`stdlib-pyair.js: ${Object.keys(hot).length} modules, ${hotSize}; batteries.js: ${Object.keys(batteries).length} modules, ${batSize}${skipped.length ? `; not compiled (tree-walked): ${skipped.join(', ')}` : ''}`);
