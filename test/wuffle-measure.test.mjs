// wuffle's measure tool (measure.js, after OpenStereo 2's): angles, the great circle through two directions and
// its pole, the two small circles — checked against geometry known by construction — and the datasets it makes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../tools/wuffle/src/model.js';
import { orientations } from '../tools/wuffle/src/io.js';
import { measureOf, arcPoints, circlePoints, describeMeasure, measureOffers, deriveMeasure } from '../tools/wuffle/src/measure.js';

const D = Math.PI / 180;
const lineDir = (tr, pl) => [Math.sin(tr * D) * Math.cos(pl * D), Math.cos(tr * D) * Math.cos(pl * D), -Math.sin(pl * D)];
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const az = (a, b) => near(((a - b) % 360 + 540) % 360 - 180, 0, 1e-4);   // azimuths equal mod 360

describe('measureOf', () => {
  it('east and north on the horizon: 90° apart, on the horizontal plane, its pole vertical', () => {
    const m = measureOf(lineDir(90, 0), lineDir(0, 0));
    assert.ok(near(m.angle, 90));
    assert.ok(near(m.plane[1], 0, 1e-6), `dip ${m.plane[1]}`);
    assert.ok(near(m.poleLine[1], 90, 1e-6), `pole plunge ${m.poleLine[1]}`);
    assert.ok(m.pole[2] < 0, 'the pole is taken at its lower end');
  });
  it('two lines in the vertical N–S plane: 30° apart, that plane (dip 90, striking N–S), its pole on the E–W horizontal', () => {
    const m = measureOf(lineDir(0, 30), lineDir(0, 60));
    assert.ok(near(m.angle, 30, 1e-9));
    assert.ok(near(m.plane[1], 90, 1e-6));
    assert.ok(az(m.plane[0], 90) || az(m.plane[0], 270), `dip direction ${m.plane[0]}`);
    assert.ok(near(m.poleLine[1], 0, 1e-6) && (az(m.poleLine[0], 90) || az(m.poleLine[0], 270)));
  });
  it('a plane known by construction: two lines in 120/40 give back 120/40', () => {
    // lines in the plane dipping 40 toward 120: its strike (030→0) and its dip line (120→40)
    const m = measureOf(lineDir(30, 0), lineDir(120, 40));
    assert.ok(az(m.plane[0], 120) && near(m.plane[1], 40, 1e-6), `${m.plane}`);
    assert.ok(near(m.angle, 90, 1e-6));
  });
  it('the small circles: on AB as a diameter (half the angle, about their mean), and about A (the whole angle)', () => {
    const a = lineDir(90, 0), b = lineDir(0, 0);
    const d = measureOf(a, b, 'diameter'), ab = measureOf(a, b, 'about');
    assert.ok(near(d.radius, 45) && az(d.axisLine[0], 45) && near(d.axisLine[1], 0, 1e-6));
    assert.ok(near(ab.radius, 90) && az(ab.axisLine[0], 90));
  });
  it('the same direction twice: an angle of 0 and no great circle (nothing to offer but the ends)', () => {
    const m = measureOf(lineDir(45, 20), lineDir(45, 20));
    assert.ok(near(m.angle, 0, 1e-6)); assert.equal(m.pole, null);
    assert.deepEqual(measureOffers(m), ['ends']);
  });
});

describe('drawing points', () => {
  it('an arc runs from A to B on the sphere; a circle of radius r keeps r from its axis', () => {
    const a = lineDir(10, 20), b = lineDir(80, 50), pts = arcPoints(a, b);
    assert.deepEqual(pts[0].map((v) => +v.toFixed(9)), a.map((v) => +v.toFixed(9)));
    for (const p of pts) assert.ok(near(Math.hypot(...p), 1, 1e-9));
    const k = lineDir(200, 35);
    for (const p of circlePoints(k, 25)) assert.ok(near(Math.acos(p[0] * k[0] + p[1] * k[1] + p[2] * k[2]) / D, 25, 1e-6));
  });
});

describe('deriveMeasure', () => {
  it('a measured plane, pole, small circle, axis and ends land as datasets that read back what was measured, with lineage', () => {
    const p = new Project();
    const gc = measureOf(lineDir(30, 0), lineDir(120, 40));
    const pl = p.dataset(deriveMeasure(p, gc, 'plane'));
    assert.equal(pl.kind, 'planes'); assert.equal(pl.lineage.op, 'measure');
    const o = orientations(pl)[0]; assert.ok(az(o.plane[0], 120) && near(o.plane[1], 40, 0.01));
    const po = p.dataset(deriveMeasure(p, gc, 'pole')); assert.equal(po.kind, 'lines');
    const sc = measureOf(lineDir(90, 0), lineDir(0, 0), 'diameter');
    const c = p.dataset(deriveMeasure(p, sc, 'circle'));
    assert.equal(c.kind, 'smallcircles'); assert.ok(near(orientations(c)[0].angle, 45, 0.01));
    assert.equal(p.dataset(deriveMeasure(p, sc, 'ends')).rows.length, 2);
    assert.throws(() => deriveMeasure(p, sc, 'plane'), /plane/);
    assert.match(describeMeasure(gc), /angle 90\.0° · great circle 120\/40/);
  });
});
