// @gcu/pdf — the writer's file structure (xref offsets that resolve, a trailer that points at
// them), the canvas-2D context's PDF output (paths, the y flip, transforms scaling line widths,
// transparency states, text in the standard fonts with WinAnsi encoding, images + soft masks,
// clipping, save/restore), multi-page documents with shared resources, and determinism.
// test/pdf-smoke.mjs reads the output back with pdf.js in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PdfDocument, readAttachments, pageSize, PAGE_SIZES, mm, parseFont, textWidth, encodeWinAnsi, encodeRuns, parseCssColor } from '../ext/pdf/index.js';

const latin1 = (u8) => Buffer.from(u8).toString('latin1');
const FIXED = new Date(Date.UTC(2026, 10, 22, 12, 0, 0));

// every object in the file, its dict text and its (inflated) stream
function parse(bytes) {
  const s = latin1(bytes);
  const objs = {};
  const re = /(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g;
  let m;
  while ((m = re.exec(s))) {
    const body = m[2], at = body.indexOf('\nstream\n');
    const dict = at >= 0 ? body.slice(0, at) : body;
    let stream = null;
    if (at >= 0) {
      const raw = Buffer.from(body.slice(at + 8, body.lastIndexOf('\nendstream')), 'latin1');
      stream = /FlateDecode/.test(dict) && !/Image/.test(dict) ? zlib.inflateSync(raw).toString('latin1') : raw;
    }
    objs[m[1]] = { dict, stream, offset: m.index };
  }
  return { s, objs };
}
const contentOf = (bytes, n = 0) => {
  const { objs } = parse(bytes);
  const pages = Object.values(objs).filter((o) => /\/Type \/Page\b/.test(o.dict) && !/\/Pages/.test(o.dict.split('/Parent')[0].slice(0, 20)));
  const cid = /\/Contents (\d+) 0 R/.exec(pages[n].dict)[1];
  return objs[cid].stream.toString();
};

test('the file: header, objects at their xref offsets, a trailer that points at the xref', async () => {
  const doc = new PdfDocument({ title: 'test', created: FIXED, compress: false });
  const ctx = doc.addPage('A4').getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(10, 10, 100, 50);
  const bytes = await doc.save();
  const { s, objs } = parse(bytes);
  assert.ok(s.startsWith('%PDF-1.7\n'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = +/startxref\n(\d+)/.exec(s)[1];
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const xref = s.slice(startxref).split('\n');
  const count = +xref[1].split(' ')[1];
  assert.equal(count - 1, Object.keys(objs).length);
  for (let i = 1; i < count; i++) {
    const off = +xref[2 + i].slice(0, 10);
    assert.equal(s.slice(off, off + `${i} 0 obj`.length), `${i} 0 obj`, `object ${i} sits at its xref offset`);
  }
  assert.match(s, /\/Root 1 0 R/);
  assert.match(s, /\/Title \(test\)/);
  assert.match(s, /\/Producer \(@gcu\/pdf\)/);
});

test('paths: the y-down user space lands y-up on the page; colours; fill rules; stroke widths scale with the transform', async () => {
  const doc = new PdfDocument({ created: FIXED });
  const p = doc.addPage({ width: 200, height: 100 });
  const ctx = p.getContext('2d');
  ctx.fillStyle = 'rgb(0, 0, 255)';
  ctx.fillRect(0, 0, 10, 20);                              // top-left 10 × 20
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(50, 50); ctx.closePath(); ctx.fill('evenodd');
  ctx.scale(2, 2); ctx.lineWidth = 3; ctx.strokeStyle = 'red';
  ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(20, 10); ctx.stroke();
  ctx.setLineDash([4, 2]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1, 1); ctx.stroke();
  const c = contentOf(await doc.save());
  assert.match(c, /0 0 1 rg\n0 100 m\n10 100 l\n10 80 l\n0 80 l\nh\nf/);
  assert.match(c, /\nf\*/, 'evenodd');
  assert.match(c, /1 0 0 RG 6 w/, 'lineWidth 3 under scale 2 = 6 pt');
  assert.match(c, /20 80 m\n40 80 l\nS/);
  assert.match(c, /\[8 4\] 0 d/, 'dashes scale too');
});

test('curves: arcs become cubic Béziers (a full circle = 4); ellipses rotate; quadratic → cubic', async () => {
  const doc = new PdfDocument({ created: FIXED });
  const ctx = doc.addPage({ width: 100, height: 100 }).getContext('2d');
  ctx.beginPath(); ctx.arc(50, 50, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(50, 0, 50, 50); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arcTo(50, 0, 50, 50, 10); ctx.stroke();
  const c = contentOf(await doc.save());
  const first = c.split('\nf')[0];
  assert.equal((first.match(/ c\n/g) || []).length + (first.endsWith(' c') ? 1 : 0), 4);
  assert.match(c, /60 50 m/, 'the arc starts at angle 0 (x+r), y flipped about the page');
  assert.ok((c.match(/ c\n?/g) || []).length >= 6);
});

test('transparency: rgba alpha × globalAlpha → an ExtGState; an opaque op after a transparent one resets it', async () => {
  const doc = new PdfDocument({ created: FIXED });
  const p = doc.addPage({ width: 100, height: 100 });
  const ctx = p.getContext('2d');
  ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; ctx.fillRect(0, 0, 10, 10);
  ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 10, 10);
  ctx.fillStyle = 'transparent'; ctx.fillRect(0, 0, 10, 10);   // invisible: not drawn
  const bytes = await doc.save(), c = contentOf(bytes), { s } = parse(bytes);
  assert.match(c, /\/GS0 gs/); assert.match(c, /\/GS1 gs/);
  assert.match(s, /\/ExtGState \/ca 0\.25 \/CA 1/);
  assert.equal((c.match(/\nf/g) || []).length, 2, 'the transparent rect is skipped');
});

test('text: standard fonts from CSS stacks, WinAnsi encoding with substitutions, alignment and baseline', async () => {
  assert.equal(parseFont("11px 'Space Mono', 'JetBrains Mono', Consolas, monospace").name, 'Courier');
  assert.equal(parseFont('bold 16px sans-serif').name, 'Helvetica-Bold');
  assert.equal(parseFont('12px Georgia, serif').name, 'Times-Roman');
  assert.equal(parseFont("10px 'Barlow', system-ui, sans-serif").name, 'Helvetica');
  // italic / oblique pick the standard slanted faces (compo's *italic* markdown); widths as the uprights'
  assert.equal(parseFont('italic 10px sans-serif').name, 'Helvetica-Oblique');
  assert.equal(parseFont('italic bold 10px Barlow, sans-serif').name, 'Helvetica-BoldOblique');
  assert.equal(parseFont('italic 12px Georgia, serif').name, 'Times-Italic');
  assert.equal(parseFont("oblique 11px 'Space Mono', monospace").name, 'Courier-Oblique');
  assert.equal(textWidth('Helvetica-BoldOblique', 10, 'W'), textWidth('Helvetica-Bold', 10, 'W'));
  assert.equal(textWidth('Courier', 10, 'abc'), 18, "Courier is 0.6 em — @gcu/plot's layout advance");
  assert.equal(Math.round(textWidth('Helvetica', 10, 'W') * 100), 944);
  // Greek and the maths signs go to the standard Symbol font, in runs (κ α σ in a stats table, ≥ in a header, → in
  // an attitude); only what neither font has becomes '?'
  const e = encodeRuns('≥ 65 − é σ ☃');
  assert.deepEqual(e.runs.map((r) => [r.symbol, r.text]), [[true, '≥'], [false, ' 65 '], [true, '−'], [false, ' é '], [true, 'σ'], [false, ' ?']]);
  assert.deepEqual([...e.missing], ['☃']);
  assert.equal(textWidth('Helvetica', 10, 'κ'), 5.49, 'a Symbol run measures with Symbol’s widths');

  const warned = [];
  const doc = new PdfDocument({ created: FIXED, onWarn: (m) => warned.push(m) });
  const ctx = doc.addPage({ width: 200, height: 100 }).getContext('2d');
  ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('(a)é', 100, 0);
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('κ = 3.1', 0, 50); ctx.fillText('☃', 0, 60); ctx.fillText('☃☃', 0, 70);
  const bytes = await doc.save(), c = contentOf(bytes), { s } = parse(bytes);
  // centred: 4 chars × 6 = 24 wide → x = 88; 'top': baseline 0.8 em below the anchor → y = 100 − 8
  assert.match(c, /BT 0 Tr 1 0 0 1 88 92 Tm \/F3 10 Tf \(\\\(a\\\)\\351\) Tj ET/);
  assert.match(c, /\/F13 12 Tf \(k\) Tj \/F2 12 Tf \( = 3\.1\) Tj ET/, 'κ in Symbol (its code is “k”), then back to the page’s font');
  assert.match(s, /\/BaseFont \/Courier \/Encoding \/WinAnsiEncoding/);
  assert.match(s, /\/BaseFont \/Symbol >>/, 'Symbol keeps its own built-in encoding');
  assert.equal(warned.filter((w) => /☃/.test(w)).length, 1, 'one warning per missing character set');
});

test('images: RGBA → an RGB XObject with a soft mask for alpha; smoothing → /Interpolate; one object per source', async () => {
  const doc = new PdfDocument({ created: FIXED });
  const p = doc.addPage({ width: 100, height: 100 });
  const ctx = p.getContext('2d');
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]) };
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 10, 10, 20, 10);
  ctx.drawImage(img, 50, 50, 20, 10);                     // the same source: one XObject
  const opaque = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
  ctx.drawImage(opaque, 0, 0);
  const bytes = await doc.save(), { s, objs } = parse(bytes), c = contentOf(bytes);
  const images = Object.values(objs).filter((o) => /\/Subtype \/Image/.test(o.dict));
  assert.equal(images.length, 3, '2 colour images + 1 soft mask');
  assert.match(s, /\/Width 2 \/Height 1 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Interpolate false \/SMask \d+ 0 R/);
  assert.match(c, /q 20 0 0 10 10 80 cm \/Im0 Do Q/, 'the unit square onto the rect, row 0 on top');
  const rgb = zlib.inflateSync(images.find((o) => /SMask/.test(o.dict)).stream);
  assert.deepEqual([...rgb], [255, 0, 0, 0, 255, 0]);
});

