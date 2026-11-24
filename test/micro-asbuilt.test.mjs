// micro AS-BUILT — the pure pieces (tools/micro/src/grid-ops.js): the node lattice a point cloud
// grids onto, the point → node binner (min / mean / max / count), the common lattice of two
// surfaces, and cut / fill between them. Every check is against an analytic answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latticeForBbox, makePointBinner, commonSurfaceLattice, cutFillGrids, PC_STATS } from '../tools/micro/src/grid-ops.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);

test('latticeForBbox: nodes on round multiples of the cell (or through an anchor), covering the box', () => {
  const g = latticeForBbox([1003.2, 2001.7, 1047.9, 2030.1], 5);
  assert.equal(g.x0, 1005); assert.equal(g.y0, 2030); assert.equal(g.dx, 5);
  // covers: first node within half... the nodes reach past each edge by less than one cell
  assert.ok(g.x0 - 5 < 1003.2 && g.x0 + (g.nx - 1) * 5 >= 1047.9 - 5);
  assert.ok(g.y0 >= 2030.1 - 5 && g.y0 - (g.ny - 1) * 5 <= 2001.7 + 5);
  const h = latticeForBbox([1003.2, 2001.7, 1047.9, 2030.1], 5, [1.5, 2.5]);
  assert.equal(((h.x0 - 1.5) / 5) % 1, 0); assert.equal(((h.y0 - 2.5) / 5) % 1, 0);
});

test('the binner: each point on its nearest node; min / mean / max / count; outside counted', () => {
  const geom = { x0: 0, y0: 20, dx: 10, dy: 10, nx: 3, ny: 3 };          // nodes x 0,10,20 · y 20,10,0
  const xs = [0.4, -4.9, 4.9, 10, 10, 26], ys = [20, 19, 16, 10, 10, 0], zs = [5, 7, 3, 1, 9, 100];
  const got = {};
  for (const stat of PC_STATS) {
    const b = makePointBinner(geom, stat);
    b.add(xs, ys, zs, xs.length);
    got[stat] = b.finish();
  }
  // node (r0, c0) gets the first three points (z 5, 7, 3); node (r1, c1) gets 1 and 9; x = 26 is outside
  assert.equal(got.min.grid.data[0], 3); assert.equal(got.max.grid.data[0], 7); near(got.mean.grid.data[0], 5, 1e-6, 'mean');
  assert.equal(got.count.grid.data[0], 3);
  assert.equal(got.min.grid.data[4], 1); assert.equal(got.max.grid.data[4], 9); assert.equal(got.mean.grid.data[4], 5);
  assert.equal(got.mean.points, 5); assert.equal(got.mean.outside, 1);
  assert.equal(got.mean.filled, 2); assert.equal(got.mean.empty, 7);
  assert.equal(got.mean.grid.data[1], -9999);                              // empty → nodata …
  assert.equal(got.count.grid.data[1], 0);                                 // … but a count of 0
  assert.throws(() => makePointBinner(geom, 'median'), /statistic/);
});

test('the binner: a keep() mask skips points; non-finite coordinates are skipped', () => {
  const b = makePointBinner({ x0: 0, y0: 0, dx: 1, nx: 1, ny: 1 }, 'max');
  b.add([0, 0, NaN], [0, 0, 0], [1, 50, 99], 3, (i) => i !== 1);
  const r = b.finish();
  assert.equal(r.grid.data[0], 1); assert.equal(r.skipped, 2);
});

test('a DEM from a dense random cloud on an analytic surface sits within a cell’s slope of it', () => {
  const f = (x, y) => 300 + 0.05 * x - 0.03 * y + 4 * Math.sin(x / 40) * Math.cos(y / 30);
  // |∇f| ≤ 0.05 + 0.1 + 0.03 + 0.1334 < 0.32 m/m; a point is ≤ cell·√2/2 from its node
  const cell = 2, geom = latticeForBbox([0, 0, 200, 150], cell);
  const b = makePointBinner(geom, 'mean');
  let s = 12345; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32
  const N = 200000, X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N);
  for (let i = 0; i < N; i++) { X[i] = rnd() * 200; Y[i] = rnd() * 150; Z[i] = f(X[i], Y[i]); }
  b.add(X, Y, Z, N);
  const { grid, filled } = b.finish();
  assert.ok(filled > 0.95 * grid.nx * grid.ny);
  const tol = 0.32 * cell * Math.SQRT1_2;
  let worst = 0;
  for (let r = 0; r < grid.ny; r++) for (let c = 0; c < grid.nx; c++) {
    const v = grid.data[r * grid.nx + c]; if (v === -9999) continue;
    worst = Math.max(worst, Math.abs(v - f(grid.x0 + c * cell, grid.y0 - r * cell)));
  }
  assert.ok(worst <= tol, `worst ${worst} > ${tol}`);
});

