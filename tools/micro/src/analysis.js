// micro analysis core — the pure compute behind the GT / swath / validation
// windows: numeric-column census, block-support volumes (sub-blocked aware),
// grade-tonnage, swath profiles, and the drillhole sample extract + declustered
// sample swath. Streams via layerRecords (record numbering + census-extended
// rows come from there); ensureStoredValues faults evicted matcols back in at
// every scan head. No DOM — the windows drive these and own the drawing.
import { convert as unitConvert } from '../../../ext/units/index.js';
import { layerTableHeader, colIsNumeric, schemaExt, layerRecords, attrRowCountOf, numOf, extendRow } from './records.js';
import { ensureStoredValues } from './columns.js';
import { gridAxesOf } from './grid-ops.js';
import { coordNum, supportOfHeader, volumeOf, volumeOfSizes, sizeQ } from '../../../ext/condenser/src/main.js';

// ── the metal factor: ONE rule for every metal = tonnes × grade × factor (factors, the resource table) ──
// A typed factor: a plain number or a simple fraction a/b ("1/31.1035" for g/t → oz). Blank → null
// (absent: the rule below decides); anything else → NaN, which callers REFUSE (never a silent fallback).
export function parseFactor(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : NaN;
  const s = String(v).trim();
  if (!s) return null;
  const num = /^[+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  if (num.test(s)) return +s > 0 ? +s : NaN;
  const m = /^(.+?)\s*\/\s*(.+)$/.exec(s);
  if (m && num.test(m[1].trim()) && num.test(m[2].trim()) && +m[2] > 0 && +m[1] > 0) return +m[1] / +m[2];
  return NaN;
}
// a grade unit as @gcu/units spells it (the windows offer pct; a typed "%" means the same)
export const unitKey = (u) => { const s = String(u || '').trim(); return s === '%' ? 'pct' : s; };
// { metalFactor?, metalUnit?, gradeUnit? } → { mf, unit, auto }: a stated factor wins (its unit as
// stated); else a declared grade unit gives tonnes of metal (% → × 0.01, g/t and ppm → × 1e-6);
// else 1, the metal in "grade·t". A stated factor that isn't a positive number or a/b throws.
export function metalFactorOf(st) {
  const f = parseFactor(st.metalFactor);
  if (Number.isNaN(f)) throw new Error(`metal factor “${st.metalFactor}”: a positive number or a fraction such as 1/31.1035`);
  if (f != null) return { mf: f, unit: st.metalUnit || '', auto: false };
  const gu = unitKey(st.gradeUnit);
  if (gu) { try { return { mf: unitConvert(1, gu, 'fraction'), unit: 't', auto: true }; } catch { /* an undeclared unit → 1 */ } }
  return { mf: 1, unit: `${gu === 'pct' ? '%' : gu || 'grade'}·t`, auto: true };
}

export function numericColsOf(L) {
  const h = layerTableHeader(L); if (!h) return []; const m = h.mapping || {};
  const base = h.columns.filter((_, i) => colIsNumeric(L, h, i) && ![m.x, m.y, m.z].includes(i));
  const calc = (L.calcCols || []).filter((c) => c.ty !== 'string').map((c) => c.name);       // computed columns
  const paintNum = (L.paintCols || []).filter((c) => c.kind === 'ratio').map((c) => c.name);   // ratio incl. MATERIALIZED (estimated) columns
  return [...base, ...calc, ...paintNum];                                                       // GT/swath/stats read these via schemaExt + extendRow
}
// ── block VOLUMES, from the block-support contract (condenser grid/support.js) ──
// A block's volume is Π size · pitch: the lattice pitch (rotation-free — a rotated
// model's pitch is in its own frame, and a rotation keeps volume), times the
// block's size in fine steps — 1 for a regular model, the record's stated sizes
// (XINC/YINC/ZINC, DX/DY/DZ) snapped to whole fine steps for a sub-blocked one:
// the same box the renderer draws (dimQ). One rule, so GT, swath, stats, the
// cross-tab, the resource table, factors and contact all weigh a block the same,
// and none of them asks whether the model is rotated or sub-blocked itself.
export function blockVolumeOf(L) { const vc = volumeContextOf(L); return vc.base; }
// → { base, dc, pitch, dims }: base = a regular block's volume (Π pitch; 1 without a
// grid), dc = the size columns' indices (sub-blocked) or null, dims = their names
// (for a columnar scan), pitch = the fine pitch [3].
export function volumeContextOf(L) {
  const bd = L.docs && L.docs.blockDoc, h = bd && bd.header;
  const sup = h ? supportOfHeader(h) : null;
  if (!sup) return { base: 1, dc: null, pitch: null, dims: null };
  const pitch = sup.lattice.pitch.map((p) => Math.abs(+p) || 1);
  const base = Math.abs(volumeOf(1, 1, 1, pitch)) || 1;
  const dc = sup.sub && h.dimCols ? h.dimCols : null;       // { x, y, z } → column indices
  return { base, dc, pitch, dims: dc && h.columns ? [h.columns[dc.x], h.columns[dc.y], h.columns[dc.z]] : null };
}
export function volumeAt(vc, f) {
  if (!vc.dc) return vc.base;
  const v = volumeOfSizes(Math.abs(+f[vc.dc.x]), Math.abs(+f[vc.dc.y]), Math.abs(+f[vc.dc.z]), vc.pitch);
  return v > 0 ? v : vc.base;                              // a missing/zero size → one fine cell, honest not zero
}
// half extents of one block in its own frame ([3]) — the box volumeAt weighs
export function halfAt(vc, f, out = [0, 0, 0]) {
  const ci = vc.dc ? [vc.dc.x, vc.dc.y, vc.dc.z] : null;
  for (let a = 0; a < 3; a++) {
    const p = vc.pitch ? vc.pitch[a] : 1, d = ci ? Math.abs(+f[ci[a]]) : 0;
    out[a] = (d > 0 ? sizeQ(d, p) * p : p) / 2;             // regular (or a missing size): one cell of the pitch
  }
  return out;
}
// the same rule as an @gcu/expr expression over the size columns (null when regular):
// for a tool that reads per-record values through an expression (contact)
export function volumeExprOf(vc, quote) {
  if (!vc.dims) return null;
  return vc.dims.map((nm, a) => `clamp(round(abs(${quote(nm)}) / ${String(vc.pitch[a])}), 1, 255) * ${String(vc.pitch[a])}`).join(' * ');
}
// the same rule handed to a columnar scan kernel (@gcu/scan: params.vol)
export const volParamsOf = (vc) => ({ base: vc.base, dims: vc.dims, pitch: vc.dims ? vc.pitch : null });
// The SUPPORT a record stands for, for the accumulating tools (grade-tonnage,
// cross-tab). A block stands for a VOLUME (m³; × density → tonnes). A drillhole
// interval stands for a LENGTH of core: TO − FROM, in metres. There is no
// cross-section area anywhere in an interval table, so length × density is NOT
// tonnes — it is tonnes per m² of section (m · t/m³), and the tools must name it
// that way rather than borrow the block model's "tonnes". Counting each interval
// as 1 (what volumeAt did, since a drillhole has no grid) weighted a 0.3 m sliver
// like a 3 m run and labelled the count m³. → { kind: 'volume', vc } |
// { kind: 'length', from, to } (column indices into the interval row).
export function supportContextOf(L) {
  const d = L.docs || {};
  if (d.dhDoc && !d.blockDoc) {
    const im = d.dhDoc.header && d.dhDoc.header.intervalMapping;
    if (!im || im.from == null || im.to == null || im.from < 0 || im.to < 0) throw new Error(`${L.label || L.name}: a drillhole layer without FROM/TO columns — no interval lengths to weight by`);
    return { kind: 'length', from: im.from, to: im.to };
  }
  // a model opened AS POINTS has no blocks — no volume per record; the windows refuse it, and a
  // routine step must too (it used to count every point as 1 m³ and call it volume)
  if (!gridAxesOf(L)) throw new Error(`${L.label || L.name}: no block grid — a model opened as points has no block volumes to weigh by (reopen it as a block model)`);
  return { kind: 'volume', vc: volumeContextOf(L) };
}
// the record's support: its interval length (0 when FROM/TO are blank or
// reversed — such a row is left out, not counted as 1) or its block volume
export function supportAt(sc, f) {
  if (sc.kind === 'length') { const len = numOf(f[sc.to]) - numOf(f[sc.from]); return len > 0 ? len : 0; }
  return volumeAt(sc.vc, f);
}
// how an accumulated support is NAMED, in a machine table and on a chart.
// weighted = a density/weight expression multiplied in.
//   volume, no weight → volume  (m³)            · metal = grade × m³
//   volume, weight    → tonnes  (t)             · metal = t of metal when the grade unit is declared
//   length, no weight → length  (m)             · accumulation = grade × m (the "%·m" / "g/t·m" of an intercept)
//   length, weight    → weighted_length (m·t/m³ = t per m² of section, NOT tonnes) · accumulation = grade × that
export function supportMeasure(kind, weighted, gradeUnit) {
  const gl = gradeUnit === 'pct' ? '%' : (gradeUnit || '');
  if (kind === 'length') {
    const col = weighted ? 'weighted_length' : 'length', unit = weighted ? 'm·t/m3' : 'm', short = weighted ? 'm·t/m³' : 'm';
    return { kind, col, unit, short, axis: weighted ? 'length × density (m·t/m³)' : 'length (m)', sub: weighted ? 'length × density (not tonnes — no section area)' : 'length-weighted (m)',
      metalCol: 'accumulation', metalUnit: `${gl || 'grade'}·${unit}`, metalShort: `${gl || 'grade'}·${short}`, metalScale: () => 1, countCol: 'intervals' };
  }
  const col = weighted ? 'tonnes' : 'volume', unit = weighted ? 't' : 'm3', short = weighted ? 't' : 'm³';
  return { kind, col, unit, short, axis: weighted ? 'tonnage (t)' : 'volume (m³)', sub: weighted ? 'tonnes' : 'volume (no density)',
    // a declared grade unit turns grade × amount into metal: tonnes of it over tonnes, m³ of it over m³
    metalCol: 'metal', metalUnit: gradeUnit ? unit : `${gl || 'grade'}·${unit}`, metalShort: gradeUnit ? short : `${gl || 'grade'}·${short}`,
    metalScale: () => (gradeUnit ? unitConvert(1, gradeUnit, 'fraction') : 1), countCol: 'blocks' };
}
// grade-tonnage: for each series column, cutoff → (tonnage above, mean grade above)
// weight: a column name (back-compat) or { col?, const?, unit? } — `unit` is a
// DECLARED density unit ('t/m3' | 'kg/m3' | 'lb/ft3'…), converted to t/m³ via
// @gcu/units so tonnage comes out in actual tonnes; `const` is a fixed density
// for models without a density column.
export async function computeGT(L, cols, weightCol, nCut, onProgress, selMask) {
  const wspec = typeof weightCol === 'string' ? { col: weightCol } : (weightCol || {});
  await ensureStoredValues(L, new Set([...cols, wspec.col].filter(Boolean).map((x) => String(x).toLowerCase())));
  const h = layerTableHeader(L), schema = schemaExt(L, h), nameIdx = (nm) => schema.findIndex((c) => c.name === nm);
  const idx = cols.map(nameIdx);                            // via schemaExt → source AND derived (calc/estimated) columns
  const wi = wspec.col ? nameIdx(wspec.col) : -1, vc = volumeContextOf(L);   // per-record volume (sub-blocked)
  const dScale = wspec.unit ? unitConvert(1, wspec.unit, 't/m3') : 1;
  const dConst = wspec.const != null && Number.isFinite(+wspec.const) ? +wspec.const : null;
  const ser = cols.map(() => ({ g: [], w: [] }));
  let gmin = Infinity, gmax = -Infinity, rc = 0;
  for await (const { f, rec: rAt } of layerRecords(L)) {
    rc++;
    if (!selMask || (rAt < selMask.length && selMask[rAt])) {
      const wt = (wi >= 0 ? (+f[wi] || 0) : dConst != null ? dConst : 1) * dScale * volumeAt(vc, f);
      for (let s = 0; s < idx.length; s++) { const v = numOf(f[idx[s]]); if (Number.isFinite(v)) { ser[s].g.push(v); ser[s].w.push(wt); if (v < gmin) gmin = v; if (v > gmax) gmax = v; } }
    }
    if ((rc & 0xffff) === 0) { if (onProgress) onProgress(rc); await new Promise((r) => setTimeout(r)); }   // yield per 64k, not per batch
  }
  if (onProgress) onProgress(rc);
  if (!Number.isFinite(gmin)) return null;
  const cuts = []; for (let i = 0; i <= nCut; i++) cuts.push(gmin + (gmax - gmin) * i / nCut);
  const gt = ser.map((d) => {
    const ord = [...d.g.keys()].sort((a, b) => d.g[b] - d.g[a]);   // grade desc
    const cw = new Float64Array(ord.length + 1), cwg = new Float64Array(ord.length + 1);
    for (let k = 0; k < ord.length; k++) { cw[k + 1] = cw[k] + d.w[ord[k]]; cwg[k + 1] = cwg[k] + d.w[ord[k]] * d.g[ord[k]]; }
    const gsorted = ord.map((i) => d.g[i]);
    return cuts.map((c) => {
      let lo = 0, hi = gsorted.length; while (lo < hi) { const md = (lo + hi) >> 1; if (gsorted[md] >= c) lo = md + 1; else hi = md; }
      return { cut: c, tonnage: cw[lo], grade: cw[lo] > 0 ? cwg[lo] / cw[lo] : NaN };
    });
  });
  return { cuts, gt, gmin, gmax, weighted: wi >= 0 || dConst != null };
}
// per band along dir: tonnage-weighted mean grade for each series + count/tonnage
export async function computeSwath(L, cols, dir, bandWidth, offset, weightCol, onProgress, selMask, rowPred = null) {
  // rowPred: an optional (fields) → bool over the layer's schema (a domain filter — validation's `filter`)
  await ensureStoredValues(L, new Set([...cols, weightCol, ...(rowPred && rowPred.deps ? rowPred.deps : [])].filter(Boolean).map((x) => String(x).toLowerCase())));
  const h = layerTableHeader(L), m = h.mapping, schema = schemaExt(L, h), nameIdx = (nm) => schema.findIndex((c) => c.name === nm);
  const idx = cols.map(nameIdx);                            // source AND derived (calc/estimated) columns
  const wi = weightCol ? nameIdx(weightCol) : -1, vc = volumeContextOf(L);   // per-record volume: a sub-blocked parent block is not one fine cell
  const bands = new Map(); let rc = 0;                     // layerRecords owns the record number now
  for await (const { f, rec: rAt } of layerRecords(L)) {
    {
      rc++;
      const inSel = !selMask || (rAt < selMask.length && selMask[rAt]);
      if (!inSel) continue;
      if (rowPred) { let keep = false; try { keep = !!rowPred(f); } catch { keep = false; } if (!keep) continue; }
      const x = coordNum(f[m.x]), y = coordNum(f[m.y]), z = coordNum(f[m.z]); if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const t = x * dir[0] + y * dir[1] + z * dir[2], bi = Math.floor((t - offset) / bandWidth);
      let e = bands.get(bi); if (!e) { e = { w: new Float64Array(cols.length), wg: new Float64Array(cols.length), tw: 0, n: 0 }; bands.set(bi, e); }
      const wt = (wi >= 0 ? (+f[wi] || 0) : 1) * volumeAt(vc, f); e.tw += wt; e.n++;
      for (let s = 0; s < idx.length; s++) { const v = numOf(f[idx[s]]); if (Number.isFinite(v)) { e.w[s] += wt; e.wg[s] += wt * v; } }
    }
    if ((rc & 0xffff) === 0) { if (onProgress) onProgress(rc); await new Promise((r) => setTimeout(r)); }   // yield per 64k, not per batch
  }
  if (onProgress) onProgress(rc);
  const keys = [...bands.keys()].sort((a, b) => a - b);
  const profile = keys.map((bi) => { const e = bands.get(bi); return { band: bi, center: offset + (bi + 0.5) * bandWidth, mean: cols.map((_, s) => (e.w[s] > 0 ? e.wg[s] / e.w[s] : NaN)), tonnage: e.tw, count: e.n }; });
  return { profile, weighted: wi >= 0 };
}
// drillhole samples for validation: desurveyed interval midpoints + one grade
// The grade and the filter resolve against the FULL census (schemaExt) on the extended row, the way
// the model side does — a calc (ƒ) sample grade or a painted domain flag is a column like any other.
// rowPred is compiled against schemaExt(D) too. Materialized inputs must be resident (validationRun
// faults them in before calling this).
export function extractSamples(D, gradeCol, rowPred = null) {   // rowPred: an optional domain filter over the intervals
  const dh = D.docs && D.docs.dhDoc, h = layerTableHeader(D); if (!dh || !h) return [];
  const census = schemaExt(D, h);
  let gi = census.findIndex((c) => c.name === gradeCol);
  if (gi < 0) gi = census.findIndex((c) => c.name.toLowerCase() === String(gradeCol).toLowerCase());
  if (gi < 0) return [];
  const derived = gi >= h.columns.length || !!rowPred;      // only extend the row when something reads past the raw columns
  const n = attrRowCountOf(D), rows = [];
  for (let r = 0; r < n; r++) {
    const pos = dh.recordPosition(r); if (!pos) continue;
    const raw = dh.fetchRecord(r); if (!raw) continue;
    const rec = derived ? extendRow(D, raw, r) : raw;
    if (rowPred) { let keep = false; try { keep = !!rowPred(rec); } catch { keep = false; } if (!keep) continue; }
    const g = numOf(rec[gi]); if (Number.isFinite(g)) rows.push([pos[0], pos[1], pos[2], g]);
  }
  return rows;
}
export function autoDeclusterSizes(samples) {
  let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
  for (const s of samples) { if (s[0] < xmn) xmn = s[0]; if (s[0] > xmx) xmx = s[0]; if (s[1] < ymn) ymn = s[1]; if (s[1] > ymx) ymx = s[1]; }
  const ext = Math.max(xmx - xmn, ymx - ymn) || 100;
  // GEOMETRIC sweep fine → ~half-extent, so it spans the drill spacing (the
  // scale that matters) whatever it is, not just the fine end
  const lo = ext / 100, hi = ext / 2, N = 24, sizes = [];
  for (let k = 0; k < N; k++) sizes.push(+(lo * Math.pow(hi / lo, k / (N - 1))).toPrecision(3));
  return sizes;
}
export function computeSampleSwath(samples, weights, dir, bandWidth, offset) {
  const bands = new Map();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], t = s[0] * dir[0] + s[1] * dir[1] + s[2] * dir[2], bi = Math.floor((t - offset) / bandWidth), w = weights ? weights[i] : 1;
    let e = bands.get(bi); if (!e) { e = { sw: 0, swg: 0, n: 0 }; bands.set(bi, e); }
    e.sw += w; e.swg += w * s[3]; e.n++;
  }
  return [...bands.keys()].sort((a, b) => a - b).map((bi) => { const e = bands.get(bi); return { center: offset + (bi + 0.5) * bandWidth, mean: e.sw > 0 ? e.swg / e.sw : NaN, count: e.n }; });
}

