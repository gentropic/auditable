// micro recipes — recipes (an analysis window's setup as a YAML file in recipes/)
// and ROUTINES that chain them: each-blocks over a parameter table, inline steps,
// ask-first inputs, reports written per step, pre-flight checks, the routine editor
// (the each-table as a grid, the file stays truth) and the run tracker. Carved from
// index.html (phase 3).
import { compileBool, compileValue, validate } from '../../../ext/expr/index.js';
import { basename, removeFileAt, resolveFileHandle } from './paths.js';
import { S, activeLayer } from './state.js';
import { openSheet as xlsxOpenSheet } from '../../../ext/sheet/index.js';
import { floatWin } from './windows.js';
import { layerTableHeader, schemaExt } from './records.js';
import { emit as yamlEmit, mapEntry as yamlEntry, mapNode as yamlMap, parse as yamlParse, scalar as yamlScalar, seqNode as yamlSeq } from '../../../ext/yaml/index.js';
import { openGradeTonnage } from './gt.js';
import { openStats } from './stats.js';
import { openSwath } from './swath.js';
import { gridAxesOf } from './grid-ops.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setRecipesHooks): applyCalcCols, collarCells, csvRecords, layerHasColumn, markProjectDirty, menuXY, microPrompt, openSolidRecipeConfigured, resultToLayer, runFigureRecipe, runSolidRecipe
let H = {};
export function setRecipesHooks(h) { H = h; }

// ── RECIPES: named, re-runnable analysis setups as YAML FILES in the project
// folder (recipes/<slug>.yaml). A recipe is DATA — the same op-shaped
// { tool, params } the windows already serialize — never code (@gcu/yaml is a
// strict, tag-free subset, so a recipe file provably can't carry a script).
// Files are the interface: comment them, copy them between projects, drop one
// in and Scan folder picks it up. Series reference layers BY NAME; a missing
// primary gets a one-question remap — that prompt IS the parameter binding. ──
export const RECIPE_TOOLS = { gt: 'grade-tonnage', swath: 'swath', stats: 'stats', figure: 'figure', calccols: 'calc columns', solid: 'by solid / surface', routine: 'routine' };

export const recipeSlug = (name) => (String(name).toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe');

// ── the ROUTINE — a recipe that runs recipes (the automation ladder, layer 2).
// tool: "routine", params.steps: plain steps ({recipe, …overrides, as}) and
// `each` blocks — a group of steps run once per ROW of a parameter table.
// `each` takes rows (a list of maps), columns (a map of EQUAL-length lists,
// zipped — never a cross-product), or {from: "params.csv"} (a table file in
// the project). $var marks where each value lands. Expansion is a MACRO —
// static, no expressions, enumerable before anything runs — so the opt-in
// guard ({guard: "no-overwrites"}) can dry-pass every output first.
// Analysis steps write reports/<date>/<slug>.tsv into the project (the
// month-over-month diffable folder); params.output = {dir, prefix, suffix}
// overrides. A failed step stops the routine visibly, window left open.
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
  const fh = await resolveFileHandle(S.project.dir, path).catch(() => resolveFileHandle(S.project.dir, 'recipes/' + path));
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
  const lines = H.csvRecords(await (await fh.getFile()).text());
  const cells2 = H.collarCells(lines);
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
    if (st.recipe || st.tool) {
      const sub = routineSubst(st, scope);
      routineCheckStep(sub);
      const base = recipeSlug(sub.as || sub.recipe || sub.tool);
      out.push({ ...sub, _slug: [base, ...tags].join('-') });   // the slug carries every enclosing row
      continue;
    }
    throw new Error('a step needs `recipe`, `tool`, `each`, `params`, or `guard`');
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
  const t = { reports: [], columns: [], figures: [] };
  if (['gt', 'swath', 'stats'].includes(tool)) t.reports.push(routineOutPath(P, slug));
  else if (tool === 'calccols') {
    const layer = params.layer;
    for (const c of params.cols || []) if (c && c.name) t.columns.push({ layer, name: c.name, kind: 'ƒ' });
  } else if (tool === 'figure') {
    if (params.out) t.figures.push(String(params.out));
  } else if (tool === 'solid') {
    if (params.do === 'flag') for (const layer of params.targets || []) t.columns.push({ layer, name: params.column, kind: 'flag' });
    else if (params.do === 'ratio' && params.model) t.columns.push({ layer: params.model, name: params.column, kind: 'fraction' });
  }
  return t;
}

export const routineOutDir = (P) => (P.output && P.output.dir) || `reports/${new Date().toISOString().slice(0, 10)}`;

export const routineOutPath = (P, slug) => `${routineOutDir(P)}/${(P.output && P.output.prefix) || ''}${slug}${(P.output && P.output.suffix) || ''}.tsv`;

// one expanded step → its display line. The expansion list is the routine's
// spine: the editor previews it (clickable — open a step configured), the
// run tracker walks it live, and afterwards it stands as the run's summary.
export function routineLineInfo(st, i, P) {
  if (st.guard) return { text: `${i + 1}. guard — stop if anything below already exists`, guard: true };
  const rc = st.recipe ? S.recipes.find((x) => x.name === st.recipe) : null;
  const tool = st.recipe ? rc && rc.tool : st.tool;
  const label = st.recipe || (st.tool ? `${RECIPE_TOOLS[st.tool]} (inline)` : '(pick a recipe)');
  const params = rc ? { ...rc.params, ...st } : st;
  const t = tool ? routineTargets(tool, params, st._slug, P) : { reports: [], columns: [], figures: [] };
  // every step says what it WRITES — a report path, a column, a figure, or nothing
  const wrote = [
    ...t.reports.map((r) => `→  ${r}`),
    ...t.columns.map((c) => `→  ${c.layer || 'layer'} · ${c.kind} column “${c.name}”${H.layerHasColumn(c.name, c.layer) ? ' (replaces)' : ''}`),
    ...t.figures.map((f) => `→  ${f}`),
  ];
  return {
    text: `${i + 1}. ${label}${wrote.length ? '  ' + wrote.join('  ') : '   (opens only)'}${st.recipe && !rc ? '   ⚠ recipe not found' : ''}`,
    openable: ['gt', 'swath', 'stats', 'interp'].includes(tool) && !(st.recipe && !rc),
  };
}

