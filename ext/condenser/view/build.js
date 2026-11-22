#!/usr/bin/env node
// Bundle the condenser VIEW for pages — @gcu/condenser/view → ext/condenser/view/index.js.
// The same viewer the Jupyter widget runs (src/view.js), behind the JS API (src/api.js).
// The engine (../index.js), @gcu/drillhole and @gcu/plot (the axes around locked views)
// ride inline, so the bundle is one
// self-contained ES module: nothing fetched at runtime, no eval, no WASM.
//   node ext/condenser/view/build.js        (after node ext/condenser/build.js)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { bundle } from '../../build/src/main.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = 'index.js';
await bundle({
  at: import.meta.url,
  entry: 'src/api.js',
  outFile: OUT,
  inline: ['../index.js', '../../theme/src/theme.js', '../../plot/src/scale.js', '../../plot/src/figure.js', '../../plot/src/nice.js', '../../plot/src/ticks.js', '../../drillhole/src/samples.js', '../../drillhole/src/desurvey.js', '../../drillhole/src/validate.js'],
  sourcemap: false,
  meta: false,
});

// @gcu/parquet cannot ride the source merge (vendored minified bundle, aliased exports):
// it embeds as a string and blob-imports on the first parquet file opened (files mode only)
const path = join(HERE, OUT);
const pqSrc = readFileSync(join(HERE, '../../parquet/index.js'), 'utf8');
let out = readFileSync(path, 'utf8');
if (!out.includes('__PARQUET_SRC__')) throw new Error('view build: the __PARQUET_SRC__ marker is gone');
out = out.replace('__PARQUET_SRC__', () => JSON.stringify(pqSrc));
// the bundler forbids a literal dynamic import in source, so the source reaches it through
// new Function — which a no-eval CSP refuses. After bundling the literal form is safe: put it back.
const DYN = "new Function('u', 'return import(u)')";
if (out.split(DYN).length !== 2) throw new Error('view build: the parquet dynamic-import site moved');
out = out.replace(DYN, () => '((u) => import(u))');
writeFileSync(path, out);
// the same bundle as a CLASSIC script (exports on window.gcuCondenser): for pages that cannot load
// a module. Its streaming worker boots from the script's own URL as a classic worker.
const { toClassic } = await import('../../classic-wrap.mjs');
writeFileSync(join(HERE, 'index.classic.js'), toClassic(out, { global: 'gcuCondenser',
  replace: [["const WORKER_TYPE = 'module';", "const WORKER_TYPE = 'classic';"]],
  banner: '@gcu/condenser/view — classic-script build of index.js (generated; do not edit).\n<script src="index.classic.js"></script> then: const { view, blocks } = gcuCondenser;' }));
console.log('Built ext/condenser/view/index.classic.js (window.gcuCondenser)');
// llms.txt is API.md, for models — written here so the two can't drift (they had)
writeFileSync(join(HERE, 'llms.txt'), readFileSync(join(HERE, 'API.md'), 'utf8'));
const kb = (n) => (n / 1024).toFixed(1);
const gz = gzipSync(out).length, gzPq = gzipSync(pqSrc).length;
console.log(`Built ext/condenser/view/${OUT} (${kb(out.length)} KB, ${kb(gz)} KB gzipped — of which the embedded parquet reader ${kb(gzPq)} KB)`);
