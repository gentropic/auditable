// micro grid EXPORT writers (tools/micro/src/grid-io.js): every format round-trips
// through a reader — micro's own (openGridSource / readSurferGrd / readEsriAsc for
// .asc, Surfer 7, Surfer 6 binary + ASCII), a tiny .flt/.hdr reader written here,
// and a CSV parse. Values, nodata, geotransform, non-square cells, decimals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openGridSource, readSurferGrd, readEsriAsc, SURFER_BLANK,
  esriAscParts, writeEsriAsc, surferAsciiParts, writeSurferGrd, writeSurfer7Grd, writeEsriFlt, gridXyzParts,
  valueFormatter, gridBlankTest, defaultNodata,
} from '../tools/micro/src/grid-io.js';

const NX = 13, NY = 9;
// float32 values with fractional digits, a NaN hole and a source-nodata hole
const grid = ({ dx = 5, dy = 5, nodata = -9999 } = {}) => {
  const data = new Float32Array(NX * NY);
  for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) data[r * NX + c] = 812.25 + r * 3.1 - c * 0.731 + Math.sin(r * c) * 0.01;
  data[2] = NaN; data[NX * 4 + 6] = nodata;
  return { nx: NX, ny: NY, data, x0: 600002.5, y0: 7400042.5, dx, dy, nodata };
};
const holes = new Set([2, NX * 4 + 6]);
const geoOf = async (src) => {                                // a readGTiff-shaped source → grid (full read)
  const img = src.images[0], g = src.geo;
  const half = g.pixelIsPoint ? 0 : 0.5;
  return { nx: img.width, ny: img.height, data: await img.read(), x0: g.origin[0] + half * g.scale[0], y0: g.origin[1] - half * g.scale[1], dx: g.scale[0], dy: g.scale[1], nodata: g.nodata };
};
const same = (back, g, { tol = 0, blank } = {}) => {
  assert.equal(back.nx, g.nx); assert.equal(back.ny, g.ny);
  assert.ok(Math.abs(back.x0 - g.x0) < 1e-6, `x0 ${back.x0} vs ${g.x0}`);
  assert.ok(Math.abs(back.y0 - g.y0) < 1e-6, `y0 ${back.y0} vs ${g.y0}`);
  assert.ok(Math.abs(back.dx - g.dx) < 1e-9 && Math.abs(back.dy - g.dy) < 1e-9, `cell ${back.dx}×${back.dy}`);
  const bad = gridBlankTest(back);
  for (let i = 0; i < g.nx * g.ny; i++) {
    if (holes.has(i)) { assert.ok(bad(back.data[i]), `cell ${i} should be empty, got ${back.data[i]}`); if (blank != null) assert.equal(back.data[i], blank); continue; }
    if (tol) assert.ok(Math.abs(back.data[i] - g.data[i]) <= tol, `cell ${i}: ${back.data[i]} vs ${g.data[i]}`);
    else assert.equal(back.data[i], g.data[i], `cell ${i}`);
  }
};
const blobOf = (parts) => new Blob(Array.isArray(parts) ? parts : [parts]);

test('valueFormatter: float32-exact is the shortest exact text; fixed decimals strip zeros', () => {
  const f = valueFormatter(null);
  for (const v of [Math.fround(123.4), Math.fround(0.001234), Math.fround(-7.25), Math.fround(1e-7), 42]) assert.equal(Math.fround(+f(v)), v);
  assert.equal(f(Math.fround(123.4)), '123.4');
  const f2 = valueFormatter(2);
  assert.equal(f2(1.5), '1.5'); assert.equal(f2(2), '2'); assert.equal(f2(1.006), '1.01'); assert.equal(valueFormatter(0)(12.6), '13');
  assert.equal(defaultNodata({ nodata: SURFER_BLANK }), -9999); assert.equal(defaultNodata({ nodata: -1 }), -1); assert.equal(defaultNodata({ nodata: NaN }), -9999);
});

test('ESRI ASCII: exact values, chosen nodata, through both micro readers', async () => {
  const g = grid();
  const parts = esriAscParts(g, { nodata: -32768, decimals: null });
  const text = parts.join('');
  assert.match(text, /NODATA_value -32768\n/);
  same(await geoOf(await openGridSource(blobOf(parts), 'g.asc')), g, { blank: -32768 });
  same(await readEsriAsc(blobOf(parts)), g, { blank: -32768 });
});

test('ESRI ASCII: decimals round; the default stays the 3-decimal persist form', async () => {
  const g = grid();
  same(await readEsriAsc(blobOf(esriAscParts(g, { decimals: 1 }))), g, { tol: 0.05 + 1e-4 });
  assert.equal(writeEsriAsc(g), esriAscParts(g, { decimals: 3 }).join(''));
});

test('ESRI ASCII: non-square cells are written as dx/dy and read back', async () => {
  const g = grid({ dx: 5, dy: 7.5 });
  const t = writeEsriAsc(g, { decimals: null });
  assert.match(t, /\ndx 5\ndy 7\.5\n/); assert.doesNotMatch(t, /cellsize/);
  same(await geoOf(await openGridSource(new Blob([t]), 'g.asc')), g);
  same(await readEsriAsc(new Blob([t])), g);
});