// ── the RESOURCE TABLE: tonnes, grade and metal above each cutoff, by up to two categories
// (domain × class) — the table a resource statement is. Tonnes = volume × density, the volume
// per record (sub-blocked aware), the density a column or a constant (a declared unit → t/m³).
// Metal = tonnes × grade × metalFactor — stated, or from the declared gradeUnit (metalFactorOf:
// % → × 0.01, g/t → × 1e-6, metal in tonnes), or 1.
// p: { grade, cutoffs: [..], density: { col? | const?, unit? }, groupBy: [col, col?],
//   metalFactor?, gradeUnit?, mask } → { columns, rows } (rows: cutoff, groups…, tonnes, grade, metal;
//   a "total" row after each cutoff's groups when there are groups)
export async function computeResourceTable(L, p, onProgress) {
  const groupBy = (p.groupBy || []).filter(Boolean).slice(0, 2), cutoffs = (p.cutoffs || [0]).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!p.grade) throw new Error('resource table: which grade column?');
  if (!cutoffs.length) throw new Error('resource table: at least one cutoff');
  const dens = p.density || {};
  await ensureStoredValues(L, new Set([p.grade, dens.col, ...groupBy].filter(Boolean).map((x) => String(x).toLowerCase())));
  const h = layerTableHeader(L), schema = schemaExt(L, h), at = (nm) => schema.findIndex((c) => c.name === nm || c.name.toLowerCase() === String(nm).toLowerCase());
  const gi = at(p.grade); if (gi < 0) throw new Error(`resource table: no column “${p.grade}” on ${L.label || L.name}`);
  const di = dens.col ? at(dens.col) : -1; if (dens.col && di < 0) throw new Error(`resource table: no density column “${dens.col}”`);
  const ki = groupBy.map((c) => { const i = at(c); if (i < 0) throw new Error(`resource table: no column “${c}”`); return i; });
  const dScale = dens.unit ? unitConvert(1, dens.unit, 't/m3') : 1, dConst = dens.const != null && Number.isFinite(+dens.const) ? +dens.const : 1;
  const vc = volumeContextOf(L), mask = p.mask || null;
  const { mf, unit: metalUnit, auto: mfAuto } = metalFactorOf(p);   // stated, or from the declared grade unit (as the factors tool)
  const acc = new Map();                                    // "cutoff|g1|g2" → { t, tg }
  let rc = 0;
  for await (const { f, rec } of layerRecords(L)) {
    rc++;
    if ((rc & 0xffff) === 0) { if (onProgress) onProgress(rc); await new Promise((r) => setTimeout(r)); }
    if (mask && !(rec < mask.length && mask[rec])) continue;
    const g = numOf(f[gi]); if (!Number.isFinite(g)) continue;
    const t = volumeAt(vc, f) * (di >= 0 ? (+f[di] || 0) : dConst) * dScale;
    if (!(t > 0)) continue;
    const key = ki.map((i) => { const v = f[i]; return v == null || v === '' ? '—' : String(v); }).join('|');
    for (const c of cutoffs) {
      if (g < c) break;
      const k = c + '|' + key; let a = acc.get(k); if (!a) acc.set(k, (a = { t: 0, tg: 0 }));
      a.t += t; a.tg += t * g;
    }
  }
  if (onProgress) onProgress(rc);
  const columns = ['cutoff', ...groupBy, 'tonnes', 'grade', 'metal'], rows = [];
  for (const c of cutoffs) {
    const keys = [...acc.keys()].filter((k) => k.startsWith(c + '|')).map((k) => k.slice(String(c).length + 1)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let T = 0, TG = 0;
    for (const k of keys) {
      const a = acc.get(c + '|' + k); T += a.t; TG += a.tg;
      rows.push([c, ...(groupBy.length ? k.split('|') : []), a.t, a.tg / a.t, (a.tg * mf)]);
    }
    if (groupBy.length && keys.length > 1) rows.push([c, 'total', ...groupBy.slice(1).map(() => ''), T, T > 0 ? TG / T : NaN, TG * mf]);
    if (!keys.length) rows.push([c, ...groupBy.map(() => '—'), 0, NaN, 0]);
  }
  return { columns, rows, records: rc, mf, metalUnit, mfAuto };
}
