// /project — the model as a live filesystem, driven the way a user (or an agent) will: through a real
// @gcu/vfs and the real geas shell. Reads are made from the model; writes go through the model's own
// methods, so its rules hold (data still drawn can't be deleted; a layer is a view; each change undoes).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VFS } from '../ext/vfs/index.js';
import { createShell } from '../ext/geas/index.js';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { projectFs, toCsv } from '../tools/wuffle/src/project-fs.js';

const TOCHER = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');

async function mk() {
  const p = new Project({ name: 'study' });
  const n1 = p.addDiagram('net');
  const d = p.addDataset(readTable(TOCHER, 'tocher')[0]);
  p.addLayer(n1, d);
  p.clearHistory();
  const vfs = new VFS();
  await vfs.mount('/', { type: 'memory' }); await vfs.mkdir('/home');
  await vfs.mount('/project', projectFs(p, { renderSvg: (id) => `<svg data-diagram="${id}"/>` }));
  let out = '', errs = '';
  const sh = createShell({ vfs, cwd: '/project', stdout: (t) => { out += t; }, stderr: (t) => { errs += t; } });
  const run = async (line) => { out = ''; errs = ''; await sh.exec(line + '\n'); return { out, errs, status: sh.lastStatus }; };
  return { p, d, n1, vfs, run };
}

describe('/project — reading', () => {
  it('the tree: data, diagrams with layers, figures, selection, project.json', async () => {
    const { run } = await mk();
    assert.deepEqual((await run('ls')).out.trim().split(/\s+/), ['data', 'diagrams', 'field', 'figures', 'project.json', 'selection']);
    assert.match((await run('ls data')).out, /tocher\.csv[\s\S]*tocher\.json/);
    assert.match((await run('ls "diagrams/Net 1"')).out, /diagram\.json[\s\S]*layers[\s\S]*net\.svg/);
    assert.match((await run('cat project.json')).out, /"name": "study"[\s\S]*"datasets": 1/);
  });
  it('a layer is a SYMLINK to its data; cat follows it', async () => {
    const { vfs, run } = await mk();
    assert.equal(await vfs.readlink('/project/diagrams/Net 1/layers/tocher.csv'), '../../../data/tocher.csv');
    assert.equal((await vfs.lstat('/project/diagrams/Net 1/layers/tocher.csv')).type, 'symlink');
    const viaLink = (await run('cat "diagrams/Net 1/layers/tocher.csv"')).out, direct = (await run('cat data/tocher.csv')).out;
    assert.equal(viaLink, direct);
    assert.equal(direct.trim().split('\n').length, 201, 'a header and 200 rows');
  });
  it('the shell works over it: grep, wc, head, $(…)', async () => {
    const { run } = await mk();
    assert.equal((await run('tail -n +2 data/tocher.csv | wc -l')).out.trim(), '200');
    assert.match((await run('echo "kind: $(grep -o \'"kind": "[a-z]*"\' data/tocher.json)"')).out, /"kind": "planes"/);
  });
});

