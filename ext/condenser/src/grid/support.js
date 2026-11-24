// @gcu/condenser — the BLOCK-SUPPORT contract (micro-block-support spec §2).
//
// One description of a block model's support, filled by the readers and read by
// every consumer, so a new kind of model is a new reader rather than a dozen edits:
//
//   frame    { anchor (world, f64), R (3×3 column-major, world ← lattice) }
//            R = identity and anchor = 0 for an axis-aligned model.
//   lattice  { pitch [3] — the FINE step per axis, lattice frame,
//              originQ [3] — the centroid of fine cell (0,0,0), lattice coords,
//              count [3] }
//            regular model: pitch = the block size; sub-blocked: pitch = half the
//            finest size step per axis, so odd sizes still centre on-lattice.
//   extent   per-block size in FINE STEPS per axis:
//            regular     → the constant sizeQ (1,1,1) — 0 bytes per block;
//            sub-blocked → `dimQ`, u8 × 3 per block (any integer shape ≤ 255 steps).
//
// Derived, never stored: centre = anchor + R·(originQ + ijk·pitch); half = sizeQ·pitch/2
// (lattice frame); volume = Π sizeQ·pitch; world AABB half = |R|·half.
//
// COLUMNAR, not per-record: the contract is data (constants + typed arrays) plus a
// few pure helpers small enough to inline. No boxOf(record) returning an object —
// hot loops read the support once and do the arithmetic themselves.

export const SIZEQ_MAX = 255;                              // dimQ is u8 per axis
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The support of a header's grid. `grid` = { x, y, z: { origin, pitch, count },
 * rot?, anchor? } (grid/basis.js form); subBlocked = the model carries per-block
 * dimQ. → { frame, lattice, sub, sizeQ, sizeQMax } or null without a grid.
 */
export function supportOf(grid, { subBlocked = false, sizeQMax = null } = {}) {
  if (!grid || !grid.x) return null;
  const rotated = !!grid.rot;
  return {
    frame: { anchor: rotated ? [...(grid.anchor || [0, 0, 0])] : [0, 0, 0], R: rotated ? Array.from(grid.rot) : I3.slice(), rotated },
    lattice: {
      pitch: [grid.x.pitch, grid.y.pitch, grid.z.pitch],
      originQ: [grid.x.origin, grid.y.origin, grid.z.origin],
      count: [grid.x.count, grid.y.count, grid.z.count],
    },
    sub: !!subBlocked,
    sizeQ: subBlocked ? null : [1, 1, 1],                  // regular: one constant, no array
    sizeQMax: subBlocked ? (sizeQMax ? [...sizeQMax] : null) : [1, 1, 1],
  };
}
/** A header's support (grid + the sub-block facts it carries). */
export const supportOfHeader = (h) => (h ? supportOf(h.grid, { subBlocked: !!h.subBlocked, sizeQMax: h.sizeQMax || null }) : null);

/** Volume of a block of sizeQ (sx, sy, sz) fine steps. */
export const volumeOf = (sx, sy, sz, pitch) => sx * pitch[0] * sy * pitch[1] * sz * pitch[2];

/** world → lattice: q = Rᵀ·(p − anchor). out is written and returned. */
export function toLattice(frame, x, y, z, out = [0, 0, 0]) {
  const R = frame.R, A = frame.anchor;
  const dx = x - A[0], dy = y - A[1], dz = z - A[2];
  out[0] = R[0] * dx + R[1] * dy + R[2] * dz;
  out[1] = R[3] * dx + R[4] * dy + R[5] * dz;
  out[2] = R[6] * dx + R[7] * dy + R[8] * dz;
  return out;
}
/** lattice → world: p = anchor + R·q. */
export function toWorld(frame, u, v, w, out = [0, 0, 0]) {
  const R = frame.R, A = frame.anchor;
  out[0] = A[0] + R[0] * u + R[3] * v + R[6] * w;
  out[1] = A[1] + R[1] * u + R[4] * v + R[7] * w;
  out[2] = A[2] + R[2] * u + R[5] * v + R[8] * w;
  return out;
}
/** The world-axis half extent of a lattice-frame half box: |R|·h. */
export function worldHalfExtent(R, hx, hy, hz, out = [0, 0, 0]) {
  out[0] = Math.abs(R[0]) * hx + Math.abs(R[3]) * hy + Math.abs(R[6]) * hz;
  out[1] = Math.abs(R[1]) * hx + Math.abs(R[4]) * hy + Math.abs(R[7]) * hz;
  out[2] = Math.abs(R[2]) * hx + Math.abs(R[5]) * hy + Math.abs(R[8]) * hz;
  return out;
}
/** World centroid of fine cell (i, j, k). */
export function centreOf(sup, i, j, k, out = [0, 0, 0]) {
  const L = sup.lattice;
  return toWorld(sup.frame, L.originQ[0] + i * L.pitch[0], L.originQ[1] + j * L.pitch[1], L.originQ[2] + k * L.pitch[2], out);
}

