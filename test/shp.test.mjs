// @gcu/shp — shapefile read/write round trips, ring assembly, dBASE, .prj classification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readShapefile, writeShapefile, readShp, writeShp, readDbf, writeDbf, dbfFields, prjInfo, ringArea, assembleRings, shapeTypeOf } from '../ext/shp/src/main.js';

const X = 600000, Y = 7700000;
const sq = (x, y, s, z) => [[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y + s, z], [x, y, z]];

test('polygons with a hole and a multipolygon round-trip with Z and attributes', () => {
  const feats = [
    { geometry: { type: 'Polygon', coordinates: [sq(X, Y, 100, 850), sq(X + 20, Y + 20, 10, 850)] }, properties: { NAME: 'pit A', BENCH: 850, GRADE: 1.25 } },
    { geometry: { type: 'MultiPolygon', coordinates: [[sq(X + 200, Y, 50, 840)], [sq(X + 300, Y, 50, 840)]] }, properties: { NAME: 'pits B+C', BENCH: 840, GRADE: null } },
  ];
  const out = writeShapefile(feats, { prj: 'PROJCS["SIRGAS 2000 / UTM zone 23S",GEOGCS["SIRGAS 2000"],AUTHORITY["EPSG","31983"]]' });
  assert.equal(out.cpg, 'UTF-8');
  const back = readShapefile({ shp: out.shp, dbf: out.dbf, prj: out.prj, cpg: out.cpg });
  assert.equal(back.typeName, 'PolygonZ');
  assert.equal(back.features.length, 2);
  const a = back.features[0];
  assert.equal(a.geometry.type, 'Polygon');
  assert.equal(a.geometry.coordinates.length, 2);              // outer + hole
  assert.ok(ringArea(a.geometry.coordinates[0]) < 0, 'outer clockwise');
  assert.ok(ringArea(a.geometry.coordinates[1]) > 0, 'hole counter-clockwise');
  assert.deepEqual(a.geometry.coordinates[0].map((p) => p[2]).every((z) => z === 850), true);
  assert.deepEqual(a.properties, { NAME: 'pit A', BENCH: 850, GRADE: 1.25 });
  assert.equal(back.features[1].geometry.type, 'MultiPolygon');
  assert.equal(back.features[1].geometry.coordinates.length, 2);
  assert.equal(back.features[1].properties.GRADE, null);
  assert.equal(back.crs.kind, 'projected');
  assert.equal(back.crs.epsg, 31983);
});

test('lines and points, 2D; nulls survive', () => {
  const lines = [
    { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] }, properties: { ID: 1 } },
    { geometry: null, properties: { ID: 2 } },
    { geometry: { type: 'MultiLineString', coordinates: [[[0, 5], [1, 5]], [[3, 5], [4, 6]]] }, properties: { ID: 3 } },
  ];
  const o = writeShapefile(lines);
  const b = readShapefile({ shp: o.shp, dbf: o.dbf });
  assert.equal(b.typeName, 'PolyLine');
  assert.deepEqual(b.features[0].geometry.coordinates, [[0, 0], [1, 1], [2, 0]]);
  assert.equal(b.features[1].geometry, null);
  assert.equal(b.features[2].geometry.type, 'MultiLineString');
  const pts = writeShapefile([{ geometry: { type: 'Point', coordinates: [5, 6, 7] }, properties: { K: 'a' } }]);
  const pb = readShapefile({ shp: pts.shp, dbf: pts.dbf });
  assert.equal(pb.typeName, 'PointZ');
  assert.deepEqual(pb.features[0].geometry.coordinates, [5, 6, 7]);
});

test('the .shx indexes every record', () => {
  const { shp, shx } = writeShp([{ type: 'Point', coordinates: [1, 2] }, { type: 'Point', coordinates: [3, 4] }]);
  const dv = new DataView(shx.buffer);
  assert.equal(dv.getInt32(100, false) * 2, 100);
  assert.equal(dv.getInt32(108, false) * 2, 100 + 8 + 20);
  assert.equal(readShp(shp).geometries.length, 2);
});

test('a file that ignores the winding rule still reads its rings', () => {
  const ccwOuter = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];   // counter-clockwise outer
  const polys = assembleRings([ccwOuter]);
  assert.equal(polys.length, 1);
  // a clockwise outer + a counter-clockwise hole inside it
  const cw = ccwOuter.slice().reverse(), hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
  assert.equal(assembleRings([cw, hole])[0].length, 2);
});

test('mixed geometry families refuse', () => {
  assert.throws(() => shapeTypeOf([{ type: 'Point', coordinates: [0, 0] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }]), /ONE geometry type/);
});

test('dBASE: numbers, text, unicode, long names made unique, deleted rows skipped', () => {
  const rows = [{ 'long attribute name': 'São João', n: 12, f: -0.125 }, { 'long attribute name': 'x', n: 3, f: 2 }];
  const fields = dbfFields(rows);
  assert.equal(fields[0].name, 'long attri');
  assert.equal(fields[1].type, 'N'); assert.equal(fields[2].decimals, 3);
  const bytes = writeDbf(rows, fields);
  const t = readDbf(bytes, { encoding: 'utf-8' });
  assert.deepEqual(t.rows[0], { 'long attri': 'São João', n: 12, f: -0.125 });
  // delete row 0 by its flag
  const hdr = new DataView(bytes.buffer).getUint16(8, true);
  bytes[hdr] = 0x2a;
  assert.equal(readDbf(bytes).rows.length, 1);
  const twin = dbfFields([{ 'abcdefghijKLM': 1, 'abcdefghijXYZ': 2 }]);
  assert.notEqual(twin[0].name.toUpperCase(), twin[1].name.toUpperCase());
});

test('prjInfo: geographic / projected / local', () => {
  assert.equal(prjInfo('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]').kind, 'geographic');
  assert.equal(prjInfo('PROJCS["WGS_1984_UTM_Zone_23S",GEOGCS["GCS_WGS_1984"],PROJECTION["Transverse_Mercator"]]').kind, 'projected');
  assert.equal(prjInfo('GEOGCRS["SIRGAS 2000",ELLIPSOID["GRS 1980",6378137,298.257222101],ID["EPSG",4674]]').epsg, 4674);
  assert.equal(prjInfo('LOCAL_CS["mine grid"]').kind, 'local');
  assert.equal(prjInfo('').kind, 'unknown');
});
