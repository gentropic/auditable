// micro — CUT / FILL between two surfaces: an earlier one (before — last month's pit survey, the
// pre-mining topography) and a later one (after). Both are sampled on ONE lattice — the finer grid's
// own nodes over the overlap of the two (or a stated cell) — and differenced node by node:
// Δz = after − before, cut = the volume where Δz < 0 (material removed), fill where Δz > 0 (added),
// each node standing for one cell. Grids are sampled at their nodes (bilinear between them), meshes
// rasterized (their top), exactly as the surface tools do (src/gridtools.js gridOnLattice).
// What it makes: the numbers (cut, fill, net, the area each covers), a Δz grid layer (a flat sheet
// above the two, on a diverging ramp centred on 0) and a chart of the volume moved by Δz — the
// window's ⇥ figure puts it on the composer page and re-runs from the recipe. The arithmetic is pure
// (src/grid-ops.js commonSurfaceLattice + cutFillGrids); the routine tool is `cutfill` (src/tools.js).
// A PERIMETER (a polygon limit, src/polylimit.js — a pit limit, a stockpile toe) keeps only the ground
// inside it: each node counts by the share of its cell the polygons cover, the cell clipped to them
// exactly (src/coverage.js), so a volume is exact at the edges and the report states both areas — the
// perimeter's own and the part of it the two surfaces cover.
import { S, layerById } from './state.js';
import { commonSurfaceLattice, cutFillGrids, coverWeights } from './grid-ops.js';
import { gridOnLattice, surfaceableLayers, surfCellOf, layerWorldBbox } from './gridtools.js';
import { mkLineage } from './lineage.js';
import { openBlob } from './open.js';
import { writeEsriAsc } from './grid-io.js';
import { gridLayerFile } from './grid-export.js';
import { setRampCfg } from './ramp.js';
import { replaceMade } from './pcgrid.js';
import { rebuildSurface } from './surfaces.js';
import { floatWin, focusWindow } from './windows.js';
import { plotChart, plotExportBtns, runCancellable, checkAbort } from './analysis-ui.js';
import { saveRecipe } from './recipes.js';
import { registerCommands, contributeMenu } from './commands.js';
import { resolveLimit, normLimit, limitRow, limitLabel } from './polylimit.js';
import { gridCoverage, clipGridLattice, featureBBoxXY } from './coverage.js';
const $ = (s) => document.querySelector(s);

const nameOf = (L) => (L ? L.label || L.name : '?');
const baseOf = (L) => nameOf(L).replace(/\.[^.]+$/, '');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;
export const cutFillSurfaces = () => surfaceableLayers();

// a surface's lattice (a grid's own; a mesh: its plan bbox at the surface tools' default cell)
export function latticeOf(L) {
  const g = L.docs.gridDoc && L.docs.gridDoc.grid;
  if (g) return { x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy || g.dx, nx: g.nx, ny: g.ny, ...(g.place ? { place: g.place } : {}) };
  const bb = layerWorldBbox(L); if (!bb) throw new Error(`${nameOf(L)}: no extent yet`);
  const dx = surfCellOf(L);
  return { x0: bb[0], y0: bb[4], dx, dy: dx, nx: Math.max(2, Math.floor((bb[3] - bb[0]) / dx) + 1), ny: Math.max(2, Math.floor((bb[4] - bb[1]) / dx) + 1) };
}

/**
 * Cut / fill between two surface layers (grid or context mesh). opts: cell (blank = the finer grid's),
 * match (a grid LAYER whose lattice to use), onProgress(frac, text), signal.
 * → { before, after, geom, cut, fill, net, area, cutArea, fillArea, nodes, range, hist, dz }
 */
