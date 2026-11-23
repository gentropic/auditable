// micro reconciliation factors — the step after reconcile (block by block Δ): TOTALS inside the
// volume mined in each period, three ways —
//   F1 = grade control / resource model · F2 = mill / grade control · F3 = mill / resource = F1 × F2
// for tonnes, grade and metal. The two models are block models on any lattices (totals, not blocks:
// no common grid needed); the mined volume per period is
//   column   — a period column on the blocks (MINED_MONTH painted, or joined from a schedule)
//   volumes  — one mesh per period: a closed solid (its inside) or an open pit surface (above it), the
//              blocks counted by the FRACTION inside (partial blocks count partially — by-geometry's
//              dense winding sweep; a rotated model falls back to centroid membership). `nested`: each
//              volume holds the ones before it (pit phases, cumulative shells) → period k is the part of
//              volume k outside volume k − 1
//   filter   — one period: the blocks an expression keeps
//   selection— one period: each model's 3D selection (a window only)
// production is a non-spatial TABLE layer (period, tonnes, grade and/or metal), matched by period name.
// Cutoff, density and grade units exactly as grade–tonnage and the resource table: tonnes = block
// volume (sub-blocked aware) × density (a column or a constant, a declared unit → t/m³); grades in each
// source's declared unit converted to the report unit; metal = tonnes × grade × the metal factor.
// The arithmetic is ./factors-core.js (pure, unit-tested); this file reads the layers and draws.
import { S, layerById } from './state.js';
import { layerRecords, layerTableHeader, numOf, schemaExt } from './records.js';
import { compileBool, compileValue, quoteIdent, validate, deps as exprDeps } from '../../../ext/expr/index.js';
import { convert as unitConvert } from '../../../ext/units/index.js';
import { coordNum } from '../../../ext/condenser/src/main.js';
import { numericColsOf, volumeContextOf, volumeAt } from './analysis.js';
import { gridAxesOf } from './grid-ops.js';
import { evalSolidOnGrid, meshSolidOf, solidHit, sbCancelActive } from './bygeom.js';
import { ensureStoredValues } from './columns.js';
import { applyAnalysisGeo, checkAbort, fmtStat, gradeUnitFactor, gradeUnitSel, plotChart, plotExportBtns, rangesForCfg, rangesFromCfg, rangesRow, runCancellable, saveAnalysisCfg, setAnalysisOpen, abortErr } from './analysis-ui.js';
import { floatWin, focusWindow } from './windows.js';
import { saveRecipe } from './recipes.js';
import { periodKey, makeAcc, factorRows, factorTable, factorValues, periodOrder, identityError, metalMismatch, QUANTITIES } from './factors-core.js';
const $ = (s) => document.querySelector(s);

