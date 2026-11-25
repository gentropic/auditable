// @gcu/proj transform — moving coordinates between two CRS, and saying HOW and HOW WELL.
//
//   transformPoints(fromCRS, toCRS, pts, opts?) → new [[x, y, z], …]   (z is carried, unchanged)
//   transformFlat(fromCRS, toCRS, xyz, stride = 3, opts?) → a new Float64Array (z untouched)
//   transformer(fromCRS, toCRS, opts?) → { forward([x, y]), inverse([x, y]), path }
//   describePath(fromCRS, toCRS, opts?) → { from, to, text, accuracy: { class, metres, text },
//                                           datumShift: { kind, params, source } | null }
//   toLonLat(crs, pts) / fromLonLat(crs, pts) — to / from WGS 84 longitude, latitude
//   extentLonLat(crs, [x0, y0, x1, y1]) → [west, south, east, north] (sampled edges)
//   registerDatumShift(rule) / DATUM_SHIFTS — published shifts that replace a table default
//   loadGrid(name, ArrayBuffer) — an NTv2 (.gsb) grid a definition names (not bundled)
//
// HEIGHTS: every transform here is HORIZONTAL. A point's z is carried unchanged — a mine's
// elevations are orthometric, and the ellipsoidal-height change a datum shift implies (metres)
// is not a change of elevation. opts.at = [lon, lat] (where the data sits) lets an area-bound
// published shift (IBGE's SAD69 parameters inside Brazil) apply; transformPoints works it out
// from the points themselves.
//
// Accuracy classes: 'exact' (same datum — projection maths only, millimetres), 'sub-metre'
// (WGS 84 ↔ SIRGAS 2000 / ETRS89-like frames taken as identical), 'metre' (a Helmert datum shift
// — 3 or 7 parameters, metre-level, stated with its source), 'grid' (an NTv2 grid you loaded),
// 'unknown' (a shift needs a grid that is not loaded, or a system states no datum: none applied).
import { proj4 } from './vendor-proj4.js';
import { WGS84_DEF } from './crs.js';

// ── published datum shifts that override a table default ──────────────────────────────────────
// IBGE, Resolução do Presidente R.PR 1/2005 (the SIRGAS2000 adoption), annex: transformation
// parameters to SIRGAS2000 — SAD 69: ΔX = −67.35, ΔY = +3.88, ΔZ = −38.22 m; Córrego Alegre:
// ΔX = −206.05, ΔY = +168.28, ΔZ = −3.82 m (also EPSG's "SAD69 to SIRGAS 2000 (1)", code 15485,
// for the SAD69 values). The EPSG default for SAD69 (−57, 1, −41; ~19 m) is a continent-wide
// mean; inside Brazil IBGE's is the national standard. Córrego Alegre's EPSG default needs the
// CA7072_003.gsb grid (not bundled), so IBGE's 3-parameter shift stands in, said so.
export const BRAZIL = [-74.01, -35.71, -25.28, 7.04];
export const DATUM_SHIFTS = [
  {
    id: 'sad69-ibge', datum: 'SAD69', towgs84: [-67.35, 3.88, -38.22],
    match: (c) => /^SAD69$|^SAD69 \/|south_american_1969|^South American Datum 1969/i.test(c.datum || '') && !/\(96\)/.test(c.datum || ''),
    where: BRAZIL, source: 'IBGE R.PR 1/2005 (= EPSG 15485)', accuracy: { metres: 5, text: '~1–5 m' },
  },
  {
    id: 'corrego-alegre-ibge', datum: 'Córrego Alegre', towgs84: [-206.05, 168.28, -3.82],
    match: (c) => /corr[eé]go[ _]?alegre(?![ _]?19?61)/i.test(c.datum || ''),
    where: null, source: 'IBGE R.PR 1/2005', accuracy: { metres: 5, text: '~1–5 m' },
  },
];
export function registerDatumShift(rule) { const k = DATUM_SHIFTS.findIndex((r) => r.id === rule.id); if (k >= 0) DATUM_SHIFTS[k] = rule; else DATUM_SHIFTS.push(rule); }

