// micro — the routine WINDOWS: the routine editor (steps, the each-table as a grid, the
// asks-first section, per-step overrides; the YAML file stays the truth; Preview opens
// any parameterization configured, not run) and the asks-first inputs dialog a routine
// shows before it runs. The routine engine and the run tracker are src/recipes.js.
import { layerTableHeader } from './records.js';
import { routineEachRows, RECIPE_TOOLS, jsToYamlNode, yamlToJs, routineSubst, expandRoutine, routineLoadParams, routineLineInfo, runRecipe, routineStepOp, runRoutine, recipeSlug, recipeYaml, inputsProblems } from './recipes.js';
import { floatWin } from './windows.js';
import { S, activeLayer } from './state.js';
import { emit as yamlEmit, parse as yamlParse } from '../../../ext/yaml/index.js';
import { microPrompt } from './prompts.js';
import { resolveFileHandle } from './paths.js';
import { yamlField } from './yamlfield.js';
const $ = (s) => document.querySelector(s);

// ── the ROUTINE EDITOR — the routine's YAML file stays the single source of
// truth (same contract as the filter drawer): the window edits a parsed copy,
// Save re-emits the whole file through @gcu/yaml. The star is the `each`
// parameter TABLE — variables as columns, runs as rows, edited as a grid
// instead of maintaining parallel lists by hand. The editor always writes the
// rows form (one map per run); the columns and {from} forms still load.
// Preview enumerates the expansion — every step and every report path —
// before anything runs, which is the whole point of macro-not-program. ──
function colChoicesOf(L) {                                  // plain column names a recipe can reference
  const h = L && layerTableHeader(L); if (!h) return [];
  const out = [...h.columns];
  for (const c of L.paintCols || []) out.push(c.name);
  for (const c of L.calcCols || []) out.push(c.name);
  return out;
}
const coerceCell = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : v);
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
  function stepRow(st, arr, host, inEach, varsOf) {
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
    host.appendChild(ovr);
    // the box is a small YAML editor: highlighting, the tool's settings at the caret, live checks
    const rcOf = () => (st.recipe ? S.recipes.find((x) => x.name === st.recipe) : null);
    const yf = yamlField(ovr, () => ({ tool: inline ? st.tool : (rcOf() || {}).tool, base: inline ? {} : (rcOf() || {}).params, vars: varsOf() }));
    yf.el.style.display = inline || ovr.value ? '' : 'none';
    sel.addEventListener('change', () => yf.lint());           // another tool / recipe → re-check against it
    ovB.onclick = () => { yf.el.style.display = yf.el.style.display === 'none' ? '' : 'none'; if (yf.el.style.display === '') ovr.focus(); };
    ovr.onchange = () => {
      const txt = ovr.value.trim();
      try {
        const obj = txt ? yamlToJs(yamlParse(txt)) : {};
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('a map');
        setExtras(st, [...skip, 'each', 'steps', 'guard', 'params', 'filter', 'emit'], obj);
        ovr.classList.remove('err');
      } catch { ovr.classList.add('err'); }
    };
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
  const dirI = document.createElement('input'); dirI.type = 'text'; dirI.style.width = '11em'; dirI.placeholder = 'runs/<date time> <routine>';   // the default: each run gets its own folder dirI.value = (model.params.output && model.params.output.dir) || '';
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
  function renderSteps(arr, host, depth, varsOf = () => (model.inputs || []).filter((x) => x && x.name).map((x) => x.name)) {
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
        const blockVars = () => { const ks = Array.isArray(st.each) ? [...new Set(st.each.flatMap((r2) => Object.keys(r2 || {})))] : []; return [...varsOf(), ...ks.map((k) => (st.as ? `${st.as}.${k}` : k))]; };
        renderSteps(st.steps, box, depth + 1, blockVars);  // ← the nesting
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
      } else stepRow(st, arr, box, depth > 0, varsOf);
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
    if (!name) { name = ((await microPrompt('routine name', '')) || '').trim(); if (!name) return null; nameI.value = name; }
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
export function openInputsDialog(r, runOpts = null) {   // runOpts: carried to the run (a run without a project)
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
    const req = inputsProblems(r, values);                    // a layer input's required columns, before anything runs
    if (req.length) { let m = win.body.querySelector('.rw-prevline.fail'); if (!m) { m = document.createElement('div'); m.className = 'rw-prevline fail'; bar.before(m); } m.textContent = req.join(' · '); return; }
    win.close();
    runRecipe({ ...r, inputs: undefined, _inputs: values, params: routineSubst(JSON.parse(JSON.stringify(r.params)), values) }, true, runOpts);   // _inputs: the run record keeps the answers
  };
  bar.appendChild(runB);
  win.body.appendChild(bar);
  return win;
}
