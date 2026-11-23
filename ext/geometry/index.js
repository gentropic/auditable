// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/geometry — Robust geometry base: BVH build and ray queries, CSR mesh topology (vertex-vertex and vertex-face adjacency), connected components. Zero dependencies, typed arrays throughout.

// ── src/bvh.js ──

// BVH (Bounding Volume Hierarchy) construction for triangle meshes
// Flat array layout for GPU-friendly traversal

// (superseded — see the 16-float layout above)
// [min_x, min_y, min_z, max_x, max_y, max_z, left_or_first, count_or_right]
// Leaf: count > 0, first = index into reordered tri_indices
// Internal: count = 0, left/right = child node indices

const NODE_SIZE = 16;
// Node layout (16 floats):
//   [0..5]  min/max bounds
//   [6..7]  data1/data2 (leaf: first/count; internal: left/-(right)-1)
//   [8..10] area-weighted centroid of the subtree's triangles
//   [11..13] vector area (Σ ½·e1×e2 — the far-field dipole strength)
//   [14]    conservative subtree radius (centroid → farthest bbox corner)
//   [15]    pad

function triCentroid(vertices, triangles, triIdx, axis) {
  const i0 = triangles[triIdx * 3] * 3 + axis;
  const i1 = triangles[triIdx * 3 + 1] * 3 + axis;
  const i2 = triangles[triIdx * 3 + 2] * 3 + axis;
  return (vertices[i0] + vertices[i1] + vertices[i2]) / 3;
}

function triBounds(vertices, triangles, triIdx) {
  const a = triangles[triIdx * 3], b = triangles[triIdx * 3 + 1], c = triangles[triIdx * 3 + 2];
  const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
  const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
  const cx = vertices[c * 3], cy = vertices[c * 3 + 1], cz = vertices[c * 3 + 2];
  return [
    Math.min(ax, bx, cx), Math.min(ay, by, cy), Math.min(az, bz, cz),
    Math.max(ax, bx, cx), Math.max(ay, by, cy), Math.max(az, bz, cz),
  ];
}

function triArea2(vertices, triangles, triIdx) {
  // Returns 2x the squared area (avoids sqrt)
  const a = triangles[triIdx * 3], b = triangles[triIdx * 3 + 1], c = triangles[triIdx * 3 + 2];
  const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
  const bx = vertices[b * 3] - ax, by = vertices[b * 3 + 1] - ay, bz = vertices[b * 3 + 2] - az;
  const cx = vertices[c * 3] - ax, cy = vertices[c * 3 + 1] - ay, cz = vertices[c * 3 + 2] - az;
  // cross product magnitude squared
  const nx = by * cz - bz * cy;
  const ny = bz * cx - bx * cz;
  const nz = bx * cy - by * cx;
  return nx * nx + ny * ny + nz * nz;
}

