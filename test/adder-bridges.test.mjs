// The adder bridges as a non-notebook host uses them (line-attach-spec.md §4; the same
// for learn, scitra and natra): attach the library, register the bridge, run — in Node
// with no `window`. And every bridge loads as a CLASSIC script inside a worker with no
// syntax error (no top-level await) and no request (golem's worker concatenates them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { run, registerModule, unregisterModule } = await import('../ext/adder/src/index.js');
const SANDBOX = { host: false, remote: false };

test('line attaches from the host; np.mean([…]) works as the FIRST call', async () => {
  const lineLib = await import('../ext/line/index.js');
  const { vecAdder, attachLine } = await import('../ext/line/adder.js');
  assert.throws(() => attachLine({}), TypeError);
  attachLine(lineLib);
  attachLine(lineLib);                                      // twice is harmless
  registerModule('line', vecAdder);
  try {
    const r = await run('import line as np\ny = np.mean([1, 2, 3])\nn = np.linalg.norm([3, 4])', SANDBOX);
    assert.equal(Number(r.y), 2);
    assert.equal(Number(r.n), 5);
  } finally { unregisterModule('line'); }
});

test('learn attaches from the host', async () => {
  const learnLib = await import('../ext/learn/index.js');
  const { learnAdder, attachLearn, learnReady } = await import('../ext/learn/adder.js');
  await learnReady;
  assert.throws(() => attachLearn({}), TypeError);
  attachLearn(learnLib);
  registerModule('learn', learnAdder);
  try {
    const r = await run('from learn.preprocessing import StandardScaler\nfrom learn import Pipeline\nok = StandardScaler is not None and Pipeline is not None', SANDBOX);
    assert.equal(r.ok, true);
  } finally { unregisterModule('learn'); }
});

test('every bridge loads as a classic script in a worker: no syntax error, no request', () => {
  for (const f of ['line', 'learn', 'scitra', 'natra']) {
    const src = fs.readFileSync(new URL(`../ext/${f}/adder.js`, import.meta.url), 'utf8')
      .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
      .replace(/^export (async function|function|const|let|class) /gm, '$1 ');
    let requests = 0;
    // a worker has importScripts; import( is routed to a counter so a load-time request shows
    const body = 'const importScripts = () => {};\n' + src.replace(/\bimport\(/g, '__imp(');
    const fn = new Function('__imp', body);                // a top-level await is a SyntaxError here
    fn(() => { requests++; return Promise.reject(new Error('no request expected')); });
    assert.equal(requests, 0, `${f} made a request at load`);
  }
});
