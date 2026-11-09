// Structure — capivaras in micro: measured joint planes on an outcrop mesh.
//
// The model, in one paragraph. A SET is a value of a categorical paint column on
// the mesh's `vertices` location — so undo, persistence, the filter, the attribute
// table and export are the paint machinery micro already has. A PLANE is a
// connected component of one set's vertices, fitted by area-weighted PCA of their
// POSITIONS (@gcu/clar's fitPlane). Planes are derived, never stored: they are
// re-measured from the paint whenever it changes, so there is no second source of
// truth to drift.
//
// This module owns the geometry: preparing the mesh for analysis (topology,
// normals, area weights), turning a click into a region (the wand and the brush),
// measuring planes, and building what the app draws (vertex colours, plane discs).
// It knows nothing about windows or pointer events — the app wires those.
//
// INDEX SPACES. A mesh's vertex RECORDS are the file's vertices (that is what paint
// is stored against). Topology needs WELDED vertices: a per-face soup repeats every
// corner, and without the weld nothing is adjacent to anything. The ray-hit BVH is
// built on the same weld (bygeom's solidOrientedMesh), so everything here runs in
// welded space and converts to file records at the edge (`toFile`, `weldedCodes`).
// A mesh with nothing to weld has the two spaces identical and pays nothing.

import { buildAdjacency, components, fitPlane, wand, vertexNormals, smoothNormals, vertexAreaWeights, attitude, geodesic } from '../../../ext/clar/index.js';
import { statistics } from '../../../ext/bearing/index.js';
import { weldVertices } from '../../../ext/geometry/index.js';
import { meshVertexData } from './records.js';
import { meshSolidOf } from './bygeom.js';

// ── the cost, stated before it is paid ──
// Bytes the analysis keeps on top of the exact mesh: CSR vertex↔vertex (~6 neighbours)
// and vertex→face adjacency, two normal fields, the area weights, and the weld map
// when there is one. An estimate from the header, so it can be shown before prepare.
export function structureCost(header) {
  const nv = header.vertexCount || Math.ceil((header.triCount || 0) / 2);
  const nt = header.triCount || 0;
  return nv * (4 + 4 + 6 * 4) + nt * 3 * 4 + nv * 12 * 2 + nv * 8;
}

// ── prepare ──
// Cached on the mesh DOC (like the vertex parse): a reload or reinterpret swaps the
// doc, and with it this state, with nobody having to remember to clear it.
export async function prepareStructure(L, { onProgress } = {}) {
  const md = L.docs && L.docs.meshDoc;
  if (!md || md.header.soup) return null;
  if (md._structure) return md._structure;
  if (md._structurePending) return md._structurePending;
  const step = async (msg) => { if (onProgress) onProgress(msg); await new Promise((r) => setTimeout(r)); };
  md._structurePending = (async () => {
    await step('reading the mesh…');
    const file = await meshVertexData(L);                  // the file's vertices = the paint records
    const solid = await meshSolidOf(L);                    // the BVH (welded, world) — the hit test's mesh
    if (!file || !solid) return null;
    const nvFile = file.vertices.length / 3;
    // the weld map file → welded, recomputed with the SAME function the BVH's mesh used,
    // so the indices agree. Nothing welded → the identity (null).
    let remap = null;
    if (solid.welded) {
      const w = weldVertices(file.vertices, file.triangles);
      remap = w.remap;
    }
    const positions = solid.vertices, triangles = solid.triangles;
    const nv = positions.length / 3;
    // welded → file records, as CSR (a welded vertex stands for one or more file vertices)
    let fileOffsets = null, fileList = null;
    if (remap) {
      fileOffsets = new Uint32Array(nv + 1);
      for (let i = 0; i < nvFile; i++) fileOffsets[remap[i] + 1]++;
      for (let j = 0; j < nv; j++) fileOffsets[j + 1] += fileOffsets[j];
      fileList = new Uint32Array(nvFile);
      const cur = fileOffsets.slice(0, nv);
      for (let i = 0; i < nvFile; i++) fileList[cur[remap[i]]++] = i;
    }
    await step('building topology…');
    const adj = buildAdjacency(positions, triangles, { vertexCount: nv });
    await step('estimating normals…');
    // raw normals for the Fisher statistics (their scatter IS the measurement);
    // smoothed ones for the wand (raw photogrammetric normals are too noisy to judge a face by)
    const nRaw = vertexNormals(positions, triangles, nv);
    const nSmooth = smoothNormals(adj, nRaw, 2);
    const weights = vertexAreaWeights(positions, triangles, nv);
    return (md._structure = { nv, nvFile, positions, triangles, adj, nRaw, nSmooth, weights, remap, fileOffsets, fileList, bvh: solid });
  })();
  try { return await md._structurePending; } finally { md._structurePending = null; }
}
export const structureOf = (L) => (L && L.docs && L.docs.meshDoc && L.docs.meshDoc._structure) || null;

