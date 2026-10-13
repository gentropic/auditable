// Fragments (understand with { fragment: true }): what is left of a command when the rest is the session's last one —
// "and chile", "in feet", "log scale", "same for peru". `node golem-fragments.mjs` prints the verdicts;
// golden/golem-fragments.txt is the gate.
import { createEngine, makeSession, ENGLISH } from '../src/main.js';
import { GOLEM } from './golem-corpus.mjs';

const E = createEngine(GOLEM, ENGLISH), S = makeSession([]);
const out = [];
const run = (q, frag) => { const r = E.understand(q, S, frag ? { fragment: true } : {}); out.push(`${frag ? '  … ' : ''}${r.status === 'ok' ? '✓' : '✗'} ${q}\n    → ${r.echo || r.status.toUpperCase() + ': ' + (r.reasons || []).join('; ')}`); };
for (const [cmd, frags] of [
  ['population density of mongolia in people per square mile', ['and chile', 'in people per km2', 'brazil', 'same for peru']],
  ['2 km in miles', ['in feet', 'and in km', 'again but in miles']],
  ['histogram of cu', ['log scale', 'of gold', 'in linear scale']],
  ['define treap', ['frobnicate']],
]) { run(cmd); for (const f of frags) run(f, true); }

export const FRAGMENTS = out.join('\n') + '\n';
if (/golem-fragments\.mjs$/.test(process.argv[1] ?? '')) process.stdout.write(FRAGMENTS);
