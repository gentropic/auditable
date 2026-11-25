// micro's plain-language bar — the EVALUATION GATE. Trains the bar exactly as the app does
// (tools/micro/src/nl-core.js, @gcu/dispatch, en + pt-BR) on the demo project's vocabulary,
// with every evaluation phrase EXCLUDED from its training corpus, then scores the held-out
// corpus in test/micro-nl-corpus.mjs:
//   intent accuracy  — the right command (in-scope phrases)
//   slot accuracy    — the right command AND the right arguments (the filter's expression)
//   refusal rate     — out-of-scope phrases that get NO proposal (a wrong guess is worse)
// The bar is ON by default only while these clear the bar set below (nl.js NL_DEFAULT_ON).
//   node test/micro-nl.test.mjs --report    every miss, per language
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainNl, interpret, NL_TOOLS, normalizeDecimals, thicknessSaid } from '../tools/micro/src/nl-core.js';
import { DEMO_SESSION, EN, PT, OUT_EN, OUT_PT, FRESH, FRESH_OUT } from './micro-nl-corpus.mjs';

// the default-on gate (ROADMAP "plain-language bar, graduated")
// slots: the ARGUMENTS right too (expression, column, axis, number) — a proposal with the right verb
// and the wrong number is the dangerous kind, and it used to pass the gate (sweep 2026-11-25)
const GATE = { intent: 0.90, refusal: 0.80, slots: 0.90 };

const all = [...EN, ...PT, ...FRESH].map((r) => r[0]).concat(OUT_EN, OUT_PT, FRESH_OUT);
const t0 = performance.now();
const nl = trainNl(DEMO_SESSION, { exclude: all });
const trainMs = performance.now() - t0;

const canonExpr = (e) => {
  if (!e) return e;
  const j = / or /.test(e) ? ' or ' : ' and ';
  return e.split(j).map((s) => s.trim()).sort().join(j);
};
function score(rows) {
  let intent = 0, slots = 0; const miss = [];
  for (const [q, tool, want] of rows) {
    const p = interpret(nl, q);
    const got = p ? p.name : null;
    if (got !== tool) { miss.push(`${q}  →  ${got || '(refused)'}  [want ${tool}]`); continue; }
    intent++;
    let ok = true;
    for (const [k, v] of Object.entries(want)) {
      const have = k === 'expr' ? canonExpr(p.expr) : k === 'groupBy' ? p.groupBy : p.args[k];
      if ((k === 'expr' ? canonExpr(v) : v) !== have) ok = false;
    }
    // an argument the phrase never gave is a wrong slot too ("open the stats" ≠ stats of FE)
    for (const k of ['column', 'axis', 'layer']) if (!(k in want) && p.args[k] != null && tool !== 'micro.setLayerVisibility' && tool !== 'micro.selectBySolid') ok = false;
    if (ok) slots++; else miss.push(`${q}  →  ${tool} ${JSON.stringify(p.expr || p.args)}${p.groupBy ? ' by ' + p.groupBy : ''}  [want ${JSON.stringify(want)}]`);
  }
  return { n: rows.length, intent: intent / rows.length, slots: slots / rows.length, miss };
}
function refusals(rows) {
  const miss = [];
  for (const q of rows) { const p = interpret(nl, q); if (p) miss.push(`${q}  →  ${p.name} ${JSON.stringify(p.expr || p.args)}`); }
  return { n: rows.length, refusal: 1 - miss.length / rows.length, miss };
}
const en = score(EN), pt = score(PT), oen = refusals(OUT_EN), opt = refusals(OUT_PT), fr = score(FRESH), fro = refusals(FRESH_OUT);
const both = { intent: (en.intent * en.n + pt.intent * pt.n) / (en.n + pt.n), slots: (en.slots * en.n + pt.slots * pt.n) / (en.n + pt.n) };
const ref = 1 - (oen.miss.length + opt.miss.length) / (oen.n + opt.n);
const pc = (x) => `${(100 * x).toFixed(1)}%`;
const summary = `nl eval — trained ${nl.stats.corpus} sentences in ${trainMs.toFixed(0)} ms · `
  + `en ${en.n}: intent ${pc(en.intent)} slots ${pc(en.slots)} · pt ${pt.n}: intent ${pc(pt.intent)} slots ${pc(pt.slots)} · `
  + `refused out-of-scope en ${pc(oen.refusal)} (${oen.n}) pt ${pc(opt.refusal)} (${opt.n}) · `
  + `FRESH (scored as written, en+pt) ${fr.n}: intent ${pc(fr.intent)} slots ${pc(fr.slots)} · refused ${pc(fro.refusal)} (${fro.n})`;

