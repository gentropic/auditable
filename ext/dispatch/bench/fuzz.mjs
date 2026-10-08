// fuzz.mjs — walk the grammar forward from the ontology, parse backward, score the round-trip.
// usage: node fuzz.mjs [n] [seed]
import { createEngine, makeSession, ENGLISH, PORTUGUESE } from '../src/main.js';
import { readFileSync } from 'node:fs';

// usage: node fuzz.mjs [n] [seed] [en|pt]
const MAIN = process.argv[1]?.endsWith('fuzz.mjs');
const N = +process.argv[2] || 2000, SEED = +process.argv[3] || 7, LOC = process.argv[4] === 'pt' ? PORTUGUESE : ENGLISH;
const ont = JSON.parse(readFileSync(new URL('./geostats.json', import.meta.url)));
const E = createEngine(ont, LOC);

// ---- surface phrase templates: the only thing the fuzzer knows about each language ----
const g = w => ({ variograma: 'm', semivariograma: 'm', modelo: 'm', 'modelo de blocos': 'm', dia: 'm' }[w] ?? (/a(s)?$/.test(w) ? 'f' : 'm'));   // pt gender heuristic
const pl = w => /s$/.test(w);
const PHR = {
  en: { the: w => `the ${w}`, a: w => `a ${w}`, spec: (mod, gen) => `${mod} ${gen}`, adj: (adj, gen) => `${adj} ${gen}`, of: (gen, mod) => `${mod} ${gen}`,
        named: (gen, name) => `${gen.replace(/s$/, '')} ${name}`, last: gen => `the ${pick(['last', 'latest'])} ${gen}`, lastOf: (gen, mod) => `the last ${mod} ${gen}`,
        allOf: (gen, mod) => `the ${mod} ${gen}s`, qsearch: (w, gen) => pick([`a ${w} ${gen}`, `${w} ${gen}`]), then: () => pick([' then ', ', then ', ' and then ']), filler: () => pick(['please ', 'now ']), and: 'and',
        rel: (gen, verb, time) => pick([`the ${gen} ${pick(['i', 'we'])} ${verb} ${time}`, `the ${gen} that ${pick(['i', 'we'])} ${verb} ${time}`, `the ${gen} ${verb} ${time}`]), fromTime: (gen, time) => pick([`the ${gen}s from ${time}`, `the ${gen}s ${time}`]), plural: gen => `the ${gen}s`, cmpSearch: sup => `${pick(['a', 'the'])} ${sup} search` },
  pt: { the: w => `${pl(w) ? (g(w) === 'f' ? 'as' : 'os') : (g(w) === 'f' ? 'a' : 'o')} ${w}`, a: w => `${g(w) === 'f' ? 'uma' : 'um'} ${w}`, spec: (mod, gen) => `${gen} ${mod}`, adj: (adj, gen) => `${gen} ${adj}`,
        of: (gen, mod) => `${gen} de ${mod}`, named: (gen, name) => `${gen.replace(/s$/, '')} ${name}`, last: gen => `${g(gen) === 'f' ? 'a última' : 'o último'} ${gen}`, lastOf: (gen, mod) => `${g(gen) === 'f' ? 'a última' : 'o último'} ${gen} de ${mod}`,
        allOf: (gen, mod) => `${g(gen) === 'f' ? 'as' : 'os'} ${gen}s de ${mod}`, qsearch: (w, gen) => pick([`${g(gen) === 'f' ? 'uma' : 'um'} ${gen} de ${w}`, `${gen} de ${w}`]), then: () => pick([' depois ', ', depois ', ' e depois ']), filler: () => pick(['por favor ', 'agora ']), and: 'e',
        rel: (gen, verb, time) => pick([`${g(gen) === 'f' ? 'a' : 'o'} ${gen} que eu ${verb} ${time}`, `${g(gen) === 'f' ? 'a' : 'o'} ${gen} que a gente ${verb} ${time}`]), fromTime: (gen, time) => `${g(gen) === 'f' ? 'as' : 'os'} ${gen}s ${pick(['de', 'da'])} ${time}`.replace('de semana', 'da semana').replace('da hoje', 'de hoje').replace('da ontem', 'de ontem').replace('da antes', 'de antes').replace('de mês', 'do mês'), plural: gen => `${g(gen) === 'f' ? 'as' : 'os'} ${gen}s`, cmpSearch: sup => `${pick(['uma', 'a'])} busca ${sup}` },
}[LOC.code];
// a surface preposition for a canonical one
const PAST = { en: { fit: ['fitted', 'fit'], krige: ['kriged', 'estimated'] }, pt: { fit: ['ajustei', 'ajustou', 'ajustamos'], krige: ['kriguei', 'krigou', 'krigamos', 'estimei', 'estimou'] } }[LOC.code];
const TIMES = Object.entries(LOC.times).filter(([w]) => !/manh|morning|antes|earlier|month|mês|mes/.test(w));
const surf = canon => pick(Object.keys(LOC.preps).length ? Object.entries(LOC.preps).filter(([, c]) => c.includes(canon)).map(([w]) => w) : [canon]);
const col = (o, k) => o[`${k}_${LOC.code}`] ?? o[k];
const { understand, echo } = E;