test('clip and save/restore nest as q/Q; unsupported canvas features say so once', async () => {
  const warned = [];
  const doc = new PdfDocument({ created: FIXED, onWarn: (m) => warned.push(m) });
  const ctx = doc.addPage({ width: 100, height: 100 }).getContext('2d');
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 50, 50); ctx.clip(); ctx.fillRect(0, 0, 100, 100); ctx.restore();
  ctx.shadowBlur = 4; ctx.shadowBlur = 8;
  const g = ctx.createLinearGradient(0, 0, 1, 1); g.addColorStop(0, '#00ff00'); ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 1);
  ctx.clearRect(0, 0, 100, 100);
  const c = contentOf(await doc.save());
  assert.match(c, /^q\n0 100 m[\s\S]*W n\n[\s\S]*\nf\nQ/);
  assert.match(c, /0 1 0 rg/, 'a gradient draws as its first stop');
  assert.equal(warned.filter((w) => /shadow/.test(w)).length, 1);
  assert.equal(warned.filter((w) => /gradient/.test(w)).length, 1);
});

test('documents: several pages share one font object; sizes in mm; units:"mm" contexts; deterministic bytes', async () => {
  const make = async () => {
    const doc = new PdfDocument({ created: FIXED });
    for (const sz of [['A4'], ['A3', 'landscape']]) { const ctx = doc.addPage(...sz).getContext('2d'); ctx.font = '10px monospace'; ctx.fillText('x', 10, 10); }
    const ctx = doc.addPage([100, 50], null, { units: 'mm' }).getContext('2d');
    ctx.fillRect(10, 10, 10, 10);
    return doc.save();
  };
  const a = await make(), b = await make();
  assert.deepEqual(a, b, 'the same input gives the same bytes');
  const { s, objs } = parse(a);
  assert.match(s, /\/Count 3/);
  assert.equal(Object.values(objs).filter((o) => /\/Type \/Font/.test(o.dict)).length, 1);
  assert.match(s, /\/MediaBox \[0 0 595\.2756 841\.8898\]/);
  assert.match(s, /\/MediaBox \[0 0 1190\.5512 841\.8898\]/);
  const c3 = contentOf(a, 2);
  assert.match(c3, /28\.3465 113\.3858 m/, '10 mm in, 10 mm down on a 50 mm-tall page');
  assert.deepEqual(pageSize('A4', 'landscape').map(Math.round), [842, 595]);
  assert.equal(Math.round(PAGE_SIZES.Letter[0]), 612);
  assert.equal(mm(25.4), 72);
  assert.deepEqual(parseCssColor('#0f08'), { rgb: [0, 1, 0], a: 0x88 / 255 });
});

