// micro smoke — STRINGS & POLYGONS AS DATA (wave 4a): the feature layer kind, its readers,
// writers, the QGIS clipboard, the CRS refusal, drawing / editing, and the project round trip.
//   §1 readers — a CSV string file (ID + X/Y/Z, closed → polygon), a WKT file (a polygon with a
//      hole + a line), a WKT-CSV table, a shapefile (loose .shp/.dbf/.prj/.cpg through the open
//      dialog, and zipped), GeoJSON with a projected "crs": feature counts, attributes, vertices
//   §2 the CRS rule — a GeoJSON without "crs" in lon/lat, a shapefile with a GEOGCS .prj and a
//      lon/lat WKT-CSV are REFUSED with the reason; nothing is placed
//   §3 the layer — records are features: the attribute table header, the filter (a mask by
//      feature), colour by a numeric column, the fill toggle; the API (pointInPolygonXY with a
//      hole, preparePolygons == the brute force over many points)
//   §4 export → reopen for WKT-CSV, GeoJSON, Shapefile (.zip) and DXF: same features, attributes
//      and coordinates
//   §5 the QGIS clipboard — copy (tab, wkt_geom first) → paste (a new layer, a declared z for 2D);
//      a real paste event over the view
//   §6 draw a polygon by synthetic clicks in plan, name + attributes; edit a vertex by dragging
//      its handle; undo; save the project (polygons/ folder) and reopen it
// Fixtures are generated here (the shapefiles by @gcu/shp in node). Every expected value is
// worked out from the fixture, not read back from micro.
// Run: node test/micro-polygons-smoke.mjs (the dev tree) · --built (micro.html).
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { writeShapefile } from '../ext/shp/src/main.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-polygons-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── fixtures (UTM-sized, a pit at RL 850) ──
const E0 = 612000, N0 = 7765000;
const sq = (x, y, s, z) => [[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y + s, z], [x, y, z]];
const PIT = sq(E0, N0, 100, 850), HOLE = sq(E0 + 40, N0 + 40, 20, 850);
const CSV_STRINGS = ['STRING,X,Y,Z,CODE',
  ...PIT.map((p) => `1,${p[0]},${p[1]},${p[2]},PIT`),
  `2,${E0 + 200},${N0},840,ROAD`, `2,${E0 + 250},${N0 + 30},841,ROAD`, `2,${E0 + 300},${N0 + 30},842,ROAD`].join('\n') + '\n';
const ring = (r) => '(' + r.map((p) => p.join(' ')).join(', ') + ')';
const WKT_TEXT = `POLYGON Z (${ring(PIT)}, ${ring(HOLE)})\nLINESTRING Z (${E0} ${N0 - 50} 830, ${E0 + 100} ${N0 - 50} 830)\n`;
const WKT_CSV = ['NAME,GRADE,WKT',
  `"pit, north",1.5,"POLYGON Z (${ring(PIT)})"`,
  `lease,0.2,"POLYGON ((${E0 - 500} ${N0 - 500}, ${E0 + 500} ${N0 - 500}, ${E0 + 500} ${N0 + 500}, ${E0 - 500} ${N0 + 500}, ${E0 - 500} ${N0 - 500}))"`,
  `trace,,"LINESTRING Z (${E0} ${N0} 850, ${E0 + 10} ${N0 + 10} 851)"`].join('\n') + '\n';
