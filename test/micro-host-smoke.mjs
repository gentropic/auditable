// micro smoke — the HOST contract: a page driving micro through window._micro.
//   C  openBlob resolves to the layer id (null on failure) + micro:layer-added /
//      micro:layer-failed events; over.throw rejects instead
//   A  addLayer(spec): typed columns + stated roles for blocks / points / mesh /
//      drillholes / table; a DECLARED lattice is checked against the data
//   B  the ingested layer behaves like a file-backed one (pick, filter, export,
//      category order kept)
//   §2 Parquet sub-blocks (DX/DY/DZ), and the micro:model contract for foreign
//      producers (dims by name, a palette; an old flag-only model is rebuilt)
//   D  quoted CSV (delimiters, line breaks and doubled quotes inside fields)
// Run with `npm run test:micro:host`. Dev tree, then the BUILT micro.html.
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  // a bare HOST page (micro's own CSP forbids frames, so it can't host itself)
  if (req.url === '/__host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>host</title><body></body>'); return; }
  try { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const b = await chromium.launch({ args: ['--use-gl=angle'] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 750 } });
let ok = true; const chk = (n, c) => { console.log(`${c ? 'ok ' : 'FAIL'} ${n}`); ok = ok && c; };

async function run(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  console.log(`── ${label}`);

  // ── C: success / failure reach the caller ──
  const c = await p.evaluate(async () => {
    const m = window._micro, ev = [];
    addEventListener('micro:layer-added', (e) => ev.push(['added', e.detail.name]));
    addEventListener('micro:layer-failed', (e) => ev.push(['failed', e.detail.name]));
    const csv = 'XC,YC,ZC,AU\n5,5,5,1\n15,5,5,2\n5,15,5,3\n15,15,5,4\n';
    const id = await m.openBlob(new Blob([csv]), 'c1.csv', 'add');
    const bad = await m.openBlob(new Blob(['no']), 'c2.weird', 'add');
    let threw = null;
    try { await m.openBlob(new Blob(['no']), 'c3.weird', 'add', null, { throw: true }); } catch (e) { threw = e.message; }
    return { id, bad, threw, ev, n: m.layers().length };
  });
  chk(`C openBlob resolves the layer id (${c.id}), null on failure, rejects with over.throw`, Number.isInteger(c.id) && c.bad === null && /doesn’t read/.test(c.threw || ''));
  chk(`C events: ${JSON.stringify(c.ev)}`, JSON.stringify(c.ev) === JSON.stringify([['added', 'c1.csv'], ['failed', 'c2.weird'], ['failed', 'c3.weird']]) && c.n === 1);

  // ── A/B: blocks from columns, categories in the HOST's order, nothing sniffed ──
  const a = await p.evaluate(async () => {
    const m = window._micro;
    const n = 4 * 3 * 2, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), au = new Float32Array(n), codes = new Uint8Array(n), dens = new Float64Array(n);
    let k = 0;
    for (let iz = 0; iz < 2; iz++) for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 4; ix++) { x[k] = 1000 + ix * 10; y[k] = 2000 + iy * 10; z[k] = 300 + iz * 5; au[k] = k / 4; codes[k] = k % 3; dens[k] = 2.7; k++; }
    const id = await m.addLayer({ kind: 'blocks', name: 'Au_OK', columns: { E: x, N: y, RL: z, Au: au, LITO: { codes, labels: ['Skarn', 'Granito', 'Xisto'] }, DENS: dens }, roles: { x: 'E', y: 'N', z: 'RL', value: 'Au', category: 'LITO' } });
    const L = m.layers().find((q) => q.id === id), h = L.docs.blockDoc.header;
    const row = await m.fetchLayerRow(L, 5);
    return { id, label: L.label, grid: h.grid && [h.grid.x.count, h.grid.y.count, h.grid.z.count, h.grid.x.pitch, h.grid.z.pitch], cats: h.categories, chan: h.columns[h.mapping.chan], cat: h.columns[h.mapping.cat], count: h.count, row5: row && [row[0], row[3], row[4]], lin: L.lineage && L.lineage.op };
  });
  chk(`A blocks: grid ${JSON.stringify(a.grid)}, ${a.count} records, label “${a.label}”, lineage ${a.lin}`, JSON.stringify(a.grid) === JSON.stringify([4, 3, 2, 10, 5]) && a.count === 24 && a.label === 'Au_OK' && a.lin === 'ingest');
  chk(`A roles exact: value ${a.chan}, category ${a.cat}, categories in host order ${JSON.stringify(a.cats)}`, a.chan === 'Au' && a.cat === 'LITO' && JSON.stringify(a.cats) === JSON.stringify(['Skarn', 'Granito', 'Xisto']));
  chk(`B pick row 5 = ${JSON.stringify(a.row5)}`, a.row5 && a.row5[0] === 1010 && Math.abs(a.row5[1] - 1.25) < 1e-6 && a.row5[2] === 'Xisto');
  const f = await p.evaluate(async (id) => {
    const m = window._micro; m.setActiveLayer(id);
    document.querySelector('#filter').value = 'Au > 3';
    await m.applyBlockFilter('Au > 3');
    const L = m.layers().find((q) => q.id === id);
    for (let t = 0; t < 100 && !(L._filterMask && L.filterExpr === 'Au > 3'); t++) await new Promise((r) => setTimeout(r, 50));
    let hits = 0; if (L._filterMask) for (const v of L._filterMask) hits += v;
    await m.applyBlockFilter('');
    await m.runExport(L, { scope: 'all', format: 'parquet', codec: 'SNAPPY', download: false });
    const { parquetInfo } = await import('/ext/parquet/index.js');
    const info = parquetInfo(await window._lastExport.arrayBuffer());
    return { hits, rows: info.rowCount, cols: info.columns.map((c) => c.name) };
  }, a.id);
  chk(`B filter Au > 3 → ${f.hits} records; export → ${f.rows} rows [${f.cols}]`, f.hits === 11 && f.rows === 24 && f.cols.includes('LITO') && f.cols.includes('DENS'));

  // ── A: declared lattice — accepted when true, rejected loudly when not ──
  const d = await p.evaluate(async () => {
    const m = window._micro, n0 = m.layers().length;
    const x = Float64Array.from([5, 15, 25, 5]), y = Float64Array.from([5, 5, 5, 15]), z = Float64Array.from([2, 2, 2, 2]), v = Float64Array.from([1, 2, 3, 4]);
    const okId = await m.addLayer({ kind: 'blocks', name: 'decl', columns: { X: x, Y: y, Z: z, V: v }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'V' }, lattice: { origin: [5, 5, 2], pitch: [10, 10, 4], counts: [5, 4, 1] } });
    const g = m.layers().find((q) => q.id === okId).docs.blockDoc.header.grid;
    let err = null;
    try { await m.addLayer({ kind: 'blocks', name: 'decl-bad', columns: { X: x, Y: y, Z: z }, roles: { x: 'X', y: 'Y', z: 'Z' }, lattice: { origin: [0, 0, 0], pitch: [10, 10, 4], counts: [5, 4, 1] } }); } catch (e) { err = e.message; }
    let err2 = null;
    try { await m.addLayer({ kind: 'blocks', name: 'short', columns: { X: x, Y: y, Z: Float64Array.from([1]) }, roles: { x: 'X', y: 'Y', z: 'Z' } }); } catch (e) { err2 = e.message; }
    let err3 = null;
    try { await m.addLayer({ kind: 'blocks', name: 'norole', columns: { X: x, Y: y, Z: z }, roles: { x: 'X', y: 'Y', z: 'Q' } }); } catch (e) { err3 = e.message; }
    return { counts: [g.x.count, g.y.count], err, err2, err3, added: m.layers().length - n0 };
  });
  chk(`A declared lattice applied as stated (counts ${d.counts}, not inferred)`, d.counts[0] === 5 && d.counts[1] === 4);
  chk(`A declared lattice off the data → rejected: “${(d.err || '').slice(0, 70)}…”`, /declared lattice rejected/.test(d.err || ''));
  chk(`A bad input rejected (lengths / unknown role), only the good layer added (${d.added})`, /one length/.test(d.err2 || '') && /not a column/.test(d.err3 || '') && d.added === 1);

  // ── A: sub-blocked via sizes; points; mesh; table; drillholes with free text ──
  const s = await p.evaluate(async () => {
    const m = window._micro;
    // parent 10 m blocks; the one at (15,5,5) split into 8 × 5 m
    const X = [5, 25, 5, 25], Y = [5, 5, 15, 15], Z = [5, 5, 5, 5], D = [10, 10, 10, 10];
    for (const dx of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) { X.push(15 + dx); Y.push(5 + dy); Z.push(5 + dz); D.push(5); }
    const sid = await m.addLayer({ kind: 'blocks', name: 'subs', columns: { X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), S: Float64Array.from(D) }, roles: { x: 'X', y: 'Y', z: 'Z' }, sizes: { dx: 'S', dy: 'S', dz: 'S' } });
    const sh = m.layers().find((q) => q.id === sid).docs.blockDoc.header;
    const pid = await m.addLayer({ kind: 'points', name: 'pts', columns: { x: Float64Array.from([1, 2, 3]), y: Float64Array.from([1, 2, 4]), z: Float64Array.from([0, 0, 1]) }, roles: { x: 'x', y: 'y', z: 'z' } });
    const mid = await m.addLayer({ kind: 'mesh', name: 'tri', vertices: Float64Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 5]), triangles: Uint32Array.from([0, 1, 2, 1, 3, 2]) });
    const tid = await m.addLayer({ kind: 'table', name: 'prices', columns: { item: ['Au', 'Cu'], price: Float64Array.from([2300, 9.1]), note: ['per oz, spot', 'per "t"'] } });
    const did = await m.addLayer({
      kind: 'drillholes', name: 'campaign',
      collar: { columns: { HOLE: ['H1', 'H2'], E: Float64Array.from([100, 200]), N: Float64Array.from([100, 100]), RL: Float64Array.from([50, 50]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { HOLE: ['H1', 'H2'], AT: Float64Array.from([0, 0]), AZI: Float64Array.from([0, 90]), INC: Float64Array.from([90, 60]) }, roles: { bhid: 'HOLE', at: 'AT', az: 'AZI', dip: 'INC' } },
      intervals: { columns: { HOLE: ['H1', 'H1', 'H2'], F: Float64Array.from([0, 2, 0]), T: Float64Array.from([2, 4, 3]), CU: Float64Array.from([0.4, 0.9, 1.2]), OBS: ['broken, oxidised', 'core loss\nnear 3 m, "soft"', 'ok'] }, roles: { bhid: 'HOLE', from: 'F', to: 'T', value: 'CU' } },
    });
    const Ls = m.layers(), kindOf = (id) => { const L = Ls.find((q) => q.id === id); return L && L.kind; };
    const dh = Ls.find((q) => q.id === did).docs.dhDoc.header;
    const obs = await m.fetchLayerRow(Ls.find((q) => q.id === did), 1);
    return {
      sub: sh.subBlocked, pal: sh.dimPalette && sh.dimPalette.length, fine: sh.grid && sh.grid.x.pitch,
      kinds: [kindOf(pid), kindOf(mid), kindOf(tid), kindOf(did)], dh: [dh.count, dh.placed, dh.holes],
      obs: obs && obs.includes('core loss\nnear 3 m, "soft"'),
      tableRows: (Ls.find((q) => q.id === tid).docs.tableDoc || {}).header.count,
    };
  });
  chk(`A sizes → sub-blocked (palette ${s.pal}, fine pitch ${s.fine})`, s.sub === true && s.pal === 2 && s.fine === 2.5);
  chk(`A points / mesh / table / drillholes → ${JSON.stringify(s.kinds)}`, s.kinds[0] === 'points' && s.kinds[1] === 'mesh' && s.kinds[3] === 'points' && s.tableRows === 2);
  chk(`A drillholes: ${JSON.stringify(s.dh)} (count/placed/holes); free text with a line break survives (${s.obs})`, s.dh[0] === 3 && s.dh[1] === 3 && s.dh[2] === 2 && s.obs);

  // ── §2: Parquet sub-blocks from a FOREIGN producer, and the micro:model contract ──
  const q = await p.evaluate(async () => {
    const m = window._micro;
    const { writeParquet } = await import('/ext/parquet/index.js');
    const X = [5, 25, 5, 25], Y = [5, 5, 15, 15], Z = [5, 5, 5, 5], D = [10, 10, 10, 10];
    for (const dx of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) { X.push(15 + dx); Y.push(5 + dy); Z.push(5 + dz); D.push(5); }
    const G = X.map((_, i) => i * 0.5);
    const cols = (kv) => writeParquet({ columnData: [{ name: 'XC', data: X, type: 'DOUBLE' }, { name: 'YC', data: Y, type: 'DOUBLE' }, { name: 'ZC', data: Z, type: 'DOUBLE' }, { name: 'DX', data: D, type: 'DOUBLE' }, { name: 'DY', data: D, type: 'DOUBLE' }, { name: 'DZ', data: D, type: 'DOUBLE' }, { name: 'AU', data: G, type: 'DOUBLE' }], codec: 'UNCOMPRESSED', kvMetadata: kv });
    // (1) no micro:model — discovery finds the sub-blocks, by the CSV names
    const id1 = await m.openBlob(new Blob([cols([])]), 'foreign.parquet', 'add', null, { throw: true });
    const h1 = m.layers().find((L) => L.id === id1).docs.blockDoc.header;
    // (2) a producer's micro:model — dims by NAME + palette, no discovery (palette order is the producer's)
    const model = { v: 1, grid: { x: { origin: 5, pitch: 2.5, count: 9 }, y: { origin: 2.5, pitch: 2.5, count: 6 }, z: { origin: 2.5, pitch: 2.5, count: 3 } }, bbox: { min: [0, 0, 0], max: [30, 20, 10] }, categories: null, subBlocked: true, dims: { x: 'DX', y: 'DY', z: 'DZ' }, dimPalette: [[2.5, 2.5, 2.5], [5, 5, 5]] };
    const id2 = await m.openBlob(new Blob([cols([{ key: 'micro:model', value: JSON.stringify(model) }])]), 'declared.parquet', 'add', null, { throw: true });
    const h2 = m.layers().find((L) => L.id === id2).docs.blockDoc.header;
    // (3) an old flag-only model (subBlocked, no dims/palette) is not trusted → rebuilt
    const id3 = await m.openBlob(new Blob([cols([{ key: 'micro:model', value: JSON.stringify({ grid: model.grid, bbox: model.bbox, categories: null, subBlocked: true }) }])]), 'oldkv.parquet', 'add', null, { throw: true });
    const h3 = m.layers().find((L) => L.id === id3).docs.blockDoc.header;
    // (4) micro's own export of a sub-blocked layer carries dims + palette
    await m.runExport(m.layers().find((L) => L.id === id1), { scope: 'all', format: 'parquet', codec: 'SNAPPY', download: false });
    const { parquetInfo } = await import('/ext/parquet/index.js');
    const info = parquetInfo(await window._lastExport.arrayBuffer());
    const kv = JSON.parse((info.meta.key_value_metadata || []).find((e) => e.key === 'micro:model').value);
    return {
      d1: [h1.subBlocked, h1.dimPalette && h1.dimPalette.length, h1.dimCols && h1.columns[h1.dimCols.x], h1.numericColumns.map((c) => c.name).join()],
      d2: [h2.subBlocked, JSON.stringify(h2.dimPalette[0]), h2.dimCols && h2.columns[h2.dimCols.z]],
      d3: [h3.subBlocked, h3.dimPalette && h3.dimPalette.length],
      kv: [kv.subBlocked, kv.dims && kv.dims.x, kv.dimPalette && kv.dimPalette.length],
    };
  });
  chk(`§2 foreign sub-blocked Parquet discovered: ${JSON.stringify(q.d1)}`, q.d1[0] === true && q.d1[1] === 2 && q.d1[2] === 'DX' && q.d1[3] === 'AU');
  chk(`§2 producer micro:model applied as written (palette[0] ${q.d2[1]}): ${JSON.stringify(q.d2)}`, q.d2[0] === true && q.d2[1] === '[2.5,2.5,2.5]' && q.d2[2] === 'DZ');
  chk(`§2 flag-only micro:model rebuilt by discovery: ${JSON.stringify(q.d3)}`, q.d3[0] === true && q.d3[1] === 2);
  chk(`§2 micro's export states dims + palette: ${JSON.stringify(q.kv)}`, q.kv[0] === true && q.kv[1] === 'DX' && q.kv[2] === 2);

  // ── D: a quoted CSV block model (comma, line break, doubled quote in a field) ──
  const dq = await p.evaluate(async () => {
    const m = window._micro;
    const rows = ['XC,YC,ZC,AU,NOTE'];
    let k = 0;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { rows.push(`${5 + x * 10},${5 + y * 10},5,${k},${k === 4 ? '"two\nlines, ""quoted"""' : '"a, b"'}`); k++; }
    const id = await m.openBlob(new Blob([rows.join('\r\n') + '\r\n']), 'quoted.csv', 'add', null, { throw: true });
    const L = m.layers().find((q2) => q2.id === id), h = L.docs.blockDoc.header;
    const r = await m.fetchLayerRow(L, 5);
    return { count: h.count, grid: !!h.grid, r5: r && [r[3], r[4]], r4: (await m.fetchLayerRow(L, 4))[4] };
  });
  chk(`D quoted CSV: ${dq.count} records, grid ${dq.grid}, row 4 note ${JSON.stringify(dq.r4)}, row 5 ${JSON.stringify(dq.r5)}`, dq.count === 9 && dq.grid && dq.r4 === 'two\nlines, "quoted"' && dq.r5 && +dq.r5[0] === 5);
  await p.close();
}

