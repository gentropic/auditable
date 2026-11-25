// micro smoke — AS-BUILT vs DESIGN: survey surfaces → mined volumes → reconciliation factors.
//   §1 point cloud → DEM (tool pcgrid; the layer menu's "Grid points to DEM…" + its dialog): a
//      synthetic terrain cloud — as a points layer AND as a real LAS file — gridded; the DEM equals
//      the analytic surface within a cell's slope; min ≤ mean ≤ max node by node
//   §2 cut / fill between two surfaces (tool cutfill + its window): grids of different cells; the
//      volumes equal the analytic pit and dump; the Δz layer is a sheet centred on 0
//   §3 factors with SURVEYS: a block model and three survey grids in date order; each period's
//      mined tonnes equal the blocks between the surveys, counted by hand (half blocks included)
// Every check compares with an answer worked out independently of micro.
// Run: node test/micro-asbuilt-smoke.mjs (the dev tree) · --built (micro.html).
import { chromium } from 'playwright';
import { installSmokeWaits } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-asbuilt-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── a LAS 1.2 file, point format 0 (the reader's own fixture shape) ──
function lasBytes(X, Y, Z, { scale = 0.001, cls = null } = {}) {
  const N = X.length, HS = 227, RL = 20, buf = Buffer.alloc(HS + N * RL), dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
  buf.write('LASF', 0, 'latin1');
  dv.setUint8(24, 1); dv.setUint8(25, 2);
  buf.write('micro-asbuilt-smoke', 26 + 32, 'latin1');
  dv.setUint16(94, HS, true); dv.setUint32(96, HS, true); dv.setUint32(100, 0, true);
  dv.setUint8(104, 0); dv.setUint16(105, RL, true); dv.setUint32(107, N, true); dv.setUint32(111, N, true);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) { const p = [X[i], Y[i], Z[i]]; for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } }
  const off = mn.map((v) => Math.floor(v));
  for (let k = 0; k < 3; k++) { dv.setFloat64(131 + 8 * k, scale, true); dv.setFloat64(155 + 8 * k, off[k], true); dv.setFloat64(179 + 16 * k, mx[k], true); dv.setFloat64(187 + 16 * k, mn[k], true); }
  for (let i = 0; i < N; i++) {
    const o = HS + i * RL;
    dv.setInt32(o, Math.round((X[i] - off[0]) / scale), true); dv.setInt32(o + 4, Math.round((Y[i] - off[1]) / scale), true); dv.setInt32(o + 8, Math.round((Z[i] - off[2]) / scale), true);
    dv.setUint16(o + 12, 100, true); dv.setUint8(o + 14, 0x09); dv.setUint8(o + 15, cls ? cls[i] : 2);
  }
  return buf;
}

