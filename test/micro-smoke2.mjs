// micro smoke, part 2 — the DATA-INTEGRITY + persistence arcs promoted from
// gitignored experiments (2026-07-09 suite increment): sidecars + band
// pushdown (.dm and CSV, exact hits), the explicit Store-as-Parquet dialog
// (keep-original), micro:model kv self-description, pinned analysis windows
// across an OPFS project reload, and swath drag→select → selection→column.
// Run with `npm run test:micro2` (or test:micro:all). Slow (~2-3 min) — the
// fast library layer stays in `npm test`.
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
// --built: run every section against the BUILT micro.html (node build.js
// --target=micro) instead of the dev tree — the registry/blob bundle is where a
// carve or a new import breaks without the dev tree noticing.
const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
if (BUILT) console.log('micro-smoke2 against the BUILT micro.html');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle'] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 750 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.autoPackMeshes') == null) localStorage.setItem('micro.autoPackMeshes', 'off'); } catch { /* opaque origin */ } });   // the .wfr store prompt stays out of the way unless a section opts in
let ok = true; const chk = (n, c) => { console.log(`${c ? 'ok ' : 'FAIL'} ${n}`); ok = ok && c; };
const mkPage = async (proj) => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro, null, { timeout: 20000 });
  await p.evaluate((pr) => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(pr, { create: true }); }, proj);
  return p;
};
const saveProject = async (p) => {
  await p.evaluate(() => window._micro.setAutoOptimize('off'));
  p.evaluate(() => window._micro.saveProjectAs());
  await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 30000 });
  await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
};
// a minimal 2-band float32 GeoTIFF (band0 elevation, band1 gradient) for the band-pick check
const twoBandTiff = () => {
  const u16 = (v) => [v & 0xff, v >> 8], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const wr = (entries, img) => { const tail = []; let tb = 8 + 2 + entries.length * 12 + 4; const vb = (t, vs) => { if (vs instanceof Uint8Array) return vs; const o = []; for (const v of vs) { if (t === 3) o.push(...u16(v)); else if (t === 4) o.push(...u32(v)); else if (t === 12) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); o.push(...b); } else o.push(v); } return new Uint8Array(o); }; const buf = [0x49, 0x49, ...u16(42), ...u32(8), ...u16(entries.length)]; for (const [tag, ty, ct, vs] of entries) { const b = vb(ty, vs); buf.push(...u16(tag), ...u16(ty), ...u32(ct)); if (b.length <= 4) buf.push(...b, ...new Array(4 - b.length).fill(0)); else { buf.push(...u32(tb)); tail.push(b); tb += b.length; } } buf.push(...u32(0)); for (const t of tail) buf.push(...t); for (const d of img) buf.push(...d); return new Uint8Array(buf); };
  const W = 40, H = 32, N = W * H, bytes = new Uint8Array(N * 2 * 4), dv = new DataView(bytes.buffer);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const i = r * W + c, dx = (c - W * 0.45) / (W * 0.3), dy = (r - H * 0.5) / (H * 0.3); dv.setFloat32(i * 8, 200 + 380 * Math.exp(-(dx * dx + dy * dy)), true); dv.setFloat32(i * 8 + 4, 0.5 + 3 * (c / W) + 2 * (1 - r / H), true); }
  const base = [[256, 3, 1, [W]], [257, 3, 1, [H]], [258, 3, 1, [32]], [259, 3, 1, [1]], [262, 3, 1, [1]], [277, 3, 1, [2]], [278, 3, 1, [H]], [339, 3, 1, [3]], [279, 4, 1, [bytes.length]], [33550, 12, 3, [25, 25, 0]], [33922, 12, 6, [0, 0, 0, 500000, 6000000, 0]]].sort((a, b) => a[0] - b[0]);
  const probe = wr([...base, [273, 4, 1, [0]]].sort((a, b) => a[0] - b[0]), []);
  return wr([...base, [273, 4, 1, [probe.length]]].sort((a, b) => a[0] - b[0]), [bytes]);
};

// ═══ 1. the .dm sidecar arc: sub-blocked discovery cached, stats + band index
//     restored, dm band pushdown EXACT ═══
let p = await mkPage('sm2dm');
await p.evaluate(async () => {
  const { makeDM } = await import('/test/dm-make.mjs');
  const fields = [
    { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
    { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' },
    { name: 'XMORIG', type: 'N', constant: 1000 }, { name: 'YMORIG', type: 'N', constant: 2000 }, { name: 'ZMORIG', type: 'N', constant: 400 },
    { name: 'NX', type: 'N', constant: 40 }, { name: 'NY', type: 'N', constant: 30 }, { name: 'NZ', type: 'N', constant: 120 },
    { name: 'FE', type: 'N' }, { name: 'LITO', type: 'A', width: 8 },
  ];
  const rows = [];
  for (let k = 0; k < 120; k++) for (let j = 0; j < 30; j++) for (let i = 0; i < 40; i++) {
    const half = (i + j) % 4 === 0;
    rows.push({ XC: 1000 + i * 10 + (half ? 2.5 : 5), YC: 2000 + j * 10 + (half ? 2.5 : 5), ZC: 400 + k * 5 + (half ? 1.25 : 2.5),
      XINC: half ? 5 : 10, YINC: half ? 5 : 10, ZINC: half ? 2.5 : 5,
      FE: k < 60 ? 20 + (i % 10) : 80 + (i % 10), LITO: (i + j) % 2 ? 'BIF' : 'CANGA' });
  }
  await window._micro.openBlob(new Blob([makeDM(fields, rows, { precision: 'ep' })]), 'sub.dm', 'replace');
});
await p.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) > 100000, null, { timeout: 90000 });
await saveProject(p);
const side = await p.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dm');
  const mh = await (await dir.getDirectoryHandle('models')).getFileHandle('sub.dm.meta.json');
  const j = JSON.parse(await (await mh.getFile()).text());
  return { v: j.v, sub: j.header && j.header.subBlocked, stats: !!(j.colStats && j.colStats.FE && j.colStats.FE.centroids), bands: !!(j.bands && j.bands.cols && j.bands.cols.FE) };
});
chk(`.dm sidecar written (v${side.v}, subBlocked ${side.sub}, colStats ${side.stats}, bands ${side.bands})`, side.v === 2 && side.sub && side.stats && side.bands);
await p.close();
p = await mkPage('sm2dm');
await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dm'); await window._micro.openProjectDir(dir); });
await p.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) > 100000, null, { timeout: 90000 });
const re = await p.evaluate(() => { const L = window._micro.layers()[0], h = L.docs.blockDoc.header; return { sub: h.subBlocked, stats: !!(L._colStats && L._colStats.FE), bands: !!(L._bands && L._bands.cols.FE) }; });
chk(`.dm reopen: discovery cached (subBlocked ${re.sub}) + stats pre-seeded (${re.stats}) + bands loaded (${re.bands})`, re.sub && re.stats && re.bands);
await p.evaluate(() => { const i = document.querySelector('#filter'); i.value = 'FE > 70'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
await p.waitForFunction(() => { const L = window._micro.layers()[0]; return L._filterMask; }, null, { timeout: 90000 });
const fl = await p.evaluate(() => { const L = window._micro.layers()[0]; let hits = 0; for (let i = 0; i < L._filterMask.length; i++) hits += L._filterMask[i]; return { hits, skipped: window.__dmBandsSkipped, compact: /compacted/.test(document.querySelector('#meta').textContent) }; });
chk(`.dm band pushdown: ${fl.skipped} page-runs skipped, ${fl.hits} hits == 72000 (exact)`, fl.skipped > 0 && fl.hits === 72000);
// filtering a SUB-BLOCKED model must NOT compact (the compact set has no dim
// palette → matches would collapse to the fine-grid cell minDim/2; the mask
// path keeps each block's true size). Regression guard for the reported bug.
chk(`sub-blocked filter uses the mask path, not compaction (${!fl.compact})`, !fl.compact);
await p.close();

// ═══ 2. CSV bands + the explicit Store-as-Parquet dialog + micro:model kv ═══
const CSV = (() => { let s = 'XC,YC,ZC,FE\n'; for (let k = 0; k < 100; k++) for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) s += `${100 + i * 10},${200 + j * 10},${400 + k * 5},${k < 50 ? 20 + (i % 10) : 80 + (i % 10)}\n`; return s; })();
p = await mkPage('sm2csv');
await p.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 'big.csv', 'replace'), CSV);
await p.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) > 100000, null, { timeout: 120000 });
await saveProject(p);
await p.close();
p = await mkPage('sm2csv');
await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2csv'); await window._micro.openProjectDir(dir); });
await p.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) > 100000, null, { timeout: 120000 });
await p.evaluate(() => { const i = document.querySelector('#filter'); i.value = 'FE > 70'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
await p.waitForFunction(() => { const L = window._micro.layers()[0]; return L._filterMask; }, null, { timeout: 120000 });
const csvFl = await p.evaluate(() => { const L = window._micro.layers()[0]; let hits = 0; for (let i = 0; i < L._filterMask.length; i++) hits += L._filterMask[i]; return { hits, skipped: window.__csvBandsSkipped }; });
chk(`CSV band pushdown: ${csvFl.skipped} bands skipped, ${csvFl.hits} hits == 80000 (exact)`, csvFl.skipped > 0 && csvFl.hits === 80000);
// the explicit dialog, keep-original honored
const opP = p.evaluate(async () => { const L = window._micro.layers()[0]; await window._micro.COMMANDS.find((c) => c.id === 'optimize').run({ L }); }).catch(() => { /* resolves after the dialog; the page may close first */ });
await p.waitForFunction(() => document.querySelector('#opDlg').classList.contains('show'), null, { timeout: 10000 });
await p.evaluate(() => { document.querySelector('#opDlg .op-opts input').checked = true; document.querySelector('#opGo').click(); });
await p.waitForFunction(() => { const L = window._micro.layers()[0]; return L.docs.blockDoc && L.docs.blockDoc.parquet; }, null, { timeout: 120000 });
chk('Store as Parquet dialog: converted with keep-original', await p.evaluate(() => window._micro.layers()[0]._optimizedOrphan == null));
// kv self-description: the converted blob reopens with grid, no discovery pass
const kvOk = await p.evaluate(async () => {
  const m = window._micro, blob = m.layers()[0].docs.blockDoc.blob;
  await m.openBlob(blob, 'again.parquet', 'add');
  const L2 = m.layers().find((x) => x.name === 'again.parquet');
  return !!(L2 && L2.docs.blockDoc.header.grid);
});
chk('micro:model kv: converted parquet reopens with its grid (no discovery)', kvOk);
await opP;
await p.close();

// ═══ 3. pinned analysis windows across an OPFS reload ═══
const SMALL = (() => { let s = 'XC,YC,ZC,FE,SG\n'; for (let k = 0; k < 2; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) s += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${(i + 1) * 10},3\n`; return s; })();
p = await mkPage('sm2an');
await p.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 'model.csv', 'replace'), SMALL);
await p.waitForFunction(() => window._micro.layers().length === 1 && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 200, null, { timeout: 30000 });
await p.evaluate(() => window._micro.openGradeTonnage(window._micro.layers()[0]));
await p.evaluate(() => {
  const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage'));
  const wIn = [...el.querySelectorAll('.sw-ser input')].find((i) => /density expr/.test(i.placeholder));
  wIn.value = 'SG'; wIn.dispatchEvent(new Event('change'));
  el.querySelector('.sw-run').click();
});
await p.waitForFunction(() => { const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')); return el && el._gtSpec; }, null, { timeout: 30000 });
await saveProject(p);
await p.close();
p = await mkPage('sm2an');
await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2an'); await window._micro.openProjectDir(dir); });
await p.waitForFunction(() => [...document.querySelectorAll('.fwin')].some((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')), null, { timeout: 60000 });
const pin = await p.evaluate(() => {
  const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage'));
  const wIn = [...el.querySelectorAll('.sw-ser input')].find((i) => /density expr/.test(i.placeholder));
  return { sub: el.querySelector('.fwin-head .sub').textContent, weight: wIn && wIn.value, manual: !el._gtSpec };
});
chk(`pinned GT reopens configured (“${pin.sub}”, weight “${pin.weight}”, Run manual ${pin.manual})`, /restored/.test(pin.sub) && pin.weight === 'SG' && pin.manual);

// ═══ 4. swath drag→select → selection→column (0/1) ═══
await p.evaluate(() => { const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')); el.querySelector('.fwin-head button:last-child').click(); });
await p.evaluate(() => window._micro.openSwath(window._micro.layers()[0]));
await p.evaluate(() => { const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('swath')); el.querySelector('.sw-run').click(); });
await p.waitForFunction(() => { const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('swath')); return el && el._swathSpec; }, null, { timeout: 30000 });
const drag = await p.evaluate(async () => {
  const el = [...document.querySelectorAll('.fwin')].find((e9) => e9.querySelector('.fwin-head .t').textContent.startsWith('swath'));
  const cv2 = el.querySelector('.sw-main canvas'), r = cv2.getBoundingClientRect();
  const at = (fx) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * 0.5, bubbles: true });
  cv2.dispatchEvent(new MouseEvent('mousedown', { ...at(0.3), button: 0 }));
  cv2.dispatchEvent(new MouseEvent('mousemove', at(0.7)));
  window.dispatchEvent(new MouseEvent('mouseup', at(0.7)));
  await new Promise((r2) => setTimeout(r2, 150));
  const sel = [...document.querySelectorAll('.menu .item')].find((x) => /Select rows in/.test(x.textContent));
  if (sel) sel._item.action();
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  await new Promise((r2) => setTimeout(r2, 400));
  return window._micro.layers()[0]._selCount || 0;
});
chk(`swath drag→select lands a real selection (${drag} rows)`, drag > 0 && drag < 200);
const mat = p.evaluate(() => window._micro.selectionToColumn(window._micro.layers()[0]));
await p.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'), null, { timeout: 5000 });
await p.evaluate(() => { document.querySelector('#pmInput').value = 'BANDSEL'; document.querySelector('#pmOk').click(); });
await mat;
const col01 = await p.evaluate(() => {
  const L = window._micro.layers()[0], col = (L.paintCols || []).find((c) => c.name === 'BANDSEL');
  if (!col) return null;
  let n1 = 0, n0 = 0; for (const c of col.codes) { if (col.dict[c] === '1') n1++; else if (col.dict[c] === '0') n0++; }
  return { n1, n0, sel: L._selCount, total: col.codes.length };
});
chk(`selection→column 0/1: ${col01 && col01.n1} ones == sel, all ${col01 && col01.total} rows explicit`, col01 && col01.n1 === col01.sel && col01.n0 === col01.total - col01.sel);

// ═══ 5. drillholes in a ROOT-FILES project (the micro-demo shape): the trio
// already at the folder root → save (no copy prompt — they're in-folder) →
// the .holes.json descriptor lands in drillholes/ but references root files →
// reopen must RESOLVE them (descriptor-relative, then root, then drillholes/) ═══
const DH = {
  collar: 'BHID,X,Y,Z\nDH001,100,100,50\nDH002,150,100,50\n',
  survey: 'BHID,AT,AZ,DIP\nDH001,0,0,-90\nDH002,0,0,-90\n',
  assay: 'BHID,FROM,TO,FE\nDH001,0,10,55\nDH001,10,20,60\nDH002,0,10,45\n',
};
p = await mkPage('sm2dh2');
await p.evaluate(async (D) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dh2', { create: true });
  for (const [n, d] of [['collars.csv', D.collar], ['survey.csv', D.survey], ['assay.csv', D.assay]]) { const fh = await dir.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(d); await w.close(); }
}, DH);
await p.evaluate((D) => window._micro.importDrillholes({ collar: new File([D.collar], 'collars.csv'), survey: new File([D.survey], 'survey.csv'), intervals: new File([D.assay], 'assay.csv') }, {}, 'replace'), DH);
await p.waitForFunction(() => window._micro.layers().some((L) => L.dh), null, { timeout: 30000 });
// a DATA-PRESERVING reopen (re-desurvey) must keep the layer's derived styling AND identity —
// reopenDh/reopenDhChan/reopenWithMapping now share captureLayerStyling + captureReopenIdentity.
const dhReopen = await p.evaluate(async () => {
  const L = window._micro.layers().find((x) => x.dh);
  L.calcCols = [{ name: 'fe2', expr: 'FE * 2', ty: 'number' }]; L.colTypes = { FE: 'number' };
  L.visible = false; window._micro.renderer.setLayerVisible(L.id, false);       // hidden → must stay hidden
  await window._micro.reopenDh(L, {});                                          // re-desurvey, same config
  const L2 = window._micro.layers().find((x) => x.dh);
  return { calc: (L2.calcCols || []).map((c) => c.name), colFE: L2.colTypes && L2.colTypes.FE, visible: L2.visible };
});
chk(`re-desurvey keeps styling (calc ${JSON.stringify(dhReopen.calc)} + colTypes ${dhReopen.colFE}) and stays hidden (${dhReopen.visible})`,
  dhReopen.calc.includes('fe2') && dhReopen.colFE === 'number' && dhReopen.visible === false);
await p.evaluate(() => { const L = window._micro.layers().find((x) => x.dh); L.visible = true; window._micro.renderer.setLayerVisible(L.id, true); });
await saveProject(p);
await p.close();
p = await mkPage('sm2dh2');
await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dh2'); await window._micro.openProjectDir(dir); });
await p.waitForFunction(() => window._micro.layers().some((L) => L.dh) || /0 layers/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
const dhBack = await p.evaluate(() => ({ n: window._micro.layers().filter((L) => L.dh).length, meta: document.querySelector('#meta').textContent }));
chk(`root-files dh project reopens with its drillholes (${dhBack.n} dh layer, “${dhBack.meta.slice(0, 40)}”)`, dhBack.n === 1);
await p.close();

// ═══ 7. bookmarks (viewpoint) + scenes (full working state) round-trip as files
//     in bookmarks/ + scenes/ across a project reopen ═══
{
  const pb = await mkPage('sm2bmk');
  const answer = async (nm) => {
    await pb.waitForFunction(() => document.querySelector('#pmDlg') && document.querySelector('#pmDlg').classList.contains('show'), null, { timeout: 8000 });
    await pb.evaluate((n) => { document.querySelector('#pmInput').value = n; document.querySelector('#pmOk').click(); }, nm);
  };
  const CSV = (g) => { let s = 'XC,YC,ZC,AU\n'; for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) s += `${i * 10},${j * 10},${k * 5},${g + (i % 3)}\n`; return s; };
  await pb.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 'A.csv', 'replace'), CSV(1));
  await pb.waitForFunction(() => window._micro.layers().length === 1, null, { timeout: 30000 });
  await pb.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 'B.csv', 'add'), CSV(5));
  await pb.waitForFunction(() => window._micro.layers().length === 2, null, { timeout: 30000 });

  // bookmark: move camera, save, move away, apply → restored
  await pb.evaluate(() => { window._micro.cam.state.theta = 0.3; });
  const bmSave = pb.evaluate(() => window._micro.saveViewAs()); await answer('Front'); await bmSave;
  await pb.evaluate(() => { window._micro.cam.state.theta = 2.0; window._micro.cam.update(); });
  await pb.evaluate(() => window._micro.applyView(window._micro.views()[0]));
  chk('bookmark restores camera', Math.abs(await pb.evaluate(() => window._micro.cam.state.theta) - 0.3) < 1e-6);

  // scene: hide B + filter A, save; disturb; apply → both restored
  await pb.evaluate(() => { const L = window._micro.layers().find((x) => x.name === 'B.csv'); L.visible = false; window._micro.renderer.setLayerVisible(L.id, false); });
  await pb.evaluate(() => { const A = window._micro.layers().find((x) => x.name === 'A.csv'); window._micro.setActiveLayer(A.id); document.querySelector('#filter').value = 'AU > 1.5'; });
  await pb.evaluate(() => window._micro.applyBlockFilter('AU > 1.5'));
  await pb.waitForFunction(() => window._micro.layers().find((x) => x.name === 'A.csv').filterExpr === 'AU > 1.5', null, { timeout: 10000 });
  const scSave = pb.evaluate(() => window._micro.saveSceneAs(false)); await answer('Review'); await scSave;
  await pb.evaluate(() => { const L = window._micro.layers().find((x) => x.name === 'B.csv'); L.visible = true; window._micro.renderer.setLayerVisible(L.id, true); const A = window._micro.layers().find((x) => x.name === 'A.csv'); window._micro.setActiveLayer(A.id); document.querySelector('#filter').value = ''; });
  await pb.evaluate(() => window._micro.applyBlockFilter(''));
  await pb.evaluate(() => window._micro.applyScene(window._micro.scenes()[0]));
  await pb.waitForTimeout(400);
  const sc = await pb.evaluate(() => { const A = window._micro.layers().find((x) => x.name === 'A.csv'), B = window._micro.layers().find((x) => x.name === 'B.csv'); return { bHidden: B.visible === false, aFilter: A.filterExpr }; });
  chk(`scene restores visibility + filter (B hidden=${sc.bHidden}, A="${sc.aFilter}")`, sc.bHidden && sc.aFilter === 'AU > 1.5');

  // project round-trip: files written to bookmarks/ + scenes/, reopen loads both
  await saveProject(pb);
  const files = await pb.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2bmk');
    const ls = async (sub) => { try { const d = await dir.getDirectoryHandle(sub); const out = []; for await (const [nm] of d.entries()) out.push(nm); return out; } catch { return []; } };
    return { bookmarks: await ls('bookmarks'), scenes: await ls('scenes') };
  });
  chk(`bookmarks/ + scenes/ written to the project folder (${files.bookmarks.join(',')} | ${files.scenes.join(',')})`, files.bookmarks.length === 1 && files.scenes.length === 1);
  await pb.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2bmk'); await window._micro.openProjectDir(dir); });
  await pb.waitForFunction(() => window._micro.layers().length === 2, null, { timeout: 60000 });
  const reloaded = await pb.evaluate(() => ({ bm: window._micro.views().map((v) => v.name), sc: window._micro.scenes().map((s) => ({ name: s.name, n: s.layers.length })) }));
  chk(`reopened project loads bookmark + scene (${reloaded.bm} | ${JSON.stringify(reloaded.sc)})`,
    reloaded.bm.includes('Front') && reloaded.sc.length === 1 && reloaded.sc[0].name === 'Review' && reloaded.sc[0].n === 2);
  await pb.close();
}

// ═══ 8. the demo project — one click assembles the coming-home scene: a block
//     model + drillholes, half-cut on the ore lens (holes stay WHOLE), grade-
//     coloured, with a computed grade-tonnage curve + a saved bookmark ═══
{
  const pd = await mkPage('sm2demo');
  await pd.click('#sampleDemo');
  await pd.waitForFunction(() => window._micro.layers().length >= 2
    && window._micro.views().length >= 1
    && [...document.querySelectorAll('.fwin')].some((w) => /grade.tonnage/i.test(w.textContent)), null, { timeout: 120000 });
  await pd.waitForTimeout(1000);
  const d = await pd.evaluate(() => {
    const dh = window._micro.layers().find((x) => x.dh);
    const bm = window._micro.layers().find((x) => x.docs && x.docs.blockDoc);
    const gtWin = [...document.querySelectorAll('.fwin')].find((w) => /grade.tonnage/i.test(w.textContent));
    return {
      layers: window._micro.layers().length,
      hasBlocks: !!bm, blockCount: bm ? window._micro.renderer.layerElementCount(bm.id) : 0,
      hasDh: !!dh, dhWhole: dh ? !window._micro.renderer.layerSectioned(dh.id) : false,
      section: document.querySelector('#secMode').value,
      gtCurve: gtWin ? !!gtWin.querySelector('canvas') : false,
      bookmark: window._micro.views().some((v) => /lens/i.test(v.name)),
    };
  });
  chk(`demo project: block model (${d.blockCount.toLocaleString()}) + drillholes, one click`, d.hasBlocks && d.blockCount > 100000 && d.hasDh && d.layers >= 2);
  chk(`demo project: E–W section, drillholes stay WHOLE (not cut)`, d.section === 'ew' && d.dhWhole);
  chk(`demo project: grade-tonnage window computed + a bookmark saved`, d.gtCurve && d.bookmark);
  // the analysis-window config rail scrolls, but Run + save-as-recipe stay pinned:
  // shrink the GT window so the rail overflows, scroll to the top, and the sticky
  // footer must still sit flush at the rail bottom with Run visible
  const sticky = await pd.evaluate(() => {
    const w = [...document.querySelectorAll('.fwin')].find((x) => /grade.tonnage/i.test(x.textContent));
    w.style.height = '300px'; w.style.width = '560px';
    const rail = w.querySelector('.sw-rail'), foot = w.querySelector('.sw-foot'); rail.scrollTop = 0;
    const rb = rail.getBoundingClientRect(), fb = foot.getBoundingClientRect(), run = foot.querySelector('.sw-run');
    return { overflow: rail.scrollHeight > rail.clientHeight + 4, pos: getComputedStyle(foot).position, flush: Math.abs(fb.bottom - rb.bottom) < 3, runVisible: run.getBoundingClientRect().bottom <= rb.bottom + 1 };
  });
  chk(`analysis window: Run/save-as-recipe stay pinned when the config scrolls (sticky footer)`, sticky.overflow && sticky.pos === 'sticky' && sticky.flush && sticky.runVisible);
  await pd.close();
}

// ═══ 9. vertical exaggeration — a GLOBAL scene z-scale (camera-level): geometry
//     intact, rides in the camera capture, and a pick still returns a real record
//     (queries stay in real coords under exaggeration) ═══
{
  const pe = await mkPage('sm2exag');
  const CSV = () => { let s = 'XC,YC,ZC,FE\n'; for (let k = 0; k < 20; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) s += `${i * 10},${j * 10},${k * 5},${40 + (i % 8)}\n`; return s; };
  await pe.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 'e.csv', 'replace'), CSV());
  await pe.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) > 5000, null, { timeout: 30000 });
  const cnt0 = await pe.evaluate(() => window._micro.renderer.layerElementCount(window._micro.layers()[0].id));
  await pe.evaluate(() => window._micro.setZExag(4));
  await pe.waitForTimeout(500);
  const ex = await pe.evaluate(() => ({
    z: window._micro.cam.state.zExag,
    count: window._micro.renderer.layerElementCount(window._micro.layers()[0].id),
    captured: window._micro.captureScene ? window._micro.captureScene('t', false).camera.zExag : null,
  }));
  chk(`exaggeration: global z-scale applied (4×), geometry intact (${ex.count.toLocaleString()})`, ex.z === 4 && ex.count === cnt0);
  chk('exaggeration rides in the camera capture (bookmarks/scenes)', ex.captured === 4);
  // a pick under exaggeration must still return a real record (ID-buffer picks what you see)
  const cv = await pe.$('#gl,canvas'); const box = await cv.boundingBox(); let hit = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.5], [0.55, 0.5], [0.5, 0.45], [0.5, 0.55]]) {
    await pe.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await pe.waitForTimeout(250);
    hit = await pe.evaluate(() => { const rp = document.querySelector('#recPanel'); return rp && rp.classList.contains('show') ? rp.querySelectorAll('.rp-row').length : 0; });
    if (hit) break;
  }
  chk('exaggeration: a pick still returns a real record (queries stay in real coords)', hit > 0);
  // vertical pan must track the cursor 1:1 regardless of exaggeration (the z move
  // is divided by zExag to cancel the display stretch) — a target-depth point
  // shifts by ~the drag amount at 1× AND at 8×, not zExag× it
  const pan = await pe.evaluate(() => {
    const c = window._micro.cam; c.state.phi = Math.PI / 4; c.update(); const H = 760;
    const track = (exag) => {
      window._micro.setZExag(exag); const P = [...c.state.target];
      const projY = (vp) => { const y = vp[1] * P[0] + vp[5] * P[1] + vp[9] * P[2] + vp[13], w = vp[3] * P[0] + vp[7] * P[1] + vp[11] * P[2] + vp[15]; return (1 - y / w) * 0.5 * H; };
      const y0 = projY(c.state.viewProj); c.pan(0, 80, H); const y1 = projY(c.state.viewProj); c.pan(0, -80, H);
      return y1 - y0;
    };
    return { at1: track(1), at8: track(8) };
  });
  chk(`exaggeration: vertical pan tracks 1:1 (1×→${pan.at1.toFixed(0)}px, 8×→${pan.at8.toFixed(0)}px for an 80px drag)`, Math.abs(pan.at1 - 80) < 25 && Math.abs(pan.at8 - 80) < 25);
  await pe.evaluate(() => window._micro.setZExag(1));
  await pe.close();
}

// ═══ 10. heightfield surface — a grid reinterprets from the raw elevation point
//     cloud to a shaded-relief mesh (per-vertex colour + smooth normals), keeping
//     gridDoc for by-surface eval ═══
{
  const ph = await mkPage('sm2surf');
  const asc = await ph.evaluate(() => {
    const nc = 100, nr = 80, cs = 25, x0 = 500000, y0 = 6000000;
    let s = `ncols ${nc}\nnrows ${nr}\nxllcorner ${x0}\nyllcorner ${y0}\ncellsize ${cs}\nNODATA_value -9999\n`;
    const rows = [];
    for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) { const dx = (c - nc * 0.45) / (nc * 0.3), dy = (r - nr * 0.5) / (nr * 0.3); let z = 200 + 380 * Math.exp(-(dx * dx + dy * dy)); if (c < 6 && r < 6) z = -9999; line.push(z.toFixed(1)); } rows.push(line.join(' ')); }
    return s + rows.join('\n') + '\n';
  });
  await ph.evaluate((a) => window._micro.openBlob(new Blob([a]), 'terrain.asc', 'replace'), asc);
  await ph.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.gridDoc, null, { timeout: 30000 });
  const pts = await ph.evaluate(() => ({ kind: window._micro.layers()[0].kind, surface: !!window._micro.layers()[0].gridSurface }));
  chk('grid opens as an elevation point cloud', pts.kind === 'points' && !pts.surface);
  // reopen (reinterpret) preserves layer identity — incl. VISIBILITY: a reinterpret of a HIDDEN layer used to
  // bring it back visible (each reopen site hand-copied identity; reopenAs dropped `visible`). One shared
  // captureReopenIdentity/restoreReopenIdentity now guards it.
  await ph.evaluate(() => { const L = window._micro.layers()[0]; L.visible = false; window._micro.renderer.setLayerVisible(L.id, false); });
  await ph.evaluate(() => window._micro.reopenAs(window._micro.layers()[0], 'surface'));
  await ph.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].gridSurface, null, { timeout: 30000 });
  await ph.waitForTimeout(600);
  chk('reopen preserves a hidden layer as hidden (reinterpret used to lose visibility)', await ph.evaluate(() => window._micro.layers()[0].visible === false));
  await ph.evaluate(() => { const L = window._micro.layers()[0]; L.visible = true; window._micro.renderer.setLayerVisible(L.id, true); });
  const surf = await ph.evaluate(() => { const L = window._micro.layers()[0]; return { kind: L.kind, surface: !!L.gridSurface, hasGrid: !!(L.docs.gridDoc && L.docs.gridDoc.grid), elem: window._micro.renderer.layerElementCount(L.id) }; });
  chk(`grid reinterprets to a shaded-relief surface (mesh, ${surf.elem.toLocaleString()} elements, gridDoc kept for eval)`, surf.kind === 'mesh' && surf.surface && surf.hasGrid && surf.elem > 1000);
  // Phase 2 drape: colour the topo surface by a SECOND grid's values (grade over topo)
  const grade = await ph.evaluate(() => {
    const nc = 100, nr = 80, cs = 25, x0 = 500000, y0 = 6000000;
    let s = `ncols ${nc}\nnrows ${nr}\nxllcorner ${x0}\nyllcorner ${y0}\ncellsize ${cs}\nNODATA_value -9999\n`; const rows = [];
    for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) line.push((0.5 + 3 * (c / nc) + 2 * (1 - r / nr)).toFixed(2)); rows.push(line.join(' ')); }
    return s + rows.join('\n') + '\n';
  });
  await ph.evaluate((g) => window._micro.openBlob(new Blob([g]), 'grade.asc', 'add'), grade);
  await ph.waitForFunction(() => window._micro.layers().some((L) => L.name === 'grade.asc'), null, { timeout: 30000 });
  await ph.evaluate(() => { const topo = window._micro.layers().find((L) => L.gridSurface), gr = window._micro.layers().find((L) => L.name === 'grade.asc'); window._micro.recolorSurface(topo, gr); });
  await ph.waitForTimeout(500);
  const drape = await ph.evaluate(() => { const L = window._micro.layers().find((x) => x.gridSurface); return { drape: L.drapeSource, kind: L.kind, elem: window._micro.renderer.layerElementCount(L.id) }; });
  chk(`surface drapes a second grid's values (topo coloured by grade, geometry intact)`, drape.drape === 'grade.asc' && drape.kind === 'mesh' && drape.elem > 1000);
  // the drape control is on the properties panel too (not just the context menu)
  const propDrape = await ph.evaluate(() => {
    window._micro.setActiveLayer(window._micro.layers().find((L) => L.gridSurface).id); window._micro.openProps();
    const rows = [...document.querySelectorAll('#ppBody .pp-row')];
    const row = rows.find((r) => /drape/i.test(r.querySelector('label') ? r.querySelector('label').textContent : ''));
    const sel = row && row.querySelector('select');
    return { hasDrapeRow: !!sel, value: sel && sel.value, opts: sel ? [...sel.options].map((o) => o.textContent) : [] };
  });
  chk(`properties panel has a drape picker (value "${propDrape.value}", options ${JSON.stringify(propDrape.opts)})`, propDrape.hasDrapeRow && propDrape.value === 'grade.asc' && propDrape.opts.includes('elevation'));
  // flatten: a surface can render as a horizontal sheet at a chosen z (a 2D grid, no DEM)
  const flat = await ph.evaluate(() => {
    const L = window._micro.layers().find((x) => x.gridSurface); window._micro.setSurfaceFlatZ(L, 900);
    const o = window._micro.frame ? window._micro.frame.origin : [0, 0, 0];
    const r = { flatZ: L.surfaceFlatZ, zmin: L.bboxLocal[2] + o[2], zmax: L.bboxLocal[5] + o[2], surface: !!L.gridSurface };
    window._micro.setSurfaceFlatZ(L, null); return r;   // back to relief for the following checks
  });
  chk(`surface flattens to a horizontal sheet at a chosen z (collapsed to z≈900)`, flat.surface && flat.flatZ === 900 && Math.abs(flat.zmin - 900) < 1 && Math.abs(flat.zmax - 900) < 1);
  // shading is a style option: smooth (default) ↔ faceted (flat per-triangle)
  const shade = await ph.evaluate(() => {
    const L = window._micro.layers().find((x) => x.gridSurface);
    const def = L.surfaceSmooth; window._micro.setSurfaceSmooth(L, false); const off = L.surfaceSmooth;
    window._micro.setActiveLayer(L.id); window._micro.openProps();
    const row = [...document.querySelectorAll('#ppBody .pp-row')].find((r) => /shading/i.test(r.querySelector('label') ? r.querySelector('label').textContent : ''));
    const val = row && row.querySelector('select') ? row.querySelector('select').value : '';
    window._micro.setSurfaceSmooth(L, true); return { def, off, val, picker: !!(row && row.querySelector('select')) };
  });
  chk(`surface shading toggles smooth↔faceted (default smooth, properties picker)`, shade.def !== false && shade.off === false && shade.picker && shade.val === 'faceted');
  // surface + drape PERSIST across a project save/reload
  await saveProject(ph);
  await ph.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2surf'); await window._micro.openProjectDir(dir); });
  await ph.waitForFunction(() => window._micro.layers().length === 2, null, { timeout: 60000 });
  await ph.waitForTimeout(600);
  const reloaded = await ph.evaluate(() => { const L = window._micro.layers().find((x) => x.name === 'terrain.asc'); return { surface: !!(L && L.gridSurface), drape: L && L.drapeSource, kind: L && L.kind }; });
  chk(`surface + drape persist across a project reload (${JSON.stringify(reloaded)})`, reloaded.surface && reloaded.drape === 'grade.asc' && reloaded.kind === 'mesh');
  // ── SCENE round-trip: a scene must restore the FULL surface state (surface · drape · relief/flat ·
  //    smooth/faceted · band), not just vis/colour/filter. captureLayerSurface is the SINGLE source both
  //    the manifest AND scenes serialize through — this guards the "we wired the manifest but forgot the
  //    scene" class of bug: dress every field, snapshot, disturb every field, apply → all must come back.
  const sceneCap = await ph.evaluate(() => {
    const L = window._micro.layers().find((x) => x.name === 'terrain.asc');
    window._micro.setSurfaceSmooth(L, false);                         // dress: faceted (drape already grade.asc, relief)
    const s = window._micro.captureScene('surf-scene', false);
    window._micro._stashScene = s;
    const sl = s.layers.find((x) => x.name === 'terrain.asc');
    return { gridSurface: !!sl.gridSurface, drape: sl.drape || null, faceted: !!sl.faceted };
  });
  chk(`scene captures the full surface state (surface+drape+faceted), not just vis/colour`, sceneCap.gridSurface && sceneCap.drape === 'grade.asc' && sceneCap.faceted === true);
  await ph.evaluate(async () => {                                     // disturb EVERY captured field
    const L = window._micro.layers().find((x) => x.name === 'terrain.asc');
    window._micro.setSurfaceFlatZ(L, 500);                            // relief → flat
    window._micro.setSurfaceSmooth(L, true);                          // faceted → smooth
    window._micro.recolorSurface(L, null);                            // drape → none
    await window._micro.applyScene(window._micro._stashScene);        // and put it all back
  });
  await ph.waitForTimeout(500);
  const sceneBack = await ph.evaluate(() => {
    const L = window._micro.layers().find((x) => x.name === 'terrain.asc');
    return { surface: !!(L && L.gridSurface), drape: (L && L.drapeSource) || null, flatZ: L && L.surfaceFlatZ != null ? L.surfaceFlatZ : null, faceted: !!(L && L.surfaceSmooth === false), kind: L && L.kind };
  });
  chk(`applying a scene RESTORES surface+drape+relief+faceted (${JSON.stringify(sceneBack)})`, sceneBack.surface && sceneBack.drape === 'grade.asc' && sceneBack.flatZ === null && sceneBack.faceted === true && sceneBack.kind === 'mesh');
  await ph.close();
}

// ═══ 11. multi-band GeoTIFF: pick the band (grid ≈ columns) — anytime, in the
//     properties panel, re-reading the right sample; persists ═══
{
  const pm = await mkPage('sm2band');
  const tif = twoBandTiff();
  await pm.evaluate((arr) => window._micro.openBlob(new Blob([new Uint8Array(arr)]), 'multiband.tif', 'replace'), Array.from(tif));
  await pm.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.gridDoc, null, { timeout: 30000 });
  const b0 = await pm.evaluate(() => { const g = window._micro.layers()[0].docs.gridDoc.grid; return { bands: g.bands, band: g.band, v: g.data[Math.floor(g.data.length * 0.4)] }; });
  chk(`multi-band GeoTIFF detected (${b0.bands} bands, showing band ${b0.band + 1})`, b0.bands === 2 && b0.band === 0);
  await pm.evaluate(() => window._micro.setGridBand(window._micro.layers()[0], 1));
  await pm.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.gridDoc.grid.band === 1, null, { timeout: 30000 });
  const b1 = await pm.evaluate(() => {
    const L = window._micro.layers()[0], g = L.docs.gridDoc.grid;
    window._micro.setActiveLayer(L.id); window._micro.openProps();
    const row = [...document.querySelectorAll('#ppBody .pp-row')].find((r) => /band/i.test(r.querySelector('label') ? r.querySelector('label').textContent : ''));
    return { band: g.band, v: g.data[Math.floor(g.data.length * 0.4)], picker: !!(row && row.querySelector('select')), opts: row && row.querySelector('select') ? row.querySelector('select').options.length : 0 };
  });
  chk(`band pick re-reads the right sample (band0 ${b0.v.toFixed(1)} → band1 ${b1.v.toFixed(1)}) + properties picker`, b1.band === 1 && Math.abs(b0.v - b1.v) > 1 && b1.picker && b1.opts === 2);
  await saveProject(pm);
  await pm.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2band'); await window._micro.openProjectDir(dir); });
  await pm.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.gridDoc, null, { timeout: 60000 });
  const bReload = await pm.evaluate(() => window._micro.layers()[0].docs.gridDoc.grid.band);
  chk(`the chosen band persists across a project reload (band ${bReload + 1})`, bReload === 1);
  await pm.close();
}

// ═══ 12. materialized columns on a block model → GT/swath see them, and the resolver
//     composes (calc references a materialized column; out-of-order calc-on-calc).
//     Interpolation (NN/IDW) was removed — estimation lives in gslib.atra — so the
//     substrate guards now ride on materialize-a-calc-column, not an estimate ═══
{
  const pg = await mkPage('sm2compose');
  // a REGULAR 11×11 block model with a base GRADE = X (a field rising along X)
  const tgt = await pg.evaluate(() => { let s = 'X,Y,Z,GRADE\n'; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) s += `${i * 10},${j * 10},0,${i * 10}\n`; return s; });
  await pg.evaluate((c) => window._micro.openBlob(new Blob([c]), 'model.csv', 'replace'), tgt);
  await pg.waitForFunction(() => window._micro.layers().some((L) => L.name === 'model.csv' && L.docs.blockDoc), null, { timeout: 30000 });
  // materialize a calc column GRADE_M = GRADE → a real MATERIALIZED (non-base) column
  const out = await pg.evaluate(async () => {
    const T = window._micro.layers().find((x) => x.name === 'model.csv');
    window._micro.applyCalcCols(T, [{ name: 'GRADE_M', expr: 'GRADE', ty: 'number' }]);
    await window._micro.materializeCalcCol(T, 'GRADE_M');
    const col = window._micro.matColList(T).find((c) => c.name === 'GRADE_M');
    return { has: !!col, mat: !!(col && col.mat), stillCalc: (T.calcCols || []).some((c) => c.name === 'GRADE_M'), at50: col ? col.fvalues[5 * 11 + 5] : null };
  });
  chk(`materialize-a-calc lands a materialized column on the model (mat ${out.mat}, block(50,50)≈${(out.at50 || 0).toFixed(1)})`,
    out.has && out.mat && !out.stillCalc && Math.abs(out.at50 - 50) < 0.01);
  // GT + swath SEE the materialized column (schemaExt + extendRow); numericColsOf offers it
  const gtsw = await pg.evaluate(async () => {
    const T = window._micro.layers().find((x) => x.name === 'model.csv');
    const offered = window._micro.numericColsOf(T).includes('GRADE_M');
    const gt = await window._micro.computeGT(T, ['GRADE_M'], null, 8, () => {});
    const sw = await window._micro.computeSwath(T, ['GRADE_M'], [1, 0, 0], 12, 0, null, () => {});
    const means = sw ? sw.profile.map((b) => b.mean[0]).filter(Number.isFinite) : [];
    return { offered, gtCuts: gt ? gt.gt[0].length : 0, gtMax: gt ? gt.gmax : 0, swBands: sw ? sw.profile.length : 0, rising: means.length > 2 && means[means.length - 1] > means[0] };
  });
  chk(`GT + swath compute on the materialized column (numericColsOf offers it ${gtsw.offered}; GT ${gtsw.gtCuts} cuts, gmax ${(gtsw.gtMax || 0).toFixed(0)}; swath ${gtsw.swBands} bands, rising ${gtsw.rising})`,
    gtsw.offered && gtsw.gtCuts === 9 && gtsw.gtMax > 50 && gtsw.swBands > 2 && gtsw.rising);
  // THE COMPOSITION GAP (resolver): a calc column referencing the MATERIALIZED column,
  // then materialized — the exact case that failed pre-resolver (calc saw base only)
  const matc = await pg.evaluate(async () => {
    const T = window._micro.layers().find((x) => x.name === 'model.csv');
    window._micro.applyCalcCols(T, [{ name: 'DBL', expr: 'GRADE_M * 2', ty: 'number' }]);
    const wasCalc = (T.calcCols || []).some((c) => c.name === 'DBL');
    await window._micro.materializeCalcCol(T, 'DBL');
    const col = window._micro.matColList(T).find((c) => c.name === 'DBL');
    return { wasCalc, mat: !!(col && col.mat), stillCalc: (T.calcCols || []).some((c) => c.name === 'DBL'), at50: col ? col.fvalues[5 * 11 + 5] : null, from: col && col.lineage && col.lineage.params.from };
  });
  chk(`calc REFERENCES the materialized column + materializes (DBL = GRADE_M*2 → (50,50)≈${(matc.at50 || 0).toFixed(0)})`,
    matc.wasCalc && matc.mat && !matc.stillCalc && Math.abs(matc.at50 - 100) < 0.01 && matc.from === 'calc');
  // calc-on-calc, dependency-ordered regardless of input order (B2 defined referencing A2)
  const chain = await pg.evaluate(async () => {
    const T = window._micro.layers().find((x) => x.name === 'model.csv');
    window._micro.applyCalcCols(T, [{ name: 'B2', expr: 'A2 * 10', ty: 'number' }, { name: 'A2', expr: 'GRADE_M + 1', ty: 'number' }]);
    window._micro.setActiveLayer(T.id);
    document.querySelector('#filter').value = 'B2 > 500'; await window._micro.applyBlockFilter('B2 > 500');
    const hits = T._filterMask ? T._filterMask.reduce((a, b) => a + b, 0) : -1;
    await window._micro.applyBlockFilter('');
    return { hits };
  });
  chk(`calc-on-calc chains through the resolver, out of input order (B2=A2*10, A2=GRADE_M+1; B2>500 → ${chain.hits} blocks, expect 66)`, chain.hits === 66);
  await pg.close();
}

// ═══ 14. materialized-column store — a full-precision Float32 column persists in the
//     per-layer <layer>.cols/ sidecar (OPFS project) and reloads aligned by record ═══
{
  const pc = await mkPage('sm2matcol');
  const bm = await pc.evaluate(() => { let s = 'X,Y,Z,GRADE\n'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 2; k++) s += `${i * 10},${j * 10},${k * 10},${(i + j + k).toFixed(1)}\n`; return s; });
  await pc.evaluate((csv) => window._micro.openBlob(new File([csv], 'bm.csv'), 'bm.csv', 'replace'), bm);
  await pc.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.blockDoc, null, { timeout: 30000 });
  await saveProject(pc);                                            // copies bm into the project → storage='project'
  const setInfo = await pc.evaluate(() => {
    const L = window._micro.layers()[0]; const cnt = L.docs.blockDoc.header.count;
    const vals = new Float32Array(cnt); for (let i = 0; i < cnt; i++) vals[i] = i * 2;   // EST[i] = i·2
    const col = window._micro.matColSet(L, 'EST', vals, { lineage: { op: 'test' } });
    return { n: cnt, min: col.min, max: col.max };
  });
  chk(`matColSet attaches a full-precision column (${setInfo.n} records, min ${setInfo.min} max ${setInfo.max})`, setInfo.min === 0 && setInfo.max === (setInfo.n - 1) * 2);
  // colour by it (paint path) → legend reads the REAL range [0,62]; filter sees FULL precision (EST>40 → 11 blocks)
  const disp = await pc.evaluate(async () => {
    const L = window._micro.layers()[0]; window._micro.setActiveLayer(L.id);
    const inOpts = [...document.querySelectorAll('#colorBy option')].some((o) => o.value === 'paint:EST');
    window._micro.setLayerColorSel(L, 'paint:EST');
    const range = window._micro.rampRangeFor(L);
    document.querySelector('#filter').value = 'EST > 40'; await window._micro.applyBlockFilter('EST > 40');
    const hits = L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : -1;
    await window._micro.applyBlockFilter('');
    return { inOpts, colorSel: L.colorSel, range, hits };
  });
  chk(`materialized column is colourable (in colorBy ${disp.inOpts}, sel ${disp.colorSel}) with a REAL-range legend [${disp.range[0]}, ${disp.range[1]}]`, disp.inOpts && disp.colorSel === 'paint:EST' && disp.range[0] === 0 && disp.range[1] === 62);
  chk(`filter sees the materialized column at FULL precision (EST>40 → ${disp.hits} blocks)`, disp.hits === 11);
  await saveProject(pc);                                            // the save hook writes the .cols sidecar
  await pc.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2matcol'); await window._micro.openProjectDir(dir); });
  await pc.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.blockDoc, null, { timeout: 60000 });
  await pc.waitForTimeout(400);
  const back = await pc.evaluate(() => {
    const L = window._micro.layers()[0]; const est = window._micro.matColList(L).find((c) => c.name === 'EST');
    return { has: !!est, mat: !!(est && est.mat), n: est ? est.fvalues.length : 0, v0: est ? est.fvalues[0] : null, v5: est ? est.fvalues[5] : null, vlast: est ? est.fvalues[est.fvalues.length - 1] : null };
  });
  chk(`materialized column reloads aligned from the sidecar (EST: ${back.n} records, mat ${back.mat}, [0]=${back.v0} [5]=${back.v5} last=${back.vlast})`, back.has && back.mat && back.v0 === 0 && back.v5 === 10 && back.vlast === (back.n - 1) * 2);
  await pc.close();
}

// ═══ 16. the FILTER WIDGET DRAWER — the expression projected as live controls;
//     widgets rewrite literals SURGICALLY; reset restores the snapshot ═══
{
  const pf = await mkPage('sm2fdrawer');
  const csv = await pf.evaluate(() => {
    let t = 'X,Y,Z,FE,LITO\n'; const LIT = ['HEMATITE', 'ITABIRITE', 'CANGA'];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) for (let k = 0; k < 2; k++)
      t += `${i * 10},${j * 10},${k * 5},${(30 + i * 2.5).toFixed(1)},${LIT[(i + j) % 3]}\n`;
    return t;
  });
  await pf.evaluate((c) => window._micro.openBlob(new Blob([c]), 'fd.csv', 'replace'), csv);
  await pf.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.blockDoc, null, { timeout: 30000 });
  const EXPR = 'FE > 45 and LITO = "HEMATITE"';
  const hits0 = await pf.evaluate(async (e) => {
    document.querySelector('#filter').value = e; await window._micro.applyBlockFilter(e);
    const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++; return h;
  }, EXPR);
  await pf.click('#filterWidgets');                                 // a REAL click — the button must be hittable
  const ui = await pf.evaluate(() => {
    const d = document.querySelector('#fdrawer');
    return { shown: d.classList.contains('show'), sliders: d.querySelectorAll('input[type="range"]').length,
      chips: d.querySelectorAll('.fd-chip').length, on: [...d.querySelectorAll('.fd-chip.on')].map((c) => c.textContent) };
  });
  chk(`filter drawer renders the expression as widgets (${ui.sliders} slider, ${ui.chips} chips, on=${ui.on})`,
    ui.shown && ui.sliders === 1 && ui.chips >= 3 && ui.on.includes('HEMATITE'));
  const drag = await pf.evaluate(async () => {
    const sl = document.querySelector('#fdrawer input[type="range"]');
    sl.value = 60; sl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++;
    return { text: document.querySelector('#filter').value, h };
  });
  chk(`slider drag rewrites the literal SURGICALLY + re-filters live ("${drag.text}" → ${drag.h} hits)`,
    /^FE > (59|60|61)[0-9.]* and LITO = "HEMATITE"$/.test(drag.text) && drag.h > 0 && drag.h < hits0);
  const chip = await pf.evaluate(async () => {
    const other = [...document.querySelectorAll('#fdrawer .fd-chip')].find((c) => !c.classList.contains('on'));
    const v = other.textContent; other.click();
    await new Promise((r) => setTimeout(r, 300));
    return { v, text: document.querySelector('#filter').value };
  });
  chk(`chip click swaps the category literal (→ "${chip.v}")`, chip.text.includes('LITO = "' + chip.v + '"'));
  const rst = await pf.evaluate(async () => {
    [...document.querySelectorAll('#fdrawer .fd-head button')].find((b) => b.textContent === 'reset').click();
    await new Promise((r) => setTimeout(r, 400));
    const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++;
    return { text: document.querySelector('#filter').value, h };
  });
  chk(`reset restores the snapshot exactly ("${rst.text}", ${rst.h} hits == ${hits0})`, rst.text === EXPR && rst.h === hits0);
  // the multiline expression editor: typing there applies (debounced) + re-projects the widgets on commit
  const edt = await pf.evaluate(async () => {
    const ed = document.querySelector('#fdrawer .fd-editor');
    ed.focus(); ed.value = 'FE between 40\n  and 60'; ed.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    ed.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++;
    return { mirrored: document.querySelector('#filter').value.includes('between 40'), sliders: document.querySelectorAll('#fdrawer .fd-body input[type="range"]').length, h, err: document.querySelector('#fdrawer .fd-err').textContent };
  });
  chk(`editor: multiline expr applies + re-projects (mirrored ${edt.mirrored}, ${edt.sliders} range sliders, ${edt.h} hits, err "${edt.err}")`,
    edt.mirrored && edt.sliders === 2 && edt.h > 0 && edt.err === '');
  const edErr = await pf.evaluate(async () => {
    const ed = document.querySelector('#fdrawer .fd-editor');
    ed.focus(); ed.value = 'FE > and'; ed.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return document.querySelector('#fdrawer .fd-editor').classList.contains('err') && document.querySelector('#fdrawer .fd-err').textContent.length > 0;
  });
  chk(`editor: live validation flags a bad expression`, edErr);
  // op dropdowns / clickable joiners / bracket groups — every projected element
  // rewrites its own source span (ops via the cmp op-token span, and/or via the
  // joiner token span, groups via paren extents + insert-before-')').
  await pf.evaluate(async () => {
    const ed = document.querySelector('#fdrawer .fd-editor');
    ed.focus(); ed.value = 'FE > 45 and LITO = "HEMATITE"'; ed.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    ed.dispatchEvent(new Event('change', { bubbles: true })); ed.blur();
    await new Promise((r) => setTimeout(r, 200));
  });
  const opsw = await pf.evaluate(async () => {
    const s2 = [...document.querySelectorAll('#fdrawer .fd-body .fd-opsel')].find((x) => x.value === '>');
    if (!s2) return { text: 'NO OP SELECT' };
    s2.value = '<='; s2.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 400));
    const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++;
    return { text: document.querySelector('#fdrawer .fd-editor').value, h };
  });
  chk(`op dropdown rewrites the op token ("${opsw.text}", ${opsw.h} hits)`,
    opsw.text === 'FE <= 45 and LITO = "HEMATITE"' && opsw.h > 0);
  const jsw = await pf.evaluate(async () => {
    const pill = document.querySelector('#fdrawer .fd-body .fd-op.click');
    if (!pill) return 'NO CLICKABLE PILL';
    pill.click();
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('#fdrawer .fd-editor').value;
  });
  chk(`joiner pill click switches and → or ("${jsw}")`, jsw === 'FE <= 45 or LITO = "HEMATITE"');
  const grp = await pf.evaluate(async () => {
    let add = [...document.querySelectorAll('#fdrawer .fd-body .fd-add')].pop();       // top-level add: seed an and-group
    add.querySelector('.fd-opsel').value = 'and ( … )';
    let col = [...add.querySelectorAll('select')].pop(); col.value = 'n:FE'; col.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 400));
    const boxed = !!document.querySelector('#fdrawer .fd-body .fd-group');
    add = document.querySelector('#fdrawer .fd-body .fd-group .fd-add');               // then add INSIDE the brackets
    if (!add) return { boxed, text: 'NO GROUP ADD' };
    const js = add.querySelector('.fd-opsel'); if (js) js.value = 'or';
    col = [...add.querySelectorAll('select')].pop(); col.value = 'n:FE'; col.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 400));
    return { boxed, text: document.querySelector('#fdrawer .fd-editor').value };
  });
  chk(`bracket seed + add-inside-group ("${grp.text}")`,
    grp.boxed && /or LITO = "HEMATITE" and \(FE > [0-9.]+ or FE > [0-9.]+\)$/.test(grp.text));
  await pf.close();
}


// ═══ 17. the ƒ CALCULATIONS window — authoring moved out of the columns tab;
//     validates vs the FULL schema (calc-on-calc composes); live filter pickup ═══
{
  const pc = await mkPage('sm2calcwin');
  const csv = await pc.evaluate(() => {
    let t = 'X,Y,Z,FE,MN\n';
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) t += `${i * 10},${j * 10},0,${(30 + i * 2.5).toFixed(1)},${(1 + j * 0.1).toFixed(2)}\n`;
    return t;
  });
  await pc.evaluate((c) => window._micro.openBlob(new Blob([c]), 'cw.csv', 'replace'), csv);
  await pc.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.blockDoc, null, { timeout: 30000 });
  const added = await pc.evaluate(async () => {
    window._micro.openCalcWindow(window._micro.layers()[0]);
    document.querySelector('.cw-main input[type=text]').value = 'FE_EQ';
    const ed = document.querySelector('.cw-edwrap textarea'); ed.value = 'FE + 0.4 * MN'; ed.dispatchEvent(new Event('input'));
    [...document.querySelectorAll('.cw-main .awin-btn')].find((x) => x.textContent === 'add column').click();
    await new Promise((r) => setTimeout(r, 400));
    // a second column REFERENCING the first — the old inline form rejected this
    [...document.querySelectorAll('.cw-item')].find((x) => x.textContent === '+ add…').click();
    document.querySelector('.cw-main input[type=text]').value = 'DBL';
    const ed2 = document.querySelector('.cw-edwrap textarea'); ed2.value = 'FE_EQ * 2  # composed'; ed2.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 100));
    const valid = document.querySelector('.cw-err').textContent === '';
    [...document.querySelectorAll('.cw-main .awin-btn')].find((x) => x.textContent === 'add column').click();
    await new Promise((r) => setTimeout(r, 300));
    const L = window._micro.layers()[0];
    return { valid, cols: (L.calcCols || []).map((c) => c.name + ':' + c.ty) };
  });
  chk(`calc window: add + calc-on-calc composes (${added.cols})`,
    added.valid && added.cols.join(',') === 'FE_EQ:number,DBL:number');
  // a calccols RECIPE composes in listed order too (schema recomputed per entry)
  const rcp = await pc.evaluate(() => window._micro.applyCalcCols(window._micro.layers()[0],
    [{ name: 'A1', expr: 'FE * 2' }, { name: 'A2', expr: 'A1 + MN' }]));
  const rcpClean = await pc.evaluate(() => { const L = window._micro.layers()[0]; L.calcCols = L.calcCols.filter((c) => !/^A[12]$/.test(c.name)); L._calcFns = null; return true; });
  chk(`calccols recipe: same-set composition (A2 references A1; ${rcp.applied} applied, bad: [${rcp.bad}])`,
    rcp.applied === 2 && !rcp.bad.length && rcpClean);
  const live = await pc.evaluate(async () => {
    document.querySelector('#filter').value = 'DBL > 100'; await window._micro.applyBlockFilter('DBL > 100');
    const count = () => { const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++; return h; };
    const h0 = count();
    [...document.querySelectorAll('.cw-item')].find((x) => x.textContent.includes('FE_EQ')).click();
    const ed = document.querySelector('.cw-edwrap textarea'); ed.value = 'FE + 10 * MN'; ed.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 100));
    [...document.querySelectorAll('.cw-main .awin-btn')].find((x) => x.textContent === 'save').click();
    await new Promise((r) => setTimeout(r, 500));
    return { h0, h1: count() };
  });
  chk(`calc window: saving a definition re-applies the live filter (${live.h0} → ${live.h1} hits)`,
    live.h0 > 0 && live.h1 > live.h0);
  const tab = await pc.evaluate(() => {
    window._micro.openProps(window._micro.layers()[0].id);
    [...document.querySelectorAll('.pp-tab')].find((t) => t.textContent === 'columns').click();
    const btns = [...document.querySelectorAll('#ppBody .pp-scan')].map((x) => x.textContent);
    return { top: btns.some((t) => t.startsWith('ƒ calculations… (2')), oldAdd: btns.some((t) => t === 'add calculated column…') };
  });
  chk('columns tab: ƒ button at the top, inline form retired', tab.top && !tab.oldAdd);
  // the projection widgets: an if() ladder → a CASE TABLE (condition chips |
  // value slider | else | add case); widget edits rewrite the expression text
  // and AUTO-SAVE an existing column. Arithmetic → tunable constant sliders.
  const proj = await pc.evaluate(async () => {
    const L = window._micro.layers()[0];
    L.calcCols.push({ name: 'DENS', expr: 'if(FE > 60, 3.9, 2.8)', ty: 'number' });
    L._calcFns = null;
    [...document.querySelectorAll('.cw-item')].pop();       // rail is stale — rerender via select
    window._micro.openCalcWindow(L, 2);
    // openCalcWindow reuses the live window: select(2) re-renders
    await new Promise((r) => setTimeout(r, 300));
    const cases = document.querySelectorAll('.cw-proj .cw-case').length;
    const hasElse = !!document.querySelector('.cw-proj .cw-else');
    // edit the first case's value via its number input → text rewrite + auto-save
    const nb = document.querySelectorAll('.cw-proj .cw-val input[type=number]')[0];
    nb.value = '4.1'; nb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 700));
    return { cases, hasElse, text: document.querySelector('.cw-edwrap textarea').value, saved: L.calcCols[2].expr };
  });
  chk(`calc projection: if-ladder case table (${proj.cases} rows) + value edit auto-saves ("${proj.saved}")`,
    proj.cases === 2 && proj.hasElse && proj.text === 'if(FE > 60, 4.1, 2.8)' && proj.saved === 'if(FE > 60, 4.1, 2.8)');
  // color-by-ƒ: picking the calc channel realizes it (ephemeral display cache →
  // the ratio-paint codes path); the choice AND a ƒ filter survive a project
  // reload (restore order: calcCols land BEFORE filter/color re-apply)
  const cc0 = await pc.evaluate(async () => {
    const cb = document.querySelector('#colorBy');
    const has = [...cb.options].some((o) => o.value === 'calc:DENS');
    cb.value = 'calc:DENS'; cb.dispatchEvent(new Event('change'));
    return has;
  });
  await pc.waitForFunction(() => { const L = window._micro.layers()[0]; return L._calcDisplay && L._calcDisplay.name === 'DENS' && !L._calcDisplayBusy; }, null, { timeout: 15000 });
  const cd0 = await pc.evaluate(() => { const c = window._micro.layers()[0]._calcDisplay.col; return { n: c.codes.length, min: c.min, max: c.max }; });
  chk(`color-by-ƒ: option + realization (${cd0.n} codes, [${cd0.min}, ${cd0.max}])`, cc0 && cd0.n === 400 && Math.abs(cd0.min - 2.8) < 1e-5 && Math.abs(cd0.max - 4.1) < 1e-5);
  await saveProject(pc);
  await pc.close();
  const pc2 = await mkPage('sm2calcwin');
  await pc2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2calcwin'); await window._micro.openProjectDir(dir); });
  await pc2.waitForFunction(() => { const L = window._micro.layers()[0]; return L && L._calcDisplay && L._calcDisplay.name === 'DENS' && !L._calcDisplayBusy; }, null, { timeout: 60000 });
  const rt = await pc2.evaluate(() => {
    const L = window._micro.layers()[0]; let h = 0; if (L._filterMask) for (const m of L._filterMask) if (m) h++;
    return { sel: L.colorSel, hits: h, filter: document.querySelector('#filter').value, cols: (L.calcCols || []).length };
  });
  chk(`ƒ round-trip: calc color + ƒ filter survive reload (${rt.sel}, "${rt.filter}", ${rt.hits} hits, ${rt.cols} ƒ)`,
    rt.sel === 'calc:DENS' && /DBL > 100/.test(rt.filter) && rt.hits > 0 && rt.cols === 3);
  // the ELEMENT MANIFEST (substrate Appendix A): <layer>.element.json is the
  // data-model artifact — v1, hoisted ops[], ƒ columns as derived defs
  const em = await pc2.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2calcwin');
    const models = await dir.getDirectoryHandle('models');
    const man = JSON.parse(await (await (await models.getFileHandle('cw.csv.element.json')).getFile()).text());
    return { v: man.v, ops: man.ops.filter((o) => o.op === 'calc').length, derived: man.columns.filter((c) => c.from === 'derived').length, loc: Object.keys(man.locations)[0] };
  });
  chk(`element.json on disk: v${em.v}, ${em.ops} calc ops → ${em.derived} derived columns at "${em.loc}"`,
    em.v === 1 && em.ops === 3 && em.derived === 3 && em.loc === 'cells');
  await pc2.close();
}

// ═══ 18. DRILLHOLES as the first MULTI-LOCATION element (substrate spec A.3):
//     one <set>.element.json — collars + vertices(producedBy) + one interval
//     location per break-set (geometryFrom), HOLEID relations, per-location ƒ ═══
{
  const pd = await mkPage('sm2dhelem');
  await pd.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2dhelem', { recursive: true }); } catch { } });
  await pd.evaluate(async () => {
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE'], litho = ['HOLEID,FROM,TO,LITO'];
    for (let n2 = 1; n2 <= 5; n2++) {
      const id = 'DH' + n2;
      collar.push(`${id},${100 + n2 * 40},100,300,${100 + n2 * 10}`); survey.push(`${id},0,0,-90`);
      for (let d = 0; d < 80; d += 10) { assay.push(`${id},${d},${d + 10},${(30 + n2 + d * 0.1).toFixed(1)}`); litho.push(`${id},${d},${d + 10},${d < 40 ? 'OX' : 'FR'}`); }
    }
    const f = (a, nm) => new File([a.join('\n')], nm, { type: 'text/csv' });
    await window._micro.importDrillholes({ collar: f(collar, 'collars.csv'), survey: f(survey, 'survey.csv'), intervals: f(assay, 'assay.csv') }, {}, 'replace');
    const A = window._micro.layers()[0]; A._setKey = 'k'; A._intervalName = 'assay.csv'; A.storage = 'project';
    A.calcCols = [{ name: 'FE2', expr: 'FE * 2', ty: 'number' }];
    await window._micro.importDrillholes({ collar: f(collar, 'collars.csv'), survey: f(survey, 'survey.csv'), intervals: f(litho, 'litho.csv') }, {}, 'add');
    const B2 = window._micro.layers()[1]; B2._setKey = 'k'; B2._intervalName = 'litho.csv'; B2.storage = 'project';
  });
  await pd.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers().every((L) => L.docs.dhDoc), null, { timeout: 30000 });
  await saveProject(pd);
  const dman = await pd.evaluate(async () => {
    const dh = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dhelem')).getDirectoryHandle('drillholes');
    const names = []; for await (const k of dh.keys()) names.push(k);
    const el = names.find((n2) => /\.element\.json$/.test(n2));
    const m2 = el ? JSON.parse(await (await (await dh.getFileHandle(el)).getFile()).text()) : null;
    return m2 && {
      locs: Object.keys(m2.locations), holes: m2.locations.collars.count, produced: m2.locations.vertices.producedBy,
      geomFrom: m2.locations.intervals_assay && m2.locations.intervals_assay.geometryFrom,
      rels: m2.relations.every((r) => r.parent === 'collars' && r.key === 'HOLEID'),
      eoh: m2.columns.some((c) => c.loc === 'collars' && c.name === 'EOH' && c.type === 'number'),
      fe2loc: (m2.columns.find((c) => c.name === 'FE2') || {}).loc,
    };
  });
  chk(`dh SET element.json: 4 locations (${dman && dman.locs}), ${dman && dman.holes} holes, vertices producedBy ${dman && dman.produced}, ƒ at ${dman && dman.fe2loc}`,
    !!dman && dman.locs.length === 4 && dman.holes === 5 && dman.produced === 'ds1' && dman.geomFrom === 'ds1' && dman.rels && dman.eoh && dman.fe2loc === 'intervals_assay');
  await pd.close();
  const pd2 = await mkPage('sm2dhelem');
  await pd2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dhelem'); await window._micro.openProjectDir(dir); });
  await pd2.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers().every((L) => L.docs.dhDoc), null, { timeout: 60000 });
  const dback = await pd2.evaluate(() => {
    const A = window._micro.layers().find((L) => /assay/.test(L.name)), B2 = window._micro.layers().find((L) => /litho/.test(L.name));
    return { set: A && A._setPath, a: A ? (A.calcCols || []).map((c) => c.name).join() : '', b: B2 ? (B2.calcCols || []).length : -1 };
  });
  chk(`dh set restores from the element descriptor (${dback.set}; ƒ "${dback.a}" on assay only, ${dback.b} on litho)`,
    /\.element\.json$/.test(dback.set) && dback.a === 'FE2' && dback.b === 0);
  // BROADCAST — the first cross-location op: a collar column lands on the
  // intervals by the hole-id key (numeric → materialized; the op records
  // inputs [{loc:'collars', column}])
  const bc = await pd2.evaluate(async () => {
    const A = window._micro.layers().find((L) => /assay/.test(L.name));
    window._micro.setActiveLayer(A.id);
    await window._micro.broadcastCollarCol(A, 'EOH');
    await window._micro.applyBlockFilter('EOH > 125');
    let h = 0; for (const m of A._filterMask) if (m) h++;
    const man2 = await window._micro.buildDhSetManifest(window._micro.layers());
    const op2 = man2.ops.find((o) => o.op === 'broadcast');
    return { hits: h, op: !!(op2 && op2.inputs && op2.inputs[0].loc === 'collars' && op2.inputs[0].column === 'EOH') };
  });
  chk(`broadcast: collar EOH → intervals, filterable (${bc.hits} hits) + op with cross-location inputs`,
    bc.hits === 24 && bc.op);   // EOH = 110..150 by 10; > 125 → holes 3–5 × 8 intervals
  // CROSS-LOCATION FILTER PROPAGATION: a collars predicate masks the intervals
  // through the key relation — no materialization — and ANDs with the filter
  const hf = await pd2.evaluate(async () => {
    const A = window._micro.layers().find((L) => /assay/.test(L.name));
    window._micro.setActiveLayer(A.id);
    await window._micro.applyBlockFilter('');
    const r = await window._micro.applyHoleFilter(A, 'EOH > 125');
    let h0 = 0; for (const m of A._filterMask) if (m) h0++;
    await window._micro.applyBlockFilter('FE > 34');
    let h1 = 0; for (const m of A._filterMask) if (m) h1++;
    await window._micro.applyHoleFilter(A, '');
    await window._micro.applyBlockFilter('');
    return { holes: r.holes, h0, h1 };
  });
  chk(`hole filter: EOH > 125 → ${hf.holes} holes → ${hf.h0} intervals; AND FE > 34 → ${hf.h1}`,
    hf.holes === 3 && hf.h0 === 24 && hf.h1 > 0 && hf.h1 < 24);
  // the SET GROUP is the element in the tree: single-interval loads group too,
  // with collar/survey info rows whose menus carry the location verbs
  const tg = await pd2.evaluate(() => {
    const grp = window._micro.layerTree().find((x) => typeof x !== 'number' && x.dhSet);
    const infoRows = [...document.querySelectorAll('#lpRows .lp-row.lp-info .lp-name')].map((x) => x.textContent);
    const nd = grp; if (nd) { window._micro.collarsRowMenu(nd, 200, 200); }
    const menu = [...document.querySelectorAll('.menu .item')].map((x) => x.textContent.trim());
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    return { grp: !!grp, infoRows, hasVerbs: menu.some((x) => /Filter holes/.test(x)) && menu.some((x) => /Broadcast/.test(x)) && menu.some((x) => /Attribute table/.test(x)) };
  });
  chk(`dh tree: set group + collar/survey rows (${tg.infoRows.join(', ')}) + collars-row verbs`,
    tg.grp && tg.infoRows.length >= 2 && tg.hasVerbs);
  await pd2.close();
}

// ═══ 19. JOIN → COLUMNS (the cardinality rule): key joins and own-lattice
//     spatial joins land as columns ON the layer, never a new layer; ops
//     record cross-ELEMENT inputs ═══
{
  const pj = await mkPage('sm2join');
  await pj.evaluate(async () => {
    let a = 'X,Y,Z,FE,ID\n', b2 = 'X,Y,Z,AU,ID\n';
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { a += `${5 + i * 10},${5 + j * 10},5,${30 + i},R${i}_${j}\n`; b2 += `${5 + i * 10},${5 + j * 10},5,${(i * 0.1).toFixed(1)},R${i}_${j}\n`; }
    await window._micro.openBlob(new Blob([a]), 'left.csv', 'replace');
    await new Promise((r) => setTimeout(r, 300));
    await window._micro.openBlob(new Blob([b2]), 'right.csv', 'add');
  });
  await pj.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers()[1].docs.blockDoc, null, { timeout: 30000 });
  const jc = await pj.evaluate(async () => {
    const [L, R] = window._micro.layers();
    window._micro.setActiveLayer(L.id);
    const outs = await window._micro.spatialJoinToCols(L, R, { target: 'left', cols: ['right:AU'], ops: {}, weights: {} });
    const { outs: kOuts, matched } = await window._micro.keyJoinToCols(L, R, { leftKey: 'ID', rightKey: 'ID', bring: ['AU'], dup: 'first' });
    await window._micro.applyBlockFilter('AU > 0.55 and ' + kOuts[0] + ' > 0.55');
    let h = 0; for (const m of L._filterMask) if (m) h++;
    const man2 = window._micro.buildElementManifest(L);
    const xel = man2.ops.filter((o) => o.inputs && o.inputs[0].element === 'right.csv').map((o) => o.op).sort();
    return { outs, kOuts, matched, layers: window._micro.layers().length, hits: h, xel };
  });
  chk(`join → columns: spatial ${jc.outs} + key ${jc.kOuts} (${jc.matched} matched), NO new layer, filter ${jc.hits} hits, ops [${jc.xel}]`,
    jc.outs.join() === 'AU' && jc.kOuts.join() === 'right_AU' && jc.matched === 100 && jc.layers === 2 && jc.hits === 40 && jc.xel.join() === 'estimate,key-lookup');
  // TYPED sidecars: an op-produced CATEGORY column materializes to a STRING
  // Parquet in .cols/ (not project.json RLE) and reloads with dict + lineage
  await pj.evaluate(async () => {
    const [L, R] = window._micro.layers();
    let b2 = 'X,Y,Z,DOM,ID\n';
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) b2 += `${5 + i * 10},${5 + j * 10},5,${i < 5 ? 'OX' : 'FR'},R${i}_${j}\n`;
    await window._micro.openBlob(new Blob([b2]), 'doms.csv', 'add');
    await new Promise((r) => setTimeout(r, 400));
    const D = window._micro.layers()[2];
    window._micro.setActiveLayer(L.id);
    await window._micro.keyJoinToCols(L, D, { leftKey: 'ID', rightKey: 'ID', bring: ['DOM'], dup: 'first' });
    L.storage = 'project';
  });
  await saveProject(pj);
  const tc = await pj.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2join');
    const models = await dir.getDirectoryHandle('models');
    const cols = await models.getDirectoryHandle('left.csv.cols');
    const names = []; for await (const k of cols.keys()) names.push(k);
    const pj2 = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const rle = ((pj2.layers.find((l) => /left/.test(l.source)) || {}).paintCols || []).map((c) => c.name);
    return { hasDom: names.includes('DOM.parquet'), rle };
  });
  chk(`typed sidecar: DOM.parquet written as a STRING column, not RLE (rle: [${tc.rle}])`, tc.hasDom && !tc.rle.includes('DOM'));
  await pj.close();
  const pj2 = await mkPage('sm2join');
  await pj2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2join'); await window._micro.openProjectDir(dir); });
  await pj2.waitForFunction(() => { const L = window._micro.layers().find((x) => /left/.test(x.name)); return L && (L.paintCols || []).some((c) => c.name === 'DOM' && c.dict.length > 2); }, null, { timeout: 60000 });
  const tr = await pj2.evaluate(async () => {
    const L = window._micro.layers().find((x) => /left/.test(x.name));
    window._micro.setActiveLayer(L.id);
    const dom = L.paintCols.find((c) => c.name === 'DOM');
    await window._micro.applyBlockFilter('DOM = "FR"');
    let h = 0; for (const m of L._filterMask) if (m) h++;
    return { dict: dom.dict.slice(1).sort().join(), lin: dom.lineage && dom.lineage.op, hits: h };
  });
  chk(`typed sidecar reload: dict [${tr.dict}], lineage ${tr.lin}, filter ${tr.hits} hits`, tr.dict === 'FR,OX' && tr.lin === 'key-lookup' && tr.hits === 50);
  // GOVERNED residency: matcol fvalues are evictable under the pin budget and
  // re-fault from the sidecar at the next scan that needs them
  const gv = await pj2.evaluate(async () => {
    const L = window._micro.layers().find((x) => /left/.test(x.name));
    window._micro.setActiveLayer(L.id);
    window._micro.setPinBudget(0.000001);                  // ~1 byte → everything evicts
    const evicted = L.paintCols.find((c) => c.name === 'AU').fvalues === null;
    window._micro.setPinBudget('auto');
    await window._micro.applyBlockFilter('AU > 0.55');
    let h = 0; for (const m of L._filterMask) if (m) h++;
    return { evicted, hits: h, back: !!L.paintCols.find((c) => c.name === 'AU').fvalues };
  });
  chk(`governed residency: evicted matcol re-faults from the sidecar on filter (${gv.hits} hits)`, gv.evicted && gv.back && gv.hits === 40);
  await pj2.close();
}

// ═══ 20. ARRAY-BACKED grid locations: a grid emits its element manifest —
//     records are lattice nodes, coords IMPLICIT (no coord columns) ═══
{
  const pg = await mkPage('sm2gelem');
  await pg.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2gelem', { recursive: true }); } catch { } });
  await pg.evaluate(async () => {
    let t = 'ncols 12\nnrows 8\nxllcorner 0\nyllcorner 0\ncellsize 50\nNODATA_value -9999\n';
    for (let r = 0; r < 8; r++) t += Array.from({ length: 12 }, (_, c) => 100 + r + c).join(' ') + '\n';
    await window._micro.openBlob(new Blob([t]), 'dem.asc', 'replace');
  });
  await pg.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.gridDoc, null, { timeout: 30000 });
  await pg.evaluate(() => { window._micro.layers()[0].storage = 'project'; });
  await saveProject(pg);
  const ge = await pg.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2gelem');
    const man = JSON.parse(await (await (await (await dir.getDirectoryHandle('grids')).getFileHandle('dem.asc.element.json')).getFile()).text());
    const n2 = man.locations.nodes;
    return { v: man.v, kind: man.geometry.kind, storage: n2.storage, count: n2.count, lat: n2.lattice && n2.lattice.nx === 12 && n2.lattice.dx === 50, noCoords: !n2.coords, col: man.columns[0] && man.columns[0].loc === 'nodes' };
  });
  chk(`grid element: array-backed nodes (${ge.count} records, coords implicit from the lattice)`,
    ge.v === 1 && ge.kind === 'grid' && ge.storage === 'array' && ge.count === 96 && ge.lat && ge.noCoords && ge.col);
  await pg.close();
}

// ═══ 21. the ROUTINE: recipes running recipes — each-block expansion,
//     $var substitution, dated report routing, the no-overwrites guard ═══
{
  const pr = await mkPage('sm2routine');
  await pr.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2routine', { recursive: true }); } catch { } });
  await pr.evaluate(() => {
    let t = 'X,Y,Z,FE,SG\n';
    for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) t += `${5 + i * 10},${5 + j * 10},5,${(30 + i * 2).toFixed(1)},${(2.5 + i * 0.05).toFixed(2)}\n`;
    return window._micro.openBlob(new Blob([t]), 'm.csv', 'replace');
  });
  await pr.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.blockDoc, null, { timeout: 30000 });
  await pr.evaluate(() => { window._micro.layers()[0].storage = 'project'; });
  await saveProject(pr);
  const rt = await pr.evaluate(async () => {
    window._micro._recipesList().push({ name: 'gt std', tool: 'gt', params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: 'FE' }], nCut: 6 } });
    await window._micro.runRoutine({ name: 'month', tool: 'routine', params: {
      steps: [{ each: { grade: ['FE'] }, steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$grade' }] }] }],
    } });
    const meta1 = document.querySelector('#meta').textContent;
    await window._micro.runRoutine({ name: 'month', tool: 'routine', params: {
      steps: [{ guard: 'no-overwrites' }, { each: { grade: ['FE'] }, steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$grade' }] }] }],
    } });
    const meta2 = document.querySelector('#meta').textContent;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    const day = new Date().toISOString().slice(0, 10);
    const rep = await (await dir.getDirectoryHandle('reports')).getDirectoryHandle(day);
    const names = []; for await (const k of rep.keys()) names.push(k);
    return { meta1, meta2, names };
  });
  chk(`routine: each-expansion runs + report written (${rt.names}) + guard stops the re-run`,
    /1 report/.test(rt.meta1) && rt.names.join() === 'gt-std-fe.tsv' && /guard stopped/.test(rt.meta2));

  // §21b — the routine EDITOR: Save writes YAML that loadRecipes reads back;
  // reopening restores the guard (the file is the truth, the window a view)
  const ed = await pr.evaluate(async () => {
    window._micro.openRoutineWindow(null);
    const el = document.querySelector('.fwin[data-routine]');
    el.querySelector('input[placeholder="month-end"]').value = 'edited';
    el.querySelector('#rwGuard').checked = true; el.querySelector('#rwGuard').dispatchEvent(new Event('change'));
    const sel = el.querySelector('.rw-step select');
    sel.value = 'gt std'; sel.dispatchEvent(new Event('change'));
    [...el.querySelectorAll('button')].find((x) => x.textContent === 'Save').click();
    await new Promise((r) => { const iv = setInterval(() => { if (/saved routine/.test(document.querySelector('#meta').textContent)) { clearInterval(iv); r(); } }, 100); });
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    const yml = await (await (await (await dir.getDirectoryHandle('recipes')).getFileHandle('edited.yaml')).getFile()).text();
    window._micro._recipesList().length = 0;
    await window._micro.loadRecipes(dir);
    const back = window._micro._recipesList().find((x) => x.name === 'edited');
    el.remove();
    let guardBack = false;
    if (back) {
      window._micro.openRoutineWindow(back);
      const el2 = document.querySelector('.fwin[data-routine]');
      guardBack = el2 && el2.querySelector('#rwGuard').checked;
      if (el2) el2.remove();
    }
    return { hasTool: /tool: "routine"/.test(yml), hasGuard: /guard: "no-overwrites"/.test(yml), loaded: !!back, guardBack };
  });
  chk('routine editor: Save → YAML → loadRecipes → reopen restores the guard',
    ed.hasTool && ed.hasGuard && ed.loaded && ed.guardBack);

  // §21c — inputs: a recipe with `inputs:` generates the ask-me-first dialog;
  // Run substitutes $vars (typed for number inputs) and executes
  const inp = await pr.evaluate(async () => {
    window._micro._recipesList().push({ name: 'ask', tool: 'gt', file: 'recipes/ask.yaml',
      inputs: [{ name: 'grade', type: 'column' }, { name: 'n', type: 'number', default: 5 }],
      params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: '$grade' }], nCut: '$n' } });
    window._micro.runRecipe(window._micro._recipesList().find((x) => x.name === 'ask'), true);
    const dlg = document.querySelector('.fwin[data-inputs-dialog]');
    if (!dlg) return { dlg: false };
    const opts = [...dlg.querySelector('select').options].map((o) => o.value);
    dlg.querySelector('select').value = 'FE';
    [...dlg.querySelectorAll('button')].find((x) => x.textContent === 'Run').click();
    const t0 = Date.now();
    let w;
    while (Date.now() - t0 < 60000) {
      w = [...document.querySelectorAll('.fwin')].find((x) => x._tableTSV && x._tableTSV());
      if (w) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const tsv = w ? w._tableTSV() : '';
    document.querySelectorAll('.fwin').forEach((x) => x.remove());
    return { dlg: true, opts: opts.join(','), head: tsv.split('\n')[0], rows: tsv.split('\n').length - 1 };
  });
  chk(`inputs: dialog generated (cols ${inp.opts}) + substituted run (${inp.head} · ${inp.rows} rows)`,
    inp.dlg && /FE/.test(inp.opts) && /FE/.test(inp.head || '') && inp.rows === 6);

  // §21d — inline steps (tool: instead of recipe: — a batch from scratch,
  // nothing pre-recorded) + a routine's own inputs: gate the run
  const inl = await pr.evaluate(async () => {
    await window._micro.runRoutine({ name: 'scratch', tool: 'routine', params: {
      steps: [{ each: [{ g: 'FE' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }], nCut: 4, as: 'inline' }] }],
    } });
    const meta = document.querySelector('#meta').textContent;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    const day = new Date().toISOString().slice(0, 10);
    const rep = await (await dir.getDirectoryHandle('reports')).getDirectoryHandle(day);
    const names = []; for await (const k of rep.keys()) names.push(k);
    window._micro._recipesList().push({ name: 'ask-routine', tool: 'routine', file: 'recipes/ar.yaml',
      inputs: [{ name: 'g2', type: 'column' }],
      params: { steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g2' }] }] } });
    window._micro.runRecipe(window._micro._recipesList().find((x) => x.name === 'ask-routine'), true);
    const dlg = !!document.querySelector('.fwin[data-inputs-dialog]');
    document.querySelectorAll('.fwin').forEach((x) => x.remove());
    return { meta, names: names.join(','), dlg };
  });
  chk(`inline step ran from scratch (${inl.names}) + routine inputs gate the run`,
    /1 report/.test(inl.meta) && /inline-fe\.tsv/.test(inl.names) && inl.dlg);

  // §21e — the run tracker walks the expansion live and stays as the summary;
  // preview lines open a specific parameterization row configured (not run)
  const trk = await pr.evaluate(async () => {
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    await window._micro.runRoutine({ name: 'trk', tool: 'routine', params: { output: { prefix: 'k-' }, steps: [
      { each: [{ g: 'FE' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }], nCut: 4 }] },
    ] } });
    const el = document.querySelector('.fwin[data-routine-run]');
    const oks = el ? el.querySelectorAll('.rw-state.ok').length : 0;
    const summary = el ? [...el.querySelectorAll('.lbl')].map((x) => x.textContent).join(' ') : '';
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    window._micro.openRoutineWindow({ name: 'trk', tool: 'routine', file: 'recipes/trk.yaml', params: { steps: [
      { each: [{ g: 'FE' }, { g: 'SG' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }] }] },
    ] } });
    const ed = document.querySelector('.fwin[data-routine]');
    [...ed.querySelectorAll('button')].find((x) => x.textContent === 'Preview').click();
    await new Promise((r) => setTimeout(r, 300));
    const lines = [...ed.querySelectorAll('.rw-prevline')];
    const sg = lines.find((x) => /-sg\.tsv/.test(x.textContent) && x.classList.contains('open'));
    if (sg) sg.click();
    await new Promise((r) => setTimeout(r, 800));
    const w = [...document.querySelectorAll('.fwin')].find((x) => !x.dataset.routine && /grade/i.test(x.querySelector('.fwin-head .t')?.textContent || ''));
    const cfg = w ? [...w.querySelectorAll('select')].map((x) => x.value).join(',') : '';
    const ran = w && w._tableTSV && !!w._tableTSV();
    document.querySelectorAll('.fwin').forEach((x) => x.remove());
    return { oks, summary, clicked: !!sg, cfg, ran };
  });
  chk(`run tracker (✓×${trk.oks}, "${trk.summary.trim()}") + preview click opens the SG row configured (${trk.cfg})`,
    trk.oks === 1 && /1 report/.test(trk.summary) && trk.clicked && /SG/.test(trk.cfg) && !trk.ran);

  // §22 — Reload from disk: fresh bytes through the layer's existing config
  const rld = await pr.evaluate(async () => {
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    const L = window._micro.layers()[0];
    const can = window._micro.canReloadLayer(L);
    L.calcCols = [{ name: 'FE2', expr: 'FE * 2', ty: 'number' }];
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    const models = await dir.getDirectoryHandle('models');
    const fh = await models.getFileHandle('m.csv');
    let t = 'X,Y,Z,FE,SG\n';
    for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) t += `${5 + i * 10},${5 + j * 10},5,${(70 + i).toFixed(1)},${(2.5 + i * 0.05).toFixed(2)}\n`;
    const w = await fh.createWritable(); await w.write(t); await w.close();
    await window._micro.reloadLayerFromDisk(L);
    const row = await window._micro.fetchCsvRecord(0, window._micro.layers()[0].docs.blockDoc);
    return { can, fe: +row[3], calc: (window._micro.layers()[0].calcCols || []).map((c) => c.name).join(','), meta: document.querySelector('#meta').textContent };
  });
  chk(`reload from disk: fresh bytes (FE ${rld.fe}) + calc column kept + "${rld.meta}"`,
    rld.can && rld.fe === 70 && rld.calc === 'FE2' && /reloaded/.test(rld.meta));
  await pr.close();
}

// ── §23: the TABLE kind — a coordinate-less CSV is a first-class layer ──
{
  const pt = await mkPage('sm2table');
  await pt.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2table', { recursive: true }); } catch { } });
  await pt.evaluate(() => window._micro.openBlob(new Blob(['DOMAIN,CUTOFF,PRICE\nHEM,55,105\nITA,50,98\nCANGA,45,80\nWASTE,0,0\n']), 'cutoffs.csv', 'replace'));
  await pt.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].kind === 'table', null, { timeout: 20000 });
  const tb = await pt.evaluate(async () => {
    const L = window._micro.layers()[0];
    window._micro.setActiveLayer(L.id);
    await window._micro.applyBlockFilter('CUTOFF > 45');
    const hits = L._filterCount;
    window._micro.applyCalcCols(L, [{ name: 'NET', expr: 'PRICE * 0.9', ty: 'number' }]);
    L.storage = 'project';
    return { kind: L.kind, rows: L.docs.tableDoc.header.count, hits, spatial: !!window._micro.gridAxesOf(L), calc: (L.calcCols || []).length };
  });
  await saveProject(pt);
  const rt = await pt.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2table');
    const man = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const names = []; for await (const k of (await dir.getDirectoryHandle('tables')).keys()) names.push(k);
    window.showDirectoryPicker = async () => dir;
    await window._micro.openProjectDir();
    await new Promise((r) => setTimeout(r, 1500));
    const L = window._micro.layers()[0];
    return { manKind: man.layers[0].kind, inTables: names.includes('cutoffs.csv'), kind: L.kind, filter: L.filterExpr, calc: (L.calcCols || []).length };
  });
  chk(`table kind: coordinate-less CSV → table layer (${tb.rows} rows), filter ${tb.hits}/4, ƒ column, no spatial verbs`,
    tb.kind === 'table' && tb.rows === 4 && tb.hits === 2 && !tb.spatial && tb.calc === 1);
  chk(`table kind: project round-trip (manifest kind=${rt.manKind}, tables/ folder, filter + ƒ restored)`,
    rt.manKind === 'table' && rt.inTables && rt.kind === 'table' && rt.filter === 'CUTOFF > 45' && rt.calc === 1);
  await pt.close();
}

// ── §24: Excel — a worksheet is a table (typed), geometry only when asked ──
{
  const px = await mkPage('sm2xlsx');
  await px.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2xlsx', { recursive: true }); } catch { } });
  // build the workbook IN THE PAGE with @gcu/sheet's writer (micro bundles it)
  const built = await px.evaluate(async () => {
    const m = await import('/ext/sheet/index.js');
    const bytes = await m.sheet.write({ sheets: [
      { name: 'Cutoffs', columns: { DOMAIN: ['HEM', 'ITA', 'WASTE'], CUTOFF: [55, 50, 0], PRICE: [105.5, 98, 0] } },
      { name: 'Grid', columns: { X: [0, 10, 20], Y: [0, 0, 10], Z: [5, 5, 5], FE: [61, 58, 44] } },
    ] });
    window._wb = new Blob([bytes]);
    return true;
  });
  const xl = await px.evaluate(async () => {
    await window._micro.openBlob(window._wb, 'book.xlsx', 'replace', null, { sheet: 'Cutoffs' });
    await new Promise((r) => setTimeout(r, 600));
    const L = window._micro.layers()[0];
    const h = L.docs.tableDoc.header;
    window._micro.setActiveLayer(L.id);
    await window._micro.applyBlockFilter('CUTOFF > 45');
    // the COORDINATE sheet must ALSO open as a table — a workbook is not a coordinate system
    await window._micro.openBlob(window._wb, 'book.xlsx', 'add', null, { sheet: 'Grid' });
    await new Promise((r) => setTimeout(r, 600));
    const G = window._micro.layers()[1];
    return {
      kind: L.kind, sheet: h.sheet, rows: h.count, num: h.numericColumns.map((c) => c.name).join(),
      typed: typeof L.docs.tableDoc.xlsx.at(0)[2], hits: L._filterCount,
      gridKind: G.kind, gridSpatial: !!window._micro.gridAxesOf(G),
      promote: window._micro.reinterpretOptions(G).map((o) => o.kind).join(),
    };
  });
  chk(`xlsx: sheet "${xl.sheet}" → table (${xl.rows} rows, numeric ${xl.num} typed from Excel), filter ${xl.hits}/3`,
    xl.kind === 'table' && xl.rows === 3 && xl.num === 'CUTOFF,PRICE' && xl.typed === 'number' && xl.hits === 2);
  chk(`xlsx: an X/Y/Z sheet still opens as a table (geometry offered, never guessed: ${xl.promote})`,
    xl.gridKind === 'table' && !xl.gridSpatial && xl.promote === 'blocks,points');
  await px.close();
}

// ── §25: routine params — a key→value sheet is a SCALAR scope, not a fan-out ──
{
  const pp = await mkPage('sm2params');
  await pp.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2params', { recursive: true }); } catch { } });
  await pp.evaluate(() => window._micro.openBlob(new Blob(['X,Y,Z,FE\n0,0,0,50\n10,0,0,55\n20,0,0,60\n']), 'm.csv', 'replace'));
  await pp.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await pp.evaluate(() => { window._micro.layers()[0].storage = 'project'; });
  await saveProject(pp);
  const pr = await pp.evaluate(async () => {
    const m = await import('/ext/sheet/index.js');
    const bytes = await m.sheet.write({ sheets: [
      // a General series WITH a blank cell — Excel types that column as text,
      // so the routine reader must coerce or $g.cutoff arrives as "55"
      { name: 'General', columns: { parameter: ['cutoff', 'density', 'spare'], value: [55, 2.75, ''] } },
      { name: 'Benches', columns: { grade: ['FE', 'SIO2'], nCut: [12, 8] } },
    ] });
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2params');
    const fh = await dir.getFileHandle('params.xlsx', { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
    const steps = await window._micro.expandRoutine({
      params: [{ from: 'params.xlsx#General', as: 'g', fill: 0 }],
      steps: [
        { tool: 'gt', layer: 'm.csv', nCut: '$g.cutoff', dens: '$g.density', spare: '$g.spare' },
        { each: { from: 'params.xlsx#Benches' }, steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$grade' }], nCut: '$nCut', floor: '$g.cutoff' }] },
      ],
    });
    return {
      scalar: steps[0].nCut, type: typeof steps[0].nCut, dens: steps[0].dens, spare: steps[0].spare,
      fan: steps.slice(1).map((x) => `${x.series[0].col}:${x.nCut}:${x.floor}`).join(','),
      n: steps.length,
    };
  });
  chk(`routine params: a key→value sheet is a scalar scope ($g.cutoff=${pr.scalar} ${pr.type}, fill→${pr.spare}), one run not three`,
    pr.n === 3 && pr.scalar === 55 && pr.type === 'number' && pr.dens === 2.75 && pr.spare === 0);
  chk(`routine params: the scope reaches each-blocks too (${pr.fan})`,
    pr.fan === 'FE:12:55,SIO2:8:55');
  await pp.close();
}

// ── §26: nested each (cross product) vs one each (zip); params as a step ──
{
  const pn = await mkPage('sm2nest');
  await pn.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2nest', { recursive: true }); } catch { } });
  await pn.evaluate(() => window._micro.openBlob(new Blob(['X,Y,Z,FE\n0,0,0,50\n10,0,0,60\n']), 'm.csv', 'replace'));
  await pn.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  const nx = await pn.evaluate(async () => {
    // nested = CROSS PRODUCT
    const cross = await window._micro.expandRoutine({ steps: [
      { each: [{ bench: 1040 }, { bench: 1060 }], as: 'b', steps: [
        { each: [{ grade: 'FE' }, { grade: 'SIO2' }], as: 'g', steps: [
          { tool: 'gt', layer: 'm.csv', b: '$b.bench', g: '$g.grade' },
        ] },
      ] },
    ] });
    // one each, two columns = ZIP
    const zip = await window._micro.expandRoutine({ steps: [
      { each: { bench: [1040, 1060], grade: ['FE', 'SIO2'] }, steps: [{ tool: 'gt', layer: 'm.csv', b: '$bench', g: '$grade' }] },
    ] });
    return {
      cross: cross.map((x) => `${x.g}@${x.b}`).join(','), crossSlugs: cross.map((x) => x._slug).join(','),
      zip: zip.map((x) => `${x.g}@${x.b}`).join(','),
    };
  });
  chk(`routine nesting: nested each = CROSS product (${nx.cross})`,
    nx.cross === 'FE@1040,SIO2@1040,FE@1060,SIO2@1060' && nx.crossSlugs === 'gt-1040-fe,gt-1040-sio2,gt-1060-fe,gt-1060-sio2');
  chk(`routine nesting: one each with two columns stays a ZIP (${nx.zip})`,
    nx.zip === 'FE@1040,SIO2@1060');
  await pn.close();
}

// ── §27: ${expr} in routines — one calculus; values compute, structure doesn't ──
{
  const pe = await mkPage('sm2expr');
  const ex = await pe.evaluate(async () => {
    const steps = await window._micro.expandRoutine({ steps: [
      { each: [{ bench: 1040, grade: 'FE' }, { bench: 1060, grade: 'SIO2' }], as: 'b', steps: [
        { tool: 'gt', layer: 'm.csv', cut: '${b.bench * 0.001}', pick: '${if(b.grade = "FE", 55, 45)}', label: 'bench ${b.bench}' },
      ] },
    ] });
    let typo = null;
    try { await window._micro.expandRoutine({ steps: [{ each: [{ bench: 1 }], as: 'b', steps: [{ tool: 'gt', v: '${b.bnch}' }] }] }); }
    catch (e) { typo = e.message; }
    return {
      n: steps.length, cut: steps[0].cut, t: typeof steps[0].cut,
      picks: steps.map((x) => x.pick).join(','), label: steps[0].label,
      slugs: steps.map((x) => x._slug).join(','), typo,
    };
  });
  chk(`routine \${expr}: typed arithmetic (${ex.cut} ${ex.t}), if() (${ex.picks}), text interpolation ("${ex.label}")`,
    ex.cut === 1.04 && ex.t === 'number' && ex.picks === '55,45' && ex.label === 'bench 1040');
  chk(`routine \${expr}: structure stays static (2 steps, slugs ${ex.slugs}) + a typo fails loudly`,
    ex.n === 2 && ex.slugs === 'gt-1040-fe,gt-1060-sio2' && /unknown column: b\.bnch/.test(ex.typo || ''));
  await pe.close();
}

// ── §28: filter: on an each block — which rows fan out (data selection, not ifs) ──
{
  const pf = await mkPage('sm2eachfilter');
  const ef = await pf.evaluate(async () => {
    const steps = await window._micro.expandRoutine({ steps: [
      { each: [
        { bench: 1020, active: 'true' },
        { bench: 1040, active: 'true' },
        { bench: 1060, active: 'false' },
      ], as: 'b', filter: 'active = "true" and bench >= 1040',
        steps: [{ tool: 'gt', layer: 'm.csv', v: '$b.bench' }] },
    ] });
    const scoped = window._micro.routineFilterRows([{ bench: 1020 }, { bench: 1060 }], 'bench >= g.floor', { g: { floor: 1040 } });
    let typo = null;
    try { window._micro.routineFilterRows([{ bench: 1 }], 'bnch > 1', {}); } catch (e) { typo = e.message; }
    return { n: steps.length, v: steps.map((x) => x.v).join(','), scoped: scoped.map((r) => r.bench).join(','), typo };
  });
  chk(`each filter: 3 rows → ${ef.n} run (${ef.v}); compares against a scalar (${ef.scoped}); a typo fails loudly`,
    ef.n === 1 && ef.v === '1040' && ef.scoped === '1060' && /unknown column: bnch/.test(ef.typo || ''));
  await pf.close();
}

// ── §29: the guard knows COLUMNS · results become table layers · resume ──
{
  const p3 = await mkPage('sm2r3');
  await p3.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2r3', { recursive: true }); } catch { } });
  await p3.evaluate(() => {
    let t = 'X,Y,Z,FE\n';
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) t += `${i * 10},${j * 10},5,${45 + i}\n`;
    return window._micro.openBlob(new Blob([t]), 'm.csv', 'replace');
  });
  await p3.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await p3.evaluate(() => { window._micro.layers()[0].storage = 'project'; });
  await saveProject(p3);
  const g3 = await p3.evaluate(async () => {
    const L = window._micro.layers()[0];
    // the guard must catch a COLUMN overwrite, not just a report file
    window._micro.applyCalcCols(L, [{ name: 'FE_EQ', expr: 'FE * 1.1', ty: 'number' }]);
    window._micro._recipesList().length = 0;
    window._micro._recipesList().push({ name: 'cols', tool: 'calccols', params: { layer: 'm.csv', cols: [{ name: 'FE_EQ', expr: 'FE * 1.1' }] } });
    await window._micro.runRoutine({ name: 'guarded', tool: 'routine', params: { steps: [{ guard: 'no-overwrites' }, { recipe: 'cols' }] } });
    const guardMeta = document.querySelector('#meta').textContent;
    // createPaintCol replaces on name (run-twice == run-once), still refuses to shadow source
    window._micro.createPaintCol(L, 'DOM');
    window._micro.createPaintCol(L, 'DOM');
    const paintN = (L.paintCols || []).filter((c) => c.name === 'DOM').length;
    const shadow = window._micro.createPaintCol(L, 'FE') === null;
    // an analysis result becomes a table layer
    const T = await window._micro.resultToLayer('gt · m.csv', 'cutoff\ttonnes\n0\t900\n55\t300\n');
    return { guardMeta, paintN, shadow, tKind: T.kind, tRows: T.docs.tableDoc.header.count, tLabel: T.label };
  });
  chk(`guard sees COLUMNS ("${g3.guardMeta.slice(0, 60)}…"); paint replaces on name (${g3.paintN}); source still protected`,
    /guard stopped/.test(g3.guardMeta) && /FE_EQ/.test(g3.guardMeta) && g3.paintN === 1 && g3.shadow);
  chk(`analysis result → table layer ("${g3.tLabel}", ${g3.tRows} rows)`,
    g3.tKind === 'table' && g3.tRows === 2);
  const r3 = await p3.evaluate(async () => {
    window._micro._recipesList().length = 0;
    window._micro._recipesList().push({ name: 'gt std', tool: 'gt', params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: 'FE' }], nCut: 4 } });
    await window._micro.runRoutine({ name: 'resumed', tool: 'routine', params: { output: { prefix: 'z-' }, steps: [
      { each: [{ g: 'FE' }, { g: 'FE' }], steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$g' }] }] },
    ] } }, { from: 1 });
    const el = document.querySelector('.fwin[data-routine-run]');
    const icons = [...el.querySelectorAll('.rw-state')].map((x) => x.textContent).join('');
    const meta = document.querySelector('#meta').textContent;
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    return { icons, meta };
  });
  chk(`resume from a step: the tracker marks the skipped ones (${r3.icons}) and the summary is honest ("${r3.meta.split('—')[1] || ''}".trim())`,
    r3.icons === '–✓' && /1 step run \(1 skipped\)/.test(r3.meta));
  await p3.close();
}

// ── §30: groups as sugar on naming — "swaths/FE drift" files the layer ──
{
  const pg = await mkPage('sm2groups');
  await pg.evaluate(() => window._micro.openBlob(new Blob(['X,Y,Z,FE\n0,0,0,50\n10,0,0,60\n']), 'm.csv', 'replace'));
  await pg.waitForFunction(() => window._micro.layers()[0], null, { timeout: 20000 });
  const gp = await pg.evaluate(async () => {
    const A = await window._micro.resultToLayer('swaths/FE drift', 'band\tmean\n1\t55\n2\t58\n');
    await window._micro.resultToLayer('swaths/SIO2 drift', 'band\tmean\n1\t4\n');
    await window._micro.resultToLayer('month-end/gt/FE', 'cutoff\tt\n0\t9\n');
    const L = window._micro.layers().find((x) => x.name === 'm.csv');
    window._micro.fileLayerByPath(L, 'models/deposit');
    const tree = window._micro.layerTree();
    const sw = tree.find((n) => n.group && n.name === 'swaths');
    const me = tree.find((n) => n.group && n.name === 'month-end');
    const gt = me && me.children.find((n) => typeof n !== 'number' && n.group && n.name === 'gt');
    const md = tree.find((n) => n.group && n.name === 'models');
    return { label: A.label, kind: A.kind, sw: sw ? sw.children.length : 0, nested: !!gt, model: md ? md.children.includes(L.id) : false, modelLabel: L.label };
  });
  chk(`group paths: "swaths/FE drift" → group swaths (${gp.sw} members), leaf as label ("${gp.label}"), nested path nests (${gp.nested})`,
    gp.kind === 'table' && gp.label === 'FE drift' && gp.sw === 2 && gp.nested);
  chk(`group paths: renaming a layer with a path files it ("models/deposit" → ${gp.modelLabel}, in models: ${gp.model})`,
    gp.model && gp.modelLabel === 'deposit');
  await pg.close();
}

// ── §31: layers are no longer a scarce resource (the id left the pick record) ──
{
  const pl = await mkPage('sm2pool');
  const pool = await pl.evaluate(async () => {
    await window._micro.openBlob(new Blob(['X,Y,Z,FE\n0,0,0,50\n10,0,0,60\n']), 'm.csv', 'replace');
    await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < 8; i++) await window._micro.resultToLayer(`swaths/run ${i + 1}`, 'band\tmean\n1\t55\n');
    let opened = 0;
    for (let i = 0; i < 5; i++) {
      await window._micro.openBlob(new Blob([`X,Y,Z,AU\n${i},0,0,1\n${i + 1},0,0,2\n`]), `own-${i}.csv`, 'add');
      await new Promise((r) => setTimeout(r, 250));
      if (window._micro.layers().some((L) => L.name === `own-${i}.csv`)) opened++;
    }
    const Ls = window._micro.layers();
    const tabs = Ls.filter((L) => L.kind === 'table');

    // …and a HIGH layer id is still PICKABLE. The old scheme packed the layer into
    // three spare bits of the 32-bit pick id, so a model with id 8 was unreachable
    // by the ID buffer. The layer rides a per-draw uniform now (pick target RG32UI:
    // R = record, G = layer), so id has no ceiling — prove it end-to-end.
    const hi = Ls.filter((L) => /^own-/.test(L.name)).sort((a, b) => b.id - a.id)[0];
    window._micro.setActiveLayer(hi.id);
    window._micro.showRecord({ layer: hi.id, rec: 1 });
    await new Promise((r) => setTimeout(r, 600));
    const rows = [...document.querySelectorAll('#recPanel .rp-row')].map((r) => [r.querySelector('.k').textContent, r.querySelector('.v').textContent]);
    const au = rows.find(([k]) => k === 'AU');

    // the ID buffer itself: every lit pixel names a layer that actually exists
    document.querySelector('#btnFit').click();
    await new Promise((r) => setTimeout(r, 800));
    const cv = document.querySelector('#cv'), r = cv.getBoundingClientRect();
    const region = window._micro.renderer.pickRegion({ x: 0, y: 0, w: Math.floor(r.width), h: Math.floor(r.height) },
      window._micro.cam, { pointPx: 8, blocksAsPoints: false, section: null });
    const known = new Set(Ls.map((L) => L.id));
    let lit = 0, bogus = 0;
    const data = region ? region.data : new Uint32Array(0);
    for (let i = 0; i < data.length; i += 4) {
      const g = data[i + 1] >>> 0;
      if (g === 0xFFFFFFFF) continue;                       // miss
      lit++;
      const lid = g & 0xFFFF;                               // G = layer | face<<16 — never read it raw
      const face = (g >>> 16) & 7;
      if (!known.has(lid)) bogus++;                         // a packed-id ghost would land here
      if (face > 7) bogus++;
    }
    return { tables: tabs.length, opened, hiId: hi.id, hiName: hi.name, au: au && au[1], lit, bogus };
  });
  chk(`no layer partition: ${pool.tables} result tables + five of the visitor's models coexist (${pool.opened}/5 opened) — the old 7-slot ceiling is gone`,
    pool.tables === 8 && pool.opened === 5);
  chk(`a high layer id is pickable: layer ${pool.hiId} (${pool.hiName}) record 1 → AU ${pool.au} — its OWN data, not a neighbour's`,
    pool.hiId >= 8 && pool.au === '2');
  chk(`the ID buffer names only real layers (${pool.lit} lit pixels, ${pool.bogus} ghosts)`,
    pool.lit > 20 && pool.bogus === 0);
  await pl.close();
}

// ── §32: surfaces are pickable — WHICH mesh from the GPU, WHICH TRIANGLE from the CPU ──
{
  const pk = await mkPage('sm2mesh');
  const r = await pk.evaluate(async () => {
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${40 + k * 3}\n`;
    await window._micro.openBlob(new Blob([t]), 'cube.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));
    const obj = ['v 0 0 80', 'v 80 0 80', 'v 80 80 80', 'v 0 80 80', 'f 1 2 3', 'f 1 3 4'].join('\n') + '\n';
    await window._micro.openBlob(new Blob([obj]), 'lid.obj', 'add');
    await new Promise((z) => setTimeout(z, 1500));

    const m = document.querySelector('#secMode'); m.value = 'off'; m.dispatchEvent(new Event('input'));
    const st = window._micro.cam.state;
    window._micro.cam.orbit(0, (Math.PI / 2 - 0.03) - st.phi);      // straight down (phi is FROM the XY plane)
    document.querySelector('#btnFit').click();
    window._micro.requestRender();
    await new Promise((z) => setTimeout(z, 1200));

    const cv = document.querySelector('#cv'), rc = cv.getBoundingClientRect();
    const cx = rc.width * 0.5, cy = rc.height * 0.5;
    const P = () => window._micro.renderer.pick(cx, cy, window._micro.cam, { pointPx: 6, blocksAsPoints: false, section: null });
    const kindOf = (h) => { const L = h && window._micro.layers().find((x) => x.id === h.layer); return L && L.kind; };

    const mesh = window._micro.layers().find((x) => x.kind === 'mesh');
    const blocks = window._micro.layers().find((x) => x.kind === 'blocks');

    const hOpaque = P();                                             // the lid ships opaque → it picks
    const mh = kindOf(hOpaque) === 'mesh' ? await window._micro.meshHitAt(mesh, cx, cy) : null;

    // see-through → the click must reach the blocks (you made it see-through to see past it)
    mesh.opacity = 0.4; window._micro.renderer.setLayerOpacity(mesh.id, 0.4);
    window._micro.setActiveLayer(blocks.id);
    window._micro.requestRender();
    await new Promise((z) => setTimeout(z, 800));
    const hThrough = P();

    // …but selecting it says "I mean this surface"
    window._micro.setActiveLayer(mesh.id);
    window._micro.requestRender();
    await new Promise((z) => setTimeout(z, 800));
    const hSelected = P();

    // the FACE code, sampled over several pixels: looking straight down, the top
    // face must dominate. (One centre pixel is brittle — at a near-vertical view a
    // block's side sliver is a fraction of a degree wide and can own that pixel.)
    window._micro.setActiveLayer(blocks.id);
    mesh.visible = false; window._micro.applyTreeVisibility();
    window._micro.requestRender();
    await new Promise((z) => setTimeout(z, 800));
    const faces = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.45], [0.55, 0.55], [0.48, 0.53], [0.53, 0.47]]) {
      const h = window._micro.renderer.pick(rc.width * fx, rc.height * fy, window._micro.cam,
        { pointPx: 6, blocksAsPoints: false, section: null });
      if (h) faces.push(h.face);
    }
    return {
      opaqueKind: kindOf(hOpaque), tri: mh && mh.tri, z: mh && mh.point[2], nz: mh && mh.normal[2],
      throughKind: kindOf(hThrough), throughFace: hThrough && hThrough.face,
      selectedKind: kindOf(hSelected),
      faces, tops: faces.filter((f) => f === 5).length,
    };
  });
  chk(`mesh pick: an opaque surface picks, and the CPU names the triangle (tri ${r.tri} at z=${r.z}, normal z=${r.nz && r.nz.toFixed(2)})`,
    r.opaqueKind === 'mesh' && r.tri != null && Math.abs(r.z - 80) < 0.01 && Math.abs(r.nz - 1) < 0.01);
  chk(`mesh pick: a 40%-opaque surface does NOT steal the click — it reaches the BLOCKS under it (${r.throughKind}, face ${r.throughFace})`,
    r.throughKind === 'blocks' && r.throughFace <= 5);
  chk(`face code: looking straight down, the top face dominates (${r.tops}/${r.faces.length} are +Z: [${r.faces.join(',')}])`,
    r.faces.length >= 4 && r.tops >= r.faces.length - 1);
  chk(`mesh pick: selecting that surface makes it clickable again (${r.selectedKind})`, r.selectedKind === 'mesh');
  await pk.close();
}

// ── §33: the EXPERIMENTAL natural-language bar — the SAFETY properties ──
// Its accuracy is allowed to be imperfect; these three are not:
//   (a) it is OFF by default — a cold visitor never meets a box that guesses
//   (b) it PROPOSES, it never ACTS — nothing happens until you read it and press Enter
//   (c) nonsense is refused, not guessed at
{
  const nl = await mkPage('sm2nl');
  const r = await nl.evaluate(async () => {
    let t = 'XC,YC,ZC,FE,LITO\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
      t += `${5 + i * 10},${5 + j * 10},${1000 + k * 10},${40 + ((i + j + k) % 30)},${(i + j) % 3 === 0 ? 'HEMATITE' : (i + j) % 3 === 1 ? 'ITABIRITE' : 'WASTE'}\n`;
    await window._micro.openBlob(new Blob([t]), 'deposit.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));

    const offByDefault = { stored: localStorage.getItem('micro.nl'), proposes: !!window._micro.nlPropose('colour the model by FE') };

    window._micro.nlSetEnabled(true);
    await window._micro.nlEnsureTrained();
    const said = window._micro.nlPropose('show blocks with FE above 60');
    const sym = window._micro.nlPropose('FE > 55');                       // SYMBOL operator (was misread as colour-by)
    const cat = window._micro.nlPropose('only hematite');                 // CATEGORICAL filter (was unrecognised)
    window._micro.createLayerGroup('phase set', [window._micro.layers().find((L) => L.docs && L.docs.blockDoc).id]);
    await window._micro.nlEnsureTrained();                                // the group changes the session key → retrain
    const grpProp = window._micro.nlPropose('hide phase set');           // a GROUP is an addressable target too
    grpProp && grpProp.run();
    const grpHidden = (window._micro.layerTree().find((n) => n && n.group && n.name === 'phase set') || {}).visible === false;
    const before = document.querySelector('#filter').value;              // proposing must NOT act
    const junk = window._micro.nlPropose('what is the airspeed velocity of an unladen swallow');
    if (said) said.run();                                                // …running must
    await new Promise((z) => setTimeout(z, 1200));
    const after = document.querySelector('#filter').value;

    // completion surface (Alt+K): starters when empty, word completion, breakdown chips
    window._micro.openPalette({ nl: true });
    const palItems = () => [...document.querySelectorAll('#palList .pal-item')];
    const nStarters = palItems().length;
    const typ = (v) => { const inp = document.querySelector('#palInput'); inp.value = v; inp.dispatchEvent(new Event('input')); };
    typ('hide phase'); const compHit = palItems().some((el) => /phase set/i.test((el.querySelector('.pal-t') || {}).textContent || ''));
    typ('FE > 55'); const bdChips = ((palItems()[0] || document.createElement('div')).querySelectorAll('.pal-chip')).length;
    window._micro.closePalette();

    window._micro.nlSetEnabled(false);
    return { offByDefault, said: said && said.title, sym: sym && sym.title, cat: cat && cat.title, grp: grpProp && grpProp.title, grpHidden, nStarters, compHit, bdChips, junk: junk && junk.title, before, after };
  });
  chk(`NL bar: OFF by default — nothing stored, nothing proposed (stored=${r.offByDefault.stored})`,
    r.offByDefault.stored === null && r.offByDefault.proposes === false);
  chk(`NL bar: it PROPOSES ("${r.said}") and does NOT act — filter stayed "${r.before}" until run, then "${r.after}"`,
    /FE/.test(r.said || '') && r.before === '' && /FE/.test(r.after) && /60/.test(r.after));
  chk(`NL bar: SYMBOL operators dispatch to a filter, not colour-by (FE > 55 → "${r.sym}")`, /FE\s*>\s*55/.test(r.sym || ''));
  chk(`NL bar: CATEGORICAL filter is recognised (only hematite → "${r.cat}")`, /LITO/.test(r.cat || '') && /HEMATITE/i.test(r.cat || ''));
  chk(`NL bar: a GROUP is an addressable visibility target (hide phase set → "${r.grp}", hidden=${r.grpHidden})`, /phase set/i.test(r.grp || '') && r.grpHidden === true);
  chk(`NL bar (Alt+K): completion surface — ${r.nStarters} starters, group word-completion=${r.compHit}, ${r.bdChips} breakdown chips`, r.nStarters >= 4 && r.compHit === true && r.bdChips >= 2);
  chk('NL bar: nonsense is refused, not guessed at', r.junk == null);
  await nl.close();
}

// ── §23 window system: dialog lifecycle · results footer · minimize strip ──
// Guards the 2026-07-25 coherence pass: dialogs stack on the shared z counter
// (later on top), Escape unwinds them newest-first, floats are opaque, every
// analysis foot carries the shared results row, minimize goes to a strip chip.
{
  const wp = await mkPage('sm2win');
  await wp.evaluate(() => {
    let csv = 'XC,YC,ZC,FE\n';
    for (let i = 0; i < 200; i++) csv += `${612000 + (i % 20) * 10},${7765000 + ((i / 20) | 0) * 10},400,${30 + i % 20}\n`;
    return window._micro.openBlob(new Blob([csv]), 'w.csv', 'replace');
  });
  await wp.waitForTimeout(700);
  await wp.evaluate(() => { window._micro.openNewDialog(); window._micro.openExportDialog(window._micro.layers()[0]); });
  await wp.waitForTimeout(250);
  const z1 = await wp.evaluate(() => ({ ng: +document.querySelector('#ngDlg').style.zIndex, ex: +document.querySelector('#exDlg').style.zIndex, ngShow: document.querySelector('#ngDlg').classList.contains('show'), exShow: document.querySelector('#exDlg').classList.contains('show'), ngModeless: document.querySelector('#ngDlg').classList.contains('modeless') }));
  chk(`window system: two config dialogs coexist modeless, later on top (ng z${z1.ng} < ex z${z1.ex})`, z1.ngShow && z1.exShow && z1.ngModeless && z1.ex > z1.ng);
  await wp.keyboard.press('Escape'); await wp.waitForTimeout(120);
  await wp.keyboard.press('Escape'); await wp.waitForTimeout(120);
  const z2 = await wp.evaluate(() => ({ ngShow: document.querySelector('#ngDlg').classList.contains('show'), exShow: document.querySelector('#exDlg').classList.contains('show') }));
  chk('window system: Escape unwinds dialogs newest-first to none', !z2.ngShow && !z2.exShow);
  const r3 = await wp.evaluate(async () => {
    const L = window._micro.layers()[0];
    window._micro.openGradeTonnage(L);
    await new Promise((z) => setTimeout(z, 300));
    const win = [...document.querySelectorAll('.fwin')].pop();
    const footBtns = [...win.querySelectorAll('.sw-foot .pp-exp button')].map((x) => x.textContent);
    const opaque = getComputedStyle(win).backgroundColor;
    const minB = win.querySelector('.fwin-head button');   // buttons are [minimize, close]
    minB.click();
    const chipCount = document.querySelectorAll('#winStrip .win-chip').length;
    const hidden = win.style.display === 'none';
    document.querySelector('#winStrip .win-chip').click();
    const restored = win.style.display !== 'none' && document.querySelectorAll('#winStrip .win-chip').length === 0;
    const topAccent = win.classList.contains('top');
    window._micro.closeAllWindows();
    return { footBtns, opaque, chipCount, hidden, restored, topAccent };
  });
  chk(`window system: the results row lives in the analysis foot [${r3.footBtns.join(' · ')}]`,
    r3.footBtns.some((x) => x.includes('layer')) && r3.footBtns.some((x) => x.includes('table')) && r3.footBtns.some((x) => x.includes('png')));
  chk(`window system: floats are opaque (${r3.opaque})`, r3.opaque === 'rgb(22, 22, 22)');
  chk(`window system: minimize → strip chip (${r3.chipCount}), chip restores + raises`, r3.chipCount === 1 && r3.hidden && r3.restored && r3.topAccent);

  // ── the solid RECIPE path: params → resolve by name → flag column lands ──
  const solidR = await wp.evaluate(async () => {
    // a closed OBJ box over the left half of the 20×10 block sheet
    const x0 = 611995, x1 = 612095, y0 = 7764995, y1 = 7765095, z0 = 350, z1 = 450;
    const V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const T = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [3, 4, 8], [3, 8, 7], [1, 5, 8], [1, 8, 4], [2, 3, 7], [2, 7, 6]];
    const obj = V.map((v) => `v ${v.join(' ')}`).join('\n') + '\n' + T.map((t) => `f ${t.join(' ')}`).join('\n');
    await window._micro.openBlob(new Blob([obj]), 'box.obj', 'add');
    await new Promise((z) => setTimeout(z, 800));
    const err = await window._micro.runSolidRecipe({ geometry: 'box.obj', do: 'flag', which: 'inside', column: 'INBOX', value: 'IN', targets: ['w.csv'] }).then(() => null, (e) => e.message);
    const L = window._micro.layers().find((x) => x.name === 'w.csv');
    const col = (L.paintCols || []).find((c) => c.name === 'INBOX');
    const hasCol = window._micro.layerHasColumn('INBOX', 'w.csv');
    // a bad recipe fails with a NAMED layer, before anything runs
    const bad = await window._micro.runSolidRecipe({ geometry: 'nope.obj', do: 'flag' }).then(() => null, (e) => e.message);
    return { err, hasCol, colKind: col && col.kind, bad };
  });
  chk(`solid recipe: params resolve by name and the flag column lands (INBOX, ${solidR.colKind})`, solidR.err === null && solidR.hasCol);
  chk(`solid recipe: a missing layer fails NAMED before running ("${solidR.bad}")`, /nope\.obj/.test(solidR.bad || ''));

  // ── join scope: "only the 3D selection" masks the source rows ──
  const joinSel = await wp.evaluate(async () => {
    const L = window._micro.layers().find((x) => x.name === 'w.csv');
    const T = window._micro.gridAxesOf(L);
    const n = 200;                                          // w.csv = 20×10 blocks, one bench
    const mask = new Uint8Array(n); for (let i = 0; i < n; i++) if (i % 20 < 10) mask[i] = 1;   // the left half
    L._selMask = mask; L._selCount = 100;
    const columns = () => [{ src: 'left', name: 'FE', out: 'FE', num: true, op: 'mean' }];
    const all = await window._micro.runSpatialJoin({ leftL: L, rightL: null, target: T, columns: columns(), coverage: false, label: 'j', asCells: true });
    const sel = await window._micro.runSpatialJoin({ leftL: L, rightL: null, target: T, columns: columns(), coverage: false, label: 'j', asCells: true, useSelection: true });
    L._selMask = null; L._selCount = 0;
    return { all: all.nPresent, sel: sel.nPresent };
  });
  chk(`join scope: selection masks the source (${joinSel.all} cells all → ${joinSel.sel} selected)`, joinSel.all === 200 && joinSel.sel === 100);

  // ── settings window: sectioned rail + the PREFS registry persists ──
  const setw = await wp.evaluate(() => {
    window._micro.openSettingsWindow();
    const win = [...document.querySelectorAll('.fwin')].pop();
    const railBtns = [...win.querySelectorAll('button')].filter((b2) => ['display', 'interaction', 'compute', 'data', 'experimental', 'housekeeping'].includes(b2.textContent));
    railBtns.find((b2) => b2.textContent === 'interaction').click();
    const sels = [...win.querySelectorAll('select')];
    const stickSel = sels.find((s2) => [...s2.options].some((o) => o.value === 'sticky'));
    stickSel.value = 'sticky'; stickSel.dispatchEvent(new Event('change'));
    const stored = localStorage.getItem('micro.selStick');
    stickSel.value = 'smart'; stickSel.dispatchEvent(new Event('change'));   // restore the default
    const descs = win.querySelectorAll('div').length;
    window._micro.closeAllWindows();
    return { title: win.querySelector('.fwin-head .t').textContent, sections: railBtns.length, stored, descs };
  });
  chk(`settings: ${setw.sections} sections on the rail, a choice persists (selStick → ${setw.stored})`,
    setw.title === 'settings' && setw.sections === 6 && setw.stored === 'sticky');

  // ── the g-leader: save a view slot, move, recall; a bare digit does nothing ──
  await wp.evaluate(() => document.body.focus());
  const cam0 = await wp.evaluate(() => JSON.stringify(window._micro.cam.state));
  await wp.keyboard.press('g'); await wp.waitForTimeout(80);
  await wp.keyboard.press('Shift+Digit3'); await wp.waitForTimeout(250);
  const slotSaved = await wp.evaluate(() => window._micro.views().some((v) => v.name === 'slot 3'));
  await wp.evaluate(() => { window._micro.cam.orbit(0.8, 0.3); window._micro.requestRender(); });
  await wp.waitForTimeout(120);
  await wp.keyboard.press('Digit3'); await wp.waitForTimeout(150);   // bare digit: must NOT recall
  const camAfterBare = await wp.evaluate(() => JSON.stringify(window._micro.cam.state));
  await wp.keyboard.press('g'); await wp.waitForTimeout(80);
  await wp.keyboard.press('Digit3'); await wp.waitForTimeout(300);
  const camRecalled = await wp.evaluate(() => JSON.stringify(window._micro.cam.state));
  chk('g-leader: Shift+digit saves a named slot, bare digit is inert, g+digit recalls',
    slotSaved && camAfterBare !== cam0 && camRecalled === cam0);
  await wp.close();
}

// ── §34: deferred re-shade — a cosmetic poke over a converged frame is ONE
//    fullscreen resolve pass (condenser gl-resolve.js, O(pixels) at any model
//    size), not a re-raster; a CULLING change (isolate filter) still re-rasters ──
{
  const rp = await mkPage('sm2resolve');
  const r = await rp.evaluate(async () => {
    const M = window._micro;
    let csv = 'X,Y,Z,FE\n';                                // small model: converges in a frame or two
    for (let k = 0; k < 2; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++)
      csv += `${i * 10},${j * 10},${k * 10 + 900},${(10 + i + k * 5).toFixed(1)}\n`;
    await M.openBlob(new Blob([csv]), 'shade.csv', 'replace');
    await new Promise((s) => setTimeout(s, 900));
    document.querySelector('#btnFit').click();
    await new Promise((s) => setTimeout(s, 1200));          // converge + go idle
    const L = M.layers()[0];
    const shot = () => document.querySelector('#cv').toDataURL().slice(1000, 3000);
    const rc0 = M.renderer.resolveCount;
    const before = shot();
    const px = new Uint8Array(256 * 4);                     // a hot ramp nothing defaults to
    for (let t = 0; t < 256; t++) { px[t * 4] = 255; px[t * 4 + 1] = t; px[t * 4 + 2] = 0; px[t * 4 + 3] = 255; }
    M.renderer.setLayerRamp(L.id, px); M.requestRender();
    await new Promise((s) => setTimeout(s, 400));
    const rc1 = M.renderer.resolveCount;
    const after = shot();
    const n = 800;                                          // culling change: must NOT resolve
    const mask = new Uint8Array(n); for (let q = 0; q < n; q++) mask[q] = q % 2;
    M.renderer.setFilter(mask, { isolate: true }, L.id); M.requestRender();
    await new Promise((s) => setTimeout(s, 400));
    const rc2 = M.renderer.resolveCount;
    M.renderer.setFilter(null, {}, L.id); M.requestRender();
    await new Promise((s) => setTimeout(s, 400));
    // THE DRILLHOLE SCENE (the regression Arthur hit): sticks layers coexist,
    // and a ramp poke on the BLOCKS layer must STILL resolve — per-layer dirt,
    // untouched sticks keep their pixels
    await M.importDrillholes(M.makeDemoDrillholes(), { radius: 6 }, 'add');
    await new Promise((s) => setTimeout(s, 1200));
    const hasSticks = M.layers().some((L2) => L2.dh);
    const rc3 = M.renderer.resolveCount;
    for (let t = 0; t < 256; t++) px[t * 4] = 0;            // a different ramp
    M.renderer.setLayerRamp(L.id, px); M.requestRender();
    await new Promise((s) => setTimeout(s, 400));
    const rc4 = M.renderer.resolveCount;
    return { rc0, rc1, rc2, rc3, rc4, hasSticks, changed: before !== after };
  });
  chk(`deferred re-shade: a ramp poke over the converged frame resolves (${r.rc0}→${r.rc1}) and repaints; isolate still re-rasters (rc stays ${r.rc2})`,
    r.rc1 > r.rc0 && r.rc2 === r.rc1 && r.changed);
  chk(`deferred re-shade with drillholes loaded: the block ramp poke still resolves (${r.rc3}→${r.rc4})`,
    r.hasSticks && r.rc4 > r.rc3);
  await rp.close();
}


// ── LOCATIONS: an element's record spaces, and the count that used to lie ──────
// attrRowCountOf fell through to renderer.layerElementCount, so a mesh reported
// its TRIANGLE count as though those were attribute rows. Every caller happened
// to guard with `kind !== 'mesh'` separately, so the wrong number was latent
// rather than visible — exactly the kind of thing that bites the first caller
// who forgets. These assert the count is honest and the record spaces are named.
{
  const rp = await mkPage('sm2loc');
  const r = await rp.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 2; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++)
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${40 + k}\n`;
    await M.openBlob(new Blob([t]), 'blocks.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));
    // a quad -> 4 vertices, 2 faces: the two counts DIFFER, so a mix-up shows
    const obj = ['v 0 0 80', 'v 40 0 80', 'v 40 40 80', 'v 0 40 80', 'f 1 2 3', 'f 1 3 4'].join('\n') + '\n';
    await M.openBlob(new Blob([obj]), 'lid.obj', 'add');
    await new Promise((z) => setTimeout(z, 1500));
    const B = M.layers().find((L) => L.name === 'blocks.csv');
    const Me = M.layers().find((L) => L.kind === 'mesh');
    return {
      blockRows: M.attrRowCountOf(B), blockHas: M.hasRecords(B), blockLoc: M.primaryLocationOf(B),
      blockLocs: M.locationsOf(B).map((l) => [l.name, l.count, l.shape]),
      meshRows: M.attrRowCountOf(Me), meshHas: M.hasRecords(Me), meshLoc: M.primaryLocationOf(Me),
      meshLocs: M.locationsOf(Me).map((l) => [l.name, l.count]),
      meshLine: M.propKindLine(Me),
      meshTris: M.renderer.layerElementCount(Me.id),
      meshCols: (M.attrColumnsOf(Me) || []).map((c) => c.name),
      meshRow2: await M.fetchLayerRow(Me, 2),
    };
  });
  chk(`locations: a block model is one 'cells' location of ${r.blockRows} rows`,
    r.blockRows === 32 && r.blockHas === true && r.blockLoc === 'cells'
    && JSON.stringify(r.blockLocs) === JSON.stringify([['cells', 32, 'table']]));
  chk(`locations: a mesh reports its ${r.meshRows} VERTEX rows, not its ${r.meshTris} triangles`,
    r.meshRows === 4 && r.meshHas === true && r.meshTris === 2);
  chk(`locations: the vertex table's columns are the coordinates (${JSON.stringify(r.meshCols)})`,
    JSON.stringify(r.meshCols) === JSON.stringify(['X', 'Y', 'Z']));
  chk(`locations: a vertex row reads back its own coordinates (${JSON.stringify(r.meshRow2)})`,
    JSON.stringify(r.meshRow2) === JSON.stringify([40, 40, 80]));
  chk(`locations: the mesh names BOTH record spaces (${JSON.stringify(r.meshLocs)})`,
    r.meshLoc === 'vertices' && JSON.stringify(r.meshLocs) === JSON.stringify([['vertices', 4], ['faces', 2]]));
  chk(`locations: the properties line says so too - "${r.meshLine}"`,
    /4 vertices/.test(r.meshLine) && /2 faces/.test(r.meshLine));
  await rp.close();
}


// ── the mesh VERTEX location, end to end ──────────────────────────────────────
// A painted PLY carries its set colors as vertex properties. This walks the
// whole chain: condenser keeps them at read, meshDoc names them in its header,
// the vertex table lists them as columns, and a row reads its own values back.
// That chain is what a ply2atti import will ride on.
{
  const rp = await mkPage('sm2meshvtx');
  const r = await rp.evaluate(async () => {
    const M = window._micro;
    const ply = [
      'ply', 'format ascii 1.0', 'element vertex 4',
      'property float x', 'property float y', 'property float z',
      'property uchar red', 'property uchar green', 'property uchar blue',
      'element face 2', 'property list uchar int vertex_indices', 'end_header',
      '0 0 80 255 0 0', '40 0 80 255 0 0', '40 40 80 0 255 0', '0 40 80 0 255 0',
      '3 0 1 2', '3 0 2 3',
    ].join('\n') + '\n';
    await M.openBlob(new Blob([ply]), 'painted.ply', 'replace');
    await new Promise((z) => setTimeout(z, 1600));
    const L = M.layers().find((x) => x.kind === 'mesh');
    if (!L) return { err: 'no mesh layer' };
    const cols = (M.attrColumnsOf(L) || []).map((c) => c.name);
    const rows = [];
    for (let k = 0; k < 4; k++) rows.push(await M.fetchLayerRow(L, k));
    // the attribute table must now open on a mesh — it is a record-bearing layer
    M.openAttrTable(L);
    await new Promise((z) => setTimeout(z, 500));
    const opened = M.attrTables.has(L.id);
    // and the parse is shared: a solid query must not re-read the file
    const before = L.docs.meshDoc._vtxData;
    await M.meshSolidOf(L).catch(() => null);
    return { cols, rows, opened, shared: before === L.docs.meshDoc._vtxData && !!before, n: M.attrRowCountOf(L) };
  });
  chk(`mesh vertices: a painted PLY's colors ARE columns (${JSON.stringify(r.cols)})`,
    JSON.stringify(r.cols) === JSON.stringify(['X', 'Y', 'Z', 'red', 'green', 'blue']));
  chk(`mesh vertices: ${r.n} rows read back their own coordinates and colors`,
    r.n === 4
    && JSON.stringify(r.rows[0]) === JSON.stringify([0, 0, 80, 255, 0, 0])
    && JSON.stringify(r.rows[2]) === JSON.stringify([40, 40, 80, 0, 255, 0]));
  chk('mesh vertices: the attribute table opens on a mesh', r.opened === true);
  chk('mesh vertices: a solid query reuses the vertex parse rather than re-reading', r.shared === true);
  await rp.close();
}


// ═══ derived columns across a project round trip ═══════════════════════════════
// The subsystems that hold most of the column-storage call sites — calc columns,
// element persistence, styling restore, the paint column registry — had no
// durable coverage at all. These assert the BEHAVIOR rather than the storage
// shape ("a calc still resolves after a reload"), so they stay true through the
// (location, name) re-keying and are what will prove it correct.
{
  const pc = await mkPage('sm2cols');
  const before = await pc.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 2; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++)
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${10 + i}\n`;
    await M.openBlob(new Blob([t]), 'w.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1400));
    // a box over part of the model → a real category (paint) column with lineage
    const V = [[0, 0, 0], [25, 0, 0], [25, 25, 0], [0, 25, 0], [0, 0, 25], [25, 0, 25], [25, 25, 25], [0, 25, 25]];
    const T = [[1, 2, 3], [1, 3, 4], [5, 7, 6], [5, 8, 7], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 8], [3, 8, 4], [4, 8, 5], [4, 5, 1]];
    const obj = V.map((v) => `v ${v.join(' ')}`).join('\n') + '\n' + T.map((x) => `f ${x.join(' ')}`).join('\n');
    await M.openBlob(new Blob([obj]), 'box.obj', 'add');
    await new Promise((z) => setTimeout(z, 1400));
    await M.runSolidRecipe({ geometry: 'box.obj', do: 'flag', which: 'inside', column: 'INBOX', value: 'IN', targets: ['w.csv'] });
    await new Promise((z) => setTimeout(z, 800));

    const L = M.layers().find((x) => x.name === 'w.csv');
    // a calc, a calc ON that calc, and a calc referencing the PAINT column —
    // the three composition shapes the resolver core exists to support
    M.applyCalcCols(L, [
      { name: 'DBL', expr: 'FE * 2' },
      { name: 'QUAD', expr: 'DBL * 2' },
      { name: 'TAG', expr: 'if(INBOX == "IN", 1, 0)' },
    ]);
    await M.materializeCalcCol(L, 'DBL');                   // → a Parquet sidecar matcol
    await new Promise((z) => setTimeout(z, 800));
    M.setLayerColorSel(L, 'paint:INBOX');
    M.setRampCfg(L, { mode: 'fixed', lo: 1, hi: 9 });

    const qd = await M.realizeCalc(L, 'QUAD');
    const tg = await M.realizeCalc(L, 'TAG');
    const paint = M.paintColByName(L, 'INBOX');
    return {
      calc: (L.calcCols || []).map((c) => [c.name, c.expr]),
      census: M.schemaExt(L, L.docs.blockDoc.header).map((c) => c.name),
      quad: [...qd.slice(0, 5)],
      tagSum: [...tg].reduce((a, b) => a + b, 0),
      mat: (M.matColGet(L, 'DBL') || {}).name,
      matVals: [...(M.matColGet(L, 'DBL').fvalues || []).slice(0, 5)],
      paintDict: paint ? paint.dict.filter(Boolean) : null,
      paintNonBlank: paint ? [...paint.codes].filter((c) => c).length : 0,
      colorSel: L.colorSel,
      exportCols: (M.exportColumnsOf(L) || []).map((c) => (typeof c === 'string' ? c : c.name)),
    };
  });
  // materializing DBL moves it OUT of calcCols and into the sidecar, which is the
  // point of materializing — so QUAD is now a calc over a MATERIALIZED column, and
  // TAG a calc over a PAINT column. Both composition shapes, in one fixture.
  chk(`round trip: the fixture builds paint + calc-over-matcol + calc-over-paint (${before.calc.map((c) => c[0])})`,
    before.calc.length === 2 && before.mat === 'DBL' && before.paintNonBlank === 16
    && before.quad[0] === 40 && before.tagSum === 16);

  await saveProject(pc);
  await pc.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2cols');
    await window._micro.openProjectDir(dir);
  });
  await pc.waitForFunction(() => window._micro.layers().some((L) => L.name === 'w.csv'), null, { timeout: 60000 });
  await new Promise((z) => setTimeout(z, 1500));

  const after = await pc.evaluate(async () => {
    const M = window._micro;
    const L = M.layers().find((x) => x.name === 'w.csv');
    const qd = await M.realizeCalc(L, 'QUAD');
    const tg = await M.realizeCalc(L, 'TAG');
    const paint = M.paintColByName(L, 'INBOX');
    const mc = M.matColGet(L, 'DBL');
    await M.ensureStoredValues(L, new Set(['dbl']));
    return {
      calc: (L.calcCols || []).map((c) => [c.name, c.expr]),
      census: M.schemaExt(L, L.docs.blockDoc.header).map((c) => c.name),
      quad: [...qd.slice(0, 5)],
      tagSum: [...tg].reduce((a, b) => a + b, 0),
      mat: (mc || {}).name,
      matVals: mc && mc.fvalues ? [...mc.fvalues.slice(0, 5)] : null,
      paintDict: paint ? paint.dict.filter(Boolean) : null,
      paintNonBlank: paint ? [...paint.codes].filter((c) => c).length : 0,
      colorSel: L.colorSel,
      exportCols: (M.exportColumnsOf(L) || []).map((c) => (typeof c === 'string' ? c : c.name)),
      row: M.extendRow(L, await M.fetchLayerRow(L, 0), 0),
    };
  });

  chk(`round trip: calc columns come back with their expressions (${JSON.stringify(after.calc)})`,
    JSON.stringify(after.calc) === JSON.stringify(before.calc));
  chk(`round trip: a calc ON a calc still resolves (QUAD ${after.quad.slice(0, 3)})`,
    JSON.stringify(after.quad) === JSON.stringify(before.quad));
  chk(`round trip: a calc referencing a PAINT column still resolves (sum ${after.tagSum})`,
    after.tagSum === before.tagSum && after.tagSum > 0);
  chk(`round trip: the materialized column keeps its values (${after.matVals && after.matVals.slice(0, 3)})`,
    after.mat === 'DBL' && JSON.stringify(after.matVals) === JSON.stringify(before.matVals));
  chk(`round trip: the paint column keeps its dictionary and codes (${after.paintDict}, ${after.paintNonBlank})`,
    JSON.stringify(after.paintDict) === JSON.stringify(before.paintDict)
    && after.paintNonBlank === before.paintNonBlank);
  // this one FAILED when written: the manifest emitted every materialized column
  // and then every category column, so (INBOX, DBL) came back as (DBL, INBOX) and
  // the census shifted under every positional consumer after a reload
  chk(`round trip: the census order is stable (${JSON.stringify(after.census)})`,
    JSON.stringify(after.census) === JSON.stringify(before.census));
  chk(`round trip: the EXPORT column list is stable too (${after.exportCols.length} columns)`,
    JSON.stringify(after.exportCols) === JSON.stringify(before.exportCols) && after.exportCols.length > 0);
  chk(`round trip: styling restores (color by ${after.colorSel})`,
    after.colorSel === before.colorSel && before.colorSel === 'paint:INBOX');
  chk('round trip: a full extended row reads back every census slot',
    Array.isArray(after.row) && after.row.length === after.census.length);
  await pc.close();
}


// ── a .dm auto-optimized to Parquet, then re-channelled ───────────────────────
// Reported from real use: open a .dm, save, auto-optimize converts it to Parquet
// and the layer reports ZERO blocks; after a reload, changing the display column
// empties it again. One root cause behind both — the channel-switch dispatch was
// `.dm ? openDmBlob : openBlocksBlob`, written before Parquet existed, so a
// Parquet layer was handed to the DELIMITED reader, which sniffed its bytes as
// text, found no rows, and replaced a good document with an empty one. The layer
// kept its count and its columns and drew nothing, which is why it read as data
// loss. Auto-optimize was only ever tested over CSV, and the .dm section turns it
// off, so the combination was uncovered.
{
  const pd = await mkPage('sm2dmpq');
  await pd.evaluate(async () => {
    const { makeDM } = await import('/test/dm-make.mjs');
    const fields = [
      { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
      { name: 'XINC', type: 'N', constant: 10 }, { name: 'YINC', type: 'N', constant: 10 }, { name: 'ZINC', type: 'N', constant: 5 },
      { name: 'XMORIG', type: 'N', constant: 1000 }, { name: 'YMORIG', type: 'N', constant: 2000 }, { name: 'ZMORIG', type: 'N', constant: 400 },
      { name: 'NX', type: 'N', constant: 8 }, { name: 'NY', type: 'N', constant: 6 }, { name: 'NZ', type: 'N', constant: 4 },
      { name: 'FE', type: 'N' }, { name: 'AU', type: 'N' }, { name: 'LITO', type: 'A', width: 8 },
    ];
    const rows = [];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++)
      rows.push({ XC: 1005 + i * 10, YC: 2005 + j * 10, ZC: 402.5 + k * 5,
        FE: 20 + i, AU: 0.5 + k, LITO: (i + j) % 2 ? 'BIF' : 'CANGA' });
    await window._micro.openBlob(new Blob([makeDM(fields, rows, { precision: 'ep' })]), 'bm.dm', 'replace');
  });
  await pd.waitForFunction(() => { const L = window._micro.layers()[0]; return L && window._micro.renderer.layerElementCount(L.id) === 192; }, null, { timeout: 60000 });

  // convert exactly as an auto-optimizing save does
  await pd.evaluate(() => window._micro.convertLayerToParquet(window._micro.layers()[0], { keepOriginal: true }));
  await pd.waitForFunction(() => /\d+ blocks|blocks ·/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await new Promise((z) => setTimeout(z, 1200));
  const conv = await pd.evaluate(() => {
    const M = window._micro, L = M.layers()[0];
    return { name: L.name, rows: M.attrRowCountOf(L), drawn: M.renderer.layerElementCount(L.id), pq: !!L.docs.blockDoc.parquet };
  });
  chk(`dm→parquet: the converted model still DRAWS (${conv.drawn} of ${conv.rows}, “${conv.name}”, parquet-backed ${conv.pq})`,
    conv.rows === 192 && conv.drawn === 192 && conv.pq === true);

  // and switching the display column must not empty it — the same handler, and
  // the second half of the report. Drive the real select, not the setter.
  const swapped = await pd.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    M.setActiveLayer(L.id);
    const sel = document.querySelector('#colorBy');
    const opt = [...sel.options].map((o) => o.value).filter((v) => v.startsWith('chan:'));
    const cur = sel.value;
    const next = opt.find((v) => v !== cur) || opt[0];
    sel.value = next; sel.dispatchEvent(new Event('change'));
    await new Promise((z) => setTimeout(z, 2000));
    return { next, drawn: M.renderer.layerElementCount(L.id), rows: M.attrRowCountOf(L), chans: opt.length };
  });
  chk(`dm→parquet: switching the display column keeps the blocks (${swapped.drawn} drawn, by ${swapped.next})`,
    swapped.drawn === 192 && swapped.rows === 192);

  // volume selection reads records through a COLD position stream, and its
  // dispatch had no Parquet branch either — a Parquet blockDoc fell to the
  // delimited reader and the box selected nothing at all. Same for painting.
  const vol = await pd.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    M.setActiveLayer(L.id);
    M.clearSelection({ silent: true });
    document.querySelector('#btnFit').click();
    await new Promise((z) => setTimeout(z, 600));
    // a screen rectangle over the whole viewport: "through" selection projects
    // every record, so a working Parquet stream selects them all and a broken
    // one selects none — the difference the missing branch made
    const c = document.querySelector('canvas');
    const w = c.clientWidth, h = c.clientHeight;
    await M.selectVolume([[2, 2], [w - 2, 2], [w - 2, h - 2], [2, h - 2]], 'replace', true);
    await new Promise((z) => setTimeout(z, 1500));
    return { sel: L._selCount || 0, rows: M.attrRowCountOf(L) };
  }).catch((e) => ({ err: String(e).slice(0, 120) }));
  chk(`dm→parquet: volume selection reaches a Parquet model (${vol.sel} of ${vol.rows} selected)`,
    !vol.err && vol.sel === 192);

  // the capability record itself. Four consumers (export, spatial join, rules,
  // column scan) decide whether to re-drop invalid-coordinate rows from this ONE
  // predicate, so testing it once tests all four. Delimited renumbers what
  // survives its load; .dm keeps true row numbers and Parquet emits every row.
  const caps = await pd.evaluate(async () => {
    const M = window._micro;
    const pq = M.blockCaps(M.layers()[0]);                 // the converted Parquet model
    let t = 'XC,YC,ZC,FE' + String.fromCharCode(10);
    for (let i = 0; i < 8; i++) t += `${i * 10},0,0,${i}` + String.fromCharCode(10);
    await M.openBlob(new Blob([t]), 'plain.csv', 'add');
    await new Promise((z) => setTimeout(z, 1200));
    const csv = M.blockCaps(M.layers().find((L) => L.name === 'plain.csv'));
    return { pq, csv };
  });
  chk(`capabilities: Parquet is row-is-record with stats + projection (${JSON.stringify(caps.pq)})`,
    caps.pq.rowIsRecord === true && caps.pq.stats === true && caps.pq.projection === true);
  chk(`capabilities: a delimited model renumbers, and offers neither (${JSON.stringify(caps.csv)})`,
    caps.csv.rowIsRecord === false && caps.csv.stats === false && caps.csv.projection === false);
  await pd.close();
}


// ── a materialized column must survive the Morton reorder ─────────────────────
// "Store as Parquet" spatially re-sorts every base column and permutes each paint
// column's `codes`. It did NOT permute `fvalues` — the full-precision backing that
// IS the truth for a materialized column, read positionally by export, filter and
// grade-tonnage. So the colour stayed right while the numbers shuffled, and
// persistElement baked the misordering into the sidecar. This pins a value to a
// coordinate and checks they are still together afterwards.
{
  const pm = await mkPage('sm2matorder');
  const r = await pm.evaluate(async () => {
    const M = window._micro;
    // FE is a pure function of X, so every block's value is predictable from
    // its own coordinates — misalignment cannot hide behind a plausible number
    let t = 'XC,YC,ZC,FE' + String.fromCharCode(10);
    for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++)
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${i * 100}` + String.fromCharCode(10);
    await M.openBlob(new Blob([t]), 'ord.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1400));
    const L = M.layers()[0];
    // a materialized column carrying that same predictable value
    M.applyCalcCols(L, [{ name: 'EST', expr: 'FE * 2' }]);
    await M.materializeCalcCol(L, 'EST');
    await new Promise((z) => setTimeout(z, 900));

    const check = async (tag) => {
      const mc = M.matColGet(L, 'EST');
      const nrec = M.attrRowCountOf(L);
      let bad = 0, sample = null;
      for (let rec = 0; rec < nrec; rec++) {
        const row = await M.fetchLayerRow(L, rec);
        const want = (+row[0] - 5) / 10 * 200;              // EST = FE*2 = ((X-5)/10)*100*2
        const got = mc.fvalues[rec];
        if (Math.abs(got - want) > 1e-6) { bad++; if (!sample) sample = { tag, rec, x: +row[0], want, got }; }
      }
      return { bad, nrec, sample };
    };

    const before = await check('before');
    await M.convertLayerToParquet(L, { keepOriginal: true });
    await new Promise((z) => setTimeout(z, 1600));
    const after = await check('after');
    return { before, after, name: M.layers()[0].name };
  });
  chk(`materialize order: the column is aligned before the reorder (${r.before.bad} mismatches of ${r.before.nrec})`,
    r.before.bad === 0 && r.before.nrec === 72);
  chk(`materialize order: it is STILL aligned after Store-as-Parquet (${r.after.bad} mismatches of ${r.after.nrec}${r.after.sample ? ', e.g. x=' + r.after.sample.x + ' want ' + r.after.sample.want + ' got ' + r.after.sample.got : ''})`,
    r.after.bad === 0 && r.after.nrec === 72);
  await pm.close();
}


// ── record numbering across a row the loader threw away ──────────────────────
// A delimited source drops rows with unparseable coordinates at load, so the
// renderer never numbers them. Six sweeps re-derived that rule independently and
// computeGT/computeSwath got it wrong — they counted every row, then used the
// count to index the selection mask and the materialized columns, so after the
// first bad row every block read another block's selection and another block's
// grade. layerRecords owns the rule now; this pins it.
{
  const pn = await mkPage('sm2recnum');
  const r = await pn.evaluate(async () => {
    const M = window._micro;
    const NL = String.fromCharCode(10);
    // FE is a pure function of X, and row 3 has an unparseable X
    let t = 'XC,YC,ZC,FE' + NL;
    for (let i = 0; i < 8; i++) t += (i === 3 ? 'n/a' : String(5 + i * 10)) + ',5,5,' + (i * 100) + NL;
    await M.openBlob(new Blob([t]), 'gap.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1400));
    const L = M.layers()[0];
    const n = M.attrRowCountOf(L);
    const seen = [];
    for await (const { f, rec } of M.layerRecords(L)) seen.push({ rec, x: +f[0], fe: +f[3] });
    // and the independent ladder must agree record-for-record
    const viaFetch = [];
    for (let k = 0; k < n; k++) { const row = await M.fetchLayerRow(L, k); viaFetch.push(+row[0]); }
    return { n, seen, viaFetch, caps: M.blockCaps(L) };
  });
  chk(`record numbering: the bad row is not a record (${r.n} of 8 rows, delimited ${!r.caps.rowIsRecord})`,
    r.n === 7 && r.caps.rowIsRecord === false);
  chk('record numbering: layerRecords numbers 0..n-1 with no gap',
    r.seen.length === 7 && r.seen.every((e, i) => e.rec === i));
  chk(`record numbering: it agrees with fetchLayerRow record-for-record (${JSON.stringify(r.seen.map((e) => e.x))})`,
    JSON.stringify(r.seen.map((e) => e.x)) === JSON.stringify(r.viaFetch));
  chk('record numbering: every record still carries its OWN grade (FE = (X-5)/10*100)',
    r.seen.every((e) => Math.abs(e.fe - (e.x - 5) / 10 * 100) < 1e-6));
  await pn.close();
}


// ── the pick ray is correct under vertical exaggeration ──────────────────────
// pixelRay unprojects through inverse(viewProj), which INCLUDES zExag. Round-trip
// a point OFF the z-scale centre: the camera target is the fixed point of the
// z-scale, so a point offset from it in z is where the old geometric ray (which
// ignored zExag) drifted. Project the point through the full viewProj to a pixel,
// then pixelRay at that pixel must return a ray through it — in viewProj's own
// coordinate space, so no frame bookkeeping (a probe confirmed target round-trips
// to ~1e-3 at every exaggeration).
{
  const pz = await mkPage('sm2zexag');
  const r = await pz.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,FE' + String.fromCharCode(10);
    for (let k = 0; k < 5; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++)
      t += `${i * 10},${j * 10},${k * 10},${k}` + String.fromCharCode(10);
    await M.openBlob(new Blob([t]), 'z.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));
    document.querySelector('#btnFit').click();
    await new Promise((z) => setTimeout(z, 400));
    const cv = document.querySelector('canvas'), rect = cv.getBoundingClientRect();
    const missOffCentre = () => {
      const st = M.cam.state, vp = st.viewProj;
      const Q = [st.target[0] + 6, st.target[1] - 4, st.target[2] + 15];   // off the z-scale centre
      const cw = vp[3] * Q[0] + vp[7] * Q[1] + vp[11] * Q[2] + vp[15];
      const nx = (vp[0] * Q[0] + vp[4] * Q[1] + vp[8] * Q[2] + vp[12]) / cw;
      const ny = (vp[1] * Q[0] + vp[5] * Q[1] + vp[9] * Q[2] + vp[13]) / cw;
      const px = (nx + 1) * 0.5 * rect.width, py = (1 - ny) * 0.5 * rect.height;
      const ray = M.pixelRay(px, py), o = ray.o, d = ray.d;
      const w = [Q[0] - o[0], Q[1] - o[1], Q[2] - o[2]];
      const tp = w[0] * d[0] + w[1] * d[1] + w[2] * d[2];
      return Math.hypot(w[0] - tp * d[0], w[1] - tp * d[1], w[2] - tp * d[2]);
    };
    const out = {};
    for (const ex of [1, 3, 8]) { M.setZExag(ex); M.requestRender(); await new Promise((z) => setTimeout(z, 250)); out['m' + ex] = missOffCentre(); }
    M.setZExag(1);
    return out;
  });
  const near = (v) => v < 0.1;                             // 0.1 world units; the old bug drifts by the z-scale (whole units, growing)
  chk(`zExag pick: an off-centre point round-trips at ×1 (${r.m1.toExponential(1)})`, near(r.m1));
  chk(`zExag pick: STILL round-trips at ×3 and ×8 — the ray follows the exaggeration, not drifts (${r.m3.toExponential(1)}, ${r.m8.toExponential(1)})`,
    near(r.m3) && near(r.m8));
  await pz.close();
}

// ── §35: tidyProject migrates a FLAT legacy project into kind folders (files
//     MOVED not copied, project.json rewritten, second tidy a no-op) and
//     scanFolderForNewData is the folder-as-inbox (a hand-dropped file is
//     offered; sidecars, .cols fragments, and referenced files are skipped;
//     a re-scan finds nothing). These two MOVE FILES and had no test anywhere
//     (the 2026-08 deep review's worst coverage desert) — guard them BEFORE
//     the project-lifecycle carve touches them. ──
{
  // open a small block model + save (auto-routes to models/), then FORGE the
  // legacy flat layout: move models/t.csv (+ sidecar) to the ROOT and rewrite
  // project.json's source paths — a faithful pre-kind-folder project.
  const pt = await mkPage('sm2tidy');
  await pt.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2tidy', { recursive: true }); } catch { /* fresh */ } });
  await pt.evaluate(async () => {
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) t += `${i * 5},${j * 5},${k * 5},${(i + j + k) % 7}\n`;
    await window._micro.openBlob(new Blob([t]), 't.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));
  });
  await saveProject(pt);
  const forged = await pt.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tidy');
    const models = await root.getDirectoryHandle('models');
    const move = async (from, name) => {
      let src; try { src = await from.getFileHandle(name); } catch { return false; }
      const bytes = await (await src.getFile()).arrayBuffer();
      const dst = await root.getFileHandle(name, { create: true });
      const w = await dst.createWritable(); await w.write(bytes); await w.close();
      await from.removeEntry(name); return true;
    };
    const moved = await move(models, 't.csv');
    await move(models, 't.csv.meta.json');
    const pj = await root.getFileHandle('project.json');
    const txt = await (await pj.getFile()).text();
    const w = await pj.createWritable(); await w.write(txt.split('models/t.csv').join('t.csv')); await w.close();
    return { moved, hadPath: txt.includes('models/t.csv') };
  });
  chk('tidy setup: forged a legacy FLAT project (file at root, project.json rewritten)', forged.moved && forged.hadPath);
  await pt.close();
  // the flat project still OPENS (backward compat), then TIDY moves it home
  const pt2 = await mkPage('sm2tidy');
  await pt2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tidy'); await window._micro.openProjectDir(dir); });
  await pt2.waitForFunction(() => window._micro.layers().length === 1 && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 144, null, { timeout: 60000 });
  chk('flat legacy project still OPENS (144 blocks placed)', true);
  pt2.evaluate(() => window._micro.tidyProject());
  await pt2.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'), null, { timeout: 10000 });
  await pt2.evaluate(() => document.querySelector('#pmOk').click());
  await pt2.waitForFunction(() => /project tidied|already tidy|tidy failed/.test(document.querySelector('#meta').textContent), null, { timeout: 90000 });
  const tidied = await pt2.evaluate(async () => {
    const meta = document.querySelector('#meta').textContent;
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tidy');
    const has = async (dir, name) => { try { await dir.getFileHandle(name); return true; } catch { return false; } };
    const models = await root.getDirectoryHandle('models');
    const pjTxt = await (await (await root.getFileHandle('project.json')).getFile()).text();
    return { meta, atModels: await has(models, 't.csv'), atRoot: await has(root, 't.csv'), src: pjTxt.includes('models/t.csv') };
  });
  chk(`tidy MOVED the file into models/ and the root copy is GONE — “${tidied.meta}”`, /project tidied — 1 file/.test(tidied.meta) && tidied.atModels && !tidied.atRoot);
  chk('tidy rewrote project.json (source = models/t.csv)', tidied.src);
  pt2.evaluate(() => window._micro.tidyProject());
  await pt2.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'), null, { timeout: 10000 });
  await pt2.evaluate(() => { document.querySelector('#meta').textContent = ''; document.querySelector('#pmOk').click(); });
  await pt2.waitForFunction(() => /already tidy|project tidied|tidy failed/.test(document.querySelector('#meta').textContent), null, { timeout: 90000 });
  const again = await pt2.evaluate(() => document.querySelector('#meta').textContent);
  chk(`a second tidy is a NO-OP — “${again}”`, /already tidy/.test(again));
  await pt2.close();
  // the tidied project reloads with its records intact
  const pt3 = await mkPage('sm2tidy');
  await pt3.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tidy'); await window._micro.openProjectDir(dir); });
  await pt3.waitForFunction(() => window._micro.layers().length === 1 && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 144, null, { timeout: 60000 });
  chk('the TIDIED project reloads (144 blocks intact)', true);
  // ── folder-as-inbox: drop extra.csv + a stray sidecar + an orphan .cols
  // fragment into models/ by hand; the scan offers ONLY the data file ──
  await pt3.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tidy');
    const models = await root.getDirectoryHandle('models');
    const wr = async (dir, name, text) => { const h = await dir.getFileHandle(name, { create: true }); const w = await h.createWritable(); await w.write(text); await w.close(); };
    let t = 'XC,YC,ZC,AU\n';
    for (let i = 0; i < 27; i++) t += `${(i % 3) * 5},${((i / 3 | 0) % 3) * 5},${(i / 9 | 0) * 5},${i}\n`;
    await wr(models, 'extra.csv', t);
    await wr(models, 'stray.csv.meta.json', '{}');
    const cols = await models.getDirectoryHandle('t.csv.cols', { create: true });
    await wr(cols, 'orphan.parquet', 'not real parquet');
    window._micro.scanFolderForNewData();
  });
  await pt3.waitForFunction(() => document.querySelector('#ofDlg').classList.contains('show') || /scan/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  const offer = await pt3.evaluate(() => ({ show: document.querySelector('#ofDlg').classList.contains('show'), body: document.querySelector('#ofDlgBody').textContent }));
  chk('scan offers ONLY the hand-dropped extra.csv (sidecar + .cols fragment skipped)', offer.show && /extra\.csv/.test(offer.body) && !/stray|orphan|t\.csv/.test(offer.body));
  await pt3.evaluate(() => document.querySelector('#ofOpen').click());
  await pt3.waitForFunction(() => window._micro.layers().length === 2, null, { timeout: 60000 });
  chk('opening the offer lands the layer (2 layers)', true);
  // awaited, and the line read at once: the just-opened layer's own late status
  // can overwrite the meta line a moment later (a race, not a scan failure)
  const meta2 = await pt3.evaluate(async () => { await window._micro.scanFolderForNewData(); return document.querySelector('#ofDlg').classList.contains('show') ? 'offered again' : document.querySelector('#meta').textContent; });
  chk(`a re-scan finds nothing new (the opened file is referenced) — “${meta2}”`, /no new data/.test(meta2));
  await pt3.close();
}

// ── §36: category re-key on .dm — "Use as category" works on Datamine models
//     (numeric domain codes dict-encode as strings), and the choice PERSISTS
//     across a project save/reload (mapping rides ls.mapping → openDmBlob).
//     The delimited/parquet paths had this; .dm was the excluded source. ──
{
  const pq = await mkPage('sm2dmcat');
  await pq.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2dmcat', { recursive: true }); } catch { /* fresh */ } });
  await pq.evaluate(async () => {
    const { makeDM } = await import('/test/dm-make.mjs');
    const fields = [
      { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
      { name: 'XINC', type: 'N', constant: 5 }, { name: 'YINC', type: 'N', constant: 5 }, { name: 'ZINC', type: 'N', constant: 5 },
      { name: 'FE', type: 'N' }, { name: 'DOMAIN', type: 'N' }, { name: 'LITO', type: 'A', width: 8 },
    ];
    const rows = [];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++)
      rows.push({ XC: i * 5, YC: j * 5, ZC: k * 5, FE: 20 + i, DOMAIN: (k % 3 + 1) * 100, LITO: (i + j) % 2 ? 'BIF' : 'CANGA' });
    await window._micro.openBlob(new Blob([makeDM(fields, rows)]), 'cat.dm', 'replace');
  });
  await pq.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 64, null, { timeout: 60000 });
  const before = await pq.evaluate(() => { const h = window._micro.layers()[0].docs.blockDoc.header; return { cat: h.columns[h.mapping.cat], cats: h.categories }; });
  chk(`.dm default category is the first alpha column (${before.cat}: ${(before.cats || []).join('/')})`, before.cat === 'LITO');
  await pq.evaluate(async () => { const L = window._micro.layers()[0]; const h = L.docs.blockDoc.header; await window._micro.useAsCategory(L, h.columns.indexOf('DOMAIN')); });
  await pq.waitForFunction(() => { const L = window._micro.layers()[0]; const h = L.docs && L.docs.blockDoc && L.docs.blockDoc.header; return h && h.columns[h.mapping.cat] === 'DOMAIN'; }, null, { timeout: 60000 });
  const after = await pq.evaluate(() => { const h = window._micro.layers()[0].docs.blockDoc.header; return { cats: h.categories }; });
  chk(`"Use as category" re-keys a .dm to a NUMERIC domain column (dict: ${(after.cats || []).join('/')})`, ['100', '200', '300'].every((v) => (after.cats || []).includes(v)));
  await pq.evaluate(() => { const i = document.querySelector('#filter'); i.value = 'DOMAIN == 200'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await pq.waitForFunction(() => window._micro.layers()[0]._filterMask, null, { timeout: 60000 });
  const hits = await pq.evaluate(() => { const m = window._micro.layers()[0]._filterMask; let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; });
  chk(`the filter matches the numeric category (DOMAIN == 200 → ${hits} of 64)`, hits === 16);
  await saveProject(pq);
  await pq.close();
  const pq2 = await mkPage('sm2dmcat');
  await pq2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dmcat'); await window._micro.openProjectDir(dir); });
  await pq2.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 64, null, { timeout: 60000 });
  const re2 = await pq2.evaluate(() => { const h = window._micro.layers()[0].docs.blockDoc.header; return { cat: h.columns[h.mapping.cat], cats: h.categories }; });
  chk(`the re-keyed category PERSISTS across save/reload (${re2.cat}: ${(re2.cats || []).join('/')})`, re2.cat === 'DOMAIN' && ['100', '200', '300'].every((v) => (re2.cats || []).includes(v)));
  await pq2.close();
}

// ── §37: the stats FAST PATH — after a filter scan pins the columns, the stats
//     window accumulates over pinned 256K windows (censusChunkCols) instead of
//     decoding rows. The guard is a PARITY check: pinned rows == row-path rows
//     (pins dropped via setPinBudget('off')), with __statsFast proving the fast
//     path actually ran (non-vacuous). ──
{
  const ps = await mkPage('sm2statfast');
  const teed = await ps.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,FE,LITO\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++)
      t += `${i * 5},${j * 5},${k * 5},${(i + j * 2 + k * 3) % 11},${(i + k) % 2 ? 'BIF' : 'CANGA'}\n`;
    await M.openBlob(new Blob([t]), 's.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));
    // a complete filter scan tees the pins for FE + LITO (+ coords)
    const inp = document.querySelector('#filter'); inp.value = 'FE >= 0 and LITO != "ZZZ"'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((res) => { const t2 = setInterval(() => { if (M.layers()[0]._filterMask) { clearInterval(t2); res(); } }, 100); });
    return M.pinStats();
  });
  chk(`filter scan teed the pin cache (${teed.cols} columns pinned)`, teed.cols > 0);
  const runStats = () => ps.evaluate(async () => {
    const M = window._micro;
    for (const w of document.querySelectorAll('.fwin')) delete w._statsRows;   // only FRESH results resolve the poll
    M.openStats(M.layers()[0], { run: true, cfg: { cols: ['FE'], groupBy: 'LITO', weight: '', scope: 'all' } });
    const el = await new Promise((res) => { const t2 = setInterval(() => { for (const w of document.querySelectorAll('.fwin')) if (w._statsRows) { clearInterval(t2); res(w); } }, 100); });
    const rows = el._statsRows.map((r) => ({ ...r, td: undefined }));
    el.querySelector('.fwin-head button, .fwin-x')?.click();
    return { rows, fast: window.__statsFast || 0 };
  });
  const r1 = await runStats();
  chk(`stats used the PINNED window path (fast-path runs: ${r1.fast})`, r1.fast >= 1);
  await ps.evaluate(() => { window._micro.setPinBudget('off'); });   // drops every pin → the row path
  const r2 = await runStats();
  chk('dropping the pins falls back to the row path', r2.fast === r1.fast);
  const near = (a2, b2) => (a2 == null && b2 == null) || Math.abs(a2 - b2) < 1e-9 || (Number.isNaN(a2) && Number.isNaN(b2));
  const same = r1.rows.length === r2.rows.length && r1.rows.every((ra, i) => {
    const rb = r2.rows[i];
    return ra.group === rb.group && ra.col === rb.col && ra.n === rb.n
      && near(ra.mean, rb.mean) && near(ra.std, rb.std) && near(ra.min, rb.min) && near(ra.max, rb.max)
      && near(ra.q25, rb.q25) && near(ra.q50, rb.q50) && near(ra.q75, rb.q75);
  });
  chk(`PARITY: pinned rows == row-path rows (${r1.rows.length} rows, groups ${r1.rows.map((r) => r.group).join('/')})`, same && r1.rows.length === 2);
  await ps.evaluate(() => { window._micro.setPinBudget('auto'); });
  await ps.close();
}

// ═══ a STREAMED DXF across a project save/reopen: three sibling layers share ONE
//     source file — copied once, each reopening as ITS kind (not the dominant one,
//     and not every kind again); Reload-from-disk keeps the kind too ═══
{
  const px = await mkPage('sm2dxf');
  await px.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2dxf', { recursive: true }); } catch { } });
  await px.evaluate(async () => {
    const nl = String.fromCharCode(10);
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    for (let i = 0; i < 3; i++) L.push('0', '3DFACE', '8', 'TOPO', '10', String(500000 + i * 10), '20', '6000000', '30', '100', '11', String(500010 + i * 10), '21', '6000000', '31', '101',
      '12', String(500010 + i * 10), '22', '6000010', '32', '102', '13', String(500000 + i * 10), '23', '6000010', '33', '101');
    L.push('0', 'POLYLINE', '8', 'CREST', '70', '8');
    for (let k = 0; k < 4; k++) L.push('0', 'VERTEX', '8', 'CREST', '70', '32', '10', String(500000 + k * 8), '20', '6000005', '30', '110');
    L.push('0', 'SEQEND', '0', 'POINT', '8', 'PEGS', '10', '500005', '20', '6000002', '30', '103', '0', 'ENDSEC', '0', 'EOF', '');
    await window._micro.openBlob(new File([L.join(nl)], 'site.dxf'), 'site.dxf', 'replace', null, { streamDxf: true });
  });
  const kindsOf = () => px.evaluate(() => window._micro.layers().filter((x) => x.name === 'site.dxf')
    .map((x) => (x.docs.stringsDoc ? x.docs.stringsDoc.header.kind : x.kind)).sort());
  const before = await kindsOf();
  await saveProject(px);
  const files = await px.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dxf');
    const out = [];
    const walk = async (d, pre) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else if (/\.dxf$/i.test(n)) out.push(pre + n); } };
    await walk(dir, '');
    return out;
  });
  await px.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dxf'); await window._micro.openProjectDir(dir); });
  await px.waitForFunction(() => window._micro.layers().filter((x) => x.name === 'site.dxf').length >= 3, null, { timeout: 60000 });
  await px.waitForTimeout(500);
  const after = await kindsOf();
  chk(`streamed DXF round-trips a project: ${JSON.stringify(before)} → ${JSON.stringify(after)}, source copied once (${JSON.stringify(files)})`,
    JSON.stringify(before) === '["blockmodel","mesh","strings"]' && JSON.stringify(after) === JSON.stringify(before) && files.length === 1);
  // Reload-from-disk on the STRINGS layer keeps it strings (it used to reopen as the dominant mesh)
  const reloaded = await px.evaluate(async () => {
    const m = window._micro;
    const L = m.layers().find((x) => x.name === 'site.dxf' && x.docs.stringsDoc && x.docs.stringsDoc.header.kind === 'strings');
    await m.reloadLayerFromDisk(L);
    await new Promise((r) => setTimeout(r, 400));
    return m.layers().filter((x) => x.name === 'site.dxf').map((x) => (x.docs.stringsDoc ? x.docs.stringsDoc.header.kind : x.kind)).sort();
  });
  chk(`Reload-from-disk keeps a DXF layer's kind (${JSON.stringify(reloaded)})`, JSON.stringify(reloaded) === '["blockmodel","mesh","strings"]');
  await px.close();
}

// ── §37: mutually exclusive groups (QGIS's radio groups). One direct child at a
//     time, enforced on EVERY way of showing a layer (the eye, h, the host),
//     { } step through the group, the flag survives a save/reopen, and turning
//     it off gives the checkboxes back. ──
{
  const pe = await mkPage('sm2excl');
  await pe.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2excl', { recursive: true }); } catch { /* fresh */ } });
  const ids = await pe.evaluate(async () => {
    const mk = (off) => { let t = 'XC,YC,ZC,FE\n'; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) t += `${off + i * 5},${j * 5},0,${i + j}\n`; return new Blob([t]); };
    const out = [];
    for (const [k, n] of ['fase_1', 'fase_2', 'fase_3', 'topo'].entries()) out.push(await window._micro.openBlob(mk(k * 30), n + '.csv', k ? 'add' : 'replace'));
    window._micro.createLayerGroup('phases', out.slice(0, 3));
    const g = window._micro.layerTree().find((n) => n && n.group && n.name === 'phases');
    g.collapsed = false;
    window._micro.applyTreeVisibility();
    return out;
  });
  const state = () => pe.evaluate((ids2) => {
    const L = (id) => window._micro.layers().find((x) => x.id === id);
    return { vis: ids2.map((id) => !!L(id).visible).map(Number).join(''), radios: document.querySelectorAll('#lpRows input.lp-radio').length, active: window._micro.activeId() };
  }, ids);
  await pe.evaluate(() => window.micro.setGroupExclusive('phases', true));
  const s0 = await state();
  chk(`exclusive keeps the topmost shown child, others off (${s0.vis}), radio eyes on its 3 children (${s0.radios})`, s0.vis === '1001' && s0.radios === 3);
  // the eye: click fase_3's round eye → it alone in the group; topo (outside) untouched
  await pe.evaluate((id) => document.querySelector(`#lpRows .lp-row[data-lid="${id}"] input`).click(), ids[2]);
  const s1 = await state();
  chk(`clicking a radio eye swaps the shown child (${s1.vis})`, s1.vis === '0011');
  // h on the active layer obeys it too
  await pe.evaluate((id) => window._micro.setActiveLayer(id), ids[1]);
  await pe.locator('body').press('h');
  const s2 = await state();
  chk(`h shows the active child and hides its sibling (${s2.vis})`, s2.vis === '0101');
  // } / { step and the active layer follows; { wraps from the first child
  await pe.locator('body').press('}');
  const s3 = await state();
  await pe.locator('body').press('{'); await pe.locator('body').press('{');
  const s4 = await state();
  await pe.locator('body').press('{');
  const s5 = await state();
  chk(`} steps to fase_3 (${s3.vis}, active ${s3.active}); {{ back to fase_1 (${s4.vis}); { wraps to fase_3 (${s5.vis})`,
    s3.vis === '0011' && s3.active === ids[2] && s4.vis === '1001' && s4.active === ids[0] && s5.vis === '0011' && s5.active === ids[2]);
  // the host: setVisible obeys, stepGroup steps, groups() reports it, a plain group refuses stepGroup
  const host = await pe.evaluate(async (ids2) => {
    const m = window.micro;
    await m.setVisible(ids2[0], true);
    const a = ids2.map((id) => +!!window._micro.layers().find((x) => x.id === id).visible).join('');
    await m.stepGroup('phases', 1);
    const b2 = ids2.map((id) => +!!window._micro.layers().find((x) => x.id === id).visible).join('');
    const listed = (m.groups().find((g) => g.path === 'phases') || {}).exclusive;
    await m.group('plain', [ids2[3]]);
    let refused = false; try { await m.stepGroup('plain', 1); } catch { refused = true; }
    await m.ungroup('plain');
    return { a, b: b2, listed, refused };
  }, ids);
  chk(`host: setVisible obeys (${host.a}), stepGroup steps (${host.b}), groups() says exclusive, a plain group refuses stepGroup`,
    host.a === '1001' && host.b === '0101' && host.listed === true && host.refused);
  // save + reopen: the flag and the one shown child survive
  await saveProject(pe);
  await pe.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2excl'); await window._micro.openProjectDir(dir); });
  await pe.waitForFunction(() => window._micro.layers().length === 4, null, { timeout: 60000 });
  await pe.waitForTimeout(500);
  const re = await pe.evaluate(() => {
    const g = window._micro.layerTree().find((n) => n && n.group && n.name === 'phases');
    const vis = window._micro.layers().filter((L) => /^fase_/.test(L.name)).sort((a, b) => a.name.localeCompare(b.name)).map((L) => +!!L.visible).join('');
    return { ex: !!(g && g.exclusive), vis };
  });
  chk(`exclusive survives a save/reopen (${re.ex}, ${re.vis})`, re.ex && re.vis === '010');
  // off: checkboxes return, two children may show at once
  const off = await pe.evaluate(async () => {
    const m = window.micro;
    await m.setGroupExclusive('phases', false);
    const g = window._micro.layerTree().find((n) => n && n.group && n.name === 'phases');
    g.collapsed = false; window._micro.applyTreeVisibility();
    const fs = window._micro.layers().filter((L) => /^fase_/.test(L.name)).sort((a, b) => a.name.localeCompare(b.name));
    await m.setVisible(fs[0].id, true);
    return { vis: fs.map((L) => +!!L.visible).join(''), radios: document.querySelectorAll('#lpRows input.lp-radio').length };
  });
  chk(`off: plain checkboxes (${off.radios} radios), two children shown (${off.vis})`, off.radios === 0 && off.vis === '110');
  await pe.close();
}

// ── §38: detection-limit values. A CSV column with <0.002 / >0.5 / BDL among its
//     numbers reads NUMERIC (it used to read as text); <x → x/2 by default, >x →
//     x, codes → blank — the same value in the colour channel, the filter, the
//     column stats (which count what was substituted) and a substituted export,
//     while the record row and a default CSV export keep the source text. A
//     per-column rule re-reads all of it and survives a save/reopen; drillhole
//     intervals do the same through their resident rows. ──
{
  const pq = await mkPage('sm2qual');
  await pq.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2qual', { recursive: true }); } catch { /* fresh */ } });
  // 72 blocks; k%9: 0 → <0.002, 1 → >0.5, 2 → BDL, else (k%9)/100
  const cu = (k) => (k % 9 === 0 ? '<0.002' : k % 9 === 1 ? '>0.5' : k % 9 === 2 ? 'BDL' : ((k % 9) / 100).toFixed(2));
  let csv = 'XC,YC,ZC,CU_pct,LITO\n';
  for (let k = 0; k < 72; k++) csv += `${(k % 6) * 10},${((k / 6 | 0) % 6) * 10},${(k / 36 | 0) * 10},${cu(k)},${k % 2 ? 'OX' : 'FR'}\n`;
  const nBelow = 8, nAbove = 8, nCode = 8;
  const plain = []; for (let k = 0; k < 72; k++) if (k % 9 > 2) plain.push((k % 9) / 100);
  const meanOf = (below) => (plain.reduce((a, b) => a + b, 0) + nBelow * below + nAbove * 0.5) / (plain.length + nBelow + nAbove);
  const read = (expr) => pq.evaluate(async (e) => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'q.csv');
    m.setActiveLayer(L.id);
    document.querySelector('#filter').value = e; await m.applyBlockFilter(e);
    const hits = L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : -1;
    await m.applyBlockFilter('');
    const st = (await m.scanColumns(L, null)).CU_pct;
    return { hits, mean: st.mean, n: st.n, qual: st.qual, chan: m.renderer.layerChanRange(L.id) };
  }, expr);
  await pq.evaluate(async (t) => { await window._micro.openBlob(new Blob([t]), 'q.csv', 'replace'); }, csv);
  await pq.waitForFunction(() => window._micro.layers().some((x) => x.name === 'q.csv' && x.docs.blockDoc), null, { timeout: 20000 });
  const open = await pq.evaluate(() => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'q.csv'), h = L.docs.blockDoc.header;
    const i = h.columns.indexOf('CU_pct');
    return { numeric: h.numericColumns.some((c) => c.i === i), qualified: (h.qualifiedColumns || []).map((c) => c.name), chan: h.columns[h.mapping.chan], cat: h.columns[h.mapping.cat] };
  });
  chk(`a <x column opens numeric + qualified, colours by it, LITO stays the category (${JSON.stringify(open)})`,
    open.numeric && open.qualified.join() === 'CU_pct' && open.chan === 'CU_pct' && open.cat === 'LITO');
  const r0 = await read('CU_pct < 0.0015');
  chk(`default <x → x/2: filter < 0.0015 hits the ${r0.hits} below-detection blocks, colour starts at ${r0.chan && r0.chan[0]}, mean ${r0.mean && r0.mean.toFixed(5)}`,
    r0.hits === nBelow && Math.abs(r0.chan[0] - 0.001) < 1e-9 && Math.abs(r0.mean - meanOf(0.001)) < 1e-9 && r0.n === 72 - nCode);
  chk(`the column stats count the substitutions (${JSON.stringify(r0.qual)})`, r0.qual && r0.qual.below === nBelow && r0.qual.above === nAbove && r0.qual.code === nCode);
  const raw = await pq.evaluate(async () => { const m = window._micro, L = m.layers().find((x) => x.name === 'q.csv'); return (await m.fetchLayerRow(L, 0))[3]; });
  chk(`the record row keeps the source text (${raw})`, raw === '<0.002');
  // exports: CSV keeps the text by default, writes the substitute when asked
  const exportText = async (qualified) => {
    const [dl] = await Promise.all([pq.waitForEvent('download'), pq.evaluate((q) => { const m = window._micro; return m.runExport(m.layers().find((x) => x.name === 'q.csv'), { scope: 'all', qualified: q, filename: 'q-out.csv' }); }, qualified)]);
    return (await import('fs')).readFileSync(await dl.path(), 'utf8');
  };
  const ex0 = await exportText(false), ex1 = await exportText(true);
  chk('CSV export writes <0.002 as read; with substitutes it writes 0.001 and blanks the codes',
    ex0.includes(',<0.002,') && ex0.includes(',BDL,') && !ex1.includes('<0.002') && ex1.includes(',0.001,') && !ex1.includes('BDL'));
  // a per-column rule: <x → x re-reads the colour, the filter and the stats
  await pq.evaluate(async () => { const m = window._micro; await window.micro.setDetectionLimits(m.layers().find((x) => x.name === 'q.csv').id, 'CU_pct', { below: 'limit' }); });
  const r1 = await read('CU_pct < 0.0015');
  chk(`<x → x: no hits below 0.0015 (${r1.hits}), colour starts at ${r1.chan && r1.chan[0]}, mean follows`,
    r1.hits === 0 && Math.abs(r1.chan[0] - 0.002) < 1e-9 && Math.abs(r1.mean - meanOf(0.002)) < 1e-9);
  let refused = false;
  try { await pq.evaluate(() => window.micro.setDetectionLimits(window._micro.layers().find((x) => x.name === 'q.csv').id, 'CU_pct', { below: 'third' })); } catch { refused = true; }
  chk('a bad rule is refused', refused);
  // save + reopen: the rule rides in the project and the channel re-reads under it
  await saveProject(pq);
  await pq.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2qual'); await window._micro.openProjectDir(dir); });
  await pq.waitForFunction(() => window._micro.layers().some((x) => x.name === 'q.csv' && x.docs.blockDoc), null, { timeout: 60000 });
  await pq.waitForTimeout(800);
  const re = await pq.evaluate(() => { const m = window._micro, L = m.layers().find((x) => x.name === 'q.csv'); return { q: L.qualify, chan: m.renderer.layerChanRange(L.id) }; });
  chk(`the rule survives a save/reopen (${JSON.stringify(re.q)}, colour from ${re.chan && re.chan[0]})`, re.q && re.q.CU_pct && re.q.CU_pct.below === 'limit' && Math.abs(re.chan[0] - 0.002) < 1e-9);
  // drillholes: interval rows are resident; the analyses read the substitute, the row panel the text
  const dh = await pq.evaluate(async () => {
    const m = window._micro, f = (t, n) => new File([t], n);
    await m.importDrillholes({ collar: f('BHID,X,Y,Z\nH1,0,0,100\nH2,50,0,100\n', 'collars.csv'), survey: f('BHID,AT,AZ,DIP\nH1,0,0,-90\nH2,0,0,-90\n', 'survey.csv'),
      intervals: f('BHID,FROM,TO,CU_pct,SAMPLE_ID\nH1,0,2,<0.001,S1\nH1,2,4,0.0011,S2\nH1,4,6,0.0038,S3\nH2,0,2,<0.001,S4\nH2,2,4,0.0070,S5\n', 'assay.csv') }, {}, 'replace');
    const L = m.layers().find((x) => x.dh);
    const i = L.docs.dhDoc.header.columns.indexOf('CU_pct');
    m.setActiveLayer(L.id);
    document.querySelector('#filter').value = 'CU_pct < 0.001'; await m.applyBlockFilter('CU_pct < 0.001');
    const hits = L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : -1;
    return { numeric: L.docs.dhDoc.header.numericColumns.some((c) => c.i === i), row: (await m.fetchLayerRow(L, 0))[i], read: L.docs.dhDoc.fetchRecord(0)[i], hits, lo: L.docs.dhDoc.header.chanRange[0] };
  });
  chk(`drillholes: CU_pct numeric, row text ${dh.row}, read ${dh.read}, filter < 0.001 hits ${dh.hits}, colour from ${dh.lo}`,
    dh.numeric && dh.row === '<0.001' && dh.read === 0.0005 && dh.hits === 2 && dh.lo === 0.0005);
  const dh2 = await pq.evaluate(async () => {                // a rule on a drillhole channel re-desurveys under it
    const m = window._micro;
    await window.micro.setDetectionLimits(m.layers().find((x) => x.dh).id, 'CU_pct', { below: 'limit' });
    const L = m.layers().find((x) => x.dh), i = L.docs.dhDoc.header.columns.indexOf('CU_pct');
    return { lo: L.docs.dhDoc.header.chanRange[0], read: L.docs.dhDoc.fetchRecord(0)[i], q: L.qualify, filter: L.filterExpr, hits: L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : -1 };
  });
  chk(`drillholes: <x → x re-reads the channel (from ${dh2.lo}), the rows (${dh2.read}) and the kept filter (${dh2.hits} hits)`,
    dh2.lo === 0.001 && dh2.read === 0.001 && dh2.q && dh2.q.CU_pct.below === 'limit' && dh2.filter === 'CU_pct < 0.001' && dh2.hits === 0);
  await pq.close();
}

// ── §39: a layer's own cut. { thickness } = follow the section with this
//     layer's OWN slab (the pick, looking along the cut, meets its near face
//     where the picture does); { wholeHoles } = a drillhole layer isn't cut,
//     holes whose collar → EOH PATH crosses the slab draw whole, the rest are
//     hidden — including a hole whose samples never reach the slab, ANDed with
//     the interval filter, following a scrub, surviving a save/reopen. The
//     section's holes are a DISPLAY rule: what the filter matched (export
//     "matches", filter → selection, analyses) never depends on the section. ──
{
  const pc = await mkPage('sm2cut');
  await pc.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2cut', { recursive: true }); } catch { /* fresh */ } });
  await pc.evaluate(async () => {
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 5; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${i + j + k}\n`;
    await window._micro.openBlob(new Blob([t]), 'bm.csv', 'replace');
    const f = (s, n) => new File([s], n);
    // H1 x=5, H2 x=50, H3 x=90 vertical; H4 inclined east from x=20 to ~x=62 over 60 m,
    // sampled only over its first 10 m (x 20..27) — only its PATH reaches x=50
    const collar = 'BHID,X,Y,Z\nH1,5,50,60\nH2,50,50,60\nH3,90,50,60\nH4,20,50,60\n';
    const survey = 'BHID,AT,AZ,DIP\nH1,0,0,-90\nH2,0,0,-90\nH3,0,0,-90\nH4,0,90,-45\nH4,60,90,-45\n';
    let iv = 'BHID,FROM,TO,CU\n';
    for (const [h, cu] of [['H1', 1], ['H2', 2], ['H3', 3]]) for (let d = 0; d < 40; d += 10) iv += `${h},${d},${d + 10},${cu}\n`;
    iv += 'H4,0,10,4\n';
    await window._micro.importDrillholes({ collar: f(collar, 'collars.csv'), survey: f(survey, 'survey.csv'), intervals: f(iv, 'assay.csv') }, {}, 'add');
  });
  await pc.waitForFunction(() => window._micro.layers().some((x) => x.dh && x.docs.dhDoc), null, { timeout: 30000 });
  const ids = await pc.evaluate(() => { const m = window._micro; return { bm: m.layers().find((x) => x.name === 'bm.csv').id, dh: m.layers().find((x) => x.dh).id }; });
  // look east along an x-section at x=50 ±6 (thickness 12: no block centre on an edge), ortho, the pick at the canvas centre
  const nearX = () => pc.evaluate(async () => {
    const m = window._micro, M = window.micro;
    await M.setSection({ axis: 'x', position: 50, thickness: 12, clip: 'slab' });
    document.querySelector('#view').focus();
    m.cam.setOrtho(true);
    m.requestRender(); await new Promise((r) => setTimeout(r, 300));
    const cv = document.querySelector('#view canvas') || document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const hit = await M.worldAt([r.width / 2, r.height / 2]);
    return hit ? { x: hit.world[0], layer: hit.layer } : null;
  });
  await pc.evaluate((dh) => window.micro.setVisible(dh, false), ids.dh);
  await pc.evaluate(() => window._micro.setActiveLayer(window._micro.layers().find((x) => x.name === 'bm.csv').id));
  await pc.locator('body').press('e');
  const h0 = await nearX();
  await pc.evaluate((bm) => window.micro.setLayerCut(bm, { thickness: 42 }), ids.bm);
  const h1 = await nearX();
  const cut1 = await pc.evaluate((bm) => window.micro.layerCut(bm), ids.bm);
  chk(`own slab: looking east the cut wall moves from x≈${h0 && h0.x.toFixed(1)} (section ±6) to x≈${h1 && h1.x.toFixed(1)} (its own ±21); layerCut → ${JSON.stringify(cut1)}`,
    h0 && Math.abs(h0.x - 44) < 0.5 && h1 && Math.abs(h1.x - 29) < 0.5 && cut1 && cut1.thickness === 42);
  await pc.evaluate((bm) => window.micro.setLayerCut(bm, 'follow'), ids.bm);
  // whole holes
  await pc.evaluate((dh) => window.micro.setVisible(dh, true), ids.dh);
  const holesShown = (expr) => pc.evaluate(async (a) => {
    const m = window._micro, L = m.layers().find((x) => x.dh);
    if (a.expr != null) { m.setActiveLayer(L.id); document.querySelector('#filter').value = a.expr; await m.applyBlockFilter(a.expr); }
    m.requestRender(); await new Promise((r) => setTimeout(r, 400));
    const dh = L.docs.dhDoc, im = dh.header.intervalMapping, mask = L._drawMask;   // what's DRAWN
    if (!mask) return 'all';
    const s = new Set(); for (let i = 0; i < mask.length; i++) if (mask[i]) s.add(dh.rawRecord(i)[im.bhid]);
    return [...s].sort().join(',');
  }, { expr });
  await pc.evaluate((dh) => window.micro.setLayerCut(dh, { wholeHoles: true }), ids.dh);
  const w0 = await holesShown(null);
  chk(`whole holes at x=50: H2 + H4 (whose samples stop at x≈27 — its path crosses) → ${w0}`, w0 === 'H2,H4');
  const w1 = await holesShown('CU > 3');
  chk(`ANDed with the interval filter (CU > 3) → ${w1}`, w1 === 'H4');
  // the filter stays the filter: CU >= 2 matches H2+H3+H4's 9 intervals whatever
  // the section shows (H2+H4 drawn)
  const fx = await pc.evaluate(async () => {
    const m = window._micro, L = m.layers().find((x) => x.dh);
    document.querySelector('#filter').value = 'CU >= 2'; await m.applyBlockFilter('CU >= 2');
    m.requestRender(); await new Promise((r) => setTimeout(r, 400));
    const dh = L.docs.dhDoc, im = dh.header.intervalMapping;
    const holes = (mask) => { const s = new Set(); for (let i = 0; i < mask.length; i++) if (mask[i]) s.add(dh.rawRecord(i)[im.bhid]); return [...s].sort().join(','); };
    const meta = document.querySelector('#meta').textContent;
    const drawn = holes(L._drawMask), filtered = holes(L._filterMask || []);
    const exported = await m.runExport(L, { scope: 'matches', download: false });
    m.filterToSelection(L);
    const sel = L._selCount; m.clearSelection({ silent: true });
    document.querySelector('#filter').value = ''; await m.applyBlockFilter('');
    return { drawn, filtered, exported, sel, meta, after: L._filterMask ? 'mask' : 'none', drawnAfter: holes(L._drawMask || []) };
  });
  chk(`the section isn't a filter: CU >= 2 draws ${fx.drawn}, matches ${fx.filtered}; export "matches" ${fx.exported} rows, filter → selection ${fx.sel}; cleared → filter ${fx.after}, still drawn ${fx.drawnAfter} ("${fx.meta}")`,
    fx.drawn === 'H2,H4' && fx.filtered === 'H2,H3,H4' && fx.exported === 9 && fx.sel === 9 && fx.after === 'none' && fx.drawnAfter === 'H2,H4'
    && /9 of 13 match/.test(fx.meta) && /2 holes cross the section/.test(fx.meta));
  await pc.evaluate(async () => { const m = window._micro; document.querySelector('#filter').value = ''; await m.applyBlockFilter(''); await window.micro.setSection({ axis: 'x', position: 10, thickness: 10, clip: 'slab' }); });
  const w2 = await holesShown(null);
  chk(`the section moves to x=10 → ${w2}`, w2 === 'H1');
  await pc.evaluate((dh) => window.micro.setLayerCut(dh, { wholeHoles: true, thickness: 70 }), ids.dh);
  const w3 = await holesShown(null);
  chk(`holes with their own ±35 m slab at x=10 (H2 at x=50 stays out) → ${w3}`, w3 === 'H1,H4');
  let refused = 0;
  for (const bad of [['bm', { wholeHoles: true }], ['dh', { thickness: -1 }], ['dh', 'sideways']]) {
    try { await pc.evaluate((a) => window.micro.setLayerCut(a.id, a.cut), { id: ids[bad[0]], cut: bad[1] }); } catch { refused++; }
  }
  chk(`setLayerCut refuses whole holes on a block model, a bad thickness, an unknown mode (${refused}/3)`, refused === 3);
  // save + reopen: the cut modes ride in the project, the mask comes back
  await pc.evaluate((bm) => window.micro.setLayerCut(bm, { thickness: 40 }), ids.bm);
  await saveProject(pc);
  await pc.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2cut'); await window._micro.openProjectDir(dir); });
  await pc.waitForFunction(() => window._micro.layers().some((x) => x.dh && x.docs.dhDoc) && window._micro.layers().some((x) => x.name === 'bm.csv'), null, { timeout: 60000 });
  await pc.waitForTimeout(800);
  const re = await pc.evaluate(() => { const m = window._micro; return { bm: window.micro.layerCut(m.layers().find((x) => x.name === 'bm.csv').id), dh: window.micro.layerCut(m.layers().find((x) => x.dh).id) }; });
  await pc.evaluate(() => window.micro.setSection({ axis: 'x', position: 10, thickness: 10, clip: 'slab' }));
  const w4 = await holesShown(null);
  chk(`cut modes survive a save/reopen (${JSON.stringify(re)}), whole holes → ${w4}`, re.bm && re.bm.thickness === 40 && re.dh && re.dh.wholeHoles && re.dh.thickness === 70 && w4 === 'H1,H4');
  await pc.close();
}

// ── §40: the store-as-.wfr question. Every answer is a footer button (the
//     header's × only closes): Never · Not now · Yes · Yes, always. "Not now"
//     asks again next SESSION (it used to switch the feature off for good);
//     "Yes" stores this once and keeps asking. ──
{
  const ctx2 = await b.newContext({ viewport: { width: 1100, height: 750 } });   // no init script: the question is unanswered here
  const open = async () => {
    const p = await ctx2.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
    await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window._micro, null, { timeout: 20000 });
    await p.evaluate(async () => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('sm2wfr', { create: true });
      window._micro.setAutoOptimize('off');
    });
    return p;
  };
  // save, answering the copy-sources dialog; `answer` = the .wfr button to click (null = expect no question)
  const save = (p, answer) => p.evaluate(async (ans) => {
    const m = window._micro, q = (s) => document.querySelector(s);
    q('#meta').textContent = '';
    m.saveProjectAs();
    let asked = null;
    for (let t = 0; t < 600; t++) {
      if (q('#svDlg').classList.contains('show')) q('#svCopy').click();
      if (q('#pmDlg').classList.contains('show') && !asked) {
        asked = { head: q('#pmCancel').textContent, foot: [...q('#pmFoot').querySelectorAll('button')].map((x) => x.textContent) };
        const btn = [...q('#pmFoot').querySelectorAll('button')].find((x) => x.textContent === ans);
        if (btn) btn.click(); else q('#pmCancel').click();
      }
      if (/project saved/.test(q('#meta').textContent)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    let wfr = 0;
    try { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2wfr')).getDirectoryHandle('meshes'); for await (const [n] of d.entries()) if (n.endsWith('.wfr')) wfr++; } catch { /* none */ }
    return { asked, wfr, stored: localStorage.getItem('micro.autoPackMeshes'), saved: /project saved/.test(q('#meta').textContent) };
  }, answer);
  const p1 = await open();
  await p1.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2wfr', { recursive: true }); } catch { /* fresh */ } localStorage.removeItem('micro.autoPackMeshes'); });
  await p1.evaluate(() => window._micro.openBlob(new Blob(['v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n']), 'tet.obj', 'replace'));
  await p1.waitForFunction(() => window._micro.layers().some((x) => x.kind === 'mesh' || x.mesh), null, { timeout: 20000 });
  const a1 = await save(p1, 'Not now');
  chk(`.wfr question: × in the header (${a1.asked && a1.asked.head}), answers in the footer [${a1.asked && a1.asked.foot.join(' · ')}]`,
    a1.asked && a1.asked.head === '×' && a1.asked.foot.join('|') === 'Never|Not now|Yes|Yes, always');
  chk(`"Not now" stores nothing and remembers nothing (wfr ${a1.wfr}, setting ${a1.stored}), saved ${a1.saved}`, a1.saved && a1.wfr === 0 && a1.stored == null);
  const a2 = await save(p1, null);
  chk(`…and isn't asked again this session (asked: ${JSON.stringify(a2.asked)})`, a2.saved && a2.asked == null && a2.wfr === 0);
  await p1.close();
  const p2 = await open();                                  // a new session asks again
  await p2.evaluate(() => window._micro.openBlob(new Blob(['v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n']), 'tet.obj', 'replace'));
  await p2.waitForFunction(() => window._micro.layers().some((x) => x.kind === 'mesh' || x.mesh), null, { timeout: 20000 });
  const a3 = await save(p2, 'Yes');
  chk(`a new session asks again; "Yes" stores this once (wfr ${a3.wfr}) and remembers nothing (setting ${a3.stored})`, a3.asked && a3.saved && a3.wfr === 1 && a3.stored == null);
  await p2.close(); await ctx2.close();
}

// ── §41: project backups (.zip.micro). The whole folder streams into one zip —
//     mimetype first, micro-backup.json, project/… — hand-dropped files and
//     sidecars included; lean leaves out only the rebuildable caches; restore
//     unpacks into an EMPTY folder and opens it as the project; it refuses a
//     folder that already holds one and anything that isn't a backup. The UI
//     path (Lean / Full in the footer → a picked file) and opening a .zip.micro
//     like any file (→ the restore question) ride the same code. ──
{
  const pk = await mkPage('sm2bk');
  await pk.evaluate(async () => { const r = await navigator.storage.getDirectory(); for (const n of ['sm2bk', 'sm2bk-r', 'sm2bk-ui']) { try { await r.removeEntry(n, { recursive: true }); } catch { /* fresh */ } } });
  await pk.evaluate(async () => {
    let t = 'XC,YC,ZC,FE,ROCK\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${i + j + k},${(i + k) % 2 ? 'ox' : 'fr'}\n`;
    await window._micro.openBlob(new File([t], 'bm.csv'), 'bm.csv', 'replace');
  });
  await pk.waitForFunction(() => window._micro.layers().some((x) => x.name === 'bm.csv' && x.docs.blockDoc), null, { timeout: 20000 });
  await pk.evaluate(async () => { const m = window._micro; document.querySelector('#filter').value = 'FE > 4'; await m.applyBlockFilter('FE > 4'); });
  await saveProject(pk);
  // a file dropped into the folder by hand is data too
  await pk.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2bk'); const w = await (await d.getFileHandle('notes.txt', { create: true })).createWritable(); await w.write('field notes'); await w.close(); });
  const bk = await pk.evaluate(async () => {
    const M = window.micro;
    const list = async (blob) => {
      const u8 = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u8.buffer);
      let e = u8.length - 22; while (e > 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
      let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true), out = [];
      for (let i = 0; i < n; i++) { const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true); out.push(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl))); p += 46 + nl + el + cl; }
      return { names: out, head: new TextDecoder().decode(u8.subarray(30, 38)) + ':' + new TextDecoder().decode(u8.subarray(38, 38 + 39)) };
    };
    const full = await M.backupProject();
    const lean = await M.backupProject({ lean: true });
    const lf = await list(full.blob), ll = await list(lean.blob);
    window.__bk = full.blob;
    return { name: full.name, head: lf.head, full: lf.names, lean: ll.names, files: full.files, sizes: [full.size, lean.size] };
  });
  const hasMeta = (a) => a.some((n) => /\.meta\.json$/.test(n));
  chk(`backup: ${bk.name} — mimetype first (${bk.head}); ${bk.files} files incl. project.json, the model, the hand-dropped notes.txt and its .meta.json cache`,
    /^sm2bk-\d{4}-\d\d-\d\d\.zip\.micro$/.test(bk.name) && bk.head === 'mimetype:application/vnd.gentropic.micro-project'
    && bk.full[0] === 'mimetype' && bk.full[1] === 'micro-backup.json' && bk.full.includes('project/project.json') && bk.full.includes('project/notes.txt')
    && bk.full.some((n) => /^project\/models\/bm\.csv$/.test(n)) && hasMeta(bk.full));
  chk(`lean leaves out only the caches (${bk.full.length} → ${bk.lean.length} members, ${bk.sizes.join(' → ')} bytes)`,
    !hasMeta(bk.lean) && bk.lean.length === bk.full.length - bk.full.filter((n) => /\.(meta\.json|disp\.grd|disp\.json)$/.test(n)).length && bk.lean.includes('project/notes.txt'));
  // restore into an empty folder → opened as the project
  const rs = await pk.evaluate(async () => {
    const r = await navigator.storage.getDirectory(), dest = await r.getDirectoryHandle('sm2bk-r', { create: true });
    const res = await window.micro.restoreProject(new File([window.__bk], 'b.zip.micro'), dest);
    for (let t = 0; t < 100 && !window._micro.layers().some((x) => x.name === 'bm.csv' && x.docs.blockDoc); t++) await new Promise((q) => setTimeout(q, 100));
    const L = window._micro.layers().find((x) => x.name === 'bm.csv');
    let notes = null; try { notes = await (await (await dest.getFileHandle('notes.txt')).getFile()).text(); } catch { /* missing */ }
    const errs = [];
    try { await window.micro.restoreProject(new File([window.__bk], 'b.zip.micro'), dest); } catch (e) { errs.push(e.message); }
    try { await window.micro.restoreProject(new File(['not a zip at all'], 'x.zip.micro'), await r.getDirectoryHandle('sm2bk-x', { create: true })); } catch (e) { errs.push(e.message); }
    return { files: res.files, project: res.info.project, dir: window._micro.project() && window._micro.project().name, layer: !!L, filter: L && L.filterExpr, notes, errs };
  });
  chk(`restore → ${rs.files} files into ${rs.dir}, opened as the project (“${rs.project}”: bm.csv ${rs.layer}, filter ${rs.filter}, notes.txt “${rs.notes}”)`,
    rs.dir === 'sm2bk-r' && rs.project === 'sm2bk' && rs.layer && rs.filter === 'FE > 4' && rs.notes === 'field notes');
  chk(`restore refuses a folder that already holds a project, and a file that isn't a backup (${rs.errs.join(' | ')})`,
    rs.errs.length === 2 && /already holds/.test(rs.errs[0]) && /not a micro backup/.test(rs.errs[1]));
  // the UI: File → Back up project… asks Lean / Full in the footer, then writes to the picked file
  const ui = await pk.evaluate(async () => {
    const r = await navigator.storage.getDirectory(), out = await r.getDirectoryHandle('sm2bk-ui', { create: true });
    window.showSaveFilePicker = async (o) => { window.__suggested = o.suggestedName; return out.getFileHandle(o.suggestedName, { create: true }); };
    const q = (s) => document.querySelector(s);
    const pr = window._micro.backupProject();
    for (let t = 0; t < 100 && !q('#pmDlg').classList.contains('show'); t++) await new Promise((x) => setTimeout(x, 50));
    const foot = [...q('#pmFoot').querySelectorAll('button')].map((b) => b.textContent);
    [...q('#pmFoot').querySelectorAll('button')].find((b) => /^Lean/.test(b.textContent)).click();
    const res = await pr;
    const f = await (await out.getFileHandle(window.__suggested)).getFile();
    // opening a .zip.micro like any file → the pack question (cancelled here)
    const pr2 = window._micro.openBlob(f, f.name, 'add');
    for (let t = 0; t < 100 && !q('#pmDlg').classList.contains('show'); t++) await new Promise((x) => setTimeout(x, 50));
    const t2 = q('#pmTitle').textContent, ok2 = q('#pmOk').textContent;
    q('#pmCancel').click(); await pr2;
    return { foot, lean: res && res.lean, size: f.size, wrote: res && res.size, t2, ok2, layers: window._micro.layers().length };
  });
  chk(`UI: footer [${ui.foot.join(' · ')}] → Lean → ${ui.size} bytes in the picked file; a .zip.micro opened as a file asks “${ui.t2}” → ${ui.ok2}`,
    ui.foot[0] === 'Cancel' && /^Lean \(/.test(ui.foot[1]) && /^Full \(/.test(ui.foot[2]) && ui.lean === true && ui.size === ui.wrote && ui.size > 0
    && ui.t2 === 'project pack' && ui.ok2 === 'Open (read-only)' && ui.layers >= 1);
  await pk.close();
}

// ── §42: project packs — a .zip.micro opened AS the project, read-only, nothing
//     unpacked. The layers read slices of the pack; a Full pack's caches still
//     match (exact mtimes recorded), a lean one's are absent (the non-vacuity
//     twin); changes in the session live beside the pack; Save writes the whole
//     tree, changes included, into an empty folder and carries on there with no
//     "copy these in?" question and caches that still match on reopen; the
//     background CRC pass reports a damaged pack. ──
{
  const pk = await mkPage('sm2pk');
  await pk.evaluate(async () => { const r = await navigator.storage.getDirectory(); for (const n of ['sm2pk', 'sm2pk-saved']) { try { await r.removeEntry(n, { recursive: true }); } catch { /* fresh */ } } });
  await pk.evaluate(async () => {
    let t = 'XC,YC,ZC,FE,ROCK\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${i + j + k},${(i + k) % 2 ? 'ox' : 'fr'}\n`;
    await window._micro.openBlob(new File([t], 'bm.csv'), 'bm.csv', 'replace');
  });
  await pk.waitForFunction(() => window._micro.layers().some((x) => x.name === 'bm.csv' && x.docs.blockDoc), null, { timeout: 20000 });
  await pk.evaluate(async () => { document.querySelector('#filter').value = 'FE > 4'; await window._micro.applyBlockFilter('FE > 4'); });
  await saveProject(pk);
  await pk.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2pk'); const w = await (await d.getFileHandle('notes.txt', { create: true })).createWritable(); await w.write('field notes'); await w.close(); });
  const op = await pk.evaluate(async () => {
    const M = window.micro, m = window._micro;
    window.__full = (await M.backupProject()).blob; window.__lean = (await M.backupProject({ lean: true })).blob;
    m.closeProject();
    const bm = () => m.layers().find((x) => x.name === 'bm.csv');
    const res = await M.openProjectPack(new File([window.__full], 'sm2pk.zip.micro'));
    const L = bm(), P = m.project();
    const notes = await (await (await P.dir.getFileHandle('notes.txt')).getFile()).text();
    const v = await res.checked;
    const out = { name: res.name, files: res.files, pack: !!P.pack, title: document.title, filter: L && L.filterExpr, bands: !!(L && L._bands), notes, checked: v && v.ok, meta: document.querySelector('#meta').textContent };
    // a session change: a new file, and a new filter (the manifest)
    const w = await (await P.dir.getFileHandle('notes2.txt', { create: true })).createWritable(); await w.write('seen in the pack'); await w.close();
    document.querySelector('#filter').value = 'FE > 6'; await m.applyBlockFilter('FE > 6');
    out.packSame = (await window.__full.arrayBuffer()).byteLength === window.__full.size;
    return out;
  });
  chk(`pack opens as the project, read-only: “${op.name}” (${op.files} files) · title “${op.title}” · filter ${op.filter} · notes “${op.notes}” · CRC pass ${op.checked} (“${op.meta}”)`,
    op.name === 'sm2pk' && op.pack && /pack, read-only/.test(op.title) && op.filter === 'FE > 4' && op.notes === 'field notes' && op.checked === true && /pack checked — \d+ files intact/.test(op.meta));
  chk(`a Full pack's caches match on open (the band index came from the sidecar: ${op.bands})`, op.bands === true);
  // the File menu for a pack
  const menu = await pk.evaluate(async () => {
    document.querySelector('#mFile').click(); await new Promise((r) => setTimeout(r, 50));
    const labels = [...document.querySelectorAll('.menu .item')].map((d) => d.textContent.replace(/Ctrl\+S$/, '').trim());
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return labels;
  });
  chk(`File menu on a pack: Open project pack… + “Save as a project folder…”, no Tidy / Scan / Save as (${menu.filter((l) => /project|pack|Tidy|Scan/.test(l)).join(' · ')})`,
    menu.includes('Open project pack…') && menu.includes('Save as a project folder…') && !menu.some((l) => /^Tidy|^Scan|^Save project as/.test(l)));
  // Save: the whole tree into an empty folder, then it's a normal project
  const sv = await pk.evaluate(async () => {
    const m = window._micro, q = (x) => document.querySelector(x);
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('sm2pk-saved', { create: true });
    let copyAsked = false; const obs = new MutationObserver(() => { if (q('#svDlg').classList.contains('show')) { copyAsked = true; q('#svCopy').click(); } }); obs.observe(q('#svDlg'), { attributes: true });
    const pr = m.saveProject();
    for (let t = 0; t < 100 && !q('#pmDlg').classList.contains('show'); t++) await new Promise((x) => setTimeout(x, 50));
    const title = q('#pmTitle').textContent, okLabel = q('#pmOk').textContent;
    q('#pmOk').click(); await pr; obs.disconnect();
    const P = m.project(), d = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2pk-saved');
    const rd = async (path) => { const parts = path.split('/'), n = parts.pop(); let x = d; for (const s2 of parts) x = await x.getDirectoryHandle(s2); return (await x.getFileHandle(n)).getFile(); };
    const mf = JSON.parse(await (await rd('project.json')).text());
    const csv = await rd('models/bm.csv'), meta = JSON.parse(await (await rd('models/bm.csv.meta.json')).text());
    const out = { title, okLabel, copyAsked, pack: !!P.pack, name: P.name, dirty: P.dirty, filter: mf.layers[0].filter, notes2: await (await rd('notes2.txt')).text(), stampOk: meta.mtime === csv.lastModified && meta.size === csv.size, docTitle: document.title };
    // reopen the saved folder from disk: the caches match
    await m.openProjectDir(d);
    const L = m.layers().find((x) => x.name === 'bm.csv');
    out.reBands = !!(L && L._bands); out.reFilter = L && L.filterExpr;
    return out;
  });
  chk(`Save on a pack asks “${sv.title}” → ${sv.okLabel} → the project is now ${sv.name} (pack ${sv.pack}, dirty ${sv.dirty}), no copy-in question (${sv.copyAsked})`,
    sv.title === 'save project' && sv.okLabel === 'Choose folder…' && !sv.pack && sv.name === 'sm2pk-saved' && !sv.dirty && !sv.copyAsked && !/read-only/.test(sv.docTitle));
  chk(`…the folder holds the session's changes (filter ${sv.filter}, notes2 “${sv.notes2}”) and caches stamped to the copies (${sv.stampOk}); reopened, they match (bands ${sv.reBands}, filter ${sv.reFilter})`,
    sv.filter === 'FE > 6' && sv.notes2 === 'seen in the pack' && sv.stampOk && sv.reBands && sv.reFilter === 'FE > 6');
  const ln = await pk.evaluate(async () => {
    const M = window.micro, m = window._micro;
    await M.openProjectPack(new File([window.__lean], 'sm2pk-lean.zip.micro'));
    const L = m.layers().find((x) => x.name === 'bm.csv');
    const out = { bands: !!(L && L._bands), filter: L && L.filterExpr };
    // a damaged pack: one bit in the model
    const u8 = new Uint8Array(await window.__full.arrayBuffer());
    const at = new TextDecoder().decode(u8).indexOf('XC,YC,ZC,FE,ROCK\n5,5,5');
    u8[at + 23] ^= 1;                                  // the first FE digit: 0 → 1
    let ev = null; addEventListener('micro:pack-checked', (e) => { if (e.detail.name === 'bad.zip.micro') ev = e.detail; });   // the lean pack's own check may still land
    const res = await M.openProjectPack(new File([u8], 'bad.zip.micro'));
    const v = await res.checked;
    out.at = at; out.ok = v.ok; out.bad = v.bad.map((b) => b.path); out.ev = ev && ev.ok; out.meta = document.querySelector('#meta').textContent;
    // opening one like any file: the pack question, Open = read-only
    const q = (x) => document.querySelector(x);
    const pr = m.openBlob(new File([window.__full], 'sm2pk.zip.micro'), 'sm2pk.zip.micro', 'add');
    for (let t = 0; t < 100 && !q('#pmDlg').classList.contains('show'); t++) await new Promise((x) => setTimeout(x, 50));
    out.foot = [...q('#pmFoot').querySelectorAll('button')].map((b) => b.textContent);
    q('#pmOk').click(); await pr;
    for (let t = 0; t < 100 && !(m.project() && m.project().pack && m.layers().some((x) => x.name === 'bm.csv')); t++) await new Promise((x) => setTimeout(x, 50));
    out.uiPack = !!(m.project() && m.project().pack);
    return out;
  });
  chk(`a lean pack carries no caches (bands ${ln.bands}) but the same project (filter ${ln.filter})`, ln.bands === false && ln.filter === 'FE > 4');
  chk(`a damaged pack: the CRC pass names ${ln.bad.join(', ')} (event ok ${ln.ev}; “${ln.meta.slice(0, 60)}…”)`,
    ln.at > 0 && ln.ok === false && ln.bad.length === 1 && ln.bad[0] === 'models/bm.csv' && ln.ev === false && /pack DAMAGED/.test(ln.meta));
  chk(`opening a .zip.micro: [${ln.foot.join(' · ')}] → Open opens it read-only (${ln.uiPack})`,
    ln.foot.join('|') === 'Cancel|Unpack to a folder…|Open (read-only)' && ln.uiPack);
  await pk.close();
}

// ── §43: "through" acts on what is DRAWN. A through-lasso reaches behind
//     (occlusion), never past the display: records the filter keeps out, hidden
//     categories, the section and a hidden layer are neither selected nor painted.
//     It used to take every record in the tube — 144 of 144 at every step below. ──
{
  const pt = await mkPage('sm2th');
  const th = await pt.evaluate(async () => {
    const M = window._micro, W = window.micro, q = (x) => document.querySelector(x);
    let t = 'XC,YC,ZC,FE,ROCK\n';
    const rows = [];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const r = { x: 5 + i * 10, fe: i + j + k, rock: (i + k) % 2 ? 'ox' : 'fr' }; rows.push(r);
      t += `${r.x},${5 + j * 10},${5 + k * 10},${r.fe},${r.rock}\n`;
    }
    await M.openBlob(new File([t], 'th.csv'), 'th.csv', 'replace');
    for (let n = 0; n < 100 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); n++) await new Promise((z) => setTimeout(z, 100));
    const L = M.layers()[0];
    q('#btnFit').click(); await new Promise((z) => setTimeout(z, 500));
    const c = q('canvas'), w = c.clientWidth, h = c.clientHeight;
    const box = [[2, 2], [w - 2, 2], [w - 2, h - 2], [2, h - 2]];
    const sel = async () => { M.clearSelection({ silent: true }); await M.selectVolume(box, 'replace', true); return L._selCount || 0; };
    const out = {};
    out.all = await sel();
    q('#filter').value = 'FE > 4'; await M.applyBlockFilter('FE > 4');
    out.filter = [await sel(), rows.filter((r) => r.fe > 4).length];
    const cats = L.docs.blockDoc.header.categories || [];
    const ox = cats.indexOf('ox');
    L.catHidden = new Set([ox]);
    out.cat = [await sel(), rows.filter((r) => r.fe > 4 && r.rock !== 'ox').length, ox];
    await W.setSection({ axis: 'x', position: 25, thickness: 4, clip: 'slab' });
    out.sec = [await sel(), rows.filter((r) => r.fe > 4 && r.rock !== 'ox' && r.x === 25).length];
    // paint through: the same rule
    const col = M.createPaintCol(L, 'ZONE'); const code = M.addPaintValue(L, col, 'a');
    M.paintArm(L.id, 'ZONE', code);
    await M.paintVolume(box, code, true);
    out.paint = [...col.codes].filter((v) => v === code).length;
    M.paintDisarm();
    // a hidden layer is out of reach
    await W.setVisible(L.id, false);
    out.hidden = [await sel(), M.layerShown(L.id)];
    await W.setVisible(L.id, true);
    // and with nothing hiding, through takes everything again
    L.catHidden = new Set(); await W.setSection(null); q('#filter').value = ''; await M.applyBlockFilter('');
    out.back = await sel();
    return out;
  });
  chk(`through, nothing hidden: ${th.all} of 144`, th.all === 144);
  chk(`through skips what the filter keeps out (${th.filter[0]}, matches ${th.filter[1]})`, th.filter[0] === th.filter[1] && th.filter[1] < 144);
  chk(`…and a hidden category (code ${th.cat[2]}): ${th.cat[0]}, expected ${th.cat[1]}`, th.cat[2] >= 0 && th.cat[0] === th.cat[1] && th.cat[1] < th.filter[1]);
  chk(`…and what the section cuts away (one block wide): ${th.sec[0]}, expected ${th.sec[1]}`, th.sec[0] === th.sec[1] && th.sec[1] > 0 && th.sec[1] < th.cat[1]);
  chk(`paint through follows the same rule (${th.paint} painted = ${th.sec[1]})`, th.paint === th.sec[1]);
  chk(`a hidden layer is out of reach (${th.hidden[0]} selected, shown ${th.hidden[1]}); nothing hidden → ${th.back} again`, th.hidden[0] === 0 && th.hidden[1] === false && th.back === 144);
  await pt.close();
}

// ── §44: source identity by CONTENT (a sampled hash). A byte-identical rewrite
//     with a new mtime (what any copy is) keeps the discovery sidecar AND the
//     painted column; a same-size edit makes both stale. Before: the mtime threw
//     the sidecar away on a copy, and size:rows reloaded the paint onto edited
//     data. ──
{
  const pi = await mkPage('sm2id');
  await pi.evaluate(async () => { const r = await navigator.storage.getDirectory(); try { await r.removeEntry('sm2id', { recursive: true }); } catch { /* fresh */ } });
  await pi.evaluate(async () => {
    let t = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < 3; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${(i + j + k) % 10}\n`;
    await window._micro.openBlob(new File([t], 'bm.csv'), 'bm.csv', 'replace');
  });
  await pi.waitForFunction(() => window._micro.layers().some((x) => x.name === 'bm.csv' && x.docs.blockDoc), null, { timeout: 20000 });
  await saveProject(pi);
  const id = await pi.evaluate(async () => {
    const M = window._micro, q = (x) => document.querySelector(x);
    const L0 = M.layers()[0];
    const col = M.createPaintCol(L0, 'ZONE'), code = M.addPaintValue(L0, col, 'ore');
    M.paintApply(L0, col, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], code);
    await M.saveProject();
    for (let n = 0; n < 100 && !/project saved/.test(q('#meta').textContent); n++) await new Promise((z) => setTimeout(z, 100));
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2id');
    const models = await dir.getDirectoryHandle('models');
    const meta = JSON.parse(await (await (await models.getFileHandle('bm.csv.meta.json')).getFile()).text());
    const orig = await (await models.getFileHandle('bm.csv')).getFile();
    const text = await orig.text();
    const rewrite = async (s2) => { await new Promise((z) => setTimeout(z, 30)); const w = await (await models.getFileHandle('bm.csv')).createWritable(); await w.write(s2); await w.close(); };
    const reopen = async () => {
      await M.openProjectDir(dir);
      const L = M.layers().find((x) => x.name === 'bm.csv');
      const z = L && (L.paintCols || []).find((c) => c.name === 'ZONE');
      return { bands: !!(L && L._bands), zone: z ? [...z.codes].filter((v) => v > 0).length : 0, meta: q('#meta').textContent };
    };
    const out = { hash: meta.hash || null };
    await rewrite(text);                                    // the same bytes, a new mtime
    out.mtimeMoved = (await (await models.getFileHandle('bm.csv')).getFile()).lastModified !== orig.lastModified;
    out.copy = await reopen();
    const edited = text.replace('\n5,5,5,0\n', '\n5,5,5,9\n');   // one grade, same size, same rows
    out.sameSize = edited.length === text.length && edited !== text;
    await rewrite(edited);
    out.edit = await reopen();
    return out;
  });
  chk(`the sidecar records the source's content hash (${id.hash})`, /^[0-9a-f]{16}$/.test(id.hash || ''));
  chk(`a byte-identical rewrite (new mtime: ${id.mtimeMoved}) keeps the discovery cache (bands ${id.copy.bands}) and the painted column (${id.copy.zone} = 10)`,
    id.mtimeMoved && id.copy.bands && id.copy.zone === 10);
  chk(`a same-size edit (${id.sameSize}) makes both stale: cache ${id.edit.bands ? 'REUSED' : 'rebuilt'}, painted column ${id.edit.zone ? `RELOADED (${id.edit.zone})` : 'not reloaded'}`,
    id.sameSize && !id.edit.bands && id.edit.zone === 0);
  await pi.close();
}

// ── §45: a pack opened from a file joins the recent projects as itself (beside
//     its folder, not replacing it), and its chip reopens it read-only ──
{
  const pr = await mkPage('sm2rc');
  await pr.evaluate(async () => { const r = await navigator.storage.getDirectory(); for (const n of ['sm2rc', 'sm2rc-packs']) { try { await r.removeEntry(n, { recursive: true }); } catch { /* fresh */ } } });
  await pr.evaluate(async () => { await window._micro.openBlob(new File(['XC,YC,ZC,FE\n5,5,5,1\n15,5,5,2\n5,15,5,3\n15,15,5,4\n'], 'rc.csv'), 'rc.csv', 'replace'); });
  await pr.waitForFunction(() => window._micro.layers().some((x) => x.docs.blockDoc), null, { timeout: 20000 });
  await saveProject(pr);
  const rc = await pr.evaluate(async () => {
    const M = window._micro, q = (x) => document.querySelector(x);
    const blob = (await window.micro.backupProject()).blob;
    const pd = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2rc-packs', { create: true });
    const h = await pd.getFileHandle('sm2rc.zip.micro', { create: true });
    const w = await h.createWritable(); await w.write(blob); await w.close();
    window.showOpenFilePicker = async () => [h];
    M.closeProject();
    await M.openProjectPack();                              // File → Open project pack…: the picker's file
    const opened = !!(M.project() && M.project().pack);
    for (let n = 0; n < 50 && ![...q('#emptyProjects').querySelectorAll('.er-chip')].some((c) => /· pack$/.test(c.textContent)); n++) await new Promise((z) => setTimeout(z, 50));
    const chips = [...q('#emptyProjects').querySelectorAll('.er-chip')].map((c) => c.textContent);
    M.closeProject();
    [...q('#emptyProjects').querySelectorAll('.er-chip')].find((c) => c.textContent === 'sm2rc · pack').click();
    for (let n = 0; n < 100 && !(M.project() && M.project().pack); n++) await new Promise((z) => setTimeout(z, 50));
    return { opened, chips, again: !!(M.project() && M.project().pack), name: M.project() && M.project().name, layers: M.layers().length };
  });
  chk(`a pack opened from a file joins the recent projects beside its folder [${rc.chips.join(' · ')}]`,
    rc.opened && rc.chips.includes('sm2rc · pack') && rc.chips.includes('sm2rc'));
  chk(`…and its chip reopens it read-only (${rc.name}, pack ${rc.again}, ${rc.layers} layer)`, rc.again && rc.name === 'sm2rc' && rc.layers === 1);
  await pr.close();
}

// ── §46: grade-tonnage is EXACT and never resident — a sparse histogram on
//     power-of-ten edges, ROUND cutoffs (each one an edge). Checked against brute
//     force on grades sitting exactly ON cutoff values (0.29, 0.3 — where float
//     binning goes wrong), with and without a density expression. ──
{
  const pg = await mkPage('sm2gt');
  const gt = await pg.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,AU,SG\n';
    const rows = [];
    let r = 7;
    for (let k = 0; k < 6; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      const au = [0.29, 0.3, 0.1, 1.5, 0.05][r % 5] + ((r >>> 8) % 3 === 0 ? (r >>> 12) % 100 / 100 : 0);   // many values exactly on round cuts
      const sg = 2.5 + ((r >>> 4) % 5) / 10;
      const AU = +au.toFixed(2);
      rows.push({ au: AU, sg });
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${AU},${sg}\n`;
    }
    await M.openBlob(new File([t], 'gt.csv'), 'gt.csv', 'replace');
    for (let n = 0; n < 100 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); n++) await new Promise((z) => setTimeout(z, 100));
    const L = M.layers()[0];
    const runGT = async (weight) => {
      for (const e of document.querySelectorAll('.fwin')) if (e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')) e.querySelector('.fwin-x, .x, [title="close"]')?.click();
      M.openGradeTonnage(L, { run: true, cfg: { nCut: 20, series: [{ layer: 'gt.csv', col: 'AU', weight }] } });
      let el = null;
      for (let n = 0; n < 200; n++) { el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage') && e._gtSpec); if (el) break; await new Promise((z) => setTimeout(z, 50)); }
      return el && el._gtSpec;
    };
    const check = (spec, weightOf) => {
      const tS = spec.series[0].data, gS = spec.series[1].data;
      let bad = 0;
      const cuts = tS.map((d) => d[0]);
      for (let i = 0; i < tS.length; i++) {
        const c = tS[i][0];
        let T = 0, TG = 0;
        for (const x of rows) if (x.au >= c) { const w = weightOf(x) * 1000; T += w; TG += w * x.au; }
        const tOk = Math.abs(tS[i][1] - T) <= 1e-9 * Math.max(1, T);
        const gOk = T > 0 ? Math.abs(gS[i][1] - TG / T) <= 1e-12 * Math.max(1, TG / T) : !Number.isFinite(gS[i][1]);
        if (!tOk || !gOk) bad++;
      }
      const mn = Math.min(...rows.map((x) => x.au)), mx = Math.max(...rows.map((x) => x.au));
      const step = cuts[1] - cuts[0];
      const round = cuts.every((c) => Math.abs(c / step - Math.round(c / step)) < 1e-9) && [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8].some((m) => Math.abs(step / (m * 10 ** Math.round(Math.log10(step / m))) - 1) < 1e-9);
      const tight = (cuts[cuts.length - 1] - cuts[0]) <= 1.25 * (mx - mn) + 2 * step;   // the axis hugs the data
      return { n: cuts.length, bad, first: cuts[0], last: cuts[cuts.length - 1], mn, mx, step, round, tight, on029: cuts.includes(0.29) || cuts.includes(0.3) };
    };
    const a = check(await runGT(''), () => 1);
    const b = check(await runGT('SG'), (x) => x.sg);
    // the stats window says how far it is ("n of N rows · %")
    M.openStats(L, { run: true, cfg: { cols: ['AU'] } });
    let prog = '';
    for (let n = 0; n < 100; n++) { const el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('stats')); const pe = el && el.querySelector('.sw-prog'); if (pe && pe.textContent) { prog = pe.textContent; break; } if (el && el.querySelector('table')) break; await new Promise((z) => setTimeout(z, 5)); }
    return { a, b, prog };
  });
  chk(`GT exact vs brute force, count: ${gt.a.n} cuts, ${gt.a.bad} wrong · round step ${gt.a.step} (${gt.a.round}, tight ${gt.a.tight}) · ${gt.a.first} ≤ min ${gt.a.mn}, ${gt.a.last} ≥ max ${gt.a.mx} · a cut sits on a data value (${gt.a.on029})`,
    gt.a.n === 21 && gt.a.bad === 0 && gt.a.round && gt.a.tight && gt.a.first <= gt.a.mn && gt.a.last >= gt.a.mx);
  chk(`GT exact vs brute force, tonnes (SG): ${gt.b.n} cuts, ${gt.b.bad} wrong`, gt.b.n === 21 && gt.b.bad === 0);
  await pg.close();
}

// ── §47: a BLANK grade is missing, never zero. `+''` and `+null` are 0, so the
//     analyses counted every unestimated block as grade 0. A model where a third
//     of the blocks have no AU: grade-tonnage at its lowest cut holds only the
//     estimated tonnage, stats n/mean see only the estimated values — on BOTH
//     stats paths (row and pinned), and realizing a calc keeps blanks blank. ──
{
  const pb = await mkPage('sm2blank');
  const bl = await pb.evaluate(async () => {
    const M = window._micro;
    let t = 'XC,YC,ZC,AU,ROCK\n';
    const est = [];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const blank = (i + j + k) % 3 === 0, au = 0.5 + ((i * 7 + j * 3 + k) % 10) / 10;
      if (!blank) est.push(au);
      t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${blank ? '' : au},${i % 2 ? 'ox' : 'fr'}\n`;
    }
    await M.openBlob(new File([t], 'blank.csv'), 'blank.csv', 'replace');
    for (let n = 0; n < 100 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); n++) await new Promise((z) => setTimeout(z, 100));
    const L = M.layers()[0];
    // grade-tonnage (count, no density): tonnage at the lowest cut = estimated blocks × 1000 m³
    M.openGradeTonnage(L, { run: true, cfg: { nCut: 10, series: [{ layer: 'blank.csv', col: 'AU' }] } });
    let el = null;
    for (let n = 0; n < 200 && !el; n++) { el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage') && e._gtSpec); if (!el) await new Promise((z) => setTimeout(z, 50)); }
    const gt0 = el._gtSpec.series[0].data[0][1], gtG0 = el._gtSpec.series[1].data[0][1];
    const mean = est.reduce((a, b) => a + b, 0) / est.length;
    const runStats = async () => {
      for (const w of document.querySelectorAll('.fwin')) delete w._statsRows;
      M.openStats(L, { run: true, cfg: { cols: ['AU'], groupBy: '', weight: '', scope: 'all' } });
      const w = await new Promise((res) => { const t2 = setInterval(() => { for (const x of document.querySelectorAll('.fwin')) if (x._statsRows) { clearInterval(t2); res(x); } }, 50); });
      return w._statsRows[0];
    };
    const row = await runStats();
    // the pinned path: a full filter scan pins AU, then stats again
    const before = window.__statsFast || 0;
    const inp = document.querySelector('#filter'); inp.value = 'XC >= 0 and AU >= 0 or AU < 0'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((res) => { const t2 = setInterval(() => { if (L._filterMask) { clearInterval(t2); res(); } }, 50); });
    inp.value = ''; await M.applyBlockFilter('');
    const pinned = await runStats();
    // realizing a calc column keeps a blank blank
    L.calcCols = (L.calcCols || []).concat([{ name: 'AU2', expr: 'AU * 2' }]); L._calcFns = null;
    const vals = await M.realizeCalc(L, 'AU2');
    const nanCount = [...vals].filter((v) => Number.isNaN(v)).length;
    return { n: est.length, total: 108, gt0, gtG0, mean, row: { n: row.n, mean: row.mean }, pinned: { n: pinned.n, mean: pinned.mean, fast: (window.__statsFast || 0) > before }, nanCount };
  });
  chk(`grade-tonnage counts only estimated blocks: ${bl.gt0} m³ at the lowest cut = ${bl.n} × 1000 (of ${bl.total} blocks), mean ${bl.gtG0.toFixed(4)} = ${bl.mean.toFixed(4)}`,
    bl.gt0 === bl.n * 1000 && Math.abs(bl.gtG0 - bl.mean) < 1e-12);
  chk(`stats skip blanks — row path n ${bl.row.n} = ${bl.n}, mean ${bl.row.mean.toFixed(4)}; pinned path (ran: ${bl.pinned.fast}) n ${bl.pinned.n}, mean ${bl.pinned.mean.toFixed(4)}`,
    bl.row.n === bl.n && Math.abs(bl.row.mean - bl.mean) < 1e-12 && bl.pinned.n === bl.n && Math.abs(bl.pinned.mean - bl.mean) < 1e-12);
  chk(`realizing a calc keeps blanks blank (${bl.nanCount} NaN = ${bl.total - bl.n} unestimated)`, bl.nanCount === bl.total - bl.n);
  await pb.close();
}

// ── §48: grade-tonnage COLUMNAR on a Parquet model (src/colscan.js) — 200,000
//     blocks = 4 row groups, a series whose grade is a CALC column (AU2 = AU*2),
//     weighted by a density column, filtered on a PAINTED column, scoped to the
//     selection — so the chunk view's base · paint · calc slots and the scope mask
//     all ride. Exact against brute force; run on the WORKERS and again with
//     workers unavailable (the page fallback) → the two answers are bit-identical
//     (partials merge in row-group order). ──
{
  const pc = await mkPage('sm2col');
  const cg = await pc.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const NX = 100, NY = 100, NZ = 20, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N), sg = new Float64Array(N);
    let r = 11;
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10;
      au[i] = (r % 7 === 0) ? NaN : +((r >>> 8) % 400 / 100).toFixed(2);   // some unestimated, grades on 0.01 steps
      sg[i] = 2.4 + ((r >>> 4) % 6) / 10;
    }
    const id = await W.addLayer({ kind: 'blocks', name: 'colgt', columns: { X: x, Y: y, Z: z, AU: au, SG: sg }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const L = M.layers().find((q) => q.id === id);
    const groups = L.docs.blockDoc.parquet.rowGroups.length;
    L.calcCols = (L.calcCols || []).concat([{ name: 'AU2', expr: 'AU * 2' }]); L._calcFns = null; L._colStats = null;
    const col = M.createPaintCol(L, 'ZONE'), ore = M.addPaintValue(L, col, 'ore');
    const oreRecs = []; for (let i = 0; i < N; i++) if (i % 3 !== 1) oreRecs.push(i);
    M.paintApply(L, col, oreRecs, ore);
    L._selMask = new Uint8Array(N); for (let i = 0; i < N; i++) L._selMask[i] = (i % 5 !== 2) ? 1 : 0; L._selCount = N;   // the selection scope
    const runGT = async () => {
      M.openGradeTonnage(L, { run: true, cfg: { nCut: 25, scope: 'selection', series: [{ layer: L.name, col: 'AU2', weight: 'SG', filter: 'ZONE == "ore"' }] } });
      let el = null;
      for (let n = 0; n < 600 && !el; n++) { el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage') && e._gtSpec && e._scanWhere); if (!el) await new Promise((z2) => setTimeout(z2, 50)); }
      return { spec: el._gtSpec, where: el._scanWhere };
    };
    const a = await runGT();
    const Wk = window.Worker; window.Worker = undefined;   // no workers here → the page runs the groups
    const b = await runGT();
    window.Worker = Wk;
    // brute force: zone ore, in the selection, estimated, weight SG × 1000 m³
    const tA = a.spec.series[0].data, gA = a.spec.series[1].data;
    let bad = 0;
    for (let c = 0; c < tA.length; c++) {
      const cut = tA[c][0]; let T = 0, TG = 0;
      for (let i = 0; i < N; i++) { if (i % 3 === 1 || i % 5 === 2 || !Number.isFinite(au[i])) continue; const g = au[i] * 2; if (g >= cut) { const w = sg[i] * 1000; T += w; TG += w * g; } }
      if (Math.abs(tA[c][1] - T) > 1e-9 * Math.max(1, T) || (T > 0 ? Math.abs(gA[c][1] - TG / T) > 1e-12 * (TG / T) : Number.isFinite(gA[c][1]))) bad++;
    }
    const same = JSON.stringify(a.spec.series.map((s2) => s2.data)) === JSON.stringify(b.spec.series.map((s2) => s2.data));
    return { groups, cuts: tA.length, bad, whereA: a.where, whereB: b.where, same };
  });
  chk(`grade-tonnage columnar on ${cg.groups} row groups (calc grade · density · painted filter · selection): ${cg.cuts} cuts, ${cg.bad} wrong vs brute force, ran ${cg.whereA}`,
    cg.groups >= 3 && cg.cuts === 26 && cg.bad === 0 && /worker/.test(cg.whereA || ''));
  chk(`…and without workers (${cg.whereB}) the answer is bit-identical (${cg.same})`, cg.whereB === 'on this page' && cg.same);
  await pc.close();
}

// ── §49: stats + swath COLUMNAR (src/colscan.js) agree with the row path, and
//     Run ↔ Cancel. The same 150,000 blocks as Parquet (columnar, workers) and as
//     CSV (held to the row path here — §56 checks CSV on the workers against it): stats grouped + weighted — moments (std too) to 1e-12, quantiles
//     within the t-digest's tolerance; the swath band table to 1e-9. Cancel: a
//     fresh run says "cancelled"; a cancelled re-run keeps the previous result. ──
{
  const pw = await mkPage('sm2colb');
  const cb = await pw.evaluate(async () => {
    const M = window._micro, W = window.micro;
    M.setCsvColumnar(false);                                // the CSV is the ROW-PATH reference
    const NX = 60, NY = 50, NZ = 50, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N), sg = new Float64Array(N), codes = new Uint8Array(N);
    let r = 5, csv = 'X,Y,Z,AU,SG,ROCK\n';
    const labels = ['ox', 'fr', 'tr'];
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10;
      au[i] = (r % 9 === 0) ? NaN : ((r >>> 8) % 1000) / 250;
      sg[i] = 2.4 + ((r >>> 4) % 6) / 10;
      codes[i] = (r >>> 16) % 3;
      csv += `${x[i]},${y[i]},${z[i]},${Number.isFinite(au[i]) ? au[i] : ''},${sg[i]},${labels[codes[i]]}\n`;
    }
    const idP = await W.addLayer({ kind: 'blocks', name: 'colb.parquet', columns: { X: x, Y: y, Z: z, AU: au, SG: sg, ROCK: { codes, labels } }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU', category: 'ROCK' } });
    await M.openBlob(new File([csv], 'colb.csv'), 'colb.csv', 'add');
    for (let n = 0; n < 200 && !M.layers().some((q) => q.name === 'colb.csv' && q.docs.blockDoc); n++) await new Promise((z2) => setTimeout(z2, 100));
    const LP = M.layers().find((q) => q.id === idP), LC = M.layers().find((q) => q.name === 'colb.csv');
    const winOf = (prefix, L) => [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent === `${prefix} · ${L.label || L.name}`);
    const waitWhere = async (prefix, L) => { for (let n = 0; n < 600; n++) { const e = winOf(prefix, L); if (e && e._scanWhere) return e; await new Promise((z2) => setTimeout(z2, 50)); } return null; };
    const stats = async (L) => { M.openStats(L, { run: true, cfg: { cols: ['AU', 'SG'], groupBy: 'ROCK', weight: 'SG', scope: 'all' } }); const e = await waitWhere('stats', L); return { rows: e._statsRows, where: e._scanWhere }; };
    const swath = async (L) => { M.openSwath(L, { run: true, cfg: { series: [{ layer: L.name, col: 'AU', weight: 'SG' }] } }); const e = await waitWhere('swath', L); return { tsv: e._tableTSV && e._tableTSV(), where: e._scanWhere }; };
    const sP = await stats(LP), sC = await stats(LC);
    let mom = 0, qBad = 0;
    const span = 4;
    for (const a of sP.rows) {
      const b = sC.rows.find((x2) => x2.group === a.group && x2.col === a.col);
      if (!b || a.n !== b.n) { mom++; continue; }
      // std is Welford + Chan's merge (src/kernels.js): with Σwx² − mean², SG ≈ 2.7 ± 0.16 amplified the
      // summation ORDER ~300× (1e-10 relative, which needed a 1e-8 tolerance); now std holds to 1e-12 too
      for (const k of ['mean', 'std', 'min', 'max']) if (Math.abs(a[k] - b[k]) > 1e-12 * Math.max(1, Math.abs(b[k]))) { mom++; (window.__momDiff = window.__momDiff || []).push(`${a.group}/${a.col}/${k}: ${a[k]} vs ${b[k]}`); }
      for (const k of ['q25', 'q50', 'q75']) if (Math.abs(a[k] - b[k]) > 0.01 * span) qBad++;
    }
    const wP = await swath(LP), wC = await swath(LC);
    const nums = (t) => (t || '').split('\n').slice(1).map((l) => l.split('\t').map(Number));
    const A = nums(wP.tsv), B = nums(wC.tsv);
    let sw = A.length === B.length && A.length > 0 ? 0 : 1;
    if (!sw) for (let i = 0; i < A.length; i++) for (let j = 0; j < A[i].length; j++) { const u = A[i][j], v = B[i][j]; if (!(Number.isNaN(u) && Number.isNaN(v)) && Math.abs(u - v) > 1e-9 * Math.max(1, Math.abs(v))) sw++; }
    // Cancel: a fresh run, then a re-run over a kept result
    M.openGradeTonnage(LP, { run: true, cfg: { nCut: 10, series: [{ layer: LP.name, col: 'AU' }] } });
    let g = winOf('grade-tonnage', LP); const btn1 = g.querySelector('.sw-run'); const label1 = btn1.textContent; btn1.click();
    for (let n = 0; n < 200 && !/cancelled/.test(g.querySelector('.fwin-head .sub').textContent); n++) await new Promise((z2) => setTimeout(z2, 25));
    const sub1 = g.querySelector('.fwin-head .sub').textContent, lab1b = g.querySelector('.sw-run').textContent;
    g.querySelector('.sw-run').click();                     // a full run
    for (let n = 0; n < 600 && !g._gtSpec; n++) await new Promise((z2) => setTimeout(z2, 50));
    const kept = JSON.stringify(g._gtSpec.series[0].data);
    g.querySelector('.sw-run').click(); g.querySelector('.sw-run').click();   // Run, then Cancel
    for (let n = 0; n < 200 && !/cancelled/.test(g.querySelector('.fwin-head .sub').textContent); n++) await new Promise((z2) => setTimeout(z2, 25));
    const sub2 = g.querySelector('.fwin-head .sub').textContent;
    M.setCsvColumnar(true);
    return { momDiff: window.__momDiff || [], groups: LP.docs.blockDoc.parquet.rowGroups.length, statsRows: sP.rows.length, mom, qBad, whereS: [sP.where, sC.where], swRows: A.length, sw, whereW: [wP.where, wC.where],
      label1, sub1, lab1b, sub2, keptSame: JSON.stringify(g._gtSpec.series[0].data) === kept };
  });
  for (const d of cb.momDiff) console.log(`   ${d}`);
  chk(`stats columnar (${cb.whereS[0]}) = row path (${cb.whereS[1]}) on ${cb.groups} row groups: ${cb.statsRows} rows (group × column, weighted), ${cb.mom} moment mismatches, ${cb.qBad} quantiles outside 1% of the range`,
    /worker/.test(cb.whereS[0]) && cb.whereS[1] === 'on this page' && cb.statsRows === 6 && cb.mom === 0 && cb.qBad === 0);
  chk(`swath columnar (${cb.whereW[0]}) = row path (${cb.whereW[1]}): ${cb.swRows} bands, ${cb.sw} mismatches`, /worker/.test(cb.whereW[0]) && cb.whereW[1] === 'on this page' && cb.swRows > 5 && cb.sw === 0);
  chk(`Run ↔ Cancel: running shows “${cb.label1}”; cancelled → “${cb.sub1}”, the button back to “${cb.lab1b}”; a cancelled re-run → “${cb.sub2}”, the previous result kept (${cb.keptSame})`,
    cb.label1 === 'Cancel' && /^cancelled/.test(cb.sub1) && cb.lab1b === 'Run' && /previous result/.test(cb.sub2) && cb.keptSame);
  await pw.close();
}

// ── §50: the FILTER on the columnar engine (src/colscan.js) — 150,000 blocks,
//     a predicate on a CALC column and a PAINTED column; on the workers it matches
//     brute force, without workers the page gives the bit-identical mask, a block
//     with a null coordinate never enters it (the old path read null as 0 — a
//     phantom at the origin), and the columns the workers decoded are TEED into
//     the pin cache: the next filter refines from memory, right answer. ──
{
  const pf = await mkPage('sm2colc');
  const fc = await pf.evaluate(async () => {
    const M = window._micro, W = window.micro, q = (x2) => document.querySelector(x2);
    const NX = 60, NY = 50, NZ = 50, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N);
    let r = 3;
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let qq = 0; qq < NX; qq++, i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      x[i] = 5 + qq * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10; au[i] = ((r >>> 8) % 1000) / 250;
    }
    const nullAt = 7; x[nullAt] = NaN; au[nullAt] = 3.9;   // matches the predicate, has no X
    const id = await W.addLayer({ kind: 'blocks', name: 'colc.parquet', columns: { X: x, Y: y, Z: z, AU: au }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const L = M.layers().find((l) => l.id === id);
    M.setActiveLayer(L.id);
    L.calcCols = (L.calcCols || []).concat([{ name: 'AU2', expr: 'AU * 2' }]); L._calcFns = null; L._colStats = null;
    const col = M.createPaintCol(L, 'ZONE'), ore = M.addPaintValue(L, col, 'ore');
    const recs = []; for (let i = 0; i < N; i++) if (i % 3 !== 1) recs.push(i);
    M.paintApply(L, col, recs, ore);
    const want = (pred) => { let n = 0; for (let i = 0; i < N; i++) if (Number.isFinite(x[i]) && pred(i)) n++; return n; };
    const seen = [];
    const obs = new MutationObserver(() => { const t = q('#meta').textContent; if (/worker|this page/.test(t)) seen.push(t); });
    obs.observe(q('#meta'), { childList: true, characterData: true, subtree: true });
    const run = async (expr) => { q('#filter').value = expr; await M.applyBlockFilter(expr, L); const m = L._filterMask; let h = 0; for (let i = 0; i < m.length; i++) h += m[i]; return { h, m: m.slice(), nullIn: m[nullAt] }; };
    const EXPR = 'AU2 > 3 and ZONE == "ore"';
    M.setPinBudget('off'); M.setPinBudget(256);              // a clean pin cache that will take the tee
    const a = await run(EXPR);
    const sawWorkers = seen.some((t) => /worker/.test(t)); seen.length = 0;
    const pinnedAfter = M.pinStats().cols;
    M.setPinBudget('off');                                   // no pins → the next run reads the file again
    const Wk = window.Worker; window.Worker = undefined;
    const b = await run(EXPR);
    window.Worker = Wk;
    const sawPage = seen.some((t) => /this page/.test(t));
    obs.disconnect();
    let same = a.m.length === b.m.length; for (let i = 0; same && i < a.m.length; i++) if (a.m[i] !== b.m[i]) same = false;
    // the tee: a fresh worker scan pins its columns; the next filter refines from them
    M.setPinBudget(256);
    await run(EXPR);
    window.__pinUsed = false;
    const c = await run('AU > 1');
    M.setPinBudget('auto');                                  // the context is shared with later sections
    return { N, hits: a.h, want: want((i) => au[i] * 2 > 3 && i % 3 !== 1), nullIn: a.nullIn, sawWorkers, sawPage, same, pinnedAfter, refineHits: c.h, refineWant: want((i) => au[i] > 1), pinUsed: window.__pinUsed === true };
  });
  chk(`filter on the workers (seen: ${fc.sawWorkers}), calc + painted predicate: ${fc.hits} = brute force ${fc.want}; the null-coordinate block is out (${fc.nullIn})`,
    fc.sawWorkers && fc.hits === fc.want && fc.nullIn === 0);
  chk(`…without workers the page runs it (seen: ${fc.sawPage}) and the mask is bit-identical (${fc.same})`, fc.sawPage && fc.same);
  chk(`…the workers' columns are teed into the pin cache (${fc.pinnedAfter} pinned) and the next filter refines from memory (${fc.pinUsed}): ${fc.refineHits} = ${fc.refineWant}`,
    fc.pinnedAfter > 0 && fc.pinUsed && fc.refineHits === fc.refineWant);
  await pf.close();
}

// ── §51: by-solid on the columnar engine — layerPositions reads a Parquet
//     model's coordinates on the worker pool with backpressure. Select inside /
//     outside a box solid on 150,000 blocks = brute force; a block with no X is
//     neither (it was read as 0,0,0); without workers the counts are identical. ──
{
  const ps = await mkPage('sm2cold');
  const sd = await ps.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const NX = 60, NY = 50, NZ = 50, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), v = new Float64Array(N);
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) { x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10; v[i] = (i % 97) / 10; }
    const nullAt = 1234; x[nullAt] = NaN;
    const id = await W.addLayer({ kind: 'blocks', name: 'cold.parquet', columns: { X: x, Y: y, Z: z, V: v }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'V' } });
    const L = M.layers().find((l) => l.id === id);
    const lo = [101, 152, 203], hi = [377, 318, 409];       // a box off the block centres
    const V2 = [], c = (a, b, d) => V2.push(a ? hi[0] : lo[0], b ? hi[1] : lo[1], d ? hi[2] : lo[2]);
    for (let k = 0; k < 8; k++) c(k & 1, k & 2, k & 4);
    const T = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    const mid = await W.addLayer({ kind: 'mesh', name: 'box', vertices: Float64Array.from(V2), triangles: Uint32Array.from(T) });
    const ML = M.layers().find((l) => l.id === mid);
    let inBF = 0, finite = 0;
    for (let i = 0; i < N; i++) { if (!Number.isFinite(x[i])) continue; finite++; if (x[i] > lo[0] && x[i] < hi[0] && y[i] > lo[1] && y[i] < hi[1] && z[i] > lo[2] && z[i] < hi[2]) inBF++; }
    const sel = async (mode) => { await M.selectBySolid(ML, { targets: [L], mode }); return { n: L._selCount || 0, nullIn: L._selMask ? L._selMask[nullAt] : 0 }; };
    const a = { inside: await sel('inside'), outside: await sel('outside') };
    await M.flagBySolid(ML, [L], { name: 'OUTF', label: 'OUT', mode: 'outside' });
    const pcF = M.paintColByName(L, 'OUTF'), oc = pcF ? pcF.dict.indexOf('OUT') : -1;
    let flagged = 0; if (pcF) for (let i = 0; i < pcF.codes.length; i++) if (pcF.codes[i] === oc) flagged++;
    a.flagOut = flagged;
    const Wk = window.Worker; window.Worker = undefined;
    const b = { inside: await sel('inside'), outside: await sel('outside') };
    window.Worker = Wk;
    return { N, inBF, finite, a, b };
  });
  chk(`by-solid on Parquet (columnar positions): inside ${sd.a.inside.n} = brute force ${sd.inBF}; outside ${sd.a.outside.n} = ${sd.finite} with coordinates − inside; the block with no X is in neither (${sd.a.inside.nullIn}/${sd.a.outside.nullIn})`,
    sd.a.inside.n === sd.inBF && sd.a.outside.n === sd.finite - sd.inBF && sd.a.inside.nullIn === 0 && sd.a.outside.nullIn === 0);
  chk(`flag OUTSIDE reaches the row groups the solid's bbox never touches: ${sd.a.flagOut} flagged = ${sd.finite - sd.inBF}`, sd.a.flagOut === sd.finite - sd.inBF);
  chk(`…without workers: inside ${sd.b.inside.n}, outside ${sd.b.outside.n} — identical`, sd.b.inside.n === sd.a.inside.n && sd.b.outside.n === sd.a.outside.n);
  await ps.close();
}

// ── §52: a Datamine .dm on the same engine — its page RUNS are the units
//     (condenser dmPageRuns / readDmRun, fields decoded by striding). 300,000
//     records = 2 runs: grade-tonnage (density-weighted, blanks unestimated) and
//     the filter run on the workers and match brute force. ──
{
  const pd2 = await mkPage('sm2dmcol');
  const dc = await pd2.evaluate(async () => {
    const M = window._micro, q = (x2) => document.querySelector(x2);
    const { makeDM } = await import('/test/dm-make.mjs');
    const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' }, { name: 'AU', type: 'N' }, { name: 'SG', type: 'N' },
      { name: 'XINC', type: 'N', constant: 10 }, { name: 'YINC', type: 'N', constant: 10 }, { name: 'ZINC', type: 'N', constant: 10 },   // the Datamine model fields: a regular lattice
      { name: 'XMORIG', type: 'N', constant: 0 }, { name: 'YMORIG', type: 'N', constant: 0 }, { name: 'ZMORIG', type: 'N', constant: 0 },
      { name: 'NX', type: 'N', constant: 100 }, { name: 'NY', type: 'N', constant: 100 }, { name: 'NZ', type: 'N', constant: 30 }];
    const NX = 100, NY = 100, NZ = 30, N = NX * NY * NZ, rows = new Array(N), au = new Float64Array(N), sg = new Float64Array(N);
    let r = 9;
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let x = 0; x < NX; x++, i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      au[i] = r % 11 === 0 ? NaN : ((r >>> 8) % 300) / 100;
      sg[i] = 2.5 + ((r >>> 4) % 5) / 10;
      rows[i] = { XC: 5 + x * 10, YC: 5 + j * 10, ZC: 5 + k * 10, AU: Number.isFinite(au[i]) ? au[i] : null, SG: sg[i] };
    }
    await M.openBlob(new File([makeDM(fields, rows)], 'm.dm'), 'm.dm', 'replace');
    for (let n = 0; n < 300 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); n++) await new Promise((z) => setTimeout(z, 100));
    const L = M.layers()[0];
    au.forEach((v, i) => { if (Number.isFinite(v)) au[i] = Math.fround(v); }); sg.forEach((v, i) => { sg[i] = Math.fround(v); });   // .dm single precision
    // grade-tonnage, density-weighted
    M.openGradeTonnage(L, { run: true, cfg: { nCut: 15, series: [{ layer: L.name, col: 'AU', weight: 'SG' }] } });
    let el = null;
    for (let n = 0; n < 600 && !el; n++) { el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage') && e._gtSpec && e._scanWhere); if (!el) await new Promise((z) => setTimeout(z, 50)); }
    if (!el) { const w = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')); return { err: w ? w.querySelector('.fwin-head .sub').textContent : 'no window — meta: ' + q('#meta').textContent + ' · grid ' + JSON.stringify(!!M.gridAxesOf(L)) + ' · nums ' + M.numericColsOf(L).join(',') + ' · count ' + L.docs.blockDoc.header.count + ' · layers ' + M.layers().length }; }
    const vol = 1000, tS = el._gtSpec.series[0].data, gS = el._gtSpec.series[1].data;
    let bad = 0;
    for (let c = 0; c < tS.length; c++) {
      let T = 0, TG = 0; for (let i = 0; i < N; i++) if (Number.isFinite(au[i]) && au[i] >= tS[c][0]) { const w = sg[i] * vol; T += w; TG += w * au[i]; }
      if (Math.abs(tS[c][1] - T) > 1e-9 * Math.max(1, T) || (T > 0 && Math.abs(gS[c][1] - TG / T) > 1e-9 * (TG / T))) bad++;
    }
    // the filter
    const seen = []; const obs = new MutationObserver(() => { const t = q('#meta').textContent; if (/worker/.test(t)) seen.push(t); }); obs.observe(q('#meta'), { childList: true, characterData: true, subtree: true });
    q('#filter').value = 'AU > 2 and SG >= 2.7'; await M.applyBlockFilter('AU > 2 and SG >= 2.7', L);
    obs.disconnect();
    let hits = 0; for (let i = 0; i < L._filterMask.length; i++) hits += L._filterMask[i];
    let want = 0; for (let i = 0; i < N; i++) if (au[i] > 2 && sg[i] >= 2.7) want++;
    return { N, count: L.docs.blockDoc.header.count, gtWhere: el._scanWhere, cuts: tS.length, bad, hits, want, filterWorkers: seen.length > 0 };
  });
  if (dc.err) console.log('   GT error: ' + dc.err);
  chk(`.dm grade-tonnage on the engine (${dc.gtWhere}): ${dc.cuts} cuts, ${dc.bad} wrong vs brute force (${dc.count} records, density-weighted)`, /worker/.test(dc.gtWhere || '') && dc.count === dc.N && dc.bad === 0);
  chk(`.dm filter on the workers (${dc.filterWorkers}): ${dc.hits} = brute force ${dc.want}`, dc.filterWorkers && dc.hits === dc.want);
  await pd2.close();
}

// ── §53: the filter's compaction builds OFF the page (src/chunkworker.js — the
//     half-second Morton-sort + packing stalls), the compact set holds exactly the
//     matches, a SUPERSEDED filter's late chunks never land in the next one's set,
//     and the pin tee only runs when its columns fit the budget. ──
{
  const pq3 = await mkPage('sm2comp');
  const cp = await pq3.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const NX = 60, NY = 50, NZ = 50, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N);
    let r = 21;
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) { r = (r * 1103515245 + 12345) >>> 0; x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10; au[i] = ((r >>> 8) % 1000) / 250; }
    const id = await W.addLayer({ kind: 'blocks', name: 'comp.parquet', columns: { X: x, Y: y, Z: z, AU: au }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const L = M.layers().find((l) => l.id === id);
    M.setActiveLayer(L.id);
    const count = (pred) => { let n = 0; for (let i = 0; i < N; i++) if (pred(au[i])) n++; return n; };
    window.__compactOffPage = null;
    await M.applyBlockFilter('AU > 3', L);
    const a = { drawn: M.renderer.layerElementCount(L.id), want: count((v) => v > 3), offPage: window.__compactOffPage, meta: document.querySelector('#meta').textContent };
    // superseded: a wide filter, replaced at once by a narrow one — only the narrow one's chunks may remain
    const p1 = M.applyBlockFilter('AU > 0.5', L);
    const p2 = M.applyBlockFilter('AU > 3.8', L);
    await Promise.all([p1, p2]);
    await new Promise((z2) => setTimeout(z2, 500));         // any late chunks from the superseded builder would have landed by now
    const b = { drawn: M.renderer.layerElementCount(L.id), want: count((v) => v > 3.8) };
    // the tee: a budget too small for the scan's columns → nothing allocated or pinned
    M.setPinBudget('off'); M.setPinBudget(1);                // 1 MB
    await M.applyBlockFilter('AU > 2', L);
    const pinnedSmall = M.pinStats().cols;
    M.setPinBudget(256);
    await M.applyBlockFilter('AU > 2.5', L);
    const pinnedBig = M.pinStats().cols;
    M.setPinBudget('auto');
    // the builder itself, with SMALL batches so chunks flow mid-stream: off the page =
    // byte-identical to on the page (same seed, same batches); close() drops late chunks
    const grid = L.docs.blockDoc.grid, frame = M.frame;
    const build = async (offPage) => {
      const Wk = window.Worker; if (!offPage) window.Worker = undefined;
      const got = [];
      const cb = await M.startChunkBuilder({ frame, grid, chunkSize: 4096, batchSize: 16384, seed: 2, onChunk: (c) => got.push(c) });
      if (!offPage) window.Worker = Wk;
      for (let at = 0; at < 100000; at += 25000) {
        const n = 25000, o = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), chan: new Float64Array(n), cat: null, recIdx: new Uint32Array(n) };
        for (let i = 0; i < n; i++) { const g = at + i; o.x[i] = x[g]; o.y[i] = y[g]; o.z[i] = z[g]; o.chan[i] = au[g]; o.recIdx[i] = g; }
        cb.push(o);
      }
      await cb.flush(); cb.close();
      return { off: cb.offPage, sig: got.map((c) => c.count + ':' + Array.from(c.recIdx.subarray(0, 8)).join(',') + ':' + Array.from(c.ijk.subarray(0, 6)).join(',')).join('|'), n: got.length };
    };
    const on = await build(false), off = await build(true);
    // PARALLEL builders (the open's): every batch its own seed → page, one worker and
    // three workers give the same bytes in the same order (a full hash, every chunk)
    const buildP = async (workers) => {
      const Wk = window.Worker; if (!workers) window.Worker = undefined;
      const got = [];
      const cb = await M.startChunkBuilder({ frame, grid, chunkSize: 4096, batchSize: 16384, seed: 1, seedPerBatch: true, workers: workers || 1, onChunk: (c) => got.push(c) });
      if (!workers) window.Worker = Wk;
      for (let at = 0; at < 100000; at += 25000) {
        const n = 25000, o = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), chan: new Float64Array(n), cat: null, recIdx: new Uint32Array(n) };
        for (let i = 0; i < n; i++) { const g = at + i; o.x[i] = x[g]; o.y[i] = y[g]; o.z[i] = z[g]; o.chan[i] = au[g]; o.recIdx[i] = g; }
        await cb.push(o);
      }
      const doc = await cb.flush(); cb.close();
      let h = 0x811c9dc5;
      for (const c of got) for (const k of ['ijk', 'chan', 'recIdx']) { const u8 = new Uint8Array(c[k].buffer, c[k].byteOffset, c[k].byteLength); for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 16777619) >>> 0; }
      return { h, n: got.length, count: doc.count, w: cb.workers };
    };
    const par = { page: await buildP(0), one: await buildP(1), three: await buildP(3) };
    const late = [];
    const cl = await M.startChunkBuilder({ frame, grid, chunkSize: 4096, batchSize: 8192, seed: 2, onChunk: (c) => late.push(c) });
    for (let k = 0; k < 6; k++) { const n = 20000, o = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), chan: new Float64Array(n), cat: null, recIdx: new Uint32Array(n) }; for (let i = 0; i < n; i++) { o.x[i] = x[i]; o.y[i] = y[i]; o.z[i] = z[i]; o.recIdx[i] = i; } cl.push(o); }
    cl.close();
    await new Promise((z2) => setTimeout(z2, 800));
    return { a, b, pinnedSmall, pinnedBig, on, off, par, lateAfterClose: late.length };
  });
  chk(`compaction off the page (${cp.a.offPage}): the compact set holds exactly the matches (${cp.a.drawn} = ${cp.a.want}; “${cp.a.meta.split('·').pop().trim()}”)`,
    cp.a.offPage === true && cp.a.drawn === cp.a.want && /compacted/.test(cp.a.meta));
  chk(`a superseded filter's late chunks never land: ${cp.b.drawn} drawn = the newer filter's ${cp.b.want}`, cp.b.drawn === cp.b.want);
  chk(`the builder off the page is byte-identical to on it (${cp.off.n} chunks, offPage ${cp.off.off} vs ${cp.on.off}, same: ${cp.off.sig === cp.on.sig}); closed mid-stream → ${cp.lateAfterClose} late chunks delivered`,
    cp.off.off === true && cp.on.off === false && cp.off.n > 10 && cp.off.sig === cp.on.sig && cp.lateAfterClose === 0);
  chk(`parallel builders, a batch each: page / 1 worker / ${cp.par.three.w} workers draw the same bytes in the same order (${cp.par.three.n} chunks, ${cp.par.three.count} blocks, hash ${cp.par.page.h.toString(16)} · ${cp.par.one.h.toString(16)} · ${cp.par.three.h.toString(16)})`,
    cp.par.three.w === 3 && cp.par.page.w === 0 && cp.par.page.n > 10 && cp.par.page.h === cp.par.one.h && cp.par.one.h === cp.par.three.h && cp.par.three.count === 100000 && cp.par.page.count === 100000);
  chk(`the pin tee only runs when it fits: 1 MB budget → ${cp.pinnedSmall} pinned; 256 MB → ${cp.pinnedBig}`, cp.pinnedSmall === 0 && cp.pinnedBig > 0);
  await pq3.close();
}

// ── §54: colour by a column the chunks don't carry = a per-record VALUE TEXTURE
//     (src/valuetex.js): no re-read, the picture the re-stream would draw, the range
//     the column's, blanks at the low end; the same on CSV (its line index's runs,
//     in the renderer's numbering). ──
{
  const pq4 = await mkPage('sm2vtex');
  const vt = await pq4.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const NX = 40, NY = 30, NZ = 20, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N), cu = new Float64Array(N);
    let r = 7, lo = Infinity, hi = -Infinity, blanks = 0;
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) {
      r = (r * 1103515245 + 12345) >>> 0;
      x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10;
      au[i] = ((r >>> 8) % 1000) / 250;
      cu[i] = i % 97 === 0 ? NaN : 0.2 + q * 0.05 + k * 0.01;
      if (Number.isFinite(cu[i])) { if (cu[i] < lo) lo = cu[i]; if (cu[i] > hi) hi = cu[i]; } else blanks++;
    }
    x[5] = NaN; cu[5] = 99;                                 // a record with no X is not drawn: its 99 must stay out of the range
    const id = await W.addLayer({ kind: 'blocks', name: 'vt.parquet', columns: { X: x, Y: y, Z: z, AU: au, CU: cu }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const L = M.layers().find((l) => l.id === id);
    const px = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data;
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) n++; return n / (a.length / 4); };
    const hdr0 = L.docs.blockDoc.header, auIdx = hdr0.columns.indexOf('AU');
    const pAU = await px();
    await W.setColorBy(id, 'CU');
    const tex = { onTex: !!L._valTex, sameDoc: L.docs.blockDoc.header === hdr0 && hdr0.mapping.chan === auIdx, range: M.renderer.layerChanRange(id), lo, hi, meta: document.querySelector('#meta').textContent };
    const pTex = await px();
    // the reference: the same colour by the re-stream (texture path off)
    await W.setColorBy(id, 'AU');
    window.__noValueTex = true;
    await W.setColorBy(id, 'CU');
    window.__noValueTex = false;
    const L2 = M.layers().find((l) => l.id === id);
    const restreamed = L2.docs.blockDoc.header !== hdr0;
    const pRe = await px();
    // and back to AU — now the column the chunks DON'T carry, so a texture again
    await W.setColorBy(id, 'AU');
    const backOnTex = !!L2._valTex && L2._valTex.name === 'AU';
    const pAU2 = await px();
    // CSV: the row path
    let csv = 'X,Y,Z,AU,CU\n';
    for (let i = 0; i < N; i++) csv += `${x[i]},${y[i]},${z[i]},${au[i]},${Number.isFinite(cu[i]) ? cu[i] : ''}\n`;
    const id2 = await M.openBlob(new File([csv], 'vt.csv'), 'vt.csv', 'add');
    await W.removeLayer(id);                                // the CSV alone on screen (same blocks)
    await W.setColorBy(id2, 'CU');
    const L3 = M.layers().find((l) => l.id === id2);
    const csvTex = { onTex: !!L3._valTex, range: M.renderer.layerChanRange(id2), where: L3._valTex && L3._valTex.where };
    const cTex = await px();
    // the CSV re-stream's picture: a record shifted by the row with no X would show
    await W.setColorBy(id2, 'AU');
    window.__noValueTex = true; await W.setColorBy(id2, 'CU'); window.__noValueTex = false;
    const cRe = await px();
    return { tex, restreamed, dTexRe: differ(pTex, pRe), dTexAU: differ(pTex, pAU), backOnTex, dAU: differ(pAU, pAU2),
      csv: { ...csvTex, dTexRe: differ(cTex, cRe), meta: document.querySelector('#meta').textContent }, blanks, baseOffPage: window.__baseOffPage };
  });
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  chk(`colour by CU (not in the chunks): a value texture, no re-read (“${vt.tex.meta}”)`, vt.tex.onTex && vt.tex.sameDoc);
  chk(`its range is CU's own over the drawn blocks [${vt.tex.range}] (${vt.blanks} blanks and an undrawn 99 left out)`, vt.tex.range && near(vt.tex.range[0], vt.tex.lo) && near(vt.tex.range[1], vt.tex.hi));
  chk(`the texture draws what the re-stream draws: ${(100 * vt.dTexRe).toFixed(2)}% of pixels differ (vs ${(100 * vt.dTexAU).toFixed(1)}% between CU and AU)`, vt.restreamed && vt.dTexRe < 0.005 && vt.dTexAU > 0.05);
  chk(`back to AU after the re-stream: a texture again, the same picture as the open (${(100 * vt.dAU).toFixed(2)}% differ)`, vt.backOnTex && vt.dAU < 0.005);
  chk(`CSV (${vt.csv.where}, the renderer's record numbering): a value texture, range [${vt.csv.range}], ${(100 * vt.csv.dTexRe).toFixed(2)}% of pixels differ from the CSV re-stream`, vt.csv.dTexRe < 0.005 && vt.csv.onTex && vt.csv.range && near(vt.csv.range[0], vt.tex.lo) && near(vt.csv.range[1], vt.tex.hi));
  chk(`the open built its block chunks off the page (${vt.baseOffPage}) — and the pictures above are those chunks`, vt.baseOffPage === true);
  await pq4.close();
}

// ── §55: a still frame's pick buffer is built in idle frames (renderer.idleCapture);
//     a pick then READS it — and reads exactly what a rendered pick finds, with and
//     without a section; a moved camera throws it away. Parquet rows come from the
//     row worker, the same values as the page's read. ──
{
  const pq5 = await mkPage('sm2pickcap');
  const pc = await pq5.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const NX = 30, NY = 24, NZ = 16, N = NX * NY * NZ;
    const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N), au = new Float64Array(N);
    for (let k = 0, i = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let q = 0; q < NX; q++, i++) { x[i] = 5 + q * 10; y[i] = 5 + j * 10; z[i] = 5 + k * 10; au[i] = (q * 7 + j * 3 + k) % 11; }
    const id = await W.addLayer({ kind: 'blocks', name: 'pc.parquet', columns: { X: x, Y: y, Z: z, AU: au }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const frames = (k) => new Promise((r) => { const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const ready = async () => { await frames(3);              // the change draws first (a moved section drops the old capture)
      for (let n = 0; n < 400 && !M.renderer.captureReady; n++) await new Promise((r) => requestAnimationFrame(r)); return M.renderer.captureReady; };
    const c = document.querySelector('#cv').getBoundingClientRect();
    const pts = []; for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) pts.push([c.width * a / 8, c.height * b / 8]);
    const key = (r) => JSON.stringify(r.map((h) => h && [h.layer, h.rec, h.face]));
    const compare = async () => {
      const ok0 = await ready();
      const before = M.renderer.picksFromCapture;
      const fromCap = key(await W.worldAt(pts));
      const used = M.renderer.picksFromCapture - before;
      globalThis.__noPickCapture = true;
      const rendered = key(await W.worldAt(pts));
      globalThis.__noPickCapture = false;
      return { ready: ok0, used, same: fromCap === rendered, hits: JSON.parse(fromCap).filter(Boolean).length };
    };
    const plain = await compare();
    await W.setSection({ axis: 'x', at: [155, 120, 80], thickness: 40 });
    const sect = await compare();
    // a camera change: the capture goes, the next pick renders (and is still right)
    M.cam.orbit(0.3, 0); M.requestRender();
    await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r));
    const staleBefore = M.renderer.captureReady;
    // what is clickable changes WITHOUT a camera move (the layer hidden): the capture
    // must stop answering at once — not only after the next frame has drawn
    const ok2 = await ready();
    M.renderer.setLayerVisible(id, false);
    const readyAfterHide = M.renderer.captureReady;
    const capB = M.renderer.picksFromCapture;
    const hidden = await W.worldAt([[c.width / 2, c.height / 2]]);
    const hiddenPick = { ok2, readyAfterHide, used: M.renderer.picksFromCapture - capB, hit: !!(hidden && hidden[0]) };
    M.renderer.setLayerVisible(id, true); M.requestRender();
    // the row worker: a pick's row = the page's read of that row
    const L = M.layers().find((l) => l.id === id);
    const rows = [];
    for (const rec of [0, 4321, N - 1]) rows.push(JSON.stringify(await M.fetchLayerRow(L, rec)) === JSON.stringify(['X', 'Y', 'Z', 'AU'].map((nm) => ({ X: x, Y: y, Z: z, AU: au })[nm][rec])));
    return { plain, sect, staleBefore, hiddenPick, rows };
  });
  chk(`pick from the idle capture = a rendered pick at 49 points (${pc.plain.hits} hits, ${pc.plain.used} answered from the capture)`, pc.plain.ready && pc.plain.used > 0 && pc.plain.same && pc.plain.hits > 10);
  chk(`…with a section on too (${pc.sect.hits} hits, same: ${pc.sect.same})`, pc.sect.ready && pc.sect.used > 0 && pc.sect.same);
  chk(`a moved camera drops the capture (ready right after: ${pc.staleBefore})`, pc.staleBefore === false);
  chk(`a hidden layer: the capture stops answering before the next frame (${JSON.stringify(pc.hiddenPick)})`, pc.hiddenPick.ok2 && !pc.hiddenPick.readyAfterHide && pc.hiddenPick.used === 0 && !pc.hiddenPick.hit);
  chk(`a Parquet row read by the row worker = the source row (${pc.rows})`, pc.rows.every(Boolean));
  await pq5.close();
}

// ── §56: a CSV block model on the COLUMNAR engine (src/colscan.js): the open's
//     line index cut into runs, each run parsed on a worker. The same file twice —
//     one layer on the workers, one held to the row path — must agree, through the
//     awkward rows: a non-number X, a non-number Y and a BLANK X — no records,
//     dropped and REPORTED (a blank coordinate is no block at 0), a
//     comment and a blank line, a quoted category holding a comma, quotes and a
//     NEWLINE, qualified grades (<0.02 → its substitute, n.d. → blank, >5), and
//     runs of 1024 records so the file is several runs. Stats (moments to 1e-12),
//     swath (1e-9), the filter's mask (bit for bit, qualified values included), and
//     the value texture (range + picture). ──
{
  const pc = await mkPage('sm2csvcol');
  const r = await pc.evaluate(async () => {
    const M = window._micro, W = window.micro;
    M.setCsvColumnar(true, 1);
    M.setPinBudget('off');                                  // nothing answered from memory: every read is a real read
    const NX = 20, NY = 20, NZ = 16;
    let s = 'X,Y,Z,AU,CU,ROCK\n', q = 11, i = 0, qualified = 0;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let a = 0; a < NX; a++, i++) {
      q = (q * 1103515245 + 12345) >>> 0;
      const X = i === 3 ? 'n/a' : i === 5 ? '' : 5 + a * 10, Y = i === 2000 ? 'abc' : 5 + j * 10, Z = 5 + k * 10;
      let au = String(((q >>> 8) % 1000) / 250);
      if (i % 13 === 0) { au = '<0.02'; qualified++; } else if (i % 29 === 0) au = 'n.d.'; else if (i % 31 === 0) au = '';
      const cu = i % 17 === 0 ? '>5' : String(0.2 + a * 0.05 + k * 0.01);
      const rock = i % 50 === 7 ? '"ox, ""weathered""\nzone"' : ['ox', 'fr', 'tr'][(q >>> 16) % 3];
      s += `${X},${Y},${Z},${au},${cu},${rock}\n`;
      if (i === 900) s += '# a comment line\n\n';
    }
    const idA = await M.openBlob(new File([s], 'colA.csv'), 'colA.csv', 'add');
    const idB = await M.openBlob(new File([s], 'colB.csv'), 'colB.csv', 'add');
    const LA = M.layers().find((l) => l.id === idA), LB = M.layers().find((l) => l.id === idB);
    const idx = LA.docs.blockDoc.header.index, count = LA.docs.blockDoc.header.count;
    const winOf = (prefix, L) => [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent === `${prefix} · ${L.label || L.name}`);
    const waitWhere = async (prefix, L) => { for (let n = 0; n < 600; n++) { const e = winOf(prefix, L); if (e && e._scanWhere) return e; await new Promise((z) => setTimeout(z, 50)); } return null; };
    const stats = async (L) => { M.openStats(L, { run: true, cfg: { cols: ['AU', 'CU'], groupBy: 'ROCK', scope: 'all' } }); const e = await waitWhere('stats', L); return { rows: e._statsRows, where: e._scanWhere }; };
    const swath = async (L) => { M.openSwath(L, { run: true, cfg: { series: [{ layer: L.name, col: 'CU' }] } }); const e = await waitWhere('swath', L); return { tsv: e._tableTSV && e._tableTSV(), where: e._scanWhere }; };
    const onA = M.canScanColumnar(LA);
    const dropped = LA.docs.blockDoc.header.dropped, metaA = LA.docs.blockDoc.metaLine;
    const sA = await stats(LA), wA = await swath(LA);
    M.setCsvColumnar(false);
    const offB = !M.canScanColumnar(LB);
    const sB = await stats(LB), wB = await swath(LB);
    M.setCsvColumnar(true, 1);
    let mom = 0, qBad = 0; const diffs = [];
    for (const a of sA.rows) {
      const b = sB.rows.find((x) => x.group === a.group && x.col === a.col);
      if (!b || a.n !== b.n) { mom++; diffs.push(`${a.group}/${a.col}: n ${a.n} vs ${b && b.n}`); continue; }
      for (const k of ['mean', 'std', 'min', 'max']) if (Math.abs(a[k] - b[k]) > 1e-12 * Math.max(1, Math.abs(b[k]))) { mom++; diffs.push(`${a.group}/${a.col}/${k}: ${a[k]} vs ${b[k]}`); }
      for (const k of ['q25', 'q50', 'q75']) if (Math.abs(a[k] - b[k]) > 0.01 * Math.max(1e-9, b.max - b.min)) qBad++;
    }
    const nums = (t) => (t || '').split('\n').slice(1).map((l) => l.split('\t').map(Number));
    const A = nums(wA.tsv), B = nums(wB.tsv);
    let sw = A.length === B.length && A.length > 0 ? 0 : 1;
    if (!sw) for (let x = 0; x < A.length; x++) for (let y = 0; y < A[x].length; y++) { const u = A[x][y], v = B[x][y]; if (!(Number.isNaN(u) && Number.isNaN(v)) && Math.abs(u - v) > 1e-9 * Math.max(1, Math.abs(v))) { sw++; (window.__swd = window.__swd || []).push(`band ${x} col ${y}: ${u} vs ${v}`); } }
    // the filter: the qualified <0.02 reads as its substitute (0.01) on both paths
    const F = 'AU < 0.015 or CU > 4.9';
    M.setActiveLayer(idA); window.__csvBandsSkipped = undefined;
    await M.applyBlockFilter(F, LA);
    const engineRan = window.__csvBandsSkipped !== undefined;
    M.setCsvColumnar(false); M.setActiveLayer(idB);
    await M.applyBlockFilter(F, LB);
    M.setCsvColumnar(true, 1);
    const mA = LA._filterMask, mB = LB._filterMask;
    let hits = 0, mdiff = mA && mB && mA.length === mB.length ? 0 : -1;
    if (mdiff === 0) for (let x = 0; x < mA.length; x++) { hits += mA[x]; if (mA[x] !== mB[x]) mdiff++; }
    await M.applyBlockFilter('', LA); await M.applyBlockFilter('', LB);
    // the value texture: colour by CU on each, each alone on screen
    const px = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data;
    };
    const differ = (a, b) => { let n = 0; for (let x = 0; x < a.length; x += 4) if (Math.abs(a[x] - b[x]) > 4 || Math.abs(a[x + 1] - b[x + 1]) > 4 || Math.abs(a[x + 2] - b[x + 2]) > 4) n++; return n / (a.length / 4); };
    const alone = (L, on) => { L.visible = on; M.renderer.setLayerVisible(L.id, on); };
    await W.setColorBy(idA, 'CU');
    const texA = { where: LA._valTex && LA._valTex.where, range: M.renderer.layerChanRange(idA) };
    M.setCsvColumnar(false);
    await W.setColorBy(idB, 'CU');
    const texB = { where: LB._valTex && LB._valTex.where, range: M.renderer.layerChanRange(idB) };
    M.setCsvColumnar(true);
    alone(LB, false); const pA = await px();
    alone(LB, true); alone(LA, false); const pB = await px();
    alone(LA, true);
    await W.setColorBy(idA, 'AU'); alone(LB, false); const pAU = await px(); alone(LB, true);
    M.setPinBudget('auto');
    return { dropped, metaA, swDiffs: window.__swd || [], onA, offB, runs: idx ? idx.offsets.length : 0, count, rowsS: sA.rows.length, mom, qBad, diffs, whereS: [sA.where, sB.where], swRows: A.length, sw, whereW: [wA.where, wB.where],
      hits, mdiff, engineRan, qualified, texA, texB, dTex: differ(pA, pB), dAU: differ(pA, pAU) };
  });
  for (const d of [...r.diffs, ...r.swDiffs].slice(0, 8)) console.log(`   ${d}`);
  chk(`CSV on the engine: ${r.count} records (6400 rows less the three without usable coordinates), ${r.runs} runs of 1024; the reference held to the row path (${r.onA}, ${r.offB})`, r.onA && r.offB && r.count === 6397 && r.runs === 7);
  chk(`the dropped rows are reported: ${JSON.stringify(r.dropped)} — “${(r.metaA || '').replace(/^.* · (\d+ rows dropped)/, '$1')}”`,
    r.dropped && r.dropped.blank === 1 && r.dropped.text === 2 && r.dropped.firstRow === 4 && /3 rows dropped — no usable coordinates \(1 blank, 2 not a number; first at data row 4\)/.test(r.metaA || ''));
  chk(`stats: CSV on the workers (${r.whereS[0]}) = the row path (${r.whereS[1]}): ${r.rowsS} rows, ${r.mom} moment mismatches, ${r.qBad} quantiles off`, /worker/.test(r.whereS[0]) && r.whereS[1] === 'on this page' && r.rowsS >= 6 && r.mom === 0 && r.qBad === 0);
  chk(`swath: CSV on the workers (${r.whereW[0]}) = the row path (${r.whereW[1]}): ${r.swRows} bands, ${r.sw} mismatches`, /worker/.test(r.whereW[0]) && r.whereW[1] === 'on this page' && r.swRows > 5 && r.sw === 0);
  chk(`filter: the engine's mask = the row path's, bit for bit (${r.mdiff} differ, ${r.hits} hits, ≥ the ${r.qualified} qualified <0.02 rows less those without coordinates)`, r.engineRan && r.mdiff === 0 && r.hits >= r.qualified - 2);
  chk(`value texture: workers (${r.texA.where}) [${r.texA.range}] = row path (${r.texB.where}) [${r.texB.range}]; ${(100 * r.dTex).toFixed(2)}% of pixels differ (vs ${(100 * r.dAU).toFixed(1)}% CU vs AU)`,
    /worker/.test(r.texA.where) && r.texB.where === 'on this page' && r.texA.range && r.texB.range && r.texA.range[0] === r.texB.range[0] && r.texA.range[1] === r.texB.range[1] && r.dTex < 0.001 && r.dAU > 0.05);
  await pc.close();
}

// ── §57: a project saved BEFORE the coordinate rule: its CSV sidecar (v2) holds a
//     discovery that counted a blank-coordinate row as a block. Forged here (the
//     saved v3 sidecar rewritten as v2 with that row's count back in); the reopen
//     must not trust it — rediscovered, the true count, the drop reported. ──
{
  let s = 'X,Y,Z,AU\n';
  for (let i = 0; i < 3000; i++) s += `${i === 10 ? '' : 5 + (i % 30) * 10},${5 + ((i / 30) | 0) * 10},5,${i}\n`;
  let pf = await mkPage('sm2oldcsv');
  await pf.evaluate((csv) => window._micro.openBlob(new File([csv], 'old.csv'), 'old.csv', 'replace'), s);
  await pf.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.blockDoc, null, { timeout: 60000 });
  await saveProject(pf);
  const forged = await pf.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2oldcsv');
    const mh = await (await dir.getDirectoryHandle('models')).getFileHandle('old.csv.meta.json');
    const j = JSON.parse(await (await mh.getFile()).text());
    const was = { v: j.v, count: j.header.count, dropped: j.header.dropped };
    j.v = 2; j.header.count += 1; delete j.header.dropped;   // what the old rule wrote
    const w = await mh.createWritable(); await w.write(JSON.stringify(j)); await w.close();
    return was;
  });
  await pf.close();
  pf = await mkPage('sm2oldcsv');
  await pf.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2oldcsv'); await window._micro.openProjectDir(dir); });
  await pf.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.blockDoc && window._micro.layers()[0].docs.blockDoc.metaLine, null, { timeout: 60000 });
  const re = await pf.evaluate(() => { const L = window._micro.layers()[0], h = L.docs.blockDoc.header; return { count: h.count, dropped: h.dropped, drawn: window._micro.renderer.layerElementCount(L.id), meta: L.docs.blockDoc.metaLine }; });
  chk(`a v4 sidecar was written (v${forged.v}, ${forged.count} records, dropped ${JSON.stringify(forged.dropped)})`, forged.v === 4 && forged.count === 2999 && forged.dropped && forged.dropped.blank === 1);
  chk(`an old (v2) CSV sidecar is not trusted: rediscovered → ${re.count} records, ${re.drawn} drawn, dropped ${JSON.stringify(re.dropped)}`, re.count === 2999 && re.drawn === 2999 && re.dropped && re.dropped.blank === 1 && /1 row dropped/.test(re.meta));
  await pf.close();
}

// ── §58: ZONE MAPS (condenser io/zones.js, src/colscan.js zoneKeeper): the open
//     builds per-1024-record statistics; scans skip the zones that can't hold an
//     answer. A lattice-ordered CSV (z slabs), qualified grades sprinkled through,
//     a category confined to the top slabs. The filter skips zones and its mask is
//     the row path's bit for bit — for a coordinate slab, a category, a qualified
//     threshold (<0.05 may read as 0.025, 0.05, 0 or blank: never skipped); GT with
//     a series filter and stats over a selection skip zones and equal the unzoned
//     answer; the zones survive a save + reopen (the sidecar). ──
{
  const pz = await mkPage('sm2zones');
  const zr = await pz.evaluate(async () => {
    const M = window._micro;
    M.setPinBudget('off'); M.setCsvColumnar(true, 4);
    const NX = 32, NY = 32, NZ = 40;                       // 40960 records → 40 zones
    let s = 'X,Y,Z,AU,ROCK\n', q = 3, i = 0;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let a = 0; a < NX; a++, i++) {
      q = (q * 1103515245 + 12345) >>> 0;
      const au = i % 97 === 0 ? '<0.05' : String((k / 10 + ((q >>> 8) % 100) / 100).toFixed(2));
      const rock = k >= 30 ? ['ox', 'fr'][(q >>> 16) % 2] : ['tr', 'fr'][(q >>> 16) % 2];
      s += `${5 + a * 10},${5 + j * 10},${5 + k * 10},${au},${rock}\n`;
    }
    const id = await M.openBlob(new File([s], 'zones.csv'), 'zones.csv', 'replace');
    const L = M.layers().find((l) => l.id === id), h = L.docs.blockDoc.header;
    const out = { n: h.zones && h.zones.n, cats: h.zones && Object.keys(h.zones.cat) };
    const maskOf = async (expr, mode) => {
      M.setCsvColumnar(mode !== 'row', 4, mode === 'zones');
      window.__csvZonesSkipped = 0;
      await M.applyBlockFilter(expr, L);
      const m = L._filterMask ? Uint8Array.from(L._filterMask) : null;
      const sk = window.__csvZonesSkipped || 0;
      await M.applyBlockFilter('', L);
      return { m, sk };
    };
    const same = (a, b) => { if (!a || !b || a.length !== b.length) return -1; let d = 0; for (let x = 0; x < a.length; x++) if (a[x] !== b[x]) d++; return d; };
    out.f = {};
    for (const ex of ['Z < 100', "ROCK = 'ox'", 'AU < 0.03', "Z > 300 and ROCK = 'tr'"]) {
      const zn = await maskOf(ex, 'zones'), off = await maskOf(ex, 'nozones'), row = await maskOf(ex, 'row');
      let hits = 0; for (const v of zn.m) hits += v;
      out.f[ex] = { skipped: zn.sk, offSkipped: off.sk, dZoneRow: same(zn.m, row.m), dOffRow: same(off.m, row.m), hits };
    }
    // GT with a series filter, zones on vs off (both on the workers)
    const gtOf = async (zonesOn) => {
      M.setCsvColumnar(true, 4, zonesOn);
      const el0 = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')); if (el0) el0.remove();
      M.openGradeTonnage(L, { run: true, cfg: { nCut: 12, series: [{ layer: L.name, col: 'AU', filter: 'Z < 100' }] } });
      for (let n = 0; n < 600; n++) { const el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage')); if (el && el._gtSpec) return el._gtSpec.series[0].data; await new Promise((z) => setTimeout(z, 50)); }
      return null;
    };
    const gOn = await gtOf(true), gOff = await gtOf(false);
    const close = (a, b) => JSON.stringify(a, (k2, v) => (typeof v === 'number' ? +v.toPrecision(12) : v)) === JSON.stringify(b, (k2, v) => (typeof v === 'number' ? +v.toPrecision(12) : v));
    out.gt = { same: !!gOn && close(gOn, gOff), rows: gOn && gOn.length };
    // stats over a selection (the top slabs): zones with nothing selected are skipped
    const sel = new Uint8Array(h.count); for (let r = 30 * 1024; r < h.count; r++) sel[r] = 1;
    L._selMask = sel; L._selCount = h.count - 30 * 1024;
    M.setCsvColumnar(true, 4, true);
    const keep = M.zoneKeeper(L, { mask: sel });
    let kept = 0; for (let z = 0; z < h.zones.n; z++) if (keep(z)) kept++;
    out.selKept = kept;
    const statsOf = async (zonesOn) => {
      M.setCsvColumnar(true, 4, zonesOn);
      const old = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('stats')); if (old) old.remove();
      M.openStats(L, { run: true, cfg: { cols: ['AU'], groupBy: 'ROCK', scope: 'selection' } });
      for (let n = 0; n < 600; n++) { const el = [...document.querySelectorAll('.fwin')].find((e) => e.querySelector('.fwin-head .t').textContent.startsWith('stats')); if (el && el._scanWhere) return el._statsRows; await new Promise((z) => setTimeout(z, 50)); }
      return null;
    };
    const sOn = await statsOf(true), sOff = await statsOf(false);
    out.stats = { same: !!sOn && close(sOn.map((x) => ({ ...x, q25: 0, q50: 0, q75: 0 })), sOff.map((x) => ({ ...x, q25: 0, q50: 0, q75: 0 }))), rows: sOn && sOn.length };
    M.setCsvColumnar(true); M.setPinBudget('auto');
    return out;
  });
  await saveProject(pz);
  await pz.close();
  const pz2 = await mkPage('sm2zones');
  await pz2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2zones'); await window._micro.openProjectDir(dir); });
  await pz2.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.blockDoc && window._micro.layers()[0].docs.blockDoc.metaLine, null, { timeout: 60000 });
  const re = await pz2.evaluate(async () => {
    const M = window._micro, L = M.layers()[0], zs = L.docs.blockDoc.header.zones;
    window.__csvZonesSkipped = 0; M.setPinBudget('off');
    await M.applyBlockFilter('Z < 100', L);
    let hits = 0; for (const v of L._filterMask) hits += v;
    M.setPinBudget('auto');
    return { n: zs && zs.n, typed: !!zs && zs.num.Z.min instanceof Float64Array, skipped: window.__csvZonesSkipped, hits };
  });
  await pz2.close();
  chk(`zone maps built at the open: ${zr.n} zones, categories ${JSON.stringify(zr.cats)}`, zr.n === 40 && zr.cats.includes('ROCK'));
  for (const [ex, f] of Object.entries(zr.f)) chk(`filter ${ex}: ${f.skipped} zones skipped (unzoned ${f.offSkipped}), ${f.hits} hits; mask vs the row path: ${f.dZoneRow} differ (unzoned ${f.dOffRow})`,
    f.dZoneRow === 0 && f.dOffRow === 0 && f.offSkipped === 0 && (ex === 'AU < 0.03' ? f.hits > 0 : f.skipped > 0));
  chk(`GT with a series filter (Z < 100): zones on = off (${zr.gt.same}, ${zr.gt.rows} cutoffs)`, zr.gt.same && zr.gt.rows > 5);
  chk(`stats over a selection: ${zr.selKept} of 40 zones read, the same answer as unzoned (${zr.stats.same}, ${zr.stats.rows} rows)`, zr.selKept === 10 && zr.stats.same && zr.stats.rows >= 2);
  chk(`the zones survive save + reopen (${re.n} zones, typed ${re.typed}): Z < 100 skips ${re.skipped}, ${re.hits} hits`, re.n === 40 && re.typed && re.skipped > 0 && re.hits === 32 * 32 * 10);
}

// ── §59: FILE TEXT IS NEVER MARKUP (src/html.js). A CSV whose column name, a
//     category value and a cell carry an onerror payload: the colour-by list, the
//     record panel and the file info render it as TEXT, and nothing runs. ──
{
  const px = await mkPage('sm2xss');
  const xr = await px.evaluate(async () => {
    const M = window._micro, bad = (n) => `<img src=x onerror="window.__xss=(window.__xss||0)+${n}">`;
    let s = `X,Y,Z,"${bad(1).replace(/"/g, '""')}",ROCK,NOTE\n`;
    for (let i = 0; i < 64; i++) s += `${(i % 4) * 10},${((i / 4 | 0) % 4) * 10},${(i / 16 | 0) * 10},${i / 10},"${(i % 2 ? bad(2) : 'ox').replace(/"/g, '""')}","${bad(4).replace(/"/g, '""')}"\n`;
    const id = await M.openBlob(new File([s], `${bad(8)}.csv`), `${bad(8)}.csv`, 'replace');
    const opts = [...document.querySelectorAll('#colorBy option')].map((o) => o.textContent);
    await window.micro.pick({ layer: id, rec: 1 });
    for (let n = 0; n < 100 && !/onerror/.test(document.querySelector('#rpList').textContent); n++) await new Promise((z) => setTimeout(z, 50));
    const rp = document.querySelector('#rpList');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    await new Promise((z) => setTimeout(z, 300));
    const fi = document.querySelector('#helpBody');
    await new Promise((z) => setTimeout(z, 300));                 // an <img onerror> fires on a task, not synchronously
    return {
      xss: window.__xss || 0,
      optText: opts.some((t) => t.includes('<img')),
      rpText: /<img src=x onerror/.test(rp.textContent), rpImgs: rp.querySelectorAll('img').length,
      fiText: /<img src=x onerror/.test(fi.textContent), fiImgs: fi.querySelectorAll('img').length,
    };
  });
  await px.close();
  chk(`file text renders as text — colour-by ${xr.optText}, record panel ${xr.rpText} (${xr.rpImgs} <img>), file info ${xr.fiText} (${xr.fiImgs} <img>); nothing ran (__xss ${xr.xss})`,
    xr.xss === 0 && xr.optText && xr.rpText && xr.rpImgs === 0 && xr.fiText && xr.fiImgs === 0);
}

// ── §60: RECORDS, NOT ROWS — the back-attach paths. A CSV model with blank-
//     coordinate rows (dropped at the open, not records): join → columns (spatial
//     and key), the swath zebra and the column stats each give every record ITS
//     OWN value. Each walked raw rows and counted the dropped one, so every later
//     block took its neighbour's joined value. ──
{
  const pr = await mkPage('sm2recs');
  const rr = await pr.evaluate(async () => {
    const M = window._micro;
    const NX = 6, NY = 5, NZ = 3, val = (i, j, k) => i + 10 * j + 100 * k;
    let sl = 'X,Y,Z,ID,AU\n', sr = 'X,Y,Z,CU\n', sk = 'ID,V\n';
    const expect = [];                                     // per RECORD: [i, j, k, id]
    let id = 0;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++, id++) {
      if (id === 3 || id === 41) sl += `,,${5 + k * 10},${9000 + id},99\n`;   // blank X,Y: dropped, not a record
      sl += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${id},${(id % 7) / 2}\n`;
      sr += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${val(i, j, k)}\n`;
      sk += `${id},${id * 7}\n`;
      expect.push([i, j, k, id]);
    }
    const idL = await M.openBlob(new File([sl], 'left.csv'), 'left.csv', 'replace');
    const idR = await M.openBlob(new File([sr], 'right.csv'), 'right.csv', 'add');
    const idK = await M.openBlob(new File([sk], 'keys.csv'), 'keys.csv', 'add');
    const [L, R, K] = [idL, idR, idK].map((x) => M.layers().find((q) => q.id === x));
    const out = { records: L.docs.blockDoc.header.count, dropped: L.docs.blockDoc.header.dropped };
    const sp = await M.spatialJoinToCols(L, R, { cols: ['right:CU'], ops: {}, weights: {}, useSel: false });
    const cu = M.matColGet(L, sp[0]).fvalues;
    out.spatialBad = expect.filter(([i, j, k], r) => cu[r] !== val(i, j, k)).length;
    const kj = await M.keyJoinToCols(L, K, { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });
    const v = M.matColGet(L, kj.outs[0]).fvalues;
    out.keyBad = expect.filter(([, , , d], r) => v[r] !== d * 7).length;
    await M.applySwathZebra(L, [1, 0, 0], 10, 0);
    const z = M.paintColByName(L, '_swath').codes;
    out.zebraBad = expect.filter(([i], r) => z[r] !== ((i & 1) ? 1 : 2)).length;
    const st = await M.scanColumns(L, null, {});
    out.statsN = st.AU && st.AU.n; out.statsMax = st.AU && st.AU.max;
    return out;
  });
  await pr.close();
  chk(`records not rows: ${rr.records} records, ${rr.dropped && rr.dropped.blank} dropped at the open`, rr.records === 90 && rr.dropped && rr.dropped.blank === 2);
  chk(`join → columns (spatial): every record carries its own cell's value (${rr.spatialBad} wrong)`, rr.spatialBad === 0);
  chk(`join → columns (key): every record carries its own key's value (${rr.keyBad} wrong)`, rr.keyBad === 0);
  chk(`swath zebra: every record striped by its own X (${rr.zebraBad} wrong)`, rr.zebraBad === 0);
  chk(`column stats count records only: AU n ${rr.statsN} (of 90), max ${rr.statsMax} (the dropped rows' 99 is not there)`, rr.statsN === 90 && rr.statsMax === 3);
}

// ── §61: A COLUMN THAT DIDN'T SAVE IS SAID SO. Paint is hand-brushed — not
//     derived — and a failed persistElement used to be swallowed ("derived —
//     never a save failure"), the project marked saved. Forced honestly: the
//     layer's `.cols/` folder replaced by a FILE of that name. Then the other
//     side: a stored column's file deleted → the reopen reports it. ──
{
  const pc = await mkPage('sm2colfail');
  await pc.evaluate(async () => {
    const M = window._micro;
    let s = 'X,Y,Z,ID\n', k = 'ID,V\n';
    for (let i = 0; i < 64; i++) { s += `${(i % 4) * 10},${((i / 4 | 0) % 4) * 10},${(i / 16 | 0) * 10},${i}\n`; k += `${i},${i * 3}\n`; }
    const id = await M.openBlob(new File([s], 'cf.csv'), 'cf.csv', 'replace');
    const kid = await M.openBlob(new File([k], 'cfk.csv'), 'cfk.csv', 'add');
    await M.keyJoinToCols(M.layers().find((q) => q.id === id), M.layers().find((q) => q.id === kid), { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });   // a STORED column: cf.csv.cols/V.parquet
  });
  await saveProject(pc);
  const fail = await pc.evaluate(async () => {
    const M = window._micro;
    const models = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2colfail')).getDirectoryHandle('models');
    await models.removeEntry('cf.csv.cols', { recursive: true });
    const w = await (await models.getFileHandle('cf.csv.cols', { create: true })).createWritable(); await w.write('in the way'); await w.close();
    await M.saveProject();
    for (let n = 0; n < 100 && !document.querySelector('#pmDlg').classList.contains('show'); n++) await new Promise((z) => setTimeout(z, 50));
    const r = { meta: document.querySelector('#meta').textContent, dlg: document.querySelector('#pmDlg').classList.contains('show'), title: document.querySelector('#pmTitle').textContent, msg: document.querySelector('#pmMsg').textContent, dirty: !!M.project().dirty };
    document.querySelector('#pmOk').click();
    await models.removeEntry('cf.csv.cols');               // clear the way: a clean save, then lose one column's file
    return r;
  });
  await pc.evaluate(() => window._micro.saveProject());   // awaited: the meta line already says "project saved — but…"
  await pc.evaluate(async () => {
    const cols = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2colfail')).getDirectoryHandle('models')).getDirectoryHandle('cf.csv.cols');
    await cols.removeEntry('V.parquet');
  });
  await pc.close();
  const pc2 = await mkPage('sm2colfail');
  const lost = await pc2.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2colfail');
    await window._micro.openProjectDir(dir);
    for (let n = 0; n < 200 && !document.querySelector('#pmDlg').classList.contains('show'); n++) await new Promise((z) => setTimeout(z, 50));
    return { dlg: document.querySelector('#pmDlg').classList.contains('show'), title: document.querySelector('#pmTitle').textContent, msg: document.querySelector('#pmMsg').textContent, meta: document.querySelector('#meta').textContent };
  });
  await pc2.close();
  chk(`a column that can't be stored is REPORTED — “${fail.title}” (${fail.msg.slice(0, 70)}…), meta “${fail.meta.slice(0, 60)}”, project still unsaved ${fail.dirty}`,
    fail.dlg && fail.title === 'columns not saved' && /cf\.csv/.test(fail.msg) && /did NOT save/.test(fail.meta) && fail.dirty);
  chk(`a stored column whose file is gone is REPORTED on reopen — “${lost.title}”: ${lost.msg.slice(0, 90)}`,
    lost.dlg && lost.title === 'stored columns not read' && /\bV\b/.test(lost.msg) && /missing/.test(lost.msg) && /not read/.test(lost.meta));
}

// ── §62: THE EXTERNAL MORTON SORT in the app (condenser createMortonSorter).
//     Optimize and the sorted Parquet export spill bucket by bucket; forced to
//     tiny buckets (window.__msortTarget) so a small model takes the many-bucket
//     path: the file's rows come out in Morton order, every block exactly once,
//     each value still with its own coordinates, and a materialized column
//     permuted with them. The unsorted export streams in file order. ──
{
  const pg = await mkPage('sm2msort');
  const r = await pg.evaluate(async () => {
    const M = window._micro;
    const { readParquetRange, parquetInfo } = await import('/ext/parquet/index.js');
    const { mortonKey } = await import('/ext/condenser/src/main.js');
    window.__msortTarget = 8;
    let t = 'XC,YC,ZC,FE,ROCK\n';
    for (let k = 0; k < 5; k++) for (let j = 0; j < 7; j++) for (let i = 0; i < 9; i++) t += `${5 + i * 10},${5 + j * 10},${5 + k * 10},${i * 100 + j},${(i + j) % 3 ? 'ox' : 'fr'}\n`;
    const id = await M.openBlob(new File([t], 'ms.csv'), 'ms.csv', 'replace');
    const L = M.layers().find((q) => q.id === id), h = L.docs.blockDoc.header;
    M.applyCalcCols(L, [{ name: 'EST', expr: 'FE * 2' }]);
    await M.materializeCalcCol(L, 'EST');
    const bb = h.bbox, q = (v, a) => Math.max(0, Math.min(1023, ((v - bb.min[a]) * 1023 / (bb.max[a] - bb.min[a])) | 0));
    const keyOf = (x, y, z) => mortonKey(q(x, 0), q(y, 1), q(z, 2)) >>> 0;
    const inspect = async (blob) => {
      const buf = await blob.arrayBuffer(), info = parquetInfo(buf);
      const c = await readParquetRange(buf, ['XC', 'YC', 'ZC', 'FE', 'ROCK'], 0, info.rowCount, info.meta);
      let ordered = 0, aligned = 0, prev = -1; const seen = new Set();
      for (let i = 0; i < info.rowCount; i++) {
        const k = keyOf(c.XC[i], c.YC[i], c.ZC[i]); if (k >= prev) ordered++; prev = k;
        const ii = (c.XC[i] - 5) / 10, jj = (c.YC[i] - 5) / 10;
        if (c.FE[i] === ii * 100 + jj && c.ROCK[i] === ((ii + jj) % 3 ? 'ox' : 'fr')) aligned++;
        seen.add(`${c.XC[i]},${c.YC[i]},${c.ZC[i]}`);
      }
      return { n: info.rowCount, ordered, aligned, distinct: seen.size, firstX: c.XC.slice(0, 3) };
    };
    await M.runExport(L, { format: 'parquet', spatialSort: true, download: false, filename: 'a.parquet' });
    const sorted = await inspect(window._lastExport);
    await M.runExport(L, { format: 'parquet', spatialSort: false, download: false, filename: 'b.parquet' });
    const plain = await inspect(window._lastExport);
    await M.convertLayerToParquet(L, { keepOriginal: true });
    const P = L.docs.blockDoc.parquet;
    const opt = await inspect(new Blob([P.buf instanceof Blob ? await P.buf.arrayBuffer() : P.buf]));
    const mc = M.matColGet(L, 'EST'); let estBad = 0;
    for (let rec = 0; rec < 315; rec++) { const row = await M.fetchLayerRow(L, rec); if (Math.abs(mc.fvalues[rec] - (+row[3]) * 2) > 1e-6) estBad++; }
    window.__msortTarget = 0;
    return { sorted, plain, opt, estBad };
  });
  await pg.close();
  chk(`external sort, sorted export: ${r.sorted.n} rows, ${r.sorted.ordered} in Morton order, ${r.sorted.aligned} with their own values, ${r.sorted.distinct} distinct blocks`,
    r.sorted.n === 315 && r.sorted.ordered === 315 && r.sorted.aligned === 315 && r.sorted.distinct === 315);
  chk(`unsorted export streams in FILE order (${JSON.stringify(r.plain.firstX)}), ${r.plain.aligned} aligned`, r.plain.n === 315 && r.plain.aligned === 315 && r.plain.firstX.join() === '5,15,25');
  chk(`external sort, optimize: ${r.opt.ordered} of ${r.opt.n} in Morton order, ${r.opt.aligned} aligned; the materialized column follows its blocks (${r.estBad} off)`,
    r.opt.n === 315 && r.opt.ordered === 315 && r.opt.aligned === 315 && r.estBad === 0);
}

// ── §63: RECOVERY — work that only this session holds isn't lost silently.
//     Closing the tab with a layer's own painted / calculated column asks (the
//     browser's beforeunload prompt) and without one doesn't; removing such a
//     layer from the UI asks, Cancel keeps it, Remove removes it. ──
{
  const mkLayer = async (pg, withCol) => pg.evaluate(async (wc) => {
    const M = window._micro;
    let s = 'X,Y,Z,AU\n'; for (let i = 0; i < 27; i++) s += `${(i % 3) * 10},${((i / 3 | 0) % 3) * 10},${(i / 9 | 0) * 10},${i}\n`;
    const id = await M.openBlob(new File([s], 'rc.csv'), 'rc.csv', 'replace');
    if (wc) M.applyCalcCols(M.layers().find((q) => q.id === id), [{ name: 'AU2', expr: 'AU * 2' }]);
    return id;
  }, withCol);
  const asksOnClose = async (withCol) => {
    const pg = await mkPage('sm2rec');
    await mkLayer(pg, withCol);
    let asked = false;
    pg.on('dialog', async (d) => { if (d.type() === 'beforeunload') asked = true; await d.accept(); });
    await pg.close({ runBeforeUnload: true });
    for (let n = 0; n < 40 && !pg.isClosed(); n++) await new Promise((z) => setTimeout(z, 50));
    return asked;
  };
  const askWith = await asksOnClose(true), askWithout = await asksOnClose(false);
  const pr = await mkPage('sm2rec');
  const id = await mkLayer(pr, true);
  const rm = await pr.evaluate(async (lid) => {
    const M = window._micro, out = {};
    const wait = async () => { for (let n = 0; n < 100 && !document.querySelector('#pmDlg').classList.contains('show'); n++) await new Promise((z) => setTimeout(z, 20)); return document.querySelector('#pmDlg').classList.contains('show'); };
    let p = M.confirmRemoveLayer(lid); out.asked = await wait(); out.msg = document.querySelector('#pmMsg').textContent;
    document.querySelector('#pmCancel').click(); await p; out.keptOnCancel = M.layers().some((q) => q.id === lid);
    p = M.confirmRemoveLayer(lid); await wait(); document.querySelector('#pmOk').click(); await p;
    out.goneOnOk = !M.layers().some((q) => q.id === lid);
    return out;
  }, id);
  await pr.close();
  chk(`closing the tab with a layer's own column ASKS (${askWith}); with nothing of its own it doesn't (${!askWithout})`, askWith && !askWithout);
  chk(`removing a layer that carries its own column asks (“${rm.msg.slice(0, 70)}…”), Cancel keeps it (${rm.keptOnCancel}), Remove removes it (${rm.goneOnOk})`, rm.asked && /AU2/.test(rm.msg) && rm.keptOnCancel && rm.goneOnOk);
}

// ── §64: LONG JOBS STOP. Export and optimize show the footer's cancel while they
//     run; a click mid-way writes nothing (export) and leaves the layer exactly
//     as it was (optimize); the button hides again. ──
{
  const pc = await mkPage('sm2cancel');
  const r = await pc.evaluate(async () => {
    const M = window._micro, b = document.querySelector('#metaCancel');
    let s = 'X,Y,Z,AU\n'; for (let i = 0; i < 20000; i++) s += `${(i % 40) * 10},${((i / 40 | 0) % 25) * 10},${(i / 1000 | 0) * 10},${i % 97}\n`;
    const id = await M.openBlob(new File([s], 'cx.csv'), 'cx.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    const clickWhileRunning = async (start) => {
      const p = start();
      let seen = false;
      for (let n = 0; n < 200 && !seen; n++) { await new Promise((z) => setTimeout(z, 1)); if (!b.hidden) { seen = true; b.click(); } }
      const ret = await p;
      return { seen, ret, meta: document.querySelector('#meta').textContent, hiddenAfter: b.hidden };
    };
    window._lastExport = null;
    const ex = await clickWhileRunning(() => M.runExport(L, { format: 'parquet', download: false, filename: 'c.parquet' }));
    ex.wrote = !!window._lastExport;
    const op = await clickWhileRunning(() => M.convertLayerToParquet(L, { keepOriginal: true }));
    op.stillCsv = !L.docs.blockDoc.parquet && L.name === 'cx.csv';
    const full = await M.runExport(L, { format: 'csv', download: false, filename: 'd.csv' });   // and an uninterrupted one still completes
    return { ex, op, full, hidden: b.hidden };
  });
  await pc.close();
  chk(`export cancels mid-way: the button showed (${r.ex.seen}), nothing written (${!r.ex.wrote}), “${r.ex.meta}”, hidden after (${r.ex.hiddenAfter})`, r.ex.seen && !r.ex.wrote && r.ex.ret === -1 && /cancelled/.test(r.ex.meta) && r.ex.hiddenAfter);
  chk(`optimize cancels mid-way: the layer is unchanged (${r.op.stillCsv}), “${r.op.meta}”`, r.op.seen && r.op.stillCsv && /cancelled/.test(r.op.meta) && r.op.hiddenAfter);
  chk(`an uninterrupted export still completes (${r.full} rows), the button hidden (${r.hidden})`, r.full === 20000 && r.hidden);
}

// ── §65: A DECIMAL COMMA CSV (';' between fields, 1,5 in them) opens as numbers:
//     the lattice from its coordinates, a filter over its grades on the workers
//     (the delimited source normalizes the same way) and on the row path, equal
//     to brute force; and through a project save + reopen (the sidecar keeps it). ──
{
  const pd = await mkPage('sm2dec');
  const r = await pd.evaluate(async () => {
    const M = window._micro;
    let s = 'X;Y;Z;AU\n', want = 0;
    for (let k = 0; k < 8; k++) for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const au = ((i * 7 + j * 3 + k) % 50) / 10; if (au > 2.5) want++; s += `${5 + i * 10},5;${5 + j * 10};${5 + k * 10};${String(au).replace('.', ',')}\n`; }
    const id = await M.openBlob(new File([s], 'dec.csv'), 'dec.csv', 'replace');
    const L = M.layers().find((q) => q.id === id), h = L.docs.blockDoc.header;
    const hits = async (columnar) => { M.setCsvColumnar(columnar, 4); M.setPinBudget('off'); await M.applyBlockFilter('AU > 2.5', L); let n = 0; for (const v of L._filterMask) n += v; await M.applyBlockFilter('', L); return n; };
    return { decimal: h.decimal, count: h.count, grid: h.grid && [h.grid.x.count, h.grid.x.pitch, h.grid.x.origin], want, workers: await hits(true), rows: await hits(false) };
  });
  await saveProject(pd);
  await pd.close();
  const pd2 = await mkPage('sm2dec');
  const r2 = await pd2.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dec');
    await window._micro.openProjectDir(dir);
    const L = window._micro.layers()[0];
    window._micro.setCsvColumnar(true); window._micro.setPinBudget('off');
    await window._micro.applyBlockFilter('AU > 2.5', L); let n = 0; for (const v of L._filterMask) n += v;
    return { decimal: L.docs.blockDoc.header.decimal, n };
  });
  await pd2.close();
  chk(`decimal comma: detected (${r.decimal}), ${r.count} records, the lattice ${JSON.stringify(r.grid)} from 5,5 / 15,5 …`, r.decimal === ',' && r.count === 2048 && r.grid && r.grid[0] === 16 && r.grid[1] === 10 && r.grid[2] === 5.5);
  chk(`decimal comma: AU > 2.5 — workers ${r.workers}, row path ${r.rows}, brute force ${r.want}`, r.workers === r.want && r.rows === r.want);
  chk(`decimal comma survives the project (sidecar ${r2.decimal}): ${r2.n} hits`, r2.decimal === ',' && r2.n === r.want);
}

// ── §66: UNDO beyond paint (src/undo.js). Ctrl+Z puts back a selection that was
//     replaced or cleared, a filter changed from the box, and a calc column
//     removed from the calc window — in reverse order; with nothing left it says so. ──
{
  const pu = await mkPage('sm2undo');
  const r = await pu.evaluate(async () => {
    const M = window._micro, z = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    const settle = async (ok) => { for (let n = 0; n < 100 && !ok(); n++) await new Promise((q) => setTimeout(q, 30)); };
    let s = 'X,Y,Z,AU\n'; for (let i = 0; i < 64; i++) s += `${(i % 4) * 10},${((i / 4 | 0) % 4) * 10},${(i / 16 | 0) * 10},${i}\n`;
    const id = await M.openBlob(new File([s], 'un.csv'), 'un.csv', 'replace');
    const L = M.layers().find((q) => q.id === id), out = {};
    const box = document.querySelector('#filter'), enter = (v) => { box.value = v; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); };
    enter('AU > 40'); await settle(() => L.filterExpr === 'AU > 40' && L._filterMask);
    M.filterToSelection(L); out.sel = L._selCount;
    await new Promise((q) => setTimeout(q, 600));            // past the coalescing window
    M.clearSelection(); out.cleared = L._selCount || 0;
    z(); await settle(() => L._selCount === out.sel); out.selBack = L._selCount;
    enter('AU > 50'); await settle(() => L.filterExpr === 'AU > 50');
    z(); await settle(() => L.filterExpr === 'AU > 40'); out.filterBack = L.filterExpr;
    M.applyCalcCols(L, [{ name: 'AU2', expr: 'AU * 2' }]);
    M.openCalcWindow(L, 0);
    const rm = [...document.querySelectorAll('.awin-btn')].find((b) => b.textContent === 'remove'); rm.click();
    out.calcGone = !(L.calcCols || []).some((c) => c.name === 'AU2'); out.top = M.undoLabel();
    z(); await settle(() => (L.calcCols || []).some((c) => c.name === 'AU2')); out.calcBack = (L.calcCols || []).some((c) => c.name === 'AU2');
    // REDO (Ctrl+Shift+Z / Ctrl+Y): takes the removal again, then undo restores it once more
    const rz = (y) => document.dispatchEvent(new KeyboardEvent('keydown', y ? { key: 'y', ctrlKey: true, bubbles: true } : { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true }));
    rz(false); await settle(() => !(L.calcCols || []).some((c) => c.name === 'AU2')); out.redoGone = !(L.calcCols || []).some((c) => c.name === 'AU2');
    z(); await settle(() => (L.calcCols || []).some((c) => c.name === 'AU2'));
    rz(true); await settle(() => !(L.calcCols || []).some((c) => c.name === 'AU2')); out.redoY = !(L.calcCols || []).some((c) => c.name === 'AU2');
    z(); await settle(() => (L.calcCols || []).some((c) => c.name === 'AU2'));
    // a fresh edit forks the history: redo is gone
    enter('AU > 45'); await settle(() => L.filterExpr === 'AU > 45'); await new Promise((q) => setTimeout(q, 400));
    rz(false); out.forked = /nothing to redo/.test(document.querySelector('#meta').textContent);   // redoAction says so synchronously
    await new Promise((q) => setTimeout(q, 150)); out.forked = out.forked && L.filterExpr === 'AU > 45';
    for (let n = 0; n < 8; n++) { z(); await new Promise((q) => setTimeout(q, 80)); }
    await new Promise((q) => setTimeout(q, 400));
    z(); await new Promise((q) => setTimeout(q, 80));
    out.meta = document.querySelector('#meta').textContent;
    return out;
  });
  await pu.close();
  chk(`undo: a cleared selection comes back (${r.sel} → ${r.cleared} → ${r.selBack})`, r.sel === 23 && r.cleared === 0 && r.selBack === 23);
  chk(`undo: a filter changed from the box reverts (“${r.filterBack}”)`, r.filterBack === 'AU > 40');
  chk(`undo: a calc column removed in the calc window returns (${r.calcGone} → ${r.calcBack}, top “${r.top}”); at the bottom: “${r.meta}”`, r.calcGone && r.calcBack && /nothing to undo/.test(r.meta));
  chk(`redo: Ctrl+Shift+Z takes the removal again (${r.redoGone}), Ctrl+Y too (${r.redoY}); a fresh edit forks the history — nothing to redo (${r.forked})`, r.redoGone && r.redoY && r.forked);
}

// ── §67: the DRILLHOLE QA report (src/dhqa.js). A two-table set with known
//     problems: every finding at its row, from the files — a blank collar X, an
//     orphan survey, a dogleg, a gap, an overlap in the second table, a typo in
//     a grade column; clicking a finding goes to the hole and selects its
//     intervals in every table; the limits re-run it; the TSV carries every
//     finding and says what it ran on. ──
{
  const pq = await mkPage('sm2dhqa');
  const r = await pq.evaluate(async () => {
    const M = window._micro, f = (s, nm) => new File([s], nm, { type: 'text/csv' });
    const settle = async (ok) => { for (let n = 0; n < 200 && !ok(); n++) await new Promise((q) => setTimeout(q, 30)); };
    const collar = 'BHID,X,Y,Z,EOH\nH1,1000,2000,300,60\nH2,,2000,300,60\nH3,1100,2000,300,100\n';
    const survey = 'BHID,AT,AZ,DIP\nH1,0,0,90\nH3,0,0,90\nH3,30,0,60\nH3,60,0,60\nZZ,0,0,90\n';     // H3: 30° over 30 m = 30°/30
    const assay = 'BHID,FROM,TO,AU\nH1,0,10,1.5\nH1,12,20,l.5\nH1,20,40,0.8\nH3,0,50,2.1\nH3,50,90,1.1\nH2,0,10,3\n';
    const litho = 'BHID,FROM,TO,ROCK\nH1,0,30,gr\nH1,25,60,gr\nH3,0,100,ba\n';
    const files = { collar: f(collar, 'collars.csv'), survey: f(survey, 'survey.csv') };
    const idA = await M.importDrillholes({ ...files, intervals: f(assay, 'assay.csv') }, {}, 'replace');
    const A = M.layers().find((q) => q.id === idA); A._setKey = 'qa'; A._intervalName = 'assay.csv';
    const grp = M.dhSetGroupOf(A.id);
    const idB = await M.importDrillholes({ collar: A.docs.dhDoc.blobs.collar, survey: A.docs.dhDoc.blobs.survey, intervals: f(litho, 'litho.csv') }, {}, 'add');
    const B = M.layers().find((q) => q.id === idB); B._setKey = 'qa'; B._intervalName = 'litho.csv';
    M.treeMove(B.id, grp, 'into');
    const h = await M.openDhQa(M.dhSetGroupOf(A.id));
    const res = h.state.r, out = {};
    const at = (c) => res.findings.filter((x) => x.check === c).map((x) => `${x.table}:${x.row == null ? '-' : x.row + 1}:${x.bhid}`).join(' ');
    out.members = res.tables.intervals.map((t) => t.name).join(',');
    out.blank = at('collar-blank-xyz'); out.orphan = at('survey-orphan'); out.dogleg = at('survey-dogleg');
    out.gap = at('interval-gap'); out.overlap = at('interval-overlap'); out.text = at('value-text');
    out.n = res.findings.length;
    out.checks = [...h.el.querySelectorAll('.qa-check')].length;
    out.rows = h.el.querySelectorAll('.qa-tbl tr').length - 1;
    // a check in the rail narrows the table to it
    [...h.el.querySelectorAll('.qa-check')].find((b) => /dogleg/.test(b.title)).click();
    out.narrow = h.el.querySelectorAll('.qa-tbl tr').length - 1;
    // click the finding: the camera goes to H3, its intervals are selected in BOTH tables
    const t0 = M.cam.state.target.slice(), T = () => M.cam.state.target;
    h.el.querySelectorAll('.qa-tbl tr')[1].click();
    await settle(() => A._selCount && B._selCount);
    out.moved = Math.hypot(T()[0] - t0[0], T()[1] - t0[1], T()[2] - t0[2]);
    out.selA = A._selCount; out.selB = B._selCount;
    // a stricter dogleg limit: one more knob, one more finding? (30°/30 → none at 45)
    const dl = [...h.el.querySelectorAll('.sw-rail input')][0];
    dl.value = '45'; dl.dispatchEvent(new Event('change'));
    await settle(() => !h.state.running && h.state.r && !h.state.r.findings.some((x) => x.check === 'survey-dogleg'));
    out.dogAfter = h.state.r.findings.filter((x) => x.check === 'survey-dogleg').length;
    out.nAfter = h.state.r.findings.length;
    out.sub = h.el.querySelector('.fwin-head .sub').textContent;
    return out;
  });
  chk(`dh QA: the set's two interval tables (${r.members}); ${r.n} findings over ${r.checks} checks, ${r.rows} rows drawn`, r.members === 'assay.csv,litho.csv' && r.rows === r.n && r.checks >= 6);
  chk(`dh QA: each at its row — blank X ${r.blank} · orphan ${r.orphan} · dogleg ${r.dogleg} · gap ${r.gap} · overlap ${r.overlap} · typo ${r.text}`,
    r.blank === 'collar:2:H2' && r.orphan === 'survey:5:ZZ' && r.dogleg === 'survey:3:H3' && r.gap === 'assay.csv:2:H1' && r.overlap === 'litho.csv:2:H1' && r.text === 'assay.csv:2:H1');
  chk(`dh QA: a check narrows the table (${r.narrow}); a finding goes to its hole (camera moved ${r.moved && r.moved.toFixed(1)}) and selects it in both tables (${r.selA} + ${r.selB})`,
    r.narrow === 1 && r.moved > 1 && r.selA === 2 && r.selB === 1);
  chk(`dh QA: the dogleg limit re-runs it (45°/30 → ${r.dogAfter} doglegs, ${r.nAfter} findings) · “${r.sub}”`, r.dogAfter === 0 && r.nAfter === r.n - 1 && /3 holes|2 holes/.test(r.sub));
  const [dl] = await Promise.all([pq.waitForEvent('download'), pq.evaluate(() => [...document.querySelectorAll('.qa-foot button')].find((b) => b.textContent === 'export TSV').click())]);
  const tsv = await (async () => { const s = await dl.createReadStream(); const parts = []; for await (const c of s) parts.push(c); return Buffer.concat(parts).toString('utf8'); })();
  const tl = tsv.trim().split('\n'), data = tl.filter((l) => !l.startsWith('#'));
  chk(`dh QA: the TSV has every finding (${data.length - 1}) after a header saying what ran (${tl.filter((l) => l.startsWith('#')).length} lines: files, limits)`,
    data.length - 1 === r.nAfter && /collars\.csv .* survey\.csv .* assay\.csv .* litho\.csv/.test(tl[1]) && /dogleg 45/.test(tl[2]) && data[0] === 'severity\tcheck\ttable\trow\thole\tfrom\tto\tdetail');
  await pq.close();
}

// ── §68: the RESOURCE CROSS-TAB (src/xtab.js). Tonnage / grade / metal / count
//     by ROCK × AU bins, density SG × block volume; a blank grade keeps its
//     tonnage in "no grade" so the total is the model's. Every cell equals a
//     brute force, columnar (workers) and row path alike; cumulative, flip,
//     selection scope and the long-form TSV agree with it. ──
{
  const px = await mkPage('sm2xtab');
  const r = await px.evaluate(async () => {
    const M = window._micro, out = {};
    const rock = ['ox', 'fr', 'tr'];
    let s = 'X,Y,Z,AU,SG,ROCK\n'; const recs = [];
    for (let i = 0; i < 600; i++) {
      const x = 5 + (i % 10) * 10, y = 5 + ((i / 10 | 0) % 10) * 10, z = 5 + (i / 100 | 0) * 10;
      const au = i % 37 === 0 ? '' : ((i * 7919) % 400) / 100, sg = 2.5 + (i % 5) * 0.1, rk = rock[i % 3];
      s += `${x},${y},${z},${au},${sg.toFixed(1)},${rk}\n`; recs.push({ au: au === '' ? NaN : +au, sg: +sg.toFixed(1), rk });
    }
    const id = await M.openBlob(new File([s], 'xt.csv'), 'xt.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    const edges = [1, 2], V = 1000;
    const brute = (keep) => {
      const t = new Map();
      recs.forEach((q, i) => {
        if (keep && !keep(i)) return;
        const k = q.rk, w = q.sg * V; if (!t.has(k)) t.set(k, Array.from({ length: 4 }, () => ({ w: 0, wg: 0, n: 0 })));
        const sl = !Number.isFinite(q.au) ? 3 : q.au < 1 ? 0 : q.au < 2 ? 1 : 2, c = t.get(k)[sl];
        c.w += w; if (sl < 3) c.wg += w * q.au; c.n++;
      });
      return t;
    };
    const h = M.openCrosstab(L);
    Object.assign(h.st, { group: 'ROCK', grade: 'AU', weight: 'SG', cutoffs: '1 2', gradeUnit: 'g/t' });
    const check = (b, label) => {
      const X = h.win.el._xtab, bad = [];
      const rowIx = (k) => X.rows.indexOf(k);
      for (const [k, cells] of b) for (let c = 0; c < 4; c++) {
        const want = cells[c], ri = rowIx(k);
        const t = X.cell(ri, c, 'tonnage'), n = X.cell(ri, c, 'count'), g = X.cell(ri, c, 'grade'), m = X.cell(ri, c, 'metal');
        if (Math.abs(t - want.w) > 1e-6 * Math.max(1, want.w) || n !== want.n) bad.push(`${label} ${k}/${c}: t ${t} vs ${want.w}, n ${n} vs ${want.n}`);
        if (c < 3 && want.w > 0 && Math.abs(g - want.wg / want.w) > 1e-9) bad.push(`${label} ${k}/${c}: grade ${g}`);
        if (c < 3 && Math.abs(m - want.wg * 1e-6) > 1e-12 * Math.max(1, want.wg)) bad.push(`${label} ${k}/${c}: metal ${m} vs ${want.wg * 1e-6}`);
        if (c === 3 && Number.isFinite(g)) bad.push(`${label} ${k}: a no-grade cell has a grade`);
      }
      const tot = [...b.values()].reduce((a, cells) => a + cells.reduce((x, c) => x + c.w, 0), 0);
      const T = X.cell(X.rows.indexOf('total'), X.cols.length - 1, 'tonnage');
      if (Math.abs(T - tot) > 1e-6 * tot) bad.push(`${label}: grand total ${T} vs ${tot}`);
      return bad;
    };
    await h.run(); out.where = h.win.el._scanWhere; out.cols = h.win.el._xtab.cols.join(' | '); out.rows = h.win.el._xtab.rows.join(' | ');
    out.bad = check(brute(), 'columnar');
    // the row path gives the same table
    M.setCsvColumnar(false); await h.run(); out.wherePage = h.win.el._scanWhere; out.badPage = check(brute(), 'page'); M.setCsvColumnar(true);
    // cumulative: ≥1 is bins 1+2
    h.st.mode = 'cum'; await h.run();
    { const X = h.win.el._xtab, b = brute(), ri = X.rows.indexOf('ox'); out.cumCols = X.cols.join(' | ');
      out.cumOk = Math.abs(X.cell(ri, 0, 'tonnage') - (b.get('ox')[1].w + b.get('ox')[2].w)) < 1e-6; }
    h.st.mode = 'bins';
    // the selection scope: the first 300 records
    const m = new Uint8Array(600); for (let i = 0; i < 300; i++) m[i] = 1;
    L._selMask = m; L._selCount = 300; h.st.scope = 'selection'; await h.run();
    out.badSel = check(brute((i) => i < 300), 'selection');
    h.st.scope = 'all'; await h.run();
    // flip draws the transpose
    h.win.el.querySelectorAll('.sw-add')[0].click();         // ⇄ flip
    out.flipHead = [...h.win.el.querySelectorAll('.xt-tbl tr:first-child th')].map((t) => t.textContent).join(' | ');
    out.tsv = h.tableTSV().split('\n');
    out.cut = [M.parseCutoffs('0,5 1 2'), M.parseCutoffs('2,0.5,1'), M.parseCutoffs('1; 1;3')].map((a) => a.join(' ')).join(' / ');
    return out;
  });
  await px.close();
  chk(`xtab: ROCK × AU bins (${r.cols}) · rows ${r.rows} — every cell the brute force (tonnage, grade, metal, count), ${r.where}${r.bad.length ? " — " + r.bad.slice(0, 3).join('; ') : ''}`, r.bad.length === 0 && r.cols === '< 1 | 1–2 | ≥ 2 | no grade | total' && r.rows === 'fr | ox | tr | total');
  chk(`xtab: the row path agrees (${r.wherePage})${r.badPage.length ? " — " + r.badPage.slice(0, 3).join('; ') : ''}`, r.badPage.length === 0 && r.wherePage === 'on this page' && r.where !== r.wherePage);
  chk(`xtab: cumulative (${r.cumCols}) · selection scope (${r.badSel.length} bad) · flip heads ${r.flipHead}`, r.cumOk && r.cumCols === '≥ 1 | ≥ 2 | all graded | no grade | total' && r.badSel.length === 0 && /^AU \\ ROCK \| fr \| ox \| tr \| total$/.test(r.flipHead));
  chk(`xtab: the TSV is long form, every measure (${r.tsv.length - 1} rows: ${r.tsv[0]}) · cutoffs parse ${r.cut}`, r.tsv.length - 1 === 4 * 5 && /^ROCK\tAU bin\ttonnage \(t\)\tgrade \(g\/t\)\tmetal \(t\)\tblocks$/.test(r.tsv[0]) && r.cut === '0.5 1 2 / 0.5 1 2 / 1 3');
}

// ── §69: SCATTER + Q-Q (src/xyplot.js). Scatter: a filtered subset draws every
//     pair (r = the brute force); the whole 30,000 blocks draw as a density whose
//     cells add up to n, the row path giving the same grid; log axes count the
//     zeros off. Q-Q: a column against its own subset — the quantiles the exact
//     ones within the digest's error — and a drillhole layer as a side. ──
{
  const px = await mkPage('sm2xy');
  const r = await px.evaluate(async () => {
    const M = window._micro, out = {};
    let s = 'X,Y,Z,AU,CU,ROCK\n'; const A = [], C = [], R = [];
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 30000; i++) {
      const x = 5 + (i % 50) * 10, y = 5 + ((i / 50 | 0) % 30) * 10, z = 5 + (i / 1500 | 0) * 10;
      const au = i % 97 === 0 ? 0 : +(Math.exp(rnd() * 3 - 1.5)).toFixed(4), cu = +(0.4 * au + rnd() * 0.5).toFixed(4), rk = i % 3 ? 'fr' : 'ox';
      s += `${x},${y},${z},${au},${cu},${rk}\n`; A.push(au); C.push(cu); R.push(rk);
    }
    const id = await M.openBlob(new File([s], 'xy.csv'), 'xy.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    const pearson = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; } return sxy / Math.sqrt(sxx * syy); };
    const h = M.openXyPlot(L);
    // a subset: Z < 15 and ROCK ox → few enough pairs to draw each one
    Object.assign(h.st, { x: 'AU', y: 'CU', filter: 'Z < 15 and ROCK == "ox"' });
    await h.run();
    const keep = A.map((_, i) => i).filter((i) => (5 + ((i / 1500) | 0) * 10) < 15 && R[i] === 'ox');
    out.small = h.win.el._xy; out.rSmall = pearson(keep.map((i) => A[i]), keep.map((i) => C[i])); out.nSmall = keep.length;
    // everything: a density
    h.st.filter = ''; await h.run(); out.big = { ...h.win.el._xy, gridSum: [...h.win.el._xy.grid].reduce((a, v) => a + v, 0), grid: null };
    out.rBig = pearson(A, C);
    const g1 = [...h.win.el._xy.grid];
    M.setCsvColumnar(false); await h.run(); out.samePage = JSON.stringify([...h.win.el._xy.grid]) === JSON.stringify(g1); M.setCsvColumnar(true);
    // log axes: the zeros are counted off
    h.st.logX = true; h.st.logY = true; await h.run(); out.log = { n: h.win.el._xy.n, offLog: h.win.el._xy.offLog };
    out.zeros = A.filter((v) => !(v > 0)).length;
    out.notes = h.win.el.querySelector('.xy-notes').textContent;
    // Q-Q: AU (all) against AU where ROCK == "ox"
    h.win.el.querySelectorAll('.sw-seg')[0].children[1].click();
    Object.assign(h.st.a, { layerId: L.id, col: 'AU', filter: '' }); Object.assign(h.st.b, { layerId: L.id, col: 'AU', filter: 'ROCK == "ox"' });
    await h.run();
    const exact = (vs, p) => { const v = vs.slice().sort((a, b) => a - b); const k = p * (v.length - 1), lo = Math.floor(k); return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (k - lo); };
    const qq = h.win.el._xy, P = [0.1, 0.25, 0.5, 0.75, 0.9], at = (p) => Math.round(p * 100);   // QQ_P[k] = k/100 for k = 1…99
    out.qqErr = Math.max(...P.map((p) => Math.abs(qq.qa[at(p)] - exact(A, p)) / exact(A, p)), ...P.map((p) => Math.abs(qq.qb[at(p)] - exact(A.filter((_, i) => R[i] === 'ox'), p)) / exact(A.filter((_, i) => R[i] === 'ox'), p)));
    out.qqN = [qq.na, qq.nb]; out.oxN = R.filter((x) => x === 'ox').length;
    // a drillhole layer as the y side (the row path; no blockDoc)
    const did = await M.importDrillholes(M.makeDemoDrillholes(), {}, 'add');
    const D = M.layers().find((q) => q.id === did), dcol = M.numericColsOf(D)[0];
    Object.assign(h.st.b, { layerId: D.id, col: dcol, filter: '' }); await h.run();
    const qd = h.win.el._xy; out.dh = { n: qd && qd.nb, mono: !!qd && qd.qb.every((v, i, a) => i === 0 || v >= a[i - 1]), col: dcol };
    out.tsv = h.tableTSV().split('\n').length;
    return out;
  });
  await px.close();
  chk(`xy: a filtered subset draws every pair (${r.small.pts} of ${r.nSmall}, over ${r.small.over}) · r ${r.small.r.toFixed(6)} vs ${r.rSmall.toFixed(6)}`, !r.small.over && r.small.pts === r.nSmall && r.small.n === r.nSmall && Math.abs(r.small.r - r.rSmall) < 1e-9);
  chk(`xy: 30,000 pairs as a density — cells add to n (${r.big.gridSum} / ${r.big.n}), r ${r.big.r.toFixed(6)} vs ${r.rBig.toFixed(6)}; the row path draws the same grid (${r.samePage})`, r.big.over && r.big.gridSum === 30000 && r.big.n === 30000 && Math.abs(r.big.r - r.rBig) < 1e-9 && r.samePage);
  chk(`xy: log axes leave the zeros off and say so (${r.log.offLog} of ${r.zeros}; “${r.notes}”)`, r.log.offLog === r.zeros && r.log.n === 30000 - r.zeros && /left off the log axis/.test(r.notes));
  chk(`xy: Q-Q — a column against its subset (n ${r.qqN.join(' vs ')}), P10…P90 within ${(r.qqErr * 100).toFixed(2)}% of exact; a drillhole side (${r.dh.col}, n ${r.dh.n}, monotone ${r.dh.mono}); TSV ${r.tsv} lines`,
    r.qqN[0] === 30000 && r.qqN[1] === r.oxN && r.qqErr < 0.01 && r.dh.n > 0 && r.dh.mono && r.tsv === 102);
}

// ── §70: OMF v1 (src/omf.js). A project with a ROTATED block model (scalar +
//     mapped data), a point set, a triangulated surface and a line set, under a
//     project origin: a layer per element in one group; the block model's lattice
//     declared and rotated, every record at its expected centroid (W fastest, as
//     the format orders cells) with its own value and category; the line set
//     named as not read. ──
{
  const po = await mkPage('sm2omf');
  const r = await po.evaluate(async () => {
    const M = window._micro, out = {};
    const { writeOMF } = await import('/ext/omf1/index.js');
    const th = Math.PI / 6, au = [Math.cos(th), Math.sin(th), 0], av = [-Math.sin(th), Math.cos(th), 0], aw = [0, 0, 1];
    const nu = 4, nv = 3, nw = 2, du = 10, dv = 8, dw = 5, N = nu * nv * nw, org = [100, 50, 0], P0 = [500000, 7000000, 300];
    const AU = Float64Array.from({ length: N }, (_, k) => k * 0.5 + 0.1), IDX = BigInt64Array.from({ length: N }, (_, k) => BigInt(k % 3));
    const project = { type: 'Project', name: 'mine', description: '', origin: P0, date_created: '2026-11-01T00:00:00Z', date_modified: '2026-11-01T00:00:00Z', elements: [
      { type: 'VolumeElement', name: 'bm', description: '', color: null,
        geometry: { type: 'VolumeGridGeometry', origin: org, axis_u: au, axis_v: av, axis_w: aw, tensor_u: new Float64Array(nu).fill(du), tensor_v: new Float64Array(nv).fill(dv), tensor_w: new Float64Array(nw).fill(dw) },
        data: [{ type: 'ScalarData', name: 'AU', description: '', location: 'cells', colormap: null, array: AU },
               { type: 'MappedData', name: 'ROCK', description: '', location: 'cells', indices: IDX, legends: [{ type: 'Legend', name: 'code', values: new Float64Array([11, 22, 33]) }] }] },
      { type: 'PointSetElement', name: 'collars', description: '', color: null,
        geometry: { type: 'PointSetGeometry', vertices: new Float64Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 5]) },
        data: [{ type: 'ScalarData', name: 'DEPTH', description: '', location: 'vertices', colormap: null, array: new Float64Array([100, 120, 90, 150]) }] },
      { type: 'SurfaceElement', name: 'topo', description: '', color: null, textures: [],
        geometry: { type: 'SurfaceGeometry', vertices: new Float64Array([0, 0, 0, 50, 0, 0, 0, 50, 0, 50, 50, 2]), triangles: new BigInt64Array([0n, 1n, 2n, 1n, 3n, 2n]) }, data: [] },
      { type: 'LineSetElement', name: 'faults', description: '', color: null,
        geometry: { type: 'LineSetGeometry', vertices: new Float64Array([0, 0, 0, 1, 1, 1]), segments: new BigInt64Array([0n, 1n]) }, data: [] },
    ] };
    const bytes = await writeOMF(project);
    const first = await M.openBlob(new File([bytes], 'mine.omf'), 'mine.omf', 'replace');
    out.meta = document.querySelector('#meta').textContent;
    const Ls = M.layers();
    out.layers = Ls.map((L) => `${L.label || L.name}:${L.kind}`).join(' | ');
    const grp = M.layerTree().find((n) => n && n.group && n.name === 'mine');
    out.grouped = !!grp && grp.children.length === 3;
    const B = Ls.find((L) => (L.label || L.name) === 'bm');
    const h = B.docs.blockDoc.header;
    out.rot = !!(h.grid && h.grid.rot); out.counts = h.grid && [h.grid.x.count, h.grid.y.count, h.grid.z.count].join('×'); out.n = h.count;
    out.declared = h.lattice && h.lattice.basis;
    out.lineage = B.lineage && B.lineage.op;
    // every record: its centroid and values (W fastest, then V, then U)
    let bad = 0, worst = 0;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) for (let l = 0; l < nw; l++) {
      const k = (i * nv + j) * nw + l, cu = (i + 0.5) * du, cv = (j + 0.5) * dv, cw = (l + 0.5) * dw;
      const want = [0, 1, 2].map((a) => P0[a] + org[a] + au[a] * cu + av[a] * cv + aw[a] * cw);
      const row = await M.fetchLayerRow(B, k), cols = h.columns, at = (c) => row[cols.indexOf(c)];
      const d = Math.max(...[0, 1, 2].map((a) => Math.abs(+at('XYZ'[a]) - want[a])));
      worst = Math.max(worst, d);
      if (d > 1e-6 || Math.abs(+at('AU') - AU[k]) > 1e-12 || String(at('ROCK')) !== String([11, 22, 33][k % 3])) bad++;
    }
    out.bad = bad; out.worst = worst;
    const C = Ls.find((L) => (L.label || L.name) === 'collars');
    out.pts = C && C.docs.blockDoc && C.docs.blockDoc.header.count;
    const row0 = C && await M.fetchLayerRow(C, 3); out.pt3 = row0 && row0.slice(0, 4).map(Number).join(',');
    const T = Ls.find((L) => (L.label || L.name) === 'topo');
    out.mesh = T && T.kind;
    out.first = first === Ls[0].id;
    return out;
  });
  await po.close();
  chk(`omf: a layer per element (${r.layers}) grouped under the file (${r.grouped}); the line set named · “${r.meta}”`, r.grouped && /bm:/.test(r.layers) && /collars:/.test(r.layers) && /topo:mesh/.test(r.layers) && /faults: lines — not read yet/.test(r.meta) && r.first);
  chk(`omf: the block model's lattice declared (${r.declared}) and rotated (${r.rot}), ${r.counts}, ${r.n} blocks; lineage “${r.lineage}”`, r.declared === 'declared' && r.rot && r.counts === '4×3×2' && r.n === 24 && r.lineage === 'omf');
  chk(`omf: every block at its centroid with its own AU and ROCK (W fastest; ${r.bad} wrong, worst ${r.worst.toExponential(1)} m off) · points ${r.pts} (#3 ${r.pt3})`, r.bad === 0 && r.pts === 4 && r.pt3 === '500010,7000010,305,150');
}

// ── §71: MESH QA (src/meshqa.js → @gcu/geometry meshQa). A closed box far from
//     the origin: watertight, one shell, its exact volume and the tonnage at a
//     density; the same box with a triangle missing: not closed, the hole found
//     and the camera stepping to it; a per-face soup welds into the same solid. ──
{
  const pm = await mkPage('sm2meshqa');
  const r = await pm.evaluate(async () => {
    const M = window._micro, out = {};
    const settle = async (ok) => { for (let n = 0; n < 200 && !ok(); n++) await new Promise((q) => setTimeout(q, 30)); };
    const [x0, y0, z0, x1, y1, z1] = [500000, 7000000, 100, 500010, 7000020, 130];
    const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const idA = await M.addLayer({ kind: 'mesh', name: 'box', vertices: Float64Array.from(V), triangles: Uint32Array.from(T) });
    const A = M.layers().find((q) => q.id === idA);
    const h = await M.openMeshQa(A);
    out.a = { ...h.win.el._meshQa, shells: h.win.el._meshQa.shells.length };
    h.win.el.querySelector('.sw-rail input.sw-in').value = '2.7'; h.win.el.querySelector('.sw-rail input.sw-in').dispatchEvent(new Event('change'));
    out.tonnes = [...h.win.el.querySelectorAll('.mq-sum .sw-row')].map((d) => d.textContent).find((t) => /^tonnes/.test(t));
    out.tsv = h.tableTSV().split('\n')[1];
    // a hole: the first bottom triangle gone
    const idB = await M.addLayer({ kind: 'mesh', name: 'holed', vertices: Float64Array.from(V), triangles: Uint32Array.from(T.slice(3)) });
    const B = M.layers().find((q) => q.id === idB);
    const hb = await M.openMeshQa(B);
    out.b = { watertight: hb.win.el._meshQa.watertight, volume: hb.win.el._meshQa.volume, boundary: hb.win.el._meshQa.issues.boundary.count };
    const t0 = M.cam.state.target.slice();
    hb.win.el.querySelector('.mq-tbl tr:nth-child(2)').click();
    const o = M.frame.origin, tg = M.cam.state.target.map((v, k) => v + o[k]);
    out.zoom = { z: tg[2], moved: Math.hypot(...tg.map((v, k) => v - o[k] - t0[k])) };
    out.subB = hb.win.el.querySelector('.fwin-head .sub').textContent;
    // a per-face soup (every corner repeated) welds into the same solid
    const SV = []; for (const i of T) SV.push(V[3 * i], V[3 * i + 1], V[3 * i + 2]);
    const idC = await M.addLayer({ kind: 'mesh', name: 'soup', vertices: Float64Array.from(SV), triangles: Uint32Array.from(T.map((_, k) => k)) });
    const hc = await M.openMeshQa(M.layers().find((q) => q.id === idC));
    out.c = { watertight: hc.win.el._meshQa.watertight, volume: hc.win.el._meshQa.volume, welded: hc.win.el._meshQa.welded };
    hc.win.el.querySelector('.sw-rail input[type=checkbox]').click();
    await settle(() => !hc.st.running && hc.win.el._meshQa && hc.win.el._meshQa.welded === 0);
    out.c2 = { watertight: hc.win.el._meshQa.watertight, shells: hc.win.el._meshQa.shells.length };
    return out;
  });
  await pm.close();
  chk(`mesh QA: a closed box — watertight ${r.a.watertight}, faces one way ${r.a.consistent}, ${r.a.shells} shell, volume ${r.a.volume} (10×20×30), ${r.tonnes}`, r.a.watertight && r.a.consistent && r.a.shells === 1 && Math.abs(r.a.volume - 6000) < 1e-6 && /16,200/.test(r.tonnes) && /^1\t12\tyes\t6000/.test(r.tsv));
  chk(`mesh QA: a triangle missing — watertight ${r.b.watertight}, volume ${r.b.volume}, ${r.b.boundary} boundary edges; a click goes to the hole (z ${r.zoom.z.toFixed(1)}, moved ${r.zoom.moved.toFixed(1)}) · “${r.subB}”`, !r.b.watertight && r.b.volume == null && r.b.boundary === 3 && Math.abs(r.zoom.z - 100) < 1e-6 && r.zoom.moved > 1 && /not watertight/.test(r.subB));
  chk(`mesh QA: a per-face soup welds into the solid (${r.c.welded} welded, watertight ${r.c.watertight}, volume ${r.c.volume}); without the weld: ${r.c2.shells} loose shells`, r.c.welded === 28 && r.c.watertight && Math.abs(r.c.volume - 6000) < 1e-6 && !r.c2.watertight && r.c2.shells === 12);
}

console.log(ok ? '\nMICRO SMOKE 2: PASS' : '\nMICRO SMOKE 2: FAIL');
await b.close(); server.close();
process.exit(ok ? 0 : 1);
