// micro EXTRUDE (core) — a polygon feature → a CLOSED SOLID mesh. Pure (no DOM, no state).
//
//   extrudeZRange(feature, { z0, z1 })                 a vertical prism: the polygon × [z0, z1]
//   extrudeOriented(feature, { direction, length })    a prism along a direction (a unit vector, or
//                                                      { trend, plunge } in degrees, plunge + down):
//                                                      the base is the polygon at its own vertices'
//                                                      z, the top that base moved by direction × length
//   extrudeBetween(feature, { top, bottom, tol, maxEdge, minEdge })
//                                                      walls follow the polygon; the caps are the TOP
//                                                      and BOTTOM surfaces (top(x, y) / bottom(x, y)
//                                                      → z, NaN = no value) sampled on a plan
//                                                      triangulation refined until the cap follows each
//                                                      surface within `tol` (checked at every edge's
//                                                      midpoint and every triangle's centroid) or the
//                                                      edges reach minEdge; no edge longer than maxEdge
//   → { vertices: Float64Array, triangles: Uint32Array, volume, area, stats }
//
// Every solid is built the same way: one plan triangulation of the polygon (ear clipping,
// @gcu/geometry — holes bridged in), every triangle counter-clockwise in plan; a bottom vertex and a
// top vertex per plan vertex; the top cap as the triangles are, the bottom cap reversed, and a wall
// quad on every BOUNDARY edge of the triangulation (an edge only one triangle uses — the rings, as
// the caps ended up drawing them), turned by that triangle's own order. So the caps and the walls
// share every vertex and every edge — watertight by construction, outward-facing (a triangle's
// interior is left of each of its directed edges, the wall faces right). A multipolygon's parts
// become separate closed shells of the one mesh. `manifoldCheck` proves it (tests run it on every
// solid; the browser refuses a solid that fails it).
import { triangulateRings } from '../../../ext/geometry/index.js';
import { ringAreaXY } from './coverage.js';

const DEG = Math.PI / 180;
export function directionOf(d) {
  if (Array.isArray(d) && d.length === 3) {
    const n = Math.hypot(d[0], d[1], d[2]);
    if (!(n > 0)) throw new Error('direction: a non-zero vector');
    return [d[0] / n, d[1] / n, d[2] / n];
  }
  if (d && Number.isFinite(+d.trend) && Number.isFinite(+d.plunge)) {
    const t = +d.trend * DEG, p = +d.plunge * DEG;
    return [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)];
  }
  throw new Error('direction: a vector [x, y, z] or { trend, plunge } in degrees');
}

// one part (outer ring + holes) → plan vertices [[x, y, z], …] and CCW triangles over them.
// Outer counter-clockwise, holes clockwise (the order the walls read their side from).
function planPart(rings, maxEdge = 0) {
  const norm = rings.map((r, k) => {
    let q = r.map((p) => [+p[0], +p[1], p.length > 2 && Number.isFinite(+p[2]) ? +p[2] : 0]);
    if (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q = q.slice(0, -1);
    const a = ringAreaXY(q);
    if ((k === 0 && a < 0) || (k > 0 && a > 0)) q = q.slice().reverse();
    if (maxEdge > 0) {                                     // long edges split, so the walls (and the caps' rims) follow the surfaces
      const out = [];
      for (let i = 0; i < q.length; i++) {
        const a2 = q[i], b2 = q[(i + 1) % q.length], L = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]), n = Math.max(1, Math.ceil(L / maxEdge));
        for (let s = 0; s < n; s++) out.push([a2[0] + (b2[0] - a2[0]) * s / n, a2[1] + (b2[1] - a2[1]) * s / n, a2[2] + (b2[2] - a2[2]) * s / n]);
      }
      q = out;
    }
    return q;
  }).filter((q, k) => k === 0 || q.length >= 3);
  if (!norm.length || norm[0].length < 3) return null;
  const t = triangulateRings(norm);
  const nv = t.vertices.length / 3, P = [];
  for (let i = 0; i < nv; i++) P.push([t.vertices[i * 3], t.vertices[i * 3 + 1], t.vertices[i * 3 + 2]]);
  const T = [];
  for (let i = 0; i < t.triangles.length; i += 3) {
    let a = t.triangles[i], b = t.triangles[i + 1], c = t.triangles[i + 2];
    const s = (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
    if (s === 0) continue;                                 // a sliver of zero area adds no volume and no edge the rest needs
    if (s < 0) { const x = b; b = c; c = x; }
    T.push(a, b, c);
  }
  if (!T.length) return null;
  return { P, T: conform(P, T) };
}