const UTM_PRJ = 'PROJCS["SIRGAS 2000 / UTM zone 23S",GEOGCS["SIRGAS 2000",DATUM["SIRGAS_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-45],UNIT["metre",1],AUTHORITY["EPSG","31983"]]';
const GEO_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const shpOut = writeShapefile([
  { geometry: { type: 'Polygon', coordinates: [PIT, HOLE] }, properties: { NAME: 'pit A', BENCH: 850, AREA_HA: 0.96 } },
  { geometry: { type: 'MultiPolygon', coordinates: [[sq(E0 + 300, N0, 50, 840)], [sq(E0 + 400, N0, 50, 840)]] }, properties: { NAME: 'São João', BENCH: 840, AREA_HA: 0.5 } },
], { prj: UTM_PRJ });
const geoShp = writeShapefile([{ geometry: { type: 'Polygon', coordinates: [[[-45.1, -20.1], [-45.0, -20.1], [-45.0, -20.0], [-45.1, -20.1]]] }, properties: { N: 1 } }], { prj: GEO_PRJ });
const b64 = (u8) => Buffer.from(u8).toString('base64');
const GEOJSON = JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::31983' } }, features: [
  { type: 'Feature', id: 7, properties: { zone: 'ox', dip: 35 }, geometry: { type: 'Polygon', coordinates: [PIT.map((p) => [p[0], p[1], 900])] } },
  { type: 'Feature', properties: { zone: 'fresh', dip: 40 }, geometry: { type: 'MultiLineString', coordinates: [[[E0, N0, 900], [E0 + 5, N0 + 5, 901]], [[E0 + 20, N0, 900], [E0 + 30, N0, 900]]] } },
  { type: 'Feature', properties: { zone: 'pt', dip: 0 }, geometry: { type: 'Point', coordinates: [E0, N0, 900] } },
] });
const GEOJSON_LONLAT = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-45.1, -20.1], [-45.0, -20.1], [-45.0, -20.0], [-45.1, -20.1]]] } }] });
const FX = {
  csv: CSV_STRINGS, wkt: WKT_TEXT, wktcsv: WKT_CSV, geojson: GEOJSON, lonlat: GEOJSON_LONLAT,
  shp: b64(shpOut.shp), dbf: b64(shpOut.dbf), prj: UTM_PRJ, cpg: shpOut.cpg,
  gshp: b64(geoShp.shp), gdbf: b64(geoShp.dbf), gprj: GEO_PRJ,
};

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
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const mkPage = async (proj = null) => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  await p.evaluate(({ fx, proj }) => {
    const u8 = (s) => { const bin = atob(s), o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
    window.__fx = { ...fx, shpB: u8(fx.shp), dbfB: u8(fx.dbf), gshpB: u8(fx.gshp), gdbfB: u8(fx.gdbf) };
    try { window._micro.setAutoOptimize('off'); window._micro.setAutoPack('off'); } catch { /* older builds */ }
    if (proj) window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(proj, { create: true });
  }, { fx: FX, proj });
  return p;
};
// a layer's features as plain data (the API 4b consumes)
const FEATS = `(L) => window._micro.featuresOf(L).map((f) => ({ id: f.id, kind: f.kind, closed: f.closed, rings: f.rings.map((r) => r.map((p) => p.slice())), parts: f.parts, attrs: f.attrs }))`;

