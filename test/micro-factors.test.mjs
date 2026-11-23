// micro reconciliation factors — the pure arithmetic (tools/micro/src/factors-core.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKey, naturalCompare, ratio, makeAcc, tgm, factorRows, factorTable, factorValues, identityError, metalMismatch, periodOrder } from '../tools/micro/src/factors-core.js';

const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const blank = (x) => assert.ok(Number.isNaN(x), `${x} should be blank`);

// a model: per period, blocks of (tonnes, grade)
const accOf = (mf, data) => { const a = makeAcc(mf); for (const [p, blocks] of Object.entries(data)) for (const [t, g] of blocks) a.add(p, t, g); return a.map; };

test('totals: tonnes and metal sum, grade is metal / (tonnes × mf) — never an average of grades', () => {
  const m = accOf(0.01, { P1: [[100, 50], [300, 30]] });
  const e = tgm(m.get('P1'), 0.01);
  near(e.t, 400); near(e.m, 100 * 50 * 0.01 + 300 * 30 * 0.01); near(e.g, 35);   // tonnage-weighted, not (50+30)/2
  assert.equal(m.get('P1').n, 2);
});

test('F1 / F2 / F3 for tonnes, grade and metal against known factors', () => {
  // resource model: 1000 t at 2 g/t per period; grade control = model × (t 1.1, g 0.95); mill = gc × (t 0.98, g 1.02)
  const mf = 1;
  const model = accOf(mf, { A: [[1000, 2]], B: [[2000, 3]] });
  const gc = accOf(mf, { A: [[1100, 1.9]], B: [[2200, 2.85]] });
  const mill = makeAcc(mf); mill.addRow('A', 1078, 1.938); mill.addRow('B', 2156, 2.907);
  const rows = factorRows({ periods: ['A', 'B'], model, gc, mill: mill.map, mf });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    near(r.f1.t, 1.1); near(r.f1.g, 0.95); near(r.f1.m, 1.1 * 0.95);
    near(r.f2.t, 0.98); near(r.f2.g, 1.02); near(r.f2.m, 0.98 * 1.02);
    near(r.f3.t, 1.1 * 0.98); near(r.f3.g, 0.95 * 1.02); near(r.f3.m, 1.1 * 0.95 * 0.98 * 1.02);
  }
  // cumulative: the second row's c_ sums both periods
  const c = rows[1].c;
  near(c.model.t, 3000); near(c.model.m, 2000 + 6000); near(c.model.g, 8000 / 3000);
  near(c.f1.t, 1.1); near(c.f1.g, 0.95); near(c.f3.m, 1.1 * 0.95 * 0.98 * 1.02);
  assert.equal(identityError(rows) < 1e-12, true);
});

test('the metal identity: F_metal = F_tonnes × F_grade, F3 = F1 × F2 — on uneven data too', () => {
  const mf = 1 / 31.1035;                                  // g/t → oz
  const model = accOf(mf, { M1: [[500, 1.2], [700, 0.8]], M2: [[900, 2.4]], M3: [[50, 9]] });
  const gc = accOf(mf, { M1: [[620, 1.0]], M2: [[860, 2.9], [10, 0.1]], M3: [[61, 7.7]] });
  const mill = makeAcc(mf); mill.addRow('M1', 600, 1.07); mill.addRow('M2', 840, undefined, 60); mill.addRow('M3', 58, 8.1);
  const rows = factorRows({ periods: ['M1', 'M2', 'M3'], model, gc, mill: mill.map, mf });
  assert.ok(identityError(rows) < 1e-12, `identity error ${identityError(rows)}`);
  near(rows[1].mill.g, 60 / (840 * mf));                   // a metal-only production row: its grade derived
});