/**
 * Do two supports share a lattice — the same orientation and pitch, and nodes that
 * coincide (their origins differ by whole fine steps once expressed about one anchor)?
 */
export function sameLattice(a, b, tol = 1e-6) {
  if (!a || !b) return false;
  for (let i = 0; i < 9; i++) if (Math.abs(a.frame.R[i] - b.frame.R[i]) > 1e-4) return false;
  const pa = a.lattice.pitch, pb = b.lattice.pitch;
  for (let i = 0; i < 3; i++) if (Math.abs(pa[i] - pb[i]) > tol * Math.max(1, Math.abs(pa[i]))) return false;
  // b's node 0 in a's lattice coordinates
  const w = toWorld(b.frame, b.lattice.originQ[0], b.lattice.originQ[1], b.lattice.originQ[2]);
  const q = toLattice(a.frame, w[0], w[1], w[2]);
  for (let i = 0; i < 3; i++) {
    const s = (q[i] - a.lattice.originQ[i]) / pa[i];
    if (Math.abs(s - Math.round(s)) > 1e-3) return false;
  }
  return true;
}

// ── sub-block sizes ───────────────────────────────────────────────────────────
// Discovery collects per-axis DISTINCT sizes (a few dozen on any real model, however
// many shapes they combine into — the Isatis file has 3,288 shapes from ~20 sizes
// per axis), the per-axis min/max, and a capped count of distinct shapes for the
// description. Mergeable, so a parallel discovery (row groups on workers) merges.

const r10 = (v) => Number(v.toPrecision(10));
const r7 = (v) => Number(v.toPrecision(7));
const SIZES_CAP = 4096, SHAPES_CAP = 1 << 16;
export function sizeCollector() {
  const axes = [new Set(), new Set(), new Set()];          // distinct sizes per axis (10 significant digits)
  // a size's index = its 7-digit value's (so float noise in a file's sizes — 0.9999999963 vs
  // 0.9999999935, f32 round trips — is one size, one shape); raw → index is memoized, the memo bounded apart from the cap
  const idx = [new Map(), new Map(), new Map()], memo = [new Map(), new Map(), new Map()], raw = [[], [], []];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const shapes = new Set();                                // i·2²⁴ + j·2¹² + k over the size indices — no string per block
  let overflow = false, any = 0;
  const ixOf = (a, v) => {
    let i = memo[a].get(v);
    if (i !== undefined) return i;
    if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v;
    const k = r7(v);
    i = idx[a].get(k);
    if (i === undefined) {
      if (raw[a].length >= SIZES_CAP) { overflow = true; return 0; }
      i = raw[a].length; raw[a].push(v); idx[a].set(k, i); axes[a].add(r10(v));
    }
    if (memo[a].size < 65536) memo[a].set(v, i);
    return i;
  };
  return {
    axes, min, max,
    get overflow() { return overflow; },
    get count() { return any; },
    get shapes() { return shapes.size; },
    /** one block's (dx, dy, dz) — non-positive sizes are ignored */
    add(dx, dy, dz) {
      if (!(dx > 0 && dy > 0 && dz > 0)) return;
      any++;
      const key = ixOf(0, dx) * 16777216 + ixOf(1, dy) * 4096 + ixOf(2, dz);
      if (shapes.size < SHAPES_CAP) shapes.add(key);
    },
    /** a partial collector's snapshot (toJSON form) merged in */
    merge(s) {
      if (!s) return;
      for (const [dx, dy, dz] of s.shapes) this.add(dx, dy, dz);
      any += (s.count || 0) - s.shapes.length;
      for (let a = 0; a < 3; a++) for (const v of s.raw[a]) ixOf(a, v);   // sizes past the shape cap still count
      if (s.overflow) overflow = true;
    },
    /** a structured-cloneable snapshot (a worker's partial) */
    toJSON() {
      const sh = [];
      for (const key of shapes) sh.push([raw[0][Math.floor(key / 16777216)], raw[1][Math.floor(key / 4096) % 4096], raw[2][key % 4096]]);
      return { raw: raw.map((r) => [...r]), shapes: sh, overflow, count: any };
    },
    /** do sizes vary at all? (one shape = a regular model in disguise) */
    get varies() { return axes.some((x) => x.size > 1); },
  };
}

