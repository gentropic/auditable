// wuffle's project model: datasets once, layers as hard-linked views per diagram, selection on the data,
// derived datasets with lineage, the nested elements (tri-state), the project file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../tools/wuffle/src/model.js';

const J1 = [{ DD: 45, DIP: 72, SET: 'J1' }, { DD: 48, DIP: 70, SET: 'J1' }, { DD: 41, DIP: 74, SET: 'J1' }];
const mk = () => {
  const p = new Project({ name: 'bench 3' });
  const d = p.addDataset({ name: 'J1', rows: J1, roles: { dipDir: 'DD', dip: 'DIP' } });
  const n1 = p.addDiagram('net'), n2 = p.addDiagram('net');
  const l1 = p.addLayer(n1, d, { style: { color: '#e8836b' } });
  return { p, d, n1, n2, l1 };
};

describe('datasets, diagrams, layers', () => {
  it('a dataset lives once; a diagram gets a default name and properties; the first one is active', () => {
    const { p, d, n1, n2 } = mk();
    assert.equal(p.datasets.length, 1);
    assert.deepEqual(p.diagrams.map((g) => g.name), ['Net 1', 'Net 2']);
    assert.equal(p.diagram(n1).props.projection, 'equal-area');
    assert.equal(p.activeDiagram, n1);
    assert.deepEqual(p.dataset(d).columns, ['DD', 'DIP', 'SET']);
  });
  it('a view is a hard link: same rows, its own styling', () => {
    const { p, d, n2, l1 } = mk();
    const v = p.addView(l1, n2);
    assert.equal(p.layer(v).datasetId, d);
    p.setLayerStyle(v, { color: '#000' });
    assert.equal(p.layer(l1).style.color, '#e8836b', 'styling is per layer');
    p.editRows(d, (rows) => { rows[0].DIP = 80; });
    assert.equal(p.dataset(p.layer(v).datasetId).rows[0].DIP, 80, 'data is shared');
    assert.deepEqual(p.usesOf(d).map((u) => u.diagramName), ['Net 1', 'Net 2']);
  });
  it('moving takes the layer off its diagram; an index places it in the new order', () => {
    const { p, d, n1, n2, l1 } = mk();
    const other = p.addLayer(n2, p.addDataset({ name: 'S0', rows: [{ DD: 150, DIP: 30 }] }));
    p.moveLayer(l1, n2, 0);
    assert.equal(p.layersOf(n1).length, 0);
    assert.deepEqual(p.layersOf(n2).map((l) => l.id), [l1, other]);
    p.moveLayer(l1, n2);
    assert.deepEqual(p.layersOf(n2).map((l) => l.id), [other, l1], 'no index: on top');
    assert.ok(p.dataset(d));
  });
  it('remove from everywhere drops every layer of the dataset and keeps the data', () => {
    const { p, d, n2, l1 } = mk();
    p.addView(l1, n2);
    const gone = p.removeEverywhere(d);
    assert.equal(gone.length, 2);
    assert.equal(p.layers.length, 0);
    assert.ok(p.dataset(d));
  });
  it('removing a dataset still drawn is refused, naming the diagrams; force removes it and its layers', () => {
    const { p, d, n2, l1 } = mk();
    p.addView(l1, n2);
    assert.throws(() => p.removeDataset(d), (e) => /Net 1, Net 2/.test(e.message) && e.uses.length === 2);
    p.removeDataset(d, { force: true });
    assert.equal(p.datasets.length, 0);
    assert.equal(p.layers.length, 0);
  });
  it('removing a diagram removes its layers, never data; the active diagram moves on', () => {
    const { p, d, n1, n2 } = mk();
    p.removeDiagram(n1);
    assert.equal(p.layers.length, 0);
    assert.ok(p.dataset(d));
    assert.equal(p.activeDiagram, n2);
  });
  it('a name already taken gets a suffix', () => {
    const { p } = mk();
    const d2 = p.addDataset({ name: 'J1', rows: [] });
    assert.equal(p.dataset(d2).name, 'J1 (2)');
  });
});

