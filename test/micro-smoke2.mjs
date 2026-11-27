// micro smoke, part 2 — the DATA-INTEGRITY + persistence arcs promoted from
// gitignored experiments (2026-07-09 suite increment): sidecars + band
// pushdown (.dm and CSV, exact hits), the explicit Store-as-Parquet dialog
// (keep-original), micro:model kv self-description, pinned analysis windows
// across an OPFS project reload, and swath drag→select → selection→column.
// Run with `npm run test:micro2` (or test:micro:all). Slow (~2-3 min) — the
// fast library layer stays in `npm test`.
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { makeLas } from './las-make.mjs';
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
const b = await chromium.launch({ args: [...(process.env.MICRO_CHROMIUM_ARGS || '--use-gl=angle').split(/\s+/).filter(Boolean)] });
await installSmokeWaits(b);
const ctx = await b.newContext({ viewport: { width: 1100, height: 750 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.autoPackMeshes') == null) localStorage.setItem('micro.autoPackMeshes', 'off'); } catch { /* opaque origin */ } });   // the .wfr store prompt stays out of the way unless a section opts in
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI's runner draws on SwiftShader, where micro would switch to software-rendering mode by itself (draw on change, no idle pick capture, no deferred re-shade); these smokes test the GPU paths, so the mode is pinned off unless a section opts in
let ok = true; const chk = (n, c) => { console.log(`${c ? 'ok ' : 'FAIL'} ${n}`); ok = ok && c; };
// --shard=i/n: run every nth section, starting at the ith (0-based), so the runner
// (test/micro-smokes.mjs) can spread this file over n processes. Each `if (take())`
// below is one section; a section shares nothing with another but the helpers above.
// With no flag every section runs.
const SHARD = (() => { const a = process.argv.find((x) => x.startsWith('--shard=')); if (!a) return null; const [i, n] = a.slice(8).split('/').map(Number); if (!(n >= 1) || !(i >= 0 && i < n)) throw new Error(`bad ${a}`); return { i, n }; })();
let _section = 0, _ran = 0;
// --sections=a-b,c: only these section indices (0-based, ranges inclusive) — to bisect a section that
// fails only after others ran in the same browser (they share one context: storage, workers)
const ONLY = (() => { const a = process.argv.find((x) => x.startsWith('--sections=')); if (!a) return null; const set = new Set(); for (const part of a.slice(11).split(',')) { const [lo, hi] = part.split('-').map(Number); for (let k = lo; k <= (Number.isFinite(hi) ? hi : lo); k++) set.add(k); } return set; })();
const take = () => { const k = _section++; const mine = (!SHARD || k % SHARD.n === SHARD.i) && (!ONLY || ONLY.has(k)); if (mine) _ran++; return mine; };
if (SHARD) console.log(`micro-smoke2 shard ${SHARD.i + 1} of ${SHARD.n}`);
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

if (take()) {
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
    const pe = (o) => ({ ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true });   // the plot listens for pointer events (a finger drags it too)
    cv2.dispatchEvent(new PointerEvent('pointerdown', pe({ ...at(0.3), button: 0 })));
    cv2.dispatchEvent(new PointerEvent('pointermove', pe(at(0.7))));
    cv2.dispatchEvent(new PointerEvent('pointerup', pe(at(0.7))));
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
}

// ═══ 7. bookmarks (viewpoint) + scenes (full working state) round-trip as files
//     in bookmarks/ + scenes/ across a project reopen ═══
if (take()) {
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
if (take()) {
  const pd = await mkPage('sm2demo');
  await pd.click('#sampleDemo');
  // the demo builds a 1.8M-block model: ~7 s on a desktop, ~50 s at 6× CPU
  // throttling, and longer on CI's 2-core software-GL runner (it timed out at
  // 120 s there twice while still progressing — smoke-wait.mjs scales this ×3 on CI). On a timeout, say where it stood.
  await pd.waitForFunction(() => window._micro.layers().length >= 2
    && window._micro.views().length >= 1
    && [...document.querySelectorAll('.fwin')].some((w) => /grade.tonnage/i.test(w.textContent)), null, { timeout: 120000 })
    .catch(async (e) => {
      console.log('demo stalled at:', await pd.evaluate(() => JSON.stringify({ meta: document.querySelector('#meta').textContent, layers: window._micro.layers().length, views: window._micro.views().length, windows: [...document.querySelectorAll('.fwin')].map((w) => w.textContent.slice(0, 60)) })));
      throw e;
    });
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
  const drag = await pf.evaluate(async (h0) => {
    const sl = document.querySelector('#fdrawer input[type="range"]');
    sl.value = 60; sl.dispatchEvent(new Event('input', { bubbles: true }));
    // the re-filter is a scan: wait for the count to move, not for a fixed time (400 ms was too short with 8 suites running at once)
    const count = () => { const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++; return h; };
    for (let i = 0; i < 100 && count() === h0; i++) await new Promise((r) => setTimeout(r, 100));
    return { text: document.querySelector('#filter').value, h: count() };
  }, hits0);
  chk(`slider drag rewrites the literal SURGICALLY + re-filters live ("${drag.text}" → ${drag.h} hits)`,
    /^FE > (59|60|61)[0-9.]* and LITO = "HEMATITE"$/.test(drag.text) && drag.h > 0 && drag.h < hits0);
  const chip = await pf.evaluate(async () => {
    const other = [...document.querySelectorAll('#fdrawer .fd-chip')].find((c) => !c.classList.contains('on'));
    const v = other.textContent; other.click();
    await new Promise((r) => setTimeout(r, 300));
    return { v, text: document.querySelector('#filter').value };
  });
  chk(`chip click swaps the category literal (→ "${chip.v}")`, chip.text.includes('LITO = "' + chip.v + '"'));
  const rst = await pf.evaluate(async (h0) => {
    [...document.querySelectorAll('#fdrawer .fd-head button')].find((b) => b.textContent === 'reset').click();
    // same: wait for the re-filter to land on the snapshot's count, for up to 10 s
    const count = () => { const L = window._micro.layers()[0]; let h = 0; for (const m of L._filterMask) if (m) h++; return h; };
    for (let i = 0; i < 100 && count() !== h0; i++) await new Promise((r) => setTimeout(r, 100));
    return { text: document.querySelector('#filter').value, h: count() };
  }, hits0);
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
if (take()) {
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
    // the re-filter is a scan: wait for the count to move, not for a fixed time (500 ms was too short with 8 suites running at once)
    for (let i = 0; i < 100 && count() === h0; i++) await new Promise((r) => setTimeout(r, 100));
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    window._micro._recipesList().push({ name: 'gt std', tool: 'gt', params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: 'FE' }], cutoffs: [30, 40, 50, 60] } });
    await window._micro.runRoutine({ name: 'month', tool: 'routine', params: { output: { dir: 'monthly' },
      steps: [{ each: { grade: ['FE'] }, steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$grade' }] }] }],
    } });
    const meta1 = document.querySelector('#meta').textContent;
    await window._micro.runRoutine({ name: 'month', tool: 'routine', params: { output: { dir: 'monthly' },
      steps: [{ guard: 'no-overwrites' }, { each: { grade: ['FE'] }, steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$grade' }] }] }],
    } });
    const meta2 = document.querySelector('#meta').textContent;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    const rep = await dir.getDirectoryHandle('monthly');
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
      steps: [{ each: [{ g: 'FE' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }], cutoffs: [30, 40, 50], as: 'inline' }] }],
    } });
    const meta = document.querySelector('#meta').textContent;
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2routine');
    let rep = null; for await (const [k, h] of (await dir.getDirectoryHandle('runs')).entries()) if (k.endsWith(' scratch')) rep = h;
    const names = []; for await (const k of rep.keys()) if (k !== 'run.json') names.push(k);
    window._micro._recipesList().push({ name: 'ask-routine', tool: 'routine', file: 'recipes/ar.yaml',
      inputs: [{ name: 'g2', type: 'column' }],
      params: { steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g2' }], cutoffs: [30, 40, 50] }] } });
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
      { each: [{ g: 'FE' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }], cutoffs: [30, 40, 50] }] },
    ] } });
    const el = document.querySelector('.fwin[data-routine-run]');
    const oks = el ? el.querySelectorAll('.rw-state.ok').length : 0;
    const summary = el ? [...el.querySelectorAll('.lbl')].map((x) => x.textContent).join(' ') : '';
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    window._micro.openRoutineWindow({ name: 'trk', tool: 'routine', file: 'recipes/trk.yaml', params: { steps: [
      { each: [{ g: 'FE' }, { g: 'SG' }], steps: [{ tool: 'gt', series: [{ layer: 'm.csv', col: '$g' }], cutoffs: [30, 40, 50] }] },
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    window._micro._recipesList().push({ name: 'gt std', tool: 'gt', params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: 'FE' }], cutoffs: [45, 50, 55] } });
    await window._micro.runRoutine({ name: 'resumed', tool: 'routine', params: { output: { prefix: 'z-' }, steps: [
      { each: [{ g: 'FE', run: 1 }, { g: 'FE', run: 2 }], steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$g' }] }] },
    ] } }, { from: 1 });
    const el = document.querySelector('.fwin[data-routine-run]');
    const icons = [...el.querySelectorAll('.rw-state')].map((x) => x.textContent).join('');
    const meta = document.querySelector('#meta').textContent;
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // two IDENTICAL rows would write one report twice: refused before anything runs
    await window._micro.runRoutine({ name: 'twins', tool: 'routine', params: { output: { prefix: 'tw-' }, steps: [
      { each: [{ g: 'FE' }, { g: 'FE' }], steps: [{ recipe: 'gt std', series: [{ layer: 'm.csv', col: '$g' }] }] },
    ] } });
    const twins = document.querySelector('#meta').textContent, twinRan = !!document.querySelector('.fwin[data-routine-run]');
    return { icons, meta, twins, twinRan };
  });
  chk(`two identical each rows writing one report are refused up front ("${r3.twins}")`, /same report/.test(r3.twins) && !r3.twinRan);
  chk(`resume from a step: the tracker marks the skipped ones (${r3.icons}) and the summary is honest ("${r3.meta.split('—')[1] || ''}".trim())`,
    r3.icons === '–✓' && /1 step run \(1 skipped\)/.test(r3.meta));
  await p3.close();
}

// ── §30: groups as sugar on naming — "swaths/FE drift" files the layer ──
if (take()) {
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
if (take()) {
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
if (take()) {
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

// ── §33: the plain-language bar — the SAFETY properties ──
// Its accuracy is scored in test/micro-nl.test.mjs; these three are not negotiable:
//   (a) it is ON by default (it passed that gate) yet LAZY — nothing trains, nothing is
//       proposed, until the bar is actually used
//   (b) it PROPOSES, it never ACTS — nothing happens until you read it and press Enter
//   (c) nonsense is refused, not guessed at
if (take()) {
  const nl = await mkPage('sm2nl');
  const r = await nl.evaluate(async () => {
    let t = 'XC,YC,ZC,FE,LITO\n';
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
      t += `${5 + i * 10},${5 + j * 10},${1000 + k * 10},${40 + ((i + j + k) % 30)},${(i + j) % 3 === 0 ? 'HEMATITE' : (i + j) % 3 === 1 ? 'ITABIRITE' : 'WASTE'}\n`;
    await window._micro.openBlob(new Blob([t]), 'deposit.csv', 'replace');
    await new Promise((z) => setTimeout(z, 1200));

    const offByDefault = { stored: localStorage.getItem('micro.nl'), proposes: !!window._micro.nlPropose('colour the model by FE'), trained: window._micro.nlStats() != null };

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
  chk(`NL bar: on by default but lazy — nothing stored, nothing trained or proposed before use (stored=${r.offByDefault.stored})`,
    r.offByDefault.stored === null && r.offByDefault.proposes === false && r.offByDefault.trained === false);
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
if (take()) {
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
    setw.title === 'settings' && setw.sections === 5 && setw.stored === 'sticky');   // 'experimental' emptied when the plain-language bar graduated (d97eceb9)

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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    await M.applyCalcCols(L, [
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
if (take()) {
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
if (take()) {
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
    await M.applyCalcCols(L, [{ name: 'EST', expr: 'FE * 2' }]);
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
  // the saved filter (DOMAIN == 200) comes back with it: this model is on a lattice (constant
  // sizes, no DD lattice — found from the centroids), so the filter draws its 16 blocks
  await pq2.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) === 16, null, { timeout: 60000 });
  const re2 = await pq2.evaluate(() => { const h = window._micro.layers()[0].docs.blockDoc.header; return { cat: h.columns[h.mapping.cat], cats: h.categories }; });
  chk(`the re-keyed category PERSISTS across save/reload (${re2.cat}: ${(re2.cats || []).join('/')})`, re2.cat === 'DOMAIN' && ['100', '200', '300'].every((v) => (re2.cats || []).includes(v)));
  await pq2.close();
}

// ── §37: the stats FAST PATH — after a filter scan pins the columns, the stats
//     window accumulates over pinned 256K windows (censusChunkCols) instead of
//     decoding rows. The guard is a PARITY check: pinned rows == row-path rows
//     (pins dropped via setPinBudget('off')), with __statsFast proving the fast
//     path actually ran (non-vacuous). ──
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
  const ctx2 = await b.newContext({ viewport: { width: 1100, height: 750 } });   // no init script: the question is unanswered here
  await ctx2.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    // the project object is set BEFORE its layers load, so wait for the layer too
    for (let n = 0; n < 400 && !(M.project() && M.project().pack && M.layers().length); n++) await new Promise((z) => setTimeout(z, 50));
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    // …the same race made DETERMINISTIC (it flaked under load): the superseded filter's
    // builder worker answers 'ready' 400 ms late, so the newer filter finishes first and
    // the dead one sweeps after it. It used to hit the compaction cap then and clear the
    // layer's compact set — handing it back to the base set: the whole model drawn.
    {
      const RealW = window.Worker, desc = Object.getOwnPropertyDescriptor(RealW.prototype, 'onmessage');
      let slow = 1;
      window.Worker = class extends RealW {
        constructor(...a) {
          super(...a);
          if (slow-- > 0) Object.defineProperty(this, 'onmessage', { configurable: true, get() { return desc.get.call(this); },
            set(fn) { desc.set.call(this, fn && ((ev) => (ev.data && ev.data.type === 'ready' ? setTimeout(() => fn.call(this, ev), 400) : fn.call(this, ev)))); } });
        }
      };
      try {
        const q1 = M.applyBlockFilter('AU > 0.5', L);
        const q2 = M.applyBlockFilter('AU > 3.6', L);
        await Promise.all([q1, q2]);
        await new Promise((z2) => setTimeout(z2, 800));
      } finally { window.Worker = RealW; }
      b.late = { drawn: M.renderer.layerElementCount(L.id), want: count((v) => v > 3.6), slowUsed: slow < 0 };
    }
    // …and a superseded filter closes its builder WORKER on every way out (its sweep returns
    // early when superseded — those returns used to leave the worker running, one per race)
    {
      const RealW = window.Worker, live = new Set(), liveAt = [];
      let made = 0;
      window.Worker = class extends RealW {
        constructor(...a) {
          super(...a);
          const pm = this.postMessage.bind(this), tm = this.terminate.bind(this);
          this.postMessage = (d, t) => { if (d && d.type === 'init' && d.o && 'chunkSize' in d.o) { live.add(this); made++; } return pm(d, t); };
          this.terminate = () => { live.delete(this); return tm(); };
        }
      };
      // DETERMINISTIC: the newer filter arrives at the older one's first yield AFTER its builder is
      // registered — its sweep's last window (every match already collected), so the older one
      // finds itself superseded only on a `return` path. A typo as the newer filter returns before
      // it would close the layer's builder itself, so nothing else would.
      const RealST = window.setTimeout;
      try {
        for (let k = 0; k < 3; k++) {
          window.__compactOffPage = null;
          let q2 = null;
          window.setTimeout = function (fn, ms, ...a) {
            if (!q2 && window.__compactOffPage != null && !ms) q2 = M.applyBlockFilter(k === 1 ? 'AU >' : 'AU > 3.7', L);
            return RealST.call(window, fn, ms, ...a);
          };
          const q1 = M.applyBlockFilter('AU > 2.5', L);      // under the compaction cap (half the model): its builder runs to the end
          await q1; window.setTimeout = RealST;
          await q2;
          await new Promise((z2) => RealST(z2, 200));
          liveAt.push(live.size + (q2 ? 0 : 100));         // after each race: nothing of either filter left running (100: the race never happened)
        }
      } finally { window.Worker = RealW; window.setTimeout = RealST; }
      b.leak = { live: Math.max(...liveAt), at: liveAt.join(','), made, drawn: M.renderer.layerElementCount(L.id), want: count((v) => v > 3.7) };
    }
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
    const buildP = async (workers, total = 0) => {
      const Wk = window.Worker; if (!workers) window.Worker = undefined;
      const got = [];
      const cb = await M.startChunkBuilder({ frame, grid, chunkSize: 4096, batchSize: 16384, seed: 1, seedPerBatch: true, workers: workers || 1, total, onChunk: (c) => got.push(c) });
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
    // the open's TAIL cut smaller (total known): page / 1 worker / 3 workers still the same bytes
    par.tail = { page: await buildP(0, 100000), one: await buildP(1, 100000), three: await buildP(3, 100000) };
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
  chk(`…nor does a superseded filter whose builder would start LATE (a worker delayed 400 ms; reached: ${cp.b.late.slowUsed} — a dead filter now stops before starting one) clear the newer one's set: ${cp.b.late.drawn} drawn = ${cp.b.late.want}`, cp.b.late.drawn === cp.b.late.want);
  chk(`…and every superseded filter's builder worker is closed (${cp.b.leak.made} started over three races, still running after each: ${cp.b.leak.at}; ${cp.b.leak.drawn} drawn = ${cp.b.leak.want})`,
    cp.b.leak.made >= 3 && cp.b.leak.live === 0 && cp.b.leak.drawn === cp.b.leak.want);
  chk(`the builder off the page is byte-identical to on it (${cp.off.n} chunks, offPage ${cp.off.off} vs ${cp.on.off}, same: ${cp.off.sig === cp.on.sig}); closed mid-stream → ${cp.lateAfterClose} late chunks delivered`,
    cp.off.off === true && cp.on.off === false && cp.off.n > 10 && cp.off.sig === cp.on.sig && cp.lateAfterClose === 0);
  chk(`…and with the stream's total known (its last batches cut into 8 pieces — a shorter open tail): page / 1 / 3 workers still identical (${cp.par.tail.page.n} chunks vs ${cp.par.page.n}, hash ${cp.par.tail.page.h.toString(16)} · ${cp.par.tail.one.h.toString(16)} · ${cp.par.tail.three.h.toString(16)})`,
    cp.par.tail.page.h === cp.par.tail.one.h && cp.par.tail.one.h === cp.par.tail.three.h && cp.par.tail.page.count === 100000 && cp.par.tail.page.n > cp.par.page.n);
  chk(`parallel builders, a batch each: page / 1 worker / ${cp.par.three.w} workers draw the same bytes in the same order (${cp.par.three.n} chunks, ${cp.par.three.count} blocks, hash ${cp.par.page.h.toString(16)} · ${cp.par.one.h.toString(16)} · ${cp.par.three.h.toString(16)})`,
    cp.par.three.w === 3 && cp.par.page.w === 0 && cp.par.page.n > 10 && cp.par.page.h === cp.par.one.h && cp.par.one.h === cp.par.three.h && cp.par.three.count === 100000 && cp.par.page.count === 100000);
  chk(`the pin tee only runs when it fits: 1 MB budget → ${cp.pinnedSmall} pinned; 256 MB → ${cp.pinnedBig}`, cp.pinnedSmall === 0 && cp.pinnedBig > 0);
  await pq3.close();
}

// ── §54: colour by a column the chunks don't carry = a per-record VALUE TEXTURE
//     (src/valuetex.js): no re-read, the picture the re-stream would draw, the range
//     the column's, blanks at the low end; the same on CSV (its line index's runs,
//     in the renderer's numbering). ──
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
if (take()) {
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
    await M.applyCalcCols(L, [{ name: 'EST', expr: 'FE * 2' }]);
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
if (take()) {
  const mkLayer = async (pg, withCol) => pg.evaluate(async (wc) => {
    const M = window._micro;
    let s = 'X,Y,Z,AU\n'; for (let i = 0; i < 27; i++) s += `${(i % 3) * 10},${((i / 3 | 0) % 3) * 10},${(i / 9 | 0) * 10},${i}\n`;
    const id = await M.openBlob(new File([s], 'rc.csv'), 'rc.csv', 'replace');
    if (wc) await M.applyCalcCols(M.layers().find((q) => q.id === id), [{ name: 'AU2', expr: 'AU * 2' }]);
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
if (take()) {
  const pc = await mkPage('sm2cancel');
  const r = await pc.evaluate(async () => {
    const M = window._micro, b = document.querySelector('#metaCancel');
    let s = 'X,Y,Z,AU\n'; for (let i = 0; i < 20000; i++) s += `${(i % 40) * 10},${((i / 40 | 0) % 25) * 10},${(i / 1000 | 0) * 10},${i % 97}\n`;
    const id = await M.openBlob(new File([s], 'cx.csv'), 'cx.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    const clickWhileRunning = async (start) => {
      // click the moment the button shows: a MutationObserver fires as a microtask at the
      // job's first await after unhiding it, where polling on timers could miss a fast job
      let seen = false;
      const mo = new MutationObserver(() => { if (!seen && !b.hidden) { seen = true; b.click(); } });
      mo.observe(b, { attributes: true, attributeFilter: ['hidden'] });
      const p = start();
      const ret = await p;
      mo.disconnect();
      return { seen, ret, meta: document.querySelector('#meta').textContent, hiddenAfter: b.hidden };
    };
    window._lastExport = null;
    const ex = await clickWhileRunning(() => M.runExport(L, { format: 'parquet', download: false, filename: 'c.parquet' }));
    ex.wrote = !!window._lastExport;
    const op = await clickWhileRunning(() => M.convertLayerToParquet(L, { keepOriginal: true }));
    op.stillCsv = !L.docs.blockDoc.parquet && L.name === 'cx.csv';
    const full = await M.runExport(L, { format: 'csv', download: false, filename: 'd.csv' });   // and an uninterrupted one still completes
    // a cancel that arrives AFTER the last per-batch check (while the row stream
    // reads past its end) — deterministic, where the click above is a race: a
    // signal that is clean for the first check and aborted from then on
    let n = 0; window._lastExport = null;
    const lateRet = await M.runExport(L, { format: 'parquet', download: false, filename: 'e.parquet', signal: { get aborted() { return ++n > 1; } } });
    const late = { ret: lateRet, wrote: !!window._lastExport };
    return { ex, op, full, late, hidden: b.hidden };
  });
  await pc.close();
  chk(`export cancels mid-way: the button showed (${r.ex.seen}), nothing written (${!r.ex.wrote}), “${r.ex.meta}”, hidden after (${r.ex.hiddenAfter})`, r.ex.seen && !r.ex.wrote && r.ex.ret === -1 && /cancelled/.test(r.ex.meta) && r.ex.hiddenAfter);
  chk(`optimize cancels mid-way: the layer is unchanged (${r.op.stillCsv}), “${r.op.meta}”`, r.op.seen && r.op.stillCsv && /cancelled/.test(r.op.meta) && r.op.hiddenAfter);
  chk(`an uninterrupted export still completes (${r.full} rows), the button hidden (${r.hidden})`, r.full === 20000 && r.hidden);
  chk(`a cancel after the last batch check still writes nothing (returned ${r.late.ret}, wrote ${r.late.wrote})`, r.late.ret === -1 && !r.late.wrote);
}

// ── §65: A DECIMAL COMMA CSV (';' between fields, 1,5 in them) opens as numbers:
//     the lattice from its coordinates, a filter over its grades on the workers
//     (the delimited source normalizes the same way) and on the row path, equal
//     to brute force; and through a project save + reopen (the sidecar keeps it). ──
if (take()) {
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
if (take()) {
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
    await M.applyCalcCols(L, [{ name: 'AU2', expr: 'AU * 2' }]);
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
if (take()) {
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
if (take()) {
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
    // a BLANK density is volume, not tonnes — the form, the measure and the result all say so
    // (a real user read the m³ as tonnes, 2026-11-14)
    const dIn = [...h.win.el.querySelectorAll('.sw-row')].find((r) => r.firstChild.textContent === 'density').querySelector('input');
    const mSel = [...h.win.el.querySelectorAll('.sw-row')].find((r) => r.firstChild.textContent === 'measure').querySelector('select');
    const note = () => (h.win.el.querySelector('.xt-nodens:not(.xt-nodens-res)') || {}).textContent || '';
    const res = () => !!h.win.el.querySelector('.xt-nodens-res');
    out.densBefore = { opt: mSel.options[0].textContent, note: note(), res: res() };
    dIn.value = ''; dIn.dispatchEvent(new Event('input')); dIn.dispatchEvent(new Event('change'));
    out.densBlankForm = { opt: mSel.options[0].textContent, note: note() };
    h.st.measure = 'tonnage'; await h.run();
    out.densBlankRes = { res: res(), head: h.win.el._xtab ? h.tableTSV().split(String.fromCharCode(10))[0] : '' };
    dIn.value = 'SG'; dIn.dispatchEvent(new Event('input')); dIn.dispatchEvent(new Event('change')); await h.run();
    out.densBack = { opt: mSel.options[0].textContent, note: note(), res: res() };
    return out;
  });
  await px.close();
  chk(`xtab: ROCK × AU bins (${r.cols}) · rows ${r.rows} — every cell the brute force (tonnage, grade, metal, count), ${r.where}${r.bad.length ? " — " + r.bad.slice(0, 3).join('; ') : ''}`, r.bad.length === 0 && r.cols === '< 1 | 1–2 | ≥ 2 | no grade | total' && r.rows === 'fr | ox | tr | total');
  chk(`xtab: the row path agrees (${r.wherePage})${r.badPage.length ? " — " + r.badPage.slice(0, 3).join('; ') : ''}`, r.badPage.length === 0 && r.wherePage === 'on this page' && r.where !== r.wherePage);
  chk(`xtab: cumulative (${r.cumCols}) · selection scope (${r.badSel.length} bad) · flip heads ${r.flipHead}`, r.cumOk && r.cumCols === '≥ 1 | ≥ 2 | all graded | no grade | total' && r.badSel.length === 0 && /^AU \\ ROCK \| fr \| ox \| tr \| total$/.test(r.flipHead));
  chk(`xtab: a blank density says VOLUME — measure "${r.densBlankForm.opt}", note "${r.densBlankForm.note}", result warned ${r.densBlankRes.res} (${r.densBlankRes.head.split(String.fromCharCode(9))[2]}) · with SG back: "${r.densBack.opt}", no warnings`,
    r.densBefore.opt === 'tonnage' && !r.densBefore.note && !r.densBefore.res && r.densBlankForm.opt === 'volume (no density)' && /m³, not tonnes/.test(r.densBlankForm.note) && r.densBlankRes.res && r.densBlankRes.head.includes('volume (m³)') && r.densBack.opt === 'tonnage' && !r.densBack.note && !r.densBack.res);
  chk(`xtab: the TSV is long form, every measure (${r.tsv.length - 1} rows: ${r.tsv[0]}) · cutoffs parse ${r.cut}`, r.tsv.length - 1 === 4 * 5 && /^ROCK\tAU bin\ttonnage \(t\)\tgrade \(g\/t\)\tmetal \(t\)\tblocks$/.test(r.tsv[0]) && r.cut === '0.5 1 2 / 0.5 1 2 / 1 3');
}

// ── a ROTATED Datamine model (ANGLEn about ROTAXISn). ONE rotation about Z is
//     placed in world (the convention verified on a real Isatis.neo export) and the
//     status line says how; TWO rotations are not converted (their order convention
//     is unverified), so micro must SAY so — the status line, the layer's one-line
//     description and its Properties — instead of placing the blocks plausibly
//     wrong. An unrotated model with all-zero ANGLE fields says nothing. ──
if (take()) {
  const pr = await mkPage('sm2dmrot');
  const r = await pr.evaluate(async () => {
    const { makeDM } = await import('/test/dm-make.mjs');
    const M = window._micro;
    const fields = (angle, angle2 = 0) => [
      { name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' },
      { name: 'XINC', type: 'N', constant: 10 }, { name: 'YINC', type: 'N', constant: 10 }, { name: 'ZINC', type: 'N', constant: 5 },
      { name: 'XMORIG', type: 'N', constant: 1000 }, { name: 'YMORIG', type: 'N', constant: 2000 }, { name: 'ZMORIG', type: 'N', constant: 400 },
      { name: 'NX', type: 'N', constant: 4 }, { name: 'NY', type: 'N', constant: 3 }, { name: 'NZ', type: 'N', constant: 2 },
      { name: 'ROTAXIS1', type: 'N', constant: 3 }, { name: 'ANGLE1', type: 'N', constant: angle },
      { name: 'ROTAXIS2', type: 'N', constant: 1 }, { name: 'ANGLE2', type: 'N', constant: angle2 },
      { name: 'FE', type: 'N' },
    ];
    const rows = [];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) rows.push({ XC: 1005 + i * 10, YC: 2005 + j * 10, ZC: 402.5 + k * 5, FE: 20 + i });
    const out = {};
    // one rotation about Z: applied — block (0,0,0)'s world centroid = R·(1005, 2005, 402.5) (X0/Y0/Z0 absent = 0)
    const idZ = await M.openBlob(new Blob([makeDM(fields(35), rows, { precision: 'ep' })]), 'rotz.dm', 'replace');
    const LZ = M.layers().find((q) => q.id === idZ), hZ = LZ.docs.blockDoc.header;
    out.z = { meta: document.querySelector('#meta').textContent, kind: M.propKindLine(LZ), rot: !!(hZ.grid && hZ.grid.rot), applied: hZ.dmRotationApplied, p0: await M.recordPosition({ layer: idZ, rec: 0 }) };
    const id = await M.openBlob(new Blob([makeDM(fields(35, 10), rows, { precision: 'ep' })]), 'rot.dm', 'replace');
    const L = M.layers().find((q) => q.id === id);
    out.meta = document.querySelector('#meta').textContent;
    out.kind = M.propKindLine(L);
    M.setActiveLayer(L.id); M.openProps();
    await new Promise((z) => setTimeout(z, 300));
    const tabs = [...document.querySelectorAll('#propPanel .pp-tab')];
    let banner = '';
    for (const t of tabs) { t.click(); await new Promise((z) => setTimeout(z, 100)); const b = document.querySelector('#propPanel .pp-banner.bad'); if (b && /rotated Datamine/.test(b.textContent)) { banner = b.textContent; break; } }
    out.banner = banner;
    const id2 = await M.openBlob(new Blob([makeDM(fields(0), rows, { precision: 'ep' })]), 'flat.dm', 'replace');
    out.flatMeta = document.querySelector('#meta').textContent;
    out.flatKind = M.propKindLine(M.layers().find((q) => q.id === id2));
    return out;
  });
  await pr.close();
  const t = (-35 * Math.PI) / 180, want0 = [Math.cos(t) * 1005 - Math.sin(t) * 2005, Math.sin(t) * 1005 + Math.cos(t) * 2005, 402.5];
  chk(`dm rotated about Z: APPLIED — rotated boxes, block 0 at ${(r.z.p0 || []).map((v) => +v.toFixed(3)).join(', ')} (= R·local), the status line says how, no warning`,
    r.z.applied && r.z.rot && r.z.p0 && r.z.p0.every((v, a) => Math.abs(v - want0[a]) < 1e-6) && /rotated 35° about Z \(Datamine ANGLE1\) into world/.test(r.z.meta) && !/ROTATED/.test(r.z.meta) && !/shown unrotated/.test(r.z.kind));
  chk(`dm rotated twice: the status line says so (${r.meta.includes('ROTATED Datamine model (35° about Z, then 10° about X)')}), the layer line (${r.kind}), Properties (${r.banner ? 'banner' : 'NO banner'}) · an all-zero ANGLE says nothing`,
    r.meta.includes('ROTATED Datamine model (35° about Z, then 10° about X)') && r.meta.includes('volumes, grades and tonnages are right') && r.kind.includes('rotated .dm, shown unrotated')
    && /35° about Z/.test(r.banner) && !/ROTATED/.test(r.flatMeta) && !/rotated/.test(r.flatKind));
}

// ── §69: SCATTER + Q-Q (src/xyplot.js). Scatter: a filtered subset draws every
//     pair (r = the brute force); the whole 30,000 blocks draw as a density whose
//     cells add up to n, the row path giving the same grid; log axes count the
//     zeros off. Q-Q: a column against its own subset — the quantiles the exact
//     ones within the digest's error — and a drillhole layer as a side. ──
if (take()) {
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
if (take()) {
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
if (take()) {
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

// ── §72: the 2026-11 correctness audit — stored state that could land on the
//     WRONG records, or nowhere, with nothing said:
//     (a) a stored column EVICTED by the pin budget, then the model optimized to
//         Parquet (reordered + renamed): its values must be permuted with the rows
//     (b) a selection saved on one version of a file is refused on a reopen over
//         an edited file (and kept on a reopen over the same file)
//     (c) two layers on ONE file keep their own stored columns (same name)
//     (d) auto-pack to .wfr skips a strings layer that carries a selection
//         (.wfr renumbers line records) ──
if (take()) {
  const csvOf = (rows) => 'X,Y,Z,ID\n' + rows.map((i) => `${(i % 4) * 10},${((i / 4 | 0) % 4) * 10},${(i / 16 | 0) * 10},${i}`).join('\n') + '\n';
  const keyOf = (f) => 'ID,V\n' + Array.from({ length: 64 }, (_, i) => `${i},${i * f}`).join('\n') + '\n';
  // (a)
  const pa = await mkPage('sm2evopt');
  const a = await pa.evaluate(async ({ csv, key }) => {
    const M = window._micro;
    const id = await M.openBlob(new File([csv], 'ev.csv'), 'ev.csv', 'replace');
    const kid = await M.openBlob(new File([key], 'evk.csv'), 'evk.csv', 'add');
    const L = M.layers().find((q) => q.id === id);
    await M.keyJoinToCols(L, M.layers().find((q) => q.id === kid), { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });
    // evicted, as the pin LRU leaves it (values dropped, codes kept). Done by
    // hand: whether a tiny budget evicts depends on the machine's 'auto' budget
    const vc = L.paintCols.find((c) => c.name === 'V');
    vc.fvalues = null;
    const evicted = vc.fvalues === null;
    await M.convertLayerToParquet(L, { keepOriginal: true });
    const h = L.docs.blockDoc.header, idI = h.columns.indexOf('ID');
    const v = L.paintCols.find((c) => c.name === 'V');
    let right = 0, moved = 0;
    for (let r = 0; r < 64; r++) {
      const row = await M.fetchLayerRow(L, r), rid = +row[idI];
      if (rid !== r) moved++;
      if (v && v.fvalues && v.fvalues[r] === rid * 3) right++;
    }
    return { evicted, right, moved, name: L.name };
  }, { csv: csvOf([...Array(64).keys()]), key: keyOf(3) });
  await pa.close();
  chk(`audit #3: an evicted stored column survives optimize — ${a.right}/64 values on their own rows (${a.moved} rows moved, evicted first: ${a.evicted}, now ${a.name})`, a.evicted && a.moved > 0 && a.right === 64);

  // (b)
  const pb = await mkPage('sm2selid');
  await pb.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2selid', { recursive: true }); } catch { } });
  await pb.evaluate(async (csv) => {
    const M = window._micro;
    const id = await M.openBlob(new File([csv], 'si.csv'), 'si.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    L._selMask = new Uint8Array(64); L._selMask[5] = 1; L._selCount = 1;
  }, csvOf([...Array(64).keys()]));
  await saveProject(pb);
  await pb.close();
  const reopen = async (proj) => {
    const p = await mkPage(proj);
    const r = await p.evaluate(async (pr) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(pr);
      const op = window._micro.openProjectDir(dir);
      let msg = '';
      for (let n = 0; n < 300; n++) {
        if (document.querySelector('#pmDlg').classList.contains('show')) { msg = document.querySelector('#pmMsg').textContent; document.querySelector('#pmOk').click(); }
        if (window._micro.layers().length && /project|opened|loaded/.test(document.querySelector('#meta').textContent) && !document.querySelector('#pmDlg').classList.contains('show')) { await op; break; }
        await new Promise((z) => setTimeout(z, 50));
      }
      await op;
      return { msg, layers: window._micro.layers().map((L) => ({ name: L.name, sel: L._selMask ? L._selMask.reduce((s, v) => s + v, 0) : 0 })) };
    }, proj);
    return { p, r };
  };
  const same = await reopen('sm2selid');
  await same.p.close();
  await (await mkPage('sm2selid')).evaluate(async (csv) => {   // the file edited on disk: same rows, re-sorted
    const models = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2selid')).getDirectoryHandle('models');
    const w = await (await models.getFileHandle('si.csv')).createWritable(); await w.write(csv); await w.close();
  }, csvOf([...Array(64).keys()].reverse()));
  const edited = await reopen('sm2selid');
  await edited.p.close();
  chk(`audit #5: a selection reopens over the same file (${same.r.layers[0] && same.r.layers[0].sel} record)`, same.r.layers[0] && same.r.layers[0].sel === 1);
  chk(`audit #5: …and is REFUSED over an edited file, said so (“${edited.r.msg.slice(0, 90)}”)`, edited.r.layers[0] && edited.r.layers[0].sel === 0 && /selection/.test(edited.r.msg));

  // (c)
  const pc = await mkPage('sm2twin');
  await pc.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2twin', { recursive: true }); } catch { } });
  await pc.evaluate(async ({ csv, k3, k5 }) => {
    const M = window._micro;
    const a1 = await M.openBlob(new File([csv], 'tw.csv'), 'tw.csv', 'replace');
    const a2 = await M.openBlob(new File([csv], 'tw.csv'), 'tw.csv', 'add');
    const kA = await M.openBlob(new File([k3], 'k3.csv'), 'k3.csv', 'add');
    const kB = await M.openBlob(new File([k5], 'k5.csv'), 'k5.csv', 'add');
    const by = (i) => M.layers().find((q) => q.id === i);
    await M.keyJoinToCols(by(a1), by(kA), { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });
    await M.keyJoinToCols(by(a2), by(kB), { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });
  }, { csv: csvOf([...Array(64).keys()]), k3: keyOf(3), k5: keyOf(5) });
  await saveProject(pc);
  await pc.close();
  const tw = await reopen('sm2twin');
  const twin = await tw.p.evaluate(async () => {
    const M = window._micro, out = [];
    for (const L of M.layers().filter((q) => q.name === 'tw.csv')) {
      const v = L.paintCols && L.paintCols.find((c) => c.name === 'V');
      out.push(v && v.fvalues ? v.fvalues[7] / 7 : null);
    }
    return out;
  });
  await tw.p.close();
  chk(`audit #4: two layers on one file keep their own stored column V (×${twin.join(', ×')})`, twin.length === 2 && twin[0] === 3 && twin[1] === 5);

  // (d)
  const pd = await mkPage('sm2packsel');
  await pd.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2packsel', { recursive: true }); } catch { } });
  await pd.evaluate(async () => {
    const nl = String.fromCharCode(10);
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    for (let i = 0; i < 3; i++) L.push('0', '3DFACE', '8', 'TOPO', '10', String(500000 + i * 10), '20', '6000000', '30', '100', '11', String(500010 + i * 10), '21', '6000000', '31', '101',
      '12', String(500010 + i * 10), '22', '6000010', '32', '102', '13', String(500000 + i * 10), '23', '6000010', '33', '101');
    for (let s = 0; s < 3; s++) {
      L.push('0', 'POLYLINE', '8', 'CREST', '70', '8');
      for (let k = 0; k < 4; k++) L.push('0', 'VERTEX', '8', 'CREST', '70', '32', '10', String(500000 + k * 8 + s * 50), '20', String(6000005 + s * 40), '30', '110');
      L.push('0', 'SEQEND');
    }
    L.push('0', 'ENDSEC', '0', 'EOF', '');
    await window._micro.openBlob(new File([L.join(nl)], 'pit.dxf'), 'pit.dxf', 'replace', null, { streamDxf: true });
  });
  await pd.waitForFunction(() => window._micro.layers().some((x) => x.docs.stringsDoc && x.docs.stringsDoc.header.kind === 'strings'), null, { timeout: 30000 });
  await pd.evaluate(() => {
    const M = window._micro, S = M.layers().find((x) => x.docs.stringsDoc && x.docs.stringsDoc.header.kind === 'strings');
    const n = M.attrRowCountOf(S); S._selMask = new Uint8Array(n); S._selMask[n - 1] = 1; S._selCount = 1;
    M.setAutoPack('on');
  });
  await saveProject(pd);
  const pk = await pd.evaluate(() => {
    const M = window._micro;
    const S = M.layers().find((x) => x.docs.stringsDoc && x.docs.stringsDoc.header.kind === 'strings');
    const mesh = M.layers().find((x) => x.kind === 'mesh');
    M.setAutoPack(null);
    return { strings: S && S.name, sel: S && S._selMask ? S._selMask[S._selMask.length - 1] : 0, mesh: mesh && mesh.name };
  });
  await pd.close();
  chk(`audit #2: a strings layer with a selection stays on its DXF (${pk.strings}, selection kept ${pk.sel}); the surface packs (${pk.mesh})`, pk.strings === 'pit.dxf' && pk.sel === 1 && /\.wfr$/.test(pk.mesh || ''));
}

// ── §73: the 2026-11 audit, second pass —
//     (a) Reload from disk over IDENTICAL bytes keeps per-record state; over
//         EDITED bytes it asks, then drops the painted/stored columns and the
//         selection (they were made record by record on the old file)
//     (b) a drag-dropped model optimized to Parquet, saved with "link", is
//         written INTO the project (there is no file on disk to link to) ──
if (take()) {
  const csvOf = (rows) => 'X,Y,Z,ID\n' + rows.map((i) => `${(i % 4) * 10},${((i / 4 | 0) % 4) * 10},${(i / 16 | 0) * 10},${i}`).join('\n') + '\n';
  const keyOf = (f) => 'ID,V\n' + Array.from({ length: 64 }, (_, i) => `${i},${i * f}`).join('\n') + '\n';
  // (a)
  const pa = await mkPage('sm2reload');
  await pa.evaluate(async ({ csv, key }) => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('sm2reload-src', { recursive: true }); } catch { }
    const dir = await root.getDirectoryHandle('sm2reload-src', { create: true });
    const fh = await dir.getFileHandle('rl.csv', { create: true });
    const w = await fh.createWritable(); await w.write(csv); await w.close();
    window.__rlHandle = fh;
    const M = window._micro;
    const id = await M.openBlob(await fh.getFile(), 'rl.csv', 'replace');
    const kid = await M.openBlob(new File([key], 'rlk.csv'), 'rlk.csv', 'add');
    const L = M.layers().find((q) => q.id === id);
    L.handle = fh;
    await M.keyJoinToCols(L, M.layers().find((q) => q.id === kid), { leftKey: 'ID', rightKey: 'ID', bring: ['V'], dup: 'first' });
    L._selMask = new Uint8Array(64); L._selMask[9] = 1; L._selCount = 1;
    window.__rlId = id;
  }, { csv: csvOf([...Array(64).keys()]), key: keyOf(3) });
  const state = () => pa.evaluate(() => {
    const L = window._micro.layers().find((q) => q.id === window.__rlId);
    const v = L && (L.paintCols || []).find((c) => c.name === 'V');
    return { v: !!v, v9: v && v.fvalues ? v.fvalues[9] : null, sel: L && L._selMask ? L._selMask.reduce((s, x) => s + x, 0) : 0, meta: document.querySelector('#meta').textContent };
  });
  await pa.evaluate(() => window._micro.reloadLayerFromDisk(window._micro.layers().find((q) => q.id === window.__rlId)));
  const same = await state();
  await pa.evaluate(async (csv) => { const w = await window.__rlHandle.createWritable(); await w.write(csv); await w.close(); }, csvOf([...Array(64).keys()].reverse()));
  pa.evaluate(() => { window.__rl = window._micro.reloadLayerFromDisk(window._micro.layers().find((q) => q.id === window.__rlId)); });
  await pa.waitForFunction(() => document.querySelector('#pmDlg').classList.contains('show'), null, { timeout: 30000 });
  const asked = await pa.evaluate(() => document.querySelector('#pmMsg').textContent);
  await pa.evaluate(async () => { [...document.querySelectorAll('#pmDlg button')].find((x) => /Reload and drop/.test(x.textContent)).click(); await window.__rl; });
  const edited = await state();
  await pa.close();
  chk(`audit #5b: reload over the same bytes keeps column V (${same.v9}) and the selection (${same.sel})`, same.v && same.v9 === 27 && same.sel === 1 && /unchanged/.test(same.meta));
  chk(`audit #5b: reload over edited bytes asks first (“${asked.slice(0, 80)}”)`, /column V/.test(asked) && /selection/.test(asked));
  chk(`audit #5b: …then drops the column and the selection and says so (${edited.meta})`, !edited.v && edited.sel === 0 && /dropped/.test(edited.meta));

  // (b)
  const pb = await mkPage('sm2optlink');
  await pb.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2optlink', { recursive: true }); } catch { } });
  await pb.evaluate(async (csv) => {
    const M = window._micro;
    M.setAutoOptimize('off');
    const id = await M.openBlob(new File([csv], 'dropped.csv'), 'dropped.csv', 'replace');   // drag-dropped: no handle
    await M.convertLayerToParquet(M.layers().find((q) => q.id === id), {});
  }, csvOf([...Array(64).keys()]));
  pb.evaluate(() => window._micro.saveProjectAs());
  await pb.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 30000 });
  await pb.evaluate(() => { if (document.querySelector('#svDlg').classList.contains('show')) document.querySelector('#svLink').click(); });   // "link" — the answer that used to name a file that never was
  await pb.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 120000 });
  const ob = await pb.evaluate(async () => {
    const L = window._micro.layers()[0];
    let onDisk = false;
    try { const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2optlink')).getDirectoryHandle('models'); await d.getFileHandle(L.name); onDisk = true; } catch { }
    return { name: L.name, storage: L.storage, onDisk };
  });
  await pb.close();
  chk(`audit #9: an optimized drag-dropped model is written into the project on save, even on "link" (${JSON.stringify(ob)})`, /\.parquet$/.test(ob.name) && ob.storage === 'project' && ob.onDisk);
}

// ── §74: renderer layer VIEWS (condenser) — one model drawn as two layers.
//     A view draws its source's chunks under its own layer state: it picks as
//     itself, filters on its own, follows a re-stream of its source, and going
//     away frees nothing of the source's. Driven on the raw renderer (micro's
//     view layers build on this). ──
if (take()) {
  const p = await mkPage('sm2views');
  const r = await p.evaluate(async () => {
    const M = window._micro, R = M.renderer, out = {};
    const rows = ['XC,YC,ZC,AU'];
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},105,${j * 10 + i}`);
    const id = await M.openBlob(new File([rows.join('\n') + '\n'], 'views.csv'), 'views.csv', 'replace');
    const L = M.layers().find((q) => q.id === id), V = 9001;
    const settle = () => new Promise((res) => { M.requestRender(); setTimeout(res, 400); });
    // a centroid (world) → CSS pixel, through the live camera (+ a display offset)
    const px = (rec, off = 0) => {
      const o = M.frame.origin, x = 1005 + (rec % 10) * 10 - o[0] + off, y = 2005 + Math.floor(rec / 10) * 10 - o[1], z = 105 - o[2];
      const m = M.cam.state.viewProj, w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      const cv = R.gl.canvas;
      return [(nx + 1) / 2 * cv.clientWidth, (1 - ny) / 2 * cv.clientHeight];
    };
    const pickAt = (rec, off = 0) => { const [x, y] = px(rec, off); const h = R.pick(x, y, M.cam); return h ? `${h.layer === V ? 'view' : h.layer === id ? 'model' : h.layer}:${h.rec}` : null; };
    const N = R.layerElementCount(id);
    R.setLayerViewOf(V, id);
    R.setLayerOffset(V, [150, 0, 0]);                      // side by side
    out.counts = [N, R.layerElementCount(V)];
    M.cam.phi = 1.5; M.cam.fit(R.contentBbox()); await settle();
    out.pick = [pickAt(33), pickAt(33, 150), pickAt(77, 150)];
    // the view's filter is its own: hide record 33 in the VIEW only
    const mask = new Uint8Array(100).fill(1); mask[33] = 0;
    R.setFilter(mask, { isolate: true }, V); await settle();
    out.filtered = [pickAt(33), pickAt(33, 150), pickAt(34, 150)];
    // a COSMETIC change on the view over a converged frame re-shades (the bake reads
    // the source's buffers through the proxies), and the GL is clean
    for (let k = 0; k < 40 && !R.captureReady; k++) { R.idleCapture(M.cam); await new Promise((res) => requestAnimationFrame(res)); }
    const r0 = R.resolveCount;
    const ramp = new Uint8Array(256 * 4); for (let i = 0; i < 256; i++) ramp.set([i, 0, 255 - i, 255], i * 4);
    R.setLayerRamp(V, ramp); await settle();
    out.reshade = { resolves: R.resolveCount - r0, glError: R.gl.getError() };
    // the source re-streams in place (remove + re-add under its id): the view follows
    await M.reopenWithMapping(L, {}); await settle();
    out.restream = { count: R.layerElementCount(V), link: R.layerViewOf(V), pick: pickAt(34, 150) };
    // a view can't take chunks of its own, and can't be a source
    try { R.addChunk({ kind: 'points' }, 'base', V); out.own = 'accepted'; } catch (e) { out.own = 'refused'; }
    try { R.setLayerViewOf(9002, V); out.chain = 'accepted'; } catch (e) { out.chain = 'refused'; }
    // the view goes; the model keeps every chunk (a proxy frees nothing)
    R.removeLayer(V); await settle();
    out.after = { model: R.layerElementCount(id), view: R.layerElementCount(V), link: R.layerViewOf(V), pick: pickAt(33), gone: pickAt(33, 150) };
    return out;
  });
  await p.close();
  chk(`views: a view draws its source's ${r.counts[0]} blocks (${r.counts[1]})`, r.counts[0] === 100 && r.counts[1] === 100);
  chk(`views: the model and the view each pick as themselves (${r.pick.join(' · ')})`, r.pick[0] === 'model:33' && r.pick[1] === 'view:33' && r.pick[2] === 'view:77');
  chk(`views: a filter on the view hides its block, not the model's (${r.filtered.join(' · ')})`, r.filtered[0] === 'model:33' && r.filtered[1] === null && r.filtered[2] === 'view:34');
  chk(`views: a ramp change on the view re-shades without a re-raster, GL clean (${JSON.stringify(r.reshade)})`, r.reshade.resolves > 0 && r.reshade.glError === 0);
  chk(`views: the view follows its source's in-place re-stream (${JSON.stringify(r.restream)})`, r.restream.count === 100 && r.restream.pick === 'view:34');
  chk(`views: a view takes no chunks of its own (${r.own}) and can't itself be viewed (${r.chain})`, r.own === 'refused' && r.chain === 'refused');
  chk(`views: removing the view leaves the model whole (${JSON.stringify(r.after)})`, r.after.model === 100 && r.after.view === 0 && r.after.link === null && r.after.pick === 'model:33' && r.after.gone === null);
}

// ── §75: the VALUE TEXTURE beyond boxes. (a) A block model drawn as POINTS
//     (no regular grid) put its grade in the points' 16-bit intensity slot,
//     quantized per streamed batch to THAT batch's own min..max — so a batch of
//     0–1 grades and a batch of 100–101 grades both spanned the whole ramp. It
//     now colours from the per-record texture: one document range. (b) A
//     drillhole coloured by another interval column re-desurveyed and REPLACED
//     its layer; it now keeps its id and reads the texture, same picture. ──
if (take()) {
  const p = await mkPage('sm2ptsvt');
  const r = await p.evaluate(async () => {
    const M = window._micro, W = window.micro, out = {};
    const settle = () => new Promise((res) => { M.requestRender(); setTimeout(res, 500); });
    const shot = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return { d: g.getImageData(0, 0, bm.width, bm.height).data, w: bm.width, h: bm.height };
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) n++; return n / (a.length / 4); };
    // (a) 262144 points (one streamed batch) at x 0–100 with grades 0–1, then
    // 40000 at x 200–300 with grades 100–101; scattered, so there's no grid
    let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    const N1 = 1 << 18, N2 = 40000, rows = ['XC,YC,ZC,AU'];
    for (let i = 0; i < N1 + N2; i++) {
      const right = i >= N1, x = (right ? 200 : 0) + rnd() * 100, y = rnd() * 100, z = rnd() * 2;
      rows.push(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)},${((right ? 100 : 0) + rnd()).toFixed(4)}`);
    }
    const id = await M.openBlob(new File([rows.join('\n') + '\n'], 'scatter.csv'), 'scatter.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    out.points = !L.docs.blockDoc.grid;
    M.cam.phi = 0.05; M.cam.fit(M.renderer.contentBbox()); await settle();
    // the screen columns of world x = 150 (the gap) and x = 50 (the LOW cluster):
    // which side of the gap is which is the camera's business, not assumed
    const o = M.frame.origin, m = M.cam.state.viewProj;
    const ndcX = (wx) => { const X = wx - o[0], Y = 50 - o[1], Z = 1 - o[2]; return (m[0] * X + m[4] * Y + m[8] * Z + m[12]) / (m[3] * X + m[7] * Y + m[11] * Z + m[15]); };
    const nx = ndcX(150), lowLeft = ndcX(50) < nx;
    const sides = ({ d, w, h }) => {                        // mean green of the lit pixels: [low cluster, high cluster]
      const split = Math.round((nx + 1) / 2 * w), acc = [[0, 0], [0, 0]];
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const k = (yy * w + xx) * 4; if (Math.max(d[k], d[k + 1], d[k + 2]) < 50) continue;
        const a = acc[(xx < split) === lowLeft ? 0 : 1]; a[0] += d[k + 1]; a[1]++;
      }
      return acc.map(([g, n]) => (n ? Math.round(g / n) : -1));
    };
    await W.setColorBy(id, 'AU'); await settle();
    out.tex = { on: !!L._valTex, range: M.renderer.layerChanRange(id) };
    const pTex = await shot(); out.texG = sides(pTex);
    // the old picture, for the record: the texture path off → the batch-quantized intensity
    window.__noValueTex = true;
    M.renderer.setLayerChanTex(id, null); await settle();
    const pOld = await shot(); out.oldG = sides(pOld);
    window.__noValueTex = false;
    M.renderer.setLayerChanTex(id, L._valTex.tex, L._valTex.range); await settle();
    // a clip applies to the points too (it was ignored in the intensity slot)
    await W.setColorRange(id, { min: 100, max: 101 }); await settle();
    out.clipG = sides(await shot());
    await W.setColorRange(id, null);
    // (b) drillholes: colour by a second interval column
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE,AG'];
    for (let h = 0; h < 6; h++) {
      const hid = 'H' + h;
      collar.push(`${hid},${1000 + h * 30},2000,300,60`); survey.push(`${hid},0,0,-90`);
      for (let k = 0; k < 20; k++) assay.push(`${hid},${k * 3},${k * 3 + 3},${(30 + h * 5 + k).toFixed(1)},${((k * 7 + h * 3) % 20).toFixed(1)}`);
    }
    const f = (a, n) => new File([a.join('\n') + '\n'], n);
    await M.importDrillholes({ collar: f(collar, 'collars.csv'), survey: f(survey, 'survey.csv'), intervals: f(assay, 'assay.csv') }, {}, 'replace');
    const Ld = M.layers().find((q) => q.dh), did = Ld.id;
    M.cam.fit(M.renderer.contentBbox()); await settle();
    const dFE = await shot();
    await W.setColorBy(did, 'AG'); await settle();
    const Ld2 = M.layers().find((q) => q.dh);
    out.dh = { sameId: Ld2.id === did, on: !!Ld2._valTex, name: Ld2._valTex && Ld2._valTex.name, range: M.renderer.layerChanRange(did) };
    const dTex = await shot();
    // the reference: the re-desurvey (texture path off) — a NEW layer
    await W.setColorBy(did, 'FE');
    window.__noValueTex = true;
    await W.setColorBy(did, 'AG'); await settle();
    window.__noValueTex = false;
    out.dh.refReplaced = M.layers().find((q) => q.dh).id !== did;
    const dRe = await shot();
    out.dh.dTexRe = differ(dTex.d, dRe.d); out.dh.dFE = differ(dTex.d, dFE.d);
    return out;
  });
  await p.close();
  chk(`points-drawn model: a scatter opens as points (${r.points}) and colours from a value texture over the WHOLE range [${r.tex.range}]`, r.points && r.tex.on && r.tex.range && r.tex.range[0] < 0.01 && r.tex.range[1] > 100.9);
  chk(`points-drawn model: low grades read low and high grades read high (mean green, low cluster ${r.texG[0]} · high ${r.texG[1]}; batch-quantized before: ${r.oldG[0]} · ${r.oldG[1]})`, r.texG[0] < 60 && r.texG[1] > 170 && Math.abs(r.oldG[0] - r.oldG[1]) < 40);
  chk(`points-drawn model: the clip applies (100–101 → the low cluster pinned to the bottom colour, the high one spread: ${r.clipG[0]} · ${r.clipG[1]})`, r.clipG[0] < 60 && r.clipG[1] < r.texG[1] - 30);
  chk(`drillholes: colour by AG keeps the layer (same id ${r.dh.sameId}) and reads a value texture (${r.dh.name}, range [${r.dh.range}])`, r.dh.sameId && r.dh.on && r.dh.name === 'AG' && r.dh.range && r.dh.range[0] === 0 && r.dh.range[1] === 19);
  chk(`drillholes: the texture draws what the re-desurvey draws (${(100 * r.dh.dTexRe).toFixed(2)}% differ; FE vs AG ${(100 * r.dh.dFE).toFixed(1)}%; the re-desurvey replaced its layer: ${r.dh.refReplaced})`, r.dh.refReplaced && r.dh.dTexRe < 0.005 && r.dh.dFE > 0.005);
}

// ── §76: micro VIEWS of a layer — one block model shown twice, each with its
//     own colour and filter, over ONE copy of the data. The view borrows the
//     model's records, columns and selection (writes land on the model); it
//     saves as display state that names its model; it goes with its model; a
//     drillhole view follows its model through a re-desurvey. ──
if (take()) {
  const p = await mkPage('sm2lviews');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, R = M_.renderer, out = {};
    const settle = () => new Promise((res) => { M_.requestRender(); setTimeout(res, 400); });
    const shot = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data;
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) n++; return n / (a.length / 4); };
    const rows = ['XC,YC,ZC,AU,CU'];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i * 20 + j},${(j * 7 + i * 3) % 50}`);
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'replace');
    const M = M_.layers().find((q) => q.id === mid);
    await W.setColorBy(mid, 'AU');
    // (a) a view: its own layer, nested under the model, drawing all its blocks
    const vid = await W.addView(mid, { color: 'CU' });
    const V = M_.layers().find((q) => q.id === vid);
    const flat = []; const walk = (a) => { for (const nd of a) typeof nd === 'number' ? flat.push(nd) : walk(nd.children); }; walk(M_.layerTree());
    out.a = { viewOf: V.viewOf, label: V.label, tree: flat, count: [R.layerElementCount(mid), R.layerElementCount(vid)], link: R.layerViewOf(vid), info: W.layer(vid).viewOf };
    // (b) the colour is the view's own: CU on the view, AU still on the model
    R.setLayerOffset(vid, [250, 0, 0]);                    // side by side, for the pictures
    M_.cam.fit(R.contentBbox()); await settle();
    out.b = { model: W.layer(mid).colorBy, view: W.layer(vid).colorBy, mRange: R.layerChanRange(mid), vRange: R.layerChanRange(vid), vTex: V._valTex && V._valTex.name, mTex: !!M._valTex };
    const pCU = await shot();
    await W.setColorBy(vid, 'AU'); await settle();
    const pAU = await shot();
    await W.setVisible(vid, false); await settle(); const mOnly1 = await shot();
    await W.setVisible(vid, true); await W.setColorBy(vid, 'CU'); await W.setVisible(vid, false); await settle(); const mOnly2 = await shot();
    await W.setVisible(vid, true); await settle();
    out.b.dView = differ(pCU, pAU); out.b.dModel = differ(mOnly1, mOnly2);
    // (c) the filter is the view's own
    await W.filter(vid, 'AU > 300');
    out.c = { view: V.filterExpr, model: M.filterExpr, vMask: !!V._filterMask, mMask: !!M._filterMask };
    // (d) the data is the model's: reads AND writes go through
    const lin = M.lineage;
    V.lineage = { op: 'probe' };
    out.d = { docs: V.docs === M.docs, paint: V.paintCols === M.paintCols, kind: V.kind === M.kind, wrote: M.lineage && M.lineage.op === 'probe', own: Object.keys(V).includes('docs') };
    M.lineage = lin;
    // (e) one selection: picked through the view, it is the model's
    await W.select(vid, [1, 2, 3]);
    out.e = { model: M._selCount, view: V._selCount };
    await W.clearSelection(vid);
    out.e.cleared = M._selCount || 0;
    // (f) a save writes ONE file and a view entry; a reopen brings the view back
    return out;
  });
  chk(`views: a view of the model, nested right under it in the tree (${JSON.stringify(r.a.tree)}), drawing all ${r.a.count[1]} of its ${r.a.count[0]} blocks, labelled “${r.a.label}”`,
    r.a.viewOf === 0 && r.a.link === 0 && r.a.info === 0 && r.a.count[0] === 800 && r.a.count[1] === 800 && r.a.tree.indexOf(1) === r.a.tree.indexOf(0) + 1 && /model\.csv · CU/.test(r.a.label));
  chk(`views: the colour is the view's own (model ${r.b.model} [${r.b.mRange}], view ${r.b.view} [${r.b.vRange}] from a texture: ${r.b.vTex}; the model has none: ${!r.b.mTex})`,
    r.b.model === 'AU' && r.b.view === 'CU' && r.b.vTex === 'CU' && !r.b.mTex && r.b.mRange[1] === 399 && r.b.vRange[1] === 49);
  chk(`views: recolouring the view changes its picture (${(100 * r.b.dView).toFixed(1)}% of pixels) and not the model's (${(100 * r.b.dModel).toFixed(2)}%)`, r.b.dView > 0.02 && r.b.dModel < 0.002);
  chk(`views: the filter is the view's own (view “${r.c.view}” masked ${r.c.vMask}; model “${r.c.model}” masked ${r.c.mMask})`, r.c.view === 'AU > 300' && r.c.vMask && r.c.model === '' && !r.c.mMask);
  chk(`views: the data is the model's — same docs ${r.d.docs}, same columns ${r.d.paint}, same kind ${r.d.kind}, a write lands on the model ${r.d.wrote}, no own copy ${!r.d.own}`, r.d.docs && r.d.paint && r.d.kind && r.d.wrote && !r.d.own);
  chk(`views: one selection — 3 records selected through the view are the model's (${r.e.model}/${r.e.view}), and cleared through it (${r.e.cleared})`, r.e.model === 3 && r.e.view === 3 && r.e.cleared === 0);

  // (f) project round trip
  await saveProject(p);
  const f = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2lviews');
    const mf = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const files = []; for await (const [n, h] of dir.entries()) if (h.kind === 'directory') for await (const [n2] of h.entries()) files.push(n + '/' + n2); else files.push(n);
    return { layers: mf.layers.map((l) => (l.viewOf != null ? { viewOf: l.viewOf, label: l.label, colorSel: l.colorSel, filter: l.filter } : { source: l.source })), files: files.filter((x) => /\.csv$|\.parquet$/.test(x)) };
  });
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2lviews'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(800);
  const g = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const ls = W.layers();
    const v = ls.find((l) => l.viewOf != null), m = ls.find((l) => l.viewOf == null);
    const V = v && M_.layers().find((q) => q.id === v.id);
    const out = { n: ls.length, view: v && { viewOf: v.viewOf, name: v.name, colorBy: v.colorBy, filter: V.filterExpr, tex: V._valTex && V._valTex.name, link: M_.renderer.layerViewOf(v.id) }, model: m && { id: m.id, colorBy: m.colorBy } };
    // (g) the model goes: its view goes with it
    await W.removeLayer(m.id);
    out.after = W.layers().length;
    return out;
  });
  chk(`views: a save writes the file once (${JSON.stringify(r && f.files)}) and the view as display over manifest layer ${f.layers[1] && f.layers[1].viewOf} (${JSON.stringify(f.layers[1])})`,
    f.files.length === 1 && f.layers.length === 2 && f.layers[1].viewOf === 0 && f.layers[1].colorSel && f.layers[1].filter === 'AU > 300');
  chk(`views: a reopen brings the view back over its model (${JSON.stringify(g.view)}; model coloured by ${g.model && g.model.colorBy})`,
    g.n === 2 && g.view && g.view.viewOf === g.model.id && g.view.link === g.model.id && g.view.colorBy === 'CU' && g.view.tex === 'CU' && g.view.filter === 'AU > 300' && g.model.colorBy === 'AU');
  chk(`views: removing the model takes its view (${g.after} layers left)`, g.after === 0);

  // (h) drillholes: a view follows its model through a re-desurvey (a NEW id)
  const h = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE,AG'];
    for (let k = 0; k < 4; k++) { collar.push(`H${k},${1000 + k * 30},2000,300,30`); survey.push(`H${k},0,0,-90`); for (let q = 0; q < 10; q++) assay.push(`H${k},${q * 3},${q * 3 + 3},${30 + q},${(q * 7 + k) % 9}`); }
    const fl = (a, n) => new File([a.join('\n') + '\n'], n);
    await M_.importDrillholes({ collar: fl(collar, 'collars.csv'), survey: fl(survey, 'survey.csv'), intervals: fl(assay, 'assay.csv') }, {}, 'replace');
    const D = M_.layers().find((q) => q.dh && q.viewOf == null), did = D.id;
    const vid = await W.addView(did, { color: 'AG' });
    const out = { before: { viewOf: M_.layers().find((q) => q.id === vid).viewOf, did } };
    window.__noValueTex = true;                             // the model's colour switch re-desurveys → a NEW layer
    await W.setColorBy(did, 'AG');
    window.__noValueTex = false;
    const D2 = M_.layers().find((q) => q.dh && q.viewOf == null), V2 = M_.layers().find((q) => q.id === vid);
    out.after = { newId: D2.id, viewOf: V2 && V2.viewOf, link: V2 && M_.renderer.layerViewOf(vid), count: M_.renderer.layerElementCount(vid), colorBy: V2 && W.layer(vid).colorBy };
    return out;
  });
  chk(`views: a drillhole view follows its model through a re-desurvey (${h.before.did} → ${h.after.newId}; the view now shows ${h.after.viewOf}, ${h.after.count} intervals, coloured by ${h.after.colorBy})`,
    h.after.newId !== h.before.did && h.after.viewOf === h.after.newId && h.after.link === h.after.newId && h.after.count === 40 && h.after.colorBy === 'AG');
  await p.close();
}
// ── §77: a VIEW's own category column and a view drawn somewhere else. A view
//     classes by any text column WITHOUT re-reading its model (its codes ride
//     the layer's code texture); its hidden classes index ITS codes, "select
//     through" included; an offset moves it for display only — the pick, the
//     through-selection and the section find it where it is drawn; both save. ──
if (take()) {
  const p = await mkPage('sm2vcat');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, R = M_.renderer, out = {};
    const settle = () => new Promise((res) => { M_.requestRender(); setTimeout(res, 400); });
    const shot = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data;
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) n++; return n / (a.length / 4); };
    const ZONES = ['N', 'S', 'E'];
    const rows = ['XC,YC,ZC,AU,ROCK,ZONE'];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i * 20 + j},${i < 10 ? 'ox' : 'fr'},${ZONES[j % 3]}`);
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'replace');
    const M = M_.layers().find((q) => q.id === mid);
    await W.setColorBy(mid, 'AU');
    const doc0 = M.docs.blockDoc, hdr0 = doc0.header, cat0 = hdr0.categories ? hdr0.columns[hdr0.mapping.cat] : null;
    // (a) a view classed by ZONE: the model is NOT re-read, keeps its own colour and class column
    const vid = await W.addView(mid, { color: 'ZONE' });
    const V = M_.layers().find((q) => q.id === vid);
    const vc = V._viewCat;
    out.a = { view: W.layer(vid).colorBy, model: W.layer(mid).colorBy, sameDoc: M.docs.blockDoc === doc0 && M.docs.blockDoc.header === hdr0, cat0,
      catNow: hdr0.categories ? hdr0.columns[hdr0.mapping.cat] : null, names: vc && vc.names, n: vc && vc.codes.length,
      counts: vc && [...vc.counts.entries()].sort((x, y) => x[0] - y[0]).map(([c, k]) => `${vc.names[c]}:${k}`) };
    // (b) its picture is its own: ZONE vs the model's class column, the model untouched
    await W.setViewOffset(vid, [600, 0, 0]);
    M_.cam.fit(R.contentBbox()); await settle();
    const pZone = await shot();
    await W.setVisible(vid, false); await settle(); const mOnly1 = await shot();
    await W.setVisible(vid, true);
    await W.setColorBy(vid, cat0 || 'ROCK'); await settle();
    const pRock = await shot();
    await W.setVisible(vid, false); await settle(); const mOnly2 = await shot();
    await W.setVisible(vid, true);
    await W.setColorBy(vid, 'ZONE'); await settle();
    out.b = { dView: differ(pZone, pRock), dModel: differ(mOnly1, mOnly2), back: W.layer(vid).colorBy, catColBack: V.catCol };
    // (c) the offset: drawn 250 east, data where it was
    const bm = R.contentBbox({ layers: [mid] }), bv = R.contentBbox({ layers: [vid] });
    out.c = { info: W.layer(vid).offset, shift: bv && bm ? bv[0] - bm[0] : null, modelOff: W.layer(mid).offset };
    // (d) the view's hidden class + "select through" where the view is DRAWN
    const nCode = vc.names.indexOf('N');
    V.catHidden = new Set([nCode]); M_.syncRuleMode(V); await settle();
    const vp = M_.cam.state.viewProj, rc = M_.renderer.gl.canvas.getBoundingClientRect();
    const proj = (b) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const X of [b[0], b[3]]) for (const Y of [b[1], b[4]]) for (const Z of [b[2], b[5]]) {
        const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
        const px = ((vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12]) / cw * 0.5 + 0.5) * rc.width, py = (0.5 - (vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13]) / cw * 0.5) * rc.height;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      } return [x0, y0, x1, y1]; };
    const sv = proj(bv), sm = proj(bm);
    M_.setSelThrough(true);
    const poly = [[sv[0] - 2, sv[1] - 2], [sv[2] + 2, sv[1] - 2], [sv[2] + 2, sv[3] + 2], [sv[0] - 2, sv[3] + 2]];
    await M_.selectVolume(poly, 'replace', true);
    const nN = vc.counts.get(nCode), sel = M._selCount;
    await M_.selectVolume(poly, 'replace', true, mid);      // the same tube over the MODEL alone: it is drawn elsewhere
    M_.setSelThrough(false);
    out.d = { sel, expect: 800 - nN, modelOnly: M._selCount || 0 };
    await W.clearSelection(mid);
    // (e) a pick on the moved view lands where it is drawn
    const cx = (sv[0] + sv[2]) / 2, cy = (sv[1] + sv[3]) / 2;
    const [hit] = await W.worldAt([[cx, cy]]);
    const o = M_.frame.origin;
    out.e = hit && { layer: hit.layer, x: hit.world[0] - o[0], vx: [bv[0], bv[3]] };
    return out;
  });
  chk(`view classes: a view classes by its own text column (view ${r.a.view}, ${r.a.n} codes — ${r.a.counts}), the model keeps ${r.a.model} and its class column ${r.a.catNow}, never re-read (${r.a.sameDoc})`,
    r.a.view === 'ZONE' && r.a.model === 'AU' && r.a.sameDoc && r.a.catNow === r.a.cat0 && JSON.stringify(r.a.names) === '["E","N","S"]' && r.a.n === 800 && r.a.counts.join() === 'E:240,N:280,S:280');
  chk(`view classes: its picture is its own — ZONE vs ${r.a.cat0 || 'ROCK'} changes ${(100 * r.b.dView).toFixed(1)}% of pixels, the model's ${(100 * r.b.dModel).toFixed(2)}%; back on ZONE (${r.b.back})`,
    r.b.dView > 0.01 && r.b.dModel < 0.002 && r.b.back === 'ZONE' && r.b.catColBack === 'ZONE');
  chk(`view offset: drawn ${r.c.shift} east (${JSON.stringify(r.c.info)}), the model unmoved (${r.c.modelOff === undefined ? 'no offset' : JSON.stringify(r.c.modelOff)})`,
    Math.abs(r.c.shift - 600) < 1e-6 && JSON.stringify(r.c.info) === '[600,0,0]' && r.c.modelOff === undefined);
  chk(`view classes + offset: "select through" over the moved view takes ${r.d.sel} records — all but its hidden class (${r.d.expect}); the model, drawn elsewhere, gives ${r.d.modelOnly}`,
    r.d.modelOnly === 0 && r.d.sel === r.d.expect);
  chk(`view offset: a pick on the moved view lands on it (layer ${r.e && r.e.layer}, x ${r.e && r.e.x.toFixed(1)} in [${r.e && r.e.vx.map((v) => v.toFixed(0))}])`,
    r.e && r.e.x >= r.e.vx[0] - 1e-6 && r.e.x <= r.e.vx[1] + 1e-6);

  // (f) project round trip: the column, the offset and the hidden class come back
  await saveProject(p);
  const f = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2vcat');
    const mf = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const v = mf.layers.find((l) => l.viewOf != null);
    return { catCol: v && v.catCol, offset: v && v.offset, hidden: v && v.hiddenCats };
  });
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2vcat'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(800);
  const g = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const v = W.layers().find((l) => l.viewOf != null);
    const V = v && M_.layers().find((q) => q.id === v.id);
    return v && { colorBy: v.colorBy, offset: v.offset, drawn: M_.renderer.layerOffset(v.id), names: V._viewCat && V._viewCat.names, hidden: V.catHidden && [...V.catHidden].map((c) => V._viewCat.names[c]) };
  });
  chk(`view classes + offset: saved (${JSON.stringify(f)}) and reopened (${JSON.stringify(g)})`,
    f.catCol === 'ZONE' && JSON.stringify(f.offset) === '[600,0,0]' && JSON.stringify(f.hidden) === '["N"]'
    && g && g.colorBy === 'ZONE' && JSON.stringify(g.offset) === '[600,0,0]' && JSON.stringify(g.drawn) === '[600,0,0]' && JSON.stringify(g.hidden) === '["N"]');
  await p.close();
}
// ── §78: "new view beside it", and a drillhole set's COLLARS as glyphs — the
//     collar file drawn as points (one per hole) at a glyph size of their own,
//     every collar column colourable and filterable; the hole filter thins
//     them; derived (never saved as a layer), remembered by the set and back
//     on reopen with its size and colour. ──
if (take()) {
  const p = await mkPage('sm2collars');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, R = M_.renderer, out = {};
    // (a) beside: a second view lands east of the first
    const rows = ['XC,YC,ZC,AU'];
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},105,${i + j}`);
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'small.csv'), 'small.csv', 'replace');
    const v1 = await W.addView(mid, { beside: true }), v2 = await W.addView(mid, { beside: true });
    const bb = (id) => R.contentBbox({ layers: [id] });
    out.a = { m: bb(mid), v1: bb(v1), v2: bb(v2), o1: W.layer(v1).offset, o2: W.layer(v2).offset };
    // (b) collars: one glyph per hole, the set's columns
    const collar = ['HOLEID,X,Y,Z,EOH,RIG'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE'];
    for (let k = 0; k < 6; k++) { collar.push(`H${k},${1000 + k * 30},2000,${300 + k},${20 + k * 5},${k % 2 ? 'RC' : 'DD'}`); survey.push(`H${k},0,0,-90`); for (let q = 0; q < 4; q++) assay.push(`H${k},${q * 3},${q * 3 + 3},${30 + q + k}`); }
    const fl = (a, n) => new File([a.join('\n') + '\n'], n);
    await M_.importDrillholes({ collar: fl(collar, 'collars.csv'), survey: fl(survey, 'survey.csv'), intervals: fl(assay, 'assay.csv') }, {}, 'replace');
    const D = M_.layers().find((q) => q.dh), nd = M_.dhSetGroupOf(D.id);
    const C = await M_.showCollars(nd);
    const flat = []; const walk = (a) => { for (const n of a) typeof n === 'number' ? flat.push(n) : walk(n.children); }; walk([nd]);
    out.b = { n: C && M_.attrRowCountOf(C), name: C && C.label, nested: C && flat.includes(C.id), scale: C && R.layerPointScale(C.id), cols: C && W.layer(C.id).columns, active: M_.activeId() === D.id };
    await W.setColorBy(C.id, 'EOH');
    await W.filter(C.id, 'RIG = "RC"');
    const ptOnly = W.layer(C.id).colorBy;
    out.b.color = ptOnly; out.b.filtered = C._filterMask ? C._filterMask.reduce((a, b) => a + b, 0) : null;
    // (c) a pick on a collar reads its row
    const row = await M_.fetchLayerRow(C, 2);
    out.c = { row };
    await W.filter(C.id, '');
    return out;
  });
  chk(`views: “beside” puts each new view east of everything before it (model x ${r.a.m[3].toFixed(0)} | view 1 ${r.a.v1[0].toFixed(0)}–${r.a.v1[3].toFixed(0)} | view 2 ${r.a.v2[0].toFixed(0)}–${r.a.v2[3].toFixed(0)}; offsets ${JSON.stringify(r.a.o1)} ${JSON.stringify(r.a.o2)})`,
    r.a.v1[0] > r.a.m[3] && r.a.v2[0] > r.a.v1[3] && r.a.o1[1] === 0 && r.a.o2[2] === 0);
  chk(`collars: ${r.b.n} glyphs, one per hole, “${r.b.name}” nested in the set (${r.b.nested}), ×${r.b.scale} the point size, the set's layer still active (${r.b.active})`,
    r.b.n === 6 && r.b.nested && r.b.scale === 3 && /· collars$/.test(r.b.name) && r.b.active);
  chk(`collars: every collar column is the layer's (${r.b.cols && r.b.cols.join(',')}) — coloured by ${r.b.color}, filtered to the RC holes (${r.b.filtered}); a row reads ${JSON.stringify(r.c.row)}`,
    r.b.color === 'EOH' && r.b.filtered === 3 && r.b.cols.includes('RIG') && r.b.cols.includes('EOH') && String(r.c.row[0]) === 'H2');

  // (d) the hole filter thins the collars, keeping their look
  const d = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const D = M_.layers().find((q) => q.dh), nd = M_.dhSetGroupOf(D.id);
    await M_.setHoleFilter(nd, 'EOH > 30');
    const C = M_.layers().find((q) => q.collarOf);
    return { n: C && M_.attrRowCountOf(C), color: C && W.layer(C.id).colorBy, scale: C && M_.renderer.layerPointScale(C.id) };
  });
  chk(`collars: the hole filter (EOH > 30) leaves ${d.n} collars, still coloured by ${d.color} at ×${d.scale}`, d.n === 3 && d.color === 'EOH' && d.scale === 3);
  // (e) never saved as a layer; the set brings them back
  await p.evaluate(async () => { const M_ = window._micro, D = M_.layers().find((q) => q.dh); await M_.setHoleFilter(M_.dhSetGroupOf(D.id), ''); const C = M_.layers().find((q) => q.collarOf); M_.renderer.setLayerPointScale(C.id, 5); await M_.showHoleTraces(M_.dhSetGroupOf(D.id)); });
  await saveProject(p);
  const f = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2collars');
    const mf = JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text());
    const sets = []; const walk = (a) => { for (const n of a) if (typeof n !== 'number') { if (n.d) sets.push({ k: n.k, t: n.t }); walk(n.ch || []); } }; walk(mf.tree || []);
    return { layers: mf.layers.length, kinds: mf.layers.map((l) => l.label || l.source), sets };
  });
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2collars'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(800);
  const g = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const C = M_.layers().find((q) => q.collarOf);
    return C && { n: M_.attrRowCountOf(C), color: W.layer(C.id).colorBy, scale: M_.renderer.layerPointScale(C.id), layers: M_.layers().length, traces: M_.layers().filter((q) => q.trace).length };
  });
  chk(`collars: not saved as a layer (${f.layers} manifest layers: ${f.kinds.join(', ')}) — the set remembers them and its traces (${JSON.stringify(f.sets)}) and a reopen brings them back (${JSON.stringify(g)})`,
    f.layers === 1 && f.sets.length === 1 && f.sets[0].k && f.sets[0].k.scale === 5 && f.sets[0].k.color === 'EOH' && !f.kinds.some((k) => /collars/.test(k || ''))
    && g && g.n === 6 && g.color === 'EOH' && g.scale === 5 && f.sets[0].t === 1 && g.traces === 1);
  await p.close();
}
// ── §79: point CLOUDS colour by any of their columns — LAS's whole point
//     record (return number, GPS time, …) and its EXTRA BYTES, a PLY's vertex
//     properties — through the value texture; the record panel reads the whole
//     record; a cloud can be viewed; all of it survives a save and reopen. ──
if (take()) {
  const p = await mkPage('sm2clouds');
  const pts = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) pts.push({ x: 1000 + i, y: 2000 + j, z: 100 + Math.sin(i / 3), intensity: 100 * i, classification: 2, ret: 1 + (i % 3), nret: 3, gps: 5000 + j, psid: 7, r: 100, g: 150, b: 200, nir: 3 * i, extra: { reflectance: i < 10 ? -10 + i * 0.5 : 20 + i * 0.25 } });
  pts[1].extra = {};                                        // → no-data
  const las = Array.from(new Uint8Array(makeLas(pts, { format: 8, version: [1, 4], offset: [1000, 2000, 0], extra: [{ name: 'reflectance', type: 4, scale: 0.01, offset: 0, noData: -32767 }] })));
  const r = await p.evaluate(async (las) => {
    const M_ = window._micro, W = window.micro, R = M_.renderer, out = {};
    const settle = () => new Promise((res) => { M_.requestRender(); setTimeout(res, 400); });
    const shot = async () => {
      const b = await W.snapshot({ decorations: false });
      const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d');
      g.drawImage(bm, 0, 0); return g.getImageData(0, 0, bm.width, bm.height).data;
    };
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 4 || Math.abs(a[i + 1] - b[i + 1]) > 4 || Math.abs(a[i + 2] - b[i + 2]) > 4) n++; return n / (a.length / 4); };
    const id = await M_.openBlob(new File([new Uint8Array(las)], 'scan.las'), 'scan.las', 'replace');
    const L = M_.layers().find((q) => q.id === id);
    // (a) the colour list: the four modes, then the record's columns
    out.a = { opts: [...document.querySelectorAll('#colorBy option')].map((o) => o.textContent), choices: W.layer(id).colorChoices || null };
    await settle(); const pElev = await shot();
    // (b) colour by an extra-bytes column: one texture, the document range, no-data out of it
    await W.setColorBy(id, 'reflectance'); await settle();
    const pRefl = await shot();
    out.b = { colorBy: W.layer(id).colorBy, tex: L._valTex && L._valTex.name, range: R.layerChanRange(id), d: differ(pElev, pRefl) };
    await W.setColorBy(id, 'gps_time'); await settle();
    out.b.gps = { colorBy: W.layer(id).colorBy, range: R.layerChanRange(id) };
    await W.setColorBy(id, 'elevation'); await settle();
    out.b.back = { colorBy: W.layer(id).colorBy, d: differ(pElev, await shot()) };
    // (c) the record panel reads the whole point
    out.c = { cols: M_.attrColumnsOf(L).map((c) => c.name), row: await M_.fetchLayerRow(L, 25) };
    // (d) a view of the cloud, coloured by its own column
    await W.setColorBy(id, 'reflectance');
    const vid = await W.addView(id, { color: 'gps_time', beside: true });
    const V = M_.layers().find((q) => q.id === vid);
    out.d = { view: W.layer(vid).colorBy, model: W.layer(vid) && W.layer(id).colorBy, vTex: V._valTex && V._valTex.name, mTex: L._valTex && L._valTex.name, n: R.layerElementCount(vid) };
    // (e) a PLY cloud's own property
    const ply = ['ply', 'format ascii 1.0', 'element vertex 50', 'property float x', 'property float y', 'property float z', 'property float dev', 'end_header'];
    for (let k = 0; k < 50; k++) ply.push(`${3000 + k} 2000 100 ${k * 0.1 - 2}`);
    const pid = await M_.openBlob(new File([ply.join('\n') + '\n'], 'pts.ply'), 'pts.ply', 'add');
    await W.setColorBy(pid, 'dev');
    const P = M_.layers().find((q) => q.id === pid);
    out.e = { colorBy: W.layer(pid).colorBy, tex: P._valTex && P._valTex.name, range: R.layerChanRange(pid), row: await M_.fetchLayerRow(P, 10) };
    // (f) filter a cloud by its columns: only those columns are read; a no-data point is blank, not zero
    const cnt = (Lx) => (Lx._filterMask ? Lx._filterMask.reduce((a, b) => a + b, 0) : null);
    await W.filter(id, 'reflectance > 20 and return_number = 3'); const f1 = cnt(L);
    await W.filter(id, 'reflectance < 0'); const f2 = cnt(L);
    await W.filter(pid, 'dev > 0'); const f3 = cnt(P);
    await W.filter(vid, 'gps_time < 5005'); const f4 = cnt(V);
    await W.filter(id, 'reflectance > 20 and return_number = 3');
    out.f = { f1, f2, f3, f4, model: L.filterExpr, view: V.filterExpr };
    M_.openAttrTable(L); await new Promise((z) => setTimeout(z, 600));
    { const tw = M_.attrTables.get(id); out.f.table = !!(tw && tw.win && tw.win.el.isConnected && tw.grid); }
    return out;
  }, las);
  const want = ['return_number', 'number_of_returns', 'scan_angle', 'gps_time', 'red', 'nir', 'reflectance'];
  chk(`clouds: a LAS cloud offers its record's columns to colour by (${r.a.opts.slice(4).join(', ')})`,
    want.every((w) => r.a.opts.includes(w)) && !r.a.opts.slice(4).includes('X'));
  chk(`clouds: coloured by its extra-bytes column “reflectance” from a texture (${r.b.tex}, range ${r.b.range && r.b.range.map((v) => v.toFixed(2))}, the no-data point out of it), ${(100 * r.b.d).toFixed(1)}% of pixels changed; by gps_time [${r.b.gps.range}]; back to elevation (${(100 * r.b.back.d).toFixed(2)}%)`,
    r.b.colorBy === 'reflectance' && r.b.tex === 'reflectance' && Math.abs(r.b.range[0] - -10) < 1e-6 && Math.abs(r.b.range[1] - 24.75) < 1e-6 && r.b.d > 0.001
    && r.b.gps.colorBy === 'gps_time' && r.b.gps.range[0] === 5000 && r.b.gps.range[1] === 5019 && r.b.back.colorBy === 'elevation' && r.b.back.d < 0.002);
  chk(`clouds: the record panel reads the whole point (${r.c.cols.length} columns; point 25 → return ${r.c.row[r.c.cols.indexOf('return_number')]}, gps ${r.c.row[r.c.cols.indexOf('gps_time')]}, reflectance ${r.c.row[r.c.cols.indexOf('reflectance')]})`,
    r.c.cols.length === 16 && r.c.row[r.c.cols.indexOf('return_number')] === 3 && r.c.row[r.c.cols.indexOf('gps_time')] === 5001 && r.c.row[r.c.cols.indexOf('reflectance')] === -7.5 && r.c.row[r.c.cols.indexOf('nir')] === 15);
  chk(`clouds: a view of the cloud coloured by its own column (view ${r.d.view} from ${r.d.vTex}, the cloud still ${r.d.model} from ${r.d.mTex}, ${r.d.n} points)`,
    r.d.view === 'gps_time' && r.d.vTex === 'gps_time' && r.d.model === 'reflectance' && r.d.mTex === 'reflectance' && r.d.n === 400);
  chk(`clouds: filtered by their columns — reflectance > 20 and return 3 → ${r.f.f1}, reflectance < 0 → ${r.f.f2} (the no-data point isn't below zero), a PLY's dev > 0 → ${r.f.f3}, the view on its own gps_time < 5005 → ${r.f.f4} (model “${r.f.model}”); its attribute table opens (${r.f.table})`,
    r.f.f1 === 60 && r.f.f2 === 199 && r.f.f3 === 29 && r.f.f4 === 100 && r.f.view === 'gps_time < 5005' && r.f.table);
  chk(`clouds: a PLY cloud colours by its own property “dev” (${r.e.tex}, range ${r.e.range}; point 10 reads ${JSON.stringify(r.e.row)})`,
    r.e.colorBy === 'dev' && r.e.tex === 'dev' && Math.abs(r.e.range[0] - -2) < 1e-6 && Math.abs(r.e.range[1] - 2.9) < 1e-5 && Math.abs(r.e.row[3] - -1) < 1e-6);

  await saveProject(p);
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2clouds'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(1000);
  const g = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    return W.layers().map((l) => { const L = M_.layers().find((q) => q.id === l.id); return { name: l.name, view: l.viewOf != null, colorBy: l.colorBy, tex: L._valTex && L._valTex.name, hits: L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : null }; });
  });
  const las2 = g.find((l) => /scan\.las/.test(l.name) && !l.view), v2 = g.find((l) => l.view), ply2 = g.find((l) => /pts\.ply/.test(l.name));
  chk(`clouds: a reopen colours them as saved (${JSON.stringify(g)})`,
    las2 && las2.colorBy === 'reflectance' && las2.tex === 'reflectance' && las2.hits === 60 && ply2.hits === 29 && v2.hits === 100 && v2 && v2.colorBy === 'gps_time' && v2.tex === 'gps_time' && ply2 && ply2.colorBy === 'dev' && ply2.tex === 'dev');
  await p.close();
}

// ── §80: CHANGE FILE — next month's model under last month's setup. The layer
//     reads a different file and keeps its label, colour, filter and its views;
//     a delimited mapping is carried BY COLUMN NAME (the new file's columns are
//     in another order); a file of another kind is refused, the layer intact. ──
if (take()) {
  const p = await mkPage('sm2chg');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, out = {};
    const jan = ['XC,YC,ZC,AU,ROCK'], feb = ['AU,ZC,ROCK,XC,YC,CU'];
    for (let k = 0; k < 2; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) jan.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i * 20 + j},${i < 10 ? 'ox' : 'fr'}`);
    for (let k = 0; k < 2; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 21; i++) feb.push(`${i * 20 + j + 50},${105 + k * 10},${i < 10 ? 'ox' : 'fr'},${1005 + i * 10},${2005 + j * 10},${(i + j) / 10}`);
    const id = await M_.openBlob(new File([jan.join('\n') + '\n'], 'jan.csv'), 'jan.csv', 'replace');
    const L = M_.layers().find((q) => q.id === id);
    L.label = 'ore model';
    await W.setColorBy(id, 'AU');
    await W.filter(id, 'AU > 300');
    const vid = await W.addView(id, { color: 'ROCK' });
    const cnt = (Lx) => (Lx && Lx._filterMask ? Lx._filterMask.reduce((a, b) => a + b, 0) : null);
    out.before = { hits: cnt(L), n: L.docs.blockDoc.header.count };
    // refused: another kind of file
    const no = await M_.changeLayerFile(L, { file: new File(['x'], 'scan.las'), handle: null });
    out.refused = { ret: no, still: M_.layers().some((q) => q.id === id), msg: document.querySelector('#meta').textContent };
    // the swap
    const L2 = await M_.changeLayerFile(L, { file: new File([feb.join('\n') + '\n'], 'feb.csv'), handle: null });
    const id2 = L2 && L2.id;
    const bh = L2 && L2.docs.blockDoc.header, bb = bh && [...bh.bbox.min, ...bh.bbox.max];
    const V = M_.layers().find((q) => q.id === vid);
    out.after = {
      name: L2 && L2.name, label: L2 && L2.label, colorBy: id2 != null && W.layer(id2).colorBy, filter: L2 && L2.filterExpr, hits: cnt(L2),
      n: bh && bh.count, oldGone: !M_.layers().some((q) => q.id === id),
      xmin: bb && bb[0], xmax: bb && bb[3], viewOf: V && V.viewOf, viewColor: W.layer(vid) && W.layer(vid).colorBy, viewHits: cnt(V),
      cols: L2 && L2.docs.blockDoc.header.columns.join(','), msg: document.querySelector('#meta').textContent,
    };
    return out;
  });
  chk(`change file: a different kind of file is refused, the layer intact (“${r.refused.msg}”)`, r.refused.ret === null && r.refused.still);
  chk(`change file: jan.csv → feb.csv keeps label “${r.after.label}”, colour ${r.after.colorBy}, filter “${r.after.filter}” (${r.before.hits} → ${r.after.hits} matches, ${r.before.n} → ${r.after.n} blocks) · “${r.after.msg}”`,
    r.after.name === 'feb.csv' && r.after.label === 'ore model' && r.after.colorBy === 'AU' && r.after.filter === 'AU > 300'
    && r.before.hits === 198 && r.after.hits === 338 && r.before.n === 800 && r.after.n === 840 && r.after.oldGone);
  chk(`change file: the mapping follows the column NAMES in a reordered header (x ${r.after.xmin}–${r.after.xmax})`,
    Math.abs(r.after.xmin - 1005) < 1e-6 && Math.abs(r.after.xmax - 1205) < 1e-6);
  chk(`change file: the view follows its model onto the new file (colour ${r.after.viewColor})`, r.after.viewColor === 'ROCK');
  await p.close();
}

// ── §81: CUSTOM THEMES — a token map over dark or light. A partial theme (one
//     accent) applies over its base; a light-based one switches the register;
//     switching back removes every inline token; the .json round-trips and
//     refuses non-colours; the editor derives the twin tokens, reads contrast,
//     starts from high contrast cleanly; the theme survives a reload. ──
if (take()) {
  const p = await mkPage('sm2theme');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    out.reg = { dark: M_.registerTokens('dark')['--text'], light: M_.registerTokens('light')['--text'] };
    M_.setCustomTheme({ name: 'blue accent', base: 'dark', tokens: { '--accent': '#2266ff' } });
    out.a = { accent: css('--accent'), text: css('--text'), light: document.documentElement.dataset.theme || null };
    M_.setCustomTheme({ name: 'warm paper', base: 'light', tokens: { '--accent': '#aa3300' }, scene: '#203040' });
    out.b = { accent: css('--accent'), text: css('--text'), light: document.documentElement.dataset.theme || null, scene: M_.sceneDefault() };
    const txt = M_.themeJson();
    const back = M_.parseThemeJson(txt);
    let bad = null; try { M_.parseThemeJson('{"x":1}'); } catch (e) { bad = e.message; }
    const cleaned = M_.parseThemeJson(JSON.stringify({ format: 'micro-theme', base: 'dark', tokens: { '--accent': '#123456', '--panel': 'url(evil)', '--mono': '#000000', 'color': '#ffffff' } }));
    out.c = { name: back.name, base: back.base, accent: back.tokens['--accent'], scene: back.scene, bad, cleaned: Object.keys(cleaned.tokens) };
    M_.setTheme('dark');
    out.d = { accent: css('--accent'), inline: [...document.documentElement.style].filter((k) => k in M_.registerTokens('dark')).length, scene: M_.sceneDefault() };
    // the editor: a swatch edit derives its twin; contrast reads; high contrast passes
    const w = M_.openThemeEditor();
    const sw = w.body.querySelector('input[data-token="--panel"]');
    sw.value = '#202840'; sw.dispatchEvent(new Event('input'));
    const ct = M_.customTheme();
    const crTxt = () => [...w.body.querySelectorAll('div')].map((d) => d.textContent).find((s) => /^contrast/.test(s)) || '';
    out.e = { panel: ct.tokens['--panel'], glass: ct.tokens['--panel-glass'], cssPanel: css('--panel'), cr: crTxt() };
    const sel = w.body.querySelector('select'); sel.value = 'high contrast'; sel.dispatchEvent(new Event('change'));
    out.f = { cr: crTxt(), bg: css('--bg'), base: M_.customTheme().base };
    return out;
  });
  chk(`themes: the registers read from the stylesheet (text ${r.reg.dark} / ${r.reg.light})`, r.reg.dark === '#bbb' && r.reg.light === '#3a3936');
  chk(`themes: a partial dark theme changes just the accent (${r.a.accent}, text ${r.a.text}, register ${r.a.light || 'dark'})`, r.a.accent === '#2266ff' && r.a.text === '#bbb' && r.a.light === null);
  chk(`themes: a light-based theme switches the register and carries its scene (${r.b.accent}, text ${r.b.text}, scene ${r.b.scene})`, r.b.accent === '#aa3300' && r.b.text === '#3a3936' && r.b.light === 'light' && r.b.scene === '#203040');
  chk(`themes: the .json round-trips and refuses non-colours (kept ${JSON.stringify(r.c.cleaned)}; garbage → “${r.c.bad}”)`, r.c.name === 'warm paper' && r.c.base === 'light' && r.c.accent === '#aa3300' && r.c.scene === '#203040' && JSON.stringify(r.c.cleaned) === '["--accent"]' && !!r.c.bad);
  chk(`themes: back to dark leaves no inline token (${r.d.inline}) and the stock accent ${r.d.accent}`, r.d.inline === 0 && r.d.accent === '#c89b3c' && r.d.scene === '#121212');
  chk(`themes: the editor's swatch applies live and keeps the glass panel in step (${r.e.panel} → ${r.e.glass}); ${r.e.cr.slice(0, 60)}…`, r.e.panel === '#202840' && r.e.cssPanel === '#202840' && /rgba\(32, 40, 64, 0\.9[67]\)/.test(r.e.glass) && /contrast/.test(r.e.cr));
  chk(`themes: high contrast starts clean (${r.f.cr.slice(0, 50)}…, bg ${r.f.bg})`, /every pair ≥ 4\.5:1/.test(r.f.cr) && r.f.bg === '#000000' && r.f.base === 'dark');
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window._micro, null, { timeout: 20000 });
  const g = await p.evaluate(() => ({ bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), pref: localStorage.getItem('micro.theme'), raw: (localStorage.getItem('micro.themeCustom') || '').slice(0, 80) }));
  chk(`themes: the custom theme is back after a reload (bg ${g.bg}, pref ${g.pref}, ${g.raw})`, g.bg === '#000000');
  await p.evaluate(() => window._micro.clearCustomTheme());
  await p.close();
}

/// ── §82: TURNTABLE — an orbit recorded frame by frame. The file decodes, lasts
//     what was asked (the recorder is paused while a frame renders, so pacing is
//     even however slow the render), the picture TURNS (two moments differ), and
//     the camera comes back to where it was. The file is decoded in a blank page;
//     the turntable window's PREVIEW plays it inside micro (media-src blob:). ──
if (take()) {
  const p = await mkPage('sm2turn');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    if (!M_.turntableMime()) return { skip: true };
    const rows = ['XC,YC,ZC,AU'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i + j}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'spin.csv'), 'spin.csv', 'replace');
    await window.micro.setColorBy(id, 'AU');
    const th0 = M_.cam.state.theta;
    const res = await M_.recordTurntable({ seconds: 1.5, fps: 10, degrees: 180, decorations: false });
    out.frames = res.frames; out.size = res.blob.size; out.type = res.blob.type; out.thBack = Math.abs(M_.cam.state.theta - th0) < 1e-9;
    const u8 = new Uint8Array(await res.blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    out.b64 = btoa(bin);
    // the window: record → a preview playing in micro itself, under the Sealed CSP
    const w = M_.openTurntable();
    const sel = [...w.body.querySelectorAll('select')]; sel[0].value = '4'; sel[2].value = '24';
    const go = [...w.body.querySelectorAll('button')].find((x) => x.textContent === 'Record'); go.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !(w.el._preview && w.el._preview.src)) await new Promise((res) => setTimeout(res, 200));
    const v = w.el._preview;
    if (v && v.readyState < 1) await new Promise((res) => { v.onloadedmetadata = res; v.onerror = res; setTimeout(res, 5000); });
    out.preview = { src: !!(v && v.src), w: v && v.videoWidth, err: v && v.error ? v.error.message : null, save: !![...w.body.querySelectorAll('button')].find((x) => x.textContent === 'Save video') };
    w.close();
    return out;
  });
  if (r.skip) chk('turntable: this browser cannot record — skipped', true);
  else {
    const q = await ctx.newPage();
    const v = await q.evaluate(async ({ b64, type }) => {
      const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([u8], { type }));
      await new Promise((ok, no) => { v.onloadedmetadata = ok; v.onerror = () => no(new Error('video: ' + (v.error && v.error.message))); });
      if (!Number.isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((ok) => { v.ondurationchange = ok; setTimeout(ok, 3000); }); }
      const o = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
      const grab = async (t) => {
        v.currentTime = t; await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 3000); });
        const c = new OffscreenCanvas(v.videoWidth, v.videoHeight), g = c.getContext('2d'); g.drawImage(v, 0, 0); return g.getImageData(0, 0, c.width, c.height).data;
      };
      const a = await grab(0.05), b = await grab(1.3);
      let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
      o.turned = n / (a.length / 4);
      return o;
    }, { b64: r.b64, type: r.type });
    await q.close();
    chk(`turntable: ${r.frames} frames → a ${r.type} of ${r.size} bytes, ${v.w}×${v.h}, ${v.duration.toFixed(2)} s long`, r.frames === 15 && r.size > 2000 && /video\//.test(r.type) && v.w > 100 && v.duration > 1.0 && v.duration < 2.2);
    chk(`turntable: the window previews the video inside micro (${JSON.stringify(r.preview)})`, r.preview.src && r.preview.w > 100 && !r.preview.err && r.preview.save);
    chk(`turntable: the picture turns (${(100 * v.turned).toFixed(1)}% of pixels differ between the first and last moments) and the camera is back`, v.turned > 0.02 && r.thBack);
  }
  await p.close();
}

// ── §83: EXPLODED VIEWS — a group's members pulled apart along z, display only.
//     Offsets stack by tree order; filters and analysis are unchanged; a pick
//     returns the same record and a measure across two displaced layers reads the
//     TRUE distance; the offsets save and reopen; home brings everything back. ──
if (take()) {
  const p = await mkPage('sm2explode');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, R = M_.renderer, out = {};
    const mk = (z0, au) => { const rows = ['XC,YC,ZC,AU']; for (let k = 0; k < 2; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${z0 + 5 + k * 10},${au + i}`); return rows.join('\n') + '\n'; };
    const ids = [];
    for (const [nm, z0, au] of [['top.csv', 140, 30], ['mid.csv', 120, 20], ['low.csv', 100, 10]]) ids.push(await M_.openBlob(new File([mk(z0, au)], nm), nm, ids.length ? 'add' : 'replace'));
    const nd = M_.createLayerGroup('units', ids);
    const L = (id) => M_.layers().find((q) => q.id === id);
    await W.filter(ids[1], 'AU > 25');
    const hits0 = L(ids[1])._filterMask.reduce((a, b) => a + b, 0);
    const pre = R.contentBbox({ layers: [ids[0]] })[2];
    const res = M_.explodeGroup(nd, 50, 'z');
    out.offs = res.map((x) => x.offset[2]);
    const tree = M_.layerTree();
    const g = tree.find((n) => n.group && n.name === 'units');
    out.order = g.children.map((c) => L(c.id || c).name);
    out.hits = L(ids[1])._filterMask.reduce((a, b) => a + b, 0) === hits0;
    out.trueBox = (() => { const h = L(ids[0]).docs.blockDoc.header.bbox; return [h.min[2], h.max[2]]; })();
    // the drawn box of the top layer is lifted by its offset
    const b0 = R.contentBbox({ layers: [ids[0]] });
    out.lift = b0 ? b0[2] - pre : null;
    // measure across two displaced layers: drawn far apart, true distance read
    M_.cam.fit(R.contentBbox()); M_.cam.update(); M_.requestRender();
    await new Promise((res2) => setTimeout(res2, 400));
    out.offset1 = R.layerOffset(ids[0]);
    // pick the top layer from the centre of its drawn box: the record is a true record
    const cb = R.contentBbox({ layers: [ids[0]] });
    const c = [(cb[0] + cb[3]) / 2, (cb[1] + cb[4]) / 2, cb[5]];
    const m = M_.cam.state.viewProj, w = m[3] * c[0] + m[7] * c[1] + m[11] * c[2] + m[15];
    const cx = ((m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12]) / w + 1) / 2 * document.querySelector('#cv').clientWidth, cy = (1 - (m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13]) / w) / 2 * document.querySelector('#cv').clientHeight;
    await new Promise((res2) => setTimeout(res2, 300));
    const hit = R.pick(cx, cy, M_.cam, { pointPx: 3 });
    out.pick = hit ? { layer: hit.layer, rec: hit.rec } : null;
    if (hit) { const pos = await M_.recordPosition(hit); out.pickZ = pos && pos[2]; }
    const css = (id) => { const bb = R.contentBbox({ layers: [id] }); const q = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, bb[5]]; const w2 = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15]; return [((m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12]) / w2 + 1) / 2 * document.querySelector('#cv').clientWidth, (1 - (m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13]) / w2) / 2 * document.querySelector('#cv').clientHeight]; };
    M_.armMeasure();
    const [ax, ay] = css(ids[0]), [bx, by2] = css(ids[2]);
    await M_.measureClick(ax, ay); await M_.measureClick(bx, by2);
    const ms = M_.measureState();
    out.meas = { drawnDz: ms.a && ms.b ? Math.abs(ms.a[2] - ms.b[2]) : null, trueDz: ms.aT && ms.bT ? Math.abs(ms.aT[2] - ms.bT[2]) : null, txt: document.querySelector('#meta').textContent };
    return out;
  });
  await saveProject(p);
  chk(`explode: members stack by tree order (${r.order.join(', ')} → z ${r.offs.join(' / ')})`, JSON.stringify(r.offs) === '[100,50,0]');
  chk(`explode: the filter is untouched (${r.hits}) and the data keeps its true z (${r.trueBox}); the top layer is drawn ${r.lift} m up`, r.hits && r.trueBox[0] === 145 && Math.abs(r.lift - 100) < 1e-6);
  chk(`explode: a measure across two displaced layers reads the true Δz (${r.meas.trueDz}, drawn ${r.meas.drawnDz}) · “${r.meas.txt}”`, r.meas.trueDz != null && [50, 100].some((k) => Math.abs(Math.abs(r.meas.drawnDz - r.meas.trueDz) - k) < 1e-6) && /true positions/.test(r.meas.txt));
  chk(`explode: a pick on the drawn top layer returns a TRUE record (layer ${r.pick && r.pick.layer}, z ${r.pickZ})`, r.pick && r.pickZ >= 145 && r.pickZ <= 155);
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2explode'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(1000);
  const g = await p.evaluate(() => {
    const M_ = window._micro;
    const by = (n) => M_.layers().find((q) => q.name === n);
    const offs = ['top.csv', 'mid.csv', 'low.csv'].map((n) => { const L = by(n); return L && L.offset ? L.offset[2] : 0; });
    const drawn = ['top.csv', 'mid.csv', 'low.csv'].map((n) => M_.renderer.layerOffset(by(n).id)[2]);
    const nd = M_.layerTree().find((n) => n.group && n.name === 'units');
    M_.explodeGroup(nd, 0);
    return { offs, drawn, home: ['top.csv', 'mid.csv', 'low.csv'].map((n) => M_.renderer.layerOffset(by(n).id)[2]), hits: by('mid.csv')._filterMask && by('mid.csv')._filterMask.reduce((a, b) => a + b, 0) };
  });
  chk(`explode: the offsets reopen with the project (${g.offs.join(' / ')}; drawn ${g.drawn.join(' / ')}); home → ${g.home.join(' / ')}`, JSON.stringify(g.offs) === '[100,50,0]' && JSON.stringify(g.drawn) === '[100,50,0]' && JSON.stringify(g.home) === '[0,0,0]');
  await p.close();
}

// ── §84: MODEL QA — a model seeded with known faults reports each of them, worst
//     first: a block twice in one cell, three gaps inside columns, −99 sentinels,
//     a negative grade, a 5000 among grades ≤ 60 (a top-cut question), a zero and
//     a 9 t/m³ density, blank rock codes. A finding's click selects exactly its
//     blocks; a clean model reports nothing. ──
if (take()) {
  const p = await mkPage('sm2mqa');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU,DENSITY,ROCK'];
    let n = 0;
    for (let k = 0; k < 5; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 20; i++) {
      if (k === 2 && j === 0 && i < 3) continue;           // three gaps, one per column
      n++;
      let au = ((i * 7 + j * 3 + k) % 50) + 1, dens = 2.7, rock = 'ox';
      if (n === 11 || n === 12) au = -99;
      if (n === 13) au = -0.5;
      if (n === 14) au = 5000;
      if (n === 20) dens = 0;
      if (n === 21) dens = 9;
      if (n >= 30 && n < 33) rock = '';
      rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${au},${dens},${rock}`);
    }
    rows.push(rows[100]);                                  // the same block again
    const clean = ['XC,YC,ZC,AU,DENSITY'];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) clean.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${1 + i + j},2.6`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'faults.csv'), 'faults.csv', 'replace');
    const L = M_.layers().find((q) => q.id === id);
    const e = await M_.openModelQa(L);
    const res = await e.done;
    const fs = M_.qaFindings(res);
    out.N = res.N; out.grid = res.lattice && [res.lattice.nx, res.lattice.ny, res.lattice.nz].join('×');
    out.f = fs.map((f) => `${f.sev}|${f.check}|${f.column}|${f.count}`);
    out.rows = e.win.el.querySelectorAll('.mq-tbl tr').length - 1;
    const sent = fs.find((f) => /sentinel/.test(f.check));
    out.selSent = sent ? await M_.selectFinding(L, sent) : null;
    const dup = fs.find((f) => /two blocks/.test(f.check));
    out.selDup = dup ? await M_.selectFinding(L, dup) : null;
    const top = fs.find((f) => /99\.9th/.test(f.check));
    out.selTop = top ? await M_.selectFinding(L, top) : null;
    const cid = await M_.openBlob(new File([clean.join('\n') + '\n'], 'clean.csv'), 'clean.csv', 'add');
    const r2 = await M_.modelQa(M_.layers().find((q) => q.id === cid));
    out.clean = M_.qaFindings(r2).map((f) => `${f.sev}|${f.check}`);
    return out;
  });
  const has = (s) => r.f.includes(s);
  chk(`model QA: ${r.N} blocks on ${r.grid}; ${r.f.length} findings, ${r.rows} rows in the window`, r.N === 998 && r.grid === '20×10×5' && r.rows === r.f.length);
  chk(`model QA: the lattice — a doubled block and three gaps (${r.f.filter((x) => /cell|gap/.test(x)).join(' · ')})`, has('error|two blocks in one cell||1') && has('warn|gap inside a column||3'));
  chk(`model QA: the grades — sentinels, a negative, a top-cut maximum (${r.f.filter((x) => /AU/.test(x)).join(' · ')})`, has('warn|sentinel values (−99, −999, −1e30…)|AU|2') && has('warn|negative values|AU|1') && has('warn|maximum far above the 99.9th percentile|AU|1'));
  chk(`model QA: density and text (${r.f.filter((x) => /DENSITY|ROCK/.test(x)).join(' · ')})`, has('error|density outside 1–6 t/m³|DENSITY|1') && has('error|zero density|DENSITY|1') && has('info|blank values|ROCK|3'));
  chk(`model QA: errors first (${r.f[0]})`, /^error/.test(r.f[0]) && r.f.findIndex((x) => /^warn/.test(x)) > r.f.findLastIndex((x) => /^error/.test(x)));
  chk(`model QA: a click selects exactly the finding's blocks (sentinels ${r.selSent}, the double ${r.selDup}, the top-cut ${r.selTop})`, r.selSent === 2 && r.selDup === 1 && r.selTop === 1);
  chk(`model QA: a clean model has no error or warning (${JSON.stringify(r.clean)} — a constant density is a note)`, r.clean.every((x) => /^info/.test(x)));
  await p.close();
}

// ── §85: DOWN-HOLE COMPOSITES — two vertical holes of 1 m assays composited at
//     5 m: grades are the length-weighted means (2.5, 7.5, …), positions sit at the
//     covered-length centroid on the hole; breaking at LITH restarts at the 7 m
//     contact (a 2 m leftover keeps SUPPORT 2); a 50 % minimum length drops it
//     and says so. The result is a points layer that saves with the project. ──
if (take()) {
  const p = await mkPage('sm2comp');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const collar = 'HOLEID,EAST,NORTH,RL\nA,1000,2000,500\nB,1100,2000,500\n';
    const survey = 'HOLEID,DEPTH,AZIMUTH,DIP\nA,0,0,-90\nB,0,0,-90\n';
    const iv = ['HOLEID,FROM,TO,AU,LITH'];
    for (let d = 0; d < 20; d++) iv.push(`A,${d},${d + 1},${d + 0.5},${d < 7 ? 'ox' : 'fr'}`);
    for (let d = 0; d < 10; d++) iv.push(`B,${d},${d + 1},2,ox`);
    await M_.importDrillholes({ collar: new File([collar], 'collars.csv'), survey: new File([survey], 'survey.csv'), intervals: new File([iv.join('\n') + '\n'], 'assay.csv') }, {}, 'replace');
    const L = M_.layers().find((q) => q.dh && !q.trace);
    const a = await M_.compositeLayer(L, { length: 5 });
    const col = (res, nm) => res.header.indexOf(nm);
    out.a = { n: a.rows.length, au: a.rows.filter((r2) => r2[0] === 'A').map((r2) => +r2[col(a, 'AU')].toFixed(3)), z: +a.rows[0][3].toFixed(3), x: a.rows[0][1], header: a.header.slice(0, 9).join(',') };
    const b = await M_.compositeLayer(L, { length: 5, splitCols: ['LITH'] });
    out.b = { n: b.rows.length, spans: b.rows.filter((r2) => r2[0] === 'A').map((r2) => `${r2[4]}-${r2[5]}:${r2[6]}:${r2[col(b, 'LITH')]}`) };
    const c = await M_.compositeLayer(L, { length: 5, splitCols: ['LITH'], minSupport: 0.5 });
    out.c = { n: c.rows.length, dropped: c.report.short };
    const res = await M_.compositeToLayer(L, { length: 5 });
    const NL = M_.layers().find((q) => q.id === res.id);
    out.layer = { name: NL && NL.name, n: NL && NL.docs.blockDoc && NL.docs.blockDoc.header.count, lineage: NL && NL.lineage && NL.lineage.op, chan: NL && NL.docs.blockDoc.header.columns[NL.docs.blockDoc.header.mapping.chan] };
    return out;
  });
  chk(`composites: 5 m over 1 m assays — ${r.a.n} composites, hole A grades ${r.a.au.join(' / ')}, the first at z ${r.a.z} on its hole (x ${r.a.x}) · ${r.a.header}`,
    r.a.n === 6 && JSON.stringify(r.a.au) === '[2.5,7.5,12.5,17.5]' && r.a.z === 497.5 && r.a.x === 1000 && /^BHID,X,Y,Z,FROM,TO,SUPPORT,AU,LITH/.test(r.a.header));
  chk(`composites: breaking at LITH restarts at the contact (${r.b.spans.join(' · ')})`,
    r.b.n === 7 && JSON.stringify(r.b.spans) === JSON.stringify(['0-5:5:ox', '5-7:2:ox', '7-12:5:fr', '12-17:5:fr', '17-20:3:fr']));
  chk(`composites: 50 % minimum length drops the 2 m leftover and counts it (${r.c.n} kept, ${r.c.dropped} dropped)`, r.c.n === 6 && r.c.dropped === 1);
  chk(`composites: a points layer (${r.layer.name}, ${r.layer.n} points, colour ${r.layer.chan}, lineage ${r.layer.lineage})`, r.layer.name === 'assay-comp5m.csv' && r.layer.n === 6 && r.layer.chan === 'AU' && r.layer.lineage === 'composite');
  await saveProject(p);
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2comp'); await window._micro.openProjectDir(dir); });
  await p.waitForTimeout(800);
  const g = await p.evaluate(() => { const L = window._micro.layers().find((q) => /comp5m/.test(q.name)); return L ? L.docs.blockDoc.header.count : null; });
  chk(`composites: the layer comes back with the project (${g} points)`, g === 6);
  await p.close();
}

// ── §86: BLOCK vs SAMPLE — samples paired with the block they fall in. In the W
//     domain the samples equal their blocks (bias 0, slope 1); in E they are
//     twice their blocks (bias −50 %, slope 0.5). Samples outside the model and in
//     a missing block are counted, not paired; a drillhole pairs by interval
//     midpoint; "select the disagreeing samples" marks exactly the E ones. ──
if (take()) {
  const p = await mkPage('sm2pair');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU,DOMAIN'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
      if (i === 9 && j === 9 && k === 3) continue;         // a missing block
      rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i + 1},${i < 5 ? 'W' : 'E'}`);
    }
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'replace');
    const sm = ['X,Y,Z,AU_S'];
    let nW = 0, nE = 0;
    for (let i = 0; i < 10; i++) for (const j of [1, 4, 7]) { const au = i + 1; sm.push(`${1003 + i * 10},${2006 + j * 10},${112},${i < 5 ? au : 2 * au}`); if (i < 5) nW++; else nE++; }
    sm.push('900,2050,120,5'); sm.push('1050,2050,600,5');          // outside
    sm.push('1095,2095,135,4');                                        // in the missing block
    const sid = await M_.openBlob(new File([sm.join('\n') + '\n'], 'samples.csv'), 'samples.csv', 'add', null, { mapping: { x: 0, y: 1, z: 2, chan: 3, cat: null }, asKind: 'points' });
    const M = M_.layers().find((q) => q.id === mid), Sm = M_.layers().find((q) => q.id === sid);
    const res = await M_.pairBlocksSamples(M, Sm, { blockCol: 'AU', sampleCol: 'AU_S', groupCol: 'DOMAIN' });
    const g = (nm) => res.stats.find((s) => s.group === nm);
    const f2 = (v) => (v == null ? null : +v.toFixed(4));
    out.a = { n: res.n, nW, nE, outside: res.outside, noBlock: res.noBlock, W: [g('W').n, f2(g('W').bias), f2(g('W').slope), f2(g('W').r)], E: [g('E').n, f2(g('E').bias), f2(g('E').slope)] };
    out.sel = M_.selectDisagreeing(res, 1.5);
    out.selCount = Sm._selCount;
    // a drillhole down through column i=2, j=2: intervals of AU 3 in blocks of AU 3
    const collar = 'HOLEID,EAST,NORTH,RL\nH1,1025,2025,160\n', survey = 'HOLEID,DEPTH,AZIMUTH,DIP\nH1,0,0,-90\n';
    const iv = ['HOLEID,FROM,TO,AU']; for (let d = 20; d < 60; d += 2) iv.push(`H1,${d},${d + 2},3`);
    await M_.importDrillholes({ collar: new File([collar], 'c.csv'), survey: new File([survey], 's.csv'), intervals: new File([iv.join('\n') + '\n'], 'assay.csv') }, {}, 'add');
    const D = M_.layers().find((q) => q.dh && !q.trace);
    const rd = await M_.pairBlocksSamples(M, D, { blockCol: 'AU', sampleCol: 'AU' });
    out.dh = { n: rd.n, bias: f2(rd.stats[0].bias), outside: rd.outside };
    // the window: Run fills the table and draws
    const e = M_.openPairing(M);
    e.set({ samples: sid, sCol: 'AU_S', bCol: 'AU', group: '' });
    const wr = await e.run();
    out.win = { n: wr && wr.n, rows: e.win.el.querySelectorAll('.st-tbl tr').length, sub: e.win.sub.textContent };
    return out;
  });
  chk(`block vs sample: ${r.a.n} pairs (${r.a.nW} W + ${r.a.nE} E); ${r.a.outside} outside the model and ${r.a.noBlock} in a missing block are counted, not paired`, r.a.n === 30 && r.a.outside === 2 && r.a.noBlock === 1);
  chk(`block vs sample: W honours its samples (n, bias, slope, r = ${r.a.W.join(', ')}); E is half its samples (${r.a.E.join(', ')})`,
    JSON.stringify(r.a.W) === '[15,0,1,1]' && JSON.stringify(r.a.E) === '[15,-0.5,0.5]');
  chk(`block vs sample: the disagreeing samples (× 1.5) are the E ones — ${r.sel} selected on the samples' layer (${r.selCount})`, r.sel === 15 && r.selCount === 15);
  chk(`block vs sample: a drillhole pairs by interval midpoint (${r.dh.n} intervals, bias ${r.dh.bias}, ${r.dh.outside} outside)`, r.dh.n === 20 && r.dh.bias === 0 && r.dh.outside === 0);
  chk(`block vs sample: the window runs (${r.win.n} pairs, ${r.win.rows} table rows, “${r.win.sub}”)`, r.win.n === 30 && r.win.rows === 2);
  await p.close();
}

// ── §87: SECTION SERIES — N–S sections every 50 m, rendered to one zip: four
//     PNGs (each a different picture — the cut moves through a model graded
//     along x) and an index.html naming them; the section, the camera and the
//     figure title are back afterwards. ──
if (take()) {
  const p = await mkPage('sm2series');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU'];
    for (let k = 0; k < 6; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i * 5 + ((j * k) % 7)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'replace');
    await window.micro.setColorBy(id, 'AU');
    M_.setDecoTitle('Pit 3');
    M_.setSectionWorld({ axis: 'x', position: 1100, thickness: 10 });
    const cam0 = JSON.stringify(window.micro.view());
    out.pos = M_.seriesPositions(1025, 1175, 50);
    const res = await M_.renderSectionSeries({ from: 1025, to: 1175, step: 50 });
    out.sheets = res.sheets.map((s) => s.name);
    out.labels = res.sheets.map((s) => s.label);
    const u8 = new Uint8Array(await res.blob.arrayBuffer());
    // the PNGs inside (stored, not deflated): from each signature to its IEND
    const pngs = [];
    for (let i = 0; i < u8.length - 8; i++) {
      if (u8[i] === 0x89 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4e && u8[i + 3] === 0x47) {
        let j = i; while (j < u8.length - 8 && !(u8[j] === 0x49 && u8[j + 1] === 0x45 && u8[j + 2] === 0x4e && u8[j + 3] === 0x44)) j++;
        pngs.push(u8.slice(i, j + 8)); i = j;
      }
    }
    const px = [];
    for (const b of pngs) { const bm = await createImageBitmap(new Blob([b], { type: 'image/png' })); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); px.push(g.getImageData(0, 0, bm.width, bm.height).data); }
    const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n / (a.length / 4); };
    out.pngs = pngs.length;
    out.d01 = px.length > 1 ? differ(px[0], px[1]) : 0;
    out.d03 = px.length > 3 ? differ(px[0], px[3]) : 0;
    const txt = new TextDecoder().decode(u8);
    out.index = txt.includes('index.html') && /4 N–S sections every 50 m/.test(txt) && out.sheets.every((n) => txt.includes(`src="${n}"`));
    const w = M_.sectionWorld();
    out.after = { pos: w && +w.position.toFixed(3), mode: w && w.mode, cam: JSON.stringify(window.micro.view()) === cam0, title: window.micro.decorations ? null : null };
    out.title = document.querySelector('#meta') && M_.captureFigureCfg ? (M_.captureFigureCfg().deco || {}).titleText : null;
    return out;
  });
  chk(`section series: ${JSON.stringify(r.pos)} → ${r.sheets.join(', ')} (${r.labels[0]} …)`, JSON.stringify(r.pos) === '[1025,1075,1125,1175]' && r.sheets.length === 4 && /N–S section 1025 ± 5/.test(r.labels[0]));
  chk(`section series: the zip holds ${r.pngs} PNGs, each its own picture (${(100 * r.d01).toFixed(1)}% / ${(100 * r.d03).toFixed(1)}% of pixels differ), and an index.html naming them (${r.index})`, r.pngs === 4 && r.d01 > 0.01 && r.d03 > 0.01 && r.index);
  chk(`section series: the section (${r.after.mode} at ${r.after.pos}), the camera (${r.after.cam}) and the title (“${r.title}”) are back`, r.after.mode === 'ns' && r.after.pos === 1100 && r.after.cam && (r.title == null || r.title === 'Pit 3'));
  await p.close();
}

// ── §88: CLOUDS IN THE ANALYSIS WINDOWS — a LAS reads as a table (every column
//     numeric, X/Y/Z mapped), so the Stats window runs on it (intensity: 400
//     points, mean 950), its records stream with a no-data value BLANK (not zero),
//     the layer menu offers Stats and Scatter / Q-Q, and a cloud can be the
//     samples of a block-vs-sample pairing. ──
if (take()) {
  const p = await mkPage('sm2cloudwin');
  const pts = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) pts.push({ x: 1000 + i, y: 2000 + j, z: 100 + i * 0.1, intensity: 100 * i, classification: 2, ret: 1, nret: 1, gps: 5000 + j, psid: 7, r: 100, g: 150, b: 200, nir: 10, extra: { reflectance: i } });
  pts[1].extra = {};                                        // → no-data
  const las = Array.from(new Uint8Array(makeLas(pts, { format: 8, version: [1, 4], offset: [1000, 2000, 0], extra: [{ name: 'reflectance', type: 4, scale: 0.01, offset: 0, noData: -32767 }] })));
  const r = await p.evaluate(async (las) => {
    const M_ = window._micro, out = {};
    const id = await M_.openBlob(new File([new Uint8Array(las)], 'scan.las'), 'scan.las', 'replace');
    const L = M_.layers().find((q) => q.id === id);
    const h = M_.layerTableHeader ? M_.layerTableHeader(L) : null;
    out.h = h ? { kind: h.kind, map: [h.columns[h.mapping.x], h.columns[h.mapping.y], h.columns[h.mapping.z]].join(','), n: h.columns.length, refl: h.columns.includes('reflectance') } : null;
    let n = 0, blanks = 0, sumI = 0; const ii = h.columns.indexOf('intensity'), ri = h.columns.indexOf('reflectance');
    for await (const { f } of M_.layerRecords(L)) { n++; sumI += +f[ii]; if (f[ri] === '') blanks++; }
    out.rec = { n, meanI: sumI / n, blanks };
    out.numeric = M_.numericColsOf(L);
    M_.openStats(L, { run: true, cfg: { cols: ['intensity'] } });
    const el = await new Promise((res) => { const t2 = setInterval(() => { for (const w of document.querySelectorAll('.fwin')) if (w._statsRows) { clearInterval(t2); res(w); } }, 100); setTimeout(() => res(null), 15000); });
    const row = el && el._statsRows.find((x) => /intensity/.test(JSON.stringify(x)));
    out.stats = row ? { n: row.n ?? row.count, mean: row.mean } : null;
    // a cloud as the samples of a pairing (a block model under it)
    const rows = ['XC,YC,ZC,AU']; for (let k = 0; k < 2; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) rows.push(`${1002.5 + i * 5},${2002.5 + j * 5},${100.5 + 2 * k},${i}`);
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'add');
    const M = M_.layers().find((q) => q.id === mid);
    const pr = await M_.pairBlocksSamples(M, L, { blockCol: 'AU', sampleCol: 'intensity' });
    out.pair = { n: pr.n, outside: pr.outside };
    return out;
  }, las);
  chk(`clouds as tables: ${JSON.stringify(r.h)}`, r.h && r.h.kind === 'cloud' && /^x,y,z$/i.test(r.h.map) && r.h.refl);
  chk(`clouds as tables: records stream (${r.rec.n}, mean intensity ${r.rec.meanI}), the no-data reflectance blank (${r.rec.blanks}); numeric columns ${r.numeric.length}`, r.rec.n === 400 && r.rec.meanI === 950 && r.rec.blanks === 1 && r.numeric.includes('intensity') && !r.numeric.some((c) => /^[xyz]$/i.test(c)));
  chk(`clouds in the stats window: intensity over ${r.stats && r.stats.n} points, mean ${r.stats && r.stats.mean}`, r.stats && r.stats.n === 400 && Math.abs(r.stats.mean - 950) < 1e-9);
  chk(`clouds as pairing samples: ${r.pair.n} points paired, ${r.pair.outside} outside the model`, r.pair.n === 400 && r.pair.outside === 0);
  await p.close();
}

// ── §89: GPU RESTORE — the context is lost and restored (WEBGL_lose_context):
//     the session comes back on a fresh renderer as a project reopen brings it —
//     the model with its colour, calc column, filter and selection, its view with
//     its offset, a drillhole set with its collars — the view draws again, picks
//     work, and there is still no project (nothing was written anywhere). ──
if (take()) {
  const p = await mkPage('sm2gpu');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro, out = {};
    const rows = ['XC,YC,ZC,AU,ROCK'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) rows.push(`${1005 + i * 10},${2005 + j * 10},${105 + k * 10},${i + j},${i < 6 ? 'ox' : 'fr'}`);
    const mid = await M_.openBlob(new File([rows.join('\n') + '\n'], 'model.csv'), 'model.csv', 'replace');
    await W.setColorBy(mid, 'AU');
    const M = M_.layers().find((q) => q.id === mid);
    M_.applyCalcCols ? null : null;
    await W.filter(mid, 'AU > 10');
    W.select(mid, [0, 1, 2, 3, 4]);
    const vid = await W.addView(mid, { color: 'ROCK', offset: [200, 0, 0] });
    const collar = 'HOLEID,EAST,NORTH,RL\nA,1030,2030,150\nB,1080,2080,150\n', survey = 'HOLEID,DEPTH,AZIMUTH,DIP\nA,0,0,-90\nB,0,0,-90\n';
    const iv = ['HOLEID,FROM,TO,AU']; for (const h of ['A', 'B']) for (let d = 0; d < 40; d += 2) iv.push(`${h},${d},${d + 2},${d / 4}`);
    await M_.importDrillholes({ collar: new File([collar], 'collars.csv'), survey: new File([survey], 'survey.csv'), intervals: new File([iv.join('\n') + '\n'], 'assay.csv') }, {}, 'add');
    const nd = M_.layerTree().find((n) => n.group && n.dhSet);
    if (nd) await M_.showCollars(nd);
    const summary = () => M_.layers().map((L) => `${L.name}|${L.viewOf != null ? 'view' : ''}|${W.layer(L.id) ? W.layer(L.id).colorBy : ''}|${L._filterMask ? L._filterMask.reduce((a, b) => a + b, 0) : ''}|${L._selCount || ''}|${L.offset ? L.offset.join(',') : ''}`).sort();
    out.before = summary();
    const R0 = M_.renderer;
    const ext = R0.gl.getExtension('WEBGL_lose_context');
    const cv = document.querySelector('#cv');
    const lost = new Promise((res) => cv.addEventListener('webglcontextlost', res, { once: true }));
    ext.loseContext();
    await lost;
    await new Promise((res) => setTimeout(res, 300));
    out.bar = !!document.querySelector('#glLost');
    ext.restoreContext();
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !/rebuilt/.test(document.querySelector('#meta').textContent)) await new Promise((res) => setTimeout(res, 100));
    out.meta = document.querySelector('#meta').textContent;
    out.fresh = M_.renderer !== R0 && !M_.renderer.gl.isContextLost();
    out.after = summary();
    out.barGone = !document.querySelector('#glLost');
    out.project = M_.project();
    // it draws: a snapshot with the model in it
    const m2 = M_.layers().find((q) => q.name === 'model.csv' && q.viewOf == null);
    M_.cam.fit(M_.renderer.contentBbox({ layers: [m2.id] })); M_.cam.update();
    const b = await W.snapshot({ decorations: false });
    const bm = await createImageBitmap(b), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data, bg = [d[0], d[1], d[2]];
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) lit++;
    out.lit = lit / (d.length / 4);
    return out;
  });
  chk(`gpu restore: the bar shows while the graphics are gone (${r.bar}); after the restore “${r.meta}”, a fresh renderer (${r.fresh}), the bar gone (${r.barGone})`, r.bar && /rebuilt/.test(r.meta) && r.fresh && r.barGone);
  chk(`gpu restore: every layer back as it was (${r.after.length} layers)\n      before ${JSON.stringify(r.before)}\n      after  ${JSON.stringify(r.after)}`, JSON.stringify(r.after) === JSON.stringify(r.before) && r.after.length >= 4);
  chk(`gpu restore: the model draws again (${(100 * r.lit).toFixed(1)}% of the picture) and there is still no project (${JSON.stringify(r.project)})`, r.lit > 0.05 && r.project == null);
  // with a project folder: it stays the session's project, marked unsaved, and a save still lands there
  await saveProject(p);
  const q = await p.evaluate(async () => {
    const M_ = window._micro;
    const ext = M_.renderer.gl.getExtension('WEBGL_lose_context'), cv = document.querySelector('#cv');
    const lost = new Promise((res) => cv.addEventListener('webglcontextlost', res, { once: true }));
    ext.loseContext(); await lost; await new Promise((res) => setTimeout(res, 300));
    document.querySelector('#meta').textContent = '';
    ext.restoreContext();
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !/rebuilt/.test(document.querySelector('#meta').textContent)) await new Promise((res) => setTimeout(res, 100));
    const pr = M_.project();
    return { name: pr && pr.name, dirty: pr && pr.dirty, n: M_.layers().length };
  });
  await saveProject(p);
  const q2 = await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2gpu'); await window._micro.openProjectDir(dir); return window._micro.layers().length; });
  chk(`gpu restore: with a project open it stays the project (${q.name}, unsaved ${q.dirty}, ${q.n} layers) and a save + reopen from the folder brings back ${q2} layers`, q.name === 'sm2gpu' && q.dirty === true && q.n === q2 && q2 >= 4);
  await p.close();
}

// ── §90: GRADE SHELLS — marching tetrahedra on the block lattice. A spherical
//     grade field (AU = 100 − distance) at a cutoff of 30 gives a closed shell of
//     radius ≈ 70: every edge shared by exactly two triangles, all facing out
//     (positive volume ≈ 4/3·π·70³), every vertex ≈ 70 m from the centre. A field
//     rising with z, cut at 200, closes against the model's own faces: the 300 × 300
//     × 100 box to its block faces (corners chamfered a little by the tetrahedra). The shell opens as a mesh layer with its lineage. ──
if (take()) {
  const p = await mkPage('sm2shell');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const check = (m) => {
      const V = m.vertices, T = m.triangles, edges = new Map();
      let vol = 0;
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t], b = T[t + 1], c = T[t + 2];
        for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u},${v}` : `${v},${u}`; edges.set(k, (edges.get(k) || 0) + 1); }
        const ax = V[3 * a], ay = V[3 * a + 1], az = V[3 * a + 2], bx = V[3 * b], by = V[3 * b + 1], bz = V[3 * b + 2], cx = V[3 * c], cy = V[3 * c + 1], cz = V[3 * c + 2];
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      let open = 0; for (const n of edges.values()) if (n !== 2) open++;
      return { tris: T.length / 3, open, vol };
    };
    const rows = ['XC,YC,ZC,AU,ZV'];
    for (let k = 0; k < 30; k++) for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) {
      const x = 5 + i * 10, y = 5 + j * 10, z = 5 + k * 10;
      rows.push(`${x},${y},${z},${(100 - Math.hypot(x - 150, y - 150, z - 150)).toFixed(4)},${z}`);
    }
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'sphere.csv'), 'sphere.csv', 'replace');
    const L = M_.layers().find((q) => q.id === id);
    const fd = await M_.readField(L, 'AU');
    const s = M_.contourField(fd, 30);
    const cs = check(s);
    let dmin = Infinity, dmax = 0;
    for (let v = 0; v < s.vertices.length; v += 3) { const d = Math.hypot(s.vertices[v] - 150, s.vertices[v + 1] - 150, s.vertices[v + 2] - 150); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    out.sphere = { ...cs, ratio: cs.vol / (4 / 3 * Math.PI * 70 ** 3), dmin, dmax, inside: s.blocksInside };
    const b = M_.contourField(await M_.readField(L, 'ZV'), 200);
    out.box = check(b);
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < b.vertices.length; v += 3) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], b.vertices[v + a]); bb[a + 3] = Math.max(bb[a + 3], b.vertices[v + a]); }
    out.box.bb = bb;
    const res = await M_.gradeShell(L, { col: 'AU', cutoff: 30 });
    const NL = M_.layers().find((q) => q.id === res.id);
    out.layer = { kind: NL && NL.kind, label: NL && NL.label, lineage: NL && NL.lineage && NL.lineage.op, tris: res.triangles };
    return out;
  });
  const s = r.sphere;
  chk(`grade shell: a sphere's shell is closed (${s.tris} triangles, ${s.open} open edges) and faces out (volume ${(s.ratio * 100).toFixed(1)}% of 4/3·π·70³)`, s.open === 0 && s.ratio > 0.97 && s.ratio < 1.03);
  chk(`grade shell: every vertex on the 70 m contour (${s.dmin.toFixed(2)}–${s.dmax.toFixed(2)} m) around ${s.inside} blocks`, s.dmin > 68.5 && s.dmax < 71.5);
  chk(`grade shell: a field cut at the model's edge closes on the block faces — the box ${JSON.stringify(r.box.bb)}, ${r.box.vol.toFixed(0)} m³ of 9,000,000 (${r.box.open} open edges)`, r.box.open === 0 && JSON.stringify(r.box.bb) === '[0,0,200,300,300,300]' && Math.abs(r.box.vol - 9e6) / 9e6 < 0.005);
  chk(`grade shell: a mesh layer “${r.layer.label}” (${r.layer.kind}, ${r.layer.tris} triangles, lineage ${r.layer.lineage})`, r.layer.kind === 'mesh' && /AU ≥ 30 shell/.test(r.layer.label) && r.layer.lineage === 'shell');
  await p.close();
}

// ── §91: PT-BR — the interface language switches live: the menubar and toolbar
//     (static chrome), a window's title, a menu's labels (with a live value in
//     them), Settings, and the palette — shown in Portuguese and searched in both
//     languages; back to English restores every original exactly. ──
if (take()) {
  const p = await mkPage('sm2lang');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU']; for (let k = 0; k < 2; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${i}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
    const chrome = () => document.body.innerText;
    const enBefore = { file: /\bFile\b/.test(chrome()), color: !!document.querySelector('#colorBy') };
    const els = [...document.querySelectorAll('[title], [placeholder]')].filter((e) => !e.closest('#meta, #stats, .fwin'));
    const texts = []; { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.parentElement && !n.parentElement.closest('#meta, #stats, .fwin, script, style') && n.nodeValue.trim()) texts.push(n); }
    const snapshot = () => els.map((e) => `${e.getAttribute('title')}|${e.getAttribute('placeholder')}`).join('\n') + '##' + texts.map((n) => n.nodeValue).join('\n');
    const s0 = snapshot();
    M_.setLang('pt');
    out.pt = { arquivo: /\bArquivo\b/.test(chrome()), dados: /\bDados\b/.test(chrome()), lang: M_.lang() };
    const w = await M_.openModelQa(M_.layers().find((q) => q.id === id));
    out.pt.win = w.win.el.querySelector('.fwin-head .t').textContent;
    w.win.close();
    // a menu, with a live value in a label
    M_.groupMenu ? null : null;
    const { t } = await import('/tools/micro/src/i18n.js');
    out.pt.labels = [t('Grade shell…'), t('Opacity (100%)'), t('✓ follow the section'), t('model QA · m.csv'), t('nothing in the catalog')];
    // the palette: Portuguese shown, both languages searched
    M_.openPalette();
    const pal = document.querySelector('#palInput');
    const list = () => [...document.querySelectorAll('#palList .pal-t')].map((e) => e.textContent);
    pal.value = 'envoltória'; pal.dispatchEvent(new Event('input')); out.pt.palPt = list().slice(0, 3);
    pal.value = 'grade shell'; pal.dispatchEvent(new Event('input')); out.pt.palEn = list().slice(0, 3);
    out.pt.placeholder = pal.placeholder;
    M_.closePalette();
    M_.setLang('en');
    out.en = { file: /\bFile\b/.test(chrome()), same: snapshot() === s0, lang: M_.lang() };
    out.enBefore = enBefore;
    return out;
  });
  chk(`pt-BR: the menubar reads Arquivo / Dados (${r.pt.arquivo}, ${r.pt.dabos ?? r.pt.dados}), html lang ${r.pt.lang}; a window title “${r.pt.win}”`, r.pt.arquivo && r.pt.dados && r.pt.lang === 'pt-BR' && /^QA do modelo · m\.csv$/.test(r.pt.win));
  chk(`pt-BR: labels ${JSON.stringify(r.pt.labels)}`, JSON.stringify(r.pt.labels) === JSON.stringify(['Envoltória de teor…', 'Opacidade (100%)', '✓ seguir a seção', 'QA do modelo · m.csv', 'nothing in the catalog']));
  chk(`pt-BR: the palette shows Portuguese and finds it in both languages (“envoltória” → ${JSON.stringify(r.pt.palPt)}; “grade shell” → ${JSON.stringify(r.pt.palEn)}); “${r.pt.placeholder}”`,
    r.pt.palPt.includes('Envoltória de teor…') && r.pt.palEn.includes('Envoltória de teor…') && /^Digite um comando/.test(r.pt.placeholder));
  chk(`pt-BR: back to English restores every original exactly (${r.en.same}, lang ${r.en.lang})`, r.en.file && r.en.same && r.en.lang === 'en' && r.enBefore.file);
  // a browser in Portuguese: English until asked, with a one-line offer on the start screen
  {
    const c2 = await b.newContext({ locale: 'pt-BR', viewport: { width: 1100, height: 750 } });
    await c2.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
    const p2 = await c2.newPage();
    await p2.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window._micro, null, { timeout: 20000 });
    const o = await p2.evaluate(() => ({ lang: window._micro.lang(), offer: !!document.querySelector('#empty .lang-offer'), text: document.querySelector('#empty .lang-offer') && document.querySelector('#empty .lang-offer').textContent }));
    await p2.evaluate(() => document.querySelector('#empty .lang-offer button').click());
    const o2 = await p2.evaluate(() => ({ lang: window._micro.lang(), stored: localStorage.getItem('micro.lang'), gone: !document.querySelector('.lang-offer'), arquivo: /\bArquivo\b/.test(document.body.innerText) }));
    await c2.close();
    chk(`pt-BR: a Portuguese browser stays in English (${o.lang}) with an offer (“${o.text}”); taking it switches (${o2.lang}, stored ${o2.stored}, menubar Arquivo ${o2.arquivo})`, o.lang === 'en' && o.offer && o2.lang === 'pt-BR' && o2.stored === 'pt' && o2.gone && o2.arquivo);
  }
  await p.close();
}

// ── §92: STYLING — the class model and what reads it (the 2026-11-21 styling review). A class
//     colour belongs to its INTERVAL over the full break list, so a clip never re-deals the
//     colours; the figure legend draws what the model draws (classes as swatches, '< 20' ·
//     '≥ 65', in the classed LUT's colours) and follows the colour mode; typed breaks keep each
//     colour with its class and undo; the clip travels with the colour-by (FE's 40–65 doesn't
//     flatten SG); an inverted clip isn't applied. ──
if (take()) {
  const p = await mkPage('sm2style');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,FE,SG,LITO'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(10 + (i * 10 + j) * 0.55).toFixed(2)},${(2.8 + (i + j) * 0.08).toFixed(2)},${i < 5 ? 'OX' : 'SUL'}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'st.csv'), 'st.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    M_.setActiveLayer(id);
    const h = M_.layerTableHeader(L), fe = `chan:${h.columns.indexOf('FE')}`, sg = `chan:${h.columns.indexOf('SG')}`;
    await M_.setLayerColorSel(L, fe);
    const ramp = await window._micro.mod('ramp.js'), deco = await window._micro.mod('deco.js');
    const { undoLast } = await window._micro.mod('undo.js');
    const COLS = ['#3b4cc0', '#7aa5f8', '#c9d7f0', '#f7b89c', '#e8694f', '#b40426'];
    M_.setRampCfg(L, { classed: true, breaks: [20, 40, 55, 60, 65], colors: COLS.slice() });
    const lutAt = (v) => { const [lo, hi] = M_.rampRangeFor(L), px = M_.bakeRampPixels(ramp.rampCfgOf(L), lo, hi), t = Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255) * 4; return '#' + [px[t], px[t + 1], px[t + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''); };
    out.before = [30, 50, 57, 62].map(lutAt);
    L.clip = ['40', '66']; document.querySelector('#clipMin').value = '40'; document.querySelector('#clipMax').value = '66';
    out.withClip = [50, 57, 62].map(lutAt);
    // the legend: one swatch per class over the FULL list, labelled, in the same colours
    M_.setLayerLegend(L, true);
    const spec = deco.legendSpec(L);
    out.legend = { kind: spec && spec.kind, labels: spec && spec.entries.map((e) => e.label), colors: spec && spec.entries.map((e) => e.color) };
    // typed breaks through the pane keep colours with their classes, and undo
    L.clip = ['', '']; document.querySelector('#clipMin').value = ''; document.querySelector('#clipMax').value = '';
    (await window._micro.mod('props.js')).setPropTab('style');   // an earlier section may have left another tab remembered
    M_.openProps();
    const bIn = [...document.querySelectorAll('#ppBody .pp-row')].find((x) => /breaks/.test(x.textContent)).querySelector('input');
    bIn.value = '20, 40, 54, 60, 65'; bIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    out.edited = { breaks: ramp.rampCfgOf(L).breaks.slice(), colors: (ramp.rampCfgOf(L).colors || []).slice() };
    out.rows = [...document.querySelectorAll('#ppBody .pp-band')].length;
    await undoLast();
    out.undone = { breaks: ramp.rampCfgOf(L).breaks.slice(), colors: (ramp.rampCfgOf(L).colors || []).slice() };
    // the clip travels with the colour-by
    L.clip = ['40', '65']; document.querySelector('#clipMin').value = '40'; document.querySelector('#clipMax').value = '65';
    await M_.setLayerColorSel(L, sg);
    out.sgClip = L.clip.slice();
    await M_.setLayerColorSel(L, fe);
    out.feClip = L.clip.slice();
    // an inverted clip typed in the toolbar isn't applied
    const mn = document.querySelector('#clipMin'), mx = document.querySelector('#clipMax');
    mn.value = '65'; mx.value = '40'; mx.dispatchEvent(new Event('input'));
    out.inverted = { clip: L.clip.slice(), meta: document.querySelector('#meta').textContent };
    mx.dispatchEvent(new Event('change'));
    out.swapped = L.clip.slice();
    // the legend follows the MODE: categories (by label), rules (by rule name)
    await M_.setLayerColorSel(L, 'cat');
    const cs = deco.legendSpec(L);
    out.catLegend = cs && cs.entries.map((e) => e.label);
    L.rules = { list: [{ name: 'ore', expr: 'FE >= 55', color: '#ff0000' }], elseColor: '#555a5f' };
    await M_.setLayerColorSel(L, 'rules');
    const rs = deco.legendSpec(L);
    out.ruleLegend = rs && rs.entries.map((e) => e.label);
    return out;
  });
  chk(`STYLE: a clip doesn't re-deal class colours (FE 50/57/62: ${r.before.slice(1).join(' ')} → ${r.withClip.join(' ')})`, JSON.stringify(r.before.slice(1)) === JSON.stringify(r.withClip));
  chk(`STYLE: the legend draws the classes over the full break list (${JSON.stringify(r.legend.labels)})`,
    r.legend.kind === 'classes' && JSON.stringify(r.legend.labels) === JSON.stringify(['< 20', '20 – 40', '40 – 55', '55 – 60', '60 – 65', '≥ 65']) && r.legend.colors[2] === '#c9d7f0' && r.legend.colors[5] === '#b40426');
  chk(`STYLE: typed breaks keep each colour with its class (55→54: ${JSON.stringify(r.edited.colors)}, ${r.rows} class rows) and undo restores (${JSON.stringify(r.undone.breaks)})`,
    JSON.stringify(r.edited.breaks) === JSON.stringify([20, 40, 54, 60, 65]) && JSON.stringify(r.edited.colors) === JSON.stringify(['#3b4cc0', '#7aa5f8', '#c9d7f0', '#f7b89c', '#e8694f', '#b40426']) && r.rows === 6
    && JSON.stringify(r.undone.breaks) === JSON.stringify([20, 40, 55, 60, 65]));
  chk(`STYLE: the clip travels with the colour-by (SG ${JSON.stringify(r.sgClip)}, back to FE ${JSON.stringify(r.feClip)})`, JSON.stringify(r.sgClip) === '["",""]' && JSON.stringify(r.feClip) === '["40","65"]');
  chk(`STYLE: an inverted clip isn't applied (${JSON.stringify(r.inverted.clip)}, “${r.inverted.meta.slice(0, 40)}…”) and swaps on commit (${JSON.stringify(r.swapped)})`,
    JSON.stringify(r.inverted.clip) === '["40","65"]' && /above max/.test(r.inverted.meta) && JSON.stringify(r.swapped) === '["40","65"]');
  chk(`STYLE: the legend follows the mode — categories ${JSON.stringify(r.catLegend)}, rules ${JSON.stringify(r.ruleLegend)}`,
    JSON.stringify(r.catLegend) === '["OX","SUL"]' && JSON.stringify(r.ruleLegend) === '["ore","everything else"]');
  await p.close();
}

// ── §93: STYLE TRAVELS BY NAME — Copy style / Paste style (src/style-clip.js): the model's
//     FE classes onto a second model whose FE sits in ANOTHER column position, with the
//     colour-by, the clip and the category legend matched by name; one undo step; a saved
//     style round-trips; a category legend only lands on a same-named category column. ──
if (take()) {
  const p = await mkPage('sm2stylecp');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const mk = (hdr, row) => { const rows = [hdr]; for (let k = 0; k < 3; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) rows.push(row(i, j, k)); return rows.join('\n') + '\n'; };
    const fe = (i, j) => (12 + (i * 8 + j) * 0.85).toFixed(2), sg = (i, j) => (2.8 + (i + j) * 0.1).toFixed(2);
    const a = await M_.openBlob(new File([mk('XC,YC,ZC,FE,SG,LITO', (i, j, k) => `${5 + i * 10},${5 + j * 10},${5 + k * 10},${fe(i, j)},${sg(i, j)},${i < 4 ? 'OX' : 'SUL'}`)], 'a.csv'), 'a.csv', 'replace');
    const b = await M_.openBlob(new File([mk('XC,YC,ZC,SG,FE,LITO', (i, j, k) => `${105 + i * 10},${5 + j * 10},${5 + k * 10},${sg(i, j)},${fe(i, j)},${j < 4 ? 'OX' : 'SUL'}`)], 'b.csv'), 'b.csv', 'add');
    const A = M_.layers().find((x) => x.id === a), B = M_.layers().find((x) => x.id === b);
    const { rampCfgOf } = await window._micro.mod('ramp.js');
    const { undoLast } = await window._micro.mod('undo.js');
    const { parseStyle } = await window._micro.mod('style-clip.js');
    M_.setActiveLayer(a);
    const ha = M_.layerTableHeader(A);
    await M_.setLayerColorSel(A, `chan:${ha.columns.indexOf('FE')}`);
    M_.setRampCfg(A, { classed: true, breaks: [20, 40, 55, 60, 65], colors: ['#3b4cc0', '#7aa5f8', '#c9d7f0', '#f7b89c', '#e8694f', '#b40426'] });
    A.clip = ['15', '66']; document.querySelector('#clipMin').value = '15'; document.querySelector('#clipMax').value = '66';
    const st = await M_.copyStyle(A);
    out.keys = Object.keys(st.ramps);
    out.json = JSON.stringify(st).length;
    // paste onto B (FE in column 4)
    M_.setActiveLayer(b);
    const hb = M_.layerTableHeader(B);
    out.beforeB = String(B.colorSel);
    const res = await M_.pasteStyle(B);
    out.applied = res && res.applied;
    out.selB = String(B.colorSel); out.feB = `chan:${hb.columns.indexOf('FE')}`;
    const cb = rampCfgOf(B);
    out.cfgB = cb && { classed: cb.classed, breaks: cb.breaks, c2: cb.colors && cb.colors[2] };
    out.clipB = B.clip.slice();
    await undoLast();
    out.undoneSel = String(B.colorSel); out.undoneCfg = !!(rampCfgOf(B) && rampCfgOf(B).classed);
    // a saved style (the JSON) round-trips through applyStyle
    const back = parseStyle(JSON.stringify(st));
    const res2 = await M_.applyStyle(B, back);
    out.roundTrip = { ok: !!back, sel: String(B.colorSel), classed: !!(rampCfgOf(B) && rampCfgOf(B).classed) };
    // a category legend: only onto a same-named category column
    await M_.setLayerColorSel(A, 'cat');
    const st2 = M_.captureStyle(A);
    st2.catLegend = { col: 'DOMAIN', entries: [{ label: 'x', values: ['OX'], color: '#ff0000' }], otherColor: '#555a5f' };
    const res3 = await M_.applyStyle(B, st2);
    out.catSkipped = res3.skipped.join(' | ');
    return out;
  });
  chk(`STYLE COPY: the style names columns, not positions (${JSON.stringify(r.keys)}, ${r.json} B of JSON)`, r.keys.includes('col:FE') && !r.keys.some((k) => k.startsWith('chan:')));
  chk(`STYLE PASTE: onto a model with FE in another column — coloured by its FE (${r.selB} = ${r.feB}), the same classes (${JSON.stringify(r.cfgB)}) and clip (${JSON.stringify(r.clipB)}); applied ${JSON.stringify(r.applied)}`,
    r.selB === r.feB && r.cfgB && r.cfgB.classed && JSON.stringify(r.cfgB.breaks) === '[20,40,55,60,65]' && r.cfgB.c2 === '#c9d7f0' && JSON.stringify(r.clipB) === '["15","66"]');
  chk(`STYLE PASTE: one undo step restores the layer's own look (colour-by ${r.undoneSel}, classed ${r.undoneCfg})`, r.undoneSel === r.beforeB && !r.undoneCfg);
  chk(`STYLE FILE: a saved style round-trips (${JSON.stringify(r.roundTrip)})`, r.roundTrip.ok && r.roundTrip.sel === r.feB && r.roundTrip.classed);
  chk(`STYLE PASTE: a category legend only lands on a same-named column (“${r.catSkipped.slice(0, 90)}”)`, /classes of DOMAIN/.test(r.catSkipped));
  await p.close();
}

// ── §94: NO DATA and CLASS EYES — a blank value has its own colour (the renderer gets micro's
//     grey on open; the legend lists "no data"; hide culls blanks); a sentinel (−99) is a
//     number until the column says it means blank (Detection limits & blanks → values that
//     mean blank), then it leaves the range; a class's eye bakes alpha 0 into the ramp and the
//     renderer knows the layer hides by value (so the pick pass culls it too). ──
if (take()) {
  const p = await mkPage('sm2nodata');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,FE'];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${i === 0 ? '' : i === 1 ? '-99' : (20 + i * 5).toFixed(1)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'nd.csv'), 'nd.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    M_.setActiveLayer(id);
    const h = M_.layerTableHeader(L), fe = h.columns.indexOf('FE');
    await M_.setLayerColorSel(L, `chan:${fe}`);
    const ramp = await window._micro.mod('ramp.js'), deco = await window._micro.mod('deco.js'), ct = await window._micro.mod('coltypes.js');
    out.vs0 = M_.renderer.layerValueState(id);
    out.range0 = M_.renderer.layerChanRange(id);
    // the sentinel means blank: the range loses −99
    await ct.setColumnQualify(L, fe, { below: 'half', above: 'limit', negBelow: false, blanks: [-99] });
    out.range1 = M_.renderer.layerChanRange(M_.layers().find((x) => x.name === 'nd.csv').id);
    const L2 = M_.layers().find((x) => x.name === 'nd.csv');
    out.policy = L2.qualify && L2.qualify.FE;
    // the legend lists "no data" once the scan knows there are blanks
    await M_.scanColumns(L2, null, { columns: ['FE'] });
    M_.setRampCfg(L2, { classed: true, breaks: [40, 55], colors: ['#3b4cc0', '#c9d7f0', '#b40426'] });
    M_.setLayerLegend(L2, true);
    const sp = deco.legendSpec(L2);
    out.legend = sp && sp.entries.map((e) => e.label).concat(sp.tail ? [sp.tail.label] : []);
    out.nulls = L2._colStats && L2._colStats.FE && L2._colStats.FE.nulls;
    // a class's eye: alpha 0 in the LUT, the renderer knows the layer hides by value
    const c = ramp.rampCfgOf(L2); c.hide = [true, null, null]; ramp.applyRamp(L2, true);
    const [lo, hi] = M_.rampRangeFor(L2), px = M_.bakeRampPixels(c, lo, hi);
    out.alphaLow = px[3]; out.alphaHigh = px[255 * 4 + 3];
    out.vs1 = M_.renderer.layerValueState(L2.id);
    out.legendHidden = deco.legendSpec(L2).entries.map((e) => e.label);
    // hide blanks: the renderer's no-data alpha goes to 0
    L2.noData = { color: '#555a5f', hide: true }; ramp.syncNoData(L2);
    out.vs2 = M_.renderer.layerValueState(L2.id);
    return out;
  });
  chk(`NO DATA: a new layer's blanks draw in micro's grey (renderer ${JSON.stringify(r.vs0)})`, r.vs0 && r.vs0.noData && Math.abs(r.vs0.noData[0] - 0x55 / 255) < 1e-6 && r.vs0.noData[3] === 1);
  chk(`NO DATA: −99 is a number (range ${JSON.stringify(r.range0)}) until the column says it means blank (${JSON.stringify(r.policy)} → ${JSON.stringify(r.range1)})`,
    r.range0 && r.range0[0] === -99 && r.range1 && r.range1[0] > 0 && JSON.stringify(r.policy.blanks) === '[-99]');
  chk(`NO DATA: the legend lists the classes and "no data" (${JSON.stringify(r.legend)}, ${r.nulls} blank)`, JSON.stringify(r.legend) === '["< 40","40 – 55","≥ 55","no data"]' && r.nulls >= 60);
  chk(`CLASS EYE: a hidden class bakes alpha 0 (${r.alphaLow}; top ${r.alphaHigh}), the renderer hides by value (${JSON.stringify(r.vs1)}), the legend leaves it out (${JSON.stringify(r.legendHidden)})`,
    r.alphaLow === 0 && r.alphaHigh === 255 && r.vs1.rampHides === true && !r.legendHidden.includes('< 40'));
  chk(`NO DATA: hide → the renderer culls blanks (alpha ${r.vs2.noData[3]})`, r.vs2.noData[3] === 0);
  await p.close();
}

// ── §95: COMPOSER (src/composer.js on @gcu/compo) — a page with frames. A 3D-view frame renders
//     at ITS size and aspect (not the canvas's), remembers its scene, and states its scale per
//     image pixel so a scale bar stays true when the frame is resized; legends come from the
//     layers' own legend specs; "show in view" puts the scene back; the PDF re-renders the view at
//     the print dpi and gives the user's view back; an analysis plot arrives as an image frame;
//     figures save as figures/<name>.compo.json and come back with the project. ──
if (take()) {
  let p = await mkPage('sm2compo');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,FE'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(20 + i * 2).toFixed(1)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'cmp.csv'), 'cmp.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    M_.setActiveLayer(id);
    await M_.setLayerColorSel(L, `chan:${M_.layerTableHeader(L).columns.indexOf('FE')}`);
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    await new Promise((res) => setTimeout(res, 200));
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('fig A');
    const f = M_.addViewFrame(ed);
    out.box = f.box.slice(); out.px = [f.content.width, f.content.height]; out.meta = f.content.meta;
    out.srcJpeg = /^data:image\/jpeg/.test(f.content.src || '');
    // the frame's picture is the model, not a blank: count non-background pixels
    const g = f._img.getContext('2d'), d = g.getImageData(0, 0, f._img.width, f._img.height).data, bg = [d[0], d[1], d[2]];
    let diff = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) diff++;
    out.inked = diff / (d.length / 4);
    // legends and a scale bar, tied to the view frame
    ed.select([f.id]);
    document.querySelector('.compo-bar button[aria-label="Add legend"]').click();
    document.querySelector('.compo-bar button[aria-label="Add scale bar"]').click();
    document.querySelector('.compo-bar button[aria-label="Add north arrow"]').click();
    const doc = ed.getDoc();
    const leg = doc.frames.find((x) => x.kind === 'legend'), sb = doc.frames.find((x) => x.kind === 'scalebar'), nth = doc.frames.find((x) => x.kind === 'north');
    out.legend = leg && { title: leg.content.title, kind: leg.content.kind, stops: (leg.content.stops || []).length, lo: leg.content.loLabel, hi: leg.content.hiLabel };
    out.sbOf = sb && sb.content.of === f.id; out.northOf = nth && nth.content.of === f.id;
    // the scale follows the frame: half the width → twice the world per mm
    const vf = () => ed.getDoc().frames.find((x) => x.id === f.id);
    out.wpm0 = C.frameWorldPerMm(vf());
    ed.update(f.id, (fr) => { fr.box[2] /= 2; fr.box[3] /= 2; });
    out.wpm1 = C.frameWorldPerMm(vf());
    ed.update(f.id, (fr) => { fr.box[2] *= 2; fr.box[3] *= 2; });
    // move the camera, then put the frame's scene back
    await window.micro.setView({ look: 90, elevation: 30, ortho: false });
    out.lookMoved = Math.round(window.micro.view().look);
    await M_.applyScene(vf().source.scene);
    const cw = window.micro.view(); out.lookBack = Math.round(cw.look); out.orthoBack = cw.ortho;
    // export: the view re-rendered at 150 dpi, the user's view back afterwards
    await window.micro.setView({ look: 45, elevation: 40, ortho: false });
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 150, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    out.pdf = { head: s.slice(0, 5), jpeg: s.includes('/DCTDecode'), kb: Math.round(bytes.length / 1024) };
    const im = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)/.exec(s);
    out.pdfImg = im ? [+im[1], +im[2]] : null;
    out.pdfText = ['FE', 'N'].filter((t) => s.includes(`(${t})`) || s.includes(` ${t})`));   // a whole string, or one ending in it (the legend's “layer · FE”)
    out.lookAfter = Math.round(window.micro.view().look);
    // an analysis plot → an image frame
    const pc = document.createElement('canvas'); pc.width = 300; pc.height = 200; pc.getContext('2d').fillRect(0, 0, 300, 200);
    dispatchEvent(new CustomEvent('micro:to-composer', { detail: { canvas: pc, name: 'gt-cmp' } }));
    const plotF = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'plot');
    out.plot = plotF && { png: /^data:image\/png/.test(plotF.content.src), aspect: +(plotF.box[2] / plotF.box[3]).toFixed(2) };
    out.nFrames = ed.getDoc().frames.length;
    return out;
  });
  const want = [Math.round(r.box[2] * 6), Math.round(r.box[3] * 6)];
  chk(`COMPOSER: a view frame renders at its own size (${r.px} px for ${r.box[2]}×${r.box[3]} mm at 6 px/mm), inked ${(r.inked * 100).toFixed(0)}%, kept as JPEG`, r.px[0] === want[0] && r.px[1] === want[1] && r.inked > 0.05 && r.srcJpeg);
  chk(`COMPOSER: a plan ortho view states its scale per pixel + north up (${JSON.stringify(r.meta)})`, r.meta.worldPerPx > 0 && r.meta.ortho && Math.abs(r.meta.north) < 1);
  chk(`COMPOSER: the legend is the layer's (${JSON.stringify(r.legend)}); scale bar + north refer to the view frame`, r.legend && / · FE$/.test(r.legend.title) && r.legend.kind === 'ramp' && r.legend.stops === 32 && r.sbOf && r.northOf);
  chk(`COMPOSER: the scale follows the frame (${r.wpm0 && r.wpm0.toFixed(3)} → ${r.wpm1 && r.wpm1.toFixed(3)} world/mm at half size)`, r.wpm0 > 0 && Math.abs(r.wpm1 / r.wpm0 - 2) < 1e-6);
  chk(`COMPOSER: "show in view" puts the frame's camera back (look ${r.lookMoved} → ${r.lookBack}, ortho ${r.orthoBack})`, r.lookMoved === 90 && r.lookBack === 0 && r.orthoBack === true);
  const wantPdf = [Math.round(r.box[2] * 150 / 25.4), Math.round(r.box[3] * 150 / 25.4)];
  chk(`COMPOSER: the PDF re-renders the view at 150 dpi (${JSON.stringify(r.pdfImg)} vs ${wantPdf}), JPEG, text (${r.pdfText}), ${r.pdf.kb} KB`, r.pdf.head === '%PDF-' && r.pdf.jpeg && r.pdfImg && r.pdfImg[0] === wantPdf[0] && r.pdfImg[1] === wantPdf[1] && r.pdfText.includes('FE'));
  chk(`COMPOSER: export gives the user's view back (look ${r.lookAfter})`, r.lookAfter === 45);
  chk(`COMPOSER: a plot arrives as an image frame (${JSON.stringify(r.plot)})`, r.plot && r.plot.png && r.plot.aspect === 1.5);
  // a view's own PAPER and PROJECTION from its inspector: white paper re-renders it on white (kept as bgFixed);
  // "make perspective" / "make orthographic" flip the frame's camera and re-render it
  const pp = await p.evaluate(async () => {
    const M_ = window._micro, ed = M_.composerEditor(), wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const f = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view' && !x.source.keyFor);
    ed.select([f.id]); ed.render(); await wait(100);
    const ps = document.querySelector('.compo-insp .cmp-paper'); ps.value = '#ffffff'; ps.dispatchEvent(new Event('change', { bubbles: true }));
    for (let t = 0; t < 40; t++) { await wait(100); const fr = ed.getDoc().frames.find((x) => x.id === f.id); if (fr.source.bgFixed) break; }
    const fr = ed.getDoc().frames.find((x) => x.id === f.id), g = fr._img.getContext('2d'), c = g.getImageData(1, 1, 1, 1).data;
    const out = { bg: fr.source.bgFixed, corner: [c[0], c[1], c[2]] };
    const ob = () => document.querySelector('.compo-insp .cmp-ortho');
    out.label0 = ob().textContent; ob().click(); await wait(900); ed.render(); await wait(100);
    out.ortho1 = ed.getDoc().frames.find((x) => x.id === f.id).source.scene.camera.ortho; out.label1 = ob().textContent;
    ob().click(); await wait(900);
    out.ortho2 = ed.getDoc().frames.find((x) => x.id === f.id).source.scene.camera.ortho;
    return out;
  });
  chk(`COMPOSER: a view's own paper (${pp.bg}, corner ${pp.corner}) and projection (“${pp.label0}” → ortho ${pp.ortho1}, “${pp.label1}” → ortho ${pp.ortho2})`,
    pp.bg === '#ffffff' && pp.corner.every((v) => v > 245) && pp.label0 === 'make perspective' && pp.ortho1 === false && pp.label1 === 'make orthographic' && pp.ortho2 === true);
  await saveProject(p);
  const onDisk = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2compo');
    const fh = await (await dir.getDirectoryHandle('figures')).getFileHandle('fig_a.compo.json');
    const j = JSON.parse(await (await fh.getFile()).text());
    return { format: j.format, frames: j.frames.length, runtime: j.frames.some((f) => '_img' in f) };
  });
  chk(`COMPOSER: figures/fig_a.compo.json (${JSON.stringify(onDisk)})`, onDisk.format === 'compo' && onDisk.frames === r.nFrames && !onDisk.runtime);
  await p.close();
  p = await mkPage('sm2compo');
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2compo'); await window._micro.openProjectDir(dir); });
  await p.waitForFunction(() => window._micro.layers().length, null, { timeout: 60000 });
  const back = await p.evaluate(async () => {
    const M_ = window._micro, figs = M_.figures();
    const ed = M_.openComposer('fig A');
    await new Promise((res) => setTimeout(res, 300));
    const v = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view');
    return { names: figs.map((f) => f.name), frames: ed.getDoc().frames.length, decoded: !!(v && v._img && v._img.width > 0), overlay: document.querySelectorAll('.compo-fr').length };
  });
  chk(`COMPOSER: the figure comes back with the project, its view picture decoded (${JSON.stringify(back)})`, back.names.includes('fig A') && back.frames === r.nFrames && back.decoded && back.overlay === r.nFrames);
  await p.close();
}

// ── §96: THE ATLAS — one figure, a page per row. The composer's "atlas…" writes a starter routine:
//     an each over section levels with a `compo` step (the figure, the section at $level, the
//     level as a caption value, one `book` PDF). Running it renders each page with ITS section,
//     fills ${level} per page, numbers {page}/{pages} and {fig} on across the book, re-reads the
//     legend, writes atlas/<figure>.pdf, and puts the user's view back. An analysis window's
//     table arrives as a table frame beside its plot. ──
if (take()) {
  const p = await mkPage('sm2atlas');
  await p.evaluate(async () => {
    const M_ = window._micro, rows = ['XC,YC,ZC,AU'];
    for (let k = 0; k < 12; k++) for (let j = 0; j < 16; j++) for (let i = 0; i < 20; i++) { const dx = (i - 10) / 5, dy = (j - 8) / 4, dz = (k - 6) / 3; rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(3 * Math.exp(-(dx * dx + dy * dy + dz * dz))).toFixed(3)}`); }
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'atl.csv'), 'atl.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    await M_.setLayerColorSel(L, `chan:${M_.layerTableHeader(L).columns.indexOf('AU')}`);
  });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    const ed = M_.openComposer('levels');
    const f = M_.addViewFrame(ed);
    ed.addFrame({ kind: 'text', box: [f.box[0], f.box[1] + f.box[3] + 2, f.box[2], 10], content: { md: '**Figure {fig}.** Level ${level} m — page {page} of {pages}' } });
    ed.select([f.id]);
    document.querySelector('.compo-bar button[aria-label="Add legend"]').click();
    // the starter routine (not saved — run directly)
    const rt = await M_.makeAtlasRoutine(M_.currentFigure(), { save: false });
    const step = rt.params.steps[0];
    out.levels = step.each.level; out.book = step.steps[0].with.book; out.axis = step.steps[0].with.view.section.axis;
    rt.params.steps[0].steps[0].with.dpi = 96;
    rt.name = 'levels atlas';
    await window.micro.setView({ look: 33, elevation: 40, ortho: false });
    await M_.runRoutine(rt);
    out.lookAfter = Math.round(window.micro.view().look);
    out.meta = document.querySelector('#meta').textContent;
    // read the book back: inflate its streams, collect the text and the images
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2atlas');
    const parts = out.book.split('/');
    let h = dir; try { for (const seg of parts.slice(0, -1)) h = await h.getDirectoryHandle(seg); } catch (e) { return { fail: out.meta, tracker: [...document.querySelectorAll('.fwin')].map((w) => w.innerText.slice(0, 400)).join(' | ') }; }
    const bytes = new Uint8Array(await (await (await h.getFileHandle(parts.at(-1))).getFile()).arrayBuffer());
    const lat = new TextDecoder('latin1').decode(bytes);
    out.count = +(/\/Count (\d+)/.exec(lat) || [])[1];
    out.jpegs = (lat.match(/\/DCTDecode/g) || []).length;
    const imgLens = [...lat.matchAll(/\/Filter \/DCTDecode[^>]*\/Length (\d+)/g)].map((m) => +m[1]);
    out.distinctImgs = new Set(imgLens).size;
    let text = '';
    for (const m of lat.matchAll(/<<([^]*?)>>\s*stream\r?\n/g)) {
      if (!/FlateDecode/.test(m[1]) || /Image/.test(m[1])) continue;
      const len = +(/\/Length (\d+)/.exec(m[1]) || [])[1], at = m.index + m[0].length;
      try { const ds = new Blob([bytes.slice(at, at + len)]).stream().pipeThrough(new DecompressionStream('deflate')); text += await new Response(ds).text(); } catch { /* not a content stream */ }
    }
    out.captions = [...text.matchAll(/\( ?Level ([\d.]+) m (?:\\\d{3}|\S) page (\d+) of (\d+)\) Tj/g)].map((m) => [+m[1], +m[2], +m[3]]);   // (the em dash: a WinAnsi escape)
    out.figs = [...text.matchAll(/\(Figure (\d+)\.\) Tj/g)].map((m) => +m[1]);
    out.legend = /[( ]AU\) Tj/.test(text);   // the legend's title ends in its column (“Site C — drillholes · AU”)
    // a GT-style table through the same door as an analysis window's ⇥ figure
    const pc = document.createElement('canvas'); pc.width = 300; pc.height = 200; pc.getContext('2d').fillRect(0, 0, 300, 200);
    dispatchEvent(new CustomEvent('micro:to-composer', { detail: { canvas: pc, tsv: 'cutoff\ttonnes\tgrade\n0.5\t1200\t1.8\n1.0\t800\t2.4\n', name: 'gt-atl' } }));
    const fr = ed.getDoc().frames;
    const tf = fr.find((x) => x.kind === 'table'), pf = fr.find((x) => x.source && x.source.kind === 'plot');
    out.table = tf && { cols: tf.content.columns, rows: tf.content.rows.length, beside: pf && !(tf.box[0] < pf.box[0] + pf.box[2] && pf.box[0] < tf.box[0] + tf.box[2] && tf.box[1] < pf.box[1] + pf.box[3] && pf.box[1] < tf.box[1] + tf.box[3])
      && (Math.abs(tf.box[0] - (pf.box[0] + pf.box[2])) <= 8 || Math.abs(tf.box[1] - (pf.box[1] + pf.box[3])) <= 8 || Math.abs(pf.box[0] - (tf.box[0] + tf.box[2])) <= 8) };   // touching it, not on it
    return out;
  });
  if (r.fail) console.log('ATLAS DEBUG', r.fail, r.tracker);
  chk(`ATLAS: the starter routine steps ${r.levels.length} ${r.axis}-levels into ${r.book}`, r.levels.length === 6 && r.axis === 'z' && /^atlas\/levels\.pdf$/.test(r.book));
  chk(`ATLAS: one PDF, a page per level, each a JPEG render (${r.count} pages, ${r.jpegs} images, ${r.distinctImgs} distinct)`, r.count === 6 && r.jpegs === 6 && r.distinctImgs >= 4);
  chk(`ATLAS: each page's caption carries its level and page number (${JSON.stringify(r.captions)})`, r.captions.length === 6 && r.captions.every((c, i) => Math.abs(c[0] - r.levels[i]) < 1e-6 && c[1] === i + 1 && c[2] === 6));
  chk(`ATLAS: {fig} numbers on across the book (${JSON.stringify(r.figs)}) and the legend is on every page (${r.legend})`, JSON.stringify(r.figs) === '[1,2,3,4,5,6]' && r.legend);
  chk(`ATLAS: the user's view comes back after the run (look ${r.lookAfter}; “${r.meta}”)`, r.lookAfter === 33);
  chk(`ATLAS: an analysis table arrives as a table frame beside its plot (${JSON.stringify(r.table)})`, r.table && r.table.cols.join() === 'cutoff,tonnes,grade' && r.table.rows === 2 && r.table.beside);
  await p.close();
}

// ── §97: FIELDS — a caption's live text. compo's own ({date:…} {ref:…} {scale} and number
//     formats) and micro's, read from what the nearest 3D-view frame showed when it rendered:
//     {section} {look} {count} {total} {filter} {sha} {micro}, the statistics over its shown
//     records ({mean:FE}, computed at render), and ${…} arithmetic over count / total. Read back
//     from the exported PDF's text. ──
if (take()) {
  const p = await mkPage('sm2fields');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,FE'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(20 + i * 2).toFixed(1)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'fld.csv'), 'fld.csv', 'replace');
    M_.setActiveLayer(id);
    document.querySelector('#filter').value = 'FE > 40'; await M_.applyBlockFilter('FE > 40');
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    await window.micro.setSection({ axis: 'z', position: 20, thickness: 10 });
    await new Promise((res) => setTimeout(res, 200));
    const ed = M_.openComposer('fields');
    const f = M_.addViewFrame(ed);
    out.viewId = f.id;
    const below = f.box[1] + f.box[3] + 2;
    ed.addFrame({ kind: 'text', name: 'cap', box: [f.box[0], below, 120, 6], content: { md: 'Figure {fig}' } });
    const lines = ['S {section}', 'C {count:,}', 'T {total}', 'M {mean:FE:.2f}', 'X {max:FE}', 'F {filter}', 'P ${count / total:.1%}', 'L {look}', 'K {scale}', 'D {date:YYYY}', 'H {sha}', 'R {fig@cap}', 'A {count:,@view-1}', 'B {mean:FE:.1f@view-1}', 'V {micro}', 'U {unknown}'];
    ed.addFrame({ kind: 'text', box: [f.box[0], below + 7, 160, 70], content: { md: lines.join('\n'), size: 8 } });
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    out.strs = [...s.matchAll(/Tm \(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);
    out.build = window._micro.build || null;
    await window.micro.setSection(null); await M_.applyBlockFilter('');
    return out;
  });
  const get = (k) => (r.strs.find((x) => x.startsWith(k + ' ')) || '').slice(k.length + 1);
  const want = {
    // the view is cut at 20 RL ± 5, so {count} and the statistics are over the slab's blocks (the
    // default "captions: in the section"): centroids in (15, 25] → the z=25 level, 380 of FE > 40
    S: (v) => /^20 RL /.test(v), C: (v) => v === '380', T: (v) => v === '2400', M: (v) => v === '60.00', X: (v) => v === '78', F: (v) => v === 'FE > 40',
    P: (v) => v === '15.8%', L: (v) => /^000/.test(v), K: (v) => /^1 : \d/.test(v), D: (v) => v === String(new Date().getFullYear()),
    H: (v) => /^[0-9a-f]{8}$/.test(v), R: (v) => v === '1', A: (v) => v === '380', B: (v) => v === '60.0', V: (v) => v.length > 0, U: (v) => v === '{unknown}',
  };
  const bad = Object.keys(want).filter((k) => !want[k](get(k)));
  chk(`FIELDS: a view frame's id is view-1 (${r.viewId})`, r.viewId === 'view-1');
  chk(`FIELDS: every caption field resolves in the PDF (${Object.keys(want).map((k) => `${k}=${get(k)}`).join(' · ')})${bad.length ? ' BAD: ' + bad : ''}`, !bad.length);
  await p.close();
}

// ── §98: FIGURES THAT KNOW THEIR DATA — the exported PDF carries its figure (an embedded
//     .compo.json) and opens again in micro as an editable figure; a view frame recorded each
//     layer's content hash, so a changed file reads "older data" and a missing one "data not
//     loaded"; ↻ views renders it again and the badge goes. ──
if (take()) {
  const p = await mkPage('sm2stale');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const csv = (k) => { const rows = ['XC,YC,ZC,FE']; for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},5,${(k + i * 2).toFixed(1)}`); return new File([rows.join('\n') + '\n'], 'st.csv'); };
    const until = async (fn, ms = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((res) => setTimeout(res, 50)); } return fn(); };
    await M_.openBlob(csv(20), 'st.csv', 'replace');
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    await new Promise((res) => setTimeout(res, 200));
    const ed = M_.openComposer('stale fig');
    const f = M_.addViewFrame(ed);
    ed.addFrame({ kind: 'text', box: [f.box[0], f.box[1] + f.box[3] + 2, 120, 6], content: { md: 'Figure {fig}. FE mean {mean:FE:.1f}' } });
    await until(() => f.content.meta.facts.layers[0].sha);
    out.fresh = M_.staleOf(f);
    // the PDF carries the figure
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72);
    const C = await import('/ext/compo/index.js');
    const back = await C.figureFromPdf(bytes);
    out.attached = back.doc && { title: back.doc.title, frames: back.doc.frames.length, name: back.name };
    // a new estimate: same layer name, different bytes → "older data"
    await M_.openBlob(csv(30), 'st.csv', 'replace');
    const vf = () => M_.currentFigure().doc.frames.find((x) => x.id === f.id);
    out.changed = await until(() => { const s = M_.staleOf(vf()); return s && s.text; });
    out.badgeShown = await until(() => !!document.querySelector('.compo-fr .compo-badge'));
    // ↻ views renders it again: the badge goes, the caption's statistic follows the new data
    await M_.refreshViews(M_.currentFigure());
    out.afterRefresh = M_.staleOf(vf());
    out.meanAfter = vf().content.meta.facts.stats && vf().content.meta.facts.stats.FE && +vf().content.meta.facts.stats.FE.mean.toFixed(1);
    // open the (older) PDF: a second figure, its view made from data that has since changed
    await M_.openBlob(new File([bytes], 'stale_fig.pdf'), 'stale_fig.pdf', 'add');
    const opened = M_.figures().find((x) => x.name === 'stale fig (2)');
    out.opened = opened && { frames: opened.doc.frames.length, badge: (M_.staleOf(opened.doc.frames.find((x) => x.source && x.source.kind === 'view')) || {}).text, meta: document.querySelector('#meta').textContent };
    // with the layer gone: "data not loaded"
    await M_.openBlob(new File(['XC,YC,ZC,AU\n1,1,1,1\n2,2,2,2\n'], 'other.csv'), 'other.csv', 'replace');
    out.missing = (M_.staleOf(vf()) || {}).text;
    out.notPdf = await (async () => { await M_.openBlob(new File(['%PDF-1.4\n%%EOF\n'], 'plain.pdf'), 'plain.pdf', 'add'); return document.querySelector('#meta').textContent; })();
    return out;
  });
  chk(`STALE: a fresh view frame has no badge (${JSON.stringify(r.fresh)})`, r.fresh === null);
  chk(`STALE: the PDF carries its figure (${JSON.stringify(r.attached)})`, r.attached && r.attached.title === 'stale fig' && r.attached.frames === 2 && /\.compo\.json$/.test(r.attached.name));
  chk(`STALE: a changed file reads "${r.changed}", and the badge shows on the page`, r.changed === 'older data' && r.badgeShown);
  chk(`STALE: ↻ views renders it again — no badge (${JSON.stringify(r.afterRefresh)}), the statistic follows (mean ${r.meanAfter})`, r.afterRefresh === null && r.meanAfter === 59);
  chk(`STALE: the older PDF opens as a figure, its view flagged (${JSON.stringify(r.opened)})`, r.opened && r.opened.frames === 2 && r.opened.badge === 'older data' && /made from data that isn't loaded or has changed/.test(r.opened.meta));
  chk(`STALE: with the layer gone the view reads "${r.missing}"`, r.missing === 'data not loaded');
  chk(`STALE: a PDF without a figure says so (“${r.notPdf}”)`, /no compo figure inside/.test(r.notPdf));
  await p.close();
}

// ── §99: DRAWING-GRADE VIEWS — a view frame states its projection (meta.proj), so compo knows
//     where any world point lands: coordinate ticks on its border print as text; a locked scale
//     holds when the frame is resized; + label pins the picked record; a double-click edits the
//     view in the 3D view and Done re-captures it. ──
if (take()) {
  const p = await mkPage('sm2world');
  if (process.env.SM2_DUMP) await p.evaluate(() => { window.__dumpFig = true; });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,FE']; for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${512005 + i * 10},${7604005 + j * 10},605,${(20 + i).toFixed(1)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'w.csv'), 'w.csv', 'replace');
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    await new Promise((res) => setTimeout(res, 200));
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('world fig');
    const f = M_.addViewFrame(ed);
    const vf = () => ed.getDoc().frames.find((x) => x.id === f.id);
    out.hasProj = C.hasProj(vf());
    // the camera target lands at the frame's middle
    const cw = window.micro.view(), pg = C.worldToPage(vf(), cw.target);
    out.centre = pg && [+(pg.x - (f.box[0] + f.box[2] / 2)).toFixed(3), +(pg.y - (f.box[1] + f.box[3] / 2)).toFixed(3)];
    // lock 1 : 1000 → 1 m per paper mm, whatever the frame's size
    ed.select([f.id]); ed.render();
    const inp = document.querySelector('.compo-side input.cmp-scale');
    inp.value = '1000'; inp.dispatchEvent(new Event('change'));
    const until = async (fn, ms = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((res) => setTimeout(res, 50)); } return fn(); };
    await until(() => Math.abs(C.frameWorldPerMm(vf()) - 1) < 1e-3);
    out.wpm = +C.frameWorldPerMm(vf()).toFixed(4);
    ed.update(f.id, (fr) => { fr.box[2] *= 0.6; fr.box[3] *= 0.6; });
    await M_.refreshViews(M_.currentFigure());
    out.wpmResized = +C.frameWorldPerMm(vf()).toFixed(4);
    // ticks: the PDF carries coordinates
    ed.update(f.id, (fr) => { fr.content.ticks = 'ticks'; });
    out.ticks = C.worldTicks(vf()).map((t) => `${t.edge}:${t.axis}`).filter((v, i, a) => a.indexOf(v) === i).sort();
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    out.pdfE = [...s.matchAll(/\((\d{3} \d{3}) E\) Tj/g)].length; out.pdfN = [...s.matchAll(/\((\d \d{3} \d{3}) N\) Tj/g)].length;
    // + label at the picked record (record 0 sits at 512005, 7604005, 605)
    await M_.showRecord({ layer: id, rec: 0, face: 7 });
    await new Promise((res) => setTimeout(res, 300));
    ed.select([f.id]); ed.render();
    document.querySelector('.compo-bar button[aria-label="Add label"]').click();
    const lb = ed.selected()[0];
    out.label = lb && { kind: lb.kind, at: lb.content.at, of: lb.content.of, onPage: !!C.worldToPage(vf(), lb.content.at) };
    // double-click: edit in place, move the camera, Done re-captures
    const before = JSON.stringify(vf().source.scene.camera);
    document.querySelector(`.compo-fr[data-id="${f.id}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    out.editing = !!document.querySelector('.cmp-editframe') && document.querySelector('.composer-win').style.display === 'none';
    await window.micro.setView({ look: 0, elevation: 90, ortho: true, distance: window.micro.view().distance * 0.7 });
    [...document.querySelectorAll('.cmp-editbar button')].find((b) => b.textContent === 'Done').click();
    await until(() => !document.querySelector('.cmp-editframe'));
    out.recaptured = JSON.stringify(vf().source.scene.camera) !== before;
    out.back = await until(() => document.querySelector('.composer-win').style.display === '');
    if (window.__dumpFig) { const png = await C.exportPNG(M_.currentFigure().doc, { dpi: 150 }); out.png = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(png); }); }
    return out;
  });
  if (r.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SM2_DUMP, Buffer.from(r.png.split(',')[1], 'base64')); }
  chk(`WORLD: a view frame states its projection; the camera's target lands at its middle (${JSON.stringify(r.centre)})`, r.hasProj && r.centre && Math.abs(r.centre[0]) < 0.5 && Math.abs(r.centre[1]) < 0.5);
  chk(`WORLD: a locked 1 : 1000 is 1 m per mm (${r.wpm}) and stays so at 60 % size (${r.wpmResized})`, Math.abs(r.wpm - 1) < 2e-3 && Math.abs(r.wpmResized - 1) < 2e-3);
  chk(`WORLD: ticks name their coordinate (${r.ticks}); the PDF prints them (${r.pdfE} E, ${r.pdfN} N)`, r.ticks.includes('top:E') && r.ticks.includes('left:N') && r.pdfE > 1 && r.pdfN > 1);
  chk(`WORLD: + label pins the picked record (${JSON.stringify(r.label)})`, r.label && r.label.kind === 'label' && JSON.stringify(r.label.at) === '[512005,7604005,605]' && r.label.of === 'view-1' && r.label.onPage);
  chk(`WORLD: double-click edits the view in place (${r.editing}); Done re-captures it (${r.recaptured}) and the composer comes back (${r.back})`, r.editing && r.recaptured && r.back);
  await p.close();
}

// ── §100: CHARTS ON @gcu/plot — the analysis windows draw through @gcu/plot (chartFigure), and
//     ⇥ figure sends the chart's SPEC: a 'chart' frame that re-flows at its own size and prints as
//     vectors (text in the PDF, no image for it). ──
if (take()) {
  const p = await mkPage('sm2chart');
  if (process.env.SM2_DUMP) await p.evaluate(() => { window.__dumpFig = true; });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU']; for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(0.2 + 0.05 * i + 0.1 * k).toFixed(3)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'ch.csv'), 'ch.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    M_.openGradeTonnage(L);
    const w = () => [...document.querySelectorAll('.fwin')].find((el) => el.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage'));
    w().querySelector('.sw-run').click();
    const until = async (fn, ms = 15000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((res) => setTimeout(res, 50)); } return fn(); };
    await until(() => w()._gtSpec);
    await new Promise((res) => setTimeout(res, 200));
    const cv = w().querySelector('canvas');
    out.spec = !!cv._chartSpec && cv._chartSpec.series.length;
    // the window's chart is drawn: ink on the canvas
    const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    out.ink = ink / (d.length / 4);
    if (window.__dumpFig) out.winPng = cv.toDataURL('image/png');
    // ⇥ figure → a chart frame
    const ed = M_.openComposer('charts');
    [...w().querySelectorAll('.awin-btn')].find((b) => b.textContent === '⇥ figure').click();
    const fr = ed.getDoc().frames.find((f) => f.kind === 'chart');
    out.frame = fr && { series: fr.content.spec.series.length, name: fr.source.name };
    ed.render();
    const k1 = fr._listKey;
    ed.update(fr.id, (x) => { x.box[2] *= 1.5; }); ed.render();
    out.reflow = fr._listKey !== k1 || ed.getDoc().frames.find((f) => f.id === fr.id)._listKey !== k1;
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    out.pdf = { images: (s.match(/\/Subtype \/Image/g) || []).length, cutoff: /\(cutoff[^)]*\) Tj/.test(s), texts: (s.match(/\) Tj/g) || []).length };
    if (window.__dumpFig) { const C = await import('/ext/compo/index.js'); const png = await C.exportPNG(M_.currentFigure().doc, { dpi: 150 }); out.png = await new Promise((res) => { const f2 = new FileReader(); f2.onload = () => res(f2.result); f2.readAsDataURL(png); }); }
    return out;
  });
  if (r.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SM2_DUMP, Buffer.from(r.png.split(',')[1], 'base64')); fs.writeFileSync(process.env.SM2_DUMP.replace(/\.png$/, '-win.png'), Buffer.from(r.winPng.split(',')[1], 'base64')); }
  chk(`CHARTS: the GT window draws through @gcu/plot (spec of ${r.spec} series, ${(r.ink * 100).toFixed(0)}% inked)`, r.spec >= 1 && r.ink > 0.02);
  chk(`CHARTS: ⇥ figure makes a chart frame from the spec (${JSON.stringify(r.frame)}), which re-flows when resized (${r.reflow})`, r.frame && r.frame.series === r.spec && r.reflow);
  chk(`CHARTS: the PDF has the chart as vectors — no image, its labels as text (${JSON.stringify(r.pdf)})`, r.pdf.images === 0 && r.pdf.cutoff && r.pdf.texts > 10);
  await p.close();
}

// ── §101: DATA FRAMES THAT RE-RUN — ⇥ figure keeps the window's recipe; a new estimate makes the
//     chart and its table "older data"; ↻ refresh re-runs the analysis and both follow. A resource
//     table (tonnes · grade · metal above cutoffs, by domain) is computed from the model and made
//     again on refresh. Numbers checked by hand: 10 m blocks (1000 m³) at density 2.5. ──
if (take()) {
  const p = await mkPage('sm2rerun');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const csv = (dk) => { const rows = ['XC,YC,ZC,AU,DOM']; for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(0.2 + 0.05 * i + 0.1 * k + dk).toFixed(3)},${i < 15 ? 'A' : 'B'}`); return new File([rows.join('\n') + '\n'], 'rs.csv'); };
    const until = async (fn, ms = 20000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((res) => setTimeout(res, 60)); } return fn(); };
    let id = await M_.openBlob(csv(0), 'rs.csv', 'replace');
    let L = M_.layers().find((x) => x.id === id);
    const ed = M_.openComposer('rerun');
    // the resource table
    const rf = await M_.addResourceFrame({ layer: 'rs.csv', grade: 'AU', cutoffs: [0, 0.5], density: { const: 2.5, unit: 't/m3' }, groupBy: ['DOM'], metalFactor: 1 });
    out.res = rf.content.rows.map((row) => row.join(' '));
    // GT → ⇥ figure: a chart + its table, with the recipe
    M_.openGradeTonnage(L);
    const gw = () => [...document.querySelectorAll('.fwin')].find((el) => el.querySelector('.fwin-head .t').textContent.startsWith('grade-tonnage'));
    gw().querySelector('.sw-run').click();
    await until(() => gw()._gtSpec);
    [...gw().querySelectorAll('.awin-btn')].find((b) => b.textContent === '⇥ figure').click();
    gw().querySelector('.fwin-head button:last-child').click();
    const doc = () => M_.currentFigure().doc;
    const chart = () => doc().frames.find((f) => f.kind === 'chart'), table = () => doc().frames.find((f) => f.kind === 'table' && f.source.kind === 'table');
    out.recipe = !!(chart() && chart().source.recipe && table() && table().source.recipe);
    await until(() => chart().source.facts && chart().source.facts.layers[0].sha);
    out.fresh = M_.staleOf(chart());
    const row0 = table().content.rows[0].join(' ');
    out.gmax0 = Math.max(...chart().content.spec.series[0].data.map((d) => d[0]));
    // a new estimate (every grade +0.3), same file name
    id = await M_.openBlob(csv(0.3), 'rs.csv', 'replace');
    out.stale = { chart: (await until(() => M_.staleOf(chart())) || {}).text, table: (M_.staleOf(table()) || {}).text, res: (M_.staleOf(doc().frames.find((f) => f.source && f.source.kind === 'resource')) || {}).text };
    await M_.refreshViews(M_.currentFigure());
    out.after = { chart: M_.staleOf(chart()), table: M_.staleOf(table()), gmax: Math.max(...chart().content.spec.series[0].data.map((d) => d[0])), rowChanged: table().content.rows[0].join(' ') !== row0 };
    out.resAfter = doc().frames.find((f) => f.source && f.source.kind === 'resource').content.rows.map((row) => row.join(' '));
    out.windowsLeft = [...document.querySelectorAll('.fwin')].filter((el) => /grade-tonnage/.test(el.querySelector('.fwin-head .t').textContent)).length;
    // the form: its defaults guess the grade (AU) and the domain (DOM); Add makes the frame
    document.querySelector('.compo-bar button[aria-label="Add resource table"]').click();
    const dlg = document.querySelector('.cmp-resource');
    const sels = [...dlg.querySelectorAll('select')].map((x) => x.value);
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Add').click();
    await until(() => doc().frames.filter((f) => f.source && f.source.kind === 'resource').length === 2);
    out.form = { sels, made: doc().frames.filter((f) => f.source && f.source.kind === 'resource').length, closed: !document.querySelector('.cmp-resource') };
    return out;
  });
  chk(`RERUN: the resource table by domain (${JSON.stringify(r.res)})`, JSON.stringify(r.res) === JSON.stringify(['0 A 3 000 000 0.7 2 100 000', '0 B 3 000 000 1.45 4 350 000', '0 total 6 000 000 1.075 6 450 000', '0.5 A 2 400 000 0.7854 1 885 000', '0.5 B 3 000 000 1.45 4 350 000', '0.5 total 5 400 000 1.155 6 235 000']));
  chk(`RERUN: ⇥ figure keeps the recipe on the chart and its table (${r.recipe}); fresh, no badge (${JSON.stringify(r.fresh)})`, r.recipe && r.fresh === null);
  chk(`RERUN: a new estimate makes them "older data" (${JSON.stringify(r.stale)})`, r.stale.chart === 'older data' && r.stale.table === 'older data' && r.stale.res === 'older data');
  chk(`RERUN: ↻ refresh re-runs the analysis — no badges (${JSON.stringify([r.after.chart, r.after.table])}), the chart's cutoffs move up with the grades (${r.gmax0} → ${r.after.gmax}), the table follows (${r.after.rowChanged}), no window left open (${r.windowsLeft})`, r.after.chart === null && r.after.table === null && r.after.gmax > r.gmax0 && r.after.rowChanged && r.windowsLeft === 0);
  chk(`RERUN: the + resource form guesses AU and DOM, and Add makes a frame (${JSON.stringify(r.form)})`, r.form && r.form.sels.includes('AU') && r.form.sels.includes('DOM') && r.form.made === 2 && r.form.closed);
  chk(`RERUN: the resource table is made again (${JSON.stringify(r.resAfter)})`, r.resAfter[0] === '0 A 3 000 000 1 3 000 000');
  await p.close();
}

// ── §102: SCATTER / Q-Q ON @gcu/plot — the xy window draws through plot (xyFigure): a density, log
//     axes ticked at the decades, the Q-Q with its 1:1 line; ⇥ figure sends the spec (type 'xy') and
//     the chart frame prints it as vectors. ──
if (take()) {
  const p = await mkPage('sm2xy');
  if (process.env.SM2_DUMP) await p.evaluate(() => { window.__dumpFig = true; });
  const r = await p.evaluate(async () => {
    const M = window._micro, out = {};
    let s = 'X,Y,Z,AU,CU\n'; let seed = 11; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 20000; i++) { const au = +(Math.exp(rnd() * 3 - 1.5)).toFixed(4); s += `${5 + (i % 50) * 10},${5 + ((i / 50 | 0) % 40) * 10},${5 + (i / 2000 | 0) * 10},${au},${+(0.4 * au + rnd() * 0.5).toFixed(4)}\n`; }
    const id = await M.openBlob(new File([s], 'xy2.csv'), 'xy2.csv', 'replace');
    const L = M.layers().find((q) => q.id === id);
    const h = M.openXyPlot(L);
    Object.assign(h.st, { x: 'AU', y: 'CU', logX: true, logY: true });
    await h.run();
    const cv = h.win.el.querySelector('canvas');
    out.spec = cv._chartSpec && { type: cv._chartSpec.type, heat: !!cv._chartSpec.heat, log: cv._chartSpec.logX };
    const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    out.ink = ink / (d.length / 4);
    if (window.__dumpFig) out.winPng = cv.toDataURL('image/png');
    const ed = M.openComposer('xy');
    [...h.win.el.querySelectorAll('.awin-btn')].find((b) => b.textContent === '⇥ figure').click();
    const fr = ed.getDoc().frames.find((f) => f.kind === 'chart');
    out.frame = fr && fr.content.spec.type;
    const bytes = await M.figurePdfBytes(M.currentFigure(), 72, { compress: false });
    const t = new TextDecoder('latin1').decode(bytes);
    out.pdf = { log: t.includes('(AU \\(log\\)) Tj') /* the PDF escapes the label's parentheses */, decade: /\(1\) Tj|\(10\) Tj/.test(t) };
    // it keeps the window's recipe: a new estimate (other values, same file name) makes it 'older data'; ↻ refresh re-runs it
    out.recipe = fr.source.recipe && fr.source.recipe.tool;
    const xr0 = fr.content.spec.xr.slice();
    await new Promise((res) => setTimeout(res, 300));
    let s2 = 'X,Y,Z,AU,CU\n'; for (let i = 0; i < 2000; i++) s2 += `${5 + (i % 50) * 10},${5 + ((i / 50 | 0) % 40) * 10},5,${(1 + (i % 97)) * 0.5},${(1 + (i % 89)) * 0.2}\n`;
    await M.openBlob(new File([s2], 'xy2.csv'), 'xy2.csv', 'replace');
    const vf = () => M.currentFigure().doc.frames.find((f) => f.kind === 'chart');
    for (let k = 0; k < 40 && !(M.staleOf(vf()) || {}).text; k++) await new Promise((res) => setTimeout(res, 100));
    out.stale = (M.staleOf(vf()) || {}).text;
    await M.refreshViews(M.currentFigure());
    out.after = { badge: M.staleOf(vf()), moved: JSON.stringify(vf().content.spec.xr) !== JSON.stringify(xr0), windows: [...document.querySelectorAll('.fwin')].filter((el) => /scatter/.test(el.querySelector('.fwin-head .t').textContent)).length };
    if (window.__dumpFig) { const C = await import('/ext/compo/index.js'); const png = await C.exportPNG(M.currentFigure().doc, { dpi: 150 }); out.png = await new Promise((res) => { const f2 = new FileReader(); f2.onload = () => res(f2.result); f2.readAsDataURL(png); }); }
    return out;
  });
  if (r.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SM2_DUMP, Buffer.from(r.png.split(',')[1], 'base64')); fs.writeFileSync(process.env.SM2_DUMP.replace(/\.png$/, '-win.png'), Buffer.from(r.winPng.split(',')[1], 'base64')); }
  chk(`XY: the scatter window draws through @gcu/plot (${JSON.stringify(r.spec)}, ${(r.ink * 100).toFixed(0)}% inked)`, r.spec && r.spec.type === 'xy' && r.spec.log && r.ink > 0.02);
  chk(`XY: the frame keeps the window's recipe (${r.recipe}); a new estimate reads "${r.stale}"; ↻ refresh re-runs it — no badge, the axes moved (${JSON.stringify(r.after)})`, r.recipe === 'xy' && r.stale === 'older data' && r.after.badge === null && r.after.moved);
  chk(`XY: ⇥ figure makes an xy chart frame (${r.frame}); the PDF carries its log label and decade ticks as text (${JSON.stringify(r.pdf)})`, r.frame === 'xy' && r.pdf.log && r.pdf.decade);
  await p.close();
}

// ── §103: KEY PLAN + SMALL MULTIPLES — a key plan is a whole-model plan wearing the section trace
//     of the view it keys, read from that view's render: on each atlas page the line moves with the
//     page. Small multiples repeat a view over columns or section levels, in a grid over its box,
//     as a group, each copy a view of its own with a caption that says which. ──
if (take()) {
  const p = await mkPage('sm2key');
  if (process.env.SM2_DUMP) await p.evaluate(() => { window.__dumpFig = true; });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU,CU']; for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(0.2 + 0.05 * i).toFixed(3)},${(0.1 + 0.05 * j).toFixed(3)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'kp.csv'), 'kp.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    await M_.setLayerColorSel(L, `chan:${M_.layerTableHeader(L).columns.indexOf('AU')}`);
    // the keyed view: an E–W section (north-facing) at y = 105
    await window.micro.setView({ look: 0, elevation: 0, ortho: true });
    await window.micro.setSection({ axis: 'y', position: 105, thickness: 10 });
    await new Promise((res) => setTimeout(res, 200));
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('key');
    const f = M_.addViewFrame(ed, { box: [12, 12, 180, 90] });
    const kp = await M_.addKeyPlan(ed, f);
    out.key = { keyFor: kp.source.keyFor, proj: C.hasProj(kp), wasSection: kp.content.meta.facts.section };
    // the trace on the key plan, through the env's overlays (the target's section as rendered)
    const env = () => ({ doc: ed.getDoc() });
    const traceOf = (doc, kf) => { const t = doc.frames.find((x) => x.id === [].concat(kf.source.keyFor)[0]); const s = t.content.meta.facts.section; return C.planeTrace(kf, { normal: s.normal, position: s.position, thickness: s.thickness }); };
    out.trace = traceOf(ed.getDoc(), kp);
    // an atlas: two pages, the section at y = 55 and y = 155 — the key plan's line moves
    const pages = [];
    for (const y of [55, 155]) pages.push(await M_.compoPage({ figure: 'key', view: { section: { axis: 'y', position: y, thickness: 10 } }, dpi: 72 }));
    out.keyWhole = pages.map((d) => d.frames.find((x) => x.source && x.source.keyFor).content.meta.facts.section);   // the key plan is NOT cut by the page's section
    out.pageTraces = pages.map((d) => { const k = d.frames.find((x) => x.source && x.source.keyFor); const t = traceOf(d, k); return t && t.line ? +((t.line[0][1] + t.line[1][1]) / 2).toFixed(2) : null; });
    const bytes = await C.exportPDF(pages, { compress: false, env: M_.composerEnv() });
    out.pdfOk = bytes.length > 1000;
    // a second section view (N–S) — a key plan made with nothing selected shows BOTH, each in its own colour, labelled with its figure
    await window.micro.setView({ look: 90, elevation: 0, ortho: true });
    await window.micro.setSection({ axis: 'x', position: 155, thickness: 10 });
    await new Promise((res) => setTimeout(res, 200));
    const f2 = M_.addViewFrame(ed, { box: [12, 110, 120, 60] });
    ed.addFrame({ kind: 'text', box: [12, 104, 180, 5], content: { md: 'Figure {fig}.', size: 7 } });
    ed.addFrame({ kind: 'text', box: [12, 171, 120, 5], content: { md: 'Figure {fig}.', size: 7 } });
    await new Promise((res) => setTimeout(res, 600));
    ed.select([]);
    const kp2 = await M_.addKeyPlan(ed);
    const envK = { ...M_.composerEnv(), doc: ed.getDoc(), figOf: (cap) => ed.getDoc().frames.filter((x) => x.kind === 'text' && /\{fig\}/.test(x.content.md)).indexOf(cap) + 1 };
    const ovs = M_.composerEnv().overlaysFor(ed.getDoc().frames.find((x) => x.id === kp2.id), envK) || [];
    out.both = { keyFor: kp2.source.keyFor, labels: ovs.map((o) => o.label), colours: new Set(ovs.map((o) => o.color)).size };
    // the inspector: untick one → it leaves the key plan
    ed.select([kp2.id]); ed.render();
    const cb = [...document.querySelectorAll('.compo-side .cmp-keyfor input')].find((i) => i.dataset.id === f2.id);
    out.boxes = document.querySelectorAll('.compo-side .cmp-keyfor input').length;
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    out.after = ed.getDoc().frames.find((x) => x.id === kp2.id).source.keyFor;
    // small multiples over colour: AU, CU in place of the view
    const g = ed.getDoc().frames.find((x) => x.id === f.id);
    const made = await M_.smallMultiples(ed, g, { vary: 'colour', values: ['AU', 'CU'], cols: 2 });
    const doc = ed.getDoc(), views = made.map((i) => doc.frames.find((x) => x.id === i)).filter((x) => x.kind === 'image'), caps = made.map((i) => doc.frames.find((x) => x.id === i)).filter((x) => x.kind === 'text');
    out.mult = { n: views.length, caps: caps.map((c) => c.content.md), sels: views.map((v) => v.source.scene.layers[0].colorSel), gone: !doc.frames.some((x) => x.id === f.id), group: new Set(made.map((i) => doc.frames.find((x) => x.id === i).group)).size === 1, side: views[0].box[1] === views[1].box[1] && views[1].box[0] > views[0].box[0] };
    // over section levels: the captions read the section of their own view
    const v2 = views[0];
    const madeS = await M_.smallMultiples(ed, v2, { vary: 'section', values: [15, 25], axis: 'z', thickness: 10 });
    const docS = ed.getDoc(), vS = madeS.map((i) => docS.frames.find((x) => x.id === i)).filter((x) => x.kind === 'image');
    out.levels = vS.map((v) => v.content.meta.facts.section && Math.round(v.content.meta.facts.section.position));
    const envM = { ...M_.composerEnv(), doc: docS };
    out.levelCaps = madeS.map((i) => docS.frames.find((x) => x.id === i)).filter((x) => x.kind === 'text').map((c) => C.resolveFields(c.content.md, envM, c));
    if (window.__dumpFig) { const png = await C.exportPNG(pages[1], { dpi: 120, env: M_.composerEnv() }); out.png = await new Promise((res) => { const f2 = new FileReader(); f2.onload = () => res(f2.result); f2.readAsDataURL(png); }); }
    return out;
  });
  if (r.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SM2_DUMP, Buffer.from(r.png.split(',')[1], 'base64')); }
  chk(`KEY PLAN: it keys the view (${r.key.keyFor}), has its projection (${r.key.proj}), and was itself rendered with no section (${JSON.stringify(r.key.wasSection)})`, JSON.stringify(r.key.keyFor) === '["view-1"]' && r.key.proj && r.key.wasSection === null);
  chk(`KEY PLAN: the keyed section shows as a line with its slab (${JSON.stringify(r.trace && { line: r.trace.line, faces: r.trace.faces.length })})`, r.trace && r.trace.line && r.trace.faces.length === 2 && Math.abs(r.trace.line[0][1] - r.trace.line[1][1]) < 0.01);
  chk(`KEY PLAN: on each atlas page the line moves with the page's section (${JSON.stringify(r.pageTraces)} mm down the plan, y 55 → 155: north is up)`, r.pageTraces.every(Number.isFinite) && r.pageTraces[0] > r.pageTraces[1] && r.pdfOk && r.keyWhole.every((s) => s === null));
  chk(`KEY PLAN: with nothing selected it shows every sectioned view — two lines, two colours, labelled by figure (${JSON.stringify(r.both)}); the inspector lists them (${r.boxes}) and unticking one removes it (${JSON.stringify(r.after)})`, r.both.keyFor.length === 2 && r.both.colours === 2 && r.both.labels.every((l) => /^Fig \d · /.test(l)) && r.boxes === 2 && r.after.length === 1);
  chk(`MULTIPLES: colour by AU / CU side by side, captioned, a group, in place of the view (${JSON.stringify(r.mult)})`, r.mult.n === 2 && JSON.stringify(r.mult.caps) === '["AU","CU"]' && r.mult.sels[0] !== r.mult.sels[1] && r.mult.gone && r.mult.group && r.mult.side);
  chk(`MULTIPLES: over section levels — each view cut where asked (${JSON.stringify(r.levels)}), its caption a field reading its own section (${JSON.stringify(r.levelCaps)})`, JSON.stringify(r.levels) === '[15,25]' && /^15 RL/.test(r.levelCaps[0]) && /^25 RL/.test(r.levelCaps[1]));
  await p.close();
}

// ── §104: VECTOR SECTIONS — a plan section through a block model as vector cells: every block the
//     plane cuts, its rectangle in its legend colour, same-colour runs merged; the filter applies;
//     the PDF holds the section as vectors (no image); other layers ride on top as a transparent
//     render; a view not looking square-on along the section is refused, saying why. ──
if (take()) {
  const p = await mkPage('sm2vsec');
  if (process.env.SM2_DUMP) await p.evaluate(() => { window.__dumpFig = true; });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU,CU']; for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(0.2 + 0.05 * i).toFixed(3)},${(0.1 + 0.05 * j).toFixed(3)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'vs.csv'), 'vs.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    await M_.setLayerColorSel(L, `chan:${M_.layerTableHeader(L).columns.indexOf('CU')}`);
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    await window.micro.setSection({ axis: 'z', position: 15, thickness: 10 });
    await new Promise((res) => setTimeout(res, 200));
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('vsec');
    const f = M_.addViewFrame(ed, { box: [12, 12, 180, 120] });
    const menu = () => M_.composerFrameMenu ? M_.composerFrameMenu(ed.getDoc().frames.find((x) => x.id === f.id), ed) : null;
    const toggle = async () => { const it = menu().find((m) => /^Vector section/.test(m.label)); await it.run(); };
    await toggle();
    const vf = () => ed.getDoc().frames.find((x) => x.id === f.id);
    const V = vf().content.vector, Ly = V && V.layers[0];
    out.vec = Ly && { cells: Ly.colors.length, blocks: Ly.blocks, colours: Ly.palette.length, first: Ly.rects.slice(0, 4), overlay: !!V.overlay, err: vf().content.vectorError };
    let bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    out.pdf = { images: (new TextDecoder('latin1').decode(bytes).match(/\/Subtype \/Image/g) || []).length };
    // the filter applies: CU > 0.5 keeps rows 9…19 → 11 cells
    document.querySelector('#filter').value = 'CU > 0.5'; await M_.applyBlockFilter('CU > 0.5');
    menu().find((m) => m.label === 'Update from the 3D view').run();   // the frame re-captured WITH the filter (a refresh would re-apply its own scene)
    await new Promise((res) => setTimeout(res, 1200));
    out.filtered = vf().content.vector && vf().content.vector.layers[0].colors.length;
    if (window.__dumpFig) { const png = await C.exportPNG(M_.currentFigure().doc, { dpi: 150, env: M_.composerEnv() }); out.png = await new Promise((res) => { const f2 = new FileReader(); f2.onload = () => res(f2.result); f2.readAsDataURL(png); }); }
    await M_.applyBlockFilter(''); document.querySelector('#filter').value = '';
    // another layer (points inside the slab): it rides on top, a transparent render
    { const pts = []; for (let i = 0; i < 400; i++) pts.push(`${20 + (i % 20) * 13} ${20 + Math.floor(i / 20) * 8} 15`); await M_.openBlob(new File([pts.join('\n') + '\n'], 'pts.xyz'), 'pts.xyz', 'add'); }
    await new Promise((res) => setTimeout(res, 300));
    ed.update(f.id, () => {});
    const it = menu().find((m) => m.label === 'Update from the 3D view'); it.run();
    await new Promise((res) => setTimeout(res, 1500));
    const V2 = vf().content.vector;
    out.overlay = !!(V2 && V2.overlay);
    if (V2 && V2.overlay) {
      const im = new Image(); im.src = V2.overlay; await im.decode();
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data; let clear = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
      out.clearFrac = clear / (d.length / 4);
    }
    bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    out.pdf2 = { images: (new TextDecoder('latin1').decode(bytes).match(/\/Subtype \/Image/g) || []).length };
    // a perspective view: refused, saying why
    await window.micro.setView({ look: 30, elevation: 40, ortho: false });
    menu().find((m) => m.label === 'Update from the 3D view').run();
    await new Promise((res) => setTimeout(res, 800));
    out.refused = vf().content.vectorError || null;
    return out;
  });
  if (r.png) { const fs = await import('node:fs'); fs.writeFileSync(process.env.SM2_DUMP, Buffer.from(r.png.split(',')[1], 'base64')); }
  chk(`VECTOR: the plan at z 15 cuts 600 blocks; colour by CU (one value per row) merges them into 20 cells (${JSON.stringify(r.vec)})`, r.vec && r.vec.blocks === 600 && r.vec.cells === 20 && r.vec.colours === 20 && r.vec.first.length === 4 && r.vec.first[2] - r.vec.first[0] === 300 && r.vec.first[3] - r.vec.first[1] === 10 && !r.vec.overlay);
  chk(`VECTOR: the PDF holds the section as vectors — no image (${JSON.stringify(r.pdf)})`, r.pdf.images === 0);
  chk(`VECTOR: the filter applies (CU > 0.5 → ${r.filtered} cells)`, r.filtered === 11);
  chk(`VECTOR: other layers ride on top as a transparent render (overlay ${r.overlay}, ${r.clearFrac != null ? (r.clearFrac * 100).toFixed(0) : '–'}% clear; ${JSON.stringify(r.pdf2)})`, r.overlay && r.clearFrac > 0.5 && r.clearFrac < 0.999 && r.pdf2.images >= 1);
  chk(`VECTOR: a perspective view is refused, saying why (“${r.refused}”)`, /orthographic|square-on/.test(r.refused || ''));
  await p.close();
}

// ── §105: HOUSE STYLE — the project's properties (company, client, …) and a figure's own (drawing,
//     revision) feed {prop:key}; + title block (one titleblock frame) lays them out bottom-right; a figure marked as a
//     template starts a new one (its frames and properties, the drawing number cleared); the house
//     style saves with the project (figures/house.json) and comes back. ──
if (take()) {
  let p = await mkPage('sm2house');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const rows = ['XC,YC,ZC,AU']; for (let i = 0; i < 40; i++) rows.push(`${5 + (i % 8) * 10},${5 + Math.floor(i / 8) * 10},5,${i / 10}`);
    await M_.openBlob(new File([rows.join('\n') + '\n'], 'h.csv'), 'h.csv', 'replace');
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('house A');
    M_.setHouseProps({ company: 'GCU Mining', client: 'ACME', project: 'Pit A', prepared: 'AE', checked: 'JS' });
    M_.currentFigure().doc.props = { drawing: 'D-101', revision: 'B' };
    const ids = M_.addTitleBlock(ed);
    const env = { ...M_.composerEnv(), doc: ed.getDoc(), title: 'house A' };
    const tb = ed.getDoc().frames.find((x) => x.id === ids[0]);
    out.rows = tb.content.rows.map((row) => C.resolveFields(row[0], env, tb).replace(/\*\*/g, ''));
    out.grouped = ids.length === 1 && tb.kind === 'titleblock';      // ONE frame of its own kind (it was a group of text frames)
    // a template, and a new figure from it
    [...document.querySelectorAll('.cmp-top button')].find((b) => /template/.test(b.textContent)).click();
    out.marked = !!M_.currentFigure().doc.template;
    const sel = document.querySelector('.cmp-top select.cmp-from'); sel.value = 'house A';
    return { ...out, needNew: true };
  });
  // the "new" button asks a name in micro's own prompt: answer it
  await p.locator('.cmp-top button[aria-label="New figure"]').click();
  await p.locator('#pmInput').fill('house B');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => window._micro.currentFigure().name === 'house B', null, { timeout: 5000 }).catch(() => {});
  const r2 = await p.evaluate(async () => {
    const M_ = window._micro, f = M_.currentFigure();
    return { name: f.name, frames: f.doc.frames.length, template: !!f.doc.template, props: f.doc.props };
  });
  await saveProject(p);
  await p.close();
  p = await mkPage('sm2house');
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2house'); await window._micro.openProjectDir(dir); });
  await p.waitForFunction(() => window._micro.layers().length, null, { timeout: 60000 });
  const back = await p.evaluate(() => ({ house: window._micro.house().props, figs: window._micro.figures().map((f) => f.name + (f.doc.template ? '★' : '')) }));
  chk(`HOUSE: the title block reads the figure's and the project's properties (${JSON.stringify(r.rows)}), one titleblock frame (${r.grouped})`,
    r.rows[0] === 'GCU Mining' && r.rows[1] === 'Pit A · ACME' && r.rows[2] === 'house A' && /^drawing D-101 · rev B · \d{4}-\d\d-\d\d$/.test(r.rows[3]) && r.rows[4] === 'prepared AE · checked JS' && /^scale .* · page 1 of 1$/.test(r.rows[5]) && r.grouped);
  chk(`HOUSE: a template starts a new figure — its frames, its properties, the drawing number cleared (${JSON.stringify(r2)})`, r.marked && r2.name === 'house B' && r2.frames === 1 && !r2.template && r2.props && r2.props.drawing === undefined);
  chk(`HOUSE: the house style saves with the project and comes back (${JSON.stringify(back)})`, back.house.company === 'GCU Mining' && back.house.client === 'ACME' && back.figs.includes('house A★') && back.figs.includes('house B'));
  await p.close();
}

// ── §106: NO SEAM ON A BLOCK FACE — an orthographic plan centred exactly on a block boundary, at an
//     odd width, puts a pixel's ray right on the face between two blocks. The ray used to come from
//     the interpolated quad position (a few cm off), so both blocks missed it: a one-pixel column of
//     background down the middle of a print-resolution render. Each pixel's ray is now unprojected
//     from its own screen position. ──
if (take()) {
  const p = await mkPage('sm2seam');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, W = window.micro;
    const rows = ['XC,YC,ZC,AU']; for (let k = 0; k < 4; k++) for (let j = 0; j < 32; j++) for (let i = 0; i < 44; i++) rows.push(`${512005 + i * 10},${7604005 + j * 10},${525 + k * 10},${(0.1 + 0.01 * i).toFixed(3)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'seam.csv'), 'seam.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    await M_.setLayerColorSel(L, 'solid'); M_.setBg('#ffffff');
    await W.setView({ look: 0, elevation: 90, ortho: true }); W.fit();
    await new Promise((res) => setTimeout(res, 300));
    const out = { target: M_.cam.state.target.slice() };
    for (const w of [661, 663, 921]) {
      const h = Math.round(w * 0.66), cv = M_.renderViewCanvas(w, h), d = cv.getContext('2d').getImageData(0, 0, w, h).data, y = Math.round(h / 2);
      let gaps = 0, inModel = 0;
      for (let x = 2; x < w - 2; x++) {
        const lum = (xx) => { const o = (y * w + xx) * 4; return d[o] + d[o + 1] + d[o + 2]; };
        if (lum(x - 2) < 700 && lum(x + 2) < 700) { inModel++; if (lum(x) > 740) gaps++; }   // background between two model pixels
      }
      out[w] = { gaps, inModel };
    }
    return out;
  });
  chk(`NO SEAM: a plan centred on a block face (target ${JSON.stringify(r.target)}) has no background column inside the model at odd widths (${JSON.stringify([r[661], r[663], r[921]])})`, [661, 663, 921].every((w) => r[w].inModel > 100 && r[w].gaps === 0));
  await p.close();
}

// ── §107: USE WITH OTHER DATA — a figure made from one model (a view coloured by CU, a resource
//     table grouped by DOM, a caption statistic) pointed at ANOTHER: 5 km east, its columns in another
//     order, DOM called ZONE. The view colours by CU by NAME (not by the old column position), moves
//     with the data, the resource table groups by ZONE, the caption names the new layer, ↻ refresh
//     leaves no badge — and the original figure is untouched. ──
if (take()) {
  const p = await mkPage('sm2retarget');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    const mk = (hdr, row, dx, s = 10) => { const rows = [hdr]; for (let j = 0; j < 10; j++) for (let i = 0; i < 12; i++) rows.push(row(512005 + dx + i * s, 7604005 + j * s, 525, (0.2 + 0.05 * i).toFixed(2), (0.1 + 0.02 * j).toFixed(2), i < 6 ? 'west' : 'east')); return rows.join('\n') + '\n'; };
    const idA = await M_.openBlob(new File([mk('XC,YC,ZC,AU,CU,DOM', (x, y, z, au, cu, d) => [x, y, z, au, cu, d].join(','), 0)], 'pitA.csv'), 'pitA.csv', 'replace');
    const A = M_.layers().find((x) => x.id === idA);
    await M_.setLayerColorSel(A, M_.colorSelFor(A, 'CU'));
    out.selA = A.colorSel;
    const ed = M_.openComposer('pit A report');
    const vf = M_.addViewFrame(ed);
    await M_.addResourceFrame({ layer: 'pitA.csv', grade: 'AU', cutoffs: [0, 0.4], density: { const: 2.7, unit: 't/m3' }, groupBy: ['DOM'], metalFactor: 1, scope: 'all' });
    ed.addFrame({ kind: 'text', box: [20, 150, 80, 8], content: { md: 'mean AU {mean:pitA.csv:AU}' } });
    ed.addFrame({ kind: 'text', box: [20, 160, 80, 8], content: { md: `domains {n:DOM@${vf.id}}` } });   // names no layer: its view's
    out.refs = (await import('/tools/micro/src/retarget.js')).figureRefs(M_.currentFigure().doc).map((r) => ({ name: r.name, where: [...r.where], cols: [...r.cols] }));
    const fig = M_.currentFigure(), camA = fig.doc.frames.find((f) => f.id === vf.id).source.scene.camera.target.slice();
    out.sceneColor = fig.doc.frames.find((f) => f.id === vf.id).source.scene.layers[0].color;
    // the other pit: shifted 5 km east, CU before AU, DOM → ZONE
    const idB = await M_.openBlob(new File([mk('XC,YC,ZC,CU,AU,ZONE', (x, y, z, au, cu, d) => [x, y, z, cu, au, d].join(','), 5000)], 'pitB.csv'), 'pitB.csv', 'replace');
    const B = M_.layers().find((x) => x.id === idB);
    out.before = (M_.staleOf(fig.doc.frames.find((f) => f.id === vf.id)) || {}).text;
    // the dialog's first guesses: the one loaded layer, DOM missing
    const w = M_.openRetargetDialog(fig);
    const box = w.el.querySelector('.cmp-rt-layer');
    out.dialog = { layer: box.querySelector('select').value, missing: [...box.querySelectorAll('div > span')].map((s) => s.textContent).filter((t) => t !== '→') };
    w.close();
    const { figure, report } = await M_.retargetFigure(fig, { layers: { 'pitA.csv': 'pitB.csv' }, columns: { 'pitA.csv': { DOM: 'ZONE' } }, placement: 'move' });
    const v2 = figure.doc.frames.find((f) => f.source && f.source.kind === 'view'), sl = v2.source.scene.layers[0];
    const t2 = figure.doc.frames.find((f) => f.source && f.source.kind === 'resource'), cap = figure.doc.frames.find((f) => f.kind === 'text' && /mean AU/.test(f.content.md));
    out.report = report;
    out.after = { name: figure.name, layer: sl.name, color: sl.color, colorSel: sl.colorSel, shift: v2.source.scene.camera.target.map((v, i) => +(v - camA[i]).toFixed(3)),
      badge: M_.staleOf(v2), tableBadge: M_.staleOf(t2), groupBy: t2.source.params.groupBy, rows: t2.content.rows.length, cols: t2.content.columns, cap: cap.content.md };
    // the scene puts B's colour on by NAME: CU is column 3 in B, it was 4 in A
    await M_.applyScene(v2.source.scene);
    out.selB = B.colorSel; out.wantB = M_.colorSelFor(B, 'CU');
    out.cap2 = figure.doc.frames.find((f) => f.kind === 'text' && /domains/.test(f.content.md)).content.md;
    const orig = fig.doc.frames.find((f) => f.id === vf.id).source.scene.layers[0];
    out.orig = { layer: orig.name, figs: M_.figures().map((f) => f.name) };
    // 'scale': pit C is laid out at twice the spacing — the camera keeps its place RELATIVE to the data
    await M_.openBlob(new File([mk('XC,YC,ZC,AU,CU,DOM', (x, y, z, au, cu, d) => [x, y, z, au, cu, d].join(','), -3000, 20)], 'pitC.csv'), 'pitC.csv', 'add');
    const sA = fig.doc.frames.find((f) => f.id === vf.id).source.scene, ob = sA.layers[0].box, camR = sA.camera.radius, camT = sA.camera.target.slice();
    const { figure: f3 } = await M_.retargetFigure(fig, { layers: { 'pitA.csv': 'pitC.csv' }, columns: {}, placement: 'scale' });
    const s3 = f3.doc.frames.find((f) => f.source && f.source.kind === 'view').source.scene, nb = s3.layers[0].box;
    const c = (b) => [0, 1, 2].map((i) => (b[0][i] + b[1][i]) / 2), d = (b) => Math.hypot(...[0, 1, 2].map((i) => b[1][i] - b[0][i]));
    const k = d(nb) / d(ob), want = camT.map((v, i) => c(nb)[i] + (v - c(ob)[i]) * k);
    out.scale = { k: +k.toFixed(3), radius: +(s3.camera.radius / camR).toFixed(3), off: +Math.max(...want.map((v, i) => Math.abs(v - s3.camera.target[i]))).toFixed(6), layer: s3.layers[0].name };
    return out;
  });
  const capRef = r.refs.find((x) => x.name === 'pitA.csv');
  chk(`OTHER DATA: a statistic naming no layer counts as its view's layer's (${JSON.stringify(r.refs)}) and follows that layer's rename ("${r.cap2}")`,
    capRef && capRef.where.includes('caption') && capRef.cols.includes('DOM') && r.cap2 === `domains {n:ZONE@${/@([\w.-]+)\}/.exec(r.cap2)[1]}}`);
  chk(`OTHER DATA: 'scale' — the view onto a model laid out twice as wide scales with it (${JSON.stringify(r.scale)})`,
    r.scale.layer === 'pitC.csv' && r.scale.k > 1.5 && Math.abs(r.scale.radius - r.scale.k) < 1e-3 && r.scale.off < 1e-3);
  chk(`OTHER DATA: a scene keeps its colour by NAME (${r.sceneColor}; A was ${r.selA}); the view of the unloaded pit says "${r.before}"; the dialog guesses the loaded layer (${JSON.stringify(r.dialog)})`,
    r.sceneColor === 'CU' && r.before === 'data not loaded' && r.dialog.layer === 'pitB.csv' && r.dialog.missing.includes('DOM'));
  chk(`OTHER DATA: the figure made with pit B (${JSON.stringify(r.after)}; ${JSON.stringify(r.report)})`,
    r.after.layer === 'pitB.csv' && r.after.color === 'CU' && r.after.colorSel === undefined && r.after.shift[0] === 5000 && r.after.shift[1] === 0 && r.after.badge === null && r.after.tableBadge === null
    && r.after.groupBy[0] === 'ZONE' && r.after.rows > 0 && /pitB\.csv:AU/.test(r.after.cap) && r.report.views === 1 && r.report.tables === 1);
  chk(`OTHER DATA: the scene colours B by CU by name (${r.selB} = ${r.wantB}, A's was ${r.selA}); the original figure is untouched (${JSON.stringify(r.orig)})`,
    r.selB === r.wantB && r.selB !== r.selA && r.orig.layer === 'pitA.csv' && r.orig.figs.length === 2);
  await p.close();
}

// ── §108: A PDF WITHOUT ITS FIGURE — by default the PDF carries the figure (its scenes name the
//     files and the coordinates) so micro can open it again; "embed figure" unticked writes only the
//     page, and the choice is the figure's own (it saves with it). ──
if (take()) {
  const p = await mkPage('sm2embed');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, rows = ['XC,YC,ZC,AU']; for (let i = 0; i < 40; i++) rows.push(`${5 + (i % 8) * 10},${5 + Math.floor(i / 8) * 10},5,${i / 10}`);
    await M_.openBlob(new File([rows.join('\n') + '\n'], 'e.csv'), 'e.csv', 'replace');
    const C = await import('/ext/compo/index.js');
    const ed = M_.openComposer('embed'); M_.addViewFrame(ed);
    const fig = M_.currentFigure(), box = document.querySelector('.cmp-embed input');
    const out = { ticked: box.checked };
    out.with = !!(await C.figureFromPdf(await M_.figurePdfBytes(fig, 72))).doc;
    box.click();
    out.flag = fig.doc.embedSource;
    out.without = !!(await C.figureFromPdf(await M_.figurePdfBytes(fig, 72))).doc;
    return out;
  });
  chk(`EMBED: the PDF carries the figure by default (${r.with}); unticked it carries none (${r.without}, doc.embedSource ${r.flag})`, r.ticked && r.with && !r.without && r.flag === false);
  await p.close();
}

// ── §109: VECTOR SECTIONS v2 — any plane, rotated models, drillholes, meshes. An inclined plane
//     cuts each block into its polygon, and the polygons tile the model's cross-section exactly
//     (area); a rotated model cut square to its own lattice gives merged rectangles in the lattice's
//     basis; on an E–W section drillholes are their intervals clipped to the slab and projected, at
//     the sticks' width, and a closed mesh is one closed cut line; the PDF holds no image. ──
if (take()) {
  const p = await mkPage('sm2vsec2');
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const rows = ['XC,YC,ZC,AU,CU']; for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 30; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(0.2 + 0.05 * i).toFixed(3)},${(0.1 + 0.05 * j).toFixed(3)}`);
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
    const L = M_.layers().find((x) => x.id === id);
    await M_.setLayerColorSel(L, M_.colorSelFor(L, 'CU'));
    const ed = M_.openComposer('vsec2');
    const f = M_.addViewFrame(ed, { box: [12, 12, 180, 120] });
    const vf = () => ed.getDoc().frames.find((x) => x.id === f.id);
    const menu = () => M_.composerFrameMenu(vf(), ed);
    const vectorOn = async () => { menu().find((m) => m.label === 'Update from the 3D view').run(); await wait(800); await menu().find((m) => /^Vector section/.test(m.label)).run(); };   // the frame takes the view as it now is, then turns vector
    const area = (Ly) => { let a = 0; for (let i = 0; i < Ly.colors.length; i++) { const s = Ly.starts[i], e = i + 1 < Ly.starts.length ? Ly.starts[i + 1] : Ly.pts.length / 2; for (let k = s; k < e; k++) { const k2 = k + 1 < e ? k + 1 : s; a += Ly.pts[k * 2] * Ly.pts[k2 * 2 + 1] - Ly.pts[k2 * 2] * Ly.pts[k * 2 + 1]; } } return Math.abs(a) / 2; };
    // A. a vertical plane on the diagonal, x + y = 203, seen square-on
    await window.micro.setView({ look: 45, elevation: 0, ortho: true });
    await window.micro.setSection({ normal: [1, 1, 0], position: 203 / Math.SQRT2, thickness: 10 });
    await wait(300);
    await vectorOn();
    { const V = vf().content.vector, Ly = V && V.layers[0];
      out.incl = Ly ? { type: Ly.type, polys: Ly.colors.length, blocks: Ly.blocks, area: +area(Ly).toFixed(2), u: Ly.plane.u, v: Ly.plane.v } : { err: vf().content.vectorError }; }
    // …seen from the north instead: refused
    await window.micro.setView({ look: 0, elevation: 0, ortho: true }); await wait(200);
    menu().find((m) => m.label === 'Update from the 3D view').run(); await wait(1200);
    out.offAxis = vf().content.vectorError || null;
    // B. a rotated model (30°), cut square to its own U axis
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), U = [10 * c, 10 * s, 0], Vv = [-10 * s, 10 * c, 0], W = [0, 0, 10], O = [1000, 2000, 100];
    const E = [], N = [], RL = [], AU = [];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) { E.push(O[0] + i * U[0] + j * Vv[0]); N.push(O[1] + i * U[1] + j * Vv[1]); RL.push(O[2] + k * 10); AU.push(j); }
    const rid = await M_.addLayer({ kind: 'blocks', name: 'rot', columns: { E: Float64Array.from(E), N: Float64Array.from(N), RL: Float64Array.from(RL), AU: Float64Array.from(AU) }, roles: { x: 'E', y: 'N', z: 'RL', value: 'AU' }, lattice: { basis: { origin: O, U, V: Vv, W, counts: [8, 6, 3] } } });
    const RLy = M_.layers().find((x) => x.id === rid);
    L.visible = false; M_.applyTreeVisibility();
    await M_.setLayerColorSel(RLy, M_.colorSelFor(RLy, 'AU'));
    const nU = [c, s, 0];
    await window.micro.setView({ look: 60, elevation: 0, ortho: true });
    await window.micro.setSection({ normal: nU, position: nU[0] * O[0] + nU[1] * O[1] + 33, thickness: 10 });
    await wait(300);
    menu().find((m) => m.label === 'Update from the 3D view').run(); await wait(1500);
    { const V = vf().content.vector, Ly = V && V.layers.find((l) => l.layer === 'rot');
      out.rot = Ly ? { type: Ly.type, cells: Ly.colors.length, blocks: Ly.blocks, plane: !!Ly.plane, w: +(Ly.rects[2] - Ly.rects[0]).toFixed(3), h: +(Ly.rects[3] - Ly.rects[1]).toFixed(3) } : { err: vf().content.vectorError, layers: V && V.layers.map((l) => l.layer) }; }
    // …and cut obliquely to its lattice (a N–S plane, x = 1010): polygons, tiling the footprint's chord × 30
    await window.micro.setView({ look: 90, elevation: 0, ortho: true });
    await window.micro.setSection({ axis: 'x', position: 1010, thickness: 10 });
    await wait(300);
    menu().find((m) => m.label === 'Update from the 3D view').run(); await wait(1500);
    { const V = vf().content.vector, Ly = V && V.layers.find((l) => l.layer === 'rot');
      // the chord: the footprint parallelogram O' + a·8U + b·6V (a, b ∈ [0, 1]) along x = 1010
      const Op = [O[0] - U[0] / 2 - Vv[0] / 2, O[1] - U[1] / 2 - Vv[1] / 2]; let lo = Infinity, hi = -Infinity;
      for (let q = 0; q <= 200000; q++) { const a = q / 200000, b = (Op[0] + 8 * U[0] * a - 1010) / (-6 * Vv[0]); if (b < 0 || b > 1) continue; const y = Op[1] + 8 * U[1] * a + 6 * Vv[1] * b; lo = Math.min(lo, y); hi = Math.max(hi, y); }
      out.rotOblique = Ly ? { type: Ly.type, polys: Ly.colors.length, area: +area(Ly).toFixed(2), want: +((hi - lo) * 30).toFixed(2) } : { err: vf().content.vectorError }; }
    RLy.visible = false; L.visible = true; M_.applyTreeVisibility();
    // C + D. drillholes and a closed mesh on an E–W section at y = 100
    const did = await M_.addLayer({ kind: 'drillholes', name: 'dh',
      collar: { columns: { HOLE: ['H1', 'H2'], E: Float64Array.from([150, 100]), N: Float64Array.from([100, 130]), RL: Float64Array.from([40, 40]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: ['H1', 'H2'], AT: Float64Array.from([0, 0]), AZI: Float64Array.from([0, 180]), INC: Float64Array.from([90, 45]) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: ['H1', 'H1', 'H1', 'H2'], F: Float64Array.from([0, 10, 20, 0]), T: Float64Array.from([10, 20, 40, 60]), CU: Float64Array.from([0.4, 0.4, 0.9, 1.2]) }, roles: { bhid: 'HOLE', from: 'F', to: 'T' } } });
    const D = M_.layers().find((x) => x.id === did);
    await M_.setLayerColorSel(D, M_.colorSelFor(D, 'CU'));
    const bx = [120, 180], by = [80, 120], bz = [10, 30], vt = [];
    for (const zz of bz) for (const yy of by) for (const xx of bx) vt.push(xx, yy, zz);
    const tri = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    await M_.addLayer({ kind: 'mesh', name: 'box', vertices: Float64Array.from(vt), triangles: Uint32Array.from(tri) });
    await window.micro.setView({ look: 0, elevation: 0, ortho: true });
    await window.micro.setSection({ axis: 'y', position: 100, thickness: 10 });
    await wait(400);
    menu().find((m) => m.label === 'Update from the 3D view').run(); await wait(2000);
    { const V = vf().content.vector || { layers: [] };
      const dl = V.layers.find((l) => l.type === 'lines' && l.intervals != null), ml = V.layers.find((l) => l.type === 'lines' && l.segments != null);
      const lines = (Ly) => Ly.starts.map((s0, i) => { const e = i + 1 < Ly.starts.length ? Ly.starts[i + 1] : Ly.pts.length / 2, ps = []; for (let k = s0; k < e; k++) ps.push([+Ly.pts[k * 2].toFixed(2), +Ly.pts[k * 2 + 1].toFixed(2)]); return ps; });
      const toWorld = (Ly, [u, v]) => [0, 1, 2].map((a) => +(Ly.plane.origin[a] + u * Ly.plane.u[a] + v * Ly.plane.v[a]).toFixed(2));
      out.dh = dl ? { lines: lines(dl).map((ps) => ps.map((q) => toWorld(dl, q))), width: dl.width, radius: window._micro.renderer.layerStickRadius(D.id), colours: dl.palette.length } : { err: vf().content.vectorError, notes: V.notes };
      out.mesh = ml ? { lines: lines(ml).map((ps) => ps.map((q) => toWorld(ml, q))) } : { notes: V.notes };
      out.blocksV1 = !!V.layers.find((l) => l.layer === 'm.csv' && l.axis); }
    const bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    out.images = (new TextDecoder('latin1').decode(bytes).match(/\/Subtype \/Image/g) || []).length;
    return out;
  });
  const want = 200 * Math.SQRT2 * 40;
  chk(`VECTOR v2: an inclined plane cuts each block into its polygon, and they tile the model's cross-section (area ${r.incl.area} vs ${want.toFixed(2)}; ${JSON.stringify(r.incl)})`,
    r.incl.type === 'polys' && r.incl.polys === r.incl.blocks && Math.abs(r.incl.area - want) < 0.5 && r.incl.v[2] === 1 && r.incl.u[0] > 0);
  chk(`VECTOR v2: the inclined section seen from elsewhere is refused (“${r.offAxis}”)`, /square-on/.test(r.offAxis || ''));
  chk(`VECTOR v2: a rotated model cut square to its lattice → merged rectangles in the lattice's basis (${JSON.stringify(r.rot)})`,
    r.rot.type === 'cells' && r.rot.plane && r.rot.blocks === 18 && r.rot.cells === 6 && r.rot.w === 10 && r.rot.h === 30);
  chk(`VECTOR v2: the rotated model cut obliquely → polygons tiling its chord (${JSON.stringify(r.rotOblique)})`,
    r.rotOblique.type === 'polys' && r.rotOblique.polys > 0 && Math.abs(r.rotOblique.area - r.rotOblique.want) < 0.5);
  const h1 = r.dh.lines && r.dh.lines.filter((ps) => ps.every((q) => q[0] === 150)), h2 = r.dh.lines && r.dh.lines.find((ps) => ps.every((q) => q[0] === 100));
  const zs = h2 ? h2.map((q) => q[2]).sort((a, b) => a - b) : [];
  chk(`VECTOR v2: drillholes — H1 whole in the slab (2 colours → ${h1 && h1.length} lines, z 40 → 0), H2 clipped to the slab and projected (z ${zs.join('…')}), width = the sticks' diameter (${r.dh.width} = 2×${r.dh.radius}) (${JSON.stringify(r.dh).slice(0, 300)})`,
    h1 && h1.length === 2 && Math.max(...h1.flat().map((q) => q[2])) === 40 && Math.min(...h1.flat().map((q) => q[2])) === 0 && h1.flat().every((q) => q[1] === 100)
    && zs.length === 2 && Math.abs(zs[0] - 5) < 0.01 && Math.abs(zs[1] - 15) < 0.01 && r.dh.width === 2 * r.dh.radius);
  const ml = r.mesh.lines || [], loop = ml[0] || [], xs = loop.map((q) => q[0]), zz = loop.map((q) => q[2]);
  chk(`VECTOR v2: the closed mesh is one closed cut line round x 120…180, z 10…30 on y = 100 (${JSON.stringify(r.mesh).slice(0, 300)})`,
    ml.length === 1 && loop.length >= 5 && String(loop[0]) === String(loop[loop.length - 1]) && Math.min(...xs) === 120 && Math.max(...xs) === 180 && Math.min(...zz) === 10 && Math.max(...zz) === 30 && loop.every((q) => q[1] === 100));
  chk(`VECTOR v2: blocks on an axis section keep v1's form (${r.blocksV1}); the PDF holds no image (${r.images})`, r.blocksV1 && r.images === 0);
  await p.close();
}

// ── §110: ROUTINE FIXES (routines v2 step 1) — a step a window refuses fails AT ONCE with the
//     window's reason (it waited out a 10-minute timeout); Retry carries on with the same run, and
//     the atlas keeps the pages made before the stop; a figure step is awaited and writes its
//     `out`; an invalid calc column, a stats column the layer lacks and a series on a layer that
//     isn't loaded are SAID, never swapped for something else; reports file under the LOCAL date;
//     validation's swath weights sub-blocks by their own volume. ──
if (take()) {
  const p = await mkPage('sm2fix');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2fix', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(40 + i + j).toFixed(1)}`);
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const dir = M_.project().dir;
    const L = M_.layers()[0], id = L.id;
    const ed = M_.openComposer('F'); M_.addViewFrame(ed); await wait(300);
    // A. a refused step fails fast; Retry → the same run carries on, the book keeps page 1
    const t0 = Date.now();
    M_.runRoutine({ name: 'fix', tool: 'routine', params: { steps: [
      { tool: 'compo', figure: 'F', book: 'atlas/b.pdf', dpi: 72 },
      { tool: 'stats', with: { layer: 'm.csv', cols: ['FE2'] }, as: 'st2' },
      { tool: 'figure', out: 'figs/f.png' },
      { tool: 'compo', figure: 'F', book: 'atlas/b.pdf', dpi: 72 },
    ] } });
    out.stopMeta = await waitMeta(/STOPPED/, 60000); out.stopMs = Date.now() - t0;
    out.stopIcons = [...(document.querySelector('.fwin[data-routine-run]') || document.createElement('div')).querySelectorAll('.rw-state')].map((x) => x.textContent).join('');
    document.querySelectorAll('.fwin:not([data-routine-run])').forEach((w) => { const c = w.querySelector('.fwin-head button:last-child'); if (c && !w.dataset.routineRun && /scatter/.test(w.textContent)) c.click(); });
    M_.applyCalcCols(L, [{ name: 'FE2', expr: 'FE * 2', ty: 'number' }]);   // the fix: the column the step wanted
    const rb = [...document.querySelectorAll('.fwin[data-routine-run] button')].find((b) => b.textContent === 'Retry step'); if (!rb) return out; rb.click();
    out.doneMeta = await waitMeta(/routine “fix” — \d+ steps? run/, 90000);
    out.doneIcons = [...(document.querySelector('.fwin[data-routine-run]') || document.createElement('div')).querySelectorAll('.rw-state')].map((x) => x.textContent).join('');
    const read = async (path) => { let d = dir; const parts = path.split('/'); for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); return (await d.getFileHandle(parts[parts.length - 1])).getFile(); };
    const pdf = new TextDecoder('latin1').decode(await (await read('atlas/b.pdf')).arrayBuffer());
    out.pages = (pdf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
    out.png = await read('figs/f.png').then((f) => f.size, () => 0);
    const { localDate } = await import('/tools/micro/src/recipes.js');
    { let rd = null; for await (const [k, h] of (await dir.getDirectoryHandle('runs')).entries()) if (k.startsWith(localDate()) && k.endsWith(' fix')) rd = k;
      out.report = rd ? await read(`runs/${rd}/st2.tsv`).then((f) => f.size, () => 0) : 0; }
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // B. an invalid calc column fails the step, naming it
    M_.runRoutine({ name: 'badcalc', tool: 'routine', params: { steps: [{ tool: 'calccols', layer: 'm.csv', cols: [{ name: 'BAD', expr: 'FE +* 2' }] }] } });
    out.calc = await waitMeta(/badcalc.*(STOPPED|steps? run)/, 30000);   // the OUTCOME, not the running line (calccols awaits its type inference now)
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // C. stats on a column the layer lacks: refused, not computed on another column
    const t1 = Date.now();
    M_.runRoutine({ name: 'badstats', tool: 'routine', params: { steps: [{ tool: 'stats', layer: 'm.csv', cols: ['NOPE'] }] } });
    out.stats = await waitMeta(/badstats.*(STOPPED|steps? run)/, 30000); out.statsMs = Date.now() - t1;
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // D. a second series on a layer that isn't loaded: left out, and the window says so
    M_.openGradeTonnage(L, { cfg: { series: [{ layer: 'm.csv', col: 'FE' }, { layer: 'gone.csv', col: 'FE' }], nCut: 4 }, run: false });
    await wait(200);
    const gw = [...document.querySelectorAll('.fwin')].find((w) => /grade-tonnage/.test(w.textContent));
    out.series = gw ? gw.querySelector('.fwin-sub, .sub, [class*=sub]') && gw.textContent.match(/left out[^\n]*?gone\.csv/) ? 'noted' : gw.textContent.slice(0, 200) : 'no window';
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // E. validation's swath: a 10 m parent (grade 1) and its eight 5 m neighbours (grade 0) and a second parent (grade 0) in one band → 1000 / 3000 by volume (1/10 by count)
    const X = [5], Y = [5], Z = [5], D = [10], G = [1];
    for (const dx of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) { X.push(15 + dx); Y.push(5 + dy); Z.push(5 + dz); D.push(5); G.push(0); }
    X.push(25, 5, 25); Y.push(5, 15, 15); Z.push(5, 5, 5); D.push(10, 10, 10); G.push(0, 0, 0);
    const sid = await M_.addLayer({ kind: 'blocks', name: 'subs', columns: { X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), S: Float64Array.from(D), G: Float64Array.from(G) }, roles: { x: 'X', y: 'Y', z: 'Z' }, sizes: { dx: 'S', dy: 'S', dz: 'S' } });
    const SL = M_.layers().find((x) => x.id === sid);
    const sw = await M_.computeSwath(SL, ['G'], [1, 0, 0], 20, 0, '');
    out.sub = { subBlocked: !!SL.docs.blockDoc.header.subBlocked, band0: sw.profile.find((b) => b.band === 0) };
    return out;
  });
  chk(`ROUTINE FIX: a refused step fails at once with the window's reason (${r.stopMs} ms, “${r.stopMeta.slice(0, 120)}”, ${r.stopIcons})`,
    /STOPPED at step 2/.test(r.stopMeta) && /FE2/.test(r.stopMeta) && r.stopMs < 20000 && r.stopIcons === '✓✗··');
  chk(`ROUTINE FIX: Retry carries on with the same run — the book keeps the page made before the stop (${r.pages} pages; “${r.doneMeta.slice(0, 120)}”, ${r.doneIcons})`,
    r.pages === 2 && r.doneIcons === '–✓✓✓');
  chk(`ROUTINE FIX: the figure step is awaited and writes its out: (figs/f.png ${r.png} B); the report files under the LOCAL date (${r.report} B)`, r.png > 1000 && r.report > 0);
  chk(`ROUTINE FIX: an invalid calc column fails the step, naming it (“${r.calc.slice(0, 120)}”)`, /STOPPED/.test(r.calc) && /invalid expression for BAD/.test(r.calc));
  chk(`ROUTINE FIX: stats on a column the layer lacks is refused, not computed on another (“${r.stats.slice(0, 120)}”, ${r.statsMs} ms)`, /STOPPED/.test(r.stats) && /no numeric column “NOPE”/.test(r.stats) && r.statsMs < 20000);
  chk(`ROUTINE FIX: a series on a layer that isn't loaded is left out and named (${r.series})`, r.series === 'noted');
  chk(`ROUTINE FIX: validation's swath weights sub-blocks by their own volume (${JSON.stringify(r.sub)})`, r.sub.subBlocked && r.sub.band0 && Math.abs(r.sub.band0.mean[0] - 1 / 3) < 1e-9);
  await p.close();
}

// ── §111: PARITY PINS (routines v2 step 1) — grade-tonnage, stats and swath run through a routine on
//     a fixed model, their numbers pinned. The tool contract (step 2) moves these computations out of
//     the windows; it must reproduce these exact numbers. ──
if (take()) {
  const p = await mkPage('sm2pin');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2pin', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,SIO2,DENS,DOM'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++)
      rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (30 + 3 * i + 2 * j - k + ((i * 7 + j * 3) % 5)).toFixed(2), (20 - i + ((j * 5) % 4)).toFixed(2), (2.4 + 0.1 * (k % 3)).toFixed(2), i < 5 ? 'hem' : 'itb'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'pin.csv'), 'pin.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    M_.runRoutine({ name: 'pin', tool: 'routine', params: { output: { dir: 'pins' }, steps: [
      { tool: 'gt', layer: 'pin.csv', series: [{ layer: 'pin.csv', col: 'FE', weight: 'DENS' }], cutoffs: [15, 30, 45, 60, 75], as: 'gt' },   // a routine states its cutoffs: the ones the window chose automatically
      { tool: 'stats', layer: 'pin.csv', cols: ['FE', 'SIO2'], groupBy: 'DOM', weight: 'DENS', as: 'stats' },
      { tool: 'swath', layer: 'pin.csv', series: [{ layer: 'pin.csv', col: 'FE' }], mode: 'axes', bandW: [20, 20, 10], off: [0, 0, 0], as: 'swath' },
    ] } });
    const meta = await waitMeta(/routine “pin” (— \d+ steps? run|STOPPED|cancelled)/);
    const dir = M_.project().dir, pins = await dir.getDirectoryHandle('pins').catch(() => null);
    const read = async (n) => { try { return await (await (await pins.getFileHandle(n)).getFile()).text(); } catch { return null; } };   // pins null → every read null
    return { meta, gt: await read('gt.tsv'), stats: await read('stats.tsv'), swath: await read('swath.tsv') };
  });
  // numbers only, in reading order — the TSV's layout may change (machine tables), its numbers may not.
  // swath reports every direction now (tidy rows: series, direction, …): the pin is the first one's
  const firstDir = (t) => { const L = (t || '').split('\n'), h = (L[0] || '').split('\t'), di = h.indexOf('direction'); if (di < 0) return t; const d0 = (L[1] || '').split('\t')[di]; return [L[0], ...L.slice(1).filter((l) => l.split('\t')[di] === d0)].join('\n'); };
  const nums = (t) => (t || '').split('\n').slice(1).map((l) => l.split('\t').map((c) => c.trim()).filter((c) => c !== '' && Number.isFinite(+c)).map((c) => +(+c).toPrecision(8))).filter((a) => a.length);
  if (process.env.SM2_PIN_PRINT) console.log(JSON.stringify({ meta: r.meta, gt: r.gt, stats: r.stats, swath: r.swath }, null, 1));
  // pinned 2026-11-22 from the window path (gt: tonnes-weighted by DENS, automatic cutoffs; stats:
  // DENS-weighted, by DOM; swath: X only, 20 m bands) — the tool contract must give these numbers
  const PIN = {
    gt: [[15, 792000, 50.994949, 40388000], [30, 784500, 51.214659, 40177900], [45, 555900, 56.045692, 31155800], [60, 169800, 64.601885, 10969400], [75, 2400, 75, 180000]],
    stats: [[160, 43.494949, 6.6120853, 27, 39, 43.5, 48, 60], [160, 19.5, 1.8027756, 16, 18, 19.5, 21, 23], [160, 58.494949, 6.6120853, 42, 54, 58.5, 63, 75], [160, 14.5, 1.8027756, 11, 13, 14.5, 16, 18]],
    swath: [[10, 64, 64000, 38.8125], [30, 64, 64000, 45.0625], [50, 64, 64000, 51], [70, 64, 64000, 56.9375], [90, 64, 64000, 63.1875]],
  };
  chk(`PARITY: the routine ran all three (“${r.meta.slice(0, 100)}”)`, /3 steps run/.test(r.meta) && r.gt && r.stats && r.swath);
  if (PIN) for (const k of ['gt', 'stats', 'swath']) chk(`PARITY: ${k} reproduces its pinned numbers`, JSON.stringify(nums(k === 'swath' ? firstDir(r[k]) : r[k])) === JSON.stringify(PIN[k]));
  await p.close();
}

// ── §112: THE TOOL CONTRACT (routines v2 step 2) — a routine's gt / stats / swath steps run without a
//     window: the user's open window stays open and its saved setup untouched; reports are machine
//     tables; settings are checked before anything runs (an unknown one names the nearest real one;
//     a routine states its cutoffs and band widths and runs on scope all); settings under `with:`
//     keep a stats `filter:` (the old step form dropped it as a step keyword); a cutoff between two
//     grade steps is SAID on the step's line. ──
if (take()) {
  const p = await mkPage('sm2tools');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2tools', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,DENS,DOM'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (30 + 3 * i + 2 * j).toFixed(2), '2.5', i < 5 ? 'hem' : 'itb'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const L = M_.layers()[0], dir = M_.project().dir;
    const read = async (path) => { let d = dir; const parts = path.split('/'); try { for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); } catch { return null; } };
    const run = async (name, steps) => { document.querySelector('#meta').textContent = ''; M_.runRoutine({ name, tool: 'routine', params: { output: { dir: 'out' }, steps } }); return waitMeta(new RegExp(`routine( “${name}”)?.*(— \\d+ steps? run|STOPPED|cancelled|must state|no setting|allows)`), 60000); };
    // A. the user's GT window, configured; a routine's gt step must not touch it
    M_.openGradeTonnage(L, { cfg: { series: [{ layer: 'm.csv', col: 'FE' }], nCut: 7 }, run: false }); await wait(200);
    const before = JSON.stringify(L.analysis && L.analysis.gt), winsBefore = document.querySelectorAll('.fwin').length;
    let opened = 0; const mo = new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('fwin') && !n.dataset.routineRun) opened++; }); mo.observe(document.body, { childList: true, subtree: true });
    out.a = await run('quiet', [{ tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE', weight: 'DENS' }], cutoffs: [30, 40, 50] }, as: 'gt' }]);
    mo.disconnect();
    out.aWin = { opened, stillOpen: [...document.querySelectorAll('.fwin')].some((w) => /grade-tonnage/.test(w.textContent)), sameCfg: JSON.stringify(L.analysis && L.analysis.gt) === before, winsBefore };
    out.aTsv = await read('out/gt.tsv');
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // B. an unknown setting: refused before anything runs, naming the nearest real one
    out.b = await run('typo', [{ tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], cutofs: [30, 40] }, as: 'g2' }]);
    out.bRan = !!document.querySelector('.fwin[data-routine-run]');
    // C. automatic cutoffs and a selection scope: a routine refuses both
    out.c = await run('auto', [{ tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], nCut: 5, scope: 'selection' }, as: 'g3' }]);
    // D. `with:` keeps the stats filter — hem only (160 of 320)
    out.d = await run('withf', [{ tool: 'stats', with: { layer: 'm.csv', cols: ['FE'], filter: 'DOM = "hem"' }, as: 'st' }]);
    out.dTsv = await read('out/st.tsv');
    document.querySelectorAll('.fwin').forEach((w) => w.remove());
    // E. a cutoff between grade steps is said on the step's line (still ✓)
    out.e = await run('offstep', [{ tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], cutoffs: [30, 40.0001] }, as: 'g4' }]);
    out.eNote = [...document.querySelectorAll('.fwin[data-routine-run] .rw-prevline.warn')].map((x) => x.textContent.trim()).join(' | ');
    return out;
  });
  chk(`TOOLS: a routine's gt step opens no window (${JSON.stringify(r.aWin)}) and writes a machine table (“${(r.aTsv || '').split('\n')[0]}”)`,
    /1 step run/.test(r.a) && r.aWin.opened === 0 && r.aWin.stillOpen && r.aWin.sameCfg && /^series\tcutoff\ttonnes\tgrade\tmetal/.test(r.aTsv || ''));
  chk(`TOOLS: an unknown setting is refused before anything runs, naming the real one (“${r.b.slice(0, 140)}”)`, /no setting “cutofs” — did you mean “cutoffs”/.test(r.b) && !r.bRan);
  chk(`TOOLS: a routine states its cutoffs and runs on scope all (“${r.c.slice(0, 200)}”)`, /cutoffs: a routine must state it/.test(r.c) && /scope: a routine allows "all"/.test(r.c));
  const dRow = (r.dTsv || '').split('\n')[1] || '';
  chk(`TOOLS: settings under with: keep the stats filter (${dRow.split('\t').slice(0, 3).join(' · ')})`, /1 step run/.test(r.d) && dRow.split('\t')[1] === '160');
  chk(`TOOLS: a cutoff between grade steps is said on the step's line (“${r.eNote}”)`, /1 step run/.test(r.e) && /40\.0001 not on the/.test(r.eNote));
  await p.close();
}

// ── §113: VALIDATION and the RESOURCE TABLE as tools — a routine runs both without a window:
//     validation's numbers are the window's (one function), its bias the model over the declustered
//     samples; the resource table's machine form leaves out the "total" rows; a routine must state
//     the validation band width, and a misspelled setting names the real one. ──
if (take()) {
  const p = await mkPage('sm2vtools');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2vtools', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,DOM'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + 2 * i).toFixed(2), i < 5 ? 'hem' : 'itb'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const dir = M_.project().dir;
    const read = async (path) => { let d = dir; const parts = path.split('/'); try { for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); } catch { return null; } };
    const run = async (name, steps) => { document.querySelector('#meta').textContent = ''; M_.runRoutine({ name, tool: 'routine', params: { output: { dir: 'out' }, steps } }); return waitMeta(new RegExp(`(— \\d+ steps? run|STOPPED|cancelled|routine: )`), 60000); };
    // vertical holes on a 20 m grid, FE = the model's value there + 3 (so the model is biased low)
    const H = [], E = [], N = [], RL = [], hs = [], fs = [], ts = [], fe = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) { const id = `H${i}${j}`, x = 5 + i * 20, y = 5 + j * 20; H.push(id); E.push(x); N.push(y); RL.push(40);
      for (let k = 0; k < 4; k++) { hs.push(id); fs.push(k * 10); ts.push(k * 10 + 10); fe.push(40 + 2 * ((x - 5) / 10) + 3); } }
    await M_.addLayer({ kind: 'drillholes', name: 'dh',
      collar: { columns: { HOLE: H, E: Float64Array.from(E), N: Float64Array.from(N), RL: Float64Array.from(RL) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: H, AT: Float64Array.from(H.map(() => 0)), AZI: Float64Array.from(H.map(() => 0)), INC: Float64Array.from(H.map(() => 90)) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: hs, F: Float64Array.from(fs), T: Float64Array.from(ts), FE: Float64Array.from(fe) }, roles: { bhid: 'HOLE', from: 'F', to: 'T' } } });
    const D = M_.layers().find((x) => x.dh), dname = D.name;
    out.v = await run('val', [{ tool: 'validation', with: { model: 'm.csv', samples: dname, modelGrade: 'FE', sampleGrade: 'FE', bandW: 20 }, as: 'val' }]);
    out.vTsv = await read('out/val.tsv');
    const T = M_, validationRun = M_.validationRun;   // through the test surface: the built file has no dev modules
    const tv = await T.runTool('validation', { model: 'm.csv', samples: dname, modelGrade: 'FE', sampleGrade: 'FE', bandW: 20 });
    const wv = await validationRun({ M: M_.layers()[0], D, mGrade: 'FE', sGrade: 'FE', axis: 0, bandW: 20, off: 0 });
    out.vals = tv.values; out.same = tv.values.bias_pct === wv.biasPct && tv.values.model_mean === wv.modelMean;
    out.r = await run('res', [{ tool: 'resource', with: { layer: 'm.csv', grade: 'FE', cutoffs: [0, 50], groupBy: ['DOM'], density: { const: 2.5 } }, as: 'res' }]);
    out.rTsv = await read('out/res.tsv');
    out.noBand = await run('noband', [{ tool: 'validation', with: { model: 'm.csv', samples: dname, modelGrade: 'FE', sampleGrade: 'FE' }, as: 'v2' }]);
    out.typo = await run('rtypo', [{ tool: 'resource', with: { layer: 'm.csv', grade: 'FE', cutoff: [0] }, as: 'r2' }]);
    return out;
  });
  const vRows = (r.vTsv || '').trim().split('\n');
  chk(`TOOLS: validation runs as a routine step (“${(r.v || '').slice(0, 80)}”; ${vRows[0]}); its numbers are the window's function's (${r.same}); bias ${r.vals && r.vals.bias_pct && r.vals.bias_pct.toFixed(2)}% = model ${r.vals && r.vals.model_mean && r.vals.model_mean.toFixed(2)} / samples ${r.vals && r.vals.samples_declustered && r.vals.samples_declustered.toFixed(2)} − 1`,
    /1 step run/.test(r.v) && vRows[0] === 'center\tmodel_mean\tmodel_volume\tsample_mean\tsample_count' && r.same && r.vals.bias_pct < 0 && Math.abs(r.vals.bias_pct - (r.vals.model_mean / r.vals.samples_declustered - 1) * 100) < 1e-9 && r.vals.samples === 80);
  const rRows = (r.rTsv || '').trim().split('\n');
  chk(`TOOLS: the resource table as a routine step — a machine table without the "total" rows (${rRows.length - 1} rows: ${rRows.map((l) => l.split('\t').slice(0, 2).join('/')).join(' ')})`,
    /1 step run/.test(r.r) && rRows[0] === 'cutoff\tDOM\ttonnes\tgrade\tmetal' && rRows.length === 1 + 3 && !rRows.some((l) => /\ttotal\t/.test(l)));
  chk(`TOOLS: a routine states the validation band width (“${r.noBand.slice(0, 110)}”); a misspelled resource setting names the real one (“${r.typo.slice(0, 120)}”)`,
    /bandW: a routine must state it/.test(r.noBand) && /no setting “cutoff” — did you mean “cutoffs”/.test(r.typo));
  await p.close();
}

// ── §114: THE RUN RECORD (routines v2 step 3) — a run leaves runs/<local date> <hhmm> <routine>/ with
//     run.json beside its reports: the routine's hash, the micro build, every layer's files with
//     their SHA-256 (checked here against WebCrypto's), every step's settings with the automatic
//     values pinned, its outputs with their SHA-256, its values; a failed run's record says so, and
//     Retry continues the SAME record with the event logged; a second run gets its own folder. ──
if (take()) {
  const p = await mkPage('sm2rec');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2rec', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(40 + i + j).toFixed(1)}`);
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const dir = M_.project().dir, L = M_.layers()[0];
    const runDirs = async () => { const o = []; try { for await (const [k] of (await dir.getDirectoryHandle('runs')).entries()) o.push(k); } catch { } return o.sort(); };
    const readText = async (path) => { let d = dir; const parts = path.split('/'); for (const s of parts.slice(0, -1)) d = await d.getDirectoryHandle(s); return (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text(); };
    const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const steps = [
      { tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], cutoffs: [40, 45, 50] }, as: 'gt' },
      { tool: 'stats', with: { layer: 'm.csv', cols: ['FE'] }, as: 'st' },
    ];
    document.querySelector('#meta').textContent = '';
    M_.runRoutine({ name: 'month end', tool: 'routine', params: { steps } });
    out.meta = await waitMeta(/routine “month end” (— \d+ steps? run|STOPPED)/);
    const d1 = (await runDirs()).find((k) => k.endsWith(' month-end'));
    out.dir = d1;
    const rec = JSON.parse(await readText(`runs/${d1}/run.json`));
    const report = await readText(`runs/${d1}/gt.tsv`);
    const srcBlob = M_.layers()[0].docs.blockDoc.blob;
    out.rec = { v: rec.v, status: rec.status, micro: rec.micro, routineHash: !!rec.routine.sha256, finished: !!rec.finished,
      layer: rec.layers[0] && { name: rec.layers[0].name, size: rec.layers[0].files[0].size, sha: rec.layers[0].files[0].sha256 },
      steps: rec.steps.map((s) => ({ step: s.step, tool: s.tool, status: s.status, cutoffs: s.params && s.params.cutoffs, out: s.outputs.map((o) => o.path), key: s.key })),
      outSha: rec.steps[0].outputs[0].sha256 };
    out.srcSha = await hex(await srcBlob.arrayBuffer());
    out.repSha = await hex(new TextEncoder().encode(report));
    // a second run in the same minute: its own folder
    document.querySelector('#meta').textContent = '';
    M_.runRoutine({ name: 'month end', tool: 'routine', params: { steps } });
    await waitMeta(/routine “month end” (— \d+ steps? run|STOPPED)/);
    out.dirs = (await runDirs()).filter((k) => k.includes('month-end'));
    // a failing run (xy on a selection there is none of), then Retry once there is one
    document.querySelector('#meta').textContent = '';
    M_.runRoutine({ name: 'flaky', tool: 'routine', params: { steps: [{ tool: 'stats', with: { layer: 'm.csv', cols: ['FE3'] }, as: 'st3' }] } });   // fails at run time: no FE3 yet
    await waitMeta(/STOPPED/);
    const fd = (await runDirs()).find((k) => k.endsWith(' flaky'));
    out.failed = JSON.parse(await readText(`runs/${fd}/run.json`)).status;
    document.querySelectorAll('.fwin:not([data-routine-run])').forEach((w) => w.remove());
    M_.applyCalcCols(L, [{ name: 'FE3', expr: 'FE * 3', ty: 'number' }]);
    document.querySelector('#meta').textContent = '';
    [...document.querySelectorAll('.fwin[data-routine-run] button')].find((b) => b.textContent === 'Retry step').click();
    await waitMeta(/routine “flaky” — \d+ steps? run/);
    const fr = JSON.parse(await readText(`runs/${fd}/run.json`));
    out.retry = { status: fr.status, events: fr.events.map((e) => e.kind), step: fr.steps[0].status, sameDir: (await runDirs()).filter((k) => k.endsWith(' flaky')).length };
    return out;
  });
  chk(`RUN RECORD: runs/${r.dir}/run.json — status ${r.rec.status}, build ${r.rec.micro}, the routine hashed (${r.rec.routineHash}), finished (${r.rec.finished})`,
    /^\d{4}-\d\d-\d\d \d{4} month-end$/.test(r.dir || '') && r.rec.v === 1 && r.rec.status === 'ok' && r.rec.micro && r.rec.routineHash && r.rec.finished);
  chk(`RUN RECORD: the layer's file SHA-256 is WebCrypto's (${(r.rec.layer && r.rec.layer.sha || '').slice(0, 12)}… = ${r.srcSha.slice(0, 12)}…)`, r.rec.layer && r.rec.layer.sha === r.srcSha && r.rec.layer.size > 0);
  chk(`RUN RECORD: each step with its settings pinned, its outputs and their SHA-256 (${JSON.stringify(r.rec.steps)})`,
    r.rec.steps.length === 2 && r.rec.steps.every((s) => s.status === 'ok') && JSON.stringify(r.rec.steps[0].cutoffs) === '[40,45,50]'
    && r.rec.steps[0].out[0] === `runs/${r.dir}/gt.tsv` && JSON.stringify(r.rec.steps[0].key) === '["series","cutoff"]' && r.rec.outSha === r.repSha);
  chk(`RUN RECORD: a second run gets its own folder (${r.dirs.join(' · ')})`, r.dirs.length === 2 && new Set(r.dirs).size === 2 && (r.dirs[1] === r.dirs[0] + '-2' || r.dirs[0].slice(0, 15) !== r.dirs[1].slice(0, 15)));   // the same minute → -2; a minute later → its own stamp
  chk(`RUN RECORD: a failed run's record says so (${r.failed}); Retry continues the SAME record (${JSON.stringify(r.retry)})`,
    r.failed === 'failed' && r.retry.status === 'ok' && r.retry.events.join() === 'start,retry' && r.retry.step === 'ok' && r.retry.sameDir === 1);
  await p.close();
}

// ── §115: CHECKS and COMPARISONS (routines v2 step 4) — a routine judges its results: a scalar
//     check over a step's values (passes, records what it read), a row check over a table, a check
//     that reads a baseline value before any baseline exists is NOT EVALUATED (warn: the run goes
//     on; stop: it stops); Accept marks the baseline (a sidecar); the next run compares with the
//     ACCEPTED run (not merely the latest), row by row and in a compare table; a changed model fails
//     the tolerance, naming the rows, and stops. ──
if (take()) {
  const p = await mkPage('sm2checks');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2checks', { recursive: true }); } catch { } });
  const csv = (bump) => { const rows = ['XC,YC,ZC,FE,DOM']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + 2 * i + bump).toFixed(2), i < 4 ? 'hem' : 'itb'].join(',')); return rows.join('\n') + '\n'; };
  await p.evaluate(async (t) => { await window._micro.openBlob(new File([t], 'm.csv'), 'm.csv', 'replace'); }, csv(0));
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async (csv5) => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const run = async (name, steps) => { document.querySelector('#meta').textContent = ''; document.querySelectorAll('.fwin').forEach((w) => w.remove()); M_.runRoutine({ name, tool: 'routine', params: { steps } }); return waitMeta(new RegExp(`routine “${name}” (— \\d+ steps? run|STOPPED)|routine: `)); };
    const latest = async (name) => (await M_.listRuns()).find((x) => x.rec.routine.name === name);
    const gt = { tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], cutoffs: [40, 45, 50] }, as: 'gt' };
    // A. checks on a first run: a scalar over values; a row check; a prev check with no baseline (warn)
    out.a = await run('month', [gt,
      { tool: 'stats', with: { layer: 'm.csv', cols: ['FE'] }, as: 'st' },
      { check: { every: 'volume >= 0', in: 'gt' }, say: 'no negative volume' },
      { check: { every: 'abs(volume / prev.volume - 1) < 0.01', in: 'gt', against: 'prev' }, level: 'warn', say: 'within 1% of last month' },
      { compare: 'gt', tolerance: 0.05, level: 'warn' },
    ]);
    const A = await latest('month');
    out.aRec = { status: A.rec.status, baseline: A.rec.baseline, checks: A.rec.steps.filter((s) => s.kind).map((s) => ({ step: s.step, status: s.status, why: s.why || null })) };
    // B. accept A; run B (identical data) — compares with A: passes, and the compare table is written
    await M_.acceptRun(A.dir, 'tester');
    out.b = await run('month', [gt,
      { check: { every: 'abs(volume / prev.volume - 1) < 0.01', in: 'gt', against: 'prev' }, say: 'within 1% of last month' },
      { compare: 'gt', tolerance: 0.05 },
    ]);
    const B = await latest('month');
    out.bRec = { status: B.rec.status, baseline: B.rec.baseline, checks: B.rec.steps.filter((s) => s.kind).map((s) => ({ status: s.status, out: s.outputs ? s.outputs.map((o) => o.path) : null })) };
    // C. the model changes (+5 FE, so more volume above each cutoff); C compares with A — the ACCEPTED run — and stops
    await M_.openBlob(new File([csv5], 'm.csv'), 'm.csv', 'replace');
    await wait(500);
    out.c = await run('month', [gt, { compare: 'gt', tolerance: 0.05, say: 'tonnage within 5% of the accepted run' }]);
    const C = await latest('month');
    const cc = C.rec.steps.find((s) => s.kind === 'compare');
    out.cRec = { status: C.rec.status, baseline: C.rec.baseline, baseIsA: C.rec.baseline && C.rec.baseline.dir === A.dir, cmp: cc && { status: cc.status, failingCount: cc.failingCount, first: cc.failing && cc.failing[0] } };
    // D. a scalar check that fails at warn, recording what it read; a scalar over a missing baseline value
    out.e = await run('scal2', [{ tool: 'stats', with: { layer: 'm.csv', cols: ['FE'] }, as: 'st' }, { check: 'st_n > 0' }]);
    return out;
  }, csv(5));
  chk(`CHECKS: a first run — a row check passes; checks against a baseline that doesn't exist are NOT EVALUATED (warn → the run goes on) (${JSON.stringify(r.aRec)})`,
    r.aRec.status === 'ok' && r.aRec.baseline === null && r.aRec.checks.length === 3 && r.aRec.checks[0].status === 'pass'
    && r.aRec.checks[1].status === 'warn: not-evaluated' && r.aRec.checks[2].status === 'warn: not-evaluated' && /no baseline/.test(r.aRec.checks[2].why || ''));
  chk(`CHECKS: after Accept, the next run compares with it — row check and compare table pass (${JSON.stringify(r.bRec)})`,
    r.bRec.status === 'ok' && r.bRec.baseline && r.bRec.baseline.accepted && r.bRec.checks.every((c) => c.status === 'pass') && /gt-compare\.tsv$/.test((r.bRec.checks[1].out || [])[0] || ''));
  chk(`CHECKS: a changed model fails the tolerance against the ACCEPTED run (not the latest), naming rows, and stops (“${r.c.slice(0, 160)}”; ${JSON.stringify(r.cRec)})`,
    /STOPPED/.test(r.c) && /tonnage within 5% of the accepted run/.test(r.c) && r.cRec.status === 'failed' && r.cRec.baseIsA && r.cRec.cmp.status === 'fail' && r.cRec.cmp.failingCount > 0);
  chk(`CHECKS: an unknown name in a check is an error naming what there is (“${r.e.slice(0, 140)}”)`, /STOPPED/.test(r.e) && /unknown column: st_n/.test(r.e));
  await p.close();
}

// ── §116: TOOLS and ROUTINES on the HOST API (window.micro, routines v2) — a host lists the tools and
//     runs one (no window); lists routines, dry-runs one (every step, every problem, nothing written),
//     runs one to the end with its inputs given up front (a missing input rejects — never a dialog),
//     hears each step, gets the run record back; lists the runs and accepts one. ──
if (take()) {
  const p = await mkPage('sm2hostrt');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2hostrt', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(40 + i + j).toFixed(1)}`);
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const m = window.micro, out = {};
    const tools = m.tools(); out.tools = tools.map((t) => t.name); out.gtCut = tools.find((t) => t.name === 'gt').params.cutoffs;
    const before = document.querySelectorAll('.fwin').length;
    const one = await m.runTool('gt', { layer: 'm.csv', series: [{ col: 'FE' }], cutoffs: [40, 45] });
    out.one = { cols: one.table.columns, rows: one.table.rows.length, win: document.querySelectorAll('.fwin').length - before };
    try { await m.runTool('gt', { layer: 'm.csv', series: [{ col: 'FE' }], cutofs: [1] }); } catch (e) { out.oneErr = e.message; }
    window._micro._recipesList().push({ name: 'monthly', tool: 'routine', inputs: [{ name: 'g', type: 'column' }], params: { steps: [
      { tool: 'gt', with: { layer: 'm.csv', series: [{ col: '$g' }], cutoffs: [40, 45, 50] }, as: 'gt' },
      { check: { every: 'volume >= 0', in: 'gt' } },
    ] } });
    window._micro._recipesList().push({ name: 'sloppy', tool: 'routine', params: { steps: [{ tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }] }, as: 'g' }] } });
    out.routines = m.routines().map((x) => `${x.name}(${x.inputs.map((i) => i.name).join(',')})`);
    out.dry = await m.checkRoutine('monthly', { inputs: { g: 'FE' } });
    out.drySloppy = await m.checkRoutine('sloppy');
    out.dryWrote = await (async () => { try { await (await m.ready, window._micro.project().dir).getDirectoryHandle('runs'); return true; } catch { return false; } })();
    try { await m.runRoutine('monthly', {}); } catch (e) { out.noInput = e.message; }
    const steps = [], evs = [];
    addEventListener('micro:routine-done', (e) => evs.push(e.detail.status));
    const res = await m.runRoutine('monthly', { inputs: { g: 'FE' }, onStep: (s) => steps.push(`${s.n}:${s.status}`) });
    out.run = { status: res.status, dir: res.record && res.record.dir, recSteps: res.record && res.record.steps.map((s) => s.status), inputs: res.record && res.record.inputs, steps, evs };
    const runs = await m.runs(); out.runs = runs.map((x) => `${x.routine}:${x.status}`);
    out.acc = (await m.acceptRun(runs[0].dir, 'host')).by;
    out.accRuns = (await m.runs())[0].accepted && (await m.runs())[0].accepted.by;
    return out;
  });
  chk(`HOST: micro.tools() lists the tools with their settings (${r.tools.join(', ')}; gt.cutoffs ${JSON.stringify(r.gtCut)})`,
    ['gt', 'stats', 'swath', 'validation', 'resource'].every((t) => r.tools.includes(t)) && r.gtCut.type === 'numbers' && r.gtCut.routine === 'required');
  chk(`HOST: micro.runTool runs one without a window (${JSON.stringify(r.one)}); a misspelled setting rejects naming the real one (“${(r.oneErr || '').slice(0, 90)}”)`,
    r.one.cols.join() === 'series,cutoff,volume,grade,metal' && r.one.rows === 2 && r.one.win === 0 && /did you mean “cutoffs”/.test(r.oneErr || ''));
  chk(`HOST: micro.routines() (${r.routines.join(' · ')}); checkRoutine dry-runs — every step, every problem, nothing written (${JSON.stringify(r.dry)} · ${JSON.stringify(r.drySloppy.problems)} · runs/ made: ${r.dryWrote})`,
    r.routines.includes('monthly(g)') && r.dry.steps.length === 2 && r.dry.problems.length === 0 && /cutoffs: a routine must state it/.test(r.drySloppy.problems.join()) && !r.dryWrote);
  chk(`HOST: a missing input rejects, never a dialog (“${r.noInput}”); runRoutine runs to the end, hears each step and returns the record (${JSON.stringify(r.run)})`,
    /needs input “g”/.test(r.noInput || '') && r.run.status === 'ok' && /^runs\//.test(r.run.dir || '') && r.run.recSteps.join() === 'ok,pass' && r.run.inputs && r.run.inputs.g === 'FE' && r.run.steps.join() === '1:ok,2:pass' && r.run.evs.join() === 'ok');
  chk(`HOST: micro.runs() (${r.runs.join(' · ')}); acceptRun marks the baseline (${r.acc} → ${r.accRuns})`, r.runs[0] === 'monthly:ok' && r.acc === 'host' && r.accRuns === 'host');
  await p.close();
}

// ── §117: WAYS IN (routines v2 step 5) — Check all recipes lists every file's problems (a misspelled
//     setting names the real one) and rewrites old-form routine steps under `with:` — after which an
//     inline stats step's own filter finally applies; a recipe written from scratch in the generated
//     form saves only what its tool accepts; a layer input's `requires:` refuses a model that lacks
//     the columns before anything runs. ──
if (take()) {
  const p = await mkPage('sm2ways');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2ways', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,DOM']; for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + i).toFixed(1), i < 5 ? 'hem' : 'itb'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const list = M_._recipesList(); list.length = 0;
    list.push({ name: 'typo gt', tool: 'gt', file: 'recipes/typo-gt.yaml', params: { series: [{ layer: 'm.csv', col: 'FE' }], cutofs: [40] } });
    list.push({ name: 'old style', tool: 'routine', file: 'recipes/old-style.yaml', params: { steps: [{ tool: 'stats', layer: 'm.csv', cols: ['FE'], filter: 'DOM = "hem"', as: 'st' }] } });
    // A. check all: the typo named, the old-form step flagged; rewrite → with:, written back
    const c1 = await M_.checkAllRecipes();
    out.c1 = c1.map((x) => ({ name: x.name, problems: x.problems, oldForm: x.oldForm }));
    const c2 = await M_.checkAllRecipes({ rewrite: true });
    const st0 = list.find((x) => x.name === 'old style').params.steps[0];
    out.rewritten = { rewritten: c2.find((x) => x.name === 'old style').rewritten, step: st0 };
    const fileText = await (await (await (await M_.project().dir.getDirectoryHandle('recipes')).getFileHandle('old-style.yaml')).getFile()).text();
    out.fileHasWith = /with:/.test(fileText) && /filter:/.test(fileText);
    const res = await window.micro.runRoutine('old style');
    const runDir = res.record && res.record.dir; let tsv = '';
    try { let d = M_.project().dir; for (const s of runDir.split('/')) d = await d.getDirectoryHandle(s); tsv = await (await (await d.getFileHandle('st.tsv')).getFile()).text(); } catch { }
    out.filtered = (tsv.split('\n')[1] || '').split('\t')[1];
    // B. the form: a grade-tonnage recipe from scratch
    const win = M_.openRecipeForm('gt');
    const q = (sel) => win.el.querySelector(sel);
    const rows = [...win.el.querySelectorAll('.rf-row')];
    const byKey = (k) => rows.find((r2) => r2.firstChild && r2.firstChild.textContent.replace(' *', '') === k);
    q('.rf-top input').value = 'from scratch';
    byKey('layer').querySelector('select').value = 'm.csv';
    const ser = byKey('series'); ser.querySelector('input[list]').value = 'FE';
    byKey('cutoffs').querySelector('input').value = '40, 45, 48';
    out.formParams = win.collect();
    [...win.el.querySelectorAll('button')].find((b) => b.textContent === 'Save recipe').click();
    await wait(400);
    out.saved = !!list.find((x) => x.name === 'from scratch' && x.tool === 'gt');
    out.savedRuns = (await window.micro.runTool('gt', list.find((x) => x.name === 'from scratch').params)).table.rows.length;
    // C. requires: a layer input whose model lacks a column
    list.push({ name: 'needs', tool: 'routine', inputs: [{ name: 'model', type: 'layer', requires: ['FE', 'CU'] }], params: { steps: [{ tool: 'stats', with: { layer: '$model', cols: ['FE'] }, as: 's' }] } });
    try { await window.micro.runRoutine('needs', { inputs: { model: 'm.csv' } }); } catch (e) { out.requires = e.message; }
    return out;
  });
  chk(`WAYS IN: check all recipes names the misspelled setting and flags the old-form step (${JSON.stringify(r.c1)})`,
    /no setting “cutofs” — did you mean “cutoffs”/.test(r.c1.find((x) => x.name === 'typo gt').problems.join()) && r.c1.find((x) => x.name === 'old style').oldForm === 1);
  chk(`WAYS IN: rewrite moves the settings under with: and writes the file (${JSON.stringify(r.rewritten)}, file ${r.fileHasWith}); the stats filter now applies (n ${r.filtered} of 320)`,
    r.rewritten.rewritten && r.rewritten.step.with && r.rewritten.step.with.filter === 'DOM = "hem"' && r.rewritten.step.as === 'st' && !('filter' in r.rewritten.step) && r.fileHasWith && r.filtered === '160');
  chk(`WAYS IN: the from-scratch form makes a recipe its tool accepts (${JSON.stringify(r.formParams)}; saved ${r.saved}; runs: ${r.savedRuns} rows)`,
    r.saved && r.formParams.layer === 'm.csv' && JSON.stringify(r.formParams.cutoffs) === '[40,45,48]' && r.formParams.series[0].col === 'FE' && r.savedRuns === 3);
  chk(`WAYS IN: a layer input's requires: refuses a model without the columns, before anything runs (“${r.requires}”)`, /has no column “CU”/.test(r.requires || ''));
  await p.close();
}

// ── §118: EXPORT as a tool — a routine writes the records a filter keeps, chosen columns, as CSV or
//     Parquet into the run's folder (hashed in the record); its row count is a value a check reads;
//     a host gets the file as a Blob; an unknown column is refused. ──
if (take()) {
  const p = await mkPage('sm2export');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2export', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,DOM']; for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) for (let i = 0; i < 10; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + i).toFixed(1), i < 5 ? 'hem' : 'itb'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {};
    M_._recipesList().push({ name: 'ship', tool: 'routine', params: { steps: [
      { tool: 'export', with: { layer: 'm.csv', filter: 'DOM = "hem"', columns: ['XC', 'YC', 'ZC', 'FE'], out: 'hem.csv' }, as: 'ex' },
      { tool: 'export', with: { layer: 'm.csv', format: 'parquet', spatialSort: true }, as: 'pq' },
      { check: 'ex.rows = 160 and pq.rows = 320', say: 'the right number of records went out' },
    ] } });
    const res = await m.runRoutine('ship');
    out.status = res.status; out.err = res.error || null;
    const rec = res.record, dir = rec && rec.dir;
    let d = M_.project().dir; for (const s of (dir || '').split('/')) if (s) d = await d.getDirectoryHandle(s);
    const csv = await (await (await d.getFileHandle('hem.csv')).getFile()).text();
    const pq = await (await d.getFileHandle('m.parquet')).getFile();
    const csvLines = csv.trim().split(/\r?\n/), data = csvLines.filter((l) => l[0] !== '#');   // past the # micro:model line (a filtered subset keeps the lattice)
    out.csv = { header: data[0], lines: data.length - 1, lattice: /^# micro:model \{.*"subset":"filter"/.test(csvLines[0]) };   // the CSV writer ends lines with CRLF
    out.pqBytes = pq.size;
    out.outs = rec.steps.filter((s) => s.tool === 'export').map((s) => ({ path: s.outputs[0].path, sha: !!s.outputs[0].sha256, rows: s.values.rows }));
    out.check = rec.steps.find((s) => s.kind === 'check').status;
    const t = await m.runTool('export', { layer: 'm.csv', filter: 'FE >= 48' });
    out.host = { name: t.file && t.file.name, isBlob: t.file && t.file.blob instanceof Blob, rows: t.values.rows };
    try { await m.runTool('export', { layer: 'm.csv', columns: ['FE', 'CU'] }); } catch (e) { out.bad = e.message; }
    return out;
  });
  chk(`EXPORT: a routine exports into the run's folder — the filtered CSV (${JSON.stringify(r.csv)}), a spatial Parquet (${r.pqBytes} B) — each hashed in the record (${JSON.stringify(r.outs)}); a check reads the row counts (${r.check})`,
    r.status === 'ok' && r.csv.header === 'XC,YC,ZC,FE' && r.csv.lines === 160 && r.csv.lattice && r.pqBytes > 1000 && r.outs.length === 2 && r.outs.every((o) => o.sha) && /\/hem\.csv$/.test(r.outs[0].path) && /\/m\.parquet$/.test(r.outs[1].path) && r.check === 'pass');
  chk(`EXPORT: a host gets the file as a Blob (${JSON.stringify(r.host)}); an unknown column is refused (“${r.bad}”)`, r.host.isBlob && r.host.name === 'm.csv' && r.host.rows === 64 && /no column “CU”/.test(r.bad || ''));
  await p.close();
}

// ── §119: QA as tools — model QA counts a sentinel, drillhole QA an overlapping interval, mesh QA a
//     watertight box and an open sheet; a routine's checks gate on those counts (a clean mesh passes,
//     the dirty model stops the run, naming what it read). ──
if (take()) {
  const p = await mkPage('sm2qatools');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2qatools', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,DENS']; for (let k = 0; k < 2; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, i === 2 && j === 2 && k === 0 ? '-99' : (40 + i).toFixed(1), '2.8'].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {};
    await M_.addLayer({ kind: 'drillholes', name: 'dh',
      collar: { columns: { HOLE: ['H1'], E: Float64Array.from([20]), N: Float64Array.from([20]), RL: Float64Array.from([30]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: ['H1'], AT: Float64Array.from([0]), AZI: Float64Array.from([0]), INC: Float64Array.from([90]) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: ['H1', 'H1'], F: Float64Array.from([0, 8]), T: Float64Array.from([10, 20]), FE: Float64Array.from([40, 50]) }, roles: { bhid: 'HOLE', from: 'F', to: 'T' } } });
    const D = M_.layers().find((x) => x.dh);
    const vt = []; for (const zz of [0, 10]) for (const yy of [0, 10]) for (const xx of [0, 10]) vt.push(xx, yy, zz);
    await M_.addLayer({ kind: 'mesh', name: 'box', vertices: Float64Array.from(vt), triangles: Uint32Array.from([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]) });
    await M_.addLayer({ kind: 'mesh', name: 'sheet', vertices: Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0]), triangles: Uint32Array.from([0, 1, 2, 1, 3, 2]) });
    const box = M_.layers().find((x) => x.kind === 'mesh' && /box/.test(x.name)), sheet = M_.layers().find((x) => x.kind === 'mesh' && /sheet/.test(x.name));
    const mq = await m.runTool('modelqa', { layer: 'm.csv' });
    out.model = { values: mq.values, checks: mq.table.rows.map((r2) => r2[1]) };
    const dq = await m.runTool('dhqa', { layer: D.name });
    out.dh = { values: dq.values, checks: dq.table.rows.map((r2) => r2[1]) };
    out.box = (await m.runTool('meshqa', { layer: box.name })).values;
    out.sheet = (await m.runTool('meshqa', { layer: sheet.name })).values;
    M_._recipesList().push({ name: 'qa gate', tool: 'routine', params: { steps: [
      { tool: 'meshqa', with: { layer: box.name }, as: 'box' },
      { check: 'box.watertight = 1 and box.boundary = 0', say: 'the solid is closed' },
      { tool: 'modelqa', with: { layer: 'm.csv' }, as: 'mq' },
      { check: 'mq.warnings = 0', say: 'no warnings on the model' },
    ] } });
    const res = await m.runRoutine('qa gate');
    out.gate = { status: res.status, error: res.error, steps: res.record.steps.map((s) => s.status), observed: res.record.steps[3].observed };
    return out;
  });
  chk(`QA TOOLS: model QA counts the sentinel (${JSON.stringify(r.model)})`, r.model.values.warnings >= 1 && r.model.checks.some((c) => /sentinel/.test(c)) && r.model.values.blocks === 60);
  chk(`QA TOOLS: drillhole QA finds the overlapping interval (${JSON.stringify(r.dh)})`, r.dh.values.findings >= 1 && r.dh.checks.some((c) => /overlap/i.test(c)));
  chk(`QA TOOLS: mesh QA — the box watertight (${JSON.stringify(r.box)}), the sheet open (${JSON.stringify(r.sheet)})`,
    r.box.watertight === 1 && r.box.shells === 1 && Math.abs(r.box.volume - 1000) < 1e-6 && r.sheet.watertight === 0 && r.sheet.boundary > 0);
  chk(`QA TOOLS: a routine gates on the counts — the closed solid passes, the model's warning stops it (${JSON.stringify(r.gate)})`,
    r.gate.status === 'failed' && r.gate.steps.join() === 'ok,pass,ok,fail' && /no warnings on the model/.test(r.gate.error || '') && r.gate.observed && r.gate.observed['mq.warnings'] >= 1);
  await p.close();
}

// ── §120: THE REST AS TOOLS — cross-tab, composite, pairing, grade shell, spatial join, reconcile
//     and the section series run without their windows; the ones that MAKE something (a layer,
//     columns) replace what an earlier run made — run twice, there is still one. ──
if (take()) {
  const p = await mkPage('sm2rest');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2rest', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const mk = (shift) => { const rows = ['XC,YC,ZC,FE,DOM']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + i + shift).toFixed(1), i < 4 ? 'hem' : 'itb'].join(',')); return rows.join('\n') + '\n'; };
    await window._micro.openBlob(new File([mk(0)], 'm.csv'), 'm.csv', 'replace');
    await window._micro.openBlob(new File([mk(2)], 'n.csv'), 'n.csv', 'add');
  });
  await p.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers().every((L) => L.docs.blockDoc), null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {};
    const H = ['H1', 'H2'];
    await M_.addLayer({ kind: 'drillholes', name: 'dh',
      collar: { columns: { HOLE: H, E: Float64Array.from([15, 55]), N: Float64Array.from([25, 25]), RL: Float64Array.from([30, 30]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: H, AT: Float64Array.from([0, 0]), AZI: Float64Array.from([0, 0]), INC: Float64Array.from([90, 90]) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: ['H1', 'H1', 'H1', 'H2', 'H2', 'H2'], F: Float64Array.from([0, 10, 20, 0, 10, 20]), T: Float64Array.from([10, 20, 30, 10, 20, 30]), FE: Float64Array.from([41, 41, 41, 45, 45, 45]) }, roles: { bhid: 'HOLE', from: 'F', to: 'T' } } });
    const D = M_.layers().find((x) => x.dh);
    const count = (pred) => M_.layers().filter(pred).length;
    // cross-tab
    const xt = await m.runTool('xtab', { layer: 'm.csv', grade: 'FE', group: 'DOM', cutoffs: [44] });
    const tot = xt.table.rows.find((x) => x[0] === 'total' && x[1] === 'total');
    out.xt = { cols: xt.table.columns.join(), rows: xt.table.rows.length, totalVolume: tot && tot[4], blocks: xt.values.blocks };
    // composite, twice
    const c1 = await m.runTool('composite', { layer: D.name, length: 5 }); await m.runTool('composite', { layer: D.name, length: 5 });
    out.comp = { n: c1.values.composites, layers: count((x) => x.composites) };
    // pairing
    const pr = await m.runTool('pairing', { model: 'm.csv', samples: D.name, blockCol: 'FE', sampleCol: 'FE' });
    out.pair = { pairs: pr.values.pairs, bias: pr.values.bias };
    // grade shell, twice
    const sh = await m.runTool('shell', { layer: 'm.csv', col: 'FE', cutoff: 44.5 }); await m.runTool('shell', { layer: 'm.csv', col: 'FE', cutoff: 44.5 });
    out.shell = { tris: sh.values.triangles, layers: count((x) => x.kind === 'mesh') };
    // spatial join, twice: one column
    await m.runTool('join', { layer: 'm.csv', from: 'n.csv', columns: ['FE'] }); const j2 = await m.runTool('join', { layer: 'm.csv', from: 'n.csv', columns: ['FE'] });
    const Lm = M_.layers().find((x) => x.name === 'm.csv');
    out.join = { cols: M_.layerTableHeader(Lm) ? M_.attrColumnsOf(Lm).map((c) => c.name).filter((n) => /FE/.test(n)) : [], v: j2.values.columns };
    // reconcile, twice: one Δ layer, mean Δ = −2 (this − reference)
    await m.runTool('reconcile', { layer: 'm.csv', reference: 'n.csv', grade: 'FE' }); const rc = await m.runTool('reconcile', { layer: 'm.csv', reference: 'n.csv', grade: 'FE' });
    out.rec = { ...rc.values, layers: count((x) => /^reconcile_/.test(x.name)) };
    // the section series, as a routine step: a zip in the run's folder
    M_._recipesList().push({ name: 'sheets', tool: 'routine', params: { steps: [{ tool: 'sections', with: { section: { axis: 'z', thickness: 10 }, from: 5, to: 25, step: 10 }, as: 'sec' }] } });
    const rs = await m.runRoutine('sheets');
    const se = rs.record && rs.record.steps[0];
    out.sec = { status: rs.status, error: rs.error, problems: rs.problems, sheets: se && se.values && se.values.sheets, out: se && se.outputs[0] && se.outputs[0].path, bytes: se && se.outputs[0] && se.outputs[0].bytes };
    return out;
  });
  chk(`REST: cross-tab without its window (${JSON.stringify(r.xt)})`, r.xt.cols === 'group,bin,from,to,volume,grade,metal,blocks' && r.xt.blocks === 144 && r.xt.totalVolume === 144000);
  chk(`REST: composite — made once even when run twice (${JSON.stringify(r.comp)}); pairing (${JSON.stringify(r.pair)})`, r.comp.n > 0 && r.comp.layers === 1 && r.pair.pairs > 0 && Number.isFinite(r.pair.bias));
  chk(`REST: grade shell — one mesh after two runs (${JSON.stringify(r.shell)}); spatial join — one column after two runs (${JSON.stringify(r.join)})`, r.shell.tris > 0 && r.shell.layers === 1 && r.join.cols.filter((n) => n !== 'FE').length === 1);
  chk(`REST: reconcile — one Δ layer after two runs, mean Δ −2 (${JSON.stringify(r.rec)})`, r.rec.layers === 1 && r.rec.matched === 144 && Math.abs(r.rec.mean_delta + 2) < 1e-9);
  chk(`REST: the section series as a routine step — a zip of sheets in the run's folder (${JSON.stringify(r.sec)})`, r.sec.status === 'ok' && r.sec.sheets === 3 && /\/sections\.zip$/.test(r.sec.out || '') && r.sec.bytes > 1000);
  await p.close();
}

// ── §121: ↻ REFRESH WITHOUT WINDOWS, and scatter / Q-Q as a tool — a composer chart frame and table
//     frame made from a GT recipe are made again by the tool directly: no window opened, the user's
//     own GT window left open, the chart the window's own; scatter's r and Q-Q's quantile ratios
//     come back as values. ──
if (take()) {
  const p = await mkPage('sm2refresh');
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE,FE2']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) rows.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (40 + i + j).toFixed(1), (80 + 2 * (i + j)).toFixed(1)].join(','));
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const L = M_.layers()[0], cfg = { series: [{ layer: 'm.csv', col: 'FE' }], nCut: 5 };
    // the user's GT window, run — its spec is the reference
    M_.openGradeTonnage(L, { cfg, run: true });
    for (let t = 0; t < 100 && !document.querySelector('.fwin') ?._gtSpec; t++) await wait(100);
    const gw = [...document.querySelectorAll('.fwin')].find((w) => w._gtSpec);
    const ref = gw && JSON.stringify(gw._gtSpec.series.map((s) => s.data));
    // a figure with a chart frame and a table frame from the same recipe
    const ed = M_.openComposer('refresh');
    ed.addFrame({ kind: 'chart', box: [10, 10, 100, 70], content: { spec: null }, source: { app: 'micro', recipe: { tool: 'gt', name: 'g', params: cfg } } });
    ed.addFrame({ kind: 'table', box: [10, 90, 100, 50], content: { columns: [], rows: [], title: 'GT' }, source: { app: 'micro', recipe: { tool: 'gt', name: 'g', params: cfg } } });
    const wins = () => [...document.querySelectorAll('.fwin')].filter((w) => /grade-tonnage/.test(w.textContent)).length;
    let opened = 0; const mo = new MutationObserver((ms) => { for (const x of ms) for (const n of x.addedNodes) if (n.classList && n.classList.contains('fwin') && /grade-tonnage/.test(n.textContent || '')) opened++; }); mo.observe(document.body, { childList: true, subtree: true });
    const before = wins();
    const n = await M_.refreshData(M_.currentFigure());
    mo.disconnect();
    const frames = M_.currentFigure().doc.frames, ch = frames.find((f) => f.kind === 'chart'), tb = frames.find((f) => f.kind === 'table');
    out.refresh = { n, opened, winsBefore: before, winsAfter: wins(), same: ch.content.spec && JSON.stringify(ch.content.spec.series.map((s) => s.data)) === ref, tableRows: tb.content.rows.length, tableHead: tb.content.columns.slice(0, 2) };
    // scatter / Q-Q
    const sc = await m.runTool('xy', { layer: 'm.csv', mode: 'scatter', x: 'FE', y: 'FE2' });
    out.scatter = { n: sc.values.n, r: sc.values.r, cols: sc.table.columns.join() };
    const qq = await m.runTool('xy', { mode: 'qq', a: { layer: 'm.csv', col: 'FE' }, b: { layer: 'm.csv', col: 'FE2' } });
    out.qq = { p50: qq.values.p50_ratio, rows: qq.table.rows.length };
    try { await m.runTool('xy', { mode: 'qq', a: { layer: 'm.csv', column: 'FE' }, b: { layer: 'm.csv', col: 'FE' } }); } catch (e) { out.qqBad = e.message; }
    return out;
  });
  chk(`REFRESH: chart + table frames made again by the tool — no window opened (${JSON.stringify(r.refresh)}); the chart is the window's own`,
    r.refresh.n === 2 && r.refresh.opened === 0 && r.refresh.winsAfter === r.refresh.winsBefore && r.refresh.winsBefore === 1 && r.refresh.same && r.refresh.tableRows > 0);
  chk(`XY: scatter r (${JSON.stringify(r.scatter)}), Q-Q ratios (${JSON.stringify(r.qq)}); a misspelled side setting names the real one (“${r.qqBad}”)`,
    r.scatter.n === 144 && Math.abs(r.scatter.r - 1) < 1e-9 && r.scatter.cols === 'x,y' && r.qq.rows === 101 && Math.abs(r.qq.p50 - 2) < 0.05 && /no setting “column” — did you mean “col”/.test(r.qqBad || ''));
  await p.close();
}

// ── §122: THE CACHE (routines v2 step 6) — a re-run with nothing changed reuses each step (its files
//     copied, same hashes, the record says from where, a check still reads the values); a new calc
//     column is a new fingerprint (recomputed); a fresh run reuses nothing; a tampered output is not
//     reused; a tool that makes a layer is never cached. ──
if (take()) {
  const p = await mkPage('sm2cache');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2cache', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    const rows = ['XC,YC,ZC,FE']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(40 + i + j).toFixed(1)}`);
    await window._micro.openBlob(new File([rows.join('\n') + '\n'], 'm.csv'), 'm.csv', 'replace');
  });
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {};
    M_._recipesList().push({ name: 'c', tool: 'routine', params: { steps: [
      { tool: 'gt', with: { layer: 'm.csv', series: [{ col: 'FE' }], cutoffs: [40, 45] }, as: 'gt' },
      { tool: 'modelqa', with: { layer: 'm.csv' }, as: 'mq' },
      { check: 'mq.errors = 0' },
    ] } });
    const sum = (res) => res.record.steps.map((s) => (s.kind ? s.status : `${s.step}:${s.reusedFrom ? 'reused' : 'ran'}`)).join(' ');
    const r1 = await m.runRoutine('c'); out.r1 = sum(r1);
    const r2 = await m.runRoutine('c'); out.r2 = sum(r2);
    const s1 = r1.record.steps[0].outputs[0], s2 = r2.record.steps[0].outputs[0];
    out.copied = { sameSha: s1.sha256 === s2.sha256, newPath: s2.path !== s1.path && s2.path.startsWith(r2.record.dir), from: r2.record.steps[0].reusedFrom === r1.record.dir };
    M_.applyCalcCols(M_.layers()[0], [{ name: 'FE2', expr: 'FE * 2', ty: 'number' }]);
    const r3 = await m.runRoutine('c'); out.r3 = sum(r3);
    const r4 = await m.runRoutine('c', { fresh: true }); out.r4 = sum(r4);
    // tamper with every copy of gt.tsv made under the current fingerprint → the next run recomputes it
    for (const res of [r3, r4]) { let d = M_.project().dir; for (const s of res.record.dir.split('/')) d = await d.getDirectoryHandle(s); const w = await (await d.getFileHandle('gt.tsv')).createWritable(); await w.write('tampered\n'); await w.close(); }
    const r5 = await m.runRoutine('c'); out.r5 = sum(r5);
    // a tool that makes a layer: never cached
    M_._recipesList().push({ name: 'shells', tool: 'routine', params: { steps: [{ tool: 'shell', with: { layer: 'm.csv', col: 'FE', cutoff: 44.5 }, as: 'sh' }] } });
    await m.runRoutine('shells'); const s6 = await m.runRoutine('shells');
    out.shell = s6.record.steps[0].reusedFrom || null;
    return out;
  });
  chk(`CACHE: a re-run with nothing changed reuses every step (“${r.r1}” then “${r.r2}”), files copied with the same hash, the record says from where (${JSON.stringify(r.copied)}); the check reads the reused values`,
    r.r1 === 'gt:ran mq:ran pass' && r.r2 === 'gt:reused mq:reused pass' && r.copied.sameSha && r.copied.newPath && r.copied.from);
  chk(`CACHE: a new calc column → recomputed (“${r.r3}”); a fresh run reuses nothing (“${r.r4}”); a tampered output isn't reused (“${r.r5}”); a shell is never cached (${r.shell})`,
    r.r3 === 'gt:ran mq:ran pass' && r.r4 === 'gt:ran mq:ran pass' && /^gt:ran mq:reused/.test(r.r5) && r.shell === null);
  await p.close();
}

// ── §123: THE LIBRARY — a project routine packs with the recipe and the table it uses; the pack goes
//     out as one YAML or a zip and comes back the same; it lives in the browser's library apart from
//     any project; with NO project open it runs into a zip of the outputs you choose (the record always
//     in it), and the next run compares with it and reuses its unchanged steps (the library keeps the
//     records); a pack imports into another project as recipe files + the table. ──
if (take()) {
  const p = await mkPage('sm2lib');
  await p.evaluate(async () => { for (const d of ['sm2lib', 'sm2lib2']) { try { await (await navigator.storage.getDirectory()).removeEntry(d, { recursive: true }); } catch { } } });
  const csv = () => { const rows = ['XC,YC,ZC,FE']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(40 + i + j).toFixed(1)}`); return rows.join('\n') + '\n'; };
  await p.evaluate(async (t) => { await window._micro.openBlob(new File([t], 'm.csv'), 'm.csv', 'replace'); }, csv());
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async (t) => {
    const M_ = window._micro, out = {}, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const dir = M_.project().dir;
    { const fh = await dir.getFileHandle('cuts.csv', { create: true }); const w = await fh.createWritable(); await w.write('cut\n40\n45\n'); await w.close(); }
    const list = M_._recipesList(); list.length = 0;
    list.push({ name: 'gt std', tool: 'gt', params: { layer: 'm.csv', series: [{ layer: 'm.csv', col: 'FE' }], cutoffs: [40, 45, 50] } });
    const routine = { name: 'monthly', tool: 'routine', params: { steps: [
      { each: { from: 'cuts.csv' }, as: 'c', steps: [{ recipe: 'gt std', with: { cutoffs: ['$c.cut'] }, as: 'gt' }] },
      { tool: 'modelqa', with: { layer: 'm.csv' }, as: 'mq' },
      { check: 'mq.errors = 0' },
    ] } };
    list.push(routine);
    // pack + both encodings
    const pack = await M_.packFromProject(routine);
    out.pack = { recipes: pack.recipes.map((x) => x.name), tables: Object.keys(pack.tables), missing: pack.missing || null };
    const y = await M_.packToYaml(pack), fromY = await M_.packFromFile(new File([y], 'monthly.yaml'));
    const z = await M_.packToZip(pack), fromZ = await M_.packFromFile(new File([z], 'monthly.zip', { type: 'application/zip' }));
    const same = async (a) => a.main.name === 'monthly' && JSON.stringify(a.main.params) === JSON.stringify(routine.params) && a.recipes[0].name === 'gt std' && (await a.tables['cuts.csv'].text()) === 'cut\n40\n45\n';
    out.yaml = { bundled: /bundle:/.test(y), same: await same(fromY) }; out.zip = { same: await same(fromZ) };
    await M_.libraryPut(fromZ);
    out.lib = (await M_.libraryList()).map((x) => x.main.name);
    // no project: close it, open the model on its own, run from the library → a zip
    await M_.closeProject(); await wait(300);
    await M_.openBlob(new File([t], 'm.csv'), 'm.csv', 'replace'); await wait(300);
    out.noProject = !M_.project() || !M_.project().dir;
    const lp = await M_.libraryGet('monthly');
    const runA = async () => { document.querySelectorAll('.fwin').forEach((w) => w.remove()); await M_.runWithoutProject(lp, 'zip'); for (let k = 0; k < 50 && !document.querySelector('.fwin[data-run-outputs]'); k++) await wait(100); return document.querySelector('.fwin[data-run-outputs]'); };
    let ow = await runA();
    const boxes = [...ow.querySelectorAll('input[type=checkbox]')];
    out.outputs = boxes.length; boxes.filter((b) => !b.disabled).slice(-1).forEach((b) => { b.checked = false; });   // leave one report out
    [...ow.querySelectorAll('button')].find((b) => b.textContent === 'Download zip').click();
    for (let k = 0; k < 50 && !ow._zip; k++) await wait(100);
    const { openZipRanged, blobSource } = await import('/ext/archive/src/zipstream.js');
    const zz = await openZipRanged(blobSource(ow._zip)), names = zz.list().map((e) => e.name.split('/').pop());
    const rec1 = JSON.parse(new TextDecoder().decode(await zz.bytes(zz.list().find((e) => /run\.json$/.test(e.name)))));
    out.zip1 = { names, status: rec1.status, baseline: rec1.baseline };
    // the next run (still no project): its baseline is the first, its unchanged steps reused
    ow = await runA();
    out.second = await (async () => { const v = (await (await import('/tools/micro/src/element-store.js'))._idb.get('routine-library')); const runs = v.runs.monthly || []; const last = JSON.parse(runs[runs.length - 1].files['run.json']); return { runs: runs.length, baseline: last.baseline && last.baseline.dir, firstDir: rec1.dir, reused: last.steps.filter((s) => s.reusedFrom).length }; })();
    // import into a fresh project
    const d2 = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2lib');   // the first project (its recipes were only ever in memory)
    await M_.openProjectDir(d2); await wait(300);
    await M_.importPackFile(new File([y], 'monthly.yaml'), 'project');
    out.imported = { recipes: M_._recipesList().map((x) => x.name).sort(), table: await (await (await d2.getFileHandle('cuts.csv')).getFile()).text() };
    return out;
  }, csv());
  chk(`LIBRARY: a project routine packs with its recipe and table (${JSON.stringify(r.pack)}); YAML (${JSON.stringify(r.yaml)}) and zip (${JSON.stringify(r.zip)}) come back the same; in the library (${r.lib})`,
    r.pack.recipes.join() === 'gt std' && r.pack.tables.join() === 'cuts.csv' && !r.pack.missing && r.yaml.bundled && r.yaml.same && r.zip.same && r.lib.includes('monthly'));
  chk(`LIBRARY: with no project (${r.noProject}) it runs into a zip of the chosen outputs — the record always (${JSON.stringify(r.zip1)}, of ${r.outputs})`,
    r.noProject && r.zip1.status === 'ok' && r.zip1.names.includes('run.json') && r.zip1.names.length === r.outputs - 1 && r.zip1.baseline === null);
  chk(`LIBRARY: the next run without a project compares with the first and reuses its unchanged steps (${JSON.stringify(r.second)})`,
    r.second.runs === 2 && r.second.baseline === r.second.firstDir && r.second.reused >= 2);
  chk(`LIBRARY: a pack imports into another project — recipe files + its table (${JSON.stringify(r.imported)})`,
    r.imported.recipes.join() === 'gt std,monthly' && r.imported.table === 'cut\n40\n45\n');
  await p.close();
}

// ── GT ON DRILLHOLES IS LENGTH-WEIGHTED, AND A JOIN `sum` IS A TRUE TOTAL (2026-11-22). A
//     drillhole series counted each interval as 1 "m³": a 1 m sliver weighed as much as an 8 m run.
//     Now each interval weighs TO − FROM, the amount column is `length` (m) — `weighted_length`
//     (m·t/m³, not tonnes) with a density — and metal is the `accumulation` grade × m; a block model
//     and a drillhole layer on one curve are refused. The join's `sum` hands each target the FRACTION
//     of the source block it overlaps, so a summed column is conserved coarse → fine (it was ×8). ──
if (take()) {
  const p = await mkPage('sm2lenw');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2lenw', { recursive: true }); } catch { } });
  await p.evaluate(async () => {
    // a 10 m model (2×2×2, TON 100…800) and a 5 m model over the same box (4×4×4)
    const coarse = ['XC,YC,ZC,TON']; let t = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) coarse.push([5 + i * 10, 5 + j * 10, 5 + k * 10, (++t) * 100].join(','));
    const fine = ['XC,YC,ZC,FE'];
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) fine.push([2.5 + i * 5, 2.5 + j * 5, 2.5 + k * 5, 40].join(','));
    await window._micro.openBlob(new File([coarse.join('\n') + '\n'], 'c.csv'), 'c.csv', 'replace');
    await window._micro.openBlob(new File([fine.join('\n') + '\n'], 'f.csv'), 'f.csv', 'add');
  });
  await p.waitForFunction(() => window._micro.layers().length === 2 && window._micro.layers().every((L) => L.docs.blockDoc), null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M_ = window._micro, m = window.micro, out = {};
    // intervals of UNEQUAL length: H1 0–2 FE60 · 2–10 FE30 · 10–11 FE55 · H2 0–5 FE50 · 5–6 FE20
    const IV = [['H1', 0, 2, 60], ['H1', 2, 10, 30], ['H1', 10, 11, 55], ['H2', 0, 5, 50], ['H2', 5, 6, 20]];
    const H = ['H1', 'H2'];
    await M_.addLayer({ kind: 'drillholes', name: 'dh',
      collar: { columns: { HOLE: H, E: Float64Array.from([5, 15]), N: Float64Array.from([5, 5]), RL: Float64Array.from([20, 20]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: H, AT: Float64Array.from([0, 0]), AZI: Float64Array.from([0, 0]), INC: Float64Array.from([90, 90]) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: IV.map((x) => x[0]), F: Float64Array.from(IV.map((x) => x[1])), T: Float64Array.from(IV.map((x) => x[2])), FE: Float64Array.from(IV.map((x) => x[3])) }, roles: { bhid: 'HOLE', from: 'F', to: 'T' } } });
    const D = M_.layers().find((x) => x.dh);
    // expected, computed here: Σ length and Σ length·grade above each cutoff
    out.expect = [25, 50].map((c) => { const a = IV.filter((x) => x[3] >= c), L = a.reduce((s, x) => s + x[2] - x[1], 0), LG = a.reduce((s, x) => s + (x[2] - x[1]) * x[3], 0); return { cut: c, length: L, grade: LG / L, acc: LG }; });
    const gt = await m.runTool('gt', { layer: D.name, series: [{ col: 'FE' }], cutoffs: [25, 50] });
    out.gt = { cols: gt.table.columns.join(), units: gt.table.units, rows: gt.table.rows };
    const gtw = await m.runTool('gt', { layer: D.name, series: [{ col: 'FE', weight: '2' }], cutoffs: [25] });
    out.gtw = { cols: gtw.table.columns.join(), units: gtw.table.units, row: gtw.table.rows[0] };
    try { await m.runTool('gt', { layer: 'c.csv', series: [{ col: 'TON' }, { layer: D.name, col: 'FE' }], cutoffs: [25] }); out.mixed = 'ran'; } catch (e) { out.mixed = e.message; }
    // the window, on the drillhole layer: its axis, legend and subtitle say metres
    M_.openGradeTonnage(D, { cfg: { series: [{ layer: D.name, col: 'FE' }], nCut: 10 }, run: true });
    const t0 = Date.now(); let el = null;
    while (Date.now() - t0 < 10000) { el = [...document.querySelectorAll('*')].find((e) => e._gtSpec); if (el) break; await new Promise((res) => setTimeout(res, 50)); }
    out.win = el ? { left: el._gtSpec.leftLabel, names: el._gtSpec.series.map((s) => s.name), sub: (el.querySelector('.fw-sub, .sub') || {}).textContent || '' } : null;
    // the join: TON summed from the 10 m model onto the 5 m one is conserved; mean replicates
    const js = await m.runTool('join', { layer: 'f.csv', from: 'c.csv', columns: ['TON'], ops: { TON: 'sum' } });
    const sumCol = M_.numericColsOf(M_.layers().find((x) => x.name === 'f.csv')).find((n) => /TON/i.test(n));
    const st1 = await m.runTool('stats', { layer: 'f.csv', cols: [sumCol] });
    const s1 = st1.table ? st1.table.rows[0] : null, ci = st1.table ? st1.table.columns : [];
    out.join = { col: sumCol, n: s1 && s1[ci.indexOf('n')], mean: s1 && s1[ci.indexOf('mean')] };
    return out;
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const [e25, e50] = r.expect, [g25, g50] = r.gt.rows || [];
  chk(`LENGTH-WEIGHTED GT: drillhole columns name a length in metres (${r.gt.cols} · ${JSON.stringify(r.gt.units)})`, r.gt.cols === 'series,cutoff,length,grade,accumulation' && r.gt.units.length === 'm' && /·m$/.test(r.gt.units.accumulation));
  chk(`LENGTH-WEIGHTED GT: Σ length and length-weighted grade above each cutoff (${JSON.stringify(r.gt.rows)} vs ${JSON.stringify(r.expect)})`,
    !!g25 && !!g50 && near(g25[2], e25.length) && near(g25[3], e25.grade) && near(g25[4], e25.acc) && near(g50[2], e50.length) && near(g50[3], e50.grade) && near(g50[4], e50.acc));
  chk(`LENGTH-WEIGHTED GT: a density makes weighted_length (m·t/m3), never tonnes (${JSON.stringify(r.gtw)})`, r.gtw.cols === 'series,cutoff,weighted_length,grade,accumulation' && r.gtw.units.weighted_length === 'm·t/m3' && near(r.gtw.row[2], 2 * e25.length) && near(r.gtw.row[3], e25.grade));
  chk(`LENGTH-WEIGHTED GT: blocks and drillholes on one curve are refused (${r.mixed})`, /measure different things/.test(r.mixed));
  chk(`LENGTH-WEIGHTED GT: the window's axis + legend say metres (${JSON.stringify(r.win)})`, !!r.win && r.win.left === 'length (m)' && r.win.names.some((n) => / · m$/.test(n)) && !r.win.names.some((n) => /· t$/.test(n)));
  chk(`JOIN SUM CONSERVED: 10 m → 5 m, Σ TON over 64 children = 3600 (was ×8) (${JSON.stringify(r.join)})`, r.join.n === 64 && near(r.join.mean * r.join.n, 3600));
  await p.close();
}

// ── §SCOPE: CAPTIONS COUNT WHAT THE IMAGE SHOWS — a view frame cut by a section counts ({count})
//     and takes statistics ({mean:FE} {n:FE}) over the records INSIDE its section (block centroids;
//     a slab thinner than a block keeps the blocks its plane cuts; a half-space its kept side), after
//     its filter; the view frame's inspector → "captions: whole model" counts the whole filtered
//     model instead. The setting is the frame's, and saves with the figure. ──
if (take()) {
  let p = await mkPage('sm2scope');
  const pdfText = async (pg) => pg.evaluate(async () => {
    const M_ = window._micro, bytes = await M_.figurePdfBytes(M_.currentFigure(), 72, { compress: false });
    const s = new TextDecoder('latin1').decode(bytes);
    // only text-showing operators (`… Tm (…) Tj`): a bare `(…) Tj` match could START inside a view
    // frame's image bytes and swallow the caption (it did, on some background colours)
    const q = [...s.matchAll(/Tm \(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]).find((x) => x.startsWith('Q ')) || '';
    return q;
  });
  const r = await p.evaluate(async () => {
    const M_ = window._micro, out = {};
    // 20 × 10 blocks of 10 m on 6 levels (z = 5 … 55); FE = 10·level + i
    const rows = ['XC,YC,ZC,FE'], recs = [];
    for (let k = 0; k < 6; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 20; i++) { rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${10 * k + i}`); recs.push({ z: 5 + k * 10, fe: 10 * k + i }); }
    const id = await M_.openBlob(new File([rows.join('\n') + '\n'], 'scope.csv'), 'scope.csv', 'replace');
    M_.setActiveLayer(id);
    document.querySelector('#filter').value = 'FE >= 30'; await M_.applyBlockFilter('FE >= 30');
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    // the expected numbers, from the rows: inside = centroid z in (lo, hi], and FE >= 30
    const stat = (lo, hi) => { const v = recs.filter((x) => x.z > lo && x.z <= hi && x.fe >= 30).map((x) => x.fe); return { n: v.length, mean: v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : '—' }; };
    out.want = { slab: stat(20, 40), model: stat(-1e9, 1e9), thin: stat(20, 30), front: stat(30, 1e9), p15: stat(10, 20), p45: stat(40, 50) };
    await window.micro.setSection({ axis: 'z', position: 30, thickness: 20, clip: 'slab' });   // 30 RL ± 10: the z=25 and z=35 levels
    await new Promise((res) => setTimeout(res, 200));
    const ed = M_.openComposer('scope');
    const f = M_.addViewFrame(ed);
    out.viewId = f.id;
    ed.addFrame({ kind: 'text', box: [f.box[0], f.box[1] + f.box[3] + 2, 160, 8], content: { md: 'Q {count} blocks · mean {mean:FE:.3f} · n {n:FE} · of {total}', size: 9 } });
    out.defaultScope = ed.getDoc().frames.find((x) => x.id === f.id).content.statsScope ?? 'absent';
    return out;
  });
  // the caption's text in the PDF (its · arrives as an octal escape)
  const T = (q) => { const m = /^Q (\S+) blocks \S+ mean (\S+) \S+ n (\S+) \S+ of (\S+)/.exec(q); return m ? { count: m[1], mean: m[2], n: m[3], total: m[4] } : null; };
  const slab = T(await pdfText(p));
  chk(`SCOPE: by default a view cut by a slab counts its slab — centroids in (20, 40], FE ≥ 30 (${JSON.stringify(slab)} vs ${JSON.stringify(r.want.slab)}; scope ${r.defaultScope})`,
    slab && +slab.count === r.want.slab.n && slab.mean === r.want.slab.mean && +slab.n === r.want.slab.n && +slab.total === 1200 && r.defaultScope === 'absent');
  // a slab thinner than a block, its plane on a block face: the blocks above the plane (half-open)
  await p.evaluate(async () => { await window.micro.setSection({ axis: 'z', position: 25, thickness: 2, clip: 'slab' }); });
  await p.evaluate(async () => { const M_ = window._micro, ed = M_.composerEditor(), f = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view'); M_.composerFrameMenu(f, ed).find((x) => x.label === 'Update from the 3D view').run(); });
  const thin = T(await pdfText(p));
  chk(`SCOPE: a slab thinner than a block keeps the blocks its plane cuts (${JSON.stringify(thin)} vs ${JSON.stringify(r.want.thin)})`, thin && +thin.count === r.want.thin.n && thin.mean === r.want.thin.mean);
  // a half-space: what is drawn is the kept side
  await p.evaluate(async () => { await window.micro.setSection({ axis: 'z', position: 30, clip: 'front' }); });
  await p.evaluate(async () => { const M_ = window._micro, ed = M_.composerEditor(), f = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view'); M_.composerFrameMenu(f, ed).find((x) => x.label === 'Update from the 3D view').run(); });
  const front = T(await pdfText(p));
  chk(`SCOPE: a half-space (front) counts its kept side (${JSON.stringify(front)} vs ${JSON.stringify(r.want.front)})`, front && +front.count === r.want.front.n && front.mean === r.want.front.mean);
  // atlas pages: each page's own section, so each page counts its bench (an empty one says so)
  const pages = await p.evaluate(async () => {
    const M_ = window._micro, out = [];
    for (const z of [15, 45]) {
      const doc = await M_.compoPage({ figure: 'scope', view: { section: { axis: 'z', position: z, thickness: 10, clip: 'slab' } }, dpi: 72 });
      const env = { ...M_.composerEnv(), doc }, cap = doc.frames.find((x) => x.kind === 'text');
      out.push([env.fields.count(null, cap, env), env.fields.mean('FE', cap, env), env.fields.n('FE', cap, env)]);
    }
    return out;
  });
  const fmt3 = (v) => (typeof v === 'number' ? v.toFixed(3) : v);
  chk(`SCOPE: atlas pages count their own bench (${JSON.stringify(pages)} vs ${JSON.stringify([r.want.p15, r.want.p45])})`,
    pages[0][0] === r.want.p15.n && pages[0][1] === r.want.p15.mean && pages[0][2] === 0 && pages[1][0] === r.want.p45.n && fmt3(pages[1][1]) === r.want.p45.mean && pages[1][2] === r.want.p45.n);
  // back to the slab, then the inspector → whole model
  const sw = await p.evaluate(async () => {
    const M_ = window._micro, ed = M_.composerEditor(), f = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view');
    await window.micro.setSection({ axis: 'z', position: 30, thickness: 20, clip: 'slab' });
    M_.composerFrameMenu(f, ed).find((x) => x.label === 'Update from the 3D view').run();
    ed.select([f.id]); await new Promise((res) => setTimeout(res, 50));
    const sel = document.querySelector('.cmp-statsscope');
    const o = { label: sel && sel.selectedOptions[0].textContent, row: sel && sel.closest('.row').firstChild.textContent };
    sel.value = 'model'; sel.dispatchEvent(new Event('change'));
    const t0 = performance.now(); while (performance.now() - t0 < 8000) { const fx = ed.getDoc().frames.find((x) => x.id === f.id).content.meta.facts; if (fx.statsScope === 'model' && fx.stats) break; await new Promise((res) => setTimeout(res, 50)); }
    o.stored = ed.getDoc().frames.find((x) => x.id === f.id).content.statsScope;
    // the caption on screen (the editor's fields), before any export
    const env = { ...M_.composerEnv(), doc: ed.getDoc() }, cap = ed.getDoc().frames.find((x) => x.kind === 'text');
    o.live = [env.fields.count(null, cap, env), env.fields.mean('FE', cap, env)];
    return o;
  });
  const model = T(await pdfText(p));
  chk(`SCOPE: the inspector row reads "${sw.row}: ${sw.label}"; → whole model stores statsScope=${sw.stored} and counts every filtered block (${JSON.stringify(model)} vs ${JSON.stringify(r.want.model)}; on screen ${JSON.stringify(sw.live)})`,
    sw.row === 'captions' && sw.label === 'in the section' && sw.stored === 'model' && model && +model.count === r.want.model.n && model.mean === r.want.model.mean && sw.live[0] === r.want.model.n);
  await saveProject(p);
  await p.close();
  // the setting saves with the figure
  p = await mkPage('sm2scope');
  await p.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2scope'); await window._micro.openProjectDir(dir); });
  await p.waitForFunction(() => window._micro.layers().length, null, { timeout: 60000 });
  const back = await p.evaluate(async () => {
    const M_ = window._micro, ed = M_.openComposer('scope');
    await new Promise((res) => setTimeout(res, 300));
    const f = ed.getDoc().frames.find((x) => x.source && x.source.kind === 'view');
    ed.select([f.id]); await new Promise((res) => setTimeout(res, 50));
    const sel = document.querySelector('.cmp-statsscope');
    return { stored: f.content.statsScope, shown: sel && sel.value };
  });
  const after = T(await pdfText(p));
  chk(`SCOPE: the figure reopens counting the whole model (statsScope ${back.stored}, inspector ${back.shown}; ${JSON.stringify(after)})`,
    back.stored === 'model' && back.shown === 'model' && after && +after.count === r.want.model.n);
  await p.close();
}

// ── §124: BUGS FOUND WRITING THE MANUAL (2026-11-22) — each guarded where it lived: a ƒ column's type
//     when nobody said (a blank first row made a grade column text; a routine's text column became a
//     number); colouring by a ƒ column (drew ELEVATION — the mode maps didn't know calc:); the swath
//     window's old "direction" mode in a recipe; join ops the resampler doesn't have (silently the
//     mean); Run on a recipe whose tool has no window (opened the SWATH window); Runs… with no recipe
//     left; an analysis window closed and reopened (saved 0×0); validation's blank sample grades (0). ──
if (take()) {
  const p = await mkPage('sm2fix');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2fix', { recursive: true }); } catch { } });
  const csv = (() => { const rows = ['XC,YC,ZC,FE,LITO']; let n = 0; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${n === 0 ? '' : (30 + i * 3 + j * 2).toFixed(1)},${i < 3 ? 'HEM' : 'ITA'}`); n++; } return rows.join('\n') + '\n'; })();
  await p.evaluate(async (t) => { await window._micro.openBlob(new File([t], 'm.csv'), 'm.csv', 'replace'); }, csv);
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async () => {
    const M = window._micro, out = {}, L = M.layers()[0];
    const settle = async (f, n = 200) => { for (let k = 0; k < n && !f(); k++) await new Promise((q) => setTimeout(q, 50)); };
    // 1 — ƒ types
    await M.applyCalcCols(L, [{ name: 'T_LITO', expr: 'LITO' }, { name: 'T_FE', expr: 'FE * 2' }, { name: 'T_BARE', expr: 'FE' }, { name: 'T_YR', expr: 'if(FE > 40, "2027", "2028")' }]);
    out.types = Object.fromEntries(L.calcCols.map((c) => [c.name, c.ty]));
    // 2 — colour by a ƒ column: through the palette (mode 2), and the clip in the column's own units
    M.setActiveLayer(L.id); M.setLayerColorSel(L, 'calc:T_FE');
    await settle(() => L._calcDisplay && L._calcDisplay.name === 'T_FE');
    const C = await M.mod('ramp.js'), K = await M.mod('color.js');
    out.mode = K.resolveColorMode();
    out.range = C.rampRangeFor(L).map((v) => +(+v).toFixed(2));
    // 3 — the swath window's old trend/plunge name still reads
    const sw = M.checkParams('swath', { layer: 'm.csv', series: [{ col: 'FE' }], mode: 'direction', bandW: [10] });
    out.swath = { errors: sw.errors, mode: sw.params && sw.params.mode };
    // 4 — join ops: only what the resampler has
    out.joinBad = M.checkParams('join', { layer: 'm.csv', from: 'm.csv', columns: ['FE'], ops: { FE: 'max' } }).errors;
    out.joinOk = M.checkParams('join', { layer: 'm.csv', from: 'm.csv', columns: ['FE'], ops: { FE: 'sum' } }).errors;
    // 5 — Run on a model-QA recipe: a one-step routine (a run record), not the swath window
    const list = M._recipesList(); list.length = 0;
    list.push({ name: 'qa check', tool: 'modelqa', params: { layer: 'm.csv' } });
    const runs0 = (await window.micro.runs()).length;
    M.runRecipe(list[0]);
    await settle(() => /routine “qa check”/.test(document.querySelector('#meta').textContent) && !/running|step/.test(document.querySelector('#meta').textContent), 300);
    await new Promise((q) => setTimeout(q, 1500));         // the run record lands
    out.runs = (await window.micro.runs()).length - runs0;
    out.swathOpened = [...document.querySelectorAll('.fwin .t')].some((t) => /swath/i.test(t.textContent));
    M.closeAllWindows();
    // 6 — Runs… stays in the menu when no recipe is left
    list.length = 0;
    out.runsItem = M.recipesMenuItems().some((x) => x.label === 'Runs…');
    // 7 — an analysis window closed (by its own ×, after a Run) reopens at a real size, not a dot
    M.openGradeTonnage(L, { run: true });
    await settle(() => { const w0 = [...document.querySelectorAll('.fwin')].pop(); return w0 && w0._gtSpec; });
    const w = [...document.querySelectorAll('.fwin')].pop();
    [...w.querySelectorAll('button')].find((b) => b.textContent === '×').click();   // onClose runs after the removal
    out.geo = L.analysis && L.analysis.geo && L.analysis.geo.gt;
    M.openGradeTonnage(L);
    const w2 = [...document.querySelectorAll('.fwin')].pop();
    out.reopened = [w2.offsetWidth, w2.offsetHeight];
    M.closeAllWindows();
    return out;
  });
  // 8 — validation reads a blank (or coded) sample grade as missing, not 0
  const v = await p.evaluate(async () => {
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE'];
    for (let n2 = 1; n2 <= 3; n2++) { const id = 'H' + n2; collar.push(`${id},${10 + n2 * 10},25,30,30`); survey.push(`${id},0,0,-90`); for (let d = 0; d < 30; d += 10) assay.push(`${id},${d},${d + 10},${d === 10 ? (n2 === 1 ? '' : '<0.01') : 40 + n2}`); }
    const f = (a, nm) => new File([a.join('\n')], nm, { type: 'text/csv' });
    await window._micro.importDrillholes({ collar: f(collar, 'c.csv'), survey: f(survey, 's.csv'), intervals: f(assay, 'a.csv') }, {}, 'add');
    const D = window._micro.layers().find((L) => L.dh && L.docs.dhDoc);
    const s = window._micro.extractSamples(D, 'FE');
    return { n: s.length, zeros: s.filter((x) => x[3] === 0).length };
  });
  chk(`FIXES: a ƒ column's type is inferred — text stays text, a grade with a blank first row stays a number (${JSON.stringify(r.types)})`, r.types.T_LITO === 'string' && r.types.T_FE === 'number' && r.types.T_BARE === 'number' && r.types.T_YR === 'string');   // a bare numeric column is a number; a quoted year is text
  chk(`FIXES: colouring by a ƒ column draws through the palette (mode ${r.mode}, not elevation), over its own range (${JSON.stringify(r.range)})`, r.mode === 2 && r.range[0] > 0 && r.range[1] > r.range[0]);
  chk(`FIXES: a swath recipe saved in the old "direction" mode still reads (${JSON.stringify(r.swath)})`, !r.swath.errors.length && r.swath.mode === 'trend');
  chk(`FIXES: join ops the resampler lacks are refused (${r.joinBad.join('; ')}), sum is fine (${r.joinOk.length})`, r.joinBad.length === 1 && /max/.test(r.joinBad[0]) && !r.joinOk.length);
  chk(`FIXES: Run on a model-QA recipe runs it as a routine (${r.runs} run recorded), not the swath window (${r.swathOpened})`, r.runs === 1 && !r.swathOpened);
  chk(`FIXES: Runs… stays in the recipes menu with no recipe left (${r.runsItem})`, r.runsItem);
  chk(`FIXES: an analysis window closed by its × reopens at a real size (${JSON.stringify(r.reopened)}; saved ${JSON.stringify(r.geo)})`, r.reopened[0] > 100 && r.reopened[1] > 100 && (!r.geo || (r.geo[2] > 60 && r.geo[3] > 40)));
  // the blank is left out; "<0.01" takes the layer's detection-limit value (a policy, src/records.js) — neither reads as 0
  chk(`FIXES: validation leaves a blank sample grade out and never reads one as 0 (${v.n} of 9 samples, ${v.zeros} zeros)`, v.n === 8 && v.zeros === 0);
  await p.close();
}

// ── §125: BUGS FROM THE SECOND REVIEW ROUND (2026-11-23): a text ƒ column materialized (stored all
//     blanks); the key join's duplicate mean (divided by every row, blank or not); a grade-tonnage
//     step on a model opened as points (counted 1 m³ a point); the validation tool's domain filter
//     (new); Run on a windowless recipe (the §124 check only saw a run record — it ran NO step). ──
if (take()) {
  const p = await mkPage('sm2fix2');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2fix2', { recursive: true }); } catch { } });
  const csv = (() => { const rows = ['XC,YC,ZC,FE,LITO']; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) rows.push(`${5 + i * 10},${5 + j * 10},${5 + k * 10},${(30 + i * 3 + j * 2).toFixed(1)},${i < 3 ? 'HEM' : 'ITA'}`); return rows.join('\n') + '\n'; })();
  await p.evaluate(async (t) => { await window._micro.openBlob(new File([t], 'm.csv'), 'm.csv', 'replace'); }, csv);
  await p.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  await saveProject(p);
  const r = await p.evaluate(async (t) => {
    const M = window._micro, out = {}, L = M.layers()[0];
    const settle = async (f, n = 300) => { for (let k = 0; k < n && !f(); k++) await new Promise((q) => setTimeout(q, 50)); };
    // 1 — a text ƒ column materializes as categories, values intact
    await M.applyCalcCols(L, [{ name: 'CLS', expr: 'if(FE > 40, "ORE", "LOW")' }]);
    await M.materializeCalcCol(L, 'CLS');
    const pc = M.paintColByName(L, 'CLS');
    out.cls = pc ? { dict: pc.dict.filter(Boolean).sort(), ore: [...pc.codes].filter((c) => pc.dict[c] === 'ORE').length } : null;
    out.oreWant = t.split('\n').slice(1).filter(Boolean).filter((row) => +row.split(',')[3] > 40).length;
    // 2 — key join: duplicates averaged over their NON-blank values (10, blank, 20 → 15)
    const idL = await M.openBlob(new File(['XC,YC,ZC,ID\n5,5,5,A\n15,5,5,B\n'], 'kl.csv'), 'kl.csv', 'add');
    const idK = await M.openBlob(new File(['ID,AU\nA,10\nA,\nA,20\nB,7\n'], 'kk.csv'), 'kk.csv', 'add');
    const KL = M.layers().find((q) => q.id === idL), KK = M.layers().find((q) => q.id === idK);
    const kj = await M.keyJoinToCols(KL, KK, { leftKey: 'ID', rightKey: 'ID', bring: ['AU'], dup: 'aggregate' });
    out.kj = [...M.matColGet(KL, kj.outs[0]).fvalues];
    // 3 — grade-tonnage on a model opened as points: refused, not 1 m³ a point
    await M.openBlob(new File([t], 'pts.csv'), 'pts.csv', 'add', null, { asKind: 'points' });
    try { await window.micro.runTool('gt', { layer: 'pts.csv', series: [{ col: 'FE' }], cutoffs: [35] }); out.pts = 'ran'; } catch (e) { out.pts = e.message; }
    // 4 — validation's domain filter: one expression on the model AND the samples
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE,LITO'];
    for (let h = 0; h < 6; h++) { const id = 'H' + h; collar.push(`${id},${5 + h * 10},25,30,30`); survey.push(`${id},0,0,-90`); for (let d = 0; d < 30; d += 10) assay.push(`${id},${d},${d + 10},${40 + h},${h < 3 ? 'HEM' : 'ITA'}`); }
    const f = (a, nm) => new File([a.join('\n')], nm, { type: 'text/csv' });
    await M.importDrillholes({ collar: f(collar, 'c.csv'), survey: f(survey, 's.csv'), intervals: f(assay, 'a.csv') }, {}, 'add');
    const D = M.layers().find((x) => x.dh && x.docs.dhDoc), dn = D.name;
    const all = await window.micro.runTool('validation', { model: 'm.csv', samples: dn, modelGrade: 'FE', sampleGrade: 'FE', axis: 'Z', bandW: 10 });
    const hem = await window.micro.runTool('validation', { model: 'm.csv', samples: dn, modelGrade: 'FE', sampleGrade: 'FE', axis: 'Z', bandW: 10, filter: 'LITO = "HEM"' });
    out.val = { all: all.values.samples, hem: hem.values.samples, hemModel: +hem.values.model_mean.toFixed(3) };
    out.hemModelWant = (() => { const rows = t.split('\n').slice(1).filter(Boolean).map((row) => row.split(',')).filter((c) => c[4] === 'HEM'); return +(rows.reduce((s2, c) => s2 + +c[3], 0) / rows.length).toFixed(3); })();
    // 5 — Run on a windowless recipe runs its ONE step
    const list = M._recipesList(); list.length = 0;
    list.push({ name: 'qa only', tool: 'modelqa', params: { layer: 'm.csv' } });
    const before = (await M.listRuns()).length;
    M.runRecipe(list[0]);
    await settle(() => /routine “qa only”/.test(document.querySelector('#meta').textContent) && /done|run|report|ok/.test(document.querySelector('#meta').textContent));
    await new Promise((q) => setTimeout(q, 1500));
    const runs = await M.listRuns();
    const rec = runs.length > before ? runs[0].rec : null;
    out.run = rec ? { status: rec.status, steps: rec.steps.length, step: rec.steps[0] && rec.steps[0].status, tool: rec.steps[0] && (rec.steps[0].tool || rec.steps[0].kind) } : null;
    M.closeAllWindows();
    return out;
  }, csv);
  chk(`FIXES 2: a text ƒ column materializes as categories (${JSON.stringify(r.cls)}; ${r.oreWant} ORE expected)`, r.cls && r.cls.dict.join() === 'LOW,ORE' && r.cls.ore === r.oreWant);
  chk(`FIXES 2: the key join averages duplicates over their non-blank values (${JSON.stringify(r.kj)} — want 15, 7)`, r.kj[0] === 15 && r.kj[1] === 7);
  chk(`FIXES 2: grade-tonnage refuses a model opened as points (“${r.pts}”)`, /no block grid/.test(r.pts));
  chk(`FIXES 2: validation's domain filter applies to both sides (${JSON.stringify(r.val)}; model HEM mean ${r.hemModelWant})`, r.val.all === 18 && r.val.hem === 9 && Math.abs(r.val.hemModel - r.hemModelWant) < 1e-6);
  chk(`FIXES 2: Run on a windowless recipe runs its step (${JSON.stringify(r.run)})`, r.run && r.run.status === 'ok' && r.run.steps === 1 && r.run.step === 'ok');
  await p.close();
}

// ═══ 131 (index 130 — alone: --shard=130/131). the routine editor's YAML boxes
//     (src/yamlfield.js): highlight layer, completions from the tool's settings list
//     (keys under with:, enum values, layer names), live corrections + one-click fix ═══
if (take()) {
  const p = await mkPage('sm2yaml');
  await p.evaluate(() => { let t = 'X,Y,Z,FE,SG\n'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) t += `${5 + i * 10},${5 + j * 10},5,${30 + i},2.5\n`; return window._micro.openBlob(new Blob([t]), 'm.csv', 'replace'); });
  await p.waitForFunction(() => window._micro.layers().length === 1 && window._micro.layers()[0].docs.blockDoc, null, { timeout: 30000 });
  await p.evaluate(() => { window._micro.openRoutineWindow(null); [...document.querySelectorAll('.fwin[data-routine] button')].find((x) => x.textContent === '+ inline step').click(); });
  const ta = p.locator('.fwin[data-routine] .yf-wrap textarea').last();
  await ta.click();
  const popup = () => p.evaluate(() => (document.querySelector('#acPopup').classList.contains('show') ? [...document.querySelectorAll('#acPopup .ac-val')].map((x) => x.textContent) : []));
  await p.keyboard.type('with:'); await p.keyboard.press('Enter');          // Enter after `key:` opens its block (indent 2)
  const keys = await popup();
  await p.keyboard.type('scope: ');
  const enumVals = await popup();
  await p.keyboard.press('Escape'); await p.keyboard.type('"all"'); await p.keyboard.press('Escape'); await p.keyboard.press('Enter');
  await p.keyboard.type('layer: ');
  const layers = await popup();
  await p.keyboard.press('Enter');                                             // accept → "m.csv", quoted
  await p.keyboard.press('Escape'); await p.keyboard.press('End'); await p.keyboard.press('Enter');
  await p.keyboard.type('cutofs: 0.5'); await p.keyboard.press('Escape');
  await p.waitForFunction(() => [...document.querySelectorAll('.fwin[data-routine] .yf-msg')].some((x) => /cutofs/.test(x.textContent)), null, { timeout: 5000 }).catch(() => {});
  const st = await p.evaluate(() => {
    const w = document.querySelector('.fwin[data-routine]'), hl = [...w.querySelectorAll('.yf-hl')].pop();
    return { text: [...w.querySelectorAll('.yf-wrap textarea')].pop().value, keySpans: hl.querySelectorAll('.yf-key').length, strSpans: hl.querySelectorAll('.hl-string').length,
      bad: [...hl.querySelectorAll('.yf-bad')].map((x) => x.textContent).join(''), msgs: [...w.querySelectorAll('.yf-msg')].map((x) => x.textContent), fix: !!w.querySelector('.yf-fix') };
  });
  chk(`yaml box: highlight layer has key + string spans (${st.keySpans} keys, ${st.strSpans} strings) and the indent kept (${JSON.stringify(st.text)})`,
    st.keySpans >= 4 && st.strSpans >= 2 && /^with:\n {2}scope: "all"\n {2}layer: "m\.csv"\n {2}cutofs: 0\.5$/.test(st.text));
  chk(`yaml box: under with: the completions are gt's settings (${keys.join(',')})`, ['cutoffs', 'series', 'scope'].every((k) => keys.includes(k)));
  chk(`yaml box: an enum setting offers its values (${enumVals.join(',')})`, ['all', 'filtered', 'selection'].every((k) => enumVals.includes(k)));
  chk(`yaml box: a layer setting offers the layers (${layers.join(',')})`, layers.includes('m.csv'));
  chk(`yaml box: the misspelling is marked + named with a fix (${st.bad}; ${st.msgs[0]})`, st.bad === 'cutofs' && /did you mean “cutoffs”/.test(st.msgs.join(' ')) && st.fix);
  await p.locator('.fwin[data-routine] .yf-fix').first().click();
  const fixed = await p.evaluate(() => { const w = document.querySelector('.fwin[data-routine]'); return { text: [...w.querySelectorAll('.yf-wrap textarea')].pop().value, msgs: [...w.querySelectorAll('.yf-msg')].map((x) => x.textContent) }; });
  chk(`yaml box: one click corrects the key (${JSON.stringify(fixed.text.split('\n').pop())}; ${fixed.msgs.length} message(s) left)`,
    /\n {2}cutoffs: 0\.5$/.test(fixed.text) && !fixed.msgs.some((m) => /cutofs/.test(m)));
  // Shift+Tab on a bare caret dedents and leaves a CARET (it used to select the line — the next key replaced it)
  await ta.click(); await p.keyboard.press('Control+End'); await p.keyboard.press('Shift+Tab');
  const dd = await p.evaluate(() => { const t = [...document.querySelectorAll('.fwin[data-routine] .yf-wrap textarea')].pop(); return { last: t.value.split('\n').pop(), s: t.selectionStart, e: t.selectionEnd }; });
  await p.keyboard.press('Tab');                                     // indent it back
  // a bare `key:` while typing is read as empty for the check — no red parse error hiding the others
  await p.keyboard.press('End'); await p.keyboard.type('\nnCut:'); await p.waitForTimeout(700);
  const bare = await p.evaluate(() => { const w = document.querySelector('.fwin[data-routine]'), hl = [...w.querySelectorAll('.yf-hl')].pop(); return { bad: [...hl.querySelectorAll('.yf-bad')].map((x) => x.textContent).join('|'), msgs: [...w.querySelectorAll('.yf-msg')].map((x) => x.textContent) }; });
  chk(`yaml box: Shift+Tab on a caret dedents and keeps a caret (${JSON.stringify(dd)})`, dd.last === 'cutoffs: 0.5' && dd.s === dd.e);
  chk(`yaml box: a bare "key:" being typed is no parse error (marks: “${bare.bad}”; ${bare.msgs.length} message(s))`, !/nCut/.test(bare.bad) && !bare.msgs.some((m) => /nCut/.test(m) && /line/.test(m) && !/no setting/.test(m)));
  await p.close();
}

// ═══ grid EXPORT: one dialog, seven formats (src/grid-export.js). A 23×17 .asc with
//     holes, exported through buildGridExport (the function the dialog's Export button
//     calls) to every format; the bytes are read back here (micro's own readers,
//     @gcu/gtiff, the zip) for dimensions, geotransform, values and nodata — and the
//     .asc / .grd / .tif re-open through micro's open path. Then a 2-band GeoTIFF shown
//     DECIMATED: the export is the full-resolution grid of the CHOSEN band (the deep
//     review once found an export writing the display, band 0) ═══
if (take()) {
  const pg = await mkPage('sm2gridexport');
  const { openGridSource, readSurferGrd, readEsriAsc, gridBlankTest } = await import('../tools/micro/src/grid-io.js');
  const { readGTiff, gridFromGTiff } = await import('../ext/gtiff/index.js');
  const { openZipRanged, blobSource } = await import('../ext/archive/src/zipstream.js');
  const NX = 23, NY = 17, X0 = 450005, Y0 = 8100165, CS = 10;
  const val = (r, c) => 650 + r * 2.5 + c * 0.125 + ((r * c) % 7) / 8;           // exact in float32
  const hole = (r, c) => (r === 3 && c === 4) || (r === 10 && c >= 18);
  let asc = `ncols ${NX}\nnrows ${NY}\nxllcorner ${X0 - CS / 2}\nyllcorner ${Y0 - (NY - 1) * CS - CS / 2}\ncellsize ${CS}\nNODATA_value -9999\n`;
  for (let r = 0; r < NY; r++) { const row = []; for (let c = 0; c < NX; c++) row.push(hole(r, c) ? -9999 : val(r, c)); asc += row.join(' ') + '\n'; }
  await pg.evaluate((t) => window._micro.openBlob(new Blob([t]), 'topo.asc', 'replace'), asc);
  await pg.waitForFunction(() => window._micro.layers().some((L) => L.name === 'topo.asc' && L.docs.gridDoc), null, { timeout: 30000 });
  // the menu + palette name it "Export grid…" and the dialog opens with every format
  const dlg = await pg.evaluate(() => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'topo.asc');
    m.openGridExportDialog(L);
    const fmts = [...document.querySelectorAll('#geDlgBody select')][0];
    const out = { show: document.querySelector('#geDlg').classList.contains('show'), fmts: [...fmts.options].map((o) => o.value), cmd: !!m.COMMANDS.find((c) => c.title === 'Export grid…' && c.when({ L })) };
    document.querySelector('#geNot').click();
    return out;
  });
  chk(`grid export: the dialog opens with every format (${dlg.fmts.join(' ')}) and the palette has “Export grid…”`,
    dlg.show && ['asc', 'tif', 'grd7', 'grd6', 'dsaa', 'flt', 'xyz'].every((f) => dlg.fmts.includes(f)) && dlg.cmd);
  const runs = [
    ['asc', { format: 'asc', nodata: '-32768', decimals: null }],
    ['tif', { format: 'tif', nodata: '-32768', compression: 'deflate', predictor: 3 }],
    ['tif-none-tiles', { format: 'tif', nodata: 'nan', compression: 'none', layout: 'tiles' }],
    ['grd7', { format: 'grd7' }], ['grd6', { format: 'grd6' }], ['dsaa', { format: 'dsaa', decimals: null }],
    ['flt', { format: 'flt', nodata: '-1e30' }],
    ['xyz', { format: 'xyz', delim: ',', valueName: 'elev', skipEmpty: true, decimals: null }],
  ];
  const got = await pg.evaluate(async (rs) => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'topo.asc'), out = {};
    for (const [k, o] of rs) {
      const r = await m.buildGridExport(L, o);
      const u8 = new Uint8Array(await r.blob.arrayBuffer());
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      out[k] = { name: r.name, b64: btoa(s), notes: r.notes, nx: r.grid.nx };
    }
    return out;
  }, runs);
  const bytesOf = (k) => Buffer.from(got[k].b64, 'base64');
  const want = (back, nd, name) => {
    const bad = gridBlankTest(back);
    let wrong = 0, holesOk = 0;
    for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) {
      const v = back.data[r * NX + c];
      if (hole(r, c)) { if (bad(v) && (nd === undefined || Object.is(v, nd) || (Number.isNaN(nd) && Number.isNaN(v)))) holesOk++; else wrong++; }
      else if (v !== val(r, c)) wrong++;
    }
    const geo = back.nx === NX && back.ny === NY && Math.abs(back.x0 - X0) < 1e-6 && Math.abs(back.y0 - Y0) < 1e-6 && back.dx === CS && back.dy === CS;
    const ok = geo && !wrong && holesOk === 1 + (NX - 18);
    chk(`grid export ${name}: ${back.nx}×${back.ny}, origin ${back.x0},${back.y0}, cell ${back.dx}×${back.dy}, ${wrong} wrong values, ${holesOk} holes empty`, ok);
  };
  const srcGrid = async (src) => { const img = src.images[0], g = src.geo, half = g.pixelIsPoint ? 0 : 0.5; return { nx: img.width, ny: img.height, data: await img.read(), x0: g.origin[0] + half * g.scale[0], y0: g.origin[1] - half * g.scale[1], dx: g.scale[0], dy: g.scale[1], nodata: g.nodata }; };
  want(await readEsriAsc(new Blob([bytesOf('asc')])), -32768, `.asc (${got.asc.name})`);
  for (const k of ['tif', 'tif-none-tiles']) {
    const t = await readGTiff(new Uint8Array(bytesOf(k)));
    const g = await gridFromGTiff(t);
    want(g, k === 'tif' ? -32768 : NaN, `GeoTIFF ${k} (${t.images[0].compression === 8 ? 'deflate' : 'none'}${t.images[0].tiled ? ', tiled' : ''}; crs ${t.geo.crs})`);
    if (k === 'tif') chk(`grid export GeoTIFF: no CRS invented (${t.geo.crs}) and the dialog/notes say so; lineage in the ImageDescription`,
      t.geo.crs === null && got.tif.notes.some((n) => /no CRS/.test(n)) && /"op":"export\.grid"/.test(bytesOf('tif').toString('latin1')));
  }
  want(await readSurferGrd(new Blob([bytesOf('grd7')])), undefined, 'Surfer 7 binary');
  want(await srcGrid(await openGridSource(new Blob([bytesOf('grd7')]), 'x.grd')), undefined, 'Surfer 7 binary (streamed source)');
  want(await readSurferGrd(new Blob([bytesOf('grd6')])), undefined, 'Surfer 6 binary');
  want(await readSurferGrd(new Blob([bytesOf('dsaa')])), undefined, 'Surfer 6 ASCII (DSAA)');
  {
    const z = await openZipRanged(blobSource(new Blob([bytesOf('flt')])));
    const names = z.list().map((e) => e.name).sort();
    const hdr = new TextDecoder().decode(await z.bytes(z.entries.get('topo.hdr')));
    const flt = await z.bytes(z.entries.get('topo.flt'));
    const h = {}; for (const line of hdr.trim().split('\n')) { const [a, b2] = line.trim().split(/\s+/); h[a.toLowerCase()] = b2; }
    const dv = new DataView(flt.buffer, flt.byteOffset, flt.byteLength), data = new Float32Array(NX * NY);
    for (let i = 0; i < NX * NY; i++) data[i] = dv.getFloat32(i * 4, true);
    chk(`grid export .flt: one zip of ${names.join(' + ')}, header LSBFIRST`, names.join(',') === 'topo.flt,topo.hdr,topo.lineage.json' && h.byteorder === 'LSBFIRST' && +h.ncols === NX);
    want({ nx: +h.ncols, ny: +h.nrows, dx: +h.cellsize, dy: +h.cellsize, data, x0: +h.xllcorner + CS / 2, y0: +h.yllcorner + NY * CS - CS / 2, nodata: Math.fround(+h.nodata_value) }, Math.fround(-1e30), 'ESRI .flt/.hdr');
  }
  {
    const lines = bytesOf('xyz').toString('utf8').trim().split('\n');
    const m2 = new Map(lines.slice(1).map((l) => { const [x, y, z] = l.split(','); return [`${x},${y}`, +z]; }));
    let wrong = 0;
    for (let r = 0; r < NY; r++) for (let c = 0; c < NX; c++) { const k = `${X0 + c * CS},${Y0 - r * CS}`; if (hole(r, c) ? m2.has(k) : m2.get(k) !== val(r, c)) wrong++; }
    chk(`grid export XYZ/CSV: header “${lines[0]}”, ${lines.length - 1} nodes (empty ones skipped), ${wrong} wrong`, lines[0] === 'x,y,elev' && lines.length - 1 === NX * NY - (1 + NX - 18) && !wrong);
  }
  // micro reads its own exports back as grid layers
  const reopen = await pg.evaluate(async (files) => {
    const m = window._micro, out = {};
    for (const [nm, b64] of files) {
      const s = atob(b64), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
      await m.openBlob(new Blob([u8]), nm, 'add');
      const L = m.layers().find((x) => x.name === nm && x.docs.gridDoc);
      const g = L && L.docs.gridDoc.grid;
      out[nm] = g ? { nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, v: g.data[5 * g.nx + 6] } : null;
    }
    return out;
  }, [['back.asc', got.asc.b64], ['back7.grd', got.grd7.b64], ['back.tif', got.tif.b64]]);
  chk(`grid export: micro re-opens its own .asc / Surfer 7 / GeoTIFF (${JSON.stringify(reopen)})`,
    Object.values(reopen).every((g) => g && g.nx === NX && g.ny === NY && Math.abs(g.x0 - X0) < 1e-6 && Math.abs(g.y0 - Y0) < 1e-6 && g.v === val(5, 6)));
  // the dialog's own button: GeoTIFF picked, Export clicked → a download of the right bytes
  const dl = pg.waitForEvent('download', { timeout: 20000 });
  await pg.evaluate(() => {
    const m = window._micro, L = m.layers().find((x) => x.name === 'topo.asc');
    m.openGridExportDialog(L);
    const fmt = [...document.querySelectorAll('#geDlgBody select')][0];
    fmt.value = 'tif'; fmt.dispatchEvent(new Event('input'));
    document.querySelector('#geGo').click();
  });
  const d = await dl;
  const dBytes = await (async () => { const st = await d.createReadStream(); const parts = []; for await (const c of st) parts.push(c); return Buffer.concat(parts); })();
  const dg = await gridFromGTiff(await readGTiff(new Uint8Array(dBytes)));
  const meta = await pg.evaluate(() => ({ meta: document.querySelector('#meta').textContent, open: document.querySelector('#geDlg').classList.contains('show') }));
  chk(`grid export dialog: Export writes ${d.suggestedFilename()} (${dg.nx}×${dg.ny}, nodata ${dg.nodata}), closes, says “${meta.meta}”`,
    d.suggestedFilename() === 'topo.tif' && dg.nx === NX && dg.ny === NY && dg.data[5 * NX + 6] === val(5, 6) && !meta.open && /^exported topo\.tif \(23×17\)/.test(meta.meta));
  await pg.close();

  // a 2-band GeoTIFF shown decimated: the export is full resolution, of the chosen band
  const pb = await mkPage('sm2gridexport2');
  await pb.evaluate((arr) => { window.__gridDisplayCap = 300; return window._micro.openBlob(new Blob([new Uint8Array(arr)]), 'mb.tif', 'replace'); }, Array.from(twoBandTiff()));
  await pb.waitForFunction(() => window._micro.layers().length && window._micro.layers()[0].docs.gridDoc, null, { timeout: 30000 });
  const mb = await pb.evaluate(async () => {
    const m = window._micro, L = m.layers()[0], gd = L.docs.gridDoc;
    const r = await m.buildGridExport(L, { format: 'grd7', band: 1 });
    const back = await m.readSurferGrd(r.blob);
    const W = 40, H = 32, exp = (row, c) => Math.fround(0.5 + 3 * (c / W) + 2 * (1 - row / H));
    let wrong = 0; for (let row = 0; row < H; row++) for (let c = 0; c < W; c++) if (back.data[row * W + c] !== exp(row, c)) wrong++;
    const r0 = await m.buildGridExport(L, { format: 'asc', band: 0, decimals: null });
    const t0 = await r0.blob.text();
    return { display: `${gd.grid.nx}×${gd.grid.ny}`, fullRes: gd.fullRes, out: `${back.nx}×${back.ny}`, wrong, band0: /ncols 40\nnrows 32/.test(t0) && +t0.split('\n')[6].split(' ')[0] > 150 };   // band 1 is the ~200–580 elevation; band 2 the 0.5–5.5 gradient
  });
  chk(`grid export of a DECIMATED 2-band GeoTIFF (display ${mb.display}): full resolution ${mb.out}, band 2's values (${mb.wrong} wrong), band 1 differs`,
    mb.fullRes === false && mb.display !== '40×32' && mb.out === '40×32' && mb.wrong === 0 && mb.band0);
  // the routine tool: the same producer, a file out; a bad band and a misspelt setting are refused
  const tool = await pb.evaluate(async () => {
    const m = window._micro;
    const r = await m.runTool('gridexport', { layer: 'mb.tif', format: 'xyz', band: 2, decimals: 2, skipEmpty: false }, { routine: true });
    const text = await r.file.blob.text();
    const bad = await m.runTool('gridexport', { layer: 'mb.tif', band: 3 }).then(() => 'ran', (e) => e.message);
    const typo = m.checkParams('gridexport', { layer: 'mb.tif', fromat: 'tif' }).errors.join(';');
    return { name: r.file.name, nodes: r.values.nodes, lines: text.trim().split('\n').length, first: text.split('\n')[1], bad, typo };
  });
  chk(`routine tool gridexport: ${tool.name}, ${tool.nodes} nodes, ${tool.lines - 1} rows (first “${tool.first}”); band 3 refused (${tool.bad}); typo named (${tool.typo})`,
    tool.name === 'mb.csv' && tool.nodes === 1280 && tool.lines === 1281 && /^500012\.5,5999987\.5,2\.5$/.test(tool.first) && /2 bands/.test(tool.bad) && /format/.test(tool.typo));
  // a layer that knows its EPSG code: the GeoTIFF carries it as GeoKeys, with no note
  const epsg = await pb.evaluate(async () => {
    const m = window._micro, L = m.layers()[0];
    L.docs.gridDoc.grid.crs = 'EPSG:32723';
    const r = await m.buildGridExport(L, { format: 'tif' });
    const u8 = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s), notes: r.notes };
  });
  const et = await readGTiff(new Uint8Array(Buffer.from(epsg.b64, 'base64')));
  chk(`grid export GeoTIFF of a layer in EPSG:32723 writes GeoKeys (${et.geo.crs}), no CRS note`, et.geo.crs === 'EPSG:32723' && !epsg.notes.some((n) => /CRS/.test(n)));
  await pb.close();
}

if (take()) {
  // ═══ contact analysis: a known contact down four holes (ORE FE 60 over WASTE FE 20 at 20 m), a
  //     block model and a closed box whose bottom is the same boundary — the binned means, metres,
  //     signed distances, the routine tool's table + values, the window, ⇥ column ═══
  const pg = await mkPage('sm2contact');
  const r = await pg.evaluate(async () => {
    const m = window._micro, f = (t, n) => new File([t], n);
    const collar = ['BHID,X,Y,Z'], survey = ['BHID,AT,AZ,DIP'], assay = ['BHID,FROM,TO,FE,LITO'];
    for (let h = 0; h < 4; h++) {
      const id = `H${h + 1}`; collar.push(`${id},${h * 50},0,100`); survey.push(`${id},0,0,-90`, `${id},40,0,-90`);
      for (let d = 0; d < 40; d += 2) assay.push(`${id},${d},${d + 2},${d < 20 ? 60 : 20},${d < 20 ? 'ORE' : 'WASTE'}`);
    }
    await m.importDrillholes({ collar: f(collar.join('\n') + '\n', 'collars.csv'), survey: f(survey.join('\n') + '\n', 'survey.csv'), intervals: f(assay.join('\n') + '\n', 'assay.csv') }, {}, 'replace');
    const D = m.layers().find((x) => x.dh);
    // 16 × 5 × 25 blocks of 10 × 10 × 2 m, centroids z 51…99: FE 60 above z 80, 20 below
    const rows = ['XC,YC,ZC,FE'];
    for (let k = 0; k < 25; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 16; i++) { const z = 51 + 2 * k; rows.push(`${i * 10},${-20 + j * 10},${z},${z > 80 ? 60 : 20}`); }
    await m.openBlob(new Blob([rows.join('\n') + '\n']), 'blocks.csv', 'add');
    // a closed box x −100…250, y −100…100, z 80…200: inside = above z 80 (the holes' contact depth)
    const box = [[-100, -100, 80], [250, -100, 80], [250, 100, 80], [-100, 100, 80], [-100, -100, 200], [250, -100, 200], [250, 100, 200], [-100, 100, 200]];
    const faces = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]];
    await m.openBlob(new Blob([box.map((v) => `v ${v.join(' ')}`).join('\n') + '\n' + faces.map((t) => `f ${t.join(' ')}`).join('\n') + '\n']), 'box.obj', 'add');
    const B = m.layers().find((x) => x.name === 'blocks.csv'), M = m.layers().find((x) => x.name === 'box.obj');
    const out = {};
    const t1 = await m.runTool('contact', { mode: 'downhole', layer: D.name, series: [{ col: 'FE' }], domain: 'LITO', domA: 'ORE', domB: 'WASTE', binWidth: 2, maxDist: 10 }, { routine: true });
    out.down = { cols: t1.table.columns.join(','), key: t1.table.key.join(','), rows: t1.table.rows, v: t1.values };
    out.oneWay = (await m.runTool('contact', { mode: 'downhole', layer: D.name, series: [{ col: 'FE' }], domain: 'LITO', domA: 'ORE', direction: 'BtoA', binWidth: 2, maxDist: 10 })).values.contacts;
    out.noBins = m.checkParams('contact', { mode: 'downhole', layer: D.name, series: [{ col: 'FE' }], domain: 'LITO', domA: 'ORE' }, { routine: true }).errors.join('; ');
    const md = await m.meshDistanceOf(M);
    out.d = [md.at(0, 0, 79), md.at(0, 0, 81.5), md.at(0, 0, 300), md.at(260, 0, 100), md.at(0, 0, 50, 10)].map((x) => (Number.isFinite(x) ? x : null));
    const t2 = await m.runTool('contact', { mode: 'surface', series: [{ layer: 'blocks.csv', col: 'FE' }, { layer: D.name, col: 'FE' }], surface: 'box.obj', binWidth: 2, maxDist: 10 }, { routine: true });
    out.surf = { cols: t2.table.columns.join(','), rows: t2.table.rows, v: t2.values, closed: md.closed };
    const h = m.openContact(D, { mode: 'downhole' });
    await new Promise((z) => setTimeout(z, 200));
    h.st.domain = 'LITO'; h.st.domA = 'ORE'; h.st.domB = ''; h.st.binWidth = 2; h.st.maxDist = 6;
    await h.run();
    out.win = { sub: h.win.sub.textContent, readout: h.win.el.querySelector('.ct-readout').textContent, tsv: (h.win.el._tableTSV && h.win.el._tableTSV()) || '', recipe: h.win.el._recipe().tool };
    await m.writeDistanceColumn(B, M, 'DIST_BOX');
    const col = B.paintCols.find((c) => c.name === 'DIST_BOX');
    out.col = col ? [col.fvalues[0], col.fvalues[16 * 5 * 15], col.fvalues[16 * 5 * 24], col.nonnull] : null;
    // an OPEN surface: the box's bottom alone, wound facing DOWN — the side is by its normals, flipped to face up
    await m.openBlob(new Blob(['v -100 -100 80\nv 250 -100 80\nv 250 100 80\nv -100 100 80\nf 1 3 2\nf 1 4 3\n']), 'plane.obj', 'add');
    const P = m.layers().find((x) => x.name === 'plane.obj'), pd = await m.meshDistanceOf(P);
    out.open = { closed: pd.closed, sides: pd.sideNames.join('/'), d: [pd.at(0, 0, 79), pd.at(0, 0, 83), pd.at(300, 0, 80)] };
    return out;
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const dn = r.down;
  chk(`contact (down-hole): table ${dn.cols} keyed ${dn.key}; 10 bins of 2 m to ±10 m, ORE ${dn.rows.filter((x) => x[2] < 0).map((x) => x[3]).join('/')} | WASTE ${dn.rows.filter((x) => x[2] > 0).map((x) => x[3]).join('/')}, 8 m and 4 intervals a bin`,
    dn.cols === 'series,side,center,mean,metres,count' && dn.key === 'series,side,center' && dn.rows.length === 10
    && dn.rows.every((x) => near(x[3], x[2] < 0 ? 60 : 20) && near(x[4], 8) && x[5] === 4 && x[1] === (x[2] < 0 ? 'ORE' : 'WASTE'))
    && near(dn.rows[0][2], -9) && near(dn.rows[9][2], 9));
  chk(`contact (down-hole) values: step ${dn.v.step}, ratio ${dn.v.ratio}, slopes ${dn.v.slope_inside}/${dn.v.slope_outside}, ${dn.v.contacts} contacts in ${dn.v.holes} holes; A-below-B finds ${r.oneWay}; a routine without bins: “${r.noBins}”`,
    near(dn.v.step, 40) && near(dn.v.ratio, 3) && near(dn.v.slope_inside, 0) && near(dn.v.slope_outside, 0) && dn.v.contacts === 4 && dn.v.holes === 4 && r.oneWay === 0 && /binWidth/.test(r.noBins) && /maxDist/.test(r.noBins));
  chk(`contact: signed distance to a closed box (${r.d.join(', ')}) — negative inside, blank beyond maxDist`,
    r.surf.closed && near(r.d[0], 1) && near(r.d[1], -1.5) && near(r.d[2], 100) && near(r.d[3], 10) && r.d[4] === null);
  const sb = r.surf.rows.filter((x) => x[0] === 'blocks·FE'), ss = r.surf.rows.filter((x) => x[0] !== 'blocks·FE');
  chk(`contact (to a surface): blocks ${sb.length} bins of 80 blocks × 200 m³ (${sb[0] && sb[0][4]}), means ${sb.map((x) => x[3]).join('/')}; samples ${ss.length} bins of 4; step_ratio_2 ${r.surf.v.step_ratio_2}`,
    r.surf.cols === 'series,side,center,mean,weight,count' && sb.length === 10 && sb.every((x) => near(x[3], x[2] < 0 ? 60 : 20) && near(x[4], 16000) && x[5] === 80 && x[1] === (x[2] < 0 ? 'inside' : 'outside'))
    && ss.length === 10 && ss.every((x) => near(x[3], x[2] < 0 ? 60 : 20) && x[5] === 4 && near(x[4], 8)) && near(r.surf.v.step, 40) && near(r.surf.v.step_ratio_2, 1));
  chk(`contact window: “${r.win.sub}” · readout “${r.win.readout}” · ⧉ table ${r.win.tsv.split('\n').length - 1} rows · recipe ${r.win.recipe}`,
    /4 contacts in 4 holes/.test(r.win.sub) && /60 \| 20/.test(r.win.readout) && /step \+40/.test(r.win.readout) && r.win.tsv.split('\n').length - 1 === 6 && /^series\tside\tcenter/.test(r.win.tsv) && r.win.recipe === 'contact');
  chk(`contact ⇥ column: DIST_BOX on the blocks (z 51 → ${r.col && r.col[0]}, z 81 → ${r.col && r.col[1]}, z 99 → ${r.col && r.col[2]}, ${r.col && r.col[3]} values)`,
    r.col && near(r.col[0], 29) && near(r.col[1], -1) && near(r.col[2], -19) && r.col[3] === 2000);
  chk(`contact: an open surface reads its side by its normals (${r.open.sides}: z 79 → ${r.open.d[0]}, z 83 → ${r.open.d[1]}, beyond its edge → ${r.open.d[2]})`,
    !r.open.closed && r.open.sides === 'below/above' && near(r.open.d[0], -1) && near(r.open.d[1], 3) && near(Math.abs(r.open.d[2]), 50));
  await pg.close();
}

if (take()) {
  // ═══ reconciliation factors F1 / F2 / F3: a resource model (10 m blocks) and a grade-control model on
  //     ANOTHER lattice (5 m blocks) = the resource × known factors (tonnes × 1.1 via density, grade × 0.95);
  //     periods by a period column AND by nested solids (one block level cut in half → partial blocks);
  //     a production table = grade control × (0.98, 1.02) → exact F1 / F2 / F3; the tool, the routine
  //     check passing and failing, the window ═══
  const pg = await mkPage('sm2factors');
  await pg.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2factors', { recursive: true }); } catch { } });
  await pg.evaluate(async () => {
    const m = window._micro;
    // resource: 10 × 10 × 5 blocks of 10 m, centroids z 5…45; FE = 40 + level; SG 2.5; MM = M1 (top level), M2 (the next)
    const per = (z) => (z > 40 ? 'M1' : z > 30 ? 'M2' : '');
    const R = ['XC,YC,ZC,FE,SG,MM'];
    for (let k = 0; k < 5; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) { const z = 5 + 10 * k; R.push(`${5 + 10 * i},${5 + 10 * j},${z},${40 + k},2.5,${per(z)}`); }
    await m.openBlob(new Blob([R.join('\n') + '\n']), 'res.csv', 'replace');
    // grade control: 20 × 20 × 10 blocks of 5 m; grade 0.95 × the resource block it sits in, density 2.75 (= 1.1 × 2.5)
    const G = ['X,Y,Z,AU_GC,DENS,MM'];
    for (let k = 0; k < 10; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) { const z = 2.5 + 5 * k; G.push(`${2.5 + 5 * i},${2.5 + 5 * j},${z},${(0.95 * (40 + Math.floor(z / 10))).toFixed(4)},2.75,${per(z)}`); }
    await m.openBlob(new Blob([G.join('\n') + '\n']), 'gc.csv', 'add');
    // production: grade control × (tonnes 0.98, grade 1.02) for M1 and M2; M3 was never mined
    const gcT = 400 * 2 * 125 * 2.75;                       // 2 levels of 400 five-metre blocks a period
    const P = ['PERIOD,TONNES,HEAD_PCT', `M1,${gcT * 0.98},${0.95 * 44 * 1.02}`, `M2,${gcT * 0.98},${0.95 * 43 * 1.02}`, `M3,1000,40`];
    await m.openBlob(new Blob([P.join('\n') + '\n']), 'mill.csv', 'add', null, { asKind: 'table' });
    // two closed boxes over the whole footprint: z 40…60 (period M1) and z 35…60 (M2 = the part of it below z 40)
    const box = (z0, z1) => { const v = [[-20, -20, z0], [120, -20, z0], [120, 120, z0], [-20, 120, z0], [-20, -20, z1], [120, -20, z1], [120, 120, z1], [-20, 120, z1]]; const f = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]]; return new Blob([v.map((x) => `v ${x.join(' ')}`).join('\n') + '\n' + f.map((t) => `f ${t.join(' ')}`).join('\n') + '\n']); };
    await m.openBlob(box(40, 60), 'm1.obj', 'add');
    await m.openBlob(box(35, 60), 'm2.obj', 'add');
  });
  await pg.waitForFunction(() => window._micro.layers().length >= 5 && window._micro.layers().find((x) => x.name === 'mill.csv' && x.docs.tableDoc), null, { timeout: 30000 });
  const base = { model: 'res.csv', grade: 'FE', density: { col: 'SG' }, gc: 'gc.csv', gcGrade: 'AU_GC', gcDensity: { col: 'DENS' }, production: 'mill.csv', prodPeriod: 'PERIOD', prodTonnes: 'TONNES', prodGrade: 'HEAD_PCT', cutoff: 'none', gradeUnit: 'pct', modelUnit: 'pct', gcUnit: 'pct', prodUnit: 'pct' };
  const r = await pg.evaluate(async (base) => {
    const m = window._micro, out = {};
    const t1 = await m.runTool('factors', { ...base, periods: 'column', periodCol: 'MM' }, { routine: true });
    out.col = { cols: t1.table.columns.join(','), key: t1.table.key.join(','), rows: t1.table.rows, v: t1.values, warn: t1.warnings };
    const t2 = await m.runTool('factors', { ...base, periods: 'volumes', volumes: [{ name: 'M1', mesh: 'm1.obj', side: 'inside' }, { name: 'M2', mesh: 'm2.obj', side: 'inside' }], nested: true, probes: 2 }, { routine: true });
    out.vol = { rows: t2.table.rows, v: t2.values };
    // probes are PER AXIS and free (as select-by-solid's fraction column): the M2 cut is a horizontal plane
    // through the middle of a block level, so z probes see the half and xy probes alone can't
    const vz = (res) => m.runTool('factors', { ...base, periods: 'volumes', volumes: [{ name: 'M1', mesh: 'm1.obj', side: 'inside' }, { name: 'M2', mesh: 'm2.obj', side: 'inside' }], nested: true, probes: res }, { routine: true }).then((t) => t.table.rows.find((x) => x[0] === 'M2' && x[1] === 'tonnes')[2]);
    out.probes = { z4: await vz([1, 1, 4]), xy4: await vz([4, 4, 1]), z10: await vz([1, 1, 10]), bad: m.checkParams('factors', { ...base, periods: 'volumes', volumes: [{ name: 'M1', mesh: 'm1.obj' }], probes: [2, 2] }, { routine: true }).errors.join('; ') };
    out.noCut = m.checkParams('factors', { ...base, cutoff: undefined, density: undefined, periods: 'selection' }, { routine: true }).errors.join('; ');
    out.cut = (await m.runTool('factors', { ...base, periods: 'column', periodCol: 'MM', cutoff: 43.5 })).values;   // only M1 (FE 44; grade control 41.8 < 43.5 → nothing)
    return out;
  }, base);
  const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  const row = (rows, p, q) => rows.find((x) => x[0] === p && x[1] === q) || [];
  const c = r.col, v = c.v;
  chk(`factors (period column): table ${c.cols} keyed ${c.key}, ${c.rows.length} rows; M1 tonnes ${row(c.rows, 'M1', 'tonnes').slice(2, 5).join(' / ')}`,
    c.cols === 'period,quantity,model,gc,mill,f1,f2,f3,c_model,c_gc,c_mill,c_f1,c_f2,c_f3' && c.key === 'period,quantity' && c.rows.length === 6
    && near(row(c.rows, 'M1', 'tonnes')[2], 250000) && near(row(c.rows, 'M1', 'tonnes')[3], 275000) && near(row(c.rows, 'M1', 'tonnes')[4], 269500)
    && near(row(c.rows, 'M1', 'grade')[2], 44) && near(row(c.rows, 'M1', 'grade')[3], 41.8) && near(row(c.rows, 'M1', 'metal')[2], 250000 * 44 * 0.01));
  chk(`factors values (last period M2): f1 ${v.f1_t}/${v.f1_g}/${v.f1_m}, f2 ${v.f2_t}/${v.f2_g}/${v.f2_m}, f3 ${v.f3_t}/${v.f3_m}; to date c_f1_t ${v.c_f1_t}, c_f3_m ${v.c_f3_m}; warns: ${c.warn.join(' | ')}`,
    v.periods === 2 && near(v.f1_t, 1.1) && near(v.f1_g, 0.95) && near(v.f1_m, 1.1 * 0.95) && near(v.f2_t, 0.98) && near(v.f2_g, 1.02) && near(v.f2_m, 0.98 * 1.02)
    && near(v.f3_t, 1.1 * 0.98) && near(v.f3_g, 0.95 * 1.02) && near(v.f3_m, 1.1 * 0.95 * 0.98 * 1.02) && near(v.c_f1_t, 1.1) && near(v.c_f3_m, 1.1 * 0.95 * 0.98 * 1.02)
    && c.warn.some((w) => /not mined in either model: M3/.test(w)));
  const vr = r.vol.rows;
  chk(`factors (nested solids): M1 ${row(vr, 'M1', 'tonnes')[2]} / ${row(vr, 'M1', 'tonnes')[3]} t; M2 — half of the resource level, all of grade control's — ${row(vr, 'M2', 'tonnes')[2]} / ${row(vr, 'M2', 'tonnes')[3]} t, F1 ${row(vr, 'M2', 'tonnes')[5]} / ${row(vr, 'M2', 'grade')[5]}`,
    near(row(vr, 'M1', 'tonnes')[2], 250000) && near(row(vr, 'M1', 'tonnes')[3], 275000) && near(row(vr, 'M1', 'tonnes')[5], 1.1)
    && near(row(vr, 'M2', 'tonnes')[2], 125000) && near(row(vr, 'M2', 'tonnes')[3], 137500) && near(row(vr, 'M2', 'tonnes')[5], 1.1) && near(row(vr, 'M2', 'grade')[5], 0.95) && near(row(vr, 'M2', 'grade')[2], 43));
  const pr = r.probes;
  chk(`factors probes are per axis and uncapped: 1×1×4 sees the half level (${pr.z4} t), 4×4×1 can't (${pr.xy4} t), 1×1×10 is past the old cap of 6 (${pr.z10} t); a 2-item list is refused (“${pr.bad}”)`,
    near(pr.z4, 125000) && !near(pr.xy4, 125000) && near(pr.z10, 125000) && /probes: per block/.test(pr.bad));
  const blankV = (x) => x == null || Number.isNaN(x);
  chk(`factors: a routine states cutoff and density and can't use the selection (“${r.noCut}”); cutoff 43.5 keeps only M1's resource → F1 tonnes ${r.cut.f1_t} (grade control has none above it), F1 grade and F2 tonnes blank, not ∞ (${r.cut.f1_g}, ${r.cut.f2_t})`,
    /cutoff: a routine must state it/.test(r.noCut) && /density: a routine must state it/.test(r.noCut) && /periods: a routine allows/.test(r.noCut)
    && r.cut.periods === 1 && r.cut.f1_t === 0 && blankV(r.cut.f1_g) && blankV(r.cut.f2_t) && near(r.cut.model_t, 250000));
  // the routine: a passing check on F1 and a failing one (stops, naming what it read)
  await saveProject(pg);
  const rr = await pg.evaluate(async (base) => {
    const M_ = window._micro, wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const waitMeta = async (re, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = document.querySelector('#meta').textContent; if (re.test(t)) return t; await wait(150); } return document.querySelector('#meta').textContent; };
    const run = async (name, steps) => { document.querySelector('#meta').textContent = ''; document.querySelectorAll('.fwin').forEach((w) => w.remove()); M_.runRoutine({ name, tool: 'routine', params: { steps } }); return waitMeta(new RegExp(`routine “${name}” (— \\d+ steps? run|STOPPED)|routine: `)); };
    const step = { tool: 'factors', with: { ...base, periods: 'column', periodCol: 'MM' }, as: 'fac' };
    const pass = await run('monthend', [step, { check: 'abs(fac.f1_t - 1.1) < 0.001 and abs(fac.c_f3_m - 1.044582) < 0.0001', say: 'F1 as built' }]);
    const fail = await run('monthend2', [step, { check: 'abs(fac.f1_t - 1) < 0.05', say: 'F1 tonnes within 5%' }]);
    // the window, configured from the same settings
    const R = M_.layers().find((x) => x.name === 'res.csv');
    const h = M_.openFactors(R, { cfg: { ...base, periods: 'column', periodCol: 'MM', tolerance: 0.05, show: 'tonnes' } });
    await h.run();
    const spec = h.win.el._factorsSpec;
    return { pass, fail, win: { sub: h.win.sub.textContent, readout: h.win.el.querySelector('.fac-readout').textContent, rows: h.win.el.querySelectorAll('.fac-tbl tr').length, flagged: [...h.win.el.querySelectorAll('.fac-tbl td')].filter((td) => /outside/.test(td.title || '')).length, tsv: (h.win.el._tableTSV && h.win.el._tableTSV()) || '', recipe: h.win.el._recipe().tool, band: spec && spec.hBand, ticks: spec && spec.xTicks.map((t) => t[1]).join(','), lines: spec && spec.series.filter((s) => s.kind === 'line').map((s) => s.name).join(','), fig: !!h.win.el.querySelector('.pp-exp') && [...h.win.el.querySelectorAll('.pp-exp button')].map((b) => b.textContent).join(' ') } };
  }, base);
  chk(`factors routine: the F1 check passes (“${rr.pass.slice(0, 90)}”) and a 5% check stops naming what it read (“${rr.fail.slice(0, 140)}”)`,
    /monthend” — \d+ steps? run/.test(rr.pass) && /STOPPED/.test(rr.fail) && /F1 tonnes within 5%/.test(rr.fail) && /fac\.f1_t = 1\.1/.test(rr.fail));
  const w = rr.win;
  chk(`factors window: “${w.sub}” · readout “${w.readout}” · ${w.rows} table rows, ${w.flagged} factors outside ±5% · chart ${w.lines} over ${w.ticks}, band ${w.band && w.band.lo}…${w.band && w.band.hi} · buttons ${w.fig} · recipe ${w.recipe}`,
    /2 periods/.test(w.sub) && /F1 t 1\.100 · g 0\.950/.test(w.readout) && w.rows === 7 && w.flagged > 0 && w.ticks === 'M1,M2' && /F1 tonnes,F2 tonnes,F3 tonnes/.test(w.lines)
    && near(w.band.lo, 0.95) && near(w.band.hi, 1.05) && /⇥ figure/.test(w.fig) && /⇥ layer/.test(w.fig) && w.recipe === 'factors' && /^period\tquantity\tresource model/.test(w.tsv) && w.tsv.split('\n').length === 7);
  await pg.close();
}

// ── §126: THE CONSISTENCY ROUND (2026-11-23) — each a place where two sides of micro said different
//     things: a routine step's top-level filter: was dropped (now refused, flagged in the box, the tool's
//     settings completed under with: only, column completion from the setting's own layer); factors'
//     volume sides follow the topology (closed → inside / outside, open or a grid → above / below; a
//     side that doesn't fit is an error), grids are volumes, nested on and 3×3×3 by default, the
//     declared grade-tonnage density is the default, a metal factor of 1/31.1035 works and "1/x" is
//     refused; the resource table takes its metal factor from the grade unit; contact converts units,
//     measures to a grid, offers numeric domains and states its bins; validation reads derived sample
//     columns, has band controls, a tolerance and a recipe, and keeps its setup; grid export's decimals
//     are any whole number 0–12. ──
if (take()) {
  const pc = await mkPage('sm2consist');
  await pc.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2consist', { recursive: true }); } catch { } });
  await pc.evaluate(async () => {
    const m = window._micro;
    // 6 × 6 × 3 blocks of 10 m (z 5 / 15 / 25); FE 40 + level, SG 2.5, LITO HEM (low x) / ITA, DOMC 1 / 2
    const R = ['XC,YC,ZC,FE,SG,LITO,DOMC'];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) R.push(`${5 + 10 * i},${5 + 10 * j},${5 + 10 * k},${40 + k},2.5,${i < 3 ? 'HEM' : 'ITA'},${i < 3 ? 1 : 2}`);
    await m.openBlob(new Blob([R.join('\n') + '\n']), 'm.csv', 'replace');
    const G = ['X,Y,Z,AU_GC']; for (let i = 0; i < 6; i++) G.push(`${5 + 10 * i},5,5,1`);
    await m.openBlob(new Blob([G.join('\n') + '\n']), 'g.csv', 'add');
    await m.openBlob(new Blob(['PERIOD,TONNES,HEAD\nP1,100,40\n']), 'mill.csv', 'add', null, { asKind: 'table' });
    // a closed box over the middle level (z 10…20), an open sheet and a flat grid at z 10 (a block boundary)
    const obj = (v, f) => new Blob([v.map((x) => `v ${x.join(' ')}`).join('\n') + '\n' + f.map((t) => `f ${t.join(' ')}`).join('\n') + '\n']);
    const bv = (z0, z1) => [[-20, -20, z0], [80, -20, z0], [80, 80, z0], [-20, 80, z0], [-20, -20, z1], [80, -20, z1], [80, 80, z1], [-20, 80, z1]];
    await m.openBlob(obj(bv(10, 20), [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]]), 'box.obj', 'add');
    await m.openBlob(obj([[-20, -20, 10], [80, -20, 10], [80, 80, 10], [-20, 80, 10]], [[1, 2, 3], [1, 3, 4]]), 'sheet.obj', 'add');
    let asc = 'ncols 11\nnrows 11\nxllcorner -25\nyllcorner -25\ncellsize 10\nNODATA_value -9999\n'; for (let r = 0; r < 11; r++) asc += Array(11).fill('10').join(' ') + '\n';
    await m.openBlob(new Blob([asc]), 'flat.asc', 'add');
    // six vertical holes: 0–10 m HEM (code 1), 10–30 m ITA (code 2); FE 40 + hole
    const collar = ['HOLEID,X,Y,Z,EOH'], survey = ['HOLEID,DEPTH,AZ,DIP'], assay = ['HOLEID,FROM,TO,FE,LITO,DCODE'];
    for (let h = 0; h < 6; h++) { const id = 'H' + h; collar.push(`${id},${5 + h * 10},25,30,30`); survey.push(`${id},0,0,-90`); for (let d = 0; d < 30; d += 10) assay.push(`${id},${d},${d + 10},${40 + h},${d < 10 ? 'HEM' : 'ITA'},${d < 10 ? 1 : 2}`); }
    const f = (a, nm) => new File([a.join('\n')], nm, { type: 'text/csv' });
    await m.importDrillholes({ collar: f(collar, 'c.csv'), survey: f(survey, 's.csv'), intervals: f(assay, 'a.csv') }, {}, 'add');
  });
  await pc.waitForFunction(() => { const Ls = window._micro.layers(); return Ls.some((x) => x.dh && x.docs.dhDoc) && Ls.some((x) => x.name === 'flat.asc' && x.docs.gridDoc) && Ls.some((x) => x.name === 'mill.csv' && x.docs.tableDoc); }, null, { timeout: 30000 });
  await saveProject(pc);
  const r = await pc.evaluate(async () => {
    const M = window._micro, W = window.micro, out = {}, wait = (ms) => new Promise((q) => setTimeout(q, ms));
    const rows = (t, q = 'tonnes') => t.table.rows.filter((x) => x[1] === q).map((x) => [x[0], x[2]]);
    const err = (pr) => pr.then(() => 'ran', (e) => e.message);
    const base = { model: 'm.csv', grade: 'FE', density: { col: 'SG' }, cutoff: 'none', gradeUnit: 'pct', modelUnit: 'pct', periods: 'volumes', probes: [1, 1, 1] };
    // ── factors: the side follows the topology; the default is inside for a solid, above for a surface ──
    const a = await W.runTool('factors', { ...base, volumes: [{ name: 'in', mesh: 'box.obj' }, { name: 'out', mesh: 'box.obj', side: 'outside' }], nested: false });
    const s = await W.runTool('factors', { ...base, volumes: [{ name: 'up', mesh: 'sheet.obj' }] });
    const g = await W.runTool('factors', { ...base, volumes: [{ name: 'up', mesh: 'flat.asc', side: 'above' }, { name: 'down', mesh: 'flat.asc', side: 'below' }], nested: false });
    out.fac = { boxSides: a.resolved.volumes.map((v) => v.side), box: rows(a), sheetSide: s.resolved.volumes[0].side, sheet: rows(s), grid: rows(g),
      openInside: await err(W.runTool('factors', { ...base, volumes: [{ name: 'x', mesh: 'sheet.obj', side: 'inside' }] })),
      gridInside: await err(W.runTool('factors', { ...base, volumes: [{ name: 'x', mesh: 'flat.asc', side: 'inside' }] })),
      boxAbove: await err(W.runTool('factors', { ...base, volumes: [{ name: 'x', mesh: 'box.obj', side: 'above' }] })),
      defaults: (({ nested, probes }) => ({ nested, probes }))(M.checkParams('factors', { model: 'm.csv', grade: 'FE' }).params) };
    // the declared grade-tonnage density (2 g/cm³) is the default when a tool call leaves density out
    const L = M.layers().find((x) => x.name === 'm.csv');
    L.gtUnits = { grade: 'pct', weight: '2', densUnit: 'g/cm3' };
    const d = await W.runTool('factors', { ...base, density: undefined, periods: 'filter', periodFilter: 'FE > 0' });
    out.fac.declared = d.values.model_t;
    // ── the factors window: the side menu by topology, the declared density, the metal factor field ──
    const h = M.openFactors(L, { cfg: { model: 'm.csv', grade: 'FE', gc: 'm.csv', gcGrade: 'FE', periods: 'volumes', volumes: [{ name: 'p', mesh: 'box.obj' }], cutoff: 'none', gradeUnit: 'pct' } });
    const sideOpts = async () => { for (let k = 0; k < 60 && !(h.win.el.querySelector('select[data-side]') && h.win.el.querySelector('select[data-side]').options[0].value); k++) await wait(50); const ss = h.win.el.querySelector('select[data-side]'); return [...ss.options].map((o) => o.value).join('/'); };
    const pickMesh = async (name) => { const ss = h.win.el.querySelector('select[data-side]'), ms = ss.previousElementSibling; ms.value = String(M.layers().find((x) => x.name === name).id); ms.dispatchEvent(new Event('change')); await wait(30); return sideOpts(); };
    out.win = { box: await sideOpts(), sheet: await pickMesh('sheet.obj'), grid: await pickMesh('flat.asc'), dens: JSON.stringify(h.st.model.density), nested: h.st.nested, res: h.st.resolution.join('x') };
    const mfIn = () => h.win.el.querySelector('input[data-metal-factor]');
    mfIn().value = '1/31.1035'; mfIn().dispatchEvent(new Event('change')); await wait(30);
    out.win.good = !mfIn().classList.contains('bad-in');
    h.st.periods = 'filter'; h.st.periodFilter = 'FE > 0'; h.st.production = null; await h.run();
    out.win.mf = h.st.scan ? h.st.scan.mf : h.win.el._runFailed;
    mfIn().value = '1/x'; mfIn().dispatchEvent(new Event('change')); await wait(30);
    out.win.bad = mfIn().classList.contains('bad-in');
    await h.run(); out.win.refused = h.win.el._runFailed || '';
    h.win.close();
    // ── the resource table: a declared grade unit sets the metal factor (as factors); a stated one wins ──
    const rb = { layer: 'm.csv', grade: 'FE', cutoffs: [0], density: { col: 'SG' } };
    const r1 = await W.runTool('resource', { ...rb, gradeUnit: '%' }), r2 = await W.runTool('resource', { ...rb, gradeUnit: 'pct', metalFactor: 1 }), r3 = await W.runTool('resource', rb);
    out.res = { pct: [r1.resolved.metalFactor, r1.table.rows[0][3] / (r1.table.rows[0][1] * r1.table.rows[0][2]), r1.table.units.metal], stated: r2.resolved.metalFactor, none: r3.resolved.metalFactor };
    // ── contact: units, a grid surface, numeric domains, the stated bins ──
    const cs = { mode: 'surface', layer: 'm.csv', series: [{ col: 'FE', unit: 'pct' }], surface: 'flat.asc', binWidth: 5, maxDist: 20 };
    const c1 = await W.runTool('contact', cs), c2 = await W.runTool('contact', { ...cs, gradeUnit: 'fraction' });
    out.ct = { centers: c1.table.rows.map((x) => `${x[1]}@${x[2]}`).join(' '), means: c1.table.rows.map((x) => x[3]), meansFrac: c2.table.rows.map((x) => x[3]), unit: c2.table.units.mean, stepFrac: c2.values.mean_all_outside / c1.values.mean_all_outside,
      binsSurf: (await W.runTool('contact', { ...cs, binWidth: undefined, maxDist: undefined })).resolved.binWidth };
    const D = M.layers().find((x) => x.dh && x.docs.dhDoc);
    const dh = await W.runTool('contact', { mode: 'downhole', layer: D.name, series: [{ col: 'FE' }], domain: 'DCODE', domA: '1' });
    out.ct.dhContacts = dh.values.contacts; out.ct.binsDh = dh.resolved.binWidth;
    const hc = M.openContact(D, { mode: 'downhole' }); await wait(300);
    out.ct.domainOpts = [...hc.win.el.querySelectorAll('select')].map((x) => [...x.options].map((o) => o.value)).find((o) => o.includes('LITO')) || [];
    out.ct.unitSels = hc.win.el.querySelectorAll('.sw-ser select.sw-sel').length;
    hc.win.close();
    // ── validation: derived SAMPLE columns (a calc grade, a text calc domain), the window's band / tolerance / recipe ──
    await M.applyCalcCols(D, [{ name: 'FE2', expr: 'FE * 2', ty: 'number' }, { name: 'DC', expr: 'LITO', ty: 'string' }]);
    await M.applyCalcCols(L, [{ name: 'DC', expr: 'LITO', ty: 'string' }]);
    const vb = { model: 'm.csv', samples: D.name, modelGrade: 'FE', axis: 'Z', bandW: 10 };
    const v1 = await W.runTool('validation', { ...vb, sampleGrade: 'FE' }), v2 = await W.runTool('validation', { ...vb, sampleGrade: 'FE2' });
    const v3 = await W.runTool('validation', { ...vb, sampleGrade: 'FE', filter: 'LITO = "HEM"' }), v4 = await err(W.runTool('validation', { ...vb, sampleGrade: 'FE', filter: 'DC = "HEM"' }));
    const v4n = v4 !== 'ran' ? v4 : null, v4v = v4n ? null : await W.runTool('validation', { ...vb, sampleGrade: 'FE', filter: 'DC = "HEM"' });
    out.val = { naive: [v1.values.samples_naive, v2.values.samples_naive], lito: v3.values.samples, dc: v4n || v4v.values.samples, dcModel: v4n ? null : v4v.values.model_mean, litoModel: v3.values.model_mean };
    const hv = M.openValidation(L, { cfg: { samples: D.name, modelGrade: 'FE', sampleGrade: 'FE', axis: 'Z', bandW: 10, off: 0, tolerance: 0.5 } });
    for (let k = 0; k < 200 && /sampling|^$/.test(hv.win.sub.textContent); k++) await wait(50);
    out.vwin = { sub: hv.win.sub.textContent, bias: (hv.win.el.querySelector('.val-stat.ok, .val-stat.bad') || {}).className || '', recipe: [...hv.win.el.querySelectorAll('button')].some((b) => /save as recipe/.test(b.textContent)), rcp: hv.win.el._recipe().params };
    hv.win.close();
    const hv2 = M.openValidation(L); await wait(100);
    out.vwin.saved = L.analysis && L.analysis.validation; out.vwin.restored = { bandW: hv2.st.bandW, off: hv2.st.off, tol: hv2.st.tolerance };
    hv2.win.close();
    // ── grid export: decimals any whole number 0–12 (the dialog's field and the tool) ──
    const GL = M.layers().find((x) => x.name === 'flat.asc');
    M.openGridExportDialog(GL);
    const dec = document.querySelector('#geDlgBody input[data-decimals]');
    dec.value = '7'; dec.dispatchEvent(new Event('input')); const seven = !dec.classList.contains('bad-in');
    dec.value = '13'; dec.dispatchEvent(new Event('input')); document.querySelector('#geGo').click(); await wait(50);
    out.ge = { seven, thirteen: dec.classList.contains('bad-in'), msg: document.querySelector('#geDlgMsg').textContent, open: document.querySelector('#geDlg').classList.contains('show') };
    document.querySelector('#geCancel').click();
    await M.openBlob(new Blob(['ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 10\nNODATA_value -9999\n1.23456789 1.23456789\n1.23456789 1.23456789\n']), 'frac.asc', 'add');
    for (let k = 0; k < 100 && !M.layers().some((x) => x.name === 'frac.asc' && x.docs.gridDoc); k++) await wait(50);
    const t7 = await W.runTool('gridexport', { layer: 'frac.asc', decimals: 7 });
    out.ge.t7 = (await t7.file.blob.text()).split('\n')[6].split(' ')[0];
    out.ge.t13 = await err(W.runTool('gridexport', { layer: 'flat.asc', decimals: 13 }));
    // ── a routine step's top-level filter: refused, never dropped ──
    document.querySelector('#meta').textContent = '';
    M.runRoutine({ name: 'loose', tool: 'routine', params: { steps: [{ tool: 'stats', filter: 'FE > 41', with: { layer: 'm.csv', cols: ['FE'] }, as: 's' }] } });
    for (let k = 0; k < 200 && !/routine/.test(document.querySelector('#meta').textContent); k++) await wait(50);
    out.loose = document.querySelector('#meta').textContent;
    return out;
  });
  const near = (x, y, t = 1e-9) => Number.isFinite(x) && Math.abs(x - y) <= t * Math.max(1, Math.abs(y));
  const lvl = 36 * 1000 * 2.5;                                // one level of blocks, tonnes
  const F = r.fac;
  chk(`factors sides by topology: a closed box defaults to inside (${F.boxSides}) — inside ${F.box[0][1]} + outside ${F.box[1][1]} t = the model; an open sheet defaults to above (${F.sheetSide}, ${F.sheet[0][1]} t); a grid ${F.grid.map((x) => x[1]).join(' / ')} t above / below`,
    F.boxSides.join() === 'inside,outside' && near(F.box[0][1], lvl) && near(F.box[1][1], 2 * lvl) && F.sheetSide === 'above' && near(F.sheet[0][1], 2 * lvl) && near(F.grid[0][1], 2 * lvl) && near(F.grid[1][1], lvl));
  chk(`factors: a side that doesn't fit is an error (“${F.openInside}” · “${F.gridInside}” · “${F.boxAbove}”)`,
    /doesn't fit sheet.*an open surface takes above or below/.test(F.openInside) && /a gridded surface takes above or below/.test(F.gridInside) && /a closed solid takes inside or outside/.test(F.boxAbove));
  chk(`factors defaults: nested ${F.defaults.nested}, probes ${JSON.stringify(F.defaults.probes)}; density left out → the declared 2 g/cm³ (${F.declared} t, not SG 2.5's ${3 * lvl})`,
    F.defaults.nested === true && JSON.stringify(F.defaults.probes) === '[3,3,3]' && near(F.declared, 3 * 36 * 1000 * 2));
  const w = r.win;
  chk(`factors window: sides follow the volume (box ${w.box} · sheet ${w.sheet} · grid ${w.grid}); density from the declaration ${w.dens}; nested ${w.nested}, probes ${w.res}`,
    w.box === 'inside/outside' && w.sheet === 'above/below' && w.grid === 'above/below' && w.dens === '{"const":2,"unit":"g/cm3"}' && w.nested === true && w.res === '3x3x3');
  chk(`factors window: metal × 1/31.1035 is valid (${w.good}) and used (${w.mf}); “1/x” is marked (${w.bad}) and Run refuses it (“${w.refused}”)`,
    w.good && near(w.mf, 1 / 31.1035) && w.bad && /metal factor “1\/x”/.test(w.refused));
  chk(`resource table: grade unit % → metal factor ${r.res.pct[0]} (metal / (t × g) = ${r.res.pct[1]}, unit ${r.res.pct[2]}); a stated 1 wins (${r.res.stated}); no unit → ${r.res.none}`,
    near(r.res.pct[0], 0.01) && near(r.res.pct[1], 0.01) && r.res.pct[2] === 't' && r.res.stated === 1 && r.res.none === 1);
  const ct = r.ct;
  chk(`contact to a GRID: vertical distances, below negative (${ct.centers}); a pct series in a fraction report: ${ct.means.join('/')} → ${ct.meansFrac.join('/')} (${ct.unit})`,
    ct.centers === 'below@-2.5 above@7.5 above@17.5' && ct.meansFrac.every((x, i) => near(x, ct.means[i] * 0.01)) && ct.unit === 'fraction' && near(ct.stepFrac, 0.01));
  chk(`contact: a numeric domain code works (${ct.dhContacts} contacts on DCODE = 1) and is offered after the text ones (${ct.domainOpts.join(',')}); a unit per series (${ct.unitSels} selects); bins absent → ${ct.binsDh} down-hole, ${ct.binsSurf} to a surface`,
    ct.dhContacts === 6 && ct.domainOpts.indexOf('LITO') >= 0 && ct.domainOpts.indexOf('DCODE') > ct.domainOpts.indexOf('LITO') && ct.unitSels >= 3 && ct.binsDh === 2 && ct.binsSurf === 5);
  const v = r.val;
  chk(`validation reads derived SAMPLE columns: a calc FE2 doubles the naive mean (${v.naive.join(' → ')}); a text calc domain on both sides keeps what LITO does (${v.dc} = ${v.lito} samples, model ${v.dcModel} = ${v.litoModel})`,
    near(v.naive[1], 2 * v.naive[0]) && v.dc === v.lito && v.lito === 6 && near(v.dcModel, v.litoModel));
  const vw = r.vwin;
  chk(`validation window: bands from the setup (“${vw.sub}”), bias judged at ±50% (${vw.bias}), save as recipe there (${vw.recipe}, bandW ${vw.rcp.bandW})`,
    /bands 10 m from 0/.test(vw.sub) && /ok/.test(vw.bias) && vw.recipe && vw.rcp.bandW === 10 && vw.rcp.tolerance === 0.5);
  chk(`validation window keeps its setup (${JSON.stringify(vw.saved)}) and reopens with it (${JSON.stringify(vw.restored)})`,
    vw.saved && vw.saved.bandW === 10 && vw.saved.off === 0 && vw.restored.bandW === 10 && vw.restored.off === 0 && vw.restored.tol === 0.5);
  chk(`grid export decimals: 7 is fine (${r.ge.seven}, the tool writes ${r.ge.t7}); 13 is marked and refused (${r.ge.thirteen}, “${r.ge.msg}”, dialog open ${r.ge.open}; tool: “${r.ge.t13}”)`,
    r.ge.seven && r.ge.t7 === '1.2345679' && r.ge.thirteen && /0–12/.test(r.ge.msg) && r.ge.open && /decimals: a whole number 0–12/.test(r.ge.t13));
  chk(`a routine step's top-level filter: is refused, not dropped (“${r.loose.slice(0, 160)}”)`, /filter at the step’s top level is a step keyword.*put it under with:/.test(r.loose));
  // the routine editor's box: a tool setting named like a step keyword is completed under with: only,
  // flagged at the top level; a column setting completes from its own layer (gcGrade → gc)
  await pc.evaluate(() => { window._micro.openRoutineWindow(null); [...document.querySelectorAll('.fwin[data-routine] button')].find((x) => x.textContent === '+ inline step').click(); });
  await pc.evaluate(() => { const s = [...document.querySelectorAll('.fwin[data-routine] select')].find((x) => [...x.options].some((o) => o.value === 'stats')); s.value = 'stats'; s.dispatchEvent(new Event('change')); });
  const ta = pc.locator('.fwin[data-routine] .yf-wrap textarea').last();
  await ta.click();
  const popup = () => pc.evaluate(() => (document.querySelector('#acPopup').classList.contains('show') ? [...document.querySelectorAll('#acPopup .ac-val')].map((x) => x.textContent) : []));
  await pc.keyboard.type('fil'); const topKeys = await popup();
  await pc.keyboard.press('Escape'); await pc.keyboard.type('ter: "FE > 41"'); await pc.keyboard.press('Escape');
  await pc.waitForFunction(() => [...document.querySelectorAll('.fwin[data-routine] .yf-msg')].some((x) => /put it under with/.test(x.textContent)), null, { timeout: 5000 }).catch(() => {});
  const flagged = await pc.evaluate(() => [...document.querySelectorAll('.fwin[data-routine] .yf-msg')].map((x) => x.textContent).join(' | '));
  await pc.keyboard.press('Control+a'); await pc.keyboard.type('with:'); await pc.keyboard.press('Enter'); await pc.keyboard.type('fil');
  const withKeys = await popup();
  await pc.keyboard.press('Escape');
  // factors: gcGrade completes gc's columns, production lists only table layers
  await pc.evaluate(() => { const s = [...document.querySelectorAll('.fwin[data-routine] select')].find((x) => [...x.options].some((o) => o.value === 'factors')); s.value = 'factors'; s.dispatchEvent(new Event('change')); });
  await ta.click(); await pc.keyboard.press('Control+a');
  await pc.keyboard.type('with:'); await pc.keyboard.press('Enter'); await pc.keyboard.type('model: "m.csv"'); await pc.keyboard.press('Escape'); await pc.keyboard.press('End'); await pc.keyboard.press('Enter');
  await pc.keyboard.type('gc: "g.csv"'); await pc.keyboard.press('Escape'); await pc.keyboard.press('End'); await pc.keyboard.press('Enter');
  await pc.keyboard.type('gcGrade: '); const gcCols = await popup(); await pc.keyboard.press('Escape'); await pc.keyboard.type('"AU_GC"'); await pc.keyboard.press('Escape'); await pc.keyboard.press('End'); await pc.keyboard.press('Enter');
  await pc.keyboard.type('production: '); const prodLayers = await popup(); await pc.keyboard.press('Escape');
  chk(`yaml box: filter is not offered at the step's top level (${topKeys.join(',') || 'nothing'}) but is under with: (${withKeys.join(',')}); typed there it is flagged (“${flagged.slice(0, 150)}”)`,
    !topKeys.includes('filter') && withKeys.includes('filter') && /filter: at the step’s top level this is a step keyword.*put it under with:/.test(flagged));
  chk(`yaml box: gcGrade completes grade control's columns (${gcCols.join(',')}), production only table layers (${prodLayers.join(',')})`,
    gcCols.includes('AU_GC') && !gcCols.includes('FE') && prodLayers.includes('mill.csv') && !prodLayers.includes('m.csv') && !prodLayers.includes('box.obj'));
  await pc.close();
}

// ── by geometry on a ROTATED model: rotate the SOLID, not the model. A rotated copy
//     of an axis-aligned model + solid (both turned by one rotation about one point)
//     gives the same fraction per record as the unrotated pair — the dense engine runs
//     in the lattice frame, where the rotated blocks are axis-aligned again. Before,
//     evalSolidOnGrid returned null on a rotated lattice: the fraction was refused and
//     flag / select fell back to centroids. Open surfaces (z-axis turn, so "above"
//     stays world-up) and a GRIDDED surface (not rotated: the probes are, checked
//     against a brute force built from the declared basis) too. ──
if (take()) {
  const pr = await mkPage('sm2rotgeom');
  const asc = (() => {                                      // a wavy heightfield at block scale: majority ≠ centroid somewhere
    const nc = 81, nr = 81; let t = `ncols ${nc}\nnrows ${nr}\nxllcorner 850\nyllcorner 1850\ncellsize 5\nNODATA_value -9999\n`;
    for (let r = 0; r < nr; r++) { const row = []; for (let c = 0; c < nc; c++) { const x = 850 + c * 5, y = 2250 - r * 5; row.push((112 + 7 * Math.sin((x - 1000) / 7) * Math.cos((y - 2000) / 9)).toFixed(4)); } t += row.join(' ') + '\n'; }
    return t;
  })();
  await pr.evaluate((t) => window._micro.openBlob(new Blob([t]), 'wave.asc', 'replace'), asc);
  await pr.waitForFunction(() => window._micro.layers().some((L) => L.docs.gridDoc), null, { timeout: 30000 });
  const rg = await pr.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const S10 = 10, NX = 8, NY = 6, NZ = 4, O = [1000, 2000, 100], P = [1035, 2025, 115];
    const mul = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
    const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };   // column-major
    const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
    const mm = (A, B) => { const o = []; for (let j = 0; j < 3; j++) { const col = mul(A, [B[j * 3], B[j * 3 + 1], B[j * 3 + 2]]); o.push(...col); } return o; };
    const turn = (R, p) => { const q = mul(R, [p[0] - P[0], p[1] - P[1], p[2] - P[2]]); return [q[0] + P[0], q[1] + P[1], q[2] + P[2]]; };
    const cents = []; for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) cents.push([O[0] + i * S10, O[1] + j * S10, O[2] + k * S10]);
    const model = async (name, R) => {
      const pts = R ? cents.map((c) => turn(R, c)) : cents, col = (a) => Float64Array.from(pts.map((p) => p[a]));
      const spec = { kind: 'blocks', name, columns: { X: col(0), Y: col(1), Z: col(2), V: Float64Array.from(pts.map((_, r) => r)) }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'V' } };
      if (R) spec.lattice = { basis: { origin: turn(R, O), U: mul(R, [S10, 0, 0]), V: mul(R, [0, S10, 0]), W: mul(R, [0, 0, S10]), counts: [NX, NY, NZ] } };
      const id = await W.addLayer(spec);
      return { L: M.layers().find((l) => l.id === id), pts };
    };
    const mesh = async (name, V, T, R) => { const id = await W.addLayer({ kind: 'mesh', name, vertices: Float64Array.from(R ? V.flatMap((p) => turn(R, p)) : V.flat()), triangles: Uint32Array.from(T) }); return M.layers().find((l) => l.id === id); };
    const codesOf = (col) => Array.from(col ? col.codes : []);
    const same = (a, b) => a.length === b.length && a.length > 0 && a.every((v, i) => v === b[i]);
    const out = {};
    // ── 1. a closed solid, a general 3D turn (W tilted off vertical) ──
    const Rg = mm(rz(Math.PI / 6), rx(Math.PI / 9));
    const A = await model('aa', null), B = await model('rot', Rg);
    out.rot = !!(B.L.docs.blockDoc.grid && B.L.docs.blockDoc.grid.rot) && !(A.L.docs.blockDoc.grid && A.L.docs.blockDoc.grid.rot);
    const lo = [1012.5, 2007.5, 102.5], hi = [1047.5, 2032.5, 122.5];   // faces between probe planes (offsets 7.5 of a 10 m block)
    const BV = []; for (let k = 0; k < 8; k++) BV.push([k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]);
    const BT = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    const SA = await mesh('boxA', BV, BT, null), SB = await mesh('boxB', BV, BT, Rg);
    const fa = codesOf(await M.ratioBySolid(SA, A.L, { name: 'FR', res: 3, mode: 'inside' }));
    const colB = await M.ratioBySolid(SB, B.L, { name: 'FR', res: 3, mode: 'inside' });
    const fb = codesOf(colB);
    out.ratio = { made: !!colB, same: same(fa, fb), partial: fb.filter((c) => c > 0 && c < 255).length, full: fb.filter((c) => c === 255).length, diff: fa.reduce((n, v, i) => n + (v !== fb[i]), 0), meta: document.querySelector('#meta').textContent };
    await M.flagBySolid(SA, [A.L], { name: 'FL', label: 'IN', mode: 'inside' });
    await M.flagBySolid(SB, [B.L], { name: 'FL', label: 'IN', mode: 'inside' });
    const fl = (L) => { const c = M.paintColByName(L, 'FL'), k = c ? c.dict.indexOf('IN') : -1; return c ? Array.from(c.codes, (v) => (v === k ? 1 : 0)) : []; };
    await M.selectBySolid(SA, { targets: [A.L], mode: 'inside' }); const sa = Array.from(A.L._selMask || []);
    await M.selectBySolid(SB, { targets: [B.L], mode: 'inside' }); const sb = Array.from(B.L._selMask || []);
    out.flag = { same: same(fl(A.L), fl(B.L)), n: fl(B.L).reduce((s, v) => s + v, 0), sel: same(sa, sb), nSel: sb.reduce((s, v) => s + v, 0),
      dense: !(SB._solidBVH && SB._solidBVH.solid) };      // the sparse per-centroid fallback builds this BVH; the dense lattice path never does
    // ── 2. an open surface, ABOVE — a turn about the vertical (world-up stays up) ──
    const Rz = rz(0.61);
    const A2 = await model('aa2', null), B2 = await model('rot2', Rz);
    const SV = [], ST = [], G = 7;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const x = 900 + i * 45, y = 1900 + j * 45; SV.push([x, y, 111.3 + 0.13 * (x - 1000) - 0.07 * (y - 2000) + 3 * Math.sin(i * 1.7 + j)]); }
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i; ST.push(a, a + 1, a + G, a + 1, a + G + 1, a + G); }
    const UA = await mesh('sheetA', SV, ST, null), UB = await mesh('sheetB', SV, ST, Rz);
    const ua = codesOf(await M.ratioBySolid(UA, A2.L, { name: 'UP', res: 3, mode: 'above' }));
    const ub = codesOf(await M.ratioBySolid(UB, B2.L, { name: 'UP', res: 3, mode: 'above' }));
    out.surf = { same: same(ua, ub), partial: ub.filter((c) => c > 0 && c < 255).length, diff: ua.reduce((n, v, i) => n + (v !== ub[i]), 0), len: ub.length };
    // ── 3. a GRIDDED surface on the tilted model: probes rotated into world ──
    const Gl = M.layers().find((l) => l.docs.gridDoc), surf = M.surfaceFromGrid(Gl.docs.gridDoc.grid);
    const Ub = mul(Rg, [S10, 0, 0]), Vb = mul(Rg, [0, S10, 0]), Wb = mul(Rg, [0, 0, S10]);
    const brute = (r, n) => B.pts.map((c) => { let ins = 0, k = 0; for (let w = 0; w < n; w++) for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) { const a = (u + 0.5) / n - 0.5, b2 = (v + 0.5) / n - 0.5, d = (w + 0.5) / n - 0.5; const p = [0, 1, 2].map((ax) => c[ax] + a * Ub[ax] + b2 * Vb[ax] + d * Wb[ax]); const zs = surf.sampleZ(p[0], p[1]); if (Number.isNaN(zs)) continue; k++; if (p[2] < zs) ins++; } return r(ins / k); });
    const wantFlag = brute((f) => (f >= 0.5 ? 1 : 0), 2), wantRatio = brute((f) => Math.round(255 * f), 3);
    const centroid = B.pts.map((c) => (c[2] < surf.sampleZ(c[0], c[1]) ? 1 : 0));
    await M.flagByGridSurface(Gl, [B.L], { name: 'GB', label: 'BELOW', mode: 'below' });
    const gc = M.paintColByName(B.L, 'GB'), gk = gc ? gc.dict.indexOf('BELOW') : -1, gotFlag = gc ? Array.from(gc.codes, (v) => (v === gk ? 1 : 0)) : [];
    const gr = codesOf(await M.ratioByGridSurface(Gl, B.L, { name: 'GR', res: [3, 3, 3], mode: 'below' }));
    await M.selectBySolid(Gl, { targets: [B.L], mode: 'below' }); const gs = Array.from(B.L._selMask || []);
    out.grid = { flag: same(gotFlag, wantFlag), sel: same(gs, wantFlag), ratio: same(gr, wantRatio), partial: gr.filter((c) => c > 0 && c < 255).length,
      nFlag: wantFlag.reduce((s, v) => s + v, 0), vsCentroid: wantFlag.reduce((n, v, i) => n + (v !== centroid[i]), 0), n: B.pts.length };
    // ── the solid recipe's probes: one number n = n×n×n; a malformed value is an error
    //     (it used to become 3×3×3 silently) ──
    await M.runSolidRecipe({ geometry: 'boxB', do: 'ratio', model: 'rot', column: 'P2', probes: 2 });
    const p2 = codesOf(M.paintColByName(B.L, 'P2')), p222 = codesOf(await M.ratioBySolid(SB, B.L, { name: 'P222', res: [2, 2, 2], mode: 'inside' }));
    const err = async (probes) => { try { await M.runSolidRecipe({ geometry: 'boxB', do: 'ratio', model: 'rot', column: 'PX', probes }); return 'ran'; } catch (e) { return e.message; } };
    out.probes = { n2: same(p2, p222) && !same(p2, fb), two: await err([2, 2]), word: await err('lots'), zero: await err(0) };
    return out;
  });
  chk(`rotated by-solid: the turned copy is a rotated lattice (${rg.rot}); fraction column made (was refused) — ${rg.ratio.diff} of ${rg.ratio.partial + rg.ratio.full}+ records differ from the axis-aligned pair, ${rg.ratio.partial} partial, ${rg.ratio.full} whole (“${rg.ratio.meta.slice(0, 70)}…”)`,
    rg.rot && rg.ratio.made && rg.ratio.same && rg.ratio.partial > 20 && rg.ratio.full > 0);
  chk(`rotated by-solid: flag (${rg.flag.n} IN) and select (${rg.flag.nSel}) match the axis-aligned pair record for record, on the dense lattice path (${rg.flag.dense})`,
    rg.flag.same && rg.flag.sel && rg.flag.n > 0 && rg.flag.nSel === rg.flag.n && rg.flag.dense);
  chk(`rotated by-surface: an open sheet, ABOVE, turned about the vertical — ${rg.surf.diff} of ${rg.surf.len} fractions differ, ${rg.surf.partial} partial`,
    rg.surf.same && rg.surf.partial > 10);
  chk(`rotated gridded surface: flag (${rg.grid.nFlag} below), select and the 3×3×3 fraction (${rg.grid.partial} partial) = a brute force from the declared basis; the old centroid rule would have called ${rg.grid.vsCentroid} of ${rg.grid.n} blocks differently`,
    rg.grid.flag && rg.grid.sel && rg.grid.ratio && rg.grid.partial > 10 && rg.grid.nFlag > 0 && rg.grid.vsCentroid > 0);
  chk(`solid recipe probes: 2 means 2×2×2 (${rg.probes.n2}); [2, 2], "lots" and 0 stop (“${rg.probes.two}” · “${rg.probes.word}” · “${rg.probes.zero}”)`,
    rg.probes.n2 && /not 2/.test(rg.probes.two) && /not a whole number/.test(rg.probes.word) && /not a whole number/.test(rg.probes.zero));
  await pr.close();
}

// ═══ a TEXT ƒ column colours by CLASS, live: offered in color-by, its classes are the
//     legend, a class colour edited in Properties → Style sticks through an edit of the
//     expression (by value, not code) and a project save/reload; past 255 values it says
//     so and goes back; a colour-by the layer can't honour says so instead of keeping
//     the old colour under a new name ═══
if (take()) {
  const pt = await mkPage('sm2tcalc');
  await pt.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2tcalc', { recursive: true }); } catch { } });
  await pt.evaluate(() => {
    let t = 'X,Y,Z,FE\n';
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) t += `${i * 10},${j * 10},5,${45 + (i % 10)}\n`;
    return window._micro.openBlob(new Blob([t]), 'm.csv', 'replace');
  });
  await pt.waitForFunction(() => window._micro.layers()[0] && window._micro.layers()[0].docs.blockDoc, null, { timeout: 20000 });
  const tc = await pt.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    L.storage = 'project';
    await M.applyCalcCols(L, [{ name: 'CLS', expr: 'if(FE > 50, "HIGH", "LOW")', ty: 'string' }]);
    const offered = [...document.querySelectorAll('#colorBy option')].some((o) => o.value === 'calc:CLS');
    const before = M.legendContentFor(L);                                    // elevation: a ramp
    M.setLayerColorSel(L, 'calc:CLS');
    for (let k = 0; k < 200 && !(L._calcDisplay && L._calcDisplay.col && L._calcDisplay.col.cat); k++) await new Promise((r) => setTimeout(r, 50));
    const col = L._calcDisplay && L._calcDisplay.col;
    const leg = M.legendContentFor(L);
    return { offered, beforeKind: before && before.kind, sel: L.colorSel, cat: !!(col && col.cat), dict: col ? col.dict.slice(1) : [],
      counts: col ? Array.from(col.counts).slice(1) : [], legKind: leg && leg.kind, legLabels: leg && leg.entries ? leg.entries.map((e) => e.label) : [] };
  });
  chk(`text ƒ offered in color-by (${tc.offered}); colouring by it classes the blocks: ${tc.dict.join('/')} = ${tc.counts.join('/')} (want HIGH/LOW = 160/240)`,
    tc.offered && tc.sel === 'calc:CLS' && tc.cat && tc.dict.join() === 'HIGH,LOW' && tc.counts.join() === '160,240');
  chk(`its legend is the classes (was a ${tc.beforeKind}, now ${tc.legKind || 'classes'}: ${tc.legLabels.join(', ')})`,
    tc.beforeKind === 'ramp' && tc.legKind !== 'ramp' && tc.legLabels.join() === 'HIGH,LOW');
  // edit HIGH's colour and hide LOW in Properties → Style (the categorized class list)
  const ed = await pt.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    M.setActiveLayer(L.id); M.openProps();
    const tab = [...document.querySelectorAll('#ppTabs .pp-tab')].find((b) => b.textContent === 'style'); if (tab) tab.click();
    const modeSel = [...document.querySelectorAll('#ppBody .pp-row')].find((r) => /mode/.test(r.textContent));
    const mode = modeSel && modeSel.querySelector('select') ? modeSel.querySelector('select').value : '';
    const rowOf = (lab) => [...document.querySelectorAll('#ppBody .pp-cat')].find((r) => r.querySelector('.nm') && r.querySelector('.nm').textContent === lab);
    const hi = rowOf('HIGH'), lo = rowOf('LOW');
    if (!hi || !lo) return { mode, rows: false };
    const sw = hi.querySelector('input[type=color]'); sw.value = '#ff0000'; sw.dispatchEvent(new Event('input'));
    const eye = lo.querySelector('input[type=checkbox]'); eye.checked = false; eye.dispatchEvent(new Event('change'));
    const leg = M.legendContentFor(L);
    const hiC = leg && leg.entries.find((e) => e.label === 'HIGH');
    return { mode, rows: true, hi: hiC && hiC.color, labels: leg ? leg.entries.map((e) => e.label) : [] };
  });
  chk(`Style shows it as categorized (${ed.mode}) with a row per class; HIGH recoloured → ${ed.hi}, LOW hidden → legend ${ed.labels.join(',')}`,
    ed.mode === 'categorized' && ed.rows && ed.hi === '#ff0000' && ed.labels.join() === 'HIGH');
  // edit the expression: still a ƒ (live), re-realized; HIGH keeps its colour by VALUE, LOW stays hidden, VLOW is new
  const re = await pt.evaluate(async () => {
    const M = window._micro, L = M.layers()[0], h0 = L._calcDisplay.hash;
    await M.applyCalcCols(L, [{ name: 'CLS', expr: 'if(FE > 52, "HIGH", if(FE < 47, "VLOW", "LOW"))', ty: 'string' }]);
    for (let k = 0; k < 200 && !(L._calcDisplay && L._calcDisplay.col && L._calcDisplay.hash !== h0); k++) await new Promise((r) => setTimeout(r, 50));
    const col = L._calcDisplay.col, leg = M.legendContentFor(L);
    const c = (lab) => { const e = leg && leg.entries.find((x) => x.label === lab); return e ? e.color : null; };
    return { live: (L.calcCols || []).some((x) => x.name === 'CLS'), dict: col.dict.slice(1), counts: Array.from(col.counts).slice(1), hi: c('HIGH'), lo: c('LOW'), vlow: c('VLOW') };
  });
  chk(`editing the expression recomputes live (${re.dict.join('/')} = ${re.counts.join('/')}); HIGH keeps ${re.hi}, LOW stays hidden (${re.lo}), VLOW joins (${re.vlow})`,
    re.live && re.dict.join() === 'HIGH,LOW,VLOW' && re.counts.join() === '80,240,80' && re.hi === '#ff0000' && re.lo === null && !!re.vlow);
  await saveProject(pt);
  await pt.close();
  const pr = await mkPage('sm2tcalc');
  await pr.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2tcalc'); await window._micro.openProjectDir(dir); });
  await pr.waitForFunction(() => { const L = window._micro.layers()[0]; return L && L._calcDisplay && L._calcDisplay.col && L._calcDisplay.col.cat; }, null, { timeout: 60000 });
  const rl = await pr.evaluate(() => {
    const M = window._micro, L = M.layers()[0], leg = M.legendContentFor(L);
    const c = (lab) => { const e = leg && leg.entries.find((x) => x.label === lab); return e ? e.color : null; };
    return { sel: L.colorSel, hi: c('HIGH'), lo: c('LOW'), vlow: c('VLOW') };
  });
  chk(`after a project save/reload it's still coloured by ƒ CLS (${rl.sel}): HIGH ${rl.hi}, LOW hidden (${rl.lo}), VLOW ${rl.vlow}`,
    rl.sel === 'calc:CLS' && rl.hi === '#ff0000' && rl.lo === null && rl.vlow === re.vlow);
  // the classes travel: copy style onto another model with a ƒ of the same name, and a view of the model
  const tr = await pr.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    let t = 'X,Y,Z,FE\n';
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) t += `${i * 10},${j * 10},5,${45 + (i % 10)}\n`;
    const id2 = await M.openBlob(new Blob([t]), 'm2.csv', 'add');
    const L2 = M.layers().find((x) => x.id === id2);
    await M.applyCalcCols(L2, [{ name: 'CLS', expr: 'if(FE > 52, "HIGH", if(FE < 47, "VLOW", "LOW"))', ty: 'string' }]);
    await M.applyStyle(L2, M.captureStyle(L));
    for (let k = 0; k < 200 && !(L2._calcDisplay && L2._calcDisplay.col && L2._calcDisplay.col.cat); k++) await new Promise((r) => setTimeout(r, 50));
    const V = await M.createView(L, { name: 'CLS view' }, { activate: false });
    for (let k = 0; k < 200 && !(M.legendContentFor(V) && M.legendContentFor(V).entries); k++) await new Promise((r) => setTimeout(r, 50));
    const c = (X, lab) => { const leg = M.legendContentFor(X), e = leg && leg.entries && leg.entries.find((x) => x.label === lab); return e ? e.color : null; };
    return { sel2: L2.colorSel, hi2: c(L2, 'HIGH'), lo2: c(L2, 'LOW'), selV: V.colorSel, hiV: c(V, 'HIGH'), loV: c(V, 'LOW') };
  });
  chk(`a text ƒ's classes travel: pasted style on another model (${tr.sel2}: HIGH ${tr.hi2}, LOW hidden ${tr.lo2}) and a view of the model (${tr.selV}: HIGH ${tr.hiV}, LOW hidden ${tr.loV})`,
    tr.sel2 === 'calc:CLS' && tr.hi2 === '#ff0000' && tr.lo2 === null && tr.selV === 'calc:CLS' && tr.hiV === '#ff0000' && tr.loV === null);
  const ov = await pr.evaluate(async () => {
    const M = window._micro, L = M.layers()[0];
    await M.applyCalcCols(L, [{ name: 'ID', expr: 'X * 1000 + Y', ty: 'string' }]);   // 400 different values
    M.setLayerColorSel(L, 'calc:ID');
    for (let k = 0; k < 200 && !/255/.test(document.querySelector('#meta').textContent); k++) await new Promise((r) => setTimeout(r, 50));
    const over = { meta: document.querySelector('#meta').textContent, sel: L.colorSel };
    // selections the layer can't honour: said on the status line, colour unchanged
    M.setLayerColorSel(L, 'calc:NOPE');
    const nope = { meta: document.querySelector('#meta').textContent, sel: L.colorSel };
    M.setLayerColorSel(L, 'chan:99');
    const chan = { meta: document.querySelector('#meta').textContent, sel: L.colorSel };
    return { over, nope, chan };
  });
  chk(`a text ƒ with more than 255 values says so (“${ov.over.meta.slice(0, 70)}…”) and the layer goes back to ${ov.over.sel}`,
    /more than 255/.test(ov.over.meta) && ov.over.sel === 'calc:CLS');
  chk(`a colour-by that can't be honoured is reported, colour kept (“${ov.nope.meta}” · “${ov.chan.meta}”)`,
    /no ƒ column “NOPE”/.test(ov.nope.meta) && ov.nope.sel === 'calc:CLS' && /no numeric column/.test(ov.chan.meta) && ov.chan.sel === 'calc:CLS');
  await pr.close();
}

// ── §127: the block-support contract, step 1 — a ROTATED, SUB-BLOCKED Datamine model
// (the Isatis.neo shape: ANGLE1 about Z, integer sub-blocks on a 1 m lattice, > 256
// shapes, odd sizes) opens as rotated BOXES, not points; every sampled block picks
// as ITSELF; its axis-aligned CSV twin picks the same records; a block past 255
// fine steps is refused, said, and shown as points.
if (take()) {
  const pg = await mkPage('sm2support');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer;
    const F = await import('/test/subblock-make.mjs');
    const { rows, shapes } = F.makeSubblockRows({ seed: 5, nx: 6, ny: 5, nz: 3 });
    const O = [432820, 8522360, 300];
    const settle = async () => {
      for (let k = 0; k < 400; k++) { M.requestRender(); await new Promise((z) => requestAnimationFrame(z)); if (R.elementCount && R.accumulated === R.elementCount) break; }
      await new Promise((z) => setTimeout(z, 300));
    };
    const topDown = async () => {
      const st = M.cam.state; M.cam.orbit(0, (Math.PI / 2 - 0.02) - st.phi);
      document.querySelector('#btnFit').click(); await settle();
    };
    // the top-level blocks wide enough to hit by their face centre, a sample of them
    const top = Math.max(...rows.map((x) => x.ZC + x.ZINC / 2));
    const cand = rows.map((x, rec) => ({ ...x, rec })).filter((x) => Math.abs(x.ZC + x.ZINC / 2 - top) < 1e-9 && x.XINC >= 4 && x.YINC >= 4);
    const sample = cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 30)) === 0).slice(0, 30);
    // a world point → CSS pixels on the canvas, through the camera
    const toScreen = (w) => {
      const o = M.frame.origin, p = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], m = M.cam.state.viewProj;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      const rc = document.querySelector('#cv').getBoundingClientRect();
      return [(cx / cw + 1) / 2 * rc.width, (1 - cy / cw) / 2 * rc.height];
    };
    const picks = async (L, toWorld) => {
      M.setActiveLayer(L.id); await topDown();
      const out = [];
      for (const b of sample) {
        const [x, y] = toScreen(toWorld(b.XC, b.YC, b.ZC + b.ZINC / 2));
        const h = R.pick(x, y, M.cam, { pointPx: 6, blocksAsPoints: false, section: null });
        out.push(h && h.layer === L.id ? h.rec : -1);
      }
      return out;
    };
    const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    // (1) the rotated .dm, its origin given (the file carries none, as the real one)
    const idR = await M.openBlob(new Blob([F.makeSubblockDm(rows, { angle1: -50 })]), 'look-alike.dm', 'replace', null, { throw: true, origin: O });
    const LR = M.layers().find((x) => x.id === idR), hR = LR.docs.blockDoc.header;
    await settle();
    const rot = { kind: LR.kind, sub: hR.subBlocked, rot: !!(hR.grid && hR.grid.rot), shapes: hR.sizeShapes, applied: hR.dmRotationApplied, origin: hR.dmOrigin, meta: document.querySelector('#meta').textContent, elements: R.layerElementCount(idR), bytes: R.layerVramBytes(idR) / R.layerElementCount(idR) };
    const pr = await picks(LR, (x, y, z) => [O[0] + c * x - s * y, O[1] + s * x + c * y, O[2] + z]);
    const row = await M.fetchLayerRow(LR, sample[0].rec);
    const pos = await M.pick({ layer: idR, rec: sample[0].rec });   // the pick's position is WORLD (the record holds local XC/YC/ZC)
    const posWant = [O[0] + c * sample[0].XC - s * sample[0].YC, O[1] + s * sample[0].XC + c * sample[0].YC, O[2] + sample[0].ZC];
    // the origin is settable after the open ("Datamine origin…"): the model moves, nothing else changes
    const b0 = LR.docs.blockDoc.header.bbox.min.slice();
    await M.setDmOrigin(LR, [O[0] + 1000, O[1] - 500, O[2]]);
    const LR2 = M.layers().find((x) => x.id === idR), b1 = LR2.docs.blockDoc.header.bbox.min.slice();
    const moved = { dx: b1[0] - b0[0], dy: b1[1] - b0[1], dz: b1[2] - b0[2], remembered: LR2.dmOrigin, n: R.layerElementCount(idR) };
    await M.setDmOrigin(LR2, O);
    // (2) the axis-aligned CSV twin (the same records in the model's own frame)
    // (replacing it: a fit over both would frame a 432 km gap, not the model)
    const idA = await M.openBlob(new Blob([F.makeSubblockCsv(rows)]), 'twin.csv', 'replace', null, { throw: true });
    const LA = M.layers().find((x) => x.id === idA);
    await settle();
    const pa = await picks(LA, (x, y, z) => [x, y, z]);
    // (3) a block 200 m long on a 1 m step: 400 fine steps → refused, said, points
    const big = F.makeSubblockRows({ seed: 3, nx: 2, ny: 2, nz: 1, maxOver: 200 });
    const idB = await M.openBlob(new Blob([F.makeSubblockDm(big.rows)]), 'too-long.dm', 'add', null, { throw: true });
    const LB = M.layers().find((x) => x.id === idB);
    // the parallel builder over a ROTATED grid, many batches: every chunk shares the
    // worker's grid (whose rot is a Float32Array) — transferring it detached it and the
    // SECOND batch threw (the real 18.7M-block file failed to open that way)
    let par = null;
    try {
      const g = LR2.docs.blockDoc.grid, n = 3000, recs = { count: n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), chan: new Float64Array(n), cat: null, recIdx: new Uint32Array(n) };
      for (let i = 0; i < n; i++) { const b = rows[i % rows.length]; recs.x[i] = O[0] + c * b.XC - s * b.YC; recs.y[i] = O[1] + s * b.XC + c * b.YC; recs.z[i] = O[2] + b.ZC; recs.recIdx[i] = i; }
      let got = 0;
      const cb = await M.startChunkBuilder({ frame: M.frame, grid: g, chunkSize: 64, batchSize: 256, seed: 1, seedPerBatch: true, workers: 2, onChunk: (ch) => { got += ch.count; } });
      await cb.push(recs); const doc = await cb.flush(); cb.close();
      par = { got, n: doc.count, offPage: cb.offPage };
    } catch (e) { par = { err: e.message }; }
    return { par, pos, posWant, moved, rot, shapes, want: sample.map((b) => b.rec), pr, pa, row: row && row.slice(0, 3), src: [sample[0].XC, sample[0].YC, sample[0].ZC], big: { kind: LB.kind, grid: LB.docs.blockDoc.header.grid, meta: LB.docs.blockDoc.metaLine } };
  });
  chk(`support: the rotated sub-blocked .dm (${r.shapes} shapes) opens as rotated BOXES — ${r.rot.kind}, sub-blocked ${r.rot.sub}, rotated ${r.rot.rot}, ${r.rot.elements} blocks, ${r.rot.bytes.toFixed(1)} B/block`,
    r.rot.kind === 'blocks' && r.rot.sub && r.rot.rot && r.rot.applied && r.shapes > 256 && r.rot.shapes === r.shapes && Math.abs(r.rot.bytes - 16) < 0.5);   // 13 B regular + 3 B dimQ (+ each chunk's 48 B bbox)
  chk(`support: the rotation and the origin are said (“${(r.rot.meta.match(/rotated[^·]*/) || [''])[0].trim()}”)`, /rotated -50° about Z/.test(r.rot.meta) && JSON.stringify(r.rot.origin) === '[432820,8522360,300]');
  const hitR = r.pr.filter((x, i) => x === r.want[i]).length, hitA = r.pa.filter((x, i) => x === r.want[i]).length;
  chk(`support: every sampled block picks as ITSELF on the rotated model (${hitR}/${r.want.length})`, hitR === r.want.length && r.want.length >= 10);
  // (step 2: a rotated model's rows read in WORLD — the record's own XC/YC/ZC, placed)
  chk(`support: …and its picked record is its own row, its XC/YC/ZC in WORLD (${JSON.stringify(r.row)} = ${JSON.stringify(r.src)} placed)`, r.row && r.row.map(Number).every((v, i) => Math.abs(v - r.posWant[i]) < 1e-6));
  chk(`support: the parallel chunk builder takes a rotated grid over many batches (${JSON.stringify(r.par)})`, r.par && !r.par.err && r.par.got === 3000 && r.par.n === 3000);
  chk(`support: a pick's position is the WORLD centroid (${(r.pos || []).map((v) => +v.toFixed(3)).join(', ')})`, r.pos && r.pos.every((v, a) => Math.abs(v - r.posWant[a]) < 1e-6));
  chk(`support: the axis-aligned twin picks the same records (${hitA}/${r.want.length}; identical: ${JSON.stringify(r.pa) === JSON.stringify(r.pr)})`, hitA === r.want.length && JSON.stringify(r.pa) === JSON.stringify(r.pr));
  chk(`support: “Datamine origin…” moves the model by exactly the change (${[r.moved.dx, r.moved.dy, r.moved.dz].map((v) => +v.toFixed(6)).join(', ')}), remembered on the layer, every block still drawn (${r.moved.n})`,
    Math.abs(r.moved.dx - 1000) < 1e-6 && Math.abs(r.moved.dy + 500) < 1e-6 && Math.abs(r.moved.dz) < 1e-9 && JSON.stringify(r.moved.remembered) === '[433820,8521860,300]' && r.moved.n === r.rot.elements);
  chk(`support: a block past 255 fine steps is refused and said — ${r.big.kind}, “${(r.big.meta.match(/\(sub-block[^)]*\)/) || [r.big.meta])[0].slice(0, 90)}…”`, r.big.kind === 'points' && !r.big.grid && /255/.test(r.big.meta));
  await pg.close();
  // the origin rides in the project: saved, reopened, the model where it was put
  const ps = await mkPage('sm2dmorigin');
  await ps.evaluate(async () => {
    const M = window._micro, F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 5, nx: 3, ny: 2, nz: 2 });
    const id = await M.openBlob(new File([F.makeSubblockDm(rows, { angle1: -50 })], 'kept.dm'), 'kept.dm', 'replace', null, { throw: true });
    await M.setDmOrigin(M.layers().find((x) => x.id === id), [500000, 7000000, 100]);
  });
  await saveProject(ps);
  await ps.close();
  const pr2 = await mkPage('sm2dmorigin');
  await pr2.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('sm2dmorigin'); await window._micro.openProjectDir(dir); });
  await pr2.waitForFunction(() => { const L = window._micro.layers()[0]; return L && L.docs && L.docs.blockDoc && L.docs.blockDoc.header; }, null, { timeout: 60000 });
  const re = await pr2.evaluate(() => { const L = window._micro.layers()[0], h = L.docs.blockDoc.header; return { origin: h.dmOrigin, kind: L.kind, rot: !!(h.grid && h.grid.rot) }; });
  chk(`support: the origin is saved with the project and reapplied on reopen (${JSON.stringify(re.origin)}, ${re.kind}, rotated ${re.rot})`,
    JSON.stringify(re.origin) === '[500000,7000000,100]' && re.kind === 'blocks' && re.rot);
  await pr2.close();
}

// ── §128: the block-support contract, step 2 — a rotated .dm's ROWS read in WORLD,
// volumes come from the contract, and its answers equal its axis-aligned twin's.
// A rotated, sub-blocked copy (ANGLE1 = −50 about Z, origin given) of an axis-
// aligned sub-blocked CSV: rows/filter/stats see world XC/YC/ZC (the old reads saw
// the file's local values — a filter on world XC matched nothing); GT, the
// resource table and stats on V equal the twin's; swath along the model's own axes
// and along world X equal the twin's along the matching directions; the volume is
// Σ XINC·YINC·ZINC; a Parquet export reopens as rotated sub-blocked boxes; the open
// dialog takes the origin; a recolour on the rotated layer re-shades (no re-raster).
if (take()) {
  const pg = await mkPage('sm2step2');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer;
    const F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 9, nx: 5, ny: 4, nz: 3 });
    const O = [432820, 8522360, 300];
    const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const W = (b) => [O[0] + c * b.XC - s * b.YC, O[1] + s * b.XC + c * b.YC, O[2] + b.ZC];
    const settle = async () => { for (let k = 0; k < 400; k++) { M.requestRender(); await new Promise((z) => requestAnimationFrame(z)); if (R.elementCount && R.accumulated === R.elementCount) break; } await new Promise((z) => setTimeout(z, 400)); };
    const idR = await M.openBlob(new File([F.makeSubblockDm(rows, { angle1: -50 })], 'rot.dm'), 'rot.dm', 'replace', null, { throw: true, origin: O });
    const idA = await M.openBlob(new File([F.makeSubblockCsv(rows)], 'twin.csv'), 'twin.csv', 'add', null, { throw: true });
    const LR = M.layers().find((x) => x.id === idR), LA = M.layers().find((x) => x.id === idA);
    await settle();
    const out = { n: rows.length };
    // (1) rows: every record's XC/YC/ZC in WORLD
    let worst = 0, cnt = 0;
    for await (const { f, rec } of M.layerRecords(LR)) { const w = W(rows[rec]); for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(+f[a] - w[a])); cnt++; }
    out.rows = { worst, cnt };
    // (2) a filter on WORLD XC (the median): the same records the hand computation keeps
    const xs = rows.map((b) => W(b)[0]).sort((a, b) => a - b), mid = (xs.length / 2) | 0, cut = +((xs[mid] + xs[mid + 1]) / 2).toFixed(3);
    await M.applyBlockFilter(`XC > ${cut}`, LR);
    out.filter = { got: LR._filterMask ? LR._filterMask.reduce((a, v) => a + (v ? 1 : 0), 0) : -1, want: rows.filter((b) => W(b)[0] > cut).length, cut };
    await M.applyBlockFilter('', LR);
    // (3) the analysis tools — the rotated copy against its twin
    const gtOf = async (L) => (await M.runTool('gt', { layer: L.name, series: [{ col: 'V' }], cutoffs: [-10, -0.5, 0, 0.5, 1, 1.5] })).table.rows.map((x) => x.slice(1));
    out.gt = { rot: await gtOf(LR), twin: await gtOf(LA), vol: rows.reduce((a, b) => a + b.XINC * b.YINC * b.ZINC, 0) };
    const resOf = async (L) => (await M.runTool('resource', { layer: L.name, grade: 'V', cutoffs: [0, 0.5, 1], density: { const: 2.7 } })).table.rows;
    out.res = { rot: await resOf(LR), twin: await resOf(LA) };
    const stOf = async (L, cols, filter = '') => (await M.runTool('stats', { layer: L.name, cols, filter })).table.rows.map((x) => x.slice(1));
    // (the stats tool scans columnar — page runs on the workers: its filter on XC must read world too)
    out.stats = { rot: await stOf(LR, ['V']), twin: await stOf(LA, ['V']), xc: (await stOf(LR, ['V'], `XC > ${cut}`))[0] };
    // swath, exact bands (the row path): along the model's own axes and along world X
    const sw = async (L, d, off) => (await M.computeSwath(L, ['V'], d, 7.31, off)).profile.map((p) => [p.count, p.tonnage, p.mean[0]]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const dX = M.dirTrendPlunge(40, 0), dY = M.dirTrendPlunge(310, 0), ex = [1, 0, 0], exL = [c, -s, 0];
    out.swath = {
      ownX: { rot: await sw(LR, dX, dot(O, dX)), twin: await sw(LA, ex, 0) },
      ownY: { rot: await sw(LR, dY, dot(O, dY)), twin: await sw(LA, [0, 1, 0], 0) },
      worldX: { rot: await sw(LR, ex, O[0]), twin: await sw(LA, exL, 0) },
    };
    // the swath TOOL (the columnar scan — page runs on the worker pool) along world X:
    // bands span the WORLD extent, every block counted once
    const st = await M.runTool('swath', { layer: 'rot.dm', series: [{ col: 'V' }], mode: 'trend', trend: 90, plunge: 0, bandW: [20], off: [0] });
    const cs = st.table.rows.map((x) => x[2]);
    out.tool = { n: st.table.rows.reduce((a, x) => a + x[3], 0), lo: Math.min(...cs), hi: Math.max(...cs), wlo: xs[0], whi: xs[xs.length - 1] };
    // (4) the pick panel: world coordinates, and the model's own beside them
    await M.showRecord({ layer: idR, rec: 7 });
    await new Promise((z) => setTimeout(z, 300));
    out.panel = /XC · model frame/.test(document.body.innerText);
    // (5) a Parquet export reopens as rotated, sub-blocked boxes, its rows in world
    const ex1 = await M.runExport(LR, { format: 'parquet', download: false, returnBlob: true });
    const idP = await M.openBlob(new File([ex1.blob], 'rot-export.parquet'), 'rot-export.parquet', 'add', null, { throw: true });
    const LP = M.layers().find((x) => x.id === idP), hP = LP.docs.blockDoc.header;
    const rowP = await M.fetchLayerRow(LP, 11);
    out.pq = { kind: LP.kind, rot: !!(hP.grid && hP.grid.rot), sub: !!hP.subBlocked, n: hP.count, rejected: hP.latticeRejected || null, row: [+rowP[0], +rowP[1], +rowP[2]], want: W(rows[11]), elements: R.layerElementCount(idP) };
    const ex2 = await M.runExport(LR, { format: 'csv', download: false, returnBlob: true });
    out.csvRow = (await ex2.blob.text()).split(/\r?\n/).filter((l) => l[0] !== '#')[1].split(',').slice(0, 3).map(Number);   // past the # micro:model line
    out.csvWant = W(rows[0]);
    // (6) the recolour on the rotated layer RE-SHADES (one resolve pass, not a re-raster)
    M.setActiveLayer(idR);
    await settle();
    const px = new Uint8Array(256 * 4); for (let q = 0; q < 256; q++) { px[q * 4] = 255; px[q * 4 + 1] = q; px[q * 4 + 3] = 255; }
    const rc0 = R.resolveCount;
    R.setLayerRamp(idR, px); M.requestRender();
    await new Promise((z) => setTimeout(z, 500));
    out.reshade = { rc0, rc1: R.resolveCount, gl: R.gl.getError() };
    return out;
  });
  const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
  const same = (A, B, eps) => A.length === B.length && A.every((row, i) => row.length === B[i].length && row.every((v, j) => (typeof v === 'number' ? close(v, B[i][j], eps) : v === B[i][j])));
  chk(`step 2: every record of the rotated .dm reads its XC/YC/ZC in WORLD (${r.rows.cnt}/${r.n}, worst ${r.rows.worst.toExponential(1)} m)`, r.rows.cnt === r.n && r.rows.worst < 1e-6);
  chk(`step 2: a filter on world XC keeps exactly the blocks the hand computation does (XC > ${r.filter.cut}: ${r.filter.got} = ${r.filter.want})`, r.filter.got === r.filter.want && r.filter.want > 0);
  chk(`step 2: the columnar stats scan reads world XC (XC > ${r.filter.cut}: n ${r.stats.xc && r.stats.xc[0]} = ${r.filter.want})`, r.stats.xc && +r.stats.xc[0] === r.filter.want);
  const vol = r.gt.rot[0] && r.gt.rot[0][1];
  chk(`step 2: volume from the contract = Σ XINC·YINC·ZINC (${vol} = ${r.gt.vol}), the twin the same (${r.gt.twin[0] && r.gt.twin[0][1]})`, close(vol, r.gt.vol) && close(r.gt.twin[0][1], r.gt.vol));
  chk(`step 2: grade-tonnage — the rotated copy = its axis-aligned twin (${r.gt.rot.length} cutoffs)`, same(r.gt.rot, r.gt.twin));
  chk(`step 2: resource table — the rotated copy = its twin (${r.res.rot.length} rows)`, same(r.res.rot, r.res.twin));
  chk(`step 2: stats on V — the rotated copy = its twin (${JSON.stringify(r.stats.rot[0] && r.stats.rot[0].slice(0, 3))})`, same(r.stats.rot, r.stats.twin));
  for (const k of ['ownX', 'ownY', 'worldX']) chk(`step 2: swath along ${k === 'worldX' ? 'world X' : `the model's own ${k.slice(3)} axis`} — the rotated copy = its twin (${r.swath[k].rot.length} bands)`, r.swath[k].rot.length > 3 && same(r.swath[k].rot, r.swath[k].twin));
  chk(`step 2: the swath tool (columnar, workers) bands the WORLD extent (${r.tool.lo}…${r.tool.hi} ⊇ ${r.tool.wlo.toFixed(1)}…${r.tool.whi.toFixed(1)}), every block once (${r.tool.n})`,
    r.tool.n === r.n && r.tool.lo <= r.tool.wlo + 20 && r.tool.hi >= r.tool.whi - 20 && r.tool.lo > 432000);
  chk('step 2: the pick panel shows the model frame beside the world coordinates', r.panel);
  chk(`step 2: a Parquet export reopens as rotated sub-blocked boxes (${r.pq.kind}, rotated ${r.pq.rot}, sub ${r.pq.sub}, ${r.pq.elements} drawn${r.pq.rejected ? `, REJECTED ${r.pq.rejected}` : ''}), its rows in world`,
    r.pq.kind === 'blocks' && r.pq.rot && r.pq.sub && r.pq.elements === r.n && r.pq.row.every((v, a) => Math.abs(v - r.pq.want[a]) < 1e-6));
  chk(`step 2: a CSV export writes world XC/YC/ZC (${r.csvRow.join(', ')})`, r.csvRow.every((v, a) => Math.abs(v - r.csvWant[a]) < 1e-4));
  chk(`step 2: a recolour on the rotated sub-blocked layer re-shades — no re-raster (${r.reshade.rc0}→${r.reshade.rc1}, GL ${r.reshade.gl})`, r.reshade.rc1 > r.reshade.rc0 && r.reshade.gl === 0);
  await pg.close();
  // the open dialog takes a rotated model's origin (prefilled from the file's X0/Y0/Z0)
  const pd = await mkPage('sm2step2dlg');
  const dl = await pd.evaluate(async () => {
    const M = window._micro, F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 9, nx: 2, ny: 2, nz: 1 });
    await M.openFilesDialog([new File([F.makeSubblockDm(rows, { angle1: -50, origin: [10, 20, 30] })], 'dlg.dm')]);
    const xi = document.querySelector('.of-origin-x'), yi = document.querySelector('.of-origin-y'), zi = document.querySelector('.of-origin-z');
    const pre = xi && [xi.value, yi.value, zi.value];
    if (xi) { xi.value = '432820'; xi.onchange(); yi.value = '8522360'; yi.onchange(); zi.value = '300'; zi.onchange(); }
    document.querySelector('#ofOpen').click();
    for (let k = 0; k < 100 && !(M.layers()[0] && M.layers()[0].docs.blockDoc); k++) await new Promise((z) => setTimeout(z, 100));
    const L = M.layers()[0];
    return { pre, origin: L && L.docs.blockDoc.header.dmOrigin, kept: L && L.dmOrigin };
  });
  chk(`step 2: the open dialog offers a rotated .dm's origin, prefilled from X0/Y0/Z0 (${JSON.stringify(dl.pre)}), and opens with the one typed (${JSON.stringify(dl.origin)})`,
    JSON.stringify(dl.pre) === '["10","20","30"]' && JSON.stringify(dl.origin) === '[432820,8522360,300]' && JSON.stringify(dl.kept) === '[432820,8522360,300]');
  await pd.close();
}

// ── §129: PROJECTIONS — maximum / minimum / mean intensity along the line of sight
// (View → Projection; condenser gl-mip.js). A small regular model seen ORTHOGRAPHIC
// in plan: the projected value at each block column's centre pixel equals the
// brute-force max / min / mean of that column's normalized grades (within the
// target's quantization); a slab counts only its level; a filter excludes the rest;
// a click names the record that IS the max (the min). Non-vacuous: the model's top
// level is LOW, so the front surface and the projection disagree on most columns.
// Then a ROTATED, SUB-BLOCKED .dm gives the same projected image as its axis-aligned
// twin, the camera turned with it.
if (take()) {
  const pg = await mkPage('sm2mip');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro;
    const NX = 12, NY = 8, NZ = 6, DX = 10, DY = 10, DZ = 5;
    let s = 1234567;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const val = [];                                          // record → FE (rows k, j, i: record = k·NY·NX + j·NX + i)
    let csv = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v = k === NZ - 1 ? +(1 + rnd() * 9).toFixed(3) : +(10 + rnd() * 90).toFixed(3);   // the top level is LOW
      val.push(v); csv += `${1000 + i * DX + DX / 2},${2000 + j * DY + DY / 2},${300 + k * DZ + DZ / 2},${v}\n`;
    }
    const rec = (i, j, k) => k * NY * NX + j * NX + i;
    const id = await M.openBlob(new Blob([csv]), 'mip.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    M.setLayerColorSel(L, M.colorSelFor(L, 'FE'));
    const settle = async () => {
      for (let k = 0; k < 400; k++) {
        M.requestRender(); await new Promise((z) => requestAnimationFrame(z));
        const p = R.projection;
        if (R.elementCount && R.accumulated === R.elementCount && (!M.projectionSupport || !p || p.exact)) break;
      }
      for (let k = 0; k < 3; k++) { M.requestRender(); await new Promise((z) => requestAnimationFrame(z)); }
    };
    await W.setView({ look: 0, elevation: 90, ortho: true, projection: null });
    document.querySelector('#btnFit').click();
    await settle();
    const cv = document.querySelector('#cv'), rc = cv.getBoundingClientRect(), dpr = cv.width / rc.width;
    // a world point → [css x, css y] and the device pixel pick() reads (GL rows, bottom-up)
    const toCss = (w) => {
      const o = M.frame.origin, p = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], m = M.cam.state.viewProj;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [(cx / cw + 1) / 2 * rc.width, (1 - cy / cw) / 2 * rc.height];
    };
    const devOf = ([x, y]) => [Math.round(x * dpr), Math.round(cv.height - y * dpr - 1)];
    const cols = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) cols.push({ i, j, css: toCss([1000 + i * DX + DX / 2, 2000 + j * DY + DY / 2, 300 + NZ * DZ]) });
    const [lo, hi] = R.layerChanRange(id), tOf = (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const screen = () => { const c = new OffscreenCanvas(cv.width, cv.height), g = c.getContext('2d'); g.drawImage(cv, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const rgbAt = (d, [x, y]) => { const k = ((cv.height - 1 - y) * cv.width + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    const front = screen();
    const out = { support: R.projectionSupport, modes: {} };
    for (const mode of ['max', 'min', 'mean']) {
      if (!R.projectionSupport[mode]) { out.modes[mode] = { skipped: true }; continue; }
      M.setProjection(mode); await settle();
      const img = R.projectionValues(id), proj = R.projection;
      let worst = 0, n = 0, picks = 0, pickN = 0, differ = 0;
      const shot = screen();
      for (const c of cols) {
        const ts = []; for (let k = 0; k < NZ; k++) ts.push(tOf(val[rec(c.i, c.j, k)]));
        const want = mode === 'max' ? Math.max(...ts) : mode === 'min' ? Math.min(...ts) : ts.reduce((a, b) => a + b, 0) / NZ;
        const [x, y] = devOf(c.css), got = img.data[y * img.w + x];
        worst = Math.max(worst, Math.abs(got - want)); n++;
        const a = rgbAt(front, [x, y]), b = rgbAt(shot, [x, y]);
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30) differ++;
        if (mode !== 'mean') {
          const kk = ts.indexOf(want), h = R.pick(c.css[0], c.css[1], M.cam, { pointPx: +document.querySelector('#ptPx').value, blocksAsPoints: false, section: null });
          pickN++; if (h && h.layer === id && h.rec === rec(c.i, c.j, kk)) picks++;
        }
      }
      out.modes[mode] = { worst, n, picks, pickN, differ, format: img.format, exact: proj && proj.exact, status: document.querySelector('#stats').textContent.slice(0, 40) };
    }
    // the slab: a horizontal section around level 2 alone → that level's value, exactly
    M.setProjection('max');
    W.setSection({ axis: 'z', at: [1000, 2000, 300 + 2 * DZ + DZ / 2], thickness: DZ * 0.9 });
    await settle();
    { const img = R.projectionValues(id); let worst = 0; for (const c of cols) { const [x, y] = devOf(c.css); worst = Math.max(worst, Math.abs(img.data[y * img.w + x] - tOf(val[rec(c.i, c.j, 2)]))); } out.slab = { worst }; }
    W.setSection(null);
    // the filter: only 10 < FE < 50 counts — a column with none of them projects nothing
    await M.applyBlockFilter('FE > 10 and FE < 50', L);
    await settle();
    { const img = R.projectionValues(id); let worst = 0, empty = 0, emptyOk = 0;
      for (const c of cols) {
        const ts = []; for (let k = 0; k < NZ; k++) { const v = val[rec(c.i, c.j, k)]; if (v > 10 && v < 50) ts.push(tOf(v)); }
        const [x, y] = devOf(c.css), got = img.data[y * img.w + x];
        if (!ts.length) { empty++; if (!(got === got)) emptyOk++; continue; }
        worst = Math.max(worst, Math.abs(got - Math.max(...ts)));
      }
      out.filter = { worst, empty, emptyOk };
    }
    await M.applyBlockFilter('', L);
    // the status line words, partial and exact
    out.words = [M.projectionStatus({ projection: { mode: 'max', drawn: 5, total: 9, exact: false } }), M.projectionStatus({ projection: { mode: 'max', drawn: 9, total: 9, exact: true } })];
    // it rides with the camera (bookmarks, scenes, the project)
    out.view = W.view().projection;
    M.setProjection(null); await settle();
    out.off = { projection: R.projection, view: W.view().projection };
    return out;
  });
  const fmt = (m) => (m.skipped ? 'not on this GPU' : `worst |Δt| ${m.worst.toExponential(2)} over ${m.n} columns (${m.format})${m.pickN ? `, picks ${m.picks}/${m.pickN}` : ''}, ${m.differ} columns differ from the front surface`);
  const tolOf = (m) => (m.format === 'rgba8' ? 3e-3 : 1.5e-3);
  for (const mode of ['max', 'min', 'mean']) {
    const m = r.modes[mode];
    if (mode === 'mean' && m.skipped) { console.log('note: the mean projection is not offered by this GPU (no float render targets)'); continue; }
    chk(`projection ${mode}: per column = the brute-force ${mode} of its normalized grades — ${fmt(m)}; ${m.exact ? 'exact' : 'NOT exact'}`,
      !m.skipped && m.n === 96 && m.worst < tolOf(m) && m.exact && (m.pickN === 0 || m.picks === m.pickN) && (mode !== 'max' || m.differ > 48));
  }
  chk(`projection: the status line names it (“${r.modes.max.status}…”), and says partial — N of M (“${r.words[0]}”) vs exact (“${r.words[1]}”)`,
    /^MIP \(exact\)/.test(r.modes.max.status) && /partial — 5 of 9 drawn/.test(r.words[0]) && /exact/.test(r.words[1]));
  chk(`projection: a slab counts only its own level (worst |Δt| ${r.slab.worst.toExponential(2)})`, r.slab.worst < 1.5e-3 * (r.modes.max.format === 'rgba8' ? 2 : 1));
  chk(`projection: a filter excludes the rest (worst |Δt| ${r.filter.worst.toExponential(2)}; ${r.filter.emptyOk}/${r.filter.empty} columns with no match project nothing)`,
    r.filter.worst < 3e-3 && r.filter.empty > 0 && r.filter.emptyOk === r.filter.empty);
  chk(`projection: rides with the view (${r.view}) and goes off cleanly (${JSON.stringify(r.off)})`, r.view === 'max' && r.off.projection === null && r.off.view === null);
  // the rotated, sub-blocked model and its axis-aligned twin: the same image, the camera turned with it
  const tw = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro, F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 5, nx: 4, ny: 3, nz: 3 });
    const O = [432820, 8522360, 300];
    const settle = async () => {
      for (let k = 0; k < 400; k++) { M.requestRender(); await new Promise((z) => requestAnimationFrame(z)); const p = R.projection; if (R.elementCount && R.accumulated === R.elementCount && p && p.exact) break; }
      for (let k = 0; k < 3; k++) { M.requestRender(); await new Promise((z) => requestAnimationFrame(z)); }
    };
    const shoot = async (blob, name, look) => {
      const id = await M.openBlob(blob, name, 'replace', null, name.endsWith('.dm') ? { throw: true, origin: O } : { throw: true });
      const L = M.layers().find((x) => x.id === id);
      M.setLayerColorSel(L, M.colorSelFor(L, 'V'));
      const b = R.contentBbox(), o = M.frame.origin;
      await W.setView({ target: [(b[0] + b[3]) / 2 + o[0], (b[1] + b[4]) / 2 + o[1], (b[2] + b[5]) / 2 + o[2]], look, elevation: 90, distance: 120, ortho: true, projection: 'max' });
      await settle();
      return { img: R.projectionValues(id), sub: L.docs.blockDoc.header.subBlocked, rot: !!(L.docs.blockDoc.header.grid && L.docs.blockDoc.header.grid.rot) };
    };
    const A = await shoot(new Blob([F.makeSubblockCsv(rows)]), 'twin.csv', 0);
    const B = await shoot(new Blob([F.makeSubblockDm(rows, { angle1: -50 })]), 'rot.dm', 310);   // ANGLE1 −50 turns the model 50° counter-clockwise: so does the view
    let both = 0, either = 0, agree = 0;
    const seen = new Set();
    for (let i = 0; i < A.img.data.length; i++) {
      const a = A.img.data[i], b = B.img.data[i], ha = a === a, hb = b === b;
      if (ha || hb) either++;
      if (ha && hb) { both++; if (Math.abs(a - b) < 2e-3) agree++; seen.add(Math.round(a * 1000)); }
    }
    M.setProjection(null);
    return { both, either, agree, distinct: seen.size, sub: [A.sub, B.sub], rot: [A.rot, B.rot], w: A.img.w, h: A.img.h };
  });
  chk(`projection: a rotated, sub-blocked model projects as its axis-aligned twin, the camera turned with it — ${tw.agree}/${tw.both} pixels agree (${tw.distinct} distinct values), ${tw.both}/${tw.either} hit by both, ${(100 * tw.either / (tw.w * tw.h)).toFixed(0)}% of the view (sub-blocked ${tw.sub}, rotated ${tw.rot})`,
    tw.sub[0] && tw.sub[1] && !tw.rot[0] && tw.rot[1] && tw.both > 0.2 * tw.w * tw.h && tw.distinct > 50 && tw.both / tw.either > 0.98 && tw.agree / tw.both > 0.98);
  await pg.close();
}

// ── §130: the block-support contract, step 3 — BY GEOMETRY on sub-blocked models. A
// sub-blocked model has no lattice of whole blocks, so each block is probed in ITS OWN
// box (dimQ × pitch) — @gcu/winding's box list, in the lattice frame for a rotated
// model. Before: a rotated sub-blocked model was refused (evalSolidOnGrid → null: no
// fraction column, select fell back to centroids) and an axis-aligned one answered the
// fraction of the FINE cell at the centroid, not of the block. A rotated .dm copy
// (ANGLE1 −50 about Z, origin given) and its axis-aligned CSV twin, a solid carried with
// it: fraction / flag / select / assign-domains / an open surface below / factors
// volumes equal record for record; the twin's fraction = an analytic count (the solid
// is an octahedron); a gridded surface's fraction / flag = a hand count over each
// block's own box (rotated probes on the rotated copy, the column integral on the twin). ──
if (take()) {
  const pg = await mkPage('sm2step3');
  const r = await pg.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 13, nx: 5, ny: 4, nz: 3 });
    const O = [432820, 8522360, 300];
    const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const Wp = (p) => [O[0] + c * p[0] - s * p[1], O[1] + s * p[0] + c * p[1], O[2] + p[2]];
    const idR = await M.openBlob(new File([F.makeSubblockDm(rows, { angle1: -50 })], 'rot3.dm'), 'rot3.dm', 'replace', null, { throw: true, origin: O });
    const idA = await M.openBlob(new File([F.makeSubblockCsv(rows)], 'twin3.csv'), 'twin3.csv', 'add', null, { throw: true });
    const LR = M.layers().find((x) => x.id === idR), LA = M.layers().find((x) => x.id === idA);
    const hR = LR.docs.blockDoc.header, hA = LA.docs.blockDoc.header;
    const out = { n: rows.length, kinds: [LR.kind, LA.kind], sub: [!!hR.subBlocked, !!hA.subBlocked], rot: [!!(hR.grid && hR.grid.rot), !!(hA.grid && hA.grid.rot)] };
    const mesh = async (name, V, T, world) => { const id = await W.addLayer({ kind: 'mesh', name, vertices: Float64Array.from((world ? V.map(Wp) : V).flat()), triangles: Uint32Array.from(T) }); return M.layers().find((l) => l.id === id); };
    const codesOf = (col) => Array.from(col ? col.codes : []);
    const same = (a, b) => a.length === b.length && a.length > 0 && a.every((v, i) => v === b[i]);
    // an octahedron (local frame) with generic faces: |x−cx|/a + |y−cy|/b + |z−cz|/d ≤ 1
    const oct = (cx, cy, cz, a, b, d) => ({
      V: [[cx + a, cy, cz], [cx - a, cy, cz], [cx, cy + b, cz], [cx, cy - b, cz], [cx, cy, cz + d], [cx, cy, cz - d]],
      T: [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5],
      ins: (x, y, z) => Math.abs(x - cx) / a + Math.abs(y - cy) / b + Math.abs(z - cz) / d <= 1,
    });
    const o1 = oct(47.31, 38.17, 14.23, 37.71, 29.93, 12.87), o2 = oct(71.13, 52.07, 9.71, 21.37, 17.83, 9.13);
    const SA = await mesh('octA', o1.V, o1.T, false), SR = await mesh('octR', o1.V, o1.T, true);
    // (1) the fraction column — made on the rotated copy (was refused), = the twin's
    const colR = await M.ratioBySolid(SR, LR, { name: 'FR', res: 3, mode: 'inside' });
    const metaR = document.querySelector('#meta').textContent;
    const fa = codesOf(await M.ratioBySolid(SA, LA, { name: 'FR', res: 3, mode: 'inside' })), fr = codesOf(colR);
    // the definition, analytic: 3×3×3 cell-centred probes in each block's own box
    const probe = (b, n, ins, half) => { let k = 0; const hx = half ? half[0] : b.XINC / 2, hy = half ? half[1] : b.YINC / 2, hz = half ? half[2] : b.ZINC / 2;
      for (let w = 0; w < n; w++) for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) if (ins(b.XC + hx * ((2 * u + 1) / n - 1), b.YC + hy * ((2 * v + 1) / n - 1), b.ZC + hz * ((2 * w + 1) / n - 1))) k++;
      return Math.round(255 * k / (n * n * n)); };
    const want = rows.map((b) => probe(b, 3, o1.ins));
    const fine = rows.map((b) => probe(b, 3, o1.ins, [0.25, 0.25, 0.25]));   // the old answer: the 0.5 m fine cell at the centroid
    const dev = fa.map((v, i) => Math.abs(v - want[i]));
    out.ratio = { made: !!colR, same: same(fa, fr), exact: dev.filter((d) => d === 0).length, maxDev: Math.max(...dev), partial: fr.filter((v) => v > 0 && v < 255).length, whole: fr.filter((v) => v === 255).length,
      vsFine: want.filter((v, i) => v !== fine[i]).length, meta: metaR };
    // the same model as Parquet: its positions + sizes come from the columnar scan (row groups on workers)
    const ex = await M.runExport(LA, { format: 'parquet', download: false, returnBlob: true });
    const idP = await M.openBlob(new File([ex.blob], 'twin3.parquet'), 'twin3.parquet', 'add', null, { throw: true });
    const LP = M.layers().find((x) => x.id === idP);
    out.pq = { sub: !!LP.docs.blockDoc.header.subBlocked, columnar: M.canScanColumnar(LP), same: same(codesOf(await M.ratioBySolid(SA, LP, { name: 'FQ', res: 3, mode: 'inside' })), fa) };
    // peel on a sub-blocked model answers by winding, per block (no whole-block columns to cast)
    out.peel = same(codesOf(await M.ratioBySolid(SA, LA, { name: 'FP', res: 3, mode: 'inside', method: 'peel' })), fa);
    // (2) flag + select: the centroid, record for record
    await M.flagBySolid(SR, [LR], { name: 'FL', label: 'IN', mode: 'inside' });
    await M.flagBySolid(SA, [LA], { name: 'FL', label: 'IN', mode: 'inside' });
    const fl = (L) => { const cc = M.paintColByName(L, 'FL'), k = cc ? cc.dict.indexOf('IN') : -1; return cc ? Array.from(cc.codes, (v) => (v === k ? 1 : 0)) : []; };
    await M.selectBySolid(SR, { targets: [LR], mode: 'inside' }); const sr = Array.from(LR._selMask || []);
    await M.selectBySolid(SA, { targets: [LA], mode: 'inside' }); const sa = Array.from(LA._selMask || []);
    await M.selectBySolid(SR, { targets: [LR], mode: 'outside' }); const so = Array.from(LR._selMask || []);
    const cen = rows.map((b) => (o1.ins(b.XC, b.YC, b.ZC) ? 1 : 0));
    out.flag = { same: same(fl(LR), fl(LA)), cen: same(fl(LA), cen), sel: same(sr, sa) && same(sa, cen), out: same(so, cen.map((v) => 1 - v)), n: cen.reduce((a, v) => a + v, 0) };
    // (3) assign domains, two solids
    const SA2 = await mesh('octA2', o2.V, o2.T, false), SR2 = await mesh('octR2', o2.V, o2.T, true);
    const dR = await M.assignDomains([SR, SR2], LR, { name: 'DOM', res: [2, 2, 2] }), dA = await M.assignDomains([SA, SA2], LA, { name: 'DOM', res: [2, 2, 2] });
    const lab = (col) => (col ? Array.from(col.codes, (v) => col.dict[v] || '') : []);
    const dl = lab(dA);
    const K = { octR: 1, octA: 1, octR2: 2, octA2: 2 }, key = (x) => K[x] || 0;
    out.dom = { same: same(lab(dR).map(key), dl.map(key)), a: dl.filter((x) => x === 'octA').length, b: dl.filter((x) => x === 'octA2').length };
    // (4) an open sheet, BELOW (skirt closure built in world, carried into the lattice frame)
    const SV = [], ST = [], G = 9;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const x = -30 + i * 20, y = -30 + j * 17.5; SV.push([x, y, 13.7 + 0.071 * x - 0.043 * y + 2.3 * Math.sin(i * 1.3 + j * 0.7)]); }
    for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) { const a = j * G + i; ST.push(a, a + 1, a + G, a + 1, a + G + 1, a + G); }
    const UA = await mesh('sheetA', SV, ST, false), UR = await mesh('sheetR', SV, ST, true);
    const ua = codesOf(await M.ratioBySolid(UA, LA, { name: 'BL', res: 3, mode: 'below' })), ur = codesOf(await M.ratioBySolid(UR, LR, { name: 'BL', res: 3, mode: 'below' }));
    out.sheet = { same: same(ua, ur), partial: ur.filter((v) => v > 0 && v < 255).length, diff: ua.reduce((nn, v, i) => nn + (v !== ur[i]), 0) };
    // (5) reconciliation factors by volume: the rotated copy's tonnages = the twin's
    const fac = async (L, Sx) => (await M.runTool('factors', { model: L.name, grade: 'V', density: { const: 2.7 }, cutoff: 'none', gradeUnit: 'pct', modelUnit: 'pct', periods: 'volumes', volumes: [{ name: 'P', mesh: Sx.name, side: 'inside' }], probes: [3, 3, 3] }, { routine: true })).table.rows;
    out.factors = { rot: await fac(LR, SR), twin: await fac(LA, SA) };
    // (6) a GRIDDED surface: a tilted plane, one grid in world (the rotated copy), one in the
    //     model frame (the twin) — each checked against a hand count over every block's own box
    const asc = (xll, yll, nc, nr, z) => { let tt = `ncols ${nc}\nnrows ${nr}\nxllcorner ${xll}\nyllcorner ${yll}\ncellsize 5\nNODATA_value -9999\n`; for (let rr = 0; rr < nr; rr++) { const row = []; for (let cc = 0; cc < nc; cc++) row.push(z(xll + cc * 5, yll + (nr - 1 - rr) * 5).toFixed(5)); tt += row.join(' ') + '\n'; } return tt; };
    const zl = (x, y) => 14.3 + 0.091 * x - 0.062 * y;
    const zw = (X, Y) => { const u = c * (X - O[0]) + s * (Y - O[1]), v = -s * (X - O[0]) + c * (Y - O[1]); return O[2] + zl(u, v); };
    await M.openBlob(new Blob([asc(O[0] - 110, O[1] - 40, 60, 50, zw)]), 'gw.asc', 'add');
    await M.openBlob(new Blob([asc(-40, -40, 40, 36, zl)]), 'gl.asc', 'add');
    const GW = M.layers().find((l) => l.name === 'gw.asc'), GL = M.layers().find((l) => l.name === 'gl.asc');
    const sw = M.surfaceFromGrid(GW.docs.gridDoc.grid), sl = M.surfaceFromGrid(GL.docs.gridDoc.grid);
    // rotated: n³ probes in the block's lattice box, carried to world, below the surface at their own x,y
    const rotHand = (b, n, half) => { let k = 0, ins = 0; const hx = half ? half : b.XINC / 2, hy = half ? half : b.YINC / 2, hz = half ? half : b.ZINC / 2; const wc = Wp([b.XC, b.YC, b.ZC]);
      for (let w = 0; w < n; w++) for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) { const a = hx * ((2 * u + 1) / n - 1), bb = hy * ((2 * v + 1) / n - 1), d = hz * ((2 * w + 1) / n - 1);
        const px = wc[0] + c * a - s * bb, py = wc[1] + s * a + c * bb, pz = wc[2] + d; const zs = sw.sampleZ(px, py); if (Number.isNaN(zs)) continue; k++; if (pz < zs) ins++; }
      return k ? ins / k : NaN; };
    // twin: the column integral — n×n plan probes, z analytic over the block's height
    const colHand = (b, n, half) => { let sum = 0, k = 0; const hx = half ? half : b.XINC / 2, hy = half ? half : b.YINC / 2, hz = half ? half : b.ZINC / 2;
      for (let a = 0; a < n; a++) for (let bb = 0; bb < n; bb++) { const zs = sl.sampleZ(b.XC - hx + 2 * hx * (a + 0.5) / n, b.YC - hy + 2 * hy * (bb + 0.5) / n); if (Number.isNaN(zs)) continue; sum += Math.max(0, Math.min(1, (zs - (b.ZC - hz)) / (2 * hz))); k++; }
      return k ? sum / k : NaN; };
    const code = (f) => (Number.isNaN(f) || !f ? 0 : Math.round(255 * f));
    const grR = codesOf(await M.ratioByGridSurface(GW, LR, { name: 'GR', res: [3, 3, 3], mode: 'below' }));
    const grA = codesOf(await M.ratioByGridSurface(GL, LA, { name: 'GR', res: [3, 3, 3], mode: 'below' }));
    await M.flagByGridSurface(GW, [LR], { name: 'GF', label: 'B', mode: 'below' });
    await M.flagByGridSurface(GL, [LA], { name: 'GF', label: 'B', mode: 'below' });
    const gf = (L) => { const cc = M.paintColByName(L, 'GF'), k = cc ? cc.dict.indexOf('B') : -1; return cc ? Array.from(cc.codes, (v) => (v === k ? 1 : 0)) : []; };
    const wR = rows.map((b) => code(rotHand(b, 3))), wA = rows.map((b) => code(colHand(b, 3)));
    const wfR = rows.map((b) => (rotHand(b, 2) >= 0.5 ? 1 : 0)), wfA = rows.map((b) => (colHand(b, 2) >= 0.5 ? 1 : 0));
    const oldR = rows.map((b) => code(rotHand(b, 3, 0.25))), oldA = rows.map((b) => code(colHand(b, 3, 0.25)));
    out.grid = { ratioR: same(grR, wR), ratioA: same(grA, wA), flagR: same(gf(LR), wfR), flagA: same(gf(LA), wfA),
      dR: grR.reduce((nn, v, i) => nn + (v !== wR[i]), 0), dA: grA.reduce((nn, v, i) => nn + (v !== wA[i]), 0),
      partial: [grR.filter((v) => v > 0 && v < 255).length, grA.filter((v) => v > 0 && v < 255).length],
      oldDiff: [wR.filter((v, i) => v !== oldR[i]).length, wA.filter((v, i) => v !== oldA[i]).length], nf: wfR.reduce((a, v) => a + v, 0) };
    return out;
  });
  chk(`step 3: the rotated .dm copy and its twin are sub-blocked models (${r.kinds.join('/')}, sub ${r.sub.join('/')}, rotated ${r.rot.join('/')})`,
    r.kinds[0] === 'blocks' && r.kinds[1] === 'blocks' && r.sub[0] && r.sub[1] && r.rot[0] && !r.rot[1]);
  chk(`step 3: by-solid FRACTION on the rotated sub-blocked copy is made (it was refused) and equals the axis-aligned twin's record for record (${r.ratio.partial} partial, ${r.ratio.whole} whole of ${r.n}; “${r.ratio.meta.slice(0, 60)}…”)`,
    r.ratio.made && r.ratio.same && r.ratio.partial > 20 && r.ratio.whole > 5);
  chk(`step 3: the twin's fraction is each BLOCK's — an analytic 3×3×3 count over its own box: ${r.ratio.exact}/${r.n} exact, worst ${r.ratio.maxDev}/255; the old fine-cell-at-the-centroid answer differs on ${r.ratio.vsFine} blocks`,
    r.ratio.exact >= r.n - 2 && r.ratio.maxDev <= 10 && r.ratio.vsFine > 20);
  chk(`step 3: …and the twin stored as Parquet (sub-blocked ${r.pq.sub}, columnar ${r.pq.columnar}) gives the same fractions — positions and sizes through the columnar scan (${r.pq.same})`, r.pq.sub && r.pq.columnar && r.pq.same);
  chk(`step 3: peel on a sub-blocked model answers per block (by winding) — the same fractions (${r.peel})`, r.peel);
  chk(`step 3: flag (${r.flag.n} IN) and select (inside + outside) on the rotated copy = the twin = the centroid rule, record for record`, r.flag.same && r.flag.cen && r.flag.sel && r.flag.out && r.flag.n > 10);
  chk(`step 3: assign domains — two solids, the rotated copy = the twin (${r.dom.a} + ${r.dom.b} blocks claimed)`, r.dom.same && r.dom.a > 0 && r.dom.b > 0);
  chk(`step 3: an open sheet, BELOW — ${r.sheet.diff} fractions differ between the rotated copy and the twin, ${r.sheet.partial} partial`, r.sheet.same && r.sheet.partial > 10);
  const fx = (rows) => JSON.stringify(rows.map((x) => x.map((v) => (typeof v === 'number' ? +v.toPrecision(10) : v))));
  chk(`step 3: reconciliation factors by volume — the rotated copy's rows = the twin's (${r.factors.rot.length} rows)`, r.factors.rot.length > 0 && fx(r.factors.rot) === fx(r.factors.twin));
  chk(`step 3: a gridded surface — the 3×3×3 fraction (rotated probes on the rotated copy, ${r.grid.dR} off; the column integral on the twin, ${r.grid.dA} off; ${r.grid.partial.join(' / ')} partial) and the flag (${r.grid.nf} below) are each block's own box; the fine-cell box would differ on ${r.grid.oldDiff.join(' / ')}`,
    r.grid.ratioR && r.grid.ratioA && r.grid.flagR && r.grid.flagA && r.grid.partial[0] > 10 && r.grid.partial[1] > 10 && r.grid.oldDiff[0] > 10 && r.grid.oldDiff[1] > 10 && r.grid.nf > 0);
  await pg.close();
}

// ── §131: the block-support contract, step 4 — JOINS and RECONCILE in the shared lattice
// frame. A sub-blocked model's boxes scatter onto a regular target that shares its
// orientation — now a ROTATED one too (it was refused: "scattering sub-blocks onto a
// ROTATED lattice isn't supported yet"). A rotated pair (a sub-blocked .dm and a regular
// .dm, ANGLE1 −50, one origin) against its axis-aligned twin pair (the same blocks as
// CSV, in the model's own frame): the join's cells (mean / sum / count, a categorical
// majority), the join → columns on the regular model, and reconcile's Δ equal the
// twins'. A different orientation is refused in ONE place (grid-join latticeMismatch),
// with the reason, by the join, the box aggregator and reconcile alike. ──
if (take()) {
  const pg = await mkPage('sm2step4');
  const r = await pg.evaluate(async () => {
    const M = window._micro;
    const F = await import('/test/subblock-make.mjs');
    const sub = F.makeSubblockRows({ seed: 21, nx: 4, ny: 3, nz: 2 }).rows;
    const par = F.makeSubblockRows({ seed: 22, nx: 4, ny: 3, nz: 2, pWhole: 1 }).rows.map((b) => ({ ...b, V: +(b.V * 1.07 - 0.031).toFixed(4) }));
    const O = [432820, 8522360, 300];
    const open = async (bytes, name, mode, opts) => { const id = await M.openBlob(new File([bytes], name), name, mode, null, { throw: true, ...(opts || {}) }); return M.layers().find((x) => x.id === id); };
    const SR = await open(F.makeSubblockDm(sub, { angle1: -50 }), 'subR.dm', 'replace', { origin: O });
    const PR = await open(F.makeRegularDm(par, { angle1: -50, nx: 4, ny: 3, nz: 2 }), 'parR.dm', 'add', { origin: O });
    const SA = await open(F.makeSubblockCsv(sub), 'subA.csv', 'add');
    const PA = await open(['XC,YC,ZC,V', ...par.map((b) => `${b.XC},${b.YC},${b.ZC},${b.V}`), ''].join('\n'), 'parA.csv', 'add');
    const hd = (L) => { const h = L.docs.blockDoc.header; return { sub: !!h.subBlocked, rot: !!(h.grid && h.grid.rot) }; };
    const out = { kinds: [SR, PR, SA, PA].map(hd) };
    // (1) the join's cells on each regular model: mean / sum / count of V, and a categorical majority
    const cols = [{ src: 'right', name: 'V', out: 'Vm', num: true, op: 'mean' }, { src: 'right', name: 'V', out: 'Vs', num: true, op: 'sum' }, { src: 'right', name: 'V', out: 'Vv', num: true, op: 'volume' }, { src: 'right', name: 'XINC', out: 'XI', num: false }];
    const cells = async (P, S2) => {
      const res = await M.runSpatialJoin({ leftL: null, rightL: S2, target: M.gridAxesOf(P), columns: cols.map((c) => ({ ...c })), coverage: false, asCells: true });
      return res.columns.map((c) => (c.num ? Array.from(c._out) : Array.from(c._codes, (k) => (k >= 0 ? c._dict[k] : null))));
    };
    let errR = null; let cR = null;
    try { cR = await cells(PR, SR); } catch (e) { errR = e.message; }
    const cA = await cells(PA, SA);
    let worst = 0;
    const close = (a, b, eps = 1e-9) => { if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true; if (!(Number.isFinite(a) && Number.isFinite(b))) return false; const d = Math.abs(a - b) / Math.max(1, Math.abs(a)); if (d > worst) worst = d; return d <= eps; };
    out.cells = { errR, n: cA[0].length, present: cA[0].filter(Number.isFinite).length,
      same: !!cR && cR.every((col, k) => col.length === cA[k].length && col.every((v, i) => close(v, cA[k][i]))),
      vol: cA[2].reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0), subVol: sub.reduce((a, b) => a + b.XINC * b.YINC * b.ZINC, 0), worst };
    // (2) join → columns on the regular model's own records
    const jf = { target: 'left', cols: ['right:V'], ops: {}, weights: {}, useSel: false };
    const oR = await M.spatialJoinToCols(PR, SR, jf), oA = await M.spatialJoinToCols(PA, SA, jf);
    const vals = (L, nm) => { const c = M.matColGet(L, nm); return c ? Array.from(c.fvalues || c.values || []) : []; };
    const vR = vals(PR, oR[0]), vA = vals(PA, oA[0]);
    out.toCols = { names: [oR[0], oA[0]], n: vA.length, same: vR.length === vA.length && vR.length > 0 && vR.every((v, i) => close(v, vA[i])), finite: vA.filter(Number.isFinite).length };
    // (3) reconcile: the sub-blocked side aggregated to the regular side's (parent) lattice
    const rec = async (P, S2) => { const x = await M.runReconcile(P, S2, { weights: {}, useSel: false }, 'V'); const J = M.layers().find((l) => l.id === x.layer); const rows = []; for await (const { f } of M.layerRecords(J)) rows.push(f.slice(3, 6).map((v) => (v === '' || v == null ? null : +v))); return { x, rows }; };
    const rR = await rec(PR, SR), rA = await rec(PA, SA);
    out.rec = { matched: [rR.x.matched, rA.x.matched], mean: [rR.x.meanDelta, rA.x.meanDelta], n: [rR.rows.length, rA.rows.length],
      same: rR.rows.length === rA.rows.length && rR.rows.every((row, i) => row.every((v, k) => (v == null ? rA.rows[i][k] == null : Math.abs(v - rA.rows[i][k]) <= 1.5e-6))) };   // the layer's CSV writes 6 decimals
    // (4) a different orientation is refused, with the reason, in one place: the axis-aligned
    //     sub-blocked twin onto the rotated regular model (join and reconcile), and the reverse
    const why = async (f) => { try { await f(); return 'ran'; } catch (e) { return e.message; } };
    out.refuse = {
      join: await why(() => M.runSpatialJoin({ leftL: null, rightL: SA, target: M.gridAxesOf(PR), columns: [{ src: 'right', name: 'V', out: 'V', num: true, op: 'mean' }], asCells: true })),
      back: await why(() => M.runSpatialJoin({ leftL: null, rightL: SR, target: M.gridAxesOf(PA), columns: [{ src: 'right', name: 'V', out: 'V', num: true, op: 'mean' }], asCells: true })),
      rec: await (async () => { const before = M.layers().length; await M.runReconcile(PR, SA, { weights: {}, useSel: false }, 'V'); return { meta: document.querySelector('#meta').textContent, added: M.layers().length - before }; })(),
      compat: M.gridsCompatible(M.gridAxesOf(PR), M.gridAxesOf(SA)).reason || 'compatible',
    };
    return out;
  });
  chk(`step 4: the rotated pair is rotated (sub-blocked + regular), the twins axis-aligned — ${JSON.stringify(r.kinds)}`,
    r.kinds[0].sub && r.kinds[0].rot && !r.kinds[1].sub && r.kinds[1].rot && r.kinds[2].sub && !r.kinds[2].rot && !r.kinds[3].sub && !r.kinds[3].rot);
  chk(`step 4: a rotated sub-blocked model joins onto a rotated regular one${r.cells.errR ? ` — REFUSED “${r.cells.errR}”` : ''}; every cell (mean / sum / volume / majority) = the twins' (${r.cells.present}/${r.cells.n} cells, worst ${r.cells.worst.toExponential(1)})`,
    !r.cells.errR && r.cells.same && r.cells.present === r.cells.n && r.cells.n > 0);
  chk(`step 4: the join's volume is the sub-blocks' volume, parent by parent (${r.cells.vol} = ${r.cells.subVol})`, Math.abs(r.cells.vol - r.cells.subVol) < 1e-6);
  chk(`step 4: join → columns on the rotated regular model (${r.toCols.names[0]}) = the twin's (${r.toCols.finite}/${r.toCols.n} records)`, r.toCols.same && r.toCols.finite === r.toCols.n);
  chk(`step 4: reconcile, sub-blocked vs regular at the parent lattice — the rotated pair = the twins (matched ${r.rec.matched.join(' = ')}, mean Δ ${r.rec.mean.map((v) => v.toPrecision(6)).join(' = ')}, ${r.rec.n[0]} cells)`,
    r.rec.same && r.rec.matched[0] === r.rec.matched[1] && r.rec.matched[0] > 0 && Math.abs(r.rec.mean[0] - r.rec.mean[1]) < 1.5e-6);
  chk(`step 4: a different orientation is refused with the reason, the same words everywhere — join “${r.refuse.join.slice(0, 70)}…”`,
    /different lattice orientations/.test(r.refuse.join) && /different lattice orientations/.test(r.refuse.back)
    && /different lattice orientations/.test(r.refuse.rec.meta) && r.refuse.rec.added === 0 && /different lattice orientations/.test(r.refuse.compat));
  await pg.close();
}

// ── §132: the block-support contract, step 5 — the consumers that had their own rotated /
// sub-blocked branches read the contract. A rotated REGULAR .dm (ANGLE1 −50, the lattice as
// DD constants, one block left out) and its axis-aligned CSV twin: model QA checks the
// lattice in the model's own frame (it said "not checked — a rotated lattice") and finds
// the same gap; block vs sample pairs the same samples to the same blocks (it refused a
// rotated model); a grade shell is the twin's turned into world (it refused). A sub-
// blocked model's picked half-extents are its own size from Parquet too (they were the
// fine pitch); the properties name its fine step and largest sub-block (they said "block"). ──
if (take()) {
  const pg = await mkPage('sm2step5');
  const r = await pg.evaluate(async () => {
    const M = window._micro;
    const F = await import('/test/subblock-make.mjs');
    const NX = 6, NY = 5, NZ = 4, O = [432820, 8522360, 300];
    const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const Wp = (p) => [O[0] + c * p[0] - s * p[1], O[1] + s * p[0] + c * p[1], O[2] + p[2]];
    // parents with a smooth V (a shell to contour), one block missing (a gap in its column)
    const par = F.makeSubblockRows({ seed: 31, nx: NX, ny: NY, nz: NZ, pWhole: 1 }).rows
      .map((b) => ({ ...b, V: +(10 - Math.hypot(b.XC - 60, b.YC - 50, (b.ZC - 20) * 2) / 6).toFixed(4) }))
      .filter((b) => !(b.XC === 50 && b.YC === 50 && b.ZC === 15));
    const open = async (bytes, name, mode, opts) => { const id = await M.openBlob(new File([bytes], name), name, mode, null, { throw: true, ...(opts || {}) }); return M.layers().find((x) => x.id === id); };
    const R = await open(F.makeRegularDm(par, { angle1: -50, nx: NX, ny: NY, nz: NZ }), 'reg5.dm', 'replace', { origin: O });
    const A = await open(['XC,YC,ZC,V', ...par.map((b) => `${b.XC},${b.YC},${b.ZC},${b.V}`), ''].join('\n'), 'reg5.csv', 'add');
    const out = { rot: !!(R.docs.blockDoc.header.grid && R.docs.blockDoc.header.grid.rot), sub: [!!R.docs.blockDoc.header.subBlocked, !!A.docs.blockDoc.header.subBlocked] };
    // (1) model QA
    const qa = async (L) => { const q = await M.modelQa(L); return { lattice: q.lattice ? [q.lattice.nx, q.lattice.ny, q.lattice.nz, q.lattice.dups, q.lattice.off, q.lattice.gapCells, q.lattice.gapCols] : null, why: q.why, gapAt: q.lattice && q.lattice.gapAt[0] }; };
    out.qa = { R: await qa(R), A: await qa(A) };
    // (2) block vs sample: samples in the model frame (the twin) and the same ones in world
    const smp = [];
    for (let i = 0; i < 40; i++) smp.push([3 + (i * 7.3) % 114, 2 + (i * 5.1) % 96, 1 + (i * 3.7) % 38, +(i * 0.37 % 9).toFixed(3)]);
    smp.push([500, 500, 500, 1]);                          // outside
    const sCsv = (pts) => ['X,Y,Z,S', ...pts.map((p) => p.join(',')), ''].join('\n');
    const SA = await open(sCsv(smp), 'sA.csv', 'add', { mapping: { x: 0, y: 1, z: 2, chan: 3, cat: null }, asKind: 'points' });
    const SR = await open(sCsv(smp.map((p) => [...Wp(p), p[3]])), 'sR.csv', 'add', { mapping: { x: 0, y: 1, z: 2, chan: 3, cat: null }, asKind: 'points' });
    const pair = async (L, Sx) => { try { const res = await M.pairBlocksSamples(L, Sx, { blockCol: 'V', sampleCol: 'S' }); return { n: res.n, outside: res.outside, noBlock: res.noBlock, st: res.stats.map((x) => [x.n, +x.bias.toFixed(9), +(x.slope || 0).toFixed(9), +(x.r || 0).toFixed(9)]) }; } catch (e) { return { err: e.message }; } };
    out.pair = { R: await pair(R, SR), A: await pair(A, SA) };
    // (3) a grade shell: the twin's vertices, turned into world, are the rotated model's
    const sh = async (L) => { try { const fd = await M.readField(L, 'V'); const m = M.contourField(fd, 6.5); return { v: Array.from(m.vertices), t: m.triangles.length / 3, inside: m.blocksInside }; } catch (e) { return { err: e.message }; } };
    const sR = await sh(R), sA = await sh(A);
    let worst = sR.err || sA.err ? Infinity : 0;
    if (!sR.err && !sA.err && sR.v.length === sA.v.length) for (let v = 0; v < sA.v.length; v += 3) { const w = Wp([sA.v[v], sA.v[v + 1], sA.v[v + 2]]); for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(w[a] - sR.v[v + a])); }
    else if (!sR.err) worst = Infinity;
    out.shell = { errR: sR.err || null, tris: [sR.t, sA.t], inside: [sR.inside, sA.inside], worst };
    const made = await M.gradeShell(R, { col: 'V', cutoff: 6.5 }).then((x) => x.triangles, (e) => e.message);
    out.shell.layer = made;
    // (4) a sub-blocked model from Parquet: a picked block's half-extents are its own size
    const sub = F.makeSubblockRows({ seed: 33, nx: 2, ny: 2, nz: 1 }).rows;
    const SBc = await open(F.makeSubblockCsv(sub), 'sb5.csv', 'add');
    const ex = await M.runExport(SBc, { format: 'parquet', download: false, returnBlob: true });
    const SBp = await open(ex.blob, 'sb5.parquet', 'add');
    const ks = [0, 7, 19, sub.length - 1];
    out.halves = { pq: [], csv: [], want: ks.map((k) => [sub[k].XINC / 2, sub[k].YINC / 2, sub[k].ZINC / 2]), sub: !!SBp.docs.blockDoc.header.subBlocked, parquet: !!SBp.docs.blockDoc.parquet };
    for (const k of ks) { out.halves.pq.push(await M.blockHalfDims(SBp, k)); out.halves.csv.push(await M.blockHalfDims(SBc, k)); }
    // (5) the properties of a sub-blocked model: its fine step and largest sub-block, not a "block" size
    M.setActiveLayer(SBc.id); M.openProps(SBc); await new Promise((z) => setTimeout(z, 200));
    const tab = [...document.querySelectorAll('#propPanel .pp-tab')].find((b) => /source/i.test(b.textContent));
    if (tab) tab.click();
    await new Promise((z) => setTimeout(z, 300));
    const txt = document.querySelector('#propPanel').innerText;
    out.props = { tab: !!tab, fine: /fine step/.test(txt), largest: /largest sub-block/.test(txt), block: /^block \d/m.test(txt) };
    return out;
  });
  chk(`step 5: the rotated regular .dm is rotated and regular, the twin axis-aligned (rotated ${r.rot}, sub ${r.sub.join('/')})`, r.rot && !r.sub[0] && !r.sub[1]);
  chk(`step 5: model QA checks the rotated lattice in its own frame (${JSON.stringify(r.qa.R.lattice)}${r.qa.R.why ? `, “${r.qa.R.why}”` : ''}) — the twin's findings (${JSON.stringify(r.qa.A.lattice)}): one gap`,
    r.qa.R.lattice && JSON.stringify(r.qa.R.lattice) === JSON.stringify(r.qa.A.lattice) && r.qa.A.lattice[5] === 1);
  chk('step 5: …and the gap is shown where it is, in world', r.qa.R.gapAt && r.qa.A.gapAt && (() => { const t = (50 * Math.PI) / 180, w = [432820 + Math.cos(t) * r.qa.A.gapAt[0] - Math.sin(t) * r.qa.A.gapAt[1], 8522360 + Math.sin(t) * r.qa.A.gapAt[0] + Math.cos(t) * r.qa.A.gapAt[1], 300 + r.qa.A.gapAt[2]]; return w.every((v, a) => Math.abs(v - r.qa.R.gapAt[a]) < 1e-6); })());
  chk(`step 5: block vs sample on the rotated model${r.pair.R.err ? ` — REFUSED “${r.pair.R.err}”` : ''} = the twin's (${r.pair.A.n} pairs, ${r.pair.A.outside} outside, ${r.pair.A.noBlock} in the missing block)`,
    !r.pair.R.err && JSON.stringify(r.pair.R) === JSON.stringify(r.pair.A) && r.pair.A.n > 30 && r.pair.A.outside === 1);
  chk(`step 5: a grade shell of the rotated model${r.shell.errR ? ` — REFUSED “${r.shell.errR}”` : ''} is the twin's turned into world (${r.shell.tris.join(' = ')} triangles, ${r.shell.inside.join(' = ')} blocks inside, worst ${r.shell.worst.toExponential(1)} m); the command makes the layer (${r.shell.layer} triangles)`,
    !r.shell.errR && r.shell.tris[0] === r.shell.tris[1] && r.shell.tris[0] > 20 && r.shell.worst < 1e-6 && r.shell.layer === r.shell.tris[0]);
  const hv = (a, b) => a.length === b.length && a.every((h, i) => h && h.every((v, k) => Math.abs(v - b[i][k]) < 1e-9));
  chk(`step 5: a sub-blocked model's picked half-extents are each block's own size — from Parquet (${JSON.stringify(r.halves.pq)}) as from CSV`, r.halves.sub && r.halves.parquet && hv(r.halves.pq, r.halves.want) && hv(r.halves.csv, r.halves.want));
  chk(`step 5: a sub-blocked model's properties give its fine step and largest sub-block (${JSON.stringify(r.props)})`, r.props.tab && r.props.fine && r.props.largest && !r.props.block);
  await pg.close();
}

// ── §133: the lattice travels with every EXPORT (micro-block-support worklist). A rotated,
// sub-blocked .dm (ANGLE1 −50, placed in world) exported to CSV reopens as the SAME rotated
// boxes — the `# micro:model` line declares the lattice, checked on every row (a rotated
// sub-blocked model can't be inferred); same via Parquet. A FILTERED subset keeps the lattice
// (no longer dropped: its bbox/categories are left for the reader to find) and reopens as the
// same placement holding only the subset. A tampered pitch is REFUSED with the reason
// (points; non-vacuous — the untampered file is boxes). The placed .dm's ANGLE1/ROTAXIS1/X0…
// don't ride next to world coordinates; "lattice as columns" writes a self-consistent set.
// And a .dm with constant per-record sizes but no DD lattice opens as boxes, not points. ──
if (take()) {
  const pg = await mkPage('sm2latexp');
  const r = await pg.evaluate(async () => {
    const M = window._micro, Rn = M.renderer;
    const F = await import('/test/subblock-make.mjs');
    const { makeDM } = await import('/test/dm-make.mjs');
    const O = [432820, 8522360, 300];
    const rows = F.makeSubblockRows({ seed: 41, nx: 3, ny: 3, nz: 2 }).rows;
    const rejected = []; addEventListener('micro:lattice-rejected', (e) => rejected.push(e.detail.reason));
    const open = async (bytes, name, mode, opts) => { const id = await M.openBlob(new File([bytes], name), name, mode, null, { throw: true, ...(opts || {}) }); return M.layers().find((x) => x.id === id); };
    const LR = await open(F.makeSubblockDm(rows, { angle1: -50 }), 'rotx.dm', 'replace', { origin: O });
    const hR = LR.docs.blockDoc.header;
    const recs = async (L) => { const out = []; for await (const { f } of M.layerRecords(L)) out.push(f); return out; };
    const h0 = LR.docs.blockDoc.header, iV = h0.columns.indexOf('V'), iX = h0.mapping.x, iY = h0.mapping.y, iZ = h0.mapping.z;
    const src = (await recs(LR)).map((f) => [+f[iX], +f[iY], +f[iZ], +f[iV]]);
    const desc = (L) => { const h = L.docs.blockDoc.header; return { kind: L.kind, rot: !!(h.grid && h.grid.rot), sub: !!h.subBlocked, n: h.count, drawn: Rn.layerElementCount(L.id), by: h.lattice && h.lattice.by, rejected: h.latticeRejected || null, bbox: h.bbox, anchor: h.grid && h.grid.anchor, R: h.grid && h.grid.rot, pitch: h.grid && [h.grid.x.pitch, h.grid.y.pitch, h.grid.z.pitch] }; };
    // the rows of a reopened file, matched to the source's by position (export order = record order)
    const rowsOf = async (L, want) => {
      const h = L.docs.blockDoc.header, jV = h.columns.indexOf('V');
      const got = (await recs(L)).map((f) => [+f[h.mapping.x], +f[h.mapping.y], +f[h.mapping.z], +f[jV]]);
      let worst = 0, valuesSame = got.length === want.length;
      for (let i = 0; i < Math.min(got.length, want.length); i++) { for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(got[i][a] - want[i][a])); if (got[i][3] !== want[i][3]) valuesSame = false; }
      return { n: got.length, worst, valuesSame };
    };
    const bboxOf = (P) => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of P) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } return { min: mn, max: mx }; };
    const out = { src: desc(LR) };
    // (1) full model → CSV → reopen
    const exC = await M.runExport(LR, { format: 'csv', download: false, returnBlob: true });
    const csvText = await exC.blob.text();
    const lines = csvText.split(/\r?\n/);
    out.csv = { first: lines[0].slice(0, 40), header: lines[1].split(','), stale: ['ANGLE1', 'ROTAXIS1', 'X0', 'Y0', 'Z0'].filter((n) => lines[1].split(',').includes(n)) };
    const LC = await open(csvText, 'rotx-all.csv', 'add');
    out.csv.re = desc(LC); out.csv.rows = await rowsOf(LC, src);
    // (2) full model → Parquet → reopen
    const exP = await M.runExport(LR, { format: 'parquet', download: false, returnBlob: true });
    const LP = await open(exP.blob, 'rotx-all.parquet', 'add');
    out.pq = { re: desc(LP), rows: await rowsOf(LP, src) };
    // (3) a FILTERED subset → Parquet and CSV → reopen: the same lattice, only the subset
    await M.applyBlockFilter('V > 1', LR);
    const mask = LR._filterMask, subWant = src.filter((_, i) => mask[i]);
    out.subN = subWant.length; out.subBbox = bboxOf(subWant);
    const sp = await M.runExport(LR, { scope: 'matches', format: 'parquet', download: false, returnBlob: true });
    const SP = await open(sp.blob, 'rotx-sub.parquet', 'add');
    out.subPq = { re: desc(SP), rows: await rowsOf(SP, subWant) };
    const sc = await M.runExport(LR, { scope: 'matches', format: 'csv', download: false, returnBlob: true });
    const scText = await sc.blob.text();
    const scModel = JSON.parse(scText.split(/\r?\n/)[0].replace(/^# micro:model /, ''));
    const SC = await open(scText, 'rotx-sub.csv', 'add');
    out.subCsv = { re: desc(SC), rows: await rowsOf(SC, subWant), model: { bbox: 'bbox' in scModel, categories: 'categories' in scModel, subset: scModel.subset, dims: scModel.dims } };
    await M.applyBlockFilter('', LR);
    // (4) a tampered pitch is refused, with the reason, as points
    const tampered = csvText.replace(/^# micro:model (.*)$/m, (_, j) => { const m = JSON.parse(j); m.grid.x.pitch *= 1.5; delete m.grid.basis; return '# micro:model ' + JSON.stringify(m); });
    const nRej = rejected.length;
    const LT = await open(tampered, 'rotx-bad.csv', 'add');
    out.bad = { re: desc(LT), event: rejected.slice(nRej), meta: LT.docs.blockDoc.metaLine };
    // (5) the lattice as columns: a regular rotated .dm, Datamine-style constants + the local centroid
    const par = F.makeSubblockRows({ seed: 42, nx: 3, ny: 2, nz: 2, pWhole: 1 }).rows;
    const PR = await open(F.makeRegularDm(par, { angle1: -50, nx: 3, ny: 2, nz: 2 }), 'regx.dm', 'add', { origin: O });
    const lc = await M.runExport(PR, { format: 'csv', download: false, returnBlob: true, latticeColumns: true });
    const lcLines = (await lc.blob.text()).split(/\r?\n/).filter((l) => l && l[0] !== '#');
    const head = lcLines[0].split(','), row0 = lcLines[1].split(',');
    const val = (n) => +row0[head.indexOf(n)];
    out.lc = { head, X0: [val('X0'), val('Y0'), val('Z0')], angle: val('ANGLE1'), axis: val('ROTAXIS1'), local: [val('XL'), val('YL'), val('ZL')], want: [par[0].XC, par[0].YC, par[0].ZC],
      morig: [val('XMORIG'), val('YMORIG'), val('ZMORIG')], inc: [val('XINC'), val('YINC'), val('ZINC')], nn: [val('NX'), val('NY'), val('NZ')], dup: head.length - new Set(head).size };
    const LL = await open(await lc.blob.text(), 'regx-cols.csv', 'add');
    out.lc.re = desc(LL);
    // (6) a .dm with constant per-record sizes and no DD lattice: boxes from the centroids
    const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' }, { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' }, { name: 'V', type: 'N' }];
    const reg = par.filter((_, i) => i % 3).map((b) => ({ XC: b.XC, YC: b.YC, ZC: b.ZC, XINC: 20, YINC: 20, ZINC: 10, V: b.V }));
    const LD = await open(new Uint8Array(makeDM(fields, reg, { precision: 'ep' })), 'nodd.dm', 'add');
    out.dm = { re: desc(LD), want: reg.length, grid: LD.docs.blockDoc.header.grid && [LD.docs.blockDoc.header.grid.x.pitch, LD.docs.blockDoc.header.grid.y.pitch, LD.docs.blockDoc.header.grid.z.pitch] };
    return out;
  });
  const near = (a, b, eps = 1e-6) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= eps);
  const sameBox = (a, b, eps = 1e-6) => near(a.min, b.min, eps) && near(a.max, b.max, eps);
  const samePlace = (x) => near(x.anchor, r.src.anchor, 1e-9) && near(x.R, r.src.R, 1e-12) && near(x.pitch, r.src.pitch, 1e-12);
  const boxes = (x) => x.kind === 'blocks' && x.rot && x.sub && !x.rejected;
  chk(`export: the source is a rotated sub-blocked .dm (${r.src.n} blocks, drawn ${r.src.drawn})`, boxes({ ...r.src, rejected: null }) && r.src.drawn === r.src.n);
  chk(`export → CSV: the first line states the lattice (“${r.csv.first}…”); no ANGLE1/ROTAXIS1/X0 next to world coordinates (${r.csv.stale.join(',') || 'none'})`, /^# micro:model \{/.test(r.csv.first) && !r.csv.stale.length);
  chk(`export → CSV → reopen: rotated sub-blocked boxes, declared by the file (${r.csv.re.by}), ${r.csv.re.drawn}/${r.src.n} drawn, same bounds + placement`, boxes(r.csv.re) && r.csv.re.by === 'file' && r.csv.re.drawn === r.src.n && sameBox(r.csv.re.bbox, r.src.bbox) && samePlace(r.csv.re));
  chk(`export → CSV → reopen: every record's position and value (${r.csv.rows.n} rows, worst ${r.csv.rows.worst.toExponential(1)} m)`, r.csv.rows.n === r.src.n && r.csv.rows.valuesSame && r.csv.rows.worst < 1e-6);
  chk(`export → Parquet → reopen: rotated sub-blocked boxes, same bounds + placement, every record (${r.pq.rows.n}, worst ${r.pq.rows.worst.toExponential(1)})`, boxes(r.pq.re) && r.pq.re.drawn === r.src.n && sameBox(r.pq.re.bbox, r.src.bbox) && samePlace(r.pq.re) && r.pq.rows.valuesSame && r.pq.rows.worst < 1e-6);
  chk(`a FILTERED subset → Parquet keeps the lattice: rotated boxes, the same placement, only the subset (${r.subPq.re.drawn}/${r.subN} of ${r.src.n}; by ${r.subPq.re.by})`, boxes(r.subPq.re) && r.subPq.re.drawn === r.subN && r.subN > 0 && r.subN < r.src.n && samePlace(r.subPq.re) && sameBox(r.subPq.re.bbox, r.subBbox) && r.subPq.rows.valuesSame && r.subPq.rows.worst < 1e-6);
  chk(`a FILTERED subset → CSV keeps the lattice (${JSON.stringify(r.subCsv.model)}): the same placement, only the subset (${r.subCsv.re.drawn}/${r.subN}), its own bounds`, boxes(r.subCsv.re) && r.subCsv.re.drawn === r.subN && samePlace(r.subCsv.re) && sameBox(r.subCsv.re.bbox, r.subBbox) && r.subCsv.rows.valuesSame
    && !r.subCsv.model.bbox && !r.subCsv.model.categories && r.subCsv.model.subset === 'matches' && r.subCsv.model.dims);
  chk(`a tampered pitch in the header is REFUSED with the reason — points (${r.bad.re.kind}), “${(r.bad.re.rejected || '').slice(0, 80)}…”, event ${r.bad.event.length}`, r.bad.re.kind === 'points' && /doesn't fit/.test(r.bad.re.rejected || '') && r.bad.event.length === 1 && /REFUSED/.test(r.bad.meta));
  chk(`lattice as columns: X0/Y0/Z0 = the origin (${r.lc.X0.join(', ')}), ANGLE1 ${r.lc.angle} about ROTAXIS1 ${r.lc.axis}, XL/YL/ZL = the local centroid (${r.lc.local.join(', ')}), XMORIG… ${r.lc.morig.join('/')}, XINC… ${r.lc.inc.join('/')}, NX… ${r.lc.nn.join('/')}, no duplicate names`,
    near(r.lc.X0, [432820, 8522360, 300], 1e-6) && Math.abs(r.lc.angle + 50) < 1e-9 && r.lc.axis === 3 && near(r.lc.local, r.lc.want, 1e-6) && near(r.lc.morig, [0, 0, 0], 1e-6) && near(r.lc.inc, [20, 20, 10]) && near(r.lc.nn, [3, 2, 2]) && r.lc.dup === 0);
  chk(`lattice as columns: the file still reopens as the rotated boxes (by its # micro:model line — the constants are written, not read back)`, r.lc.re.kind === 'blocks' && r.lc.re.rot && r.lc.re.by === 'file');
  chk(`a .dm with constant per-record sizes and no DD lattice opens as boxes (${r.dm.re.kind}, pitch ${r.dm.grid}, ${r.dm.re.drawn}/${r.dm.want})`, r.dm.re.kind === 'blocks' && near(r.dm.grid, [20, 20, 10]) && r.dm.re.drawn === r.dm.want);
  await pg.close();
}

// ── §134: FAST .dm OPENS — the discovery sweep and the render decode cut into page runs
// on @gcu/scan's worker pool (condenser dmDiscoverRun / dmDecodeRun), merged in run
// order. The same sub-blocked .dm (a category, blank centroids) opened on ONE thread
// (__dmPageOpen) and on the pool in small units (__dmUnitRecords) gives the same model:
// header, grid, categories and their codes, the records drawn and their raw numbers,
// every streamed value. And a slow open offers Parquet once per file (__pqOfferMs). ──
if (take()) {
  const pg = await mkPage('sm2dmfast');
  const r = await pg.evaluate(async () => {
    const M = window._micro;
    const D = await import('/test/dm-make.mjs'), F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 17, nx: 7, ny: 6, nz: 4 });
    const ROCK = ['OX', 'TR', 'FR', 'WS', ''];
    const recs = rows.map((b, i) => ({ ...b, XC: i % 89 === 5 ? null : b.XC, ROCK: ROCK[(i * 5 + (i >> 4)) % ROCK.length] }));
    const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' }, { name: 'XINC', type: 'N' }, { name: 'YINC', type: 'N' }, { name: 'ZINC', type: 'N' },
      { name: 'V', type: 'N' }, { name: 'ROCK', type: 'A' }, { name: 'ROTAXIS1', type: 'N', constant: 3 }, { name: 'ANGLE1', type: 'N', constant: -35 }];
    const bytes = new Uint8Array(D.makeDM(fields, recs, { precision: 'ep' }));
    const O = [432820, 8522360, 300];
    const digest = async (L) => {
      const acc = { n: 0, rec: [], h: 0 };
      const mix = (v) => { acc.h = (Math.imul(acc.h ^ (v | 0), 16777619) + ((v * 1e6) % 1e9 | 0)) | 0; };
      for await (const c of L.docs.blockDoc.streamChunks({ chunkPoints: 1 << 18 })) {
        for (let i = 0; i < c.count; i++) { acc.rec.push(c.recIdx[i]); mix(c.x[i]); mix(c.y[i]); mix(c.z[i]); mix(Number.isNaN(c.chan[i]) ? -7 : c.chan[i]); mix(c.cat ? c.cat[i] : 0); mix(c.dimQ[3 * i] * 65536 + c.dimQ[3 * i + 1] * 256 + c.dimQ[3 * i + 2]); }
        acc.n += c.count;
      }
      return acc;
    };
    const facts = async (L) => { const h = L.docs.blockDoc.header, d = await digest(L);
      return { head: JSON.stringify({ grid: h.grid, bbox: h.bbox, sub: h.subBlocked, q: h.sizeQMax, sh: h.sizeShapes, cats: h.categories }), drawn: L.docs.blockDoc.drawn, el: M.renderer.layerElementCount(L.id), d }; };
    window.__dmPageOpen = true;
    const id1 = await M.openBlob(new File([bytes], 'fast1.dm'), 'fast1.dm', 'replace', null, { throw: true, origin: O });
    window.__dmPageOpen = false; window.__dmUnitRecords = 300; globalThis.__dmOpenWorkers = -1;
    const id2 = await M.openBlob(new File([bytes], 'fast2.dm'), 'fast2.dm', 'add', null, { throw: true, origin: O });
    const workers = globalThis.__dmOpenWorkers;
    const a = await facts(M.layers().find((x) => x.id === id1)), b = await facts(M.layers().find((x) => x.id === id2));
    window.__dmUnitRecords = 0;
    const want = recs.map((x, i) => (x.XC == null ? -1 : i)).filter((i) => i >= 0);
    const firstSeen = []; for (const i of want) if (!firstSeen.includes(recs[i].ROCK)) firstSeen.push(recs[i].ROCK);
    const L2 = M.layers().find((x) => x.id === id2);
    // a slow open offers Parquet — once per file
    window.__pqOfferMs = 0;
    const id3 = await M.openBlob(new File([bytes], 'slow.dm'), 'slow.dm', 'add', null, { origin: O });
    const bar = document.querySelector('.pq-offer'), offered = !!bar, text = bar ? bar.textContent : '';
    [...(bar ? bar.querySelectorAll('button') : [])].find((x) => x.textContent === 'not for this file')?.click();
    const gone = !document.querySelector('.pq-offer');
    await M.openBlob(new File([bytes], 'slow.dm'), 'slow.dm', 'add', null, { origin: O });
    const again = !!document.querySelector('.pq-offer');
    const csv = F.makeSubblockCsv(rows.slice(0, 400));
    await M.openBlob(new File([csv], 'other.csv'), 'other.csv', 'add');
    const other = document.querySelector('.pq-offer');
    const otherOk = !!other;
    [...other.querySelectorAll('button')].find((x) => x.textContent === 'Store as Parquet…').click();
    await new Promise((z) => setTimeout(z, 50));
    const dlg = document.querySelector('#opDlg').classList.contains('show');
    document.querySelector('#opNot').click();
    window.__pqOfferMs = 1e9;
    await M.openBlob(new File([csv], 'fast.csv'), 'fast.csv', 'add');
    const fastNone = !document.querySelector('.pq-offer');
    void id3;
    return { a, b, workers, want, firstSeen, kind: L2.kind, offered, text, gone, again, otherOk, dlg, fastNone };
  });
  chk(`fast .dm open: on the pool (${r.workers} workers, small units) and on one thread — the same header (grid, bbox, sizes, ${r.a.d.n} drawn, categories ${JSON.stringify(JSON.parse(r.a.head).cats)})`,
    r.workers > 0 && r.kind === 'blocks' && r.a.head === r.b.head && JSON.parse(r.a.head).sub);
  chk(`fast .dm open: the same records drawn (${r.b.el} = ${r.a.el} elements, ${r.b.drawn} = ${r.a.drawn}), with the same RAW numbers (blanks skipped, never reused) and the same values, codes and sizes record for record`,
    r.a.el === r.b.el && r.a.drawn === r.b.drawn && r.a.d.n === r.want.length && JSON.stringify(r.a.d.rec) === JSON.stringify(r.want) && JSON.stringify(r.b.d.rec) === JSON.stringify(r.want) && r.a.d.h === r.b.d.h);
  chk(`fast .dm open: category codes in first-appearance order on the pool too (${JSON.stringify(r.firstSeen)})`, JSON.stringify(JSON.parse(r.b.head).cats) === JSON.stringify(r.firstSeen));
  chk(`a slow open OFFERS Parquet (“${r.text.slice(0, 60)}…”); “not for this file” is remembered (offered again: ${r.again}); another file is offered (${r.otherOk}) and its button opens Store as Parquet (${r.dlg}); a fast open isn't (${r.fastNone})`,
    r.offered && r.gone && !r.again && r.otherOk && r.dlg && r.fastNone);
  await pg.close();
}

// ── §135: by-solid on a sub-blocked model across a WORKER POOL — @gcu/winding's box list
// cut into slices over several workers (Winding.create boxWorkers), each slice whole on
// one worker, answers written back at its offset. The fraction and the flag on a rotated
// .dm and on its axis-aligned twin, one worker (__boxWorkers = 1) vs the pool: identical
// record for record. ──
if (take()) {
  const pg = await mkPage('sm2boxpool');
  const r = await pg.evaluate(async () => {
    const M = window._micro, W = window.micro;
    const F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 19, nx: 12, ny: 10, nz: 5 });
    const O = [432820, 8522360, 300];
    const t = (50 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const Wp = (p) => [O[0] + c * p[0] - s * p[1], O[1] + s * p[0] + c * p[1], O[2] + p[2]];
    const idR = await M.openBlob(new File([F.makeSubblockDm(rows, { angle1: -50 })], 'rotp.dm'), 'rotp.dm', 'replace', null, { throw: true, origin: O });
    const idA = await M.openBlob(new File([F.makeSubblockCsv(rows)], 'twinp.csv'), 'twinp.csv', 'add', null, { throw: true });
    const LR = M.layers().find((x) => x.id === idR), LA = M.layers().find((x) => x.id === idA);
    const V = [[120, 100, 25], [10, 100, 25], [65, 175, 25], [65, 25, 25], [65, 100, 49], [65, 100, 1]];
    const T = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
    const mesh = async (name, world) => { const id = await W.addLayer({ kind: 'mesh', name, vertices: Float64Array.from((world ? V.map(Wp) : V).flat()), triangles: Uint32Array.from(T) }); return M.layers().find((l) => l.id === id); };
    const codes = (col) => Array.from(col ? col.codes : []);
    const fl = (L, nm) => { const cc = M.paintColByName(L, nm), k = cc ? cc.dict.indexOf('IN') : -1; return cc ? Array.from(cc.codes, (v) => (v === k ? 1 : 0)) : []; };
    const run = async (tag) => {
      const SR = await mesh('octR' + tag, true), SA = await mesh('octA' + tag, false);   // fresh meshes: fresh engines (one per mesh layer)
      const fr = codes(await M.ratioBySolid(SR, LR, { name: 'F' + tag, res: 3, mode: 'inside' }));
      const meta = document.querySelector('#meta').textContent;
      const fa = codes(await M.ratioBySolid(SA, LA, { name: 'F' + tag, res: 3, mode: 'inside' }));
      await M.flagBySolid(SR, [LR], { name: 'G' + tag, label: 'IN', mode: 'inside' });
      await M.flagBySolid(SA, [LA], { name: 'G' + tag, label: 'IN', mode: 'inside' });
      return { fr, fa, gr: fl(LR, 'G' + tag), ga: fl(LA, 'G' + tag), meta, workers: SR._windingEngine ? SR._windingEngine.boxWorkers : -1 };
    };
    window.__boxWorkers = 1; const one = await run('1');
    window.__boxWorkers = 0; const pool = await run('P');
    const same = (x, y) => x.length === y.length && x.length > 0 && x.every((v, i) => v === y[i]);
    return { n: rows.length, oneW: one.workers, poolW: pool.workers, meta: pool.meta,
      fr: same(one.fr, pool.fr), fa: same(one.fa, pool.fa), gr: same(one.gr, pool.gr), ga: same(one.ga, pool.ga), twin: same(pool.fr, pool.fa),
      partial: pool.fr.filter((v) => v > 0 && v < 255).length, inside: pool.ga.reduce((a, v) => a + v, 0) };
  });
  chk(`by-solid box list on a pool: ${r.poolW} workers (vs ${r.oneW}) over ${r.n} sub-blocks (“${r.meta.slice(0, 70)}…”)`, r.oneW === 1 && r.poolW > 1 && r.n >= 4096);
  chk(`by-solid box list on a pool: fraction (${r.partial} partial) and flag (${r.inside} IN) on the rotated .dm and its twin — identical to the one-worker answer record for record (${r.fr}/${r.fa}/${r.gr}/${r.ga}), and the copy = the twin (${r.twin})`,
    r.fr && r.fa && r.gr && r.ga && r.twin && r.partial > 50 && r.inside > 50);
  await pg.close();
}

// ── an EMPTY export is refused, said, never saved: deliverBlob is every export's one door, and a
//    0-byte figure came out of an overloaded capture once (the lab, software rendering) ──
if (take()) {
  const pe = await mkPage('sm2empty');
  const r = await pe.evaluate(async () => {
    const m = window._micro, clicks = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };   // a download would leave the page
    try {
      const empty = await m.deliverBlob(new Blob([]), 'figure_1.png');
      const meta = document.querySelector('#meta').textContent;
      await m.deliverBlob(new Blob(['x']), 'ok.txt');
      return { empty, meta, clicks };
    } finally { HTMLAnchorElement.prototype.click = orig; }
  });
  chk(`an empty export is refused and said (“${r.meta}”), a real one still downloads (${JSON.stringify(r.clicks)})`,
    r.empty === false && /came out empty/.test(r.meta) && r.clicks.length === 1 && r.clicks[0] === 'ok.txt');
  await pe.close();
}

// ── SOFTWARE-RENDERER MODE (src/software-mode.js + src/swrender.js): on a CPU rasterizer micro
//    draws ~100k a frame, only on change, no idle pick capture, EDL off, and says so. Forced ON
//    through Settings on this (GPU) machine: the budget defaults to 100k, a still converged view
//    draws NO frames and builds NO pick buffer, a click still picks (rendering its pixel), the
//    status line says it. Forced OFF: the 1M default, EDL back, the idle capture builds again. ──
if (take()) {
  const ps = await mkPage('sm2swr');
  await ps.evaluate(() => { localStorage.removeItem('micro.budget'); localStorage.removeItem('micro.swRender'); });
  await ps.reload({ waitUntil: 'load' });
  await ps.waitForFunction(() => window._micro, null, { timeout: 20000 });
  const CSV = () => { let s = 'XC,YC,ZC,FE\n'; for (let k = 0; k < 20; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) s += `${i * 10},${j * 10},${k * 5},${40 + (i % 8)}\n`; return s; };
  await ps.evaluate((csv) => window._micro.openBlob(new Blob([csv]), 's.csv', 'replace'), CSV());
  await ps.waitForFunction(() => window._micro.layers().length && window._micro.renderer.layerElementCount(window._micro.layers()[0].id) >= 8000, null, { timeout: 30000 });
  const before = await ps.evaluate(() => ({ budget: document.querySelector('#budget').value, edl: document.querySelector('#edlOn').checked }));
  const setSw = (v) => ps.evaluate((val) => {
    window._micro.openSettingsWindow();
    const win = [...document.querySelectorAll('.fwin')].pop();
    [...win.querySelectorAll('button')].find((b2) => b2.textContent === 'display').click();
    const sel = [...win.querySelectorAll('select')].find((s2) => [...s2.options].some((o) => /^automatic \(/.test(o.textContent)));
    sel.value = val; sel.dispatchEvent(new Event('change'));
    const meta = document.querySelector('#meta').textContent;
    window._micro.closeAllWindows();
    return { stored: localStorage.getItem('micro.swRender'), meta };
  }, v);
  // a still view: wait for convergence, then count the frames drawn and see whether the pick capture built
  const idle = () => ps.evaluate(async () => {
    const R = window._micro.renderer, until = Date.now() + 15000;
    while (!/converged/.test(document.querySelector('#stats').textContent) && Date.now() < until) await new Promise((z) => setTimeout(z, 100));
    await new Promise((z) => setTimeout(z, 600));          // past the convergence frame + any capture batches
    let n = 0; const orig = R.draw; R.draw = function (...a) { n++; return orig.apply(this, a); };
    await new Promise((z) => setTimeout(z, 2000));
    R.draw = orig;
    return { frames: n, capture: R.captureReady, stats: document.querySelector('#stats').textContent, budget: document.querySelector('#budget').value, edl: document.querySelector('#edlOn').checked };
  });
  const on = await setSw('on');
  const swIdle = await idle();
  chk(`software mode forced on (Settings → ${on.stored}): budget ${before.budget} → ${swIdle.budget}, EDL ${before.edl} → ${swIdle.edl}, status “${on.meta}”`,
    on.stored === 'on' && before.budget === '1000000' && swIdle.budget === '100000' && before.edl === true && swIdle.edl === false
    && /software rendering (mode|detected)/.test(on.meta) && /^software · /.test(swIdle.stats));
  chk(`software mode: a still, converged view draws no frames (${swIdle.frames} in 2 s) and builds no pick buffer (capture ${swIdle.capture})`,
    swIdle.frames === 0 && swIdle.capture === false);
  const cvs = await ps.$('#cv'); const box = await cvs.boundingBox(); let hit = 0;
  const fromCap0 = await ps.evaluate(() => window._micro.renderer.picksFromCapture);
  // a KNOWN block (sweep 2026-11-25: any record passed): in plan, the top of column (10, 10) — XC 100,
  // YC 100, ZC 95 — at its projected centre; the panel must show THAT block's coordinates
  const at = await ps.evaluate(async () => {
    const M = window._micro; await window.micro.look('plan'); await window.micro.fit(); await new Promise((z) => setTimeout(z, 400));
    const cv = document.querySelector('#cv'), rect = cv.getBoundingClientRect(), st = M.cam.state, o = M.frame.origin, V = st.viewProj, w = [100, 100, 97.5];
    const q = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
    const xx = V[0] * q[0] + V[4] * q[1] + V[8] * q[2] + V[12], yy = V[1] * q[0] + V[5] * q[1] + V[9] * q[2] + V[13], ww = V[3] * q[0] + V[7] * q[1] + V[11] * q[2] + V[15];
    return [(xx / ww + 1) / 2 * rect.width, (1 - yy / ww) / 2 * rect.height];
  });
  await ps.mouse.click(box.x + at[0], box.y + at[1]); await ps.waitForTimeout(400);
  const picked = await ps.evaluate(() => { const rp = document.querySelector('#recPanel'); if (!rp || !rp.classList.contains('show')) return null;
    const o = {}; for (const r of rp.querySelectorAll('.rp-row')) o[r.querySelector('.k').textContent] = r.querySelector('.v').textContent; return o; });
  hit = picked ? Object.keys(picked).length : 0;
  const fromCap1 = await ps.evaluate(() => window._micro.renderer.picksFromCapture);
  chk(`software mode: a click on block (10, 10)'s top picks THAT block (${picked ? `XC ${picked.XC}, YC ${picked.YC}, ZC ${picked.ZC}` : 'nothing'}), rendered on the click, not read from a capture (${fromCap0} → ${fromCap1})`,
    picked && +picked.XC === 100 && +picked.YC === 100 && +picked.ZC === 95 && fromCap1 === fromCap0);
  await ps.evaluate(() => { document.querySelector('#recPanel').classList.remove('show'); window._micro.renderer.setPicked(null); window._micro.requestRender(); });
  const off = await setSw('off');
  const gpuIdle = await idle();
  chk(`software mode forced off: budget ${gpuIdle.budget}, EDL ${gpuIdle.edl}, no “software” on the status line, the idle pick capture builds again (${gpuIdle.capture}) and then the view rests (${gpuIdle.frames} frames)`,
    off.stored === 'off' && gpuIdle.budget === '1000000' && gpuIdle.edl === true && !/software/.test(gpuIdle.stats) && gpuIdle.capture === true && gpuIdle.frames === 0);
  await ps.evaluate(() => { localStorage.removeItem('micro.swRender'); localStorage.removeItem('micro.budget'); });
  await ps.close();
}

// ── §136: SUB-BLOCK QA — do the sub-blocks tile their parents (modelqa.js subBlockTiling over
//    condenser grid/tiling.js). A rotated .dm stating its parents the Datamine way (XMORIG…, NX…,
//    a per-record IJK) with three defects: a sub-block dropped (its parent under by exactly its
//    volume), one duplicated (the later copy overlaps — selecting the finding selects it), one IJK
//    that lies. Its axis-aligned CSV twin (no IJK, the parent corner found from a whole block)
//    finds the same gap and overlap; the clean model reports nothing; the routine tool's values
//    carry the counts and a check on them stops the run. ──
if (take()) {
  const p = await mkPage('sm2tiling');
  await p.evaluate(async () => { try { await (await navigator.storage.getDirectory()).removeEntry('sm2tiling', { recursive: true }); } catch { } });
  const r = await p.evaluate(async () => {
    const M = window._micro, m = window.micro, F = await import('/test/subblock-make.mjs');
    const NP = { nx: 6, ny: 5, nz: 3 };
    const { rows } = F.makeSubblockRows({ seed: 23, ...NP });
    // the defects: a sub-block of a split parent dropped, another duplicated right after itself, an IJK lie
    const split = (i) => !(rows[i].XINC === 20 && rows[i].YINC === 20 && rows[i].ZINC === 10);
    const di = rows.findIndex((x, i) => i > 40 && split(i));
    const dropped = rows[di], dropVol = dropped.XINC * dropped.YINC * dropped.ZINC;
    const bad = rows.filter((_, i) => i !== di);
    const ei = bad.findIndex((x, i) => i > 200 && split(i));
    bad.splice(ei + 1, 0, { ...bad[ei] });
    const li = ei + 30; bad[li] = { ...bad[li], IJK: 12345 };
    const O = [432820, 8522360, 300];
    const out = { n: bad.length, dupRec: ei + 1, lieRec: li, dropVol };
    const open = async (bytes, name, mode, opts = {}) => { const id = await M.openBlob(new File([bytes], name), name, mode, null, { throw: true, ...opts }); return M.layers().find((x) => x.id === id); };
    const LD = await open(F.makeSubblockDm(bad, { angle1: -50, parents: NP }), 'tiled-bad.dm', 'replace', { origin: O });
    const t = await M.subBlockTiling(LD);
    out.dm = { overlap: t.overlap, overlapRecs: t.overlapRecs, under: t.under, underVolume: t.underVolume, ijkBad: t.ijkBad, ijkRecs: t.ijkRecs, crossing: t.crossing, offLattice: t.offLattice, offGrid: t.offGrid, parents: t.parents, phaseFrom: t.phaseFrom, ijkChecked: t.ijkChecked, ps: t.parentSize };
    // the placed model's own frame as columns: XL/YL/ZL ƒ = the file's local XC/YC/ZC, record for record
    const frameCols = async (L) => {
      const sch = M.schemaExt(L, M.layerTableHeader(L)).map((c) => c.name), ix = ['XL', 'YL', 'ZL'].map((n) => sch.indexOf(n));
      let worst = 0, n = 0;
      for await (const { f, rec } of M.layerRecords(L)) { const b = bad[rec]; worst = Math.max(worst, Math.abs(f[ix[0]] - b.XC), Math.abs(f[ix[1]] - b.YC), Math.abs(f[ix[2]] - b.ZC)); n++; }
      return { ix, worst, n, exprs: (L.calcCols || []).filter((c) => /^[XYZ]L$/.test(c.name)).map((c) => c.expr) };
    };
    out.frame = await frameCols(LD);
    await M.applyBlockFilter('XL > 60', LD);
    out.frameFilter = { drawn: LD._filterMask ? LD._filterMask.reduce((a, v) => a + v, 0) : -1, want: bad.filter((b) => b.XC > 60).length };   // sub-blocked: the mask path (no compaction)
    await M.applyBlockFilter('', LD);
    await M.setDmOrigin(LD, [1000, 2000, 30]);               // a new origin: the world moves, the model frame doesn't
    out.frame2 = await frameCols(LD);
    await M.setDmOrigin(LD, O);
    const LC = await open(F.makeSubblockCsv(bad), 'tiled-bad.csv', 'add');
    out.csvFrameCols = (LC.calcCols || []).length;
    const tc = await M.subBlockTiling(LC);
    out.csv = { overlap: tc.overlap, overlapRecs: tc.overlapRecs, under: tc.under, underVolume: tc.underVolume, phaseFrom: tc.phaseFrom, ijkChecked: tc.ijkChecked };
    const LG = await open(F.makeSubblockDm(rows, { angle1: -50, parents: NP }), 'tiled-good.dm', 'add', { origin: O });
    // the QA window on the clean model: no sub-block finding, the rail says the tiling is exact
    const eg = await M.openModelQa(LG); await eg.done;
    out.goodChecks = M.qaFindings(eg.st.r).map((f) => f.check);
    out.goodRail = eg.win.el.textContent.includes('✓ exact');
    // …and on the dirty one: the overlap finding selects exactly the later copy
    const eb = await M.openModelQa(LD); await eb.done;
    const fs = M.qaFindings(eb.st.r);
    out.badChecks = fs.map((f) => `${f.sev}:${f.check}:${f.count}`);
    const fo = fs.find((f) => f.check === 'sub-blocks overlap');
    out.selected = fo ? await M.selectFinding(LD, fo) : -1;
    out.selRec = LD._selMask ? Array.from(LD._selMask).indexOf(1) : -1;
    out.gapGo = !!(fs.find((f) => /parent not filled/.test(f.check)) || {}).show;
    // the .dm census is read COLUMNAR now: its V column = the CSV twin's (row path), a DD constant counted per record
    const qc = await M.modelQa(LC), pick = (q, nm) => { const c = q.cols.find((x) => x.name === nm); return c && [c.n, c.blank, c.negative, c.zero, c.min, c.max, +c.mean.toFixed(9), c.p50]; };
    out.censusDm = pick(eb.st.r, 'V'); out.censusCsv = pick(qc, 'V');
    const ang = eb.st.r.cols.find((x) => x.name === 'ANGLE1');
    out.constCol = ang ? [ang.n, ang.min, ang.max, eb.st.r.N] : null;
    // the tool's values, and a routine that gates on them
    const mq = await m.runTool('modelqa', { layer: LD.name });
    out.values = mq.values;
    return out;
  });
  chk(`SUB-BLOCK QA (.dm, IJK): ${r.dm.parents} parents of ${r.dm.ps.join('×')}, corner ${r.dm.phaseFrom} — the dropped block's parent under by its ${r.dropVol} m³, the duplicate overlaps (rec ${r.dm.overlapRecs} = ${r.dupRec}), the lying IJK named (rec ${r.dm.ijkRecs} = ${r.lieRec}), nothing else (${JSON.stringify(r.dm)})`,
    r.dm.parents === 90 && r.dm.phaseFrom === 'stated' && r.dm.ijkChecked && r.dm.ps.join() === '20,20,10'
    && r.dm.under === 1 && Math.abs(r.dm.underVolume - r.dropVol) < 1e-6 && r.dm.overlap === 1 && r.dm.overlapRecs[0] === r.dupRec
    && r.dm.ijkBad === 1 && r.dm.ijkRecs[0] === r.lieRec && r.dm.crossing === 0 && r.dm.offLattice === 0 && r.dm.offGrid === 0);
  chk(`MODEL FRAME: a placed .dm carries XL/YL/ZL ƒ columns = its file's local XC/YC/ZC (${r.frame.n} records, worst ${r.frame.worst.toExponential(2)}; ${r.frame.exprs.join(' | ')}); a filter on XL keeps the twin's count (${r.frameFilter.drawn} = ${r.frameFilter.want}); a new origin rewrites them, the values don't move (worst ${r.frame2.worst.toExponential(2)}: ${r.frame2.exprs[0]}); an unplaced CSV gets none (${r.csvFrameCols})`,
    r.frame.ix.every((i) => i >= 0) && r.frame.n === r.n && r.frame.worst < 1e-6 && r.frameFilter.drawn === r.frameFilter.want && r.frameFilter.want > 0
    && r.frame2.worst < 1e-6 && /1000/.test(r.frame2.exprs[0]) && !/432820/.test(r.frame2.exprs[0]) && r.csvFrameCols === 0);
  chk(`SUB-BLOCK QA (CSV twin, no IJK — the corner found from a whole block: ${r.csv.phaseFrom}): the same gap and overlap (${JSON.stringify(r.csv)})`,
    r.csv.phaseFrom === 'block' && !r.csv.ijkChecked && r.csv.under === 1 && Math.abs(r.csv.underVolume - r.dropVol) < 1e-6 && r.csv.overlap === 1 && r.csv.overlapRecs[0] === r.dupRec);
  chk(`SUB-BLOCK QA window: the clean model has no sub-block finding and reads “✓ exact” (${r.goodChecks.join(' · ')}); the dirty one lists them (${r.badChecks.join(' · ')}), the overlap selects its block (${r.selected} → rec ${r.selRec}), the gap steps the camera`,
    r.goodRail && !r.goodChecks.some((c) => /sub-block|parent|IJK/.test(c))
    && r.badChecks.includes('error:sub-blocks overlap:1') && r.badChecks.includes('error:IJK disagrees with the position:1') && r.badChecks.includes('warn:parent not filled by its sub-blocks:1')
    && r.selected === 1 && r.selRec === r.dupRec && r.gapGo);
  chk(`MODEL QA on a .dm reads its columns columnar: V's census = the CSV twin's row-path census (${JSON.stringify(r.censusDm)} vs ${JSON.stringify(r.censusCsv)}); a DD constant counts every record (${JSON.stringify(r.constCol)})`,
    !!r.censusDm && JSON.stringify(r.censusDm) === JSON.stringify(r.censusCsv) && r.constCol && r.constCol[0] === r.constCol[3]);
  chk(`SUB-BLOCK QA tool: the counts are values a check gates on (${JSON.stringify(r.values)})`,
    r.values.overlaps === 1 && r.values.underfilled === 1 && r.values.ijkMismatches === 1 && r.values.crossings === 0 && r.values.offLattice === 0 && r.values.parents === 90 && Math.abs(r.values.missingVolume - r.dropVol) < 1e-6);
  await saveProject(p);
  const g = await p.evaluate(async () => {
    const M = window._micro, m = window.micro;
    const L = M.layers().find((x) => /tiled-bad\.dm/.test(x.name));
    M._recipesList().push({ name: 'tiling gate', tool: 'routine', params: { steps: [
      { tool: 'modelqa', with: { layer: L.name }, as: 'mq' },
      { check: 'mq.overlaps = 0', say: 'the sub-blocks tile their parents' },
    ] } });
    const res = await m.runRoutine('tiling gate');
    return { status: res.status, error: res.error, steps: res.record.steps.map((s) => s.status), observed: res.record.steps[1].observed };
  });
  chk(`SUB-BLOCK QA gate: a routine's check on mq.overlaps stops the run (${JSON.stringify(g)})`,
    g.status === 'failed' && g.steps.join() === 'ok,fail' && /tile their parents/.test(g.error || '') && g.observed && g.observed['mq.overlaps'] === 1);
  await p.close();
}

// ── §137: PROJECTION LEFTOVERS (after §129). (1) A ramp change while projecting only
// RE-COMPOSITES — the targets hold values, not colours: every frame after the change draws
// 0 elements, and the picture's colour changes. (2) A numeric ƒ column (rule codes rising
// with its value) PROJECTS: its codes' max per column = the brute-force max of the column's
// codes, a click names the record that is the max. (3) A marquee under a projection takes
// the PROJECTED records: max → each column's argmax record; mean → the record nearest the
// pixel's own mean (keyed per pixel from the projection's target).
if (take()) {
  const pg = await mkPage('sm2mipleft');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro;
    const NX = 10, NY = 6, NZ = 5, DX = 10, DY = 10, DZ = 5;
    let s = 777;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const val = []; let csv = 'XC,YC,ZC,FE\n';
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v = k === NZ - 1 ? +(1 + rnd() * 9).toFixed(3) : +(10 + rnd() * 90).toFixed(3);
      val.push(v); csv += `${1000 + i * DX + DX / 2},${2000 + j * DY + DY / 2},${300 + k * DZ + DZ / 2},${v}\n`;
    }
    const rec = (i, j, k) => k * NY * NX + j * NX + i;
    const id = await M.openBlob(new Blob([csv]), 'mipleft.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    M.setLayerColorSel(L, M.colorSelFor(L, 'FE'));
    const frame = () => new Promise((z) => requestAnimationFrame(z));
    const settle = async () => {
      for (let k = 0; k < 400; k++) { M.requestRender(); await frame(); const p = R.projection; if (R.elementCount && R.accumulated === R.elementCount && (!p || p.exact)) break; }
      for (let k = 0; k < 3; k++) { M.requestRender(); await frame(); }
    };
    await W.setView({ look: 0, elevation: 90, ortho: true, projection: null });
    document.querySelector('#btnFit').click();
    await settle();
    const cv = document.querySelector('#cv'), rc = cv.getBoundingClientRect(), dpr = cv.width / rc.width;
    const toCss = (w) => {
      const o = M.frame.origin, p = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], m = M.cam.state.viewProj;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [(cx / cw + 1) / 2 * rc.width, (1 - cy / cw) / 2 * rc.height];
    };
    const devOf = ([x, y]) => [Math.round(x * dpr), Math.round(cv.height - y * dpr - 1)];
    const cols = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) cols.push({ i, j, css: toCss([1000 + i * DX + DX / 2, 2000 + j * DY + DY / 2, 300 + NZ * DZ]) });
    const screen = () => { const c = new OffscreenCanvas(cv.width, cv.height), g = c.getContext('2d'); g.drawImage(cv, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const rgbAt = (d, [x, y]) => { const k = ((cv.height - 1 - y) * cv.width + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    const out = {};
    // (1) the ramp: max projection, converged; then a palette change → every later frame draws 0
    M.setProjection('max'); await settle();
    const before = screen();
    const draws = []; const orig = R.draw;
    R.draw = function (...a) { const res = orig.apply(this, a); draws.push(res.drawn); return res; };
    const C = await M.mod('color.js');
    C.setLayerPalette(L, 'magma');
    for (let k = 0; k < 4; k++) { M.requestRender(); await frame(); }
    R.draw = orig;
    const after = screen();
    let changed = 0;
    for (const c of cols) { const a = rgbAt(before, devOf(c.css)), b = rgbAt(after, devOf(c.css)); if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30) changed++; }
    out.ramp = { draws, changed, n: cols.length };
    C.setLayerPalette(L, 'viridis');
    // (3) the marquee: the whole view, max then mean
    const pr = R.projectionSupport;
    const region = (mode) => {
      const hit = R.pickRegion({ x: 0, y: 0, w: rc.width, h: rc.height }, M.cam, { pointPx: +document.querySelector('#ptPx').value, blocksAsPoints: false, section: null });
      let good = 0, n = 0;
      const img = R.projectionValues(id);
      for (const c of cols) {
        const [x, y] = devOf(c.css), k = (y - hit.h + hit.h) * hit.w + x;   // (the rect is the whole canvas: rows bottom-up)
        const got = hit.data[k * 4];
        const ts = []; for (let kk = 0; kk < NZ; kk++) ts.push(val[rec(c.i, c.j, kk)]);
        let want;
        if (mode === 'max') want = rec(c.i, c.j, ts.indexOf(Math.max(...ts)));
        else {
          const [lo, hi] = R.layerChanRange(id), tt = ts.map((v) => (v - lo) / (hi - lo)), ref = img.data[y * img.w + x];
          let best = 0; for (let kk = 1; kk < NZ; kk++) if (Math.abs(tt[kk] - ref) < Math.abs(tt[best] - ref)) best = kk;
          want = rec(c.i, c.j, best);
        }
        n++; if (got === want) good++;
      }
      return { good, n, projection: hit.projection };
    };
    await settle();
    out.regionMax = region('max');
    if (pr.mean) { M.setProjection('mean'); await settle(); out.regionMean = region('mean'); }
    // (2) a numeric ƒ column: F2 = FE * 2, coloured by it (codes through the palette)
    M.setProjection(null); await settle();
    M.applyCalcCols(L, [{ name: 'F2', expr: 'FE * 2', ty: 'number' }]);
    M.setLayerColorSel(L, 'calc:F2');
    for (let k = 0; k < 100 && !M.calcDisplayColOf?.(L) && !(L._calcDisplay && L._calcDisplay.col); k++) await new Promise((z) => setTimeout(z, 30));
    M.setProjection('max'); await settle();
    const p = R.projection, img = R.projectionValues(id), col = L._calcDisplay && L._calcDisplay.col;
    let worst = 0, picks = 0;
    const lo = Math.min(...val) * 2, hi = Math.max(...val) * 2;
    for (const c of cols) {
      const ts = []; for (let k = 0; k < NZ; k++) ts.push(val[rec(c.i, c.j, k)] * 2);
      const mx = Math.max(...ts), code = col && Number.isFinite(col.min) ? 1 + Math.max(0, Math.min(254, Math.round(254 * (mx - col.min) / ((col.max - col.min) || 1)))) : 1 + Math.round(254 * (mx - lo) / (hi - lo));
      const [x, y] = devOf(c.css); worst = Math.max(worst, Math.abs(img.data[y * img.w + x] * 255 - code));
      const h = R.pick(c.css[0], c.css[1], M.cam, { pointPx: +document.querySelector('#ptPx').value, blocksAsPoints: false, section: null });
      if (h && h.rec === rec(c.i, c.j, ts.indexOf(mx))) picks++;
    }
    out.codes = { projected: !!(p && p.layers.includes(id)), codes: !!(p && p.codes && p.codes.includes(id)), worst, picks, n: cols.length, exact: p && p.exact };
    M.setProjection(null);
    return out;
  });
  chk(`projection leftovers: a palette change while projecting re-composites only — frames after it drew ${JSON.stringify(r.ramp.draws)} elements, ${r.ramp.changed}/${r.ramp.n} columns changed colour`,
    r.ramp.draws.length >= 1 && r.ramp.draws.every((d) => d === 0) && r.ramp.changed > r.ramp.n / 2);
  chk(`projection leftovers: a numeric ƒ column projects its codes (${JSON.stringify(r.codes)}) — the max code per column within one code, a click names the max record`,
    r.codes.projected && r.codes.codes && r.codes.exact && r.codes.worst <= 1.01 && r.codes.picks === r.codes.n);
  chk(`projection leftovers: a marquee under max takes each column's max record (${r.regionMax.good}/${r.regionMax.n}, ${r.regionMax.projection})${r.regionMean ? `; under mean the record nearest the pixel's mean (${r.regionMean.good}/${r.regionMean.n})` : ' (mean not on this GPU)'}`,
    r.regionMax.good === r.regionMax.n && r.regionMax.projection === 'max' && (!r.regionMean || r.regionMean.good >= r.regionMean.n - 1));
  await pg.close();
}

// ── §138: PROJECTIONS AS GRIDS (src/projectgrid.js). A regular model: per node (= a block column)
// the max / min / mean grade, the thickness / accumulation / tonnes / metal above a cutoff equal the
// brute force over the column's blocks; the columnar engine and the row path agree to the bit; the
// filter applies; the grid opens as a grid layer. A sub-blocked model and its ROTATED .dm twin: the
// tonnes grid (density 1) totals each model's volume — exactly on the twin's fine lattice, within a
// sampling error on the rotated one. The routine tool returns the same numbers.
if (take()) {
  const pg = await mkPage('sm2pgrid');
  const r = await pg.evaluate(async () => {
    const M = window._micro, V = window._microVis;
    const NX = 9, NY = 7, NZ = 6, DX = 10, DY = 10, DZ = 5;
    let s = 4242;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const fe = [], sg = []; let csv = 'XC,YC,ZC,FE,SG\n';
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v = +(10 + rnd() * 60).toFixed(3), d = +(2.5 + rnd()).toFixed(3);
      fe.push(v); sg.push(d); csv += `${1000 + i * DX + DX / 2},${2000 + j * DY + DY / 2},${300 + k * DZ + DZ / 2},${v},${d}\n`;
    }
    const rec = (i, j, k) => k * NY * NX + j * NX + i;
    const id = await M.openBlob(new Blob([csv]), 'pgrid.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    const nodeOf = (g, x, y) => { const c = Math.round((x - g.x0) / g.dx), rr = Math.round((g.y0 - y) / g.dy); return rr * g.nx + c; };
    const brute = (stat, i, j, cut = -Infinity) => {
      const ks = [...Array(NZ).keys()], g = ks.map((k) => fe[rec(i, j, k)]), d = ks.map((k) => sg[rec(i, j, k)]);
      if (stat === 'max') return Math.max(...g);
      if (stat === 'min') return Math.min(...g);
      if (stat === 'mean') return g.reduce((a, b) => a + b, 0) / NZ;
      let t = 0; for (const k of ks) if (g[k] >= cut) t += stat === 'thickness' ? DZ : stat === 'accumulation' ? DZ * g[k] : stat === 'tonnes' ? DZ * DX * DY * d[k] : DZ * DX * DY * d[k] * g[k] * 0.01;
      return t;
    };
    const out = { stats: {} };
    for (const stat of ['max', 'min', 'mean', 'thickness', 'accumulation', 'tonnes', 'metal']) {
      const o = { col: 'FE', stat, cutoff: ['thickness', 'accumulation', 'tonnes', 'metal'].includes(stat) ? 40 : null, density: 'SG', gradeUnit: stat === 'metal' ? 'pct' : '' };
      const res = await V.projectGrid(L, o);                  // the default lattice: the model's pitch, nodes on block centres
      let worst = 0, n = 0;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const want = brute(stat, i, j, 40), k = nodeOf(res.grid, 1000 + i * DX + DX / 2, 2000 + j * DY + DY / 2), got = res.grid.data[k];
        worst = Math.max(worst, Math.abs(got - want) / Math.max(1, Math.abs(want))); n++;
      }
      window.__pgRowPath = true;
      const row = await V.projectGrid(L, o);
      window.__pgRowPath = false;
      let same = row.grid.data.length === res.grid.data.length;
      for (let k = 0; same && k < row.grid.data.length; k++) if (Math.abs(row.grid.data[k] - res.grid.data[k]) > 1e-6 * Math.max(1, Math.abs(res.grid.data[k]))) same = false;
      out.stats[stat] = { worst, n, where: res.where, same, nodes: res.geom.nx * res.geom.ny, filled: res.filled };
    }
    // the filter box applies: FE < 50 → no node's max reaches 50
    await M.applyBlockFilter('FE < 50', L);
    { const res = await V.projectGrid(L, { col: 'FE', stat: 'max', cell: DX }); let mx = -Infinity; for (const v of res.grid.data) if (v !== res.grid.nodata && v > mx) mx = v; out.filtered = { mx }; }
    { const res = await V.projectGrid(L, { col: 'FE', stat: 'max', cell: DX, scope: 'all' }); let mx = -Infinity; for (const v of res.grid.data) if (v !== res.grid.nodata && v > mx) mx = v; out.unfiltered = { mx }; }
    await M.applyBlockFilter('', L);
    // the layer
    const made = await V.projectGridLayer(L, { col: 'FE', stat: 'max' });
    const G = M.layers().find((x) => x.id === made.id);
    out.layer = { name: made.name, grid: !!(G && G.docs && G.docs.gridDoc), lineage: G && G.lineage && G.lineage.op, nx: G && G.docs.gridDoc && G.docs.gridDoc.grid.nx, cell: made.geom.dx };
    // WHERE the layer sits (sweep 2026-11-25: the node count and cell were checked, its place in
    // the world never was): its first node on the first block column's centre, and the node of
    // column (2, 3) reading that column's brute-force max FROM THE LAYER
    { const gg = G && G.docs.gridDoc && G.docs.gridDoc.grid;
      out.layer.x0 = gg && gg.x0; out.layer.y0 = gg && gg.y0;
      out.layer.at23 = gg && gg.data ? gg.data[nodeOf(gg, 1000 + 2 * DX + DX / 2, 2000 + 3 * DY + DY / 2)] : null;
      out.layer.want23 = brute('max', 2, 3); }
    // a DATA grid now (Arthur 2026-11-26): a flat sheet above the model, its value named, a column of its own
    { const cols = (M.attrColumnsOf(G) || []).map((c) => c.name), row = await M.fetchLayerRow(G, 0), top = M.layerWorldBox(L)[1][2];
      out.data = { surface: !!G.gridSurface, flatZ: G.surfaceFlatZ, above: G.surfaceFlatZ > top, value: G.gridValue && G.gridValue.name, cols, rowZ: row[2], rowVal: row[cols.indexOf('FE_max')] }; }
    // the tool
    const tr = await M.runTool('projectgrid', { layer: 'pgrid.csv', col: 'FE', stat: 'thickness', cutoff: 40, cell: DX });
    out.tool = { values: tr.values, layers: tr.layers };
    // the window: Make grid → a layer, said on the status line
    { const w = V.openProjectGridDialog(L); w.el.querySelector('[data-go]').click();
      for (let k = 0; k < 200 && !/^projection to grid: /.test(document.querySelector('#meta').textContent); k++) await new Promise((z) => setTimeout(z, 25));
      out.dialog = document.querySelector('#meta').textContent.slice(0, 120); w.close(); }
    // sub-blocked twin + rotated .dm: Σ tonnes (density 1) = the model's volume
    const F = await import('/test/subblock-make.mjs');
    const { rows } = F.makeSubblockRows({ seed: 9, nx: 4, ny: 3, nz: 3 });
    const vol = () => { let v = 0; for (const rw of rows) v += rw.XINC * rw.YINC * rw.ZINC; return v; };
    const twin = await M.openBlob(new Blob([F.makeSubblockCsv(rows)]), 'pgtwin.csv', 'add', null, { throw: true });
    const LT = M.layers().find((x) => x.id === twin);
    const rt = await V.projectGrid(LT, { col: 'V', stat: 'tonnes' });
    const rot = await M.openBlob(new Blob([F.makeSubblockDm(rows, { angle1: -50 })]), 'pgrot.dm', 'add', null, { throw: true, origin: [432820, 8522360, 300] });   // world = origin + the local point turned 50° CCW
    const LR = M.layers().find((x) => x.id === rot);
    const rr = await V.projectGrid(LR, { col: 'V', stat: 'tonnes', cell: 1 });
    // WHERE the rotated grid's tonnes sit: their centroid = the twin's, turned 50° CCW about the origin and moved to it
    const cen = (res) => { const g = res.grid; let w = 0, sx = 0, sy = 0; for (let r2 = 0; r2 < g.ny; r2++) for (let c = 0; c < g.nx; c++) { const v = g.data[r2 * g.nx + c]; if (v === g.nodata || !(v > 0)) continue; w += v; sx += v * (g.x0 + c * g.dx); sy += v * (g.y0 - r2 * g.dy); } return [sx / w, sy / w]; };
    const ct = cen(rt), cr = cen(rr), a = 50 * Math.PI / 180, want = [432820 + ct[0] * Math.cos(a) - ct[1] * Math.sin(a), 8522360 + ct[0] * Math.sin(a) + ct[1] * Math.cos(a)];
    out.sub = { vol: vol(), twin: rt.total, twinCell: rt.geom.dx, twinSub: !!LT.docs.blockDoc.header.subBlocked, rot: rr.total, rotated: !!(LR.docs.blockDoc.header.grid && LR.docs.blockDoc.header.grid.rot), rotCell: rr.geom.dx, rotWhere: rr.where, placed: Math.hypot(cr[0] - want[0], cr[1] - want[1]) };
    return out;
  });
  for (const [stat, m] of Object.entries(r.stats)) {
    chk(`projection to grid — ${stat}: each of ${m.n} columns = the brute force over its blocks (worst rel ${m.worst.toExponential(2)}), ${m.filled}/${m.nodes} nodes; columnar (${m.where}) = row path: ${m.same}`,
      m.n === 63 && m.worst < 1e-5 && m.same && m.filled === m.nodes);
  }
  chk(`projection to grid: the filter box applies (max ${r.filtered.mx.toFixed(2)} < 50; scope all → ${r.unfiltered.mx.toFixed(2)})`, r.filtered.mx < 50 && r.unfiltered.mx >= 50);
  chk(`projection to grid: the grid opens as a layer, in place (${JSON.stringify(r.layer)}): first node at the first column's centre 1005, 2065; column (2, 3) reads its own max from the layer`, r.layer.grid && r.layer.lineage === 'projectgrid' && r.layer.nx === 9 && r.layer.cell === 10 && Math.abs(r.layer.x0 - 1005) < 1e-6 && Math.abs(r.layer.y0 - 2065) < 1e-6 && Math.abs(r.layer.at23 - r.layer.want23) < 1e-4);
  chk(`projection to grid opens as a data grid: a flat sheet (${r.data.surface}) at ${r.data.flatZ}, above the model (${r.data.above}), its value named ${r.data.value} and a column of its own (${r.data.cols.join(', ')}; Z ${r.data.rowZ}, FE_max ${r.data.rowVal})`,
    r.data.surface && r.data.above && r.data.value === 'FE_max' && r.data.cols.join() === 'X,Y,Z,FE_max,row,col' && r.data.rowZ === r.data.flatZ && (r.data.rowVal == null || r.data.rowVal >= 0));
  chk(`projection to grid: the window makes the grid (“${r.dialog}”)`, /^projection to grid: pgrid_max_FE_10m\.asc — 378 blocks → 63 of 63 nodes/.test(r.dialog));
  chk(`projection to grid: the routine tool (${JSON.stringify(r.tool)})`, r.tool.values && r.tool.values.filled === 63 && r.tool.values.total > 0 && r.tool.layers.length === 1);
  chk(`projection to grid: a sub-blocked model's tonnes (density 1) total its volume exactly on its fine lattice (${r.sub.twin} vs ${r.sub.vol}, cell ${r.sub.twinCell}, sub-blocked ${r.sub.twinSub}); the ROTATED .dm twin within sampling (${r.sub.rot.toFixed(0)}, cell ${r.sub.rotCell}, rotated ${r.sub.rotated}, ${r.sub.rotWhere}), its tonnes where the twin's turn to (centroid off by ${r.sub.placed.toFixed(2)} m)`,
    r.sub.twinSub && r.sub.rotated && Math.abs(r.sub.twin - r.sub.vol) < 1e-6 * r.sub.vol && Math.abs(r.sub.rot - r.sub.vol) < 0.02 * r.sub.vol && r.sub.placed < 1);
  await pg.close();
}

// ── §139: GHOST filter display (src/ghost.js · condenser gl-ghost.js). A 3-level model in plan,
// orthographic, filtered: under ISOLATE the columns with no match show the background; under
// GHOST they show one flat tint, while every pixel of a kept block is exactly as isolate drew it —
// including a kept block BELOW a left-out one (a ghost never covers a kept block, even in front).
// OUTLINE: only the left-out envelope's boundary is inked, its interior stays background. DIM
// darkens instead. Software rendering draws the outline as the tint. Saved with the project.
if (take()) {
  const pg = await mkPage('sm2ghost');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro, V = window._microVis;
    const NX = 16, NY = 12, NZ = 3, D = 10;
    let csv = 'XC,YC,ZC,FE\n';
    const fe = (i, j, k) => (i < 6 && j < 6 ? (k === 0 ? 80 : 20) : i >= 10 && j >= 6 ? 70 : 20);   // a kept block UNDER a left-out top · a kept patch · the rest out
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) csv += `${1000 + i * D + D / 2},${2000 + j * D + D / 2},${300 + k * D + D / 2},${fe(i, j, k)}\n`;
    const id = await M.openBlob(new Blob([csv]), 'ghost.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    M.setLayerColorSel(L, M.colorSelFor(L, 'FE'));
    const frame = () => new Promise((z) => requestAnimationFrame(z));
    const settle = async () => { for (let k = 0; k < 300; k++) { M.requestRender(); await frame(); if (R.elementCount && R.accumulated === R.elementCount) break; } for (let k = 0; k < 4; k++) { M.requestRender(); await frame(); } };
    await W.setView({ look: 0, elevation: 90, ortho: true });
    document.querySelector('#btnFit').click();
    await M.applyBlockFilter('FE > 50', L);
    await settle();
    const cv = document.querySelector('#cv'), rc = cv.getBoundingClientRect(), dpr = cv.width / rc.width;
    const toDev = (x, y) => {
      const o = M.frame.origin, p = [x - o[0], y - o[1], 300 + NZ * D - o[2]], m = M.cam.state.viewProj;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [Math.round((cx / cw + 1) / 2 * cv.width), Math.round((1 - cy / cw) / 2 * cv.height)];   // canvas rows top-down
    };
    const shot = () => { const c = new OffscreenCanvas(cv.width, cv.height), g = c.getContext('2d'); g.drawImage(cv, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const at = (d, [x, y]) => { const k = (y * cv.width + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    const same = (a, b, tol = 6) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tol;
    const cells = { under: [], kept: [], out: [] };              // block-column centres by what they hold
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const p = toDev(1000 + i * D + D / 2, 2000 + j * D + D / 2);
      if (i < 6 && j < 6) cells.under.push(p); else if (i >= 10 && j >= 6) cells.kept.push(p); else cells.out.push(p);
    }
    const bg = R.background.slice(0, 3).map((v) => Math.round(v * 255));
    const iso = shot();
    const out = { bg };
    const grade = (d, list) => list.map((p) => at(d, p));
    out.isolate = { outBg: grade(iso, cells.out).filter((c) => same(c, bg)).length, n: cells.out.length };
    V.setFilterShow(L, 'ghost'); await settle();
    const gh = shot();
    const tints = grade(gh, cells.out);
    out.ghost = { tint: tints[0], flat: tints.filter((c) => same(c, tints[0])).length, notBg: tints.filter((c) => !same(c, bg, 12)).length, n: tints.length,
      underKept: cells.under.filter((p) => same(at(gh, p), at(iso, p))).length, keptKept: cells.kept.filter((p) => same(at(gh, p), at(iso, p))).length, nu: cells.under.length, nk: cells.kept.length,
      layerGhost: R.layerGhost(id) };
    V.setFilterShow(L, 'outline'); await settle();
    const ol = shot();
    // the out region's interior (a column whose 8 neighbours are out too) stays background; its boundary is inked
    let interiorBg = 0, interior = 0, inked = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const k = (y * cv.width + x) * 4; if (!same([ol[k], ol[k + 1], ol[k + 2]], [iso[k], iso[k + 1], iso[k + 2]], 12)) inked++; }
    for (let j = 1; j < NY - 1; j++) for (let i = 7; i < 9; i++) { interior++; if (same(at(ol, toDev(1000 + i * D + D / 2, 2000 + j * D + D / 2)), bg)) interiorBg++; }
    out.outline = { inked, interiorBg, interior, keptKept: cells.kept.filter((p) => same(at(ol, p), at(iso, p))).length };
    // software rendering: the outline draws as the tint
    R.setLightweight(true); await settle();
    const lw = shot(); out.lightweight = { tintLike: grade(lw, cells.out).filter((c) => same(c, tints[0])).length };
    R.setLightweight(false);
    V.setFilterShow(L, 'dim'); await settle();
    const dm = shot(); out.dim = { darker: cells.out.filter((p) => { const a = at(dm, p); return !same(a, bg, 12) && a[0] + a[1] + a[2] < 0.6 * 255 * 3; }).length };
    V.setFilterShow(L, 'ghost'); await settle();
    out.saved = V.displayStateOf(L);
    return out;
  });
  chk(`ghost: isolate shows the background where nothing matches (${r.isolate.outBg}/${r.isolate.n} columns)`, r.isolate.outBg === r.isolate.n);
  chk(`ghost: the left-out columns are ONE flat tint (${r.ghost.flat}/${r.ghost.n} alike, ${r.ghost.notBg} not background, rgb ${r.ghost.tint}); every kept pixel is isolate's — the kept block UNDER a left-out top ${r.ghost.underKept}/${r.ghost.nu}, the kept patch ${r.ghost.keptKept}/${r.ghost.nk} (${JSON.stringify(r.ghost.layerGhost)})`,
    r.ghost.flat === r.ghost.n && r.ghost.notBg === r.ghost.n && r.ghost.underKept === r.ghost.nu && r.ghost.keptKept === r.ghost.nk && r.ghost.layerGhost && r.ghost.layerGhost.style === 'tint');
  chk(`ghost outline: the envelope's interior stays background (${r.outline.interiorBg}/${r.outline.interior}), its boundary is inked (${r.outline.inked} px), the kept patch untouched (${r.outline.keptKept})`,
    r.outline.interiorBg === r.outline.interior && r.outline.inked > 50 && r.outline.keptKept === r.ghost.nk);
  chk(`ghost: software rendering draws the outline as the tint (${r.lightweight.tintLike}/${r.ghost.n}); dim darkens instead (${r.dim.darker} columns); saved as ${JSON.stringify(r.saved)}`,
    r.lightweight.tintLike === r.ghost.n && r.dim.darker > r.ghost.n / 2 && r.saved && r.saved.filterShow === 'ghost');
  await pg.close();
}

// ── §140: DRILLHOLE LOG TRACKS (src/logs.js · condenser gl-logs.js). The demo's holes, alone,
// seen side-on: an FE bar track on the RIGHT draws its colour right of the traces, moved LEFT it
// draws left of them (the screen's side, whichever way a hole runs); a filter thins the ribbons
// with the sticks; three tracks (bars left + right, a LITO class strip on the trace) resolve
// clear of each other; the decorations legend lists them; the display state saves and restores
// them; the window shows a row per track.
if (take()) {
  const pg = await mkPage('sm2logs');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro, V = window._microVis;
    await M.openDemoProject();
    M.closeAllWindows();
    for (const x of M.layers()) if (!(x.dh && x.docs.dhDoc && !x.trace)) x.visible = false;
    M.applyTreeVisibility();
    await W.setSection(null);
    const L = M.layers().find((x) => x.dh && x.docs.dhDoc && !x.trace);
    const frame = () => new Promise((z) => requestAnimationFrame(z));
    const settle = async () => { for (let k = 0; k < 300; k++) { M.requestRender(); await frame(); if (R.elementCount && R.accumulated === R.elementCount) break; } for (let k = 0; k < 4; k++) { M.requestRender(); await frame(); } };
    const b = R.contentBbox({ layers: [L.id] }), o = M.frame.origin;
    await W.setView({ target: [(b[0] + b[3]) / 2 + o[0], (b[1] + b[4]) / 2 + o[1], (b[2] + b[5]) / 2 + o[2]], look: 0, elevation: 0, distance: Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * 1.2, ortho: true });
    const cv = document.querySelector('#cv');
    const shot = () => { const c = new OffscreenCanvas(cv.width, cv.height), g = c.getContext('2d'); g.drawImage(cv, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const bg = R.background.slice(0, 3).map((v) => Math.round(v * 255));
    // each track pixel against the nearest interval midpoint on screen: right or left of its trace?
    const dh = L.docs.dhDoc, mids = [], feMid = [];
    const hh = M.layerTableHeader(L), fei = hh.columns.indexOf('FE');
    { const m = M.cam.state.viewProj;
      for (let i = 0; i < dh.header.count; i++) { const p = dh.recordPosition(i); if (!p) continue; const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
        const cx = m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12], cy = m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13], cw = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15];
        mids.push([(cx / cw + 1) / 2 * cv.width, (1 - cy / cw) / 2 * cv.height]);
        feMid.push(+(await M.fetchLayerRow(L, i))[fei]); } }
    let feMax = -Infinity; for (const v of feMid) if (v > feMax) feMax = v;
    const sideOf = (d, rgb) => {
      let right = 0, left = 0, n = 0, rich = 0;
      for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
        const k = (y * cv.width + x) * 4;
        if (Math.abs(d[k] - rgb[0]) + Math.abs(d[k + 1] - rgb[1]) + Math.abs(d[k + 2] - rgb[2]) >= 40) continue;
        n++;
        let best = null, bd = Infinity, bi = -1; for (let mi = 0; mi < mids.length; mi++) { const p = mids[mi]; const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (dd < bd) { bd = dd; best = p; bi = mi; } }
        if (best) { if (x > best[0]) right++; else left++; if (feMid[bi] > 50) rich++; }
      }
      return { right, left, n, rich };
    };
    const orange = [0xe8, 0x91, 0x3a];
    await V.setLogTracks(L, [{ col: 'FE', kind: 'bar', side: 'right', color: '#e8913a' }]);
    await settle();
    const out = { onRight: sideOf(shot(), orange) };
    await V.setLogTracks(L, [{ col: 'FE', kind: 'bar', side: 'left', color: '#e8913a' }]);
    await settle();
    out.onLeft = sideOf(shot(), orange);
    // a filter thins the ribbons with the sticks
    M.setActiveLayer(L.id);
    await M.applyBlockFilter('FE > 50', L);
    await settle();
    out.filtered = sideOf(shot(), orange);
    await M.applyBlockFilter('', L);
    // three tracks, resolved clear of each other
    const res = await V.setLogTracks(L, [{ col: 'FE', kind: 'bar', side: 'right' }, { col: 'SG', kind: 'bar', side: 'left', color: '#4aa3df' }, { col: 'LITO', kind: 'strip', side: 'center' }]);
    out.resolved = res.map((t) => ({ col: t.col, off: +t._offset.toFixed(2), w: +t._width.toFixed(2), lo: t._lo, hi: +t._hi.toFixed(2), classes: t._dict ? t._dict.length - 1 : null }));
    out.feMax = +feMax.toFixed(2);
    out.reach = R.layerLogs(L.id);
    L.legend = true; M.drawDecorations();
    out.legend = V.logLegendRows(L).map((x) => x.col);
    const saved = V.displayStateOf(L);
    await V.setLogTracks(L, []);
    out.cleared = R.layerLogs(L.id);
    await V.restoreDisplayState(L, JSON.parse(JSON.stringify(saved)));
    out.restored = V.logTracksOf(L).map((t) => `${t.col}:${t.kind}:${t.side}`);
    const w = V.openLogsWindow(L); out.rows = w.el.querySelectorAll('[data-track]').length; w.close();
    return out;
  });
  chk(`logs: a RIGHT bar track draws right of the traces (${r.onRight.right} right / ${r.onRight.left} left of ${r.onRight.n} px), a LEFT one left of them (${r.onLeft.right} / ${r.onLeft.left})`,
    r.onRight.n > 100 && r.onRight.right > 0.9 * (r.onRight.right + r.onRight.left) && r.onLeft.left > 0.9 * (r.onLeft.right + r.onLeft.left));
  chk(`logs: a filter thins the ribbons with the sticks (${r.filtered.n} px of ${r.onLeft.n})`, r.filtered.n > 0 && r.filtered.n < 0.8 * r.onLeft.n);
  // WHICH ribbons stay (sweep 2026-11-25: "fewer pixels" passed with the wrong ones kept). Each bar
  // pixel is tagged by its nearest interval midpoint on screen — side-on, a fan's holes nearly overlap,
  // so a pixel can be tagged with a neighbour's grade; hence the ratios: the FE > 50 intervals' pixels
  // ALL stay, the others' mostly go
  const poor0 = r.onLeft.n - r.onLeft.rich, poor1 = r.filtered.n - r.filtered.rich;
  chk(`logs: …and the ribbons that stay are the FE > 50 intervals' (beside FE > 50: ${r.onLeft.rich} → ${r.filtered.rich} px kept; beside the rest: ${poor0} → ${poor1})`, r.onLeft.rich > 100 && r.filtered.rich >= 0.97 * r.onLeft.rich && poor1 <= 0.2 * poor0);
  chk(`logs: the FE track's scale runs to the data's largest FE (${r.resolved[0] && r.resolved[0].hi} = ${r.feMax})`, r.resolved[0] && r.resolved[0].col === 'FE' && Math.abs(r.resolved[0].hi - r.feMax) < 0.01);
  chk(`logs: three tracks resolve clear of each other (${JSON.stringify(r.resolved)}, reach ${JSON.stringify(r.reach)})`,
    r.resolved.length === 3 && r.resolved[2].off === 0 && r.resolved[0].off >= r.resolved[2].w / 2 && r.resolved[1].off >= r.resolved[2].w / 2 && r.resolved[2].classes > 1 && r.reach && r.reach.reach > r.resolved[0].off);
  chk(`logs: the legend lists them (${r.legend.join(', ')}); cleared ${JSON.stringify(r.cleared)} → restored from the display state (${r.restored.join(' · ')}); the window has ${r.rows} rows`,
    r.legend.join() === 'FE,SG,LITO' && r.cleared === null && r.restored.join() === 'FE:bar:right,SG:bar:left,LITO:strip:center' && r.rows === 3);
  await pg.close();
}

// ── §141: BLOCK OUTLINES on vector sections (src/vsection.js · @gcu/compo world.js). A sub-blocked
// model on a plan section: none = merged colour regions; sub-blocks = one cell per block cut,
// each stroked in ink; parents = fills merged within each parent, every parent the plane cuts
// stroked once (12 on a 4 × 3 parent plan). Its ROTATED .dm twin on the same plan gives the same
// parent count (the lattice path); an oblique plane on the twin outlines the parent boxes it cuts
// (= the brute-force count). The drawer inks exactly those rings. The setting is the default.
if (take()) {
  const pg = await mkPage('sm2vout');
  const r = await pg.evaluate(async () => {
    const M = window._micro, V = window._microVis;
    const F = await import('/test/subblock-make.mjs'), Wd = await import('/ext/compo/src/world.js');
    const { rows } = F.makeSubblockRows({ seed: 9, nx: 4, ny: 3, nz: 3 });
    const twin = await M.openBlob(new Blob([F.makeSubblockCsv(rows)]), 'vout.csv', 'replace', null, { throw: true });
    const LT = M.layers().find((x) => x.id === twin);
    M.setLayerColorSel(LT, M.colorSelFor(LT, 'V'));
    const z = 15.25;                                          // through the middle parent level (10–20), off any sub-block face
    const sec = { mode: 'plan', normal: [0, 0, 1], position: z, thickness: 0 };
    const cutBlocks = rows.filter((rw) => rw.ZC - rw.ZINC / 2 <= z && z < rw.ZC + rw.ZINC / 2).length;
    const out = { cutBlocks };
    const none = await V.sectionCells(LT, sec, { outlines: 'none' });
    const sub = await V.sectionCells(LT, sec, { outlines: 'sub-blocks' });
    const par = await V.sectionCells(LT, sec, { outlines: 'parents' });
    out.v1 = { none: none.colors.length, noneOutline: !!none.outline, sub: sub.colors.length, subMode: sub.outline && sub.outline.mode, par: par.colors.length, parRects: par.outline && par.outline.rects.length / 4, blocks: sub.blocks };
    // the parent rects tile the 4 × 3 plan of 20 m parents
    out.parArea = par.outline.rects.reduce((a, _, i, R) => (i % 4 ? a : a + (R[i + 2] - R[i]) * (R[i + 3] - R[i + 1])), 0);
    // the drawer: a recording context counts the ink rings
    const rec = () => { const c = { strokes: [], strokeStyle: '', fillStyle: '', lineWidth: 1 }; for (const k of ['save', 'restore', 'beginPath', 'rect', 'clip', 'fillRect', 'moveTo', 'lineTo', 'closePath', 'fill', 'drawImage', 'setLineDash']) c[k] = () => {}; c.stroke = () => c.strokes.push(c.strokeStyle); return c; };
    const frameFor = (Ly) => ({ box: [0, 0, 100, 100], content: { meta: { proj: { m: [1 / 60, 0, 0, 0, 0, 1 / 60, 0, 0, 0, 0, 0, 0, -40 / 60, -30 / 60, 0, 1], origin: [0, 0, 0] } }, vector: { layers: [Ly] }, fit: 'fill' } });
    const inkOf = (lay) => { const c = rec(); Wd.drawVector(c, frameFor(lay), 0, 0, 100, 100); return c.strokes.filter((s) => s === '#1a1a1a').length; };
    const asLayer = (c) => ({ type: 'cells', axis: { w: 2, u: 0, v: 1 }, position: z, rects: c.rects, colors: c.colors, palette: c.palette, outline: c.outline });
    out.ink = { none: inkOf(asLayer(none)), sub: inkOf(asLayer(sub)), par: inkOf(asLayer(par)) };
    // the rotated .dm twin, the same plan: the lattice path
    const rot = await M.openBlob(new Blob([F.makeSubblockDm(rows, { angle1: -50 })]), 'vout.dm', 'add', null, { throw: true, origin: [1000, 2000, 300] });
    const LR = M.layers().find((x) => x.id === rot);
    M.setLayerColorSel(LR, M.colorSelFor(LR, 'V'));
    const rpar = await V.sectionShapes(LR, { normal: [0, 0, 1], position: 300 + z, thickness: 0 }, [1000, 2000, 300], { outlines: 'parents' });
    out.rot = { type: rpar.type, parents: rpar.outline && rpar.outline.rects ? rpar.outline.rects.length / 4 : null, ink: inkOf(rpar) };
    // an oblique plane on the twin: the parent boxes it cuts
    const n = [0.3, 0.2, 1], nl = Math.hypot(...n), nu = n.map((x) => x / nl), pos = nu[0] * 40 + nu[1] * 30 + nu[2] * 15;
    const obl = await V.sectionShapes(LT, { normal: nu, position: pos, thickness: 0 }, [40, 30, 15], { outlines: 'parents' });
    let want = 0;
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
      let lo = Infinity, hi = -Infinity;
      for (const cx of [i * 20, i * 20 + 20]) for (const cy of [j * 20, j * 20 + 20]) for (const cz of [k * 10, k * 10 + 10]) { const d = nu[0] * cx + nu[1] * cy + nu[2] * cz - pos; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      if (lo < 0 && hi > 0) want++;
    }
    out.oblique = { type: obl.type, parents: obl.outline && obl.outline.starts ? obl.outline.starts.length : null, want };
    const osub = await V.sectionShapes(LT, { normal: nu, position: pos, thickness: 0 }, [40, 30, 15], { outlines: 'sub-blocks' });
    out.obliqueSub = { polys: osub.colors.length, ink: inkOf(osub) };
    // the setting is the default
    const was = V.vectorOutlines(); V.setVectorOutlines('sub-blocks');
    const dflt = await V.sectionCells(LT, sec);
    V.setVectorOutlines(was);
    out.dflt = dflt.outline && dflt.outline.mode;
    // THROUGH THE COMPOSER: a plan view frame on the twin (the v1 cells path) made a vector section, its
    // outline mode cycled from the frame menu to "parents" — the layer it draws carries the outline
    M.layers().forEach((x) => { if (x.id !== LT.id) M.renderer.setLayerVisible(x.id, false); });
    await window.micro.setSection({ axis: 'z', position: z, thickness: 0.5, clip: 'slab' });
    await window.micro.setView({ look: 0, elevation: 90, ortho: true });
    const ed = M.openComposer('vout'), vf = M.addViewFrame(ed);
    const run = async (re) => { const it = M.composerFrameMenu(ed.getDoc().frames.find((x) => x.id === vf.id), ed).find((x) => re.test(x.label)); await it.run(); };
    await run(/^Vector section \(/);
    for (let k = 0; k < 3; k++) await run(/^Vector outlines/);   // default → none → sub-blocks → parents
    const fr = ed.getDoc().frames.find((x) => x.id === vf.id), lay = fr.content.vector && fr.content.vector.layers.find((l) => l.type === 'cells');
    out.composer = { mode: fr.content.vectorOutlines, layerType: lay && lay.type, outline: lay && lay.outline && lay.outline.mode, parents: lay && lay.outline && lay.outline.rects ? lay.outline.rects.length / 4 : null, err: fr.content.vectorError || null };
    return out;
  });
  chk(`vector outlines (sub-blocked plan): none merges (${r.v1.none} regions, no outline ${!r.v1.noneOutline}); sub-blocks keeps every one of ${r.v1.blocks} cuts (${r.v1.sub}, ${r.v1.subMode}); parents merges within parents (${r.v1.par} cells) and lists ${r.v1.parRects} parents tiling ${r.parArea} m² (of 4 × 3 × 400)`,
    !r.v1.noneOutline && r.v1.none < r.v1.blocks && r.v1.sub === r.v1.blocks && r.v1.blocks === r.cutBlocks && r.v1.subMode === 'sub-blocks' && r.v1.parRects === 12 && Math.abs(r.parArea - 4800) < 1e-6 && r.v1.par <= r.v1.blocks && r.v1.par >= 12);
  chk(`vector outlines: the drawer inks exactly those rings (none ${r.ink.none}, sub-blocks ${r.ink.sub}, parents ${r.ink.par})`, r.ink.none === 0 && r.ink.sub === r.v1.sub && r.ink.par === 12);
  chk(`vector outlines: the ROTATED .dm twin's plan lists the same 12 parents (${JSON.stringify(r.rot)}); an oblique cut outlines the ${r.oblique.want} parent boxes it crosses (${JSON.stringify(r.oblique)}); sub-blocks inks each polygon (${r.obliqueSub.ink} of ${r.obliqueSub.polys}); the setting is the default (${r.dflt})`,
    r.rot.type === 'cells' && r.rot.parents === 12 && r.rot.ink === 12 && r.oblique.type === 'polys' && r.oblique.parents === r.oblique.want && r.obliqueSub.ink === r.obliqueSub.polys && r.dflt === 'sub-blocks');
  chk(`vector outlines THROUGH THE COMPOSER: a plan view frame's own mode (cycled from its menu) reaches the cells it draws (${JSON.stringify(r.composer)})`,
    r.composer.mode === 'parents' && r.composer.layerType === 'cells' && r.composer.outline === 'parents' && r.composer.parents === 12 && !r.composer.err);
  await pg.close();
}

// ── §142: AMBIENT OCCLUSION (condenser edl.js · Settings → display). A floor of blocks with a
// wall standing on half of it, one colour, seen obliquely: with occlusion on, the pixels along
// the foot of the wall (an inner corner) darken clearly, a stretch of open floor and the wall's
// own face hardly change. Off under a projection and in software rendering; off is the default.
if (take()) {
  const pg = await mkPage('sm2ao');
  const r = await pg.evaluate(async () => {
    const M = window._micro, R = M.renderer, W = window.micro, V = window._microVis;
    const N = 24, D = 10;
    let csv = 'XC,YC,ZC,V\n';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      csv += `${i * D + D / 2},${j * D + D / 2},${D / 2},1\n`;
      if (i >= N / 2) for (let k = 1; k < 6; k++) csv += `${i * D + D / 2},${j * D + D / 2},${k * D + D / 2},1\n`;
    }
    const id = await M.openBlob(new Blob([csv]), 'ao.csv', 'replace', null, { throw: true });
    const L = M.layers().find((x) => x.id === id);
    M.setLayerColorSel(L, 'solid');
    const frame = () => new Promise((z) => requestAnimationFrame(z));
    const settle = async () => { for (let k = 0; k < 300; k++) { M.requestRender(); await frame(); if (R.elementCount && R.accumulated === R.elementCount) break; } for (let k = 0; k < 4; k++) { M.requestRender(); await frame(); } };
    const o = M.frame.origin;
    await W.setView({ target: [N * D / 2, N * D / 2, 20], look: 90, elevation: 35, distance: 380, ortho: false });   // world coordinates
    const cv = document.querySelector('#cv');
    const px = (w) => {
      const p = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], m = M.cam.state.viewProj;
      const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [Math.round((cx / cw + 1) / 2 * cv.width), Math.round((1 - cy / cw) / 2 * cv.height)];
    };
    const shot = () => { const c = new OffscreenCanvas(cv.width, cv.height), g = c.getContext('2d'); g.drawImage(cv, 0, 0); return g.getImageData(0, 0, cv.width, cv.height).data; };
    const lum = (d, [x, y]) => { const k = (y * cv.width + x) * 4; return d[k] + d[k + 1] + d[k + 2]; };
    // sample points along y: the crease (floor just before the wall), open floor, the wall's face
    const ys = [60, 90, 120, 150, 180];
    const crease = ys.map((y) => px([N * D / 2 - 1.5, y, D])), floor = ys.map((y) => px([N * D / 2 - 70, y, D])), wall = ys.map((y) => px([N * D / 2, y, 35]));
    const mean = (d, pts) => pts.reduce((a, p) => a + lum(d, p), 0) / pts.length;
    V.setAmbientOcclusion('off'); await settle();
    const off = shot();
    V.setAmbientOcclusion('1'); await settle();
    const on = shot();
    const out = { crease: [mean(off, crease), mean(on, crease)], floor: [mean(off, floor), mean(on, floor)], wall: [mean(off, wall), mean(on, wall)] };
    // under a projection there is no depth to shade: the picture is the projection's alone (colour by V, a value)
    M.setLayerColorSel(L, M.colorSelFor(L, 'V'));
    V.setAmbientOcclusion('off'); M.setProjection('max'); await settle(); const pjOff = shot();
    V.setAmbientOcclusion('1'); await settle(); const pj = shot(); M.setProjection(null);
    out.projection = [mean(pjOff, crease), mean(pj, crease)];
    V.setAmbientOcclusion('off');
    out.level = V.ambientOcclusion();
    return out;
  });
  const d = (a) => (a[0] - a[1]) / Math.max(1, a[0]);
  chk(`ambient occlusion: the foot of the wall darkens ${(100 * d(r.crease)).toFixed(0)}% (${r.crease.map((v) => v.toFixed(0)).join(' → ')}); open floor ${(100 * d(r.floor)).toFixed(1)}%, the wall's face ${(100 * d(r.wall)).toFixed(1)}%`,
    d(r.crease) > 0.15 && Math.abs(d(r.floor)) < 0.03 && Math.abs(d(r.wall)) < 0.05);
  chk(`ambient occlusion: none under a projection (${r.projection.map((v) => v.toFixed(0)).join(' = ')}); back off (${r.level})`, Math.abs(r.projection[0] - r.projection[1]) < 1 && r.level === 'off');
  await pg.close();
}

// ── the LAYER CONTEXT MENU, regrouped (src/layermenu.js layerMenuSections). It had
// grown to ~33 top-level entries on a block model; now the frequent verbs sit on top
// and the rest in Analyse · Geometry · Select · Views · Display · Data & file · Move.
// For a block model, a drillhole layer, a mesh and a grid (the demo's): the top level
// stays short (≤ 14 entries, only the known ones), every submenu has something in it,
// and every item the flat menu had for that layer is still reachable in some submenu —
// so an item can't silently vanish in a later edit. Then the real thing: a right-click
// on the row opens the menu and hovering Analyse opens its submenu.
if (take()) {
  const pg = await mkPage('sm2ctx');
  const r = await pg.evaluate(async () => {
    const M = window._micro;
    await M.openDemoProject();
    const Ls = M.layers();
    const block = Ls.find((L) => L.name === 'deposit.csv');
    const dh = Ls.find((L) => L.dh && L.docs.dhDoc && !L.trace);
    const mesh = Ls.find((L) => L.label === 'ore shell');
    const grid = Ls.find((L) => L.docs && L.docs.gridDoc);
    await M.applyBlockFilter('FE > 50', block);            // → Select ▸ Filter → selection
    const walk = (L) => {
      const items = M.layerMenuSections(L, 100, 100);
      const top = items.filter((x) => !x.sep);
      const found = [];                                     // every label reachable: top level + one submenu down
      const empty = [];
      for (const it of top) {
        found.push(it.label);
        if (it.submenu) { const sub = it.submenu(); if (!sub.length) empty.push(it.label); for (const s of sub) if (!s.sep) found.push(s.label); }
      }
      return { top: top.map((x) => x.label), found, empty, lineage: !!L.lineage, records: M.hasRecords(L) };
    };
    return { block: walk(block), dh: walk(dh), mesh: walk(mesh), grid: walk(grid), names: [block, dh, mesh, grid].map((L) => L && (L.label || L.name)) };
  });
  const CTX_TOP = ['Zoom to layer', 'Rename layer…', 'Hide layer', 'Show layer', 'Properties…', 'Attribute table…', 'Filter…',
    'Analyse', 'Geometry', 'Select', 'Views', 'Display', 'Data & file', 'Move', 'Remove layer'];
  // what the flat menu offered each of these layers (labels by prefix: some carry a live part)
  const common = ['Zoom to layer', 'Rename layer…', /^(Hide|Show) layer$/, 'Properties…', 'Cut by sections', 'Style', 'Move', 'Remove layer', 'File info…'];
  const EXPECT = {
    block: [...common, 'Attribute table…', 'Filter…', 'Stats…', 'Scatter / Q-Q…', 'Grade-tonnage…', 'Resource cross-tab…', 'Swath plot…', 'Grade shell…',
      'Block vs sample…', 'Distance to a surface…', 'Reconciliation factors…', 'Model QA…', 'Filter → selection', 'New view of this layer', 'New view beside it',
      'Opacity', 'Block edges', 'Reinterpret as…', 'Store as Parquet…', 'Build index (stats + pushdown)…', 'Export rows…'],
    dh: [...common, 'Attribute table…', 'Filter…', 'Stats…', 'Scatter / Q-Q…', 'Grade-tonnage…', 'Contact plot…', 'Distance to a surface…', 'Composite…',
      'Opacity', 'Stick radius…', 'Export rows…'],
    mesh: [...common, 'Select by this solid…', 'Rasterize to grid…', 'Extend to footprint…', 'Combine surfaces…', 'Mesh QA / volume…', 'Structural analysis…',
      'Tint…', 'Opacity', 'Convert to streamed', 'Export mesh…'],
    grid: [...common, 'Flag / ratio by this surface…', 'Extend to footprint…', 'Combine surfaces…', 'Drape', 'Reinterpret as…', 'Export grid…'],
  };
  const has = (found, e) => found.some((l) => (e instanceof RegExp ? e.test(l) : l === e || l.startsWith(e + ' ') || l.startsWith(e + ':')));
  for (const k of ['block', 'dh', 'mesh', 'grid']) {
    const m = r[k];
    const want = [...EXPECT[k], ...(m.lineage ? ['Lineage…'] : [])];
    const missing = want.filter((e) => !has(m.found, e));
    const stray = m.top.filter((l) => !CTX_TOP.includes(l));
    chk(`layer menu (${k}: ${r.names[['block', 'dh', 'mesh', 'grid'].indexOf(k)]}): ${m.top.length} top-level entries (${m.top.join(' · ')}); ${m.found.length - m.top.length} in submenus; missing ${missing.length ? missing.join(', ') : 'none'}${m.empty.length ? `; EMPTY submenus ${m.empty.join(', ')}` : ''}${stray.length ? `; unknown top-level ${stray.join(', ')}` : ''}`,
      m.top.length <= 14 && !missing.length && !m.empty.length && !stray.length);
  }
  // the real menu: right-click the row, hover Analyse → its submenu
  const dom = await pg.evaluate(async () => {
    const M = window._micro; M.toggleLayersPanel(true);
    const row = [...document.querySelectorAll('#lpRows .lp-row')].find((x) => /^deposit\.csv/.test(x.textContent.trim()));
    const b = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 60, clientY: b.top + 8 }));
    await new Promise((z) => setTimeout(z, 200));
    const root = [...document.querySelectorAll('.menu .item')].map((d) => d.textContent);
    const an = [...document.querySelectorAll('.menu .item')].find((d) => /^Analyse/.test(d.textContent));
    an.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((z) => setTimeout(z, 200));
    const menus = document.querySelectorAll('.menu');
    const sub = menus.length > 1 ? [...menus[1].querySelectorAll('.item')].map((d) => d.textContent) : [];
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    for (const m of document.querySelectorAll('.menu')) m.remove();
    return { root: root.length, menus: menus.length, sub };
  });
  chk(`layer menu: a right-click opens ${dom.root} entries; hovering Analyse opens its submenu (${dom.sub.length} items: ${dom.sub.slice(0, 4).join(' · ')}…)`,
    dom.root <= 14 && dom.menus === 2 && dom.sub.some((t) => /^Grade-tonnage/.test(t)));
  await pg.close();
}

// ── SITE C (src/samples.js openSiteC · src/site-c.js): the sample the manual's cover is drawn from.
// It builds blocks by rock in the map's own palette (no regolith lid: the top blocks are bedrock), the
// three drill fences, the topography; it opens cut across the fold through the middle fence, seen from
// the SW; and the model micro opened is the cover's: a block's rock and grade are site-c.js's at that
// block's centre, and a hole's assay sits in the rock the model puts there.
if (take()) {
  const pg = await mkPage('sm2sitec');
  const r = await pg.evaluate(async () => {
    const M = window._micro, SC = await import(new URL('src/site-c.js', location.href.replace(/[^/]*$/, '')).href).catch(() => null);
    await M.openSiteC();
    const Ls = M.layers(), bm = Ls.find((L) => L.kind === 'blocks'), dh = Ls.find((L) => L.dh && L.docs.dhDoc && !L.trace);
    const topo = Ls.find((L) => L.label === 'topography');
    const h = M.layerTableHeader(bm), iu = h.columns.indexOf('UNIT'), ia = h.columns.indexOf('AU');
    const units = new Set(), rows = [];
    for (let i = 0; i < bm.docs.blockDoc.header.count; i += 997) { const row = await M.fetchLayerRow(bm, i); units.add(row[iu]); rows.push(row); }
    // the block model IS site-c.js: rock and grade at sampled block centres (dev tree only: the built page has no src/)
    let agree = null;
    if (SC) { agree = 0; for (const row of rows) { const x = row[0] - SC.ORIGIN.E, y = row[1] - SC.ORIGIN.N, z = +row[2]; let u = SC.lith(x, y, z); if (u === 1) u = SC.lithT(x, y, z - 12, SC.topo(x, y)); if (SC.UNITS[u].short === row[iu] && Math.abs(SC.gradeU(x, y, z, u) - row[ia]) < 0.002) agree++; } }
    const sec = M.currentSection(), th = M.cam.state.theta, look = ((Math.atan2(-Math.cos(th), -Math.sin(th)) * 180 / Math.PI) % 360 + 360) % 360;   // as viewport.js cameraWorld
    return { blocks: bm && bm.docs.blockDoc.header.count, colorSel: bm && bm.colorSel, legend: bm && bm.catLegend && bm.catLegend.entries.length, units: [...units],
      holes: dh && dh.docs.dhDoc.holes ? dh.docs.dhDoc.holes.length : null, intervals: dh && dh.docs.dhDoc.header.count, topo: !!topo && topo.kind,
      secOn: sec && sec.on, secN: sec && sec.n, look, sampled: rows.length, agree };
  });
  chk(`Site C: ${r.blocks} blocks by rock (${r.colorSel}, a ${r.legend}-entry legend), ${r.units.length} units at the sampled blocks and no regolith lid`,
    r.blocks > 200000 && r.colorSel === 'cat' && r.legend === 9 && r.units.includes('BIF') && r.units.includes('GRANITE') && !r.units.includes('REGOLITH'));
  chk(`Site C: the drill fences (${r.intervals} intervals) and the topography (${r.topo}) land beside the blocks`, r.intervals > 4000 && r.topo === 'mesh');
  chk(`Site C opens cut across the fold (normal ${r.secN && r.secN.map((v) => v.toFixed(2)).join(', ')}) and looks up the plunge (toward ${Math.round(r.look)}°)`,
    r.secOn && r.secN && Math.abs(r.secN[0] + Math.sin(40 * Math.PI / 180)) < 1e-6 && Math.abs(r.secN[1] + Math.cos(40 * Math.PI / 180)) < 1e-6 && Math.abs(r.look - 40) < 1);
  if (r.agree != null) chk(`Site C's blocks are site-c.js: ${r.agree} of ${r.sampled} sampled block centres carry the model's rock and grade`, r.agree === r.sampled);
  // its pages come composed (src/site-c-figures.js): the map at 1 : 5 000 on A3, the three sections at 1 : 10 000
  // as vector sections with a key plan — built while the sample opens, the 3D view put back after (the checks
  // above ran after it), the composer closed again; made again by name, never twice; and the Figures window
  // (QGIS's layout manager) lists them, duplicates one and deletes the copy
  const f = await pg.evaluate(async () => {
    const M = window._micro, figs = () => M.figures();
    const views = (doc) => doc.frames.filter((x) => x.source && x.source.kind === 'view' && !x.source.keyFor);
    const kinds = (doc) => doc.frames.map((x) => x.kind);
    const map = figs().find((x) => x.name === 'Site C — geological map'), sec = figs().find((x) => x.name === 'Site C — sections A–A′, B–B′, C–C′');
    const out = { names: figs().map((x) => x.name), composerOpen: !!document.querySelector('.composer-win') };
    if (map) { const v = views(map.doc); out.map = { page: `${map.doc.page.size} ${map.doc.page.orientation}`, views: v.length, lock: v[0] && v[0].content.scaleLock, img: !!(v[0] && v[0].content.width > 100), kinds: kinds(map.doc) }; }
    if (sec) {
      const v = views(sec.doc), kp = sec.doc.frames.find((x) => x.source && x.source.keyFor);
      out.sec = { page: `${sec.doc.page.size} ${sec.doc.page.orientation}`, views: v.length, locks: v.map((x) => x.content.scaleLock), vector: v.map((x) => { const ls = (x.content.vector && x.content.vector.layers) || []; return ls.some((l) => l.blocks > 0) && ls.some((l) => l.type === 'lines' && l.starts.length > 0); }),
        errs: v.map((x) => x.content.vectorError || '').filter(Boolean), keys: kp ? [].concat(kp.source.keyFor).length : 0, kinds: kinds(sec.doc),
        normals: v.map((x) => x.source.scene.section && x.source.scene.section.dipDir) };
    }
    // a refresh redraws them as made: the holes stay cut (the scene remembers it; the 3D view shows them whole)
    const dhL = M.layers().find((L) => L.dh && L.docs.dhDoc && !L.trace);
    out.viewWhole = dhL ? M.renderer.layerSectioned(dhL.id) === false : null;   // the sample's 3D view: holes whole across the cut, as before the figures
    if (dhL) M.renderer.setLayerSectioned(dhL.id, false);                // (and so for the refresh, whatever the build left)
    if (sec) { await M.refreshViews(sec); out.sec.afterRefresh = views(sec.doc).map((x) => { const ls = (x.content.vector && x.content.vector.layers) || []; return ls.some((l) => l.blocks > 0) && ls.some((l) => l.type === 'lines' && l.starts.length > 0); }); }
    // the manager: a row per figure; duplicate → an independent copy; delete it again
    M.openFiguresManager(); await new Promise((z) => setTimeout(z, 100));
    out.rows = [...document.querySelectorAll('.cmp-figures .cmp-fig-row')].map((x) => x.dataset.name);
    const c = map && M.duplicateFigure(map, 'map copy');
    out.copy = c ? { frames: c.doc.frames.length === map.doc.frames.length, apart: c.doc !== map.doc && c.doc.frames[0] !== map.doc.frames[0], title: c.doc.title, img: !!views(c.doc)[0]?.content?.width } : null;
    if (c) { c.doc.frames.pop(); out.copy.origKept = map.doc.frames.length !== c.doc.frames.length; await M.deleteFigure(c, { ask: false }); }
    out.afterDelete = figs().length;
    document.querySelector('.cmp-figures .fwin-close, .cmp-figures [title=close]')?.click();
    // open the sample again: the figures are made again, not doubled
    await M.openSiteC();
    out.again = figs().filter((x) => /^Site C — /.test(x.name)).length;
    return out;
  });
  chk(`Site C comes with its figures (${JSON.stringify(f.names)}), the composer closed again (${!f.composerOpen})`, f.names.includes('Site C — geological map') && f.names.includes('Site C — sections A–A′, B–B′, C–C′') && !f.composerOpen);
  chk(`Site C map: ${f.map && f.map.page}, one view locked at 1 : ${f.map && f.map.lock} (rendered: ${f.map && f.map.img}), with ${f.map && f.map.kinds.join(', ')}`,
    f.map && f.map.page === 'A3 landscape' && f.map.views === 1 && f.map.lock === 5000 && f.map.img && ['legend', 'scalebar', 'north', 'titleblock'].every((k) => f.map.kinds.includes(k)));
  chk(`Site C sections: ${f.sec && f.sec.page}, ${f.sec && f.sec.views} views at 1 : ${f.sec && f.sec.locks.join(', ')}, blocks + holes as vectors ${f.sec && JSON.stringify(f.sec.vector)}, after a refresh ${f.sec && JSON.stringify(f.sec.afterRefresh)} (the 3D view keeps its holes whole: ${f.viewWhole})${f.sec && f.sec.errs.length ? ` (${f.sec.errs.join('; ')})` : ''}, cut at dip direction ${f.sec && f.sec.normals.join('/')}, a key plan of ${f.sec && f.sec.keys}`,
    f.sec && f.sec.page === 'A4 portrait' && f.sec.views === 3 && f.sec.locks.every((x) => x === 10000) && f.sec.vector.every(Boolean) && f.sec.afterRefresh.every(Boolean) && f.viewWhole === true && f.sec.normals.every((x) => x === 40) && f.sec.keys === 3 && f.sec.kinds.includes('legend') && f.sec.kinds.includes('titleblock'));
  chk(`Figures window lists ${JSON.stringify(f.rows)}; Duplicate makes an independent copy (${JSON.stringify(f.copy)}), deleted again (${f.afterDelete} left); opening Site C again makes its figures again, not twice (${f.again})`,
    f.rows.length === f.names.length && f.copy && f.copy.frames && f.copy.apart && f.copy.title === 'map copy' && f.copy.img && f.copy.origKept && f.afterDelete === f.names.length && f.again === 2);
  await pg.close();
}

// ── COLOURING BY ELEVATION gets the histogram (props-style.js; Arthur 2026-11-26: "a bug for every layer"):
// it returned before the histogram, which only channels / ratios / calc columns had. Now elevation is the
// layer's z column (blocks: scan it), or, with no z column, its positions (drillholes by their desurvey) or
// its node values (a grid) — the same histogram, breaks and quantiles. A heightfield SURFACE colours in
// surfaces.js and has no ramp section (the grid "elevation from" work).
if (take()) {
  const pg = await mkPage('sm2elevhist');
  const r = await pg.evaluate(async () => {
    const M = window._micro, out = {};
    await M.openSiteC();
    const rows = []; for (let rr = 0; rr < 20; rr++) { const row = []; for (let c = 0; c < 30; c++) row.push((100 + c * 2 + (19 - rr)).toFixed(1)); rows.push(row.join(' ')); }
    const asc = ['ncols 30', 'nrows 20', 'xllcorner 612000', 'yllcorner 7784000', 'cellsize 20', 'NODATA_value -9999', ...rows, ''].join(String.fromCharCode(10));
    await M.openBlob(new Blob([asc]), 'plain-grid.asc', 'add');
    (await M.mod('props.js')).setPropTab('style');
    for (const L of M.layers()) {
      if (L.gridSurface) continue;
      M.setActiveLayer(L.id); M.setLayerColorSel(L, 'elev'); M.openProps();
      await new Promise((z) => setTimeout(z, 150));
      const btn = document.querySelector('#ppBody .pp-scan');
      const label = btn ? btn.textContent : null;
      if (btn) { btn.click(); for (let i = 0; i < 80 && !document.querySelector('#ppBody .pp-hist'); i++) await new Promise((z) => setTimeout(z, 150)); }
      const c = document.querySelector('#ppBody .pp-hist');
      let bars = 0;
      if (c) { const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let x = 4; x < c.width; x += 10) { for (let y = c.height - 2; y > 14; y--) if (g[(y * c.width + x) * 4 + 3] > 0) { bars++; break; } } }
      out[L.kind === 'blocks' ? 'blocks' : L.dh ? 'drillholes' : /plain-grid/.test(L.name) ? 'grid' : L.name] = { colorSel: L.colorSel, label, hist: !!c, bars };
    }
    return out;
  });
  chk(`colouring by elevation gets a histogram: blocks by scanning their z column (${JSON.stringify(r.blocks)}), drillholes from their desurveyed positions (${JSON.stringify(r.drillholes)}), a grid from its nodes (${JSON.stringify(r.grid)})`,
    r.blocks && r.blocks.colorSel === 'elev' && /scan ZC/.test(r.blocks.label) && r.blocks.bars > 20
    && r.drillholes && /read the elevations/.test(r.drillholes.label) && r.drillholes.bars > 10
    && r.grid && /read the elevations/.test(r.grid.label) && r.grid.bars >= 3);
  await pg.close();
}

console.log((ok ? '\nMICRO SMOKE 2: PASS' : '\nMICRO SMOKE 2: FAIL') + (SHARD ? ` (${_ran} of ${_section} sections)` : ''));
await b.close(); server.close();
process.exit(ok ? 0 : 1);