const _grids = new Set();
export function loadGrid(name, buffer) { proj4.nadgrid(name, buffer); _grids.add(name); }

const inBox = (b, p) => !b || (p && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);
const _proj = new Map();
function projOf(def) { let P = _proj.get(def); if (!P) { P = new proj4.Proj(def); _proj.set(def, P); } return P; }

// what a definition does to reach WGS 84: { kind: 'wgs84' | 'helmert3' | 'helmert7' | 'grid' |
// 'grid-missing' | 'none', params, grid, a, rf }
const gridOf = (def) => { const m = /\+nadgrids=(\S+)/.exec(def); return m && m[1] !== '@null' ? m[1] : null; };
const gridsLoaded = (g) => g.split(',').every((x) => _grids.has(x.replace(/^@/, '')));
function datumOf(def) {
  const grid = gridOf(def);
  // a definition naming a grid that isn't loaded: read it without the grid (proj4 would complain)
  const P = projOf(grid && !gridsLoaded(grid) ? def.replace(/\s*\+nadgrids=\S+/g, '') : def);
  const t = P.datum && P.datum.datum_type, pr = (P.datum && P.datum.datum_params) || null;
  const zero = pr && pr.slice(0, 6).every((v) => !v) && (pr.length < 7 || pr[6] === 1 || pr[6] === 0);
  let kind;
  if (grid) kind = gridsLoaded(grid) ? 'grid' : 'grid-missing';
  else if (t === 4 || ((t === 1 || t === 2) && zero)) kind = 'wgs84';
  else if (t === 1) kind = 'helmert3';
  else if (t === 2) kind = 'helmert7';
  else kind = 'none';
  // a system that names no datum but sits on the WGS 84 / GRS 1980 ellipsoid: a modern frame
  if (kind === 'none' && Math.abs(P.a - 6378137) < 1e-3 && Math.abs((P.rf || 0) - 298.2572) < 1e-3) kind = 'wgs84';
  return { kind, params: pr, grid, a: P.a, rf: P.rf };
}

