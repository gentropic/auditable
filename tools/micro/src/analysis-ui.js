// micro analysis-ui — what every analysis window shares: the chart (plotChart) and
// its export buttons, the scope (all / filter / selection) a scan runs over and its
// zone keeper, the X/L/R ranges row, grade units, reconcile pairs, the saved and
// restored window config, and Run that can be cancelled. The windows themselves —
// grade-tonnage, swath, stats, validation — build on this. Carved from index.html
// (phase 3).
import { convert as unitConvert } from '../../../ext/units/index.js';
import { tok, resolvedTheme } from './theme.js';
import { subplots } from '../../../ext/plot/index.js';
import { parse } from '../../../ext/expr/index.js';
import { zoneKeeper } from './colscan.js';
import { S, layerById } from './state.js';
import { markProjectDirty } from './project.js';
import { deliverBlob } from './hostio.js';
import { _gtWins } from './gt.js';
import { _swathWins } from './swath.js';
import { _statsWins } from './stats.js';
import { recipeSlug } from './recipes.js';
import { openBlob } from './open.js';
import { mkLineage } from './lineage.js';
import { fileLayerByPath } from './tree.js';
import { applyLimit, limitLabel, normLimit, resolveLimit } from './polylimit.js';
const $ = (s) => document.querySelector(s);

// ── analysis windows (grade-tonnage, swath) ──────────────────────────────────
// GCU accent palette for overlaid series (blue=info, orange=action, green, violet)
export const SERIES_COLORS = ['#5b7fa6', '#c8722e', '#5c8a5a', '#8a6fae', '#b0563a'];

