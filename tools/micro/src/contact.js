// micro contact analysis — domaining validation: grade binned by distance to a
// boundary, both sides. A step at the contact is a HARD boundary (estimate the
// domains apart), a ramp a SOFT one (share samples across it). Two flavours:
//   down-hole — every A→B transition along each hole of a drillhole layer (a
//     domain column, intervals in FROM order), stepping away from the contact
//     inside each run, length-weighted;
//   to a surface — the signed distance of every record (interval midpoints,
//     block centroids) to a wireframe: a closed solid (sign by winding number,
//     negative inside) or an open surface (side by its pseudo-normals, negative
//     below), so samples and the model overlay on one chart and you see whether
//     the model smears grade across a boundary the samples call hard.
// The pure binning is ./contact-core.js; the nearest-point query @gcu/geometry's.
import { S, layerById, requestRender } from './state.js';
import { attrRowCountOf, layerRecords, layerTableHeader, numOf, schemaExt, colIsNumeric } from './records.js';
import { compileBool, compileValue, quoteIdent, validate, deps as exprDeps } from '../../../ext/expr/index.js';
import { nearestBVH, orientTriangles, pseudoNormals, sideOf } from '../../../ext/geometry/index.js';
import { windingBVH } from '../../../ext/winding/index.js';
import { numericColsOf, volumeContextOf, blockVolumeOf } from './analysis.js';
import { canScanColumnar, scanColumnar } from './colscan.js';
import { meshSolidOf, solidOrientedMesh, layerPositions } from './bygeom.js';
import { gridAxesOf } from './grid-ops.js';
import { SERIES_COLORS, analysisSerCfg, analysisSerRestore, applyAnalysisGeo, checkAbort, fmtStat, plotChart, plotExportBtns, rangesForCfg, rangesFromCfg, rangesOf, rangesRow, runCancellable, saveAnalysisCfg, scanProgressText, scopeMask, scopeMissing, setAnalysisOpen } from './analysis-ui.js';
import { floatWin, focusWindow } from './windows.js';
import { saveRecipe } from './recipes.js';
import { matColSet, ensureStoredValues } from './columns.js';
import { persistElement } from './element-store.js';
import { mkLineage } from './lineage.js';
import { markProjectDirty } from './project.js';
import { microPrompt } from './prompts.js';
import { downholeContacts, binRecord, contactValues, contactBinRows } from './contact-core.js';
const $ = (s) => document.querySelector(s);

// ── what can take part ────────────────────────────────────────────────────────
export const isDhLayer = (L) => !!(L && L.dh && L.docs && L.docs.dhDoc && !L.trace);
export const isBlockLayer = (L) => !!(L && L.docs && L.docs.blockDoc && gridAxesOf(L));
export const contactSurfaces = () => S.layers.filter((L) => L.kind === 'mesh' && L.docs && L.docs.meshDoc && !L.docs.meshDoc.header.soup);
// the text columns a domain can come from: the table's text columns (not the hole id), painted
// category columns and text ƒ columns
export function categoryColsOf(L) {
  const h = layerTableHeader(L); if (!h) return [];
  const im = (L.docs.dhDoc && L.docs.dhDoc.header.intervalMapping) || {};
  const skip = new Set([im.bhid, im.from, im.to]);
  const base = h.columns.filter((_, i) => !skip.has(i) && !colIsNumeric(L, h, i));
  return [...base, ...(L.paintCols || []).filter((c) => c.kind !== 'ratio').map((c) => c.name), ...(L.calcCols || []).filter((c) => c.ty === 'string').map((c) => c.name)];
}
// the distinct values of a column (a domain's catalogue), at most 256
export async function distinctValues(L, col) {
  const h = layerTableHeader(L); if (!h) return [];
  let fn; try { fn = compileValue(quoteIdent(col), schemaExt(L, h), { decimal: '.' }); } catch { return []; }
  const seen = new Map();
  for await (const { f } of layerRecords(L)) {
    const v = fn(f), k = v == null ? '' : String(v).trim();
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.size > 256) break;
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

// ── the signed distance to a mesh layer ───────────────────────────────────────
// { closed, sideNames, label, at(x, y, z, maxDist) → signed distance | NaN beyond maxDist }
// closed: |winding| ≥ ½ is inside → negative. Open: each piece wound consistently, then the
// whole flipped so its normals face UP on average (so "above" is positive); a surface that is
// mostly vertical keeps the side its normals face, and the sides are named "−" / "+".
export async function meshDistanceOf(meshL) {
  if (!meshL || meshL.kind !== 'mesh') throw new Error('a surface or solid must be a mesh layer');
  const SA = await meshSolidOf(meshL, 'solid');
  const m = await solidOrientedMesh(meshL);
  if (!SA || !m) throw new Error(`${meshL.label || meshL.name}: no triangles to measure against (a streamed soup keeps none — open it as a context mesh)`);
  if (meshL._contactDist && meshL._contactDist.SA === SA) return meshL._contactDist;
  const label = meshL.label || meshL.name;
  let out;
  if (m.closed) {
    out = {
      SA, closed: true, label, sideNames: ['inside', 'outside'],
      at(x, y, z, maxDist = Infinity) {
        const hit = nearestBVH(SA, [x, y, z], { maxDist });
        if (!hit) return NaN;
        const w = windingBVH(x, y, z, SA.vertices, SA.triangles, SA.nodes, SA.triIndices);
        return Math.abs(w) >= 0.5 ? -hit.dist : hit.dist;
      },
    };
  } else {
    const o = orientTriangles(SA.triangles);
    const T = o.triangles, V = SA.vertices;
    let nz = 0, na = 0;                                    // the area-weighted mean normal's z
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2], e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      nz += cz; na += Math.hypot(cx, cy, cz);
    }
    if (nz < 0) for (let t = 0; t < T.length; t += 3) { const tmp = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = tmp; }
    const mesh = { vertices: V, triangles: T, nodes: SA.nodes, triIndices: SA.triIndices };   // the BVH holds triangle ids — winding order doesn't move a bound
    const pn = pseudoNormals(V, T);
    const flat = na > 0 && Math.abs(nz) / na >= 0.25;
    out = {
      SA, closed: false, label, sideNames: flat ? ['below', 'above'] : ['side −', 'side +'], pieces: o.pieces,
      at(x, y, z, maxDist = Infinity) {
        const p = [x, y, z], hit = nearestBVH(mesh, p, { maxDist });
        if (!hit) return NaN;
        return sideOf(pn, hit, p) < 0 ? -hit.dist : hit.dist;
      },
    };
  }
  meshL._contactDist = out;
  return out;
}

