// micro joins — two models, one answer: a SPATIAL join resamples a compatible
// model onto a target lattice (volume-weighted; sub-blocked sources scatter as
// boxes; rotated ones index in their own basis), a KEY join hash-matches by a
// column, both either to a new layer or back onto this layer's records as
// columns (layerRecords: records, not rows), and RECONCILE maps the difference.
// Carved from index.html (phase 3).
import { attrRowCountOf, blockCaps, colIsNumeric, layerRecords, layerRows, layerTableHeader, numOf } from './records.js';
import { cellOf, commonLattice, coordNum, latticeMapOf, makeBoxAggregator, makeResampler, worldMapOf, gridsCompatible } from '../../../ext/condenser/src/main.js';
import { gridAxesOf } from './grid-ops.js';
import { mkLineage } from './lineage.js';
import { matColSet, paintRecount } from './columns.js';
import { persistElement } from './element-store.js';
import { S, activeLayer, requestRender, layerById } from './state.js';
import { removeLayerUI } from './layers.js';
import { renderProps, ppNote, mkRow } from './props.js';
import { applyRamp, setRampCfg } from './ramp.js';
import { markProjectDirty } from './project.js';
import { openBlob } from './open.js';
import { renderLayers } from './layers-panel.js';
import { menuXY } from './menu.js';
import { setLayerColorSel } from './color.js';
import { addPaintValue, createPaintCol } from './paint.js';
const $ = (s) => document.querySelector(s);

