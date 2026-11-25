// @gcu/proj crsToPrj — the .prj writer. Every system it writes must come back as the same
// system: by its AUTHORITY through crsFromPrj, and — the body alone, as an ESRI reader without
// codes sees it — projecting the same points to the millimetre through proj4's own WKT reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEpsgTable, lookupEpsg, crsFromPrj, crsFromDefinition, customCrs, transformPoints, crsToPrj, parseProj4, proj4, WGS84 } from '../ext/proj/src/main.js';

const D2R = Math.PI / 180;
const stripAuthority = (wkt) => wkt.replace(/,AUTHORITY\["EPSG","\d+"\]\]$/, ']');
const near = (a, b, tol = 1e-3) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;

test('crsToPrj: the whole EPSG table — written systems read back the same, the rest refused with a reason', async () => {
  const t = await loadEpsgTable();
  let written = 0, refused = 0;
  const bad = [];
  for (let i = 0; i < t.count; i++) {
    const c = t.entry(i);
    const r = crsToPrj(c);
    if (!r.text) { assert.ok(r.why && r.why.length > 10, `EPSG:${c.epsg} refused without a reason`); refused++; continue; }
    written++;
    const back = await crsFromPrj(r.text);
    if (!back || back.epsg !== c.epsg) { bad.push(`EPSG:${c.epsg} authority → ${back && back.epsg}`); continue; }
    if (c.kind !== 'projected') continue;
    // proj4's WKT reader puts a Mercator / eqc standard parallel in lat1, not lat_ts — a reader
    // gap the AUTHORITY covers (and crsToPrj refuses such a system when it has no code)
    const { proj, k } = parseProj4(c.def);
    if ((proj === 'merc' || proj === 'eqc') && k.lat_ts != null && +k.lat_ts !== 0) continue;
    const A = new proj4.Proj(c.def), B = new proj4.Proj(stripAuthority(r.text));
    if (Math.abs((A.to_meter || 1) - (B.to_meter || 1)) > 1e-12 || Math.abs(A.a - B.a) > 1e-6 || Math.abs((A.es || 0) - (B.es || 0)) > 1e-12) { bad.push(`EPSG:${c.epsg} units / ellipsoid`); continue; }
    const [w, s, e, n] = c.bbox || [0, 0, 0, 0];
    for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.3, 0.6]) {
      const lon = w + (e - w) * fx, lat = s + (n - s) * fy;
      const a = A.forward({ x: lon * D2R, y: lat * D2R }), b = B.forward({ x: lon * D2R, y: lat * D2R });
      if (a && Number.isFinite(a.x) && !near([a.x, a.y], [b.x, b.y])) { bad.push(`EPSG:${c.epsg} at ${lon},${lat}: ${a.x},${a.y} vs ${b.x},${b.y}`); break; }
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
  assert.ok(written > 6700, `wrote ${written} of ${t.count}`);
  assert.ok(refused < 300, `refused ${refused}`);
});

test('crsToPrj: ESRI-flavoured WKT1 for SIRGAS 2000 / UTM 23S', async () => {
  const { text } = crsToPrj(await lookupEpsg(31983));
  assert.equal(text, 'PROJCS["SIRGAS_2000_UTM_zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","31983"]]');
  const g = crsToPrj(await lookupEpsg(4326)).text;
  assert.match(g, /^GEOGCS\["GCS_WGS_1984",DATUM\["D_WGS_1984",SPHEROID\["WGS_1984",6378137\.0,298\.257223563/);
  // without the AUTHORITY the name alone still finds the table entry
  assert.equal((await crsFromPrj(stripAuthority(crsToPrj(await lookupEpsg(29193)).text))).epsg, 29193);
});

test('crsToPrj: custom systems round-trip through crsFromDefinition, transforms equal to the mm', async () => {
  const P = [[612000, 7765000, 850], [655000, 7810000, 900], [580000, 7700000, 700]];
  const cases = [
    '+proj=utm +zone=23 +south +ellps=aust_SA +towgs84=-66.87,4.37,-38.52,0,0,0,0 +units=m',               // SAD69 with a 3-param shift
    '+proj=tmerc +lat_0=0 +lon_0=-44 +k=0.9999 +x_0=500000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m',   // a local TM
    '+proj=lcc +lat_0=-20 +lon_0=-44 +lat_1=-18 +lat_2=-22 +x_0=600000 +y_0=7700000 +ellps=GRS80 +units=m',
    '+proj=aea +lat_0=-20 +lon_0=-44 +lat_1=-15 +lat_2=-25 +x_0=600000 +y_0=7700000 +ellps=intl +towgs84=-206,172,-6,0,0,0,0 +units=m',
    '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0.1,-0.2,0.3,0.0001,-0.0002,0.00003,1.5 +units=us-ft',
  ];
  for (const def of cases) {
    const orig = customCrs(def);
    const r = crsToPrj(orig);
    assert.ok(r.text, `${def}: ${r.why}`);
    assert.doesNotMatch(r.text, /AUTHORITY/);
    const back = await crsFromDefinition(r.text);
    const a = transformPoints(orig, WGS84, P), b = transformPoints(back, WGS84, P);
    a.forEach((p, i) => assert.ok(Math.abs(p[0] - b[i][0]) < 1e-8 && Math.abs(p[1] - b[i][1]) < 1e-8, `${def}: ${p} vs ${b[i]}`));   // 1e-8° ≈ 1 mm
  }
  // a polar stereographic (variant B) custom system
  const ps = customCrs('+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m');
  const psb = await crsFromDefinition(crsToPrj(ps).text);
  const q = [[-60, -75, 0], [100, -80, 0]];
  transformPoints(WGS84, ps, q).forEach((p, i) => assert.ok(near(p, transformPoints(WGS84, psb, q)[i])));
});

test('crsToPrj: refuses honestly', async () => {
  const why = (def) => crsToPrj(customCrs(def)).why;
  assert.match(why('+proj=utm +zone=23 +south +ellps=intl +nadgrids=CA7072_003.gsb +units=m'), /grid/);
  assert.match(why('+proj=omerc +lat_0=4 +lonc=102.25 +alpha=323.0257905 +k=0.99984 +x_0=804671 +y_0=0 +no_uoff +gamma=323.1301023611111 +ellps=evrst69 +units=m'), /isn't one/);
  assert.match(why('+proj=merc +lat_ts=-2 +lon_0=-43 +x_0=5000000 +y_0=10000000 +ellps=GRS80 +units=m'), /standard parallel/);
  assert.match(why('+proj=tmerc +lat_0=0 +lon_0=21 +k=1 +x_0=0 +y_0=0 +axis=wsu +ellps=WGS84 +units=m'), /axis/);
  assert.equal(crsToPrj(null).text, null);
  // an EPSG system with a grid shift is fine: the AUTHORITY stands for it
  assert.ok(crsToPrj(await lookupEpsg(22523)).text);
  // a custom WKT1 is already a .prj
  const w1 = 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  assert.equal(crsToPrj({ def: w1, epsg: null }).text, w1);
});
