// @gcu/compo: the document model, fields, snapping, and the one drawing path onto a PDF page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, parseDocument, serializeDocument, addFrame, alignFrames, distributeFrames, snapBox, bringToFront, sendToBack, pageDims, resolveFields, niceBelow, renderPage, exportPDF, kindOf, registerKind, northAnglesOf } from '../ext/compo/src/main.js';
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
  addFrame(doc, { id: 'plan', kind: 'image', box: [10, 10, 100, 80], content: { width: 1000, height: 800, meta: { ortho: true, worldPerPx: 0.25 } } });
  addFrame(doc, { id: 'p', kind: 'image', box: [150, 10, 100, 80], content: { width: 1000, height: 800, meta: { ortho: false } } });
  const cap = addFrame(doc, { id: 'plancap', kind: 'text', box: [10, 92, 100, 8], content: { md: 'Figure {fig}' } });
  const cap2 = addFrame(doc, { id: 'c2', kind: 'text', box: [150, 92, 100, 8], content: { md: 'Figure {fig}' } });
  const env = { doc, figOf: (f) => [cap, cap2].indexOf(f) + 1, now: new Date(2026, 10, 22), title: 'Pit A', evalField: (e, v) => (e === 'x * 2' ? 2 * v.x : v[e]), vars: { x: 1234.5 } };
  const R = (s, fr = cap) => resolveFields(s, env, fr);
  assert.equal(R('{date} · {date:DD/MM/YYYY} · {title}'), '2026-11-22 · 22/11/2026 · Pit A');
  assert.equal(R('{scale}'), '1 : 2 500');                         // the nearest view: 0.25 m/px at 10 px/mm
  assert.equal(R('{scale}', cap2), 'no scale (perspective)');      // nearest to cap2 is the perspective view
  assert.equal(R('{scale@plan}', cap2), '1 : 2 500');              // … unless one is named (@id)
  cap2.content.of = 'plan'; assert.equal(R('{scale}', cap2), '1 : 2 500'); delete cap2.content.of;   // … or the caption refers to it
  assert.equal(R('{scale@nope}', cap2), '⟨no frame “nope”⟩');
  assert.equal(R('see Figure {fig@plancap}, and {fig@plan}', cap2), 'see Figure 1, and 1');   // a view → its nearest {fig} caption
  assert.equal(R('${x * 2:,.1f} | ${x}'), '2,469.0 | 1234.5');
  assert.equal(R('{fig:,} {nope} {} {a b} {page}/{pages}'), '1 {nope} {} {a b} 1/1');
  registerField('answer', (a) => (a ? a.length : 42), 'test');
  assert.equal(R('{answer} {answer:abcd} {answer:,}'), '42 4 42');
  assert.equal(resolveFields('{answer}', { ...env, fields: { answer: () => 'host' } }, cap), 'host');   // env.fields win
});

test('ids: auto <prefix>-n, renaming rewrites references, old names and {ref:} migrate', async () => {
  const { renameFrame, newId } = await import('../ext/compo/src/main.js');
  const doc = createDocument();
  const v = addFrame(doc, { kind: 'image', source: { kind: 'view' }, content: { meta: { ortho: true } } });
  const t = addFrame(doc, { kind: 'text', content: { md: 'at {scale@view-1} · {fig@view-1}', of: 'view-1' } });
  const sb = addFrame(doc, { kind: 'scalebar', content: { of: 'view-1' } });
  assert.deepEqual([v.id, t.id, sb.id, newId(doc, 'view')], ['view-1', 'text-1', 'scale-1', 'view-2']);
  assert.equal(renameFrame(doc, 'view-1', 'plan'), null);
  assert.equal(t.content.md, 'at {scale@plan} · {fig@plan}');
  assert.equal(t.content.of, 'plan'); assert.equal(sb.content.of, 'plan');
  assert.match(renameFrame(doc, 'plan', 'text-1'), /already/);
  assert.match(renameFrame(doc, 'plan', 'has space'), /no spaces/);
  const old = { format: 'compo', version: 1, title: '', page: { size: 'A4' }, frames: [
    { id: 'image-1x', name: 'plan view', kind: 'image', box: [0, 0, 10, 10], content: {} },
    { id: 'text-2y', kind: 'text', box: [0, 0, 10, 10], content: { md: 'see {ref:plan view} at {scale:plan view}' } }] };
  const d2 = parseDocument(JSON.stringify(old));
  assert.equal(d2.frames[0].id, 'plan-view'); assert.equal(d2.frames[0].name, undefined);
  assert.equal(d2.frames[1].content.md, 'see {fig@plan-view} at {scale@plan-view}');
});

