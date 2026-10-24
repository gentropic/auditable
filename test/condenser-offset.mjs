// renderer.setLayerOffset — translate a layer at draw time, no chunk rebuild.
// Five layers, one per pipeline (blocks · points · sticks · mesh · soup), laid
// out in a column and seen from above; each is moved 150 m east + 30 m up and
// must: DRAW there (pixels), PICK there (ID buffer), re-upload NOTHING (GL
// buffer calls counted), be CUT there by a section, keep re-shading there
// (deferred resolve), grow contentBbox, survive vertical exaggeration, and come
// back when cleared. Drives the BUILT ext/condenser/core.js (what embedders
// vendor). Run: node test/condenser-offset.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><body style="margin:0;background:#000"></body>'); }
  try { const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });

const r = await page.evaluate(async () => {
  const M = await import('/ext/condenser/core.js');
  const W = 800, H = 600;
  const cv = document.createElement('canvas');
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px`;
  document.body.appendChild(cv);
  const R = M.createRenderer(cv);
  const gl = R.gl, edl = M.createEdl(gl), cam = M.createOrbitCamera();
  const frame = { origin: [612000, 7300000, 400], crs: null, units: 'm' };
  const O = [612000, 7300000, 400];
  const rnd = M.mulberry32(3);
  const LAYERS = { blocks: 0, points: 1, sticks: 2, mesh: 3, soup: 4 };
  const Y0 = { blocks: 0, points: 100, sticks: 200, mesh: 300, soup: 400 };   // each layer: x 0..40, y Y0..Y0+40
  const centre = (k) => [20, Y0[k] + 20, 10];                                  // frame-local

  // blocks: 4×4×2, pitch 10
  {
    const n = 32, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
    let i = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 4; j++) for (let ii = 0; ii < 4; ii++) { x[i] = O[0] + 5 + ii * 10; y[i] = O[1] + 5 + j * 10; z[i] = O[2] + 5 + k * 10; i++; }
    const grid = M.makeBlockGrid([{ origin: O[0] + 5, pitch: 10, count: 4 }, { origin: O[1] + 5, pitch: 10, count: 4 }, { origin: O[2] + 5, pitch: 10, count: 2 }], frame);
    const cb = M.createBlockChunkBuilder({ frame, grid, seed: 1, onChunk: (c) => R.addChunk(c, 'base', LAYERS.blocks) });
    cb.push({ count: n, x, y, z, chan: Float64Array.from({ length: n }, (_, q) => q), cat: new Int32Array(n), recStart: 0 });
    cb.flush();
  }
  // points: a dense 40×40×20 cloud
  {
    const n = 40000, x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
    for (let q = 0; q < n; q++) { x[q] = O[0] + rnd() * 40; y[q] = O[1] + 100 + rnd() * 40; z[q] = O[2] + rnd() * 20; }
    const cb = M.createChunkBuilder({ frame, seed: 2, onChunk: (c) => R.addChunk(c, 'base', LAYERS.points) });
    cb.push({ count: n, x, y, z, intensity: new Uint16Array(n), classification: new Uint8Array(n), rgb: null, recStart: 0 });
    cb.flush();
  }
  // sticks: a 5×5 forest of vertical segments
  {
    const n = 25, f = () => new Float64Array(n);
    const raw = { ax: f(), ay: f(), az: f(), bx: f(), by: f(), bz: f(), x: f(), y: f(), z: f(), chan: f(), cat: new Int32Array(n), recIdx: new Uint32Array(n) };
    for (let q = 0; q < n; q++) {
      const px = O[0] + 4 + (q % 5) * 8, py = O[1] + 204 + Math.floor(q / 5) * 8;
      raw.ax[q] = raw.bx[q] = raw.x[q] = px; raw.ay[q] = raw.by[q] = raw.y[q] = py;
      raw.az[q] = O[2]; raw.bz[q] = O[2] + 20; raw.z[q] = O[2] + 10; raw.recIdx[q] = q;
    }
    R.addChunk(M.buildStickChunk(raw, frame, M.mulberry32(4)), 'base', LAYERS.sticks);
    R.setLayerStickRadius(LAYERS.sticks, 4);
  }
  // mesh + soup: a horizontal 40×40 quad at z = 10 each
  const quad = (y0) => ({ vertices: Float64Array.of(O[0], O[1] + y0, O[2] + 10, O[0] + 40, O[1] + y0, O[2] + 10, O[0] + 40, O[1] + y0 + 40, O[2] + 10, O[0], O[1] + y0 + 40, O[2] + 10), triangles: Uint32Array.of(0, 1, 2, 0, 2, 3) });
  R.addChunk(M.buildMeshChunk({ ...quad(300), frame }), 'base', LAYERS.mesh);
  {
    const q = quad(400), v = q.vertices, t = q.triangles, n = 2, f = () => new Float64Array(n);
    const raw = { ax: f(), ay: f(), az: f(), bx: f(), by: f(), bz: f(), cx: f(), cy: f(), cz: f(), x: f(), y: f(), z: f() };
    for (let k = 0; k < n; k++) {
      const [a, bb, c] = [t[3 * k], t[3 * k + 1], t[3 * k + 2]];
      raw.ax[k] = v[3 * a]; raw.ay[k] = v[3 * a + 1]; raw.az[k] = v[3 * a + 2];
      raw.bx[k] = v[3 * bb]; raw.by[k] = v[3 * bb + 1]; raw.bz[k] = v[3 * bb + 2];
      raw.cx[k] = v[3 * c]; raw.cy[k] = v[3 * c + 1]; raw.cz[k] = v[3 * c + 2];
      raw.x[k] = (raw.ax[k] + raw.bx[k] + raw.cx[k]) / 3; raw.y[k] = (raw.ay[k] + raw.by[k] + raw.cy[k]) / 3; raw.z[k] = (raw.az[k] + raw.bz[k] + raw.cz[k]) / 3;
    }
    R.addChunk(M.buildSoupChunk(raw, frame, M.mulberry32(5)), 'base', LAYERS.soup);
  }

  const scene = Float64Array.of(-10, -10, -10, 200, 450, 60);
  R.setDocBbox(scene);
  const [w, h] = R.resize();
  cam.setAspect(w / h);
  cam.fit(scene);
  cam.orbit(0, 2);                                         // plan view (phi clamps just short of straight down)
  const opts = { budget: 3_000_000, pointPx: 4, colorMode: 0, blocksAsPoints: false, blockEdges: false, section: null, clip: null, layerOpts: null };
  const frame1 = () => edl.render(w, h, cam, () => R.draw(cam, opts), { enabled: false, strength: 0 });
  const converge = () => { let q; for (let f = 0; f < 200; f++) { q = frame1(); if (q.converged && f > 0) break; } return q; };
  // frame-local → CSS px (via the camera's own viewProj)
  const toCss = (p) => { const n = M.transformPoint(cam.state.viewProj, p); return [(n[0] + 1) / 2 * W, (1 - n[1]) / 2 * H]; };
  const bg = R.background;
  const lit = (p) => {                                     // is anything drawn at this point?
    const [x, y] = toCss(p);
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(x * w / W), Math.round(h - y * h / H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Math.abs(px[0] - bg[0] * 255) + Math.abs(px[1] - bg[1] * 255) + Math.abs(px[2] - bg[2] * 255) > 12;
  };
  const pickAt = (p) => { const [x, y] = toCss(p); const q = R.pick(x, y, cam, { pointPx: opts.pointPx, section: opts.section }); return q ? q.layer : null; };
  const OFF = [150, 0, 30];
  const moved = (p) => [p[0] + OFF[0], p[1] + OFF[1], p[2] + OFF[2]];
  const kinds = Object.keys(LAYERS);
  const PICKABLE = ['blocks', 'points', 'sticks', 'mesh'];   // soup is display-only in the ID buffer
  const out = { kinds };

  converge();
  out.before = kinds.map((k) => [k, lit(centre(k)), lit(moved(centre(k))), PICKABLE.includes(k) ? pickAt(centre(k)) : null]);
  const bbox0 = R.contentBbox();

  // count every GL buffer upload from here on: moving must not re-upload
  let uploads = 0;
  for (const fn of ['bufferData', 'bufferSubData']) { const orig = gl[fn].bind(gl); gl[fn] = (...a) => { uploads++; return orig(...a); }; }
  for (const k of kinds) R.setLayerOffset(LAYERS[k], OFF);
  converge();
  out.after = kinds.map((k) => [k, lit(centre(k)), lit(moved(centre(k))), PICKABLE.includes(k) ? pickAt(moved(centre(k))) : null, PICKABLE.includes(k) ? pickAt(centre(k)) : null]);
  out.uploads = uploads;
  out.offsetRead = R.layerOffset(LAYERS.blocks);
  out.bbox = [Array.from(bbox0), Array.from(R.contentBbox())];

  // a section through the MOVED copy (x = 170 ± 15) keeps it; one through the
  // ORIGINAL place (x = 20 ± 15) now cuts it away
  opts.section = { on: true, n: [1, 0, 0], d: 170, half: 15 };
  converge();
  out.secMoved = PICKABLE.map((k) => [k, lit(moved(centre(k))), pickAt(moved(centre(k)))]);
  opts.section = { on: true, n: [1, 0, 0], d: 20, half: 15 };
  converge();
  out.secOrig = PICKABLE.map((k) => [k, lit(moved(centre(k))), pickAt(moved(centre(k)))]);
  opts.section = null;
  converge();

  // a cosmetic change (colour mode) over the converged frame re-shades through
  // the deferred resolve — and must land on the moved pixels
  // (on the blocks layer alone: a sticks/soup recolour re-rasters by design)
  const rc0 = R.resolveCount;
  opts.layerOpts = { [LAYERS.blocks]: { colorMode: 1, clip: null } };
  frame1();
  out.resolve = { ran: R.resolveCount > rc0, movedLit: lit(moved(centre('blocks'))), origLit: lit(centre('blocks')) };
  opts.layerOpts = null;
  converge();

  // vertical exaggeration composes with the offset (both live in the camera)
  cam.state.zExag = 3; cam.update();
  converge();
  out.zexag = PICKABLE.map((k) => [k, pickAt(moved(centre(k)))]);
  cam.state.zExag = 1; cam.update();

  // cleared: everything back where it was
  for (const k of kinds) R.setLayerOffset(LAYERS[k], [0, 0, 0]);
  converge();
  out.cleared = kinds.map((k) => [k, lit(centre(k)), lit(moved(centre(k))), PICKABLE.includes(k) ? pickAt(centre(k)) : null]);
  out.offsetCleared = R.layerOffset(LAYERS.blocks);
  out.LAYERS = LAYERS;
  return out;
});

let ok = true;
const chk = (name, cond, detail) => { console.log(`${cond ? 'ok ' : 'FAIL'} ${name}`); if (!cond) { ok = false; if (detail !== undefined) console.log('     ', JSON.stringify(detail)); } };
const L = r.LAYERS;
chk('before: every layer drawn in place, nothing at the target spot, picks its own layer',
  r.before.every(([k, here, there, pk]) => here && !there && (pk === null || pk === L[k])), r.before);
chk('moved: every pipeline draws at the offset and not at home (blocks · points · sticks · mesh · soup)',
  r.after.every(([, here, there]) => !here && there), r.after);
chk('moved: the ID buffer follows — picks land at the offset, home picks miss',
  r.after.every(([k, , , pkThere, pkHere]) => pkThere === null && !['blocks', 'points', 'sticks', 'mesh'].includes(k) || (pkThere === L[k] && pkHere !== L[k])), r.after);
chk('no GL buffer re-upload to move five layers', r.uploads === 0, r.uploads);
chk('layerOffset reads back; cleared reads [0,0,0]', JSON.stringify(r.offsetRead) === '[150,0,30]' && JSON.stringify(r.offsetCleared) === '[0,0,0]', [r.offsetRead, r.offsetCleared]);
const [b0, b1] = r.bbox;
chk('contentBbox includes the offsets (fit-to-view frames the exploded scene)',
  Math.abs(b1[3] - (b0[3] + 150)) < 1e-6 && Math.abs(b1[5] - (b0[5] + 30)) < 1e-6 && Math.abs(b1[0] - (b0[0] + 150)) < 1e-6, r.bbox);
chk('section through the moved copy keeps it (drawn + picked)', r.secMoved.every(([k, lit, pk]) => lit && pk === L[k]), r.secMoved);
chk('section through the home position cuts the moved copy away', r.secOrig.every(([, lit, pk]) => !lit && pk === null), r.secOrig);
chk('deferred re-shade runs and paints the moved pixels, not home', r.resolve.ran && r.resolve.movedLit && !r.resolve.origLit, r.resolve);
chk('vertical exaggeration × offset: picks still land on the moved copy', r.zexag.every(([k, pk]) => pk === L[k]), r.zexag);
chk('cleared: every layer back home', r.cleared.every(([k, here, there, pk]) => here && !there && (pk === null || pk === L[k])), r.cleared);
chk('no page errors', errors.length === 0, errors);
await b.close(); server.close();
console.log(ok ? 'CONDENSER OFFSET: PASS' : 'CONDENSER OFFSET: FAIL');
process.exit(ok ? 0 : 1);
