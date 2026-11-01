// @gcu/geometry — BVH + CSR mesh topology + mesh QA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBVH, raycastBVH, buildAdjacency, neighbors, incidentFaces, degree, components, meshQa, weldVertices,
} from '../ext/geometry/src/main.js';

// a unit quad in the z=0 plane, split into two triangles sharing the 1-2 edge
//   3---2
//   | \ |
//   0---1
const QUAD_V = new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
const QUAD_T = new Uint32Array([0, 1, 2, 0, 2, 3]);

// an N×N grid of quads → a regular triangulated plane
function grid(n) {
  const nv = (n + 1) * (n + 1);
  const v = new Float64Array(nv * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = (j * (n + 1) + i) * 3;
      v[k] = i; v[k + 1] = j; v[k + 2] = 0;
    }
  }
  const t = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 2, d = a + n + 1;
      t[p++] = a; t[p++] = b; t[p++] = c;
      t[p++] = a; t[p++] = c; t[p++] = d;
    }
  }
  return { vertices: v, triangles: t, n };
}

test('adjacency: vertex→face is exact, and every face lists its three corners', () => {
  const a = buildAdjacency(QUAD_V, QUAD_T);
  assert.equal(a.vertexCount, 4);
  assert.equal(a.faceCount, 2);
  assert.equal(a.vfFaces.length, 6);                       // 2 faces × 3 corners
  assert.deepEqual([...incidentFaces(a, 0)], [0, 1]);      // the split corner
  assert.deepEqual([...incidentFaces(a, 1)], [0]);
  assert.deepEqual([...incidentFaces(a, 2)], [0, 1]);
  assert.deepEqual([...incidentFaces(a, 3)], [1]);
});

test('adjacency: vertex→vertex deduplicates the shared edge', () => {
  const a = buildAdjacency(QUAD_V, QUAD_T);
  // vertex 0 touches both triangles; 2 is a corner of each, and must appear ONCE
  const n0 = [...neighbors(a, 0)].sort((x, y) => x - y);
  assert.deepEqual(n0, [1, 2, 3]);
  assert.equal(degree(a, 0), 3);
  const n2 = [...neighbors(a, 2)].sort((x, y) => x - y);
  assert.deepEqual(n2, [0, 1, 3]);
});

test('adjacency: offsets are EXACT — no padding, no sentinel', () => {
  const a = buildAdjacency(QUAD_V, QUAD_T);
  assert.equal(a.vvOffsets[0], 0);
  assert.equal(a.vvOffsets[a.vertexCount], a.vvNeighbors.length);
  for (let v = 0; v < a.vertexCount; v++) {
    assert.ok(a.vvOffsets[v] <= a.vvOffsets[v + 1], 'offsets monotonic');
    // a raw 0 in the array is a real vertex index, not an empty slot
    for (const w of neighbors(a, v)) assert.ok(w >= 0 && w < a.vertexCount);
  }
  assert.ok([...a.vvNeighbors].includes(0), 'vertex 0 appears unbiased');
});

test('adjacency: the graph is symmetric (v→w implies w→v)', () => {
  const g = grid(8);
  const a = buildAdjacency(g.vertices, g.triangles);
  for (let v = 0; v < a.vertexCount; v++) {
    for (const w of neighbors(a, v)) {
      assert.ok([...neighbors(a, w)].includes(v), `asymmetric ${v}→${w}`);
    }
  }
});

test('adjacency: a regular grid has the degrees the topology predicts', () => {
  const n = 6;
  const g = grid(n);
  const a = buildAdjacency(g.vertices, g.triangles);
  // this diagonal split gives interior vertices 6 neighbors; corners 2 or 3
  const interior = (n + 1) * 1 + 1;                        // (1,1)
  assert.equal(degree(a, interior), 6);
  assert.equal(degree(a, 0), 3);                           // the split corner
  assert.equal(degree(a, n), 2);                           // the off-diagonal corner
  assert.equal(a.faceCount, n * n * 2);
  assert.equal(a.vfFaces.length, n * n * 6);
});

