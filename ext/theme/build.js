#!/usr/bin/env node
// Bundle ext/theme/src/ into ext/theme/index.js via @gcu/build. Zero-dep leaf — the
// theme vocabulary condenser and plot share; they inline it,
// so it stays dependency-free. Sidecars off: index.js is a clean self-contained ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/theme/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