// §1 + rotated-models v1: a rotated lattice is DETECTED from centroids and
// applied only on confirmation; drawn and picked as true oriented boxes; a
// declared basis (micro:model from a producer, or addLayer) applies without a
// confirm but is CHECKED; micro's export round-trips it; same-basis joins work
async function rotatedChecks(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  console.log(`── rotated (${label})`);
  await p.evaluate(() => {
    const AZ = 30 * Math.PI / 180, P = [10, 10, 5];
    window.__lat = {
      O: [612345.5, 7765432.25, 812.5], n: [8, 6, 3],
      U: [Math.cos(AZ) * P[0], -Math.sin(AZ) * P[0], 0], V: [Math.sin(AZ) * P[1], Math.cos(AZ) * P[1], 0], W: [0, 0, P[2]],
    };
    window.__latCsv = (L, { shift = [0, 0, 0], col = 'AU', every = 1, offset = 0 } = {}) => {
      const r = (v) => Math.round(v * 1000) / 1000, rows = [`XC,YC,ZC,${col}`];
      let k2 = 0;
      for (let k = 0; k < L.n[2]; k++) for (let j = 0; j < L.n[1]; j++) for (let i = 0; i < L.n[0]; i++, k2++) {
        if (k2 % every) continue;
        const a = i + shift[0], b = j + shift[1], c = k + shift[2];
        const w = [0, 1, 2].map((d) => L.O[d] + a * L.U[d] + b * L.V[d] + c * L.W[d]);
        rows.push(`${r(w[0])},${r(w[1])},${r(w[2])},${k2 + offset}`);
      }
      return rows.join('\n') + '\n';
    };
  });
  // the confirm: the user is asked, and "points" keeps the honest fallback
  const asked = await p.evaluate(async () => {
    const m = window._micro;
    const pr = m.openBlob(new Blob([window.__latCsv(window.__lat)]), 'rot_ask.csv', 'replace');
    for (let t = 0; t < 200 && !document.querySelector('#pmDlg').classList.contains('show'); t++) await new Promise((r) => setTimeout(r, 25));
    const msg = document.querySelector('#pmMsg').textContent, okLabel = document.querySelector('#pmOk').textContent;
    document.querySelector('#pmCancel').click();
    const id = await pr;
    const L = m.layers().find((q) => q.id === id);
    return { msg, okLabel, kind: L.kind, grid: !!L.docs.blockDoc.header.grid };
  });
  chk(`rot: detection ASKS (“${asked.msg.slice(0, 80)}…”), “points” keeps centroids`, /ROTATED lattice: 8×6×3|ROTATED lattice: 6×8×3/.test(asked.msg) && /azimuth/.test(asked.msg) && asked.okLabel === 'rotated boxes' && asked.kind === 'points' && !asked.grid);

  const r = await p.evaluate(async () => {
    const m = window._micro, LAT = window.__lat;
    const id = await m.openBlob(new Blob([window.__latCsv(LAT)]), 'rot.csv', 'replace', null, { acceptLattice: true });
    const L = m.layers().find((q) => q.id === id), h = L.docs.blockDoc.header;
    // plan view, then pick near the CORNERS of top-level blocks (±0.4 block along
    // U and V): a rotated box answers its own record; an axis-aligned box drawn
    // at the same centre would answer a neighbour (or nothing) at most of these
    m.cam.state.phi = Math.PI / 2 - 0.02; m.cam.state.theta = 0.7; m.cam.update(); m.requestRender();
    await new Promise((res) => setTimeout(res, 300));
    const cv = document.querySelector('#cv'), rect = cv.getBoundingClientRect();
    const proj = (w) => { const st = m.cam.state, o = m.frame.origin, q = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], M = st.viewProj; const x = M[0] * q[0] + M[4] * q[1] + M[8] * q[2] + M[12], y = M[1] * q[0] + M[5] * q[1] + M[9] * q[2] + M[13], ww = M[3] * q[0] + M[7] * q[1] + M[11] * q[2] + M[15]; return [(x / ww + 1) / 2 * rect.width, (1 - y / ww) / 2 * rect.height]; };
    let tried = 0, right = 0, aaWould = 0;
    const k = LAT.n[2] - 1;
    for (let j = 1; j < LAT.n[1] - 1; j++) for (let i = 1; i < LAT.n[0] - 1; i++) {
      const rec = i + LAT.n[0] * (j + LAT.n[1] * k);
      for (const [a, b] of [[0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]]) {
        const w = [0, 1, 2].map((d) => LAT.O[d] + (i + a) * LAT.U[d] + (j + b) * LAT.V[d] + k * LAT.W[d] + 0.45 * LAT.W[d]);
        const [sx, sy] = proj(w);
        const hit = m.renderer.pick(sx, sy, m.cam, {});
        tried++;
        if (hit && (hit.rec === rec)) right++;
        // would an AXIS-ALIGNED 10×10 box at this centre contain the point?
        const c = [0, 1].map((d) => LAT.O[d] + i * LAT.U[d] + j * LAT.V[d] + k * LAT.W[d]);
        if (Math.abs(w[0] - c[0]) <= 5 && Math.abs(w[1] - c[1]) <= 5) aaWould++;
      }
    }
    return { rot: !!h.grid.rot, lat: h.lattice, kind: L.kind, counts: [h.grid.x.count, h.grid.y.count, h.grid.z.count].sort().join(), tried, right, aaWould, lin: L.lineage.params && L.lineage.params.lattice };
  });
  chk(`rot: accepted → rotated grid (${r.counts}), ${JSON.stringify(r.lat)}`, r.rot && r.kind === 'blocks' && r.counts === '3,6,8' && r.lat && r.lat.basis === 'inferred' && r.lat.confirmed === 'caller');
  chk(`rot: picks near block corners land on their own block ${r.right}/${r.tried} (an axis-aligned box would hold only ${r.aaWould})`, r.right === r.tried && r.aaWould < r.tried);
  chk(`rot: lineage carries the lattice decision (azimuth ${r.lin && r.lin.azimuth && r.lin.azimuth.toFixed(1)})`, !!(r.lin && r.lin.rotated && r.lin.basis === 'inferred'));

  // export → reopen: the rotated lattice rides micro:model (internal + producer basis form), no question asked
  const e = await p.evaluate(async () => {
    const m = window._micro;
    const L = m.layers()[0];
    await m.runExport(L, { scope: 'all', format: 'parquet', codec: 'SNAPPY', download: false });
    const { parquetInfo } = await import('/ext/parquet/index.js');
    const buf = await window._lastExport.arrayBuffer(), info = parquetInfo(buf);
    const kv = JSON.parse((info.meta.key_value_metadata || []).find((x) => x.key === 'micro:model').value);
    let asked2 = false;
    const pr = m.openBlob(new Blob([buf]), 'rot_back.parquet', 'add');
    for (let t = 0; t < 20; t++) { if (document.querySelector('#pmDlg').classList.contains('show')) { asked2 = true; document.querySelector('#pmOk').click(); } await new Promise((r) => setTimeout(r, 25)); }
    const id = await pr, h = m.layers().find((q) => q.id === id).docs.blockDoc.header;
    const same = h.grid && h.grid.rot && h.grid.rot.every((v, i) => Math.abs(v - L.docs.blockDoc.header.grid.rot[i]) < 1e-9);
    return { kvRot: !!(kv.grid && kv.grid.rot), kvBasis: !!(kv.grid && kv.grid.basis && kv.grid.basis.U), asked2, same };
  });
  chk(`rot: export states the lattice (rot ${e.kvRot}, producer basis ${e.kvBasis}); reopens rotated without asking (${!e.asked2}, same basis ${e.same})`, e.kvRot && e.kvBasis && !e.asked2 && e.same);

  // a PRODUCER's declared basis (foreign Parquet, micro:model grid.basis only): applied, checked — and refused when wrong
  const d = await p.evaluate(async () => {
    const m = window._micro, LAT = window.__lat;
    const { writeParquet } = await import('/ext/parquet/index.js');
    const rows = window.__latCsv(LAT).trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    const cols = ['XC', 'YC', 'ZC', 'AU'].map((nm, c) => ({ name: nm, data: rows.map((r) => r[c]), type: 'DOUBLE' }));
    const mk = (origin) => writeParquet({ columnData: cols, codec: 'UNCOMPRESSED', kvMetadata: [{ key: 'micro:model', value: JSON.stringify({ grid: { basis: { origin, U: LAT.U, V: LAT.V, W: LAT.W, counts: LAT.n, source: { convention: 'test azimuth', angles: [30, 0, 0] } } }, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, categories: null, subBlocked: false, declared: 'mm' }) }] });
    let fail = null; const onF = (ev) => { fail = ev.detail.reason; }; addEventListener('micro:lattice-rejected', onF);
    const id1 = await m.openBlob(new Blob([mk(LAT.O)]), 'declared_ok.parquet', 'add');
    const h1 = m.layers().find((q) => q.id === id1).docs.blockDoc.header;
    const half = [0, 1, 2].map((a) => LAT.O[a] + 0.5 * LAT.U[a]);
    const id2 = await m.openBlob(new Blob([mk(half)]), 'declared_bad.parquet', 'add');
    const L2 = m.layers().find((q) => q.id === id2);
    removeEventListener('micro:lattice-rejected', onF);
    return { ok1: !!(h1.grid && h1.grid.rot), by: h1.lattice && h1.lattice.by, src: h1.grid && h1.grid.source && h1.grid.source.convention, bad: L2.kind, meta: L2.docs.blockDoc.metaLine, fail };
  });
  chk(`rot: a producer's declared basis applies (by ${d.by}, source “${d.src}”)`, d.ok1 && d.by === 'mm' && d.src === 'test azimuth');
  chk(`rot: a WRONG declared basis is refused loudly → points (${(d.fail || '').slice(0, 60)})`, d.bad === 'points' && /REFUSED/.test(d.meta) && /off the lattice/.test(d.fail || ''));

  // same-basis spatial join (this month vs last): B is a shifted part of the SAME lattice
  const j = await p.evaluate(async () => {
    const m = window._micro, LAT = window.__lat;
    const A = m.layers().find((q) => q.name === 'rot.csv');
    const idB = await m.openBlob(new Blob([window.__latCsv({ ...LAT, n: [4, 3, 3] }, { shift: [2, 1, 0], col: 'CU', offset: 1000 })]), 'rotB.csv', 'add', null, { acceptLattice: true });
    const B = m.layers().find((q) => q.id === idB);
    const ga = m.gridAxesOf(A), gb = m.gridAxesOf(B);
    const comp = m.gridsCompatible(ga, gb);
    const { blob, cells } = await m.runSpatialJoin({ leftL: A, rightL: B, target: ga, columns: [{ src: 'right', name: 'CU', out: 'CU_B', num: true, op: 'mean' }], coverage: false });
    const lines = (await blob.text()).trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    // each joined cell's world centroid must be one of B's, carrying B's value there
    const bRows = window.__latCsv({ ...LAT, n: [4, 3, 3] }, { shift: [2, 1, 0], col: 'CU', offset: 1000 }).trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    let match = 0;
    for (const r of lines) { const b = bRows.find((q) => Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) < 0.01); if (b && Math.abs(b[3] - r[3]) < 1e-6) match++; }
    const AA = { x: { origin: 5, pitch: 10, count: 4 }, y: { origin: 5, pitch: 10, count: 4 }, z: { origin: 2.5, pitch: 5, count: 3 } };
    const cross = m.gridsCompatible(ga, AA);
    return { comp: comp.ok, cells, n: lines.length, match, crossReason: cross.reason };
  });
  chk(`rot: same-basis join — compatible ${j.comp}, ${j.cells} cells, ${j.match}/${j.n} carry B's value at B's centroid`, j.comp && j.cells === 36 && j.match === 36);
  chk(`rot: rotated vs axis-aligned is refused with a reason (“${(j.crossReason || '').slice(0, 50)}…”)`, /different lattice orientations/.test(j.crossReason || ''));

  // addLayer with a rotated basis: declared → no question; wrong → rejected
  const a = await p.evaluate(async () => {
    const m = window._micro, LAT = window.__lat;
    const rows = window.__latCsv(LAT).trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    const col = (c) => Float64Array.from(rows.map((r) => r[c]));
    const id = await m.addLayer({ kind: 'blocks', name: 'rot_host', columns: { E: col(0), N: col(1), RL: col(2), AU: col(3) }, roles: { x: 'E', y: 'N', z: 'RL', value: 'AU' }, lattice: { basis: { origin: LAT.O, U: LAT.U, V: LAT.V, W: LAT.W, counts: LAT.n } } });
    const h = m.layers().find((q) => q.id === id).docs.blockDoc.header;
    let err = null;
    try { await m.addLayer({ kind: 'blocks', name: 'rot_host_bad', columns: { E: col(0), N: col(1), RL: col(2) }, roles: { x: 'E', y: 'N', z: 'RL' }, lattice: { basis: { origin: LAT.O.map((v, i) => v + 0.5 * LAT.U[i]), U: LAT.U, V: LAT.V, W: LAT.W, counts: LAT.n } } }); } catch (e2) { err = e2.message; }
    let shear = null;
    try { await m.addLayer({ kind: 'blocks', name: 'shear', columns: { E: col(0), N: col(1), RL: col(2) }, roles: { x: 'E', y: 'N', z: 'RL' }, lattice: { basis: { origin: LAT.O, U: LAT.U, V: [LAT.V[0] + 1, LAT.V[1], 0], W: LAT.W, counts: LAT.n } } }); } catch (e2) { shear = e2.message; }
    return { rot: !!(h.grid && h.grid.rot), by: h.lattice && h.lattice.by, err, shear };
  });
  chk(`rot: addLayer with a rotated basis → rotated boxes, declared by ${a.by}`, a.rot && a.by === 'host');
  chk(`rot: addLayer refuses a basis off the data (“${(a.err || '').slice(0, 50)}…”) and a sheared one`, /declared lattice rejected/.test(a.err || '') && /not perpendicular/.test(a.shear || ''));
  await p.close();
}

