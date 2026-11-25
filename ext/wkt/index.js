// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/wkt — OGC Simple-Features Well-Known Text (WKT) reader/writer plus EWKT SRID, over a GeoJSON-shaped geometry. The GIS/DB-native interchange codec for the GCU geometry stack — the data-bridge serialization complementing @gcu/dxf (the CAD-native one). Zero-dependency, total-ish. Handles Point/LineString/Polygon/Multi*/GeometryCollection, Z, EMPTY, and both MULTIPOINT spellings.

// ── src/parse.js ──

// @gcu/wkt parse — OGC Simple-Features WKT (+ EWKT SRID) → a GeoJSON-shaped geometry:
//   { type:'Point'|'LineString'|'Polygon'|'MultiPoint'|'MultiLineString'|'MultiPolygon'|
//     'GeometryCollection', coordinates|geometries, srid? }
// Coordinates self-describe dimensionality (2 → [x,y], 3 → [x,y,z]); the Z/M tag is read
// and ignored. Handles EMPTY, both MULTIPOINT spellings, and `SRID=…;` (EWKT). Throws a
// clear error on malformed input.

const TYPES = {
  POINT: 'Point', LINESTRING: 'LineString', POLYGON: 'Polygon',
  MULTIPOINT: 'MultiPoint', MULTILINESTRING: 'MultiLineString',
  MULTIPOLYGON: 'MultiPolygon', GEOMETRYCOLLECTION: 'GeometryCollection',
};

class Cursor {
  constructor(s) { this.s = s; this.i = 0; }
  eof() { this.skipWs(); return this.i >= this.s.length; }
  skipWs() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  peek() { this.skipWs(); return this.s[this.i]; }
  word() { this.skipWs(); let j = this.i; while (j < this.s.length && /[A-Za-z]/.test(this.s[j])) j++; const w = this.s.slice(this.i, j); this.i = j; return w.toUpperCase(); }
  expect(ch) { this.skipWs(); if (this.s[this.i] !== ch) throw new Error(`WKT: expected '${ch}' at ${this.i}, got '${this.s[this.i] || 'EOF'}'`); this.i++; }
  number() {
    this.skipWs(); let j = this.i;
    while (j < this.s.length && !/[\s,()]/.test(this.s[j])) j++;
    const tok = this.s.slice(this.i, j), n = Number(tok);
    if (tok === '' || Number.isNaN(n)) throw new Error(`WKT: bad number "${tok}" at ${this.i}`);
    this.i = j; return n;
  }
}

// one coordinate: read numbers until ',' or ')' — auto 2D/3D
function readCoord(p) {
  const c = [p.number()];
  while (p.peek() !== ',' && p.peek() !== ')') c.push(p.number());
  if (c.length < 2) throw new Error(`WKT: coordinate needs ≥2 numbers at ${p.i}`);
  return c;
}
// ( item, item, … )
function readGroup(p, readItem) {
  p.expect('('); const out = [];
  do { out.push(readItem(p)); } while (p.peek() === ',' && (p.i++, true));
  p.expect(')'); return out;
}
const readLineString = (p) => readGroup(p, readCoord);     // [[x,y],…]
const readPolygon = (p) => readGroup(p, readLineString);   // [ring,…]
// MULTIPOINT: bare `(1 2, 3 4)` or wrapped `((1 2),(3 4))`
function readMultiPoint(p) {
  p.expect('('); const out = [];
  do { out.push(p.peek() === '(' ? readGroup(p, readCoord)[0] : readCoord(p)); } while (p.peek() === ',' && (p.i++, true));
  p.expect(')'); return out;
}

// a measure (M) is not a coordinate: `POINT M (1 2 7)` is x=1 y=2 m=7, and reading it as
// [1, 2, 7] would place the point at z=7. M is dropped; Z stays.
function dropM(c, tag) {
  if (tag === 'M' && c.length >= 3) return c.slice(0, 2);
  if (tag === 'ZM' && c.length >= 4) return c.slice(0, 3);
  return c;
}
const mapCoords = (v, depth, f) => (depth === 0 ? f(v) : v.map((x) => mapCoords(x, depth - 1, f)));
const DEPTH = { Point: 0, LineString: 1, MultiPoint: 1, Polygon: 2, MultiLineString: 2, MultiPolygon: 3 };