// ── what can take part ────────────────────────────────────────────────────────
export const isBlockModel = (L) => !!(L && L.docs && L.docs.blockDoc && gridAxesOf(L));
export const productionTables = () => S.layers.filter((L) => L.docs && L.docs.tableDoc);
export const factorMeshes = () => S.layers.filter((L) => L.kind === 'mesh' && L.docs && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
// every column a period can come from (text or numbers, derived included; not the coordinates)
export function allColsOf(L) {
  const h = layerTableHeader(L); if (!h) return [];
  const m = h.mapping || {}, xyz = new Set([m.x, m.y, m.z].filter((i) => i != null).map((i) => h.columns[i]));
  return schemaExt(L, h).map((c) => c.name).filter((n) => !xyz.has(n));
}
const nameOf = (L) => (L ? L.label || L.name : '?');
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;

// a bare column name the layer lacks is refused loudly (an unknown name compiles to a blank closure
// and the factor would read as "nothing mined" for no stated reason); an expression stays free-form
function needColumn(L, col, what) {
  const c = String(col == null ? '' : col).trim();
  if (!c) throw new Error(`${what}: required`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) return c;
  const v = validate(c, schemaExt(L, layerTableHeader(L)));
  if (!v.ok) throw new Error(`${what} “${c}”: not a column of ${nameOf(L)}`);
  return c;
}
const isBare = (c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(c || '').trim());
const valueFn = (L, c, schema) => compileValue(isBare(c) ? quoteIdent(String(c).trim()) : String(c), schema, { decimal: '.' });
async function residentFor(L, exprs) {
  const need = new Set();
  for (const x of exprs) { if (x == null || !String(x).trim()) continue; try { for (const d of exprDeps(String(x))) need.add(String(d).toLowerCase()); } catch { /* the compile names a bad expression */ } }
  if (need.size) await ensureStoredValues(L, need);
}

// density { col } | { const } with an optional unit (t/m3, g/cm3, kg/m3, lb/ft3) → { fn(f) | c, scale }
export function densityOf(L, d, schema, what) {
  if (d == null || d === '') throw new Error(`${what}: state it — { col: SG } or { const: 2.7 }`);
  const dd = typeof d === 'number' ? { const: d } : typeof d === 'string' ? (Number.isFinite(+d) && d.trim() !== '' ? { const: +d } : { col: d }) : d;
  let scale = 1;
  try { scale = unitConvert(1, dd.unit || 't/m3', 't/m3'); } catch { throw new Error(`${what}: unknown unit “${dd.unit}”`); }
  if (dd.col != null && String(dd.col).trim()) { const c = needColumn(L, dd.col, `${what} column`); return { col: c, fn: valueFn(L, c, schema), scale, label: c }; }
  if (dd.const != null && Number.isFinite(+dd.const) && +dd.const > 0) return { c: +dd.const, scale, label: String(+dd.const) };
  throw new Error(`${what}: { col: <column> } or { const: <a positive number> }`);
}

// the metal factor: stated, or from the report grade unit (tonnes of metal: % → ×0.01, g/t → ×1e-6), or 1
export function metalFactorOf(st) {
  if (st.metalFactor != null && st.metalFactor !== '' && Number.isFinite(+st.metalFactor) && +st.metalFactor > 0) return { mf: +st.metalFactor, unit: st.metalUnit || '', auto: false };
  if (st.gradeUnit) { try { return { mf: unitConvert(1, st.gradeUnit, 'fraction'), unit: 't', auto: true }; } catch { /* undeclared unit → 1 */ } }
  return { mf: 1, unit: `${st.gradeUnit === 'pct' ? '%' : st.gradeUnit || 'grade'}·t`, auto: true };
}

// a volume's fraction-inside lookup for one model: the dense winding sweep on the model's lattice
// (partial blocks), or centroid membership where the lattice can't be swept (rotated)
async function volumeLookup(L, meshL, side, res, cache) {
  const variant = side === 'above' || side === 'below' ? side : 'solid';
  const key = `${L.id}|${meshL.id}|${variant}|${res}`;
  if (cache.has(key)) return cache.get(key);
  // kept on the mesh layer across runs (a re-Run after adding the production table doesn't sweep
  // again) — valid while the mesh's parse and the model's doc are the same objects (a reload or a
  // reinterpret of either swaps them, and the entry no longer matches)
  const held = meshL._factorLooks && meshL._factorLooks.get(key);
  if (held && held.mesh === meshL._solidMesh && held.doc === L.docs.blockDoc) { cache.set(key, held.out); return held.out; }
  let fn = null, how = 'fraction';
  const dense = await evalSolidOnGrid(meshL, L, { mode: 'proportion', resolution: [res, res, res], variant });
  if (dense) fn = dense.lookup;
  else {
    const SA = await meshSolidOf(meshL, variant);
    if (!SA) throw new Error(`${nameOf(meshL)}: no triangles to test against (a streamed soup keeps none — open it as a context mesh)`);
    const hit = solidHit(SA); fn = (x, y, z) => (hit(x, y, z) ? 1 : 0); how = 'centroid';
  }
  const out = { fn, how };
  cache.set(key, out);
  (meshL._factorLooks = meshL._factorLooks || new Map()).set(key, { mesh: meshL._solidMesh, doc: L.docs.blockDoc, out });
  return out;
}

// ── the scan ─────────────────────────────────────────────────────────────────
// st: { model: { layerId, grade, unit, density }, gc: { … }, periods: 'column' | 'volumes' | 'filter' |
//   'selection', periodCol, volumes: [{ name, meshId, side }], nested, periodFilter, periodName,
//   filter, production: { layerId, period, tonnes, grade, metal, unit } | null, cutoff (null = none),
//   gradeUnit, metalFactor, metalUnit, resolution }
// → { periods, model, gc, mill (Maps key → { t, m, n }), mf, metalUnit, warnings, info, rows }
export async function scanFactors(st, onProgress, signal) {
  const { mf, unit: metalUnit } = metalFactorOf(st);
  const cutoff = st.cutoff == null || st.cutoff === '' || st.cutoff === 'none' ? null : +st.cutoff;
  if (cutoff != null && !Number.isFinite(cutoff)) throw new Error('cutoff: a number in the report grade unit, or none');
  const mode = st.periods || 'column';
  const res = Math.max(1, Math.min(6, Math.round(+st.resolution || 2)));
  const warnings = [], info = {}, cache = new Map();
  const onAbort = () => sbCancelActive();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    // the period definition, checked once
    let vols = [];
    if (mode === 'volumes') {
      vols = (st.volumes || []).map((v, i) => ({ name: String(v.name || '').trim() || `period ${i + 1}`, meshL: layerById(v.meshId), side: v.side || 'inside' }));
      if (!vols.length) throw new Error('volumes: one mesh per period — add one');
      for (const v of vols) if (!v.meshL || v.meshL.kind !== 'mesh') throw new Error(`period “${v.name}”: pick its mesh (a solid or a pit surface)`);
      const names = vols.map((v) => v.name); const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) throw new Error(`two periods are called “${dup}”`);
    }
    if (mode === 'column' && !String(st.periodCol || '').trim()) throw new Error('period column: which column names the period a block was mined in?');
    if (mode === 'filter' && !String(st.periodFilter || '').trim()) throw new Error('period filter: the expression that keeps the mined blocks');
    const oneName = String(st.periodName || '').trim() || 'period';
    const sideDefs = [['model', st.model, 'resource model'], ['gc', st.gc, 'grade control']];
    const accs = {};
    // prepare both sides (compile, check, the volume lookups), then ONE pass per distinct layer — grade
    // control as other columns of the resource model's own layer reads that layer once, not twice
    const prepared = [];
    for (const [si, [key, mdl, what]] of sideDefs.entries()) {
      const L = layerById(mdl && mdl.layerId);
      if (!isBlockModel(L)) throw new Error(`${what}: a block model (regular grid) — ${L ? `${nameOf(L)} is not one` : 'pick one'}`);
      const h = layerTableHeader(L), schema = schemaExt(L, h);
      const gcol = needColumn(L, mdl.grade, `${what} grade`), gradeFn = valueFn(L, gcol, schema);
      const dens = densityOf(L, mdl.density, schema, `${what} density`);
      const gf = gradeUnitFactor(mdl.unit, st.gradeUnit);
      let filterFn = null, perFn = null, perExpr = null, mask = null;
      if (st.filter && String(st.filter).trim()) { try { filterFn = compileBool(String(st.filter), schema, { decimal: '.' }); } catch (e) { throw new Error(`filter “${st.filter}” on ${nameOf(L)}: ${e.message}`); } }
      if (mode === 'column') { perExpr = needColumn(L, st.periodCol, `period column (on ${nameOf(L)})`); perFn = valueFn(L, perExpr, schema); }
      if (mode === 'filter') { try { perFn = compileBool(String(st.periodFilter), schema, { decimal: '.' }); perExpr = String(st.periodFilter); } catch (e) { throw new Error(`period filter on ${nameOf(L)}: ${e.message}`); } }
      if (mode === 'selection') { mask = L._selMask && L._selCount ? L._selMask : null; if (!mask) throw new Error(`${nameOf(L)}: no selection — brush the mined volume in 3D first (or use a filter)`); }
      await residentFor(L, [isBare(gcol) ? quoteIdent(gcol) : gcol, dens.col ? (isBare(dens.col) ? quoteIdent(dens.col) : dens.col) : null, st.filter, perExpr && isBare(perExpr) ? quoteIdent(perExpr) : perExpr]);
      const looks = [];
      for (const [vi, v] of vols.entries()) {
        if (onProgress) onProgress(si * 2 + vi / Math.max(1, vols.length), 4, `${nameOf(L)} · ${v.name}: fraction inside ${nameOf(v.meshL)}`);
        checkAbort(signal);
        try { looks.push(await volumeLookup(L, v.meshL, v.side, res, cache)); }
        catch (e) { if (signal && signal.aborted) throw abortErr(); if (e.message === 'cancelled') throw abortErr(); throw e; }
        checkAbort(signal);
      }
      if (looks.some((x) => x.how === 'centroid') && !warnings.some((w) => w.startsWith(nameOf(L) + ': a rotated'))) warnings.push(`${nameOf(L)}: a rotated lattice — the volumes count each block by its centroid (in or out), not by its fraction`);
      prepared.push({ key, L, gcol, gradeFn, dens, gf, filterFn, perFn, mask, looks, acc: makeAcc(mf), n: 0, blankG: 0, noDens: 0, below: 0, unmined: 0 });
    }
    const layers = [...new Set(prepared.map((p) => p.L))];
    for (const [li, L] of layers.entries()) {
      const ps = prepared.filter((p) => p.L === L), m = layerTableHeader(L).mapping, vc = volumeContextOf(L);
      const total = (L.docs.blockDoc.header && L.docs.blockDoc.header.count) || 0;
      let rows = 0;
      for await (const { f, rec } of layerRecords(L)) {
        if (((++rows) & 0x3fff) === 0) { checkAbort(signal); if (onProgress) onProgress(2 + 2 * (li + (total ? Math.min(1, rows / total) : 0)) / layers.length, 4, `${nameOf(L)} · ${rows.toLocaleString()} blocks`); await new Promise((z) => setTimeout(z)); }
        const vol = volumeAt(vc, f);
        let x = NaN, y = NaN, z = NaN;
        if (mode === 'volumes') { x = coordNum(f[m.x]); y = coordNum(f[m.y]); z = coordNum(f[m.z]); if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue; }
        for (const p of ps) {
          if (p.mask && !(rec < p.mask.length && p.mask[rec])) continue;
          if (p.filterFn && !p.filterFn(f)) continue;
          let g = numOf(p.gradeFn(f));
          if (!Number.isFinite(g)) { p.blankG++; continue; }   // a blank grade is unestimated, not 0
          g *= p.gf;
          if (cutoff != null && g < cutoff) { p.below++; continue; }
          const d = p.dens.fn ? numOf(p.dens.fn(f)) : p.dens.c;
          const t = vol * d * p.dens.scale;
          if (!(t > 0)) { p.noDens++; continue; }
          if (mode === 'column') { const k = periodKey(p.perFn(f)); if (!k) { p.unmined++; continue; } p.acc.add(k, t, g); p.n++; }
          else if (mode === 'filter') { if (p.perFn(f)) { p.acc.add(oneName, t, g); p.n++; } else p.unmined++; }
          else if (mode === 'selection') { p.acc.add(oneName, t, g); p.n++; }
          else {
            let prev = 0, any = false;
            for (let k = 0; k < vols.length; k++) {
              const fr = p.looks[k].fn(x, y, z) || 0;
              const w = st.nested ? Math.max(0, fr - prev) : fr;
              if (st.nested && fr > prev) prev = fr;
              if (w > 0) { p.acc.add(vols[k].name, t * w, g); any = true; }
            }
            if (any) p.n++; else p.unmined++;
          }
        }
      }
      for (const p of ps) p.records = rows;
    }
    for (const p of prepared) {
      if (p.blankG) warnings.push(`${nameOf(p.L)}: ${p.blankG.toLocaleString()} block${p.blankG === 1 ? '' : 's'} with a blank ${p.gcol} left out (unestimated, not zero)`);
      if (p.noDens) warnings.push(`${nameOf(p.L)}: ${p.noDens.toLocaleString()} block${p.noDens === 1 ? '' : 's'} with no density (blank or ≤ 0) left out`);
      info[p.key] = { layer: p.L.name, label: nameOf(p.L), grade: p.gcol, density: p.dens.label, mined: p.n, below: p.below, unmined: p.unmined, records: p.records };
      accs[p.key] = p.acc.map;
    }
    // production
    let mill = null;
    const pr = st.production;
    if (pr && pr.layerId != null && pr.layerId !== '') {
      const P = layerById(pr.layerId);
      if (!P || !(P.docs && P.docs.tableDoc)) throw new Error('production: a table layer (a CSV / sheet of period, tonnes, grade) — open it, then pick it');
      const h = layerTableHeader(P), schema = schemaExt(P, h);
      const pcol = needColumn(P, pr.period, 'production period'), tcol = needColumn(P, pr.tonnes, 'production tonnes');
      const gcol = pr.grade && String(pr.grade).trim() ? needColumn(P, pr.grade, 'production grade') : null;
      const mcol = pr.metal && String(pr.metal).trim() ? needColumn(P, pr.metal, 'production metal') : null;
      if (!gcol && !mcol) throw new Error('production: a grade column or a metal column (or both)');
      const pfn = valueFn(P, pcol, schema), tfn = valueFn(P, tcol, schema), gfn = gcol ? valueFn(P, gcol, schema) : null, mfn = mcol ? valueFn(P, mcol, schema) : null;
      const pf = gradeUnitFactor(pr.unit, st.gradeUnit);
      const acc = makeAcc(mf);
      let bad = 0, worst = 0;
      for await (const { f } of layerRecords(P)) {
        const k = periodKey(pfn(f)); if (!k) continue;
        const t = numOf(tfn(f)), g = gfn ? numOf(gfn(f)) * pf : NaN, mt = mfn ? numOf(mfn(f)) : NaN;
        const mm = metalMismatch(t, g, mt, mf); if (mm > worst) worst = mm;
        if (!acc.addRow(k, t, g, mt)) bad++;
      }
      if (bad) warnings.push(`production: ${bad} row${bad === 1 ? '' : 's'} without tonnes or a grade / metal left out`);
      if (worst > 0.005) warnings.push(`production: the stated metal differs from tonnes × grade × ${+mf.toPrecision(6)} by up to ${(100 * worst).toFixed(1)}% — check the metal factor and the units (the stated metal is used)`);
      mill = acc.map;
      info.mill = { layer: P.name, label: nameOf(P), rows: [...acc.map.values()].reduce((s, e) => s + e.n, 0) };
    }
    // the periods: what the mined volume defines (a volume list in its own order, else naturally sorted)
    const listed = mode === 'volumes' ? vols.map((v) => v.name) : mode === 'filter' || mode === 'selection' ? [oneName] : [];
    const periods = periodOrder(listed, mode === 'column' ? accs.model : null, mode === 'column' ? accs.gc : null);
    if (mill) {
      const extra = [...mill.keys()].filter((k) => !periods.includes(k));
      if (extra.length) warnings.push(`production period${extra.length === 1 ? '' : 's'} not mined in either model: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? ` (+${extra.length - 6})` : ''}`);
      const none = periods.filter((p) => !mill.has(p));
      if (none.length) warnings.push(`no production for: ${none.slice(0, 6).join(', ')}${none.length > 6 ? ` (+${none.length - 6})` : ''} — its F2 / F3 are blank`);
    }
    if (!periods.length) throw new Error(mode === 'column' ? `no block carries a period in ${st.periodCol}` : 'no periods');
    const rows = factorRows({ periods, model: accs.model, gc: accs.gc, mill, mf });
    const idErr = identityError(rows);
    if (idErr > 1e-9) warnings.push(`identity check: F3 vs F1 × F2 / metal vs tonnes × grade differ by ${idErr.toExponential(2)}`);
    return { mode, periods, model: accs.model, gc: accs.gc, mill, mf, metalUnit, gradeUnit: st.gradeUnit || '', cutoff, warnings, info, rows, where: 'on this page' };
  } finally { if (signal) signal.removeEventListener('abort', onAbort); }
}

