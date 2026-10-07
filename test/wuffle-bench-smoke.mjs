// bench smoke — drives the DEV tree with ?bench and proves the desktop bench
// (ext/leadacid/bench.js) mocks /native faithfully through the real lead-acid.js
// shim: feature-detect, push streams, body sidecar, and each mocked plugin.
// This is what lets instruments develop on the desktop with no phone.
// Run: node test/wuffle-bench-smoke.mjs
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

// a fake camera (a moving test pattern) so the viewfinder + capture run headless
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/tools/wuffle/index.html?bench`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__wuffle && window.__wuffle.shell, null, { timeout: 15000 });

// 1. the bench installed + the shim feature-detects it (shell.present === true)
const active = await p.evaluate(() => ({ bench: !!window.__bench, present: window.__wuffle.shell.present }));
chk(`bench active + shell.present true (bench ${active.bench}, present ${active.present})`, active.bench && active.present);

// 2. shell/info + keepAwake round-trip through the mocked request/reply lane
const info = await p.evaluate(async () => {
  const v = await window.__wuffle.shell.version();
  const k = await (await window.__wuffle.shell.native('shell/keepawake?on=true', { method: 'POST' })).json();
  return { v, ok: k.ok };
});
chk(`shell/info + keepawake (version ${info.v}, keepawake ${info.ok})`, info.v === 'bench' && info.ok === true);

// 3. push stream: open the mocked sensor stream, collect events over the port
const streamed = await p.evaluate(async () => {
  const times = [];
  const s = await window.__wuffle.shell.stream('sensor/stream?types=rotation&rateHz=30');
  s.on('rotation', () => times.push(performance.now()));
  await new Promise(r => setTimeout(r, 800));
  s.close();
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { n: times.length, max: gaps.length ? Math.max(...gaps) : 0 };
});
chk(`push stream delivers over the port (${streamed.n} events/0.8s, max gap ${streamed.max.toFixed(0)}ms)`,
  streamed.n > 10 && streamed.max < 150);

// 3b. wuffle v2: shell.orientation turns the bench's synthetic rotation vector
// (a tilt of 0.3 ± 0.2 rad about a horizontal axis) into W3C alpha/beta/gamma,
// and wuffle itself rides the fused stream with the compass accuracy shown.
const fused = await p.evaluate(async () => {
  const o = await window.__wuffle.shell.orientation({ rateHz: 30 });
  const readings = [];
  o.on((r) => readings.push(r));
  await new Promise(r => setTimeout(r, 400));
  o.close();
  const D = Math.PI / 180;
  const tilts = readings.map((r) => Math.acos(Math.cos(r.beta * D) * Math.cos(r.gamma * D)) / D);
  const w = window.__wuffle;
  return {
    n: readings.length,
    finite: readings.every((r) => [r.alpha, r.beta, r.gamma].every(Number.isFinite)),
    absolute: readings[0] && readings[0].absolute, acc: readings[0] && readings[0].accuracy,
    tiltMin: Math.min(...tilts), tiltMax: Math.max(...tilts),
    source: w.source, wAcc: w.accuracy, d1: w.reading && w.reading.d1, sub: document.getElementById('brandsub').textContent,
  };
});
chk(`fused orientation: ${fused.n} readings, finite ${fused.finite}, absolute ${fused.absolute}, acc ${fused.acc}, tilt ${fused.tiltMin.toFixed(1)}–${fused.tiltMax.toFixed(1)}° (bench 5.7–28.6°); wuffle rides it (source ${fused.source}, "${fused.sub}", dip dir ${fused.d1 && fused.d1.toFixed(0)})`,
  fused.n > 5 && fused.finite && fused.absolute === true && fused.acc === 3
  && fused.tiltMin > 5 && fused.tiltMax < 29 && fused.source === 'fused' && fused.wAcc === 3
  && /fused · high/.test(fused.sub) && Number.isFinite(fused.d1));

// 4. body sidecar + attest: sign through the port body-sidecar, verify w/ WebCrypto
const signed = await p.evaluate(async () => {
  const payload = new TextEncoder().encode('bench attest test');
  const r = await window.__wuffle.shell.attest.sign(payload);
  const dec = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', dec(r.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, dec(r.sig), payload);
  const bad = new Uint8Array(payload); bad[0] ^= 1;
  const okBad = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, dec(r.sig), bad);
  return { ok, okBad, security: r.security };
});
chk(`body sidecar + attest sign/verify (valid ${signed.ok}, tampered-rejected ${!signed.okBad}, ${signed.security})`,
  signed.ok && !signed.okBad);

// 4b. publish signs the log: the .sig sidecar verifies with WebCrypto against the exact bytes
const pub = await p.evaluate(async () => {
  const w = window.__wuffle;
  w.plot(45, 30, 'plane');
  document.getElementById('publish').click();
  for (let i = 0; i < 50 && !w.lastPublish; i++) await new Promise(r => setTimeout(r, 100));
  const lp = w.lastPublish;
  if (!lp || !lp.signed) return { signed: false };
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', b64(lp.signed.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64(lp.signed.sig), lp.bytes);
  const tampered = new Uint8Array(lp.bytes); tampered[0] ^= 1;
  const okBad = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64(lp.signed.sig), tampered);
  return { signed: true, ok, okBad, security: lp.signed.security, msg: document.getElementById('msg').textContent };
});
chk(`publish → attest-signed .sig sidecar verifies against the log bytes (valid ${pub.ok}, tampered-rejected ${pub.okBad === false}, ${pub.security}; "${pub.msg}")`,
  pub.signed && pub.ok === true && pub.okBad === false && /\+ \.sig/.test(pub.msg));

// 4c. intake: a csv "shared" to wuffle reloads into the log (share's inbound twin)
const taken = await p.evaluate(async () => {
  const w = window.__wuffle; const before = w.count();
  const csv = 'type,dip_dir_or_trend,dip_or_plunge,strike,timestamp\nplane,120,35,30,2026-10-07T00:00:00Z\nline,250,12,,2026-10-07T00:00:01Z\n';
  window.__bench.files['log.csv'] = new TextEncoder().encode(csv);
  window.__bench.intake([{ kind: 'file', token: 'log.csv', name: 'log.csv', size: csv.length, mime: 'text/csv' }]);
  for (let i = 0; i < 30 && w.count() < before + 2; i++) await new Promise((r) => setTimeout(r, 100));
  const last = w.log[w.log.length - 1];
  return { before, after: w.count(), last, msg: document.getElementById('msg').textContent };
});
chk(`intake: a shared csv reloads into the log (${taken.before} → ${taken.after}, last ${taken.last && taken.last.mode} ${taken.last && taken.last.d1}→${taken.last && taken.last.d2}; "${taken.msg}")`,
  taken.after === taken.before + 2 && taken.last && taken.last.mode === 'line' && taken.last.d1 === 250 && /loaded 2 measurements from log\.csv/.test(taken.msg));

// 4d. gnss: the bench fix stamps a measurement with lat/lon (+ it round-trips through the csv columns)
const pos = await p.evaluate(async () => {
  const w = window.__wuffle;
  for (let i = 0; i < 30 && !w.fix; i++) await new Promise((r) => setTimeout(r, 100));
  w.plot(200, 45, 'plane');
  const e = w.log[w.log.length - 1];
  return { fix: w.fix, lat: e.lat, lon: e.lon, acc: e.acc, badge: document.getElementById('pos').textContent };
});
chk(`gnss: a measurement is georeferenced (${pos.lat}, ${pos.lon} ±${pos.acc} m; badge "${pos.badge}")`,
  pos.fix && Math.abs(pos.lat - -23.52) < 0.001 && Math.abs(pos.lon - -46.19) < 0.001 && pos.acc === 5 && pos.badge === '±5 m');

// 4e. true north: the fix feeds @gcu/wmm; the label carries the declination and the log says 'true'
const north = await p.evaluate(() => {
  const w = window.__wuffle;
  const e = w.log[w.log.length - 1];
  return { label: document.getElementById('north').textContent, north: e.north, decl: e.decl };
});
chk(`true north via WMM at the bench fix (label "${north.label}", reading north=${north.north}, decl ${north.decl})`,
  /^true N · decl -2\d\.\d°$/.test(north.label) && north.north === 'true' && north.decl < -20 && north.decl > -24);

// 4f. camera: the viewfinder opens on the fake device, capture attaches a jpeg to the last station
const shot = await p.evaluate(async () => {
  const w = window.__wuffle;
  const opened = await w.openCamera();
  const v = document.getElementById('camv');
  for (let i = 0; i < 50 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
  const blob = await w.snapPhoto();
  const shotW = w.lastShot ? w.lastShot.width : 0;
  w.closeCamera();
  const m = w.log[w.log.length - 1];
  return { opened, w: shotW, size: blob ? blob.size : 0, type: blob && blob.type, name: m.photo, mark: !!document.querySelector('#list li .pic'), hidden: document.getElementById('cam').hidden };
});
chk(`camera: viewfinder ${shot.w}px wide, capture → ${shot.type} ${shot.size} B attached as ${shot.name} (row marked ${shot.mark}, viewfinder closed ${shot.hidden})`,
  shot.opened && shot.w > 0 && shot.size > 1000 && shot.type === 'image/jpeg' && /^wuffle-\d{3}-.*\.jpg$/.test(shot.name || '') && shot.mark && shot.hidden);

// 4g. the gnss logger through the shim: start, status grows, a second start is 409, stop seals a readable file
const logged = await p.evaluate(async () => {
  const g = window.__wuffle.shell.gnss.log;
  const st = await g.start({ what: ['raw', 'location'], name: 'smoke' });
  await new Promise((r) => setTimeout(r, 450));
  const mid = await g.status();
  let second = null; try { await g.start({ name: 'other' }); } catch (e) { second = e.status; }
  const done = await g.stop();
  const text = new TextDecoder().decode(await done.source.arrayBuffer());
  const lines = text.trim().split('\n');
  return { started: st.name, running: mid.running, epochs: mid.epochs, second, stopped: !done.running, token: done.token, bytes: done.bytes, first: lines[0], last: lines[lines.length - 1], n: lines.length };
});
chk(`gnss logger: start "${logged.started}" → running ${logged.running} with ${logged.epochs} epochs → second start ${logged.second} → stop seals ${logged.token} (${logged.bytes} B, ${logged.n} lines: ${logged.first.slice(0, 16)}… ${logged.last.slice(0, 14)}…)`,
  logged.started === 'smoke' && logged.running === true && logged.epochs >= 3 && logged.second === 409 && logged.stopped && logged.token === 'gnss-log-smoke'
  && logged.bytes > 100 && /^\{"kind":"start"/.test(logged.first) && /^\{"kind":"stop"/.test(logged.last));

// 5. fs ranged read from a fixture (set via __benchFixtures before load would be
//    ideal; here we drive the route directly with a token we inject at runtime)
const ranged = await p.evaluate(async () => {
  // inject a pattern fixture: byte[i] = i mod 251
  const n = 4096, buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = i % 251;
  window.__bench.fixtures.files['t.bin'] = buf;
  const src = window.__wuffle.shell.fileSource('t.bin', n);
  const slice = await src.readRange(1000, 64);
  let okBytes = slice.length === 64;
  for (let i = 0; i < 64; i++) if (slice[i] !== (1000 + i) % 251) okBytes = false;
  return { okBytes, len: slice.length };
});
chk(`fs ranged read from fixture (len ${ranged.len}, pattern ${ranged.okBytes})`, ranged.okBytes);

// 6. no page errors through all of it
chk(`no page errors (${errs.length ? errs.join(' ; ') : 'none'})`, errs.length === 0);

await browser.close();
server.close();
console.log(`\nwuffle-bench-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
