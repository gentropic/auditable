// @gcu/condenser — micro:model, the lattice a file states (grid/model.js): the
// `# micro:model {…}` comment line a CSV carries (write + parse, pure), the grid
// forms it accepts, and the delimited reader applying it as a DECLARED lattice —
// checked on every record, refused (never thrown) on a misfit. Plus the .dm reader's
// regular lattice from centroids when the DD carries no lattice constants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  microModelLine, parseMicroModelComment, gridOfMicroModel, dimColsOfMicroModel, declaredSubBlocks,
  openBlockModel, openDmModel, sizeCollector, datamineRotZ, latticeChecker, latticeMisfit,
} from '../ext/condenser/src/main.js';
import { makeSubblockRows } from './subblock-make.mjs';

const O = [432820, 8522360, 300];
const R = datamineRotZ(-50);
const toW = (x, y, z) => [O[0] + R[0] * x + R[3] * y, O[1] + R[1] * x + R[4] * y, O[2] + z];

test('the comment line round-trips; only the leading comment block is read', () => {
  const m = { v: 1, by: 'micro', grid: { x: { origin: 0.5, pitch: 0.5, count: 9 }, y: { origin: 0.5, pitch: 0.5, count: 9 }, z: { origin: 0.5, pitch: 0.5, count: 9 } }, subBlocked: true, dims: { x: 'XINC', y: 'YINC', z: 'ZINC' } };
  const line = microModelLine(m);
  assert.ok(line.startsWith('# micro:model {'), line);
  assert.ok(!line.includes('\n'));
  assert.deepEqual(parseMicroModelComment(`${line}\r\nXC,YC,ZC\r\n1,2,3\r\n`).model, m);
  assert.deepEqual(parseMicroModelComment(`# exported by micro\n\n${line}\nXC,YC,ZC\n`).model, m, 'other comment lines and blanks before it');
  assert.equal(parseMicroModelComment(`XC,YC,ZC\n${line}\n`), null, 'after the header row it is data, not a statement');
  assert.equal(parseMicroModelComment('# just a comment\nXC,YC,ZC\n'), null);
  assert.ok(/not valid JSON/.test(parseMicroModelComment('# micro:model {"v":1,\nXC\n').error));
  assert.ok(/JSON object/.test(parseMicroModelComment('# micro:model [1,2]\nXC\n').error));
});

test('gridOfMicroModel: the three forms; a malformed grid throws with the reason', () => {
  const ax = { x: { origin: 1, pitch: 2, count: 3 }, y: { origin: 1, pitch: 2, count: 3 }, z: { origin: 1, pitch: 2, count: 3 } };
  assert.deepEqual(gridOfMicroModel({ grid: ax }), ax);
  const rot = gridOfMicroModel({ grid: { ...ax, rot: R, anchor: O } });
  assert.deepEqual(rot.rot, R); assert.deepEqual(rot.anchor, O);
  const fromBasis = gridOfMicroModel({ grid: { basis: { origin: O, U: [R[0] * 2, R[1] * 2, 0], V: [R[3] * 2, R[4] * 2, 0], W: [0, 0, 2], counts: [3, 3, 3] } } });
  assert.ok(fromBasis.rot && Math.abs(fromBasis.x.pitch - 2) < 1e-12);
  assert.equal(gridOfMicroModel({}), null);
  assert.throws(() => gridOfMicroModel({ grid: { x: { origin: 0, pitch: 1 }, y: ax.y, z: ax.z } }), /origin, pitch and count/);
  assert.throws(() => gridOfMicroModel({ grid: { ...ax, rot: [1, 0, 0], anchor: O } }), /rot/);
  assert.deepEqual(dimColsOfMicroModel({ dims: { x: 'DX', y: 'DY', z: 'DZ' } }, ['XC', 'DX', 'DY', 'DZ']), { x: 1, y: 2, z: 3 });
  assert.equal(dimColsOfMicroModel({ dims: { x: 'DX', y: 'DY', z: 'DZ' } }, ['XC', 'DX', 'DY']), null);
});