// merge an expanded step into the op runRecipe takes (recipe params ⊕ overrides,
// or the inline step's own params)
export function routineStepOp(st) {
  const rc = st.recipe ? S.recipes.find((x) => x.name === st.recipe) : null;
  const extras = Object.fromEntries(Object.entries(st).filter(([k]) => !['recipe', 'tool', 'as', '_slug', 'each', 'steps', 'params', 'guard', 'filter', 'emit'].includes(k)));
  return { name: rc ? rc.name : st._slug, tool: rc ? rc.tool : st.tool, params: rc ? { ...rc.params, ...extras } : extras };
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
    state(i, st2, msg) {
      const L2 = lines[i]; if (!L2) return;
      L2.ic.textContent = st2 === 'run' ? '▶' : st2 === 'ok' ? '✓' : st2 === 'fail' ? '✗' : st2 === 'skip' ? '–' : '·';
      L2.ic.className = 'rw-state ' + st2;
      if (msg) { const m = document.createElement('div'); m.className = 'rw-prevline fail'; m.textContent = '     ' + msg; L2.row.after(m); }
      win.sub.textContent = `step ${Math.min(i + 1, steps.length)}/${steps.length}`;
      if (L2.row.scrollIntoView) L2.row.scrollIntoView({ block: 'nearest' });
    },
    done(msg, actions) {
      cancelB.remove(); sum.textContent = msg; win.sub.textContent = '';
      for (const [label, fn, title] of (actions || [])) {   // e.g. Retry / Resume after a stop
        const btn = document.createElement('button'); btn.className = 'awin-btn'; btn.textContent = label;
        if (title) btn.title = title;
        btn.onclick = () => { win.el.remove(); fn(); };
        bar.insertBefore(btn, sum);
      }
    },
  };
}

export function routineLayerNames(rc) {                           // the layer names a recipe's params reference
  const p2 = rc.params || {};
  const names = [];
  if (p2.layer) names.push(p2.layer);
  for (const ser of p2.series || []) if (ser.layer) names.push(ser.layer);
  if (p2.source) names.push(String(p2.source).split(':')[0]);
  if (p2.target) names.push(p2.target);
  return names;
}

export async function runRoutine(r, opts = {}) {
  if (!S.project || !S.project.dir) { $('#meta').textContent = 'routine: reports/ needs a project — open or save one first'; return; }
  const P = r.params || {};
  let steps;
  try { steps = await expandRoutine(P); } catch (e) { $('#meta').textContent = `routine: ${e.message}`; return; }
  const byName = new Map(S.recipes.map((x) => [x.name, x]));
  // pre-flight 1: every referenced recipe exists
  const missingR = [...new Set(steps.filter((st) => st.recipe && !byName.get(st.recipe)).map((st) => st.recipe))];
  if (missingR.length) { $('#meta').textContent = `routine: missing recipe${missingR.length > 1 ? 's' : ''} — ${missingR.join(', ')}`; return; }
  // pre-flight 2: every referenced layer is loaded (routines never prompt mid-run)
  const loaded = new Set(S.layers.map((L) => L.name));
  const missingL = new Set();
  for (const st of steps) {
    if (st.guard) continue;
    const rc = st.recipe ? byName.get(st.recipe) : null;
    for (const nm of routineLayerNames({ params: rc ? { ...rc.params, ...st } : st })) if (nm && !loaded.has(nm)) missingL.add(nm);
  }
  if (missingL.size) { $('#meta').textContent = `routine: load these layers first — ${[...missingL].join(', ')} (routines run without prompts)`; return; }
  // pre-flight 3: a referenced column must still resolve on its layer's schema.
  // A renamed/removed column would otherwise compile to a blank that reads 0 and
  // a routine would write a plausible-looking zero-grade report marked ✓.
  const badCols = [];
  for (const st of steps) {
    if (st.guard) continue;
    const rc = st.recipe ? byName.get(st.recipe) : null;
    const pr = rc ? { ...rc.params, ...st } : st;
    const cols = [];
    for (const ser of pr.series || []) if (ser.col) cols.push({ layer: ser.layer || pr.layer, col: ser.col });
    if (pr.col) cols.push({ layer: pr.layer, col: pr.col });
    for (const { layer, col } of cols) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(col).trim())) continue;   // an expression, not a bare name
      const L2 = S.layers.find((x) => x.name === layer); const h2 = L2 && layerTableHeader(L2);
      if (!h2) continue;
      if (!validate(String(col).trim(), schemaExt(L2, h2)).ok) badCols.push(`${col}${layer ? ' on ' + layer : ''}`);
    }
  }
  if (badCols.length) { $('#meta').textContent = `routine: column${badCols.length > 1 ? 's' : ''} not found — ${[...new Set(badCols)].join(', ')} (renamed or removed?)`; return; }
  // output routing
  const outDir = routineOutDir(P);
  const outPath = (slug) => routineOutPath(P, slug);
  // the opt-in GUARD: stop before ANYTHING runs if a write target exists
  const guardAt = opts.from ? -1 : steps.findIndex((st) => st.guard === 'no-overwrites');   // a resume has already written some of them
  if (guardAt >= 0) {
    for (const st of steps.slice(guardAt + 1)) {
      if (st.guard) continue;
      const rc2 = st.recipe ? byName.get(st.recipe) : null;
      const gTool = rc2 ? rc2.tool : st.tool;
      const gParams = rc2 ? { ...rc2.params, ...st } : st;
      const t = routineTargets(gTool, gParams, st._slug, P);
      for (const rep of t.reports) {
        const exists = await resolveFileHandle(S.project.dir, rep).then(() => true, () => false);
        if (exists) { $('#meta').textContent = `routine: guard stopped — ${rep} already exists`; return; }
      }
      for (const c of t.columns) {                          // columns count as outputs too
        if (H.layerHasColumn(c.name, c.layer)) { $('#meta').textContent = `routine: guard stopped — ${c.layer || 'the layer'} already has a column “${c.name}”`; return; }
      }
    }
  }
  // run — the tracker walks the expanded list live; Cancel stops between steps.
  // `from` resumes a stopped run: the earlier steps are shown as already done,
  // so the record stays honest about what this run did and did not do.
  const from = Math.max(0, Math.min(opts.from || 0, steps.length - 1));
  const tracker = openRoutineTracker(r.name, steps, P);
  for (let k = 0; k < from; k++) tracker.state(k, 'skip');
  let n = 0, wrote = 0;
  for (const st of steps) {
    const idx = n; n++;
    if (idx < from) continue;                              // already run (or deliberately skipped)
    if (tracker.cancelled()) {
      if (wrote) H.markProjectDirty();
      tracker.done(`cancelled — ${idx} of ${steps.length} steps done, ${wrote} report${wrote === 1 ? '' : 's'} → ${outDir}/`,
        idx < steps.length ? [['Resume', () => runRoutine(r, { from: idx }), 'carry on from where you stopped it']] : []);
      $('#meta').textContent = `routine “${r.name}” cancelled after ${idx} step${idx === 1 ? '' : 's'}`;
      return;
    }
    if (st.guard) { tracker.state(idx, 'ok'); continue; }
    const merged = routineStepOp(st);
    const tool = merged.tool;
    tracker.state(idx, 'run');
    $('#meta').textContent = `routine “${r.name}” — step ${n}/${steps.length}: ${st._slug}…`;
    try {
      if (['gt', 'swath', 'stats'].includes(tool)) {
        const before = new Set([...document.querySelectorAll('.fwin')]);
        runRecipe(merged, true);
        const el = await new Promise((res, rej) => {
          const t0 = Date.now();
          const iv = setInterval(() => {
            const w = [...document.querySelectorAll('.fwin')].find((x) => !before.has(x) && x._tableTSV && x._tableTSV());
            if (w) { clearInterval(iv); res(w); }
            else if (Date.now() - t0 > 600000) { clearInterval(iv); rej(new Error('timed out')); }
          }, 400);
        });
        const tsv = el._tableTSV();
        const fh = await resolveFileHandle(S.project.dir, outPath(st._slug), { create: true });
        const w = await fh.createWritable(); await w.write(tsv); await w.close();
        wrote++;
        const emit = st.emit || (merged.params && merged.params.emit);
        if (emit) {                                        // keep the result as a table layer too
          const path = typeof emit === 'object' && emit.layer ? String(emit.layer) : `${r.name}/${st._slug}`;
          await H.resultToLayer(path, tsv);
        }
        el.querySelector('.fwin-head button:last-child').click();   // tidy: close the step's window
      } else if (tool === 'solid') {
        await H.runSolidRecipe(merged.params);              // long-running (winding/peel) — awaited, not settled
      } else if (tool === 'calccols' || tool === 'figure') {
        runRecipe(merged, true);
        await new Promise((r2) => setTimeout(r2, 400));     // engine steps settle; figure runs its own flow
      } else throw new Error(`unsupported tool in a routine: ${tool}`);
      tracker.state(idx, 'ok');
    } catch (e) {
      tracker.state(idx, 'fail', e.message);
      tracker.done(`stopped at step ${n} — the step's window is left open`, [
        ['Retry step', () => runRoutine(r, { from: idx }), 'run this step again, then carry on'],
        ['Skip & continue', () => runRoutine(r, { from: idx + 1 }), 'leave this step undone and run the rest'],
      ]);
      $('#meta').textContent = `routine “${r.name}” STOPPED at step ${n} (${st._slug}) — ${e.message}`;
      return;
    }
  }
  H.markProjectDirty();
  // say what THIS run did — a resume must not claim the steps it skipped
  const ran = n - from;
  const line = `${ran} step${ran === 1 ? '' : 's'} run${from ? ` (${from} skipped)` : ''}, ${wrote} report${wrote === 1 ? '' : 's'} → ${outDir}/`;
  tracker.done(line);
  $('#meta').textContent = `routine “${r.name}” — ${line}`;
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
  const name = ((await H.microPrompt('recipe name', suggestedName || '')) || '').trim();
  if (!name) return null;
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
  await removeFileAt(S.project.dir, r.file);
  S.recipes = S.recipes.filter((x) => x !== r);
  $('#meta').textContent = `deleted recipe “${r.name}” (${r.file})`;
}