// ── index-space conversion ──
export function toFile(st, welded) {
  if (!st.remap) return welded instanceof Uint32Array ? welded : Uint32Array.from(welded);
  let n = 0;
  for (const j of welded) n += st.fileOffsets[j + 1] - st.fileOffsets[j];
  const out = new Uint32Array(n);
  let k = 0;
  for (const j of welded) for (let i = st.fileOffsets[j]; i < st.fileOffsets[j + 1]; i++) out[k++] = st.fileList[i];
  return out;
}
// a welded vertex takes the code of the first file vertex it stands for — the brush
// writes every one of them, so they agree unless someone painted file records by hand
export function weldedCodes(st, fileCodes) {
  if (!st.remap) return fileCodes;
  const out = new Uint8Array(st.nv);
  for (let j = 0; j < st.nv; j++) out[j] = fileCodes[st.fileList[st.fileOffsets[j]]] || 0;
  return out;
}

// ── a click → a region ──
// The seed is the hit triangle's corner nearest the hit (its largest barycentric).
export function seedOf(st, hit) {
  const t = hit.tri * 3, b = hit.bary || [1, 0, 0];
  const k = b[0] >= b[1] && b[0] >= b[2] ? 0 : b[1] >= b[2] ? 1 : 2;
  return st.triangles[t + k];
}
// tool: 'wand' | 'brush'. `exclude` (welded Uint8Array) keeps the walk out of other
// sets. Returns welded vertex indices plus the reference plane the region was judged by.
//
// The BRUSH is the wand capped at a radius around each point of the stroke — not clar's
// view-ray cylinder. The cylinder takes everything connected under the circle at any
// depth, and on an oblique view that reaches round a fold onto the next face: a stroke
// that bleeds over an edge contaminates the plane it was meant to measure (measured on
// the smoke's fold: 9 vertices across, 270/60 read as 269.6/59.0). Capping the wand
// keeps the brush on the face the stroke started on, which is what painting a joint means.
export function regionAt(st, hit, ray, tool, opts = {}, exclude = null) {
  const seed = seedOf(st, hit);
  const w = wand(seed, st.adj, st.positions, st.nSmooth, {
    maxAngle: opts.angle != null ? +opts.angle : 12,
    maxDistance: opts.distance > 0 ? +opts.distance : Infinity,
    radius: tool === 'brush' ? Math.max(1e-6, +opts.radius || 1) : Infinity,
    exclude,
  });
  return { seed, vertices: w.vertices, normal: w.normal, point: w.point };
}

// a quick fit of a region, for the hover preview
export function fitRegion(st, welded) {
  return fitPlane(st.positions, welded, { weights: st.weights, normals: st.nRaw });
}

