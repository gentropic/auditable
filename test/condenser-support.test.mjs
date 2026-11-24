// @gcu/condenser — the block-support contract (grid/support.js) + the readers that
// fill it: sizes in fine steps (dimQ), the fine pitch, the >255-step refusal, and the
// Datamine single-Z rotation, checked against a hand computation of world bounds —
// the same check that matched a real Isatis.neo export to 1 cm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  supportOf, supportOfHeader, volumeOf, supportToLattice, supportToWorld, worldHalfExtent, centreOf, sameLattice,
  sizeCollector, finePitch, sizeQ, putDimQ, datamineRotZ, SIZEQ_MAX,
  openDmModel, openBlockModel, documentFrame, makeBlockGrid, createBlockChunkBuilder, blockLocalCenter, dimQFromCodes,
} from '../ext/condenser/src/main.js';
import * as core from '../ext/condenser/src/core.js';
import { makeSubblockRows, makeSubblockDm, makeSubblockCsv, worldCentroidBounds } from './subblock-make.mjs';

const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('support: exported from both condenser bundles', () => {
  for (const k of ['supportOf', 'volumeOf', 'sizeCollector', 'finePitch', 'putDimQ', 'datamineRotZ', 'sameLattice']) assert.equal(typeof core[k], 'function', `core.js ${k}`);
});

