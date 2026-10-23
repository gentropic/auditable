#!/usr/bin/env node
// Bundle ext/bz2/src/ into ext/bz2/index.js via @gcu/build. Zero-dep leaf — adder's _bz2 and
// @gcu/archive build on it. Sidecars off: index.js is a clean self-contained ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/bz2/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
