// plot's figures as data, in a real browser (spec_inbox/lang/plot-headless-spec.md §3):
// replay(ctx, fig.toDrawList()) paints the same pixels as fig.draw(ctx); a figure built in a
// module Worker (no DOM) crosses postMessage as a draw list and replays on the page;
// toPNG gives PNG bytes through OffscreenCanvas. Run: node test/plot-replay-smoke.mjs
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
  const P = await import('/ext/plot/index.js');
  // fraction of pixels whose RGBA differs by more than `tol` in any channel
  // (and, as .big, the fraction off by more than 60 levels: an orientation or offset error)
  const diff = (fig, tol) => {
    const mk = () => Object.assign(document.createElement('canvas'), { width: fig.width, height: fig.height });
    const a = mk(), b = mk();
    fig.draw(a.getContext('2d'));
    P.replay(b.getContext('2d'), fig.toDrawList());
    const da = a.getContext('2d').getImageData(0, 0, fig.width, fig.height).data;
    const db = b.getContext('2d').getImageData(0, 0, fig.width, fig.height).data;
    let bad = 0, big = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]),
        Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
      if (d > tol) bad++;
      if (d > 60) big++;
    }
    const n = da.length / 4;
    return { frac: bad / n, big: big / n };
  };
  const out = {};

  const f1 = P.subplots(1, 2, { figsize: [6, 3] }).fig;
  f1.axes[0].plot([1, 2, 3, 4], [2, 1, 3, 2]);
  f1.axes[0].set_title('lines');
  f1.axes[1].bar([1, 2, 3], [3, 1, 2]);
  f1.axes[1].scatter([1, 2, 3], [1, 3, 2]);
  out.vector = diff(f1, 2);

  const f2 = P.subplots().fig;
  // a ramp: a flipped row order or a shifted image would differ by far more than 60 levels
  const data = []; for (let i = 0; i < 400; i++) data.push(i);
  f2.axes[0].imshow(data, 20, 20);
  out.raster = diff(f2, 8);

  // a worker has no DOM: it builds the figure and sends the draw list back
  const src = `
    const P = await import(${JSON.stringify(location.origin + '/ext/plot/index.js')});
    const fig = P.subplots().fig;
    fig.axes[0].plot([1, 2, 3], [3, 1, 2]);
    fig.axes[0].set_title('from a worker');
    P.pltAdder.show();
    postMessage({ hasDoc: typeof document !== 'undefined', shown: P.pltAdder.shown().length, list: fig.toDrawList() });
  `;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
  const msg = await new Promise((res, rej) => { w.onmessage = (e) => res(e.data); w.onerror = (e) => rej(new Error(e.message)); });
  w.terminate();
  out.worker = { hasDoc: msg.hasDoc, shown: msg.shown, ops: msg.list.ops.length };
  const c = Object.assign(document.createElement('canvas'), { width: msg.list.width, height: msg.list.height });
  P.replay(c.getContext('2d'), msg.list);
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let inked = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) inked++;
  out.workerInk = inked;

  const png = await f1.toPNG();
  out.png = Array.from(png.slice(0, 8));
  return out;
});

chk('vector figure: replay matches draw', r.vector.frac < 0.002, `${(r.vector.frac * 100).toFixed(3)}% pixels differ`);
// draw fills each cell with a 0.5 px overlap, replay scales one image nearest-neighbour: the
// two disagree only on cell edges, by one cell's colour step
chk('imshow figure: replay matches draw up to cell-edge rounding', r.raster.big === 0 && r.raster.frac < 0.05,
  `${(r.raster.frac * 100).toFixed(2)}% edge pixels, ${(r.raster.big * 100).toFixed(3)}% large`);
chk('a module worker has no DOM, records its shown figure', r.worker.hasDoc === false && r.worker.shown === 1, JSON.stringify(r.worker));
chk('the worker draw list replays on the page', r.workerInk > 500, `${r.workerInk} inked pixels`);
chk('toPNG gives PNG bytes', JSON.stringify(r.png) === JSON.stringify([137, 80, 78, 71, 13, 10, 26, 10]));
chk('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