// The ear clipper drops collinear vertices (it must, to find ears), so a ring vertex — one the
// edge-splitting put on a straight run, or a hole's bridge vertex — can lie INSIDE another
// triangle's edge: a T-junction. The walls are read from the cap's boundary edges, so a
// T-junction became a wall on an interior bridge and a non-manifold solid ("self-intersecting
// outline?" — sweep 2026-11-25, 1 in 6 random holed polygons between surfaces). Split every
// triangle whose edge carries a vertex, until none does: the cap is then conforming.
function conform(P, T) {
  const n = P.length;
  if (n < 4) return T;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const G = Math.max(1, Math.ceil(Math.sqrt(n))), cw = (x1 - x0) / G || 1, ch = (y1 - y0) / G || 1;
  const cell = (x, y) => [Math.min(G - 1, Math.max(0, Math.floor((x - x0) / cw))), Math.min(G - 1, Math.max(0, Math.floor((y - y0) / ch)))];
  const grid = Array.from({ length: G * G }, () => []);
  P.forEach((p, i) => { const [cx, cy] = cell(p[0], p[1]); grid[cx + cy * G].push(i); });
  // the vertex strictly inside segment a → b, if any
  const onEdge = (a, b) => {
    const A = P[a], B = P[b], ex = B[0] - A[0], ey = B[1] - A[1], L2 = ex * ex + ey * ey;
    if (!(L2 > 0)) return -1;
    const [ca, ra] = cell(Math.min(A[0], B[0]), Math.min(A[1], B[1])), [cb, rb] = cell(Math.max(A[0], B[0]), Math.max(A[1], B[1]));
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) for (const v of grid[c + r * G]) {
      if (v === a || v === b) continue;
      const V = P[v], vx = V[0] - A[0], vy = V[1] - A[1];
      const t = (vx * ex + vy * ey) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const cr = vx * ey - vy * ex;
      if (cr * cr <= 1e-18 * L2 * L2) return v;              // on the line, to a relative 1e-9
    }
    return -1;
  };
  const out = [];
  const stack = [];
  for (let i = 0; i < T.length; i += 3) stack.push([T[i], T[i + 1], T[i + 2]]);
  let guard = 0;
  while (stack.length) {
    if (++guard > 8 * (T.length + n) + 1000) throw new Error('extrude: the cap triangulation did not settle');
    const [a, b, c] = stack.pop();
    let split = false;
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const v = onEdge(p, q);
      if (v >= 0) { stack.push([p, v, r], [v, q, r]); split = true; break; }   // same winding as p, q, r
    }
    if (!split) out.push(a, b, c);
  }
  return out;
}

const ekey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

