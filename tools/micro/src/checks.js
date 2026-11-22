// micro CHECKS and COMPARISONS (routines v2, step 4) — a routine that judges its own results.
//
//   - check: "abs(val.bias_pct) < 5"                    a scalar check over earlier steps' values
//     level: stop                                       stop (default) | warn
//     say: "model within 5% of the declustered samples"
//   - check: { every: "tonnes > 0", in: gt }            each row of a step's table
//   - check: { every: "abs(tonnes / prev.tonnes - 1) < 0.1", in: gt, against: prev }
//                                                       each row joined (on the table's key) to the
//                                                       BASELINE run's row — prev.<column>
//   - compare: gt                                       this run's table beside the baseline's:
//     tolerance: 0.1                                    key · <col> · <col>_prev · <col>_delta · <col>_pct,
//                                                       and (with a tolerance) a check on every |pct|
//
// Names: a step's values are dotted under its `as` (val.bias_pct); the baseline's under prev
// (prev.val.bias_pct). Every name an expression reads is recorded with its value. A check that
// read a BLANK (a missing value, no baseline) is NOT EVALUATED — never a pass — and stops the run
// at level stop (@gcu/expr treats blank = blank as true, so a pass over two blanks would be a lie).
import { compileBool, deps, validate } from '../../../ext/expr/index.js';

const isBlankV = (v) => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
const typeOfV = (v) => (v == null || typeof v === 'number' ? 'number' : 'string');   // a blank is (most likely) a missing number

function compile(src, names, sample) {
  const schema = names.map((n) => ({ name: n, type: typeOfV(sample[n]) }));
  const v = validate(src, schema);
  if (!v.ok) { const e = v.errors[0]; throw new Error(`check "${src}": ${e.message}${e.kind === 'column' ? ` (${names.length ? `have: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}` : 'no step before this check produced values'})` : ''}`); }
  return { fn: compileBool(src, schema, { decimal: '.' }), used: deps(src) };
}

// a scalar check. scope: a flat { 'val.bias_pct': -3.9, 'prev.val.bias_pct': …, … }
export function evalScalarCheck(src, scope) {
  // a baseline value that doesn't exist (no baseline yet, or that step wasn't in it) is a BLANK —
  // the check is "not evaluated", not a typo
  let used0 = []; try { used0 = deps(src); } catch { /* compile() reports it */ }
  scope = { ...scope }; for (const n of used0) if (n.startsWith('prev.') && !(n in scope)) scope[n] = null;
  const names = Object.keys(scope);
  const { fn, used } = compile(src, names, scope);
  const observed = Object.fromEntries(used.map((n) => [n, scope[n] === undefined ? null : scope[n]]));
  if (used.some((n) => isBlankV(scope[n]))) return { status: 'not-evaluated', observed, why: `blank: ${used.filter((n) => isBlankV(scope[n])).join(', ')}` };
  return { status: fn(names.map((n) => scope[n])) ? 'pass' : 'fail', observed };
}

// a table: { columns, rows, key } → rows as objects
const rowObjs = (t) => t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
const keyOf = (t, o) => (t.key || []).map((k) => String(o[k])).join('\u0001');

// every row of `table` (optionally joined to `prevTable` on the key: prev.<col>); outer scope dotted
export function evalEveryCheck(src, table, outer, prevTable) {
  const rows = rowObjs(table), prevBy = prevTable ? new Map(rowObjs(prevTable).map((o) => [keyOf(prevTable, o), o])) : null;
  if (prevTable === null) return { status: 'not-evaluated', why: 'no baseline run to compare with', failing: [] };
  const cols = table.columns, prevCols = prevBy ? prevTable.columns.map((c) => `prev.${c}`) : [];
  const outerNames = Object.keys(outer).filter((n) => !cols.includes(n) && !prevCols.includes(n));
  const names = [...cols, ...prevCols, ...outerNames];
  const sample = { ...outer };
  for (const c of cols) sample[c] = rows.find((o) => typeof o[c] === 'number') ? 0 : '';
  for (const c of prevCols) sample[c] = 0;
  const { fn, used } = compile(src, names, sample);
  const failing = [], blank = [];
  let n = 0;
  for (const o of rows) {
    const po = prevBy ? prevBy.get(keyOf(table, o)) : null;
    const vals = { ...outer, ...o };
    if (prevBy) for (const c of prevTable.columns) vals[`prev.${c}`] = po ? po[c] : null;
    const k = (table.key || []).map((x) => o[x]).join(' · ');
    if (used.some((nm) => isBlankV(vals[nm]))) { blank.push(k); continue; }
    n++;
    if (!fn(names.map((nm) => vals[nm]))) failing.push(k);
  }
  const status = failing.length ? 'fail' : blank.length ? 'not-evaluated' : 'pass';
  return { status, rows: rows.length, evaluated: n, failing: failing.slice(0, 20), failingCount: failing.length, blank: blank.slice(0, 20), blankCount: blank.length };
}

// this run's table beside the baseline's, joined on the key — every numeric column gets its
// previous value, the difference and the relative difference
export function compareTables(cur, prev) {
  const key = cur.key || [];
  const valCols = cur.columns.filter((c) => !key.includes(c) && cur.rows.some((r) => typeof r[cur.columns.indexOf(c)] === 'number'));
  const prevBy = new Map(rowObjs(prev).map((o) => [keyOf(prev, o), o]));
  const columns = [...key, ...valCols.flatMap((c) => [c, `${c}_prev`, `${c}_delta`, `${c}_pct`]), 'in'];
  const rows = [], seen = new Set();
  for (const o of rowObjs(cur)) {
    const k = keyOf(cur, o), po = prevBy.get(k); seen.add(k);
    const row = key.map((x) => o[x]);
    for (const c of valCols) {
      const a = o[c], b = po ? po[c] : null;
      const d = typeof a === 'number' && typeof b === 'number' ? a - b : NaN;
      row.push(a, b == null ? NaN : b, d, Number.isFinite(d) && b !== 0 ? d / b : NaN);
    }
    row.push(po ? 'both' : 'this run');
    rows.push(row);
  }
  for (const [k, po] of prevBy) if (!seen.has(k)) rows.push([...key.map((x) => po[x]), ...valCols.flatMap((c) => [NaN, po[c], NaN, NaN]), 'baseline']);
  return { columns, rows, key, valCols };
}

// a machine TSV (tools.js tableTSV) back into a table; `key` from the record
export function parseTSV(text, key) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.length);
  if (!lines.length) return null;
  const columns = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => l.split('\t').map((c) => (c === '' ? NaN : Number.isFinite(+c) ? +c : c)));
  return { columns, rows, key: key || [] };
}

// a step's values flattened under its name: { 'val.bias_pct': …, … }
export function flatValues(prefix, values, out = {}) {
  for (const [k, v] of Object.entries(values || {})) out[`${prefix}.${k}`] = v;
  return out;
}
