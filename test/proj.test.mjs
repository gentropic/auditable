// @gcu/proj — the EPSG table, CRS parsing, and transforms checked against PUBLISHED values and
// independent oracles written here (never against proj4 itself):
//   · Transverse Mercator: EPSG Guidance Note 7-2 (IOGP Publication 373-7-2, "Coordinate
//     Conversions and Transformations including Formulas"), the worked TM example — OSGB 1936 /
//     British National Grid, φ = 50°30'N, λ = 0°30'E → E = 577 274.99 m, N = 69 740.50 m (to the
//     cm, as published — a series formula, so the exact answer sits ~7 mm off it); plus an independent Krüger n-series implementation (Karney 2011, 6th
//     order) that UTM is checked against to the MILLIMETRE over a zone, and round trips to 1 mm.
//   · SAD 69 and Córrego Alegre → SIRGAS 2000: IBGE, Resolução do Presidente R.PR 1/2005 (the
//     SIRGAS2000 adoption), annex — SAD 69: ΔX = −67.35, ΔY = +3.88, ΔZ = −38.22 m; Córrego
//     Alegre: ΔX = −206.05, ΔY = +168.28, ΔZ = −3.82 m — applied by an oracle here (geodetic →
//     geocentric → shift → geodetic) and compared to the library to the millimetre.
//   · WGS 84 ↔ SIRGAS 2000 = identity (to the mm), stated as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEpsgTable, lookupEpsg, searchCrs, suggestCrs, crsFromPrj, crsFromDefinition, crsFromGeoKeys, crsFromUrn, crsLabel, crsToJSON, crsFromJSON,
  transformPoints, describePath, toLonLat, fromLonLat, extentLonLat, worldRings, EPSG_SOURCE, customCrs,
} from '../ext/proj/index.js';

const DEG = Math.PI / 180;
// ── oracles ──
function tmForward(latDeg, lonDeg, { a, rf, lon0, k0 = 0.9996, E0 = 500000, N0 = 0 }) {
  const f = 1 / rf, n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const al = [0,
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400];
  const e = 2 * Math.sqrt(n) / (1 + n);
  const phi = latDeg * DEG, lam = (lonDeg - lon0) * DEG;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(lam)), eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) { xi += al[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1); eta += al[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1); }
  return [E0 + k0 * A * eta, N0 + k0 * A * xi];
}
function toEcef(lat, lon, h, a, rf) {
  const f = 1 / rf, e2 = f * (2 - f), p = lat * DEG, l = lon * DEG;
  const N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * Math.sin(p)];
}
function fromEcef([X, Y, Z], a, rf) {
  const f = 1 / rf, e2 = f * (2 - f), p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 10; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(Z + e2 * N * Math.sin(lat), p); }
  return [lat / DEG, Math.atan2(Y, X) / DEG];
}
// a 3-parameter shift between ellipsoids, h = 0 on the source (as a 2D transform does)
const shift3 = (lat, lon, src, dst, d) => { const [X, Y, Z] = toEcef(lat, lon, 0, src.a, src.rf); return fromEcef([X + d[0], Y + d[1], Z + d[2]], dst.a, dst.rf); };
const GRS80 = { a: 6378137, rf: 298.257222101 }, AUST_SA = { a: 6378160, rf: 298.25 }, INTL = { a: 6378388, rf: 297 }, AIRY = { a: 6377563.396, rf: 299.3249646 };
const IBGE_SAD69 = [-67.35, 3.88, -38.22], IBGE_CA = [-206.05, 168.28, -3.82];