test('commonSurfaceLattice: the finer grid’s own nodes over the overlap; null when apart', () => {
  const a = { x0: 0, y0: 100, dx: 2, nx: 51, ny: 51 };                     // x 0..100, y 0..100
  const b = { x0: 31, y0: 141, dx: 5, nx: 30, ny: 30 };                    // x 31..176, y −4..141
  const g = commonSurfaceLattice(a, b);
  assert.equal(g.dx, 2); assert.equal(g.x0, 32); assert.equal(g.y0, 100);
  assert.equal(g.x0 + (g.nx - 1) * 2, 100); assert.equal(g.y0 - (g.ny - 1) * 2, 0);
  const g5 = commonSurfaceLattice(a, b, 10);                                // a stated cell, the finer one's phase
  assert.equal(g5.dx, 10); assert.equal(g5.x0 % 2, 0);
  assert.equal(commonSurfaceLattice(a, { x0: 500, y0: 100, dx: 2, nx: 3, ny: 3 }), null);
});

test('cut / fill: a pit and a dump against analytic volumes (exact for Δz linear per cell)', () => {
  // before: a plane; after: the plane minus a box pit 40 × 30 × 6 (cut 7200) plus a box dump 20 × 10 × 3 (fill 600)
  const cell = 1, nx = 101, ny = 81, before = { nx, ny, x0: 0, y0: 80, dx: cell, dy: cell, data: new Float32Array(nx * ny), nodata: -9999 };
  const after = { ...before, data: new Float32Array(nx * ny) };
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const x = c, y = 80 - r, z = 200 + 0.1 * x + 0.02 * y, k = r * nx + c;
    before.data[k] = z;
    let d = 0;
    if (x >= 10 && x < 50 && y >= 10 && y < 40) d = -6;                     // 40 × 30 nodes
    if (x >= 70 && x < 90 && y >= 50 && y < 60) d = 3;                      // 20 × 10 nodes
    after.data[k] = z + d;
  }
  before.data[0] = -9999;                                                   // a hole in one surface sits out
  const r = cutFillGrids(before, after);
  near(r.cut, 40 * 30 * 6, 1e-2, 'cut'); near(r.fill, 20 * 10 * 3, 1e-2, 'fill'); near(r.net, 600 - 7200, 1e-2, 'net');
  assert.equal(r.cutArea, 1200); assert.equal(r.fillArea, 200); assert.equal(r.nodes, nx * ny - 1); assert.equal(r.area, nx * ny - 1);
  assert.equal(r.dz.data[0], -9999); near(r.range[0], -6, 1e-4, 'Δz min'); near(r.range[1], 3, 1e-4, 'Δz max');
  // the histogram carries the moved volume: cut bins sum to the cut, fill bins to the fill
  let hc = 0, hf = 0; r.hist.vol.forEach((v, i) => { if (r.hist.lo + (i + 0.5) * r.hist.w < 0) hc += v; else hf += v; });
  near(hc, r.cut, 1e-2, 'hist cut'); near(hf, r.fill, 1e-2, 'hist fill');
  assert.throws(() => cutFillGrids(before, { ...after, nx: 3 }), /different lattices/);
});

test('cut / fill: a paraboloid bowl — the node sum converges on the integral', () => {
  // Δz = −h·(1 − ρ²/R²) inside ρ < R: volume = π R² h / 2
  const R = 50, h = 10, cell = 0.5, n = Math.round(120 / cell) + 1;
  const g = (fn) => { const data = new Float32Array(n * n); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) data[r * n + c] = fn(-60 + c * cell, 60 - r * cell); return { nx: n, ny: n, x0: -60, y0: 60, dx: cell, dy: cell, data, nodata: -9999 }; };
  const before = g(() => 100), after = g((x, y) => { const q = (x * x + y * y) / (R * R); return 100 - (q < 1 ? h * (1 - q) : 0); });
  const r = cutFillGrids(before, after);
  near(r.cut, Math.PI * R * R * h / 2, Math.PI * R * R * h / 2 * 2e-3, 'bowl');
  assert.equal(r.fill, 0);
});
