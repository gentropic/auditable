// micro smoke — PROFILE along a line (src/profile.js): the elevation of surfaces along a polyline.
//   §1 the numbers: a grid that is a plane (bilinear sampling is exact on it) and a planar mesh quad
//      (a vertical ray meets it exactly), a three-vertex line crossing both — every station's z = the
//      plane's own value; where a surface doesn't reach, a gap (null), never a zero; the chainage at
//      each vertex = the cumulative plan length; the length exact; a polygon's ring walks closed
//   §2 the routine tool: the same numbers, the table's columns, the values, a refused bad line
//   §3 the window: opened from the palette, Run → a chart and the readout; save-as-recipe shape
// Run: node test/micro-profile-smoke.mjs (dev tree) · --built (micro.html). MICRO_CHROMIUM_ARGS honoured.
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-profile-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

const E0 = 612000, N0 = 7765000;
// the grid: 41 × 31 nodes of 5 m from (E0, N0), z = 500 + 0.04·(x − E0) + 0.02·(y − N0)
const GZ = (x, y) => 500 + 0.04 * (x - E0) + 0.02 * (y - N0);
const NX = 41, NY = 31, D = 5;
let ASC = `ncols ${NX}\nnrows ${NY}\nxllcorner ${E0 - D / 2}\nyllcorner ${N0 - D / 2}\ncellsize ${D}\nNODATA_value -9999\n`;
for (let r = 0; r < NY; r++) { const row = []; for (let c = 0; c < NX; c++) row.push(GZ(E0 + D * c, N0 + D * (NY - 1 - r)).toFixed(6)); ASC += row.join(' ') + '\n'; }
// the mesh: a planar quad over x 60…140, y 20…120, z = 450 − 0.1·(x − E0) + 0.05·(y − N0)
const MZ = (x, y) => 450 - 0.1 * (x - E0) + 0.05 * (y - N0);
const Q = [[60, 20], [140, 20], [140, 120], [60, 120]].map(([x, y]) => [E0 + x, N0 + y, MZ(E0 + x, N0 + y)]);
const OBJ = Q.map((v) => `v ${v.join(' ')}`).join('\n') + '\nf 1 2 3\nf 1 3 4\n';
// the line: three vertices, from inside the grid's corner to past the mesh, and a polygon ring
const LINE = [[E0 + 10, N0 + 10], [E0 + 100, N0 + 70], [E0 + 230, N0 + 70]];   // its last leg runs off the grid (x 200) and the mesh (x 140)
const RING = [[E0 + 20, N0 + 20], [E0 + 80, N0 + 20], [E0 + 80, N0 + 60]];
const wktL = `LINESTRING (${LINE.map((p) => p.join(' ')).join(', ')})`, wktP = `POLYGON ((${[...RING, RING[0]].map((p) => p.join(' ')).join(', ')}))`;
const LINES = `NAME,WKT\nxs1,"${wktL}"\nbench,"${wktP}"\n`;
const segs = (pts) => { const v = [0]; for (let i = 1; i < pts.length; i++) v.push(v[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return v; };
const VS = segs(LINE), LEN = VS[VS.length - 1];
const RINGC = [...RING, RING[0]], RLEN = segs(RINGC)[3];
const inMesh = (x, y) => x >= E0 + 60 && x <= E0 + 140 && y >= N0 + 20 && y <= N0 + 120;
const inGrid = (x, y) => x >= E0 && x <= E0 + (NX - 1) * D && y >= N0 && y <= N0 + (NY - 1) * D;

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

try {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.runTool, null, { timeout: 30000 });
  const r = await evaluateSettled(p, async ({ ASC, OBJ, LINES, E0, N0 }) => {
    const M = window._micro, out = {};
    await M.openBlob(new File([ASC], 'topo.asc'), 'topo.asc', 'replace', null, { throw: true, asKind: 'surface' });
    await M.openBlob(new File([OBJ], 'shell.obj'), 'shell.obj', 'add', null, { throw: true });
    await M.openBlob(new File([LINES], 'lines.csv'), 'lines.csv', 'add', null, { throw: true });
    const res = await M.runTool('profile', { line: { layer: 'lines.csv', feature: 'xs1' }, surfaces: ['topo.asc', 'shell.obj'], step: 2.5 });
    out.cols = res.table.columns; out.rows = res.table.rows; out.values = res.values;
    const ring = await M.runTool('profile', { line: { layer: 'lines.csv', feature: 'bench' }, surfaces: ['topo.asc'] });
    out.ring = { rows: ring.table.rows.length, first: ring.table.rows[0], last: ring.table.rows[ring.table.rows.length - 1], length: ring.values.length };
    try { await M.runTool('profile', { line: { layer: 'lines.csv', feature: 'nope' }, surfaces: ['topo.asc'] }); out.bad = 'ran'; } catch (e) { out.bad = e.message; }
    try { await M.runTool('profile', { line: { layer: 'lines.csv' }, surfaces: ['topo.asc'] }); out.ambiguous = 'ran'; } catch (e) { out.ambiguous = e.message; }
    // §4 contours of the topography plane, then a profile ALONG one of them (it reads its own ELEV)
    const ct = await M.runTool('contours', { grid: 'topo.asc', interval: 2.5, index: 2 });
    const CL = M.layers().find((x) => x.name === ct.layers[0]);
    const fs = M.featuresOf(CL);
    out.contours = { values: ct.values, n: fs.length, feats: fs.map((f) => ({ elev: +f.attrs.ELEV, index: +f.attrs.INDEX, pts: f.rings[0].map((q) => q.slice(0, 3)) })) };
    const mid = fs[Math.floor(fs.length / 2)];
    const along = await M.runTool('profile', { line: { layer: CL.name, feature: mid.id }, surfaces: ['topo.asc'] });
    out.along = { elev: +mid.attrs.ELEV, zs: along.table.rows.map((row) => row[3]) };
    // §5 where the topography plane meets a flat grid at 505 m: the line 0.04·x′ + 0.02·y′ = 5, at z 505
    const NL = String.fromCharCode(10);
    let flat = `ncols 31${NL}nrows 21${NL}xllcorner ${E0 - 2.5}${NL}yllcorner ${N0 - 2.5}${NL}cellsize 5${NL}NODATA_value -9999${NL}`;
    for (let rr = 0; rr < 21; rr++) flat += Array(31).fill('505').join(' ') + NL;
    await M.openBlob(new File([flat], 'level505.asc'), 'level505.asc', 'add', null, { throw: true });
    const meet = await M.runTool('intersection', { a: 'topo.asc', b: 'level505.asc' });
    const ML = M.layers().find((x) => x.name === meet.layers[0]);
    out.meet = { values: meet.values, lines: M.featuresOf(ML).map((f) => f.rings[0].map((q) => q.slice(0, 3))) };
    // the window, from the palette: Run → a chart
    M.COMMANDS.find((c) => c.id === 'profile').run({ L: null });
    const w = document.querySelector('.fwin[data-profile]');
    const ls = w.querySelector('select[data-role=line]'); ls.value = [...ls.options].find((o) => /xs1/.test(o.textContent)).value; ls.dispatchEvent(new Event('change'));
    for (const cb of w.querySelectorAll('input[data-surface]')) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    w.querySelector('.sw-run').click();
    for (let t = 0; t < 100 && !/length/.test(w.querySelector('.pf-readout').textContent); t++) await new Promise((z) => setTimeout(z, 100));
    out.win = { readout: w.querySelector('.pf-readout').textContent, spec: !!(w.querySelector('canvas')._chartSpec && w.querySelector('canvas')._chartSpec.series.length >= 2), recipe: w._recipe && w._recipe() };
    return out;
  }, { ASC, OBJ, LINES, E0, N0 });

  try { await p.locator('.fwin[data-profile]').screenshot({ path: `experiments/profile-window${BUILT ? '-built' : ''}.png` }); } catch { /* for a person to look at */ }
  // §1 the numbers, station by station, against the planes themselves
  const ci = r.cols.indexOf('topo.asc'), mi = r.cols.indexOf('shell.obj');
  let worstG = 0, worstM = 0, gridGaps = 0, meshGaps = 0, wrongGap = 0;
  for (const row of r.rows) {
    const [, x, y] = row, g = row[ci], m = row[mi];
    if (inGrid(x, y)) { if (g == null) wrongGap++; else worstG = Math.max(worstG, Math.abs(g - GZ(x, y))); } else if (g == null) gridGaps++; else wrongGap++;
    const inside = inMesh(x, y), edge = Math.abs(x - (E0 + 140)) < 1e-6 || Math.abs(x - (E0 + 60)) < 1e-6;
    if (inside) { if (m == null) { if (!edge) wrongGap++; } else worstM = Math.max(worstM, Math.abs(m - MZ(x, y))); } else if (m == null) meshGaps++; else wrongGap++;
  }
  chk(`the grid along the line = the plane itself (worst ${worstG.toExponential(2)} m over ${r.rows.length} stations — float32 storage resolves ~3e-5 m at z 500)`, worstG < 1e-4);
  chk(`the mesh along the line = its plane (worst ${worstM.toExponential(2)} m), by a vertical ray`, worstM < 1e-6);
  chk(`where a surface doesn't reach, a gap — grid ${gridGaps}, mesh ${meshGaps} stations — and none where it does (${wrongGap} wrong)`, gridGaps > 0 && meshGaps > 0 && wrongGap === 0);
  const vRows = VS.map((s) => r.rows.find((row) => Math.abs(row[0] - s) < 1e-6));
  chk(`every vertex is a station, at its cumulative plan length (${VS.map((v) => v.toFixed(3)).join(', ')}), at its own x, y`,
    vRows.every((row, i) => row && Math.abs(row[1] - LINE[i][0]) < 1e-6 && Math.abs(row[2] - LINE[i][1]) < 1e-6));
  chk(`the length ${r.values.length.toFixed(6)} = ${LEN.toFixed(6)}; stations every 2.5 m (${r.values.stations})`, Math.abs(r.values.length - LEN) < 1e-9 && r.values.step === 2.5);
  chk(`a polygon's ring walks closed: ${r.ring.length.toFixed(3)} m = its perimeter ${RLEN.toFixed(3)}, ending where it began`, Math.abs(r.ring.length - RLEN) < 1e-9 && Math.abs(r.ring.first[1] - r.ring.last[1]) < 1e-9 && Math.abs(r.ring.first[2] - r.ring.last[2]) < 1e-9);
  // §2 the tool's shape
  chk(`the table: ${r.cols.join(', ')}; values: length, stations, per surface min / max / covered`, r.cols.join() === 'chainage,x,y,topo.asc,shell.obj' && 'topo.asc min' in r.values && r.values['shell.obj covered'] > 0 && r.values['shell.obj covered'] < 1);
  chk(`a line that isn't there is refused (“${r.bad.slice(0, 50)}”), and a layer of several lines asks which (“${r.ambiguous.slice(0, 60)}”)`, /no line/.test(r.bad) && /say which/.test(r.ambiguous));
  // §4 contours
  const GZ_ = (x, y) => 500 + 0.04 * (x - E0) + 0.02 * (y - N0);
  let worstC = 0; for (const f of r.contours.feats) for (const q of f.pts) worstC = Math.max(worstC, Math.abs(GZ_(q[0], q[1]) - f.elev), Math.abs(q[2] - f.elev));
  const elevs = [...new Set(r.contours.feats.map((f) => f.elev))].sort((a, b) => a - b);
  // the grid runs 500 (its SW node) … 511 (its NE node): a line forms at every level strictly between
  const wantLevels = []; for (let k = Math.floor(500 / 2.5) + 1; k * 2.5 < 511; k++) wantLevels.push(k * 2.5);
  chk(`contours of the topography: one straight line per level ${elevs.join(', ')} (= every 2.5 m across its range), each vertex on the plane at its ELEV, z = ELEV (worst ${worstC.toExponential(2)} m)`,
    JSON.stringify(elevs) === JSON.stringify(wantLevels) && r.contours.n === wantLevels.length && worstC < 1e-3);
  chk(`INDEX on every 2nd level (${r.contours.feats.filter((f) => f.index).map((f) => f.elev).join(', ')})`, r.contours.feats.every((f) => f.index === (Math.round(f.elev / 2.5) % 2 === 0 ? 1 : 0)));
  const dev = Math.max(...r.along.zs.filter((z) => z != null).map((z) => Math.abs(z - r.along.elev)));
  chk(`a profile ALONG the ${r.along.elev} m contour reads ${r.along.elev} m all along it (worst ${dev.toExponential(2)} m over ${r.along.zs.length} stations)`, r.along.zs.length > 10 && dev < 1e-3);
  // §5 intersection
  const mpts = r.meet.lines.flat();
  const worstM5 = Math.max(...mpts.map((q) => Math.abs(0.04 * (q[0] - E0) + 0.02 * (q[1] - N0) - 5)), ...mpts.map((q) => Math.abs(q[2] - 505)));
  chk(`where the topography meets a flat grid at 505 m: ${r.meet.values.lines} line (${r.meet.values.length.toFixed(1)} m), every vertex on 0.04·x′ + 0.02·y′ = 5 at z 505 (worst ${worstM5.toExponential(2)})`,
    r.meet.values.lines === 1 && mpts.length >= 2 && worstM5 < 1e-3);
  // §3 the window
  chk(`the window (palette): Run → a chart of the surfaces (${r.win.spec}) and a readout (“${r.win.readout.slice(0, 70)}”); its recipe is the tool's (${r.win.recipe && r.win.recipe.tool})`,
    r.win.spec && /length/.test(r.win.readout) && r.win.recipe && r.win.recipe.tool === 'profile' && r.win.recipe.params.surfaces.length >= 2);
  await p.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; } finally {
  await b.close(); server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