export async function renameRecipe(r) {
  const name = ((await H.microPrompt('recipe name', r.name)) || '').trim();
  if (!name || name === r.name) return;
  r.name = name;
  try { const fh = await resolveFileHandle(S.project.dir, r.file, { create: true }); const w = await fh.createWritable(); await w.write(recipeYaml(r)); await w.close(); } catch { /* file keeps the old name field */ }
  S.recipes.sort((a, b) => a.name.localeCompare(b.name));
  $('#meta').textContent = `renamed → “${name}” (file stays ${r.file})`;
}

// run (or just open configured): resolve the primary layer from the first
// series; a missing primary gets the remap menu — every series whose layer is
// missing then falls back to the substitute
export function runRecipe(r, andRun = true) {
  if (andRun && Array.isArray(r.inputs) && r.inputs.length) { openInputsDialog(r); return; }   // ask-me-first: the generated dialog runs the substituted copy
  if (r.tool === 'routine') { if (andRun) runRoutine(r); else openRoutineWindow(r); return; }
  if (r.tool === 'figure') { H.runFigureRecipe(r.params); return; }   // camera-based — no layer to resolve
  if (r.tool === 'solid') {                                // by-geometry — resolves its own layers
    if (!andRun) { H.openSolidRecipeConfigured(r.params); return; }
    H.runSolidRecipe(r.params).catch((e) => { $('#meta').textContent = `recipe “${r.name}”: ${e.message}`; });
    return;
  }
  const open2 = (Lp) => {
    if (r.tool === 'calccols') {
      const { applied, bad } = H.applyCalcCols(Lp, r.params.cols);
      $('#meta').textContent = `recipe “${r.name}”: ${applied} calc column${applied === 1 ? '' : 's'} applied to ${Lp.label || Lp.name}${bad.length ? ` · skipped (invalid expr): ${bad.join(', ')}` : ''}`;
      return;
    }
    return r.tool === 'gt' ? openGradeTonnage(Lp, { cfg: r.params, run: andRun })
      : r.tool === 'stats' ? openStats(Lp, { cfg: r.params, run: andRun })
      : openSwath(Lp, { cfg: r.params, run: andRun });
  };
  const wantName = (r.params.series && r.params.series[0] && r.params.series[0].layer) || r.params.layer;
  const L = S.layers.find((x) => x.name === wantName);
  if (L) { open2(L); return; }
  const cands = S.layers.filter((x) => (r.tool === 'stats' || r.tool === 'calccols' ? !!layerTableHeader(x) : gridAxesOf(x)));
  if (!cands.length) { $('#meta').textContent = `recipe “${r.name}”: wants “${wantName || 'a block model'}” and no suitable layer is loaded`; return; }
  setTimeout(() => H.menuXY(innerWidth / 2 - 140, innerHeight / 3, [
    ...cands.map((c) => ({ label: `“${r.name}” wants ${wantName} — use ${c.label || c.name}`, action: () => open2(c) })),
    { label: 'Cancel', action: () => {} },
  ]), 0);
}

