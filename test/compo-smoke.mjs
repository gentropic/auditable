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
await page.locator('.compo-bar input[title="page width (mm)"]').press('Tab');   // a real commit (a synthetic change leaves the native one pending for the blur)
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

// ── arranging: box select, groups, equal-gap guides, resize snapping, match size, locks ──
await page.evaluate(() => {
  const d = ed.getDoc();
  C.addFrame(d, { id: 'A', kind: 'text', box: [20, 180, 30, 10], content: { md: 'A' } });
  C.addFrame(d, { id: 'B', kind: 'text', box: [62, 180, 30, 10], content: { md: 'B' } });   // gap A→B = 12
  C.addFrame(d, { id: 'K', kind: 'text', box: [150, 180, 20, 10], content: { md: 'K' } });
  ed.select([]);
});
const pagePt = async (xmm, ymm) => { const r = await page.locator('.compo-pagewrap').boundingBox(); return [r.x + xmm * zoom, r.y + ymm * zoom]; };
// box select: from empty page around A and B (not K)
let [mx, my] = await pagePt(15, 176); await page.mouse.move(mx, my); await page.mouse.down();
[mx, my] = await pagePt(97, 193); await page.mouse.move(mx, my, { steps: 4 });
chk('box select draws a marquee', (await page.locator('.compo-marq').count()) === 1);
await page.mouse.up();
chk('box select picks the frames wholly inside', await page.evaluate(() => JSON.stringify(ed.selected().map((f) => f.id).sort())) === '["A","B"]');
await page.keyboard.press('Control+g');
chk('⌘G groups them', await page.evaluate(() => { const [a, b] = ['A', 'B'].map((id) => C.frameById(ed.getDoc(), id)); return !!a.group && a.group === b.group; }));
await page.keyboard.press('Escape');
// clicking one member selects the group; dragging it moves both
await (await page.locator('.compo-fr[data-id="B"]')).click({ position: { x: 4, y: 4 } });
chk('a click on a member selects its group', await page.evaluate(() => ed.selected().length) === 2 && (await page.locator('.compo-grp').count()) === 1);
let bb2 = await page.locator('.compo-fr[data-id="A"]').boundingBox();
await page.keyboard.down('Alt');                          // ⌥: no snapping, an exact 6 mm
await page.mouse.move(bb2.x + 5, bb2.y + 5); await page.mouse.down();
await page.mouse.move(bb2.x + 5, bb2.y + 5 + 6 * zoom, { steps: 4 }); await page.mouse.up();
await page.keyboard.up('Alt');
chk('the group moves as one (both 6 mm down, same gap)', await page.evaluate(() => { const [a, b] = ['A', 'B'].map((id) => C.frameById(ed.getDoc(), id).box); return Math.abs(a[1] - 186) < 0.01 && Math.abs(b[1] - 186) < 0.01 && Math.abs(b[0] - a[0] - 42) < 0.01; }));
await page.keyboard.press('Control+Shift+g');
chk('⌘⇧G ungroups', await page.evaluate(() => !C.frameById(ed.getDoc(), 'A').group));
// equal-gap guides: drag K toward a 12 mm gap right of B (B ends at 92 → K at 104)
await page.evaluate(() => { C.frameById(ed.getDoc(), 'K').box = [150, 186, 20, 10]; ed.select([]); ed.render(); });
bb2 = await page.locator('.compo-fr[data-id="K"]').boundingBox();
await page.mouse.move(bb2.x + 5, bb2.y + 5); await page.mouse.down();
await page.mouse.move(bb2.x + 5 - 30 * zoom, bb2.y + 5, { steps: 3 });
await page.mouse.move(bb2.x + 5 - 45.6 * zoom, bb2.y + 5, { steps: 3 });   // 150 − 45.6 = 104.4
const gapGuides = await page.evaluate(() => [...document.querySelectorAll('.compo-gap-l')].map((e) => e.textContent));
await page.mouse.up();
chk(`dragging shows equal-gap guides (${JSON.stringify(gapGuides)}) and snaps to the gap`, gapGuides.length === 2 && gapGuides.every((t) => t === '12') && await page.evaluate(() => C.frameById(ed.getDoc(), 'K').box[0]) === 104);
// resize snapping: K's bottom edge drags to near A's bottom (185) → snaps
await page.evaluate(() => { C.frameById(ed.getDoc(), 'K').box = [230, 165, 20, 10]; ed.select(['K']); });
const hb2 = await page.locator('.compo-h[data-handle="0.5,1"]').boundingBox();
await page.mouse.move(hb2.x + 4, hb2.y + 4); await page.mouse.down();
await page.mouse.move(hb2.x + 4, hb2.y + 4 + 24.4 * zoom, { steps: 4 });   // 175 → 199.4 (the bottom margin is at 200)
const rg = await page.locator('.compo-guide').count();
await page.mouse.up();
chk(`resizing snaps the dragged edge (bottom → the margin, 200) with a guide (${rg}): ${await page.evaluate(() => JSON.stringify(C.frameById(ed.getDoc(), 'K').box))}`, await page.evaluate(() => { const b = C.frameById(ed.getDoc(), 'K').box; return Math.abs(b[1] + b[3] - 200) < 1e-6 && b[1] === 165; }) && rg >= 1);
// match size: K first (the key), then A
await page.evaluate(() => ed.select(['K', 'A']));
await page.locator('.compo-bar button[title="same size as the first selected"]').click();
chk('match size makes A the size of K (the first selected)', await page.evaluate(() => { const k = C.frameById(ed.getDoc(), 'K').box, a = C.frameById(ed.getDoc(), 'A').box; return a[2] === k[2] && a[3] === k[3]; }));
// locks: a locked frame won't drag or delete, and wears a badge
await page.evaluate(() => { C.frameById(ed.getDoc(), 'A').locked = true; ed.select([]); ed.render(); });
chk('a locked frame wears a badge', await page.evaluate(() => getComputedStyle(document.querySelector('.compo-fr[data-id="A"]'), '::after').content.includes('locked')));
const a0 = await page.evaluate(() => C.frameById(ed.getDoc(), 'A').box.slice());
bb2 = await page.locator('.compo-fr[data-id="A"]').boundingBox();
await page.mouse.move(bb2.x + 5, bb2.y + 5); await page.mouse.down(); await page.mouse.move(bb2.x + 5 + 30, bb2.y + 5, { steps: 3 }); await page.mouse.up();
chk('a locked frame does not drag', await page.evaluate((a0) => JSON.stringify(C.frameById(ed.getDoc(), 'A').box) === JSON.stringify(a0), a0));
await page.evaluate(() => ed.select(['A', 'B']));
await page.keyboard.press('Delete');
chk('Delete keeps the locked frame and says so', await page.evaluate(() => !!C.frameById(ed.getDoc(), 'A') && !C.frameById(ed.getDoc(), 'B')) && /locked/.test(await page.locator('.compo-bar .status').textContent()));
chk('the inspector has a lock box for the frame', await page.evaluate(() => { const l = [...document.querySelectorAll('.compo-side label')].find((x) => /locked/.test(x.textContent)); return !!(l && l.querySelector('input').checked); }));
// align with a locked reference: K aligns to A's left, A stays
await page.evaluate(() => ed.select(['K', 'A']));
await page.locator('.compo-bar button[title="align left"]').click();
chk('align treats a locked frame as the reference', await page.evaluate((a0) => { const a = C.frameById(ed.getDoc(), 'A').box, k = C.frameById(ed.getDoc(), 'K').box; return a[0] === a0[0] && k[0] === a0[0]; }, a0));
// one-step z-order with ⌘] / ⌘[
await page.evaluate(() => ed.select(['K']));
const z0 = await page.evaluate(() => ed.getDoc().frames.map((f) => f.id).indexOf('K'));
await page.keyboard.press('Control+BracketLeft');
chk('⌘[ sends one step back', await page.evaluate(() => ed.getDoc().frames.map((f) => f.id).indexOf('K')) === z0 - 1);
await page.evaluate(() => { C.removeFrames(ed.getDoc(), ['A', 'K']); ed.select([]); });


