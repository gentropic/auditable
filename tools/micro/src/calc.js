// micro — the calculated-column window: write an expression, see it checked against
// the layer's columns, and add it as a column the filter and the colouring can use.
import { blockSchema, layerTableHeader, sampleRow, schemaExt } from './records.js';
import { floatWin, raiseWindow } from './windows.js';
import { markProjectDirty } from './project.js';
import { S } from './state.js';
import { addPaintColorOptions, applyRamp, calcSelOf, colorSelOf, materializeCalcCol, refreshProps, renderProps, syncRuleMode } from './props.js';
import { compileValue, deps, parse, quoteIdent, validate } from '../../../ext/expr/index.js';
import { columnValues, exprField, syncHL } from './exprfield.js';
import { fdBounds, fdNum, fdRenderChain, fdRenderLeaf, fdValues } from './filter-drawer.js';
import { numericColsOf } from './analysis.js';
import { pushUndo } from './undo.js';
import { saveRecipe } from './recipes.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setCalcHooks): refilterLayer, setLayerColorSel
let H = {};
export function setCalcHooks(h) { H = h; }

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
    if (L.filterExpr) H.refilterLayer(L);                     // a live filter picks up the new definition (any layer)
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
      rmB.onclick = () => { const gone = L.calcCols[sel], at = sel; pushUndo(`remove ƒ ${gone.name}`, () => { L.calcCols.splice(Math.min(at, L.calcCols.length), 0, gone); L._calcFns = null; L._colStats = null; markProjectDirty(); refreshProps(); }, { redo: () => { const k = L.calcCols.indexOf(gone); if (k >= 0) { L.calcCols.splice(k, 1); L._calcFns = null; L._colStats = null; L._calcDisplay = null; markProjectDirty(); refreshProps(); } } });if (colorSelOf(L) === 'calc:' + cur.name) H.setLayerColorSel(L, 'elev'); L.calcCols.splice(sel, 1); L._calcDisplay = null; sel = -1; invalidate(); render(); };
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
