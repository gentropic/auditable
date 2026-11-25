// micro PLAN UNION — one rule for polygons that overlap: their UNION. Pure (no DOM, no state).
//
// A MultiPolygon whose parts overlap, or a limit made of features that overlap, has one obvious
// meaning — the ground any of them covers — and every consumer must agree on it: the centroid
// test (grade–tonnage, swath, stats, factors, projection to grid), the per-cell coverage (cut /
// fill, the DEM limit, by-solid prisms) and the area a limit reports. Before 2026-11-25 they
// disagreed three ways (even-odd over every ring made an overlap OUTSIDE; coverage added parts;
// area added parts). A part is one outer ring with its holes; a point is inside a part by even-
// odd over that part's rings, and inside the union when inside any part.
//
//   partsOf(features) → [{ rings, bb }]        closed features only; a feature without `parts`
//                                               is one part of all its rings
//   partContains(part, x, y) / unionContains(parts, x, y)
//   unionAreaInRect(parts, x0, y0, x1, y1)     the exact plan area of (∪ parts) ∩ rectangle
//   unionArea(parts)                            the exact plan area of the union
//
// The area is exact: between consecutive x-breakpoints — every vertex, every crossing of two
// edges, every crossing of the rectangle's top or bottom — the covered length of a vertical line
// changes linearly, so its length at each slab's middle times the slab's width sums exactly.

export function partsOf(features) {
  const out = [];
  for (const f of features || []) {
    if (!f || !f.closed || !f.rings || !f.rings.length) continue;
    const groups = f.parts && f.parts.length ? f.parts : [f.rings.map((_, i) => i)];
    for (const g of groups) {
      const rings = g.map((ri) => f.rings[ri]).filter((r) => r && r.length >= 3);
      if (!rings.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of rings[0]) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      out.push({ rings, bb: [x0, y0, x1, y1] });
    }
  }
  return out;
}

// one feature's parts, cached on it (non-enumerable `_parts`; poly-ui editFeatures drops it after
// an in-place edit, with the bbox)
export function featureParts(f) {
  if (!f._parts) Object.defineProperty(f, '_parts', { value: partsOf([f]), enumerable: false, configurable: true, writable: true });
  return f._parts;
}

export function partContains(part, x, y) {
  const b = part.bb;
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let inside = false;
  for (const r of part.rings) {
    for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const yi = r[i][1], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (r[j][0] - r[i][0]) * (y - yi) / (yj - yi) + r[i][0]) inside = !inside;
    }
  }
  return inside;
}
export const unionContains = (parts, x, y) => parts.some((p) => partContains(p, x, y));

const bbMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
// do any two parts' boxes meet? (no → the union is the plain sum)
export function anyOverlap(parts) {
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (bbMeet(parts[i].bb, parts[j].bb)) return true;
  return false;
}

const ringArea = (r) => { let s = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(s / 2); };
const partArea = (p) => p.rings.reduce((a, r, k) => a + (k === 0 ? ringArea(r) : -ringArea(r)), 0);

export function unionArea(parts) {
  if (!parts.length) return 0;
  if (parts.length === 1 || !anyOverlap(parts)) return parts.reduce((a, p) => a + Math.max(0, partArea(p)), 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) { x0 = Math.min(x0, p.bb[0]); y0 = Math.min(y0, p.bb[1]); x1 = Math.max(x1, p.bb[2]); y1 = Math.max(y1, p.bb[3]); }
  return unionAreaInRect(parts, x0, y0, x1, y1);
}

export function unionAreaInRect(parts, x0, y0, x1, y1) {
  if (!(x1 > x0 && y1 > y0)) return 0;
  // the edges that can cross a vertical line inside [x0, x1], tagged by part
  const E = [];
  parts.forEach((p, pi) => {
    if (p.bb[2] < x0 || p.bb[0] > x1) return;
    for (const r of p.rings) for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
      const ax = r[j][0], ay = r[j][1], bx = r[i][0], by = r[i][1];
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || ax === bx) continue;   // vertical edges never cross a vertical line
      E.push([ax, ay, bx, by, pi]);
    }
  });
  if (!E.length) return 0;
  // x-breakpoints: the rectangle's sides, the vertices, edge × edge crossings (between parts —
  // within a valid part edges don't cross), edge × the rectangle's top and bottom
  const xs = [x0, x1];
  const inX = (x) => x > x0 && x < x1;
  for (const e of E) { if (inX(e[0])) xs.push(e[0]); if (inX(e[2])) xs.push(e[2]);
    for (const yc of [y0, y1]) if ((e[1] - yc) * (e[3] - yc) < 0) { const x = e[0] + (yc - e[1]) / (e[3] - e[1]) * (e[2] - e[0]); if (inX(x)) xs.push(x); } }
  for (let a = 0; a < E.length; a++) for (let b = a + 1; b < E.length; b++) {
    const p = E[a], q = E[b];
    if (p[4] === q[4]) continue;
    const d = (p[2] - p[0]) * (q[3] - q[1]) - (p[3] - p[1]) * (q[2] - q[0]);
    if (d === 0) continue;
    const t = ((q[0] - p[0]) * (q[3] - q[1]) - (q[1] - p[1]) * (q[2] - q[0])) / d;
    const u = ((q[0] - p[0]) * (p[3] - p[1]) - (q[1] - p[1]) * (p[2] - p[0])) / d;
    if (t > 0 && t < 1 && u > 0 && u < 1) { const x = p[0] + t * (p[2] - p[0]); if (inX(x)) xs.push(x); }
  }
  xs.sort((a, b) => a - b);
  const np = parts.length, ys = Array.from({ length: np }, () => []);
  let area = 0;
  for (let k = 0; k + 1 < xs.length; k++) {
    const xa = xs[k], xb = xs[k + 1];
    if (!(xb > xa)) continue;
    const xm = (xa + xb) / 2;
    for (const l of ys) l.length = 0;
    for (const e of E) {
      if ((e[0] > xm) === (e[2] > xm)) continue;
      ys[e[4]].push(e[1] + (xm - e[0]) / (e[2] - e[0]) * (e[3] - e[1]));
    }
    // each part's even-odd intervals, clipped to [y0, y1], then their union's length
    const iv = [];
    for (const l of ys) { if (l.length < 2) continue; l.sort((a, b) => a - b); for (let i = 0; i + 1 < l.length; i += 2) { const lo = Math.max(y0, l[i]), hi = Math.min(y1, l[i + 1]); if (hi > lo) iv.push([lo, hi]); } }
    if (!iv.length) continue;
    iv.sort((a, b) => a[0] - b[0]);
    let len = 0, cs = iv[0][0], ce = iv[0][1];
    for (let i = 1; i < iv.length; i++) { if (iv[i][0] > ce) { len += ce - cs; cs = iv[i][0]; ce = iv[i][1]; } else if (iv[i][1] > ce) ce = iv[i][1]; }
    len += ce - cs;
    area += len * (xb - xa);
  }
  return area;
}
