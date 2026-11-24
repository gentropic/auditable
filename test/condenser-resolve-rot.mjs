// Deferred re-shade (gl-resolve.js) parity on a ROTATED lattice (block-support
// step 2 lifted the rotated bail-out): the blocks layer sits on a lattice turned
// 35° about Z, so its face ids name LATTICE faces — shaded by R·n — and its edge
// lines are reconstructed in the lattice frame. A blocks layer + a points
// layer converge through EDL; each COSMETIC change (ramp, colour mode,
// selection, dim-filter, clip) must (a) take the resolve path — one frame,
// resolveCount++ — and (b) produce pixels that match a forced full re-raster
// of the same state. Fallback + invalidation paths checked too.
import { chromium } from 'playwright';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname } from 'path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try { const path = decodeURIComponent(new URL(req.url, 'http://x').pathname); const data = await readFile('.' + path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
await p.goto(`http://127.0.0.1:${server.address().port}/tools/micro/index.html`, { waitUntil: 'load' });
await p.waitForFunction(() => window._micro, null, { timeout: 15000 });

const out = await p.evaluate(async () => {
  const M = await import('/ext/condenser/src/main.js');
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:99';
  document.body.appendChild(cv);
  const R = M.createRenderer(cv);
  const gl = R.gl;
  const edl = M.createEdl(gl);
  const cam = M.createOrbitCamera();
  const frame = { origin: [612000, 8200000, 900], crs: null, units: 'm' };

  const ROT = M.datamineRotZ(35), ANC = [612200, 8200000, 900];
  // blocks layer 0 (east): 20×20×4 grid, graded channel + a category stripe
  const N = 20 * 20 * 4;
  const bx = new Float64Array(N), by = new Float64Array(N), bz = new Float64Array(N);
  const chan = new Float64Array(N), cat = new Int32Array(N);
  let i = 0;
  for (let k = 0; k < 4; k++) for (let j = 0; j < 20; j++) for (let ii = 0; ii < 20; ii++) {
    { const qx = ii * 10, qy = j * 10; bx[i] = ANC[0] + ROT[0] * qx + ROT[3] * qy; by[i] = ANC[1] + ROT[1] * qx + ROT[4] * qy; bz[i] = 900 + k * 10; }
    chan[i] = 10 + ii * 3 + k * 5; cat[i] = j % 5;
    i++;
  }
  // ROTATED lattice (−35° about Z): lattice coords q, world = anchor + R·q
  const grid = M.makeBlockGrid([
    { origin: 0, pitch: 10, count: 20 },
    { origin: 0, pitch: 10, count: 20 },
    { origin: 0, pitch: 10, count: 4 },
  ], frame, ROT, ANC);
  const cb0 = M.createBlockChunkBuilder({ frame, grid, chunkSize: 500, seed: 1, onChunk: (c) => R.addChunk(c, 'base', 0) });
  cb0.push({ count: N, x: bx, y: by, z: bz, chan, cat, recStart: 0 });
  const doc0 = cb0.flush();

  // points layer 1 (west): 20k random points
  const NP = 20000;
  const px2 = new Float64Array(NP), py2 = new Float64Array(NP), pz2 = new Float64Array(NP);
  const inten = new Uint16Array(NP);
  const rnd = M.mulberry32(7);
  for (let q = 0; q < NP; q++) {
    px2[q] = 611800 + rnd() * 150; py2[q] = 8200000 + rnd() * 190; pz2[q] = 900 + rnd() * 40;
    inten[q] = (rnd() * 65535) | 0;
  }
  const cb1 = M.createChunkBuilder({ frame, chunkSize: 1 << 13, seed: 2, onChunk: (c) => R.addChunk(c, 'base', 1) });
  cb1.push({ count: NP, x: px2, y: py2, z: pz2, intensity: inten, classification: new Uint8Array(NP), rgb: null, recStart: 0 });
  const doc1 = cb1.flush();

  const bb = Float64Array.of(
    Math.min(doc0.bboxLocal[0], doc1.bboxLocal[0]), Math.min(doc0.bboxLocal[1], doc1.bboxLocal[1]), Math.min(doc0.bboxLocal[2], doc1.bboxLocal[2]),
    Math.max(doc0.bboxLocal[3], doc1.bboxLocal[3]), Math.max(doc0.bboxLocal[4], doc1.bboxLocal[4]), Math.max(doc0.bboxLocal[5], doc1.bboxLocal[5]));
  R.setDocBbox(bb);
  R.setCategories(5);
  const [w, h] = R.resize();
  cam.setAspect(w / h);
  cam.fit(bb);
  cam.orbit(0.5, -0.5);                                    // oblique: block faces visible, lighting exercised

  const opts = { budget: 3_000_000, pointPx: 4, colorMode: 0, blocksAsPoints: false, blockEdges: false, section: null, clip: null, layerOpts: null };
  const frame1 = () => edl.render(w, h, cam, () => R.draw(cam, opts), { enabled: true, strength: 0.6 });
  const converge = () => { let r; for (let f = 0; f < 200; f++) { r = frame1(); if (r.converged && f > 0) break; } return r; };
  const read = () => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const cmp = (a, bpx) => {
    let bad = 0, lit = 0;
    for (let q = 0; q < a.length; q += 4) {
      const d = Math.max(Math.abs(a[q] - bpx[q]), Math.abs(a[q + 1] - bpx[q + 1]), Math.abs(a[q + 2] - bpx[q + 2]));
      if (d > 3) bad++;
      if (a[q] !== 18 || a[q + 1] !== 18 || a[q + 2] !== 18) lit++;   // rough non-background count
    }
    return { bad, lit, frac: bad / (w * h) };
  };

  const checks = [];
  const ck = (name, cond, extra) => checks.push({ name, pass: !!cond, extra: extra ?? '' });

  converge();
  const rc0 = R.resolveCount;
  ck('baseline converges, no resolves yet', rc0 === 0, `rc=${rc0}`);

  // helper: apply a cosmetic change, expect ONE resolved frame matching a
  // forced full re-raster of the same state
  const cosmeticCase = (name, apply) => {
    apply();
    const before = R.resolveCount;
    const r1 = frame1();
    const resolved = r1 && r1.resolved === true && R.resolveCount === before + 1;
    const pxA = read();
    R.invalidate();
    converge();
    const pxB = read();
    const d = cmp(pxA, pxB);
    ck(`${name}: resolve path taken`, resolved, `resolved=${r1 && r1.resolved} rc ${before}→${R.resolveCount}`);
    ck(`${name}: parity vs re-raster`, d.frac < 0.005, `bad=${d.bad}/${w * h} (${(d.frac * 100).toFixed(3)}%) lit=${d.lit}`);
  };

  // 1. ramp swap on both layers
  const warmRamp = M.rampPixels(256, [[20, 10, 60], [200, 60, 30], [255, 230, 120]]);
  cosmeticCase('ramp swap', () => { R.setLayerRamp(0, warmRamp); R.setLayerRamp(1, warmRamp); });

  // 2. colour mode 0 → 1 (grade / intensity), via draw opts
  cosmeticCase('colorMode 0→1', () => { opts.colorMode = 1; });

  // 3. clip range (grade window)
  cosmeticCase('clip window', () => { opts.clip = [20, 60]; });

  // 4. selection wash on the blocks
  cosmeticCase('selection wash', () => {
    const sel = new Uint8Array(N); for (let q = 0; q < N; q += 3) sel[q] = 1;
    R.setLayerSelection(0, sel);
  });

  // 5. dim-mode filter on the points
  cosmeticCase('dim filter', () => {
    const mask = new Uint8Array(NP); for (let q = 0; q < NP; q++) mask[q] = q % 2;
    R.setFilter(mask, { isolate: false }, 1);
  });

  // 6. categorical colouring (mode 2) — palette path
  cosmeticCase('colorMode 2 (cats)', () => { opts.colorMode = 2; });

  // 7. block EDGES on: turning them on is structural, but a ramp poke over the
  // edged converged frame RESOLVES — the capture depth unprojects the hit
  // point and the edge factor recomputes exactly (regular grids)
  opts.blockEdges = true;
  converge();                                             // structural change redraws
  cosmeticCase('ramp poke with edges on', () => { R.setLayerRamp(0, M.rampPixels()); });
  opts.blockEdges = false;
  converge();

  // 8. camera move invalidates the capture; the next cosmetic re-resolves
  converge();
  cam.orbit(0.2, 0.1);
  converge();
  const rc8 = R.resolveCount;
  cosmeticCase('post-orbit ramp swap', () => { R.setLayerRamp(1, M.rampPixels()); });
  ck('capture retaken after orbit', R.resolveCount === rc8 + 1, `rc ${rc8}→${R.resolveCount}`);

  // 9. isolate filter: SETTING it re-rasters (culling changed), but a ramp
  // change on the ISOLATED layer then resolves — the capture already shows
  // the culled set, and the mask hasn't moved since
  const maskI = new Uint8Array(NP); for (let q = 0; q < NP; q++) maskI[q] = q % 4 === 0 ? 1 : 0;
  R.setFilter(maskI, { isolate: true }, 1);
  const rcI = R.resolveCount;
  const rI = frame1();
  ck('isolate SET: falls back to re-raster', !(rI && rI.resolved) && R.resolveCount === rcI, `resolved=${rI && rI.resolved}`);
  converge();
  cosmeticCase('ramp change on the isolated layer', () => { R.setLayerRamp(1, M.rampPixels()); });
  R.setFilter(null, {}, 1);
  converge();

  // 10. THE DRILLHOLE SCENE (Arthur's case): a sticks layer coexists — a ramp
  // change on the BLOCKS layer must still resolve (sticks pixels untouched);
  // a change that recolours the sticks themselves must re-raster.
  const NS = 300;
  const sax = new Float64Array(NS), say = new Float64Array(NS), saz = new Float64Array(NS);
  const sbx = new Float64Array(NS), sby = new Float64Array(NS), sbz = new Float64Array(NS);
  const smx = new Float64Array(NS), smy = new Float64Array(NS), smz = new Float64Array(NS);
  const sch = new Float64Array(NS);
  const rnd2 = M.mulberry32(11);
  for (let q = 0; q < NS; q++) {
    const hx = 612050 + rnd2() * 100, hy = 8200000 + rnd2() * 190, z0 = 945 - (q % 30) * 1.5;
    sax[q] = hx; say[q] = hy; saz[q] = z0;
    sbx[q] = hx; sby[q] = hy; sbz[q] = z0 - 1.5;
    smx[q] = hx; smy[q] = hy; smz[q] = z0 - 0.75;
    sch[q] = 20 + rnd2() * 40;
  }
  const cb2 = M.createStickChunkBuilder({ frame, chunkSize: 1 << 10, seed: 3, onChunk: (c) => R.addChunk(c, 'base', 2) });
  cb2.push({ count: NS, ax: sax, ay: say, az: saz, bx: sbx, by: sby, bz: sbz, x: smx, y: smy, z: smz, chan: sch, recStart: 0 });
  cb2.flush();
  R.invalidate();
  converge();
  const rcS = R.resolveCount;
  cosmeticCase('blocks ramp with sticks in scene', () => { R.setLayerRamp(0, warmRamp); });
  ck('sticks coexistence did not block the resolve', R.resolveCount === rcS + 1, `rc ${rcS}→${R.resolveCount}`);
  // recolour the STICKS layer → must fall back
  R.setLayerRamp(2, warmRamp);
  const rcS2 = R.resolveCount;
  const rS = frame1();
  ck('sticks recolour: falls back to re-raster', !(rS && rS.resolved) && R.resolveCount === rcS2, `resolved=${rS && rS.resolved}`);

  return checks;
});

let fail = 0;
for (const c of out) { console.log(`${c.pass ? 'ok ' : 'FAIL'} ${c.name}${c.extra ? '  — ' + c.extra : ''}`); if (!c.pass) fail++; }
console.log(fail ? `\n${fail} FAILURES` : '\nall good');
await b.close();
server.close();
process.exit(fail ? 1 : 0);
