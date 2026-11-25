// micro POLYGON LIMITS — "only what is inside these polygons, in plan" as ONE option every analysis
// shares. A limit names a polygon layer and, optionally, which of its features:
//
//   limit: { layer: "pit_limit.shp",       the strings & polygons layer (by name or label)
//            feature: "B12",               one feature — its id, or the value of any of its attributes
//            where: "BENCH == 850",        the features an expression over the polygon attributes keeps
//            selected: true }              only the features selected in 3D (not in a routine: a
//                                          selection isn't saved with it)
//
// What counts as inside, by what the analysis reads:
//   - a record (a block, a point, a drillhole interval, a mesh vertex) is inside when its PLAN x/y is:
//     a block by its CENTROID — a block the boundary cuts counts whole or not at all. For the exact
//     share of a cut block, extrude the polygon (Tools → Extrude polygons) and take the fraction
//     inside the solid (exact for a vertical prism: the plan area clipped per block × the z overlap).
//   - a grid node (cut / fill, the point-cloud DEM) by the share of its CELL the polygons cover, the
//     cell clipped to the polygons exactly (src/coverage.js) — so a volume is exact at the edges.
//
// The record mask is computed once per (layer, limit, polygon geometry) by one pass over the
// layer's positions (the columnar workers for Parquet / CSV) and cached; an edit of the polygons
// changes the geometry key and the next run recomputes. Analyses AND it with their scope (all /
// filtered / selection): scopeMask (src/analysis-ui.js) reads the cached mask, so every scan path
// that already takes a mask takes the limit without a second code path. Runs call prepareScope
// first (the async pass), then scan as before.
import { S } from './state.js';
import { isPolygonLayer, featuresOf, preparePolygons, featureDocOf } from './polygons.js';
import { attrRowCountOf } from './records.js';
import { layerPositions } from './bygeom.js';
import { featuresAreaXY } from './coverage.js';
import { compileBool, validate } from '../../../ext/expr/index.js';
import { normLimit, LIMIT_PARAM, checkLimitValue } from './limit-param.js';

const nameOf = (L) => (L ? L.label || L.name : '?');
export const polygonLayers = () => S.layers.filter((L) => isPolygonLayer(L) && featuresOf(L, { closedOnly: true }).length);
const layerNamed = (name) => S.layers.find((x) => x.name === name) || S.layers.find((x) => (x.label || x.name) === name) || null;

export { normLimit, LIMIT_PARAM, checkLimitValue };

export function limitLabel(limit) {
  const l = normLimit(limit); if (!l) return '';
  const L = layerNamed(l.layer);
  return `inside ${L ? nameOf(L) : l.layer}${l.feature != null ? ` · ${l.feature}` : ''}${l.where ? ` · ${l.where}` : ''}${l.selected ? ' · selected' : ''}`;
}

// the polygon features a limit names → { L, features, area }. Throws with the reason.
export function resolveLimit(limit) {
  const l = normLimit(limit);
  if (!l) return null;
  const PL = layerNamed(l.layer);
  if (!PL) throw new Error(`limit: the polygon layer “${l.layer}” isn't loaded`);
  if (!isPolygonLayer(PL)) throw new Error(`limit: “${nameOf(PL)}” is not a strings & polygons layer`);
  if (l.selected && !(PL._selMask && PL._selCount)) throw new Error(`limit: no feature of “${nameOf(PL)}” is selected`);
  let fs = featuresOf(PL, { closedOnly: true, records: l.selected ? PL._selMask : null });
  if (!featuresOf(PL, { closedOnly: true }).length) throw new Error(`limit: “${nameOf(PL)}” holds no polygon (only lines — a line has no inside)`);
  if (l.feature != null) {
    const want = String(l.feature);
    const byId = fs.filter((f) => String(f.id) === want);
    fs = byId.length ? byId : fs.filter((f) => Object.values(f.attrs).some((v) => String(v) === want));
  }
  if (l.where) {
    const d = featureDocOf(PL), h = d.header, nums = new Set(h.numericColumns.map((c) => c.name));
    const schema = h.columns.map((c) => ({ name: c, type: nums.has(c) ? 'number' : 'string' }));
    const v = validate(l.where, schema);
    if (!v.ok) throw new Error(`limit where “${l.where}”: ${(v.errors[0] && v.errors[0].message) || 'invalid'} (columns: ${h.columns.join(', ')})`);
    const fn = compileBool(l.where, schema, { decimal: '.' });
    fs = fs.filter((f) => fn(h.columns.map((c) => (f.attrs[c] === '' ? null : f.attrs[c]))));
  }
  if (!fs.length) throw new Error(`limit: no polygon of “${nameOf(PL)}” matches${l.feature != null ? ` feature “${l.feature}”` : ''}${l.where ? ` where ${l.where}` : ''}`);
  return { L: PL, limit: l, features: fs, area: featuresAreaXY(fs) };
}

