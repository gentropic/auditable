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

// ── batch 5: slopes and folds ──
import { kinematicAnalysis, foldAnalysis, fitSmallCircle } from '../tools/wuffle/src/stats.js';
import * as BB from '../ext/bearing/index.js';
describe('kinematic analysis, folds, cones', () => {
  const planes = (rows) => ({ name: 't', kind: 'planes', rows: rows.map(([dd, dip]) => ({ dd, dip })), roles: { dipDir: 'dd', dip: 'dip' }, notation: 'dd', columns: ['dd', 'dip'] });
  it('Markland: each mode tested on the attitudes (face 180/60, φ 30)', () => {
    const r = kinematicAnalysis(planes([[180, 45], [180, 20], [180, 70], [0, 80], [135, 60], [225, 60]]), { face: [180, 60], phi: 30 });
    assert.match(r.rows[0], /planar/, 'out of the face, under it, over φ');
    assert.equal(r.rows[1], '', 'below the friction angle'); assert.equal(r.rows[2], '', 'steeper than the face: does not daylight');
    assert.equal(r.rows[3], 'toppling', 'steep, into the slope');
    assert.match(r.rows[4], /wedge/); assert.match(r.rows[5], /wedge/);
    assert.throws(() => kinematicAnalysis(planes([[1, 1]]), { face: [180, 0] }), /dip above 0/);
  });
  it('kinematic: a column on the data, the face and the friction cone drawn, one undo step', () => {
    const { p, c } = mk(); c.run('sample');
    const r = c.run('kinematic 300/65 --phi 30'); assert.ok(r.ok, r.text); assert.match(r.text, /planar +\d+/);
    assert.ok('kinematic' in p.datasets[0].rows[0]);
    assert.ok(p.datasets.some((d) => d.kind === 'smallcircles' && d.rows[0].angle === 60), 'the friction cone: 90 − φ about the vertical');
    c.run('undo'); c.run('undo'); assert.equal(p.datasets.length, 1); assert.ok(!('kinematic' in p.datasets[0].rows[0]));
  });
  it('fold: the interlimb angle across the hinge, Fleuty\'s names (the steeper bisector as the axial plane)', () => {
    const near = (rows) => rows.flatMap(([dd, dip]) => [-2, 0, 2].map((e) => [dd + e, dip + e / 2]));
    const a = foldAnalysis(planes(near([[90, 40], [270, 60]])));
    assert.ok(Math.abs(a.interlimb - 80) < 1.5, `${a.interlimb}`); assert.equal(a.tightness, 'open'); assert.equal(a.plunge, 'horizontal');
    assert.ok(Math.abs(a.axis[1]) < 3 && (Math.abs(a.axis[0]) < 3 || Math.abs(a.axis[0] - 180) < 3 || Math.abs(a.axis[0] - 360) < 3), `axis ${a.axis}`);
    const g = foldAnalysis(planes(near([[90, 10], [270, 10]]))); assert.ok(Math.abs(g.interlimb - 160) < 1.5); assert.equal(g.tightness, 'gentle'); assert.equal(g.attitude, 'upright');
    const t = foldAnalysis(planes(near([[90, 80], [270, 85]]))); assert.equal(t.tightness, 'tight');
  });
  it('cone: a small circle found wherever its axis is, narrow or wide', () => {
    for (const [tr, pl, h] of [[30, 40, 50], [200, 75, 25], [100, 5, 70]]) {
      const ax = BB.conversions.lineToDcos(tr, pl), o = Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let k = [ax[1] * o[2] - ax[2] * o[1], ax[2] * o[0] - ax[0] * o[2], ax[0] * o[1] - ax[1] * o[0]]; const kn = Math.hypot(...k); k = k.map((v) => v / kn);
      const ph = BB.conversions.rotateDcos(ax, k, h), dirs = []; for (let a = 0; a < 360; a += 20) dirs.push(BB.conversions.rotateDcos(ph, ax, a));
      const r = fitSmallCircle(dirs);
      assert.ok(Math.abs(r.axis[0] - tr) < 1 && Math.abs(r.axis[1] - pl) < 1 && Math.abs(r.angle - h) < 1, `${tr}/${pl}/${h} → ${JSON.stringify(r)}`);
    }
  });
});

