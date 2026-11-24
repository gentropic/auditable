// micro validation — the model checked against its drillholes: the samples
// declustered (@gcu/gsjs cell weights), the global bias (model vs declustered
// sample mean) and a model-vs-sample swath. Carved from index.html (phase 3).
import { S, layerById } from './state.js';
import { gridAxesOf } from './grid-ops.js';
import { floatWin, focusWindow } from './windows.js';
import { autoDeclusterSizes, computeSampleSwath, computeSwath, extractSamples, numericColsOf } from './analysis.js';
import { SERIES_COLORS, applyAnalysisGeo, fmtStat, niceStep, plotChart, plotExportBtns, saveAnalysisCfg } from './analysis-ui.js';
import { declusterCell, declusterSweep } from '../../../ext/gsjs/src/decluster.js';
import { AXIS_NAMES, projRange } from './swath.js';
import { compileBool, deps as exprDeps } from '../../../ext/expr/index.js';
import { layerTableHeader, schemaExt } from './records.js';
import { ensureStoredValues } from './columns.js';
import { saveRecipe } from './recipes.js';
import { registerCommands } from './commands.js';
const $ = (s) => document.querySelector(s);

// ── validation: block model vs drillhole samples ──────────────────────────────
// The resource-geology check: is the model globally (bias) and locally (swaths)
// consistent with the DECLUSTERED drillhole samples? Declustering (gsjs) de-bias
// the samples — spatial sampling over-drills high grade, so a naïve sample mean
// is inflated. Global bias = model mean vs declustered sample mean; swaths
// overlay model-grade vs sample-grade per slab. (Support differs — samples are
// point support, blocks are block support — so a GLOBAL grade offset can be
// real; the swaths flag LOCAL/conditional bias.)
export const drillholeLayers = () => S.layers.filter((L) => L.dh && L.docs.dhDoc);

// (extractSamples / autoDeclusterSizes / computeSampleSwath live in src/analysis.js)
export const _valWins = new Map();

// the validation numbers — the window and the validation tool both call this. The samples are
// declustered (a given cell, or the auto-sweep's minimum-mean cell); the model mean is volume ×
// grade over the model's swath bands; bias = model / declustered samples − 1, in percent.
// bandW/off: the swath lattice (default: the window's — about 25 bands from the model's extent,
// never narrower than a block, starting at the extent's low end).
// filter: ONE expression applied to both sides — a domain (LITO != "WASTE") — so a model is validated
// where it was drilled. A whole-model mean carries every waste block no hole samples, and no
// declustering can stand in for samples that were never taken; comparing per domain is the practice.
// The names it uses must exist on BOTH layers (a model and its assays usually share LITO / DOMAIN).
// Both sides resolve the FULL census — calc (ƒ), painted and materialized columns included — so a
// calc sample grade or a painted domain flag reads the same on the samples as on the model.
function domainPreds(M, D, filter) {
  if (!filter || !String(filter).trim()) return { mp: null, sp: null };
  const expr = String(filter), hm = layerTableHeader(M), hd = layerTableHeader(D);
  let mp, sp;
  try { mp = compileBool(expr, schemaExt(M, hm), { decimal: '.' }); } catch (e) { throw new Error(`filter on the model (${M.label || M.name}): ${e.message}`); }
  try { sp = compileBool(expr, schemaExt(D, hd), { decimal: '.' }); } catch (e) { throw new Error(`filter on the samples (${D.label || D.name}): ${e.message}`); }
  try { mp.deps = exprDeps(expr); } catch { /* deps are a hint for stored values */ }
  return { mp, sp };
}
export async function validationRun({ M, D, mGrade, sGrade, cell = null, axis = 0, bandW = null, off = null, filter = '' }) {
  const { mp, sp } = domainPreds(M, D, filter);
  // the samples' materialized inputs resident (an evicted column would read blank → no samples)
  const need = new Set([String(sGrade).toLowerCase()]);
  if (filter && String(filter).trim()) { try { for (const d of exprDeps(String(filter))) need.add(String(d).toLowerCase()); } catch { /* the compile named it */ } }
  await ensureStoredValues(D, need);
  const samples = extractSamples(D, sGrade, sp);
  if (samples.length < 2) throw new Error(`not enough samples (${samples.length}) with a value in “${sGrade}”`);
  let weights, cellUsed, declMean, naiveMean;
  try {
    if (cell) { const r = declusterCell({ data: samples, cellSize: cell }); weights = r.weights; cellUsed = cell; declMean = r.mean; naiveMean = r.naiveMean; }
    else { const sw = declusterSweep({ data: samples, sizes: autoDeclusterSizes(samples), pick: 'min' }); weights = sw.best.weights; cellUsed = sw.best.size; declMean = sw.best.mean; naiveMean = sw.naiveMean; }
  } catch (e) { throw new Error(`decluster: ${e.message}`); }
  const { bw, off: o } = validationBands(M, axis, bandW, off);
  const dir = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][axis];
  const mres = await computeSwath(M, [mGrade], dir, bw, o, '', null, null, mp);
  let mt = 0, mtg = 0; for (const p of mres.profile) if (Number.isFinite(p.mean[0])) { mt += p.tonnage; mtg += p.tonnage * p.mean[0]; }
  const modelMean = mt > 0 ? mtg / mt : NaN;
  const sres = computeSampleSwath(samples, weights, dir, bw, o);
  const biasPct = declMean > 0 ? (modelMean / declMean - 1) * 100 : NaN;
  return { samples, weights, cellUsed, declMean, naiveMean, modelMean, biasPct, mres, sres, bandW: bw, off: o, axis };
}
// the swath lattice along an axis: a stated band width / offset, else the automatic one — about
// 25 bands over the model's extent, never narrower than a block, from the extent's low end
export function validationBands(M, axis, bandW = null, off = null) {
  const ga = gridAxesOf(M), dir = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][axis], [lo, hi] = projRange(M, dir);
  const blockAlong = (Math.abs((ga.x.pitch || 0) * dir[0]) + Math.abs((ga.y.pitch || 0) * dir[1]) + Math.abs((ga.z.pitch || 0) * dir[2])) || 1;
  const bw = bandW > 0 ? +bandW : Math.max(blockAlong, niceStep((hi - lo) / 25) || 1);
  return { bw, off: off != null && off !== '' && Number.isFinite(+off) ? +off : lo, lo, hi };
}

