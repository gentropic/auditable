// orientationFromRotationVector — Android rotation vector → W3C deviceorientation.
// The conventions are the same (device x right / y top / z out; Earth E/N/Up),
// so each case is a rotation whose W3C triple is known by construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orientationFromRotationVector as orient } from '../ext/leadacid/index.js';

const D = Math.PI / 180;
// quaternion for a rotation of `deg` about unit axis [ax, ay, az] — Android's
// rotation vector is exactly this (x, y, z, w)
const q = (deg, [ax, ay, az]) => {
  const h = deg * D / 2, s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
};
// compose q2 ∘ q1 (apply q1 first)
const mul = ([x1, y1, z1, w1], [x2, y2, z2, w2]) => [
  w2 * x1 + x2 * w1 + y2 * z1 - z2 * y1,
  w2 * y1 - x2 * z1 + y2 * w1 + z2 * x1,
  w2 * z1 + x2 * y1 - y2 * x1 + z2 * w1,
  w2 * w1 - x2 * x1 - y2 * y1 - z2 * z1,
];
const near = (o, a, b, g, tol = 1e-6) => {
  assert.ok(Math.abs(o.alpha - a) < tol, `alpha ${o.alpha} ≠ ${a}`);
  assert.ok(Math.abs(o.beta - b) < tol, `beta ${o.beta} ≠ ${b}`);
  assert.ok(Math.abs(o.gamma - g) < tol, `gamma ${o.gamma} ≠ ${g}`);
};

test('identity: flat, top pointing north → 0/0/0', () => {
  near(orient([0, 0, 0, 1]), 0, 0, 0);
});

test('alpha: +90° about z (top swings to the west) → alpha 90', () => {
  near(orient(q(90, [0, 0, 1])), 90, 0, 0);
  near(orient(q(-90, [0, 0, 1])), 270, 0, 0);     // [0, 360)
});

test('beta: raise the top edge 30° (rotate about x) → beta 30', () => {
  near(orient(q(30, [1, 0, 0])), 0, 30, 0);
  near(orient(q(-30, [1, 0, 0])), 0, -30, 0);
});

test('gamma: roll 40° about y → gamma 40; stays inside [-90, 90)', () => {
  near(orient(q(40, [0, 1, 0])), 0, 0, 40);
  near(orient(q(-40, [0, 1, 0])), 0, 0, -40);
});

test('face down: 180° about x → beta -180 (the spec folds past ±90)', () => {
  const o = orient(q(180, [1, 0, 0]));
  assert.ok(Math.abs(Math.abs(o.beta) - 180) < 1e-6, `beta ${o.beta}`);
  assert.ok(o.beta < 180, 'beta is in [-180, 180)');
  assert.ok(Math.abs(o.gamma) < 1e-6);
});

test('a dipping plane: Z-X-Y composition reproduces alpha, beta, gamma together', () => {
  // W3C: R = Rz(α) · Rx(β) · Ry(γ)  — apply γ about y first, then β about x, then α about z
  const a = 215, b = 35, g = -20;
  const Q = mul(mul(q(g, [0, 1, 0]), q(b, [1, 0, 0])), q(a, [0, 0, 1]));
  near(orient(Q), a, b, g, 1e-6);
});

test('3-component vector (no w) is accepted; degenerate input returns null', () => {
  const [x, y, z] = q(30, [1, 0, 0]);
  near(orient([x, y, z]), 0, 30, 0, 1e-9);
  assert.equal(orient([0, 0]), null);
  assert.equal(orient(null), null);
});
