// micro PLACEMENTS — the pure core (tools/micro/src/placement-core.js) and the rotated-grid
// sampler (grid-ops.js). Every check is against a constructed truth, never against itself:
//   · Horn / Umeyama recovers a KNOWN 7-parameter similarity exactly from noiseless pairs
//     (3D and 2D), the residuals come out ≈ the noise when there is noise, and a blunder
//     shows as the biggest residual and dropping it restores the exact fit
//   · a block lattice under a placement: every block centre lands where the placement takes it
//   · a CRS-change fit (true reprojection by @gcu/proj, sampled over the extent) reports its
//     max deviation, and the report agrees with an independent dense check
//   · a rotated grid samples the same surface as its unrotated twin, rotated
//   · GeoTIFF/world-file affines round-trip through the grid frame
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePlacement, applyP, invertP, composeP, rotFromAngles, anglesFromR, fitSimilarity, placeGrid, placeBbox,
  crsSamplePoints, fitCrsChange, deviations, placementFromFit, residualClass, affineToGridPlace, parseWorldFile, worldFileText, gridAffine, zOnlyP,
} from '../tools/micro/src/placement-core.js';
import { surfaceFromGrid, gridWorldBbox4, resampleAxisAligned } from '../tools/micro/src/grid-ops.js';
import { lookupEpsg, transformPoints } from '../ext/proj/index.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (±${tol})`);
// a deterministic generator
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = (r) => () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

const TRUTH = { tx: 512340.25, ty: 7712890.5, tz: 812.3, omega: 0.8, phi: -1.3, kappa: 37.25, scale: 1.000412 };
const local = [[0, 0, 0], [1200, 80, 15], [300, 950, -40], [1100, 1000, 60], [650, 420, 210], [80, 700, 130]];

test('rotations: ω-φ-κ ↔ R round trip; κ is counter-clockwise from above', () => {
  const R = rotFromAngles(12, -7, 123);
  const a = anglesFromR(R);
  near(a.omega, 12, 1e-9, 'ω'); near(a.phi, -7, 1e-9, 'φ'); near(a.kappa, 123, 1e-9, 'κ');
  const M = compilePlacement({ kappa: 90 });
  const p = applyP(M, 1, 0, 0);
  near(p[0], 0, 1e-12, 'x'); near(p[1], 1, 1e-12, 'κ 90° takes +X to +Y');
});

test('compose / invert / pivot', () => {
  const A = compilePlacement(TRUTH), B = compilePlacement({ tx: -3, kappa: 4, scale: 0.9, pivot: [100, 200, 0] });
  const q = applyP(composeP(A, B), 10, 20, 30), r = applyP(A, ...applyP(B, 10, 20, 30));
  for (let k = 0; k < 3; k++) near(q[k], r[k], 1e-7, 'A∘B');
  const back = applyP(invertP(A), ...applyP(A, 10, 20, 30));
  [10, 20, 30].forEach((v, k) => near(back[k], v, 1e-7, 'A⁻¹A'));
  // a pivot: rotating about it leaves it fixed
  const P = compilePlacement({ kappa: 33, scale: 2, pivot: [1000, 2000, 50] }), f = applyP(P, 1000, 2000, 50);
  near(f[0], 1000, 1e-9, 'pivot x'); near(f[1], 2000, 1e-9, 'pivot y'); near(f[2], 50, 1e-9, 'pivot z');
  assert.equal(compilePlacement({ tx: 0, scale: 1 }), null, 'the identity compiles to null');
});

test('Umeyama (Horn): a known 3D similarity recovered EXACTLY from noiseless pairs', () => {
  const M = compilePlacement(TRUTH);
  const pairs = local.map((a) => ({ from: a, to: applyP(M, ...a) }));
  const f = fitSimilarity(pairs);
  assert.equal(f.mode, '3d');
  near(f.s, TRUTH.scale, 1e-12, 'scale');
  for (let i = 0; i < 9; i++) near(f.R[i], M.R[i], 1e-12, `R[${i}]`);
  for (let k = 0; k < 3; k++) near(f.t[k], M.t[k], 1e-6, `t[${k}]`);
  assert.ok(f.max < 1e-6, `residuals ≈ 0 (max ${f.max})`);
  const a = anglesFromR(f.R);
  near(a.kappa, TRUTH.kappa, 1e-9, 'κ back'); near(a.omega, TRUTH.omega, 1e-9, 'ω back'); near(a.phi, TRUTH.phi, 1e-9, 'φ back');
});