function buildBVH(vertices, triangles, { maxLeafSize = 4, degenerateEpsilon = 1e-6 } = {}) {
  const nTris = triangles.length / 3;
  if (nTris === 0) return { nodes: new Float32Array(0), triIndices: new Uint32Array(0), degenerateCount: 0 };

  // Compute mesh bounding box diagonal for degenerate threshold
  let mx0 = Infinity, my0 = Infinity, mz0 = Infinity;
  let mx1 = -Infinity, my1 = -Infinity, mz1 = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    mx0 = Math.min(mx0, vertices[i]); my0 = Math.min(my0, vertices[i + 1]); mz0 = Math.min(mz0, vertices[i + 2]);
    mx1 = Math.max(mx1, vertices[i]); my1 = Math.max(my1, vertices[i + 1]); mz1 = Math.max(mz1, vertices[i + 2]);
  }
  const diag = Math.sqrt((mx1 - mx0) ** 2 + (my1 - my0) ** 2 + (mz1 - mz0) ** 2);
  const areaThresh = (degenerateEpsilon * diag) ** 2;

  // Filter out degenerate triangles
  const validIndices = [];
  let degenerateCount = 0;
  for (let i = 0; i < nTris; i++) {
    if (triArea2(vertices, triangles, i) < areaThresh) {
      degenerateCount++;
    } else {
      validIndices.push(i);
    }
  }

  const n = validIndices.length;
  if (n === 0) return { nodes: new Float32Array(NODE_SIZE), triIndices: new Uint32Array(0), degenerateCount };

  // Working array of triangle indices (will be reordered by BVH build)
  const triIdx = new Uint32Array(validIndices);

  // Pre-allocate nodes (worst case: 2n-1 nodes for n leaves)
  const maxNodes = Math.max(2 * n, 1);
  const nodes = new Float32Array(maxNodes * NODE_SIZE);
  let nodeCount = 0;

  function allocNode() {
    return nodeCount++;
  }

  function computeBounds(start, count) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = start; i < start + count; i++) {
      const b = triBounds(vertices, triangles, triIdx[i]);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
      x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
    }
    return [x0, y0, z0, x1, y1, z1];
  }

  function buildNode(start, count) {
    const idx = allocNode();
    const off = idx * NODE_SIZE;
    const bounds = computeBounds(start, count);
    nodes[off] = bounds[0]; nodes[off + 1] = bounds[1]; nodes[off + 2] = bounds[2];
    nodes[off + 3] = bounds[3]; nodes[off + 4] = bounds[4]; nodes[off + 5] = bounds[5];

    // Barill-style far-field data (Fast Winding Numbers, SIGGRAPH 2018):
    // the subtree's triangles as one dipole — area-weighted centroid, vector
    // area, and a conservative radius. Computed per node from its (contiguous,
    // already-partitioned) triangle range.
    {
      let aw = 1e-30, cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0;
      for (let i = start; i < start + count; i++) {
        const ti = triIdx[i];
        const a = triangles[ti * 3] * 3, b = triangles[ti * 3 + 1] * 3, c = triangles[ti * 3 + 2] * 3;
        const e1x = vertices[b] - vertices[a], e1y = vertices[b + 1] - vertices[a + 1], e1z = vertices[b + 2] - vertices[a + 2];
        const e2x = vertices[c] - vertices[a], e2y = vertices[c + 1] - vertices[a + 1], e2z = vertices[c + 2] - vertices[a + 2];
        const vx = (e1y * e2z - e1z * e2y) / 2, vy = (e1z * e2x - e1x * e2z) / 2, vz = (e1x * e2y - e1y * e2x) / 2;
        const area = Math.sqrt(vx * vx + vy * vy + vz * vz);
        aw += area;
        cxs += area * (vertices[a] + vertices[b] + vertices[c]) / 3;
        cys += area * (vertices[a + 1] + vertices[b + 1] + vertices[c + 1]) / 3;
        czs += area * (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3;
        nxs += vx; nys += vy; nzs += vz;
      }
      const ccx = cxs / aw, ccy = cys / aw, ccz = czs / aw;
      let r2 = 0;
      for (let ci = 0; ci < 8; ci++) {
        const px2 = bounds[(ci & 1) ? 3 : 0] - ccx;
        const py2 = bounds[(ci & 2) ? 4 : 1] - ccy;
        const pz2 = bounds[(ci & 4) ? 5 : 2] - ccz;
        const d2 = px2 * px2 + py2 * py2 + pz2 * pz2;
        if (d2 > r2) r2 = d2;
      }
      nodes[off + 8] = ccx; nodes[off + 9] = ccy; nodes[off + 10] = ccz;
      nodes[off + 11] = nxs; nodes[off + 12] = nys; nodes[off + 13] = nzs;
      nodes[off + 14] = Math.sqrt(r2);
      nodes[off + 15] = 0;
    }

    if (count <= maxLeafSize) {
      // Leaf node
      nodes[off + 6] = start;  // first
      nodes[off + 7] = count;  // count > 0 means leaf
      return idx;
    }

    // Split along longest axis
    const dx = bounds[3] - bounds[0];
    const dy = bounds[4] - bounds[1];
    const dz = bounds[5] - bounds[2];
    const axis = dx >= dy && dx >= dz ? 0 : dy >= dz ? 1 : 2;

    // Median split: partition triIdx[start..start+count) by centroid
    const mid = start + (count >> 1);
    // Partial sort: nth_element approximation via simple partitioning
    partialSort(vertices, triangles, triIdx, start, start + count, mid, axis);

    const leftChild = buildNode(start, mid - start);
    const rightChild = buildNode(mid, start + count - mid);

    // Internal node
    nodes[off + 6] = leftChild;
    nodes[off + 7] = rightChild;
    // count = 0 means internal (already 0 from Float32Array init, but be explicit)
    // Wait — we used off+7 for right child. We need a way to distinguish leaf vs internal.
    // Convention: encode count in a separate way. Let's use:
    // off+6: for leaf = first_tri_index, for internal = left_child (as float, reinterpreted as int)
    // off+7: for leaf = count (> 0), for internal = right_child (reinterpreted, count=0 not possible since we store right)
    // Problem: right_child could be 0. Let's use negative count trick:
    // Actually, let's use a simpler approach: store count separately.
    // Revised layout: [minx, miny, minz, maxx, maxy, maxz, data1, data2]
    // Leaf: data1 = first, data2 = count (> 0)
    // Internal: data1 = left, data2 = -(right) - 1 (negative = internal flag)
    // Or even simpler: use the sign of data2. Positive = leaf count, negative = encode right child.

    // Use negative data2 to indicate internal node:
    // data2 < 0: internal, left = data1, right = -(data2) - 1
    // data2 > 0: leaf, first = data1, count = data2
    nodes[off + 6] = leftChild;
    nodes[off + 7] = -(rightChild) - 1;

    return idx;
  }

  buildNode(0, n);

  return {
    nodes: nodes.slice(0, nodeCount * NODE_SIZE),
    triIndices: triIdx,
    degenerateCount,
    nodeCount,
  };
}

