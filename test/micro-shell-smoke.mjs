// micro inside the lead-acid shell (POSTURE A) — the desktop guard. The dev tree
// under ?bench runs shell-style against the mocked plugins: a file "shared to
// micro" arrives as an fs token, the shim's fileBlob makes it Blob-shaped, and
// openBlob reads it in RANGES into a layer (first = replace, next = add). The
// built file is checked for what the shell relies on: the shim module bundled,
// the dev bench stripped, and the CSP STILL `connect-src 'none'` in the file —
// opening it to 'self' is the shell's serve-time act, never the artifact's.
// Run: node test/micro-shell-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
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

// 0. the built file: shim bundled, bench stripped, CSP untouched
if (fs.existsSync(path.join(root, 'micro.html'))) {
  const built = fs.readFileSync(path.join(root, 'micro.html'), 'utf8');
  chk(`built micro.html: shim module bundled ${/"leadacid":/.test(built)}, dev bench stripped ${!/bench\.js/.test(built)}, CSP still connect-src 'none' ${/connect-src 'none'/.test(built)}`,
    /"leadacid":/.test(built) && !/bench\.js/.test(built) && /connect-src 'none'/.test(built));
} else chk('built micro.html exists (node build.js --target=micro)', false);

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const p = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/tools/micro/index.html?bench`, { waitUntil: 'load' });
await p.waitForFunction(() => window._micro && window._micro.shell && window._micro.shell.present, null, { timeout: 30000 });

// 1. share a block model INTO micro: a 12×10×4 lattice csv as an fs token → a blocks layer, read in ranges
const first = await p.evaluate(async () => {
  const rows = ['x,y,z,fe'];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 12; i++) rows.push(`${1000 + i * 10},${2000 + j * 10},${100 + k * 5},${(30 + i + j + k * 2).toFixed(1)}`);
  const csv = rows.join('\n') + '\n';
  const bytes = new TextEncoder().encode(csv);
  window.__bench.files['deposit.csv'] = bytes;
  const reads0 = (window.__benchFsReads = window.__benchFsReads || 0);
  window.__bench.intake([{ kind: 'file', token: 'deposit.csv', name: 'deposit.csv', size: bytes.length, mime: 'text/csv' }]);
  for (let i = 0; i < 100 && !(window._micro.layers().length >= 1 && window._micro.layers()[0].header); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 600));
  const L = window._micro.layers()[0];
  return { n: window._micro.layers().length, kind: L && L.kind, count: L && window._micro.attrRowCountOf(L), meta: document.getElementById('meta').textContent, size: bytes.length };
});
chk(`a csv shared into micro opens as a layer: ${first.n} layer(s), kind ${first.kind}, ${first.count} records (${first.size} B through fileBlob); "${first.meta}"`,
  first.n === 1 && first.kind === 'blocks' && first.count === 480 && /opened deposit\.csv from the shell/.test(first.meta));

// 2. a second file ADDS a layer (the scene is not replaced)
const second = await p.evaluate(async () => {
  const rows = ['x,y,z,au']; for (let i = 0; i < 50; i++) rows.push(`${1500 + i * 3},${2200 + (i % 7) * 4},${90 + (i % 5)},${(0.5 + i / 50).toFixed(2)}`);
  const bytes = new TextEncoder().encode(rows.join('\n') + '\n');
  window.__bench.files['pegs.xyz'] = bytes;
  window.__bench.intake([{ kind: 'file', token: 'pegs.xyz', name: 'pegs.xyz', size: bytes.length, mime: 'application/octet-stream' }]);
  for (let i = 0; i < 100 && window._micro.layers().length < 2; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  return { n: window._micro.layers().length, kinds: window._micro.layers().map((l) => l.kind) };
});
chk(`a second shared file ADDS a layer: ${second.n} layers (${second.kinds.join(', ')})`, second.n === 2 && second.kinds[0] === 'blocks');

// 3. a share that reaches a RUNNING instrument: Android pauses the activity first
// (onPause → onNewIntent → onResume) and onPause closes every push stream — the
// shim must bring the intake stream back by itself, or the shared file is lost
// (found on device 2026-10-07: the item sat in the plugin's queue forever).
const third = await p.evaluate(async () => {
  window.__bench.pause();                       // what onPause does: close every stream
  await new Promise((r) => setTimeout(r, 150)); // the shim's reopen is a macrotask away
  const rows = ['x,y,z,cu']; for (let i = 0; i < 30; i++) rows.push(`${1200 + i * 5},${2300 + (i % 6) * 5},${110 + (i % 3)},${(0.2 + i / 60).toFixed(2)}`);
  const bytes = new TextEncoder().encode(rows.join('\n') + '\n');
  window.__bench.files['late.csv'] = bytes;
  window.__bench.intake([{ kind: 'file', token: 'late.csv', name: 'late.csv', size: bytes.length, mime: 'text/csv' }]);
  for (let i = 0; i < 100 && window._micro.layers().length < 3; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  return { n: window._micro.layers().length, meta: document.getElementById('meta').textContent };
});
chk(`a file shared AFTER a pause (stream closed by the shell) still lands: ${third.n} layers; "${third.meta}"`, third.n === 3 && /opened late\.csv from the shell/.test(third.meta));

chk(`no page errors (${errs.length ? errs.slice(0, 2).join(' ; ') : 'none'})`, errs.length === 0);
await browser.close();
server.close();
console.log(`\nmicro-shell-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
