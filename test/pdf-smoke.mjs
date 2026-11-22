// @gcu/pdf read back by a real PDF reader: the vendored pdf.js (ext/pdfjs) parses what the writer
// produced, reports its pages, sizes and text, and RENDERS it — the render is compared to the same
// drawing on a canvas. Run: node test/pdf-smoke.mjs (Playwright, headless Chromium; not npm test).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
let fails = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
await page.goto(`http://127.0.0.1:${PORT}/__blank`);
const r = await page.evaluate(async () => {
  // pdf.js, as the reader surfaces load it: a classic script + a blob worker
  const src = await (await fetch('/ext/pdfjs/index.js')).text();
  (0, eval)(src);
  const lib = globalThis['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([globalThis.__pdfjsWorkerSrc], { type: 'text/javascript' }));
  const P = await import('/ext/pdf/index.js');
  const W = 300, H = 200;
  // ONE drawing, two targets
  const scene = (ctx) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1f77b4'; ctx.fillRect(20, 20, 120, 60);
    ctx.strokeStyle = '#d62728'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(20, 150); ctx.lineTo(280, 110); ctx.stroke();
    ctx.fillStyle = 'rgba(44, 160, 44, 0.5)'; ctx.beginPath(); ctx.arc(220, 60, 40, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(160, 170); ctx.rotate(-0.2); ctx.fillStyle = '#000'; ctx.font = '16px monospace'; ctx.fillText('FE >= 55', 0, 0); ctx.restore();
    const im = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]) };
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, 160, 20, 40, 40);
  };
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = cv.getContext('2d');
  // the canvas has no ImageData drawImage: put it through a scratch canvas for the reference
  const realDraw = g.drawImage.bind(g);
  g.drawImage = (im, ...a) => { if (im.data) { const s = Object.assign(document.createElement('canvas'), { width: im.width, height: im.height }); s.getContext('2d').putImageData(new ImageData(im.data, im.width, im.height), 0, 0); return realDraw(s, ...a); } return realDraw(im, ...a); };
  scene(g);
  const doc = new P.PdfDocument({ title: 'pdf smoke — a figure', created: new Date(Date.UTC(2026, 10, 22)) });
  scene(doc.addPage({ width: W, height: H }).getContext('2d'));
  const p2 = doc.addPage('A4', 'landscape').getContext('2d', { units: 'mm' });
  p2.font = '12px sans-serif'; p2.fillText('page two', 20, 20);
  const bytes = await doc.save();
  // read it back
  const size = bytes.length;                               // (pdf.js takes ownership of the buffer)
  const pdf = await lib.getDocument({ data: bytes }).promise;
  const out = { pages: pdf.numPages, bytes: size, warnings: doc.warnings };
  const meta = await pdf.getMetadata();
  out.title = meta.info.Title;
  const p1 = await pdf.getPage(1);
  const vp = p1.getViewport({ scale: 1 });
  out.size = [vp.width, vp.height];
  out.text1 = (await p1.getTextContent()).items.map((i) => i.str).join('');   // pdf.js splits rotated runs into items
  const pg2 = await pdf.getPage(2);
  out.size2 = pg2.getViewport({ scale: 1 }).viewBox.slice(2).map(Math.round);
  out.text2 = (await pg2.getTextContent()).items.map((i) => i.str).join('');
  // render page 1 and compare with the canvas
  const rc = Object.assign(document.createElement('canvas'), { width: W, height: H });
  await p1.render({ canvasContext: rc.getContext('2d'), viewport: vp }).promise;
  const a = g.getImageData(0, 0, W, H).data, b = rc.getContext('2d').getImageData(0, 0, W, H).data;
  let close = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 60) close++;
  out.agree = close / (W * H);
  const px = (x, y) => [...b.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
  out.probes = { rect: px(60, 50), line: px(150, 131), circleBlend: px(240, 60), imgTL: px(170, 30), imgBR: px(190, 50) };
  return out;
});
chk(`pdf.js opens it: ${r.pages} pages, ${r.bytes} bytes, title “${r.title}”, no writer warnings (${JSON.stringify(r.warnings)})`, r.pages === 2 && r.title === 'pdf smoke — a figure' && r.warnings.length === 0);
chk(`page sizes: ${JSON.stringify(r.size)} pt and A4 landscape ${JSON.stringify(r.size2)}`, r.size[0] === 300 && r.size[1] === 200 && r.size2[0] === 842 && r.size2[1] === 595);
chk(`text survives as text: “${r.text1}” · “${r.text2}”`, r.text1.includes('FE >= 55') && r.text2.includes('page two'));
chk(`the render matches the canvas drawing (${(r.agree * 100).toFixed(1)}% of pixels agree)`, r.agree > 0.97);
chk(`probes: rect ${r.probes.rect} · line ${r.probes.line} · 50% green over white ${r.probes.circleBlend} · image corners ${r.probes.imgTL} / ${r.probes.imgBR}`,
  r.probes.rect[2] > 150 && r.probes.rect[0] < 60 && r.probes.line[0] > 180 && r.probes.circleBlend[1] > 180 && r.probes.circleBlend[0] > 120 && r.probes.circleBlend[0] < 180
  && r.probes.imgTL[0] > 200 && r.probes.imgTL[1] < 60 && r.probes.imgBR[0] > 200 && r.probes.imgBR[1] > 200 && r.probes.imgBR[2] < 60);
