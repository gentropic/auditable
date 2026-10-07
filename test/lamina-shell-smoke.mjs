// lamina inside the lead-acid shell (POSTURE A) — the desktop guard. The dev tree
// under ?bench runs shell-style against the mocked plugins: a file "shared to
// lamina" arrives as an fs token, the shim's fileBlob makes it Blob-shaped, and
// openFile indexes it in RANGES (inline — a ranged blob can't cross to a worker);
// an export is PUBLISHED to Downloads and offered to share. The built file is
// checked for what the shell relies on: the shim bundled, the bench stripped, the
// CSP STILL `connect-src 'none'` (opening it to 'self' is the shell's act).
// Run: node test/lamina-shell-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let pass = 0, fail = 0;
const chk = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); ok ? pass++ : fail++; };

if (fs.existsSync(path.join(root, 'lamina.html'))) {
  const built = fs.readFileSync(path.join(root, 'lamina.html'), 'utf8');
  chk(`built lamina.html: shim bundled ${/"leadacid":/.test(built)}, bench stripped ${!/bench\.js/.test(built)}, CSP still connect-src 'none' ${/connect-src 'none'/.test(built)}`,
    /"leadacid":/.test(built) && !/bench\.js/.test(built) && /connect-src 'none'/.test(built));
} else chk('built lamina.html exists (node build.js --target=lamina)', false);

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://127.0.0.1:${server.address().port}/tools/lamina/index.html?bench`, { waitUntil: 'load' });
await p.waitForFunction(() => window._lamina && window._lamina.shell && window._lamina.shell.present, null, { timeout: 30000 });

// 1. a csv shared INTO lamina: 5,000 rows through fileBlob, indexed in ranges, a deep row resolves
const first = await p.evaluate(async () => {
  const rows = ['id,grade,lito']; for (let i = 0; i < 5000; i++) rows.push(`${i},${(Math.sin(i) * 2 + 2).toFixed(3)},${i % 3 ? 'OXIDE' : 'FRESH'}`);
  const bytes = new TextEncoder().encode(rows.join('\n') + '\n');
  window.__bench.files['assays.csv'] = bytes;
  window.__bench.intake([{ kind: 'file', token: 'assays.csv', name: 'assays.csv', size: bytes.length, mime: 'text/csv' }]);
  for (let i = 0; i < 100 && !(window._laminaVS && window._laminaVS.rowCount() === 5000); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  const vs = window._laminaVS; await vs.ensureRow(4321); const deep = vs.rowAt(4321);
  return { rows: vs.rowCount(), cols: vs.cols, deep: Array.isArray(deep) ? deep[0] : String(deep), scan: window._lamina.lastScan, name: document.getElementById('fileName').textContent, title: document.getElementById('fileName').title, meta: document.getElementById('meta').textContent };
});
chk(`a csv shared into lamina opens windowed: ${first.rows} rows × ${first.cols} cols, row 4321 → ${first.deep}, scan ${first.scan}; "${first.meta.slice(0, 90)}"; title "${first.title}"`,
  first.rows === 5000 && first.cols === 3 && first.deep === '4321' && first.scan === 'inline' && first.name === 'assays.csv' && /opened from the shell/.test(first.title));

// 2. the REAL export dialog run: its sink STREAMS into Downloads through the shell
// (no save picker — the WebView's aborts), then the footer offers to share by uri
const out = await p.evaluate(async () => {
  const text = await window._lamina.exportToString({});
  window._lamina.openExportDialog();
  await window._lamina.doExport();
  for (let i = 0; i < 100 && !/✓/.test(document.getElementById('exProgress').textContent); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  const pub = window.__bench.published.map((e) => ({ name: e.name, collection: e.collection, mime: e.mime, n: e.bytes.length, chunks: e.chunks, same: new TextDecoder().decode(e.bytes) === text }));
  const btn = document.querySelector('#meta button.meta-act'); if (btn) btn.click();
  await new Promise((r) => setTimeout(r, 200));
  return { pub, lines: text.split('\n').length, progress: document.getElementById('exProgress').textContent, shared: window.__bench.shared.map((e) => ({ name: e.name, uri: e.uri, bytes: e.bytes ? e.bytes.length : null })), meta: document.getElementById('meta').textContent };
});
chk(`the export dialog STREAMS to Downloads + shares by uri: ${JSON.stringify(out.pub)} (${out.lines} lines; "${out.progress}"), shared ${JSON.stringify(out.shared)}`,
  out.pub.length === 1 && out.pub[0].name === 'assays.csv' && out.pub[0].collection === 'Downloads' && out.pub[0].same && out.lines >= 5001 && /✓/.test(out.progress)
  && out.shared[0].name === 'assays.csv' && out.shared[0].uri === 'bench://Downloads/assays.csv' && out.shared[0].bytes === null && /saved assays\.csv → Downloads/.test(out.meta));

chk(`no page errors (${errs.length ? errs.slice(0, 2).join(' ; ') : 'none'})`, errs.length === 0);
await browser.close(); server.close();
console.log(`\nlamina-shell-smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