// ── the shapes: the machine table + values, the human table, the chart ──────
export const factorsTable = (scan) => factorTable(scan.rows);
export const factorsValues = (scan) => factorValues(scan.rows);
const gl = (u) => (u === 'pct' ? '%' : u || '');
const QLAB = { t: 'tonnes', g: 'grade', m: 'metal' };
export function factorsHumanTSV(scan) {
  if (!scan || !scan.rows.length) return null;
  const g = gl(scan.gradeUnit);
  const unitOf = (k) => (k === 't' ? 't' : k === 'g' ? g : scan.metalUnit);
  const head = ['period', 'quantity', 'resource model', 'grade control', 'mill', 'F1', 'F2', 'F3', 'F1 to date', 'F2 to date', 'F3 to date'];
  const c = (v) => (Number.isFinite(v) ? +v.toPrecision(10) : '');
  const lines = [head.join('\t')];
  for (const r of scan.rows) for (const [, k] of QUANTITIES) lines.push([r.period, `${QLAB[k]}${unitOf(k) ? ` (${unitOf(k)})` : ''}`, c(r.model[k]), c(r.gc[k]), c(r.mill[k]), c(r.f1[k]), c(r.f2[k]), c(r.f3[k]), c(r.c.f1[k]), c(r.c.f2[k]), c(r.c.f3[k])].join('\t'));
  return lines.join('\n');
}
// o: { show: 'metal' | 'tonnes' | 'grade' | 'F1' | 'F2' | 'F3', cumulative, tolerance, ranges }
// (the analysis palette, literal — a module-level read of SERIES_COLORS would run before analysis-ui.js has, in the import cycle)
export const FACTOR_COLORS = { f1: '#5b7fa6', f2: '#c8722e', f3: '#5c8a5a', t: '#5b7fa6', g: '#8a6fae', m: '#c8722e' };
export function factorsChartSpec(scan, o = {}) {
  if (!scan || !scan.rows.length) return null;
  const show = o.show || 'metal', cum = !!o.cumulative, tol = Number.isFinite(+o.tolerance) && +o.tolerance >= 0 ? +o.tolerance : 0.1;
  const n = scan.rows.length, xs = scan.rows.map((_, i) => i + 1);
  const pick = (r) => (cum ? r.c : r);
  const series = [];
  const byQ = { metal: 'm', tonnes: 't', grade: 'g' }[show];
  if (byQ) for (const f of ['f1', 'f2', 'f3']) series.push({ name: `${f.toUpperCase()} ${show}`, color: FACTOR_COLORS[f], axis: 'left', kind: 'line', marker: 'o', data: scan.rows.map((r, i) => [xs[i], pick(r)[f][byQ]]) });
  else { const f = String(show).toLowerCase(); for (const [q, k] of QUANTITIES) series.push({ name: `${f.toUpperCase()} ${q}`, color: FACTOR_COLORS[k], axis: 'left', kind: 'line', marker: 'o', data: scan.rows.map((r, i) => [xs[i], pick(r)[f][k]]) }); }
  let lo = 1 - tol, hi = 1 + tol;
  for (const s of series) for (const [, y] of s.data) if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
  const pad = (hi - lo) * 0.12 || 0.05;
  series.unshift({ name: `mined, grade control (t${cum ? ', to date' : ''})`, color: '#6a6f75', axis: 'right', kind: 'bar', data: scan.rows.map((r, i) => [xs[i], pick(r).gc.t]) });
  series.push({ name: '1.0', color: '#9aa0a6', axis: 'left', kind: 'line', dash: true, data: [[0.5, 1], [n + 0.5, 1]] });
  // the axes: x one slot per period, the factor axis zoomed about 1 (not from 0 — a factor's story is
  // its distance from 1); a manual bound overrides its own end only
  const R = o.ranges || {}, mrg = (auto, man) => [man && man[0] != null ? man[0] : auto[0], man && man[1] != null ? man[1] : auto[1]];
  const spec = {
    xLabel: cum ? 'period (factors to date)' : 'period', leftLabel: byQ ? `factor · ${show}` : `${String(show).toUpperCase()} factor`, rightLabel: 'tonnes',
    series, xTicks: scan.rows.map((r, i) => [xs[i], String(r.period)]), hBand: tol > 0 ? { lo: 1 - tol, hi: 1 + tol, color: '#5c8a5a' } : null,
    xRange: mrg([0.5, n + 0.5], R.x), leftRange: mrg([Math.max(0, lo - pad), hi + pad], R.l),
  };
  // the tonnage bars are context, not the story: kept in the bottom third, under the factor lines
  let maxT = 0; for (const r of scan.rows) { const t = pick(r).gc.t; if (Number.isFinite(t) && t > maxT) maxT = t; }
  spec.rightRange = mrg([0, (maxT || 1) * 3], R.r);
  return spec;
}

