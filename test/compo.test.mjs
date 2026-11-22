// @gcu/compo: the document model, fields, snapping, and the one drawing path onto a PDF page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, parseDocument, serializeDocument, addFrame, alignFrames, distributeFrames, snapBox, bringToFront, sendToBack, pageDims, resolveFields, niceBelow, renderPage, exportPDF, kindOf, registerKind } from '../ext/compo/src/main.js';
import { PdfDocument } from '../ext/pdf/src/main.js';

test('page sizes: named, oriented, custom', () => {
  assert.deepEqual(pageDims({ size: 'A4', orientation: 'portrait' }), [210, 297]);
  assert.deepEqual(pageDims({ size: 'A3', orientation: 'landscape' }), [420, 297]);
  assert.deepEqual(pageDims({ size: 'custom', width: 500, height: 120 }), [500, 120]);
  assert.deepEqual(pageDims(createDocument().page), [297, 210]);    // the default: A4 landscape
});

test('documents round-trip as JSON; runtime fields (_img) are dropped; bad input refused', () => {
  const d = createDocument({ title: 'T' });
  const f = addFrame(d, { kind: 'text', content: { md: 'hi' } });
  f._img = { width: 1 };
  const back = parseDocument(serializeDocument(d));
  assert.equal(back.frames[0].content.md, 'hi');
  assert.equal(back.frames[0]._img, undefined);
  assert.throws(() => parseDocument({ format: 'plate' }), /not a compo document/);
  assert.throws(() => parseDocument({ format: 'compo', version: 99, frames: [] }), /version 99/);
  assert.throws(() => parseDocument({ format: 'compo', version: 1, frames: [{ id: 'a', kind: 'text', box: [1, 2] }] }), /box/);
});

test('align, distribute, z-order; locked frames stay', () => {
  const d = createDocument();
  const a = addFrame(d, { kind: 'text', box: [10, 10, 20, 10] });
  const b = addFrame(d, { kind: 'text', box: [50, 30, 40, 10] });
  const c = addFrame(d, { kind: 'text', box: [120, 60, 10, 10] });
  alignFrames(d, [a.id, b.id], 'left');
  assert.equal(b.box[0], 10);
  alignFrames(d, [a.id, b.id], 'right');
  assert.equal(a.box[0] + a.box[2], 50);
  // distribute: gaps equal between the outer two
  a.box = [0, 0, 10, 10]; b.box = [15, 0, 10, 10]; c.box = [100, 0, 10, 10];
  distributeFrames(d, [a.id, b.id, c.id], 'h');
  assert.equal(b.box[0], 50);
  c.locked = true; c.box = [200, 0, 10, 10];
  alignFrames(d, [a.id, c.id, b.id], 'top');
  assert.equal(c.box[0], 200);
  bringToFront(d, [a.id]); assert.equal(d.frames.at(-1).id, a.id);
  sendToBack(d, [a.id]); assert.equal(d.frames[0].id, a.id);
});

test('snapping: to the margins, the page centre, other frames; guides reported', () => {
  const d = createDocument({ page: { size: 'A4', orientation: 'portrait', margins: [10, 10, 10, 10] } });
  const o = addFrame(d, { kind: 'text', box: [60, 100, 30, 20] });
  let s = snapBox(d, [11, 50, 20, 20]);
  assert.equal(s.box[0], 10); assert.equal(s.guides.x, 10);
  s = snapBox(d, [94, 40, 20, 20]);                       // centre 104 → page centre 105
  assert.equal(s.box[0], 95); assert.equal(s.guides.x, 105);
  s = snapBox(d, [40, 119, 20, 20], { ignore: [] });      // top 119 → o's bottom 120
  assert.equal(s.box[1], 120);
  s = snapBox(d, [60.5, 100.4, 30, 20], { ignore: [o.id] });
  assert.notEqual(s.box[1], 100);                          // its own edges don't attract it
});

test('fields: {fig} {page} {pages} {date} {title} and ${expr} from the host', () => {
  const env = { page: 2, pages: 5, date: '2026-11-22', title: 'Pit A', figOf: () => 7, evalField: (e, vars) => vars[e] ?? e.toUpperCase(), vars: { level: 340 } };
  assert.equal(resolveFields('Fig. {fig} — {title} p{page}/{pages} {date}', env), 'Fig. 7 — Pit A p2/5 2026-11-22');
  assert.equal(resolveFields('level ${level} m, ${abc}', env), 'level 340 m, ABC');
  assert.equal(resolveFields('${x}', {}), '⟨x⟩');              // no host: shown, not swallowed
  assert.match(resolveFields('${x}', { evalField: () => { throw new Error('nope'); } }), /nope/);
});

