// micro structure smoke — capivaras in micro: structural analysis on an outcrop mesh.
//
// The fixture is a SYNTHETIC outcrop with known truth: a folded sheet whose two
// faces dip 30° toward 090 and 60° toward 270, at UTM-sized coordinates. Every
// measurement check compares against that truth, never against "it returned a
// number" — the predecessor's failure mode was a plausible wrong attitude.
//
// The page runs with ?ctxcap=500 so the 800-triangle fixture is "over the cap":
// the promote-to-context path is exercised without building a 2M-triangle mesh.
//
// Run with `npm run test:micro:structure` (dev tree), `-- --built` for micro.html.
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';

const BUILT = process.argv.includes('--built');
const APP = (BUILT ? '/micro.html' : '/tools/micro/index.html') + '?ctxcap=500';
if (BUILT) console.log('micro-structure-smoke against the BUILT micro.html');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle'] });
await installSmokeWaits(b);
const ctx = await b.newContext({ viewport: { width: 1100, height: 750 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.autoPackMeshes') == null) localStorage.setItem('micro.autoPackMeshes', 'off'); } catch { /* opaque origin */ } });
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const mkPage = async (proj) => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro, null, { timeout: 20000 });
  if (proj) await p.evaluate((pr) => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(pr, { create: true }); }, proj);
  return p;
};
const saveProject = async (p) => {
  await p.evaluate(() => window._micro.setAutoOptimize('off'));
  p.evaluate(() => window._micro.saveProjectAs());
  await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 30000 });
  await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
};

// ── the fixture: a folded sheet, 20×20 cells of 1 m (441 vertices, 800 triangles).
// x ≤ 10: dips 30° toward 090 (z falls east); x > 10: dips 60° toward 270.
const OUTCROP = (() => {
  const n = 20, m = 10, X0 = 500000, Y0 = 7000000, Z0 = 800;
  const t30 = Math.tan(30 * Math.PI / 180), t60 = Math.tan(60 * Math.PI / 180);
  const V = [], T = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const z = i <= m ? -t30 * i : -t30 * m + t60 * (i - m);
    V.push(X0 + i, Y0 + j, Z0 + z);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b2 = a + 1, c = a + n + 2, d = a + n + 1;
    T.push(a, b2, c, a, c, d);
  }
  return { V, T };
})();
const addOutcrop = (p) => p.evaluate(async ({ V, T }) => {
  const M = window._micro;
  return M.addLayer({ kind: 'mesh', name: 'outcrop', vertices: Float64Array.from(V), triangles: Uint32Array.from(T) });
}, OUTCROP);

// ═══ 1. promote-to-context: over the cap opens streamed; "convert to exact" states the
//     cost, asks, loads the exact tier, and the project remembers it ═══
{
  const p = await mkPage('struct-promote');
  const id = await addOutcrop(p);
  const before = await p.evaluate((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return { soup: !!L.docs.meshDoc.header.soup, tris: L.docs.meshDoc.header.triCount, rows: window._micro.attrRowCountOf(L) }; }, id);
  chk(`over the cap (800 tris > 500) the outcrop opens streamed, with no vertex records (soup ${before.soup}, rows ${before.rows})`, before.soup && before.tris === 800 && before.rows === 0);
  // the cost is stated and the user is asked; Cancel leaves it streamed
  p.evaluate((lid) => window._micro.convertMeshLayer(window._micro.layers().find((q) => q.id === lid), false), id);
  await p.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'));
  const ask = await p.evaluate(() => ({ title: document.querySelector('#pmTitle').textContent, msg: document.querySelector('#pmMsg').textContent, ok: document.querySelector('#pmOk').textContent }));
  await p.evaluate(() => document.querySelector('#pmFoot .pm-alt').click());
  await p.waitForFunction(() => !document.querySelector('#pmDlg').classList.contains('show'));
  const still = await p.evaluate((lid) => !!window._micro.layers().find((q) => q.id === lid).docs.meshDoc.header.soup, id);
  chk(`promote asks first, stating the size and the GPU cost (“${ask.msg.slice(0, 70)}…”); Cancel keeps it streamed (${still})`,
    /exact/i.test(ask.title) && /800 triangles/.test(ask.msg) && /GPU memory/.test(ask.msg) && ask.ok === 'Load exact' && still);
  p.evaluate((lid) => window._micro.convertMeshLayer(window._micro.layers().find((q) => q.id === lid), false), id);
  await p.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'));
  await p.evaluate(() => document.querySelector('#pmOk').click());
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L && L.docs.meshDoc && !L.docs.meshDoc.header.soup; }, id, { timeout: 30000 });
  const after = await p.evaluate((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return { rows: window._micro.attrRowCountOf(L), solid: !!window._micro.meshSolidOf(L) }; }, id);
  chk(`Load exact → the exact tier past the cap: 441 vertex records (${after.rows}), CPU geometry for queries (${after.solid})`, after.rows === 441 && after.solid);
  await saveProject(p);
  await p.close();
  const p2 = await mkPage('struct-promote');
  await p2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('struct-promote'); await window._micro.openProjectDir(dir); });
  await p2.waitForFunction(() => window._micro.layers().some((L) => L.kind === 'mesh' && L.docs.meshDoc), null, { timeout: 60000 });
  const re = await p2.evaluate(() => { const L = window._micro.layers().find((q) => q.kind === 'mesh'); return { soup: !!L.docs.meshDoc.header.soup, rows: window._micro.attrRowCountOf(L) }; });
  chk(`the project remembers the promotion: it reopens exact, not streamed (soup ${re.soup}, ${re.rows} rows)`, !re.soup && re.rows === 441);
  await p2.close();
}

