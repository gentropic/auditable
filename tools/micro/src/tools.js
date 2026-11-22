// micro TOOLS — the contract every automatable analysis registers once (routines v2, step 2;
// spec_inbox/micro-routines-v2-spec.md). A tool is
//
//   { label, params: <schema>, outputs: { key }, scan(params, ctx) → state, shape(state, params) → result }
//
// scan does the reading (streamed, cancellable, the slow part); shape is PURE and instant — the
// window re-shapes live from the same state when a cutoff or a band moves, and the routine runner,
// the composer and the host API call scan + shape directly: one implementation per tool, no window.
//
// The params schema is the single source for validation (an unknown setting is an ERROR naming the
// nearest real one — never silently ignored), the generated docs and the from-scratch form.
// A shaped result: { table: { columns, rows, key, units }, values, resolved, warnings } — `resolved`
// is the params with every automatic value pinned (cutoffs chosen from the data, …), so a re-run,
// a run record and a comparison all see the same numbers.
import { S, layerById } from './state.js';
import { layerTableHeader, schemaExt } from './records.js';
import { numericColsOf, computeResourceTable } from './analysis.js';
import { validationRun } from './validation.js';
import { gradeUnitFactor, niceStep, scopeMask, scopeMissing } from './analysis-ui.js';
import { gtCuts } from './scanner.js';
import { scanGTSeries, gtRows } from './gt.js';
import { statsScan } from './stats.js';
import { scanSwath, swathRows } from './swath.js';
import { validate } from '../../../ext/expr/index.js';

export const TOOLS = new Map();
export function registerTool(name, def) { TOOLS.set(name, { name, ...def }); }
export const toolDef = (name) => TOOLS.get(name) || null;

// ── the schema ────────────────────────────────────────────────────────────────────────────────────
// { type, default, doc, required, display, values (enum), item (list of objects), routine }
//   type: layer | column | expr | number | int | numbers | string | enum | bool | list | object | any
//   display: true — accepted (windows save it) but not part of what the tool computes; dropped
//   from the resolved params
//   routine: 'required' — a routine must state it (an automatic value moves with the data, and a
//   comparison against last month would match nothing); or a list of the values a routine allows
const lev = (a, b) => {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
  return d[m][n];
};
export function nearest(word, names) {
  let best = null, bd = Infinity;
  for (const n of names) { const d = lev(word, n); if (d < bd) { bd = d; best = n; } }
  return best && bd <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function checkValue(spec, v, path, errs) {
  const bad = (why) => errs.push(`${path}: ${why}`);
  switch (spec.type) {
    case 'layer': case 'column': case 'string': if (typeof v !== 'string') bad(`expects text, got ${JSON.stringify(v)}`); break;
    case 'expr': if (typeof v !== 'string' && typeof v !== 'number') bad(`expects an expression, got ${JSON.stringify(v)}`); break;
    case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) bad(`expects a number, got ${JSON.stringify(v)}`); break;
    case 'int': if (!Number.isInteger(v)) bad(`expects a whole number, got ${JSON.stringify(v)}`); break;
    case 'bool': if (typeof v !== 'boolean') bad(`expects true or false, got ${JSON.stringify(v)}`); break;
    case 'numbers': {
      const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : null);   // a list, or keyed by index (the windows save {0: 20})
      if (!arr || arr.some((x) => x != null && (typeof x !== 'number' || !Number.isFinite(x)))) bad(`expects a list of numbers, got ${JSON.stringify(v)}`);
      break;
    }
    case 'enum': if (!spec.values.includes(v)) bad(`is one of ${spec.values.map((x) => JSON.stringify(x)).join(' / ')}, got ${JSON.stringify(v)}`); break;
    case 'list': {
      if (!Array.isArray(v)) { bad(`expects a list, got ${JSON.stringify(v)}`); break; }
      v.forEach((item, i) => { if (!item || typeof item !== 'object' || Array.isArray(item)) errs.push(`${path}[${i}]: expects a map of settings`); else checkObject(spec.item, item, `${path}[${i}]`, errs); });
      if (spec.min && v.length < spec.min) bad(`needs at least ${spec.min}`);
      break;
    }
    default: break;
  }
}
function checkObject(schema, obj, path, errs) {
  for (const k of Object.keys(obj)) {
    if (schema[k]) continue;
    const near = nearest(k, Object.keys(schema));
    errs.push(`${path ? path + ': ' : ''}no setting “${k}”${near ? ` — did you mean “${near}”?` : ` (settings: ${Object.keys(schema).filter((x) => !schema[x].display).join(', ')})`}`);
  }
  for (const [k, spec] of Object.entries(schema)) {
    const v = obj[k];
    if (v == null || v === '') { if (spec.required) errs.push(`${path ? path + '.' : ''}${k}: required`); continue; }
    checkValue(spec, v, path ? `${path}.${k}` : k, errs);
  }
}