test('niceBelow: 1-2-5 lengths', () => {
  assert.equal(niceBelow(830), 500); assert.equal(niceBelow(199), 100); assert.equal(niceBelow(0.0034), 0.002); assert.equal(niceBelow(0), 0);
});

// a page through the PDF context: everything lands as vector content in mm → pt
async function pdfText(doc, env = {}) {
  const bytes = await exportPDF(doc, { env, compress: false, created: '2026-11-22T00:00:00Z' });
  return { bytes, s: new TextDecoder('latin1').decode(bytes) };
}

test('renderPage onto a PDF page: text, legend, scale bar, north, borders, an error frame', async () => {
  const d = createDocument({ title: 'Section 340' });
  addFrame(d, { kind: 'text', box: [10, 10, 100, 20], content: { md: '**Figure {fig}.** {title}', size: 10 } });
  addFrame(d, { kind: 'legend', box: [200, 20, 40, 40], content: { title: 'Au g/t', entries: [{ color: '#ff0000', label: '> 1' }, { color: '#0000ff', label: '< 1' }] }, style: { border: true } });
  const view = addFrame(d, { kind: 'image', box: [10, 40, 150, 100], content: { meta: { worldPerMm: 10, north: 30 } } });
  addFrame(d, { kind: 'scalebar', box: [10, 150, 60, 8], content: { of: view.id } });
  addFrame(d, { kind: 'north', box: [170, 150, 12, 16], content: { of: view.id } });
  addFrame(d, { kind: 'nonesuch', box: [100, 180, 50, 10] });
  const pdf = new PdfDocument({ compress: false, created: '2026-11-22T00:00:00Z' });
  const ctx = pdf.addPage({ width: 297 * 72 / 25.4, height: 210 * 72 / 25.4 }).getContext('2d', { units: 'mm' });
  renderPage(d, ctx, {});
  const s = new TextDecoder('latin1').decode(await pdf.save());
  assert.match(s, /\(Figure 1\.\) Tj/);                     // the bold run, one string
  assert.match(s, /Helvetica-Bold/);
  assert.match(s, /\( Section 340\) Tj/);
  assert.match(s, /Au g\/t/);
  assert.match(s, /\(200 m\) Tj/);                          // 60 mm × 0.8 × 10 m/mm = 480 → 200
  assert.match(s, /\(N\) Tj/);
  assert.match(s, /no frame kind/);
  assert.match(s, /1 0 0 rg/);                              // the red swatch
});

test('exportPDF: an atlas is many pages; env.prepare is called per page first', async () => {
  const pages = [1, 2, 3].map((i) => { const d = createDocument({ title: `p${i}` }); addFrame(d, { kind: 'text', box: [10, 10, 100, 20], content: { md: 'page {page} of {pages}' } }); return d; });
  const seen = [];
  const { s } = await pdfText(pages, { prepare: async (doc, o) => { seen.push([doc.title, o.page, o.dpi]); } });
  assert.deepEqual(seen, [['p1', 1, 300], ['p2', 2, 300], ['p3', 3, 300]]);
  assert.match(s, /\/Count 3/);
  assert.match(s, /page 2 of 3/);
  assert.match(s, /\/MediaBox \[0 0 841\.8898 595\.2756\]/);     // A4 landscape in points
});

test('a host can register a kind; a throwing kind draws its error in the frame', async () => {
  registerKind('test-boom', { label: 'boom', draw() { throw new Error('kaboom'); } });
  registerKind('test-ok', { label: 'ok', draw(ctx, b) { ctx.fillStyle = '#00ff00'; ctx.fillRect(b[0], b[1], b[2], b[3]); } });
  assert.equal(kindOf('test-ok').label, 'ok');
  const d = createDocument();
  addFrame(d, { kind: 'test-boom', box: [10, 10, 50, 10] });
  addFrame(d, { kind: 'test-ok', box: [10, 30, 50, 10] });
  const { s } = await pdfText(d);
  assert.match(s, /test-boom: kaboom/);
  assert.match(s, /0 1 0 rg/);
});

