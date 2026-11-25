// micro placement — a layer's RIGID PLACEMENT applied where its data is READ.
//
// A model, a mesh, a grid or a cloud may sit in its own frame: a mine grid, a photogrammetry
// local system, a CAD origin, a model exported "anonymised" at (0, 0, 0). Its placement — a 3D
// similarity (src/placement-core.js: a shift, three rotations, one uniform scale; never a shear)
// — takes it into the project's frame. Like a rotated Datamine model (the first placement
// micro had, which this generalises), it is applied AT READ: every reader of the layer's
// records — the render stream, the rows (filter, export, the attribute table, stats, swath,
// joins), single fetches (pick, the records panel), the position streams (by-solid, selection,
// polygons as limits, sections), the @gcu/scan workers — sees WORLD coordinates. The file is
// never rewritten; a re-read places again. Boxes stay boxes: a block model's lattice is placed
// as a lattice (placeGrid — its pitch scales, its orientation composes with the file's own).
//
// Where a layer keeps it: L.placement (the stored form — on the layer, saved in the project,
// stamped in lineage). Per doc kind:
//   blocks (CSV / Parquet) header.place = { x, y, z, dims, R (scale folded in), O, s } — the rows'
//                          coordinate fields + the size columns; the stream wrapped; the
//                          grid / bbox placed (header.fileGrid / fileBbox keep the file's)
//   blocks (.dm)           the provider's own place composed (condenser openDmModel
//                          `placement`): readers, stream, workers (header.dmPlace)
//   clouds (LAS / PLY)     the provider wrapped (placeCloudProvider)
//   meshes                 the vertices placed once per parse (placeMesh; records.js reReadMesh)
//   grids                  grid.place (the compiled transform): every sampler works in the
//                          grid's own frame (grid-ops.js surfaceFromGrid / gridLocalXY)
import { S } from './state.js';
import { compilePlacement, placeGrid, placeBbox, scaledR, applyP, composeP, zOnlyP, describePlacement, residualClass, fmtLen, RESIDUAL_COLOR } from './placement-core.js';

export { describePlacement, residualClass, fmtLen, RESIDUAL_COLOR };

// ── the layer's transform ────────────────────────────────────────────────────
export function layerPlacementM(L) {
  const p = L && L.placement;
  if (!p) return null;
  const key = JSON.stringify(p);
  if (L._placeKey !== key) { L._placeKey = key; L._placeM = compilePlacement(p); }
  return L._placeM;
}
const TOL_KEY = 'micro.placement.tol';
/** the residual tolerance (metres) residuals are coloured against: green within, amber within 3×, red beyond */
export function placementTolerance() { try { const v = +localStorage.getItem(TOL_KEY); return v > 0 ? v : 0.05; } catch { return 0.05; } }
export function setPlacementTolerance(v) { try { if (+v > 0) localStorage.setItem(TOL_KEY, String(+v)); } catch { /* private mode */ } }

/** the residual a layer's placement carries (a fit's max residual / a CRS fit's max deviation), null for typed */
export const placementResidual = (L) => (L && L.placement && Number.isFinite(L.placement.maxResidual) ? L.placement.maxResidual : null);
/** the placement as one status / properties line, its residual coloured against the tolerance */
export function placementLine(L) {
  if (!L || !L.placement) return null;
  const r = placementResidual(L);
  return { text: describePlacement(L.placement), cls: r == null ? 'none' : residualClass(r, placementTolerance()) };
}

// ── blocks: CSV / Parquet ────────────────────────────────────────────────────
/**
 * Place a block header (mutates; idempotent from the FILE frame: fileGrid / fileBbox are kept the
 * first time). M null → back to the file frame. dm: the provider already places its records; only
 * the grid / bbox are composed here.
 */
export function placeBlockHeader(header, M) {
  if (!header) return header;
  if (!('fileBbox' in header)) { header.fileBbox = header.bbox; header.fileGrid = header.grid || null; }
  header.bbox = M ? placeBbox(M, header.fileBbox) : header.fileBbox;
  header.grid = header.fileGrid && M ? placeGrid(M, header.fileGrid) : header.fileGrid;
  header.placeM = M || null;
  const m = header.mapping || {};
  if (M && !header.dm && m.x != null && m.y != null && m.z != null) {
    const d = header.dimCols;
    header.place = { x: m.x, y: m.y, z: m.z, dims: d ? [d.x, d.y, d.z] : null, R: scaledR(M), O: M.t.slice(), s: M.s };
  } else delete header.place;
  return header;
}
/** a placed header back in its FILE frame (a copy, the placement keys gone) — what a discovery
 *  cache, a channel switch's reuse or a sidecar must hold, so a re-open never places twice */
