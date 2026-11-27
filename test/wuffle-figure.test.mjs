// wuffle figures: a compo page from a net — its frames, a refresh that keeps the layout, and a real vector PDF.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as bearing from '../ext/bearing/index.js';
import { registerKind, exportPDF } from '../ext/compo/index.js';
import { stereonetCore } from '../ext/stereonet/index.js';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { buildFigure, refreshFigure, diagramFrames, staleOf } from '../tools/wuffle/src/figure.js';
import { roseKind, fabricKind } from '../tools/wuffle/src/figure-kinds.js';

registerKind('stereonet', stereonetCore(bearing).compoKind());
registerKind('rose', roseKind(bearing.rose));
registerKind('fabric', fabricKind());
const mk = () => {
  const p = new Project(), n = p.addDiagram('net');
  const d = p.addDataset(readTable(readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8'), 'tocher')[0]);
  const L = p.addLayer(n, d, { style: { color: '#e07a5f' } });
  p.setElement(L, 'contours', true); p.setElement(L, 'mean', true);
  return { p, n, d, L };
};

describe('a figure from a net', () => {
  it('title, the net (its scene as data), legend, statistics and a caption that says what is drawn', () => {
    const { p, n } = mk();
    const doc = buildFigure(p, n);
    assert.deepEqual(doc.frames.map((f) => f.kind), ['text', 'stereonet', 'legend', 'table', 'text']);
    const net = doc.frames[1].content;
    assert.ok(net.scene.primitives.filter((x) => x.type === 'pole').length === 200);
    assert.ok(net.scene.primitives.some((x) => x.type === 'contour'));
    assert.equal(doc.frames[2].content.entries[0].label, 'tocher (200)');
    assert.deepEqual(doc.frames[3].content.columns, ['layer', 'n', 'mean', 'κ', 'α95 °', 'K', 'V3']);
    assert.ok(doc.frames[2].content.entries.some((e) => e.swatch === 'line' && /Kamb, 2σ steps/.test(e.label)), 'the contour key');
    assert.match(doc.frames[4].content.md, /Equal-area \(Schmidt\), lower hemisphere · Kamb contours at 2σ intervals \(k = 3\)/);
  });
  it('a selection on the net is not printed', () => {
    const { p, n, d } = mk(); p.select(d, [0, 1, 2]);
    const poles = buildFigure(p, n).frames[1].content.scene.primitives.filter((x) => x.type === 'pole');
    assert.ok(poles.every((x) => x.style.fill === '#e07a5f'));
  });
  it('refresh makes the frames again from the net, keeping their boxes and the user’s own frames', () => {
    const { p, n, L } = mk();
    const doc = buildFigure(p, n);
    doc.frames[1].box = [40, 30, 120, 120];
    doc.frames.push({ id: 'mine', kind: 'text', box: [1, 1, 5, 5], content: { md: 'my note' } });
    p.setElement(L, 'contours', false);
    const next = refreshFigure(p, doc, n);
    assert.deepEqual(next.frames[1].box, [40, 30, 120, 120]);
    assert.ok(!next.frames[1].content.scene.primitives.some((x) => x.type === 'contour'));
    assert.equal(next.frames.at(-1).content.md, 'my note');
  });
  it('exports a vector PDF', async () => {
    const { p, n } = mk();
    const bytes = await exportPDF(buildFigure(p, n), { title: 'tocher', creator: 'wuffle' });
    const head = new TextDecoder().decode(bytes.slice(0, 8));
    assert.match(head, /^%PDF-/);
    assert.ok(bytes.length > 5000, `${bytes.length} bytes`);
  });
  it('a rose and a fabric plot make figures too — drawn from data, so the PDF has them as vectors', async () => {
    const { p, d } = mk();
    const r = p.addDiagram('rose'); p.addLayer(r, d);
    const fb = p.addDiagram('fabric'); p.addLayer(fb, d);
    const rd = buildFigure(p, r), fd = buildFigure(p, fb);
    assert.equal(rd.frames[1].kind, 'rose'); assert.equal(rd.frames[1].content.azimuths.length, 200);
    assert.deepEqual(rd.frames[3].content.columns, ['layer', 'n', 'mean', 'R̄']);
    assert.match(rd.frames[4].content.md, /Rose diagram of strike \(both ends counted\), 10° sectors/);
    assert.equal(fd.frames[1].kind, 'fabric'); assert.equal(fd.frames[1].content.points.length, 1);
    assert.deepEqual(fd.frames[3].content.columns, ['layer', 'n', 'S1', 'S2', 'S3', 'K', 'C', 'shape']);
    for (const doc of [rd, fd]) { const bytes = await exportPDF(doc, { title: 't' }); assert.ok(bytes.length > 3000); }
  });
  it('a girdle (K < 1) says to read V3, not the mean', () => {
    const p = new Project(), n = p.addDiagram('net');
    const rows = []; for (let a = 0; a < 360; a += 12) rows.push({ dipdir: a, dip: 85 - (a % 7) });   // poles round a great circle
    const d = p.addDataset({ name: 'girdle', kind: 'planes', rows, roles: { dipDir: 'dipdir', dip: 'dip' }, notation: 'dd' }); p.addLayer(n, d);
    const st = buildFigure(p, n).frames[3].content;
    assert.match(st.rows[0][2], / \*$/); assert.match(st.note, /K < 1, a girdle: read V3/);
  });
  it('another diagram onto a page: its frames in free space; refresh makes each again from ITS diagram', () => {
    const { p, n, d, L } = mk();
    const r = p.addDiagram('rose'); p.addLayer(r, d);
    const full = buildFigure(p, n);
    assert.equal(diagramFrames(p, full, r).crowded, true, 'a full page says so (the frames land on top)');
    const doc = buildFigure(p, n); doc.frames[1].box = [12, 26, 100, 100];   // room made, as a person would
    const fs = diagramFrames(p, doc, r);
    assert.deepEqual(fs.map((f) => f.kind), ['rose', 'legend', 'table']); assert.equal(fs.crowded, false);
    const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    for (const f of fs) for (const o of doc.frames) assert.ok(!overlap(f.box, o.box) || fs.length === 0, `${f.id} on ${o.id}`);
    doc.frames.push(...fs);
    p.setDiagramProps(r, { bins: 30 }); p.setElement(L, 'contours', false);
    const next = refreshFigure(p, doc);
    assert.equal(next.frames.find((f) => f.kind === 'rose').content.binWidth, 30, 'the rose from the rose');
    assert.ok(!next.frames.find((f) => f.kind === 'stereonet').content.scene.primitives.some((x) => x.type === 'contour'), 'the net from the net');
  });
  it('a net frame keeps its own view (source.view) through a refresh; a changed diagram makes a frame stale', () => {
    const { p, n, L } = mk();
    const doc = buildFigure(p, n), net = doc.frames[1];
    net.source.view = { hemisphere: 'upper', graticule: 30 };
    const next = refreshFigure(p, doc);
    assert.equal(next.frames[1].content.net.hemisphere, 'upper'); assert.equal(next.frames[1].content.net.graticule, 30);
    assert.equal(staleOf(p, next.frames[1]), null, 'fresh');
    p.setElement(L, 'contours', false);
    assert.equal(staleOf(p, next.frames[1]).text, 'older data');
    assert.equal(staleOf(p, next.frames[2]), null, 'a legend is never flagged (it may be yours)');
  });
});
