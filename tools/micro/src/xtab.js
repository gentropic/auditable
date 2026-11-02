// micro resource cross-tab — the resource table: tonnage, grade, metal and count
// by a GROUP (a category, a paint column — domains, classes) × GRADE BINS between
// typed cutoffs, or cumulative above each. Tonnage = density × block volume, as in
// grade-tonnage (the same units, sub-block volumes and scopes); a row with no
// grade keeps its tonnage in its own column, so the total is the model's. One
// pass per Run — columnar on workers where the layer can, the page otherwise —
// then every view (measure, bins ↔ cumulative, flip) is display-time.
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileValue, quoteIdent, validate } from '../../../ext/expr/index.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
import { volumeAt, volumeContextOf, numericColsOf } from './analysis.js';
import { applyAnalysisGeo, checkAbort, fmtStat, gradeUnitSel, plotExportBtns, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, setAnalysisOpen } from './analysis-ui.js';
import { floatWin, focusWindow } from './windows.js';
import { canScanColumnar, scanColumnar, zoneKeeper } from './colscan.js';
import { crosstabMerge, xtabAdd, xtabKey, XTAB_GROUPS_CAP } from './scanner.js';
import { statsGroupCols } from './stats.js';
import { gridAxesOf } from './grid-ops.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setXtabHooks): markProjectDirty
let H = {};
export function setXtabHooks(h) { H = h; }
export const _xtabWins = new Map();

// cutoffs as typed → ascending distinct finite numbers. Separated by spaces or
// semicolons, a comma is a decimal comma ("0,5 1 2"); otherwise commas separate
// ("0.5,1,2")
export function parseCutoffs(txt) {
  const t = String(txt || '').trim();
  const toks = /[\s;]/.test(t) ? t.split(/[\s;]+/).map((s) => s.replace(',', '.')) : t.split(',');
  const v = toks.map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  return [...new Set(v)].sort((a, b) => a - b);
}