export async function cutFill(before, after, opts = {}) {
  if (!before || !after) throw new Error('cut / fill: two surfaces — before and after');
  if (before === after) throw new Error('cut / fill: before and after are the same surface');
  const ok = (L) => (L.kind === 'mesh' && L.docs.meshDoc && !L.docs.meshDoc.header.soup) || (L.docs.gridDoc && L.docs.gridDoc.grid);
  for (const L of [before, after]) if (!ok(L)) throw new Error(`${nameOf(L)} is not a surface (a grid, or a context-tier mesh)`);
  let geom;
  if (opts.match) {
    const g = opts.match.docs && opts.match.docs.gridDoc && opts.match.docs.gridDoc.grid;
    if (!g) throw new Error(`${nameOf(opts.match)} is not a grid`);
    geom = { x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy || g.dx, nx: g.nx, ny: g.ny, ...(g.place ? { place: g.place } : {}) };   // a rotated grid's own lattice
  } else {
    geom = commonSurfaceLattice(latticeOf(before), latticeOf(after), +opts.cell > 0 ? +opts.cell : null);
    if (!geom) throw new Error(`${nameOf(before)} and ${nameOf(after)} don't overlap in plan`);
  }
  const lim = opts.limit ? resolveLimit(opts.limit) : null;
  if (lim) {                                                   // the perimeter: only its plan bbox is sampled
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of lim.features) { const b = featureBBoxXY(f); bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]); }
    geom = clipGridLattice(geom, bb);
    if (!geom) throw new Error(`the perimeter (${limitLabel(opts.limit)}) doesn't overlap ${nameOf(before)} and ${nameOf(after)} in plan`);
  }
  if (geom.nx * geom.ny > 32e6) throw new Error(`${geom.nx.toLocaleString()} × ${geom.ny.toLocaleString()} nodes — over 32M; give a bigger cell`);
  const prog = (k, label) => (f) => { if (opts.onProgress) opts.onProgress((k + f) / 2, label); };
  const A = await gridOnLattice(before, geom, prog(0, `sampling ${nameOf(before)}`), { cover: true });
  checkAbort(opts.signal);
  const B = await gridOnLattice(after, geom, prog(1, `sampling ${nameOf(after)}`), { cover: true });
  checkAbort(opts.signal);
  if (lim && geom.place) throw new Error('cut / fill: a perimeter on a ROTATED matched lattice is not supported yet — leave "match" empty (the common lattice is axis-aligned)');
  // per-node weights: a perimeter's coverage × the share of each edge node's cell a MESH surface
  // really spans (a mesh's boundary nodes otherwise count a full cell past its edge)
  const pw = lim ? gridCoverage(lim.features, geom) : null;
  const mw = coverWeights([A.cover, B.cover], geom.nx, geom.ny);
  let weights = pw || mw;
  if (pw && mw) { weights = new Float32Array(pw.length); for (let k = 0; k < pw.length; k++) weights[k] = pw[k] * mw[k]; }
  delete A.cover; delete B.cover;
  const r = cutFillGrids(A, B, { weights });
  if (geom.place) { r.dz.place = geom.place; const s = geom.place.s; if (s !== 1) { r.cut *= s * s * s; r.fill *= s * s * s; r.net *= s * s * s; r.area *= s * s; r.cutArea *= s * s; r.fillArea *= s * s; } }   // the lattice's own frame → world volumes
  if (!r.nodes) throw new Error(`no node where both ${nameOf(before)} and ${nameOf(after)} have a value${lim ? ' inside the perimeter' : ''}`);
  if (lim) { r.limit = normLimit(opts.limit); r.limitLabel = limitLabel(opts.limit); r.limitArea = lim.area; }
  // the sheet's height: just above the higher of the two (a map hovering over the pit)
  let top = -Infinity;
  for (const g of [A, B]) for (let k = 0; k < g.data.length; k++) { const v = g.data[k]; if (v !== g.nodata && !Number.isNaN(v) && v > top) top = v; }
  return { before: before.name, after: after.name, beforeLabel: nameOf(before), afterLabel: nameOf(after), geom, top, ...r };
}

