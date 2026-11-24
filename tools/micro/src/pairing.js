// micro — BLOCK vs SAMPLE: every sample paired with the block it falls in, the
// most direct check that an estimate honours its data. Samples are a points layer
// (composites, a sample file) or a drillhole layer (each interval at its midpoint);
// the block is found by the model's own lattice (one pass to read the column into
// cell order, one pass over the samples). Shown as a scatter or a Q–Q plot with
// the 1:1 line, and a table — overall and by domain — of the pairs, both means,
// the bias of the blocks against the samples, the correlation and the slope of
// block on sample (below 1 = the estimate is smoother than the data: conditional
// bias). "select the disagreeing samples" marks the samples whose block differs by
// more than a factor, on the samples' layer. Nothing is written to either layer.
import { layerRecords, layerTableHeader, numOf, attrRowCountOf, schemaExt } from './records.js';
import { qualifiedNumber, supportOfHeader, supportToLattice } from '../../../ext/condenser/src/main.js';
import { floatWin, focusWindow } from './windows.js';
import { fmtStat } from './analysis-ui.js';
import { drawXY } from './xyplot.js';
import { applyLayerSelection } from './selection.js';
import { S, layerById, requestRender } from './state.js';
import { numericColsOf } from './analysis.js';
const $ = (s) => document.querySelector(s);
export const _pairWins = new Map();
const CELL_ARRAY_MAX = 16e6;                               // cells read into a typed array up to here, a Map beyond

// the model's lattice (the block-support contract), or why there isn't one to pair against.
// A rotated lattice pairs in its own frame (frame: world → lattice before the cell lookup);
// a sub-blocked model has no one cell per block to look a sample up in.
function latticeOf(M) {
  const h = M.docs && M.docs.blockDoc && M.docs.blockDoc.header;
  if (!h) return { why: 'not a block model' };
  const sup = supportOfHeader(h);
  if (!sup) return { why: 'the model has no block grid (opened as points)' };
  if (sup.sub) return { why: 'a sub-blocked model — pairing reads regular lattices only' };
  const g = h.grid;
  return { g, nx: g.x.count, ny: g.y.count, nz: g.z.count, frame: sup.frame.rotated ? sup.frame : null, q: [0, 0, 0] };
}
// a column's position in the rows layerRecords yields (file columns, then paint, then calc)
const extIdx = (L, h, name) => schemaExt(L, h).map((c) => c.name).indexOf(name);
const cellOf = (lt, x, y, z) => {
  const g = lt.g;
  if (lt.frame) { const q = supportToLattice(lt.frame, x, y, z, lt.q); x = q[0]; y = q[1]; z = q[2]; }
  const i = Math.floor((x - g.x.origin) / g.x.pitch + 0.5), j = Math.floor((y - g.y.origin) / g.y.pitch + 0.5), k = Math.floor((z - g.z.origin) / g.z.pitch + 0.5);
  if (i < 0 || j < 0 || k < 0 || i >= lt.nx || j >= lt.ny || k >= lt.nz) return -1;
  return i + lt.nx * (j + lt.ny * k);
};

/** The layers that can be samples: points layers with coordinates, drillhole layers. */
export function sampleLayers(M) {
  return S.layers.filter((L) => L !== M && L.viewOf == null && !L.trace && ((L.dh && L.docs.dhDoc) || (L.docs && L.docs.blockDoc && L.docs.blockDoc.forcePoints) || (L.docs && L.docs.blockDoc && !L.docs.blockDoc.header.grid)));
}
const columnsOf = (L) => {
  if (L.dh && L.docs.dhDoc) { const h = L.docs.dhDoc.header; return (h.numericColumns || []).map((c) => c.name); }
  return numericColsOf(L);
};
const textColsOf = (L) => {
  const h = layerTableHeader(L); if (!h) return [];
  const num = new Set(columnsOf(L)); const m = h.mapping || {};
  return h.columns.filter((c, i) => !num.has(c) && i !== m.x && i !== m.y && i !== m.z);
};