// what changes the answer: the limit as stated, and the geometry it picked (an edit moves this)
function geomKey(R) {
  let h = 0, n = 0;
  for (const f of R.features) {
    h = (h * 31 + f.rec) | 0;
    for (const r of f.rings) for (const p of r) { h = (h * 1000003 + Math.round(p[0] * 1000)) | 0; h = (h * 1000003 + Math.round(p[1] * 1000)) | 0; n++; }
  }
  return `${JSON.stringify(R.limit)}#${R.features.length}:${n}:${h}`;
}

// per layer DOCS (a reload / reinterpret replaces them, and the cache goes with them)
const _cache = new WeakMap();
const docsKey = (L) => L.docs || L;
const cacheOf = (L) => { let m = _cache.get(docsKey(L)); if (!m) { m = new Map(); _cache.set(docsKey(L), m); } return m; };

/** The record mask of `limit` on layer L (1 = the record's plan x/y is inside). Cached. */
export async function limitMaskOf(L, limit, { signal = null, onProgress = null } = {}) {
  const R = resolveLimit(limit);
  if (!R) return null;
  const n = attrRowCountOf(L) || 0;
  const key = `${geomKey(R)}|${n}`, cache = cacheOf(L);
  const hit = cache.get(key);
  if (hit) return hit.mask;
  const P = preparePolygons(R.features);
  const mask = new Uint8Array(n);
  let inside = 0, seen = 0;
  // the plan bbox is a spatial pushdown: a row group / zone the polygons can't reach is never read
  const bb = [P.bbox[0], P.bbox[1], -Infinity, P.bbox[2], P.bbox[3], Infinity];
  for await (const ch of layerPositions(L, bb)) {
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    for (let i = 0; i < ch.count; i++) {
      const r = ch.recs ? ch.recs[i] : ch.base + i;
      if (r < n && P.contains(ch.x[i], ch.y[i])) { if (!mask[r]) inside++; mask[r] = 1; }
    }
    seen += ch.count;
    if (onProgress) onProgress(n ? Math.min(1, seen / n) : 1, `inside ${nameOf(R.L)}: ${inside.toLocaleString()} records`);
    await new Promise((z) => setTimeout(z));
  }
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(key, { mask, inside });
  return mask;
}

/** The cached mask (null when none was computed for this exact limit + geometry). */
export function cachedLimitMask(L, limit) {
  let R; try { R = resolveLimit(limit); } catch { return null; }
  if (!R) return null;
  const hit = cacheOf(L).get(`${geomKey(R)}|${attrRowCountOf(L) || 0}`);
  return hit ? hit.mask : null;
}
export function limitInsideCount(L, limit) {
  let R; try { R = resolveLimit(limit); } catch { return null; }
  const hit = R && cacheOf(L).get(`${geomKey(R)}|${attrRowCountOf(L) || 0}`);
  return hit ? hit.inside : null;
}

