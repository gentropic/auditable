// @gcu/geometry — point → mesh distance (closest point on a triangle + BVH descent) and side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBVH, nearestBVH, closestPointOnTriangle, orientTriangles, pseudoNormals, sideOf } from '../ext/geometry/src/main.js';
import * as bundle from '../ext/geometry/index.js';

// the unit cube [0,1]³, 12 triangles wound outward
function cube(o = [0, 0, 0], s = 1) {
  const v = [];
  for (let k = 0; k < 8; k++) v.push(o[0] + ((k & 1) ? s : 0), o[1] + ((k & 2) ? s : 0), o[2] + ((k & 4) ? s : 0));
  const T = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5];
  return { vertices: new Float64Array(v), triangles: new Uint32Array(T) };
}
const withBvh = (m) => { const b = buildBVH(m.vertices, m.triangles); return { ...m, nodes: b.nodes, triIndices: b.triIndices }; };
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('closest point on a triangle: face, edge and vertex regions', () => {
  const out = new Float64Array(4);
  near(Math.sqrt(closestPointOnTriangle(0.2, 0.2, 3, 0, 0, 0, 1, 0, 0, 0, 1, 0, out)), 3);
  assert.equal(out[3], 0);                                  // face
  near(Math.sqrt(closestPointOnTriangle(0.5, -2, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, out)), 2);
  assert.equal(out[3], 4);                                  // edge 0-1
  near(Math.sqrt(closestPointOnTriangle(-3, -4, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, out)), 5);
  assert.equal(out[3], 1);                                  // vertex 0
  near(Math.sqrt(closestPointOnTriangle(1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, out)), Math.SQRT1_2);
  assert.equal(out[3], 5);                                  // edge 1-2 (the hypotenuse)
});

test('nearest on a cube: exact distances to a face, an edge and a corner, from outside and inside', () => {
  const m = withBvh(cube());
  near(nearestBVH(m, [0.5, 0.5, 2]).dist, 1);
  assert.equal(nearestBVH(m, [0.3, 0.6, 2]).feature, 'face');   // (0.5, 0.5) sits on the face's diagonal: an edge, honestly
  near(nearestBVH(m, [2, 0.5, 2]).dist, Math.SQRT2);
  assert.equal(nearestBVH(m, [2, 0.5, 2]).feature, 'edge');
  near(nearestBVH(m, [2, 2, 2]).dist, Math.sqrt(3));
  assert.equal(nearestBVH(m, [2, 2, 2]).feature, 'vertex');
  near(nearestBVH(m, [0.5, 0.5, 0.25]).dist, 0.25);       // inside: the nearest face, the bottom
  near(nearestBVH(m, [0.5, 0.5, 0.25]).point[2], 0);
  assert.equal(nearestBVH(m, [0.5, 0.5, 5], { maxDist: 3 }), null);   // nothing within maxDist → null
  near(nearestBVH(m, [0.5, 0.5, 5], { maxDist: 4.5 }).dist, 4);
});

test('side by pseudo-normal: the sign of a cube is right on faces, edges and corners — and after a scrambled winding', () => {
  const m = cube();
  for (const scramble of [false, true]) {
    const T = Uint32Array.from(m.triangles);
    if (scramble) for (let t = 0; t < T.length; t += 6) { const a = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = a; }   // every other triangle reversed
    const o = orientTriangles(T);
    assert.equal(o.pieces, 1);
    const mm = withBvh({ vertices: m.vertices, triangles: o.triangles });
    const pn = pseudoNormals(mm.vertices, mm.triangles);
    // the orientation may come out inward (the first triangle decides) — the sign is consistent either way
    const ref = sideOf(pn, nearestBVH(mm, [0.5, 0.5, 2]), [0.5, 0.5, 2]);
    assert.notEqual(ref, 0);
    for (const p of [[0.5, 0.5, -1], [2, 0.5, 2], [2, 2, 2], [-1, -1, -1], [1.0001, 1.0001, 0.5], [0.5, 1.3, 1.3]]) assert.equal(sideOf(pn, nearestBVH(mm, p), p), ref, `outside ${p}`);
    for (const p of [[0.5, 0.5, 0.5], [0.99, 0.99, 0.99], [0.01, 0.5, 0.02], [0.5, 0.999, 0.001]]) assert.equal(sideOf(pn, nearestBVH(mm, p), p), -ref, `inside ${p}`);
  }
});

test('nearest == brute force on a bumpy surface, including at UTM magnitudes (float32 BVH bounds)', () => {
  for (const off of [[0, 0, 0], [612000, 7765000, 400]]) {
    const n = 24, v = [], t = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) v.push(off[0] + i * 10, off[1] + j * 10, off[2] + 20 * Math.sin(i / 3) * Math.cos(j / 4));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1; t.push(a, b, c, a, c, d); }
    const m = withBvh({ vertices: new Float64Array(v), triangles: new Uint32Array(t) });
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const q = new Float64Array(4);
    for (let k = 0; k < 300; k++) {
      const p = [off[0] - 30 + rnd() * 300, off[1] - 30 + rnd() * 300, off[2] - 60 + rnd() * 120];
      let best = Infinity;
      for (let tt = 0; tt < t.length; tt += 3) {
        const a = t[tt] * 3, b = t[tt + 1] * 3, c = t[tt + 2] * 3;
        best = Math.min(best, closestPointOnTriangle(p[0], p[1], p[2], v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2], q));
      }
      near(nearestBVH(m, p).dist, Math.sqrt(best), 1e-6);
    }
  }
});

test('the bundle carries the nearest API', () => {
  for (const k of ['nearestBVH', 'closestPointOnTriangle', 'orientTriangles', 'pseudoNormals', 'sideOf', 'bvhSlack']) assert.equal(typeof bundle[k], 'function', k);
});
