// wuffle — CALCULATED COLUMNS and expressions over a dataset's rows, in @gcu/expr (the language micro and lamina
// use: no eval, so it runs under the page's strict CSP). Pure.
//
// A calculated column is a FORMULA kept with the dataset (meta.calc: [{ name, expr }], in order — a later one may use
// an earlier one) and its VALUES written into the rows, so everything else (the table, contours, joins, export) just
// sees a column. The model recomputes them whenever the rows change.
//
// Besides the dataset's own columns an expression can read each row's attitude as wuffle read it — virtual columns
// that need no column of that name in the file (a real column of the same name wins):
//   dipdir dip strike (planes; strike by the right-hand rule) · pole_trend pole_plunge · trend plunge (lines; a
//   fault's slip) · rake (a fault's slip on its plane, 0–180 from the strike)

import { compileValue, compileBool, validate } from '../../../ext/expr/index.js';
import { conversions } from '../../../ext/bearing/index.js';
import { orientations } from './io.js';

export const ATTITUDE_COLUMNS = ['dipdir', 'dip', 'strike', 'pole_trend', 'pole_plunge', 'trend', 'plunge', 'rake'];
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const DEG = Math.PI / 180;

function attitudeOf(o) {
  const a = {}; if (!o) return a;
  if (o.plane) {
    a.dipdir = r3(o.plane[0]); a.dip = r3(o.plane[1]); a.strike = r3((o.plane[0] + 270) % 360);
    const pl = conversions.dcosToLine(o.pole); a.pole_trend = r3(pl[0]); a.pole_plunge = r3(pl[1]);
  }
  if (o.line) { a.trend = r3(((o.line[0] % 360) + 360) % 360); a.plunge = r3(o.line[1]); }
  if (o.plane && o.lineDcos) {                              // the rake: the slip's angle from the strike, in the plane
    const s = (o.plane[0] - 90) * DEG, st = [Math.sin(s), Math.cos(s), 0], l = o.lineDcos;
    const c = st[0] * l[0] + st[1] * l[1] + st[2] * l[2]; a.rake = r3(Math.acos(Math.max(-1, Math.min(1, c))) / DEG);   // (the slip points down: 0–180)
  }
  return a;
}

/** the names an expression over this dataset may use, in order: its columns, then the attitude ones it hasn't */
export function schemaOf(ds) {
  const cols = [...ds.columns];
  for (const v of ATTITUDE_COLUMNS) if (!cols.includes(v)) cols.push(v);
  return cols;
}
/** each row as fields in schemaOf's order (the attitudes computed once) */
function fieldsOf(ds, rows = ds.rows) {
  const os = orientations({ ...ds, rows }), cols = schemaOf(ds);
  return rows.map((row, i) => { const at = attitudeOf(os[i]); return cols.map((c) => (c in row ? (row[c] === '' ? null : row[c]) : (at[c] ?? null))); });
}
/** a readable error for an expression over this dataset, or null when it's fine */
export function checkExpr(ds, expr) {
  const v = validate(String(expr), schemaOf(ds));
  if (v.ok) return null;
  const e = v.errors[0] || {};
  return e.kind === 'unknown-column' || /unknown column/i.test(e.message || '') ? `${e.message} — the columns are ${schemaOf(ds).join(', ')}` : (e.message || 'not an expression');
}
const cleanValue = (v) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);

/** one expression's value for every row (throws, saying what's wrong) */
export function evaluateExpr(ds, expr, rows = ds.rows) {
  const err = checkExpr(ds, expr); if (err) throw new Error(err);
  const fn = compileValue(String(expr), schemaOf(ds), { decimal: '.' });
  return fieldsOf(ds, rows).map((f) => cleanValue(fn(f)));
}
/** the rows where an expression is true (a filter: blank counts as false) */
export function rowsWhere(ds, expr) {
  const err = checkExpr(ds, expr); if (err) throw new Error(err);
  const fn = compileBool(String(expr), schemaOf(ds), { decimal: '.' });
  const out = []; fieldsOf(ds).forEach((f, i) => { if (fn(f)) out.push(i); });
  return out;
}
/** the rows with every calculated column made again, in order (a formula that no longer reads — a column renamed
 *  away — leaves its column blank rather than stopping the rest). → { rows, columns, broken: [names] } */
export function recalc(ds) {
  const calc = (ds.meta && ds.meta.calc) || []; if (!calc.length) return { rows: ds.rows, columns: ds.columns, broken: [] };
  let cur = { ...ds, rows: ds.rows.map((r) => ({ ...r })), columns: [...ds.columns] }; const broken = [];
  for (const { name, expr } of calc) {
    if (!cur.columns.includes(name)) cur.columns.push(name);
    let vals;
    try { vals = evaluateExpr({ ...cur, columns: cur.columns.filter((c) => c !== name) }, expr); } catch { vals = null; broken.push(name); }
    cur.rows.forEach((r, i) => { r[name] = vals ? vals[i] : ''; });
  }
  return { rows: cur.rows, columns: cur.columns, broken };
}
