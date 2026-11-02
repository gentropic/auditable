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

  // 10. a minimized window re-opened by its opener (the palette's path) comes back as THE sheet
  const reopen = await p.evaluate(async () => {
    const w = [...document.querySelectorAll('.fwin.sheet')].find((x) => x.style.display !== 'none');
    w._minimize();
    const L = window._micro.layers().find((l) => l.kind === 'blocks');
    window._micro.openGradeTonnage(L);
    await new Promise((r) => setTimeout(r, 300));
    return { shown: w.style.display !== 'none', chip: !!w._chip, visible: [...document.querySelectorAll('.fwin')].filter((x) => x.style.display !== 'none').length };
  });
  chk(`[${tag}] re-open a minimized window: shown ${reopen.shown}, chip gone ${!reopen.chip}, sheets visible ${reopen.visible}`, reopen.shown && !reopen.chip && reopen.visible === 1);

  // 11. the layers sheet: an automatic re-render never pushes the open window aside, and an explicit close sticks
  const lp = await p.evaluate(async () => {
    const M = window._micro, L = M.layers().find((l) => l.kind === 'blocks');
    M.setActiveLayer(L.id); M.renderLayers();
    await new Promise((r) => setTimeout(r, 100));
    const winKept = [...document.querySelectorAll('.fwin')].some((x) => x.style.display !== 'none');
    document.getElementById('btnLayersM').click();
    await new Promise((r) => setTimeout(r, 100));
    const opened = document.getElementById('layersPanel').classList.contains('show');
    document.getElementById('lpClose').click();
    M.setActiveLayer(L.id); M.renderLayers();
    await new Promise((r) => setTimeout(r, 100));
    return { winKept, opened, stayedClosed: !document.getElementById('layersPanel').classList.contains('show') };
  });
  chk(`[${tag}] layers sheet: a re-render left the window ${lp.winKept ? 'open' : 'MINIMIZED'}; opened ${lp.opened}, × then re-render → stays closed ${lp.stayedClosed}`, lp.winKept && lp.opened && lp.stayedClosed);

  // 12. a TAP on a submenu parent opens its submenu — it does not run the item that lands under the finger
  const bb = await p.evaluate(() => { const r = document.getElementById('btnBurger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(bb.x, bb.y); await p.waitForTimeout(300);
  const tools = await p.evaluate(() => { const it = [...document.querySelectorAll('.menu .item')].find((d) => d.textContent.trim() === 'Tools'); if (!it) return null; const r = it.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (tools) { await p.touchscreen.tap(tools.x, tools.y); await p.waitForTimeout(300); }
  const parent = await p.evaluate(() => {
    const it = [...document.querySelectorAll('.menu .item')].find((d) => d.querySelector('.sub'));
    if (!it) return null; const r = it.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: it.textContent };
  });
  if (parent) { await p.touchscreen.tap(parent.x, parent.y); await p.waitForTimeout(300); }
  const menus = await p.evaluate(() => document.querySelectorAll('.menu').length);
  chk(`[${tag}] tap "${parent && parent.label}": ${menus} menus open (the root + its submenu, nothing run)`, !!parent && menus === 2);
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  // dismiss without clicking anything (a click at a fixed spot landed on a menu item — it armed measure)
  await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await p.waitForTimeout(150);
  const { menusLeft, meas } = await p.evaluate(() => ({ menusLeft: document.querySelectorAll('.menu').length, meas: document.getElementById('btnMeasure').classList.contains('on') }));
  chk(`[${tag}] menus dismissed by an outside press (${menusLeft} left), measure armed ${meas}`, menusLeft === 0 && !meas);

  // 13. a section set by the host API (no input event) still brings up the strip
  const api = await p.evaluate(async () => {
    document.getElementById('secMode').value = 'off'; document.getElementById('secMode').dispatchEvent(new Event('input'));
    const M = window._micro; const s0 = document.body.classList.contains('sec-on');
    if (M.applySection) M.applySection({ mode: 'knife', knifeN: [0.6, 0.8, 0], pos: 0.5, half: 10 });
    return { s0, s1: document.body.classList.contains('sec-on'), has: !!M.applySection };
  });
  chk(`[${tag}] a knife section applied without an input event: strip on ${api.s1} (was ${api.s0})`, api.has && !api.s0 && api.s1);
  await p.evaluate(() => { document.getElementById('secMode').value = 'off'; document.getElementById('secMode').dispatchEvent(new Event('input')); });

  // 16. undo by touch: a filter enables ↶, a real tap on it puts the filter back, and ↶ goes idle again
  const before = await p.evaluate(async () => {
    const M = window._micro, L = M.layers().find((l) => l.kind === 'blocks'); M.setActiveLayer(L.id);
    const c = M.numericColsOf(L)[0], name = typeof c === 'string' ? c : (c && c.name);
    const b = document.getElementById('btnUndo');
    if (!b) return { shown: false };
    const idle = b.disabled, shown = getComputedStyle(b).display !== 'none';
    const f = document.getElementById('filter'); f.value = `${name} > -1e30`;
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const ub = b.getBoundingClientRect();
    return { name, idle, shown, armed: !b.disabled, title: b.title, filtered: L.filterExpr, x: ub.left + ub.width / 2, y: ub.top + ub.height / 2, h: Math.round(ub.height) };
  });
  if (before.shown) { await p.touchscreen.tap(before.x, before.y); await p.waitForTimeout(800); }
  const after = await p.evaluate(() => { const L = window._micro.layers().find((l) => l.kind === 'blocks'), b = document.getElementById('btnUndo'); return { filter: L.filterExpr || '', idle: !!b && b.disabled, meta: document.getElementById('meta').textContent }; });
  chk(`[${tag}] ↶ shown ${before.shown} (${before.h}px), idle ${before.idle} → after a filter armed ${before.armed} ("${before.title}") → tapped: filter "${after.filter}", idle ${after.idle}, "${after.meta}"`,
    before.shown && before.armed && !!before.filtered && after.filter === '' && after.idle && /undone: filter/.test(after.meta));

  // 17. the selection bar: new · add · remove by touch (no shift / alt on a phone),
  //     undo AND redo of a selection step, selection → column, clear
  await p.evaluate(async () => { window._micro.closeProps && window._micro.closeProps(); for (const w of document.querySelectorAll('.fwin')) if (w.style.display !== 'none' && w._minimize) w._minimize(); document.getElementById('btnFit').click(); await new Promise((r) => setTimeout(r, 1200)); });
  const vr = await p.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const drag = async (fx0, fy0, fx1, fy1) => {
    await p.mouse.move(vr.x + vr.w * fx0, vr.y + vr.h * fy0); await p.mouse.down();
    await p.mouse.move(vr.x + vr.w * fx1, vr.y + vr.h * fy1, { steps: 6 }); await p.mouse.up();
    await p.waitForTimeout(700);
  };
  const selN = () => p.evaluate(() => window._micro.layers().reduce((a, L) => a + (L._selCount || 0), 0));
  const bar = () => p.evaluate(() => { const b = document.getElementById('selBar'), r = b.getBoundingClientRect(); return { on: document.body.classList.contains('sel-on'), shown: getComputedStyle(b).display === 'flex', bottom: Math.round(r.bottom), text: document.getElementById('selBarCount').textContent, mode: (document.querySelector('#selBarModes .on') || {}).dataset?.m }; });
  const mode = (m) => p.evaluate((m) => document.querySelector(`#selBarModes [data-m="${m}"]`).click(), m);
  await p.evaluate(() => document.getElementById('btnSelRect').click());
  const b0 = await bar();
  await drag(0.30, 0.30, 0.55, 0.55); const nA = await selN();
  await mode('add'); await drag(0.50, 0.45, 0.75, 0.75); const nB = await selN();
  await mode('subtract'); await drag(0.30, 0.30, 0.55, 0.55); const nC = await selN();
  const b1 = await bar();
  await p.evaluate(() => document.getElementById('btnUndo').click()); await p.waitForTimeout(400); const nU = await selN();
  await p.evaluate(() => document.getElementById('btnRedo').click()); await p.waitForTimeout(400); const nR = await selN();
  const redoIdle = await p.evaluate(() => document.getElementById('btnRedo').disabled);
  chk(`[${tag}] selection bar: armed → shown ${b0.shown} (bottom ${b0.bottom}, "${b0.text}"); new ${nA} → + add ${nB} → − remove ${nC} ("${b1.text}", mode ${b1.mode}); ↶ ${nU} ↷ ${nR}, redo idle after ${redoIdle}`,
    b0.on && b0.shown && b0.bottom === 787 - 80 && nA > 0 && nB > nA && nC < nB && nC > 0 && b1.mode === 'subtract' && nU === nB && nR === nC && redoIdle);
  // → column: the prompt, a name, a 0/1 column on the layer the bar names
  await p.evaluate(() => document.getElementById('selBarCol').click()); await p.waitForTimeout(300);
  await p.evaluate(() => { const i = document.getElementById('pmInput'); i.value = 'PHONESEL'; document.getElementById('pmOk').click(); });
  await p.waitForTimeout(400);
  const col = await p.evaluate(() => window._micro.layers().some((L) => (L.paintCols || []).some((c) => c.name === 'PHONESEL')));
  await p.evaluate(() => document.getElementById('selBarClear').click()); await p.waitForTimeout(200);
  const b2 = await bar(), nZ = await selN();
  await p.evaluate(() => document.getElementById('btnSelRect').click()); await p.waitForTimeout(200);
  const b3 = await bar();
  // paint strokes undo AND redo through the same buttons
  const pr = await p.evaluate(async () => {
    const M = window._micro, L = M.layers().find((q) => (q.paintCols || []).some((c) => c.name === 'PHONESEL'));
    M.setActiveLayer(L.id);
    const col = M.paintColByName(L, 'PHONESEL'), code = col.dict.length - 1, recs = [];
    for (let r = 0; r < col.codes.length && recs.length < 50; r++) if (col.codes[r] !== code) recs.push(r);
    const before = recs.map((r) => col.codes[r]).join();
    M.paintApply(L, col, recs, code);
    const painted = recs.every((r) => col.codes[r] === code);
    document.getElementById('btnUndo').click(); await new Promise((q) => setTimeout(q, 100));
    const undone = recs.map((r) => col.codes[r]).join() === before;
    document.getElementById('btnRedo').click(); await new Promise((q) => setTimeout(q, 100));
    const redone = recs.every((r) => col.codes[r] === code);
    return { n: recs.length, painted, undone, redone };
  });
  chk(`[${tag}] paint stroke of ${pr.n}: painted ${pr.painted} → ↶ restored ${pr.undone} → ↷ repainted ${pr.redone}`, pr.n > 0 && pr.painted && pr.undone && pr.redone);
  chk(`[${tag}] selection bar: → column made PHONESEL ${col}; × cleared (${nZ}, "${b2.text}"); tool off → bar gone ${!b3.on}`, col && nZ === 0 && b2.on && !b3.on);
  await mode('replace');                                   // (re-arms the tool — by design) …
  await p.evaluate(() => { if (document.getElementById('btnSelRect').classList.contains('on')) document.getElementById('btnSelRect').click(); });   // … so put it down again

  // 18. long-press on a layer row opens ITS menu — one menu, and lifting the finger
  //     neither activates the row nor runs a menu item; ⋯ opens the same menu by tap;
  //     a short tap still activates
  const cdp = await p.context().newCDPSession(p);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const rowsInfo = await p.evaluate(async () => {
    const lp = document.getElementById('layersPanel');
    if (!lp.classList.contains('show')) document.getElementById('btnLayersM').click();
    await new Promise((r) => setTimeout(r, 300));
    const M = window._micro, act = M.activeId();
    const rows = [...lp.querySelectorAll('.lp-row:not(.lp-group):not(.lp-info)')].map((r) => { const b = r.getBoundingClientRect(); return { x: b.left + b.width * 0.45, y: b.top + b.height / 2, name: r.querySelector('.lp-name').textContent, h: b.height }; }).filter((r) => r.h > 0);
    return { act, rows };
  });
  const tgt = rowsInfo.rows.find((r) => r.name !== (rowsInfo.rows[0] && rowsInfo.rows[0].name)) || rowsInfo.rows[0];
  const activeName = () => p.evaluate(() => { const M = window._micro, L = M.layers().find((l) => l.id === M.activeId()); return L ? (L.label || L.name) : null; });
  const a0 = await activeName();
  await touch('touchStart', tgt.x, tgt.y); await p.waitForTimeout(750); await touch('touchEnd', tgt.x, tgt.y); await p.waitForTimeout(400);
  const lpres = await p.evaluate(() => ({ menus: document.querySelectorAll('.menu').length, items: [...document.querySelectorAll('.menu .item')].length }));
  const a1 = await activeName();
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await p.evaluate(() => { for (const m of document.querySelectorAll('.menu')) m.remove(); });
  const more = await p.evaluate(() => { const b = [...document.querySelectorAll('#layersPanel .row-more')].find((x) => x.getBoundingClientRect().height > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width) }; });
  if (more) { await p.touchscreen.tap(more.x, more.y); await p.waitForTimeout(300); }
  const moreMenus = await p.evaluate(() => document.querySelectorAll('.menu').length);
  await p.evaluate(() => { for (const m of document.querySelectorAll('.menu')) m.remove(); });
  await p.waitForTimeout(500);
  await p.touchscreen.tap(tgt.x, tgt.y); await p.waitForTimeout(300);
  const a2 = await activeName();
  chk(`[${tag}] long-press "${tgt.name}": ${lpres.menus} menu (${lpres.items} items), active stayed "${a1}" (was "${a0}"); ⋯ (${more && more.w}px) → ${moreMenus} menu; a short tap activates → "${a2}"`,
    lpres.menus === 1 && lpres.items > 3 && a1 === a0 && !!more && moreMenus === 1 && a2 === tgt.name);
  await cdp.detach();

  // 19. a finger near an edge: the exact pixel misses, the disc around it doesn't —
  //     a touch tap there opens a record; a MOUSE click there still picks nothing
  const edge = await p.evaluate(async () => {
    const M = window._micro;
    M.toggleLayersPanel(false);
    for (const w of document.querySelectorAll('.fwin')) if (w.style.display !== 'none' && w._minimize) w._minimize();
    document.getElementById('recPanel').classList.remove('show');
    await new Promise((r) => setTimeout(r, 600));
    const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
    let hits = 0;
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const y = Math.round(r.height * fy), row = [];
      for (let x = 20; x < r.width - 20; x += 2) { const h = !!M.renderer.pick(x, y, M.cam, {}); row.push([x, h]); if (h) hits++; }
      for (let i = 0; i < row.length; i++) {               // a miss 8–10 px from the nearest hit, either side
        if (row[i][1]) continue;
        const x = row[i][0];
        const near = row.filter(([x2, h]) => h && Math.abs(x2 - x) <= 10);
        const tooNear = row.some(([x2, h]) => h && Math.abs(x2 - x) < 8);
        if (near.length && !tooNear) return { x: r.left + x, y: r.top + y, from: near[0][0], miss: x, pickAt: !!M.renderer.pick(x, y, M.cam, {}) };
      }
    }
    return { none: true, hits };
  });
  let touchRec = false, mouseRec = true;
  if (edge && !edge.none) {
    await p.touchscreen.tap(edge.x, edge.y); await p.waitForTimeout(600);
    touchRec =await p.evaluate(() => document.getElementById('recPanel').classList.contains('show'));
    await p.evaluate(() => document.getElementById('recPanel').classList.remove('show'));
    await p.mouse.click(edge.x, edge.y); await p.waitForTimeout(600);
    mouseRec = await p.evaluate(() => document.getElementById('recPanel').classList.contains('show'));
  }
  chk(`[${tag}] near-edge tap (${edge && (edge.none ? `no edge found, ${edge.hits} hits` : Math.abs(edge.miss - edge.from))}px off the model, exact pixel ${edge && edge.pickAt ? 'hits' : 'misses'}): touch opens a record ${touchRec}, mouse picks nothing ${!mouseRec}`, !!edge && !edge.none && !edge.pickAt && touchRec && !mouseRec);

  // 14. the phone's pixel-ratio cap: the canvas backs at ≤ 2 device px per CSS px, and a
  //     pick through the capped buffer still lands on the model
  const dpr = await p.evaluate(async () => {
    const M = window._micro, cv = document.getElementById('cv');
    document.getElementById('btnFit').click();
    await new Promise((r) => setTimeout(r, 1500));
    const r = cv.getBoundingClientRect();
    let hit = null;
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.5], [0.55, 0.5], [0.5, 0.45], [0.5, 0.55]]) { hit = M.renderer.pick(r.width * fx, r.height * fy, M.cam, {}); if (hit) break; }
    return { ratio: +(cv.width / cv.clientWidth).toFixed(3), device: devicePixelRatio, hit: !!hit };
  });
  chk(`[${tag}] pixel ratio capped: canvas ${dpr.ratio} per CSS px (device ${dpr.device}); a pick lands ${dpr.hit}`, dpr.ratio <= 2.001 && dpr.device > 2 && dpr.hit);

  // 15. the GPU context lost: preventDefault'd (restorable) and the user is TOLD, with save + reload
  const lost = await p.evaluate(async () => {
    const ext = document.getElementById('cv').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!ext) return null;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const bar = document.getElementById('glLost');
    return bar ? { buttons: [...bar.querySelectorAll('button')].map((b) => b.textContent), onTop: bar.contains(document.elementFromPoint(bar.getBoundingClientRect().left + 20, bar.getBoundingClientRect().top + 10)) } : { buttons: [] };
  });
  chk(`[${tag}] context lost → banner ${lost && lost.buttons.join(' · ')}, on top ${lost && lost.onTop}`, !!lost && lost.buttons.join() === 'save project,reload' && lost.onTop);

  chk(`[${tag}] no page errors (${errs.length ? errs.slice(0, 2).join(' ; ') : 'none'})`, errs.length === 0);
  await ctx.close();
}

