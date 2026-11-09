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

console.log(`\nmicro-structure-smoke: ${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