describe('the nested elements', () => {
  it('a planes layer opens into its elements; only the poles start on (faults start with their great circles)', () => {
    const { p, l1 } = mk();
    const t = p.elementTree(l1);
    assert.deepEqual(t.map((e) => e.name), ['poles', 'greatCircles', 'contours', 'mean', 'eigen', 'labels']);
    assert.deepEqual(t.filter((e) => e.state === 'on').map((e) => e.name), ['poles']);
    const n = p.addDiagram('net'), f = p.addLayer(n, p.addDataset({ name: 'F', kind: 'faults', rows: [] }));
    assert.deepEqual(p.elementTree(f).filter((e) => e.state === 'on').map((e) => e.name), ['greatCircles', 'slip']);
    assert.equal(t[4].children.length, 6);
  });
  it('a group is tri-state: some children on → partial; switching the group sets them all', () => {
    const { p, l1 } = mk();
    assert.equal(p.elementState(l1, 'eigen'), 'off');
    p.setElement(l1, 'v1Pole', true);
    assert.equal(p.elementState(l1, 'eigen'), 'partial');
    p.setElement(l1, 'eigen', true);
    assert.equal(p.elementState(l1, 'eigen'), 'on');
    p.setElement(l1, 'eigen', false);
    assert.equal(p.elementState(l1, 'v3Circle'), 'off');
  });
  it('settings live beside the switch; an unknown element is an error', () => {
    const { p, l1 } = mk();
    assert.equal(p.layer(l1).elements.contours.method, 'kamb');
    p.setElementSettings(l1, 'contours', { method: 'fisher', sigma: 2 });
    assert.equal(p.layer(l1).elements.contours.method, 'fisher');
    assert.throws(() => p.setElement(l1, 'slip', true), /no element/);
  });
});

describe('selection belongs to the data', () => {
  it('one selection, seen by every layer of the dataset; modes add / subtract / toggle', () => {
    const { p, d, n2, l1 } = mk();
    p.addView(l1, n2);
    p.select(d, [0, 2]);
    assert.deepEqual(p.selected(d), [0, 2]);
    p.select(d, [1], 'add'); assert.deepEqual(p.selected(d), [0, 1, 2]);
    p.select(d, [0], 'subtract'); assert.deepEqual(p.selected(d), [1, 2]);
    p.select(d, [1, 9], 'toggle'); assert.deepEqual(p.selected(d), [2], 'out-of-range rows are ignored');
  });
  it('a selection becomes a dataset with lineage back to its source', () => {
    const { p, d } = mk();
    p.select(d, [0, 2]);
    const s = p.selectionToDataset(d);
    const ds = p.dataset(s);
    assert.equal(ds.rows.length, 2);
    assert.deepEqual(ds.roles, { dipDir: 'DD', dip: 'DIP' });
    assert.equal(ds.lineage.op, 'selection');
    assert.deepEqual(ds.lineage.sources, [{ id: d, name: 'J1' }]);
    assert.deepEqual(ds.lineage.params.rows, [0, 2]);
  });
  it('editing rows away drops selected indices that no longer exist', () => {
    const { p, d } = mk();
    p.select(d, [0, 2]);
    p.editRows(d, (rows) => rows.slice(0, 1));
    assert.deepEqual(p.selected(d), [0]);
  });
});

describe('figures', () => {
  it('a figure keeps its compo document with the project, and round-trips', () => {
    const { p, n1 } = mk();
    const f = p.addFigure({ doc: { format: 'compo', frames: [{ id: 'x' }] }, from: n1 });
    assert.equal(p.figure(f).name, 'Figure 1');
    p.setFigureDoc(f, { format: 'compo', frames: [] });
    const q = Project.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    assert.deepEqual(q.figure(f).doc, { format: 'compo', frames: [] });
    assert.notEqual(q.addFigure({ doc: {} }), f, 'ids continue');
    p.removeFigure(f); assert.equal(p.figures.length, 0);
  });
});