// longest-edge (Rivara) bisection of a CCW plan triangulation until no triangle `needs` a split —
// conforming throughout (a split edge is split in both triangles that share it), so no T-junctions
function refinePlan(P, T0, needs) {
  const tris = [];                                         // [a, b, c] or null (replaced)
  const edges = new Map();                                 // undirected edge → [tri, tri?]
  const addE = (k, t) => { const e = edges.get(k); if (e) e.push(t); else edges.set(k, [t]); };
  const delE = (k, t) => { const e = edges.get(k); if (!e) return; const i = e.indexOf(t); if (i >= 0) e.splice(i, 1); if (!e.length) edges.delete(k); };
  const add = (a, b, c) => { const t = tris.length; tris.push([a, b, c]); addE(ekey(a, b), t); addE(ekey(b, c), t); addE(ekey(c, a), t); return t; };
  const kill = (t) => { const [a, b, c] = tris[t]; delE(ekey(a, b), t); delE(ekey(b, c), t); delE(ekey(c, a), t); tris[t] = null; };
  const len2 = (a, b) => (P[a][0] - P[b][0]) ** 2 + (P[a][1] - P[b][1]) ** 2;
  // the triangle's vertices rotated so its longest edge comes first (p → q)
  const longest = (t) => {
    const [a, b, c] = tris[t], ab = len2(a, b), bc = len2(b, c), ca = len2(c, a);
    return ab >= bc && ab >= ca ? [a, b, c] : bc >= ca ? [b, c, a] : [c, a, b];
  };
  const mids = new Map();
  const midOf = (p, q) => {
    const k = ekey(p, q);
    let m = mids.get(k);
    if (m == null) { m = P.length; P.push([(P[p][0] + P[q][0]) / 2, (P[p][1] + P[q][1]) / 2, (P[p][2] + P[q][2]) / 2]); mids.set(k, m); }
    return m;
  };
  const split = (t, p, q, r, m) => { kill(t); add(p, m, r); add(m, q, r); };
  const bisect = (t0) => {
    for (let guard = 0; guard < 10000; guard++) {
      if (!tris[t0]) return;
      const [p, q, r] = longest(t0);
      const sh = (edges.get(ekey(p, q)) || []).filter((x) => x !== t0);
      if (!sh.length) { split(t0, p, q, r, midOf(p, q)); return; }
      const n = sh[0], [np, nq, nr] = longest(n);
      if (ekey(np, nq) === ekey(p, q)) {                  // the neighbour's longest edge is this one: split both
        const m = midOf(p, q);
        split(t0, p, q, r, m); split(n, np, nq, nr, m);
        return;
      }
      bisect(n);                                           // the neighbour first (its own longest edge), then try again
    }
    throw new Error('extrude: cap refinement did not settle');
  };
  for (let i = 0; i < T0.length; i += 3) add(T0[i], T0[i + 1], T0[i + 2]);
  for (let t = 0; t < tris.length; t++) {
    if (!tris[t]) continue;
    if (tris.length > 4e6) throw new Error('extrude: the cap needs over 4M triangles — loosen the tolerance or raise the smallest edge');
    if (needs(tris[t])) bisect(t);
  }
  const T = [];
  for (const t of tris) if (t) T.push(t[0], t[1], t[2]);
  return T;
}

// bottom / top z per plan vertex + the CCW plan triangles → the closed mesh
function assemble(P, T, zb, zt) {
  const nv = P.length;
  const V = new Float64Array(nv * 6);
  for (let i = 0; i < nv; i++) {
    V[i * 3] = P[i][0]; V[i * 3 + 1] = P[i][1]; V[i * 3 + 2] = zb[i];
    V[(nv + i) * 3] = zt.x ? zt.x[i] : P[i][0]; V[(nv + i) * 3 + 1] = zt.y ? zt.y[i] : P[i][1]; V[(nv + i) * 3 + 2] = zt.z[i];
  }
  // boundary edges: a directed edge whose reverse no triangle has
  const dir = new Set();
  for (let i = 0; i < T.length; i += 3) for (let e = 0; e < 3; e++) dir.add(T[i + e] * 4294967296 + T[i + (e + 1) % 3]);
  const out = [];
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i], b = T[i + 1], c = T[i + 2];
    out.push(nv + a, nv + b, nv + c);                      // top: CCW from above → faces up
    out.push(a, c, b);                                     // bottom: reversed → faces down
    for (let e = 0; e < 3; e++) {
      const p = T[i + e], q = T[i + (e + 1) % 3];
      if (dir.has(q * 4294967296 + p)) continue;           // an interior edge
      out.push(p, q, nv + q, p, nv + q, nv + p);           // the wall on p → q faces right of it: outward
    }
  }
  return { vertices: V, triangles: Uint32Array.from(out) };
}

