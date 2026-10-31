// micro swath — the swath / drift window: mean grade per band along X / Y / Z, an
// oriented trio from dip-direction / dip / rake or a trend / plunge, per series,
// with the band under the cursor drawn in 3D, zebra stripes painted onto the
// blocks, and a band dragged out into a selection. Carved from index.html (phase 3).
import { dirTrendPlunge, frameDipDirDipRake } from './geom.js';
import { S, layerById } from './state.js';
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileValue, quoteIdent, validate } from '../../../ext/expr/index.js';
import { numericColsOf, volumeAt, volumeContextOf } from './analysis.js';
import { canScanColumnar, scanColumnar } from './colscan.js';
import { SERIES_COLORS, analysisSerCfg, analysisSerRestore, applyAnalysisGeo, checkAbort, fmtStat, gradeUnitFactor, gradeUnitSel, niceStep, plotChart, plotExportBtns, rangesForCfg, rangesFromCfg, rangesOf, rangesRow, reconcilePairs, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, seriesZoneKeep, setAnalysisOpen } from './analysis-ui.js';
import { swathMerge } from './scanner.js';
import { coordNum } from '../../../ext/condenser/src/main.js';
import { gridAxesOf } from './grid-ops.js';
import { floatWin, nextZ } from './windows.js';
import { paintRecount } from './columns.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setSwathHooks): _attrTables, addPaintColorOptions, addPaintValue, applyLayerSelection, applyPaintPalette, clearSelection, createPaintCol, layerWorldBbox, markProjectDirty, menuXY, paintColByName, paintSelOf, rendererDocBbox, requestRender, saveRecipe, selectionStatus, setLayerColorSel, setSwathBand
let H = {};
export function setSwathHooks(h) { H = h; }

// ── swath (drift) analysis ────────────────────────────────────────────────────
// v3 / swath-direction helpers moved to ./src/geom.js (first extracted module)
export const AXIS_NAMES = { axes: ['X (east)', 'Y (north)', 'Z (elev)'], oriented: ['rake line', 'in-plane ⟂', 'pole'] };

// projected extent along dir from the layer bbox corners
export function projRange(L, dir) {
  const bb = H.layerWorldBbox(L); if (!bb) return [0, 1];
  let lo = Infinity, hi = -Infinity;
  for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) { const t = x * dir[0] + y * dir[1] + z * dir[2]; if (t < lo) lo = t; if (t > hi) hi = t; }
  return [lo, hi];
}

// (computeSwath lives in src/analysis.js)
// the direction vectors this mode swaths (all scanned in ONE pass so switching
// axis/direction is free), + their display names
export function swathModeDirs(st) {
  if (st.mode === 'axes') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (st.mode === 'oriented') return frameDipDirDipRake(st.dd, st.dip, st.rake);
  return [dirTrendPlunge(st.trend, st.plunge)];
}

export function swathDirNames(st) {
  if (st.mode === 'axes') return AXIS_NAMES.axes;
  if (st.mode === 'oriented') return AXIS_NAMES.oriented;
  return [`trend ${st.trend}° / plunge ${st.plunge}°`];
}