test('blanks: a period with no production has blank mill, F2, F3 — and to-date goes blank from there', () => {
  const model = accOf(1, { 1: [[100, 1]], 2: [[100, 1]], 3: [[100, 1]] });
  const gc = accOf(1, { 1: [[110, 1]], 2: [[110, 1]], 3: [[110, 1]] });
  const mill = makeAcc(1); mill.addRow('1', 100, 1); mill.addRow('3', 100, 1);   // period 2 not reported
  const rows = factorRows({ periods: ['1', '2', '3'], model, gc, mill: mill.map, mf: 1 });
  near(rows[0].f2.t, 100 / 110); near(rows[0].c.f2.t, 100 / 110);
  blank(rows[1].mill.t); blank(rows[1].f2.t); blank(rows[1].f3.m); near(rows[1].f1.t, 1.1);
  near(rows[2].f2.t, 100 / 110);                           // period 3 itself has its factor …
  blank(rows[2].c.f2.t); blank(rows[2].c.mill.t);          // … but to-date can't skip period 2
  near(rows[2].c.f1.t, 1.1);                               // F1 to date is unaffected
  const v = factorValues(rows);
  assert.equal(v.periods, 3); near(v.f1_t, 1.1); near(v.f2_t, 100 / 110); blank(v.c_f2_t); near(v.c_f1_m, 1.1);
});

test('zero denominators are blank, not Infinity; a zero numerator is a real 0', () => {
  blank(ratio(5, 0)); blank(ratio(5, NaN)); blank(ratio(NaN, 2)); blank(ratio(1, -2)); assert.equal(ratio(0, 4), 0);
  const model = accOf(1, { P: [] }), gc = accOf(1, { P: [[50, 2]] });     // the model put nothing in P
  const rows = factorRows({ periods: ['P'], model, gc, mill: null, mf: 1 });
  assert.equal(rows[0].model.t, 0); blank(rows[0].model.g); blank(rows[0].f1.t); blank(rows[0].f1.g); blank(rows[0].f1.m);
  assert.ok(!Object.values(rows[0].f1).some((x) => x === Infinity));
  // no production table at all: every mill and F2 / F3 blank
  blank(rows[0].mill.t); blank(rows[0].f2.t); blank(rows[0].f3.g); blank(rows[0].c.f3.m);
  const gc0 = accOf(1, { P: [[0, 2], [50, NaN]] });        // zero tonnes, blank grades: nothing added
  assert.equal(gc0.has('P'), false);
});

test('the machine table: key [period, quantity], three rows a period, blanks kept as NaN', () => {
  const model = accOf(1, { Q1: [[100, 2]] }), gc = accOf(1, { Q1: [[120, 2]] });
  const t = factorTable(factorRows({ periods: ['Q1'], model, gc, mill: null, mf: 1 }));
  assert.deepEqual(t.key, ['period', 'quantity']);
  assert.deepEqual(t.columns, ['period', 'quantity', 'model', 'gc', 'mill', 'f1', 'f2', 'f3', 'c_model', 'c_gc', 'c_mill', 'c_f1', 'c_f2', 'c_f3']);
  assert.deepEqual(t.rows.map((r) => r[1]), ['tonnes', 'grade', 'metal']);
  near(t.rows[0][5], 1.2); blank(t.rows[0][4]); near(t.rows[2][2], 200); near(t.rows[2][3], 240);
});

test('period keys: numbers match in any spelling, text trims; natural order', () => {
  assert.equal(periodKey(' 01 '), '1'); assert.equal(periodKey(1), '1'); assert.equal(periodKey('1.0'), '1');
  assert.equal(periodKey(' Jan-26 '), 'Jan-26'); assert.equal(periodKey(''), ''); assert.equal(periodKey(null), ''); assert.equal(periodKey(NaN), '');
  assert.deepEqual(['M10', 'M2', 'M1'].sort(naturalCompare), ['M1', 'M2', 'M10']);
  assert.deepEqual(periodOrder([], new Map([['10', 1], ['2', 1]]), new Map([['3', 1], ['', 1]])), ['2', '3', '10']);
  assert.deepEqual(periodOrder(['phase 2', 'phase 1'], new Map([['phase 1', 1], ['extra', 1]])), ['phase 2', 'phase 1', 'extra']);
});

test('production rows: summed per period, metal as stated, the stated-vs-computed mismatch', () => {
  const p = makeAcc(0.01);
  assert.equal(p.addRow('J', 100, 50), true); assert.equal(p.addRow('J', 100, undefined, 0.4 * 100), true);
  assert.equal(p.addRow('J', 100), false);                 // neither grade nor metal: refused
  const e = tgm(p.map.get('J'), 0.01);
  near(e.t, 200); near(e.m, 50 + 40); near(e.g, 45);
  near(metalMismatch(100, 50, 50, 0.01), 0); near(metalMismatch(100, 50, 55, 0.01), 5 / 55); blank(metalMismatch(100, NaN, 50, 0.01));
});
