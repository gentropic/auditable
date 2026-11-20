#!/usr/bin/env node
// Bundle the condenser VIEW for pages — @gcu/condenser/view → ext/condenser/view/index.js.
// The same viewer the Jupyter widget runs (src/view.js), behind the JS API (src/api.js).
// The engine (../index.js) and @gcu/drillhole ride inline, so the bundle is one
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
  inline: ['../index.js', '../../drillhole/src/samples.js', '../../drillhole/src/desurvey.js', '../../drillhole/src/validate.js'],
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
writeFileSync(path, out);
const kb = (n) => (n / 1024).toFixed(1);
const gz = gzipSync(out).length, gzPq = gzipSync(pqSrc).length;
console.log(`Built ext/condenser/view/${OUT} (${kb(out.length)} KB, ${kb(gz)} KB gzipped — of which the embedded parquet reader ${kb(gzPq)} KB)`);
