// micro scatter + Q-Q — two columns against each other.
// SCATTER: one layer, x against y, at any size: a density of counts on a fixed
//   grid (exact points while there are few enough), log axes on request, the
//   correlation on the plotted axes. Two passes — the ranges (the stats scan),
//   then the pairs (@gcu/scan's scatter kernel; the row path where the layer
//   has no columnar reader).
// Q-Q: two SIDES, each a layer + column + filter + scope — model against model,
//   model against the drillholes, one domain against another — their quantiles
//   from the stats scan's digests, plotted against each other with the 1:1 line.
// Like the other analysis windows: a rail, Run, a sticky foot (png · copy ·
// layer · table), the setup saved with the project.
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileValue, quoteIdent } from '../../../ext/expr/index.js';
import { quantileFromCentroids } from '../../../ext/sluice/index.js';
import { numericColsOf } from './analysis.js';
import { applyAnalysisGeo, checkAbort, fmtStat, niceStep, plotExportBtns, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, setAnalysisOpen } from './analysis-ui.js';
import { floatWin, nextZ } from './windows.js';
import { canScanColumnar, scanColumnar, zoneKeeper } from './colscan.js';
import { scatterAccumulator, scatterAdd, scatterMerge, scatterR } from './scanner.js';
import { statsScan } from './stats.js';
import { S, layerById } from './state.js';
const $ = (s) => document.querySelector(s);
export const _xyWins = new Map();
const BINS = 160, KEEP = 20000;
const QQ_P = [0.005, ...Array.from({ length: 99 }, (_, i) => (i + 1) / 100), 0.995];

