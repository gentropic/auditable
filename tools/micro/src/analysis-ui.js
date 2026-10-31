// micro analysis-ui — what every analysis window shares: the chart (plotChart) and
// its export buttons, the scope (all / filter / selection) a scan runs over and its
// zone keeper, the X/L/R ranges row, grade units, reconcile pairs, the saved and
// restored window config, and Run that can be cancelled. The windows themselves —
// grade-tonnage, swath, stats, validation — build on this. Carved from index.html
// (phase 3).
import { convert as unitConvert } from '../../../ext/units/index.js';
import { parse } from '../../../ext/expr/index.js';
import { zoneKeeper } from './colscan.js';
import { S, layerById } from './state.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setAnalysisUiHooks): deliverBlob, markProjectDirty, resultToLayer
let H = {};
export function setAnalysisUiHooks(h) { H = h; }

// ── analysis windows (grade-tonnage, swath) ──────────────────────────────────
// GCU accent palette for overlaid series (blue=info, orange=action, green, violet)
export const SERIES_COLORS = ['#5b7fa6', '#c8722e', '#5c8a5a', '#8a6fae', '#b0563a'];

// a compact canvas chart: line + bar series over one x-axis and up to two y-axes.
// spec: { series:[{name,color,axis:'left'|'right',kind:'line'|'bar',data:[[x,y]]}],
//   xLabel, leftLabel, rightLabel, xRange?, title? }
export function plotChart(cv, spec) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 400, H = cv.clientHeight || 240;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement);
  const ink = (cs.getPropertyValue('--au-fg') || '#dcdcdc').trim() || '#dcdcdc', dim = '#8a8f95', grid = 'rgba(140,145,150,0.16)';
  const hasRight = spec.series.some((s) => s.axis === 'right');
  const _lMax = Math.max(0, ...spec.series.filter((s2) => s2.axis !== 'right').flatMap((s2) => s2.data.map((d) => Math.abs(d[1] || 0)).filter(Number.isFinite)));
  const mL = Math.max(52, Math.round(_lMax).toLocaleString().length * 6.6 + 14), mR = hasRight ? 50 : 12, mT = 14 + (spec.series.length > 1 ? 12 : 0), mB = 30;
  const px0 = mL, px1 = W - mR, py0 = H - mB, py1 = mT;
  const allX = spec.series.flatMap((s) => s.data.map((d) => d[0]));
  if (!allX.length) {
    g.fillStyle = dim; g.font = '12px monospace'; g.textAlign = 'center';
    g.fillText(spec.placeholder || 'no data', W / 2, H / 2);   // "scanning…" while the sweep runs — not "no data"
    return null;
  }
  // manual range overrides merge PER BOUND ([lo, hi], null = auto) so "just pin the max" works
  const mrg = (auto, man) => { const r = man ? [man[0] != null ? man[0] : auto[0], man[1] != null ? man[1] : auto[1]] : auto.slice(); if (r[0] === r[1]) r[1] = r[0] + 1; return r; };
  const xr = mrg([Math.min(...allX), Math.max(...allX)], spec.xRange);
  const yrOf = (axis) => { const ys = spec.series.filter((s) => s.axis === axis).flatMap((s) => s.data.map((d) => d[1])).filter(Number.isFinite); if (!ys.length) return [0, 1]; let lo = Math.min(...ys), hi = Math.max(...ys); if (lo > 0) lo = 0; if (lo === hi) hi = lo + 1; return [lo, hi]; };
  const lr = mrg(yrOf('left'), spec.leftRange), rr = mrg(yrOf('right'), spec.rightRange);
  const sx = (x) => px0 + (px1 - px0) * (x - xr[0]) / (xr[1] - xr[0]);
  const syL = (y) => py0 + (py1 - py0) * (y - lr[0]) / (lr[1] - lr[0]);
  const syR = (y) => py0 + (py1 - py0) * (y - rr[0]) / (rr[1] - rr[0]);
  const ticks = (lo, hi, n = 4) => { const step = niceStep((hi - lo) / n) || 1; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(v); return out; };
  g.font = '10px monospace'; g.lineWidth = 1;
  g.strokeStyle = grid; g.textAlign = 'center'; g.fillStyle = dim;
  for (const tx of ticks(xr[0], xr[1])) { const X = sx(tx); g.beginPath(); g.moveTo(X, py0); g.lineTo(X, py1); g.stroke(); g.fillText(fmtStat(tx), X, py0 + 12); }
  g.textAlign = 'right';
  for (const ty of ticks(lr[0], lr[1])) { const Y = syL(ty); g.strokeStyle = grid; g.beginPath(); g.moveTo(px0, Y); g.lineTo(px1, Y); g.stroke(); g.fillStyle = dim; g.fillText(fmtStat(ty), px0 - 4, Y + 3); }
  if (hasRight) { g.textAlign = 'left'; g.fillStyle = dim; for (const ty of ticks(rr[0], rr[1])) g.fillText(fmtStat(ty), px1 + 4, syR(ty) + 3); }
  g.save(); g.beginPath(); g.rect(px0, py1, px1 - px0, py0 - py1); g.clip();   // manual ranges may window the data
  for (const s of spec.series) {
    const sy = s.axis === 'right' ? syR : syL; g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 1.6;
    if (s.kind === 'bar') { const bw = Math.max(1, (px1 - px0) / Math.max(1, s.data.length) * 0.7); g.globalAlpha = 0.22; for (const [x, y] of s.data) { if (!Number.isFinite(y)) continue; const X = sx(x), Y = sy(y); g.fillRect(X - bw / 2, Y, bw, py0 - Y); } g.globalAlpha = 1; }
    else { g.beginPath(); let started = false; for (const [x, y] of s.data) { if (!Number.isFinite(y)) { started = false; continue; } const X = sx(x), Y = sy(y); if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y); } g.stroke(); }
  }
  g.restore();
  g.fillStyle = dim; g.textAlign = 'center'; g.font = '10px monospace';
  if (spec.xLabel) g.fillText(spec.xLabel, (px0 + px1) / 2, H - 4);
  const rot = (txt, x, dir) => { g.save(); g.translate(x, (py0 + py1) / 2); g.rotate(dir * Math.PI / 2); g.fillText(txt, 0, 0); g.restore(); };
  if (spec.leftLabel) rot(spec.leftLabel, 10, -1);
  if (spec.rightLabel && hasRight) rot(spec.rightLabel, W - 8, 1);
  // legend
  let lx = px0 + 2; g.textAlign = 'left';
  for (const s of spec.series) { g.fillStyle = s.color; g.fillRect(lx, 4, 9, 3); g.fillStyle = ink; g.fillText(s.name, lx + 12, 8); lx += 16 + g.measureText(s.name).width + 8; }
  // the plot→data mapping, so callers can hit-test the canvas (swath hover)
  return { px0, px1, py0, py1, xr, lr, rr };
}