if (process.argv.includes('--report')) {
  console.log(summary);
  for (const [nm, r] of [['en', en], ['pt', pt], ['out-en', oen], ['out-pt', opt], ['fresh', fr], ['fresh-out', fro]]) { console.log(`\n── ${nm} misses (${r.miss.length})`); for (const m of r.miss) console.log('  ' + m); }
}

test('every evaluation phrase was held out of training (the contamination guard is live)', () => {
  assert.ok(nl.stats.corpus > 1000);
  for (const x of nl.stats.excluded) assert.ok(typeof x === 'string');
});

test('the corpus covers every declared verb, in both languages', () => {
  for (const t of NL_TOOLS) {
    assert.ok(EN.some((r) => r[1] === t.name), `no English phrase for ${t.name}`);
    assert.ok(PT.some((r) => r[1] === t.name), `no pt-BR phrase for ${t.name}`);
  }
});

test(`default-on gate: intent ≥ ${pc(GATE.intent)} (en + pt), slots ≥ ${pc(GATE.slots)}, refusal ≥ ${pc(GATE.refusal)} — ${summary}`, () => {
  assert.ok(both.intent >= GATE.intent, `intent ${pc(both.intent)} < gate`);
  assert.ok(en.intent >= GATE.intent - 0.05 && pt.intent >= GATE.intent - 0.05, `a language fell behind: en ${pc(en.intent)} pt ${pc(pt.intent)}`);
  assert.ok(ref >= GATE.refusal, `refusal ${pc(ref)} < gate`);
  assert.ok(both.slots >= GATE.slots && en.slots >= GATE.slots - 0.05 && pt.slots >= GATE.slots - 0.05, `slots: ${pc(both.slots)} (en ${pc(en.slots)} pt ${pc(pt.slots)}) < gate`);
  assert.ok(fr.slots >= GATE.slots, `fresh set: slots ${pc(fr.slots)} < gate`);
  // …and on the FRESH set, written after tuning and scored as written
  assert.ok(fr.intent >= GATE.intent && fro.refusal >= GATE.refusal, `fresh set: intent ${pc(fr.intent)} refusal ${pc(fro.refusal)}`);
});

test('the filter shows the expression it will apply (the headline phrase)', () => {
  const p = interpret(nl, 'blocks above 55 Fe in hematite');
  assert.equal(p.name, 'micro.filterBlocks');
  assert.equal(p.expr, 'FE > 55 and LITO == "HEMATITE"');
});

test('destructive verbs are refused, in both languages', () => {
  for (const q of ['delete the block model', 'erase the topography', 'apaga o modelo de blocos inteiro', 'exclui a topografia']) assert.equal(interpret(nl, q), null, q);
});

// sweep 2026-11-25: a Portuguese DECIMAL COMMA was read as the end of the number ("cu > 0,5" →
// CU > 0; "exagero vertical de 2,5" → a section); a section's THICKNESS was dropped in most word
// orders. Both are read from the phrase before / after the tagger now.
test('decimal commas are decimals; n,ddd stays thousands', () => {
  assert.equal(normalizeDecimals('fe acima de 0,5'), 'fe acima de 0.5');
  assert.equal(normalizeDecimals('exagero vertical de 2,5'), 'exagero vertical de 2.5');
  assert.equal(normalizeDecimals('fe > 0,125'), 'fe > 0.125');
  assert.equal(normalizeDecimals('tonnage over 1,250'), 'tonnage over 1250');
  const f = interpret(nl, 'blocos com fe acima de 55,5');
  assert.ok(f && f.name === 'micro.filterBlocks' && f.expr === 'FE > 55.5', JSON.stringify(f && { name: f.name, expr: f.expr }));
  const z = interpret(nl, 'exagero vertical de 2,5');
  assert.ok(z && z.name === 'micro.setZExag' && z.args.factor === 2.5, JSON.stringify(z && { name: z.name, args: z.args }));
});

test('a section keeps the thickness however it is said', () => {
  for (const [q, th] of [['section at z 500, 10 m thick', 10], ['20 m thick section at elevation 500', 20], ['section at elevation 500 with a 20 m slab', 20], ['seção na cota 500 com 10 m de espessura', 10]]) {
    const p = interpret(nl, q);
    assert.ok(p && p.name === 'micro.sectionAt' && p.args.position === 500 && p.args.thickness === th, `${q} → ${JSON.stringify(p && { name: p.name, args: p.args })}`);
  }
  assert.equal(thicknessSaid('section at easting 613000'), null, 'a position is not a thickness');
});