test('world: a projected view maps world ↔ page; ticks name the coordinate each border shows; labels follow their point', async () => {
  const C = await import('../ext/compo/src/main.js');
  const m = [1 / 50, 0, 0, 0, 0, 1 / 40, 0, 0, 0, 0, -1 / 1000, 0, 0, 0, 0, 1];        // a plan: 100 × 80 m about the origin
  const doc = createDocument();
  const v = addFrame(doc, { id: 'plan', kind: 'image', box: [10, 10, 100, 80], content: { width: 1000, height: 800, ticks: 'ticks', meta: { ortho: true, proj: { m, origin: [512300, 7604000, 600] } } } });
  assert.deepEqual(C.worldToPage(v, [512300, 7604000, 0]), { x: 60, y: 50, inside: true });
  assert.deepEqual(C.pageToWorld(v, 110, 10).slice(0, 2), [512350, 7604040]);
  const t = C.worldTicks(v);
  assert.ok(t.filter((x) => x.edge === 'top').every((x) => x.axis === 'E') && t.filter((x) => x.edge === 'left').every((x) => x.axis === 'N'));
  assert.ok(t.some((x) => x.edge === 'top' && x.value === 512300 && Math.abs(x.x - 60) < 1e-9));
  assert.equal(C.fmtCoord(7604000, 20), '7 604 000');
  // an N–S section looking east: northing along the bottom, RL up the side
  const sec = addFrame(doc, { kind: 'image', box: [10, 100, 100, 80], content: { width: 1000, height: 800, meta: { proj: { m: [0, 0, -1 / 1000, 0, 1 / 50, 0, 0, 0, 0, 1 / 40, 0, 0, 0, 0, 0, 1], origin: [512300, 7604000, 600] } } } });
  const ts = C.worldTicks(sec);
  assert.ok(ts.filter((x) => x.edge === 'bottom').every((x) => x.axis === 'N') && ts.filter((x) => x.edge === 'left').every((x) => x.axis === 'RL') && ts.length > 0);
  assert.equal(C.worldTicks({ ...v, content: { ...v.content, meta: { proj: { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0], origin: [0, 0, 0] } } } }).length, 0);   // perspective: none
  // a label: its leader ends where the point lands — and moves when the view does
  addFrame(doc, { id: 'lbl', kind: 'label', box: [80, 15, 25, 6], content: { text: 'DH-07', at: [512310, 7604010, 600], of: 'plan' } });
  const bytes = await exportPDF(doc, { compress: false, source: false });
  const s = new TextDecoder('latin1').decode(bytes);
  assert.ok(s.includes('(DH-07) Tj') && s.includes('(512 300 E) Tj') && s.includes('(7 604 000 N) Tj'));
});

