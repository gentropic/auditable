// micro POLYGONS — strings and polygons as DATA: one layer kind for both, whose records are
// FEATURES (a pit limit, a lease, a blast polygon, a mapped contact) carrying an attribute TABLE.
//
// ── THE MODEL ───────────────────────────────────────────────────────────────────────────────
// A feature layer is a strings layer (L.docs.stringsDoc, drawn as sticks — capsules — like a DXF
// strings layer) whose doc carries `features` + `rows`. Record r IS feature r: every segment of
// that feature's rings is drawn under record r, so pick, the record panel, the attribute table,
// the filter, the selection and colour-by-a-column all address features. (A DXF strings layer
// opened the old way stays segment-addressed; "Open as → strings & polygons" reads the same DXF
// as features.)
//
//   doc.features[r] = {
//     id,                     the source's own id (a shapefile record no., GeoJSON id, CSV string id)
//     kind: 'polygon'|'line',
//     rings: [[[x, y, z], …], …]  world coordinates. A polygon's rings do NOT repeat the first vertex.
//     parts: [[ringIdx, …], …]    polygon: one entry per polygon part — its OUTER ring first, then its
//                                 holes (a MultiPolygon has several parts). line: one ring per part.
//     closed: boolean          true for polygons
//   }
//   doc.rows[r]   = attribute values aligned to header.columns (numbers as numbers, '' = blank)
//   doc.header    = { kind:'strings', features:true, format, count, columns, numericColumns,
//                     mapping:{ chan, cat }, categories, bbox, crs, … }
//   doc.source    = { format, crs:{kind,name,epsg?}|null, prj } — what the file said
//
// ── THE API (what wave 4b's polygon-as-limit scopes and extrusion consume) ───────────────────
//   isPolygonLayer(L) → boolean                      a feature layer (strings and/or polygons)
//   featuresOf(L, { closedOnly = false, records = null }) →
//       [{ id, rec, kind, rings, parts, closed, attrs: { column: value } }]
//       rings/parts are the layer's own arrays — READ-ONLY. `records` (a Uint8Array mask, e.g.
//       L._selMask) keeps only those features.
//   pointInPolygonXY(feature, x, y) → boolean       plan-view (x, y) containment, even-odd over ALL
//       rings (holes and multipolygon parts fall out of the parity). A line → false. A bbox test
//       first; the result for a feature is cached on it as `_bbox`.
//   preparePolygons(features, { bands }) → P         for MANY points (a block model's centroids):
//       P.contains(x, y) → boolean (inside ANY)      each polygon pre-sorted into horizontal edge
//       P.which(x, y)    → index into features, -1   bands, so a query tests only the edges of its
//       P.mask(xs, ys, n, out?) → Uint8Array         band (bbox → band → crossings). Holes and
//       P.bbox → [x0, y0, x1, y1]                    multipolygons as above. `which` returns the
//                                                    first containing feature in list order.
//   polygonAreaXY(feature) → plan area (holes subtracted, parts summed)
//   ringArea(ring) → signed plan area (positive = counter-clockwise)
// Everything is plan-view (x, y): the z of a ring is carried for drawing, export and extrusion,
// never used by containment.
//
// The layer plumbing (build/rebuild the drawn chunks, the optional FILL as a mesh chunk on the
// same layer, a new category column, edits) is below the API.
import { S, layerById, requestRender } from './state.js';
import { createStickChunkBuilder, buildMeshChunk, categoryPalettePixels } from '../../../ext/condenser/src/main.js';
import { triangulateRings } from '../../../ext/geometry/index.js';

// ── the API ────────────────────────────────────────────────────────────────────────────────
export const isPolygonLayer = (L) => !!(L && L.docs && L.docs.stringsDoc && L.docs.stringsDoc.features);
export const featureDocOf = (L) => (isPolygonLayer(L) ? L.docs.stringsDoc : null);