// the GCD of positive reals, tolerant of float noise; NaN when there's none
function realGcd(vals) {
  const big = Math.max(...vals), tol = big * 1e-7;
  let g = vals[0];
  for (let k = 1; k < vals.length; k++) {
    let a = Math.max(g, vals[k]), b = Math.min(g, vals[k]), it = 0;
    while (b > tol && it++ < 200) { let r = a % b; if (b - r < tol) r = 0; a = b; b = r; }
    g = a;
  }
  for (const v of vals) { const s = v / g; if (Math.abs(s - Math.round(s)) > 1e-4) return NaN; }
  return g;
}
/**
 * The fine pitch per axis for a collector's sizes: half the GCD of the distinct
 * sizes, so every integer combination of them centres on-lattice (when the smallest
 * divides the rest — the common case — that is half the smallest, as before).
 * → { pitch: [3], sizeQMax: [3] } | { refused: message } | null (no usable sizes).
 */
export function finePitch(sizes) {
  if (!sizes || !sizes.count || sizes.overflow) return null;
  const pitch = [0, 0, 0], sizeQMax = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const vals = [...sizes.axes[a]];
    if (!vals.length) return null;
    const g = realGcd(vals);
    if (!(g > 0)) return null;
    pitch[a] = g / 2;
    sizeQMax[a] = Math.round(sizes.max[a] / pitch[a]);
    if (sizeQMax[a] > SIZEQ_MAX) {
      const ax = 'XYZ'[a];
      return { refused: `sub-block sizes along ${ax} run from ${r10(sizes.min[a])} to ${r10(sizes.max[a])} on a ${r10(g)} step — ${sizeQMax[a]} fine steps, past the ${SIZEQ_MAX} a block can span (largest more than ${Math.floor(SIZEQ_MAX / 2)}× the step). Shown as points.` };
    }
  }
  return { pitch, sizeQMax };
}
/** One block's size in fine steps along an axis (clamped to 1..255). */
export const sizeQ = (d, pitch) => { const q = Math.round(d / pitch); return q < 1 ? 1 : q > SIZEQ_MAX ? SIZEQ_MAX : q; };
/** Write one block's dimQ triple at k into a Uint8Array(3n). */
export function putDimQ(out, k, dx, dy, dz, pitch) {
  out[k * 3] = sizeQ(dx, pitch[0]); out[k * 3 + 1] = sizeQ(dy, pitch[1]); out[k * 3 + 2] = sizeQ(dz, pitch[2]);
}
/** A header's fine pitch (the grid's per-axis pitch — for a sub-blocked model the fine step). */
export const pitchOf = (grid) => [grid.x.pitch, grid.y.pitch, grid.z.pitch];

// ── Datamine rotation ─────────────────────────────────────────────────────────
/**
 * R for a single Datamine rotation about Z (ROTAXIS1 = 3): ANGLE1 turns the model
 * axes CLOCKWISE seen from above, i.e. R rotates by −ANGLE1 in the math (CCW) sense.
 * world = O + R·(XC, YC, ZC). ANGLE1 = −50 → model X at N40°E. Column-major.
 * Verified on a real Isatis.neo export to 1 cm (memory: reference_datamine_rotation).
 */
export function datamineRotZ(angle1Deg) {
  const t = (-angle1Deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
/**
 * A rotated .dm placed in world keeps LOCAL XC/YC/ZC in its records; anything that
 * reads a position from a record (a pick's position, a filter's compact chunks)
 * maps it here. → (x, y, z) → [wx, wy, wz] for such a header, else null.
 */
export function dmLocalToWorld(h) {
  if (!h || !h.dmRotationApplied) return null;
  const O = h.dmOrigin || [0, 0, 0], R = h.grid && h.grid.rot ? h.grid.rot : datamineRotZ(h.dmRotation[0].angle);
  return (x, y, z) => [O[0] + R[0] * x + R[3] * y + R[6] * z, O[1] + R[1] * x + R[4] * y + R[7] * z, O[2] + R[2] * x + R[5] * y + R[8] * z];
}
