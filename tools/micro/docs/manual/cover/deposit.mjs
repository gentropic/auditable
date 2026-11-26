// An imagined deposit for micro's cover (and, later, its demo project): an implicit geological model —
// every point of the box answers "which rock, what grade". Pure functions, seeded, no state.
//
// The story, oldest first:
//   1. a shelf sequence on a gneiss basement — quartzite, banded iron formation (the ore host), marble,
//      phyllite, metavolcanics;
//   2. folded into an upright antiform whose axis trends 040° and plunges 11° NE, its axial plane inclined
//      (vergence to the SE);
//   3. cut by a normal fault (strike 120°, dip 65° SW, 70 m throw) — the hanging wall dropped;
//   4. intruded by a granite stock that cuts the fault, with a skarn where it meets the marble;
//   5. eroded: low hills, a valley along the fault trace, a thin regolith cover.
// Ore: the BIF thickens and enriches in the fold hinge — a shoot that plunges with the fold — plus skarn.
//
// Local metres: x east −100…1300, y north −95…1080, z up (sea level 0; the surface near 330 m).

export const BOX = { x0: -100, x1: 1300, y0: -95, y1: 1080, z0: -200, z1: 400 };   // the mapped ground

export const UNITS = [
  // code, name, colour (the plates' paint palette — basalt-friendly, distinct, not a rainbow)
  { code: 0, name: 'air', color: null },
  { code: 1, name: 'regolith', color: '#8a7a5c' },
  { code: 2, name: 'gneiss basement', color: '#5d6470' },
  { code: 3, name: 'quartzite', color: '#d9cfb4' },
  { code: 4, name: 'banded iron formation', color: '#5b2f52' },
  { code: 5, name: 'marble', color: '#b9c4c9' },
  { code: 6, name: 'phyllite', color: '#4f6b58' },
  { code: 7, name: 'metavolcanics', color: '#3d4a63' },
  { code: 8, name: 'granite', color: '#c98f6b' },
  { code: 9, name: 'skarn', color: '#6f8a3a' },
];

const D = Math.PI / 180;

// ── seeded value noise (fbm) ───────────────────────────────────────────────────────────────────────────
function hash3(i, j, k, s) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z, s) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (a, b, c2) => hash3(i + a, j + b, k + c2, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
           L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}
export function fbm(x, y, z, s = 1, oct = 3) {
  let a = 0, amp = 1, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { a += amp * vnoise(x * f, y * f, z * f, s + o * 17); n += amp; amp *= 0.5; f *= 2.03; }
  return a / n;
}

// ── the structure ──────────────────────────────────────────────────────────────────────────────────────
const C = { x: 600, y: 480 };                      // the fold axis passes over here
const TREND = 40 * D, PLUNGE = 11 * D;
const AX = [Math.sin(TREND), Math.cos(TREND)];     // horizontal unit vector along the axis (040°)
const AC = [Math.cos(TREND), -Math.sin(TREND)];    // across it (130°, toward the SE)

// the fault: strike 120°, dip 65° toward 210° (SW); passes through (760, 620) at z = 0
const F = { x: 760, y: 620, strike: 120 * D, dip: 65 * D, throw: 70 };
const FS = [Math.sin(F.strike), Math.cos(F.strike)];
const FD = [Math.sin(F.strike + Math.PI / 2), Math.cos(F.strike + Math.PI / 2)];   // dip direction (210°)
// signed distance to the fault plane (positive = hanging wall side, i.e. toward the dip direction)
export function faultSide(x, y, z) {
  const dh = (x - F.x) * FD[0] + (y - F.y) * FD[1];       // horizontal offset toward the dip direction
  return dh * Math.sin(F.dip) + z * Math.cos(F.dip);       // (the plane rises toward the footwall)
}

// stratigraphic height h at a point (after folding; before faulting)
export function stratHeight(x, y, z) {
  const dx = x - C.x, dy = y - C.y;
  const a = dx * AX[0] + dy * AX[1];                // along the axis
  let b = dx * AC[0] + dy * AC[1];                  // across it
  const zp = z + a * Math.tan(PLUNGE);              // plunge: the structure deepens toward 040°
  b -= (zp - 200) * 0.35;                           // inclined axial plane (vergence SE)
  const lam = 900, A = 170;
  // a slightly chevron-ish antiform: tightened cosine + a little parasitic folding on the limbs
  const ph = 2 * Math.PI * b / lam;
  const fold = A * Math.sign(Math.cos(ph)) * Math.pow(Math.abs(Math.cos(ph)), 0.7) + 12 * Math.sin(ph * 5);
  return zp - 55 - fold + 18 * fbm(x / 260, y / 260, z / 180, 7);
}
export function hingeDistance(x, y, z) {           // across-axis distance from the antiform's hinge
  const dx = x - C.x, dy = y - C.y;
  const a = dx * AX[0] + dy * AX[1];
  const zp = z + a * Math.tan(PLUNGE);
  return (dx * AC[0] + dy * AC[1]) - (zp - 200) * 0.35;
}

// the stratigraphy, bottom up (h thresholds); the BIF thickens in the hinge
function unitAtHeight(h, hinge) {
  const thick = 34 + 46 * Math.exp(-((hinge / 110) ** 2));     // BIF 34 m on the limbs, 80 m in the hinge
  if (h < -60) return 2;                                       // gneiss
  if (h < 20) return 3;                                        // quartzite
  if (h < 20 + thick) return 4;                                // BIF
  if (h < 150) return 5;                                       // marble
  if (h < 300) return 6;                                       // phyllite
  return 7;                                                    // metavolcanics
}

