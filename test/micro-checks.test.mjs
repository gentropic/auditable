// micro routine checks (tools/micro/src/checks.js) — pure: scalar checks, row checks, comparisons
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalScalarCheck, evalEveryCheck, compareTables, parseTSV, flatValues } from '../tools/micro/src/checks.js';

test('a scalar check passes or fails, and records every name it read', () => {
  const scope = flatValues('val', { bias_pct: -3.9, samples: 80 });
  const ok = evalScalarCheck('abs(val.bias_pct) < 5', scope);
  assert.equal(ok.status, 'pass');
  assert.deepEqual(ok.observed, { 'val.bias_pct': -3.9 });
  const bad = evalScalarCheck('abs(val.bias_pct) < 2 and val.samples > 10', scope);
  assert.equal(bad.status, 'fail');
  assert.deepEqual(bad.observed, { 'val.bias_pct': -3.9, 'val.samples': 80 });
});

test('a blank, or a baseline value that does not exist, is NOT EVALUATED — never a pass', () => {
  assert.equal(evalScalarCheck('val.x = val.x', { 'val.x': NaN }).status, 'not-evaluated');   // blank = blank would be "true"
  const r = evalScalarCheck('abs(val.b - prev.val.b) < 1', { 'val.b': 2 });
  assert.equal(r.status, 'not-evaluated');
  assert.match(r.why, /prev\.val\.b/);
});

test('an unknown name is an error naming what there is', () => {
  assert.throws(() => evalScalarCheck('val.bais < 1', { 'val.bias': 1 }), /unknown column: val\.bais.*have: val\.bias/);
  assert.throws(() => evalScalarCheck('x > 1', {}), /no step before this check produced values/);
});

test('a row check reports failing rows by key; against the baseline it joins on the key', () => {
  const cur = { columns: ['cutoff', 'tonnes'], key: ['cutoff'], rows: [[0, 100], [1, 50], [2, 0]] };
  const r = evalEveryCheck('tonnes > 0', cur, {});
  assert.equal(r.status, 'fail'); assert.deepEqual(r.failing, ['2']);
  const prev = { columns: ['cutoff', 'tonnes'], key: ['cutoff'], rows: [[0, 101], [1, 40]] };
  const j = evalEveryCheck('abs(tonnes / prev.tonnes - 1) < 0.05', cur, {}, prev);
  assert.equal(j.status, 'fail'); assert.deepEqual(j.failing, ['1']);   // 50 vs 40: 25%
  assert.equal(j.blankCount, 1);                                       // cutoff 2 isn't in the baseline: not evaluated, not passed
  assert.equal(evalEveryCheck('tonnes > 0', cur, {}, null).status, 'not-evaluated');   // asked for a baseline, there is none
});

test('compare: this run beside the baseline, joined on the key, with rows only one side has', () => {
  const cur = { columns: ['cutoff', 'tonnes'], key: ['cutoff'], rows: [[0, 110], [1, 50]] };
  const prev = { columns: ['cutoff', 'tonnes'], key: ['cutoff'], rows: [[0, 100], [2, 7]] };
  const c = compareTables(cur, prev);
  assert.deepEqual(c.columns, ['cutoff', 'tonnes', 'tonnes_prev', 'tonnes_delta', 'tonnes_pct', 'in']);
  assert.deepEqual(c.rows[0], [0, 110, 100, 10, 0.1, 'both']);
  assert.equal(c.rows[1][5], 'this run');
  assert.deepEqual(c.rows[2].slice(0, 3).concat(c.rows[2][5]), [2, NaN, 7, 'baseline']);
});

test('parseTSV reads a machine table back, numbers as numbers, blanks as NaN', () => {
  const t = parseTSV('series\tcutoff\ttonnes\nFE\t0\t12.5\nFE\t1\t\n', ['series', 'cutoff']);
  assert.deepEqual(t.columns, ['series', 'cutoff', 'tonnes']);
  assert.deepEqual(t.rows[0], ['FE', 0, 12.5]);
  assert.ok(Number.isNaN(t.rows[1][2]));
});
