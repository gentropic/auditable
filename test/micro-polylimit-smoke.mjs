// micro smoke — POLYGONS AS LIMITS + EXTRUSION TO SOLIDS (wave 4b).
//   §1 the limit on the analyses — grade-tonnage, stats and swath limited to a polygon (with a hole,
//      picked by feature id and by `where`) = a hand count of the block centroids inside; the GT
//      window's "inside" row runs to the same tonnes; the routine contract (`limit:` checked,
//      a selection refused in a routine)
//   §2 cut / fill inside a PERIMETER = the analytic volume (Δz × the polygon's exact area, the cells
//      on the boundary counted by their covered share); the window's perimeter row
//   §3 the point-cloud DEM limited to a polygon: only the points inside are gridded (a hand count),
//      the nodes whose cells the polygon misses are blank
//   §4 extrusion — the routine tool `extrude`: a z-range prism (volume = area × height, the layer's
//      mesh watertight), the by-solid FRACTION on a synthetic model = the analytic overlap per block
//      (the flagship: a blast polygon → grade and tonnes in the shot, exact at the edges), an
//      oriented prism, a solid between a gridded surface and a level (volume = the analytic
//      integral) and its winding fraction; select / flag by the extruded solid
// Every expected value is worked out here from the fixture geometry, not read back from micro.
// Run: node test/micro-polylimit-smoke.mjs (the dev tree) · --built (micro.html).
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { clipRectArea, ringAreaXY } from '../tools/micro/src/coverage.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-polylimit-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── fixtures: a 20 × 20 × 6 model of 10 m blocks; a pentagon pit with a hole; a blast rectangle ──
const E0 = 612000, N0 = 7765000, NX = 20, NY = 20, NZ = 6, B = 10;
const auOf = (i, j, k) => 1 + ((i + 2 * j + k) % 7) * 0.5;
const PIT = [[12.3, 8.1], [150.2, 20.7], [180.9, 120.4], [90.5, 178.8], [20.1, 110.6]].map(([x, y]) => [E0 + x, N0 + y]);
const HOLE = [[70.4, 60.3], [105.6, 60.3], [105.6, 95.2], [70.4, 95.2]].map(([x, y]) => [E0 + x, N0 + y]);
const BL = { x0: E0 + 23.7, x1: E0 + 71.3, y0: N0 + 18.2, y1: N0 + 56.9 };
const BLAST = [[BL.x0, BL.y0], [BL.x1, BL.y0], [BL.x1, BL.y1], [BL.x0, BL.y1]];
const wkt = (rings, z) => `POLYGON Z (${rings.map((r) => '(' + [...r, r[0]].map((p) => `${p[0]} ${p[1]} ${z}`).join(', ') + ')').join(', ')})`;
const LIMITS = ['NAME\tBENCH\tWKT', `pit\t850\t${wkt([PIT, HOLE], 850)}`, `blast\t850\t${wkt([BLAST], 850)}`].join('\n') + '\n';
const pip = (rings, x, y) => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const PIT_AREA = Math.abs(ringAreaXY(PIT)) - Math.abs(ringAreaXY(HOLE));
const BL_AREA = (BL.x1 - BL.x0) * (BL.y1 - BL.y0);
// by hand: the blocks whose centroid lies inside the pit
let nIn = 0, auIn = 0;
const inBlocks = [];
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const x = E0 + 5 + B * i, y = N0 + 5 + B * j;
  if (pip([PIT, HOLE], x, y)) { nIn++; auIn += auOf(i, j, k); inBlocks.push([i, j, k]); }
}

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
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const near = (a, b2, tol) => Number.isFinite(a) && Math.abs(a - b2) <= tol;
// an ESRI ASCII grid (node-centred: xllcorner = x0 − cell/2)
const ascOf = (g) => [`ncols ${g.nx}`, `nrows ${g.ny}`, `xllcorner ${g.x0 - g.dx / 2}`, `yllcorner ${g.y0 - (g.ny - 1) * g.dx - g.dx / 2}`, `cellsize ${g.dx}`, 'NODATA_value -9999',
  ...Array.from({ length: g.ny }, (_, r) => Array.from({ length: g.nx }, (_, c) => +g.z(g.x0 + c * g.dx, g.y0 - r * g.dx).toFixed(4)).join(' '))].join('\n') + '\n';
