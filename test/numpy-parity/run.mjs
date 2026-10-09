// Run the numpy-parity corpus through an adder bridge registered as `numpy`, normalise
// each answer with the same norm.py real numpy went through, and sort every case:
//   match     — same value / shape / kind (numbers within 1e-9 relative, 1e-12 absolute)
//   raised    — the bridge refused (a missing call is fine: "match or raise")
//   mismatch  — it ran and differs: a SILENT difference, which the rule forbids
// Used by test/numpy-parity.test.mjs; `node test/numpy-parity/run.mjs [line|natra]` prints a report.
import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url);
const corpus = JSON.parse(readFileSync(new URL('corpus.json', HERE), 'utf8'));
const golden = JSON.parse(readFileSync(new URL('golden.json', HERE), 'utf8'));
const NORM = readFileSync(new URL('norm.py', HERE), 'utf8');

const { run, registerModule, unregisterModule } = await import('../../ext/adder/src/index.js');

export const BRIDGES = {
  async line() {
    const lib = await import('../../ext/line/index.js');
    const { vecAdder, attachLine } = await import('../../ext/line/adder.js');
    attachLine(lib);
    return vecAdder;
  },
  async natra() {
    const lib = await import('../../ext/natra/index.js');
    const { natraAdder, attachNatra } = await import('../../ext/natra/adder.js');
    try { attachNatra(lib); } catch { /* already initialised in this process */ }
    return natraAdder;
  },
};

const num = (x) => (x === 'nan' ? NaN : x === 'inf' ? Infinity : x === '-inf' ? -Infinity : x);
function close(a, b) {
  a = num(a); b = num(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= 1e-12 + 1e-9 * Math.abs(b);
}
function deepClose(a, b) {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && a.every((x, i) => deepClose(x, b[i]));
  return close(a, b);
}
// why `got` differs from `want`, or null when it matches
export function diff(got, want) {
  if (got.t !== want.t) return `type: ${got.t} vs numpy ${want.t}`;
  switch (want.t) {
    case 'arr':
      if (JSON.stringify(got.shape) !== JSON.stringify(want.shape)) return `shape ${JSON.stringify(got.shape)} vs ${JSON.stringify(want.shape)}`;
      if (want.kind === 'bool' && got.kind !== 'bool') return `kind ${got.kind} vs bool`;
      if (got.kind === 'bool' && want.kind !== 'bool' && want.kind !== 'empty') return `kind bool vs ${want.kind}`;
      return deepClose(got.v, want.v) ? null : `values ${JSON.stringify(got.v).slice(0, 80)} vs ${JSON.stringify(want.v).slice(0, 80)}`;
    case 'seq':
      if (got.v.length !== want.v.length) return `length ${got.v.length} vs ${want.v.length}`;
      for (let i = 0; i < want.v.length; i++) { const d = diff(got.v[i], want.v[i]); if (d) return `[${i}] ${d}`; }
      return null;
    case 'error': return null;
    default:
      return (want.t === 'num' ? close(got.v, want.v) : got.v === want.v) ? null : `${JSON.stringify(got.v).slice(0, 80)} vs ${JSON.stringify(want.v).slice(0, 80)}`;
  }
}

function toPlain(v) {
  if (v instanceof Map) { const o = {}; v.forEach((x, k) => { o[k] = toPlain(x); }); return o; }
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = toPlain(v[k]); return o; }
  return v;
}

export async function runBridge(name) {
  const bridge = await BRIDGES[name]();
  registerModule('numpy', bridge);
  const out = {};
  try {
    for (const c of corpus.cases) {
      const want = golden.cases[c.id];
      if (!want) { out[c.id] = { status: 'nogolden' }; continue; }
      const code = `${NORM}\nimport numpy as np\n${c.code}\n_out = _norm(r)\n`;
      try {
        const r = await run(code, { host: false, remote: false, budget: { steps: 500000, ms: 10000 }, stdout: () => {} });
        if (want.t === 'error') { out[c.id] = { status: 'mismatch', why: `numpy raised ${want.v}, the bridge returned a value` }; continue; }
        const got = toPlain(r._out);
        const why = diff(got, want);
        out[c.id] = why ? { status: 'mismatch', why } : { status: 'match' };
      } catch (e) {
        out[c.id] = { status: want.t === 'error' ? 'match' : 'raised', why: String(e.message || e).split('\n')[0].slice(0, 120) };
      }
    }
  } finally { unregisterModule('numpy'); }
  return out;
}

export { corpus, golden };

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const name = process.argv[2] || 'line';
  const res = await runBridge(name);
  const by = { match: [], raised: [], mismatch: [] };
  for (const [id, r] of Object.entries(res)) (by[r.status] || (by[r.status] = [])).push([id, r.why]);
  console.log(`${name}: ${by.match.length} match · ${by.raised.length} raised · ${by.mismatch.length} MISMATCH (of ${corpus.cases.length})`);
  for (const [id, why] of by.mismatch) console.log(`  MISMATCH ${id.padEnd(24)} ${why}`);
  if (process.argv.includes('--raised')) for (const [id, why] of by.raised) console.log(`  raised   ${id.padEnd(24)} ${why}`);
  process.exit(0);
}
