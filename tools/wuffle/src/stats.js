// wuffle — the statistics of a dataset, and the DERIVED datasets made from them. Pure (bearing does the
// maths). A derived dataset is an ordinary dataset with lineage: draw it on any net, select it, export it.
//   layerStats(ds)            n, the axial Fisher mean (+ κ, α95), eigen analysis (S1–S3, V1–V3, K, C, P, G, R)
//   deriveMean(p, dsId)       the mean as a one-row dataset (a plane for planes, a line for lines)
//   deriveEigen(p, dsId)      V1–V3 as a lines dataset (with their eigenvalues)
//   deriveBeta(p, dsId)       a β diagram: every pairwise intersection of a planes dataset, as lines
//   deriveIntersection(p, a, b)  the line where two datasets' mean planes meet
//   deriveRotated / deriveUntilted / deriveDeclination   the data turned (about an axis, back from a bedding
//                             tilt, by a magnetic declination) — every non-orientation column kept
//   detectSets(p, dsId, k?)   sets found by a mixture of Fisher distributions (bearing's EM, BIC picks k)
//   compareMeans(a, b)        Watson's test: could the two sets share one mean?
//   deriveLineations(p, a, b) every plane of one set against every plane of another, as lines

import { statistics, conversions, fault, analysis, cluster } from '../../../ext/bearing/index.js';
import { orientations } from './io.js';

const LINE_ROLES = { trend: 'trend', plunge: 'plunge' };
const PLANE_ROLES = { dipDir: 'dip direction', dip: 'dip' };
const r2 = (v) => Math.round(v * 100) / 100;
const axesOf = (ds) => orientations(ds).filter(Boolean).map((o) => o.pole || o.dcos);
const planeRow = (d) => { const [dd, dip] = conversions.dcosToPlane(d); return { 'dip direction': r2(dd), dip: r2(dip) }; };
const lineRow = (d) => { const [tr, pl] = conversions.dcosToLine(d); return { trend: r2(tr), plunge: r2(pl) }; };

/**
 * Michael (1984) for a fault dataset: σ1 (most compressive), σ2, σ3 as lines and the stress ratio
 * φ = (σ2 − σ3)/(σ1 − σ3); faults with an unknown sense are left out. → null with fewer than 4.
 */
export function faultStress(ds) {
  if (ds.kind !== 'faults') return null;
  const F = orientations(ds).filter((o) => o && o.lineDcos).map((o) => ({ o, ...fault.resolveSense(o.pole, o.lineDcos, o.sense) })).filter((f) => f.defined);
  if (F.length < 4) return null;
  const m = fault.michael(F.map((f) => f.o.pole), F.map((f) => f.slip)), ps = fault.principalStresses(m.stress);
  const [v1, v2, v3] = ps.values;
  return { n: F.length, axes: ps.axes.map((a) => conversions.dcosToLine(a)), phi: Math.abs(v1 - v3) > 1e-12 ? (v2 - v3) / (v1 - v3) : null, residual: m.residual };
}

/** @returns {{ n, mean?, eigen? }} — mean and eigen need ≥ 2 and ≥ 3 measurements */
export function layerStats(ds, { confidence = 0.95, rows = null, bootstrap = 0 } = {}) {
  // rows: only these (a selection) — the same statistics, of a part of the data
  if (rows) ds = { ...ds, rows: rows.filter((i) => i >= 0 && i < ds.rows.length).map((i) => ds.rows[i]) };
  const axes = axesOf(ds), n = axes.length, out = { n, of: ds.rows.length, kind: ds.kind, ...(rows ? { part: true } : {}) };
  if (n >= 2) {
    const f = statistics.fisherStats(axes, { axial: true }), c = statistics.confidenceCone(axes, confidence, { axial: true });
    out.mean = { dcos: f.mean, plane: conversions.dcosToPlane(f.mean), line: conversions.dcosToLine(f.mean), kappa: f.kappa, R: f.R, Rbar: f.Rbar, alpha: c.halfAngle, confidence };
  }
  if (n >= 3) {
    const pa = statistics.principalAxes(axes);
    out.eigen = { values: pa.eigenvalues, vectors: pa.eigenvectors.map((v) => ({ dcos: v, line: conversions.dcosToLine(v), plane: conversions.dcosToPlane(v) })),
      K: pa.K, C: pa.C, P: pa.P, G: pa.G, R: pa.R };
  }
  if (n >= 3) {
    // the KENT-style confidence ellipse (its cone is not round when the cluster isn't) and BINGHAM's test of
    // uniformity: is there a preferred orientation at all? (p small: yes)
    try { const e = statistics.confidenceEllipse(axes, { confidence }); out.ellipse = { a: e.a, b: e.b, azimuth: e.azimuth, center: e.center }; } catch { /* degenerate */ }
    try { const u = statistics.uniformityTest(axes); out.uniformity = { statistic: u.statistic, p: u.p }; } catch { /* */ }
    if (bootstrap > 0) { const b = statistics.bootstrapMeanConfidence(axes, { confidence, iterations: bootstrap, rng: seeded(1) }); out.bootstrap = { halfAngle: b.halfAngle, iterations: b.iterations }; }
  }
  if (ds.kind === 'faults') out.stress = faultStress(ds);
  return out;
}

