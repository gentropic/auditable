// @gcu/proj crs — CRS objects from what files and people say: an EPSG code, a .prj (OGC / ESRI
// WKT), a proj4 string, GeoTIFF / LAS GeoKeys, a GeoJSON "crs" member. And back: a label, a
// JSON form for project files.
//
//   await crsFromCode(code)          'EPSG:31983' | 31983 → the table's CRS, or null
//   await crsFromPrj(text)           a .prj / WKT → the table's CRS when it names one (an
//                                    AUTHORITY / ID, else its NAME matched — ESRI .prj files
//                                    carry no code), else a custom CRS parsed by proj4
//   await crsFromDefinition(text)    anything a person pastes: 'EPSG:n', a bare code, a proj4
//                                    string or a WKT → a CRS (throws with the reason)
//   await crsFromGeoKeys(keys)       { 3072: n } / { 2048: n } (GeoTIFF / LAS GeoKeyDirectory)
//   await crsFromUrn(name)           'urn:ogc:def:crs:EPSG::31983' / 'EPSG:4326' / 'CRS84'
//   crsLabel(crs)                    'SIRGAS 2000 / UTM zone 23S · EPSG:31983'
//   crsToJSON(crs) / await crsFromJSON(j)
//
// A custom CRS has the table entry's shape with code/epsg null and def = the text proj4 parses.
import { proj4 } from './vendor-proj4.js';
import { loadEpsgTable, lookupEpsg, normName, unitsOfDef } from './table.js';

export const WGS84_DEF = '+proj=longlat +datum=WGS84';

export async function crsFromCode(code) { return lookupEpsg(code); }