export function openCrosstab(L, ropts) {
  if (!L || !gridAxesOf(L)) { $('#meta').textContent = 'cross-tab: needs a regular block model'; return null; }
  const ex = _xtabWins.get(L.id); if (ex) { if (!ropts) { focusWindow(ex.win.el); return ex; } ex.win.close(); }
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'cross-tab: no numeric column'; return null; }
  const groups0 = statsGroupCols(L), gu0 = L.gtUnits || {};
  const w0 = gu0.weight === '#const' ? (gu0.densConst != null ? String(gu0.densConst) : '') : (gu0.weight || '');
  const st = { group: groups0[0] || '', grade: nums[0], weight: w0, filter: '', densUnit: gu0.densUnit || 't/m3', gradeUnit: gu0.grade || '',
    cutoffs: '', scope: 'all', measure: 'tonnage', mode: 'bins', flip: false, scan: null, stale: true, running: false };
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.xtab);
  if (saved) for (const k of ['group', 'grade', 'weight', 'filter', 'densUnit', 'gradeUnit', 'cutoffs', 'scope', 'measure', 'mode', 'flip']) if (saved[k] != null) st[k] = saved[k];
  const cfgOf = () => ({ layer: L.name, group: st.group, grade: st.grade, weight: st.weight, filter: st.filter, densUnit: st.densUnit, gradeUnit: st.gradeUnit, cutoffs: st.cutoffs, scope: st.scope, measure: st.measure, mode: st.mode, flip: st.flip });
  const persistUnits = () => { L.gtUnits = { ...(L.gtUnits || {}), grade: st.gradeUnit, densUnit: st.densUnit, weight: st.weight }; H.markProjectDirty(); };
  const win = floatWin({ title: `cross-tab · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 760), y: 110, w: 740, h: 500,
    onClose: () => { saveAnalysisCfg(L, 'xtab', cfgOf(), win); setAnalysisOpen(L, 'xtab', false); _xtabWins.delete(L.id); } });
  setAnalysisOpen(L, 'xtab', true);
  applyAnalysisGeo(L, 'xtab', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main';
  body.append(rail, main);
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };

  // ── the table, from the cached scan ──
  // columns (bins mode): < c0 · c0–c1 · … · ≥ cN · no grade · total
  //          (cumulative): ≥ c0 · … · ≥ cN · (graded) · no grade · total
  const columnsOf = (edges) => {
    const nb = edges.length + 1, f = (v) => fmtStat(v);
    const cols = [];
    if (st.mode === 'cum') {
      for (let k = 0; k < edges.length; k++) cols.push({ label: `≥ ${f(edges[k])}`, slots: range(k + 1, nb) });
      cols.push({ label: edges.length ? 'all graded' : 'graded', slots: range(0, nb) });
    } else if (!edges.length) cols.push({ label: 'graded', slots: [0] });
    else {
      cols.push({ label: `< ${f(edges[0])}`, slots: [0] });
      for (let k = 1; k < edges.length; k++) cols.push({ label: `${f(edges[k - 1])}–${f(edges[k])}`, slots: [k] });
      cols.push({ label: `≥ ${f(edges[edges.length - 1])}`, slots: [edges.length] });
    }
    cols.push({ label: 'no grade', slots: [nb], blank: true });
    cols.push({ label: 'total', slots: range(0, nb + 1), total: true });
    return cols;
  };
  const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const sumOf = (A, slots) => { let w = 0, wg = 0, n = 0; for (const s of slots) { w += A[3 * s]; wg += A[3 * s + 1]; n += A[3 * s + 2]; } return { w, wg, n }; };
  const mScale = () => (st.scan && st.scan.gradeUnit ? unitConvert(1, st.scan.gradeUnit, 'fraction') : 1);
  const value = (c, measure, blank) => {
    if (measure === 'count') return c.n;
    if (measure === 'grade') return blank || !(c.w > 0) ? NaN : c.wg / c.w;
    if (measure === 'metal') return blank ? NaN : c.wg * mScale();
    return c.w;
  };
  const tU = () => (st.scan && st.scan.weighted ? 't' : 'm³');
  const measureLabel = (m) => (m === 'tonnage' ? (st.scan && st.scan.weighted ? 'tonnage (t)' : 'volume (m³)') : m === 'metal' ? (st.scan && st.scan.gradeUnit ? 'metal (t)' : `grade·${tU()}`) : m === 'grade' ? `grade${st.scan && st.scan.gradeUnit ? ` (${st.scan.gradeUnit === 'pct' ? '%' : st.scan.gradeUnit})` : ''}` : 'blocks');
  // the cached scan → { rowKeys, cols, cell(rowKey, col) → {w,wg,n} } (the total row adds every group)
  const model = () => {
    const { groups, edges } = st.scan;
    const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const tot = new Float64Array(3 * (edges.length + 2));
    for (const A of groups.values()) for (let i = 0; i < tot.length; i++) tot[i] += A[i];
    const rowKeys = st.scan.grouped ? [...keys, '__total'] : ['__total'];
    const cols = columnsOf(edges);
    return { rowKeys, cols, cell: (k, c) => sumOf(k === '__total' ? tot : groups.get(k), c.slots), rowLabel: (k) => (k === '__total' ? (st.scan.grouped ? 'total' : 'all') : k) };
  };
  const render = () => {
    main.textContent = '';
    if (!st.scan) { const d = document.createElement('div'); d.className = 'st-empty'; d.textContent = win.sub.textContent || 'configure, then Run'; main.append(d); win.el._xtab = null; return; }
    const m = model(), heads = m.cols.map((c) => c.label), measure = st.measure;
    const tbl = document.createElement('table'); tbl.className = 'st-tbl xt-tbl';
    const corner = st.flip ? `${st.scan.grade} \\ ${st.scan.grouped ? st.scan.group : ''}` : `${st.scan.grouped ? st.scan.group : ''} \\ ${st.scan.grade}`;
    const hr = document.createElement('tr');
    const th0 = document.createElement('th'); th0.textContent = corner; hr.append(th0);
    for (const h of (st.flip ? m.rowKeys.map(m.rowLabel) : heads)) { const th = document.createElement('th'); th.textContent = h; th.className = 'num'; hr.append(th); }
    tbl.append(hr);
    const fmt = (v) => (Number.isFinite(v) ? (measure === 'count' ? v.toLocaleString() : fmtStat(v)) : '');
    const outer = st.flip ? m.cols : m.rowKeys, inner = st.flip ? m.rowKeys : m.cols;
    for (const o of outer) {
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = st.flip ? o.label : m.rowLabel(o); tr.append(td0);
      if (st.flip ? o.total : o === '__total') tr.className = 'xt-total';
      for (const i of inner) {
        const col = st.flip ? o : i, key = st.flip ? i : o;
        const td = document.createElement('td'); td.className = 'num' + (col.total || key === '__total' ? ' xt-sum' : '');
        td.textContent = fmt(value(m.cell(key, col), measure, col.blank));
        tr.append(td);
      }
      tbl.append(tr);
    }
    main.append(tbl);
    const grd = st.scan.groups.size;
    win.sub.textContent = `${measureLabel(measure)} · ${st.mode === 'cum' ? 'above each cutoff' : 'between cutoffs'}${st.scope !== 'all' ? ' · ' + st.scope : ''} · ${st.scan.grouped ? `${grd} group${grd === 1 ? '' : 's'} · ` : ''}${st.scan.n.toLocaleString()} rows${st.scan.overflow ? ` · ⚠ over ${XTAB_GROUPS_CAP} groups — extra groups dropped` : ''}`;
    win.el._xtab = { rows: m.rowKeys.map(m.rowLabel), cols: heads, cell: (r, c, meas) => value(m.cell(m.rowKeys[r], m.cols[c]), meas || measure, m.cols[c].blank) };
  };

  // ── one pass: group × slot accumulation ──
  const scanXtab = async (onProgress, signal) => {
    const h = layerTableHeader(L), schema = schemaExt(L, h);
    const edges = parseCutoffs(st.cutoffs);
    const dScale = unitConvert(1, st.densUnit, 't/m3');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(st.grade).trim())) {
      const v = validate(String(st.grade).trim(), schema);
      if (!v.ok) throw new Error(`grade "${st.grade}": ${(v.errors[0] && v.errors[0].message) || 'unknown column'}`);
    }
    const gradeX = quoteIdent(st.grade), groupX = st.group ? quoteIdent(st.group) : null;
    const weightX = (st.weight || '').trim() || null, filterX = (st.filter || '').trim() || null;
    let gradeFn, groupFn = null, weightFn = null, filterFn = null;
    try { gradeFn = compileValue(gradeX, schema, { decimal: '.' }); } catch { throw new Error(`grade "${st.grade}": invalid`); }
    if (groupX) { try { groupFn = compileValue(groupX, schema, { decimal: '.' }); } catch { throw new Error(`group "${st.group}": invalid`); } }
    if (weightX) { try { weightFn = compileValue(weightX, schema, { decimal: '.' }); } catch { throw new Error(`density "${weightX}": invalid`); } }
    if (filterX) { try { filterFn = compileBool(filterX, schema, { decimal: '.' }); } catch { throw new Error(`filter "${filterX}": invalid`); } }
    const mask = scopeMask(st, L), vc = volumeContextOf(L), N = attrRowCountOf(L) || 0;
    const base = { edges, grade: st.grade, group: st.group, grouped: !!groupX, weighted: !!weightX, gradeUnit: st.gradeUnit };
    if (canScanColumnar(L)) {
      const dims = vc.dc ? [h.columns[vc.dc.x], h.columns[vc.dc.y], h.columns[vc.dc.z]] : null;
      const params = { group: groupX, grade: gradeX, weight: weightX, filter: filterX, dScale, vol: { base: vc.base, dims }, edges };
      const { parts, where } = await scanColumnar(L, { kernel: 'crosstab', params, exprs: [groupX, gradeX, weightX, filterX], extraCols: dims || [], mask, signal,
        onProgress, keepZone: zoneKeeper(L, { mask }) });
      const merged = crosstabMerge(parts);
      let n = 0; for (const A of merged.groups.values()) for (let i = 2; i < A.length; i += 3) n += A[i];
      return { ...base, groups: merged.groups, overflow: merged.overflow, n, where };
    }
    // the row path: the same add, a record at a time (layerRecords owns the numbering)
    const groups = new Map(); let overflow = false, n = 0, seen = 0;
    for await (const { f: row, rec } of layerRecords(L)) {
      seen++; if ((seen & 0xffff) === 0) { checkAbort(signal); if (onProgress) onProgress(seen, N, 'on this page'); await new Promise((r) => setTimeout(r)); }
      if (mask && !(rec < mask.length && mask[rec])) continue;
      if (filterFn && !filterFn(row)) continue;
      const w = (weightFn ? (+weightFn(row) || 0) * dScale : 1) * volumeAt(vc, row);
      if (!(w > 0)) continue;
      if (xtabAdd(groups, groupFn ? xtabKey(groupFn(row)) : '', edges, numOf(gradeFn(row)), w)) n++; else overflow = true;
    }
    return { ...base, groups, overflow, n, where: 'on this page' };
  };
  const run = async () => {
    if (st.running) return;
    if (st.scope !== 'all' && !scopeMask(st, L)) { win.sub.textContent = scopeMissing(st, L) || `no ${st.scope} on this layer`; return; }
    st.running = true; win.sub.textContent = 'scanning…';
    const rc = runCancellable(runBtn);
    try { st.scan = await scanXtab((d, N, w) => { progEl.textContent = scanProgressText(d, N, w); }, rc.signal); }
    catch (e) { win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `cross-tab: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    win.el._scanWhere = st.scan.where;
    saveAnalysisCfg(L, 'xtab', cfgOf(), win);
    render();
  };
  // every measure, long form: group · bin · tonnage · grade · metal · count
  const tableTSV = () => {
    if (!st.scan) return null;
    const m = model();
    const lines = [[st.scan.grouped ? st.scan.group : 'group', `${st.scan.grade} bin`, measureLabel('tonnage'), measureLabel('grade'), measureLabel('metal'), 'blocks'].join('\t')];
    for (const k of m.rowKeys) for (const c of m.cols) {
      const v = m.cell(k, c), g = value(v, 'grade', c.blank), mt = value(v, 'metal', c.blank);
      lines.push([m.rowLabel(k), c.label, v.w, Number.isFinite(g) ? g : '', Number.isFinite(mt) ? mt : '', v.n].join('\t'));
    }
    return lines.join('\n');
  };

  // ── the rail ──
  const row = (label, el, title) => { const r = document.createElement('div'); r.className = 'sw-row'; if (title) r.title = title; const s = document.createElement('span'); s.textContent = label; s.style.width = '52px'; r.append(s, el); return r; };
  const sel = (opts, val, on) => { const s = document.createElement('select'); s.className = 'sw-sel'; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); } s.value = val; s.onchange = () => on(s.value); return s; };
  const inp = (val, ph, on) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'text'; i.value = val; i.placeholder = ph; i.onchange = () => on(i.value.trim()); return i; };
  const seg = (opts, val, on) => { const d = document.createElement('div'); d.className = 'sw-seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.className = 'sw-segbtn' + (val === v ? ' on' : ''); b.textContent = t; b.onclick = () => on(v); d.append(b); } return d; };
  function buildRail() {
    rail.textContent = '';
    const dSec = document.createElement('div');
    dSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'table' }));
    dSec.append(row('rows', sel([['', '(none — one total)'], ...statsGroupCols(L).map((c) => [c, c])], st.group, (v) => { st.group = v; markStale(); }), 'the group down the side: a category or a painted column (domains, classes)'));
    const gS = sel(numericColsOf(L).map((c) => [c, c]), st.grade, (v) => { st.grade = v; markStale(); });
    dSec.append(row('grade', gS, 'the grade the bins cut'));
    dSec.append(row('cutoffs', inp(st.cutoffs, 'e.g. 0.5 1 2', (v) => { st.cutoffs = v; markStale(); }), 'grade cutoffs, ascending — bins between them (or cumulative above each). Empty: graded vs no grade only'));
    dSec.append(row('unit', gradeUnitSel(st.gradeUnit, (v) => { st.gradeUnit = v; persistUnits(); markStale(); }, 'the grade\'s declared unit — metal in tonnes when it is set'), ''));
    dSec.append(row('density', inp(st.weight, 'blank = volume', (v) => { st.weight = v; persistUnits(); markStale(); }), 'density expression (@gcu/expr) — tonnage = density × block volume. e.g. SG, 2.7. blank = volume'));
    const duS = sel([['t/m3', 't/m³ (=g/cm³)'], ['kg/m3', 'kg/m³'], ['lb/ft3', 'lb/ft³']], st.densUnit, (v) => { st.densUnit = v; persistUnits(); markStale(); });
    dSec.append(row('ρ unit', duS, 'declared unit of the density — converted to t/m³ so tonnage is in tonnes'));
    dSec.append(row('filter', inp(st.filter, 'optional', (v) => { st.filter = v; markStale(); }), 'rows to count (@gcu/expr) — e.g. CLASS <= 2'));
    dSec.append(row('scope', seg([['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']], st.scope, (v) => { st.scope = v; buildRail(); run(); }), 'all rows · the layer\'s current filter · the 3D selection'));
    rail.append(dSec);
    const vSec = document.createElement('div');
    vSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'show' }));
    vSec.append(row('measure', sel([['tonnage', 'tonnage'], ['grade', 'grade'], ['metal', 'metal'], ['count', 'blocks']], st.measure, (v) => { st.measure = v; render(); })));
    vSec.append(row('bins', seg([['bins', 'between'], ['cum', '≥ cutoff']], st.mode, (v) => { st.mode = v; buildRail(); render(); }), 'between consecutive cutoffs, or cumulative above each'));
    const fl = document.createElement('button'); fl.className = 'sw-add'; fl.textContent = '⇄ flip rows / columns'; fl.onclick = () => { st.flip = !st.flip; render(); };
    vSec.append(fl);
    rail.append(vSec);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    // the results row every analysis window shares: ⇥ layer · ⧉ table (every measure, long form)
    const res = plotExportBtns(null, () => `xtab-${(L.label || L.name).replace(/\.[^.]+$/, '')}`, tableTSV, 'cross-tab');
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, res, staleEl, progEl); rail.append(foot);
  }
  const handle = { win, redraw: run, st, run, tableTSV };
  _xtabWins.set(L.id, handle);
  buildRail(); render();
  if (ropts && ropts.run) run();
  return handle;
}