function partialSort(vertices, triangles, indices, lo, hi, mid, axis) {
  // Simple quickselect to partition around median
  if (hi - lo <= 1) return;

  let left = lo, right = hi - 1;
  const pivotIdx = lo + ((hi - lo) >> 1);
  const pivotVal = triCentroid(vertices, triangles, indices[pivotIdx], axis);

  // Move pivot to end
  const tmp0 = indices[pivotIdx]; indices[pivotIdx] = indices[right]; indices[right] = tmp0;

  let store = lo;
  for (let i = lo; i < right; i++) {
    if (triCentroid(vertices, triangles, indices[i], axis) < pivotVal) {
      const t = indices[store]; indices[store] = indices[i]; indices[i] = t;
      store++;
    }
  }
  const t = indices[store]; indices[store] = indices[right]; indices[right] = t;

  if (store < mid) partialSort(vertices, triangles, indices, store + 1, hi, mid, axis);
  else if (store > mid) partialSort(vertices, triangles, indices, lo, store, mid, axis);
}

// ── src/ray.js ──

// Ray → mesh, over the BVH this package already builds.
//
// The GPU ID-buffer answers WHICH layer is under the cursor; it cannot answer
// which TRIANGLE (WebGL2 has no gl_PrimitiveID, and un-indexing a mesh just to
// carry a per-vertex triangle id would triple its vertex memory). So the CPU
// answers it — against the same BVH the solid queries use, so a mesh that has
// been interrogated once picks for free.
//
// Möller–Trumbore, TWO-SIDED: geological wireframes are rarely consistently
// wound, and a surface you can see from below is a surface you can click from
// below. The returned normal is flipped to face the ray, matching the shading.


/**
 * Nearest hit of a ray against a BVH-accelerated triangle mesh.
 *
 * @param {object} mesh   { vertices, triangles, nodes, triIndices } — the shape
 *                        micro caches per mesh layer (bvh fields flattened in).
 * @param {number[]} origin  ray origin, same space as `vertices`
 * @param {number[]} dir     ray direction (need not be normalised)
 * @param {object} [opts]  { maxT } — ignore hits beyond this distance
 * @returns {?{tri:number, t:number, point:number[], normal:number[], bary:number[]}}
 */
