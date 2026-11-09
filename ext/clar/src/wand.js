// The magic wand: click a face, take the whole face.
//
// The brush paints what is under a circle; the wand paints what is COPLANAR with
// where you clicked. It grows outward from the seed along the mesh and stops
// where the surface turns away — the fold onto the next joint face, the step down
// to a parallel one — so a single click measures a whole exposed plane. This is
// the region growing that automatic extractors (Facets, DSE) run over a whole
// outcrop, run instead on demand at the one place the geologist pointed: the
// judgement stays theirs, the tedium doesn't.
//
// Two tests decide whether the walk may enter a vertex, both against a REFERENCE
// plane estimated once around the seed:
//   - angle:    the vertex's normal is within `maxAngle` of the reference normal
//   - distance: the vertex lies within `maxDistance` of the reference plane
// Comparing against a fixed reference rather than neighbor-to-neighbor is what
// stops it creeping round a gentle curve: a chain of small turns never adds up to
// a large one unnoticed.
//
// Photogrammetric normals are noisy. `smoothNormals` averages them over the mesh
// once, so a host computes it at prepare time and every wand click reuses it.

/**
 * Area-weighted per-vertex normals, unit length, oriented by triangle winding.
 *
 * @param {ArrayLike<number>} positions  flat xyz
 * @param {ArrayLike<number>} triangles  flat vertex indices
 * @param {number} [vertexCount]         defaults to positions.length / 3
 * @returns {Float32Array} flat xyz; a vertex no triangle touches gets (0,0,0)
 */
export function vertexNormals(positions, triangles, vertexCount) {
  const nv = vertexCount != null ? vertexCount : Math.floor(positions.length / 3);
  const out = new Float32Array(nv * 3);
  const acc = new Float64Array(nv * 3);
  const nt = Math.floor(triangles.length / 3);
  for (let f = 0; f < nt; f++) {
    const a = triangles[f * 3], b = triangles[f * 3 + 1], c = triangles[f * 3 + 2];
    if (a >= nv || b >= nv || c >= nv) continue;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    // the unnormalized cross product IS area-weighted (its length is twice the area)
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { acc[v * 3] += cx; acc[v * 3 + 1] += cy; acc[v * 3 + 2] += cz; }
  }
  for (let v = 0; v < nv; v++) {
    const x = acc[v * 3], y = acc[v * 3 + 1], z = acc[v * 3 + 2];
    const L = Math.hypot(x, y, z);
    if (L > 0) { out[v * 3] = x / L; out[v * 3 + 1] = y / L; out[v * 3 + 2] = z / L; }
  }
  return out;
}

/**
 * Average each vertex normal with its neighbors', `passes` times.
 *
 * @param {object} adj                   from buildAdjacency
 * @param {ArrayLike<number>} normals    flat xyz unit normals
 * @param {number} [passes=1]
 * @returns {Float32Array} a new array; the input is not modified
 */