// signed volume (divergence theorem) about the mesh's first vertex — small numbers at UTM magnitudes
export function meshVolume(V, T) {
  if (!V.length) return 0;
  const ox = V[0], oy = V[1], oz = V[2];
  let v = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const ax = V[a] - ox, ay = V[a + 1] - oy, az = V[a + 2] - oz, bx = V[b] - ox, by = V[b + 1] - oy, bz = V[b + 2] - oz, cx = V[c] - ox, cy = V[c + 1] - oy, cz = V[c + 2] - oz;
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

// watertight + consistently oriented: every undirected edge used by exactly two triangles, once in
// each direction. → { ok, edges, boundary, nonManifold, misoriented, volume }
export function manifoldCheck(V, T) {
  const und = new Map(), dirs = new Map();
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = T[t + e], b = T[t + (e + 1) % 3], k = ekey(a, b);
    und.set(k, (und.get(k) || 0) + 1);
    const d = a * 4294967296 + b; dirs.set(d, (dirs.get(d) || 0) + 1);
  }
  let boundary = 0, nonManifold = 0, misoriented = 0;
  for (const [, n] of und) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  for (const [d, n] of dirs) if (n > 1) misoriented++;
  void dirs;
  return { ok: !boundary && !nonManifold && !misoriented, edges: und.size, boundary, nonManifold, misoriented, volume: meshVolume(V, T) };
}

// several shells (one per polygon part) → one mesh
function merge(shells) {
  let nv = 0, nt = 0;
  for (const s of shells) { nv += s.vertices.length; nt += s.triangles.length; }
  const V = new Float64Array(nv), T = new Uint32Array(nt);
  let vo = 0, to = 0;
  for (const s of shells) {
    V.set(s.vertices, vo);
    const base = vo / 3;
    for (let i = 0; i < s.triangles.length; i++) T[to + i] = s.triangles[i] + base;
    vo += s.vertices.length; to += s.triangles.length;
  }
  return { vertices: V, triangles: T };
}
const partRings = (f) => {
  if (!f || !f.closed) throw new Error('extrude: a polygon (a closed feature) — a line has no inside');
  return f.parts.map((part) => part.map((ri) => f.rings[ri]));
};
const planArea = (parts) => parts.reduce((s, rings) => s + rings.reduce((a, r, k) => a + (k === 0 ? 1 : -1) * Math.abs(ringAreaXY(r)), 0), 0);
function finish(shells, extra) {
  if (!shells.length) throw new Error('extrude: the polygon has no area to extrude');
  const m = merge(shells);
  return { ...m, volume: meshVolume(m.vertices, m.triangles), ...extra };
}

export function extrudeZRange(f, { z0, z1 }) {
  const lo = Math.min(+z0, +z1), hi = Math.max(+z0, +z1);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('extrude: z0 and z1 are numbers');
  if (!(hi > lo)) throw new Error('extrude: z1 must differ from z0 — a prism needs a height');
  const parts = partRings(f), shells = [];
  for (const rings of parts) {
    const pl = planPart(rings); if (!pl) continue;
    shells.push(assemble(pl.P, pl.T, pl.P.map(() => lo), { z: pl.P.map(() => hi) }));
  }
  return finish(shells, { area: planArea(parts), stats: { z0: lo, z1: hi } });
}

export function extrudeOriented(f, { direction, length }) {
  const d = directionOf(direction), L = +length;
  if (!(Number.isFinite(L) && L !== 0)) throw new Error('extrude: length — a non-zero distance along the direction');
  if (Math.abs(d[2]) < 1e-6) throw new Error('extrude: a horizontal direction sweeps the polygon along its own plane — give it a plunge');
  const parts = partRings(f), shells = [];
  for (const rings of parts) {
    const pl = planPart(rings); if (!pl) continue;
    const s = assemble(pl.P, pl.T, pl.P.map((p) => p[2]), { x: pl.P.map((p) => p[0] + d[0] * L), y: pl.P.map((p) => p[1] + d[1] * L), z: pl.P.map((p) => p[2] + d[2] * L) });
    // a top BELOW the base turns every face inward — flip the shell
    if (meshVolume(s.vertices, s.triangles) < 0) for (let t = 0; t < s.triangles.length; t += 3) { const x = s.triangles[t + 1]; s.triangles[t + 1] = s.triangles[t + 2]; s.triangles[t + 2] = x; }
    shells.push(s);
  }
  return finish(shells, { area: planArea(parts), stats: { direction: d, length: L } });
}