// ── the plot: axes (linear or log10), then density cells, points or Q-Q marks ──
// spec = { xr, yr (plotted units), logX, logY, xLabel, yLabel, heat: { grid, B } |
//   points: [x, y, …] | qq: [[x, y]…], line11, color }
function drawXY(cv, spec) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 400, Hh = cv.clientHeight || 300;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const dim = '#8a8f95', grid = 'rgba(140,145,150,0.16)';
  if (!spec) { g.fillStyle = dim; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText('press Run', W / 2, Hh / 2); return null; }
  const mL = 56, mR = 14, mT = 12, mB = 32;
  const px0 = mL, px1 = W - mR, py0 = Hh - mB, py1 = mT;
  const { xr, yr } = spec;
  const sx = (u) => px0 + (px1 - px0) * (u - xr[0]) / (xr[1] - xr[0] || 1);
  const sy = (v) => py0 + (py1 - py0) * (v - yr[0]) / (yr[1] - yr[0] || 1);
  // ticks: linear by a nice step; log at each decade (and 2, 5 when few decades)
  const ticks = (lo, hi, log) => {
    if (!log) { const st = niceStep((hi - lo) / 5) || 1, o = []; for (let v = Math.ceil(lo / st) * st; v <= hi + st * 1e-6; v += st) o.push([v, fmtStat(v)]); return o; }
    const o = [], few = hi - lo < 3;
    for (let d = Math.floor(lo); d <= Math.ceil(hi); d++) for (const m of few ? [1, 2, 5] : [1]) { const u = d + Math.log10(m); if (u >= lo - 1e-9 && u <= hi + 1e-9) o.push([u, fmtStat(10 ** u)]); }
    return o;
  };
  g.font = '10px monospace'; g.lineWidth = 1;
  g.textAlign = 'center';
  for (const [u, t] of ticks(xr[0], xr[1], spec.logX)) { const X = sx(u); g.strokeStyle = grid; g.beginPath(); g.moveTo(X, py0); g.lineTo(X, py1); g.stroke(); g.fillStyle = dim; g.fillText(t, X, py0 + 12); }
  g.textAlign = 'right';
  for (const [v, t] of ticks(yr[0], yr[1], spec.logY)) { const Y = sy(v); g.strokeStyle = grid; g.beginPath(); g.moveTo(px0, Y); g.lineTo(px1, Y); g.stroke(); g.fillStyle = dim; g.fillText(t, px0 - 4, Y + 3); }
  g.save(); g.beginPath(); g.rect(px0, py1, px1 - px0, py0 - py1); g.clip();
  if (spec.heat) {
    const { grid: cnt, B } = spec.heat; let mx = 0; for (const c of cnt) if (c > mx) mx = c;
    const lm = Math.log(1 + mx) || 1, cw = (px1 - px0) / B, ch = (py0 - py1) / B;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const c = cnt[j * B + i]; if (!c) continue;
      const t = Math.log(1 + c) / lm;                       // log counts: the sparse tail stays visible
      g.fillStyle = `hsl(${220 - 180 * t}, 70%, ${28 + 40 * t}%)`;
      g.fillRect(px0 + i * cw, py0 - (j + 1) * ch, Math.ceil(cw), Math.ceil(ch));
    }
  }
  const U = (x) => (spec.logX ? Math.log10(x) : x), V = (y) => (spec.logY ? Math.log10(y) : y);
  if (spec.points) {
    g.fillStyle = spec.color || '#5b7fa6'; g.globalAlpha = spec.points.length > 4000 ? 0.35 : 0.7;
    for (let k = 0; k < spec.points.length; k += 2) { const x = spec.points[k], y = spec.points[k + 1]; if ((spec.logX && !(x > 0)) || (spec.logY && !(y > 0))) continue; g.fillRect(sx(U(x)) - 1, sy(V(y)) - 1, 2.4, 2.4); }
    g.globalAlpha = 1;
  }
  if (spec.line11) {
    const lo = Math.max(xr[0], yr[0]), hi = Math.min(xr[1], yr[1]);
    if (hi > lo) { g.strokeStyle = 'rgba(200,155,60,0.8)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(sx(lo), sy(lo)); g.lineTo(sx(hi), sy(hi)); g.stroke(); g.setLineDash([]); }
  }
  if (spec.qq) {
    g.strokeStyle = spec.color || '#5b7fa6'; g.fillStyle = spec.color || '#5b7fa6'; g.lineWidth = 1.4;
    g.beginPath(); let on = false;
    for (const [x, y] of spec.qq) { if ((spec.logX && !(x > 0)) || (spec.logY && !(y > 0))) { on = false; continue; } const X = sx(U(x)), Y = sy(V(y)); if (!on) { g.moveTo(X, Y); on = true; } else g.lineTo(X, Y); }
    g.stroke();
    for (const [x, y, mark] of spec.qq) { if (!mark || (spec.logX && !(x > 0)) || (spec.logY && !(y > 0))) continue; g.beginPath(); g.arc(sx(U(x)), sy(V(y)), 3, 0, 2 * Math.PI); g.fill(); }
  }
  g.restore();
  g.fillStyle = dim; g.textAlign = 'center';
  if (spec.xLabel) g.fillText(spec.xLabel + (spec.logX ? ' (log)' : ''), (px0 + px1) / 2, Hh - 4);
  if (spec.yLabel) { g.save(); g.translate(11, (py0 + py1) / 2); g.rotate(-Math.PI / 2); g.fillText(spec.yLabel + (spec.logY ? ' (log)' : ''), 0, 0); g.restore(); }
  return { px0, px1, py0, py1 };
}

// a range in plotted units: [min, max], or for a log axis the smallest positive
// value the digest knows of (min itself when > 0)
function axisRange(row, log) {
  if (!row || !row.n) return null;
  if (!log) return row.min < row.max ? [row.min, row.max] : [row.min - 0.5, row.max + 0.5];
  if (!(row.max > 0)) return null;
  let lo = row.min > 0 ? row.min : NaN;
  if (!(lo > 0)) for (const p of [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75]) { const v = quantileFromCentroids(row.centroids, row.count, p); if (v > 0) { lo = v; break; } }
  if (!(lo > 0)) lo = row.max / 1000;
  const a = Math.log10(lo), b = Math.log10(row.max);
  return a < b ? [a, b] : [a - 0.5, b + 0.5];
}