export function smoothNormals(adj, normals, passes = 1) {
  const nv = adj.vertexCount;
  let src = Float32Array.from(normals);
  let dst = new Float32Array(nv * 3);
  for (let p = 0; p < passes; p++) {
    for (let v = 0; v < nv; v++) {
      let x = src[v * 3], y = src[v * 3 + 1], z = src[v * 3 + 2];
      for (let i = adj.vvOffsets[v], e = adj.vvOffsets[v + 1]; i < e; i++) {
        const w = adj.vvNeighbors[i];
        x += src[w * 3]; y += src[w * 3 + 1]; z += src[w * 3 + 2];
      }
      const L = Math.hypot(x, y, z);
      if (L > 0) { dst[v * 3] = x / L; dst[v * 3 + 1] = y / L; dst[v * 3 + 2] = z / L; }
      else { dst[v * 3] = 0; dst[v * 3 + 1] = 0; dst[v * 3 + 2] = 0; }
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/**
 * Grow a coplanar region from a seed vertex.
 *
 * @param {number} seed                  the vertex the cursor picked
 * @param {object} adj                   from buildAdjacency
 * @param {ArrayLike<number>} positions  flat xyz
 * @param {ArrayLike<number>} normals    flat xyz unit vertex normals (smoothed, normally)
 * @param {object} [opts]
 * @param {number} [opts.maxAngle=12]        degrees between a vertex normal and the reference
 * @param {number} [opts.maxDistance=Infinity] world units off the reference plane
 * @param {number} [opts.radius=Infinity]    straight-line reach from the seed — the brush's
 *        size, when a face runs on further than the geologist wants to measure
 * @param {number} [opts.refRings=2]         rings around the seed the reference is fitted over
 * @param {Uint8Array} [opts.exclude]        vertices the walk will not enter (another set)
 * @param {number} [opts.limit=Infinity]
 * @returns {{ vertices: Uint32Array, normal: number[], point: number[] }}
 *          vertices ascending (always containing the seed); `normal` and `point` define
 *          the reference plane — the plane the region was judged against, which a host
 *          can draw as the preview before the click commits.
 */
export function wand(seed, adj, positions, normals, opts = {}) {
  const {
    maxAngle = 12, maxDistance = Infinity, radius = Infinity,
    refRings = 2, exclude, limit = Infinity,
  } = opts;
  const nv = adj.vertexCount;
  if (seed < 0 || seed >= nv) return { vertices: new Uint32Array(0), normal: [0, 0, 1], point: [0, 0, 0] };

  // ── the reference: the mean normal + centroid of the seed's k-ring. A single
  //    vertex normal is too noisy to judge a whole face against. ──
  const ring = [seed];
  {
    const seen = new Set(ring);
    let frontier = [seed];
    for (let r = 0; r < refRings; r++) {
      const next = [];
      for (const v of frontier) {
        for (let i = adj.vvOffsets[v], e = adj.vvOffsets[v + 1]; i < e; i++) {
          const w = adj.vvNeighbors[i];
          if (seen.has(w) || (exclude && exclude[w])) continue;
          seen.add(w); next.push(w); ring.push(w);
        }
      }
      frontier = next;
    }
  }
  let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
  for (const v of ring) {
    nx += normals[v * 3]; ny += normals[v * 3 + 1]; nz += normals[v * 3 + 2];
    px += positions[v * 3]; py += positions[v * 3 + 1]; pz += positions[v * 3 + 2];
  }
  const nl = Math.hypot(nx, ny, nz);
  if (!(nl > 0)) return { vertices: Uint32Array.of(seed), normal: [0, 0, 1], point: [positions[seed * 3], positions[seed * 3 + 1], positions[seed * 3 + 2]] };
  nx /= nl; ny /= nl; nz /= nl;
  px /= ring.length; py /= ring.length; pz /= ring.length;

  const cosMax = Math.cos(maxAngle * Math.PI / 180);
  const sx = positions[seed * 3], sy = positions[seed * 3 + 1], sz = positions[seed * 3 + 2];
  const r2 = radius * radius;
  const accept = (w) => {
    if (normals[w * 3] * nx + normals[w * 3 + 1] * ny + normals[w * 3 + 2] * nz < cosMax) return false;
    const dx = positions[w * 3] - px, dy = positions[w * 3 + 1] - py, dz = positions[w * 3 + 2] - pz;
    if (Math.abs(dx * nx + dy * ny + dz * nz) > maxDistance) return false;
    if (radius !== Infinity) {
      const ex = positions[w * 3] - sx, ey = positions[w * 3 + 1] - sy, ez = positions[w * 3 + 2] - sz;
      if (ex * ex + ey * ey + ez * ez > r2) return false;
    }
    return true;
  };

  const seen = new Uint8Array(nv);
  const queue = new Uint32Array(nv);
  const out = [seed];
  let head = 0, tail = 0;
  seen[seed] = 1; queue[tail++] = seed;
  while (head < tail && out.length < limit) {
    const v = queue[head++];
    for (let i = adj.vvOffsets[v], e = adj.vvOffsets[v + 1]; i < e; i++) {
      const w = adj.vvNeighbors[i];
      if (seen[w]) continue;
      seen[w] = 1;
      if ((exclude && exclude[w]) || !accept(w)) continue;
      queue[tail++] = w; out.push(w);
      if (out.length >= limit) break;
    }
  }
  out.sort((a, b) => a - b);
  return { vertices: Uint32Array.from(out), normal: [nx, ny, nz], point: [px, py, pz] };
}