// the layout switching under open windows: a real narrow viewport (no ?mobile=1, the
// media query decides), widened to desktop and back
async function modeSwitch(url, tag) {
  const ctx = await browser.newContext(S24);
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && document.body.classList.contains('mobile'), null, { timeout: 30000 });
  await p.evaluate(() => window._micro.openDemoProject());
  await p.waitForFunction(() => window._micro.layers().length >= 7 && document.querySelector('.fwin.sheet'), null, { timeout: 120000 });
  await p.evaluate(() => { const L = window._micro.layers().find((l) => l.kind === 'blocks'); window._micro.openStats(L); });
  await p.waitForTimeout(500);
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(500);
  const desk = await p.evaluate(() => ({ mobile: document.body.classList.contains('mobile'),
    wins: [...document.querySelectorAll('.fwin')].filter((w) => w.style.display !== 'none').map((w) => { const r = w.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), sheet: w.classList.contains('sheet') }; }) }));
  await p.setViewportSize({ width: 384, height: 787 }); await p.waitForTimeout(500);
  const phone = await p.evaluate(() => ({ mobile: document.body.classList.contains('mobile'),
    visible: [...document.querySelectorAll('.fwin')].filter((w) => w.style.display !== 'none').length, sheets: document.querySelectorAll('.fwin.sheet').length, n: document.querySelectorAll('.fwin').length }));
  const placed = desk.wins.length > 0 && desk.wins.every((w) => !w.sheet && w.x > 0 && w.y >= 28 && w.w >= 300 && w.w < 1280);
  chk(`[${tag}] phone → desktop: ${desk.wins.length} windows placed ${JSON.stringify(desk.wins)}; → phone: ${phone.visible} visible of ${phone.n}, all sheets ${phone.sheets === phone.n}`,
    !desk.mobile && placed && phone.mobile && phone.visible === 1 && phone.sheets === phone.n);
  await ctx.close();
}

await modeSwitch(`http://127.0.0.1:${PORT}/tools/micro/index.html`, 'dev');
await drive(`http://127.0.0.1:${PORT}/tools/micro/index.html?mobile=1`, 'dev');
if (fs.existsSync(path.join(root, 'micro.html'))) await drive(`http://127.0.0.1:${PORT}/micro.html?mobile=1`, 'built');
else chk('built micro.html exists (node build.js --target=micro)', false);

await browser.close();
server.close();
console.log(`\nmicro-mobile-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