// seeded PRNG
let s = SEED >>> 0;
export const reseed = (x) => { s = x >>> 0; };
const rnd = () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const NOUN = Object.fromEntries(ont.nouns.map(n => [n.type, n]));
const values = t => Object.keys(NOUN[t].words ?? {});
const syn = (t, v) => pick(col(NOUN[t], 'words')[v]);
const gen = t => pick(col(NOUN[t], 'generic').filter(w => !w.includes(' ') || LOC.code === 'en'));
const unitsOf = dim => ont.units.filter(u => u.dim === dim);

// ---- random session ----
function randomSession() {
  const objs = [];
  for (const d of shuffle(values('domain')).slice(0, 4)) objs.push({ type: 'domain', value: d, t: 0 });
  let t = 1;
  const nv = 2 + Math.floor(rnd() * 3);
  const DAY = 86400000, NOW = 100 * DAY; const ago = () => NOW - pick([0.2, 0.6, 1.2, 1.7, 3, 5, 9, 12, 20, 45]) * DAY;
  for (let i = 1; i <= nv; i++) objs.push({ type: 'variogram', name: `v${i}`, attrs: { variable: pick(values('variable')), model: pick(values('vmodel')) }, by: 'fit', t: ago() });
  for (let i = 1; i <= 1 + Math.floor(rnd() * 2); i++) objs.push({ type: 'run', name: `r${i}`, attrs: { variable: pick(values('variable')), method: pick(values('method')), search: { type: 'quantity', n: pick([100, 150, 200, 250, 300]), unit: 'm', dim: 'length' } }, by: 'krige', t: ago() });
  for (let i = 1; i <= 1 + Math.floor(rnd() * 2); i++) objs.push({ type: 'blockmodel', name: `bm${i}`, attrs: { run: 'r1' }, by: 'krige', t: ago() });
  for (const o of objs) if (o.t === undefined) o.t = 0;
  // distinct timestamps so 'the last X' is unambiguous
  const seen = new Set(); for (const o of objs) { while (seen.has(o.t)) o.t += 1000; seen.add(o.t); }
  return makeSession(objs, NOW);
}

