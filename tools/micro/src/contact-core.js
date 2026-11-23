// micro contact analysis — the PURE half (no DOM, no state; node-tested in
// test/micro-contact.test.mjs). Grade binned by distance to a boundary, on both
// sides: a step at 0 is a HARD contact (estimate the domains apart), a ramp a
// SOFT one (share samples across it).
//
// Distances are SIGNED, one convention for both flavours: the NEGATIVE side is
// domain A down the hole, inside a closed solid, below (behind the normals of)
// an open surface; the positive side is domain B (or any other), outside, above.
// A bin is keyed by floor(d / binWidth): key −1 holds [−bw, 0), key 0 [0, bw),
// its centre (key + ½)·bw. One accumulator per bin:
//   w  Σ weight (support × the weight expression)   wv Σ weight × value
//   s  Σ support (metres down a hole; m³ of a block)  n  pieces counted
// — the mean is wv / w.

export const binKey = (d, bw) => Math.floor(d / bw);
export const binCenter = (k, bw) => (k + 0.5) * bw;

export function binAdd(bins, k, w, v, s) {
  let e = bins.get(k); if (!e) { e = { w: 0, wv: 0, s: 0, n: 0 }; bins.set(k, e); }
  e.w += w; e.wv += w * v; e.s += s; e.n++;
}

// add one record at signed distance d (|d| > maxDist is left out)
export function binRecord(bins, d, bw, maxDist, v, w, s) {
  if (!Number.isFinite(d) || !Number.isFinite(v) || !(w > 0)) return false;
  if (Math.abs(d) > maxDist) return false;
  binAdd(bins, binKey(d, bw), w, v, s);
  return true;
}

// spread a length of hole from distance lo to hi (lo < hi, both ≥ 0 measured AWAY from the contact)
// across the bins of one side, by overlap: a 5 m interval straddling two 2 m bins puts 2, 2 and 1 m
// in three bins, each at the interval's value. side −1 → the negative bins.
function spread(bins, lo, hi, bw, maxDist, side, v, wPerM) {
  if (hi > maxDist) hi = maxDist;
  if (lo < 0) lo = 0;
  if (!(hi > lo)) return;
  for (let k = Math.floor(lo / bw); k * bw < hi; k++) {
    const a = Math.max(lo, k * bw), b = Math.min(hi, (k + 1) * bw), len = b - a;
    if (!(len > 1e-12)) continue;
    binAdd(bins, side < 0 ? -k - 1 : k, len * wPerM, v, len);
  }
}

// one hole's intervals → RUNS of a domain: consecutive intervals (FROM order) of one domain with no
// gap wider than maxGap. A blank domain breaks a run (unknown is not a contact).
export function holeRuns(ivs, maxGap) {
  const runs = [];
  let cur = null, blank = false;
  for (const iv of ivs) {
    const dom = iv.dom == null ? '' : String(iv.dom).trim();
    if (!dom) { cur = null; blank = true; continue; }
    if (cur && cur.dom === dom && iv.from - cur.to <= maxGap) { cur.ivs.push(iv); cur.to = Math.max(cur.to, iv.to); continue; }
    cur = { dom, from: iv.from, to: iv.to, ivs: [iv], brk: blank };   // brk: a blank interval sits between it and the run before
    runs.push(cur); blank = false;
  }
  return runs;
}

/**
 * Down-hole contacts. intervals: [{ hole, from, to, dom, v, w, keep }] — v the value (NaN = none),
 * w the weight per metre (1 = length-weighted), keep false = the interval counts for the DOMAIN
 * (it is part of a run) but not for the value (out of the series filter or the scope).
 * opts: { domA, domB (null/'' = any other), direction: 'both' | 'AtoB' | 'BtoA' (A above B down
 * the hole, or below it), minRun (m, each side's run at least this long), maxGap (m, the widest
 * gap a contact or a run may bridge), binWidth, maxDist }.
 * → { bins: Map(key → acc), contacts, holes (with a contact), skipped: { short, gap } }
 */
