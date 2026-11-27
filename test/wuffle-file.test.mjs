// .zip.wuffle — the /project tree, zipped. The files are the project: what is written reads back the same,
// a hand edit to a file inside reads as edited, and what is broken is skipped with a warning, not refused.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createZipStreamWriter, openZipRanged, bytesSource } from '../ext/archive/src/zipstream.js';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { writeProject, readProject, isZip, projectEntries } from '../tools/wuffle/src/project-file.js';

const TOCHER = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');

function mk() {
  const p = new Project({ name: 'Serra study' });
  const n1 = p.addDiagram('net', { props: { projection: 'equal-angle' } });
  const r1 = p.addDiagram('rose', { name: 'Strikes' });
  const d = p.addDataset(readTable(TOCHER, 'tocher')[0]);
  const w = p.addDataset({ name: 'west/limb', kind: 'lines', rows: [{ tr: 270, pl: 40, note: 'a, "quoted" one' }], columns: ['tr', 'pl', 'note'], roles: { trend: 'tr', plunge: 'pl' } });
  const l1 = p.addLayer(n1, d, { style: { color: '#123456' } });
  p.setElement(l1, 'contours', true); p.setElementSettings(l1, 'contours', { method: 'fisher' });
  const l2 = p.addLayer(n1, w, { name: 'west only' }); p.setLayerVisible(l2, false);
  p.addLayer(r1, d);
  p.select(d, [0, 1]);
  const m = p.derive({ name: 'tocher · mean', rows: [{ dd: 10, dip: 20 }], roles: { dipDir: 'dd', dip: 'dip' }, op: 'mean', sources: [d] });
  p.addLayer(n1, m);
  p.addFigure({ name: 'Net 1 · figure', doc: { pages: [{ frames: [] }], v: 1 }, from: n1 });
  p.setActive(r1);
  return { p, d, w, n1, r1 };
}

