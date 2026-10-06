// DXF colour resolution — kept UN-FLATTENED (SPEC-dxf §4).
//
// An ACI palette index, a BYLAYER / BYBLOCK reference, and a 24-bit true colour are
// DISTINCT and must not collapse into one RGB triple. Flattening ACI → RGB discards the
// layer-driven colour scheme mining/geology drawings rely on (the colour IS data). So
// the model preserves the mode; aciToRgb is a render-time convenience, never canonical.

const BYLAYER = 256, BYBLOCK = 0;

// Resolve raw colour group codes into the typed colour model. `aci` is group 62 (may be
// null/absent), `trueColor` is group 420 (24-bit packed RGB, may be null). True colour
// wins when present (that's the DXF precedence). A negative ACI marks a layer turned off.
export function resolveColor({ aci = null, trueColor = null } = {}) {
  if (trueColor != null) {
    return { mode: 'rgb', r: (trueColor >> 16) & 0xff, g: (trueColor >> 8) & 0xff, b: trueColor & 0xff };
  }
  if (aci == null || aci === BYLAYER) return { mode: 'bylayer' };
  if (aci === BYBLOCK) return { mode: 'byblock' };
  if (aci < 0) return { mode: 'aci', index: -aci, off: true };
  return { mode: 'aci', index: aci };
}

// Serialize the colour model back to the group-code pairs the writer emits, preserving
// the distinction (rgb → 420, byblock → 62/0, bylayer → 62/256, aci → 62/index).
export function colorToPairs(color) {
  if (!color) return [];
  switch (color.mode) {
    case 'rgb': return [{ code: 420, value: ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff) }];
    case 'byblock': return [{ code: 62, value: BYBLOCK }];
    case 'bylayer': return [{ code: 62, value: BYLAYER }];
    case 'aci': return [{ code: 62, value: color.off ? -color.index : color.index }];
    default: return [];
  }
}

// The FULL ACI ramp. 1–9 are the named colours; 10–249 follow the published
// derivation (24 hues 15° apart × 5 value levels × {saturated, half-saturated},
// decade-packed: hue = ((i−10)÷10)·15°, value level = (i−10)%10 >> 1 from
// [255,204,153,127,76], odd offsets halve the chroma); 250–255 are the gray
// ramp. Spot-checked against the canonical table (ACI 30 = FF7F00, 11 =
// FF7F7F, 250 = 333333). Index 7 is "foreground" — white here, a renderer on
// a light theme may substitute. The model keeps the index; this is the RGB view.
const ACI_NAMED = {
  1: [255, 0, 0], 2: [255, 255, 0], 3: [0, 255, 0], 4: [0, 255, 255],
  5: [0, 0, 255], 6: [255, 0, 255], 7: [255, 255, 255],
  8: [128, 128, 128], 9: [192, 192, 192],
};
const ACI_GRAYS = { 250: 51, 251: 91, 252: 132, 253: 173, 254: 214, 255: 255 };
const ACI_V = [255, 204, 153, 127, 76];

function hueRgb(h, hi, lo) {
  const sect = Math.floor(h / 60) % 6, f = h / 60 - Math.floor(h / 60);
  const up = Math.floor(lo + (hi - lo) * f), dn = Math.floor(hi - (hi - lo) * f);
  switch (sect) {
    case 0: return [hi, up, lo];
    case 1: return [dn, hi, lo];
    case 2: return [lo, hi, up];
    case 3: return [lo, dn, hi];
    case 4: return [up, lo, hi];
    default: return [hi, lo, dn];
  }
}

export function aciToRgb(index) {
  if (ACI_NAMED[index]) return ACI_NAMED[index];
  if (ACI_GRAYS[index] != null) { const v = ACI_GRAYS[index]; return [v, v, v]; }
  if (index >= 10 && index <= 249) {
    const k = index - 10;
    const hue = ((k / 10) | 0) * 15;
    const within = k % 10;
    const hi = ACI_V[within >> 1];
    const lo = (within & 1) ? Math.floor(hi / 2) : 0;
    return hueRgb(hue, hi, lo);
  }
  return null;
}

// Resolve a feature's colour model to RGB for rendering: rgb → itself, aci →
// the ramp, bylayer/byblock → the layer table's colour (byblock loses its
// insert context after explode — the layer is the honest stand-in).
export function colorToRgb(color, layerName, layers) {
  if (!color) return null;
  if (color.mode === 'rgb') return [color.r, color.g, color.b];
  if (color.mode === 'aci' && !color.off) return aciToRgb(color.index);
  if (color.mode === 'bylayer' || color.mode === 'byblock') {
    const lc = layers && layers[layerName] && layers[layerName].color;
    if (lc && lc.mode === 'aci' && !lc.off && lc.index != null) return aciToRgb(lc.index);
    if (lc && lc.mode === 'rgb') return [lc.r, lc.g, lc.b];
  }
  return null;
}