export function openXyPlot(L, ropts) {
  if (!L || !layerTableHeader(L)) { $('#meta').textContent = 'scatter / Q-Q: needs a table-backed layer'; return null; }
  const ex = _xyWins.get(L.id); if (ex) { if (!ropts) { ex.win.el.style.zIndex = nextZ(); return ex; } ex.win.close(); }
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'scatter / Q-Q: no numeric column'; return null; }
  const side = (Lx, col) => ({ layerId: Lx.id, col, filter: '', scope: 'all' });
  const st = { mode: 'scatter', x: nums[0], y: nums[1] || nums[0], filter: '', scope: 'all', logX: false, logY: false, line11: false,
    a: side(L, nums[0]), b: side(L, nums[1] || nums[0]), qqLog: false, scan: null, stale: true, running: false };
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.xy);
  if (saved) {
    for (const k of ['mode', 'x', 'y', 'filter', 'scope', 'logX', 'logY', 'line11', 'qqLog']) if (saved[k] != null) st[k] = saved[k];
    for (const k of ['a', 'b']) if (saved[k]) { const Lx = S.layers.find((q) => q.name === saved[k].layer) || L; st[k] = { layerId: Lx.id, col: saved[k].col, filter: saved[k].filter || '', scope: saved[k].scope || 'all' }; }
  }
  const sideCfg = (s) => { const Lx = layerById(s.layerId); return { layer: Lx ? Lx.name : null, col: s.col, filter: s.filter, scope: s.scope }; };
  const cfgOf = () => ({ mode: st.mode, x: st.x, y: st.y, filter: st.filter, scope: st.scope, logX: st.logX, logY: st.logY, line11: st.line11, qqLog: st.qqLog, a: sideCfg(st.a), b: sideCfg(st.b) });
  const win = floatWin({ title: `scatter / Q-Q · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 760), y: 100, w: 720, h: 500,
    onClose: () => { saveAnalysisCfg(L, 'xy', cfgOf(), win); setAnalysisOpen(L, 'xy', false); _xyWins.delete(L.id); } });
  setAnalysisOpen(L, 'xy', true);
  applyAnalysisGeo(L, 'xy', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:120px;display:block';
  const notes = document.createElement('div'); notes.className = 'xy-notes';
  main.append(cv, notes); body.append(rail, main);
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };

  const plot = () => {
    notes.textContent = '';
    const sc = st.scan;
    if (!sc || sc.mode !== st.mode) { drawXY(cv, null); win.el._xy = null; return; }
    if (sc.mode === 'scatter') {
      const spec = { xr: sc.range.slice(0, 2), yr: sc.range.slice(2), logX: sc.logX, logY: sc.logY, xLabel: sc.x, yLabel: sc.y, line11: st.line11 };
      if (sc.acc.over) spec.heat = { grid: sc.acc.grid, B: BINS }; else spec.points = sc.acc.pts;
      drawXY(cv, spec);
      const r = scatterR(sc.acc.m);
      notes.textContent = `n ${sc.acc.n.toLocaleString()} · r ${Number.isFinite(r) ? r.toFixed(3) : '–'}${sc.logX || sc.logY ? ' (on the log axes)' : ''} · ${sc.acc.over ? `density of ${BINS}×${BINS} cells (log counts)` : 'every pair drawn'}${sc.acc.offLog ? ` · ${sc.acc.offLog.toLocaleString()} pair${sc.acc.offLog === 1 ? '' : 's'} ≤ 0 left off the log axis` : ''}`;
      win.sub.textContent = `scatter${st.scope !== 'all' ? ' · ' + st.scope : ''}${st.filter ? ' · filtered' : ''}`;
      win.el._xy = { mode: 'scatter', n: sc.acc.n, r, over: sc.acc.over, pts: sc.acc.pts.length / 2, offLog: sc.acc.offLog, grid: sc.acc.grid, range: sc.range };
    } else {
      const qa = sc.qa, qb = sc.qb, all = [...qa, ...qb].filter((v) => !st.qqLog || v > 0);
      if (!all.length) { drawXY(cv, null); return; }
      const T = (v) => (st.qqLog ? Math.log10(v) : v);
      let lo = Math.min(...all.map(T)), hi = Math.max(...all.map(T)); if (lo === hi) { lo -= 0.5; hi += 0.5; }
      const qq = QQ_P.map((p, i) => [qa[i], qb[i], [0.1, 0.25, 0.5, 0.75, 0.9].some((m) => Math.abs(m - p) < 1e-9)]);
      drawXY(cv, { xr: [lo, hi], yr: [lo, hi], logX: st.qqLog, logY: st.qqLog, xLabel: sc.labelA, yLabel: sc.labelB, line11: true, qq });
      const at = (q, p) => q[QQ_P.findIndex((x) => Math.abs(x - p) < 1e-9)];
      const ratio = (p) => { const a = at(qa, p), b = at(qb, p); return a ? fmtStat(b / a) : '–'; };
      notes.textContent = `n ${sc.na.toLocaleString()} vs ${sc.nb.toLocaleString()} · mean ${fmtStat(sc.ma)} vs ${fmtStat(sc.mb)} · P10/P50/P90 ratio (y/x) ${ratio(0.1)} / ${ratio(0.5)} / ${ratio(0.9)} · dots at P10 P25 P50 P75 P90`;
      win.sub.textContent = 'Q-Q · quantiles unweighted';
      win.el._xy = { mode: 'qq', qa, qb, na: sc.na, nb: sc.nb };
    }
  };
  win.el._onResized = () => plot();

  const scanScatter = async (onProgress, signal) => {
    const h = layerTableHeader(L), schema = schemaExt(L, h), mask = scopeMask(st, L), filter = (st.filter || '').trim() || null;
    const N = attrRowCountOf(L) || 0;
    // pass 1: the ranges (and the digests a log axis needs)
    const s1 = await statsScan(L, { cols: [st.x, st.y], groupBy: null, weight: null, filter }, mask, (d, n2, w) => onProgress(Math.floor(d / 2), N, w), signal);
    const row = (c) => s1.rows.find((r) => r.col === c);
    const rx = axisRange(row(st.x), st.logX), ry = axisRange(row(st.y), st.logY);
    if (!rx || !ry) throw new Error(st.logX || st.logY ? 'nothing positive to put on a log axis' : 'no pairs with both values');
    const p = { bins: BINS, keep: KEEP, range: [...rx, ...ry], logX: st.logX, logY: st.logY };
    // pass 2: the pairs
    let acc;
    if (canScanColumnar(L)) {
      const params = { ...p, x: quoteIdent(st.x), y: quoteIdent(st.y), filter };
      const { parts } = await scanColumnar(L, { kernel: 'scatter', params, exprs: [params.x, params.y, filter], mask, signal, keepZone: zoneKeeper(L, { mask }),
        onProgress: (d, n2, w) => onProgress(Math.floor(N / 2 + d / 2), N, w) });
      acc = scatterMerge(parts, p);
    } else {
      const fx = compileValue(quoteIdent(st.x), schema, { decimal: '.' }), fy = compileValue(quoteIdent(st.y), schema, { decimal: '.' });
      const ff = filter ? compileBool(filter, schema, { decimal: '.' }) : null;
      acc = scatterAccumulator(p); let seen = 0;
      for await (const { f: r, rec } of layerRecords(L)) {
        seen++; if ((seen & 0xffff) === 0) { checkAbort(signal); onProgress(Math.floor(N / 2 + seen / 2), N, 'on this page'); await new Promise((z) => setTimeout(z)); }
        if (mask && !(rec < mask.length && mask[rec])) continue;
        if (ff && !ff(r)) continue;
        const x = numOf(fx(r)), y = numOf(fy(r));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        scatterAdd(acc, p, x, y);
      }
    }
    return { mode: 'scatter', x: st.x, y: st.y, logX: st.logX, logY: st.logY, range: p.range, acc };
  };
  const scanQq = async (onProgress, signal) => {
    const one = async (s, k) => {
      const Lx = layerById(s.layerId); if (!Lx) throw new Error(`side ${k}: the layer is gone`);
      const mask = s.scope === 'all' ? null : scopeMask(s, Lx);
      if (s.scope !== 'all' && !mask) throw new Error(`side ${k}: ${scopeMissing(s, Lx) || 'no ' + s.scope}`);
      const res = await statsScan(Lx, { cols: [s.col], groupBy: null, weight: null, filter: (s.filter || '').trim() || null }, mask, onProgress, signal);
      const r = res.rows[0]; if (!r || !r.n) throw new Error(`side ${k}: no values`);
      return { q: QQ_P.map((p) => quantileFromCentroids(r.centroids, r.count, p)), n: r.n, mean: r.mean, label: `${s.col} · ${(Lx.label || Lx.name).replace(/\.[^.]+$/, '')}${s.filter ? ' · ' + s.filter : ''}` };
    };
    const A = await one(st.a, 'x'), B = await one(st.b, 'y');
    return { mode: 'qq', qa: A.q, qb: B.q, na: A.n, nb: B.n, ma: A.mean, mb: B.mean, labelA: A.label, labelB: B.label };
  };
  const run = async () => {
    if (st.running) return;
    if (st.mode === 'scatter' && st.scope !== 'all' && !scopeMask(st, L)) { win.sub.textContent = scopeMissing(st, L) || `no ${st.scope} on this layer`; return; }
    st.running = true; win.sub.textContent = 'scanning…';
    const rc = runCancellable(runBtn);
    try { st.scan = await (st.mode === 'scatter' ? scanScatter : scanQq)((d, N, w) => { progEl.textContent = scanProgressText(d, N, w); }, rc.signal); }
    catch (e) { win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `${st.mode}: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    saveAnalysisCfg(L, 'xy', cfgOf(), win);
    plot();
  };
  // the numbers: Q-Q → p · x quantile · y quantile; scatter → the non-empty cells
  // (x from–to, y from–to, count) or, when every pair is kept, the pairs
  const tableTSV = () => {
    const sc = st.scan; if (!sc || sc.mode !== st.mode) return null;
    if (sc.mode === 'qq') return ['p\t' + sc.labelA + '\t' + sc.labelB, ...QQ_P.map((p, i) => `${p}\t${sc.qa[i]}\t${sc.qb[i]}`)].join('\n');
    if (!sc.acc.over) { const o = [`${sc.x}\t${sc.y}`]; for (let k = 0; k < sc.acc.pts.length; k += 2) o.push(`${sc.acc.pts[k]}\t${sc.acc.pts[k + 1]}`); return o.join('\n'); }
    const [x0, x1, y0, y1] = sc.range, ex = (u, l) => (l ? 10 ** u : u), o = [`${sc.x} from\t${sc.x} to\t${sc.y} from\t${sc.y} to\tcount`];
    for (let j = 0; j < BINS; j++) for (let i = 0; i < BINS; i++) {
      const c = sc.acc.grid[j * BINS + i]; if (!c) continue;
      const ua = x0 + (x1 - x0) * i / BINS, ub = x0 + (x1 - x0) * (i + 1) / BINS, va = y0 + (y1 - y0) * j / BINS, vb = y0 + (y1 - y0) * (j + 1) / BINS;
      o.push([ex(ua, sc.logX), ex(ub, sc.logX), ex(va, sc.logY), ex(vb, sc.logY), c].join('\t'));
    }
    return o.join('\n');
  };

  // ── the rail ──
  const row = (label, el, title) => { const r = document.createElement('div'); r.className = 'sw-row'; if (title) r.title = title; const s = document.createElement('span'); s.textContent = label; s.style.width = '44px'; r.append(s, el); return r; };
  const sel = (opts, val, on) => { const s = document.createElement('select'); s.className = 'sw-sel'; for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); } s.value = val; s.onchange = () => on(s.value); return s; };
  const inp = (val, ph, on) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'text'; i.value = val; i.placeholder = ph; i.onchange = () => on(i.value.trim()); return i; };
  const seg = (opts, val, on) => { const d = document.createElement('div'); d.className = 'sw-seg'; for (const [v, t] of opts) { const b = document.createElement('button'); b.className = 'sw-segbtn' + (val === v ? ' on' : ''); b.textContent = t; b.onclick = () => on(v); d.append(b); } return d; };
  const chk = (label, val, on, title) => { const l = document.createElement('label'); l.className = 'sw-row'; if (title) l.title = title; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = val; c.onchange = () => on(c.checked); l.append(c, ' ' + label); return l; };
  const sideBox = (s, name) => {
    const box = document.createElement('div'); box.className = 'sw-ser';
    const top = document.createElement('div'); top.className = 'sw-ser-top';
    const lab = document.createElement('b'); lab.textContent = name; lab.style.cssText = 'font:11px monospace;color:var(--accent);width:14px';
    const layers = S.layers.filter((x) => layerTableHeader(x) && numericColsOf(x).length);
    const lS = sel(layers.map((x) => [String(x.id), x.label || x.name]), String(s.layerId), (v) => { s.layerId = +v; const cols = numericColsOf(layerById(s.layerId)); if (!cols.includes(s.col)) s.col = cols[0]; markStale(); buildRail(); });
    top.append(lab, lS); box.append(top);
    box.append(sel(numericColsOf(layerById(s.layerId) || L).map((c) => [c, c]), s.col, (v) => { s.col = v; markStale(); }));
    box.append(inp(s.filter, 'filter (optional)', (v) => { s.filter = v; markStale(); }));
    box.append(seg([['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']], s.scope, (v) => { s.scope = v; markStale(); buildRail(); }));
    return box;
  };
  function buildRail() {
    rail.textContent = '';
    const top = document.createElement('div');
    top.append(seg([['scatter', 'scatter'], ['qq', 'Q-Q']], st.mode, (v) => { st.mode = v; buildRail(); plot(); }));
    rail.append(top);
    const sec = document.createElement('div');
    if (st.mode === 'scatter') {
      sec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'pairs' }));
      const cols = nums.map((c) => [c, c]);
      sec.append(row('x', sel(cols, st.x, (v) => { st.x = v; markStale(); })), row('y', sel(cols, st.y, (v) => { st.y = v; markStale(); })));
      sec.append(row('filter', inp(st.filter, 'optional', (v) => { st.filter = v; markStale(); }), 'rows to plot (@gcu/expr) — e.g. ROCK == "ox"'));
      sec.append(row('scope', seg([['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']], st.scope, (v) => { st.scope = v; buildRail(); run(); })));
      sec.append(chk('log x', st.logX, (v) => { st.logX = v; markStale(); }), chk('log y', st.logY, (v) => { st.logY = v; markStale(); }), chk('1:1 line', st.line11, (v) => { st.line11 = v; plot(); }, 'for two grades in the same unit'));
    } else {
      sec.append(Object.assign(document.createElement('div'), { className: 'sw-h', textContent: 'sides' }));
      sec.append(sideBox(st.a, 'x'), sideBox(st.b, 'y'));
      sec.append(chk('log axes', st.qqLog, (v) => { st.qqLog = v; plot(); }));
    }
    rail.append(sec);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, plotExportBtns(cv, () => `${st.mode}-${(L.label || L.name).replace(/\.[^.]+$/, '')}.png`, tableTSV, st.mode === 'qq' ? 'q-q' : 'scatter'), staleEl, progEl);
    rail.append(foot);
  }
  const handle = { win, st, run, tableTSV, redraw: run };
  _xyWins.set(L.id, handle);
  buildRail(); plot();
  if (ropts && ropts.run) run();
  return handle;
}