// the definition actually used for a CRS here: a published override applied, a missing grid
// dropped (no shift, said so). → { def, crs, shift: { kind, params, source, accuracy, note } }
export function effectiveDef(crs, { at = null } = {}) {
  const def = crs.def;
  const d = datumOf(def);
  const rule = DATUM_SHIFTS.find((r) => r.match(crs) && (!r.where || inBox(r.where, at)));
  const wkt = /^\s*[A-Z_]+\s*\[/i.test(def);
  if (rule && (d.kind !== 'wgs84')) {
    const p = [...rule.towgs84, 0, 0, 0, 0].slice(0, 7);
    let nd;
    if (wkt) nd = def.replace(/,\s*TOWGS84\s*\[[^\]]*\]/ig, '').replace(/(DATUM\s*\[\s*"[^"]*"\s*,\s*SPHEROID\s*\[[^\]]*\])/i, `$1,TOWGS84[${p.join(',')}]`);
    else nd = def.replace(/\s*\+(towgs84|nadgrids|datum)=\S+/g, '') + ` +towgs84=${p.join(',')}`;
    return { def: nd, crs, shift: { kind: 'helmert3', params: rule.towgs84, source: rule.source, accuracy: rule.accuracy, rule: rule.id } };
  }
  if (d.kind === 'grid-missing') {
    const nd = wkt ? def : def.replace(/\s*\+nadgrids=\S+/g, '');
    return { def: nd, crs, shift: { kind: 'grid-missing', grid: d.grid, source: null, accuracy: { metres: null, text: `needs the ${d.grid} grid (not loaded) — no datum shift applied; can be off by tens to hundreds of metres` } } };
  }
  const acc = crs.accuracy != null ? { metres: crs.accuracy, text: `~${crs.accuracy} m (EPSG's stated accuracy)` } : null;
  if (d.kind === 'helmert3' || d.kind === 'helmert7') return { def, crs, shift: { kind: d.kind, params: d.params.slice(0, d.kind === 'helmert3' ? 3 : 7), source: crs.epsg ? `EPSG:${crs.epsg} default` : 'the definition', accuracy: acc || { metres: 5, text: '~1–5 m (no stated accuracy)' } } };
  if (d.kind === 'grid') return { def, crs, shift: { kind: 'grid', grid: d.grid, source: 'loaded grid', accuracy: { metres: 0.1, text: `~0.1 m (grid ${d.grid})` } } };
  return { def, crs, shift: { kind: d.kind, params: null, source: null, accuracy: null } };
}

const fmtP = (p) => p.map((v) => (v > 0 ? '+' : '') + (+v.toFixed(3))).join(', ');
const shortName = (c) => (c && c.datum) || (c && c.name) || '?';
const label = (c) => (c ? (c.epsg ? `${c.name} · EPSG:${c.epsg}` : `${c.name} (custom)`) : '?');

export function describePath(from, to, opts = {}) {
  const ef = effectiveDef(from, opts), et = effectiveDef(to, opts);
  const out = { from: label(from), to: label(to), datumShift: null, steps: [] };
  const sf = ef.shift, st = et.shift;
  const sameParams = (a, b) => a.kind === b.kind && JSON.stringify(a.params || null) === JSON.stringify(b.params || null);
  const dfA = datumOf(ef.def), dtA = datumOf(et.def);
  const sameEllps = Math.abs(dfA.a - dtA.a) < 1e-3 && Math.abs((dfA.rf || 0) - (dtA.rf || 0)) < 1e-6;
  const fromName = shortName(from), toName = shortName(to);
  if (sf.kind === 'grid-missing' || st.kind === 'grid-missing') {
    const s = sf.kind === 'grid-missing' ? sf : st;
    out.accuracy = { class: 'unknown', metres: null, text: s.accuracy.text };
    out.text = `${fromName} → ${toName}: ${s.accuracy.text}`;
    out.datumShift = { kind: 'none', missingGrid: s.grid };
    return out;
  }
  if ((sf.kind === 'none' || st.kind === 'none') && !(fromName === toName && sameEllps)) {
    out.accuracy = { class: 'unknown', metres: null, text: 'a system states no datum — no shift applied; the error is unknown (metres to hundreds of metres)' };
    out.text = `${fromName} → ${toName}: ${out.accuracy.text}`;
    out.datumShift = { kind: 'none' };
    return out;
  }
  if (fromName === toName || (sameParams(sf, st) && sameEllps && sf.kind !== 'wgs84')) {
    out.accuracy = { class: 'exact', metres: 0.001, text: 'same datum — projection maths only (millimetres)' };
    out.text = from.kind === to.kind && from.def === to.def ? 'no change' : `${fromName}: same datum — projection maths only (mm)`;
    return out;
  }
  if (sf.kind === 'wgs84' && st.kind === 'wgs84') {
    out.accuracy = { class: 'sub-metre', metres: 1, text: 'taken as identical (WGS 84, SIRGAS 2000, ETRS89 and NAD83-class frames agree to centimetres–a metre; no shift applied)' };
    out.text = `${fromName} → ${toName}: ${out.accuracy.text}`;
    return out;
  }
  // one or two Helmert shifts, through WGS 84
  const parts = [], srcs = [];
  let metres = 0;
  for (const [s, nm, dir] of [[sf, fromName, 'from'], [st, toName, 'to']]) {
    if (s.kind === 'wgs84') continue;
    const what = s.kind === 'helmert3' ? '3-parameter shift' : s.kind === 'helmert7' ? '7-parameter Helmert' : `grid ${s.grid}`;
    parts.push(`${nm} ${dir === 'from' ? '→' : '←'} WGS 84 by ${what}${s.params ? ` (${fmtP(s.params.slice(0, 3))} m${s.kind === 'helmert7' ? ' + rotations, scale' : ''})` : ''}`);
    if (s.source) srcs.push(s.source);
    metres = Math.max(metres, (s.accuracy && s.accuracy.metres) || 5);
  }
  const shift = sf.kind !== 'wgs84' ? sf : st;
  const what = (sf.kind !== 'wgs84' && st.kind !== 'wgs84') ? 'two Helmert shifts through WGS 84' : shift.kind === 'helmert3' ? '3-parameter Helmert' : shift.kind === 'helmert7' ? '7-parameter Helmert' : `grid ${shift.grid}`;
  const accText = shift.accuracy ? shift.accuracy.text : `~${metres} m`;
  out.accuracy = { class: shift.kind === 'grid' ? 'grid' : 'metre', metres, text: accText };
  out.datumShift = { kind: shift.kind, params: shift.params || null, source: srcs.join('; ') || null, steps: parts };
  out.steps = parts;
  out.text = `${fromName} → ${toName} by ${what}${shift.params && shift.kind !== 'grid' && (sf.kind === 'wgs84' || st.kind === 'wgs84') ? ` (${fmtP(shift.params.slice(0, 3))} m${srcs.length ? `, ${srcs.join('; ')}` : ''})` : srcs.length ? ` (${srcs.join('; ')})` : ''} — ${accText}`;
  return out;
}

const _conv = new Map();
function converter(fromDef, toDef) {
  const k = fromDef + '\u0000' + toDef;
  let c = _conv.get(k);
  if (!c) { c = proj4(projOf(fromDef), projOf(toDef)); _conv.set(k, c); if (_conv.size > 256) _conv.delete(_conv.keys().next().value); }
  return c;
}

export function transformer(from, to, opts = {}) {
  const ef = effectiveDef(from, opts), et = effectiveDef(to, opts);
  const c = converter(ef.def, et.def);
  return {
    forward: (p) => c.forward([+p[0], +p[1]]),
    inverse: (p) => c.inverse([+p[0], +p[1]]),
    path: describePath(from, to, opts),
    fromDef: ef.def, toDef: et.def,
  };
}

// where a set of points sits, in lon/lat (the centre of their extent) — for area-bound shifts
export function whereOf(crs, pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { const x = +p[0], y = +p[1]; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!(x1 >= x0)) return null;
  const mid = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (crs.kind === 'geographic') return mid;
  const g = gridOf(crs.def);
  try { return converter(g && !gridsLoaded(g) ? crs.def.replace(/\s*\+nadgrids=\S+/g, '') : crs.def, WGS84_DEF).forward(mid); } catch { return null; }
}

export function transformPoints(from, to, pts, opts = {}) {
  const at = opts.at || whereOf(from, pts);
  const t = transformer(from, to, { ...opts, at });
  return pts.map((p) => { const q = t.forward(p); return p.length > 2 ? [q[0], q[1], p[2]] : [q[0], q[1]]; });
}
export function transformFlat(from, to, xyz, stride = 3, opts = {}) {
  const pts = [];
  for (let i = 0; i + 1 < xyz.length; i += stride) pts.push([xyz[i], xyz[i + 1]]);
  const at = opts.at || whereOf(from, pts);
  const t = transformer(from, to, { ...opts, at });
  const out = Float64Array.from(xyz);
  for (let i = 0; i + 1 < xyz.length; i += stride) { const q = t.forward([xyz[i], xyz[i + 1]]); out[i] = q[0]; out[i + 1] = q[1]; }
  return out;
}

const WGS84 = Object.freeze({ code: 'EPSG:4326', epsg: 4326, name: 'WGS 84', kind: 'geographic', def: WGS84_DEF, units: 'degree', datum: 'WGS 84', bbox: [-180, -90, 180, 90], area: 'World.', accuracy: null });
export { WGS84 };
export const toLonLat = (crs, pts, opts) => transformPoints(crs, WGS84, pts, opts);
export const fromLonLat = (crs, pts, opts) => transformPoints(WGS84, crs, pts, opts);
export function extentLonLat(crs, b) {
  if (!crs || !b) return null;
  const [x0, y0, x1, y1] = b, pts = [];
  for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push([x0 + f * (x1 - x0), y0], [x0 + f * (x1 - x0), y1], [x0, y0 + f * (y1 - y0)], [x1, y0 + f * (y1 - y0)]); }
  let q;
  try { q = toLonLat(crs, pts); } catch { return null; }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of q) { if (!Number.isFinite(x) || !Number.isFinite(y)) continue; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return w <= e ? [w, s, e, n] : null;
}