// the window's setup → the tool's params (names, not ids), and back
const AX = ['X', 'Y', 'Z'];
export function validationCfgOf(M, st) {
  const D = layerById(st.dh);
  return {
    model: M.name, samples: D ? D.name : null, modelGrade: st.mGrade, sampleGrade: st.sGrade,
    ...(st.cell ? { cell: +st.cell } : {}), axis: AX[st.axis] || 'X',
    ...(st.bandW > 0 ? { bandW: +st.bandW } : {}), ...(st.off != null && st.off !== '' ? { off: +st.off } : {}),
    ...(st.filter ? { filter: st.filter } : {}), tolerance: st.tolerance,
  };
}

export function openValidation(M, ropts) {
  if (!M || !gridAxesOf(M)) { $('#meta').textContent = 'validation: needs a regular block model'; return; }
  const dhs = drillholeLayers(); if (!dhs.length) { $('#meta').textContent = 'validation: open a drillhole layer (the samples) first'; return; }
  const ex = _valWins.get(M.id);
  if (ex) { if (!ropts || !ropts.cfg) { focusWindow(ex.win.el); return ex; } ex.win.close(); }   // a recipe replaces the open window
  const mnums = numericColsOf(M); if (!mnums.length) { $('#meta').textContent = 'validation: the model has no numeric column'; return; }
  const D0 = dhs[0], snums = numericColsOf(D0), shared = mnums.find((c) => snums.includes(c));
  // bandW / off: null = automatic (the window's default lattice); tolerance: the bias band, ±10% by default
  const st = { dh: D0.id, mGrade: shared || mnums[0], sGrade: shared || snums[0] || null, cell: null, axis: 0, filter: '', bandW: null, off: null, tolerance: 0.1 };
  // a recipe (explicitly picked) beats the saved setup beats the defaults
  const cfg = (ropts && ropts.cfg) || (M.analysis && M.analysis.validation);
  if (cfg) {
    const Dn = cfg.samples && dhs.find((x) => x.name === cfg.samples || (x.label || x.name) === cfg.samples); if (Dn) st.dh = Dn.id;
    if (cfg.modelGrade) st.mGrade = cfg.modelGrade; if (cfg.sampleGrade) st.sGrade = cfg.sampleGrade;
    if (cfg.cell) st.cell = +cfg.cell; if (cfg.filter) st.filter = String(cfg.filter); if (cfg.axis) st.axis = Math.max(0, AX.indexOf(cfg.axis));
    if (cfg.bandW > 0) st.bandW = +cfg.bandW;
    if (cfg.off != null && cfg.off !== '' && Number.isFinite(+cfg.off)) st.off = +cfg.off;
    if (cfg.tolerance != null && Number.isFinite(+cfg.tolerance) && +cfg.tolerance >= 0) st.tolerance = +cfg.tolerance;
  }
  const cfgOf = () => validationCfgOf(M, st);
  const win = floatWin({ title: `validate · ${M.label || M.name}`, sub: '', x: 90, y: 90, w: 600, h: 440,
    onClose: () => { saveAnalysisCfg(M, 'validation', cfgOf(), win); _valWins.delete(M.id); } });
  win.el.dataset.validation = '1';
  applyAnalysisGeo(M, 'validation', win);
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:0';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:80px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout';
  const ctrls = document.createElement('div'); ctrls.className = 'awin-ctrls';
  const ctrls2 = document.createElement('div'); ctrls2.className = 'awin-ctrls val-ctrls2';
  win.body.append(cv, readout, ctrls, ctrls2);
  const tol = () => (Number.isFinite(+st.tolerance) && +st.tolerance >= 0 ? +st.tolerance : 0.1);
  let last = null, bwIn = null, offIn = null;
  const showReadout = () => {
    readout.textContent = '';
    if (!last) return;
    const { declMean, naiveMean, modelMean } = last, bias = last.biasPct;
    const add = (k, v, cls, tip) => { const s = document.createElement('span'); s.className = 'val-stat' + (cls ? ' ' + cls : ''); if (tip) s.title = tip; const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    add('model', fmtStat(modelMean)); add('samples (decl)', fmtStat(declMean)); add('naïve', fmtStat(naiveMean));
    const out = Number.isFinite(bias) && Math.abs(bias) > 100 * tol() + 1e-9;
    add('global bias', (bias >= 0 ? '+' : '') + (Number.isFinite(bias) ? bias.toFixed(1) : '–') + '%', out ? 'bad' : 'ok', out ? `outside ±${+(100 * tol()).toFixed(1)}%` : `within ±${+(100 * tol()).toFixed(1)}%`);
  };
  const redraw = async () => {
    const D = layerById(st.dh); if (!D || !st.sGrade) { win.sub.textContent = 'pick a sample grade'; return; }
    win.sub.textContent = 'sampling…'; win.el._runFailed = null;
    let v;
    try { v = await validationRun({ M, D, mGrade: st.mGrade, sGrade: st.sGrade, cell: st.cell, axis: st.axis, bandW: st.bandW, off: st.off, filter: st.filter }); }
    catch (e) { win.el._runFailed = e.message; win.sub.textContent = e.message; last = null; readout.textContent = ''; plotChart(cv, { series: [] }); return; }
    last = v;
    const { samples, cellUsed, mres, sres } = v;
    const spec = { xLabel: `distance along ${AXIS_NAMES.axes[st.axis]}`, leftLabel: 'mean grade', rightLabel: 'samples', series: [
      { name: 'samples', color: '#6a6f75', axis: 'right', kind: 'bar', data: sres.map((p) => [p.center, p.count]) },
      { name: `model · ${st.mGrade}`, color: SERIES_COLORS[0], axis: 'left', kind: 'line', data: mres.profile.map((p) => [p.center, p.mean[0]]) },
      { name: `samples · ${st.sGrade}`, color: SERIES_COLORS[1], axis: 'left', kind: 'line', data: sres.map((p) => [p.center, p.mean]) },
    ] };
    plotChart(cv, spec); win._spec = spec;
    showReadout();
    win.sub.textContent = `${samples.length.toLocaleString()} samples · decluster cell ${fmtStat(cellUsed)} m · ${AXIS_NAMES.axes[st.axis]} · bands ${fmtStat(v.bandW)} m from ${fmtStat(v.off)}${st.bandW > 0 ? '' : ' (auto)'}${st.filter ? ` · domain ${st.filter}` : ''}`;
    if (bwIn) bwIn.placeholder = `auto ${fmtStat(v.bandW)}`;
    if (offIn) offIn.placeholder = `auto ${fmtStat(v.off)}`;
    saveAnalysisCfg(M, 'validation', cfgOf(), win);
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  const numIn = (label, val, ph, title, onch, w = '64px') => {
    const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.style.width = w; i.placeholder = ph; i.value = val != null ? String(val) : ''; i.title = title;
    i.onchange = () => onch(i.value === '' ? null : +i.value, i); l.appendChild(i); return l;
  };
  const buildCtrls = () => {
    ctrls.textContent = ''; ctrls2.textContent = '';
    const dSel = document.createElement('select'); for (const L of drillholeLayers()) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; dSel.appendChild(o); } dSel.value = String(st.dh); dSel.title = 'the drillhole samples'; dSel.onchange = () => { st.dh = +dSel.value; const sn = numericColsOf(layerById(st.dh)); st.sGrade = sn.includes(st.mGrade) ? st.mGrade : sn[0]; buildCtrls(); redraw(); };
    const mSel = document.createElement('select'); for (const c of mnums) { const o = document.createElement('option'); o.value = c; o.textContent = 'model: ' + c; mSel.appendChild(o); } mSel.value = st.mGrade; mSel.onchange = () => { st.mGrade = mSel.value; redraw(); };
    // the samples' numeric columns, derived ones included (a calc grade, a materialized estimate)
    const sSel = document.createElement('select'); for (const c of numericColsOf(layerById(st.dh))) { const o = document.createElement('option'); o.value = c; o.textContent = 'sample: ' + c; sSel.appendChild(o); } sSel.value = st.sGrade || ''; sSel.onchange = () => { st.sGrade = sSel.value; redraw(); };
    const cL = numIn('cell', st.cell, 'auto', 'decluster cell size (m) — blank = auto-sweep (the minimum-mean cell)', (v) => { st.cell = v > 0 ? v : null; redraw(); }, '68px');
    // a domain: one expression on both sides (the names must exist on the model AND the samples)
    const fI = document.createElement('input'); fI.type = 'text'; fI.style.width = '150px'; fI.placeholder = 'domain, e.g. LITO != "WASTE"'; fI.value = st.filter; fI.title = 'validate inside a domain — one expression applied to the model and the samples (blank = everything); derived columns count on both sides'; fI.onchange = () => { st.filter = fI.value.trim(); redraw(); };
    const seg = document.createElement('div'); seg.className = 'pp-seg';
    // a stated band width belongs to ONE axis — switching the axis returns it (and the offset) to automatic
    AX.forEach((nm, i) => { const bt = document.createElement('button'); bt.className = 'pp-segbtn' + (st.axis === i ? ' on' : ''); bt.textContent = nm; bt.onclick = () => { if (st.axis === i) return; st.axis = i; st.bandW = null; st.off = null; buildCtrls(); redraw(); }; seg.appendChild(bt); });
    ctrls.append(dSel, mSel, sSel, cL, fI, seg);
    // the swath lattice + the bias band + the footer actions
    const bwL = numIn('band', st.bandW, last ? `auto ${fmtStat(last.bandW)}` : 'auto', 'swath band width (m) along the axis — blank = automatic (about 25 bands, never narrower than a block)', (v) => { st.bandW = v > 0 ? v : null; redraw(); });
    const offL = numIn('offset', st.off, last ? `auto ${fmtStat(last.off)}` : 'auto', 'where the band lattice starts (m) — blank = the low end of the model’s extent along the axis', (v) => { st.off = v; redraw(); }, '80px');
    const tolL = numIn('±', st.tolerance, '0.1', 'the global bias tolerance (0.1 = ±10%) — a bias outside it is marked', (v, i) => { if (v == null || !(v >= 0)) { i.classList.add('bad-in'); return; } i.classList.remove('bad-in'); st.tolerance = v; showReadout(); saveAnalysisCfg(M, 'validation', cfgOf(), win); }, '56px');
    const rname = () => `${(M.label || M.name).replace(/\.[^.]+$/, '')} validation`;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'awin-btn rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes) — the band width is stated, as a routine needs it';
    rcpBtn.onclick = () => saveRecipe('validation', { ...cfgOf(), bandW: st.bandW > 0 ? +st.bandW : (last ? last.bandW : undefined), off: st.off != null ? +st.off : (last ? last.off : undefined) }, rname());
    win.el._recipe = () => ({ tool: 'validation', name: rname(), params: cfgOf() });
    bwIn = bwL.querySelector('input'); offIn = offL.querySelector('input');
    ctrls2.append(bwL, offL, tolL, rcpBtn, plotExportBtns(cv, () => `validate-${(M.label || M.name).replace(/\.[^.]+$/, '')}.png`, null));
  };
  const handle = { win, redraw, st };
  _valWins.set(M.id, handle);
  buildCtrls(); redraw();
  return handle;
}

// ── its palette commands (src/commands.js; the palette order is src/command-list.js) ──
registerCommands([
  // validate vs drillholes — palette-only (not on the layer menu): shown for a gridded block model once a drillhole layer is loaded
  { id: 'validate', group: 'Analyse', title: 'Validate vs drillholes…', kw: 'declustered sample bias check reconcile composite', when: (c) => c.L && gridAxesOf(c.L) && S.layers.some((L) => L.dh), run: (c) => openValidation(c.L) },
]);
