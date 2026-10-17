// CPython's own test suite against adder.
//   node test/cpython-suite/drive.mjs [--engine=auto|tree] [--timeout=s] [--jobs=n] [--list=core] [mod …]
// For each test module: run it under CPython (the reference — some tests are platform-specific
// or skip there; its results are cached in results/cpython/) and under adder; record every
// test's status in results/<engine>/<mod>.json; print how many of the tests CPython passes adder
// passes too, and why a module stopped early (import error, crash, timeout).
// Needs the tests: node test/cpython-suite/fetch.mjs (a sparse checkout of CPython's Lib/test at
// the tag matching the local `python`).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, 'cpython', 'Lib');
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const engine = opt('engine', 'auto');
const timeout = Number(opt('timeout', 180)) * 1000;
const jobs = Number(opt('jobs', 6));
const list = opt('list', null);
let mods = args.filter((a) => !a.startsWith('--'));
if (list) mods = mods.concat(readFileSync(join(HERE, `modules-${list}.txt`), 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
if (!existsSync(LIB)) { console.error('no CPython tests: run node test/cpython-suite/fetch.mjs first'); process.exit(1); }
const outDir = join(HERE, 'results', engine);
mkdirSync(outDir, { recursive: true });
const template = readFileSync(join(HERE, 'runner.py'), 'utf8');

function run(cmd, argv, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { ...opts, windowsHide: true });
    let out = '', timedOut = false;
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    const t = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeout);
    p.on('close', () => { clearTimeout(t); resolve({ out, timedOut }); });
  });
}

function parse({ out, timedOut }) {
  const tests = {};
  let last = null, done = false, fatal = null;
  for (const line of out.split(/\r?\n/)) {
    const [tag, id, ...rest] = line.split(' ');
    if (tag === 'START') { last = id; if (!tests[id]) tests[id] = { s: 'HANG' }; }
    else if (tag === 'PASS') { if (tests[id] && tests[id].s === 'HANG') tests[id] = { s: 'PASS' }; }
    else if (tag === 'FAIL' || tag === 'ERROR') tests[id] = { s: tag, m: rest.join(' ') };
    else if (tag === 'SUBFAIL') { if (!tests[id] || tests[id].s !== 'ERROR') tests[id] = { s: rest[0], m: rest.slice(1).join(' ') }; }
    else if (tag === 'SKIP') tests[id] = { s: 'SKIP', m: rest.join(' ') };
    else if (tag === 'DONE') done = true;
    else if (tag === 'IMPORTERROR' || tag === 'LOADERROR' || (tag === 'ERR' && !fatal)) fatal = `${tag} ${[id, ...rest].join(' ')}`;
  }
  // a test that started and never ended: the module crashed or hit the timeout in it
  return { tests, done, fatal: fatal || (!done ? (timedOut ? 'TIMEOUT' : 'CRASH') + (last ? ` in ${last}` : '') : null) };
}

// a package `test` with what a module needs: test/__init__, test/support, the helper modules
// tests import (list_tests, seq_tests, …), and the module (or package) itself
function stage(mod) {
  const root = join(HERE, 'stage', mod), dir = join(root, 'test');
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(LIB, 'test', '__init__.py'), join(dir, '__init__.py'));
  cpSync(join(LIB, 'test', 'support'), join(dir, 'support'), { recursive: true });
  for (const f of readdirSync(join(LIB, 'test'))) if (f.endsWith('.py') && !f.startsWith('test_')) cpSync(join(LIB, 'test', f), join(dir, f));
  const f = join(LIB, 'test', mod + '.py'), d = join(LIB, 'test', mod);
  if (existsSync(f)) cpSync(f, join(dir, mod + '.py'));
  else if (existsSync(d) && statSync(d).isDirectory()) cpSync(d, join(dir, mod), { recursive: true });
  const script = join(root, 'runner.py');
  writeFileSync(script, template.replace('__MODULE__', mod));
  return { root, dir, script };
}

async function one(mod) {
  const { root, dir, script } = stage(mod);
  const refFile = join(HERE, 'results', 'cpython', mod + '.json');
  let ref;
  if (existsSync(refFile)) ref = JSON.parse(readFileSync(refFile, 'utf8'));
  else {
    ref = parse(await run('python', [script], { env: { ...process.env, PYTHONPATH: root, PYTHONIOENCODING: 'utf-8' }, cwd: root }));
    mkdirSync(join(HERE, 'results', 'cpython'), { recursive: true });
    writeFileSync(refFile, JSON.stringify(ref, null, 1));
  }
  const res = parse(await run('node', [join(HERE, 'run-adder.mjs'), script, engine, dir], { cwd: HERE }));
  writeFileSync(join(outDir, mod + '.json'), JSON.stringify(res, null, 1));
  const refPass = Object.entries(ref.tests).filter(([, t]) => t.s === 'PASS').map(([k]) => k);
  const both = refPass.filter((k) => res.tests[k] && res.tests[k].s === 'PASS').length;
  return { mod, refPass: refPass.length, both, fatal: res.fatal, refFatal: ref.fatal };
}

const queue = [...mods];
const results = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const m = queue.shift();
    const r = await one(m);
    results.push(r);
    const pct = r.refPass ? ((100 * r.both) / r.refPass).toFixed(0) : '-';
    console.log(`${m.padEnd(28)} ${String(r.both).padStart(5)}/${String(r.refPass).padEnd(5)} ${String(pct).padStart(3)}%  ${r.fatal ? r.fatal.slice(0, 90) : ''}${r.refFatal ? '  [cpython: ' + r.refFatal.slice(0, 60) + ']' : ''}`);
  }
}));
const tot = results.reduce((a, r) => [a[0] + r.both, a[1] + r.refPass], [0, 0]);
console.log(`TOTAL ${tot[0]}/${tot[1]} (${((100 * tot[0]) / Math.max(1, tot[1])).toFixed(1)}%) over ${results.length} modules [${engine}]`);
