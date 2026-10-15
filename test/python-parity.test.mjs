// CPython parity for adder, both engines: test/python-parity/corpus.txt is a spread of small
// programs, golden.json is real CPython's stdout and uncaught exception for each (regenerate with
// `python test/python-parity/gen.py`). Each engine is held to its list in known.json: a case it
// gets wrong that is not listed fails, and a listed case that now matches fails too, so the list
// only shrinks (`node test/python-parity/known.mjs` rewrites it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runEngine, corpus } from './python-parity/run.mjs';

const known = JSON.parse(readFileSync(new URL('./python-parity/known.json', import.meta.url), 'utf8'));

for (const engine of ['tree', 'auto']) {
  test(`python parity — engine ${engine}: no difference beyond known.json`, async () => {
    const res = await runEngine(engine);
    const listed = known[engine] || {};
    const mism = Object.entries(res).filter(([, r]) => r.status === 'mismatch');
    const unlisted = mism.filter(([k]) => !(k in listed)).map(([k, r]) => `${k}: ${r.why} — got ${JSON.stringify(r.got).slice(0, 120)}`);
    const fixed = Object.keys(listed).filter((k) => res[k] && res[k].status === 'match');
    console.log(`# ${engine}: ${corpus.length - mism.length} match · ${mism.length} known (of ${corpus.length})`);
    assert.deepEqual(unlisted, [], `NEW differences from CPython in engine ${engine}`);
    assert.deepEqual(fixed, [], `engine ${engine}: these now match — run node test/python-parity/known.mjs`);
  });
}
