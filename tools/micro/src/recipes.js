// micro recipes — recipes (an analysis window's setup as a YAML file in recipes/)
// and ROUTINES that chain them: each-blocks over a parameter table, inline steps,
// ask-first inputs, reports written per step, pre-flight checks, running them and the
// run tracker. The routine editor and the inputs dialog are src/routine-ui.js. Carved
// from index.html (phase 3).
import { compileBool, compileValue, validate } from '../../../ext/expr/index.js';
import { basename, removeFileAt, resolveFileHandle } from './paths.js';
import { S } from './state.js';
import { openSheet as xlsxOpenSheet } from '../../../ext/sheet/index.js';
import { floatWin } from './windows.js';
import { layerTableHeader, schemaExt } from './records.js';
import { emit as yamlEmit, mapEntry as yamlEntry, mapNode as yamlMap, parse as yamlParse, scalar as yamlScalar, seqNode as yamlSeq } from '../../../ext/yaml/index.js';
import { openGradeTonnage } from './gt.js';
import { openStats } from './stats.js';
import { openXyPlot } from './xyplot.js';
import { openSwath } from './swath.js';
import { openCrosstab } from './xtab.js';
import { gridAxesOf } from './grid-ops.js';
import { menuXY } from './menu.js';
import { microConfirm, microPrompt } from './prompts.js';
import { collarCells, csvRecords } from './drillholes.js';
import { markProjectDirty } from './project.js';
import { openSolidRecipeConfigured, runSolidRecipe } from './bygeom-ui.js';
import { runFigureRecipe } from './deco.js';
import { applyCalcCols, layerHasColumn } from './calc.js';
import { resultToLayer } from './analysis-ui.js';
import { openInputsDialog, openRoutineWindow } from './routine-ui.js';
import { compoPage, writePages, addResourceFrame } from './composer.js';
import { openValidation } from './validation.js';
import { openContact } from './contact.js';
import { openFactors } from './factors.js';
import { checkParams, runTool, tableTSV, toolDef } from './tools.js';
import { newRunRecord, writeRecord, outputEntry, localDate, findBaseline, recordTable, stepFingerprints, stepKey, findCachedStep, copyOutputs, runRoot, setRunRoot } from './runrecord.js';
import { openRunsWindow, acceptRunAsk } from './runs-ui.js';
import { openRecipeForm } from './recipe-form.js';
import { openLibraryWindow } from './library.js';
import { evalScalarCheck, evalEveryCheck, compareTables, parseTSV, flatValues } from './checks.js';
export { localDate };
const $ = (s) => document.querySelector(s);

// ── RECIPES: named, re-runnable analysis setups as YAML FILES in the project
// folder (recipes/<slug>.yaml). A recipe is DATA — the same op-shaped
// { tool, params } the windows already serialize — never code (@gcu/yaml is a
// strict, tag-free subset, so a recipe file provably can't carry a script).
// Files are the interface: comment them, copy them between projects, drop one
// in and Scan folder picks it up. Series reference layers BY NAME; a missing
// primary gets a one-question remap — that prompt IS the parameter binding. ──
export const RECIPE_TOOLS = { gt: 'grade-tonnage', swath: 'swath', stats: 'stats', xy: 'scatter / Q-Q', figure: 'figure', compo: 'composer page', calccols: 'calc columns', solid: 'by solid / surface', validation: 'validation', contact: 'contact analysis', factors: 'reconciliation factors', resource: 'resource table', export: 'export', modelqa: 'model QA', dhqa: 'drillhole QA', meshqa: 'mesh QA', xtab: 'cross-tab', composite: 'composite', pairing: 'pairing', shell: 'grade shell', join: 'spatial join', reconcile: 'reconcile', sections: 'section series', routine: 'routine' };

export const recipeSlug = (name) => (String(name).toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe');

// ── the ROUTINE — a recipe that runs recipes (the automation ladder, layer 2).
// tool: "routine", params.steps: plain steps ({recipe, …overrides, as}) and
// `each` blocks — a group of steps run once per ROW of a parameter table.
// `each` takes rows (a list of maps), columns (a map of EQUAL-length lists,
// zipped — never a cross-product), or {from: "params.csv"} (a table file in
// the project). $var marks where each value lands. Expansion is a MACRO —
// static, no expressions, enumerable before anything runs — so the opt-in
// guard ({guard: "no-overwrites"}) can dry-pass every output first.
// Analysis steps write <slug>.tsv into the run's own folder,
// runs/<local date> <hhmm> <routine>/ (src/runrecord.js); params.output =
// {dir, prefix, suffix} overrides. A failed step stops the routine visibly, window left open.
export function routineEachRows(each) {
  if (Array.isArray(each)) return each.map((r) => ({ ...r }));         // rows
  if (each && each.from) return { from: String(each.from) };           // resolved async by the runner
  if (each && typeof each === 'object') {                              // columns (zipped)
    const keys = Object.keys(each);
    const lens = keys.map((k) => (Array.isArray(each[k]) ? each[k].length : -1));
    if (!keys.length || lens.some((l2) => l2 < 0)) throw new Error('each: column form needs lists');
    if (new Set(lens).size !== 1) throw new Error(`each: column lists must be EQUAL length (got ${lens.join(' / ')})`);
    return Array.from({ length: lens[0] }, (_, i) => Object.fromEntries(keys.map((k) => [k, each[k][i]])));
  }
  throw new Error('each: rows (a list), columns (a map of lists), or {from: "file.csv"}');
}

export const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;

export const routineLookup = (scope, path) => path.split('.').reduce((o, k) => (o != null && typeof o === 'object' && k in o ? o[k] : undefined), scope);

// the scope, flattened to DOTTED NAMES — namespaces by convention, which is all
// @gcu/expr needs (a dotted name is a name, not member access)
export function routineFlat(scope, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(scope || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) routineFlat(v, key, out);
    else out[key] = v;
  }
  return out;
}

// ${ expr } — an @gcu/expr expression over the scope. The SAME language as the
// filter box and ƒ columns; pure, no eval, Sealed-safe. It computes VALUES, not
// STRUCTURE: the step list stays enumerable before anything runs, which is the
// whole difference from embedding a scripting language.
export function routineEval(src, scope) {
  const flat = routineFlat(scope);
  const names = Object.keys(flat);
  const schema = names.map((n) => ({ name: n, type: typeof flat[n] === 'number' ? 'number' : 'string' }));
  const v = validate(src, schema);                          // compileValue is permissive (unknown → null) —
  if (!v.ok) {                                              // validate FIRST so a typo fails loudly, not silently
    const e = v.errors[0];
    throw new Error(`\${${src}}: ${e.message}${e.kind === 'column' ? ` (have: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''})` : ''}`);
  }
  const fn = compileValue(src, schema, { decimal: '.' });
  return fn(names.map((n) => flat[n]));
}

// `filter:` on an each block — a PREDICATE over the parameter table's rows.
// The row's own columns are bare names (bench, active) and the enclosing scope
// is visible dotted (g.floor), so a filter can compare a row against a scalar.
export function routineFilterRows(rows, src, scope) {
  if (!rows.length) return rows;
  const outer = routineFlat(scope);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const names = [...cols, ...Object.keys(outer).filter((n) => !cols.includes(n))];
  const typeOf = (n) => (cols.includes(n)
    ? (rows.some((r) => typeof r[n] === 'number') ? 'number' : 'string')
    : (typeof outer[n] === 'number' ? 'number' : 'string'));
  const schema = names.map((n) => ({ name: n, type: typeOf(n) }));
  const v = validate(src, schema);                          // a typo names itself instead of quietly matching nothing
  if (!v.ok) {
    const e = v.errors[0];
    throw new Error(`each filter "${src}": ${e.message}${e.kind === 'column' ? ` (have: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''})` : ''}`);
  }
  const fn = compileBool(src, schema, { decimal: '.' });
  return rows.filter((r) => {
    const rec = names.map((n) => (cols.includes(n) ? r[n] : outer[n]));
    try { return !!fn(rec); } catch { return false; }
  });
}

export function routineSubst(v, scope) {
  if (typeof v === 'string') {
    const exact = v.match(/^\$\{([\s\S]+)\}$/);           // exact "${ … }" → the TYPED value
    if (exact) return routineEval(exact[1].trim(), scope);
    if (v.startsWith('$') && PATH_RE.test(v.slice(1))) {   // exact "$g.cutoff" → the TYPED value (shorthand)
      const hit = routineLookup(scope, v.slice(1));
      if (hit !== undefined) return hit;
    }
    let out = v.replace(/\$\{([^{}]+)\}/g, (m, src) => {   // embedded ${…} → text
      const r = routineEval(src.trim(), scope);
      return r == null ? '' : String(r);
    });
    return out.replace(/\$([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/g, (m, k) => {   // embedded $name → text
      const hit = routineLookup(scope, k);
      return hit !== undefined && typeof hit !== 'object' ? String(hit) : m;
    });
  }
  if (Array.isArray(v)) return v.map((x) => routineSubst(x, scope));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, routineSubst(x, scope)]));
  return v;
}

