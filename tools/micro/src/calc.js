// micro — the calculated-column window: write an expression, see it checked against
// the layer's columns, and add it as a column the filter and the colouring can use.
import { blockSchema, layerTableHeader, sampleRow, schemaExt, calcOrder, attrRowCountOf, numOf, layerRecords } from './records.js';
import { floatWin, raiseWindow } from './windows.js';
import { markProjectDirty } from './project.js';
import { S, requestRender } from './state.js';
import { _propFor, _propOpen, refreshProps, renderProps } from './props.js';
import { addPaintColorOptions } from './paint.js';
import { syncRuleMode } from './rules.js';
import { applyRamp, colorSelOf } from './ramp.js';
import { compileValue, deps, parse, quoteIdent, validate, compileChunk } from '../../../ext/expr/index.js';
import { columnValues, exprField, syncHL } from './exprfield.js';
import { fdBounds, fdNum, fdRenderChain, fdRenderLeaf, fdValues } from './filter-drawer.js';
import { numericColsOf } from './analysis.js';
import { pushUndo } from './undo.js';
import { saveRecipe } from './recipes.js';
import { setLayerColorSel } from './color.js';
import { refilterLayer } from './filter.js';
import { _attrTables } from './attrtable.js';
import { matColSourceHash, matColCodes, PAINT_BLANK, expandedDeps, pinGet, pinWindow, censusChunkCols, ensureStoredValues, matColSet } from './columns.js';
import { fmtStat } from './analysis-ui.js';
import { mkLineage } from './lineage.js';
import { persistElement } from './element-store.js';
import { renderLayers } from './tree.js';
const $ = (s) => document.querySelector(s);

// ── ƒ CALCULATIONS window — the calc-column authoring workbench (Leapfrog's
// calculations-editor shape): the column list on a left rail, ONE expression
// editor on the right — multiline, highlighted, live-validated against the
// FULL schema (base + stored + the OTHER ƒ columns, so calc-on-calc composes;
// self-reference is excluded). Typing the expression is the primary interface;
// the projection widgets (constant sliders, if-ladder case table) layer on top.
export const _calcWins = new Map();