// ── the text inspector's field picker: inserts {name} at the caret, one undo step ──
{
  await page.evaluate(() => { C.addFrame(ed.getDoc(), { id: 'FP', kind: 'text', box: [150, 120, 40, 8], content: { md: 'made ' } }); ed.select(['FP']); ed.render(); });
  const opts = await page.evaluate(() => [...document.querySelectorAll('.compo-fields option')].map((o) => o.value).filter(Boolean));
  chk(`the field picker lists compo's fields (${opts.length}: ${opts.join(' ')})`, ['fig', 'page', 'pages', 'date', 'time', 'title', 'scale'].every((n) => opts.includes(n)));
  await page.evaluate(() => { const ta = document.querySelector('.compo-side textarea'); ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; });
  await page.locator('.compo-fields').selectOption('date');
  chk('picking a field inserts it at the caret', await page.evaluate(() => C.frameById(ed.getDoc(), 'FP').content.md) === 'made {date}');
  await page.evaluate(() => { ed.undo(); });
  chk('… as one undo step', await page.evaluate(() => C.frameById(ed.getDoc(), 'FP').content.md) === 'made ');
  await page.evaluate(() => { C.removeFrames(ed.getDoc(), ['FP']); ed.select([]); ed.render(); });
}

// ── a view of 3D space (meta.proj): coordinate ticks from the inspector; + label pins a world point ──
{
  await page.evaluate(() => {
    const m = [1 / 50, 0, 0, 0, 0, 1 / 40, 0, 0, 0, 0, -1 / 1000, 0, 0, 0, 0, 1];
    C.addFrame(ed.getDoc(), { id: 'PV', kind: 'image', box: [150, 100, 100, 80], content: { width: 1000, height: 800, meta: { ortho: true, proj: { m, origin: [512300, 7604000, 600] } } } });
    ed.select(['PV']); ed.render();
  });
  await page.locator('.compo-side select.compo-ticks').selectOption('grid');
  chk('a projected view offers coordinates: grid set from the inspector', await page.evaluate(() => C.frameById(ed.getDoc(), 'PV').content.ticks === 'grid'));
  await page.locator('.compo-bar button', { hasText: '+ label' }).click();
  const lb = await page.evaluate(() => { const f = ed.selected()[0]; return f && { kind: f.kind, at: f.content.at, of: f.content.of, inside: C.worldToPage(C.frameById(ed.getDoc(), 'PV'), f.content.at).inside }; });
  chk(`+ label pins the view's middle and refers to it (${JSON.stringify(lb)})`, lb && lb.kind === 'label' && lb.of === 'PV' && Math.abs(lb.at[0] - 512300) < 1e-6 && Math.abs(lb.at[1] - 7604000) < 1e-6 && lb.inside);
  await page.evaluate(() => { const L = ed.selected()[0]; C.removeFrames(ed.getDoc(), ['PV', L.id]); ed.select([]); ed.render(); });
}