// {from}: a CSV or worksheet in the project → { columns, rows, sheet }.
// "params.xlsx#Bench targets" — the sheet rides after the hash.
export async function routineReadTableFull(name) {
  const [path, sheetName] = String(name).split('#');
  const own = _overlay && _overlay.tables && (_overlay.tables[path] || _overlay.tables['recipes/' + path]);   // a pack's own table
  const fh = own ? { getFile: async () => (own instanceof Blob ? own : new File([own.text != null ? own.text : own], path)) } : await resolveFileHandle(runRoot(), path).catch(() => resolveFileHandle(runRoot(), 'recipes/' + path));
  if (/\.xlsx$/i.test(path)) {
    const doc = await xlsxOpenSheet(await fh.getFile(), { sheet: sheetName || null });
    const h = doc.header;
    // Excel types a column by its CONTENTS: one blank cell in a value column and
    // the whole column reads as text ('55'), which would quietly feed a string
    // to a numeric parameter. A parameter/run table is heterogeneous by nature,
    // so numeric-looking values coerce here — the same rule the CSV path uses.
    // (Data tables keep Excel's types untouched; this is the ROUTINE reader.)
    const coerce = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : v);
    const rows = Array.from({ length: h.count }, (_, r) => {
      const row = doc.at(r);
      return Object.fromEntries(h.columns.map((c, i) => [c, coerce(row[i])]));
    });
    return { columns: h.columns, rows, sheet: h.sheet };
  }
  const lines = csvRecords(await (await fh.getFile()).text());
  const cells2 = collarCells(lines);
  const columns = cells2(lines[0]);
  const rows = lines.slice(1).map((ln) => { const c = cells2(ln); return Object.fromEntries(columns.map((h, i2) => [h, c[i2] !== undefined && c[i2] !== '' && Number.isFinite(+c[i2]) ? +c[i2] : c[i2]])); });
  return { columns, rows, sheet: basename(path).replace(/\.[^.]+$/, '') };
}

export const routineReadTable = async (name) => (await routineReadTableFull(name)).rows;

// ── the PARAMS block: a parameter SHEET, not a run table ─────────────────────
// The workbook you actually keep has run tables (one row per run) AND a
// key→value sheet — "General", parameter | value — that is a series, not a
// fan-out. `params:` reads one into a SCALAR SCOPE the whole routine sees:
//
//   params:
//     - from: "params.xlsx#General"     # → $general.cutoff, $general.density
//       as: g                           # namespace (default: the sheet name)
//       index: parameter                # key column (default: the first)
//       value: value                    # value column (default: the second,
//                                       #   when the sheet has exactly two)
//       fill: 0                         # what an empty cell means
//
// More than two columns and no `value:` → the whole row is reachable:
// $g.hem.cutoff, $g.hem.price. `value: [cutoff, price]` restricts to those.
// An `each` row's variables SHADOW these, so a run table can override a global.
export const routineKey = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export async function routineLoadParams(specs) {
  const scope = {};
  const report = [];
  for (const spec of (Array.isArray(specs) ? specs : [specs]).filter(Boolean)) {
    if (!spec.from) throw new Error('params: needs `from` (a table or worksheet in the project)');
    const { columns, rows, sheet } = await routineReadTableFull(spec.from);
    if (!columns.length) throw new Error(`params: "${spec.from}" has no columns`);
    const idxCol = spec.index || columns[0];
    if (!columns.includes(idxCol)) throw new Error(`params: index column "${idxCol}" is not in ${spec.from} (${columns.join(', ')})`);
    let valCols;
    if (spec.value) {
      valCols = (Array.isArray(spec.value) ? spec.value : [spec.value]);
      for (const c of valCols) if (!columns.includes(c)) throw new Error(`params: value column "${c}" is not in ${spec.from} (${columns.join(', ')})`);
    } else if (columns.length === 2) valCols = [columns.find((c) => c !== idxCol)];   // the classic parameter|value sheet
    else valCols = columns.filter((c) => c !== idxCol);                               // wide sheet → the whole row, dotted
    const single = valCols.length === 1 && (spec.value ? !Array.isArray(spec.value) : true);
    const fill = spec.fill;
    const val = (v) => (v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? (fill !== undefined ? fill : '') : v);
    const obj = {};
    for (const r of rows) {
      const k = routineKey(r[idxCol]);
      if (!k) continue;
      obj[k] = single ? val(r[valCols[0]]) : Object.fromEntries(valCols.map((c) => [routineKey(c), val(r[c])]));
    }
    const ns = spec.as === '' || spec.as === null ? '' : (spec.as || routineKey(sheet) || 'params');
    if (ns) scope[ns] = { ...(scope[ns] || {}), ...obj };
    else Object.assign(scope, obj);                        // as: "" → merged flat ($cutoff, not $g.cutoff)
    report.push(`${spec.from} → ${ns ? '$' + ns + '.' : '$'}${Object.keys(obj).slice(0, 3).join(', ')}${Object.keys(obj).length > 3 ? '…' : ''}`);
  }
  return { scope, report };
}

export function routineCheckStep(st) {                            // inline steps carry `tool:` — must be a runnable one
  if (!st.recipe && st.tool && (!RECIPE_TOOLS[st.tool] || st.tool === 'routine')) {
    throw new Error(`unknown tool "${st.tool}" (inline steps take ${Object.keys(RECIPE_TOOLS).filter((t) => t !== 'routine').join(' / ')})`);
  }
  // a step's own `filter:` filters an each block's ROWS; on a recipe / tool step it is nobody's — the
  // tool never sees it (routineStepOp keeps step keywords out of the settings). Refuse, never drop it.
  if ((st.recipe || st.tool) && st.filter !== undefined) {
    throw new Error(`step “${st.as || st.recipe || st.tool}”: filter at the step’s top level is a step keyword (it filters an each block’s rows), not the tool’s setting — put it under with:`);
  }
}

