// micro smoke — PLACEMENTS (wave 5b): a layer's rigid placement (a 3D similarity) applied at read,
// set three ways, and ROTATED GRIDS. Every expected number is computed HERE, independently of the
// app (its own rotation, its own fixtures):
//   §1 a block model placed by TYPED parameters (κ 30°, a shift to UTM): its records, its picks and
//      its block lattice are in the new place; a solid built where the PLACED model is selects the
//      blocks whose placed centroids it holds, and GT over that selection weighs them; a scale of 2
//      multiplies every block's volume by 8 (boxes stay boxes, the pitch scales)
//   §2 a mesh placed from CONTROL POINTS through the window (pasted pairs): four pairs of a known
//      7-parameter similarity fit it with residuals ≈ 0; a blunder (1 m) shows as the biggest
//      residual, coloured red; dropping it restores the exact fit and still lists its 1 m; applied,
//      the mesh's vertices are where the truth puts them; a click on the layer reads back the local
//      point under the cursor
//   §3 a mesh placed by a CRS CHANGE (SAD69 / UTM 23S → SIRGAS 2000 / UTM 23S): the max deviation is
//      reported (mm), and every vertex lands on the true reprojection within it
//   §4 a ROTATED GeoTIFF (ModelTransformation, 30°) opens rotated; selecting by it gives what its
//      unrotated twin gives to the same points taken into the grid's frame; its exports keep the
//      rotation (GeoTIFF + world file round trip) or refuse it with the reason (ESRI ASCII)
//   §5 the Datamine origin is a placement now: an OLD project (dmOrigin on the layer) opens in place
// Run: node test/micro-placement-smoke.mjs (dev tree) · --built (micro.html). MICRO_CHROMIUM_ARGS honoured.
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { writeGeoTiff } from '../ext/gtiff/index.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-placement-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── the smoke's own similarity (ω-φ-κ, R = Rz·Ry·Rx, counter-clockwise; world = t + s·R·local) ──
const D = Math.PI / 180;
function sim({ tx = 0, ty = 0, tz = 0, omega = 0, phi = 0, kappa = 0, scale = 1 }) {
  const a = omega * D, b = phi * D, c = kappa * D, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const R = [[cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa], [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa], [-sb, cb * sa, cb * ca]];
  return (p) => [0, 1, 2].map((r) => [tx, ty, tz][r] + scale * (R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// §1 fixture: a regular 10 × 8 × 4 model, 10 × 10 × 5 blocks
const NX = 10, NY = 8, NZ = 4, BLK = [];
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) BLK.push({ i, j, k, x: 1005 + 10 * i, y: 2005 + 10 * j, z: 102.5 + 5 * k, g: +(0.5 + 0.1 * i + 0.05 * j + 0.02 * k).toFixed(3) });
const CSV = 'X,Y,Z,GRADE\n' + BLK.map((b) => `${b.x},${b.y},${b.z},${b.g}`).join('\n') + '\n';
const P1 = { tx: 500000, ty: 7700000, tz: 600, omega: 0, phi: 0, kappa: 30, scale: 1 }, F1 = sim(P1);
const PLACED = BLK.map((b) => F1([b.x, b.y, b.z]));
// a solid where the PLACED model is: an axis-aligned world box over part of it
const cx = PLACED.map((p) => p[0]), cy = PLACED.map((p) => p[1]);
const BOX = [Math.min(...cx) + 25, Math.min(...cy) + 25, 0, Math.min(...cx) + 75, Math.min(...cy) + 65, 2000];
const INSIDE = PLACED.filter((p) => p[0] > BOX[0] && p[0] < BOX[3] && p[1] > BOX[1] && p[1] < BOX[4]).length;
const boxObj = ([x0, y0, z0, x1, y1, z1]) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]];
  return v.map((q) => `v ${q.join(' ')}`).join('\n') + '\n' + f.map((t) => `f ${t.join(' ')}`).join('\n') + '\n';
};
// §2 fixture: a bumpy 6 × 6 surface in a photogrammetry-style local frame
const MV = [];
for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) MV.push([i * 20, j * 20, 100 + 6 * Math.sin(i) * Math.cos(j)]);
const MT = [];
for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const a = j * 6 + i + 1; MT.push([a, a + 1, a + 7], [a, a + 7, a + 6]); }
const OBJ2 = MV.map((q) => `v ${q.join(' ')}`).join('\n') + '\n' + MT.map((t) => `f ${t.join(' ')}`).join('\n') + '\n';
const P2 = { tx: 512000, ty: 7712000, tz: 850, omega: 2, phi: -1.5, kappa: 41, scale: 1.0003 }, F2 = sim(P2);
const GCP = [0, 5, 30, 35].map((k) => ({ from: MV[k], to: F2(MV[k]) }));
const PASTE = GCP.map((q) => [...q.from, ...q.to].map((v) => +v.toFixed(6)).join('\t')).join('\n');
const BAD = { from: MV[14], to: F2(MV[14]).map((v, a) => v + (a === 0 ? 1 : 0)) };
// §3 fixture: a small mesh in SAD69 / UTM 23S coordinates near Belo Horizonte, 2 km across
const SADV = [[608000, 7795000, 900], [610000, 7795000, 920], [610000, 7797000, 880], [608000, 7797000, 940], [609000, 7796000, 1000]];
const OBJ3 = SADV.map((q) => `v ${q.join(' ')}`).join('\n') + '\nf 1 2 5\nf 2 3 5\nf 3 4 5\nf 4 1 5\n';
// §4 fixture: a 40 × 30 grid, f(u, v) on its own lattice; once rotated 30° to UTM, once unrotated at 0, 0
const GN = [40, 30], GD = 5, TH = 30, CORNER = [600000, 7700000];
const fz = (u, v) => 500 + 0.3 * u - 0.2 * v + 8 * Math.sin(u / 23) * Math.cos(v / 17);
const gdata = new Float32Array(GN[0] * GN[1]);
for (let r = 0; r < GN[1]; r++) for (let c = 0; c < GN[0]; c++) gdata[r * GN[0] + c] = fz(GD / 2 + c * GD, -GD / 2 - r * GD);
const th = TH * D, AFF = [GD * Math.cos(th), GD * Math.sin(th), CORNER[0], GD * Math.sin(th), -GD * Math.cos(th), CORNER[1]];
const TIF_ROT = [...await writeGeoTiff({ nx: GN[0], ny: GN[1], data: gdata, x0: 0, y0: 0, dx: GD, dy: GD, nodata: -9999 }, { transform: AFF, compression: 'none' })];
const TIF_TWIN = [...await writeGeoTiff({ nx: GN[0], ny: GN[1], data: gdata, x0: GD / 2, y0: -GD / 2, dx: GD, dy: GD, nodata: -9999 }, { compression: 'none' })];
// points over the grid: in its own frame (the twin's), and the same points in world (the rotated one's)
const toW = (u, v, z) => [CORNER[0] + Math.cos(th) * u - Math.sin(th) * v, CORNER[1] + Math.sin(th) * u + Math.cos(th) * v, z];
const PTS_L = [];
for (let k = 0; k < 400; k++) { const u = 8 + ((k * 37) % 180), v = -8 - ((k * 53) % 130), z = 470 + ((k * 29) % 70); PTS_L.push([u, v, z]); }
const csvOf = (pts) => 'X,Y,Z,V\n' + pts.map((p, i) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(3)},${i}`).join('\n') + '\n';
const PTS_CSV_L = csvOf(PTS_L), PTS_CSV_W = csvOf(PTS_L.map((p) => toW(...p)));
const BELOW = PTS_L.filter((p) => p[2] < fz(p[0], p[1])).length;   // roughly: the bilinear surface differs from f by a little

// §1b fixture: a LAS 1.2 cloud (format 0, no CRS) — three points in the model's frame
function lasOf(pts) {
  const hs = 227, pointOffset = hs, n = pts.length, buf = new ArrayBuffer(pointOffset + 20 * n), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8.set([0x4C, 0x41, 0x53, 0x46], 0); dv.setUint8(24, 1); dv.setUint8(25, 2);
  dv.setUint16(94, hs, true); dv.setUint32(96, pointOffset, true); dv.setUint32(100, 0, true);
  dv.setUint8(104, 0); dv.setUint16(105, 20, true); dv.setUint32(107, n, true);
  const sc = 0.001, off = [1000, 2000, 0];
  [sc, sc, sc].forEach((v, i) => dv.setFloat64(131 + 8 * i, v, true)); off.forEach((v, i) => dv.setFloat64(155 + 8 * i, v, true));
  for (let a = 0; a < 3; a++) { const vs = pts.map((q) => q[a]); dv.setFloat64(179 + 16 * a, Math.max(...vs), true); dv.setFloat64(187 + 16 * a, Math.min(...vs), true); }
  pts.forEach((q, i) => { const r = pointOffset + 20 * i; for (let a = 0; a < 3; a++) dv.setInt32(r + 4 * a, Math.round((q[a] - off[a]) / sc), true); });
  return [...u8];
}
const LASPTS = [[1010.5, 2020.25, 110], [1050, 2040.75, 120.5], [1090.125, 2070, 130.25]], LASF = lasOf(LASPTS);

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
const mkPage = async () => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._microPlacement && window._microCrs, null, { timeout: 30000 });
  await p.evaluate(() => { try { window._micro.setAutoOptimize('off'); window._micro.setAutoPack('off'); } catch { /* older builds */ } });
  return p;
};

try {
  // ═══ §1 a block model placed by typed parameters ═══
  const p = await mkPage();
  const r1 = await evaluateSettled(p, async ({ CSV, P1, BOX, boxText, recs }) => {
    const M = window._micro, PL = window._microPlacement, R = M.renderer;
    const id = await M.openBlob(new File([CSV], 'model.csv'), 'model.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    const before = (await M.fetchLayerRow(L, recs[0])).slice(0, 3);
    await PL.setLayerPlacement(L, { ...P1, source: 'typed' });
    const L1 = M.layers().find((x) => x.id === id), h = L1.docs.blockDoc.header;
    const rows = [], picks = [];
    for (const r of recs) { rows.push((await M.fetchLayerRow(L1, r)).slice(0, 3).map(Number)); picks.push(await M.pick({ layer: id, rec: r })); }
    // the solid where the placed model is → select → GT over the selection
    const sid = await M.openBlob(new File([boxText], 'box.obj'), 'box.obj', 'add', null, { throw: true });
    const SL = M.layers().find((x) => x.id === sid);
    await M.selectBySolid(SL, { targets: [L1] });
    const L2 = M.layers().find((x) => x.id === id);
    const gt = await M.computeGT(L2, ['GRADE'], null, 4, null, L2._selMask);
    const gtAll = await M.computeGT(L2, ['GRADE'], null, 4, null, null);
    // all records through layerRecords (the analyses' path) agree with the single fetches
    let n = 0, worstRow = 0; const want = {};
    recs.forEach((r, k) => { want[r] = rows[k]; });
    for await (const { f, rec } of M.layerRecords(L2)) { n++; if (want[rec]) worstRow = Math.max(worstRow, Math.hypot(+f[0] - want[rec][0], +f[1] - want[rec][1], +f[2] - want[rec][2])); }
    // a scale of 2: every block's volume × 8
    await PL.setLayerPlacement(L2, { ...P1, scale: 2, source: 'typed' });
    const L3 = M.layers().find((x) => x.id === id);
    const gt2 = await M.computeGT(L3, ['GRADE'], null, 4, null, null);
    const h3 = L3.docs.blockDoc.header;
    return { before, rows, picks, sel: L2._selCount, kind: L1.kind, rot: !!(h.grid && h.grid.rot), pitch: h.grid && h.grid.x.pitch, pitch2: h3.grid && h3.grid.x.pitch, elements: R.layerElementCount(id), lin: L1.lineage && L1.lineage.params && L1.lineage.params.placement, n, worstRow,
      gtKeys: gt && Object.keys(gt), gt, gtAll, gt2, propsLine: (() => { M.setActiveLayer(id); M.setPropTab('source'); M.openProps(); const el = document.querySelector('[data-placement-line]'); return el ? el.textContent : null; })() };
  }, { CSV, P1, BOX, boxText: boxObj(BOX), recs: [0, 37, 211, BLK.length - 1] });
  const rowErr = Math.max(...r1.rows.map((q, k) => dist(q, PLACED[[0, 37, 211, BLK.length - 1][k]])));
  const pickErr = Math.max(...r1.picks.map((q, k) => dist(q, PLACED[[0, 37, 211, BLK.length - 1][k]])));
  chk(`typed placement (κ 30°, shift to UTM): the records read where the smoke's own similarity puts them (worst ${(rowErr * 1000).toFixed(3)} mm; before: ${r1.before.join(', ')})`, rowErr < 1e-3 && Math.abs(r1.before[0] - BLK[0].x) < 1e-9);
  chk(`… the picks too (worst ${(pickErr * 1000).toFixed(3)} mm), and every record through layerRecords agrees (${r1.n} rows)`, pickErr < 1e-3 && r1.n === BLK.length && r1.worstRow < 1e-3);
  chk(`boxes stay boxes: ${r1.kind}, a ROTATED lattice of pitch ${r1.pitch}, every block drawn (${r1.elements}); lineage carries the placement (${r1.lin && r1.lin.source})`, r1.kind === 'blocks' && r1.rot && Math.abs(r1.pitch - 10) < 1e-9 && r1.elements === BLK.length && r1.lin && r1.lin.kappa === 30);
  const gtVol = (g) => (g && g.gt && g.gt[0] && g.gt[0][0] ? g.gt[0][0].tonnage : null);   // the lowest cut: every block in scope
  chk(`a solid built where the PLACED model sits selects the blocks it holds: ${r1.sel} = ${INSIDE} computed here`, r1.sel === INSIDE && INSIDE > 10);
  chk(`GT over that selection weighs ${INSIDE} blocks × 500 m³ (${gtVol(r1.gt)}), the whole model ${BLK.length} × 500 (${gtVol(r1.gtAll)})`, Math.abs(gtVol(r1.gt) - INSIDE * 500) < 1e-6 && Math.abs(gtVol(r1.gtAll) - BLK.length * 500) < 1e-6);
  chk(`a scale of 2: the pitch doubles (${r1.pitch2}) and the model weighs 8× (${gtVol(r1.gt2)} = ${BLK.length * 4000})`, Math.abs(r1.pitch2 - 20) < 1e-9 && Math.abs(gtVol(r1.gt2) - BLK.length * 4000) < 1e-6);
  chk(`the layer's properties say where it is (“${(r1.propsLine || '').slice(0, 70)}…”)`, /typed/.test(r1.propsLine || '') && /κ 30°/.test(r1.propsLine || ''));
  await p.close();
  const p1b = await mkPage();

  // ═══ §1b the same placement on the other sources: a delimited model's filter (the column engine on the
  // worker pool), a Parquet model's rows + filter, a LAS cloud's points ═══
  const thr = [...PLACED.map((q) => q[0])].sort((a, z) => a - z)[200];
  const WANT_X = PLACED.filter((q) => q[0] > thr).length;
  const r1b = await evaluateSettled(p1b, async ({ CSV, P1, thr, LAS }) => {
    const M = window._micro, PL = window._microPlacement, out = {};
    const id = await M.openBlob(new File([CSV], 'model.csv'), 'model.csv', 'replace', null, { throw: true });
    await PL.setLayerPlacement(M.layers().find((x) => x.id === id), { ...P1, source: 'typed' });
    let L = M.layers().find((x) => x.id === id);
    await M.applyBlockFilter(`X > ${thr}`, L);
    out.csvFilter = (() => { const m = M.layers().find((x) => x.id === id)._filterMask; return m ? m.reduce((a, v) => a + (v ? 1 : 0), 0) : -1; })();
    await M.applyBlockFilter('', L);
    // Parquet: the same model stored as Parquet (unplaced), then placed
    await PL.setLayerPlacement(L, null);
    L = M.layers().find((x) => x.id === id);
    await M.convertLayerToParquet(L, {});
    L = M.layers().find((x) => x.id === id);
    out.pq = !!L.docs.blockDoc.parquet;
    await PL.setLayerPlacement(L, { ...P1, source: 'typed' });
    L = M.layers().find((x) => x.id === id);
    out.pqRows = []; for (let r = 0; r < 320; r += 79) out.pqRows.push((await M.fetchLayerRow(L, r)).slice(0, 4).map(Number));
    await M.applyBlockFilter(`X > ${thr}`, L);
    out.pqFilter = (() => { const m = M.layers().find((x) => x.id === id)._filterMask; return m ? m.reduce((a, v) => a + (v ? 1 : 0), 0) : -1; })();
    out.pqPlace = !!L.docs.blockDoc.parquet.place;
    // a LAS cloud
    const lid = await M.openBlob(new File([new Uint8Array(LAS)], 'cloud.las'), 'cloud.las', 'add', null, { throw: true });
    await PL.setLayerPlacement(M.layers().find((x) => x.id === lid), { ...P1, source: 'typed' });
    const LL = M.layers().find((x) => x.id === lid);
    out.las = []; for (let i = 0; i < 3; i++) out.las.push((await M.fetchLayerRow(LL, i)).slice(0, 3));
    out.lasStream = []; for await (const c of LL.docs.lasDoc.streamChunks()) for (let i = 0; i < c.count; i++) out.lasStream.push([c.x[i], c.y[i], c.z[i]]);
    return out;
  }, { CSV, P1, thr, LAS: LASF });
  chk(`a delimited model's filter on a placed coordinate (X > ${thr.toFixed(1)}) keeps the blocks whose PLACED X passes: ${r1b.csvFilter} = ${WANT_X}`, r1b.csvFilter === WANT_X);
  // Parquet rows come back in the MORTON order the store wrote: match each to its block by grade + placed position
  const pqOk = r1b.pqRows.every((q) => PLACED.some((w, k) => dist(q, w) < 1e-6 && Math.abs(q[3] - BLK[k].g) < 1e-9));
  chk(`a Parquet model placed: its rows read in world (each = a block's placed centroid: ${pqOk}), its filter keeps ${r1b.pqFilter} = ${WANT_X}`, r1b.pq && r1b.pqPlace && pqOk && r1b.pqFilter === WANT_X);
  const lasErr = Math.max(...LASPTS.map((q, i) => Math.max(dist(F1(q), r1b.las[i].map(Number)), dist(F1(q), r1b.lasStream[i]))));
  chk(`a LAS cloud placed: its points streamed and read one by one in world (worst ${(lasErr * 1000).toFixed(2)} mm)`, lasErr < 2e-3);
  await p1b.close();

  // ═══ §2 a mesh placed from control points, through the window ═══
  const p2 = await mkPage();
  await evaluateSettled(p2, async ({ OBJ2 }) => {
    const M = window._micro;
    window.__mid = await M.openBlob(new File([OBJ2], 'outcrop.obj'), 'outcrop.obj', 'replace', null, { throw: true });
    window.__st = window._microPlacement.openPlacementDialog(M.layers().find((x) => x.id === window.__mid), { tab: 'gcp' });
  }, { OBJ2 });
  await p2.fill('[data-placement-paste]', PASTE);
  await p2.click('text=add pasted');
  const g1 = await p2.evaluate(() => ({ fit: document.querySelector('[data-placement-fit]').textContent, cls: document.querySelector('[data-placement-fit]').dataset.cls, res: [...document.querySelectorAll('[data-pair-res]')].map((e) => ({ t: e.textContent, cls: e.dataset.cls })), max: window.__st.fit && window.__st.fit.max, mode: window.__st.fit && window.__st.fit.mode }));
  chk(`four pasted pairs of a known 7-parameter similarity: a ${g1.mode} fit, residuals ≈ 0 (max ${g1.max && g1.max.toExponential(2)} m, all green: ${g1.res.map((r) => r.cls).join(',')})`, g1.mode === '3d' && g1.max < 1e-5 && g1.res.length === 4 && g1.res.every((r) => r.cls === 'ok'));
  await p2.evaluate(({ BAD }) => { window.__st.pairs.push({ from: BAD.from, to: BAD.to, use: true }); window.__st.renderPairs(); window.__st.refit(); }, { BAD });
  const g2 = await p2.evaluate(() => ({ res: window.__st.fit.residuals.map((r) => r.d), cls: [...document.querySelectorAll('[data-pair-res]')].map((e) => e.dataset.cls) }));
  const worstI = g2.res.indexOf(Math.max(...g2.res));
  chk(`a blunder (1 m off) has the biggest residual (${g2.res[4].toFixed(3)} m), coloured red`, worstI === 4 && g2.res[4] > 0.4 && g2.cls[4] === 'bad');
  await p2.click('[data-pair-use="4"]');
  const g3 = await p2.evaluate(() => ({ max: window.__st.fit.max, dropped: window.__st.fit.residuals[4], text: document.querySelector('[data-pair-res="4"]').textContent }));
  chk(`dropping it: the fit is exact again (max ${g3.max.toExponential(2)} m) and the dropped pair still says how far off it is (“${g3.text}”)`, g3.max < 1e-5 && Math.abs(g3.dropped.d - 1) < 1e-4 && /dropped/.test(g3.text));
  await p2.click('text=apply fit');
  await p2.waitForFunction(() => { const L = window._micro.layers().find((x) => x.id === window.__mid); return L && L.placement && L.placement.source === 'gcp' && L.docs.meshDoc && L.docs.meshDoc.placeM; }, null, { timeout: 30000 });
  const g4 = await evaluateSettled(p2, async () => {
    const M = window._micro, L = M.layers().find((x) => x.id === window.__mid);
    const v = (await M.meshVertexData(L)).vertices, rows = [0, 7, 14, 21, 35].map((k) => [v[3 * k], v[3 * k + 1], v[3 * k + 2]]);   // full precision (the vertex location's own arrays)
    return { rows, p: L.placement, cur: document.querySelector('[data-placement-current]').textContent };
  });
  const mErr = Math.max(...g4.rows.map((q, i) => dist(q, F2(MV[[0, 7, 14, 21, 35][i]]))));
  chk(`applied: the mesh's vertices are where the truth puts them (worst ${(mErr * 1000).toFixed(4)} mm), stored as a ${g4.p.mode} fit to ${g4.p.used} pairs, max residual ${g4.p.maxResidual.toExponential(1)}`, mErr < 1e-5 && g4.p.used === 4 && g4.p.pairs.length === 5);
  // a click on the layer reads back the LOCAL point under the cursor
  await p2.evaluate(() => { window.__st.win.close(); window.micro.fit(); });
  await p2.waitForTimeout(400);
  const box = await p2.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p2.evaluate(() => { window.__pk = undefined; window._microPlacement.pickWorldPoint({ layer: window.__mid }).then((w) => { window.__pk = w; }); });
  await p2.mouse.click(box.x, box.y);
  await p2.waitForFunction(() => window.__pk !== undefined, null, { timeout: 10000 });
  const g5 = await p2.evaluate(() => { const L = window._micro.layers().find((x) => x.id === window.__mid); return window.__pk ? window._microPlacement.layerLocalPoint(L, window.__pk) : null; });
  // the local point lies ON the local surface: inside the patch, on the triangle under it (the plane through its corners)
  const onSurf = (q) => { if (!q) return Infinity; const i = Math.min(4, Math.floor(q[0] / 20)), j = Math.min(4, Math.floor(q[1] / 20)), a = MV[j * 6 + i], bq = MV[j * 6 + i + 1], c = MV[(j + 1) * 6 + i + 1], d = MV[(j + 1) * 6 + i];
    const fx = (q[0] - a[0]) / 20, fy = (q[1] - a[1]) / 20, tri = fx >= fy ? [a, bq, c] : [a, c, d];
    const [p0, p1, p2] = tri, u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    return Math.abs(((q[0] - p0[0]) * n[0] + (q[1] - p0[1]) * n[1] + (q[2] - p0[2]) * n[2]) / Math.hypot(...n)); };
  chk(`a click on the placed mesh gives back the LOCAL point under the cursor, on the surface (${g5 && g5.map((v) => v.toFixed(3)).join(', ')}; off it by ${(onSurf(g5) * 1000).toFixed(3)} mm)`, g5 && g5[0] > 1 && g5[0] < 99 && g5[1] > 1 && g5[1] < 99 && onSurf(g5) < 1e-3);
  await p2.close();

  // ═══ §3 a mesh placed by a CRS change ═══
  const p3 = await mkPage();
  const r3 = await evaluateSettled(p3, async ({ OBJ3 }) => {
    const M = window._micro, C = window._microCrs;
    await C.setProjectCrs(await C.lookupEpsg(31983));
    const id = await M.openBlob(new File([OBJ3], 'sad69_pit.obj'), 'sad69_pit.obj', 'replace', null, { throw: true });
    const st = window._microPlacement.openPlacementDialog(M.layers().find((x) => x.id === id), { tab: 'crs' });
    st.fromIn.value = '29193';
    [...st.win.el.querySelectorAll('button')].find((x) => x.textContent === 'fit').click();
    for (let k = 0; k < 100 && !document.querySelector('[data-placement-crs-out]').textContent; k++) await new Promise((z) => setTimeout(z, 50));
    const out = document.querySelector('[data-placement-crs-out]').textContent;
    [...st.win.el.querySelectorAll('button')].find((x) => x.textContent === 'apply').click();
    for (let k = 0; k < 200 && !(M.layers()[0].placement && M.layers()[0].placement.source === 'crs-fit' && M.layers()[0].docs.meshDoc && M.layers()[0].docs.meshDoc.placeM); k++) await new Promise((z) => setTimeout(z, 50));
    const L = M.layers().find((x) => x.id === id);
    const v = (await M.meshVertexData(L)).vertices, rows = [0, 1, 2, 3, 4].map((k) => [v[3 * k], v[3 * k + 1], v[3 * k + 2]]);
    const sad = await C.lookupEpsg(29193), truth = C.transformPoints(sad, C.projectCrs(), [[608000, 7795000, 900], [610000, 7795000, 920], [610000, 7797000, 880], [608000, 7797000, 940], [609000, 7796000, 1000]]);
    return { out, p: L.placement, rows, truth };
  }, { OBJ3 });
  const cErr = Math.max(...r3.rows.map((q, i) => Math.hypot(q[0] - r3.truth[i][0], q[1] - r3.truth[i][1])));
  const moved = Math.hypot(r3.rows[0][0] - SADV[0][0], r3.rows[0][1] - SADV[0][1]);
  chk(`CRS change SAD69 → SIRGAS 2000 by best-fit similarity: “${r3.out.slice(0, 110)}…”`, /max deviation/.test(r3.out) && r3.p && r3.p.source === 'crs-fit' && r3.p.maxResidual < 0.01 && /29193/.test(r3.p.fromCrsLabel));
  chk(`… every vertex lands on the true reprojection within the reported max (worst ${(cErr * 1000).toFixed(2)} mm ≤ ${(r3.p.maxResidual * 1000).toFixed(2)} mm), moved ${moved.toFixed(1)} m`, cErr <= r3.p.maxResidual + 1e-6 && moved > 30 && moved < 80);
  await p3.close();

  // ═══ §4 a rotated GeoTIFF ═══
  const p4 = await mkPage();
  const r4 = await evaluateSettled(p4, async ({ TIF_ROT, TIF_TWIN, PTS_CSV_L, PTS_CSV_W }) => {
    const M = window._micro;
    const run = async (tif, csv, nm) => {
      const gid = await M.openBlob(new File([new Uint8Array(tif)], nm + '.tif'), nm + '.tif', 'replace', null, { throw: true });
      const pid = await M.openBlob(new File([csv], nm + '_pts.csv'), nm + '_pts.csv', 'add', null, { throw: true, asKind: 'points' });
      const G = M.layers().find((x) => x.id === gid), P = M.layers().find((x) => x.id === pid);
      await M.selectByGridSurface(G, { targets: [P], mode: 'below' });
      return { G, P, n: M.layers().find((x) => x.id === pid)._selCount };
    };
    const a = await run(TIF_ROT, PTS_CSV_W, 'rotated');
    const g = a.G.docs.gridDoc.grid, place = g.place ? { R: g.place.R.slice(), t: g.place.t.slice(), s: g.place.s } : null, form = g.form;
    // exports: GeoTIFF keeps the rotation (+ a world file), ESRI ASCII refuses — or resamples when asked
    const tif = await M.buildGridExport(a.G, { format: 'tif' });
    let ascErr = ''; try { await M.buildGridExport(a.G, { format: 'asc' }); } catch (e) { ascErr = e.message; }
    const asc = await M.buildGridExport(a.G, { format: 'asc', resample: true });
    const back = await M.openBlob(new File([tif.blob], 'back.tif'), 'back.tif', 'add', null, { throw: true });
    const gb = M.layers().find((x) => x.id === back).docs.gridDoc.grid;
    const rowA = await M.fetchLayerRow(a.G, 0);
    const twin = await run(TIF_TWIN, PTS_CSV_L, 'twin');
    // the twin PLACED by typed parameters (κ 30° about its corner's frame, shifted to the corner) = the rotated file
    const nTwin = twin.n;
    await window._microPlacement.setLayerPlacement(twin.G, { tx: 600000, ty: 7700000, kappa: 30, source: 'typed' });
    const rowTyped = (await M.fetchLayerRow(M.layers().find((x) => x.id === twin.G.id), 0)).slice(0, 3);
    // a surface takes a rotation about Z only — a tilt is refused, with the reason
    const sid = await M.openBlob(new File([new Uint8Array(TIF_TWIN)], 'surf.tif'), 'surf.tif', 'add', null, { throw: true, asKind: 'surface' });
    let tiltErr = ''; try { await window._microPlacement.setLayerPlacement(M.layers().find((x) => x.id === sid), { omega: 3, source: 'typed' }); } catch (e) { tiltErr = e.message; }
    return { nRot: a.n, nTwin, rowTyped, tiltErr, place, form, wf: tif.worldFile, notes: tif.notes, ascErr, ascNotes: asc.notes, backPlace: gb.place ? { R: gb.place.R.slice(), t: gb.place.t.slice() } : null, rowA: rowA.slice(0, 3) };
  }, { TIF_ROT, TIF_TWIN, PTS_CSV_L, PTS_CSV_W });
  const ang = r4.place ? Math.atan2(r4.place.R[1], r4.place.R[0]) / D : NaN;
  const n0 = toW(GD / 2, -GD / 2, gdata[0]);
  chk(`a rotated GeoTIFF (ModelTransformation) opens ROTATED: ${ang.toFixed(6)}°, corner ${r4.place && r4.place.t.slice(0, 2).map((v) => v.toFixed(3)).join(', ')}; its node 0 reads at ${r4.rowA.join(', ')}`, Math.abs(ang - TH) < 1e-6 && r4.place && Math.abs(r4.place.t[0] - CORNER[0]) < 1e-6 && Math.abs(r4.rowA[0] - n0[0]) < 2e-3 && Math.abs(r4.rowA[1] - n0[1]) < 2e-3 && /rotated 30°/.test(r4.form));
  chk(`selecting below it = selecting below its unrotated twin with the same points in the grid's frame (${r4.nRot} = ${r4.nTwin}; ≈ ${BELOW} by f itself)`, r4.nRot === r4.nTwin && r4.nRot > 50 && Math.abs(r4.nRot - BELOW) < 40);
  chk(`the twin placed by TYPED parameters (κ 30°, shifted to the corner) reads its node 0 where the rotated file does (${r4.rowTyped.join(', ')})`, dist(r4.rowTyped.map(Number), r4.rowA.map(Number)) < 2e-3);
  chk(`a grid shown as a surface refuses a tilt, saying why (“${r4.tiltErr.slice(0, 70)}…”)`, /rotation about Z only/.test(r4.tiltErr));
  const wfl = (r4.wf || '').trim().split(/\s+/).map(Number);
  chk(`its GeoTIFF export carries the rotation (read back at ${r4.backPlace ? (Math.atan2(r4.backPlace.R[1], r4.backPlace.R[0]) / D).toFixed(6) : '—'}°) with a world file (B = ${wfl[2] && wfl[2].toFixed(4)}, D = ${wfl[1] && wfl[1].toFixed(4)})`, r4.backPlace && Math.abs(Math.atan2(r4.backPlace.R[1], r4.backPlace.R[0]) / D - TH) < 1e-6 && Math.abs(wfl[1] - GD * Math.sin(th)) < 1e-9 && Math.abs(wfl[2] - GD * Math.sin(th)) < 1e-9);
  chk(`ESRI ASCII refuses it with the reason (“${r4.ascErr.slice(0, 60)}…”), or resamples when asked (“${(r4.ascNotes.find((x) => /resampled/.test(x)) || '').slice(0, 50)}…”)`, /no rotation terms/.test(r4.ascErr) && r4.ascNotes.some((x) => /axis-aligned/.test(x)));
  await p4.close();

  // ═══ §5 the Datamine origin, an old project ═══
  const proj = 'place_proj_' + Date.now();
  const p5 = await mkPage();
  await p5.evaluate((pr) => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(pr, { create: true }); }, proj);
  const O = [432820, 8522360, 300];
  const r5a = await evaluateSettled(p5, async ({ O }) => {
    const M = window._micro, F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 5, nx: 3, ny: 2, nz: 2 });
    const id = await M.openBlob(new File([F.makeSubblockDm(rows, { angle1: -50 })], 'kept.dm'), 'kept.dm', 'replace', null, { throw: true });
    await M.setDmOrigin(M.layers().find((x) => x.id === id), O);
    const L = M.layers().find((x) => x.id === id);
    const res = { origin: L.docs.blockDoc.header.dmOrigin, p: L.placement, bbox: L.docs.blockDoc.header.bbox, row: (await M.fetchLayerRow(L, 0)).slice(0, 3) };
    // a general placement on a rotated .dm composes with the file's own rotation (and its XL/YL/ZL stay the file's)
    await window._microPlacement.setLayerPlacement(L, { tx: 1000, ty: 2000, tz: 5, kappa: 12, scale: 1.5, source: 'typed' });
    const L2 = M.layers().find((x) => x.id === id), sch = M.schemaExt(L2, M.layerTableHeader(L2)).map((c) => c.name);
    let rec0 = null; for await (const { f, rec } of M.layerRecords(L2)) { if (rec === 0) { rec0 = f; break; } }
    res.typedRow = (await M.fetchLayerRow(L2, 0)).slice(0, 3);
    res.local0 = [rows[0].XC, rows[0].YC, rows[0].ZC];
    res.xl = ['XL', 'YL', 'ZL'].map((n) => +rec0[sch.indexOf(n)]);
    await M.setDmOrigin(L2, O);                           // back: the shortcut replaces it with the shift again
    return res;
  }, { O });
  chk(`“Datamine origin…” is a placement now: a shift (${r5a.p && [r5a.p.tx, r5a.p.ty, r5a.p.tz].join(', ')}, source ${r5a.p && r5a.p.source}), the model's origin at ${JSON.stringify(r5a.origin)}`, r5a.p && r5a.p.source === 'datamine' && JSON.stringify(r5a.origin) === JSON.stringify(O) && r5a.p.tx === O[0]);
  const F5 = sim({ tx: 1000, ty: 2000, tz: 5, kappa: 12, scale: 1.5 });
  const want5 = F5(r5a.row.map((v, a) => +v - O[a]));       // the file's frame (its own rotation, origin 0) → the typed placement
  chk(`a typed placement on a ROTATED .dm composes with the file's rotation (worst ${(dist(r5a.typedRow.map(Number), want5) * 1000).toFixed(3)} mm); its XL/YL/ZL still read the file's own XC/YC/ZC (${r5a.xl.map((v) => v.toFixed(3)).join(', ')})`,
    dist(r5a.typedRow.map(Number), want5) < 1e-3 && dist(r5a.xl, r5a.local0) < 1e-6);
  p5.evaluate(() => window._micro.saveProjectAs());
  await p5.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await p5.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p5.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await p5.close();
  // make it an OLD project: the layer carries dmOrigin, not a placement
  const p6 = await mkPage();
  const r5b = await evaluateSettled(p6, async ({ proj, O }) => {
    const M = window._micro, dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(proj);
    const fh = await dir.getFileHandle('project.json'), mf = JSON.parse(await (await fh.getFile()).text());
    const had = !!(mf.layers[0] && mf.layers[0].placement);
    for (const ls of mf.layers) { delete ls.placement; ls.dmOrigin = O; }
    const w = await fh.createWritable(); await w.write(JSON.stringify(mf)); await w.close();
    await M.openProjectDir(dir);
    for (let k = 0; k < 200 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); k++) await new Promise((z) => setTimeout(z, 50));
    const L = M.layers()[0];
    return { had, origin: L.docs.blockDoc.header.dmOrigin, p: L.placement, bbox: L.docs.blockDoc.header.bbox, row: (await M.fetchLayerRow(L, 0)).slice(0, 3), kind: L.kind };
  }, { proj, O });
  const bbErr = Math.max(...[0, 1, 2].map((a) => Math.max(Math.abs(r5b.bbox.min[a] - r5a.bbox.min[a]), Math.abs(r5b.bbox.max[a] - r5a.bbox.max[a]))));
  chk(`the project saved the placement (${r5b.had}); an OLD project (dmOrigin on the layer) opens IN PLACE: origin ${JSON.stringify(r5b.origin)}, migrated to a ${r5b.p && r5b.p.source} placement, bbox within ${bbErr.toExponential(1)} m, record 0 at the same world point`,
    r5b.had && JSON.stringify(r5b.origin) === JSON.stringify(O) && r5b.p && r5b.p.source === 'datamine' && bbErr < 1e-6 && dist(r5b.row.map(Number), r5a.row.map(Number)) < 1e-6 && r5b.kind === 'blocks');
  await p6.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