test('adjacency: degenerate input is tolerated, not fatal', () => {
  // a triangle with a repeated corner, and one pointing off the end
  const t = new Uint32Array([0, 1, 2, 0, 0, 1, 0, 1, 99]);
  const a = buildAdjacency(QUAD_V, t);
  assert.equal(a.skipped, 1, 'the out-of-range face is skipped');
  assert.ok(!([...neighbors(a, 0)].includes(0)), 'no self-loop from the repeated corner');
  for (let v = 0; v < a.vertexCount; v++) {
    const row = [...neighbors(a, v)];
    assert.equal(new Set(row).size, row.length, `duplicates in row ${v}`);
  }
});

test('components: one painted patch per plane, deterministic ids', () => {
  // two grids side by side in one mesh → a subset spanning both must split in 2
  const g = grid(4);
  const a = buildAdjacency(g.vertices, g.triangles);
  const left = [0, 1, 5, 6];                               // a 2×2 block of vertices
  const right = [3, 4, 8, 9];                              // disjoint from `left`
  const { labels, count } = components(a, [...left, ...right]);
  assert.equal(count, 2);
  assert.equal(new Set(left.map((v) => labels[v])).size, 1, 'left is one component');
  assert.equal(new Set(right.map((v) => labels[v])).size, 1, 'right is one component');
  assert.notEqual(labels[left[0]], labels[right[0]]);
  assert.equal(labels[2], -1, 'vertices outside the subset are unlabeled');
  // ids ascend with vertex order, so a rerun cannot relabel
  assert.equal(labels[0], 0);
});

test('components: a fully connected subset is one component', () => {
  const g = grid(5);
  const a = buildAdjacency(g.vertices, g.triangles);
  const all = [...Array(a.vertexCount).keys()];
  assert.equal(components(a, all).count, 1);
});

test('BVH + raycast still work after the move to @gcu/geometry', () => {
  const bvh = buildBVH(QUAD_V, QUAD_T);
  const mesh = { vertices: QUAD_V, triangles: QUAD_T, nodes: bvh.nodes, triIndices: bvh.triIndices };
  // NB pick points OFF the shared diagonal (y = x): a ray down the seam may
  // legitimately return either triangle, which says nothing about correctness
  const lower = raycastBVH(mesh, [0.6, 0.25, 5], [0, 0, -1]);   // below y = x → tri 0
  const upper = raycastBVH(mesh, [0.25, 0.6, 5], [0, 0, -1]);   // above y = x → tri 1
  assert.ok(lower && upper, 'ray hits the quad on both halves');
  assert.equal(lower.tri, 0);
  assert.equal(upper.tri, 1);
  const hit = lower;
  assert.ok(Math.abs(hit.t - 5) < 1e-9);
  assert.ok(Math.abs(hit.point[2]) < 1e-9);
  assert.ok(Math.abs(Math.abs(hit.normal[2]) - 1) < 1e-9, 'plane normal is ±z');
  assert.equal(raycastBVH(mesh, [5, 5, 5], [0, 0, -1]), null, 'a miss is null');
});

test('raycast is two-sided and flips the normal toward the ray', () => {
  const bvh = buildBVH(QUAD_V, QUAD_T);
  const mesh = { vertices: QUAD_V, triangles: QUAD_T, nodes: bvh.nodes, triIndices: bvh.triIndices };
  const above = raycastBVH(mesh, [0.6, 0.25, 5], [0, 0, -1]);
  const below = raycastBVH(mesh, [0.6, 0.25, -5], [0, 0, 1]);
  assert.ok(above && below, 'hit from both sides');
  assert.ok(above.normal[2] > 0, 'normal faces the ray from above');
  assert.ok(below.normal[2] < 0, 'and from below');
});

test('adjacency scales linearly enough to be usable on a real mesh', () => {
  const g = grid(220);                                     // ~48k verts, ~96k tris
  const t0 = performance.now();
  const a = buildAdjacency(g.vertices, g.triangles);
  const ms = performance.now() - t0;
  assert.equal(a.vertexCount, 221 * 221);
  assert.ok(ms < 2000, `adjacency took ${ms.toFixed(0)} ms`);
  // and the CSR is internally consistent at scale
  assert.equal(a.vvOffsets[a.vertexCount], a.vvNeighbors.length);
  assert.equal(a.vfOffsets[a.vertexCount], a.vfFaces.length);
});

// ── mesh QA ──────────────────────────────────────────────────────────────────

