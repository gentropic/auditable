// micro smoke — wave 6b: GEOREFERENCING OUTCROP MESHES WITH GCPs + the CRS DETECTIVE. Every
// expected number is computed HERE (the smoke's own fixtures, its own rotation, @gcu/proj only to
// write the "SAD69 survey" numbers a field crew would have written):
//   §1 the placement window's control points are DRAWN in 3D while its control-points tab is open:
//      one ring (the local point, placed by the current fit) + one square (the true point) + a
//      numbered label per pair; an exact pair's ring sits on its square, a 1 m blunder's doesn't
//      and is coloured red; another tab hides them, closing the window removes them
//   §2 structure attitudes follow a placement: a sheet dipping 30° toward 090, measured in the
//      structure window, then rotated κ = 30° (counter-clockwise from above) → 060/30, the dip
//      unchanged, without re-painting anything
//   §3 the detective: collars surveyed ON a hilly DEM in SIRGAS 2000 / UTM 23S, their numbers
//      written in SAD69 / UTM 23S, opened as the project's system → SAD69 ranked first by a clear
//      margin; "reproject" re-reads the set and puts every collar back on its true position, with
//      the path in lineage; nothing is applied before the click
//   §4 a flat DEM → "can't tell", with the reason; a vertical offset everywhere → called out
// Run: node test/micro-crsdetective-smoke.mjs (dev tree) · --built (micro.html). MICRO_CHROMIUM_ARGS honoured.
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { writeGeoTiff } from '../ext/gtiff/index.js';
import { lookupEpsg, transformPoints } from '../ext/proj/index.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-crsdetective-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);
const D = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const azd = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// §1 fixture: a bumpy 6 × 6 surface in a local frame, four exact pairs of a known similarity + a blunder
const MV = [];
for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) MV.push([i * 20, j * 20, 100 + 6 * Math.sin(i) * Math.cos(j)]);
const MT = [];
for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const a = j * 6 + i + 1; MT.push([a, a + 1, a + 7], [a, a + 7, a + 6]); }
const OBJ1 = MV.map((q) => `v ${q.join(' ')}`).join('\n') + '\n' + MT.map((t) => `f ${t.join(' ')}`).join('\n') + '\n';
const th1 = 35 * D, F1 = (p) => [512000 + Math.cos(th1) * p[0] - Math.sin(th1) * p[1], 7712000 + Math.sin(th1) * p[0] + Math.cos(th1) * p[1], 850 + p[2]];
const PAIRS = [0, 5, 30, 35].map((k) => [...MV[k], ...F1(MV[k])]);
PAIRS.push([...MV[14], ...F1(MV[14]).map((v, a) => v + (a === 0 ? 1 : 0))]);       // pair 5: 1 m off in X
const PASTE = PAIRS.map((r) => r.map((v) => +v.toFixed(6)).join('\t')).join('\n');

// §2 fixture: a planar sheet dipping 30° toward 090 (z falls east), 20 × 20 cells of 1 m, at UTM
const SHEET = (() => {
  const n = 20, X0 = 500000, Y0 = 7000000, Z0 = 800, t30 = Math.tan(30 * D), V = [], T = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V.push(X0 + i, Y0 + j, Z0 - t30 * i);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; T.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  return { V, T, centre: [X0 + 10, Y0 + 10, Z0 - t30 * 10] };
})();