// ── join & regularize ────────────────────────────────────────────────────────
// A regular block model's grid axes { x, y, z } = { origin, pitch, count } in
// WORLD coords (origin = block-0 centroid), from the header. The spatial-join
// engine (@gcu/condenser grid-join) resamples any compatible source onto a
// target lattice.
// (gridAxesOf lives in src/grid-ops.js)
// Run a spatial join: resample the requested columns from left/right onto the
// target grid T, build a target block model (a CSV blob — real data columns),
// and open it as a NEW layer. columns: [{ src:'left'|'right', name, out, op,
// num, weight }]. op for numeric: 'mean'|'sum'|'count'; categorical → majority.
export async function runSpatialJoin({ leftL, rightL, target, columns, derived = [], coverage = true, label = 'join', onProgress = null, asCells = false, useSelection = false }) {
  const T = target;
  const nx = T.x.count, ny = T.y.count, nz = T.z.count, cells = nx * ny * nz;
  if (cells > 40_000_000) throw new Error(`target grid is ${cells.toLocaleString()} cells — too large`);
  const sides = { left: leftL, right: rightL };
  const perSource = {};
  for (const side of ['left', 'right']) {
    const L = sides[side]; if (!L) continue;
    const h0 = layerTableHeader(L);
    // sub-blocked source: no source lattice — scatter each block as a volume-
    // overlap BOX onto the target (aggregates to the parent/target resolution).
    const sub = !!(h0 && h0.subBlocked && h0.dimCols);
    if (sub && T.rot) throw new Error(`${side} is sub-blocked: scattering sub-blocks onto a ROTATED lattice isn't supported yet`);
    if (sub) { perSource[side] = { L, sub: true, R: makeBoxAggregator(T), dimCols: h0.dimCols, cols: [] }; continue; }
    const sa = gridAxesOf(L); if (!sa) throw new Error(`${side} is not a regular block model`);
    const R = makeResampler(sa, T); if (!R.ok) throw new Error(`${side}: ${R.reason}`);
    perSource[side] = { L, sa, R, cols: [], toQ: latticeMapOf(sa) };   // a rotated source indexes in its OWN lattice frame
  }
  for (const c of columns) { if (!perSource[c.src]) throw new Error(`no ${c.src} layer for column ${c.name}`); perSource[c.src].cols.push(c); }
  // stream each source, scatter its columns
  for (const side of Object.keys(perSource)) {
    const ps = perSource[side]; if (!ps.cols.length) continue;
    const { L, sa, R, sub, dimCols, toQ } = ps, h = layerTableHeader(L), m = h.mapping;
    for (const c of ps.cols) {
      c._i = h.columns.indexOf(c.name); c._w = c.weight ? h.columns.indexOf(c.weight) : -1;
      if (c.num) c._acc = R.newAcc(); else { c._acc = R.newCatAcc(); c._dict = ['']; c._codeOf = new Map(); }
    }
    // this side's 3D selection, when asked for — record numbering mirrors
    // runExport's: invalid-coord DELIMITED rows aren't records (renderer numbering)
    const selMask = useSelection && L._selMask && L._selCount ? L._selMask : null;
    const isDelim = !blockCaps(L).rowIsRecord;
    let rec2 = 0;
    let rc = 0;
    for await (const batch of layerRows(L, null)) {   /* rows ok: join scatter: gates its own coordinates */
      for (const f of batch) {
        const wx = coordNum(f[m.x]), wy = coordNum(f[m.y]), wz = coordNum(f[m.z]);
        const badCoord = !Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz);
        if (badCoord && isDelim) continue;
        const rAt = rec2++;
        if (badCoord) continue;
        if (selMask && !selMask[rAt]) continue;
        let si, sj, sk, hx, hy, hz;
        if (sub) {
          hx = (+f[dimCols.x] || 0) / 2; hy = (+f[dimCols.y] || 0) / 2; hz = (+f[dimCols.z] || 0) / 2;
          if (!(hx > 0 && hy > 0 && hz > 0)) continue;
        } else {
          const q = sa.rot ? toQ(wx, wy, wz) : [wx, wy, wz];
          si = Math.round((q[0] - sa.x.origin) / (sa.x.pitch || 1)); sj = Math.round((q[1] - sa.y.origin) / (sa.y.pitch || 1)); sk = sa.z.pitch ? Math.round((q[2] - sa.z.origin) / sa.z.pitch) : 0;
          if (si < 0 || si >= sa.x.count || sj < 0 || sj >= sa.y.count || sk < 0 || sk >= sa.z.count) continue;
        }
        for (const c of ps.cols) {
          const wt = c._w >= 0 ? (+f[c._w] || 0) : 1; if (wt <= 0 && c._w >= 0) continue;
          if (c.num) {
            const v = numOf(f[c._i]); if (!Number.isFinite(v)) continue;   // a blank is missing, not 0
            if (sub) R.scatterBox(wx, wy, wz, hx, hy, hz, v, wt, c._acc); else R.scatter(si, sj, sk, v, wt, c._acc);
          } else {
            const lbl = f[c._i] == null ? '' : String(f[c._i]); let code = c._codeOf.get(lbl); if (code == null) { code = c._dict.length; c._dict.push(lbl); c._codeOf.set(lbl, code); }
            if (sub) R.scatterCatBox(wx, wy, wz, hx, hy, hz, code, wt, c._acc); else R.scatterCat(si, sj, sk, code, wt, c._acc);
          }
        }
        rc++;
      }
      if (onProgress) onProgress(Math.min(0.9, rc / 1e6), `${side}: ${rc.toLocaleString()} rows`);
      $('#meta').textContent = `${label}: ${side} ${rc.toLocaleString()} rows…`;
      await new Promise((r) => setTimeout(r));
    }
    for (const c of ps.cols) {
      if (c.num) { const r = R.finalize(c._acc, c.op || 'mean'); c._out = r.out; c._cov = r.coverage; c._present = r.present; }
      else { const r = R.finalizeCat(c._acc); c._codes = r.out; c._present = new Uint8Array(cells); for (let i = 0; i < cells; i++) if (r.out[i] >= 0) c._present[i] = 1; }
    }
  }
  // cells present in ANY column
  const present = new Uint8Array(cells); let nPresent = 0;
  for (let i = 0; i < cells; i++) { let any = 0; for (const c of columns) if (c._present[i]) { any = 1; break; } if (any) { present[i] = 1; nPresent++; } }
  if (!nPresent) throw new Error('no overlapping cells between the sources and the target grid');
  if (asCells) return { cells, nPresent, columns, present };   // the join-to-COLUMNS path attaches these positionally
  // coverage columns only where an aggregate actually lost coverage
  const covCols = coverage ? columns.filter((c) => c.num && c._cov && [...c._present].some((p, i) => p && c._cov[i] < 0.999)) : [];
  // derived columns: a value computed per cell from the finalized columns
  // (get(outName) → that column's cell value, or null if absent) — real,
  // colourable base columns (e.g. reconciliation Δ)
  const byOut = {}; for (const c of columns) byOut[c.out || c.name] = c;
  const getAt = (idx) => (name) => { const c = byOut[name]; if (!c || !c._present[idx]) return null; return c.num ? c._out[idx] : (c._dict[c._codes[idx]] || null); };
  const heads = ['XC', 'YC', 'ZC', ...columns.map((c) => c.out || c.name), ...derived.map((d) => d.out), ...covCols.map((c) => (c.out || c.name) + '_cov')];
  const ox = T.x.origin, oy = T.y.origin, oz = T.z.origin, px = T.x.pitch, py = T.y.pitch, pz = T.z.pitch;
  const toW = T.rot ? worldMapOf(T) : null;                // a rotated target writes WORLD centroids (and is reopened with its lattice declared)
  const parts = [heads.join(',') + '\n']; let buf = '';
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const idx = i + nx * (j + ny * k); if (!present[idx]) continue;
    const row = toW ? toW(ox + i * px, oy + j * py, oz + k * pz).map((v) => +v.toFixed(6)) : [ox + i * px, oy + j * py, oz + k * pz];
    for (const c of columns) {
      if (!c._present[idx]) { row.push(''); continue; }
      if (c.num) row.push(+c._out[idx].toFixed(6)); else row.push(csvCell(c._dict[c._codes[idx]] || ''));
    }
    const get = getAt(idx);
    for (const d of derived) { const v = d.compute(get); row.push(v == null ? '' : (d.num === false ? csvCell(v) : +(+v).toFixed(6))); }
    for (const c of covCols) row.push(c._present[idx] ? +c._cov[idx].toFixed(4) : '');
    buf += row.join(',') + '\n';
    if (buf.length > (1 << 22)) { parts.push(buf); buf = ''; }
  }
  if (buf) parts.push(buf);
  return { blob: new Blob(parts, { type: 'text/csv' }), cells: nPresent };
}

