// micro grid-io: openGridSource — ESRI ASCII / Surfer 6 (ascii + binary) as
// readGTiff-shaped SOURCES (one indexed pass, decimated display, windowed full-res
// reads), never one string. Checked against the whole-file readers they replace,
// through @gcu/gtiff's own grid helpers (the path micro actually runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openGridSource, readEsriAsc, readSurferGrd, writeEsriAsc, writeSurferGrd, SURFER_BLANK } from '../tools/micro/src/grid-io.js';
import { gridFromGTiff, gridWindowFromGTiff, gridDecimatedFromGTiff, windowForWorldBbox } from '../ext/gtiff/src/main.js';

const NX = 37, NY = 23, CS = 5;
const grid = () => {
  const data = new Float32Array(NX * NY);
  for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) data[r * NX + c] = Math.fround(300 + r * 1.25 - c * 0.5 + Math.sin(r * c) * 0.125);
  data[5 * NX + 7] = -9999;
  return { nx: NX, ny: NY, x0: 612002.5, y0: 7765112.5, dx: CS, dy: CS, data, nodata: -9999 };
};
// Surfer ascii (DSAA), south-first, wrapped 10 values per line (Surfer's own habit)
function writeDsaa(g) {
  const out = ['DSAA', `${g.nx} ${g.ny}`, `${g.x0} ${g.x0 + (g.nx - 1) * g.dx}`, `${g.y0 - (g.ny - 1) * g.dy} ${g.y0}`, '0 1000'];
  for (let r = g.ny - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < g.nx; c++) row.push(g.data[r * g.nx + c]);
    for (let k = 0; k < row.length; k += 10) out.push(row.slice(k, k + 10).join(' '));
    out.push('');
  }
  return out.join('\r\n');
}
class CountingBlob extends Blob {
  constructor(parts) { super(parts); this.bytes = 0; }
  slice(a, b) { this.bytes += Math.max(0, Math.min(b ?? this.size, this.size) - (a || 0)); return super.slice(a, b); }
  text() { throw new Error('read WHOLE as text — must never happen'); }
}

const FORMATS = () => {
  const g = grid();
  return [
    ['ESRI ASCII', 'dem.asc', writeEsriAsc(g)],
    ['ESRI ASCII, xllcenter + wrapped rows', 'dem.asc',
      writeEsriAsc(g).replace(/xllcorner (\S+)/, (_, v) => `xllcenter ${+v + CS / 2}`).replace(/yllcorner (\S+)/, (_, v) => `yllcenter ${+v + CS / 2}`)
        .split('\n').map((ln) => (/^[-\d.]/.test(ln) ? ln.split(' ').reduce((a, t, i) => a + (i && i % 8 === 0 ? '\n' : i ? ' ' : '') + t, '') : ln)).join('\n')],
    ['Surfer 6 ascii', 'dem.grd', writeDsaa(g)],
    ['Surfer 6 binary', 'dem.grd', new Uint8Array(writeSurferGrd(g))],
  ];
};

test('openGridSource: the full-res grid equals the whole-file reader, for every format', async () => {
  for (const [label, name, bytes] of FORMATS()) {
    const blob = new Blob([bytes]);
    const old = /\.grd$/.test(name) ? await readSurferGrd(blob) : await readEsriAsc(blob);
    const src = await openGridSource(blob, name);
    const g = await gridFromGTiff(src);
    assert.equal(g.nx, old.nx, label); assert.equal(g.ny, old.ny, label);
    assert.ok(Math.abs(g.x0 - old.x0) < 1e-6 && Math.abs(g.y0 - old.y0) < 1e-6, `${label}: origin ${g.x0},${g.y0} vs ${old.x0},${old.y0}`);
    assert.ok(Math.abs(g.dx - old.dx) < 1e-9 && Math.abs(g.dy - old.dy) < 1e-9, `${label}: cell`);
    assert.equal(g.nodata, old.nodata, `${label}: nodata`);
    assert.deepEqual([...g.data], [...old.data], `${label}: values`);
  }
});

test('openGridSource: decimated display (gathered on the index pass) == a re-parse at that step; windows read only their rows', async () => {
  for (const [label, name, bytes] of FORMATS()) {
    const blob = new CountingBlob([bytes]);
    const src = await openGridSource(blob, name, { displayCap: 60 });   // forces step 4 on 37×23
    const full = await gridFromGTiff(src);
    const dec = await gridDecimatedFromGTiff(src, 0, 4);
    assert.equal(dec.nx, Math.ceil(NX / 4)); assert.equal(dec.ny, Math.ceil(NY / 4));
    for (let r = 0; r < dec.ny; r++) for (let c = 0; c < dec.nx; c++) assert.equal(dec.data[r * dec.nx + c], full.data[r * 4 * NX + c * 4], `${label}: dec ${r},${c}`);
    const re = await src.images[0].readDecimated(3);          // a step not cached → re-parsed
    assert.equal(re.data[2 * re.dnx + 1], full.data[6 * NX + 3], `${label}: step 3`);
    // a world-bbox window: right values, and far fewer bytes than the file
    const before = blob.bytes;
    const bb = [full.x0 + 10 * CS, full.y0 - 15 * CS, full.x0 + 14 * CS, full.y0 - 12 * CS];
    const win = windowForWorldBbox(src, 0, bb, 0);
    const w = await gridWindowFromGTiff(src, 0, win);
    assert.equal(w.data[0], full.data[win.y * NX + win.x], `${label}: window origin value`);
    assert.equal(w.data[w.nx * (w.ny - 1) + w.nx - 1], full.data[(win.y + w.ny - 1) * NX + win.x + w.nx - 1], `${label}: window far corner`);
    assert.ok(blob.bytes - before < blob.size * 0.5, `${label}: the window read ${blob.bytes - before} of ${blob.size} bytes`);
  }
});

test('openGridSource: a truncated text grid names itself; Surfer 7 / junk refuse plainly', async () => {
  const asc = writeEsriAsc(grid());
  await assert.rejects(() => openGridSource(new Blob([asc.slice(0, asc.length - 400)]), 'cut.asc'), /truncated/);
  await assert.rejects(() => openGridSource(new Blob(['DSRB....']), 'x.grd'), /Surfer 7/);
  await assert.rejects(() => openGridSource(new Blob(['hello world']), 'x.asc'), /not an ESRI ASCII grid/);
  assert.equal(SURFER_BLANK, 1.70141e38);
});
