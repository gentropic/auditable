// micro POLYGON I/O — the readers and writers of the feature layer kind (src/polygons.js).
//
// READ (each → a feature model { format, features, columns, rows, crs, prj, srid, warnings, points }):
//   CSV string files   an ID column + ordered X / Y (/ Z) rows, consecutive rows of one id = one
//                      string; a string whose last vertex returns to its first is a polygon (the
//                      Leapfrog / Surpac export shape). Other columns → attributes (first row's).
//   WKT                a .wkt file: one geometry, or one per line (EWKT SRID=… honoured).
//   WKT-CSV            a delimited table with a WKT column (wkt_geom / WKT / geometry / the_geom /
//                      shape) — QGIS's "copy features" and "save as CSV, GEOMETRY=AS_WKT" shape.
//   GeoJSON            FeatureCollection / Feature / bare geometry; a legacy "crs" member honoured.
//   Shapefile          .shp + .dbf + .prj (+ .cpg), loose (grouped by base name) or zipped (@gcu/shp).
//   DXF                polylines / lines / circles as features (the DXF layer + any MICRO xdata
//                      attributes) — "Open as → strings & polygons".
// Point geometries are not strings: a file of only points opens as a POINTS layer (a generated
// X,Y,Z CSV); points mixed into a strings file are skipped with a note.
//
//   KML / KMZ          Placemarks (points, LineStrings, Polygons, MultiGeometry) with ExtendedData
//                      attributes — always WGS 84 lon/lat (src/kml.js; a .kmz is a zip of one).
//
// THE CRS RULE (wave 5 — reprojection on read): what a file says about its coordinate system (a
// .prj, a GeoJSON "crs" — absent = WGS 84 lon/lat per RFC 7946 —, an SRID, KML = WGS 84, or
// coordinates that are plainly lon/lat) is resolved to a CRS (@gcu/proj), and the features are
// REPROJECTED into the project's CRS (`opts.target`) — horizontally, z carried. The model records
// how (model.reprojected: from, to, path, accuracy class). With NO project CRS: a projected file is
// read as it is (the caller may adopt its CRS as the project's), and a GEOGRAPHIC one is REFUSED
// with the reason (GeographicError, carrying the data's lon/lat extent so the caller can offer to
// set a CRS) — never silently placed at (−45, −20). A file that states nothing is taken as already
// in the project's system. `opts.assumeProjected` (the host API) skips all of it.
//
// WRITE (also KML and lon/lat GeoJSON, both WGS 84 — reprojected from the layer's CRS on the way out):
// WKT-CSV (tab — the QGIS clipboard — or comma), GeoJSON (a "crs" member when one is
// known), Shapefile (a .zip: .shp/.shx/.dbf/.cpg/.prj — polygons and lines as two sets when mixed),
// DXF (closed LWPOLYLINE / 3D POLYLINE per ring on the category's DXF layer, every attribute as
// MICRO xdata, so micro reads them back). Attributes ride every format.
import { parse as parseWkt, stringify as stringifyWkt } from '../../../ext/wkt/index.js';
import { readShapefile, writeShapefile } from '../../../ext/shp/index.js';
import { read as readDxf, write as writeDxf, explode as explodeDxf, polylineChords } from '../../../ext/dxf/index.js';
import { openZipRanged, blobSource, createZipStreamWriter } from '../../../ext/archive/src/zipstream.js';
import { geometryToFeature, featureToGeometry, featureDocOf, featuresOf } from './polygons.js';
import { lookupEpsg, crsFromPrj, crsFromUrn, crsFromJSON, crsLabel, sameCrs, transformer, whereOf, describePath, crsToJSON, WGS84 } from '../../../ext/proj/index.js';
import { readKml, kmlInZip, featuresToKml } from './kml.js';

// ── small text helpers ──────────────────────────────────────────────────────────────────────
// RFC 4180-ish: quoted fields may hold the delimiter, quotes ("") and newlines
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], f = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { q = true; i++; continue; }
    if (c === delim) { row.push(f); f = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      row.push(f); f = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); if (!(row.length === 1 && row[0] === '')) rows.push(row); }
  return rows;
}
// the delimiter of a header line: tab, then ';', then ',' — counted outside quotes
export function sniffDelim(line) {
  const count = (ch) => { let k = 0, q = false; for (const c of line) { if (c === '"') q = !q; else if (!q && c === ch) k++; } return k; };
  const t = count('\t'), s = count(';'), c = count(',');
  if (t && t >= s && t >= c) return '\t';
  if (s > c) return ';';
  return ',';
}
const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
// a cell as a value: a plain number → number (not a zero-padded code like 007), else text
export function cellValue(s) {
  if (s == null) return '';
  const t = String(s).trim();
  if (t === '') return '';
  if (NUM_RE.test(t) && !/^[-+]?0\d/.test(t)) return +t;
  return t;
}
const firstLine = (text) => { const k = text.search(/\r?\n/); return k < 0 ? text : text.slice(0, k); };