// quote a CSV cell if it holds a comma/quote/newline
export function csvCell(s) { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// Regular (key) join: hash the right table by its key column, probe left, and
// emit left's rows + the brought right columns as a NEW layer (openBlob re-
// detects the kind, so a block model stays a block model). Duplicate right keys
// resolve by first / error / aggregate (mean of numerics). bring: [names];
// prefix: applied to brought names that collide with a left column.
export async function runKeyJoin({ leftL, rightL, leftKey, rightKey, bring, dup = 'first', prefix = '', label = 'join' }) {
  const lh = layerTableHeader(leftL), rh = layerTableHeader(rightL);
  const lki = lh.columns.indexOf(leftKey), rki = rh.columns.indexOf(rightKey);
  if (lki < 0 || rki < 0) throw new Error('key column not found');
  const bringIdx = bring.map((n) => rh.columns.indexOf(n)).filter((i) => i >= 0);
  const rNum = bringIdx.map((i) => colIsNumeric(rightL, rh, i));
  const map = new Map();
  let rc = 0, dupSeen = false;
  for await (const batch of layerRows(rightL, null)) {   /* rows ok: key-join lookup table: keyed, not numbered */
    for (const f of batch) {
      const k = f[rki] == null ? '' : String(f[rki]);
      const vals = bringIdx.map((i) => f[i]);
      const e = map.get(k);
      if (!e) map.set(k, { vals, n: 1 });
      else { dupSeen = true; e.n++; if (dup === 'aggregate') for (let b = 0; b < vals.length; b++) { if (rNum[b]) { const nv = +vals[b], cur = +e.vals[b]; if (Number.isFinite(nv)) e.vals[b] = Number.isFinite(cur) ? (cur * (e.n - 1) + nv) / e.n : nv; } } }
      rc++;
    }
    $('#meta').textContent = `${label}: indexing right ${rc.toLocaleString()}…`;
    await new Promise((r) => setTimeout(r));
  }
  if (dup === 'error' && dupSeen) throw new Error(`right key “${rightKey}” has duplicate values — pick first/aggregate or a unique key`);
  const outNames = bring.map((n) => (lh.columns.includes(n) ? (prefix || 'r_') + n : n));
  const heads = [...lh.columns, ...outNames];
  const parts = [heads.map(csvCell).join(',') + '\n']; let buf = '', matched = 0, total = 0;
  for await (const batch of layerRows(leftL, null)) {   /* rows ok: key join → a new CSV: every source row, the new layer numbers its own */
    for (const f of batch) {
      const k = f[lki] == null ? '' : String(f[lki]);
      const e = map.get(k); if (e) matched++; total++;
      const row = f.map(csvCell).concat((e ? e.vals : bringIdx.map(() => '')).map(csvCell));
      buf += row.join(',') + '\n';
      if (buf.length > (1 << 22)) { parts.push(buf); buf = ''; }
    }
    $('#meta').textContent = `${label}: joining left ${total.toLocaleString()}…`;
    await new Promise((r) => setTimeout(r));
  }
  if (buf) parts.push(buf);
  return { blob: new Blob(parts, { type: 'text/csv' }), rows: total, matched };
}

const shortName = (L) => (L.label || L.name || '').replace(/\.[^.]+$/, '');

export function joinColumnsFromForm(jf, L, R) {
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const leftNames = new Set(), out = [];
  for (const key of jf.cols) {
    const side = key.slice(0, key.indexOf(':')), name = key.slice(key.indexOf(':') + 1);
    const h = side === 'left' ? lh : rh, srcL = side === 'left' ? L : R;
    const num = colIsNumeric(srcL, h, h.columns.indexOf(name));
    // prefix on cross-source collision
    let outName = name;
    if (jf.cols.some((k2) => k2 !== key && k2.slice(k2.indexOf(':') + 1) === name)) outName = (side === 'left' ? shortName(L) : shortName(R)).replace(/\W+/g, '_') + '_' + name;
    out.push({ src: side, name, out: outName, num, op: num ? (jf.ops[key] || 'mean') : undefined, weight: num ? (jf.weights[key] || null) : null });
  }
  return out;
}

// ── JOIN → COLUMNS (the cardinality rule in code): an op that PRESERVES the
// left table's record count produces COLUMNS on it, never a new layer. Two
// cases qualify — a spatial join whose target is THIS model's own lattice
// (one resampled value per existing cell) and a key join (left rows unchanged).
// Numeric results → materialized columns (Parquet sidecar); text → dict
// category columns via the paint channel. Ops land in the element manifest
// with explicit CROSS-ELEMENT inputs ({element, loc, column} — rule 6):
// 'estimate' (method: resample) and 'key-lookup'. Joins onto a THIRD lattice
// and reconcile Δ change cardinality → they correctly stay new layers.
export function joinOutName(taken, name, R) {
  let out = name;
  while (taken.has(out.toLowerCase())) out = shortName(R).replace(/\W+/g, '_') + '_' + out;
  taken.add(out.toLowerCase());
  return out;
}

export async function spatialJoinToCols(L, R, jf) {
  const T = gridAxesOf(L); if (!T) throw new Error('this layer has no regular grid');
  const columns = joinColumnsFromForm(jf, L, R).filter((c) => c.src === 'right');
  if (!columns.length) throw new Error('pick right-side columns (the left ones are already here)');
  const res = await runSpatialJoin({ leftL: null, rightL: R, target: T, columns, coverage: false, label: 'join', asCells: true, useSelection: !!jf.useSel });
  const h = layerTableHeader(L), m = h.mapping;
  const cellAt = cellOf(T);                                // rotation-aware: a rotated target is looked up in its own lattice frame
  const n = attrRowCountOf(L) || 0;
  const taken = new Set([...h.columns, ...(L.calcCols || []).map((c) => c.name), ...(jf.replace ? [] : (L.paintCols || []).map((c) => c.name))].map((x) => String(x).toLowerCase()));   // replace: a re-run replaces its own columns
  const outs = res.columns.map((c) => {
    const out = joinOutName(taken, c.out || c.name, R);
    const o = { c, out };
    if (c.num) o.vals = new Float32Array(n);
    else { o.pc = createPaintCol(L, out); if (!o.pc) throw new Error('column limit'); o.pc._noAutoColor = true; o.codeOf = new Map(); }
    return o;
  });
  // RECORDS, not rows (layerRecords): a delimited row with no coordinates is not
  // a record, and counting it gave every later block its neighbour's value
  let done = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (rec >= n) break;
    const wx = coordNum(f[m.x]), wy = coordNum(f[m.y]), wz = coordNum(f[m.z]);
    const idx = Number.isFinite(wx) && Number.isFinite(wy) && Number.isFinite(wz) ? cellAt(wx, wy, wz) : -1;
    for (const o of outs) {
      const c = o.c;
      if (idx < 0 || !c._present[idx]) { if (c.num) o.vals[rec] = NaN; continue; }
      if (c.num) o.vals[rec] = c._out[idx];
      else {
        const lbl = c._dict[c._codes[idx]] || '';
        if (lbl) { let code = o.codeOf.get(lbl); if (code == null) { code = addPaintValue(L, o.pc, lbl); if (code == null) continue; o.codeOf.set(lbl, code); } o.pc.codes[rec] = code; }
      }
    }
    if ((++done & 65535) === 0) { $('#meta').textContent = `join: attaching ${done.toLocaleString()} records…`; await new Promise((r) => setTimeout(r)); }
  }
  for (const o of outs) {
    const lin = mkLineage('estimate', { method: 'resample', fromElement: R.name, column: o.c.name, op: o.c.op || (o.c.num ? 'mean' : 'majority'), weight: o.c.weight || undefined, ...(jf.useSel ? { selection: true } : {}) }, [L.lineage, R.lineage].filter(Boolean));
    if (o.c.num) matColSet(L, o.out, o.vals, { lineage: lin });
    else { o.pc.lineage = lin; paintRecount(o.pc); }
  }
  L._colStats = null; L._calcFns = null;
  try { await persistElement(L); } catch { /* best-effort */ }
  setLayerColorSel(L, 'paint:' + outs[0].out);
  markProjectDirty(); renderProps(); requestRender();
  return outs.map((o) => o.out);
}