describe('undo / redo — every change, whoever made it', () => {
  it('a layer added and a style changed undo in turn, and redo', () => {
    const { p, n2, l1 } = mk();
    const v = p.addView(l1, n2);
    p.setLayerStyle(v, { color: '#000' });
    assert.equal(p.undoLabel(), 'style');
    p.undo(); assert.equal(p.layer(v).style.color, '#e8836b', 'the view had its source’s colour');
    p.undo(); assert.equal(p.layer(v), null, 'the view is gone');
    p.redo(); assert.ok(p.layer(v));
    p.redo(); assert.equal(p.layer(v).style.color, '#000');
    assert.equal(p.canRedo(), false);
  });
  it('edits are copy-on-write: undo restores the rows, and the old object was never touched', () => {
    const { p, d } = mk();
    const before = p.dataset(d);
    p.editRows(d, (rows) => { rows[0].DIP = 1; });
    assert.equal(before.rows[0].DIP, 72, 'the old dataset object is untouched');
    p.undo(); assert.equal(p.dataset(d).rows[0].DIP, 72);
    p.renameDataset(d, 'J1 renamed'); p.undo(); assert.equal(p.dataset(d).name, 'J1');
  });
  it('deleting drawn data (forced) undoes with its layers and its selection', () => {
    const { p, d, n2, l1 } = mk();
    p.addView(l1, n2); p.select(d, [1]);
    p.removeDataset(d, { force: true });
    p.undo();
    assert.equal(p.layers.length, 2); assert.ok(p.dataset(d)); assert.deepEqual(p.selected(d), [1]);
  });
  it('a refused change records nothing and changes nothing', () => {
    const { p, d } = mk();
    const n = p._undo.length;
    assert.throws(() => p.removeDataset(d));
    assert.equal(p._undo.length, n); assert.ok(p.dataset(d));
  });
  it('a derived dataset is one step (derive → addDataset inside it); a batch is one step', () => {
    const { p, d, n1 } = mk();
    p.select(d, [0]); const s = p.selectionToDataset(d);
    assert.equal(p.undoLabel(), 'selection → dataset');
    p.undo(); assert.equal(p.dataset(s), null);
    p.batch('open and draw', () => { const x = p.addDataset({ name: 'X', rows: [] }); p.addLayer(n1, x); });
    assert.equal(p.undoLabel(), 'open and draw');
    p.undo(); assert.equal(p.datasets.length, 1); assert.equal(p.layers.length, 1);
  });
  it('rapid repeats of one setting merge into one step; selection is not a step', () => {
    const { p, n1, d } = mk();
    const n = p._undo.length;
    for (let i = 0; i < 20; i++) p.setDiagramProps(n1, { graticule: i + 1 });
    assert.equal(p._undo.length, n + 1);
    p.select(d, [0, 1]); assert.equal(p._undo.length, n + 1);
    p.undo(); assert.equal(p.diagram(n1).props.graticule, 10);
  });
  it('a new change after an undo drops the redo; an unchanged call is not a step', () => {
    const { p, n1, l1 } = mk();
    p.setLayerVisible(l1, false); p.undo(); assert.ok(p.canRedo());
    p.renameDiagram(n1, 'A'); assert.equal(p.canRedo(), false);
    const k = p._undo.length; p.setLayerVisible(l1, true); assert.equal(p._undo.length, k, 'already visible: nothing changed');
  });
  it('undo and redo announce themselves', () => {
    const { p, l1 } = mk(); const seen = [];
    p.on((e) => { if (e.type === 'history') seen.push(`${e.dir}:${e.label}`); });
    p.setLayerVisible(l1, false); p.undo(); p.redo();
    assert.deepEqual(seen, ['undo:show / hide', 'redo:show / hide']);
  });
});

describe('events and the project file', () => {
  it('every change is announced on one stream', () => {
    const { p, d, l1 } = mk();
    const seen = [];
    p.on((e) => seen.push(e.type));
    p.setElement(l1, 'contours', true); p.select(d, [1]); p.renameDataset(d, 'joints J1');
    assert.deepEqual(seen, ['layer-changed', 'selection-changed', 'dataset-changed']);
  });
  it('round-trips through JSON; new ids keep counting; a dangling layer is dropped, not fatal', () => {
    const { p, d, n2, l1 } = mk();
    p.addView(l1, n2); p.select(d, [1]); p.setElement(l1, 'v2Circle', true);
    const j = JSON.parse(JSON.stringify(p.toJSON()));
    const q = Project.fromJSON(j);
    assert.deepEqual(q.toJSON().layers, p.toJSON().layers);
    assert.deepEqual(q.selected(d), [1]);
    assert.equal(q.elementState(l1, 'eigen'), 'partial');
    const nd = q.addDataset({ name: 'new', rows: [] });
    assert.ok(!p.datasets.some((x) => x.id === nd), 'ids continue after the saved ones');
    j.layers.push({ id: 'l99', diagramId: 'n404', datasetId: d, elements: {}, style: {} });
    assert.equal(Project.fromJSON(j).layers.length, 2);
    assert.throws(() => Project.fromJSON({ app: 'other' }), /not a wuffle project/);
  });
});
