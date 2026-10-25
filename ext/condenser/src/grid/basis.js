// @gcu/condenser — ROTATED lattices (the grid layer; micro-rotated-models spec §2–§3).
//
// One internal representation: the rotation R, a 3×3 matrix stored COLUMN-MAJOR
// as 9 numbers whose columns are the unit U / V / W lattice directions, plus an
// ANCHOR — the world position of block (0,0,0)'s centroid. Angles exist only at
// the borders (a producer converts its own convention once and hands over
// vectors; `source` keeps the raw angles for provenance).
//
// A rotated grid is an axis-aligned grid in LATTICE coordinates q = Rᵀ·(p − anchor):
//   header.grid = { x, y, z: { origin, pitch, count } in q-space, rot: R, anchor }
// with origin the q-space centroid of block (0,0,0) (0 when anchored there, the
// canonical form). World centroid of block (i,j,k) = anchor + R·(origin + ijk·pitch).
//
// Why an anchor and not "rotate about the world origin": a model sits at UTM
// magnitudes (~7×10⁶ m), so a direction error of 10⁻⁵ rad — what rounded export
// centroids give you — would move block 0 by 70 m. About an anchor at the model,
// the same error moves things by fractions of a millimetre.
//
// So the whole lattice machinery (inferAxis, gridsCompatible, commonLattice, the
// resampler) runs verbatim on lattice coordinates for two models that share a
// basis, once both are expressed about ONE anchor (inFrameOf).
//
// Only rotations are representable: U/V/W must be mutually orthogonal (a
// sheared lattice is refused, not approximated).

import { inferAxis } from './infer.js';

const ORTHO_TOL = 2e-3;                                    // |cos| between generators
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** a world offset d → lattice coords: Rᵀ·d */
export function toLattice(R, x, y, z) {
  return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
}
/** lattice coords → a world offset: R·q */
export function fromLattice(R, u, v, w) {
  return [R[0] * u + R[3] * v + R[6] * w, R[1] * u + R[4] * v + R[7] * w, R[2] * u + R[5] * v + R[8] * w];
}
export function isAxisAligned(R, tol = 1e-9) {
  if (!R) return true;
  return Math.abs(R[0] - 1) < tol && Math.abs(R[4] - 1) < tol && Math.abs(R[8] - 1) < tol;
}
/**
 * two bases are the same lattice orientation (null ≡ identity). The tolerance
 * (≈0.006°) absorbs two INDEPENDENT fits of one lattice from rounded export
 * centroids (they agree to ~10⁻⁵); over a 2 km model it is 20 cm, a fiftieth of
 * a 10 m block — well inside the snap the resampler does.
 */
export function sameBasis(A, B, tol = 1e-4) {
  const a = A || I3, b = B || I3;
  for (let i = 0; i < 9; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return true;
}
/** a grid's world → lattice map: (x,y,z) → q, for a grid { rot, anchor } (identity when axis-aligned) */
export function latticeMapOf(grid) {
  const R = grid && grid.rot, A = (grid && grid.anchor) || [0, 0, 0];
  if (!R) return (x, y, z) => [x, y, z];
  return (x, y, z) => toLattice(R, x - A[0], y - A[1], z - A[2]);
}
/** a grid's lattice → world map (inverse of latticeMapOf) */
export function worldMapOf(grid) {
  const R = grid && grid.rot, A = (grid && grid.anchor) || [0, 0, 0];
  if (!R) return (u, v, w) => [u, v, w];
  return (u, v, w) => { const d = fromLattice(R, u, v, w); return [A[0] + d[0], A[1] + d[1], A[2] + d[2]]; };
}
/**
 * Re-express grid G's axes about REF's anchor (same basis required), so the
 * axis-wise lattice machinery can compare / resample them. Axis-aligned grids
 * come back unchanged.
 */
export function inFrameOf(G, ref) {
  if (!G.rot && !(ref && ref.rot)) return G;
  if (!sameBasis(G.rot, ref.rot)) throw new Error('inFrameOf: grids do not share a basis');
  const d = toLattice(G.rot, G.anchor[0] - ref.anchor[0], G.anchor[1] - ref.anchor[1], G.anchor[2] - ref.anchor[2]);
  return {
    x: { ...G.x, origin: G.x.origin + d[0] }, y: { ...G.y, origin: G.y.origin + d[1] }, z: { ...G.z, origin: G.z.origin + d[2] },
    rot: ref.rot, anchor: ref.anchor,
  };
}

/**
 * U/V/W world generators (pitch × direction) → { rot, pitch: [|U|,|V|,|W|] }.
 * Throws on a non-orthogonal (sheared) or degenerate basis.
 */
export function basisFromVectors(U, V, W) {
  const G = [U, V, W].map((g) => g.map(Number));
  const L = G.map(len);
  if (!L.every((l) => l > 0 && Number.isFinite(l))) throw new Error('lattice basis: U, V and W must be non-zero vectors');
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const c = dot(G[a], G[b]) / (L[a] * L[b]);
    if (Math.abs(c) > ORTHO_TOL) throw new Error(`lattice basis: ${'UVW'[a]} and ${'UVW'[b]} are not perpendicular (cos ${c.toFixed(4)}) — only rotated lattices are supported, not sheared ones`);
  }
  const d = G.map(unit);
  return { rot: [...d[0], ...d[1], ...d[2]], pitch: L };
}