// ---- surface realisations with known meaning: return { text, nodes } ----
// nodes = what resolution should produce (session objects or literal nodes), or null if it can't be said
function realise(type, S, ctx = {}) {
  const lit = (extra) => ({ type, value: null, generic: true, attrs: {}, ...extra });
  const objsOf = t => S.objects.filter(o => o.type === t);
  switch (type) {
    case 'variable': { const v = pick(values(type)); const w = syn(type, v);
      return pick([{ text: w, nodes: [lit({ value: v, generic: false })] }, { text: PHR.the(w), nodes: [lit({ value: v, generic: false })] }, { text: PHR.spec(w, gen(type)), nodes: [lit({ value: v, generic: false })] }]); }
    case 'domain': { const pool = objsOf('domain'); const d = pick(pool);
      const dw = syn('domain', d.value);
      return pick([{ text: dw, nodes: [d] }, { text: PHR.the(PHR.spec(dw, gen(type))), nodes: [d] }, { text: PHR.spec(dw, gen(type)), nodes: [d] }]); }
    case 'method': case 'vmodel': case 'format': { const v = pick(values(type)); return { text: syn(type, v), nodes: [lit({ value: v, generic: false })] }; }
    case 'samples': case 'composites': case 'drillholes': {
      if (chance(0.6)) { const w = gen(type); return { text: pick([w, PHR.the(w)]), nodes: [lit()] }; }
      const v = pick(values('variable')); return { text: PHR.of(gen(type), syn('variable', v)), nodes: [lit({ attrs: { variable: v } })] }; }
    case 'variogram': case 'run': case 'blockmodel': {
      const pool = objsOf(type); const o = pick(pool);
      const gw = gen(type).replace(/s$/, '');
      const forms = [{ text: o.name, nodes: [o] }, { text: PHR.named(gw, o.name), nodes: [o] }];
      const latest = [...pool].sort((a, b) => b.t - a.t)[0];
      forms.push({ text: PHR.last(gw), nodes: [latest] });
      if (pool.length === 1) forms.push({ text: PHR.the(gw), nodes: [o] });
      // relative clause with time: unique object of this type made by that verb inside the window
      const DAY = 86400000, now = S.now;
      for (const [tw, [from, to]] of TIMES) {
        const inWin = pool.filter(p => now - p.t >= from * DAY && now - p.t < to * DAY);
        if (inWin.length === 1 && PAST[inWin[0].by] && inWin[0].by !== 'krige' || (inWin.length === 1 && type !== 'blockmodel' && PAST[inWin[0].by])) forms.push({ text: PHR.rel(gw, pick(PAST[inWin[0].by]), tw), nodes: [inWin[0]] });
        if (inWin.length >= 1 && ctx.plural) forms.push({ text: PHR.fromTime(gw, tw), nodes: inWin.sort((a, b) => a.t - b.t) });
      }
      if (ctx.plural && pool.length > 1) forms.push({ text: PHR.plural(gw), nodes: [...pool].sort((a, b) => a.t - b.t) });
      if (type === 'run' && pool.length > 1) {
        const bySearch = [...pool].sort((a, b) => b.attrs.search.n - a.attrs.search.n);
        if (bySearch[0].attrs.search.n !== bySearch[1].attrs.search.n) forms.push({ text: `${PHR.the(gw)} ${surf('with')} ${PHR.cmpSearch(Object.entries(LOC.comps).find(([, c]) => c[0] === '+')[0])}`, nodes: [bySearch[0]] });
      }
      if (type === 'variogram') {
        const byVar = pool.filter(p => p.attrs.variable === o.attrs.variable).sort((a, b) => b.t - a.t);
        forms.push({ text: PHR.lastOf(gw, syn('variable', o.attrs.variable)), nodes: [byVar[0]] });
        if (ctx.plural && byVar.length > 1) forms.push({ text: PHR.allOf(gw, syn('variable', o.attrs.variable)), nodes: byVar.sort((a, b) => a.t - b.t) });
      }
      return pick(forms); }
    case 'search': case 'quantity:length': { const n = pick([50, 100, 150, 200, 250, 300]); const u = pick(unitsOf('length'));
      const q = { type: 'quantity', n, unit: u.unit, dim: 'length' }; const w = `${n} ${pick(col(u, 'words'))}`;
      if (type === 'search' && chance(0.5)) return { text: PHR.qsearch(w, gen('search')), nodes: [{ type: 'search', value: null, generic: false, attrs: { radius: q } }] };
      return { text: w, nodes: [q] }; }
    case 'quantity:grade': { const n = pick([0.5, 1, 2, 3, 5, 30]); const u = pick(unitsOf('grade')); return { text: `${n} ${pick(col(u, 'words'))}`, nodes: [{ type: 'quantity', n, unit: u.unit, dim: 'grade' }] }; }
    case '*': return realise(pick(['variogram', 'run', 'blockmodel', 'domain']), S, ctx);
  }
  return null;
}

// ---- one command with its expected meaning ----
function genCommand(S, prevTheme) {
  const F = pick(ont.verbs);
  const cmd = { verb: F.name, theme: [], roles: {} };
  const parts = [];
  // theme
  const themeTypes = F.theme;
  if (F.creates) {
    const t = pick(themeTypes.filter(x => NOUN[x].generic));
    const model = t === 'variogram' && chance(0.5) ? pick(values('vmodel')) : null;
    const core = model ? PHR.adj(syn('vmodel', model), gen(t)) : gen(t);
    const text = chance(0.66) ? PHR.a(core) : core;
    cmd.theme = [{ type: t, value: null, generic: true, attrs: model ? { model } : {}, fresh: true }];
    parts.push({ text, np: true, role: 'THEME' });
  } else if (F.distributive && chance(0.4)) {
    const k = 2 + Math.floor(rnd() * 2); const rs = []; const seen = new Set();
    while (rs.length < k) { const r = realise('variable', S); if (!seen.has(r.nodes[0].value)) { seen.add(r.nodes[0].value); rs.push(r); } }
    cmd.theme = rs.flatMap(r => r.nodes);
    parts.push({ text: rs.length === 2 ? `${rs[0].text} ${PHR.and} ${rs[1].text}` : `${rs[0].text}, ${rs[1].text} ${PHR.and} ${rs[2].text}`, np: true, role: 'THEME' });
  } else {
    const r = realise(pick(themeTypes), S, { plural: F.minTheme === 2 });
    cmd.theme = r.nodes; parts.push({ text: r.text, np: true, role: 'THEME' });
  }
  // roles
  for (const [k, role] of Object.entries(F.roles)) {
    const need = F.required.includes(k) || (F.minTheme && cmd.theme.length < F.minTheme && k === 'against');
    if (!need && !chance(0.45)) continue;
    const t = pick(role.types);
    const multi = t === 'domain' && chance(0.3);
    const r1 = realise(t, S); if (!r1) continue;
    let text = r1.text, nodes = r1.nodes;
    if (multi) { let r2 = realise(t, S); if (r2.nodes[0] !== r1.nodes[0]) { text = `${r1.text} ${PHR.and} ${r2.text}`; nodes = [...nodes, ...r2.nodes]; } }
    cmd.roles[k] = nodes;
    const sp = surf(pick(role.preps));
    parts.push({ text: `${sp} ${text}`, prep: sp, value: text, role: k });
  }
  // expected inheritance for fresh objects
  if (F.creates) for (const th of cmd.theme) for (const k of ont.inherit) if (cmd.roles[k]?.length === 1) th.attrs = { ...th.attrs, [k]: cmd.roles[k][0].value };
  // word order: theme first usually; sometimes after a PP
  const [theme, ...pps] = parts; shuffle(pps);
  const order = [theme, ...pps];
  let text = `${pick(col(F, 'words'))} ${order.map(p => p.text).join(' ')}`;
  if (chance(0.15)) text = PHR.filler() + text;
  const expected = (F.distributive && cmd.theme.length > 1) ? cmd.theme.map(t => ({ ...cmd, theme: [t] })) : [cmd];
  return { text, expected, parts: order, verb: F.name };
}
export { genCommand, randomSession, mutate, realise };

