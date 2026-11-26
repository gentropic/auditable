// wuffle figures: a compo page from a net — its frames, a refresh that keeps the layout, and a real vector PDF.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as bearing from '../ext/bearing/index.js';
import { registerKind, exportPDF } from '../ext/compo/index.js';
import { stereonetCore } from '../ext/stereonet/index.js';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { buildFigure, refreshFigure } from '../tools/wuffle/src/figure.js';

registerKind('stereonet', stereonetCore(bearing).compoKind());
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
    assert.deepEqual(doc.frames[3].content.columns, ['layer', 'n', 'mean', 'κ', 'α95 °', 'K']);
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
  it('only nets make figures (for now)', () => {
    const { p } = mk(); const r = p.addDiagram('rose');
    assert.throws(() => buildFigure(p, r), /figures are made from nets/);
  });
});