export function downholeContacts(intervals, opts) {
  const { domA, binWidth: bw, maxDist } = opts;
  const domB = opts.domB == null || String(opts.domB).trim() === '' ? null : String(opts.domB).trim();
  const dir = opts.direction || 'both', minRun = +opts.minRun || 0, maxGap = opts.maxGap != null ? +opts.maxGap : bw;
  if (!(bw > 0)) throw new Error('bin width must be positive');
  if (!(maxDist > 0)) throw new Error('max distance must be positive');
  const A = String(domA).trim();
  if (!A) throw new Error('domain A: required');
  if (domB === A) throw new Error('domain B is the same as domain A');
  const isB = (d) => (domB == null ? d !== A : d === domB);
  const byHole = new Map();
  for (const iv of intervals) {
    if (!Number.isFinite(iv.from) || !Number.isFinite(iv.to) || !(iv.to > iv.from)) continue;
    const k = String(iv.hole); let l = byHole.get(k); if (!l) byHole.set(k, (l = [])); l.push(iv);
  }
  const bins = new Map();
  let contacts = 0, short = 0, gap = 0;
  const holes = new Set();
  for (const [hole, ivs] of byHole) {
    ivs.sort((a, b) => a.from - b.from || a.to - b.to);
    const runs = holeRuns(ivs, maxGap);
    for (let i = 0; i + 1 < runs.length; i++) {
      const up = runs[i], dn = runs[i + 1];
      let aRun, bRun, aUp;
      if (up.dom === A && isB(dn.dom)) { aRun = up; bRun = dn; aUp = true; }
      else if (dn.dom === A && isB(up.dom)) { aRun = dn; bRun = up; aUp = false; }
      else continue;
      if ((dir === 'AtoB' && !aUp) || (dir === 'BtoA' && aUp)) continue;
      if (dn.brk || dn.from - up.to > maxGap) { gap++; continue; }   // a gap wider than allowed: no contact across it
      if (up.to - up.from < minRun || dn.to - dn.from < minRun) { short++; continue; }   // a sliver
      const c = (up.to + dn.from) / 2;                     // the contact depth (mid-gap)
      contacts++; holes.add(hole);
      // A side: walk A's run AWAY from the contact (up the hole if A is above, down if below)
      for (const [run, side] of [[aRun, -1], [bRun, 1]]) {
        const above = (run === up);                         // this run is up-hole of the contact
        for (const iv of run.ivs) {
          if (!iv.keep || !Number.isFinite(iv.v)) continue;
          const lo = above ? c - iv.to : iv.from - c, hi = above ? c - iv.from : iv.to - c;
          spread(bins, lo, hi, bw, maxDist, side, iv.v, Number.isFinite(iv.w) ? iv.w : 1);
        }
      }
    }
  }
  return { bins, contacts, holes: holes.size, skipped: { short, gap } };
}

// a weighted least-squares slope of bin means against bin centres (weights = bin weight)
function wSlope(pts) {
  let sw = 0, sx = 0, sy = 0;
  for (const [x, y, w] of pts) { sw += w; sx += w * x; sy += w * y; }
  if (pts.length < 2 || !(sw > 0)) return NaN;
  const mx = sx / sw, my = sy / sw;
  let sxx = 0, sxy = 0;
  for (const [x, y, w] of pts) { sxx += w * (x - mx) * (x - mx); sxy += w * (x - mx) * (y - my); }
  return sxx > 0 ? sxy / sxx : NaN;
}

/**
 * The numbers a check reads, from one series' bins. near: how many bins each side make "just
 * inside / just outside" (default 1 — the first bin either side of the contact).
 *   mean_inside / mean_outside  the weighted mean within `near` bins of the contact, each side
 *   step   mean_inside − mean_outside   (a hard contact: large; a soft one: small)
 *   ratio  mean_inside / mean_outside
 *   n_inside / n_outside  pieces counted in those bins; n  their sum
 *   slope_inside / slope_outside  the weighted LS slope of bin mean against distance over each side
 *     (a ramp toward the contact: a soft contact; flat on both sides with a step: a hard one)
 *   mean_all_inside / mean_all_outside  the whole side's weighted mean (to maxDist)
 */
export function contactValues(bins, bw, near = 1) {
  let wi = 0, wvi = 0, ni = 0, wo = 0, wvo = 0, no = 0, Wi = 0, WVi = 0, Wo = 0, WVo = 0;
  const pin = [], pout = [];
  for (const [k, e] of bins) {
    if (!(e.w > 0)) continue;
    const pt = [binCenter(k, bw), e.wv / e.w, e.w];
    if (k < 0) { Wi += e.w; WVi += e.wv; pin.push(pt); if (k >= -near) { wi += e.w; wvi += e.wv; ni += e.n; } }
    else { Wo += e.w; WVo += e.wv; pout.push(pt); if (k < near) { wo += e.w; wvo += e.wv; no += e.n; } }
  }
  const mi = wi > 0 ? wvi / wi : NaN, mo = wo > 0 ? wvo / wo : NaN;
  return {
    mean_inside: mi, mean_outside: mo, step: mi - mo, ratio: mo !== 0 ? mi / mo : NaN,
    n_inside: ni, n_outside: no, n: ni + no,
    slope_inside: wSlope(pin), slope_outside: wSlope(pout),
    mean_all_inside: Wi > 0 ? WVi / Wi : NaN, mean_all_outside: Wo > 0 ? WVo / Wo : NaN,
  };
}

// one series' bins → rows sorted by centre: { side, center, mean, support, weight, count }
// sideNames: [negative side's name, positive side's name]
export function contactBinRows(bins, bw, sideNames) {
  return [...bins.keys()].sort((a, b) => a - b).map((k) => {
    const e = bins.get(k);
    return { side: k < 0 ? sideNames[0] : sideNames[1], center: binCenter(k, bw), mean: e.w > 0 ? e.wv / e.w : NaN, support: e.s, weight: e.w, count: e.n };
  });
}
