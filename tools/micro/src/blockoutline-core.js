// micro BLOCK OUTLINES, the pure part — an occupancy grid (one bench of a block model, in the
// lattice's plan) → polygons: outer rings counter-clockwise, holes clockwise, every vertex on an
// exact lattice corner. No DOM, no state: test/micro-blockoutline.test.mjs runs it in Node.
//
//   outlineCells(occ, nx, ny) → [{ outer: [[i, j], …], holes: [[[i, j], …], …], cells, label }]
//       occ: a row-major Uint8Array (cell (i, j) at i + j·nx), non-zero = occupied. Vertices are
//       CELL-CORNER indices: corner (i, j) is the low-x low-y corner of cell (i, j). One entry per
//       4-CONNECTED region of occupied cells: two cells that only touch at a corner are two
//       polygons (a dig line never pinches through a point), and a region's empty enclosures are
//       its holes. Collinear corners are dropped — a straight run of cells is one edge.
//       (pass labelCells' result as a fourth argument to reuse it: a region's `label` is its id there)
//   labelCells(occ, nx, ny) → { label: Int32Array (0 = empty, 1… = region), count }
//   simplifyRing(ring, tol) → a closed ring with Douglas–Peucker at `tol` (the ring's units);
//       never fewer than 3 vertices, never moves a vertex — a vertex is kept or dropped.
//   ringAreaIJ(ring) → signed area (positive = counter-clockwise)
//
// How the boundary is traced: every side of an occupied cell whose neighbour across it is not
// in the same region is an edge, directed with the region on its LEFT (so a region's outside
// runs counter-clockwise and a hole clockwise). Edges are linked head to tail; at a SADDLE
// corner (two diagonal cells of the region, the other two not) the walk takes the LEFT turn,
// which keeps the two cells apart — every ring comes out simple.

export function labelCells(occ, nx, ny) {
  const label = new Int32Array(nx * ny);
  let count = 0;
  const stack = new Int32Array(nx * ny);
  for (let s = 0; s < nx * ny; s++) {
    if (!occ[s] || label[s]) continue;
    count++;
    let top = 0;
    stack[top++] = s; label[s] = count;
    while (top) {
      const c = stack[--top], i = c % nx, j = (c - i) / nx;
      if (i > 0 && occ[c - 1] && !label[c - 1]) { label[c - 1] = count; stack[top++] = c - 1; }
      if (i < nx - 1 && occ[c + 1] && !label[c + 1]) { label[c + 1] = count; stack[top++] = c + 1; }
      if (j > 0 && occ[c - nx] && !label[c - nx]) { label[c - nx] = count; stack[top++] = c - nx; }
      if (j < ny - 1 && occ[c + nx] && !label[c + nx]) { label[c + nx] = count; stack[top++] = c + nx; }
    }
  }
  return { label, count };
}