export function recipesMenuItems() {
  if (!S.project) return [{ label: 'open a project folder first', action: () => {} }];
  if (!S.recipes.length) return [
    { label: 'none yet — “save as recipe…” in a grade-tonnage or swath window', action: () => {} },
    { label: 'New routine…', action: () => openRoutineWindow(null) },
  ];
  return [...S.recipes.map((r) => ({
    label: `${r.name} · ${RECIPE_TOOLS[r.tool]}`,
    submenu: [
      { label: Array.isArray(r.inputs) && r.inputs.length ? 'Run…' : 'Run', action: () => runRecipe(r, true) },
      { label: 'Edit (open configured)', action: () => runRecipe(r, false) },
      { label: 'Rename…', action: () => renameRecipe(r) },
      { label: 'Delete', action: () => deleteRecipe(r) },
    ],
  })), { label: 'New routine…', action: () => openRoutineWindow(null) }];
}

// ── the ROUTINE EDITOR — the routine's YAML file stays the single source of
// truth (same contract as the filter drawer): the window edits a parsed copy,
// Save re-emits the whole file through @gcu/yaml. The star is the `each`
// parameter TABLE — variables as columns, runs as rows, edited as a grid
// instead of maintaining parallel lists by hand. The editor always writes the
// rows form (one map per run); the columns and {from} forms still load.
// Preview enumerates the expansion — every step and every report path —
// before anything runs, which is the whole point of macro-not-program. ──
export function colChoicesOf(L) {                                  // plain column names a recipe can reference
  const h = L && layerTableHeader(L); if (!h) return [];
  const out = [...h.columns];
  for (const c of L.paintCols || []) out.push(c.name);
  for (const c of L.calcCols || []) out.push(c.name);
  return out;
}

export const coerceCell = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : v);

