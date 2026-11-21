// @gcu/condenser view — the orientation lock and the view rectangle. Pure maths, no
// DOM, so the unit tests run it in Node.
//
// Angles are the orbit camera's own (src/core/camera.js): the eye sits at
// target + r·[cosφcosθ, cosφsinθ, sinφ], so the view direction is the negative of
// that, the horizontal bearing of the view is atan2(−cosθ, −sinθ) and the plunge is φ.

const D = Math.PI / 180;

// a view direction in geologist terms → the camera's [θ, φ]: azimuth of the VIEW from
// north, clockwise; plunge downward. Names say where you LOOK, as look() does: 'north'
// looks north, and 'iso-ne' looks north-east (CAD calls that "SW Isometric", after where
// the viewer stands).
export const anglesOf = (azimuth, plunge) => {
  const az = azimuth * D;
  return [Math.atan2(-Math.cos(az), -Math.sin(az)), plunge * D];
};

// the true isometric plunge: arctan(1/√2) ≈ 35.264°, where E, N and up foreshorten alike
export const ISO_PLUNGE = Math.atan(Math.SQRT1_2) / D;
const QUARTER = { ne: 45, se: 135, sw: 225, nw: 315 };

// [θ, φ] for each named lock. Plan is north-up (θ = −90°); the compass names look
// horizontally; the isometrics are true ones and, like every lock, orthographic.
export const LOCK_PRESETS = {
  plan: [-Math.PI / 2, Math.PI / 2],
  north: [-Math.PI / 2, 0],
  south: [Math.PI / 2, 0],
  east: [Math.PI, 0],
  west: [0, 0],
  iso: anglesOf(45, ISO_PLUNGE),
  ...Object.fromEntries(Object.entries(QUARTER).map(([k, az]) => [`iso-${k}`, anglesOf(az, ISO_PLUNGE)])),
};
export const LOCK_NAMES = ['free', 'section', ...Object.keys(LOCK_PRESETS)];

// the three-quarter view: a perspective figure view, 30° down. The view's opening shot
// (looking north-east, so north runs up the screen as on a map). Not a lock: a locked
// view is orthographic, and a three-quarter view is for looking, not for measuring.
export const THREE_QUARTER_PLUNGE = 30;
const THREE_QUARTER = {
  'three-quarter': anglesOf(45, THREE_QUARTER_PLUNGE),
  ...Object.fromEntries(Object.entries(QUARTER).map(([k, az]) => [`three-quarter-${k}`, anglesOf(az, THREE_QUARTER_PLUNGE)])),
};

// every name look() takes → { theta, phi, ortho, lockable }. ortho: true (isometrics),
// false (three-quarter), null (keep the projection you are in). '3/4' spells
// 'three-quarter'. Unknown → null.
export const VIEW_NAMES = [...Object.keys(LOCK_PRESETS), ...Object.keys(THREE_QUARTER)];
export function viewPreset(name) {
  const k = typeof name === 'string' ? name.replace(/^3\/4/, 'three-quarter') : '';
  if (LOCK_PRESETS[k]) {
    const [theta, phi] = LOCK_PRESETS[k];
    return { name: k, theta, phi, ortho: k.startsWith('iso') ? true : null, lockable: true };
  }
  if (THREE_QUARTER[k]) {
    const [theta, phi] = THREE_QUARTER[k];
    return { name: k, theta, phi, ortho: false, lockable: false };
  }
  return null;
}

// the lock option → 'free' | 'section' | a preset name | { azimuth, plunge }; null if
// it is none of those (the caller says so)
export function normLock(v) {
  if (v == null || v === false || v === '' || v === 'free') return 'free';
  if (typeof v === 'string') return (v === 'section' || LOCK_PRESETS[v]) ? v : null;
  if (typeof v === 'object' && v.azimuth != null && v.plunge != null
      && Number.isFinite(+v.azimuth) && Number.isFinite(+v.plunge)) {
    return { azimuth: ((+v.azimuth % 360) + 360) % 360, plunge: Math.max(-90, Math.min(90, +v.plunge)) };
  }
  return null;
}

export const sameLock = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// the camera angles a lock holds, or null for 'free'. A 'section' lock looks ALONG the
// section's normal, and never up: a z section is a plan view, a y section looks north.
// With no section it holds plan.
export function lockAngles(lk, sectionNormal) {
  if (lk === 'free' || lk == null) return null;
  if (lk === 'section') {
    const n = sectionNormal;
    if (!n) return LOCK_PRESETS.plan.slice();
    const d = n[2] > 1e-9 ? [-n[0], -n[1], -n[2]] : n;
    const h = Math.hypot(d[0], d[1]);
    const theta = h < 1e-9 ? -Math.PI / 2 : Math.atan2(-d[1], -d[0]);
    return [theta, Math.asin(Math.max(-1, Math.min(1, -d[2])))];
  }
  if (typeof lk === 'string') return LOCK_PRESETS[lk].slice();
  const az = lk.azimuth * D;
  return [Math.atan2(-Math.cos(az), -Math.sin(az)), lk.plunge * D];
}

