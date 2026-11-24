// micro performance benchmark — the yardstick for the block-support refactor
// (spec_inbox/micro-block-support-spec.md §6). Measures the code AS IT IS: no
// product hooks, only what window._micro already exposes (the renderer's draw()
// is wrapped from the outside to time frames).
//
//   node test/micro-bench.mjs --model=demo                 the 2M-block demo deposit (FE/SG/LITO), made in-page
//   node test/micro-bench.mjs --model=regular5m            a regular 5M-block CSV, generated once into bench/cache/
//   node test/micro-bench.mjs --model=C:\path\model.dm     any local .dm/.csv/.parquet — opened IN PLACE (a disk-backed
//                                                          File via setInputFiles: never copied, never read into Node)
//   --runs=3            repeats; each run is a FRESH browser (no shader/IDB/OPFS caches carried over)
//   --label=baseline    names the result file bench/results/<date>-<model>-<label>.json
//   --built             run against the built micro.html (node build.js --target=micro) instead of the dev tree
//   --compare=<file>    print % deltas against a saved result, flagging anything outside the noise band
//   --only=open,orbit,recolour,colourby,gt,swath,stats,solid   a subset of the measures (open always runs)
//   --orbit=120         frames in the scripted orbit
//   --no-fullres        skip the second orbit at full residency (budget "all": every element, every frame —
//                       the per-block draw cost the budget-capped orbit can't see)
//   --timeout-scale=1   multiply every phase timeout (a slow machine / a huge file)
//   --headed            show the browser
//   --dm-origin=x,y,z   a rotated Datamine model's world origin (the open's `origin`) — a file that carries none
//
// Output: a table on stdout + JSON. Numbers are wall-clock in the page (performance.now()).
// A private model file's results carry timings and counts only — never column names or values.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const has = (n) => process.argv.includes(`--${n}`);
const MODEL = arg('model', 'demo');
const RUNS = Math.max(1, +arg('runs', 3) | 0);
const LABEL = arg('label', 'run');
const BUILT = has('built');
const ORBIT_N = Math.max(10, +arg('orbit', 120) | 0);
const TSCALE = +arg('timeout-scale', 1) || 1;
const DM_ORIGIN = arg('dm-origin', '') ? arg('dm-origin', '').split(',').map(Number) : null;
const ONLY = new Set(arg('only', 'open,orbit,recolour,colourby,gt,swath,stats,solid').split(','));
const COMPARE = arg('compare', null);
const FULLRES = !has('no-fullres');
const APP = BUILT ? '/micro.html' : '/tools/micro/index.html';
const isPath = MODEL !== 'demo' && MODEL !== 'regular5m';
const modelTag = isPath ? path.basename(MODEL).replace(/[^A-Za-z0-9._-]/g, '_') : MODEL;

// ── the regular 5M synthetic: 250 × 200 × 100 = 5,000,000 blocks, every cell present, deterministic ──
const CACHE = path.join(ROOT, 'bench', 'cache');
const REG5M = path.join(CACHE, 'regular5m.csv');
async function ensureRegular5m() {
  if (fs.existsSync(REG5M) && fs.statSync(REG5M).size > 1e8) return REG5M;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log('generating bench/cache/regular5m.csv (once)…');
  const NX = 250, NY = 200, NZ = 100, DX = 10, DY = 10, DZ = 5, X0 = 500005, Y0 = 7000005, Z0 = 2.5;
  let s = 0x9e3779b9 >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ROCKS = ['OX', 'TR', 'FR', 'WS'];
  const tmp = REG5M + '.part';
  const out = fs.createWriteStream(tmp);
  const write = (str) => new Promise((r) => { if (out.write(str)) r(); else out.once('drain', r); });
  await write('XC,YC,ZC,AU,CU,DENS,ROCK\n');
  for (let k = 0; k < NZ; k++) {
    const lines = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const u = (i - NX * 0.5) / (NX * 0.3), v = (j - NY * 0.5) / (NY * 0.25), w = (k - NZ * 0.5) / (NZ * 0.35);
      const d2 = u * u + v * v + w * w;
      const au = Math.max(0, 3.5 * Math.exp(-d2) + (rnd() - 0.5) * 0.4);
      const cu = Math.max(0, 0.9 * Math.exp(-d2 * 0.7) + (rnd() - 0.5) * 0.1);
      const dens = 2.6 + 0.4 * Math.exp(-d2) + (rnd() - 0.5) * 0.05;
      const rock = ROCKS[k > NZ * 0.8 ? 0 : k > NZ * 0.6 ? 1 : d2 < 1 ? 2 : 3];
      lines.push(`${X0 + i * DX},${Y0 + j * DY},${Z0 + k * DZ},${au.toFixed(3)},${cu.toFixed(3)},${dens.toFixed(3)},${rock}`);
    }
    await write(lines.join('\n') + '\n');
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, REG5M);
  return REG5M;
}

