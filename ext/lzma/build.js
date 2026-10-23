#!/usr/bin/env node
// Bundle ext/lzma/src/ into ext/lzma/index.js via @gcu/build. Zero-dep leaf — adder's _lzma and
// @gcu/archive build on it. Sidecars off: index.js is a clean self-contained ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/lzma/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
