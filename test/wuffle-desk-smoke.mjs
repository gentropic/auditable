// wuffle DESK smoke — the workbench in a real browser, dev tree and the BUILT wuffle.html.
//   node test/wuffle-desk-smoke.mjs            (dev tree + built; build first: node build.js --target=wuffle)
// Checks behaviour, not looks: tocher opens as 200 planes drawn as 200 poles; the tree's nested checkboxes
// switch elements; a second net shows a VIEW of the same data, and a selection made on one shows on the
// other and in the table; a click on a pole selects its row; the theme switches; a project round-trips.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  fs.readFile(path.join(root, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch();
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };

for (const [label, url] of [['dev', '/tools/wuffle/index.html'], ['built', '/wuffle.html']]) {
  const p = await b.newPage({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark' });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wuffleDesk, null, { timeout: 20000 }).catch(() => {});
  const r = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('.rails-tab')].map((t) => t.textContent.trim()),
    // the field compass must not show NOR RUN on the desk (its module runs at import): every field element
    // has zero size, and the compass never set its brand line or its hook
    fieldHidden: [...document.body.children].filter((e) => e.id !== 'wdesk' && !/^(SCRIPT|STYLE)$/.test(e.tagName)).every((e) => e.getBoundingClientRect().height === 0)
      && !window.__wuffle && document.getElementById('brandsub')?.textContent !== 'stereonet · manual',
  })).catch((e) => ({ err: e.message }));
  // tocher through the File menu, as a person would
  await p.click('#wdesk .wmenus >> text=File');
  await p.click('.gcu-menu >> text=Open the tocher sample');
  await p.waitForTimeout(400);
  const s = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, out = {};
    const wait = (ms) => new Promise((z) => setTimeout(z, ms));
    const net1 = P.diagrams[0].id, ds = P.datasets[0];
    out.ds = ds && { name: ds.name, n: ds.rows.length, guessed: ds.meta.read.guessed };
    const host = () => W.views.get(net1).el;
    out.poles = host().querySelectorAll('.wn-pole, circle.wn-pole, [class*="pole"]').length;
    out.svgCircles = host().querySelectorAll('svg circle').length;
    // the nested checkboxes: open the layer, switch contours on from the tree
    const layerRow = document.querySelector('.wtree .wlayer');
    layerRow.querySelector('.wtw').click(); await wait(50);
    const contRow = [...document.querySelectorAll('.wtree .wel')].find((r) => /contours/.test(r.textContent));
    contRow.querySelector('.wcb').click(); await wait(200);
    out.contourOn = P.layers[0].elements.contours.on;
    out.contourPaths = host().querySelectorAll('svg path').length;
    // eigenvectors: one child → partial
    const eig = [...document.querySelectorAll('.wtree .wel')].find((r) => /eigenvectors/.test(r.textContent));
    eig.querySelector('.wtw').click(); await wait(50);
    const v1 = [...document.querySelectorAll('.wtree .wel2')].find((r) => /^\s*V1$/.test(r.querySelector('.wname').textContent));
    v1.querySelector('.wcb').click(); await wait(50);
    out.eigenState = [...document.querySelectorAll('.wtree .wel')].find((r) => /eigenvectors/.test(r.textContent)).querySelector('.wcb').className;
    // a second net, a VIEW of the same data
    const net2 = P.addDiagram('net'); await wait(300);
    P.addView(P.layers[0].id, net2); await wait(300);
    out.tabs2 = [...document.querySelectorAll('.rails-tab')].map((t) => t.textContent.trim());
    out.viewShares = P.layersOf(net2)[0]?.datasetId === ds.id;
    out.linkBadge = [...document.querySelectorAll('.wtree .wlink')].map((e) => e.textContent);
    // click the first pole on net 1: its row is selected — on net 2 too, and in the table
    W.rails.activateTab('diag:' + net1); await wait(200);
    const v = W.views.get(net1), k = v.picks[0], svg = host().querySelector('svg'), rc = svg.getBoundingClientRect();
    const sx = rc.left + k.x / (v.net.size / rc.width), sy = rc.top + k.y / (v.net.size / rc.height);
    out.clickAt = [sx, sy];
    return out;
  });
  await p.mouse.click(s.clickAt[0], s.clickAt[1]);
  await p.waitForTimeout(300);
  const t = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, out = {}, ds = P.datasets[0];
    const wait = (ms) => new Promise((z) => setTimeout(z, ms));
    out.selected = P.selected(ds.id);
    const v1 = W.views.get(P.diagrams[0].id), v2 = W.views.get(P.diagrams[1].id);
    const violet = getComputedStyle(document.body).getPropertyValue('--w-violet').trim().toLowerCase();
    const fills = (v) => [...v.el.querySelectorAll('svg circle')].map((c) => (c.getAttribute('fill') || c.style.fill || '').toLowerCase());
    const on1 = fills(v1).filter((f) => f === violet).length;
    // net 2 is a background tab (zero size, not redrawn until shown): bring it forward, then look
    W.rails.activateTab('diag:' + P.diagrams[1].id); await wait(300);
    out.violetOn = [on1, v2 ? fills(v2).filter((f) => f === violet).length : -1];
    out.tableTitle = document.querySelector('.wt-head')?.textContent;
    // theme
    const bg0 = getComputedStyle(document.body).getPropertyValue('--w-net-bg').trim();
    W.setTheme('light'); await wait(200);
    out.theme = [bg0, getComputedStyle(document.body).getPropertyValue('--w-net-bg').trim(), document.documentElement.dataset.resolvedTheme];
    W.setTheme('system');
    // a project round trip (save → load) through the same shapes
    const j = JSON.parse(JSON.stringify(P.toJSON()));
    W.loadProject(j); await wait(300);
    out.reload = { diagrams: P.diagrams.length, layers: P.layers.length, rows: P.datasets[0].rows.length, selected: P.selected(P.datasets[0].id), tabs: [...document.querySelectorAll('.rails-tab')].length };
    return out;
  });
  // ── the selection tools: real drags on net 1 ──
  const geo = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, net1 = P.diagrams[0].id;
    W.rails.activateTab('diag:' + net1);
    return new Promise((res) => setTimeout(() => {
      const v = W.views.get(net1), svg = v.stage.querySelector('svg'), rc = svg.getBoundingClientRect(), k = v.net.size / rc.width;
      const toPx = (q) => [rc.left + q.x / k, rc.top + q.y / k];
      res({ c: toPx({ x: v.net.size / 2, y: v.net.size / 2 }), r: (v.net.size / 2 - 30) / k, pole: toPx(v.picks[17]) });
    }, 300));
  });
  const drag = async (pts, mods = []) => {
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(...pts[0]); await p.mouse.down();
    for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 4 });
    await p.mouse.up();
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(250);
  };
  const [cx, cy] = geo.c, R = geo.r;
  await p.click('.wsel-bar >> text=cone');
  await drag([geo.pole, [geo.pole[0] + 0.25 * R, geo.pole[1]]]);   // a cone started on a pole: never empty
  const cone = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, v = W.views.get(P.diagrams[0].id), sh = W.select.shapeOf(v), ds = P.datasets[0];
    const D = Math.PI / 180, pole = (dd, dip) => [-Math.sin(dip * D) * Math.sin(dd * D), -Math.sin(dip * D) * Math.cos(dd * D), -Math.cos(dip * D)];
    const ax = sh.axis, n = Math.hypot(...ax), c = Math.cos(sh.angle * D);
    const want = ds.rows.map((r, i) => [i, pole(r['dip direction'], r.dip)]).filter(([, q]) => Math.abs(q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]) / n >= c - 1e-9).map(([i]) => i);
    return { type: sh.type, angle: sh.angle, got: P.selected(ds.id), want, status: document.querySelector('.wst-hover').textContent };
  });
  await p.click('.wsel-bar >> text=lasso');
  const before = cone.got.length;
  await drag([[cx - 0.7 * R, cy - 0.2 * R], [cx - 0.2 * R, cy - 0.7 * R], [cx + 0.2 * R, cy - 0.7 * R], [cx + 0.1 * R, cy - 0.1 * R], [cx - 0.6 * R, cy + 0.1 * R]], ['Shift']);
  const lasso = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, v = W.views.get(P.diagrams[0].id); return { type: W.select.shapeOf(v).type, n: P.selected(P.datasets[0].id).length, outline: !!v.stage.querySelector('.wsel-shape') }; });
  await p.click('.wsel-bar >> text=band');
  await drag([[cx - 0.8 * R, cy], [cx + 0.8 * R, cy + 0.05 * R]]);
  const band = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, v = W.views.get(P.diagrams[0].id); const sh = W.select.shapeOf(v); return { type: sh.type, width: sh.width, n: P.selected(P.datasets[0].id).length }; });
  // a ROTATED net: a cone started exactly on a pole must have that pole (its true direction) as its axis
  const rot = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, net1 = P.diagrams[0].id;
    P.setDiagramProps(net1, { rotation: [60, 40] });
    return new Promise((res) => setTimeout(() => {
      const v = W.views.get(net1), svg = v.stage.querySelector('svg'), rc = svg.getBoundingClientRect(), k = v.net.size / rc.width;
      const pk = v.picks.find((q) => q.ref.row === 5), ds = P.datasets[0], r = ds.rows[5], D = Math.PI / 180;
      res({ at: [rc.left + pk.x / k, rc.top + pk.y / k], want: [-Math.sin(r.dip * D) * Math.sin(r['dip direction'] * D), -Math.sin(r.dip * D) * Math.cos(r['dip direction'] * D), -Math.cos(r.dip * D)] });
    }, 300));
  });
  await p.click('.wsel-bar >> text=cone');
  await drag([rot.at, [rot.at[0] + 25, rot.at[1] + 10]]);
  const rotGot = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, v = W.views.get(P.diagrams[0].id); const a = W.select.shapeOf(v).axis; return a; });
  const rotErr = Math.acos(Math.min(1, Math.abs(rotGot[0] * rot.want[0] + rotGot[1] * rot.want[1] + rotGot[2] * rot.want[2]) / Math.hypot(...rotGot))) * 180 / Math.PI;
  await p.evaluate(() => { const W = window.__wuffleDesk; W.project.setDiagramProps(W.project.diagrams[0].id, { rotation: null }); W.select.setTool('pick'); });
  chk(`${label}: a cone dragged on the net (${cone.angle.toFixed(1)}°) selects exactly the poles within it (${cone.got.length}, counted independently ${cone.want.length}) · “${cone.status}”`,
    cone.type === 'cone' && cone.got.length > 0 && JSON.stringify(cone.got) === JSON.stringify(cone.want));
  chk(`${label}: ⇧-lasso adds (${before} → ${lasso.n}), its outline drawn`, lasso.type === 'polygon' && lasso.n > before && lasso.outline);
  chk(`${label}: a band along a great circle (±${band.width}°) selects ${band.n}`, band.type === 'band' && band.n > 0 && band.width === 10);
  chk(`${label}: on a ROTATED net, a cone started on a pole has that pole's true direction as its axis (off by ${rotErr.toFixed(2)}°)`, rotErr < 1.5);

  // ── the statistics panel: numbers for the active net; a mean kept as a dataset, drawn, with lineage ──
  const st = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    W.rails.activateTab('stats'); await wait(200);
    const card = document.querySelector('.wst-card');
    const txt = card?.textContent || '';
    const n0 = P.datasets.length, l0 = P.layersOf(P.diagrams[0].id).length;
    [...card.querySelectorAll('button')].find((b) => /mean → dataset/.test(b.textContent)).click(); await wait(200);
    const d = P.datasets[P.datasets.length - 1];
    return { hasMean: /mean\s*\d{3}\/\d{2}/.test(txt), hasK: /K · C/.test(txt), added: P.datasets.length - n0, drawn: P.layersOf(P.diagrams[0].id).length - l0,
      lineage: d.lineage && d.lineage.op, rows: d.rows.length };
  });
  chk(`${label}: the statistics panel shows the mean, κ, α and the eigen analysis; “mean → dataset” adds a dataset (${st.added}) drawn on the net (${st.drawn}) with lineage “${st.lineage}”`,
    st.hasMean && st.hasK && st.added === 1 && st.drawn === 1 && st.lineage === 'mean' && st.rows === 1);

  // ── a rose and a fabric plot: new diagrams inherit the active net's layers (views of the same data) ──
  const dg = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    W.rails.activateTab('diag:' + P.diagrams[0].id); P.setActive(P.diagrams[0].id); await wait(100);
    W.menus.run('newrose'); await wait(400);
    const rose = P.diagrams[P.diagrams.length - 1], rv = W.views.get(rose.id);
    const r = { kind: rose.kind, layers: P.layersOf(rose.id).length, n: rv?.el.dataset.n, svg: !!rv?.el.querySelector('svg path') };
    P.setDiagramProps(rose.id, { quantity: 'dipDirection', bins: 20 }); await wait(200);
    r.n2 = rv.el.dataset.n;
    W.menus.run('newfabric'); await wait(400);
    const fab = P.diagrams[P.diagrams.length - 1], fv = W.views.get(fab.id);
    return { r, f: { kind: fab.kind, svg: !!fv?.el.querySelector('.wdg-paper svg'), n: fv?.el.dataset.n } };
  });
  chk(`${label}: a rose diagram of the net's layers (${dg.r.layers} layers, ${dg.r.n} azimuths, then by dip direction ${dg.r.n2}); a fabric plot on paper (${dg.f.n} point${dg.f.n === '1' ? '' : 's'})`,
    dg.r.kind === 'rose' && dg.r.layers >= 2 && dg.r.svg && +dg.r.n >= 200 && dg.r.n2 === dg.r.n && dg.f.kind === 'fabric' && dg.f.svg && +dg.f.n >= 1);

  // ── the console: typed commands act like the menus and the gestures ──
  await p.keyboard.press('Escape');
  await p.evaluate(() => { document.activeElement?.blur(); });
  await p.keyboard.press('`');
  await p.waitForTimeout(200);
  const focused = await p.evaluate(() => document.activeElement?.classList.contains('wcon-in'));
  const typed = async (line) => { await p.fill('.wcon-in', line); await p.press('.wcon-in', 'Enter'); await p.waitForTimeout(150); };
  await p.evaluate(() => { const W = window.__wuffleDesk; W.project.setActive(W.project.diagrams[0].id); });
  await typed('select cone 150/60 20');
  await typed('stats tocher');
  await typed('nonsense');
  const con = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, ds = P.datasets.find((d) => d.name === 'tocher');
    return { sel: P.selected(ds.id).length, lines: [...document.querySelectorAll('.wcon-line')].map((l) => l.className.split(' ').pop() + ':' + l.textContent.slice(0, 60)),
      shape: !!W.views.get(P.diagrams[0].id)?.stage.querySelector('.wsel-shape') };
  });
  chk(`${label}: \` opens the console (${focused}); “select cone 150/60 20” selects (${con.sel}) and draws its cone (${con.shape}); “stats” answers; a bad line says so`,
    focused && con.sel > 0 && con.shape && con.lines.some((l) => /^out:.*n 200/.test(l)) && con.lines.some((l) => /^err:unknown command/.test(l)));

  // ── rotating: a drag on the net (pick tool) turns it; a click afterwards still picks ──
  await p.evaluate(() => { const W = window.__wuffleDesk; W.select.setTool('pick'); W.project.setActive(W.project.diagrams[0].id); W.rails.activateTab('diag:' + W.project.diagrams[0].id); });
  await p.waitForTimeout(250);
  await p.mouse.move(cx - 0.3 * R, cy); await p.mouse.down(); await p.mouse.move(cx + 0.2 * R, cy - 0.1 * R, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(300);
  const rot2 = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, g = P.diagrams[0], v = W.views.get(g.id); const k = v.picks[3]; const svg = v.stage.querySelector('svg'), rc = svg.getBoundingClientRect(), s = v.net.size / rc.width; return { m: g.props.matrix, at: [rc.left + k.x / s, rc.top + k.y / s], row: k.ref.row }; });
  await p.mouse.click(rot2.at[0], rot2.at[1]); await p.waitForTimeout(250);
  const rot3 = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project; const sel = P.selected(P.datasets[0].id); P.setDiagramProps(P.diagrams[0].id, { matrix: null }); return sel; });
  chk(`${label}: a drag on the net rotates it (a matrix ${rot2.m ? 'kept on the diagram' : 'MISSING'}); a click afterwards still picks the pole under it (row ${JSON.stringify(rot3)} = ${rot2.row})`,
    Array.isArray(rot2.m) && rot2.m.length === 9 && Math.abs(rot2.m[0] - 1) > 1e-3 && rot3.length === 1 && rot3[0] === rot2.row);

  // ── faults: a file of normal faults → slickenlines with arrows; the statistics card inverts for stress ──
  const fl = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    const net = P.addDiagram('net'); P.setActive(net); W.rails.activateTab('diag:' + net); await wait(200);
    const rows = ['dip direction,dip,trend,plunge,sense'];
    for (const dd of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 90, 270]) rows.push(`${dd},60,${dd},60,N`);
    W.addData(rows.join(String.fromCharCode(10)), 'normal_faults.csv'); await wait(300);
    const v = W.views.get(net), L = P.layersOf(net)[0];
    const arrows = v.scene.primitives.filter((x) => x.type === 'curve').length;
    W.rails.activateTab('stats'); await wait(250);
    const card = [...document.querySelectorAll('.wst-card')].find((c) => /normal_faults/.test(c.textContent));
    const out = { kind: P.dataset(L.datasetId).kind, arrows, stress: card ? /σ1 σ2 σ3/.test(card.textContent) && /φ/.test(card.textContent) : false };
    P.removeDiagram(net); W.rails.activateTab('diag:' + P.diagrams[0].id); P.setActive(P.diagrams[0].id); await wait(100);
    return out;
  });
  chk(`${label}: a fault file reads as faults (${fl.kind}), draws each slickenline with an arrow (${fl.arrows / 2} arrows), and the statistics card inverts for σ1 σ2 σ3 and φ (${fl.stress})`,
    fl.kind === 'faults' && fl.arrows === 28 && fl.stress);

  // ── undo / redo from the keyboard: a new net (one step, its views included) goes and comes back ──
  await p.evaluate(() => { document.activeElement?.blur(); const W = window.__wuffleDesk; W.menus.run('newnet'); });
  await p.waitForTimeout(300);
  const u0 = await p.evaluate(() => ({ n: window.__wuffleDesk.project.diagrams.length, label: window.__wuffleDesk.project.undoLabel(), tabs: document.querySelectorAll('.rails-tab').length }));
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
  const u1 = await p.evaluate(() => ({ n: window.__wuffleDesk.project.diagrams.length, tabs: document.querySelectorAll('.rails-tab').length }));
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300);
  const u2 = await p.evaluate(() => ({ n: window.__wuffleDesk.project.diagrams.length, tabs: document.querySelectorAll('.rails-tab').length }));
  chk(`${label}: Ctrl+Z undoes “${u0.label}” (${u0.n} → ${u1.n} diagrams, its tab gone: ${u0.tabs} → ${u1.tabs}); Ctrl+Shift+Z brings it back (${u2.n}, ${u2.tabs} tabs)`,
    u0.label === 'new net' && u1.n === u0.n - 1 && u1.tabs === u0.tabs - 1 && u2.n === u0.n && u2.tabs === u0.tabs);

  // ── a figure: Figure → New figure from the active net → compo's editor in a tab, the page drawn ──
  const fig = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    P.setActive(P.diagrams[0].id); W.rails.activateTab('diag:' + P.diagrams[0].id); await wait(100);
    W.menus.run('figure'); await wait(800);
    const f = P.figures[0], tab = [...document.querySelectorAll('.rails-tab')].map((t) => t.textContent.trim()).find((t) => /figure/.test(t));
    const host = document.querySelector('.wfig-host');
    const kinds = f && f.doc.frames.map((x) => x.kind);
    const canvases = host ? host.querySelectorAll('canvas').length : 0;
    const btns = host ? [...host.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Export PDF|from the net/.test(t)) : [];
    const treeHas = [...document.querySelectorAll('.wtree .wsec')].some((e) => /figures/i.test(e.textContent));
    return { n: P.figures.length, tab, kinds, canvases, btns, treeHas };
  });
  chk(`${label}: a figure from the net opens compo's editor in a tab (“${fig.tab}”), frames ${JSON.stringify(fig.kinds)}, page drawn (${fig.canvases} canvas), host buttons ${JSON.stringify(fig.btns)}; listed in the tree`,
    fig.n === 1 && !!fig.tab && fig.kinds && fig.kinds.includes('stereonet') && fig.canvases >= 1 && fig.btns.length === 2 && fig.treeHas);

  try { await p.screenshot({ path: path.join(root, `experiments/wuffle-desk-${label}.png`) }); } catch { /* for a person */ }
  chk(`${label}: the desk opens with layers · Net 1 · table · statistics, the field page hidden (${s && JSON.stringify(r.tabs)})`, r.tabs && r.tabs.join() === 'layers,Net 1,table,statistics,console' && r.fieldHidden);
  chk(`${label}: File → Open the tocher sample → ${s.ds && s.ds.n} planes (not guessed: ${s.ds && !s.ds.guessed}), ${s.svgCircles} circles drawn`, s.ds && s.ds.n === 200 && !s.ds.guessed && s.svgCircles >= 200);
  chk(`${label}: the tree's nested checkbox switches contours on (${s.contourOn}, ${s.contourPaths} paths); one eigenvector child makes the group partial (${s.eigenState})`, s.contourOn && s.contourPaths > 0 && /partial/.test(s.eigenState));
  chk(`${label}: a second net gets a VIEW of the same data (${s.viewShares}); its tab appears (${JSON.stringify(s.tabs2)}); the tree marks the link (${JSON.stringify(s.linkBadge)})`, s.viewShares && s.tabs2.includes('Net 2') && s.linkBadge.length >= 1);
  chk(`${label}: a click on a pole selects its row (${JSON.stringify(t.selected)}), drawn violet on BOTH nets (${JSON.stringify(t.violetOn)}); the table shows the dataset (“${(t.tableTitle || '').slice(0, 50)}”)`, t.selected.length === 1 && t.violetOn[0] >= 1 && t.violetOn[1] >= 1 && /tocher/.test(t.tableTitle || ''));
  chk(`${label}: the theme switches (${JSON.stringify(t.theme)})`, t.theme[0] !== t.theme[1] && t.theme[2] === 'light');
  chk(`${label}: a project round-trips (${JSON.stringify(t.reload)})`, t.reload.diagrams === 2 && t.reload.layers === 2 && t.reload.rows === 200 && t.reload.selected.length === 1 && t.reload.tabs === 6);
  chk(`${label}: no page errors (${errs.length ? errs.join(' ; ').slice(0, 200) : 'none'})`, errs.length === 0);
  await p.close();
}
await b.close(); server.close();
console.log(`\nwuffle-desk-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