// ── a static server over the repo (the dev tree / micro.html) ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const withTimeout = (p, ms, what) => {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`TIMEOUT after ${(ms / 1000).toFixed(0)} s: ${what}`)), ms * TSCALE); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
};
const MIN = 60000;

// ── in-page helpers, installed once per page ──
function installPageHelpers() {
  const M = window._micro, R = M.renderer;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const B = window.__bench = {};
  // frames: every draw() the app makes is timed and its result kept (the wrapper is outside the app)
  B.draws = []; B.finish = false;
  const orig = R.draw;
  R.draw = function (...a) {
    const t = performance.now(); const r = orig.apply(this, a);
    if (B.finish) R.gl.finish();
    B.draws.push({ t, ms: performance.now() - t, converged: !!(r && r.converged), resolved: !!(r && r.resolved), drawn: (r && r.drawn) || 0 });
    if (B.draws.length > 5000) B.draws.splice(0, 2500);
    return r;
  };
  // settled = the last draw converged, the element count has not moved for `quiet` frames, nothing redrew since
  B.waitSettled = async (since, { quiet = 10, timeout = 600000 } = {}) => {
    const t0 = performance.now(); let n = -1, stable = 0, firstAt = null, iter = 0;
    for (;;) {
      await raf();
      const ec = R.elementCount; iter++;
      const last = B.draws.length ? B.draws[B.draws.length - 1] : null;
      // since = null: "already idle is fine" (nothing may redraw); a time: a draw at/after it must have converged
      const conv = last && (since == null || last.t >= since) && last.converged && R.accumulated === ec;
      if (conv && ec === n && firstAt != null) { stable++; } else { stable = conv ? 1 : 0; firstAt = conv ? last.t + last.ms : null; }
      n = ec;
      if (stable >= quiet && firstAt != null) return firstAt;
      if (performance.now() - t0 > timeout) throw new Error(`not settled after ${timeout} ms (elements ${ec}, accumulated ${R.accumulated}, draws ${B.draws.length}, last ${JSON.stringify(last)}, since ${since.toFixed(0)}, frames ${iter}, stable ${stable})`);
    }
  };
  B.waitIdleCapture = async (timeout = 60000) => {
    const t0 = performance.now();
    while (!R.captureReady) { await raf(); if (performance.now() - t0 > timeout) return false; }
    return true;
  };
  B.layer = () => M.layers().find((L) => L.kind !== 'mesh' && L.docs && L.docs.blockDoc) || M.layers()[0];
  B.gpu = () => {
    const gl = R.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} · ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : gl.getParameter(gl.RENDERER);
  };
}

const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };

