// wuffle — the statistics of a dataset, and the DERIVED datasets made from them. Pure (bearing does the
// maths). A derived dataset is an ordinary dataset with lineage: draw it on any net, select it, export it.
//   layerStats(ds)            n, the axial Fisher mean (+ κ, α95), eigen analysis (S1–S3, V1–V3, K, C, P, G, R)
//   deriveMean(p, dsId)       the mean as a one-row dataset (a plane for planes, a line for lines)
//   deriveEigen(p, dsId)      V1–V3 as a lines dataset (with their eigenvalues)
//   deriveBeta(p, dsId)       a β diagram: every pairwise intersection of a planes dataset, as lines
//   deriveIntersection(p, a, b)  the line where two datasets' mean planes meet

import { statistics, conversions, fault } from '../../../ext/bearing/index.js';
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
export function layerStats(ds, { confidence = 0.95, rows = null } = {}) {
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
  if (ds.kind === 'faults') out.stress = faultStress(ds);
  return out;
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