test('attachments: embedded files listed in the catalog (EmbeddedFiles + /AF), read back', async () => {
  for (const compress of [true, false]) {
    const d = new PdfDocument({ compress, created: '2026-01-01T00:00:00Z' });
    d.addPage();
    d.attach('figure.compo.json', JSON.stringify({ t: 'é → (1)' }), { mime: 'application/json', description: 'the figure' });
    d.attach('(odd) a.txt', new Uint8Array([104, 105]), { mime: 'text/plain', relationship: 'Data' });
    const bytes = await d.save(), s = new TextDecoder('latin1').decode(bytes);
    assert.ok(s.includes('/EmbeddedFiles << /Names [(\\(odd\\) a.txt) '), 'listed, sorted by name');
    assert.match(s, /\(\\\(odd\\\) a\.txt\) \d+ 0 R \(figure\.compo\.json\) \d+ 0 R\]/);
    assert.match(s, /\/AF \[\d+ 0 R \d+ 0 R\]/);
    assert.match(s, /\/AFRelationship \/Data/);
    const at = await readAttachments(bytes);
    assert.deepEqual(at.map((a) => [a.name, a.mime, a.description, new TextDecoder().decode(a.bytes)]),
      [['figure.compo.json', 'application/json', 'the figure', '{"t":"é → (1)"}'], ['(odd) a.txt', 'text/plain', '', 'hi']]);
  }
});
