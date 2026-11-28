// lamina, DD-60 edition — the easter egg at gentropic.org/lamina/dd60/ (tools/lamina-dd60 + ext/dd60/chrome.js).
// Dev tree and built file (node build.js --target=lamina-dd60), desktop and a phone:
//   node test/lamina-dd60-smoke.mjs [--shots <dir>]
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const d = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
let failed = 0, passed = 0;
const check = (cond, msg, detail) => { if (cond) { passed++; console.log('ok   ' + msg); } else { failed++; console.log('FAIL ' + msg + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); } };

const browser = await chromium.launch();
for (const [tag, url, vp] of [['dev', '/tools/lamina-dd60/index.html', { width: 1280, height: 900 }], ['built', '/lamina-dd60.html', { width: 1280, height: 900 }], ['phone', '/lamina-dd60.html', { width: 390, height: 844, mobile: true }]]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 3 : 1 });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}${url}`);
  await page.waitForFunction(() => window._dd60, null, { timeout: 20000 });
  const E = (fn, a) => page.evaluate(fn, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const press = async (sel) => { const b = await page.$(sel); const box = await b.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.up(); };

  check(await E(() => /no disc/.test(document.querySelector('.lcd-screen').textContent)), `[${tag}] boots to "no disc"`);
  await E(() => window._dd60.openSample()); await wait(900);
  let st = await E(() => ({ n: window._dd60.T && window._dd60.T.base.rowCount(), status: document.querySelector('.statusline').textContent, rows: document.querySelectorAll('.lgrid .r').length }));
  check(st.n === 120000 && /1\/120,000/.test(st.status) && st.rows === 15, `[${tag}] the sample: 120,000 rows, 15 on the LCD`, st);

  // the d-pad, pressed on the device
  for (let i = 0; i < 3; i++) await press('.dbtn.down');
  await press('.dbtn.right'); await press('.dbtn.right');
  st = await E(() => ({ cur: window._dd60.cur, col: window._dd60.col, hd: document.querySelector('.lgrid .hd .cc').textContent.trim() }));
  check(st.cur === 55693 && st.col === 10 && st.hd === 'Fe_pct', `[${tag}] the sample opens where the cover shows it (row 55,691, Cu_pct); the d-pad moves 3 rows, 2 columns`, st);

  // F1 FILTER: typed, YES applies a streaming scan
  await press('.pill[data-f="filter"]'); await wait(100);
  await page.fill('.ov-input', 'Cu_pct > 1 and LITO = "SULPHIDE"');
  await press('.ovl.yes'); await wait(1800);
  st = await E(() => ({ n: window._dd60.T.view.rowCount(), status: document.querySelector('.statusline').textContent }));
  check(st.n > 1000 && st.n < 20000 && /of 120,000 F/.test(st.status), `[${tag}] FILTER: Cu_pct > 1 and LITO = "SULPHIDE" → ${st.n} rows`, st);

  // F2 GO TO, typed on the device's keys in 123 mode (W E → 2 3)
  await press('.pill[data-f="goto"]'); await wait(80);
  await press('.key[data-k="W"]'); await press('.key[data-k="E"]');
  await press('.ovl.yes'); await wait(150);
  st = await E(() => ({ cur: window._dd60.cur }));
  check(st.cur === 22, `[${tag}] GO TO keyed on the device in 123 mode (W E → 23)`, st);

  // F3 RAW: the row's line as the file has it
  await press('.pill[data-f="raw"]'); await wait(400);
  st = await E(() => ({ title: document.querySelector('.ov-title').textContent, raw: document.querySelector('.ov-raw').textContent }));
  check(/^RAW · ROW [\d,]+ · BYTE [\d,]+/.test(st.title) && /SULPHIDE/.test(st.raw) && st.raw.split(',').length === 16, `[${tag}] RAW: the row's line, 16 fields, with its byte offset`, st.title);
  await press('.ovl.no'); await wait(80);

  // F4 STATS on Cu_pct (column 9), over the filtered rows
  await E(() => { window._dd60.render(); });
  for (let i = 0; i < 2; i++) await press('.dbtn.left');   // back to Cu_pct
  await press('.pill[data-f="stats"]'); await wait(1500);
  st = await E(() => ({ title: document.querySelector('.ov-title').textContent, rows: [...document.querySelectorAll('.ov-row')].map((r) => r.textContent) }));
  const min = st.rows.find((r) => r.startsWith('min'));
  check(/STATS · Cu_pct · FILTERED/.test(st.title) && min && parseFloat(min.slice(3)) > 1, `[${tag}] STATS: Cu_pct over the filtered rows, min > 1`, st);
  await press('.ovl.no'); await wait(80);

  // YES on a row: every field; B-MARK
  await press('.ovl.yes'); await wait(100);
  const rec = await E(() => document.querySelectorAll('.ov-row').length);
  check(rec === 16, `[${tag}] YES on a row lists its 16 fields`, rec);
  await press('.ovl.no'); await press('.pill.bmark'); await wait(100);
  check(await E(() => window._dd60.T.marks.size === 1 && !!document.querySelector('.lgrid .r.cur .bm')), `[${tag}] B-MARK marks the row`);

  // a real file, streamed (CRLF, a quoted field), any size
  await E(async () => {
    const rows = ['a,b,c']; for (let i = 0; i < 50000; i++) rows.push(`${i},"x,${i % 7}",${(i * 0.37).toFixed(2)}`);
    await window._dd60.openFile(new File([rows.join('\r\n') + '\r\n'], 'big.csv'));
  });
  await wait(800);
  st = await E(() => ({ n: window._dd60.T.base.rowCount(), status: document.querySelector('.statusline').textContent }));
  check(st.n === 50000 && /big\.csv/.test(st.status), `[${tag}] a 50,000-row file streamed in (quoted commas, CRLF)`, st);

  if (vp.mobile) {
    const m = await E(() => { const d = document.querySelector('.dd8').getBoundingClientRect(); const k = document.querySelector('.key').getBoundingClientRect(); return { right: d.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, key: Math.round(k.width) }; });
    check(!m.overflow && m.right <= m.width + 1 && m.key >= 28, `[${tag}] fits the phone's width, no sideways scroll; keys ${m.key} px`, m);
  }
  if (SHOTS) { await E(() => window._dd60.openSample()); await wait(800); await page.screenshot({ path: `${SHOTS}/dd60-${tag}.png`, fullPage: true }); }
  if (tag !== 'dev') check(!requests.length, `[${tag}] no network requests`, requests);
  check(!errors.length, `[${tag}] no page errors`, errors);
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\nLAMINA DD-60 SMOKE: ${failed ? 'FAIL' : 'PASS'} (${passed} passed, ${failed} failed)`);
process.exit(failed ? 1 : 0);