async function oneRun(runIdx, modelPath) {
  const res = { run: runIdx, metrics: {}, notes: [], errors: [] };
  const browser = await chromium.launch({ headless: !has('headed'), args: ['--use-gl=angle', '--enable-precise-memory-info', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('micro.autoPackMeshes', 'off'); } catch { /* opaque origin */ } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => res.errors.push(`pageerror: ${e.message}`));
    await withTimeout(page.goto(`http://127.0.0.1:${PORT}${APP}`, { waitUntil: 'load' }), MIN, 'page load');
    await withTimeout(page.waitForFunction(() => window._micro && window._micro.renderer, null, { timeout: 0, polling: 100 }), MIN, 'window._micro');
    await page.evaluate(installPageHelpers);
    res.gpu = await page.evaluate(() => window.__bench.gpu());
    const cdp = await ctx.newCDPSession(page);
    const heap = async (gc) => { if (gc) await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); const h = await cdp.send('Runtime.getHeapUsage'); return h.usedSize; };

    // ── 1. open ──
    let fileName = null;
    if (modelPath) {                                         // a disk-backed File: the page reads it by slices, Node never holds it
      await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__benchFile'; i.style.display = 'none'; document.body.appendChild(i); });
      await page.setInputFiles('#__benchFile', modelPath);
      fileName = path.basename(modelPath);
    } else {
      await page.evaluate(() => { window.__benchBlob = window._micro.makeDemoBlockCsv(); });   // generation excluded from the open time
    }
    let peak = 0, sampling = true;
    const sampler = (async () => { while (sampling) { try { peak = Math.max(peak, await heap(false)); } catch { /* page busy/closing */ } await new Promise((r) => setTimeout(r, 500)); } })();
    const openTimeout = (modelPath && fs.statSync(modelPath).size > 5e8) ? 30 * MIN : 10 * MIN;
    try {
      const o = await withTimeout(page.evaluate(async ({ fileName, timeout, origin }) => {
        const M = window._micro, B = window.__bench;
        const blob = fileName ? document.querySelector('#__benchFile').files[0] : window.__benchBlob;
        const name = fileName || 'deposit.csv';
        const t0 = performance.now();
        const id = await M.openBlob(blob, name, 'replace', null, origin ? { origin } : {});
        const tResolved = performance.now();
        if (id == null) return { failed: document.querySelector('#meta').textContent };
        const tDrawn = await B.waitSettled(t0, { timeout });
        const L = B.layer();
        return { resolvedMs: tResolved - t0, drawnMs: tDrawn - t0, kind: L.kind, grid: !!(L.docs.blockDoc && (L.docs.blockDoc.grid || L.docs.blockDoc.header.grid)),
          subBlocked: !!(L.docs.blockDoc && L.docs.blockDoc.header.subBlocked), elements: M.renderer.layerElementCount(L.id), chunks: M.renderer.chunkCount,
          meta: document.querySelector('#meta').textContent };
      }, { fileName, timeout: openTimeout * TSCALE, origin: DM_ORIGIN }), openTimeout + MIN, 'open');
      if (o.failed) throw new Error(`open failed: ${isPath ? '(message withheld for a private file)' : o.failed}`);
      res.metrics.open_resolved_ms = o.resolvedMs;
      res.metrics.open_drawn_ms = o.drawnMs;
      res.layer = { kind: o.kind, grid: o.grid, subBlocked: o.subBlocked, elements: o.elements, chunks: o.chunks };
      if (!isPath) res.layer.meta = o.meta;
      else {                                              // structural facts only — the meta line can carry column names
        const m = o.meta;
        res.layer.metaFacts = { pointsView: /points view/.test(m), rotationNote: /rotat/i.test(m), subBlockedNote: /sub-block/i.test(m) };
      }
    } finally { sampling = false; await sampler; }
    res.metrics.heap_open_peak_mb = peak / 1048576;
    res.metrics.heap_after_open_mb = (await heap(true)) / 1048576;
    const mem = await page.evaluate(() => { const R = window._micro.renderer, L = window.__bench.layer(); return { vram: R.vramBytes, layerVram: R.layerVramBytes(L.id), elements: R.layerElementCount(L.id) }; });
    res.metrics.gpu_mb = mem.vram / 1048576;
    res.metrics.gpu_bytes_per_element = mem.layerVram / (mem.elements || 1);

    // the layer's numeric columns (by index for a private file — never by name in the output)
    const cols = await page.evaluate(() => { const M = window._micro, L = window.__bench.layer(); return { name: L.name, nums: M.numericColsOf(L), sel: L.colorSel }; });
    const want = !isPath ? (MODEL === 'demo' ? ['FE', 'SG'] : ['AU', 'CU']) : cols.nums.slice(0, 2);
    const [colA, colB] = [want[0] || cols.nums[0], want[1] || cols.nums[1] || cols.nums[0]];
    res.columns = isPath ? { numeric: cols.nums.length, used: ['#0', '#1'] } : { used: [colA, colB] };
    if (!colA) res.notes.push('no numeric column — analyses skipped');

    // ── 2. orbit ──
    if (ONLY.has('orbit')) {
      try {
        const orb = await withTimeout(page.evaluate(async ({ N, FULL }) => {
          const M = window._micro, B = window.__bench, R = M.renderer;
          document.querySelector('#btnFit').click();
          await B.waitSettled(null, { timeout: 300000 });
          const pass = async (finish) => {
            B.finish = finish; const d0 = B.draws.length;
            const deltas = []; let last = null;
            await new Promise((res) => {
              let i = 0;
              const step = (t) => { if (last != null) deltas.push(t - last); last = t; if (i++ >= N) { res(); return; } M.cam.orbit((2 * Math.PI) / N, 0); M.requestRender(); requestAnimationFrame(step); };
              requestAnimationFrame(step);
            });
            B.finish = false;
            const ds = B.draws.slice(d0);
            return { deltas, draws: ds.map((d) => d.ms), drawCount: ds.length, drawnMean: ds.reduce((s, d) => s + d.drawn, 0) / (ds.length || 1) };
          };
          const plain = await pass(false);
          await B.waitSettled(null, { timeout: 300000 });
          const synced = await pass(true);                  // gl.finish() after each draw: the frame's GPU cost, not just its submission
          await B.waitSettled(null, { timeout: 300000 });
          // full residency: the capped orbit above draws ≤ budget elements per frame on every model, so it can't see
          // per-block draw cost. Raise the budget to "all" and orbit again — every resident element, every frame.
          const bsel = document.querySelector('#budget'), prevBudget = bsel.value;
          let full = null, fullSynced = null;
          if (FULL) {
            const tb = performance.now();
            bsel.value = '100000000'; bsel.dispatchEvent(new Event('input'));
            await B.waitSettled(tb, { timeout: 600000 });
            full = await pass(false);
            await B.waitSettled(null, { timeout: 600000 });
            fullSynced = await pass(true);
            const tr = performance.now();
            bsel.value = prevBudget; bsel.dispatchEvent(new Event('input'));
            await B.waitSettled(tr, { timeout: 300000 });
          }
          return { plain, synced, full, fullSynced, budget: +prevBudget };
        }, { N: ORBIT_N, FULL: FULLRES }), 40 * MIN, 'orbit');
        res.metrics.orbit_frame_p50_ms = pct(orb.plain.deltas, 50);
        res.metrics.orbit_frame_p95_ms = pct(orb.plain.deltas, 95);
        res.metrics.orbit_draw_cpu_p50_ms = pct(orb.plain.draws, 50);
        res.metrics.orbit_gpu_synced_p50_ms = pct(orb.synced.draws, 50);
        res.metrics.orbit_gpu_synced_p95_ms = pct(orb.synced.draws, 95);
        res.budget = orb.budget;
        res.orbit = { frames: ORBIT_N, draws: orb.plain.drawCount, drawnPerFrame: Math.round(orb.plain.drawnMean), syncedDraws: orb.synced.drawCount };
        if (orb.full) {
          res.metrics.orbit_full_frame_p50_ms = pct(orb.full.deltas, 50);
          res.metrics.orbit_full_frame_p95_ms = pct(orb.full.deltas, 95);
          res.metrics.orbit_full_draw_cpu_p50_ms = pct(orb.full.draws, 50);
          res.metrics.orbit_full_synced_p50_ms = pct(orb.fullSynced.draws, 50);
          res.metrics.orbit_full_synced_p95_ms = pct(orb.fullSynced.draws, 95);
          res.orbit.fullDrawnPerFrame = Math.round(orb.full.drawnMean);
        }
      } catch (e) { res.errors.push(`orbit: ${e.message}`); }
    }

    // ── 3. recolour: a ramp-range change, then a colour-by switch → the next settled frame ──
    if (ONLY.has('recolour') && colA) {
      try {
        const rc = await withTimeout(page.evaluate(async (colA) => {
          const M = window._micro, B = window.__bench, R = M.renderer, L = B.layer();
          const sel = M.colorSelFor(L, colA);
          if (sel && L.colorSel !== sel) { await M.setLayerColorSel(L, sel); }
          await B.waitSettled(null, { timeout: 600000 });
          const captured = await B.waitIdleCapture(60000);
          const [lo, hi] = M.rampRangeFor(L);
          const setClip = (a, b) => { const mn = document.querySelector('#clipMin'), mx = document.querySelector('#clipMax'); mn.value = a; mx.value = b; mn.dispatchEvent(new Event('input')); };
          const out = [];
          for (let k = 0; k < 5; k++) {                     // five pokes, alternating — each over a converged, captured frame
            await B.waitSettled(null, { timeout: 600000 }); await B.waitIdleCapture(60000);
            const r0 = R.resolveCount, t0 = performance.now();
            const f = k % 2 ? 0.1 : 0.25;                   // the toolbar clip boxes — the same input path the histogram drag ends in
            setClip(String(+(lo + (hi - lo) * f).toPrecision(4)), String(+(hi - (hi - lo) * f).toPrecision(4)));
            const t1 = await B.waitSettled(t0, { quiet: 3, timeout: 600000 });
            out.push({ ms: t1 - t0, resolved: R.resolveCount > r0 });
          }
          setClip('', '');
          return { out, captured };
        }, colA), 30 * MIN, 'recolour');
        res.metrics.recolour_ramp_ms = pct(rc.out.map((x) => x.ms), 50);
        res.recolourPath = rc.out.every((x) => x.resolved) ? 'deferred re-shade (resolve pass)' : rc.out.some((x) => x.resolved) ? 'mixed' : 're-raster';
        if (!rc.captured) res.notes.push('recolour: the idle id capture never completed');
      } catch (e) { res.errors.push(`recolour: ${e.message}`); }
    }
    if (ONLY.has('colourby') && colB && colB !== colA) {
      try {
        const cb = await withTimeout(page.evaluate(async ({ colA, colB }) => {
          const M = window._micro, B = window.__bench, R = M.renderer, L = B.layer();
          const ms = [];
          for (const c of [colB, colA]) {                   // there and back
            await B.waitSettled(null, { timeout: 600000 });
            const t0 = performance.now(), r0 = R.resolveCount;
            await M.setLayerColorSel(L, M.colorSelFor(L, c));
            const t1 = await B.waitSettled(t0, { quiet: 3, timeout: 1800000 });
            ms.push({ ms: t1 - t0, resolved: R.resolveCount > r0 });
          }
          return ms;
        }, { colA, colB }), 70 * MIN, 'colour-by switch');
        res.metrics.colourby_switch_ms = cb[0].ms;
        res.metrics.colourby_back_ms = cb[1].ms;
      } catch (e) { res.errors.push(`colour-by: ${e.message}`); }
    }

    // ── 4. analyses (runTool: scan + shape, no window) ──
    const tool = async (key, name, params, minutes = 20) => {
      if (!ONLY.has(key) || !colA) return;
      try {
        const r = await withTimeout(page.evaluate(async ({ name, params }) => {
          const M = window._micro, B = window.__bench;
          const t0 = performance.now();
          const out = await M.runTool(name, params);
          const ms = performance.now() - t0;
          return { ms, rows: out && out.table ? out.table.rows.length : null, warnings: out && out.warnings ? out.warnings.length : 0 };
        }, { name, params }), minutes * MIN, name);
        res.metrics[`${key}_ms`] = r.ms;
        if (!r.rows) res.notes.push(`${key}: returned no rows`);
      } catch (e) { res.errors.push(`${key}: ${isPath ? e.message.replace(/“[^”]*”/g, '“…”') : e.message}`); }
    };
    await tool('gt', 'gt', { layer: cols.name, series: [{ col: colA }], nCut: 40 });
    await tool('swath', 'swath', { layer: cols.name, series: [{ col: colA }], mode: 'trend', trend: 90, plunge: 0 });
    await tool('stats', 'stats', { layer: cols.name, cols: [colA] });

    // by-solid: a closed box over the middle half of the model in X and Y, the middle half in Z
    if (ONLY.has('solid')) {
      try {
        const sb = await withTimeout(page.evaluate(async () => {
          const M = window._micro, B = window.__bench, L = B.layer();
          const bb = L.docs.blockDoc.header.bbox, q = (k, f) => bb.min[k] + (bb.max[k] - bb.min[k]) * f;
          const [x0, x1, y0, y1, z0, z1] = [q(0, 0.25), q(0, 0.75), q(1, 0.25), q(1, 0.75), q(2, 0.25), q(2, 0.75)];
          const V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
          const T = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [3, 4, 8], [3, 8, 7], [1, 5, 8], [1, 8, 4], [2, 3, 7], [2, 7, 6]];
          const obj = V.map((v) => `v ${v.join(' ')}`).concat(T.map((f) => `f ${f.join(' ')}`)).join('\n');
          await M.openBlob(new Blob([obj]), 'benchbox.obj', 'add');
          const mesh = M.layers().find((x) => x.name === 'benchbox.obj');
          M.setActiveLayer(L.id);
          await B.waitSettled(null, { timeout: 600000 });
          const out = {};
          let t0 = performance.now();
          const col = await M.ratioBySolid(mesh, L, { name: 'BENCHFRAC', res: 3, mode: 'inside' });
          out.ratioMs = performance.now() - t0; out.ratioOk = !!col;
          if (!col) out.ratioWhy = document.querySelector('#meta').textContent;
          t0 = performance.now();
          await M.selectBySolid(mesh, { mode: 'inside', targets: [L] });
          out.selectMs = performance.now() - t0;
          out.selected = L._selMask ? L._selMask.reduce((s, v) => s + (v ? 1 : 0), 0) : 0;
          return out;
        }), 40 * MIN, 'by-solid');
        if (sb.ratioOk) res.metrics.solid_fraction_ms = sb.ratioMs; else res.notes.push(`by-solid fraction refused: ${sb.ratioWhy}`);
        res.metrics.solid_select_ms = sb.selectMs;
        res.solidSelected = sb.selected;
      } catch (e) { res.errors.push(`by-solid: ${e.message}`); }
    }
    res.metrics.heap_end_mb = (await heap(true)) / 1048576;
  } catch (e) {
    res.errors.push(e.message);
  } finally {
    await browser.close().catch(() => {});
  }
  return res;
}