// the window's state → the tool's params (names, not ids) and back
export function factorsCfgOf(st) {
  const nm = (id) => { const L = layerById(id); return L ? L.name : null; };
  return {
    model: nm(st.model.layerId), grade: st.model.grade, modelUnit: st.model.unit || '', density: st.model.density,
    gc: nm(st.gc.layerId), gcGrade: st.gc.grade, gcUnit: st.gc.unit || '', gcDensity: st.gc.density,
    periods: st.periods, ...(st.periods === 'column' ? { periodCol: st.periodCol } : {}),
    ...(st.periods === 'volumes' ? { volumes: st.volumes.map((v) => ({ name: v.name, mesh: nm(v.meshId), side: v.side || 'inside' })), nested: !!st.nested, resolution: +st.resolution || 2 } : {}),
    ...(st.periods === 'filter' ? { periodFilter: st.periodFilter } : {}), ...(st.periods === 'filter' || st.periods === 'selection' ? { periodName: st.periodName || 'period' } : {}),
    ...(st.filter ? { filter: st.filter } : {}),
    ...(st.production && st.production.layerId != null ? { production: nm(st.production.layerId), prodPeriod: st.production.period, prodTonnes: st.production.tonnes, ...(st.production.grade ? { prodGrade: st.production.grade } : {}), ...(st.production.metal ? { prodMetal: st.production.metal } : {}), prodUnit: st.production.unit || '' } : {}),
    cutoff: st.cutoff == null ? 'none' : st.cutoff, gradeUnit: st.gradeUnit || '', ...(st.metalFactor != null && st.metalFactor !== '' ? { metalFactor: +st.metalFactor, metalUnit: st.metalUnit || '' } : {}),
    tolerance: st.tolerance, show: st.show, cumulative: !!st.cumulative, ranges: rangesForCfg(st.ranges),
  };
}
// params (tool / recipe / saved window) → the scan's st. Throws on a named layer that isn't loaded.
export function factorsStOf(p, { lenient = false } = {}) {
  const lay = (name, what) => { if (name == null || name === '') return null; const L = layerNamed(name); if (!L) { if (lenient) return null; throw new Error(`${what}: layer “${name}” isn't loaded`); } return L.id; };
  const modelId = lay(p.model, 'model');
  const gcId = p.gc ? lay(p.gc, 'gc') : modelId;
  return {
    model: { layerId: modelId, grade: p.grade, unit: p.modelUnit || '', density: p.density },
    gc: { layerId: gcId, grade: p.gcGrade || p.grade, unit: p.gcUnit != null && p.gcUnit !== '' ? p.gcUnit : p.modelUnit || '', density: p.gcDensity != null ? p.gcDensity : p.density },
    periods: p.periods || 'column', periodCol: p.periodCol || '',
    volumes: (p.volumes || []).map((v) => ({ name: v.name, meshId: lay(v.mesh, `period “${v.name}”`), side: v.side || 'inside' })),
    nested: !!p.nested, resolution: p.resolution || 2, periodFilter: p.periodFilter || '', periodName: p.periodName || 'period', filter: p.filter || '',
    production: p.production ? { layerId: lay(p.production, 'production'), period: p.prodPeriod, tonnes: p.prodTonnes, grade: p.prodGrade || '', metal: p.prodMetal || '', unit: p.prodUnit != null && p.prodUnit !== '' ? p.prodUnit : p.gradeUnit || '' } : null,
    cutoff: p.cutoff == null || p.cutoff === 'none' || p.cutoff === '' ? null : +p.cutoff, gradeUnit: p.gradeUnit || '', metalFactor: p.metalFactor, metalUnit: p.metalUnit || '',
    tolerance: p.tolerance != null ? +p.tolerance : 0.1, show: p.show || 'metal', cumulative: !!p.cumulative,
  };
}