// reconcile columns come as ref_<g>/this_<g>; detect the pairs for auto-series
export function reconcilePairs(cols) {
  const out = [];
  for (const c of cols) if (c.startsWith('this_') && cols.includes('ref_' + c.slice(5))) out.push({ base: c.slice(5), ref: 'ref_' + c.slice(5), self: c });
  return out;
}

// grade-unit declaration select — shared by GT + swath series rows
export function gradeUnitSel(val, onchange, title) {
  const sel = document.createElement('select'); sel.className = 'sw-sel'; sel.title = title;
  for (const [v, t] of [['', '— unit'], ['pct', '%'], ['g/t', 'g/t'], ['ppm', 'ppm'], ['oz/t', 'oz/t']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
  sel.value = val; sel.onchange = () => onchange(sel.value);
  return sel;
}

// unit factor: a series with a declared unit converts into the plot's axis unit
export function gradeUnitFactor(serUnit, plotUnit) {
  if (!serUnit || !plotUnit || serUnit === plotUnit) return 1;
  try { return unitConvert(1, serUnit, plotUnit); } catch { return 1; }
}

// the row mask a scope implies for layer L (null = all rows); message when the
// scope's prerequisite isn't there yet
// a scan's zone keeper (src/colscan.js zoneKeeper) for analysis series: zones with
// nothing in scope, and — when EVERY series has a filter — zones none of them can
// match (the filters ORed: a zone one series needs is read for all)
export function seriesZoneKeep(L, filters, mask) {
  let ast = null;
  if (filters.length && filters.every((f) => f && String(f).trim())) {
    try { for (const f of filters) { const a = parse(f); ast = ast ? { t: 'or', l: ast, r: a } : a; } } catch { ast = null; }
  }
  return zoneKeeper(L, { ast, mask });
}

export function scopeMask(st, L) {
  if (st.scope === 'selection') return L._selMask || null;
  if (st.scope === 'filtered') return L._filterMask || null;
  return null;
}

export function scopeMissing(st, L) {
  if (st.scope === 'selection' && !(L._selMask && L._selCount)) return 'no selection — brush the 3D first';
  if (st.scope === 'filtered' && !L._filterMask) return 'no active filter — run one in the filter box first';
  return null;
}

// manual axis ranges: st.ranges = { x: [lo,hi], l: [lo,hi], r: [lo,hi] } with
// null = auto per BOUND. A small aligned grid — one row per axis: label · min · max.
export function rangesRow(st, redraw, labels) {
  if (!st.ranges) st.ranges = { x: [null, null], l: [null, null], r: [null, null] };
  const row = document.createElement('div'); row.className = 'rr-row';
  const mk = (key, bi, ph) => {
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.className = 'rr-in'; inp.placeholder = ph;
    const v = st.ranges[key][bi]; if (v != null) inp.value = String(v);
    inp.onchange = () => { st.ranges[key][bi] = inp.value === '' ? null : +inp.value; redraw(); };
    return inp;
  };
  for (const [key, lab] of [['x', labels.x], ['l', labels.l], ['r', labels.r]]) {
    if (!lab) continue;
    const l = document.createElement('span'); l.className = 'rr-lab'; l.textContent = lab; l.title = `${lab} axis — blank = auto`;
    row.append(l, mk(key, 0, 'min'), mk(key, 1, 'max'));
  }
  const clr = document.createElement('button'); clr.className = 'rr-clear'; clr.textContent = 'auto'; clr.title = 'clear all manual ranges';
  clr.onclick = () => { st.ranges = { x: [null, null], l: [null, null], r: [null, null] }; redraw(); for (const i of row.querySelectorAll('input')) i.value = ''; };
  row.append(clr);
  return row;
}

export const rangesOf = (st) => (st.ranges && [st.ranges.x, st.ranges.l, st.ranges.r].some((r) => r[0] != null || r[1] != null)
  ? { xRange: st.ranges.x, leftRange: st.ranges.l, rightRange: st.ranges.r } : {});

// serialized form: { x: {min?, max?}, … } — maps drop null bounds cleanly
// (positional [null, hi] arrays would turn into "null" strings in YAML); the
// restore accepts BOTH shapes (older manifests carry arrays)
export function rangesForCfg(ranges) {
  if (!ranges) return undefined;
  const o = {};
  for (const k of ['x', 'l', 'r']) { const r = ranges[k] || []; const e = {}; if (r[0] != null) e.min = r[0]; if (r[1] != null) e.max = r[1]; if ('min' in e || 'max' in e) o[k] = e; }
  return Object.keys(o).length ? o : undefined;
}

export function rangesFromCfg(r) {
  const out = { x: [null, null], l: [null, null], r: [null, null] };
  for (const k of ['x', 'l', 'r']) {
    const v = r && r[k]; if (!v) continue;
    out[k] = Array.isArray(v) ? [v[0] != null ? v[0] : null, v[1] != null ? v[1] : null] : [v.min != null ? v.min : null, v.max != null ? v.max : null];
  }
  return out;
}

export function plotExportBtns(cv, nameFn, tableFn, group) {
  // THE results row — the same actions in the same order in every analysis
  // window (⤓ png · ⧉ copy when there is a plot; ⇥ layer · ⧉ table when
  // there is a table), mounted in the sticky footer under Run.
  const wrap = document.createElement('span'); wrap.className = 'pp-exp';
  if (tableFn) setTimeout(() => { const h = (cv || wrap).closest('.fwin'); if (h) h._tableTSV = tableFn; });   // routines read the table from here
  const keep = document.createElement('button'); keep.className = 'awin-btn'; keep.textContent = '⇥ layer'; keep.title = 'keep the result as a TABLE LAYER — filter it, join it, compare it against another run';
  keep.onclick = async () => {
    const t = tableFn && tableFn();
    if (!t) { $('#meta').textContent = 'run it first — there is no table yet'; return; }
    const leaf = nameFn().replace(/\.png$/i, '');
    await H.resultToLayer(group ? `${group}/${leaf}` : leaf, t);   // grouped by the kind of analysis
  };
  if (cv) {
    const save = document.createElement('button'); save.className = 'awin-btn'; save.textContent = '⤓ png'; save.title = 'save the plot as PNG';
    save.onclick = () => cv.toBlob((blob) => { if (!blob) return; $('#meta').textContent = `saved ${nameFn()}`; H.deliverBlob(blob, nameFn()); }, 'image/png');
    const copy = document.createElement('button'); copy.className = 'awin-btn'; copy.textContent = '⧉ copy'; copy.title = 'copy the plot to the clipboard';
    copy.onclick = () => cv.toBlob(async (blob) => {
      if (!blob) return;
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); $('#meta').textContent = 'plot copied to clipboard'; }
      catch (e) { $('#meta').textContent = `copy failed (${e.message}) — use ⤓ png`; }
    }, 'image/png');
    wrap.append(save, copy);
  }
  if (tableFn) wrap.append(keep);
  if (tableFn) {
    const tbl = document.createElement('button'); tbl.className = 'awin-btn'; tbl.textContent = '⧉ table'; tbl.title = 'copy the computed numbers as TSV (paste into a spreadsheet)';
    tbl.onclick = async () => {
      const tsv = tableFn();
      if (!tsv) { $('#meta').textContent = 'table: nothing computed yet — Run first'; return; }
      try { await navigator.clipboard.writeText(tsv); $('#meta').textContent = `table copied (${tsv.split('\n').length - 1} rows, TSV)`; }
      catch (e) { $('#meta').textContent = `copy failed (${e.message})`; }
    };
    wrap.append(tbl);
  }
  return wrap;
}

