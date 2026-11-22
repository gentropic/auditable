#!/usr/bin/env node
// Bundle ext/pdf/src/ into ext/pdf/index.js via @gcu/build. Zero-dependency leaf: a small PDF
// writer with a canvas-2D context, consumed by @gcu/plot (savefig .pdf), compo, micro.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/pdf/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
