// The BUILT geas bundle, not src/: the tests next door import src/, where a lazy `import('./parser.js')`
// has a file to find. In the bundle it didn't, so $(…), eval and word expansion threw — in Works'
// terminal, the geas tool and anything else that ships the bundle. The build now rewrites those imports
// to the bundle's own namespace; this runs the artifact to keep it that way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createShell, makeLineEditor } from '../ext/geas/index.js';

const run = async (line) => {
  let out = '';
  const sh = createShell({ stdout: (t) => { out += t; }, stderr: (t) => { out += t; } });
  await sh.exec(line + '\n');
  return out;
};

describe('the built geas bundle', () => {
  it('command substitution', async () => assert.equal(await run('echo $(echo sub)'), 'sub\n'));
  it('eval', async () => assert.equal(await run('eval echo ev'), 'ev\n'));
  it('nested substitution in a string', async () => assert.equal(await run('x=$(echo a); echo "[$x $(echo b)]"'), '[a b]\n'));
  it('extra builtins override and extend', async () => {
    let out = '';
    const sh = createShell({ stdout: (t) => { out += t; }, builtins: { hello: async (argv, ctx) => { await ctx.stdout(`hi ${argv.slice(1).join(' ')}\n`); return 0; } } });
    await sh.exec('hello a b | tr a-z A-Z\n');
    assert.equal(out, 'HI A B\n');
  });
  it('tail -n +K starts at line K (POSIX); -n K is the last K', async () => {
    assert.equal(await run('printf "h\\n1\\n2\\n3\\n" | tail -n +2'), '1\n2\n3\n');
    assert.equal(await run('printf "h\\n1\\n2\\n3\\n" | tail -n 2'), '2\n3\n');
  });
  it('grep -o prints each match on its own line', async () => {
    assert.equal(await run('printf "a1b22\\nc\\n" | grep -o "[0-9]*[0-9]"'), '1\n22\n');
    assert.equal(await run('printf "a1\\nb\\n" | grep -on "[0-9]"'), '1:1\n');
  });
  it('ln -s makes a symlink (into a directory: by the target\'s name); rm -r goes through vfs.rm', async () => {
    const { VFS } = await import('../ext/vfs/index.js');
    const vfs = new VFS(); await vfs.mount('/', { type: 'memory' });
    await vfs.mkdir('/d'); await vfs.writeFile('/d/f.txt', 'x');
    let out = ''; const sh = createShell({ vfs, cwd: '/', stdout: (t) => { out += t; }, stderr: (t) => { out += t; } });
    await sh.exec('ln -s ../d/f.txt /d/g.txt; mkdir /e; ln -s /d/f.txt /e\n');
    assert.equal(await vfs.readlink('/d/g.txt'), '../d/f.txt'); assert.equal(await vfs.readlink('/e/f.txt'), '/d/f.txt');
    let rmCalls = 0; const rm = vfs.rm.bind(vfs); vfs.rm = (p, o) => { rmCalls++; return rm(p, o); };
    await sh.exec('rm -r /d\n');
    assert.equal(rmCalls, 1); assert.equal(await vfs.exists('/d'), false);
    out = ''; await sh.exec('ln /e/f.txt /x\n'); assert.match(out, /only symbolic links/);
  });
  it('Tab completion may answer later (a Promise) — and is dropped if the line changed meanwhile', async () => {
    const subs = new Set();
    const adapter = { write: () => {}, onInput: (cb) => { subs.add(cb); return () => subs.delete(cb); } };
    const send = (t) => { for (const cb of subs) cb(t); };
    const read = makeLineEditor(adapter)({ onComplete: async (b) => ({ buffer: b === 'ca' ? 'cat data/' : b + 'X' }) });
    send('ca\t'); await new Promise((r) => setTimeout(r, 0));
    send('z\t'); send('!');                       // typed before the second answer came: it must not apply
    await new Promise((r) => setTimeout(r, 0));
    send('\r');
    assert.deepEqual(await read, { line: 'cat data/z!' });
  });
  it('the line editor completes on Tab when asked to', async () => {
    const subs = new Set(); let shown = '';
    const adapter = { write: (t) => { shown += t; }, onInput: (cb) => { subs.add(cb); return () => subs.delete(cb); } };
    const read = makeLineEditor(adapter)({ prompt: '$ ', onComplete: (b) => (b === 'sam' ? { buffer: 'sample ' } : { list: ['a', 'b'] }) });
    for (const cb of subs) cb('sam\t');
    for (const cb of subs) cb('x\r');
    assert.deepEqual(await read, { line: 'sample x' });
  });
});