// §3 fixture: a DEM with relief (~120 m of hills over 4 km) on a 10 m lattice, collars ON it in SIRGAS 2000
const X0 = 600000, Y0 = 7790000, NX = 401, PITCH = 10;
const hill = (x, y) => 900 + 60 * Math.sin((x - X0) / 400) * Math.cos((y - Y0) / 550) + 0.02 * (x - X0);
const flat = (x) => 900 + 0.001 * (x - X0);
const demOf = async (f) => {
  const data = new Float32Array(NX * NX);
  for (let r = 0; r < NX; r++) for (let c = 0; c < NX; c++) data[r * NX + c] = f(X0 + c * PITCH, Y0 + (NX - 1) * PITCH - r * PITCH);
  return [...await writeGeoTiff({ nx: NX, ny: NX, data, x0: X0, y0: Y0 + (NX - 1) * PITCH, dx: PITCH, dy: PITCH, nodata: -9999 }, { compression: 'none' })];
};
const DEM_HILL = await demOf(hill), DEM_FLAT = await demOf(flat);
const TRUE = [];
for (let k = 0; k < 40; k++) { const x = X0 + 300 + ((k * 617) % 3400), y = Y0 + 300 + ((k * 389) % 3400); TRUE.push([x, y, hill(x, y)]); }
const SIR = await lookupEpsg(31983), SAD = await lookupEpsg(29193);
const AS_SAD = transformPoints(SIR, SAD, TRUE);                 // the numbers a SAD69 survey writes for those points
const sadShift = AS_SAD.reduce((s, p, i) => s + Math.hypot(p[0] - TRUE[i][0], p[1] - TRUE[i][1]), 0) / TRUE.length;
const holeFiles = (pts, dz = 0) => ({
  collar: 'BHID,X,Y,Z,EOH\n' + pts.map((p, i) => `H${i + 1},${p[0].toFixed(3)},${p[1].toFixed(3)},${(p[2] + dz).toFixed(3)},40`).join('\n') + '\n',
  survey: 'BHID,AT,AZ,DIP\n' + pts.map((_, i) => `H${i + 1},0,0,90`).join('\n') + '\n',
  intervals: 'BHID,FROM,TO,AU\n' + pts.map((_, i) => `H${i + 1},0,20,1.${i}\nH${i + 1},20,40,2.${i}`).join('\n') + '\n',
});

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
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const mkPage = async () => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._microPlacement && window._microCrs && window._microCrsCheck, null, { timeout: 30000 });
  await p.evaluate(() => { try { window._micro.setAutoOptimize('off'); window._micro.setAutoPack('off'); } catch { /* older builds */ } });
  return p;
};
// what the GCP overlay shows: per marker kind, the screen points + classes
const markers = (p) => p.evaluate(() => {
  const s = document.getElementById('gcpSvg');
  if (!s || s.style.display === 'none') return { shown: false, local: [], true: [], labels: [] };
  const pt = (e, a, b2) => [+e.getAttribute(a), +e.getAttribute(b2)];
  return {
    shown: true,
    local: [...s.querySelectorAll('[data-gcp-local]')].map((e) => ({ i: +e.dataset.gcpLocal, xy: pt(e, 'cx', 'cy') })),
    true: [...s.querySelectorAll('[data-gcp-true]')].map((e) => ({ i: +e.dataset.gcpTrue, xy: [+e.getAttribute('x') + 4, +e.getAttribute('y') + 4], cls: e.dataset.cls })),
    labels: [...s.querySelectorAll('[data-gcp-label]')].map((e) => e.textContent),
  };
});
const frame = (p) => p.evaluate(() => new Promise((r) => { window._micro.requestRender(); requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))); }));