export async function keyJoinToCols(L, R, { leftKey, rightKey, bring, dup = 'first' }) {
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const lki = lh.columns.indexOf(leftKey), rki = rh.columns.indexOf(rightKey);
  if (lki < 0 || rki < 0) throw new Error('key column not found');
  const bringIdx = bring.map((n2) => rh.columns.indexOf(n2)).filter((i) => i >= 0);
  const rNum = bringIdx.map((i) => colIsNumeric(R, rh, i));
  const map = new Map();
  let rc = 0, dupSeen = false;
  for await (const batch of layerRows(R, null)) {   /* rows ok: key-join lookup table: keyed, not numbered */
    for (const f of batch) {
      const k = f[rki] == null ? '' : String(f[rki]);
      const vals = bringIdx.map((i) => f[i]);
      const e = map.get(k);
      if (!e) map.set(k, { vals, n: 1 });
      else { dupSeen = true; e.n++; if (dup === 'aggregate') for (let b = 0; b < vals.length; b++) { if (rNum[b]) { const nv = +vals[b], cur = +e.vals[b]; if (Number.isFinite(nv)) e.vals[b] = Number.isFinite(cur) ? (cur * (e.n - 1) + nv) / e.n : nv; } } }
      rc++;
    }
    $('#meta').textContent = `join: indexing right ${rc.toLocaleString()}…`;
    await new Promise((r) => setTimeout(r));
  }
  if (dup === 'error' && dupSeen) throw new Error(`right key “${rightKey}” has duplicate values — pick first/aggregate or a unique key`);
  const n = attrRowCountOf(L) || 0;
  const taken = new Set([...lh.columns, ...(L.calcCols || []).map((c) => c.name), ...(L.paintCols || []).map((c) => c.name)].map((x) => String(x).toLowerCase()));
  const outs = bringIdx.map((bi, b) => {
    const out = joinOutName(taken, rh.columns[bi], R);
    const o = { bi, b, num: rNum[b], out };
    if (o.num) o.vals = new Float32Array(n);
    else { o.pc = createPaintCol(L, out); if (!o.pc) throw new Error('column limit'); o.codeOf = new Map(); }
    return o;
  });
  let matched = 0, done = 0;
  for await (const { f, rec } of layerRecords(L)) {        // records, not rows (see spatialJoinToCols)
    if (rec >= n) break;
    const e = map.get(f[lki] == null ? '' : String(f[lki]));
    if (e) matched++;
    for (const o of outs) {
      if (o.num) { const v = e ? +e.vals[o.b] : NaN; o.vals[rec] = Number.isFinite(v) ? v : NaN; }
      else {
        const lbl = e ? String(e.vals[o.b] ?? '').trim() : '';
        if (lbl) { let code = o.codeOf.get(lbl); if (code == null) { code = addPaintValue(L, o.pc, lbl); if (code == null) continue; o.codeOf.set(lbl, code); } o.pc.codes[rec] = code; }
      }
    }
    if ((++done & 65535) === 0) { $('#meta').textContent = `join: attaching ${done.toLocaleString()}…`; await new Promise((r) => setTimeout(r)); }
  }
  for (const o of outs) {
    const lin = mkLineage('key-lookup', { fromElement: R.name, leftKey, rightKey, column: rh.columns[o.bi], dup }, [L.lineage, R.lineage].filter(Boolean));
    if (o.num) matColSet(L, o.out, o.vals, { lineage: lin });
    else { o.pc.lineage = lin; paintRecount(o.pc); }
  }
  L._colStats = null; L._calcFns = null;
  try { await persistElement(L); } catch { /* best-effort */ }
  setLayerColorSel(L, 'paint:' + outs[0].out);
  markProjectDirty(); renderProps(); requestRender();
  return { outs: outs.map((o) => o.out), matched, rows: done };
}