function raycastBVH(mesh, origin, dir, { maxT = Infinity } = {}) {
  const { vertices, triangles, nodes, triIndices } = mesh;
  if (!nodes || !nodes.length || !triIndices || !triIndices.length) return null;

  const [ox, oy, oz] = origin;
  let [dx, dy, dz] = dir;
  const dl = Math.hypot(dx, dy, dz);
  if (!(dl > 0)) return null;
  dx /= dl; dy /= dl; dz /= dl;                            // unit ray → t IS a distance
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;             // ±Infinity is fine: the slab test handles it

  let best = maxT, bestTri = -1, bu = 0, bv = 0;
  const stack = [0];

  while (stack.length) {
    const off = stack.pop() * NODE_SIZE;

    // slab test against the node's bounds — miss, or entirely behind our best hit
    const t1x = (nodes[off] - ox) * ix, t2x = (nodes[off + 3] - ox) * ix;
    const t1y = (nodes[off + 1] - oy) * iy, t2y = (nodes[off + 4] - oy) * iy;
    const t1z = (nodes[off + 2] - oz) * iz, t2z = (nodes[off + 5] - oz) * iz;
    const tNear = Math.max(Math.min(t1x, t2x), Math.min(t1y, t2y), Math.min(t1z, t2z), 0);
    const tFar = Math.min(Math.max(t1x, t2x), Math.max(t1y, t2y), Math.max(t1z, t2z));
    if (!(tNear <= tFar) || tNear >= best) continue;

    const data2 = nodes[off + 7];
    if (data2 > 0) {                                       // leaf: data1 = first, data2 = count
      const first = nodes[off + 6];
      for (let i = first; i < first + data2; i++) {
        const ti = triIndices[i];
        const a = triangles[ti * 3] * 3, b = triangles[ti * 3 + 1] * 3, c = triangles[ti * 3 + 2] * 3;
        const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
        const e1x = vertices[b] - ax, e1y = vertices[b + 1] - ay, e1z = vertices[b + 2] - az;
        const e2x = vertices[c] - ax, e2y = vertices[c + 1] - ay, e2z = vertices[c + 2] - az;
        // p = d × e2;  det = e1 · p   (det ≈ 0 → ray parallel to the triangle)
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;               // two-sided: only PARALLEL is rejected
        const inv = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-7 || u > 1 + 1e-7) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-7 || u + v > 1 + 1e-7) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-7 && t < best) { best = t; bestTri = ti; bu = u; bv = v; }
      }
    } else {                                               // internal: data1 = left, data2 = -(right)-1
      stack.push(nodes[off + 6]);
      stack.push(-data2 - 1);
    }
  }

  if (bestTri < 0) return null;

  const a = triangles[bestTri * 3] * 3, b = triangles[bestTri * 3 + 1] * 3, c = triangles[bestTri * 3 + 2] * 3;
  const ax = vertices[a], ay = vertices[a + 1], az = vertices[a + 2];
  const e1x = vertices[b] - ax, e1y = vertices[b + 1] - ay, e1z = vertices[b + 2] - az;
  const e2x = vertices[c] - ax, e2y = vertices[c + 1] - ay, e2z = vertices[c + 2] - az;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }   // face the viewer, like the shading

  return {
    tri: bestTri,
    t: best,
    point: [ox + dx * best, oy + dy * best, oz + dz * best],
    normal: [nx, ny, nz],
    bary: [1 - bu - bv, bu, bv],
    verts: [triangles[bestTri * 3], triangles[bestTri * 3 + 1], triangles[bestTri * 3 + 2]],
  };
}

// ── src/topology.js ──

// @gcu/geometry — mesh topology in CSR form.
//
// Two adjacency graphs, built once in linear time, that everything walking a
// surface needs: a geodesic brush, a flood fill, Dijkstra along the surface,
// rebuilding a selection's index buffer, closed/open detection.
//
//   vertex -> vertex   (who is one edge away)
//   vertex -> face     (which triangles touch me)
//
// Both are stored as compressed sparse rows: an offsets array of length n+1
// and a packed neighbor array, so row `v` is `neighbors[offsets[v] …
// offsets[v+1]]`. Offsets are EXACT — there is no padding and therefore no
// empty-slot sentinel.
//
// (CAPIVARAS stored neighbors as `v+1` so that 0 could mean "empty", and every
// consumer wrote `const w = nbr[i] - 1; if (w < 0) break;`. That is only needed
// when rows are fixed-stride and padded. Exact rows make the sentinel, the bias
// and the break condition all disappear — one less invariant for every caller
// to remember, and no wasted memory. This is a deliberate departure from the
// original; the geometry is identical.)
//
// Degenerate input is tolerated rather than rejected: a triangle referencing a
// vertex out of range is skipped, and a triangle with a repeated corner
// contributes its real edges only. Field meshes are not clean.

/**
 * Build the CSR adjacency graphs for an indexed triangle mesh.
 *
 * @param {ArrayLike<number>} vertices   flat xyz, length 3·nv (only its length is read)
 * @param {ArrayLike<number>} triangles  flat vertex indices, length 3·nt
 * @param {object} [opts]
 * @param {number} [opts.vertexCount]    override nv (when `vertices` is not flat xyz)
 * @returns {{
 *   vertexCount: number, faceCount: number,
 *   vvOffsets: Uint32Array, vvNeighbors: Uint32Array,
 *   vfOffsets: Uint32Array, vfFaces: Uint32Array,
 *   skipped: number
 * }}
 */