// ── the CRS rule ────────────────────────────────────────────────────────────────────────────
export class GeographicError extends Error {
  constructor(why, { extent = null, fileCrs = null } = {}) {
    super(`${why} — the project has no coordinate system yet, so longitude/latitude would land at (−45, −20) on a metre grid. Set the project's coordinate system (the CRS chip in the status bar, or ⌘K → Coordinate system…; it suggests one from where the data sits) and open it again: it will be reprojected into it.`);
    this.name = 'GeographicError';
    this.geographic = true;
    this.extent = extent;                                  // the data's lon/lat extent [w, s, e, n] — to suggest a CRS
    this.fileCrs = fileCrs;
  }
}
// EPSG 4000–4999 is the geographic-2D block (4326 WGS 84, 4674 SIRGAS 2000, 4269 NAD83, 4258 ETRS89, …)
export const epsgIsGeographic = (code) => Number.isFinite(+code) && +code >= 4000 && +code <= 4999;
export function crsFromName(name) {
  const s = String(name || '');
  if (/CRS84|CRS83|CRS27/i.test(s)) return { kind: 'geographic', name: s };
  const m = /EPSG(?::|::|\/|\.)(?:[\d.]*:)?(\d+)\s*$/i.exec(s) || /EPSG\D+(\d+)/i.exec(s);
  if (m) return { kind: epsgIsGeographic(+m[1]) ? 'geographic' : 'projected', name: s, epsg: +m[1] };
  return { kind: 'projected', name: s };                  // an explicit, non-geographic statement
}
// do the coordinates look like degrees? every x in ±180, every y in ±90, and the extent under
// 20° — a local mine grid of a few hundred metres near its origin has a larger extent
export function lonLatShaped(features) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
  const visit = (p) => { any = true; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
  for (const f of features) for (const r of f.rings) for (const p of r) visit(p);
  if (!any) return false;
  return x0 >= -180 && x1 <= 180 && y0 >= -90 && y1 <= 90 && (x1 - x0) < 20 && (y1 - y0) < 20;
}
const allPoints = (model) => model.features.concat(model.points && model.points.length ? [{ rings: [model.points] }] : []);
function lonLatExtent(model) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of allPoints(model)) for (const r of f.rings) for (const p of r) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
  return w <= e ? [w, s, e, n] : null;
}
// what the file says its CRS is → { crs, by } | null (by: how it was known, for the record)
export async function fileCrsOf(model) {
  if (model.format === 'kml') return { crs: WGS84, by: 'KML (always WGS 84)' };
  if (model.prj) {
    try { const c = await crsFromPrj(model.prj); if (c) return { crs: c, by: `.prj${c.matchedBy === 'name' ? ' (matched by name)' : ''}${c.kind === 'geographic' ? ' — geographic' : ''}` }; } catch { /* unreadable .prj: fall through to the one-word read */ }
  }
  const mc = model.crs;
  if (mc && mc.epsg) { const c = await lookupEpsg(mc.epsg); if (c) return { crs: c, by: model.srid != null ? `SRID ${model.srid}` : `"crs" EPSG:${mc.epsg}` }; }
  if (mc && mc.name) { const c = await crsFromUrn(mc.name); if (c) return { crs: c, by: `"crs" ${mc.name}` }; }
  if (mc && mc.kind === 'geographic') return { crs: WGS84, by: `${mc.name || 'a geographic system'} — geographic, taken as WGS 84` };
  if (mc && (mc.kind === 'projected' || mc.kind === 'local')) return null;      // stated, but not a system the table names
  const shaped = lonLatShaped(allPoints(model));
  if (model.format === 'geojson' && shaped) return { crs: WGS84, by: 'a GeoJSON file without a "crs" is WGS 84 (RFC 7946)' };
  if (shaped) return { crs: WGS84, by: 'no CRS stated, and these coordinates look like longitude/latitude (all within ±180 / ±90, spanning under 20°) — taken as WGS 84' };
  return null;
}
// resolve the file's CRS against the project's (`target`) and reproject in place when they differ.
// Sets model.fileCrs / model.fileCrsBy and, when it moved anything, model.reprojected.
export async function resolveCrs(model, name, { target = null, assumeProjected = false } = {}) {
  model.fileCrs = null; model.fileCrsBy = null; model.reprojected = null;
  if (assumeProjected) return model;
  const f = await fileCrsOf(model);
  if (!f) {
    if (model.format === 'geojson' && !model.crs) model.warnings.push('no "crs" stated — the coordinates are not longitude/latitude, so they are taken as the project\'s system');
    return model;
  }
  model.fileCrs = f.crs; model.fileCrsBy = f.by;
  if (!target) {
    if (f.crs.kind === 'geographic') throw new GeographicError(`${name}: its coordinates are longitude/latitude — ${f.by}${f.crs.epsg !== 4326 ? ` (${crsLabel(f.crs)})` : ''}`, { extent: lonLatExtent(model), fileCrs: f.crs });
    return model;                                          // projected, no project CRS: read as it is (the caller may adopt this CRS)
  }
  if (sameCrs(f.crs, target)) return model;
  reprojectModel(model, f.crs, target);
  return model;
}
// every vertex (and point) of a model from → to, in place; the record lands on model.reprojected
export function reprojectModel(model, from, to) {
  const pts = [];
  for (const f of allPoints(model)) for (const r of f.rings) for (const p of r) pts.push(p);
  const at = whereOf(from, pts);
  const t = transformer(from, to, { at });
  let bad = 0;
  for (const p of pts) {
    const q = t.forward(p);
    if (Number.isFinite(q[0]) && Number.isFinite(q[1])) { p[0] = q[0]; p[1] = q[1]; } else bad++;
  }
  const path = describePath(from, to, { at });
  model.reprojected = { from: crsLabel(from), to: crsLabel(to), fromCrs: crsToJSON(from), toCrs: crsToJSON(to), by: model.fileCrsBy || null, path: path.text, accuracy: path.accuracy, heights: 'unchanged (horizontal reprojection)', at, vertices: pts.length, failed: bad };
  model.warnings.push(`reprojected ${model.reprojected.from} → ${model.reprojected.to} (${path.accuracy.class}: ${path.accuracy.text})${bad ? ` · ${bad} vertex${bad === 1 ? '' : 'es'} could not be transformed` : ''}`);
  return model.reprojected;
}