test('Surfer 7 binary: float64 values, blank, geotransform; read by readSurferGrd and openGridSource', async () => {
  const g = grid({ dx: 5, dy: 6 });
  const buf = writeSurfer7Grd(g);
  assert.equal(new TextDecoder('latin1').decode(new Uint8Array(buf, 0, 4)), 'DSRB');
  assert.equal(buf.byteLength, 100 + NX * NY * 8);
  same(await readSurferGrd(new Blob([buf])), g, { blank: Math.fround(SURFER_BLANK) });
  const src = await openGridSource(new Blob([buf]), 'g.grd');
  assert.equal(src.form, 'Surfer 7 binary');
  same(await geoOf(src), g);
  // a decimated read walks the same rows
  const d = await src.images[0].readDecimated(2);
  assert.equal(d.data[7 + 1], g.data[2 * NX + 2]);
});

test('Surfer 7: a foreign section before DATA is skipped', async () => {
  const g = grid(), buf = new Uint8Array(writeSurfer7Grd(g));
  const extra = new Uint8Array(8 + 16);                     // 'FLTI' with 16 junk bytes, between GRID and DATA
  new DataView(extra.buffer).setUint32(0, 0x49544c46, true); new DataView(extra.buffer).setUint32(4, 16, true);
  const at = 12 + 8 + 72;
  const out = new Uint8Array(buf.length + extra.length); out.set(buf.subarray(0, at)); out.set(extra, at); out.set(buf.subarray(at), at + extra.length);
  same(await readSurferGrd(new Blob([out])), g);
});

test('Surfer 6 binary + ASCII (DSAA): blank, south-first rows, both readers', async () => {
  const g = grid({ dx: 4, dy: 5 });
  same(await readSurferGrd(new Blob([writeSurferGrd(g)])), g, { blank: Math.fround(SURFER_BLANK) });
  const dsaa = surferAsciiParts(g, { decimals: null });
  assert.match(dsaa[0], /^DSAA\n13 9\n/);
  assert.ok(dsaa.join('').split('\n').every((l) => l.split(' ').length <= 10));   // ten to a line
  same(await readSurferGrd(blobOf(dsaa)), g);
  same(await geoOf(await openGridSource(blobOf(dsaa), 'g.grd')), g);
  assert.throws(() => writeSurferGrd({ ...g, nx: 40000 }), /32767/);
});

// the tiniest .flt/.hdr reader: the header's keys, then float32 rows north-first
const readFlt = (hdr, flt) => {
  const h = {}; for (const line of hdr.trim().split('\n')) { const [k, v] = line.trim().split(/\s+/); h[k.toLowerCase()] = v; }
  const nx = +h.ncols, ny = +h.nrows, dx = +(h.cellsize || h.xdim), dy = +(h.cellsize || h.ydim), le = h.byteorder === 'LSBFIRST';
  const v = new DataView(flt), data = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) data[i] = v.getFloat32(i * 4, le);
  return { nx, ny, dx, dy, data, x0: +h.xllcorner + dx / 2, y0: +h.yllcorner + ny * dy - dy / 2, nodata: Math.fround(+h.nodata_value) };
};
test('ESRI binary float (.flt + .hdr): float32 exact, nodata, LSBFIRST', () => {
  const g = grid();
  const { flt, hdr } = writeEsriFlt(g, { nodata: -3.4e38 });
  assert.equal(flt.byteLength, NX * NY * 4);
  assert.match(hdr, /byteorder LSBFIRST/);
  const back = readFlt(hdr, flt);
  same(back, g, { blank: Math.fround(-3.4e38) });
  const ns = writeEsriFlt(grid({ dx: 2, dy: 3 }));
  assert.match(ns.hdr, /xdim 2\nydim 3/);
  same(readFlt(ns.hdr, ns.flt), grid({ dx: 2, dy: 3 }), { blank: -9999 });
});

test('XYZ / CSV of nodes: header, coordinates at the nodes, skip-empty and blank fields', () => {
  const g = grid();
  const parse = (parts, delim) => parts.join('').trim().split('\n').map((l) => l.split(delim));
  const skip = gridXyzParts(g, { delim: ',', names: ['x', 'y', 'elev'], decimals: null });
  const rows = parse(skip, ',');
  assert.deepEqual(rows[0], ['x', 'y', 'elev']);
  assert.equal(rows.length - 1, NX * NY - 2); assert.equal(skip.rows, NX * NY - 2);
  const byXY = new Map(rows.slice(1).map((r) => [r[0] + ',' + r[1], +r[2]]));
  for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) {
    const i = r * NX + c, key = String(g.x0 + c * g.dx) + ',' + String(g.y0 - r * g.dy);
    if (holes.has(i)) assert.ok(!byXY.has(key)); else assert.equal(Math.fround(byXY.get(key)), g.data[i]);
  }
  const keep = parse(gridXyzParts(g, { delim: ',', skipEmpty: false }), ',');
  assert.equal(keep.length - 1, NX * NY);
  assert.deepEqual(keep[1 + 2], [String(g.x0 + 2 * g.dx), String(g.y0), '']);       // NaN → an empty field
  const sp = parse(gridXyzParts(g, { delim: ' ', header: false, skipEmpty: false, nodata: -1 }), ' ');
  assert.equal(sp.length, NX * NY); assert.equal(sp[2][2], '-1');                    // space-delimited: nodata, never an empty field
});
