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
import { layerTableHeader, schemaExt, layerRecords, attrRowCountOf } from './records.js';
import { runExport, exportColumnsOf } from './export.js';
import { buildGridExport, gridBandsOf, GRID_EXPORT_FMTS } from './grid-export.js';
import { modelQa, qaFindings } from './modelqa.js';
import { scanXtabOf, xtabModel, xtabValue } from './xtab.js';
import { scanScatterOf, scanQqOf, xySpec, xyTSV, QQ_P, BINS as XY_BINS } from './xyplot.js';
import { scatterR } from './scanner.js';
import { compositeToLayer } from './composite-ui.js';
import { pairBlocksSamples } from './pairing.js';
import { gradeShell } from './shells.js';
import { spatialJoinToCols, reconcileModels } from './joins.js';
import { renderSectionSeries } from './section-series.js';
import { setSectionWorld } from './section.js';
import { removeLayerUI } from './layers.js';
import { inputsOf as dhQaInputs } from './dhqa.js';
import { drillholeQa } from '../../../ext/condenser/src/main.js';
import { meshQa } from '../../../ext/geometry/index.js';
import { meshVertexData } from './records.js';
import { numericColsOf, computeResourceTable, supportMeasure } from './analysis.js';
import { validationRun } from './validation.js';
import { scanContact, contactRows, contactValuesOf, contactChartSpec, contactHumanTSV, contactAmountCol } from './contact.js';
import { scanFactors, factorsStOf, factorsTable, factorsValues, factorsChartSpec, factorsHumanTSV } from './factors.js';
import { gradeUnitFactor, niceStep, scopeMask, scopeMissing, rangesFromCfg } from './analysis-ui.js';
import { gtCuts } from './scanner.js';
import { scanGTSeries, gtRows, gtChartSpec, gtHumanTSV } from './gt.js';
import { statsScan } from './stats.js';
import { scanSwath, swathRows, binSwath, swathChartSpec, swathHumanTSV } from './swath.js';
import { validate, compileBool } from '../../../ext/expr/index.js';

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
  const w = word.toLowerCase(), pre = names.find((n) => { const m = n.toLowerCase(); return Math.min(m.length, w.length) >= 3 && (m.startsWith(w) || w.startsWith(m)); });
  if (pre) return pre;                                       // column → col, cutoff → cutoffs
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
  if (def.normalize) def.normalize(p);                       // old spellings a saved recipe may still carry
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

// the direction a swath window shows (raw.axis) with its band width / offset — the window's
// automatic ones when the recipe left them unset (about 25 bands from the extent's low end)
function swathView(scan, raw) {
  const di = Math.max(0, Math.min(scan.dirs.length - 1, +raw.axis || 0));
  const at = (o) => (o == null ? undefined : Array.isArray(o) ? o[di] : o[di] != null ? o[di] : o[String(di)]);
  const [lo, hi] = scan.range[di];
  const bw = +at(raw.bandW) || Math.max(niceStep((hi - lo) / 25) || 1, 1e-6), off = at(raw.off) != null ? +at(raw.off) : lo;
  const b = binSwath(scan, di, bw, off);
  return b.keys.length ? { di, bw, off, b } : null;
}

// a recipe made again without its window — the composer's ↻ refresh: { spec, tsv } as the window
// would have drawn and copied them (null: this tool has no chart / human table)
export async function rerunToolRecipe(recipe) {
  const def = toolDef(recipe.tool);
  if (!def || !(def.chart || def.human)) return null;
  const { errors, params } = checkParams(recipe.tool, recipe.params || {});
  if (errors.length) throw new Error(`${def.label}: ${errors.join('; ')}`);
  const state = await def.scan(params, {});
  const raw = { ...(recipe.params || {}) };
  return { spec: def.chart ? def.chart(state, raw) : null, tsv: def.human ? def.human(state, raw) : null };
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
  weight: { type: 'expr', doc: 'density expression; tonnage = density × block volume (blank = volume); in grade-tonnage on a drillhole layer it multiplies the interval length instead (length × density, not tonnes)' },
  filter: { type: 'expr', doc: 'a row filter for this series' },
  color: { type: 'string', display: true },
};
const seriesSt = (p) => p.series.map((s) => {
  const L = layerNamed(s.layer || p.layer);
  columnCheck(L, s.col, 'series column');
  return { layerId: L.id, col: String(s.col), unit: s.unit || '', weight: s.weight != null ? String(s.weight) : '', filter: s.filter || '', color: s.color || null };
});