export function openRoutineWindow(r0) {
  const model = r0
    ? JSON.parse(JSON.stringify({ name: r0.name, params: r0.params || {}, inputs: r0.inputs }))
    : { name: '', params: { steps: [{ recipe: '' }] } };
  let file = r0 ? r0.file : null;
  const steps = (model.params.steps || []).filter((st) => st && !st.guard);
  let guard = (model.params.steps || []).some((st) => st && st.guard === 'no-overwrites');
  const normalize = (arr) => {                              // normalize for editing (recursively — blocks nest)
    for (const st of arr || []) {
      if (st.each === undefined) continue;
      st.steps = st.steps || [];
      if (!Array.isArray(st.each) && !(st.each && st.each.from)) {
        try { st.each = routineEachRows(st.each); } catch { st.each = [{ var1: '' }]; }
      } else if (Array.isArray(st.each) && !st.each.length) st.each = [{ var1: '' }];
      normalize(st.steps);
    }
  };
  normalize(steps);
  const win = floatWin({ title: r0 ? `routine · ${r0.name}` : 'new routine', sub: file || 'unsaved', x: innerWidth / 2 - 300, y: 80, w: 600, h: Math.min(560, innerHeight - 110) });
  win.el.dataset.routine = '1';
  win.body.className += ' rw-body rw-pin';
  const scrollEl = document.createElement('div'); scrollEl.className = 'rw-scroll'; win.body.appendChild(scrollEl);
  const msg = (t) => { $('#meta').textContent = t; };
  const recipeNames = () => S.recipes.filter((x) => x.tool !== 'routine').map((x) => x.name);   // routines don't nest
  const extrasOf = (st, skip) => Object.fromEntries(Object.entries(st).filter(([k]) => !skip.includes(k)));
  const setExtras = (st, skip, obj) => { for (const k of Object.keys(st)) if (!skip.includes(k)) delete st[k]; Object.assign(st, obj); };
  const collect = () => {
    const P2 = { steps: [...(guard ? [{ guard: 'no-overwrites' }] : []), ...JSON.parse(JSON.stringify(steps))] };
    const o = {};
    if (dirI.value.trim()) o.dir = dirI.value.trim();
    if (preI.value.trim()) o.prefix = preI.value.trim();
    if (sufI.value.trim()) o.suffix = sufI.value.trim();
    if (Object.keys(o).length) P2.output = o;
    return P2;
  };
  // ── one step row: run [recipe ▾] / do [tool ▾] (inline) + override YAML ──
  function stepRow(st, arr, host, inEach) {
    const inline = st.recipe === undefined && st.tool !== undefined;
    const skip = inline ? ['tool', 'as', '_slug'] : ['recipe', 'as', '_slug'];
    const row = document.createElement('div'); row.className = 'rw-bar';
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = inline ? 'do' : 'run';
    const sel = document.createElement('select');
    if (inline) {
      for (const t of Object.keys(RECIPE_TOOLS)) { if (t === 'routine') continue; const o = document.createElement('option'); o.value = t; o.textContent = RECIPE_TOOLS[t]; sel.appendChild(o); }
      sel.value = st.tool;
      sel.onchange = () => { st.tool = sel.value; };
      sel.title = 'an inline step — the whole setup lives in the YAML box below, nothing pre-recorded';
    } else {
      for (const nm of ['', ...recipeNames()]) { const o = document.createElement('option'); o.value = o.textContent = nm; sel.appendChild(o); }
      if (st.recipe && ![...sel.options].some((o) => o.value === st.recipe)) { const o = document.createElement('option'); o.value = o.textContent = st.recipe; sel.appendChild(o); }
      sel.value = st.recipe || '';
      sel.onchange = () => { st.recipe = sel.value; };
    }
    const asL = document.createElement('span'); asL.className = 'lbl'; asL.textContent = 'as'; asL.title = 'optional — names the report file instead of the recipe name';
    const asI = document.createElement('input'); asI.type = 'text'; asI.style.width = '8em'; asI.value = st.as || '';
    asI.onchange = () => { if (asI.value.trim()) st.as = asI.value.trim(); else delete st.as; };
    const ovB = document.createElement('button'); ovB.className = 'rw-x'; ovB.textContent = '⋯'; ovB.title = inline ? 'the step\'s params (YAML)' : 'overrides — YAML keys layered over the recipe (where $vars usually land)';
    const up = document.createElement('button'); up.className = 'rw-x'; up.textContent = '↑'; up.title = 'move up';
    const dn = document.createElement('button'); dn.className = 'rw-x'; dn.textContent = '↓'; dn.title = 'move down';
    const rm = document.createElement('button'); rm.className = 'rw-x'; rm.textContent = '×'; rm.title = 'remove this step';
    up.onclick = () => { const i = arr.indexOf(st); if (i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, st); render(); } };
    dn.onclick = () => { const i = arr.indexOf(st); if (i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, st); render(); } };
    rm.onclick = () => { arr.splice(arr.indexOf(st), 1); render(); };
    row.append(lbl, sel, asL, asI, ovB, up, dn, rm);
    host.appendChild(row);
    const ovr = document.createElement('textarea'); ovr.className = 'rw-ovr';
    ovr.placeholder = inline ? 'params (YAML, block style, strings quoted) — e.g.  layer: "model.csv"' : 'overrides (YAML, block style, strings quoted) — e.g.  nCut: 20  ·  col: "$grade"';
    const extras = extrasOf(st, [...skip, 'each', 'steps', 'guard', 'params', 'filter', 'emit']);
    ovr.value = Object.keys(extras).length ? yamlEmit(jsToYamlNode(extras)).trimEnd() : '';
    ovr.style.display = inline || ovr.value ? '' : 'none';
    ovB.onclick = () => { ovr.style.display = ovr.style.display === 'none' ? '' : 'none'; if (ovr.style.display === '') ovr.focus(); };
    ovr.onchange = () => {
      const txt = ovr.value.trim();
      try {
        const obj = txt ? yamlToJs(yamlParse(txt)) : {};
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('a map');
        setExtras(st, [...skip, 'each', 'steps', 'guard', 'params', 'filter', 'emit'], obj);
        ovr.classList.remove('err');
      } catch { ovr.classList.add('err'); }
    };
    host.appendChild(ovr);
  }
  // ── the each-block parameter table: variables → columns, runs → rows ──
  function eachGrid(blk, host) {
    const modeBar = document.createElement('div'); modeBar.className = 'rw-bar';
    const modeL = document.createElement('span'); modeL.className = 'lbl'; modeL.textContent = 'parameters:';
    const mode = document.createElement('select');
    for (const [v, t] of [['table', 'table (edit below)'], ['file', 'from a CSV in the project']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; mode.appendChild(o); }
    mode.value = blk.each && blk.each.from ? 'file' : 'table';
    modeBar.append(modeL, mode);
    host.appendChild(modeBar);
    if (mode.value === 'file') {
      const fI = document.createElement('input'); fI.type = 'text'; fI.style.width = '16em'; fI.placeholder = 'params.csv'; fI.value = blk.each.from || '';
      fI.onchange = () => { blk.each = { from: fI.value.trim() }; };
      modeBar.appendChild(fI);
      mode.onchange = () => { if (mode.value === 'table') { blk.each = [{ var1: '' }]; render(); } };
      return;
    }
    mode.onchange = () => { if (mode.value === 'file') { blk.each = { from: 'params.csv' }; render(); } };
    const rows = blk.each;
    const vars = [...new Set(rows.flatMap((r2) => Object.keys(r2)))];
    if (!vars.length) vars.push('var1');
    blk.each = rows.map((r2) => { const nr = {}; for (const v of vars) nr[v] = r2[v] !== undefined ? r2[v] : ''; return nr; });   // square + column-ordered
    const rows2 = blk.each;
    const tbl = document.createElement('table'); tbl.className = 'rw-grid';
    const trh = document.createElement('tr');
    for (const v of vars) {
      const th = document.createElement('th');
      const inp = document.createElement('input'); inp.value = v; inp.title = `variable — write $${v} in the steps below`;
      inp.onchange = () => {
        const nv = inp.value.trim().replace(/[^A-Za-z0-9_]/g, '_');
        if (!nv || nv === v || vars.includes(nv)) { inp.value = v; return; }
        blk.each = rows2.map((r2) => { const nr = {}; for (const x of vars) nr[x === v ? nv : x] = r2[x]; return nr; });
        render();
      };
      const rm = document.createElement('button'); rm.textContent = '×'; rm.title = `remove $${v}`;
      rm.onclick = () => { if (vars.length <= 1) return; blk.each = rows2.map((r2) => { const nr = { ...r2 }; delete nr[v]; return nr; }); render(); };
      th.append(inp, rm); trh.appendChild(th);
    }
    const thA = document.createElement('th');
    const addV = document.createElement('button'); addV.textContent = '+ var'; addV.title = 'add a variable (a new column)';
    addV.onclick = () => { let i = 1; while (vars.includes('var' + i)) i++; blk.each = rows2.map((r2) => ({ ...r2, ['var' + i]: '' })); render(); };
    thA.appendChild(addV); trh.appendChild(thA);
    tbl.appendChild(trh);
    rows2.forEach((r2, ri) => {
      const tr = document.createElement('tr');
      for (const v of vars) {
        const td = document.createElement('td');
        const inp = document.createElement('input'); inp.value = r2[v] === undefined ? '' : String(r2[v]);
        inp.onchange = () => { r2[v] = coerceCell(inp.value); };
        td.appendChild(inp); tr.appendChild(td);
      }
      const tdx = document.createElement('td');
      const rm = document.createElement('button'); rm.textContent = '×'; rm.title = 'remove this run';
      rm.onclick = () => { rows2.splice(ri, 1); if (!rows2.length) rows2.push(Object.fromEntries(vars.map((v) => [v, '']))); render(); };
      tdx.appendChild(rm); tr.appendChild(tdx);
      tbl.appendChild(tr);
    });
    host.appendChild(tbl);
    const addR = document.createElement('button'); addR.className = 'rw-x'; addR.textContent = '+ row';
    addR.onclick = () => { rows2.push({ ...rows2[rows2.length - 1] }); render(); };   // duplicate the last run — edit what differs
    host.appendChild(addR);
  }
  // ── header widgets (created once; render() rebuilds only the steps list) ──
  const top = document.createElement('div'); scrollEl.appendChild(top);
  const nameBar = document.createElement('div'); nameBar.className = 'rw-bar';
  const nameL = document.createElement('span'); nameL.className = 'lbl'; nameL.textContent = 'name';
  const nameI = document.createElement('input'); nameI.type = 'text'; nameI.style.flex = '1'; nameI.value = model.name || ''; nameI.placeholder = 'month-end';
  nameBar.append(nameL, nameI); top.appendChild(nameBar);
  const gBar = document.createElement('div'); gBar.className = 'rw-bar';
  const gChk = document.createElement('input'); gChk.type = 'checkbox'; gChk.id = 'rwGuard'; gChk.checked = guard;
  gChk.onchange = () => { guard = gChk.checked; };
  const gLab = document.createElement('label'); gLab.htmlFor = 'rwGuard'; gLab.className = 'lbl'; gLab.textContent = 'guard: stop before running if a report already exists';
  gBar.append(gChk, gLab); top.appendChild(gBar);
  const oBar = document.createElement('div'); oBar.className = 'rw-bar';
  const oL = document.createElement('span'); oL.className = 'lbl'; oL.textContent = 'reports →';
  const dirI = document.createElement('input'); dirI.type = 'text'; dirI.style.width = '11em'; dirI.placeholder = `reports/${new Date().toISOString().slice(0, 10)}`; dirI.value = (model.params.output && model.params.output.dir) || '';
  const preL = document.createElement('span'); preL.className = 'lbl'; preL.textContent = 'prefix';
  const preI = document.createElement('input'); preI.type = 'text'; preI.style.width = '5em'; preI.value = (model.params.output && model.params.output.prefix) || '';
  const sufL = document.createElement('span'); sufL.className = 'lbl'; sufL.textContent = 'suffix';
  const sufI = document.createElement('input'); sufI.type = 'text'; sufI.style.width = '5em'; sufI.value = (model.params.output && model.params.output.suffix) || '';
  oBar.append(oL, dirI, preL, preI, sufL, sufI); top.appendChild(oBar);
  // ── asks first: the routine's own `inputs:` (running it opens the
  // generated dialog; answers land at $name markers BEFORE the parameter
  // table expands — keep input names distinct from the table's variables) ──
  model.inputs = Array.isArray(model.inputs) ? model.inputs : [];
  const inpWrap = document.createElement('div'); scrollEl.appendChild(inpWrap);
  const INPUT_TYPES = ['text', 'number', 'choice', 'layer', 'column'];
  function renderInputs() {
    inpWrap.textContent = '';
    model.inputs.forEach((inp, i) => {
      const row = document.createElement('div'); row.className = 'rw-bar';
      const ask = document.createElement('span'); ask.className = 'lbl'; ask.textContent = i === 0 ? 'ask' : 'and';
      const mk = (key, w, ph, num) => {
        const f = document.createElement('input'); f.type = 'text'; f.style.width = w; f.placeholder = ph;
        f.value = inp[key] !== undefined ? String(inp[key]) : '';
        f.onchange = () => { const v = f.value.trim(); if (!v) delete inp[key]; else inp[key] = num ? coerceCell(v) : v; };
        return f;
      };
      const name = mk('name', '6em', '$name');
      const ty = document.createElement('select');
      for (const x of INPUT_TYPES) { const o = document.createElement('option'); o.value = o.textContent = x; ty.appendChild(o); }
      ty.value = INPUT_TYPES.includes(inp.type) ? inp.type : 'text';
      ty.onchange = () => { if (ty.value === 'text') delete inp.type; else inp.type = ty.value; renderInputs(); };
      const label = mk('label', '10em', 'the question (label)');
      row.append(ask, name, ty, label);
      const t = inp.type || 'text';
      if (t === 'choice') {
        const opts = document.createElement('input'); opts.type = 'text'; opts.style.width = '10em'; opts.placeholder = 'options, comma-separated';
        opts.value = (inp.options || []).join(', ');
        opts.onchange = () => { const v = opts.value.split(',').map((x) => coerceCell(x.trim())).filter((x) => x !== ''); if (v.length) inp.options = v; else delete inp.options; };
        row.appendChild(opts);
      } else if (t === 'column') row.appendChild(mk('of', '6em', 'of: a layer input'));
      else row.appendChild(mk('default', '6em', 'default', t === 'number'));
      const rm = document.createElement('button'); rm.className = 'rw-x'; rm.textContent = '×'; rm.title = 'remove this question';
      rm.onclick = () => { model.inputs.splice(i, 1); renderInputs(); };
      row.appendChild(rm);
      inpWrap.appendChild(row);
    });
    const add = document.createElement('button'); add.className = 'rw-x'; add.textContent = model.inputs.length ? '+ question' : '+ ask first (inputs)…';
    add.title = 'running the routine asks these first; answers land at $name markers in the steps';
    add.onclick = () => { model.inputs.push({ name: 'p' + (model.inputs.length + 1) }); renderInputs(); };
    inpWrap.appendChild(add);
  }
  renderInputs();
  const list = document.createElement('div'); scrollEl.appendChild(list);
  const foot = document.createElement('div'); win.body.appendChild(foot);
  // an `each` block's body is a step list, so it can hold another `each` — the
  // editor renders the tree the same way the runner expands it. Nesting is a
  // CROSS PRODUCT (every outer row × every inner row); one `each` with two
  // equal-length columns is a ZIP. The block header says which, out loud.
  function renderSteps(arr, host, depth) {
    for (const st of arr) {
      const box = document.createElement('div'); box.className = 'rw-step';
      if (depth) box.style.marginLeft = '10px';
      if (st.each !== undefined) {
        const hd = document.createElement('div'); hd.className = 'rw-bar';
        const t = document.createElement('span'); t.className = 'lbl';
        t.textContent = depth ? 'and for each row of —' : 'for each row —';
        if (depth) t.title = 'nested: every row of the outer block × every row of this one (a cross product)';
        const asL = document.createElement('span'); asL.className = 'lbl'; asL.textContent = 'as';
        asL.title = 'optional — namespaces this table\'s columns ($b.grade instead of $grade); keeps nested tables apart';
        const asI = document.createElement('input'); asI.type = 'text'; asI.style.width = '4em'; asI.value = st.as || '';
        asI.onchange = () => { if (asI.value.trim()) st.as = asI.value.trim(); else delete st.as; };
        const fL = document.createElement('span'); fL.className = 'lbl'; fL.textContent = 'where';
        fL.title = 'optional — which rows fan out (an expression over this table\'s columns; scalars are visible too)';
        const fI = document.createElement('input'); fI.type = 'text'; fI.style.width = '10em'; fI.placeholder = 'active = true'; fI.value = st.filter || '';
        fI.onchange = () => { if (fI.value.trim()) st.filter = fI.value.trim(); else delete st.filter; };
        const up = document.createElement('button'); up.className = 'rw-x'; up.textContent = '↑';
        const dn = document.createElement('button'); dn.className = 'rw-x'; dn.textContent = '↓';
        const rm = document.createElement('button'); rm.className = 'rw-x'; rm.textContent = '×'; rm.title = 'remove the whole block';
        up.onclick = () => { const i = arr.indexOf(st); if (i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, st); render(); } };
        dn.onclick = () => { const i = arr.indexOf(st); if (i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, st); render(); } };
        rm.onclick = () => { arr.splice(arr.indexOf(st), 1); render(); };
        hd.append(t, asL, asI, fL, fI, up, dn, rm); box.appendChild(hd);
        eachGrid(st, box);
        st.steps = st.steps || [];
        renderSteps(st.steps, box, depth + 1);             // ← the nesting
        const add = document.createElement('button'); add.className = 'rw-x'; add.textContent = '+ step in this block';
        add.onclick = () => { st.steps.push({ recipe: '' }); render(); };
        const addI2 = document.createElement('button'); addI2.className = 'rw-x'; addI2.textContent = '+ inline step';
        addI2.onclick = () => { st.steps.push({ tool: 'gt' }); render(); };
        const addN = document.createElement('button'); addN.className = 'rw-x'; addN.textContent = '+ nested for-each';
        addN.title = 'a table inside this one — every row × every row (a cross product)';
        addN.onclick = () => { st.steps.push({ each: [{ var1: '' }], steps: [{ recipe: '' }] }); render(); };
        box.append(add, addI2, addN);
      } else if (st.params !== undefined) {
        const hd = document.createElement('div'); hd.className = 'rw-bar';
        const t = document.createElement('span'); t.className = 'lbl'; t.textContent = 'bind params —';
        const spec = Array.isArray(st.params) ? st.params[0] || {} : st.params;
        const fromI = document.createElement('input'); fromI.type = 'text'; fromI.style.flex = '1'; fromI.placeholder = 'params.xlsx#General'; fromI.value = spec.from || '';
        fromI.onchange = () => { spec.from = fromI.value.trim(); st.params = spec; };
        const asL = document.createElement('span'); asL.className = 'lbl'; asL.textContent = 'as';
        const asI = document.createElement('input'); asI.type = 'text'; asI.style.width = '4em'; asI.value = spec.as || '';
        asI.onchange = () => { if (asI.value.trim()) spec.as = asI.value.trim(); else delete spec.as; st.params = spec; };
        const rm = document.createElement('button'); rm.className = 'rw-x'; rm.textContent = '×';
        rm.onclick = () => { arr.splice(arr.indexOf(st), 1); render(); };
        hd.append(t, fromI, asL, asI, rm);
        box.appendChild(hd);
        const hint = document.createElement('div'); hint.className = 'lbl'; hint.style.paddingLeft = '10px';
        hint.textContent = 'a key→value sheet → scalars every step below can read ($g.cutoff)';
        box.appendChild(hint);
      } else stepRow(st, arr, box, depth > 0);
      host.appendChild(box);
    }
  }
  function render() {
    list.textContent = '';
    renderSteps(steps, list, 0);
    const addBar = document.createElement('div'); addBar.className = 'rw-bar';
    const addS = document.createElement('button'); addS.className = 'sw-add'; addS.textContent = '+ run a recipe';
    addS.onclick = () => { steps.push({ recipe: '' }); render(); };
    const addI = document.createElement('button'); addI.className = 'sw-add'; addI.textContent = '+ inline step';
    addI.title = 'a step configured in place — no saved recipe needed';
    addI.onclick = () => { steps.push({ tool: 'gt' }); render(); };
    const addE = document.createElement('button'); addE.className = 'sw-add'; addE.textContent = '+ for-each block';
    addE.onclick = () => { steps.push({ each: [{ var1: '' }], steps: [{ recipe: '' }] }); render(); };
    const addP = document.createElement('button'); addP.className = 'sw-add'; addP.textContent = '+ params';
    addP.title = 'bind a key→value sheet as scalars for the steps below';
    addP.onclick = () => { steps.push({ params: { from: '', as: 'g' } }); render(); };
    addBar.append(addS, addI, addE, addP);
    list.appendChild(addBar);
  }
  render();
  // ── preview / save / run ──
  const bar = document.createElement('div'); bar.className = 'rw-actions';
  const prevB = document.createElement('button'); prevB.className = 'awin-btn'; prevB.textContent = 'Preview'; prevB.title = 'enumerate every step and report path — nothing runs';
  const saveB = document.createElement('button'); saveB.className = 'awin-btn'; saveB.textContent = 'Save';
  const runB = document.createElement('button'); runB.className = 'awin-btn btn-p'; runB.textContent = 'Save & Run';
  bar.append(prevB, saveB, runB); foot.appendChild(bar);
  const prev = document.createElement('div'); prev.className = 'rw-prev'; prev.style.display = 'none'; scrollEl.appendChild(prev);
  prevB.onclick = async () => {
    prev.style.display = '';
    prev.textContent = '';
    setTimeout(() => prev.scrollIntoView({ block: 'nearest' }), 60);
    try {
      let P2 = collect();
      // resolve the routine's own inputs from defaults / last answers, so the
      // preview (and click-to-open) shows what a run would actually do
      const goodInputs = (model.inputs || []).filter((x) => x && x.name);
      const assumed = [], unresolved = [];
      if (goodInputs.length) {
        const values = {};
        for (const inp of goodInputs) {
          const v = r0 && r0._lastInputs && r0._lastInputs[inp.name] !== undefined ? r0._lastInputs[inp.name] : inp.default;
          if (v !== undefined) { values[inp.name] = v; assumed.push(`${inp.name}=${v}`); }
          else unresolved.push(inp.name);
        }
        P2 = { ...P2, steps: routineSubst(P2.steps, values) };
      }
      const st2 = await expandRoutine(P2);
      if (P2.params) {
        try {
          const { report } = await routineLoadParams(P2.params);
          for (const line of report) {
            const pr = document.createElement('div'); pr.className = 'rw-prevline dim';
            pr.textContent = 'params: ' + line;
            prev.appendChild(pr);
          }
        } catch (e2) {
          const pr = document.createElement('div'); pr.className = 'rw-prevline fail';
          pr.textContent = '⚠ ' + e2.message;
          prev.appendChild(pr);
        }
      }
      if (assumed.length || unresolved.length) {
        const a = document.createElement('div'); a.className = 'rw-prevline dim';
        a.textContent = (assumed.length ? `assuming ${assumed.join(', ')} (defaults / last answers)` : '')
          + (unresolved.length ? `${assumed.length ? ' · ' : ''}no value yet for ${unresolved.map((x) => '$' + x).join(', ')}` : '');
        prev.appendChild(a);
      }
      st2.forEach((st, i) => {
        const info = routineLineInfo(st, i, P2);
        const line = document.createElement('div');
        line.className = 'rw-prevline' + (info.openable ? ' open' : '');
        line.textContent = info.text;
        if (info.openable) {
          line.title = 'click: open this step configured (nothing runs) · right-click: run the routine FROM here';
          line.onclick = () => runRecipe(routineStepOp(st), false);
        } else line.title = 'right-click: run the routine FROM here';
        line.oncontextmenu = async (ev) => {               // start a long routine part-way through
          ev.preventDefault();
          const rec = await save();
          if (rec) runRoutine(rec, { from: i });
        };
        prev.appendChild(line);
      });
      if (!st2.length) prev.textContent = '(no steps yet)';
    } catch (e) { prev.textContent = '⚠ ' + e.message; }
  };
  async function save() {
    if (!S.project) { msg('routine: open or save a project first (a routine is a file in recipes/)'); return null; }
    if (win.body.querySelector('.rw-ovr.err')) { msg('routine: fix the override YAML first (the red box)'); return null; }
    let name = nameI.value.trim();
    if (!name) { name = ((await H.microPrompt('routine name', '')) || '').trim(); if (!name) return null; nameI.value = name; }
    const goodInputs = (model.inputs || []).filter((x) => x && x.name);
    const rec = { name, tool: 'routine', params: collect(), inputs: goodInputs.length ? goodInputs : undefined, file: file || 'recipes/' + recipeSlug(name) + '.yaml' };
    try {
      const fh = await resolveFileHandle(S.project.dir, rec.file, { create: true });
      const w = await fh.createWritable(); await w.write(recipeYaml(rec)); await w.close();
    } catch (e) { msg('routine save failed — ' + e.message); return null; }
    file = rec.file;
    const at = S.recipes.findIndex((x) => x.file === rec.file);
    if (at >= 0) S.recipes[at] = rec; else { S.recipes.push(rec); S.recipes.sort((a, b) => a.name.localeCompare(b.name)); }
    win.sub.textContent = rec.file;
    msg(`saved routine “${name}” → ${rec.file}`);
    return rec;
  }
  saveB.onclick = save;
  runB.onclick = async () => { const rec = await save(); if (rec) runRecipe(rec, true); };
  return win;
}