describe('/project — writing goes through the model', () => {
  it('a new CSV is new data; writing an existing one replaces its rows (one undo step)', async () => {
    const { p, run } = await mk();
    await run('printf "dd,dip\\n270,40\\n090,10\\n" > data/west.csv');
    const w = p.datasets.find((x) => x.name === 'west');
    assert.ok(w); assert.equal(w.kind, 'planes'); assert.equal(w.rows.length, 2);
    await run('head -n 3 data/west.csv > /home/w.csv; printf "180,5\\n" >> /home/w.csv; cat /home/w.csv > data/west.csv');
    assert.equal(p.dataset(w.id).rows.length, 3);
    p.undo(); assert.equal(p.dataset(w.id).rows.length, 2, 'the replace undoes');
  });
  it('select by writing row numbers; read the selected rows back; rm clears', async () => {
    const { p, d, run } = await mk();
    await run('printf "1\\n3\\n5\\n" > selection/tocher.rows');
    assert.deepEqual(p.selected(d), [0, 2, 4]);
    assert.equal((await run('cat selection/tocher.csv')).out.trim().split('\n').length, 4);
    assert.match((await run('echo 999 > selection/tocher.rows')).errs, /row numbers run 1–200/);
    await run('rm selection/tocher.rows'); assert.deepEqual(p.selected(d), []);
  });
  it('layer settings are JSON: show great circles by writing it', async () => {
    const { p, run } = await mk();
    const L = p.layers[0];
    await run('sed \'s/"greatCircles": {/"greatCircles": {"on": true, "_": {/\' "diagrams/Net 1/layers/tocher.json" > /dev/null');   // sed reads it fine
    const j = JSON.parse((await run('cat "diagrams/Net 1/layers/tocher.json"')).out);
    j.elements.greatCircles.on = true; j.style.color = '#123456';
    await run(`echo '${JSON.stringify(j)}' > "diagrams/Net 1/layers/tocher.json"`);
    assert.equal(p.layer(L.id).elements.greatCircles.on, true); assert.equal(p.layer(L.id).style.color, '#123456');
    p.undo(); assert.equal(p.layer(L.id).elements.greatCircles.on, false, 'one step');
  });
  it('mkdir makes a net; ln -s draws data on it (a view, named by the link); mv moves a layer; rm -r removes the net', async () => {
    const { p, d, run } = await mk();
    await run('mkdir "diagrams/Net 2"');
    const g = p.diagrams.find((x) => x.name === 'Net 2'); assert.ok(g);
    const r = await run('ln -s ../../../data/tocher.csv "diagrams/Net 2/layers/J only.csv"');
    assert.equal(r.status, 0, r.errs);
    const v = p.layersOf(g.id)[0]; assert.equal(v.datasetId, d); assert.equal(v.name, 'J only');
    assert.match((await run('ls "diagrams/Net 2/layers"')).out, /J only\.csv/);
    await run('mkdir "diagrams/Net 3"; mv "diagrams/Net 2/layers/J only.csv" "diagrams/Net 3/layers/"');
    assert.equal(p.layer(v.id).diagramId, p.diagrams.find((x) => x.name === 'Net 3').id);
    await run('rm -r "diagrams/Net 3"');
    assert.equal(p.diagrams.length, 2); assert.equal(p.layer(v.id), null);
    assert.ok(p.dataset(d), 'removing a view never removes the data');
  });
  it('data still drawn refuses to go; once its layers are gone it can', async () => {
    const { p, d, run } = await mk();
    const r = await run('rm data/tocher.csv');
    assert.notEqual(r.status, 0); assert.match(r.errs, /drawn on Net 1/); assert.ok(p.dataset(d));
    await run('rm "diagrams/Net 1/layers/tocher.csv"');
    assert.equal(p.layers.length, 0);
    assert.equal((await run('rm data/tocher.csv')).status, 0); assert.equal(p.dataset(d), null);
  });
  it('renames: mv data, a diagram; read-only things say so', async () => {
    const { p, d, n1, run } = await mk();
    await run('mv data/tocher.csv data/joints.csv'); assert.equal(p.dataset(d).name, 'joints');
    await run('mv "diagrams/Net 1" diagrams/Main'); assert.equal(p.diagram(n1).name, 'Main');
    assert.match((await run('echo x > project.json')).errs, /project.json is JSON/);   // only {"name": …} is writable
    assert.match((await run('rm "diagrams/Main/net.svg"')).errs, /only go with what it belongs to/);
    assert.match((await run('mkdir data/x')).errs, /only a diagram/);
  });
  it('csv round-trips quotes, commas and newlines', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'say "hi"' }, { a: 'two\nlines', b: 3 }]);
    assert.equal(csv, 'a,b\n"x,y","say ""hi"""\n"two\nlines",3\n');
  });
});