// addLayer with a FILE (the big-data door): opened in place, never copied,
// roles stated by name against the file's header, handles remembered
async function fileChecks(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  console.log(`── addLayer({ file }) (${label})`);
  const f = await p.evaluate(async () => {
    const m = window._micro, out = {};
    // CSV with unconventional names: nothing sniffed, the text column NOT auto-picked as a category
    const rows = ['EAST,NORTH,RL,GRADE,ROCK,NOTE'];
    let k = 0;
    for (let z = 0; z < 2; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) { rows.push(`${1000 + x * 10},${2000 + y * 10},${300 + z * 5},${k},${k % 2 ? 'BIF' : 'CANGA'},"note, ${k}"`); k++; }
    const csv = new File([rows.join('\n') + '\n'], 'model_export.csv', { type: 'text/csv' });
    const id1 = await m.addLayer({ kind: 'blocks', file: csv, name: 'from_file', roles: { x: 'EAST', y: 'NORTH', z: 'RL', value: 'GRADE' } });
    const L1 = m.layers().find((q) => q.id === id1), h1 = L1.docs.blockDoc.header;
    out.csv = { sameBlob: L1.docs.blockDoc.blob === csv, grid: h1.grid && [h1.grid.x.count, h1.grid.y.count, h1.grid.z.count].join('×'), chan: h1.columns[h1.mapping.chan], cats: h1.categories, label: L1.label, n: h1.count };
    // a File made in ANOTHER frame (the host case): not `instanceof File` here
    const fr = document.createElement('iframe'); document.body.appendChild(fr);
    const foreign = new fr.contentWindow.File([rows.join('\n') + '\n'], 'foreign.csv');
    out.crossRealm = !(foreign instanceof File);
    const idF = await m.addLayer({ kind: 'blocks', file: foreign, roles: { x: 'EAST', y: 'NORTH', z: 'RL', category: 'ROCK' } });
    out.foreign = m.layers().find((q) => q.id === idF).docs.blockDoc.header.categories;
    fr.remove();
    // Parquet: a declared ROTATED basis stated by the host, and sizes from columns NOT named DX/DY/DZ
    const { writeParquet } = await import('/ext/parquet/index.js');
    const AZ = 25 * Math.PI / 180, U = [Math.cos(AZ) * 10, -Math.sin(AZ) * 10, 0], V = [Math.sin(AZ) * 10, Math.cos(AZ) * 10, 0], W = [0, 0, 5], O = [612000, 7765000, 800];
    const X = [], Y = [], Z = [], G = [];
    for (let kk = 0; kk < 2; kk++) for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) { const w = [0, 1, 2].map((a) => O[a] + i * U[a] + j * V[a] + kk * W[a]); X.push(w[0]); Y.push(w[1]); Z.push(w[2]); G.push(i + j); }
    const pqRot = new File([writeParquet({ columnData: [{ name: 'E', data: X, type: 'DOUBLE' }, { name: 'N', data: Y, type: 'DOUBLE' }, { name: 'H', data: Z, type: 'DOUBLE' }, { name: 'AU', data: G, type: 'DOUBLE' }], codec: 'UNCOMPRESSED' })], 'rot.parquet');
    const idR = await m.addLayer({ kind: 'blocks', file: pqRot, roles: { x: 'E', y: 'N', z: 'H', value: 'AU' }, lattice: { basis: { origin: O, U, V, W, counts: [5, 4, 2] } } });
    const hR = m.layers().find((q) => q.id === idR).docs.blockDoc.header;
    out.rot = { rot: !!(hR.grid && hR.grid.rot), by: hR.lattice && hR.lattice.by };
    try { await m.addLayer({ kind: 'blocks', file: pqRot, roles: { x: 'E', y: 'N', z: 'H' }, lattice: { basis: { origin: O.map((v, a) => v + 0.5 * U[a]), U, V, W, counts: [5, 4, 2] } } }); out.rotBad = 'accepted'; } catch (e) { out.rotBad = e.message; }
    const SX = [5, 25, 5, 25], SY = [5, 5, 15, 15], SZ = [5, 5, 5, 5], S = [10, 10, 10, 10];
    for (const dx of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) { SX.push(15 + dx); SY.push(5 + dy); SZ.push(5 + dz); S.push(5); }
    const pqSub = new File([writeParquet({ columnData: [{ name: 'X', data: SX, type: 'DOUBLE' }, { name: 'Y', data: SY, type: 'DOUBLE' }, { name: 'Z', data: SZ, type: 'DOUBLE' }, { name: 'SIZE', data: S, type: 'DOUBLE' }], codec: 'UNCOMPRESSED' })], 'subs.parquet');
    const idS = await m.addLayer({ kind: 'blocks', file: pqSub, roles: { x: 'X', y: 'Y', z: 'Z' }, sizes: { dx: 'SIZE', dy: 'SIZE', dz: 'SIZE' } });
    const hS = m.layers().find((q) => q.id === idS).docs.blockDoc.header;
    out.sub = { sub: hS.subBlocked, pal: hS.dimPalette && hS.dimPalette.length };
    // .dm whose centroid fields are NOT XC/YC/ZC: only stated roles can open it
    const { makeDM } = await import('/test/dm-make.mjs');
    const fields = [{ name: 'XCEN', type: 'N' }, { name: 'YCEN', type: 'N' }, { name: 'ZCEN', type: 'N' }, { name: 'FE', type: 'N' }, { name: 'LITO', type: 'A', width: 8 }];
    const drows = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) drows.push({ XCEN: 5 + i * 10, YCEN: 5 + j * 10, ZCEN: 2.5, FE: i * 10 + j, LITO: i % 2 ? 'BIF' : 'CANGA' });
    const dmFile = new File([makeDM(fields, drows, { precision: 'ep' })], 'odd.dm');
    const idD = await m.addLayer({ kind: 'blocks', file: dmFile, roles: { x: 'XCEN', y: 'YCEN', z: 'ZCEN', value: 'FE' } });
    const hD = m.layers().find((q) => q.id === idD).docs.blockDoc.header;
    out.dm = { n: hD.count, x: hD.columns[hD.mapping.x], cats: hD.categories };
    // an OPFS FileSystemFileHandle: opened, and the layer keeps the handle
    const root = await navigator.storage.getDirectory(), fh = await root.getFileHandle('handle_model.csv', { create: true });
    const wr = await fh.createWritable(); await wr.write(rows.join('\n') + '\n'); await wr.close();
    const idH = await m.addLayer({ kind: 'blocks', file: fh, roles: { x: 'EAST', y: 'NORTH', z: 'RL' } });
    out.handle = m.layers().find((q) => q.id === idH).handle === fh;
    // drillholes, mixed sources: collar in memory, survey + intervals as files
    const idDh = await m.addLayer({
      kind: 'drillholes', name: 'mixed',
      collar: { columns: { HOLE: ['H1'], E: Float64Array.from([0]), N: Float64Array.from([0]), RL: Float64Array.from([100]) }, roles: { bhid: 'HOLE', x: 'E', y: 'N', z: 'RL' } },
      survey: { file: new File(['HOLE,AT,BRG,INC\nH1,0,0,90\n'], 's.csv'), roles: { bhid: 'HOLE', at: 'AT', az: 'BRG', dip: 'INC' } },
      intervals: { file: new File(['HOLE,F,T,CU,OBS\nH1,0,2,0.5,"a, b"\nH1,2,4,0.7,"line\nbreak"\n'], 'i.csv'), roles: { bhid: 'HOLE', from: 'F', to: 'T', value: 'CU' } },
    });
    const dh = m.layers().find((q) => q.id === idDh).docs.dhDoc.header;
    out.dh = [dh.count, dh.placed, dh.holes];
    // rejections name the problem
    const rej = async (spec) => { try { await m.addLayer(spec); return 'accepted'; } catch (e) { return e.message; } };
    out.r1 = await rej({ kind: 'blocks', file: csv, roles: { x: 'EAST', y: 'NORTH', z: 'ELEV' } });
    out.r2 = await rej({ kind: 'blocks', file: new Blob([rows.join('\n')]), roles: { x: 'EAST', y: 'NORTH', z: 'RL' } });
    out.r3 = await rej({ kind: 'blocks', file: { nope: true }, roles: {} });
    out.r4 = await rej({ kind: 'blocks', file: pqSub, roles: { x: 'X', y: 'Y', z: 'Z' }, sizes: { dx: 'SIZE', dy: 'SIZE', dz: 'SIZE' }, lattice: { origin: [0, 0, 0], pitch: [1, 1, 1], counts: [1, 1, 1] } });
    return out;
  });
  chk(`file: CSV opened IN PLACE (same Blob ${f.csv.sameBlob}), grid ${f.csv.grid}, value ${f.csv.chan}, no auto-category (${JSON.stringify(f.csv.cats)}), label “${f.csv.label}”`, f.csv.sameBlob && f.csv.grid === '4×3×2' && f.csv.chan === 'GRADE' && f.csv.cats === null && f.csv.label === 'from_file' && f.csv.n === 24);
  chk(`file: a File from another frame (cross-realm ${f.crossRealm}) opens; stated category ${JSON.stringify(f.foreign)}`, f.crossRealm && JSON.stringify(f.foreign) === '["BIF","CANGA"]');
  chk(`file: Parquet + a declared rotated basis → rotated, by ${f.rot.by}; a wrong one rejects (“${(f.rotBad || '').slice(0, 45)}…”)`, f.rot.rot && f.rot.by === 'host' && /declared lattice rejected/.test(f.rotBad));
  chk(`file: Parquet sizes from a column named SIZE → sub-blocked (palette ${f.sub.pal})`, f.sub.sub === true && f.sub.pal === 2);
  chk(`file: .dm with XCEN/YCEN/ZCEN by stated roles → ${f.dm.n} records on ${f.dm.x}, no auto-category`, f.dm.n === 12 && f.dm.x === 'XCEN' && f.dm.cats === null);
  chk(`file: a FileSystemFileHandle opens and the layer keeps it (${f.handle})`, f.handle);
  chk(`file: drillholes from mixed sources (memory + files) → ${JSON.stringify(f.dh)}`, f.dh[0] === 2 && f.dh[1] === 2 && f.dh[2] === 1);
  chk(`file: rejections — unknown column, no extension, not a file, sizes+lattice`, /not a column of the file/.test(f.r1) && /spec\.format/.test(f.r2) && /File, a Blob or a FileSystemFileHandle/.test(f.r3) && /sizes OR a lattice/.test(f.r4));
  await p.close();
}