test('2D: two pairs fix shift + rotation about Z + scale exactly', () => {
  const M = compilePlacement({ tx: 1e5, ty: 2e5, kappa: -21.5, scale: 0.3048 });   // a mine grid in feet → metres
  const pairs = [[1000, 2000, 0], [5000, 2600, 0]].map((a) => ({ from: a, to: applyP(M, ...a) }));
  const f = fitSimilarity(pairs);
  assert.equal(f.mode, '2d');
  near(f.s, 0.3048, 1e-12, 'scale'); near(anglesFromR(f.R).kappa, -21.5, 1e-9, 'κ');
  const q = applyP(f, 3000, 4000, 0), r = applyP(M, 3000, 4000, 0);
  near(q[0], r[0], 1e-6, 'a third point x'); near(q[1], r[1], 1e-6, 'a third point y');
});

test('with noise the residuals are the noise; a blunder stands out and dropping it restores the fit', () => {
  const M = compilePlacement(TRUTH), g = gauss(rng(7)), sigma = 0.01;
  const many = [];
  for (let i = 0; i < 40; i++) { const r = rng(100 + i); many.push([r() * 2000, r() * 2000, r() * 300]); }
  const noisy = many.map((a) => { const b = applyP(M, ...a); return { from: a, to: [b[0] + sigma * g(), b[1] + sigma * g(), b[2] + sigma * g()] }; });
  const f = fitSimilarity(noisy);
  const perAxis = f.rms / Math.sqrt(3);
  assert.ok(perAxis > 0.6 * sigma && perAxis < 1.3 * sigma, `rms per axis ${perAxis.toFixed(4)} ≈ σ ${sigma}`);
  const c = applyP(f, 1000, 1000, 150), ct = applyP(M, 1000, 1000, 150);
  assert.ok(Math.hypot(c[0] - ct[0], c[1] - ct[1], c[2] - ct[2]) < 3 * sigma, 'the fitted transform is within the noise at the centre');
  // four exact pairs and one off by a metre
  const four = local.slice(1, 5).map((a) => ({ from: a, to: applyP(M, ...a) }));
  const bad = { from: [500, 500, 50], to: applyP(M, 500, 500, 50).map((v, k) => v + (k === 0 ? 1 : 0)) };
  const fb = fitSimilarity([...four, bad]);
  const worst = fb.residuals.reduce((m, r, i) => (r.d > fb.residuals[m].d ? i : m), 0);
  assert.equal(worst, 4, 'the blunder has the biggest residual');
  assert.ok(fb.residuals[4].d > 0.5, `and it is big (${fb.residuals[4].d.toFixed(3)} m)`);
  const fd = fitSimilarity([...four, { ...bad, use: false }]);
  assert.ok(fd.max < 1e-6, `dropped: the fit is exact again (max ${fd.max})`);
  assert.ok(Math.abs(fd.residuals[4].d - 1) < 1e-6, 'a dropped point still reports how far off it is (1 m)');
  assert.equal(residualClass(0.004, 0.01), 'ok'); assert.equal(residualClass(0.02, 0.01), 'warn'); assert.equal(residualClass(1, 0.01), 'bad');
  const stored = placementFromFit(fd, 'gcp', { used: 4 });
  assert.equal(stored.source, 'gcp'); assert.ok(stored.R && stored.maxResidual < 1e-6);
  const rt = compilePlacement(stored), q = applyP(rt, 10, 20, 30), r2 = applyP(fd, 10, 20, 30);
  for (let k = 0; k < 3; k++) near(q[k], r2[k], 1e-6, 'the stored form compiles back to the fit');
});

