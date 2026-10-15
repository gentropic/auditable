// Write known.json from the current state: every case each engine still gets wrong, with the
// reason. Run after a fix lands (the test fails on a listed case that now matches, so the list
// only shrinks):  node test/python-parity/known.mjs
import { writeFileSync } from 'node:fs';
import { runEngine } from './run.mjs';

const known = { about: 'Cases each adder engine still gets wrong against CPython (golden.json). test/python-parity.test.mjs fails on a mismatch NOT listed here, and on a listed case that now matches. Regenerate with node test/python-parity/known.mjs after a fix.' };
for (const engine of ['tree', 'auto']) {
  const res = await runEngine(engine);
  known[engine] = Object.fromEntries(Object.entries(res).filter(([, r]) => r.status === 'mismatch').map(([k, r]) => [k, r.why]));
}
writeFileSync(new URL('known.json', import.meta.url), JSON.stringify(known, null, 1) + '\n');
console.log(`known.json: tree ${Object.keys(known.tree).length}, auto ${Object.keys(known.auto).length}`);