export async function runReconcile(L, R, jf, grade) {
  try { return await reconcileModels(L, R, jf, grade); } catch (e) { $('#meta').textContent = `reconcile: ${e.message}`; return null; }
}
// → { layer, name, matched, meanDelta, meanAbsDelta, thisOnly, refOnly } (the reconcile tool reads it)
export async function reconcileModels(L, R, jf, grade, { replace = false } = {}) {
  {
    // reconcile on the COMMON lattice (finest) so it captures matched AND
    // added/removed cells even when the two models' extents differ. When ONE side
    // is sub-blocked, its gridAxesOf is the fine lattice — reconcile at the
    // REGULAR side's (parent) resolution instead, aggregating the sub-blocks up
    // by volume; both sub-blocked → the finest common of their fine lattices.
    const subL = !!(layerTableHeader(L) || {}).subBlocked, subR = !!(layerTableHeader(R) || {}).subBlocked;
    let T;
    if (subL !== subR) { T = gridAxesOf(subL ? R : L); if (!T) throw new Error('the regular side has no grid to reconcile onto'); }
    else { const cl = commonLattice([gridAxesOf(L), gridAxesOf(R)], { resolution: 'finest' }); if (!cl.ok) throw new Error(cl.reason); T = cl; }
    // this (active/left) − reference (right); Δ is a REAL column → colourable
    const aName = `ref_${grade}`, bName = `this_${grade}`, dName = `Δ${grade}`;
    const columns = [
      { src: 'left', name: grade, out: bName, num: true, op: 'mean', weight: jf.weights['left:' + grade] || null },
      { src: 'right', name: grade, out: aName, num: true, op: 'mean', weight: jf.weights['right:' + grade] || null },
    ];
    const derived = [{ out: dName, num: true, compute: (g) => { const a = g(aName), b = g(bName); return a != null && b != null ? b - a : null; } }];
    const name = `reconcile_${shortName(L)}_vs_${shortName(R)}.csv`;
    if (replace) for (const old of S.layers.filter((x) => x.name === name)) removeLayerUI(old.id);   // a re-run replaces its own result
    const { blob } = await runSpatialJoin({ leftL: L, rightL: R, target: T, columns, derived, label: 'reconcile', useSelection: !!jf.useSel });
    // open ALREADY coloured by Δ (chan = the Δ column) — heads are
    // XC,YC,ZC, ...columns, ...derived, so Δ is at 3 + columns.length
    const dIdx = 3 + columns.length;
    const lin = mkLineage('reconcile', { grade, target: 'common-finest', ...(jf.useSel ? { selection: true } : {}), of: `${shortName(L)}−${shortName(R)}` }, [L.lineage, R.lineage]);
    await openBlob(blob, name, 'add', null, { mapping: { x: 0, y: 1, z: 2, chan: dIdx, cat: null }, lineage: lin, ...(T.rot ? { lattice: T } : {}) });
    const J = activeLayer();
    if (J) {
      const jh = layerTableHeader(J);
      const ai = jh.columns.indexOf(aName), bi = jh.columns.indexOf(bName);
      let sum = 0, sumAbs = 0, n = 0, refOnly = 0, thisOnly = 0, mx = 0;
      for await (const batch of layerRows(J, null)) for (const f of batch) {   /* rows ok: reconcile summary over the derived layer: counts, not numbered */
        const aP = f[ai] !== '' && Number.isFinite(+f[ai]), bP = f[bi] !== '' && Number.isFinite(+f[bi]);
        if (aP && bP) { const dv = +f[bi] - +f[ai]; sum += dv; sumAbs += Math.abs(dv); if (Math.abs(dv) > mx) mx = Math.abs(dv); n++; }
        else if (aP) refOnly++; else if (bP) thisOnly++;
      }
      // the diverging spectral ramp, symmetric about 0 → yellow=no change, blue=under, red=over
      if (mx > 0) { J.clip = [String(+(-mx).toPrecision(3)), String(+mx.toPrecision(3))]; if (J.id === S.activeId) { $('#clipMin').value = J.clip[0]; $('#clipMax').value = J.clip[1]; } }
      setRampCfg(J, { preset: 'spectral' });
      applyRamp(J, true); requestRender();
      const mean = n ? sum / n : 0, mabs = n ? sumAbs / n : 0;
      J._reconcile = { matched: n, meanDelta: mean, meanAbsDelta: mabs, thisOnly, refOnly };
      $('#meta').textContent = `reconcile ${shortName(L)}−${shortName(R)} (${dName}): ${n.toLocaleString()} matched · mean Δ ${mean >= 0 ? '+' : ''}${mean.toPrecision(3)} · mean|Δ| ${mabs.toPrecision(3)}${thisOnly ? ` · ${thisOnly.toLocaleString()} added` : ''}${refOnly ? ` · ${refOnly.toLocaleString()} removed` : ''} → ${name}`;
    }
    renderLayers();
    return J ? { layer: J.id, name, ...(J._reconcile || {}) } : null;
  }
}

