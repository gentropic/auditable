// @gcu/condenser grid/tiling.js — do sub-blocks tile their parents?
// A synthetic parent lattice split into sub-blocks (exact tiling), then each
// defect introduced on its own: a missing sub-block (a gap), a duplicate (an
// overlap), a block reaching into the next parent, a centroid off the lattice,
// an IJK that disagrees — plus the same model rotated (world positions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilingChecker } from '../ext/condenser/src/grid/tiling.js';
import { supportOf, datamineRotZ } from '../ext/condenser/src/grid/support.js';

// parents 4 × 4 × 2 m on a 3 × 2 × 2 parent grid, corner at (100, 200, 0); each parent split
// along X into a 1 m + a 3 m slab, the 3 m slab split along Y into 2 + 2; pitch 0.5 (half the GCD 1)
const PS = [4, 4, 2], NP = [3, 2, 2], O = [100, 200, 0];
function tiledBlocks() {
  const out = [];
  for (let i = 0; i < NP[0]; i++) for (let j = 0; j < NP[1]; j++) for (let k = 0; k < NP[2]; k++) {
    const c = [O[0] + i * PS[0], O[1] + j * PS[1], O[2] + k * PS[2]];
    const ijk = (i * NP[1] + j) * NP[2] + k;
    if (i === NP[0] - 1 && j === NP[1] - 1 && k === NP[2] - 1) { out.push({ lo: c, s: PS.slice(), ijk }); continue; }   // one parent left whole
    out.push({ lo: [c[0], c[1], c[2]], s: [1, 4, 2], ijk });
    out.push({ lo: [c[0] + 1, c[1], c[2]], s: [3, 2, 2], ijk });
    out.push({ lo: [c[0] + 1, c[1] + 2, c[2]], s: [3, 2, 2], ijk });
  }
  return out;
}
const pitch = [0.5, 0.5, 0.5];
// the fine lattice the readers would infer: origin = the smallest centroid per axis
function supFor(blocks, rot = null, anchor = [0, 0, 0]) {
  const mn = [0, 1, 2].map((a) => Math.min(...blocks.map((b) => b.lo[a] + b.s[a] / 2)));
  const mx = [0, 1, 2].map((a) => Math.max(...blocks.map((b) => b.lo[a] + b.s[a] / 2)));
  const ax = (a) => ({ origin: mn[a], pitch: pitch[a], count: Math.round((mx[a] - mn[a]) / pitch[a]) + 1 });
  return supportOf({ x: ax(0), y: ax(1), z: ax(2), ...(rot ? { rot, anchor } : {}) }, { subBlocked: true, sizeQMax: [8, 8, 4] });
}
function chunkOf(blocks, place = null) {
  const n = blocks.length, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), dimQ = new Uint8Array(3 * n), ijk = new Float64Array(n);
  blocks.forEach((b, i) => {
    let p = [b.lo[0] + b.s[0] / 2, b.lo[1] + b.s[1] / 2, b.lo[2] + b.s[2] / 2];
    if (place) p = place(p);
    x[i] = p[0]; y[i] = p[1]; z[i] = p[2];
    for (let a = 0; a < 3; a++) dimQ[3 * i + a] = Math.round(b.s[a] / pitch[a]);
    ijk[i] = b.ijk;
  });
  return { x, y, z, dimQ, ijk, count: n, base: 0 };
}
const check = (blocks, opts = {}, place = null, sup = supFor(blocks)) => {
  const t = tilingChecker(sup, { parentSize: [8, 8, 4], unit: [2, 2, 2], ...opts });
  t.add(chunkOf(blocks, place));
  return t.finish();
};

