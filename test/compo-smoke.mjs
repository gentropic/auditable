// @gcu/compo's editor in a real browser: mount it, add frames, drag (with snapping), resize, nudge,
// undo / redo, align, page setup, then export the page — the PDF read back by the vendored pdf.js,
// the PNG decoded. Run: node test/compo-smoke.mjs (Playwright, headless Chromium; not npm test).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222"><div id="ed" style="width:1100px;height:760px"></div>'); return; }
  const file = path.join(root, url);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
let fails = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

const bundled = process.argv.includes('--bundled');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fails++; });
await page.goto(`http://127.0.0.1:${PORT}/__page`);
await page.evaluate(async (bundled) => {
  const C = await import(bundled ? '/ext/compo/index.js' : '/ext/compo/src/main.js');
  window.C = C;
  const doc = C.createDocument({ title: 'Smoke', page: { size: 'A4', orientation: 'landscape', margins: [10, 10, 10, 10] } });
  // a "render": a canvas bitmap, the kind a host hands in
  const cv = Object.assign(document.createElement('canvas'), { width: 400, height: 300 });
  const g = cv.getContext('2d'); g.fillStyle = '#3070c0'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#e0a020'; g.fillRect(100, 80, 200, 140);
  const img = C.addFrame(doc, { kind: 'image', box: [20, 20, 160, 120], content: { photo: true, meta: { worldPerMm: 5, north: 0 } } });
  img._img = await createImageBitmap(cv);
  C.addFrame(doc, { kind: 'text', box: [20, 150, 160, 12], content: { md: '**Figure {fig}.** A test, page {page}.', size: 10 } });
  C.addFrame(doc, { kind: 'scalebar', box: [200, 20, 60, 8], content: { of: img.id } });
  C.addFrame(doc, { kind: 'legend', box: [200, 40, 50, 30], content: { title: 'Au', entries: [{ color: '#c03030', label: 'high' }, { color: '#30a030', label: 'low' }] } });
  window.changes = 0;
  window.ed = C.mountEditor(document.getElementById('ed'), doc, { onChange: () => window.changes++, toolbar: [{ label: 'host!', title: 'a host button', run: (e) => { window.hostRan = e.getDoc().frames.length; } }] });
}, bundled);
await page.waitForTimeout(300);

// ── the editor renders and the overlay mirrors the frames ──
const n0 = await page.evaluate(() => document.querySelectorAll('.compo-fr').length);
chk('editor mounts: one overlay box per frame', n0 === 4, `${n0}`);
const zoom = await page.evaluate(() => { const w = document.querySelector('.compo-pagewrap'); return parseFloat(w.style.width) / 297; });
chk('zoom-to-fit after mount', zoom > 2 && zoom < 4, zoom.toFixed(2));

const boxOf = (i) => page.evaluate((i) => ed.getDoc().frames[i].box.slice(), i);
const elOf = async (i) => { const id = await page.evaluate((i) => ed.getDoc().frames[i].id, i); return page.locator(`.compo-fr[data-id="${id}"]`); };

// ── click selects, drag moves (snap to the left margin), undo restores ──
const imgEl = await elOf(0);
const bb = await imgEl.boundingBox();
await page.mouse.move(bb.x + 40, bb.y + 40); await page.mouse.down();
// drag left by ~9.2 mm → x = 10.8, within 1.5 mm of the 10 mm margin → snaps to 10
await page.mouse.move(bb.x + 40 - 4 * zoom, bb.y + 40, { steps: 3 });
await page.mouse.move(bb.x + 40 - 9.2 * zoom, bb.y + 40, { steps: 3 });
const guide = await page.evaluate(() => document.querySelectorAll('.compo-guide').length);
await page.mouse.up();
let b = await boxOf(0);
chk('drag moves; the margin snaps (x = 10)', Math.abs(b[0] - 10) < 1e-6, b.map((v) => v.toFixed(2)).join(','));
chk('a snapping guide shows while dragging', guide >= 1, `${guide}`);
chk('the moved frame is selected (8 handles)', (await page.locator('.compo-h').count()) === 8);
await page.keyboard.press('Control+z');
b = await boxOf(0);
chk('⌘Z undoes the move', Math.abs(b[0] - 20) < 1e-6, b[0].toFixed(2));
await page.keyboard.press('Control+Shift+z');
b = await boxOf(0);
chk('⌘⇧Z redoes it', Math.abs(b[0] - 10) < 1e-6);
chk('the decoded image survives undo / redo', await page.evaluate(() => !!ed.getDoc().frames[0]._img));

// ── resize from the bottom-right handle ──
const hnd = page.locator('.compo-h[data-handle="1,1"]');
const hb = await hnd.boundingBox();
await page.mouse.move(hb.x + 4, hb.y + 4); await page.mouse.down();
await page.mouse.move(hb.x + 4 + 20 * zoom, hb.y + 4 + 10 * zoom, { steps: 4 }); await page.mouse.up();
b = await boxOf(0);
chk('the corner handle resizes (w 160 → 180, h 120 → 130)', Math.abs(b[2] - 180) < 0.6 && Math.abs(b[3] - 130) < 0.6, `${b[2].toFixed(1)}×${b[3].toFixed(1)}`);

// ── arrows nudge ──
await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
b = await boxOf(0);
chk('arrows nudge (→ 0.5 mm, ⇧↓ 5 mm)', Math.abs(b[0] - 10.5) < 1e-6 && Math.abs(b[1] - 25) < 1e-6, `${b[0]},${b[1]}`);