const grid = (z, dx = 2) => ({ nx: Math.round(240 / dx) + 1, ny: Math.round(240 / dx) + 1, x0: E0 - 20, y0: N0 + 220, dx, z });

try {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  await evaluateSettled(p, async ({ E0, N0, NX, NY, NZ, B, LIMITS, auSrc }) => {
    const M = window._micro, auOf = eval(auSrc), n = NX * NY * NZ;
    try { M.setAutoOptimize('off'); M.setAutoPack('off'); } catch { /* older builds */ }
    const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), AU = new Float64Array(n);
    let r = 0;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { X[r] = E0 + 5 + B * i; Y[r] = N0 + 5 + B * j; Z[r] = 805 + B * k; AU[r] = auOf(i, j, k); r++; }
    await M.addLayer({ kind: 'blocks', name: 'resource', columns: { XC: X, YC: Y, ZC: Z, AU }, roles: { x: 'XC', y: 'YC', z: 'ZC', value: 'AU' } });
    await M.openBlob(new File([LIMITS], 'limits.csv'), 'limits.csv', 'add');
  }, { E0, N0, NX, NY, NZ, B, LIMITS, auSrc: auOf.toString() });

  // ═══ §1 the limit on the analyses ═══
  const r1 = await evaluateSettled(p, async () => {
    const M = window._micro, out = {};
    out.poly = M.isPolygonLayer(M.layers().find((L) => L.name === 'limits.csv'));
    const gt = await M.runTool('gt', { layer: 'resource', series: [{ col: 'AU', weight: '2.5' }], cutoffs: [0], limit: { layer: 'limits.csv', feature: 'pit' } });
    out.gt = gt.table.rows[0];
    const all = await M.runTool('gt', { layer: 'resource', series: [{ col: 'AU', weight: '2.5' }], cutoffs: [0] });
    out.gtAll = all.table.rows[0];
    const st = await M.runTool('stats', { layer: 'resource', cols: ['AU'], limit: { layer: 'limits.csv', where: 'NAME == "pit" and BENCH == 850' } });
    out.stats = st.table.rows[0];
    const sw = await M.runTool('swath', { layer: 'resource', series: [{ col: 'AU' }], bandW: [10, 10, 10], limit: { layer: 'limits.csv', feature: 'pit' } });
    out.swath = sw.table.rows.filter((r) => r[1] === sw.table.rows[0][1]).reduce((s, r) => s + r[3], 0);
    // the routine contract
    out.bad = M.checkParams('gt', { layer: 'resource', series: [{ col: 'AU' }], cutoffs: [0], limit: { layer: 'limits.csv', selected: true } }, { routine: true }).errors;
    out.typo = M.checkParams('stats', { layer: 'resource', cols: ['AU'], limit: { layer: 'limits.csv', feature: 'pit', wher: 'x' } }).errors;
    out.okR = M.checkParams('gt', { layer: 'resource', series: [{ col: 'AU' }], cutoffs: [0], limit: { layer: 'limits.csv', where: 'NAME == "pit"' } }, { routine: true }).errors;
    try { await M.runTool('gt', { layer: 'resource', series: [{ col: 'AU' }], cutoffs: [0], limit: { layer: 'limits.csv', feature: 'nope' } }); out.none = 'ran'; } catch (e) { out.none = e.message; }
    // the window: the "inside" row, then Run
    const L = M.layers().find((q) => (q.label || q.name) === 'resource'); M.setActiveLayer(L.id);
    M.openGradeTonnage(L);
    const w = [...document.querySelectorAll('.fwin')].find((x) => /grade-tonnage/.test(x.textContent));
    const ls = w.querySelector('select[data-role=limit-layer]');
    out.opts = [...ls.options].map((o) => o.textContent);
    ls.value = 'limits.csv'; ls.dispatchEvent(new Event('change'));
    await new Promise((z) => setTimeout(z, 50));
    const fs2 = w.querySelector('select[data-role=limit-feature]');
    fs2.value = 'pit'; fs2.dispatchEvent(new Event('change'));
    for (let t = 0; t < 200 && !/inside/.test(w.querySelector('.fwin-sub, .sub, [class*=sub]') ? w.textContent : ''); t++) await new Promise((z) => setTimeout(z, 50));
    for (let t = 0; t < 400 && !(w._tableTSV && w._tableTSV()); t++) await new Promise((z) => setTimeout(z, 50));   // the TABLE's text, not just its getter: under load the getter exists before Run fills it
    await new Promise((z) => setTimeout(z, 400));
    const tsv = w._tableTSV ? w._tableTSV() : '';
    out.win = { tsv, sub: w.textContent.match(/inside limits\.csv · pit/) ? 'inside limits.csv · pit' : '' };
    w.remove();
    return out;
  });
  const t1 = nIn * 1000 * 2.5;
  chk(`limits.csv opens as polygons; by hand ${nIn} of ${NX * NY * NZ} block centroids lie inside the pit (a pentagon with a hole, area ${PIT_AREA.toFixed(2)} m²)`, r1.poly && nIn > 300 && nIn < 1800);
  chk(`GT limited to feature “pit”: ${r1.gt[2]} t at cutoff 0 = hand ${t1} t, grade ${(+r1.gt[3]).toFixed(6)} = hand mean ${(auIn / nIn).toFixed(6)}`, near(r1.gt[2], t1, 1e-6 * t1) && near(r1.gt[3], auIn / nIn, 1e-9));
  chk(`… against the whole model ${r1.gtAll[2]} t (the limit really limits)`, near(r1.gtAll[2], NX * NY * NZ * 2500, 1e-3));
  chk(`stats limited by where (NAME == "pit" and BENCH == 850): n ${r1.stats[1]} = hand ${nIn}, mean = hand`, r1.stats[1] === nIn && near(r1.stats[2], auIn / nIn, 1e-9));
  chk(`swath limited to the pit: the bands hold ${r1.swath} blocks = hand ${nIn}`, r1.swath === nIn);
  chk(`routine contract: a selection-limit is refused in a routine (“${(r1.bad[0] || '').slice(0, 70)}…”), a misspelt key named, a where-limit passes`, r1.bad.some((e) => /selection/.test(e)) && r1.typo.some((e) => /wher/.test(e)) && !r1.okR.length);
  chk(`a limit that matches nothing says so: “${r1.none.slice(0, 70)}”`, /no polygon/.test(r1.none));
  chk(`GT window: the “inside” row lists the polygon layer (${r1.opts.join(' | ')}); picking pit + Run → the same tonnes`, r1.opts.some((o) => /limits\.csv/.test(o)) && r1.win.tsv.split('\n').some((l) => l.split('\t').some((c) => Math.abs(+c - t1) < 1e-3 * t1)));

  // ═══ §1b a limit AND an edited selection (sweep 2026-11-25: applyLimit cached selection ∩ limit by
  //     the selection ARRAY, and add-mode selections edit it in place → the old answer came back) ═══
  {
    const half = NX * NY * (NZ / 2);                                    // records are i + NX·j + NX·NY·k: benches 0–2 first
    const want1 = inBlocks.filter(([, , k]) => k < NZ / 2).length, want2 = nIn;
    const r1b = await evaluateSettled(p, async ({ half, n }) => {
      const M = window._micro, L = M.layers().find((q) => (q.label || q.name) === 'resource');
      const run = async () => (await M.runTool('stats', { layer: 'resource', cols: ['AU'], scope: 'selection', limit: { layer: 'limits.csv', feature: 'pit' } })).table.rows[0][1];
      await window.micro.select(L.id, Array.from({ length: half }, (_, i) => i), { mode: 'replace' });
      const a = await run();
      await window.micro.select(L.id, Array.from({ length: n - half }, (_, i) => half + i), { mode: 'add' });   // edits the SAME selection array
      const b2 = await run();
      M.clearSelection();
      return { a, b: b2 };
    }, { half, n: NX * NY * NZ });
    chk(`limit ∩ selection: benches 0–2 selected → n ${r1b.a} = hand ${want1}; add benches 3–5 to the same selection → n ${r1b.b} = hand ${want2}`, r1b.a === want1 && r1b.b === want2);
  }

  // ═══ §2 cut / fill inside a perimeter ═══
  const r2 = await evaluateSettled(p, async ({ A, Bt }) => {
    const M = window._micro;
    await M.openBlob(new File([A], 'before.asc'), 'before.asc', 'add');
    await M.openBlob(new File([Bt], 'after.asc'), 'after.asc', 'add');
    const lim = await M.runTool('cutfill', { before: 'before.asc', after: 'after.asc', limit: { layer: 'limits.csv', feature: 'pit' }, layer: false });
    const all = await M.runTool('cutfill', { before: 'before.asc', after: 'after.asc', layer: false });
    const blast = await M.runTool('cutfill', { before: 'before.asc', after: 'after.asc', limit: { layer: 'limits.csv', feature: 'blast' }, layer: true, name: 'dz_blast' });
    const DL = M.layers().find((q) => q.name === 'dz_blast.asc'), g = DL.docs.gridDoc.grid;
    let filled = 0; for (const v of g.data) if (v !== g.nodata) filled++;
    // the window: the perimeter row, Run
    M.COMMANDS.find((c) => c.id === 'cutfill').run({ L: null });
    const w = document.querySelector('.fwin[data-cutfill]');
    const sels = [...w.querySelectorAll('select')];
    sels.find((s) => s.dataset.role === 'before').value = String(M.layers().find((q) => q.name === 'before.asc').id); sels.find((s) => s.dataset.role === 'before').dispatchEvent(new Event('change'));
    sels.find((s) => s.dataset.role === 'after').value = String(M.layers().find((q) => q.name === 'after.asc').id); sels.find((s) => s.dataset.role === 'after').dispatchEvent(new Event('change'));
    const cb = [...w.querySelectorAll('input[type=checkbox]')][0]; cb.checked = false; cb.dispatchEvent(new Event('change'));
    const ls = w.querySelector('select[data-role=limit-layer]'); ls.value = 'limits.csv'; ls.dispatchEvent(new Event('change'));
    const fs2 = w.querySelector('select[data-role=limit-feature]'); fs2.value = 'pit'; fs2.dispatchEvent(new Event('change'));
    w.querySelector('.sw-run').click();
    for (let t = 0; t < 400 && !/perimeter/.test(w.querySelector('.cf-readout').textContent); t++) await new Promise((z) => setTimeout(z, 50));
    const ro = w.querySelector('.cf-readout').textContent;
    w.remove();
    return { lim: lim.values, all: all.values, blast: blast.values, filled, gnodes: g.nx * g.ny, ro };
  }, { A: ascOf(grid(() => 900)), Bt: ascOf(grid(() => 885)) });
  chk(`cut / fill inside the pit perimeter: cut ${r2.lim.cut.toFixed(3)} m³ = 15 m × the polygon's area ${(15 * PIT_AREA).toFixed(3)} m³ (boundary cells by their covered share)`, near(r2.lim.cut, 15 * PIT_AREA, 1e-5 * 15 * PIT_AREA));
  chk(`… the perimeter's own area reported ${r2.lim.perimeter_area.toFixed(4)} = ${PIT_AREA.toFixed(4)} m²; the covered area ${r2.lim.area.toFixed(3)} = it (both surfaces cover it)`, near(r2.lim.perimeter_area, PIT_AREA, 1e-6) && near(r2.lim.area, PIT_AREA, 1e-5 * PIT_AREA));
  chk(`… against the whole overlap ${Math.round(r2.all.cut)} m³ (no perimeter) — the blast: ${r2.blast.cut.toFixed(3)} = 15 × ${BL_AREA.toFixed(2)}`, r2.all.cut > r2.lim.cut * 1.5 && near(r2.blast.cut, 15 * BL_AREA, 1e-5 * 15 * BL_AREA));
  chk(`the blast's Δz layer is cut to the perimeter: ${r2.filled} of ${r2.gnodes} nodes carry a value`, r2.filled > 400 && r2.filled < 700 && r2.gnodes < 1000);
  chk(`cut / fill window: the perimeter row + Run → the readout states the perimeter (“${r2.ro.replace(/\s+/g, ' ').slice(0, 90)}”)`, /perimeter/.test(r2.ro) && new RegExp(Math.round(15 * PIT_AREA).toLocaleString('en-US').replace(/,/g, '[,.\\s ]?')).test(r2.ro));

  // ═══ §3 the point-cloud DEM limited to a polygon ═══
  const pts = []; for (let y = 0; y <= 200; y += 2) for (let x = 0; x <= 200; x += 2) pts.push([E0 + x, N0 + y, 850 + 0.01 * x]);
  const ptsIn = pts.filter(([x, y]) => pip([PIT, HOLE], x, y)).length;
  const r3 = await evaluateSettled(p, async ({ X, Y, Z }) => {
    const M = window._micro;
    await M.addLayer({ kind: 'points', name: 'cloud', columns: { x: Float64Array.from(X), y: Float64Array.from(Y), z: Float64Array.from(Z) }, roles: { x: 'x', y: 'y', z: 'z' } });
    const res = await M.runTool('pcgrid', { layer: 'cloud', cell: 5, stat: 'mean', limit: { layer: 'limits.csv', feature: 'pit' } });
    const g = M.layers().find((q) => q.name === res.layers[0]).docs.gridDoc.grid;
    return { values: res.values, g: { nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, dx: g.dx, data: Array.from(g.data), nodata: g.nodata }, lin: M.layers().find((q) => q.name === res.layers[0]).lineage };
  }, { X: pts.map((q) => q[0]), Y: pts.map((q) => q[1]), Z: pts.map((q) => q[2]) });
  let badNode = 0, filledNodes = 0;
  for (let rr = 0; rr < r3.g.ny; rr++) for (let c = 0; c < r3.g.nx; c++) {
    const v = r3.g.data[rr * r3.g.nx + c]; if (v === r3.g.nodata) continue;
    filledNodes++;
    const x = r3.g.x0 + c * r3.g.dx, y = r3.g.y0 - rr * r3.g.dx, h = r3.g.dx / 2;
    const cov = clipRectArea(PIT, x - h, y - h, x + h, y + h) - clipRectArea(HOLE, x - h, y - h, x + h, y + h);
    if (!(cov > 0)) badNode++;
  }
  chk(`pcgrid limited to the pit: ${r3.values.points} points gridded = hand ${ptsIn} inside (of ${pts.length})`, r3.values.points === ptsIn);
  chk(`… ${filledNodes} nodes carry a value, every one of them on a cell the pit covers (${badNode} outside); the lattice is cut to the pit's bbox (${r3.g.nx} × ${r3.g.ny}); lineage names the limit`, filledNodes > 500 && badNode === 0 && r3.g.nx <= 40 && r3.lin && r3.lin.params.limit && r3.lin.params.limit.feature === 'pit');

  // ═══ §4 extrusion ═══
  const Z0 = 822.5, Z1 = 846.3;
  // the exact fraction of every block in the blast prism, by hand
  const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const exact = new Map();
  let volHand = 0, tonHand = 0, metalHand = 0;
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = E0 + 5 + B * i, y = N0 + 5 + B * j, z = 805 + B * k;
    const f = ov(x - 5, x + 5, BL.x0, BL.x1) * ov(y - 5, y + 5, BL.y0, BL.y1) / 100 * ov(z - 5, z + 5, Z0, Z1) / 10;
    if (f > 0) { exact.set(i + NX * (j + NY * k), f); volHand += f * 1000; }
  }
  const r4 = await evaluateSettled(p, async ({ Z0, Z1 }) => {
    const M = window._micro, out = {};
    out.chk = M.checkParams('extrude', { polygons: 'limits.csv', feature: 'blast', mode: 'zrange', z0: Z0, z1: Z1 }, { routine: true }).errors;
    out.miss = M.checkParams('extrude', { polygons: 'limits.csv', mode: 'zrange' }).errors;
    const res = await M.runTool('extrude', { polygons: 'limits.csv', feature: 'blast', mode: 'zrange', z0: Z0, z1: Z1, name: 'shot' });
    out.values = res.values; out.layers = res.layers;
    const S = M.layers().find((q) => q.name === 'shot.ply');
    const v = await M.meshVertexData(S);
    out.mf = M.manifoldCheck(v.vertices, v.triangles);
    out.lin = S.lineage && { op: S.lineage.op, mode: S.lineage.params.mode, src: S.lineage.sources.length };
    out.prism = !!S._prism;
    // the by-solid fraction on the model → per-record values (code / 255)
    const L = M.layers().find((q) => (q.label || q.name) === 'resource');
    const col = await M.ratioBySolid(S, L, { name: 'SHOT' });
    out.codes = Array.from(col.codes);
    out.meta = document.querySelector('#meta').textContent;
    // grade and tonnes in the shot: weight = density × the fraction inside
    const gt = await M.runTool('gt', { layer: 'resource', series: [{ col: 'AU', weight: '2.5 * SHOT' }], cutoffs: [0] });
    out.gt = gt.table.rows[0];
    // select / flag by the extruded solid (centroids)
    await M.flagBySolid(S, [L], { name: 'INSHOT', label: 'IN' });
    const fc = L.paintCols && (L.paintCols.find ? L.paintCols.find((c) => c.name === 'INSHOT') : L.paintCols.INSHOT);
    out.flagged = fc ? Array.from(fc.codes).filter((c) => c > 0).length : -1;
    // oriented: trend 90, plunge 60, 30 m
    const o = await M.runTool('extrude', { polygons: 'limits.csv', feature: 'blast', mode: 'oriented', trend: 90, plunge: 60, length: 30, name: 'oriented' });
    const O = M.layers().find((q) => q.name === 'oriented.ply'), ov2 = await M.meshVertexData(O);
    out.oriented = { volume: o.values.volume, mf: M.manifoldCheck(ov2.vertices, ov2.triangles) };
    return out;
  }, { Z0, Z1 });
  chk(`routine tool extrude: checkParams passes as a routine; a z-range without z0/z1 is refused (“${(r4.miss[0] || '').slice(0, 50)}”)`, !r4.chk.length && r4.miss.some((e) => /z0 and z1/.test(e)));
  chk(`z-range prism of the blast: volume ${r4.values.volume.toFixed(4)} m³ = area × height ${(BL_AREA * (Z1 - Z0)).toFixed(4)}; layer ${r4.layers.join()} with lineage ${r4.lin && r4.lin.op}/${r4.lin && r4.lin.mode}`, near(r4.values.volume, BL_AREA * (Z1 - Z0), 1e-6 * BL_AREA * (Z1 - Z0)) && r4.lin && r4.lin.op === 'extrude' && r4.lin.mode === 'zrange' && r4.lin.src === 1);
  chk(`the layer's mesh (read back from the PLY) is watertight and outward: ${r4.mf.edges} edges, ${r4.mf.boundary} open, ${r4.mf.nonManifold} non-manifold, ${r4.mf.misoriented} flipped, volume ${r4.mf.volume.toFixed(3)}`, r4.mf.ok && near(r4.mf.volume, BL_AREA * (Z1 - Z0), 1e-6 * BL_AREA * (Z1 - Z0)));
  let worst = 0, sum = 0, ton = 0, metal = 0;
  for (let rec = 0; rec < r4.codes.length; rec++) {
    const f = exact.get(rec) || 0, c = r4.codes[rec];
    worst = Math.max(worst, Math.abs(c - Math.round(255 * f)));
    const q = +(c / 255).toFixed(3); sum += q * 1000; ton += 2.5 * q * 1000;   // a ratio column reads as code / 255 to 3 decimals (src/records.js extendRow)
    const i = rec % NX, j = Math.floor(rec / NX) % NY, k = Math.floor(rec / (NX * NY)); metal += 2.5 * q * 1000 * auOf(i, j, k);
  }
  tonHand = 2.5 * volHand;
  chk(`fraction inside the vertical prism (the exact path, ${r4.prism ? 'tagged' : 'NOT tagged'}): every one of ${r4.codes.length} blocks = round(255 × the hand overlap) (worst |Δcode| ${worst}) — ${exact.size} blocks touched`, r4.prism && worst === 0 && exact.size > 30);
  chk(`flagship: tonnes in the shot ${(+r4.gt[2]).toFixed(2)} = Σ 2.5 × fraction × 1000 ${ton.toFixed(2)} (analytic ${tonHand.toFixed(2)}, the u8 code within ${(exact.size * 2500 * (1 / 510 + 0.0005)).toFixed(1)} t); grade ${(+r4.gt[3]).toFixed(5)} = ${(metal / ton).toFixed(5)}`, near(r4.gt[2], ton, 1e-6 * ton) && near(r4.gt[3], metal / ton, 1e-9) && Math.abs(ton - tonHand) <= exact.size * 2500 * (1 / 510 + 0.0005));
  let flagHand = 0;
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = E0 + 5 + B * i, y = N0 + 5 + B * j, z = 805 + B * k; if (x >= BL.x0 && x <= BL.x1 && y >= BL.y0 && y <= BL.y1 && z >= Z0 && z <= Z1) flagHand++; }
  chk(`flag by the extruded solid: ${r4.flagged} blocks flagged = hand ${flagHand} centroids inside`, r4.flagged === flagHand);
  chk(`oriented prism (trend 90 / plunge 60, 30 m): volume ${r4.oriented.volume.toFixed(4)} = area × 30 × sin 60° ${(BL_AREA * 30 * Math.sin(Math.PI / 3)).toFixed(4)}, watertight`, near(r4.oriented.volume, BL_AREA * 30 * Math.sin(Math.PI / 3), 1e-6 * BL_AREA * 30) && r4.oriented.mf.ok);

  // between a sloping gridded surface and a level — the pit with its hole
  const topZ = (x) => 852 + 0.04 * (x - E0);
  // ∫∫ (top − 818) over the pit: (34 × A) + 0.04 × the first moment in x′
  const moment = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0] - E0, yi = r[i][1] - N0, xj = r[j][0] - E0, yj = r[j][1] - N0, c = xj * yi - xi * yj; s += (xi + xj) * c; } return Math.abs(s / 6); };
  const volBetween = 34 * PIT_AREA + 0.04 * (moment(PIT) - moment(HOLE));
  const r5 = await evaluateSettled(p, async ({ T }) => {
    const M = window._micro;
    await M.openBlob(new File([T], 'bench_top.asc'), 'bench_top.asc', 'add');
    const res = await M.runTool('extrude', { polygons: 'limits.csv', feature: 'pit', mode: 'between', top: 'bench_top.asc', bottom: 818, tol: 0.05, name: 'pit_domain' });
    const S = M.layers().find((q) => q.name === 'pit_domain.ply'), v = await M.meshVertexData(S);
    const L = M.layers().find((q) => (q.label || q.name) === 'resource');
    const col = await M.ratioBySolid(S, L, { name: 'PITFR', res: 4 });
    let sum = 0; for (const c of col.codes) sum += c / 255 * 1000;
    return { volume: res.values.volume, mf: M.manifoldCheck(v.vertices, v.triangles), sum, prism: !!S._prism, lin: S.lineage.params };
  }, { T: ascOf(grid(topZ, 4)) });
  chk(`between a sloping grid and a level (the pit, hole kept): volume ${r5.volume.toFixed(2)} = the analytic integral ${volBetween.toFixed(2)} (linear surfaces: exact), watertight`, near(r5.volume, volBetween, 1e-4 * volBetween) && r5.mf.ok && !r5.prism);
  chk(`… lineage carries top / bottom / tol and the measured deviation (${r5.lin.maxDeviation} m ≤ ${r5.lin.tol}); its WINDING fraction (4³ probes) sums to ${Math.round(r5.sum)} m³ — the solid's own volume ${Math.round(volBetween)} within 3%`, r5.lin.top === 'bench_top.asc' && r5.lin.bottom === '818' && r5.lin.maxDeviation <= 0.05 && Math.abs(r5.sum - volBetween) <= 0.03 * volBetween);
  await p.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
