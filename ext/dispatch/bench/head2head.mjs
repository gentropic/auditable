// head2head.mjs — clause strict / repair / CRF-informed repair (mixed) / dispatch perceptrons / the cascade,
// on the same generated domain. usage: node bench/head2head.mjs   (results/head2head.txt is the recorded run)
import { createEngine, makeSession } from '../src/main.js';
import { genCommand, randomSession, mutate, reseed } from './fuzz.mjs';
import { deriveVocab } from '../src/vocab.js';
import { createContext } from '../src/features.js';
import { trainModels } from '../src/train.js';
import { tokenize as dtok, normText, mulberry32 } from '../src/text.js';
import { readFileSync } from 'node:fs';

const ont = JSON.parse(readFileSync(new URL('./geostats.json', import.meta.url), 'utf8'));
const E = createEngine(ont);
const NOUN = Object.fromEntries(ont.nouns.map(n => [n.type, n]));

// ---- dispatch session vocabulary from the same ontology (what deriveVocab would get from a host) ----
const vocab = deriveVocab({
  numCols: Object.fromEntries(Object.entries(NOUN.variable.words).map(([v, ws]) => [v, { syn: ws }])),
  catCols: { DOMAIN: NOUN.domain.generic, METHOD: ['method'], MODEL: ['model'], FORMAT: ['format'] },
  catValues: { DOMAIN: NOUN.domain.words, METHOD: NOUN.method.words, MODEL: NOUN.vmodel.words, FORMAT: NOUN.format.words },
  layers: { v1: ['v1'], v2: ['v2'], v3: ['v3'], v4: ['v4'], r1: ['r1'], r2: ['r2'], bm1: ['bm1'], bm2: ['bm2'] },
});
const ctx = createContext(vocab);

// ---- training corpus: the clause generator, with role tags per token (this is what a `frame` kind's render+align would emit) ----
function example(g) {
  const toks = [], tags = [];
  const verbToks = dtok(g.text).slice(0, dtok(g.text).length - dtok(g.parts.map(p => p.text).join(' ')).length);
  for (const t of verbToks) { toks.push(t); tags.push('O'); }
  for (const p of g.parts) {
    if (p.role === 'THEME') for (const t of dtok(p.text)) { toks.push(t); tags.push('THEME'); }
    else { for (const t of dtok(p.prep)) { toks.push(t); tags.push('O'); } for (const t of dtok(p.value)) { toks.push(t); tags.push(`R_${p.role}`); } }
  }
  return { toks, tags, intent: g.verb, text: g.text, expected: g.expected, S: g.S };
}
function gen(n, seed) {
  reseed(seed); const out = []; const seen = new Set();
  while (out.length < n) { const S = randomSession(); const g = genCommand(S); g.S = S; const k = normText(g.text); if (seen.has(k)) continue; seen.add(k); out.push(example(g)); }
  return out;
}
const TRAIN = gen(2000, 1), TEST = gen(600, 2).filter(x => !new Set(TRAIN.map(t => normText(t.text))).has(normText(x.text)));
let t0 = performance.now();
const refusals = vocab.L.refusals.map(q => ({ toks: dtok(q), tags: null, intent: 'REFUSE' }));
const W = trainModels([...TRAIN, ...refusals], ctx, { epochs: 25 });
console.log(`dispatch trained on ${TRAIN.length} generated utterances in ${((performance.now() - t0) / 1000).toFixed(2)} s; tags: ${W.tags.join(' ')}\n`);

// ---- dispatch inference (dispatch's own scorer + Viterbi), assembly through clause's binder ----
function score(toks) { const f = ctx.intentFeatures(toks); const s = {}; for (const [c, wv] of Object.entries(W.intent)) { let v = wv._bias || 0; for (const [k, x] of f) v += (wv[k] || 0) * x; s[c] = v; } return s; }
function viterbi(toks) {
  const per = ctx.tokenFeatures(toks), T = W.tags, n = toks.length;
  const emit = (i, t) => { const wv = W.tag[T[t]]; if (!wv) return 0; let s = 0; for (const k of per[i]) s += wv[k] || 0; return s; };
  const dp = Array.from({ length: n }, () => new Float64Array(T.length).fill(-1e9)), bp = Array.from({ length: n }, () => new Int32Array(T.length));
  for (let t = 0; t < T.length; t++) dp[0][t] = emit(0, t) + (W.trans[`^>${T[t]}`] || 0);
  for (let i = 1; i < n; i++) for (let t = 0; t < T.length; t++) { const e = emit(i, t); for (let p = 0; p < T.length; p++) { const s = dp[i - 1][p] + (W.trans[`${T[p]}>${T[t]}`] || 0) + e; if (s > dp[i][t]) { dp[i][t] = s; bp[i][t] = p; } } }
  let best = 0; for (let t = 1; t < T.length; t++) if (dp[n - 1][t] > dp[n - 1][best]) best = t;
  const out = new Array(n); for (let i = n - 1, t = best; i >= 0; i--) { out[i] = T[t]; t = bp[i][t]; } return out;
}
function dispatch(text, S, minMargin = 0.5) {
  const toks = dtok(text); if (!toks.length) return { status: 'reject' };
  const ranked = Object.entries(score(toks)).sort((a, b) => b[1] - a[1]);
  const [intent, top] = ranked[0]; const margin = top - (ranked[1]?.[1] ?? 0);
  if (intent === 'REFUSE' || margin < minMargin) return { status: 'reject', margin };
  const tags = viterbi(toks);
  const groups = {};
  for (let i = 0; i < toks.length; i++) if (tags[i] !== 'O') (groups[tags[i]] ??= []).push(toks[i]);
  const theme = groups.THEME?.join(' '); const roles = {};
  for (const [k, ws] of Object.entries(groups)) if (k.startsWith('R_')) roles[k.slice(2)] = ws.join(' ');
  const a = E.assemble({ verb: intent, theme, roles }, makeSession(structuredClone(S.objects)));
  return { ...a, margin };
}
const clause = (text, S) => E.understand(text, makeSession(structuredClone(S.objects), S.now));
const repair = (text, S) => E.understand(text, makeSession(structuredClone(S.objects), S.now), { repair: { budget: 3 } });
// CRF tags mapped onto clause's tokens (clause merges multiword lexemes; take the tag of the first covered word)
function tagsFor(text, S) {
  const dt = dtok(text); const tags = viterbi(dt);
  const { toks } = E.tokenize(text, makeSession(structuredClone(S.objects), S.now));
  const out = []; let j = 0;
  for (const t of toks) { const words = t.word.split(' '); while (j < dt.length && dt[j] !== words[0]) j++; out.push(tags[j] ?? null); j += words.length; }
  return out;
}
const mixed = (text, S) => E.understand(text, makeSession(structuredClone(S.objects), S.now), { repair: { budget: 3, tags: tagsFor(text, S) } });
const cascade = (text, S) => { const c = clause(text, S); if (c.status === 'ok') return { ...c, via: 'clause' }; const m = repair(text, S); if (m.status === 'ok') return { ...m, via: 'repair' }; const d = dispatch(text, S); return { ...d, via: 'dispatch' }; };

