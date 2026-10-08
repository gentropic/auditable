// golem-fuzz.mjs — walk the golem ontology forward in four surface forms (bare phrase, verb, "what is …",
// "which … are …"), parse backward, score the round-trip; then mutate accepted sentences and check nothing
// is accepted with a different meaning in silence. Generic over the ontology: it reads frames, types and
// synonyms, and knows only a handful of phrase shapes per locale.
// usage: node golem-fuzz.mjs [n] [seed] [en|pt]
import { createEngine, makeSession, ENGLISH, PORTUGUESE } from '../src/main.js';
import { readFileSync } from 'node:fs';

const MAIN = /golem-fuzz\.mjs$/.test(process.argv[1] ?? '');
const N = +process.argv[2] || 2000, SEED = +process.argv[3] || 7, LOC = process.argv[4] === 'pt' ? PORTUGUESE : ENGLISH;
const ont = JSON.parse(readFileSync(new URL('./golem.json', import.meta.url), 'utf8'));
const E = createEngine(ont, LOC);

let s = SEED >>> 0;
export const reseed = (x) => { s = x >>> 0; };
const rnd = () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const col = (o, k) => o[`${k}_${LOC.code}`] ?? o[k];
const NOUN = Object.fromEntries(ont.nouns.map(n => [n.type, n]));
const values = t => Object.keys(col(NOUN[t], 'words') ?? {});
const syn = (t, v) => pick(col(NOUN[t], 'words')[v]);
const gen = t => pick(col(NOUN[t], 'generic'));
const unitsOf = dim => ont.units.filter(u => u.dim === dim);
const DIMS = [...new Set(ont.units.map(u => u.dim))];
// a surface preposition for a canonical one: identity in English, a bank lookup in Portuguese
const surf = canon => { const ws = Object.keys(LOC.preps).length ? Object.entries(LOC.preps).filter(([, c]) => c.includes(canon)).map(([w]) => w) : [canon]; return ws.length ? pick(ws) : null; };
const PHR = {
  en: { det: w => pick([w, `the ${w}`, `a ${w}`]), comp: (mod, head) => `${mod} ${head}`, whcop: q => pick(q.type === 'quantity' ? ['what is', "what's", 'how much is'] : ['what is', "what's"]), which: (g, pred) => `${pick(['which', 'what'])} ${g} ${pick(['are', 'is'])} ${pred}`, filler: () => pick(['please ', 'hey ', 'now ']) },
  pt: { det: w => pick([w, `o ${w}`, `a ${w}`, `um ${w}`, `uma ${w}`]), comp: (mod, head) => `${head} ${mod}`, whcop: q => pick(q.type === 'quantity' ? ['quanto é', 'quanto dá', 'qual é'] : ['qual é', 'o que é']), which: (g, pred) => `${pick(['quais', 'que'])} ${g} ${pick(['são', 'sao'])} ${pred}`, filler: () => pick(['por favor ', 'ei ', 'agora ']) },
}[LOC.code];

// ---- realise a thing of a type: { text, node } with the node the parser should produce ----
function realise(type) {
  if (type.startsWith('quantity:')) {
    const dim = type === 'quantity:*' ? pick(DIMS) : type.split(':')[1];
    const u = pick(unitsOf(dim)); const n = pick(dim === 'grade' ? [0.35, 1, 2.5, 5] : dim === 'time' ? [5, 10, 45] : [2, 14, 25, 200, 1500]);
    return { text: `${n} ${pick(col(u, 'words'))}`, node: { type: 'quantity', n, unit: u.unit, dim } };
  }
  if (type === 'unit') { const u = pick(ont.units); return { text: pick(col(u, 'words')), node: { type: 'unit', unit: u.unit, dim: u.dim } }; }
  const v = pick(values(type)); const w = syn(type, v);
  const node = { type, value: v, generic: false, attrs: {} };
  return { text: chance(0.4) ? PHR.det(w) : w, node };
}
// a generic head with a compound modifier: "landlocked countries" / "países sem litoral"
function realiseFiltered(headType) {
  const comps = ont.compounds.filter(c => c.heads.includes(headType) && NOUN[c.mod]);
  if (!comps.length) return null;
  const c = pick(comps); const mv = pick(values(c.mod)); const g = gen(headType);
  const text = PHR.comp(syn(c.mod, mv), g);
  return { text, pred: syn(c.mod, mv), head: g, node: { type: headType, value: null, generic: true, attrs: { [c.attr]: mv } } };
}

// ---- one command with its expected meaning; form ∈ bare | verb | whcop | which ----
export function genCommand() {
  const F = pick(ont.verbs);
  const cmd = { verb: F.name, theme: [], roles: {} };
  let themeText = null, filtered = null;
  if (F.theme.length) {
    const t = pick(F.theme);
    if (!t.startsWith('quantity') && NOUN[t]?.generic && chance(0.5) && (filtered = realiseFiltered(t))) { cmd.theme = [filtered.node]; themeText = filtered.text; }
    else { const r = realise(t); cmd.theme = [r.node]; themeText = r.text; }
  }
  const pps = [];
  for (const [k, role] of Object.entries(F.roles)) {
    if (!F.required.includes(k) && !chance(0.5)) continue;
    const r = realise(pick(role.types)); const p = surf(pick(role.preps)); if (!p) continue;
    cmd.roles[k] = [r.node]; pps.push(`${p} ${r.text}`);
  }
  shuffle(pps);
  const forms = [];
  if (themeText) {
    const core = [themeText, ...pps].join(' ');
    if (F.elidable) { forms.push({ form: 'bare', text: core }); forms.push({ form: 'whcop', text: `${PHR.whcop(cmd.theme[0])} ${core}${chance(0.3) ? '?' : ''}` }); }
    if (filtered && F.elidable) forms.push({ form: 'which', text: `${PHR.which(filtered.head, filtered.pred)} ${pps.join(' ')}`.trim() + (chance(0.3) ? '?' : '') });
  }
  forms.push({ form: 'verb', text: `${pick(col(F, 'words'))} ${[themeText, ...pps].filter(Boolean).join(' ')}` });
  const f = pick(forms);
  let text = f.text; if (chance(0.1)) text = PHR.filler() + text;
  return { text, form: f.form, expected: [cmd], verb: F.name };
}