// ── analysis-window persistence: per-layer configs in the project manifest.
// Series reference layers BY NAME (ids are runtime); `open` pins the window so
// a project reopen brings it back (config restored — Run stays manual). ──
export function analysisSerCfg(series) {
  return series.map((s) => { const Lx = layerById(s.layerId); return { layer: Lx ? Lx.name : null, col: s.col, unit: s.unit || '', weight: s.weight || '', filter: s.filter || '', color: s.color }; });
}

export function analysisSerRestore(cfgSeries, L) {
  const out = [];
  for (const c of cfgSeries || []) {
    const Lx = S.layers.find((x) => x.name === c.layer) || L;
    if (!Lx) continue;
    out.push({ layerId: Lx.id, col: c.col, unit: c.unit || '', weight: c.weight || '', filter: c.filter || '', color: c.color || SERIES_COLORS[out.length % SERIES_COLORS.length] });
  }
  return out.length ? out : null;
}

export function saveAnalysisCfg(L, kind, cfg, win) {
  const a = L.analysis = L.analysis || {};
  a.geo = a.geo || {};
  const geo = win ? [win.el.offsetLeft, win.el.offsetTop, win.el.offsetWidth, win.el.offsetHeight] : a.geo[kind];
  if (JSON.stringify(a[kind]) !== JSON.stringify(cfg) || JSON.stringify(a.geo[kind]) !== JSON.stringify(geo)) {
    a[kind] = cfg; a.geo[kind] = geo; H.markProjectDirty();
  }
}

