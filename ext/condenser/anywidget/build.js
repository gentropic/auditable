#!/usr/bin/env node
// Bundle the anywidget ESM into the Python package's static/ dir. The engine
// rides along INLINE (the built ../index.js — engine + the file providers,
// which via='files' reads through), so the widget ships as one self-contained
// module: nothing is fetched at runtime, which is what makes it usable on an
// air-gapped analysis box.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bundle } from '../../build/src/main.js';

const OUT = 'gcu/condenser/static/widget.js';
const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, 'gcu/condenser/static'), { recursive: true });
const r = await bundle({
  at: import.meta.url,
  entry: 'src/widget.js',
  outFile: OUT,
  inline: ['../index.js', '../../drillhole/src/samples.js', '../../drillhole/src/desurvey.js', '../../drillhole/src/validate.js'],
  sourcemap: false,
  meta: false,
});

const path = join(HERE, OUT);
// @gcu/parquet cannot ride the source merge (vendored minified bundle, ALIASED
// exports) — it embeds as a string and blob-imports on first parquet open.
// Substituted here, not via define: the value is the whole 117 KB bundle.
const pqSrc = readFileSync(join(HERE, '../../parquet/index.js'), 'utf8');
let out = readFileSync(path, 'utf8');
if (!out.includes('__PARQUET_SRC__')) throw new Error('anywidget build: the __PARQUET_SRC__ marker is gone');
out = out.replace('__PARQUET_SRC__', () => JSON.stringify(pqSrc));   // fn form: $-sequences in the source stay literal
writeFileSync(path, out);

// anywidget loads the module and reads its DEFAULT export; @gcu/build emits
// named exports only (§ rename-on-collision needs names). One appended line
// bridges the two contracts — no source-level exception in the bundler.
appendFileSync(path, '\nexport default { render };\n');
console.log(`Built ext/condenser/anywidget/${OUT} (${((out.length + 30) / 1024).toFixed(1)} KB)`);
