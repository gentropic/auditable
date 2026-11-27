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

describe('statistics of the selection', () => {
  it('stats --selection: the selected rows only; nothing selected says so', () => {
    const { p, c } = mk(); c.run('sample');
    assert.match(c.run('stats --selection').text, /nothing selected/);
    c.run('select cone 150/60 20');
    const r = c.run('stats --selection'), whole = c.run('stats');
    assert.match(r.text, /^tocher · selection · n \d+ of 200/);
    const k = (t) => +t.match(/κ ([\d.]+)/)[1];
    assert.ok(k(r.text) > k(whole.text), 'a cone round the cluster is tighter than the whole');
  });
});

// ── batch 5: filled contours, your levels, Terzaghi ──
import { sceneLayers } from '../tools/wuffle/src/layers.js';
import { terzaghiWeights } from '../tools/wuffle/src/stats.js';
describe('contours and weights', () => {
  it('contour kamb --filled --levels 6,2,4: the bands and your levels, one undo step', () => {
    const { p, c } = mk(); c.run('sample');
    const r = c.run('contour kamb --filled --levels 6,2,4');
    assert.ok(r.ok, r.text); assert.match(r.text, /filled at 2, 4, 6/);
    const E = p.layersOf(p.activeDiagram)[0].elements.contours;
    assert.equal(E.filled, true); assert.deepEqual(E.levels, [2, 4, 6]); assert.equal(E.on, true);
    const was = p.layersOf(p.activeDiagram)[0].elements.contours;
    c.run('undo'); const back = p.layersOf(p.activeDiagram)[0].elements.contours;
    assert.ok(!back.filled && !back.levels, `undone in one step: ${JSON.stringify(back)} (was ${JSON.stringify(was)})`);
  });
  it('terzaghi: 1/cos θ to the line, capped; the weights reach the contours; off unweights; one undo step', () => {
    const { p, c } = mk(); c.run('sample');
    const id = p.datasets[0].id;
    const w = terzaghiWeights(p.dataset(id), [0, 90]);              // a vertical borehole
    const ds = p.dataset(id), i = ds.rows.findIndex((r) => +r[ds.roles.dip] < 10), j = ds.rows.findIndex((r) => +r[ds.roles.dip] > 85);
    assert.ok(w[i] < 1.02, 'a flat plane, crossed square: weight ~1'); assert.ok(w[j] > 5, 'a steep plane, nearly parallel to the hole: heavy');
    assert.ok(w.every((x) => x == null || x <= 10));
    const r = c.run('terzaghi 000/90'); assert.ok(r.ok, r.text); assert.match(r.text, /Terzaghi weights/);
    assert.equal(p.dataset(id).roles.weight, 'terzaghi_w');
    assert.ok(sceneLayers(p, p.activeDiagram)[0].data.every((d) => typeof d.weight === 'number'));
    assert.match(c.run('terzaghi off').text, /unweighted/); assert.equal(p.dataset(id).roles.weight, undefined);
    c.run('undo'); assert.equal(p.dataset(id).roles.weight, 'terzaghi_w', 'undo puts the weight back');
    c.run('undo'); assert.equal(p.dataset(id).roles.weight, undefined); assert.ok(!p.dataset(id).columns.includes('terzaghi_w'), 'the column goes with it');
  });
});

