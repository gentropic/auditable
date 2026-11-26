#!/usr/bin/env node
// Bundle ext/stereonet/src/ into ext/stereonet/index.js via @gcu/build. No imports to resolve: bearing is
// injected (core) or loaded at run time (cell), so index.js stays a plain module a notebook can load.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/stereonet/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
