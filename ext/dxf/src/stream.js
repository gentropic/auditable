// @gcu/dxf streaming reader — the scene, read as the bytes go by.
//
// read() takes the whole file as ONE string, which caps a DXF at what a JS string
// can hold (~512 M characters in V8) — and a triangulated topography exported as
// 3DFACEs blows past that easily (≈300–400 bytes of text per face). This is the
// push-parser twin: createSceneStream(sink) takes byte chunks in any sizes, splits
// them into group-code pairs ACROSS chunk boundaries, and walks entities straight
// into the same scene sink extractScene uses (scene.js emitSceneFeature) — so
// nothing is held but the entity in flight.
//
// The adapter (whoever owns the I/O) feeds it: a Blob's slices, a stream reader, a
// Node file handle. Pure — no I/O here.
//
// Hot entities are FAST-PATHED straight from typed slots, no pair objects: 3DFACE,
// LINE, POINT, LWPOLYLINE, and POLYLINE with its VERTEX stream (polyface meshes,
// polygon meshes, 2D/3D polylines — a single polyface can hold millions of
// vertices, so its vertex table is kept in growable typed arrays). Everything else
// (ARC, CIRCLE, INSERT + ATTRIB, TEXT, the unsupported) is buffered as ordinary
// records and handed to the resident reader's own entity parsers + explode(), so
// the two paths cannot drift on the rare entities. TABLES (layer colours) and
// BLOCKS (insert targets) are small by nature and parsed resident at ENDSEC.
//
// Semantics match read() + extractScene() exactly: the code-driven value types,
// the desync guard, "first value wins" for a simple entity's codes, the 3DFACE
// triangle rule (4th corner == 3rd), polyface 1-based |indices|, polygon-mesh
// wrap flags, bulge sampling. test/dxf.test.mjs runs both paths over one corpus.

import { valueKind } from './tokenize.js';
import { resolveColor, colorToRgb } from './color.js';
import { splitRecords, parseLayers, parseBlocks, assembleEntities } from './read.js';
import { explode } from './explode.js';
import { emitSceneFeature, polylineChords } from './scene.js';

const INSUNITS_NAMES = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 9: 'mm', 10: 'm', 14: 'dm' };
const MAX_WARNINGS = 1000;                                 // a file of a million MTEXTs reports a count, not a million rows
const BINARY_SENTINEL = 'AutoCAD Binary DXF';

// value kind per group code, precomputed (0 str · 1 num · 2 int · 3 bool)
const KIND = new Uint8Array(1072);
for (let c = 0; c < KIND.length; c++) { const k = valueKind(c); KIND[c] = k === 'num' ? 1 : k === 'int' ? 2 : k === 'bool' ? 3 : 0; }
const kindOf = (c) => (c >= 0 && c < KIND.length ? KIND[c] : (c >= 1010 && c <= 1059 ? 1 : c >= 1060 && c <= 1071 ? 2 : 0));

const POW10 = []; for (let i = 0; i <= 22; i++) POW10.push(Number('1e' + i));
// bytes → a JS string, one char per byte; short ranges (numbers, names, handles) by a plain loop,
// which beats both TextDecoder and fromCharCode.apply-over-a-subarray at these lengths
const latin1 = (b, s, e) => {
  if (e - s <= 64) { let out = ''; for (let i = s; i < e; i++) out += String.fromCharCode(b[i]); return out; }
  let out = ''; for (let i = s; i < e; i += 4096) out += String.fromCharCode.apply(null, b.subarray(i, Math.min(e, i + 4096))); return out;
};
const MAX_EXACT = 9007199254740992; // 2^53