// a chart spec → a @gcu/plot figure: line + bar series over one x-axis and up to two y-axes.
// spec: { series:[{name,color,axis:'left'|'right',kind:'line'|'bar',data:[[x,y]]}],
//   xLabel, leftLabel, rightLabel, xRange?, leftRange?, rightRange?, title? }
// The ranges are the old canvas chart's exactly (x tight to the data, y from 0 when the data is
// positive, a manual bound overriding its own end), so on-screen hit-testing keeps its numbers.
// The same figure draws the window's canvas and — as a vector draw list — the composer's frame.
export function chartRanges(spec) {
  const mrg = (auto, man) => { const r = man ? [man[0] != null ? man[0] : auto[0], man[1] != null ? man[1] : auto[1]] : auto.slice(); if (r[0] === r[1]) r[1] = r[0] + 1; return r; };
  const allX = spec.series.flatMap((s) => s.data.map((d) => d[0])).filter(Number.isFinite);
  if (!allX.length) return null;
  let xlo = Infinity, xhi = -Infinity; for (const x of allX) { if (x < xlo) xlo = x; if (x > xhi) xhi = x; }
  const yrOf = (axis) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of spec.series) if ((s.axis === 'right') === (axis === 'right')) for (const d of s.data) { const y = d[1]; if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } }
    if (lo === Infinity) return [0, 1];
    if (lo > 0) lo = 0; if (lo === hi) hi = lo + 1;
    return [lo, hi];
  };
  return { xr: mrg([xlo, xhi], spec.xRange), lr: mrg(yrOf('left'), spec.leftRange), rr: mrg(yrOf('right'), spec.rightRange) };
}
export function chartFigure(spec, { width = 400, height = 240, theme = 'paper', fontSize = 10 } = {}) {
  const [fig, ax] = subplots(1, 1, { figsize: [Math.max(60, width), Math.max(60, height)], dpi: 100, theme });
  const R = chartRanges(spec);
  const hasRight = spec.series.some((s) => s.axis === 'right');
  const ax2 = hasRight ? ax.twinx() : null;
  const handles = [], labels = [];
  const nx = Math.max(1, ...spec.series.map((s) => s.data.length));
  for (const s of spec.series) {
    const a = s.axis === 'right' ? ax2 : ax, xs = s.data.map((d) => d[0]), ys = s.data.map((d) => (Number.isFinite(d[1]) ? d[1] : NaN));
    let h;
    if (s.kind === 'bar') {
      const span = R ? R.xr[1] - R.xr[0] : 1, w = (span / nx) * 0.7;
      h = a.bar(xs, ys.map((y) => (Number.isFinite(y) ? y : 0)), { width: w, color: s.color, alpha: 0.22, label: s.name });
    } else {
      // a right-axis line sharing its colour with a left one (GT: one model's tonnage and grade) is dashed
      const twin = s.axis === 'right' && spec.series.some((o) => o !== s && o.axis !== 'right' && o.color === s.color);
      h = a.plot(xs, ys, { color: s.color, linewidth: 1.6, linestyle: s.dash || twin ? '--' : '-', label: s.name, ...(s.marker ? { marker: s.marker, markersize: 4 } : {}) });
    }
    if (s.name) { handles.push(Array.isArray(h) ? h[0] : h); labels.push(s.name); }   // an unnamed series (a marker line) stays out of the legend
  }
  if (R) {
    ax.set_xlim(R.xr[0], R.xr[1]); ax.set_ylim(R.lr[0], R.lr[1]);
    if (ax2) ax2.set_ylim(R.rr[0], R.rr[1]);
  }
  // a horizontal band on the left axis (a tolerance about 1.0 — the factors chart): behind the lines
  if (spec.hBand && Number.isFinite(spec.hBand.lo) && Number.isFinite(spec.hBand.hi)) ax.axhspan(spec.hBand.lo, spec.hBand.hi, { color: spec.hBand.color || '#5c8a5a', alpha: 0.13 });
  ax.grid(true, { alpha: 0.35 });
  // 2,000,000 — not 2000000 (nor Python's 2e+06): thousands grouped, small values to six figures
  const tickFmt = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : String(+(+x).toPrecision(6))).replace(/^-/, '−');
  for (const a of [ax, ax2]) if (a) a.yaxis.set_major_formatter(tickFmt);
  // categorical x (periods): exactly these ticks, labelled — thinned so the labels don't collide
  if (Array.isArray(spec.xTicks) && spec.xTicks.length) {
    const every = Math.max(1, Math.ceil(spec.xTicks.length / Math.max(2, Math.floor(width / 64))));
    const tk = spec.xTicks.filter((_, i) => i % every === 0);
    ax.set_xticks(tk.map((t) => t[0]), tk.map((t) => String(t[1])));
  } else ax.xaxis.set_major_formatter(tickFmt);
  if (spec.xLabel) ax.set_xlabel(spec.xLabel, { fontsize: fontSize });
  if (spec.leftLabel) ax.set_ylabel(spec.leftLabel, { fontsize: fontSize });
  if (ax2 && spec.rightLabel) ax2.set_ylabel(spec.rightLabel, { fontsize: fontSize });
  if (spec.title) ax.set_title(spec.title, { fontsize: fontSize + 1 });
  if (handles.length > 1) ax.legend(handles, labels, { loc: 'best', fontsize: fontSize - 1, frameon: false });
  return { fig, ax, ax2, ranges: R };
}
// the window's chart: the figure above, drawn on the window's canvas in micro's own colours.
// Returns the plot → data mapping { px0, px1, py0, py1, xr, lr, rr } for hit-testing (swath hover).
// a chart on micro's own panels: its tokens, a transparent face
export const screenTheme = () => ({ base: resolvedTheme() === 'light' ? 'light' : 'dark', foreground: tok('--text-hi'), muted: tok('--dim'), frame: tok('--dim'), grid: 'rgba(140,145,150,0.35)', font_size: 10 });
export function plotChart(cv, spec) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || 400, CH = cv.clientHeight || 240;
  cv.width = W * dpr; cv.height = CH * dpr;
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  cv._chartSpec = spec;                                     // ⇥ figure sends the spec, not the pixels: a vector chart on the page
  if (!chartRanges(spec)) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = tok('--dim'); g.font = '12px monospace'; g.textAlign = 'center';
    g.fillText(spec.placeholder || 'no data', W / 2, CH / 2);   // "scanning…" while the sweep runs — not "no data"
    return null;
  }
  const { fig, ax, ax2, ranges } = chartFigure(spec, { width: W, height: CH, theme: screenTheme() });
  fig.set_facecolor('none'); ax.set_facecolor('none');
  fig.draw(g, { dpr });
  g.setTransform(dpr, 0, 0, dpr, 0, 0);                     // callers draw their own marks on top, in CSS px
  const v = ax.view;
  return { px0: v.x, px1: v.x + v.w, py0: v.y + v.h, py1: v.y, xr: ax.get_xlim(), lr: ax.get_ylim(), rr: ax2 ? ax2.get_ylim() : ranges.rr };
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