export function extrudeBetween(f, { top, bottom, tol = 0.05, maxEdge = Infinity, minEdge = 0 }) {
  if (typeof top !== 'function' || typeof bottom !== 'function') throw new Error('extrude: top and bottom are surfaces');
  const parts = partRings(f), shells = [];
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of parts) for (const p of rings[0]) { if (p[0] < bb[0]) bb[0] = p[0]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[1] > bb[3]) bb[3] = p[1]; }
  const span = Math.max(bb[2] - bb[0], bb[3] - bb[1]) || 1;
  const hMax = Number.isFinite(+maxEdge) && +maxEdge > 0 ? +maxEdge : span / 8;
  const hMin = +minEdge > 0 ? +minEdge : hMax / 64;
  const tolZ = +tol > 0 ? +tol : 0.05;
  let maxDev = 0, clamped = 0, samples = 0;
  const zAt = (fn, x, y, what) => {
    const z = fn(x, y); samples++;
    if (!Number.isFinite(z)) throw new Error(`extrude: the ${what} surface has no value at (${+x.toFixed(2)}, ${+y.toFixed(2)}) — it must cover the whole polygon`);
    return z;
  };
  for (const rings of parts) {
    const pl = planPart(rings, hMax); if (!pl) continue;
    const { P } = pl;
    const zt = [], zb = [];
    const zOf = (i) => { if (zt[i] === undefined) { zt[i] = zAt(top, P[i][0], P[i][1], 'top'); zb[i] = zAt(bottom, P[i][0], P[i][1], 'bottom'); } };
    const dev = (x, y, et, eb) => Math.max(Math.abs(zAt(top, x, y, 'top') - et), Math.abs(zAt(bottom, x, y, 'bottom') - eb));
    // a triangle needs a split when an edge is over hMax, or — still above hMin — the cap strays
    // from either surface by more than tol at an edge's midpoint or at the centroid
    const needs = ([a, b, c]) => {
      zOf(a); zOf(b); zOf(c);
      const l = (p, q) => Math.hypot(P[p][0] - P[q][0], P[p][1] - P[q][1]);
      const L = Math.max(l(a, b), l(b, c), l(c, a));
      if (L > hMax) return true;
      if (L <= hMin) return false;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) if (dev((P[p][0] + P[q][0]) / 2, (P[p][1] + P[q][1]) / 2, (zt[p] + zt[q]) / 2, (zb[p] + zb[q]) / 2) > tolZ) return true;
      return dev((P[a][0] + P[b][0] + P[c][0]) / 3, (P[a][1] + P[b][1] + P[c][1]) / 3, (zt[a] + zt[b] + zt[c]) / 3, (zb[a] + zb[b] + zb[c]) / 3) > tolZ;
    };
    const T = refinePlan(P, pl.T, needs);
    for (let i = 0; i < P.length; i++) zOf(i);
    // the achieved fit, measured where the refinement measured it
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) maxDev = Math.max(maxDev, dev((P[p][0] + P[q][0]) / 2, (P[p][1] + P[q][1]) / 2, (zt[p] + zt[q]) / 2, (zb[p] + zb[q]) / 2));
      maxDev = Math.max(maxDev, dev((P[a][0] + P[b][0] + P[c][0]) / 3, (P[a][1] + P[b][1] + P[c][1]) / 3, (zt[a] + zt[b] + zt[c]) / 3, (zb[a] + zb[b] + zb[c]) / 3));
    }
    // where the surfaces cross, the bottom is lifted to the top: the solid is pinched to nothing there
    const zbo = P.map((_, i) => { if (zb[i] > zt[i]) { clamped++; return zt[i]; } return zb[i]; });
    shells.push(assemble(P, T, zbo, { z: P.map((_, i) => zt[i]) }));
  }
  return finish(shells, { area: planArea(parts), stats: { tol: tolZ, maxEdge: hMax, minEdge: hMin, maxDeviation: maxDev, crossed: clamped, samples } });
}