// every record's signed distance to the mesh (NaN: no position, or farther than maxDist) — the
// positions streamed (block models through the columnar engine), the far field skipped by the
// mesh's box grown by maxDist
export async function layerSignedDistances(L, md, { maxDist = Infinity, onProgress = null, signal = null } = {}) {
  const n = attrRowCountOf(L) || 0, dist = new Float32Array(n).fill(NaN);
  const bb = md.SA.bbox, g = Number.isFinite(maxDist) ? maxDist : 0;
  const box = Number.isFinite(maxDist) ? [bb[0] - g, bb[1] - g, bb[2] - g, bb[3] + g, bb[4] + g, bb[5] + g] : null;
  let done = 0, t0 = performance.now();
  for await (const ch of layerPositions(L, box)) {
    for (let i = 0; i < ch.count; i++) {
      const x = ch.x[i], y = ch.y[i], z = ch.z[i];
      if (box && (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5])) continue;   // farther than maxDist from the mesh's box
      const r = ch.recs ? ch.recs[i] : ch.base + i;
      if (r < n) dist[r] = md.at(x, y, z, maxDist);
      if ((i & 0x1fff) === 0x1fff && performance.now() - t0 > 40) {
        checkAbort(signal); if (onProgress) onProgress(done + i, n);
        await new Promise((z2) => setTimeout(z2)); t0 = performance.now();
      }
    }
    done += ch.count;
    checkAbort(signal); if (onProgress) onProgress(Math.min(done, n), n);
    await new Promise((z2) => setTimeout(z2));
  }
  return dist;
}

// one expression's value for every record → Float32Array (NaN = blank). Block models read through
// the columnar engine (only the columns the expression needs, on the worker pool); the rest the row path.
export async function recordValues(L, expr, { bool = false, signal = null, onProgress = null } = {}) {
  const n = attrRowCountOf(L) || 0, out = new Float32Array(n).fill(NaN);
  const h = layerTableHeader(L), schema = schemaExt(L, h);
  if (canScanColumnar(L)) {
    const m = h.mapping, coords = [h.columns[m.x], h.columns[m.y], h.columns[m.z]];
    await scanColumnar(L, { kernel: 'values', params: { expr, blank: NaN, coords }, exprs: [expr], extraCols: coords, signal,
      onProgress: (d, N, w) => { if (onProgress) onProgress(d, N, w); },
      onPart: (gi, part, start) => { const v = part.v; for (let i = 0; i < v.length && start + i < n; i++) out[start + i] = v[i]; } });
    return out;
  }
  const fn = bool ? compileBool(expr, schema, { decimal: '.' }) : compileValue(expr, schema, { decimal: '.' });
  let k = 0;
  for await (const { f, rec } of layerRecords(L)) {
    if (rec < n) { let x; try { x = bool ? (fn(f) ? 1 : 0) : numOf(fn(f)); } catch { x = NaN; } out[rec] = x; }
    if (((++k) & 0xffff) === 0) { checkAbort(signal); if (onProgress) onProgress(k, n); await new Promise((z) => setTimeout(z)); }
  }
  return out;
}

// a bare column name the layer lacks is refused loudly (an unknown name compiles to a blank closure,
// and the curve would come back empty for no stated reason); an expression stays free-form
function needColumn(L, col, what) {
  const c = String(col == null ? '' : col).trim();
  if (!c) throw new Error(`${what}: required`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)) return c;
  const v = validate(c, schemaExt(L, layerTableHeader(L)));
  if (!v.ok) throw new Error(`${what} “${c}”: not a column of ${L.label || L.name}`);
  return c;
}
// materialized inputs resident before a row-path read (an evicted column reads blank otherwise)
async function residentFor(L, exprs) {
  const need = new Set();
  for (const x of exprs) { if (!x || !String(x).trim()) continue; try { for (const d of exprDeps(String(x))) need.add(String(d).toLowerCase()); } catch { /* the compile step names a bad expression */ } }
  if (need.size) await ensureStoredValues(L, need);
}
const serName = (se, multi) => (multi ? `${(se.L.label || se.L.name).replace(/\.[^.]*$/, '')}·${se.s.col}` : se.s.col);

