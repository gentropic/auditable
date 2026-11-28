// lamina views smoke — several files open at once, in @gcu/rails tabs and splits (tools/lamina/js/app.js
// installView / setFocus; spec_inbox/lamina-workspace-spec.md). Runs the dev tree AND the built
// lamina.html (build first: node build.js --target=lamina).   node test/lamina-views-smoke.mjs
//
// What it holds: a file the user opens gets its own tab; a re-read replaces in place; each view keeps
// its own filter, and focus follows a click into a split; closing falls back to a live view and the
// last close shows the empty state; a failed open is a note tab; "New view of this file" copies the
// view and then the two go their own ways; a drop of several files opens each.
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const d = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let failed = 0, passed = 0;
const ok = (m) => { passed++; console.log('ok   ' + m); };
const fail = (m) => { failed++; console.log('FAIL ' + m); };
const check = (cond, msg, detail) => (cond ? ok(msg) : fail(msg + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')));

const browser = await chromium.launch();
for (const [tag, url] of [['dev', '/tools/lamina/index.html'], ['built', '/lamina.html']]) {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}${url}`);
  await page.waitForFunction(() => window._lamina && window._lamina.rails, null, { timeout: 20000 });
  const E = (fn, arg) => page.evaluate(fn, arg);
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const state = () => E(() => {
    const l = window._lamina;
    return {
      n: l.views.length, focused: l.focused && l.focused.label, current: l.current && l.current.label,
      name: document.getElementById('fileName').textContent, meta: document.getElementById('meta').textContent,
      filter: document.getElementById('filter').value, tabs: [...document.querySelectorAll('.rails-tab')].map((t) => t.textContent.replace('×', '').trim()),
    };
  });
  const csv = (name, n) => E(async ([nm, k]) => {
    const body = 'a,b,c\n' + Array.from({ length: k }, (_, i) => `${i},${i * 2},x${i % 3}`).join('\n');
    await window._lamina.openInTab(new File([body], nm));
  }, [name, n]);

  // 1 ── two files, two tabs; the second is focused
  await csv('one.csv', 300); await settle();
  await csv('two.csv', 500); await settle();
  let s = await state();
  check(s.n === 2 && s.tabs.join('|') === 'one.csv|two.csv' && s.focused === 'two.csv' && s.name === 'two.csv' && /500 rows/.test(s.meta),
    `[${tag}] two files open in two tabs, the second focused`, s);

  // 2 ── a re-read (the interpretation changed) replaces the focused view in place: same tab, still two
  await E(() => window._lamina.reopen({ delimiter: ',' })); await settle(600);
  s = await state();
  check(s.n === 2 && s.tabs.join('|') === 'one.csv|two.csv' && s.focused === 'two.csv', `[${tag}] reading a file again keeps its tab`, s);

  // 3 ── each view keeps its own filter
  await E(async () => { document.getElementById('filter').value = 'a > 400'; await window._lamina.applyFilter('a > 400'); }); await settle();
  await E(() => { const l = window._lamina; l.rails.activateTab(l.views[0].tabId); }); await settle();
  const first = await state();
  await E(() => { const l = window._lamina; l.rails.activateTab(l.views[1].tabId); }); await settle();
  const second = await state();
  check(first.focused === 'one.csv' && first.filter === '' && /^300 rows/.test(first.meta) && second.filter === 'a > 400' && /99 of 500/.test(second.meta),
    `[${tag}] each view keeps its own filter (one.csv: none · two.csv: "a > 400", 99 of 500)`, { first, second });

  // 4 ── a split: the second beside the first; a click into the left one focuses it
  await E(() => { const l = window._lamina; l.rails.moveTab(l.views[1].tabId, { to: 'split', side: 'right' }); }); await settle(800);
  const pt = await E(() => { const r = window._lamina.views[0].panel.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 150, w: r.width }; });
  await page.mouse.click(pt.x, pt.y); await settle();
  s = await state();
  const side = await E(() => window._lamina.views.map((v) => Math.round(v.panel.getBoundingClientRect().left)));
  check(side[0] < side[1] && pt.w < 900 && s.focused === 'one.csv' && s.filter === '', `[${tag}] split side by side; a click into the left focuses it`, { side, s });

  // 5 ── New view of this file: the same filter at first, then their own
  await E(async () => { document.getElementById('filter').value = 'a < 10'; await window._lamina.applyFilter('a < 10'); }); await settle();
  await E(() => window._lamina.newViewOfFocused()); await settle(800);
  s = await state();
  const twin = s;
  await E(async () => { document.getElementById('filter').value = 'a < 100'; await window._lamina.applyFilter('a < 100'); }); await settle();
  const after = await state();
  await E(() => { const l = window._lamina; l.setFocus(l.views.find((v) => v.label === 'one.csv')); }); await settle();
  const orig = await state();
  check(twin.n === 3 && twin.tabs.includes('one.csv (2)') && twin.filter === 'a < 10' && /10 of 300/.test(twin.meta)
    && /100 of 300/.test(after.meta) && orig.filter === 'a < 10' && /10 of 300/.test(orig.meta),
  `[${tag}] New view of this file copies the view, then the two go their own ways`, { twin, after, orig });

  // 6 ── a binary file is a note tab, not a table
  await E(() => window._lamina.openInTab(new File([new Uint8Array([0, 1, 2, 0, 255, 0, 7, 0])], 'blob.bin'))); await settle();
  s = await state();
  const note = await E(() => { const f = window._lamina.focused; return !!(f && f.note && /binary/.test(f.panel.textContent)) && !window._lamina.current; });
  check(note && s.focused === 'blob.bin' && s.n === 4, `[${tag}] a binary file opens as a note tab saying so`, s);

  // 7 ── several files dropped at once → each its own tab
  await E(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x,y\n1,2\n3,4'], 'd1.csv'));
    dt.items.add(new File(['x,y\n5,6'], 'd2.csv'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await settle(1200);
  s = await state();
  check(s.n === 6 && s.tabs.includes('d1.csv') && s.tabs.includes('d2.csv') && s.focused === 'd2.csv', `[${tag}] a drop of two files opens two tabs`, s.tabs);

  // 8 ── closing: the focus falls back to a live view; the last close shows the empty state
  await E(() => { const l = window._lamina; l.rails.closeTab(l.focused.tabId); }); await settle();
  s = await state();
  check(s.n === 5 && s.focused && s.focused !== 'd2.csv' && s.name === s.focused, `[${tag}] closing the focused tab focuses a remaining one`, s);
  await E(() => { const l = window._lamina; for (const v of l.views) l.rails.closeTab(v.tabId); }); await settle();
  s = await state();
  const empty = await E(() => getComputedStyle(document.getElementById('empty')).display);
  check(s.n === 0 && !s.focused && s.name === 'no file' && empty !== 'none', `[${tag}] closing every tab shows the empty state`, { s, empty });

  // 9 ── the raw view: a row's bytes beside its table; the invisible made visible; grep; back to the row; hex
  await E(async () => {
    const rows = ['HOLE,FROM,TO,AU,LITO'];
    for (let i = 0; i < 2000; i++) rows.push(`DH${i % 40},${i},${i + 1},${(i % 97) / 10},${i === 1500 ? '"OXI\nDE"' : i === 700 ? 'OXIDE ' : 'FRESH'}`);
    await window._lamina.openInTab(new File([rows.join('\n').replace('DH5,5,6', 'DH5\t,5,6') + '\r\n'], 'holes.csv'));
  });
  await settle(900);
  const raw = await E(async () => {
    const l = window._lamina, t = l.current;
    await l.showRawOfRow(t, 1200); await new Promise((r) => setTimeout(r, 500));
    const v = l.focused, at = await v.baseVs.ensureRow(v.grid.getSelection().r0);
    const lines = []; for (const k of [6, 701, 1501, 1502, 2001]) lines.push((await v.baseVs.ensureRow(k))[1]);
    const left = Math.round(t.panel.getBoundingClientRect().left), right = Math.round(v.panel.getBoundingClientRect().left);
    return { label: v.label, at, lines, sideBySide: left < right };
  });
  check(raw.label === 'holes.csv · raw' && raw.sideBySide && raw.at[1] === 'DH0,1200,1201,3.6,FRESH␊'
    && raw.lines.join('|') === 'DH5⇥,5,6,0.5,FRESH␊|DH20,700,701,2.1,OXIDE·␊|DH20,1500,1501,4.5,"OXI␊|DE"␊|DH39,1999,2000,5.9,FRESH␍␊',
  `[${tag}] Show raw: row 1200's line beside the table; tab ⇥, trailing space ·, the quoted newline and the CRLF all visible`, raw);
  const grep = await E(async () => { await window._lamina.applyFilter('line contains "OXI"'); await new Promise((r) => setTimeout(r, 400)); return document.getElementById('meta').textContent; });
  check(/^2 of 2,002 lines/.test(grep), `[${tag}] a filter on raw lines is a grep (2 of 2,002 lines)`, grep);
  const back = await E(async () => {
    const l = window._lamina, v = l.focused; await l.applyFilter('');
    await l.showRowOfRaw(v, 1502); await new Promise((r) => setTimeout(r, 300));
    return { focused: l.focused.label, row: l.grid.getSelection().r0 };
  });
  check(back.focused === 'holes.csv' && back.row === 1500, `[${tag}] Show as a row: the quoted field's second line is row 1500`, back);
  const hex = await E(async () => {
    const l = window._lamina; await l.showRawOfRow(l.current, 3);
    const v = l.focused; await l.switchRawAt(v, v.grid.getSelection().r0); await new Promise((r) => setTimeout(r, 300));
    const h = l.focused; return { label: h.label, row: await h.baseVs.ensureRow(h.grid.getSelection().r0) };
  });
  check(hex.label === 'holes.csv · hex' && hex.row[0] === '00000040' && hex.row[2] === '.2,FRESH.DH3,3,4', `[${tag}] lines → hex at the same bytes (row 3 starts in 0x40)`, hex);
  const bin = await E(async () => {
    const l = window._lamina; await l.openInTab(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 255, 1])], 'x.bin'));
    await l.openRawOfFocused('hex'); await new Promise((r) => setTimeout(r, 300));
    return { label: l.focused.label, row: await l.focused.baseVs.ensureRow(0) };
  });
  check(bin.label === 'x.bin · hex' && bin.row[2] === 'PK......', `[${tag}] a binary file's note → its bytes in hex`, bin);
  const encoding = await E(async () => {
    const l = window._lamina; await l.openInTab(new File([new Uint8Array([0x63, 0x61, 0x66, 0xe9, 10])], 'latin.txt'));
    await l.openRawOfFocused('lines'); await new Promise((r) => setTimeout(r, 300));
    const a = (await l.focused.baseVs.ensureRow(0))[1];
    await l.reopen({ encoding: 'windows-1252' }); await new Promise((r) => setTimeout(r, 300));
    return { utf8: a, latin1: (await l.focused.baseVs.ensureRow(0))[1] };
  });
  check(encoding.utf8 === 'caf�␊' && encoding.latin1 === 'café␊', `[${tag}] raw lines in another encoding: caf�␊ → café␊`, encoding);

  // 10 ── lens v2: a file's views + their layout, saved; everything closed; the lens asks for the file
  //       (a slot), reopens it and brings back both views, their filters, the raw view and the split
  const lens2 = await E(async () => {
    const l = window._lamina, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const v of l.views) l.rails.closeTab(v.tabId);
    const body = 'a,b,c\n' + Array.from({ length: 400 }, (_, i) => `${i},${i * 2},x${i % 3}`).join('\n');
    const file = new File([body], 'lensed.csv');
    await l.openInTab(file); await wait(300);
    await l.applyFilter('a < 50'); document.getElementById('filter').value = 'a < 50';
    await l.newViewOfFocused(); await wait(300);
    document.getElementById('filter').value = 'c = "x1"'; await l.applyFilter('c = "x1"');
    await l.openRawOfFocused('lines'); await wait(400);
    const lens = l.buildLensFile('file');
    for (const v of l.views) l.rails.closeTab(v.tabId);
    let asked = null;
    l.askForFiles = async (list) => { asked = list.map((x) => x.file); return new Map([[list[0], file]]); };
    const skipped = await l.applyLensV2(JSON.parse(JSON.stringify(lens))); await wait(500);
    const vs = l.views.map((v) => ({ label: v.label, raw: v.raw || null, filter: v === l.current ? document.getElementById('filter').value : (v.filterText || ''), x: Math.round(v.panel.getBoundingClientRect().left), shown: v.panel.getBoundingClientRect().width > 0 }));
    return { shape: lens.sources.map((x) => [x.file, x.views.map((w) => w.raw || w.filter)]), asked, skipped, vs };
  });
  const tables = lens2.vs.filter((v) => !v.raw), rawv = lens2.vs.find((v) => v.raw === 'lines');
  check(JSON.stringify(lens2.shape) === '[["lensed.csv",["a < 50","c = \\"x1\\"","lines"]]]' && JSON.stringify(lens2.asked) === '["lensed.csv"]' && !lens2.skipped.length
    && tables.length === 2 && tables.map((v) => v.filter).sort().join('|') === 'a < 50|c = "x1"' && rawv && rawv.shown && tables.some((v) => v.shown && v.x < rawv.x),
  `[${tag}] lens v2: one file, three views, the split — saved, closed, asked for, all back`, lens2);

  // 11 ── reopening a file brings back its last view (recents); the session is offered on the empty page
  const recall = await E(async () => {
    const l = window._lamina, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const v of l.views) l.rails.closeTab(v.tabId);
    const file = new File(['k,v\n' + Array.from({ length: 50 }, (_, i) => `${i},${i % 5}`).join('\n')], 'again.csv');
    await l.openInTab(file); await wait(200);
    document.getElementById('filter').value = 'v = 3'; await l.applyFilter('v = 3'); await wait(900);   // remembered (debounced)
    l.saveSession(); await wait(200);
    for (const v of l.views) l.rails.closeTab(v.tabId); await wait(200);
    await l.openInTab(file); await wait(400);
    const back = { filter: document.getElementById('filter').value, meta: document.getElementById('meta').textContent };
    for (const v of l.views) l.rails.closeTab(v.tabId); await wait(200);
    await l.offerSession(); await wait(100);
    const offer = document.querySelector('.session-offer');
    return { back, offer: offer && offer.textContent };
  });
  check(recall.back.filter === 'v = 3' && /^10 of 50 rows/.test(recall.back.meta) && /brought back/.test(recall.back.meta) && /reopen the file you had open \(again\.csv\)/.test(recall.offer || ''),
    `[${tag}] a file opened again brings back its last view; the empty page offers the session`, recall);

  // 12 ── the rows a filter leaves out, in a view beside it; a data-quality flag goes to its row's bytes
  const comp = await E(async () => {
    const l = window._lamina, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const v of l.views) l.rails.closeTab(v.tabId);
    await l.openInTab(new File(['ID,AU,LITO\n' + Array.from({ length: 300 }, (_, i) => `${i},${(i % 10) / 10},${i === 120 ? 'OX ' : i % 2 ? 'OX' : 'FR'}${i === 200 ? ',extra' : ''}`).join('\n')], 'dq.csv'));
    await wait(300);
    document.getElementById('filter').value = 'AU >= 0.5'; await l.applyFilter('AU >= 0.5');
    await l.complementView(); await wait(400);
    const metas = l.views.map((v) => { l.setFocus(v); return [document.getElementById('filter').value, document.getElementById('meta').textContent.split(' × ')[0]]; });
    l.setFocus(l.views[0]); await l.applyFilter(''); document.getElementById('filter').value = '';
    await l.showDataQuality(); await wait(600);
    const rows = [...document.querySelectorAll('#helpBody .sum-tbl tbody tr')].map((tr) => tr.textContent);
    const btn = [...document.querySelectorAll('#helpBody .dq-raw')].find((b) => /wrong number of fields/.test(b.closest('tr').textContent));
    btn && btn.click(); await wait(700);
    const v = l.focused, at = v && v.raw && await v.baseVs.ensureRow(v.grid.getSelection().r0);
    return { metas, flagged: rows.filter((t) => /fields|padding/.test(t)).map((t) => t.replace(/\s+/g, ' ').slice(0, 90)), raw: at };
  });
  check(comp.metas.length === 2 && comp.metas[0][0] === 'AU >= 0.5' && comp.metas[1][0] === 'not (AU >= 0.5)' && /^150 of 300/.test(comp.metas[0][1]) && /^150 of 300/.test(comp.metas[1][1])
    && comp.raw && comp.raw[1] === '200,0,FR,extra␊',
  `[${tag}] the rows a filter leaves out open beside it (150 | 150); a "wrong number of fields" flag → row 201's bytes`, comp);

  // 13 ── the interpretation popover shows the first lines cut as they're read, and follows a change
  const pane = await E(async () => {
    const l = window._lamina, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const v of l.views) l.rails.closeTab(v.tabId);
    await l.openInTab(new File(['# exported 2026\nHOLE;FROM;AU\nDH1;0;"1,5"\nDH2;1;2;9\r\n'], 'semi.csv')); await wait(300);
    l.openOpts(); await wait(300);
    const read = () => [...document.querySelectorAll('#optRaw .or-l')].map((r) => [r.className.replace('or-l ', ''), r.querySelector('.or-t').textContent, r.querySelector('.or-c').textContent, r.querySelector('.or-c').classList.contains('bad')]);
    const before = read();
    const sel = document.getElementById('optDelim'); sel.value = ','; sel.dispatchEvent(new Event('change')); await wait(600);
    const after = read();
    document.getElementById('opts').classList.remove('show');
    return { before, after, delims: document.querySelectorAll('#optRaw b.dl').length };
  });
  const pb = pane.before;
  check(pb.length === 4 && pb[0][0] === 'skipped' && pb[1][0] === 'header' && pb[1][2] === '3' && pb[2][2] === '3' && pb[3][2] === '4' && pb[3][3] === true
    && /␍␊$/.test(pb[3][1]) && pane.after[1][2] === '1',
  `[${tag}] the popover's first lines: preamble struck, header, field counts (a 4 in red), CRLF shown; delimiter → comma redraws them`, pane);

  check(!errors.length, `[${tag}] no page errors`, errors);
  await page.context().close();
}
await browser.close(); server.close();
console.log(`\nLAMINA VIEWS SMOKE: ${failed ? 'FAIL' : 'PASS'} (${passed} passed, ${failed} failed)`);
process.exit(failed ? 1 : 0);
