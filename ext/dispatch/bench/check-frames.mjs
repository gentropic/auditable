// check-frames.mjs — derive verb frames from the demo tool manifest (frames-from.js) and diff them
// against the hand-written ontology; then replay the English corpus under the generated frames and
// report every verdict that changed. The bridge an adoptMcpTool() will need to keep honest.
import { framesFrom, createEngine, makeSession, PORTUGUESE } from '../src/main.js';
import { DEMO_OBJECTS, DEMO_TOOLS } from './demo.js';
import { readFileSync } from 'node:fs';
const here = (p) => new URL(p, import.meta.url);
const hand = JSON.parse(readFileSync(here('./geostats.json'), 'utf8'));
const gen = framesFrom(DEMO_TOOLS, hand);

// 1. frame diff: generated vs hand-written
console.log('FRAME DIFF (generated vs hand):');
for (const g of gen.verbs) {
  const h = hand.verbs.find(v => v.name === g.name); const diffs = [];
  if (JSON.stringify(h.theme) !== JSON.stringify(g.theme)) diffs.push(`theme ${JSON.stringify(h.theme)} → ${JSON.stringify(g.theme)}`);
  for (const k of new Set([...Object.keys(h.roles), ...Object.keys(g.roles)])) {
    const a = h.roles[k], b = g.roles[k];
    if (!a) diffs.push(`+role ${k}`); else if (!b) diffs.push(`-role ${k}`);
    else { if (JSON.stringify(a.preps) !== JSON.stringify(b.preps)) diffs.push(`${k}.preps ${a.preps} → ${b.preps}`); if (JSON.stringify(a.types) !== JSON.stringify(b.types)) diffs.push(`${k}.types ${a.types} → ${b.types}`); }
  }
  console.log(`  ${g.name.padEnd(10)} ${diffs.length ? diffs.join(' | ') : 'identical'}`);
}
// 2. does the hand corpus give the same verdicts under the generated ontology?
const lines = readFileSync(here('./corpus.mjs'), 'utf8').match(/^  '(.+)',$/gm).map(l => l.slice(3, -2));
const run = (ont, loc) => { const { understand } = createEngine(ont, loc); const S = makeSession(structuredClone(DEMO_OBJECTS)); return lines.map(l => { const r = understand(l, S); return r.status + ' ' + (r.echo ?? r.readings?.join('|') ?? r.reasons.join(';')); }); };
const A = run(hand), B = run(gen);
let same = 0; const diff = [];
A.forEach((a, i) => a === B[i] ? same++ : diff.push([lines[i], a, B[i]]));
console.log(`\nCORPUS under generated ontology: ${same}/${lines.length} identical verdicts`);
for (const [l, a, b] of diff) console.log(`  › ${l}\n    hand: ${a}\n    gen:  ${b}`);
// 3. and Portuguese, which never saw the manifest
const { understand } = createEngine(gen, PORTUGUESE); const S = makeSession(structuredClone(DEMO_OBJECTS));
console.log('\nPT on generated frames:');
for (const l of ['kriga o cobre no domínio oeste com o variograma v2 e uma busca de 200 m', 'ajusta um variograma esférico pro Ni no leste, depois kriga o Ni no leste com ele', 'corta Cu no oeste']) { const r = understand(l, S); console.log(`  ${r.status.padEnd(8)} ${l}\n           ${r.echo ?? r.reasons.join('; ')}`); }
