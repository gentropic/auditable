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

  // the table layer: CAPIVARAS's columns + set + the signed normal; replace-on-name
  await p.evaluate((lid) => window._micro.planesToTable(window._micro.layers().find((q) => q.id === lid)), id);
  await p.evaluate((lid) => window._micro.planesToTable(window._micro.layers().find((q) => q.id === lid)), id);
  const tbl = await p.evaluate(() => { const M = window._micro, T = M.layers().filter((q) => q.kind === 'table'); const h = T[0] && M.attrColumnsOf ? null : null; void h; return T.map((q) => ({ name: q.name, cols: (q.docs.tableDoc && q.docs.tableDoc.header && q.docs.tableDoc.header.columns) || (q.docs.blockDoc && q.docs.blockDoc.header.columns) || null, lin: q.lineage && q.lineage.op })); });
  chk(`→ table layer, run twice, leaves ONE planes table with the capivaras columns + set + signed normal (${JSON.stringify(tbl.map((t) => [t.name, t.cols && t.cols.length, t.lin]))})`,
    tbl.length === 1 && /planes/.test(tbl[0].name) && tbl[0].cols && ['plane_id', 'set', 'dip_direction', 'dip', 'X', 'Y', 'Z', 'nx', 'ny', 'nz', 'eig0', 'eig1', 'eig2', 'n_vertices', 'average_resultant_length', 'radius', 'kappa'].every((c) => tbl[0].cols.includes(c)) && tbl[0].lin === 'structure.planes');

  // persistence: the sets are paint, so they come back; the discs are a view, so they're not saved
  await saveProject(p);
  await p.close();
  const p2 = await mkPage('struct-wand');
  await p2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('struct-wand'); await window._micro.openProjectDir(dir); });
  await p2.waitForFunction(() => window._micro.layers().some((L) => L.kind === 'mesh' && L.docs.meshDoc && (L.paintCols || []).some((c) => c.name === 'SET')), null, { timeout: 60000 });
  const re = await p2.evaluate(() => { const M = window._micro; const L = M.layers().find((q) => q.kind === 'mesh' && !q.derivedOf); const col = L.paintCols.find((c) => c.name === 'SET'); return { id: L.id, sets: col.dict.filter((d, i) => i && d), j1: col.counts[1], j2: col.counts[2], derived: M.layers().filter((q) => q.derivedOf != null).length, soup: !!L.docs.meshDoc.header.soup }; });
  chk(`the project reopens with its sets painted (${re.sets.join(',')}: ${re.j1} + ${re.j2}), exact, and no saved copy of the discs (${re.derived} derived layers)`, re.sets.join(',') === 'J1,J2' && re.j1 === painted.j1 && re.j2 === painted.j2 && re.derived === 0 && !re.soup);
  await p2.evaluate((lid) => window._micro.openStructure(window._micro.layers().find((q) => q.id === lid)), re.id);
  await p2.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((e) => e._structure); return w && w._structure.planes.length === 2; }, null, { timeout: 30000 });
  const pl2 = await planesOf(p2);
  chk(`…and re-measures the same two planes from the paint (${pl2.map((q) => `${q.set} ${q.dip_direction.toFixed(1)}/${q.dip.toFixed(1)}`).join(', ')})`,
    pl2.length === 2 && pl2.some((q) => q.set === 'J1' && Math.abs(q.dip - 30) < 0.5) && pl2.some((q) => q.set === 'J2' && Math.abs(q.dip - 60) < 0.5));
  await p2.close();
}

console.log(`\nmicro-structure-smoke: ${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
