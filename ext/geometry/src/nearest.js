// Point → mesh: the nearest point on a triangle mesh, over the BVH this package
// already builds, and the SIDE of the mesh a point is on.
//
// The distance half is exact (Ericson, Real-Time Collision Detection §5.1.5:
// closest point on a triangle by Voronoi region, then a best-first BVH descent
// pruned by box distance). The side half is the angle-weighted PSEUDO-NORMAL of
// the nearest feature (Bærentzen & Aanæs 2005): the face normal when the nearest
// point is inside a face, the sum of the two face normals on an edge, the
// angle-weighted sum on a vertex — the one choice for which sign((p − q) · n) is
// right everywhere on a consistently wound closed mesh, including the regions
// outside a sharp edge or corner where the plain face normal lies.
//
// Geological wireframes are rarely wound consistently, so `orientTriangles`
// flips each connected piece to agree with its first triangle (a BFS over shared
// edges) before the pseudo-normals are taken. A closed solid's inside is better
// answered by a winding number (robust to an open rim) — this is for the side of
// an OPEN surface, and for tests.
//
// The BVH's bounds are float32 (the GPU layout). At UTM magnitudes a float32
// bound is off by up to ~0.5 m, so the descent pads every box by the rounding
// error of the largest coordinate (`slack`): a slightly wider search, never a
// missed nearer triangle.

import { NODE_SIZE } from './bvh.js';

// region codes written to out[3]
export const NEAREST_FACE = 0, NEAREST_V0 = 1, NEAREST_V1 = 2, NEAREST_V2 = 3, NEAREST_E01 = 4, NEAREST_E12 = 5, NEAREST_E20 = 6;

/**
 * Closest point on triangle (a, b, c) to p. Writes [x, y, z, region] into `out`
 * and returns the SQUARED distance.
 */
export function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz, reg;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; reg = NEAREST_V0; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; reg = NEAREST_V1; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; reg = NEAREST_E01;
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; reg = NEAREST_V2; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; reg = NEAREST_E20;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); reg = NEAREST_E12;
            } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; reg = NEAREST_FACE;
            }
          }
        }
      }
    }
  }
  out[0] = qx; out[1] = qy; out[2] = qz; out[3] = reg;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

// the float32 rounding error of the largest |coordinate| a BVH's bounds carry
export function bvhSlack(nodes) {
  let m = 0;
  for (let i = 0; i < 6; i++) { const v = Math.abs(nodes[i]); if (v > m) m = v; }   // the root's bounds hold every coordinate
  return m * 2.4e-7 + 1e-9;                                // 2 ulp of float32 at that magnitude
}

const _stack = [], _q = new Float64Array(4);

// squared distance from p to a node's box, the box padded by `pad` on every side
function boxDist2(nodes, off, px, py, pz, pad) {
  let d, s = 0;
  d = nodes[off] - px; if (d < px - nodes[off + 3]) d = px - nodes[off + 3]; d -= pad; if (d > 0) s += d * d;
  d = nodes[off + 1] - py; if (d < py - nodes[off + 4]) d = py - nodes[off + 4]; d -= pad; if (d > 0) s += d * d;
  d = nodes[off + 2] - pz; if (d < pz - nodes[off + 5]) d = pz - nodes[off + 5]; d -= pad; if (d > 0) s += d * d;
  return s;
}

/**
 * Nearest point of a BVH-accelerated triangle mesh to `point`.
 *
 * @param {object} mesh  { vertices, triangles, nodes, triIndices } — buildBVH's fields
 *                       flattened in (the shape micro caches per mesh layer)
 * @param {number[]} point
 * @param {object} [opts] { maxDist } — nothing farther is looked for (→ null);
 *                        { slack } — the box padding (default: bvhSlack(nodes))
 * @returns {?{tri:number, dist:number, point:number[], feature:'face'|'edge'|'vertex', verts:number[]}}
 *   verts: the nearest feature's mesh vertex indices — 3 (face), 2 (edge) or 1 (vertex)
 */
export function nearestBVH(mesh, point, { maxDist = Infinity, slack } = {}) {
  const { vertices: V, triangles: T, nodes, triIndices } = mesh;
  if (!nodes || !nodes.length || !triIndices || !triIndices.length) return null;
  const px = point[0], py = point[1], pz = point[2];
  const pad = slack != null ? slack : (mesh._slack != null ? mesh._slack : (mesh._slack = bvhSlack(nodes)));
  let best2 = maxDist === Infinity ? Infinity : maxDist * maxDist, bestTri = -1, bx = 0, by = 0, bz = 0, breg = 0;
  const boxD2 = (off) => boxDist2(nodes, off, px, py, pz, pad);
  const st = _stack; let sp = 0;
  if (boxD2(0) > best2) return null;
  st[sp++] = 0;
  while (sp) {
    const ni = st[--sp], off = ni * NODE_SIZE;
    if (boxD2(off) > best2) continue;                      // a nearer triangle turned up since this was pushed
    const data2 = nodes[off + 7];
    if (data2 > 0) {                                       // leaf: data1 = first, data2 = count
      const first = nodes[off + 6];
      for (let i = first; i < first + data2; i++) {
        const ti = triIndices[i], a = T[ti * 3] * 3, b = T[ti * 3 + 1] * 3, c = T[ti * 3 + 2] * 3;
        const d2 = closestPointOnTriangle(px, py, pz, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2], _q);
        if (d2 < best2) { best2 = d2; bestTri = ti; bx = _q[0]; by = _q[1]; bz = _q[2]; breg = _q[3]; }
      }
    } else {                                               // internal: the nearer child is popped first
      const l = nodes[off + 6], r = -data2 - 1;
      const dl = boxD2(l * NODE_SIZE), dr = boxD2(r * NODE_SIZE);
      if (dl <= dr) { if (dr <= best2) st[sp++] = r; if (dl <= best2) st[sp++] = l; }
      else { if (dl <= best2) st[sp++] = l; if (dr <= best2) st[sp++] = r; }
    }
  }
  if (bestTri < 0) return null;
  const i0 = T[bestTri * 3], i1 = T[bestTri * 3 + 1], i2 = T[bestTri * 3 + 2];
  const feature = breg === NEAREST_FACE ? 'face' : breg <= NEAREST_V2 ? 'vertex' : 'edge';
  const verts = breg === NEAREST_FACE ? [i0, i1, i2] : breg === NEAREST_V0 ? [i0] : breg === NEAREST_V1 ? [i1] : breg === NEAREST_V2 ? [i2]
    : breg === NEAREST_E01 ? [i0, i1] : breg === NEAREST_E12 ? [i1, i2] : [i2, i0];
  return { tri: bestTri, dist: Math.sqrt(best2), point: [bx, by, bz], feature, verts };
}