// ── aggregate, print, save, compare ──
const LABELS = {
  open_resolved_ms: 'open → openBlob resolved', open_drawn_ms: 'open → settled frame',
  orbit_frame_p50_ms: 'orbit frame p50 (rAF)', orbit_frame_p95_ms: 'orbit frame p95 (rAF)', orbit_draw_cpu_p50_ms: 'orbit draw() CPU p50',
  orbit_gpu_synced_p50_ms: 'orbit draw+finish p50', orbit_gpu_synced_p95_ms: 'orbit draw+finish p95',
  orbit_full_frame_p50_ms: 'full-res orbit frame p50 (rAF)', orbit_full_frame_p95_ms: 'full-res orbit frame p95 (rAF)',
  orbit_full_draw_cpu_p50_ms: 'full-res orbit draw() CPU p50', orbit_full_synced_p50_ms: 'full-res draw+finish p50', orbit_full_synced_p95_ms: 'full-res draw+finish p95',
  recolour_ramp_ms: 'ramp-range recolour', colourby_switch_ms: 'colour-by switch', colourby_back_ms: 'colour-by switch back',
  gt_ms: 'grade–tonnage', swath_ms: 'swath (one direction)', stats_ms: 'stats', solid_fraction_ms: 'by-solid fraction (res 3)', solid_select_ms: 'select by solid',
  heap_open_peak_mb: 'JS heap peak during open (MB)', heap_after_open_mb: 'JS heap after open, GC (MB)', heap_end_mb: 'JS heap at end, GC (MB)',
  gpu_mb: 'GPU buffers (MB)', gpu_bytes_per_element: 'GPU bytes / element',
};
function aggregate(runs) {
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r.metrics)))];
  const out = {};
  for (const k of keys) {
    const v = runs.map((r) => r.metrics[k]).filter((x) => Number.isFinite(x));
    if (!v.length) continue;
    const med = pct(v, 50), lo = Math.min(...v), hi = Math.max(...v);
    out[k] = { median: med, min: lo, max: hi, n: v.length, noise: med ? (hi - lo) / Math.abs(med) : 0 };
  }
  return out;
}
const f = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