// ── the scan ─────────────────────────────────────────────────────────────────
// st: { mode: 'downhole' | 'surface', series: [{ layerId, col, weight, filter }], binWidth, maxDist,
//   scope, — downhole: domain, domA, domB, direction, minRun, maxGap — surface: surfaceId }
// → { mode, bw, maxDist, sideNames, series: [{ s, L, bins, kind: 'length' | 'volume', weighted, … }], where }
export async function scanContact(st, onProgress, signal) {
  const bw = +st.binWidth, maxDist = +st.maxDist;
  if (!(bw > 0)) throw new Error('bin width: a positive number of metres');
  if (!(maxDist > 0)) throw new Error('max distance: a positive number of metres');
  if (maxDist / bw > 2000) throw new Error(`max distance / bin width = ${Math.round(maxDist / bw)} bins a side — widen the bins`);
  const series = st.series.map((s) => ({ s, L: layerById(s.layerId) })).filter((x) => x.L);
  if (!series.length) throw new Error('no series — add one');
  const out = { mode: st.mode, bw, maxDist, series: [], where: '' };
  if (st.mode === 'downhole') {
    const domA = String(st.domA || '').trim(); if (!domA) throw new Error('domain A: pick the domain whose contacts you are testing');
    out.sideNames = [domA, String(st.domB || '').trim() || 'other'];
    for (const [k, { s, L }] of series.entries()) {
      if (!isDhLayer(L)) throw new Error(`series “${L.label || L.name}”: a down-hole contact plot reads a drillhole layer (for a block model use “to a surface”)`);
      const h = layerTableHeader(L), schema = schemaExt(L, h), im = L.docs.dhDoc.header.intervalMapping || {};
      if (!(im.bhid >= 0 && im.from >= 0 && im.to >= 0)) throw new Error(`${L.label || L.name}: no hole / FROM / TO columns`);
      const dcol = needColumn(L, st.domain, 'domain column'), vcol = needColumn(L, s.col, 'series column');
      const domFn = compileValue(quoteIdent(dcol), schema, { decimal: '.' }), valFn = compileValue(quoteIdent(vcol), schema, { decimal: '.' });
      let wFn = null, fFn = null;
      if (s.weight && String(s.weight).trim()) { try { wFn = compileValue(s.weight, schema, { decimal: '.' }); } catch { throw new Error(`series weight “${s.weight}”: invalid`); } }
      if (s.filter && String(s.filter).trim()) { try { fFn = compileBool(s.filter, schema, { decimal: '.' }); } catch { throw new Error(`series filter “${s.filter}”: invalid`); } }
      await residentFor(L, [quoteIdent(dcol), quoteIdent(vcol), s.weight, s.filter]);
      const mask = scopeMask(st, L), ivs = [];
      for await (const { f, rec } of layerRecords(L)) {
        const keep = (!mask || (rec < mask.length && mask[rec])) && (!fFn || !!fFn(f));
        const dv = domFn(f);
        ivs.push({ hole: f[im.bhid], from: numOf(f[im.from]), to: numOf(f[im.to]), dom: dv == null ? '' : String(dv), v: numOf(valFn(f)), w: wFn ? numOf(wFn(f)) : 1, keep });
      }
      checkAbort(signal);
      if (onProgress) onProgress(k + 1, series.length, 'down the holes');
      const r = downholeContacts(ivs, { domA, domB: st.domB, direction: st.direction || 'both', minRun: +st.minRun || 0, maxGap: st.maxGap != null && st.maxGap !== '' ? +st.maxGap : bw, binWidth: bw, maxDist });
      out.series.push({ s, L, bins: r.bins, kind: 'length', weighted: !!wFn, contacts: r.contacts, holes: r.holes, skipped: r.skipped, intervals: ivs.length });
    }
    out.where = 'down the holes';
    return out;
  }
  // ── to a surface ──
  const meshL = layerById(st.surfaceId);
  if (!meshL) throw new Error('pick the surface or solid to measure against');
  const md = await meshDistanceOf(meshL);
  out.sideNames = md.sideNames; out.surface = { name: meshL.name, label: md.label, closed: md.closed };
  if (!st._distCache || st._distMd !== md) { st._distCache = new Map(); st._distMd = md; }   // a reloaded mesh measures afresh
  for (const [k, { s, L }] of series.entries()) {
    const n = attrRowCountOf(L) || 0;
    const prog = (frac, what) => { if (onProgress) onProgress(Math.round((k + Math.min(1, frac)) * 1000), series.length * 1000, `${L.label || L.name} · ${what}`); };
    const dkey = `${L.id}|${meshL.id}|${maxDist}|${n}`;
    let dist = st._distCache.get(dkey);
    if (!dist) {
      dist = await layerSignedDistances(L, md, { maxDist, signal, onProgress: (d, N) => prog(0.6 * d / (N || 1), 'distances') });
      st._distCache.set(dkey, dist);
    }
    const h = layerTableHeader(L), mask = scopeMask(st, L);
    const vcol = needColumn(L, s.col, 'series column');
    if (s.weight && String(s.weight).trim()) { try { compileValue(s.weight, schemaExt(L, h), { decimal: '.' }); } catch { throw new Error(`series weight “${s.weight}”: invalid`); } }
    if (s.filter && String(s.filter).trim()) { try { compileBool(s.filter, schemaExt(L, h), { decimal: '.' }); } catch { throw new Error(`series filter “${s.filter}”: invalid`); } }
    const bins = new Map();
    let counted = 0;
    if (isDhLayer(L)) {                                    // samples: interval midpoints, weighed by their length
      const schema = schemaExt(L, h), im = L.docs.dhDoc.header.intervalMapping || {};
      const valFn = compileValue(quoteIdent(vcol), schema, { decimal: '.' });
      const wFn = s.weight && String(s.weight).trim() ? compileValue(s.weight, schema, { decimal: '.' }) : null;
      const fFn = s.filter && String(s.filter).trim() ? compileBool(s.filter, schema, { decimal: '.' }) : null;
      await residentFor(L, [quoteIdent(vcol), s.weight, s.filter]);
      for await (const { f, rec } of layerRecords(L)) {
        const d = rec < dist.length ? dist[rec] : NaN;
        if (!Number.isFinite(d) || (mask && !(rec < mask.length && mask[rec])) || (fFn && !fFn(f))) continue;
        const len = numOf(f[im.to]) - numOf(f[im.from]); if (!(len > 0)) continue;
        const w = wFn ? numOf(wFn(f)) : 1;
        if (binRecord(bins, d, bw, maxDist, numOf(valFn(f)), len * w, len)) counted++;
      }
      out.series.push({ s, L, bins, kind: 'length', weighted: !!wFn, counted, records: n });
    } else {                                               // blocks: centroids, weighed by their volume
      if (!isBlockLayer(L)) throw new Error(`series “${L.label || L.name}”: a block model (regular) or a drillhole layer`);
      const vc = volumeContextOf(L);
      const dimExpr = vc.dc ? `abs(${quoteIdent(h.columns[vc.dc.x])} * ${quoteIdent(h.columns[vc.dc.y])} * ${quoteIdent(h.columns[vc.dc.z])})` : null;
      const any = (dd) => { for (let i = 0; i < dd.length; i++) if (Number.isFinite(dd[i])) return true; return false; };
      if (any(dist)) {                                     // nothing within reach → no value scans at all
        const V = await recordValues(L, quoteIdent(vcol), { signal, onProgress: (d, N) => prog(0.6 + 0.15 * d / (N || 1), 'values') });
        const W = s.weight && String(s.weight).trim() ? await recordValues(L, `(${s.weight})`, { signal, onProgress: (d, N) => prog(0.75 + 0.1 * d / (N || 1), 'weights') }) : null;
        const F = s.filter && String(s.filter).trim() ? await recordValues(L, `(${s.filter})`, { bool: true, signal, onProgress: (d, N) => prog(0.85 + 0.05 * d / (N || 1), 'filter') }) : null;
        const D = dimExpr ? await recordValues(L, dimExpr, { signal, onProgress: (d, N) => prog(0.9 + 0.1 * d / (N || 1), 'block sizes') }) : null;
        const base = blockVolumeOf(L);
        for (let i = 0; i < n; i++) {
          const d = dist[i]; if (!Number.isFinite(d)) continue;
          if (mask && !(i < mask.length && mask[i])) continue;
          if (F && F[i] !== 1) continue;
          const vol = D && D[i] > 0 ? D[i] : base, w = W ? W[i] : 1;
          if (binRecord(bins, d, bw, maxDist, V[i], vol * w, vol)) counted++;
        }
      }
      out.series.push({ s, L, bins, kind: 'volume', weighted: !!(s.weight && String(s.weight).trim()), counted, records: n });
    }
    prog(1, 'done');
  }
  out.where = `to ${md.label}`;
  return out;
}