test('declaredSubBlocks: whole fine steps, none past 255', () => {
  const s = sizeCollector(); s.add(1, 2, 3); s.add(4, 1, 1);
  assert.deepEqual(declaredSubBlocks(s, [0.5, 0.5, 0.5]).sizeQMax, [8, 4, 6]);
  assert.ok(/whole number/.test(declaredSubBlocks(s, [0.75, 0.5, 0.5]).refused));
  assert.ok(/255/.test(declaredSubBlocks(s, [0.01, 0.5, 0.5]).refused));
});

test('latticeChecker = latticeMisfit, the map built once', () => {
  const g = { x: { origin: 0, pitch: 1, count: 10 }, y: { origin: 0, pitch: 1, count: 10 }, z: { origin: 0, pitch: 1, count: 10 }, rot: R, anchor: O };
  const chk = latticeChecker(g);
  for (const p of [[1, 2, 3], [1.3, 2, 3], [11, 0, 0]]) {
    const w = toW(...p);
    assert.equal(chk(...w, 7), latticeMisfit(g, ...w, 7));
  }
  assert.equal(chk(...toW(1, 2, 3), 0), null);
});

// a rotated, sub-blocked model in WORLD coordinates, with (or without) its header line
function rotatedSubCsv(rows, model) {
  const body = 'XC,YC,ZC,XINC,YINC,ZINC,V\n' + rows.map((r) => { const w = toW(r.XC, r.YC, r.ZC); return `${w.join(',')},${r.XINC},${r.YINC},${r.ZINC},${r.V}`; }).join('\n') + '\n';
  return (model ? microModelLine(model) + '\n' : '') + body;
}
function latticeOf(rows, pitch = 0.5) {
  const a = ['XC', 'YC', 'ZC'].map((k) => { const v = rows.map((r) => r[k]); const mn = Math.min(...v), mx = Math.max(...v); return { origin: mn, pitch, count: Math.round((mx - mn) / pitch) + 1 }; });
  return { x: a[0], y: a[1], z: a[2], rot: R, anchor: O };
}

test('a CSV that states its rotated sub-block lattice opens as that lattice — declared, checked', async () => {
  const { rows } = makeSubblockRows({ seed: 5, nx: 3, ny: 2, nz: 2 });
  const grid = latticeOf(rows);
  const model = { v: 1, by: 'micro', grid, subBlocked: true, dims: { x: 'XINC', y: 'YINC', z: 'ZINC' } };
  const { header, streamChunks } = await openBlockModel(new Blob([rotatedSubCsv(rows, model)]));
  assert.equal(header.count, rows.length);
  assert.ok(header.grid && header.grid.rot, 'rotated');
  assert.equal(header.subBlocked, true);
  assert.deepEqual(header.lattice, { basis: 'declared', by: 'file' });
  assert.equal(header.latticeRejected, null);
  assert.deepEqual(header.columns[header.dimCols.x], 'XINC');
  let n = 0, q0 = null;
  for await (const c of streamChunks()) { n += c.count; if (!q0) q0 = Array.from(c.dimQ.subarray(0, 3)); }
  assert.equal(n, rows.length);
  assert.deepEqual(q0, [rows[0].XINC * 2, rows[0].YINC * 2, rows[0].ZINC * 2], 'sizes in fine steps of 0.5');
  // without the line: a rotated sub-blocked model can't be inferred → no grid (points)
  const bare = await openBlockModel(new Blob([rotatedSubCsv(rows, null)]));
  assert.equal(bare.header.grid, null);
});

