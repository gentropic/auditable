// micro gt — the grade-tonnage window: tonnage and mean grade above every cutoff,
// exact at any model size (the gt kernel's sparse decimal histogram, @gcu/scan),
// per series (a grade, a density or weight, a filter, units), over all / the filter /
// the selection, columnar on workers where the model allows. Carved from
// index.html (phase 3).
import { gridAxesOf } from './grid-ops.js';
import { floatWin, focusWindow } from './windows.js';
import { numericColsOf, volumeAt, volumeContextOf } from './analysis.js';
import { SERIES_COLORS, analysisSerCfg, analysisSerRestore, applyAnalysisGeo, checkAbort, gradeUnitFactor, gradeUnitSel, plotChart, plotExportBtns, rangesForCfg, rangesFromCfg, rangesOf, rangesRow, reconcilePairs, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, seriesZoneKeep, setAnalysisOpen } from './analysis-ui.js';
import { gtAbove, gtAccumulator, gtCuts, gtMerge } from './scanner.js';
import { S, layerById } from './state.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileValue, quoteIdent, validate } from '../../../ext/expr/index.js';
import { canScanColumnar, scanColumnar } from './colscan.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setGtHooks): markProjectDirty, saveRecipe
let H = {};
export function setGtHooks(h) { H = h; }

// (numericColsOf / blockVolumeOf / volumeContextOf / volumeAt / computeGT live in src/analysis.js)
export const _gtWins = new Map();