// ── the shapes: table rows, values, the chart ────────────────────────────────
export const contactAmountCol = (scan) => (scan.mode === 'downhole' ? 'metres' : 'weight');
export function contactRows(scan) {
  const multi = scan.series.length > 1, rows = [];
  for (const se of scan.series) for (const r of contactBinRows(se.bins, scan.bw, scan.sideNames)) {
    rows.push({ series: serName(se, multi), side: r.side, center: +r.center.toPrecision(12), mean: r.mean, amount: scan.mode === 'downhole' ? (se.weighted ? r.weight : r.support) : r.weight, support: r.support, count: r.count });
  }
  return rows;
}
// values for checks: the first series' numbers bare (step, ratio, mean_inside, …), every later
// series' with a _2, _3 suffix, and step_ratio_k = series k's step / the first's (a model that keeps
// 30 % of the samples' step has smeared the contact)
export function contactValuesOf(scan, near = 1) {
  const out = {};
  scan.series.forEach((se, i) => {
    const v = contactValues(se.bins, scan.bw, near), sfx = i ? `_${i + 1}` : '';
    for (const [k, x] of Object.entries(v)) out[k + sfx] = x;
    if (i) out[`step_ratio${sfx}`] = out.step !== 0 ? v.step / out.step : NaN;
  });
  if (scan.mode === 'downhole') { out.contacts = scan.series[0] ? scan.series[0].contacts : 0; out.holes = scan.series[0] ? scan.series[0].holes : 0; }
  return out;
}
export function contactChartSpec(scan, { ranges = null } = {}) {
  const multi = scan.series.length > 1, bw = scan.bw;
  const xl = scan.mode === 'downhole' ? `distance from the contact (m) · ← ${scan.sideNames[0]} | ${scan.sideNames[1]} →` : `signed distance to ${scan.surface ? scan.surface.label : 'the surface'} (m) · ← ${scan.sideNames[0]} | ${scan.sideNames[1]} →`;
  const s0 = scan.series[0];
  const amount = s0 ? (s0.kind === 'length' ? (s0.weighted ? 'metres × weight' : 'metres') : (s0.weighted ? 'volume × weight' : 'volume (m³)')) : 'amount';
  const spec = { xLabel: xl, leftLabel: 'mean', rightLabel: amount, series: [], ...rangesOf({ ranges }) };
  if (s0) spec.series.push({ name: amount, color: '#6a6f75', axis: 'right', kind: 'bar', data: contactBinRows(s0.bins, bw, scan.sideNames).map((r) => [r.center, s0.weighted ? r.weight : r.support]) });
  let lo = Infinity, hi = -Infinity;
  scan.series.forEach((se, i) => {
    const data = contactBinRows(se.bins, bw, scan.sideNames).map((r) => [r.center, r.mean]);
    for (const [, y] of data) if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
    spec.series.push({ name: serName(se, multi), color: se.s.color || SERIES_COLORS[i % SERIES_COLORS.length], axis: 'left', kind: 'line', data });
  });
  if (lo < hi) spec.series.push({ name: 'contact', color: '#9aa0a6', axis: 'left', kind: 'line', data: [[0, Math.min(0, lo)], [0, hi]] });
  return spec;
}
export function contactHumanTSV(scan) {
  const rows = contactRows(scan); if (!rows.length) return null;
  const amt = contactAmountCol(scan);
  return [['series', 'side', 'center (m)', 'mean', amt, 'count'].join('\t'), ...rows.map((r) => [r.series, r.side, r.center, Number.isFinite(r.mean) ? r.mean : '', r.amount, r.count].join('\t'))].join('\n');
}

