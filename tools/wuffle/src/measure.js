// wuffle — MEASURING on a net, after OpenStereo 2's (Arthur's own, os_plot.py measure_*): a drag from one
// direction to another reads the angle between them and the great circle through them, or a small circle.
// Pure: two directions (direction cosines, x east, y north, z up — what a net's unproject gives) in, the
// geometry and its attitudes out; deriveMeasure turns one into a dataset (with its lineage). desk-measure.js
// is the gesture, the drawing and the readout.
//
// The three modes (OS2's three mouse buttons — wuffle also takes ⇧ and ⌥ for a trackpad or a phone):
//   'gc'        drag / left button — the arc A→B, the whole great circle through them and the arcs to its pole
//   'diameter'  ⇧-drag / middle    — the small circle on AB as its diameter (axis: their mean; half the angle)
//   'about'     ⌥-drag / right     — the small circle about A, through B
import { conversions } from '../../../ext/bearing/index.js';

const DEG = 180 / Math.PI;
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lower = (v) => (v[2] > 0 ? [-v[0], -v[1], -v[2]] : v);         // axial: the lower-hemisphere end
const line = (v) => conversions.dcosToLine(lower(v));                // [trend, plunge]
const plane = (pole) => conversions.dcosToPlane(lower(pole));        // [dip direction, dip] of the plane with this pole

/** the measurement between directions a and b → { mode, a, b, angle (°), line A/B, and per mode: pole + plane (gc), axis + radius (circles) } */
export function measureOf(a, b, mode = 'gc') {
  a = norm(a); b = norm(b);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * DEG;
  const out = { mode, a, b, angle, lineA: line(a), lineB: line(b) };
  if (mode === 'diameter') {
    const m = norm([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
    return { ...out, axis: lower(m), axisLine: line(m), radius: angle / 2 };
  }
  if (mode === 'about') return { ...out, axis: lower(a), axisLine: line(a), radius: angle };
  const c = cross(a, b), len = Math.hypot(c[0], c[1], c[2]);
  if (len < 1e-9) return { ...out, pole: null };                    // the same direction: no circle through them
  const pole = lower(c.map((x) => x / len));
  return { ...out, pole, poleLine: line(pole), plane: plane(pole) };
}

// points along the great-circle arc from a to b (the shorter way), and around a whole circle — for drawing
export function arcPoints(a, b, step = 1) {
  a = norm(a); b = norm(b);
  const th = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))), n = Math.max(2, Math.ceil(th * DEG / step)), s = Math.sin(th);
  if (s < 1e-9) return [a, b];
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s; return [k0 * a[0] + k1 * b[0], k0 * a[1] + k1 * b[1], k0 * a[2] + k1 * b[2]]; });
}
/** a circle of angular radius r (°) about axis k: r = 90 is the great circle with pole k */
export function circlePoints(k, r, step = 2) {
  k = norm(k);
  const e1 = norm(Math.abs(k[2]) < 0.9 ? cross(k, [0, 0, 1]) : cross(k, [1, 0, 0])), e2 = cross(k, e1), rr = r / DEG;
  const n = Math.ceil(360 / step), cr = Math.cos(rr), sr = Math.sin(rr);
  return Array.from({ length: n + 1 }, (_, i) => { const f = (2 * Math.PI * i) / n, c = Math.cos(f), s = Math.sin(f); return [cr * k[0] + sr * (c * e1[0] + s * e2[0]), cr * k[1] + sr * (c * e1[1] + s * e2[1]), cr * k[2] + sr * (c * e1[2] + s * e2[2])]; });
}