test('support: a regular grid — identity frame, constant size, 0 bytes per block', () => {
  const g = { x: { origin: 5, pitch: 10, count: 4 }, y: { origin: 5, pitch: 10, count: 3 }, z: { origin: 2.5, pitch: 5, count: 2 } };
  const s = supportOf(g);
  assert.deepEqual(s.frame.R, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(s.sizeQ, [1, 1, 1]);
  assert.equal(s.sub, false);
  assert.equal(volumeOf(1, 1, 1, s.lattice.pitch), 500);
  assert.deepEqual(centreOf(s, 3, 2, 1), [35, 25, 7.5]);
  assert.equal(supportOfHeader(null), null);
});

test('support: rotated frame — toLattice ∘ toWorld is the identity; |R|·h holds the box', () => {
  const R = datamineRotZ(-50);
  const g = { x: { origin: 10, pitch: 1, count: 9 }, y: { origin: 0.5, pitch: 1, count: 9 }, z: { origin: 0.5, pitch: 1, count: 9 }, rot: R, anchor: [432820, 8522360, 300] };
  const s = supportOf(g, { subBlocked: true, sizeQMax: [40, 40, 20] });
  const w = supportToWorld(s.frame, 3, 4, 5), q = supportToLattice(s.frame, w[0], w[1], w[2]);
  for (let a = 0; a < 3; a++) near(q[a], [3, 4, 5][a], 1e-8, 'round trip');
  // the model X axis at N40°E: ANGLE1 = −50 turns the axes clockwise seen from above
  const ux = supportToWorld({ R, anchor: [0, 0, 0] }, 1, 0, 0);
  near((Math.atan2(ux[0], ux[1]) * 180) / Math.PI, 40, 1e-9, 'azimuth of model X');
  const h = worldHalfExtent(R, 1, 2, 3);
  near(h[0], Math.abs(R[0]) + 2 * Math.abs(R[3]), 1e-12, 'hx');
  near(h[2], 3, 1e-12, 'hz');
});

test('support: sameLattice — orientation, pitch and node phase', () => {
  const g = { x: { origin: 0.5, pitch: 1, count: 4 }, y: { origin: 0.5, pitch: 1, count: 4 }, z: { origin: 0.5, pitch: 1, count: 4 } };
  const a = supportOf(g);
  assert.ok(sameLattice(a, supportOf({ ...g, x: { origin: 7.5, pitch: 1, count: 2 } })), 'shifted by whole steps');
  assert.ok(!sameLattice(a, supportOf({ ...g, x: { origin: 7.25, pitch: 1, count: 2 } })), 'off-phase');
  assert.ok(!sameLattice(a, supportOf({ ...g, rot: datamineRotZ(30), anchor: [0, 0, 0] })), 'another orientation');
});

test('support: sizes → fine pitch (half the step, odd sizes on-lattice) and dimQ round-trip', () => {
  const c = sizeCollector();
  for (const [dx, dy, dz] of [[20, 20, 10], [3, 7, 1], [1, 20, 5], [13, 1, 10], [20, 3, 2]]) c.add(dx, dy, dz);
  c.add(0, 1, 1); c.add(NaN, 1, 1);                         // ignored
  assert.equal(c.count, 5); assert.equal(c.shapes, 5); assert.ok(c.varies);
  const fp = finePitch(c);
  assert.deepEqual(fp.pitch, [0.5, 0.5, 0.5]);
  assert.deepEqual(fp.sizeQMax, [40, 40, 20]);
  const out = new Uint8Array(6);
  putDimQ(out, 0, 3, 7, 1, fp.pitch); putDimQ(out, 1, 20, 20, 10, fp.pitch);
  assert.deepEqual([...out], [6, 14, 2, 40, 40, 20]);
  for (let s = 1; s <= 20; s++) assert.equal(sizeQ(s, 0.5) * 0.5, s, `size ${s} round-trips`);
  // sizes that aren't multiples of the smallest: the GCD, not the minimum
  const g = sizeCollector(); g.add(3, 3, 3); g.add(4, 4, 4);
  assert.deepEqual(finePitch(g).pitch, [0.5, 0.5, 0.5]);
  // a snapshot merges back to the same answer (a parallel discovery)
  const m = sizeCollector(); m.merge(c.toJSON());
  assert.equal(m.count, 5); assert.equal(m.shapes, 5); assert.deepEqual(finePitch(m), fp);
});

test('support: a block past 255 fine steps is refused with a message', () => {
  const c = sizeCollector(); c.add(1, 1, 1); c.add(200, 1, 1);
  const fp = finePitch(c);
  assert.ok(fp.refused && /255/.test(fp.refused) && /X/.test(fp.refused), fp.refused);
  assert.equal(SIZEQ_MAX, 255);
});

test('support: legacy size codes + palette → dimQ (the widget wire)', () => {
  const grid = { size: [2.5, 2.5, 1.25] };
  assert.deepEqual([...dimQFromCodes(Uint8Array.of(1, 0), [[5, 5, 2.5], [2.5, 2.5, 1.25]], grid)], [2, 2, 2, 4, 4, 4]);
});

// ── the synthetic look-alike: rotated, sub-blocked, > 256 shapes ──────────────
const ROWS = makeSubblockRows({ seed: 11 });
const O = [432820, 8522360, 300];

test('fixture: the look-alike has > 256 distinct shapes and odd sizes', () => {
  assert.ok(ROWS.shapes > 256, `${ROWS.shapes} shapes`);
  assert.ok(ROWS.rows.some((r) => r.XINC % 2 === 1), 'odd sizes');
});

async function chunksOf(header, streamChunks) {
  const frame = documentFrame(header);
  const grid = makeBlockGrid([header.grid.x, header.grid.y, header.grid.z], frame, header.grid.rot || null, header.grid.anchor || null);
  const chunks = [];
  const cb = createBlockChunkBuilder({ frame, grid, chunkSize: 4096, seed: 1, onChunk: (c) => chunks.push(c) });
  for await (const rc of streamChunks({ chunkPoints: 5000 })) cb.push(rc);
  cb.flush();
  return { frame, grid, chunks };
}

test('dm: the rotation (ANGLE1 about Z) applied — world centroid bounds equal the hand computation', async () => {
  const blob = new Blob([makeSubblockDm(ROWS.rows, { angle1: -50, origin: O })]);
  const { header, streamChunks } = await openDmModel(blob);
  assert.equal(header.dmRotationApplied, true);
  assert.deepEqual(header.dmOrigin, O, 'origin from X0/Y0/Z0');
  assert.ok(header.subBlocked && header.grid && header.grid.rot, 'rotated, sub-blocked boxes (not points)');
  assert.deepEqual([header.grid.x.pitch, header.grid.y.pitch, header.grid.z.pitch], [0.5, 0.5, 0.5]);
  assert.ok(header.sizeShapes > 256, `${header.sizeShapes} shapes`);
  const want = worldCentroidBounds(ROWS.rows, { angle1: -50, origin: O });
  for (let a = 0; a < 3; a++) { near(header.bbox.min[a], want.min[a], 1e-6, `bbox min ${a}`); near(header.bbox.max[a], want.max[a], 1e-6, `bbox max ${a}`); }
  // every block: its chunk centroid (lattice IJK through R) is its rotated source centroid, its dimQ its sizes
  const { frame, grid, chunks } = await chunksOf(header, streamChunks);
  const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  let n = 0;
  for (const ch of chunks) for (let k = 0; k < ch.count; k++) {
    const r = ROWS.rows[ch.recIdx[k]], p = blockLocalCenter(ch, k);
    near(p[0] + frame.origin[0], O[0] + c * r.XC - s * r.YC, 1e-6, 'x'); near(p[1] + frame.origin[1], O[1] + s * r.XC + c * r.YC, 1e-6, 'y'); near(p[2] + frame.origin[2], O[2] + r.ZC, 1e-9, 'z');
    assert.deepEqual([ch.dimQ[3 * k], ch.dimQ[3 * k + 1], ch.dimQ[3 * k + 2]], [r.XINC * 2, r.YINC * 2, r.ZINC * 2]);
    n++;
  }
  assert.equal(n, ROWS.rows.length);
  void grid;
});

test('dm: an origin given by the caller wins over the file (an anonymised export carries 0)', async () => {
  const blob = new Blob([makeSubblockDm(ROWS.rows, { angle1: -50, origin: [0, 0, 0] })]);
  const zero = await openDmModel(blob);
  assert.deepEqual(zero.header.dmOrigin, [0, 0, 0]);
  const set = await openDmModel(blob, { origin: O });
  const want = worldCentroidBounds(ROWS.rows, { angle1: -50, origin: O });
  for (let a = 0; a < 3; a++) near(set.header.bbox.min[a], want.min[a], 1e-6, `min ${a}`);
  // a cache written for the other origin is not trusted
  const again = await openDmModel(blob, { origin: O, cached: { bbox: zero.header.bbox, grid: zero.header.grid, subBlocked: true } });
  near(again.header.bbox.min[0], want.min[0], 1e-6, 'stale cache ignored');
});

test('csv: the axis-aligned twin — same fine lattice, same dimQ', async () => {
  const { header, streamChunks } = await openBlockModel(new Blob([makeSubblockCsv(ROWS.rows)]));
  assert.ok(header.subBlocked && header.grid && !header.grid.rot);
  assert.deepEqual([header.grid.x.pitch, header.grid.y.pitch, header.grid.z.pitch], [0.5, 0.5, 0.5]);
  const { frame, chunks } = await chunksOf(header, streamChunks);
  let n = 0;
  for (const ch of chunks) for (let k = 0; k < ch.count; k++) {
    const r = ROWS.rows[ch.recIdx[k]], p = blockLocalCenter(ch, k);
    assert.deepEqual([p[0] + frame.origin[0], p[1] + frame.origin[1], p[2] + frame.origin[2]], [r.XC, r.YC, r.ZC], 'centroids exact');
    assert.deepEqual([ch.dimQ[3 * k], ch.dimQ[3 * k + 1], ch.dimQ[3 * k + 2]], [r.XINC * 2, r.YINC * 2, r.ZINC * 2]);
    n++;
  }
  assert.equal(n, ROWS.rows.length);
});

test('readers: a block past 255 fine steps → refused, said, shown as points', async () => {
  const big = makeSubblockRows({ seed: 3, nx: 2, ny: 2, nz: 1, maxOver: 200 });
  const dm = await openDmModel(new Blob([makeSubblockDm(big.rows)]));
  assert.equal(dm.header.grid, null); assert.ok(/255/.test(dm.header.subBlockRefused), dm.header.subBlockRefused);
  const csv = await openBlockModel(new Blob([makeSubblockCsv(big.rows)]));
  assert.equal(csv.header.grid, null); assert.ok(/255/.test(csv.header.subBlockRefused));
});

test('dm: two rotations stay unapplied (the order convention is unverified)', async () => {
  const { makeDM } = await import('./dm-make.mjs');
  const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    { name: 'XINC', type: 'N', constant: 10 }, { name: 'YINC', type: 'N', constant: 10 }, { name: 'ZINC', type: 'N', constant: 5 },
    { name: 'XMORIG', type: 'N', constant: 0 }, { name: 'YMORIG', type: 'N', constant: 0 }, { name: 'ZMORIG', type: 'N', constant: 0 },
    { name: 'NX', type: 'N', constant: 2 }, { name: 'NY', type: 'N', constant: 1 }, { name: 'NZ', type: 'N', constant: 1 },
    { name: 'ROTAXIS1', type: 'N', constant: 1 }, { name: 'ANGLE1', type: 'N', constant: 20 }];
  const { header } = await openDmModel(new Blob([makeDM(fields, [{ XC: 5, YC: 5, ZC: 2.5 }, { XC: 15, YC: 5, ZC: 2.5 }], { precision: 'ep' })]));
  assert.equal(header.dmRotationApplied, false, 'a rotation about X is reported, not applied');
});

