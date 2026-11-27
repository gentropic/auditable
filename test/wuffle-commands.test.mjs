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

// ── the 11-26 review's bugs, each with the case that showed it ──
import { orientations } from '../tools/wuffle/src/io.js';
import { rowsInShape } from '../ext/stereonet/index.js';
describe('review fixes (11-26)', () => {
  it('select all / invert count once per dataset, even with two views of it on the net', () => {
    const { p, c } = mk(); const id = c.run('sample').ok && p.datasets[0].id;
    p.addView(p.layersOf(p.activeDiagram)[0].id, p.activeDiagram);          // a second view of tocher on the same net
    assert.equal(p.layersOf(p.activeDiagram).length, 2);
    p.select(id, [0]);
    const r = c.run('select invert');
    assert.equal(p.selected(id).length, 199, 'inverted once (twice was no change)');
    assert.match(r.text, /^199 selected/);
    assert.match(c.run('select all').text, /^200 selected/);
  });
  it('strike, dip and a dip quadrant (030,40,SE) read as planes, the quadrant settling the dip direction', () => {
    const [ds] = readTable('Strike,Dip,DipDir\n030,40,SE\n030,40,NW\n210,30,E\n', 'q');
    assert.equal(ds.kind, 'planes'); assert.equal(ds.roles.quadrant, 'DipDir');
    assert.deepEqual(orientations(ds).map((o) => o.plane), [[120, 40], [300, 40], [120, 30]]);
  });
  it('a shape round a fault’s slip point catches it (the net draws the slip; picking hits it)', () => {
    const D = Math.PI / 180, line = (t, pl) => [Math.sin(t * D) * Math.cos(pl * D), Math.cos(t * D) * Math.cos(pl * D), -Math.sin(pl * D)];
    const data = [{ row: 0, pole: line(270, 30), lineDcos: line(0, 1) }];
    assert.deepEqual(rowsInShape(data, { type: 'cone', axis: line(0, 1), angle: 10 }), [0], 'round the slip point');
    assert.deepEqual(rowsInShape(data, { type: 'cone', axis: line(270, 30), angle: 10 }), [0], 'round the pole, as before');
    assert.deepEqual(rowsInShape(data, { type: 'cone', axis: line(135, 45), angle: 10 }), []);
  });
});

// ── add: attitudes typed in ──
import { parseAdd } from '../tools/wuffle/src/commands.js';
describe('add', () => {
  it('reads every spelling of an attitude the same, and lists as more of them', () => {
    for (const w of [['045/30'], ['045,30'], ['45', '30']]) assert.deepEqual(parseAdd(['p', ...w]).items, [{ plane: [45, 30] }], w.join(' '));
    assert.deepEqual(parseAdd(['l', '120/40', '200,10', '310→5']).items.map((i) => i.line), [[120, 40], [200, 10], [310, 5]]);
    assert.deepEqual(parseAdd(['sc', '120/40', '15']).items, [{ line: [120, 40], angle: 15 }]);
    assert.deepEqual(parseAdd(['f', '045/30', '120/20', 'n', '200/60', '290/10']).items,
      [{ plane: [45, 30], line: [120, 20], sense: 'normal' }, { plane: [200, 60], line: [290, 10], sense: '' }]);
  });
  it('--rhr reads strike / dip; a quadrant after the dip settles it (030/40SE)', () => {
    assert.deepEqual(parseAdd(['p', '030/40', '--rhr']).items[0].plane, [120, 40]);
    assert.deepEqual(parseAdd(['p', '030/40SE']).items[0].plane, [120, 40]);
    assert.deepEqual(parseAdd(['p', '030/40NW']).items[0].plane, [300, 40]);
  });
  it('says what to type when the numbers don\'t fit', () => {
    assert.throws(() => parseAdd(['x', '1/2']), /add p\|l\|sc\|f/);
    assert.throws(() => parseAdd(['p', '045/95']), /dips are 0–90/);
    assert.throws(() => parseAdd(['p', '045/30', '12']), /2 numbers each/);
    assert.throws(() => parseAdd(['sc', '120/40']), /half-angle/);
    assert.throws(() => parseAdd(['l', '120/40', '--colour', 'red']), /unknown flag/);
  });
  it('collects into "typed planes" on the active net — one undo step per add — or --to another dataset', () => {
    const { p, c } = mk();
    let r = c.run('add p 045/30 120/60'); assert.ok(r.ok, r.text);
    const ds = p.datasets.find((d) => d.name === 'typed planes');
    assert.equal(ds.rows.length, 2); assert.ok(p.layersOf(p.activeDiagram).some((L) => L.datasetId === ds.id));
    r = c.run('add p 200/10'); assert.match(r.text, /typed planes · 3 rows/);
    c.run('undo'); assert.equal(p.datasets.find((d) => d.name === 'typed planes').rows.length, 2);
    r = c.run('add l 120/40 --to "west limb"'); assert.match(r.text, /west limb \(new\)/);
    assert.equal(p.datasets.find((d) => d.name === 'west limb').kind, 'lines');
    assert.match(c.run('add p 010/10 --to west').text, /holds lines, not planes/);
  });
  it('a slip line off its plane is said, not refused', () => {
    const { c } = mk();
    const r = c.run('add f 045/30 045/80 r'); assert.ok(r.ok); assert.match(r.text, /off its plane/);
  });
  it('select cone l 150/60 20 reads the attitude as a line', () => {
    const { p, c } = mk(); c.run('add l 150/60 152/58 330/10');
    assert.match(c.run('select cone l 150/60 5').text, /cone: 2 selected/);
  });
});