function parseGeometry(p) {
  let type = p.word(), suffix = '';
  // QGIS / PostGIS spell the dimension glued on: `PolygonZ`, `MultiLineStringZM`, `PointM`
  if (!TYPES[type]) { const m = /^(.*?)(ZM|Z|M)$/.exec(type); if (m && TYPES[m[1]]) { type = m[1]; suffix = m[2]; } }
  if (!TYPES[type]) throw new Error(`WKT: unknown type "${type}"`);
  const kind = TYPES[type];
  let save = p.i; let tag = p.word();                   // optional Z / M / ZM (Z is implied by the coordinates)
  if (tag !== 'Z' && tag !== 'M' && tag !== 'ZM') { p.i = save; tag = suffix; }
  save = p.i; if (p.word() === 'EMPTY') return kind === 'GeometryCollection' ? { type: kind, geometries: [] } : { type: kind, coordinates: [] };
  p.i = save;
  let g;
  if (kind === 'Point') { p.expect('('); const c = readCoord(p); p.expect(')'); g = { type: kind, coordinates: c }; }
  else if (kind === 'LineString') g = { type: kind, coordinates: readLineString(p) };
  else if (kind === 'Polygon') g = { type: kind, coordinates: readPolygon(p) };
  else if (kind === 'MultiPoint') g = { type: kind, coordinates: readMultiPoint(p) };
  else if (kind === 'MultiLineString') g = { type: kind, coordinates: readGroup(p, readLineString) };
  else if (kind === 'MultiPolygon') g = { type: kind, coordinates: readGroup(p, readPolygon) };
  else return { type: kind, geometries: readGroup(p, parseGeometry) };   // GeometryCollection
  if (tag === 'M' || tag === 'ZM') g.coordinates = mapCoords(g.coordinates, DEPTH[kind], (c) => dropM(c, tag));
  return g;
}

function parse(text) {
  let s = String(text).trim(), srid;
  const m = /^SRID=(\d+)\s*;\s*/i.exec(s);
  if (m) { srid = Number(m[1]); s = s.slice(m[0].length); }
  const p = new Cursor(s);
  const g = parseGeometry(p);
  if (!p.eof()) throw new Error(`WKT: trailing text at ${p.i}`);
  if (srid != null) g.srid = srid;
  return g;
}

// ── src/stringify.js ──

// @gcu/wkt stringify — a GeoJSON-shaped geometry → OGC WKT (+ EWKT SRID).
// opts: { srid?, precision? }. srid (or geom.srid) → an `SRID=…;` EWKT prefix; precision →
// fixed decimal places. MULTIPOINT is emitted in the bare form `MULTIPOINT (x y, x y)`.
// A 3D geometry carries the OGC ` Z` tag (`POLYGON Z ((…))`) — the strict reading QGIS and
// PostGIS expect; 2D output is unchanged.

const fmt = (n, prec) => (prec != null ? String(+n.toFixed(prec)) : String(n));
const coord = (c, p) => c.map((n) => fmt(n, p)).join(' ');
const ring = (r, p) => '(' + r.map((c) => coord(c, p)).join(', ') + ')';
const poly = (g, p) => '(' + g.map((r) => ring(r, p)).join(', ') + ')';

// the first coordinate decides: 3 numbers → ' Z'
function zTag(c) {
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && c.length >= 3 ? ' Z' : '';
}

function body(g, p) {
  const z = zTag(g.coordinates);
  switch (g.type) {
    case 'Point': return g.coordinates && g.coordinates.length ? `POINT${z} (${coord(g.coordinates, p)})` : 'POINT EMPTY';
    case 'LineString': return g.coordinates && g.coordinates.length ? `LINESTRING${z} ${ring(g.coordinates, p)}` : 'LINESTRING EMPTY';
    case 'Polygon': return g.coordinates && g.coordinates.length ? `POLYGON${z} ${poly(g.coordinates, p)}` : 'POLYGON EMPTY';
    case 'MultiPoint': return g.coordinates && g.coordinates.length ? `MULTIPOINT${z} (${g.coordinates.map((c) => coord(c, p)).join(', ')})` : 'MULTIPOINT EMPTY';
    case 'MultiLineString': return g.coordinates && g.coordinates.length ? `MULTILINESTRING${z} (${g.coordinates.map((ls) => ring(ls, p)).join(', ')})` : 'MULTILINESTRING EMPTY';
    case 'MultiPolygon': return g.coordinates && g.coordinates.length ? `MULTIPOLYGON${z} (${g.coordinates.map((mp) => poly(mp, p)).join(', ')})` : 'MULTIPOLYGON EMPTY';
    case 'GeometryCollection': return g.geometries && g.geometries.length ? `GEOMETRYCOLLECTION (${g.geometries.map((x) => body(x, p)).join(', ')})` : 'GEOMETRYCOLLECTION EMPTY';
    default: throw new Error(`WKT: cannot stringify type "${g.type}"`);
  }
}

function stringify(geom, opts = {}) {
  const srid = opts.srid != null ? opts.srid : geom.srid;
  const s = body(geom, opts.precision);
  return srid != null ? `SRID=${srid};${s}` : s;
}

// ── src/main.js ──

// @gcu/wkt — module manifest. OGC Simple-Features WKT I/O (+ EWKT SRID) over a
// GeoJSON-shaped geometry. The GIS/DB-native interchange codec for the GCU stack
// (the data-bridge serialization; complements @gcu/dxf, the CAD-native one).

export {
  parse,
  stringify,
};