// micro:pick — a USER pick (canvas click, attribute-table row) reaches the host;
// a host-driven _micro.pick shows + frames a record and does NOT echo back
async function pickChecks(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  console.log(`── micro:pick (${label})`);
  const setup = await p.evaluate(async () => {
    const m = window._micro;
    window.__picks = [];
    addEventListener('micro:pick', (e) => window.__picks.push(e.detail));
    const n = 12, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), au = new Float64Array(n);
    for (let k = 0; k < n; k++) { x[k] = 1005 + (k % 4) * 10; y[k] = 2005 + Math.floor(k / 4) * 10; z[k] = 305; au[k] = 100 + k; }
    const id = await m.addLayer({ kind: 'blocks', name: 'pickme', columns: { X: x, Y: y, Z: z, AU: au }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    m.cam.fit(m.docBbox()); m.cam.state.phi = Math.PI / 2 - 0.02; m.cam.state.theta = 0.3; m.cam.update(); m.requestRender();
    await new Promise((res) => setTimeout(res, 400));
    const cv = document.querySelector('#cv'), rect = cv.getBoundingClientRect();
    const proj = (w) => { const st = m.cam.state, o = m.frame.origin, q = [w[0] - o[0], w[1] - o[1], w[2] - o[2]], M = st.viewProj; const xx = M[0] * q[0] + M[4] * q[1] + M[8] * q[2] + M[12], yy = M[1] * q[0] + M[5] * q[1] + M[9] * q[2] + M[13], ww = M[3] * q[0] + M[7] * q[1] + M[11] * q[2] + M[15]; return [rect.left + (xx / ww + 1) / 2 * rect.width, rect.top + (1 - yy / ww) / 2 * rect.height]; };
    m.cam.dolly(2.5); m.requestRender();                   // room around the model for an empty click
    await new Promise((res) => setTimeout(res, 300));
    return { id, at: proj([1025, 2015, 310]) };           // block (2,1) = AU 106
  });
  // a real click on the canvas
  await p.mouse.click(setup.at[0], setup.at[1]);
  await p.waitForFunction(() => window.__picks.length >= 1, null, { timeout: 10000 });
  const c1 = await p.evaluate(async (id) => {
    const d = window.__picks[0], m = window._micro;
    const row = d && d.rec != null ? await m.fetchLayerRow(m.layers().find((q) => q.id === d.layer), d.rec) : null;
    const h = m.layers().find((q) => q.id === id).docs.blockDoc.header;
    return { d, au: row && +row[h.mapping.chan] };
  }, setup.id);
  const w = c1.d && c1.d.world;
  chk(`pick: a canvas click → micro:pick { layer ${c1.d && c1.d.layer}, rec ${c1.d && c1.d.rec}, source ${c1.d && c1.d.source}, world ${JSON.stringify(w)} } → fetchLayerRow AU ${c1.au}`,
    c1.d && c1.d.layer === setup.id && c1.d.source === 'canvas' && c1.au === 106 && w && Math.abs(w[0] - 1025) < 1e-6 && Math.abs(w[1] - 2015) < 1e-6 && 'face' in c1.d);
  // a click on nothing clears: a canvas pixel (not under any panel) where pick finds nothing
  const empty = await p.evaluate(() => {
    const m = window._micro, cv = document.querySelector('#cv'), r = cv.getBoundingClientRect();
    for (let fy = 0.2; fy < 0.9; fy += 0.1) for (let fx = 0.1; fx < 0.95; fx += 0.05) {
      const x = r.left + fx * r.width, y = r.top + fy * r.height;
      if (document.elementFromPoint(x, y) === cv && m.renderer.pick(x - r.left, y - r.top, m.cam, {}) == null) return [x, y];
    }
    return null;
  });
  await p.mouse.click(empty[0], empty[1]);
  await p.waitForFunction(() => window.__picks.length >= 2, null, { timeout: 10000 });
  const c2 = await p.evaluate(() => window.__picks[1]);
  chk(`pick: a click on nothing → micro:pick null`, c2 === null);
  // a row selected in the attribute table
  const c3 = await p.evaluate(async (id) => {
    const m = window._micro, L = m.layers().find((q) => q.id === id);
    m.openAttrTable(L);
    for (let t = 0; t < 100 && !m.attrTables.get(id); t++) await new Promise((r) => setTimeout(r, 25));
    m.attrTables.get(id).grid.setSelection({ r0: 3, c0: 0, r1: 3, c1: 0 });
    for (let t = 0; t < 100 && window.__picks.length < 3; t++) await new Promise((r) => setTimeout(r, 25));
    return window.__picks[2];
  }, setup.id);
  chk(`pick: an attribute-table row → micro:pick { rec ${c3 && c3.rec}, source ${c3 && c3.source} }`, c3 && c3.layer === setup.id && c3.rec === 3 && c3.source === 'table' && c3.world && Math.abs(c3.world[0] - 1035) < 1e-6);
  // the host picks: panel shown, view centred, NO event back; bad input rejects
  const c4 = await p.evaluate(async (id) => {
    const m = window._micro, before = window.__picks.length;
    const world = await m.pick({ layer: id, rec: 11, frame: true });
    await new Promise((r) => setTimeout(r, 100));
    const t = m.cam.state.target, o = m.frame.origin;
    const rej = async (a) => { try { await m.pick(a); return 'accepted'; } catch (e) { return e.message; } };
    return {
      world, echoed: window.__picks.length - before,
      panel: document.querySelector('#recPanel').classList.contains('show') && /AU/.test(document.querySelector('#rpList').textContent),
      centred: world && Math.hypot(t[0] + o[0] - world[0], t[1] + o[1] - world[1], t[2] + o[2] - world[2]) < 1e-6,
      r1: await rej({ layer: 999, rec: 0 }), r2: await rej({ layer: id, rec: 12 }),
    };
  }, setup.id);
  chk(`pick: _micro.pick({ rec 11, frame }) → world ${JSON.stringify(c4.world)}, panel ${c4.panel}, centred ${c4.centred}, ${c4.echoed} events echoed; rejects “${c4.r1}” / “${c4.r2}”`,
    c4.world && Math.abs(c4.world[0] - 1035) < 1e-6 && Math.abs(c4.world[1] - 2025) < 1e-6 && c4.panel && c4.centred && c4.echoed === 0 && /no layer 999/.test(c4.r1) && /not a record/.test(c4.r2));
  // closing the record panel clears the host's view too
  const c5 = await p.evaluate(async () => { const n = window.__picks.length; document.querySelector('#rpClose').click(); await new Promise((r) => setTimeout(r, 50)); return { n: window.__picks.length - n, d: window.__picks[window.__picks.length - 1] }; });
  chk(`pick: closing the record panel → micro:pick null`, c5.n === 1 && c5.d === null);
  await p.close();
}

// window.micro — the versioned host API: readiness, chrome, colour-by (incl. the
// re-reads and a drillhole layer's REPLACEMENT), groups, rows, filter, removal
async function apiChecks(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.micro && window.micro.ready, null, { timeout: 30000 });
  console.log(`── window.micro (${label})`);
  // readiness on the host's <iframe> element, and ?embed=1 from the first paint
  const hp = await ctx.newPage(); hp.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await hp.goto(`http://127.0.0.1:${PORT}/__host.html`);
  const fr = await hp.evaluate(async (u) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:600px';   // desktop layout (under 720px the phone layout drops the title anyway)
    const got = new Promise((res) => f.addEventListener('micro:ready', (e) => res(e.detail), { once: true }));
    f.src = u + '?embed=1';
    document.body.appendChild(f);
    const detail = await Promise.race([got, new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
    const w = f.contentWindow, doc = f.contentDocument;
    const shown = (sel) => w.getComputedStyle(doc.querySelector(sel)).display !== 'none';
    const out = { detail, version: w.micro.version, title: shown('#bar > .title'), badge: shown('#sealBadge'), chrome: w.micro.chrome() };
    out.after = w.micro.setChrome({ title: true });
    out.titleBack = shown('#bar > .title');
    out.readyApi = (await w.micro.ready) === w.micro;
    f.remove();
    return out;
  }, url);
  await hp.close();
  chk(`api: micro:ready on the host's iframe (${JSON.stringify(fr.detail)}); ?embed=1 hides title ${!fr.title} + badge ${!fr.badge}; setChrome({ title }) brings it back (${JSON.stringify([fr.chrome, fr.after, fr.titleBack, fr.readyApi])})`,
    fr.detail && fr.detail.version === 1 && fr.version === 1 && !fr.title && !fr.badge && fr.chrome.title === false && fr.chrome.badge === false && fr.after.title === true && fr.after.badge === false && fr.titleBack && fr.readyApi);

  const r = await p.evaluate(async () => {
    const m = window.micro, out = {}, ev = [];
    for (const t of ['micro:layer-replaced', 'micro:layer-removed']) addEventListener(t, (e) => ev.push([t, e.detail]));
    const vis = new Map(), rd = window._micro.renderer, sv = rd.setLayerVisible.bind(rd);
    rd.setLayerVisible = (l, on) => { vis.set(l, !!on); return sv(l, on); };
    const n = 24, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), AU = new Float64Array(n), CU = new Float64Array(n);
    const LITO = [], WX = [];
    for (let k = 0; k < n; k++) { X[k] = 5 + (k % 4) * 10; Y[k] = 5 + Math.floor(k / 4) % 3 * 10; Z[k] = 5 + Math.floor(k / 12) * 10; AU[k] = k; CU[k] = 100 - k; LITO.push(k % 2 ? 'BIF' : 'CANGA'); WX.push(k % 3 ? 'FRESH' : 'OX'); }
    // a stated category → coloured by it at once, filed into a nested group
    const a = await m.addLayer({ kind: 'blocks', name: 'by_cat', group: 'Model/Domains', columns: { X, Y, Z, AU, CU, LITO }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU', category: 'LITO' } });
    out.a = m.layer(a);
    // roles.categories (no category): the first opens as the category, the rest are offered
    const b = await m.addLayer({ kind: 'blocks', name: 'cats', columns: { X, Y, Z, AU, CU, LITO, WX }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU', categories: ['LITO', 'WX'] } });
    out.b0 = m.layer(b);
    await m.setActive(b);
    out.bOpts = [...document.querySelectorAll('#colorBy option')].map((o) => o.value).filter((v) => v.startsWith('catcol:'));
    out.bId = await m.setColorBy(b, 'WX');               // a re-read with WX as THE category
    out.b1 = m.layer(b);
    out.bCats = window._micro.layers().find((q) => q.id === b).docs.blockDoc.header.categories;
    // value only → coloured by the value; then a channel the open didn't load, on a NON-active layer
    const c = await m.addLayer({ kind: 'blocks', name: 'by_val', columns: { X, Y, Z, AU, CU }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    out.c0 = m.layer(c).colorBy;
    await m.setActive(a);
    const dd0 = document.querySelector('#colorBy').value;
    out.cId = await m.setColorBy(c, 'CU');
    out.c1 = m.layer(c).colorBy;
    const Lc = window._micro.layers().find((q) => q.id === c), hc = Lc.docs.blockDoc.header;
    out.cChan = hc.columns[hc.mapping.chan];
    out.stillActive = window._micro.activeId() === a && document.querySelector('#colorBy').value === dd0;
    try { await m.setColorBy(c, 'NOPE'); out.bad = 'accepted'; } catch (e) { out.bad = e.message; }
    // drillholes in a group: a re-channel REPLACES the layer; it keeps its group, the old id forwards
    const h = await m.addLayer({
      kind: 'drillholes', name: 'holes', group: 'Holes',
      collar: { columns: { H: ['A', 'B'], E: Float64Array.from([0, 20]), N: Float64Array.from([0, 0]), RL: Float64Array.from([50, 50]) }, roles: { bhid: 'H', x: 'E', y: 'N', z: 'RL' } },
      survey: { columns: { H: ['A', 'B'], D: Float64Array.from([0, 0]), AZ: Float64Array.from([0, 0]), DIP: Float64Array.from([90, 90]) }, roles: { bhid: 'H', at: 'D', az: 'AZ', dip: 'DIP' } },
      intervals: { columns: { H: ['A', 'A', 'B'], F: Float64Array.from([0, 2, 0]), T: Float64Array.from([2, 4, 3]), AU: Float64Array.from([1, 2, 3]), CU: Float64Array.from([9, 8, 7]), DOM: ['ox', 'fr', 'ox'] }, roles: { bhid: 'H', from: 'F', to: 'T', value: 'AU', category: 'DOM' } },
    });
    out.h0 = m.layer(h);
    out.hId = await m.setColorBy(h, 'CU');
    out.h1 = m.layer(h);                                  // the OLD id, followed forward
    out.hEv = ev.filter((e) => e[0] === 'micro:layer-replaced').map((e) => e[1]);
    // groups
    out.groups = m.groups().map((g) => g.path);
    await m.group('Other/Deep', [c]);
    out.cGroup = m.layer(c).group;
    await m.setGroupVisible('Model', false);
    out.aHidden = vis.get(a) === false;
    await m.setGroupVisible('Model', true);
    out.aBack = vis.get(a) === true;
    await m.ungroup('Model');
    out.aAfterUngroup = m.layer(a).group;
    try { await m.group('Empty', []); out.emptyGroup = 'accepted'; } catch (e) { out.emptyGroup = e.message; }
    // rows by name, filter, removal
    out.row = await m.row(a, 5);
    await m.filter(c, 'AU > 20');
    out.filt = window._micro.layers().find((q) => q.id === c).filterExpr;
    await m.clearFilter(c);
    out.filtCleared = window._micro.layers().find((q) => q.id === c).filterExpr;
    await m.removeLayer(b);
    out.removed = ev.some((e) => e[0] === 'micro:layer-removed' && e[1].id === b) && m.layer(b) === null;
    // open(): a file as micro opens a dropped one, filed into a group
    const csv = ['X,Y,Z,AU'];
    for (let k = 0; k < 8; k++) csv.push(`${(k % 2) * 10 + 5},${(k >> 1 & 1) * 10 + 5},${(k >> 2) * 10 + 5},${k}`);
    const o = await m.open(new File([csv.join('\n') + '\n'], 'opened.csv'), { group: 'Opened' });
    out.opened = m.layer(o);
    try { await m.open({ nope: 1 }); out.openBad = 'accepted'; } catch (e) { out.openBad = e.message; }
    try { await m.look('sideways'); out.look = 'accepted'; } catch (e) { out.look = e.message; }
    await m.look('plan'); await m.fit(a);
    try { await m.row(a, 999); out.badRow = 'accepted'; } catch (e) { out.badRow = e.message; }
    return out;
  });
  chk(`api: addLayer with a category starts coloured by it (${r.a.colorBy}), kind ${r.a.kind}, filed in “${r.a.group}”`, r.a.colorBy === 'LITO' && r.a.kind === 'blocks' && r.a.group === 'Model/Domains' && r.a.count === 24);
  chk(`api: roles.categories → ${r.b0.colorBy} first, ${JSON.stringify(r.bOpts)} offered; setColorBy WX re-reads → ${r.b1.colorBy} ${JSON.stringify(r.bCats)}, same id ${r.bId === r.b0.id}`,
    r.b0.colorBy === 'LITO' && JSON.stringify(r.bOpts) === '["catcol:WX"]' && r.b1.colorBy === 'WX' && JSON.stringify(r.bCats) === '["FRESH","OX"]' && r.bId === r.b0.id && r.b1.colorChoices.includes('LITO'));
  chk(`api: a value-only layer starts on ${r.c0}; setColorBy CU on a NON-active layer re-reads (${r.cChan}) and leaves the active layer + its dropdown alone (${r.stillActive})`,
    r.c0 === 'AU' && r.c1 === 'CU' && r.cChan === 'CU' && r.stillActive);
  chk(`api: an unknown column rejects with the choices (“${r.bad.slice(0, 70)}…”)`, /“NOPE”/.test(r.bad) && /AU, CU/.test(r.bad));
  chk(`api: a drillhole re-channel replaces the layer (${r.h0.id} → ${r.hId}, event ${JSON.stringify(r.hEv)}); the old id follows forward, coloured by ${r.h1.colorBy}, still in “${r.h1.group}”`,
    r.h0.kind === 'drillholes' && r.h0.colorBy === 'DOM' && r.hId !== r.h0.id && r.h1 && r.h1.id === r.hId && r.h1.colorBy === 'CU' && r.h1.group === 'Holes'
    && r.hEv.length === 1 && r.hEv[0].from === r.h0.id && r.hEv[0].to === r.hId);
  chk(`api: groups ${JSON.stringify(r.groups)}; group() files (${r.cGroup}); setGroupVisible hides (${r.aHidden}) and shows (${r.aBack}); ungroup lifts (${JSON.stringify(r.aAfterUngroup)}); no empty groups`,
    ['Model', 'Model/Domains', 'Holes'].every((g) => r.groups.includes(g)) && r.cGroup === 'Other/Deep' && r.aHidden && r.aBack && r.aAfterUngroup === 'Domains' && /at least one layer/.test(r.emptyGroup));
  chk(`api: row() is named ${JSON.stringify(r.row)}; filter sets “${r.filt}” and clears; removeLayer fires micro:layer-removed; bad view/rec reject`,
    r.row && r.row.AU === 5 && r.row.LITO === 'BIF' && r.filt === 'AU > 20' && r.filtCleared === '' && r.removed && /look\(\) takes/.test(r.look) && /not a record/.test(r.badRow));
  chk(`api: open() sniffs a dropped-style file → ${r.opened && r.opened.kind} ×${r.opened && r.opened.count} in “${r.opened && r.opened.group}”; a non-file rejects`,
    r.opened && r.opened.kind === 'blocks' && r.opened.count === 8 && r.opened.group === 'Opened' && /File, a Blob or a FileSystemFileHandle/.test(r.openBad));
  await p.close();
}

// window.micro, part 2 — section / view / selection / snapshot, and the
// active-layer audit: a layer's filter is its own, and a failed re-read keeps it
async function api2Checks(url, label) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
  await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.micro && window.micro.ready, null, { timeout: 30000 });
  console.log(`── window.micro: section · view · selection · snapshot · per-layer filters (${label})`);
  const r = await p.evaluate(async () => {
    const m = window.micro, out = {}, sel = [];
    addEventListener('micro:selection', (e) => sel.push(e.detail));
    const mk = (x0) => {
      const n = 24, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), AU = new Float64Array(n), CU = new Float64Array(n);
      for (let k = 0; k < n; k++) { X[k] = x0 + 5 + (k % 4) * 10; Y[k] = 7000005 + Math.floor(k / 4) % 3 * 10; Z[k] = 305 + Math.floor(k / 12) * 10; AU[k] = k; CU[k] = 100 - k; }
      return { X, Y, Z, AU, CU };
    };
    const a = await m.addLayer({ kind: 'blocks', name: 'A', columns: mk(600000), roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    const b = await m.addLayer({ kind: 'blocks', name: 'B', columns: mk(600100), roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU' } });
    // ── section, in world terms
    out.off = m.section();
    out.z = await m.setSection({ axis: 'z', at: [600020, 7000015, 315], thickness: 4 });
    out.zBack = m.section();
    out.n = await m.setSection({ normal: [1, 1, 0], position: (600020 + 7000015) / Math.SQRT2 });
    out.dd = await m.setSection({ dipDir: 90, dip: 60, clip: 'front' });
    try { await m.setSection({ axis: 'q' }); out.badSec = 'accepted'; } catch (e) { out.badSec = e.message; }
    out.offAgain = await m.setSection(null);
    // ── view
    out.v1 = await m.setView({ target: [600050, 7000015, 310], look: 90, elevation: 30, distance: 400, ortho: true });
    out.v2 = m.view();
    await m.setView({ ortho: false, look: 0 });
    out.v3 = m.view();
    // ── selection, both ways
    const n0 = sel.length;
    out.selN = await m.select(a, [1, 5, 7]);
    await new Promise((res) => setTimeout(res, 0));
    out.selRead = m.selection(a);
    out.selRead = { count: out.selRead.count, records: [...out.selRead.records], typed: out.selRead.records instanceof Uint32Array };
    out.selAdd = await m.select(a, [9], { mode: 'add' });
    out.selRem = await m.select(a, [1], { mode: 'remove' });
    await new Promise((res) => setTimeout(res, 0));
    out.selEv = sel.slice(n0);
    try { await m.select(a, [99]); out.selBad = 'accepted'; } catch (e) { out.selBad = e.message; }
    await m.clearSelection(a);
    out.selCleared = m.selection(a).count;
    // ── snapshot
    await m.fit();
    const blob = await m.snapshot({ scale: 2 });
    const bmp = await createImageBitmap(blob);
    const cv = document.querySelector('#cv');
    out.snap = { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height, cw: cv.width, ch: cv.height };
    const plain = await m.snapshot({ decorations: false });
    out.snapPlain = plain.type === 'image/png' && plain.size > 0;
    // ── per-layer filters (the audit). A is filtered while B is ACTIVE, without stealing focus…
    await m.setActive(b);
    await m.filter(a, 'AU > 20');
    const _m = window._micro, LA = () => _m.layers().find((q) => q.id === a);
    out.fA = { expr: LA().filterExpr, mask: !!LA()._filterMask, active: _m.activeId(), box: document.querySelector('#filter').value };
    // …and SURVIVES a re-read of A (a channel switch) — the re-read used to restore the ACTIVE layer's filter
    await m.setColorBy(a, 'CU');
    // what is DRAWN, not the JS mask (which outlives the GPU's): a filtered regular
    // model draws only its matches (compacted) — 3 of 24, not all 24
    let drawn = -1;
    for (let t = 0; t < 80; t++) { drawn = _m.renderer.layerElementCount(a); if (drawn === 3) break; await new Promise((res) => setTimeout(res, 25)); }
    out.fAfter = { expr: LA().filterExpr, drawn };
    // two layers' sweeps at once: one no longer aborts the other
    const pa = m.filter(a, 'AU < 5'), pb = m.filter(b, 'AU > 21');   // 5 and 2 — distinct from A's earlier 3, so an aborted sweep shows
    await Promise.all([pa, pb]);
    const cnt = (L) => (L._filterMask ? L._filterMask.reduce((t, v) => t + v, 0) : -1);
    out.both = [cnt(LA()), cnt(_m.layers().find((q) => q.id === b))];
    // ── a FAILED re-read keeps the original, and grafts nothing onto another layer
    // (the source no longer reads — as a file changed on disk would — and B is the
    // active layer, the one the old code would have dressed as A)
    await m.setActive(b);
    const before = _m.layers().map((q) => [q.id, q.label || q.name]);
    const LAobj = LA(), good = LAobj.docs.blockDoc.blob;
    LAobj.docs.blockDoc.blob = new File(['PAR1 not really'], 'A.parquet');
    try { await _m.reopenAs(LAobj, 'points'); } catch { /* reported on the status line */ }
    LAobj.docs.blockDoc.blob = good;
    const after = _m.layers().map((q) => [q.id, q.label || q.name]);
    out.failKeep = { before, after, still: !!_m.layers().find((q) => q === LAobj) };
    return out;
  });
  chk(`api: section() off → null; axis z at a world point → position ${r.z && r.z.position} (thickness ${r.z && r.z.thickness}), read back the same`,
    r.off === null && r.z.axis === 'z' && Math.abs(r.z.position - 315) < 1e-6 && r.z.thickness === 4 && r.zBack.position === r.z.position && r.offAgain === null);
  chk(`api: a free normal → ${r.n.mode} at ${r.n.position.toFixed(3)}; dipDir/dip → ${r.dd.mode} ${r.dd.dipDir}/${r.dd.dip} ${r.dd.clip}; a bad axis rejects`,
    r.n.mode === 'knife' && Math.abs(r.n.position - (600020 + 7000015) / Math.SQRT2) < 1e-6 && Math.abs(r.n.normal[0] - Math.SQRT1_2) < 1e-12 && r.dd.mode === 'custom' && r.dd.dipDir === 90 && r.dd.dip === 60 && r.dd.clip === 'front' && /x, y or z/.test(r.badSec));
  chk(`api: setView/view round-trip — target ${JSON.stringify(r.v2.target)}, look ${r.v2.look}, elevation ${r.v2.elevation}, ortho ${r.v2.ortho}; look 0 = north (${r.v3.look})`,
    r.v2.target.every((v, i) => Math.abs(v - [600050, 7000015, 310][i]) < 1e-6) && Math.abs(r.v2.look - 90) < 1e-9 && Math.abs(r.v2.elevation - 30) < 1e-9 && r.v2.distance === 400 && r.v2.ortho === true && r.v3.ortho === false && Math.abs(r.v3.look) < 1e-9);
  chk(`api: select → selection() ${JSON.stringify(r.selRead)}; add/remove → ${r.selAdd}/${r.selRem}; micro:selection ${JSON.stringify(r.selEv)}; bad rec rejects; clear → ${r.selCleared}`,
    r.selN === 3 && r.selRead.count === 3 && JSON.stringify(r.selRead.records) === '[1,5,7]' && r.selRead.typed && r.selAdd === 4 && r.selRem === 3
    && r.selEv.length >= 3 && r.selEv.every((e) => e.layer === r.selEv[0].layer) && r.selEv[r.selEv.length - 1].count === 3 && /not a record/.test(r.selBad) && r.selCleared === 0);
  chk(`api: snapshot({ scale: 2 }) → ${r.snap.type} ${r.snap.w}×${r.snap.h} (canvas ${r.snap.cw}×${r.snap.ch}), ${r.snap.size} bytes; decorations: false too`,
    r.snap.type === 'image/png' && r.snap.w === 2 * r.snap.cw && r.snap.h === 2 * r.snap.ch && r.snap.size > 1000 && r.snapPlain);
  chk(`audit: filter() on a background layer leaves the focus (${r.fA.active}) and the box (“${r.fA.box}”) alone; its filter SURVIVES its re-read (${JSON.stringify(r.fAfter)})`,
    r.fA.expr === 'AU > 20' && r.fA.mask && r.fA.box === '' && r.fAfter.expr === 'AU > 20' && r.fAfter.drawn === 3);
  chk(`audit: two layers filtered at once both finish (${JSON.stringify(r.both)})`, r.both[0] === 5 && r.both[1] === 2);
  chk(`audit: a FAILED re-read keeps the original layer and renames nothing (${JSON.stringify(r.failKeep.after)})`,
    r.failKeep.still && JSON.stringify(r.failKeep.before) === JSON.stringify(r.failKeep.after));
  await p.close();
}

// B: an ingested layer is a file-backed layer — it saves into a project folder
// and comes back from it (blocks with host-ordered categories, sub-blocks, a drillhole set)
async function projectRoundTrip(url, proj) {
  const mk = async () => {
    const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); ok = false; });
    await p.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
    await p.evaluate((pr) => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(pr, { create: true }); }, proj);
    return p;
  };
  let p = await mk();
  await p.evaluate(async () => {
    const m = window._micro;
    const n = 12, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), codes = new Uint8Array(n), au = new Float64Array(n);
    for (let k = 0; k < n; k++) { x[k] = 5 + (k % 4) * 10; y[k] = 5 + Math.floor(k / 4) * 10; z[k] = 5; codes[k] = k % 2; au[k] = k; }
    await m.addLayer({ kind: 'blocks', name: 'rt_blocks', columns: { X: x, Y: y, Z: z, AU: au, ROCK: { codes, labels: ['Zeta', 'Alpha'] } }, roles: { x: 'X', y: 'Y', z: 'Z', value: 'AU', category: 'ROCK' } });
    await m.addLayer({
      kind: 'drillholes', name: 'rt_holes',
      collar: { columns: { H: ['A'], X: Float64Array.from([0]), Y: Float64Array.from([0]), Z: Float64Array.from([10]) }, roles: { bhid: 'H', x: 'X', y: 'Y', z: 'Z' } },
      survey: { columns: { H: ['A'], D: Float64Array.from([0]), AZ: Float64Array.from([0]), DIP: Float64Array.from([90]) }, roles: { bhid: 'H', at: 'D', az: 'AZ', dip: 'DIP' } },
      intervals: { columns: { H: ['A', 'A'], F: Float64Array.from([0, 1]), T: Float64Array.from([1, 2]), NOTE: ['x, "y"', 'z'] }, roles: { bhid: 'H', from: 'F', to: 'T' } },
    });
    m.setAutoOptimize('off');
  });
  p.evaluate(() => window._micro.saveProjectAs());
  await p.waitForFunction(() => document.querySelector('#svDlg').classList.contains('show') || /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 30000 });
  await p.evaluate(() => { const d = document.querySelector('#svDlg'); if (d.classList.contains('show')) document.querySelector('#svCopy').click(); });
  await p.waitForFunction(() => /project saved/.test(document.querySelector('#meta').textContent), null, { timeout: 60000 });
  await p.close();
  p = await mk();
  await p.evaluate(async (pr) => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(pr); await window._micro.openProjectDir(dir); }, proj);
  await p.waitForFunction(() => window._micro.layers().length >= 2, null, { timeout: 60000 });
  const r = await p.evaluate(() => {
    const Ls = window._micro.layers();
    const B = Ls.find((L) => L.docs.blockDoc), D = Ls.find((L) => L.docs.dhDoc);
    return { b: B && [B.docs.blockDoc.header.count, JSON.stringify(B.docs.blockDoc.header.categories), !!B.docs.blockDoc.header.grid], d: D && [D.docs.dhDoc.header.count, D.docs.dhDoc.header.holes] };
  });
  chk(`B project round trip: blocks ${JSON.stringify(r.b)}, drillholes ${JSON.stringify(r.d)}`, r.b && r.b[0] === 12 && r.b[1] === '["Zeta","Alpha"]' && r.b[2] && r.d && r.d[0] === 2 && r.d[1] === 1);
  await p.close();
}