const edgeKey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/**
 * Wind every connected piece of a triangle mesh consistently: a BFS over shared
 * edges flips each triangle to traverse a shared edge opposite to its neighbour.
 * Non-manifold edges (3+ faces) are left as they come. → { triangles (a new
 * Uint32Array), flipped, pieces }. The first triangle of each piece keeps its winding.
 */
export function orientTriangles(triangles) {
  const T = Uint32Array.from(triangles), nT = T.length / 3;
  const edges = new Map();                                 // edge → [tri, tri?]
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) {
    const k = edgeKey(T[t * 3 + e], T[t * 3 + (e + 1) % 3]);
    const l = edges.get(k); if (l) l.push(t); else edges.set(k, [t]);
  }
  const seen = new Uint8Array(nT), queue = new Int32Array(nT);
  let flipped = 0, pieces = 0;
  const dirOf = (t, a, b) => { for (let e = 0; e < 3; e++) { if (T[t * 3 + e] === a && T[t * 3 + (e + 1) % 3] === b) return 1; if (T[t * 3 + e] === b && T[t * 3 + (e + 1) % 3] === a) return -1; } return 0; };
  for (let s = 0; s < nT; s++) {
    if (seen[s]) continue;
    pieces++; seen[s] = 1;
    let qh = 0, qt = 0; queue[qt++] = s;
    while (qh < qt) {
      const t = queue[qh++];
      for (let e = 0; e < 3; e++) {
        const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
        const l = edges.get(edgeKey(a, b));
        if (!l || l.length !== 2) continue;                // a boundary or a non-manifold edge: nothing to agree with
        const u = l[0] === t ? l[1] : l[0];
        if (seen[u]) continue;
        seen[u] = 1;
        if (dirOf(u, a, b) === 1) { const tmp = T[u * 3 + 1]; T[u * 3 + 1] = T[u * 3 + 2]; T[u * 3 + 2] = tmp; flipped++; }   // same direction → flip u
        queue[qt++] = u;
      }
    }
  }
  return { triangles: T, flipped, pieces };
}

/**
 * Angle-weighted pseudo-normals of a mesh (as wound — orient it first).
 * → { face: Float64Array(3·nT) unit face normals, vertex: Float64Array(3·nV) angle-weighted,
 *     edge: Map(edgeKey → [x, y, z]) the sum of the adjacent face normals }
 */
export function pseudoNormals(vertices, triangles) {
  const V = vertices, T = triangles, nT = T.length / 3, nV = V.length / 3;
  const face = new Float64Array(nT * 3), vertex = new Float64Array(nV * 3), edge = new Map();
  for (let t = 0; t < nT; t++) {
    const i = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
    const P = i.map((k) => [V[k * 3], V[k * 3 + 1], V[k * 3 + 2]]);
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz); if (!(nl > 0)) continue;
    nx /= nl; ny /= nl; nz /= nl;
    face[t * 3] = nx; face[t * 3 + 1] = ny; face[t * 3 + 2] = nz;
    for (let c = 0; c < 3; c++) {                          // the corner angle at each vertex
      const a = P[c], b = P[(c + 1) % 3], d = P[(c + 2) % 3];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
      const ang = lu > 0 && lv > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv)))) : 0;
      vertex[i[c] * 3] += ang * nx; vertex[i[c] * 3 + 1] += ang * ny; vertex[i[c] * 3 + 2] += ang * nz;
      const k = edgeKey(i[c], i[(c + 1) % 3]), en = edge.get(k);
      if (en) { en[0] += nx; en[1] += ny; en[2] += nz; } else edge.set(k, [nx, ny, nz]);
    }
  }
  return { face, vertex, edge };
}

/**
 * Which side of the mesh `point` is on, from a nearestBVH hit and the mesh's
 * pseudo-normals: +1 the side the normals face, −1 the other, 0 on the mesh.
 */
export function sideOf(pn, hit, point) {
  const dx = point[0] - hit.point[0], dy = point[1] - hit.point[1], dz = point[2] - hit.point[2];
  let n;
  if (hit.feature === 'face') n = [pn.face[hit.tri * 3], pn.face[hit.tri * 3 + 1], pn.face[hit.tri * 3 + 2]];
  else if (hit.feature === 'edge') n = pn.edge.get(edgeKey(hit.verts[0], hit.verts[1])) || [pn.face[hit.tri * 3], pn.face[hit.tri * 3 + 1], pn.face[hit.tri * 3 + 2]];
  else { const v = hit.verts[0]; n = [pn.vertex[v * 3], pn.vertex[v * 3 + 1], pn.vertex[v * 3 + 2]]; }
  const s = dx * n[0] + dy * n[1] + dz * n[2];
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}
