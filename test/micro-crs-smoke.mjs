// micro smoke — COORDINATE SYSTEMS (wave 5a): the project's CRS, reprojection on read, KML / KMZ,
// lon/lat GeoJSON out, the selector, the {crs} field, and the Sealed posture.
//   §1 a GeoJSON polygon in lon/lat (no "crs" = WGS 84, RFC 7946) opens REPROJECTED into a
//      SIRGAS 2000 / UTM 23S project at the coordinates an independent Krüger oracle computes
//      here (to 1 mm); WGS 84 → SIRGAS 2000 is stated as identity; the layer + lineage carry it
//   §2 a shapefile with an ESRI SAD69 / UTM 23S .prj lands shifted by IBGE's published SAD69 →
//      SIRGAS2000 parameters (R.PR 1/2005: ΔX −67.35, ΔY +3.88, ΔZ −38.22 m), checked against an
//      oracle (UTM → geodetic → geocentric → shift → geodetic → UTM, written here), to 1 mm
//   §3 KML in (Placemarks, ExtendedData, a hole, a line) and OUT (WGS 84 lon/lat) — the round
//      trip lands where it started; GeoJSON out in lon/lat returns the input degrees; KMZ reads
//   §4 the selector finds 31983 by name and by code, shows its area of use (the details + the
//      map), suggests it from where the data sits, and sets the project's CRS; a geographic
//      file with NO project CRS is still refused, and says how to fix it
//   §5 {crs} / {crs:code} / {crs:name} render through compo's fields with micro's env
//   §6 Sealed: nothing but the page's own origin was requested; the built file's CSP is
//      connect-src 'none' (and the project.json round trip keeps the CRS)
// Run: node test/micro-crs-smoke.mjs (the dev tree) · --built (micro.html). MICRO_CHROMIUM_ARGS honoured.
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { writeShapefile } from '../ext/shp/index.js';
import { createZipStreamWriter } from '../ext/archive/src/zipstream.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-crs-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── oracles (independent of proj4) ──
const DEG = Math.PI / 180;
function tm(latDeg, lonDeg, { a, rf, lon0 = -45, k0 = 0.9996, E0 = 500000, N0 = 10000000 }) {
  const f = 1 / rf, n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const al = [0, n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600, 34729 * n5 / 80640 - 3418889 * n6 / 1995840, 212378941 * n6 / 319334400];
  const e = 2 * Math.sqrt(n) / (1 + n), phi = latDeg * DEG, lam = (lonDeg - lon0) * DEG;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(lam)), eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) { xi += al[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1); eta += al[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1); }
  return [E0 + k0 * A * eta, N0 + k0 * A * xi];
}
const toEcef = (lat, lon, a, rf) => { const f = 1 / rf, e2 = f * (2 - f), p = lat * DEG, l = lon * DEG, N = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2); return [N * Math.cos(p) * Math.cos(l), N * Math.cos(p) * Math.sin(l), N * (1 - e2) * Math.sin(p)]; };
const fromEcef = ([X, Y, Z], a, rf) => { const f = 1 / rf, e2 = f * (2 - f), p = Math.hypot(X, Y); let lat = Math.atan2(Z, p * (1 - e2)); for (let i = 0; i < 10; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(Z + e2 * N * Math.sin(lat), p); } return [lat / DEG, Math.atan2(Y, X) / DEG]; };
const GRS80 = { a: 6378137, rf: 298.257222101 }, AUST_SA = { a: 6378160, rf: 298.25 };
const IBGE = [-67.35, 3.88, -38.22];

