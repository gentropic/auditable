// @gcu/condenser/view in a page — the JS API end to end in a real browser, the way a host
// page uses it: build layers from columns, mount, read events, drive it, stream into it,
// snapshot, save and restore its state, destroy. The Jupyter side of the same viewer is
// test/condenser-widget.mjs. Run: node test/condenser-view-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__page') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' blob:; img-src 'self' data: blob:; connect-src 'self'; worker-src blob:; style-src 'unsafe-inline'" });
    res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222"><div id="a" style="width:640px"></div><div id="b" style="width:640px"></div></body>');
    return;
  }
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/__page`);

const r = await page.evaluate(async () => {
  const C = await import('/ext/condenser/view/index.js');
  const out = {};
  const settle = (ms = 700) => new Promise((res) => setTimeout(res, ms));
  const host = document.getElementById('a');
  const ink = (el) => {
    const cv = el.querySelector('canvas');
    const gl = cv.getContext('webgl2');
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 18) + Math.abs(px[i + 1] - 18) + Math.abs(px[i + 2] - 18) > 30) n++;
    return n;
  };

  // ── a model, a cloud, holes, a surface and a mesh, from plain columns ──
  const X = [], Y = [], Z = [], FE = [], ROCK = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) for (let k = 0; k < 10; k++) {
    X.push(500005 + i * 10); Y.push(8200005 + j * 10); Z.push(302.5 + k * 5);
    FE.push(40 + i + Math.sin(j) * 5 + k); ROCK.push(k < 4 ? 'ITA' : 'HEM');
  }
  const tx = new Float64Array(3000), ty = new Float64Array(3000), tz = new Float64Array(3000);
  for (let i = 0; i < 3000; i++) { tx[i] = 500000 + (i % 60) * 5; ty[i] = 8200000 + Math.floor(i / 60) * 4; tz[i] = 360 + Math.sin(i / 50) * 4; }
  const collar = { BHID: ['A', 'B'], X: [500100, 500200], Y: [8200100, 8200120], Z: [360, 362] };
  const survey = { BHID: ['A', 'B'], DEPTH: [0, 0], AZ: [90, 180], DIP: [-60, -90] };
  const assay = { BHID: ['A', 'A', 'B'], FROM: [0, 20, 0], TO: [20, 50, 40], AU: [0.3, 1.8, 0.9] };
  const v = C.view(host, [
    C.blocks({ x: X, y: Y, z: Z, value: FE, category: ROCK }, { name: 'model' }),
    C.points({ x: tx, y: ty, z: tz }, { name: 'topo', sectioned: false }),
    C.drillholes(collar, survey, assay, { value: 'AU', name: 'holes', labels: true }),
    C.mesh([[500000, 8200000, 300], [500300, 8200000, 300], [500000, 8200200, 300]], [[0, 1, 2]], { name: 'floor', opacity: 0.5 }),
  ], { theme: 'dark', height: 420 });
  const events = { pick: [], hover: [], select: [], measure: [], section: [], style: [], camera: [] };
  for (const e of Object.keys(events)) v.on(e, (d) => events[e].push(d));
  await settle(1500);
  out.inkFirst = ink(host);
  out.layers = v.layers.map((l) => `${l.name}:${l.kind}:${l.count}`);

  // pick: click the middle of the model
  const cv = host.querySelector('canvas');
  const rc = cv.getBoundingClientRect();
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.6]]) {
    const cx = rc.left + rc.width * fx, cy = rc.top + rc.height * fy;
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
    cv.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }));
    await settle(300);
    if (events.pick.length && events.pick.at(-1)) break;
  }
  out.pick = events.pick.at(-1) || null;
  out.selection = v.selection;

  // hover (no toolbar needed)
  v.set({ hover: true });
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: rc.left + rc.width * 0.5, clientY: rc.top + rc.height * 0.5, bubbles: true }));
  await settle(300);
  out.hover = events.hover.at(-1) || null;

  // style: a threshold hides most of the model
  const before = ink(host);
  v.layer('model').set({ threshold: [75, 99] });
  await settle(900);
  out.threshold = { before, after: ink(host), styleEvent: events.style.length > 0, kept: v.layer('model').get('threshold') };
  v.layer('model').set({ threshold: [] });

  // section + look
  v.cut('z', 320, 10).look('plan', { ortho: true });
  await settle(900);
  out.section = { event: events.section.at(-1), state: v.get('section'), ink: ink(host) };
  v.cut();
  v.look({ azimuth: 135, plunge: 30 });
  await settle(600);
  out.camera = v.camera;

  // rectangle select through the toolbar → a 'select' event with rows per layer
  const toolBtn = (p) => [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith(p));
  v.fit(); await settle(900);
  toolBtn('Rectangle').click();
  const hostDiv = host.firstElementChild;
  const at = (fx, fy) => [rc.left + rc.width * fx, rc.top + rc.height * fy];
  const [ax, ay] = at(0.3, 0.3), [bx, by] = at(0.7, 0.7);
  hostDiv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ax, clientY: ay, bubbles: true }));
  hostDiv.dispatchEvent(new PointerEvent('pointermove', { clientX: (ax + bx) / 2, clientY: (ay + by) / 2, bubbles: true }));
  hostDiv.dispatchEvent(new PointerEvent('pointermove', { clientX: bx, clientY: by, bubbles: true }));
  hostDiv.dispatchEvent(new PointerEvent('pointerup', { clientX: bx, clientY: by, bubbles: true }));
  await settle(600);
  const sel = events.select.at(-1) || [];
  out.select = sel.map((s) => ({ name: s.name, n: s.rows.length, typed: s.rows instanceof Uint32Array }));
  out.selRowsByName = Object.fromEntries(Object.entries(v.selected_rows).map(([k, r]) => [k, r.length]));
  v.clear_selection();
  toolBtn('Pick').click();

  // snapshot → a PNG Blob
  const blob = await v.snapshot();
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  out.snapshot = { type: blob.type, size: blob.size, magic: Array.from(head) };

  // state() → JSON → set() on a fresh view of the same data
  v.cut('x', 500100, 20);
  v.layer('topo').set({ visible: false, point_size: 4 });
  const st = v.state();
  out.stateJson = JSON.stringify(st).length > 50;
  const host2 = document.getElementById('b');
  const v2 = C.view(host2, [
    C.blocks({ x: X, y: Y, z: Z, value: FE, category: ROCK }, { name: 'model' }),
    C.points({ x: tx, y: ty, z: tz }, { name: 'topo' }),
  ], { theme: 'dark' });
  v2.set(st);
  out.restored = { section: v2.get('section'), topo: v2.layer('topo').style() };
  v2.destroy();
  out.destroyed = host2.querySelectorAll('canvas').length;

  // streaming: declared shape, rows appended over time, drawn as they land
  v.destroy();
  const hs = document.getElementById('b');
  const m = C.blocks.stream({ axes: [[0, 10, 40], [0, 10, 40], [0, 5, 20]], capacity: 32000, value_range: [0, 1], categories: ['a', 'b'] }, { name: 'stream' });
  const vs = C.view(hs, [m], { theme: 'dark', height: 360, workers: false });   // this page's CSP has no worker-src for scripts
  const sh = vs.layer('stream');
  await settle(800);
  const inkS = [ink(hs)];
  const batch = (k0, k1) => {
    const x = [], y = [], z = [], value = [], category = [];
    for (let k = k0; k < k1; k++) for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) { x.push(i * 10); y.push(j * 10); z.push(k * 5); value.push((i + j) / 80); category.push(k % 2 ? 'b' : 'a'); }
    return { x, y, z, value, category };
  };
  for (const [k0, k1] of [[0, 4], [4, 8], [8, 12]]) { sh.append(batch(k0, k1)); await settle(700); inkS.push(ink(hs)); }
  out.streamErrors = [];
  try { sh.append({ x: [9999], y: [0], z: [0] }); } catch (e) { out.streamErrors.push(e.message); }
  try { sh.append({ x: [0], y: [0], z: [0], value: [0], category: ['zz'] }); } catch (e) { out.streamErrors.push(e.message); }
  sh.end();
  out.streamInk = inkS;
  // a stream re-joins after the view reloads (add) — every row is replayed
  vs.add(C.points({ x: [0, 400], y: [0, 400], z: [0, 100] }, { name: 'corners' }));
  await settle(1200);
  out.streamAfterReload = ink(hs);
  try { vs.on('nope', () => {}); } catch (e) { out.badEvent = e.message; }
  try { v.layer('model').append({ x: [0], y: [0], z: [0] }); } catch (e) { out.notStream = e.message; }
  vs.destroy();
  return out;
});

// ── the orientation lock and the `view` event (condenser-view-api step 3) ──
const L = await page.evaluate(async () => {
  const C = await import('/ext/condenser/view/index.js');
  const out = {};
  const settle = (ms = 500) => new Promise((res) => setTimeout(res, ms));
  const host = document.getElementById('a');
  host.innerHTML = '';
  const X = [], Y = [], Z = [], FE = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) for (let k = 0; k < 10; k++) {
    X.push(500005 + i * 10); Y.push(8200005 + j * 10); Z.push(302.5 + k * 5); FE.push(40 + i + k);
  }
  const model = () => C.blocks({ x: X, y: Y, z: Z, value: FE }, { name: 'model' });
  // the opening shot: three-quarter, looking north-east, in perspective
  const host0 = document.getElementById('b');
  host0.innerHTML = '';
  const v0 = C.view(host0, [model()], { theme: 'dark', height: 300 });
  await settle(900);
  out.opening = { ...v0.camera };
  v0.destroy();

  const v = C.view(host, [model()], { theme: 'dark', height: 400, lock: 'plan' });
  const ev = { lock: [], view: [] };
  v.on('lock', (d) => ev.lock.push(d));
  v.on('view', (d) => ev.view.push(d));
  await settle(1200);
  const cv = host.querySelector('canvas'), rc = cv.getBoundingClientRect();
  const lockBtn = () => [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith('Lock'));
  const viewBtn = () => [...host.querySelectorAll('.cdt button')].find((b) => (b.title || '').startsWith('Standard'));
  const drag = async (dx, dy, opts = {}) => {
    const x0 = rc.left + rc.width * 0.5, y0 = rc.top + rc.height * 0.5;
    cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y0, bubbles: true, ...opts }));
    for (let s = 1; s <= 4; s++) cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + dx * s / 4, clientY: y0 + dy * s / 4, bubbles: true, ...opts }));
    cv.dispatchEvent(new PointerEvent('pointerup', { clientX: x0 + dx, clientY: y0 + dy, bubbles: true, ...opts }));
    await settle(400);
  };
  const key = async (k) => { cv.focus(); cv.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await settle(400); };
  const cam = () => ({ ...v.camera });

  out.plan = { camera: cam(), pressed: lockBtn().getAttribute('aria-pressed'), view: ev.view.at(-1) };
  const before = cam();
  await drag(80, 40);
  out.dragLocked = { before, after: cam() };

  // set({ view: { rect } }) frames a world rectangle; the next `view` event reads it back
  v.set({ view: { rect: { u0: 500050, u1: 500150, v0: 8200050, v1: 8200150 } } });
  await settle(500);
  out.rectSet = ev.view.at(-1);

  // L frees the view (and the projection goes back), a drag orbits; L again locks back
  await key('l');
  out.freed = { lock: ev.lock.at(-1), camera: cam(), pressed: lockBtn().getAttribute('aria-pressed'), rect: 'rect' in ev.view.at(-1) };
  const fb = cam();
  await drag(80, 0);
  out.dragFree = { before: fb, after: cam() };
  await key('L');
  out.relocked = { lock: ev.lock.at(-1), camera: cam() };

  // look('north') while locked moves the lock; a numeric look makes a direction lock
  v.look('north');
  await settle(500);
  out.lookNorth = { lock: ev.lock.at(-1), camera: cam(), view: ev.view.at(-1) };
  v.look({ azimuth: 45, plunge: 20 });
  await settle(500);
  out.lookNum = { lock: ev.lock.at(-1), camera: cam() };

  // the isometrics are lockable presets; a three-quarter view (perspective) frees the lock
  v.look('iso');
  await settle(500);
  out.lookIso = { lock: ev.lock.at(-1), camera: cam() };
  v.look('3/4-sw');
  await settle(500);
  out.look34 = { lock: ev.lock.at(-1), camera: cam() };

  // a section lock follows the section, and the axes follow the lock
  v.set({ lock: 'section' });
  v.cut('y', 8200100, 10);
  await settle(500);
  out.secY = { camera: cam(), view: ev.view.at(-1) };
  v.cut({ normal: [1, 0, 0], position: 500150, thickness: 10 });
  await settle(500);
  out.secX = { camera: cam(), view: ev.view.at(-1) };
  v.cut();

  // twist: a locked plan turns about the vertical with ctrl-drag only when allowed
  v.set({ lock: 'plan', twist: false });
  await settle(400);
  const t0 = cam();
  await drag(90, 0, { ctrlKey: true });
  out.noTwist = { before: t0, after: cam() };
  v.set({ twist: true });
  await settle(300);
  const t1 = cam();
  await drag(90, 0, { ctrlKey: true });
  out.twist = { before: t1, after: cam(), view: ev.view.at(-1), lock: v.get('lock') };
  v.set({ twist: false });

  // lock_toggle: false — no unlock control, and L does nothing
  v.set({ lock_toggle: false });
  await settle(300);
  const nLock = ev.lock.length;
  await key('l');
  out.fixed = { lockShown: lockBtn().style.display !== 'none', viewsShown: viewBtn().style.display !== 'none', lockEvents: ev.lock.length - nLock, lock: v.get('lock') };

  // state() carries the lock to another view
  const st = v.state();
  const host2 = document.getElementById('b');
  host2.innerHTML = '';
  const v2 = C.view(host2, [model()], { theme: 'dark', height: 300 });
  v2.set(st);
  await settle(900);
  out.restored = { lock: v2.get('lock'), toggle: v2.get('lock_toggle'), camera: { ...v2.camera } };
  v2.destroy();

  out.bad = [];
  try { C.view(document.createElement('div'), [model()], { lock: 'plna' }); } catch (e) { out.bad.push(e.message); }
  try { v.set({ lock: { azimuth: 3 } }); } catch (e) { out.bad.push(e.message); }
  try { v.set({ view: { rect: { u0: 1 } } }); } catch (e) { out.bad.push(e.message); }
  v.destroy();
  return out;
});

// ── the chrome (condenser-view-api step 4): plugins, theme, legends, keyboard ──
const K = await page.evaluate(async () => {
  const C = await import('/ext/condenser/view/index.js');
  const out = {};
  const settle = (ms = 500) => new Promise((res) => setTimeout(res, ms));
  const host = document.getElementById('a');
  host.innerHTML = '';
  const X = [], Y = [], Z = [], FE = [], ROCK = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) for (let k = 0; k < 10; k++) {
    X.push(500005 + i * 10); Y.push(8200005 + j * 10); Z.push(302.5 + k * 5); FE.push(40 + i + k);
    ROCK.push(['ITA', 'HEM', 'QTZ', 'BIF'][(i + j + k) % 4]);
  }
  const v = C.view(host, [C.blocks({ x: X, y: Y, z: Z, value: FE, category: ROCK }, {
    name: 'lith', color: 'category', colors: { ITA: '#ff0000' }, category_order: ['BIF', 'QTZ'], legend_counts: 'all',
  })], { theme: 'dark', height: 400 });
  await settle(1500);
  const cv = host.querySelector('canvas'), rc = cv.getBoundingClientRect();
  const gl = cv.getContext('webgl2');
  const px = () => { const a = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
  const count = (a, f) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (f(a[i], a[i + 1], a[i + 2])) n++; return n; };
  const isRed = (r, g, b) => r > 120 && g < 25 && b < 25, isGreen = (r, g, b) => g > 120 && r < 25 && b < 25;   // pure channels: the theme's own red (Tableau's) has green in it
  const corner = () => { const a = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); return Array.from(a.slice(0, 3)); };
  const legend = () => host.querySelector('[data-id="legend"] .cdph');
  const legText = () => (legend() ? legend().getAttribute('aria-label') || '' : '');
  const legClick = (k, shift = false) => {
    const r = legend().getBoundingClientRect();
    legend().dispatchEvent(new MouseEvent('click', { clientX: r.left + 20, clientY: r.top + 7 + 14 + 15 * k + 7, bubbles: true, shiftKey: shift }));
  };

  // theme: basalt by default; 'light'; 'css' from the page's tokens
  out.bgDark = corner();
  out.legend0 = legText();
  out.red0 = count(px(), isRed);
  v.set({ theme: 'light' });
  await settle();
  out.bgLight = corner();
  out.accentLight = host.firstElementChild.style.getPropertyValue('--cd-accent');
  document.body.style.setProperty('--au-surface', '#fafafa');
  document.body.style.setProperty('--au-action', '#123456');
  v.set({ theme: 'css' });
  await settle();
  out.bgCss = corner();
  out.accentCss = host.firstElementChild.style.getPropertyValue('--cd-accent');
  // C4: 'css' set AGAIN after the page's tokens change reads them again (the store used to drop it)
  document.body.style.setProperty('--au-surface', '#f0f0f0');
  v.set({ theme: 'css' });
  await settle();
  out.bgCss2 = corner();
  // 'auto' follows the page on its own: a style change on <body> re-reads, no set() needed
  v.set({ theme: 'auto' });
  await settle();
  document.body.style.setProperty('--au-surface', '#e0e0e0');
  await settle();
  out.bgAuto = corner();
  document.body.style.removeProperty('--au-surface'); document.body.style.removeProperty('--au-action');
  v.set({ theme: 'dark' });

  // a class colour reaches the shaders, and changes live
  v.layer('lith').set({ colors: { ITA: '#00ff00' } });
  await settle(800);
  const a2 = px();
  out.recolor = { red: count(a2, isRed), green: count(a2, isGreen) };

  // the legend: rows are eyes; shift-click isolates, and again shows all
  legClick(0);                                             // BIF (first, by category_order)
  await settle();
  out.hidOne = v.layer('lith').get('categories_hidden');
  legClick(0);
  legClick(1, true);                                       // isolate QTZ
  await settle();
  out.isolated = v.layer('lith').get('categories_hidden');
  out.legendIsolated = legText();
  legClick(1, true);
  await settle();
  out.allBack = v.layer('lith').get('categories_hidden');

  // legend_counts: 'selection' counts the selected rows per class
  v.layer('lith').set({ legend_counts: 'selection' });
  [...host.querySelectorAll('.cdt button')].find((b) => b.title.startsWith('Rectangle')).click();
  const hd = host.firstElementChild, at = (fx, fy) => [rc.left + rc.width * fx, rc.top + rc.height * fy];
  const [ax, ay] = at(0.35, 0.35), [bx, by] = at(0.65, 0.65);
  hd.dispatchEvent(new PointerEvent('pointerdown', { clientX: ax, clientY: ay, bubbles: true }));
  hd.dispatchEvent(new PointerEvent('pointermove', { clientX: bx, clientY: by, bubbles: true }));
  hd.dispatchEvent(new PointerEvent('pointerup', { clientX: bx, clientY: by, bubbles: true }));
  await settle(700);
  out.selCounts = (legText().match(/\d+/g) || []).map(Number);
  out.selRows = (v.selected_rows.lith || []).length;
  v.clear_selection();
  [...host.querySelectorAll('.cdt button')].find((b) => b.title.startsWith('Pick')).click();
  v.layer('lith').set({ legend_counts: 'all' });

  // a page's own plugin: DOM in a slot, and a drawing that reaches the snapshot
  v.chrome.add({
    id: 'stats', slot: 'top-right', order: 5,
    mount(el, api) { el.textContent = `layers: ${api.layers().length}`; el.className = 'my-stats'; },
    measure: () => ({ w: 40, h: 40 }),
    draw(g) { g.fillStyle = '#ff00ff'; g.fillRect(0, 0, 40, 40); },
  });
  await settle();
  const magenta = async (blob) => {
    const bmp = await createImageBitmap(blob), c2 = document.createElement('canvas');
    c2.width = bmp.width; c2.height = bmp.height;
    const g2 = c2.getContext('2d'); g2.drawImage(bmp, 0, 0);
    const d = g2.getImageData(0, 0, c2.width, c2.height).data;
    return count(d, (r, g, b) => r > 240 && g < 20 && b > 240);
  };
  out.pluginDom = (host.querySelector('.cdslot.top-right .my-stats') || {}).textContent || '';
  out.pluginInSnapshot = await magenta(await v.snapshot());
  out.ids = v.chrome.list().map((p) => p.id);
  v.chrome.remove('stats');
  v.chrome.remove('legend');
  await settle();
  out.afterRemove = { stats: !!host.querySelector('.my-stats'), legend: !!legend(), magenta: await magenta(await v.snapshot()) };

  // the switches
  v.set({ chrome: { scalebar: false, north: false, legend: true } });
  await settle();
  out.switched = v.chrome.list().map((p) => p.id);
  v.set({ toolbar: false });
  await settle();
  out.noToolbar = { ids: v.chrome.list().map((p) => p.id), bar: !!host.querySelector('.cdt') };
  v.set({ toolbar: true, chrome: {} });
  await settle();

  // the keyboard
  cv.focus();
  const key = async (k, o = {}) => { cv.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o })); await settle(300); };
  const c0 = { ...v.camera };
  await key('ArrowRight');
  const c1 = { ...v.camera };
  await key('+');
  const c2 = { ...v.camera };
  await key('p');
  const c3 = { ...v.camera };
  [...host.querySelectorAll('.cdt button')].find((b) => b.title.startsWith('Rectangle')).click();
  await key('Escape');
  out.keys = {
    panned: c1.target[0] !== c0.target[0] || c1.target[1] !== c0.target[1], zoomed: c2.distance < c1.distance,
    plan: c3.plunge > 89, escaped: [...host.querySelectorAll('.cdt button')].find((b) => b.title.startsWith('Pick')).getAttribute('aria-pressed'),
  };
  out.aria = cv.getAttribute('aria-label');

  // the readout: E and N under the cursor in a locked plan view
  v.set({ lock: 'plan' });
  await settle();
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2, bubbles: true }));
  await settle(200);
  out.readout = (host.querySelector('.cdread') || {}).textContent || '';
  out.viewNow = v.camera;
  v.destroy();
  return out;
});
const ok3 = (c, rgb, tol = 6) => c.every((x, i) => Math.abs(x - rgb[i]) <= tol);
chk(`theme: 'css' set again re-reads the page (${K.bgCss2}); 'auto' follows a page switch by itself (${K.bgAuto})`, ok3(K.bgCss2, [240, 240, 240]) && ok3(K.bgAuto, [224, 224, 224]));
chk('theme: dark is basalt; light and css (the page\'s tokens) re-dress the scene and the chrome', ok3(K.bgDark, [21, 23, 26]) && ok3(K.bgLight, [228, 227, 225]) && K.accentLight === '#8B3F00' && ok3(K.bgCss, [250, 250, 250]) && K.accentCss === '#123456', JSON.stringify({ d: K.bgDark, l: K.bgLight, c: K.bgCss, a: [K.accentLight, K.accentCss] }));
chk('colors: a class colour reaches the shaders, and a change recolours live', K.red0 > 500 && K.recolor.red < K.red0 * 0.05 && K.recolor.green > 500, JSON.stringify({ red0: K.red0, ...K.recolor }));
chk('the legend lists the classes in category_order, with counts', /^lith: BIF 1500, QTZ 1500, HEM 1500, ITA 1500$/.test(K.legend0), K.legend0);
chk('a legend click hides a class; shift-click isolates one, and again shows all', JSON.stringify(K.hidOne) === '["BIF"]' && JSON.stringify([...K.isolated].sort()) === '["BIF","HEM","ITA"]' && /QTZ 1500/.test(K.legendIsolated) && /BIF \(hidden\)/.test(K.legendIsolated) && K.allBack.length === 0, JSON.stringify({ one: K.hidOne, iso: K.isolated, back: K.allBack }));
chk("legend_counts: 'selection' counts the selected rows per class", K.selRows > 0 && K.selCounts.length === 4 && K.selCounts.reduce((a, b) => a + b, 0) === K.selRows, JSON.stringify({ counts: K.selCounts, rows: K.selRows }));
chk("a page's plugin: DOM in its slot, its drawing in the snapshot; remove() takes it (and a built-in) away", K.pluginDom === 'layers: 1' && K.pluginInSnapshot > 1000 && K.ids.includes('stats') && !K.afterRemove.stats && !K.afterRemove.legend && K.afterRemove.magenta === 0, JSON.stringify({ dom: K.pluginDom, snap: K.pluginInSnapshot, after: K.afterRemove }));
chk('chrome switches add and drop the built-ins; toolbar: false drops the toolbar, section bar and pick box', !K.switched.includes('scalebar') && !K.switched.includes('north') && K.switched.includes('legend') && !K.noToolbar.ids.includes('toolbar') && !K.noToolbar.ids.includes('section') && !K.noToolbar.bar, JSON.stringify({ s: K.switched, t: K.noToolbar.ids }));
chk('keyboard: arrows pan, + zooms, P goes to plan, Esc ends a tool', K.keys.panned && K.keys.zoomed && K.keys.plan && K.keys.escaped === 'true', JSON.stringify(K.keys));
chk('the canvas has an accessible summary of what it shows', /3D view of lith \(blocks\)\. Looking \d+° from north, \d+° down/.test(K.aria || ''), K.aria);
chk('the readout gives E and N under the cursor in a locked plan view', /^E 5001\d\d\.\d\s+N 82001\d\d\.\d$/.test(K.readout.trim()), JSON.stringify(K.readout));

const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;
const pv = L.plan.view;
chk("lock: 'plan' looks straight down, orthographic, the lock button pressed", L.plan.camera.plunge === 90 && L.plan.camera.ortho === true && L.plan.pressed === 'true', JSON.stringify(L.plan.camera));
chk(`a locked plan opens on the model, not its bounding sphere (${pv && pv.rect && [Math.round(pv.rect.u1 - pv.rect.u0), Math.round(pv.rect.v1 - pv.rect.v0)]} m for 300 × 200)`, pv && pv.rect && pv.rect.u0 <= 500000 && pv.rect.u1 >= 500300 && pv.rect.v0 <= 8200000 && pv.rect.v1 >= 8200200 && (pv.rect.v1 - pv.rect.v0) < 240);
chk("the 'view' event carries the world rectangle along E/N and the pixel box", pv && pv.lock === 'plan' && pv.axes.join() === 'E,N' && pv.rect.u0 < 500155 && pv.rect.u1 > 500155 && pv.rect.v0 < 8200105 && pv.rect.v1 > 8200105 && pv.px.w > 100 && near((pv.rect.u1 - pv.rect.u0) / (pv.rect.v1 - pv.rect.v0), pv.px.w / pv.px.h, 0.01), JSON.stringify(pv && { rect: pv.rect, px: pv.px }));
const dl = L.dragLocked;
chk('a drag in a locked view pans: the target moves, the direction does not', dl.after.plunge === 90 && dl.after.azimuth === dl.before.azimuth && (dl.after.target[0] !== dl.before.target[0] || dl.after.target[1] !== dl.before.target[1]), `${dl.before.target} → ${dl.after.target}`);
const rs = L.rectSet && L.rectSet.rect;
chk('set({view: {rect}}) frames that rectangle (centred, the whole of it, one side tight)', rs && near((rs.u0 + rs.u1) / 2, 500100, 0.5) && near((rs.v0 + rs.v1) / 2, 8200100, 0.5) && rs.u1 - rs.u0 >= 99.9 && rs.v1 - rs.v0 >= 99.9 && Math.min(rs.u1 - rs.u0, rs.v1 - rs.v0) < 100.5, JSON.stringify(rs));
chk('L frees the view: projection restored, the rectangle gone, a drag orbits', L.freed.lock === 'free' && L.freed.camera.ortho === false && L.freed.pressed === 'false' && !L.freed.rect && (L.dragFree.after.azimuth !== L.dragFree.before.azimuth), JSON.stringify({ f: L.freed.camera, d: L.dragFree.after.azimuth }));
chk('… and L again locks back to the same orientation', L.relocked.lock === 'plan' && L.relocked.camera.plunge === 90 && L.relocked.camera.ortho === true, JSON.stringify(L.relocked));
chk("look('north') while locked moves the lock; axes E/RL", L.lookNorth.lock === 'north' && L.lookNorth.camera.plunge === 0 && near(L.lookNorth.camera.azimuth, 0) && L.lookNorth.view.axes.join() === 'E,RL', JSON.stringify(L.lookNorth.camera));
chk('a numeric look while locked becomes a direction lock', L.lookNum.lock && L.lookNum.lock.azimuth === 45 && L.lookNum.lock.plunge === 20 && near(L.lookNum.camera.azimuth, 45) && near(L.lookNum.camera.plunge, 20), JSON.stringify(L.lookNum));
chk('the opening shot is three-quarter: looking north-east, 30° down, perspective', L.opening.azimuth === 45 && L.opening.plunge === 30 && L.opening.ortho === false, JSON.stringify(L.opening));
chk("look('iso') while locked locks a TRUE isometric (35.26° down, looking NE, orthographic)", L.lookIso.lock === 'iso' && L.lookIso.camera.azimuth === 45 && L.lookIso.camera.plunge === 35.26 && L.lookIso.camera.ortho === true, JSON.stringify(L.lookIso));
chk("look('3/4-sw') frees the lock: perspective, looking south-west, 30° down", L.look34.lock === 'free' && L.look34.camera.azimuth === 225 && L.look34.camera.plunge === 30 && L.look34.camera.ortho === false, JSON.stringify(L.look34));
chk("lock: 'section' looks along the section and follows it to a new plane", near(L.secY.camera.azimuth, 0) && L.secY.camera.plunge === 0 && L.secY.view.axes.join() === 'E,RL' && near(L.secX.camera.azimuth, 90) && L.secX.view.axes.join() === 'N,RL' && near(L.secX.camera.target[0], 500150, 0.01), JSON.stringify({ y: L.secY.camera, x: L.secX.camera }));
chk('twist: off, ctrl-drag cannot turn a locked plan; on, it turns it about the vertical only', L.noTwist.after.azimuth === L.noTwist.before.azimuth && L.twist.after.azimuth !== L.twist.before.azimuth && L.twist.after.plunge === 90 && L.twist.lock === 'plan' && L.twist.view.axes.join() === 'u,v', JSON.stringify({ off: [L.noTwist.before.azimuth, L.noTwist.after.azimuth], on: [L.twist.before.azimuth, L.twist.after.azimuth] }));
chk('lock_toggle: false hides the lock button and the views; L does nothing', !L.fixed.lockShown && !L.fixed.viewsShown && L.fixed.lockEvents === 0 && L.fixed.lock === 'plan', JSON.stringify(L.fixed));
chk('state() carries the lock to another view', L.restored.lock === 'plan' && L.restored.toggle === false && L.restored.camera.plunge === 90 && L.restored.camera.ortho === true, JSON.stringify(L.restored));
chk('a bad lock or rectangle says so', L.bad.length === 3 && /lock "plna"/.test(L.bad[0]) && /azimuth, plunge/.test(L.bad[1]) && /four numbers/.test(L.bad[2]), L.bad.join(' | '));

chk('the view draws layers built from plain columns', r.inkFirst > 20000, `${r.inkFirst} lit px; ${r.layers.join(' · ')}`);
chk("a click fires 'pick' with the row, the world position and the value", !!r.pick && r.pick.name === 'model' && r.pick.index >= 0 && Number.isFinite(r.pick.x) && r.pick.x > 500000 && Number.isFinite(r.pick.value) && ['ITA', 'HEM'].includes(r.pick.category), JSON.stringify(r.pick));
chk('… and the selection reads the same row', r.pick && r.selection.row === r.pick.index && r.selection.name === 'model');
chk("hover fires without needing a click", !!r.hover && r.hover.name != null, JSON.stringify(r.hover));
chk('layer().set({threshold}) re-renders, round-trips, fires style', r.threshold.after < r.threshold.before * 0.8 && r.threshold.styleEvent && r.threshold.kept[0] === 75, JSON.stringify(r.threshold));
chk("cut() sets the section and fires 'section'", r.section.event && r.section.event.axis === 'z' && r.section.state.position === 320 && r.section.ink > 1000, JSON.stringify(r.section.event));
chk('look({azimuth, plunge}) lands in camera', r.camera.azimuth === 135 && r.camera.plunge === 30, JSON.stringify(r.camera));
chk("a rectangle select fires 'select' with rows per layer", r.select.length > 0 && r.select.every((s) => s.typed && s.n > 0) && Object.keys(r.selRowsByName).length === r.select.length, JSON.stringify(r.select));
chk('snapshot() resolves to a PNG Blob', r.snapshot.type === 'image/png' && r.snapshot.size > 5000 && r.snapshot.magic.join() === '137,80,78,71', JSON.stringify(r.snapshot));
chk('state() → set() reproduces the section and the layer styles on another view', r.stateJson && r.restored.section && r.restored.section.axis === 'x' && r.restored.section.position === 500100 && r.restored.topo.visible === false && r.restored.topo.point_size === 4, JSON.stringify(r.restored));
chk('destroy() takes the view down', r.destroyed === 0);
chk('a stream draws more as rows are appended', r.streamInk[1] > r.streamInk[0] + 500 && r.streamInk[2] > r.streamInk[1] && r.streamInk[3] > r.streamInk[2], r.streamInk.join(' → '));
chk('append refuses rows off the declared lattice and undeclared categories', r.streamErrors.length === 2 && /outside the declared axes/.test(r.streamErrors[0]) && /was not declared/.test(r.streamErrors[1]), r.streamErrors.join(' | '));
chk('a stream survives a reload (add): its rows are replayed', r.streamAfterReload > r.streamInk[3] * 0.8, `${r.streamAfterReload} vs ${r.streamInk[3]}`);
chk('unknown events and appending to a plain layer say so', /no event 'nope'/.test(r.badEvent) && /is not a stream/.test(r.notStream));
// ── step 5: plot axes around locked views, the triad, the box axes ──
const S5 = await page.evaluate(async () => {
  const C = await import('/ext/condenser/view/index.js');
  const out = {};
  const settle = (ms = 500) => new Promise((res) => setTimeout(res, ms));
  const host = document.getElementById('a');
  host.innerHTML = '';
  const X = [], Y = [], Z = [], FE = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) for (let k = 0; k < 10; k++) {
    X.push(500005 + i * 10); Y.push(8200005 + j * 10); Z.push(302.5 + k * 5); FE.push(40 + i + k);
  }
  const v = C.view(host, [C.blocks({ x: X, y: Y, z: Z, value: FE }, { name: 'model' })], { theme: 'dark', height: 420, lock: 'plan' });
  await settle(900);
  const api = v.chrome.api, ax = v.axes;
  const deco = [...host.querySelectorAll('canvas')].find((c) => c.style.zIndex === '1');
  const ink = () => { const g = deco.getContext('2d'), d = g.getImageData(0, 0, deco.width, deco.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++; return n; };
  const pxAt = (x, y) => { const dpr = deco.width / deco.clientWidth; return Array.from(deco.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data); };
  // the axes' pixels ARE the scene's: a world point lands where the 3D view draws it
  const err = (pts, fn) => Math.max(...pts.map(([x, y, z]) => { const a = api.project(x, y, z), b = fn(x, y, z); return Math.hypot(a[0] - b[0], a[1] - b[1]); }));
  out.plan = {
    has: !!ax && typeof ax.scatter === 'function', same: v.axes === ax,
    err: err([[500005, 8200005, 330], [500295, 8200195, 330], [500150, 8200100, 330]], (x, y) => ax.toPixel(x, y)),
    labels: [ax._xlabel && ax._xlabel.text, ax._ylabel && ax._ylabel.text],
    xticks: ax.get_xticklabels(), yticks: ax.get_yticklabels(),
    insets: ['t', 'l', 'r', 'b'].map((s) => parseFloat(api.host.style.getPropertyValue(`--cd-in-${s}`)) || 0),
    corner: pxAt(2, deco.clientHeight - 2),
    describe: (host.querySelector('[aria-label^="axes:"]') || {}).getAttribute ? null : null,
  };
  // a host's plot item, in world coordinates: a red square on a collar
  ax.scatter([500150], [8200100], { marker: 's', s: 200, color: '#ff0000' });
  v.chrome.api.invalidate();
  await settle(300);
  const [cx, cy] = api.project(500150, 8200100, 330);
  out.item = pxAt(cx, cy);
  // grid lines
  v.set({ grid: true });
  await settle(300);
  out.grid = ax._grid;
  // a north-looking section, with the z stretched: RL real on the axis, still on the scene's pixels
  v.set({ z_exaggeration: 2 });
  v.look('north');
  await settle(600);
  const t = api.target;
  out.section = {
    axes: v.chrome.api.viewInfo().axes, labels: [ax._xlabel.text, ax._ylabel.text],
    err: err([[500005, t[1], 302.5], [500295, t[1], 347.5], [500150, t[1], 320]], (x, y, z) => ax.toPixel(x, z)),
    ylim: ax.get_ylim(),
  };
  // free 3D: no plot axes, insets back to 0; the triad; the box axes on request
  v.set({ lock: 'free', z_exaggeration: 1 });
  v.look('three-quarter');
  await settle(600);
  out.free = { insets: ['t', 'l', 'r', 'b'].map((s) => parseFloat(api.host.style.getPropertyValue(`--cd-in-${s}`)) || 0), ids: v.chrome.list().map((p) => p.id) };
  const inkNoBox = ink();
  v.set({ chrome: { box: true } });
  await settle(500);
  out.box = { without: inkNoBox, with: ink() };
  // the triad: click the E tip → the view from the east (looking west); the centre → three-quarter
  const ph = host.querySelector('.cdplug[data-id="triad"] .cdph');
  const { r, up } = api.basis();
  const tip = (e) => [32 + (e[0] * r[0] + e[1] * r[1] + e[2] * r[2]) * 22, 32 - (e[0] * up[0] + e[1] * up[1] + e[2] * up[2]) * 22];
  const click = (x, y) => { const b = ph.getBoundingClientRect(); ph.dispatchEvent(new MouseEvent('click', { clientX: b.left + x, clientY: b.top + y, bubbles: true })); };
  click(...tip([1, 0, 0]));
  await settle(500);
  out.triadE = { ...v.camera };
  click(...tip([0, 0, 1]).map((q, i) => (i === 1 ? q - 0.5 : q)));
  await settle(500);
  out.triadZ = { lock: v.get('lock'), cam: { ...v.camera } };
  v.set({ lock: 'free' });
  await settle(300);
  click(32, 32);
  await settle(500);
  out.triadC = { ...v.camera };
  out.triadLabel = ph.getAttribute('aria-label');
  // switches: axes: false in a locked view draws no frame
  v.set({ lock: 'plan', chrome: { axes: false } });
  await settle(500);
  out.noAxes = { ids: v.chrome.list().map((p) => p.id), insets: parseFloat(api.host.style.getPropertyValue('--cd-in-l')) || 0 };
  v.destroy();
  // a narrow section: the centre slot (scale bar, exaggeration notice) lifts above the corners
  {
    const nb = document.createElement('div'); nb.style.width = '360px'; document.body.append(nb);
    const w = C.view(nb, [C.blocks({ x: X, y: Y, z: Z, value: FE }, { name: 'Fe', units: '%' })], { theme: 'dark', height: 360, lock: 'north', z_exaggeration: 3 });
    await settle(900);
    const host2 = w.chrome.api.host, sl = (k) => host2.querySelector(`.cdslot.${k}`).getBoundingClientRect();
    const b = sl('bottom'), l = sl('bottom-left'), r = sl('bottom-right');
    const hit = (p, q) => q.width && q.height && p.left < q.right - 1 && p.right > q.left + 1 && p.top < q.bottom - 1 && p.bottom > q.top + 1;
    out.narrow = { bottomW: Math.round(b.width), overlapsLeft: !!hit(b, l), overlapsRight: !!hit(b, r), lift: host2.style.getPropertyValue('--cd-lift-b') };
    w.destroy(); nb.remove();
  }
  // a blocks layer with no value column (it crashed the load: the builder was handed chan: null)
  try {
    const w = C.view(host, [C.blocks({ x: X.slice(0, 600), y: Y.slice(0, 600), z: Z.slice(0, 600) }, { name: 'plain' })], { theme: 'dark', height: 300 });
    await settle(600);
    out.plain = { ok: true, count: w.layers ? w.layers.length : null };
    w.destroy();
  } catch (e) { out.plain = { ok: false, err: String(e) }; }
  // C3: a slab exactly one block thick shows that level only — the levels above and below only
  // TOUCH it (a face on its boundary) and are not drawn. The middle level is missing on the right.
  {
    const SX = [], SY = [], SZ = [], SV = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) for (let k = 0; k < 3; k++) {
      if (k === 1 && i >= 10) continue;
      SX.push(500005 + i * 10); SY.push(8200005 + j * 10); SZ.push(305 + k * 10); SV.push(1 + k);
    }
    const w = C.view(host, [C.blocks({ x: SX, y: SY, z: SZ, value: SV }, { name: 'slab' })], { theme: 'dark', height: 300, lock: 'plan', section: { axis: 'z', position: 315, thickness: 10 }, toolbar: false });
    await settle(1200);
    const cv = host.querySelector('canvas'), gl = cv.getContext('webgl2');
    const a = new Uint8Array(cv.width * cv.height * 4); gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, a);
    const bg = [a[4 * (cv.width + 1)], a[4 * (cv.width + 1) + 1], a[4 * (cv.width + 1) + 2]];
    let left = 0, right = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const o = 4 * (y * cv.width + x);
      if (Math.abs(a[o] - bg[0]) + Math.abs(a[o + 1] - bg[1]) + Math.abs(a[o + 2] - bg[2]) > 30) { if (x < cv.width / 2 - 4) left++; else if (x > cv.width / 2 + 4) right++; }
    }
    out.slab = { left, right };
    w.destroy();
  }
  return out;
});
const s5p = S5.plan;
chk('step 5: a locked plan carries plot axes (v.axes, the same Axes every time), E and N', s5p.has && s5p.same && s5p.labels.join() === 'E,N' && s5p.xticks.length >= 3 && s5p.yticks.length >= 3, JSON.stringify({ l: s5p.labels, x: s5p.xticks, y: s5p.yticks }));
chk('… and its coordinates are the scene\'s: a world point lands on the same pixel (≤ 1 px)', s5p.err <= 1, `${s5p.err.toFixed(3)} px`);
chk('… the slots move inside the frame, whose band is opaque', s5p.insets[1] > 30 && s5p.insets[3] > 15 && s5p.corner[3] > 200, JSON.stringify({ ins: s5p.insets, corner: s5p.corner }));
chk("a host's plot item draws in world coordinates over the plan", S5.item[0] > 200 && S5.item[1] < 60 && S5.item[2] < 60, JSON.stringify(S5.item));
chk('grid: true draws grid lines across the axes', S5.grid === true);
chk('a section (look north, z × 2): axes E / RL in real RL, still on the scene\'s pixels', S5.section.axes.join() === 'E,RL' && S5.section.labels.join() === 'E,RL' && S5.section.err <= 1 && S5.section.ylim[0] < 302.5 && S5.section.ylim[1] > 347.5, JSON.stringify({ ...S5.section, err: S5.section.err.toFixed(3) }));
chk('free 3D: no frame (insets 0), the triad on', S5.free.insets.every((q) => q === 0) && S5.free.ids.includes('triad'), JSON.stringify(S5.free));
chk('box: true puts ticked axes on the bounding box', S5.box.with > S5.box.without + 200, JSON.stringify(S5.box));
chk('the triad: E shows the view from the east (looking west), Z the plan, the centre the three-quarter view', Math.abs(S5.triadE.azimuth - 270) < 1 && Math.abs(S5.triadE.plunge) < 1 && S5.triadZ.cam.plunge > 89 && S5.triadC.plunge > 10 && S5.triadC.plunge < 60 && /orientation/.test(S5.triadLabel || ''), JSON.stringify({ e: S5.triadE, z: S5.triadZ, c: S5.triadC }));
chk('chrome: {axes: false} drops the frame from a locked view', !S5.noAxes.ids.includes('axes') && S5.noAxes.insets === 0, JSON.stringify(S5.noAxes));
chk('a blocks layer with no value column loads', S5.plain.ok, JSON.stringify(S5.plain));
chk(`a one-block slab shows its level only: nothing where that level is missing (${S5.slab.right} px vs ${S5.slab.left} where it exists)`, S5.slab.left > 1000 && S5.slab.right < S5.slab.left * 0.02);
chk('a narrow section: the scale bar and exaggeration notice lift clear of the corner stacks', S5.narrow.bottomW > 0 && !S5.narrow.overlapsLeft && !S5.narrow.overlapsRight, JSON.stringify(S5.narrow));

chk('no page errors under a strict CSP', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
