// micro smoke — CO-REGISTRATION: every layer kind, opened FIRST into an empty scene and opened
// SECOND after another layer, is drawn where its file says it is.
//
// The whole class of bug this guards against: a value in WORLD coordinates (what the file, the
// user, a host says — UTM metres) mixed with a FRAME-LOCAL one (what the renderer draws: world
// minus the scene frame's origin, which the first layer plants). v0.7.3's surface bug was exactly
// that — a grid opened as a surface into an empty scene built its relief before the frame existed,
// in world numbers, and everything added afterwards sat ~600 km away from it. Nothing caught it
// because no test opened a surface FIRST.
//
// For each kind, in both orders (the kind first then a reference block model; the reference first
// then the kind), two boxes are read back and mapped to world with the frame's origin:
//   - the layer's own bboxLocal (what micro's queries use), and
//   - the renderer's content box for the layer (what is DRAWN),
// and each must enclose the fixture's own coordinate extent — computed here, from the data, not
// read back — and reach past it by at most the kind's half-size (a block's half pitch, a cell, a
// stick's radius). The reference model must land where ITS file says, too.
//
// Run: node test/micro-coreg-smoke.mjs (dev tree) · --built (micro.html). MICRO_CHROMIUM_ARGS honoured.
import { chromium } from 'playwright';
import { installSmokeWaits, evaluateSettled } from './smoke-wait.mjs';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { makeLas } from './las-make.mjs';
import { makeDM } from './dm-make.mjs';
import { writeParquet } from '../ext/parquet/index.js';

const BUILT = process.argv.includes('--built');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
console.log(`micro-coreg-smoke against the ${BUILT ? 'BUILT micro.html' : 'dev tree'}`);

// ── fixtures: all near the same UTM spot, each with its OWN extent (so a mix-up can't hide) ──
const E0 = 612000, N0 = 7765000;
const ext = (pts) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let a = 0; a < 3; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] > hi[a]) hi[a] = p[a]; } return { lo, hi }; };
const K = [];
const add = (k) => K.push(k);

// the reference: a 10 × 10 × 4 block model of 10 m blocks, centroids from (E0+205, N0+105, 405)
const REF_C = []; for (let k = 0; k < 4; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) REF_C.push([E0 + 205 + 10 * i, N0 + 105 + 10 * j, 405 + 10 * k]);
const REF = { name: 'ref.csv', text: 'XC,YC,ZC,AU\n' + REF_C.map((c, n) => `${c.join(',')},${n % 7}`).join('\n') + '\n', ...ext(REF_C), pad: 5 };

// blocks (CSV), 8 × 6 × 3 of 10 m
{ const C = []; for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) C.push([E0 + 15 + 10 * i, N0 + 25 + 10 * j, 455 + 10 * k]);
  add({ kind: 'blocks (CSV)', name: 'blocks.csv', text: 'XC,YC,ZC,FE\n' + C.map((c, n) => `${c.join(',')},${30 + (n % 9)}`).join('\n') + '\n', ...ext(C), pad: 5,
    probe: [E0 + 15 + 10 * 3, N0 + 25 + 10 * 2, 475 + 5] }); }   // the TOP face of block (3, 2), centre
// blocks (Parquet)
{ const C = []; for (let k = 0; k < 2; k++) for (let j = 0; j < 5; j++) for (let i = 0; i < 6; i++) C.push([E0 + 45 + 10 * i, N0 + 135 + 10 * j, 425 + 10 * k]);
  const buf = writeParquet({ columnData: [{ name: 'XC', data: C.map((c) => c[0]) }, { name: 'YC', data: C.map((c) => c[1]) }, { name: 'ZC', data: C.map((c) => c[2]) }, { name: 'FE', data: C.map((_, n) => 40 + (n % 5)) }] });
  add({ kind: 'blocks (Parquet)', name: 'blocks.parquet', bytes: [...new Uint8Array(buf)], ...ext(C), pad: 5 }); }