// ── assembling a model from GeoJSON-shaped features ─────────────────────────────────────────
function propValue(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return cellValue(v);
}
// list: [{ geometry, properties, id }] → model
export function modelFromGeoFeatures(list, { format, crs = null, prj = null, srid = null, warnings = [] } = {}) {
  const columns = [], colIdx = new Map();
  for (const it of list) for (const k of Object.keys(it.properties || {})) if (!colIdx.has(k)) { colIdx.set(k, columns.length); columns.push(k); }
  const features = [], rows = [], points = [], pointRows = [], noZ = [];
  const dim3 = (c) => { while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; return Array.isArray(c) && c.length > 2; };
  let skippedPts = 0, nullGeom = 0;
  list.forEach((it, i) => {
    const row = columns.map((c) => propValue((it.properties || {})[c]));
    const g = it.geometry;
    if (!g) { nullGeom++; return; }
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      for (const p of (g.type === 'Point' ? [g.coordinates] : g.coordinates)) if (p && p.length >= 2) { points.push([+p[0], +p[1], p.length > 2 ? +p[2] : 0]); pointRows.push(row); }
      return;
    }
    const fg = geometryToFeature(g);
    const parts = Array.isArray(fg) ? fg : fg ? [fg] : [];
    const geoms = g.type === 'GeometryCollection' ? (g.geometries || []).filter((x) => x && !/Point/.test(x.type)) : [g];
    parts.forEach((p, k) => { features.push({ id: it.id != null ? it.id : i + 1, ...p }); rows.push(row); noZ.push(!dim3((geoms[k] || g).coordinates)); });
    if (g.type === 'GeometryCollection' && parts.length > 1) warnings.push('a geometry collection was split into one feature per member');
  });
  if (features.length && points.length) { skippedPts = points.length; warnings.push(`${skippedPts} point${skippedPts === 1 ? '' : 's'} skipped — a strings & polygons layer holds lines and polygons`); }
  if (nullGeom) warnings.push(`${nullGeom} feature${nullGeom === 1 ? '' : 's'} without geometry skipped`);
  // which features came WITHOUT a z (read at z = 0 — the caller places them, or says so)
  return { format, features, columns, rows, crs, prj, srid, warnings, noZ, has3d: !noZ.some(Boolean), points: features.length ? null : points, pointRows: features.length ? null : pointRows };
}

// ── GeoJSON ─────────────────────────────────────────────────────────────────────────────────
export function readGeoJson(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`GeoJSON: not valid JSON — ${e.message}`); }
  let list;
  if (j && j.type === 'FeatureCollection') list = (j.features || []).map((f) => ({ geometry: f.geometry, properties: f.properties || {}, id: f.id }));
  else if (j && j.type === 'Feature') list = [{ geometry: j.geometry, properties: j.properties || {}, id: j.id }];
  else if (j && j.type && j.coordinates !== undefined || (j && j.type === 'GeometryCollection')) list = [{ geometry: j, properties: {} }];
  else throw new Error('GeoJSON: no FeatureCollection, Feature or geometry here');
  const crsName = j.crs && j.crs.properties && (j.crs.properties.name || j.crs.properties.href);
  const crs = crsName ? crsFromName(crsName) : null;
  return modelFromGeoFeatures(list, { format: 'geojson', crs });
}
export const looksGeoJson = (head) => /^\s*\{[\s\S]*"type"\s*:\s*"(FeatureCollection|Feature|Polygon|MultiPolygon|LineString|MultiLineString|GeometryCollection|Point|MultiPoint)"/.test(head);

// ── WKT (one per line, or one) ──────────────────────────────────────────────────────────────
const WKT_HEAD = /^\s*(SRID=\d+\s*;\s*)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)/i;
export function readWktText(text) {
  const t = text.replace(/^﻿/, '').trim();
  let geoms;
  try { geoms = [parseWkt(t)]; }
  catch {
    geoms = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l, k) => { try { return parseWkt(l); } catch (e) { throw new Error(`WKT line ${k + 1}: ${e.message}`); } });
  }
  const srid = geoms.map((g) => g.srid).find((s) => s != null);
  return modelFromGeoFeatures(geoms.map((g, i) => ({ geometry: g, properties: { ID: i + 1 }, id: i + 1 })), { format: 'wkt', crs: srid != null ? { kind: epsgIsGeographic(srid) ? 'geographic' : 'projected', name: `EPSG:${srid}`, epsg: srid } : null, srid: srid ?? null });
}

