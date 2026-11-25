// micro smoke — SECTION LINES AS STRINGS + BENCH OUTLINES FROM BLOCKS (wave 6a).
//   §1 section lines, meshes: a box solid cut by the CURRENT plan section → one closed rectangle
//      feature (a polygon on a plan) of the box's size; a sphere cut off-centre → a circle of the
//      analytic radius within the chord tolerance; the layer's attributes + lineage; the routine
//      contract (a misspelt plane key named)
//   §2 section lines, a gridded surface cut N–S = its profile at the analytic level
//   §3 domain boundaries: a two-domain block model (A where i + j < 20) on a plan = the known
//      staircase, 380 m, one line, A / B either side; with the model edge on: + the 800 m frame
//   §4 bench outlines of a known block set: a square annulus (with its hole) and a block touching
//      it only at a corner (a polygon of its own) — area = count × cell area, the hole's area,
//      volume, tonnes with a density, per-bench table
//   §5 a ROTATED model's outline maps to world through its lattice (the four corners where the
//      lattice says); a SUB-BLOCKED model's outline on its fine lattice (an L of 150 m²)
//   §6 export → reopen: DXF and shapefile round trips of an outline layer keep the polygons
//      (rings, the hole, the area) and the attributes
//   §7 the layer menu (Geometry) and the palette carry both
// Every expected value is worked out here from the fixture geometry, not read back from micro.
// Run: node test/micro-wave6-smoke.mjs (the dev tree) · --built (micro.html) · --shot (writes
// experiments/wave6-outlines.png: bench outlines over the model).
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile, mkdir } from 'fs/promises';
import { extname } from 'path';

const BUILT = process.argv.includes('--built');
const SHOT = process.argv.includes('--shot');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-wave6-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

const E0 = 612000, N0 = 7765000;
// §1 the box and the sphere
const BOX = { x0: E0 + 20, y0: N0 + 30, z0: 800, x1: E0 + 80, y1: N0 + 70, z1: 900 };
const SPH = { c: [E0 + 300, N0 + 100, 850], r: 50, seg: 96, rings: 48 };
const ZCUT = 860, RCUT = Math.sqrt(SPH.r ** 2 - (ZCUT - SPH.c[2]) ** 2);
// §3/§4 the block model: 20 × 20 × 3 of 10 m, A where i + j < 20; ZONE = ORE on an annulus of
// bench 1 (cells 4..15 minus the 8..11 hole) and one block (16,16) touching it at a corner
const NX = 20, NY = 20, NZ = 3, B = 10;
const isOre = (i, j, k) => k === 1 && ((i >= 4 && i <= 15 && j >= 4 && j <= 15 && !(i >= 8 && i <= 11 && j >= 8 && j <= 11)) || (i === 16 && j === 16));
const ANN_N = 12 * 12 - 4 * 4;                                   // 128 blocks in the annulus

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
const ascOf = (g) => [`ncols ${g.nx}`, `nrows ${g.ny}`, `xllcorner ${g.x0 - g.dx / 2}`, `yllcorner ${g.y0 - (g.ny - 1) * g.dx - g.dx / 2}`, `cellsize ${g.dx}`, 'NODATA_value -9999',
  ...Array.from({ length: g.ny }, (_, r) => Array.from({ length: g.nx }, (_, c) => +g.z(g.x0 + c * g.dx, g.y0 - r * g.dx).toFixed(4)).join(' '))].join('\n') + '\n';

