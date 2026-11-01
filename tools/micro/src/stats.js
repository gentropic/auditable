// micro stats — the statistics window: n, mean, std, min / quartiles / max of any
// columns, weighted or not, grouped by a category or paint column, over all / the
// filter / the selection — from the pin cache when the columns are resident,
// columnar on workers otherwise. Carved from index.html (phase 3).
import { attrRowCountOf, calcOrder, layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileChunk, compileValue, parse, quoteIdent } from '../../../ext/expr/index.js';
import { censusChunkCols, ensureStoredValues, expandedDeps, pinGet, pinWindow } from './columns.js';
import { quantileFromCentroids, tdigest } from '../../../ext/sluice/index.js';
import { momentAdd, momentStd, statsMerge } from './scanner.js';
import { applyAnalysisGeo, checkAbort, fmtStat, plotExportBtns, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, setAnalysisOpen } from './analysis-ui.js';
import { floatWin, nextZ } from './windows.js';
import { numericColsOf } from './analysis.js';
import { canScanColumnar, scanColumnar, zoneKeeper } from './colscan.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setStatsHooks): menuXY, saveRecipe
let H = {};
export function setStatsHooks(h) { H = h; }

// ── STATS: the grouped summary table on the analysis chassis — columns × an
// optional GROUP BY (the category channel or any painted column — assign
// domains, then stats-by-domain is the resource table) × an optional weight
// EXPRESSION (density-weighted means; quantiles stay unweighted and say so).
// One streamed pass per Run (cooperative — the UI stays live); scope + recipe
// + persistence identical to GT/swath. ──
export const _statsWins = new Map();

export function statsGroupCols(L) {
  const h = layerTableHeader(L); if (!h) return [];
  const out = [];
  if (h.categories && h.mapping && h.mapping.cat != null && h.columns[h.mapping.cat]) out.push(h.columns[h.mapping.cat]);
  for (const c of (L.paintCols || [])) if (c.kind !== 'ratio') out.push(c.name);
  return out;
}

export const TD_BATCH = 8192;

export function tdAdd(TD, a, x) {
  if (!a.tb) { a.tb = new Float64Array(TD_BATCH); a.tn = 0; }
  a.tb[a.tn++] = x;
  if (a.tn === TD_BATCH) { TD.pushArray(a.td, a.tb, 0, TD_BATCH); a.tn = 0; }
}

export function tdDone(TD, a) { if (a.tn) { TD.pushArray(a.td, a.tb, 0, a.tn); a.tn = 0; } return TD.result(a.td); }