// ── measure: every set's planes ──
// One plane per connected component of a set's vertices. Rows carry the
// CAPIVARAS/ply2atti columns (spec §4) plus set and the fit's quality, and the
// SIGNED normal — the fit is oriented by the surface normals, i.e. out of the rock,
// which is the polarity an implicit model needs and the attitude alone throws away.
// elongated: e₁/e₀ < 0.01 is a patch ~10× longer than wide — nearly a line, where the
// strike holds and the dip barely does. A 3:1 strip (e₁/e₀ ≈ 0.1) still measures fine.
export const QUALITY = { rough: 0.1, elongated: 0.01, few: 10 };
export function measurePlanes(st, fileCodes, dict, { minVertices = 3 } = {}) {
  const codes = weldedCodes(st, fileCodes);
  const bySet = new Map();
  for (let j = 0; j < st.nv; j++) { const c = codes[j]; if (c) { let a = bySet.get(c); if (!a) bySet.set(c, (a = [])); a.push(j); } }
  const planes = [];
  for (const [code, verts] of [...bySet].sort((a, b) => a[0] - b[0])) {
    const { labels, count } = components(st.adj, verts);
    const groups = Array.from({ length: count }, () => []);
    for (const v of verts) groups[labels[v]].push(v);
    for (const g of groups) {
      if (g.length < minVertices) continue;
      const idx = Uint32Array.from(g);
      const f = fitPlane(st.positions, idx, { weights: st.weights, normals: st.nRaw });
      if (!f || f.degenerate) continue;
      const [e0, e1, e2] = f.eig;
      const flags = [];
      if (f.eigRatio21 > QUALITY.rough) flags.push('rough');
      if (e0 > 0 && e1 / e0 < QUALITY.elongated) flags.push('elongated');
      if (f.n < QUALITY.few) flags.push('few');
      planes.push({
        plane_id: planes.length + 1, set: dict[code], code, source: 'patch',
        dip_direction: f.dipDirection, dip: f.dip,
        X: f.centroid[0], Y: f.centroid[1], Z: f.centroid[2],
        nx: f.normal[0], ny: f.normal[1], nz: f.normal[2],
        eig0: e0, eig1: e1, eig2: e2, n_vertices: f.n,
        average_resultant_length: f.fisher ? f.fisher.Rbar : null,
        kappa: f.fisher ? f.fisher.kappa : null,
        radius: f.radius, rms: f.rms, eig_ratio: f.eigRatio21,
        flags, _verts: idx, _axes: [f.axes[0], f.axes[1]],
      });
    }
  }
  return planes;
}
// a plane's POLE: the downward unit normal (bearing's convention; either sign of the
// fit gives the same plane)
export const poleOf = (p) => (p.nz > 0 ? [-p.nx, -p.ny, -p.nz] : [p.nx, p.ny, p.nz]);
// A set's statistics: Fisher over its planes' poles, one plane = one observation (the
// usual practice — a stereonet counts measurements, not square metres). Poles are first
// aligned to one another, not just folded down: a set of near-vertical joints straddles
// the horizontal, and folding each pole down independently would split it in two.
export function setStats(planes, code) {
  const poles = [];
  for (const p of planes) if (p.code === code) {
    const q = poleOf(p);
    if (poles.length && q[0] * poles[0][0] + q[1] * poles[0][1] + q[2] * poles[0][2] < 0) { q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; }
    poles.push(q);
  }
  if (!poles.length) return { n: 0 };
  const f = statistics.fisherStats(poles);
  const mean = f.mean[2] > 0 ? f.mean.map((v) => -v) : f.mean;
  const { dipDirection, dip } = attitude(mean);
  return { n: f.n, mean, kappa: f.kappa, alpha95: f.alpha95, Rbar: f.Rbar, dip_direction: dipDirection, dip, poles };
}

// ── colour by orientation (Coltop3D's idea) ──
// hue = dip direction, saturation = dip (a horizontal surface is white), from the
// SMOOTHED normals so photogrammetric noise doesn't speckle it. Joint sets show up as
// patches of one colour before anything is painted.
export function orientationRgb(nx, ny, nz, out = [0, 0, 0]) {
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }            // a plane, not a vector: the up side
  const dip = Math.acos(Math.min(1, nz)) * 180 / Math.PI;
  const dd = (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360;
  const s = Math.min(1, dip / 90), v = 0.95;
  const h = dd / 60, i = Math.floor(h) % 6, fr = h - Math.floor(h);
  const p = v * (1 - s), q = v * (1 - s * fr), t = v * (1 - s * (1 - fr));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}
// per-FILE-vertex orientation colours (a welded vertex's normal for each file vertex)
export function orientationColors(st) {
  const rgb = new Float32Array(st.nvFile * 3), c = [0, 0, 0], n = st.nSmooth;
  for (let i = 0; i < st.nvFile; i++) {
    const j = st.remap ? st.remap[i] : i;
    orientationRgb(n[3 * j], n[3 * j + 1], n[3 * j + 2], c);
    rgb[3 * i] = c[0]; rgb[3 * i + 1] = c[1]; rgb[3 * i + 2] = c[2];
  }
  return rgb;
}

