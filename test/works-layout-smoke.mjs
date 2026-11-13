// Works on the rails split tree: the bottom panel, "open to the side", the
// tab context menu, collapse, the main area re-created above a lone panel,
// and the layout (panel tag included) surviving a reload.
// Not part of `npm test` — a Playwright run against the BUILT works.html:
//   node build.js --target=works && node test/works-layout-smoke.mjs
// WORKS_SHOTS=1 also writes screenshots to experiments/.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/works.html`;

let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) fails++;
};
const SHOTS = !!process.env.WORKS_SHOTS;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const snap = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'experiments', name) }); };

async function boot() {
  await page.addInitScript(() => { window.__NO_AUTO_SETUP__ = true; });
  await page.goto(url);
  await page.waitForFunction(() => window.WKS && window.WKS.rails && window.WKS.spawnInPanel, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

// The dock as a compact string: splits as dir(children), stacks by their
// tab count, the panel marked P.
const shape = () => page.evaluate(() => {
  const f = (n) => !n ? 'null' : n.children ? `${n.dir}(${n.children.map(f).join(',')})`
    : (n.role === 'panel' ? 'P' : 'S') + n.tabs.length + (n.collapsed ? '~' : '');
  return f(window.WKS.rails.state.root);
});
const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
}, sel);
const stackOfTab = (tabId) => page.evaluate((id) => {
  const f = (n) => { if (!n) return null; if (n.children) { for (const c of n.children) { const r = f(c); if (r) return r; } return null; }
    return n.tabs.some((t) => t.id === id) ? n.id : null; };
  return f(window.WKS.rails.state.root);
}, tabId);
async function clickMenuItem(label) {
  await page.waitForSelector('.gcu-menu .gcu-menu-item', { timeout: 3000 });
  await page.locator('.gcu-menu .gcu-menu-item', { hasText: label }).first().click();
  await page.waitForTimeout(200);
}

await boot();

// Start from an empty dock (a fresh workspace auto-opens the Launcher).
await page.evaluate(() => {
  const R = window.WKS.rails;
  const ids = [];
  const f = (n) => { if (!n) return; if (n.children) n.children.forEach(f); else n.tabs.forEach((t) => ids.push(t.id)); };
  f(R.state.root);
  for (const fl of R.state.floats) fl.stack.tabs.forEach((t) => ids.push(t.id));
  ids.forEach((id) => R.closeTab(id));
});
check('dock starts empty', (await shape()) === 'null', await shape());

// 1. two surfaces in the main area, then a panel surface
const ids = await page.evaluate(() => {
  const W = window.WKS;
  const a = W.spawnSurface('stub', { title: 'A' });
  const b = W.spawnSurface('stub', { title: 'B' });
  const p = W.spawnInPanel('stub', { title: 'Panel' });
  return { a, b, p };
});
check('panel spans the bottom of the dock', (await shape()) === 'col(S2,P1)', await shape());
{
  const dock = await rectOf('#works-rails');
  const panelId = await page.evaluate(() => window.WKS.panelStack().id);
  const slot = await rectOf(`.rails-slot[data-slot-for="${panelId}"]`);
  check('panel is full width', slot && Math.abs(slot.w - dock.w) < 4, `${slot?.w} vs ${dock.w}`);
  check('panel takes about a third of the height', slot && slot.h > dock.h * 0.2 && slot.h < dock.h * 0.4, `${slot?.h} of ${dock.h}`);
  const btn = await page.evaluate((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    const b = el && el.querySelector('.rails-collapse-btn');
    const r = b && b.getBoundingClientRect();
    return { node: !!el, cls: el?.className, btn: !!b, w: r?.width, h: r?.height, text: b?.textContent };
  }, panelId);
  check('panel shows a collapse button', btn.btn && btn.w > 10 && btn.h > 10, JSON.stringify(btn));
}

// 2. a plain spawn joins the main area, not the panel — even when the panel tab was last active
const c = await page.evaluate(() => window.WKS.spawnSurface('stub', { title: 'C' }));
check('default spawn lands in the main area', (await shape()) === 'col(S3,P1)', await shape());

