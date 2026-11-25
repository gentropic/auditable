// @gcu/shp shape — the .shp geometry file (and its .shx index), ESRI Shapefile Technical
// Description (1998).
//
//   readShp(bytes) → { shapeType, typeName, bbox: [xmin, ymin, zmin, xmax, ymax, zmax],
//                      geometries: [GeoJSON-shaped geometry | null], warnings }
//   writeShp(geometries, { shapeType? }) → { shp: Uint8Array, shx: Uint8Array, shapeType }
//   ringArea(ring) → signed xy area (positive = counter-clockwise)
//
// Geometry is GeoJSON-shaped ({ type, coordinates }) — Point / MultiPoint / LineString /
// MultiLineString / Polygon / MultiPolygon — with z in the third place for the Z types and
// the measure (M) dropped (a measure is not a coordinate). A Null shape reads as null.
//
// Polygon rings: a shapefile stores rings flat; OUTER rings run clockwise and HOLES counter-
// clockwise. Reading reassembles them — each hole goes to the smallest outer ring that
// contains it — into a Polygon (one outer) or a MultiPolygon (several). Files that ignore
// the winding rule (some writers do) still read: a ring that no clockwise ring contains is
// taken as an outer ring whatever its winding. Writing enforces the rule.
// MultiPatch (31) is not read (a warning, the record becomes null).

const TYPE_NAME = {
  0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint',
  11: 'PointZ', 13: 'PolyLineZ', 15: 'PolygonZ', 18: 'MultiPointZ',
  21: 'PointM', 23: 'PolyLineM', 25: 'PolygonM', 28: 'MultiPointM', 31: 'MultiPatch',
};
const BASE = (t) => (t === 0 ? 0 : t === 31 ? 31 : t % 10);   // 1 point · 3 line · 5 polygon · 8 multipoint
const HAS_Z = (t) => t >= 11 && t <= 18;

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s / 2;                                             // > 0: counter-clockwise (y up)
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// flat rings → polygons: outers (clockwise) take the holes (counter-clockwise) they contain
export function assembleRings(rings) {
  const outers = [], holes = [];
  for (const r of rings) { if (r.length < 3) continue; (ringArea(r) <= 0 ? outers : holes).push(r); }
  const polys = outers.map((o) => ({ outer: o, area: Math.abs(ringArea(o)), holes: [] }));
  for (const h of holes) {
    let best = null;
    for (const p of polys) {
      if (!pointInRing(h[0][0], h[0][1], p.outer) && !(h.length > 1 && pointInRing((h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2, p.outer))) continue;
      if (!best || p.area < best.area) best = p;
    }
    if (best) best.holes.push(h);
    else polys.push({ outer: h, area: Math.abs(ringArea(h)), holes: [] });   // a counter-clockwise outer: the writer ignored the rule
  }
  return polys.map((p) => [p.outer, ...p.holes]);
}

export function readShp(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 100) throw new Error('shp: too short to be a shapefile');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getInt32(0, false) !== 9994) throw new Error('shp: not a shapefile (bad file code)');
  const shapeType = dv.getInt32(32, true);
  const fileLen = Math.min(b.length, dv.getInt32(24, false) * 2);
  const bbox = [dv.getFloat64(36, true), dv.getFloat64(44, true), dv.getFloat64(68, true), dv.getFloat64(52, true), dv.getFloat64(60, true), dv.getFloat64(76, true)];
  const geometries = [], warnings = [];
  let p = 100;
  while (p + 8 <= fileLen) {
    const len = dv.getInt32(p + 4, false) * 2;
    const c = p + 8;
    p = c + len;
    if (len < 4 || p > b.length) { if (p > b.length) warnings.push('a truncated last record was dropped'); break; }
    const t = dv.getInt32(c, true);
    const base = BASE(t), z = HAS_Z(t);
    if (t === 0) { geometries.push(null); continue; }
    if (base === 31) { geometries.push(null); if (!warnings.includes('MultiPatch records are not read')) warnings.push('MultiPatch records are not read'); continue; }
    if (base === 1) {
      const pt = [dv.getFloat64(c + 4, true), dv.getFloat64(c + 12, true)];
      if (z) pt.push(dv.getFloat64(c + 20, true));
      geometries.push({ type: 'Point', coordinates: pt });
      continue;
    }
    if (base === 8) {
      const n = dv.getInt32(c + 36, true);
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([dv.getFloat64(c + 40 + i * 16, true), dv.getFloat64(c + 48 + i * 16, true)]);
      if (z) { const zo = c + 40 + n * 16 + 16; for (let i = 0; i < n; i++) pts[i].push(dv.getFloat64(zo + i * 8, true)); }
      geometries.push({ type: 'MultiPoint', coordinates: pts });
      continue;
    }
    if (base === 3 || base === 5) {
      const np = dv.getInt32(c + 36, true), n = dv.getInt32(c + 40, true);
      const partsAt = c + 44, ptsAt = partsAt + np * 4;
      const pts = new Array(n);
      for (let i = 0; i < n; i++) pts[i] = [dv.getFloat64(ptsAt + i * 16, true), dv.getFloat64(ptsAt + i * 16 + 8, true)];
      if (z) { const zo = ptsAt + n * 16 + 16; for (let i = 0; i < n; i++) pts[i].push(dv.getFloat64(zo + i * 8, true)); }
      const parts = [];
      for (let k = 0; k < np; k++) {
        const s = dv.getInt32(partsAt + k * 4, true), e = k + 1 < np ? dv.getInt32(partsAt + (k + 1) * 4, true) : n;
        if (e > s) parts.push(pts.slice(s, e));
      }
      if (base === 3) geometries.push(parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts });
      else {
        const polys = assembleRings(parts);
        geometries.push(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
      }
      continue;
    }
    geometries.push(null);
    warnings.push(`shape type ${t} is not a shapefile type`);
  }
  return { shapeType, typeName: TYPE_NAME[shapeType] || `type ${shapeType}`, bbox, geometries, warnings };
}

