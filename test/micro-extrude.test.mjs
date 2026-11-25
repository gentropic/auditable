// micro polygons as limits + extrusion (wave 4b) — the pure kernels:
// tools/micro/src/coverage.js (exact plan coverage of lattice cells) and
// tools/micro/src/extrude-core.js (polygon → closed solid: z-range, oriented, between surfaces).
// Every expected number is worked out from the geometry, not read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCoverage, gridCoverage, clipRectArea, featuresAreaXY, clipGridLattice } from '../tools/micro/src/coverage.js';
import { extrudeZRange, extrudeOriented, extrudeBetween, manifoldCheck, meshVolume, directionOf } from '../tools/micro/src/extrude-core.js';

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≉ ${b} (±${tol})`);
// a feature as polygons.js makes them: rings without the repeated closing vertex
const poly = (...rings) => ({ kind: 'polygon', closed: true, rings, parts: [rings.map((_, i) => i)] });
const rect = (x, y, w, h, z = 0) => [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]];
const E0 = 612000, N0 = 7765000;                                 // UTM magnitudes: the arithmetic must hold out there
const L_SHAPE = [[E0, N0, 850], [E0 + 60, N0, 850], [E0 + 60, N0 + 20, 850], [E0 + 25, N0 + 20, 850], [E0 + 25, N0 + 50, 850], [E0, N0 + 50, 850]];   // 60×20 + 25×30 = 1950 m²
const HOLE = rect(E0 + 5, N0 + 5, 10, 8, 850).reverse();          // 80 m²

test('clipRectArea: a triangle across a cell, a cell inside, a cell outside', () => {
  const tri = [[0, 0], [4, 0], [0, 4]];
  near(clipRectArea(tri, 0, 0, 1, 1), 1, 1e-12, 'inside');
  near(clipRectArea(tri, 1, 1, 3, 3), 2, 1e-12, 'across the hypotenuse');   // the square [1,3]² under x + y ≤ 4: 4 − 2 = 2
  near(clipRectArea(tri, 5, 5, 6, 6), 0, 0, 'outside');
});

test('planCoverage: the covered cells sum to the polygon area EXACTLY — any phase, holes subtract', () => {
  const f = poly(L_SHAPE, HOLE);
  for (const [ox, oy, d] of [[E0 + 0.37, N0 - 0.81, 2.5], [E0 - 3.1, N0 + 1.7, 1], [E0 + 0.5, N0 + 0.5, 7.3]]) {
    const nx = Math.ceil(80 / d) + 2, ny = Math.ceil(70 / d) + 2;
    const fr = planCoverage([f], { ox: ox - 6, oy: oy - 6, dx: d, dy: d, nx: nx + 4, ny: ny + 4 });
    let s = 0; for (const v of fr) s += v;
    near(s * d * d, 1950 - 80, 1e-3, `cell ${d}`);   // Float32 cells: exact to float precision
  }
  // row 0 on top (a grid): the same total through gridCoverage
  const g = { x0: E0 - 5, y0: N0 + 60, dx: 1.3, dy: 1.3, nx: 80, ny: 60 };
  let s = 0; for (const v of gridCoverage([f], g)) s += v;
  near(s * 1.3 * 1.3, 1870, 1e-3, 'grid order');
  near(featuresAreaXY([f]), 1870, 1e-9, 'featuresAreaXY');
  // a lattice clipped to the polygon keeps the phase and every covered node
  const c = clipGridLattice(g, [E0, N0, E0 + 60, N0 + 50]);
  s = 0; for (const v of gridCoverage([f], c)) s += v;
  near(s * 1.3 * 1.3, 1870, 1e-3, 'clipped lattice');
  { const q = (c.x0 - g.x0) / g.dx; assert.ok(c.nx < g.nx && Math.abs(q - Math.round(q)) < 1e-6); }
});

test('planCoverage: overlapping features never cover more than the cell', () => {
  const a = poly(rect(0, 0, 10, 10)), b = poly(rect(5, 0, 10, 10));
  const fr = planCoverage([a, b], { ox: 0.5, oy: 0.5, dx: 1, dy: 1, nx: 15, ny: 10 });
  let s = 0; for (const v of fr) { assert.ok(v <= 1); s += v; }
  near(s, 150, 1e-9);                                            // the union, 15 × 10 — not 200
});

const watertight = (m, what) => {
  const c = manifoldCheck(m.vertices, m.triangles);
  assert.ok(c.ok, `${what}: boundary ${c.boundary}, non-manifold ${c.nonManifold}, misoriented ${c.misoriented}`);
  assert.ok(c.volume > 0, `${what}: outward (volume ${c.volume})`);
  return c;
};

test('z-range prism: volume = area × height, holes respected, watertight + outward', () => {
  const m = extrudeZRange(poly(L_SHAPE, HOLE), { z0: 820, z1: 850 });
  watertight(m, 'L with a hole');
  near(m.volume, 1870 * 30, 1e-6, 'volume');
  near(meshVolume(m.vertices, m.triangles), 1870 * 30, 1e-6);
  // a clockwise ring and z0 > z1 make the same solid
  const m2 = extrudeZRange(poly(L_SHAPE.slice().reverse()), { z0: 850, z1: 820 });
  watertight(m2, 'reversed');
  near(m2.volume, 1950 * 30, 1e-6);
  // a multipolygon: two shells, one mesh
  const mp = { kind: 'polygon', closed: true, rings: [rect(0, 0, 10, 10), rect(20, 0, 5, 4)], parts: [[0], [1]] };
  const m3 = extrudeZRange(mp, { z0: 0, z1: 2 });
  watertight(m3, 'multipolygon');
  near(m3.volume, (100 + 20) * 2, 1e-9);
  assert.throws(() => extrudeZRange(poly(L_SHAPE), { z0: 5, z1: 5 }), /height/);
  assert.throws(() => extrudeZRange({ kind: 'line', closed: false, rings: [L_SHAPE], parts: [[0]] }, { z0: 0, z1: 1 }), /line has no inside/);
});

test('oriented prism: volume = plan area × length × |sin plunge|, either sense, watertight', () => {
  const f = poly(L_SHAPE, HOLE);
  for (const [trend, plunge, len] of [[90, 60, 40], [215, 35, 25], [10, -50, 30]]) {
    const m = extrudeOriented(f, { direction: { trend, plunge }, length: len });
    watertight(m, `${trend}/${plunge}`);
    near(m.volume, 1870 * len * Math.abs(Math.sin(plunge * Math.PI / 180)), 1e-6, `${trend}/${plunge}`);
  }
  // the DIRECTION (sweep 2026-11-25: volume and watertightness don't depend on it, so a prism
  // pointing the wrong way passed): the solid's centroid = the base polygon's + half the push
  const solidCentroid = (m) => {
    const V = m.vertices, T = m.triangles, ox = V[0], oy = V[1], oz = V[2];
    let vol = 0, cx = 0, cy = 0, cz = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ax = V[a] - ox, ay = V[a + 1] - oy, az = V[a + 2] - oz, bx = V[b] - ox, by = V[b + 1] - oy, bz = V[b + 2] - oz, qx = V[c] - ox, qy = V[c + 1] - oy, qz = V[c + 2] - oz;
      const v6 = ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);
      vol += v6; cx += v6 * (ax + bx + qx) / 4; cy += v6 * (ay + by + qy) / 4; cz += v6 * (az + bz + qz) / 4;
    }
    return [ox + cx / vol, oy + cy / vol, oz + cz / vol];
  };
  // the base's plan centroid: L shape (1950 m²) minus the hole (80 m²), at z 850
  const ringC = (r) => { let a = 0, x = 0, y = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) { const k = (r[j][0] - E0) * (r[i][1] - N0) - (r[i][0] - E0) * (r[j][1] - N0); a += k; x += (r[j][0] - E0 + r[i][0] - E0) * k; y += (r[j][1] - N0 + r[i][1] - N0) * k; } return { a: a / 2, x: x / (3 * a), y: y / (3 * a) }; };
  const cL = ringC(L_SHAPE), cH = ringC(HOLE), A = Math.abs(cL.a) - Math.abs(cH.a);
  const base = [E0 + (Math.abs(cL.a) * cL.x - Math.abs(cH.a) * cH.x) / A, N0 + (Math.abs(cL.a) * cL.y - Math.abs(cH.a) * cH.y) / A, 850];
  for (const [trend, plunge, len] of [[90, 60, 40], [215, 35, 25], [10, -50, 30]]) {
    const m = extrudeOriented(f, { direction: { trend, plunge }, length: len }), dir = directionOf({ trend, plunge });
    const c = solidCentroid(m), want = base.map((v, k) => v + dir[k] * len / 2);
    for (let k = 0; k < 3; k++) near(c[k], want[k], 1e-6, `${trend}/${plunge} centroid axis ${k}`);
  }
  const d = directionOf({ trend: 90, plunge: 30 });
  near(d[0], Math.cos(Math.PI / 6), 1e-12); near(d[2], -0.5, 1e-12);
  const v = extrudeOriented(f, { direction: [0, 0, -1], length: 30 });
  watertight(v, 'a vector, straight down'); near(v.volume, 1870 * 30, 1e-6);
  assert.throws(() => extrudeOriented(f, { direction: [1, 0, 0], length: 3 }), /plunge/);
});

test('between two planes: the volume is exact (linear caps are linear)', () => {
  const f = poly(L_SHAPE, HOLE);
  const top = (x, y) => 900 + 0.1 * (x - E0) - 0.05 * (y - N0), bottom = (x) => 800 + 0.02 * (x - E0);
  const m = extrudeBetween(f, { top, bottom, tol: 0.01 });
  watertight(m, 'between planes');
  // ∫∫ (top − bottom) dA = ∫∫ (100 + 0.08 x′ − 0.05 y′) over the L minus the hole (x′, y′ from E0, N0)
  const mom = (x0, x1, y0, y1) => { const A = (x1 - x0) * (y1 - y0); return { A, mx: A * (x0 + x1) / 2, my: A * (y0 + y1) / 2 }; };
  const pieces = [mom(0, 60, 0, 20), mom(0, 25, 20, 50)], hole = mom(5, 15, 5, 13);
  let A = 0, mx = 0, my = 0; for (const p of pieces) { A += p.A; mx += p.mx; my += p.my; }
  A -= hole.A; mx -= hole.mx; my -= hole.my;
  near(m.volume, 100 * A + 0.08 * mx - 0.05 * my, 1e-5, 'volume');
  assert.equal(m.stats.crossed, 0);
});

test('between a curved top and a plane: the cap follows the surface within tol; the volume converges', () => {
  // a dome over a 100 m square: top = 900 + 20·(1 − ((x′−50)² + (y′−50)²)/5000), bottom flat at 850
  const f = poly(rect(E0, N0, 100, 100, 0));
  const top = (x, y) => { const u = x - E0 - 50, v = y - N0 - 50; return 900 + 20 * (1 - (u * u + v * v) / 5000); };
  const bottom = () => 850;
  // analytic: ∫∫ (50 + 20 − 20(u² + v²)/5000) over [−50, 50]² = 70·10⁴ − (20/5000)·2·(100·(2·50³/3)) = 700000 − 66666.67
  const exact = 700000 - (20 / 5000) * 2 * 100 * (2 * 50 ** 3 / 3);
  const loose = extrudeBetween(f, { top, bottom, tol: 0.5 }), tight = extrudeBetween(f, { top, bottom, tol: 0.02 });
  watertight(loose, 'dome loose'); watertight(tight, 'dome tight');
  assert.ok(tight.stats.maxDeviation <= 0.02 + 1e-9, `measured deviation ${tight.stats.maxDeviation}`);
  assert.ok(loose.stats.maxDeviation <= 0.5 + 1e-9);
  // a cap that strays ≤ tol from the top bounds the volume error by tol × area
  near(tight.volume, exact, 0.02 * 1e4, 'tight volume');
  assert.ok(Math.abs(tight.volume - exact) < Math.abs(loose.volume - exact), 'tighter tolerance → closer volume');
  assert.ok(tight.triangles.length > loose.triangles.length);
});

test('between: surfaces that cross pinch the solid instead of turning it inside out; a gap in a surface refuses', () => {
  const f = poly(rect(0, 0, 10, 10));
  const m = extrudeBetween(f, { top: (x) => x, bottom: () => 5, tol: 0.01, maxEdge: 2 });
  watertight(m, 'crossing');
  near(m.volume, 10 * (5 * 5 / 2), 2, 'only where top is above bottom');   // ∫∫ max(0, x − 5) = 10 · 12.5 (the pinch line is linear across a triangle: a little over)
  assert.ok(m.stats.crossed > 0);
  assert.throws(() => extrudeBetween(f, { top: (x) => (x > 8 ? NaN : 10), bottom: () => 0 }), /no value/);
});

// sweep 2026-11-25: between two surfaces, a hole on whole-metre coordinates often left a T-junction
// in the cap (the ear clipper drops collinear vertices; the walls are read from the cap's boundary
// edges), so the solid came out non-manifold and was refused — 35 of these 200 before the fix.
test('extrude between surfaces: holes on whole metres stay closed, volume = the integral', () => {
  const sq = (x, y, w, h) => [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]];
  const X0 = 612000, Y0 = 7765000;
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const hx = 5 + Math.round(25 * rnd()), hy = 3 + Math.round(20 * rnd()), w = 2 + Math.round(5 * rnd()), h = 2 + Math.round(4 * rnd());
    const f = poly(sq(X0, Y0, 40, 30), sq(X0 + hx, Y0 + hy, w, h).reverse());
    const m = extrudeBetween(f, { top: (x) => 900 + 0.01 * (x - X0), bottom: () => 850 });
    const chk = manifoldCheck(m.vertices, m.triangles);
    // ∫∫ (50 + 0.01·x') dA over the rectangle minus the hole (x' = x − X0); the top is linear, so exact
    const want = 50 * 1200 + 0.01 * (40 * 40 / 2) * 30 - (50 * w * h + 0.01 * h * ((hx + w) ** 2 - hx ** 2) / 2);
    if (!chk.ok || Math.abs(meshVolume(m.vertices, m.triangles) - want) > 1e-6 * want) bad++;
  }
  assert.equal(bad, 0, `${bad} of 200 holed polygons came out non-manifold or with the wrong volume`);
});