/** Before a scan: compute (or find) the limit's mask on every layer the scan reads. */
export async function prepareScope(st, layers, signal = null, onProgress = null) {
  const lim = normLimit(st && st.limit);
  if (!lim) return;
  resolveLimit(lim);                                       // the reason first, before any pass
  for (const L of layers) if (L) await limitMaskOf(L, lim, { signal, onProgress });
}

// base mask (scope) AND the limit mask → one mask. Computed every call, NOT cached by the base
// array: a selection is edited IN PLACE (add-mode rectangle/lasso, by-solid add/subtract, the
// API's add/remove), so an identity-keyed cache handed back the old selection's answer (sweep
// 2026-11-25). One pass over a byte array — ~2 ms per 2M records — a couple of times per scan.
export function applyLimit(base, L, limit) {
  const lm = cachedLimitMask(L, limit);
  if (!lm) throw new Error(`limit ${limitLabel(limit)}: not prepared for ${nameOf(L)} (prepareScope before the scan)`);
  if (!base) return lm;
  const m = new Uint8Array(lm.length);
  for (let i = 0; i < m.length; i++) m[i] = lm[i] && i < base.length && base[i] ? 1 : 0;
  return m;
}

// ── the UI: one row any analysis window mounts ("inside: [polygon layer] [feature]") ──────────
// st.limit is the limit (or null); onChange() after it changed. → the row element.
export function limitRow(st, onChange, { label = 'inside', width = '44px' } = {}) {
  const row = document.createElement('div'); row.className = 'sw-row sw-limit';
  row.title = 'only what lies inside these polygons in plan (blocks by their centroid) — a strings & polygons layer';
  const lab = document.createElement('span'); lab.textContent = label; lab.style.cssText = `width:${width};flex:0 0 auto`;
  const ls = document.createElement('select'); ls.className = 'sw-sel'; ls.dataset.role = 'limit-layer';
  ls.append(new Option('— everywhere', ''));
  const polys = polygonLayers();
  for (const P of polys) ls.append(new Option(`▱ ${nameOf(P)}`, P.name));
  const cur = normLimit(st.limit);
  if (cur && !polys.some((P) => P.name === cur.layer || nameOf(P) === cur.layer)) ls.append(new Option(`▱ ${cur.layer} (not loaded)`, cur.layer));
  ls.value = cur ? (polys.find((P) => P.name === cur.layer || nameOf(P) === cur.layer) || { name: cur.layer }).name : '';
  row.append(lab, ls);
  ls.style.flex = '1'; ls.style.minWidth = '0';
  if (cur) {
    const P = layerNamed(cur.layer);
    const fsel = document.createElement('select'); fsel.className = 'sw-sel'; fsel.dataset.role = 'limit-feature'; fsel.style.cssText = 'flex:1;min-width:0';
    fsel.append(new Option('all polygons', ''));
    if (P && P._selCount) fsel.append(new Option(`the selected (${P._selCount})`, '#sel'));
    const fs = P ? featuresOf(P, { closedOnly: true }) : [];
    const nameCol = P && featureDocOf(P).header.columns.find((c) => /^(name|nome|id|code|label)$/i.test(c));
    for (const f of fs.slice(0, 500)) { const v = nameCol && f.attrs[nameCol] !== '' ? f.attrs[nameCol] : f.id; fsel.append(new Option(String(v), String(v))); }
    fsel.value = cur.selected ? '#sel' : cur.feature != null ? String(cur.feature) : '';
    if (fsel.value === '' && cur.feature != null) { fsel.append(new Option(String(cur.feature), String(cur.feature))); fsel.value = String(cur.feature); }
    fsel.onchange = () => {
      const o = { layer: cur.layer, ...(cur.where ? { where: cur.where } : {}) };
      if (fsel.value === '#sel') o.selected = true; else if (fsel.value) o.feature = fsel.value;
      st.limit = o; onChange();
    };
    row.append(fsel);
  }
  ls.onchange = () => { st.limit = ls.value ? { layer: ls.value } : null; onChange(); };
  return row;
}