// ── WKT-CSV (the QGIS shape) ────────────────────────────────────────────────────────────────
const WKT_COL = /^(wkt|wkt_geom|wkt_geometry|geom|geometry|the_geom|shape|wkb_geometry)$/i;
// → { delim, wktCol } when this text is a table with a WKT column, else null
export function sniffWktCsv(text) {
  const head = firstLine(text.replace(/^﻿/, ''));
  if (!head) return null;
  const delim = sniffDelim(head);
  const rows = parseDelimited(text.replace(/^﻿/, '').slice(0, 64 * 1024), delim);
  if (rows.length < 2) return null;
  const hdr = rows[0].map((s) => s.trim());
  for (let i = 0; i < hdr.length; i++) {
    if (!WKT_COL.test(hdr[i])) continue;
    const v = rows.slice(1).map((r) => r[i]).find((s) => s && s.trim());
    if (v && WKT_HEAD.test(v)) return { delim, wktCol: i };
  }
  return null;
}
export function readWktCsv(text, sniff = sniffWktCsv(text)) {
  if (!sniff) throw new Error('WKT-CSV: no WKT column');
  const rows = parseDelimited(text.replace(/^﻿/, ''), sniff.delim);
  const hdr = rows[0].map((s) => s.trim());
  const list = [];
  let srid = null, bad = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const w = (row[sniff.wktCol] || '').trim();
    const props = {};
    hdr.forEach((h, i) => { if (i !== sniff.wktCol) props[h] = row[i] === undefined ? '' : row[i]; });
    let g = null;
    if (w) { try { g = parseWkt(w); if (g.srid != null && srid == null) srid = g.srid; } catch { bad++; } }
    list.push({ geometry: g, properties: props, id: r });
  }
  const model = modelFromGeoFeatures(list, { format: 'wkt-csv', srid, crs: srid != null ? { kind: epsgIsGeographic(srid) ? 'geographic' : 'projected', name: `EPSG:${srid}`, epsg: srid } : null });
  if (bad) model.warnings.push(`${bad} row${bad === 1 ? '' : 's'} with unreadable WKT skipped`);
  return model;
}

// ── CSV string files (ID + ordered X / Y / Z) ───────────────────────────────────────────────
const X_RE = /^(x|xp|xc|xpt|east|easting|e|x_?coord(inate)?|x\s*\(m\)|mid_?x)$/i;
const Y_RE = /^(y|yp|yc|ypt|north|northing|n|y_?coord(inate)?|y\s*\(m\)|mid_?y)$/i;
const Z_RE = /^(z|zp|zc|zpt|elev|elevation|rl|height|alt|altitude|z_?coord(inate)?|z\s*\(m\))$/i;
const ID_RE = /^(id|string|str|str_?id|string_?(id|no|num|number)|line|line_?(id|no)|poly|polyline|polygon|poly(line|gon)?_?(id|no)|feature|feature_?id|fid|shape_?id|part|part_?id|ring|ring_?id|object|object_?id|obj_?id|seg|segment|segment_?id|sid|pid|lid|trace|trace_?id)$/i;
// → { delim, x, y, z, id } when this table is a string file, else null
export function sniffStringCsv(text) {
  const t = text.replace(/^﻿/, '');
  const head = firstLine(t);
  if (!head) return null;
  const delim = sniffDelim(head);
  const rows = parseDelimited(t.slice(0, 256 * 1024), delim);
  if (rows.length < 4) return null;
  const hdr = rows[0].map((s) => s.trim());
  const find = (re) => hdr.findIndex((h) => re.test(h));
  const x = find(X_RE), y = find(Y_RE), z = find(Z_RE), id = find(ID_RE);
  if (x < 0 || y < 0 || id < 0 || id === x || id === y || id === z) return null;
  // ids come in RUNS (one string's vertices together), several vertices per id
  const data = rows.slice(1, rows.length - (t.length > 256 * 1024 ? 1 : 0));   // the last sampled row may be cut
  let runs = 0, prev;
  for (const r of data) { const v = (r[id] || '').trim(); if (v !== prev) { runs++; prev = v; } }
  if (!runs || data.length / runs < 2) return null;
  if (!data.every((r) => Number.isFinite(+r[x]) && Number.isFinite(+r[y]))) return null;
  return { delim, x, y, z: z >= 0 ? z : null, id };
}
export function readStringCsv(text, sniff = sniffStringCsv(text)) {
  if (!sniff) throw new Error('string file: no ID + X/Y columns');
  const rows = parseDelimited(text.replace(/^﻿/, ''), sniff.delim);
  const hdr = rows[0].map((s) => s.trim());
  const attrCols = hdr.map((_, i) => i).filter((i) => i !== sniff.x && i !== sniff.y && i !== sniff.z);   // the id first, then the rest
  attrCols.sort((a, b) => (a === sniff.id ? -1 : b === sniff.id ? 1 : a - b));
  const byId = new Map(), order = [];
  let bad = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const xv = +row[sniff.x], yv = +row[sniff.y], zv = sniff.z != null ? +row[sniff.z] : 0;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) { bad++; continue; }
    const key = (row[sniff.id] || '').trim();
    let s = byId.get(key);
    if (!s) { s = { key, parts: [], last: -2, attrs: attrCols.map((i) => cellValue(row[i])) }; byId.set(key, s); order.push(s); }
    if (s.last !== r - 1) s.parts.push([]);              // a run interrupted by another id: a new part of the same string
    s.parts[s.parts.length - 1].push(sniff.z != null ? [xv, yv, Number.isFinite(zv) ? zv : 0] : [xv, yv]);
    s.last = r;
  }
  const list = [];
  for (const s of order) {
    const parts = s.parts.filter((p) => p.length >= 2);
    if (!parts.length) continue;
    const closed = parts.every((p) => p.length >= 4 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]);
    const geometry = closed
      ? (parts.length === 1 ? { type: 'Polygon', coordinates: [parts[0]] } : { type: 'MultiPolygon', coordinates: parts.map((p) => [p]) })
      : (parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts });
    const props = {}; attrCols.forEach((i, k) => { props[hdr[i]] = s.attrs[k]; });
    list.push({ geometry, properties: props, id: s.key });
  }
  const model = modelFromGeoFeatures(list, { format: 'csv-strings' });
  if (bad) model.warnings.push(`${bad} row${bad === 1 ? '' : 's'} without coordinates skipped`);
  return model;
}