// world point → page coordinates, through the camera's own viewProj (frame-local)
const toPage = (p, w) => p.evaluate((w2) => {
  const M = window._micro, o = M.frame.origin, vp = M.cam.state.viewProj;
  const x = w2[0] - o[0], y = w2[1] - o[1], z = w2[2] - o[2];
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  const r = document.querySelector('#cv').getBoundingClientRect();
  return [r.left + (cx / cw + 1) / 2 * r.width, r.top + (1 - cy / cw) / 2 * r.height];
}, w);
const t30 = Math.tan(30 * Math.PI / 180), t60 = Math.tan(60 * Math.PI / 180);
const FACE_A = [500005, 7000010, 800 - t30 * 5];                  // mid the 30°/090 face
const FACE_B = [500015, 7000010, 800 - t30 * 10 + t60 * 5];       // mid the 60°/270 face
const azd = (a, b2) => Math.abs(((a - b2 + 540) % 360) - 180);
const planesOf = (p) => p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w ? w._structure.planes : null; });

// ═══ 2. the structure window: promote from inside it, prepare, then the wand measures
//     each face of the fold at its true attitude; discs, undo, the table, persistence ═══
{
  const p = await mkPage('struct-wand');
  const id = await addOutcrop(p);
  await p.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), id);
  await p.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e) => /structure ·/.test(e.querySelector('.fwin-head .t').textContent) && /streamed/.test(e.textContent)));
  // the window offers the promotion itself
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => /structure ·/.test(e.querySelector('.fwin-head .t').textContent)); [...w.querySelectorAll('button')].find((b2) => /Load exact/.test(b2.textContent)).click(); });
  await p.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'));
  await p.evaluate(() => document.querySelector('#pmOk').click());
  await p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return !!w; }, null, { timeout: 30000 });
  const ready = await p.evaluate((lid) => { const M = window._micro, L = M.layers().find((q) => q.id === lid); const col = (L.paintCols || []).find((c) => c.name === 'SET'); return { prepared: !!M.structureOf(L), col: !!col, sets: col ? col.dict.filter((d, i) => i && d).join(',') : '' }; }, id);
  chk(`the window promotes the streamed outcrop from inside itself, prepares it, and starts a SET column (${JSON.stringify(ready)})`, ready.prepared && ready.col && ready.sets === 'J1');

  // arm, hover face A: a preview and its attitude before anything is committed
  // the window floats over the middle of the view; park it where it doesn't cover the outcrop (pointer events go to whatever is on top)
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); w.style.visibility = 'hidden'; });
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('button')].find((b2) => /paint/.test(b2.textContent)).click(); });
  const [ax, ay] = await toPage(p, FACE_A);
  await p.mouse.move(ax - 3, ay); await p.mouse.move(ax, ay);
  await p.waitForFunction(() => /wand → J1: 090\/30/.test(document.querySelector('#meta').textContent), null, { timeout: 15000 })
    .catch(async () => console.log('      META:', await p.evaluate(() => document.querySelector('#meta').textContent), [ax, ay], await p.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })));
  const hover = await p.evaluate(() => ({ meta: document.querySelector('#meta').textContent, planes: [...document.querySelectorAll('.fwin')].find((e) => e._structure)._structure.planes.length }));
  chk(`hovering face A previews the region and its attitude, committing nothing (“${hover.meta.slice(0, 60)}”, ${hover.planes} planes)`, /090\/30/.test(hover.meta) && hover.planes === 0);

  await p.mouse.click(ax, ay);
  await p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === 1; }, null, { timeout: 15000 });
  let pl = await planesOf(p);
  chk(`one wand click on face A measures ONE plane at 090/30 (got ${pl[0].dip_direction.toFixed(2)}/${pl[0].dip.toFixed(2)}, ${pl[0].n_vertices} vertices, e₂/e₁ ${pl[0].eig_ratio.toExponential(1)})`,
    azd(pl[0].dip_direction, 90) < 0.5 && Math.abs(pl[0].dip - 30) < 0.5 && pl[0].n_vertices >= 150 && pl[0].eig_ratio < 1e-6 && pl[0].set === 'J1');
  // the fit points out of the rock: the mesh is wound counter-clockwise seen from above
  chk(`the plane's normal keeps its polarity — out of the rock, upward here (nz ${pl[0].nz.toFixed(3)})`, pl[0].nz > 0.8);

  // a second set on face B
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('button')].find((b2) => b2.textContent === '+ set').click(); });
  const [bx, by] = await toPage(p, FACE_B);
  await p.mouse.move(bx - 3, by); await p.mouse.click(bx, by);
  await p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === 2; }, null, { timeout: 15000 });
  pl = await planesOf(p);
  const B = pl.find((q) => q.set === 'J2');
  chk(`set J2 on face B measures 270/60 (got ${B && B.dip_direction.toFixed(2)}/${B && B.dip.toFixed(2)}); J1 stays put`,
    B && azd(B.dip_direction, 270) < 0.5 && Math.abs(B.dip - 60) < 0.5 && pl.some((q) => q.set === 'J1' && Math.abs(q.dip - 30) < 0.5));
  // the fold stops the wand: by POSITION, no J1 vertex past it and no J2 vertex before it
  const bySide = () => p.evaluate(async (lid) => {
    const M = window._micro, L = M.layers().find((q) => q.id === lid), col = L.paintCols.find((c) => c.name === 'SET');
    const m = await M.meshVertexData(L), x0 = 500000;
    const o = { j1: 0, j2: 0, j1past: 0, j2before: 0 };
    for (let i = 0; i < col.codes.length; i++) {
      const x = m.vertices[3 * i] - x0, c = col.codes[i];
      if (c === 1) { o.j1++; if (x > 10) o.j1past++; }
      if (c === 2) { o.j2++; if (x < 10) o.j2before++; }
    }
    return o;
  }, id);
  const side = await bySide();
  chk(`the wand stopped at the fold: no J1 vertex beyond it (${side.j1past}), no J2 vertex before it (${side.j2before}); J1 ${side.j1}, J2 ${side.j2} of 441`,
    side.j1past === 0 && side.j2before === 0 && side.j1 > 150 && side.j2 > 150);

  // the discs: a derived layer, one fan per plane
  const discs = await p.evaluate((lid) => { const M = window._micro, D = M.layers().find((q) => q.derivedOf === lid); return D ? { n: M.renderer.layerElementCount(D.id), name: D.name } : null; }, id);
  chk(`plane discs are drawn as a derived layer (${discs && discs.name}: ${discs && discs.n} triangles = 2 × 32)`, discs && discs.n === 64);

  // undo takes the last plane back; redo restores it — the app's own keys
  const nPlanes = async () => (await planesOf(p)).length;
  const waitPlanes = (n) => p.waitForFunction((k) => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === k; }, n, { timeout: 15000 }).then(() => true, () => false);
  await p.keyboard.press('Control+z');
  const undone = await waitPlanes(1);
  await p.keyboard.press('Control+y');
  const redone = await waitPlanes(2);
  chk(`Ctrl+Z takes the second plane back (2 → 1: ${undone}); Ctrl+Y restores it (${redone}, ${await nPlanes()} planes)`, undone && redone);

  // erase: the wand on a painted face unpaints the face
  const tool = (name) => p.evaluate((nm) => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('.st-tools button')].find((b2) => b2.textContent === nm).click(); }, name);
  await tool('erase');
  await p.mouse.move(bx - 3, by); await p.mouse.click(bx, by);
  const erased = await waitPlanes(1);
  const afterErase = await bySide();
  chk(`erase + click on face B unpaints it (${afterErase.j2} J2 vertices left, ${await nPlanes()} plane)`, erased && afterErase.j2 === 0 && afterErase.j1 === side.j1);

  // the brush: a drag paints only under the circle and only along the surface
  await tool('brush');
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); const i = [...w.querySelectorAll('.sw-row')].find((r) => /radius/.test(r.textContent)).querySelector('input'); i.value = '2'; i.dispatchEvent(new Event('change')); });
  const [b0x, b0y] = await toPage(p, [500015, 7000007, FACE_B[2]]);
  const [b1x, b1y] = await toPage(p, [500015, 7000013, FACE_B[2]]);
  await p.mouse.move(b0x, b0y); await p.mouse.down();
  for (let k = 1; k <= 8; k++) { await p.mouse.move(b0x + (b1x - b0x) * k / 8, b0y + (b1y - b0y) * k / 8); await p.waitForTimeout(40); }
  await p.waitForTimeout(150); await p.mouse.up();
  const brushed = await waitPlanes(2);
  const bp = (await planesOf(p)).find((q) => q.set === 'J2');
  const afterBrush = await bySide();
  chk(`a brush stroke down face B paints a band (${afterBrush.j2} vertices, none across the fold: ${afterBrush.j2before}) that measures 270/60 (${bp && bp.dip_direction.toFixed(1)}/${bp && bp.dip.toFixed(1)})`,
    brushed && bp && azd(bp.dip_direction, 270) < 0.5 && Math.abs(bp.dip - 60) < 0.5 && afterBrush.j2 > 10 && afterBrush.j2 < side.j2 && afterBrush.j2before === 0);
  const painted = { j1: afterBrush.j1, j2: afterBrush.j2 };

  // ⇧ + wheel sizes the armed brush (2 notches up: 2 × 1.15² ≈ 2.65) and the camera does NOT dolly
  const camBefore = await p.evaluate(() => window.micro.view().distance);
  await p.mouse.move(b0x, b0y); await p.keyboard.down('Shift');
  for (let k = 0; k < 2; k++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(60); }
  await p.keyboard.up('Shift'); await p.waitForTimeout(200);
  const rad = await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return +[...w.querySelectorAll('.sw-row')].find((r) => /radius/.test(r.textContent)).querySelector('input').value; });
  const camAfter = await p.evaluate(() => window.micro.view().distance);
  chk(`⇧ + wheel sizes the brush (2 → ${rad} m) without moving the camera (${camBefore.toFixed(2)} → ${camAfter.toFixed(2)})`, Math.abs(rad - 2.65) < 0.02 && Math.abs(camAfter - camBefore) < 1e-6);

  // the table layer: CAPIVARAS's columns + set + the signed normal; replace-on-name
  await p.evaluate((lid) => window._micro.planesToTable(window._micro.layers().find((q) => q.id === lid)), id);
  await p.evaluate((lid) => window._micro.planesToTable(window._micro.layers().find((q) => q.id === lid)), id);
  const tbl = await p.evaluate(() => { const M = window._micro, T = M.layers().filter((q) => q.kind === 'table'); const h = T[0] && M.attrColumnsOf ? null : null; void h; return T.map((q) => ({ name: q.name, cols: (q.docs.tableDoc && q.docs.tableDoc.header && q.docs.tableDoc.header.columns) || (q.docs.blockDoc && q.docs.blockDoc.header.columns) || null, lin: q.lineage && q.lineage.op })); });
  chk(`→ table layer, run twice, leaves ONE planes table with the capivaras columns + set + signed normal (${JSON.stringify(tbl.map((t) => [t.name, t.cols && t.cols.length, t.lin]))})`,
    tbl.length === 1 && /planes/.test(tbl[0].name) && tbl[0].cols && ['plane_id', 'set', 'dip_direction', 'dip', 'X', 'Y', 'Z', 'nx', 'ny', 'nz', 'eig0', 'eig1', 'eig2', 'n_vertices', 'average_resultant_length', 'radius', 'kappa'].every((c) => tbl[0].cols.includes(c)) && tbl[0].lin === 'structure.planes');
  // κ on these exactly-flat faces is huge or ∞: the table holds it as the window
  // shows it (capped at 10⁵), never blank as if the fit were missing
  const kap = await p.evaluate(async (lid) => {
    const M = window._micro, T = M.layers().find((q) => q.kind === 'table');
    const lines = (await T.docs.tableDoc.blob.text()).trim().split('\n'), k = lines[0].split(',').map((s) => s.replace(/"/g, '')).indexOf('kappa');
    const planes = M.layers().find((q) => q.id === lid)._structView.planes;
    return lines.slice(1).map((ln, r) => ({ plane: planes[r].kappa === Infinity ? 'Infinity' : planes[r].kappa, table: ln.split(',')[k] }));
  }, id);
  chk(`κ in the table is a number for every fitted plane, capped at 10⁵ (${JSON.stringify(kap)})`,
    kap.length > 0 && kap.every((x) => x.table !== '' && Number.isFinite(+x.table) && +x.table <= 1e5 && (x.plane === 'Infinity' || +x.plane > 1e5 ? +x.table === 1e5 : Math.abs(+x.table - x.plane) <= 1e-6 * x.plane)));

  // persistence: the sets are paint, so they come back; the discs are a view, so they're not saved
  await saveProject(p);
  await p.close();
  const p2 = await mkPage('struct-wand');
  if (process.env.NET_DUMP) await p2.evaluate(() => { window.__dumpNet = true; });
  await p2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('struct-wand'); await window._micro.openProjectDir(dir); });
  await p2.waitForFunction(() => window._micro.layers().some((L) => L.kind === 'mesh' && L.docs.meshDoc && (L.paintCols || []).some((c) => c.name === 'SET')), null, { timeout: 60000 });
  const re = await p2.evaluate(() => { const M = window._micro; const L = M.layers().find((q) => q.kind === 'mesh' && !q.derivedOf); const col = L.paintCols.find((c) => c.name === 'SET'); return { id: L.id, sets: col.dict.filter((d, i) => i && d), j1: col.counts[1], j2: col.counts[2], derived: M.layers().filter((q) => q.derivedOf != null).length, soup: !!L.docs.meshDoc.header.soup }; });
  chk(`the project reopens with its sets painted (${re.sets.join(',')}: ${re.j1} + ${re.j2}), exact, and no saved copy of the discs (${re.derived} derived layers)`, re.sets.join(',') === 'J1,J2' && re.j1 === painted.j1 && re.j2 === painted.j2 && re.derived === 0 && !re.soup);
  await p2.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), re.id);
  await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === 2; }, null, { timeout: 30000 });
  const pl2 = await planesOf(p2);
  chk(`…and re-measures the same two planes from the paint (${pl2.map((q) => `${q.set} ${q.dip_direction.toFixed(1)}/${q.dip.toFixed(1)}`).join(', ')})`,
    pl2.length === 2 && pl2.some((q) => q.set === 'J1' && Math.abs(q.dip - 30) < 0.5) && pl2.some((q) => q.set === 'J2' && Math.abs(q.dip - 60) < 0.5));

  // ═══ 3. the stereonet, linked both ways; colour by orientation ═══
  const sw = () => p2.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._stereo); return w ? w._stereo : null; });
  await p2.evaluate((lid) => window._micro.openStereonet(window._micro.layers().find((q) => q.id === lid)), re.id);
  await p2.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e) => e._stereo));
  // where the poles land, read back through bearing's own projection (SVG coords → which side of the net)
  const where = await p2.evaluate((lid) => {
    const hd = window._micro.structureWins.get(lid), sn = hd.stereo.sn, c = 300 / 2;
    return hd.planes.map((q) => { const n = q.nz > 0 ? [-q.nx, -q.ny, -q.nz] : [q.nx, q.ny, q.nz]; const pr = sn.project(n); return { set: q.set, dx: pr.x - c, dy: pr.y - c }; });
  }, re.id);
  const s0 = await sw();
  const w1 = where.find((q) => q.set === 'J1'), w2 = where.find((q) => q.set === 'J2');
  // a plane dipping 30° toward 090 has its pole plunging 60° toward 270 (west, near the centre);
  // one dipping 60° toward 270 has its pole plunging 30° toward 090 (east, near the rim)
  chk(`the net plots one pole per plane: J1 (090/30) west of centre, J2 (270/60) east and further out (J1 dx ${w1.dx.toFixed(0)}, J2 dx ${w2.dx.toFixed(0)}; legend ${JSON.stringify(s0.sets)})`,
    s0.poles === 2 && w1.dx < -10 && Math.abs(w1.dy) < 3 && w2.dx > Math.abs(w1.dx) && Math.abs(w2.dy) < 3 && /J1 · 1 · 090\/30/.test(s0.sets[0]) && /J2 · 1 · 270\/60/.test(s0.sets[1]));


  // ⇥ figure: the net on paper, recorded through bearing's draw(ctx) into a draw list → a vector composer frame
  const fig = await p2.evaluate(async (lid) => {
    const M_ = window._micro, hd = M_.structureWins.get(lid);
    const list = hd.stereo.toFigure();
    const ed = M_.openComposer('net');
    [...hd.stereo.win.el.querySelectorAll('button')].find((b2) => b2.textContent === '⇥ figure').click();
    const fr = ed.getDoc().frames.find((f) => f.kind === 'drawlist');
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    const out = { ops: list.ops.length, w: list.width, h: list.height, frame: !!fr, images: (s.match(/\/Subtype \/Image/g) || []).length, n: /\(N\) Tj/.test(s), j1: /J1 [^)]*090\/30/.test(s), domBack: !!hd.stereo.sn.element().querySelector('circle') };
    if (window.__dumpNet) { const C = await import('/ext/compo/index.js'); const png = await C.exportPNG(M_.currentFigure().doc, { dpi: 200 }); out.png = await new Promise((res) => { const f2 = new FileReader(); f2.onload = () => res(f2.result); f2.readAsDataURL(png); }); }
    const cw = document.querySelector('.composer-win'); if (cw) cw.querySelector('.fwin-head button:last-child').click();   // out of the way of the lasso below
    return out;
  }, re.id);
  if (fig.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.NET_DUMP, Buffer.from(fig.png.split(',')[1], 'base64')); }
  chk(`⇥ figure: the net as a draw list (${fig.ops} ops, ${fig.w}×${fig.h}) → a vector frame; the PDF has no image, the cardinals and the set means as text (${JSON.stringify({ frame: fig.frame, images: fig.images, n: fig.n, j1: fig.j1 })}); the window's net is back (${fig.domBack})`,
    fig.ops > 50 && fig.frame && fig.images === 0 && fig.n && fig.j1 && fig.domBack);

  // lasso J1's pole on the net → select → move it to a NEW set: the paint follows, one undo step
  const box = await p2.evaluate((lid) => { const hd = window._micro.structureWins.get(lid); const r = hd.stereo.sn.element().getBoundingClientRect(); return [r.left, r.top, r.width]; }, re.id);
  const k = box[2] / 300, cx = box[0] + 150 * k, cy = box[1] + 150 * k, px = cx + w1.dx * k;
  await p2.mouse.move(px - 14, cy - 14); await p2.mouse.down();
  for (const [dx, dy] of [[14, -14], [14, 14], [-14, 14], [-14, -14]]) await p2.mouse.move(px + dx, cy + dy, { steps: 4 });
  await p2.mouse.up();
  const s1 = await sw();
  await p2.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._stereo); const sel = w.querySelector('select'); sel.value = 'new'; [...w.querySelectorAll('button')].find((b2) => b2.textContent === 'move').click(); });
  await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.some((q) => q.set === 'J3'); }, null, { timeout: 15000 });
  const moved = await planesOf(p2);
  const j3 = moved.find((q) => q.set === 'J3');
  chk(`a lasso on the net selects J1's pole (${s1.sel} selected) and “move → + new set” repaints that plane as J3 (${moved.map((q) => `${q.set} ${q.dip_direction.toFixed(0)}/${q.dip.toFixed(0)}`).join(', ')})`,
    s1.sel === 1 && j3 && Math.abs(j3.dip - 30) < 0.5 && !moved.some((q) => q.set === 'J1') && moved.length === 2);

  // the stereonet frame keeps its layer: ↻ refresh measures the planes again and redraws the net — J3 is on it now
  const reNet = await p2.evaluate(async () => {
    const M_ = window._micro, fig = M_.figures().find((f) => f.name === 'net'), fr = fig.doc.frames.find((f) => f.kind === 'drawlist');
    const had = JSON.stringify(fr.content.list.ops).includes('J3');
    const n = await M_.refreshData(fig);
    const fr2 = fig.doc.frames.find((f) => f.kind === 'drawlist');
    return { source: fr2.source.stereonet, n, had, has: JSON.stringify(fr2.content.list.ops).includes('J3'), stale: M_.staleOf(fr2), open: [...document.querySelectorAll('.fwin')].filter((e) => e._stereo).length };
  });
  chk(`a stereonet frame keeps its layer (${JSON.stringify(reNet.source)}); ↻ refresh redraws it from the sets as they are now — J3 before ${reNet.had}, after ${reNet.has}; the window stays as it was (${reNet.open})`, reNet.source && reNet.n === 1 && !reNet.had && reNet.has && reNet.stale === null && reNet.open === 1);
  await p2.keyboard.press('Control+z');
  const back = await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.some((q) => q.set === 'J1'); }, null, { timeout: 10000 }).then(() => true, () => false);
  chk(`Ctrl+Z puts the plane back in J1 (${back})`, back);

  // 3D → net: hovering the rock with the wand puts a ghost pole on the net. Face B's
  // unpainted part (only a brush band of it is J2) — a ghost at 270/60.
  await p2.evaluate(() => { for (const w of document.querySelectorAll('.fwin')) if (w._structure || w._stereo) w.style.visibility = 'hidden'; });
  await p2.evaluate(() => { const d = document.querySelector('#plDlg'); if (d && d.classList.contains('show')) document.querySelector('#plClose').click(); });   // the reopen's report, over the view
  await p2.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); const radios = w.querySelectorAll('.st-set input[type=radio]'); radios[radios.length - 1].click(); [...w.querySelectorAll('.st-tools button')].find((b2) => b2.textContent === 'wand').click(); });
  // (clicking a tool arms it — the ghost is the armed wand's preview)
  const [gx, gy] = await toPage(p2, [500018, 7000003, 800 - t30 * 10 + t60 * 8]);
  await p2.mouse.move(gx - 3, gy); await p2.mouse.move(gx, gy);
  const ghost = await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._stereo); return w && w._stereo.ghost; }, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
  chk(`hovering face B with the wand shows its plane on the net as a ghost pole (${ghost ? `${ghost.dd.toFixed(1)}/${ghost.dip.toFixed(1)}` : 'none'})`, ghost && azd(ghost.dd, 270) < 1 && Math.abs(ghost.dip - 60) < 1);

  // colour by orientation: an unpainted vertex on face B takes hue = 270 (dip direction),
  // saturation = 60/90 — purple (r .63, g .32, b .95), computed from the dip, not the paint
  await p2.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('label')].find((l) => /orientation/.test(l.textContent)).querySelector('input').click(); });
  await p2.waitForTimeout(400);
  const rgb = await p2.evaluate(async (lid) => {
    const M = window._micro, L = M.layers().find((q) => q.id === lid), hd = M.structureWins.get(lid);
    const m = await M.meshVertexData(L), col = L.paintCols.find((c) => c.name === 'SET');
    for (let i = 0; i < col.codes.length; i++) {
      const x = m.vertices[3 * i] - 500000, y = m.vertices[3 * i + 1] - 7000000;
      if (x === 17 && y === 18 && !col.codes[i]) return [hd.rgb[3 * i], hd.rgb[3 * i + 1], hd.rgb[3 * i + 2]];
    }
    return null;
  }, re.id);
  chk(`colour by orientation: an unpainted vertex on the 270/60 face is purple (${rgb && rgb.map((v) => v.toFixed(2)).join(', ')})`,
    rgb && Math.abs(rgb[0] - 0.633) < 0.06 && Math.abs(rgb[1] - 0.317) < 0.06 && Math.abs(rgb[2] - 0.95) < 0.03);
  await p2.close();
}

