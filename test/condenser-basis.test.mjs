// @gcu/condenser — rotated lattices (grid/basis.js): the representation, basis
// inference from centroids alone, the lattice fit over all records, the honest
// check for a declared lattice, and the block chunk's rotated IJK.
// Synthetic lattices with KNOWN U/V/W (incl. a tilted, non-Z-only basis), at
// UTM magnitudes, with centroids rounded the way exports round them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisFromVectors, basisAngles, inferLatticeBasis, fitLattice, latticeMisfit, toLattice, fromLattice, sameBasis, isAxisAligned, worldMapOf, inFrameOf } from '../ext/condenser/src/grid/basis.js';
import { makeBlockGrid, buildBlockChunk, blockLocalCenter } from '../ext/condenser/src/core/blocks.js';
import { mulberry32 } from '../ext/condenser/src/core/chunks.js';

const rad = (d) => d * Math.PI / 180;
// U/V/W for azimuth (rotation about Z, clockwise from north) then an optional tilt about U
function generators(az, tilt, pitch) {
  const a = rad(az), t = rad(tilt);
  const U0 = [Math.cos(a), -Math.sin(a), 0], V0 = [Math.sin(a), Math.cos(a), 0], W0 = [0, 0, 1];
  // tilt about U: V,W rotate in their plane
  const V = V0.map((v, i) => v * Math.cos(t) + W0[i] * Math.sin(t)), W = W0.map((w, i) => w * Math.cos(t) - V0[i] * Math.sin(t));
  return [U0.map((v) => v * pitch[0]), V.map((v) => v * pitch[1]), W.map((v) => v * pitch[2])];
}
function lattice(G, origin, counts, decimals = 3) {
  const pts = [], f = 10 ** decimals, r = (v) => Math.round(v * f) / f;
  for (let k = 0; k < counts[2]; k++) for (let j = 0; j < counts[1]; j++) for (let i = 0; i < counts[0]; i++) {
    pts.push(r(origin[0] + i * G[0][0] + j * G[1][0] + k * G[2][0]), r(origin[1] + i * G[0][1] + j * G[1][1] + k * G[2][1]), r(origin[2] + i * G[0][2] + j * G[1][2] + k * G[2][2]));
  }
  return Float64Array.from(pts);
}
const batchesOf = (pts) => () => (async function* () { const n = pts.length / 3, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n); for (let i = 0; i < n; i++) { x[i] = pts[i * 3]; y[i] = pts[i * 3 + 1]; z[i] = pts[i * 3 + 2]; } yield { x, y, z, count: n }; })();

test('basis: vectors → rotation, angles, refusals', () => {
  const G = generators(47, 0, [20, 20, 10]);
  const b = basisFromVectors(...G);
  assert.deepEqual(b.pitch.map((v) => +v.toFixed(9)), [20, 20, 10]);
  const ang = basisAngles(b.rot);
  assert.ok(Math.abs(ang.azimuth - 47) < 1e-9 && ang.zOnly);
  const q = toLattice(b.rot, 100, 200, 300), p = fromLattice(b.rot, ...q);
  assert.ok(Math.hypot(p[0] - 100, p[1] - 200, p[2] - 300) < 1e-9);
  assert.throws(() => basisFromVectors([10, 0, 0], [1, 10, 0], [0, 0, 5]), /not perpendicular/);
  assert.throws(() => basisFromVectors([0, 0, 0], [0, 10, 0], [0, 0, 5]), /non-zero/);
  assert.ok(sameBasis(null, [1, 0, 0, 0, 1, 0, 0, 0, 1]) && !sameBasis(null, b.rot) && isAxisAligned(null));
  const tilted = basisAngles(basisFromVectors(...generators(30, 12, [10, 10, 5])).rot);
  assert.ok(Math.abs(tilted.tilt - 12) < 1e-9 && !tilted.zOnly);
});