// ── the join tab's two buttons (Properties → join) ──
// the grid the form names: one side's own, or the common lattice of the two
function targetAxes(jf, L, R) {
  if (jf.target === 'left') return gridAxesOf(L);
  if (jf.target === 'right') return gridAxesOf(R);
  const c = commonLattice([gridAxesOf(L), gridAxesOf(R)], { resolution: jf.target === 'coarsest' ? 'coarsest' : 'finest' });
  if (!c.ok) throw new Error(c.reason);
  return c;
}
// run the spatial join and open the result as a new layer, with its lineage
async function runSpatialJoinUI(L, R, jf) {
  try {
    const T = targetAxes(jf, L, R);
    const columns = joinColumnsFromForm(jf, L, R);
    const name = `${shortName(L)}⋈${shortName(R)}.csv`;
    const { blob, cells } = await runSpatialJoin({ leftL: L, rightL: R, target: T, columns, label: 'join', useSelection: !!jf.useSel });
    const lin = mkLineage('join', { target: jf.target, ...(jf.useSel ? { selection: true } : {}), columns: columns.map((c) => ({ src: c.src, name: c.name, out: c.out, op: c.op || undefined, weight: c.weight || undefined })) }, [L.lineage, R.lineage]);
    await openBlob(blob, name, 'add', null, { lineage: lin, ...(T.rot ? { lattice: T } : {}) });
    $('#meta').textContent = `joined ${cells.toLocaleString()} cells → ${name}`;
  } catch (e) { $('#meta').textContent = `join: ${e.message}`; }
}

// "Reconcile…": a menu with one entry per grade both models share
function openReconcileMenu(L, R, jf, shared, anchor) {
  const r = anchor.getBoundingClientRect();
  menuXY(r.left - 40, r.bottom + 2, shared.map((g) => ({ label: `Δ on ${g}`, action: () => runReconcile(L, R, jf, g) })));
}