// blocks (Datamine .dm)
{ const C = []; for (let k = 0; k < 2; k++) for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) C.push([E0 + 65 + 10 * i, N0 + 15 + 10 * j, 505 + 10 * k]);
  const fields = [{ name: 'XC', type: 'N' }, { name: 'YC', type: 'N' }, { name: 'ZC', type: 'N' }, { name: 'XINC', type: 'N', constant: 10 }, { name: 'YINC', type: 'N', constant: 10 }, { name: 'ZINC', type: 'N', constant: 10 }, { name: 'AU', type: 'N' }];
  const dm = makeDM(fields, C.map((c, n) => ({ XC: c[0], YC: c[1], ZC: c[2], AU: n % 4 })), { precision: 'ep' });
  add({ kind: 'blocks (.dm)', name: 'blocks.dm', bytes: [...new Uint8Array(dm.buffer || dm)], ...ext(C), pad: 5 }); }
// points (a delimited XYZ, opened as points)
{ const P = []; for (let n = 0; n < 60; n++) P.push([E0 + 300 + (n * 37) % 90 + 0.25, N0 + 20 + (n * 53) % 70 + 0.5, 380 + (n * 29) % 40]);
  add({ kind: 'points (CSV)', name: 'points.csv', text: 'X,Y,Z,V\n' + P.map((p, n) => `${p.join(',')},${n}`).join('\n') + '\n', opts: { asKind: 'points' }, ...ext(P), pad: 0 }); }
// a LAS cloud
{ const P = []; for (let n = 0; n < 80; n++) P.push({ x: E0 + 120 + (n * 41) % 60 + 0.125, y: N0 + 210 + (n * 17) % 50, z: 470 + (n * 7) % 30 });
  const las = makeLas(P, { offset: [E0, N0, 0] });
  add({ kind: 'LAS cloud', name: 'cloud.las', bytes: [...new Uint8Array(las.buffer || las)], ...ext(P.map((q) => [q.x, q.y, q.z])), pad: 0.002 }); }
// a PLY point cloud (ASCII)
{ const P = []; for (let n = 0; n < 40; n++) P.push([E0 + 10 + (n * 13) % 30, N0 + 180 + (n * 7) % 20, 520 + (n * 3) % 10]);
  const ply = `ply\nformat ascii 1.0\nelement vertex ${P.length}\nproperty double x\nproperty double y\nproperty double z\nend_header\n` + P.map((p) => p.join(' ')).join('\n') + '\n';
  add({ kind: 'PLY points', name: 'pts.ply', text: ply, ...ext(P), pad: 0 }); }
// a mesh (OBJ): a tilted quad
{ const V = [[E0 + 150, N0 + 20, 430], [E0 + 230, N0 + 25, 445], [E0 + 235, N0 + 90, 470], [E0 + 155, N0 + 85, 455]];
  add({ kind: 'mesh (OBJ)', name: 'quad.obj', text: V.map((v) => `v ${v.join(' ')}`).join('\n') + '\nf 1 2 3\nf 1 3 4\n', ...ext(V), pad: 0,
    probe: [0, 1, 2].map((a) => (V[0][a] + V[1][a] + V[2][a]) / 3) }); }   // triangle 1-2-3's centroid
// a mesh (PLY, faces)
{ const V = [[E0 + 260, N0 + 160, 400], [E0 + 330, N0 + 160, 410], [E0 + 330, N0 + 230, 420], [E0 + 260, N0 + 230, 415]];
  const ply = `ply\nformat ascii 1.0\nelement vertex 4\nproperty double x\nproperty double y\nproperty double z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n` + V.map((v) => v.join(' ')).join('\n') + '\n3 0 1 2\n3 0 2 3\n';
  add({ kind: 'mesh (PLY)', name: 'quad.ply', text: ply, ...ext(V), pad: 0 }); }
