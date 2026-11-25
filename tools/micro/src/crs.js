// micro CRS — the PROJECT's coordinate system, and reprojection on read.
//
// The project has ONE coordinate reference system (S.crs — a @gcu/proj CRS object, or null while
// none is stated). It is set from a file's .prj on open (when unset), suggested from where the data
// sits, picked in the selector (src/crs-picker.js), or typed (an EPSG code, a proj4 string, a WKT);
// it is saved in project.json as { epsg, name } or { name, def }, and shown in the status bar chip,
// file info and the layer properties.
//
// VECTORS AND POINTS are reprojected into it when they are read (strings / polygons in every
// format, KML, GeoJSON, shapefiles with a .prj, WKT with an SRID, LAS with a CRS): horizontal only —
// a vertex's z is carried unchanged. Each reprojected layer records the transformation path and
// its accuracy class (@gcu/proj describePath) in its source + lineage. Block models, grids and
// meshes are NOT reprojected (a later wave gives them placements).
//
// API for the placements wave (5b) — what it builds on:
//   projectCrs()                          → the project's CRS object | null
//   await setProjectCrs(crs, { why })     → sets it (null clears); fires 'micro:crs'
//   transformPoints(fromCRS, toCRS, pts)  → [[x, y, z], …] (from @gcu/proj; z carried)
//   describePath(fromCRS, toCRS, { at })  → { text, accuracy: { class, metres, text }, datumShift }
//   await crsFromDefinition(text) / lookupEpsg(code) / crsFromPrj(text) → CRS objects
//   dataExtentLonLat()                    → the open data's extent in lon/lat (needs a project CRS)
import { S } from './state.js';
import {
  lookupEpsg, crsFromDefinition, crsFromPrj, crsFromUrn, crsFromJSON, crsToJSON, crsLabel, sameCrs,
  transformPoints, describePath, extentLonLat, suggestCrs, WGS84,
} from '../../../ext/proj/index.js';

export { transformPoints, describePath, crsLabel, crsToJSON, crsFromJSON, sameCrs, lookupEpsg, crsFromDefinition, crsFromPrj, crsFromUrn, WGS84 };

export function projectCrs() { return S.crs || null; }

const RECENT_KEY = 'micro.crs.recent';
export function recentCrsCodes() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
function noteRecent(crs) {
  if (!crs || !crs.epsg) return;
  try { const r = recentCrsCodes().filter((c) => c !== crs.epsg); r.unshift(crs.epsg); localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 12))); } catch { /* private mode */ }
}

// set (or clear) the project's CRS. A geographic system is refused: micro's world is metres.
export async function setProjectCrs(crs, { why = 'picked', quiet = false } = {}) {
  if (crs && crs.kind === 'geographic') throw new Error(`${crsLabel(crs)} is geographic (degrees) — a project works in metres: pick a projected system (UTM, a national grid…)`);
  const before = S.crs;
  S.crs = crs || null;
  S.crsWhy = crs ? why : null;
  if (S.frame) S.frame = { ...S.frame, crs: crs ? (crs.epsg ? `EPSG:${crs.epsg}` : crs.name) : null };
  noteRecent(crs);
  updateCrsChip();
  if (!sameCrs(before, crs) || (!before) !== (!crs)) {
    if (!quiet) dispatchEvent(new Event('micro:project-dirty'));
    dispatchEvent(new CustomEvent('micro:crs', { detail: { crs: S.crs, why } }));
  }
  return S.crs;
}

// project.json: in and out
export const projectCrsJSON = () => crsToJSON(S.crs);
export async function loadProjectCrs(j) {
  let c = null;
  try { c = j ? await crsFromJSON(j) : null; } catch { c = null; }
  await setProjectCrs(c && c.kind !== 'geographic' ? c : null, { why: 'project', quiet: true });
  return c;
}

// the open data's extent in longitude / latitude — for the selector's map and "fits my data"
export function dataExtentLonLat() {
  if (!S.crs || !S.docBbox || !S.frame) return null;
  const o = S.frame.origin, b = S.docBbox;
  return extentLonLat(S.crs, [o[0] + b[0], o[1] + b[1], o[0] + b[3], o[1] + b[4]]);
}
// best projected systems for a lon/lat extent (or for the open data)
export async function suggestFor(extLonLat = dataExtentLonLat(), opts) { return extLonLat ? suggestCrs(extLonLat, opts) : []; }

// the reprojection record a layer carries (source + lineage): how and how well
export function reprojectionRecord(from, to, at) {
  const p = describePath(from, to, { at });
  return { from: crsLabel(from), to: crsLabel(to), fromCrs: crsToJSON(from), toCrs: crsToJSON(to), path: p.text, accuracy: p.accuracy, heights: 'unchanged (horizontal reprojection)' };
}

// ── the status-bar chip: the project's CRS, always visible; a click opens the selector ──
let _chipClick = null;
export function onCrsChipClick(fn) { _chipClick = fn; }
export function updateCrsChip() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('crsChip');
  if (!el) {
    const seal = document.getElementById('sealBadge');
    if (!seal || !seal.parentElement) return;
    el = document.createElement('button');
    el.id = 'crsChip';
    // its look lives in index.html's stylesheet (#crsChip), so the phone layout can hide it
    el.onclick = () => { if (_chipClick) _chipClick(); };
    seal.parentElement.insertBefore(el, seal);
  }
  const c = S.crs;
  el.textContent = c ? (c.epsg ? `EPSG:${c.epsg}` : c.name) : 'no CRS';
  el.title = c ? `the project's coordinate system: ${crsLabel(c)}${S.crsWhy ? ` (${S.crsWhy})` : ''} — click to change` : 'the project has no coordinate system — click to set one (vectors in another system are reprojected into it on read)';
  el.style.color = c ? 'var(--text)' : 'var(--dim)';
}

try { window._microCrs = { projectCrs, setProjectCrs, loadProjectCrs, projectCrsJSON, dataExtentLonLat, suggestFor, reprojectionRecord, transformPoints, describePath, crsLabel, lookupEpsg, crsFromDefinition, crsFromPrj }; } catch { /* headless */ }
