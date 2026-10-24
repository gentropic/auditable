#!/usr/bin/env node
// Vendor @gcu/wireframe (the .wfr mesh format) from its own repo into ext/wireframe/index.js via
// @gcu/build. The source of truth is github.com/gentropic/wireframe (sibling checkout ../wireframe,
// or WIREFRAME_SRC=<repo>); this copies its browser-safe entry (js/src/index.js — no node:
// imports) as one self-contained ESM bundle, the way @gcu/bearing is vendored. Rerun after
// changing wireframe, then commit both.
import { bundle } from '../build/src/main.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(process.env.WIREFRAME_SRC || join(here, '../../../wireframe'));
const dir = join(repo, 'js');
if (!existsSync(join(dir, 'src/index.js'))) throw new Error(`wireframe source not found at ${dir} — clone gentropic/wireframe beside auditable or set WIREFRAME_SRC`);
let rev = 'unknown';
try { rev = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
// two bundles: the core (read/write) and the streamed format adapters (PLY/OBJ/DXF → writer)
for (const [entry, out] of [['src/index.js', 'index.js'], ['src/convert.js', 'convert.js']]) {
  const r = bundle({
    dir, entry, write: false, sourcemap: false, meta: false,
    header: `// @gcu/wireframe ${pkg.version} (${entry}) — vendored from gentropic/wireframe@${rev} by ext/wireframe/build.js (do not edit; MIT)`,
  });
  writeFileSync(join(here, out), r.code);
  console.log(`Built ext/wireframe/${out} (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports) from wireframe@${rev}`);
}
