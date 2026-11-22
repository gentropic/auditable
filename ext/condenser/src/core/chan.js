// @gcu/condenser — the per-element VALUE code in a chunk (u16, normalized on the GPU).
// Code 0 is BLANK (a missing value); 1..65535 span the chunk's [min, max]. The reserved code
// is what lets a shader tell a missing value from the lowest one — before it, a blank FE drew
// in the bottom grade class, indistinguishable from real low grade. The builders write it
// (blocks.js, sticks.js); every reader dequantizes with chanDequant's two numbers as
// x + aChan·y — code 1 lands on min and 65535 on max, so the shader formula is unchanged —
// and calls a value blank when aChan < CHAN_BLANK_T. With no-data off, a blank decodes just
// under min and clamps to the lowest colour: exactly the old picture.
export const CHAN_BLANK_T = 0.5 / 65535;
export function chanScale(lo, hi) { return hi > lo ? 65534 / (hi - lo) : 0; }
export function chanCode(v, lo, scale) { return Number.isFinite(v) ? 1 + (((v - lo) * scale + 0.5) | 0) : 0; }
export function chanDequant(range) {
  const lo = range[0], span = range[1] - range[0];
  return span > 0 ? [lo - span / 65534, (span * 65535) / 65534] : [lo, 0];
}
