#!/usr/bin/env node
// Bundle ext/compo/src/ into ext/compo/index.js via @gcu/build. @gcu/pdf is INLINED (it is the
// export path, 41 KB) so the bundle drops into a host on its own.
import { bundle } from '../build/src/main.js';

const r = await bundle({
  at: import.meta.url,
  inline: ['../pdf/src/main.js', '../pdf/src/document.js', '../pdf/src/context.js', '../pdf/src/sizes.js', '../pdf/src/fonts.js', '../pdf/src/color.js'],
  sourcemap: false, meta: false,
});
console.log(`Built ext/compo/index.js (${(r.code.length / 1024).toFixed(1)} KB, ${r.meta.exports.length} exports)`);
