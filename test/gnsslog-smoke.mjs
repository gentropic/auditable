// gnsslog smoke — (0) the BUILT gnsslog.html boots on the desktop and says it
// needs the shell; (1) the dev tree under ?bench drives the whole logger cycle
// through the real lead-acid.js shim against the bench's mocked gnss plugin:
// sky plot + fix strip from the streams, start → status ticks, stop → sealed
// card, publish → Downloads. Run: node test/gnsslog-smoke.mjs
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
const browser = await chromium.launch();
const errs = [];

// 0. the built file, desktop home
if (fs.existsSync(path.join(root, 'gnsslog.html'))) {
  const p0 = await browser.newPage();
  p0.on('pageerror', (e) => errs.push('built: ' + e));
  await p0.goto(`http://127.0.0.1:${PORT}/gnsslog.html`, { waitUntil: 'load' });
  await p0.waitForFunction(() => window.__gnsslog, null, { timeout: 15000 });
  const d = await p0.evaluate(() => ({ present: window.__gnsslog.shell.present, msg: document.getElementById('msg').textContent, disabled: document.getElementById('toggle').disabled, dots: document.querySelectorAll('#skysvg circle').length, foot: document.querySelector('.vfoot').textContent }));
  chk(`built gnsslog.html boots on the desktop: shell absent, start disabled, "${d.msg.slice(0, 40)}…", foot "${d.foot}"`,
    d.present === false && d.disabled && /needs the lead-acid shell/.test(d.msg) && !/__GNSSLOG_BUILD__/.test(d.foot) && d.dots >= 3);
  await p0.close();
} else { chk('built gnsslog.html exists (node build.js --target=gnsslog)', false); }

// 1. the dev tree under the bench
const p = await browser.newPage();
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/tools/gnsslog/index.html?bench`, { waitUntil: 'load' });
await p.waitForFunction(() => window.__gnsslog && window.__gnsslog.shell.present, null, { timeout: 15000 });
await p.waitForFunction(() => window.__gnsslog.status && window.__gnsslog.fix, null, { timeout: 10000 }).catch(() => {});
const live = await p.evaluate(() => ({
  sats: document.querySelectorAll('#skysvg circle.sat').length, bars: document.querySelectorAll('#cn0 i').length, used: document.querySelectorAll('#cn0 i.used').length,
  satsText: document.getElementById('sats').textContent, fixText: document.getElementById('fix').textContent,
}));
chk(`streams → sky plot ${live.sats} satellites, ${live.bars} C/N0 bars (${live.used} in fix), "${live.satsText}", fix "${live.fixText}"`,
  live.sats === 7 && live.bars === 7 && live.used === 7 && /7\/7 sats/.test(live.satsText) && /±5\.0 m/.test(live.fixText));

const cycle = await p.evaluate(async () => {
  const g = window.__gnsslog;
  document.getElementById('name').value = 'smoke-run';
  document.getElementById('toggle').click();
  for (let i = 0; i < 30 && !g.running; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1300));
  const stat = document.getElementById('stat').textContent, btn = document.getElementById('toggle').textContent, nameLocked = document.getElementById('name').disabled;
  document.getElementById('toggle').click();
  for (let i = 0; i < 50 && !g.sealed; i++) await new Promise((r) => setTimeout(r, 100));
  const sealedShown = document.getElementById('sealed').classList.contains('show');
  const sealedName = document.getElementById('sealedName').textContent;
  document.getElementById('publish').click();
  for (let i = 0; i < 50 && !g.lastPublish; i++) await new Promise((r) => setTimeout(r, 100));
  return { running: !!g.running, stat, btn, nameLocked, sealedShown, sealedName, bytes: g.sealed && g.sealed.bytes, publish: g.lastPublish, msg: document.getElementById('msg').textContent };
});
chk(`start → "${cycle.stat}" (button "${cycle.btn}", name locked ${cycle.nameLocked})`,
  /^logging · \d+ epochs · \d+ fixes/.test(cycle.stat) && cycle.btn === 'stop' && cycle.nameLocked);
chk(`stop → sealed card "${cycle.sealedName}" (${cycle.bytes} B) → publish ${JSON.stringify(cycle.publish && cycle.publish.uri)}; "${cycle.msg}"`,
  cycle.sealedShown && cycle.sealedName === 'smoke-run.jsonl' && cycle.bytes > 100 && cycle.publish && /smoke-run\.jsonl/.test(cycle.publish.uri) && /published smoke-run\.jsonl/.test(cycle.msg) && !cycle.running);

chk(`no page errors (${errs.length ? errs.join(' ; ') : 'none'})`, errs.length === 0);
await browser.close();
server.close();
console.log(`\ngnsslog-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
