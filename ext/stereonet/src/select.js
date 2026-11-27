// @gcu/stereonet — SELECTIONS IN ATTITUDE SPACE. A shape lives on the sphere, not on the screen, so it keeps
// meaning the same measurements when the net rotates or changes projection. All tests are AXIAL: a pole and
// its antipode are the same measurement. Pure vector maths, no bearing needed.
//
// Shapes (direction cosines, x = E, y = N, z = Up):
//   { type: 'cone',    axis: [x,y,z], angle }       within `angle` degrees of the axis
//   { type: 'band',    pole: [x,y,z], width }       within `width` degrees of the great circle whose pole is `pole`
//   { type: 'polygon', vertices: [[x,y,z], …] }     inside a spherical polygon with great-circle edges (a lasso);
//                                                   it must fit within a hemisphere (any lasso drawn on a net does)

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** the great circle through two directions, as its pole (null if they coincide or are antipodal) */
export function greatCircleThrough(a, b) {
  const c = cross(norm(a), norm(b)), l = Math.hypot(...c);
  return l < 1e-9 ? null : [c[0] / l, c[1] / l, c[2] / l];
}

/** the angle between two axes, degrees (0–90) */
export function axialAngle(a, b) {
  return Math.acos(Math.min(1, Math.abs(dot(norm(a), norm(b))))) / D2R;
}

// a polygon's test, prepared once: a gnomonic projection about the polygon's centre maps its great-circle
// edges to straight lines, so "inside" is a plain 2D point-in-polygon there
function preparePolygon(vertices) {
  const V = vertices.map(norm);
  const s = V.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const c = norm(s);
  const u = norm(cross(Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], c)), w = cross(c, u);
  const flat = (d) => { const k = dot(d, c); return k > 1e-9 ? [dot(d, u) / k, dot(d, w) / k] : null; };
  const P = V.map(flat);
  if (P.some((q) => !q)) return () => false;           // wider than a hemisphere: not a lasso drawn on a net
  return (d) => {
    const q = flat(dot(d, c) < 0 ? [-d[0], -d[1], -d[2]] : d);   // axial: test the end on the polygon's side
    if (!q) return false;
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > q[1]) !== (yj > q[1]) && q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

/** a shape → a test (dcos → boolean), prepared once for many measurements */
export function shapeTest(shape) {
  if (shape.type === 'cone') { const a = norm(shape.axis), c = Math.cos(shape.angle * D2R); return (d) => Math.abs(dot(norm(d), a)) >= c - 1e-12; }
  if (shape.type === 'band') { const p = norm(shape.pole), s = Math.sin(shape.width * D2R); return (d) => Math.abs(dot(norm(d), p)) <= s + 1e-12; }
  if (shape.type === 'polygon') { if (!shape.vertices || shape.vertices.length < 3) return () => false; return preparePolygon(shape.vertices); }
  throw new Error(`unknown selection shape “${shape.type}”`);
}

/**
 * The rows of a layer's data inside a shape: [{ row, pole?|dcos?, lineDcos? }] → rows. A plane is tested by its
 * pole, a line by its direction — and a FAULT by either: its slip line is what the net draws (and what a click
 * picks), so a shape drawn round the slip points must catch them; its pole still counts.
 */
export function rowsInShape(data, shape) {
  const t = shapeTest(shape), out = [];
  for (const d of data) {
    if (!d) continue;
    const v = d.pole || d.dcos;
    if ((v && t(v)) || (d.lineDcos && t(d.lineDcos))) out.push(d.row);
  }
  return out;
}

/** points along a shape's outline, for drawing it on a net (n per edge / around) */
export function shapeOutline(shape, n = 72) {
  const ring = (axis, ang) => {
    const a = norm(axis), u = norm(cross(Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], a)), w = cross(a, u), c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
    const pts = []; for (let i = 0; i <= n; i++) { const t = 2 * Math.PI * i / n; pts.push([c * a[0] + s * (Math.cos(t) * u[0] + Math.sin(t) * w[0]), c * a[1] + s * (Math.cos(t) * u[1] + Math.sin(t) * w[1]), c * a[2] + s * (Math.cos(t) * u[2] + Math.sin(t) * w[2])]); }
    return pts;
  };
  if (shape.type === 'cone') return [ring(shape.axis, shape.angle)];
  if (shape.type === 'band') return [ring(shape.pole, 90 - shape.width), ring(shape.pole, 90 + shape.width)];
  if (shape.type === 'polygon') {
    const V = shape.vertices.map(norm), pts = [];
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length], m = 12;
      for (let k = 0; k < m; k++) { const t = k / m; pts.push(norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])); }
    }
    pts.push(V[0]);
    return [pts];
  }
  return [];
}