export function setAnalysisOpen(L, kind, open) {
  const a = L.analysis = L.analysis || {};
  const set = new Set(a.open || []);
  if (set.has(kind) === open) return;
  if (open) set.add(kind); else set.delete(kind);
  a.open = [...set]; H.markProjectDirty();
}

export function applyAnalysisGeo(L, kind, win) {
  const g = L.analysis && L.analysis.geo && L.analysis.geo[kind];
  if (!g) return;
  win.el.style.left = Math.max(0, Math.min(g[0], innerWidth - 80)) + 'px';
  win.el.style.top = Math.max(28, Math.min(g[1], innerHeight - 60)) + 'px';
  win.el.style.width = Math.min(g[2], innerWidth - 12) + 'px';
  win.el.style.height = Math.min(g[3], innerHeight - 72) + 'px';
  if (win.el._onResized) win.el._onResized();
}

// quantile digests fed in batches: a per-value push sorted a 2000-value JS
// buffer per flush (the 18 s freeze at 60M, with the pinned path never
// yielding); pushArray sorts a typed batch natively. BOTH stats paths feed
// through this, so their batch boundaries — hence their digests — stay identical.
// Run ↔ Cancel: while a window's scan runs, its Run button cancels it. The
// previous result stays on screen until a new one replaces it.
export function runCancellable(btn) {
  const ac = new AbortController(), prev = btn.onclick;
  btn.textContent = 'Cancel'; btn.disabled = false; btn.title = 'stop this scan (the previous result stays)';
  btn.onclick = () => { ac.abort(); btn.disabled = true; };
  return { signal: ac.signal, done: () => { btn.textContent = 'Run'; btn.disabled = false; btn.title = ''; btn.onclick = prev; } };
}

export const abortErr = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

export const checkAbort = (signal) => { if (signal && signal.aborted) throw abortErr(); };

export const scanProgressText = (n, N, w) => rowsProgress(n, N) + (w ? ` · ${w}` : '');

// a scan's progress line: "1.2M of 60M rows · 2%" — what's happening and how far
export function rowsProgress(n, N) { return N ? `${n.toLocaleString()} of ${N.toLocaleString()} rows · ${Math.min(100, Math.floor(100 * n / N))}%` : `${n.toLocaleString()} rows…`; }

// ESRI ASCII grid writer — the trivial format everything reads; also the blob
// "nice" step (1 / 2 / 2.5 / 5 × 10ⁿ) for a default cell size
export function niceStep(x) {
  if (!(x > 0)) return 1;
  const p10 = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p10;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p10;
}

export const fmtStat = (v) => (v == null || !Number.isFinite(v) ? '–' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : +v.toFixed(Math.abs(v) < 1 ? 4 : 2) + '');