// → { errors: [..], params } — params with defaults filled and display-only settings dropped.
// { routine: true } adds what a routine must state (explicit cutoffs, scope all, …).
export function checkParams(name, params, { routine = false } = {}) {
  const def = toolDef(name);
  if (!def) return { errors: [`no tool “${name}”${nearest(name, [...TOOLS.keys()]) ? ` — did you mean “${nearest(name, [...TOOLS.keys()])}”?` : ''}`], params: null };
  const errs = [], p = { ...(params || {}) };
  checkObject(def.params, p, '', errs);
  const out = {};
  for (const [k, spec] of Object.entries(def.params)) {
    if (spec.display) continue;
    const v = p[k] == null || p[k] === '' ? spec.default : p[k];
    if (v !== undefined) out[k] = v;
    if (routine && spec.routine === 'required' && (p[k] == null || (Array.isArray(p[k]) && !p[k].length))) errs.push(`${k}: a routine must state it (${spec.why || 'an automatic value moves with the data'})`);
    if (routine && Array.isArray(spec.routine) && v != null && !spec.routine.includes(v)) errs.push(`${k}: a routine allows ${spec.routine.map((x) => JSON.stringify(x)).join(' / ')} (${spec.why || ''})`);
  }
  if (!errs.length && def.check) def.check(out, errs, { routine });
  return { errors: errs, params: out };
}

// the tools, as plain data (a host lists them; the from-scratch form and the docs read the same)
export function toolList() {
  const plain = (schema) => Object.fromEntries(Object.entries(schema).filter(([, v]) => !v.display).map(([k, v]) => [k, { type: v.type, ...(v.required ? { required: true } : {}), ...(v.default !== undefined ? { default: v.default } : {}), ...(v.values ? { values: v.values.slice() } : {}), ...(v.doc ? { doc: v.doc } : {}), ...(v.routine ? { routine: Array.isArray(v.routine) ? v.routine.slice() : v.routine } : {}), ...(v.item ? { item: plain(v.item) } : {}) }]));
  return [...TOOLS.values()].map((t) => ({ name: t.name, label: t.label, params: plain(t.params), outputs: { key: (t.outputs && t.outputs.key || []).slice() } }));
}

// run a tool start to finish — no window. Throws with every problem listed.
export async function runTool(name, params, ctx = {}) {
  const { errors, params: p } = checkParams(name, params, ctx);
  if (errors.length) throw new Error(`${toolDef(name) ? toolDef(name).label : name}: ${errors.join('; ')}`);
  const def = toolDef(name);
  const state = await def.scan(p, ctx);
  return def.shape(state, p);
}

// a shaped table → a machine TSV: plain column names, numbers as they are, blanks for NaN
export function tableTSV(table) {
  const cell = (v) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v));
  return [table.columns.join('\t'), ...table.rows.map((r) => r.map(cell).join('\t'))].join('\n') + '\n';
}

// ── helpers shared by the tools ──
const layerNamed = (name) => {
  const L = S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name);
  if (!L) throw new Error(`layer “${name}” isn't loaded`);
  return L;
};
const unitLabel = (u) => (u === 'pct' ? '%' : u || '');
const scopeCheck = (scope, Ls) => {
  if (scope === 'all') return;
  if (!Ls.some((L) => scopeMask({ scope }, L))) throw new Error(scopeMissing({ scope }, Ls[0]) || `no ${scope} mask`);
};
const columnCheck = (L, col, what) => {               // a bare name the layer lacks is refused; an expression is free-form
  const c = String(col).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) return;
  const h = layerTableHeader(L); if (!h) return;
  if (!validate(c, schemaExt(L, h)).ok) throw new Error(`${what} “${c}”: not a column of ${L.label || L.name}`);
};
const SERIES = {
  layer: { type: 'layer', doc: 'the layer (default: the tool’s layer)' },
  col: { type: 'column', required: true, doc: 'the grade column (or an expression)' },
  unit: { type: 'string', doc: 'the grade’s declared unit (pct, ppm, g/t, …) — converts into gradeUnit' },
  weight: { type: 'expr', doc: 'density expression; tonnage = density × block volume (blank = volume)' },
  filter: { type: 'expr', doc: 'a row filter for this series' },
  color: { type: 'string', display: true },
};
const seriesSt = (p) => p.series.map((s) => {
  const L = layerNamed(s.layer || p.layer);
  columnCheck(L, s.col, 'series column');
  return { layerId: L.id, col: String(s.col), unit: s.unit || '', weight: s.weight != null ? String(s.weight) : '', filter: s.filter || '' };
});