const r2 = (v) => Math.round(v * 100) / 100;
const fmt3 = (v) => String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0');
/** a readout line, as OpenStereo 2 printed it */
export function describeMeasure(m) {
  const ab = `${fmt3(m.lineA[0])}→${Math.round(m.lineA[1])} to ${fmt3(m.lineB[0])}→${Math.round(m.lineB[1])}`;
  if (m.mode === 'diameter' || m.mode === 'about')
    return `angle ${m.angle.toFixed(1)}° · small circle ${m.mode === 'about' ? 'about the first' : 'on that diameter'}: axis ${fmt3(m.axisLine[0])}→${Math.round(m.axisLine[1])}, ${m.radius.toFixed(1)}° · ${ab}`;
  if (!m.pole) return `angle ${m.angle.toFixed(1)}° · ${ab}`;
  return `angle ${m.angle.toFixed(1)}° · great circle ${fmt3(m.plane[0])}/${Math.round(m.plane[1])} · its pole ${fmt3(m.poleLine[0])}→${Math.round(m.poleLine[1])} · ${ab}`;
}

/** what a measurement can become: 'plane' (the great circle), 'pole' (its pole, a line), 'circle' (the small circle), 'ends' (A and B, as lines) */
export function measureOffers(m) {
  if (m.mode === 'gc') return m.pole ? ['plane', 'pole', 'ends'] : ['ends'];
  return ['circle', 'axis', 'ends'];
}
/** a measurement → a new dataset in the project (lineage: op 'measure'); returns its id */
export function deriveMeasure(p, m, what) {
  if (!measureOffers(m).includes(what)) {
    if ((what === 'plane' || what === 'pole') && m.mode === 'gc') throw new Error('the two directions are the same: no great circle through them');
    throw new Error(`a measurement like this can become ${measureOffers(m).join(', ')} (not a ${what})`);
  }
  const params = { mode: m.mode, from: m.lineA.map(r2), to: m.lineB.map(r2), angle: r2(m.angle) };
  if (what === 'plane') {
    if (!m.pole) throw new Error('the two directions are the same: no great circle through them');
    return p.derive({ name: `measured plane ${fmt3(m.plane[0])}/${Math.round(m.plane[1])}`, kind: 'planes', rows: [{ 'dip direction': r2(m.plane[0]), dip: r2(m.plane[1]), angle: r2(m.angle) }],
      roles: { dipDir: 'dip direction', dip: 'dip' }, op: 'measure', params });
  }
  if (what === 'pole') {
    if (!m.pole) throw new Error('the two directions are the same: no great circle through them');
    return p.derive({ name: `measured pole ${fmt3(m.poleLine[0])}→${Math.round(m.poleLine[1])}`, kind: 'lines', rows: [{ trend: r2(m.poleLine[0]), plunge: r2(m.poleLine[1]) }],
      roles: { trend: 'trend', plunge: 'plunge' }, op: 'measure', params });
  }
  if (what === 'circle') {
    return p.derive({ name: `measured small circle ${fmt3(m.axisLine[0])}→${Math.round(m.axisLine[1])}, ${m.radius.toFixed(1)}°`, kind: 'smallcircles',
      rows: [{ trend: r2(m.axisLine[0]), plunge: r2(m.axisLine[1]), angle: r2(m.radius) }], roles: { trend: 'trend', plunge: 'plunge', angle: 'angle' }, op: 'measure', params });
  }
  if (what === 'axis') {
    return p.derive({ name: `measured axis ${fmt3(m.axisLine[0])}→${Math.round(m.axisLine[1])}`, kind: 'lines', rows: [{ trend: r2(m.axisLine[0]), plunge: r2(m.axisLine[1]) }],
      roles: { trend: 'trend', plunge: 'plunge' }, op: 'measure', params });
  }
  if (what === 'ends') {
    return p.derive({ name: `measured ${m.angle.toFixed(1)}° apart`, kind: 'lines',
      rows: [{ end: 'A', trend: r2(m.lineA[0]), plunge: r2(m.lineA[1]) }, { end: 'B', trend: r2(m.lineB[0]), plunge: r2(m.lineB[1]) }],
      roles: { trend: 'trend', plunge: 'plunge' }, op: 'measure', params });
  }
  throw new Error(`a measurement can become ${measureOffers(m).join(', ')} (not “${what}”)`);
}