function buildAdjacency(vertices, triangles, { vertexCount } = {}) {
  const nv = vertexCount != null ? vertexCount : Math.floor(vertices.length / 3);
  const nt = Math.floor(triangles.length / 3);
  if (nv <= 0) {
    return {
      vertexCount: 0, faceCount: 0,
      vvOffsets: new Uint32Array(1), vvNeighbors: new Uint32Array(0),
      vfOffsets: new Uint32Array(1), vfFaces: new Uint32Array(0), skipped: nt,
    };
  }

  // ── vertex -> face. Exact by construction: every valid triangle contributes
  //    one entry to each of its three corners. ──
  const vfOffsets = new Uint32Array(nv + 1);
  let skipped = 0;
  const ok = new Uint8Array(nt);                           // remember which faces counted
  for (let f = 0; f < nt; f++) {
    const a = triangles[f * 3], b = triangles[f * 3 + 1], c = triangles[f * 3 + 2];
    if (a >= nv || b >= nv || c >= nv || a < 0 || b < 0 || c < 0) { skipped++; continue; }
    ok[f] = 1;
    vfOffsets[a + 1]++; vfOffsets[b + 1]++; vfOffsets[c + 1]++;
  }
  for (let v = 0; v < nv; v++) vfOffsets[v + 1] += vfOffsets[v];
  const vfFaces = new Uint32Array(vfOffsets[nv]);
  {
    const cursor = vfOffsets.slice(0, nv);                 // a moving write head per row
    for (let f = 0; f < nt; f++) {
      if (!ok[f]) continue;
      const a = triangles[f * 3], b = triangles[f * 3 + 1], c = triangles[f * 3 + 2];
      vfFaces[cursor[a]++] = f;
      vfFaces[cursor[b]++] = f;
      vfFaces[cursor[c]++] = f;
    }
  }

  // ── vertex -> vertex, derived from vertex -> face.
  //    A vertex's neighbors are the other two corners of each incident face,
  //    deduplicated: an interior edge is shared by two faces, so every neighbor
  //    would otherwise appear twice. Vertex degree is small (typically 4-8 on a
  //    triangulated surface), so a linear scan over the row-so-far is the right
  //    dedup — no Set per vertex, no allocation in the loop. ──
  const vvOffsets = new Uint32Array(nv + 1);
  let scratch = new Uint32Array(64);
  const gather = (v) => {                                  // unique neighbors of v -> scratch
    let k = 0;
    for (let i = vfOffsets[v], e = vfOffsets[v + 1]; i < e; i++) {
      const f = vfFaces[i] * 3;
      for (let j = 0; j < 3; j++) {
        const w = triangles[f + j];
        if (w === v) continue;                             // self, and a repeated corner
        let dup = false;
        for (let q = 0; q < k; q++) if (scratch[q] === w) { dup = true; break; }
        if (dup) continue;
        if (k === scratch.length) {                        // a pathological fan; grow once
          const bigger = new Uint32Array(scratch.length * 2);
          bigger.set(scratch);
          scratch = bigger;
        }
        scratch[k++] = w;
      }
    }
    return k;
  };

  for (let v = 0; v < nv; v++) vvOffsets[v + 1] = gather(v);
  for (let v = 0; v < nv; v++) vvOffsets[v + 1] += vvOffsets[v];
  const vvNeighbors = new Uint32Array(vvOffsets[nv]);
  for (let v = 0; v < nv; v++) {
    const k = gather(v);
    const at = vvOffsets[v];
    for (let q = 0; q < k; q++) vvNeighbors[at + q] = scratch[q];
  }

  return { vertexCount: nv, faceCount: nt, vvOffsets, vvNeighbors, vfOffsets, vfFaces, skipped };
}

/** Neighbors of vertex `v` as a subarray view (no copy). */
function neighbors(adj, v) {
  return adj.vvNeighbors.subarray(adj.vvOffsets[v], adj.vvOffsets[v + 1]);
}

/** Faces incident to vertex `v` as a subarray view (no copy). */
function incidentFaces(adj, v) {
  return adj.vfFaces.subarray(adj.vfOffsets[v], adj.vfOffsets[v + 1]);
}

/** Degree of vertex `v` in the vertex->vertex graph. */
function degree(adj, v) {
  return adj.vvOffsets[v + 1] - adj.vvOffsets[v];
}

/**
 * Connected components over a SUBSET of vertices — the operation that turns a
 * painted patch into individual measurable planes: one component is one plane.
 *
 * @param {object} adj        from buildAdjacency
 * @param {ArrayLike<number>|Set<number>} subset  vertices to consider
 * @returns {{ labels: Int32Array, count: number }}  labels[v] = component id, or
 *          -1 for vertices outside the subset. Ids are assigned in ascending
 *          vertex order, so the result is deterministic.
 */