// a grid (ESRI ASCII): 21 × 16 nodes of 5 m, a slope — opened as nodes, as a SURFACE, and as a flat sheet
{ const nx = 21, ny = 16, dx = 5, x0 = E0 + 40, y0 = N0 + 260, z = (c, r) => 480 + 0.5 * c - 0.3 * r;
  let asc = `ncols ${nx}\nnrows ${ny}\nxllcorner ${x0 - dx / 2}\nyllcorner ${y0 - dx / 2}\ncellsize ${dx}\nNODATA_value -9999\n`;
  const pts = [];
  for (let r = 0; r < ny; r++) { const row = []; for (let c = 0; c < nx; c++) { const v = z(c, r); row.push(v.toFixed(3)); pts.push([x0 + c * dx, y0 + (ny - 1 - r) * dx, v]); } asc += row.join(' ') + '\n'; }
  const e = ext(pts);
  add({ kind: 'grid (nodes)', name: 'g_nodes.asc', text: asc, ...e, pad: 2.5 });
  add({ kind: 'grid as SURFACE', name: 'g_surf.asc', text: asc, opts: { asKind: 'surface' }, ...e, pad: 2.5,
    probe: [x0 + 10 * dx, y0 + (ny - 1 - 8) * dx, z(10, 8)] }); }   // node (row 8, col 10)
// drillholes: one vertical hole, 100 m
{ const collar = `HOLEID,X,Y,Z\nDH1,${E0 + 380},${N0 + 180},500\n`, survey = 'HOLEID,DEPTH,AZ,DIP\nDH1,0,0,-90\nDH1,100,0,-90\n';
  let assay = 'HOLEID,FROM,TO,FE\n'; for (let d = 0; d < 100; d += 10) assay += `DH1,${d},${d + 10},${40 + d / 10}\n`;
  add({ kind: 'drillholes', dh: { collar, survey, assay }, lo: [E0 + 380, N0 + 180, 400], hi: [E0 + 380, N0 + 180, 500], pad: 3 }); }
// polygons (a WKT-CSV table)
{ const R = [[E0 + 20, N0 + 330, 450], [E0 + 90, N0 + 330, 450], [E0 + 90, N0 + 380, 450], [E0 + 20, N0 + 380, 450]];
  const wkt = `POLYGON Z ((${[...R, R[0]].map((p) => p.join(' ')).join(', ')}))`;
  add({ kind: 'polygons (WKT-CSV)', name: 'limits.csv', text: `NAME,WKT\npit,"${wkt}"\n`, ...ext(R), pad: 0.5 }); }

// ── the page ──
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
let pass = 0, fail = 0;
const chk = (n, c) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };

// open one fixture (in the page) → its layer id
const OPEN = async (k, mode) => {
  const M = window._micro;
  if (k.dh) return M.importDrillholes({ collar: new File([k.dh.collar], 'collars.csv'), survey: new File([k.dh.survey], 'survey.csv'), intervals: new File([k.dh.assay], 'assay.csv') }, {}, mode).then(() => M.layers().find((L) => L.dh && !L.trace).id);
  const data = k.bytes ? new Uint8Array(k.bytes) : k.text;
  return M.openBlob(new File([data], k.name), k.name, mode, null, { throw: true, ...(k.opts || {}) });
};
// a world point ON the layer → the screen (the camera's own viewProj) → worldAt → back
const PROBE = async (id, w) => {
  const M = window._micro, W = window.micro, cv = document.querySelector('#cv');
  await W.look('plan'); await W.fit(); await new Promise((z) => setTimeout(z, 400));
  const rect = cv.getBoundingClientRect(), st = M.cam.state, o = M.frame.origin, V = st.viewProj, q = [w[0] - o[0], w[1] - o[1], w[2] - o[2]];
  const xx = V[0] * q[0] + V[4] * q[1] + V[8] * q[2] + V[12], yy = V[1] * q[0] + V[5] * q[1] + V[9] * q[2] + V[13], ww = V[3] * q[0] + V[7] * q[1] + V[11] * q[2] + V[15];
  const hit = await W.worldAt([(xx / ww + 1) / 2 * rect.width, (1 - yy / ww) / 2 * rect.height]);
  return hit && hit.world ? { world: hit.world, own: hit.layer === id } : null;
};
// the two boxes of a layer, in world: its bboxLocal, and the renderer's drawn content box
const BOXES = (id) => {
  const M = window._micro, L = M.layers().find((x) => x.id === id), o = M.frame.origin;
  const w = (b6) => (b6 && b6.length >= 6 ? [b6[0] + o[0], b6[1] + o[1], b6[2] + o[2], b6[3] + o[0], b6[4] + o[1], b6[5] + o[2]].map(Number) : null);
  let drawn = null; try { drawn = w(Array.from(M.renderer.contentBbox({ layers: [id] }))); } catch { /* no content box */ }
  return { local: w(L && L.bboxLocal ? Array.from(L.bboxLocal) : null), drawn, origin: o.slice() };
};