// ── arranging: groups as units, match size, one-step z-order, equal spacing, resize snapping ──
import { groupFrames, ungroupFrames, expandGroups, unitsOf, matchSize, bringForward, sendBackward, snapResize } from '../ext/compo/src/main.js';

test('groups: expand, align and distribute as one unit; a locked member pins its unit', () => {
  const d = createDocument();
  const a = addFrame(d, { kind: 'text', box: [10, 10, 20, 10] });
  const b = addFrame(d, { kind: 'text', box: [40, 10, 20, 10] });
  const c = addFrame(d, { kind: 'text', box: [100, 50, 10, 10] });
  const g = groupFrames(d, [a.id, b.id]);
  assert.ok(g); assert.equal(a.group, b.group);
  assert.deepEqual(expandGroups(d, [a.id]).sort(), [a.id, b.id].sort());
  assert.equal(unitsOf(d, [a.id, c.id]).length, 2);
  alignFrames(d, [a.id, c.id], 'right');                  // the group's right edge (60) and c's (110) → 110
  assert.equal(b.box[0] + b.box[2], 110); assert.equal(a.box[0], 60);   // the group moved whole, keeping its inner gap
  c.locked = true;
  alignFrames(d, [a.id, c.id], 'bottom');                // c is the reference: it stays, the group comes down to its bottom (60)
  assert.equal(c.box[1], 50); assert.equal(a.box[1] + a.box[3], 60); assert.equal(b.box[1], 50);
  ungroupFrames(d, [a.id]);
  assert.equal(a.group, undefined); assert.equal(b.group, undefined);
});

test('match size to the FIRST selected; locked frames keep theirs', () => {
  const d = createDocument();
  const a = addFrame(d, { kind: 'text', box: [10, 10, 40, 30] });
  const b = addFrame(d, { kind: 'text', box: [80, 10, 10, 10] });
  const c = addFrame(d, { kind: 'text', box: [120, 10, 10, 10] }); c.locked = true;
  matchSize(d, [a.id, b.id, c.id], 'w');
  assert.deepEqual(b.box, [80, 10, 40, 10]); assert.deepEqual(c.box, [120, 10, 10, 10]);
  matchSize(d, [a.id, b.id], 'both');
  assert.deepEqual(b.box, [80, 10, 40, 30]);
});

test('one-step z-order', () => {
  const d = createDocument();
  const ids = ['a', 'b', 'c', 'd'].map((k) => addFrame(d, { id: k, kind: 'text', box: [0, 0, 5, 5] }).id);
  bringForward(d, ['b']); assert.deepEqual(d.frames.map((f) => f.id), ['a', 'c', 'b', 'd']);
  sendBackward(d, ['d']); assert.deepEqual(d.frames.map((f) => f.id), ['a', 'c', 'd', 'b']);
  bringForward(d, ['b']); assert.deepEqual(d.frames.map((f) => f.id), ['a', 'c', 'd', 'b']);   // already on top
  assert.equal(ids.length, 4);
});

test('equal spacing: a gap that exists elsewhere, and centred between two neighbours', () => {
  const d = createDocument({ page: { size: 'A4', orientation: 'landscape', margins: [0, 0, 0, 0] } });
  addFrame(d, { id: 'p', kind: 'text', box: [20, 100, 30, 20] });
  addFrame(d, { id: 'q', kind: 'text', box: [62, 100, 30, 20] });          // the gap p→q is 12
  // a third frame dragged to the right of q, at a gap of 12.8 → snaps to 12 (x = 104)
  let s = snapBox(d, [104.8, 100, 30, 20], { ignore: [] });
  assert.equal(s.box[0], 104);
  assert.ok(s.guides.gaps.length === 2 && s.guides.gaps.every((g) => Math.abs(g.b - g.a - 12) < 1e-9));
  // centred between p and a far frame: equal gaps both sides
  const d2 = createDocument({ page: { size: 'A4', orientation: 'landscape', margins: [0, 0, 0, 0] } });
  addFrame(d2, { kind: 'text', box: [20, 50, 30, 20] });
  addFrame(d2, { kind: 'text', box: [170, 50, 30, 20] });
  s = snapBox(d2, [94.3, 50, 31, 20]);                     // centred x = (50 + 170 − 31) / 2 = 94.5
  assert.ok(Math.abs(s.box[0] - 94.5) < 1e-9, String(s.box[0]));
  assert.equal(s.guides.gaps.length, 2);
});