// ONE streamed pass per series' layer → per-direction FINE-bin sums {Σw,Σwg,n}.
// Bounded by BINS, not blocks (so a 200M model is fine) — the scalable answer to
// "don't cache every element". Each series compiles its own grade/weight/filter
// expression (@gcu/expr); weight defaults to the block's geometric support.
export async function scanSwath(st, onProgress, signal) {
  const dirs = swathModeDirs(st);
  const series = st.series.map((s) => {
    const L = layerById(s.layerId); if (!L) return null;
    const h = layerTableHeader(L); if (!h || !h.mapping) return null;
    const m = h.mapping, schema = schemaExt(L, h);
    // a valid but UNKNOWN column name compiles to a BLANK closure (() => null),
    // and +null === 0 is finite — so a renamed/removed column silently produced
    // a flat grade-0 curve at full tonnage. Refuse a bare missing name loudly;
    // a real expression stays free-form.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(s.col).trim())) {
      const _v = validate(String(s.col).trim(), schema);
      if (!_v.ok) throw new Error(`series column "${s.col}": ${(_v.errors[0] && _v.errors[0].message) || 'unknown column'} — pick another, or reopen the layer that has it`);
    }
    let gradeFn; try { gradeFn = compileValue(quoteIdent(s.col), schema, { decimal: '.' }); } catch { return null; }   // a NAME as an expression → quote
    let weightFn = null, filterFn = null;
    if (s.weight && s.weight.trim()) { try { weightFn = compileValue(s.weight, schema, { decimal: '.' }); } catch { throw new Error(`series weight "${s.weight}": invalid`); } }
    if (s.filter && s.filter.trim()) { try { filterFn = compileBool(s.filter, schema, { decimal: '.' }); } catch { throw new Error(`series filter "${s.filter}": invalid`); } }
    return { s, L, m, vc: volumeContextOf(L), gradeFn, weightFn, filterFn, fine: dirs.map(() => new Map()), n: 0 };
  }).filter(Boolean);
  if (!series.length) return null;
  const range = dirs.map((dir) => { let lo = Infinity, hi = -Infinity; for (const se of series) { const [a, b] = projRange(se.L, dir); if (a < lo) lo = a; if (b > hi) hi = b; } return [lo, hi]; });
  const fineW = range.map(([lo, hi]) => Math.max(1e-6, (hi - lo) / 600 || 1));
  const fineOrigin = range.map(([lo]) => lo);
  let total = 0, where = '';
  const colL = [...new Set(series.filter((se) => canScanColumnar(se.L)).map((se) => se.L))];
  const N = colL.reduce((t, Lx) => t + (attrRowCountOf(Lx) || 0), 0) + series.filter((se) => !colL.includes(se.L)).reduce((t, se) => t + (attrRowCountOf(se.L) || 0), 0);
  for (const Lx of colL) {                                 // columnar + parallel (src/colscan.js): one pass per layer
    const ses = series.filter((se) => se.L === Lx), vc = ses[0].vc, h = layerTableHeader(Lx), m = ses[0].m;
    const dims = vc.dc ? [h.columns[vc.dc.x], h.columns[vc.dc.y], h.columns[vc.dc.z]] : null;
    const coords = [h.columns[m.x], h.columns[m.y], h.columns[m.z]];
    const params = { series: ses.map((se) => ({ grade: quoteIdent(se.s.col), weight: (se.s.weight || '').trim() || null, filter: (se.s.filter || '').trim() || null })), dirs, fineOrigin, fineW, coords, vol: { base: vc.base, dims } };
    const base = total;
    const { parts } = await scanColumnar(Lx, { kernel: 'swath', params, exprs: params.series.flatMap((x) => [x.grade, x.weight, x.filter]), extraCols: [...coords, ...(dims || [])], mask: scopeMask(st, Lx), signal,
      keepZone: seriesZoneKeep(Lx, params.series.map((x) => x.filter), scopeMask(st, Lx)),
      onProgress: (d, n, w) => { total = base + d; where = w; if (onProgress) onProgress(total, N, w); } });
    swathMerge(parts, ses.length, dirs.length).forEach((r, k) => { ses[k].fine = r.fine; ses[k].n = r.n; });
  }
  for (const se of series) {
    if (colL.includes(se.L)) continue;
    // scope mask per series layer: selection / current filter / all. A layer
    // without the scope's mask contributes ALL its rows (e.g. comparing a
    // filtered model against unfiltered samples) — the sub line names the scope.
    const L = se.L, m = se.m, selMask = scopeMask(st, L);
    // layerRecords owns the record number (see scanGT) — source columns keep
    // their positions in the extended row, so m.x/y/z still index correctly
    for await (const { f: row, rec: rr } of layerRecords(L)) {
      {
        total++; if ((total & 0xffff) === 0) { checkAbort(signal); if (onProgress) onProgress(total, N, 'on this page'); await new Promise((r) => setTimeout(r)); }
        if (selMask && !(rr < selMask.length && selMask[rr])) continue;
        const x = coordNum(row[m.x]), y = coordNum(row[m.y]), z = coordNum(row[m.z]); if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        if (se.filterFn && !se.filterFn(row)) continue;
        const g = numOf(se.gradeFn(row)); if (!Number.isFinite(g)) continue;
        const w = (se.weightFn ? (+se.weightFn(row) || 0) : 1) * volumeAt(se.vc, row); if (!(w > 0)) continue;
        for (let di = 0; di < dirs.length; di++) {
          const d = dirs[di], t = x * d[0] + y * d[1] + z * d[2], bi = Math.floor((t - fineOrigin[di]) / fineW[di]);
          let e = se.fine[di].get(bi); if (!e) { e = { sw: 0, swg: 0, n: 0 }; se.fine[di].set(bi, e); }
          e.sw += w; e.swg += w * g; e.n++;
        }
        se.n++;
      }
    }
    if (onProgress) onProgress(total, N, 'on this page');
    where = where || 'on this page';
  }
  return { dirs, dirNames: swathDirNames(st), series, range, fineW, fineOrigin, where };
}

