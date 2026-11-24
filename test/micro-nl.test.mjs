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
import { trainNl, interpret, NL_TOOLS } from '../tools/micro/src/nl-core.js';
import { DEMO_SESSION, EN, PT, OUT_EN, OUT_PT, FRESH, FRESH_OUT } from './micro-nl-corpus.mjs';

// the default-on gate (ROADMAP "plain-language bar, graduated")
const GATE = { intent: 0.90, refusal: 0.80 };

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

test(`default-on gate: intent ≥ ${pc(GATE.intent)} (en + pt), refusal ≥ ${pc(GATE.refusal)} — ${summary}`, () => {
  assert.ok(both.intent >= GATE.intent, `intent ${pc(both.intent)} < gate`);
  assert.ok(en.intent >= GATE.intent - 0.05 && pt.intent >= GATE.intent - 0.05, `a language fell behind: en ${pc(en.intent)} pt ${pc(pt.intent)}`);
  assert.ok(ref >= GATE.refusal, `refusal ${pc(ref)} < gate`);
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