for (const [label, az, tilt] of [['Z-only (azimuth 47°)', 47, 0], ['tilted (azimuth 120°, tilt 15°)', 120, 15]]) {
  test(`basis: infer + fit a ${label} lattice from rounded UTM centroids`, async () => {
    const pitch = [20, 15, 10], counts = [12, 9, 6], origin = [612345.5, 7765432.25, 812.5];
    const G = generators(az, tilt, pitch);
    const pts = lattice(G, origin, counts);
    const inf = inferLatticeBasis(pts);
    assert.ok(inf, 'basis inferred');
    // the LABELLING is the inference's own (columns ordered/signed nearest E/N/Up),
    // so each inferred axis must be parallel to SOME true generator — and the
    // counts/pitches follow that pairing
    const truth = basisFromVectors(...G).rot;
    const col = (R, c) => [R[c * 3], R[c * 3 + 1], R[c * 3 + 2]];
    const pair = [0, 1, 2].map((c) => [0, 1, 2].find((t) => Math.abs(Math.abs(col(inf.rot, c).reduce((s, v, i) => s + v * col(truth, t)[i], 0)) - 1) < 1e-6));
    assert.deepEqual([...pair].sort(), [0, 1, 2], `inferred axes pair with the true ones (${pair})`);
    assert.ok(basisAngles(inf.rot).zOnly === (tilt === 0));
    assert.ok(Math.abs(inf.minStep - 10) < 0.01);
    const fit = await fitLattice(inf.rot, batchesOf(pts), { minStep: inf.minStep });
    assert.ok(fit, 'lattice fitted');
    const axes = fit.grid;
    assert.equal(fit.misfits, 0, `no record off the lattice (worst ${fit.worst})`);
    assert.deepEqual([axes.x.count, axes.y.count, axes.z.count], pair.map((t) => counts[t]));
    assert.deepEqual([axes.x.pitch, axes.y.pitch, axes.z.pitch].map((v) => +v.toFixed(3)), pair.map((t) => pitch[t]));
    for (let i = 0; i < 9; i++) assert.ok(Math.abs(Math.abs(axes.rot[i]) - Math.abs(truth[[0, 1, 2].map((c) => pair[c])[Math.floor(i / 3)] * 3 + (i % 3)])) < 1e-5, 'refined directions');
    // block 0's world centroid = R·origin_q — a corner of the lattice (which
    // corner depends on the labelling's signs), and a real record
    const toW = worldMapOf(axes), w0 = toW(axes.x.origin, axes.y.origin, axes.z.origin);
    let near = Infinity;
    for (let i = 0; i < pts.length / 3; i++) near = Math.min(near, Math.hypot(w0[0] - pts[i * 3], w0[1] - pts[i * 3 + 1], w0[2] - pts[i * 3 + 2]));
    assert.ok(near < 0.01, `block 0 is a record (${near})`);
    const wN = toW(axes.x.origin + (axes.x.count - 1) * axes.x.pitch, axes.y.origin + (axes.y.count - 1) * axes.y.pitch, axes.z.origin + (axes.z.count - 1) * axes.z.pitch);
    const diag = Math.hypot(...[0, 1, 2].map((a) => wN[a] - w0[a]));
    assert.ok(Math.abs(diag - Math.hypot(...pitch.map((p, a) => p * (counts[a] - 1)))) < 0.01, 'the far corner is the lattice diagonal away');
    // every record on it; a displaced record is named
    for (let i = 0; i < pts.length / 3; i += 37) assert.equal(latticeMisfit(axes, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], i, { tol: 0.01 }), null);
    assert.match(latticeMisfit(axes, pts[0] + 4, pts[1], pts[2], 0), /off the lattice/);
    // a second model on the SAME lattice, shifted by whole blocks, lines up about one anchor
    const G2 = pts.slice(3 * 7), inf2 = inferLatticeBasis(G2), fit2 = await fitLattice(inf2.rot, batchesOf(G2), { minStep: inf2.minStep });
    assert.ok(sameBasis(fit2.grid.rot, axes.rot, 1e-5), 'same basis re-inferred');
    const re = inFrameOf({ ...fit2.grid, rot: axes.rot }, axes);
    for (const k of ['x', 'y', 'z']) { const off = re[k].origin / axes[k].pitch; assert.ok(Math.abs(off - Math.round(off)) < 1e-3, `${k} on-phase (${off})`); }
  });
}

test('basis: an axis-aligned or irregular cloud is not called rotated', () => {
  assert.equal(inferLatticeBasis(lattice([[10, 0, 0], [0, 10, 0], [0, 0, 5]], [5, 5, 2.5], [6, 6, 3])), null);
  const rnd = mulberry32(3), pts = new Float64Array(3 * 500);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd() * 1000;
  assert.equal(inferLatticeBasis(pts), null);
});