/** compass facts for display/lineage: azimuth of V (clockwise from north), tilt of W from vertical, all degrees */
export function basisAngles(R) {
  const V = [R[3], R[4], R[5]], W = [R[6], R[7], R[8]];
  let az = Math.atan2(V[0], V[1]) * 180 / Math.PI; if (az < 0) az += 360;
  const tilt = Math.acos(Math.max(-1, Math.min(1, W[2]))) * 180 / Math.PI;
  return { azimuth: az, tilt, zOnly: tilt < 1e-3 };
}

/**
 * Recover the lattice DIRECTIONS from centroids alone (spec §3): nearest-
 * neighbour displacement vectors cluster on the generators. `pts` = a flat
 * Float64Array [x,y,z, …] — a reservoir (e.g. the first rows of a file, which
 * an export writes in lattice order, so they are neighbours). Returns
 * { rot, minStep } with columns ordered/signed to sit closest to E / N / Up, or
 * null (irregular, sheared, too few points, or simply axis-aligned). Pitches
 * and the precise directions come from fitLattice over all records.
 */
export function inferLatticeBasis(pts, { samples = 300, k = 6 } = {}) {
  const n = Math.floor(pts.length / 3);
  if (n < 8) return null;
  const S = Math.min(samples, n), step = n / S;
  const disp = [];
  const bestD = new Float64Array(k), bestI = new Int32Array(k);
  for (let s = 0; s < S; s++) {
    const i = Math.floor(s * step);
    const xi = pts[i * 3], yi = pts[i * 3 + 1], zi = pts[i * 3 + 2];
    bestD.fill(Infinity); bestI.fill(-1);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pts[j * 3] - xi, dy = pts[j * 3 + 1] - yi, dz = pts[j * 3 + 2] - zi;
      const d = dx * dx + dy * dy + dz * dz;
      if (!(d > 0) || d >= bestD[k - 1]) continue;
      let m = k - 1;
      while (m > 0 && bestD[m - 1] > d) { bestD[m] = bestD[m - 1]; bestI[m] = bestI[m - 1]; m--; }
      bestD[m] = d; bestI[m] = j;
    }
    for (let m = 0; m < k; m++) {
      const j = bestI[m]; if (j < 0) continue;
      let v = [pts[j * 3] - xi, pts[j * 3 + 1] - yi, pts[j * 3 + 2] - zi];
      // one hemisphere: ±v are the same generator
      const a = Math.abs(v[0]) >= Math.abs(v[1]) && Math.abs(v[0]) >= Math.abs(v[2]) ? 0 : Math.abs(v[1]) >= Math.abs(v[2]) ? 1 : 2;
      if (v[a] < 0) v = [-v[0], -v[1], -v[2]];
      disp.push(v);
    }
  }
  // greedy clustering (relative tolerance — exports round their centroids)
  const clusters = [];
  for (const v of disp) {
    const l = len(v);
    let hit = null;
    for (const c of clusters) { const dd = Math.hypot(v[0] - c.v[0], v[1] - c.v[1], v[2] - c.v[2]); if (dd < 2e-3 * Math.max(l, c.l)) { hit = c; break; } }
    if (hit) { hit.n++; hit.s[0] += v[0]; hit.s[1] += v[1]; hit.s[2] += v[2]; }
    else clusters.push({ v, l, n: 1, s: [...v] });
  }
  const minN = Math.max(3, Math.round(S * 0.05));
  const cand = clusters.filter((c) => c.n >= minN).map((c) => { const m = [c.s[0] / c.n, c.s[1] / c.n, c.s[2] / c.n]; return { v: m, l: len(m), n: c.n }; }).sort((a, b) => a.l - b.l);
  if (cand.length < 2) return null;
  const g1 = cand[0];
  const g2 = cand.find((c) => c !== g1 && Math.abs(dot(c.v, g1.v)) / (c.l * g1.l) < ORTHO_TOL);
  if (!g2) return null;
  const d1 = unit(g1.v), d2 = unit(g2.v), d3 = unit(cross(d1, d2));
  const R = orientNearWorld([d1, d2, d3]);
  if (isAxisAligned(R, 1e-6)) return null;                 // axis-aligned: not this path's call
  return { rot: R, minStep: g1.l };
}
// order + sign three orthonormal directions to sit closest to world E / N / Up,
// right-handed (a rotation, not a reflection)
function orientNearWorld(dirs) {
  const cols = [null, null, null], used = new Set(), pairs = [];
  for (let di = 0; di < 3; di++) for (let a = 0; a < 3; a++) pairs.push({ di, a, w: Math.abs(dirs[di][a]) });
  pairs.sort((p, q) => q.w - p.w || p.di - q.di || p.a - q.a);
  for (const p of pairs) { if (cols[p.a] || used.has(p.di)) continue; const d = dirs[p.di]; cols[p.a] = d[p.a] < 0 ? [-d[0], -d[1], -d[2]] : d; used.add(p.di); }
  if (dot(cols[0], cross(cols[1], cols[2])) < 0) cols[2] = cols[2].map((c) => -c);
  return [...cols[0], ...cols[1], ...cols[2]];
}