// ---- mutations (should NOT be silently accepted with a different meaning) ----
export function mutate(text) {
  const w = text.split(' ');
  const i = Math.floor(rnd() * w.length);
  const kind = pick(['drop', 'swap', 'junk', 'dup']);
  if (kind === 'drop' && w.length > 2) w.splice(i, 1);
  else if (kind === 'swap' && i < w.length - 1) [w[i], w[i + 1]] = [w[i + 1], w[i]];
  else if (kind === 'junk') w[i] = pick(['fluffy', 'banana', 'quickly', 'xyzzy', 'tomorrow', 'fofo', 'rapidinho']);
  else if (kind === 'dup') w.splice(i, 0, w[i]);
  return { text: w.join(' '), kind };
}

if (MAIN) {
  const tally = { ok: 0, mismatch: 0, reject: 0, clarify: 0, ambiguous: 0, outofscope: 0 };
  const byForm = {};
  const ex = { mismatch: [], reject: [], clarify: [], ambiguous: [], outofscope: [] };
  const mut = { total: 0, accepted_same: 0, accepted_diff: 0, accepted_flagged: 0, refused: 0, byKind: {} };
  const exm = [];
  for (let i = 0; i < N; i++) {
    const { text, form, expected } = genCommand();
    const want = expected.map(E.echo).join(` ${LOC.phr.then}: `);
    const r = E.understand(text, makeSession([]));
    const f = byForm[form] ??= { n: 0, ok: 0 }; f.n++;
    if (r.status === 'ok') { if (r.echo === want) { tally.ok++; f.ok++; } else { tally.mismatch++; ex.mismatch.push({ text, want, got: r.echo }); } }
    else { tally[r.status]++; ex[r.status]?.push({ text, want, got: r.reasons?.join('; '), readings: r.readings }); }
    if (r.status === 'ok' && r.echo === want) {
      const m = mutate(text); mut.total++; mut.byKind[m.kind] ??= { total: 0, diff: 0 }; mut.byKind[m.kind].total++;
      const rm = E.understand(m.text, makeSession([]));
      if (rm.status === 'ok') { if (rm.echo === want) mut.accepted_same++; else if (rm.diag.notes.length) mut.accepted_flagged++; else { mut.accepted_diff++; mut.byKind[m.kind].diff++; exm.push({ kind: m.kind, from: text, to: m.text, want, got: rm.echo }); } }
      else mut.refused++;
    }
  }
  const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`;
  console.log(`golem fuzz — n=${N} seed=${SEED} locale=${LOC.code}\n`);
  console.log('GENERATED (grammatical, meaning known):');
  for (const [k, v] of Object.entries(tally)) if (v) console.log(`  ${k.padEnd(11)} ${String(v).padStart(5)}  ${pct(v, N)}`);
  console.log('  by form: ' + Object.entries(byForm).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join('  '));
  console.log(`\nMUTATED (one word dropped/swapped/junked/duplicated on ${mut.total} good sentences):`);
  console.log(`  refused        ${mut.refused}  ${pct(mut.refused, mut.total)}`);
  console.log(`  accepted, same ${mut.accepted_same}  ${pct(mut.accepted_same, mut.total)}   (robust)`);
  console.log(`  accepted, diff, flagged ${mut.accepted_flagged}  ${pct(mut.accepted_flagged, mut.total)}   (meaning changed, parser said so)`);
  console.log(`  accepted, diff, SILENT  ${mut.accepted_diff}  ${pct(mut.accepted_diff, mut.total)}   (meaning changed, no warning)`);
  for (const [k, v] of Object.entries(mut.byKind)) console.log(`    ${k.padEnd(5)} ${v.diff}/${v.total} false accepts`);
  const show = (title, list, n = 6) => { if (!list.length) return; console.log(`\n${title} (${list.length}, showing ${Math.min(n, list.length)}):`);
    for (const e of list.slice(0, n)) { console.log(`  › ${e.from ?? e.text}${e.to ? `\n    ⇒ ${e.to}` : ''}\n    want: ${e.want}\n    got:  ${e.got ?? e.readings?.join(' | ')}`); } };
  show('MISMATCH — accepted with the wrong meaning', ex.mismatch);
  show('REJECT — grammatical but refused', ex.reject);
  show('CLARIFY — grammatical but asked back', ex.clarify);
  show('AMBIGUOUS', ex.ambiguous);
  show('OUT OF SCOPE', ex.outofscope);
  show('MUTANT FALSE ACCEPTS', exm, 8);
}