// ── ⇥ column: the signed distance as a stored column on a layer ──────────────
export async function writeDistanceColumn(L, meshL, name, { onProgress = null, signal = null } = {}) {
  const md = await meshDistanceOf(meshL);
  const dist = await layerSignedDistances(L, md, { maxDist: Infinity, onProgress, signal });
  matColSet(L, name, dist, { lineage: mkLineage('distance', { to: meshL.name, closed: md.closed, sign: `${md.sideNames[0]} negative` }, [meshL.lineage, L.lineage].filter(Boolean)) });
  try { await persistElement(L); } catch { /* best-effort */ }
  markProjectDirty(); requestRender();
  return { name, records: dist.length };
}
export const distColName = (meshL) => `DIST_${String(meshL.label || meshL.name).replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SURFACE'}`;

// ── the window ───────────────────────────────────────────────────────────────
export const _contactWins = new Map();

export function openContact(L, ropts) {
  if (!L || !(isDhLayer(L) || isBlockLayer(L))) { $('#meta').textContent = 'contact analysis: a drillhole layer (down-hole) or a block model (to a surface)'; return null; }
  const ex = _contactWins.get(L.id);
  if (ex) { if (!ropts || (!ropts.cfg && !ropts.run && (!ropts.mode || ropts.mode === ex.st.mode))) { focusWindow(ex.win.el); return ex; } ex.win.close(); }
  const nums = numericColsOf(L); if (!nums.length) { $('#meta').textContent = 'contact analysis: no numeric column'; return null; }
  const mkSer = (Lx, col, i) => ({ layerId: Lx.id, col, unit: '', weight: '', filter: '', color: SERIES_COLORS[i % SERIES_COLORS.length] });
  const surfs = contactSurfaces();
  const st = { mode: isDhLayer(L) && !(ropts && ropts.mode === 'surface') ? 'downhole' : 'surface', domain: '', domA: '', domB: '', direction: 'both', minRun: 0, maxGap: null,
    surfaceId: surfs.length ? surfs[surfs.length - 1].id : null, binWidth: isDhLayer(L) ? 2 : 5, maxDist: isDhLayer(L) ? 20 : 50, near: 1, scope: 'all',
    series: [mkSer(L, nums[0], 0)], scan: null, stale: true, running: false, _domVals: [] };
  if (isDhLayer(L)) { const cats = categoryColsOf(L); st.domain = cats.find((c) => /^(lito|lith|litho|domain|dom|rock|geol)/i.test(c)) || cats[0] || ''; }
  const saved = (ropts && ropts.cfg) || (L.analysis && L.analysis.contact);
  if (saved) {
    for (const k of ['mode', 'domain', 'domA', 'domB', 'direction', 'minRun', 'maxGap', 'binWidth', 'maxDist', 'near', 'scope']) if (saved[k] != null) st[k] = saved[k];
    if (saved.surface) { const m = surfs.find((x) => x.name === saved.surface || (x.label || x.name) === saved.surface); if (m) st.surfaceId = m.id; }
    if (saved.ranges) st.ranges = rangesFromCfg(saved.ranges);
    const ser = analysisSerRestore(saved.series, L); if (ser) { st.series = ser; if (ser.dropped.length) st.droppedNote = `left out (layer not loaded): ${ser.dropped.join(', ')}`; }
  }
  if (ropts && ropts.mode) st.mode = ropts.mode;
  if (st.mode === 'downhole') {                            // a down-hole plot reads drillhole layers only
    st.series = st.series.filter((s) => isDhLayer(layerById(s.layerId)));
    if (!st.series.length) st.series = [mkSer(L, nums[0], 0)];
  }
  const surfName = () => { const m = layerById(st.surfaceId); return m ? m.name : null; };
  const cfgOf = () => ({ mode: st.mode, series: analysisSerCfg(st.series), ...(st.mode === 'downhole' ? { domain: st.domain, domA: st.domA, domB: st.domB, direction: st.direction, minRun: +st.minRun || 0, ...(st.maxGap != null && st.maxGap !== '' ? { maxGap: +st.maxGap } : {}) } : { surface: surfName() }),
    binWidth: +st.binWidth, maxDist: +st.maxDist, near: +st.near || 1, scope: st.scope, ranges: rangesForCfg(st.ranges) });
  const win = floatWin({ title: `contact · ${L.label || L.name}`, sub: saved ? 'restored — Run to compute' : 'configure, then Run', x: Math.max(12, innerWidth - 700), y: 110, w: 680, h: 460,
    onClose: () => { saveAnalysisCfg(L, 'contact', cfgOf(), win); setAnalysisOpen(L, 'contact', false); _contactWins.delete(L.id); } });
  setAnalysisOpen(L, 'contact', true);
  if (st.droppedNote) win.sub.textContent = st.droppedNote;
  applyAnalysisGeo(L, 'contact', win);
  const body = document.createElement('div'); body.className = 'sw-body'; win.body.append(body);
  const rail = document.createElement('div'); rail.className = 'sw-rail';
  const main = document.createElement('div'); main.className = 'sw-main';
  const cv = document.createElement('canvas'); cv.style.cssText = 'width:100%;flex:1;min-height:80px;display:block';
  const readout = document.createElement('div'); readout.className = 'val-readout ct-readout';
  main.append(cv, readout); body.append(rail, main);
  let staleEl, progEl, runBtn;
  const markStale = () => { st.stale = true; if (staleEl) staleEl.textContent = st.scan ? '↻ config changed — Run to update' : ''; };
  const plot = () => {
    if (!st.scan) { plotChart(cv, { series: [] }); win._spec = null; readout.textContent = ''; return; }
    const spec = contactChartSpec(st.scan, { ranges: st.ranges });
    plotChart(cv, spec); win._spec = spec; win.el._contactSpec = spec;
    readout.textContent = '';
    const add = (k, v, cls) => { const s = document.createElement('span'); s.className = 'val-stat' + (cls ? ' ' + cls : ''); const b = document.createElement('b'); b.textContent = k; s.append(b, document.createTextNode(' ' + v)); readout.appendChild(s); };
    const multi = st.scan.series.length > 1;
    st.scan.series.forEach((se, i) => {
      const v = contactValues(se.bins, st.scan.bw, +st.near || 1);
      add(multi ? serName(se, true) : se.s.col, `${fmtStat(v.mean_inside)} | ${fmtStat(v.mean_outside)}`);
      const pct = i ? 100 * v.step / contactValues(st.scan.series[0].bins, st.scan.bw, +st.near || 1).step : NaN;
      add('step', `${v.step >= 0 ? '+' : ''}${fmtStat(v.step)}${Number.isFinite(pct) ? ` (${Math.round(pct)}% of the first)` : ''}`);
    });
    const s0 = st.scan.series[0];
    const what = st.scan.mode === 'downhole' ? `${s0 ? s0.contacts : 0} contacts in ${s0 ? s0.holes : 0} holes${s0 && (s0.skipped.short || s0.skipped.gap) ? ` (skipped: ${s0.skipped.short} slivers, ${s0.skipped.gap} across a gap)` : ''}`
      : `${st.scan.series.map((se) => `${se.counted.toLocaleString()} ${se.kind === 'length' ? 'intervals' : 'blocks'}`).join(' · ')} within ${fmtStat(st.scan.maxDist)} m of ${st.scan.surface.label} (${st.scan.surface.closed ? 'closed: − inside' : 'open: − ' + st.scan.sideNames[0]})`;
    win.sub.textContent = `${st.scope !== 'all' ? st.scope + ' · ' : ''}${what} · bins ${fmtStat(st.scan.bw)} m`;
  };
  win.el._onResized = () => { if (win._spec) plotChart(cv, win._spec); };
  const run = async () => {
    if (st.running) return;
    if (st.scope !== 'all' && !st.series.some((s) => { const Lx = layerById(s.layerId); return Lx && scopeMask(st, Lx); })) { win.el._runFailed = win.sub.textContent = scopeMissing(st, L) || `no layer carries a ${st.scope} mask`; return; }
    st.running = true; win.sub.textContent = 'scanning…'; win.el._runFailed = null;
    const rc = runCancellable(runBtn);
    try { st.scan = await scanContact(st, (n, N, w) => { progEl.textContent = st.mode === 'downhole' ? (w || '') : scanProgressText(n, N, w).replace(/^[\d,.]+ of [\d,.]+ rows · /, ''); }, rc.signal); }
    catch (e) { win.el._runFailed = e.name === 'AbortError' ? 'cancelled' : e.message; win.sub.textContent = e.name === 'AbortError' ? (st.scan ? 'cancelled — showing the previous result' : 'cancelled') : `contact: ${e.message}`; st.running = false; rc.done(); progEl.textContent = ''; return; }
    st.running = false; rc.done(); progEl.textContent = ''; st.stale = false; if (staleEl) staleEl.textContent = '';
    win.el._scanWhere = st.scan.where;
    saveAnalysisCfg(L, 'contact', cfgOf(), win);
    plot();
  };
  const loadDomains = async () => {
    const Lx = layerById(st.series[0] && st.series[0].layerId) || L;
    st._domVals = st.domain && isDhLayer(Lx) ? await distinctValues(Lx, st.domain) : [];
    if (!st.domA || !st._domVals.includes(st.domA)) st.domA = st._domVals.find((v) => /ore|itab|hem|min|mz/i.test(v)) || st._domVals[0] || st.domA;
    buildRail();
  };
  const sel = (opts, val, onch, title) => {
    const s = document.createElement('select'); s.className = 'sw-sel'; s.style.width = '100%'; if (title) s.title = title;
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; s.append(o); }
    s.value = val == null ? '' : String(val); s.onchange = () => onch(s.value); return s;
  };
  const numRow = (label, val, onch, title, ph) => {
    const r = document.createElement('div'); r.className = 'sw-row';
    const l = document.createElement('span'); l.textContent = label; l.style.width = '64px';
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.className = 'sw-in'; inp.value = val == null ? '' : String(val); if (ph) inp.placeholder = ph; if (title) inp.title = title;
    inp.onchange = () => onch(inp.value); r.append(l, inp); return r;
  };
  const head = (t) => Object.assign(document.createElement('div'), { className: 'sw-h', textContent: t });
  const seriesRow = (s, i) => {
    const box = document.createElement('div'); box.className = 'sw-ser';
    const top = document.createElement('div'); top.className = 'sw-ser-top';
    const dot = document.createElement('span'); dot.className = 'sw-dot'; dot.style.background = s.color; dot.title = 'cycle colour';
    dot.onclick = () => { s.color = SERIES_COLORS[(SERIES_COLORS.indexOf(s.color) + 1) % SERIES_COLORS.length]; dot.style.background = s.color; if (st.scan) { st.scan.series.forEach((se) => { if (se.s === s) se.s.color = s.color; }); plot(); } };
    const pool = S.layers.filter((x) => numericColsOf(x).length && (st.mode === 'downhole' ? isDhLayer(x) : (isDhLayer(x) || isBlockLayer(x))));
    const laySel = document.createElement('select'); laySel.className = 'sw-sel';
    for (const Lx of pool) { const o = document.createElement('option'); o.value = Lx.id; o.textContent = Lx.label || Lx.name; if (Lx.id === s.layerId) o.selected = true; laySel.append(o); }
    laySel.onchange = () => { s.layerId = +laySel.value; const cols = numericColsOf(layerById(s.layerId)); if (!cols.includes(s.col)) s.col = cols.find((c) => c === s.col) || cols[0] || s.col; markStale(); if (i === 0 && st.mode === 'downhole') loadDomains(); else buildRail(); };
    const x = document.createElement('button'); x.className = 'sw-x'; x.textContent = '×'; x.title = 'remove series'; x.onclick = () => { if (st.series.length > 1) { st.series.splice(i, 1); markStale(); buildRail(); } };
    top.append(dot, laySel, x); box.append(top);
    const colSel = document.createElement('select'); colSel.className = 'sw-sel'; colSel.style.width = '100%';
    for (const c of numericColsOf(layerById(s.layerId) || L)) { const o = document.createElement('option'); o.value = c; o.textContent = c; if (c === s.col) o.selected = true; colSel.append(o); }
    colSel.onchange = () => { s.col = colSel.value; markStale(); }; box.append(colSel);
    const wIn = document.createElement('input'); wIn.className = 'sw-in'; wIn.type = 'text'; wIn.placeholder = 'weight expr (blank = length / volume)'; wIn.value = s.weight || ''; wIn.title = 'multiplies each record’s support (an interval’s length, a block’s volume) — e.g. SG for tonnage weighting'; wIn.onchange = () => { s.weight = wIn.value.trim(); markStale(); }; box.append(wIn);
    const fIn = document.createElement('input'); fIn.className = 'sw-in'; fIn.type = 'text'; fIn.placeholder = 'filter (optional)'; fIn.value = s.filter || ''; fIn.title = st.mode === 'downhole' ? 'which intervals count for the VALUE — the domains and contacts come from every interval' : 'a row filter for this series (@gcu/expr)'; fIn.onchange = () => { s.filter = fIn.value.trim(); markStale(); }; box.append(fIn);
    return box;
  };
  function buildRail() {
    rail.textContent = '';
    // ── flavour ──
    const fSec = document.createElement('div'); fSec.append(head('contact'));
    const seg = document.createElement('div'); seg.className = 'sw-seg';
    for (const [v, t, tip] of [['downhole', 'down-hole', 'every A→B transition along each hole (a drillhole layer with a domain column)'], ['surface', 'to a surface', 'signed distance of every record to a wireframe — samples and blocks overlay']]) {
      const bt = document.createElement('button'); bt.className = 'sw-segbtn' + (st.mode === v ? ' on' : ''); bt.textContent = t; bt.title = tip;
      bt.onclick = () => {
        if (st.mode === v) return;
        st.mode = v; st.scan = null; markStale();
        if (v === 'downhole') { st.series = st.series.filter((s) => isDhLayer(layerById(s.layerId))); if (!st.series.length) { const D = S.layers.find(isDhLayer); if (D) st.series = [mkSer(D, numericColsOf(D)[0], 0)]; } if (st.binWidth > 10) { st.binWidth = 2; st.maxDist = 20; } loadDomains(); }
        else buildRail();
        plot();
      };
      seg.append(bt);
    }
    fSec.append(seg); rail.append(fSec);
    if (st.mode === 'downhole') {
      const dSec = document.createElement('div'); dSec.append(head('domains'));
      const L0 = layerById(st.series[0] && st.series[0].layerId) || L;
      const cats = isDhLayer(L0) ? categoryColsOf(L0) : [];
      dSec.append(sel(cats.map((c) => [c, `column: ${c}`]), st.domain, (v) => { st.domain = v; st.domA = ''; st.domB = ''; markStale(); loadDomains(); }, 'the domain column (text) on the drillhole layer'));
      const vals = st._domVals || [];
      dSec.append(sel(vals.map((v) => [v, `A: ${v}`]), st.domA, (v) => { st.domA = v; if (st.domB === v) st.domB = ''; markStale(); buildRail(); }, 'domain A — plotted on the NEGATIVE side'));
      dSec.append(sel([['', 'B: any other'], ...vals.filter((v) => v !== st.domA).map((v) => [v, `B: ${v}`])], st.domB, (v) => { st.domB = v; markStale(); }, 'domain B — the positive side; “any other” pools every domain next to A'));
      dSec.append(sel([['both', 'both directions (pooled)'], ['AtoB', 'A above B (down the hole)'], ['BtoA', 'A below B']], st.direction, (v) => { st.direction = v; markStale(); }, 'which transitions count'));
      dSec.append(numRow('min run', st.minRun || '', (v) => { st.minRun = +v || 0; markStale(); }, 'each side’s run must be at least this long (m) — skips slivers', '0'));
      dSec.append(numRow('max gap', st.maxGap ?? '', (v) => { st.maxGap = v === '' ? null : +v; markStale(); }, 'the widest unsampled gap a contact may bridge (m) — blank = the bin width', 'bin width'));
      rail.append(dSec);
    } else {
      const sSec = document.createElement('div'); sSec.append(head('surface / solid'));
      const ss = contactSurfaces();
      if (!ss.length) sSec.append(Object.assign(document.createElement('div'), { className: 'sw-stale', textContent: 'open a wireframe (a mesh layer) first' }));
      else sSec.append(sel(ss.map((m) => [m.id, m.label || m.name]), st.surfaceId, (v) => { st.surfaceId = +v; markStale(); buildRail(); }, 'a closed solid: negative inside (winding number) · an open surface: negative below'));
      const m = layerById(st.surfaceId);
      if (m && m._solidMesh) sSec.append(Object.assign(document.createElement('div'), { className: 'sw-stale', textContent: m._solidMesh.closed ? 'closed — negative inside' : 'open — negative below / behind its normals' }));
      rail.append(sSec);
    }
    // ── bins ──
    const bSec = document.createElement('div'); bSec.append(head('bins'));
    bSec.append(numRow('width', st.binWidth, (v) => { st.binWidth = +v || st.binWidth; markStale(); }, 'bin width (m)'));
    bSec.append(numRow('max dist', st.maxDist, (v) => { st.maxDist = +v || st.maxDist; markStale(); }, 'how far from the contact, each side (m)'));
    bSec.append(numRow('near bins', st.near, (v) => { st.near = Math.max(1, Math.round(+v) || 1); if (st.scan) plot(); }, 'how many bins each side make “just inside / just outside” for the step and ratio'));
    rail.append(bSec);
    // ── series ──
    const serSec = document.createElement('div'); serSec.append(head('series'));
    const list = document.createElement('div'); list.className = 'sw-series';
    st.series.forEach((s, i) => list.append(seriesRow(s, i))); serSec.append(list);
    const add = document.createElement('button'); add.className = 'sw-add'; add.textContent = '+ add series';
    add.title = st.mode === 'surface' ? 'overlay another layer — e.g. the model against its samples' : 'another value, or another drillhole layer';
    add.onclick = () => {
      const pool = S.layers.filter((x) => numericColsOf(x).length && (st.mode === 'downhole' ? isDhLayer(x) : (isDhLayer(x) || isBlockLayer(x))));
      const used = new Set(st.series.map((s) => s.layerId)), Lx = pool.find((x) => !used.has(x.id)) || layerById(st.series[0].layerId) || L;
      const prev = st.series[st.series.length - 1], cols = numericColsOf(Lx);
      st.series.push(mkSer(Lx, cols.includes(prev.col) ? prev.col : cols[0], st.series.length)); markStale(); buildRail();
    };
    serSec.append(add); rail.append(serSec);
    // ── display ──
    const vSec = document.createElement('div'); vSec.append(head('display'));
    const scRow = document.createElement('div'); scRow.className = 'sw-row'; const scL = document.createElement('span'); scL.textContent = 'scope';
    const sg = document.createElement('div'); sg.className = 'sw-seg'; sg.title = 'all rows · rows matching each layer’s current filter · the 3D selection';
    for (const [v, t] of [['all', 'all'], ['filtered', 'filt'], ['selection', 'sel']]) { const bt = document.createElement('button'); bt.className = 'sw-segbtn' + (st.scope === v ? ' on' : ''); bt.textContent = t; bt.onclick = () => { st.scope = v; markStale(); buildRail(); }; sg.append(bt); }
    scRow.append(scL, sg); vSec.append(scRow);
    vSec.append(rangesRow(st, () => { if (st.scan) plot(); }, { x: 'x', l: 'mean', r: 'bars' }));
    rail.append(vSec);
    // ── footer ──
    const foot = document.createElement('div'); foot.className = 'sw-foot';
    runBtn = document.createElement('button'); runBtn.className = 'sw-run'; runBtn.textContent = 'Run'; runBtn.onclick = run;
    const rcpBtn = document.createElement('button'); rcpBtn.className = 'sw-add rcp'; rcpBtn.textContent = 'save as recipe…'; rcpBtn.title = 'save this setup as a named, re-runnable YAML file in the project (Tools → Recipes)';
    const rname = () => `${(L.label || L.name).replace(/\.[^.]+$/, '')} contact`;
    rcpBtn.onclick = () => saveRecipe('contact', cfgOf(), rname());
    win.el._recipe = () => ({ tool: 'contact', name: rname(), params: cfgOf() });
    const resRow = plotExportBtns(cv, () => `contact-${(L.label || L.name).replace(/\.[^.]+$/, '')}${st.mode === 'downhole' ? `-${st.domA || 'A'}-${st.domB || 'other'}` : `-${(layerById(st.surfaceId) || {}).label || 'surface'}`}.png`.replace(/[^\w.-]+/g, '_'), () => (st.scan ? contactHumanTSV(st.scan) : null), 'contacts');
    foot.append(runBtn, rcpBtn, resRow);
    if (st.mode === 'surface') {
      const colBtn = document.createElement('button'); colBtn.className = 'awin-btn'; colBtn.textContent = '⇥ column';
      colBtn.title = 'write each series layer’s SIGNED distance to the surface as a stored column (negative inside / below) — filter it: abs(DIST_…) < 10';
      colBtn.onclick = async () => {
        const meshL = layerById(st.surfaceId); if (!meshL) { win.sub.textContent = 'pick a surface first'; return; }
        const name = await microPrompt('Distance column name', distColName(meshL)); if (!name) return;
        const Ls = [...new Set(st.series.map((s) => s.layerId))].map(layerById).filter(Boolean);
        try {
          for (const Lx of Ls) { win.sub.textContent = `distances → ${Lx.label || Lx.name}…`; await writeDistanceColumn(Lx, meshL, name.trim(), { onProgress: (d, N) => { progEl.textContent = `${Math.floor(100 * d / (N || 1))}%`; } }); }
          progEl.textContent = '';
          win.sub.textContent = $('#meta').textContent = `“${name.trim()}” written on ${Ls.map((x) => x.label || x.name).join(', ')} — signed distance to ${meshL.label || meshL.name}, negative ${(meshL._contactDist || {}).sideNames ? meshL._contactDist.sideNames[0] : 'inside'}`;
        } catch (e) { win.sub.textContent = `⇥ column: ${e.message}`; }
      };
      resRow.append(colBtn);
    }
    staleEl = document.createElement('div'); staleEl.className = 'sw-stale'; staleEl.textContent = st.scan && st.stale ? '↻ config changed — Run to update' : '';
    progEl = document.createElement('div'); progEl.className = 'sw-prog';
    foot.append(staleEl, progEl); rail.append(foot);
  }
  const handle = { win, redraw: run, st, run };
  _contactWins.set(L.id, handle);
  buildRail(); plot();
  const ready = st.mode === 'downhole' ? loadDomains() : Promise.resolve();
  if (ropts && ropts.run) ready.then(run);
  return handle;
}