// ═══ 4. ply2atti: an outcrop PAINTED in saturated colours (the predecessor's MeshLab
//     workflow) becomes sets — face A red, face B blue, the rest photographic grey ═══
{
  const p = await mkPage(null);
  const ply = (() => {
    const { V, T } = OUTCROP, nv = V.length / 3, out = ['ply', 'format ascii 1.0', `element vertex ${nv}`, 'property double x', 'property double y', 'property double z',
      'property uchar red', 'property uchar green', 'property uchar blue', `element face ${T.length / 3}`, 'property list uchar int vertex_indices', 'end_header'];
    let rng = 11; const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % 9);
    for (let i = 0; i < nv; i++) {
      const x = V[3 * i] - 500000;
      const rgb = x <= 8 ? [255, 0, 0] : x >= 12 ? [0, 0, 255] : [118 + rand(), 112 + rand(), 104 + rand()];   // grey has jitter, like a photo
      out.push(`${V[3 * i]} ${V[3 * i + 1]} ${V[3 * i + 2]} ${rgb.join(' ')}`);
    }
    for (let t = 0; t < T.length; t += 3) out.push(`3 ${T[t]} ${T[t + 1]} ${T[t + 2]}`);
    return out.join('\n') + '\n';
  })();
  const id = await p.evaluate((txt) => window._micro.openBlob(new File([txt], 'painted.ply'), 'painted.ply', 'replace'), ply);
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L && L.docs.meshDoc; }, id);
  await p.evaluate((lid) => window._micro.convertMeshLayer(window._micro.layers().find((q) => q.id === lid), false, { confirmed: true }), id);   // over ?ctxcap → exact
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L && !L.docs.meshDoc.header.soup && L.vertexColored; }, id, { timeout: 30000 });
  await p.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), id);
  await p.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e) => e._structure));
  const offered = await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); const b2 = [...w.querySelectorAll('button')].find((x) => /sets from paint/.test(x.textContent)); if (b2) b2.click(); return !!b2; });
  await p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === 2; }, null, { timeout: 15000 }).catch(() => {});
  const pl = (await planesOf(p)) || [];
  const sets = await p.evaluate((lid) => { const L = window._micro.layers().find((q) => q.id === lid), col = L.paintCols.find((c) => c.name === 'SET'); return col.dict.map((d, i) => (i && d ? `${d}:${col.counts[i]}:${col.colors[i]}` : null)).filter(Boolean); }, id);
  const red = pl.find((q) => q.set === 'red'), blue = pl.find((q) => q.set === 'blue');
  chk(`a mesh painted in pure colours offers “sets from paint” (${offered}); red and blue become sets, the jittered grey doesn't (${sets.join(' · ')})`,
    offered && sets.length === 2 && sets.includes('red:189:#ff0000') && sets.includes('blue:189:#0000ff'));   // (detectSets orders by colour key: blue 001 before red 100)
  chk(`…and measure as planes: red ${red && `${red.dip_direction.toFixed(1)}/${red.dip.toFixed(1)}`}, blue ${blue && `${blue.dip_direction.toFixed(1)}/${blue.dip.toFixed(1)}`}`,
    red && blue && azd(red.dip_direction, 90) < 0.5 && Math.abs(red.dip - 30) < 0.5 && azd(blue.dip_direction, 270) < 0.5 && Math.abs(blue.dip - 60) < 0.5);
  await p.close();
}

