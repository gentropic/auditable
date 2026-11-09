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

import { buildAdjacency, components, fitPlane, wand, vertexNormals, smoothNormals, vertexAreaWeights } from '../../../ext/clar/index.js';
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
        plane_id: planes.length + 1, set: dict[code], code,
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
// a set's mean attitude: the resultant of its planes' normals, each weighted by its
// vertex count (a large plane is more of the observation than a sliver)
export function setSummary(planes, code) {
  let x = 0, y = 0, z = 0, w = 0, n = 0;
  for (const p of planes) if (p.code === code) {
    const s = p.nz > 0 ? -1 : 1;                           // fold to the lower hemisphere: planes, not vectors
    x += s * p.nx * p.n_vertices; y += s * p.ny * p.n_vertices; z += s * p.nz * p.n_vertices; w += p.n_vertices; n++;
  }
  if (!n) return { n: 0 };
  const L = Math.hypot(x, y, z);
  return { n, normal: [x / L, y / L, z / L], Rbar: L / w };
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