test('overlays: a plane trace lands where the plane crosses the picture; read at the focus depth; none facing the viewer', async () => {
  const C = await import('../ext/compo/src/main.js');
  const m = [1 / 50, 0, 0, 0, 0, 1 / 40, 0, 0, 0, 0, -1 / 1000, 0, 0, 0, 0, 1];
  const v = { id: 'k', kind: 'image', box: [10, 10, 100, 80], content: { width: 1000, height: 800, meta: { proj: { m, origin: [512300, 7604000, 600] } } } };
  const t = C.planeTrace(v, { normal: [1, 0, 0], position: 512310, thickness: 10 });
  assert.deepEqual(t.line.map((p) => p[0]), [70, 70]);
  assert.deepEqual(t.faces.map((f) => f[0][0]), [65, 75]);
  assert.equal(C.planeTrace(v, { normal: [0, 0, 1], position: 600 }), null);           // a level on a plan: no trace
  // a near-plan view (the camera a hair off vertical): y drifts with depth — read at the focus
  const tilt = [0.00629, 0, 0, 0, 0, 0.00943, 0.00000156, 0, 0, 0.000189, -0.0000781, 0, 0, 0, -0.98, 1];
  const k = { id: 'k2', kind: 'image', box: [225, 158, 60, 40], content: { width: 360, height: 240, meta: { proj: { m: tilt, origin: [150, 100, 20] } } } };
  assert.equal(C.planeTrace(k, { normal: [0, 1, 0], position: 105 }), null);           // read at NDC 0: far off the model, misses
  k.content.meta.proj.focus = [150, 100, 20];
  const tk = C.planeTrace(k, { normal: [0, 1, 0], position: 105 });
  assert.ok(tk && tk.line && tk.line[0][1] > 158 && tk.line[0][1] < 198);
});

test('formatters: grouped integers, significant figures, bearings — and fmtCoord groups the same way', async () => {
  const C = await import('../ext/compo/src/main.js');
  assert.equal(C.groupDigits(2343000), '2 343 000');
  assert.equal(C.groupDigits(-2343000), '-2 343 000');
  assert.equal(C.groupDigits(999), '999');
  assert.equal(C.groupDigits(1234567, ','), '1,234,567');
  assert.equal(C.significant(1234.567, 4), 1235);
  assert.equal(C.significant(0.012345, 3), 0.0123);
  assert.equal(C.significant(NaN), '');
  assert.equal(C.fmtBearing(45), '045°');
  assert.equal(C.fmtBearing(-15), '345°');
  assert.equal(C.fmtBearing(359.7), '000°');
  assert.equal(C.fmtCoord(7604000, 10), '7 604 000');
  assert.equal(C.formatNumber(1234567, '_'), '1 234 567');
});

test('house style: {prop:key} reads the document over the host; the title block lays out bottom-right inside the margins', async () => {
  const C = await import('../ext/compo/src/main.js');
  assert.deepEqual(C.HOUSE_KEYS.map(([k]) => k), ['company', 'client', 'project', 'prepared', 'checked', 'disclaimer']);
  assert.deepEqual(C.FIGURE_KEYS.map(([k]) => k), ['drawing', 'revision']);
  const doc = createDocument({ title: 'Pit A', page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] } });
  const rows = C.titleBlockFrames(doc);
  assert.equal(rows.length, C.TITLE_BLOCK_ROWS.length);
  const bottom = rows[rows.length - 1].box, top = rows[0].box;
  assert.equal(+(bottom[1] + bottom[3]).toFixed(2), 210 - 12);        // the last row sits on the bottom margin
  assert.equal(top[0] + top[2], 297 - 12);                            // flush with the right margin
  assert.ok(rows.every((r) => r.kind === 'text' && r.style.border && r.box[2] === 95));
  for (let i = 1; i < rows.length; i++) assert.equal(+(rows[i - 1].box[1] + rows[i - 1].box[3]).toFixed(2), rows[i].box[1]);   // stacked, no gaps
  doc.props = { drawing: 'D-101' };
  const env = { doc, title: doc.title, props: { company: 'Acme Mining', client: 'Ore Co', drawing: 'house D' } };
  const R = (md) => resolveFields(md, env, null);
  assert.equal(R(rows[0].content.md), '**Acme Mining**');
  assert.equal(R(rows[3].content.md).split(' · ')[0], 'drawing D-101');   // the document's own over the host's
  assert.equal(R('{prop:checked}'), '—');
});