export function featuresOf(L, { closedOnly = false, records = null } = {}) {
  const d = featureDocOf(L);
  if (!d) return [];
  const cols = d.header.columns, out = [];
  d.features.forEach((f, rec) => {
    if (closedOnly && !f.closed) return;
    if (records && !(rec < records.length && records[rec])) return;
    const row = d.rows[rec] || [], attrs = {};
    cols.forEach((c, i) => { attrs[c] = row[i] === undefined ? '' : row[i]; });
    out.push({ id: f.id, rec, kind: f.kind, rings: f.rings, parts: f.parts, closed: f.closed, attrs });
  });
  return out;
}

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s / 2;
}
export function polygonAreaXY(f) {
  if (!f.closed) return 0;
  let a = 0;
  for (const part of f.parts) part.forEach((ri, k) => { const v = Math.abs(ringArea(f.rings[ri])); a += k === 0 ? v : -v; });
  return a;
}
export function featureBBox(f) {
  if (f._bbox) return f._bbox;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of f.rings) for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  Object.defineProperty(f, '_bbox', { value: [x0, y0, x1, y1], enumerable: false, configurable: true, writable: true });
  return f._bbox;
}
export function pointInPolygonXY(f, x, y) {
  if (!f || !f.closed) return false;
  const b = featureBBox(f);
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let inside = false;
  for (const r of f.rings) {
    for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const yi = r[i][1], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (r[j][0] - r[i][0]) * (y - yi) / (yj - yi) + r[i][0]) inside = !inside;
    }
  }
  return inside;
}

// one polygon → its edges in horizontal bands: a query walks only its band's edges
function prepareOne(f, bandsWanted) {
  const b = featureBBox(f);
  let ne = 0;
  for (const r of f.rings) ne += r.length;
  const ex0 = new Float64Array(ne), ey0 = new Float64Array(ne), ex1 = new Float64Array(ne), ey1 = new Float64Array(ne);
  let e = 0;
  for (const r of f.rings) for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
    ex0[e] = r[j][0]; ey0[e] = r[j][1]; ex1[e] = r[i][0]; ey1[e] = r[i][1]; e++;
  }
  const B = Math.max(1, Math.min(bandsWanted || Math.ceil(Math.sqrt(ne)), 4096));
  const h = (b[3] - b[1]) / B || 1;
  const counts = new Int32Array(B + 1);
  const bandOf = (y) => Math.max(0, Math.min(B - 1, Math.floor((y - b[1]) / h)));
  for (let k = 0; k < ne; k++) { const lo = bandOf(Math.min(ey0[k], ey1[k])), hi = bandOf(Math.max(ey0[k], ey1[k])); for (let q = lo; q <= hi; q++) counts[q + 1]++; }
  for (let q = 0; q < B; q++) counts[q + 1] += counts[q];
  const list = new Int32Array(counts[B]), at = counts.slice(0, B);
  for (let k = 0; k < ne; k++) { const lo = bandOf(Math.min(ey0[k], ey1[k])), hi = bandOf(Math.max(ey0[k], ey1[k])); for (let q = lo; q <= hi; q++) list[at[q]++] = k; }
  return {
    bbox: b,
    contains(x, y) {
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
      const q = bandOf(y);
      let inside = false;
      for (let s = counts[q], t = counts[q + 1]; s < t; s++) {
        const k = list[s], yi = ey1[k], yj = ey0[k];
        if ((yi > y) !== (yj > y) && x < (ex0[k] - ex1[k]) * (y - yi) / (yj - yi) + ex1[k]) inside = !inside;
      }
      return inside;
    },
  };
}
export function preparePolygons(features, { bands = 0 } = {}) {
  const items = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  features.forEach((f, i) => {
    if (!f || !f.closed) return;
    const P = prepareOne(f, bands);
    items.push([i, P]);
    if (P.bbox[0] < x0) x0 = P.bbox[0]; if (P.bbox[1] < y0) y0 = P.bbox[1];
    if (P.bbox[2] > x1) x1 = P.bbox[2]; if (P.bbox[3] > y1) y1 = P.bbox[3];
  });
  const which = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return -1;
    for (const [i, P] of items) if (P.contains(x, y)) return i;
    return -1;
  };
  return {
    bbox: [x0, y0, x1, y1], count: items.length,
    which, contains: (x, y) => which(x, y) >= 0,
    mask(xs, ys, n = xs.length, out = new Uint8Array(n)) { for (let i = 0; i < n; i++) out[i] = which(xs[i], ys[i]) >= 0 ? 1 : 0; return out; },
  };
}

