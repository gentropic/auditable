// wuffle smoke — boots the BUILT wuffle.html (the deploy artifact + what lands
// in the lead-acid APK) and exercises the core: bearing integration, the live
// Schmidt net, plotting, manual entry, delete/clear. Committed guard, like
// micro-smoke. Run: node test/wuffle-smoke.mjs  (needs `node build.js --target=wuffle`)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
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

let pass = 0, fail = 0;
const chk = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };

if (!fs.existsSync(path.join(root, 'wuffle.html'))) {
  console.error('wuffle.html not built — run: node build.js --target=wuffle');
  process.exit(1);
}

const browser = await chromium.launch();
const p = await browser.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(`http://127.0.0.1:${PORT}/wuffle.html?field`, { waitUntil: 'load' });   // ?field: the compass (a desktop window opens the desk)

// 1. boots — the registry bundle wired @gcu/bearing + @gcu/leadacid without errors
const booted = await p.waitForFunction(() => !!window.__wuffle, null, { timeout: 15000 }).then(() => true).catch(() => false);
chk(`built wuffle.html boots (window.__wuffle; errors: ${errs.length ? errs.join(' ; ') : 'none'})`, booted && errs.length === 0);

// 2. the Schmidt net rendered (bearing's Stereonet — graticule + primitive + cardinals)
const net = await p.evaluate(() => {
  const svg = document.querySelector('.net svg');
  if (!svg) return null;
  const q = (s) => svg.querySelectorAll(s).length;
  return { grid: q('.sn-grid'), prim: q('.sn-primitive'), cardinals: q('.sn-cardinal') };
});
chk(`net renders (grid ${net?.grid}, primitive ${net?.prim}, cardinals ${net?.cardinals})`,
  net && net.grid > 0 && net.prim > 0 && net.cardinals === 4);

// 3. plotting: a plane → a great-circle path, a line → a point (bearing integration)
await p.evaluate(() => { window.__wuffle.plot(45, 30, 'plane'); window.__wuffle.plot(200, 25, 'plane'); window.__wuffle.plot(310, 70, 'line'); });
const plotted = await p.evaluate(() => ({
  planes: document.querySelectorAll('.net .sn-plane').length,
  lines: document.querySelectorAll('.net .sn-line').length,
  count: window.__wuffle.count(),
  rows: document.querySelectorAll('#list li').length,
}));
chk(`plots 2 planes + 1 line (planes ${plotted.planes}, lines ${plotted.lines}, log ${plotted.count}, rows ${plotted.rows})`,
  plotted.planes === 2 && plotted.lines === 1 && plotted.count === 3 && plotted.rows === 3);

// 4. a plane's great circle is real geometry inside the net (not empty / not NaN)
const geom = await p.evaluate(() => {
  const pl = document.querySelector('.net .sn-plane');
  if (!pl) return null;
  const d = pl.getAttribute('d') || '';
  const bb = pl.getBBox();
  return { hasPath: d.length > 10 && !/NaN/.test(d), w: Math.round(bb.width), h: Math.round(bb.height) };
});
chk(`plane trace is real geometry (path ${geom?.hasPath}, bbox ${geom?.w}×${geom?.h})`,
  geom && geom.hasPath && geom.w > 20 && geom.h > 20);

// 5. manual entry: "045/30" → a plane, "310→70" → a line (the desktop/two-homes path)
await p.evaluate(() => { window.__wuffle.plot && 0; });
await p.fill('#manual', '120/55'); await p.click('#add');
await p.fill('#manual', '90→15'); await p.click('#add');
const afterEntry = await p.evaluate(() => ({
  count: window.__wuffle.count(),
  last: window.__wuffle.log[window.__wuffle.log.length - 1],
  prev: window.__wuffle.log[window.__wuffle.log.length - 2],
}));
chk(`manual entry parses (count ${afterEntry.count}, 120/55 plane=${afterEntry.prev?.mode}, 90→70 line=${afterEntry.last?.mode})`,
  afterEntry.count === 5 && afterEntry.prev?.mode === 'plane' && afterEntry.prev?.d1 === 120 && afterEntry.last?.mode === 'line');

// 6. delete one row → count + net update
await p.evaluate(() => document.querySelector('#list li .del').click());
const afterDel = await p.evaluate(() => ({ count: window.__wuffle.count(), rows: document.querySelectorAll('#list li').length }));
chk(`delete a measurement (count ${afterDel.count}, rows ${afterDel.rows})`, afterDel.count === 4 && afterDel.rows === 4);