function components(adj, subset) {
  const nv = adj.vertexCount;
  const inSet = new Uint8Array(nv);
  const members = [];
  for (const v of subset) {
    if (v >= 0 && v < nv && !inSet[v]) { inSet[v] = 1; members.push(v); }
  }
  members.sort((a, b) => a - b);                           // determinism, not correctness

  const labels = new Int32Array(nv).fill(-1);
  const stack = new Uint32Array(members.length);
  let count = 0;
  for (const seed of members) {
    if (labels[seed] !== -1) continue;
    let top = 0;
    stack[top++] = seed;
    labels[seed] = count;
    while (top > 0) {
      const v = stack[--top];
      for (let i = adj.vvOffsets[v], e = adj.vvOffsets[v + 1]; i < e; i++) {
        const w = adj.vvNeighbors[i];
        if (inSet[w] && labels[w] === -1) { labels[w] = count; stack[top++] = w; }
      }
    }
    count++;
  }
  return { labels, count };
}

// ── src/meshqa.js ──

// @gcu/geometry — mesh QA: is this triangle mesh a solid, and how big is it.
//
// What a resource geologist asks of a wireframe before it bounds an estimate:
// is it watertight, is it one shell or several, does every face point the same
// way, are there slivers or duplicates, and what volume does it hold. All of it
// comes from the EDGES once the coincident vertices are welded:
//
//   an edge on 1 face   boundary — a hole; the shell isn't closed
//   an edge on 3+ faces non-manifold — a fin, or two shells touching along a line
//   an edge on 2 faces  fine, IF they cross it in opposite directions; the same
//                       direction twice means one of them is flipped
//
// Shells are the triangles connected through edges. A closed shell's volume is
// the divergence theorem's sum of signed tetrahedra (about the shell's own
// centre, which keeps far-from-origin coordinates from cancelling); positive =
// the faces point outward. A void inside a solid shows as a closed shell with a
// NEGATIVE volume when it's wound correctly — the total is the signed sum.
//
// Not checked: self-intersections (faces crossing without sharing an edge) —
// that needs a BVH pair sweep, and is the next thing to add.

/**
 * Weld vertices that sit at exactly the same coordinates (a per-face soup —
 * 3DFACE, STL, some OBJ — repeats every corner per face, so nothing would share
 * an edge). Triangles that collapse when welded are dropped.
 * @returns {{ vertices: Float64Array, triangles: Uint32Array, welded: number, collapsed: number, remap: Int32Array }}
 *   remap[i] = the welded index of input vertex i
 */
function weldVertices(vertices, triangles) {
  const n = vertices.length / 3, seen = new Map(), remap = new Int32Array(n), out = [];
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const k = `${vertices[3 * i]},${vertices[3 * i + 1]},${vertices[3 * i + 2]}`;
    let j = seen.get(k);
    if (j === undefined) { j = nv++; seen.set(k, j); out.push(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2]); }
    remap[i] = j;
  }
  const T = [];
  let collapsed = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = remap[triangles[t]], b = remap[triangles[t + 1]], c = remap[triangles[t + 2]];
    if (a === b || b === c || a === c) { collapsed++; continue; }
    T.push(a, b, c);
  }
  return { vertices: nv === n ? Float64Array.from(vertices) : Float64Array.from(out), triangles: Uint32Array.from(T), welded: n - nv, collapsed, remap };
}

const edgeKey$meshqa = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/**
 * The QA report of an indexed triangle mesh.
 * @param {ArrayLike<number>} vertices   flat xyz
 * @param {ArrayLike<number>} triangles  flat indices
 * @param {object} [opts]
 * @param {boolean} [opts.weld=true]     weld coincident vertices first
 * @param {number}  [opts.examples=200]  locations kept per issue kind
 * @returns {{
 *   vertices: number, triangles: number, welded: number, collapsed: number,
 *   watertight: boolean, consistent: boolean, area: number, volume: number|null,
 *   shells: Array<{ triangles: number, closed: boolean, volume: number|null, area: number, bbox: number[] }>,
 *   issues: { boundary, nonManifold, flipped, degenerate, duplicate: { count: number, at: number[][] } }
 * }}
 * `at` holds example locations [x, y, z] (an edge's midpoint, a face's centroid).
 * `volume` is the signed sum over the shells when every shell is closed, else null.
 */