// 3. open to the side
const d = await page.evaluate(() => window.WKS.spawnSurface('stub', { title: 'D' }, window.WKS.sideTarget('right')));
check('sideTarget opens beside the main stack', (await shape()) === 'col(row(S3,S1),P1)', await shape());
await snap('works-layout-1.png');

// 4. right-click a tab → Split down
{
  const before = await stackOfTab(ids.b);
  await page.click(`.rails-tab[data-tab-id="${ids.b}"]`, { button: 'right' });
  await clickMenuItem('Split down');
  const after = await stackOfTab(ids.b);
  check('tab menu "Split down" moves the tab to a new stack', after && after !== before, await shape());
  check('…below its old stack', (await shape()) === 'col(row(col(S2,S1),S1),P1)', await shape());
}

// 5. a lone tab can't be split from its menu
{
  await page.click(`.rails-tab[data-tab-id="${d}"]`, { button: 'right' });
  await page.waitForSelector('.gcu-menu .gcu-menu-item');
  const disabled = await page.evaluate(() => {
    const it = [...document.querySelectorAll('.gcu-menu .gcu-menu-item')].find((e) => e.textContent.includes('Split right'));
    return !!it && (it.classList.contains('disabled') || it.getAttribute('aria-disabled') === 'true' || it.hasAttribute('disabled'));
  });
  await page.keyboard.press('Escape');
  check('"Split right" is disabled on a lone tab', disabled);
}

// 6. collapse / expand the panel; spawning into a collapsed panel expands it
{
  await page.evaluate(() => window.WKS.togglePanel());
  const panelId = await page.evaluate(() => window.WKS.panelStack().id);
  const h = (await rectOf(`[data-node-id="${panelId}"]`))?.h;
  check('togglePanel collapses it to a strip', (await shape()).endsWith('P1~)') && h != null && h < 40, `${await shape()} h=${h}`);
  await page.evaluate(() => window.WKS.spawnInPanel('stub', { title: 'Panel 2' }));
  check('spawnInPanel expands a collapsed panel', (await shape()).endsWith('P2)'), await shape());
}

// 7. move a panel tab to the main area through its menu
{
  await page.click(`.rails-tab[data-tab-id="${ids.p}"]`, { button: 'right' });
  await clickMenuItem('Move to main area');
  const s = await stackOfTab(ids.p);
  const panelId = await page.evaluate(() => window.WKS.panelStack()?.id);
  check('"Move to main area" leaves the panel', s && s !== panelId, await shape());
}

// 8. the layout — panel tag included — survives a reload
const savedShape = await shape();
await page.waitForTimeout(600);   // the layout save is debounced 250 ms
await boot();
check('layout restores after reload', (await shape()) === savedShape, `${await shape()} vs ${savedShape}`);
check('the restored panel is still the panel', await page.evaluate(() => !!window.WKS.panelStack()));

// 9. close everything but the panel, then spawn: the main area comes back above it
{
  await page.evaluate(() => {
    const R = window.WKS.rails, panel = window.WKS.panelStack();
    const ids = [];
    const f = (n) => { if (!n) return; if (n.children) n.children.forEach(f); else if (n !== panel) n.tabs.forEach((t) => ids.push(t.id)); };
    f(R.state.root);
    ids.forEach((id) => R.closeTab(id));
  });
  check('only the panel is left', /^P\d$/.test(await shape()), await shape());
  await page.evaluate(() => window.WKS.spawnSurface('stub', { title: 'E' }));
  check('a new surface goes above the lone panel', (await shape()).startsWith('col(S1,P'), await shape());
  const dock = await rectOf('#works-rails');
  const panelId = await page.evaluate(() => window.WKS.panelStack().id);
  const slot = await rectOf(`.rails-slot[data-slot-for="${panelId}"]`);
  check('…and the panel gets its third back', slot && slot.h < dock.h * 0.4, `${slot?.h} of ${dock.h}`);
  await snap('works-layout-2.png');
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