// ---- perturbations: what people actually type ----
const R = mulberry32(5); const pick = a => a[(R() * a.length) | 0];
const sloppy = {
  'clean': t => t,
  'one-word mutation': t => mutate(t).text,
  'drop a preposition': t => { const w = t.split(' '); const i = w.findIndex((x, k) => k > 0 && ['in', 'with', 'using', 'for', 'from', 'to', 'at', 'as', 'into', 'on', 'by'].includes(x)); if (i > 0) w.splice(i, 1); return w.join(' '); },
  'object after the PPs': t => { const w = t.split(' '); const i = w.findIndex((x, k) => k > 1 && ['in', 'with', 'using', 'for', 'from', 'to', 'at', 'as', 'into', 'on', 'by'].includes(x)); if (i < 2) return t; const obj = w.slice(1, i); return [w[0], ...w.slice(i), ...obj].join(' '); },
  'heavy typo (3 edits)': t => { const w = t.split(' '); const cands = w.map((x, i) => i).filter(i => w[i].length > 5); if (!cands.length) return t; const i = pick(cands); let x = w[i]; for (let k = 0; k < 3; k++) { const p = (R() * x.length) | 0; x = x.slice(0, p) + pick('abcdefghijklmnopqrstuvwxyz') + x.slice(p + 1); } w[i] = x; return w.join(' '); },
  'chatty wrapper': t => pick([`hey can you ${t} for me`, `${t} thanks`, `ok so ${t} now`, `i want you to ${t}`]),
};
function scoreSys(name, fn, set, want) {
  const r = { correct: 0, wrong: 0, refused: 0 };
  for (let i = 0; i < set.length; i++) { const out = fn(set[i].text, set[i].S); if (out.status === 'ok') { if (out.echo === want[i]) r.correct++; else r.wrong++; } else r.refused++; }
  const n = set.length; return `${name.padEnd(9)} ✓${String(r.correct).padStart(4)} (${(100 * r.correct / n).toFixed(0).padStart(3)}%)  wrong ${String(r.wrong).padStart(3)} (${(100 * r.wrong / n).toFixed(1).padStart(4)}%)  refused ${String(r.refused).padStart(3)}`;
}
const WANT = TEST.map(x => x.expected.map(E.echo).join(' Then: '));
console.log(`held-out test: ${TEST.length} utterances (none seen in training)\n`);
for (const [name, f] of Object.entries(sloppy)) {
  const set = TEST.map(x => ({ ...x, text: f(x.text) }));
  console.log(`— ${name} —`);
  console.log('  ' + scoreSys('strict', clause, set, WANT));
  console.log('  ' + scoreSys('repair', repair, set, WANT));
  console.log('  ' + scoreSys('mixed', mixed, set, WANT));
  console.log('  ' + scoreSys('dispatch', dispatch, set, WANT));
  console.log('  ' + scoreSys('cascade', cascade, set, WANT));
}
// where the cascade's dispatch leg gets it wrong: show a few
console.log('\nsamples where mixed accepted the wrong meaning (object after the PPs):');
let shown = 0;
for (let i = 0; i < TEST.length && shown < 5; i++) { const t = sloppy['object after the PPs'](TEST[i].text); const d = mixed(t, TEST[i].S); if (d.status === 'ok' && d.echo !== WANT[i]) { console.log(`  › ${t}\n    want: ${WANT[i]}\n    got:  ${d.echo}\n    via:  ${d.diag.repairs.join('; ')}`); shown++; } }
