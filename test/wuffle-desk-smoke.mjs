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
const served = new Map();   // pages made during the run (a saved wuffle page), served from memory
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (served.has(p)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(served.get(p)); return; }
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
    // a project round trip through the real file: the .zip.wuffle bytes Save writes, opened again
    const bytes = await W.files.bytesOf();
    out.zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    await W.loadProject(bytes); await wait(300);
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

  // ── the tool keys (P L C B M, on the net — never while typing) and the strip ABOVE the net, not over it ──
  {
    await p.evaluate(() => { const W = window.__wuffleDesk; W.views.get(W.project.diagrams[0].id).el.focus(); });
    const seen = [];
    for (const k of ['l', 'c', 'b', 'm', 'p']) { await p.keyboard.press(k); seen.push(await p.evaluate(() => window.__wuffleDesk.select.tool)); }
    const typing = await p.evaluate(() => { const i = document.createElement('input'); document.body.append(i); i.focus(); return true; });
    await p.keyboard.press('l');
    const stayed = await p.evaluate(() => { document.querySelector('body > input:last-of-type')?.remove(); return window.__wuffleDesk.select.tool; });
    const lay = await p.evaluate(() => {
      const W = window.__wuffleDesk, v = W.views.get(W.project.diagrams[0].id);
      const bar = v.el.querySelector('.wsel-bar').getBoundingClientRect(), svg = v.stage.querySelector('svg').getBoundingClientRect();
      return { barBottom: Math.round(bar.bottom), svgTop: Math.round(svg.top) };
    });
    chk(`${label}: tool keys l c b m p → ${seen.join(' ')}; typing in a box leaves the tool (${stayed}); the strip sits above the net (strip ends ${lay.barBottom}, net starts ${lay.svgTop})`,
      seen.join(' ') === 'lasso cone band measure pick' && typing && stayed === 'pick' && lay.barBottom <= lay.svgTop);
  }
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
  const focused = await p.evaluate(() => !!document.activeElement?.closest?.('.wcon'));
  const typed = async (line) => { await p.keyboard.type(line); await p.keyboard.press('Enter'); await p.waitForTimeout(250); };
  await p.evaluate(() => { const W = window.__wuffleDesk; W.project.setActive(W.project.diagrams[0].id); return W.console.ready; });
  await typed('select cone 150/60 20');
  await typed('stats tocher');
  await typed('nonsense');
  const con = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, ds = P.datasets.find((d) => d.name === 'tocher');
    return { sel: P.selected(ds.id).length, tr: W.console.transcript, shape: !!W.views.get(P.diagrams[0].id)?.stage.querySelector('.wsel-shape'),
      screen: document.querySelector('.wcon .screen')?.textContent || '' };
  });
  chk(`${label}: \` opens the console (${focused}); typed “select cone 150/60 20” selects (${con.sel}) and draws its cone (${con.shape}); “stats” answers; a bad line says so; the terminal shows it`,
    focused && con.sel > 0 && con.shape && /n 200/.test(con.tr) && /nonsense: command not found/.test(con.tr) && /n 200/.test(con.screen));

  // ── it is a shell: pipes, loops and $(…) around wuffle's commands; Tab completes ──
  await typed('stats tocher | grep -c mean');
  await typed('for m in fisher kamb; do contour $m; done');
  await typed('echo "$(layers | wc -l) layer lines" > /home/n.txt; cat /home/n.txt');
  await p.keyboard.type('sam'); await p.keyboard.press('Tab'); await p.waitForTimeout(100); await p.keyboard.type('tocher'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const sh = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, L = P.layersOf(P.diagrams[0].id)[0];
    const r = await W.console.run('undo');
    return { tr: W.console.transcript, method: L && P.layer(L.id)?.elements.contours.method, hist: W.console.history.slice(-5), run: r };
  });
  chk(`${label}: a pipe (stats | grep -c), a for loop (contour → ${sh.method}), $(…) into a file in /home, Tab completed “sam” → sample; run() answers ${JSON.stringify(sh.run).slice(0, 60)}`,
    /^1$/m.test(sh.tr) && sh.method === 'kamb' && /\d+ layer lines/.test(sh.tr) && sh.hist.includes('sample tocher') && sh.run.ok && /undid/.test(sh.run.text));

  // ── add: attitudes typed into the console land as a dataset on the net (the shell quotes a name; a list is more of them) ──
  await typed('add p 045/30 030/40SE --to "my planes"');
  const ad = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project;
    const f = await W.console.run('add f 045/30 120/20 n 200/60 290/10');
    const sel = await W.console.run('select cone l 120/20 3');
    const manAdd = (await W.console.run('man add')).text || '', manLs = (await W.console.run('man ls')).text || '';
    const mine = P.datasets.find((d) => d.name === 'my planes'), typed = P.datasets.find((d) => d.name === 'typed faults');
    return { mine: mine && mine.rows.map((r) => [r.dipdir, r.dip]), onNet: !!mine && P.layersOf(P.activeDiagram).some((L) => L.datasetId === mine.id),
      faults: typed && typed.rows.length, f: f.text, sel: sel.text, man: /add p 045\/30/.test(manAdd) && /NAME\s+ls/.test(manLs) };
  });
  chk(`${label}: add — “add p 045/30 030/40SE --to "my planes"” → ${JSON.stringify(ad.mine)} on the net (${ad.onNet}); add f two faults (${ad.faults}); select cone l → ${ad.sel}; man add / man ls (${ad.man})`,
    JSON.stringify(ad.mine) === '[[45,30],[120,40]]' && ad.onNet && ad.faults === 2 && /cone: [1-9]/.test(ad.sel) && ad.man);

  // ── a calculated column from the table's ƒ (no shell quoting), and select where through the shell (quoted) ──
  {
    const fx = await p.evaluate(async () => {
      const W = window.__wuffleDesk, P = W.project, ds = P.datasets.find((d) => d.name === 'tocher');
      W.table.show(ds.id); await new Promise((r) => setTimeout(r, 200));
      document.querySelector('.wt-head .wt-fx').click(); await new Promise((r) => setTimeout(r, 200));
      const nm = document.querySelector('.wt-calc-name'), ex = document.querySelector('.wt-calc-expr');
      nm.value = 'steep'; nm.dispatchEvent(new Event('input')); ex.value = 'dip > 60'; ex.dispatchEvent(new Event('input'));
      [...document.querySelectorAll('.gcu-dialog button')].find((b) => b.textContent === 'Add').click();
      await new Promise((r) => setTimeout(r, 300));
      const d = P.dataset(ds.id);
      const r = await W.console.run('select where "steep and pole_plunge < 25"');
      return { calc: d.meta.calc, n: d.rows.filter((x) => x.steep === true).length, head: W.table.provider.header(d.columns.indexOf('steep') + 1).label, sel: r.text };
    });
    chk(`${label}: ƒ new column → ${JSON.stringify(fx.calc)} (${fx.n} steep; header “${fx.head}”); select where → ${fx.sel}`,
      fx.calc && fx.calc[0].expr === 'dip > 60' && fx.n > 0 && fx.head === 'ƒ steep' && /^where .*: \d+ of \d+ selected/.test(fx.sel));
  }

  // ── the column-mapping dialog from the table's "columns…": change a form, see the rows counted, apply ──
  {
    const cm = await p.evaluate(async () => {
      const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const id = W.addData('dd,dp,quad\n030,40,SE\n210,30,E\n', 'mapme.csv'); await wait(200);
      W.table.show(id); await wait(150);
      document.querySelector('.wt-head .wt-cols').click(); await wait(200);
      const dlg = document.querySelector('.gcu-dialog'), note0 = dlg.querySelector('.wpnote:last-of-type')?.textContent || '';
      const form = dlg.querySelector('.wc-form'); form.value = '0'; form.dispatchEvent(new Event('change')); await wait(50);   // dip direction / dip
      const pick = (role, col) => { const s = dlg.querySelector(`select[data-role="${role}"]`); s.value = col; s.dispatchEvent(new Event('change')); };
      pick('dipDir', 'dd'); pick('dip', 'dp'); await wait(50);
      const note1 = [...dlg.querySelectorAll('.wpnote')].map((x) => x.textContent).find((t) => /rows read/.test(t)) || '';
      [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click(); await wait(200);
      const d = P.dataset(id);
      return { note1, roles: d.roles, guessed: d.meta.read.guessed };
    });
    chk(`${label}: columns… — dip direction / dip chosen (“${cm.note1}”) → roles ${JSON.stringify(cm.roles)}, no longer guessed (${!cm.guessed})`,
      /2 of 2 rows read/.test(cm.note1) && cm.roles.dipDir === 'dd' && cm.roles.dip === 'dp' && !cm.roles.quadrant && cm.guessed === false);
  }

  // ── the net's right-click: on a pole (its row in the table), on empty net (add the plane there), on a circle;
  //    the selection's statistics (menu, console, panel); the picture ──
  {
    const pole = await p.evaluate(async () => {
      const W = window.__wuffleDesk, P = W.project, g = P.diagrams[0]; W.console.cmd.run(`use ${g.name}`); await new Promise((r) => setTimeout(r, 600));   // its tab in front (a background net has no size), redrawn
      const v = W.views.get(g.id), k = v.picks[5], svg = v.stage.querySelector('svg'), r = svg.getBoundingClientRect(), s = v.net.size / r.width;
      return { x: r.left + k.x / s, y: r.top + k.y / s, row: k.ref.row };
    });
    const rclick = (pt) => p.evaluate((pt) => { const W = window.__wuffleDesk, v = W.views.get(W.project.diagrams[0].id);
      v.stage.dispatchEvent(new MouseEvent('contextmenu', { clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true, button: 2 })); }, pt);
    const items = () => p.evaluate(() => [...document.querySelectorAll('.gcu-menu .gcu-menu-item')].map((e) => e.textContent.trim()));
    const click = (src) => p.evaluate((src) => { const r = new RegExp(src); const it = [...document.querySelectorAll('.gcu-menu .gcu-menu-item')].find((e) => r.test(e.textContent)); if (it) it.click(); return !!it; }, src);
    await rclick(pole); await p.waitForTimeout(300);
    const onPole = await items(); const clicked = await click('Show its row'); await p.waitForTimeout(300);
    const tbl = await p.evaluate(() => window.__wuffleDesk.table.datasetId);
    const empty = await p.evaluate(() => {
      const W = window.__wuffleDesk, v = W.views.get(W.project.diagrams[0].id), r = v.stage.querySelector('svg').getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width * 0.42;
      for (let k = 0; k < 400; k++) { const t = k * 0.37, rr = R * (0.2 + 0.75 * ((k * 0.618) % 1)), x = cx + rr * Math.cos(t), y = cy + rr * Math.sin(t);
        const h = W.netMenu.hitAt(v, { clientX: x, clientY: y }); if (h.dir && !h.datum) return { x, y }; }
      return null;
    });
    const before = await p.evaluate(() => (window.__wuffleDesk.project.datasets.find((d) => d.name === 'drawn planes')?.rows.length) || 0);
    await rclick(empty); await p.waitForTimeout(300);
    const onEmpty = await items(); await click('^Add the plane'); await p.waitForTimeout(300);
    const after = await p.evaluate(() => (window.__wuffleDesk.project.datasets.find((d) => d.name === 'drawn planes')?.rows.length) || 0);
    const rest = await p.evaluate(async () => {
      const W = window.__wuffleDesk, P = W.project, g = P.diagrams[0], v = W.views.get(g.id), L = P.layersOf(g.id).find((x) => P.dataset(x.datasetId).rows.length > 100);
      P.setElement(L.id, 'greatCircles', true); await new Promise((r) => setTimeout(r, 300));
      const R = v.stage.querySelector('svg').getBoundingClientRect(); let circle = false;
      for (let y = R.top + 30; y < R.bottom - 30 && !circle; y += 9) for (let x = R.left + 30; x < R.right - 30; x += 9) { const h = W.netMenu.hitAt(v, { clientX: x, clientY: y }); if (h.datum && h.datum.what === 'circle') { circle = true; break; } }
      P.setElement(L.id, 'greatCircles', false);
      await W.console.run('select cone 150/60 20');
      const rep = W.netMenu.selectionReport(v), con = (await W.console.run(`stats ${P.dataset(L.datasetId).name} --selection`)).text;
      await new Promise((r) => setTimeout(r, 200));
      const panel = !!W.stats.el.querySelector('.wst-sel');
      const png = await W.netMenu.png(g.id, { size: 200 });
      P.clearSelection(); W.console.focus();           // the next steps type into the console
      return { circle, rep, con, panel, png: png && png.type };
    });
    chk(`${label}: net menu — on a pole “${onPole[0]}” → its row in the table (${clicked}, ${tbl}); on empty net “${onEmpty[0]}” → Add the plane (${before}→${after}); a circle is hit (${rest.circle}); selection stats in menu / console / panel (${/κ/.test(rest.rep)} / ${/selection · n/.test(rest.con)} / ${rest.panel}); png ${rest.png}`,
      /^.+ #\d+ · /.test(onPole[0]) && onPole.some((t) => /Export PNG/.test(t)) && clicked && !!tbl
      && /^here · pole of/.test(onEmpty[0]) && after === before + 1 && rest.circle && /κ/.test(rest.rep) && /selection · n/.test(rest.con) && rest.panel && rest.png === 'image/png');
    // back to the console, as a person would (the menus took the focus)
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('`'); await p.waitForTimeout(200);
    if (!(await p.evaluate(() => !!document.activeElement?.closest?.('.wcon')))) { await p.keyboard.press('`'); await p.waitForTimeout(200); }
  }

  // ── /project: the model as a filesystem — mkdir makes a net (its tab appears), ln -s draws data on it, Tab completes paths ──
  await typed('mkdir "diagrams/Shell net"');
  await typed('ln -s ../../../data/tocher.csv "diagrams/Shell net/layers/"');
  await p.keyboard.type('cat da'); await p.keyboard.press('Tab'); await p.waitForTimeout(250);
  await p.keyboard.type('tocher.c'); await p.keyboard.press('Tab'); await p.waitForTimeout(250);   // 'toch' alone stops at 'tocher' — an earlier step opened tocher (2)
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const pf = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, g = P.diagrams.find((x) => x.name === 'Shell net');
    return { g: !!g, layers: g ? P.layersOf(g.id).length : 0, tab: [...document.querySelectorAll('.rails-tab')].some((t) => t.textContent.includes('Shell net')),
      last: W.console.history.at(-1), tr: W.console.transcript.slice(-400) };
  });
  chk(`${label}: /project — mkdir made “Shell net” (tab: ${pf.tab}), ln -s drew the data on it (${pf.layers} layer), Tab completed the path → “${pf.last}”`,
    pf.g && pf.tab && pf.layers === 1 && pf.last === 'cat data/tocher.csv' && /\d+,\d+/.test(pf.tr) && !/no such|not found/i.test(pf.tr));
  await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, g = P.diagrams.find((x) => x.name === 'Shell net'); if (g) P.removeDiagram(g.id); });

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
    const btns = host ? [...host.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Export PDF|from the diagrams/.test(t)) : [];
    const treeHas = [...document.querySelectorAll('.wtree .wsec')].some((e) => /figures/i.test(e.textContent));
    return { n: P.figures.length, tab, kinds, canvases, btns, treeHas };
  });
  chk(`${label}: a figure from the net opens compo's editor in a tab (“${fig.tab}”), frames ${JSON.stringify(fig.kinds)}, page drawn (${fig.canvases} canvas), host buttons ${JSON.stringify(fig.btns)}; listed in the tree`,
    fig.n === 1 && !!fig.tab && fig.kinds && fig.kinds.includes('stereonet') && fig.canvases >= 1 && fig.btns.length === 2 && fig.treeHas);

  // ── Add label on a figure pins to the NET (compo's pins: a stereonet frame knows its own projection; it once
  //    did nothing — labels pinned only to a 3D view's camera matrix). With a pole selected it pins there,
  //    reading the plane's attitude; with nothing selected, at the net's centre — no data point needed ──
  const lab = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    const host = document.querySelector('.wfig-host'), btn = host && [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Add label');
    const ds = P.datasets.find((d) => d.name === 'tocher'), labels = () => P.figures[0].doc.frames.filter((x) => x.kind === 'label');
    if (!btn || !ds) return { btn: !!btn };
    P.clearSelection(); btn.click(); await wait(300);
    const centre = labels().at(-1);
    P.select(ds.id, [0]); btn.click(); await wait(300);
    const onPole = labels().at(-1), net = P.figures[0].doc.frames.find((x) => x.kind === 'stereonet');
    const unit = (a) => a && Math.abs(Math.hypot(...a) - 1) < 1e-4;
    return { btn: true, n: labels().length, centre: centre && { at: centre.content.at, of: centre.content.of, text: centre.content.text },
      pole: onPole && { at: onPole.content.at, text: onPole.content.text, of: onPole.content.of }, net: net && net.id, unitC: unit(centre && centre.content.at), unitP: unit(onPole && onPole.content.at),
      row0: ds.rows[0], errs: (document.querySelector('.compo-status') || {}).textContent || '' };
  });
  chk(`${label}: Add label on a figure pins to its net — at the centre (${lab.centre && JSON.stringify(lab.centre.at)}), and at the selected pole reading “${lab.pole && lab.pole.text}” (${lab.pole && JSON.stringify(lab.pole.at)})`,
    lab.btn && lab.n === 2 && lab.centre && lab.centre.of === lab.net && lab.unitC   // (an earlier step rotated the net: its centre needn't be the vertical)
      && lab.pole && lab.pole.of === lab.net && lab.unitP && /^\d{3}\/\d{2}$/.test(lab.pole.text) && lab.pole.at[2] < 0);

  // ── "↻ from the diagrams" refreshes the figure WITHOUT undoing your edits: a renamed, recoloured legend entry and
  //    a rewritten caption stay; the legend still follows the data (a new layer's entry arrives) ──
  const keep = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    const f = P.figures[0], doc = JSON.parse(JSON.stringify(f.doc));
    const leg = doc.frames.find((x) => x.kind === 'legend'), cap = doc.frames.find((x) => x.id === 'wuffle-caption');
    const k0 = leg.content.entries[0].key;
    leg.content.edit = { [k0]: { label: 'joints (field)', color: '#b0302a' } }; leg.content.columns = 2;
    cap.content.md = '# My caption\nwritten by hand';
    // through the editor, as an edit in its inspector would land (the refresh works on the editor's document)
    W.rails.activateTab('fig:' + f.id); await wait(200);
    const ed = W.figures.editors.get(f.id); if (ed) ed.setDoc(doc);
    P.setFigureDoc(f.id, doc);
    const n0 = leg.content.entries.length;
    await W.console.run('mean tocher');                                 // a new layer on the net → a new legend entry
    const btn = [...document.querySelectorAll('.wfig-host button')].find((b) => /from the diagrams/.test(b.textContent));
    W.rails.activateTab('fig:' + f.id); await wait(200); btn && btn.click(); await wait(300);
    const d2 = P.figure(f.id).doc, L2 = d2.frames.find((x) => x.kind === 'legend'), C2 = d2.frames.find((x) => x.id === 'wuffle-caption');
    return { btn: !!btn, n0, n1: L2.content.entries.length, edit: L2.content.edit && L2.content.edit[k0], cols: L2.content.columns, cap: C2.content.md };
  });
  chk(`${label}: “↻ from the diagrams” keeps your legend edits (${JSON.stringify(keep.edit)}, ${keep.cols} columns) and your caption, while the legend follows the data (${keep.n0} → ${keep.n1} entries)`,
    keep.btn && keep.edit && keep.edit.label === 'joints (field)' && keep.cols === 2 && keep.cap === '# My caption\nwritten by hand' && keep.n1 === keep.n0 + 1);

  // ── a rose makes a figure too (vectors, from data); a figure whose diagram changed says "older data" ──
  {
    const rf = await p.evaluate(async () => {
      const W = window.__wuffleDesk, P = W.project, net = P.diagrams.find((g) => g.kind === 'net');
      let rose = P.diagrams.find((g) => g.kind === 'rose');
      if (!rose) { W.menus.run('newrose'); await new Promise((r) => setTimeout(r, 300)); rose = P.diagrams.find((g) => g.kind === 'rose'); }
      if (!P.layersOf(rose.id).length) for (const L of P.layersOf(net.id)) P.addView(L.id, rose.id);
      const fid = W.figures.newFigure(rose.id); await new Promise((r) => setTimeout(r, 500));
      const ed = W.figures.editors.get(fid), kinds = ed.getDoc().frames.map((f) => f.kind);
      const badge0 = [...document.querySelectorAll('.compo-badge')].map((x) => x.textContent);
      P.setDiagramProps(rose.id, { bins: (rose.props.bins || 10) === 30 ? 15 : 30 }); await new Promise((r) => setTimeout(r, 200)); ed.render();
      const badge1 = [...document.querySelectorAll('.compo-badge')].map((x) => x.textContent);
      return { kinds, badge0, badge1 };
    });
    chk(`${label}: a rose makes a figure (${JSON.stringify(rf.kinds)}); changing the rose flags it (${JSON.stringify(rf.badge0)} → ${JSON.stringify(rf.badge1)})`,
      rf.kinds.includes('rose') && rf.kinds.includes('table') && !rf.badge0.includes('older data') && rf.badge1.includes('older data'));
  }

  // ── the MEASURE tool (after OpenStereo 2's): a drag between the strike and the dip line of 120/40 reads ~90°
  //    and the great circle 120/40; "+ plane" adds it as data on that net; a ⇧-drag is the small circle on
  //    that diameter. Real pointer drags, to the screen points of known directions ──
  const net0 = await p.evaluate(() => { const W = window.__wuffleDesk, id = W.project.diagrams[0].id; W.project.setActive(id); W.rails.activateTab('diag:' + id); return id; });
  await p.waitForTimeout(200);
  const scr = (tr, pl) => p.evaluate(([tr, pl, id]) => {
    const W = window.__wuffleDesk, v = W.views.get(id), D = Math.PI / 180;
    const q = v.net.project([Math.sin(tr * D) * Math.cos(pl * D), Math.cos(tr * D) * Math.cos(pl * D), -Math.sin(pl * D)]);
    const svg = v.stage.querySelector('svg'), pt = svg.createSVGPoint(); pt.x = q.x; pt.y = q.y;
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y };
  }, [tr, pl, net0]);
  const mdrag = async (a, b2, mods = []) => {
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + b2.x) / 2, (a.y + b2.y) / 2, { steps: 4 }); await p.mouse.move(b2.x, b2.y, { steps: 4 }); await p.mouse.up();
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(200);
  };
  await p.evaluate(() => window.__wuffleDesk.select.setTool('measure'));
  await p.evaluate((id) => window.__wuffleDesk.project.setDiagramProps(id, { matrix: null, rotation: null }), net0);   // an unrotated net: the strike / dip screen points
  await p.waitForTimeout(200);
  const nDs0 = await p.evaluate(() => window.__wuffleDesk.project.datasets.length);
  await mdrag(await scr(30, 1), await scr(120, 40));
  const meas1 = await p.evaluate(() => ({ read: document.querySelector('.wmeas')?.innerText || '', drawn: document.querySelectorAll('.wmeas-g .wmeas-gc').length }));
  await p.click('.wmeas-acts button[data-offer="plane"]');
  await mdrag(await scr(200, 20), await scr(260, 30), ['Shift']);
  const meas2 = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, d = P.datasets.find((x) => x.lineage?.op === 'measure');
    return { read: document.querySelector('.wmeas')?.innerText || '', sc: !!document.querySelector('.wmeas-g .wmeas-sc'), ds: d && d.name, kind: d && d.kind, nDs: P.datasets.length,
      onNet: d ? P.layersOf(P.diagrams[0].id).some((L) => L.datasetId === d.id) : false };
  });
  await p.keyboard.press('Escape'); await p.evaluate(() => window.__wuffleDesk.select.setTool('pick'));
  const gcM = /angle (\d+\.\d)° · great circle (\d{3})\/(\d+)/.exec(meas1.read);
  chk(`${label}: measure — a drag reads “${gcM && gcM[0]}” and draws the great circle (${meas1.drawn} dotted paths); “+ plane” → ${meas2.ds} (${meas2.kind}) on the net; ⇧-drag → the small circle on that diameter`,
    gcM && Math.abs(+gcM[1] - 90) < 2 && Math.abs(+gcM[2] - 120) <= 2 && Math.abs(+gcM[3] - 40) <= 2 && meas1.drawn === 3
      && meas2.kind === 'planes' && meas2.onNet && meas2.nDs === nDs0 + 1 && meas2.sc && /small circle on that diameter/.test(meas2.read));

  // ── the console's own man, and a banner that starts the screen (it once started on a blank-looking row:
  //    written at 80 × 12 before the panel's size was known, then shifted by the resize) ──
  const manLs = await p.evaluate(async () => {
    const W = window.__wuffleDesk, T = W.console.term, r = await W.console.run('man ls');
    const first = T.scrollback.length ? T.scrollback[0] : T.buffer[0];   // the first line ever written, wherever it scrolled
    const row0 = first.map((c) => String.fromCodePoint(c.ch)).join('').trim();
    return { text: r.text, row0, scrollback: T.scrollback.length };
  });
  chk(`${label}: console — “man ls” shows ls's page, not man's (${JSON.stringify(manLs.text.split('\n')[1] || '').trim()}); the screen began with the banner (“${manLs.row0.slice(0, 30)}…”)`,
    /NAME\n\s+ls —/.test(manLs.text) && !/NAME\n\s+man —/.test(manLs.text) && /^wuffle — the console/.test(manLs.row0));

  // ── the compass's published log, signed by a key the page makes: File → Open of log + .sig + photo together
  //    keeps an ORIGINAL (verified), reads its data; a changed byte is caught; the original survives the zip ──
  const flog = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, enc = new TextEncoder();
    const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
    const log = 'type,dip_dir_or_trend,dip_or_plunge,strike,timestamp,lat,lon,acc_m,north,declination_deg,photo\n'
      + 'plane,120,45,30,2026-11-20T14:02:11.000Z,-30.1,-51.2,4,true,-15.2,wuffle-001-x.jpg\nline,200,20,,2026-11-20T14:09:02.000Z,-30.1,-51.2,5,true,-15.2,\n';
    const bytes = enc.encode(log);
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const sig = JSON.stringify({ file: 'wuffle-log.csv', alg: 'ECDSA-P256-SHA256', sig: b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, bytes)),
      pub: b64(await crypto.subtle.exportKey('spki', kp.publicKey)), security: 'bench-software' });
    const before = P.datasets.length;
    await W.files.open([new File([bytes], 'wuffle-log.csv'), new File([sig], 'wuffle-log.csv.sig'), new File([new Uint8Array([0xff, 0xd8, 1])], 'wuffle-001-x.jpg')]);
    const v = await W.console.run('verify');
    const ls = await W.console.run('ls "/project/field/field 2026-11-20" "/project/field/field 2026-11-20/photos"');
    const ro = await W.console.run('echo 9 >> "/project/field/field 2026-11-20/wuffle-log.csv"');
    const zip = await W.files.bytesOf();
    await W.files.loadProject(zip);
    const v2 = await W.console.run('verify');
    return { added: P.datasets.length - before, verify: v.text, ls: ls.text, roOk: ro.ok, verify2: v2.text, kept: P.originals[0] && [...P.originals[0].bytes].length === bytes.length, lineage: P.datasets.at(-1)?.lineage?.op };
  });
  chk(`${label}: a signed field log opens as an original + ${flog.added} datasets (lineage “${flog.lineage}”); verify says “${flog.verify.split('\n')[0].slice(0, 90)}”; /project/field holds ${JSON.stringify(flog.ls.replace(/\s+/g, ' ').slice(0, 90))}; appending to it is refused (${!flog.roOk}); after a .zip.wuffle round trip it still verifies`,
    flog.added === 2 && flog.lineage === 'field log' && /verified/.test(flog.verify) && /wuffle-log\.csv\.sig/.test(flog.ls) && /wuffle-001-x\.jpg/.test(flog.ls) && !flog.roOk && /verified/.test(flog.verify2) && flog.kept);

  // ── found writing the manual: labels draw, a skipped second contour set is SAID on the net, one Apply is one
  //    undo step, and "remove from everywhere" counts diagrams, not layers ──
  const man = await p.evaluate(async () => {
    const W = window.__wuffleDesk, P = W.project, wait = (ms) => new Promise((z) => setTimeout(z, ms));
    const g = P.addDiagram('net', { name: 'Manual net' }); P.setActive(g); W.rails.activateTab('diag:' + g); await wait(200);
    const ds = P.datasets.find((d) => d.name === 'tocher') || P.datasets[0];
    const a = P.addLayer(g, ds.id), b = P.addLayer(g, ds.id);
    P.setElement(a, 'contours', true); P.setElement(b, 'contours', true); await wait(250);
    const view = document.querySelector(`.wn-host:has(svg)`) && [...document.querySelectorAll('.wn-host')].find((h) => h.offsetParent);
    const note = view?.querySelector('.wn-notes'), noteText = note && !note.hidden ? note.textContent : '';
    const texts0 = view.querySelectorAll('svg text').length;
    P.setElement(a, 'labels', true); await wait(200);
    const texts1 = view.querySelectorAll('svg text').length;
    const n0 = P._undo.length;
    P.batch('layer properties', () => { P.setLayerStyle(a, { color: '#112233' }); P.setElementSettings(a, 'contours', { method: 'fisher' }); });
    const steps = P._undo.length - n0;
    return { noteText, texts0, texts1, steps, rows: ds.rows.length };
  });
  chk(`${label}: labels draw (${man.texts0} → ${man.texts1} text marks for ${man.rows} rows); a second contour set is said on the net (“${man.noteText.slice(0, 80)}”); Apply is one undo step (${man.steps})`,
    man.texts1 - man.texts0 === man.rows && /isn’t contoured/.test(man.noteText) && /tocher/.test(man.noteText) && man.steps === 1);

  try { await p.screenshot({ path: path.join(root, `experiments/wuffle-desk-${label}.png`) }); } catch { /* for a person */ }
  chk(`${label}: the desk opens with layers · Net 1 · table · statistics, the field page hidden (${s && JSON.stringify(r.tabs)})`, r.tabs && r.tabs.join() === 'layers,Net 1,table,statistics,console' && r.fieldHidden);
  chk(`${label}: File → Open the tocher sample → ${s.ds && s.ds.n} planes (not guessed: ${s.ds && !s.ds.guessed}), ${s.svgCircles} circles drawn`, s.ds && s.ds.n === 200 && !s.ds.guessed && s.svgCircles >= 200);
  chk(`${label}: the tree's nested checkbox switches contours on (${s.contourOn}, ${s.contourPaths} paths); one eigenvector child makes the group partial (${s.eigenState})`, s.contourOn && s.contourPaths > 0 && /partial/.test(s.eigenState));
  chk(`${label}: a second net gets a VIEW of the same data (${s.viewShares}); its tab appears (${JSON.stringify(s.tabs2)}); the tree marks the link (${JSON.stringify(s.linkBadge)})`, s.viewShares && s.tabs2.includes('Net 2') && s.linkBadge.length >= 1);
  chk(`${label}: a click on a pole selects its row (${JSON.stringify(t.selected)}), drawn violet on BOTH nets (${JSON.stringify(t.violetOn)}); the table shows the dataset (“${(t.tableTitle || '').slice(0, 50)}”)`, t.selected.length === 1 && t.violetOn[0] >= 1 && t.violetOn[1] >= 1 && /tocher/.test(t.tableTitle || ''));
  chk(`${label}: the theme switches (${JSON.stringify(t.theme)})`, t.theme[0] !== t.theme[1] && t.theme[2] === 'light');
  chk(`${label}: a project round-trips through a .zip.wuffle (${JSON.stringify(t.reload)})`, t.zip && t.reload.diagrams === 2 && t.reload.layers === 2 && t.reload.rows === 200 && t.reload.selected.length === 1 && t.reload.tabs === 6);
  // ── the layout is the project's: statistics moved beside the tree and the console floated come back after
  //    the reload below (the autosave), through a saved file, and are put back by Reset layout ──
  const stackHolding = `(id) => { const R = window.__wuffleDesk.rails, all = [], walk = (n) => { if (!n) return; if (n.children) n.children.forEach(walk); else all.push(n); }; walk(R.state.root); return all.find((s) => s.tabs.some((t) => t.id === id)) || null; }`;
  await p.evaluate((sh) => { const R = window.__wuffleDesk.rails, of = eval(sh); R.moveTab('stats', { to: 'stack', stackId: of('tree').id }); R.floatTab('console'); }, stackHolding);
  // ── autosave: a file in /home and the data, then the page reloads — the session comes back ──
  await p.evaluate(async () => { const W = window.__wuffleDesk; await W.console.run('echo kept > /home/note.txt'); W.project.renameDiagram(W.project.diagrams[0].id, 'Autosaved net'); });
  await p.waitForTimeout(1800);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(600);
  const as = await p.evaluate(async () => {
    const W = window.__wuffleDesk, ok = await W.restored;
    const r = await W.console.run('cat /home/note.txt');
    return { ok, names: W.project.diagrams.map((g) => g.name), n: W.project.datasets.length, note: r.text, undo: W.project.canUndo() };
  });
  chk(`${label}: autosave — after a reload the session is back (${as.ok}: ${JSON.stringify(as.names)}, ${as.n} datasets, /home/note.txt “${as.note}”), with a fresh history`,
    as.ok === true && as.names.includes('Autosaved net') && as.n >= 1 && as.note === 'kept' && !as.undo);
  const lay = await p.evaluate(async (sh) => {
    const W = window.__wuffleDesk, R = W.rails, of = eval(sh), P = W.project;
    const where = () => ({ statsWithTree: of('stats') === of('tree'), consoleFloat: (R.state.floats || []).some((f) => f.stack.tabs.some((t) => t.id === 'console')),
      net: [...document.querySelectorAll('.rails-tab')].some((t) => t.textContent.trim() === 'Autosaved net') });
    const reloaded = where();
    const bytes = await W.files.bytesOf();
    await W.files.newProject(); const fresh = where();
    await W.files.loadProject(bytes); const file = where();
    // a layout naming a diagram that isn't there: that tab is dropped, the rest kept, nothing breaks
    const snap = W.layout.snapshot();
    const find = (n) => { if (!n) return null; if (n.children) { for (const c of n.children) { const x = find(c); if (x) return x; } return null; } return n.tabs.includes('tree') ? n : null; };
    const st = find(snap.root); st.tabs.push('diagram:Gone net'); st.active = 'diagram:Gone net';
    P.layout = snap; P._emit('project-loaded');
    const gone = { tabs: [...document.querySelectorAll('.rails-tab')].map((t) => t.textContent.trim()), active: of('tree').active };
    W.layout.reset(); const reset = where();
    return { reloaded, fresh, file, gone, reset };
  }, stackHolding);
  chk(`${label}: the layout comes back after a reload (${JSON.stringify(lay.reloaded)}), a new project has the default (${JSON.stringify(lay.fresh)}), a saved file reopens as arranged (${JSON.stringify(lay.file)}), a tab for a missing diagram is dropped (active falls to ${lay.gone.active}), Reset layout gives the default (${JSON.stringify(lay.reset)})`,
    lay.reloaded.statsWithTree && lay.reloaded.consoleFloat && lay.reloaded.net && !lay.fresh.statsWithTree && !lay.fresh.consoleFloat
    && lay.file.statsWithTree && lay.file.consoleFloat && !lay.gone.tabs.includes('Gone net') && lay.gone.active === 'tree'
    && !lay.reset.statsWithTree && !lay.reset.consoleFloat && lay.reset.net);

  chk(`${label}: no page errors (${errs.length ? errs.join(' ; ').slice(0, 200) : 'none'})`, errs.length === 0);

  // ── save as page (the built file only — the dev tree has no page to copy): the saved page opens on the
  //    desk INTO its project, with no autosave to lean on (a fresh context), and is smaller than it looks ──
  if (label === 'built') {
    const saved = await p.evaluate(async () => {
      const W = window.__wuffleDesk;
      W.project.renameDiagram(W.project.diagrams[0].id, 'Sent net');
      return { can: W.files.canSavePage(), html: await W.files.pageHtml(), names: W.project.diagrams.map((g) => g.name), n: W.project.datasets.length };
    });
    served.set('/sent.wuffle.html', saved.html);
    const ctx2 = await b.newContext({ viewport: { width: 1360, height: 860 } });
    const p2 = await ctx2.newPage(); const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
    await p2.goto(`http://127.0.0.1:${PORT}/sent.wuffle.html`, { waitUntil: 'load' }); await p2.waitForTimeout(800);
    const got = await p2.evaluate(async () => {
      const W = window.__wuffleDesk; if (!W) return { desk: false };
      const ok = await W.restored;
      const r = await W.console.run('cat /home/note.txt');
      return { desk: true, ok, names: W.project.diagrams.map((g) => g.name), n: W.project.datasets.length, note: r.text, title: document.title };
    });
    // and File → Open of the page from ANOTHER wuffle reads only its project
    const opened = await p.evaluate(async (html) => {
      const W = window.__wuffleDesk; await W.files.newProject();
      await W.open([new File([html], 'sent.wuffle.html', { type: 'text/html' })]);
      return W.project.diagrams.map((g) => g.name);
    }, saved.html);
    chk(`built: Save as page → a ${(saved.html.length / 1024).toFixed(0)} KB page; opened fresh it goes to the desk (${got.desk}) INTO its project (${JSON.stringify(got.names)}, ${got.n} datasets, /home kept: “${got.note}”, title “${got.title}”); File → Open of that page in another wuffle reads its project (${JSON.stringify(opened)})`,
      saved.can && got.desk && got.ok && JSON.stringify(got.names) === JSON.stringify(saved.names) && got.n === saved.n && got.note === 'kept'
      && /Sent|untitled/.test(got.title) && opened.includes('Sent net') && errs2.length === 0);
    await ctx2.close();
  }
  // ── the menus: the analyses reachable without the console, through forms, each running the console's own command ──
  const tops = await p.evaluate(() => [...document.querySelectorAll('#wdesk .wmenus .gcu-menubar-trigger')].map((x) => x.textContent.trim()));
  chk(`${label}: the menubar is ${tops.join(' · ')}`, tops.join() === 'File,Edit,Data,Diagram,Analysis,Figure,Tools,View,Help');
  const dialog = async (action, fill, okLabel) => {
    await p.evaluate((a) => { window.__wuffleDesk.menus.run(a); }, action);
    await p.waitForSelector('.gcu-dialog [data-key]', { timeout: 5000 });
    await p.evaluate(([f, ok]) => {
      const dlg = [...document.querySelectorAll('.gcu-dialog')].at(-1);
      for (const [k, v] of Object.entries(f)) { const el = dlg.querySelector(`[data-key="${k}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      [...dlg.querySelectorAll('button')].find((x) => x.textContent === ok).click();
    }, [fill, okLabel]);
    await p.waitForTimeout(500);
    // a long answer comes in a box: read it, close it
    return p.evaluate(() => { const d = [...document.querySelectorAll('.gcu-dialog')].at(-1); if (!d) return ''; const t = d.querySelector('.gcu-dialog-message')?.textContent || ''; [...d.querySelectorAll('button')].find((x) => x.textContent === 'OK')?.click(); return t; });
  };
  await p.evaluate(async () => { const W = window.__wuffleDesk; await W.files.newProject(); W.menus.run('tocher'); });
  await p.waitForTimeout(400);
  await dialog('contours', { filled: true, k: '2' }, 'Contour');
  const kin = await dialog('kinematic', { face: '180/60', phi: '30' }, 'Analyse');
  await dialog('selwhere', { expr: 'dip > 60' }, 'Select');
  await dialog('add', { kind: 'p', text: '045/30\n120/60' }, 'Add');
  const fold = await dialog('fold', { keep: false }, 'Analyse');
  const m = await p.evaluate(() => {
    const W = window.__wuffleDesk, P = W.project, ds = P.datasets.find((d) => /tocher/.test(d.name)), L = P.layers.find((l) => l.datasetId === ds.id);
    W.menus.run('tool:lasso'); const tool = W.select.tool; W.menus.run('tool:pick');
    const dipCol = ds.roles.dip, sel = P.selected(ds.id);
    return { filled: !!(L.elements.contours.on && L.elements.contours.filled && L.elements.contours.sigma === 2), kinCol: ds.columns.includes('kinematic'),
      steep: sel.length, allSteep: sel.length > 0 && sel.every((i) => +ds.rows[i][dipCol] > 60), steepAll: ds.rows.filter((r) => +r[dipCol] > 60).length,
      typed: P.datasets.find((d) => d.name === 'typed planes')?.rows.length, tool, transcript: W.console.cmd.history.join('\n') };
  });
  chk(`${label}: Diagram → Contours… (filled, 2σ: ${m.filled}); Analysis → Slope stability… (“${(kin.split('\n')[1] || '').trim()}”, a kinematic column: ${m.kinCol}); Edit → Select where… (${m.steep} of ${m.steepAll} steep); Data → Add measurements… (${m.typed} typed); Analysis → Fold… (“${fold.slice(0, 50)}”); Tools → lasso (${m.tool}); each shows in the console as its command`,
    m.filled && /planar/.test(kin) && m.kinCol && m.allSteep && m.steep === m.steepAll && m.typed === 2 && /fold axis/.test(fold) && m.tool === 'lasso'
    && /contour kamb 2/.test(m.transcript) && /kinematic .*180\/60/.test(m.transcript) && /select where/.test(m.transcript) && /add p 045\/30 120\/60/.test(m.transcript));
  chk(`${label}: no page errors after the menus (${errs.length ? errs.join(' ; ').slice(0, 200) : 'none'})`, errs.length === 0);
  // ── the keys and gestures on a net (desk-keys.js), the measure menu, intersect, and the properties tabs ──
  await p.evaluate(async () => { const W = window.__wuffleDesk; await W.files.newProject(); W.menus.run('tocher'); });
  await p.waitForTimeout(400);
  const netBox = async () => p.evaluate(() => { const W = window.__wuffleDesk, v = W.views.get(W.project.activeDiagram), r = v.stage.querySelector('svg').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await p.evaluate(() => { document.activeElement?.blur(); });
  const k = await (async () => {
    const W = () => 'window.__wuffleDesk';
    const out = {};
    const props = () => p.evaluate(() => { const W = window.__wuffleDesk; return W.project.diagram(W.project.activeDiagram).props; });
    await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(200);
    out.turned = !!(await props()).matrix;
    out.button = await p.evaluate(() => !!document.querySelector('.wn-rot'));
    await p.keyboard.press('r'); await p.waitForTimeout(200);
    out.reset = !(await props()).matrix && !(await p.evaluate(() => !!document.querySelector('.wn-rot')));
    await p.keyboard.press('Control+a'); await p.waitForTimeout(150);
    out.all = await p.evaluate(() => { const W = window.__wuffleDesk; return W.project.selected(W.project.datasets[0].id).length; });
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    out.cleared = await p.evaluate(() => { const W = window.__wuffleDesk; return W.project.selected(W.project.datasets[0].id).length; });
    // double-click a pole → its row in the table; hovering with one selected says the angle from it
    const pos = await p.evaluate(() => { const W = window.__wuffleDesk, v = W.views.get(W.project.activeDiagram), r = v.stage.querySelector('svg').getBoundingClientRect(), s = r.width / v.net.size, pk = v.picks[17]; return { x: r.x + pk.x * s, y: r.y + pk.y * s, row: pk.ref.row }; });
    await p.mouse.dblclick(pos.x, pos.y); await p.waitForTimeout(250);
    out.dbl = await p.evaluate(() => { const R = window.__wuffleDesk.rails, all = []; const walk = (n) => { if (!n) return; if (n.children) n.children.forEach(walk); else all.push(n); }; walk(R.state.root); const st = all.find((x) => x.tabs.some((t) => t.id === 'table')); return st && st.active === 'table' ? 'table in front' : `the ${st && st.active} tab`; });
    out.dblRow = pos.row;
    await p.evaluate(() => { const W = window.__wuffleDesk; W.layout.focusDiagram(W.project.activeDiagram); });
    const b = await netBox();
    await p.mouse.move(b.x + b.w * 0.3, b.y + b.h * 0.4); await p.waitForTimeout(150);
    out.hover = await p.evaluate(() => document.querySelector('.wst-hover').textContent);
    // ? opens the keys help
    await p.evaluate(() => { document.activeElement?.blur(); }); await p.keyboard.press('?'); await p.waitForTimeout(200);
    out.help = await p.evaluate(() => { const d = [...document.querySelectorAll('.gcu-dialog')].at(-1); const t = d?.textContent || ''; d?.querySelector('button')?.click(); return t; });
    return out;
  })();
  chk(`${label}: keys — arrows turn the net (${k.turned}) and it says so (${k.button}); R resets it (${k.reset}); Ctrl+A selects all (${k.all}); Esc clears the selection (${k.cleared}); a double-click shows the row (${k.dbl}); hovering, one selected: “${(k.hover.match(/[\d.]+° from the selected/) || [''])[0]}”; ? lists the keys (${/reset the active net/.test(k.help)})`,
    k.turned && k.button && k.reset && k.all === 200 && k.cleared === 0 && /table/.test(k.dbl) && /° from the selected/.test(k.hover) && /reset the active net/.test(k.help));

  // the measure tool: a right CLICK opens its menu; measure from here; intersect two planes into "drawn lines"
  const mm = await (async () => {
    const out = {};
    await p.waitForFunction(() => !document.querySelector('.gcu-dialog-message'));   // the keys help, faded out (it caught the click)
    await p.evaluate(() => { const W = window.__wuffleDesk; W.select.setTool('measure'); });
    const b = await netBox();
    await p.mouse.move(b.x + b.w * 0.5, b.y + b.h * 0.5); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(300);
    out.menu = await p.evaluate(() => [...document.querySelectorAll('.gcu-menu .gcu-menu-item, .gcu-menu [role=menuitem]')].map((x) => x.textContent.trim()).slice(0, 30));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    // measure from here: A at the centre, B where we click
    await p.evaluate(() => { const W = window.__wuffleDesk, v = W.views.get(W.project.activeDiagram); W.measure.startFrom(v, [0, 0, -1]); });
    await p.mouse.move(b.x + b.w * 0.75, b.y + b.h * 0.5); await p.waitForTimeout(100);
    await p.mouse.click(b.x + b.w * 0.75, b.y + b.h * 0.5); await p.waitForTimeout(200);
    out.measured = await p.evaluate(() => { const W = window.__wuffleDesk, v = W.views.get(W.project.activeDiagram), mm = W.measure.measurementOf(v); return mm ? +mm.angle.toFixed(1) : null; });
    await p.evaluate(() => { const W = window.__wuffleDesk; W.select.setTool('pick'); });
    await p.keyboard.press('Escape');
    // intersect: the net menu on one pole, then a click on another
    const poles = await p.evaluate(() => { const W = window.__wuffleDesk, v = W.views.get(W.project.activeDiagram), r = v.stage.querySelector('svg').getBoundingClientRect(), s = r.width / v.net.size; return [v.picks[3], v.picks[40]].map((pk) => ({ x: r.x + pk.x * s, y: r.y + pk.y * s })); });
    await p.mouse.click(poles[0].x, poles[0].y, { button: 'right' }); await p.waitForTimeout(250);
    await p.click('.gcu-menu >> text=Intersect with another plane…'); await p.waitForTimeout(150);
    await p.mouse.click(poles[1].x, poles[1].y); await p.waitForTimeout(300);
    out.drawn = await p.evaluate(() => { const d = window.__wuffleDesk.project.datasets.find((x) => x.name === 'drawn lines'); return d ? { n: d.rows.length, label: d.rows[0].label } : null; });
    out.status = await p.evaluate(() => document.querySelector('.wst-hover').textContent);
    return out;
  })();
  chk(`${label}: measure menu on a right click (${mm.menu.filter((x) => /Measure from here|nothing measured|How to measure/.test(x)).join(' · ')}); measure from here → ${mm.measured}°; intersect two planes → drawn lines ${JSON.stringify(mm.drawn)} (“${mm.status.slice(0, 70)}”)`,
    mm.menu.some((x) => /Measure from here/.test(x)) && mm.measured > 10 && mm.drawn && mm.drawn.n === 1 && / × /.test(mm.drawn.label) && /meet in/.test(mm.status));

  // the properties tabs: symbol, colour by a column, a filter, dashed circles, the Schmidt method — on the net
  const pr = await (async () => {
    const lid = await p.evaluate(() => { const W = window.__wuffleDesk, P = W.project, L = P.layers.find((l) => P.dataset(l.datasetId).name === 'tocher'); P.setElement(L.id, 'greatCircles', true); P.setElement(L.id, 'contours', true); W.tree.properties(L.id); return L.id; });
    await p.waitForSelector('.gcu-dialog .wpt-tab'); await p.waitForTimeout(150);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.gcu-dialog .wpt-tab')].map((t) => t.textContent));
    await p.evaluate(() => {
      const d = [...document.querySelectorAll('.gcu-dialog')].at(-1), set = (el, v) => { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const byLabel = (pane, label) => [...d.querySelectorAll(`.wpt-pane[data-tab="${pane}"] .wprow`)].find((r) => r.firstChild.textContent === label).lastChild;
      set(byLabel('general', 'only rows where'), 'dip > 45');
      set(byLabel('symbols', 'symbol'), 'triangle');
      set(byLabel('symbols', 'colour by'), 'dip'); set(byLabel('symbols', '… as'), 'num');
      set(byLabel('lines', 'line'), 'dashed');
      set(byLabel('contours', 'method'), 'percent');
      [...d.querySelectorAll('button')].find((x) => x.textContent === 'Apply').click();
    });
    await p.waitForTimeout(400);
    return p.evaluate((id) => {
      const W = window.__wuffleDesk, P = W.project, L = P.layer(id), ds = P.dataset(L.datasetId), v = W.views.get(P.activeDiagram), svg = v.stage.querySelector('svg');
      const steep = ds.rows.filter((r, i) => true).length;
      const tri = [...svg.querySelectorAll('path')].filter((e) => /\bwn-pole\b/.test(e.getAttribute('class') || '')).length;
      const colours = new Set([...svg.querySelectorAll('path.wn-pole')].map((e) => e.getAttribute('fill')));
      const dashed = [...svg.querySelectorAll('[class*="wn-plane"]')].filter((e) => e.getAttribute('stroke-dasharray') === '6,4').length;
      return { tri, colours: colours.size, dashed, picks: v.picks.length, method: L.elements.contours.method, undo: P.undoLabel && P.undoLabel(), notesN: v.notesEl.textContent };
    }, lid);
  })();
  chk(`${label}: properties in tabs (${pr && JSON.stringify(Object.keys(pr))}) — triangles drawn (${pr.tri}), coloured by dip (${pr.colours} colours), only dip > 45 (${pr.picks} of 200 picks), dashed great circles (${pr.dashed}), contours by the Schmidt % method (${pr.method}), one undo step (“${pr.undo}”)`,
    pr.tri > 50 && pr.colours > 5 && pr.picks > 50 && pr.picks < 200 && pr.dashed > 50 && pr.method === 'percent' && /layer properties/.test(pr.undo || ''));
  // colour by over the filtered rows: the ramp starts at the lowest KEPT dip, so that pole's colour changes
  const cf = await (async () => {
    const lowFill = () => p.evaluate(() => {
      const W = window.__wuffleDesk, P = W.project, v = W.views.get(P.activeDiagram), L = P.layers.find((l) => P.dataset(l.datasetId).name === 'tocher');
      const fills = [...v.stage.querySelectorAll('svg path.wn-pole')].map((e) => e.getAttribute('fill'));
      return { fills: fills.join('|'), filtered: !!(L.style.colorBy && L.style.colorBy.filtered), id: L.id };
    });
    const before = await lowFill();
    await p.evaluate((id) => { window.__wuffleDesk.tree.properties(id); }, before.id);   // its promise settles on close
    await p.waitForFunction(() => [...document.querySelectorAll('.gcu-dialog .wpt-pane[data-tab="symbols"] .wprow')].some((r) => r.firstChild.textContent === '… over'));
    await p.waitForTimeout(150);
    await p.evaluate(() => {
      const d = [...document.querySelectorAll('.gcu-dialog')].at(-1);
      const el = [...d.querySelectorAll('.wpt-pane[data-tab="symbols"] .wprow')].find((r) => r.firstChild.textContent === '… over').lastChild;
      el.value = 'filtered'; el.dispatchEvent(new Event('change', { bubbles: true }));
      [...d.querySelectorAll('button')].find((x) => x.textContent === 'Apply').click();
    });
    await p.waitForTimeout(400);
    return { before, after: await lowFill() };
  })();
  chk(`${label}: colour by can follow the filter (saved ${cf.after.filtered}; the poles' colours ${cf.before.fills === cf.after.fills ? 'did NOT change' : 'changed'} once the ramp spans only the kept rows)`,
    !cf.before.filtered && cf.after.filtered && cf.before.fills !== cf.after.fills);
  chk(`${label}: no page errors after the keys, the measure menu and the properties (${errs.length ? errs.join(' ; ').slice(0, 200) : 'none'})`, errs.length === 0);
  await p.close();
}
await b.close(); server.close();
console.log(`\nwuffle-desk-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