// the terrain: UTM-sized, smooth; |∇f| < 0.3 m/m everywhere
const E0 = 612000, N0 = 7765000;
const terrain = (x, y) => 820 + 0.04 * (x - E0) - 0.02 * (y - N0) + 5 * Math.sin((x - E0) / 50) * Math.cos((y - N0) / 40);
const SLOPE = 0.04 + 0.02 + 5 / 50 + 5 / 40;
let seed = 7;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const CLOUD_N = 120000, CX = new Float64Array(CLOUD_N), CY = new Float64Array(CLOUD_N), CZ = new Float64Array(CLOUD_N), CCLS = new Uint8Array(CLOUD_N);
for (let i = 0; i < CLOUD_N; i++) {
  CX[i] = E0 + rnd() * 300; CY[i] = N0 + rnd() * 240; CZ[i] = terrain(CX[i], CY[i]);
  if (i % 4 === 3) { CZ[i] += 2 + 6 * rnd(); CCLS[i] = 5; } else CCLS[i] = 2;    // a quarter "vegetation", up to 8 m above ground
}
const LAS = lasBytes(CX, CY, CZ, { cls: CCLS });

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
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('micro.swRender') == null) localStorage.setItem('micro.swRender', 'off'); } catch { /* opaque origin */ } });   // CI draws on SwiftShader: keep software-rendering mode off
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };
const mkPage = async () => {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });
  return p;
};
// a single-IFD float32 GeoTIFF with separate column / row spacing (PixelIsPoint: the tiepoint is
// node (0,0) at x0, y0; rows go south by dy)
function geoTiffDxDy(W, H, dx, dy, x0, y0, val) {
  const f32le = (vals) => { const b = new Uint8Array(vals.length * 4), v = new DataView(b.buffer); vals.forEach((x, i) => v.setFloat32(i * 4, x, true)); return b; };
  const dblle = (vals) => { const b = new Uint8Array(vals.length * 8), v = new DataView(b.buffer); vals.forEach((x, i) => v.setFloat64(i * 8, x, true)); return b; };
  const img = f32le(Array.from({ length: W * H }, (_, i) => val((i / W) | 0, i % W)));
  // GeoKeyDirectory: version 1.1.0, 1 key — GTRasterTypeGeoKey (1025) = 2 (RasterPixelIsPoint)
  const keys = [1, 1, 0, 1, 1025, 0, 1, 2];
  const defs = [
    [256, 3, 1, [W]], [257, 3, 1, [H]], [258, 3, 1, [32]], [259, 3, 1, [1]], [262, 3, 1, [1]],
    [273, 4, 1, 'IMG'], [277, 3, 1, [1]], [278, 3, 1, [H]], [279, 4, 1, [img.length]], [339, 3, 1, [3]],
    [33550, 12, 3, dblle([dx, dy, 0])], [33922, 12, 6, dblle([0, 0, 0, x0, y0, 0])], [34735, 3, keys.length, keys],
  ].sort((a, b) => a[0] - b[0]);
  const headLen = 8 + 2 + defs.length * 12 + 4;
  const u16 = (a, v) => a.push(v & 255, v >> 8), u32 = (a, v) => a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  let tailOff = headLen; const body = [], tails = [];
  u16(body, defs.length);
  for (const [tag, type, count, v] of defs) {
    u16(body, tag); u16(body, type); u32(body, count);
    if (v === 'IMG') { u32(body, 0); continue; }
    let vb = v;
    if (Array.isArray(v)) { const a = []; for (const x of v) (type === 3 ? u16 : u32)(a, x); vb = new Uint8Array(a); }
    if (vb.length <= 4) body.push(...vb, ...new Array(4 - vb.length).fill(0));
    else { u32(body, tailOff); tails.push(vb); tailOff += vb.length; }
  }
  u32(body, 0);
  const imgOff = tailOff;
  const file = new Uint8Array(8 + body.length + tails.reduce((t, b) => t + b.length, 0) + img.length);
  file.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]); file.set(body, 8);
  let o = headLen; for (const t of tails) { file.set(t, o); o += t.length; } file.set(img, o);
  const dv = new DataView(file.buffer);
  for (let i = 0; i < defs.length; i++) { const e = 8 + 2 + i * 12; if (dv.getUint16(e, true) === 273) dv.setUint32(e + 8, imgOff, true); }
  return file;
}
// an ESRI ASCII grid as text (node-centred: xllcorner = x0 − cell/2)
const ascOf = (g) => [`ncols ${g.nx}`, `nrows ${g.ny}`, `xllcorner ${g.x0 - g.dx / 2}`, `yllcorner ${g.y0 - (g.ny - 1) * g.dx - g.dx / 2}`, `cellsize ${g.dx}`, 'NODATA_value -9999',
  ...Array.from({ length: g.ny }, (_, r) => Array.from({ length: g.nx }, (_, c) => +g.z(g.x0 + c * g.dx, g.y0 - r * g.dx).toFixed(4)).join(' '))].join('\n') + '\n';