test('the EPSG table: every projected + geographic-2D CRS with a proj4 definition', async () => {
  const t = await loadEpsgTable();
  assert.equal(t.count, 6983);
  assert.equal(EPSG_SOURCE.package, 'epsg-index');
  assert.equal(EPSG_SOURCE.version, '2.0.0');
  assert.equal(EPSG_SOURCE.projected + EPSG_SOURCE.geographic, 6983);
  const c = await lookupEpsg(31983);
  assert.equal(c.name, 'SIRGAS 2000 / UTM zone 23S');
  assert.equal(c.kind, 'projected');
  assert.match(c.def, /\+proj=utm \+zone=23 \+south \+ellps=GRS80/);
  assert.equal(c.units, 'metre');
  assert.equal(c.datum, 'SIRGAS 2000');
  assert.deepEqual([...c.bbox], [-48, -33.5, -42, 5.13]);   // area of use: Brazil between 48°W and 42°W
  assert.match(c.area, /Brazil - between 48°W and 42°W/);
  const w = await lookupEpsg('EPSG:4326');
  assert.equal(w.kind, 'geographic'); assert.equal(w.units, 'degree'); assert.match(w.def, /\+proj=longlat \+datum=WGS84/);
  assert.match((await lookupEpsg(29193)).def, /\+ellps=aust_SA/);
  assert.equal(await lookupEpsg(999999), null);
  assert.equal(crsLabel(c), 'SIRGAS 2000 / UTM zone 23S · EPSG:31983');
});

test('search: by code, by name words; suggestions from where the data sits', async () => {
  assert.equal((await searchCrs('31983'))[0].epsg, 31983);
  assert.equal((await searchCrs('EPSG:31983'))[0].epsg, 31983);
  assert.equal((await searchCrs('sirgas 2000 utm 23s'))[0].epsg, 31983);
  assert.ok((await searchCrs('sirgas', { kind: 'geographic' })).every((c) => c.kind === 'geographic'));
  const fits = await searchCrs('utm', { fits: [-44.2, -20.3, -43.9, -20.1] });
  assert.ok(fits.some((c) => c.epsg === 31983) && fits.every((c) => c.bbox[0] <= -44.2 && c.bbox[2] >= -43.9));
  const s = await suggestCrs([-44.2, -20.3, -43.9, -20.1]);
  assert.equal(s[0].epsg, 31983, s.map((c) => c.name).join(' | '));
  assert.equal((await suggestCrs([2.2, 48.8, 2.4, 48.9]))[0].name, 'ETRS89 / UTM zone 31N');
});

test('Transverse Mercator vs EPSG GN7-2 (OSGB example, published to the cm) and a Krüger oracle (mm)', async () => {
  // OSGB36 geographic → British National Grid: the same datum, so projection maths only
  const geo = customCrs('+proj=longlat +ellps=airy'), bng = customCrs('+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +units=m');
  const [[E, N]] = transformPoints(geo, bng, [[0.5, 50.5]]);
  assert.ok(Math.abs(E - 577274.99) < 0.01 && Math.abs(N - 69740.50) < 0.01, `${E} ${N}`);
  const [Eo, No] = tmForward(50.5, 0.5, { ...AIRY, lon0: -2, k0: 0.9996012717, E0: 400000, N0: -100000 - tmForward(49, -2, { ...AIRY, lon0: -2, k0: 0.9996012717, E0: 0, N0: 0 })[1] });
  assert.ok(Math.abs(Eo - 577274.99) < 0.01 && Math.abs(No - 69740.50) < 0.01, `oracle ${Eo} ${No}`);
  // the published figures are rounded to the cm from a series formula; the exact (Krüger) answer
  // is 577 274.984 / 69 740.492 — the library must match THAT to the millimetre
  assert.ok(Math.abs(E - Eo) < 0.001 && Math.abs(N - No) < 0.001, `library vs Krüger ${E - Eo} ${N - No}`);
  // UTM 23S on GRS80 (SIRGAS 2000): the library vs the oracle, a grid over the zone, to 1 mm
  const sirgasGeo = await lookupEpsg(4674), utm = await lookupEpsg(31983);
  let worst = 0, worstRt = 0;
  for (let lat = -33; lat <= 5; lat += 4.75) for (let lon = -48; lon <= -42; lon += 1.5) {
    const [[x, y]] = transformPoints(sirgasGeo, utm, [[lon, lat]]);
    const [xo, yo] = tmForward(lat, lon, { ...GRS80, lon0: -45, N0: 10000000 });
    worst = Math.max(worst, Math.hypot(x - xo, y - yo));
    const [[lon2, lat2]] = transformPoints(utm, sirgasGeo, [[x, y]]);
    worstRt = Math.max(worstRt, Math.hypot((lon2 - lon) * 111320 * Math.cos(lat * DEG), (lat2 - lat) * 110574));
  }
  assert.ok(worst < 0.001, `UTM vs Krüger worst ${worst} m`);
  assert.ok(worstRt < 0.001, `round trip worst ${worstRt} m`);
  // the zone's origin: (45°W, 0°) → (500 000, 10 000 000) exactly
  const [[x0, y0]] = transformPoints(sirgasGeo, utm, [[-45, 0]]);
  assert.ok(Math.abs(x0 - 500000) < 0.001 && Math.abs(y0 - 10000000) < 0.001);
  assert.equal(describePath(sirgasGeo, utm).accuracy.class, 'exact');
});

