// micro placement — the pure core (zero imports). A layer's RIGID PLACEMENT: a 3D similarity
// (Helmert, 7 parameters: a shift, three rotations, ONE uniform scale) that takes the layer's
// own coordinates ("local" — as its file states them) to the project's ("world"):
//
//     world = pivot + t + s·R·(local − pivot)
//
// Never a shear, never an affine: a block stays a box (its pitch scales), a mesh keeps its
// angles, a surface stays a surface. R is a proper rotation (det +1), stored column-major
// like condenser's support frame. Angles are degrees, counter-clockwise looking down each
// axis toward the origin (κ about Z = counter-clockwise seen from above), applied as
// R = Rz(κ)·Ry(φ)·Rx(ω) — the photogrammetric ω-φ-κ order.
//
// The stored form (on the layer, in the project, in lineage):
//   { tx, ty, tz, omega, phi, kappa, scale, pivot?: [x,y,z], R?: [9],
//     source: 'typed' | 'gcp' | 'crs-fit', residuals?, maxResidual?, rms?, … }
// R, when present, wins over the angles (a fitted rotation is kept exactly; the angles are
// its readable form).
//
// API:
//   compilePlacement(p)        → M = { R, s, t } (pivot folded in) | null (none / identity)
//   applyP(M, x, y, z, out)    → world; invertP(M) → M⁻¹; composeP(a, b) → a∘b (b first)
//   isIdentityP(M) · zOnlyP(M) · placeBbox(M, bbox) · placeGrid(M, grid)
//   rotFromAngles(ω, φ, κ) / anglesFromR(R)
//   fitSimilarity(pairs, { mode }) → { R, s, t, mode, residuals, rms, max, used }  (Horn/Umeyama)
//   crsSamplePoints(bbox, n) · fitCrsChange(from, to, { zRange })
//   placementFromFit(fit, source, extra) → the stored form
//   residualClass(v, tol) · describePlacement(p)
//   affineToGridPlace([a, b, c, d, e, f]) · parseWorldFile(text) · worldFileText(place, grid)

const D2R = Math.PI / 180;
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// ── rotations ────────────────────────────────────────────────────────────────
export function rotFromAngles(omega = 0, phi = 0, kappa = 0) {
  const a = omega * D2R, b = phi * D2R, c = kappa * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rz(κ)·Ry(φ)·Rx(ω), rows:
  const r00 = cc * cb, r01 = cc * sb * sa - sc * ca, r02 = cc * sb * ca + sc * sa;
  const r10 = sc * cb, r11 = sc * sb * sa + cc * ca, r12 = sc * sb * ca - cc * sa;
  const r20 = -sb, r21 = cb * sa, r22 = cb * ca;
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];       // column-major
}
export function anglesFromR(R) {
  const r20 = R[2], r21 = R[5], r22 = R[8], r10 = R[1], r00 = R[0];
  const phi = Math.asin(Math.max(-1, Math.min(1, -r20)));
  let omega, kappa;
  if (Math.abs(Math.cos(phi)) > 1e-9) { omega = Math.atan2(r21, r22); kappa = Math.atan2(r10, r00); }
  else { omega = Math.atan2(-R[7], R[4]); kappa = 0; }        // gimbal: κ folded into ω
  const t = (v) => { const d = v / D2R; return Math.abs(d) < 1e-12 ? 0 : d; };
  return { omega: t(omega), phi: t(phi), kappa: t(kappa) };
}
const mul3 = (A, B) => {                                       // column-major A·B
  const o = new Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = A[r] * B[c * 3] + A[3 + r] * B[c * 3 + 1] + A[6 + r] * B[c * 3 + 2];
  return o;
};
const tr3 = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const mv3 = (A, x, y, z) => [A[0] * x + A[3] * y + A[6] * z, A[1] * x + A[4] * y + A[7] * z, A[2] * x + A[5] * y + A[8] * z];
export { mul3 as mulR, tr3 as transposeR };

