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
    const sx = rc.left + k.x / (v.sn.size / rc.width), sy = rc.top + k.y / (v.sn.size / rc.height);
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
    W.theme('light'); await wait(200);
    out.theme = [bg0, getComputedStyle(document.body).getPropertyValue('--w-net-bg').trim(), document.documentElement.dataset.resolvedTheme];
    W.theme('system');
    // a project round trip (save → load) through the same shapes
    const j = JSON.parse(JSON.stringify(P.toJSON()));
    W.loadProject(j); await wait(300);
    out.reload = { diagrams: P.diagrams.length, layers: P.layers.length, rows: P.datasets[0].rows.length, selected: P.selected(P.datasets[0].id), tabs: [...document.querySelectorAll('.rails-tab')].length };
    return out;
  });
  try { await p.screenshot({ path: path.join(root, `experiments/wuffle-desk-${label}.png`) }); } catch { /* for a person */ }
  chk(`${label}: the desk opens with layers · Net 1 · table, the field page hidden (${s && JSON.stringify(r.tabs)})`, r.tabs && r.tabs.join() === 'layers,Net 1,table' && r.fieldHidden);
  chk(`${label}: File → Open the tocher sample → ${s.ds && s.ds.n} planes (not guessed: ${s.ds && !s.ds.guessed}), ${s.svgCircles} circles drawn`, s.ds && s.ds.n === 200 && !s.ds.guessed && s.svgCircles >= 200);
  chk(`${label}: the tree's nested checkbox switches contours on (${s.contourOn}, ${s.contourPaths} paths); one eigenvector child makes the group partial (${s.eigenState})`, s.contourOn && s.contourPaths > 0 && /partial/.test(s.eigenState));
  chk(`${label}: a second net gets a VIEW of the same data (${s.viewShares}); its tab appears (${JSON.stringify(s.tabs2)}); the tree marks the link (${JSON.stringify(s.linkBadge)})`, s.viewShares && s.tabs2.includes('Net 2') && s.linkBadge.length >= 1);
  chk(`${label}: a click on a pole selects its row (${JSON.stringify(t.selected)}), drawn violet on BOTH nets (${JSON.stringify(t.violetOn)}); the table shows the dataset (“${(t.tableTitle || '').slice(0, 50)}”)`, t.selected.length === 1 && t.violetOn[0] >= 1 && t.violetOn[1] >= 1 && /tocher/.test(t.tableTitle || ''));
  chk(`${label}: the theme switches (${JSON.stringify(t.theme)})`, t.theme[0] !== t.theme[1] && t.theme[2] === 'light');
  chk(`${label}: a project round-trips (${JSON.stringify(t.reload)})`, t.reload.diagrams === 2 && t.reload.layers === 2 && t.reload.rows === 200 && t.reload.selected.length === 1 && t.reload.tabs === 4);
  chk(`${label}: no page errors (${errs.length ? errs.join(' ; ').slice(0, 200) : 'none'})`, errs.length === 0);
  await p.close();
}
await b.close(); server.close();
console.log(`\nwuffle-desk-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