// stats over PINNED columns: when every base column in the request's dependency
// cone is pinned (a prior complete filter scan teed it), accumulate over 256K
// typed windows via censusChunkCols — the tier-3 engine — instead of decoding
// every row. st.cols and st.groupBy are bare NAMES (the window's selects), so
// they read straight off their census slots; only the free-text weight
// expression compiles chunk-wise. Identical accumulators and row order →
// identical results; anything unpinned → null (the row path takes over).
export async function scanStatsPinned(L, st, mask, onProgress, signal) {
  const h = layerTableHeader(L); if (!h) return null;
  const censusSchema = schemaExt(L, h);
  const slotOf = (nm) => censusSchema.findIndex((c) => c.name === nm);
  const colSlots = st.cols.map(slotOf); if (colSlots.some((i) => i < 0)) return null;
  const gbSlot = st.groupBy ? slotOf(st.groupBy) : -1; if (st.groupBy && gbSlot < 0) return null;
  // the dependency cone: requested columns + groupBy + the weight expression
  const needL = new Set([...st.cols, ...(st.groupBy ? [st.groupBy] : [])].map((c) => String(c).toLowerCase()));
  let weightAst = null;
  if (st.weight && st.weight.trim()) { try { weightAst = parse(st.weight); } catch { return null; } for (const d of expandedDeps(L, weightAst)) needL.add(d); }
  for (const c of [...st.cols, ...(st.groupBy ? [st.groupBy] : [])]) { let a; try { a = parse(quoteIdent(c)); } catch { return null; } for (const d of expandedDeps(L, a)) needL.add(d); }
  // base deps must be PINNED; paint/calc resolve from RAM inside censusChunkCols
  const baseLow = new Map(h.columns.map((c) => [String(c).toLowerCase(), c]));
  const pcsLow = new Set((L.paintCols || []).map((c) => String(c.name).toLowerCase()));
  const ccsLow = new Set((L.calcCols || []).map((c) => String(c.name).toLowerCase()));
  const baseNames = [];
  for (const k of needL) {
    if (ccsLow.has(k) || pcsLow.has(k)) continue;
    const bn = baseLow.get(k); if (!bn) continue;          // unknown name → blank, same as everywhere
    if (!pinGet(L, bn)) return null;
    baseNames.push(bn);
  }
  const baseLen = h.columns.length, paintLen = (L.paintCols || []).length;
  let calcChunkFns = null, weightChunk = null;
  try {
    calcChunkFns = calcOrder(L).filter((it) => needL.has(String(it.c.name).toLowerCase()))
      .map((it) => ({ slot: baseLen + paintLen + it.idx, fn: compileChunk(it.c.expr, censusSchema, { decimal: '.' }) }));
    if (weightAst) weightChunk = compileChunk(st.weight, censusSchema, { decimal: '.' });
  } catch { return null; }
  const total = attrRowCountOf(L) || 0; if (!total) return null;
  const TD = tdigest();
  const mkAcc = () => st.cols.map(() => ({ n: 0, sw: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, td: TD.create() }));
  const groups = new Map();
  let overflow = false;
  const scr = {};
  for (let at = 0; at < total; at += (1 << 18)) {
    const n = Math.min(1 << 18, total - at);
    const byName = {};
    baseNames.forEach((bn, ci) => { byName[bn] = pinWindow(pinGet(L, bn), at, n, scr[ci] || (scr[ci] = [])); });
    const ccols = censusChunkCols(L, h, byName, at, n, needL, calcChunkFns);
    const colArrs = colSlots.map((sIdx) => ccols[sIdx]);
    if (colArrs.some((a) => !a)) return null;              // an evicted matcol mid-scan → the row path re-faults it
    const gArr = gbSlot >= 0 ? ccols[gbSlot] : null;
    if (gbSlot >= 0 && !gArr) return null;
    const wArr = weightChunk ? weightChunk(ccols, n).buf : null;
    for (let i = 0; i < n; i++) {
      const r = at + i;
      if (mask && !(r < mask.length && mask[r])) continue;
      let g = '';
      if (gArr) { const gv = gArr[i]; g = gv == null || gv === '' ? '—' : String(gv); }
      let A = groups.get(g);
      if (!A) { if (groups.size >= 256) { overflow = true; continue; } A = mkAcc(); groups.set(g, A); }
      const w = wArr ? (+wArr[i] || 0) : 1;
      if (!(w > 0)) continue;
      for (let s = 0; s < colArrs.length; s++) {
        const x = numOf(colArrs[s][i]);
        if (!Number.isFinite(x)) continue;
        const a = A[s];
        a.n++; momentAdd(a, x, w);
        if (x < a.min) a.min = x; if (x > a.max) a.max = x;
        tdAdd(TD, a, x);
      }
    }
    if (onProgress) onProgress(at + n, total, 'pinned, on this page');
    checkAbort(signal);
    await new Promise((z) => setTimeout(z));               // one window per task: the UI stays live
  }
  const rows = [];
  for (const g of [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const A = groups.get(g);
    for (let s = 0; s < st.cols.length; s++) {
      const a = A[s]; if (!a.n) continue;
      const td = tdDone(TD, a), q = (p) => quantileFromCentroids(td.centroids, td.count, p);
      rows.push({ group: g, col: st.cols[s], n: a.n, mean: a.mean, std: momentStd(a), min: a.min, max: a.max, q25: q(0.25), q50: q(0.5), q75: q(0.75), centroids: td.centroids, count: td.count });
    }
  }
  window.__statsFast = (window.__statsFast || 0) + 1;      // test observability (smoke2 §37 asserts non-vacuity)
  return { rows, groupBy: st.groupBy, weighted: !!weightChunk, overflow };
}

// one stats pass over a layer — q = { cols, groupBy, weight, filter }, mask = a
// record mask or null → { rows: [{ group, col, n, mean, std, min, max, q25, q50,
// q75, centroids, count }], groupBy, weighted, overflow, where }. The stats window
// runs it; so does Q-Q (any quantile from a row's digest). Pinned columns first
// (no filter), columnar on workers where the layer can, the page otherwise.
export async function statsScan(L, q, mask, onProgress, signal) {
  const h = layerTableHeader(L), schema = schemaExt(L, h);
  const colFns = q.cols.map((c) => { try { return { c, fn: compileValue(quoteIdent(c), schema, { decimal: '.' }) }; } catch { return null; } }).filter(Boolean);   // NAMES as expressions → quote
  if (!colFns.length) throw new Error('no valid columns');
  let groupFn = null, weightFn = null, filterFn = null;
  const filterX = (q.filter || '').trim() || null;
  if (filterX) { try { filterFn = compileBool(filterX, schema, { decimal: '.' }); } catch { throw new Error(`filter "${filterX}": invalid`); } }
  if (q.groupBy) { try { groupFn = compileValue(q.groupBy, schema, { decimal: '.' }); } catch { throw new Error(`group by "${q.groupBy}": invalid`); } }
  if (q.weight && q.weight.trim()) { try { weightFn = compileValue(q.weight, schema, { decimal: '.' }); } catch { throw new Error(`weight "${q.weight}": invalid`); } }
  // materialized inputs must be resident for BOTH paths (evicted → blanks otherwise)
  await ensureStoredValues(L, new Set([...q.cols, q.groupBy, q.weight].filter(Boolean).map((x) => String(x).toLowerCase())));
  if (filterX) { let ast = null; try { ast = parse(filterX); } catch { /* compiled above */ } if (ast) await ensureStoredValues(L, new Set(expandedDeps(L, ast))); }
  // a delimited model's resident columns beat re-parsing its text on the pool
  const bdS = L.docs.blockDoc, delimS = !!bdS && !bdS.parquet && !bdS.header.dm;
  const pinnedFirst = delimS && !filterX && canScanColumnar(L) ? await scanStatsPinned(L, q, mask, onProgress, signal) : null;
  if (pinnedFirst) return pinnedFirst;
  if (canScanColumnar(L)) {                              // Parquet / .dm / an indexed CSV: columnar + parallel (src/colscan.js)
    const params = { cols: colFns.map((c) => quoteIdent(c.c)), groupBy: q.groupBy || null, weight: (q.weight || '').trim() || null, filter: filterX };
    const { parts, where } = await scanColumnar(L, { kernel: 'stats', params, exprs: [...params.cols, params.groupBy, params.weight, params.filter], mask, signal, onProgress, keepZone: zoneKeeper(L, { mask }) });
    const merged = statsMerge({ tdigest }, parts), TDm = tdigest(), rows = [];
    for (const g of [...merged.groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const A = merged.groups.get(g);
      for (let i = 0; i < colFns.length; i++) {
        const a = A[i]; if (!a.n) continue;
        const td = TDm.result(a.td), qf = (p2) => quantileFromCentroids(td.centroids, td.count, p2);
        rows.push({ group: g, col: colFns[i].c, n: a.n, mean: a.mean, std: momentStd(a), min: a.min, max: a.max, q25: qf(0.25), q50: qf(0.5), q75: qf(0.75), centroids: td.centroids, count: td.count });
      }
    }
    return { rows, groupBy: q.groupBy, weighted: !!weightFn, overflow: merged.overflow, where };
  }
  const fast = filterX ? null : await scanStatsPinned(L, q, mask, onProgress, signal);   // pinned columns → the tier-3 window path
  if (fast) return fast;
  const TD = tdigest();
  const mkAcc = () => colFns.map(() => ({ n: 0, sw: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, td: TD.create() }));
  const groups = new Map();
  let overflow = false, total = 0;
  const N = attrRowCountOf(L) || 0;
  // layerRecords owns the record number (see scanGT)
  for await (const { f: row, rec: rr } of layerRecords(L)) {
    {
      total++; if ((total & 0xffff) === 0) { checkAbort(signal); if (onProgress) onProgress(total, N, 'on this page'); await new Promise((r) => setTimeout(r)); }
      if (mask && !(rr < mask.length && mask[rr])) continue;
      if (filterFn && !filterFn(row)) continue;
      let g = '';
      if (groupFn) { const gv = groupFn(row); g = gv == null || gv === '' ? '—' : String(gv); }
      let A = groups.get(g);
      if (!A) { if (groups.size >= 256) { overflow = true; continue; } A = mkAcc(); groups.set(g, A); }
      const w = weightFn ? (+weightFn(row) || 0) : 1;
      if (!(w > 0)) continue;
      for (let i = 0; i < colFns.length; i++) {
        const x = numOf(colFns[i].fn(row));
        if (!Number.isFinite(x)) continue;
        const a = A[i];
        a.n++; momentAdd(a, x, w);
        if (x < a.min) a.min = x; if (x > a.max) a.max = x;
        tdAdd(TD, a, x);
      }
    }
  }
  if (onProgress) onProgress(total, N);
  const rows = [];
  for (const g of [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const A = groups.get(g);
    for (let i = 0; i < colFns.length; i++) {
      const a = A[i]; if (!a.n) continue;
      const td = tdDone(TD, a), qf = (p) => quantileFromCentroids(td.centroids, td.count, p);
      rows.push({ group: g, col: colFns[i].c, n: a.n, mean: a.mean, std: momentStd(a), min: a.min, max: a.max, q25: qf(0.25), q50: qf(0.5), q75: qf(0.75), centroids: td.centroids, count: td.count });
    }
  }
  return { rows, groupBy: q.groupBy, weighted: !!weightFn, overflow };
}

export function openStats(L, ropts) {
  if (!L || !layerTableHeader(L)) { $('#meta').textContent = 'stats: needs a table-backed layer'; return; }
  const ex = _statsWins.get(L.id); if (ex) { if (!ropts) { ex.win.el.style.zIndex = nextZ(); return; } ex.win.close(); }
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'stats: no numeric column'; return; }
  const st = { cols: [nums[0]], groupBy: '', weight: '', scope: 'all', scan: null, stale: true, running: false };
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.stats);
  if (saved) {
    if (Array.isArray(saved.cols) && saved.cols.length) { const keep = saved.cols.filter((c) => nums.includes(c)); if (keep.length) st.cols = keep; }
    if (saved.groupBy != null) st.groupBy = saved.groupBy;
    if (saved.weight != null) st.weight = saved.weight;
    if (saved.scope) st.scope = saved.scope;
  }
  const cfgOf = () => ({ layer: L.name, cols: st.cols.slice(), groupBy: st.groupBy, weight: st.weight, scope: st.scope });
  const win = floatWin({ title: `stats · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 700), y: 110, w: 680, h: 400,
    onClose: () => { saveAnalysisCfg(L, 'stats', cfgOf(), win); setAnalysisOpen(L, 'stats', false); _statsWins.delete(L.id); } });
  setAnalysisOpen(L, 'stats', true);
  applyAnalysisGeo(L, 'stats', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main';
  body.append(rail, main);
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };
  const fmtC = (v) => (v == null || !Number.isFinite(v) ? '' : fmtStat(v));
  const render = () => {
    main.textContent = '';
    if (!st.scan) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = win.sub.textContent || 'configure, then Run'; main.append(d); win.el._statsRows = null; return; }
    const tbl = document.createElement('table'); tbl.className = 'st-tbl';
    const gb = st.scan.groupBy;
    const heads = [...(gb ? [gb] : []), 'column', 'n', st.scan.weighted ? 'mean·w' : 'mean', st.scan.weighted ? 'std·w' : 'std', 'min', 'q25', 'median', 'q75', 'max'];
    const hr = document.createElement('tr'); heads.forEach((h2) => { const th = document.createElement('th'); th.textContent = h2; hr.append(th); }); tbl.append(hr);
    for (const row of st.scan.rows) {
      const tr = document.createElement('tr');
      const cells = [...(gb ? [row.group] : []), row.col, row.n.toLocaleString(), fmtC(row.mean), fmtC(row.std), fmtC(row.min), fmtC(row.q25), fmtC(row.q50), fmtC(row.q75), fmtC(row.max)];
      cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = String(c); if (i >= (gb ? 2 : 1)) td.className = 'num'; tr.append(td); });
      tbl.append(tr);
    }
    main.append(tbl);
    win.sub.textContent = `${st.scope !== 'all' ? st.scope + ' · ' : ''}${st.scan.rows.length} row${st.scan.rows.length === 1 ? '' : 's'}${st.scan.weighted ? ' · weighted mean/std (quantiles unweighted)' : ''}${st.scan.overflow ? ' · ⚠ over 256 groups — extra groups dropped' : ''}`;
    win.el._statsRows = st.scan.rows.map(({ centroids, count, ...r }) => r);   // the digests feed Q-Q, not this table
  };
  const tableTSV = () => {
    if (!st.scan) return null;
    const gb = st.scan.groupBy;
    const lines = [[...(gb ? [gb] : []), 'column', 'n', 'mean', 'std', 'min', 'q25', 'median', 'q75', 'max'].join('\t')];
    for (const r of st.scan.rows) lines.push([...(gb ? [r.group] : []), r.col, r.n, r.mean, r.std, r.min, r.q25, r.q50, r.q75, r.max].join('\t'));
    return lines.join('\n');
  };
  const scanStats = (onProgress, signal) => statsScan(L, st, scopeMask(st, L), onProgress, signal);
  const run = async () => {
    if (st.running) return;
    if (st.scope !== 'all' && !scopeMask(st, L)) { win.sub.textContent = scopeMissing(st, L) || `no ${st.scope} mask`; return; }
    st.running = true; win.sub.textContent = 'scanning…';
    const rc = runCancellable(runBtn);
    try { st.scan = await scanStats((n, N, w) => { progEl.textContent = scanProgressText(n, N, w); }, rc.signal); }
    catch (e) { win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `stats: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    win.el._scanWhere = st.scan.where || 'on this page';
    saveAnalysisCfg(L, 'stats', cfgOf(), win);
    render();
  };
  function buildRail() {
    rail.textContent = '';
    const cSec = document.createElement('div');
    cSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'columns' }));
    const colBtn = document.createElement('button'); colBtn.className = 'sw-add'; colBtn.textContent = st.cols.length > 3 ? `${st.cols.length} columns` : st.cols.join(', ');
    colBtn.onclick = (e) => H.menuXY(e.clientX, e.clientY, numericColsOf(L).map((c) => ({ label: (st.cols.includes(c) ? '✓ ' : '') + c, action: () => { if (st.cols.includes(c)) { if (st.cols.length > 1) st.cols = st.cols.filter((x) => x !== c); } else st.cols.push(c); markStale(); buildRail(); } })));
    cSec.append(colBtn); rail.append(cSec);
    const gSec = document.createElement('div');
    gSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'group by' }));
    const gSel = document.createElement('select'); gSel.className = 'sw-sel'; gSel.style.width = '100%'; gSel.title = 'the category channel or any painted column (assign domains → stats by domain)';
    { const o = document.createElement('option'); o.value = ''; o.textContent = '— whole layer —'; gSel.append(o); }
    for (const c of statsGroupCols(L)) { const o = document.createElement('option'); o.value = c; o.textContent = c; gSel.append(o); }
    if (st.groupBy && ![...gSel.options].some((o) => o.value === st.groupBy)) { const o = document.createElement('option'); o.value = st.groupBy; o.textContent = st.groupBy + ' (missing)'; gSel.append(o); }
    gSel.value = st.groupBy; gSel.onchange = () => { st.groupBy = gSel.value; markStale(); };
    gSec.append(gSel); rail.append(gSec);
    const wSec = document.createElement('div');
    wSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'weight' }));
    const wIn = document.createElement('input'); wIn.className = 'sw-in'; wIn.style.width = '100%'; wIn.type = 'text'; wIn.placeholder = 'weight expr (blank = none)'; wIn.value = st.weight; wIn.title = 'weight expression (@gcu/expr) — e.g. SG for density-weighted means. Weights the mean/std; quantiles stay unweighted';
    wIn.onchange = () => { st.weight = wIn.value.trim(); markStale(); }; wSec.append(wIn); rail.append(wSec);
    const vSec = document.createElement('div');
    const scRow = document.createElement('div'); scRow.className = 'sw-row'; const scL = document.createElement('span'); scL.textContent = 'scope';
    const seg = document.createElement('div'); seg.className = 'sw-seg'; seg.title = 'all rows · rows matching the current filter · the 3D selection';
    for (const [v, t] of [['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']]) { const bt = document.createElement('button'); bt.className = 'sw-segbtn' + (st.scope === v ? ' on' : ''); bt.textContent = t; bt.onclick = () => { st.scope = v; markStale(); buildRail(); }; seg.append(bt); }
    scRow.append(scL, seg); vSec.append(scRow);
    rail.append(vSec);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => H.saveRecipe('stats', cfgOf(), `${(L.label || L.name).replace(/\.[^.]+$/, '')} stats`);
    const resRow = plotExportBtns(null, () => `stats-${(L.label || L.name).replace(/\.[^.]+$/, '')}.png`, tableTSV, 'stats');
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, staleEl, progEl); rail.append(foot);
  }
  _statsWins.set(L.id, { win, redraw: run, st });
  buildRail(); render();
  if (ropts && ropts.run) run();
}