// 7. the log is KEPT on the phone: a reload brings it back (it lived in memory only); clear asks for a
//    second tap, and once cleared a reload stays empty
await p.evaluate(() => window.__wuffle.kept());
await p.reload({ waitUntil: 'load' });
await p.waitForFunction(() => window.__wuffle && window.__wuffle.count() === 4, null, { timeout: 5000 }).catch(() => {});
const kept = await p.evaluate(() => ({ count: window.__wuffle.count(), msg: document.getElementById('msg').textContent }));
chk(`the log survives a reload (count ${kept.count}; "${kept.msg}")`, kept.count === 4 && /kept from last time: 4/.test(kept.msg));
await p.click('#clear');
const armed = await p.evaluate(() => ({ count: window.__wuffle.count(), msg: document.getElementById('msg').textContent }));
chk(`one tap of clear asks first (count ${armed.count}; "${armed.msg}")`, armed.count === 4 && /tap clear again/.test(armed.msg));
// 7b. clear (the second tap) → empty net + log
await p.click('#clear');
const afterClear = await p.evaluate(() => ({
  count: window.__wuffle.count(),
  planes: document.querySelectorAll('.net .sn-plane').length,
  lines: document.querySelectorAll('.net .sn-line').length,
}));
chk(`clear empties log + net (count ${afterClear.count}, planes ${afterClear.planes}, lines ${afterClear.lines})`,
  afterClear.count === 0 && afterClear.planes === 0 && afterClear.lines === 0);

// 8. mode toggle updates the reading labels
const labels = await p.evaluate(() => {
  document.getElementById('mLine').click();
  const line = [document.getElementById('l1').textContent, document.getElementById('l2').textContent];
  document.getElementById('mPlane').click();
  const plane = [document.getElementById('l1').textContent, document.getElementById('l2').textContent];
  return { line, plane };
});
chk(`mode toggle relabels (plane ${labels.plane}, line ${labels.line})`,
  labels.plane[0] === 'dip dir' && labels.plane[1] === 'dip' && labels.line[0] === 'trend' && labels.line[1] === 'plunge');

// 9. the live reading points the right way (bearing 0.2.4: until then every attitude read 180° off). Worked by hand:
// facing North, top edge raised 30° → the plane dips 180/30; top North and lowered 30° → the line plunges 000/30
const live = async (mode, beta) => p.evaluate(([mode, beta]) => {
  document.getElementById(mode === 'plane' ? 'mPlane' : 'mLine').click();
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 0, beta, gamma: 0, absolute: true }));
  return [parseFloat(document.getElementById('v1').textContent), parseFloat(document.getElementById('v2').textContent)];
}, [mode, beta]);
const pl = await live('plane', 30), ln = await live('line', -30);
chk(`live attitudes by hand (plane ${pl.join('/')} want 180/30, line ${ln.join('/')} want 0/30)`,
  Math.round(pl[0]) === 180 && Math.round(pl[1]) === 30 && Math.round(ln[0]) % 360 === 0 && Math.round(ln[1]) === 30);

// 10. cleared stays cleared across a reload
await p.evaluate(() => window.__wuffle.kept());
await p.reload({ waitUntil: 'load' });
await p.waitForFunction(() => window.__wuffle, null, { timeout: 5000 });
await new Promise((r) => setTimeout(r, 400));
const after = await p.evaluate(() => window.__wuffle.count());
chk(`a cleared log stays cleared after a reload (count ${after})`, after === 0);

// 11. a phone's BROWSER, not the shell: the compass, the position and the brand line come from the browser's own APIs
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ['geolocation'], geolocation: { latitude: -30.03, longitude: -51.23, accuracy: 8 },
});
const open = async (init) => {
  const pg = await phone.newPage();
  const perr = [];
  pg.on('pageerror', (e) => perr.push(String(e)));
  if (init) await pg.addInitScript(init);
  await pg.goto(`http://127.0.0.1:${PORT}/wuffle.html`, { waitUntil: 'load' });   // no ?field: a phone width opens the compass
  await pg.waitForFunction(() => !!window.__wuffle, null, { timeout: 15000 });
  return { pg, perr };
};
// a deviceorientation event as a browser sends it (iOS adds webkitCompassHeading, which the constructor can't set)
const orient = (pg, type, o) => pg.evaluate(([type, o]) => {
  const e = new Event(type);
  for (const k of Object.keys(o)) Object.defineProperty(e, k, { value: o[k] });
  window.dispatchEvent(e);
  return [parseFloat(document.getElementById('v1').textContent), parseFloat(document.getElementById('v2').textContent)];
}, [type, o]);
const sub = (pg) => pg.evaluate(() => document.getElementById('brandsub').textContent);