// distinct lattice coordinates on one axis, robust to rounding jitter: values
// are bucketed by a quantum τ (key = round(v/τ), holding the SUM and COUNT of
// the real values), then buckets closer than 3τ merge — so 12.5004 and 12.4996
// are one lattice plane, and its centre is the mean of the real values
function clusterBuckets(buckets) {
  const keys = [...buckets.keys()].sort((a, b) => a - b), out = [];
  let sum = 0, n = 0, prev = null;
  for (const k of keys) {
    if (prev !== null && k - prev >= 3) { out.push(sum / n); sum = 0; n = 0; }
    const b = buckets.get(k); sum += b[0]; n += b[1]; prev = k;
  }
  if (n) out.push(sum / n);
  return out;
}

/**
 * Measure a rotated lattice from ALL records: two coordinate sweeps.
 *   1. bucket the lattice coordinates (about a provisional anchor) → per-axis
 *      lattice planes → pitch / count (inferAxis on the plane centres);
 *   2. least-squares the generators from every record's (i,j,k) — refining the
 *      directions the reservoir guessed — and count records off the lattice.
 * `sweep()` returns a FRESH async iterable of { x, y, z, count } each call.
 * `minStep` = the smallest generator length (the jitter quantum is 1/1000 of it).
 * → { grid: { x, y, z (origins 0), rot, anchor }, misfits } or null.
 */
