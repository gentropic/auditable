// @gcu/geometry earclip — ear-clipping triangulation with holes (plan-view polygon fills).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earclip, triangulateRings } from '../ext/geometry/src/main.js';

// total area of the triangles over flat xy coords
function triArea(xy, tris) {
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 2, b = tris[t + 1] * 2, c = tris[t + 2] * 2;
    s += Math.abs((xy[b] - xy[a]) * (xy[c + 1] - xy[a + 1]) - (xy[c] - xy[a]) * (xy[b + 1] - xy[a + 1])) / 2;
  }
  return s;
}

test('a square: two triangles, area 1', () => {
  const xy = [0, 0, 1, 0, 1, 1, 0, 1];
  const t = earclip(xy);
  assert.equal(t.length, 6);
  assert.ok(Math.abs(triArea(xy, t) - 1) < 1e-12);
});

test('either winding triangulates the same area', () => {
  const ccw = [0, 0, 4, 0, 4, 3, 0, 3];
  const cw = [0, 3, 4, 3, 4, 0, 0, 0];
  assert.ok(Math.abs(triArea(ccw, earclip(ccw)) - 12) < 1e-12);
  assert.ok(Math.abs(triArea(cw, earclip(cw)) - 12) < 1e-12);
});

test('a concave L: n-2 triangles, exact area', () => {
  const xy = [0, 0, 3, 0, 3, 1, 1, 1, 1, 3, 0, 3];
  const t = earclip(xy);
  assert.equal(t.length / 3, 4);
  assert.ok(Math.abs(triArea(xy, t) - 5) < 1e-12);
});

test('a square with a square hole: the hole stays empty', () => {
  const xy = [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7];
  const t = earclip(xy, [4]);
  assert.ok(Math.abs(triArea(xy, t) - (100 - 16)) < 1e-9);
  // no triangle centroid lands inside the hole
  for (let k = 0; k < t.length; k += 3) {
    const cx = (xy[t[k] * 2] + xy[t[k + 1] * 2] + xy[t[k + 2] * 2]) / 3;
    const cy = (xy[t[k] * 2 + 1] + xy[t[k + 1] * 2 + 1] + xy[t[k + 2] * 2 + 1]) / 3;
    assert.ok(!(cx > 3 && cx < 7 && cy > 3 && cy < 7), 'a triangle inside the hole');
  }
});

test('two holes + UTM-sized coordinates', () => {
  const X = 600000, Y = 7700000;
  const rings = [
    [[X, Y], [X + 100, Y], [X + 100, Y + 50], [X, Y + 50], [X, Y]],
    [[X + 10, Y + 10], [X + 20, Y + 10], [X + 20, Y + 20], [X + 10, Y + 20]],
    [[X + 60, Y + 10], [X + 80, Y + 10], [X + 80, Y + 40], [X + 60, Y + 40]],
  ];
  const { vertices, triangles } = triangulateRings(rings);
  assert.equal(vertices.length / 3, 12);                   // the closing vertex dropped
  const xy = []; for (let i = 0; i < vertices.length; i += 3) xy.push(vertices[i] - X, vertices[i + 1] - Y);
  assert.ok(Math.abs(triArea(xy, triangles) - (5000 - 100 - 600)) < 1e-6);
});

test('z rides along; degenerate rings give no triangles', () => {
  const { vertices } = triangulateRings([[[0, 0, 5], [1, 0, 6], [0, 1, 7]]]);
  assert.deepEqual([...vertices], [0, 0, 5, 1, 0, 6, 0, 1, 7]);
  assert.equal(earclip([0, 0, 1, 1, 2, 2]).length, 0);     // collinear
  assert.equal(triangulateRings([[[0, 0], [1, 1]]]).triangles.length, 0);
});

test('a comb (many reflex vertices) triangulates fully', () => {
  const xy = [];
  for (let i = 0; i <= 20; i++) xy.push(i, i % 2 ? 5 : 1);
  xy.push(20, 0, 0, 0);
  const t = earclip(xy);
  const n = xy.length / 2;
  assert.equal(t.length / 3, n - 2);
});