/** The Δz grid as a layer: a flat sheet at the top of the two, rdbu about 0. → its id */
export async function cutFillLayer(res, beforeL, afterL, { name = null } = {}) {
  const nm = name ? (/\.asc$/i.test(name) ? name : `${name}.asc`) : `dz_${baseOf(afterL)}_${baseOf(beforeL)}.asc`.replace(/[^\w.-]+/g, '_');
  const lin = mkLineage('cutfill', { before: beforeL.name, after: afterL.name, cell: res.geom.dx, ...(res.limit ? { limit: res.limit, limitArea: +res.limitArea.toPrecision(10) } : {}), cut: +res.cut.toPrecision(8), fill: +res.fill.toPrecision(8) }, [beforeL.lineage, afterL.lineage].filter(Boolean));
  const flatZ = +(res.top + Math.max(1, res.geom.dx)).toFixed(3);
  replaceMade(nm);                                             // a re-run replaces its own earlier Δz layer
  const gf = res.dz.place ? await gridLayerFile(res.dz, nm) : { blob: new Blob([writeEsriAsc(res.dz, { decimals: 4 })]), name: nm };   // a rotated Δz: a GeoTIFF that keeps its rotation
  const id = await openBlob(new File([gf.blob], gf.name), gf.name, S.layers.length ? 'add' : 'replace', null, { lineage: lin, asKind: 'surface', flatZ });
  const L = id != null ? layerById(id) : null;
  if (L) {
    L.memoryOnly = true;
    L.gridValue = { name: 'dz', unit: 'm' };                   // after − before
    const m = Math.max(Math.abs(res.range[0]), Math.abs(res.range[1])) || 1;
    L.surfaceRange = [-m, m];                                  // centred on 0: white = no change
    setRampCfg(L, { preset: 'rdbu' });
    rebuildSurface(L);
  }
  return { id, name: nm };
}

// ── the shapes: the table, the human TSV, the chart ──────────────────────────
export function cutFillTable(r) {
  return {
    columns: ['quantity', 'volume', 'area'], key: ['quantity'], units: { volume: 'm³', area: 'm²' },
    rows: [['cut', r.cut, r.cutArea], ['fill', r.fill, r.fillArea], ['net', r.net, r.area]],
  };
}
export const cutFillValues = (r) => ({ cut: r.cut, fill: r.fill, net: r.net, area: r.area, cut_area: r.cutArea, fill_area: r.fillArea, nodes: r.nodes, cell: r.geom.dx, dz_min: r.range[0], dz_max: r.range[1], ...(r.limit ? { perimeter_area: r.limitArea } : {}) });
export function cutFillHumanTSV(r) {
  if (!r) return null;
  const c = (v) => +(+v).toPrecision(10);
  return [`cut / fill\t${r.afterLabel} − ${r.beforeLabel}\t(cell ${r.geom.dx} m, ${r.nodes.toLocaleString()} nodes)`, 'quantity\tvolume (m³)\tarea (m²)',
    `cut\t${c(r.cut)}\t${c(r.cutArea)}`, `fill\t${c(r.fill)}\t${c(r.fillArea)}`, `net (fill − cut)\t${c(r.net)}\t${c(r.area)}`,
    ...(r.limit ? [`perimeter\t\t${c(r.limitArea)}\t(${r.limitLabel}; the surfaces cover ${c(r.area)} m² of it)`] : [])].join('\n');
}
// volume moved per Δz band: cut bars (red) to the left of 0, fill bars (blue) to the right
export function cutFillChartSpec(r) {
  if (!r || !r.nodes) return null;
  const { lo, w, vol } = r.hist, cut = [], fill = [];
  vol.forEach((v, i) => { const x = lo + (i + 0.5) * w; (x < 0 ? cut : fill).push([x, v]); });
  let mx = 0; for (const v of vol) if (v > mx) mx = v;
  return {
    xLabel: `Δz = ${r.afterLabel} − ${r.beforeLabel} (m)`, leftLabel: 'volume (m³)',
    series: [
      { name: `cut ${Math.round(r.cut).toLocaleString()} m³`, color: '#b2182b', axis: 'left', kind: 'bar', data: cut },
      { name: `fill ${Math.round(r.fill).toLocaleString()} m³`, color: '#2166ac', axis: 'left', kind: 'bar', data: fill },
      { name: '0', color: '#9aa0a6', axis: 'left', kind: 'line', dash: true, data: [[0, 0], [0, mx || 1]] },
    ],
    xRange: [lo, -lo], leftRange: [0, (mx || 1) * 1.08],
  };
}