try {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.addLayer, null, { timeout: 30000 });

  // ═══ §1 meshes ═══
  const r1 = await evaluateSettled(p, async ({ BOX, SPH, ZCUT }) => {
    const M = window._micro, out = {};
    try { M.setAutoOptimize('off'); M.setAutoPack('off'); } catch { /* older builds */ }
    const { x0, y0, z0, x1, y1, z1 } = BOX;
    const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    const T = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    await M.addLayer({ kind: 'mesh', name: 'box', vertices: Float64Array.from(V), triangles: Uint32Array.from(T) });
    // a UV sphere
    const SV = [], ST = [], { c, r, seg, rings } = SPH;
    SV.push(c[0], c[1], c[2] - r);
    for (let k = 1; k < rings; k++) { const ph = -Math.PI / 2 + Math.PI * k / rings; for (let s = 0; s < seg; s++) { const th = 2 * Math.PI * s / seg; SV.push(c[0] + r * Math.cos(ph) * Math.cos(th), c[1] + r * Math.cos(ph) * Math.sin(th), c[2] + r * Math.sin(ph)); } }
    SV.push(c[0], c[1], c[2] + r);
    const top = SV.length / 3 - 1, at = (k, s) => 1 + (k - 1) * seg + (s % seg);
    for (let s = 0; s < seg; s++) ST.push(0, at(1, s + 1), at(1, s));
    for (let k = 1; k < rings - 1; k++) for (let s = 0; s < seg; s++) ST.push(at(k, s), at(k, s + 1), at(k + 1, s + 1), at(k, s), at(k + 1, s + 1), at(k + 1, s));
    for (let s = 0; s < seg; s++) ST.push(at(rings - 1, s), at(rings - 1, s + 1), top);
    await M.addLayer({ kind: 'mesh', name: 'sphere', vertices: Float64Array.from(SV), triangles: Uint32Array.from(ST) });
    // the CURRENT section: a plan at z = 850 through the box
    M.setSectionWorld({ axis: 'z', position: 850, thickness: 2 });
    const res = await M.runTool('sectionlines', { sources: ['box.ply'] });
    const Lb = M.layers().find((q) => q.name === res.layers[0]);
    const fb = M.featuresOf(Lb);
    out.box = { n: fb.length, kind: fb[0].kind, closed: fb[0].closed, verts: fb[0].rings[0].length, area: M.polygonAreaXY(fb[0]), attrs: fb[0].attrs, zs: [...new Set(fb[0].rings[0].map((q) => q[2]))], lin: Lb.lineage, values: res.values, table: res.table.rows,
      xs: [Math.min(...fb[0].rings[0].map((q) => q[0])), Math.max(...fb[0].rings[0].map((q) => q[0]))], ys: [Math.min(...fb[0].rings[0].map((q) => q[1])), Math.max(...fb[0].rings[0].map((q) => q[1]))] };
    // the sphere, off-centre
    const rs = await M.runTool('sectionlines', { plane: { axis: 'z', position: ZCUT }, sources: 'sphere.ply', name: 'sphere_cut' });
    const fs = M.featuresOf(M.layers().find((q) => q.name === rs.layers[0]));
    const radii = fs[0].rings[0].map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]));
    out.sph = { n: fs.length, closed: fs[0].closed, verts: fs[0].rings[0].length, area: M.polygonAreaXY(fs[0]), rmin: Math.min(...radii), rmax: Math.max(...radii), len: fs[0].attrs.LENGTH };
    // re-running replaces its own layer
    const before = M.layers().length;
    await M.runTool('sectionlines', { plane: { axis: 'z', position: ZCUT }, sources: 'sphere.ply', name: 'sphere_cut' });
    out.rerun = M.layers().length - before;
    out.typo = M.checkParams('sectionlines', { plane: { axis: 'z', positon: 3 } }).errors;
    out.kinds = M.checkParams('sectionlines', { kinds: ['meshes'] }).errors;
    return out;
  }, { BOX, SPH, ZCUT });
  chk(`box cut by the current plan section (z 850) → 1 closed feature: a ${r1.box.kind} of ${r1.box.verts} corners, ${r1.box.xs.map((v) => (v - E0).toFixed(3)).join('–')} × ${r1.box.ys.map((v) => (v - N0).toFixed(3)).join('–')}`, r1.box.n === 1 && r1.box.kind === 'polygon' && r1.box.closed && r1.box.verts === 4 && near(r1.box.xs[0], BOX.x0, 1e-6) && near(r1.box.xs[1], BOX.x1, 1e-6) && near(r1.box.ys[0], BOX.y0, 1e-6) && near(r1.box.ys[1], BOX.y1, 1e-6));
  chk(`… area ${r1.box.area} = 60 × 40, at z ${r1.box.zs.join(',')}; LENGTH ${r1.box.attrs.LENGTH} = 200; SOURCE ${r1.box.attrs.SOURCE}, KIND ${r1.box.attrs.KIND}, PLANE ${r1.box.attrs.PLANE}, POSITION ${r1.box.attrs.POSITION}`, near(r1.box.area, 2400, 1e-6) && r1.box.zs.length === 1 && near(r1.box.zs[0], 850, 1e-9) && near(r1.box.attrs.LENGTH, 200, 1e-6) && r1.box.attrs.SOURCE === 'box' && r1.box.attrs.KIND === 'mesh' && r1.box.attrs.PLANE === 'plan' && near(r1.box.attrs.POSITION, 850, 1e-9));
  chk(`… lineage op sectionlines (sources ${JSON.stringify(r1.box.lin.params.sources)}, position ${r1.box.lin.params.plane.position}); the tool's table ${JSON.stringify(r1.box.table)}`, r1.box.lin.op === 'sectionlines' && r1.box.lin.params.sources[0] === 'box.ply' && near(r1.box.lin.params.plane.position, 850, 1e-9) && r1.box.table[0][2] === 1);
  const chordR = RCUT * Math.cos(Math.PI / SPH.seg) - 0.05;   // a chord's midpoint sits inside the circle by r(1 − cos π/seg)
  chk(`sphere (r ${SPH.r}) cut at z ${ZCUT} → a circle of radius ${RCUT.toFixed(4)}: ${r1.sph.verts} vertices at r ${r1.sph.rmin.toFixed(4)}…${r1.sph.rmax.toFixed(4)} (≥ ${chordR.toFixed(4)}), area ${r1.sph.area.toFixed(2)} vs π r² ${(Math.PI * RCUT * RCUT).toFixed(2)} (within 0.5%)`, r1.sph.n === 1 && r1.sph.closed && r1.sph.rmax <= RCUT + 1e-6 && r1.sph.rmin >= chordR && Math.abs(r1.sph.area - Math.PI * RCUT * RCUT) <= 0.005 * Math.PI * RCUT * RCUT);
  chk(`a re-run replaces its own layer (Δ layers ${r1.rerun}); a misspelt plane key is named (“${(r1.typo[0] || '').slice(0, 50)}”), a wrong kind refused`, r1.rerun === 0 && r1.typo.some((e) => /positon/.test(e)) && r1.kinds.some((e) => /meshes/.test(e)));

  // ═══ §2 a gridded surface cut N–S ═══
  const slopeZ = (x) => 850 + 0.1 * (x - E0);
  const r2 = await evaluateSettled(p, async ({ A, E0 }) => {
    const M = window._micro;
    await M.openBlob(new File([A], 'topo.asc'), 'topo.asc', 'add');
    const r = await M.runTool('sectionlines', { plane: { axis: 'x', position: E0 + 150.5 }, sources: ['topo.asc'], name: 'topo_ns' });
    const f = M.featuresOf(M.layers().find((q) => q.name === r.layers[0]));
    const pts = f.flatMap((x) => x.rings[0]);
    return { n: f.length, kind: f[0].attrs.KIND, plane: f[0].attrs.PLANE, zmin: Math.min(...pts.map((q) => q[2])), zmax: Math.max(...pts.map((q) => q[2])), x: [...new Set(pts.map((q) => +q[0].toFixed(6)))], len: f[0].attrs.LENGTH };
  }, { A: ascOf({ nx: 61, ny: 41, x0: E0, y0: N0 + 200, dx: 5, z: slopeZ }), E0 });
  chk(`gridded surface cut N–S at x = 150.5 → its profile: 1 line (${r2.kind}, ${r2.plane}) at z ${r2.zmin.toFixed(4)}…${r2.zmax.toFixed(4)} = the analytic ${slopeZ(E0 + 150.5).toFixed(4)}, ${r2.len} m long (200)`, r2.n === 1 && r2.kind === 'grid' && r2.plane === 'N–S' && near(r2.zmin, slopeZ(E0 + 150.5), 1e-6) && near(r2.zmax, slopeZ(E0 + 150.5), 1e-6) && r2.x.length === 1 && near(r2.len, 200, 1e-6));

  // ═══ §3 domain boundaries ═══
  const r3 = await evaluateSettled(p, async ({ E0, N0, NX, NY, NZ, B, oreSrc }) => {
    const M = window._micro, isOre = eval(oreSrc), n = NX * NY * NZ;
    const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), AU = new Float64Array(n), DOM = [], ZONE = [];
    let r = 0;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { X[r] = E0 + 5 + B * i; Y[r] = N0 + 5 + B * j; Z[r] = 805 + B * k; AU[r] = 1 + ((i + j + k) % 5) * 0.25; DOM.push(i + j < 20 ? 'A' : 'B'); ZONE.push(isOre(i, j, k) ? 'ORE' : 'WASTE'); r++; }
    await M.addLayer({ kind: 'blocks', name: 'model', columns: { XC: X, YC: Y, ZC: Z, AU, DOM, ZONE }, roles: { x: 'XC', y: 'YC', z: 'ZC', value: 'AU', category: 'DOM', categories: ['DOM', 'ZONE'] } });
    const Lm = M.layers().find((q) => (q.label || q.name) === 'model');
    const res = await M.runTool('sectionlines', { plane: { axis: 'z', position: 815 }, sources: [Lm.name], column: 'DOM', name: 'dom815' });
    const f = M.featuresOf(M.layers().find((q) => q.name === res.layers[0]));
    const g = f[0], ends = [g.rings[0][0], g.rings[0][g.rings[0].length - 1]].map((q) => [Math.round(q[0] - E0), Math.round(q[1] - N0)].join(',')).sort();
    const edge = await M.runTool('sectionlines', { plane: { axis: 'z', position: 815 }, sources: [Lm.name], column: 'DOM', outer: true, name: 'dom815_edge' });
    const fe = M.featuresOf(M.layers().find((q) => q.name === edge.layers[0]));
    return { n: f.length, kind: g.kind, attrs: g.attrs, verts: g.rings[0].length, ends, zs: [...new Set(g.rings[0].map((q) => q[2]))], edgeLen: fe.reduce((s, x) => s + x.attrs.LENGTH, 0), edgePairs: [...new Set(fe.map((x) => x.attrs.BOUNDARY))].sort(), cat: M.layers().find((q) => q.name === res.layers[0]).docs.stringsDoc.header.categories };
  }, { E0, N0, NX, NY, NZ, B, oreSrc: isOre.toString() });
  chk(`domain boundary DOM on the plan z 815 → 1 line A / B (${r3.attrs.BOUNDARY}, CAT_A ${r3.attrs.CAT_A}, CAT_B ${r3.attrs.CAT_B}), the staircase: ${r3.verts} corners (39), ends ${r3.ends.join(' · ')} (10,200 · 200,10), at z ${r3.zs.join(',')}`, r3.n === 1 && r3.kind === 'line' && r3.attrs.CAT_A === 'A' && r3.attrs.CAT_B === 'B' && r3.attrs.KIND === 'domain' && r3.verts === 39 && r3.ends.join('|') === '10,200|200,10' && r3.zs.length === 1 && r3.zs[0] === 815);
  chk(`… LENGTH ${r3.attrs.LENGTH} = 38 lattice edges × 10 m = 380; the layer classes by BOUNDARY (${JSON.stringify(r3.cat)})`, near(r3.attrs.LENGTH, 380, 1e-6) && JSON.stringify(r3.cat) === '["A / B"]');
  chk(`… with the model edge: ${r3.edgeLen} m = 380 + the 800 m frame, boundaries ${r3.edgePairs.join(' | ')}`, near(r3.edgeLen, 1180, 1e-6) && r3.edgePairs.join('|') === '(none) / A|(none) / B|A / B');

  // ═══ §4 bench outlines ═══
  const r4 = await evaluateSettled(p, async () => {
    const M = window._micro;
    const Lm = M.layers().find((q) => (q.label || q.name) === 'model');
    const res = await M.runTool('blockoutlines', { layer: Lm.name, column: 'ZONE', value: 'ORE', density: 2.5, name: 'ore_outlines' });
    const Lo = M.layers().find((q) => q.name === res.layers[0]);
    const f = M.featuresOf(Lo).map((x) => ({ rings: x.rings.length, verts: x.rings.map((r) => r.length), area: M.polygonAreaXY(x), attrs: x.attrs, z: [...new Set(x.rings.flat().map((q) => q[2]))] }));
    const where = await M.runTool('blockoutlines', { layer: Lm.name, where: 'ZONE == "ORE" and ZC > 810 and ZC < 820', name: 'ore_where', level: 'bottom' });
    const fw = M.featuresOf(M.layers().find((q) => q.name === where.layers[0]));
    const by = await M.runTool('blockoutlines', { layer: Lm.name, by: 'DOM', name: 'dom_benches' });
    const simp = await M.runTool('blockoutlines', { layer: Lm.name, column: 'DOM', value: 'A', simplify: 15, name: 'domA_simple' });
    const fs = M.featuresOf(M.layers().find((q) => q.name === simp.layers[0]));
    const exact = await M.runTool('blockoutlines', { layer: Lm.name, column: 'DOM', value: 'A', name: 'domA_exact' });
    const fx = M.featuresOf(M.layers().find((q) => q.name === exact.layers[0]));
    return { f, table: res.table, values: res.values, lin: Lo.lineage.params, cat: Lo.docs.stringsDoc.header.columns, nw: fw.length, wz: fw.map((x) => x.attrs.Z), whereArea: fw.reduce((s, x) => s + M.polygonAreaXY(x), 0),
      by: by.table.rows, byN: by.values.polygons, simpV: fs[0].rings[0].length, exactV: fx[0].rings[0].length, simpArea: M.polygonAreaXY(fs[0]), exactArea: M.polygonAreaXY(fx[0]), exactN: fx.length };
  });
  const big = r4.f.find((x) => x.rings === 2), dot = r4.f.find((x) => x.rings === 1);
  chk(`bench outlines of ZONE = ORE: ${r4.f.length} polygons on bench ${[...new Set(r4.f.map((x) => x.attrs.BENCH))].join(',')} — the annulus (outer + 1 hole, corners ${big && big.verts.join('+')}) and the corner-touching block on its own (4 corners)`, r4.f.length === 2 && big && dot && big.verts.join('+') === '4+4' && dot.verts[0] === 4 && r4.f.every((x) => x.attrs.BENCH === 1));
  chk(`… the annulus: area ${big.area} = ${ANN_N} × 100 (12² − 4², the hole subtracted), BLOCKS ${big.attrs.BLOCKS}, CELLS ${big.attrs.CELLS}, HOLES ${big.attrs.HOLES}, at z ${big.z.join(',')} (the bench middle 815)`, near(big.area, ANN_N * 100, 1e-6) && near(big.attrs.AREA, ANN_N * 100, 1e-6) && big.attrs.BLOCKS === ANN_N && big.attrs.CELLS === ANN_N && big.attrs.HOLES === 1 && big.z.length === 1 && big.z[0] === 815 && big.attrs.Z_BOT === 810 && big.attrs.Z_TOP === 820);
  chk(`… VOLUME ${big.attrs.VOLUME} = ${ANN_N} × 1000, TONNES ${big.attrs.TONNES} = × 2.5; the lone block: ${dot.area} m², ${dot.attrs.TONNES} t; the tool's bench table ${JSON.stringify(r4.table.rows)}`, near(big.attrs.VOLUME, ANN_N * 1000, 1e-6) && near(big.attrs.TONNES, ANN_N * 2500, 1e-6) && near(dot.area, 100, 1e-9) && near(dot.attrs.TONNES, 2500, 1e-9) && r4.table.rows.length === 1 && near(r4.table.rows[0][3], (ANN_N + 1) * 100, 1e-6) && near(r4.table.rows[0][5], (ANN_N + 1) * 2500, 1e-6));
  chk(`… where (an expression) picks the same blocks: ${r4.nw} polygons, ${r4.whereArea} m², level bottom → z ${r4.wz.join(',')}; lineage ${JSON.stringify({ value: r4.lin.value, column: r4.lin.column, density: r4.lin.density, bench: r4.lin.bench })}`, r4.nw === 2 && near(r4.whereArea, (ANN_N + 1) * 100, 1e-6) && r4.wz.every((z) => z === 810) && r4.lin.value === 'ORE' && r4.lin.column === 'ZONE' && r4.lin.density === 2.5 && r4.lin.bench === 10);
  chk(`… by DOM: every bench × domain its own polygon (${r4.byN} = 3 benches × A, B), bench table ${r4.by.length} rows, each bench 400 cells × 100 = 40000 m² (${r4.by.map((r) => r[3]).join(', ')})`, r4.byN === 6 && r4.by.length === 3 && r4.by.every((r) => near(r[3], 40000, 1e-6)));
  chk(`… simplify 15 m: the staircase triangle A (${r4.exactV} exact corners, ${r4.exactArea} m² = 210 × 100) → ${r4.simpV} corners, ${r4.simpArea.toFixed(1)} m² — only original corners`, r4.exactN === 3 && near(r4.exactArea, 21000, 1e-6) && r4.simpV < r4.exactV && r4.simpV >= 3);

  // ═══ §5 rotated + sub-blocked ═══
  const r5 = await evaluateSettled(p, async () => {
    const M = window._micro, out = {};
    const AZ = 30 * Math.PI / 180, P = [10, 10, 5];
    const LAT = { O: [612345.5, 7765432.25, 812.5], n: [8, 6, 3], U: [Math.cos(AZ) * P[0], -Math.sin(AZ) * P[0], 0], V: [Math.sin(AZ) * P[1], Math.cos(AZ) * P[1], 0], W: [0, 0, P[2]] };
    const E = [], N = [], RL = [], Z = [];
    for (let k = 0; k < LAT.n[2]; k++) for (let j = 0; j < LAT.n[1]; j++) for (let i = 0; i < LAT.n[0]; i++) {
      const w = [0, 1, 2].map((d) => LAT.O[d] + i * LAT.U[d] + j * LAT.V[d] + k * LAT.W[d]);
      E.push(w[0]); N.push(w[1]); RL.push(w[2]); Z.push(i >= 2 && i <= 5 && j >= 1 && j <= 3 ? 'ORE' : 'WASTE');
    }
    await M.addLayer({ kind: 'blocks', name: 'rotmodel', columns: { E: Float64Array.from(E), N: Float64Array.from(N), RL: Float64Array.from(RL), ZONE: Z }, roles: { x: 'E', y: 'N', z: 'RL', category: 'ZONE' }, lattice: { basis: { origin: LAT.O, U: LAT.U, V: LAT.V, W: LAT.W, counts: LAT.n } } });
    const Lr = M.layers().find((q) => (q.label || q.name) === 'rotmodel');
    out.rot = !!Lr.docs.blockDoc.header.grid.rot;
    const rr = await M.runTool('blockoutlines', { layer: Lr.name, value: 'ORE', name: 'rot_outlines' });
    const fr = M.featuresOf(M.layers().find((q) => q.name === rr.layers[0])).filter((x) => x.attrs.BENCH === 1);
    // the expected corners: lattice cells 2..5 × 1..3 → corners at u ∈ {1.5, 5.5}, v ∈ {0.5, 3.5} cell steps from block 0's centre
    const cw = (a, bb) => [0, 1].map((d) => LAT.O[d] + a * LAT.U[d] + bb * LAT.V[d]);
    out.expect = [cw(1.5, 0.5), cw(5.5, 0.5), cw(5.5, 3.5), cw(1.5, 3.5)];
    out.got = fr.length === 1 ? fr[0].rings[0].map((q) => [q[0], q[1], q[2]]) : null;
    out.rotArea = fr.length ? M.polygonAreaXY(fr[0]) : 0;
    out.rotN = fr.length;
    out.rotZ = LAT.O[2] + 1 * LAT.W[2];
    // sub-blocked: 6 × 6 parents of 10 m (one bench, z 0..10); parent (2,2) split into 8 × 5 m, its
    // lower half in y ORE; parent (3,2) ORE whole → an L: x 20..30 × y 20..25 + x 30..40 × y 20..30
    const X = [], Y = [], ZZ = [], S = [], ZN = [];
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      if (i === 2 && j === 2) {
        for (const dx of [-2.5, 2.5]) for (const dy of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) { X.push(25 + dx); Y.push(25 + dy); ZZ.push(5 + dz); S.push(5); ZN.push(dy < 0 ? 'ORE' : 'WASTE'); }
        continue;
      }
      X.push(10 * i + 5); Y.push(10 * j + 5); ZZ.push(5); S.push(10); ZN.push(i === 3 && j === 2 ? 'ORE' : 'WASTE');
    }
    const E0 = 612000, N0 = 7765000;
    await M.addLayer({ kind: 'blocks', name: 'submodel', columns: { X: Float64Array.from(X.map((v) => v + E0)), Y: Float64Array.from(Y.map((v) => v + N0)), Z: Float64Array.from(ZZ.map((v) => v + 800)), S: Float64Array.from(S), ZONE: ZN }, roles: { x: 'X', y: 'Y', z: 'Z', category: 'ZONE' }, sizes: { dx: 'S', dy: 'S', dz: 'S' } });
    const Ls = M.layers().find((q) => (q.label || q.name) === 'submodel');
    out.sub = !!Ls.docs.blockDoc.header.subBlocked;
    const sr = await M.runTool('blockoutlines', { layer: Ls.name, value: 'ORE', name: 'sub_outlines' });
    const fs = M.featuresOf(M.layers().find((q) => q.name === sr.layers[0]));
    out.subN = fs.length;
    out.subArea = fs.length ? M.polygonAreaXY(fs[0]) : 0;
    out.subRing = fs.length ? fs[0].rings[0].map((q) => [+(q[0] - E0).toFixed(6), +(q[1] - N0).toFixed(6)]) : null;
    out.subZ = fs.length ? [fs[0].attrs.Z_BOT, fs[0].attrs.Z_TOP, fs[0].attrs.BLOCKS, fs[0].attrs.VOLUME] : null;
    return out;
  });
  const cornerErr = r5.got && r5.got.length === 4 ? Math.max(...r5.expect.map((e) => Math.min(...r5.got.map((g) => Math.hypot(g[0] - e[0], g[1] - e[1]))))) : Infinity;
  chk(`rotated model (30°, declared basis ${r5.rot ? 'applied' : 'MISSING'}): bench 1's ORE outline = 1 polygon, its 4 corners where the lattice puts them (worst ${cornerErr.toExponential(2)} m), area ${r5.rotArea.toFixed(6)} = 4 × 3 × 100, at z ${r5.got && r5.got[0][2]} = ${r5.rotZ}`, r5.rot && r5.rotN === 1 && cornerErr < 1e-6 && near(r5.rotArea, 1200, 1e-6) && r5.got.every((g) => near(g[2], r5.rotZ, 1e-9)));
  const L_RING = ['20,20', '40,20', '40,30', '30,30', '30,25', '20,25'];
  const ringKey = (r) => { const s = r.map((q) => q.join(',')); const k = s.indexOf(s.slice().sort()[0]); return [...s.slice(k), ...s.slice(0, k)].join(' '); };
  chk(`sub-blocked model (${r5.sub ? 'sub-blocked' : 'NOT sub-blocked'}): ORE outline on the fine lattice = the L ${r5.subRing && ringKey(r5.subRing)} (${ringKey(L_RING.map((s) => s.split(',').map(Number)))}), ${r5.subArea} m² = 150; bench ${r5.subZ && r5.subZ.slice(0, 2).join('–')} (one parent), ${r5.subZ && r5.subZ[2]} blocks, ${r5.subZ && r5.subZ[3]} m³ = 4 × 125 + 1000`, r5.sub && r5.subN === 1 && near(r5.subArea, 150, 1e-6) && ringKey(r5.subRing) === ringKey(L_RING.map((s) => s.split(',').map(Number))) && r5.subZ[0] === 800 && r5.subZ[1] === 810 && near(r5.subZ[3], 1500, 1e-6));

  // ═══ §6 export → reopen ═══
  const r6 = await evaluateSettled(p, async () => {
    const M = window._micro, out = {};
    const Lo = M.layers().find((q) => q.name === 'ore_outlines.csv');
    const src = M.featuresOf(Lo);
    // the VERTICES themselves (sweep 2026-11-25: area and counts survive a translation, so an exporter
    // writing frame-local or shifted coordinates passed): every x, y to the millimetre, as a multiset
    const pts = (fs) => fs.flatMap((x) => x.rings.flatMap((r) => r.map((q) => `${(+q[0]).toFixed(3)},${(+q[1]).toFixed(3)}`))).sort().join(' ');
    const sum = (fs) => ({ n: fs.length, rings: fs.map((x) => x.rings.length).join(','), area: fs.reduce((s, x) => s + M.polygonAreaXY(x), 0), verts: fs.reduce((s, x) => s + x.rings.reduce((t, r) => t + r.length, 0), 0), pts: pts(fs) });
    out.src = sum(src);
    for (const fmt of ['dxf', 'shp']) {
      const ex = await M.buildFeatureExport(Lo, fmt);
      const id = await M.openBlob(new File([ex.blob], ex.name), ex.name, 'add', null, fmt === 'dxf' ? { asKind: 'features' } : {});
      const L2 = M.layers().find((q) => q.id === id);
      const fs = M.featuresOf(L2);
      out[fmt] = { ...sum(fs), name: ex.name, attrs: fs.map((x) => [x.attrs.BENCH, x.attrs.AREA, x.attrs.TONNES].map(String).join('/')).sort() };
    }
    out.srcAttrs = src.map((x) => [x.attrs.BENCH, x.attrs.AREA, x.attrs.TONNES].map(String).join('/')).sort();
    // section lines through the same door: the domain boundary as DXF
    const Ld = M.layers().find((q) => q.name === 'dom815.csv');
    const ed = await M.buildFeatureExport(Ld, 'dxf');
    const idd = await M.openBlob(new File([ed.blob], 'dom815_rt.dxf'), 'dom815_rt.dxf', 'add', null, { asKind: 'features' });
    const fd = M.featuresOf(M.layers().find((q) => q.id === idd));
    out.dom = { n: fd.length, verts: fd[0].rings[0].length, closed: fd[0].closed, same: pts(fd) === pts(M.featuresOf(Ld)) };
    return out;
  });
  chk(`DXF round trip of the outlines (${r6.dxf.name}): ${r6.dxf.n} polygons, rings ${r6.dxf.rings} (src ${r6.src.rings}), ${r6.dxf.verts} vertices (${r6.src.verts}), ${r6.dxf.area} m² (${r6.src.area}); attributes ${r6.dxf.attrs.join(' | ')}`, r6.dxf.n === r6.src.n && r6.dxf.rings === r6.src.rings && r6.dxf.verts === r6.src.verts && near(r6.dxf.area, r6.src.area, 1e-3) && r6.dxf.attrs.join('|') === r6.srcAttrs.join('|'));
  chk(`shapefile round trip (${r6.shp.name}): ${r6.shp.n} polygons, rings ${r6.shp.rings}, ${r6.shp.area} m², attributes ${r6.shp.attrs.join(' | ')}`, r6.shp.n === r6.src.n && r6.shp.rings === r6.src.rings && near(r6.shp.area, r6.src.area, 1e-3) && r6.shp.attrs.join('|') === r6.srcAttrs.join('|'));
  chk(`the domain boundary out as DXF and back: ${r6.dom.n} open line of ${r6.dom.verts} corners, at the same coordinates (${r6.dom.same})`, r6.dom.n === 1 && r6.dom.verts === 39 && !r6.dom.closed && r6.dom.same);
  chk(`…and both outline round trips put every vertex back where it was, to the millimetre (DXF ${r6.dxf.pts === r6.src.pts}, shapefile ${r6.shp.pts === r6.src.pts})`, r6.dxf.pts === r6.src.pts && r6.shp.pts === r6.src.pts);

  // ═══ §7 the layer menu + the palette ═══
  const r7 = await evaluateSettled(p, async () => {
    const M = window._micro;
    const walk = (items) => items.flatMap((it) => [it.label || '', ...(it.submenu ? walk(it.submenu()) : [])]);
    const geo = (L) => { const g = M.layerMenuSections(L, 0, 0).find((it) => it.label === 'Geometry'); return g ? walk(g.submenu()) : []; };
    const model = M.layers().find((q) => (q.label || q.name) === 'model'), box = M.layers().find((q) => q.name === 'box.ply'), topo = M.layers().find((q) => q.name === 'topo.asc');
    const ids = M.COMMANDS.map((c) => c.id);
    // the dialogs open
    M.COMMANDS.find((c) => c.id === 'blockoutlines').run({ L: model });
    const ow = !!document.querySelector('.fwin[data-blockoutlines]');
    M.COMMANDS.find((c) => c.id === 'sectionlines').run({ L: box });
    const sw = document.querySelector('.fwin[data-sectionlines]');
    const boxes = sw ? [...sw.querySelectorAll('input[type=checkbox][data-layer]')].filter((x) => x.checked).map((x) => x.dataset.layer) : [];
    return { model: geo(model), box: geo(box), topo: geo(topo), ids: ['sectionlines', 'blockoutlines'].filter((x) => ids.includes(x)), ow, sw: !!sw, boxes };
  });
  chk(`Geometry submenu: the model has “${r7.model.filter((l) => /outline|boundar/i.test(l)).join('”, “')}”; the box “${r7.box.filter((l) => /Section lines/.test(l)).join('')}”; the grid “${r7.topo.filter((l) => /Section lines/.test(l)).join('')}”`, r7.model.some((l) => /Bench outlines/.test(l)) && r7.model.some((l) => /Domain boundaries/.test(l)) && r7.box.some((l) => /Section lines/.test(l)) && r7.topo.some((l) => /Section lines/.test(l)));
  chk(`palette commands ${r7.ids.join(', ')}; their windows open (outlines ${r7.ow}, section lines ${r7.sw} with the box ticked: ${r7.boxes.join(',')})`, r7.ids.length === 2 && r7.ow && r7.sw && r7.boxes.join(',') === 'box.ply');

  if (SHOT) {
    await evaluateSettled(p, async () => {
      const M = window._micro;
      for (const w of document.querySelectorAll('.fwin')) w.remove();
      M.setSectionWorld({ mode: 'off' });
      const H = window.micro;
      const Lm = M.layers().find((q) => (q.label || q.name) === 'model');
      // the ORE outlines at bench 1's crest, and every domain's outline at each crest, over the model cut to benches 0–1
      const ore = await M.runTool('blockoutlines', { layer: Lm.name, column: 'ZONE', value: 'ORE', level: 'top', name: 'shot_ore' });
      const dom = await M.runTool('blockoutlines', { layer: Lm.name, by: 'DOM', level: 'top', name: 'shot_dom' });
      const keep = new Set([Lm.name, ore.layers[0], dom.layers[0]]);
      for (const L of M.layers()) H.setVisible(L.id, keep.has(L.name));
      for (const nm of [ore.layers[0], dom.layers[0]]) { const L = M.layers().find((q) => q.name === nm); M.renderer.setLayerStickRadius(L.id, nm === ore.layers[0] ? 1.6 : 0.9); }
      await H.setColorBy(Lm.id, 'ZONE');
      const Lc = M.layers().find((q) => (q.label || q.name) === 'model');   // a colour-by may re-open the layer
      await H.filter(Lc.id, 'ZC < 820');
      M.setActiveLayer(Lc.id);
      H.fit(Lc.id);
      M.cam.state.phi = 0.75; M.cam.state.theta = -0.55; M.cam.update(); M.requestRender();
      await new Promise((z) => setTimeout(z, 1500));
    });
    await mkdir('experiments', { recursive: true });
    await p.screenshot({ path: 'experiments/wave6-outlines.png' });
    console.log('shot → experiments/wave6-outlines.png');
  }
  await p.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; }

console.log(`\n${pass} passed, ${fail} failed`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