export function openCalcWindow(L, selIdx) {
  if (!L || !layerTableHeader(L)) { $('#meta').textContent = 'calculations: this layer has no column table'; return; }
  const ex = _calcWins.get(L.id);
  if (ex) { raiseWindow(ex.el); if (selIdx != null) ex.select(selIdx); return; }
  const win = floatWin({ title: `ƒ calculations · ${L.label || L.name}`, sub: '', x: 120, y: 100, w: 620, h: 330, onClose: () => _calcWins.delete(L.id) });
  win.body.style.cssText += 'display:flex;flex-direction:column;';
  const wrap = document.createElement('div'); wrap.className = 'cw-wrap'; wrap.style.cssText = 'flex:1;min-height:0;';
  const rail = document.createElement('div'); rail.className = 'cw-rail';
  const main = document.createElement('div'); main.className = 'cw-main';
  wrap.append(rail, main);
  win.body.appendChild(wrap);
  let sel = selIdx != null ? selIdx : ((L.calcCols || []).length ? 0 : -1);   // -1 = the add form
  const select = (k) => { sel = k; render(); };
  function invalidate() {
    L._calcFns = null; L._colStats = null; markProjectDirty();
    if (L.filterExpr) refilterLayer(L);                     // a live filter picks up the new definition (any layer)
    if (L.id === S.activeId) addPaintColorOptions(L);       // ƒ color-by options track the column set
    if (calcSelOf(L)) { applyRamp(L, true); syncRuleMode(L); }   // a live ƒ color re-realizes (closure-hash gated)
    renderProps();
  }
  function render() {
    const cols = L.calcCols || [];
    if (sel >= cols.length) sel = cols.length ? cols.length - 1 : -1;
    rail.textContent = '';
    cols.forEach((c, k) => {
      const it = document.createElement('div'); it.className = 'cw-item' + (k === sel ? ' on' : '');
      const fx = document.createElement('span'); fx.className = 'fx'; fx.textContent = 'ƒ';
      it.append(fx, document.createTextNode(c.name)); it.title = c.expr;
      it.onclick = () => select(k);
      rail.appendChild(it);
    });
    const add = document.createElement('div'); add.className = 'cw-item' + (sel === -1 ? ' on' : ''); add.textContent = '+ add…';
    add.onclick = () => select(-1);
    rail.appendChild(add);
    renderEditor();
  }
  function renderEditor() {
    main.textContent = '';
    const h = layerTableHeader(L);
    const cur = sel >= 0 ? L.calcCols[sel] : null;
    const nameRow = document.createElement('div'); nameRow.className = 'cw-row';
    const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.placeholder = 'name (e.g. FE_EQ)'; nameIn.style.flex = '1';
    const tySel = document.createElement('select');
    for (const [v, t] of [['auto', 'auto'], ['number', 'number'], ['string', 'text']]) tySel.append(new Option(t, v));
    if (cur) { nameIn.value = cur.name; tySel.value = cur.ty === 'string' ? 'string' : 'number'; }
    nameRow.append(nameIn, tySel);
    const edwrap = document.createElement('div'); edwrap.className = 'cw-edwrap';
    const edhl = document.createElement('div'); edhl.className = 'exprhl'; edhl.setAttribute('aria-hidden', 'true');
    const ed = document.createElement('textarea'); ed.rows = 3; ed.spellcheck = false; ed.wrap = 'off';
    ed.placeholder = 'value expression…  e.g.  FE + 0.4 * MN   # comments ok';
    if (cur) ed.value = cur.expr;
    edwrap.append(edhl, ed);
    const err = document.createElement('div'); err.className = 'cw-err';
    const proj = document.createElement('div'); proj.className = 'cw-proj fdw';
    const hint = document.createElement('div'); hint.className = 'cw-hint';
    hint.textContent = 'a value expression over base + stored + other ƒ columns — if(cond, a, b) · bin(x, breaks…) · math + string fns · # comments';
    const schemaFor = () => schemaExt(L, h).filter((c) => !cur || String(c.name).toLowerCase() !== String(cur.name).toLowerCase());
    const check = () => {
      const t = ed.value.trim();
      if (!t) { ed.classList.remove('err'); err.textContent = ''; return false; }
      const v = validate(t, schemaFor());
      ed.classList.toggle('err', !v.ok);
      err.textContent = v.ok ? '' : ((v.errors[0] && v.errors[0].message) || 'invalid expression');
      return v.ok;
    };
    const sync = () => syncHL(ed, edhl);
    exprField(ed, () => ({ columns: schemaFor(), values: L.id === S.activeId ? columnValues : () => [] }));   // the phone's strip
    for (const ev of ['scroll', 'keyup', 'click']) ed.addEventListener(ev, sync);
    ed.addEventListener('input', () => { sync(); if (check()) project(); });
    // ── the PROJECTION: the expression rendered as widgets (same contract as the
    // filter drawer — every element rewrites its own source span in the editor).
    // An if() ladder projects as a CASE TABLE (condition | value — density by
    // domain, recovery by lithology); anything else lists its numeric constants
    // as sliders (tune a coefficient, watch a live filter/ramp move). Widget
    // edits AUTO-SAVE an existing column (debounced); typed edits wait for save.
    let cwSpans = []; let saveT = null;
    const cwReplace = (sp, txt) => {
      const s0 = ed.value, nt = s0.slice(0, sp.start) + txt + s0.slice(sp.end);
      const delta = txt.length - (sp.end - sp.start);
      for (const o of cwSpans) { if (o === sp) continue; if (o.start >= sp.end) { o.start += delta; o.end += delta; } else if (o.start <= sp.start && o.end >= sp.end) { o.end += delta; } }
      sp.end = sp.start + txt.length;
      ed.value = nt; sync(); check();
      if (cur) { clearTimeout(saveT); saveT = setTimeout(() => doSave(true), 400); }
    };
    const cwCtx = { push: (sp) => cwSpans.push(sp), replace: cwReplace, rerender: () => project() };
    const ladderOf = (n) => {
      if (!(n && n.t === 'call' && n.fn === 'if')) return null;
      const rows = []; let x = n;
      while (x && x.t === 'call' && x.fn === 'if' && x.args.length === 3) { rows.push({ cond: x.args[0], val: x.args[1] }); x = x.args[2]; }
      return { rows, els: x };
    };
    const numOf = (x) => (x && x.t === 'num' ? x.v : (x && x.t === 'neg' && x.e && x.e.t === 'num' ? -x.e.v : null));
    function valCell(v, lo, hi) {                          // a value slot: number+slider / text / read-only expr
      const cell = document.createElement('span'); cell.className = 'cw-val';
      const nv = numOf(v);
      if (nv != null && v.start != null) {
        cwSpans.push(v);
        const step = (hi - lo) / 200 || 0.01;
        const sl = document.createElement('input'); sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = step; sl.value = nv;
        const nb = document.createElement('input'); nb.type = 'number'; nb.step = 'any'; nb.value = fdNum(nv, step);
        sl.oninput = () => { nb.value = fdNum(+sl.value, step); cwReplace(v, fdNum(+sl.value, step)); };
        sl.onchange = () => project();
        nb.onchange = () => { cwReplace(v, fdNum(+nb.value, step)); project(); };
        cell.append(sl, nb);
      } else if (v && v.t === 'str' && v.start != null) {
        cwSpans.push(v);
        const t = document.createElement('input'); t.type = 'text'; t.value = v.v; t.style.width = '90px';
        t.onchange = () => { cwReplace(v, '"' + t.value.replace(/"/g, '') + '"'); project(); };
        cell.appendChild(t);
      } else {
        const x = document.createElement('span'); x.className = 'fd-expr';
        x.textContent = v && v.start != null ? ed.value.slice(v.start, v.end) : '…';
        cell.appendChild(x);
      }
      return cell;
    }
    function project() {
      proj.textContent = ''; cwSpans = [];
      const t = ed.value.trim(); if (!t) return;
      let ast = null; try { ast = parse(t); } catch { return; }
      const lad = ladderOf(ast);
      if (lad) {
        const sect = document.createElement('div'); sect.className = 'cw-sect'; sect.textContent = 'cases'; proj.appendChild(sect);
        const nums = [...lad.rows.map((r) => numOf(r.val)), numOf(lad.els)].filter((x) => x != null);
        let lo = Math.min(...nums), hi = Math.max(...nums);
        if (!nums.length || lo === hi) { const v = nums[0] || 0, sp2 = Math.max(1, Math.abs(v)); lo = v - sp2; hi = v + sp2; }
        else { const pad = (hi - lo) * 0.5; lo -= pad; hi += pad; }
        for (const r of lad.rows) {
          const row = document.createElement('div'); row.className = 'cw-case';
          const cond = document.createElement('div'); cond.className = 'cw-cond';
          if (r.cond && (r.cond.t === 'and' || r.cond.t === 'or')) fdRenderChain(cond, r.cond, L, cwCtx);
          else fdRenderLeaf(cond, r.cond, L, cwCtx);
          row.append(cond, valCell(r.val, lo, hi));
          proj.appendChild(row);
        }
        const erow = document.createElement('div'); erow.className = 'cw-case';
        const elab = document.createElement('div'); elab.className = 'cw-else'; elab.textContent = 'else';
        erow.append(elab, valCell(lad.els, lo, hi));
        proj.appendChild(erow);
        if (lad.els && lad.els.start != null) {            // add a case ABOVE the else (rewrites the else slot)
          const at = { start: lad.els.start, end: lad.els.end };
          cwSpans.push(at);
          const addRow = document.createElement('div'); addRow.className = 'fd-row fd-add';
          const selC = document.createElement('select');
          selC.append(new Option('add case…', ''));
          const mm = h.mapping || {}; const catName = mm.cat != null ? h.columns[mm.cat] : null;
          if (catName) selC.append(new Option(catName, 'c:' + catName));
          for (const c of numericColsOf(L)) selC.append(new Option(c, 'n:' + c));
          selC.onchange = () => {
            const v = selC.value; if (!v) return;
            const col = v.slice(2);
            let clause;
            if (v[0] === 'c') { const vals = fdValues(L, col, []); clause = quoteIdent(col) + ' = "' + (vals[0] || '') + '"'; }
            else { const [blo, bhi] = fdBounds(L, col, 0); clause = quoteIdent(col) + ' > ' + fdNum((blo + bhi) / 2, (bhi - blo) / 200 || 0.01); }
            const elsTxt = ed.value.slice(at.start, at.end);
            cwReplace(at, 'if(' + clause + ', ' + elsTxt + ', ' + elsTxt + ')');
            project();
          };
          addRow.appendChild(selC);
          proj.appendChild(addRow);
        }
        return;
      }
      // constants: every numeric literal becomes a tunable slider, labelled by context
      const lits = [];
      (function walk(n) {
        if (!n || typeof n !== 'object') return;
        if (numOf(n) != null && n.start != null) { lits.push(n); return; }
        for (const k of ['l', 'r', 'e', 'lo', 'hi']) if (n[k]) walk(n[k]);
        if (n.args) n.args.forEach(walk);
        if (n.set) n.set.forEach(walk);
      })(ast);
      if (!lits.length || lits.length > 8) return;
      const sect = document.createElement('div'); sect.className = 'cw-sect'; sect.textContent = 'constants'; proj.appendChild(sect);
      for (const v of lits) {
        const nv = numOf(v), sp2 = Math.max(1, Math.abs(nv) * 2);
        const row = document.createElement('div'); row.className = 'cw-case';
        const klab = document.createElement('span'); klab.className = 'cw-klabel';
        klab.textContent = (v.start > 12 ? '…' : '') + ed.value.slice(Math.max(0, v.start - 12), Math.min(ed.value.length, v.end + 12)).replace(/\n/g, ' ') + (v.end + 12 < ed.value.length ? '…' : '');
        row.append(klab, valCell(v, nv - sp2, nv + sp2));
        proj.appendChild(row);
      }
    }
    async function doSave(auto) {
      const name = nameIn.value.trim(), expr = ed.value.trim();
      const taken = new Set([...h.columns, ...(L.paintCols || []).map((c) => c.name), ...(L.calcCols || []).filter((_, i) => i !== sel).map((c) => c.name)].map((n) => n.toLowerCase()));
      if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { err.textContent = 'name: letters/digits/underscore, not starting with a digit'; return; }
      if (taken.has(name.toLowerCase())) { err.textContent = `"${name}" already exists`; return; }
      if (!check()) return;
      try { compileValue(expr, schemaFor(), { decimal: '.' }); } catch (e) { err.textContent = e.message; return; }
      let ty = tySel.value;
      if (ty === 'auto') {                                 // infer from a sample row when the expr reads base columns only
        ty = 'number';
        try {
          const ds = deps(expr).map((d) => String(d).toLowerCase());
          if (ds.every((d) => h.columns.some((c) => String(c).toLowerCase() === d))) {
            const fnB = compileValue(expr, blockSchema(h), { decimal: '.' });
            const sample = await sampleRow(L);
            if (sample) { const val = fnB(sample); ty = typeof val === 'number' && Number.isFinite(val) ? 'number' : 'string'; }
          }
        } catch { /* number by default */ }
      }
      const entry = { name, expr, ty };
      L.calcCols = L.calcCols || [];
      if (sel >= 0) L.calcCols[sel] = entry; else { L.calcCols.push(entry); sel = L.calcCols.length - 1; }
      invalidate();
      if (auto) { const it = rail.children[sel]; if (it) it.title = expr; }   // keep focus/drag alive — no rebuild
      else render();
      $('#meta').textContent = `ƒ ${name} ${cur ? 'updated' : 'added'} — it works in the filter, color ramps, GT/swath, the record panel, and exports`;
    }
    const ctr = document.createElement('div'); ctr.className = 'awin-ctrls'; ctr.style.cssText = 'border-top:none;background:none;padding:5px 0;';
    const saveB = document.createElement('button'); saveB.className = 'awin-btn btn-p'; saveB.textContent = cur ? 'save' : 'add column';
    saveB.onclick = () => doSave(false);
    ctr.appendChild(saveB);
    if (cur) {
      const rmB = document.createElement('button'); rmB.className = 'awin-btn'; rmB.textContent = 'remove';
      rmB.onclick = () => { const gone = L.calcCols[sel], at = sel; pushUndo(`remove ƒ ${gone.name}`, () => { L.calcCols.splice(Math.min(at, L.calcCols.length), 0, gone); L._calcFns = null; L._colStats = null; markProjectDirty(); refreshProps(); }, { redo: () => { const k = L.calcCols.indexOf(gone); if (k >= 0) { L.calcCols.splice(k, 1); L._calcFns = null; L._colStats = null; L._calcDisplay = null; markProjectDirty(); refreshProps(); } } });if (colorSelOf(L) === 'calc:' + cur.name) setLayerColorSel(L, 'elev'); L.calcCols.splice(sel, 1); L._calcDisplay = null; sel = -1; invalidate(); render(); };
      const matB = document.createElement('button'); matB.className = 'awin-btn'; matB.textContent = 'materialize → stored';
      matB.title = 'compute once, store as a real column (survives even if inputs are removed; faster to scan)';
      matB.onclick = () => materializeCalcCol(L, cur.name);
      ctr.append(rmB, matB);
    }
    const spacer = document.createElement('span'); spacer.className = 'spacer'; spacer.style.flex = '1';
    ctr.appendChild(spacer);
    if ((L.calcCols || []).length) {
      const rcp = document.createElement('button'); rcp.className = 'awin-btn rcp'; rcp.textContent = 'save as recipe…';
      rcp.title = 'save this calc-column set as a re-runnable recipe — apply the standard derived columns to any fresh model';
      rcp.onclick = () => saveRecipe('calccols', { layer: L.name, cols: L.calcCols.map((c) => ({ name: c.name, expr: c.expr, ty: c.ty })) }, `${(L.label || L.name).replace(/\.[^.]+$/, '')} columns`);
      ctr.appendChild(rcp);
    }
    main.append(nameRow, edwrap, err, proj, hint, ctr);
    requestAnimationFrame(() => { sync(); project(); });
  }
  render();
  _calcWins.set(L.id, { el: win.el, select });
}

// apply a calc-column SET to a layer — REPLACE on same name (idempotency is
// gospel: run-twice == run-once), append the new; invalid expressions are
// skipped and named. The recipe-facing form of Properties → columns.
export function applyCalcCols(L, cols) {
  const h = layerTableHeader(L); if (!h) return { applied: 0, bad: [] };
  L.calcCols = L.calcCols || [];
  let applied = 0; const bad = [];
  for (const c of cols || []) {
    if (!c || !c.name || !c.expr) continue;
    // schema recomputed PER entry — a recipe composes in listed order (DBL may reference the FE_EQ two lines up)
    try { compileValue(String(c.expr), schemaExt(L, h), { decimal: '.' }); } catch { bad.push(c.name); continue; }
    const entry = { name: String(c.name), expr: String(c.expr), ty: c.ty === 'string' ? 'string' : 'number' };
    const at = L.calcCols.findIndex((x) => x.name.toLowerCase() === entry.name.toLowerCase());
    if (at >= 0) L.calcCols[at] = entry; else L.calcCols.push(entry);
    applied++;
  }
  if (applied) {
    L._calcFns = null; L._colStats = null;
    const t2 = _attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
    markProjectDirty();
    if (L.id === S.activeId) addPaintColorOptions(L);       // new ƒ columns reach color-by now, not on the next layer switch
    if (L.filterExpr) refilterLayer(L);                     // a live ƒ filter picks up replaced definitions (any layer, not just the active one)
    if (calcSelOf(L)) { applyRamp(L, true); syncRuleMode(L); }   // a live ƒ color re-realizes (closure-hash gated)
    if (_propOpen && _propFor === L.id) renderProps();
  }
  return { applied, bad };
}

// does a layer already carry this column? (any kind — source, ƒ, painted, stored)
export function layerHasColumn(name, layerName) {
  const L = S.layers.find((x) => x.name === layerName || x.label === layerName);
  if (!L) return false;
  const h = layerTableHeader(L);
  const all = [
    ...((h && h.columns) || []),
    ...(L.calcCols || []).map((c) => c.name),
    ...(L.paintCols || []).map((c) => c.name),
    ...(L.dataCols || []).map((c) => c.name),
  ];
  return all.some((n) => String(n).toLowerCase() === String(name).toLowerCase());
}

// painted-column color channel: colorSel 'paint:<name>' → that column's codes
// ride the SAME rule texture + palette (rules fill codes by expression,
// painting fills them by gesture — one GPU path)
// ── color-by-ƒ: a calc column drives the display via an EPHEMERAL realization —
// a display CACHE, not data (never serialized, invisible to exports/records;
// materialize→stored stays the freeze path). Freshness = a hash of the
// DEFINITION CLOSURE (this expr + every transitively-referenced ƒ expr, via
// deps) + source identity + the paint version (a brush stroke can feed a calc).
// Stale → re-realize lazily (one scan) → bake codes → the same ratio-paint
// palette/codes path materialized columns ride. One realization per layer
// (the colored one); kept when you color away, replaced when you pick another.
export function calcSelOf(L) { const v = L && colorSelOf(L); return v && typeof v === 'string' && v.startsWith('calc:') ? v.slice(5) : null; }
function calcDisplayHash(L, name) {
  const by = new Map((L.calcCols || []).map((c) => [String(c.name).toLowerCase(), c]));
  const seen = new Set(); const parts = [];
  (function walk(nm) {
    const c = by.get(nm); if (!c || seen.has(nm)) return; seen.add(nm);
    parts.push(c.name + '=' + c.expr);
    let ds = []; try { ds = deps(c.expr); } catch { /* bad expr → no deps */ }
    for (const d of ds) walk(String(d).toLowerCase());
  })(String(name).toLowerCase());
  return parts.join('\n') + '|' + matColSourceHash(L) + '|' + (L._paintVer || 0);
}
export function calcDisplayCol(L) {
  const name = calcSelOf(L); if (!name) return null;
  const cd = L._calcDisplay;
  return cd && cd.name === name && cd.hash === calcDisplayHash(L, name) ? cd.col : null;
}
export async function ensureCalcDisplay(L) {
  const name = calcSelOf(L); if (!name || calcDisplayCol(L)) return;
  const cc = (L.calcCols || []).find((c) => c.name === name); if (!cc || cc.ty === 'string') return;
  const hash = calcDisplayHash(L, name);
  if (L._calcDisplayBusy === hash) return;                 // this exact state is already being realized
  L._calcDisplayBusy = hash;
  $('#meta').textContent = `ƒ ${name}: computing for display…`;
  let vals;
  try { vals = await realizeCalc(L, name); }
  catch (e) { L._calcDisplayBusy = null; $('#meta').textContent = `ƒ ${name}: ${e.message}`; return; }
  L._calcDisplayBusy = null;
  if (calcSelOf(L) !== name || hash !== calcDisplayHash(L, name)) { ensureCalcDisplay(L); return; }   // went stale mid-scan
  let mn = Infinity, mx = -Infinity, nn = 0;
  for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; nn++; } }
  if (!nn) { mn = 0; mx = 0; }
  const col = { name, kind: 'ratio', mat: true, selKey: 'calc:' + name, fvalues: vals, codes: matColCodes(vals, mn, mx), blankColor: PAINT_BLANK, min: mn, max: mx, count: vals.length, nonnull: nn };
  L._calcDisplay = { name, hash, col };
  applyRamp(L, true); syncRuleMode(L);
  $('#meta').textContent = `ƒ ${name}: colored — ${nn.toLocaleString()} values, ${fmtStat(mn)} … ${fmtStat(mx)}`;
}
// freeze a computed calc column into a stored materialized column (same name):
// evaluate its expression across every record → matColSet, drop the calc col. Bakes
// an expensive expression, or keeps a derived column without carrying its inputs.
// FAST PATH: when every BASE column in the target's dependency cone is PINNED
// (a prior complete filter scan teed it), realize via compileChunk over 256K
// typed windows — the tier-3 filter engine (~100× the row path, no file read).
// Materialized/paint inputs come from RAM inside censusChunkCols; ƒ inputs
// realize chunk-wise in dependency order. Any unpinned base dep → null (the
// row path takes over, and the next complete filter scan may pin it).
export function realizeCalcPinned(L, name) {
  const h = layerTableHeader(L); if (!h) return null;
  if (!(L.calcCols || []).some((c) => c.name === name)) return null;
  let ast; try { ast = parse(quoteIdent(name)); } catch { return null; }
  const needL = expandedDeps(L, ast); needL.add(String(name).toLowerCase());
  const baseLow = new Map(h.columns.map((c, i) => [String(c).toLowerCase(), c]));
  const pcsLow = new Set((L.paintCols || []).map((c) => String(c.name).toLowerCase()));
  const ccsLow = new Set((L.calcCols || []).map((c) => String(c.name).toLowerCase()));
  const baseNames = [];
  for (const k of needL) {
    if (ccsLow.has(k) || pcsLow.has(k)) continue;          // resolved from RAM by censusChunkCols
    const bn = baseLow.get(k); if (!bn) continue;          // unknown name → blank, same as everywhere
    if (!pinGet(L, bn)) return null;
    baseNames.push(bn);
  }
  const censusSchema = schemaExt(L, h);
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  let chunkFns;
  try {
    chunkFns = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase()))
      .map((it) => ({ slot: baseLen + paintLen + it.idx, fn: compileChunk(it.c.expr, censusSchema, { decimal: '.' }) }));
  } catch { return null; }
  const target = (L.calcCols || []).findIndex((c) => c.name === name);
  const total = attrRowCountOf(L) || 0; if (!total) return null;
  const vals = new Float32Array(total); const scr = {};
  for (let at = 0; at < total; at += (1 << 18)) {
    const n = Math.min(1 << 18, total - at);
    const byName = {};
    baseNames.forEach((bn, ci) => { byName[bn] = pinWindow(pinGet(L, bn), at, n, scr[ci] || (scr[ci] = [])); });
    const ccols = censusChunkCols(L, h, byName, at, n, needL, chunkFns);
    const col = ccols[baseLen + paintLen + target];
    if (!col) return null;
    for (let i = 0; i < n; i++) { const v = numOf(col[i]); vals[at + i] = Number.isFinite(v) ? v : NaN; }
  }
  return vals;
}
export async function realizeCalc(L, name) {                      // one pass → per-record Float32 values of ƒ `name`
  const h = layerTableHeader(L); if (!h) throw new Error('no column table');
  const fast = realizeCalcPinned(L, name);
  if (fast) return fast;
  try { await ensureStoredValues(L, expandedDeps(L, parse(quoteIdent(name)))); } catch { /* unknown deps → blanks */ }
  const fn = compileValue(quoteIdent(name), schemaExt(L, h), { decimal: '.' });   // a NAME as an expression → quote
  const n = attrRowCountOf(L) || 0; const vals = new Float32Array(n); let rec = 0;
  // numbered as the renderer numbers (layerRecords): a CSV row with no usable
  // coordinates is no record, so counting it shifted every later value one block on
  for await (const { f } of layerRecords(L, null)) {
    if (rec >= n) break;
    let v; try { v = numOf(fn(f)); } catch { v = NaN; }
    vals[rec] = Number.isFinite(v) ? v : NaN; rec++;
    if ((rec & 0xFFFF) === 0) await new Promise((r) => setTimeout(r));
  }
  for (let i = rec; i < n; i++) vals[i] = NaN;              // past the last record: blank, never 0
  return vals;
}
export async function materializeCalcCol(L, name) {
  const cc = (L.calcCols || []).find((c) => c.name === name); if (!cc) { $('#meta').textContent = `materialize: no calc column “${name}”`; return; }
  if (!layerTableHeader(L)) return;
  $('#meta').textContent = `materializing “${name}”…`;
  const vals = await realizeCalc(L, name);
  const rec = vals.length;
  const wasColor = colorSelOf(L) === 'calc:' + name;
  L.calcCols = (L.calcCols || []).filter((c) => c.name !== name); L._calcFns = null;   // computed → stored (no schema collision)
  L._calcDisplay = null;                                    // the ephemeral realization is superseded by the stored column
  matColSet(L, name, vals, { lineage: mkLineage('materialize', { from: 'calc', expr: cc.expr }, [L.lineage].filter(Boolean)) });
  if (wasColor) setLayerColorSel(L, 'paint:' + name);
  try { await persistElement(L); } catch { /* best-effort */ }
  markProjectDirty(); renderLayers(); requestRender();
  $('#meta').textContent = `materialized “${name}” — ${rec.toLocaleString()} values stored`;
}