export function fileHeader(h) {
  if (!h || !('fileBbox' in h)) return h;
  const o = { ...h, bbox: h.fileBbox, grid: h.fileGrid };
  delete o.fileBbox; delete o.fileGrid; delete o.place; delete o.placeM;
  if ('fileDmOrigin' in o) { o.dmOrigin = o.fileDmOrigin; delete o.fileDmOrigin; }
  return o;
}
/** a header's placement for @gcu/scan's parquet / delimited sources (by column NAME) */
export function scanPlaceOf(h, names = h && h.columns) {
  const p = h && h.place;
  if (!p || !names) return null;
  return { cols: [names[p.x], names[p.y], names[p.z]], dims: p.dims ? p.dims.map((i) => names[i]) : null, R: p.R, O: p.O, s: p.s };
}
const fieldNum = (v) => (typeof v === 'number' ? v : v == null || (typeof v === 'string' && v.trim() === '') ? NaN : +String(v).replace(',', '.'));
const r6 = (v) => +v.toFixed(6);
/** one row's coordinate (and size) fields placed, in place. A row without all three keeps its fields. */
export function placeRow(h, row) {
  const p = h && h.place;
  if (!p || !row) return row;
  const x = fieldNum(row[p.x]), y = fieldNum(row[p.y]), z = fieldNum(row[p.z]);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    const R = p.R, O = p.O;
    row[p.x] = r6(O[0] + R[0] * x + R[3] * y + R[6] * z);
    row[p.y] = r6(O[1] + R[1] * x + R[4] * y + R[7] * z);
    row[p.z] = r6(O[2] + R[2] * x + R[5] * y + R[8] * z);
  }
  if (p.dims && p.s !== 1) for (const i of p.dims) { const v = fieldNum(row[i]); if (Number.isFinite(v)) row[i] = r6(v * p.s); }
  return row;
}
/** the same for a { name: value } record (a Parquet row) */
export function placeNamedRow(sp, obj) {
  if (!sp || !obj) return obj;
  const [xn, yn, zn] = sp.cols, x = fieldNum(obj[xn]), y = fieldNum(obj[yn]), z = fieldNum(obj[zn]);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    const R = sp.R, O = sp.O;
    obj[xn] = O[0] + R[0] * x + R[3] * y + R[6] * z;
    obj[yn] = O[1] + R[1] * x + R[4] * y + R[7] * z;
    obj[zn] = O[2] + R[2] * x + R[5] * y + R[8] * z;
  }
  if (sp.dims && sp.s !== 1) for (const dn of sp.dims) { const v = fieldNum(obj[dn]); if (Number.isFinite(v)) obj[dn] = v * sp.s; }
  return obj;
}
const f64 = (a) => (a instanceof Float64Array ? a : Float64Array.from(a, Number));
/** a provider's chunk stream ({ count, x, y, z, … }) with the positions placed */
export function placedStream(stream, M) {
  if (!M || !stream) return stream;
  return async function* placed(opts) {
    const o = [0, 0, 0];
    for await (const c of stream(opts)) {
      const X = f64(c.x), Y = f64(c.y), Z = f64(c.z);
      for (let i = 0; i < c.count; i++) { applyP(M, X[i], Y[i], Z[i], o); X[i] = o[0]; Y[i] = o[1]; Z[i] = o[2]; }
      yield { ...c, x: X, y: Y, z: Z };
    }
  };
}
/** a dm provider's placement argument (condenser openDmModel `placement`): world = O + R·(as the file places) */
export const dmPlacementArg = (M) => (M ? { R: scaledR(M), O: M.t.slice() } : null);

// ── clouds: LAS / PLY providers ─────────────────────────────────────────────
// the provider shape reprojectLas uses (header, streamChunks, columnBatches, fetchRecord): every
// chunk, column batch and record placed on the way; the bbox placed. Composes with a reprojection
// (reproject first — it states where the cloud is — then place).
export function placeCloudProvider(prov, M) {
  if (!M || !prov) return prov;
  const h = prov.header, cols = h.columns || [];
  const ci = (n) => cols.findIndex((c) => String(c).toUpperCase() === n);
  const xi = ci('X'), yi = ci('Y'), zi = ci('Z');
  const b = h.bbox;
  const header = { ...h, bbox: b ? placeBbox(M, b) : b, placed: true };
  const o = [0, 0, 0];
  const streamChunks = placedStream(prov.streamChunks, M);
  async function* columnBatches(names, opts) {
    const up = names.map((n) => String(n).toUpperCase()), lx = up.indexOf('X'), ly = up.indexOf('Y'), lz = up.indexOf('Z');
    if (lx < 0 && ly < 0 && lz < 0) { yield* prov.columnBatches(names, opts); return; }
    const want = names.slice(), at = {};
    for (const [k, n] of [['x', 'X'], ['y', 'Y'], ['z', 'Z']]) { const i = up.indexOf(n); if (i >= 0) at[k] = names[i]; else { const real = cols[ci(n)] || n; want.push(real); at[k] = real; } }
    for await (const bt of prov.columnBatches(want, opts)) {
      const X = f64(bt.cols[at.x]), Y = f64(bt.cols[at.y]), Z = f64(bt.cols[at.z]);
      for (let i = 0; i < bt.n; i++) { applyP(M, X[i], Y[i], Z[i], o); X[i] = o[0]; Y[i] = o[1]; Z[i] = o[2]; }
      const out = {}; for (const n of names) out[n] = bt.cols[n];
      out[at.x] = X; out[at.y] = Y; out[at.z] = Z;
      const keep = {}; for (const n of names) keep[n] = out[n];
      yield { ...bt, cols: keep };
    }
  }
  async function fetchRecord(rec) {
    const row = await prov.fetchRecord(rec);
    if (row && xi >= 0 && yi >= 0 && zi >= 0) { applyP(M, +row[xi], +row[yi], +row[zi], o); row[xi] = +o[0].toFixed(4); row[yi] = +o[1].toFixed(4); row[zi] = +o[2].toFixed(4); }
    return row;
  }
  return { ...prov, header, streamChunks, columnBatches: prov.columnBatches ? columnBatches : prov.columnBatches, fetchRecord: prov.fetchRecord ? fetchRecord : prov.fetchRecord };
}