const firstQuoted = (s) => { const m = /"([^"]*)"/.exec(s); return m ? m[1] : null; };
const topKeyword = (s) => { const m = /^\s*([A-Z_0-9]+)\s*\[/i.exec(s); return m ? m[1].toUpperCase() : null; };
const GEOG_KW = /^(GEOGCS|GEOGCRS|GEOGRAPHICCRS|GEODCRS|GEODETICCRS)$/;
const PROJ_KW = /^(PROJCS|PROJCRS|PROJECTEDCRS)$/;
export const looksWkt = (s) => /^\s*(PROJCS|PROJCRS|PROJECTEDCRS|GEOGCS|GEOGCRS|GEOGRAPHICCRS|GEODCRS|GEODETICCRS|COMPD_CS|COMPOUNDCRS|LOCAL_CS|ENGCRS|BOUNDCRS)\s*\[/i.test(String(s || ''));

// a custom CRS from a definition proj4 can parse (throws with proj4's complaint, reworded)
export function customCrs(def, { name = null, datum = null } = {}) {
  const text = String(def || '').trim();
  let P;
  try { P = new proj4.Proj(text); } catch (e) { throw new Error(`not a coordinate system proj4 can read — ${e && e.message || e}`); }
  if (!P || !P.projName) throw new Error('not a coordinate system proj4 can read');
  const geographic = /^(longlat|latlong|lonlat|latlon|identity)$/i.test(P.projName);
  const wkt = looksWkt(text);
  const nm = name || (wkt ? firstQuoted(text) : null) || P.name || (geographic ? 'custom geographic system' : `custom ${P.projName} projection`);
  let dat = datum;
  if (!dat && wkt) { const g = /(GEOGCS|GEOGCRS|BASEGEOGCRS|BASEGEODCRS|GEODCRS)\s*\[\s*"([^"]*)"/i.exec(text); dat = g ? g[2] : null; }
  if (!dat && !wkt) { const d = /\+datum=(\S+)/.exec(text); const e = /\+ellps=(\S+)/.exec(text); dat = d ? d[1] : e ? `ellipsoid ${e[1]}` : null; }
  if (!dat) dat = P.datumName || P.datumCode || (geographic ? nm : 'unknown datum');
  let units = geographic ? 'degree' : 'metre';
  if (!geographic) {
    if (wkt) { const u = /UNIT\s*\[\s*"([^"]*)"\s*,\s*([\d.eE+-]+)[^\]]*\]\s*(,\s*(AXIS|AUTHORITY|ID)|\]\s*$|\])/i.exec(text.slice(text.search(/PROJECTION|CONVERSION/i))); if (u) units = /met(re|er)/i.test(u[1]) ? 'metre' : /foot.*us|us.*foot|survey/i.test(u[1]) ? 'US survey foot' : /foot|feet/i.test(u[1]) ? 'foot' : u[1]; }
    else units = unitsOfDef(text, 'projected');
  }
  return Object.freeze({ code: null, epsg: null, name: nm, kind: geographic ? 'geographic' : 'projected', def: text, units, datum: dat, bbox: null, area: '', accuracy: null, custom: true });
}

// a .prj / WKT → the table's CRS when it can be identified, else a custom one. `matchedBy`
// rides on a copy so the caller can say how ('authority' | 'name').
export async function crsFromPrj(text) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  if (!s) return null;
  const ids = [...s.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  const kw = topKeyword(s);
  // the LAST authority is the top-level one (nested ones — datum, ellipsoid, unit — come first)
  if (ids.length && (PROJ_KW.test(kw || '') || GEOG_KW.test(kw || ''))) {
    const c = await lookupEpsg(+ids[ids.length - 1][1]);
    if (c && ((PROJ_KW.test(kw) && c.kind === 'projected') || (GEOG_KW.test(kw) && c.kind === 'geographic'))) return Object.freeze({ ...c, matchedBy: 'authority' });
  }
  const nm = firstQuoted(s);
  if (nm && (PROJ_KW.test(kw || '') || GEOG_KW.test(kw || ''))) {
    const t = await loadEpsgTable();
    const want = normName(nm), kind = PROJ_KW.test(kw) ? 'p' : 'g';
    for (let i = 0; i < t.count; i++) if (t.kinds[i] === kind && t.norm[i] === want) return Object.freeze({ ...t.entry(i), matchedBy: 'name' });
  }
  return customCrs(s);
}

export async function crsFromDefinition(text) {
  const s = String(text || '').trim();
  if (!s) throw new Error('no definition given');
  const code = /^(?:EPSG\s*:+\s*)?(\d{4,6})$/i.exec(s);
  if (code) { const c = await lookupEpsg(+code[1]); if (!c) throw new Error(`EPSG:${code[1]} is not in the table (projected and geographic 2D systems with a proj4 definition)`); return c; }
  if (/^urn:|CRS84|^EPSG:/i.test(s)) { const c = await crsFromUrn(s); if (c) return c; }
  if (looksWkt(s)) return crsFromPrj(s);
  if (/^\+/.test(s) || /\+proj=/.test(s)) return customCrs(s);
  throw new Error('not an EPSG code, a proj4 string (+proj=…) or a WKT definition');
}

export async function crsFromUrn(name) {
  const s = String(name || '');
  if (/CRS84/i.test(s)) return lookupEpsg(4326);
  const m = /EPSG(?::|::|\/|\.)(?:[\d.]*:)?(\d+)\s*$/i.exec(s) || /EPSG\D+(\d+)/i.exec(s);
  return m ? lookupEpsg(+m[1]) : null;
}

// GeoTIFF / LAS GeoKeyDirectory: ProjectedCSTypeGeoKey (3072), else GeographicTypeGeoKey (2048).
// 32767 = "user-defined" (no code) → null.
export async function crsFromGeoKeys(keys) {
  if (!keys) return null;
  const p = keys[3072], g = keys[2048];
  if (p && p !== 32767) { const c = await lookupEpsg(p); if (c) return c; }
  if (g && g !== 32767) { const c = await lookupEpsg(g); if (c) return c; }
  return null;
}

export function crsLabel(crs) {
  if (!crs) return 'no coordinate system';
  return crs.epsg ? `${crs.name} · EPSG:${crs.epsg}` : `${crs.name} (custom)`;
}
export function crsToJSON(crs) {
  if (!crs) return null;
  return crs.epsg ? { epsg: crs.epsg, name: crs.name } : { name: crs.name, def: crs.def };
}
export async function crsFromJSON(j) {
  if (!j) return null;
  if (typeof j === 'string') return crsFromDefinition(j);
  if (j.epsg) return lookupEpsg(j.epsg);
  if (j.def) return customCrs(j.def, { name: j.name || null });
  return null;
}
// two CRS objects describe the same system (same code, or the same custom definition)
export function sameCrs(a, b) {
  if (!a || !b) return false;
  if (a.epsg && b.epsg) return a.epsg === b.epsg;
  return a.def === b.def;
}
