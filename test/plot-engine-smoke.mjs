// @gcu/plot 0.2's fast paths, in pixels, in a real browser: each one against the plain path
// it replaces. A fast path that drew something else would pass every unit test — this is the
// check that it doesn't. Run: node test/plot-engine-smoke.mjs
//
//   raster scatter (stamps)  vs  one canvas path per marker   — positions, colours, alpha, edges
//   M4 line decimation       vs  every vertex                 — identical pixels
//   imshow, blitted live     vs  its replayed draw list
//   a 2× device pixel ratio rasterizes at 2×
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><body></body>'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/__blank`);

const r = await page.evaluate(async () => {
  const P = await import('/ext/plot/src/api.js');
  P.style.use('default');
  const { _engine } = await import('/ext/plot/src/axes.js');
  const { replay } = await import('/ext/plot/src/record.js');
  const W = 500, H = 400;
  const draw = (build, { raster = true, m4 = true, dpr = 1 } = {}) => {
    const saved = { ..._engine };
    // the reference for the raster is one canvas fill per marker, in data order — what
    // matplotlib's Agg does (the batched vector path fills a colour's markers as one union)
    _engine.rasterMin = raster ? 4000 : Infinity;
    _engine.batch = raster;
    _engine.m4 = m4;
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    build(ax);
    const cv = Object.assign(document.createElement('canvas'), { width: W * dpr, height: H * dpr });
    const ctx = cv.getContext('2d');
    fig.draw(ctx, { dpr });
    Object.assign(_engine, saved);
    return { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height, ax, cv };
  };
  // where the ink is: total alpha and its centroid — a misplaced raster shows up here even
  // when every block looks alike
  const ink = (a) => {
    let s = 0, sx = 0, sy = 0;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const o = (y * a.w + x) * 4;
      const v = 255 * 3 - (a.data[o] + a.data[o + 1] + a.data[o + 2]);   // darkness on the light axes
      s += v; sx += v * x; sy += v * y;
    }
    return { s, cx: sx / s, cy: sy / s };
  };
  const shots = {};
  // compare two renders block by block (8 × 8 means): stamps snap to whole pixels and
  // antialias by their own rule, so single pixels differ; areas must not
  const blocks = (a, b, w, h, B = 8) => {
    let worst = 0, sum = 0, nb = 0;
    for (let by = 0; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) {
      const m = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) { m[c] += a.data[o + c]; m[4 + c] += b.data[o + c]; }
      }
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(m[c] - m[4 + c]) / (B * B));
      worst = Math.max(worst, d); sum += d; nb++;
    }
    return { worst: +worst.toFixed(1), mean: +(sum / nb).toFixed(2) };
  };
  const pixdiff = (a, b, tol) => {
    let bad = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
      if (d > tol) bad++;
    }
    return bad / (a.data.length / 4);
  };
  const out = {};
  // a scatter well above the raster threshold, with structure (rings), clusters and gaps
  const n = 12000, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = i * 0.0137, rr = 1 + (i % 7); x[i] = rr * Math.cos(t); y[i] = rr * Math.sin(t) * 0.7; c[i] = rr + Math.sin(i); }
  for (const [name, opts] of [
    ['uniform', { s: 4 }],
    ['colour-mapped', { c, s: 4, cmap: 'viridis' }],
    ['alpha 0.3', { s: 9, alpha: 0.3 }],
    ['squares + edges', { s: 16, marker: 's', edgecolor: 'k', linewidth: 0.5 }],
  ]) {
    const a = draw((ax) => ax.scatter(x, y, opts), { raster: true });
    const b = draw((ax) => ax.scatter(x, y, opts), { raster: false });
    const ia = ink(a), ib = ink(b);
    out['scatter ' + name] = { ...blocks(a, b, a.w, a.h), inkRatio: +(ia.s / ib.s).toFixed(4), shift: +Math.hypot(ia.cx - ib.cx, ia.cy - ib.cy).toFixed(3) };
  }
  // M4: a 200k-vertex rising line, decimated vs every vertex
  const m = 200000, lx = new Float64Array(m), ly = new Float64Array(m);
  for (let i = 0; i < m; i++) { lx[i] = i; ly[i] = Math.sin(i / 900) + Math.sin(i / 37) * 0.3 + ((i * 7919) % 101) / 400; }
  ly[90000] = NaN;                                                     // a break must survive
  const la = draw((ax) => ax.plot(lx, ly), { m4: true });
  const lb = draw((ax) => ax.plot(lx, ly), { m4: false });
  out.m4 = { differ: pixdiff(la, lb, 60), differAny: pixdiff(la, lb, 8), ...blocks(la, lb, la.w, la.h) };
  shots.m4a = la.cv.toDataURL(); shots.m4b = lb.cv.toDataURL();
  out.shots = shots;
  // imshow live blit vs its draw list replayed
  const nx = 300, ny = 200, z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = (i % 50 < 2 || j % 40 < 2) ? NaN : Math.sin(i / 20) * Math.cos(j / 15);
  const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
  ax.imshow(z, nx, ny, { cmap: 'magma' });
  const c1 = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const c2 = Object.assign(document.createElement('canvas'), { width: W, height: H });
  fig.draw(c1.getContext('2d'));
  replay(c2.getContext('2d'), fig.toDrawList());
  out.imshow = pixdiff({ data: c1.getContext('2d').getImageData(0, 0, W, H).data }, { data: c2.getContext('2d').getImageData(0, 0, W, H).data }, 8);
  // dpr 2: the raster is made at 2× (crisp), the same picture as dpr 1 at half the size
  const d2 = draw((ax) => ax.scatter(x, y, { s: 4 }), { dpr: 2 });
  let ink2 = 0;
  for (let i = 3; i < d2.data.length; i += 4) if (d2.data[i] > 0 && d2.data[i - 3] < 250) ink2++;
  out.dpr2 = { w: d2.w, inked: ink2 };
  return out;
});

if (process.env.PLOT_SHOTS) for (const [k, v] of Object.entries(r.shots)) fs.writeFileSync(path.join(root, 'experiments', 'plot-' + k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
for (const k of Object.keys(r).filter((k) => k.startsWith('scatter '))) {
  chk(`raster ${k} matches the vector path, block by block`, r[k].worst < 25 && r[k].mean < 1.5 && Math.abs(r[k].inkRatio - 1) < 0.06 && r[k].shift < 0.35, `worst block Δ ${r[k].worst}, mean ${r[k].mean}, ink ×${r[k].inkRatio}, centroid shift ${r[k].shift} px`);
}
chk('M4 decimation draws the line every vertex draws', r.m4.differ < 0.001 && r.m4.mean < 1.5, `${(r.m4.differ * 100).toFixed(3)}% pixels off by > 60, ${(r.m4.differAny * 100).toFixed(3)}% by > 8; blocks worst ${r.m4.worst} mean ${r.m4.mean}`);
chk('imshow blitted live = its replayed draw list', r.imshow < 0.002, `${(r.imshow * 100).toFixed(3)}% pixels differ`);
chk('a 2× pixel ratio rasterizes at 2×', r.dpr2.w === 1000 && r.dpr2.inked > 20000, JSON.stringify(r.dpr2));
chk('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