// ── the inspector edits the box ──
await page.locator('.compo-side input[type=number]').first().fill('30');
await page.locator('.compo-side input[type=number]').first().dispatchEvent('change');
b = await boxOf(0);
chk('the inspector sets x', b[0] === 30, `${b[0]}`);

// ── shift-select two, align left ──
await (await elOf(2)).click({ position: { x: 5, y: 5 } });
await (await elOf(3)).click({ position: { x: 5, y: 5 }, modifiers: ['Shift'] });
await page.locator('.compo-bar button[title="align left"]').click();
const [s2, s3] = [await boxOf(2), await boxOf(3)];
chk('shift-select + align left', s2[0] === s3[0] && s2[0] === 200, `${s2[0]},${s3[0]}`);

// ── text editing in the inspector updates the page ──
await (await elOf(1)).dblclick({ position: { x: 10, y: 5 } });
const ta = page.locator('.compo-side textarea');
chk('double-click a text frame focuses its text', await ta.evaluate((t) => document.activeElement === t));
await ta.fill('**Figure {fig}.** Edited caption.');
await page.locator('.compo-scroll').click({ position: { x: 5, y: 5 } });
chk('text edits land in the document', await page.evaluate(() => ed.getDoc().frames[1].content.md.includes('Edited caption')));

// ── page setup ──
await page.locator('.compo-bar select[title="paper size"]').selectOption('A3');
await page.locator('.compo-bar select[title="orientation"]').selectOption('portrait');
chk('page setup: A3 portrait', await page.evaluate(() => JSON.stringify(C.pageDims(ed.getDoc().page))) === '[297,420]');
await page.locator('.compo-bar select[title="paper size"]').selectOption('custom');
await page.locator('.compo-bar input[title="page width (mm)"]').fill('500');
await page.locator('.compo-bar input[title="page width (mm)"]').dispatchEvent('change');
chk('custom page width', await page.evaluate(() => C.pageDims(ed.getDoc().page)[0]) === 500);
await page.locator('.compo-bar select[title="paper size"]').selectOption('A4');
await page.locator('.compo-bar select[title="orientation"]').selectOption('landscape');

// ── host toolbar, context menu, delete + undo ──
await page.locator('.compo-bar button', { hasText: 'host!' }).click();
chk('a host toolbar button runs with the editor', await page.evaluate(() => window.hostRan) === 4);
await (await elOf(3)).click({ button: 'right', position: { x: 5, y: 5 } });
chk('the context menu opens', await page.locator('.compo-menu').isVisible());
await page.locator('.compo-menu div', { hasText: 'Duplicate' }).click();
chk('Duplicate adds a frame, offset 5 mm', await page.evaluate(() => { const f = ed.getDoc().frames; return f.length === 5 && f[4].box[0] === f[3].box[0] + 5; }));
await page.keyboard.press('Delete');
chk('Delete removes the selection', await page.evaluate(() => ed.getDoc().frames.length) === 4);
chk('onChange fired for edits', await page.evaluate(() => window.changes) > 8);

// ── export: PDF (read back by pdf.js) and PNG ──
const out = await page.evaluate(async () => {
  const src = await (await fetch('/ext/pdfjs/index.js')).text();
  (0, eval)(src);
  const lib = globalThis['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([globalThis.__pdfjsWorkerSrc], { type: 'text/javascript' }));
  const d = ed.getDoc();
  const bytes = await C.exportPDF(d, { title: 'compo smoke' });
  const size = bytes.length, jpeg = new TextDecoder('latin1').decode(bytes).includes('/DCTDecode');
  const pdf = await lib.getDocument({ data: bytes }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const text = (await p.getTextContent()).items.map((i) => i.str).join('').replace(/\s+/g, ' ');
  // render it and probe the image frame's colours
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
  await p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  const k = 72 / 25.4, f = d.frames[0], g = cv.getContext('2d');
  const at = (u, v) => Array.from(g.getImageData(Math.round((f.box[0] + u * f.box[2]) * k), Math.round((f.box[1] + v * f.box[3]) * k), 1, 1).data);
  const png = await C.exportPNG(d, { dpi: 96 });
  const bm = await createImageBitmap(png);
  return { size, jpeg, pages: pdf.numPages, w: vp.width, h: vp.height, text, centre: at(0.5, 0.5), edge: at(0.5, 0.1), pngW: bm.width, pngH: bm.height, pngType: png.type };
});
chk('PDF: one A4-landscape page', out.pages === 1 && Math.abs(out.w - 841.89) < 0.1 && Math.abs(out.h - 595.28) < 0.1, `${out.w}×${out.h}`);
chk('PDF: the photo frame went in as JPEG', out.jpeg, `${(out.size / 1024).toFixed(1)} KB`);
chk('PDF: the caption is text, fields resolved', /Figure 1\. Edited caption\./.test(out.text), out.text.slice(0, 80));
chk('PDF: the legend and scale bar are text', /Au/.test(out.text) && /high/.test(out.text) && /m/.test(out.text));
const near = (a, b, t = 40) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < t);
chk('PDF render: the image lands in its frame (centre orange, edge blue)', near(out.centre, [0xe0, 0xa0, 0x20]) && near(out.edge, [0x30, 0x70, 0xc0]), `${out.centre} / ${out.edge}`);
chk('PNG at 96 dpi: 1123 × 794', out.pngW === 1123 && out.pngH === 794 && out.pngType === 'image/png', `${out.pngW}×${out.pngH}`);

await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nPASS');
process.exit(fails ? 1 : 0);
