#!/usr/bin/env node
// Bundle ext/geometry/src/ into ext/geometry/index.js via @gcu/build. Zero deps, so
// nothing to inline: index.js is a clean self-contained ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/geometry/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