/**
 * Pair M's blocks with S's samples. opts: blockCol, sampleCol, groupCol (a text
 * column of the MODEL — the domain a pair sits in), signal, onProgress.
 * → { pairs: { s: Float64Array, b: Float64Array, rec: Uint32Array, grp: Uint16Array }, n, groups: [names],
 *     outside, noBlock, noValue, stats: [{ group, n, sMean, bMean, bias, r, slope }] }
 */
export async function pairBlocksSamples(M, Sm, { blockCol, sampleCol, groupCol = '', signal = null, onProgress = null } = {}) {
  const lt = latticeOf(M);
  if (!lt.g) throw new Error(lt.why);
  const hM = layerTableHeader(M), mM = hM.mapping;
  const bi = extIdx(M, hM, blockCol); if (bi < 0) throw new Error(`the model has no column ${blockCol}`);
  const gi = groupCol ? extIdx(M, hM, groupCol) : -1;
  const cells = lt.nx * lt.ny * lt.nz;
  const dense = cells <= CELL_ARRAY_MAX;
  const val = dense ? new Float64Array(cells).fill(NaN) : new Map();
  const grpOf = gi >= 0 ? (dense ? new Uint16Array(cells) : new Map()) : null;
  const groups = gi >= 0 ? [''] : ['all'], gIdx = new Map([['', 0]]);
  let N = 0;
  for await (const { f } of layerRecords(M)) {
    if (signal && signal.aborted) throw new Error('cancelled');
    const c = cellOf(lt, numOf(f[mM.x]), numOf(f[mM.y]), numOf(f[mM.z]));
    if (c < 0) continue;
    const v = numOf(f[bi]);
    if (dense) val[c] = v; else val.set(c, v);
    if (grpOf) {
      const gname = f[gi] == null ? '' : String(f[gi]).trim();
      let g2 = gIdx.get(gname); if (g2 === undefined) { g2 = groups.length; groups.push(gname); gIdx.set(gname, g2); }
      if (dense) grpOf[c] = g2; else grpOf.set(c, g2);
    }
    if (onProgress && (++N % 100000 === 0)) { onProgress(`reading the model… ${N.toLocaleString()} blocks`); await new Promise((r) => setTimeout(r, 0)); }
  }
  // the samples
  const sv = [], bv = [], rv = [], gv = [];
  let outside = 0, noBlock = 0, noValue = 0;
  const take = (rec, pos, raw) => {
    const s = typeof raw === 'number' ? raw : qualifiedNumber(raw == null ? '' : String(raw).trim());
    if (!Number.isFinite(s)) { noValue++; return; }
    if (!pos) { noValue++; return; }
    const c = cellOf(lt, pos[0], pos[1], pos[2]);
    if (c < 0) { outside++; return; }
    const b = dense ? val[c] : val.get(c);
    if (!Number.isFinite(b)) { noBlock++; return; }
    sv.push(s); bv.push(b); rv.push(rec); gv.push(grpOf ? (dense ? grpOf[c] : grpOf.get(c) || 0) : 0);
  };
  if (Sm.dh && Sm.docs.dhDoc) {
    const d = Sm.docs.dhDoc, si = d.header.columns.indexOf(sampleCol);
    if (si < 0) throw new Error(`the samples have no column ${sampleCol}`);
    for (let rec = 0; rec < d.header.count; rec++) { const f = d.fetchRecord(rec); if (f) take(rec, d.recordPosition(rec), f[si]); }
  } else {
    const hS = layerTableHeader(Sm), mS = hS.mapping, si = extIdx(Sm, hS, sampleCol);
    if (si < 0) throw new Error(`the samples have no column ${sampleCol}`);
    for await (const { f, rec } of layerRecords(Sm)) take(rec, [numOf(f[mS.x]), numOf(f[mS.y]), numOf(f[mS.z])], f[si]);
  }
  const n = sv.length;
  const pairs = { s: Float64Array.from(sv), b: Float64Array.from(bv), rec: Uint32Array.from(rv), grp: Uint16Array.from(gv) };
  const statsOf = (pick, name) => {
    let k = 0, ss = 0, sb = 0, sss = 0, sbb = 0, ssb = 0;
    for (let i = 0; i < n; i++) { if (!pick(i)) continue; const a = pairs.s[i], b = pairs.b[i]; k++; ss += a; sb += b; sss += a * a; sbb += b * b; ssb += a * b; }
    if (!k) return null;
    const ms = ss / k, mb = sb / k, vs = sss / k - ms * ms, vb = sbb / k - mb * mb, cov = ssb / k - ms * mb;
    return { group: name, n: k, sMean: ms, bMean: mb, bias: ms ? (mb - ms) / Math.abs(ms) : null, r: vs > 0 && vb > 0 ? cov / Math.sqrt(vs * vb) : null, slope: vs > 0 ? cov / vs : null };
  };
  const stats = [statsOf(() => true, 'all')];
  if (grpOf) groups.forEach((name, g2) => { const st = statsOf((i) => pairs.grp[i] === g2, name || '(blank)'); if (st) stats.push(st); });
  return { pairs, n, groups, outside, noBlock, noValue, stats, samplesOf: Sm.id, modelOf: M.id };
}