// ── the window ───────────────────────────────────────────────────────────────
let _win = null;
export function openCutFill(L0, ropts = {}) {
  const surfs = cutFillSurfaces();
  if (surfs.length < 2) { $('#meta').textContent = 'cut / fill: needs two surfaces (grids or context meshes) — before and after'; return null; }
  if (_win && _win.win.el.isConnected) { if (!ropts.cfg && !ropts.run) { focusWindow(_win.win.el); return _win; } _win.win.close(); }
  const st = { before: null, after: null, cell: '', layer: true, limit: null, res: null, running: false };
  const second = surfs.find((x) => x !== L0);
  if (L0 && surfs.includes(L0)) { st.after = L0.id; st.before = (second || surfs[0]).id; } else { st.before = surfs[0].id; st.after = surfs[1].id; }
  if (ropts.cfg) { const c = ropts.cfg, b = c.before && layerNamed(c.before), a = c.after && layerNamed(c.after); if (b) st.before = b.id; if (a) st.after = a.id; if (c.cell) st.cell = String(c.cell); if (c.layer === false) st.layer = false; if (c.limit) st.limit = normLimit(c.limit); }
  const win = floatWin({ title: 'cut / fill', sub: 'pick before and after, then Run', x: Math.max(12, innerWidth - 760), y: 90, w: 740, h: 480, onClose: () => { _win = null; } });
  win.el.dataset.cutfill = '1';
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1 1 60%;min-height:120px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout cf-readout';
  main.append(cv, readout); body.append(rail, main);
  const cfgOf = (withLayer = st.layer) => ({ before: (layerById(st.before) || {}).name, after: (layerById(st.after) || {}).name, ...(+st.cell > 0 ? { cell: +st.cell } : {}), ...(normLimit(st.limit) ? { limit: normLimit(st.limit) } : {}), layer: !!withLayer });
  const plot = () => {
    readout.textContent = '';
    if (!st.res) { plotChart(cv, { series: [], placeholder: st.running ? 'sampling…' : 'press Run' }); return; }
    plotChart(cv, cutFillChartSpec(st.res));
    const add = (k, v, tip) => { const s = document.createElement('span'); s.className = 'val-stat'; if (tip) s.title = tip; const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    const f = (v) => Math.round(v).toLocaleString();
    add('cut', `${f(st.res.cut)} m³`, `over ${f(st.res.cutArea)} m² — material removed (after below before)`);
    add('fill', `${f(st.res.fill)} m³`, `over ${f(st.res.fillArea)} m² — material added (after above before)`);
    add('net', `${st.res.net >= 0 ? '+' : ''}${f(st.res.net)} m³`, 'fill − cut');
    add('area', `${f(st.res.area)} m²`, st.res.limit ? 'inside the perimeter, where both surfaces have a value' : 'where both surfaces have a value');
    if (st.res.limit) add('perimeter', `${f(st.res.limitArea)} m²`, `${st.res.limitLabel} — its own plan area`);
    add('cell', `${st.res.geom.dx} m`, `${st.res.nodes.toLocaleString()} nodes`);
    win.sub.textContent = `${st.res.afterLabel} − ${st.res.beforeLabel}${st.res.limit ? ` · ${st.res.limitLabel}` : ''}`;
  };
  win.el._onResized = () => { if (st.res) plotChart(cv, cutFillChartSpec(st.res)); };
  let runBtn, progEl;
  const run = async () => {
    if (st.running) return;
    const b = layerById(st.before), a = layerById(st.after);
    st.running = true; plot(); win.sub.textContent = 'sampling…';
    const rc = runCancellable(runBtn);
    try {
      st.res = await cutFill(b, a, { cell: +st.cell > 0 ? +st.cell : null, limit: normLimit(st.limit), signal: rc.signal, onProgress: (fr, t) => { progEl.textContent = `${Math.round(fr * 100)}% · ${t}`; } });
      if (st.layer) { progEl.textContent = 'making the Δz layer…'; await cutFillLayer(st.res, b, a); }
      $('#meta').textContent = `cut / fill ${nameOf(a)} − ${nameOf(b)}: cut ${Math.round(st.res.cut).toLocaleString()} m³ · fill ${Math.round(st.res.fill).toLocaleString()} m³ · net ${Math.round(st.res.net).toLocaleString()} m³`;
    } catch (e) { win.el._runFailed = e.name === 'AbortError' ? 'cancelled' : e.message; win.sub.textContent = e.name === 'AbortError' ? 'cancelled' : `cut / fill: ${e.message}`; }
    finally { st.running = false; rc.done(); progEl.textContent = ''; plot(); }
  };
  const head = (t) => Object.assign(document.createElement('div'), { className: 'sw-h', textContent: t });
  const row = (label, el) => { const r = document.createElement('div'); r.className = 'sw-row'; const l = document.createElement('span'); l.textContent = label; l.style.cssText = 'width:54px;flex:0 0 auto'; r.append(l, el); el.style.flex = '1'; el.style.minWidth = '0'; return r; };
  const lsel = (val, onch, title) => { const s = document.createElement('select'); s.className = 'sw-sel'; s.title = title; for (const L of cutFillSurfaces()) s.append(new Option(`${nameOf(L)}${L.docs.gridDoc ? ' (grid)' : ' (mesh)'}`, String(L.id))); s.value = String(val); s.onchange = () => onch(+s.value); return s; };
  function buildRail() {
    rail.textContent = '';
    const sSec = document.createElement('div'); sSec.append(head('surfaces'));
    const bs = lsel(st.before, (v) => { st.before = v; }, 'the earlier surface — last survey, or the topography before mining'); bs.dataset.role = 'before';
    const as = lsel(st.after, (v) => { st.after = v; }, 'the later surface — this survey'); as.dataset.role = 'after';
    sSec.append(row('before', bs), row('after', as));
    const sw = document.createElement('button'); sw.className = 'sw-add'; sw.textContent = '⇅ swap'; sw.onclick = () => { [st.before, st.after] = [st.after, st.before]; buildRail(); };
    sSec.append(sw);
    rail.append(sSec);
    const lSec = document.createElement('div'); lSec.append(head('lattice'));
    const ci = document.createElement('input'); ci.className = 'sw-in'; ci.type = 'text'; ci.value = st.cell; ci.placeholder = 'auto (the finer grid’s)'; ci.title = 'node spacing; blank = the finer grid’s own nodes over the overlap'; ci.onchange = () => { st.cell = ci.value.trim(); };
    lSec.append(row('cell (m)', ci));
    lSec.append(limitRow(st, () => buildRail(), { label: 'perimeter', width: '54px' }));
    const ll = document.createElement('label'); ll.className = 'sw-row'; ll.title = 'add the Δz grid as a layer (a flat sheet above the two, red = cut, blue = fill)';
    const lcb = document.createElement('input'); lcb.type = 'checkbox'; lcb.checked = st.layer; lcb.onchange = () => { st.layer = lcb.checked; };
    ll.append(lcb, document.createTextNode(' Δz layer')); lSec.append(ll);
    rail.append(lSec);
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rname = () => `cutfill ${baseOf(layerById(st.after))} - ${baseOf(layerById(st.before))}`;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => saveRecipe('cutfill', cfgOf(), rname());
    win.el._recipe = () => ({ tool: 'cutfill', name: rname(), params: cfgOf(false) });   // ⇥ figure re-runs the numbers, never a second layer
    const resRow = plotExportBtns(cv, () => `cutfill-${baseOf(layerById(st.after))}.png`.replace(/[^\w.-]+/g, '_'), () => (st.res ? cutFillHumanTSV(st.res) : null), 'cutfill');
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, progEl); rail.append(foot);
  }
  buildRail(); plot();
  _win = { win, st, run, plot };
  if (ropts.run) run();
  return _win;
}

// ── its palette command + the Tools menu row (src/commands.js) ──
registerCommands([
  { id: 'cutfill', group: 'Analyse', title: 'Cut / fill between surfaces…', kw: 'cut fill volume surveys as-built pit progress dz difference earthworks excavated removed added dem topography reconciliation month', when: () => cutFillSurfaces().length >= 2, run: (c) => openCutFill(c.L) },
]);
contributeMenu('tools', () => (cutFillSurfaces().length >= 2 ? [{ label: 'Cut / fill between surfaces…', action: () => openCutFill(null) }] : []));