{ // Android Chrome: an absolute stream, the browser's location → true north, a position on each measurement
  const { pg, perr } = await open();
  const m0 = await pg.evaluate(() => document.getElementById('msg').textContent);
  chk(`phone browser: no "desktop" hint (${m0})`, !/desktop/.test(m0));
  await pg.waitForFunction(() => window.__wuffle.fix, null, { timeout: 5000 }).catch(() => {});
  await orient(pg, 'deviceorientationabsolute', { alpha: 0, beta: 30, gamma: 0, absolute: true });
  const st = await pg.evaluate(() => ({ fix: window.__wuffle.fix, north: document.getElementById('north').textContent, pos: document.getElementById('pos').textContent }));
  chk(`phone browser: the browser's location (${st.fix && st.fix.lat + ',' + st.fix.lon}; ${st.pos}; ${st.north})`,
    st.fix && Math.abs(st.fix.lat + 30.03) < 1e-6 && /true N · decl/.test(st.north) && /±8 m/.test(st.pos));
  const s = await sub(pg);
  chk(`phone browser: the brand line names the compass (${s})`, s === 'compass · browser · true N');
  await pg.click('#measure');
  const rec = await pg.evaluate(() => window.__wuffle.log.at(-1));
  chk(`phone browser: a measurement carries the position and true north (${rec.lat},${rec.lon} ±${rec.acc} · ${rec.north} ${rec.decl})`,
    rec.lat === -30.03 && rec.lon === -51.23 && rec.acc === 8 && rec.north === 'true' && Number.isFinite(rec.decl));
  chk(`phone browser: no page errors (${perr.join(' ; ') || 'none'})`, perr.length === 0);
  await pg.close();
}
{ // plain events only (no absolute stream): the dial keeps following them, and after a moment says there's no north
  const { pg } = await open();
  const a = await orient(pg, 'deviceorientation', { alpha: 10, beta: 20, gamma: 0, absolute: false });
  const b = await orient(pg, 'deviceorientation', { alpha: 10, beta: 40, gamma: 0, absolute: false });
  chk(`plain events keep the dial moving (dip ${a[1]} → ${b[1]})`, Math.round(a[1]) === 20 && Math.round(b[1]) === 40);
  await new Promise((r) => setTimeout(r, 1100));
  await orient(pg, 'deviceorientation', { alpha: 10, beta: 40, gamma: 0, absolute: false });
  const s1 = await sub(pg);
  await orient(pg, 'deviceorientationabsolute', { alpha: 0, beta: 40, gamma: 0, absolute: true });
  const s2 = await sub(pg);
  chk(`no north is said, and unsaid when an absolute stream arrives (${s1} → ${s2})`, s1 === 'compass · browser · no north' && /true N|magnetic N/.test(s2));
  await pg.close();
}
{ // iOS: a permission button; the heading turns into a north-referenced reading
  const { pg } = await open(() => {
    window.__asked = 0;
    DeviceOrientationEvent.requestPermission = async () => { window.__asked++; return 'granted'; };
  });
  const shown = await pg.evaluate(() => !document.getElementById('compassOn').hidden);
  await pg.click('#compassOn');
  const after = await pg.evaluate(() => ({ asked: window.__asked, hidden: document.getElementById('compassOn').hidden }));
  chk(`iOS: "enable compass" asks once and goes away (shown ${shown}, asked ${after.asked}, hidden ${after.hidden})`, shown && after.asked === 1 && after.hidden);
  // top edge pointing magnetic East (heading 90), raised 30° → the plane dips magnetic West, 270/30 (cf. 180/30 facing
  // North, check 9) — read in TRUE north once the context's location gives a declination (true = magnetic + decl)
  await pg.waitForFunction(() => /decl/.test(document.getElementById('north').textContent), null, { timeout: 5000 }).catch(() => {});
  const r = await orient(pg, 'deviceorientation', { alpha: 123, beta: 30, gamma: 0, absolute: false, webkitCompassHeading: 90 });
  const dm = (await pg.evaluate(() => document.getElementById('north').textContent)).match(/decl ([+-][\d.]+)/);
  const want = Math.round(((270 + (dm ? +dm[1] : 0)) % 360 + 360) % 360);
  chk(`iOS: the heading is north (plane ${r.join('/')} want ${want}/30 = magnetic 270 ${dm ? dm[1] : '+0'}°; ${await sub(pg)})`,
    dm && Math.abs(r[0] - want) <= 1 && Math.round(r[1]) === 30 && !/no north/.test(await sub(pg)));
  await pg.close();
}
await phone.close();

await browser.close();
server.close();
console.log(`\nwuffle-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
