// micro COVERAGE — how much of each lattice cell a set of polygons covers in plan, EXACTLY.
// Pure (no DOM, no state): cut / fill's perimeter, the point-cloud DEM's limit and the vertical-
// prism fast path of the by-solid fraction all ask "what fraction of this cell is inside", and a
// centroid in/out answer is wrong by up to half a cell along every edge. Here a cell crossed by an
// edge gets its covered area by clipping the polygon to the cell (Sutherland–Hodgman against the
// cell's four sides — exact for any simple polygon, convex or not, because the clip window is
// convex); a cell no edge comes near is wholly in or wholly out, and its centre says which.
//
//   planCoverage(features, lat, { out }) → Float32Array(nx·ny), fraction ∈ [0, 1] per cell
//       features: polygon features ({ closed, rings, parts } — tools/micro/src/polygons.js); lines skip
//       lat: { ox, oy, dx, dy, nx, ny } — cell (i, j)'s CENTRE is (ox + i·dx, oy + j·dy); dy may be
//            negative (a grid stored top row first). Cell (i, j) is out[i + j·nx].
//       Holes subtract; overlapping parts and overlapping features count ONCE — their union
//       (src/plan-union.js), the same rule as the centroid test and the reported area.
//   clipRectArea(ring, x0, y0, x1, y1) → the plan area of ring ∩ the rectangle (unsigned)
//   pointInFeatureXY(f, x, y) → inside any part (each part by even-odd over its own rings)
//   ringAreaXY(ring) → signed plan area (positive = counter-clockwise)

import { partsOf, featureParts, partContains, unionContains, unionArea, unionAreaInRect } from './plan-union.js';

export function ringAreaXY(ring) {
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s / 2;
}

export function featureBBoxXY(f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of f.rings) for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}

export function pointInFeatureXY(f, x, y, bb = null) {
  if (!f || !f.closed) return false;
  if (bb && (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3])) return false;
  return unionContains(featureParts(f), x, y);
}

// one half-plane step of Sutherland–Hodgman. side(p) ≥ 0 keeps; cut(a, b) is where the edge crosses.
function clipHalf(pts, keep, cut) {
  const out = [];
  const n = pts.length;
  if (!n) return out;
  let prev = pts[n - 1], pin = keep(prev);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], cin = keep(cur);
    if (cin) { if (!pin) out.push(cut(prev, cur)); out.push(cur); }
    else if (pin) out.push(cut(prev, cur));
    prev = cur; pin = cin;
  }
  return out;
}
const atX = (c) => (a, b) => { const t = (c - a[0]) / (b[0] - a[0]); return [c, a[1] + t * (b[1] - a[1])]; };
const atY = (c) => (a, b) => { const t = (c - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), c]; };

export function clipRectArea(ring, x0, y0, x1, y1) {
  let p = ring;
  p = clipHalf(p, (q) => q[0] >= x0, atX(x0)); if (p.length < 3) return 0;
  p = clipHalf(p, (q) => q[0] <= x1, atX(x1)); if (p.length < 3) return 0;
  p = clipHalf(p, (q) => q[1] >= y0, atY(y0)); if (p.length < 3) return 0;
  p = clipHalf(p, (q) => q[1] <= y1, atY(y1)); if (p.length < 3) return 0;
  return Math.abs(ringAreaXY(p));
}

// the covered area of ONE feature inside a rectangle: holes subtract, overlapping parts count once
export function featureRectArea(f, x0, y0, x1, y1) {
  return partsRectArea(featureParts(f), x0, y0, x1, y1);
}
// a set of parts inside a rectangle: one part (or parts whose boxes don't meet inside it) by
// clipping each ring to the rectangle — exact and fast; parts that can overlap there by the union
function partsRectArea(parts, x0, y0, x1, y1) {
  const live = parts.filter((p) => p.bb[0] < x1 && p.bb[2] > x0 && p.bb[1] < y1 && p.bb[3] > y0);
  if (!live.length) return 0;
  const clipBB = (b) => [Math.max(b[0], x0), Math.max(b[1], y0), Math.min(b[2], x1), Math.min(b[3], y1)];
  let meet = false;
  for (let i = 0; i < live.length && !meet; i++) for (let j = i + 1; j < live.length; j++) {
    const a = clipBB(live[i].bb), b = clipBB(live[j].bb);
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) { meet = true; break; }
  }
  if (meet) return unionAreaInRect(live, x0, y0, x1, y1);
  let a = 0;
  for (const p of live) {
    let pa = 0;
    p.rings.forEach((r, k) => { const v = clipRectArea(r, x0, y0, x1, y1); pa += k === 0 ? v : -v; });
    if (pa > 0) a += pa;
  }
  return a;
}