describe('.zip.wuffle', () => {
  it('is a zip of the /project tree (plain CSV inside), plus home/', async () => {
    const { p } = mk();
    const bytes = await writeProject(p, { home: [{ path: '/home/notes.txt', bytes: new TextEncoder().encode('hi') }] });
    assert.ok(isZip(bytes));
    const z = await openZipRanged(bytesSource(bytes));
    const names = z.list().map((e) => e.name).sort();
    for (const n of ['project.json', 'data/tocher.csv', 'data/tocher.json', 'data/west∕limb.csv', 'diagrams/Net 1/diagram.json', 'diagrams/Net 1/layers/tocher.json',
      'diagrams/Net 1/layers/west only.json', 'diagrams/Strikes/layers/tocher.json', 'figures/Net 1 · figure.compo.json', 'home/notes.txt']) assert.ok(names.includes(n), n);
    assert.ok(!names.some((n) => /\.(svg|pdf)$|^selection\/.*\.csv$/.test(n)), 'nothing computed is stored');
    assert.ok(names.includes('selection/tocher.rows'), 'the selection is');
    assert.match(new TextDecoder().decode(await z.bytes(z.entries.get('data/tocher.csv'))).split('\n')[0], /,/);
  });
  it('reads back the same project: data, roles, lineage, diagrams and their order, layers, styles, figures, active', async () => {
    const { p } = mk();
    const { project: q, home, warnings } = await readProject(await writeProject(p, { home: [{ path: '/home/a/b.txt', bytes: new Uint8Array([1, 2, 3]) }] }));
    assert.deepEqual(warnings, []);
    assert.equal(q.name, 'Serra study');
    assert.deepEqual(q.datasets.map((x) => x.name), p.datasets.map((x) => x.name));
    assert.deepEqual(q.diagrams.map((x) => [x.name, x.kind]), p.diagrams.map((x) => [x.name, x.kind]));
    const T = q.datasets.find((x) => x.name === 'tocher'), P = p.datasets.find((x) => x.name === 'tocher');
    assert.deepEqual(T.columns, P.columns); assert.deepEqual(T.roles, P.roles); assert.equal(T.rows.length, 200);
    assert.deepEqual(T.rows[7], P.rows[7]);
    const W = q.datasets.find((x) => x.name === 'west/limb');
    assert.equal(W.kind, 'lines'); assert.equal(W.rows[0].note, 'a, "quoted" one');
    assert.equal(q.datasets.find((x) => x.name === 'tocher · mean').lineage.op, 'mean');
    assert.equal(q.diagram(q.diagrams[0].id).props.projection, 'equal-angle');
    const n1 = q.diagrams[0].id, ls = q.layersOf(n1);
    assert.deepEqual(ls.map((l) => l.name || q.dataset(l.datasetId).name), ['tocher', 'west only', 'tocher · mean'], 'draw order kept');
    assert.equal(ls[0].style.color, '#123456'); assert.equal(ls[0].elements.contours.method, 'fisher'); assert.equal(ls[0].elements.contours.on, true);
    assert.equal(ls[1].visible, false);
    assert.equal(q.figures[0].from, n1, 'a figure knows its diagram');
    assert.equal(q.diagram(q.activeDiagram).name, 'Strikes');
    assert.deepEqual(q.selected(q.datasets[0].id), [0, 1], 'the selection belongs to the data: kept');
    assert.equal(q.canUndo(), false, 'a loaded project starts a fresh history');
    assert.deepEqual([...home[0].bytes], [1, 2, 3]); assert.equal(home[0].path, '/home/a/b.txt');
  });
  it('the files are the truth: a hand edit inside the zip reads as edited', async () => {
    const { p } = mk();
    const entries = projectEntries(p);
    entries.set('data/tocher.csv', entries.get('data/tocher.csv').split('\n').slice(0, 11).join('\n') + '\n');   // keep 10 rows
    entries.set('data/extra.csv', 'dd,dip\n100,20\n');                                                       // files added by hand,
    entries.set('data/lin.csv', 'trend,plunge\n250,12\n');                                                     // with no .json beside them
    const chunks = []; const zw = createZipStreamWriter({ write: async (b) => { chunks.push(b.slice()); } });
    for (const [k, v] of entries) await zw.add(k, v);
    await zw.finish();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    const { project: q } = await readProject(bytes);
    assert.equal(q.datasets.find((x) => x.name === 'tocher').rows.length, 10);
    // read the way File → Open reads them (their headers sniffed), not as planes with no roles that draw nothing
    const extra = q.datasets.find((x) => x.name === 'extra'), lin = q.datasets.find((x) => x.name === 'lin');
    assert.equal(extra.kind, 'planes'); assert.deepEqual(extra.roles, { dipDir: 'dd', dip: 'dip' });
    assert.equal(lin.kind, 'lines'); assert.deepEqual(lin.roles, { trend: 'trend', plunge: 'plunge' });
  });
  it('a layer whose data is missing is skipped with a warning; a non-project zip is refused clearly', async () => {
    const { p } = mk();
    const entries = projectEntries(p); entries.delete('data/west∕limb.csv');
    const chunks = []; const zw = createZipStreamWriter({ write: async (b) => { chunks.push(b.slice()); } });
    for (const [k, v] of entries) await zw.add(k, v);
    await zw.finish();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    const { project: q, warnings } = await readProject(bytes);
    assert.equal(q.layersOf(q.diagrams[0].id).length, 2);
    assert.match(warnings.join(' '), /west only\.json: its data/);
    const other = []; const zo = createZipStreamWriter({ write: async (b) => { other.push(b.slice()); } }); await zo.add('a.txt', 'x'); await zo.finish();
    await assert.rejects(readProject(other[0].length ? new Uint8Array(other.flatMap((c) => [...c])) : new Uint8Array()), /not a wuffle project/);
  });
});

describe('formulas and tables travel with the project', () => {
  it('a calculated column comes back as a formula (still live), a table as a table', async () => {
    const p = new Project({ name: 'calc' }); const n = p.addDiagram('net');
    const id = p.addDataset(readTable(TOCHER, 'tocher')[0]); p.addLayer(n, id);
    p.setCalc(id, 'steep', 'dip > 60');
    p.addDataset(readTable('station,lith\n1,granite\n', 'stations')[0]);
    const { project: q } = await readProject(await writeProject(p));
    const T = q.datasets.find((x) => x.name === 'tocher');
    assert.deepEqual(T.meta.calc, [{ name: 'steep', expr: 'dip > 60' }]);
    assert.deepEqual(T.rows.map((r) => r.steep), p.dataset(id).rows.map((r) => r.steep));
    q.editRows(T.id, (rows) => { rows[0][T.roles.dip] = 89; });
    assert.equal(q.dataset(T.id).rows[0].steep, true, 'the formula is live after loading');
    assert.equal(q.datasets.find((x) => x.name === 'stations').kind, 'table');
  });
});
