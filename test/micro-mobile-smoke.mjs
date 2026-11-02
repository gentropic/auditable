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
    sec.on && sec.stripVisible && sec.stripBottom === 787 - 80 && sec.inStrip && sec.sliderW >= 120 && !off.on && !off.stripVisible && off.mode === 'off' && again.on && again.stripVisible);
  // 4b. ⋯ opens the second row: keep (slab/front/behind) drives the real clip, the view yields
  //     to the row, the slab steppers dim off-slab, custom shows dip dir + dip (≥16 px text)
  const secMore = await p.evaluate(async () => {
    const $ = (s) => document.querySelector(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const setMode = (v) => { $('#secMode').value = v; $('#secMode').dispatchEvent(new Event('input', { bubbles: true })); };
    setMode('ew'); await wait(100);
    const view0 = Math.round($('#view').getBoundingClientRect().bottom);
    $('#secMoreBtn').click(); await wait(200);
    const er = $('#secExtra').getBoundingClientRect(), view1 = Math.round($('#view').getBoundingClientRect().bottom);
    $('#secKeep [data-c="front"]').click(); await wait(100);
    const front = { clip: $('#secClip').value, thin: $('#secThin').disabled, lit: $('#secKeep .on')?.dataset.c };
    $('#secKeep [data-c="slab"]').click(); await wait(100);
    const slabThin = $('#secThin').disabled;
    const toggles = ['#secPlaneVis', '#secFollow', '#sec2D'].every((s) => $(s).closest('#secExtra'));
    setMode('custom'); await wait(150);
    const dd = $('#secDipDir'), dr = dd.getBoundingClientRect();
    const custom = { shown: dr.width > 0, font: parseFloat(getComputedStyle(dd).fontSize), rows: Math.round($('#secExtra').getBoundingClientRect().height) };
    setMode('ew'); $('#secMoreBtn').click(); await wait(200);
    const view2 = Math.round($('#view').getBoundingClientRect().bottom);
    return { rowH: Math.round(er.height), rowBottom: Math.round(er.bottom), strip: Math.round($('#secStrip').getBoundingClientRect().top), view0, view1, view2, front, slabThin, toggles, custom };
  });
  chk(`[${tag}] section ⋯ row: ${secMore.rowH}px sitting on the strip (${secMore.rowBottom}/${secMore.strip}), view ${secMore.view0} → ${secMore.view1} → back ${secMore.view2}; front → clip "${secMore.front.clip}" lit "${secMore.front.lit}", steppers dim ${secMore.front.thin} (slab ${!secMore.slabThin ? 'live' : 'DIM'}); plane/follow/2D moved ${secMore.toggles}; custom dip dir shown ${secMore.custom.shown} at ${secMore.custom.font}px`,
    secMore.rowH > 0 && secMore.rowH <= 56 && Math.abs(secMore.rowBottom - secMore.strip) <= 1 && secMore.view1 === secMore.view0 - secMore.rowH && secMore.view2 === secMore.view0
    && secMore.front.clip === 'front' && secMore.front.lit === 'front' && secMore.front.thin && !secMore.slabThin && secMore.toggles && secMore.custom.shown && secMore.custom.font >= 16);
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
  const bar = () => p.evaluate(() => { const b = document.getElementById('selBar'), r = b.getBoundingClientRect(); return { on: document.body.classList.contains('sel-on'), shown: getComputedStyle(b).display === 'flex', bottom: Math.round(r.bottom), text: document.getElementById('meta').textContent, mode: (document.querySelector('#selBarModes .on') || {}).dataset?.m }; });
  const mode = (m) => p.evaluate((m) => document.querySelector(`#selBarModes [data-m="${m}"]`).click(), m);
  await p.evaluate(() => document.getElementById('btnSelRect').click());
  const b0 = await bar();
  // the compass stays in the view's corner: above the bar, the strips and the minimized chips
  const cmp = await p.evaluate(() => {
    const c = document.getElementById('compass').getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect();
    const ws = document.getElementById('winStrip'), wr = ws && ws.children.length ? ws.getBoundingClientRect() : null;
    return { bottom: Math.round(c.bottom), view: Math.round(v.bottom), chips: wr ? Math.round(wr.top) : null };
  });
  chk(`[${tag}] compass clears the bottom stack: bottom ${cmp.bottom} ≤ view ${cmp.view}, chips top ${cmp.chips}`,
    cmp.bottom <= cmp.view && cmp.chips != null && cmp.bottom <= cmp.chips);
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
  // the bar's shape + through: lasso and through from the bar, a through-lasso selects, and the
  // bottom select button re-arms the LAST shape (a phone has one select button for both)
  const shapeOf = () => p.evaluate(() => ({ armed: (document.querySelector('#selBarShape .on') || {}).dataset?.k || null, through: document.getElementById('selBarThrough').classList.contains('on'), desk: document.getElementById('btnSelThrough').classList.contains('on'), lit: document.getElementById('btnSelRect').classList.contains('on') }));
  await p.evaluate(() => document.getElementById('btnSelRect').click());
  await p.evaluate(() => { document.querySelector('#selBarShape [data-k="lasso"]').click(); document.getElementById('selBarThrough').click(); });
  const sh0 = await shapeOf();
  await p.mouse.move(vr.x + vr.w * 0.30, vr.y + vr.h * 0.35); await p.mouse.down();
  for (const [fx, fy] of [[0.65, 0.30], [0.72, 0.65], [0.35, 0.70], [0.30, 0.40]]) await p.mouse.move(vr.x + vr.w * fx, vr.y + vr.h * fy, { steps: 5 });
  await p.mouse.up();
  await p.waitForFunction(() => window._micro.layers().some((L) => L._selCount > 0), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(400);
  const nLasso = await selN(), metaL = await p.evaluate(() => document.getElementById('meta').textContent);
  await p.evaluate(() => { if (document.getElementById('btnSelRect').classList.contains('on')) document.getElementById('btnSelRect').click(); document.getElementById('btnSelRect').click(); });
  const sh1 = await shapeOf();
  chk(`[${tag}] bar shapes: lasso armed ${sh0.armed}, through ${sh0.through} (desktop toggle ${sh0.desk}), select lit ${sh0.lit}; a through-lasso selected ${nLasso} ("${metaL}"); select re-arms "${sh1.armed}"`,
    sh0.armed === 'lasso' && sh0.through && sh0.desk && sh0.lit && nLasso > 0 && /selected/.test(metaL) && sh1.armed === 'lasso');
  await p.evaluate(() => { document.getElementById('selBarThrough').click(); document.getElementById('selBarClear').click(); document.querySelector('#selBarShape [data-k="rect"]').click(); document.getElementById('btnSelRect').click(); });

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

  // 20. a pick opens a CARD: content-sized, floating — the view does NOT shrink; a tap low on
  //     the screen puts it under the top bar instead; its handle grows it into the record sheet
  //     (only then does the view yield), and a tap while it's a sheet swaps in place
  await p.evaluate(async () => { document.getElementById('rpClose').click(); window._micro.toggleLayersPanel(false); window._micro.closeProps && window._micro.closeProps(); for (const w of document.querySelectorAll('.fwin')) if (w._minimize && w.style.display !== 'none') w._minimize(); document.getElementById('btnFit').click(); await new Promise((r) => setTimeout(r, 1500)); });
  const cardSt = () => p.evaluate(() => { const P = document.getElementById('recPanel'), r = P.getBoundingClientRect();
    return { show: P.classList.contains('show'), card: P.classList.contains('card'), top: P.classList.contains('card-top'), t: Math.round(r.top), h: Math.round(r.height), view: Math.round(document.getElementById('view').getBoundingClientRect().bottom), title: document.getElementById('rpTitle').textContent }; });
  const spots = await p.evaluate(() => {
    const M = window._micro, r = document.getElementById('cv').getBoundingClientRect(), o = { section: M.currentSection(), pointPx: +document.getElementById('ptPx').value }, hits = [];
    for (let y = 16; y < r.height - 16; y += 6) for (let x = 16; x < r.width - 16; x += 6) {
      if (!M.renderer.pick(x, y, M.cam, o)) continue;
      let solid = true; for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) if (!M.renderer.pick(x + dx, y + dy, M.cam, o)) solid = false;   // not a 1-px tip
      if (solid) hits.push([r.left + x, r.top + y]);
    }
    hits.sort((a, b) => a[1] - b[1]);
    const low = hits.filter(([, y]) => y > r.top + r.height * 0.62);
    return { high: hits[Math.floor(hits.length * 0.15)], high2: hits[Math.floor(hits.length * 0.05)], low: low[Math.floor(low.length / 2)], n: hits.length };
  });
  const c0 = await cardSt();
  await p.touchscreen.tap(...spots.high); await p.waitForTimeout(800); const cHigh = await cardSt();
  await p.evaluate(() => document.getElementById('rpClose').click());
  if (spots.low) { await p.touchscreen.tap(...spots.low); await p.waitForTimeout(800); }
  const cLow = await cardSt();
  const cardHandle = await p.evaluate(() => { const r = document.querySelector('#recPanel .rp-head').getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; });
  await p.touchscreen.tap(...cardHandle); await p.waitForTimeout(600); const cBig = await cardSt();
  const spot2 = await p.evaluate((was) => {                // the view shrank, the model moved: find a DIFFERENT block now
    const M = window._micro, r = document.getElementById('cv').getBoundingClientRect(), o = { section: M.currentSection(), pointPx: +document.getElementById('ptPx').value };
    for (let y = 16; y < r.height - 16; y += 6) for (let x = 16; x < r.width - 16; x += 6) {
      const h = M.renderer.pick(x, y, M.cam, o);
      if (h && h.rec !== undefined && !was.includes(`row ${h.rec.toLocaleString()}`)) return [r.left + x, r.top + y];
    }
    return null;
  }, cBig.title);
  if (spot2) { await p.touchscreen.tap(...spot2); await p.waitForTimeout(800); }
  const cSwap = await cardSt();
  await p.evaluate(() => document.getElementById('rpClose').click());
  chk(`[${tag}] pick card: high tap → card ${cHigh.card} (${cHigh.h}px, at ${cHigh.t}), view ${c0.view} → ${cHigh.view}; low tap → under the top bar ${cLow.top} (at ${cLow.t}); handle → sheet ${!cBig.card}, view yields to ${cBig.view}; a tap then swaps in place ("${cBig.title}" → "${cSwap.title}", still a sheet ${!cSwap.card})`,
    spots.n > 0 && !!spots.low && cHigh.show && cHigh.card && !cHigh.top && cHigh.view === c0.view && cHigh.h < 260
    && cLow.show && cLow.card && cLow.top && cLow.t <= 48 && cLow.view === c0.view
    && cBig.show && !cBig.card && cBig.view < c0.view - 100 && cSwap.show && !cSwap.card && cSwap.title !== cBig.title);

  // 21. no text field under 16 px (a phone zooms the page into one), the filter's highlight
  //     mirror matches it, and typing a filter takes the whole top bar
  const inputs = await p.evaluate(async () => {
    window._micro.openProps(); await new Promise((r) => setTimeout(r, 400));
    const small = [...document.querySelectorAll('input, select, textarea')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height || ['checkbox', 'radio', 'range', 'color', 'file'].includes(e.type)) return false;
      return parseFloat(getComputedStyle(e).fontSize) < 16;
    }).map((e) => e.id || e.className || e.tagName);
    document.querySelector('#propPanel .rp-close').click();
    const f = document.getElementById('filter'), w0 = Math.round(f.getBoundingClientRect().width);
    f.focus(); await new Promise((r) => setTimeout(r, 100));
    const w1 = Math.round(f.getBoundingClientRect().width), hl = getComputedStyle(document.getElementById('filterHL')).fontSize;
    f.blur(); await new Promise((r) => setTimeout(r, 200));
    return { small, w0, w1, hl, burger: getComputedStyle(document.getElementById('btnBurger')).display };
  });
  chk(`[${tag}] inputs ≥ 16 px (under: ${inputs.small.join(', ') || 'none'}), filter mirror ${inputs.hl}; focused the filter grows ${inputs.w0} → ${inputs.w1}px and gives the bar back (burger ${inputs.burger})`,
    inputs.small.length === 0 && inputs.hl === '16px' && inputs.w1 > inputs.w0 + 150 && inputs.burger !== 'none');
  // 22. Android Back closes what's on top (window → chip, a panel, a submenu then its menu,
  //     an armed tool) instead of leaving; closing by hand takes the history entry back off
  const backSt = () => p.evaluate(() => ({ state: history.state && history.state.microBack, wins: [...document.querySelectorAll('.fwin')].filter((w) => w.style.display !== 'none').length,
    props: document.getElementById('propPanel').classList.contains('show'), menus: document.querySelectorAll('body > .menu').length, sel: document.getElementById('btnSelRect').classList.contains('on') }));
  const goBack = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(400); return backSt(); };
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')][0]; if (w && w._chip) w._chip.click(); });
  await p.waitForTimeout(400);
  const bk0 = await backSt(), bkWin = await goBack();
  await p.evaluate(() => window._micro.openProps()); await p.waitForTimeout(300); const bkProps = await goBack();
  await p.evaluate(() => document.getElementById('mTools').click()); await p.waitForTimeout(250);
  await p.evaluate(() => [...document.querySelectorAll('.menu .item')].find((d) => d.querySelector('.sub')).click()); await p.waitForTimeout(250);
  const bkM2 = await backSt(), bkSub = await goBack(), bkMenu = await goBack();
  await p.evaluate(() => document.getElementById('btnSelRect').click()); await p.waitForTimeout(300); const bkSel = await goBack();
  await p.evaluate(() => window._micro.openProps()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#propPanel .rp-close').click()); await p.waitForTimeout(400);
  const bkHand = await backSt();
  chk(`[${tag}] Back: window ${bk0.wins} → ${bkWin.wins}; props → ${bkProps.props}; menus ${bkM2.menus} → ${bkSub.menus} → ${bkMenu.menus}; select → ${bkSel.sel}; closed by hand → history entry ${bkHand.state ? 'LEFT' : 'gone'}`,
    bk0.wins === 1 && bk0.state === 1 && bkWin.wins === 0 && !bkProps.props && bkM2.menus === 2 && bkSub.menus === 1 && bkMenu.menus === 0 && !bkSel.sel && !bkHand.state);

  // 23. double-tap: on the model the orbit centre glides to that spot; on empty space, fit
  // 24. measuring by finger: a tap takes A under the finger; press-slide-lift takes B under
  //     the crosshair 64 px ABOVE the finger, not under the finger
  const secWas = await p.evaluate(async () => { const m = document.getElementById('secMode'), was = m.value; m.value = 'off'; m.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('rpClose').click(); for (const w of document.querySelectorAll('.fwin')) if (w._minimize && w.style.display !== 'none') w._minimize();
    document.getElementById('btnFit').click(); await new Promise((r) => setTimeout(r, 1500)); return was; });
  const dt = await p.evaluate(() => { const M = window._micro, r = document.getElementById('cv').getBoundingClientRect(), hits = [];
    for (let y = 20; y < r.height - 20; y += 6) for (let x = 20; x < r.width - 20; x += 6) if (M.renderer.pick(x, y, M.cam, {})) hits.push([x, y]);
    hits.sort((a, c) => a[0] - c[0]);
    const cx = r.width / 2, cy = r.height / 2, far = hits.filter(([x, y]) => Math.hypot(x - cx, y - cy) > 60);
    return { r: [r.left, r.top], off: far[Math.floor(far.length * 0.3)], a: hits[Math.floor(hits.length * 0.2)], b: hits[Math.floor(hits.length * 0.8)], t0: M.cam.state.target.slice() }; });
  await p.touchscreen.tap(dt.r[0] + dt.off[0], dt.r[1] + dt.off[1]); await p.waitForTimeout(80); await p.touchscreen.tap(dt.r[0] + dt.off[0], dt.r[1] + dt.off[1]);
  await p.waitForTimeout(800);
  const piv = await p.evaluate((t0) => { const M = window._micro, t = M.cam.state.target; return { moved: Math.hypot(t[0] - t0[0], t[1] - t0[1], t[2] - t0[2]), meta: document.getElementById('meta').textContent }; }, dt.t0);
  const emptyPt = await p.evaluate(() => { const M = window._micro, r = document.getElementById('cv').getBoundingClientRect();
    for (let y = 30; y < r.height - 30; y += 8) for (let x = 20; x < r.width - 20; x += 8) if (!M.renderer.pick(x, y, M.cam, {}) && document.elementFromPoint(r.left + x, r.top + y) === document.getElementById('cv')) return [r.left + x, r.top + y]; return null; });
  if (emptyPt) { await p.touchscreen.tap(...emptyPt); await p.waitForTimeout(80); await p.touchscreen.tap(...emptyPt); await p.waitForTimeout(1200); }
  const fitBack = await p.evaluate((t0) => { const t = window._micro.cam.state.target; return Math.hypot(t[0] - t0[0], t[1] - t0[1], t[2] - t0[2]); }, dt.t0);
  chk(`[${tag}] double-tap: the orbit centre moved ${piv.moved.toFixed(0)} m to the tapped spot ("${piv.meta}"); empty space → fit (back within ${fitBack.toFixed(1)} m)`,
    piv.moved > 10 && /orbiting/.test(piv.meta) && !!emptyPt && fitBack < 1);
  await p.evaluate(() => { document.getElementById('rpClose').click(); document.getElementById('btnMeasure').click(); });
  const cdpM = await ctx.newCDPSession(p);
  const TT = (type, x, y) => cdpM.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: dt.r[0] + x, y: dt.r[1] + y }] });
  await TT('touchStart', ...dt.a); await TT('touchEnd'); await p.waitForTimeout(600);
  const mA = await p.evaluate(() => document.getElementById('meta').textContent);
  const [bx, by] = dt.b;
  await TT('touchStart', bx - 30, by + 94);
  for (let i = 1; i <= 6; i++) await TT('touchMove', bx - 30 + 5 * i, by + 94 - 5 * i);
  await p.waitForTimeout(100);
  const aimShown = await p.evaluate(() => { const s = document.getElementById('aimSvg'); return !!s && s.style.display !== 'none'; });
  await TT('touchEnd'); await p.waitForTimeout(800);
  const mB = await p.evaluate(() => ({ meta: document.getElementById('meta').textContent, B: [+document.getElementById('mB').getAttribute('cx'), +document.getElementById('mB').getAttribute('cy')], aimGone: document.getElementById('aimSvg').style.display === 'none' }));
  chk(`[${tag}] measure by finger: tap → "${mA}"; the crosshair showed ${aimShown}; B at ${mB.B.map(Math.round)} for a crosshair at ${bx},${by} (the finger was 64 px lower) → "${mB.meta}"`,
    /second point/.test(mA) && aimShown && Math.hypot(mB.B[0] - bx, mB.B[1] - by) < 3 && /measure: [\d.]+ m/.test(mB.meta) && mB.aimGone);
  await p.evaluate((was) => { const m = document.getElementById('secMode'); m.value = was; m.dispatchEvent(new Event('input', { bubbles: true })); }, secWas);
  await p.keyboard.press('Escape');

  // 25. the expression strip: a focused filter gets keys + the completer's chips (not the
  //     floating popup); real taps build `COL > ` then a category value without losing focus;
  //     the ƒ editor gets it too; blurring takes it away
  const xs = () => p.evaluate(() => { const s = document.getElementById('exprStrip'), r = s.getBoundingClientRect(), f = document.activeElement;
    return { shown: getComputedStyle(s).display !== 'none', bottom: Math.round(r.bottom), vh: innerHeight, val: f && f.value, focus: f && (f.id || f.tagName), ac: document.getElementById('acPopup').classList.contains('show'),
      kinds: [...new Set([...s.querySelectorAll('.xs-sugg button')].map((b) => b.className))], keys: s.querySelectorAll('.xs-keys button').length }; });
  await p.evaluate(() => { const M = window._micro; M.setActiveLayer(M.layers().find((l) => l.kind === 'blocks').id); const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); });
  await p.tap('#filter'); await p.waitForTimeout(200);
  const xs0 = await xs();
  const firstCol = await p.evaluate(() => document.querySelector('#exprStrip .xs-sugg button.k-column').textContent);
  await p.tap('#exprStrip .xs-sugg button.k-column'); await p.waitForTimeout(80);
  const xs1 = await xs();
  await p.tap('#exprStrip .xs-keys button[data-k=">"]'); await p.waitForTimeout(80);
  const xs2 = await xs();
  const catCol = await p.evaluate(() => { const h = window._micro.blockDoc().header; return h.columns[h.mapping.cat]; });
  await p.evaluate(() => { const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); });
  await p.keyboard.type(catCol); await p.tap('#exprStrip .xs-keys button[data-k="="]'); await p.waitForTimeout(80);
  const xs3 = await xs();
  await p.tap('#exprStrip .xs-sugg button.k-value'); await p.waitForTimeout(80);
  const xs4 = await xs();
  await p.evaluate(() => { const f = document.getElementById('filter'); f.value = ''; f.dispatchEvent(new Event('input')); f.blur(); });
  await p.waitForTimeout(100);
  const xs5 = await xs();
  chk(`[${tag}] expression strip on the filter: ${xs0.keys} keys + ${xs0.kinds.join(' ')} (popup ${xs0.ac}), flush at the bottom ${xs0.bottom}/${xs0.vh}; taps → "${xs1.val}" → "${xs2.val}" (focus ${xs2.focus}); "${xs3.val}" offers ${xs3.kinds.join(' ')} → "${xs4.val}"; blurred → shown ${xs5.shown}`,
    xs0.shown && !xs0.ac && xs0.keys >= 10 && xs0.kinds.includes('k-column') && xs0.bottom === xs0.vh
    && xs1.val === firstCol + ' ' && xs1.kinds.includes('k-operator') && xs2.val === firstCol + ' > ' && xs2.focus === 'filter'
    && xs3.val === catCol + ' = ' && xs3.kinds.join() === 'k-value' && new RegExp(`^${catCol} = ".+" $`).test(xs4.val) && !xs5.shown);
  await p.evaluate(() => { const M = window._micro; M.openCalcWindow(M.layers().find((L) => L.id === M.activeId())); });
  await p.waitForTimeout(400);
  await p.tap('.cw-edwrap textarea'); await p.waitForTimeout(150);
  await p.tap('#exprStrip .xs-keys button[data-k="("]'); await p.tap('#exprStrip .xs-sugg button.k-column'); await p.tap('#exprStrip .xs-keys button[data-k="+"]');
  const xsCalc = await xs();
  chk(`[${tag}] … and on the ƒ editor: "${xsCalc.val}" (focus ${xsCalc.focus})`, xsCalc.shown && /^\(\w+ \+ $/.test(xsCalc.val) && xsCalc.focus === 'TEXTAREA');
  await p.evaluate(() => { document.activeElement.blur(); for (const w of document.querySelectorAll('.fwin')) if (w._minimize && w.style.display !== 'none') w._minimize(); });

  // 26. the magnifier: hold still on the model → a loupe above the finger; slide (the view
  //     holds still), lift → that record's card; the hint goes with the loupe
  const mg = await p.evaluate(async () => { const M = window._micro, m = document.getElementById('secMode'), was = m.value; m.value = 'off'; m.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('rpClose').click(); document.getElementById('btnFit').click(); await new Promise((r) => setTimeout(r, 1500));
    const r = document.getElementById('cv').getBoundingClientRect(), hits = [];
    for (let y = 20; y < r.height - 20; y += 6) for (let x = 20; x < r.width - 20; x += 6) if (M.renderer.pick(x, y, M.cam, {})) hits.push([x, y]);
    hits.sort((a, c) => a[1] - c[1]); return { was, r: [r.left, r.top], a: hits[Math.floor(hits.length * 0.6)], t0: M.cam.state.theta, p0: M.cam.state.phi }; });
  const LT = (type, x, y) => cdpM.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: mg.r[0] + x, y: mg.r[1] + y }] });
  await LT('touchStart', mg.a[0] - 20, mg.a[1] - 10); await p.waitForTimeout(500);
  const lHeld = await p.evaluate(() => { const l = document.getElementById('loupe'); const r = l && l.getBoundingClientRect(); return { shown: !!l && l.style.display === 'block', bottom: r && r.bottom }; });
  for (let i = 1; i <= 5; i++) await LT('touchMove', mg.a[0] - 20 + 4 * i, mg.a[1] - 10 + 2 * i);
  await p.waitForTimeout(150); await LT('touchEnd'); await p.waitForTimeout(800);
  const lUp = await p.evaluate((t) => ({ loupe: (document.getElementById('loupe') || { style: {} }).style.display, card: document.getElementById('recPanel').classList.contains('show') && document.getElementById('recPanel').classList.contains('card'),
    turned: Math.abs(window._micro.cam.state.theta - t.t0) + Math.abs(window._micro.cam.state.phi - t.p0), meta: document.getElementById('meta').textContent }), mg);
  chk(`[${tag}] magnifier: held → loupe ${lHeld.shown} (its bottom ${Math.round(lHeld.bottom)} above the finger ${Math.round(mg.r[1] + mg.a[1] - 10)}); slid + lifted → card ${lUp.card}, view turned ${lUp.turned.toFixed(4)}, loupe ${lUp.loupe}, hint gone ${!/^magnifier/.test(lUp.meta)}`,
    lHeld.shown && lHeld.bottom < mg.r[1] + mg.a[1] - 10 && lUp.card && lUp.turned === 0 && lUp.loupe === 'none' && !/^magnifier/.test(lUp.meta));
  await p.evaluate((was) => { document.getElementById('rpClose').click(); const m = document.getElementById('secMode'); m.value = was; m.dispatchEvent(new Event('input', { bubbles: true })); }, mg.was);

  // 27. swath by touch: a sideways drag across the plot holds a band range and offers to select
  //     it (the plot leaves vertical swipes to the sheet: pan-y); reorder grips take their drag
  await p.evaluate(() => { const M = window._micro; M.openSwath(M.layers().find((l) => l.kind === 'blocks')); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((x) => x.style.display !== 'none'); const run = w && w.querySelector('.sw-run'); if (run && !/ bands · /.test(w.querySelector('.fwin-head').textContent)) run.click(); });
  await p.waitForFunction(() => { const w = [...document.querySelectorAll('.fwin')].find((x) => x.style.display !== 'none'); const h = w && w.querySelector('.fwin-head').textContent; return h && / bands · /.test(h) && !/scanning/.test(h); }, null, { timeout: 90000 });
  const pc = await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((x) => x.style.display !== 'none'), c = w.querySelector('.sw-main canvas') || w.querySelector('canvas'), r = c.getBoundingClientRect(); return { r: [r.left, r.top, r.width, r.height], ta: getComputedStyle(c).touchAction }; });
  const sy = pc.r[1] + pc.r[3] * 0.5, sx = pc.r[0] + pc.r[2] * 0.3;
  const ST = (type, x, y) => cdpM.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await ST('touchStart', sx, sy); for (let i = 1; i <= 10; i++) await ST('touchMove', sx + i * 10, sy); await ST('touchEnd'); await p.waitForTimeout(400);
  const swMenu = await p.evaluate(() => [...document.querySelectorAll('body > .menu .item')].map((d) => d.textContent));
  const grips = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'pp-rule'; const g = document.createElement('span'); g.className = 'grip'; d.appendChild(g); document.body.appendChild(d); const ta = getComputedStyle(g).touchAction, w = g.getBoundingClientRect().width; d.remove(); return { ta, w }; });
  chk(`[${tag}] swath by touch: plot ${pc.ta}; a sideways drag → "${swMenu[0] || 'no menu'}"; grips ${grips.ta}, ${Math.round(grips.w)} px wide`,
    pc.ta === 'pan-y' && /^Select rows in/.test(swMenu[0] || '') && grips.ta === 'none' && grips.w >= 28);
  await p.keyboard.press('Escape'); await p.evaluate(() => { for (const m of document.querySelectorAll('body > .menu')) m.remove(); for (const w of document.querySelectorAll('.fwin')) if (w._minimize && w.style.display !== 'none') w._minimize(); });

  // 28. Help on a phone leads with touch
  await p.evaluate(() => document.getElementById('mHelp').click()); await p.waitForTimeout(200);
  const helpFirst = await p.evaluate(() => { const it = document.querySelector('body > .menu .item'); const t = it && it.textContent; if (it) it.click(); return t; });
  await p.waitForTimeout(200);
  const helpShown = await p.evaluate(() => ({ title: document.getElementById('helpTitle').textContent, magnifier: /magnifier/.test(document.getElementById('helpBody').textContent), card: [...document.querySelectorAll('body > .menu .item')].some((d) => /Shortcut card/.test(d.textContent)) }));
  await p.evaluate(() => document.getElementById('helpClose').click());
  chk(`[${tag}] Help leads with "${helpFirst}" → "${helpShown.title}" (mentions the magnifier ${helpShown.magnifier})`, /^Touch/.test(helpFirst || '') && helpShown.title === 'touch' && helpShown.magnifier);

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
  const homes = await p.evaluate(() => ['secMode', 'secPos', 'secDipDir', 'secDip', 'secPlaneW', 'secFollowW', 'sec2DW'].filter((id) => document.getElementById(id).closest('#secStrip, #secExtra')));
  chk(`[${tag}] → desktop: the section controls went home (${homes.length ? 'still on the phone: ' + homes.join(', ') : 'all'})`, homes.length === 0);
  await p.setViewportSize({ width: 384, height: 787 }); await p.waitForTimeout(500);
  const phone = await p.evaluate(() => ({ mobile: document.body.classList.contains('mobile'),
    visible: [...document.querySelectorAll('.fwin')].filter((w) => w.style.display !== 'none').length, sheets: document.querySelectorAll('.fwin.sheet').length, n: document.querySelectorAll('.fwin').length }));
  const placed = desk.wins.length > 0 && desk.wins.every((w) => !w.sheet && w.x > 0 && w.y >= 28 && w.w >= 300 && w.w < 1280);
  chk(`[${tag}] phone → desktop: ${desk.wins.length} windows placed ${JSON.stringify(desk.wins)}; → phone: ${phone.visible} visible of ${phone.n}, all sheets ${phone.sheets === phone.n}`,
    !desk.mobile && placed && phone.mobile && phone.visible === 1 && phone.sheets === phone.n);
  await ctx.close();
}