test('a block lattice under a placement: boxes stay boxes, every centre lands on the placed point', () => {
  const g = { x: { origin: 105, pitch: 10, count: 20 }, y: { origin: 205, pitch: 10, count: 15 }, z: { origin: 2.5, pitch: 5, count: 8 } };
  for (const P of [compilePlacement(TRUTH), compilePlacement({ tx: 1000, ty: -50, tz: 3, scale: 2 })]) {
    const pg = placeGrid(P, g);
    const R = pg.rot || [1, 0, 0, 0, 1, 0, 0, 0, 1], A = pg.rot ? pg.anchor : [0, 0, 0];
    for (const [i, j, k] of [[0, 0, 0], [19, 14, 7], [7, 3, 5]]) {
      const q = [pg.x.origin + i * pg.x.pitch, pg.y.origin + j * pg.y.pitch, pg.z.origin + k * pg.z.pitch];
      const w = [A[0] + R[0] * q[0] + R[3] * q[1] + R[6] * q[2], A[1] + R[1] * q[0] + R[4] * q[1] + R[7] * q[2], A[2] + R[2] * q[0] + R[5] * q[1] + R[8] * q[2]];
      const e = applyP(P, g.x.origin + i * 10, g.y.origin + j * 10, g.z.origin + k * 5);
      for (let a = 0; a < 3; a++) near(w[a], e[a], 1e-6, `block (${i},${j},${k}) axis ${a}`);
    }
    near(pg.x.pitch, 10 * P.s, 1e-12, 'pitch scales');
    if (P.R[0] === 1 && P.R[4] === 1) assert.ok(!pg.rot, 'a rotation-free placement keeps an axis-aligned grid axis-aligned');
  }
  const bb = placeBbox(compilePlacement({ kappa: 90 }), { min: [0, 0, 0], max: [10, 20, 5] });
  near(bb.min[0], -20, 1e-9, 'bbox x'); near(bb.max[1], 10, 1e-9, 'bbox y');
});

test('CRS change: a best-fit similarity reports its max deviation, and a dense independent check agrees', async () => {
  const z23 = await lookupEpsg(31983), z24 = await lookupEpsg(31984), sad = await lookupEpsg(29193);
  // a 5 km block of SIRGAS 2000 / UTM 23S near the 23/24 zone boundary (≈ 42°W), 400 m of relief
  const box = (w) => ({ min: [770000, 7800000, 600], max: [770000 + w, 7800000 + w, 1000] });
  const run = (from, to, bb) => {
    const src = crsSamplePoints(bb, 9), dst = transformPoints(from, to, src);
    const fit = fitCrsChange(src, dst);
    // the independent check: 33 × 33 points the fit never saw, at the floor and the roof
    const dense = crsSamplePoints(bb, 33), truth = transformPoints(from, to, dense);
    return { fit, check: deviations(fit.M, dense, truth) };
  };
  const zone5 = run(z23, z24, box(5000)), zone1 = run(z23, z24, box(1000));
  const datum5 = run(sad, z23, box(5000));
  console.log(`  UTM 23S → 24S over 5 km: plan ${(zone5.fit.hMax * 1000).toFixed(1)} mm (dense ${(zone5.check.hMax * 1000).toFixed(1)} mm), heights ${(zone5.fit.vMax * 1000).toFixed(1)} mm (scale ${zone5.fit.M.s.toFixed(7)})`);
  console.log(`  UTM 23S → 24S over 1 km: plan ${(zone1.fit.hMax * 1000).toFixed(2)} mm (dense ${(zone1.check.hMax * 1000).toFixed(2)} mm)`);
  console.log(`  SAD69 → SIRGAS 2000 (same zone) over 5 km: plan ${(datum5.fit.hMax * 1000).toFixed(2)} mm, heights ${(datum5.fit.vMax * 1000).toFixed(2)} mm`);
  // the reported deviation is what a denser check finds (within 25 %: the 9×9 samples include the corners, where it peaks)
  for (const r of [zone5, zone1, datum5]) assert.ok(r.check.hMax <= r.fit.hMax * 1.25 + 1e-4 && r.check.hMax >= r.fit.hMax * 0.75 - 1e-4, `reported ${r.fit.hMax} vs dense ${r.check.hMax}`);
  assert.ok(zone1.fit.hMax < 0.005, 'a zone change over 1 km: millimetres in plan');
  assert.ok(zone5.fit.hMax > 0.01 && zone5.fit.hMax < 0.15, 'over 5 km near the zone edge: CENTIMETRES in plan (a TM→TM map bends) — and reported, not hidden');
  assert.ok(datum5.fit.hMax < 0.005, 'a datum shift in one zone over 5 km: millimetres');
  assert.ok(zone5.fit.vMax > zone5.fit.hMax || zone5.fit.vMax >= 0, 'the uniform scale on heights is reported (vMax)');
});