// §1 fixture: a pentagon near Belo Horizonte, lon/lat (WGS 84), z 850
const LL = [[-43.95, -19.92], [-43.93, -19.921], [-43.925, -19.905], [-43.94, -19.898], [-43.955, -19.91]];
const UTM_EXPECT = LL.map(([lon, lat]) => tm(lat, lon, GRS80));      // WGS 84 ≡ SIRGAS 2000 (identity)
const GEOJSON = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'pit' }, geometry: { type: 'Polygon', coordinates: [[...LL, LL[0]].map(([x, y]) => [x, y, 850])] } }] });
// §2 fixture: SAD69 / UTM 23S coordinates made from SAD69 lat/lon (oracle TM on the SAD69 ellipsoid)
const SADLL = [[-44.01, -20.01], [-43.99, -20.012], [-43.995, -19.995]];
const SADUTM = SADLL.map(([lon, lat]) => tm(lat, lon, AUST_SA));
const SAD_EXPECT = SADLL.map(([lon, lat]) => { const [X, Y, Z] = toEcef(lat, lon, AUST_SA.a, AUST_SA.rf); const [la, lo] = fromEcef([X + IBGE[0], Y + IBGE[1], Z + IBGE[2]], GRS80.a, GRS80.rf); return tm(la, lo, GRS80); });
const SAD_PRJ = 'PROJCS["SAD_1969_UTM_Zone_23S",GEOGCS["GCS_South_American_1969",DATUM["D_South_American_1969",SPHEROID["GRS_1967_Truncated",6378160.0,298.25]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const shp = writeShapefile([{ geometry: { type: 'Polygon', coordinates: [[...SADUTM, SADUTM[0]].map(([x, y]) => [x, y])] }, properties: { NAME: 'lease' } }], { prj: SAD_PRJ });
// §3 fixture: KML — a polygon with a hole and ExtendedData, a line, in a Folder
const KLL = [[-43.96, -19.93], [-43.92, -19.93], [-43.92, -19.89], [-43.96, -19.89]];
const KHOLE = [[-43.95, -19.92], [-43.93, -19.92], [-43.93, -19.90], [-43.95, -19.90]];
const ring = (r) => [...r, r[0]].map(([x, y]) => `${x},${y},0`).join(' ');
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>field</name><Folder><name>leases</name>
<Placemark><name>Lavra Norte</name><ExtendedData><Data name="owner"><value>São João &amp; Cia</value></Data><Data name="area_ha"><value>12.5</value></Data></ExtendedData>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(KLL)}</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>${ring(KHOLE)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
<Placemark><name>acesso</name><LineString><coordinates>-43.97,-19.94,0 -43.95,-19.925,0 -43.94,-19.91,0</coordinates></LineString></Placemark>
</Folder></Document></kml>`;

const KMZ = await (async () => {
  const chunks = []; const w = createZipStreamWriter({ write: (bb) => { chunks.push(Buffer.from(bb)); } });
  await w.add('doc.kml', new TextEncoder().encode(KML), { aligned: false, mtime: Date.now() }); await w.finish();
  return [...Buffer.concat(chunks)];
})();

// §2b fixture: a LAS 1.2 point cloud (format 0) in SAD69 / UTM 23S, said by a GeoKeyDirectory VLR
// (LASF_Projection 34735, ProjectedCSTypeGeoKey 3072 = 29193) — three points at the SAD69 coordinates
function lasOf(pts, epsg) {
  const hs = 227, vlrLen = 8 + 8, pointOffset = hs + 54 + vlrLen, n = pts.length;
  const buf = new ArrayBuffer(pointOffset + 20 * n), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([0x4C, 0x41, 0x53, 0x46], 0); dv.setUint8(24, 1); dv.setUint8(25, 2);
  dv.setUint16(94, hs, true); dv.setUint32(96, pointOffset, true); dv.setUint32(100, 1, true);
  dv.setUint8(104, 0); dv.setUint16(105, 20, true); dv.setUint32(107, n, true);
  const sc = 0.001, off = [Math.floor(pts[0][0]), Math.floor(pts[0][1]), 0];
  [sc, sc, sc].forEach((v, i) => dv.setFloat64(131 + 8 * i, v, true)); off.forEach((v, i) => dv.setFloat64(155 + 8 * i, v, true));
  for (let a = 0; a < 3; a++) { const vs = pts.map((p) => p[a]); dv.setFloat64(179 + 16 * a, Math.max(...vs), true); dv.setFloat64(187 + 16 * a, Math.min(...vs), true); }
  let o = hs; u8.set(new TextEncoder().encode('LASF_Projection'), o + 2); dv.setUint16(o + 18, 34735, true); dv.setUint16(o + 20, vlrLen, true);
  o += 54; [1, 1, 0, 1, 3072, 0, 1, epsg].forEach((v, i) => dv.setUint16(o + 2 * i, v, true));
  pts.forEach((p, i) => { const r = pointOffset + 20 * i; for (let a = 0; a < 3; a++) dv.setInt32(r + 4 * a, Math.round((p[a] - off[a]) / sc), true); });
  return [...u8];
}
const LAS = lasOf(SADUTM.map(([x, y], i) => [x, y, 800 + i]), 29193);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch({ args: [...(process.env.MICRO_CHROMIUM_ARGS || '--use-gl=angle').split(/\s+/).filter(Boolean)] });
await installSmokeWaits(b);
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const foreign = [];

try {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  p.on('request', (r) => { const u = r.url(); if (!/^(blob:|data:|about:)/.test(u) && !u.startsWith(`http://127.0.0.1:${PORT}/`)) foreign.push(u); });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer && window._microCrs && window._microCrsUi, null, { timeout: 30000 });

  // ═══ §1 GeoJSON lon/lat → a UTM project ═══
  const r1 = await evaluateSettled(p, async ({ GEOJSON }) => {
    const M = window._micro, C = window._microCrs;
    try { M.setAutoOptimize('off'); M.setAutoPack('off'); } catch { /* older builds */ }
    const chip0 = document.getElementById('crsChip') && document.getElementById('crsChip').textContent;
    await C.setProjectCrs(await C.lookupEpsg(31983));
    const id = await M.openBlob(new File([GEOJSON], 'pit_wgs84.geojson'), 'pit_wgs84.geojson', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    const f = M.featuresOf(L)[0];
    const src = L.docs.stringsDoc.source;
    return { chip0, chip: document.getElementById('crsChip').textContent, ring: f.rings[0].map((q) => q.slice()), rp: src.reprojected, fileCrs: src.fileCrs, lin: L.lineage && L.lineage.params && L.lineage.params.reproject, meta: document.querySelector('#meta').textContent };
  }, { GEOJSON });
  const err1 = Math.max(...r1.ring.map((q, i) => Math.hypot(q[0] - UTM_EXPECT[i][0], q[1] - UTM_EXPECT[i][1])));
  chk(`the status chip says "${r1.chip0}" then "${r1.chip}"`, r1.chip0 === 'no CRS' && r1.chip === 'EPSG:31983');
  chk(`a lon/lat GeoJSON opens reprojected into SIRGAS 2000 / UTM 23S at the Krüger oracle's coordinates (worst ${(err1 * 1000).toFixed(3)} mm), z 850 kept`, err1 < 0.001 && r1.ring.every((q) => q[2] === 850) && r1.ring.length === 5);
  chk(`the layer records how: ${r1.rp && r1.rp.from} → ${r1.rp && r1.rp.to}, "${r1.rp && r1.rp.accuracy.class}" (WGS 84 ≡ SIRGAS 2000, stated), file CRS EPSG:${r1.fileCrs && r1.fileCrs.epsg}`, r1.rp && r1.rp.accuracy.class === 'sub-metre' && /taken as identical/.test(r1.rp.path) && r1.fileCrs.epsg === 4326 && /RFC 7946/.test(r1.rp.by));
  chk('… and so does its lineage (params.reproject)', r1.lin && r1.lin.to === 'SIRGAS 2000 / UTM zone 23S · EPSG:31983');

  // ═══ §2 a shapefile with a SAD69 .prj ═══
  const r2 = await evaluateSettled(p, async ({ shpB, dbfB, prj }) => {
    const M = window._micro;
    const n0 = M.layers().length;
    const id = await M.openBlob(new File([new Uint8Array(shpB)], 'lease.shp'), 'lease.shp', 'add', null, { throw: true, shpParts: { dbf: new File([new Uint8Array(dbfB)], 'lease.dbf'), prj: new File([prj], 'lease.prj') } });
    const L = M.layers().find((x) => x.id === id);
    const src = L.docs.stringsDoc.source;
    return { added: M.layers().length - n0, ring: M.featuresOf(L)[0].rings[0].map((q) => q.slice()), rp: src.reprojected, fileCrs: src.fileCrs, by: src.fileCrsBy, name: M.featuresOf(L)[0].attrs.NAME };
  }, { shpB: [...shp.shp], dbfB: [...shp.dbf], prj: shp.prj });
  // a shapefile ring is written clockwise (the format's rule), so match each vertex to its nearest
  const nearestTo = (e) => r2.ring.reduce((m, q) => Math.min(m, Math.hypot(q[0] - e[0], q[1] - e[1])), Infinity);
  const err2 = Math.max(...SAD_EXPECT.map(nearestTo));
  const landed0 = r2.ring.reduce((m, q) => (Math.hypot(q[0] - SAD_EXPECT[0][0], q[1] - SAD_EXPECT[0][1]) < Math.hypot(m[0] - SAD_EXPECT[0][0], m[1] - SAD_EXPECT[0][1]) ? q : m), r2.ring[0]);
  const moved = Math.hypot(landed0[0] - SADUTM[0][0], landed0[1] - SADUTM[0][1]);   // how far the vertex moved from its SAD69 coordinates
  chk(`the ESRI .prj is recognised as EPSG:${r2.fileCrs && r2.fileCrs.epsg} (${r2.by})`, r2.fileCrs && r2.fileCrs.epsg === 29193 && /name/.test(r2.by) && r2.name === 'lease');
  chk(`SAD69 → SIRGAS 2000 by IBGE's parameters: vertices land on the oracle (worst ${(err2 * 1000).toFixed(3)} mm), moved ${moved.toFixed(2)} m`, err2 < 0.001 && moved > 30 && moved < 80);
  chk(`the path is stated: "${r2.rp && r2.rp.path}"`, r2.rp && r2.rp.accuracy.class === 'metre' && /IBGE R\.PR 1\/2005/.test(r2.rp.path) && /-67\.35, \+3\.88, -38\.22/.test(r2.rp.path) && /1–5 m/.test(r2.rp.path));

  // ═══ §2c the reprojected layer exported as a shapefile carries a .prj of the system it is in NOW ═══
  const r2c = await evaluateSettled(p, async () => {
    const M = window._micro, C = window._microCrs;
    const L = M.layers().find((x) => x.docs.stringsDoc && x.docs.stringsDoc.source.fileCrs && x.docs.stringsDoc.source.fileCrs.epsg === 29193);
    const before = M.featuresOf(L)[0].rings[0].map((q) => q.slice());
    const out = await M.buildFeatureExport(L, 'shp', { projectCrs: C.projectCrs() });
    const id = await M.openBlob(new File([out.blob], out.name), out.name, 'add', null, { throw: true });
    const B = M.layers().find((x) => x.id === id);
    const src = B.docs.stringsDoc.source;
    return { note: out.note, from: out.prjFrom, prj: src.prj, fileCrs: src.fileCrs, rp: !!src.reprojected, before, after: M.featuresOf(B)[0].rings[0].map((q) => q.slice()) };
  });
  const errC = Math.max(...r2c.before.map((e) => r2c.after.reduce((m, q) => Math.min(m, Math.hypot(q[0] - e[0], q[1] - e[1])), Infinity)));
  chk(`shapefile out of the reprojected layer: a .prj written for the project's system (${r2c.note}) — read back as EPSG:${r2c.fileCrs && r2c.fileCrs.epsg}, not reprojected again, vertices where they were (worst ${(errC * 1000).toFixed(3)} mm)`,
    r2c.from === 'written' && /^PROJCS\["SIRGAS_2000_UTM_zone_23S"/.test(r2c.prj || '') && /AUTHORITY\["EPSG","31983"\]\]$/.test(r2c.prj || '') && r2c.fileCrs && r2c.fileCrs.epsg === 31983 && !r2c.rp && errC < 0.001);

  // ═══ §2b a LAS cloud in SAD69 (a GeoKeys VLR) ═══
  const r2b = await evaluateSettled(p, async ({ LAS }) => {
    const M = window._micro;
    const id = await M.openBlob(new File([new Uint8Array(LAS)], 'cloud_sad69.las'), 'cloud_sad69.las', 'add', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    const h = L.docs.lasDoc.header;
    const rows = []; for (let i = 0; i < 3; i++) rows.push(await M.fetchLayerRow(L, i));
    const stream = []; for await (const c of L.docs.lasDoc.streamChunks()) for (let i = 0; i < c.count; i++) stream.push([c.x[i], c.y[i], c.z[i]]);
    return { crsName: h.crsName, rp: h.reprojected, bbox: h.bbox, rows: rows.map((r) => r.slice(0, 3)), stream, lin: L.lineage && L.lineage.params && L.lineage.params.reproject };
  }, { LAS });
  const errL = Math.max(...SAD_EXPECT.map((e, i) => Math.max(Math.hypot(r2b.stream[i][0] - e[0], r2b.stream[i][1] - e[1]), Math.hypot(r2b.rows[i][0] - e[0], r2b.rows[i][1] - e[1]))));
  chk(`a LAS cloud whose VLR says ${r2b.crsName}: its points (streamed and read one by one) land on the IBGE oracle (worst ${(errL * 1000).toFixed(2)} mm), z kept, the bbox moved with them`,
    /29193/.test(r2b.crsName || '') && errL < 0.002 && r2b.stream.every((q, i) => Math.abs(q[2] - (800 + i)) < 1e-6) && Math.abs(r2b.bbox.min[0] - Math.min(...SAD_EXPECT.map((e) => e[0]))) < 0.01 && r2b.rp && /IBGE/.test(r2b.rp.path) && r2b.lin);

  // ═══ §3 KML in / out, GeoJSON out in lon/lat, KMZ ═══
  const r3 = await evaluateSettled(p, async ({ KML, KMZ }) => {
    const M = window._micro, C = window._microCrs;
    const id = await M.openBlob(new File([KML], 'field.kml'), 'field.kml', 'add', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    const feats = M.featuresOf(L).map((f) => ({ kind: f.kind, rings: f.rings.map((r) => r.map((q) => q.slice())), attrs: f.attrs }));
    const out = await M.buildFeatureExport(L, 'kml', { projectCrs: C.projectCrs() });
    const kmlText = await out.blob.text();
    const id2 = await M.openBlob(new File([kmlText], 'roundtrip.kml'), 'roundtrip.kml', 'add', null, { throw: true });
    const L2 = M.layers().find((x) => x.id === id2);
    const back = M.featuresOf(L2).map((f) => f.rings.map((r) => r.map((q) => q.slice())));
    const gj = JSON.parse(await (await M.buildFeatureExport(L, 'geojson-wgs84', { projectCrs: C.projectCrs() })).blob.text());
    // a KMZ: the same KML zipped (made in node)
    const id3 = await M.openBlob(new File([new Uint8Array(KMZ)], 'field.kmz'), 'field.kmz', 'add', null, { throw: true });
    const L3 = M.layers().find((x) => x.id === id3);
    return { feats, kmlName: out.name, kmlHasData: /<Data name="owner"><value>São João &amp; Cia<\/value><\/Data>/.test(kmlText), back, gj, kmz: M.featuresOf(L3).length, src: L.docs.stringsDoc.source.fileCrsBy };
  }, { KML, KMZ });
  const poly = r3.feats.find((f) => f.kind !== 'line'), line = r3.feats.find((f) => f.kind === 'line');
  const kExp = KLL.map(([lon, lat]) => tm(lat, lon, GRS80));
  const errK = Math.max(...kExp.map((e, i) => Math.hypot(poly.rings[0][i][0] - e[0], poly.rings[0][i][1] - e[1])));
  chk(`KML in: a polygon with its hole + a line, attributes from ExtendedData + the Folder (${r3.src}), at the oracle's UTM (worst ${(errK * 1000).toFixed(3)} mm)`,
    poly && line && poly.rings.length === 2 && poly.attrs.owner === 'São João & Cia' && +poly.attrs.area_ha === 12.5 && poly.attrs.folder === 'leases' && poly.attrs.name === 'Lavra Norte' && errK < 0.001 && /KML/.test(r3.src));
  const errRT = Math.max(...r3.back.flatMap((f, i) => f.flatMap((rr, j) => rr.map((q, k) => Math.hypot(q[0] - r3.feats[i].rings[j][k][0], q[1] - r3.feats[i].rings[j][k][1])))));
  chk(`KML out (${r3.kmlName}, WGS 84 lon/lat, ExtendedData kept) → read back: the round trip lands where it started (worst ${(errRT * 1000).toFixed(3)} mm)`, r3.kmlHasData && r3.back.length === 2 && errRT < 0.001);
  const gpoly = r3.gj.features.find((f) => f.geometry.type === 'Polygon');
  const errG = Math.max(...KLL.map((ll, i) => Math.hypot(gpoly.geometry.coordinates[0][i][0] - ll[0], gpoly.geometry.coordinates[0][i][1] - ll[1])));
  chk(`GeoJSON out in lon/lat: no "crs" member (RFC 7946), the input degrees back (worst ${errG.toExponential(1)}°)`, !r3.gj.crs && errG < 1e-8);
  chk(`KMZ (a zipped doc.kml) reads the same ${r3.kmz} features`, r3.kmz === 2);

  // ═══ §4 the selector ═══
  await p.evaluate(() => { window.__pick = window._microCrsUi.openCrsPicker({ title: 'project coordinate system', purpose: 'project', fits: [-43.97, -19.94, -43.92, -19.89] }); window.__pick.then((c) => { window.__picked = c; }); });
  await p.waitForSelector('[data-crs-suggest]', { timeout: 30000 });
  const sugg = await p.$$eval('[data-crs-suggest]', (bs) => bs.map((x) => x.dataset.crsSuggest));
  await p.fill('[data-crs-search]', 'SIRGAS 2000 / UTM zone 23S');
  await p.waitForFunction(() => { const r = document.querySelector('[data-crs-list] [data-code]'); return r && r.dataset.code === '31983'; }, null, { timeout: 15000 });
  await p.click('[data-crs-list] [data-code="31983"]');
  const det = await p.textContent('[data-crs-details]');
  const mapInk = await p.evaluate(() => { const c = document.querySelector('[data-crs-map]'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let land = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 7) { n++; if (d[i] !== d[0] || d[i + 1] !== d[1]) land++; } return land / n; });
  await p.waitForTimeout(150);
  await p.screenshot({ path: 'experiments/micro-crs-picker.png' });
  await p.fill('[data-crs-search]', '31983');
  await p.waitForFunction(() => { const r = document.querySelector('[data-crs-list] [data-code]'); return r && r.dataset.code === '31983'; }, null, { timeout: 15000 });
  await p.click('[data-crs-list] [data-code="31983"]');
  await p.click('[data-crs-ok]');
  await p.waitForFunction(() => window.__picked !== undefined, null, { timeout: 10000 });
  const picked = await p.evaluate(() => window.__picked && window.__picked.epsg);
  chk(`the selector suggests 31983 first from where the data sits (${sugg.slice(0, 3).join(', ')})`, sugg[0] === '31983');
  chk('… finds it by name, shows its area of use (Brazil 48°W–42°W) and its definition; the map is drawn', /Brazil - between 48°W and 42°W/.test(det) && /\+proj=utm \+zone=23 \+south/.test(det) && /inside its area of use/.test(det) && mapInk > 0.05);
  chk(`… finds it by code, and "Use this system" returns EPSG:${picked}`, picked === 31983);
  const r4 = await evaluateSettled(p, async () => {
    const M = window._micro, C = window._microCrs;
    await C.setProjectCrs(null);
    let msg = '';
    try { await M.openBlob(new File(['NAME,WKT\na,"POLYGON ((-45.1 -20.1, -45.0 -20.1, -45.0 -20.0, -45.1 -20.1))"\n'], 'lonlat.csv'), 'lonlat.csv', 'add', null, { throw: true }); msg = 'opened'; } catch (e) { msg = e.message; }
    await C.setProjectCrs(await C.lookupEpsg(31983));
    return msg;
  });
  chk('with NO project CRS a lon/lat file is still refused — and the message says how to fix it', /longitude\/latitude/.test(r4) && /Set the project's coordinate system/.test(r4));

  // ═══ §5 {crs} ═══
  const r5 = await evaluateSettled(p, async ({ BUILT }) => {
    const Cm = await import(BUILT ? '#compo' : '/ext/compo/index.js');
    return Cm.resolveFields('{crs} | {crs:code} | {crs:name}', window._micro.composerEnv());
  }, { BUILT });
  chk(`{crs} renders: "${r5}"`, r5 === 'SIRGAS 2000 / UTM zone 23S · EPSG:31983 | EPSG:31983 | SIRGAS 2000 / UTM zone 23S');

  // ═══ §6 project.json keeps it; Sealed ═══
  const proj = 'crs_proj_' + Date.now();
  await p.evaluate(async (pr) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(pr, { create: true }); window.showDirectoryPicker = async () => dir; window._micro.saveProjectAs(); }, proj);
  await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  const r6 = await evaluateSettled(p, async ({ proj }) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(proj);
    const M = window._micro, C = window._microCrs;
    const mf = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    await C.setProjectCrs(null);
    await M.openProjectDir(dir);
    return { mf: mf.crs, after: C.projectCrs() && C.projectCrs().epsg, layers: M.layers().length, first: (() => { const L = M.layers().find((x) => /pit_wgs84/.test(x.name)); return L ? M.featuresOf(L)[0].rings[0][0].slice() : null; })() };
  }, { proj });
  chk(`project.json carries the CRS (${JSON.stringify(r6.mf)}) and a reopen restores it — the lon/lat layer re-reprojects to the same place`, r6.mf && r6.mf.epsg === 31983 && r6.after === 31983 && r6.first && Math.hypot(r6.first[0] - UTM_EXPECT[0][0], r6.first[1] - UTM_EXPECT[0][1]) < 0.001);
  chk(`Sealed: no request left the page's origin (${foreign.length ? foreign.slice(0, 3).join(', ') : 'none'})`, foreign.length === 0);
  if (BUILT) {
    const html = readFileSync('micro.html', 'utf8');
    const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html) || [])[1] || '';
    chk(`the built file still declares connect-src 'none' (${csp.slice(0, 60)}…)`, /connect-src 'none'/.test(csp));
  }
  await p.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