// ── grade-tonnage ─────────────────────────────────────────────────────────────────────────────────
registerTool('gt', {
  label: 'grade-tonnage',
  params: {
    layer: { type: 'layer', doc: 'the block model (series without a layer use it)' },
    series: { type: 'list', item: SERIES, required: true, min: 1, doc: 'one curve per series' },
    cutoffs: { type: 'numbers', routine: 'required', why: 'automatic cutoffs come from the data’s range and move with it', doc: 'the cutoffs, in gradeUnit' },
    nCut: { type: 'int', default: 40, doc: 'how many automatic cutoffs (when cutoffs is absent)' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use a series filter' },
    gradeUnit: { type: 'string', default: '', doc: 'the unit cutoffs and grades are shown in' },
    densUnit: { type: 'string', default: 't/m3', doc: 'the unit of the density expression' },
    ranges: { type: 'any', display: true },
  },
  outputs: { key: ['series', 'cutoff'] },
  check(p, errs) { if (!p.layer && p.series && p.series.some((s) => !s.layer)) errs.push('layer: a series without its own layer needs the tool’s layer'); },
  async scan(p, ctx) {
    const series = seriesSt(p);
    scopeCheck(p.scope, series.map((s) => layerById(s.layerId)));
    return scanGTSeries({ series, scope: p.scope, densUnit: p.densUnit }, ctx.progress, ctx.signal);
  },
  shape(scan, p) {
    const warnings = [];
    const cuts = Array.isArray(p.cutoffs) && p.cutoffs.length ? p.cutoffs.slice().sort((a, b) => a - b)
      : gtCuts(scan.series, p.nCut, (se) => gradeUnitFactor(se.s.unit, p.gradeUnit)) || [];
    if (Array.isArray(p.cutoffs)) for (const se of scan.series) {        // the fine grade bins: a cutoff between two edges counts from the next edge up
      const f = gradeUnitFactor(se.s.unit, p.gradeUnit), step = 10 ** se.e;
      const off = cuts.filter((c) => Math.abs(c / f / step - Math.round(c / f / step)) > 1e-6);
      if (off.length) warnings.push(`${se.s.col}: cutoff${off.length > 1 ? 's' : ''} ${off.join(', ')} not on the ${step * f} grade step — counted from the next step up`);
    }
    const { rows, weighted } = gtRows(scan, cuts, p.gradeUnit);
    const amount = weighted ? 'tonnes' : 'volume', gl = unitLabel(p.gradeUnit);
    return {
      table: { columns: ['series', 'cutoff', amount, 'grade', 'metal'], key: ['series', 'cutoff'], rows: rows.map((r) => [r.series, r.cutoff, r.amount, r.grade, r.metal]),
        units: { cutoff: gl, [amount]: weighted ? 't' : 'm3', grade: gl, metal: p.gradeUnit ? 't' : `${gl || 'grade'}·${weighted ? 't' : 'm3'}` } },
      values: {}, resolved: { ...p, cutoffs: cuts }, warnings, where: scan.where,
    };
  },
});

// ── stats ─────────────────────────────────────────────────────────────────────────────────────────
registerTool('stats', {
  label: 'stats',
  params: {
    layer: { type: 'layer', required: true },
    cols: { type: 'any', required: true, doc: 'the columns summarised (a list of names)' },
    groupBy: { type: 'expr', default: '', doc: 'a column or expression to group by (blank = one group)' },
    weight: { type: 'expr', default: '', doc: 'a weight for mean and std (quantiles stay unweighted)' },
    filter: { type: 'expr', default: '', doc: 'a row filter' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use filter' },
  },
  outputs: { key: ['group', 'column'] },
  check(p, errs) { if (!Array.isArray(p.cols) || !p.cols.length || p.cols.some((c) => typeof c !== 'string')) errs.push('cols: a list of column names'); },
  async scan(p, ctx) {
    const L = layerNamed(p.layer), nums = numericColsOf(L);
    const missing = p.cols.filter((c) => !nums.includes(c));
    if (missing.length) throw new Error(`no numeric column ${missing.map((c) => `“${c}”`).join(', ')} on ${L.label || L.name}`);
    scopeCheck(p.scope, [L]);
    return statsScan(L, { cols: p.cols, groupBy: p.groupBy, weight: p.weight, filter: p.filter }, scopeMask({ scope: p.scope }, L), ctx.progress, ctx.signal);
  },
  shape(scan, p) {
    const g = p.groupBy ? [p.groupBy] : [];
    return {
      table: { columns: [...g, 'column', 'n', 'mean', 'std', 'min', 'q25', 'median', 'q75', 'max'], key: [...g, 'column'],
        rows: scan.rows.map((r) => [...(p.groupBy ? [r.group] : []), r.col, r.n, r.mean, r.std, r.min, r.q25, r.q50, r.q75, r.max]), units: {} },
      values: {}, resolved: { ...p }, warnings: scan.overflow ? ['more than 256 groups — the rest were left out'] : [], where: scan.where,
    };
  },
});

// ── swath ─────────────────────────────────────────────────────────────────────────────────────────
registerTool('swath', {
  label: 'swath',
  params: {
    layer: { type: 'layer', doc: 'the block model (series without a layer use it)' },
    series: { type: 'list', item: SERIES, required: true, min: 1 },
    mode: { type: 'enum', values: ['axes', 'oriented', 'trend'], default: 'axes', doc: 'X/Y/Z · a dip-dir/dip/rake trio · one trend/plunge' },
    dd: { type: 'number', default: 90 }, dip: { type: 'number', default: 45 }, rake: { type: 'number', default: 0 },
    trend: { type: 'number', default: 0 }, plunge: { type: 'number', default: 0 },
    bandW: { type: 'numbers', routine: 'required', why: 'automatic band widths come from the extent and move with it', doc: 'band width per direction' },
    off: { type: 'numbers', doc: 'band offset per direction (default 0 — a fixed lattice anchored at the origin; the window’s automatic offset is the data’s minimum, which moves with the data)' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use a series filter' },
    gradeUnit: { type: 'string', default: '' },
    axis: { type: 'any', display: true }, bars: { type: 'any', display: true }, locate: { type: 'any', display: true }, zebra: { type: 'any', display: true }, ranges: { type: 'any', display: true },
  },
  outputs: { key: ['series', 'direction', 'center'] },
  check(p, errs) { if (!p.layer && p.series && p.series.some((s) => !s.layer)) errs.push('layer: a series without its own layer needs the tool’s layer'); },
  async scan(p, ctx) {
    const series = seriesSt(p);
    scopeCheck(p.scope, series.map((s) => layerById(s.layerId)));
    const scan = await scanSwath({ series, mode: p.mode, dd: p.dd, dip: p.dip, rake: p.rake, trend: p.trend, plunge: p.plunge, scope: p.scope }, ctx.progress, ctx.signal);
    if (!scan) throw new Error('no series could be read');
    return scan;
  },
  shape(scan, p) {
    const at = (o, i) => (o == null ? undefined : Array.isArray(o) ? o[i] : o[i] != null ? o[i] : o[String(i)]);
    const rows = [], bandW = [], off = [];
    scan.dirs.forEach((_, di) => {
      const [lo, hi] = scan.range[di];
      const w = +at(p.bandW, di) || Math.max(niceStep((hi - lo) / 25) || 1, 1e-6);
      const o = at(p.off, di) != null ? +at(p.off, di) : 0;
      bandW.push(w); off.push(o);
      for (const r of swathRows(scan, di, w, o, p.gradeUnit).rows) rows.push([r.series, r.direction, r.center, r.count, r.weight, r.mean]);
    });
    return {
      table: { columns: ['series', 'direction', 'center', 'count', 'weight', 'mean'], key: ['series', 'direction', 'center'], rows, units: { center: 'm', mean: unitLabel(p.gradeUnit) } },
      values: {}, resolved: { ...p, bandW, off }, warnings: [], where: scan.where,
    };
  },
});

// ── validation: the model against its declustered drillhole samples ──────────────────────────────
// values: model_mean, samples_declustered, samples_naive, bias_pct, samples, cell — what a check
// reads ("abs($val.bias_pct) < 5"); the table: the model-vs-samples swath along one axis
registerTool('validation', {
  label: 'validation',
  params: {
    model: { type: 'layer', required: true, doc: 'the block model' },
    samples: { type: 'layer', required: true, doc: 'the drillhole layer' },
    modelGrade: { type: 'column', required: true, doc: 'the model’s grade column' },
    sampleGrade: { type: 'column', required: true, doc: 'the samples’ grade column' },
    cell: { type: 'number', doc: 'the decluster cell (m); absent = the auto-sweep’s minimum-mean cell' },
    axis: { type: 'enum', values: ['X', 'Y', 'Z'], default: 'X', doc: 'the swath direction' },
    bandW: { type: 'number', routine: 'required', why: 'an automatic band width comes from the extent and moves with it', doc: 'the swath band width' },
    off: { type: 'number', doc: 'the swath band offset (default 0 when bandW is given)' },
  },
  outputs: { key: ['center'] },
  async scan(p) {
    const M = layerNamed(p.model), D = layerNamed(p.samples);
    if (!(D.dh && D.docs && D.docs.dhDoc)) throw new Error(`${D.label || D.name} is not a drillhole layer`);
    columnCheck(M, p.modelGrade, 'model grade'); columnCheck(D, p.sampleGrade, 'sample grade');
    return validationRun({ M, D, mGrade: p.modelGrade, sGrade: p.sampleGrade, cell: p.cell || null, axis: ['X', 'Y', 'Z'].indexOf(p.axis), bandW: p.bandW || null, off: p.bandW ? (p.off != null ? p.off : 0) : null });
  },
  shape(v, p) {
    const byC = new Map();
    for (const b of v.mres.profile) byC.set(+b.center.toFixed(9), { center: b.center, mm: b.mean[0], mt: b.tonnage, sm: NaN, sn: 0 });
    for (const b of v.sres) { const k = +b.center.toFixed(9), e = byC.get(k) || { center: b.center, mm: NaN, mt: 0 }; e.sm = b.mean; e.sn = b.count; byC.set(k, e); }
    const rows = [...byC.values()].sort((a, b) => a.center - b.center).map((e) => [e.center, e.mm, e.mt, e.sm, e.sn || 0]);
    return {
      table: { columns: ['center', 'model_mean', 'model_volume', 'sample_mean', 'sample_count'], key: ['center'], rows, units: { center: 'm', model_volume: 'm3' } },
      values: { model_mean: v.modelMean, samples_declustered: v.declMean, samples_naive: v.naiveMean, bias_pct: v.biasPct, samples: v.samples.length, cell: v.cellUsed },
      resolved: { ...p, cell: v.cellUsed, bandW: v.bandW, off: v.off }, warnings: [],
    };
  },
});

// ── the resource table: tonnes, grade, metal above each cutoff, by up to two categories ──────────
registerTool('resource', {
  label: 'resource table',
  params: {
    layer: { type: 'layer', required: true },
    grade: { type: 'column', required: true },
    cutoffs: { type: 'numbers', required: true, doc: 'the cutoffs (a resource statement always states them)' },
    density: { type: 'any', doc: '{ col } a density column, or { const } a value; unit (t/m3, g/cm3, kg/m3, lb/ft3)' },
    groupBy: { type: 'any', doc: 'up to two category columns (domain × class)' },
    metalFactor: { type: 'number', default: 1, doc: 'metal = tonnes × grade × this (1/100 for % → t, 1/31.1035 for g/t → oz)' },
    scope: { type: 'enum', values: ['all', 'filter'], default: 'all', routine: ['all'], why: 'the layer’s current filter isn’t saved with the routine' },
    metalUnit: { type: 'string', display: true }, gradeUnit: { type: 'string', display: true }, title: { type: 'string', display: true },
  },
  outputs: { key: ['cutoff'] },
  check(p, errs) {
    if (p.groupBy != null && (!Array.isArray(p.groupBy) || p.groupBy.length > 2 || p.groupBy.some((g) => typeof g !== 'string'))) errs.push('groupBy: a list of up to two column names');
    const d = p.density;
    if (d != null && (typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some((k) => !['col', 'const', 'unit'].includes(k)))) errs.push('density: { col } or { const }, with an optional unit');
  },
  async scan(p, ctx) {
    const L = layerNamed(p.layer);
    columnCheck(L, p.grade, 'grade');
    const mask = p.scope === 'filter' && L.filterExpr ? L._filterMask : null;
    return computeResourceTable(L, { grade: p.grade, cutoffs: p.cutoffs, density: p.density, groupBy: p.groupBy, metalFactor: p.metalFactor, mask }, ctx.progress);
  },
  shape(r, p) {
    const g = (p.groupBy || []).filter(Boolean).slice(0, 2);
    // the machine table leaves out the "total" rows (presentation, and they'd collide with a real
    // group called "total") — they're the sum of their cutoff's rows
    const rows = r.rows.filter((row) => !(g.length && row[1] === 'total' && row.slice(2, 1 + g.length).every((x) => x === '')));
    return {
      table: { columns: r.columns, key: ['cutoff', ...g], rows, units: { tonnes: 't' } },
      values: {}, resolved: { ...p }, warnings: [],
    };
  },
});