// ── @gcu/plot: savefig('x.pdf') / fig.toPDF() — the figure's draw list replayed onto a PDF page ──
const q = await page.evaluate(async () => {
  const lib = globalThis['pdfjs-dist/build/pdf'];
  const P = await import('/ext/plot/index.js');
  P.style.use('default');
  const [fig, ax] = P.subplots(1, 1, { figsize: [480, 320] });
  const x = Array.from({ length: 40 }, (_, i) => i / 4);
  ax.plot(x, x.map(Math.sin), { label: 'sin' });
  ax.fill_between(x, x.map((v) => Math.sin(v) - 0.3), x.map((v) => Math.sin(v) + 0.3), { alpha: 0.3 });
  ax.imshow([[1, 2, 3], [4, 5, 6]], { extent: [6, 9, -1, -0.4] });
  ax.set_title('Grade along the drive'); ax.set_xlabel('distance (m)'); ax.legend();
  const cv = fig.show();
  const W = cv.width, H = cv.height;
  const ref = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const bytes = await fig.toPDF({ created: new Date(Date.UTC(2026, 10, 22)) });
  const size = bytes.length;
  const pdf = await lib.getDocument({ data: bytes }).promise;
  const p1 = await pdf.getPage(1);
  const vp1 = p1.getViewport({ scale: 1 });
  const vp = p1.getViewport({ scale: W / vp1.width });   // back to the figure's pixels
  const rc = Object.assign(document.createElement('canvas'), { width: W, height: H });
  await p1.render({ canvasContext: rc.getContext('2d'), viewport: vp }).promise;
  const got = rc.getContext('2d').getImageData(0, 0, W, H).data;
  let close = 0;
  for (let i = 0; i < ref.length; i += 4) if (Math.abs(ref[i] - got[i]) + Math.abs(ref[i + 1] - got[i + 1]) + Math.abs(ref[i + 2] - got[i + 2]) < 80) close++;
  return { size, inches: [vp1.width / 72, vp1.height / 72], agree: close / (W * H), text: (await p1.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ') };   // pdf.js pads monospace word gaps
});
chk(`plot toPDF: ${q.size} bytes, ${q.inches.map((v) => v.toFixed(2)).join(' × ')} in (480 × 320 px at dpi 100)`, Math.abs(q.inches[0] - 4.8) < 0.01 && Math.abs(q.inches[1] - 3.2) < 0.01);
chk(`plot toPDF: title, axis label and legend are text (“${q.text.slice(0, 80)}”)`, /Grade along the drive/.test(q.text) && /distance \(m\)/.test(q.text) && /sin/.test(q.text));
chk(`plot toPDF: the render matches the canvas figure (${(q.agree * 100).toFixed(1)}% of pixels; text faces differ)`, q.agree > 0.95);

await browser.close(); server.close();
console.log(fails ? `\nPDF SMOKE: ${fails} FAILED` : '\nPDF SMOKE: PASS');
process.exit(fails ? 1 : 0);
