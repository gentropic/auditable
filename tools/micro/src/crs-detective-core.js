// micro — the CRS DETECTIVE's pure part: which coordinate system were these collars recorded in?
//
// The idea. A drillhole collar is surveyed ON the ground, so its elevation should match the
// topography at its (x, y). Take the collar file's numbers as recorded in each candidate system,
// reproject them into the project's, and sample the DEM there: the right system puts every collar
// back on the ground (a tight |Δz|), a wrong one shifts the collars sideways by the datum shift —
// tens of metres for SAD69 / Córrego Alegre vs SIRGAS 2000 — and on slopes that shift reads as a
// systematic height misfit. Candidates are the project system's DATUM TWINS: the same projection
// (same zone, same parameters) on another datum, found in the EPSG table, not a hand list.
//
// What it cannot do, said out loud by the verdict:
//   · on flat ground a sideways shift changes no height — the test can't discriminate (measured
//     here as the expected height change of each candidate's shift over the DEM's slope)
//   · the DEM itself has to be in the right system
//   · collars may legitimately sit off today's surface (pre-strip topography, collars surveyed
//     before mining) — a large, CONSISTENT offset everywhere is called out as a vertical datum or
//     a stale DEM, not mistaken for a horizontal one.
//
// No imports: proj4 strings in, numbers out. The app (crs-detective.js) does the reprojection and
// the DEM sampling and hands this module plain arrays and a sampler.

// ── proj4 definitions: the projection part and the datum part ─────────────────────────────────
export function parseProj4(def) {
  const out = {};
  if (typeof def !== 'string' || !/\+proj=/.test(def)) return null;
  for (const tok of def.trim().split(/\s+/)) {
    const m = /^\+([A-Za-z_0-9]+)(?:=(.*))?$/.exec(tok);
    if (m) out[m[1].toLowerCase()] = m[2] == null ? true : m[2];
  }
  return out;
}
const DATUM_KEYS = ['datum', 'ellps', 'a', 'b', 'rf', 'f', 'towgs84', 'nadgrids', 'r'];
const IGNORE_KEYS = new Set([...DATUM_KEYS, 'no_defs', 'type', 'wktext', 'geoidgrids', 'vunits', 'title']);
const num = (v) => { const x = +v; return Number.isFinite(x) ? +x.toFixed(9) : String(v); };
/**
 * The PROJECTION of a proj4 definition, datum stripped, normalised so equal projections compare
 * equal ("+proj=utm +zone=23 +south" ≡ the tmerc it stands for). null for a geographic system or a
 * definition that isn't a proj4 string.
 */
export function projectionKey(def) {
  const p = parseProj4(def);
  if (!p || !p.proj || p.proj === 'longlat' || p.proj === 'latlong' || p.proj === 'lonlat' || p.proj === 'latlon') return null;
  const q = {};
  for (const [k, v] of Object.entries(p)) if (!IGNORE_KEYS.has(k)) q[k] = v;
  if (q.proj === 'utm') {
    const zone = +q.zone;
    if (!Number.isFinite(zone)) return null;
    const south = q.south === true || q.south === 'true';
    delete q.zone; delete q.south;
    Object.assign(q, { proj: 'tmerc', lat_0: 0, lon_0: zone * 6 - 183, k: 0.9996, x_0: 500000, y_0: south ? 10000000 : 0 });
  }
  if (q.k_0 != null && q.k == null) { q.k = q.k_0; delete q.k_0; }
  if (q.units == null && q.to_meter == null) q.units = 'm';
  for (const k of ['lat_0', 'lon_0', 'x_0', 'y_0', 'pm']) if (q[k] == null) q[k] = 0;
  if (q.proj === 'tmerc' && q.k == null) q.k = 1;
  return Object.keys(q).sort().map((k) => `${k}=${typeof q[k] === 'boolean' ? q[k] : num(q[k])}`).join(' ');
}
/** the DATUM part of a proj4 definition (what makes two same-projection systems differ) */
export function datumKey(def) {
  const p = parseProj4(def);
  if (!p) return String(def || '');
  return DATUM_KEYS.filter((k) => p[k] != null).map((k) => `${k}=${p[k]}`).join(' ');
}
const bboxHoldsPoint = (b, ll) => {
  if (!b || !ll) return true;                              // no area of use stated: don't exclude it
  const [w, s, e, n] = b, [x, y] = ll, pad = 0.5;
  if (y < s - pad || y > n + pad) return false;
  return w <= e ? (x >= w - pad && x <= e + pad) : (x >= w - pad || x <= e + pad);
};
/**
 * The datum twins of `base` (a CRS { epsg, def, kind, bbox, name, datum }): every PROJECTED entry
 * with the same projection on a different datum, whose area of use holds `lonLat` (the data's
 * centre, degrees; padded half a degree). `entries` is any iterable of CRS objects (the EPSG
 * table). Deprecated/duplicate definitions are kept — the caller groups indistinguishable ones.
 */
