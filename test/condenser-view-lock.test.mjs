// @gcu/condenser/view — the orientation lock and the view rectangle (pure maths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normLock, lockAngles, lockHere, viewAxes, viewRect, rectCamera, isVertical, LOCK_PRESETS, viewPreset, ISO_PLUNGE } from '../ext/condenser/view/src/lock.js';
import { createOrbitCamera } from '../ext/condenser/src/core/camera.js';

const close = (a, b, tol = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≠ ${b}`);
const D = Math.PI / 180;

test('normLock: names, directions, and refusals', () => {
  for (const v of [undefined, null, '', false, 'free']) assert.equal(normLock(v), 'free');
  for (const v of ['plan', 'section', 'north', 'south', 'east', 'west']) assert.equal(normLock(v), v);
  assert.deepEqual(normLock({ azimuth: 370, plunge: 120 }), { azimuth: 10, plunge: 90 });
  assert.deepEqual(normLock({ azimuth: -90, plunge: 30 }), { azimuth: 270, plunge: 30 });
  for (const v of ['plna', 'three-quarter', 'iso-n', { azimuth: 10 }, { azimuth: 'x', plunge: 1 }, 3]) assert.equal(normLock(v), null, JSON.stringify(v));
});

test('lockAngles: the presets, an azimuth/plunge, and the section normal', () => {
  assert.equal(lockAngles('free'), null);
  assert.deepEqual(lockAngles('plan'), LOCK_PRESETS.plan);
  // {azimuth 0, plunge 0} looks north, like the preset
  const [t, p] = lockAngles({ azimuth: 0, plunge: 0 });
  close(Math.sin(t), Math.sin(LOCK_PRESETS.north[0])); close(Math.cos(t), Math.cos(LOCK_PRESETS.north[0])); close(p, 0);
  close(lockAngles({ azimuth: 135, plunge: 30 })[1], 30 * D);
  // a section looks ALONG its normal, and never up
  const asNorth = lockAngles('section', [0, 1, 0]), asEast = lockAngles('section', [1, 0, 0]);
  close(Math.sin(asNorth[0]), -1); close(asNorth[1], 0);
  close(Math.cos(asEast[0]), -1); close(asEast[1], 0);
  for (const n of [[0, 0, 1], [0, 0, -1]]) {
    const [th, ph] = lockAngles('section', n);
    close(ph, Math.PI / 2, 1e-12, 'z section is plan'); close(Math.sin(th), -1, 1e-12, 'north up');
  }
  const ob = lockAngles('section', [0, Math.SQRT1_2, Math.SQRT1_2]);   // a 45° plane facing up-north
  close(ob[1], 45 * D, 1e-9, 'oblique section looks down');
  assert.deepEqual(lockAngles('section', null), LOCK_PRESETS.plan, 'no section: plan');
  assert.ok(isVertical(LOCK_PRESETS.plan[1]) && !isVertical(0));
});

test('lockHere: what L locks with nothing to return to', () => {
  assert.equal(lockHere(-Math.PI / 2, Math.PI / 2 - 0.01), 'plan');
  const lk = lockHere(...lockAngles({ azimuth: 132, plunge: 25 }));
  assert.deepEqual(lk, { azimuth: 132, plunge: 25 });
  const tw = lockHere(...lockAngles({ azimuth: 90, plunge: 90 }));     // a twisted plan keeps its azimuth
  assert.deepEqual(tw, { azimuth: 90, plunge: 90 });
});

test('viewAxes: E/N in plan, E/RL or N/RL in sections, along/RL otherwise', () => {
  assert.deepEqual(viewAxes(...LOCK_PRESETS.plan).axes, ['E', 'N']);
  assert.deepEqual(viewAxes(...LOCK_PRESETS.north).axes, ['E', 'RL']);
  assert.deepEqual(viewAxes(...LOCK_PRESETS.south).axes, ['E', 'RL']);
  assert.deepEqual(viewAxes(...LOCK_PRESETS.east).axes, ['N', 'RL']);
  assert.deepEqual(viewAxes(...lockAngles({ azimuth: 30, plunge: 0 })).axes, ['along', 'RL']);
  assert.deepEqual(viewAxes(...lockAngles({ azimuth: 30, plunge: 90 })).axes, ['u', 'v']);
  assert.deepEqual(viewAxes(...lockAngles({ azimuth: 30, plunge: 40 })).axes, ['along', 'v']);
});

// a locked camera the way the view sets one up
function locked(lock, { target = [10, 20, 30], radius = 200, aspect = 2, zExag = 1 } = {}) {
  const cam = createOrbitCamera();
  const c = cam.state;
  [c.theta, c.phi] = lockAngles(lock);
  c.phiEps = 0; c.ortho = true; c.orbitLock = true; c.target = target.slice(); c.radius = radius; c.aspect = aspect; c.zExag = zExag;
  cam.update();
  return { cam, c };
}
// a world point → canvas fraction [0..1] (x right, y DOWN) through the camera's own viewProj
function toScreen(c, frame, p) {
  const m = c.viewProj, x = p[0] - frame[0], y = p[1] - frame[1], z = p[2] - frame[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2];
}

test('viewRect: the rectangle\'s corners land on the canvas corners (camera maths, zExag included)', () => {
  const frame = [500000, 7000000, 0];                     // UTM magnitudes: the frame keeps the maths local
  for (const [lock, zExag] of [['plan', 1], ['north', 1], ['south', 1], ['east', 3], ['west', 2.5], [{ azimuth: 30, plunge: 0 }, 4]]) {
    const { c } = locked(lock, { zExag });
    const { rect, basis } = viewRect(c, frame);
    // rebuild the corner world points from the named coordinates: u along basis.u, v along basis.v,
    // the rest from the target (the axes are orthogonal to each other)
    const t = [c.target[0] + frame[0], c.target[1] + frame[1], c.target[2] + frame[2]];
    const pt = (uu, vv) => {
      const du = uu - (t[0] * basis.u[0] + t[1] * basis.u[1] + t[2] * basis.u[2]);
      const dv = vv - (t[0] * basis.v[0] + t[1] * basis.v[1] + t[2] * basis.v[2]);
      return [0, 1, 2].map((k) => t[k] + du * basis.u[k] + dv * basis.v[k]);
    };
    const tl = toScreen(c, frame, pt(rect.u0, rect.v1)), br = toScreen(c, frame, pt(rect.u1, rect.v0));
    const what = `${JSON.stringify(lock)} ×${zExag}`;
    close(tl[0], 0, 1e-5, `${what} left`); close(tl[1], 0, 1e-5, `${what} top`);
    close(br[0], 1, 1e-5, `${what} right`); close(br[1], 1, 1e-5, `${what} bottom`);
  }
});

test('viewRect: plan is E right / N up; looking south E runs right-to-left', () => {
  const plan = viewRect(locked('plan').c, [0, 0, 0]).rect;
  assert.ok(plan.u1 > plan.u0 && plan.v1 > plan.v0);
  close(plan.u1 - plan.u0, 2 * (plan.v1 - plan.v0), 1e-6, 'aspect 2');
  const south = viewRect(locked('south').c, [0, 0, 0]).rect;
  assert.ok(south.u0 > south.u1, 'reversed E');
  // vertical exaggeration shrinks the RL the canvas shows, not the E
  const a = viewRect(locked('north').c, [0, 0, 0]).rect, b = viewRect(locked('north', { zExag: 4 }).c, [0, 0, 0]).rect;
  close((b.v1 - b.v0) * 4, a.v1 - a.v0, 1e-6, 'RL ÷ zExag'); close(b.u1 - b.u0, a.u1 - a.u0, 1e-9, 'E unchanged');
});

test('rectCamera: framing a rectangle, then reading it back', () => {
  const frame = [400000, 6900000, 100];
  for (const [lock, zExag] of [['plan', 1], ['north', 2], ['south', 1], ['east', 5]]) {
    const { cam, c } = locked(lock, { zExag });
    const ask = c.theta === LOCK_PRESETS.south[0]
      ? { u0: 400900, u1: 400100, v0: 300, v1: 500 }      // reversed E, as viewRect reports it looking south
      : { u0: lock === 'east' ? 6900100 : 400100, u1: lock === 'east' ? 6900900 : 400900, v0: lock === 'plan' ? 6900200 : 300, v1: lock === 'plan' ? 6900600 : 500 };
    const next = rectCamera(c, frame, ask);
    c.target = next.target; c.radius = next.radius; cam.update();
    const got = viewRect(c, frame).rect;
    const what = `${lock} ×${zExag}`;
    close((got.u0 + got.u1) / 2, (ask.u0 + ask.u1) / 2, 1e-6, `${what} u centre`);
    close((got.v0 + got.v1) / 2, (ask.v0 + ask.v1) / 2, 1e-6, `${what} v centre`);
    // the whole rectangle fits, and one side fits exactly
    const fu = Math.abs(got.u1 - got.u0) / Math.abs(ask.u1 - ask.u0), fv = Math.abs(got.v1 - got.v0) / Math.abs(ask.v1 - ask.v0);
    assert.ok(fu >= 1 - 1e-9 && fv >= 1 - 1e-9, `${what} contains`);
    close(Math.min(fu, fv), 1, 1e-6, `${what} tight`);
  }
});

test('views by name: true isometrics, three-quarter, the look-direction naming', () => {
  close(ISO_PLUNGE, 35.26438968, 1e-7, 'arctan(1/√2)');
  // a true isometric: unit E, N and up project to EQUAL lengths on screen, the lines 60° apart
  for (const name of ['iso', 'iso-ne', 'iso-nw', 'iso-se', 'iso-sw']) {
    const { c } = locked(name, { target: [0, 0, 0], radius: 100, aspect: 1 });
    const o = toScreen(c, [0, 0, 0], [0, 0, 0]);
    const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((a) => { const p = toScreen(c, [0, 0, 0], a); return [p[0] - o[0], p[1] - o[1]]; });
    const len = ax.map(([x, y]) => Math.hypot(x, y));
    close(len[0], len[1], 1e-6, `${name} |E|=|N|`); close(len[1], len[2], 1e-6, `${name} |N|=|up|`);
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
      const cos = (ax[i][0] * ax[j][0] + ax[i][1] * ax[j][1]) / (len[i] * len[j]);
      close(Math.abs(cos), 0.5, 1e-6, `${name} 60°/120°`);
    }
    assert.equal(normLock(name), name);
  }
  // names say where you LOOK: iso-ne looks north-east, so north runs up-and-away on screen
  const look = (name) => lockHere(...LOCK_PRESETS[name]);
  assert.deepEqual(look('iso'), { azimuth: 45, plunge: 35.26 });
  assert.deepEqual(look('iso-sw'), { azimuth: 225, plunge: 35.26 });
  const tq = viewPreset('three-quarter'), alias = viewPreset('3/4-nw');
  assert.equal(tq.ortho, false); assert.equal(tq.lockable, false);
  assert.deepEqual(lockHere(tq.theta, tq.phi), { azimuth: 45, plunge: 30 });
  assert.equal(alias.name, 'three-quarter-nw');
  assert.deepEqual(lockHere(alias.theta, alias.phi), { azimuth: 315, plunge: 30 });
  assert.equal(viewPreset('iso-se').ortho, true);
  assert.equal(viewPreset('north').ortho, null, 'compass views keep the projection');
  assert.equal(viewPreset('isometric'), null);
});
