// micro validation — the model checked against its drillholes: the samples
// declustered (@gcu/gsjs cell weights), the global bias (model vs declustered
// sample mean) and a model-vs-sample swath. Carved from index.html (phase 3).
import { S, layerById } from './state.js';
import { gridAxesOf } from './grid-ops.js';
import { floatWin, focusWindow } from './windows.js';
import { autoDeclusterSizes, computeSampleSwath, computeSwath, extractSamples, numericColsOf } from './analysis.js';
import { SERIES_COLORS, fmtStat, niceStep, plotChart, plotExportBtns } from './analysis-ui.js';
import { declusterCell, declusterSweep } from '../../../ext/gsjs/src/decluster.js';
import { AXIS_NAMES, projRange } from './swath.js';
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

export function openValidation(M) {
  if (!M || !gridAxesOf(M)) { $('#meta').textContent = 'validation: needs a regular block model'; return; }
  const dhs = drillholeLayers(); if (!dhs.length) { $('#meta').textContent = 'validation: open a drillhole layer (the samples) first'; return; }
  const ex = _valWins.get(M.id); if (ex) { focusWindow(ex.win.el); return; }
  const mnums = numericColsOf(M); if (!mnums.length) { $('#meta').textContent = 'validation: the model has no numeric column'; return; }
  const D0 = dhs[0], snums = numericColsOf(D0), shared = mnums.find((c) => snums.includes(c));
  const st = { dh: D0.id, mGrade: shared || mnums[0], sGrade: shared || snums[0] || null, cell: null, axis: 0 };
  const win = floatWin({ title: `validate · ${M.label || M.name}`, sub: '', x: 90, y: 90, w: 540, h: 420, onClose: () => _valWins.delete(M.id) });
  win.body.style.cssText += 'display:flex;flex-direction:column;gap:0';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:80px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout';
  const ctrls = document.createElement('div'); ctrls.className = 'awin-ctrls';
  win.body.append(cv, readout, ctrls);
  const redraw = async () => {
    const D = layerById(st.dh); if (!D || !st.sGrade) { win.sub.textContent = 'pick a sample grade'; return; }
    win.sub.textContent = 'sampling…';
    const samples = extractSamples(D, st.sGrade);
    if (samples.length < 2) { win.sub.textContent = 'not enough samples'; readout.textContent = ''; plotChart(cv, { series: [] }); return; }
    let weights, cellUsed, declMean, naiveMean;
    try {
      if (st.cell) { const r = declusterCell({ data: samples, cellSize: st.cell }); weights = r.weights; cellUsed = st.cell; declMean = r.mean; naiveMean = r.naiveMean; }
      else { const sw = declusterSweep({ data: samples, sizes: autoDeclusterSizes(samples), pick: 'min' }); weights = sw.best.weights; cellUsed = sw.best.size; declMean = sw.best.mean; naiveMean = sw.naiveMean; }
    } catch (e) { win.sub.textContent = `decluster: ${e.message}`; return; }
    const ga = gridAxesOf(M), dir = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][st.axis], [lo, hi] = projRange(M, dir);
    const blockAlong = (Math.abs((ga.x.pitch || 0) * dir[0]) + Math.abs((ga.y.pitch || 0) * dir[1]) + Math.abs((ga.z.pitch || 0) * dir[2])) || 1;
    const bw = Math.max(blockAlong, niceStep((hi - lo) / 25) || 1), off = lo;
    const mres = await computeSwath(M, [st.mGrade], dir, bw, off, '');
    let mt = 0, mtg = 0; for (const p of mres.profile) if (Number.isFinite(p.mean[0])) { mt += p.tonnage; mtg += p.tonnage * p.mean[0]; }
    const modelMean = mt > 0 ? mtg / mt : NaN;
    const sres = computeSampleSwath(samples, weights, dir, bw, off);
    const spec = { xLabel: `distance along ${AXIS_NAMES.axes[st.axis]}`, leftLabel: 'mean grade', rightLabel: 'samples', series: [
      { name: 'samples', color: '#6a6f75', axis: 'right', kind: 'bar', data: sres.map((p) => [p.center, p.count]) },
      { name: `model · ${st.mGrade}`, color: SERIES_COLORS[0], axis: 'left', kind: 'line', data: mres.profile.map((p) => [p.center, p.mean[0]]) },
      { name: `samples · ${st.sGrade}`, color: SERIES_COLORS[1], axis: 'left', kind: 'line', data: sres.map((p) => [p.center, p.mean]) },
    ] };
    plotChart(cv, spec); win._spec = spec;
    const bias = declMean > 0 ? (modelMean / declMean - 1) * 100 : NaN;
    readout.textContent = '';
    const add = (k, v, cls) => { const s = document.createElement('span'); s.className = 'val-stat' + (cls ? ' ' + cls : ''); const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    add('model', fmtStat(modelMean)); add('samples (decl)', fmtStat(declMean)); add('naïve', fmtStat(naiveMean));
    add('global bias', (bias >= 0 ? '+' : '') + (Number.isFinite(bias) ? bias.toFixed(1) : '–') + '%', Number.isFinite(bias) && Math.abs(bias) > 10 ? 'bad' : 'ok');
    win.sub.textContent = `${samples.length.toLocaleString()} samples · decluster cell ${fmtStat(cellUsed)} m · ${AXIS_NAMES.axes[st.axis]}`;
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  const buildCtrls = () => {
    ctrls.textContent = '';
    const dSel = document.createElement('select'); for (const L of drillholeLayers()) { const o = document.createElement('option'); o.value = String(L.id); o.textContent = L.label || L.name; dSel.appendChild(o); } dSel.value = String(st.dh); dSel.title = 'the drillhole samples'; dSel.onchange = () => { st.dh = +dSel.value; const sn = numericColsOf(layerById(st.dh)); st.sGrade = sn.includes(st.mGrade) ? st.mGrade : sn[0]; buildCtrls(); redraw(); };
    const mSel = document.createElement('select'); for (const c of mnums) { const o = document.createElement('option'); o.value = c; o.textContent = 'model: ' + c; mSel.appendChild(o); } mSel.value = st.mGrade; mSel.onchange = () => { st.mGrade = mSel.value; redraw(); };
    const sSel = document.createElement('select'); for (const c of numericColsOf(layerById(st.dh))) { const o = document.createElement('option'); o.value = c; o.textContent = 'sample: ' + c; sSel.appendChild(o); } sSel.value = st.sGrade || ''; sSel.onchange = () => { st.sGrade = sSel.value; redraw(); };
    const cL = document.createElement('label'); cL.textContent = 'cell'; const cI = document.createElement('input'); cI.type = 'number'; cI.step = 'any'; cI.style.width = '68px'; cI.placeholder = 'auto'; cI.value = st.cell != null ? String(st.cell) : ''; cI.title = 'decluster cell size (m) — blank = auto-sweep'; cI.onchange = () => { st.cell = cI.value === '' ? null : +cI.value; redraw(); }; cL.appendChild(cI);
    const seg = document.createElement('div'); seg.className = 'pp-seg';
    ['X', 'Y', 'Z'].forEach((nm, i) => { const bt = document.createElement('button'); bt.className = 'pp-segbtn' + (st.axis === i ? ' on' : ''); bt.textContent = nm; bt.onclick = () => { st.axis = i; for (const b2 of seg.children) b2.classList.toggle('on', b2 === bt); redraw(); }; seg.appendChild(bt); });
    ctrls.append(dSel, mSel, sSel, cL, seg, plotExportBtns(cv, () => `validate-${(M.label || M.name).replace(/\.[^.]+$/, '')}.png`, null));
  };
  _valWins.set(M.id, { win, redraw });
  buildCtrls(); redraw();
}
