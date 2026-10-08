// @gcu/dispatch — the grammar rung (clause). Gates from the fold-in:
//   • the hand corpora reproduce the golden files byte for byte (strict mode verdicts + echoes)
//   • the fuzzer round-trips 100% of generated sentences in both locales
//   • frames-from regenerates a frame for every demo tool
//   • trainModels derives its tag set from the corpus (the one change the rung needed in dispatch)
// Bench numbers (head-to-head, perf, calibration) are recorded in ext/dispatch/bench/results/, not asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngine, makeSession, ENGLISH, PORTUGUESE, framesFrom, tagSetOf, trainModels, createContext, deriveVocab } from '../ext/dispatch/src/main.js';
import { runCorpus, CORPUS_EN, ONTOLOGY } from '../ext/dispatch/bench/corpus.mjs';
import { CORPUS_PT } from '../ext/dispatch/bench/corpus-pt.mjs';
import { GOLEM, GOLEM_EN, GOLEM_PT } from '../ext/dispatch/bench/golem-corpus.mjs';
import { DEMO_OBJECTS, DEMO_TOOLS } from '../ext/dispatch/bench/demo.js';

const bench = (p) => new URL('../ext/dispatch/bench/' + p, import.meta.url);
const golden = (p) => readFileSync(bench('golden/' + p), 'utf8').replace(/\r\n/g, '\n');

test('grammar: English corpus matches golden/corpus-en.txt', () => {
  assert.equal(runCorpus(CORPUS_EN, ENGLISH), golden('corpus-en.txt'));
});

test('grammar: Portuguese corpus matches golden/corpus-pt.txt', () => {
  assert.equal(runCorpus(CORPUS_PT, PORTUGUESE), golden('corpus-pt.txt'));
});

test('grammar: golem register (bare phrases, closed questions) matches golden/golem-en.txt', () => {
  assert.equal(runCorpus(GOLEM_EN, ENGLISH, { ontology: GOLEM, objects: [] }), golden('golem-en.txt'));
});

test('grammar: golem register matches golden/golem-pt.txt', () => {
  assert.equal(runCorpus(GOLEM_PT, PORTUGUESE, { ontology: GOLEM, objects: [] }), golden('golem-pt.txt'));
});

test('grammar: an elided verb binds through the ontology, a closed question is the same command', () => {
  const E = createEngine(GOLEM, ENGLISH);
  const S = makeSession([]);
  const bare = E.understand('density of chalcopyrite', S);
  const asked = E.understand('what is the density of chalcopyrite?', S);
  assert.equal(bare.status, 'ok');
  assert.equal(bare.commands[0].verb, 'lookup');
  assert.equal(asked.echo, bare.echo);
  const conv = E.understand('what is 2 km in miles', S);
  assert.equal(conv.commands[0].verb, 'convert');
  assert.deepEqual(conv.commands[0].roles.unit.map((u) => u.unit), ['mi']);
  const which = E.understand('which countries are landlocked', S);
  assert.equal(which.commands[0].verb, 'list');
  assert.equal(which.commands[0].theme[0].attrs.filter, 'landlocked');
  const bareNoun = E.understand('cu', S);
  assert.equal(bareNoun.status, 'reject', 'a thing nothing takes on its own is refused, not guessed');
  const open = E.understand('why is the density so high', S);
  assert.equal(open.status, 'outofscope');
  const geo = createEngine(ONTOLOGY, ENGLISH);
  assert.equal(geo.understand('Cu', makeSession(structuredClone(DEMO_OBJECTS))).status, 'reject', 'no elidable frame in geostats: a bare noun stays refused');
});

test('grammar: a verdict carries its explanation', () => {
  const E = createEngine(ONTOLOGY, ENGLISH);
  const S = makeSession(structuredClone(DEMO_OBJECTS));
  const ok = E.understand('krige Cu in the west domain with v2 and a 200 m search', S);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.commands.length, 1);
  assert.equal(ok.commands[0].verb, 'krige');
  assert.deepEqual(ok.commands[0].roles.domain.map((d) => d.value), ['west']);
  const q = E.understand('why is the Ni estimate so smooth', S);
  assert.equal(q.status, 'outofscope');
  const junk = E.understand('krige Cu with a fluffy thing', S, { repair: { budget: 3 } });
  assert.notEqual(junk.status, 'ok', 'a repair that drops unknown words must not be an ok');
  const fixed = E.understand('krig Cu in the wset domain with v1', S, { repair: { budget: 3 } });
  assert.equal(fixed.status, 'ok');
  assert.ok(fixed.diag.notes.length || fixed.repaired, 'repairs are reported');
});

for (const fuzzer of ['fuzz.mjs', 'golem-fuzz.mjs']) for (const loc of ['en', 'pt']) {
  test(`grammar: ${fuzzer} round-trips 100% of generated sentences (${loc}, n=300)`, () => {
    const out = execFileSync(process.execPath, [fileURLToPath(bench(fuzzer)), '300', '7', loc], { encoding: 'utf8' });
    const m = /^\s+ok\s+(\d+)\s+([\d.]+)%/m.exec(out);
    assert.ok(m, 'fuzzer printed its tally');
    assert.equal(m[1], '300');
    assert.equal(m[2], '100.0');
    assert.doesNotMatch(out, /^\s+mismatch/m, 'no sentence accepted with the wrong meaning');
  });
}

test('grammar: framesFrom derives a frame for every demo tool', () => {
  const gen = framesFrom(DEMO_TOOLS, ONTOLOGY);
  assert.equal(gen.verbs.length, DEMO_TOOLS.length);
  const krige = gen.verbs.find((v) => v.name === 'krige');
  assert.deepEqual(krige.theme, ['variable']);
  assert.ok(krige.roles.search.preps.includes('with'));
  assert.ok(gen.nouns.some((n) => n.type === 'method' && n.words.OK), 'an enum parameter minted a noun type');
  const E = createEngine(gen, ENGLISH);
  const r = E.understand('krige Cu in west with v1 and 200 m', makeSession(structuredClone(DEMO_OBJECTS)));
  assert.equal(r.status, 'ok');
});

test('train: tag set is derived from the aligned corpus', () => {
  const aligned = [
    { toks: ['krige', 'cu', 'in', 'west'], tags: ['O', 'THEME', 'O', 'R_domain'], intent: 'krige' },
    { toks: ['clip', 'ni', 'at', '2'], tags: ['O', 'THEME', 'O', 'R_threshold'], intent: 'clip' },
    { toks: ['hello'], tags: null, intent: 'REFUSE' },
  ];
  assert.deepEqual(tagSetOf(aligned), ['O', 'R_domain', 'R_threshold', 'THEME']);
  const ctx = createContext(deriveVocab({ numCols: { CU: { lo: 0, hi: 5, dec: 2 } }, catCols: {}, catValues: {}, layers: {} }));
  const W = trainModels(aligned, ctx, { epochs: 3 });
  assert.deepEqual(W.tags, ['O', 'R_domain', 'R_threshold', 'THEME']);
  assert.ok(W.tag.R_domain, 'weights exist for a tag the fixed set never had');
});