// ── the compiled transform ──────────────────────────────────────────────────
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
export function compilePlacement(p) {
  if (!p) return null;
  const R = Array.isArray(p.R) && p.R.length === 9 && p.R.every(Number.isFinite) ? p.R.slice() : rotFromAngles(num(p.omega), num(p.phi), num(p.kappa));
  const s = num(p.scale, 1) || 1;
  const pv = Array.isArray(p.pivot) && p.pivot.length === 3 ? p.pivot.map((v) => num(v)) : [0, 0, 0];
  const sh = [num(p.tx), num(p.ty), num(p.tz)];
  // world = pv + sh + s·R·(local − pv)  →  t = pv + sh − s·R·pv
  const rp = mv3(R, pv[0], pv[1], pv[2]);
  const t = [pv[0] + sh[0] - s * rp[0], pv[1] + sh[1] - s * rp[1], pv[2] + sh[2] - s * rp[2]];
  const M = { R, s, t };
  return isIdentityP(M) ? null : M;
}
export function isIdentityP(M, tol = 1e-12) {
  if (!M) return true;
  if (Math.abs(M.s - 1) > tol) return false;
  for (let i = 0; i < 9; i++) if (Math.abs(M.R[i] - I3[i]) > tol) return false;
  return !M.t.some((v) => Math.abs(v) > 1e-9);
}
/** rotation about Z only (a heightfield stays a heightfield) */
export function zOnlyP(M, tol = 1e-9) {
  if (!M) return true;
  return Math.abs(M.R[2]) < tol && Math.abs(M.R[5]) < tol && Math.abs(M.R[6]) < tol && Math.abs(M.R[7]) < tol && Math.abs(M.R[8] - 1) < tol;
}
/** pure rotation-free (shift + scale only): an axis-aligned lattice stays axis-aligned */
export const noRotationP = (M, tol = 1e-12) => !M || M.R.every((v, i) => Math.abs(v - I3[i]) <= tol);
export function applyP(M, x, y, z, out = [0, 0, 0]) {
  if (!M) { out[0] = x; out[1] = y; out[2] = z; return out; }
  const R = M.R, s = M.s, t = M.t;
  out[0] = t[0] + s * (R[0] * x + R[3] * y + R[6] * z);
  out[1] = t[1] + s * (R[1] * x + R[4] * y + R[7] * z);
  out[2] = t[2] + s * (R[2] * x + R[5] * y + R[8] * z);
  return out;
}
export const applyPoints = (M, pts) => pts.map((q) => applyP(M, q[0], q[1], q[2] || 0, [0, 0, 0]));
export function invertP(M) {
  if (!M) return null;
  const Rt = tr3(M.R), si = 1 / M.s, q = mv3(Rt, M.t[0], M.t[1], M.t[2]);
  return { R: Rt, s: si, t: [-si * q[0], -si * q[1], -si * q[2]] };
}
/** a∘b: apply b, then a */
export function composeP(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const R = mul3(a.R, b.R), s = a.s * b.s, q = mv3(a.R, b.t[0], b.t[1], b.t[2]);
  return { R, s, t: [a.t[0] + a.s * q[0], a.t[1] + a.s * q[1], a.t[2] + a.s * q[2]] };
}
/** a placement as a condenser dm-style place matrix: world = O + R'·local, R' = s·R */
export const scaledR = (M) => M.R.map((v) => v * M.s);
/** the AABB of a placed box ({ min, max } world): the eight corners transformed */
export function placeBbox(M, bb) {
  if (!M || !bb) return bb;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], o = [0, 0, 0];
  for (let k = 0; k < 8; k++) {
    applyP(M, k & 1 ? bb.max[0] : bb.min[0], k & 2 ? bb.max[1] : bb.min[1], k & 4 ? bb.max[2] : bb.min[2], o);
    for (let a = 0; a < 3; a++) { if (o[a] < min[a]) min[a] = o[a]; if (o[a] > max[a]) max[a] = o[a]; }
  }
  return { min, max };
}
/**
 * A block lattice (condenser grid/basis.js form: { x, y, z: { origin, pitch, count }, rot?, anchor? },
 * world = anchor + rot·q) under a placement. Boxes stay boxes: the lattice coordinates scale by s,
 * the orientation turns by R, the anchor moves. A rotation-free placement keeps an axis-aligned
 * grid axis-aligned (its origins move instead of gaining an anchor).
 */