// ── the window ───────────────────────────────────────────────────────────────
export const _factorsWins = new Map();
const guessCol = (cols, re) => cols.find((c) => re.test(c)) || '';
const DENS_RE = /^(sg|dens|density|rho|bd|dbd)/i, GRADE_RE = /^(au|cu|fe|ag|zn|ni|pb|mo|grade)/i;

export function openFactors(L, ropts) {
  if (!isBlockModel(L)) { $('#meta').textContent = 'reconciliation factors: open it on a block model (the resource model)'; return null; }
  const ex = _factorsWins.get(L.id);
  if (ex) { if (!ropts || (!ropts.cfg && !ropts.run)) { focusWindow(ex.win.el); return ex; } ex.win.close(); }
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'reconciliation factors: no numeric column'; return null; }
  const models = () => S.layers.filter(isBlockModel);
  const others = models().filter((x) => x.id !== L.id);
  const dGuess = guessCol(nums, DENS_RE), gGuess = guessCol(nums, GRADE_RE) || nums.find((c) => c !== dGuess) || nums[0];
  const mkSide = (Lx, grade) => ({ layerId: Lx.id, grade, unit: (Lx.gtUnits && Lx.gtUnits.grade) || '', density: guessCol(numericColsOf(Lx), DENS_RE) ? { col: guessCol(numericColsOf(Lx), DENS_RE) } : { const: 2.7 } });
  const gcL = others.find((x) => /gc|grade.?control|short/i.test(x.label || x.name)) || others[0] || L;
  const prods = productionTables(), meshes = factorMeshes();
  const st = {
    model: mkSide(L, gGuess), gc: mkSide(gcL, numericColsOf(gcL).includes(gGuess) ? gGuess : guessCol(numericColsOf(gcL), GRADE_RE) || numericColsOf(gcL)[0]),
    periods: 'column', periodCol: guessCol(allColsOf(L), /^(period|mined|month|mm|qtr|quarter|year|phase|mine_?per)/i),
    volumes: meshes.length ? [{ name: 'period 1', meshId: meshes[0].id, side: 'above' }] : [], nested: true, resolution: 2,
    periodFilter: '', periodName: 'period', filter: '',
    production: prods.length ? (() => { const P = prods[prods.length - 1], cs = allColsOf(P); return { layerId: P.id, period: guessCol(cs, /^(period|month|mm|qtr|quarter|date|year|phase)/i) || cs[0] || '', tonnes: guessCol(cs, /^(t|tonnes|tons|tonnage|mass|dry)/i), grade: guessCol(cs, GRADE_RE), metal: guessCol(cs, /^(metal|oz|ounces|contained|recovered)/i), unit: '' }; })() : null,
    cutoff: null, gradeUnit: (L.gtUnits && L.gtUnits.grade) || '', metalFactor: '', metalUnit: '', tolerance: 0.1, show: 'metal', cumulative: false,
    scan: null, stale: true, running: false,
  };
  if (!st.periodCol) st.periods = meshes.length ? 'volumes' : 'filter';
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.factors);
  if (saved) {
    try { const s2 = factorsStOf({ ...saved, model: saved.model || L.name }, { lenient: true }); for (const k of Object.keys(s2)) if (s2[k] != null) st[k] = s2[k]; if (st.model.layerId == null) st.model.layerId = L.id; if (st.gc.layerId == null) st.gc.layerId = gcL.id; st.volumes = st.volumes.filter((v) => v.meshId != null); }
    catch { /* a stale saved setup: the defaults */ }
    if (saved.ranges) st.ranges = rangesFromCfg(saved.ranges);
  }
  const cfgOf = () => factorsCfgOf(st);
  const win = floatWin({ title: `factors · ${nameOf(L)}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 820), y: 90, w: 800, h: 560,
    onClose: () => { saveAnalysisCfg(L, 'factors', cfgOf(), win); setAnalysisOpen(L, 'factors', false); _factorsWins.delete(L.id); } });
  setAnalysisOpen(L, 'factors', true);
  applyAnalysisGeo(L, 'factors', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1 1 55%;min-height:120px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout fac-readout';
  const tblWrap = document.createElement('div'); tblWrap.className = 'fac-table'; tblWrap.style.cssText = 'flex:1 1 45%;min-height:80px;overflow:auto;padding:4px 8px;border-top:1px solid var(--border)';
  const warnEl = document.createElement('div'); warnEl.className = 'fac-warn'; warnEl.style.cssText = 'font:11px var(--mono);color:var(--caution);padding:2px 8px;white-space:pre-wrap';
  main.append(cv, readout, warnEl, tblWrap); body.append(rail, main);
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };
  const tol = () => (Number.isFinite(+st.tolerance) && +st.tolerance >= 0 ? +st.tolerance : 0.1);
  const renderTable = () => {
    tblWrap.textContent = '';
    if (!st.scan) return;
    const t = document.createElement('table'); t.className = 'st-tbl fac-tbl';
    const hr = document.createElement('tr');
    const cum = !!st.cumulative;
    for (const [h, num] of [['period', 0], ['', 0], ['resource', 1], ['grade control', 1], ['mill', 1], [cum ? 'F1 to date' : 'F1', 1], [cum ? 'F2 to date' : 'F2', 1], [cum ? 'F3 to date' : 'F3', 1]]) { const th = document.createElement('th'); th.textContent = h; if (num) th.style.textAlign = 'right'; hr.append(th); }
    t.append(hr);
    const g = gl(st.scan.gradeUnit);
    const unitOf = (k) => (k === 't' ? 't' : k === 'g' ? g : st.scan.metalUnit);
    const fmtQ = (v, k) => (!Number.isFinite(v) ? '–' : k === 'g' ? (+v.toPrecision(4)).toString() : Math.round(v).toLocaleString());
    const fmtF = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');
    st.scan.rows.forEach((r, ri) => {
      const src = cum ? r.c : r;
      QUANTITIES.forEach(([q, k], qi) => {
        const tr = document.createElement('tr');
        const cells = [qi === 0 ? String(r.period) : '', `${q}${unitOf(k) ? ` (${unitOf(k)})` : ''}`, fmtQ(src.model[k], k), fmtQ(src.gc[k], k), fmtQ(src.mill[k], k), fmtF(src.f1[k]), fmtF(src.f2[k]), fmtF(src.f3[k])];
        cells.forEach((v, ci) => {
          const td = document.createElement('td'); td.textContent = v; if (ci >= 2) td.className = 'num';
          if (ci === 1) td.style.color = 'var(--dim)';
          if (ci >= 5) { const x = src[['f1', 'f2', 'f3'][ci - 5]][k]; if (Number.isFinite(x) && Math.abs(x - 1) > tol() + 1e-12) { td.style.color = 'var(--caution)'; td.title = `outside ±${+(tol() * 100).toFixed(1)}%`; } }
          if (qi === 0 && ri > 0) td.style.borderTop = '1px solid var(--border)';
          tr.append(td);
        });
        t.append(tr);
      });
    });
    tblWrap.append(t);
  };
  const plot = () => {
    if (!st.scan) { plotChart(cv, { series: [], placeholder: st.running ? 'scanning…' : 'press Run' }); win._spec = null; readout.textContent = ''; warnEl.textContent = ''; renderTable(); return; }
    const spec = factorsChartSpec(st.scan, { show: st.show, cumulative: st.cumulative, tolerance: tol(), ranges: st.ranges });
    plotChart(cv, spec); win._spec = spec; win.el._factorsSpec = spec;
    readout.textContent = '';
    const add = (k, v, cls, tip) => { const s = document.createElement('span'); s.className = 'val-stat' + (cls ? ' ' + cls : ''); if (tip) s.title = tip; const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    const last = st.scan.rows[st.scan.rows.length - 1], src = st.cumulative ? last.c : last;
    add(st.cumulative ? `to date (${last.period})` : `last (${last.period})`, '');
    for (const f of ['f1', 'f2', 'f3']) {
      const parts = QUANTITIES.map(([, k]) => `${k} ${Number.isFinite(src[f][k]) ? src[f][k].toFixed(3) : '–'}`).join(' · ');
      const out = QUANTITIES.some(([, k]) => Number.isFinite(src[f][k]) && Math.abs(src[f][k] - 1) > tol() + 1e-12);
      add(f.toUpperCase(), parts, out ? 'bad' : QUANTITIES.every(([, k]) => Number.isFinite(src[f][k])) ? 'ok' : '', out ? `outside ±${+(tol() * 100).toFixed(1)}%` : '');
    }
    warnEl.textContent = st.scan.warnings.join('\n');
    const i = st.scan.info;
    win.sub.textContent = `${st.scan.rows.length} period${st.scan.rows.length === 1 ? '' : 's'} · ${st.scan.cutoff == null ? 'no cutoff' : `cutoff ${st.scan.cutoff}${gl(st.scan.gradeUnit)}`} · ${i.model.label} ${i.model.mined.toLocaleString()} blocks mined · ${i.gc.label} ${i.gc.mined.toLocaleString()}${i.mill ? ` · mill: ${i.mill.label}` : ' · no production table'}`;
    renderTable();
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  const run = async () => {
    if (st.running) return;
    st.running = true; win.sub.textContent = 'scanning…'; win.el._runFailed = null;
    const rc = runCancellable(runBtn);
    try { st.scan = await scanFactors(st, (n, N, w) => { progEl.textContent = `${Math.min(100, Math.floor(100 * n / (N || 1)))}% · ${w || ''}`; }, rc.signal); }
    catch (e) { win.el._runFailed = e.name === 'AbortError' ? 'cancelled' : e.message; win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `factors: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    win.el._scanWhere = st.scan.where;
    saveAnalysisCfg(L, 'factors', cfgOf(), win);
    plot();
  };
  // ── rail widgets ──
  const head = (t) => Object.assign(document.createElement('div'), { className: 'sw-h', textContent: t });
  const sel = (opts, val, onch, title) => {
    const s = document.createElement('select'); s.className = 'sw-sel'; s.style.width = '100%'; if (title) s.title = title;
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; s.append(o); }
    s.value = val == null ? '' : String(val); s.onchange = () => onch(s.value); return s;
  };
  const txt = (val, ph, onch, title) => { const i = document.createElement('input'); i.className = 'sw-in'; i.type = 'text'; i.value = val == null ? '' : String(val); i.placeholder = ph || ''; if (title) i.title = title; i.onchange = () => onch(i.value.trim()); return i; };
  const row = (label, el, w = 54) => { const r = document.createElement('div'); r.className = 'sw-row'; const l = document.createElement('span'); l.textContent = label; l.style.width = w + 'px'; l.style.flex = '0 0 auto'; r.append(l, el); el.style.flex = '1'; el.style.minWidth = '0'; return r; };
  const densEl = (s) => {
    const wrap = document.createElement('div'); wrap.className = 'sw-row';
    const isCol = s.density && s.density.col != null;
    const cols = numericColsOf(layerById(s.layerId) || L);
    const kind = sel([['col', 'ρ column'], ['const', 'ρ constant']], isCol ? 'col' : 'const', (v) => { s.density = v === 'col' ? { col: guessCol(cols, DENS_RE) || cols[0], unit: (s.density && s.density.unit) || '' } : { const: 2.7, unit: (s.density && s.density.unit) || '' }; markStale(); buildRail(); }, 'density: a column or a constant — tonnes = block volume × density');
    kind.style.width = '92px'; kind.style.flex = '0 0 auto';
    const val = isCol ? sel(cols.map((c) => [c, c]), s.density.col, (v) => { s.density = { ...s.density, col: v }; markStale(); }, 'the density column')
      : txt(s.density ? s.density.const : 2.7, '2.7', (v) => { s.density = { ...s.density, const: +v }; markStale(); }, 'a constant density');
    val.style.flex = '1'; val.style.minWidth = '0';
    const un = sel([['', 't/m³'], ['kg/m3', 'kg/m³'], ['lb/ft3', 'lb/ft³']], (s.density && s.density.unit) || '', (v) => { s.density = { ...s.density }; if (v) s.density.unit = v; else delete s.density.unit; markStale(); }, 'the density’s unit (→ t/m³)');
    un.style.width = '62px'; un.style.flex = '0 0 auto';
    wrap.append(kind, val, un); return wrap;
  };
  const sideBox = (s, what, tip) => {
    const box = document.createElement('div'); box.className = 'sw-ser';
    box.append(Object.assign(document.createElement('div'), { className: 'sw-stale', textContent: what, title: tip }));
    box.append(sel(models().map((x) => [x.id, nameOf(x)]), s.layerId, (v) => { s.layerId = +v; const cs = numericColsOf(layerById(s.layerId)); if (!cs.includes(s.grade)) s.grade = guessCol(cs, GRADE_RE) || cs[0]; if (s.density && s.density.col && !cs.includes(s.density.col)) s.density = guessCol(cs, DENS_RE) ? { col: guessCol(cs, DENS_RE) } : { const: 2.7 }; markStale(); buildRail(); }, `the ${what} — a block model`));
    const mid = document.createElement('div'); mid.className = 'sw-ser-top';
    const gs = sel(numericColsOf(layerById(s.layerId) || L).map((c) => [c, c]), s.grade, (v) => { s.grade = v; markStale(); }, 'the grade column');
    mid.append(gs, gradeUnitSel(s.unit || '', (v) => { s.unit = v; markStale(); }, 'this model’s grade unit (declared) — converts into the report unit'));
    box.append(mid, densEl(s));
    return box;
  };
  function buildRail() {
    rail.textContent = '';
    // ── models ──
    const mSec = document.createElement('div'); mSec.append(head('models'));
    mSec.append(sideBox(st.model, 'resource model', 'the long-range model — F1’s and F3’s denominator'));
    mSec.append(sideBox(st.gc, 'grade control', 'the short-range model — F1’s numerator, F2’s denominator (may be the same layer with other columns)'));
    rail.append(mSec);
    // ── periods ──
    const pSec = document.createElement('div'); pSec.append(head('mined volume · periods'));
    pSec.append(sel([['column', 'a period column'], ['volumes', 'a solid / surface per period'], ['filter', 'a filter (one period)'], ['selection', 'the 3D selection (one period)']], st.periods, (v) => { st.periods = v; markStale(); buildRail(); }, 'how the mined volume of each period is known'));
    if (st.periods === 'column') {
      const cols = [...new Set([...allColsOf(layerById(st.model.layerId) || L)])];
      pSec.append(row('column', sel([['', '—'], ...cols.map((c) => [c, c])], st.periodCol, (v) => { st.periodCol = v; markStale(); }, 'the column naming the period a block was mined in (blank = not mined) — on both models')));
    } else if (st.periods === 'volumes') {
      const ms = factorMeshes();
      if (!ms.length) pSec.append(Object.assign(document.createElement('div'), { className: 'sw-stale', textContent: 'open the period solids / pit surfaces (mesh layers) first' }));
      st.volumes.forEach((v, i) => {
        const box = document.createElement('div'); box.className = 'sw-ser';
        const top = document.createElement('div'); top.className = 'sw-ser-top';
        const nm = txt(v.name, `period ${i + 1}`, (x) => { v.name = x || `period ${i + 1}`; markStale(); }, 'the period’s name — production rows match it');
        const x = document.createElement('button'); x.className = 'sw-x'; x.textContent = '×'; x.title = 'remove this period'; x.onclick = () => { st.volumes.splice(i, 1); markStale(); buildRail(); };
        top.append(nm, x); box.append(top);
        const mid = document.createElement('div'); mid.className = 'sw-ser-top';
        const msel = sel(ms.map((m) => [m.id, nameOf(m)]), v.meshId, (y) => { v.meshId = +y; markStale(); }, 'the solid (its inside) or the pit surface');
        const ssel = sel([['inside', 'inside'], ['above', 'above'], ['below', 'below']], v.side || 'inside', (y) => { v.side = y; markStale(); }, 'a closed solid counts its inside; an open surface what lies above it (a pit) or below');
        ssel.style.width = '74px'; ssel.style.flex = '0 0 auto';
        mid.append(msel, ssel); box.append(mid);
        pSec.append(box);
      });
      const add = document.createElement('button'); add.className = 'sw-add'; add.textContent = '+ add period';
      add.onclick = () => { const used = new Set(st.volumes.map((v) => v.meshId)); const m = ms.find((x) => !used.has(x.id)) || ms[0]; if (!m) return; const prev = st.volumes[st.volumes.length - 1]; st.volumes.push({ name: `period ${st.volumes.length + 1}`, meshId: m.id, side: prev ? prev.side : 'above' }); markStale(); buildRail(); };
      pSec.append(add);
      const nl = document.createElement('label'); nl.className = 'sw-row'; nl.title = 'each volume holds the ones before it (pit phases, cumulative shells): period k = volume k minus volume k − 1';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!st.nested; cb.onchange = () => { st.nested = cb.checked; markStale(); };
      nl.append(cb, document.createTextNode(' nested (pit phases, shells)')); pSec.append(nl);
      pSec.append(row('samples', sel([[1, '1 (centroid)'], [2, '2³ per block'], [3, '3³ per block'], [4, '4³ per block']], st.resolution, (v) => { st.resolution = +v; markStale(); }, 'sub-samples per block for the fraction inside — partial blocks count partially')));
    } else {
      if (st.periods === 'filter') pSec.append(row('filter', txt(st.periodFilter, 'e.g. MINED == 1', (v) => { st.periodFilter = v; markStale(); }, 'the blocks mined in this period (@gcu/expr; the names must exist on both models)')));
      pSec.append(row('name', txt(st.periodName, 'period', (v) => { st.periodName = v || 'period'; markStale(); }, 'the period’s name — the production row it is matched with')));
    }
    pSec.append(row('domain', txt(st.filter, 'all blocks (optional filter)', (v) => { st.filter = v; markStale(); }, 'an optional row filter on both models, any period mode — e.g. LITO == "ORE"')));
    rail.append(pSec);
    // ── production ──
    const prSec = document.createElement('div'); prSec.append(head('production (mill)'));
    const tabs = productionTables();
    prSec.append(sel([['', tabs.length ? '— none (F1 only)' : '— open a table layer (CSV / xlsx)'], ...tabs.map((P) => [P.id, nameOf(P)])], st.production ? st.production.layerId : '', (v) => {
      if (!v) st.production = null;
      else { const P = layerById(+v), cs = allColsOf(P); st.production = { layerId: P.id, period: guessCol(cs, /^(period|month|mm|qtr|quarter|date|year|phase)/i) || cs[0] || '', tonnes: guessCol(cs, /^(t|tonnes|tons|tonnage|mass|dry)/i) || '', grade: guessCol(cs, GRADE_RE), metal: guessCol(cs, /^(metal|oz|ounces|contained|recovered)/i), unit: (st.production && st.production.unit) || '' }; }
      markStale(); buildRail();
    }, 'a non-spatial table: one row per period (or several, summed) — period, tonnes, grade and/or metal'));
    if (st.production) {
      const cs = allColsOf(layerById(st.production.layerId));
      const cSel = (k, title, opt) => sel([...(opt ? [['', '—']] : []), ...cs.map((c) => [c, c])], st.production[k], (v) => { st.production[k] = v; markStale(); }, title);
      prSec.append(row('period', cSel('period', 'the period, matched by name to the mined periods')));
      prSec.append(row('tonnes', cSel('tonnes', 'tonnes treated')));
      const gRow = document.createElement('div'); gRow.className = 'sw-ser-top';
      gRow.append(cSel('grade', 'head grade', true), gradeUnitSel(st.production.unit || '', (v) => { st.production.unit = v; markStale(); }, 'the production grade’s unit (declared)'));
      prSec.append(row('grade', gRow));
      prSec.append(row('metal', cSel('metal', 'metal, if stated (in the metal unit) — otherwise tonnes × grade × factor', true)));
    }
    rail.append(prSec);
    // ── report ──
    const rSec = document.createElement('div'); rSec.append(head('report'));
    rSec.append(row('cutoff', txt(st.cutoff == null ? '' : st.cutoff, 'none', (v) => { st.cutoff = v === '' || v === 'none' ? null : +v; markStale(); }, 'blocks at or above it count (in the report grade unit); blank = no cutoff')));
    rSec.append(row('unit', gradeUnitSel(st.gradeUnit || '', (v) => { st.gradeUnit = v; markStale(); }, 'the report grade unit — grades convert into it; metal is in tonnes of metal when it is declared')));
    rSec.append(row('metal ×', txt(st.metalFactor, `auto (${+metalFactorOf({ gradeUnit: st.gradeUnit }).mf.toPrecision(4)})`, (v) => { st.metalFactor = v === '' ? '' : +v; markStale(); }, 'metal = tonnes × grade × this (blank: from the grade unit — % → 0.01, g/t → 1e-6; 1/31.1035 for g/t → oz)')));
    if (st.metalFactor !== '' && st.metalFactor != null) rSec.append(row('metal unit', txt(st.metalUnit, 'oz, t, lb…', (v) => { st.metalUnit = v; if (st.scan) st.scan.metalUnit = v; if (st.scan) plot(); })));
    rSec.append(row('tolerance', txt(st.tolerance, '0.1', (v) => { st.tolerance = Number.isFinite(+v) && +v >= 0 ? +v : 0.1; if (st.scan) plot(); }, 'the band drawn around 1.0 (0.1 = ±10%) — factors outside it are marked')));
    rail.append(rSec);
    // ── display ──
    const vSec = document.createElement('div'); vSec.append(head('chart'));
    vSec.append(row('show', sel([['metal', 'F1 · F2 · F3 — metal'], ['tonnes', 'F1 · F2 · F3 — tonnes'], ['grade', 'F1 · F2 · F3 — grade'], ['F1', 'F1 — t · g · metal'], ['F2', 'F2 — t · g · metal'], ['F3', 'F3 — t · g · metal']], st.show, (v) => { st.show = v; if (st.scan) plot(); }, 'which factors the chart draws')));
    const cl = document.createElement('label'); cl.className = 'sw-row'; cl.title = 'factors to date: tonnes and metal summed over every period so far';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!st.cumulative; cb.onchange = () => { st.cumulative = cb.checked; if (st.scan) plot(); };
    cl.append(cb, document.createTextNode(' cumulative (to date)')); vSec.append(cl);
    vSec.append(rangesRow(st, () => { if (st.scan) plot(); }, { x: 'x', l: 'factor', r: 't' }));
    rail.append(vSec);
    // ── footer ──
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rname = () => `${nameOf(L).replace(/\.[^.]+$/, '')} factors`;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes)';
    rcpBtn.onclick = () => saveRecipe('factors', cfgOf(), rname());
    win.el._recipe = () => ({ tool: 'factors', name: rname(), params: cfgOf() });   // ⇥ figure keeps this: a chart that re-runs
    const resRow = plotExportBtns(cv, () => `factors-${nameOf(L).replace(/\.[^.]+$/, '')}.png`.replace(/[^\w.-]+/g, '_'), () => (st.scan ? factorsHumanTSV(st.scan) : null), 'factors');
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(runBtn, rcpBtn, resRow, staleEl, progEl); rail.append(foot);
  }
  const handle = { win, redraw: run, st, run, plot };
  _factorsWins.set(L.id, handle);
  buildRail(); plot();
  if (ropts && ropts.run) run();
  return handle;
}