/** Select, on the samples' layer, the paired samples whose block differs by more than `factor` (either way). */
export function selectDisagreeing(res, factor = 2) {
  const L = layerById(res.samplesOf); if (!L) return 0;
  const n = attrRowCountOf(L) || (L.docs.dhDoc && L.docs.dhDoc.header.count) || 0;
  const mask = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < res.n; i++) {
    const a = res.pairs.s[i], b = res.pairs.b[i];
    const off = a > 0 && b > 0 ? Math.max(a / b, b / a) > factor : Math.abs(a - b) > 0 && (a <= 0 || b <= 0) && Math.max(Math.abs(a), Math.abs(b)) > 0;
    if (off) { mask[res.pairs.rec[i]] = 1; k++; }
  }
  L._selMask = mask; applyLayerSelection(L); requestRender();
  return k;
}

export function openPairing(M, ropts = {}) {
  const lt = latticeOf(M);
  if (!lt.g) { $('#meta').textContent = `block vs sample: ${lt.why}`; return null; }
  const ex = _pairWins.get(M.id); if (ex && ex.win.el.isConnected) { focusWindow(ex.win.el); return ex; }
  const cands = sampleLayers(M);
  if (!cands.length) { $('#meta').textContent = 'block vs sample: open the samples first — composites, a sample file or drillholes'; return null; }
  const mCols = columnsOf(M);
  const st = { samples: cands[0].id, sCol: null, bCol: mCols[0] || null, group: '', mode: 'scatter', log: false, factor: 2, res: null, err: null, busy: false };
  const win = floatWin({ title: `block vs sample · ${M.label || M.name}`, sub: 'pick the samples, then Run', x: Math.max(12, innerWidth - 820), y: 96, w: 780, h: 480,
    onClose: () => { _pairWins.delete(M.id); } });
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main st-main'; main.style.display = 'flex'; main.style.flexDirection = 'column';
  body.append(rail, main);
  const entry = { win, st, run: null };
  _pairWins.set(M.id, entry);
  const sel = (opts, v, on) => { const s = document.createElement('select'); s.className = 'sw-sel'; for (const [k, t] of opts) s.append(new Option(t, k)); if (v != null) s.value = String(v); s.onchange = () => on(s.value); return s; };
  const row = (label, el, title) => { const r = document.createElement('div'); r.className = 'sw-row'; if (title) r.title = title; const s = document.createElement('span'); s.textContent = label; s.style.width = '64px'; r.append(s, el); rail.append(r); return el; };
  const sSel = row('samples', sel(cands.map((L) => [L.id, L.label || L.name]), st.samples, (v) => { st.samples = +v; fillS(); }), 'composites, a sample file, or drillholes (intervals at their midpoints)');
  const sColSel = row('sample', document.createElement('select'), 'the samples’ grade column');
  sColSel.className = 'sw-sel'; sColSel.onchange = () => { st.sCol = sColSel.value; };
  const fillS = () => {
    const L = layerById(st.samples), cs = L ? columnsOf(L) : [];
    sColSel.textContent = ''; for (const c of cs) sColSel.append(new Option(c, c));
    st.sCol = cs.includes(st.bCol) ? st.bCol : cs[0] || null; if (st.sCol) sColSel.value = st.sCol;
  };
  const bSel = row('block', sel(mCols.map((c) => [c, c]), st.bCol, (v) => { st.bCol = v; }), 'the model’s estimated column');
  const gSel = row('by', sel([['', '(all together)'], ...textColsOf(M).map((c) => [c, c])], st.group, (v) => { st.group = v; }), 'split the table by a domain column of the model');
  fillS();
  void sSel;
  const runB = document.createElement('button'); runB.className = 'awin-btn btn-p'; runB.textContent = 'Run';
  const fr = document.createElement('div'); fr.className = 'sw-row'; fr.append(runB); rail.append(fr);
  const plotBar = document.createElement('div'); plotBar.className = 'sw-row';
  const modeSel = sel([['scatter', 'scatter'], ['qq', 'Q–Q']], st.mode, (v) => { st.mode = v; draw(); });
  modeSel.style.flex = '0 0 auto';
  const logL = document.createElement('label'); const logC = document.createElement('input'); logC.type = 'checkbox'; logC.onchange = () => { st.log = logC.checked; draw(); }; logL.append(logC, ' log');
  plotBar.append(modeSel, logL);
  const cv = document.createElement('canvas'); cv.style.cssText = 'flex:1;min-height:180px;width:100%';
  const tbl = document.createElement('div'); tbl.style.cssText = 'flex:0 0 auto;max-height:40%;overflow:auto';
  const foot = document.createElement('div'); foot.className = 'sw-row';
  const fIn = document.createElement('input'); fIn.className = 'sw-in'; fIn.type = 'number'; fIn.min = '1.1'; fIn.step = '0.5'; fIn.value = '2'; fIn.style.cssText += ';flex:0 0 56px;width:56px';
  const selB = document.createElement('button'); selB.className = 'awin-btn'; selB.textContent = 'select the disagreeing samples';
  selB.title = 'on the samples’ layer: the paired samples whose block differs by more than this factor, either way';
  const fNote = document.createElement('span'); fNote.style.cssText = 'color:var(--muted)';
  selB.onclick = () => { if (!st.res) return; const k = selectDisagreeing(st.res, +fIn.value || 2); fNote.textContent = `${k.toLocaleString()} selected`; };
  foot.append(selB, document.createTextNode(' by more than ×'), fIn, fNote);
  main.append(plotBar, cv, tbl, foot);
  const draw = () => {
    const r = st.res;
    if (!r || !r.n) { drawXY(cv, null); return; }
    const lg = st.log, P = (v) => (lg ? Math.log10(v) : v);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < r.n; i++) for (const v of [r.pairs.s[i], r.pairs.b[i]]) { if (lg && !(v > 0)) continue; const u = P(v); if (u < lo) lo = u; if (u > hi) hi = u; }
    if (!(hi > lo)) { hi = lo + 1; }
    const pad = (hi - lo) * 0.04, rng = [lo - pad, hi + pad];
    if (st.mode === 'qq') {
      const a = Float64Array.from(r.pairs.s).sort(), b = Float64Array.from(r.pairs.b).sort();
      const qq = []; for (let k = 0; k <= 100; k++) { const i = Math.min(r.n - 1, Math.round(k / 100 * (r.n - 1))); qq.push([a[i], b[i], k % 10 === 0]); }
      drawXY(cv, { xr: rng, yr: rng, logX: lg, logY: lg, xLabel: `sample ${st.sCol}`, yLabel: `block ${st.bCol}`, qq, line11: true });
    } else {
      const pts = new Float64Array(r.n * 2); for (let i = 0; i < r.n; i++) { pts[2 * i] = r.pairs.s[i]; pts[2 * i + 1] = r.pairs.b[i]; }
      drawXY(cv, { xr: rng, yr: rng, logX: lg, logY: lg, xLabel: `sample ${st.sCol}`, yLabel: `block ${st.bCol}`, points: pts, line11: true });
    }
  };
  const render = () => {
    tbl.textContent = '';
    if (st.err) { tbl.textContent = st.err; win.sub.textContent = 'block vs sample'; draw(); return; }
    const r = st.res; if (!r) { draw(); return; }
    win.sub.textContent = `${r.n.toLocaleString()} pairs`;
    const t = document.createElement('table'); t.className = 'st-tbl';
    const hr = document.createElement('tr'); for (const x of [st.group || '', 'pairs', 'sample mean', 'block mean', 'bias', 'r', 'slope']) { const th = document.createElement('th'); th.textContent = x; hr.append(th); } t.append(hr);
    for (const s2 of r.stats) {
      const tr = document.createElement('tr');
      const td = (v, cls) => { const c = document.createElement('td'); c.textContent = v; if (cls) c.className = cls; tr.append(c); return c; };
      td(s2.group); td(s2.n.toLocaleString(), 'num'); td(fmtStat(s2.sMean), 'num'); td(fmtStat(s2.bMean), 'num');
      const b = td(s2.bias == null ? '—' : `${s2.bias >= 0 ? '+' : ''}${(100 * s2.bias).toFixed(1)}%`, 'num'); if (s2.bias != null && Math.abs(s2.bias) > 0.1) b.style.color = 'var(--caution)';
      td(s2.r == null ? '—' : s2.r.toFixed(2), 'num');
      const sl = td(s2.slope == null ? '—' : s2.slope.toFixed(2), 'num'); if (s2.slope != null && (s2.slope < 0.8 || s2.slope > 1.2)) sl.style.color = 'var(--caution)';
      t.append(tr);
    }
    tbl.append(t);
    const skipped = [r.outside && `${r.outside} outside the model`, r.noBlock && `${r.noBlock} in no block / a blank block`, r.noValue && `${r.noValue} without a value`].filter(Boolean);
    if (skipped.length) { const d = document.createElement('div'); d.style.cssText = 'color:var(--dim);font-size:11px;margin-top:4px'; d.textContent = `not paired: ${skipped.join(' · ')} · bias = block mean vs sample mean · slope = block on sample (below 1: smoother than the data)`; tbl.append(d); }
    draw();
  };
  const run = async () => {
    if (st.busy) return st.res;
    st.busy = true; st.err = null; runB.disabled = true; win.sub.textContent = 'pairing…';
    try {
      const Sm = layerById(st.samples);
      if (!Sm) throw new Error('the samples’ layer is gone');
      st.res = await pairBlocksSamples(M, Sm, { blockCol: st.bCol, sampleCol: st.sCol, groupCol: st.group, onProgress: (t) => { win.sub.textContent = t; } });
    } catch (e) { st.err = `block vs sample: ${e.message}`; st.res = null; }
    st.busy = false; runB.disabled = false;
    render();
    return st.res;
  };
  runB.onclick = run;
  win.el._onResized = () => draw();
  entry.run = run; entry.set = (o) => { Object.assign(st, o); if (o.samples != null) { sSel.value = String(o.samples); fillS(); } if (o.sCol) sColSel.value = o.sCol; if (o.bCol) bSel.value = o.bCol; if (o.group != null) gSel.value = o.group; };
  render();
  if (ropts.samples != null) entry.set({ samples: ropts.samples });
  return entry;
}