// re-aggregate the fine bins of direction `di` into display bands — a pure,
// instant recompute (exact weighted mean, since we kept the sums). This is why
// band width / offset / axis are live after one Run, with no re-scan.
export function binSwath(scan, di, bandWidth, offset) {
  const out = scan.series.map((se) => {
    const bands = new Map();
    for (const [fb, e] of se.fine[di]) {
      const center = scan.fineOrigin[di] + (fb + 0.5) * scan.fineW[di];
      const B = Math.floor((center - offset) / bandWidth);
      let a = bands.get(B); if (!a) { a = { sw: 0, swg: 0, n: 0 }; bands.set(B, a); }
      a.sw += e.sw; a.swg += e.swg; a.n += e.n;
    }
    return { se, bands };
  });
  const allB = new Set(); for (const o of out) for (const b of o.bands.keys()) allB.add(b);
  return { keys: [...allB].sort((a, b) => a - b), out };
}

export const _swathWins = new Map();

export function openSwath(L, ropts) {
  if (!L || !gridAxesOf(L)) { $('#meta').textContent = 'swath: needs a regular block model'; return; }
  const ex = _swathWins.get(L.id); if (ex) { if (!ropts) { ex.win.el.style.zIndex = nextZ(); return; } ex.win.close(); }   // a recipe replaces the open window
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'swath: no numeric column'; return; }
  const pairs = reconcilePairs(nums);
  const mkSer = (Lx, col, i) => ({ layerId: Lx.id, col, unit: (Lx.gtUnits && Lx.gtUnits.grade) || '', weight: '', filter: '', color: SERIES_COLORS[i % SERIES_COLORS.length] });
  // bandW / off are PER DIRECTION (keyed by axis index) — an E–W drift wants a
  // different band than a bench-by-bench Z profile. null/absent = auto.
  const st = { mode: 'axes', axis: 0, dd: 90, dip: 45, rake: 0, trend: 0, plunge: 0, bandW: {}, off: {}, bars: 'count', zebra: false, scope: 'all',
    gradeUnit: (L.gtUnits && L.gtUnits.grade) || '',        // shares the layer's declared grade unit with GT
    series: pairs.length ? [mkSer(L, pairs[0].ref, 0), mkSer(L, pairs[0].self, 1)] : [mkSer(L, nums[0], 0)],
    scan: null, stale: true, running: false };
  // a recipe (explicitly picked) beats the saved setup beats the defaults
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.swath);
  if (saved) {
    for (const k of ['mode', 'axis', 'dd', 'dip', 'rake', 'trend', 'plunge', 'bars', 'scope', 'gradeUnit']) if (saved[k] != null) st[k] = saved[k];
    if (saved.bandW) st.bandW = { ...saved.bandW };
    if (saved.off) st.off = { ...saved.off };
    if (saved.locate != null) st.locate = saved.locate;
    if (saved.ranges) st.ranges = rangesFromCfg(saved.ranges);
    const ser = analysisSerRestore(saved.series, L); if (ser) st.series = ser;
  }
  const cfgOf = () => ({ series: analysisSerCfg(st.series), mode: st.mode, axis: st.axis, dd: st.dd, dip: st.dip, rake: st.rake, trend: st.trend, plunge: st.plunge,
    bandW: st.bandW, off: st.off, bars: st.bars, scope: st.scope, gradeUnit: st.gradeUnit, locate: st.locate, ranges: rangesForCfg(st.ranges) });
  const win = floatWin({ title: `swath · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 660), y: 120, w: 640, h: 440,
    onClose: () => { saveAnalysisCfg(L, 'swath', cfgOf(), win); setAnalysisOpen(L, 'swath', false); _swathWins.delete(L.id); if (st.zebra) clearSwathZebra(zebraL()); H.setSwathBand(null); removeEventListener('mouseup', onUp); } });
  setAnalysisOpen(L, 'swath', true);
  applyAnalysisGeo(L, 'swath', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const tabs = document.createElement('div'); tabs.className = 'sw-tabs';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:80px;display:block';
  main.append(tabs, cv); body.append(rail, main);
  const zebraL = () => layerById(st.series[0] && st.series[0].layerId) || L;
  const curDir = () => swathModeDirs(st)[st.axis] || swathModeDirs(st)[0];
  const rangeFor = () => (st.scan ? st.scan.range[st.axis] : projRange(zebraL(), curDir()));
  const autoWidth = () => { const [lo, hi] = rangeFor(); return Math.max(niceStep((hi - lo) / 25) || 1, 1e-6); };
  const effWidth = () => st.bandW[st.axis] || autoWidth();
  const effOffset = () => (st.off[st.axis] != null ? st.off[st.axis] : rangeFor()[0]);
  // render the cached spec + the hover/drag band strip (NO re-binning) — cheap
  // enough for mousemove. plotChart leaves its dpr transform on the context, so
  // the strip draws in CSS coords.
  const renderChart = () => {
    if (!st._plotSpec) { plotChart(cv, { series: [] }); st._map = null; win._spec = null; win.el._swathSpec = null; return; }
    st._map = plotChart(cv, st._plotSpec); win._spec = st._plotSpec; win.el._swathSpec = st._plotSpec;
    if (st._band && st._map) {
      const { px0, px1, py0, py1, xr } = st._map;
      const X = (x) => px0 + (px1 - px0) * (x - xr[0]) / (xr[1] - xr[0]);
      const x0 = Math.max(px0, Math.min(px1, X(st._band.a))), x1 = Math.max(px0, Math.min(px1, X(st._band.b)));
      const g = cv.getContext('2d'), col = st._band.sticky ? '#b48ead' : '#4a78b0';
      g.fillStyle = st._band.sticky ? 'rgba(180,142,173,0.16)' : 'rgba(74,120,176,0.12)';
      g.fillRect(x0, py1, Math.max(1, x1 - x0), py0 - py1);
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, py1); g.lineTo(x0, py0); g.moveTo(x1, py1); g.lineTo(x1, py0); g.stroke();
    }
  };
  // cheap replot from the existing scan (axis / band / offset / bars / zebra) —
  // no re-scan. Expensive changes (series / weight / filter / mode / scope) set
  // st.stale and wait for Run.
  const plot = () => {
    buildTabs();
    if (!st.scan) { win.sub.textContent = st.stale ? (saved ? 'restored — Run to compute' : 'configure, then Run') : ''; st._plotSpec = null; renderChart(); return; }
    const di = st.axis, bw = effWidth(), off = effOffset();
    const b = binSwath(st.scan, di, bw, off);
    if (!b.keys.length) { win.sub.textContent = 'no data in range'; st._plotSpec = null; renderChart(); return; }
    const multi = S.layers.length > 1 || st.series.length > 1;
    const gl = st.gradeUnit === 'pct' ? '%' : st.gradeUnit;
    const spec = { xLabel: `distance along ${st.scan.dirNames[di]}`, leftLabel: `mean grade${gl ? ` (${gl})` : ''}`, rightLabel: st.bars === 'tonnage' ? 'weight' : 'count', series: [], ...rangesOf(st) };
    const prim = b.out[0];
    spec.series.push({ name: st.bars, color: '#6a6f75', axis: 'right', kind: 'bar', data: b.keys.map((B) => { const e = prim.bands.get(B); return [off + (B + 0.5) * bw, e ? (st.bars === 'tonnage' ? e.sw : e.n) : 0]; }) });
    b.out.forEach((o) => { const Lx = layerById(o.se.s.layerId), f = gradeUnitFactor(o.se.s.unit, st.gradeUnit); const nm = multi ? `${(Lx ? (Lx.label || Lx.name) : '').replace(/\.[^.]*$/, '')}·${o.se.s.col}` : o.se.s.col; spec.series.push({ name: nm, color: o.se.s.color, axis: 'left', kind: 'line', data: b.keys.map((B) => { const e = o.bands.get(B); return [off + (B + 0.5) * bw, e && e.sw > 0 ? (e.swg / e.sw) * f : NaN]; }) }); });
    win.sub.textContent = `${st.scope !== 'all' ? st.scope + ' · ' : ''}${b.keys.length} bands · ${bw.toPrecision(3)} m · ${st.scan.series.reduce((s, x) => s + x.n, 0).toLocaleString()} rows`;
    st._plotSpec = spec; renderChart();
    if (st.zebra) applySwathZebra(zebraL(), curDir(), bw, off);
  };
  // ── hover/drag → the 3D band ghost (toggleable). Hover lights the bin under
  // the cursor; drag holds a band range (violet) and offers select-in-3D. ──
  if (st.locate == null) st.locate = true;
  const bandBbox = () => {
    let u = null;
    for (const s of st.series) { const Lx = layerById(s.layerId); const b2 = Lx && Lx.bboxLocal; if (!b2) continue; if (!u) u = Float64Array.from(b2); else for (let i = 0; i < 3; i++) { if (b2[i] < u[i]) u[i] = b2[i]; if (b2[i + 3] > u[i + 3]) u[i + 3] = b2[i + 3]; } }
    return u || H.rendererDocBbox();
  };
  const setBand = (a, b2, sticky) => {
    st._band = a == null ? null : { a, b: b2, sticky };
    renderChart();
    H.setSwathBand(a == null ? null : { a, b: b2, dir: curDir(), bbox: bandBbox(), sticky, label: `${fmtStat(a)} – ${fmtStat(b2)}` });
  };
  const tAt = (ev) => {
    const map = st._map; if (!map || !st.scan) return null;
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (mx < map.px0 || mx > map.px1 || my < map.py1 - 6 || my > map.py0 + 6) return null;
    return map.xr[0] + (mx - map.px0) / (map.px1 - map.px0) * (map.xr[1] - map.xr[0]);
  };
  let dragA = null, dragged = false;
  cv.addEventListener('mousemove', (ev) => {
    if (!st.locate || !st.scan) return;
    const t = tAt(ev), bw = effWidth(), off = effOffset();
    if (dragA != null) {
      if (t == null) return;
      dragged = true;
      const lo = Math.min(dragA, t), hi = Math.max(dragA, t);
      setBand(off + Math.floor((lo - off) / bw) * bw, off + Math.ceil((hi - off) / bw) * bw, true);   // snap to band edges
      return;
    }
    if (st._band && st._band.sticky) return;               // a held range stays until clicked away
    if (t == null) { if (st._band) setBand(null); return; }
    const B = Math.floor((t - off) / bw);
    setBand(off + B * bw, off + (B + 1) * bw, false);
  });
  cv.addEventListener('mouseleave', () => { if (st._band && !st._band.sticky) setBand(null); });
  cv.addEventListener('mousedown', (ev) => {
    if (!st.locate || !st.scan || ev.button !== 0) return;
    if (st._band && st._band.sticky) setBand(null);        // click releases a held range
    const t = tAt(ev); if (t == null) return;
    dragA = t; dragged = false; ev.preventDefault();
  });
  const onUp = (ev) => {
    if (dragA == null) return;
    const was = dragged; dragA = null; dragged = false;
    if (!was || !st._band) return;
    const { a, b: b2 } = st._band;
    H.menuXY(ev.clientX, ev.clientY, [
      { label: `Select rows in ${fmtStat(a)} – ${fmtStat(b2)}`, action: () => bandRangeSelect(a, b2, 'replace') },
      { label: 'Add to selection', action: () => bandRangeSelect(a, b2, 'add') },
      { label: 'Keep highlight', action: () => {} },
      { label: 'Clear', action: () => setBand(null) },
    ], () => {});                                          // dismiss keeps the ghost
  };
  addEventListener('mouseup', onUp);
  // materialize the held band range as a real 3D selection on every series layer
  const bandRangeSelect = async (a, b2, mode) => {
    const dir = curDir();
    const Ls = [...new Set(st.series.map((s) => s.layerId))].map(layerById)
      .filter((Lx) => { const h = layerTableHeader(Lx); return Lx && h && h.mapping && attrRowCountOf(Lx); });
    if (mode === 'replace') H.clearSelection({ silent: true });
    for (const Lx of Ls) {
      const h = layerTableHeader(Lx), m = h.mapping, n = attrRowCountOf(Lx);
      if (!Lx._selMask || Lx._selMask.length !== n) Lx._selMask = new Uint8Array(n);
      win.sub.textContent = `selecting in ${Lx.label || Lx.name}…`;
      let seen = 0;                                       // layerRecords owns the record number (see scanGT)
      for await (const { f, rec: rr } of layerRecords(Lx)) {
        const x = coordNum(f[m.x]), y = coordNum(f[m.y]), z = coordNum(f[m.z]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          const t = x * dir[0] + y * dir[1] + z * dir[2];
          if (t >= a && t < b2 && rr < n) Lx._selMask[rr] = 1;
        }
        if (((++seen) & 0xffff) === 0) await new Promise((r2) => setTimeout(r2));
      }
      H.applyLayerSelection(Lx);
    }
    H.selectionStatus(); H.markProjectDirty(); H.requestRender();
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };
  const run = async () => {
    if (st.running) return;
    if (st.scope !== 'all' && !st.series.some((s) => { const Lx = layerById(s.layerId); return Lx && scopeMask(st, Lx); })) {
      win.sub.textContent = scopeMissing(st, zebraL()) || `no layer carries a ${st.scope} mask`; return;
    }
    st.running = true; win.sub.textContent = 'scanning…';
    const rc = runCancellable(runBtn);
    try { st.scan = await scanSwath(st, (n, N, w) => { progEl.textContent = scanProgressText(n, N, w); }, rc.signal); }
    catch (e) { win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `swath: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    if (st.scan) win.el._scanWhere = st.scan.where;
    if (!st.scan) { win.sub.textContent = 'no series to scan'; plotChart(cv, { series: [] }); return; }
    saveAnalysisCfg(L, 'swath', cfgOf(), win);             // a successful Run snapshots the setup into the project
    plot();
  };
  // copy the computed numbers: band center | count | weight | per-series mean (TSV)
  const tableTSV = () => {
    if (!st.scan) return null;
    const di = st.axis, bw = effWidth(), off = effOffset();
    const b = binSwath(st.scan, di, bw, off);
    if (!b.keys.length) return null;
    const gl = st.gradeUnit === 'pct' ? '%' : st.gradeUnit;
    const multi = st.series.length > 1;
    const names = b.out.map((o) => { const Lx = layerById(o.se.s.layerId); return multi ? `${(Lx ? (Lx.label || Lx.name) : '').replace(/\.[^.]*$/, '')}·${o.se.s.col}` : o.se.s.col; });
    const head = [`center along ${st.scan.dirNames[di]}`, 'count', 'weight', ...names.map((nm) => `${nm} mean${gl ? ` (${gl})` : ''}`)];
    const prim = b.out[0];
    const lines = [head.join('\t')];
    for (const B of b.keys) {
      const e0 = prim.bands.get(B);
      const row = [off + (B + 0.5) * bw, e0 ? e0.n : 0, e0 ? e0.sw : 0];
      for (const o of b.out) { const f = gradeUnitFactor(o.se.s.unit, st.gradeUnit); const e = o.bands.get(B); row.push(e && e.sw > 0 ? (e.swg / e.sw) * f : ''); }
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  };
  function buildTabs() {
    tabs.textContent = '';
    const names = st.scan ? st.scan.dirNames : swathDirNames(st);
    if (names.length < 2) return;
    names.forEach((nm, i) => { const t = document.createElement('button'); t.className = 'sw-tab' + (st.axis === i ? ' on' : ''); t.textContent = nm.split(' ')[0]; t.title = nm; t.onclick = () => { st.axis = i; buildRail(); plot(); }; tabs.append(t); });   // buildRail: band width/offset are per-direction
  }
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
    mid.append(colSel, gradeUnitSel(s.unit || '', (v) => { s.unit = v; if (st.scan) plot(); }, 'declared unit of THIS series — converts into the plot unit when both are declared (display-time, no re-scan)'));
    box.append(mid);
    const wIn = document.createElement('input'); wIn.className = 'sw-in'; wIn.type = 'text'; wIn.placeholder = 'weight expr (blank = support)'; wIn.value = s.weight; wIn.title = 'weight expression (@gcu/expr) — blank = block volume (regular grid) or 1. e.g. SG, SG*PARTIAL, DECLUSTER'; wIn.onchange = () => { s.weight = wIn.value.trim(); markStale(); }; box.append(wIn);
    const fIn = document.createElement('input'); fIn.className = 'sw-in'; fIn.type = 'text'; fIn.placeholder = 'filter (optional)'; fIn.value = s.filter; fIn.title = 'row filter for THIS series (@gcu/expr) — e.g. ROCK == 2'; fIn.onchange = () => { s.filter = fIn.value.trim(); markStale(); }; box.append(fIn);
    return box;
  };
  function buildRail() {
    rail.textContent = '';
    // ── Direction ──
    const dSec = document.createElement('div');
    dSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'direction' }));
    const modeSel = document.createElement('select'); modeSel.className = 'sw-sel'; modeSel.style.width = '100%';
    for (const [v, t] of [['axes', 'axes X / Y / Z'], ['oriented', 'dip-dir / dip / rake'], ['direction', 'trend / plunge']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; modeSel.append(o); }
    modeSel.value = st.mode; modeSel.onchange = () => { st.mode = modeSel.value; st.axis = 0; markStale(); buildRail(); buildTabs(); }; dSec.append(modeSel);
    const numRow = (key, label) => { const r = document.createElement('div'); r.className = 'sw-row'; const l = document.createElement('span'); l.textContent = label; l.style.width = '38px'; const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.className = 'sw-in'; inp.value = String(st[key]); inp.onchange = () => { st[key] = +inp.value; markStale(); }; r.append(l, inp); return r; };
    if (st.mode === 'oriented') { dSec.append(numRow('dd', 'dipdir'), numRow('dip', 'dip'), numRow('rake', 'rake')); }
    if (st.mode === 'direction') { dSec.append(numRow('trend', 'trend'), numRow('plunge', 'plunge')); }
    rail.append(dSec);
    // ── Bands (cheap: re-bin, no re-scan) — width + offset are PER DIRECTION ──
    const bSec = document.createElement('div');
    const dirNm = (st.scan ? st.scan.dirNames : swathDirNames(st))[st.axis] || '';
    bSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: `bands · ${dirNm.split(' ')[0]}` }));
    const bwRow = document.createElement('div'); bwRow.className = 'sw-row'; const bwL = document.createElement('span'); bwL.textContent = 'width'; bwL.style.width = '38px';
    const bwI = document.createElement('input'); bwI.type = 'number'; bwI.step = 'any'; bwI.className = 'sw-in'; bwI.placeholder = 'auto'; bwI.value = st.bandW[st.axis] ? String(+st.bandW[st.axis].toPrecision(4)) : ''; bwI.title = `band width (m) along ${dirNm} — blank = auto; each direction keeps its own`; bwI.onchange = () => { st.bandW[st.axis] = bwI.value === '' ? null : (+bwI.value || null); if (st.scan) plot(); }; bwRow.append(bwL, bwI); bSec.append(bwRow);
    const offRow = document.createElement('div'); offRow.className = 'sw-row'; const offL = document.createElement('span'); offL.textContent = 'offset'; offL.style.width = '38px';
    const offI = document.createElement('input'); offI.type = 'number'; offI.step = 'any'; offI.className = 'sw-in'; offI.placeholder = 'auto'; offI.value = st.off[st.axis] != null ? String(+st.off[st.axis].toPrecision(6)) : ''; offI.title = `where band 0 aligns along ${dirNm} — blank = auto; each direction keeps its own`; offI.onchange = () => { st.off[st.axis] = offI.value === '' ? null : +offI.value; if (st.scan) plot(); }; offRow.append(offL, offI); bSec.append(offRow);
    rail.append(bSec);
    // ── Series ──
    const sSec = document.createElement('div');
    sSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'series' }));
    const list = document.createElement('div'); list.className = 'sw-series';
    st.series.forEach((s, i) => list.append(seriesRow(s, i))); sSec.append(list);
    const add = document.createElement('button'); add.className = 'sw-add'; add.textContent = '+ add series';
    add.onclick = () => { const c = numericColsOf(L)[0]; st.series.push(mkSer(L, c, st.series.length)); markStale(); buildRail(); }; sSec.append(add);
    rail.append(sSec);
    // ── Display ──
    const vSec = document.createElement('div');
    vSec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'display' }));
    const barRow = document.createElement('div'); barRow.className = 'sw-row'; const barL = document.createElement('span'); barL.textContent = 'bars';
    const barSel = document.createElement('select'); barSel.className = 'sw-sel'; for (const [v, t] of [['count', 'count'], ['tonnage', 'weight']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; barSel.append(o); } barSel.value = st.bars; barSel.onchange = () => { st.bars = barSel.value; if (st.scan) plot(); }; barRow.append(barL, barSel); vSec.append(barRow);
    // plot unit — the axis target; series with a declared unit convert into it
    const guRow = document.createElement('div'); guRow.className = 'sw-row'; const guL = document.createElement('span'); guL.textContent = 'unit';
    const guSel = gradeUnitSel(st.gradeUnit, (v) => { st.gradeUnit = v; const Lz = zebraL(); Lz.gtUnits = { ...(Lz.gtUnits || {}), grade: st.gradeUnit }; H.markProjectDirty(); if (st.scan) plot(); }, 'plot unit — the mean-grade axis (shared with grade-tonnage); series with a declared unit convert into it');
    guSel.classList.add('sw-unit-plot');
    guRow.append(guL, guSel); vSec.append(guRow);
    // locate: hover the plot → the band's slab lights on the 3D; drag → hold a range
    const locRow = document.createElement('div'); locRow.className = 'sw-row';
    const lc = document.createElement('input'); lc.type = 'checkbox'; lc.checked = st.locate; lc.id = 'sw-loc-' + L.id;
    const ll = document.createElement('label'); ll.setAttribute('for', lc.id); ll.textContent = 'locate on 3D'; ll.title = 'hover the plot to light that band on the 3D; drag a range to hold it, then right there turn it into a selection';
    lc.onchange = () => { st.locate = lc.checked; if (!st.locate) setBand(null); };
    locRow.append(lc, ll); vSec.append(locRow);
    const zRow = document.createElement('div'); zRow.className = 'sw-row'; const zc = document.createElement('input'); zc.type = 'checkbox'; zc.checked = st.zebra; zc.id = 'sw-zebra-' + L.id; const zl = document.createElement('label'); zl.setAttribute('for', zc.id); zl.textContent = 'zebra on 3D'; zl.title = 'stripe alternate bands on the 3D view'; zc.onchange = () => { if (zc.checked && !gridAxesOf(zebraL())) { win.sub.textContent = 'zebra needs a regular model as the first series'; zc.checked = false; return; } st.zebra = zc.checked; if (st.zebra && st.scan) applySwathZebra(zebraL(), curDir(), effWidth(), effOffset()); else clearSwathZebra(zebraL()); }; zRow.append(zc, zl); vSec.append(zRow);
    const scRow = document.createElement('div'); scRow.className = 'sw-row'; const scL = document.createElement('span'); scL.textContent = 'scope';
    const seg = document.createElement('div'); seg.className = 'sw-seg'; seg.title = 'all rows · rows matching each layer\'s current filter · the 3D selection';
    for (const [v, t] of [['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']]) { const bt = document.createElement('button'); bt.className = 'sw-segbtn' + (st.scope === v ? ' on' : ''); bt.textContent = t; bt.onclick = () => { st.scope = v; markStale(); buildRail(); }; seg.append(bt); } scRow.append(scL, seg); vSec.append(scRow);
    // manual plot ranges (display-only — re-plots from the scan)
    vSec.append(rangesRow(st, () => { if (st.scan) plot(); }, { x: 'x', l: 'grade', r: 'bars' }));
    rail.append(vSec);
    // ── Footer: Run + save-as-recipe + stale + progress ──
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => H.saveRecipe('swath', cfgOf(), `${(L.label || L.name).replace(/\.[^.]+$/, '')} swath`);
    const resRow = plotExportBtns(cv, () => `swath-${(zebraL().label || zebraL().name).replace(/\.[^.]+$/, '')}-${(st.scan ? st.scan.dirNames : swathDirNames(st))[st.axis].split(' ')[0].replace(/[^\w-]/g, '')}.png`, tableTSV, 'swaths');
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, staleEl, progEl); rail.append(foot);
  }
  _swathWins.set(L.id, { win, redraw: run, st });          // refreshLinkedWindows gates on the scope kind
  buildRail(); buildTabs(); plot();
  if (ropts && ropts.run) run();
}