// ── meshes ───────────────────────────────────────────────────────────────────
/** a parsed mesh ({ header, vertices, triangles, attrs }) with its vertices placed (a copy) */
export function placeMesh(m, M) {
  if (!M || !m || !m.vertices) return m;
  const V = new Float64Array(m.vertices.length), o = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) {
    applyP(M, m.vertices[i], m.vertices[i + 1], m.vertices[i + 2], o);
    V[i] = o[0]; V[i + 1] = o[1]; V[i + 2] = o[2];
    for (let a = 0; a < 3; a++) { if (o[a] < min[a]) min[a] = o[a]; if (o[a] > max[a]) max[a] = o[a]; }
  }
  return { ...m, vertices: V, header: { ...m.header, bbox: V.length ? { min, max } : m.header.bbox, placed: true } };
}
/** a soup stream (triangle corners ax…cz + centroids x/y/z) placed */
export function placedSoupStream(src, M) {
  if (!M || !src) return src;
  return async function* placed(opts) {
    const o = [0, 0, 0];
    for await (const c of src(opts)) {
      for (const [X, Y, Z] of [['ax', 'ay', 'az'], ['bx', 'by', 'bz'], ['cx', 'cy', 'cz'], ['x', 'y', 'z']]) {
        const a = f64(c[X]), b = f64(c[Y]), d = f64(c[Z]);
        for (let i = 0; i < c.count; i++) { applyP(M, a[i], b[i], d[i], o); a[i] = o[0]; b[i] = o[1]; d[i] = o[2]; }
        c[X] = a; c[Y] = b; c[Z] = d;
      }
      yield c;
    }
  };
}

// ── grids ────────────────────────────────────────────────────────────────────
/**
 * A grid's effective placement: the file's own (a rotated GeoTIFF / world file — grid.filePlace)
 * then the layer's. A grid shown as a SURFACE takes a rotation about Z only; a tilted placement on
 * one is refused here WITH the reason (a plain points / sheet grid may take any rotation).
 */
export function gridPlaceOf(grid, M, { surface = false } = {}) {
  const P = composeP(M || null, grid.filePlace || null);
  if (P && surface && !zOnlyP(P)) throw new Error('a grid used as a surface (z = f(x, y)) takes a rotation about Z only — this placement tilts it (ω / φ ≠ 0); show it as points, or drop the tilt');
  return P;
}
/**
 * A heightfield mesh (condenser buildHeightfieldMesh: f32 pos relative to a frame origin, normals)
 * placed in place. Build it about the GRID's own origin (buildOrigin — its local frame can sit at
 * 0, 0 while the project is at UTM: building against the project frame would round in f32 before
 * the placement), then this re-expresses it about the project frame's origin.
 */
export const gridBuildFrame = (grid, frame) => ({ ...(frame || {}), origin: [grid.x0, grid.y0, 0] });
export function placeHeightfield(hf, P, buildOrigin, frame) {
  if (!P || !hf) return hf;
  const o0 = buildOrigin, o1 = frame ? frame.origin : [0, 0, 0], q = [0, 0, 0];
  const pos = hf.pos, nrm = hf.normal, R = P.R;
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < hf.count; i++) {
    const k = 3 * i;
    applyP(P, pos[k] + o0[0], pos[k + 1] + o0[1], pos[k + 2] + o0[2], q);
    pos[k] = q[0] - o1[0]; pos[k + 1] = q[1] - o1[1]; pos[k + 2] = q[2] - o1[2];
    for (let a = 0; a < 3; a++) { if (pos[k + a] < bb[a]) bb[a] = pos[k + a]; if (pos[k + a] > bb[a + 3]) bb[a + 3] = pos[k + a]; }
    if (nrm) {
      const nx = nrm[k], ny = nrm[k + 1], nz = nrm[k + 2];
      nrm[k] = R[0] * nx + R[3] * ny + R[6] * nz; nrm[k + 1] = R[1] * nx + R[4] * ny + R[7] * nz; nrm[k + 2] = R[2] * nx + R[5] * ny + R[8] * nz;
    }
  }
  hf.bboxLocal = Float64Array.from(bb);
  return hf;
}

// a layer is "placed" when it carries a non-identity placement
export const isPlaced = (L) => !!layerPlacementM(L);
try { window._microPlacementState = () => S.layers.filter(isPlaced).map((L) => ({ id: L.id, name: L.name, placement: L.placement })); } catch { /* headless */ }