export function datumTwins(base, entries, { lonLat = null } = {}) {
  const key = base && projectionKey(base.def);
  if (!key) return [];
  const out = [];
  for (const c of entries) {
    if (!c || c.kind !== 'projected' || (base.epsg && c.epsg === base.epsg)) continue;
    if (projectionKey(c.def) !== key) continue;
    if (!bboxHoldsPoint(c.bbox, lonLat)) continue;
    out.push(c);
  }
  // the plainest name first: it leads its group when two readings coincide (SAD69 before SAD69(96))
  return out.sort((a, b) => a.name.length - b.name.length || (a.epsg || 0) - (b.epsg || 0));
}

/**
 * The readings to test: the file's numbers as the project system itself ("as is", the identity),
 * then as each twin, reprojected into the project system by `transform(fromCrs, toCrs, pts)`
 * (@gcu/proj's transformPoints, injected). `current` = the system the layer reads them in now
 * (null = as is). A twin that fails to transform is left out.
 */
export function hypothesesFor(raw, base, twins, transform, { current = null, label = (c) => (c.epsg ? `${c.name} · EPSG:${c.epsg}` : c.name) } = {}) {
  const sameAs = (a, b) => !!(a && b && ((a.epsg && a.epsg === b.epsg) || (!a.epsg && a.def === b.def)));
  const xy = raw.map((p) => [p[0], p[1]]);
  const out = [{ id: 'as-is', label: `as is — ${label(base)}`, xy, asIs: true, current: !current || sameAs(current, base), crs: base }];
  for (const c of twins) {
    let moved;
    try { moved = transform(c, base, raw); } catch { continue; }
    if (!moved || moved.length !== raw.length || !moved.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
    out.push({ id: c.epsg ? `EPSG:${c.epsg}` : c.name, label: label(c), xy: moved.map((p) => [p[0], p[1]]), current: sameAs(current, c), crs: c });
  }
  return out;
}

// ── robust statistics ─────────────────────────────────────────────────────────────────────────
export function median(a) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y), n = v.length;
  if (!n) return NaN;
  return n & 1 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2;
}
/** Δz values → { n, medAbs (median |Δz|), med (median signed Δz), spread (1.4826·MAD about med), inside (share within ±tol) } */
export function misfitStats(dz, tol = 2) {
  const v = dz.filter(Number.isFinite), n = v.length;
  if (!n) return { n: 0, medAbs: NaN, med: NaN, spread: NaN, inside: NaN };
  const med = median(v);
  return {
    n, med,
    medAbs: median(v.map(Math.abs)),
    spread: 1.4826 * median(v.map((x) => Math.abs(x - med))),
    inside: v.filter((x) => Math.abs(x) <= tol).length / n,
  };
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────
/**
 * collars: [[x, y, z], …] — the file's numbers (the "as is" positions in the project system).
 * hypotheses: [{ id, label, xy: [[x, y], …] (each collar reprojected as if recorded in that
 *   system), asIs? (the identity), current? (what the layer uses now), crs? }] — one is asIs.
 * sampleZ(x, y) → the DEM's elevation (NaN off it). pitch: the DEM's node spacing (for slopes).
 * tol: the height tolerance (m). margin: how many times better the winner must be to be named.
 * → { hypotheses (ranked, with stats), slope: { medDeg, p90Deg, n }, vertical, verdict: { kind, text, winner } }
 */
export function runDetective({ collars, hypotheses, sampleZ, pitch = 10, tol = 2, margin = 2, mergeTol = 0.5 }) {
  const N = collars.length;
  const asIs = hypotheses.find((h) => h.asIs) || hypotheses[0];
  // group hypotheses that move the collars to the same place (within mergeTol on average): they
  // can't be told apart by any test, so they are one row (WGS 84 ≡ SIRGAS 2000 here, for one)
  const groups = [];
  for (const h of hypotheses) {
    const g = groups.find((G) => {
      let s = 0, k = 0;
      for (let i = 0; i < N; i++) { const a = G.lead.xy[i], b = h.xy[i]; if (a && b && Number.isFinite(a[0]) && Number.isFinite(b[0])) { s += Math.hypot(a[0] - b[0], a[1] - b[1]); k++; } }
      return k && s / k < mergeTol;
    });
    if (g) g.members.push(h); else groups.push({ lead: h, members: [h] });
  }
  // the slope under the collars (central differences at one DEM pitch), at the as-is positions
  const h = Math.max(1e-6, pitch);
  const grad = collars.map(([x, y]) => {
    const gx = (sampleZ(x + h, y) - sampleZ(x - h, y)) / (2 * h), gy = (sampleZ(x, y + h) - sampleZ(x, y - h)) / (2 * h);
    return Number.isFinite(gx) && Number.isFinite(gy) ? [gx, gy] : null;
  });
  const slopes = grad.filter(Boolean).map((g) => Math.atan(Math.hypot(g[0], g[1])) * 180 / Math.PI).sort((a, b) => a - b);
  const slope = { n: slopes.length, medDeg: median(slopes), p90Deg: slopes.length ? slopes[Math.min(slopes.length - 1, Math.floor(0.9 * slopes.length))] : NaN };
  const rows = groups.map((G) => {
    const H = G.lead, dz = new Array(N);
    let off = 0, shiftSum = 0, shiftN = 0;
    const power = [];
    for (let i = 0; i < N; i++) {
      const p = H.xy[i], z0 = sampleZ(p[0], p[1]);
      if (!Number.isFinite(z0)) { dz[i] = NaN; off++; } else dz[i] = collars[i][2] - z0;
      const a = asIs.xy[i], d = [p[0] - a[0], p[1] - a[1]];
      if (Number.isFinite(d[0])) { shiftSum += Math.hypot(d[0], d[1]); shiftN++; }
      if (grad[i]) power.push(Math.abs(d[0] * grad[i][0] + d[1] * grad[i][1]));
    }
    return {
      id: H.id, label: G.members.length > 1 ? `${H.label} (≡ ${G.members.slice(1).map((m) => shortOf(m.label).replace(/^as is — /, '')).join(', ')})` : H.label, members: G.members.map((m) => ({ id: m.id, label: m.label, crs: m.crs || null })), crs: H.crs || null,
      asIs: G.members.some((m) => m.asIs), current: G.members.some((m) => m.current),
      shift: shiftN ? shiftSum / shiftN : 0,               // how far this reading moves the collars from as-is (mean, m)
      power: median(power),                                // the height change that shift makes over this DEM (median, m)
      off, ...misfitStats(dz, tol),
    };
  });
  // a VERTICAL offset: every reading leaves the collars on the same side of the surface by a lot,
  // and the best of them consistently so — a vertical datum, a stale DEM, collars before mining
  const usable = rows.filter((r) => r.n >= 3);
  const bySpread = [...usable].sort((a, b) => a.spread - b.spread)[0];
  const sameSide = usable.length && (usable.every((r) => r.med > 0) || usable.every((r) => r.med < 0));
  const vertical = !!(bySpread && sameSide && Math.abs(bySpread.med) > Math.max(2 * tol, 3 * bySpread.spread))
    ? { offset: bySpread.med, spread: bySpread.spread } : null;
  // rank: by the median |Δz| — or, with a vertical offset in the way, by the spread about it
  const score = (r) => (r.n >= 3 ? (vertical ? r.spread : r.medAbs) : Infinity);
  rows.forEach((r) => { r.score = score(r); });
  rows.sort((a, b) => a.score - b.score || (b.asIs - a.asIs));
  const verdict = judge({ rows, slope, vertical, tol, margin, N });
  return { hypotheses: rows, slope, vertical, verdict, tol, n: N };
}

const fm = (v) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
const times = (r) => (r >= 100 ? 'over 100×' : `${r >= 10 ? r.toFixed(0) : r.toFixed(1)}×`);
const shortOf = (label) => String(label || '').replace(/\s*·\s*EPSG:\d+$/, '');
const nm = (r) => (r.asIs ? 'as they are' : shortOf(r.members && r.members[0] ? r.members[0].label : r.label));
// the verdict, in plain language
export function judge({ rows, slope, vertical, tol, margin, N }) {
  const usable = rows.filter((r) => r.n >= 3);
  const offAll = rows.length ? Math.min(...rows.map((r) => r.off)) : N;
  if (usable.length === 0) return { kind: 'insufficient', winner: null, text: `Too few collars on the DEM to test (${N - offAll} of ${N}): the DEM has to cover the collars.` };
  const vText = vertical ? ` Collars sit ~${fm(Math.abs(vertical.offset))} m ${vertical.offset > 0 ? 'above' : 'below'} the DEM everywhere — a vertical datum difference or a stale DEM (topography from before mining, or collars surveyed before it)? Ranked by the spread about that offset.` : '';
  // flat ground: no candidate's sideways shift would change the heights by more than the tolerance
  const others = rows.filter((r) => !r.asIs && Number.isFinite(r.power));
  const maxPower = others.length ? Math.max(...others.map((r) => r.power)) : 0;
  if (others.length && maxPower < tol) {
    const big = others.reduce((a, b) => (b.shift > a.shift ? b : a));
    return { kind: 'flat', winner: null, text: `Can't tell: the DEM under the collars is too flat (median slope ${fm(slope.medDeg)}°). Moving them by ${nm(big)}'s ~${fm(big.shift)} m would change their heights by only ~${fm(big.power)} m — under the ${fm(tol)} m tolerance. A sideways shift can't be told apart on flat ground; this test needs relief.${vText}` };
  }
  if (!others.length) return { kind: 'no-candidates', winner: null, text: `No other datum shares this projection here, so there is nothing to compare the collars against.${vText}` };
  const [best, second] = usable;
  const floor = Math.max(0.05, tol / 20);
  const ratio = second ? Math.max(second.score, floor) / Math.max(best.score, floor) : Infinity;
  const what = vertical ? 'spread' : 'median |Δz|';
  if (best.asIs && ratio >= margin) return { kind: 'as-is', winner: best, ratio, text: `Collars fit the topography best as they are (${what} ${fm(best.score)} m; the next reading, ${nm(second)}, ${fm(second.score)} m — ${times(ratio)} worse). Good: their coordinate system agrees with the project's.${vText}` };
  if (!best.asIs && ratio >= margin) {
    const datum = best.crs && best.crs.datum ? best.crs.datum : nm(best);
    const asIs = rows.find((r) => r.asIs);
    const vs = second.asIs ? `${fm(second.score)} m as they are` : `${fm(asIs ? asIs.score : NaN)} m as they are; the runner-up, ${nm(second)}, ${fm(second.score)} m`;
    return { kind: 'shift', winner: best, ratio, text: `Collars fit the topography ${times(ratio)} better as ${nm(best)} than any other reading (${what} ${fm(best.score)} m vs ${vs}) — they were probably recorded in ${datum}. Reproject?${vText}` };
  }
  return { kind: 'inconclusive', winner: null, ratio, text: `No reading clearly wins: ${nm(best)} ${fm(best.score)} m vs ${nm(second)} ${fm(second.score)} m (only ${times(ratio)}; ${margin}× is asked for). The DEM may be too smooth or too coarse here, or the collars noisy.${vText}` };
}