/**
 * TERZAGHI (1965): a scanline or a borehole samples a set of planes in proportion to cos θ, θ between the line and
 * the planes' pole — planes nearly parallel to it are undercounted. Each plane's weight is 1 / cos θ, capped (at a
 * blind angle the weight would run away: max 10 is customary). → weights, one per row (null for an unreadable one)
 */
export function terzaghiWeights(ds, line, { max = 10 } = {}) {
  const L = conversions.lineToDcos(line[0], line[1]), cap = Math.max(1, +max || 10);
  return orientations(ds).map((o) => {
    if (!o) return null;
    const n = o.pole || o.dcos, c = Math.abs(n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    return +Math.min(cap, 1 / Math.max(c, 1 / cap)).toFixed(4);
  });
}
/** the weights written to the dataset as a column (terzaghi_w) and named its weight — one undo step */
export function applyTerzaghi(p, dsId, line, opts = {}) {
  const w = terzaghiWeights(p.dataset(dsId), line, opts), col = 'terzaghi_w';
  p.batch('Terzaghi correction', () => {
    p.editRows(dsId, (rows) => rows.map((r, i) => ({ ...r, [col]: w[i] == null ? '' : w[i] })));
    p.setRoles(dsId, { weight: col });
  });
  const ok = w.filter((x) => x != null);
  return { n: ok.length, min: Math.min(...ok), max: Math.max(...ok), capped: ok.filter((x) => x >= (+opts.max || 10)).length };
}

// a reproducible random stream (sets and bootstraps come out the same each time you ask)
function seeded(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── the data TURNED: about an axis, back from a tilt, by a declination. Every row keeps its other columns (a set,
// a label, a note); the orientation columns are written as dip direction/dip and trend/plunge ──
const ROLES_OF = { planes: PLANE_ROLES, lines: LINE_ROLES, smallcircles: { ...LINE_ROLES, angle: 'angle' },
  faults: { ...PLANE_ROLES, trend: 'trend', plunge: 'plunge', sense: 'sense' } };
function rowsFor(ds, turn) {
  const os = orientations(ds), roleCols = new Set(Object.values(ds.roles || {}).filter((c) => c !== ds.roles.set && c !== ds.roles.weight));
  const rows = []; let skipped = 0;
  os.forEach((o, i) => {
    if (!o) { skipped++; return; }
    const keep = {}; for (const [k, v] of Object.entries(ds.rows[i])) if (!roleCols.has(k)) keep[k] = v;
    let row;
    if (ds.kind === 'lines' || ds.kind === 'smallcircles') row = { ...lineRow(turn(o.dcos)), ...(ds.kind === 'smallcircles' ? { angle: o.angle } : {}) };
    else { row = planeRow(turn(o.pole)); if (ds.kind === 'faults') { if (o.lineDcos) Object.assign(row, lineRow(turn(o.lineDcos))); row.sense = o.sense ?? ''; } }
    rows.push({ ...keep, ...row });
  });
  return { rows, skipped };
}
const turned = (p, ds, dsId, turn, name, op, params) => {
  const { rows } = rowsFor(ds, turn);
  if (!rows.length) throw new Error(`“${ds.name}” has nothing readable to turn`);
  return p.derive({ name, kind: ds.kind, rows, roles: { ...ROLES_OF[ds.kind], ...(ds.roles.set && rows[0] && ds.roles.set in rows[0] ? { set: ds.roles.set } : {}) }, notation: 'dd', op, params, sources: [dsId] });
};
const fmtL = ([t, p]) => `${String(Math.round(t)).padStart(3, '0')}→${Math.round(p)}`;
/** rotated by `angle`° about the line axis [trend, plunge] (right-handed: clockwise looking down the axis) */
export function deriveRotated(p, dsId, { axis, angle }) {
  const ds = p.dataset(dsId), A = conversions.lineToDcos(axis[0], axis[1]);
  return turned(p, ds, dsId, (d) => conversions.rotateDcos(d, A, angle), `${ds.name} · rotated ${angle}° about ${fmtL(axis)}`, 'rotate', { axis, angle });
}
/** the data with a bedding's tilt taken out: rotated about the bedding's strike until it is horizontal */
export function deriveUntilted(p, dsId, bedding) {
  const ds = p.dataset(dsId);
  return turned(p, ds, dsId, (d) => analysis.unfold([d], bedding[0], bedding[1])[0], `${ds.name} · untilted (${String(Math.round(bedding[0])).padStart(3, '0')}/${Math.round(bedding[1])})`, 'untilt', { bedding });
}
/** azimuths turned by a magnetic declination (east positive): magnetic → true. The plunges and dips stay */
export function deriveDeclination(p, dsId, declination, { source = null } = {}) {
  const ds = p.dataset(dsId), V = [0, 0, -1];                    // down: a positive angle about it turns azimuths clockwise
  return turned(p, ds, dsId, (d) => conversions.rotateDcos(d, V, declination), `${ds.name} · true north (${declination >= 0 ? '+' : ''}${declination.toFixed(2)}°)`, 'declination', { declination, ...(source ? { source } : {}) });
}

// ── SETS: a mixture of Fisher distributions fitted to the poles (bearing's EM; BIC chooses k when you don't) —
// written as a column, so a set is selectable, colourable, its own dataset when you want ──
export function detectSets(p, dsId, k = null, { kMax = 5, column = 'set' } = {}) {
  const ds = p.dataset(dsId), os = orientations(ds), idx = [], axes = [];
  os.forEach((o, i) => { if (o) { idx.push(i); axes.push(o.pole || o.dcos); } });
  if (axes.length < 6) throw new Error(`“${ds.name}”: finding sets needs at least 6 measurements (${axes.length})`);
  const rng = seeded(7);
  const fit = k ? cluster.fitSetsEM(axes, k, { rng }) : cluster.selectSets(axes, { kMin: 1, kMax, rng }).best;
  // the sets in order of size, S1 the largest
  const order = fit.components.map((c, j) => j).sort((a, b) => fit.components[b].weight - fit.components[a].weight), rank = new Map(order.map((j, r) => [j, r]));
  const name = (j) => `S${rank.get(j) + 1}`;
  p.batch('find sets', () => {
    p.editRows(dsId, (rows) => { const out = rows.map((r) => ({ ...r, [column]: '' })); idx.forEach((i, m) => { out[i][column] = name(fit.assignments[m]); }); return out; });
    p.setRoles(dsId, { set: column });
  });
  const isPlane = ds.kind !== 'lines';
  return { k: fit.components.length, chose: !k, sets: order.map((j) => { const c = fit.components[j]; return { name: name(j), n: fit.assignments.filter((a) => a === j).length, weight: c.weight, kappa: c.kappa, axis: c.axis, plane: isPlane ? conversions.dcosToPlane(c.axisDir) : null }; }) };
}

/** WATSON's test for a common mean (F test on the resultants): could two sets of axes share one mean? */
export function compareMeans(dsA, dsB) {
  const a = axesOf(dsA), b = axesOf(dsB);
  if (a.length < 2 || b.length < 2) throw new Error('each set needs at least two measurements');
  // axial data: align b's axes to a's mean before testing (an axis and its opposite are one direction)
  const ma = statistics.fisherStats(a, { axial: true }).mean, align = (arr) => arr.map((d) => (d[0] * ma[0] + d[1] * ma[1] + d[2] * ma[2] < 0 ? [-d[0], -d[1], -d[2]] : d));
  const t = statistics.commonMeanTest(align(a), align(b));
  return { F: t.F, p: t.p, df: [t.df1, t.df2], nA: a.length, nB: b.length };
}

/** every plane of A against every plane of B: the lines they meet in (intersection lineations; β across two sets) */
export function deriveLineations(p, aId, bId, { max = 20000 } = {}) {
  const A = p.dataset(aId), B = p.dataset(bId);
  const pa = orientations(A).filter((o) => o && o.plane), pb = orientations(B).filter((o) => o && o.plane);
  if (!pa.length || !pb.length) throw new Error('lineations need two plane datasets');
  if (pa.length * pb.length > max) throw new Error(`${pa.length} × ${pb.length} = ${pa.length * pb.length} lines — more than ${max}; select fewer (a set, a selection → dataset)`);
  const rows = [];
  for (const x of pa) for (const y of pb) {
    const c = [x.pole[1] * y.pole[2] - x.pole[2] * y.pole[1], x.pole[2] * y.pole[0] - x.pole[0] * y.pole[2], x.pole[0] * y.pole[1] - x.pole[1] * y.pole[0]];
    const L = Math.hypot(...c); if (L < 1e-6) continue;          // parallel planes meet nowhere
    rows.push(lineRow(c.map((v) => v / L)));
  }
  return p.derive({ name: `${A.name} ∩ ${B.name}`, kind: 'lines', rows, roles: LINE_ROLES, notation: 'dd', op: 'lineations', params: {}, sources: [aId, bId] });
}

export function deriveMean(p, dsId) {
  const ds = p.dataset(dsId), s = layerStats(ds);
  if (!s.mean) throw new Error(`“${ds.name}”: a mean needs at least two measurements`);
  const isPlane = ds.kind === 'planes' || ds.kind === 'faults';
  const row = { ...(isPlane ? planeRow(s.mean.dcos) : lineRow(s.mean.dcos)), kappa: r2(s.mean.kappa), alpha95: r2(s.mean.alpha), n: s.n };
  return p.derive({ name: `${ds.name} · mean`, kind: isPlane ? 'planes' : 'lines', rows: [row], roles: isPlane ? PLANE_ROLES : LINE_ROLES,
    op: 'mean', params: { axial: true, confidence: s.mean.confidence }, sources: [dsId] });
}

export function deriveEigen(p, dsId) {
  const ds = p.dataset(dsId), s = layerStats(ds);
  if (!s.eigen) throw new Error(`“${ds.name}”: eigenvectors need at least three measurements`);
  const rows = s.eigen.vectors.map((v, i) => ({ axis: `V${i + 1}`, ...lineRow(v.dcos), eigenvalue: Math.round(s.eigen.values[i] * 1e4) / 1e4 }));
  return p.derive({ name: `${ds.name} · eigenvectors`, kind: 'lines', rows, roles: LINE_ROLES, op: 'eigenvectors', params: {}, sources: [dsId] });
}

/** a β diagram: the intersection of every pair of planes (n(n−1)/2 lines; refuses past 600 planes = 179 700 lines) */
export function deriveBeta(p, dsId) {
  const ds = p.dataset(dsId);
  if (ds.kind !== 'planes' && ds.kind !== 'faults') throw new Error(`“${ds.name}” holds ${ds.kind}: a β diagram intersects planes`);
  const o = orientations(ds).map((x, row) => (x ? { row, d: x.pole } : null)).filter(Boolean);
  if (o.length > 600) throw new Error(`“${ds.name}”: ${o.length} planes would make ${o.length * (o.length - 1) / 2} intersections; select fewer first`);
  const rows = [];
  for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) {
    const a = o[i].d, b = o[j].d, c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(...c);
    if (l < 1e-9) continue;                                // parallel planes meet nowhere
    rows.push({ ...lineRow(c.map((x) => x / l)), a: o[i].row + 1, b: o[j].row + 1 });
  }
  return p.derive({ name: `${ds.name} · β`, kind: 'lines', rows, roles: LINE_ROLES, op: 'beta', params: { pairs: rows.length }, sources: [dsId] });
}

/** where two datasets' mean planes meet (a fold axis from two limbs, a vein on a fault) */
export function deriveIntersection(p, aId, bId) {
  const A = p.dataset(aId), Bd = p.dataset(bId), sa = layerStats(A), sb = layerStats(Bd);
  for (const [d, s] of [[A, sa], [Bd, sb]]) {
    if (d.kind !== 'planes' && d.kind !== 'faults') throw new Error(`“${d.name}” holds ${d.kind}: intersect planes`);
    if (!s.mean && s.n !== 1) throw new Error(`“${d.name}” has no measurements to intersect`);
  }
  const poleOf = (ds, s) => s.mean ? s.mean.dcos : orientations(ds).find(Boolean).pole;
  const a = poleOf(A, sa), b = poleOf(Bd, sb);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(...c);
  if (l < 1e-9) throw new Error(`“${A.name}” and “${Bd.name}” are parallel: they never meet`);
  const angle = Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  return p.derive({ name: `${A.name} ∩ ${Bd.name}`, kind: 'lines', rows: [{ ...lineRow(c.map((x) => x / l)), angle: r2(angle) }], roles: LINE_ROLES,
    op: 'intersection', params: { of: 'mean planes' }, sources: [aId, bId] });
}
