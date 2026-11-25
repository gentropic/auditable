// micro wave 6 — the pure kernels behind BENCH OUTLINES (tools/micro/src/blockoutline-core.js:
// marching squares on an occupancy grid) and SECTION LINES (tools/micro/src/sectionlines-core.js:
// plane ∩ mesh / heightfield / block-domain faces, chained into polylines). Every expected number
// is worked out from the geometry here, not read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlineCells, labelCells, simplifyRing, ringAreaIJ } from '../tools/micro/src/blockoutline-core.js';
import { meshPlaneSegments, gridToMesh, latticeBoundarySegments, chainSegments, lineLength, dropCollinear } from '../tools/micro/src/sectionlines-core.js';

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≉ ${b} (±${tol})`);
// an occupancy grid from rows of text, the TOP row first ('#' = occupied)
const occOf = (rows) => {
  const ny = rows.length, nx = rows[0].length, occ = new Uint8Array(nx * ny);
  rows.forEach((r, k) => { const j = ny - 1 - k; for (let i = 0; i < nx; i++) occ[i + j * nx] = r[i] === '#' ? 1 : 0; });
  return { occ, nx, ny, count: occ.reduce((s, v) => s + v, 0) };
};
const polyArea = (p) => ringAreaIJ(p.outer) + p.holes.reduce((s, h) => s + ringAreaIJ(h), 0);   // holes are clockwise: negative
const ringKey = (r) => { const s = r.map((p) => p.join(',')); const k = s.indexOf(s.slice().sort()[0]); return [...s.slice(k), ...s.slice(0, k)].join(' '); };

test('outlineCells: one cell → its unit square, counter-clockwise from the corner', () => {
  const g = occOf(['#']);
  const out = outlineCells(g.occ, g.nx, g.ny);
  assert.equal(out.length, 1);
  assert.equal(ringKey(out[0].outer), '0,0 1,0 1,1 0,1');
  assert.equal(out[0].holes.length, 0);
});

test('outlineCells: a straight run is one edge per side (collinear corners dropped); an L keeps its six corners', () => {
  const bar = occOf(['#####']);
  const b = outlineCells(bar.occ, bar.nx, bar.ny)[0];
  assert.equal(b.outer.length, 4);
  assert.equal(ringAreaIJ(b.outer), 5);
  const L = occOf(['#..', '#..', '###']);
  const l = outlineCells(L.occ, L.nx, L.ny)[0];
  assert.equal(l.outer.length, 6);
  assert.equal(ringAreaIJ(l.outer), 5);
});

test('outlineCells: a ring of cells → an outer ring and a clockwise hole; area = the cell count', () => {
  const g = occOf(['#####', '#...#', '#...#', '#####']);
  const out = outlineCells(g.occ, g.nx, g.ny);
  assert.equal(out.length, 1);
  assert.equal(out[0].holes.length, 1);
  assert.ok(ringAreaIJ(out[0].outer) > 0 && ringAreaIJ(out[0].holes[0]) < 0, 'outer CCW, hole CW');
  assert.equal(ringAreaIJ(out[0].outer), 20);
  assert.equal(ringAreaIJ(out[0].holes[0]), -6);
  assert.equal(polyArea(out[0]), g.count);
  assert.equal(out[0].cells, g.count);
});

test('outlineCells: diagonal touching — two cells meeting at a corner are TWO polygons, each simple', () => {
  const g = occOf(['.#', '#.']);
  const out = outlineCells(g.occ, g.nx, g.ny);
  assert.equal(out.length, 2);
  for (const p of out) { assert.equal(p.outer.length, 4); assert.equal(ringAreaIJ(p.outer), 1); assert.equal(p.holes.length, 0); }
  const anti = occOf(['#.', '.#']);
  assert.equal(outlineCells(anti.occ, anti.nx, anti.ny).length, 2);
});

test('outlineCells: a region that pinches round a hole at a corner — the hole and the outside stay apart', () => {
  // the hole cell (1,1) is enclosed; the region touches itself diagonally at its top-right
  const g = occOf(['##..', '#.#.', '###.']);
  const out = outlineCells(g.occ, g.nx, g.ny);
  const total = out.reduce((s, p) => s + polyArea(p), 0);
  assert.equal(total, g.count, 'area = cells');
  for (const p of out) {                                      // every ring simple: no repeated corner
    for (const r of [p.outer, ...p.holes]) assert.equal(new Set(r.map((q) => q.join(','))).size, r.length);
  }
  // 4-connectivity: (1,2) touches (2,1) only at a corner, so there are as many polygons as
  // 4-connected components, and the empty cell they ring is a hole of neither
  assert.equal(out.length, labelCells(g.occ, g.nx, g.ny).count);
});

test('outlineCells: a checkerboard is all separate squares; a random grid always keeps area = cells', () => {
  const cb = occOf(['#.#.', '.#.#', '#.#.', '.#.#']);
  const out = outlineCells(cb.occ, cb.nx, cb.ny);
  assert.equal(out.length, 8);
  assert.ok(out.every((p) => p.outer.length === 4 && ringAreaIJ(p.outer) === 1));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < 20; t++) {
    const nx = 13, ny = 9, occ = new Uint8Array(nx * ny);
    for (let c = 0; c < occ.length; c++) occ[c] = rnd() < 0.55 ? 1 : 0;
    const cnt = occ.reduce((s, v) => s + v, 0);
    const res = outlineCells(occ, nx, ny);
    assert.equal(res.reduce((s, p) => s + polyArea(p), 0), cnt, `trial ${t}`);
    assert.equal(res.reduce((s, p) => s + p.cells, 0), cnt);
    for (const p of res) for (const r of [p.outer, ...p.holes]) assert.equal(new Set(r.map((q) => q.join(','))).size, r.length, `trial ${t}: a ring repeats a corner`);
  }
});

test('simplifyRing: a staircase within the tolerance collapses to its diagonal; vertices are kept, never moved', () => {
  // a 1-step staircase from (0,0) to (4,4), closed back along the axes
  const stair = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 3], [2, 3], [2, 2], [1, 2], [1, 1], [0, 1]];
  const s = simplifyRing(stair, 0.8);
  assert.ok(s.length < stair.length, `${s.length} < ${stair.length}`);
  const keys = new Set(stair.map((p) => p.join(',')));
  assert.ok(s.every((p) => keys.has(p.join(','))), 'every kept vertex is an original one');
  assert.deepEqual(simplifyRing(stair, 0), stair);
  assert.ok(simplifyRing(stair, 100).length >= 3);
});

// ── section lines ─────────────────────────────────────────────────────────────────────────────
const E0 = 612000, N0 = 7765000;
// a closed box mesh, outward
function boxMesh(x0, y0, z0, x1, y1, z1) {
  const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { vertices: Float64Array.from(V), triangles: Uint32Array.from(T) };
}
const planArea = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return Math.abs(s / 2); };

test('meshPlaneSegments + chainSegments: a box cut by a plan → one closed rectangle, four corners, the right size', () => {
  const m = boxMesh(E0 + 20, N0 + 30, 800, E0 + 80, N0 + 70, 900);
  const segs = meshPlaneSegments(m.vertices, m.triangles, [0, 0, 1], 850);
  const lines = chainSegments(segs);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].closed);
  assert.equal(lines[0].pts.length, 4, 'the face diagonals’ mid points are collinear: dropped');
  near(lineLength(lines[0].pts, true), 200, 1e-6, 'perimeter');
  near(planArea(lines[0].pts), 60 * 40, 1e-6, 'area');
  assert.ok(lines[0].pts.every((p) => p[2] === 850));
});

test('meshPlaneSegments: a plane through a vertex layer cuts once (half-open) — a box cut exactly at its floor is a rectangle, not two', () => {
  const m = boxMesh(0, 0, 0, 10, 20, 5);
  const lines = chainSegments(meshPlaneSegments(m.vertices, m.triangles, [0, 0, 1], 0));
  assert.equal(lines.length, 1);
  near(planArea(lines[0].pts), 200, 1e-9);
  const off = chainSegments(meshPlaneSegments(m.vertices, m.triangles, [0, 0, 1], 5.0001));
  assert.equal(off.length, 0, 'a plane above the box cuts nothing');
});

test('chainSegments: open chains run end to end; a junction of three ends each line', () => {
  const s = (a, b, ka, kb) => ({ a, b, ka, kb });
  const open = chainSegments([s([1, 0, 0], [2, 0, 0], 'b', 'c'), s([0, 0, 0], [1, 0, 0], 'a', 'b'), s([2, 0, 0], [2, 1, 0], 'c', 'd')]);
  assert.equal(open.length, 1);
  assert.equal(open[0].closed, false);
  assert.deepEqual(open[0].pts.map((p) => p.slice(0, 2)), [[0, 0], [2, 0], [2, 1]]);
  const star = chainSegments([s([0, 0, 0], [1, 0, 0], 'o', 'x'), s([0, 0, 0], [0, 1, 0], 'o', 'y'), s([0, 0, 0], [-1, 0, 0], 'o', 'z')]);
  assert.equal(star.length, 3);
  assert.deepEqual(dropCollinear([[0, 0, 0], [1, 0, 0], [2, 0, 0]], false), [[0, 0, 0], [2, 0, 0]]);
});

test('gridToMesh + meshPlaneSegments: a sloping grid cut by a plan is the contour; cut N–S it is the profile', () => {
  const g = { x0: E0, y0: N0 + 100, dx: 5, dy: 5, nx: 41, ny: 21, nodata: -9999, data: new Float64Array(41 * 21) };
  for (let r = 0; r < g.ny; r++) for (let c = 0; c < g.nx; c++) g.data[r * g.nx + c] = 850 + 0.1 * (c * g.dx);
  const m = gridToMesh(g);
  const contour = chainSegments(meshPlaneSegments(m.vertices, m.triangles, [0, 0, 1], 855));
  assert.equal(contour.length, 1);
  assert.ok(contour[0].pts.every((p) => Math.abs(p[0] - (E0 + 50)) < 1e-6), 'z = 855 at x = 50');
  near(lineLength(contour[0].pts, false), 100, 1e-6);
  const prof = chainSegments(meshPlaneSegments(m.vertices, m.triangles, [1, 0, 0], E0 + 100.5));
  assert.equal(prof.length, 1);
  assert.ok(prof[0].pts.every((p) => Math.abs(p[2] - 860.05) < 1e-6));
  // a nodata hole breaks the line
  g.data[10 * g.nx + 10] = -9999;
  const m2 = gridToMesh(g);
  assert.ok(m2.triangles.length < m.triangles.length);
});

test('latticeBoundarySegments: a staircase between two domains on a plan = 38 lattice edges, 380 m, one line', () => {
  // 20 × 20 × 3 regular 10 m blocks, A where i + j < 20; plan at the middle of bench 1
  const blocks = [];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) blocks.push({ lo: [i, j, k], size: [1, 1, 1], cat: i + j < 20 ? 'A' : 'B' });
  const lattice = { pitch: [10, 10, 10], originQ: [E0 + 5, N0 + 5, 805], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], anchor: [0, 0, 0] };
  const segs = latticeBoundarySegments(blocks, lattice, [0, 0, 1], 815);
  assert.equal(segs.length, 38);
  assert.ok(segs.every((s) => s.pair.join('/') === 'A/B'));
  const lines = chainSegments(segs);
  assert.equal(lines.length, 1);
  near(lineLength(lines[0].pts, false), 380, 1e-6);
  assert.ok(lines[0].pts.every((p) => Math.abs(p[2] - 815) < 1e-9));
  const ends = [lines[0].pts[0], lines[0].pts[lines[0].pts.length - 1]].map((p) => [p[0] - E0, p[1] - N0].map((v) => Math.round(v * 1e6) / 1e6).join(',')).sort();
  assert.deepEqual(ends, ['10,200', '200,10']);
  // exactly at a bench boundary (z = 810) the upper bench is the one cut — still 38, never 76
  assert.equal(latticeBoundarySegments(blocks, lattice, [0, 0, 1], 810).length, 38);
  // outer: the model's edge too — a closed square around everything (4 × 200) plus the staircase
  const withEdge = chainSegments(latticeBoundarySegments(blocks, lattice, [0, 0, 1], 815, { outer: true }));
  near(withEdge.reduce((s, l) => s + lineLength(l.pts, l.closed), 0), 380 + 800, 1e-6);
});

test('latticeBoundarySegments: a rotated lattice — the boundary is mapped to world through R and the anchor', () => {
  const az = 30 * Math.PI / 180, R = [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1];   // columns: U, V, W
  const A = [E0 + 345.5, N0 + 432.25, 812.5];
  const blocks = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) blocks.push({ lo: [i, j, 0], size: [1, 1, 1], cat: i < 3 ? 'ore' : 'waste' });
  const lattice = { pitch: [10, 10, 5], originQ: [0, 0, 0], R, anchor: A };
  const lines = chainSegments(latticeBoundarySegments(blocks, lattice, [0, 0, 1], A[2]));
  assert.equal(lines.length, 1);
  near(lineLength(lines[0].pts, false), 40, 1e-6);
  // the boundary lies on the lattice plane u = 25 (between cells 2 and 3): world = A + 25·U + v·V
  for (const p of lines[0].pts) { const dx = p[0] - A[0], dy = p[1] - A[1]; near(dx * R[0] + dy * R[1], 25, 1e-6, 'u'); }
});

test('latticeBoundarySegments: sub-blocks — a parent split into 8 meets its neighbours along exact fine edges', () => {
  // fine pitch 5: parents are 2 × 2 × 2 steps; parent (1,0,0) split into 8 sub-blocks of one step, half of them 'B'
  const blocks = [{ lo: [0, 0, 0], size: [2, 2, 2], cat: 'A' }, { lo: [4, 0, 0], size: [2, 2, 2], cat: 'A' }];
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 2; i < 4; i++) blocks.push({ lo: [i, j, k], size: [1, 1, 1], cat: j === 0 ? 'B' : 'A' });
  const lattice = { pitch: [5, 5, 5], originQ: [2.5, 2.5, 2.5], R: [1, 0, 0, 0, 1, 0, 0, 0, 1], anchor: [0, 0, 0] };
  const segs = latticeBoundarySegments(blocks, lattice, [0, 0, 1], 2.5);
  // B occupies x 10..20, y 0..5: its boundary with A is x = 10 (y 0..5), y = 5 (x 10..20), x = 20 (y 0..5) = 20 m
  const len = segs.reduce((s, q) => s + Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]), 0);
  near(len, 20, 1e-9);
  const lines = chainSegments(segs);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].pts.length, 4, 'a U: four corners');
});