// `each` is a STEP, and its body is steps — so an each INSIDE an each simply
// nests, and nesting is a CROSS PRODUCT (every bench × every domain). One each
// with two equal-length columns is a ZIP (paired, not crossed): that is the
// difference, and both show plainly in Preview because expansion is a macro.
// `as` on an each/params step names a SCOPE (→ $b.grade); `as` on a recipe/tool
// step names the REPORT (they are different kinds of step).
export async function expandSteps(steps, scope, tags, out) {
  for (const st of steps || []) {
    if (st.guard) { out.push({ guard: String(st.guard) }); continue; }
    if (st.params !== undefined) {                         // binds names FORWARD (and only within this block)
      const { scope: add } = await routineLoadParams(st.params);
      scope = { ...scope, ...add };
      continue;
    }
    if (st.each !== undefined) {
      let rows = routineEachRows(st.each);
      if (rows.from) rows = await routineReadTable(rows.from);
      if (st.filter && String(st.filter).trim()) rows = routineFilterRows(rows, String(st.filter).trim(), scope);
      for (const row of rows) {
        const bound = st.as ? { [String(st.as)]: row } : row;   // as: b → $b.grade; absent → $grade
        const tag = Object.values(row).map((v) => recipeSlug(String(v))).join('-');
        await expandSteps(st.steps, { ...scope, ...bound }, tag ? [...tags, tag] : tags, out);
      }
      continue;
    }
    if (st.check !== undefined || st.compare !== undefined) {   // judged at run time, over the results so far
      const sub = { ...st };
      if (typeof sub.check === 'string') sub.check = routineSubst(sub.check.replace(/\$\{/g, '\u0000'), scope).replace(/\u0000/g, '${');   // $row vars fill in; ${…} is not a macro here
      if (sub.check && typeof sub.check === 'object') sub.check = { ...sub.check, in: routineSubst(String(sub.check.in || ''), scope) };
      if (sub.compare) sub.compare = routineSubst(String(sub.compare), scope);
      const base = recipeSlug(sub.as || (sub.compare ? `${sub.compare}-compare` : 'check'));
      out.push({ ...sub, _slug: [base, ...tags].join('-') });
      continue;
    }
    if (st.recipe || st.tool) {
      const sub = routineSubst(st, scope);
      routineCheckStep(sub);
      const base = recipeSlug(sub.as || sub.recipe || sub.tool);
      out.push({ ...sub, _slug: [base, ...tags].join('-') });   // the slug carries every enclosing row
      continue;
    }
    throw new Error('a step needs `recipe`, `tool`, `each`, `params`, `check`, `compare`, or `guard`');
  }
}

export async function expandRoutine(params) {
  const out = [];
  // top-level `params:` is a PRELUDE — sugar for a params step at the front
  const base = params.params ? (await routineLoadParams(params.params)).scope : {};
  await expandSteps(params.steps, base, [], out);
  return out;
}

// what a step WRITES — reports (files) and columns (on a layer). The guard and
// the preview both read this, so "what will this overwrite?" has ONE answer.
export function routineTargets(tool, params, slug, P) {
  const t = { reports: [], columns: [], figures: [], layers: [] };
  const mk = toolDef(tool) && toolDef(tool).makes;
  if (mk === 'layer') t.layers.push(`a new layer (${toolDef(tool).label})`);   // composite, grade shell, reconcile — no table
  else if (mk === 'columns') { for (const c of params.columns || []) if (typeof c === 'string') t.columns.push({ layer: params.layer, name: c, kind: 'joined' }); }   // spatial join
  else if (toolDef(tool) && toolDef(tool).writesFile) t.reports.push(`${routineOutDir(P)}/${toolDef(tool).writesFile(params || {})}`);   // a file (export)
  else if (toolDef(tool) || tool === 'xy') t.reports.push(routineOutPath(P, slug));   // every other registered tool writes its table
  else if (tool === 'calccols') {
    const layer = params.layer;
    for (const c of params.cols || []) if (c && c.name) t.columns.push({ layer, name: c.name, kind: 'ƒ' });
  } else if (tool === 'figure') {
    if (params.out) t.figures.push(String(params.out));
  } else if (tool === 'compo') {
    if (params.out) t.figures.push(String(params.out));
    if (params.book && !t.figures.includes(String(params.book))) t.figures.push(String(params.book));
  } else if (tool === 'solid') {
    if (params.do === 'flag') for (const layer of params.targets || []) t.columns.push({ layer, name: params.column, kind: 'flag' });
    else if (params.do === 'ratio' && params.model) t.columns.push({ layer: params.model, name: params.column, kind: 'fraction' });
  }
  return t;
}

// a run's reports go into its own folder (runs/<local date> <hhmm> <routine>/, src/runrecord.js) —
// output.dir sends them elsewhere. Before a run exists (Preview) the path says so.
export const routineOutDir = (P) => (P.output && P.output.dir) || P._runDir || 'runs/(this run)';

export const routineOutPath = (P, slug) => `${routineOutDir(P)}/${(P.output && P.output.prefix) || ''}${slug}${(P.output && P.output.suffix) || ''}.tsv`;

// one expanded step → its display line. The expansion list is the routine's
// spine: the editor previews it (clickable — open a step configured), the
// run tracker walks it live, and afterwards it stands as the run's summary.
export function routineLineInfo(st, i, P) {
  if (st.guard) return { text: `${i + 1}. guard — stop if anything below already exists`, guard: true };
  if (st.check !== undefined) {
    const c = st.check, what = typeof c === 'string' ? c : `every row of ${c.in}: ${c.every}${c.against ? ' (against the baseline)' : ''}`;
    return { text: `${i + 1}. check — ${what}${st.level === 'warn' ? '   (warn)' : ''}${st.say ? `   “${st.say}”` : ''}` };
  }
  if (st.compare !== undefined) return { text: `${i + 1}. compare ${st.compare} with the baseline run  →  ${routineOutPath(P, st._slug)}${st.tolerance != null ? `   (tolerance ${st.tolerance})` : ''}` };
  const rc = st.recipe ? recipeNamed(st.recipe) : null;
  const tool = st.recipe ? rc && rc.tool : st.tool;
  const label = st.recipe || (st.tool ? `${RECIPE_TOOLS[st.tool]} (inline)` : '(pick a recipe)');
  const params = routineStepOp(st).params;
  const t = tool ? routineTargets(tool, params, st._slug, P) : { reports: [], columns: [], figures: [] };
  // every step says what it WRITES — a report path, a column, a figure, or nothing
  const wrote = [
    ...t.reports.map((r) => `→  ${r}`),
    ...t.columns.map((c) => `→  ${c.layer || 'layer'} · ${c.kind} column “${c.name}”${layerHasColumn(c.name, c.layer) ? ' (replaces)' : ''}`),
    ...t.figures.map((f) => `→  ${f}`),
    ...(t.layers || []).map((x) => `→  ${x}`),
  ];
  return {
    text: `${i + 1}. ${label}${wrote.length ? '  ' + wrote.join('  ') : '   (opens only)'}${st.recipe && !rc ? '   ⚠ recipe not found' : ''}`,
    openable: ['gt', 'swath', 'stats', 'xy', 'interp', 'contact', 'factors'].includes(tool) && !(st.recipe && !rc),
  };
}

// merge an expanded step into the op runRecipe takes (recipe params ⊕ overrides,
// or the inline step's own params)
export const STEP_KEYS = ['recipe', 'tool', 'as', '_slug', 'each', 'steps', 'params', 'guard', 'filter', 'emit', 'with', 'cache'];
export function routineStepOp(st) {
  const rc = st.recipe ? recipeNamed(st.recipe) : null;
  // settings belong under `with:` — a step's own keywords (as, emit, filter on an each, …) can then
  // never swallow a tool setting of the same name (an inline step's `filter:` was silently dropped).
  // The older form, settings mixed into the step, still merges, minus the keywords.
  const extras = Object.fromEntries(Object.entries(st).filter(([k]) => !STEP_KEYS.includes(k)));
  const own = st.with && typeof st.with === 'object' ? st.with : {};
  return { name: rc ? rc.name : st._slug, tool: rc ? rc.tool : st.tool, params: { ...(rc ? rc.params : {}), ...extras, ...own } };
}

// the run tracker: the expanded list with live per-step state (· ▶ ✓ ✗),
// step n/N in the title, and a between-steps Cancel. Stays open afterwards
// as the run's summary.
export function openRoutineTracker(rname, steps, P) {
  const win = floatWin({ title: `routine · ${rname}`, sub: `step 0/${steps.length}`, x: innerWidth - 510, y: 74, w: 480, h: Math.min(120 + steps.length * 17, innerHeight - 130) });
  win.el.dataset.routineRun = '1';
  win.body.className += ' rw-body';
  const lines = steps.map((st, i) => {
    const row = document.createElement('div'); row.className = 'rw-prevline';
    const ic = document.createElement('span'); ic.className = 'rw-state'; ic.textContent = '·';
    row.append(ic, document.createTextNode(routineLineInfo(st, i, P).text));
    win.body.appendChild(row);
    return { row, ic };
  });
  const bar = document.createElement('div'); bar.className = 'rw-bar'; bar.style.marginTop = '6px';
  const cancelB = document.createElement('button'); cancelB.className = 'awin-btn'; cancelB.textContent = 'Cancel';
  cancelB.title = 'stop after the current step finishes (nothing half-written)';
  let cancelled = false;
  cancelB.onclick = () => { cancelled = true; cancelB.textContent = 'cancelling after this step…'; cancelB.disabled = true; };
  const sum = document.createElement('span'); sum.className = 'lbl';
  bar.append(cancelB, sum);
  win.body.appendChild(bar);
  return {
    el: win.el,
    cancelled: () => cancelled,
    state(i, st2, msg, cls) {
      const L2 = lines[i]; if (!L2) return;
      L2.ic.textContent = st2 === 'run' ? '▶' : st2 === 'ok' ? '✓' : st2 === 'fail' ? '✗' : st2 === 'skip' ? '–' : '·';
      L2.ic.className = 'rw-state ' + st2;
      if (msg) { const m = document.createElement('div'); m.className = 'rw-prevline ' + (cls || (st2 === 'ok' ? 'warn' : 'fail')); m.textContent = '     ' + msg; L2.row.after(m); }
      win.sub.textContent = `step ${Math.min(i + 1, steps.length)}/${steps.length}`;
      if (L2.row.scrollIntoView) L2.row.scrollIntoView({ block: 'nearest' });
    },
    done(msg, actions) {
      cancelB.remove(); sum.textContent = msg; win.sub.textContent = '';
      for (const [label, fn, title, keep] of (actions || [])) {   // e.g. Retry / Resume after a stop; keep: the tracker stays (Accept)
        const btn = document.createElement('button'); btn.className = 'awin-btn'; btn.textContent = label;
        if (title) btn.title = title;
        btn.onclick = async () => { if (!keep) { win.el.remove(); fn(); return; } btn.disabled = true; const ok = await fn(); if (!ok) btn.disabled = false; else btn.textContent = 'accepted ✓'; };
        bar.insertBefore(btn, sum);
      }
    },
  };
}

export function routineLayerNames(rc) {                           // the layer names a recipe's params reference
  const p2 = rc.params || {};
  const names = [];
  // a registered tool says which of its settings name layers (its list: type layer) — a setting
  // that merely shares a name (the section series' from: 5) is not taken for a layer
  const def = rc.tool && toolDef(rc.tool);
  if (def) {
    for (const [k, spec] of Object.entries(def.params)) if (spec.type === 'layer' && typeof p2[k] === 'string' && p2[k]) names.push(p2[k]);
    // a list whose items name layers (the factors tool's volumes: one mesh per period) — every one is an input
    for (const [k, spec] of Object.entries(def.params)) if (spec.type === 'list' && spec.item && k !== 'series' && Array.isArray(p2[k])) for (const it of p2[k]) for (const [ik, isp] of Object.entries(spec.item)) if (isp.type === 'layer' && it && typeof it[ik] === 'string' && it[ik]) names.push(it[ik]);
    for (const ser of (Array.isArray(p2.series) ? p2.series : [])) if (ser && ser.layer) names.push(ser.layer);
    return names;
  }
  if (p2.layer) names.push(p2.layer);
  for (const ser of p2.series || []) if (ser.layer) names.push(ser.layer);
  if (p2.source) names.push(String(p2.source).split(':')[0]);
  if (p2.target) names.push(p2.target);
  if (p2.model) names.push(p2.model);
  if (p2.samples) names.push(p2.samples);
  if (rc.tool === 'solid') {                                // by-geometry: its solid/surface, a lower surface, the targets
    if (p2.geometry) names.push(String(p2.geometry));
    if (p2.lower) names.push(String(p2.lower));
    for (const t of (Array.isArray(p2.targets) ? p2.targets : [])) if (t) names.push(String(t));
  }
  return names;
}

// every problem a routine would hit, before anything runs (and without running anything): missing
// recipes and layers, tool settings checked the way a routine needs them, columns a layer lacks, two
// steps writing one report, and — past a guard — outputs that already exist. A resume skips the
// guard (it has written some of them by design). → { problems: [..] }
export async function routinePreflight(r, steps, { resume = false } = {}) {
  const P = r.params || {}, problems = [];
  const byName = new Map([...S.recipes, ...((_overlay && _overlay.recipes) || [])].map((x) => [x.name, x]));
  const missingR = [...new Set(steps.filter((st) => st.recipe && !byName.get(st.recipe)).map((st) => st.recipe))];
  if (missingR.length) problems.push(`missing recipe${missingR.length > 1 ? 's' : ''} — ${missingR.join(', ')}`);
  const loaded = new Set(S.layers.map((x) => x.name)), missingL = new Set();
  for (const st of steps) if (!st.guard) for (const nm of routineLayerNames(routineStepOp(st))) if (nm && !loaded.has(nm)) missingL.add(nm);
  if (missingL.size) problems.push(`load these layers first — ${[...missingL].join(', ')} (routines run without prompts)`);
  // the settings of every registered tool's step (src/tools.js): unknown ones name the nearest real
  // one, cutoffs and band widths are stated, the scope is all
  steps.forEach((st, i) => {
    if (st.guard) return;
    const op = routineStepOp(st);
    if (!toolDef(op.tool)) return;
    for (const e of checkParams(op.tool, op.params, { routine: true }).errors) problems.push(`step ${i + 1} (${st._slug}): ${e}`);
  });
  // a referenced column must resolve on its layer (a renamed one would read as a blank → 0)
  const badCols = [];
  for (const st of steps) {
    if (st.guard) continue;
    const pr = routineStepOp(st).params, cols = [];
    for (const ser of pr.series || []) if (ser.col) cols.push({ layer: ser.layer || pr.layer, col: ser.col });
    if (pr.col) cols.push({ layer: pr.layer, col: pr.col });
    for (const { layer, col } of cols) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(col).trim())) continue;
      const L2 = S.layers.find((x) => x.name === layer); const h2 = L2 && layerTableHeader(L2);
      if (h2 && !validate(String(col).trim(), schemaExt(L2, h2)).ok) badCols.push(`${col}${layer ? ' on ' + layer : ''}`);
    }
  }
  if (badCols.length) problems.push(`column${badCols.length > 1 ? 's' : ''} not found — ${[...new Set(badCols)].join(', ')} (renamed or removed?)`);
  // two steps writing the same report
  { const seen = new Set(), dup = new Set();
    for (const st of steps) { if (st.guard) continue; const op = routineStepOp(st); for (const rep of routineTargets(op.tool, op.params, st._slug, P).reports) { if (seen.has(rep)) dup.add(rep); else seen.add(rep); } }
    if (dup.size) problems.push(`two steps would write the same report — ${[...dup].join(', ')} (give each its own \`as:\`)`); }
  // the opt-in GUARD: an output past it that already exists (a run's own folder is new — reports
  // collide only in a fixed output.dir; columns always count)
  const guardAt = resume ? -1 : steps.findIndex((st) => st.guard === 'no-overwrites');
  if (guardAt >= 0) for (const st of steps.slice(guardAt + 1)) {
    if (st.guard) continue;
    const op = routineStepOp(st), t = routineTargets(op.tool, op.params, st._slug, P);
    if (P.output && P.output.dir) for (const rep of t.reports) if (await resolveFileHandle(runRoot(), rep).then(() => true, () => false)) problems.push(`guard stopped — ${rep} already exists`);
    for (const c of t.columns) if (layerHasColumn(c.name, c.layer)) problems.push(`guard stopped — ${c.layer || 'the layer'} already has a column “${c.name}”`);
  }
  return { problems };
}