// ═══ 5. traces: a fracture with no exposed face, clicked along its line across the
//     fold. P is the plane through the fold vertex (10,10) containing face A's mesh
//     DIAGONAL (1, 1, −tan30) and face B's x-edges (1, 0, tan60) — chosen so the surface
//     path between clicks runs along mesh edges and lies exactly on P. (A trace oblique
//     to a coarse grid zigzags across triangles: on this 1 m grid that read 009/64 for
//     a true 000/60. On a real mesh the edges are cm and the trace is metres.) ═══
{
  const p = await mkPage('struct-trace');
  const id = await addOutcrop(p);
  await p.evaluate((lid) => window._micro.convertMeshLayer(window._micro.layers().find((q) => q.id === lid), false, { confirmed: true }), id);
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L && !L.docs.meshDoc.header.soup; }, id, { timeout: 30000 });
  await p.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), id);
  await p.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e) => e._structure), null, { timeout: 30000 });
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('.st-tools button')].find((b2) => b2.textContent === 'trace').click(); w.style.visibility = 'hidden'; });
  const zAt = (x) => (x <= 10 ? 800 - t30 * x : 800 - t30 * 10 + t60 * (x - 10));
  const clickAt = async (x, y, opts) => { const [px, py] = await toPage(p, [500000 + x, 7000000 + y, zAt(x)]); await p.mouse.move(px - 2, py); await p.mouse.click(px, py, opts); await p.waitForTimeout(120); };
  // plan view: from the default oblique camera, face B hides part of face A (a click 'on' (7,7)
  // honestly hits face B in front of it)
  await p.keyboard.press('d'); await p.waitForTimeout(200);
  for (const [x, y] of [[4, 4], [7, 7], [10, 10], [13, 10]]) await clickAt(x, y);
  const [lx, ly] = await toPage(p, [500017, 7000010, zAt(17)]);
  await p.mouse.move(lx - 2, ly); await p.mouse.dblclick(lx, ly);
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L.traces && L.traces.length === 1; }, id, { timeout: 10000 });
  let pl = await planesOf(p);
  let tp = pl.find((q) => q.source === 'trace');
  const tr = await p.evaluate((lid) => { const L = window._micro.layers().find((q) => q.id === lid); const D = window._micro.layers().find((q) => q.derivedOf === lid && q.derivedKind === 'traces'); return { pts: L.traces[0].pts.length, path: L.traces[0].path.length, tubes: D ? window._micro.renderer.layerElementCount(D.id) : 0 }; }, id);
  // P's attitude, from its two in-plane directions
  const PA = (() => { const d1 = [1, 1, -t30], d2 = [1, 0, t60]; let n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]]; if (n[2] < 0) n = n.map((v) => -v); const L = Math.hypot(...n); n = n.map((v) => v / L); return { dd: (Math.atan2(n[0], n[1]) * 180 / Math.PI + 360) % 360, dip: Math.acos(n[2]) * 180 / Math.PI }; })();
  chk(`a trace clicked along P across the fold (${tr.pts} points, ${tr.path} path vertices, drawn as ${tr.tubes} tube triangles) fits P: ${tp && `${tp.dip_direction.toFixed(2)}/${tp.dip.toFixed(2)}`} vs ${PA.dd.toFixed(2)}/${PA.dip.toFixed(2)}, flags [${tp && tp.flags}]`,
    tr.pts === 5 && tr.path === 14 && tr.tubes > 0 && tp && azd(tp.dip_direction, PA.dd) < 0.5 && Math.abs(tp.dip - PA.dip) < 0.5 && !tp.flags.includes('straight'));

  // a straight trace fixes a strike and nothing else — it says so
  for (const [x, y] of [[4, 3]]) await clickAt(x, y);
  const [sx2, sy2] = await toPage(p, [500004, 7000017, zAt(4)]);
  await p.mouse.move(sx2 - 2, sy2); await p.mouse.dblclick(sx2, sy2);
  await p.waitForFunction((lid) => window._micro.layers().find((q) => q.id === lid).traces.length === 2, id, { timeout: 10000 });
  pl = await planesOf(p);
  const straight = pl.filter((q) => q.source === 'trace')[1];
  chk(`a straight trace (along y at x = 4) is flagged “straight”, not reported with a confident dip (flags [${straight && straight.flags}])`, straight && straight.flags.includes('straight'));

  // Ctrl+Z takes the last trace back (the trace tool is armed: the shared history, not paint)
  await p.keyboard.press('Control+z');
  const undone = await p.waitForFunction((lid) => window._micro.layers().find((q) => q.id === lid).traces.length === 1, id, { timeout: 5000 }).then(() => true, () => false);
  chk(`Ctrl+Z takes the straight trace back (${undone})`, undone);

  // Backspace drops a point mid-trace; Esc abandons it
  await clickAt(1, 7); await clickAt(4, 8); await clickAt(7, 9);
  await p.keyboard.press('Backspace');
  const mid = await p.evaluate((lid) => { const hd = window._micro.structureWins.get(lid); return hd.drawing ? hd.drawing.pts.length : -1; }, id);
  await p.keyboard.press('Escape');
  const after = await p.evaluate((lid) => { const hd = window._micro.structureWins.get(lid), L = window._micro.layers().find((q) => q.id === lid); return { drawing: !!hd.drawing, traces: L.traces.length, armed: !!window._micro.structureArmed() }; }, id);
  chk(`mid-trace: Backspace drops the last point (3 → ${mid}); Esc abandons the trace without committing it (${JSON.stringify(after)})`, mid === 2 && !after.drawing && after.traces === 1 && after.armed);

  // DXF out: read back by @gcu/dxf's own reader, not micro's — one 3D polyline on layer J1, world coordinates
  const dxf = await p.evaluate(async (lid) => {
    const M = window._micro, txt = await M.tracesToDxf(M.layers().find((q) => q.id === lid));
    const { read } = await import('/ext/dxf/index.js');
    const doc = read(txt), pl = doc.features.filter((ft) => ft.type === 'polyline' && ft.geometry);
    const v = pl[0] && pl[0].geometry.vertices;
    return { n: pl.length, verts: v ? v.length / 3 : 0, layer: pl[0] && pl[0].properties.layer, first: v ? [v[0], v[1], v[2]] : null };
  }, id);
  chk(`⇥ traces .dxf: one 3D polyline on layer ${dxf.layer} with the path's ${dxf.verts} vertices, in world coordinates (${dxf.first && dxf.first.map((x) => x.toFixed(2)).join(', ')})`,
    dxf.n === 1 && dxf.verts === 14 && dxf.layer === 'J1' && dxf.first && Math.abs(dxf.first[0] - 500004) < 1e-6 && Math.abs(dxf.first[1] - 7000004) < 1e-6 && Math.abs(dxf.first[2] - zAt(4)) < 1e-6);

  // traces persist with the project and re-measure on reopen
  await saveProject(p);
  await p.close();
  const p2 = await mkPage('struct-trace');
  await p2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('struct-trace'); await window._micro.openProjectDir(dir); });
  await p2.waitForFunction(() => window._micro.layers().some((L) => L.kind === 'mesh' && L.traces && L.traces.length), null, { timeout: 60000 });
  const rid = await p2.evaluate(() => window._micro.layers().find((q) => q.kind === 'mesh' && !q.derivedOf).id);
  await p2.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), rid);
  await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.some((q) => q.source === 'trace'); }, null, { timeout: 30000 });
  const tp2 = (await planesOf(p2)).find((q) => q.source === 'trace');
  chk(`the trace reopens with the project and re-measures the same plane (${tp2.dip_direction.toFixed(1)}/${tp2.dip.toFixed(1)} = ${tp.dip_direction.toFixed(1)}/${tp.dip.toFixed(1)})`,
    Math.abs(tp2.dip - tp.dip) < 1e-6 && azd(tp2.dip_direction, tp.dip_direction) < 1e-6);
  // and × in its table row deletes it (undoably)
  await p2.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('td')].find((td) => td.textContent === '×').click(); });
  const gone = await p2.waitForFunction((lid) => window._micro.layers().find((q) => q.id === lid).traces.length === 0, rid, { timeout: 5000 }).then(() => true, () => false);
  chk(`× on a trace's row deletes it (${gone})`, gone);
  await p2.close();
}

