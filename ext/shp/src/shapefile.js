// @gcu/shp shapefile — the .shp + .dbf + .prj (+ .cpg) set as one thing: features.
//
//   readShapefile({ shp, dbf?, prj?, cpg? }) → { shapeType, typeName, bbox, fields, crs, prj,
//       features: [{ geometry, properties }], warnings }
//   writeShapefile(features, { prj?, fields? }) → { shp, shx, dbf, cpg, prj? }  (Uint8Arrays / text)
//
// Bytes in, bytes out — no files, no zip, no network: the caller finds the parts (loose, or
// in a .zip it opened) and decides what to do with a geographic `crs`. Record i of the .shp
// pairs with row i of the .dbf; a .dbf with fewer rows leaves the rest without attributes.

import { readShp, writeShp } from './shape.js';
import { readDbf, writeDbf, dbfFields } from './dbf.js';
import { prjInfo } from './prj.js';

const text = (v) => (v == null ? null : typeof v === 'string' ? v : new TextDecoder('utf-8').decode(v instanceof Uint8Array ? v : new Uint8Array(v)));

export function readShapefile({ shp, dbf = null, prj = null, cpg = null }) {
  if (!shp) throw new Error('shp: the .shp file is missing');
  const g = readShp(shp);
  const encoding = cpg ? (text(cpg).trim() || null) : null;
  const t = dbf ? readDbf(dbf, { encoding: encoding && /^(utf-?8|65001)$/i.test(encoding) ? 'utf-8' : encoding }) : { fields: [], rows: [] };
  const warnings = [...g.warnings];
  if (dbf && t.rows.length !== g.geometries.length) warnings.push(`the .dbf has ${t.rows.length} rows for ${g.geometries.length} shapes`);
  const prjText = text(prj);
  const features = g.geometries.map((geometry, i) => ({ geometry, properties: t.rows[i] || {} }));
  return {
    shapeType: g.shapeType, typeName: g.typeName, bbox: g.bbox,
    fields: t.fields, features,
    prj: prjText, crs: prjText ? prjInfo(prjText) : null,
    warnings,
  };
}

// features: [{ geometry, properties }] — one geometry family for the whole set (the format's
// rule). `fields` (optional) fixes the attribute order: [name, …]; default = every property
// key in first-seen order.
export function writeShapefile(features, { prj = null, fields = null } = {}) {
  const geoms = features.map((f) => f.geometry || null);
  const { shp, shx } = writeShp(geoms);
  const rows = features.map((f) => f.properties || {});
  const fdefs = dbfFields(rows, fields);
  const dbf = writeDbf(rows, fdefs);
  const out = { shp, shx, dbf, cpg: 'UTF-8', fields: fdefs.map((f) => ({ key: f.key, name: f.name, type: f.type, length: f.length, decimals: f.decimals })) };
  if (prj) out.prj = String(prj);
  return out;
}