try {
  // ═══ §1 point cloud → DEM ═══
  {
    const p = await mkPage();
    const id = await p.evaluate(async ({ X, Y, Z }) => window._micro.addLayer({ kind: 'points', name: 'terrain', columns: { x: Float64Array.from(X), y: Float64Array.from(Y), z: Float64Array.from(Z) }, roles: { x: 'x', y: 'y', z: 'z' } }),
      { X: Array.from(CX.subarray(0, 60000)), Y: Array.from(CY.subarray(0, 60000)), Z: Array.from(CZ.subarray(0, 60000)).map((z, i) => (i % 4 === 3 ? terrain(CX[i], CY[i]) : z)) });
    // the layer menu offers it (Geometry), and the palette has the same verb
    const menu = await p.evaluate((lid) => {
      const M = window._micro, L = M.layers().find((q) => q.id === lid);
      const walk = (items) => items.flatMap((it) => [it.label, ...(Array.isArray(it.submenu) ? walk(it.submenu) : typeof it.submenu === 'function' ? walk(it.submenu()) : [])]);
      return { labels: walk(M.layerMenuSections(L, 100, 100)).filter(Boolean), cmd: !!M.COMMANDS.find((c) => c.id === 'pcgrid') };
    }, id);
    chk(`the points layer's menu offers “Grid points to DEM…”, and the palette has it (pcgrid)`, menu.labels.includes('Grid points to DEM…') && menu.cmd);
    // the tool: 5 m mean DEM on round nodes; every node vs the analytic surface
    const r = await p.evaluate(async () => {
      const M = window._micro, res = await M.runTool('pcgrid', { layer: 'terrain', cell: 5, stat: 'mean' });
      const G = M.layers().find((q) => q.name === res.layers[0]), g = G.docs.gridDoc.grid;
      return { values: res.values, name: res.layers[0], g: { nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, dx: g.dx, data: Array.from(g.data), nodata: g.nodata }, lin: G.lineage && G.lineage.op };
    });
    const tol = SLOPE * 5 * Math.SQRT1_2 + 0.002;
    let worst = 0, n = 0;
    for (let rr = 0; rr < r.g.ny; rr++) for (let c = 0; c < r.g.nx; c++) { const v = r.g.data[rr * r.g.nx + c]; if (v === r.g.nodata) continue; n++; worst = Math.max(worst, Math.abs(v - terrain(r.g.x0 + c * 5, r.g.y0 - rr * 5))); }
    chk(`pcgrid: ${r.values.points.toLocaleString()} points → ${r.values.filled}/${r.values.nodes} nodes on round 5 m nodes (x0 ${r.g.x0}), lineage ${r.lin}`, r.values.points === 60000 && r.g.x0 % 5 === 0 && r.g.y0 % 5 === 0 && r.values.filled > 0.97 * r.values.nodes && r.lin === 'pcgrid');
    chk(`DEM = the analytic surface within a cell's slope: worst |Δ| ${worst.toFixed(3)} m ≤ ${tol.toFixed(3)} over ${n} nodes`, n > 2500 && worst <= tol);
    // the LAS file: min ignores the vegetation (class 5 sits 2–8 m up), max sees it; a filter keeps the ground
    // (handed over as base64 — micro's CSP has connect-src 'none', so the page can't fetch it)
    const las = await p.evaluate(async (b64) => {
      const M = window._micro, bin = atob(b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const lid = await M.openBlob(new File([buf], 'flight.las'), 'flight.las', 'add');
      const grid = async (stat, extra = {}) => { const res = await M.runTool('pcgrid', { layer: 'flight.las', cell: 10, stat, ...extra }); const g = M.layers().find((q) => q.name === res.layers[0]).docs.gridDoc.grid; return { values: res.values, g: { nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, data: Array.from(g.data), nodata: g.nodata } }; };
      return { lid, min: await grid('min'), mean: await grid('mean'), max: await grid('max'), ground: await grid('mean', { filter: 'Classification == 2', name: 'ground' }), kind: M.layers().find((q) => q.id === lid).kind };
    }, LAS.toString('base64'));
    let ordered = true, minWorst = 0, groundWorst = 0, maxAbove = 0, cnt = 0;
    const g = las.min.g, tol10 = SLOPE * 10 * Math.SQRT1_2 + 0.002;
    for (let k = 0; k < g.data.length; k++) {
      const a = las.min.g.data[k], m = las.mean.g.data[k], z = las.max.g.data[k]; if (a === g.nodata) continue;
      cnt++; if (!(a <= m + 1e-3 && m <= z + 1e-3)) ordered = false;
      const t = terrain(g.x0 + (k % g.nx) * 10, g.y0 - Math.floor(k / g.nx) * 10);
      minWorst = Math.max(minWorst, Math.abs(a - t)); groundWorst = Math.max(groundWorst, Math.abs(las.ground.g.data[k] - t)); maxAbove = Math.max(maxAbove, z - t);
    }
    chk(`LAS (${las.mean.values.points.toLocaleString()} points, kind ${las.kind}): min ≤ mean ≤ max at every one of ${cnt} nodes`, las.mean.values.points === CLOUD_N && ordered && cnt > 600);
    chk(`min Z = the ground under 25% “vegetation”: worst ${minWorst.toFixed(3)} m; the ground class (Classification == 2) mean: worst ${groundWorst.toFixed(3)} m (≤ ${tol10.toFixed(3)}); max sees the canopy (+${maxAbove.toFixed(1)} m)`, minWorst <= tol10 && groundWorst <= tol10 && las.ground.values.points === CLOUD_N * 3 / 4 && maxAbove > 5);
    // the dialog: palette command → Grid → a new grid layer, matching an existing lattice
    const d = await p.evaluate(async () => {
      const M = window._micro, n0 = M.layers().length;
      const L = M.layers().find((q) => (q.label || q.name) === 'terrain'); M.setActiveLayer(L.id);
      M.COMMANDS.find((c) => c.id === 'pcgrid').run({ L });
      const w = document.querySelector('.fwin[data-pcgrid]');
      const lat = [...w.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.startsWith('match:')));
      lat.value = [...lat.options].find((o) => o.textContent.includes('ground')).value; lat.dispatchEvent(new Event('change'));
      w.querySelector('button[data-go]').click();
      const msgOf = () => [...w.querySelectorAll('span')].map((s) => s.textContent).find((t) => /points →/.test(t));
      for (let t = 0; t < 400 && !msgOf(); t++) await new Promise((r2) => setTimeout(r2, 50));   // the dialog says what it made once the layer is open
      const NL = M.layers()[M.layers().length - 1], gg = NL.docs.gridDoc && NL.docs.gridDoc.grid, ref = M.layers().find((q) => q.name === 'ground.asc').docs.gridDoc.grid;
      return { msg: msgOf() || '', names: M.layers().map((q) => q.name).join('|'), added: M.layers().length - n0, same: !!gg && gg.nx === ref.nx && gg.ny === ref.ny && gg.x0 === ref.x0 && gg.y0 === ref.y0 && gg.dx === ref.dx };
    });
    chk(`the dialog (palette → Grid, lattice “match: ground.asc”) adds a grid on that lattice, node for node${d.added === 1 && d.same ? "" : ` — ${JSON.stringify(d)}`}`, d.added === 1 && d.same);
    await p.close();
  }

  // ═══ §2 cut / fill ═══
  {
    const p = await mkPage();
    const plane = (x, y) => 500 + 0.125 * (x - E0) + 0.25 * (y - N0);   // eighths: exact in float32, so the flat parts difference to exactly 0
    // before: 2 m cell over a big box; after: 1 m cell, a 40 × 30 pit 6 m deep and a 20 × 10 dump 3 m high (box edges between nodes)
    const before = { nx: 81, ny: 61, x0: E0 - 20, y0: N0 + 100, dx: 2, z: plane };
    const inPit = (x, y) => x - E0 > 9.5 && x - E0 < 49.5 && y - N0 > 9.5 && y - N0 < 39.5;
    const inDump = (x, y) => x - E0 > 69.5 && x - E0 < 89.5 && y - N0 > 49.5 && y - N0 < 59.5;
    const after = { nx: 101, ny: 81, x0: E0, y0: N0 + 80, dx: 1, z: (x, y) => plane(x, y) - (inPit(x, y) ? 6 : 0) + (inDump(x, y) ? 3 : 0) };
    const cf = await p.evaluate(async ({ A, B }) => {
      const M = window._micro;
      await M.openBlob(new File([A], 'survey_2026-01.asc'), 'survey_2026-01.asc', 'add');
      await M.openBlob(new File([B], 'survey_2026-02.asc'), 'survey_2026-02.asc', 'add');
      const res = await M.runTool('cutfill', { before: 'survey_2026-01.asc', after: 'survey_2026-02.asc' });
      const D = M.layers().find((q) => q.name === res.layers[0]);
      return { values: res.values, table: res.table, dz: D && { surface: !!D.gridSurface, range: D.surfaceRange, flatZ: D.surfaceFlatZ, lin: D.lineage && D.lineage.op } };
    }, { A: ascOf(before), B: ascOf(after) });
    const v = cf.values;
    chk(`cut / fill on the finer grid's 1 m nodes over the overlap (${v.nodes} nodes = 101 × 81): cut ${v.cut.toFixed(2)} = 40 × 30 × 6 = 7200 m³, fill ${v.fill.toFixed(2)} = 20 × 10 × 3 = 600 m³, net ${v.net.toFixed(2)}`, v.nodes === 101 * 81 && v.cell === 1 && Math.abs(v.cut - 7200) < 0.5 && Math.abs(v.fill - 600) < 0.5 && Math.abs(v.net + 6600) < 1);
    chk(`areas: cut ${v.cut_area} m², fill ${v.fill_area} m², both ${v.area} m²; the table rows cut / fill / net`, v.cut_area === 1200 && v.fill_area === 200 && v.area === 101 * 81 && cf.table.rows.map((r) => r[0]).join() === 'cut,fill,net');
    chk(`the Δz layer: a flat sheet above both (z ${cf.dz && cf.dz.flatZ}), its colours centred on 0 (${JSON.stringify(cf.dz && cf.dz.range)}), lineage ${cf.dz && cf.dz.lin}`, cf.dz && cf.dz.surface && cf.dz.range && Math.abs(cf.dz.range[0] + cf.dz.range[1]) < 1e-9 && Math.abs(cf.dz.range[1] - 6) < 1e-3 && cf.dz.flatZ > 520 && cf.dz.lin === 'cutfill');
    // the window: the palette verb, Run, the readout + a chart spec for the composer
    const w = await p.evaluate(async () => {
      const M = window._micro, n0 = M.layers().length;
      M.COMMANDS.find((c) => c.id === 'cutfill').run({ L: M.layers().find((q) => q.name === 'survey_2026-02.asc') });
      const el = document.querySelector('.fwin[data-cutfill]');
      const before = el.querySelector('select[data-role=before]'), after = el.querySelector('select[data-role=after]');
      const names = (s) => s.options[s.selectedIndex].textContent;
      el.querySelector('.sw-run').click();
      for (let t = 0; t < 200 && !/cut/.test(el.querySelector('.cf-readout').textContent); t++) await new Promise((r2) => setTimeout(r2, 50));
      const cv = el.querySelector('canvas');
      return { before: names(before), after: names(after), readout: el.querySelector('.cf-readout').textContent, spec: !!(cv._chartSpec && cv._chartSpec.series && cv._chartSpec.series.length === 3), recipe: el._recipe && el._recipe(), added: M.layers().length - n0, dzCount: M.layers().filter((q) => q.name.startsWith("dz_")).length };
    });
    chk(`the window: before ${w.before} · after ${w.after}; Run → “${w.readout.slice(0, 60)}…”, a chart for ⇥ figure, a re-runnable recipe (layer: false)`, /survey_2026-01/.test(w.before) && /survey_2026-02/.test(w.after) && /cut 7,200 m³/.test(w.readout) && /fill 600 m³/.test(w.readout) && w.spec && w.recipe && w.recipe.tool === 'cutfill' && w.recipe.params.layer === false && w.added === 0 && w.dzCount === 1);
    await p.close();
  }

  // ═══ §2b cut / fill: a "match" lattice with NON-SQUARE cells, and two MESH surfaces ═══
  // (sweep 2026-11-25: gridOnLattice stepped rows by dx → a 2 × 4 m match grid gave HALF the volume;
  //  a mesh's edge nodes counted a full cell past its edge → +21 % at a 10 m cell)
  {
    const p = await mkPage();
    const flat = (z) => ({ nx: 61, ny: 61, x0: E0, y0: N0 + 120, dx: 2, z: () => z });   // 120 × 120 m, both flat, 1 m apart
    // the match grid: a GeoTIFF with 2 m columns and 4 m rows, 10 × 15 nodes inside the overlap
    const tif = geoTiffDxDy(10, 15, 2, 4, E0 + 20 - 1, N0 + 100 + 2, () => 0);
    // two flat 100 × 100 m meshes 2 m apart (OBJ, two triangles each) — volume 20,000 m³ exactly
    const sq = (z) => [`v ${E0} ${N0} ${z}`, `v ${E0 + 100} ${N0} ${z}`, `v ${E0 + 100} ${N0 + 100} ${z}`, `v ${E0} ${N0 + 100} ${z}`, 'f 1 2 3', 'f 1 3 4'].join('\n') + '\n';
    const r = await p.evaluate(async ({ A, B, T, MA, MB }) => {
      const M = window._micro;
      await M.openBlob(new File([A], 'flatA.asc'), 'flatA.asc', 'add');
      await M.openBlob(new File([B], 'flatB.asc'), 'flatB.asc', 'add');
      await M.openBlob(new File([new Uint8Array(T)], 'match24.tif'), 'match24.tif', 'add');
      const g = M.layers().find((q) => q.name === 'match24.tif').docs.gridDoc.grid;
      const m = await M.runTool('cutfill', { before: 'flatA.asc', after: 'flatB.asc', match: 'match24.tif' });
      await M.openBlob(new File([MA], 'meshA.obj'), 'meshA.obj', 'add');
      await M.openBlob(new File([MB], 'meshB.obj'), 'meshB.obj', 'add');
      const mesh = {};
      for (const cell of [1, 2.5, 10]) mesh[cell] = (await M.runTool('cutfill', { before: 'meshA.obj', after: 'meshB.obj', cell })).values;
      return { grid: { dx: g.dx, dy: g.dy, nx: g.nx, ny: g.ny }, match: m.values, mesh };
    }, { A: ascOf(flat(500)), B: ascOf(flat(499)), T: Array.from(tif), MA: sq(500), MB: sq(498) });
    const want = r.grid.nx * r.grid.ny * r.grid.dx * r.grid.dy;          // every node a dx × dy cell, Δz = −1
    chk(`cut / fill on a match grid with 2 × 4 m cells (${r.grid.dx} × ${r.grid.dy}, ${r.grid.nx} × ${r.grid.ny} nodes): cut ${r.match.cut} = nodes × 8 m² × 1 m = ${want}`, r.grid.dx === 2 && r.grid.dy === 4 && Math.abs(r.match.cut - want) < 1e-6 * want && r.match.nodes === r.grid.nx * r.grid.ny);
    const mv = Object.entries(r.mesh).map(([c, v]) => `${c} m → ${(+v.cut).toFixed(1)}`).join(', ');
    chk(`cut / fill between two 100 × 100 m meshes 2 m apart = 20,000 m³ at any cell (edge nodes weighted by the cell share the mesh covers): ${mv}`, Object.values(r.mesh).every((v) => Math.abs(v.cut - 20000) < 1e-3 * 20000 && Math.abs(v.area - 10000) < 1e-3 * 10000));
    await p.close();
  }

  // ═══ §3 factors with surveys ═══
  {
    const p = await mkPage();
    // blocks 10 m: x, y, z 0..100 (centres 5..95) at UTM offsets — 1000 blocks, AU 1 %, ρ 2.5 → 2500 t a block
    // surveys: start 95 (the top half-layer already gone) · P1 80 · P2 45 west of x = 50, 65 east
    const S0 = (x, y) => 895, S1 = () => 880, S2 = (x) => (x - E0 < 50 ? 845 : 865);
    const grid = (z) => ({ nx: 141, ny: 141, x0: E0 - 20, y0: N0 + 120, dx: 1, z });
    // by hand: P1 = layers 80–95 = 1.5 layers × 100 columns = 150 blocks;
    // P2 = west 50 columns × (65 − … ) : above 45 not above 80 = layers 50–80 + half of 40–50 = 3.5; east 50 × (70–80 + half 60–70) = 1.5
    const P1 = 150 * 2500, P2 = (50 * 3.5 + 50 * 1.5) * 2500;
    const fr = await p.evaluate(async ({ A, B, C, E0, N0 }) => {
      const M = window._micro;
      const n = 1000, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), AU = new Float64Array(n);
      let k = 0;
      for (let iz = 0; iz < 10; iz++) for (let iy = 0; iy < 10; iy++) for (let ix = 0; ix < 10; ix++) { X[k] = E0 + 5 + 10 * ix; Y[k] = N0 + 5 + 10 * iy; Z[k] = 805 + 10 * iz; AU[k] = 1; k++; }
      await M.addLayer({ kind: 'blocks', name: 'resource', columns: { XC: X, YC: Y, ZC: Z, AU }, roles: { x: 'XC', y: 'YC', z: 'ZC', value: 'AU' } });
      for (const [nm, t] of [['pit_2026-00_topo.asc', A], ['pit_2026-01.asc', B], ['pit_2026-02.asc', C]]) await M.openBlob(new File([t], nm), nm, 'add');
      const res = await M.runTool('factors', { model: 'resource', grade: 'AU', density: { const: 2.5 }, cutoff: 'none', surveys: [{ name: 'start', surface: 'pit_2026-00_topo.asc' }, { name: 'Jan', surface: 'pit_2026-01.asc' }, { name: 'Feb', surface: 'pit_2026-02.asc' }] });
      const tons = Object.fromEntries(res.table.rows.filter((r) => r[1] === 'tonnes').map((r) => [r[0], r[2]]));
      // the window: "surveys" mode starts from every grid in name order, the first one the start
      const L = M.layers().find((q) => (q.label || q.name) === 'resource');
      const h = M.openFactors(L);
      const ps = [...h.win.el.querySelectorAll('.sw-rail select')].find((s) => [...s.options].some((o) => o.value === 'surveys'));
      ps.value = 'surveys'; ps.dispatchEvent(new Event('change'));
      const boxes = [...h.win.el.querySelectorAll('[data-survey]')].map((bx) => bx.querySelector('span').textContent + ':' + bx.querySelector('input').value);
      h.st.model.density = { const: 2.5 }; h.st.cutoff = null;
      await h.run();
      const wt = h.st.scan ? Object.fromEntries(h.st.scan.rows.map((r) => [r.period, r.model.t])) : null;
      let err = null;
      try { await M.runTool('factors', { model: 'resource', grade: 'AU', density: { const: 2.5 }, cutoff: 'none', surveys: [{ name: 'only', surface: 'pit_2026-01.asc' }] }); } catch (e) { err = e.message; }
      return { tons, periods: res.values.periods, resolved: res.resolved.periods, boxes, wt, err };
    }, { A: ascOf(grid(S0)), B: ascOf(grid(S1)), C: ascOf(grid(S2)), E0, N0 });
    chk(`factors · surveys: the periods are the surveys after the start (${Object.keys(fr.tons).join(', ')}), resolved as periods “${fr.resolved}”`, Object.keys(fr.tons).join() === 'Jan,Feb' && fr.periods === 2 && fr.resolved === 'surveys');
    chk(`Jan mined ${fr.tons.Jan} t = by hand ${P1} t (1.5 layers: the start's half-layer already gone)`, Math.abs(fr.tons.Jan - P1) < 1e-6 * P1);
    chk(`Feb mined ${fr.tons.Feb} t = by hand ${P2} t (3.5 layers west, 1.5 east, the half blocks counted half)`, Math.abs(fr.tons.Feb - P2) < 1e-6 * P2);
    chk(`the window's “surveys” mode lists the grids in name order (${fr.boxes.join(' · ')}) and runs to the same tonnes`, fr.boxes.join() === 'start:pit_2026-00_topo,period 1:pit_2026-01,period 2:pit_2026-02' && !!fr.wt && Math.abs(fr.wt['pit_2026-01'] - P1) < 1e-6 * P1 && Math.abs(fr.wt['pit_2026-02'] - P2) < 1e-6 * P2);
    chk(`one survey alone is refused: “${(fr.err || '').slice(0, 80)}”`, /at least (two|2)/.test(fr.err || ''));
    await p.close();
  }
} finally {
  await b.close(); server.close();
}
console.log(fail ? `FAIL — ${fail} failed, ${pass} passed` : `PASS — ${pass} checks`);
process.exit(fail ? 1 : 0);