// ── join tab (§ join-spec): the active layer is the LEFT. Spatial mode
// resamples a compatible right model onto a target grid; key mode hash-joins by
// a key column. Both emit a NEW layer. Reconcile is a spatial preset (Δ column).
let _joinForm = null;
export function resetJoinForm() { _joinForm = null; }
const joinTableLayers = (L) => S.layers.filter((x) => x.id !== L.id && layerTableHeader(x));
const joinBlockLayers = (L) => S.layers.filter((x) => x.id !== L.id && gridAxesOf(x));
export function renderJoinTab(body, L) {
  if (!layerTableHeader(L)) { body.appendChild(ppNote('join needs a table-backed layer')); return; }
  if (!_joinForm) _joinForm = { mode: gridAxesOf(L) ? 'spatial' : 'key', rightId: null, target: 'left', cols: [], ops: {}, weights: {}, keyL: '', keyR: '', bring: new Set(), dup: 'first' };
  const jf = _joinForm;
  const seg = document.createElement('div'); seg.className = 'pp-seg';
  for (const md of ['spatial', 'key']) {
    const bt = document.createElement('button'); bt.className = 'pp-segbtn' + (jf.mode === md ? ' on' : '');
    bt.textContent = md === 'spatial' ? 'Spatial' : 'By key';
    if (md === 'spatial' && !gridAxesOf(L)) bt.disabled = true;
    bt.onclick = () => { jf.mode = md; renderProps(); };
    seg.appendChild(bt);
  }
  body.appendChild(mkRow('mode', seg));
  const rights = jf.mode === 'spatial' ? joinBlockLayers(L) : joinTableLayers(L);
  if (!rights.length) { body.appendChild(ppNote(jf.mode === 'spatial' ? 'open another block model to join against' : 'open another table layer to join against')); return; }
  const rSel = document.createElement('select');
  { const o = document.createElement('option'); o.value = ''; o.textContent = '— pick a layer —'; rSel.appendChild(o); }
  for (const r of rights) { const o = document.createElement('option'); o.value = String(r.id); o.textContent = r.label || r.name; rSel.appendChild(o); }
  rSel.value = jf.rightId != null && rights.some((r) => r.id === jf.rightId) ? String(jf.rightId) : '';
  rSel.onchange = () => { jf.rightId = rSel.value ? +rSel.value : null; jf.cols = []; jf.bring = new Set(); jf.keyL = ''; jf.keyR = ''; renderProps(); };
  body.appendChild(mkRow('right', rSel));
  const R = jf.rightId != null ? layerById(jf.rightId) : null;
  if (!R) return;
  if (jf.mode === 'spatial') renderSpatialJoinUI(body, L, R, jf); else renderKeyJoinUI(body, L, R, jf);
}
function renderSpatialJoinUI(body, L, R, jf) {
  const c = gridsCompatible(gridAxesOf(L), gridAxesOf(R));
  const ban = document.createElement('div');
  if (c.ok) { ban.className = 'pp-banner ok'; ban.textContent = c.nested ? `compatible — clean replicate / aggregate` : `compatible — common lattice (mixed weights)`; }
  else { ban.className = 'pp-banner bad'; ban.textContent = `incompatible — ${c.reason}`; }
  body.appendChild(ban);
  if (!c.ok) return;
  // target grid
  const tSel = document.createElement('select');
  for (const [v, lab] of [['left', `${shortName(L)} (this)`], ['right', shortName(R)], ['finest', 'common — finest'], ['coarsest', 'common — coarsest']]) { const o = document.createElement('option'); o.value = v; o.textContent = lab; tSel.appendChild(o); }
  tSel.value = jf.target; tSel.onchange = () => { jf.target = tSel.value; renderProps(); };
  body.appendChild(mkRow('target grid', tSel));
  // per-source column pickers
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const addSourceCols = (side, srcL, h) => {
    const head = document.createElement('div'); head.className = 'pp-jhead'; head.textContent = `${side === 'left' ? shortName(L) : shortName(R)} columns`; body.appendChild(head);
    const m = h.mapping || {};
    for (let i = 0; i < h.columns.length; i++) {
      if (i === m.x || i === m.y || i === m.z) continue;      // coords define the grid, not joined
      const name = h.columns[i], num = colIsNumeric(srcL, h, i), key = side + ':' + name;
      const row = document.createElement('div'); row.className = 'pp-jcol';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = jf.cols.includes(key);
      cb.onchange = () => { if (cb.checked) jf.cols.push(key); else jf.cols = jf.cols.filter((k) => k !== key); renderProps(); };
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name; nm.title = name + (num ? ' · number' : ' · text');
      row.append(cb, nm);
      if (jf.cols.includes(key)) {
        if (num) {
          const opSel = document.createElement('select'); for (const op of ['mean', 'sum', 'count']) { const o = document.createElement('option'); o.value = op; o.textContent = op; opSel.appendChild(o); } opSel.value = jf.ops[key] || 'mean'; opSel.onchange = () => { jf.ops[key] = opSel.value; }; row.appendChild(opSel);
          const wSel = document.createElement('select'); { const o = document.createElement('option'); o.value = ''; o.textContent = 'unweighted'; wSel.appendChild(o); }
          for (let w = 0; w < h.columns.length; w++) if (colIsNumeric(srcL, h, w) && w !== i && w !== m.x && w !== m.y && w !== m.z) { const o = document.createElement('option'); o.value = h.columns[w]; o.textContent = '× ' + h.columns[w]; wSel.appendChild(o); }
          wSel.value = jf.weights[key] || ''; wSel.onchange = () => { jf.weights[key] = wSel.value; }; row.appendChild(wSel);
        } else { const t = document.createElement('span'); t.style.cssText = 'font-size:11px;color:var(--dim)'; t.textContent = 'majority'; row.appendChild(t); }
      }
      body.appendChild(row);
    }
  };
  addSourceCols('left', L, lh); addSourceCols('right', R, rh);
  // scope: honor each side's 3D selection (rubber-band a zone → join/reconcile just it)
  const anySel = (L._selMask && L._selCount) || (R && R._selMask && R._selCount);
  const selLab = document.createElement('label'); selLab.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--muted);cursor:pointer';
  const selCb = document.createElement('input'); selCb.type = 'checkbox';
  selCb.checked = !!jf.useSel && !!anySel; selCb.disabled = !anySel;
  selCb.onchange = () => { jf.useSel = selCb.checked; };
  selLab.append(selCb, anySel ? 'only the 3D selection (each side uses its own, where present)' : 'only the 3D selection — select something first (r / v)');
  if (!anySel) jf.useSel = false;
  body.appendChild(selLab);
  // run + reconcile
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:6px;margin-top:10px';
  const rightPicked = jf.cols.some((k) => k.startsWith('right:'));
  const runC = document.createElement('button'); runC.className = 'pp-scan'; runC.style.flex = '1'; runC.textContent = 'Join → columns here';
  runC.disabled = !(jf.target === 'left' && rightPicked);
  runC.title = jf.target === 'left' ? `resample ${shortName(R)}'s picked columns onto this model's own cells — real columns, no new layer` : 'columns land here only when the target grid is THIS model (other targets change the record set → a new layer)';
  runC.onclick = async () => { try { const outs = await spatialJoinToCols(L, R, jf); $('#meta').textContent = `join: ${outs.join(', ')} on ${L.label || L.name} — filter, color, GT and export all see ${outs.length > 1 ? 'them' : 'it'}`; } catch (e) { $('#meta').textContent = `join: ${e.message}`; } };
  btns.appendChild(runC);
  const run = document.createElement('button'); run.className = 'pp-scan'; run.textContent = `→ new layer`;
  run.disabled = !jf.cols.length;
  run.title = 'a new block-model layer on the target grid';
  run.onclick = () => runSpatialJoinUI(L, R, jf);
  btns.appendChild(run);
  // reconcile enabled when a numeric column exists in BOTH
  const shared = lh.columns.filter((n) => colIsNumeric(L, lh, lh.columns.indexOf(n)) && rh.columns.includes(n) && colIsNumeric(R, rh, rh.columns.indexOf(n)) && ![lh.mapping.x, lh.mapping.y, lh.mapping.z].includes(lh.columns.indexOf(n)));
  const rec = document.createElement('button'); rec.className = 'pp-scan'; rec.textContent = 'Reconcile…'; rec.disabled = !shared.length;
  rec.title = shared.length ? `Δ on ${shared.join(', ')}` : 'needs a numeric column present in both models';
  rec.onclick = () => openReconcileMenu(L, R, jf, shared, rec);
  btns.appendChild(rec);
  body.appendChild(btns);
  body.appendChild(ppNote('a new block-model layer on the target grid, carrying the chosen columns as real (filter/colour/export-able) columns'));
}
function renderKeyJoinUI(body, L, R, jf) {
  const lh = layerTableHeader(L), rh = layerTableHeader(R);
  const colSel = (cols, val, on) => { const s = document.createElement('select'); { const o = document.createElement('option'); o.value = ''; o.textContent = '— key —'; s.appendChild(o); } for (const n of cols) { const o = document.createElement('option'); o.value = n; o.textContent = n; s.appendChild(o); } s.value = val || ''; s.onchange = () => on(s.value); return s; };
  body.appendChild(mkRow('left key', colSel(lh.columns, jf.keyL, (v) => { jf.keyL = v; })));
  body.appendChild(mkRow('right key', colSel(rh.columns, jf.keyR, (v) => { jf.keyR = v; })));
  const head = document.createElement('div'); head.className = 'pp-jhead'; head.textContent = 'bring columns'; body.appendChild(head);
  for (const n of rh.columns) {
    if (n === jf.keyR) continue;
    const row = document.createElement('div'); row.className = 'pp-jcol';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = jf.bring.has(n);
    cb.onchange = () => { if (cb.checked) jf.bring.add(n); else jf.bring.delete(n); };
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = n;
    row.append(cb, nm); body.appendChild(row);
  }
  const dupSel = document.createElement('select'); for (const [v, lab] of [['first', 'first match'], ['aggregate', 'average dups'], ['error', 'error on dups']]) { const o = document.createElement('option'); o.value = v; o.textContent = lab; dupSel.appendChild(o); } dupSel.value = jf.dup; dupSel.onchange = () => { jf.dup = dupSel.value; };
  body.appendChild(mkRow('duplicate keys', dupSel));
  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const runC = document.createElement('button'); runC.className = 'pp-scan'; runC.style.flex = '1'; runC.textContent = 'Join → columns here';
  runC.disabled = !(jf.keyL && jf.keyR && jf.bring.size);
  runC.title = 'the brought columns land ON this layer (rows unchanged — a key join never needs a new layer)';
  runC.onclick = async () => {
    try {
      const { outs, matched, rows } = await keyJoinToCols(L, R, { leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup });
      $('#meta').textContent = `key join: ${matched.toLocaleString()} of ${rows.toLocaleString()} rows matched — ${outs.join(', ')} on ${L.label || L.name}`;
    } catch (e) { $('#meta').textContent = `key join: ${e.message}`; }
  };
  btns.appendChild(runC);
  const run = document.createElement('button'); run.className = 'pp-scan'; run.textContent = '→ new layer';
  run.disabled = !(jf.keyL && jf.keyR && jf.bring.size);
  run.title = 'export-shaped: a new layer/file of this layer’s rows + the brought columns';
  run.onclick = async () => {
    try {
      const { blob, rows, matched } = await runKeyJoin({ leftL: L, rightL: R, leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup, prefix: shortName(R).replace(/\W+/g, '_') + '_', label: 'join' });
      const name = `${shortName(L)}+${shortName(R)}.csv`;
      const lin = mkLineage('keyjoin', { leftKey: jf.keyL, rightKey: jf.keyR, bring: [...jf.bring], dup: jf.dup }, [L.lineage, R.lineage]);
      await openBlob(blob, name, 'add', null, { lineage: lin });
      $('#meta').textContent = `key join: ${matched.toLocaleString()} of ${rows.toLocaleString()} rows matched → ${name}`;
    } catch (e) { $('#meta').textContent = `key join: ${e.message}`; }
  };
  btns.appendChild(run);
  body.appendChild(btns);
  body.appendChild(ppNote('columns land HERE by default (matched by key; unmatched → blank) — “new layer” writes a joined copy instead'));
}