function meshQa(vertices, triangles, { weld = true, examples = 200 } = {}) {
  const w = weld ? weldVertices(vertices, triangles) : { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles), welded: 0, collapsed: 0 };
  const V = w.vertices, T = w.triangles, nt = T.length / 3;
  const issue = () => ({ count: 0, at: [] });
  const issues = { boundary: issue(), nonManifold: issue(), flipped: issue(), degenerate: issue(), duplicate: issue() };
  const note = (k, p) => { const s = issues[k]; s.count++; if (s.at.length < examples) s.at.push(p); };
  const mid = (a, b) => [(V[3 * a] + V[3 * b]) / 2, (V[3 * a + 1] + V[3 * b + 1]) / 2, (V[3 * a + 2] + V[3 * b + 2]) / 2];
  const cen = (t) => [0, 1, 2].map((k) => (V[3 * T[3 * t] + k] + V[3 * T[3 * t + 1] + k] + V[3 * T[3 * t + 2] + k]) / 3);
  // scale for "zero area": relative to the mesh's extent, so units don't matter
  let ext = 0;
  { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { if (V[i + k] < lo[k]) lo[k] = V[i + k]; if (V[i + k] > hi[k]) hi[k] = V[i + k]; }
    ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 0); }
  const areaEps = (ext * 1e-9) ** 2;
  // faces: area, degenerate, duplicate (the same three vertices, either winding)
  const area = new Float64Array(nt), seenTri = new Map();
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const ux = V[3 * b] - V[3 * a], uy = V[3 * b + 1] - V[3 * a + 1], uz = V[3 * b + 2] - V[3 * a + 2];
    const vx = V[3 * c] - V[3 * a], vy = V[3 * c + 1] - V[3 * a + 1], vz = V[3 * c + 2] - V[3 * a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area[t] = Math.hypot(cx, cy, cz) / 2;
    if (area[t] <= areaEps) note('degenerate', cen(t));
    const k = [a, b, c].sort((p, q) => p - q).join(',');
    if (seenTri.has(k)) note('duplicate', cen(t)); else seenTri.set(k, t);
  }
  // edges: how many faces, and which way each crosses it (+1 for a<b, −1 for a>b)
  const eFaces = new Map(), eDir = new Map(), eFirst = new Map();
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = T[3 * t + e], b = T[3 * t + (e + 1) % 3], k = edgeKey$meshqa(a, b);
    eFaces.set(k, (eFaces.get(k) || 0) + 1);
    eDir.set(k, (eDir.get(k) || 0) + (a < b ? 1 : -1));
    if (!eFirst.has(k)) eFirst.set(k, [a, b, t]);
  }
  // shells: union-find over faces that share an edge
  const parent = new Int32Array(nt); for (let t = 0; t < nt; t++) parent[t] = t;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const k = edgeKey$meshqa(T[3 * t + e], T[3 * t + (e + 1) % 3]), f = eFirst.get(k)[2];
    const ra = find(t), rb = find(f); if (ra !== rb) parent[ra] = rb;
  }
  const openShell = new Set();
  for (const [k, n] of eFaces) {
    const [a, b, t] = eFirst.get(k);
    if (n === 1) { note('boundary', mid(a, b)); openShell.add(find(t)); }
    else if (n > 2) { note('nonManifold', mid(a, b)); openShell.add(find(t)); }
    else if (eDir.get(k) !== 0) note('flipped', mid(a, b));
  }
  // per shell: area, bbox, and — closed — the signed volume about its own centre
  const shellOf = new Map();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let s = shellOf.get(r);
    if (!s) { s = { tris: [], area: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }; shellOf.set(r, s); }
    s.tris.push(t); s.area += area[t];
    for (let c = 0; c < 3; c++) { const v = T[3 * t + c]; for (let k = 0; k < 3; k++) { const x = V[3 * v + k]; if (x < s.lo[k]) s.lo[k] = x; if (x > s.hi[k]) s.hi[k] = x; } }
  }
  const shells = [];
  let totalArea = 0, totalVol = 0, allClosed = nt > 0;
  for (const [r, s] of shellOf) {
    const closed = !openShell.has(r);
    let vol = null;
    if (closed) {
      const o = [0, 1, 2].map((k) => (s.lo[k] + s.hi[k]) / 2);
      vol = 0;
      for (const t of s.tris) {
        const p = [0, 1, 2].map((c) => [0, 1, 2].map((k) => V[3 * T[3 * t + c] + k] - o[k]));
        vol += p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) + p[0][1] * (p[1][2] * p[2][0] - p[1][0] * p[2][2]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0]);
      }
      vol /= 6;
      totalVol += vol;
    } else allClosed = false;
    totalArea += s.area;
    shells.push({ triangles: s.tris.length, closed, volume: vol, area: s.area, bbox: [...s.lo, ...s.hi] });
  }
  shells.sort((a, b) => b.triangles - a.triangles);
  return {
    vertices: V.length / 3, triangles: nt, welded: w.welded, collapsed: w.collapsed,
    watertight: allClosed && issues.boundary.count === 0 && issues.nonManifold.count === 0,
    consistent: issues.flipped.count === 0,
    area: totalArea, volume: allClosed ? totalVol : null, shells, issues,
  };
}