// ── writing ───────────────────────────────────────────────────────────────────
const KIND = { Point: 1, MultiPoint: 8, LineString: 3, MultiLineString: 3, Polygon: 5, MultiPolygon: 5 };
const is3d = (g) => {
  let c = g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && c.length >= 3;
};
// the one shape type a set of geometries can share (a shapefile holds one type)
export function shapeTypeOf(geometries) {
  let base = 0, z = false;
  for (const g of geometries) {
    if (!g) continue;
    const k = KIND[g.type];
    if (!k) throw new Error(`shp: a shapefile can't hold a ${g.type}`);
    if (base && base !== k) throw new Error('shp: a shapefile holds ONE geometry type — points, lines or polygons, not a mix');
    base = k; if (is3d(g)) z = true;
  }
  if (!base) return 0;
  return z ? base + 10 : base;
}
const closeRing = (r) => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);
// the shapefile winding: outer clockwise, holes counter-clockwise
const orient = (r, cw) => ((ringArea(r) < 0) === cw ? r : r.slice().reverse());

function partsOf(g) {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const out = [];
  for (const poly of polys) poly.forEach((r, i) => { if (r.length >= 3) out.push(orient(closeRing(r), i === 0)); });
  return out;
}

export function writeShp(geometries, { shapeType = null } = {}) {
  const st = shapeType != null ? shapeType : shapeTypeOf(geometries);
  const base = BASE(st), z = HAS_Z(st);
  // content bytes per record
  const recs = geometries.map((g) => {
    if (!g || !st) return { bytes: 4, g: null };
    if (base === 1) return { bytes: z ? 36 : 20, g };
    if (base === 8) { const n = g.type === 'Point' ? 1 : g.coordinates.length; return { bytes: 40 + n * 16 + (z ? 16 + n * 8 + 16 + n * 8 : 0), g, n }; }
    const parts = partsOf(g), n = parts.reduce((s, r) => s + r.length, 0);
    return { bytes: 44 + parts.length * 4 + n * 16 + (z ? 16 + n * 8 + 16 + n * 8 : 0), g, parts, n };
  });
  const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.bytes, 0), shxLen = 100 + recs.length * 8;
  const shp = new Uint8Array(shpLen), shx = new Uint8Array(shxLen);
  const S = new DataView(shp.buffer), X = new DataView(shx.buffer);
  // bounds over everything
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const visit = (c) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); const zz = c.length > 2 ? c[2] : 0; z0 = Math.min(z0, zz); z1 = Math.max(z1, zz); } else c.forEach(visit); };
  for (const g of geometries) if (g) visit(g.coordinates);
  if (x0 === Infinity) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
  const header = (dv, len) => {
    dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, st, true);
    dv.setFloat64(36, x0, true); dv.setFloat64(44, y0, true); dv.setFloat64(52, x1, true); dv.setFloat64(60, y1, true);
    dv.setFloat64(68, z ? z0 : 0, true); dv.setFloat64(76, z ? z1 : 0, true);
  };
  header(S, shpLen); header(X, shxLen);
  let p = 100;
  recs.forEach((r, i) => {
    X.setInt32(100 + i * 8, p / 2, false); X.setInt32(104 + i * 8, r.bytes / 2, false);
    S.setInt32(p, i + 1, false); S.setInt32(p + 4, r.bytes / 2, false);
    const c = p + 8;
    p = c + r.bytes;
    if (!r.g) { S.setInt32(c, 0, true); return; }
    S.setInt32(c, st, true);
    const g = r.g;
    if (base === 1) {
      const pt = g.type === 'Point' ? g.coordinates : g.coordinates[0];
      S.setFloat64(c + 4, pt[0], true); S.setFloat64(c + 12, pt[1], true);
      if (z) { S.setFloat64(c + 20, pt.length > 2 ? pt[2] : 0, true); S.setFloat64(c + 28, 0, true); }
      return;
    }
    const pts = base === 8 ? (g.type === 'Point' ? [g.coordinates] : g.coordinates) : r.parts.flat();
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const q of pts) { bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); const zz = q.length > 2 ? q[2] : 0; bz0 = Math.min(bz0, zz); bz1 = Math.max(bz1, zz); }
    S.setFloat64(c + 4, bx0, true); S.setFloat64(c + 12, by0, true); S.setFloat64(c + 20, bx1, true); S.setFloat64(c + 28, by1, true);
    let at;
    if (base === 8) { S.setInt32(c + 36, pts.length, true); at = c + 40; }
    else {
      S.setInt32(c + 36, r.parts.length, true); S.setInt32(c + 40, pts.length, true);
      let s = 0; r.parts.forEach((part, k) => { S.setInt32(c + 44 + k * 4, s, true); s += part.length; });
      at = c + 44 + r.parts.length * 4;
    }
    for (const q of pts) { S.setFloat64(at, q[0], true); S.setFloat64(at + 8, q[1], true); at += 16; }
    if (z) {
      S.setFloat64(at, bz0, true); S.setFloat64(at + 8, bz1, true); at += 16;
      for (const q of pts) { S.setFloat64(at, q.length > 2 ? q[2] : 0, true); at += 8; }
      S.setFloat64(at, 0, true); S.setFloat64(at + 8, 0, true); at += 16;   // M range + measures: none
      for (let k = 0; k < pts.length; k++) { S.setFloat64(at, 0, true); at += 8; }
    }
  });
  return { shp, shx, shapeType: st };
}