// ── grade-tonnage ─────────────────────────────────────────────────────────────────────────────────
registerTool('gt', {
  label: 'grade-tonnage',
  params: {
    layer: { type: 'layer', doc: 'the block model or drillhole layer (series without a layer use it); a drillhole layer weighs each interval by its length, TO − FROM' },
    series: { type: 'list', item: SERIES, required: true, min: 1, doc: 'one curve per series' },
    cutoffs: { type: 'numbers', routine: 'required', why: 'automatic cutoffs come from the data’s range and move with it', doc: 'the cutoffs, in gradeUnit' },
    nCut: { type: 'int', default: 40, doc: 'how many automatic cutoffs (when cutoffs is absent)' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use a series filter' },
    gradeUnit: { type: 'string', default: '', doc: 'the unit cutoffs and grades are shown in' },
    densUnit: { type: 'string', default: 't/m3', doc: 'the unit of the density expression' },
    ranges: { type: 'any', display: true },
  },
  outputs: { key: ['series', 'cutoff'] },
  // what the window draws and copies — a composer frame is made again from these (raw: the saved
  // params, display settings included)
  chart: (scan, raw) => gtChartSpec(scan, { nCut: raw.nCut || 40, cutoffs: raw.cutoffs, gradeUnit: raw.gradeUnit || '', ranges: raw.ranges ? rangesFromCfg(raw.ranges) : null }),
  human: (scan, raw) => gtHumanTSV(scan, { nCut: raw.nCut || 40, cutoffs: raw.cutoffs, gradeUnit: raw.gradeUnit || '' }),
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
    // the amount column is NAMED by what it measures (supportMeasure): tonnes | volume for a block
    // model, length | weighted_length (and accumulation for metal) for a drillhole layer
    const { rows, measure } = gtRows(scan, cuts, p.gradeUnit);
    const amount = measure.col, gl = unitLabel(p.gradeUnit);
    return {
      table: { columns: ['series', 'cutoff', amount, 'grade', measure.metalCol], key: ['series', 'cutoff'], rows: rows.map((r) => [r.series, r.cutoff, r.amount, r.grade, r.metal]),
        units: { cutoff: gl, [amount]: measure.unit, grade: gl, [measure.metalCol]: measure.metalUnit } },
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
  human: (scan, raw) => { const gb = raw.groupBy || ''; return [[...(gb ? [gb] : []), 'column', 'n', 'mean', 'std', 'min', 'q25', 'median', 'q75', 'max'].join('\t'), ...scan.rows.map((r) => [...(gb ? [r.group] : []), r.col, r.n, r.mean, r.std, r.min, r.q25, r.q50, r.q75, r.max].join('\t'))].join('\n'); },
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
  chart: (scan, raw) => { const v = swathView(scan, raw); return v ? swathChartSpec(scan, v.b, { di: v.di, bw: v.bw, off: v.off, bars: raw.bars || 'count', gradeUnit: raw.gradeUnit || '', ranges: raw.ranges ? rangesFromCfg(raw.ranges) : null, multi: S.layers.length > 1 || scan.series.length > 1 }) : null; },
  human: (scan, raw) => { const v = swathView(scan, raw); return v ? swathHumanTSV(scan, v.di, v.bw, v.off, raw.gradeUnit || '') : null; },
  normalize(p) { if (p.mode === 'direction') p.mode = 'trend'; },   // the swath window saved its trend/plunge mode as "direction" until 2026-11
  check(p, errs) { if (!p.layer && p.series && p.series.some((s) => !s.layer)) errs.push('layer: a series without its own layer needs the tool’s layer'); },
  async scan(p, ctx) {
    const series = seriesSt(p);
    scopeCheck(p.scope, series.map((s) => layerById(s.layerId)));
    // a swath bands a block model's centroids — a drillhole layer has none to band (its intervals sit
    // on desurveyed traces), so it would come back empty; say so instead. Validation is the model-vs-samples swath.
    for (const s of series) { const Ls = layerById(s.layerId); if (Ls && !Ls.docs.blockDoc) throw new Error(`series “${Ls.label || Ls.name}”: a swath reads a block model; for model against drillhole samples use the validation tool`); }
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
    filter: { type: 'expr', default: '', doc: 'a domain — one expression applied to the model AND the samples (its names must exist on both), e.g. LITO != "WASTE"' },
  },
  outputs: { key: ['center'] },
  async scan(p) {
    const M = layerNamed(p.model), D = layerNamed(p.samples);
    if (!(D.dh && D.docs && D.docs.dhDoc)) throw new Error(`${D.label || D.name} is not a drillhole layer`);
    columnCheck(M, p.modelGrade, 'model grade'); columnCheck(D, p.sampleGrade, 'sample grade');
    return validationRun({ M, D, mGrade: p.modelGrade, sGrade: p.sampleGrade, cell: p.cell || null, axis: ['X', 'Y', 'Z'].indexOf(p.axis), bandW: p.bandW || null, off: p.bandW ? (p.off != null ? p.off : 0) : null, filter: p.filter || '' });
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

// ── contact analysis: a value binned by distance to a boundary, both sides ───────────────────────
// mode downhole: every A→B transition along each hole (a drillhole layer's domain column); mode
// surface: each record's signed distance to a wireframe (closed: negative inside; open: negative
// below), samples and blocks as separate series. Sides: the NEGATIVE side is domain A / inside /
// below. table: series · side · center · mean · metres (downhole) | weight (surface) · count.
// values (the first series bare, later series suffixed _2, _3 …): step = mean_inside − mean_outside
// (the `near` bins either side of the contact), ratio, mean_inside, mean_outside, n, n_inside,
// n_outside, slope_inside / slope_outside (per m of signed distance), mean_all_inside /
// mean_all_outside; step_ratio_k = series k's step / the first's; downhole: contacts, holes.
// A hard contact: a large step, flat sides; a soft one: a small step, both slopes the same sign.
registerTool('contact', {
  label: 'contact analysis',
  params: {
    mode: { type: 'enum', values: ['downhole', 'surface'], default: 'downhole', doc: 'downhole: transitions along each hole · surface: signed distance to a wireframe' },
    layer: { type: 'layer', doc: 'the layer series without their own layer read' },
    series: { type: 'list', item: SERIES, required: true, min: 1, doc: 'one curve per series: col, weight (× the support: an interval’s length, a block’s volume), filter' },
    domain: { type: 'column', doc: 'downhole: the domain column (text) on the drillhole layer' },
    domA: { type: 'string', doc: 'downhole: domain A — the negative side' },
    domB: { type: 'string', default: '', doc: 'downhole: domain B — the positive side (blank = any other domain)' },
    direction: { type: 'enum', values: ['both', 'AtoB', 'BtoA'], default: 'both', doc: 'downhole: both (pooled) · AtoB (A above B down the hole) · BtoA' },
    minRun: { type: 'number', default: 0, doc: 'downhole: each side’s run at least this long, m (skips slivers)' },
    maxGap: { type: 'number', doc: 'downhole: the widest unsampled gap a contact or a run may bridge, m (default: binWidth)' },
    surface: { type: 'layer', doc: 'surface: the mesh layer — a closed solid (negative inside) or an open surface (negative below)' },
    binWidth: { type: 'number', routine: 'required', why: 'the bins are what a check compares run to run', doc: 'bin width, m (default 2)' },
    maxDist: { type: 'number', routine: 'required', why: 'the reach decides which records count', doc: 'how far from the contact each side, m (default 10 × binWidth)' },
    near: { type: 'int', default: 1, doc: 'bins each side that make “just inside / just outside” for step and ratio' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use a series filter' },
    ranges: { type: 'any', display: true },
  },
  outputs: { key: ['series', 'side', 'center'] },
  chart: (scan, raw) => contactChartSpec(scan, { ranges: raw.ranges ? rangesFromCfg(raw.ranges) : null }),
  human: (scan) => contactHumanTSV(scan),
  check(p, errs) {
    if (!p.layer && p.series && p.series.some((s) => !s.layer)) errs.push('layer: a series without its own layer needs the tool’s layer');
    if (p.mode === 'downhole') { if (!p.domain) errs.push('domain: a downhole contact plot needs the domain column'); if (!p.domA) errs.push('domA: the domain whose contacts are tested'); }
    if (p.mode === 'surface' && !p.surface) errs.push('surface: the mesh layer to measure against');
    if (p.binWidth != null && !(p.binWidth > 0)) errs.push('binWidth: a positive number of metres');
    if (p.maxDist != null && !(p.maxDist > 0)) errs.push('maxDist: a positive number of metres');
  },
  async scan(p, ctx) {
    const series = seriesSt(p);
    scopeCheck(p.scope, series.map((s) => layerById(s.layerId)));
    const bw = p.binWidth || 2;
    const st = { mode: p.mode, series, binWidth: bw, maxDist: p.maxDist || 10 * bw, scope: p.scope, domain: p.domain, domA: p.domA, domB: p.domB, direction: p.direction, minRun: p.minRun, maxGap: p.maxGap,
      surfaceId: p.mode === 'surface' ? layerNamed(p.surface).id : null };
    return scanContact(st, ctx.progress, ctx.signal);
  },
  shape(scan, p) {
    const amt = contactAmountCol(scan), rows = contactRows(scan);
    const warnings = [];
    for (const se of scan.series) {
      if (scan.mode === 'downhole' && !se.contacts) warnings.push(`${se.L.label || se.L.name}: no ${p.domA} contact${p.domB ? ` with ${p.domB}` : ''} found`);
      if (scan.mode === 'surface' && !se.counted) warnings.push(`${se.L.label || se.L.name}: nothing within ${scan.maxDist} m of the surface`);
    }
    return {
      table: { columns: ['series', 'side', 'center', 'mean', amt, 'count'], key: ['series', 'side', 'center'], rows: rows.map((r) => [r.series, r.side, r.center, r.mean, r.amount, r.count]), units: { center: 'm', [amt]: scan.mode === 'downhole' ? 'm' : '' } },
      values: contactValuesOf(scan, p.near || 1), resolved: { ...p, binWidth: scan.bw, maxDist: scan.maxDist }, warnings, where: scan.where,
    };
  },
});

// ── reconciliation factors: totals inside the mined volume, per period ──────────────────────────
// F1 = grade control / resource model, F2 = mill / grade control, F3 = mill / resource model (= F1 × F2),
// each for tonnes, grade and metal (metal = tonnes × grade × metalFactor, so F_metal = F_t × F_g).
// The mined volume per period: a period column on the blocks, one mesh per period (a solid's inside or
// an open pit surface's above, partial blocks by their fraction; nested = each period is its volume
// minus the one before), or a filter (one period). Production: a table layer matched by period name.
// table, key [period, quantity] (quantity: tonnes | grade | metal): model, gc, mill, f1, f2, f3 for the
// period and c_model … c_f3 to date (tonnes and metal summed over this period and every earlier one;
// the to-date mill — so c_f2 / c_f3 — is blank from the first period without production).
// values (the LAST period in order): f1_t f1_g f1_m, f2_*, f3_*, model_* gc_* mill_* (t g m), and the
// same to date with a c_ prefix (c_f1_t …); periods = how many. Blanks stay blank: a check reading
// one is "not evaluated" (a month without production yet is not a pass).
const DENSITY_DOC = '{ col: SG } a density column, or { const: 2.7 }; unit t/m3 (default), kg/m3, lb/ft3';
const densityShape = (d, path, errs) => {
  if (d == null) return;
  if (typeof d === 'number') { if (!(d > 0)) errs.push(`${path}: a positive number`); return; }
  if (typeof d === 'string') return;                         // a column name (or a number written as text)
  if (typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some((k) => !['col', 'const', 'unit'].includes(k)) || (d.col == null && d.const == null)) errs.push(`${path}: ${DENSITY_DOC}`);
};
registerTool('factors', {
  label: 'reconciliation factors',
  params: {
    model: { type: 'layer', required: true, doc: 'the resource (long-range) block model — F1 and F3’s denominator' },
    grade: { type: 'column', required: true, doc: 'the resource model’s grade column' },
    modelUnit: { type: 'string', default: '', doc: 'its grade unit (pct, g/t, ppm …) — converts into gradeUnit' },
    density: { type: 'any', routine: 'required', why: 'tonnes are volume × density — a routine states which', doc: `the resource model’s density: ${DENSITY_DOC}` },
    gc: { type: 'layer', doc: 'the grade-control (short-range) block model; absent = the model layer itself (its other columns)' },
    gcGrade: { type: 'column', doc: 'grade control’s grade column (default: grade)' },
    gcUnit: { type: 'string', doc: 'its grade unit (default: modelUnit)' },
    gcDensity: { type: 'any', doc: 'grade control’s density (default: density)' },
    periods: { type: 'enum', values: ['column', 'volumes', 'filter', 'selection'], default: 'column', routine: ['column', 'volumes', 'filter'], why: 'a selection isn’t saved with the routine — use a period column, volumes or a filter', doc: 'how the mined volume per period is known: a period column on the blocks · a mesh per period · a filter (one period) · the 3D selection (one period)' },
    periodCol: { type: 'column', doc: 'periods column: the column naming the period each block was mined in (blank = not mined) — on both models' },
    volumes: { type: 'list', item: { name: { type: 'string', required: true, doc: 'the period’s name (production rows match it)' }, mesh: { type: 'layer', required: true, doc: 'a closed solid or an open pit surface' }, side: { type: 'enum', values: ['inside', 'above', 'below'], default: 'inside', doc: 'inside (a solid) · above (a pit surface: what was mined from it up) · below' } }, doc: 'periods volumes: one mesh per period, in order — blocks counted by the fraction inside' },
    nested: { type: 'bool', default: false, doc: 'periods volumes: each volume holds the ones before it (pit phases, cumulative shells) → period k = volume k minus volume k − 1' },
    probes: { type: 'any', default: [2, 2, 2], doc: 'periods volumes: probes per block along x, y, z for the fraction inside — [3, 3, 2] for benches; a single n means n × n × n; [1, 1, 1] tests the centroid' },
    periodFilter: { type: 'expr', doc: 'periods filter: the blocks mined (an expression; its names must exist on both models)' },
    periodName: { type: 'string', default: 'period', doc: 'periods filter / selection: the period’s name' },
    filter: { type: 'expr', default: '', doc: 'an optional domain filter on both models, any period mode (e.g. LITO == "ORE")' },
    production: { type: 'layer', doc: 'the production (mill) table layer — no X/Y/Z, one or more rows per period; absent = F1 only' },
    prodPeriod: { type: 'column', doc: 'its period column' },
    prodTonnes: { type: 'column', doc: 'its tonnes column' },
    prodGrade: { type: 'column', doc: 'its grade column (or prodMetal, or both — a stated metal is used as stated, and a mismatch with tonnes × grade × metalFactor warns)' },
    prodMetal: { type: 'column', doc: 'its metal column, in the metal unit' },
    prodUnit: { type: 'string', doc: 'its grade unit (default: gradeUnit)' },
    cutoff: { type: 'any', routine: 'required', why: 'a factor at another cutoff is another factor — state it, or "none"', doc: 'blocks at or above it count, in gradeUnit; "none" = every block' },
    gradeUnit: { type: 'string', default: '', doc: 'the report grade unit; declared, metal is in tonnes of metal (% → × 0.01, g/t → × 1e-6) unless metalFactor says otherwise' },
    metalFactor: { type: 'number', doc: 'metal = tonnes × grade × this (e.g. 1/31.1035 for g/t → oz); absent = from gradeUnit, or 1' },
    metalUnit: { type: 'string', display: true }, tolerance: { type: 'any', display: true }, show: { type: 'any', display: true }, cumulative: { type: 'any', display: true }, ranges: { type: 'any', display: true },
  },
  outputs: { key: ['period', 'quantity'] },
  chart: (scan, raw) => factorsChartSpec(scan, { show: raw.show, cumulative: raw.cumulative, tolerance: raw.tolerance != null ? raw.tolerance : 0.1, ranges: raw.ranges ? rangesFromCfg(raw.ranges) : null }),
  human: (scan) => factorsHumanTSV(scan),
  check(p, errs) {
    if (p.cutoff != null && p.cutoff !== 'none' && !(typeof p.cutoff === 'number' && Number.isFinite(p.cutoff))) errs.push('cutoff: a number (in gradeUnit) or "none"');
    densityShape(p.density, 'density', errs); densityShape(p.gcDensity, 'gcDensity', errs);
    if (p.density == null && !p.gcDensity) errs.push('density: tonnes need a density — { col: SG } or { const: 2.7 }');
    if (p.periods === 'column' && !p.periodCol) errs.push('periodCol: the column naming each block’s period (periods: column)');
    if (p.periods === 'volumes' && !(Array.isArray(p.volumes) && p.volumes.length)) errs.push('volumes: one { name, mesh, side } per period (periods: volumes)');
    if (p.periods === 'filter' && !p.periodFilter) errs.push('periodFilter: the expression keeping the mined blocks (periods: filter)');
    if (p.production) { if (!p.prodPeriod) errs.push('prodPeriod: the production table’s period column'); if (!p.prodTonnes) errs.push('prodTonnes: its tonnes column'); if (!p.prodGrade && !p.prodMetal) errs.push('prodGrade or prodMetal: the production grade, its metal, or both'); }
    if (p.probes != null) { const r = Array.isArray(p.probes) ? p.probes : [p.probes]; if (!(r.length === 1 || r.length === 3) || r.some((v) => !Number.isInteger(v) || v < 1)) errs.push('probes: per block — [nx, ny, nz] or one n, whole numbers ≥ 1'); }
  },
  async scan(p, ctx) { return scanFactors(factorsStOf(p), ctx.progress, ctx.signal); },
  shape(scan, p) {
    // units ride on the quantity column (tonnes: t · grade: gradeUnit · metal: the metal unit), not a column
    return {
      table: { ...factorsTable(scan), units: { quantity: `tonnes: t · grade: ${unitLabel(p.gradeUnit) || 'as stated'} · metal: ${scan.metalUnit}` } },
      values: factorsValues(scan),
      resolved: { ...p, cutoff: scan.cutoff == null ? 'none' : scan.cutoff, metalFactor: scan.mf },
      warnings: scan.warnings, where: scan.where,
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

// ── export: a layer (or the records a filter keeps) as a CSV or Parquet FILE ────────────────────
// The one tool whose output is a file, not a table: the routine runner writes it into the run's
// folder and hashes it. values: rows, bytes.
const extOf = (fmt) => (fmt === 'parquet' ? 'parquet' : 'csv');
registerTool('export', {
  label: 'export',
  writesFile: (p) => p.out || `${String(p.layer || 'export').replace(/\.[^.]+$/, '')}.${extOf(p.format)}`,
  params: {
    layer: { type: 'layer', required: true },
    format: { type: 'enum', values: ['csv', 'parquet'], default: 'csv' },
    columns: { type: 'any', doc: 'the columns to write, by name (default: all, derived ones included)' },
    filter: { type: 'expr', default: '', doc: 'only the records this keeps' },
    out: { type: 'string', doc: 'the file name (default: the layer’s, with the format’s extension)' },
    delim: { type: 'enum', values: [',', ';', 'tab'], default: ',' },
    decimalComma: { type: 'bool', default: false },
    codec: { type: 'enum', values: ['SNAPPY', 'GZIP', 'UNCOMPRESSED'], default: 'SNAPPY' },
    spatialSort: { type: 'bool', default: false, doc: 'Parquet: Morton-sorted, so the file is its own spatial index' },
    scope: { type: 'enum', values: ['all', 'matches', 'selection'], default: 'all', routine: ['all'], why: 'the filter box and the selection aren’t saved with the routine — use filter' },
  },
  outputs: { key: [] },
  check(p, errs) { if (p.columns != null && (!Array.isArray(p.columns) || p.columns.some((c) => typeof c !== 'string'))) errs.push('columns: a list of column names'); },
  async scan(p, ctx) {
    const L = layerNamed(p.layer), cols = exportColumnsOf(L) || [];
    let colIdx = null;
    if (p.columns) {
      const miss = p.columns.filter((c) => !cols.some((x) => x.name === c));
      if (miss.length) throw new Error(`export: no column ${miss.map((c) => `“${c}”`).join(', ')} on ${L.label || L.name}`);
      colIdx = p.columns.map((c) => cols.findIndex((x) => x.name === c));
    }
    let mask = null;
    if (p.filter && String(p.filter).trim()) {              // the records the filter keeps — counted the way the renderer numbers them
      const h = layerTableHeader(L), schema = schemaExt(L, h);
      const v = validate(String(p.filter), schema); if (!v.ok) throw new Error(`export filter “${p.filter}”: ${(v.errors[0] && v.errors[0].message) || 'invalid'}`);
      const fn = compileBool(String(p.filter), schema, { decimal: '.' });
      mask = new Uint8Array(attrRowCountOf(L) || 0);
      for await (const { f, rec } of layerRecords(L)) if (rec < mask.length && fn(f)) mask[rec] = 1;
    } else if (p.scope !== 'all') {
      mask = p.scope === 'matches' ? L._filterMask : L._selMask;
      if (!mask) throw new Error(`export: no ${p.scope === 'matches' ? 'filter' : 'selection'} on ${L.label || L.name}`);
    }
    const name = toolDef('export').writesFile(p);
    const r = await runExport(L, { format: p.format, colIdx, delim: p.delim, decimalComma: p.decimalComma, codec: p.codec, spatialSort: p.spatialSort, filename: name, download: false, mask, returnBlob: true, signal: ctx.signal });
    if (!r || r === -1 || !r.blob) throw new Error('export: nothing was written');
    return { ...r, name };
  },
  shape(r, p) {
    return { table: null, file: { name: r.name, blob: r.blob }, values: { rows: r.written, bytes: r.blob.size }, resolved: { ...p, out: r.name }, warnings: [] };
  },
});

// ── gridexport: a grid layer as a FILE, in any of the Export grid… dialog's formats ──────────────
// The same producer as the dialog (src/grid-export.js buildGridExport): the full-resolution grid of
// the band, never the display. .flt arrives as one .zip (.flt + .hdr + provenance). values: nodes, bytes.
const gridExt = (p) => (p.format === 'xyz' ? ({ ',': 'csv', tab: 'txt', ' ': 'xyz' }[p.delim || ','] || 'csv') : (GRID_EXPORT_FMTS.find((f) => f.id === p.format) || GRID_EXPORT_FMTS[0]).ext);
registerTool('gridexport', {
  label: 'grid export',
  writesFile: (p) => p.out || `${String(p.layer || 'grid').replace(/\.[^.]+$/, '')}.${gridExt(p)}`,
  params: {
    layer: { type: 'layer', required: true, doc: 'the grid layer' },
    format: { type: 'enum', values: GRID_EXPORT_FMTS.map((f) => f.id), default: 'asc', doc: 'asc · tif (GeoTIFF float32) · grd7 / grd6 (Surfer binary) · dsaa (Surfer ASCII) · flt (zipped .flt + .hdr) · xyz (nodes)' },
    band: { type: 'int', doc: '1-based band of a multi-band GeoTIFF (default: the band shown)' },
    nodata: { type: 'number', doc: 'the value an empty cell is written as (default: the grid’s own, else -9999; Surfer formats always blank with 1.70141e38)' },
    decimals: { type: 'int', doc: 'text formats: digits after the point (default: float32-exact)' },
    out: { type: 'string', doc: 'the file name (default: the layer’s, with the format’s extension)' },
    delim: { type: 'enum', values: [',', 'tab', ' '], default: ',', doc: 'xyz: the delimiter' },
    header: { type: 'bool', default: true, doc: 'xyz: a header row' },
    valueName: { type: 'string', default: 'z', doc: 'xyz: the value column’s name' },
    skipEmpty: { type: 'bool', default: true, doc: 'xyz: leave empty nodes out' },
    compression: { type: 'enum', values: ['deflate', 'none'], default: 'deflate', doc: 'tif' },
    predictor: { type: 'bool', default: true, doc: 'tif + deflate: floating-point predictor 3' },
    tiles: { type: 'bool', default: false, doc: 'tif: 256×256 tiles instead of strips' },
  },
  outputs: { key: [] },
  async scan(p) {
    const L = layerNamed(p.layer);
    if (!(L.docs && L.docs.gridDoc)) throw new Error(`${L.label || L.name} is not a grid`);
    const bands = gridBandsOf(L);
    if (p.band != null && !(p.band >= 1 && p.band <= bands)) throw new Error(`band: ${L.label || L.name} has ${bands} band${bands === 1 ? '' : 's'}`);
    return buildGridExport(L, {
      format: p.format, band: p.band != null ? p.band - 1 : undefined, nodata: p.nodata, decimals: p.decimals == null ? null : p.decimals,
      name: toolDef('gridexport').writesFile(p), delim: p.delim === 'tab' ? '\t' : p.delim, header: p.header, valueName: p.valueName, skipEmpty: p.skipEmpty,
      compression: p.compression, predictor: p.predictor ? 3 : 1, layout: p.tiles ? 'tiles' : 'strips',
    });
  },
  shape(r, p) {
    return { table: null, file: { name: r.name, blob: r.blob }, values: { nodes: r.grid.nx * r.grid.ny, bytes: r.blob.size }, resolved: { ...p, out: r.name }, warnings: r.notes.slice() };
  },
});

// ── QA as tools: their finding COUNTS are values a check can gate on ("mq.errors = 0") ────────────
const sevCounts = (rows, sevOf, countOf = () => 1) => {
  const o = { errors: 0, warnings: 0, info: 0 };
  for (const r of rows) { const s = sevOf(r), n = countOf(r); if (s === 'error') o.errors += n; else if (s === 'warn' || s === 'warning') o.warnings += n; else o.info += n; }
  return o;
};

// a block model: lattice (duplicates, off-grid centroids, gaps) and every column (blanks, sentinels,
// text in numbers, densities outside 1–6 t/m³, outliers). values: errors / warnings / info (record
// counts over the findings of each severity), findings, blocks
registerTool('modelqa', {
  label: 'model QA',
  params: { layer: { type: 'layer', required: true, doc: 'the block model' } },
  outputs: { key: ['check', 'column'] },
  async scan(p, ctx) { return modelQa(layerNamed(p.layer), { signal: ctx.signal, onProgress: ctx.progress || null }); },
  shape(r, p) {
    const f = qaFindings(r);
    return {
      table: { columns: ['severity', 'check', 'column', 'count', 'note'], key: ['check', 'column'], rows: f.map((x) => [x.sev, x.check, x.column || '', x.count, x.note || '']), units: {} },
      values: { ...sevCounts(f, (x) => x.sev, (x) => x.count), findings: f.length, blocks: r.N },
      resolved: { ...p }, warnings: [],
    };
  },
});

// a drillhole set (the layer and every interval table sharing its collar + survey): collars, surveys,
// doglegs, gaps and overlaps, intervals past the survey. values: errors / warnings / info, findings
registerTool('dhqa', {
  label: 'drillhole QA',
  params: {
    layer: { type: 'layer', required: true, doc: 'a drillhole layer (its whole set is checked)' },
    doglegMax: { type: 'number', default: 10, doc: 'degrees per 30 length units' },
    gapMin: { type: 'number', default: 0.001, doc: 'the shortest gap between intervals that counts' },
    extrapMax: { type: 'number', default: 30, doc: 'how far an interval may run past the deepest survey station' },
  },
  outputs: { key: ['check', 'table', 'row'] },
  async scan(p) {
    const L = layerNamed(p.layer);
    if (!(L.dh && L.docs && L.docs.dhDoc)) throw new Error(`${L.label || L.name} is not a drillhole layer`);
    const members = S.layers.filter((x) => x.dh && x.docs && x.docs.dhDoc && !x.trace && (x === L || (L._setKey && x._setKey === L._setKey)));
    const inp = dhQaInputs(members);
    return drillholeQa(inp.files, { mappings: inp.mappings, dipConvention: inp.dipConvention, doglegMax: p.doglegMax, gapMin: p.gapMin, extrapMax: p.extrapMax });
  },
  shape(r, p) {
    const f = r.findings || [];
    return {
      table: { columns: ['severity', 'check', 'table', 'row', 'hole', 'from', 'to', 'detail'], key: ['check', 'table', 'row'],
        rows: f.map((x) => [x.severity, x.check, x.table || '', x.row == null ? '' : x.row + 1, x.bhid == null ? '' : String(x.bhid), x.from ?? '', x.to ?? '', x.detail || '']), units: {} },
      values: { ...sevCounts(f, (x) => x.severity), findings: f.length },
      resolved: { ...p }, warnings: [],
    };
  },
});

// a mesh: watertight, faces one way, its shells and their volumes. values: watertight and consistent
// (1 / 0), shells, volume, area, triangles, and each topology issue's count
registerTool('meshqa', {
  label: 'mesh QA',
  params: {
    layer: { type: 'layer', required: true, doc: 'the mesh' },
    weld: { type: 'bool', default: true, doc: 'weld coincident vertices first (most exports duplicate them)' },
  },
  outputs: { key: ['shell'] },
  async scan(p) {
    const L = layerNamed(p.layer);
    if (L.kind !== 'mesh') throw new Error(`${L.label || L.name} is not a mesh`);
    const m = await meshVertexData(L);
    if (!m) throw new Error(`${L.label || L.name}: a streamed mesh keeps no triangles to check`);
    return meshQa(m.vertices, m.triangles, { weld: p.weld });
  },
  shape(r, p) {
    const issues = Object.fromEntries(Object.entries(r.issues || {}).map(([k, v]) => [k, v.count]));
    return {
      table: { columns: ['shell', 'triangles', 'closed', 'volume', 'area'], key: ['shell'], rows: r.shells.map((s, i) => [i + 1, s.triangles, s.closed ? 'yes' : 'no', s.volume ?? NaN, s.area]), units: {} },
      values: { watertight: r.watertight ? 1 : 0, consistent: r.consistent ? 1 : 0, shells: r.shells.length, volume: r.volume ?? NaN, area: r.area, triangles: r.triangles, ...issues },
      resolved: { ...p }, warnings: [],
    };
  },
});

// ── the resource cross-tab: tonnage · grade · metal · blocks by a group × grade bins ─────────────
registerTool('xtab', {
  label: 'cross-tab',
  params: {
    layer: { type: 'layer', required: true },
    grade: { type: 'column', required: true },
    group: { type: 'column', default: '', doc: 'a category or painted column (domains, classes); blank = one group' },
    weight: { type: 'expr', default: '', doc: 'density expression; tonnage = density × block volume (blank = volume); on a drillhole layer, × interval length' },
    filter: { type: 'expr', default: '' },
    densUnit: { type: 'string', default: 't/m3' },
    gradeUnit: { type: 'string', default: '' },
    cutoffs: { type: 'any', routine: 'required', why: 'the bins are the cutoffs', doc: 'the grade bin edges (a list, or text: "0.3 0.5 1")' },
    mode: { type: 'enum', values: ['bins', 'cum'], default: 'bins', doc: 'between cutoffs, or above each cutoff' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use filter' },
    measure: { type: 'any', display: true }, flip: { type: 'any', display: true },
  },
  outputs: { key: ['group', 'bin'] },
  check(p, errs) { if (p.cutoffs != null && !(typeof p.cutoffs === 'string' || (Array.isArray(p.cutoffs) && p.cutoffs.every((x) => typeof x === 'number')))) errs.push('cutoffs: a list of numbers, or text like "0.3 0.5 1"'); },
  async scan(p, ctx) {
    const L = layerNamed(p.layer);
    columnCheck(L, p.grade, 'grade'); if (p.group) columnCheck(L, p.group, 'group');
    scopeCheck(p.scope, [L]);
    const cut = Array.isArray(p.cutoffs) ? p.cutoffs.join(' ') : String(p.cutoffs || '');
    return scanXtabOf(L, { grade: p.grade, group: p.group, weight: String(p.weight || ''), filter: p.filter, densUnit: p.densUnit, gradeUnit: p.gradeUnit, cutoffs: cut, scope: p.scope }, ctx.progress, ctx.signal);
  },
  shape(scan, p) {
    const ms = supportMeasure(scan.support || 'volume', scan.weighted, p.gradeUnit), m = xtabModel(scan, p.mode), amount = ms.col, rows = [];
    for (const k of m.rowKeys) for (const c of m.cols) {
      const v = m.cell(k, c);
      rows.push([m.rowLabel(k), c.label, c.lo ?? NaN, c.hi ?? NaN, v.w, xtabValue(v, 'grade', c.blank, scan), xtabValue(v, 'metal', c.blank, scan), v.n]);
    }
    return {
      table: { columns: ['group', 'bin', 'from', 'to', amount, 'grade', ms.metalCol, ms.countCol], key: ['group', 'bin'], rows, units: { [amount]: ms.unit, [ms.metalCol]: ms.metalUnit } },
      values: { [ms.countCol]: scan.n }, resolved: { ...p, cutoffs: scan.edges.slice() },
      warnings: scan.overflow ? ['too many groups — the extra groups were left out'] : [], where: scan.where,
    };
  },
});

// ── tools that MAKE something: a layer, columns, a file. A re-run replaces what an earlier run made
// (same name, made in this session) instead of piling up copies — re-running is running once. ──
const replaceOlder = (id, sameAs) => { for (const x of S.layers.filter((q) => q.id !== id && q.memoryOnly && sameAs(q))) removeLayerUI(x.id); };

// composite: a drillhole interval table → equal-length composites, a new points layer
registerTool('composite', {
  label: 'composite', cache: false, makes: 'layer',   // makes a layer in the session (no table)
  params: {
    layer: { type: 'layer', required: true, doc: 'the drillhole layer' },
    length: { type: 'number', doc: 'the composite length (blank = the commonest interval length)' },
    splitCols: { type: 'any', doc: 'columns whose change starts a new composite (domains)' },
    densityCol: { type: 'column', doc: 'weight the grades by this density' },
    minSupport: { type: 'number', doc: 'drop composites with less coverage than this (0–1)' },
  },
  outputs: { key: [] },
  async scan(p) {
    const L = layerNamed(p.layer);
    if (!(L.dh && L.docs && L.docs.dhDoc)) throw new Error(`${L.label || L.name} is not a drillhole layer`);
    const r = await compositeToLayer(L, { length: p.length || undefined, splitCols: p.splitCols || null, densityCol: p.densityCol || null, minSupport: p.minSupport || null });
    replaceOlder(r.id, (q) => q.name === r.name);
    return { ...r, count: attrRowCountOf(layerById(r.id)) || 0 };
  },
  shape(r, p) { return { table: null, values: { composites: r.count, length: +r.report.length }, layers: [r.name], resolved: { ...p, length: +r.report.length }, warnings: [] }; },
});

// pairing: each sample with the block it falls in — bias, correlation, slope (all, and per group)
registerTool('pairing', {
  label: 'pairing',
  params: {
    model: { type: 'layer', required: true }, samples: { type: 'layer', required: true },
    blockCol: { type: 'column', required: true }, sampleCol: { type: 'column', required: true },
    groupCol: { type: 'column', default: '' },
  },
  outputs: { key: ['group'] },
  async scan(p, ctx) { return pairBlocksSamples(layerNamed(p.model), layerNamed(p.samples), { blockCol: p.blockCol, sampleCol: p.sampleCol, groupCol: p.groupCol, signal: ctx.signal, onProgress: ctx.progress || null }); },
  shape(r, p) {
    const all = r.stats[0] || {};
    return {
      table: { columns: ['group', 'pairs', 'sample_mean', 'block_mean', 'bias', 'r', 'slope'], key: ['group'], rows: r.stats.map((s) => [s.group, s.n, s.sMean, s.bMean, s.bias ?? NaN, s.r ?? NaN, s.slope ?? NaN]), units: {} },
      values: { pairs: r.n, bias: all.bias ?? NaN, r: all.r ?? NaN, slope: all.slope ?? NaN, outside: r.outside, no_block: r.noBlock, no_value: r.noValue },
      resolved: { ...p }, warnings: [],
    };
  },
});

// grade shell: the surface where a model's grade crosses a cutoff, a new mesh layer
registerTool('shell', {
  label: 'grade shell', cache: false, makes: 'layer',
  params: {
    layer: { type: 'layer', required: true }, col: { type: 'column', required: true },
    cutoff: { type: 'number', required: true }, smooth: { type: 'int', default: 0, doc: 'smoothing passes (0–3)' },
    name: { type: 'string', doc: 'the mesh’s name (default: “<col> ≥ <cutoff> shell”)' },
  },
  outputs: { key: [] },
  async scan(p, ctx) {
    const r = await gradeShell(layerNamed(p.layer), { col: p.col, cutoff: p.cutoff, smooth: p.smooth, name: p.name || null, signal: ctx.signal });
    const NL = layerById(r.id); replaceOlder(r.id, (q) => (q.label || q.name) === (NL.label || NL.name));
    return { ...r, label: NL.label || NL.name };
  },
  shape(r, p) { return { table: null, values: { triangles: r.triangles, blocks_inside: r.blocksInside }, layers: [r.label], resolved: { ...p }, warnings: [] }; },
});

// spatial join: columns of another model resampled onto this one's blocks (volume-weighted)
registerTool('join', {
  label: 'spatial join', cache: false, makes: 'columns',   // writes columns (no table)
  params: {
    layer: { type: 'layer', required: true, doc: 'the model that gets the columns' },
    from: { type: 'layer', required: true, doc: 'the model they come from (a compatible lattice)' },
    columns: { type: 'any', required: true, doc: 'the columns to bring, by name' },
    ops: { type: 'any', doc: '{ column: mean | sum | count | coverage } for numbers (default mean); text columns take the majority' },
  },
  outputs: { key: [] },
  check(p, errs) {
    if (p.columns != null && (!Array.isArray(p.columns) || !p.columns.length || p.columns.some((c) => typeof c !== 'string'))) errs.push('columns: a list of column names');
    // the resampler knows these four — any other word used to fall back to the mean, silently
    if (p.ops != null) {
      if (typeof p.ops !== 'object' || Array.isArray(p.ops)) errs.push('ops: a map { column: mean | sum | count | coverage }');
      else for (const [k, v] of Object.entries(p.ops)) if (!['mean', 'sum', 'count', 'coverage'].includes(v)) errs.push(`ops.${k}: “${v}” — use mean, sum, count or coverage`);
    }
  },
  async scan(p) {
    const L = layerNamed(p.layer), R = layerNamed(p.from);
    const ops = Object.fromEntries(Object.entries(p.ops || {}).map(([k, v]) => [`right:${k}`, v]));
    const outs = await spatialJoinToCols(L, R, { cols: p.columns.map((c) => `right:${c}`), ops, weights: {}, useSel: false, replace: true });
    return { outs, layer: L.name };
  },
  shape(r, p) { return { table: null, values: { columns: r.outs.length }, columns: r.outs.map((name) => ({ layer: r.layer, name })), resolved: { ...p }, warnings: [] }; },
});

// reconcile: this model − a reference, on their common lattice → a Δ layer and its summary
registerTool('reconcile', {
  label: 'reconcile', cache: false, makes: 'layer',
  params: {
    layer: { type: 'layer', required: true, doc: 'this model' }, reference: { type: 'layer', required: true, doc: 'the model it is compared with' },
    grade: { type: 'column', required: true, doc: 'a grade column both carry' },
  },
  outputs: { key: [] },
  async scan(p) {
    const r = await reconcileModels(layerNamed(p.layer), layerNamed(p.reference), { weights: {}, useSel: false }, p.grade, { replace: true });
    if (!r) throw new Error('reconcile: no result');
    return r;
  },
  shape(r, p) { return { table: null, values: { matched: r.matched ?? 0, mean_delta: r.meanDelta ?? NaN, mean_abs_delta: r.meanAbsDelta ?? NaN, this_only: r.thisOnly ?? 0, ref_only: r.refOnly ?? 0 }, layers: [r.name], resolved: { ...p }, warnings: [] }; },
});

// section series: a sheet per section position along the section's normal, as PNGs in a zip
registerTool('sections', {
  label: 'section series', cache: false,   // depends on the view (camera, styling)
  writesFile: (p) => p.out || 'sections.zip',
  params: {
    section: { type: 'any', doc: 'the orientation: { axis: x | y | z } or { normal: [x, y, z] }, thickness, clip (default: the current section)' },
    from: { type: 'number', required: true }, to: { type: 'number', required: true }, step: { type: 'number', required: true },
    scale: { type: 'int', default: 1 }, decorations: { type: 'bool', default: true }, title: { type: 'string' },
    out: { type: 'string', doc: 'the zip’s name (default sections.zip)' },
  },
  outputs: { key: [] },
  async scan(p, ctx) {
    if (p.section) setSectionWorld(p.section);
    const r = await renderSectionSeries({ from: p.from, to: p.to, step: p.step, scale: p.scale, decorations: p.decorations, title: p.title || null, signal: ctx.signal });
    return { ...r, name: toolDef('sections').writesFile(p) };
  },
  shape(r, p) { return { table: null, file: { name: r.name, blob: r.blob }, values: { sheets: r.sheets.length }, resolved: { ...p }, warnings: [] }; },
});

// ── scatter / Q-Q: two columns against each other, or two sides' quantiles ─────────────────────
const SIDE_KEYS = ['layer', 'col', 'filter', 'scope'];
registerTool('xy', {
  label: 'scatter / Q-Q',
  params: {
    layer: { type: 'layer', doc: 'the layer (scatter)' },
    mode: { type: 'enum', values: ['scatter', 'qq'], default: 'scatter' },
    x: { type: 'column', doc: 'scatter: the x column' }, y: { type: 'column', doc: 'scatter: the y column' },
    filter: { type: 'expr', default: '' },
    scope: { type: 'enum', values: ['all', 'filtered', 'selection'], default: 'all', routine: ['all'], why: 'a selection isn’t saved with the routine — use filter' },
    logX: { type: 'bool', default: false }, logY: { type: 'bool', default: false }, qqLog: { type: 'bool', default: false },
    line11: { type: 'bool', default: false, doc: 'draw the 1:1 line (scatter)' },
    a: { type: 'any', doc: 'Q-Q: the x side { layer, col, filter, scope }' }, b: { type: 'any', doc: 'Q-Q: the y side { layer, col, filter, scope }' },
  },
  outputs: { key: [] },
  check(p, errs, { routine }) {
    if (p.mode === 'scatter') { if (!p.layer) errs.push('layer: required for a scatter'); if (!p.x || !p.y) errs.push('x, y: the two columns of a scatter'); }
    else for (const k of ['a', 'b']) {
      const s = p[k];
      if (s && typeof s === 'object') for (const key of Object.keys(s)) if (!SIDE_KEYS.includes(key)) errs.push(`${k}: no setting “${key}”${nearest(key, SIDE_KEYS) ? ` — did you mean “${nearest(key, SIDE_KEYS)}”?` : ''}`);
      if (!s || typeof s !== 'object' || !s.layer || !s.col) { errs.push(`${k}: a side { layer, col, filter?, scope? }`); continue; }
      if (routine && s.scope && s.scope !== 'all') errs.push(`${k}.scope: a routine allows "all" (a selection isn’t saved with the routine — use filter)`);
    }
  },
  async scan(p, ctx) {
    if (p.mode === 'qq') {
      const side = (s) => { const L = layerNamed(s.layer); columnCheck(L, s.col, 'column'); return { layerId: L.id, col: s.col, filter: s.filter || '', scope: s.scope || 'all' }; };
      return scanQqOf({ a: side(p.a), b: side(p.b) }, ctx.progress, ctx.signal);
    }
    const L = layerNamed(p.layer); columnCheck(L, p.x, 'x'); columnCheck(L, p.y, 'y'); scopeCheck(p.scope, [L]);
    return scanScatterOf(L, { x: p.x, y: p.y, filter: p.filter, scope: p.scope, logX: p.logX, logY: p.logY }, ctx.progress, ctx.signal);
  },
  chart: (sc, raw) => xySpec(sc, { line11: !!raw.line11, qqLog: !!raw.qqLog }),
  human: (sc) => xyTSV(sc),
  shape(sc, p) {
    if (sc.mode === 'qq') {
      const at = (q, pp) => q[QQ_P.findIndex((x) => Math.abs(x - pp) < 1e-9)], ratio = (pp) => { const a = at(sc.qa, pp); return a ? at(sc.qb, pp) / a : NaN; };
      return { table: { columns: ['p', 'x', 'y'], key: ['p'], rows: QQ_P.map((pp, i) => [pp, sc.qa[i], sc.qb[i]]), units: {} },
        values: { n_x: sc.na, n_y: sc.nb, mean_x: sc.ma, mean_y: sc.mb, p10_ratio: ratio(0.1), p50_ratio: ratio(0.5), p90_ratio: ratio(0.9) }, resolved: { ...p }, warnings: [] };
    }
    const acc = sc.acc, r = scatterR(acc.m), rows = [];
    let table;
    if (!acc.over) { for (let k = 0; k < acc.pts.length; k += 2) rows.push([acc.pts[k], acc.pts[k + 1]]); table = { columns: ['x', 'y'], key: [], rows, units: {} }; }
    else {
      const [x0, x1, y0, y1] = sc.range, ex = (u, l) => (l ? 10 ** u : u);
      for (let j = 0; j < XY_BINS; j++) for (let i = 0; i < XY_BINS; i++) { const c = acc.grid[j * XY_BINS + i]; if (!c) continue; rows.push([ex(x0 + (x1 - x0) * i / XY_BINS, sc.logX), ex(x0 + (x1 - x0) * (i + 1) / XY_BINS, sc.logX), ex(y0 + (y1 - y0) * j / XY_BINS, sc.logY), ex(y0 + (y1 - y0) * (j + 1) / XY_BINS, sc.logY), c]); }
      table = { columns: ['x_from', 'x_to', 'y_from', 'y_to', 'count'], key: ['x_from', 'y_from'], rows, units: {} };
    }
    return { table, values: { n: acc.n, r, ...(acc.offLog ? { off_log: acc.offLog } : {}) }, resolved: { ...p }, warnings: acc.offLog ? [`${acc.offLog} pair${acc.offLog === 1 ? '' : 's'} ≤ 0 left off the log axis`] : [] };
  },
});
