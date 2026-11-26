// wuffle's console language: attitudes, element switches, selections by shape, statistics, derived datasets,
// errors that say what to type, routines.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { createCommands, parseAttitude, tokenize } from '../tools/wuffle/src/commands.js';

const TOCHER = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');
const mk = () => {
  const p = new Project(); p.addDiagram('net');
  const openSample = () => { const id = p.addDataset(readTable(TOCHER, 'tocher')[0]); p.addLayer(p.activeDiagram, id); return id; };
  return { p, c: createCommands({ project: p, openSample }) };
};

describe('parsing', () => {
  it('a plane is dip direction/dip, a line trend→plunge (or >); a dip past 90 is not an attitude', () => {
    assert.deepEqual(parseAttitude('045/30').plane, [45, 30]);
    assert.deepEqual(parseAttitude('045→30').line, [45, 30]);
    assert.deepEqual(parseAttitude('310>70').line, [310, 70]);
    assert.equal(parseAttitude('045/95'), null);
    assert.equal(parseAttitude('NE'), null);
  });
  it('quoted names stay whole', () => assert.deepEqual(tokenize('intersect "east limb" west'), ['intersect', 'east limb', 'west']));
});

describe('commands', () => {
  it('sample, layers, stats', () => {
    const { c } = mk();
    assert.match(c.run('sample tocher').text, /200 planes/);
    assert.match(c.run('layers').text, /tocher · planes · 200/);
    const s = c.run('stats').text;
    assert.match(s, /n 200/); assert.match(s, /mean \d{3}\/\d{2} · pole \d{3}→\d{2}/); assert.match(s, /K \d/);
  });
  it('show / hide / contour switch the layer’s elements', () => {
    const { p, c } = mk(); c.run('sample tocher');
    const L = p.layers[0];
    c.run('show circles'); assert.equal(L.elements.greatCircles.on, true);
    c.run('hide poles'); assert.equal(L.elements.poles.on, false);
    c.run('contour fisher'); assert.equal(L.elements.contours.method, 'fisher'); assert.equal(L.elements.contours.on, true);
    c.run('contour kamb 2'); assert.equal(L.elements.contours.sigma, 2);
    c.run('show eigen'); assert.equal(p.elementState(L.id, 'eigen'), 'on');
  });
  it('select cone / band / + / - / invert / none act on the data', () => {
    const { p, c } = mk(); c.run('sample tocher'); const ds = p.datasets[0].id;
    const r1 = c.run('select cone 150/60 20'); assert.ok(r1.ok, r1.text);
    const n1 = p.selected(ds).length; assert.ok(n1 > 0 && n1 < 200);
    c.run('select + band 090/90 5'); const m = p.selected(ds).length; assert.ok(m >= n1);
    c.run('select invert'); assert.equal(p.selected(ds).length, 200 - m, 'invert: the others');
    c.run('select all'); assert.equal(p.selected(ds).length, 200);
    c.run('select - cone 150/60 20'); assert.equal(p.selected(ds).length, 200 - n1);
    c.run('select none'); assert.equal(p.selected(ds).length, 0);
  });
  it('mean / eigen / beta keep datasets drawn on the diagram; intersect two layers', () => {
    const { p, c } = mk(); c.run('sample tocher');
    assert.match(c.run('mean').text, /tocher · mean \(1 row\), drawn on Net 1/);
    assert.match(c.run('eigen').text, /3 rows/);
    p.addLayer(p.activeDiagram, p.addDataset(readTable('dd,dip\n270,40\n', 'west')[0]));
    assert.match(c.run('intersect tocher west').text, /tocher ∩ west/);
  });
  it('undo / redo: a derived dataset and its layer are one step', () => {
    const { p, c } = mk(); c.run('sample tocher');
    c.run('mean'); assert.equal(p.datasets.length, 2);
    assert.match(c.run('undo').text, /undid derive/); assert.equal(p.datasets.length, 1); assert.equal(p.layers.length, 1);
    assert.match(c.run('redo').text, /redid derive/); assert.equal(p.layers.length, 2);
  });
  it('new / use / diagrams / rotate', () => {
    const { p, c } = mk(); c.run('sample tocher');
    assert.match(c.run('new rose').text, /Rose 1/);
    assert.equal(p.layersOf(p.activeDiagram).length, 1, 'the new diagram carries the views');
    c.run('use net'); assert.equal(p.diagram(p.activeDiagram).kind, 'net');
    assert.match(c.run('rotate 045→30').text, /centered on 045→30/);
    assert.deepEqual(p.diagram(p.activeDiagram).props.rotation, [45, 30]);
    assert.match(c.run('diagrams').text, /● Net 1/);
  });
  it('errors say what to type; unknown commands too; the history and routines replay', () => {
    const { c } = mk(); c.run('sample tocher');
    assert.match(c.run('select cone NE 10').text, /a plane 045\/30 or a line 045→30/);
    assert.match(c.run('show sparkles').text, /show what\?/);
    assert.match(c.run('frobnicate').text, /unknown command/);
    assert.match(c.run('history').text, /sample tocher/);
    const r = c.runAll('# a routine\nshow circles\ncontour kamb 3\nbogus\nstats');
    assert.deepEqual(r.map((x) => x.ok), [true, true, false], 'stops at the first failure');
  });
});