try {
  // ═══ §1 readers ═══
  const p = await mkPage();
  const r1 = await p.evaluate(async (FEATS) => {
    const M = window._micro, fx = window.__fx, feats = eval(FEATS), out = {};
    const open = async (data, name, mode = 'add', over = {}) => { const id = await M.openBlob(new File([data], name), name, mode, null, over); return M.layers().find((L) => L.id === id); };
    const Lc = await open(fx.csv, 'pit_strings.csv', 'replace');
    out.csv = { poly: M.isPolygonLayer(Lc), loc: M.primaryLocationOf(Lc), count: M.attrRowCountOf(Lc), f: feats(Lc), cols: Lc.docs.stringsDoc.header.columns };
    const Lw = await open(fx.wkt, 'limits.wkt');
    out.wkt = { f: feats(Lw) };
    const Lt = await open(fx.wktcsv, 'qgis.csv');
    out.wktcsv = { f: feats(Lt), cols: Lt.docs.stringsDoc.header.columns, num: Lt.docs.stringsDoc.header.numericColumns.map((c) => c.name) };
    const Lg = await open(fx.geojson, 'zones.geojson');
    out.geojson = { f: feats(Lg), crs: Lg.docs.stringsDoc.header.crs, meta: document.querySelector('#meta').textContent };
    // the shapefile, loose, through the open dialog (four rows → one layer)
    const before = M.layers().length;
    await M.openFilesDialog([new File([fx.shpB], 'pits.shp'), new File([fx.dbfB], 'pits.dbf'), new File([fx.prj], 'pits.prj'), new File([fx.cpg], 'pits.cpg')]);
    out.dlg = [...document.querySelectorAll('#ofDlgBody *')].map((e) => e.textContent).join(' ').includes('Shapefile');
    document.querySelector('#ofOpen').click();
    await new Promise((r) => { const t = setInterval(() => { if (M.layers().length > before) { clearInterval(t); r(); } }, 50); });
    await new Promise((r) => setTimeout(r, 300));
    const Ls = M.layers()[M.layers().length - 1];
    out.shp = { name: Ls.name, label: Ls.label, f: feats(Ls), crs: Ls.docs.stringsDoc.header.crs, n: M.layers().length - before };
    // zipped: the same set inside a .zip (the one-file form a project keeps)
    const zipped = await M.buildFeatureExport(Ls, 'shp');
    const Lz = await open(zipped.blob, 'pits_zipped.zip');
    out.zip = { f: feats(Lz) };
    return out;
  }, FEATS);
  const near = (a, b2, t = 1e-3) => Math.abs(a - b2) <= t;
  chk(`CSV string file → features: 2 records (location "features"), polygon closed (4 vertices, no repeat) + a line of 3`, r1.csv.poly && r1.csv.loc === 'features' && r1.csv.count === 2 && r1.csv.f[0].closed && r1.csv.f[0].rings[0].length === 4 && r1.csv.f[1].kind === 'line' && r1.csv.f[1].rings[0].length === 3);
  chk(`CSV strings: attributes STRING + CODE per feature, vertex 0 = (${E0}, ${N0}, 850)`, JSON.stringify(r1.csv.cols) === '["STRING","CODE"]' && r1.csv.f[0].attrs.CODE === 'PIT' && r1.csv.f[1].attrs.CODE === 'ROAD' && near(r1.csv.f[0].rings[0][0][0], E0) && near(r1.csv.f[0].rings[0][0][2], 850));
  chk('WKT file: a polygon with a hole (2 rings, 1 part) + a line', r1.wkt.f.length === 2 && r1.wkt.f[0].rings.length === 2 && JSON.stringify(r1.wkt.f[0].parts) === '[[0,1]]' && r1.wkt.f[1].kind === 'line');
  chk('WKT-CSV: 3 features, a quoted name with a comma, GRADE numeric, a 2D polygon at z 0', r1.wktcsv.f.length === 3 && r1.wktcsv.f[0].attrs.NAME === 'pit, north' && r1.wktcsv.num.includes('GRADE') && r1.wktcsv.f[0].attrs.GRADE === 1.5 && r1.wktcsv.f[1].rings[0][0][2] === 0 && JSON.stringify(r1.wktcsv.cols) === '["NAME","GRADE"]');
  chk(`GeoJSON (crs EPSG:31983): a polygon + a 2-part line, the point skipped, z 900`, r1.geojson.f.length === 2 && r1.geojson.f[1].rings.length === 2 && near(r1.geojson.f[0].rings[0][0][2], 900) && r1.geojson.crs && r1.geojson.crs.epsg === 31983 && /point/.test(r1.geojson.meta));
  chk(`shapefile, loose through the open dialog: ONE layer (${r1.shp.name}, label ${r1.shp.label}), 2 features`, r1.dlg && r1.shp.n === 1 && r1.shp.f.length === 2 && /\.zip$/.test(r1.shp.name) && r1.shp.label === 'pits.shp');
  chk('shapefile: the hole is kept, the multipolygon is one feature of 2 parts, UTF-8 names, numbers', r1.shp.f[0].rings.length === 2 && r1.shp.f[1].parts.length === 2 && r1.shp.f[1].attrs.NAME === 'São João' && r1.shp.f[0].attrs.BENCH === 850 && r1.shp.f[0].attrs.AREA_HA === 0.96);
  chk(`shapefile: the .prj read (projected, EPSG ${r1.shp.crs && r1.shp.crs.epsg}); zipped it reads the same`, r1.shp.crs && r1.shp.crs.kind === 'projected' && r1.shp.crs.epsg === 31983 && JSON.stringify(r1.zip.f.map((f) => f.rings)) === JSON.stringify(r1.shp.f.map((f) => f.rings)));

  // ═══ §2 the CRS rule ═══
  const r2 = await p.evaluate(async () => {
    const M = window._micro, fx = window.__fx, n0 = M.layers().length, out = {};
    const tryOpen = async (data, name) => { try { await M.openBlob(new File([data], name), name, 'add', null, { throw: true }); return 'opened'; } catch (e) { return e.message; } };
    out.geojson = await tryOpen(fx.lonlat, 'wgs84.geojson');
    out.prj = await (async () => {
      await M.openFilesDialog([new File([fx.gshpB], 'geo.shp'), new File([fx.gdbfB], 'geo.dbf'), new File([fx.gprj], 'geo.prj')]);
      const desc = document.querySelector('#ofDlgBody').textContent;
      document.querySelector('#ofOpen').click();
      await new Promise((r) => setTimeout(r, 800));
      return desc + ' || ' + document.querySelector('#meta').textContent;
    })();
    out.wktcsv = await tryOpen('NAME,WKT\na,"POLYGON ((-45.1 -20.1, -45.0 -20.1, -45.0 -20.0, -45.1 -20.1))"\n', 'lonlat.csv');
    out.added = M.layers().length - n0;
    return out;
  });
  chk('a GeoJSON without "crs" in lon/lat is refused — the reason names longitude/latitude and reprojection', /longitude\/latitude/.test(r2.geojson) && /reproject/i.test(r2.geojson) && /RFC 7946/.test(r2.geojson));
  chk('a shapefile with a GEOGCS .prj is refused (the dialog says so; nothing opens)', /geographic/.test(r2.prj));
  chk('a lon/lat WKT-CSV is refused; no layer was placed by any of the three', /longitude\/latitude/.test(r2.wktcsv) && r2.added === 0);

  // ═══ §3 the layer + the API ═══
  const r3 = await p.evaluate(async (FEATS) => {
    const M = window._micro, out = {};
    const Lt = M.layers().find((L) => L.name === 'qgis.csv'), Ls = M.layers().find((L) => L.label === 'pits.shp');
    M.setActiveLayer(Lt.id);
    out.attr = M.attrColumnsOf(Lt).map((c) => c.name);
    out.row1 = await M.fetchLayerRow(Lt, 1);
    await M.applyBlockFilter('GRADE > 1', Lt);
    out.mask = Array.from(Lt._filterMask || []); out.fmeta = document.querySelector('#meta').textContent;
    await M.applyBlockFilter('', Lt);
    out.cleared = Lt._filterMask == null;
    const id = await M.setLayerColorSel(Lt, 'chan:1');
    out.color = { id, sel: Lt.colorSel, tex: !!Lt._valTex };
    M.setFeatureFill(Ls, true);
    out.fill = { on: Ls.polyFill, vram: M.renderer ? 0 : 0 };
    out.menu = (() => { const walk = (items) => items.flatMap((it) => [it.label, ...(Array.isArray(it.submenu) ? walk(it.submenu) : typeof it.submenu === 'function' ? walk(it.submenu()) : [])]); return walk(M.layerMenuSections(Ls, 100, 100)).filter(Boolean); })();
    // pointInPolygonXY with a hole; prepared == brute force
    const f = M.featuresOf(Ls)[0];
    out.pip = [M.pointInPolygonXY(f, 612010, 7765010), M.pointInPolygonXY(f, 612050, 7765050), M.pointInPolygonXY(f, 612150, 7765050)];
    const all = M.featuresOf(Ls), P = M.preparePolygons(all);
    let s = 9, agree = 0, inside = 0; const N = 20000, xs = new Float64Array(N), ys = new Float64Array(N);
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) { xs[i] = 611950 + rnd() * 600; ys[i] = 7764950 + rnd() * 200; }
    const mask = P.mask(xs, ys, N);
    for (let i = 0; i < N; i++) { const bf = all.some((q) => M.pointInPolygonXY(q, xs[i], ys[i])); if (!!mask[i] === bf) agree++; if (bf) inside++; }
    out.prep = { agree, N, inside, area: all.map((q) => M.polygonAreaXY(q)) };
    // a vector section: a plan slab at RL 850 ± 2 keeps pit A (lines + its fill, the hole open), not the 840 pits
    const vs = window._microVis.sectionFeatures(Ls, { normal: [0, 0, 1], position: 850, thickness: 4, clip: 'slab' }, [612000, 7765000, 850]);
    out.vs = vs.map((l) => [l.type, l.starts.length]);
    return out;
  }, FEATS);
  chk(`the attribute table sees the feature columns (${r3.attr.join(', ')}); row 1 = lease, 0.2`, r3.attr.join() === 'NAME,GRADE' && r3.row1[0] === 'lease' && r3.row1[1] === 0.2);
  chk(`filter GRADE > 1 → a FEATURE mask [${r3.mask}] (1 of 3 features)`, r3.mask.join() === '1,0,0' && /1 of 3 features/.test(r3.fmeta) && r3.cleared);
  chk('colour by a numeric column draws from the per-feature value texture', r3.color.sel === 'chan:1' && r3.color.tex);
  chk('fill toggles on; the layer menu offers fill, classes, edit vertices, draw, set elevation, export, copy', r3.fill.on && ['Fill polygons', 'Edit vertices', 'Draw polygon into this layer', 'Set elevation…', 'Export features…', 'Copy features (WKT, for QGIS)'].every((l) => r3.menu.some((m) => m.replace(/^✓ /, '') === l)) && r3.menu.some((m) => /^Classes by/.test(m)));
  chk('pointInPolygonXY: inside the ring → true, inside the HOLE → false, outside → false', JSON.stringify(r3.pip) === '[true,false,false]');
  chk(`preparePolygons agrees with the brute force on ${r3.prep.agree}/${r3.prep.N} random points (${r3.prep.inside} inside); areas ${r3.prep.area}`, r3.prep.agree === r3.prep.N && r3.prep.inside > 1000 && near(r3.prep.area[0], 10000 - 400) && near(r3.prep.area[1], 5000));

  chk(`vector section (plan, RL 850 ± 2): pit A as 8 fill triangles (hole open) + 2 outlines (ring + hole); the 840 pits left out — ${JSON.stringify(r3.vs)}`, JSON.stringify(r3.vs) === '[["polys",8],["lines",2]]');

  // ═══ §4 export → reopen ═══
  const r4 = await p.evaluate(async (FEATS) => {
    const M = window._micro, feats = eval(FEATS), out = {};
    const Ls = M.layers().find((L) => L.label === 'pits.shp');
    const src = feats(Ls);
    for (const fmt of ['wkt-csv', 'geojson', 'shp', 'dxf']) {
      const ex = await M.buildFeatureExport(Ls, fmt);
      const id = await M.openBlob(new File([ex.blob], ex.name), ex.name, 'add', null, fmt === 'dxf' ? { asKind: 'features' } : {});
      const L = M.layers().find((q) => q.id === id);
      const back = feats(L);
      // the same rings (vertex for vertex, to 0.1 mm) and the same attributes
      const ringsOk = back.length === src.length && back.every((f, i) => {
        const a = f.rings.flat(), bb = src[i].rings.flat();
        return a.length === bb.length && a.every((pt, k) => Math.abs(pt[0] - bb[k][0]) < 1e-4 && Math.abs(pt[1] - bb[k][1]) < 1e-4 && Math.abs(pt[2] - bb[k][2]) < 1e-4);
      });
      const attrsOk = back.every((f, i) => ['NAME', 'BENCH'].every((c) => String(f.attrs[c]) === String(src[i].attrs[c])));
      out[fmt] = { name: ex.name, size: ex.blob.size, n: back.length, ringsOk, attrsOk, parts: back.map((f) => f.parts.length) };
    }
    return out;
  }, FEATS);
  for (const fmt of ['wkt-csv', 'geojson', 'shp', 'dxf']) {
    const e = r4[fmt];
    chk(`export ${fmt} (${e.name}, ${e.size} B) → reopen: ${e.n} features, rings vertex for vertex, NAME/BENCH kept, parts ${e.parts}`, e.n === 2 && e.ringsOk && e.attrsOk && e.parts.join() === '1,2');
  }

  // ═══ §5 the QGIS clipboard ═══
  const r5 = await p.evaluate(async (FEATS) => {
    const M = window._micro, feats = eval(FEATS), out = {};
    const Lt = M.layers().find((L) => L.name === 'qgis.csv');
    const text = M.copyFeaturesText(Lt);
    out.head = text.split('\n')[0]; out.first = text.split('\n')[1];
    const n0 = M.layers().length;
    const Lp = await M.pasteFeaturesText(text, { z: 700 });
    out.paste = { n: M.layers().length - n0, f: feats(Lp), name: Lp.label || Lp.name, mem: Lp.memoryOnly };
    // a QGIS-shaped 2D copy (PolygonZ spelled QGIS's way too), through a real paste event over the view
    const q = 'wkt_geom\tid\tname\nPolygon ((612000 7765000, 612010 7765000, 612010 7765010, 612000 7765000))\t1\tdigitised\nLineStringZ (612000 7765000 5, 612020 7765020 6)\t2\troad\n';
    const dt = new DataTransfer(); dt.setData('text/plain', q);
    const n1 = M.layers().length;
    document.querySelector('#cv').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    for (let i = 0; i < 50 && !document.querySelector('#pmDlg').classList.contains('show'); i++) await new Promise((r) => setTimeout(r, 40));
    out.asked = document.querySelector('#pmTitle').textContent;
    document.querySelector('#pmInput').value = '812.5'; document.querySelector('#pmOk').click();
    for (let i = 0; i < 50 && M.layers().length === n1; i++) await new Promise((r) => setTimeout(r, 40));
    const Lq = M.layers()[M.layers().length - 1];
    out.event = { n: M.layers().length - n1, f: feats(Lq) };
    return out;
  }, FEATS);
  chk(`copy: tab-separated, wkt_geom first (“${r5.head.replace(/\t/g, '⇥')}”), the WKT unquoted`, r5.head === 'wkt_geom\tNAME\tGRADE' && /^POLYGON Z \(\(/.test(r5.first) && r5.first.split('\t').length === 3);
  chk(`paste → a new in-memory layer (“${r5.paste.name}”): 3 features, attributes and vertices equal the source (the 2D one kept its z 0 — it carries one now)`, r5.paste.n === 1 && r5.paste.f.length === 3 && r5.paste.f[0].attrs.NAME === 'pit, north' && r5.paste.f[1].rings[0][0][2] === 0 && r5.paste.mem === true && r5.paste.f[0].rings[0][0][2] === 850 && r5.paste.f[2].kind === 'line');
  chk(`a real paste event over the view: the 2D feature asks for a z (“${r5.asked}”), then lands at it; the QGIS LineStringZ keeps its own`, r5.event.n === 1 && /no Z/.test(r5.asked) && r5.event.f.length === 2 && r5.event.f[0].rings[0][0][2] === 812.5 && r5.event.f[1].kind === 'line' && r5.event.f[1].attrs.name === 'road' && r5.event.f[1].rings[0][0][2] === 5);
  await p.close();

  // ═══ §6 draw, edit, save, reopen ═══
  const proj = 'polysmoke-' + (BUILT ? 'built' : 'dev');
  const clean = await mkPage();
  await clean.evaluate(async (pr) => { try { await (await navigator.storage.getDirectory()).removeEntry(pr, { recursive: true }); } catch { /* fresh */ } }, proj);
  await clean.close();
  const q = await mkPage(proj);
  await q.evaluate(async () => {
    const M = window._micro;
    await M.openBlob(new File([window.__fx.csv], 'pit_strings.csv'), 'pit_strings.csv', 'replace');
    window.micro.look('plan'); window.micro.fit();
  });
  await q.waitForTimeout(400);
  const box = await q.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const clicks = [[0.35, 0.35], [0.6, 0.35], [0.6, 0.62], [0.35, 0.62]].map(([fx, fy]) => [Math.round(box.w * fx), Math.round(box.h * fy)]);
  await q.evaluate(() => window._micro.armDraw({ closed: true }));
  for (const [cx, cy] of clicks) await q.mouse.click(box.x + cx, box.y + cy, { modifiers: ['Alt'] });   // Alt: no snapping — exactly where clicked
  await q.keyboard.press('Enter');
  await q.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'));
  await q.fill('#pmInput', 'blast 12'); await q.click('#pmOk');
  await q.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show') && /attributes/.test(document.querySelector('#pmTitle').textContent));
  await q.fill('#pmInput', 'bench=850, code=B12'); await q.click('#pmOk');
  await q.waitForFunction(() => window._micro.layers().some((L) => L.label && /drawn polygons/.test(L.label)));
  const r6 = await q.evaluate(async ({ clicks, FEATS }) => {
    const M = window._micro, feats = eval(FEATS);
    const L = M.layers().find((x) => /drawn polygons/.test(x.label || ''));
    const want = clicks.map(([x, y]) => M.worldAt(x, y, M.polyDraw.z));
    M.disarmPoly(true);
    return { f: feats(L), want, name: L.name, z: M.polyDraw.z, mem: L.memoryOnly };
  }, { clicks, FEATS });
  const dv = r6.f[0] && r6.f[0].rings[0];
  chk(`draw: 4 synthetic clicks + Enter → “blast 12” (bench 850, code B12) in a new layer ${r6.name}`, r6.f.length === 1 && r6.f[0].closed && dv.length === 4 && r6.f[0].attrs.NAME === 'blast 12' && r6.f[0].attrs.bench === 850 && r6.f[0].attrs.code === 'B12' && /\.csv$/.test(r6.name) && r6.mem);
  chk('draw: each vertex is where its click meets the drawing plane (to 1 mm)', dv && dv.every((p, i) => Math.hypot(p[0] - r6.want[i][0], p[1] - r6.want[i][1]) < 1e-3 && Math.abs(p[2] - r6.z) < 1e-6));
  // edit: drag vertex 2's handle
  await q.evaluate(() => { const M = window._micro; M.armEditVertices(M.layers().find((x) => /drawn polygons/.test(x.label || ''))); });
  await q.waitForTimeout(300);
  const handle = await q.evaluate(() => { const rs = [...document.querySelectorAll('#polySvg rect')]; const r = rs[2]; return r ? [+r.getAttribute('x') + 4, +r.getAttribute('y') + 4, rs.length] : null; });
  const to = [handle[0] + 60, handle[1] + 40];
  await q.mouse.move(box.x + handle[0], box.y + handle[1]); await q.mouse.down({ button: 'left' });
  await q.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 }); await q.keyboard.down('Alt'); await q.mouse.move(box.x + to[0], box.y + to[1]); await q.mouse.up(); await q.keyboard.up('Alt');
  const r7 = await q.evaluate(({ to, FEATS }) => {
    const M = window._micro, feats = eval(FEATS), L = M.layers().find((x) => /drawn polygons/.test(x.label || ''));
    const f = feats(L)[0], want = M.worldAt(to[0], to[1], f.rings[0][2][2]);
    return { v: f.rings[0][2], want, n: f.rings[0].length, undo: M.undoLabel() };
  }, { to, FEATS });
  chk(`edit: ${handle[2]} vertex handles; dragging vertex 2 moves it to the drop point (${r7.v.map((v) => v.toFixed(2))}), one undo step “${r7.undo}”`, handle[2] === 4 && Math.hypot(r7.v[0] - r7.want[0], r7.v[1] - r7.want[1]) < 0.05 && r7.n === 4 && r7.undo === 'move vertex');
  const r8 = await q.evaluate(async (FEATS) => {
    const M = window._micro, feats = eval(FEATS), L = M.layers().find((x) => /drawn polygons/.test(x.label || ''));
    const before = feats(L)[0].rings[0][2].slice();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const undone = feats(L)[0].rings[0][2].slice();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    M.disarmPoly(true);
    return { before, undone, redone: feats(L)[0].rings[0][2].slice() };
  }, FEATS);
  chk('undo puts the vertex back; redo moves it again', Math.hypot(r8.undone[0] - r8.before[0], r8.undone[1] - r8.before[1]) > 0.5 && Math.hypot(r8.redone[0] - r8.before[0], r8.redone[1] - r8.before[1]) < 1e-6);
  // save the project → polygons/*.csv; reopen it
  const saved = await q.evaluate(async (FEATS) => { const M = window._micro, feats = eval(FEATS); return M.layers().map((L) => [L.label || L.name, feats(L)]); }, FEATS);
  q.evaluate(() => window._micro.saveProjectAs());
  await q.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await q.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await q.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  const files = await q.evaluate(async (pr) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(pr);
    const out = []; for await (const k of (await dir.getDirectoryHandle('polygons')).keys()) out.push(k);
    const pj = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    return { files: out.sort(), man: pj.layers.map((l) => [l.source, l.kind]) };
  }, proj);
  chk(`save: polygons/ holds ${files.files.join(', ')}; project.json names them kind “polygons”`, files.files.filter((f) => /\.csv$/.test(f)).length === 2 && files.man.every((m) => /^polygons\//.test(m[0]) && m[1] === 'polygons'));
  await q.close();
  const q2 = await mkPage(proj);
  await q2.evaluate(async (pr) => { await window._micro.openProjectDir(await (await navigator.storage.getDirectory()).getDirectoryHandle(pr)); }, proj);
  await q2.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers().every((L) => window._micro.isPolygonLayer(L)), null, { timeout: 60000 });
  const re = await q2.evaluate(async (FEATS) => { const M = window._micro, feats = eval(FEATS); return M.layers().map((L) => [L.label || L.name, feats(L)]); }, FEATS);
  const same = (a, b2) => a.length === b2.length && a.every((f, i) => f.attrs.NAME === b2[i].attrs.NAME && f.rings.flat().every((pt, k) => { const o = b2[i].rings.flat()[k]; return o && Math.hypot(pt[0] - o[0], pt[1] - o[1], pt[2] - o[2]) < 1e-3; }));
  const drawnA = saved.find((s) => /drawn/.test(s[0])), drawnB = re.find((s) => /drawn/.test(s[0]) || /drawn/.test(s[0]));
  chk(`reopen: both layers come back as strings & polygons; the drawn polygon (edited) vertex for vertex with its attributes`, re.length === 2 && drawnB && same(drawnB[1], drawnA[1]) && drawnB[1][0].attrs.code === 'B12');
  await q2.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