// the inclusive index range of cells whose square can reach [lo, hi] along one axis
function cellRange(lo, hi, o, d, n) {
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const t = a; a = b; b = t; }
  return [Math.max(0, Math.floor(a - 0.5)), Math.min(n - 1, Math.ceil(b + 0.5))];
}

export function planCoverage(features, lat, { out = null } = {}) {
  const { ox, oy, dx, dy, nx, ny } = lat;
  const N = nx * ny;
  const frac = out || new Float32Array(N);
  const polys = (features || []).filter((f) => f && f.closed && f.rings && f.rings.length);
  if (!polys.length || !N) return frac;
  const adx = Math.abs(dx), ady = Math.abs(dy), hx = adx / 2, hy = ady / 2, cellA = adx * ady;
  // 1. every cell an edge passes through or next to: sample each edge at ≤ half a cell and mark the
  //    3 × 3 cells around each sample — a piece of edge between two samples can't leave them
  const near = new Uint8Array(N);
  const step = Math.min(adx, ady) / 2;
  for (const f of polys) for (const r of f.rings) {
    for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let s = 0; s <= k; s++) {
        const x = ax + (bx - ax) * s / k, y = ay + (by - ay) * s / k;
        const ci = Math.round((x - ox) / dx), cj = Math.round((y - oy) / dy);
        for (let qj = cj - 1; qj <= cj + 1; qj++) {
          if (qj < 0 || qj >= ny) continue;
          for (let qi = ci - 1; qi <= ci + 1; qi++) if (qi >= 0 && qi < nx) near[qi + qj * nx] = 1;
        }
      }
    }
  }
  // 2. per part, over the cells its box reaches. A cell no edge comes near is wholly in or out of
  //    EVERY part, so its union is any part containing its centre; a near cell is clipped exactly,
  //    ONCE, against every part that reaches it (overlaps counted once — src/plan-union.js)
  const parts = partsOf(polys), done = new Uint8Array(N);
  for (const P of parts) {
    const bb = P.bb;
    const [i0, i1] = cellRange(bb[0], bb[2], ox, dx, nx), [j0, j1] = cellRange(bb[1], bb[3], oy, dy, ny);
    for (let j = j0; j <= j1; j++) {
      const cy = oy + j * dy;
      for (let i = i0; i <= i1; i++) {
        const c = i + j * nx;
        if (done[c] || frac[c] >= 1) continue;
        const cx = ox + i * dx;
        if (near[c]) { frac[c] = Math.min(1, partsRectArea(parts, cx - hx, cy - hy, cx + hx, cy + hy) / cellA); done[c] = 1; }
        else if (partContains(P, cx, cy)) frac[c] = 1;
      }
    }
  }
  return frac;
}

// the plan area of a set of polygon features: holes subtracted, overlaps (between parts or
// between features) counted ONCE — their union
export function featuresAreaXY(features) {
  return unionArea(partsOf(features));
}
// a lattice clipped to a plan bbox (grown by one cell), nodes kept on the same phase.
// lat: { x0, y0, dx, dy, nx, ny } in the grid convention (y0 = the TOP row's y, rows go down by dy).
export function clipGridLattice(g, bb) {
  const dy = g.dy || g.dx;
  const i0 = Math.max(0, Math.floor((bb[0] - g.x0) / g.dx) - 1), i1 = Math.min(g.nx - 1, Math.ceil((bb[2] - g.x0) / g.dx) + 1);
  const j0 = Math.max(0, Math.floor((g.y0 - bb[3]) / dy) - 1), j1 = Math.min(g.ny - 1, Math.ceil((g.y0 - bb[1]) / dy) + 1);
  if (i1 < i0 || j1 < j0) return null;
  return { x0: g.x0 + i0 * g.dx, y0: g.y0 - j0 * dy, dx: g.dx, dy, nx: i1 - i0 + 1, ny: j1 - j0 + 1 };
}
// the coverage of a GRID lattice (row 0 = top): planCoverage in the grid's own index order
export const gridCoverage = (features, g) => planCoverage(features, { ox: g.x0, oy: g.y0, dx: g.dx, dy: -(g.dy || g.dx), nx: g.nx, ny: g.ny });