// ── Shapefile ───────────────────────────────────────────────────────────────────────────────
const u8 = async (b) => new Uint8Array(await b.arrayBuffer());
export async function readShapefileParts(parts) {
  const set = readShapefile({ shp: parts.shp, dbf: parts.dbf || null, prj: parts.prj || null, cpg: parts.cpg || null });
  const model = modelFromGeoFeatures(set.features.map((f, i) => ({ geometry: f.geometry, properties: f.properties, id: i + 1 })), {
    format: 'shapefile', crs: set.crs && set.crs.kind !== 'unknown' ? set.crs : null, prj: set.prj, warnings: [...set.warnings],
  });
  if (!parts.dbf) model.warnings.push('no .dbf beside the .shp — the features have no attributes');
  if (!parts.prj) model.warnings.push('no .prj — the coordinate system is not stated');
  return model;
}
// a .zip → the shapefile sets it holds (by base name)
export async function shapefilesInZip(blob) {
  const z = await openZipRanged(blobSource(blob));
  const sets = new Map();
  for (const e of z.list()) {
    if (e.dir) continue;
    const m = /^(.*)\.(shp|dbf|prj|cpg|shx)$/i.exec(e.name);
    if (!m || /(^|\/)__MACOSX\//.test(e.name)) continue;
    const base = m[1], ext = m[2].toLowerCase();
    if (!sets.has(base.toLowerCase())) sets.set(base.toLowerCase(), { base: base.split('/').pop(), entries: {} });
    sets.get(base.toLowerCase()).entries[ext] = e;
  }
  const out = [];
  for (const s of sets.values()) if (s.entries.shp) out.push({ base: s.base, read: async () => {
    const parts = {};
    for (const [ext, e] of Object.entries(s.entries)) parts[ext] = await z.bytes(e);
    return parts;
  } });
  return out;
}
export async function zipBlobOf(members) {
  const chunks = [];
  const w = createZipStreamWriter({ write: (b) => { chunks.push(b.slice()); } });
  for (const [name, data] of members) await w.add(name, data, { aligned: false, mtime: Date.now() });
  await w.finish();
  return new Blob(chunks, { type: 'application/zip' });
}
// loose files → { sets: [{ base, files: { shp, dbf, prj, cpg, shx } }], rest }
export function groupShapefileParts(files) {
  const by = new Map(), rest = [];
  for (const f of files) {
    const m = /^(.*)\.(shp|dbf|prj|cpg|shx)$/i.exec(f.name || '');
    if (!m) { rest.push(f); continue; }
    const k = m[1].toLowerCase();
    if (!by.has(k)) by.set(k, { base: m[1], files: {} });
    by.get(k).files[m[2].toLowerCase()] = f;
  }
  const sets = [];
  for (const s of by.values()) { if (s.files.shp) sets.push(s); else rest.push(...Object.values(s.files)); }
  return { sets, rest };
}
// a loose set → ONE zip blob, so the layer has a single file (projects copy it, reload reads it)
export async function zipShapefileSet(set) {
  const members = [];
  for (const [ext, f] of Object.entries(set.files)) members.push([`${set.base}.${ext}`, await u8(f)]);
  const z = await zipBlobOf(members);
  z._shpBase = set.base;
  return z;
}

// ── DXF as features ─────────────────────────────────────────────────────────────────────────
const XAPP = 'MICRO';
function xdataAttrs(props) {
  const items = props && props.xdata && props.xdata[XAPP];
  if (!items) return null;
  const out = {};
  for (const it of items) { const s = String(it.value); const k = s.indexOf('='); if (k > 0) out[s.slice(0, k)] = s.slice(k + 1); }
  return out;
}
export function readDxfFeatures(text) {
  const doc = explodeDxf(readDxf(text));
  const list = [], byFid = new Map(), warnings = [];
  let n = 0;
  for (const f of doc.features) {
    if (!f.geometry) continue;
    const props = f.properties || {};
    let pts = null, closed = false;
    if (f.type === 'polyline') {
      const g = f.geometry;
      const ch = polylineChords(g);
      if (!ch) continue;
      pts = []; for (let i = 0; i < ch.length; i += 3) pts.push([ch[i], ch[i + 1], ch[i + 2]]);
      closed = !!g.closed || (pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] && pts[0][2] === pts[pts.length - 1][2]);
    } else if (f.type === 'line') {
      const v = f.geometry.vertices; pts = [[v[0], v[1], v[2]], [v[3], v[4], v[5]]];
    } else if (f.type === 'circle') {
      const c = f.geometry.center, r = f.geometry.radius; pts = [];
      for (let k = 0; k < 64; k++) { const a = (k / 64) * 2 * Math.PI; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2] || 0]); }
      closed = true;
    } else continue;
    const xa = xdataAttrs(props) || {};
    const fid = xa.MICRO_FID, role = xa.MICRO_RING;
    delete xa.MICRO_FID; delete xa.MICRO_RING;
    const attrs = { LAYER: props.layer || '0', ...xa };
    if (fid != null && byFid.has(fid)) {                  // a ring of a feature already started (a hole, a further part)
      const it = byFid.get(fid);
      if (it.geometry.type === 'Polygon' || it.geometry.type === 'MultiPolygon') {
        const polys = it.geometry.type === 'Polygon' ? [it.geometry.coordinates] : it.geometry.coordinates;
        if (role === 'hole') polys[polys.length - 1].push(pts); else polys.push([pts]);
        it.geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
      } else {
        const lines = it.geometry.type === 'LineString' ? [it.geometry.coordinates] : it.geometry.coordinates;
        lines.push(pts); it.geometry = { type: 'MultiLineString', coordinates: lines };
      }
      continue;
    }
    const it = { geometry: closed ? { type: 'Polygon', coordinates: [pts] } : { type: 'LineString', coordinates: pts }, properties: attrs, id: ++n };
    if (fid != null) byFid.set(fid, it);
    list.push(it);
  }
  for (const w of doc.warnings || []) if (warnings.length < 3) warnings.push(`${w.entity}: ${w.reason}`);
  const units = doc.header && doc.header.units;
  const model = modelFromGeoFeatures(list, { format: 'dxf', warnings });
  if (units && units !== 'm') model.warnings.push(`drawing units: ${units}`);
  return model;
}

