// @gcu/rails in a real browser: the split tree driven through ext/rails/demo.html —
// edge splits, the workspace rim, resize bars at depth, collapse, float redock
// onto an edge, Escape, pre-0.4 layouts loading, and the tree tidying itself.
// node test/rails-smoke.mjs   (RAILS_SHOTS=1 also writes screenshots to experiments/)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
const port = server.address().port;

let fails = 0;
const SHOTS = !!process.env.RAILS_SHOTS;
async function snap(name) { if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'experiments', name) }); }
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) fails++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:${port}/ext/rails/demo.html`);
await page.waitForFunction(() => window.rails);

const shape = () => page.evaluate(() => {
  const f = n => !n ? 'null' : n.children ? `${n.dir}(${n.children.map(f).join(',')})` : n.id;
  return f(window.rails.state.root);
});
const rect = (sel) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
const tabSel = id => `.rails-tab[data-tab-id="${id}"]`;
const slotSel = id => `.rails-slot[data-slot-for="${id}"]`;
async function drag(fromSel, x, y, shot) {
  const r = await rect(fromSel);
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w / 2 + 20, r.y + r.h / 2 + 20, { steps: 4 });
  await page.mouse.move(x, y, { steps: 12 });
  if (shot) await snap(shot);
  await page.mouse.up();
  await page.waitForTimeout(250);
}
const stackOf = tabId => page.evaluate(id => {
  const f = (n, p) => { if (!n) return null; if (n.children) { for (const c of n.children) { const r = f(c, n); if (r) return r; } return null; }
    return n.tabs.some(t => t.id === id) ? { stack: n.id, parent: p ? p.id + ':' + p.dir : null } : null; };
  return f(window.rails.state.root, null);
}, tabId);

// 1. initial render
check('initial tree', (await shape()) === 'row(s1,col(s2,s3))', await shape());
const iframe0 = await page.evaluate(() => { const el = document.querySelector('.rails-panel[data-tab-id="t3"] iframe'); window.__iframe = el; return !!el; });
check('iframe panel present', iframe0);
const s3slot = await rect(slotSel('s3'));
check('nested stack has a real slot', s3slot.w > 100 && s3slot.h > 50, JSON.stringify(s3slot));

// 2. drag scratch.txt (t2) to the RIGHT edge of s3 → s3 splits side by side
{
  const r = await rect(slotSel('s3'));
  await drag(tabSel('t2'), r.x + r.w - 40, r.y + r.h / 2, 'rails-preview-edge.png');
  const sh = await shape();
  const where = await stackOf('t2');
  check('right-edge drop splits s3 sideways', /col\(s2,row\(s3,s\w+\)\)/.test(sh), sh);
  check('t2 lives in a new stack inside a row', where && where.parent?.endsWith(':row') && where.stack !== 's3', JSON.stringify(where));
  await snap('rails-split-1.png');
}

// 3. drag canvas.fx (t4) to the bottom rim of the workspace → full-width row
{
  const ws = await rect('#workspace');
  await drag(tabSel('t4'), ws.x + ws.w / 2, ws.y + ws.h - 5, 'rails-preview-rim.png');
  const sh = await shape();
  const root = await page.evaluate(() => ({ dir: window.rails.state.root.dir, last: window.rails.state.root.children.at(-1) }));
  check('bottom-rim drop makes a column root', root.dir === 'col', sh);
  check('the new bottom stack holds t4 and spans the width', root.last.tabs?.some(t => t.id === 't4'), sh);
  const slot = await rect(slotSel(root.last.id));
  check('bottom stack is full width', slot.w > ws.w - 20, `${slot.w} vs ${ws.w}`);
  await snap('rails-split-2.png');
}

// 4. the iframe survived both moves (never reparented)
check('iframe element identity survives', await page.evaluate(() => document.querySelector('.rails-panel[data-tab-id="t3"] iframe') === window.__iframe));

// 5. drag the root's horizontal bar (between the top part and the bottom row).
// Grab it near the left: the seeded float sits over its middle.
{
  const top = await page.evaluate(() => window.rails.state.root.children.map(c => c.flex));
  const rootBar = await page.evaluate(() => {
    const rootEl = document.querySelector('.rails-rails > .rails-node');
    const bar = rootEl.querySelector(':scope > .rails-bar');
    const r = bar.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 };
  });
  await page.mouse.move(rootBar.x, rootBar.y);
  await page.mouse.down();
  await page.mouse.move(rootBar.x, rootBar.y - 120, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.rails.state.root.children.map(c => c.flex));
  const sumB = top.reduce((a, x) => a + (x ?? 1), 0), sumA = after.reduce((a, x) => a + (x ?? 1), 0);
  check('root bar drag changes weights', after[0] < (top[0] ?? 1) && Math.abs(sumA - sumB) < 1e-6, `${JSON.stringify(top)} → ${JSON.stringify(after)}`);
}

// 6. collapse / expand the collapsible group s1
{
  await page.click('[data-node-id="s1"] .rails-collapse-btn');
  const c = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id="s1"]');
    return { collapsed: el.classList.contains('rails-collapsed'), w: el.getBoundingClientRect().width };
  });
  check('collapse renders a 32px strip', c.collapsed && Math.abs(c.w - 32) < 2, JSON.stringify(c));
  await page.click('[data-node-id="s1"] .rails-expand-btn');
  const e = await page.evaluate(() => document.querySelector('[data-node-id="s1"]').getBoundingClientRect().width);
  check('expand restores it', e > 100, String(e));
}

// 7. float titlebar redock onto the top edge of s2 (vertical split above it)
{
  const tb = await rect('.rails-float .rails-titlebar');
  const r = await rect(slotSel('s2'));
  await page.mouse.move(tb.x + 40, tb.y + tb.h / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 60, tb.y + 20, { steps: 4 });
  await page.mouse.move(r.x + r.w / 2, r.y + 8, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const where = await stackOf('ft1');
  const floats = await page.evaluate(() => window.rails.state.floats.length);
  check('float redocks via a top-edge zone', where && floats === 0, `${JSON.stringify(where)} floats=${floats}  ${await shape()}`);
  await snap('rails-split-3.png');
}

// 8. Escape cancels a tab drag with no change
{
  const before = await shape();
  const r = await rect(tabSel('t1'));
  await page.mouse.move(r.x + 10, r.y + 5);
  await page.mouse.down();
  await page.mouse.move(r.x + 200, r.y + 200, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  check('Escape cancels', (await shape()) === before);
}

// 9. a saved two-level layout still loads
{
  await page.evaluate(() => {
    const t = id => ({ id, title: id, kind: 'html', html: id });
    window.rails.deserialize(JSON.stringify({
      rails: [
        { id: 'r1', flex: 1, stacks: [{ id: 'q1', flex: 1, active: 'x1', tabs: [t('x1')] }] },
        { id: 'r2', flex: 1, stacks: [{ id: 'q2', flex: 1, active: 'x2', tabs: [t('x2')] }, { id: 'q3', flex: 1, active: 'x3', tabs: [t('x3')] }] },
      ],
      floats: [],
    }));
  });
  const sh = await shape();
  check('legacy layout upgrades on deserialize', /^row\(q1,col\(q2,q3\)\)$/.test(sh), sh);
  const ok = await page.evaluate(() => ['q1', 'q2', 'q3'].every(id => document.querySelector(`.rails-slot[data-slot-for="${id}"]`).getBoundingClientRect().height > 50));
  check('upgraded layout renders', ok);
}

// 10. closing tabs tidies the tree back down
{
  await page.evaluate(() => { window.rails.closeTab('x2'); window.rails.closeTab('x3'); });
  check('closing tabs collapses splits', (await shape()) === 'q1', await shape());
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
