// lamina — Apache Parquet as a table + the host API (window.lamina). Boots the dev
// tree AND the built lamina.html in headless Chromium over loopback HTTP:
//   · a 200k-row Parquet (7 row groups; INT64 ids, a WIDE INT64, strings, booleans)
//     opens from a File (range reads) and from bytes, typed by its footer;
//   · a filter skips the row groups whose footer min/max can't match;
//   · the API: info / columns / rows / row / filter / sort / stats / groupBy /
//     gradeTonnage / calc columns / lens round trip / export / select + events /
//     setColumn / orderColumns / rejections / the iframe ready event + ?embed=1.
// Not in `npm test` (needs a browser): node test/lamina-host-smoke.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeParquet } from '../ext/parquet/index.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  // a bare host page that embeds lamina
  if (u.startsWith('/__host')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>host</title><body></body>'); return; }
  const f = path.join(repo, u);
  if (!f.startsWith(repo) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
let pass = true;
const chk = (name, c) => { console.log(`${c ? 'ok ' : 'FAIL'} ${name}`); pass = pass && !!c; };

// the fixture: AU rises with the row, so a high cut lives in the last row group only
const N = 200000, RG = 32768;
const ID = [], BIG = [], AU = [], CU = [], LITO = [], OXI = [];
for (let i = 0; i < N; i++) {
  ID.push(BigInt(i)); BIG.push(2n ** 60n + BigInt(i)); AU.push(i * 0.01); CU.push((i % 100) / 10);
  LITO.push(['ox', 'sulf', 'trans'][i % 3]); OXI.push(i % 2 === 0);
}
const pq = new Uint8Array(writeParquet({ rowGroupSize: RG, columnData: [
  { name: 'ID', data: ID, type: 'INT64' }, { name: 'BIG', data: BIG, type: 'INT64' },
  { name: 'AU', data: AU, type: 'DOUBLE' }, { name: 'CU', data: CU, type: 'DOUBLE' },
  { name: 'LITO', data: LITO, type: 'STRING' }, { name: 'OXI', data: OXI, type: 'BOOLEAN' },
] }));
const groups = Math.ceil(N / RG);

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();

async function run(url, label) {
  console.log(`── ${label}`);
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.lamina && window.lamina.ready, null, { timeout: 15000 });
  const bytesHandle = await page.evaluateHandle((a) => new Uint8Array(a), [...pq]);

  const r = await page.evaluate(async (bytes) => {
    const L = window.lamina, out = {}, ev = { opened: [], failed: [], sel: [], filter: [] };
    addEventListener('lamina:opened', (e) => ev.opened.push(e.detail));
    addEventListener('lamina:open-failed', (e) => ev.failed.push(e.detail));
    addEventListener('lamina:selection', (e) => ev.sel.push(e.detail));
    out.version = L.version;
    out.noTable = L.info();
    try { L.columns(); out.noTableCols = 'accepted'; } catch (e) { out.noTableCols = e.message; }
    // ── Parquet from a File: range reads, typed by the footer
    const t0 = performance.now();
    out.info = await L.open(new File([bytes], 'model.parquet'));
    out.openMs = performance.now() - t0;
    out.badge = document.querySelector('#kindBadge').textContent;
    out.cols = L.columns();
    const t1 = performance.now();
    out.deep = await L.rows(150000, 3);
    out.deepMs = performance.now() - t1;
    out.row7 = await L.row(7);
    // ── a filter skips the row groups that can't match
    out.f = await L.filter('AU >= 1990');
    out.skipped = window._lamina.current.source.skipped;
    out.fInfo = L.info();
    out.fRows = await L.rows(0, 2, { columns: ['ID', 'AU'] });
    out.stats = await L.stats('AU');
    out.gb = await L.groupBy({ by: 'LITO', values: ['AU'] });
    out.gt = await L.gradeTonnage({ by: 'LITO', grades: ['CU'], volume: '10', density: '2.5' });
    out.sort = await L.sort([{ column: 'au', desc: true }]);
    out.sorted = await L.rows(0, 2, { columns: ['ID'] });
    // ── calc columns + the lens round trip
    out.calc = await L.addCalc('AU2', 'AU * 2');
    out.calcRow = (await L.rows(0, 1, { columns: ['AU', 'AU2'] })).rows[0];
    out.lens = L.lens();
    await L.clearFilter(); await L.sort(null); await L.removeCalc('AU2');
    out.cleared = L.info();
    out.applied = await L.applyLens(out.lens);
    out.reapplied = L.info();
    // ── export the view
    const blob = await L.export({ columns: ['ID', 'AU'] });
    const txt = await blob.text();
    out.exp = { type: blob.type, lines: txt.trim().split('\n').length, head: txt.split('\n').slice(0, 2) };
    // ── select + the selection event
    const n0 = ev.sel.length;
    out.sel = await L.select({ from: 2, to: 4, columns: ['ID', 'BIG'] });
    await new Promise((res) => setTimeout(res, 0));
    out.selEv = ev.sel.slice(n0);
    // ── columns: hide, type, order
    out.hid = await L.setColumn('cu', { hidden: true });
    out.typed = await L.setColumn('ID', { type: 'string' });
    out.order = await L.orderColumns(['LITO', 'ID']);
    // ── rejections
    const rej = async (p) => { try { await p; return 'accepted'; } catch (e) { return e.message; } };
    out.rej = {
      badFilter: await rej(L.filter('NOPE > 1')),
      badCol: await rej(L.stats('NOPE')),
      badRow: await rej(L.row(10 ** 9)),
      takenCalc: await rej(L.addCalc('AU', '1')),
      binary: await rej(L.open(new File([new Uint8Array([0, 1, 2, 3, 0, 0, 255, 254, 0, 7])], 'blob.bin'))),
      notLens: await rej(L.applyLens({})),
    };
    // ── Parquet from resident bytes (an archive entry / the bytes door)
    out.fromBytes = await L.open(bytes.slice(), { name: 'again.parquet' });
    out.ev = { opened: ev.opened.map((o) => [o.name, o.format, o.rows]), failed: ev.failed.map((f) => f.name) };
    return out;
  }, bytesHandle);

  chk(`no table: info() → ${JSON.stringify(r.noTable)}, columns() throws (${r.noTableCols}); version ${r.version}`, r.noTable === null && /no table/.test(r.noTableCols) && r.version === 1);
  chk(`open(File .parquet) → ${JSON.stringify(r.info)} in ${r.openMs.toFixed(0)} ms, badge “${r.badge}”`,
    r.info.format === 'parquet' && r.info.rows === N && r.info.columns.join() === 'ID,BIG,AU,CU,LITO,OXI' && r.badge === 'parquet');
  chk(`footer types: ${r.cols.map((c) => c.name + ':' + c.type).join(' ')} (INT64 → number; a wide INT64 → string)`,
    r.cols.map((c) => c.type).join() === 'number,string,number,number,string,string');
  chk(`rows(150000, 3) deep in a row group → ids ${r.deep.rows.map((x) => x[0])}, BIG ${r.deep.rows[0][1]} (exact), ${r.deepMs.toFixed(0)} ms; row(7) ${JSON.stringify(r.row7)}`,
    r.deep.rows.map((x) => x[0]).join() === '150000,150001,150002' && r.deep.rows[0][1] === (2n ** 60n + 150000n).toString() && JSON.stringify(r.deep.records) === '[150000,150001,150002]'
    && r.row7.ID === 7 && r.row7.LITO === 'sulf' && r.row7.OXI === 'false' && Math.abs(r.row7.AU - 0.07) < 1e-12);
  chk(`filter AU >= 1990 → ${JSON.stringify(r.f)}; ${r.skipped} of ${groups} row groups skipped by their footer`, r.f.matched === 1000 && r.f.total === N && r.skipped === groups - 1 && r.fInfo.filter === 'AU >= 1990' && r.fInfo.rows === 1000);
  chk(`filtered rows carry their file records: ${JSON.stringify(r.fRows)}`, JSON.stringify(r.fRows.records) === '[199000,199001]' && r.fRows.rows[0][0] === 199000);
  chk(`stats('AU') over the filter → n ${r.stats.n}, min ${r.stats.min}, max ${r.stats.max}`, r.stats.n === 1000 && Math.abs(r.stats.min - 1990) < 1e-9 && Math.abs(r.stats.max - 1999.99) < 1e-6);
  chk(`groupBy LITO → ${r.gb.groups.map((g) => g.key + ':' + g.count).join(' ')}, total ${r.gb.total.count}, AU mean ${r.gb.total.values.AU.mean.toFixed(3)}`,
    r.gb.by === 'LITO' && r.gb.groups.length === 3 && r.gb.total.count === 1000 && Math.abs(r.gb.total.values.AU.mean - 1994.995) < 1e-6);
  chk(`gradeTonnage by LITO, CU, 10 m³ × 2.5 t/m³ → total ${r.gt.total.tonnes} t, CU ${r.gt.total.grades.CU.grade.toFixed(3)}`,
    r.gt.total.tonnes === 1000 * 25 && r.gt.groups.length === 3 && Math.abs(r.gt.total.grades.CU.grade - 4.95) < 1e-9);
  chk(`sort AU desc → ${JSON.stringify(r.sort)}, first ids ${r.sorted.rows.map((x) => x[0])}`, r.sort[0].column === 'AU' && r.sort[0].desc && r.sorted.rows[0][0] === 199999);
  chk(`addCalc AU2 → ${JSON.stringify(r.calc)}, row ${JSON.stringify(r.calcRow)}`, r.calc.calc && r.calc.expr === 'AU * 2' && r.calc.type === 'number' && Math.abs(r.calcRow[1] - 2 * r.calcRow[0]) < 1e-9);
  chk(`lens round trip: cleared ${JSON.stringify([r.cleared.filter, r.cleared.sort, r.cleared.columns.length])} → re-applied ${JSON.stringify([r.reapplied.filter, r.reapplied.sort, r.reapplied.columns.length, r.reapplied.rows])}, skipped ${JSON.stringify(r.applied.skipped)}`,
    r.cleared.filter === '' && r.cleared.columns.length === 6 && r.reapplied.filter === 'AU >= 1990' && r.reapplied.sort[0].column === 'AU' && r.reapplied.columns.includes('AU2') && r.reapplied.rows === 1000 && r.applied.skipped.length === 0);
  chk(`export → ${r.exp.type}, ${r.exp.lines} lines, ${JSON.stringify(r.exp.head)}`, r.exp.type === 'text/csv' && r.exp.lines === 1001 && r.exp.head[0] === 'ID,AU' && /^199999,/.test(r.exp.head[1]));
  chk(`select rows 2…4 × ID,BIG → ${JSON.stringify(r.sel)}; lamina:selection ${JSON.stringify(r.selEv)}`,
    r.sel.from === 2 && r.sel.to === 4 && r.sel.columns.join() === 'ID,BIG' && r.sel.record === 199997 && r.selEv.length >= 1 && r.selEv[r.selEv.length - 1].to === 4);
  chk(`setColumn hidden → ${r.hid.hidden}; type → ${r.typed.type}; orderColumns → ${r.order.slice(0, 3)}`, r.hid.hidden === true && r.typed.type === 'string' && r.order[0] === 'LITO' && r.order[1] === 'ID');
  chk(`rejections: ${JSON.stringify(r.rej)}`, /NOPE/.test(r.rej.badFilter) && /no column "NOPE"/.test(r.rej.badCol) && /not in the view/.test(r.rej.badRow) && /taken/.test(r.rej.takenCalc) && /binary/.test(r.rej.binary) && /not a lens/.test(r.rej.notLens));
  chk(`open(bytes, { name }) → ${JSON.stringify([r.fromBytes.format, r.fromBytes.rows])}; events ${JSON.stringify(r.ev)}`,
    r.fromBytes.format === 'parquet' && r.fromBytes.rows === N && r.ev.opened.length === 2 && r.ev.opened[0][1] === 'parquet' && r.ev.failed.includes('blob.bin'));
  chk(`no page errors (${errors.length ? errors.join(' | ') : 'none'})`, errors.length === 0);
  await page.close();

  // ── embedded: the ready event on the host's <iframe>, ?embed=1 hides the title
  const host = await browser.newPage();
  await host.goto(`http://127.0.0.1:${port}/__host.html`);
  const e = await host.evaluate(async (src) => {
    const f = document.createElement('iframe'); f.style.width = '1000px'; f.style.height = '600px';
    const got = new Promise((res) => f.addEventListener('lamina:ready', (ev) => res(ev.detail), { once: true }));
    f.src = src; document.body.appendChild(f);
    const detail = await Promise.race([got, new Promise((res) => setTimeout(() => res('timeout'), 15000))]);
    const L = f.contentWindow.lamina, doc = f.contentDocument;
    const shown = () => getComputedStyle(doc.querySelector('#toolbar > .title')).display !== 'none';
    const before = { chrome: L.chrome(), shown: shown() };
    L.setChrome({ title: true });
    return { detail, before, after: shown() };
  }, `${url}?embed=1`);
  chk(`iframe: lamina:ready on the host's <iframe> ${JSON.stringify(e.detail)}; ?embed=1 hides the title (${JSON.stringify(e.before)}), setChrome shows it (${e.after})`,
    e.detail && e.detail.version === 1 && e.before.chrome.title === false && e.before.shown === false && e.after === true);
  await host.close();
}

try {
  await run('/tools/lamina/index.html', 'dev tree');
  await run('/lamina.html', 'built lamina.html');
} finally {
  await browser.close(); server.close();
}
console.log(pass ? 'LAMINA HOST SMOKE: PASS' : 'LAMINA HOST SMOKE: FAIL');
process.exit(pass ? 0 : 1);
