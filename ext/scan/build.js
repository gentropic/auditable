#!/usr/bin/env node
// Bundle ext/scan/src/ into TWO self-contained ESM files via @gcu/build:
//   index.js  — the page: createScan (run · sources · zones · pool · Parquet jobs),
//               the kernels and the chunk view
//   worker.js — what a pool worker imports: serve(self)
// Neither imports anything (libraries are injected — src/api.js), so both drop
// into a registry/blob build or a plain directory unchanged.
import { bundle } from '../build/src/main.js';

const page = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
const worker = await bundle({ at: import.meta.url, entry: 'src/worker-main.js', outFile: 'worker.js', sourcemap: false, meta: false });
console.log(`Built ext/scan/index.js (${(page.code.length / 1024).toFixed(1)} KB, ${page.meta.exports.length} exports) + worker.js (${(worker.code.length / 1024).toFixed(1)} KB)`);