// zebra: paint alternate swath bands as a 2-value column, coloured on the 3D.
// The colour switch is TEMPORARY — the layer's own colour is remembered and
// comes back when zebra clears.
export async function applySwathZebra(L, dir, bandWidth, offset) {
  const h = layerTableHeader(L), m = h.mapping;
  if (H.paintSelOf(L) !== '_swath') L._preZebraSel = L.colorSel;
  let col = H.paintColByName(L, '_swath'); if (!col) { col = H.createPaintCol(L, '_swath'); if (!col) return; }
  while (col.dict.length < 3) H.addPaintValue(L, col, col.dict.length === 1 ? 'band A' : 'band B');
  col.colors[1] = '#3a3f45'; col.colors[2] = '#c8c2b0';
  const codes = col.codes;
  for await (const { f, rec } of layerRecords(L)) {        // records, not rows: stripes stay on their own blocks after a dropped row
    const x = coordNum(f[m.x]), y = coordNum(f[m.y]), z = coordNum(f[m.z]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && rec < codes.length) { const bi = Math.floor((x * dir[0] + y * dir[1] + z * dir[2] - offset) / bandWidth); codes[rec] = (bi & 1) ? 1 : 2; }
  }
  paintRecount(col); col._swathParity = true;
  H.applyPaintPalette && H.setLayerColorSel(L, 'paint:_swath');
  const t2 = H._attrTables.get(L.id); if (t2 && t2.invalidate) t2.invalidate();
  H.requestRender();
}

export function clearSwathZebra(L) {
  const i = (L.paintCols || []).findIndex((c) => c.name === '_swath');
  if (i >= 0) { L.paintCols.splice(i, 1); if (H.paintSelOf(L) === '_swath') H.setLayerColorSel(L, L._preZebraSel && L._preZebraSel !== 'paint:_swath' ? L._preZebraSel : 'elev'); L._preZebraSel = null; H.addPaintColorOptions(L); H.requestRender(); }
}