test('templates: a document from a template keeps frames, page and properties, but not the per-drawing ones', async () => {
  const C = await import('../ext/compo/src/main.js');
  const tpl = createDocument({ title: 'house A3', page: { size: 'A3', orientation: 'portrait', margins: [15, 15, 15, 15] } });
  addFrame(tpl, { kind: 'text', box: [10, 10, 50, 10], content: { md: '{prop:company}' } });
  tpl.props = { company: 'Acme', drawing: 'T-1', revision: 'C' };
  C.setTemplate(tpl, true);
  assert.equal(tpl.template, true);
  const d = C.docFromTemplate(tpl, 'Pit B');
  assert.equal(d.title, 'Pit B');
  assert.equal(d.template, undefined);
  assert.deepEqual(d.page, tpl.page);
  assert.equal(d.frames.length, 1);
  assert.notEqual(d.frames[0], tpl.frames[0]);                        // a copy, not the template's own frames
  assert.deepEqual(d.props, { company: 'Acme' });
  assert.deepEqual(C.docFromTemplate(tpl, 'x', { clear: [] }).props, tpl.props);
  C.setTemplate(tpl, false);
  assert.equal('template' in tpl, false);
});

test('small multiples: the grid over a frame’s box — reading order, caption strips, too small refused', async () => {
  const C = await import('../ext/compo/src/main.js');
  const g = C.multiplesGrid([10, 20, 200, 120], 5);
  assert.equal(g.cols, 3); assert.equal(g.rows, 2);
  assert.equal(g.cells.length, 5);
  assert.deepEqual(g.cells[0].box.slice(0, 2), [10, 20]);
  assert.ok(g.cells[1].box[0] > g.cells[0].box[0] && g.cells[3].box[1] > g.cells[0].box[1]);   // across, then down
  for (const c of g.cells) {
    assert.equal(c.caption[0], c.box[0]); assert.equal(c.caption[2], c.box[2]);
    assert.equal(c.caption[1], +(c.box[1] + c.box[3] + 0.5).toFixed(2));                       // its caption right under it
  }
  const last = g.cells[2];
  assert.ok(Math.abs(last.box[0] + last.box[2] - 210) < 0.02);                                  // the row fills the box
  assert.equal(C.multiplesGrid([0, 0, 200, 120], 4, { cols: 4 }).rows, 1);
  assert.throws(() => C.multiplesGrid([0, 0, 30, 30], 9), /too small/);
});

test('the title block is ONE frame of its own kind: rows drawn as text with their fields, ruled; an old group migrates on load', async () => {
  const C = await import('../ext/compo/src/main.js');
  const doc = createDocument({ title: 'Pit A', page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] } });
  const f = C.titleBlockFrame(doc);
  assert.equal(f.kind, 'titleblock');
  const hTot = C.TITLE_BLOCK_ROWS.reduce((s, r) => s + r[2], 0);
  assert.deepEqual(f.box, [297 - 12 - 95, +(210 - 12 - hTot).toFixed(2), 95, hTot]);
  addFrame(doc, f);
  const pdf = new PdfDocument({ compress: false, created: '2026-11-22T00:00:00Z' });
  const ctx = pdf.addPage({ width: 297 * 72 / 25.4, height: 210 * 72 / 25.4 }).getContext('2d', { units: 'mm' });
  renderPage(doc, ctx, { title: 'Pit A', props: { company: 'Acme Mining', drawing: 'D-7' } });
  const s = new TextDecoder('latin1').decode(await pdf.save());
  assert.match(s, /\(Acme Mining\) Tj/);
  assert.match(s, /\(Pit A\) Tj/);
  assert.match(s, /drawing D-7/);
  // an OLD figure: the six bordered text frames in a group — one titleblock frame after a load, same box
  const old = createDocument({ title: 'Pit A', page: { size: 'A4', orientation: 'landscape', margins: [12, 12, 12, 12] } });
  addFrame(old, { kind: 'text', box: [10, 10, 50, 10], content: { md: 'a note' } });
  const ids = C.titleBlockFrames(old).map((fr) => addFrame(old, fr).id);
  C.groupFrames(old, ids);
  addFrame(old, { kind: 'text', box: [10, 30, 50, 10], content: { md: 'on top' } });
  const back = parseDocument(serializeDocument(old));
  assert.deepEqual(back.frames.map((x) => x.kind), ['text', 'titleblock', 'text']);   // in the group's place in the stack
  const tb = back.frames[1];
  assert.deepEqual(tb.box, f.box);
  assert.deepEqual(tb.content.rows, C.TITLE_BLOCK_ROWS.map(([md, size, h]) => [md, size, h]));
  // an EDITED old block (a row's text changed) stays as its text frames
  const ed = createDocument({ title: 'x' });
  const ids2 = C.titleBlockFrames(ed).map((fr) => addFrame(ed, fr).id);
  C.groupFrames(ed, ids2);
  ed.frames[2].content.md = 'my own row';
  assert.equal(parseDocument(serializeDocument(ed)).frames.filter((x) => x.kind === 'text').length, 6);
});

