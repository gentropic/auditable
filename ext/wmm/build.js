#!/usr/bin/env node
// Bundle ext/wmm/src/ into ext/wmm/index.js via @gcu/build. Zero-dep leaf:
// the generated coefficient table + the evaluation, as one clean ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/wmm/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
