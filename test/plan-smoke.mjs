// plan tool smoke — the committed app-integration guard (the tool previously
// had ZERO; the lib's 124 unit tests can't catch wiring breaks). Drives the
// BUILT tools/plan/index.html: boot → example → docked grid with computed
// columns → progress → EVM → Monte Carlo → save/load round trip.
// Run: npm run test:plan  (or node test/plan-smoke.mjs)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  try { const q = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': MIME[path.extname(q)] || 'application/octet-stream' }); res.end(fs.readFileSync('.' + q));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const fail = (m) => { console.error('✖ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✔ ' + m);
const chk = (m, cond) => (cond ? ok(m) : fail(m));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/plan/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window._plan, null, { timeout: 10000 });
  ok('plan booted (built tools/plan/index.html)');

  // ── open a built-in example, read the schedule as a TABLE ──
  await page.evaluate(() => window._plan.openExample('Simple Project'));
  await page.waitForTimeout(800);
  const grid = await page.evaluate(() => {
    const pane = document.querySelector('#pp-task-pane');
    const cols = [...document.querySelectorAll('#pp-task-pane th')].map((t) => t.textContent.trim());
    const r0 = document.querySelectorAll('#pp-task-pane tbody tr')[0];
    return {
      docked: !!pane && !pane.classList.contains('hidden') && pane.previousElementSibling?.id === 'pp-menubar',
      cols, row0: r0 ? [...r0.children].map((t) => t.textContent.trim()) : null,
      tasks: window._plan.PP.tasks.length,
    };
  });
  chk(`example opens with the grid DOCKED above the gantt (${grid.tasks} tasks)`, grid.docked && grid.tasks === 4);
  chk(`the schedule reads as a table — all ${grid.cols.length} columns incl. computed (${grid.cols.slice(-5).join(', ')})`,
    grid.cols.length === 14 && grid.cols.includes('Start') && grid.cols.includes('Finish') && grid.cols.includes('Float') && grid.cols.includes('%'));
  chk(`computed columns populate (start ${grid.row0 && grid.row0[10]}, float ${grid.row0 && grid.row0[12]}, critical ${grid.row0 && grid.row0[13]})`,
    grid.row0 && /^\d{4}-\d{2}-\d{2}$/.test(grid.row0[10]) && grid.row0[12] === '0' && grid.row0[13] === '◆');

  // ── critical is COPPER, not fault-red (GCU role semantics) ──
  const critColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--critical-color').trim());
  chk(`critical path colour is copper, not red (${critColor})`, /^#b87333$/i.test(critColor));

  // ── Ctrl+E toggles the pane ──
  await page.keyboard.press('Control+e');
  const hidden = await page.evaluate(() => document.querySelector('#pp-task-pane').classList.contains('hidden'));
  await page.keyboard.press('Control+e');
  chk('Ctrl+E hides/shows the task pane', hidden);

  // ── progress feeds EVM end to end ──
  const evm = await page.evaluate(async () => {
    const P = window._plan;
    P.PP.tasks[0].progress = '100';
    P.PP.tasks[1].progress = '50';
    P.evaluate();
    P.showEVMPanel();
    document.querySelector('#pp-sidebar').classList.remove('hidden');
    const txt = document.querySelector('#pp-sidebar-content').textContent;
    return { spi: /SPI/.test(txt), ev: P.PP.evmResult && P.PP.evmResult.ev };
  });
  chk(`progress → EVM: the panel computes (EV ${evm.ev})`, evm.spi && evm.ev > 0);

  // ── Monte Carlo runs and reports ──
  await page.keyboard.press('Control+m');
  await page.waitForFunction(() => /Monte Carlo complete/.test(document.querySelector('#pp-status-msg').textContent), null, { timeout: 30000 });
  ok('Monte Carlo runs (status reports completion)');

  // ── save → load round trip preserves the plan ──
  const rt = await page.evaluate(() => {
    const P = window._plan;
    const data = P.serializeProject();
    P.newFile();
    const cleared = P.PP.tasks.length;
    P.loadProjectData(JSON.parse(JSON.stringify(data)));
    P.evaluate();
    return { cleared, back: P.PP.tasks.length, progressKept: P.PP.tasks[0].progress };
  });
  chk(`save/load round trip (${rt.back} tasks back, progress kept "${rt.progressKept}")`, rt.back === 4 && String(rt.progressKept) === '100');

  // ── the templates window still floats (Ctrl+T) ──
  await page.keyboard.press('Control+t');
  const tpl = await page.evaluate(() => { const w = document.querySelector('#pp-tpl-window'); return !!w && !w.classList.contains('hidden'); });
  chk('templates window opens (floating, Ctrl+T)', tpl);

  if (errors.length) fail('console errors: ' + errors.slice(0, 3).join(' | '));
  else ok('no console errors');
} catch (e) {
  fail('smoke threw: ' + e.message);
} finally {
  await browser.close();
  server.close();
}
console.log(process.exitCode ? '\nPLAN SMOKE: FAIL' : '\nPLAN SMOKE: PASS');