test('a north arrow on a view looking along north fits its frame: the sign, the N, the words wrapped to the width', async () => {
  const d = createDocument();
  const view = addFrame(d, { kind: 'image', box: [10, 40, 150, 100], content: { meta: { worldPerMm: 10, north: null } } });
  const nb = [170, 150, 13, 17];                              // micro's default north frame
  addFrame(d, { kind: 'north', box: nb, content: { of: view.id } });
  const pdf = new PdfDocument({ compress: false, created: '2026-11-22T00:00:00Z' });
  const ctx = pdf.addPage({ width: 297 * 72 / 25.4, height: 210 * 72 / 25.4 }).getContext('2d', { units: 'mm' });
  const texts = [];
  const spy = new Proxy(ctx, { get(t, k) { const v = t[k]; if (k === 'fillText') return (s, x, y) => { texts.push({ s, x, w: t.measureText(s).width, align: t.textAlign }); return v.call(t, s, x, y); }; return typeof v === 'function' ? v.bind(t) : v; }, set(t, k, v) { t[k] = v; return true; } });
  renderPage(d, spy, {});
  const mine = texts.filter((t) => /^(N|out|the)/.test(t.s));
  assert.deepEqual(mine.map((t) => t.s), ['N', 'out of', 'the page']);
  for (const t of mine) assert.ok(t.x - t.w / 2 >= nb[0] && t.x + t.w / 2 <= nb[0] + nb[2], `${t.s}: ${t.w.toFixed(2)} mm in a ${nb[2]} mm frame`);
});

// ── markdown in text frames and labels (kinds.js layoutText / drawText) ──
import { layoutText, refreshLegend, legendEntries, canPin, pinToPage, pageToPin } from '../ext/compo/src/main.js';
// a context that measures every character as 1 mm per point of the font's size, and remembers the fonts
const fakeCtx = () => { const fonts = []; return { fonts, set font(f) { fonts.push(f); this._f = f; }, get font() { return this._f; },
  measureText: (t) => ({ width: [...t].length * 0.3 }) }; };

test('markdown: headings are bigger and bold, lists hang their marker, inline italic / code pick their faces, --- is a rule', () => {
  const ctx = fakeCtx();
  const { lines } = layoutText(ctx, '# Title\n## Sub\nplain *slanted* and `code`\n- one\n2. two\n---\nlast', 200, { size: 10 });
  const txt = (l) => l.map((w) => w.t).join('');
  assert.equal(txt(lines[0]), 'Title'); assert.equal(lines[0].size, 16); assert.ok(lines[0].every((w) => w.b));
  assert.equal(txt(lines[1]), 'Sub'); assert.equal(lines[1].size, 13); assert.ok(lines[1].gap > 0, 'a heading below text gets air');
  assert.equal(lines[0].gap, 0, 'not at the very top');
  assert.equal(txt(lines[2]), 'plain slanted and code');
  assert.ok(lines[2].find((w) => w.t === 'slanted').i, '*slanted* is italic');
  assert.ok(lines[2].find((w) => w.t === 'code').m, '`code` is monospace');
  assert.equal(lines[3].marker.t, '•'); assert.ok(lines[3].indent > 0); assert.equal(txt(lines[3]), 'one');
  assert.equal(lines[4].marker.t, '2.'); assert.equal(txt(lines[4]), 'two');
  assert.ok(lines[5].rule); assert.equal(txt(lines[6]), 'last');
  assert.ok(ctx.fonts.some((f) => /^italic /.test(f)) && ctx.fonts.some((f) => /Space Mono/.test(f)), 'the italic and mono faces were measured');
});