test('an exact tiling: no findings, every parent full, corner found from a whole-parent block or stated', () => {
  const B = tiledBlocks();
  for (const phase of [null, O]) {
    const r = check(B, { phase, ijk: phase ? { nx: 3, ny: 2, nz: 2 } : null });
    assert.equal(r.blocks, B.length);
    assert.equal(r.parents, 12);
    assert.equal(r.blocks, 3 * 11 + 1);
    assert.deepEqual([r.under, r.over, r.overlap, r.crossing, r.offGrid, r.offLattice, r.ijkBad, r.revisited], [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(r.parentSize, [4, 4, 2]);
    assert.equal(r.parentVolume, 32);
    assert.equal(r.phaseFrom, phase ? 'stated' : 'block');
  }
});

test('a missing sub-block is a gap: the parent under by exactly its volume', () => {
  const B = tiledBlocks(); B.splice(4, 1);                 // parent 1's 3×2×2 slab
  const r = check(B, { phase: O });
  assert.equal(r.under, 1); assert.equal(r.underVolume, 12); assert.equal(r.overlap, 0);
  assert.equal(r.underAt.length, 1);
  assert.deepEqual(r.underAt[0], [102, 202, 3]);           // the parent's centre (i 0, j 0, k 1)
});

test('a duplicated sub-block overlaps: the later one named, the parent over', () => {
  const B = tiledBlocks(); B.splice(7, 0, { ...B[6] });
  const r = check(B, { phase: O });
  assert.equal(r.overlap, 1); assert.deepEqual(r.overlapRecs, [7]);
  assert.equal(r.over, 1); assert.equal(r.overVolume, 8);
});

test('a partial overlap (a block shifted by 1 m) is caught on the fine lattice', () => {
  const B = tiledBlocks();
  B.splice(3, 0, { lo: [O[0] + 1, O[1] + 1, O[2]], s: [1, 2, 2], ijk: 0 });   // straddles the two 3×2 slabs' boundary
  const r = check(B, { phase: O });
  assert.equal(r.overlap, 1); assert.deepEqual(r.overlapRecs, [3]);
  assert.equal(r.over, 1); assert.equal(r.overVolume, 4);
});

test('a block reaching past its parent crosses it', () => {
  const B = tiledBlocks();
  B[0] = { ...B[0], lo: [O[0] + 3, O[1], O[2]], s: [2, 4, 2] };   // 103..105 crosses x = 104
  const r = check(B, { phase: O });
  assert.equal(r.crossing, 1); assert.deepEqual(r.crossingRecs, [0]);
});

test('a centroid between fine nodes and a size off the sub-lattice are named', () => {
  const B = tiledBlocks();
  const c = chunkOf(B);
  c.x[3] += 0.1;                                           // off the fine lattice
  c.dimQ[3 * 5] = 3;                                       // 1.5 m: an odd size can't tile a 1 m sub-lattice
  const t = tilingChecker(supFor(B), { parentSize: [8, 8, 4], unit: [2, 2, 2], phase: O });
  t.add(c);
  const r = t.finish();
  assert.equal(r.offGrid, 1); assert.deepEqual(r.offGridRecs, [3]);
  assert.equal(r.offLattice, 1); assert.deepEqual(r.offLatticeRecs, [5]);
});

test('an IJK that disagrees with the block position is named (Datamine order: K fastest)', () => {
  const B = tiledBlocks(); B[8] = { ...B[8], ijk: 99 };
  const r = check(B, { phase: O, ijk: { nx: 3, ny: 2, nz: 2 } });
  assert.equal(r.ijkBad, 1); assert.deepEqual(r.ijkRecs, [8]);
});

test('blocks of a parent coming back after it closed: counted as revisited', () => {
  const B = tiledBlocks();
  const moved = B.splice(0, 1);                            // parent 0's first block goes last
  B.push(...moved);
  const r = check(B, { phase: O, openBytes: 1 });          // the smallest FIFO (4 open parents)
  assert.equal(r.revisited, 1);
  assert.equal(r.under, 0);                                // volume is still summed whole
});

test('a rotated model (world positions) checks the same in its own frame', () => {
  const B = tiledBlocks();
  const Rm = datamineRotZ(-50), W0 = [432820, 8522360, 300];
  const place = (p) => [W0[0] + Rm[0] * p[0] + Rm[3] * p[1], W0[1] + Rm[1] * p[0] + Rm[4] * p[1], W0[2] + p[2]];
  const sup = supFor(B, Rm, W0);
  const r0 = check(B, { phase: O, ijk: { nx: 3, ny: 2, nz: 2 } }, place, sup);
  assert.deepEqual([r0.under, r0.over, r0.overlap, r0.crossing, r0.offGrid, r0.offLattice, r0.ijkBad], [0, 0, 0, 0, 0, 0, 0]);
  const B2 = tiledBlocks(); B2.splice(4, 1);
  const r1 = check(B2, { phase: O }, place, supFor(B2, Rm, W0));
  assert.equal(r1.under, 1);
  const w = r1.underAt[0], wantL = [102, 202, 3];
  const want = place(wantL);
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(w[a] - want[a]) < 1e-6);
});

test('a parent wider than one occupancy word (80 cells along X) is checked across words', () => {
  // one 40 × 2 × 2 m parent: 17 + 23 m along X (cells 0–33 and 34–79 at 0.5 m), then a 3 m block over the seam
  const B = [{ lo: [0, 0, 0], s: [17, 2, 2] }, { lo: [17, 0, 0], s: [23, 2, 2] }];
  const mk = (blocks) => {
    const n = blocks.length, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), dimQ = new Uint8Array(3 * n);
    blocks.forEach((b, i) => { x[i] = b.lo[0] + b.s[0] / 2; y[i] = b.lo[1] + b.s[1] / 2; z[i] = b.lo[2] + b.s[2] / 2; for (let a = 0; a < 3; a++) dimQ[3 * i + a] = Math.round(b.s[a] / 0.5); });
    return { x, y, z, dimQ, count: n };
  };
  const sup = supportOf({ x: { origin: 8.5, pitch: 0.5, count: 40 }, y: { origin: 1, pitch: 0.5, count: 1 }, z: { origin: 1, pitch: 0.5, count: 1 } }, { subBlocked: true, sizeQMax: [80, 4, 4] });
  for (const unit of [[1, 1, 1], [2, 2, 2]]) {
    const t = tilingChecker(sup, { parentSize: [80, 4, 4], unit, phase: [0, 0, 0] });
    t.add(mk(B));
    const r = t.finish();
    assert.deepEqual([r.under, r.over, r.overlap, r.crossing, r.offLattice], [0, 0, 0, 0, 0], `unit ${unit}`);
    const t2 = tilingChecker(sup, { parentSize: [80, 4, 4], unit, phase: [0, 0, 0] });
    t2.add(mk([...B, { lo: [15, 0, 0], s: [3, 2, 2] }]));
    const r2 = t2.finish();
    assert.equal(r2.overlap, 1, `unit ${unit}`);
    assert.equal(r2.over, 1);
  }
});