// ── calculated columns, tables, joins, select where ──
describe('calc, tables, joins', () => {
  it('calc: a formula kept with the data, its values in the rows, made again when the rows change; refused cleanly', () => {
    const { p, c } = mk(); c.run('add p 045/30 120/60 --to M');
    const id = p.datasets.find((d) => d.name === 'M').id;
    assert.match(c.run("calc cls = if(dip > 50, 'steep', 'flat')").text, /\(flat, steep\)/);
    assert.deepEqual(p.dataset(id).meta.calc, [{ name: 'cls', expr: "if(dip > 50, 'steep', 'flat')" }]);
    c.run('add p 300/80 --to M');
    assert.equal(p.dataset(id).rows[2].cls, 'steep', 'a new row gets the formula');
    assert.match(c.run('calc pt = pole_trend').text, /225, 300, 120/, 'attitude columns: the pole of 045/30 trends 225');
    assert.match(c.run('calc x = nope + 1').text, /unknown column: nope/);
    assert.match(c.run('calc dip = 1').text, /a column of the data/, 'a formula never overwrites measurements');
    c.run('calc --drop cls'); assert.ok(!p.dataset(id).columns.includes('cls'));
    c.run('undo'); assert.ok(p.dataset(id).columns.includes('cls'), 'one undo step');
  });
  it('a file with no attitudes is a TABLE: never drawn, joinable; coordinates are not read as dip direction / dip', () => {
    const [t] = readTable('station,x,y,lith\n1,350100,7800200,granite\n2,350300,7800400,schist\n', 'stations');
    assert.equal(t.kind, 'table');
    const [q] = readTable('a,b\n120,40\n200,30\n', 'q'); assert.equal(q.kind, 'planes', 'two plausible numbers are still read as planes');
    const { p } = mk(); const id = p.addDataset(t);
    assert.throws(() => p.addLayer(p.activeDiagram, id), /is a table/);
  });
  it('join: a left join by key, as a new dataset — unmatched and duplicated keys said; a clashing name kept apart', () => {
    const { p, c } = mk();
    c.run('add p 045/30 120/60 200/10 --to M'); c.run('calc stn = round(dipdir / 100)');
    const [t] = readTable('station,lith,dip\n1,granite,x\n2,schist,y\n2,dup,z\n', 'stations'); p.addDataset(t);
    const r = c.run('join M stations on stn=station').text;
    assert.match(r, /2 of 3 matched/); assert.match(r, /no stations row for 0/); assert.match(r, /1 key twice in stations/);
    const j = p.datasets.at(-1); assert.equal(j.lineage.op, 'join'); assert.equal(j.kind, 'planes');
    assert.deepEqual(j.rows.map((x) => x.lith), ['', 'granite', 'schist']);
    assert.ok(j.columns.includes('dip (stations)'), 'the table\'s "dip" kept apart from the measurement\'s');
    assert.match(c.run('join M stations on nope').text, /has no column “nope”/);
  });
  it('select where: an expression over the rows of everything on the net', () => {
    const { p, c } = mk(); c.run('sample');
    const r = c.run('select where dip > 80 and pole_plunge < 10');
    assert.match(r.text, /^where .*: \d+ of 200 selected/);
    const n = p.selected(p.datasets[0].id).length; assert.ok(n > 0 && n < 200);
    assert.match(c.run('select where bogus = 1').text, /unknown column: bogus/);
  });
});

