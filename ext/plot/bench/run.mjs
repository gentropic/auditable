// Run the @gcu/plot bench in headless Chromium.
//   node ext/plot/bench/run.mjs [--label NAME] [--entry /ext/plot/src/api.js] [--only case,case] [--runs 3]
// Each case × mode runs in a fresh page (so one case's heap and caches don't colour the next),
// three times by default; the MEDIAN is reported. Results go to bench/results/<label>.json;
// `node ext/plot/bench/table.mjs` turns them into BENCH.md.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label', 'current');
const entry = arg('entry', '/ext/plot/index.js');   // the shipped bundle; --entry /ext/plot/src/api.js for the sources
const runs = +arg('runs', 3);
const TIMEOUT = 90000;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><body></body>'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const { CASES } = await import('./cases.js');
const names = (arg('only', '') || Object.keys(CASES).join(',')).split(',');
const browser = await chromium.launch();
const out = { label, entry, at: new Date().toISOString(), machine: `${os.cpus()[0].model.trim()} · ${os.cpus().length} threads · ${Math.round(os.totalmem() / 2 ** 30)} GiB`, chromium: browser.version(), results: {} };

const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
for (const name of names) {
  for (const mode of ['canvas', 'record']) {
    const samples = [];
    let note = null;
    for (let k = 0; k < runs && !note; k++) {
      const page = await browser.newPage();
      const warns = [];
      page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
      await page.goto(base + '/__blank');
      try {
        const r = await Promise.race([
          page.evaluate(async ({ entry, name, mode }) => {
            const t0 = performance.now(); const P = await import(entry); const importMs = performance.now() - t0;
            const { CASES } = await import('/ext/plot/bench/cases.js');
            try { const r = await CASES[name](P, mode); if (name === 'trivial' && r.first != null) r.first += importMs; return r; } catch (e) { return { error: `${e.name}: ${e.message}`.slice(0, 120) }; }
          }, { entry, name, mode }),
          new Promise((res) => setTimeout(() => res({ error: `timeout > ${TIMEOUT / 1000} s` }), TIMEOUT)),
        ]);
        if (r.na) note = 'n/a: ' + r.na;
        else if (r.error) note = r.error;
        else samples.push(r);
      } catch (e) { note = String(e.message).split('\n')[0].slice(0, 120); }
      await page.close().catch(() => {});
    }
    const res = note ? { note } : {
      first: median(samples.map((s) => s.first)),
      again: samples[0].again != null ? median(samples.map((s) => s.again)) : null,
      ops: samples[0].ops ?? null,
    };
    out.results[`${name}/${mode}`] = res;
    console.log(`${name.padEnd(14)} ${mode.padEnd(7)} ${res.note || `first ${res.first.toFixed(1)} ms${res.again != null ? `  again ${res.again.toFixed(res.again < 1 ? 3 : 1)} ms` : ''}${res.ops != null ? `  (${res.ops} ops)` : ''}`}`);
  }
}
await browser.close();
server.close();
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', `${label}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(`→ bench/results/${label}.json`);