// ── normalising geometry into features ─────────────────────────────────────────────────────
const num3 = (p) => [+p[0], +p[1], p.length > 2 && Number.isFinite(+p[2]) ? +p[2] : 0];
const samePt = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
// a ring without its repeated closing vertex, and without consecutive duplicates
export function cleanRing(ring, closed) {
  const out = [];
  for (const p of ring) { const q = num3(p); if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue; if (!out.length || !samePt(out[out.length - 1], q)) out.push(q); }
  if (closed && out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
// a GeoJSON-shaped geometry → feature geometry ({ kind, rings, parts, closed }), or a list of them
// for a GeometryCollection, or null (points are not strings — the caller collects them)
export function geometryToFeature(g) {
  if (!g || !g.type) return null;
  if (g.type === 'GeometryCollection') return (g.geometries || []).map(geometryToFeature).flat().filter(Boolean);
  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).map((r) => cleanRing(r || [], false)).filter((r) => r.length >= 2);
    if (!lines.length) return null;
    return { kind: 'line', rings: lines, parts: lines.map((_, i) => [i]), closed: false };
  }
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const rings = [], parts = [];
    for (const poly of polys || []) {
      const part = [];
      (poly || []).forEach((r, k) => {
        const c = cleanRing(r || [], true);
        if (c.length < 3) return;
        if (k > 0 && !part.length) return;              // a hole without its outer ring
        part.push(rings.length); rings.push(c);
      });
      if (part.length) parts.push(part);
    }
    if (!parts.length) return null;
    return { kind: 'polygon', rings, parts, closed: true };
  }
  return null;
}
// back: a feature → a GeoJSON-shaped geometry (rings closed again, as WKT / GeoJSON / shapefiles want)
export function featureToGeometry(f) {
  const close = (r) => (r.length ? [...r, r[0]] : r);
  if (f.kind === 'line') return f.rings.length === 1 ? { type: 'LineString', coordinates: f.rings[0] } : { type: 'MultiLineString', coordinates: f.rings };
  const polys = f.parts.map((part) => part.map((ri) => close(f.rings[ri])));
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

// ── the header: columns, types, the category column ────────────────────────────────────────
const isNumVal = (v) => typeof v === 'number' && Number.isFinite(v);
export function featureHeader(model, { catCol = null, chanCol = null } = {}) {
  const { columns, rows, features } = model;
  const numericColumns = [];
  columns.forEach((name, i) => {
    let any = false, all = true;
    for (const r of rows) { const v = r[i]; if (v === '' || v == null) continue; any = true; if (!isNumVal(v)) { all = false; break; } }
    if (any && all) numericColumns.push({ i, name });
  });
  const numSet = new Set(numericColumns.map((c) => c.i));
  // the category: the asked column, else the first TEXT column with 1..255 distinct values
  const distinct = (i) => { const s = new Set(); for (const r of rows) { s.add(String(r[i] === undefined ? '' : r[i])); if (s.size > 255) return null; } return s; };
  let cat = catCol != null ? columns.indexOf(catCol) : -1;
  if (cat < 0 && catCol == null) for (let i = 0; i < columns.length; i++) { if (numSet.has(i)) continue; const s = distinct(i); if (s && s.size >= 1) { cat = i; break; } }
  let categories = null;
  if (cat >= 0) { const s = distinct(cat); if (s) categories = [...s]; else cat = -1; }
  const chan = chanCol != null && columns.indexOf(chanCol) >= 0 && numSet.has(columns.indexOf(chanCol)) ? columns.indexOf(chanCol) : null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, segs = 0;
  for (const f of features) for (const r of f.rings) {
    segs += f.closed ? r.length : r.length - 1;
    for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
  }
  if (x0 === Infinity) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 1; }
  return {
    kind: 'strings', features: true, format: model.format || 'features',
    count: features.length, strings: features.length, segments: segs,
    polygons: features.filter((f) => f.closed).length,
    columns: [...columns], numericColumns,
    mapping: { chan, cat: cat >= 0 ? cat : null },
    categories, chanRange: [0, 0],
    bbox: { min: [x0, y0, z0], max: [x1, y1, z1] },
    crs: model.crs || null,
  };
}

