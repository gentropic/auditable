// The CI-sized micro guard: does the app BOOT, built and from the dev tree?
//
// It catches packaging breaks — a lib import not wired into the registry build, a
// raw relative specifier left inside a blob module, a load-time throw — which take
// the whole app down at load and are invisible to the library tests.
//
// It deliberately draws nothing. The drawing smokes (micro-smoke, micro-smoke2, host,
// mobile, …) need a real GPU and run on a dev machine or the lab before every release
// (`npm run test:micro:all`), not on CI: CI's runner has no graphics card, renders on
// SwiftShader, and micro switches itself into software-rendering mode there.
//
//   node build.js --target=micro && node test/micro-boot-smoke.mjs

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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

if (!fs.existsSync(path.join(root, 'micro.html'))) {
  console.log('FAIL micro.html not built (run: node build.js --target=micro)');
  server.close(); process.exit(1);
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 700 } });
let ok = true;
const chk = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); ok = ok && cond; };

for (const [label, url] of [['built micro.html', '/micro.html'], ['dev tree', '/tools/micro/index.html']]) {
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  let booted = true;
  try { await p.waitForFunction(() => window._micro && window._micro.declusterWeights && window._micro.openBlob, null, { timeout: 30000 }); } catch { booted = false; }
  chk(`${label} boots (window._micro up; page errors: ${errs.length ? errs.join(' ; ') : 'none'})`, booted && errs.length === 0);
  await p.close();
}

await b.close(); server.close();
console.log(ok ? 'PASS' : 'MICRO BOOT SMOKE: FAIL');
process.exit(ok ? 0 : 1);