test('basis: a rotated block chunk — exact IJK in the lattice frame, world centers and an AABB that holds them', async () => {
  const G = generators(33, 0, [10, 10, 5]), origin = [1000, 2000, 300];
  const pts = lattice(G, origin, [5, 4, 3], 6);
  const inf = inferLatticeBasis(pts);
  const axes = (await fitLattice(inf.rot, batchesOf(pts), { minStep: inf.minStep })).grid;
  const frame = { origin: [1000, 2000, 300] };
  const grid = makeBlockGrid([axes.x, axes.y, axes.z], frame, axes.rot, axes.anchor);
  const n = pts.length / 3, cols = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), chan: new Float64Array(n), cat: null, recIdx: new Uint32Array(n) };
  for (let i = 0; i < n; i++) { cols.x[i] = pts[i * 3]; cols.y[i] = pts[i * 3 + 1]; cols.z[i] = pts[i * 3 + 2]; cols.recIdx[i] = i; }
  const chunk = buildBlockChunk(cols, grid, frame, mulberry32(1));
  for (let k = 0; k < chunk.count; k++) {
    const r = chunk.recIdx[k], c = blockLocalCenter(chunk, k);
    assert.ok(Math.hypot(c[0] + 1000 - pts[r * 3], c[1] + 2000 - pts[r * 3 + 1], c[2] + 300 - pts[r * 3 + 2]) < 1e-4, `record ${r} centre`);
    for (let a = 0; a < 3; a++) assert.ok(c[a] >= chunk.bboxLocal[a] && c[a] <= chunk.bboxLocal[a + 3]);
  }
  assert.ok(grid.rot instanceof Float32Array && grid.rotD.length === 9);
  assert.equal(makeBlockGrid([axes.x, axes.y, axes.z], frame, [1, 0, 0, 0, 1, 0, 0, 0, 1]).rot, undefined);   // identity = axis-aligned
});

test('basis: the join engine — same basis compatible about one anchor, different orientations refused with a reason', async () => {
  const { gridsCompatible, makeResampler, commonLattice } = await import('../ext/condenser/src/grid/grid-join.js');
  const R = basisFromVectors(...generators(30, 0, [10, 10, 5])).rot;
  // two models on ONE rotated lattice: B's block 0 sits 3 U-blocks + 2 V-blocks from A's
  const A = { x: { origin: 0, pitch: 10, count: 20 }, y: { origin: 0, pitch: 10, count: 20 }, z: { origin: 0, pitch: 5, count: 4 }, rot: R, anchor: [612000, 7765000, 800] };
  const off = fromLattice(R, 30, 20, 0);
  const B = { x: { origin: 0, pitch: 10, count: 8 }, y: { origin: 0, pitch: 10, count: 8 }, z: { origin: 0, pitch: 5, count: 4 }, rot: R, anchor: [612000 + off[0], 7765000 + off[1], 800 + off[2]] };
  assert.equal(gridsCompatible(A, B).ok, true);
  assert.equal(makeResampler(B, A).ok, true);
  const cl = commonLattice([A, B]);
  assert.ok(cl.ok && cl.rot === R && cl.anchor === A.anchor && cl.x.count === 20);
  // half a block off-phase along U → incompatible, axis-wise reason
  const offH = fromLattice(R, 35, 20, 0);
  const Bh = { ...B, anchor: [612000 + offH[0], 7765000 + offH[1], 800 + offH[2]] };
  assert.equal(gridsCompatible(A, Bh).ok, false);
  // a different orientation, or rotated vs axis-aligned → refused, saying why
  const R2 = basisFromVectors(...generators(31, 0, [10, 10, 5])).rot;
  const c2 = gridsCompatible(A, { ...B, rot: R2 });
  assert.ok(!c2.ok && /different lattice orientations/.test(c2.reason));
  const AA = { x: { origin: 5, pitch: 10, count: 4 }, y: { origin: 5, pitch: 10, count: 4 }, z: { origin: 2.5, pitch: 5, count: 4 } };
  assert.match(gridsCompatible(A, AA).reason, /axis-aligned/);
  assert.equal(makeResampler(AA, A).ok, false);
  assert.equal(commonLattice([A, AA]).ok, false);
});

test('basis: a producer basis ↔ the internal grid round-trips; axis-aligned stays per-axis', async () => {
  const { gridFromBasis, basisOfGrid } = await import('../ext/condenser/src/grid/basis.js');
  const G = generators(47, 10, [20, 15, 10]);
  const g = gridFromBasis({ origin: [612345.5, 7765432.25, 812.5], U: G[0], V: G[1], W: G[2], counts: [12, 9, 6], source: { convention: 'test', angles: [47, 10, 0] } });
  assert.ok(g.rot && g.anchor[0] === 612345.5 && Math.abs(g.x.pitch - 20) < 1e-9 && g.source.convention === 'test');
  const b = basisOfGrid(g);
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(b.origin[a] - [612345.5, 7765432.25, 812.5][a]) < 1e-9);
  for (const [k, v] of [['U', 0], ['V', 1], ['W', 2]]) for (let a = 0; a < 3; a++) assert.ok(Math.abs(b[k][a] - G[v][a]) < 1e-9);
  const aa = gridFromBasis({ origin: [5, 5, 2.5], U: [10, 0, 0], V: [0, 10, 0], W: [0, 0, 5], counts: [4, 4, 2] });
  assert.ok(!aa.rot && aa.x.origin === 5 && aa.z.pitch === 5);
  assert.throws(() => gridFromBasis({ origin: [0, 0, 0], U: [10, 0, 0], V: [3, 10, 0], W: [0, 0, 5], counts: [2, 2, 2] }), /not perpendicular/);
});