// an axis-aligned box [x0,x1]×[y0,y1]×[z0,z1], faces wound outward
function box(x0, y0, z0, x1, y1, z1, { inward = false } = {}) {
  const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  if (inward) for (let t = 0; t < T.length; t += 3) [T[t + 1], T[t + 2]] = [T[t + 2], T[t + 1]];
  return { V, T };
}
const join = (...ms) => { const V = [], T = []; for (const m of ms) { const o = V.length / 3; V.push(...m.V); T.push(...m.T.map((i) => i + o)); } return { V, T }; };

test('meshQa — a closed box: watertight, consistent, its exact volume and area (far from the origin too)', () => {
  const b = box(500000, 7000000, 100, 500010, 7000020, 130);
  const r = meshQa(b.V, b.T);
  assert.equal(r.watertight, true); assert.equal(r.consistent, true);
  assert.equal(r.shells.length, 1);
  assert.ok(Math.abs(r.volume - 6000) < 1e-6, `volume ${r.volume}`);
  assert.ok(Math.abs(r.area - 2 * (200 + 300 + 600)) < 1e-6, `area ${r.area}`);
  for (const k of ['boundary', 'nonManifold', 'flipped', 'degenerate', 'duplicate']) assert.equal(r.issues[k].count, 0, k);
  const inv = meshQa(box(0, 0, 0, 1, 1, 1, { inward: true }).V, box(0, 0, 0, 1, 1, 1, { inward: true }).T);
  assert.ok(Math.abs(inv.volume + 1) < 1e-12, 'wound inward: the volume says so (negative)');
});

test('meshQa — a hole, a flipped face, a fin, a sliver and a duplicate are each found where they are', () => {
  const b = box(0, 0, 0, 2, 2, 2);
  const hole = meshQa(b.V, b.T.slice(3));                          // the first bottom triangle gone
  assert.equal(hole.watertight, false); assert.equal(hole.volume, null);
  assert.equal(hole.issues.boundary.count, 3);
  assert.ok(hole.issues.boundary.at.every((p) => p[2] === 0), 'the hole is in the bottom face');
  const T = b.T.slice(); [T[4], T[5]] = [T[5], T[4]];              // one face flipped
  const fl = meshQa(b.V, T);
  assert.equal(fl.consistent, false); assert.equal(fl.issues.flipped.count, 3, 'its three edges');
  const fin = meshQa([...b.V, 1, 1, 5], [...b.T, 0, 1, 8]);        // a third face on the 0-1 edge
  assert.equal(fin.issues.nonManifold.count, 1); assert.equal(fin.issues.boundary.count, 2);
  const sl = meshQa([...b.V, 0, 0, 0, 1, 0, 0, 2, 0, 0], [...b.T, 8, 9, 10], { weld: false });
  assert.equal(sl.issues.degenerate.count, 1, 'three points on a line');
  const dup = meshQa(b.V, [...b.T, b.T[0], b.T[2], b.T[1]]);
  assert.equal(dup.issues.duplicate.count, 1, 'the same three corners, either winding');
});

test('meshQa — a soup welds into one solid; two shells and a void sum by sign', () => {
  const b = box(0, 0, 0, 1, 1, 1);
  const V = [], T = [];
  for (let t = 0; t < b.T.length; t++) { V.push(b.V[3 * b.T[t]], b.V[3 * b.T[t] + 1], b.V[3 * b.T[t] + 2]); T.push(t); }   // every corner repeated per face
  const raw = meshQa(V, T, { weld: false });
  assert.equal(raw.shells.length, 12, 'unwelded: twelve loose triangles');
  const w = meshQa(V, T);
  assert.equal(w.welded, 36 - 8); assert.equal(w.watertight, true); assert.ok(Math.abs(w.volume - 1) < 1e-12);
  const two = meshQa(...Object.values(join(box(0, 0, 0, 1, 1, 1), box(5, 0, 0, 7, 1, 1))));
  assert.equal(two.shells.length, 2); assert.ok(Math.abs(two.volume - 3) < 1e-12);
  const hollow = meshQa(...Object.values(join(box(0, 0, 0, 4, 4, 4), box(1, 1, 1, 2, 2, 2, { inward: true }))));
  assert.ok(Math.abs(hollow.volume - (64 - 1)) < 1e-9, `a void wound inward subtracts: ${hollow.volume}`);
  const wv = weldVertices([0, 0, 0, 0, 0, 0, 1, 0, 0], [0, 1, 2]);
  assert.equal(wv.collapsed, 1); assert.equal(wv.triangles.length, 0);
});