test('resize snapping: only the dragged edges move', () => {
  const d = createDocument({ page: { size: 'A4', orientation: 'portrait', margins: [10, 10, 10, 10] } });
  addFrame(d, { id: 'o', kind: 'text', box: [100, 100, 50, 50] });
  let s = snapResize(d, [20, 20, 79, 40], [1, 1]);         // right edge 99 → o's left 100; bottom 60 stays
  assert.deepEqual(s.box, [20, 20, 80, 40]); assert.equal(s.guides.x, 100);
  s = snapResize(d, [11.2, 30, 40, 40], [0, 0.5]);         // left edge 11.2 → the margin 10, width grows
  assert.deepEqual(s.box, [10, 30, 41.2, 40]);
});

test('table: book rules, numbers right-aligned, type shrinks to fit, overflow counted; TSV in', async () => {
  const { tableFromTsv } = await import('../ext/compo/src/main.js');
  const t = tableFromTsv('cutoff\ttonnage\tgrade\n0.5\t12,400\t1.82\n1.0\t8,100\t2.41\n1.5\t4,020\t3.05\n', 'Grade–tonnage');
  assert.deepEqual(t.columns, ['cutoff', 'tonnage', 'grade']); assert.equal(t.rows.length, 3);
  const d = createDocument();
  addFrame(d, { kind: 'table', box: [10, 10, 80, 30], content: t });
  const many = { columns: ['a', 'b'], rows: Array.from({ length: 50 }, (_, i) => [String(i), 'x']) };
  addFrame(d, { kind: 'table', box: [100, 10, 40, 30], content: many });
  const { s } = await pdfText(d);
  assert.match(s, /\(Grade(.|\\\d{3})tonnage\) Tj/);       // (the en dash is WinAnsi — a byte or an escape)
  assert.match(s, /\(12,400\) Tj/);
  assert.match(s, /more rows\) Tj/);                       // 50 rows don't fit 30 mm
  // a table too wide for its box: the type shrinks (smaller Tf than the 7.5 pt default)
  const d2 = createDocument();
  addFrame(d2, { kind: 'table', box: [10, 10, 25, 30], content: { columns: ['a long header', 'another long one'], rows: [['1', '2']] } });
  const s2 = (await pdfText(d2)).s;
  const sizes = [...s2.matchAll(/\/F\d+ ([\d.]+) Tf/g)].map((m) => +m[1]);
  assert.ok(Math.min(...sizes) < 7.5 * 25.4 / 72 * 0.9, String(sizes));
});

test('grid + guides snap; grouping gathers a group in the stack; restacking keeps groups whole', async () => {
  const { moveInStack, gatherGroup } = await import('../ext/compo/src/main.js');
  const d = createDocument({ page: { size: 'A4', orientation: 'portrait', margins: [0, 0, 0, 0], grid: { size: 5, show: true, snap: true } } });
  let s = snapBox(d, [31.2, 48.9, 20, 20]);                // grid 5 → 30 / 50 (within the 1.5 mm snap)
  assert.deepEqual([s.box[0], s.box[1]], [30, 50]);
  d.page.grid = undefined; d.page.guides = { x: [73.5], y: [] };
  s = snapBox(d, [72.4, 100, 20, 20]);
  assert.equal(s.box[0], 73.5); assert.equal(s.guides.x, 73.5);
  s = snapResize(d, [20, 20, 52.8, 40], [1, 0.5]);         // right edge 72.8 → the guide at 73.5
  assert.equal(s.box[2], 53.5);
  // grouping gathers the members where the frontmost was
  const d2 = createDocument();
  for (const k of ['a', 'b', 'c', 'd', 'e']) addFrame(d2, { id: k, kind: 'text', box: [0, 0, 5, 5] });
  groupFrames(d2, ['a', 'd']);
  assert.deepEqual(d2.frames.map((f) => f.id), ['b', 'c', 'a', 'd', 'e']);
  // a loose frame dropped onto a group member lands beside the whole block, not inside it
  moveInStack(d2, ['e'], 'a', false);
  assert.deepEqual(d2.frames.map((f) => f.id), ['b', 'c', 'e', 'a', 'd']);
  assert.equal(C_frame(d2, 'e').group, undefined);
  // a member reordered inside its own block stays in the group
  moveInStack(d2, ['a'], 'd', true);
  assert.deepEqual(d2.frames.map((f) => f.id), ['b', 'c', 'e', 'd', 'a']); assert.ok(C_frame(d2, 'a').group);
  // a member dragged out of its block leaves the group — and a one-member group dissolves
  moveInStack(d2, ['a'], 'b', false);
  assert.deepEqual(d2.frames.map((f) => f.id), ['a', 'b', 'c', 'e', 'd']);
  assert.equal(C_frame(d2, 'a').group, undefined); assert.equal(C_frame(d2, 'd').group, undefined);
  // a whole group moves as a block
  groupFrames(d2, ['b', 'c']);
  moveInStack(d2, ['b', 'c'], 'd', true);
  assert.deepEqual(d2.frames.map((f) => f.id), ['a', 'e', 'd', 'b', 'c']);
  gatherGroup(d2, 'nonesuch');
});
const C_frame = (d, id) => d.frames.find((f) => f.id === id);