// ── rulers, guides, grid, the item list ──
chk('rulers show by default', await page.evaluate(() => [...document.querySelectorAll('.compo-ruler')].every((c) => c.style.display !== 'none' && c.width > 0)));
{
  const rt = await page.locator('.compo-ruler.top').boundingBox();
  const [, gy] = await pagePt(0, 60);
  await page.mouse.move(rt.x + 100, rt.y + 8); await page.mouse.down();
  await page.mouse.move(rt.x + 100, gy, { steps: 5 }); await page.mouse.up();
  chk('dragging out of the top ruler makes a horizontal guide (60 mm)', await page.evaluate(() => JSON.stringify((ed.getDoc().page.guides || {}).y)) === '[60]' && (await page.locator('.compo-gl.y').count()) === 1);
  // a frame snaps to the guide
  await page.evaluate(() => { C.addFrame(ed.getDoc(), { id: 'G', kind: 'text', box: [101.3, 70, 20, 8], content: { md: 'G' } }); ed.select([]); ed.render(); });
  let gb = await page.locator('.compo-fr[data-id="G"]').boundingBox();
  await page.mouse.move(gb.x + 4, gb.y + 4); await page.mouse.down();
  await page.mouse.move(gb.x + 4, gb.y + 4 - 9.2 * zoom, { steps: 4 }); await page.mouse.up();   // top 70 → 60.8
  chk('a frame snaps to the guide', await page.evaluate(() => C.frameById(ed.getDoc(), 'G').box[1]) === 60);
  // the guide back onto the ruler removes it
  const gl = await page.locator('.compo-gl.y').boundingBox();
  await page.mouse.move(gl.x + 300, gl.y + 3); await page.mouse.down();
  await page.mouse.move(gl.x + 300, rt.y + 4, { steps: 5 }); await page.mouse.up();
  chk('dragging the guide back to the ruler removes it', await page.evaluate(() => !ed.getDoc().page.guides));
  // the grid: shown, and frames snap to it
  await page.locator('.compo-bar select[title^="grid"]').selectOption('5');
  chk('grid 5 mm: on the page, drawn', await page.evaluate(() => { const g = ed.getDoc().page.grid; return g && g.size === 5 && g.snap && /gradient/.test(document.querySelector('.compo-overlay').style.backgroundImage); }));
  gb = await page.locator('.compo-fr[data-id="G"]').boundingBox();
  await page.mouse.move(gb.x + 4, gb.y + 4); await page.mouse.down();
  await page.mouse.move(gb.x + 4 + 3.6 * zoom, gb.y + 4, { steps: 4 }); await page.mouse.up();   // 101.3 → 104.9
  chk(`a frame snaps to the grid (x ${await page.evaluate(() => C.frameById(ed.getDoc(), 'G').box[0])})`, await page.evaluate(() => C.frameById(ed.getDoc(), 'G').box[0]) === 105);
  await page.locator('.compo-bar select[title^="grid"]').selectOption('0');
  chk('grid off', await page.evaluate(() => !ed.getDoc().page.grid));
}
// the item list
{
  const rows = await page.evaluate(() => [...document.querySelectorAll('.compo-it')].map((r) => r.dataset.item));
  const order = await page.evaluate(() => ed.getDoc().frames.map((f) => f.id).reverse());
  chk(`the item list is every frame, front first (${rows.length})`, JSON.stringify(rows) === JSON.stringify(order));
  await page.locator('.compo-it[data-item="G"] .nm').click();
  chk('a row click selects its frame', await page.evaluate(() => JSON.stringify(ed.selected().map((f) => f.id))) === '["G"]');
  await page.locator('.compo-it[data-item="G"] button').first().click();
  chk('the eye hides a frame: not drawn, not picked', await page.evaluate(() => C.frameById(ed.getDoc(), 'G').hidden === true && !document.querySelector('.compo-fr[data-id="G"]')));
  await page.locator('.compo-it[data-item="G"] button').first().click();
  chk('… and shows it again', await page.evaluate(() => !C.frameById(ed.getDoc(), 'G').hidden && !!document.querySelector('.compo-fr[data-id="G"]')));
  await page.locator('.compo-it[data-item="G"] button').nth(1).click();
  chk('the lock button locks it', await page.evaluate(() => C.frameById(ed.getDoc(), 'G').locked === true));
  await page.locator('.compo-it[data-item="G"] button').nth(1).click();
  await page.locator('.compo-it[data-item="G"] .nm').dblclick();
  await page.locator('.compo-it[data-item="G"] .nm input').fill('callout');
  await page.locator('.compo-it[data-item="G"] .nm input').press('Enter');
  chk('double-click renames the id (the list shows it)', await page.evaluate(() => !C.frameById(ed.getDoc(), 'G') && !!C.frameById(ed.getDoc(), 'callout') && document.querySelector('.compo-it[data-item="callout"] .nm .id').textContent === 'callout'));
  // … and the inspector's id field renames it back, rewriting a reference on the way
  await page.evaluate(() => { C.addFrame(ed.getDoc(), { id: 'REF', kind: 'text', box: [150, 140, 40, 8], content: { md: 'at {scale@callout}' } }); ed.select(['callout']); ed.render(); });
  await page.locator('.compo-side input.compo-id').fill('G');
  await page.locator('.compo-side input.compo-id').press('Enter');
  chk('the inspector renames, and references follow ({scale@callout} → {scale@G})', await page.evaluate(() => !!C.frameById(ed.getDoc(), 'G') && C.frameById(ed.getDoc(), 'REF').content.md === 'at {scale@G}' && JSON.stringify(ed.selected().map((f) => f.id)) === '["G"]'));
  await page.locator('.compo-side input.compo-id').fill('REF');
  await page.locator('.compo-side input.compo-id').press('Enter');
  chk('a taken id is refused (said why), the old one kept', await page.evaluate(() => !!C.frameById(ed.getDoc(), 'G') && /already/.test(document.querySelector('.compo-bar .status').textContent)));
  // refers to: a caption shows "nearest → <the view>", can be fixed to a frame, and draws a link line to it
  await page.evaluate(() => { ed.select(['REF']); ed.render(); });
  const rs = await page.evaluate(() => { const s = [...document.querySelectorAll('.compo-side select')].find((x) => /nearest/.test(x.options[0].textContent)); return s && { first: s.options[0].textContent, opts: [...s.options].map((o) => o.value) }; });
  chk(`refers to: nearest names the view it picked (${rs && rs.first})`, rs && /^nearest → /.test(rs.first) && rs.opts.length >= 2);
  chk('the selected caption draws a link to that view, outlined', await page.evaluate(() => !!document.querySelector('.compo-link') && document.querySelectorAll('.compo-fr.ref').length === 1));
  await page.evaluate(() => { C.removeFrames(ed.getDoc(), ['REF']); ed.select([]); ed.render(); });
  // drag G (front) below the last row → to the back
  const last = await page.evaluate(() => ed.getDoc().frames[0].id);
  const src = page.locator('.compo-it[data-item="G"]'), dst = page.locator(`.compo-it[data-item="${last}"]`);
  const db = await dst.boundingBox();
  await src.dragTo(dst, { targetPosition: { x: 10, y: db.height - 2 } });
  chk('dragging a row restacks (G to the back)', await page.evaluate(() => ed.getDoc().frames[0].id) === 'G');
  // a group shows as a folder; its header selects the group
  await page.evaluate(() => { const d = ed.getDoc(); C.addFrame(d, { id: 'H1', kind: 'text', box: [150, 80, 10, 6], content: { md: 'h1' } }); C.addFrame(d, { id: 'H2', kind: 'text', box: [165, 80, 10, 6], content: { md: 'h2' } }); C.groupFrames(d, ['H1', 'H2']); ed.select([]); ed.render(); });
  const g = await page.evaluate(() => C.frameById(ed.getDoc(), 'H1').group);
  chk('a group is a folder row over its members', await page.evaluate((g) => { const r = [...document.querySelectorAll('.compo-it')]; const i = r.findIndex((x) => x.dataset.item === 'g:' + g); return i >= 0 && r[i + 1].classList.contains('mem') && r[i + 2].classList.contains('mem'); }, g));
  await page.locator(`.compo-it[data-item="g:${g}"] .nm`).click();
  chk('the folder row selects the whole group', await page.evaluate(() => JSON.stringify(ed.selected().map((f) => f.id).sort())) === '["H1","H2"]');
  await page.evaluate(() => { C.removeFrames(ed.getDoc(), ['G', 'H1', 'H2']); ed.select([]); });
}