// looking straight down (or up): the only lock that may twist
export const isVertical = (phi) => Math.abs(Math.cos(phi)) < 1e-9;

// the lock that holds the camera where it is now (what `L` locks to with nothing to return to)
export function lockHere(theta, phi) {
  if (Math.abs(phi - Math.PI / 2) < 0.6 * D && Math.abs(Math.sin(theta) + 1) < 1e-6) return 'plan';
  const az = (Math.atan2(-Math.cos(theta), -Math.sin(theta)) / D + 360) % 360;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { azimuth: r2(az) % 360, plunge: r2(phi / D) };
}

// the screen's right and up, as world unit vectors
export function screenBasis(theta, phi) {
  const ct = Math.cos(theta), st = Math.sin(theta), sp = Math.sin(phi), cp = Math.cos(phi);
  return { r: [-st, ct, 0], up: [-ct * sp, -st * sp, cp] };
}

const AXES = [['E', [1, 0, 0]], ['N', [0, 1, 0]], ['RL', [0, 0, 1]]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function named(v) {
  for (const [name, a] of AXES) if (Math.abs(Math.abs(dot(v, a)) - 1) < 1e-9) return [name, a];
  return null;
}

// what the screen axes measure. A screen axis that runs along E, N or RL (either way)
// is named for it and measured in that world coordinate, so a view looking south reads
// E falling from left to right. Otherwise u is 'along' (the screen's right is always
// horizontal; measured as p·u), or 'u' in a twisted plan view, and v is 'v'; `basis`
// holds the unit vectors either way.
export function viewAxes(theta, phi) {
  const { r, up } = screenBasis(theta, phi);
  const nu = named(r), nv = named(up);
  return {
    axes: [nu ? nu[0] : (isVertical(phi) ? 'u' : 'along'), nv ? nv[0] : 'v'],
    u: nu ? nu[1] : r, v: nv ? nv[1] : up, r, up,
  };
}

// the world extent the canvas shows, along the screen axes: u0 at the LEFT edge, u1 at
// the right, v0 at the bottom, v1 at the top (so u0 > u1 when the axis runs leftward).
// Exact for an orthographic camera, vertical exaggeration included: the exaggeration
// scales displayed z about the target, so a screen offset maps back to the world by
// dividing its z by it. `c` is the orbit camera's state, `frame` the world origin of
// its local coordinates.
export function viewRect(c, frame) {
  const o = frame || [0, 0, 0];
  const S = c.zExag || 1, halfH = c.halfH, halfW = halfH * (c.aspect || 1);
  const { axes, u, v, r, up } = viewAxes(c.theta, c.phi);
  const t = [c.target[0] + o[0], c.target[1] + o[1], c.target[2] + o[2]];
  const upW = [up[0], up[1], up[2] / S];
  const at = (a, b) => [t[0] + a * r[0] + b * upW[0], t[1] + a * r[1] + b * upW[1], t[2] + a * r[2] + b * upW[2]];
  return {
    rect: { u0: dot(at(-halfW, 0), u), u1: dot(at(halfW, 0), u), v0: dot(at(0, -halfH), v), v1: dot(at(0, halfH), v) },
    axes, basis: { u, v },
  };
}

// the camera that shows a rectangle: { target (frame-local), radius }. The canvas keeps
// its aspect, so the whole rectangle fits and the longer side decides the zoom.
export function rectCamera(c, frame, rect) {
  const o = frame || [0, 0, 0];
  const { u, v, up } = viewAxes(c.theta, c.phi);
  const S = c.zExag || 1;
  const t = [c.target[0] + o[0], c.target[1] + o[1], c.target[2] + o[2]];
  const du = (rect.u0 + rect.u1) / 2 - dot(t, u), dv = (rect.v0 + rect.v1) / 2 - dot(t, v);
  const target = [0, 1, 2].map((k) => c.target[k] + du * u[k] + dv * v[k]);
  const sv = Math.hypot(up[0], up[1], up[2] / S);           // world length of one screen-up unit
  const halfH = Math.max(Math.abs(rect.v1 - rect.v0) / 2 / sv, Math.abs(rect.u1 - rect.u0) / 2 / (c.aspect || 1));
  return { target, radius: Math.max(0.05, halfH / Math.tan(c.fovY / 2)) };
}