// ── what the app draws ──
const hexRgb = (h) => { const v = parseInt(String(h || '#000000').replace('#', ''), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
// per-FILE-vertex rgb: the set colour where painted, else the base (the mesh's own
// vertex colours, or its tint). `preview` (file indices) is drawn in the active set's
// colour, lightened, without being painted.
export function vertexColors(nvFile, fileCodes, colors, base, preview = null, previewHex = null) {
  const rgb = new Float32Array(nvFile * 3);
  const tint = Array.isArray(base) ? base : null;
  const pal = colors.map(hexRgb);
  for (let i = 0; i < nvFile; i++) {
    const c = fileCodes[i];
    if (c && pal[c]) { rgb[3 * i] = pal[c][0]; rgb[3 * i + 1] = pal[c][1]; rgb[3 * i + 2] = pal[c][2]; }
    else if (tint) { rgb[3 * i] = tint[0]; rgb[3 * i + 1] = tint[1]; rgb[3 * i + 2] = tint[2]; }
    else { rgb[3 * i] = base[3 * i]; rgb[3 * i + 1] = base[3 * i + 1]; rgb[3 * i + 2] = base[3 * i + 2]; }
  }
  if (preview && preview.length) {
    const p = hexRgb(previewHex || '#ffffff');
    const q = [0.35 + 0.65 * p[0], 0.35 + 0.65 * p[1], 0.35 + 0.65 * p[2]];
    for (const i of preview) { rgb[3 * i] = q[0]; rgb[3 * i + 1] = q[1]; rgb[3 * i + 2] = q[2]; }
  }
  return rgb;
}
// plane discs: one fan per plane at its centroid, in its plane. An ELLIPSE on the fit's
// own in-plane axes, semi-axes √3·σ (a uniform strip of half-length a has σ = a/√3), so
// it covers the patch's footprint — a circle at the patch's reach swamps an elongated
// strip. World coordinates; per-vertex colour = the set's. Drawn over the outcrop, a
// wrong fit is a disc cutting into the rock — that visibility is the point.
export function discMesh(planes, colorOf, { segments = 32, lift = 0.01 } = {}) {
  const nP = planes.length, per = segments + 1;
  const vertices = new Float64Array(nP * per * 3), color = new Float32Array(nP * per * 3);
  const triangles = new Uint32Array(nP * segments * 3);
  let v = 0, t = 0;
  for (const p of planes) {
    const n = [p.nx, p.ny, p.nz];
    let u, w;
    if (p._axes) [u, w] = p._axes;
    else {
      const a = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      u = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
      const ul = Math.hypot(...u); u = u.map((x) => x / ul);
      w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    }
    const ra = p._axes ? Math.sqrt(3 * Math.max(0, p.eig0)) : p.radius;
    const rb = p._axes ? Math.sqrt(3 * Math.max(0, p.eig1)) : p.radius;
    const off = lift * Math.max(1, ra);                    // a hair off the rock, on its outward side
    const cx = p.X + n[0] * off, cy = p.Y + n[1] * off, cz = p.Z + n[2] * off;
    // lighter than the paint under it: a well-fitted disc lies flush on its face, and in the
    // set's own colour it would vanish into the paint it measures
    const col = hexRgb(colorOf(p)).map((x) => 0.45 + 0.55 * x);
    const c0 = v;
    const put = (x, y, z) => { vertices[3 * v] = x; vertices[3 * v + 1] = y; vertices[3 * v + 2] = z; color[3 * v] = col[0]; color[3 * v + 1] = col[1]; color[3 * v + 2] = col[2]; v++; };
    put(cx, cy, cz);
    for (let s = 0; s < segments; s++) {
      const ang = (2 * Math.PI * s) / segments, cs = Math.cos(ang) * ra, sn = Math.sin(ang) * rb;
      put(cx + u[0] * cs + w[0] * sn, cy + u[1] * cs + w[1] * sn, cz + u[2] * cs + w[2] * sn);
    }
    for (let s = 0; s < segments; s++) { triangles[t++] = c0; triangles[t++] = c0 + 1 + s; triangles[t++] = c0 + 1 + ((s + 1) % segments); }
  }
  return { vertices, triangles, color };
}

// ── traces: a fracture's line across the rock ──
// A trace is { set, pts, path }: the control points the geologist clicked and the
// path between them ALONG THE SURFACE (shortest path over the mesh, clar's
// geodesic), both as FILE vertex indices — the records, like the paint. Where a
// joint has no exposed face, its trace is the only evidence of it, and a plane
// fitted through a trace that crosses relief measures it (Compass's trace tool).

// welded → the file record that stands for it (the first, if several do)
export const fileOf = (st, j) => (st.remap ? st.fileList[st.fileOffsets[j]] : j);
// the surface path between two welded vertices, as welded indices (null: unreachable)
export function surfacePath(st, a, b) {
  if (a === b) return Uint32Array.of(a);
  const g = geodesic(a, b, st.adj, st.positions);
  return g ? g.path : null;
}
// a trace's plane. Without relief a trace is a straight line, which fixes the strike
// and nothing else — `straight` says so rather than reporting a confident dip.
export const TRACE_STRAIGHT = 0.01;
export function tracePlanes(vertices, traces, dict) {
  const out = [];
  traces.forEach((t, k) => {
    if (!t.path || t.path.length < 3) return;
    const f = fitPlane(vertices, Uint32Array.from(t.path));
    if (!f) return;
    const [e0, e1, e2] = f.eig;
    let len = 0;
    for (let i = 1; i < t.path.length; i++) { const a = t.path[i - 1] * 3, b = t.path[i] * 3; len += Math.hypot(vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]); }
    const flags = [];
    if (f.degenerate || (e0 > 0 && e1 / e0 < TRACE_STRAIGHT)) flags.push('straight');
    if (f.eigRatio21 > QUALITY.rough) flags.push('rough');
    out.push({
      plane_id: 0, set: dict[t.set] || '', code: t.set, source: 'trace',
      dip_direction: f.dipDirection, dip: f.dip,
      X: f.centroid[0], Y: f.centroid[1], Z: f.centroid[2],
      nx: f.normal[0], ny: f.normal[1], nz: f.normal[2],    // a trace has no outward side: the pole, downward
      eig0: e0, eig1: e1, eig2: e2, n_vertices: f.n,
      average_resultant_length: null, kappa: null,
      radius: f.radius, rms: f.rms, eig_ratio: f.eigRatio21, length: len,
      flags, _trace: k, _axes: [f.axes[0], f.axes[1]],
    });
  });
  return out;
}
// tubes along trace paths (each segment a hexagonal prism), for the derived traces layer
export function traceTubes(vertices, paths, colorOf, radius) {
  const SIDES = 6;
  let nSeg = 0;
  for (const p of paths) if (p.path && p.path.length > 1) nSeg += p.path.length - 1;
  const V = new Float64Array(nSeg * SIDES * 2 * 3), C = new Float32Array(nSeg * SIDES * 2 * 3), T = new Uint32Array(nSeg * SIDES * 6);
  let v = 0, t = 0;
  for (const p of paths) {
    if (!p.path || p.path.length < 2) continue;
    const col = colorOf(p);
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1] * 3, b = p.path[i] * 3;
      const d = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]];
      const L = Math.hypot(...d) || 1; d[0] /= L; d[1] /= L; d[2] /= L;
      const h = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let u = [d[1] * h[2] - d[2] * h[1], d[2] * h[0] - d[0] * h[2], d[0] * h[1] - d[1] * h[0]];
      const ul = Math.hypot(...u); u = u.map((x) => x / ul);
      const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      const base = v;
      for (const e of [a, b]) for (let s = 0; s < SIDES; s++) {
        const ang = (2 * Math.PI * s) / SIDES, cs = Math.cos(ang) * radius, sn = Math.sin(ang) * radius;
        V[3 * v] = vertices[e] + u[0] * cs + w[0] * sn; V[3 * v + 1] = vertices[e + 1] + u[1] * cs + w[1] * sn; V[3 * v + 2] = vertices[e + 2] + u[2] * cs + w[2] * sn;
        C[3 * v] = col[0]; C[3 * v + 1] = col[1]; C[3 * v + 2] = col[2]; v++;
      }
      for (let s = 0; s < SIDES; s++) {
        const s1 = (s + 1) % SIDES, a0 = base + s, a1 = base + s1, b0 = base + SIDES + s, b1 = base + SIDES + s1;
        T[t++] = a0; T[t++] = a1; T[t++] = b1; T[t++] = a0; T[t++] = b1; T[t++] = b0;
      }
    }
  }
  return { vertices: V, triangles: T, color: C };
}
