// calib.mjs — coordinate descent over the repair costs against the mutation benchmark. Deterministic.
// objective = correct − 3·wrong  (a wrong accept is three times worse than a refusal)
import { createEngine, makeSession } from '../src/main.js';
import { genCommand, randomSession, mutate, reseed } from './fuzz.mjs';
import { readFileSync } from 'node:fs';
const ont = JSON.parse(readFileSync(new URL('./geostats.json', import.meta.url), 'utf8')); const E = createEngine(ont);
const N = +process.argv[2] || 150;
reseed(3); const SET = [];
while (SET.length < N) { const S = randomSession(); const g = genCommand(S); SET.push({ ...g, S, want: g.expected.map(E.echo).join(' Then: ') }); }
let seed = 11; const rnd = () => { seed += 0x6D2B79F5; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[(rnd() * a.length) | 0];
const PREPS = ['in', 'with', 'using', 'for', 'from', 'to', 'at', 'as', 'into', 'on', 'by'];
const perturb = {
  dropPrep: t => { const w = t.split(' '); const i = w.findIndex((x, k) => k > 0 && PREPS.includes(x)); if (i > 0) w.splice(i, 1); return w.join(' '); },
  reorder: t => { const w = t.split(' '); const i = w.findIndex((x, k) => k > 1 && PREPS.includes(x)); if (i < 2) return t; return [w[0], ...w.slice(i), ...w.slice(1, i)].join(' '); },
  typo: t => { const w = t.split(' '); const c = w.map((x, i) => i).filter(i => w[i].length > 4); if (!c.length) return t; const i = pick(c); const p = 1 + ((rnd() * (w[i].length - 2)) | 0); w[i] = w[i].slice(0, p) + w[i].slice(p + 1); return w.join(' '); },
  chatty: t => pick([`hey can you ${t} for me`, `${t} thanks`, `ok so ${t} now`, `i want you to ${t}`, `${t} quickly`]),
  mutation: t => mutate(t).text,
};
const CASES = SET.flatMap(x => Object.entries(perturb).map(([k, f]) => ({ ...x, text: f(x.text), kind: k })));
function score(costs, budget) {
  let correct = 0, wrong = 0, refused = 0; const byKind = {};
  for (const c of CASES) {
    const r = E.understand(c.text, makeSession(structuredClone(c.S.objects), c.S.now), { repair: { budget, costs } });
    const k = byKind[c.kind] ??= { c: 0, w: 0 };
    if (r.status === 'ok') { if (r.echo === c.want) { correct++; k.c++; } else { wrong++; k.w++; } } else refused++;
  }
  return { obj: correct - 3 * wrong, correct, wrong, refused, byKind };
}
const KNOBS = { skipFunc: [0.3, 0.5, 0.8], skipUnk: [0.4, 0.6, 0.9], skipContent: [1, 1.5, 2], insPrep: [0.6, 1, 1.4], order: [0.6, 1, 1.4], subst1: [0.3, 0.5, 0.8], substKnown: [1, 2, 3], budget: [2.5, 3, 4] };
let cur = { skipFunc: 0.5, skipUnk: 0.6, skipContent: 1.5, insPrep: 1, order: 1, subst1: 0.4, substKnown: 2, budget: 3 };
const evalAt = c => score({ ...c, subst2: c.subst1 * 3 }, c.budget);
let best = evalAt(cur); console.log(`start   obj=${best.obj}  ✓${best.correct} ✗${best.wrong} –${best.refused}   (${CASES.length} cases)`);
for (let sweep = 0; sweep < 2; sweep++) for (const [k, vals] of Object.entries(KNOBS)) {
  for (const v of vals) { if (v === cur[k]) continue; const c = { ...cur, [k]: v }; const r = evalAt(c); if (r.obj > best.obj) { best = r; cur = c; console.log(`  ${k}=${v}  obj=${r.obj}  ✓${r.correct} ✗${r.wrong} –${r.refused}`); } }
}
console.log('\nbest costs:', JSON.stringify(cur));
console.log('by perturbation:', Object.entries(best.byKind).map(([k, v]) => `${k} ✓${v.c}/${N} ✗${v.w}`).join('  '));