export async function fitLattice(R0, sweep, { minStep, cap = 300000, tol = 0.05 } = {}) {
  if (!(minStep > 0)) throw new Error('fitLattice: minStep required');
  const tau = minStep * 1e-3;
  let R = R0, A = null;
  // ── pass 1: planes per axis ──
  const sets = [new Map(), new Map(), new Map()];
  let n = 0;
  for await (const b of sweep()) {
    for (let i = 0; i < b.count; i++) {
      const x = +b.x[i], y = +b.y[i], z = +b.z[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!A) A = [x, y, z];
      const q = toLattice(R, x - A[0], y - A[1], z - A[2]);
      n++;
      for (let a = 0; a < 3; a++) { const key = Math.round(q[a] / tau), e = sets[a].get(key); if (e) { e[0] += q[a]; e[1]++; } else sets[a].set(key, [q[a], 1]); }
    }
    if (sets[0].size > cap || sets[1].size > cap || sets[2].size > cap) return null;
  }
  if (!n) return null;
  const axes = [0, 1, 2].map((a) => inferAxis(clusterBuckets(sets[a]), { rel: 0 }));
  if (!axes.every(Boolean)) return null;
  // ── pass 2: least squares p − A0 = i·U + j·V + k·W (+ a residual offset), and the misfit count ──
  const o = axes.map((g) => g.origin), pit = axes.map((g) => g.pitch || 1);
  const M = new Float64Array(16), B = new Float64Array(12);  // normal equations over [i, j, k, 1]
  for await (const b of sweep()) {
    for (let r = 0; r < b.count; r++) {
      const x = +b.x[r], y = +b.y[r], z = +b.z[r];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const d = [x - A[0], y - A[1], z - A[2]], q = toLattice(R, d[0], d[1], d[2]);
      const f = [0, 1, 2].map((a) => Math.round((q[a] - o[a]) / pit[a])).concat(1);
      for (let u = 0; u < 4; u++) { for (let v = 0; v < 4; v++) M[u * 4 + v] += f[u] * f[v]; for (let c = 0; c < 3; c++) B[u * 3 + c] += f[u] * d[c]; }
    }
  }
  const X = solve4(M, B);                                    // rows 0..2 = U, V, W (world); row 3 = block-0 offset from A
  if (X) {
    const G = [0, 1, 2].map((a) => (axes[a].count > 1 ? [X[a * 3], X[a * 3 + 1], X[a * 3 + 2]] : null));
    // a single-plane axis has no generator to fit — keep the reservoir's direction
    const dirs = G.map((g, a) => (g ? unit(g) : [R[a * 3], R[a * 3 + 1], R[a * 3 + 2]]));
    // re-orthonormalize (Gram–Schmidt in fitted order: longest-sampled first)
    const e0 = dirs[0], e1 = unit(dirs[1].map((v, c) => v - dot(dirs[1], e0) * e0[c])), e2 = cross(e0, e1);
    const R1 = [...e0, ...e1, ...(dot(e2, dirs[2]) < 0 ? e2.map((v) => -v) : e2)];
    if (dot([R1[0], R1[1], R1[2]], cross([R1[3], R1[4], R1[5]], [R1[6], R1[7], R1[8]])) > 0) R = R1;
    for (let a = 0; a < 3; a++) if (G[a]) axes[a] = { ...axes[a], pitch: snapPitch(len(G[a])) };
    A = [A[0] + X[9], A[1] + X[10], A[2] + X[11]];            // the anchor moves to block 0's fitted centroid
  }
  // ── the honest check: every record within tol·pitch of its lattice node ──
  let misfits = 0, worst = 0;
  const pit2 = axes.map((g) => g.pitch || 1);
  for await (const b of sweep()) {
    for (let r = 0; r < b.count; r++) {
      const x = +b.x[r], y = +b.y[r], z = +b.z[r];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const q = toLattice(R, x - A[0], y - A[1], z - A[2]);
      for (let a = 0; a < 3; a++) {
        const kf = q[a] / pit2[a], e = Math.abs(kf - Math.round(kf));
        if (e > worst) worst = e;
        if (e > tol || Math.round(kf) < 0 || Math.round(kf) >= axes[a].count) { misfits++; break; }
      }
    }
  }
  return {
    grid: { x: { origin: 0, pitch: axes[0].pitch, count: axes[0].count }, y: { origin: 0, pitch: axes[1].pitch, count: axes[1].count }, z: { origin: 0, pitch: axes[2].pitch, count: axes[2].count }, rot: R, anchor: A },
    misfits, worst,
  };
}
// A fitted pitch from rounded centroids is a MEASUREMENT of a block size that a
// person chose (10, 12.5, 3.125, 1.5625 m): 9.9998 and 10.00003 are both "10",
// and two models of one lattice must agree exactly for the join's common-
// lattice test. (Measured: a 4-block axis of mm-rounded centroids fits to
// ~2×10⁻⁵ relative.) Snap to the nearest SIMPLE size — 4 significant figures,
// or a multiple of 1/64 m — when within 3×10⁻⁵ of it; otherwise keep it.
function snapPitch(p) {
  if (!(p > 0)) return p;
  const step = 10 ** (Math.floor(Math.log10(p)) - 3);
  for (const s of [+(Math.round(p / step) * step).toPrecision(4), Math.round(p * 64) / 64]) if (s > 0 && Math.abs(s - p) < 3e-5 * p) return s;
  return p;
}
// solve the 4×4 symmetric system M·X = B (B has 3 columns), Gaussian elimination
// with partial pivoting; null when singular (e.g. an axis with one plane)
function solve4(M, B) {
  const a = Array.from({ length: 4 }, (_, r) => [M[r * 4], M[r * 4 + 1], M[r * 4 + 2], M[r * 4 + 3], B[r * 3], B[r * 3 + 1], B[r * 3 + 2]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) { a[c][c] = 1; for (let k = c + 1; k < 7; k++) a[c][k] = 0; continue; }   // singular column: leave it at zero
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 4; r++) { if (r === c) continue; const f = a[r][c] / a[c][c]; if (!f) continue; for (let k = c; k < 7; k++) a[r][k] -= f * a[c][k]; }
  }
  const X = new Float64Array(12);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) X[r * 3 + k] = a[r][4 + k] / a[r][r];
  return X;
}