test('a rotated grid samples the same surface as its unrotated twin, rotated', () => {
  const nx = 61, ny = 41, dx = 5, dy = 5, x0 = 2.5, y0 = -2.5;      // the grid's own frame (a GeoTIFF corner at 0, 0)
  const f = (u, v) => 100 + 0.02 * u - 0.03 * v + 4 * Math.sin(u / 37) * Math.cos(v / 23);
  const data = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) data[r * nx + c] = f(x0 + c * dx, y0 - r * dy);
  const twin = { nx, ny, x0, y0, dx, dy, data, nodata: -9999 };
  const place = compilePlacement({ tx: 600123.4, ty: 7700456.7, tz: 0, kappa: 28.5 });
  assert.ok(zOnlyP(place));
  const rotated = { ...twin, place };
  const sU = surfaceFromGrid(twin), sR = surfaceFromGrid(rotated);
  const r = rng(3);
  let worst = 0, tried = 0;
  for (let k = 0; k < 400; k++) {
    const u = x0 + r() * (nx - 1) * dx, v = y0 - r() * (ny - 1) * dy;
    const w = applyP(place, u, v, 0);
    const a = sU.sampleZ(u, v), b = sR.sampleZ(w[0], w[1]);
    worst = Math.max(worst, Math.abs(a - b)); tried++;
  }
  assert.ok(worst < 1e-6, `sampled through its placement = the twin at the local point (worst ${worst})`);
  assert.ok(Number.isNaN(sR.sampleZ(place.t[0] - 50, place.t[1] - 50)), 'off the rotated grid → NaN');
  // a scaled + shifted surface: z = t_z + s·value
  const P2 = compilePlacement({ tx: 10, ty: 20, tz: 5, kappa: -12, scale: 1.5 }), s2 = surfaceFromGrid({ ...twin, place: P2 });
  const w2 = applyP(P2, 100, -60, 0);
  near(s2.sampleZ(w2[0], w2[1]), 5 + 1.5 * sU.sampleZ(100, -60), 1e-6, 'scaled heights');
  // the world bbox and an axis-aligned resample (for formats that can't say a rotation)
  const bb = gridWorldBbox4(rotated);
  assert.ok(bb[2] - bb[0] > (nx - 1) * dx, 'a rotated grid\'s world box is wider than its own');
  const aa = resampleAxisAligned(rotated), sA = surfaceFromGrid(aa);
  const mid = applyP(place, x0 + 30 * dx, y0 - 20 * dy, 0);
  near(sA.sampleZ(mid[0], mid[1]), sU.sampleZ(x0 + 30 * dx, y0 - 20 * dy), 0.05, 'the resample keeps the surface (bilinear twice)');
  // a tilted grid is a sheet, refused as a surface — with the reason
  assert.throws(() => surfaceFromGrid({ ...twin, place: compilePlacement({ omega: 5 }) }), /tilted/);
});

test('rasters: a GeoTIFF / world-file affine ↔ the grid frame', () => {
  const th = 23 * Math.PI / 180, dx = 2, dy = 2, c = 500000, f = 7000000;
  const aff = [dx * Math.cos(th), dy * Math.sin(th), c, dx * Math.sin(th), -dy * Math.cos(th), f];
  const g = affineToGridPlace(aff, 100, 80);
  near(g.theta, 23, 1e-9, 'θ'); near(g.dx, 2, 1e-12, 'dx'); near(g.dy, 2, 1e-12, 'dy'); near(g.shear, 0, 1e-9, 'no shear'); assert.ok(g.dev < 1e-6);
  const grid = { nx: 100, ny: 80, x0: dx / 2, y0: -dy / 2, dx, dy, place: compilePlacement({ tx: c, ty: f, kappa: g.theta }) };
  gridAffine(grid).forEach((v, i) => near(v, aff[i], 1e-6, `affine[${i}]`));
  const wf = parseWorldFile(worldFileText(grid));
  wf.forEach((v, i) => near(v, aff[i], 1e-6, `world file round trip [${i}]`));
  // an unrotated world file: the pixel centre convention
  const plain = parseWorldFile('10\n0\n0\n-10\n1005\n2995\n');
  assert.deepEqual(plain, [10, 0, 1000, 0, -10, 3000]);
  // a sheared raster: the nearest rotation, and how far it departs, stated
  const sh = affineToGridPlace([2, 0.05, 0, 0, -2, 0], 100, 100);
  assert.ok(sh.shear !== 0 && sh.dev > 0.1, `shear ${sh.shear.toFixed(3)}° departs ${sh.dev.toFixed(3)} m`);
});
