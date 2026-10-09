// numpy parity for the adder bridges (spec_inbox/lang/line-numpy-parity-spec.md): under a
// numpy-shaped name a call either MATCHES real numpy or RAISES. The corpus and real numpy's
// answers live in test/numpy-parity/ (regenerate golden.json with `python test/numpy-parity/gen.py`).
// Each bridge is held to its list in known.json: a silent difference not listed fails, and a
// listed one that now matches fails too (so the list shrinks as fixes land). Raised calls are
// coverage, reported, not failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBridge, corpus } from './numpy-parity/run.mjs';

const known = JSON.parse(readFileSync(new URL('./numpy-parity/known.json', import.meta.url), 'utf8'));

for (const name of ['line', 'natra']) {
  test(`numpy parity — ${name}: no silent difference beyond known.json`, async () => {
    const res = await runBridge(name);
    const listed = known[name] || {};
    const mism = Object.entries(res).filter(([, r]) => r.status === 'mismatch');
    const unlisted = mism.filter(([id]) => !(id in listed)).map(([id, r]) => `${id}: ${r.why}`);
    const fixed = Object.keys(listed).filter((id) => res[id] && res[id].status !== 'mismatch');
    const counts = { match: 0, raised: 0, mismatch: 0 };
    for (const r of Object.values(res)) counts[r.status] = (counts[r.status] || 0) + 1;
    console.log(`# ${name}: ${counts.match} match · ${counts.raised} raised · ${counts.mismatch} known mismatch (of ${corpus.cases.length})`);
    assert.deepEqual(unlisted, [], `NEW silent differences in ${name}`);
    assert.deepEqual(fixed, [], `${name}: these now match or raise — remove them from known.json`);
  });
}