// ── src/nearest.js ──

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


// region codes written to out[3]
const NEAREST_FACE = 0, NEAREST_V0 = 1, NEAREST_V1 = 2, NEAREST_V2 = 3, NEAREST_E01 = 4, NEAREST_E12 = 5, NEAREST_E20 = 6;

/**
 * Closest point on triangle (a, b, c) to p. Writes [x, y, z, region] into `out`
 * and returns the SQUARED distance.
 */
function closestPointOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
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
function bvhSlack(nodes) {
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
function nearestBVH(mesh, point, { maxDist = Infinity, slack } = {}) {
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

const edgeKey$nearest = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/**
 * Wind every connected piece of a triangle mesh consistently: a BFS over shared
 * edges flips each triangle to traverse a shared edge opposite to its neighbour.
 * Non-manifold edges (3+ faces) are left as they come. → { triangles (a new
 * Uint32Array), flipped, pieces }. The first triangle of each piece keeps its winding.
 */
function orientTriangles(triangles) {
  const T = Uint32Array.from(triangles), nT = T.length / 3;
  const edges = new Map();                                 // edge → [tri, tri?]
  for (let t = 0; t < nT; t++) for (let e = 0; e < 3; e++) {
    const k = edgeKey$nearest(T[t * 3 + e], T[t * 3 + (e + 1) % 3]);
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
        const l = edges.get(edgeKey$nearest(a, b));
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
function pseudoNormals(vertices, triangles) {
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
      const k = edgeKey$nearest(i[c], i[(c + 1) % 3]), en = edge.get(k);
      if (en) { en[0] += nx; en[1] += ny; en[2] += nz; } else edge.set(k, [nx, ny, nz]);
    }
  }
  return { face, vertex, edge };
}

/**
 * Which side of the mesh `point` is on, from a nearestBVH hit and the mesh's
 * pseudo-normals: +1 the side the normals face, −1 the other, 0 on the mesh.
 */
function sideOf(pn, hit, point) {
  const dx = point[0] - hit.point[0], dy = point[1] - hit.point[1], dz = point[2] - hit.point[2];
  let n;
  if (hit.feature === 'face') n = [pn.face[hit.tri * 3], pn.face[hit.tri * 3 + 1], pn.face[hit.tri * 3 + 2]];
  else if (hit.feature === 'edge') n = pn.edge.get(edgeKey$nearest(hit.verts[0], hit.verts[1])) || [pn.face[hit.tri * 3], pn.face[hit.tri * 3 + 1], pn.face[hit.tri * 3 + 2]];
  else { const v = hit.verts[0]; n = [pn.vertex[v * 3], pn.vertex[v * 3 + 1], pn.vertex[v * 3 + 2]]; }
  const s = dx * n[0] + dy * n[1] + dz * n[2];
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

// ── src/main.js ──

// @gcu/geometry — the robust-geometry base of the GCU stack.
//
// What lives here is the geometry every
// other package kept re-implementing:
//
//   BVH        build + ray queries — one copy, instead of one per consumer
//   topology   CSR vertex->vertex and vertex->face adjacency for triangle meshes
//   mesh QA    weld, watertight / manifold / orientation, shells, area + volume
//   nearest    point → mesh distance (closest point on a triangle + a BVH descent) and side
//
// Consumers: @gcu/winding (generalized winding number ON @gcu/geometry), @gcu/clar
// (structural geology ON @gcu/geometry), micro. @gcu/peel still carries its own BVH;
// folding it in is the follow-up, once this API has two real consumers proving
// its shape rather than one speculative one.
//
// Zero dependencies. Everything is plain typed arrays — no classes to
// serialize, so a BVH or an adjacency crosses a worker boundary by transfer.

export {
  buildBVH,
  NODE_SIZE,
  triArea2,
  raycastBVH,
  buildAdjacency,
  neighbors,
  incidentFaces,
  degree,
  components,
  weldVertices,
  meshQa,
  closestPointOnTriangle,
  nearestBVH,
  bvhSlack,
  orientTriangles,
  pseudoNormals,
  sideOf,
};