// the granite stock: a cupola widening downward, centred SW of the axis
const G = { x: 420, y: 330, top: 335, r0: 80, flare: 0.22 };
function graniteDistance(x, y, z) {                 // < 0 inside
  // a lumpy cupola: the radius shrinks fast above the top, widens slowly below; elongated a little NE–SW
  const r = G.r0 + (z > G.top ? -(z - G.top) * 1.6 : (G.top - z) * G.flare) + 30 * fbm(x / 110, y / 110, z / 70, 3)
    + 16 * fbm(x / 45, y / 45, z / 45, 4);
  const dx = x - G.x, dy = y - G.y, along = dx * 0.643 + dy * 0.766, across = dx * 0.766 - dy * 0.643;
  return Math.hypot(along * 0.8, across) - r;
}

// ── the surface ─────────────────────────────────────────────────────────────────────────────────────────
export function topo(x, y) {
  let z = 330 + 22 * fbm(x / 420, y / 420, 0.5, 11, 4) + 10 * Math.sin(x / 260) * Math.cos(y / 310);
  const fd = Math.abs(faultSide(x, y, 300));                    // a valley along the fault's trace
  z -= 22 * Math.exp(-((fd / 70) ** 2));
  z += 14 * Math.exp(-((Math.hypot(x - G.x, y - G.y) / 160) ** 2));   // the granite stands proud
  return z;
}

// ── the queries ─────────────────────────────────────────────────────────────────────────────────────────
export function lith(x, y, z) {
  const t = topo(x, y);
  if (z > t) return 0;
  if (z > t - 8 - 4 * fbm(x / 60, y / 60, 0, 5)) return 1;      // regolith
  const gd = graniteDistance(x, y, z);
  if (gd < 0) return 8;
  // the fault: the hanging wall dropped by the throw → read its stratigraphy from higher up
  const zf = faultSide(x, y, z) > 0 ? z + F.throw : z;
  const u = unitAtHeight(stratHeight(x, y, zf), hingeDistance(x, y, zf));
  if (u === 5 && gd < 45 + 15 * fbm(x / 50, y / 50, z / 50, 9)) return 9;   // skarn at the marble contact
  return u;
}

export function grade(x, y, z) {                  // g/t Au-equivalent, say
  const u = lith(x, y, z);
  if (u === 4) {
    const zf = faultSide(x, y, z) > 0 ? z + F.throw : z;
    const hinge = hingeDistance(x, y, zf);
    const shoot = Math.exp(-((hinge / 85) ** 2));               // the hinge shoot
    const n = fbm(x / 70, y / 70, z / 40, 21);
    return Math.max(0, 0.4 + 4.2 * shoot * (0.75 + 0.5 * n) + 0.3 * n);
  }
  if (u === 9) return Math.max(0, 1.6 + 1.4 * fbm(x / 40, y / 40, z / 40, 23));
  if (u === 5) return Math.max(0, 0.15 + 0.2 * fbm(x / 80, y / 80, z / 80, 25));
  return 0;
}

// ── a drilling programme: a fence across the hinge, inclined −60° toward 310° ─────────────────────────────
export function drillholes() {
  const holes = [];
  const az = 310 * D, dip = 60 * D;
  for (let k = -3; k <= 3; k++) for (let m = -1; m <= 1; m++) {
    // collars laid out along the axis (m) and across it (k), offset SE so the holes cut the hinge at depth
    const cx = C.x + AX[0] * m * 180 + AC[0] * (k * 70 + 160);
    const cy = C.y + AX[1] * m * 180 + AC[1] * (k * 70 + 160);
    const len = 380 + 60 * (m + 1);
    holes.push({ id: `MD${String(holes.length + 1).padStart(3, '0')}`, x: cx, y: cy, z: topo(cx, cy),
      azimuth: 310, dip: -60, length: len,
      at: (d) => [cx + d * Math.cos(dip) * Math.sin(az), cy + d * Math.cos(dip) * Math.cos(az), topo(cx, cy) - d * Math.sin(dip)] });
  }
  return holes;
}

export const FRAME = { TREND: TREND / D, PLUNGE: Math.round(PLUNGE / D), centre: C, fault: F, granite: G };

// the fault-aware versions (what a geologist standing at the point would see): the hanging wall's
// stratigraphy is read from higher up
export const restored = (x, y, z) => (faultSide(x, y, z) > 0 ? z + F.throw : z);
export const hingeAt = (x, y, z) => hingeDistance(x, y, restored(x, y, z));
// bedding at a point: the gradient of the stratigraphic height, as dip direction and dip (degrees)
export function bedding(x, y, z) {
  const zr = restored(x, y, z), e = 2;
  const gx = (stratHeight(x + e, y, zr) - stratHeight(x - e, y, zr)) / (2 * e);
  const gy = (stratHeight(x, y + e, zr) - stratHeight(x, y - e, zr)) / (2 * e);
  const gz = (stratHeight(x, y, zr + e) - stratHeight(x, y, zr - e)) / (2 * e);
  const n = Math.hypot(gx, gy, gz), h = Math.hypot(gx, gy);
  const dip = Math.atan2(h, gz) * 180 / Math.PI;
  const dipdir = ((Math.atan2(gx, gy) * 180 / Math.PI) + 360) % 360;   // upright beds: the younger rocks lie down-dip, so +∇h
  return { dip, dipdir, overturned: gz < 0, n };
}