// ═══ 6. the trace network: I/Y/X nodes (Sanderson & Nixon). On face A, in plan view:
//     T1 (J1) along y = 10, T2 (J1) along x = 5 — they cross at (5,10): an X.
//     T3 (J2) climbs from (7,3) and is ended by a click NEAR T1 whose nearest mesh corner
//     is (8,9), off the trace — snapping puts its end ON T1 at (8,10): a Y, J2 against J1.
//     Without the snap it would be one more I and no Y. ═══
{
  const p = await mkPage();
  const id = await addOutcrop(p);
  await p.evaluate((lid) => window._micro.convertMeshLayer(window._micro.layers().find((q) => q.id === lid), false, { confirmed: true }), id);
  await p.waitForFunction((lid) => { const L = window._micro.layers().find((q) => q.id === lid); return L && !L.docs.meshDoc.header.soup; }, id, { timeout: 30000 });
  await p.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), id);
  await p.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e) => e._structure), null, { timeout: 30000 });
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('.st-tools button')].find((b2) => b2.textContent === 'trace').click(); w.style.visibility = 'hidden'; });
  const zAt = (x) => (x <= 10 ? 800 - t30 * x : 800 - t30 * 10 + t60 * (x - 10));
  await p.keyboard.press('d'); await p.waitForTimeout(200);
  // zoom out until a metre is ~7 px, so the snap (10 px) reaches 0.9 m off the line
  const pxm = async () => { const [a0] = await toPage(p, [500000, 7000010, zAt(0)]); const [a1] = await toPage(p, [500010, 7000010, zAt(10)]); return Math.abs(a1 - a0) / 10; };
  const m0 = await pxm();
  await p.evaluate((k) => { const M = window._micro, o = M.frame.origin, c = [500010 - o[0], 7000010 - o[1], 795 - o[2]], h = 10 * k; M.cam.fit([c[0] - h, c[1] - h, c[2] - h, c[0] + h, c[1] + h, c[2] + h]); M.requestRender(); }, m0 / 7);
  await p.waitForTimeout(200);
  const m1 = await pxm();
  const clickAt = async (x, y) => { const [px, py] = await toPage(p, [500000 + x, 7000000 + y, zAt(x)]); await p.mouse.move(px - 2, py); await p.mouse.click(px, py); await p.waitForTimeout(120); };
  const finishAt = async (x, y, n) => {
    const [px, py] = await toPage(p, [500000 + x, 7000000 + y, zAt(x)]);
    await p.mouse.move(px - 2, py); await p.mouse.dblclick(px, py);
    await p.waitForFunction(([lid, k]) => (window._micro.layers().find((q) => q.id === lid).traces || []).length === k, [id, n], { timeout: 10000 });
  };
  await clickAt(1, 10); await finishAt(9, 10, 1);
  await clickAt(5, 2); await finishAt(5, 18, 2);
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); [...w.querySelectorAll('button')].find((b2) => b2.textContent === '+ set').click(); });
  await clickAt(7, 3); await finishAt(7.8, 9.1, 3);
  const net = await p.evaluate(() => [...document.querySelectorAll('.fwin')].find((e) => e._structure)._structure.network);
  const end3 = await p.evaluate((lid) => { const t = window._micro.layers().find((q) => q.id === lid).traces[2]; return t.path[t.path.length - 1]; }, id);
  const nodes = await p.evaluate((lid) => { const D = window._micro.layers().find((q) => q.derivedOf === lid && q.derivedKind === 'nodes'); return D ? window._micro.renderer.layerElementCount(D.id) : 0; }, id);
  chk(`at ${m1.toFixed(1)} px/m (from ${m0.toFixed(1)}), a click 0.9 m off T1 snaps onto it: T3 ends at vertex ${end3} (= (8,10) → ${10 * 21 + 8})`, end3 === 10 * 21 + 8);
  chk(`the network: I ${net && net.counts.I} · Y ${net && net.counts.Y} · X ${net && net.counts.X} (want 5 · 1 · 1); branches ${net && net.branches} (6), lines ${net && net.lines} (3), C_L ${net && net.CL.toFixed(2)} (1.33)`,
    net && net.counts.I === 5 && net.counts.Y === 1 && net.counts.X === 1 && net.branches === 6 && net.lines === 3 && Math.abs(net.CL - 4 / 3) < 1e-9);
  chk(`abutment: J2 ends against J1 once (${JSON.stringify(net && net.abut)}); 7 node markers drawn (${nodes} triangles = 7 × 8)`,
    net && net.abut[2] && net.abut[2][1] === 1 && Object.keys(net.abut).length === 1 && nodes === 56);
  // the window shows it: counts and the I–Y–X triangle
  const panel = await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); const el = w.querySelector('.st-net'); return el ? { text: el.textContent, dot: !!el.querySelector('svg circle') } : null; });
  chk(`the window's network panel: counts, C_B/C_L, “J2 ends against J1 ×1”, a point on the I–Y–X triangle`, panel && /I 5/.test(panel.text) && /Y 1/.test(panel.text) && /X 1/.test(panel.text) && /J2 ends against J1 ×1/.test(panel.text) && panel.dot);
  // a TOUCH is not a crossing. Around (5,14), T2 runs (5,13)→(5,15); a trace (4,13)→(5,14)→(4,14)
  // comes in and leaves on the same side; (4,13)→(5,14)→(6,15) goes through.
  const touch = await p.evaluate((lid) => {
    const M = window._micro, L = M.layers().find((q) => q.id === lid), st = M.structureOf(L), v = (i, j) => j * 21 + i;
    const base = [L.traces[1]];
    const t = M.traceNetwork(st, [...base, { set: 2, path: [v(4, 13), v(5, 14), v(4, 14)] }]);
    const c = M.traceNetwork(st, [...base, { set: 2, path: [v(4, 13), v(5, 14), v(6, 15)] }]);
    return { touch: t.counts, touches: t.touches, cross: c.counts, crossTouches: c.touches };
  }, id);
  chk(`a trace that touches T2 at a vertex and goes back is not a crossing (X ${touch.touch.X}, ${touch.touches} touch); one that goes through is (X ${touch.cross.X})`,
    touch.touch.X === 0 && touch.touches === 1 && touch.cross.X === 1 && touch.crossTouches === 0);
  await p.close();
}

console.log(`\nmicro-structure-smoke: ${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