// ---- mutations (should NOT be silently accepted with a different meaning) ----
function mutate(text) {
  const w = text.split(' ');
  const i = Math.floor(rnd() * w.length);
  const kind = pick(['drop', 'swap', 'junk', 'dup']);
  if (kind === 'drop' && w.length > 2) w.splice(i, 1);
  else if (kind === 'swap' && i < w.length - 1) [w[i], w[i + 1]] = [w[i + 1], w[i]];
  else if (kind === 'junk') w[i] = pick(['fluffy', 'banana', 'quickly', 'xyzzy', 'tomorrow', 'fofo', 'rapidinho']);
  else if (kind === 'dup') w.splice(i, 0, w[i]);
  return { text: w.join(' '), kind };
}

// ---- run ----
if (MAIN) {
const tally = { ok: 0, mismatch: 0, reject: 0, clarify: 0, ambiguous: 0, outofscope: 0 };
const ex = { mismatch: [], reject: [], clarify: [], ambiguous: [] };
const mut = { total: 0, accepted_same: 0, accepted_diff: 0, accepted_flagged: 0, refused: 0, byKind: {} };
const exm = [];
for (let i = 0; i < N; i++) {
  const S = randomSession();
  let text, expected;
  if (chance(0.15)) { const a = genCommand(S), b = genCommand(S); text = `${a.text}${PHR.then()}${b.text}`; expected = [...a.expected, ...b.expected]; }
  else ({ text, expected } = genCommand(S));
  const want = expected.map(echo).join(` ${LOC.phr.then}: `);
  const r = understand(text, makeSession(structuredClone(S.objects), S.now));
  if (r.status === 'ok') { if (r.echo === want) tally.ok++; else { tally.mismatch++; ex.mismatch.push({ text, want, got: r.echo }); } }
  else { tally[r.status]++; ex[r.status]?.push({ text, want, got: r.reasons?.join('; '), readings: r.readings }); }

  // mutation round, only on sentences we accepted correctly
  if (r.status === 'ok' && r.echo === want) {
    const m = mutate(text); mut.total++; mut.byKind[m.kind] ??= { total: 0, diff: 0 }; mut.byKind[m.kind].total++;
    const rm = understand(m.text, makeSession(structuredClone(S.objects), S.now));
    if (rm.status === 'ok') { if (rm.echo === want) mut.accepted_same++; else if (rm.diag.notes.length) mut.accepted_flagged++; else { mut.accepted_diff++; mut.byKind[m.kind].diff++; exm.push({ kind: m.kind, from: text, to: m.text, want, got: rm.echo }); } }
    else mut.refused++;
  }
}

const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`;
console.log(`clause fuzz — n=${N} seed=${SEED} locale=${LOC.code}\n`);
console.log('GENERATED (grammatical, meaning known):');
for (const [k, v] of Object.entries(tally)) if (v) console.log(`  ${k.padEnd(11)} ${String(v).padStart(5)}  ${pct(v, N)}`);
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
show('MUTANT FALSE ACCEPTS', exm, 8);
}