export function ringAreaIJ(r) {
  let s = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

// the directions, counter-clockwise: 0 = +x, 1 = +y, 2 = −x, 3 = −y
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

// the rings of ONE region (cells where lab[c] === id), inside its bounding box
function regionRings(lab, nx, ny, id, box) {
  const [i0, j0, i1, j1] = box;                            // cells i0..i1, j0..j1 inclusive
  const W = i1 - i0 + 2;                                   // corners i0..i1+1
  const key = (ci, cj) => (cj - j0) * W + (ci - i0);
  const inR = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && lab[i + j * nx] === id;
  // out[corner] = the directions of the edges leaving that corner (a bit mask: at most 2 at a saddle)
  const out = new Map();
  const add = (ci, cj, d) => { const k = key(ci, cj); out.set(k, (out.get(k) || 0) | (1 << d)); };
  let edges = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!inR(i, j)) continue;
    if (!inR(i, j - 1)) { add(i, j, 0); edges++; }         // bottom side, +x (the region above it: on the left)
    if (!inR(i + 1, j)) { add(i + 1, j, 1); edges++; }     // right side, +y
    if (!inR(i, j + 1)) { add(i + 1, j + 1, 2); edges++; } // top side, −x
    if (!inR(i - 1, j)) { add(i, j + 1, 3); edges++; }     // left side, −y
  }
  const rings = [];
  while (edges) {
    // a start: the first corner that still has an edge leaving it
    let sk = -1, smask = 0;
    for (const [k, m] of out) if (m) { sk = k; smask = m; break; }
    let ci = (sk % W) + i0, cj = Math.floor(sk / W) + j0;
    let d = Math.log2(smask & -smask);
    const ring = [];
    const si = ci, sj = cj, sd = d;
    for (let guard = 0; guard < 4 * nx * ny + 8; guard++) {
      const k = key(ci, cj), m = out.get(k);
      out.set(k, m & ~(1 << d)); edges--;
      ring.push([ci, cj, d]);
      ci += DX[d]; cj += DY[d];
      let nm = out.get(key(ci, cj)) || 0;
      const atStart = ci === si && cj === sj;
      if (atStart) nm |= 1 << sd;                           // the start edge counts: the ring closes when the turn rule picks it
      // the left turn first, then straight on, then the right: the left keeps diagonal cells apart
      const left = (d + 1) & 3, straight = d, right = (d + 3) & 3;
      const nd = nm & (1 << left) ? left : nm & (1 << straight) ? straight : nm & (1 << right) ? right : -1;
      if (nd < 0 || (atStart && nd === sd)) break;
      d = nd;
    }
    for (const loop of splitAtRepeats(ring)) {
      // drop the corners where the direction doesn't change
      const n = loop.length, pts = [];
      for (let q = 0; q < n; q++) { const prev = loop[(q + n - 1) % n]; if (prev[2] !== loop[q][2]) pts.push([loop[q][0], loop[q][1]]); }
      if (pts.length >= 3) rings.push(pts);
    }
  }
  return rings;
}
// A walked ring may pass one corner twice: at a saddle the left turn keeps the region's two cells
// apart, but then the two EMPTY cells there are joined, and a hole (or the outside) pinches through
// the corner. Cut it there: each pass becomes its own closed ring — two holes touching at a point
// is a valid polygon, a ring touching itself is not.
function splitAtRepeats(ring) {
  const loops = [], stack = [], at = new Map();
  for (const e of ring) {
    const k = e[0] + ',' + e[1];
    if (at.has(k)) {
      const sub = stack.splice(at.get(k));
      for (const s of sub) at.delete(s[0] + ',' + s[1]);
      loops.push(sub);
    }
    at.set(k, stack.length); stack.push(e);
  }
  if (stack.length) loops.push(stack);
  return loops;
}

export function outlineCells(occ, nx, ny, labels = null) {
  const { label, count } = labels || labelCells(occ, nx, ny);
  if (!count) return [];
  const box = Array.from({ length: count + 1 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  const cells = new Int32Array(count + 1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = label[i + j * nx]; if (!id) continue;
    const b = box[id]; if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j;
    cells[id]++;
  }
  const out = [];
  for (let id = 1; id <= count; id++) {
    const rings = regionRings(label, nx, ny, id, box[id]);
    const outers = rings.filter((r) => ringAreaIJ(r) > 0), holes = rings.filter((r) => ringAreaIJ(r) < 0);
    // a 4-connected region has ONE outside; keep the largest if the walk ever split it
    outers.sort((a, b) => ringAreaIJ(b) - ringAreaIJ(a));
    if (!outers.length) continue;
    out.push({ outer: outers[0], holes, cells: cells[id], label: id });
    for (const extra of outers.slice(1)) out.push({ outer: extra, holes: [], cells: Math.round(ringAreaIJ(extra)), label: id });
  }
  return out;
}

// Douglas–Peucker on a CLOSED ring: split at the vertex farthest from vertex 0, simplify both
// halves as open chains, rejoin. Points are [x, y, …] (extra coordinates ride along).
const segDist = (p, a, b) => {
  const vx = b[0] - a[0], vy = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1], L = vx * vx + vy * vy;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L)) : 0;
  return Math.hypot(wx - t * vx, wy - t * vy);
};
function dpOpen(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export function simplifyRing(ring, tol) {
  if (!(tol > 0) || ring.length <= 3) return ring.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dpOpen(ring.slice(0, far + 1), tol), b = dpOpen([...ring.slice(far), ring[0]], tol);
  const out = [...a, ...b.slice(1, -1)];
  if (out.length >= 3) return out;
  // too coarse a tolerance for this ring: keep the three vertices that span the most area
  let best = null, ba = -1;
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) for (let k = j + 1; k < ring.length; k += Math.max(1, Math.floor(ring.length / 64))) {
    const A = Math.abs((ring[j][0] - ring[i][0]) * (ring[k][1] - ring[i][1]) - (ring[k][0] - ring[i][0]) * (ring[j][1] - ring[i][1]));
    if (A > ba) { ba = A; best = [ring[i], ring[j], ring[k]]; }
  }
  return best || ring.slice(0, 3);
}