// st.limit (src/polylimit.js) ANDs a polygon limit onto the scope: "filtered" AND "inside the pit
// limit". Its mask is computed by prepareScope before the scan; here it is only read.
export function scopeMask(st, L) {
  let m = null;
  if (st.scope === 'selection') m = L._selMask || null;
  else if (st.scope === 'filtered') m = L._filterMask || null;
  if (!normLimit(st.limit)) return m;
  if (st.scope && st.scope !== 'all' && !m) return null;  // the scope's own mask is missing — scopeMissing says so
  return applyLimit(m, L, st.limit);
}

export function scopeMissing(st, L) {
  if (st.scope === 'selection' && !(L._selMask && L._selCount)) return 'no selection — brush the 3D first';
  if (st.scope === 'filtered' && !L._filterMask) return 'no active filter — run one in the filter box first';
  if (normLimit(st.limit)) { try { resolveLimit(st.limit); } catch (e) { return e.message; } }
  return null;
}
// the scope as a subtitle: "filtered · inside pit_limit"
export const scopeLabel = (st) => [st.scope && st.scope !== 'all' ? st.scope : '', limitLabel(st.limit)].filter(Boolean).join(' · ');

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
    await resultToLayer(group ? `${group}/${leaf}` : leaf, t);   // grouped by the kind of analysis
  };
  if (cv) {
    const save = document.createElement('button'); save.className = 'awin-btn'; save.textContent = '⤓ png'; save.title = 'save the plot as PNG';
    save.onclick = () => cv.toBlob((blob) => { if (!blob) return; $('#meta').textContent = `saved ${nameFn()}`; deliverBlob(blob, nameFn()); }, 'image/png');
    const copy = document.createElement('button'); copy.className = 'awin-btn'; copy.textContent = '⧉ copy'; copy.title = 'copy the plot to the clipboard';
    copy.onclick = () => cv.toBlob(async (blob) => {
      if (!blob) return;
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); $('#meta').textContent = 'plot copied to clipboard'; }
      catch (e) { $('#meta').textContent = `copy failed (${e.message}) — use ⤓ png`; }
    }, 'image/png');
    wrap.append(save, copy);
  }
  if (cv || tableFn) {                                      // the plot and/or its table → the composer page
    const fig = document.createElement('button'); fig.className = 'awin-btn'; fig.textContent = '⇥ figure';
    fig.title = cv && tableFn ? 'put the plot and its table on the composer page (a figure for print)' : cv ? 'put the plot on the composer page' : 'put the table on the composer page';
    fig.onclick = () => {
      const tsv = tableFn && tableFn();
      if (!cv && !tsv) { $('#meta').textContent = 'run it first — there is no table yet'; return; }
      dispatchEvent(new CustomEvent('micro:to-composer', { detail: { canvas: cv, spec: cv && cv._chartSpec ? JSON.parse(JSON.stringify(cv._chartSpec)) : null, recipe: (() => { const h = (cv || wrap).closest('.fwin'); try { return h && h._recipe ? JSON.parse(JSON.stringify(h._recipe())) : null; } catch { return null; } })(), tsv: tsv || null, name: nameFn().replace(/\.png$/i, '') } }));
    };
    wrap.append(fig);
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
  // a series names its layer; only the FIRST may fall back to the window's layer (the layer the
  // recipe was re-pointed at). Any other missing layer is left out and named in out.dropped —
  // silently drawing it from the window's layer gave a plausible chart of the wrong data.
  const out = [], dropped = [];
  for (const [i, c] of (cfgSeries || []).entries()) {
    const Lx = S.layers.find((x) => x.name === c.layer) || (i === 0 || !c.layer ? L : null);
    if (!Lx) { dropped.push(`${c.col} on ${c.layer}`); continue; }
    out.push({ layerId: Lx.id, col: c.col, unit: c.unit || '', weight: c.weight || '', filter: c.filter || '', color: c.color || SERIES_COLORS[out.length % SERIES_COLORS.length] });
  }
  if (!out.length) return null;
  out.dropped = dropped;
  return out;
}