// parseFloat over a byte range, exactly (Clinger's fast path): when the decimal mantissa is an
// integer ≤ 2^53 and the power of ten is within 10^±22, both are exact doubles, so one
// multiplication or division is correctly rounded — the same answer parseFloat gives. Zeros are
// held pending until a nonzero digit needs them, so trailing zeros never inflate the mantissa;
// exponents ("1.5E+03") are folded in. Anything outside that falls back to parseFloat on the
// text. Leading/trailing junk behaves like parseFloat's prefix rule; no digits at all → NaN.
function parseNumber(b, s, e) {
  while (s < e && (b[s] === 32 || b[s] === 9)) s++;
  const s0 = s;
  let neg = false;
  if (s < e && (b[s] === 45 || b[s] === 43)) { neg = b[s] === 45; s++; }
  let mant = 0, digits = 0, exp = 0, pending = 0, seenDot = false, i = s;
  for (; i < e; i++) {
    const ch = b[i];
    if (ch >= 48 && ch <= 57) {
      digits++;
      if (seenDot) exp--;
      if (ch === 48) { if (mant !== 0) pending++; continue; } // leading zeros vanish; others wait
      if (pending) { if (pending > 22) return parseFloat(latin1(b, s0, e)); mant *= POW10[pending]; pending = 0; }
      mant = mant * 10 + (ch - 48);
      if (mant >= MAX_EXACT) return parseFloat(latin1(b, s0, e)); // ≥, not >: 2^53 + 1 would round down to 2^53
    } else if (ch === 46 && !seenDot) seenDot = true;
    else if (ch === 101 || ch === 69) {
      // an exponent only if digits follow (parseFloat's prefix rule: "1e" and "1e+" read as 1)
      let j = i + 1, eneg = false;
      if (j < e && (b[j] === 45 || b[j] === 43)) { eneg = b[j] === 45; j++; }
      if (j >= e || b[j] < 48 || b[j] > 57) break;
      let ev = 0;
      for (; j < e && b[j] >= 48 && b[j] <= 57; j++) { ev = ev * 10 + (b[j] - 48); if (ev > 1000) return parseFloat(latin1(b, s0, e)); }
      exp += eneg ? -ev : ev;
      i = j;
      break;
    } else break;
  }
  if (!digits) return NaN;
  const p = exp + pending;
  let v;
  if (mant === 0) v = 0;
  else if (p === 0) v = mant;
  else if (p > 0 && p <= 22) v = mant * POW10[p];
  else if (p < 0 && p >= -22) v = mant / POW10[-p];
  else return parseFloat(latin1(b, s0, i));
  return neg ? -v : v;
}

// growable typed arrays (the polyline vertex table, LWPOLYLINE vertices)
function grow(Type) {
  let a = new Type(64), n = 0;
  return {
    push(v) { if (n === a.length) { const b = new Type(a.length * 2); b.set(a); a = b; } a[n++] = v; },
    get length() { return n; }, set length(v) { n = v; },
    at(i) { return a[i]; }, set(i, v) { a[i] = v; },
    slice() { return a.slice(0, n); },
  };
}

const FAST = new Set(['3DFACE', 'LINE', 'POINT', 'LWPOLYLINE', 'POLYLINE']);

/**
 * createSceneStream(sink, opts?) → { push(bytes), end() → summary }
 *   sink: { tri, string, point } (scene.js contract; no `mesh` → triangles arrive
 *         one by one, the soup shape a streaming consumer wants), optional
 *         sink.vertex(x, y, z) for each polyline/mesh geometry vertex, plus optional
 *         sink.header(info) once HEADER closes and sink.layers(table) once TABLES
 *         closes — early enough to plant a frame / seed categories before geometry.
 *   summary: { header, layers, warnings, warningsSuppressed, counts:{triangles,
 *              strings, points}, bytes }
 * Throws only on a BINARY DXF (a different format, named in the error).
 */