// ── the dispatcher: what is this file, as features? ─────────────────────────────────────────
export const FEATURE_EXT = /\.(geojson|json|wkt|shp|zip|kml|kmz)$/i;
// cheap, by name + a head read: 'geojson' | 'wkt' | 'shp' | 'zip-shp' | 'wkt-csv' | 'csv-strings' | 'kml' | 'kmz' | null
export async function featureKindOf(blob, name) {
  if (/\.shp$/i.test(name)) return 'shp';
  if (/\.kml$/i.test(name)) return 'kml';
  if (/\.kmz$/i.test(name)) return 'kmz';
  if (/\.(geojson)$/i.test(name)) return 'geojson';
  if (/\.wkt$/i.test(name)) return 'wkt';
  if (/\.json$/i.test(name)) { const h = await blob.slice(0, 4096).text(); return looksGeoJson(h) ? 'geojson' : null; }
  if (/\.zip$/i.test(name)) { try { return (await shapefilesInZip(blob)).length ? 'zip-shp' : null; } catch { return null; } }
  if (/\.(csv|txt|tsv|dat)$/i.test(name)) {
    const head = await blob.slice(0, 256 * 1024).text();
    if (sniffWktCsv(head)) return 'wkt-csv';
    if (sniffStringCsv(head)) return 'csv-strings';
  }
  return null;
}
// the whole file → a model, its CRS resolved and reprojected into `target` (the project's CRS —
// see resolveCrs). `parts` = loose shapefile siblings { dbf, prj, cpg }.
export async function readFeatureFile(blob, name, { kind = null, parts = null, assumeProjected = false, target = null } = {}) {
  kind = kind || await featureKindOf(blob, name);
  let model;
  if (kind === 'geojson') model = readGeoJson(await blob.text());
  else if (kind === 'kml' || kind === 'kmz') model = modelFromGeoFeatures(readKml(kind === 'kml' ? await blob.text() : await kmlInZip(blob, name)), { format: 'kml', crs: { kind: 'geographic', name: 'WGS 84', epsg: 4326 } });
  else if (kind === 'wkt') model = readWktText(await blob.text());
  else if (kind === 'wkt-csv') model = readWktCsv(await blob.text());
  else if (kind === 'csv-strings') model = readStringCsv(await blob.text());
  else if (kind === 'dxf') model = readDxfFeatures(await blob.text());
  else if (kind === 'shp') {
    const p = { shp: await u8(blob) };
    for (const [k, f] of Object.entries(parts || {})) if (f) p[k] = await u8(f);
    model = await readShapefileParts(p);
  } else if (kind === 'zip-shp') {
    const sets = await shapefilesInZip(blob);
    if (!sets.length) throw new Error(`${name}: no shapefile (.shp) in this zip`);
    model = await readShapefileParts(await sets[0].read());
    if (sets.length > 1) model.warnings.push(`${sets.length - 1} more shapefile${sets.length > 2 ? 's' : ''} in this zip not opened (${sets.slice(1).map((s) => s.base).join(', ')})`);
  } else if (/\.zip$/i.test(name)) throw new Error(`${name}: micro reads a .zip when it holds a shapefile (.shp + .dbf + .prj) — this one doesn't`);
  else if (/\.(dbf|prj|shx|cpg)$/i.test(name)) throw new Error(`${name} is one part of a shapefile — open it together with its .shp (and .dbf / .prj)`);
  else throw new Error(`${name}: not a strings / polygons file micro recognises`);
  await resolveCrs(model, name, { target, assumeProjected });
  if (!model.features.length && !(model.points && model.points.length)) throw new Error(`${name}: no lines or polygons in this file`);
  return model;
}

