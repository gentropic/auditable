// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/shp — ESRI Shapefile reader/writer (.shp + .shx + .dbf + .prj) over GeoJSON-shaped features. Points, lines, polygons with holes, Z (M dropped), dBASE attributes with .cpg encodings, and a one-word read of the .prj (geographic / projected / local). Zero-dependency, first-party, never reprojects.

// ── src/shape.js ──

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

function ringArea(ring) {
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
function assembleRings(rings) {
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

function readShp(input) {
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
function shapeTypeOf(geometries) {
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

function writeShp(geometries, { shapeType = null } = {}) {
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

// ── src/dbf.js ──

// @gcu/shp dbf — the dBASE III table a shapefile keeps its attributes in.
//
//   readDbf(bytes, { encoding }) → { fields: [{ name, type, length, decimals }], rows: [{ name: value }] }
//   writeDbf(rows, fields, { encoding: 'utf-8' }) → Uint8Array
//   dbfFields(rows, names?) → field descriptors sized to the values (for writeDbf)
//
// Types read: C (text), N / F (numbers — blank or '*' overflow → null), L (true / false /
// null), D (YYYYMMDD → 'YYYY-MM-DD' text), I (int32), O (double); M / anything else reads its
// raw text. Deleted records (flag '*') are skipped. Text decodes as `encoding` (a .cpg file
// says which; without one UTF-8 is tried strictly, then windows-1252, which is what an
// unlabelled DBF most often is).
//
// Writing produces dBASE III (0x03) with C and N fields only — the subset every reader
// takes. Field names are cut to 10 bytes and made unique (a dBASE limit, not ours).

const td = (enc) => { try { return new TextDecoder(enc, { fatal: false }); } catch { return new TextDecoder('windows-1252'); } };

function decodeText(bytes, encoding) {
  if (encoding) return td(encoding).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return td('windows-1252').decode(bytes); }
}

function readDbf(input, { encoding = null } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 32) throw new Error('dbf: too short to be a dBASE table');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(4, true), headerLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  const fields = [];
  let off = 1;                                              // after the deletion flag
  for (let p = 32; p + 32 <= headerLen && b[p] !== 0x0d; p += 32) {
    let e = p; while (e < p + 11 && b[e] !== 0) e++;
    const name = decodeText(b.subarray(p, e), encoding).trim();
    const type = String.fromCharCode(b[p + 11]);
    const length = b[p + 16], decimals = b[p + 17];
    fields.push({ name, type, length, decimals, offset: off });
    off += length;
  }
  const rows = [];
  for (let r = 0; r < n; r++) {
    const base = headerLen + r * recLen;
    if (base + recLen > b.length) break;                    // a truncated file: what is whole
    if (b[base] === 0x2a) continue;                         // '*': deleted
    const row = {};
    for (const f of fields) {
      const s = base + f.offset, raw = b.subarray(s, s + f.length);
      let v;
      if (f.type === 'I') v = f.length === 4 ? new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0, true) : null;
      else if (f.type === 'O') v = f.length === 8 ? new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true) : null;
      else {
        const t = decodeText(raw, encoding).replace(/\0+$/, '');
        if (f.type === 'N' || f.type === 'F') {
          const tt = t.trim();
          v = tt === '' || /^\*+$/.test(tt) ? null : Number(tt);
          if (v != null && !Number.isFinite(v)) v = null;
        } else if (f.type === 'L') {
          const c = t.trim().toUpperCase();
          v = 'YT'.includes(c) && c ? true : 'NF'.includes(c) && c ? false : null;
        } else if (f.type === 'D') {
          const tt = t.trim();
          v = /^\d{8}$/.test(tt) ? `${tt.slice(0, 4)}-${tt.slice(4, 6)}-${tt.slice(6, 8)}` : tt || null;
        } else v = t.replace(/\s+$/, '');
      }
      row[f.name] = v;
    }
    rows.push(row);
  }
  return { fields: fields.map(({ name, type, length, decimals }) => ({ name, type, length, decimals })), rows };
}

const enc = new TextEncoder();
// a dBASE field name: ≤10 bytes, unique (case-insensitive), no NULs
function fieldNames(names) {
  const used = new Set(), out = [];
  for (const nm of names) {
    let base = String(nm == null ? '' : nm).replace(/[\0]/g, '').trim() || 'FIELD';
    while (enc.encode(base).length > 10) base = base.slice(0, -1);
    let cand = base, k = 1;
    while (used.has(cand.toUpperCase())) {
      const suf = String(k++);
      let stem = base;
      while (enc.encode(stem + suf).length > 10) stem = stem.slice(0, -1);
      cand = stem + suf;
    }
    used.add(cand.toUpperCase()); out.push(cand);
  }
  return out;
}

// numbers → N with enough integer and decimal width for every value; anything else → C
function dbfFields(rows, names = null) {
  const keys = names || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const dbfName = fieldNames(keys);
  return keys.map((key, k) => {
    let numeric = true, any = false, intW = 1, dec = 0, textLen = 1;
    for (const r of rows) {
      const v = r[key];
      if (v == null || v === '') continue;
      any = true;
      if (typeof v === 'number' && Number.isFinite(v)) {
        const s = String(Math.abs(v));
        if (/e/i.test(s)) { dec = Math.max(dec, 10); intW = Math.max(intW, String(Math.trunc(Math.abs(v))).length); }
        else { const [i, d = ''] = s.split('.'); intW = Math.max(intW, i.length); dec = Math.max(dec, d.length); }
      } else if (typeof v === 'boolean') { numeric = false; textLen = Math.max(textLen, 5); }
      else { numeric = false; textLen = Math.max(textLen, enc.encode(String(v)).length); }
    }
    if (numeric && any) {
      dec = Math.min(dec, 15);
      const length = Math.min(254, 1 + intW + (dec ? dec + 1 : 0));   // sign + digits + point + decimals
      return { key, name: dbfName[k], type: 'N', length, decimals: dec };
    }
    return { key, name: dbfName[k], type: 'C', length: Math.min(254, textLen), decimals: 0 };
  });
}

// cut a UTF-8 byte array to `n` bytes without splitting a character
function clipUtf8(bytes, n) {
  if (bytes.length <= n) return bytes;
  let e = n;
  while (e > 0 && (bytes[e] & 0xc0) === 0x80) e--;
  return bytes.subarray(0, e);
}

function writeDbf(rows, fields) {
  const headerLen = 32 + 32 * fields.length + 1;
  const recLen = 1 + fields.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(headerLen + recLen * rows.length + 1);
  const dv = new DataView(out.buffer);
  const now = new Date();
  out[0] = 0x03;
  out[1] = now.getUTCFullYear() - 1900; out[2] = now.getUTCMonth() + 1; out[3] = now.getUTCDate();
  dv.setUint32(4, rows.length, true);
  dv.setUint16(8, headerLen, true);
  dv.setUint16(10, recLen, true);
  out[29] = 0x00;                                           // no LDID: the .cpg says UTF-8
  fields.forEach((f, i) => {
    const p = 32 + i * 32;
    out.set(clipUtf8(enc.encode(f.name), 10), p);
    out[p + 11] = f.type.charCodeAt(0);
    out[p + 16] = f.length; out[p + 17] = f.decimals || 0;
  });
  out[headerLen - 1] = 0x0d;
  for (let r = 0; r < rows.length; r++) {
    let p = headerLen + r * recLen;
    out[p++] = 0x20;                                        // not deleted
    for (const f of fields) {
      const v = rows[r][f.key != null ? f.key : f.name];
      out.fill(0x20, p, p + f.length);
      if (v != null && v !== '') {
        if (f.type === 'N') {
          const n = typeof v === 'number' ? v : Number(v);
          if (Number.isFinite(n)) {
            let s = f.decimals ? n.toFixed(f.decimals) : String(Math.round(n));
            if (s.length > f.length) s = '*'.repeat(f.length);   // dBASE's overflow mark
            out.set(enc.encode(s.padStart(f.length, ' ')), p);
          }
        } else out.set(clipUtf8(enc.encode(String(v)), f.length), p);
      }
      p += f.length;
    }
  }
  out[out.length - 1] = 0x1a;                               // end of file
  return out;
}

// ── src/prj.js ──

// @gcu/shp prj — what a .prj (an ESRI / OGC WKT coordinate system) says, in one word.
//
//   prjInfo(text) → { kind: 'geographic' | 'projected' | 'local' | 'unknown', name, epsg? }
//
// Only the top-level keyword matters for the question a viewer that never reprojects has
// to ask — "are these metres, or are these degrees?": GEOGCS / GEOGCRS / GEODCRS → degrees
// (longitude/latitude); PROJCS / PROJCRS → a projected system; LOCAL_CS / ENGCRS → a local
// engineering grid. `name` is the system's own name (its first quoted string); `epsg` is
// read from a top-level AUTHORITY["EPSG", …] / ID["EPSG", …] when the file carries one.

function prjInfo(text) {
  const s = String(text || '').replace(/^﻿/, '').trim();
  if (!s) return { kind: 'unknown', name: null };
  const m = /^([A-Z_]+)\s*\[\s*"([^"]*)"/i.exec(s);
  if (!m) return { kind: 'unknown', name: null };
  const kw = m[1].toUpperCase(), name = m[2];
  let kind = 'unknown';
  if (kw === 'GEOGCS' || kw === 'GEOGCRS' || kw === 'GEOGRAPHICCRS') kind = 'geographic';
  else if (kw === 'GEODCRS' || kw === 'GEODETICCRS') kind = /ELLIPSOIDAL/i.test(s) ? 'geographic' : 'unknown';
  else if (kw === 'PROJCS' || kw === 'PROJCRS' || kw === 'PROJECTEDCRS') kind = 'projected';
  else if (kw === 'LOCAL_CS' || kw === 'ENGCRS' || kw === 'ENGINEERINGCRS') kind = 'local';
  // the LAST authority in the text is the top-level one (nested ones come first)
  const ids = [...s.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  const out = { kind, name };
  if (ids.length) out.epsg = +ids[ids.length - 1][1];
  return out;
}

// ── src/shapefile.js ──

// @gcu/shp shapefile — the .shp + .dbf + .prj (+ .cpg) set as one thing: features.
//
//   readShapefile({ shp, dbf?, prj?, cpg? }) → { shapeType, typeName, bbox, fields, crs, prj,
//       features: [{ geometry, properties }], warnings }
//   writeShapefile(features, { prj?, fields? }) → { shp, shx, dbf, cpg, prj? }  (Uint8Arrays / text)
//
// Bytes in, bytes out — no files, no zip, no network: the caller finds the parts (loose, or
// in a .zip it opened) and decides what to do with a geographic `crs`. Record i of the .shp
// pairs with row i of the .dbf; a .dbf with fewer rows leaves the rest without attributes.


const text = (v) => (v == null ? null : typeof v === 'string' ? v : new TextDecoder('utf-8').decode(v instanceof Uint8Array ? v : new Uint8Array(v)));

function readShapefile({ shp, dbf = null, prj = null, cpg = null }) {
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
function writeShapefile(features, { prj = null, fields = null } = {}) {
  const geoms = features.map((f) => f.geometry || null);
  const { shp, shx } = writeShp(geoms);
  const rows = features.map((f) => f.properties || {});
  const fdefs = dbfFields(rows, fields);
  const dbf = writeDbf(rows, fdefs);
  const out = { shp, shx, dbf, cpg: 'UTF-8', fields: fdefs.map((f) => ({ key: f.key, name: f.name, type: f.type, length: f.length, decimals: f.decimals })) };
  if (prj) out.prj = String(prj);
  return out;
}

// ── src/main.js ──

// @gcu/shp — ESRI Shapefile read/write, first-party and zero-dependency.
//
// The .shp geometry (+ .shx index), the .dbf attribute table and the .prj coordinate-system
// text, as GeoJSON-shaped features. Bytes in, bytes out: finding the parts (loose files, a
// .zip) is the caller's job, and so is deciding what a geographic .prj means — prjInfo
// says which kind of system it is; this package never reprojects.

export {
  readShapefile,
  writeShapefile,
  readShp,
  writeShp,
  shapeTypeOf,
  ringArea,
  assembleRings,
  readDbf,
  writeDbf,
  dbfFields,
  prjInfo,
};
