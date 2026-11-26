// fixes found writing the wuffle manual's second round: a project can be named (and the name undone), the net
// says when a layer is too small to contour, and a dihedra field on an upper-hemisphere net is reflected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Project } from '../tools/wuffle/src/model.js';
import { readTable } from '../tools/wuffle/src/io.js';
import { projectFs } from '../tools/wuffle/src/project-fs.js';
import { VFS } from '../ext/vfs/index.js';
import { createShell } from '../ext/geas/index.js';
import * as B from '../ext/bearing/index.js';
import { stereonetCore } from '../ext/stereonet/src/main.js';

const TOCHER = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8');

describe('naming a project', () => {
  it('renameProject is one undo step, and undo puts the old name back', () => {
    const p = new Project();
    assert.equal(p.name, 'untitled');
    p.renameProject('  Serra do Mar  ');
    assert.equal(p.name, 'Serra do Mar'); assert.equal(p.undoLabel(), 'rename project');
    p.renameProject('   '); assert.equal(p.name, 'Serra do Mar', 'a blank name changes nothing');
    p.undo(); assert.equal(p.name, 'untitled');
    p.redo(); assert.equal(p.name, 'Serra do Mar');
  });
  it('/project/project.json takes {"name": …}; anything else is refused with the reason', async () => {
    const p = new Project({ name: 'study' });
    p.addDataset(readTable(TOCHER, 'tocher')[0]);
    const vfs = new VFS(); await vfs.mount('/', { type: 'memory' });
    await vfs.mount('/project', projectFs(p));
    let errs = '';
    const sh = createShell({ vfs, cwd: '/project', stdout: () => {}, stderr: (t) => { errs += t; } });
    await sh.exec(`echo '{"name": "Serra"}' > project.json\n`);
    assert.equal(p.name, 'Serra');
    await sh.exec(`echo '{"datasets": 9}' > project.json\n`);
    assert.match(errs, /write \{"name": "…"\}/); assert.equal(p.name, 'Serra');
  });
});

describe('what the net says it skipped', () => {
  const core = stereonetCore(B);
  const layer = (n) => ({ id: 'L1', kind: 'planes', color: '#000', elements: { contours: { on: true } },
    data: Array.from({ length: n }, (_, row) => ({ row, plane: [120, 40], pole: B.conversions.planeToDcos(120, 40) })) });
  it('a layer with fewer than three measurements: no contours, and a note saying why', () => {
    const s = core.buildScene({ layers: [layer(2)] });
    assert.equal(s.primitives.filter((p) => p.type === 'contour').length, 0);
    assert.match(s.notes.join(' '), /has 2 measurements — contours need three/);
    assert.deepEqual(core.buildScene({ layers: [layer(3)] }).notes, []);
  });
});
