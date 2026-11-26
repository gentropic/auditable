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
  it('the line editor completes on Tab when asked to', async () => {
    const subs = new Set(); let shown = '';
    const adapter = { write: (t) => { shown += t; }, onInput: (cb) => { subs.add(cb); return () => subs.delete(cb); } };
    const read = makeLineEditor(adapter)({ prompt: '$ ', onComplete: (b) => (b === 'sam' ? { buffer: 'sample ' } : { list: ['a', 'b'] }) });
    for (const cb of subs) cb('sam\t');
    for (const cb of subs) cb('x\r');
    assert.deepEqual(await read, { line: 'sample x' });
  });
});
