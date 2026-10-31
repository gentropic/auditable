// micro joins — two models, one answer: a SPATIAL join resamples a compatible
// model onto a target lattice (volume-weighted; sub-blocked sources scatter as
// boxes; rotated ones index in their own basis), a KEY join hash-matches by a
// column, both either to a new layer or back onto this layer's records as
// columns (layerRecords: records, not rows), and RECONCILE maps the difference.
// Carved from index.html (phase 3).
import { attrRowCountOf, blockCaps, colIsNumeric, layerRecords, layerRows, layerTableHeader, numOf } from './records.js';
import { cellOf, commonLattice, coordNum, latticeMapOf, makeBoxAggregator, makeResampler, worldMapOf } from '../../../ext/condenser/src/main.js';
import { gridAxesOf } from './grid-ops.js';
import { mkLineage } from './lineage.js';
import { matColSet, paintRecount } from './columns.js';
import { persistElement } from './element-store.js';
import { S, activeLayer } from './state.js';
const $ = (s) => document.querySelector(s);
// the app's side, passed in once (setJoinsHooks): addPaintValue, applyRamp, createPaintCol, markProjectDirty, openBlob, renderLayers, renderProps, requestRender, setLayerColorSel, setRampCfg
let H = {};
export function setJoinsHooks(h) { H = h; }

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

export const shortName = (L) => (L.label || L.name || '').replace(/\.[^.]+$/, '');

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
  const taken = new Set([...h.columns, ...(L.calcCols || []).map((c) => c.name), ...(L.paintCols || []).map((c) => c.name)].map((x) => String(x).toLowerCase()));
  const outs = res.columns.map((c) => {
    const out = joinOutName(taken, c.out || c.name, R);
    const o = { c, out };
    if (c.num) o.vals = new Float32Array(n);
    else { o.pc = H.createPaintCol(L, out); if (!o.pc) throw new Error('column limit'); o.pc._noAutoColor = true; o.codeOf = new Map(); }
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
        if (lbl) { let code = o.codeOf.get(lbl); if (code == null) { code = H.addPaintValue(L, o.pc, lbl); if (code == null) continue; o.codeOf.set(lbl, code); } o.pc.codes[rec] = code; }
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
  H.setLayerColorSel(L, 'paint:' + outs[0].out);
  H.markProjectDirty(); H.renderProps(); H.requestRender();
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
    else { o.pc = H.createPaintCol(L, out); if (!o.pc) throw new Error('column limit'); o.codeOf = new Map(); }
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
        if (lbl) { let code = o.codeOf.get(lbl); if (code == null) { code = H.addPaintValue(L, o.pc, lbl); if (code == null) continue; o.codeOf.set(lbl, code); } o.pc.codes[rec] = code; }
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
  H.setLayerColorSel(L, 'paint:' + outs[0].out);
  H.markProjectDirty(); H.renderProps(); H.requestRender();
  return { outs: outs.map((o) => o.out), matched, rows: done };
}

export async function runReconcile(L, R, jf, grade) {
  try {
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
    const { blob } = await runSpatialJoin({ leftL: L, rightL: R, target: T, columns, derived, label: 'reconcile', useSelection: !!jf.useSel });
    // open ALREADY coloured by Δ (chan = the Δ column) — heads are
    // XC,YC,ZC, ...columns, ...derived, so Δ is at 3 + columns.length
    const dIdx = 3 + columns.length;
    const lin = mkLineage('reconcile', { grade, target: 'common-finest', ...(jf.useSel ? { selection: true } : {}), of: `${shortName(L)}−${shortName(R)}` }, [L.lineage, R.lineage]);
    await H.openBlob(blob, name, 'add', null, { mapping: { x: 0, y: 1, z: 2, chan: dIdx, cat: null }, lineage: lin, ...(T.rot ? { lattice: T } : {}) });
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
      H.setRampCfg(J, { preset: 'spectral' });
      H.applyRamp(J, true); H.requestRender();
      const mean = n ? sum / n : 0, mabs = n ? sumAbs / n : 0;
      $('#meta').textContent = `reconcile ${shortName(L)}−${shortName(R)} (${dName}): ${n.toLocaleString()} matched · mean Δ ${mean >= 0 ? '+' : ''}${mean.toPrecision(3)} · mean|Δ| ${mabs.toPrecision(3)}${thisOnly ? ` · ${thisOnly.toLocaleString()} added` : ''}${refOnly ? ` · ${refOnly.toLocaleString()} removed` : ''} → ${name}`;
    }
    H.renderLayers();
  } catch (e) { $('#meta').textContent = `reconcile: ${e.message}`; }
}