const modelPath = MODEL === 'regular5m' ? await ensureRegular5m() : isPath ? path.resolve(MODEL) : null;
if (modelPath && !fs.existsSync(modelPath)) { console.error(`no such file: ${modelPath}`); process.exit(2); }
console.log(`micro-bench · model ${modelTag}${modelPath ? ` (${(fs.statSync(modelPath).size / 1048576).toFixed(0)} MB)` : ''} · ${RUNS} run(s) · ${BUILT ? 'built micro.html' : 'dev tree'} · label ${LABEL}`);
const runs = [];
for (let i = 0; i < RUNS; i++) {
  const t = Date.now();
  const r = await oneRun(i, modelPath);
  runs.push(r);
  console.log(`  run ${i + 1}/${RUNS}: ${((Date.now() - t) / 1000).toFixed(0)} s${r.errors.length ? ` · ${r.errors.length} error(s): ${r.errors.join(' | ')}` : ''}`);
}
server.close();
const agg = aggregate(runs);
const first = runs.find((r) => r.layer) || runs[0];
console.log(`\n  gpu: ${first.gpu || '?'}`);
if (first.layer) console.log(`  layer: ${first.layer.kind}${first.layer.grid ? ' (grid)' : ''}${first.layer.subBlocked ? ' · sub-blocked' : ''} · ${first.layer.elements?.toLocaleString()} elements · ${first.layer.chunks} chunks${first.recolourPath ? ` · recolour path: ${first.recolourPath}` : ''}`);
console.log(`\n  ${'measure'.padEnd(34)} ${'median'.padStart(9)} ${'min'.padStart(9)} ${'max'.padStart(9)}  noise`);
for (const [k, a] of Object.entries(agg)) console.log(`  ${(LABELS[k] || k).padEnd(34)} ${f(a.median).padStart(9)} ${f(a.min).padStart(9)} ${f(a.max).padStart(9)}  ${(a.noise * 100).toFixed(1)}%`);
const notes = [...new Set(runs.flatMap((r) => r.notes))], errors = [...new Set(runs.flatMap((r) => r.errors))];
if (first.orbit) console.log(`  orbit: ${first.orbit.frames} frames → ${first.orbit.draws} draws, ~${first.orbit.drawnPerFrame.toLocaleString()} elements drawn per frame (budget ${first.budget})${first.orbit.fullDrawnPerFrame != null ? `; full-res ~${first.orbit.fullDrawnPerFrame.toLocaleString()}` : ''}`);
for (const n of notes) console.log(`  note: ${n}`);
for (const e of errors) console.log(`  ERROR: ${e}`);