test('markdown: a list item wraps under its text, not under its marker; snake_case words stay plain', () => {
  const { lines } = layoutText(fakeCtx(), '- a list item long enough to wrap twice in this narrow box\nfile_name_here', 12, { size: 10 });
  const items = lines.filter((l) => l.indent > 0);
  assert.ok(items.length >= 2, 'it wrapped'); assert.ok(items[0].marker && !items[1].marker, 'the marker only on the first line');
  assert.ok(!lines.at(-1).some((w) => w.i), '_name_ inside a word is not emphasis');
});

// ── legends: your edits sit beside the data, and a refresh keeps them ──
test('legend: edits (label, colour, hidden), order and look survive a refresh; new entries arrive', () => {
  const made = { title: 'layers', entries: [{ key: 'a', label: 'A (10)', color: '#f00' }, { key: 'b', label: 'B (5)', color: '#0f0' }] };
  const edited = { ...made, edit: { a: { label: 'granite' }, b: { hidden: true } }, order: ['b', 'a'], columns: 2, swatch: 'circle', title: 'rocks', titleUser: true };
  const fresh = { title: 'layers', entries: [{ key: 'a', label: 'A (12)', color: '#f00' }, { key: 'b', label: 'B (5)', color: '#00f' }, { key: 'c', label: 'C (1)', color: '#999' }] };
  const r = refreshLegend(edited, fresh);
  assert.equal(r.title, 'rocks'); assert.equal(r.columns, 2); assert.equal(r.swatch, 'circle');
  const es = legendEntries(r);
  assert.deepEqual(es.map((e) => e._key), ['b', 'a', 'c'], 'your order, then what is new');
  assert.equal(es[1].label, 'granite', 'your label wins');
  assert.equal(es[0].color, '#00f', 'an un-edited colour follows the data');
  assert.ok(es[0].hidden && !es[2].hidden);
  assert.equal(refreshLegend(made, fresh).title, 'layers', 'an un-typed title follows the data');
});

// ── pins: a kind that knows its own projection (a stereonet) — labels pin to it ──
test('pins: a kind with project/unproject is pinnable; a label leader lands where it says', () => {
  registerKind('test-dial', {
    label: 'dial', draw() {},
    project: (f, p) => ({ x: f.box[0] + 10 * (1 + p[0]), y: f.box[1] + 10 * (1 - p[1]), inside: true }),
    unproject: (f, x, y) => [(x - f.box[0]) / 10 - 1, 1 - (y - f.box[1]) / 10, 0],
  });
  const dial = { id: 'd', kind: 'test-dial', box: [20, 30, 20, 20], content: {} }, txt = { id: 't', kind: 'text', box: [0, 0, 5, 5], content: {} };
  assert.ok(canPin(dial)); assert.ok(!canPin(txt));
  assert.deepEqual(pinToPage(dial, [0, 0, 1]), { x: 30, y: 40, inside: true });
  assert.deepEqual(pageToPin(dial, 30, 40), [0, 0, 0]);
  // and the label kind draws its leader to that point
  const d = createDocument(); d.frames.push(dial, { id: 'L', kind: 'label', box: [60, 60, 20, 6], content: { text: 'here', at: [0.5, 0.5, 0], of: 'd' } });
  const segs = []; const spy = new Proxy({}, { get: (o, k) => (k === 'lineTo' ? (x, y) => segs.push([x, y]) : k === 'measureText' ? (t) => ({ width: t.length }) : typeof k === 'string' && /^(fill|stroke|save|restore|clip|rect|beginPath|moveTo|arc|fillRect|strokeRect|fillText|closePath|translate|scale|setLineDash)$/.test(k) ? () => {} : o[k]), set: (o, k, v) => { o[k] = v; return true; } });
  renderPage(d, spy, {});
  assert.ok(segs.some(([x, y]) => Math.abs(x - 35) < 1e-9 && Math.abs(y - 35) < 1e-9), `the leader ends on the pinned point (35, 35): ${JSON.stringify(segs)}`);
});

