// @gcu/geometry earclip — polygon triangulation by ear clipping, holes included.
//
//   earclip(coords, holeIndices = null, dim = 2) → Uint32Array of vertex indices (3 per triangle)
//   triangulateRings(rings) → { vertices: Float64Array (x,y,z), triangles: Uint32Array }
//
// `coords` is a flat array of vertices (x, y[, z …] — `dim` numbers each); `holeIndices`
// lists the VERTEX index where each hole ring starts (the outer ring comes first). The
// triangulation is computed in the xy plane (a plan-view polygon: a pit limit, a lease, a
// blast pattern), so a ring that is vertical in z is not this function's job.
//
// The algorithm follows the shape of mapbox/earcut (ISC, © Mapbox): each ring is a circular
// doubly-linked list, holes are bridged into the outer ring (rightmost hole first, through
// the outer vertex that sees the hole's leftmost point), then ears are clipped; when no ear
// is left, the list is cleaned of local self-intersections and finally split in two along a
// valid diagonal. Rings may be given in either winding — the outer ring is reoriented
// clockwise-in-math (earcut's convention) and holes the opposite way. A repeated closing
// vertex is ignored. No z-order hashing: O(n²) worst case, which is ample for the polygons
// people draw and digitize (thousands of vertices, not millions).
//
// Degenerate input (fewer than 3 distinct vertices, zero area) yields no triangles rather
// than throwing.

class Node {
  constructor(i, x, y) {
    this.i = i; this.x = x; this.y = y;
    this.prev = null; this.next = null;
    this.steiner = false;
  }
}

function insertNode(i, x, y, last) {
  const p = new Node(i, x, y);
  if (!last) { p.prev = p; p.next = p; }
  else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
  return p;
}
function removeNode(p) { p.next.prev = p.prev; p.prev.next = p.next; }
const equals = (p1, p2) => p1.x === p2.x && p1.y === p2.y;
// signed area of a triangle (positive when p, q, r turn clockwise in a y-up frame — earcut's sign)
const area = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

function signedArea(data, start, end, dim) {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

// a ring as a linked list, in the requested winding
function linkedList(data, start, end, dim, clockwise) {
  let last = null;
  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) last = insertNode(i / dim, data[i], data[i + 1], last);
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i / dim, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
  return last;
}

// drop duplicate and collinear points
function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  let p = start, again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
         (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
         (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

function isEar(ear) {
  const a = ear.prev, b = ear, c = ear.next;
  if (area(a, b, c) >= 0) return false;                    // reflex: not an ear
  let p = ear.next.next;
  while (p !== ear.prev) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const onSegment = (p, q, r) => q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
function intersects(p1, q1, p2, q2) {
  const o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}
function intersectsPolygon(a, b) {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}
const locallyInside = (a, b) => (area(a.prev, a, a.next) < 0
  ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
  : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0);
function middleInside(a, b) {
  let p = a, inside = false;
  const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}
function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
     (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
}

// link a and b with a bridge, duplicating both: two lists become one (or one becomes two)
function splitPolygon(a, b) {
  const a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y);
  const an = a.next, bp = b.prev;
  a.next = b; b.prev = a;
  a2.next = an; an.prev = a2;
  b2.next = a2; a2.prev = b2;
  bp.next = b2; b2.prev = bp;
  return b2;
}

function cureLocalIntersections(start, triangles) {
  let p = start;
  do {
    const a = p.prev, b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i, p.i, b.i);
      removeNode(p); removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

function splitEarclip(start, triangles) {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);
        earclipLinked(a, triangles, 0);
        earclipLinked(c, triangles, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

function earclipLinked(ear, triangles, pass) {
  if (!ear) return;
  let stop = ear;
  while (ear.prev !== ear.next) {
    const prev = ear.prev, next = ear.next;
    if (isEar(ear)) {
      triangles.push(prev.i, ear.i, next.i);
      removeNode(ear);
      ear = next.next; stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) earclipLinked(filterPoints(ear), triangles, 1);
      else if (pass === 1) { ear = cureLocalIntersections(filterPoints(ear), triangles); earclipLinked(ear, triangles, 2); }
      else if (pass === 2) splitEarclip(ear, triangles);
      break;
    }
  }
}

// ── holes ──
function getLeftmost(start) {
  let p = start, left = start;
  do {
    if (p.x < left.x || (p.x === left.x && p.y < left.y)) left = p;
    p = p.next;
  } while (p !== start);
  return left;
}
const sectorContainsSector = (m, p) => area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
// the outer-ring vertex that a ray from the hole's leftmost point, cast left, can reach unobstructed
function findHoleBridge(hole, outer) {
  let p = outer, qx = -Infinity, m = null;
  const hx = hole.x, hy = hole.y;
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        if (x === hx) {                                    // the hole touches the outer ring there
          if (hy === p.y) return p;
          if (hy === p.next.y) return p.next;
        }
        m = p.x < p.next.x ? p : p.next;
      }
    }
    p = p.next;
  } while (p !== outer);
  if (!m) return null;
  // the visible vertex with the smallest angle to the ray, among those inside the triangle (h, ray hit, m)
  const stop = m, mx = m.x, my = m.y;
  let tanMin = Infinity;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x &&
        pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);
      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
        m = p; tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}
function eliminateHole(hole, outer) {
  const bridge = findHoleBridge(hole, outer);
  if (!bridge) return outer;
  const bridgeReverse = splitPolygon(bridge, hole);
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}
function eliminateHoles(data, holeIndices, outer, dim) {
  const queue = [];
  for (let i = 0; i < holeIndices.length; i++) {
    const start = holeIndices[i] * dim;
    const end = i < holeIndices.length - 1 ? holeIndices[i + 1] * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const h of queue) outer = eliminateHole(h, outer);
  return outer;
}

export function earclip(coords, holeIndices = null, dim = 2) {
  const data = coords;
  const hasHoles = holeIndices && holeIndices.length;
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  let outer = linkedList(data, 0, outerLen, dim, true);
  const triangles = [];
  if (!outer || outer.next === outer.prev) return new Uint32Array(0);
  if (hasHoles) outer = eliminateHoles(data, holeIndices, outer, dim);
  earclipLinked(outer, triangles, 0);
  return Uint32Array.from(triangles);
}

// rings: [outer, hole, hole…], each [[x, y, z?], …] (a repeated closing vertex is dropped).
// → { vertices: Float64Array (x, y, z per vertex — z from the ring, 0 when absent), triangles }
export function triangulateRings(rings) {
  const flat = [], holes = [], zs = [];
  let n = 0;
  for (let r = 0; r < rings.length; r++) {
    let ring = rings[r] || [];
    if (ring.length > 1) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) ring = ring.slice(0, -1);
    }
    if (ring.length < 3) { if (r === 0) return { vertices: new Float64Array(0), triangles: new Uint32Array(0) }; continue; }
    if (r > 0) holes.push(n);
    for (const p of ring) { flat.push(+p[0], +p[1]); zs.push(p.length > 2 && Number.isFinite(+p[2]) ? +p[2] : 0); n++; }
  }
  const triangles = earclip(flat, holes.length ? holes : null, 2);
  const vertices = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { vertices[i * 3] = flat[i * 2]; vertices[i * 3 + 1] = flat[i * 2 + 1]; vertices[i * 3 + 2] = zs[i]; }
  return { vertices, triangles };
}