export function saveAnalysisCfg(L, kind, cfg, win) {
  const a = L.analysis = L.analysis || {};
  a.geo = a.geo || {};
  // a window being CLOSED is already out of the page (windows.js removes it, then calls onClose):
  // its offsets read 0×0, which reopened the window as a dot — keep the last good geometry then
  const live = win && win.el.isConnected && win.el.offsetWidth > 0;
  const geo = live ? [win.el.offsetLeft, win.el.offsetTop, win.el.offsetWidth, win.el.offsetHeight] : a.geo[kind];
  if (JSON.stringify(a[kind]) !== JSON.stringify(cfg) || JSON.stringify(a.geo[kind]) !== JSON.stringify(geo)) {
    a[kind] = cfg; a.geo[kind] = geo; markProjectDirty();
  }
}

export function setAnalysisOpen(L, kind, open) {
  const a = L.analysis = L.analysis || {};
  const set = new Set(a.open || []);
  if (set.has(kind) === open) return;
  if (open) set.add(kind); else set.delete(kind);
  a.open = [...set]; markProjectDirty();
}

export function applyAnalysisGeo(L, kind, win) {
  const g = L.analysis && L.analysis.geo && L.analysis.geo[kind];
  if (!g || !(g[2] > 60) || !(g[3] > 40)) return;          // a degenerate saved size (the old close-time 0×0): keep the default
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

// redraw the open GT / swath / stats windows bound to L when their scope's input
// changed (kind: 'selection' after brushing, 'filtered' after a filter run)
export function refreshLinkedWindows(L, kind = 'selection') {
  if (!L) return;
  for (const map of [_gtWins, _swathWins, _statsWins]) { const e = map.get(L.id); if (e && e.st && e.st.scope === kind) e.redraw(); }
}

// a result table (TSV) → a table layer in the project
// `title` may be a PATH — "swaths/FE drift" files the result into a swaths group
export async function resultToLayer(title, tsv, lineageOp) {
  if (!tsv || !tsv.trim()) { $('#meta').textContent = 'no table to keep'; return null; }
  const leaf = String(title).split('/').pop().trim() || 'result';
  const name = `${recipeSlug(leaf)}.tsv`;
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const _got = await openBlob(blob, name, 'add', null, { asKind: 'table', lineage: lineageOp ? mkLineage(lineageOp.op, lineageOp.params || {}, lineageOp.sources || []) : undefined });
  const L = layerById(_got);
  if (L) fileLayerByPath(L, title);                        // path → group; plain name → just the label
  const rows = L && L.docs.tableDoc ? L.docs.tableDoc.header.count.toLocaleString() : '?';
  $('#meta').textContent = `${title} → a table layer (${rows} rows) — filter it, join it, export it`;
  markProjectDirty();
  return L;
}