// ── where new frames go (model.js freeSpot): beside a frame when there's room, never on top of one ──
import { freeSpot } from '../ext/compo/src/main.js';
test('freeSpot: beside the view when it fits, else the first free place — never overlapping, always inside the margins', () => {
  const d = createDocument({ page: { size: 'A4', orientation: 'landscape', margins: [10, 10, 10, 10] } });
  d.frames.push({ id: 'view', kind: 'image', box: [10, 10, 200, 120], content: {} });
  const a = freeSpot(d, 40, 30, { near: d.frames[0] });
  assert.deepEqual(a, [214, 10, 40, 30], 'right of the view');
  d.frames.push({ id: 'leg', kind: 'legend', box: a, content: {} });
  const b = freeSpot(d, 40, 30, { near: d.frames[0] });
  assert.ok(b[1] >= 44 && b[0] === 214, `slid down the view's right side: ${b}`);
  const overlaps = (p, q) => p[0] < q[0] + q[2] && q[0] < p[0] + p[2] && p[1] < q[1] + q[3] && q[1] < p[1] + p[3];
  for (let k = 0; k < 6; k++) {
    const c = freeSpot(d, 40, 30, { near: d.frames[0] });
    for (const f of d.frames) assert.ok(!overlaps(c, f.box), `${c} on ${f.id}`);
    assert.ok(c[0] + 40 <= 287 + 1e-6 && c[1] + 30 <= 200 + 1e-6, `${c} inside the margins`);
    d.frames.push({ id: 'x' + k, kind: 'text', box: c, content: {} });
  }
});

// ── batch 6: named styles, rotation, AprilTag markers, SVG, links, a running footer ──
import { defineStyle, applyStyleToFrame, styleFromFrame, stylesOf, canRotate, TAG36H11, tagCells, exportSVG, exportPDF as exportPDF6, createDocument as createDoc6, addFrame as addFrame6 } from '../ext/compo/src/main.js';
test('named styles: a frame wears one; redefining it rewrites every frame that wears it (a shape only its shape keys)', () => {
  const d = createDoc6({});
  const a = addFrame6(d, { kind: 'text', box: [10, 10, 50, 10], content: { md: 'a', size: 9 } });
  const b = addFrame6(d, { kind: 'text', box: [10, 30, 50, 10], content: { md: 'b' } });
  const s = addFrame6(d, { kind: 'shape', box: [10, 50, 20, 20], content: { shape: 'rect' } });
  applyStyleToFrame(a, stylesOf(d).caption, 'caption'); applyStyleToFrame(b, stylesOf(d).caption, 'caption');
  assert.equal(b.content.size, 9); assert.equal(b.styleName, 'caption');
  a.content.size = 11; a.content.color = '#aa0000';
  assert.equal(defineStyle(d, 'caption', styleFromFrame(a)), 2);
  assert.equal(b.content.size, 11); assert.equal(b.content.color, '#aa0000');
  applyStyleToFrame(s, { content: { size: 20, stroke: '#00aa00' }, style: {} }, 'x');
  assert.equal(s.content.stroke, '#00aa00'); assert.equal(s.content.size, undefined, 'a shape takes the shape keys only');
});
test('rotation: allowed for a plain frame, not a view of 3D space', () => {
  assert.ok(canRotate({ kind: 'text', content: {} }));
  assert.ok(!canRotate({ kind: 'image', content: { meta: { proj: { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } } } }));
});
test('AprilTag 36h11: 587 codes; tag 0 as the reference image draws it (white ring, black ring, its data)', () => {
  assert.equal(TAG36H11.codes.length, 587);
  const g = tagCells(TAG36H11, 0).map((r) => r.map((v) => (v ? '.' : '#')).join(''));
  assert.deepEqual(g, ['..........', '.########.', '.#..#.#.#.', '.##...#.#.', '.##..####.', '.#.#.####.', '.##.#..##.', '.####.###.', '.########.', '..........']);
  assert.throws(() => tagCells(TAG36H11, 587), /0–586/);
});
test('SVG export: text stays text, a rotated frame carries its matrix, a link is an <a>, the title escaped', async () => {
  const d = createDoc6({ title: 'a <b>' });
  addFrame6(d, { kind: 'text', box: [10, 10, 100, 20], content: { md: 'see [it](https://gentropic.org)' } });
  addFrame6(d, { kind: 'shape', box: [10, 40, 30, 20], rotate: 90, content: { shape: 'rect' } });
  addFrame6(d, { kind: 'fiducial', box: [60, 40, 20, 20], content: { id: 3 } });
  const s = await exportSVG(d);
  assert.match(s, /^<\?xml/); assert.match(s, /<title>a &lt;b&gt;<\/title>/);
  assert.match(s, /<text[^>]*>see <\/text>/); assert.match(s, /<a href="https:\/\/gentropic.org">/);
  assert.match(s, /matrix\(0 1 -1 0 /, 'the 90° frame');
});
test('PDF: a markdown link is a URI annotation (only http(s) / mailto); a running footer on every page', async () => {
  const a = createDoc6({}), b = createDoc6({});
  addFrame6(a, { kind: 'text', box: [10, 10, 150, 20], content: { md: '[ok](https://gentropic.org) [no](javascript:alert(1)) [mail](mailto:x@y.z)' } });
  const s = new TextDecoder('latin1').decode(await exportPDF6([a, b], { compress: false, running: { footer: 'book · page {page} of {pages}' } }));
  assert.equal((s.match(/\/Subtype \/Link/g) || []).length, 2);
  assert.match(s, /\/URI \(https:\/\/gentropic\.org\)/); assert.match(s, /\/URI \(mailto:x@y\.z\)/); assert.doesNotMatch(s, /\/URI \(javascript/);
  assert.deepEqual(s.match(/page \d of 2/g), ['page 1 of 2', 'page 2 of 2']);
});
test('crop: a plain picture is drawn from the cropped source rectangle, at the cropped shape', async () => {
  const { kindOf } = await import('../ext/compo/src/main.js');
  const calls = [], ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { if (k === 'drawImage') calls.push(a); }), set: (t, k, v) => { t[k] = v; return true; } });
  const f = { id: 'i', kind: 'image', box: [0, 0, 80, 100], content: { width: 100, height: 50, crop: [0.1, 0, 0.1, 0.5], fit: 'contain' } };
  f._img = { width: 100, height: 50 };
  kindOf('image').draw(ctx, f.box, f, {});
  const a = calls[0];
  assert.equal(a.length, 9, 'the nine-argument form: a source rectangle');
  assert.deepEqual(a.slice(1, 5), [10, 0, 80, 25], 'left 10 %, right 10 %, the bottom half trimmed');
  assert.ok(Math.abs(a[7] / a[8] - 80 / 25) < 1e-9, 'drawn at the cropped shape');
});