// a pack's own recipes and tables (a routine run from the Library: nothing written into a project)
let _overlay = null;
export function recipeNamed(name) { return ((_overlay && _overlay.recipes) || []).find((x) => x.name === name) || S.recipes.find((x) => x.name === name) || null; }
// opts.root: where the run writes (default the project); opts.pack: its own recipes + tables;
// opts.onFinish(status, record) / opts.onAccept(): a run without a project packages its outputs
export async function runRoutine(r, opts = {}) {
  const prevRoot = setRunRoot(opts.root || null), prevOv = _overlay;
  _overlay = opts.pack || null;
  try { return await runRoutineInner(r, opts); } finally { setRunRoot(prevRoot); _overlay = prevOv; }
}
async function runRoutineInner(r, opts) {
  const carry = { root: opts.root, pack: opts.pack, onFinish: opts.onFinish, onAccept: opts.onAccept, token: opts.token };
  // events for a host (window.micro.runRoutine): micro:routine-step per step, micro:routine-done once
  // at the end, whatever the end — refused, cancelled, failed, ok — with a copy of the record
  const done = (status, extra = {}, rr = null) => {
    dispatchEvent(new CustomEvent('micro:routine-done', { detail: { routine: r.name, token: opts.token || null, status, record: rr ? JSON.parse(JSON.stringify(rr)) : null, ...extra } }));
    if (opts.onFinish && rr) Promise.resolve(opts.onFinish(status, rr)).catch((e) => { $('#meta').textContent = `routine: ${e.message}`; });
  };
  const stepEvt = (n, step, status) => dispatchEvent(new CustomEvent('micro:routine-step', { detail: { routine: r.name, token: opts.token || null, n, step, status } }));
  if (!runRoot()) { $('#meta').textContent = 'routine: a run needs somewhere to write — open a project, or run it from the Library without one'; done('refused', { problems: ['no project open'] }); return; }
  const P = r.params || {};
  let steps;
  // a resume continues THIS run: the same expansion (a params table edited since must not reshuffle
  // the steps) and the atlas pages already made (the book is written when the routine finishes)
  try { steps = opts.steps || await expandRoutine(P); } catch (e) { $('#meta').textContent = `routine: ${e.message}`; done('refused', { problems: [e.message] }); return; }
  const byName = new Map([...S.recipes, ...((_overlay && _overlay.recipes) || [])].map((x) => [x.name, x]));
  { const pf = await routinePreflight(r, steps, { resume: !!opts.record });
    if (pf.problems.length) { $('#meta').textContent = `routine: ${pf.problems.slice(0, 4).join(' · ')}${pf.problems.length > 4 ? ` · +${pf.problems.length - 4} more` : ''}`; done('refused', { problems: pf.problems }); return; } }
  // the RUN RECORD (src/runrecord.js): a new run gets its own folder; a resume, retry or skip
  // continues the same record and logs the event
  let rec = opts.record || null;
  if (!rec) {
    const names = [...new Set(steps.filter((st) => !st.guard).flatMap((st) => routineLayerNames(routineStepOp(st))).filter(Boolean))];
    try { rec = await newRunRecord(r, steps, names, (m) => { $('#meta').textContent = `routine “${r.name}” — ${m}`; }); }
    catch (e) { $('#meta').textContent = `routine: the run record could not start — ${e.message}`; done('refused', { problems: [e.message] }); return; }
  } else rec.events.push({ at: new Date().toISOString(), kind: opts.event || 'resume', step: (opts.from || 0) + 1 });
  if (opts.event === 'skip' && rec.steps[(opts.from || 1) - 1]) rec.steps[(opts.from || 1) - 1].status = 'skipped';
  const PR = { ...P, _runDir: rec.dir };
  // RESULTS by step name (its `as`, and its full slug inside an each) — what checks read. A resume
  // rebuilds the earlier steps' from the record. The BASELINE: the run this one is judged against.
  const results = new Map(), slugOf = new Map();   // slugOf: a name (an `as`) → the full slug it last named
  const keep = (st, val) => { results.set(st._slug, val); slugOf.set(st._slug, st._slug); if (st.as) { results.set(String(st.as), val); slugOf.set(String(st.as), st._slug); } };
  for (let k = 0; k < (opts.from || 0); k++) {
    const e = rec.steps[k], st0 = steps[k];
    if (e && e.status === 'ok' && st0 && !st0.guard && e.values !== undefined) keep(st0, { values: e.values, table: await recordTable(e, parseTSV) });
  }
  if (rec.baseline === undefined) {
    const b = await findBaseline(r.name, rec.dir);
    rec.baseline = b ? { dir: b.dir, accepted: b.accepted, started: b.rec.started } : null;
  }
  let baseRec = null;
  if (rec.baseline) { try { baseRec = JSON.parse(await (await (await resolveFileHandle(runRoot(), `${rec.baseline.dir}/run.json`)).getFile()).text()); } catch { baseRec = null; } }
  // the baseline's step for a name: the SAME slug this run's name points at (inside an each, the
  // row's own table — not the baseline's first row), then the name itself, then the first like it
  const prevEntry = (name) => baseRec && ((slugOf.has(name) && baseRec.steps.find((e) => e.step === slugOf.get(name))) || baseRec.steps.find((e) => e.step === name) || baseRec.steps.find((e) => e.step && e.step.replace(/-.*/, '') === name && e.values));
  const scalarScope = () => {
    const o = {};
    for (const [nm, v] of results) flatValues(nm, v.values, o);
    if (baseRec) for (const e of baseRec.steps) if (e && e.values) { flatValues(`prev.${e.step}`, e.values, o); }
    return o;
  };
  const saveRec = () => writeRecord(rec).catch((e) => { $('#meta').textContent = `routine: the run record could not be written — ${e.message}`; });
  // output routing
  const outDir = routineOutDir(PR);
  const outPath = (slug) => routineOutPath(PR, slug);
  // run — the tracker walks the expanded list live; Cancel stops between steps.
  // `from` resumes a stopped run: the earlier steps are shown as already done,
  // so the record stays honest about what this run did and did not do.
  const from = Math.max(0, Math.min(opts.from || 0, steps.length - 1));
  const tracker = openRoutineTracker(r.name, steps, PR);
  rec.status = 'running'; await saveRec();
  for (let k = 0; k < from; k++) tracker.state(k, 'skip');
  let n = 0, wrote = 0;
  const books = opts.books || new Map(), bookLines = [];                // book path → { docs, dpi } — written when the routine finishes
  for (const st of steps) {
    const idx = n; n++;
    if (idx < from) continue;                              // already run (or deliberately skipped)
    if (tracker.cancelled()) {
      if (wrote) markProjectDirty();
      rec.status = 'cancelled'; rec.finished = new Date().toISOString(); await saveRec();
      tracker.done(`cancelled — ${idx} of ${steps.length} steps done, ${wrote} report${wrote === 1 ? '' : 's'} → ${outDir}/`,
        idx < steps.length ? [['Resume', () => runRoutine(r, { ...carry, from: idx, steps, books, record: rec, event: 'resume' }), 'carry on from where you stopped it']] : []);
      $('#meta').textContent = `routine “${r.name}” cancelled after ${idx} step${idx === 1 ? '' : 's'}`;
      done('cancelled', {}, rec);
      return;
    }
    if (st.guard) { tracker.state(idx, 'ok'); continue; }
    if (st.check !== undefined || st.compare !== undefined) {
      const t0c = Date.now(), level = st.level === 'warn' ? 'warn' : 'stop';
      const entry = rec.steps[idx] = { n: idx + 1, step: st._slug, kind: st.check !== undefined ? 'check' : 'compare', level, say: st.say || null, status: 'running' };
      tracker.state(idx, 'run');
      try {
        let res;
        if (st.check !== undefined && typeof st.check === 'string') {
          entry.expr = st.check;
          res = evalScalarCheck(st.check, scalarScope());
        } else if (st.check !== undefined) {
          const c = st.check, src = results.get(String(c.in));
          if (!src || !src.table) throw new Error(`check: no table from a step named “${c.in}” before this one`);
          entry.expr = c.every; entry.in = c.in; entry.against = c.against || null;
          const prevT = c.against ? (prevEntry(String(c.in)) ? await recordTable(prevEntry(String(c.in)), parseTSV) : null) : undefined;
          res = evalEveryCheck(String(c.every), src.table, scalarScope(), prevT);
        } else {
          const src = results.get(String(st.compare));
          if (!src || !src.table) throw new Error(`compare: no table from a step named “${st.compare}” before this one`);
          const pe = prevEntry(String(st.compare)), prevT = pe ? await recordTable(pe, parseTSV) : null;
          entry.in = st.compare;
          if (!prevT) res = { status: 'not-evaluated', why: rec.baseline ? 'the baseline run has no such table' : 'no baseline run yet (accept a run, or run once more)' };
          else {
            const cmp = compareTables(src.table, prevT), path = outPath(st._slug), tsv = tableTSV(cmp);
            const fh = await resolveFileHandle(runRoot(), path, { create: true }); const w = await fh.createWritable(); await w.write(tsv); await w.close(); wrote++;
            entry.outputs = [await outputEntry(path, tsv)];
            keep(st, { values: {}, table: cmp });
            res = { status: 'pass' };
            if (st.tolerance != null) {                    // every value column's relative change within the tolerance
              const tol = +st.tolerance, bad = [];
              cmp.rows.forEach((row) => { if (row[row.length - 1] !== 'both') { bad.push(row.slice(0, cmp.key.length).join(' · ') + ' (one run only)'); return; } cmp.valCols.forEach((c) => { const v = row[cmp.columns.indexOf(`${c}_pct`)]; if (Number.isFinite(v) && Math.abs(v) > tol) bad.push(`${row.slice(0, cmp.key.length).join(' · ')}: ${c} ${(v * 100).toFixed(1)}%`); }); });
              res = { status: bad.length ? 'fail' : 'pass', failing: bad.slice(0, 20), failingCount: bad.length, tolerance: tol };
            }
          }
        }
        Object.assign(entry, res, { ms: Date.now() - t0c });
        const said = st.say ? `“${st.say}” — ` : '';
        const why = res.status === 'fail' ? `${said}failed${res.failingCount ? ` (${res.failingCount} row${res.failingCount === 1 ? '' : 's'}: ${res.failing.slice(0, 3).join('; ')}${res.failingCount > 3 ? '…' : ''})` : res.observed ? ` (${Object.entries(res.observed).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toPrecision(6) : v}`).join(', ')})` : ''}`
          : res.status === 'not-evaluated' ? `${said}not evaluated — ${res.why || `blank: ${(res.blank || []).slice(0, 3).join('; ')}`}` : '';
        if (res.status !== 'pass' && level === 'stop') throw new Error(why);
        entry.status = res.status === 'pass' ? 'pass' : level === 'warn' ? `warn: ${res.status}` : res.status;
        tracker.state(idx, 'ok', res.status === 'pass' ? '' : why); await saveRec();
      } catch (e) {
        tracker.state(idx, 'fail', e.message);
        if (entry.status === 'running') entry.status = 'failed';
        Object.assign(entry, { error: e.message, ms: Date.now() - t0c }); rec.status = 'failed'; await saveRec();
        tracker.done(`stopped at step ${n} — a check`, [
          ['Retry step', () => runRoutine(r, { ...carry, from: idx, steps, books, record: rec, event: 'retry' }), 'judge again (after changing something)'],
          ['Skip & continue', () => runRoutine(r, { ...carry, from: idx + 1, steps, books, record: rec, event: 'skip' }), 'carry on without this check'],
        ]);
        $('#meta').textContent = `routine “${r.name}” STOPPED at step ${n} (${st._slug}) — ${e.message}`;
        stepEvt(idx + 1, st._slug, 'failed'); done('failed', { error: e.message }, rec);
        return;
      }
      stepEvt(idx + 1, st._slug, entry.status);
      continue;
    }
    const merged = routineStepOp(st);
    const tool = merged.tool, n0 = n;
    let stepNote = '';
    const t0 = Date.now(), entry = rec.steps[idx] = { n: idx + 1, step: st._slug, tool, status: 'running', started: new Date().toISOString(), params: merged.params, outputs: [] };
    tracker.state(idx, 'run');
    $('#meta').textContent = `routine “${r.name}” — step ${n}/${steps.length}: ${st._slug}…`;
    try {
      let reused = null;
      if (toolDef(tool) && toolDef(tool).cache !== false && st.cache !== false && P.cache !== false && !opts.fresh) {
        // the CACHE: the same tool, settings, micro build and input fingerprints as an earlier ok step
        // whose outputs are intact → its outputs, copied; nothing recomputed
        const fps = await stepFingerprints(routineLayerNames(merged));
        entry.cacheKey = stepKey(tool, checkParams(tool, merged.params, { routine: true }).params, fps);   // (entry.key is the table's key columns)
        const hit = await findCachedStep(entry.cacheKey, rec.dir);
        if (hit) {
          reused = hit;
          entry.outputs = await copyOutputs(hit.entry, outDir); wrote += entry.outputs.length;
          Object.assign(entry, { params: hit.entry.params, values: hit.entry.values, units: hit.entry.units, key: hit.entry.key, warnings: hit.entry.warnings || [], reusedFrom: hit.dir });
          if (hit.entry.layers) entry.layers = hit.entry.layers;
          keep(st, { values: hit.entry.values || {}, table: await recordTable(entry, parseTSV) });
          stepNote = `reused from ${hit.dir.replace(/^runs\//, '')} (nothing changed)`;
        }
      }
      if (reused) { /* done above */ } else if (toolDef(tool)) {                                   // a registered tool: scan + shape, no window
        const res = await runTool(tool, merged.params, { routine: true, progress: (n, N) => { $('#meta').textContent = `routine “${r.name}” — step ${n0}/${steps.length}: ${st._slug}… ${N ? Math.round((100 * n) / N) + '%' : ''}`; } });
        Object.assign(entry, { params: res.resolved, values: res.values, warnings: res.warnings });
        if (res.layers) entry.layers = res.layers; if (res.columns) entry.columns = res.columns;   // what it made: layers, columns
        let tsv = null;
        if (res.table) {                                     // a table → the step's machine TSV
          tsv = tableTSV(res.table);
          const fh = await resolveFileHandle(runRoot(), outPath(st._slug), { create: true });
          const w = await fh.createWritable(); await w.write(tsv); await w.close();
          wrote++;
          Object.assign(entry, { units: res.table.units, key: res.table.key });
          entry.outputs.push(await outputEntry(outPath(st._slug), tsv));
        }
        if (res.file) {                                      // a file (export) → into the run's folder, hashed
          const fpath = `${outDir}/${res.file.name}`;
          const fh = await resolveFileHandle(runRoot(), fpath, { create: true });
          const w = await fh.createWritable(); await w.write(res.file.blob); await w.close();
          wrote++;
          entry.outputs.push(await outputEntry(fpath));
        }
        keep(st, { values: res.values, table: res.table });
        const emit = tsv && (st.emit || (merged.params && merged.params.emit));
        if (emit) await resultToLayer(typeof emit === 'object' && emit.layer ? String(emit.layer) : `${r.name}/${st._slug}`, tsv);
        if (res.warnings.length) stepNote = res.warnings.join('; ');
      } else if (tool === 'solid') {
        await runSolidRecipe(merged.params);              // long-running (winding/peel) — awaited, not settled
        entry.columns = routineTargets('solid', merged.params, st._slug, PR).columns;
      } else if (tool === 'compo') {                         // one composer page: into its book, or its own file
        const pp = merged.params || {};
        const page = await compoPage(pp, routineEval);
        if (pp.book) { const b = books.get(String(pp.book)) || { docs: [], dpi: +pp.dpi || 300 }; b.docs.push(page); books.set(String(pp.book), b); }
        if (pp.out) { await writePages(String(pp.out), [page], { dpi: +pp.dpi || 300 }); wrote++; entry.outputs.push(await outputEntry(String(pp.out))); }
        if (pp.book) entry.book = String(pp.book);
        if (!pp.book && !pp.out) throw new Error('a composer page needs `book:` (one PDF for the run) or `out:` (a .pdf / .png of its own)');
      } else if (tool === 'calccols') {                      // synchronous: applied, or the step fails naming the bad ones
        const pp = merged.params || {}, Lc = S.layers.find((x) => x.name === pp.layer);
        if (!Lc) throw new Error(`layer “${pp.layer}” isn't loaded`);
        const { bad } = await applyCalcCols(Lc, pp.cols);
        if (bad.length) throw new Error(`invalid expression for ${bad.join(', ')}`);
        entry.columns = (pp.cols || []).map((c) => ({ layer: pp.layer, name: c.name, expr: c.expr }));
      } else if (tool === 'figure') {                        // awaited: the PNG is written (out:) before the next step
        const fr = await runFigureRecipe(merged.params || {});
        if (fr && fr.out) entry.outputs.push(await outputEntry(fr.out));
      } else throw new Error(`unsupported tool in a routine: ${tool}`);
      tracker.state(idx, 'ok', stepNote, reused ? 'note' : undefined);   // a warning (or a reuse) rides on the ✓ line
      Object.assign(entry, { status: 'ok', ms: Date.now() - t0 }); await saveRec();
      stepEvt(idx + 1, st._slug, 'ok');
    } catch (e) {
      tracker.state(idx, 'fail', e.message);
      Object.assign(entry, { status: 'failed', ms: Date.now() - t0, error: e.message }); rec.status = 'failed'; await saveRec();
      tracker.done(`stopped at step ${n} — the step's window is left open`, [
        ['Retry step', () => runRoutine(r, { ...carry, from: idx, steps, books, record: rec, event: 'retry' }), 'run this step again, then carry on'],
        ['Skip & continue', () => runRoutine(r, { ...carry, from: idx + 1, steps, books, record: rec, event: 'skip' }), 'leave this step undone and run the rest'],
      ]);
      $('#meta').textContent = `routine “${r.name}” STOPPED at step ${n} (${st._slug}) — ${e.message}`;
      stepEvt(idx + 1, st._slug, 'failed'); done('failed', { error: e.message }, rec);
      return;
    }
  }
  for (const [path, b] of books) {                          // the atlases: every page this run made, one PDF each
    try { $('#meta').textContent = `routine “${r.name}” — writing ${path} (${b.docs.length} page${b.docs.length === 1 ? '' : 's'})…`; await writePages(path, b.docs, { dpi: b.dpi }); (rec.books = rec.books || []).push({ pages: b.docs.length, ...(await outputEntry(path)) }); bookLines.push(`${path} (${b.docs.length} page${b.docs.length === 1 ? "" : "s"})`); }
    catch (e) { tracker.done(`the pages ran but ${path} could not be written — ${e.message}`); $('#meta').textContent = `routine “${r.name}”: ${path} failed — ${e.message}`; rec.status = 'failed'; await saveRec(); done('failed', { error: e.message }, rec); return; }
  }
  rec.status = 'ok'; rec.finished = new Date().toISOString(); await saveRec();
  markProjectDirty();
  // say what THIS run did — a resume must not claim the steps it skipped
  const ran = n - from;
  const line = `${ran} step${ran === 1 ? "" : "s"} run${from ? ` (${from} skipped)` : ""}${wrote || !bookLines.length ? `, ${wrote} report${wrote === 1 ? "" : "s"} → ${outDir}/` : ""}${bookLines.length ? `, ${bookLines.join(", ")}` : ""}`;
  tracker.done(`${line} · record ${rec.dir}/run.json`, [['Accept as baseline…', () => acceptRunAsk(rec.dir, { root: runRoot(), onAccept: opts.onAccept }), 'the run the next runs of this routine compare with', true]]);
  $('#meta').textContent = `routine “${r.name}” — ${line}`;
  done('ok', {}, rec);
}

// a layer input may say what the layer must carry — inputs: [{ name: model, type: layer, requires: [AU, DENS] }] —
// checked before the run (a routine meant for another model fails here, naming the missing columns,
// not halfway through). → problems
export function inputsProblems(r, values) {
  const out = [];
  for (const inp of (r && r.inputs) || []) {
    if ((inp.type || 'text') !== 'layer' || !Array.isArray(inp.requires) || !inp.requires.length) continue;
    const v = values[inp.name], L = S.layers.find((x) => x.name === v || (x.label || x.name) === v);
    if (!L) { out.push(`input “${inp.name}”: layer “${v}” isn't loaded`); continue; }
    const h = layerTableHeader(L), have = h ? schemaExt(L, h).map((c) => c.name.toLowerCase()) : [];
    const miss = inp.requires.filter((c) => !have.includes(String(c).toLowerCase()));
    if (miss.length) out.push(`input “${inp.name}”: ${L.label || L.name} has no column ${miss.map((c) => `“${c}”`).join(', ')}`);
  }
  return out;
}

// ── for a HOST (window.micro): routines by name, inputs given up front (a host can't answer a dialog) ──
export function routineForHost(name, inputs = {}) {
  const r = S.recipes.find((x) => x.name === name && x.tool === 'routine');
  if (!r) throw new Error(`no routine “${name}”${S.recipes.some((x) => x.tool === 'routine') ? ` (routines: ${S.recipes.filter((x) => x.tool === 'routine').map((x) => x.name).join(', ')})` : ' — open a project with routines in recipes/'}`);
  const want = Array.isArray(r.inputs) ? r.inputs : [];
  const values = {};
  for (const inp of want) {
    const v = inputs[inp.name] !== undefined ? inputs[inp.name] : inp.default;
    if (v === undefined || v === '') throw new Error(`routine “${name}” needs input “${inp.name}”${inp.type ? ` (${inp.type})` : ''}`);
    values[inp.name] = v;
  }
  const req = inputsProblems(r, values);
  if (req.length) throw new Error(`routine “${name}”: ${req.join('; ')}`);
  const extra = Object.keys(inputs).filter((k) => !want.some((i) => i.name === k));
  if (extra.length) throw new Error(`routine “${name}” has no input ${extra.map((k) => `“${k}”`).join(', ')}${want.length ? ` (inputs: ${want.map((i) => i.name).join(', ')})` : ''}`);
  return want.length ? { ...r, inputs: undefined, _inputs: values, params: routineSubst(JSON.parse(JSON.stringify(r.params)), values) } : r;
}
// the dry run: every step as it would run (and what it writes), every problem — nothing runs
export async function checkRoutineHost(name, inputs) {
  const r = routineForHost(name, inputs);
  const steps = await expandRoutine(r.params || {});
  const { problems } = await routinePreflight(r, steps);
  return { routine: name, steps: steps.map((st, i) => routineLineInfo(st, i, r.params || {}).text), problems };
}
// run to the end; resolves with { status, record, problems?, error? } — never prompts
export function runRoutineHost(name, inputs, onStep, { fresh = false } = {}) {
  const r = routineForHost(name, inputs);
  const token = `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const step = (e) => { if (e.detail.token === token && typeof onStep === 'function') { try { onStep({ n: e.detail.n, step: e.detail.step, status: e.detail.status }); } catch { /* the host's */ } } };
    const fin = (e) => {
      if (e.detail.token !== token) return;
      removeEventListener('micro:routine-step', step); removeEventListener('micro:routine-done', fin);
      const { routine, status, record, problems, error } = e.detail;
      resolve({ routine, status, record, ...(problems ? { problems } : {}), ...(error ? { error } : {}) });
    };
    addEventListener('micro:routine-step', step); addEventListener('micro:routine-done', fin);
    runRoutine(r, { token, fresh });
  });
}

// ── CHECK ALL RECIPES: every file in recipes/, checked the way it will run — a registered tool's
// settings against its list (an unknown one names the nearest real one), a routine through its
// expansion and pre-flight. Routine steps in the old form (settings mixed into the step, where a
// tool's own `filter:` was taken for a step keyword and dropped) are flagged; `rewrite` moves their
// settings under `with:` and writes the file back. ──
function oldFormSteps(steps, out = []) {
  for (const st of steps || []) {
    if (!st || typeof st !== 'object') continue;
    if (st.each !== undefined && Array.isArray(st.steps)) { oldFormSteps(st.steps, out); continue; }
    if (!(st.tool || st.recipe)) continue;
    const loose = Object.keys(st).filter((k) => !['recipe', 'tool', 'as', 'emit', 'with', 'cache'].includes(k));
    if (loose.length) out.push({ st, loose });
  }
  return out;
}
export async function checkAllRecipes({ rewrite = false } = {}) {
  const out = [];
  for (const r of S.recipes) {
    const item = { name: r.name, file: r.file || null, tool: r.tool, problems: [], oldForm: 0, rewritten: false };
    try {
      if (r.tool === 'routine') {
        const old = oldFormSteps(r.params && r.params.steps);
        item.oldForm = old.length;
        if (rewrite && old.length) {
          for (const { st, loose } of old) { st.with = { ...(st.with || {}) }; for (const k of loose) { st.with[k] = st[k]; delete st[k]; } }
          if (r.file) { const fh = await resolveFileHandle(S.project.dir, r.file, { create: true }); const w = await fh.createWritable(); await w.write(recipeYaml(r)); await w.close(); item.rewritten = true; }
          item.oldForm = 0;
        }
        const steps = await expandRoutine(r.params || {});
        const pf = await routinePreflight(r, steps);
        item.problems.push(...pf.problems.filter((p) => !/^load these layers first/.test(p)));   // a routine for other data isn't wrong
        if (pf.problems.some((p) => /^load these layers first/.test(p))) item.note = 'some layers aren’t loaded — their columns weren’t checked';
      } else if (toolDef(r.tool)) {
        item.problems.push(...checkParams(r.tool, r.params).errors);
      } else item.note = 'not checked — this tool has no settings list yet';
    } catch (e) { item.problems.push(e.message); }
    out.push(item);
  }
  return out;
}
export async function openCheckAllRecipes() {
  const win = floatWin({ title: 'check all recipes', sub: 'checking…', x: 140, y: 100, w: 560, h: 380 });
  win.el.dataset.checkRecipes = '1';
  const render = (items) => {
    win.body.textContent = '';
    const bad = items.filter((x) => x.problems.length), old = items.filter((x) => x.oldForm);
    win.sub.textContent = items.length ? `${items.length} recipe${items.length === 1 ? '' : 's'} · ${bad.length ? `${bad.length} with problems` : 'no problems'}${old.length ? ` · ${old.length} in the old step form` : ''}` : 'no recipes in this project';
    for (const x of items) {
      const row = document.createElement('div'); row.className = 'rw-prevline' + (x.problems.length ? ' fail' : x.oldForm || x.note ? ' warn' : '');
      row.textContent = `${x.problems.length ? '✗' : '✓'} ${x.name} · ${RECIPE_TOOLS[x.tool] || x.tool}${x.oldForm ? ` — ${x.oldForm} step${x.oldForm === 1 ? '' : 's'} in the old form (settings outside with:)` : ''}${x.rewritten ? ' — rewritten' : ''}${x.note ? ` — ${x.note}` : ''}`;
      win.body.append(row);
      for (const p of x.problems) { const l = document.createElement('div'); l.className = 'rw-prevline fail'; l.textContent = `      ${p}`; win.body.append(l); }
    }
    if (old.length) {
      const b = document.createElement('button'); b.className = 'awin-btn'; b.textContent = 'Rewrite old steps into with:'; b.style.marginTop = '8px';
      b.title = 'moves each step’s settings under with: and writes the file back (the step keywords stay)';
      b.onclick = async () => { b.disabled = true; render(await checkAllRecipes({ rewrite: true })); };
      win.body.append(b);
    }
  };
  render(await checkAllRecipes());
  return win;
}

// plain JS ⇄ @gcu/yaml AST (the emitter is AST-only; nulls are simply omitted)
export function jsToYamlNode(v) {
  if (Array.isArray(v)) return yamlSeq(v.map(jsToYamlNode));
  if (v && typeof v === 'object') return yamlMap(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => yamlEntry(yamlScalar('string', k), jsToYamlNode(x))));
  if (typeof v === 'boolean') return yamlScalar('bool', v);
  if (typeof v === 'number') return yamlScalar(Number.isInteger(v) ? 'int' : 'float', v);
  return yamlScalar('string', String(v));
}

export function yamlToJs(node) {
  if (!node) return null;
  if (node.kind === 'scalar') return node.value;
  if (node.kind === 'seq') return node.items.map(yamlToJs);
  if (node.kind === 'map') return Object.fromEntries(node.entries.map((e) => [yamlToJs(e.key), yamlToJs(e.value)]));
  return null;
}

export function recipeYaml(r) {
  const root = jsToYamlNode({ name: r.name, tool: r.tool, ...(Array.isArray(r.inputs) && r.inputs.length ? { inputs: r.inputs } : {}), params: r.params });
  // file-level comments ride the first entry's VALUE (that's where the emitter reads them)
  if (root.entries.length) root.entries[0].value.leadingComments = [` micro recipe — ${RECIPE_TOOLS[r.tool] || r.tool}. Hand-edit freely; series reference layers by NAME.`];
  return yamlEmit(root);
}

export async function saveRecipe(tool, params, suggestedName) {
  if (!S.project) { $('#meta').textContent = 'recipes: open or save a project first (a recipe is a file in recipes/)'; return null; }
  const name = ((await microPrompt('recipe name', suggestedName || '')) || '').trim();
  if (!name) return null;
  return writeRecipe(name, tool, params);
}
// a recipe file, named (the from-scratch form has its own name field; saveRecipe asks for one)
export async function writeRecipe(name, tool, params) {
  if (!S.project) { $('#meta').textContent = 'recipes: open or save a project first (a recipe is a file in recipes/)'; return null; }
  const existing = S.recipes.find((x) => x.name === name);
  const r = { name, tool, params: JSON.parse(JSON.stringify(params)), inputs: existing ? existing.inputs : undefined, file: existing ? existing.file : 'recipes/' + recipeSlug(name) + '.yaml' };   // re-saving a window's config keeps hand-authored inputs
  try {
    const fh = await resolveFileHandle(S.project.dir, r.file, { create: true });
    const w = await fh.createWritable(); await w.write(recipeYaml(r)); await w.close();
  } catch (e) { $('#meta').textContent = `recipe save failed — ${e.message}`; return null; }
  if (existing) Object.assign(existing, r); else { S.recipes.push(r); S.recipes.sort((a, b) => a.name.localeCompare(b.name)); }
  $('#meta').textContent = `${existing ? 'updated' : 'saved'} recipe “${name}” → ${r.file} (Tools → Recipes to run it)`;
  return r;
}

export async function loadRecipes(dir) {
  S.recipes = [];
  try {
    const rd = await dir.getDirectoryHandle('recipes');
    for await (const [nm, h] of rd.entries()) {
      if (h.kind !== 'file' || !/\.ya?ml$/i.test(nm)) continue;
      try {
        const j = yamlToJs(yamlParse(await (await h.getFile()).text()));
        if (j && RECIPE_TOOLS[j.tool] && j.params) S.recipes.push({ name: String(j.name || nm.replace(/\.ya?ml$/i, '')), tool: j.tool, params: j.params, inputs: Array.isArray(j.inputs) ? j.inputs : undefined, file: 'recipes/' + nm });
        else $('#meta').textContent = `recipe “${nm}”: not a recognized tool — skipped`;
      } catch (e) { $('#meta').textContent = `recipe “${nm}”: ${e.message}`; }
    }
    S.recipes.sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* no recipes/ folder yet */ }
}

export async function deleteRecipe(r) {
  if (!(await microConfirm(r.tool === 'routine' ? 'delete routine' : 'delete recipe', `Delete “${r.name}” — the file ${r.file} in the project? This can't be undone.`, 'Delete'))) return;
  await removeFileAt(S.project.dir, r.file);
  S.recipes = S.recipes.filter((x) => x !== r);
  $('#meta').textContent = `deleted recipe “${r.name}” (${r.file})`;
}

export async function renameRecipe(r) {
  const name = ((await microPrompt('recipe name', r.name)) || '').trim();
  if (!name || name === r.name) return;
  r.name = name;
  try { const fh = await resolveFileHandle(S.project.dir, r.file, { create: true }); const w = await fh.createWritable(); await w.write(recipeYaml(r)); await w.close(); } catch { /* file keeps the old name field */ }
  S.recipes.sort((a, b) => a.name.localeCompare(b.name));
  $('#meta').textContent = `renamed → “${name}” (file stays ${r.file})`;
}

// run (or just open configured): resolve the primary layer from the first
// series; a missing primary gets the remap menu — every series whose layer is
// missing then falls back to the substitute
export function runRecipe(r, andRun = true, runOpts = null) {
  if (andRun && Array.isArray(r.inputs) && r.inputs.length) { openInputsDialog(r, runOpts); return; }   // ask-me-first: the generated dialog runs the substituted copy
  if (r.tool === 'routine') { if (andRun) runRoutine(r, runOpts || {}); else openRoutineWindow(r); return; }
  if (r.tool === 'figure') { runFigureRecipe(r.params).catch((e) => { $('#meta').textContent = `figure recipe: ${e.message}`; }); return; }   // camera-based — no layer to resolve
  if (r.tool === 'compo') {                                // one page, written to its out / book path
    (async () => {
      try {
        const page = await compoPage(r.params, routineEval);
        const path = String(r.params.out || r.params.book || `atlas/${recipeSlug(r.params.figure || 'page')}.pdf`);
        await writePages(path, [page], { dpi: +r.params.dpi || 300 });
        $('#meta').textContent = `composer page → ${path}`;
      } catch (e) { $('#meta').textContent = `composer page: ${e.message}`; }
    })();
    return;
  }
  if (r.tool === 'contact') {                              // the window, configured (Run on “Run”)
    const want = (r.params.series && r.params.series[0] && r.params.series[0].layer) || r.params.layer;
    const Lc = S.layers.find((x) => x.name === want || (x.label || x.name) === want);
    if (!Lc) { $('#meta').textContent = `recipe “${r.name}”: layer “${want}” isn't loaded`; return; }
    openContact(Lc, { cfg: r.params, run: andRun }); return;
  }
  if (r.tool === 'factors') {                              // the window, configured (Run on “Run”)
    const Lf = S.layers.find((x) => x.name === r.params.model || (x.label || x.name) === r.params.model);
    if (!Lf) { $('#meta').textContent = `recipe “${r.name}”: layer “${r.params.model}” isn't loaded`; return; }
    openFactors(Lf, { cfg: r.params, run: andRun }); return;
  }
  if (r.tool === 'validation') {                           // the window, configured (it runs on open)
    const M = S.layers.find((x) => x.name === r.params.model || (x.label || x.name) === r.params.model);
    if (!M) { $('#meta').textContent = `recipe “${r.name}”: layer “${r.params.model}” isn't loaded`; return; }
    openValidation(M, { cfg: r.params }); return;
  }
  if (r.tool === 'resource') {                             // a resource table into the composer
    addResourceFrame(r.params).catch((e) => { $('#meta').textContent = `recipe “${r.name}”: ${e.message}`; }); return;
  }
  if (r.tool === 'solid') {                                // by-geometry — resolves its own layers
    if (!andRun) { openSolidRecipeConfigured(r.params); return; }
    runSolidRecipe(r.params).catch((e) => { $('#meta').textContent = `recipe “${r.name}”: ${e.message}`; });
    return;
  }
  // a tool with no window to open configured (QA reports, export, composite, pairing, shell, join,
  // reconcile, section series…): run it as a one-step routine — the same numbers, a run record, the
  // result in the tracker. (It used to fall through to the swath window.)
  if (!['gt', 'stats', 'xy', 'xtab', 'swath', 'calccols'].includes(r.tool)) {
    const one = { name: r.name, tool: 'routine', params: { steps: [{ tool: r.tool, with: { ...(r.params || {}) }, as: recipeSlug(r.name) }] } };   // a routine's steps live under params
    if (andRun) runRoutine(one, runOpts || {}); else openRoutineWindow(one);   // “open configured” shows it, never runs it
    return;
  }
  const open2 = (Lp) => {
    if (r.tool === 'calccols') {
      return applyCalcCols(Lp, r.params.cols).then(({ applied, bad }) => {
        $('#meta').textContent = `recipe “${r.name}”: ${applied} calc column${applied === 1 ? '' : 's'} applied to ${Lp.label || Lp.name}${bad.length ? ` · skipped (invalid expr): ${bad.join(', ')}` : ''}`;
      });
    }
    return r.tool === 'gt' ? openGradeTonnage(Lp, { cfg: r.params, run: andRun })
      : r.tool === 'stats' ? openStats(Lp, { cfg: r.params, run: andRun })
      : r.tool === 'xy' ? openXyPlot(Lp, { cfg: r.params, run: andRun })
      : r.tool === 'xtab' ? openCrosstab(Lp, { cfg: r.params, run: andRun })
      : openSwath(Lp, { cfg: r.params, run: andRun });
  };
  const wantName = (r.params.series && r.params.series[0] && r.params.series[0].layer) || r.params.layer;
  const L = S.layers.find((x) => x.name === wantName);
  if (L) { open2(L); return; }
  const cands = S.layers.filter((x) => (r.tool === 'stats' || r.tool === 'calccols' || r.tool === 'xy' ? !!layerTableHeader(x) : gridAxesOf(x)));
  if (!cands.length) { $('#meta').textContent = `recipe “${r.name}”: wants “${wantName || 'a block model'}” and no suitable layer is loaded`; return; }
  setTimeout(() => menuXY(innerWidth / 2 - 140, innerHeight / 3, [
    ...cands.map((c) => ({ label: `“${r.name}” wants ${wantName} — use ${c.label || c.name}`, action: () => open2(c) })),
    { label: 'Cancel', action: () => {} },
  ]), 0);
}

export function recipesMenuItems() {
  if (!S.project) return [{ label: 'Library… (routines without a project)', action: () => openLibraryWindow() }, { label: 'a project’s own recipes: open a project folder', action: () => {} }];
  if (!S.recipes.length) return [
    { label: 'none yet — “save as recipe…” in an analysis window, or:', action: () => {} },
    { label: 'New recipe…', action: () => openRecipeForm() },
    { label: 'New routine…', action: () => openRoutineWindow(null) },
    { label: 'Library…', action: () => openLibraryWindow() },
    { label: 'Runs…', action: () => openRunsWindow() },     // past runs stay readable when no recipe is left
  ];
  return [...S.recipes.map((r) => ({
    label: `${r.name} · ${RECIPE_TOOLS[r.tool]}`,
    submenu: [
      { label: Array.isArray(r.inputs) && r.inputs.length ? 'Run…' : 'Run', action: () => runRecipe(r, true) },
      ...(r.tool === 'routine' && !(Array.isArray(r.inputs) && r.inputs.length) ? [{ label: 'Run fresh (reuse nothing)', action: () => runRoutine(r, { fresh: true }) }] : []),
      { label: 'Edit (open configured)', action: () => runRecipe(r, false) },
      { label: 'Rename…', action: () => renameRecipe(r) },
      { label: 'Delete', action: () => deleteRecipe(r) },
    ],
  })), { label: 'New recipe…', action: () => openRecipeForm() }, { label: 'New routine…', action: () => openRoutineWindow(null) }, { label: 'Library…', action: () => openLibraryWindow() }, { label: 'Runs…', action: () => openRunsWindow() }, { label: 'Check all recipes…', action: () => openCheckAllRecipes() }];
}