// ── batch 5, the data turned and the statistics that ask questions ──
describe('turning data, sets, tests, rakes', () => {
  const lines = (p, rows) => p.addDataset({ name: 'L', kind: 'lines', rows, roles: { trend: 'trend', plunge: 'plunge' }, notation: 'dd' });
  it('turn, untilt and declination: new datasets with lineage, other columns kept', () => {
    const { p, c } = mk(); const L = lines(p, [{ trend: 0, plunge: 30, note: 'x' }]); p.addLayer(p.activeDiagram, L);
    assert.match(c.run('declination L 10').text, /true north \(\+10\.00°\)/);
    const d = p.datasets.at(-1); assert.deepEqual([d.rows[0].trend, d.rows[0].plunge, d.rows[0].note], [10, 30, 'x']); assert.equal(d.lineage.op, 'declination');
    c.run('turn L about 000/90 90'); assert.equal(p.datasets.at(-1).rows[0].trend, 90, 'clockwise looking down the axis');
    const P = p.addDataset({ name: 'P', kind: 'planes', rows: [{ dd: 120, dip: 40 }, { dd: 120, dip: 70 }], roles: { dipDir: 'dd', dip: 'dip' }, notation: 'dd' }); p.addLayer(p.activeDiagram, P);
    c.run('untilt P 120/40'); const u = p.datasets.at(-1).rows;
    assert.equal(u[0].dip, 0, 'the bedding itself flat'); assert.equal(u[1].dip, 30);
    assert.match(c.run('declination L --at -20,-44 --date 2026-01-01').text, /WMM2025 at -20, -44 on 2026-01-01/);
  });
  it('sets: a set column, S1 the largest; k given or chosen; reproducible', () => {
    const { p, c } = mk(); c.run('sample');
    const r1 = c.run('sets 2').text, r2 = c.run('sets 2').text;
    assert.equal(r1, r2, 'the same answer each time'); assert.match(r1, /2 sets/);
    const ds = p.datasets[0]; assert.equal(ds.roles.set, 'set');
    const n = (s) => ds.rows.filter((r) => r.set === s).length; assert.ok(n('S1') >= n('S2') && n('S1') + n('S2') === 200);
    assert.match(c.run('sets').text, /chosen by BIC/);
  });
  it('compare: Watson says two different clusters differ, and one split in halves does not', () => {
    const { p, c } = mk();
    c.run('add p 045/30 047/32 043/29 046/31 044/33 --to A'); c.run('add p 135/60 137/62 133/59 136/61 --to B'); c.run('add p 046/30 045/32 044/31 045/29 --to C');
    assert.match(c.run('compare A B').text, /their means differ/);
    assert.match(c.run('compare A C').text, /one mean could serve both/);
  });
  it('stats: the ellipse, Bingham uniformity, a bootstrap cone when asked', () => {
    const { c } = mk(); c.run('sample');
    const t = c.run('stats --bootstrap 200').text;
    assert.match(t, /95 % ellipse [\d.]+° × [\d.]+°/); assert.match(t, /uniformity \(Bingham\): p < 0\.001 — a preferred orientation/); assert.match(t, /bootstrap cone [\d.]+° \(200 resamplings\)/);
  });
  it('lineations: every plane of one against every plane of the other', () => {
    const { p, c } = mk(); c.run('add p 090/30 --to A'); c.run('add p 000/30 --to B');
    assert.match(c.run('lineations A B').text, /A ∩ B \(1 row\)/);
    const r = p.datasets.at(-1).rows[0]; assert.ok(Math.abs(r.trend - 45) < 0.5 && Math.abs(r.plunge - 22.2) < 0.5, JSON.stringify(r));
  });
  it('a fault by its rake: typed (r35) and read from a rake column', () => {
    assert.deepEqual(parseAdd(['f', '090/60', 'r90', 'n']).items[0].line, [90, 60], 'rake 90: down the dip');
    assert.deepEqual(parseAdd(['f', '090/60', 'r0']).items[0].line, [0, 0], 'rake 0: along the strike (right-hand rule)');
    assert.throws(() => parseAdd(['f', 'r35', '090/60']), /after a fault's plane/);
    const [ds] = readTable('dd,dip,rake,sense\n090,60,90,n\n', 'f');
    assert.equal(ds.kind, 'faults'); assert.equal(ds.roles.rake, 'rake');
    assert.deepEqual(orientations(ds)[0].line.map((x) => Math.round(x)), [90, 60]);
  });
});
