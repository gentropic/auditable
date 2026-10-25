// @gcu/condenser — grid inference (the grid layer): recover a regular lattice
// from what a provider's discovery sweep observed. Home of the axis inference
// today and the rotated-basis inference tomorrow (micro-rotated-models spec:
// cluster nearest-neighbour centroid displacements → U/V/W generators).

/**
 * Infer a regular grid from per-axis distinct centroid values (collected by a
 * provider's discovery sweep). Returns { origin (CENTROID of block 0 — i.e. the
 * first lattice value), pitch, count } per axis, or null when the axis isn't a
 * consistent lattice. `values` must be sorted ascending, deduped.
 */
export function inferAxis(values, { rel = 1e-6 } = {}) {
  if (!values.length) return null;
  if (values.length === 1) return { origin: values[0], pitch: 0, count: 1 };
  let pitch = Infinity;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0 && d < pitch) pitch = d;
  }
  if (!Number.isFinite(pitch) || pitch <= 0) return null;
  const span = values[values.length - 1] - values[0];
  const count = Math.round(span / pitch) + 1;
  if (count > 65535) return null;                          // beyond u16 IJK — not this path
  // tolerance: a thousandth of the pitch, widened by a magnitude-relative slack
  // for coordinates stored at float32-ish precision (≈0.6 m at a UTM easting) —
  // but NEVER past a tenth of the pitch. Uncapped, that slack is wider than the
  // blocks at UTM northings (7.8 m at 7.8×10⁶), so any scatter of values passed
  // as a "lattice": a ROTATED model's centroids read as an axis-aligned grid of
  // their min spacing and drew as wrong boxes.
  const eps = Math.max(pitch * 1e-3, Math.min(Math.abs(values[0]) * rel, pitch * 0.1));
  for (const v of values) {
    const k = Math.round((v - values[0]) / pitch);
    if (Math.abs(values[0] + k * pitch - v) > eps) return null;   // off-lattice → not regular
  }
  return { origin: values[0], pitch, count };
}

// ── sub-blocked models: a fine lattice + a size palette ──────────────────────
// A sub-blocked model carries per-block sizes (DX/DY/DZ, XINC…). Every provider
// (delimited, Datamine, Parquet) collects the same three things in its discovery
// sweep: per-axis distinct centroids, the smallest size per axis, and the
// distinct size triples (as dimKey strings). This turns them into the fine
// lattice (pitch = min size / 2, so every power-of-2 sub-block centre lands on
// it) and the half-size palette the box shader reads. null = no sub-block
// lattice: sizes don't vary, a centre is off the fine lattice (non-power-of-2
// splits), an axis overflows u16, or there are more than 256 distinct sizes
// (the per-block size code is a u8 — past that a code would be wrong, so the
// caller falls back to points rather than drawing some blocks the wrong size).

export const DIM_PALETTE_MAX = 256;
const r10 = (v) => Number(v.toPrecision(10));
/** The canonical key of one (dx, dy, dz) size triple — full sizes, not halves. */
export const dimKey = (dx, dy, dz) => `${r10(dx)},${r10(dy)},${r10(dz)}`;
/** size key → palette code, rebuilt from a persisted half-size palette. */
export function dimCodeFromPalette(dimPalette) {
  return new Map(dimPalette.map((h, i) => [dimKey(h[0] * 2, h[1] * 2, h[2] * 2), i]));
}

/**
 * @param axisValues [Set|Array ×3] distinct centroid values per axis (any order)
 * @param minDim     [dx, dy, dz] the smallest positive size seen per axis
 * @param dimKeys    Set of dimKey strings (collect at least DIM_PALETTE_MAX + 1 to detect overflow)
 * @returns { grid: {x,y,z}, dimPalette: [[hx,hy,hz]…], dimCode: Map } | null
 */
export function inferSubBlockLattice(axisValues, minDim, dimKeys, { cap = 300000 } = {}) {
  if (!(dimKeys.size > 1) || dimKeys.size > DIM_PALETTE_MAX || !minDim.every((d) => Number.isFinite(d) && d > 0)) return null;
  const axes = [0, 1, 2].map((a) => {
    const set = axisValues[a], n = set.size != null ? set.size : set.length;
    if (!n || n >= cap) return null;
    const vals = [...set].sort((u, v) => u - v);
    const origin = vals[0], pitch = minDim[a] / 2;
    const count = Math.round((vals[vals.length - 1] - origin) / pitch) + 1;
    if (count > 65535) return null;
    const eps = Math.max(pitch * 1e-3, Math.abs(origin) * 1e-6);
    for (const v of vals) if (Math.abs(origin + Math.round((v - origin) / pitch) * pitch - v) > eps) return null;
    return { origin, pitch, count };
  });
  if (!axes.every(Boolean)) return null;
  const dims = [...dimKeys].map((k) => k.split(',').map(Number));
  return {
    grid: { x: axes[0], y: axes[1], z: axes[2] },
    dimPalette: dims.map(([dx, dy, dz]) => [dx / 2, dy / 2, dz / 2]),
    dimCode: new Map(dims.map((d, i) => [dimKey(d[0], d[1], d[2]), i])),
  };
}