// ── grade-tonnage window on the SWATH CHASSIS (left config rail · per-series
// rows · set-then-Run) for coherence across the analysis tools. Each series =
// layer + grade column + declared unit + a free density EXPRESSION (@gcu/expr;
// blank = count/volume) + an optional row filter. One streamed scan per Run
// caches each series' grade-descending cumulative curve (Σw / Σwg), so cutoff
// count, plot unit, and manual ranges are LIVE afterwards — no re-scan. ──
export function openGradeTonnage(L, ropts) {
  if (!L || !gridAxesOf(L)) { $('#meta').textContent = 'grade-tonnage: needs a regular block model'; return; }
  const ex = _gtWins.get(L.id); if (ex) { if (!ropts) { focusWindow(ex.win.el); return; } ex.win.close(); }   // a recipe replaces the open window
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'grade-tonnage: no numeric column'; return; }
  const pairs = reconcilePairs(nums);
  // unit DECLARATIONS (what the data is, not display toggles) — persisted per
  // layer in the project manifest (L.gtUnits). Old weight declarations (a column
  // name or '#const' + densConst) migrate to the expression form.
  const gu0 = L.gtUnits || {};
  const w0 = gu0.weight === '#const' ? (gu0.densConst != null ? String(gu0.densConst) : '') : (gu0.weight || '');
  const mkSer = (Lx, col, i) => ({ layerId: Lx.id, col, unit: (Lx.gtUnits && Lx.gtUnits.grade) || '', weight: w0, filter: '', color: SERIES_COLORS[i % SERIES_COLORS.length] });
  const st = { nCut: 40, scope: 'all', gradeUnit: gu0.grade || '', densUnit: gu0.densUnit || 't/m3',
    series: pairs.length ? [mkSer(L, pairs[0].ref, 0), mkSer(L, pairs[0].self, 1)] : [mkSer(L, nums[0], 0)],
    scan: null, stale: true, running: false };
  // a recipe (explicitly picked) beats the saved setup beats the defaults;
  // Run stays manual on project open (no surprise scans) — a recipe's pick IS consent
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.gt);
  if (saved) {
    if (saved.nCut) st.nCut = saved.nCut;
    if (saved.scope) st.scope = saved.scope;
    if (saved.gradeUnit != null) st.gradeUnit = saved.gradeUnit;
    if (saved.densUnit) st.densUnit = saved.densUnit;
    if (saved.ranges) st.ranges = rangesFromCfg(saved.ranges);
    const ser = analysisSerRestore(saved.series, L); if (ser) st.series = ser;
  }
  const cfgOf = () => ({ series: analysisSerCfg(st.series), nCut: st.nCut, scope: st.scope, gradeUnit: st.gradeUnit, densUnit: st.densUnit, ranges: rangesForCfg(st.ranges) });
  const persistUnits = () => { L.gtUnits = { ...(L.gtUnits || {}), grade: st.gradeUnit, densUnit: st.densUnit, weight: st.series[0] ? st.series[0].weight : '' }; H.markProjectDirty(); };
  const guLabel = () => (st.gradeUnit === 'pct' ? '%' : st.gradeUnit);
  const win = floatWin({ title: `grade-tonnage · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 680), y: 100, w: 640, h: 464,
    onClose: () => { saveAnalysisCfg(L, 'gt', cfgOf(), win); setAnalysisOpen(L, 'gt', false); _gtWins.delete(L.id); } });
  setAnalysisOpen(L, 'gt', true);
  applyAnalysisGeo(L, 'gt', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:80px;display:block';
  main.append(cv); body.append(rail, main);
  // derive every curve from the cached cumulative arrays — cutoffs / ranges /
  // units are display-time (a binary search per cut), Run owns the streaming
  const plot = () => {
    if (!st.scan || !st.scan.series.length) {
      const busy = /scanning/i.test(win.sub.textContent || '');
      win.sub.textContent = busy ? win.sub.textContent : (st.stale ? (saved ? 'restored — Run to compute' : 'configure, then Run') : 'no data');
      plotChart(cv, { series: [], placeholder: busy ? 'scanning…' : (st.stale ? 'press Run' : 'no data') });
      win._spec = null; win.el._gtSpec = null; return;
    }
    const weighted = st.scan.series.some((se) => se.weighted);
    const cuts = gtCuts(st.scan.series, st.nCut, (se) => gradeUnitFactor(se.s.unit, st.gradeUnit));
    if (!cuts) { win.sub.textContent = 'no data'; plotChart(cv, { series: [] }); win._spec = null; win.el._gtSpec = null; return; }
    const gl = guLabel();
    const spec = { xLabel: `cutoff${gl ? ` (${gl})` : ''}`, leftLabel: weighted ? 'tonnage (t)' : 'volume (m³)', rightLabel: `mean grade${gl ? ` (${gl})` : ''}`, series: [], ...rangesOf(st) };
    const multi = st.scan.series.length > 1 && new Set(st.scan.series.map((se) => se.s.layerId)).size > 1;
    for (const se of st.scan.series) {
      const f = gradeUnitFactor(se.s.unit, st.gradeUnit), Lx = layerById(se.s.layerId);
      const nm = multi ? `${(Lx ? (Lx.label || Lx.name) : '').replace(/\.[^.]*$/, '')}·${se.s.col}` : se.s.col;
      const tPts = [], gPts = [];
      for (const c of cuts) {
        const [t, tg] = gtAbove(se, c / f);                // axis units → this series' native grade
        tPts.push([c, t]); gPts.push([c, t > 0 ? (tg / t) * f : NaN]);
      }
      spec.series.push({ name: `${nm} · t`, color: se.s.color, axis: 'left', kind: 'line', data: tPts });
      spec.series.push({ name: `${nm} · grade`, color: se.s.color, axis: 'right', kind: 'line', data: gPts });
    }
    win.sub.textContent = `${st.scope !== 'all' ? st.scope + ' · ' : ''}${weighted ? 'tonnes' : 'count'} · ${st.nCut} cutoffs · ${st.scan.series.reduce((s2, x) => s2 + x.n, 0).toLocaleString()} rows`;
    plotChart(cv, spec); win._spec = spec; win.el._gtSpec = spec;
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };
  // one streamed pass per series: compile grade / weight / filter, collect
  // (g, w), sort grade-descending → cumulative Σw / Σwg (then drop the raw pairs)
  const scanGT = async (onProgress, signal) => {
    const dScale = unitConvert(1, st.densUnit, 't/m3');
    const series = st.series.map((s) => {
      const Lx = layerById(s.layerId); if (!Lx) return null;
      const h = layerTableHeader(Lx); if (!h) return null;
      const schema = schemaExt(Lx, h);
      // a valid but UNKNOWN column name compiles to a BLANK closure (() => null),
      // and +null === 0 is finite — so a renamed/removed column silently produced
      // a flat grade-0 curve at full tonnage. Refuse a bare missing name loudly;
      // a real expression stays free-form.
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(s.col).trim())) {
        const _v = validate(String(s.col).trim(), schema);
        if (!_v.ok) throw new Error(`series column "${s.col}": ${(_v.errors[0] && _v.errors[0].message) || 'unknown column'} — pick another, or reopen the layer that has it`);
      }
      let gradeFn; try { gradeFn = compileValue(quoteIdent(s.col), schema, { decimal: '.' }); } catch { return null; }   // a NAME as an expression → quote (spaces/hyphens)
      let weightFn = null, filterFn = null;
      if (s.weight && s.weight.trim()) { try { weightFn = compileValue(s.weight, schema, { decimal: '.' }); } catch { throw new Error(`series weight "${s.weight}": invalid`); } }
      if (s.filter && s.filter.trim()) { try { filterFn = compileBool(s.filter, schema, { decimal: '.' }); } catch { throw new Error(`series filter "${s.filter}": invalid`); } }
      return Object.assign(gtAccumulator(), { s, L: Lx, vc: volumeContextOf(Lx), gradeFn, weightFn, filterFn, weighted: !!weightFn });
    }).filter(Boolean);
    // a Parquet layer's series are scanned COLUMNAR and in parallel (src/colscan.js):
    // one pass per layer for all of its series, only the columns they need, a row
    // group per worker. Everything else keeps the row path below.
    const colL = [...new Set(series.filter((se) => canScanColumnar(se.L)).map((se) => se.L))];
    let total = 0, where = '';
    const N = colL.reduce((t, Lx) => t + (attrRowCountOf(Lx) || 0), 0) + series.filter((se) => !colL.includes(se.L)).reduce((t, se) => t + (attrRowCountOf(se.L) || 0), 0);
    for (const Lx of colL) {
      const ses = series.filter((se) => se.L === Lx), vc = ses[0].vc, h = layerTableHeader(Lx);
      const dims = vc.dc ? [h.columns[vc.dc.x], h.columns[vc.dc.y], h.columns[vc.dc.z]] : null;
      const params = { series: ses.map((se) => ({ grade: quoteIdent(se.s.col), weight: (se.s.weight || '').trim() || null, filter: (se.s.filter || '').trim() || null })), dScale, vol: { base: vc.base, dims } };
      const base = total;
      const { parts } = await scanColumnar(Lx, { kernel: 'gt', params, exprs: params.series.flatMap((x) => [x.grade, x.weight, x.filter]), extraCols: dims || [], mask: scopeMask(st, Lx), signal,
        keepZone: seriesZoneKeep(Lx, params.series.map((x) => x.filter), scopeMask(st, Lx)),
        onProgress: (d, n, w) => { total = base + d; where = w; if (onProgress) onProgress(total, N, w); } });
      ses.forEach((se, k) => {
        const acc = gtMerge(parts.map((p2) => p2 && p2[k]));
        Object.assign(se, { e: acc.e, keys: acc.keys, cw: acc.cw, cwg: acc.cwg, n: acc.n, gmin: acc.gmin, gmax: acc.gmax, bins: null, pend: null });
      });
    }
    for (const se of series) {
      if (colL.includes(se.L)) continue;
      const Lx = se.L, mask = scopeMask(st, Lx);
      // layerRecords owns the record number — the raw rec++ this replaces was the
      // mis-numbering bug (a delimited source's bad-coordinate rows were counted
      // though the renderer never numbered them, shifting every later record's
      // selection membership and derived-column reads). The fix landed first in
      // computeGT, which turned out to be DEAD CODE — this closure is what the
      // GT window actually runs.
      for await (const { f: row, rec: rr } of layerRecords(Lx)) {
        {
          total++; if ((total & 0xffff) === 0) { checkAbort(signal); if (onProgress) onProgress(total, N, 'on this page'); await new Promise((r) => setTimeout(r)); }
          if (mask && !(rr < mask.length && mask[rr])) continue;
          if (se.filterFn && !se.filterFn(row)) continue;
          const g = numOf(se.gradeFn(row)); if (!Number.isFinite(g)) continue;   // a blank grade is unestimated, not 0
          const w = (se.weightFn ? (+se.weightFn(row) || 0) * dScale : 1) * volumeAt(se.vc, row);
          if (!(w > 0)) continue;
          se.add(g, w);
        }
      }
      if (onProgress) onProgress(total, N, 'on this page');
      se.finish();
      where = where || 'on this page';
    }
    return { series, where };
  };
  const run = async () => {
    if (st.running) return;
    if (st.scope !== 'all' && !st.series.some((s) => { const Lx = layerById(s.layerId); return Lx && scopeMask(st, Lx); })) {
      win.sub.textContent = scopeMissing(st, L) || `no layer carries a ${st.scope} mask`; return;
    }
    st.running = true; win.sub.textContent = 'scanning…';
    const rc = runCancellable(runBtn);
    try { st.scan = await scanGT((n, N, w) => { progEl.textContent = scanProgressText(n, N, w); }, rc.signal); }
    catch (e) { win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `grade-tonnage: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    win.el._scanWhere = st.scan.where;                     // where the scan ran (workers / this page) — the smokes read it
    saveAnalysisCfg(L, 'gt', cfgOf(), win);                // a successful Run snapshots the setup into the project
    plot();
  };
  // copy the computed numbers: cutoff | per-series tonnes/grade/metal (TSV)
  const tableTSV = () => {
    if (!st.scan || !st.scan.series.length) return null;
    const weighted = st.scan.series.some((se) => se.weighted);
    const cuts = gtCuts(st.scan.series, st.nCut, (se) => gradeUnitFactor(se.s.unit, st.gradeUnit));
    if (!cuts) return null;
    const gl = guLabel(), mScale = st.gradeUnit ? unitConvert(1, st.gradeUnit, 'fraction') : 1, tU = weighted ? 't' : 'm³';
    const multi = st.scan.series.length > 1;
    const names = st.scan.series.map((se) => { const Lx = layerById(se.s.layerId); return multi ? `${(Lx ? (Lx.label || Lx.name) : '').replace(/\.[^.]*$/, '')}·${se.s.col}` : se.s.col; });
    const head = [`cutoff${gl ? ` (${gl})` : ''}`];
    names.forEach((nm) => head.push(`${nm} ${tU} ≥`, `${nm} grade${gl ? ` (${gl})` : ''}`, st.gradeUnit ? `${nm} metal (t)` : `${nm} grade·${tU}`));
    const lines = [head.join('\t')];
    for (const c of cuts) {
      const row = [c];
      for (const se of st.scan.series) {
        const f = gradeUnitFactor(se.s.unit, st.gradeUnit);
        const [t, tg] = gtAbove(se, c / f), g = t > 0 ? (tg / t) * f : NaN;
        row.push(t, Number.isFinite(g) ? g : '', Number.isFinite(g) ? t * g * mScale : '');
      }
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  };
  const seriesRow = (s, i) => {
    const box = document.createElement('div'); box.className = 'sw-ser';
    const top = document.createElement('div'); top.className = 'sw-ser-top';
    const dot = document.createElement('span'); dot.className = 'sw-dot'; dot.style.background = s.color; dot.title = 'cycle colour';
    dot.onclick = () => { s.color = SERIES_COLORS[(SERIES_COLORS.indexOf(s.color) + 1) % SERIES_COLORS.length]; dot.style.background = s.color; if (st.scan) plot(); };
    const laySel = document.createElement('select'); laySel.className = 'sw-sel';
    for (const Lx of S.layers.filter((x) => numericColsOf(x).length && (x.docs.blockDoc || x.docs.dhDoc))) { const o = document.createElement('option'); o.value = Lx.id; o.textContent = Lx.label || Lx.name; if (Lx.id === s.layerId) o.selected = true; laySel.append(o); }
    laySel.onchange = () => { s.layerId = +laySel.value; const cols = numericColsOf(layerById(s.layerId)); if (!cols.includes(s.col)) s.col = cols[0] || s.col; markStale(); buildRail(); };
    const x = document.createElement('button'); x.className = 'sw-x'; x.textContent = '×'; x.title = 'remove series'; x.onclick = () => { if (st.series.length > 1) { st.series.splice(i, 1); markStale(); buildRail(); } };
    top.append(dot, laySel, x); box.append(top);
    const mid = document.createElement('div'); mid.className = 'sw-ser-top';
    const colSel = document.createElement('select'); colSel.className = 'sw-sel';
    for (const c of numericColsOf(layerById(s.layerId) || L)) { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === s.col) o.selected = true; colSel.append(o); }
    colSel.onchange = () => { s.col = colSel.value; markStale(); };
    mid.append(colSel, gradeUnitSel(s.unit, (v) => { s.unit = v; if (st.scan) plot(); }, 'declared unit of THIS series — converts into the plot unit when both are declared'));
    box.append(mid);
    const wIn = document.createElement('input'); wIn.className = 'sw-in'; wIn.type = 'text'; wIn.placeholder = 'density expr (blank = count)'; wIn.value = s.weight; wIn.title = 'density expression (@gcu/expr) — tonnage = density × block volume. e.g. SG, 2.7, SG*PARTIAL. blank = count/volume'; wIn.onchange = () => { s.weight = wIn.value.trim(); persistUnits(); markStale(); }; box.append(wIn);
    const fIn = document.createElement('input'); fIn.className = 'sw-in'; fIn.type = 'text'; fIn.placeholder = 'filter (optional)'; fIn.value = s.filter; fIn.title = 'row filter for THIS series (@gcu/expr) — e.g. ROCK == 2'; fIn.onchange = () => { s.filter = fIn.value.trim(); markStale(); }; box.append(fIn);
    return box;
  };
  function buildRail() {
    rail.textContent = '';
    // ── Series ──
    const sSec = document.createElement('div');
    sSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'series' }));
    const list = document.createElement('div'); list.className = 'sw-series';
    st.series.forEach((s, i) => list.append(seriesRow(s, i))); sSec.append(list);
    const add = document.createElement('button'); add.className = 'sw-add'; add.textContent = '+ add series';
    add.onclick = () => { const c = numericColsOf(L)[0]; st.series.push(mkSer(L, c, st.series.length)); markStale(); buildRail(); }; sSec.append(add);
    rail.append(sSec);
    // ── Display (all live from the cached scan — no re-scan) ──
    const vSec = document.createElement('div');
    vSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'display' }));
    const cutRow = document.createElement('div'); cutRow.className = 'sw-row'; const cutL = document.createElement('span'); cutL.textContent = 'cutoffs'; cutL.style.width = '44px';
    const cutI = document.createElement('input'); cutI.type = 'number'; cutI.min = '5'; cutI.max = '200'; cutI.className = 'sw-in'; cutI.value = String(st.nCut); cutI.title = 'number of cutoff steps between the data min and max';
    cutI.onchange = () => { st.nCut = Math.max(5, Math.min(200, Math.round(+cutI.value) || 40)); if (st.scan) plot(); }; cutRow.append(cutL, cutI); vSec.append(cutRow);
    const guRow = document.createElement('div'); guRow.className = 'sw-row'; const guL = document.createElement('span'); guL.textContent = 'unit'; guL.style.width = '44px';
    const guS = gradeUnitSel(st.gradeUnit, (v) => { st.gradeUnit = v; persistUnits(); if (st.scan) plot(); }, 'plot unit — the cutoff + mean-grade axes; series with a declared unit convert into it');
    guS.classList.add('sw-unit-plot'); guRow.append(guL, guS); vSec.append(guRow);
    const duRow = document.createElement('div'); duRow.className = 'sw-row'; const duL = document.createElement('span'); duL.textContent = 'ρ unit'; duL.style.width = '44px';
    const duS = document.createElement('select'); duS.className = 'sw-sel'; duS.title = 'declared unit of the density expressions — converted to t/m³ so tonnage is in tonnes';
    for (const [v, t] of [['t/m3', 't/m³ (=g/cm³)'], ['kg/m3', 'kg/m³'], ['lb/ft3', 'lb/ft³']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; duS.append(o); }
    duS.value = st.densUnit; duS.onchange = () => { st.densUnit = duS.value; persistUnits(); markStale(); };
    duRow.append(duL, duS); vSec.append(duRow);
    const scRow = document.createElement('div'); scRow.className = 'sw-row'; const scL = document.createElement('span'); scL.textContent = 'scope'; scL.style.width = '44px';
    const seg = document.createElement('div'); seg.className = 'sw-seg'; seg.title = 'all rows · rows matching each layer\'s current filter · the 3D selection (re-runs as it changes)';
    for (const [v, t] of [['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']]) { const bt = document.createElement('button'); bt.className = 'sw-segbtn' + (st.scope === v ? ' on' : ''); bt.textContent = t; bt.onclick = () => { st.scope = v; buildRail(); run(); }; seg.append(bt); } scRow.append(scL, seg); vSec.append(scRow);
    vSec.append(rangesRow(st, () => { if (st.scan) plot(); }, { x: 'cutoff', l: 't', r: 'grade' }));
    rail.append(vSec);
    // ── Footer: Run + save-as-recipe + stale + progress ──
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => H.saveRecipe('gt', cfgOf(), `${(L.label || L.name).replace(/\.[^.]+$/, '')} grade-tonnage`);
    const resRow = plotExportBtns(cv, () => `gt-${(L.label || L.name).replace(/\.[^.]+$/, '')}.png`, tableTSV, 'grade-tonnage');
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, staleEl, progEl); rail.append(foot);
  }
  _gtWins.set(L.id, { win, redraw: run, st });
  buildRail(); plot();
  if (ropts && ropts.run) run();
}