/**
 * The honest check for ONE centroid against a declared rotated lattice. Returns
 * null when it sits on a node, else a reason string. `grid` = { x,y,z, rot, anchor }.
 */
export function latticeMisfit(grid, x, y, z, i, { tol = 1e-3 } = {}) {
  const q = latticeMapOf(grid)(+x, +y, +z);
  for (let a = 0; a < 3; a++) {
    const g = [grid.x, grid.y, grid.z][a];
    if (!(g.pitch > 0)) { if (Math.abs(q[a] - g.origin) > 1e-6) return `record ${i} is off the single ${'UVW'[a]} plane`; continue; }
    const kf = (q[a] - g.origin) / g.pitch, kr = Math.round(kf);
    if (Math.abs(kf - kr) > tol) return `record ${i} is off the lattice along ${'UVW'[a]} by ${Math.abs(kf - kr).toFixed(3)} blocks`;
    if (kr < 0 || kr >= g.count) return `record ${i} lies outside the lattice along ${'UVW'[a]} (index ${kr} of ${g.count})`;
  }
  return null;
}

/**
 * The detector a provider runs when centroids are NOT an axis-aligned grid:
 * reservoir → basis → a fit over every record. → { grid, angles, worst } or
 * null. The result is a CANDIDATE: nothing here applies it.
 */
export async function detectRotatedLattice(reservoir, sweep) {
  const b = inferLatticeBasis(reservoir);
  if (!b) return null;
  const fit = await fitLattice(b.rot, sweep, { minStep: b.minStep });
  if (!fit || fit.misfits) return null;
  return { grid: fit.grid, angles: basisAngles(fit.grid.rot), worst: fit.worst };
}

/**
 * A producer's basis form — { origin: [x,y,z] (block 0's CENTROID), U, V, W
 * (world vectors = pitch × direction), counts: [nu,nv,nw], source? } — into
 * the internal grid. An axis-aligned basis comes back as a plain per-axis
 * grid; a rotated one as { x,y,z (origins 0), rot, anchor: origin }.
 */
export function gridFromBasis(b) {
  const o = b.origin, c = b.counts || b.count;
  if (!o || o.length !== 3 || !c || c.length !== 3) throw new Error('lattice basis: needs origin [x,y,z], U, V, W and counts [nu,nv,nw]');
  const { rot, pitch } = basisFromVectors(b.U, b.V, b.W);
  const counts = c.map((v) => v | 0);
  if (!counts.every((v) => v >= 1)) throw new Error('lattice basis: counts must be ≥ 1');
  if (isAxisAligned(rot, 1e-9)) {
    return { x: { origin: +o[0], pitch: pitch[0], count: counts[0] }, y: { origin: +o[1], pitch: pitch[1], count: counts[1] }, z: { origin: +o[2], pitch: pitch[2], count: counts[2] } };
  }
  return { x: { origin: 0, pitch: pitch[0], count: counts[0] }, y: { origin: 0, pitch: pitch[1], count: counts[1] }, z: { origin: 0, pitch: pitch[2], count: counts[2] }, rot, anchor: o.map(Number), source: b.source || null };
}
/** the internal grid → the producer's basis form (what micro writes in micro:model) */
export function basisOfGrid(g) {
  const R = g.rot || I3;
  const origin = g.rot ? worldMapOf(g)(g.x.origin, g.y.origin, g.z.origin) : [g.x.origin, g.y.origin, g.z.origin];
  const P = [g.x.pitch, g.y.pitch, g.z.pitch];
  return { origin, U: [R[0] * P[0], R[1] * P[0], R[2] * P[0]], V: [R[3] * P[1], R[4] * P[1], R[5] * P[1]], W: [R[6] * P[2], R[7] * P[2], R[8] * P[2]], counts: [g.x.count, g.y.count, g.z.count], ...(g.source ? { source: g.source } : {}) };
}
