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
export function weldVertices(vertices, triangles) {
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

const edgeKey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

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
export function meshQa(vertices, triangles, { weld = true, examples = 200 } = {}) {
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
    const a = T[3 * t + e], b = T[3 * t + (e + 1) % 3], k = edgeKey(a, b);
    eFaces.set(k, (eFaces.get(k) || 0) + 1);
    eDir.set(k, (eDir.get(k) || 0) + (a < b ? 1 : -1));
    if (!eFirst.has(k)) eFirst.set(k, [a, b, t]);
  }
  // shells: union-find over faces that share an edge
  const parent = new Int32Array(nt); for (let t = 0; t < nt; t++) parent[t] = t;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const k = edgeKey(T[3 * t + e], T[3 * t + (e + 1) % 3]), f = eFirst.get(k)[2];
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