export function placeGrid(M, g) {
  if (!M || !g || !g.x) return g;
  const rot0 = g.rot ? Array.from(g.rot) : I3.slice(), a0 = g.rot ? (g.anchor || [0, 0, 0]) : [0, 0, 0];
  const s = M.s, rot = mul3(M.R, rot0), anchor = applyP(M, a0[0], a0[1], a0[2], [0, 0, 0]);
  const ax = (k) => ({ ...g[k], origin: g[k].origin * s, pitch: g[k].pitch * s });
  const out = { ...g, x: ax('x'), y: ax('y'), z: ax('z') };
  if (rot.every((v, i) => Math.abs(v - I3[i]) < 1e-12)) {
    delete out.rot; delete out.anchor;
    out.x.origin += anchor[0]; out.y.origin += anchor[1]; out.z.origin += anchor[2];
  } else { out.rot = rot; out.anchor = anchor; }
  return out;
}

// ── fitting a similarity to control points (Horn 1987 / Umeyama 1991) ───────────
// 4×4 symmetric Jacobi: eigenvalues + vectors (column k of V for value k)
function jacobiSym(A, n) {
  const a = A.map((r) => r.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: a.map((r, i) => r[i]), V };
}
const xyz = (q) => [num(q && q[0]), num(q && q[1]), num(q && q[2])];
function collinear(pts) {
  if (pts.length < 3) return true;
  const c = [0, 1, 2].map((a) => pts.reduce((s, p) => s + p[a], 0) / pts.length);
  let far = null, fd = -1;
  for (const p of pts) { const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); if (d > fd) { fd = d; far = p; } }
  if (!(fd > 0)) return true;
  const u = [far[0] - c[0], far[1] - c[1], far[2] - c[2]].map((v) => v / fd);
  let off = 0;
  for (const p of pts) {
    const w = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], k = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
    off = Math.max(off, Math.hypot(w[0] - k * u[0], w[1] - k * u[1], w[2] - k * u[2]));
  }
  return off < 1e-6 * fd;
}
/**
 * Least-squares similarity from control-point pairs, closed form.
 * pairs: [{ from: [x,y,z], to: [x,y,z], use?: bool }] — from = the layer's own (local) coordinates,
 * to = where they truly are. mode: 'auto' (3D when ≥3 used, non-collinear pairs carry heights; else
 * 2D) · '2d' (shift + rotation about Z + scale, ≥2 pairs) · '3d' (all seven, ≥3 non-collinear).
 * Residuals are reported for EVERY pair (a dropped one shows how far it would be off), the fit uses
 * only the `use !== false` ones. → { R, s, t, mode, residuals: [{ dx, dy, dz, h, v, d, use }], rms, max, used }
 */