test('fields: the grammar, number + date formats, {ref}, {scale}, host fields, unknown braces kept', async () => {
  const { formatNumber, formatDate, registerField } = await import('../ext/compo/src/main.js');
  assert.equal(formatNumber(1234567.891, ',.0f'), '1,234,568');
  assert.equal(formatNumber(1234567.891, '_.2f'), '1 234 567.89');
  assert.equal(formatNumber(0.4567, '.1%'), '45.7%');
  assert.equal(formatNumber(-1234.5, ',.1f'), '−1,234.5');
  assert.equal(formatNumber(7604125.3), '7604125');                // no format: never rounds the integer part away
  assert.equal(formatNumber(3.14159265), '3.14159');
  assert.equal(formatDate(new Date(2026, 0, 5, 7, 3, 9), 'D MMMM YYYY, HH:mm:ss'), '5 January 2026, 07:03:09');
  const doc = createDocument({ title: 'Pit A' });
  addFrame(doc, { id: 'v', name: 'plan', kind: 'image', box: [10, 10, 100, 80], content: { width: 1000, height: 800, meta: { ortho: true, worldPerPx: 0.25 } } });
  addFrame(doc, { id: 'p', kind: 'image', box: [150, 10, 100, 80], content: { width: 1000, height: 800, meta: { ortho: false } } });
  const cap = addFrame(doc, { id: 'c', name: 'plancap', kind: 'text', box: [10, 92, 100, 8], content: { md: 'Figure {fig}' } });
  const cap2 = addFrame(doc, { id: 'c2', kind: 'text', box: [150, 92, 100, 8], content: { md: 'Figure {fig}' } });
  const env = { doc, figOf: (f) => [cap, cap2].indexOf(f) + 1, now: new Date(2026, 10, 22), title: 'Pit A', evalField: (e, v) => (e === 'x * 2' ? 2 * v.x : v[e]), vars: { x: 1234.5 } };
  const R = (s, fr = cap) => resolveFields(s, env, fr);
  assert.equal(R('{date} · {date:DD/MM/YYYY} · {title}'), '2026-11-22 · 22/11/2026 · Pit A');
  assert.equal(R('{scale}'), '1 : 2 500');                         // the nearest view: 0.25 m/px at 10 px/mm
  assert.equal(R('{scale}', cap2), 'no scale (perspective)');      // nearest to cap2 is the perspective view
  assert.equal(R('{scale:plan}', cap2), '1 : 2 500');              // … unless one is named
  assert.equal(R('see Figure {ref:plancap}, and {ref:plan}', cap2), 'see Figure 1, and 1');   // a view → its nearest {fig} caption
  assert.equal(R('${x * 2:,.1f} | ${x}'), '2,469.0 | 1234.5');
  assert.equal(R('{fig:,} {nope} {} {a b} {page}/{pages}'), '1 {nope} {} {a b} 1/1');
  registerField('answer', (a) => (a ? a.length : 42), 'test');
  assert.equal(R('{answer} {answer:abcd} {answer:,}'), '42 4 42');
  assert.equal(resolveFields('{answer}', { ...env, fields: { answer: () => 'host' } }, cap), 'host');   // env.fields win
});
