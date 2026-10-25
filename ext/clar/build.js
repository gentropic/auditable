#!/usr/bin/env node
// Bundle ext/clar/src/ into ext/clar/index.js via @gcu/build.
//
// @gcu/geometry's topology is INLINED — clar's bundle should be droppable on its own,
// and the topology is 170 lines. @gcu/bearing is NOT: it is 128 KB of vendored
// stereonet library that micro needs in its own right, so it stays a bare
// specifier and the host resolves one copy through its import map.
import { bundle } from '../build/src/main.js';

const r = await bundle({
  at: import.meta.url,
  inline: ['../geometry/src/topology.js'],
  sourcemap: false,
  meta: false,
});
console.log(`Built ext/clar/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