try {
  // ═══ §1 control points drawn in 3D ═══
  {
    const p = await mkPage();
    await evaluateSettled(p, async ({ OBJ1 }) => {
      const M = window._micro;
      window.__mid = await M.openBlob(new File([OBJ1], 'drone.obj'), 'drone.obj', 'replace', null, { throw: true });
      window.__st = window._microPlacement.openPlacementDialog(M.layers().find((x) => x.id === window.__mid), { tab: 'gcp' });
    }, { OBJ1 });
    await p.fill('[data-placement-paste]', PASTE);
    await p.click('text=add pasted');
    await p.evaluate(() => window.micro.fit());
    await frame(p); await frame(p);
    // before the fit is applied the drone model sits in its own frame: the markers are drawn ON it
    // (the true points taken back by the fit) — an exact pair's ring on its square, the blunder apart
    const m0 = await markers(p);
    const gapIn = (m, i) => { const a = m.local.find((q) => q.i === i), t = m.true.find((q) => q.i === i); return a && t ? Math.hypot(a.xy[0] - t.xy[0], a.xy[1] - t.xy[1]) : NaN; };
    const ex0 = Math.max(...[0, 1, 2, 3].map((i) => gapIn(m0, i)));
    chk(`with the control-points tab open, every pair is drawn on the unplaced mesh: ${m0.local.length} rings, ${m0.true.length} squares, labels ${m0.labels.join(',')}; exact pairs' rings sit on their squares (worst ${ex0.toFixed(2)} px), the 1 m blunder's doesn't (${gapIn(m0, 4).toFixed(2)} px), coloured like the table's residuals (${m0.true.map((t) => t.cls).join(',')})`,
      m0.shown && m0.local.length === 5 && m0.true.length === 5 && m0.labels.join(',') === '1,2,3,4,5' && ex0 < 1 && gapIn(m0, 4) > 3 && m0.true[4].cls === 'bad' && JSON.stringify(m0.true.map((t) => t.cls)) === JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[data-pair-res]')].map((e) => e.dataset.cls))));
    // applied: the scene is in world now — the squares ARE the true points, the rings the local points placed by the fit
    await p.click('text=apply fit');
    await p.waitForFunction(() => { const L = window._micro.layers().find((x) => x.id === window.__mid); return L && L.placement && L.placement.source === 'gcp' && L.docs.meshDoc && L.docs.meshDoc.placeM; }, null, { timeout: 30000 });
    await p.evaluate(() => window.micro.fit());
    await frame(p); await frame(p);
    const m1 = await markers(p);
    // where the TRUE points project, independently: through the camera's own viewProj
    const want = await p.evaluate((P) => P.map((r) => { const o = window._micro.frame.origin, vp = window._micro.cam.state.viewProj, x = r[3] - o[0], y = r[4] - o[1], z = r[5] - o[2];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]; const cv = document.querySelector('#cv');
      return [((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw + 1) / 2 * cv.clientWidth, (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw) / 2 * cv.clientHeight]; }), PAIRS);
    const trueErr = Math.max(...m1.true.map((t) => Math.hypot(t.xy[0] - want[t.i][0], t.xy[1] - want[t.i][1])));
    chk(`applied, the squares sit on the true points' projections (worst ${trueErr.toFixed(2)} px), the blunder still apart from its ring (${gapIn(m1, 4).toFixed(2)} px)`,
      m1.true.length === 5 && trueErr < 1.5 && gapIn(m1, 4) > Math.max(...[0, 1, 2, 3].map((i) => gapIn(m1, i))));
    // drop the blunder: the fit is exact, the four rings stay on their squares, the dropped pair keeps its line (dashed)
    await p.click('[data-pair-use="4"]'); await frame(p);
    const dashed = await p.evaluate(() => { const l = document.querySelector('#gcpSvg [data-gcp-line="4"]'); return l ? l.getAttribute('stroke-dasharray') : null; });
    chk(`a dropped pair is still drawn, dashed (“${dashed}”)`, !!dashed);
    await p.click('[data-placement] [data-tab="typed"]'); await frame(p);
    const m2 = await markers(p);
    await p.click('[data-placement] [data-tab="gcp"]'); await frame(p);
    const m3 = await markers(p);
    await p.evaluate(() => window.__st.win.close()); await frame(p);
    const m4 = await markers(p);
    chk(`another tab hides them (${m2.shown ? 'shown' : 'hidden'}), back on control points they return (${m3.true.length}), closing the window removes them (${m4.shown ? 'still shown' : 'gone'})`, !m2.shown && m3.true.length === 5 && !m4.shown);
    await p.close();
  }

  // ═══ §2 structure attitudes follow a placement ═══
  {
    const p = await mkPage();
    const r2 = await evaluateSettled(p, async ({ SHEET }) => {
      const M = window._micro, PL = window._microPlacement;
      const id = await M.addLayer({ kind: 'mesh', name: 'outcrop', vertices: Float64Array.from(SHEET.V), triangles: Uint32Array.from(SHEET.T) });
      let L = M.layers().find((x) => x.id === id);
      await M.openStructure(L);
      for (let k = 0; k < 200 && !(L.paintCols || []).some((c) => c.name === 'SET'); k++) await new Promise((z) => setTimeout(z, 50));
      const col = L.paintCols.find((c) => c.name === 'SET');
      col.codes.fill(1);                                     // the whole sheet painted as J1
      await M.structureAfterEdit(L);
      const hd = () => [...M.structureWins.values()].find((h) => h.L.id === id);
      const before = hd().planes.map((q) => [q.dip_direction, q.dip, q.n_vertices]);
      await PL.setLayerPlacement(L, { tx: 0, ty: 0, tz: 0, omega: 0, phi: 0, kappa: 30, scale: 1, pivot: SHEET.centre, source: 'typed' });
      for (let k = 0; k < 100; k++) { await new Promise((z) => setTimeout(z, 50)); const h = hd(); if (h && h.planes.length && Math.abs(h.planes[0].dip_direction - before[0][0]) > 1) break; }
      L = M.layers().find((x) => x.id === id);
      const after = hd().planes.map((q) => [q.dip_direction, q.dip, q.n_vertices]);
      // the measurement from scratch, too: prepare + measure on the placed mesh
      const st = M.structureOf(L) || await M.prepareStructure(L);
      const fresh = M.measurePlanes(st, L.paintCols.find((c) => c.name === 'SET').codes, ['', 'J1']).map((q) => [q.dip_direction, q.dip]);
      return { before, after, fresh, painted: L.paintCols.find((c) => c.name === 'SET').codes.reduce((s, v) => s + (v === 1), 0) };
    }, { SHEET });
    chk(`the sheet measures 090/30 before (${r2.before.map((q) => `${q[0].toFixed(2)}/${q[1].toFixed(2)}`).join(' ')})`, r2.before.length === 1 && azd(r2.before[0][0], 90) < 0.1 && Math.abs(r2.before[0][1] - 30) < 0.1);
    chk(`rotated κ = 30° (counter-clockwise from above): the window's plane reads 060/30 — dip direction moved 30°, dip unchanged (${r2.after.map((q) => `${q[0].toFixed(2)}/${q[1].toFixed(2)}`).join(' ')}); the paint rode through (${r2.painted} vertices)`,
      r2.after.length === 1 && azd(r2.after[0][0], 60) < 0.1 && Math.abs(r2.after[0][1] - 30) < 0.1 && r2.painted === 441);
    chk(`measured from scratch on the placed mesh, the same 060/30 (${r2.fresh.map((q) => `${q[0].toFixed(2)}/${q[1].toFixed(2)}`).join(' ')})`, r2.fresh.length === 1 && azd(r2.fresh[0][0], 60) < 0.1 && Math.abs(r2.fresh[0][1] - 30) < 0.1);
    await p.close();
  }

  // ═══ §3 the detective names SAD69, and its reprojection puts the collars back ═══
  const openSet = (p, files, dem) => evaluateSettled(p, async ({ files, dem }) => {
    const M = window._micro, C = window._microCrs;
    await C.setProjectCrs(await C.lookupEpsg(31983));
    await M.openBlob(new File([new Uint8Array(dem)], 'topo.tif'), 'topo.tif', 'replace', null, { throw: true });
    const f = (t, n) => new File([t], n, { type: 'text/csv' });
    await M.importDrillholes({ collar: f(files.collar, 'collars.csv'), survey: f(files.survey, 'survey.csv'), intervals: f(files.intervals, 'assays.csv') }, {}, 'add');
    const L = M.layers().find((x) => x.dh);
    M.setActiveLayer(L.id);
    window.__cw = window._microCrsCheck.openCrsDetective(L);
    for (let k = 0; k < 400 && !(document.querySelector('[data-crs-verdict]') && document.querySelector('[data-crs-verdict]').dataset.kind); k++) await new Promise((z) => setTimeout(z, 50));
    const r = window.__cw.r && window.__cw.r.result;
    return {
      kind: document.querySelector('[data-crs-verdict]').dataset.kind, text: document.querySelector('[data-crs-verdict]').textContent,
      rows: r ? r.hypotheses.map((h) => ({ id: h.id, label: h.label, medAbs: h.medAbs, spread: h.spread, n: h.n, off: h.off, members: h.members.map((m) => m.id), current: h.current, asIs: h.asIs })) : [],
      ratio: r && r.verdict.ratio, vertical: r && r.vertical, slope: r && r.slope,
      apply: !!document.querySelector('[data-crs-apply]'), srcCrs: L.docs.dhDoc.config.srcCrs || null,
      table: document.querySelectorAll('[data-crs-table] tr').length,
    };
  }, { files, dem });
  const collarsOf = (p) => p.evaluate(() => { const L = window._micro.layers().find((x) => x.dh); const paths = L.docs.dhDoc.holePaths(); const out = {}; for (const [k, v] of paths) out[String(k)] = [v[0], v[1], v[2]]; return out; });
  {
    const p = await mkPage();
    const r3 = await openSet(p, holeFiles(AS_SAD), DEM_HILL);
    const top = r3.rows[0] || {};
    const asIs = r3.rows.find((h) => h.asIs) || {};
    console.log(`      readings: ${r3.rows.map((h) => `${h.id} ${h.medAbs.toFixed(2)}`).join(' · ')} · margin ${r3.ratio && r3.ratio.toFixed(1)}× · SAD69↔SIRGAS here ${sadShift.toFixed(1)} m`);
    chk(`SAD69 numbers opened as SIRGAS 2000: the detective ranks SAD69 / UTM 23S first (${top.label}; median |Δz| ${top.medAbs && top.medAbs.toFixed(3)} m vs ${asIs.medAbs && asIs.medAbs.toFixed(2)} m as is) by ${r3.ratio && r3.ratio.toFixed(1)}×`,
      r3.kind === 'shift' && top.members && top.members.includes('EPSG:29193') && r3.ratio >= 4 && top.medAbs < 0.5 && top.n === 40);
    chk(`the verdict says it in plain words (“${r3.text.slice(0, 110)}…”), offers to reproject, and has applied nothing (srcCrs ${JSON.stringify(r3.srcCrs)})`,
      /better as SAD69/.test(r3.text) && /recorded in SAD69/.test(r3.text) && r3.apply && r3.srcCrs == null && r3.table === r3.rows.length + 1);
    const before = await collarsOf(p);
    const offBefore = Math.max(...TRUE.map((t, i) => Math.hypot(before[`H${i + 1}`][0] - t[0], before[`H${i + 1}`][1] - t[1])));
    await p.click('[data-crs-apply]');
    await p.waitForFunction(() => { const L = window._micro.layers().find((x) => x.dh); return L && L.docs.dhDoc.config.srcCrs && document.querySelector('[data-crs-verdict]').dataset.kind && !document.querySelector('[data-crs-apply]') && window.__cw.r && window.__cw.r.result.hypotheses[0].current; }, null, { timeout: 60000 });
    const after = await collarsOf(p);
    const offAfter = Math.max(...TRUE.map((t, i) => dist(after[`H${i + 1}`], t)));
    const info = await p.evaluate(() => { const L = window._micro.layers().find((x) => x.dh); return { src: L.docs.dhDoc.config.srcCrs, lin: L.lineage && L.lineage.params && L.lineage.params.reproject, chk: L.lineage && L.lineage.params && L.lineage.params.crsCheck, meta: L.docs.dhDoc.metaLine, undo: !!document.querySelector('[data-crs-undo]') }; });
    chk(`“reproject”: the set is re-read with its collars in SAD69 — every collar lands on its true SIRGAS position (worst ${(offAfter * 1000).toFixed(1)} mm; before, ${offBefore.toFixed(1)} m off)`,
      offBefore > 40 && offAfter < 0.05 && info.src && info.src.epsg === 29193);
    chk(`lineage carries the path (${info.lin && info.lin.path}) and the check (${info.chk && info.chk.reading}); the layer line says so; the window now marks SAD69 current and offers the way back (${info.undo})`,
      info.lin && /SAD69/.test(info.lin.from) && info.chk && /collars reprojected/.test(info.meta) && info.undo);
    // the project remembers the collars' system: saved, reopened, the holes are still on the ground
    await p.evaluate(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('crs-detective', { create: true }); window._micro.setAutoOptimize('off'); });
    p.evaluate(() => window._micro.saveProjectAs());
    await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 30000 });
    await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
    await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
    await p.close();
    const pr = await mkPage();
    await pr.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('crs-detective'); await window._micro.openProjectDir(dir); });
    await pr.waitForFunction(() => window._micro.layers().some((L) => L.dh && L.docs.dhDoc), null, { timeout: 60000 });
    const re = await collarsOf(pr);
    const offRe = Math.max(...TRUE.map((t, i) => dist(re[`H${i + 1}`], t)));
    const reSrc = await pr.evaluate(() => window._micro.layers().find((x) => x.dh).docs.dhDoc.config.srcCrs);
    chk(`the project remembers the collars' system (${reSrc && reSrc.epsg}): reopened, every collar is still on its true position (worst ${(offRe * 1000).toFixed(1)} mm)`, reSrc && reSrc.epsg === 29193 && offRe < 0.05);
    await pr.close();
  }

  // ═══ §4 the honest limits: flat ground, and a vertical offset ═══
  {
    const p = await mkPage();
    const r4 = await openSet(p, holeFiles(transformPoints(SIR, SAD, TRUE.map(([x, y]) => [x, y, flat(x)]))), DEM_FLAT);
    chk(`a flat DEM: "can't tell" (${r4.kind}), with the reason (“${r4.text.slice(0, 120)}…”), nothing offered (${r4.apply})`, r4.kind === 'flat' && /too flat/.test(r4.text) && /needs relief/.test(r4.text) && !r4.apply && r4.slope.medDeg < 1);
    await p.close();
    const p2 = await mkPage();
    const r5 = await openSet(p2, holeFiles(AS_SAD, 25), DEM_HILL);
    chk(`collars 25 m above the DEM everywhere: called out (“…${(r5.text.match(/Collars sit[^?]*\?/) || [''])[0]}”), offset ${r5.vertical && r5.vertical.offset.toFixed(2)} m; SAD69 still wins on the spread (${r5.rows[0] && r5.rows[0].id})`,
      r5.vertical && Math.abs(r5.vertical.offset - 25) < 1 && /~25(\.0)? m above the DEM everywhere/.test(r5.text) && r5.rows[0] && r5.rows[0].members.includes('EPSG:29193'));
    await p2.close();
  }
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