let git = null;
try { const { execSync } = await import('child_process'); git = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
const result = { model: modelTag, label: LABEL, date: new Date().toISOString(), git, built: BUILT, runs: RUNS, orbitFrames: ORBIT_N, gpu: first.gpu, budget: first.budget,
  layer: first.layer, orbit: first.orbit, columns: first.columns, recolourPath: first.recolourPath, solidSelected: first.solidSelected, metrics: agg, notes, errors, perRun: runs.map((r) => ({ run: r.run, metrics: r.metrics, errors: r.errors })) };
const outDir = path.join(ROOT, 'bench', 'results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${result.date.slice(0, 10)}-${modelTag}-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(`\n  saved ${path.relative(ROOT, outFile)}`);

if (COMPARE) {
  const base = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
  console.log(`\n  compare against ${path.basename(COMPARE)} (${base.label}, ${base.git || '?'}):`);
  console.log(`  ${'measure'.padEnd(34)} ${'base'.padStart(9)} ${'now'.padStart(9)} ${'Δ%'.padStart(8)}  band   verdict`);
  let flagged = 0;
  for (const [k, a] of Object.entries(agg)) {
    const b = base.metrics[k]; if (!b) continue;
    const d = b.median ? (a.median - b.median) / Math.abs(b.median) : 0;
    const band = Math.max(a.noise, b.noise, 0.03);          // the measured spread of either run, never tighter than the spec's 3 %
    const out = Math.abs(d) > band; if (out) flagged++;
    console.log(`  ${(LABELS[k] || k).padEnd(34)} ${f(b.median).padStart(9)} ${f(a.median).padStart(9)} ${((d >= 0 ? '+' : '') + (d * 100).toFixed(1)).padStart(8)}  ${(band * 100).toFixed(1).padStart(4)}%  ${out ? (d > 0 ? 'SLOWER/LARGER' : 'faster/smaller') : 'within noise'}`);
  }
  console.log(`  ${flagged} measure(s) outside the noise band`);
}
process.exit(errors.length && !Object.keys(agg).length ? 1 : 0);