// a phone held sideways (wide but short, a coarse pointer — no ?mobile=1, the media query
// decides): the tool bar is a left rail, a sheet docks RIGHT at full height and the view
// gives up width, not height; a swipe right closes it; rotating back restores the portrait shape
async function landscape(url, tag) {
  const ctx = await browser.newContext({ ...S24, viewport: { width: S24.viewport.height, height: S24.viewport.width } });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && document.body.classList.contains('mobile'), null, { timeout: 30000 });
  await p.evaluate(() => window._micro.openDemoProject());
  await p.waitForFunction(() => window._micro.layers().length >= 7 && document.querySelector('.fwin.sheet'), null, { timeout: 120000 });
  await p.waitForTimeout(600);
  const geo = () => p.evaluate(() => { const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
    return { land: document.body.classList.contains('land'), view: R(document.getElementById('view')), sheet: R([...document.querySelectorAll('.fwin')].find((x) => x.style.display !== 'none')), rail: R(document.getElementById('barTools')) }; });
  const g1 = await geo();
  const hd = await p.evaluate(() => { const w = [...document.querySelectorAll('.fwin')].find((x) => x.style.display !== 'none'), r = w.querySelector('.fwin-head').getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]; });
  const cdp = await ctx.newCDPSession(p);
  const T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await T('touchStart', ...hd); for (let i = 1; i <= 8; i++) await T('touchMove', hd[0] + i * 15, hd[1]); await T('touchEnd'); await p.waitForTimeout(500);
  const g2 = await geo();
  await p.setViewportSize(S24.viewport); await p.waitForTimeout(600);
  const g3 = await geo();
  chk(`[${tag}] sideways: rail ${JSON.stringify(g1.rail)}, sheet ${JSON.stringify(g1.sheet)}, view ${JSON.stringify(g1.view)} (${g1.view.b - g1.view.t} px tall); swipe right → sheet ${g2.sheet ? 'still up' : 'closed'}, view to ${g2.view.r}; upright → land ${g3.land}, rail ${JSON.stringify(g3.rail)}`,
    g1.land && g1.rail.r <= 64 && g1.rail.t === 36 && g1.sheet && g1.sheet.t === 36 && Math.abs(g1.sheet.r - S24.viewport.height) <= 1 && Math.abs(g1.view.r - g1.sheet.l) <= 1 && g1.view.l === g1.rail.r && g1.view.b - g1.view.t > 240
    && !g2.sheet && Math.abs(g2.view.r - S24.viewport.height) <= 1 && !g3.land && g3.rail.l === 0 && g3.rail.r === S24.viewport.width);
  await ctx.close();
}

await modeSwitch(`http://127.0.0.1:${PORT}/tools/micro/index.html`, 'dev');
await landscape(`http://127.0.0.1:${PORT}/tools/micro/index.html`, 'dev');
await drive(`http://127.0.0.1:${PORT}/tools/micro/index.html?mobile=1`, 'dev');
if (fs.existsSync(path.join(root, 'micro.html'))) await drive(`http://127.0.0.1:${PORT}/micro.html?mobile=1`, 'built');
else chk('built micro.html exists (node build.js --target=micro)', false);

await browser.close();
server.close();
console.log(`\nmicro-mobile-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
