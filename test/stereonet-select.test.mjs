// @gcu/stereonet's selections in attitude space: cone, band, lasso polygon — exact edges, axial, rotation-proof.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../ext/bearing/index.js';
import { shapeTest, rowsInShape, shapeOutline, greatCircleThrough, axialAngle } from '../ext/stereonet/src/main.js';

const { planeToDcos, lineToDcos } = B.conversions;
const neg = (v) => v.map((x) => -x);

describe('cone', () => {
  const t = shapeTest({ type: 'cone', axis: [0, 0, -1], angle: 10 });
  it('poles of planes dipping ≤ 10° are inside the 10° cone about the vertical; 10.5° is not', () => {
    assert.ok(t(planeToDcos(123, 10)));
    assert.ok(!t(planeToDcos(123, 10.5)));
  });
  it('axial: a direction and its antipode are both inside', () => {
    assert.ok(t(neg(planeToDcos(40, 5))));
  });
});

describe('band', () => {
  const t = shapeTest({ type: 'band', pole: [0, 0, 1], width: 10 });   // 10° either side of the horizontal
  it('lines plunging ≤ 10° are in the band about the primitive; 11° are not', () => {
    assert.ok(t(lineToDcos(300, 10)));
    assert.ok(!t(lineToDcos(300, 11)));
  });
  it('the band about the great circle through two lines contains both', () => {
    const a = lineToDcos(30, 20), b = lineToDcos(150, 40), p = greatCircleThrough(a, b);
    const tb = shapeTest({ type: 'band', pole: p, width: 1 });
    assert.ok(tb(a) && tb(b));
  });
});

describe('lasso polygon', () => {
  const sq = (c, r) => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => {   // four lines around a direction
    const [tr, pl] = c; return lineToDcos(tr + x * r, pl + y * r);
  });
  it('a lasso around 090→45 contains it and not 270→45', () => {
    const t = shapeTest({ type: 'polygon', vertices: sq([90, 45], 15) });
    assert.ok(t(lineToDcos(90, 45)));
    assert.ok(!t(lineToDcos(270, 45)));
  });
  it('a lasso straddling the primitive (around a horizontal E–W axis) takes the measurement on the far side too', () => {
    const verts = [lineToDcos(80, 10), lineToDcos(100, 10), neg(lineToDcos(280, 10)), neg(lineToDcos(260, 10))];   // all on the E side
    const t = shapeTest({ type: 'polygon', vertices: verts });
    assert.ok(t(lineToDcos(90, 0)));
    assert.ok(t(lineToDcos(270, 0)), 'the same axis, written pointing W');
    assert.ok(!t(lineToDcos(0, 0)));
  });
  it('fewer than three vertices selects nothing; an unknown shape is an error', () => {
    assert.equal(shapeTest({ type: 'polygon', vertices: [[0, 0, -1], [1, 0, 0]] })([0, 0, -1]), false);
    assert.throws(() => shapeTest({ type: 'blob' }), /unknown selection shape/);
  });
});

describe('rows of a dataset', () => {
  it('tocher: the cone picks exactly the poles within its angle (counted independently)', () => {
    const data = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8').split('\n').filter((l) => /^\d/.test(l))
      .map((l, row) => { const [dd, dip] = l.split(',').map(Number); return { row, pole: planeToDcos(dd, dip) }; });
    const axis = planeToDcos(150, 60), shape = { type: 'cone', axis, angle: 20 };
    const rows = rowsInShape(data, shape);
    const want = data.filter((d) => axialAngle(d.pole, axis) <= 20).map((d) => d.row);
    assert.deepEqual(rows, want);
    assert.ok(rows.length > 5 && rows.length < 200);
  });
  it('outlines: a cone is one ring, a band two, a polygon one closed path', () => {
    assert.equal(shapeOutline({ type: 'cone', axis: [0, 0, -1], angle: 20 }).length, 1);
    assert.equal(shapeOutline({ type: 'band', pole: [0, 0, 1], width: 10 }).length, 2);
    const p = shapeOutline({ type: 'polygon', vertices: [[0, 0, -1], [0.3, 0, -0.95], [0, 0.3, -0.95]] })[0];
    assert.deepEqual(p[0], p[p.length - 1]);
  });
});
