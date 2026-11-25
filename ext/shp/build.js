#!/usr/bin/env node
// Bundle ext/shp/src/ into ext/shp/index.js via @gcu/build. Zero-dep leaf — the ESRI
// Shapefile codec (.shp/.shx/.dbf/.prj). Sidecars off: index.js is a clean self-contained ESM.
import { bundle } from '../build/src/main.js';

const r = await bundle({ at: import.meta.url, sourcemap: false, meta: false });
console.log(`Built ext/shp/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
