// @gcu/condenser — grid inference (the grid layer): recover a regular lattice
// from what a provider's discovery sweep observed. Home of the axis inference
// today and the rotated-basis inference tomorrow (micro-rotated-models spec:
// cluster nearest-neighbour centroid displacements → U/V/W generators).

import { finePitch } from './support.js';

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

// ── sub-blocked models: a fine lattice + per-block sizes in fine steps ───────
// A sub-blocked model carries per-block sizes (DX/DY/DZ, XINC…). Every provider
// (delimited, Datamine, Parquet) collects the same things in its discovery sweep:
// per-axis distinct centroids and a size collector (grid/support.js). This turns
// them into the FINE lattice (pitch = half the size step per axis, so any integer
// combination of sizes centres on it — odd ones included) that per-block dimQ
// (u8 × 3, fine steps) is measured on. No palette, no shape cap: 3,288 shapes are
// as cheap as 2. null = no sub-block lattice (sizes don't vary, a centre is off
// the fine lattice, an axis overflows u16); { refused } = a block spans more than
// 255 fine steps (the caller says so, and shows points).


const r10 = (v) => Number(v.toPrecision(10));
/**
 * One axis's distinct centroids, rounded to 10 significant digits. `add(v)` gives
 * exactly `if (set.size < cap) set.add(r10(v))`, but rounds each distinct RAW value
 * once: r10 goes through a string, and per value it was 60 s of a 60M-block open.
 * A block model repeats a few hundred values per axis, so almost every add is a
 * Set hit. The raw memo is bounded; past it, values are rounded as they come.
 */
export function axisDistinct(cap) {
  const set = new Set(), seen = new Set(), RAW = cap * 4;
  let last = NaN;
  return {
    set,
    add(v) {
      if (v === last || set.size >= cap) return;
      last = v;
      if (seen.size < RAW) { if (seen.has(v)) return; seen.add(v); }
      set.add(r10(v));
    },
  };
}

/**
 * @param axisValues [Set|Array ×3] distinct centroid values per axis (any order)
 * @param sizes      a sizeCollector (grid/support.js) fed every block's (dx, dy, dz)
 * @returns { grid: {x,y,z} (the FINE lattice), sizeQMax: [3], shapes } | { refused: message } | null
 */
export function inferSubBlockLattice(axisValues, sizes, { cap = 300000 } = {}) {
  if (!sizes || !sizes.varies) return null;
  const fp = finePitch(sizes);
  if (!fp) return null;
  if (fp.refused) return fp;
  const axes = [0, 1, 2].map((a) => {
    const set = axisValues[a], n = set.size != null ? set.size : set.length;
    if (!n || n >= cap) return null;
    const vals = [...set].sort((u, v) => u - v);
    const origin = vals[0], pitch = fp.pitch[a];
    const count = Math.round((vals[vals.length - 1] - origin) / pitch) + 1;
    if (count > 65535) return null;
    // relative slack for float noise at big magnitudes, but never past a tenth of the pitch:
    // |origin|·1e-6 is ~7 m at a UTM northing, which would swallow a whole 2 m sub-block
    const eps = Math.min(pitch / 10, Math.max(pitch * 1e-3, Math.abs(origin) * 1e-6));
    for (const v of vals) if (Math.abs(origin + Math.round((v - origin) / pitch) * pitch - v) > eps) return null;
    return { origin, pitch, count };
  });
  if (!axes.every(Boolean)) return null;
  return { grid: { x: axes[0], y: axes[1], z: axes[2] }, sizeQMax: fp.sizeQMax, shapes: sizes.shapes };
}