// ── export: PDF (read back by pdf.js) and PNG ──
const out = await page.evaluate(async () => {
  const src = await (await fetch('/ext/pdfjs/index.js')).text();
  (0, eval)(src);
  const lib = globalThis['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([globalThis.__pdfjsWorkerSrc], { type: 'text/javascript' }));
  const d = ed.getDoc();
  const bytes = await C.exportPDF(d, { title: 'compo smoke' });
  const size = bytes.length, jpeg = new TextDecoder('latin1').decode(bytes).includes('/DCTDecode');
  const back = await C.figureFromPdf(bytes);              // first: pdf.js takes (detaches) the buffer it is given
  const pdf = await lib.getDocument({ data: bytes.slice() }).promise;
  const p = await pdf.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const text = (await p.getTextContent()).items.map((i) => i.str).join('').replace(/\s+/g, ' ');
  // render it and probe the image frame's colours
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
  await p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  const k = 72 / 25.4, f = d.frames[0], g = cv.getContext('2d');
  const at = (u, v) => Array.from(g.getImageData(Math.round((f.box[0] + u * f.box[2]) * k), Math.round((f.box[1] + v * f.box[3]) * k), 1, 1).data);
  const att = await pdf.getAttachments();                  // pdf.js sees the embedded figure
  const attName = att ? Object.values(att).map((a) => a.filename).join() : '';
  const png = await C.exportPNG(d, { dpi: 96 });
  const bm = await createImageBitmap(png);
  return { size, jpeg, pages: pdf.numPages, w: vp.width, h: vp.height, text, centre: at(0.5, 0.5), edge: at(0.5, 0.1), pngW: bm.width, pngH: bm.height, pngType: png.type, attName, backFrames: back.doc && back.doc.frames.length, nFrames: d.frames.length };
});
chk(`PDF: carries its figure — pdf.js lists ${out.attName}, figureFromPdf reads ${out.backFrames} frames`, /.compo.json$/.test(out.attName) && out.backFrames === out.nFrames);
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