try {
  if (process.env.ONLY === 'api') {                       // ONLY=api: just the window.micro checks (dev tree + built)
    await apiChecks('/tools/micro/index.html', 'dev tree');
    await api2Checks('/tools/micro/index.html', 'dev tree');
    await apiChecks('/micro.html', 'built micro.html');
    await api2Checks('/micro.html', 'built micro.html');
    console.log(ok ? 'PASS' : 'FAIL'); await b.close(); server.close(); process.exit(ok ? 0 : 1);
  }
  await run('/tools/micro/index.html', 'dev tree');
  await projectRoundTrip('/tools/micro/index.html', 'hostrt');
  await rotatedChecks('/tools/micro/index.html', 'dev tree');
  await fileChecks('/tools/micro/index.html', 'dev tree');
  await pickChecks('/tools/micro/index.html', 'dev tree');
  await apiChecks('/tools/micro/index.html', 'dev tree');
  await api2Checks('/tools/micro/index.html', 'dev tree');
  await run('/micro.html', 'built micro.html');
  await rotatedChecks('/micro.html', 'built micro.html');
  await fileChecks('/micro.html', 'built micro.html');
  await pickChecks('/micro.html', 'built micro.html');
  await apiChecks('/micro.html', 'built micro.html');
  await api2Checks('/micro.html', 'built micro.html');
} finally {
  await b.close(); server.close();
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