test('SAD 69 → SIRGAS 2000 by IBGE’s published parameters (R.PR 1/2005), to the mm', async () => {
  const sad = await lookupEpsg(4618), sir = await lookupEpsg(4674);
  for (const [lon, lat] of [[-44.0, -20.0], [-47.9, -15.8], [-60.0, -3.1], [-51.2, -30.0]]) {
    const [[lo, la]] = transformPoints(sad, sir, [[lon, lat]]);
    const [lao, loo] = shift3(lat, lon, AUST_SA, GRS80, IBGE_SAD69);
    const err = Math.hypot((lo - loo) * 111320 * Math.cos(lat * DEG), (la - lao) * 110574);
    assert.ok(err < 0.001, `${lon},${lat}: ${err} m`);
  }
  // projected: SAD69 / UTM 23S → SIRGAS 2000 / UTM 23S — the shift is tens of metres, as published
  const p = await transformPoints(await lookupEpsg(29193), await lookupEpsg(31983), [[612000, 7765000, 850]]);
  const [lat, lon] = (() => { const g = transformPoints(await_(29193), await_(4618), [[612000, 7765000]]); return [g[0][1], g[0][0]]; })();
  const [lao, loo] = shift3(lat, lon, AUST_SA, GRS80, IBGE_SAD69);
  const [xo, yo] = tmForward(lao, loo, { ...GRS80, lon0: -45, N0: 10000000 });
  assert.ok(Math.hypot(p[0][0] - xo, p[0][1] - yo) < 0.001, `UTM via oracle ${p[0]} vs ${xo},${yo}`);
  assert.equal(p[0][2], 850, 'heights carried unchanged');
  const moved = Math.hypot(p[0][0] - 612000, p[0][1] - 7765000);
  assert.ok(moved > 30 && moved < 80, `SAD69 → SIRGAS moves ${moved} m`);
  const path = describePath(await_(29193), await_(31983), { at: [-44, -20] });
  assert.equal(path.accuracy.class, 'metre');
  assert.match(path.text, /SAD69 → SIRGAS 2000 by 3-parameter Helmert \(-67\.35, \+3\.88, -38\.22 m, IBGE R\.PR 1\/2005/);
  // outside Brazil the table's continental default stands (−57, +1, −41; EPSG says ~19 m)
  const pc = describePath(sad, sir, { at: [-70, -40] });
  assert.match(pc.text, /-57, \+1, -41/); assert.equal(pc.accuracy.metres, 19);
});

test('Córrego Alegre → SIRGAS 2000 by IBGE’s parameters (the EPSG grid is not bundled)', async () => {
  const ca = await lookupEpsg(22523), sir = await lookupEpsg(31983);
  const g = transformPoints(ca, await lookupEpsg(4225), [[650000, 7600000]]);
  const [lao, loo] = shift3(g[0][1], g[0][0], INTL, GRS80, IBGE_CA);
  const [xo, yo] = tmForward(lao, loo, { ...GRS80, lon0: -45, N0: 10000000 });
  const [[x, y]] = transformPoints(ca, sir, [[650000, 7600000]]);
  assert.ok(Math.hypot(x - xo, y - yo) < 0.001, `${x},${y} vs ${xo},${yo}`);
  assert.match(describePath(ca, sir).text, /IBGE R\.PR 1\/2005/);
});

test('WGS 84 ↔ SIRGAS 2000 ≈ identity, said so', async () => {
  const w = await lookupEpsg(32723), s = await lookupEpsg(31983);
  const [[x, y]] = transformPoints(w, s, [[612345.678, 7765432.1]]);
  assert.ok(Math.abs(x - 612345.678) < 0.001 && Math.abs(y - 7765432.1) < 0.001);
  const p = describePath(w, s);
  assert.equal(p.accuracy.class, 'sub-metre'); assert.match(p.text, /taken as identical/);
});

test('a missing NTv2 grid never shifts silently: the path says it is unknown', async () => {
  const p = describePath(await lookupEpsg(27700), await lookupEpsg(32630));
  assert.equal(p.accuracy.class, 'unknown'); assert.match(p.text, /OSTN15_NTv2_OSGBtoETRS\.gsb/);
});

test('.prj / definitions: authority, ESRI name matching, proj4 strings, GeoKeys, URNs, JSON', async () => {
  const esriSad = 'PROJCS["SAD_1969_UTM_Zone_23S",GEOGCS["GCS_South_American_1969",DATUM["D_South_American_1969",SPHEROID["GRS_1967_Truncated",6378160.0,298.25]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
  const a = await crsFromPrj(esriSad);
  assert.equal(a.epsg, 29193); assert.equal(a.matchedBy, 'name');
  const b = await crsFromPrj('PROJCS["SIRGAS_2000_UTM_Zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]');
  assert.equal(b.epsg, 31983);
  assert.equal((await crsFromPrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')).epsg, 4326);
  const withAuth = await crsFromPrj('PROJCS["whatever",GEOGCS["x",DATUM["y",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-45],UNIT["metre",1],AUTHORITY["EPSG","31983"]]');
  assert.equal(withAuth.epsg, 31983); assert.equal(withAuth.matchedBy, 'authority');
  const custom = await crsFromDefinition('+proj=tmerc +lat_0=0 +lon_0=-44 +k=1 +x_0=150000 +y_0=0 +ellps=GRS80 +units=m');
  assert.equal(custom.epsg, null); assert.equal(custom.kind, 'projected');
  assert.equal((await crsFromDefinition('31983')).epsg, 31983);
  await assert.rejects(() => crsFromDefinition('not a crs'));
  assert.equal((await crsFromGeoKeys({ 3072: 31983 })).epsg, 31983);
  assert.equal((await crsFromGeoKeys({ 2048: 4674 })).epsg, 4674);
  assert.equal((await crsFromUrn('urn:ogc:def:crs:EPSG::31983')).epsg, 31983);
  assert.equal((await crsFromUrn('urn:ogc:def:crs:OGC:1.3:CRS84')).epsg, 4326);
  assert.equal((await crsFromJSON(crsToJSON(custom))).def, custom.def);
  assert.equal((await crsFromJSON(crsToJSON(b))).epsg, 31983);
});

test('lon/lat helpers + the world outline', async () => {
  const u = await lookupEpsg(31983);
  const [[lon, lat]] = toLonLat(u, [[500000, 10000000]]);
  assert.ok(Math.abs(lon + 45) < 1e-9 && Math.abs(lat) < 1e-9);
  const [[x]] = fromLonLat(u, [[-45, 0]]); assert.ok(Math.abs(x - 500000) < 1e-6);
  const e = extentLonLat(u, [600000, 7700000, 620000, 7720000]);
  assert.ok(e[0] > -44.1 && e[2] < -43.8 && e[1] > -20.9 && e[3] < -20.6, e.join());
  const rings = await worldRings();
  assert.equal(rings.length, 126);
  assert.ok(rings.every((r) => r.length >= 6 && r.every((v) => Math.abs(v) <= 180.01)));
});

// sync lookup helper for the test above (the table is loaded by then)
import { lookupEpsgSync } from '../ext/proj/index.js';
function await_(code) { return lookupEpsgSync(code); }