describe('a rose weighted by a column', () => {
  it('weight <column>: sectors sum it (a long trace counts for more); off counts again; only numeric columns', async () => {
    const { roseMarkup } = await import('../tools/wuffle/src/diagram-svg.js');
    const { buildFigure } = await import('../tools/wuffle/src/figure.js');
    const { p, c } = mk();
    const id = p.addDataset({ name: 'traces', kind: 'lines', rows: [{ trend: 10, plunge: 0, length: 50 }, { trend: 100, plunge: 0, length: 1 }, { trend: 102, plunge: 0, length: 1 }], roles: { trend: 'trend', plunge: 'plunge' }, notation: 'dd' });
    c.run('new rose'); const g = p.diagram(p.activeDiagram); p.addLayer(g.id, id); p.setDiagramProps(g.id, { quantity: 'trend' });
    assert.match(c.run('weight nope').text, /no numeric column “nope”/);
    assert.match(c.run('weight length').text, /weighted by length/);
    assert.equal(p.diagram(g.id).props.weight, 'length');
    assert.ok(roseMarkup(p, p.diagram(g.id)).weighted);
    const fig = buildFigure(p, g.id), rose = fig.frames.find((f) => f.kind === 'rose');
    assert.deepEqual(rose.content.weights, [50, 1, 1]); assert.match(fig.frames.find((f) => f.source.wuffle === 'caption').content.md, /weighted by length/);
    c.run('weight off'); assert.equal(p.diagram(g.id).props.weight, null);
  });
});

describe('contouring faults', () => {
  it('a fault layer contours its poles, or its slip lines (--of slip); an old layer without the element gets it', async () => {
    const { sceneLayers } = await import('../tools/wuffle/src/layers.js');
    const { stereonetCore } = await import('../ext/stereonet/index.js');
    const { p, c } = mk();
    c.run('add f 090/60 090/60 n 092/62 092/62 n 088/58 088/58 n 270/30 270/30 r');
    const L = p.layersOf(p.activeDiagram)[0];
    delete p.layer(L.id).elements.contours;                      // as a layer saved before faults had contours
    assert.match(c.run('contour kamb --of slip').text, /of the slip lines/);
    const core = stereonetCore(BB), s = core.buildScene({ layers: sceneLayers(p, p.activeDiagram) });
    const cont = s.primitives.find((q) => q.type === 'contour'); assert.ok(cont, 'contoured');
    const slip = sceneLayers(p, p.activeDiagram)[0].data[0].lineDcos;
    assert.deepEqual(cont.dcos[0], slip, 'the slip lines, not the poles');
    c.run('contour kamb --of poles');
    assert.deepEqual(core.buildScene({ layers: sceneLayers(p, p.activeDiagram) }).primitives.find((q) => q.type === 'contour').dcos[0], sceneLayers(p, p.activeDiagram)[0].data[0].pole);
  });
});

describe('how a dataset is read, set by hand', () => {
  it('columns: a wrong guess corrected — the kind, the roles, the notation; its layers follow; one undo step', () => {
    const { p, c } = mk();
    const [g] = readTable('a,b,c\n30,40,SE\n210,30,E\n', 'quad');      // the reader sees strike / dip / quadrant
    const id = p.addDataset(g); p.addLayer(p.activeDiagram, id);
    assert.match(c.run('columns quad').text, /quad · planes/);
    // say: a is a DIP DIRECTION, b the dip (ignore the letters)
    assert.match(c.run('columns quad planes dipdir=a dip=b').text, /2 of 2 rows read/);
    assert.deepEqual(orientations(p.dataset(id)).map((o) => o.plane), [[30, 40], [210, 30]]);
    assert.equal(p.dataset(id).meta.read.guessed, false);
    // as lines: the layer gets a lines layer's elements
    c.run('columns quad lines trend=a plunge=b');
    assert.ok('points' in p.layersOf(p.activeDiagram)[0].elements && !('poles' in p.layersOf(p.activeDiagram)[0].elements));
    // as a table: it comes off the net
    c.run('columns quad table'); assert.equal(p.layersOf(p.activeDiagram).length, 0);
    c.run('undo'); assert.equal(p.dataset(id).kind, 'lines'); assert.equal(p.layersOf(p.activeDiagram).length, 1);
    assert.match(c.run('columns quad planes dipdir=nope dip=b').text, /has no column “nope”/);
  });
});