// ── writers ─────────────────────────────────────────────────────────────────────────────────
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(15)));
const fmtCell = (v) => (v === '' || v == null ? '' : typeof v === 'number' ? fmtNum(v) : String(v));
const quoteIf = (s, delim) => (/["\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s);
const wktOf = (f) => stringifyWkt(featureToGeometry(f), { precision: 4 });
// features (featuresOf shape) → WKT-CSV text. delim '\t' = the QGIS clipboard shape.
export function featuresToWktCsv(feats, columns, { delim = '\t' } = {}) {
  const lines = [['wkt_geom', ...columns].map((s) => quoteIf(s, delim)).join(delim)];
  for (const f of feats) {
    const cells = [wktOf(f), ...columns.map((c) => fmtCell(f.attrs[c]))];
    // QGIS's own clipboard text never quotes the WKT, even with commas in it (a tab table)
    lines.push(cells.map((s, i) => (delim === '\t' ? s.replace(/[\t\r\n]+/g, ' ') : quoteIf(s, delim))).join(delim));
  }
  return lines.join('\n') + '\n';
}
export function featuresToGeoJson(feats, columns, { crs = null, wgs84 = false } = {}) {
  const fc = { type: 'FeatureCollection', name: undefined };
  if (wgs84) { /* RFC 7946: longitude/latitude WGS 84, and no "crs" member */ }
  else if (crs && crs.epsg) fc.crs = { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${crs.epsg}` } };
  else fc.crs = { type: 'name', properties: { name: crs && crs.name ? String(crs.name) : 'urn:micro:projected' } };   // not WGS84: say so, or a reader assumes it
  fc.features = feats.map((f) => ({ type: 'Feature', id: f.id, properties: Object.fromEntries(columns.map((c) => [c, f.attrs[c] === '' ? null : f.attrs[c]])), geometry: featureToGeometry(f) }));
  delete fc.name;
  return JSON.stringify(fc) + '\n';
}
export async function featuresToShapefileZip(feats, columns, base, { prj = null } = {}) {
  const polys = feats.filter((f) => f.closed), lines = feats.filter((f) => !f.closed);
  const members = [];
  const put = (stem, list) => {
    const out = writeShapefile(list.map((f) => ({ geometry: featureToGeometry(f), properties: f.attrs })), { prj, fields: columns });
    members.push([`${stem}.shp`, out.shp], [`${stem}.shx`, out.shx], [`${stem}.dbf`, out.dbf], [`${stem}.cpg`, out.cpg]);
    if (out.prj) members.push([`${stem}.prj`, out.prj]);
  };
  if (polys.length && lines.length) { put(`${base}_polygons`, polys); put(`${base}_lines`, lines); }
  else put(base, polys.length ? polys : lines);
  return zipBlobOf(members);
}
const dxfLayerName = (v) => (String(v == null || v === '' ? '0' : v).replace(/[<>/\\":;?*|=`]/g, '_').slice(0, 255) || '0');
export function featuresToDxf(feats, columns, { catCol = null } = {}) {
  const features = [];
  feats.forEach((f, k) => {
    const layer = dxfLayerName(catCol ? f.attrs[catCol] : (f.attrs.LAYER != null ? f.attrs.LAYER : '0'));
    const attrs = columns.filter((c) => !(c === 'LAYER' && !catCol)).map((c) => ({ code: 1000, value: `${c}=${fmtCell(f.attrs[c])}`.slice(0, 255) }));
    const multi = f.rings.length > 1;
    const role = new Map(); f.parts.forEach((part) => part.forEach((ri, i) => role.set(ri, f.closed && i > 0 ? 'hole' : 'outer')));
    f.rings.forEach((r, ri) => {
      const items = [...(multi ? [{ code: 1000, value: `MICRO_FID=${k + 1}` }, { code: 1000, value: `MICRO_RING=${role.get(ri) || 'outer'}` }] : []), ...attrs];
      features.push({ type: 'polyline', geometry: { kind: 'polyline', vertices: Float64Array.from(r.flat()), bulges: null, closed: !!f.closed }, properties: { layer, xdata: { [XAPP]: items } } });
    });
  });
  return writeDxf({ header: { units: 'm' }, features, blocks: {}, layers: {} });
}
// a feature layer → { blob, name } in one of the formats ('wkt-csv' | 'wkt-tsv' | 'geojson' | 'shp' | 'dxf')
export const FEATURE_EXPORTS = [
  { id: 'wkt-csv', label: 'WKT-CSV (.csv — QGIS, PostGIS, spreadsheets)', ext: 'csv' },
  { id: 'geojson', label: 'GeoJSON (.geojson)', ext: 'geojson' },
  { id: 'shp', label: 'Shapefile (.zip — .shp .shx .dbf .prj)', ext: 'zip' },
  { id: 'dxf', label: 'DXF (.dxf — CAD, mine design packages)', ext: 'dxf' },
  { id: 'kml', label: 'KML (.kml — Google Earth, GPS; WGS 84 lon/lat)', ext: 'kml', lonlat: true },
  { id: 'geojson-wgs84', label: 'GeoJSON in lon/lat (.geojson — WGS 84, RFC 7946)', ext: 'geojson', lonlat: true },
];
// the CRS a feature layer's coordinates are in now: the project's when it was reprojected on read
// (or the file stated nothing), else what its file said
export async function featureLayerCrs(d, projectCrs = null) {
  const src = (d && d.source) || {};
  if (src.reprojected) return projectCrs;
  if (src.fileCrs) { try { return await crsFromJSON(src.fileCrs); } catch { return projectCrs; } }
  return projectCrs;
}
// features → copies in WGS 84 lon/lat (z carried)
export function featuresToLonLat(feats, from) {
  const pts = [];
  for (const f of feats) for (const r of f.rings) for (const p of r) pts.push(p);
  const t = transformer(from, WGS84, { at: whereOf(from, pts) });
  return feats.map((f) => ({ ...f, rings: f.rings.map((r) => r.map((p) => { const q = t.forward(p); return [q[0], q[1], p[2] || 0]; })) }));
}
export async function buildFeatureExport(L, format, { selectedOnly = false, name = null, projectCrs = null } = {}) {
  const d = featureDocOf(L);
  if (!d) throw new Error(`${L.label || L.name} is not a strings & polygons layer`);
  const records = selectedOnly && L._selMask && L._selCount ? L._selMask : null;
  const feats = featuresOf(L, { records });
  if (!feats.length) throw new Error('no features to export');
  const columns = d.header.columns;
  const base = (name || (L.label || L.name)).replace(/\.(zip|shp|geojson|json|wkt|csv|txt|tsv|dxf|kml|kmz)$/i, '').replace(/[^\w.-]+/g, '_') || 'features';
  const lcrs = await featureLayerCrs(d, projectCrs);
  const reproj = !!(d.source && d.source.reprojected);
  const crs = lcrs && lcrs.epsg ? { epsg: lcrs.epsg, name: lcrs.name } : lcrs ? { name: lcrs.name } : (d.source && d.source.crs);
  const needLonLat = () => { if (!lcrs) throw new Error('these coordinates have no coordinate system — set the project\'s (the CRS chip in the status bar) to export longitude/latitude'); return featuresToLonLat(feats, lcrs); };
  if (format === 'wkt-csv') return { blob: new Blob([featuresToWktCsv(feats, columns, { delim: ',' })], { type: 'text/csv' }), name: `${base}.csv` };
  if (format === 'wkt-tsv') return { blob: new Blob([featuresToWktCsv(feats, columns, { delim: '\t' })], { type: 'text/tab-separated-values' }), name: `${base}.tsv` };
  if (format === 'geojson') return { blob: new Blob([featuresToGeoJson(feats, columns, { crs })], { type: 'application/geo+json' }), name: `${base}.geojson` };
  if (format === 'geojson-wgs84') return { blob: new Blob([featuresToGeoJson(needLonLat(), columns, { wgs84: true })], { type: 'application/geo+json' }), name: `${base}.wgs84.geojson` };
  if (format === 'kml') {
    const ll = needLonLat();
    const items = ll.map((f) => ({ attrs: f.attrs, geometry: featureToGeometry(f) }));
    return { blob: new Blob([featuresToKml(items, { name: L.label || L.name, z: d.header.bbox && (d.header.bbox.max[2] !== 0 || d.header.bbox.min[2] !== 0) })], { type: 'application/vnd.google-earth.kml+xml' }), name: `${base}.kml` };
  }
  // a reprojected layer's .prj would be the ORIGINAL file's — wrong now: none is written (micro
  // carries EPSG codes, not WKT; the project's system is said in the note)
  if (format === 'shp') return { blob: await featuresToShapefileZip(feats, columns, base, { prj: reproj ? null : d.source && d.source.prj }), name: `${base}.zip`, note: reproj && lcrs ? `no .prj written — the features were reprojected to ${crsLabel(lcrs)}; set that in the reading software` : null };
  if (format === 'dxf') {
    const cat = d.header.mapping.cat != null ? d.header.columns[d.header.mapping.cat] : null;
    return { blob: new Blob([featuresToDxf(feats, columns, { catCol: cat })], { type: 'application/dxf' }), name: `${base}.dxf` };
  }
  throw new Error(`unknown feature export format “${format}”`);
}
