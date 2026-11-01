// micro REVIEW MODE smoke — the phone layout (spec_inbox/micro-mobile-spec.md),
// emulating the S24+ (384×787 CSS px, DPR 2.8, touch) on the dev tree with
// ?mobile=1, then the BUILT micro.html if present. One top bar, a bottom tool
// bar with 44 px targets, every floating thing a sheet, one sheet at a time, the
// analysis plot above its form, the section strip, the palette as a sheet.
// Screenshots land in experiments/mobile-*.png for the eye.
// Run: node test/micro-mobile-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
fs.mkdirSync(path.join(root, 'experiments'), { recursive: true });

let pass = 0, fail = 0;
const chk = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const S24 = { viewport: { width: 384, height: 787 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true };

async function drive(url, tag) {
  const ctx = await browser.newContext(S24);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && document.body.classList.contains('mobile'), null, { timeout: 30000 });
  const shot = (n) => p.screenshot({ path: path.join(root, 'experiments', `mobile-${tag}-${n}.png`) });

  // 1. chrome: one top bar, the bottom tool bar with labelled 44px targets, nothing overflows
  const chrome = await p.evaluate(() => {
    const bar = document.getElementById('barTools').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#barTools button')].map((b) => ({ id: b.id, h: b.getBoundingClientRect().height, label: (b.querySelector('.tl') || {}).textContent || '' }));
    return { barBottom: Math.round(bar.bottom), barH: Math.round(bar.height), n: btns.length, minH: Math.min(...btns.map((b) => b.h)), labels: btns.map((b) => b.label), bar2: getComputedStyle(document.getElementById('bar2')).display, overflow: document.documentElement.scrollWidth <= innerWidth, cmdVisible: getComputedStyle(document.getElementById('btnCmd')).display !== 'none' };
  });
  chk(`[${tag}] bottom tool bar: ${chrome.n} buttons (${chrome.labels.join(' · ')}), min height ${chrome.minH.toFixed(0)}px, instrument row hidden ${chrome.bar2 === 'none'}, command button ${chrome.cmdVisible}, no overflow ${chrome.overflow}`,
    chrome.n === 6 && chrome.minH >= 44 && chrome.labels.join() === 'layers,props,select,section,measure,fit' && chrome.bar2 === 'none' && chrome.overflow && chrome.cmdVisible);
  await shot('empty');

  // 2. the demo project → its grade-tonnage window is a SHEET with the plot above the form
  await p.evaluate(() => window._micro.openDemoProject());
  await p.waitForFunction(() => window._micro.layers().length >= 7 && document.querySelector('.fwin.sheet'), null, { timeout: 120000 });
  await p.waitForTimeout(2500);
  const gt = await p.evaluate(() => {
    const w = document.querySelector('.fwin.sheet'); const r = w.getBoundingClientRect();
    const main = w.querySelector('.sw-main'), rail = w.querySelector('.sw-rail');
    const mr = main && main.getBoundingClientRect(), rr = rail && rail.getBoundingClientRect();
    const cv = w.querySelector('.sw-main canvas'); const cr = cv && cv.getBoundingClientRect();
    const vr = document.getElementById('view').getBoundingClientRect();
    return { viewBottom: Math.round(vr.bottom), secOn: document.body.classList.contains('sec-on'), left: Math.round(r.left), width: Math.round(r.width), bottom: Math.round(r.bottom), top: Math.round(r.top),
      plotAbove: !!(mr && rr && mr.top < rr.top), plotW: cr ? Math.round(cr.width) : 0, plotH: cr ? Math.round(cr.height) : 0,
      layersHidden: !document.getElementById('layersPanel').classList.contains('show'), title: w.querySelector('.fwin-head .t').textContent };
  });
  // the demo opens WITH a section on → the sheet sits above the section strip (124) rather than the bar (80)
  chk(`[${tag}] "${gt.title}" opens as a sheet (x ${gt.left}, w ${gt.width}, bottom ${gt.bottom}, section on ${gt.secOn}) — plot ${gt.plotW}×${gt.plotH} above its form ${gt.plotAbove}, layers panel yielded ${gt.layersHidden}; the view yields to it (view bottom ${gt.viewBottom} vs sheet top ${gt.top})`,
    gt.left === 0 && gt.width === 384 && gt.bottom === 787 - (gt.secOn ? 124 : 80) && gt.plotAbove && gt.plotW >= 300 && gt.plotW > gt.plotH && gt.layersHidden && Math.abs(gt.viewBottom - gt.top) <= 2);
  await shot('gt');

  // 3. one sheet at a time: properties minimizes the window into a chip; layers hides properties
  const one = await p.evaluate(() => {
    const L = window._micro.layers().find((l) => l.kind === 'blocks'); window._micro.setActiveLayer(L.id); window._micro.openProps();
    const w = document.querySelector('.fwin.sheet');
    const a = { winHidden: w.style.display === 'none', chip: !!document.querySelector('#winStrip .win-chip'), props: document.getElementById('propPanel').classList.contains('show'), propsRect: document.getElementById('propPanel').getBoundingClientRect() };
    document.getElementById('btnLayersM').click();
    const b = { layers: document.getElementById('layersPanel').classList.contains('show'), props: document.getElementById('propPanel').classList.contains('show') };
    return { a: { ...a, propsLeft: Math.round(a.propsRect.left), propsW: Math.round(a.propsRect.width) }, b };
  });
  await p.waitForTimeout(300);                              // the view inset settles on the next frame
  one.b.chipAboveSheet = await p.evaluate(() => {
    const chipR = document.querySelector('#winStrip .win-chip').getBoundingClientRect(), lpR = document.getElementById('layersPanel').getBoundingClientRect();
    return Math.round(chipR.bottom) <= Math.round(lpR.top) + 1 && chipR.height > 0;
  });
  chk(`[${tag}] one sheet at a time: props → window minimized ${one.a.winHidden} (chip ${one.a.chip}), props sheet full-width ${one.a.propsW}; layers → props hidden ${!one.b.props}, layers shown ${one.b.layers}; the chip rides above the open sheet ${one.b.chipAboveSheet}`,
    one.a.winHidden && one.a.chip && one.a.props && one.a.propsLeft === 0 && one.a.propsW === 384 && one.b.layers && !one.b.props && one.b.chipAboveSheet);
  await shot('layers');

  // 3b. the handle under real touch: a cancelled pointer leaves the sheet alone; a tap steps it peek ↔ half;
  //     the desktop edge-grabs are gone
  const handle = await p.evaluate(async () => {
    window._micro.openProps();
    await new Promise((r) => setTimeout(r, 200));
    const pp = document.getElementById('propPanel'), head = pp.querySelector('.rp-head');
    const h0 = Math.round(pp.getBoundingClientRect().height);
    const hr = head.getBoundingClientRect(); const x = hr.left + hr.width * 0.5, y = hr.top + 6;
    head.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9, clientX: 0, clientY: 0, bubbles: true, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 150));
    const hCancel = Math.round(pp.getBoundingClientRect().height);
    return { h0, hCancel, grabShown: getComputedStyle(document.getElementById('ppGrab')).display !== 'none', x, y };
  });
  // a tap on the handle — as a pointer click: headless Chromium's TOUCH hit test
  // mis-targets the WebGL canvas under a fixed sheet (elementFromPoint says the
  // head, the touch says #cv); on the device the touch reaches the head, and the
  // real-touch check is experiments/drive-micro-handle-device.mjs
  await p.mouse.click(handle.x, handle.y);
  await p.waitForTimeout(250);
  const hTap = await p.evaluate(() => Math.round(document.getElementById('propPanel').getBoundingClientRect().height));
  // the sheet is shorter now, so its handle moved down — tap where it IS (tapping the old spot hits the view = a pick)
  const h2 = await p.evaluate(() => { const r = document.querySelector('#propPanel .rp-head').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + 6 }; });
  await p.mouse.click(h2.x, h2.y);
  await p.waitForTimeout(250);
  const hTap2 = await p.evaluate(() => Math.round(document.getElementById('propPanel').getBoundingClientRect().height));
  chk(`[${tag}] sheet handle: cancel leaves ${handle.h0} → ${handle.hCancel}; a tap steps ${hTap} then back ${hTap2}; desktop grab hidden ${!handle.grabShown}`,
    handle.hCancel === handle.h0 && hTap < handle.h0 && hTap2 === handle.h0 && !handle.grabShown);
  await p.evaluate(() => window._micro.closeProps && window._micro.closeProps());

  // 4. the section strip: the demo's section is on → the strip hosts the controls; the bar's
  //    section button toggles it OFF (strip gone) and ON again (strip back)
  const secState = () => p.evaluate(() => {
    const on = document.body.classList.contains('sec-on'); const strip = document.getElementById('secStrip');
    const sr = strip.getBoundingClientRect(); const pos = document.getElementById('secPos'); const pr = pos.getBoundingClientRect();
    return { on, stripVisible: getComputedStyle(strip).display === 'flex', stripBottom: Math.round(sr.bottom), inStrip: pos.parentNode === strip, sliderW: Math.round(pr.width), mode: document.getElementById('secMode').value };
  });
  if (!(await secState()).on) { await p.evaluate(() => document.getElementById('btnSection').click()); await p.waitForTimeout(400); }
  const sec = await secState();
  await shot('section');
  await p.evaluate(() => document.getElementById('btnSection').click()); await p.waitForTimeout(400);
  const off = await secState();
  await p.evaluate(() => document.getElementById('btnSection').click()); await p.waitForTimeout(400);
  const again = await secState();
  chk(`[${tag}] section strip (bottom ${sec.stripBottom}) hosts mode "${sec.mode}" + a ${sec.sliderW}px scrub slider; toggles off (strip hidden ${!off.stripVisible}, mode "${off.mode}") and back on (${again.on})`,
    sec.on && sec.stripVisible && sec.stripBottom === 787 - 80 && sec.inStrip && sec.sliderW >= 150 && !off.on && !off.stripVisible && off.mode === 'off' && again.on && again.stripVisible);
  await p.evaluate(() => document.getElementById('btnSection').click());

  // 5. the command palette as a sheet: bottom-anchored, 44px rows, nothing pre-selected
  await p.evaluate(() => document.getElementById('btnCmd').click());
  await p.waitForTimeout(300);
  const pal = await p.evaluate(() => {
    const box = document.getElementById('palBox').getBoundingClientRect();
    const items = [...document.querySelectorAll('.pal-item')];
    return { bottom: Math.round(box.bottom), width: Math.round(box.width), n: items.length, minH: Math.min(...items.map((i) => i.getBoundingClientRect().height)), sel: document.querySelectorAll('.pal-item.sel').length, inputTop: Math.round(document.getElementById('palInput').getBoundingClientRect().top) < Math.round(box.top) + 4 };
  });
  chk(`[${tag}] command sheet: bottom ${pal.bottom}, width ${pal.width}, ${pal.n} items ≥ ${pal.minH.toFixed(0)}px, pre-selected ${pal.sel}, input on top ${pal.inputTop}`,
    pal.bottom === 787 - 80 && pal.width === 384 && pal.n > 10 && pal.minH >= 44 && pal.sel === 0 && pal.inputTop);
  await shot('palette');
  await p.evaluate(() => window._micro.closePalette());

  // 6. stacking: what opens over a sheet is really on top of it (hit-tested, not z-compared)
  const stack = await p.evaluate(async () => {
    window._micro.openProps();
    await new Promise((r) => setTimeout(r, 200));
    const r = document.getElementById('propPanel').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const out = {};
    for (const id of ['help', 'pmDlg']) {
      const el = document.getElementById(id); el.classList.add('show');
      await new Promise((res) => setTimeout(res, 50));
      out[id] = el.contains(document.elementFromPoint(x, y));
      el.classList.remove('show');
    }
    return out;
  });
  chk(`[${tag}] over a sheet: help on top ${stack.help}, confirm on top ${stack.pmDlg}`, stack.help && stack.pmDlg);

  // 7. the tallest sheet fits with a section on — its handle stays below the top bar
  const tall = await p.evaluate(async () => {
    if (!document.body.classList.contains('sec-on')) document.getElementById('btnSection').click();
    await new Promise((r) => setTimeout(r, 300));
    const pp = document.getElementById('propPanel'); pp.style.setProperty('--sheet-h', '92svh');
    await new Promise((r) => setTimeout(r, 100));
    const top = Math.round(pp.getBoundingClientRect().top);
    pp.style.removeProperty('--sheet-h');
    document.getElementById('btnSection').click();
    return top;
  });
  chk(`[${tag}] tall sheet with a section on: top ${tag && tall} stays at or below the top bar (36)`, tall >= 36);

  // 8. pull-to-refresh is off (it reloads the session)
  const over = await p.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorY, getComputedStyle(document.body).overscrollBehaviorY]);
  chk(`[${tag}] overscroll-behavior: html ${over[0]}, body ${over[1]}`, over[0] === 'none' && over[1] === 'none');

  // 9. back on the analysis window: a long subtitle can't push the title or × away, and the
  //    footer leaves the form room
  const win = await p.evaluate(async () => {
    window._micro.closeProps && window._micro.closeProps();
    const chip = document.querySelector('#winStrip .win-chip'); if (chip) chip.click();
    await new Promise((r) => setTimeout(r, 300));
    const w = [...document.querySelectorAll('.fwin.sheet')].find((x) => x.style.display !== 'none');
    if (!w) return null;
    const head = w.querySelector('.fwin-head'); let sub = head.querySelector('.sub');
    if (!sub) { sub = document.createElement('span'); sub.className = 'sub'; head.querySelector('.t').after(sub); }
    sub.textContent = 'a very long subtitle '.repeat(6);
    await new Promise((r) => setTimeout(r, 50));
    const t = head.querySelector('.t').getBoundingClientRect();
    const btns = [...head.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    const rail = w.querySelector('.sw-rail').getBoundingClientRect(), foot = w.querySelector('.sw-foot').getBoundingClientRect();
    return { titleW: Math.round(t.width), right: Math.round(Math.max(...btns.map((b) => b.right))), railH: Math.round(rail.height), footH: Math.round(foot.height) };
  });
  chk(`[${tag}] window head: title ${win && win.titleW}px, buttons end at ${win && win.right} (≤ 384); footer ${win && win.footH}px of a ${win && win.railH}px form`,
    !!win && win.titleW >= 40 && win.right <= 384 && win.footH <= win.railH * 0.6);
  await shot('window');

  chk(`[${tag}] no page errors (${errs.length ? errs.slice(0, 2).join(' ; ') : 'none'})`, errs.length === 0);
  await ctx.close();
}

await drive(`http://127.0.0.1:${PORT}/tools/micro/index.html?mobile=1`, 'dev');
if (fs.existsSync(path.join(root, 'micro.html'))) await drive(`http://127.0.0.1:${PORT}/micro.html?mobile=1`, 'built');
else chk('built micro.html exists (node build.js --target=micro)', false);

await browser.close();
server.close();
console.log(`\nmicro-mobile-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
