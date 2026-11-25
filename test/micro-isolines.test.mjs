// micro CONTOURS — the isoline tracer (tools/micro/src/grid-ops.js isolines / contourLevels).
// Every expectation is worked from the field, not read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolines, contourLevels } from '../tools/micro/src/grid-ops.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const grid = (nx, ny, f, { x0 = 0, y0 = (ny - 1), dx = 1, nodata = -9999 } = {}) => {
  const data = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) data[r * nx + c] = f(x0 + c * dx, y0 - r * dx);
  return { nx, ny, x0, y0, dx, dy: dx, data, nodata };
};

test('a plane: each level is ONE straight open line, exactly where the plane equals it', () => {
  const g = grid(11, 8, (x) => 500 + 0.2 * (x - 612000), { x0: 612000, y0: 7765070, dx: 10 });   // 500 … 520 across x
  for (const L of isolines(g, [505, 517.5])) {
    assert.equal(L.lines.length, 1, `level ${L.level}`);
    const ln = L.lines[0];
    assert.equal(ln.closed, false);
    for (const p of ln.pts) { near(p[0], 612000 + (L.level - 500) / 0.2, 1e-6, 'x on the level'); near(p[2], L.level, 0, 'z = the level'); }
    near(Math.max(...ln.pts.map((p) => p[1])) - Math.min(...ln.pts.map((p) => p[1])), 70, 1e-9, 'it spans the grid in y');
  }
});

test('a cone: each level is ONE closed ring around the summit, at the right radius', () => {
  const g = grid(41, 41, (x, y) => 100 - Math.hypot(x - 20, y - 20), { x0: 0, y0: 40 });
  for (const L of isolines(g, [95, 88])) {
    assert.equal(L.lines.length, 1);
    assert.equal(L.lines[0].closed, true);
    const rs = L.lines[0].pts.map((p) => Math.hypot(p[0] - 20, p[1] - 20)), want = 100 - L.level;
    // linear interpolation along cell edges sits slightly inside a curved isoline: within a cell's sag
    for (const r of rs) assert.ok(r <= want + 1e-4 && r >= want - 0.08, `radius ${r} vs ${want}`);
  }
});

test('a saddle resolved by the centre: the two pairs join on the side the centre is on', () => {
  // corners TL, BR at or above the level; TR, BL below it — the same in both cases; only the centre moves
  const mk = (tl, tr, bl, br) => ({ nx: 2, ny: 2, x0: 0, y0: 1, dx: 1, dy: 1, data: Float32Array.from([tl, tr, bl, br]), nodata: -9999 });
  const nearCorner = (ln, cx, cy) => ln.pts.every((p) => Math.hypot(p[0] - cx, p[1] - cy) < 0.71);
  // centre (10 + 0 + 0 + 10) / 4 = 5 ≥ 4: the LOW corners are cut off → lines hug TR (1, 1) and BL (0, 0)
  const hi = isolines(mk(10, 0, 0, 10), [4])[0].lines;
  assert.equal(hi.length, 2);
  assert.ok(hi.some((l) => nearCorner(l, 1, 1)) && hi.some((l) => nearCorner(l, 0, 0)), JSON.stringify(hi));
  // centre (5 − 10 − 10 + 5) / 4 = −2.5 < 4: the HIGH corners are cut off → lines hug TL (0, 1) and BR (1, 0)
  const lo = isolines(mk(5, -10, -10, 5), [4])[0].lines;
  assert.equal(lo.length, 2);
  assert.ok(lo.some((l) => nearCorner(l, 0, 1)) && lo.some((l) => nearCorner(l, 1, 0)), JSON.stringify(lo));
});

test('nodata stops a line; it never crosses the hole', () => {
  const g = grid(11, 5, (x) => x, { x0: 0, y0: 4 });
  g.data[2 * 11 + 5] = -9999;                                   // node (row 2, col 5)
  const L = isolines(g, [5.5])[0];
  // x = 5.5 runs down the middle; the four cells touching (2, 5) are skipped → the line breaks in two
  assert.equal(L.lines.length, 2);
  for (const ln of L.lines) for (const p of ln.pts) near(p[0], 5.5, 1e-9, 'x');
});

test('a PLACED grid: lines through its placement, ELEV through its z scale and shift', () => {
  const th = 30 * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const place = { R: [c, s, 0, -s, c, 0, 0, 0, 1], t: [600000, 7700000, 100], s: 2 };   // rotation about z, shift, scale
  const g = { ...grid(5, 5, (u) => u, { x0: 0, y0: 4 }), place };
  const L = isolines(g, [2])[0];
  assert.equal(L.lines.length, 1);
  for (const p of L.lines[0].pts) {
    // world = t + s · R · (u, v): every point on u = 2 → its projection on the grid's u axis is 2·s
    const du = (p[0] - 600000) * c + (p[1] - 7700000) * s;
    near(du / 2, 2, 1e-6, 'on u = 2 in the grid frame');
    near(p[2], 100 + 2 * 2, 1e-9, 'z = t_z + s · level');
  }
});

test('levels: base + k · interval across the range; a silly interval refused', () => {
  assert.deepEqual(contourLevels(497.3, 512.1, 2.5), [497.5, 500, 502.5, 505, 507.5, 510]);
  assert.deepEqual(contourLevels(0, 10, 5, 1), [1, 6]);
  assert.deepEqual(contourLevels(3, 2, 1), []);
  assert.throws(() => contourLevels(0, 1e6, 1), /bigger interval/);
});
