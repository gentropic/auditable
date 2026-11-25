// micro PLAN UNION — overlapping polygons mean their union, and every consumer agrees on it:
// the centroid test, per-cell coverage and the reported area (tools/micro/src/plan-union.js,
// coverage.js). Found by the 2026-11-25 sweep: a MultiPolygon whose parts overlapped was OUTSIDE
// in the overlap for the centroid test (even-odd over every ring), summed for area (200 for 175)
// and half-summed for coverage (171); two features covering the same half cell gave coverage 1.
// Every expectation here is worked by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partsOf, unionArea, unionAreaInRect, unionContains } from '../tools/micro/src/plan-union.js';
import { planCoverage, featuresAreaXY, pointInFeatureXY, featureRectArea } from '../tools/micro/src/coverage.js';

const sq = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const total = (frac, cellA) => { let t = 0; for (const v of frac) t += v * cellA; return t; };

// [0,10]² and [5,15]² as ONE MultiPolygon: union 100 + 100 − 25 = 175
const MP = { closed: true, rings: [sq(0, 0, 10, 10), sq(5, 5, 15, 15)], parts: [[0], [1]] };

test('a MultiPolygon with overlapping parts: inside in the overlap, area 175, coverage 175', () => {
  assert.equal(pointInFeatureXY(MP, 7, 7), true, 'the overlap is inside');
  assert.equal(pointInFeatureXY(MP, 2, 2), true);
  assert.equal(pointInFeatureXY(MP, 12, 2), false);
  near(featuresAreaXY([MP]), 175, 1e-9, 'area');
  near(total(planCoverage([MP], { ox: 0.5, oy: 0.5, dx: 1, dy: 1, nx: 16, ny: 16 }), 1), 175, 1e-9, 'coverage, cell-aligned');
  near(total(planCoverage([MP], { ox: -0.3, oy: 0.2, dx: 0.7, dy: 0.9, nx: 25, ny: 19 }), 0.63), 175, 1e-6, 'coverage, off-phase cells');
});

test('overlapping FEATURES in one limit count once', () => {
  const half = { closed: true, rings: [sq(0, 0, 0.5, 1)], parts: [[0]] };
  near(planCoverage([half, half], { ox: 0.5, oy: 0.5, dx: 1, dy: 1, nx: 1, ny: 1 })[0], 0.5, 1e-12, 'two identical half-cell features');
  near(featuresAreaXY([half, half]), 0.5, 1e-12, 'their area');
  const A = { closed: true, rings: [sq(0, 0, 10, 10)], parts: [[0]] }, B = { closed: true, rings: [sq(5, 5, 15, 15)], parts: [[0]] };
  near(featuresAreaXY([A, B]), 175, 1e-9, 'two overlapping squares');
});

test('holes still subtract, and a part filling another part’s hole fills it', () => {
  const holed = { closed: true, rings: [sq(0, 0, 10, 10), sq(2, 2, 4, 4)], parts: [[0, 1]] };
  assert.equal(pointInFeatureXY(holed, 3, 3), false, 'in the hole');
  near(featuresAreaXY([holed]), 96, 1e-12, 'outer − hole');
  const patch = { closed: true, rings: [sq(3, 3, 5, 5)], parts: [[0]] };      // covers 1 m² of the hole, 3 m² already covered
  near(featuresAreaXY([holed, patch]), 97, 1e-9, 'hole partly filled by another feature');
  near(total(planCoverage([holed, patch], { ox: 0.25, oy: 0.25, dx: 0.5, dy: 0.5, nx: 20, ny: 20 }), 0.25), 97, 1e-9, 'its coverage');
});

test('unionAreaInRect clips exactly, crossings and all', () => {
  const P = partsOf([MP]);
  near(unionAreaInRect(P, 4, 4, 6, 6), 4, 1e-12, 'rectangle wholly inside');
  near(unionAreaInRect(P, 9, 9, 11, 11), 4, 1e-12, 'across the overlap corner');
  near(unionAreaInRect(P, 14, 0, 16, 4), 0, 1e-12, 'outside both');
  // two triangles crossing: |∪| = 50 + 50 − the overlap (a 5 × 5 square's half-diagonal shape)
  const T1 = { closed: true, rings: [[[0, 0], [10, 0], [0, 10]]], parts: [[0]] }, T2 = { closed: true, rings: [[[10, 10], [0, 10], [10, 0]]], parts: [[0]] };
  near(unionArea(partsOf([T1, T2])), 100, 1e-9, 'two triangles tiling a square');
  near(unionArea(partsOf([T1, T1])), 50, 1e-9, 'a triangle with itself');
  assert.equal(unionContains(partsOf([T1, T2]), 2, 2), true, 'inside the first');
  assert.equal(unionContains(partsOf([T1, T2]), 8, 8), true, 'inside the second');
});

test('a single part keeps the fast clip path and agrees with its area at UTM magnitude', () => {
  const star = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 40 : 100, a = i * Math.PI / 5; star.push([612000 + r * Math.cos(a), 7765000 + r * Math.sin(a)]); }
  const f = { closed: true, rings: [star, sq(611990, 7764990, 612010, 7765010)], parts: [[0, 1]] };
  const A = featuresAreaXY([f]);
  near(total(planCoverage([f], { ox: 611890.5, oy: 7764890.5, dx: 3, dy: 3, nx: 75, ny: 75 }), 9), A, 1e-6 * A, 'coverage total = area');
  near(featureRectArea(f, 611900, 7764900, 612100, 7765100), A, 1e-6 * A, 'its whole box');
});
