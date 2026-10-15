// Run the CPython parity corpus through adder, both engines, and sort each case:
//   match     — same stdout, and the same uncaught exception type (or none)
//   mismatch  — anything else: wrong output, a different error, an error CPython didn't raise
// Used by test/python-parity.test.mjs; `node test/python-parity/run.mjs [tree|air] [--all]` prints a report.
import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('golden.json', HERE), 'utf8'));

export function parseCorpus(text) {
  const out = [];
  let name = null, buf = [];
  const flush = () => { if (name) out.push({ name, code: buf.join('\n').replace(/^\n+|\n+$/g, '') + '\n' }); };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('### ')) { flush(); name = line.slice(4).trim(); buf = []; }
    else if (name !== null) buf.push(line);
  }
  flush();
  return out;
}
// `--only=<substring>` narrows the run to matching case names (a debugging aid)
const _only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
export const corpus = parseCorpus(readFileSync(new URL('corpus.txt', HERE), 'utf8')).filter((c) => !_only || c.name.includes(_only));

const A = await import('../../ext/adder/src/index.js');
A.attachAir(await import('../../ext/air/index.js'));

export async function runEngine(engine) {
  const res = {};
  for (const c of corpus) {
    const want = golden.cases[c.name];
    if (!want) { res[c.name] = { status: 'nogolden' }; continue; }
    const out = [];
    let err = null, used = null;
    try {
      await A.run(c.code, { engine, host: false, remote: false, budget: { steps: 2e6, ms: 5000 }, stdout: (s) => out.push(String(s)), onEngine: (e) => { used = e; } });
    } catch (e) {
      err = (e && e.pyType) || (e instanceof SyntaxError ? 'SyntaxError' : (e && e.name) || 'Error');
    }
    const got = out.join('');
    const okOut = got === want.out, okErr = err === want.error;
    res[c.name] = okOut && okErr ? { status: 'match', used } : {
      status: 'mismatch', used,
      why: !okErr ? `error ${err} vs CPython ${want.error}` : 'output',
      got, want: want.out,
    };
  }
  return res;
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const engine = process.argv[2] || 'tree';
  const res = await runEngine(engine === 'air' ? 'auto' : engine);
  const mis = Object.entries(res).filter(([, r]) => r.status === 'mismatch');
  const fell = Object.values(res).filter((r) => r.used === 'tree').length;
  console.log(`${engine}: ${corpus.length - mis.length} match · ${mis.length} MISMATCH (of ${corpus.length})${engine === 'air' ? ` · ${fell} tree-walked` : ''}`);
  for (const [name, r] of mis) {
    console.log(`  ${name.padEnd(28)} ${r.why}`);
    if (process.argv.includes('--all')) {
      console.log(`      got:  ${JSON.stringify(r.got).slice(0, 220)}`);
      console.log(`      want: ${JSON.stringify(r.want).slice(0, 220)}`);
    }
  }
  process.exit(0);
}