// ── the generated INPUTS dialog — a recipe (or routine) with a top-level
// `inputs:` list asks these questions first, then runs a copy with the
// answers substituted through the same $var macro the each block uses.
// Types: text (default), number, choice (options:), layer (loaded layers),
// column (columns of the layer named by `of:`, else the first layer input,
// else the active layer). Same rule as each: exact "$name" lands typed. ──
export function openInputsDialog(r) {
  const win = floatWin({ title: r.name || 'recipe', sub: 'inputs', x: innerWidth / 2 - 190, y: innerHeight / 3, w: 380, h: Math.min(90 + r.inputs.length * 30 + 40, innerHeight - 120) });
  win.el.dataset.inputsDialog = '1';
  win.body.className += ' rw-body';
  const vals = { ...(r._lastInputs || {}) };
  const fields = new Map();
  const layerValOf = (inp) => {
    const src = inp.of ? fields.get(inp.of) : [...fields.values()].find((f) => f._itype === 'layer');
    return src ? src.value : null;
  };
  const fillCols = (sel, inp) => {
    const L2 = S.layers.find((x) => x.name === layerValOf(inp)) || activeLayer();
    const cur = sel.value;
    sel.textContent = '';
    for (const c of colChoicesOf(L2)) { const o = document.createElement('option'); o.value = o.textContent = c; sel.appendChild(o); }
    const want = cur || (vals[inp.name] !== undefined ? vals[inp.name] : inp.default);
    if (want !== undefined && [...sel.options].some((o) => o.value === String(want))) sel.value = String(want);
  };
  for (const inp of r.inputs) {
    const row = document.createElement('div'); row.className = 'rw-bar';
    const lab = document.createElement('span'); lab.className = 'lbl'; lab.style.flex = '0 0 42%'; lab.textContent = inp.label || inp.name;
    const ty = inp.type || 'text';
    let f;
    if (ty === 'choice' || ty === 'layer' || ty === 'column') {
      f = document.createElement('select');
      if (ty === 'choice') for (const o of inp.options || []) { const op = document.createElement('option'); op.value = op.textContent = String(o); f.appendChild(op); }
      if (ty === 'layer') for (const L2 of S.layers) { const op = document.createElement('option'); op.value = op.textContent = L2.name; f.appendChild(op); }
      if (ty === 'column') fillCols(f, inp);
      const want = vals[inp.name] !== undefined ? vals[inp.name] : inp.default;
      if (want !== undefined && [...f.options].some((o) => o.value === String(want))) f.value = String(want);
      if (ty === 'layer') f.onchange = () => { for (const inp2 of r.inputs) { if ((inp2.type || 'text') === 'column') fillCols(fields.get(inp2.name), inp2); } };
    } else {
      f = document.createElement('input'); f.type = ty === 'number' ? 'number' : 'text';
      if (ty === 'number') f.step = 'any';
      const want = vals[inp.name] !== undefined ? vals[inp.name] : inp.default;
      if (want !== undefined) f.value = String(want);
    }
    f._itype = ty; f.style.flex = '1';
    fields.set(inp.name, f);
    row.append(lab, f);
    win.body.appendChild(row);
  }
  const bar = document.createElement('div'); bar.className = 'rw-bar'; bar.style.justifyContent = 'flex-end'; bar.style.marginTop = '6px';
  const runB = document.createElement('button'); runB.className = 'awin-btn'; runB.textContent = 'Run';
  runB.onclick = () => {
    const values = {};
    for (const [nm, f] of fields) values[nm] = f._itype === 'number' && f.value !== '' && Number.isFinite(+f.value) ? +f.value : f.value;
    r._lastInputs = values;                                  // session memory — the next Run… starts here
    win.close();
    runRecipe({ ...r, inputs: undefined, params: routineSubst(JSON.parse(JSON.stringify(r.params)), values) }, true);
  };
  bar.appendChild(runB);
  win.body.appendChild(bar);
  return win;
}
