// @gcu/wmm against NOAA/NCEI's published WMM2025 test values (ext/wmm/test-values.json,
// generated from WMM2025_TEST_VALUES.txt). The published numbers are rounded to
// 0.1 nT / 0.01°, so the tolerances are half a unit of that rounding plus a hair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { field, declination, decimalYear, EPOCH, MODEL, VALID_FROM, VALID_TO } from '../ext/wmm/src/main.js';

const ROWS = JSON.parse(readFileSync(new URL('../ext/wmm/test-values.json', import.meta.url), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, published ${b} (tol ${tol})`);

test('model identity', () => {
  assert.equal(MODEL, 'WMM-2025');
  assert.equal(EPOCH, 2025);
  assert.equal(VALID_FROM, 2025);
  assert.equal(VALID_TO, 2030);
  assert.equal(ROWS.length, 12);
});

for (const r of ROWS) {
  test(`published point ${r.date} h=${r.height} km lat=${r.lat} lon=${r.lon}`, () => {
    const o = field(r.lat, r.lon, { height: r.height, date: r.date });
    near(o.x, r.x, 0.06, 'X'); near(o.y, r.y, 0.06, 'Y'); near(o.z, r.z, 0.06, 'Z');
    near(o.h, r.h, 0.06, 'H'); near(o.f, r.f, 0.06, 'F');
    near(o.incl, r.incl, 0.006, 'I'); near(o.decl, r.decl, 0.006, 'D');
    if (r.gv == null) assert.equal(o.gv, null, 'GV absent in mid-latitudes');
    else near(o.gv, r.gv, 0.006, 'GV');
    near(o.xdot, r.xdot, 0.06, 'Xdot'); near(o.ydot, r.ydot, 0.06, 'Ydot'); near(o.zdot, r.zdot, 0.06, 'Zdot');
    near(o.hdot, r.hdot, 0.06, 'Hdot'); near(o.fdot, r.fdot, 0.06, 'Fdot');
    near(o.idot, r.idot, 0.006, 'Idot'); near(o.ddot, r.ddot, 0.006, 'Ddot');
    assert.equal(o.valid, true);
  });
}

test('declination() is the convenience over field(); a Date works as the date', () => {
  const d = declination(80, 0, 2025.0);
  near(d, 1.28, 0.006, 'D at the first test point');
  const mid = new Date(Date.UTC(2027, 6, 2, 12));          // ≈ 2027.5
  near(decimalYear(mid), 2027.5, 0.002, 'decimal year');
  near(declination(80, 0, mid), 2.59, 0.01, 'D at 2027.5 via a Date');
});

test('outside the validity window the model still evaluates but says so', () => {
  assert.equal(field(0, 120, { date: 2031.0 }).valid, false);
  assert.equal(field(0, 120, { date: 2024.9 }).valid, false);
  assert.equal(field(0, 120, { date: 2029.99 }).valid, true);
});