test('north arrow: angles typed on the frame win, else the host gives them; a reference that needs one nobody gives says so', () => {
  const host = { northAngles: () => ({ convergence: 0.37, declination: -23.1, year: 2026, source: 'here' }) };
  const a = northAnglesOf({ content: {} }, host, {});
  assert.equal(a.convergence, 0.37); assert.equal(a.declination, -23.1); assert.equal(a.year, 2026);
  const b = northAnglesOf({ content: { convergence: 1.5, declination: '' } }, host, {});
  assert.equal(b.convergence, 1.5, 'a typed angle wins'); assert.equal(b.declination, -23.1, 'an empty field asks the host');
  assert.equal(northAnglesOf({ content: {} }, {}, {}).convergence, null, 'no host, nothing typed: none');
  // drawn: grid needs nothing; true / all without angles set frame._needs (its badge), and draw grid north
  const kind = kindOf('north'), calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => { calls.push(k); return { width: 1 }; }), set: (t, k, v) => { t[k] = v; return true; } });
  for (const [ref, env, needs] of [['grid', {}, false], ['true', {}, true], ['all', {}, true], ['true', host, false], ['magnetic', host, false], ['all', host, false]]) {
    const f = { kind: 'north', content: { reference: ref, north: 10 }, box: [0, 0, 20, 30] };
    kind.draw(ctx, f.box, f, { ...env, doc: null });
    assert.equal(!!f._needs, needs, `${ref} with ${env.northAngles ? 'a host' : 'no host'}`);
  }
});
