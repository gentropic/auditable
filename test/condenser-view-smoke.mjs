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
  ], { height: 420 });
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
  ]);
  v2.set(st);
  out.restored = { section: v2.get('section'), topo: v2.layer('topo').style() };
  v2.destroy();
  out.destroyed = host2.querySelectorAll('canvas').length;

  // streaming: declared shape, rows appended over time, drawn as they land
  v.destroy();
  const hs = document.getElementById('b');
  const m = C.blocks.stream({ axes: [[0, 10, 40], [0, 10, 40], [0, 5, 20]], capacity: 32000, value_range: [0, 1], categories: ['a', 'b'] }, { name: 'stream' });
  const vs = C.view(hs, [m], { height: 360, workers: false });   // this page's CSP has no worker-src for scripts
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
chk('no page errors under a strict CSP', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