test('a header whose lattice misfits is REFUSED with the reason — points, not thrown', async () => {
  const { rows } = makeSubblockRows({ seed: 6, nx: 2, ny: 2, nz: 1 });
  const grid = latticeOf(rows);
  const tampered = { ...grid, x: { ...grid.x, pitch: 0.7 } };
  const bad = await openBlockModel(new Blob([rotatedSubCsv(rows, { v: 1, grid: tampered, subBlocked: true, dims: { x: 'XINC', y: 'YINC', z: 'ZINC' } })]));
  assert.equal(bad.header.grid, null);
  assert.equal(bad.header.subBlocked, false);
  assert.ok(/micro:model lattice doesn't fit.*off the lattice along U/.test(bad.header.latticeRejected), bad.header.latticeRejected);
  const noDims = await openBlockModel(new Blob([rotatedSubCsv(rows, { v: 1, grid, subBlocked: true, dims: { x: 'DX', y: 'DY', z: 'DZ' } })]));
  assert.equal(noDims.header.grid, null);
  assert.ok(/size columns DX\/DY\/DZ/.test(noDims.header.latticeRejected));
  const junk = await openBlockModel(new Blob(['# micro:model {oops\n' + rotatedSubCsv(rows, null)]));
  assert.ok(/not valid JSON/.test(junk.header.latticeRejected));
  // opted out: the line is ignored, as any other comment
  const off = await openBlockModel(new Blob([rotatedSubCsv(rows, { v: 1, grid: tampered, subBlocked: true, dims: { x: 'XINC', y: 'YINC', z: 'ZINC' } })]), { fileModel: false });
  assert.equal(off.header.latticeRejected, null);
});

test('a regular axis-aligned CSV with a header keeps the stated lattice (sparse included)', async () => {
  const lines = ['XC,YC,ZC,V'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) lines.push(`${105 + i * 10},${205 + j * 10},2.5,${i + j}`);
  const grid = { x: { origin: 105, pitch: 10, count: 4 }, y: { origin: 205, pitch: 10, count: 3 }, z: { origin: 2.5, pitch: 5, count: 1 } };
  const { header } = await openBlockModel(new Blob([microModelLine({ v: 1, by: 'micro', grid }) + '\n' + lines.join('\n') + '\n']));
  assert.deepEqual(header.grid, grid);
  assert.equal(header.subBlocked, false);
  assert.equal(header.count, 6);
});

test('dm: constant per-record sizes and no DD lattice → a regular lattice from the centroids', async () => {
  const { makeDM } = await import('./dm-make.mjs');
  const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' }, { name: 'V', type: 'N' }];
  const rows = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 2; k++) if ((i * 7 + j * 3 + k) % 4) rows.push({ XC: 1000 + 10 + i * 20, YC: 2000 + 10 + j * 20, ZC: 5 + k * 10, XINC: 20, YINC: 20, ZINC: 10, V: i + j + k });
  const { header, streamChunks } = await openDmModel(new Blob([makeDM(fields, rows, { precision: 'ep' })]));
  assert.ok(header.grid, 'boxes, not points');
  assert.equal(header.subBlocked, false);
  assert.deepEqual([header.grid.x.pitch, header.grid.y.pitch, header.grid.z.pitch], [20, 20, 10], 'the stated sizes are the pitch');
  assert.deepEqual([header.grid.x.origin, header.grid.x.count], [1010, 5]);
  assert.deepEqual(header.lattice, { basis: 'inferred', from: 'centroids' });
  let n = 0; for await (const c of streamChunks()) n += c.count;
  assert.equal(n, rows.length);
  // sizes that DON'T fit the centroids (a 15 m size on a 20 m spacing) → no lattice
  const off = await openDmModel(new Blob([makeDM(fields, rows.map((r) => ({ ...r, XINC: 15 })), { precision: 'ep' })]));
  assert.equal(off.header.grid, null);
  // with a single Z rotation applied, the inferred lattice is placed like any other
  const rotF = [...fields, { name: 'ROTAXIS1', type: 'N', constant: 3 }, { name: 'ANGLE1', type: 'N', constant: -50 }];
  const rot = await openDmModel(new Blob([makeDM(rotF, rows, { precision: 'ep' })]), { origin: O });
  assert.ok(rot.header.grid && rot.header.grid.rot);
  assert.deepEqual(rot.header.grid.anchor, O);
});