// ── step 2: the readers speak the PLACED frame ─────────────────────────────────
// A rotated model's rows must read where the view draws them: XC/YC/ZC in world
// from every reader a consumer uses (recordBatches, columnBatches, fetchRecord,
// readDmRun with the header's dmPlace — what @gcu/scan's workers call).
test('dm: a placed model reads WORLD XC/YC/ZC from every reader; sizes + values untouched', async () => {
  const { readDmRun, dmPageRuns, peekDmRotation, dmWorldToLocal, volumeOfSizes } = await import('../ext/condenser/src/main.js');
  const blob = new Blob([makeSubblockDm(ROWS.rows, { angle1: -50, origin: [0, 0, 0] })]);
  const m = await openDmModel(blob, { origin: O });
  const h = m.header, pl = h.dmPlace;
  assert.ok(pl && pl.x === 0 && pl.y === 1 && pl.z === 2, 'dmPlace states the coordinate columns');
  const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const wOf = (r) => [O[0] + c * r.XC - s * r.YC, O[1] + s * r.XC + c * r.YC, O[2] + r.ZC];
  const checkRow = (row, r, what) => {
    const w = wOf(r);
    for (let a = 0; a < 3; a++) near(row[a], w[a], 1e-6, `${what} coord ${a}`);
    assert.equal(row[3], r.XINC, `${what} XINC untouched`); assert.equal(row[15], r.V, `${what} V untouched`);
  };
  let n = 0;
  for await (const { recStart, rows } of m.recordBatches()) for (let k = 0; k < rows.length; k++) { checkRow(rows[k], ROWS.rows[recStart + k], 'recordBatches'); n++; }
  assert.equal(n, ROWS.rows.length);
  // columnBatches — asking for ONE coordinate still places it (the other two are read along)
  for await (const { recStart, count, cols } of m.columnBatches([0, 15])) for (let k = 0; k < count; k++) near(cols[0][k], wOf(ROWS.rows[recStart + k])[0], 1e-6, 'columnBatches X');
  checkRow(await m.fetchRecord(17), ROWS.rows[17], 'fetchRecord');
  // readDmRun with the header's placement = what a scan worker reads
  const run = dmPageRuns(h.dm)[0];
  const r1 = await readDmRun(blob, h.dm, [1, 5], run, pl);
  near(r1.cols[1][3], wOf(ROWS.rows[r1.recStart + 3])[1], 1e-6, 'readDmRun Y placed');
  const r0 = await readDmRun(blob, h.dm, [1], run);
  assert.equal(r0.cols[1][3], ROWS.rows[r0.recStart + 3].YC, 'no placement → the file as stored');
  // the model's own frame comes back exactly
  const q = dmWorldToLocal(pl, ...wOf(ROWS.rows[5]));
  for (const [a, key] of [[0, 'XC'], [1, 'YC'], [2, 'ZC']]) near(q[a], ROWS.rows[5][key], 1e-6, `local ${key}`);
  // peek: the dialog's view of the rotation
  const pk = await peekDmRotation(blob);
  assert.ok(pk.applied); assert.deepEqual(pk.origin, [0, 0, 0]); assert.equal(pk.rotations[0].angle, -50);
  // an axis-aligned twin's readers are untouched (no placement)
  const plain = await openDmModel(new Blob([makeSubblockDm(ROWS.rows, { angle1: 0 })]));
  assert.equal(plain.header.dmPlace, null);
  assert.equal((await plain.fetchRecord(17))[0], ROWS.rows[17].XC);
  // volumes from the contract: sizes snapped to fine steps × pitch (= the raw product for on-lattice sizes)
  for (const r of ROWS.rows.slice(0, 50)) assert.equal(volumeOfSizes(r.XINC, r.YINC, r.ZINC, [0.5, 0.5, 0.5]), r.XINC * r.YINC * r.ZINC);
  assert.equal(volumeOfSizes(0.9999999963, 2.0000000071, 1, [0.5, 0.5, 0.5]), 2, 'f32 noise in a size snaps to its step');
  assert.equal(volumeOfSizes(NaN, 1, 1, [0.5, 0.5, 0.5]), null);
});