export function createSceneStream(sink, opts = {}) {
  const decoder = new TextDecoder('utf-8');
  const strCache = new Map();                              // code → { b: Uint8Array, s } — layer/type names repeat
  let carry = null, bytes = 0, started = false;
  let code = -1;                                           // pending group code (-1 = expecting a code line)

  // ── document state ──
  const header = { acadver: undefined, insunits: undefined, units: opts.units || 'm', codepage: undefined, extmin: null, extmax: null };
  let layers = {}, blocks = {};
  const warnings = []; let suppressed = 0;
  const warn = (w) => { if (warnings.length < MAX_WARNINGS) warnings.push(w); else suppressed++; };
  const counts = { triangles: 0, strings: 0, points: 0 };
  const out = {
    tri(l, c, ax, ay, az, bx, by, bz, cx, cy, cz) { counts.triangles++; sink.tri(l, c, ax, ay, az, bx, by, bz, cx, cy, cz); },
    string(l, c, pts) { counts.strings++; sink.string(l, c, pts); },
    point(l, c, x, y, z) { counts.points++; sink.point(l, c, x, y, z); },
  };

  // opts.section: start INSIDE a section — for a window cut from the middle of a
  // file (bbox sampling), resynced to an entity boundary by the caller
  let section = opts.section || null, wantSectionName = false;
  let hvar = null;                                         // HEADER: the $VARIABLE being read
  let rawPairs = null;                                     // TABLES / BLOCKS: the section's pairs, resident
  // ENTITIES record state
  let rtype = null;                                        // current record's type
  let generic = null;                                      // { type, pairs } for a slow-path record
  const genBuf = [];                                       // buffered slow-path records (INSERT + ATTRIBs stay together)
  const slot = new Float64Array(1072), has = new Uint8Array(1072), touched = [];
  let rLayer = '0', rAci = null, rTc = null, rHandle = null;
  const lw = { x: grow(Float64Array), y: grow(Float64Array), b: grow(Float64Array) };
  let poly = null;                                         // active POLYLINE: header fields + growable vertex table

  // colour memo: consecutive entities almost always share layer + colour
  let mLayer = null, mAci = undefined, mTc = undefined, mRgb = null;
  const rgbOf = (layer, aci, tc) => {
    if (layer !== mLayer || aci !== mAci || tc !== mTc) { mLayer = layer; mAci = aci; mTc = tc; mRgb = colorToRgb(resolveColor({ aci, trueColor: tc }), layer, layers); }
    return mRgb;
  };
  let lwUsed = false;
  const resetRecord = () => {
    for (let i = 0; i < touched.length; i++) has[touched[i]] = 0;
    touched.length = 0;
    rLayer = '0'; rAci = null; rTc = null; rHandle = null;
    if (lwUsed) { lw.x.length = 0; lw.y.length = 0; lw.b.length = 0; lwUsed = false; }
  };
  const S = (c, d = 0) => (has[c] ? slot[c] : d);

  // ── slow path: buffered records → the resident parsers → explode → the sink ──
  function flushGeneric() {
    if (!genBuf.length) return;
    const feats = assembleEntities(genBuf.splice(0), { push: warn });
    const ex = explode({ features: feats, blocks, warnings: [] });
    for (const w of ex.warnings) warn(w);
    for (const f of ex.features) emitSceneFeature(f, layers, out);
  }

  // ── fast-path finalizers ──
  function endFace() {
    const rgb = rgbOf(rLayer, rAci, rTc);
    const x0 = S(10), y0 = S(20), z0 = S(30), x1 = S(11), y1 = S(21), z1 = S(31);
    const x2 = S(12), y2 = S(22), z2 = S(32), x3 = S(13), y3 = S(23), z3 = S(33);
    out.tri(rLayer, rgb, x0, y0, z0, x1, y1, z1, x2, y2, z2);
    if (!(x3 === x2 && y3 === y2 && z3 === z2)) out.tri(rLayer, rgb, x0, y0, z0, x2, y2, z2, x3, y3, z3);
  }
  function endLine() {
    out.string(rLayer, rgbOf(rLayer, rAci, rTc), Float64Array.of(S(10), S(20), S(30), S(11), S(21), S(31)));
  }
  function endPoint() { out.point(rLayer, rgbOf(rLayer, rAci, rTc), S(10), S(20), S(30)); }
  function endLwpolyline() {
    const n = lw.x.length, elev = S(38);
    const vertices = new Float64Array(n * 3);
    let anyBulge = false;
    for (let i = 0; i < n; i++) { vertices[i * 3] = lw.x.at(i); vertices[i * 3 + 1] = lw.y.at(i); vertices[i * 3 + 2] = elev; if (lw.b.at(i) !== 0) anyBulge = true; }
    const pts = polylineChords({ vertices, bulges: anyBulge ? lw.b.slice() : null, closed: (S(70) & 1) === 1 });
    if (pts) out.string(rLayer, rgbOf(rLayer, rAci, rTc), pts);
  }
  function beginPoly() {
    poly = {
      flags: S(70), M: S(71), N: S(72), layer: rLayer, aci: rAci, tc: rTc, handle: rHandle,
      x: grow(Float64Array), y: grow(Float64Array), z: grow(Float64Array), b: grow(Float64Array), f: grow(Int32Array),
      i1: grow(Int32Array), i2: grow(Int32Array), i3: grow(Int32Array), i4: grow(Int32Array),
    };
  }
  function addVertex() {
    if (sink.vertex) {                                      // optional: every GEOMETRY vertex as it passes (bbox sampling)
      const vf = S(70);
      if (!(vf & 128) || (vf & 64)) sink.vertex(S(10), S(20), S(30));
    }
    poly.x.push(S(10)); poly.y.push(S(20)); poly.z.push(S(30)); poly.b.push(S(42)); poly.f.push(S(70));
    poly.i1.push(S(71)); poly.i2.push(S(72)); poly.i3.push(S(73)); poly.i4.push(S(74));
  }
  function endPoly() {
    const p = poly; poly = null;
    const rgb = rgbOf(p.layer, p.aci, p.tc);
    const n = p.x.length;
    if (p.flags & 64) {                                     // polyface mesh
      const gv = [];                                        // geometry-vertex record indices, in order
      const faces = [];
      for (let k = 0; k < n; k++) {
        const vf = p.f.at(k);
        if (vf & 128 && !(vf & 64)) {
          const idx = [p.i1.at(k), p.i2.at(k), p.i3.at(k), p.i4.at(k)].map(Math.abs).filter((v) => v > 0);
          if (idx.length >= 3) faces.push(idx);
        } else gv.push(k);
      }
      const nV = gv.length;
      let dropped = 0, tris = 0;
      const vtx = (ix) => gv[ix - 1];
      for (const f of faces) {
        if (f.some((ix) => ix > nV)) { dropped++; continue; }
        const a = vtx(f[0]), b = vtx(f[1]), c = vtx(f[2]);
        out.tri(p.layer, rgb, p.x.at(a), p.y.at(a), p.z.at(a), p.x.at(b), p.y.at(b), p.z.at(b), p.x.at(c), p.y.at(c), p.z.at(c));
        tris++;
        if (f.length === 4) {
          const d = vtx(f[3]);
          out.tri(p.layer, rgb, p.x.at(a), p.y.at(a), p.z.at(a), p.x.at(c), p.y.at(c), p.z.at(c), p.x.at(d), p.y.at(d), p.z.at(d));
          tris++;
        }
      }
      if (dropped) warn({ handle: p.handle, entity: 'POLYLINE(polyface)', reason: `${dropped} face(s) referenced vertices past the table — dropped` });
      if (!tris) warn({ handle: p.handle, entity: 'POLYLINE(polyface)', reason: 'no resolvable faces' });
      return;
    }
    if (p.flags & 16) {                                     // polygon mesh: an M×N grid
      const M = p.M, N = p.N;
      const gv = [];
      for (let k = 0; k < n; k++) { const vf = p.f.at(k); if (!(vf & 128) || (vf & 64)) gv.push(k); }
      if (M < 2 || N < 2 || gv.length < M * N) {
        warn({ handle: p.handle, entity: 'POLYLINE(polygon mesh)', reason: `grid ${M}×${N} but ${gv.length} vertices — skipped` });
        return;
      }
      const closedM = (p.flags & 1) === 1, closedN = (p.flags & 32) === 32;
      const at = (m, nn) => gv[m * N + nn];
      const T = (a, b, c) => out.tri(p.layer, rgb, p.x.at(a), p.y.at(a), p.z.at(a), p.x.at(b), p.y.at(b), p.z.at(b), p.x.at(c), p.y.at(c), p.z.at(c));
      for (let m = 0; m < (closedM ? M : M - 1); m++) {
        for (let nn = 0; nn < (closedN ? N : N - 1); nn++) {
          const a = at(m, nn), b = at((m + 1) % M, nn), c = at((m + 1) % M, (nn + 1) % N), d = at(m, (nn + 1) % N);
          T(a, b, c); T(a, c, d);
        }
      }
      return;
    }
    // a 2D / 3D polyline: every vertex record, in order (read.js's rule)
    const vertices = new Float64Array(n * 3);
    let anyBulge = false;
    for (let k = 0; k < n; k++) { vertices[k * 3] = p.x.at(k); vertices[k * 3 + 1] = p.y.at(k); vertices[k * 3 + 2] = p.z.at(k); if (p.b.at(k) !== 0) anyBulge = true; }
    const pts = polylineChords({ vertices, bulges: anyBulge ? p.b.slice() : null, closed: (p.flags & 1) === 1 });
    if (pts) out.string(p.layer, rgb, pts);
  }

  // close the record in flight (called at every code 0, and at section end)
  function endRecord() {
    if (generic) { genBuf.push(generic); generic = null; }
    else if (rtype === '3DFACE') endFace();
    else if (rtype === 'LINE') endLine();
    else if (rtype === 'POINT') endPoint();
    else if (rtype === 'LWPOLYLINE') endLwpolyline();
    else if (rtype === 'POLYLINE') beginPoly();
    else if (rtype === 'VERTEX') addVertex();
    rtype = null;
    resetRecord();
  }
  function beginRecord(type) {
    // a polyline closes at its SEQEND — or, defensively, at any record that isn't a VERTEX
    if (poly && type !== 'VERTEX') endPoly();
    const fast = FAST.has(type) || (type === 'VERTEX' && poly);
    if (type === 'SEQEND' && !genBuf.length && !poly) { rtype = null; return; }   // a polyline's SEQEND (already closed above)
    if (!fast) {
      // keep INSERT/ATTRIB/SEQEND groups together; otherwise flush in modest batches
      if (genBuf.length >= 256 && type !== 'ATTRIB' && type !== 'SEQEND' && type !== 'VERTEX') flushGeneric();
      generic = { type, pairs: [] };
      rtype = null;
      return;
    }
    if (genBuf.length) flushGeneric();
    rtype = type;
  }

  function endSection() {
    if (section === 'ENTITIES') { endRecord(); if (poly) endPoly(); flushGeneric(); }
    else if (section === 'TABLES') { layers = parseLayers(splitRecords(rawPairs)); if (sink.layers) sink.layers(layers); }
    else if (section === 'BLOCKS') { blocks = parseBlocks(splitRecords(rawPairs), { push: warn }); }
    else if (section === 'HEADER') { if (sink.header) sink.header(headerInfo()); }
    rawPairs = null; section = null; hvar = null;
  }
  const headerInfo = () => ({ ...header, units: INSUNITS_NAMES[header.insunits] ?? header.units });

  // ── one group-code pair ──
  function pair(c, num, str) {
    if (c === 0) {
      if (str === 'SECTION') { if (section) endSection(); wantSectionName = true; return; }
      if (str === 'ENDSEC') { endSection(); return; }
      if (str === 'EOF') { if (section) endSection(); return; }
      if (section === 'ENTITIES') { endRecord(); beginRecord(str); return; }
      if (rawPairs) rawPairs.push({ code: 0, value: str });
      return;
    }
    if (wantSectionName && c === 2) {
      wantSectionName = false; section = str;
      if (section === 'TABLES' || section === 'BLOCKS') rawPairs = [];
      return;
    }
    if (section === 'ENTITIES') {
      if (generic) { generic.pairs.push({ code: c, value: str !== null ? str : num }); return; }
      if (!rtype) return;
      if (c === 8) { rLayer = str; return; }
      if (c === 62) { if (rAci === null) rAci = num; return; }
      if (c === 420) { if (rTc === null) rTc = num; return; }
      if (c === 5) { rHandle = str; return; }
      if (rtype === 'LWPOLYLINE') {
        if (c === 10) { lw.x.push(num); lw.y.push(0); lw.b.push(0); lwUsed = true; return; }
        if (c === 20 && lw.x.length) { lw.y.set(lw.x.length - 1, num); return; }
        if (c === 42 && lw.x.length) { lw.b.set(lw.x.length - 1, num); return; }
      }
      if (str === null && c < 1072 && !has[c]) { has[c] = 1; touched.push(c); slot[c] = num; }
      return;
    }
    if (rawPairs) { rawPairs.push({ code: c, value: str !== null ? str : num }); return; }
    if (section === 'HEADER') {
      if (c === 9) { hvar = str; return; }
      if (hvar === '$EXTMIN' || hvar === '$EXTMAX') {
        const k = hvar === '$EXTMIN' ? 'extmin' : 'extmax';
        const ax = c === 10 ? 0 : c === 20 ? 1 : c === 30 ? 2 : -1;
        if (ax >= 0) (header[k] ??= [0, 0, 0])[ax] = num;
      } else if (hvar === '$INSUNITS' && c === 70) header.insunits = num;
      else if (hvar === '$ACADVER' && c === 1) header.acadver = str;
      else if (hvar === '$DWGCODEPAGE' && c === 3) header.codepage = str;
    }
  }

  // a string value, with a small per-code cache: entity types, layer names and subclass markers
  // repeat endlessly — and code 100 alternates ("AcDbEntity", "AcDbFace" on every entity), so one
  // entry per code would thrash; four, replaced round-robin, holds them. Short pure-ASCII values
  // (and every unique handle) decode by a plain loop, not a TextDecoder call per value.
  function strValue(c, b, s, e) {
    const len = e - s;
    let ent = strCache.get(c);
    if (ent) {
      for (let k = 0; k < ent.n; k++) {
        const hb = ent.b[k];
        if (hb.length !== len) continue;
        let same = true;
        for (let i = 0; i < len; i++) if (hb[i] !== b[s + i]) { same = false; break; }
        if (same) return ent.s[k];
      }
    }
    let ascii = len <= 64;
    if (ascii) for (let i = s; i < e; i++) if (b[i] >= 128) { ascii = false; break; }
    const v = ascii ? latin1(b, s, e) : decoder.decode(b.subarray(s, e));
    // handles (5, 105, 320–369, 390–399, 1005) are unique by design: caching them only churns
    const handle = c === 5 || c === 105 || c === 1005 || (c >= 320 && c <= 369) || (c >= 390 && c <= 399);
    if (len <= 256 && !handle) {
      if (!ent) { ent = { b: [], s: [], n: 0, next: 0 }; strCache.set(c, ent); }
      const k = ent.n < 4 ? ent.n++ : (ent.next = (ent.next + 1) % 4);
      ent.b[k] = b.slice(s, e); ent.s[k] = v;
    }
    return v;
  }

  // ── lines → pairs ──
  function line(b, s, e) {
    if (e > s && b[e - 1] === 13) e--;                     // CRLF
    if (code < 0) {
      // expecting a group code: trimmed integer, else the desync guard skips the line
      let i = s; while (i < e && (b[i] === 32 || b[i] === 9)) i++;
      let j = e; while (j > i && (b[j - 1] === 32 || b[j - 1] === 9)) j--;
      if (i === j) return;                                  // blank line
      let neg = false, v = 0, k = i;
      if (b[k] === 45 || b[k] === 43) { neg = b[k] === 45; k++; }
      if (k === j) return;
      for (; k < j; k++) { const ch = b[k]; if (ch < 48 || ch > 57) return; v = v * 10 + (ch - 48); }
      code = neg ? -v : v;
      return;
    }
    const c = code; code = -1;
    const kind = kindOf(c);
    if (kind === 0) { pair(c, 0, strValue(c, b, s, e)); return; }
    if (kind === 3) { let i = s, j = e; while (i < j && b[i] <= 32) i++; while (j > i && b[j - 1] <= 32) j--; pair(c, !(j - i === 1 && b[i] === 48), null); return; }
    let n = parseNumber(b, s, e);
    if (Number.isNaN(n)) n = 0;
    else if (kind === 2) n = Math.trunc(n);
    pair(c, n, null);
  }

  // the first bytes: refuse a binary DXF by name, step over a UTF-8 BOM
  function start(b) {
    started = true;
    if (latin1(b, 0, Math.min(b.length, BINARY_SENTINEL.length)) === BINARY_SENTINEL) throw new Error('dxf: this is a BINARY DXF — only ASCII DXF is supported (re-export as ASCII)');
    return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
  }
  // every complete line of b; the tail (no newline yet) is carried — or, at the end, is the last line
  // (a plain byte loop, not indexOf: a DXF line averages ~10 bytes, and a native
  // call per line costs more than scanning it)
  function feed(b, final) {
    const n = b.length;
    let s = 0, i = 0;
    while (i < n) {
      if (b[i] === 10) { line(b, s, i); s = i + 1; }
      i++;
    }
    if (s < n) { if (final) line(b, s, n); else carry = b.slice(s); }
  }

  return {
    push(chunk) {
      let b = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      bytes += b.length;
      if (!started) {
        if (carry) { const m = new Uint8Array(carry.length + b.length); m.set(carry); m.set(b, carry.length); b = m; carry = null; }
        if (b.length < BINARY_SENTINEL.length + 3) { carry = b; return; }   // too few bytes to tell yet
        b = start(b);
      } else if (carry) {
        // finish the carried partial line from the head of this chunk, without copying the chunk
        let nl = 0; while (nl < b.length && b[nl] !== 10) nl++;
        const m = new Uint8Array(carry.length + nl); m.set(carry); m.set(b.subarray(0, nl), carry.length); carry = null;
        if (nl === b.length) { carry = m; return; }
        line(m, 0, m.length);
        b = b.subarray(nl + 1);
      }
      feed(b, false);
    },
    end() {
      if (carry) { let b = carry; carry = null; if (!started) b = start(b); feed(b, true); }
      if (code >= 0) line(new Uint8Array(0), 0, 0);       // a code with no value line → its empty value (parsePairs' rule)
      if (section) endSection();
      return { header: headerInfo(), layers, warnings, warningsSuppressed: suppressed, counts, bytes };
    },
  };
}

/**
 * peekDxf(bytes) — what a HEAD of the file says, without reading the rest: header
 * variables ($EXTMIN/$EXTMAX/$INSUNITS…) + the entity mix seen so far. For an open
 * dialog's description of a file too big to read for a preview. A truncated head
 * is fine (the last entity in flight is simply closed).
 */
export function peekDxf(bytes) {
  let lastLayer = null;
  const layerSet = new Set();
  const note = (l) => { if (l !== lastLayer) { lastLayer = l; layerSet.add(l); } };
  const st = createSceneStream({ tri: (l) => note(l), string: (l) => note(l), point: (l) => note(l) });
  st.push(bytes);
  const r = st.end();
  return { header: r.header, counts: r.counts, layers: [...layerSet].sort(), tableLayers: Object.keys(r.layers), bytes: r.bytes };
}
