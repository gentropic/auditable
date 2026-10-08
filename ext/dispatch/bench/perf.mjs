// perf.mjs — timings for the grammar rung: engine build, the hand corpus, a 45-token three-clause
// sentence, and the coordination blow-up. results/perf.txt is the recorded run.
import { createEngine, makeSession } from '../src/main.js';
import { DEMO_OBJECTS } from './demo.js';
import { readFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url);
const ont = JSON.parse(readFileSync(here('./geostats.json'), 'utf8'));
let t0 = performance.now(); const E = createEngine(ont); console.log(`engine build: ${(performance.now() - t0).toFixed(2)} ms`);
const lines = readFileSync(here('./corpus.mjs'), 'utf8').match(/^  '(.+)',$/gm).map(l => l.slice(3, -2));
const long = 'krige Cu, Ni and Co in the west and east domains with v1 and v2 and 200 m and ordinary kriging using composites into bm1, then fit a spherical variogram for Ni in every domain except oxide from the Cu samples, and then export the last variogram as csv';
for (const [name, set] of [['corpus (44)', lines], ['long 45-token', [long]]]) {
  const S = makeSession(structuredClone(DEMO_OBJECTS));
  for (let i = 0; i < 50; i++) for (const l of set) E.understand(l, S);   // warm
  t0 = performance.now(); const N = 200;
  for (let i = 0; i < N; i++) for (const l of set) E.understand(l, makeSession(structuredClone(DEMO_OBJECTS)));
  const per = (performance.now() - t0) / (N * set.length);
  console.log(`${name.padEnd(16)} ${per.toFixed(3)} ms/sentence`);
}
const r = E.understand(long, makeSession(structuredClone(DEMO_OBJECTS))); console.log(`long: ${r.status}, ${r.diag.parses} syntactic parses`);
// worst case: ambiguity blow-up — many "and" lists in one PP
const S = makeSession(structuredClone(DEMO_OBJECTS));
for (const n of [4, 8, 12, 16]) { const l = 'krige Cu with ' + Array.from({ length: n }, (_, i) => i % 2 ? '200 m' : 'v1').join(' and '); t0 = performance.now(); const r = E.understand(l, S); console.log(`${n} coordinated values: ${(performance.now() - t0).toFixed(2)} ms, ${r.diag.parses} parses, ${r.status}`); }
const SRC = ['earley.js', 'locales/en.js', 'locales/pt.js', 'grammar.js', 'engine.js'].reduce((n, f) => n + readFileSync(here('../src/grammar/' + f), 'utf8').length, 0);
console.log('engine source:', (SRC / 1024).toFixed(1), 'KB; ontology', (readFileSync(here('./geostats.json'), 'utf8').length / 1024).toFixed(1), 'KB');