// ── drawing: sticks for the rings, an optional fill mesh on the same layer ──────────────────
const radiusFor = (h) => {
  const d = Math.hypot(h.bbox.max[0] - h.bbox.min[0], h.bbox.max[1] - h.bbox.min[1]);
  return Math.max(0.05, Math.min(10, d / 600 || 0.5));
};
export const defaultStickRadius = radiusFor;
// one feature's category code / channel value
function catCodeOf(d, rec) {
  const h = d.header, ci = h.mapping.cat;
  if (ci == null || !h.categories) return 0;
  if (!d._catIndex || d._catIndex.h !== h) d._catIndex = { h, m: new Map(h.categories.map((v, i) => [v, i])) };
  const v = d.rows[rec] ? d.rows[rec][ci] : '';
  const k = d._catIndex.m.get(String(v === undefined ? '' : v));
  return k == null ? 0 : k;
}
function chanOf(d, rec) {
  const ci = d.header.mapping.chan;
  if (ci == null) return 0;
  const v = d.rows[rec] ? d.rows[rec][ci] : '';
  return isNumVal(v) ? v : 0;
}
const PALETTE = categoryPalettePixels(256);
function fillColorOf(L, d, rec) {
  const h = d.header;
  if (h.categories && String(L.colorSel) === 'cat') {
    const code = catCodeOf(d, rec), val = h.categories[code];
    const ent = L.catLegend && L.catLegend.entries && L.catLegend.entries.find((e) => e.values && e.values.includes(val));
    if (ent && /^#[0-9a-f]{6}$/i.test(ent.color)) { const n = parseInt(ent.color.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    return [PALETTE[code * 4] / 255, PALETTE[code * 4 + 1] / 255, PALETTE[code * 4 + 2] / 255];
  }
  const t = L.fillColor || '#c89b3c', n = parseInt(t.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// (re)build a feature layer's chunks from its resident features — the open, every edit, a new
// category column, the fill toggled. The layer's renderer state (filter, selection, ramp,
// categories, stick radius) is kept: only its chunks are replaced.
export function renderFeatureLayer(L) {
  const d = featureDocOf(L); if (!d || !S.renderer) return;
  const lid = L.id;
  if (S.renderer.clearLayerChunks) S.renderer.clearLayerChunks(lid);
  let n = 0;
  for (const f of d.features) for (const r of f.rings) n += f.closed ? r.length : Math.max(0, r.length - 1);
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n), bz = new Float64Array(n);
  const mx = new Float64Array(n), my = new Float64Array(n), mz = new Float64Array(n), chan = new Float64Array(n), cat = new Uint8Array(n), recIdx = new Uint32Array(n);
  let w = 0;
  d.features.forEach((f, rec) => {
    const code = catCodeOf(d, rec), val = chanOf(d, rec);
    for (const r of f.rings) {
      const m = f.closed ? r.length : r.length - 1;
      for (let i = 0; i < m; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
        ax[w] = a[0]; ay[w] = a[1]; az[w] = a[2]; bx[w] = b[0]; by[w] = b[1]; bz[w] = b[2];
        mx[w] = (a[0] + b[0]) / 2; my[w] = (a[1] + b[1]) / 2; mz[w] = (a[2] + b[2]) / 2;
        chan[w] = val; cat[w] = code; recIdx[w] = rec; w++;
      }
    }
  });
  let bbox = null;
  if (w) {
    const cb = createStickChunkBuilder({ frame: S.frame, chunkSize: 1 << 16, batchSize: 1 << 20, seed: 1, onChunk: (c) => S.renderer.addChunk(c, 'base', lid) });
    const sub = (a) => a.subarray(0, w);
    cb.push({ count: w, ax: sub(ax), ay: sub(ay), az: sub(az), bx: sub(bx), by: sub(by), bz: sub(bz), x: sub(mx), y: sub(my), z: sub(mz), chan: sub(chan), cat: sub(cat), recIdx: sub(recIdx) });
    bbox = cb.flush().bboxLocal;
  }
  if (L.polyFill) {
    const verts = [], tris = [], cols = [];
    const keep = L._filterMask && L.filterExpr ? L._filterMask : null;   // a filtered-out feature's fill goes with its lines
    d.features.forEach((f, rec) => {
      if (!f.closed || (keep && !keep[rec])) return;
      const rgb = fillColorOf(L, d, rec);
      for (const part of f.parts) {
        const t = triangulateRings(part.map((ri) => f.rings[ri]));
        const base = verts.length / 3;
        for (let i = 0; i < t.vertices.length; i++) verts.push(t.vertices[i]);
        for (let i = 0; i < t.triangles.length; i++) tris.push(base + t.triangles[i]);
        for (let i = 0; i < t.vertices.length / 3; i++) cols.push(rgb[0], rgb[1], rgb[2]);
      }
    });
    if (tris.length) {
      const chunk = buildMeshChunk({ vertices: Float64Array.from(verts), triangles: Uint32Array.from(tris), frame: S.frame });
      chunk.color = Float32Array.from(cols);
      S.renderer.addChunk(chunk, 'base', lid);
      if (!bbox) bbox = chunk.bboxLocal;
    }
    S.renderer.setLayerMeshStyle(lid, { opacity: L.fillOpacity != null ? L.fillOpacity : 0.55 });
  }
  if (S.renderer.setLayerPickable) S.renderer.setLayerPickable(lid, false);   // the fill never takes a pick: the features (sticks) do
  if (bbox) L.bboxLocal = bbox;
  requestRender();
}

// header + chunks after the features or rows changed (an edit, a paste into the layer)
export function refreshFeatureLayer(L, { catCol } = {}) {
  const d = featureDocOf(L); if (!d) return;
  const h0 = d.header;
  const keepCat = catCol !== undefined ? catCol : (h0.mapping.cat != null ? h0.columns[h0.mapping.cat] : null);
  const keepChan = h0.mapping.chan != null ? h0.columns[h0.mapping.chan] : null;
  const h = featureHeader({ columns: h0.columns, rows: d.rows, features: d.features, format: h0.format, crs: h0.crs }, { catCol: keepCat, chanCol: keepChan });
  if (keepCat == null) { h.mapping.cat = null; h.categories = null; }
  d.header = h;
  d._catIndex = null;
  S.renderer.setLayerCats(L.id, h.categories ? 256 : 0);
  if (h.categories) S.renderer.setCategories(1);
  renderFeatureLayer(L);
  return h;
}

// a text column becomes the category (colour classes, eyes) — a rebuild, no re-read
export function setFeatureCategory(L, name) {
  const d = featureDocOf(L); if (!d) return false;
  const i = d.header.columns.indexOf(name);
  if (i < 0) throw new Error(`no column “${name}” on “${L.label || L.name}”`);
  L.catHidden = null; L.catLegend = null;
  refreshFeatureLayer(L, { catCol: name });
  return !!d.header.categories;
}
export function setFeatureFill(L, on, { opacity } = {}) {
  if (!isPolygonLayer(L)) return;
  L.polyFill = !!on;
  if (opacity != null) L.fillOpacity = Math.max(0.05, Math.min(1, +opacity));
  renderFeatureLayer(L);
}

// what a project keeps of a feature layer's display (the file keeps the features): the
// category column, the fill, the line half-width
export function polyStateOf(L) {
  const d = featureDocOf(L); if (!d) return undefined;
  const h = d.header, r = S.renderer ? S.renderer.layerStickRadius(L.id) : null;
  return {
    cat: h.mapping.cat != null ? h.columns[h.mapping.cat] : null,
    fill: !!L.polyFill || undefined,
    fillOpacity: L.fillOpacity != null ? L.fillOpacity : undefined,
    fillColor: L.fillColor || undefined,
    radius: r || undefined,
  };
}

// a feature's plan centroid (area-weighted for polygons, the vertex mean for lines) — the
// record panel's "where", and the label anchor
export function featureCentroid(f) {
  if (f.closed && f.parts.length) {
    let A = 0, cx = 0, cy = 0, zs = 0, zn = 0;
    for (const part of f.parts) part.forEach((ri, k) => {
      const r = f.rings[ri], sg = k === 0 ? 1 : -1;
      for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
        const c = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        A += sg * c; cx += sg * (r[j][0] + r[i][0]) * c; cy += sg * (r[j][1] + r[i][1]) * c;
        zs += r[i][2]; zn++;
      }
    });
    if (Math.abs(A) > 1e-12) return [cx / (3 * A), cy / (3 * A), zn ? zs / zn : 0];
  }
  let x = 0, y = 0, z = 0, k = 0;
  for (const r of f.rings) for (const p of r) { x += p[0]; y += p[1]; z += p[2]; k++; }
  return k ? [x / k, y / k, z / k] : [0, 0, 0];
}

// the doc a feature layer carries (records = features)
export function makeFeatureDoc(model, blob, name, opts = {}) {
  const header = featureHeader(model, opts);
  const doc = {
    blob, name, header,
    features: model.features, rows: model.rows,
    source: { format: model.format || 'features', crs: model.crs || null, prj: model.prj || null, srid: model.srid || null },
    fetchRecord: (rec) => (doc.rows[rec] ? doc.rows[rec].map((v) => (v === undefined ? '' : v)) : null),
    recordPosition: (rec) => (doc.features[rec] ? featureCentroid(doc.features[rec]) : [0, 0, 0]),
  };
  return doc;
}

try { window._microPoly = Object.assign(window._microPoly || {}, { isPolygonLayer, featuresOf, pointInPolygonXY, preparePolygons, polygonAreaXY, ringArea }); } catch { /* headless */ }