export function fitSimilarity(pairs, { mode = 'auto' } = {}) {
  const all = (pairs || []).map((p) => ({ a: xyz(p.from), b: xyz(p.to), use: p.use !== false }));
  const U = all.filter((p) => p.use);
  if (U.length < 2) throw new Error('a fit needs at least two control points in use');
  const hasZ = U.some((p) => p.a[2] !== 0 || p.b[2] !== 0);
  let m = mode;
  if (m === 'auto') m = U.length >= 3 && hasZ && !collinear(U.map((p) => p.a)) ? '3d' : '2d';
  if (m === '3d' && (U.length < 3 || collinear(U.map((p) => p.a)))) throw new Error('a 3D fit needs at least three control points that are not in a line');
  const n = U.length, ca = [0, 0, 0], cb = [0, 0, 0];
  for (const p of U) for (let k = 0; k < 3; k++) { ca[k] += p.a[k] / n; cb[k] += p.b[k] / n; }
  let R, s;
  if (m === '2d') {
    let A = 0, B = 0, Saa = 0;
    for (const p of U) {
      const ax = p.a[0] - ca[0], ay = p.a[1] - ca[1], bx = p.b[0] - cb[0], by = p.b[1] - cb[1];
      A += ax * bx + ay * by; B += ax * by - ay * bx; Saa += ax * ax + ay * ay;
    }
    if (!(Saa > 0)) throw new Error('the control points coincide — they must be apart to fix a rotation and a scale');
    const th = Math.atan2(B, A); s = Math.hypot(A, B) / Saa;
    const c = Math.cos(th), sn = Math.sin(th);
    R = [c, sn, 0, -sn, c, 0, 0, 0, 1];
  } else {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let Saa = 0;
    for (const p of U) {
      const a = [p.a[0] - ca[0], p.a[1] - ca[1], p.a[2] - ca[2]], b = [p.b[0] - cb[0], p.b[1] - cb[1], p.b[2] - cb[2]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += a[i] * b[j];
      Saa += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    }
    const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
    const N = [
      [xx + yy + zz, yz - zy, zx - xz, xy - yx],
      [yz - zy, xx - yy - zz, xy + yx, zx + xz],
      [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
      [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
    ];
    const { values, V } = jacobiSym(N, 4);
    let k = 0; for (let i = 1; i < 4; i++) if (values[i] > values[k]) k = i;
    let [q0, qx, qy, qz] = [V[0][k], V[1][k], V[2][k], V[3][k]];
    const qn = Math.hypot(q0, qx, qy, qz); q0 /= qn; qx /= qn; qy /= qn; qz /= qn;
    const r00 = q0 * q0 + qx * qx - qy * qy - qz * qz, r01 = 2 * (qx * qy - q0 * qz), r02 = 2 * (qx * qz + q0 * qy);
    const r10 = 2 * (qy * qx + q0 * qz), r11 = q0 * q0 - qx * qx + qy * qy - qz * qz, r12 = 2 * (qy * qz - q0 * qx);
    const r20 = 2 * (qz * qx - q0 * qy), r21 = 2 * (qz * qy + q0 * qx), r22 = q0 * q0 - qx * qx - qy * qy + qz * qz;
    R = [r00, r10, r20, r01, r11, r21, r02, r12, r22];
    let num2 = 0;
    for (const p of U) { const a = [p.a[0] - ca[0], p.a[1] - ca[1], p.a[2] - ca[2]], b = [p.b[0] - cb[0], p.b[1] - cb[1], p.b[2] - cb[2]], ra = mv3(R, a[0], a[1], a[2]); num2 += b[0] * ra[0] + b[1] * ra[1] + b[2] * ra[2]; }
    s = num2 / Saa;
  }
  const rc = mv3(R, ca[0], ca[1], ca[2]);
  const t = [cb[0] - s * rc[0], cb[1] - s * rc[1], cb[2] - s * rc[2]];
  const M = { R, s, t };
  const o = [0, 0, 0];
  let ss = 0, max = 0;
  const residuals = all.map((p) => {
    applyP(M, p.a[0], p.a[1], p.a[2], o);
    const dx = o[0] - p.b[0], dy = o[1] - p.b[1], dz = o[2] - p.b[2], h = Math.hypot(dx, dy), d = Math.hypot(dx, dy, dz);
    if (p.use) { ss += d * d; if (d > max) max = d; }
    return { dx, dy, dz, h, v: dz, d, use: p.use };
  });
  return { R, s, t, mode: m, residuals, rms: Math.sqrt(ss / n), max, used: n };
}

// ── fitting to a CRS change ──────────────────────────────────────────────────
/** an n×n grid of points through a bbox ({ min, max }) at two heights (its floor and roof) */
export function crsSamplePoints(bb, n = 9) {
  const out = [];
  const zs = bb.max[2] > bb.min[2] ? [bb.min[2], bb.max[2]] : [bb.min[2]];
  for (const z of zs) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    out.push([bb.min[0] + ((bb.max[0] - bb.min[0]) * i) / (n - 1), bb.min[1] + ((bb.max[1] - bb.min[1]) * j) / (n - 1), z]);
  }
  return out;
}
/**
 * The best similarity for a horizontal reprojection (heights carried): fitted in plan (shift +
 * rotation about Z + scale), the height shift chosen so the layer's mid height stays put — a
 * uniform scale also stretches heights about it, and that is reported, not hidden.
 * from / to: matched point lists (to = the true reprojection of from). → { M, hMax, vMax, max, rms }
 * — deviations of the similarity from the true reprojection AT the given points.
 */
export function fitCrsChange(from, to) {
  const f = fitSimilarity(from.map((a, i) => ({ from: [a[0], a[1], 0], to: [to[i][0], to[i][1], 0] })), { mode: '2d' });
  let z0 = Infinity, z1 = -Infinity;
  for (const a of from) { if (a[2] < z0) z0 = a[2]; if (a[2] > z1) z1 = a[2]; }
  const zm = Number.isFinite(z0) ? (z0 + z1) / 2 : 0;
  const M = { R: f.R, s: f.s, t: [f.t[0], f.t[1], zm * (1 - f.s)] };
  const dev = deviations(M, from, to);
  return { M, ...dev, mode: '2d' };
}
export function deviations(M, from, to) {
  const o = [0, 0, 0];
  let hMax = 0, vMax = 0, max = 0, ss = 0;
  for (let i = 0; i < from.length; i++) {
    applyP(M, from[i][0], from[i][1], from[i][2], o);
    const dx = o[0] - to[i][0], dy = o[1] - to[i][1], dz = o[2] - (to[i][2] != null ? to[i][2] : from[i][2]);
    const h = Math.hypot(dx, dy), d = Math.hypot(h, dz);
    if (h > hMax) hMax = h; if (Math.abs(dz) > vMax) vMax = Math.abs(dz); if (d > max) max = d; ss += d * d;
  }
  return { hMax, vMax, max, rms: Math.sqrt(ss / Math.max(1, from.length)) };
}

// ── the stored form ──────────────────────────────────────────────────────────
const r9 = (v) => +(+v).toPrecision(15);
export function placementFromM(M, source = 'typed', extra = {}) {
  if (!M) return null;
  const a = anglesFromR(M.R);
  return { tx: r9(M.t[0]), ty: r9(M.t[1]), tz: r9(M.t[2]), omega: r9(a.omega), phi: r9(a.phi), kappa: r9(a.kappa), scale: r9(M.s), R: M.R.map(r9), source, ...extra };
}
export function placementFromFit(fit, source = 'gcp', extra = {}) {
  return placementFromM({ R: fit.R, s: fit.s, t: fit.t }, source, { mode: fit.mode, rms: fit.rms, maxResidual: fit.max, ...extra });
}
/** a residual against the user's tolerance: within → 'ok' (green), within 3× → 'warn' (amber), beyond → 'bad' (red) */
export function residualClass(v, tol = 0.05) {
  if (!Number.isFinite(v)) return 'none';
  const t = Math.max(1e-12, +tol || 0.05);
  return v <= t ? 'ok' : v <= 3 * t ? 'warn' : 'bad';
}
export const RESIDUAL_COLOR = { ok: 'var(--green, #3a3)', warn: 'var(--yellow, #c90)', bad: 'var(--red, #c33)', none: 'var(--muted, #888)' };
export function fmtLen(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a < 0.01 ? `${(v * 1000).toFixed(a < 0.001 ? 2 : 1)} mm` : a < 1 ? `${(v * 100).toFixed(1)} cm` : a < 1000 ? `${v.toFixed(3)} m` : `${(v / 1000).toFixed(3)} km`;
}
export function describePlacement(p) {
  if (!p) return 'not placed (the file\'s own coordinates)';
  const M = compilePlacement(p);
  if (!M) return 'identity (the file\'s own coordinates)';
  const a = anglesFromR(M.R), bits = [];
  bits.push(`shift ${[p.tx, p.ty, p.tz].map((v) => +(+v || 0).toFixed(3)).join(', ')}`);
  if (Math.abs(a.omega) > 1e-9 || Math.abs(a.phi) > 1e-9) bits.push(`ω ${+a.omega.toFixed(5)}° φ ${+a.phi.toFixed(5)}° κ ${+a.kappa.toFixed(5)}°`);
  else if (Math.abs(a.kappa) > 1e-9) bits.push(`κ ${+a.kappa.toFixed(5)}° about Z`);
  if (Math.abs(M.s - 1) > 1e-12) bits.push(`scale ${+M.s.toPrecision(9)}`);
  const by = p.source === 'gcp' ? `fitted to ${p.used || (p.pairs || []).filter((q) => q.use !== false).length} control points (${p.mode || '?'})`
    : p.source === 'crs-fit' ? `best-fit similarity ${p.fromCrsLabel ? `${p.fromCrsLabel} → ${p.toCrsLabel}` : 'for a CRS change'}`
    : p.source === 'datamine' ? 'Datamine origin' : 'typed';
  const res = Number.isFinite(p.maxResidual) ? ` · max ${p.source === 'crs-fit' ? 'deviation' : 'residual'} ${fmtLen(p.maxResidual)}` : '';
  return `${by} · ${bits.join(' · ')}${res}`;
}

// ── grids: the raster ↔ model affine, world files ──────────────────────────────
/**
 * A raster's affine (X = a·i + b·j + c, Y = d·i + e·j + f; (i, j) = pixel CORNER coordinates,
 * j down) → the grid's own frame + a placement: the grid keeps axis-aligned local nodes
 * (u = i·dx east, v = −j·dy north-up) and world = corner + Rz(θ)·(u, v). A shear (the two pixel
 * axes not at right angles) has no rigid form: the nearest rotation is used and its worst
 * departure over the raster is returned (dev, in model units) so it can be SHOWN, not refused.
 * nx, ny: the raster size (for that departure). → { dx, dy, theta (deg), corner: [c, f], shear (deg), dev }
 */
export function affineToGridPlace([a, b, c, d, e, f], nx = 1, ny = 1) {
  const dx = Math.hypot(a, d), dy = Math.hypot(b, e);
  const thI = Math.atan2(d, a);                                // the i axis
  const thJ = Math.atan2(b, -e);                               // the −j axis (north-up v = (−sin θ, cos θ)), the same θ when rigid
  let dth = thJ - thI; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
  const th = thI + dth / 2;                                    // split the shear evenly between the axes
  const ct = Math.cos(th), st = Math.sin(th);
  let dev = 0;
  for (const [i, j] of [[0, 0], [nx, 0], [0, ny], [nx, ny]]) {
    const X = a * i + b * j + c, Y = d * i + e * j + f;
    const u = i * dx, v = -j * dy;
    dev = Math.max(dev, Math.hypot(c + ct * u - st * v - X, f + st * u + ct * v - Y));
  }
  return { dx, dy, theta: th / D2R, corner: [c, f], shear: dth / D2R, dev };
}
/** a world file (.tfw / .jgw / .pgw / .wld): six lines A D B E C F, at the CENTRE of the top-left pixel → the corner affine */
export function parseWorldFile(text) {
  const v = String(text).split(/\s+/).filter(Boolean).slice(0, 6).map(Number);
  if (v.length < 6 || !v.every(Number.isFinite)) throw new Error('a world file has six numbers (A D B E C F)');
  const [A, D, B, E, C, F] = v;
  // X = A·col + B·row + C at pixel centres → at corners (i = col + ½, j = row + ½): c = C − (A + B)/2
  return [A, B, C - (A + B) / 2, D, E, F - (D + E) / 2];
}
/** a grid's world file text — the top-left pixel centre and its axes, rotation terms included */
export function worldFileText(grid) {
  const pl = grid.place || null;                        // a grid carries its placement COMPILED ({ R, s, t })
  const o = applyP(pl, grid.x0, grid.y0, 0, [0, 0, 0]);
  const ex = pl ? mv3(pl.R, grid.dx * pl.s, 0, 0) : [grid.dx, 0, 0];
  const ey = pl ? mv3(pl.R, 0, -grid.dy * pl.s, 0) : [0, -grid.dy, 0];
  const f = (x) => (+x.toPrecision(15)).toString();
  return [ex[0], ex[1], ey[0], ey[1], o[0], o[1]].map(f).join('\n') + '\n';
}
/** the grid's raster affine (corner form) — what a GeoTIFF ModelTransformation carries */
export function gridAffine(grid) {
  const pl = grid.place || null;                        // a grid carries its placement COMPILED ({ R, s, t })
  const corner = applyP(pl, grid.x0 - grid.dx / 2, grid.y0 + grid.dy / 2, 0, [0, 0, 0]);
  const ex = pl ? mv3(pl.R, grid.dx * pl.s, 0, 0) : [grid.dx, 0, 0];
  const ey = pl ? mv3(pl.R, 0, -grid.dy * pl.s, 0) : [0, -grid.dy, 0];
  return [ex[0], ey[0], corner[0], ex[1], ey[1], corner[1]];
}