const inside = (box, k) => {
  if (!box) return 'no box';
  const tol = 0.01, bad = [];
  for (let a = 0; a < 3; a++) {
    const lo = box[a], hi = box[a + 3];
    if (!(lo <= k.lo[a] + tol && lo >= k.lo[a] - k.pad - tol)) bad.push(`${'xyz'[a]} lo ${lo.toFixed(2)} vs ${k.lo[a]}`);
    if (!(hi >= k.hi[a] - tol && hi <= k.hi[a] + k.pad + tol)) bad.push(`${'xyz'[a]} hi ${hi.toFixed(2)} vs ${k.hi[a]}`);
  }
  return bad.length ? bad.join('; ') : '';
};

try {
  const p = await ctx.newPage(); p.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await p.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window._micro && window._micro.openBlob, null, { timeout: 30000 });
  await p.evaluate(() => { try { window._micro.setAutoOptimize('off'); window._micro.setAutoPack('off'); } catch { /* older builds */ } });
  for (const k of K) {
    const r = await evaluateSettled(p, async ({ k, REF, OPEN, BOXES, PROBE }) => {
      const open = eval(OPEN), boxes = eval(BOXES), probe = eval(PROBE), M = window._micro, out = {};
      // 1. the kind FIRST, into an empty scene; then the reference added
      const id1 = await open(k, 'replace');
      out.firstAlone = boxes(id1);
      if (k.probe) out.probe1 = await probe(id1, k.probe);
      const ref1 = await open(REF, 'add');
      out.firstThen = boxes(id1); out.ref1 = boxes(ref1);
      // 2. the reference FIRST; the kind added
      const ref2 = await open(REF, 'replace');
      const id2 = await open(k, 'add');
      out.second = boxes(id2); out.ref2 = boxes(ref2);
      if (k.probe) out.probe2 = await probe(id2, k.probe);
      return out;
    }, { k, REF, OPEN: OPEN.toString(), BOXES: BOXES.toString(), PROBE: PROBE.toString() });
    const probs = [];
    for (const [when, bx] of [['opened first', r.firstAlone], ['after the reference joined', r.firstThen], ['opened second', r.second]]) {
      for (const which of ['local', 'drawn']) { const e = inside(bx[which], k); if (e) probs.push(`${when}, ${which === 'local' ? 'its box' : 'as drawn'}: ${e}`); }
    }
    for (const [when, bx] of [['beside it', r.ref1], ['under it', r.ref2]]) {
      const e = inside(bx.local, REF) || inside(bx.drawn, REF); if (e) probs.push(`the reference ${when}: ${e}`);
    }
    if (k.probe) {
      const off = (h) => (h && h.own ? Math.hypot(h.world[0] - k.probe[0], h.world[1] - k.probe[1], h.world[2] - k.probe[2]) : Infinity);
      const e1 = off(r.probe1), e2 = off(r.probe2);
      chk(`${k.kind}: a point on it, projected to the screen and picked back with worldAt, comes back as itself — opened first (off by ${e1.toFixed(3)} m), opened second (${e2.toFixed(3)} m)`, e1 < 0.1 && e2 < 0.1);
    }
    chk(`${k.kind}: drawn where its file says — opened first, with a layer added after, and opened second${probs.length ? ' — ' + probs.slice(0, 3).join(' | ') : ''}`, probs.length === 0);
  }
  await p.close();
} catch (e) { console.log('FAIL  threw:', e.stack || e.message); fail++; } finally {
  await b.close(); server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
