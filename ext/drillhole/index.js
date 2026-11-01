// ⚠ GENERATED FILE — DO NOT EDIT. Source: src/  Build: @gcu/build src/main.js
// @gcu/drillhole — Pure drillhole desurvey + fixed-length down-hole compositing (minimum curvature / balanced tangential / tangential), with a non-silent consistency report. Collars + surveys + intervals → composites ready for estimation.

// ── src/desurvey.js ──

// @gcu/drillhole — desurvey: collar + survey stations → the 3D hole trace, and a
// method-consistent position at any down-hole depth.
//
// Conventions (D1): azimuth = degrees clockwise from north; dip = MINING convention,
// positive DOWN (normalizeSurveys flips neg-down files; detectDipConvention infers
// from the median); depths/lengths in any consistent unit (metres in practice).
// World frame: x = east, y = north, z = up.
//
// Reverse-vendored from BMA (A7 Phase 0, Arthur 2026-06-11) — developed there in the
// concat-source style, always intended to live here. BMA + dee re-vendor from here now.

// Unit tangent from azimuth/dip (mining pos-down): x east, y north, z up.
function dhTangent(azDeg, dipDeg) {
  let az = azDeg * Math.PI / 180, dip = dipDeg * Math.PI / 180;
  let c = Math.cos(dip);
  return [Math.sin(az) * c, Math.cos(az) * c, -Math.sin(dip)];
}

// 'pos-down' (mining: +60 = 60° below horizontal) vs 'neg-down' (signed math: -60 =
// below). Inferred from the median dip — exploration holes point down, so the sign of
// the bulk tells the convention.
function dhDetectDipConvention(surveys) {
  let dips = [];
  for (let i = 0; i < surveys.length; i++) {
    let d = surveys[i].dip;
    if (typeof d === 'number' && isFinite(d) && d !== 0) dips.push(d);
  }
  if (dips.length === 0) return 'pos-down';
  dips.sort(function(a, b) { return a - b; });
  let med = dips[Math.floor(dips.length / 2)];
  return med < 0 ? 'neg-down' : 'pos-down';
}

// Sort, dedupe (last wins), normalize dip to pos-down, synthesize a station at depth 0
// when the list starts deeper (copies the first attitude). Returns { stations:
// [{depth, az, dip}], dupCount, badCount }.
function dhNormalizeSurveys(rawSurveys, dipConvention) {
  let flip = dipConvention === 'neg-down' ? -1 : 1;
  let clean = [], badCount = 0;
  for (let i = 0; i < rawSurveys.length; i++) {
    let s = rawSurveys[i];
    let depth = s.depth, az = s.az, dip = s.dip * flip;
    if (!isFinite(depth) || depth < 0 || !isFinite(az) || !isFinite(dip) || Math.abs(dip) > 90.000001) {
      badCount++;
      continue;
    }
    clean.push({ depth: depth, az: az, dip: dip });
  }
  clean.sort(function(a, b) { return a.depth - b.depth; });
  let stations = [], dupCount = 0;
  for (let j = 0; j < clean.length; j++) {
    if (stations.length && Math.abs(stations[stations.length - 1].depth - clean[j].depth) < 1e-9) {
      stations[stations.length - 1] = clean[j]; // last wins
      dupCount++;
    } else {
      stations.push(clean[j]);
    }
  }
  if (stations.length && stations[0].depth > 1e-9) {
    stations.unshift({ depth: 0, az: stations[0].az, dip: stations[0].dip });
  }
  return { stations: stations, dupCount: dupCount, badCount: badCount };
}

// Desurvey one hole. Methods:
// - 'minimumCurvature' (default): circular-arc model, RF = (2/θ)·tan(θ/2)
// - 'balancedTangential': the same without RF — averages the two end tangents per
//   segment (matches legacy desurveys from several packages)
// - 'tangential': straight segments along the LOWER station's attitude (sparse/legacy
//   surveys; matches dee's simple-tangential seed)
// collar = [x, y, z]; stations from dhNormalizeSurveys (pos-down). Returns { method,
// depths, px, py, pz, tx, ty, tz, dogleg, dls } — tangents + method ride along so
// dhPositionAt interpolates consistently. `dogleg[k]` is the angular change (degrees)
// between stations k−1 and k; `dls[k]` is the dogleg SEVERITY in °/30 length-units (the
// metric drilling-QC convention — multiply by ⅓ for °/10 m, or recompute from `dogleg`
// for °/100 ft). Both are geometry of the survey attitudes — independent of `method` —
// so they're the same whichever desurvey you pick. dogleg[0] = dls[0] = 0.
function dhDesurveyHole(collar, stations, method) {
  method = method || 'minimumCurvature';
  let n = stations.length;
  let out = {
    method: method,
    depths: new Float64Array(n),
    px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n),
    tx: new Float64Array(n), ty: new Float64Array(n), tz: new Float64Array(n),
    dogleg: new Float64Array(n), dls: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.depths[i] = stations[i].depth;
    let t = dhTangent(stations[i].az, stations[i].dip);
    out.tx[i] = t[0]; out.ty[i] = t[1]; out.tz[i] = t[2];
  }
  out.px[0] = collar[0]; out.py[0] = collar[1]; out.pz[0] = collar[2];

  for (let k = 1; k < n; k++) {
    let dl = out.depths[k] - out.depths[k - 1];
    // dogleg angle between the two station tangents — drives both the min-curvature RF
    // and the QC severity, and is the same for every method (it's the survey geometry).
    let dot = out.tx[k - 1] * out.tx[k] + out.ty[k - 1] * out.ty[k] + out.tz[k - 1] * out.tz[k];
    let doglegRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    out.dogleg[k] = doglegRad * 180 / Math.PI;
    out.dls[k] = dl > 1e-12 ? out.dogleg[k] / dl * 30 : 0;
    if (method === 'tangential') {
      out.px[k] = out.px[k - 1] + dl * out.tx[k];
      out.py[k] = out.py[k - 1] + dl * out.ty[k];
      out.pz[k] = out.pz[k - 1] + dl * out.tz[k];
    } else {
      let rf = 1; // balanced tangential
      // minimum curvature: RF = (2/θ)·tan(θ/2)
      if (method !== 'balancedTangential') rf = doglegRad > 1e-6 ? (2 / doglegRad) * Math.tan(doglegRad / 2) : 1;
      out.px[k] = out.px[k - 1] + 0.5 * dl * (out.tx[k - 1] + out.tx[k]) * rf;
      out.py[k] = out.py[k - 1] + 0.5 * dl * (out.ty[k - 1] + out.ty[k]) * rf;
      out.pz[k] = out.pz[k - 1] + 0.5 * dl * (out.tz[k - 1] + out.tz[k]) * rf;
    }
  }
  return out;
}

// Position at an arbitrary down-hole depth, consistent with the hole's desurvey method
// (depths between stations land on the SAME path the stations were placed on):
// - minimumCurvature: arc-correct (D2) — the closed-form integral of the slerp of the
//   end tangents: p(s) = p1 + L/(θ·sinθ)·[(cos(θ−φ) − cosθ)·d1 + (1 − cosφ)·d2],
//   φ = θ·s/L (at s = L this reduces to the RF endpoint formula; the harness pins
//   mid-segment points to an analytic circle at 1e-14)
// - tangential: straight along the lower station's attitude (how the segment was built)
// - balancedTangential: linear along the segment chord
// Beyond the last station: straight extrapolation along the last tangent (standard
// practice — intervals routinely outrun the survey).
function dhPositionAt(hole, depth) {
  let d = hole.depths, n = d.length;
  if (n === 0) return null;
  if (depth <= d[0]) {
    let s0 = depth - d[0]; // above collar station (negative) — straight
    return [hole.px[0] + s0 * hole.tx[0], hole.py[0] + s0 * hole.ty[0], hole.pz[0] + s0 * hole.tz[0]];
  }
  if (depth >= d[n - 1]) {
    let sE = depth - d[n - 1];
    return [hole.px[n - 1] + sE * hole.tx[n - 1], hole.py[n - 1] + sE * hole.ty[n - 1], hole.pz[n - 1] + sE * hole.tz[n - 1]];
  }
  // binary search: segment [lo, lo+1] with d[lo] <= depth < d[lo+1]
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    let mid = (lo + hi) >> 1;
    if (d[mid] <= depth) lo = mid; else hi = mid;
  }
  let L = d[lo + 1] - d[lo], s = depth - d[lo];
  if (L < 1e-12) return [hole.px[lo], hole.py[lo], hole.pz[lo]];

  if (hole.method === 'tangential') {
    return [
      hole.px[lo] + s * hole.tx[lo + 1],
      hole.py[lo] + s * hole.ty[lo + 1],
      hole.pz[lo] + s * hole.tz[lo + 1],
    ];
  }
  if (hole.method === 'balancedTangential') {
    let t = s / L;
    return [
      hole.px[lo] + t * (hole.px[lo + 1] - hole.px[lo]),
      hole.py[lo] + t * (hole.py[lo + 1] - hole.py[lo]),
      hole.pz[lo] + t * (hole.pz[lo + 1] - hole.pz[lo]),
    ];
  }

  let d1 = [hole.tx[lo], hole.ty[lo], hole.tz[lo]];
  let d2 = [hole.tx[lo + 1], hole.ty[lo + 1], hole.tz[lo + 1]];
  let dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  let theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  if (theta < 1e-9) {
    return [hole.px[lo] + s * d1[0], hole.py[lo] + s * d1[1], hole.pz[lo] + s * d1[2]];
  }
  let phi = theta * s / L;
  let kk = L / (theta * Math.sin(theta));
  let a = (Math.cos(theta - phi) - Math.cos(theta)) * kk;
  let b = (1 - Math.cos(phi)) * kk;
  return [
    hole.px[lo] + a * d1[0] + b * d2[0],
    hole.py[lo] + a * d1[1] + b * d2[1],
    hole.pz[lo] + a * d1[2] + b * d2[2],
  ];
}

// ── src/validate.js ──

// @gcu/drillhole — validate: join + check the three tables. Nothing is silently
// dropped; every exclusion lands in the report with a count and a BHID list.
//
// The collar+survey join (dhJoinHoles) and per-hole station normalization
// (dhNormalizeHoleStations) are factored out so the point-sample locator
// (dhDesurveySamples) reuses the exact same hole-building — one join, two consumers.


// Build the per-hole structure from collars + surveys (NOT normalized yet — callers
// normalize only the holes that pass their own gate, so a skipped hole doesn't accrue
// advisory counts). Returns { holes: bhid→{bhid,collar,eoh,rawSurveys}, order: [] }.
function dhJoinHoles(tables, dipConvention, hit) {
  let holes = {}, order = [];
  for (let ci = 0; ci < (tables.collars || []).length; ci++) {
    let c0 = tables.collars[ci];
    let bid = String(c0.bhid).trim();
    if (!bid) { hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', null); continue; }
    if (!isFinite(c0.x) || !isFinite(c0.y) || !isFinite(c0.z)) {
      hit('bad-collar', 'Collar rows with missing BHID or non-numeric coordinates', bid);
      continue;
    }
    if (holes[bid]) { hit('dup-collar', 'Duplicate collar BHIDs (first kept)', bid); continue; }
    holes[bid] = { bhid: bid, collar: [c0.x, c0.y, c0.z], eoh: isFinite(c0.eoh) ? c0.eoh : null, rawSurveys: [] };
    order.push(bid);
  }
  for (let si = 0; si < (tables.surveys || []).length; si++) {
    let s0 = tables.surveys[si];
    let sb = String(s0.bhid).trim();
    let h = holes[sb];
    if (!h) { hit('orphan-survey', 'Survey rows whose BHID has no collar (excluded)', sb); continue; }
    h.rawSurveys.push({ depth: s0.depth, az: s0.az, dip: s0.dip });
  }
  return { holes: holes, order: order };
}

// Normalize one hole's raw surveys → hole.stations (pos-down, sorted, deduped, depth-0
// synthesized), with the no-usable-survey straight-down fallback and the survey-side
// past-EOH advisory. Counts ride into `hit`. Mutates + returns the hole.
function dhNormalizeHoleStations(hole, dipConvention, hit) {
  let norm = dhNormalizeSurveys(hole.rawSurveys, dipConvention);
  if (norm.badCount) for (let bi = 0; bi < norm.badCount; bi++) hit('bad-survey', 'Survey rows with non-numeric depth/azimuth or |dip| > 90 (excluded)', hole.bhid);
  if (norm.dupCount) for (let di = 0; di < norm.dupCount; di++) hit('dup-survey-depth', 'Duplicate survey depths in a hole (last kept)', hole.bhid);
  if (norm.stations.length === 0) {
    hit('collar-no-survey', 'Holes with no usable survey (desurveyed straight down)', hole.bhid);
    norm.stations = [{ depth: 0, az: 0, dip: 90 }];
  }
  hole.stations = norm.stations;
  if (hole.eoh != null && norm.stations[norm.stations.length - 1].depth > hole.eoh + 1e-9) {
    hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hole.bhid);
  }
  return hole;
}

// tables = {
//   collars:  [{ bhid, x, y, z, eoh }],            // eoh optional/null
//   surveys:  [{ bhid, depth, az, dip }],          // dip raw (per file)
//   intervals: { bhid: [], from: [], to: [],
//                cols: [{ name, type: 'num'|'cat', values: [] }] }
// }
// opts = { dipConvention: 'auto'|'pos-down'|'neg-down', method }
function dhValidate(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention(tables.surveys || []);

  let joined = dhJoinHoles(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].iv = [];

  // intervals
  let iv = tables.intervals || { bhid: [], from: [], to: [], cols: [] };
  let nIv = iv.bhid.length;
  for (let ii = 0; ii < nIv; ii++) {
    let ib = String(iv.bhid[ii]).trim();
    let h2 = holes[ib];
    if (!h2) { hit('orphan-interval', 'Interval rows whose BHID has no collar (excluded)', ib); continue; }
    let f = iv.from[ii], t = iv.to[ii];
    if (!isFinite(f) || !isFinite(t) || f < 0 || t <= f) {
      hit('bad-interval', 'Interval rows with FROM ≥ TO, negative or non-numeric depths (excluded)', ib);
      continue;
    }
    h2.iv.push(ii);
  }

  // per-hole structure (normalize only the holes that have intervals)
  let ready = [];
  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.iv.length === 0) { hit('collar-no-intervals', 'Collars with no interval rows (hole skipped)', hh.bhid); continue; }

    dhNormalizeHoleStations(hh, dipConvention, hit);

    // interval-side past-EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.iv.length; ei++) {
        if (iv.to[hh.iv[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Survey or interval depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    // overlap flag (composited as-is; SUPPORT double-counts — flagged per hole)
    let idx = hh.iv.slice().sort(function(a, b) { return iv.from[a] - iv.from[b]; });
    for (let vi = 1; vi < idx.length; vi++) {
      if (iv.from[idx[vi]] < iv.to[idx[vi - 1]] - 1e-9) {
        hit('overlap', 'Holes with overlapping intervals (composited as-is; SUPPORT double-counts)', hh.bhid);
        break;
      }
    }
    hh.iv = idx;
    ready.push(hh);
  }

  return { holes: ready, checks: checks, dipConvention: dipConvention, intervals: iv };
}

// ── src/composite.js ──

// @gcu/drillhole — composite: fixed-length down-hole composites over validated holes.


// Tidied mode of (TO−FROM) — the default composite length (D3; a seed, always
// user-editable).
function dhDefaultLength(intervals) {
  let counts = {};
  let n = intervals.from.length; // only FROM/TO matter — callers may omit bhid
  for (let i = 0; i < n; i++) {
    let len = intervals.to[i] - intervals.from[i];
    if (!isFinite(len) || len <= 0) continue;
    let key = (Math.round(len * 100) / 100).toFixed(2); // 1cm buckets
    counts[key] = (counts[key] || 0) + 1;
  }
  let best = null, bestN = 0;
  for (let k in counts) { if (counts[k] > bestN) { bestN = counts[k]; best = parseFloat(k); } }
  return best || 1;
}

// Fixed-length down-hole composites over validated holes.
// opts = { length, domainColName|null, splitColNames|null, densityColName|null,
//          combine|null, minCoverage (0..1)|null, method }
// Numeric: length-weighted mean over covered length WITH a value (missing assays
// shrink that column's weight, never poison the mean; no value in the window → null).
// Categorical: majority by covered length (D6). SUPPORT = total covered length (D5:
// low coverage emitted, not dropped; the optional minCoverage filter is visible and
// counted). XYZ = the covered-length centroid depth on the desurveyed path.
function dhComposite(validated, opts) {
  let ivt = validated.intervals;
  let cols = ivt.cols || [];
  let L = opts.length;
  let densityIdx = -1;
  for (let dci = 0; dci < cols.length; dci++) {
    // optional mass weighting — numeric means weight by length × density (the density
    // column itself stays length-weighted). Missing density on an interval excludes it
    // from mass-weighting and is counted (never silent).
    if (opts.densityColName && cols[dci].name === opts.densityColName && cols[dci].type === 'num') densityIdx = dci;
  }
  // split columns — composites restart where the TUPLE of these columns changes (any
  // one flips → new composite). Generalizes the single domain break; falls back to
  // [domainColName] for back-compat. Each split column is constant within a run by
  // construction, so it rides into the output 1:1.
  let splitNames = (opts.splitColNames && opts.splitColNames.length) ? opts.splitColNames
    : (opts.domainColName ? [opts.domainColName] : []);
  let splitIdxs = [];
  for (let si = 0; si < splitNames.length; si++) {
    for (let sj = 0; sj < cols.length; sj++) { if (cols[sj].name === splitNames[si]) { splitIdxs.push(sj); break; } }
  }
  // per-column combine rules keyed by column name. Numeric: 'mean' (default,
  // length/mass-weighted), 'sum' (Σ length×value), 'min', 'max'. Categorical:
  // 'majority' (default, by covered length), 'first' (shallowest). An unknown rule for
  // a column's type falls back to that type's default.
  let combineMap = opts.combine || {};
  let checks = validated.checks;
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let header = ['BHID', 'X', 'Y', 'Z', 'FROM', 'TO', 'SUPPORT'];
  for (let hc = 0; hc < cols.length; hc++) header.push(cols[hc].name);
  let rows = [];

  for (let hI = 0; hI < validated.holes.length; hI++) {
    let hole = validated.holes[hI];
    let path = dhDesurveyHole(hole.collar, hole.stations, opts.method);
    let idx = hole.iv; // sorted by FROM

    // domain runs: contiguous spans sharing the split tuple (D4) — composites restart
    // at every change; without split columns the whole hole is one run. Run extent =
    // min(FROM)…max(TO) over the run (sorted by FROM, so max(TO) needs a scan — an
    // early long interval can outrun the last one).
    function makeRun(slice) {
      let maxTo = -Infinity;
      for (let mi = 0; mi < slice.length; mi++) maxTo = Math.max(maxTo, ivt.to[slice[mi]]);
      return { from: ivt.from[slice[0]], to: maxTo, idx: slice };
    }
    let SPLIT_SEP = String.fromCharCode(31);   // unit separator → no cross-column key collisions
    function splitKey(r2) {
      let parts = [];
      for (let sk = 0; sk < splitIdxs.length; sk++) parts.push(String(cols[splitIdxs[sk]].values[r2]));
      return parts.join(SPLIT_SEP);
    }
    let runs = [];
    if (!splitIdxs.length) {
      runs.push(makeRun(idx));
    } else {
      let runStart = 0, startKey = idx.length ? splitKey(idx[0]) : '';
      for (let ri = 1; ri <= idx.length; ri++) {
        let changed = ri === idx.length || splitKey(idx[ri]) !== startKey;
        if (changed) {
          runs.push(makeRun(idx.slice(runStart, ri)));
          runStart = ri;
          if (ri < idx.length) startKey = splitKey(idx[ri]);
        }
      }
    }

    for (let rI = 0; rI < runs.length; rI++) {
      let run = runs[rI];
      let nWin = Math.ceil((run.to - run.from - 1e-9) / L);
      for (let wI = 0; wI < nWin; wI++) {
        let w0 = run.from + wI * L; // index-stepped: no float drift over long holes
        let w1 = Math.min(w0 + L, run.to);
        let covered = 0, centroidW = 0, hadMissingDensity = false;
        let numW = new Float64Array(cols.length);
        let numSum = new Float64Array(cols.length);
        let numLSum = new Float64Array(cols.length);     // Σ length×value (for 'sum')
        let numMin = new Float64Array(cols.length);
        let numMax = new Float64Array(cols.length);
        let seenNum = new Uint8Array(cols.length);
        let catW = [], catFirst = []; // per col: {value → weight}, and first value by depth
        for (let ci2 = 0; ci2 < cols.length; ci2++) { catW.push(null); catFirst.push(undefined); numMin[ci2] = Infinity; numMax[ci2] = -Infinity; }

        for (let k2 = 0; k2 < run.idx.length; k2++) {
          let r = run.idx[k2];
          let ovFrom = Math.max(w0, ivt.from[r]);
          let ovTo = Math.min(w1, ivt.to[r]);
          let ov = ovTo - ovFrom;
          if (ov <= 1e-12) continue;
          covered += ov;
          centroidW += ov * (ovFrom + ovTo) / 2;
          // mass weight for numeric grades when a density column is set; the density
          // column itself stays length-weighted (no self-reference).
          let massW = ov;
          if (densityIdx >= 0) {
            let dval = cols[densityIdx].values[r];
            if (typeof dval === 'number' && isFinite(dval) && dval > 0) massW = ov * dval;
            else { massW = 0; hadMissingDensity = true; }
          }
          for (let c3 = 0; c3 < cols.length; c3++) {
            let v = cols[c3].values[r];
            if (cols[c3].type === 'num') {
              let nw = (c3 === densityIdx) ? ov : massW;   // density col: length-weighted
              if (typeof v === 'number' && isFinite(v)) {
                numW[c3] += nw; numSum[c3] += nw * v;       // weighted mean
                numLSum[c3] += ov * v;                       // length integral (sum)
                if (v < numMin[c3]) numMin[c3] = v;
                if (v > numMax[c3]) numMax[c3] = v;
                seenNum[c3] = 1;
              }
            } else {
              if (v != null && v !== '') {
                if (!catW[c3]) catW[c3] = {};
                let sk = String(v);
                catW[c3][sk] = (catW[c3][sk] || 0) + ov;
                if (catFirst[c3] === undefined) catFirst[c3] = sk;   // run is FROM-sorted → shallowest first
              }
            }
          }
        }
        if (covered <= 1e-12) continue; // window entirely in a gap — nothing to emit

        if (opts.minCoverage && covered / (w1 - w0) < opts.minCoverage) {
          hit('low-coverage-filtered', 'Composites below the min-coverage filter (dropped — filter is user-set)', hole.bhid);
          continue;
        }
        if (hadMissingDensity) hit('missing-density', 'Composites with intervals lacking usable density (excluded from mass-weighting)', hole.bhid);

        let midDepth = centroidW / covered;
        let pos = dhPositionAt(path, midDepth);
        let row = [hole.bhid, pos[0], pos[1], pos[2], w0, w1, covered];
        for (let c4 = 0; c4 < cols.length; c4++) {
          if (cols[c4].type === 'num') {
            let nrule = combineMap[cols[c4].name];
            if (nrule === 'sum') row.push(seenNum[c4] ? numLSum[c4] : null);
            else if (nrule === 'min') row.push(seenNum[c4] ? numMin[c4] : null);
            else if (nrule === 'max') row.push(seenNum[c4] ? numMax[c4] : null);
            else row.push(numW[c4] > 0 ? numSum[c4] / numW[c4] : null);   // 'mean' (default)
          } else {
            if (combineMap[cols[c4].name] === 'first') { row.push(catFirst[c4] !== undefined ? catFirst[c4] : null); continue; }
            let bag = catW[c4];
            if (!bag) { row.push(null); continue; }
            let bestV = null, bestW = -1, total = 0;
            for (let key2 in bag) { total += bag[key2]; if (bag[key2] > bestW) { bestW = bag[key2]; bestV = key2; } }
            if (bestW < total - 1e-9) hit('mixed-domain', 'Composites whose categorical majority is < 100% of covered length', hole.bhid);
            row.push(bestV);
          }
        }
        rows.push(row);
      }
    }
  }

  return { header: header, rows: rows };
}

// ── src/samples.js ──

// @gcu/drillhole — point-sample locator. Some data is point-support, not intervals:
// single-depth assays (handheld XRF, density readings) or already-composited samples
// re-imported. Compositing (length-weighting into windows) doesn't apply — you just
// want each sample placed in 3D on the desurveyed trace. This is that path; it reuses
// the same collar+survey join + station normalization as dhValidate.


// tables = { collars, surveys, samples: { bhid:[], depth:[], cols:[{name,type,values}] } }
// opts   = { dipConvention, method }
// Returns { header: ['BHID','X','Y','Z','DEPTH', ...cols], rows, report } — one located
// row per valid sample (sorted down-hole within each hole), with the same non-silent
// consistency report style as the interval pipeline.
function dhDesurveySamples(tables, opts) {
  opts = opts || {};
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id];
    if (!c) { c = checks[id] = { id: id, label: label, count: 0, bhids: [] }; }
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }

  let dipConvention = opts.dipConvention || 'auto';
  if (dipConvention === 'auto') dipConvention = dhDetectDipConvention(tables.surveys || []);

  let joined = dhJoinHoles(tables, dipConvention, hit);
  let holes = joined.holes, order = joined.order;
  for (let oi = 0; oi < order.length; oi++) holes[order[oi]].smp = [];

  // samples → per-hole index lists
  let smp = tables.samples || { bhid: [], depth: [], cols: [] };
  let cols = smp.cols || [];
  let nS = smp.bhid.length;
  for (let ii = 0; ii < nS; ii++) {
    let bid = String(smp.bhid[ii]).trim();
    let h = holes[bid];
    if (!h) { hit('orphan-sample', 'Sample rows whose BHID has no collar (excluded)', bid); continue; }
    let d = smp.depth[ii];
    if (!isFinite(d) || d < 0) { hit('bad-sample', 'Sample rows with negative or non-numeric depth (excluded)', bid); continue; }
    h.smp.push(ii);
  }

  let header = ['BHID', 'X', 'Y', 'Z', 'DEPTH'];
  for (let hc = 0; hc < cols.length; hc++) header.push(cols[hc].name);
  let rows = [];
  let nHoles = 0;

  for (let oi = 0; oi < order.length; oi++) {
    let hh = holes[order[oi]];
    if (hh.smp.length === 0) { hit('collar-no-samples', 'Collars with no sample rows (hole skipped)', hh.bhid); continue; }
    dhNormalizeHoleStations(hh, dipConvention, hit);
    let path = dhDesurveyHole(hh.collar, hh.stations, opts.method);
    nHoles++;

    // EOH advisory (kept, counted)
    if (hh.eoh != null) {
      for (let ei = 0; ei < hh.smp.length; ei++) {
        if (smp.depth[hh.smp[ei]] > hh.eoh + 1e-9) {
          hit('past-eoh', 'Sample depths past the collar EOH (kept — EOH is advisory)', hh.bhid);
          break;
        }
      }
    }

    let idx = hh.smp.slice().sort(function(a, b) { return smp.depth[a] - smp.depth[b]; });
    for (let k = 0; k < idx.length; k++) {
      let ii = idx[k], d = smp.depth[ii];
      let pos = dhPositionAt(path, d);
      let row = [hh.bhid, pos[0], pos[1], pos[2], d];
      for (let c = 0; c < cols.length; c++) row.push(cols[c].values[ii]);
      rows.push(row);
    }
  }

  let checkList = [];
  for (let k in checks) checkList.push(checks[k]);
  return { header: header, rows: rows, report: { checks: checkList, nHoles: nHoles, nSamples: rows.length, dipConvention: dipConvention } };
}

// ── src/merge.js ──

// @gcu/drillhole — merge: the down-hole interval join (A11 P4).
//
// Merge two down-hole interval tables on (BHID, FROM/TO) where their breaks need not
// align. UNION RE-SEGMENT (the design default): the merged breaks per hole are the
// sorted union of both tables' FROM/TO, so every output segment lies within at most
// ONE interval of each table — columns are CARRIED verbatim, no aggregation. A segment
// with no counterpart on one side null-fills that side's columns and is COUNTED (never
// a silent drop); a segment covered by neither is not a real interval and is skipped.
// Overlapping intervals within one table over a segment are flagged (first wins).
// Column-name clashes between the tables are renamed (suffix tagB) and counted.
//
// Inputs are the columnar interval shape { bhid:[], from:[], to:[],
// cols:[{name,type,values}] } (same as validate().intervals). Returns the merged table
// in that shape + a { checks, nRows, nHoles } report. Pure; no aggregation rules here —
// those belong to compositing, which runs on the merged table.
function dhMergeIntervals(A, B, opts) {
  opts = opts || {};
  let tagB = opts.tagB || '2';
  let checks = {};
  function hit(id, label, bhid) {
    let c = checks[id] || (checks[id] = { id: id, label: label, count: 0, bhids: [] });
    c.count++;
    if (bhid != null && c.bhids.indexOf(bhid) < 0 && c.bhids.length < 200) c.bhids.push(bhid);
  }
  function groupByHole(T) {
    let g = {};
    for (let i = 0; i < T.bhid.length; i++) (g[T.bhid[i]] || (g[T.bhid[i]] = [])).push(i);
    return g;
  }
  // covering intervals of table T (index list idxList) at down-hole midpoint mid
  function covering(T, idxList, mid) {
    let out = [];
    for (let i = 0; i < idxList.length; i++) {
      let r = idxList[i];
      if (T.from[r] <= mid && mid <= T.to[r]) out.push(r);
    }
    return out;
  }

  // merged column layout: A's columns keep their names; a B column clashing with an
  // existing name gets suffixed (and counted).
  let used = {}, outCols = [];
  for (let a = 0; a < A.cols.length; a++) { used[A.cols[a].name] = true; outCols.push({ name: A.cols[a].name, type: A.cols[a].type, side: 'A', src: a }); }
  for (let b = 0; b < B.cols.length; b++) {
    let nm = B.cols[b].name;
    if (used[nm]) { let nn = nm + '_' + tagB, kk = 2; while (used[nn]) nn = nm + '_' + tagB + (kk++); hit('column-collision', 'Columns renamed to avoid a clash with the other table', null); nm = nn; }
    used[nm] = true;
    outCols.push({ name: nm, type: B.cols[b].type, side: 'B', src: b });
  }

  let gA = groupByHole(A), gB = groupByHole(B);
  let holeOrder = [], seen = {};
  for (let ai = 0; ai < A.bhid.length; ai++) if (!seen[A.bhid[ai]]) { seen[A.bhid[ai]] = true; holeOrder.push(A.bhid[ai]); }
  for (let bi = 0; bi < B.bhid.length; bi++) if (!seen[B.bhid[bi]]) { seen[B.bhid[bi]] = true; holeOrder.push(B.bhid[bi]); }

  let outBhid = [], outFrom = [], outTo = [];
  let outVals = outCols.map(function() { return []; });

  for (let ho = 0; ho < holeOrder.length; ho++) {
    let hole = holeOrder[ho];
    let ia = gA[hole] || [], ib = gB[hole] || [];
    if (!ia.length) hit('hole-only-b', 'Holes only in the second table (first-table columns null)', hole);
    if (!ib.length) hit('hole-only-a', 'Holes only in the first table (second-table columns null)', hole);

    let bps = [];
    for (let x = 0; x < ia.length; x++) { bps.push(A.from[ia[x]]); bps.push(A.to[ia[x]]); }
    for (let y = 0; y < ib.length; y++) { bps.push(B.from[ib[y]]); bps.push(B.to[ib[y]]); }
    bps.sort(function(p, q) { return p - q; });
    let uniq = [];
    for (let u = 0; u < bps.length; u++) if (!uniq.length || bps[u] - uniq[uniq.length - 1] > 1e-9) uniq.push(bps[u]);

    for (let s = 0; s + 1 < uniq.length; s++) {
      let a0 = uniq[s], a1 = uniq[s + 1];
      if (a1 - a0 <= 1e-9) continue;
      let mid = (a0 + a1) / 2;
      let ca = covering(A, ia, mid), cb = covering(B, ib, mid);
      if (ca.length > 1) hit('overlap-a', 'Merged segments covered by overlapping first-table intervals (first wins)', hole);
      if (cb.length > 1) hit('overlap-b', 'Merged segments covered by overlapping second-table intervals (first wins)', hole);
      let ra = ca.length ? ca[0] : -1, rb = cb.length ? cb[0] : -1;
      if (ra < 0 && rb < 0) continue;   // gap on both sides — not a real interval
      if (ra < 0) hit('gap-a', 'Merged segments with no first-table interval (its columns null)', hole);
      if (rb < 0) hit('gap-b', 'Merged segments with no second-table interval (its columns null)', hole);
      outBhid.push(hole); outFrom.push(a0); outTo.push(a1);
      for (let oc = 0; oc < outCols.length; oc++) {
        let col = outCols[oc];
        let src = col.side === 'A' ? ra : rb, T = col.side === 'A' ? A : B;
        outVals[oc].push(src >= 0 ? T.cols[col.src].values[src] : null);
      }
    }
  }

  let cols = outCols.map(function(c, i) { return { name: c.name, type: c.type, values: outVals[i] }; });
  let checkList = []; for (let ck in checks) checkList.push(checks[ck]);
  return { bhid: outBhid, from: outFrom, to: outTo, cols: cols,
    report: { checks: checkList, nRows: outBhid.length, nHoles: holeOrder.length } };
}

// ── src/process.js ──

// @gcu/drillhole — process: the one-call pipeline (validate → desurvey → composite).
// What BMA's ingestion calls; everything else is exposed for tests and reuse.


// Returns { header, rows, report }.
function dhProcess(tables, opts) {
  opts = opts || {};
  let validated = dhValidate(tables, opts);
  let length = (typeof opts.compositeLength === 'number' && opts.compositeLength > 0)
    ? opts.compositeLength
    : dhDefaultLength(validated.intervals);
  let result = dhComposite(validated, {
    length: length,
    method: opts.method || 'minimumCurvature',
    domainColName: opts.domainCol || null,
    splitColNames: opts.splitCols || null,
    densityColName: opts.densityCol || null,
    combine: opts.combine || null,
    minCoverage: opts.minCoverage || null,
  });
  let checkList = [];
  for (let k in validated.checks) checkList.push(validated.checks[k]);
  return {
    header: result.header,
    rows: result.rows,
    report: {
      checks: checkList,
      nHoles: validated.holes.length,
      nComposites: result.rows.length,
      dipConvention: validated.dipConvention,
      compositeLength: length,
    },
  };
}

// ── src/qa.js ──

// @gcu/drillhole — qa: the drillhole QA report, ROW by row. validate (validate.js)
// counts what it excludes per hole; this names every row a reviewer has to look
// at — which table, which row, which depths, what's wrong — before anything is
// estimated from the holes. Nothing here changes a table: it reads and reports.
//
// tables = {
//   collars:   [{ bhid, x, y, z, eoh, row }],          // blanks as NaN — NOT pre-dropped
//   surveys:   [{ bhid, depth, az, dip, row }],        // dip raw (per file)
//   intervals: [{ name, bhid: [], from: [], to: [], rows?: [] }],   // one or more tables
// }
// opts = {
//   dipConvention: 'auto' | 'pos-down' | 'neg-down',
//   doglegMax: 10,      // °/30 length-units between consecutive stations (dogleg severity)
//   gapMin: 0.001,      // a gap between consecutive intervals shorter than this is a join
//   extrapMax: 30,      // an interval deeper than the deepest survey by more than this
// }
// → { findings: [{ check, severity, table, row, bhid, from, to, detail }],
//     summary: [{ check, label, severity, count, holes }], holes, dipConvention, tables }
// `row` is the 0-based data row of `table` (null for a whole-hole finding); `from`/`to`
// are the depths involved (a station's depth rides in `from`). Findings come in table
// order (collars, surveys, then each interval table), rows ascending within a check.


const DH_QA_CHECKS = {
  'collar-no-bhid': ['error', 'collar rows with no hole ID'],
  'collar-blank-xyz': ['error', 'collars with a blank or non-numeric X/Y/Z (dropped)'],
  'collar-dup': ['error', 'duplicate collar hole IDs (the first is kept)'],
  'collar-eoh-bad': ['warn', 'collars with an end-of-hole depth ≤ 0'],
  'hole-no-survey': ['warn', 'holes with no usable survey (desurveyed straight down)'],
  'hole-no-intervals': ['info', 'holes with no rows in an interval table'],
  'survey-orphan': ['error', 'survey rows whose hole has no collar'],
  'survey-blank': ['error', 'survey rows with a blank or non-numeric depth / azimuth / dip (dropped)'],
  'survey-depth-neg': ['error', 'survey rows with a negative depth'],
  'survey-dip-range': ['error', 'survey rows with |dip| > 90°'],
  'survey-az-range': ['warn', 'survey rows with an azimuth outside 0–360° (read modulo 360)'],
  'survey-dup-depth': ['warn', 'survey stations at the same depth in a hole (the last is kept)'],
  'survey-dogleg': ['warn', 'survey intervals bending faster than the dogleg limit'],
  'survey-past-eoh': ['warn', 'survey stations deeper than the collar end of hole'],
  'interval-orphan': ['error', 'interval rows whose hole has no collar'],
  'interval-blank': ['error', 'interval rows with a blank or non-numeric FROM / TO (not placed)'],
  'interval-negative': ['error', 'interval rows with a negative depth'],
  'interval-inverted': ['error', 'interval rows with FROM ≥ TO'],
  'interval-overlap': ['error', 'intervals overlapping an earlier one in the same hole'],
  'interval-gap': ['warn', 'gaps between consecutive intervals in a hole'],
  'interval-past-eoh': ['warn', 'intervals deeper than the collar end of hole'],
  'interval-past-survey': ['info', 'intervals well past the deepest survey station (extrapolated along it)'],
  'value-text': ['warn', 'interval columns of numbers holding some text (read as blank)'],
};

// findings → one line per check that fired, in DH_QA_CHECKS order (a caller adding
// its own findings, e.g. a values census, re-summarizes with this)
function dhQaSummary(findings) {
  let by = new Map();
  for (let fi = 0; fi < findings.length; fi++) {
    let f = findings[fi], s = by.get(f.check);
    if (!s) by.set(f.check, s = { check: f.check, label: DH_QA_CHECKS[f.check][1], severity: DH_QA_CHECKS[f.check][0], count: 0, holes: new Set() });
    s.count++;
    if (f.bhid) s.holes.add(f.bhid);
  }
  return Object.keys(DH_QA_CHECKS).filter(function(k) { return by.has(k); }).map(function(k) { let s = by.get(k); return { check: s.check, label: s.label, severity: s.severity, count: s.count, holes: s.holes.size }; });
}

function dhQa(tables, opts) {
  opts = opts || {};
  let doglegMax = opts.doglegMax != null ? opts.doglegMax : 10;
  let gapMin = opts.gapMin != null ? opts.gapMin : 0.001;
  let extrapMax = opts.extrapMax != null ? opts.extrapMax : 30;
  let findings = [];
  function add(check, table, row, bhid, from, to, detail) {
    findings.push({ check: check, severity: DH_QA_CHECKS[check][0], table: table, row: row, bhid: bhid, from: from, to: to, detail: detail || '' });
  }
  let fmt = function(v) { return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '—'; };
  let idOf = function(v) { return v == null ? '' : String(v).trim(); };

  // ── collars ──
  let holes = new Map();                                  // bhid → { row, eoh, stations: [], deepest }
  let dropped = new Set();                                // a collar that couldn't be placed: its rows aren't orphans too
  let collars = tables.collars || [];
  for (let ci = 0; ci < collars.length; ci++) {
    let c = collars[ci], row = c.row != null ? c.row : ci, id = idOf(c.bhid);
    if (!id) { add('collar-no-bhid', 'collar', row, '', null, null); continue; }
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) {
      let which = ['x', 'y', 'z'].filter(function(k) { return !Number.isFinite(c[k]); }).join('/').toUpperCase();
      add('collar-blank-xyz', 'collar', row, id, null, null, which + ' blank');
      if (!holes.has(id)) dropped.add(id);
      continue;
    }
    if (holes.has(id)) { add('collar-dup', 'collar', row, id, null, null, 'first at row ' + (holes.get(id).row + 1)); continue; }
    let eoh = Number.isFinite(c.eoh) ? c.eoh : null;
    if (eoh != null && eoh <= 0) add('collar-eoh-bad', 'collar', row, id, eoh, null, 'EOH ' + fmt(eoh));
    holes.set(id, { row: row, eoh: eoh != null && eoh > 0 ? eoh : null, stations: [] });
  }

  // ── surveys ──
  let surveys = tables.surveys || [];
  let conv = opts.dipConvention && opts.dipConvention !== 'auto' ? opts.dipConvention
    : dhDetectDipConvention(surveys.filter(function(s) { return Number.isFinite(s.dip); }));
  let flip = conv === 'neg-down' ? -1 : 1;
  for (let si = 0; si < surveys.length; si++) {
    let s = surveys[si], row = s.row != null ? s.row : si, id = idOf(s.bhid);
    let h = holes.get(id);
    if (!h && dropped.has(id)) continue;                  // reported once, at its collar
    if (!h) { add('survey-orphan', 'survey', row, id, Number.isFinite(s.depth) ? s.depth : null, null); continue; }
    let blank = [['depth', s.depth], ['azimuth', s.az], ['dip', s.dip]].filter(function(p) { return !Number.isFinite(p[1]); }).map(function(p) { return p[0]; });
    if (blank.length) { add('survey-blank', 'survey', row, id, Number.isFinite(s.depth) ? s.depth : null, null, blank.join(' / ') + ' blank'); continue; }
    if (s.depth < 0) { add('survey-depth-neg', 'survey', row, id, s.depth, null, 'depth ' + fmt(s.depth)); continue; }
    if (Math.abs(s.dip) > 90.000001) { add('survey-dip-range', 'survey', row, id, s.depth, null, 'dip ' + fmt(s.dip)); continue; }
    if (s.az < 0 || s.az > 360) add('survey-az-range', 'survey', row, id, s.depth, null, 'azimuth ' + fmt(s.az));
    if (h.eoh != null && s.depth > h.eoh + 1e-9) add('survey-past-eoh', 'survey', row, id, s.depth, null, 'station at ' + fmt(s.depth) + ', EOH ' + fmt(h.eoh));
    h.stations.push({ depth: s.depth, az: s.az, dip: s.dip * flip, row: row });
  }
  for (let [id, h] of holes) {
    if (!h.stations.length) { add('hole-no-survey', 'collar', h.row, id, null, null); h.deepest = 0; continue; }
    h.stations.sort(function(a, b) { return a.depth - b.depth || a.row - b.row; });
    let kept = [];
    for (let k = 0; k < h.stations.length; k++) {
      let st = h.stations[k], prev = kept[kept.length - 1];
      if (prev && Math.abs(prev.depth - st.depth) < 1e-9) {
        add('survey-dup-depth', 'survey', st.row, id, st.depth, null, 'same depth as row ' + (prev.row + 1));
        kept[kept.length - 1] = st;                       // last wins, as normalizeSurveys does
      } else kept.push(st);
    }
    for (let k = 1; k < kept.length; k++) {
      let a = kept[k - 1], b = kept[k];
      let ta = dhTangent(a.az, a.dip), tb = dhTangent(b.az, b.dip);
      let cos = Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1] + ta[2] * tb[2]));
      let deg = Math.acos(cos) * 180 / Math.PI, dls = deg * 30 / (b.depth - a.depth);
      if (dls > doglegMax) add('survey-dogleg', 'survey', b.row, id, a.depth, b.depth, fmt(deg) + '° over ' + fmt(b.depth - a.depth) + ' (' + fmt(dls) + '°/30, limit ' + fmt(doglegMax) + ')');
    }
    h.deepest = kept[kept.length - 1].depth;
  }

  // ── interval tables ──
  let ivTables = tables.intervals || [];
  for (let ti = 0; ti < ivTables.length; ti++) {
    let iv = ivTables[ti], name = iv.name || 'intervals' + (ivTables.length > 1 ? ' ' + (ti + 1) : '');
    let per = new Map();                                  // bhid → [row index]
    for (let i = 0; i < iv.bhid.length; i++) {
      let row = iv.rows ? iv.rows[i] : i, id = idOf(iv.bhid[i]), f = iv.from[i], t = iv.to[i];
      let fv = Number.isFinite(f) ? f : null, tv = Number.isFinite(t) ? t : null;
      if (!holes.has(id) && dropped.has(id)) continue;
      if (!holes.has(id)) { add('interval-orphan', name, row, id, fv, tv); continue; }
      if (fv == null || tv == null) { add('interval-blank', name, row, id, fv, tv, [fv == null ? 'FROM' : '', tv == null ? 'TO' : ''].filter(Boolean).join(' / ') + ' blank'); continue; }
      if (f < 0 || t < 0) { add('interval-negative', name, row, id, f, t); continue; }
      if (f >= t) { add('interval-inverted', name, row, id, f, t, f === t ? 'zero length' : 'FROM > TO'); continue; }
      let l = per.get(id); if (!l) per.set(id, l = []);
      l.push(i);
    }
    for (let [id, h] of holes) {
      let l = per.get(id);
      if (!l) { add('hole-no-intervals', name, null, id, null, null, 'collar row ' + (h.row + 1)); continue; }
      l.sort(function(a, b) { return iv.from[a] - iv.from[b] || iv.to[a] - iv.to[b] || a - b; });
      let reach = -Infinity, reachAt = -1, pastEoh = false, pastSurvey = false;
      for (let k = 0; k < l.length; k++) {
        let i = l[k], row = iv.rows ? iv.rows[i] : i, f = iv.from[i], t = iv.to[i];
        if (k > 0 && f < reach - 1e-9) {
          let j = l[reachAt], jr = iv.rows ? iv.rows[j] : j;
          add('interval-overlap', name, row, id, f, t, 'overlaps row ' + (jr + 1) + ' (' + fmt(iv.from[j]) + '–' + fmt(iv.to[j]) + ')');
        } else if (k > 0 && f - reach > gapMin) add('interval-gap', name, row, id, reach, f, 'no interval for ' + fmt(f - reach));
        if (t > reach) { reach = t; reachAt = k; }
        if (!pastEoh && h.eoh != null && t > h.eoh + 1e-9) { pastEoh = true; add('interval-past-eoh', name, row, id, f, t, 'TO ' + fmt(t) + ', EOH ' + fmt(h.eoh)); }
        if (!pastSurvey && h.stations.length && t - h.deepest > extrapMax) { pastSurvey = true; add('interval-past-survey', name, row, id, f, t, 'deepest survey at ' + fmt(h.deepest) + ', ' + fmt(t - h.deepest) + ' past it'); }
      }
    }
  }

  return {
    findings: findings, summary: dhQaSummary(findings), holes: holes.size, dipConvention: conv,
    tables: { collars: collars.length, surveys: surveys.length, intervals: ivTables.map(function(t) { return { name: t.name || null, rows: t.bhid.length }; }) },
  };
}

// ── src/main.js ──

// @gcu/drillhole — public surface (the @gcu/build manifest). Clean named exports,
// matching the other GCU packages: `const dh = await load("@gcu/drillhole"); dh.process(...)`.
// The internal `dh*` names (a bma concat-IIFE artifact) and the private hole-join
// helpers (dhJoinHoles / dhNormalizeHoleStations) stay module-scoped — they're still
// bundled (validate/samples import them), just not part of the public API.
//
//   desurvey.js — tangent, detectDipConvention, normalizeSurveys, desurveyHole, positionAt
//   validate.js — validate (join + consistency report)
//   composite.js — defaultLength, composite (fixed-length, length/mass-weighted, split-aware)
//   samples.js   — desurveySamples (point-support locator)
//   merge.js     — mergeIntervals (down-hole union re-segment join)
//   process.js   — process (validate → desurvey → composite, one call)
//   qa.js        — qa (the row-by-row QA report: every row a reviewer must look at)

export {
  dhTangent as tangent,
  dhDetectDipConvention as detectDipConvention,
  dhNormalizeSurveys as normalizeSurveys,
  dhDesurveyHole as desurveyHole,
  dhPositionAt as positionAt,
  dhValidate as validate,
  dhDefaultLength as defaultLength,
  dhComposite as composite,
  dhDesurveySamples as desurveySamples,
  dhMergeIntervals as mergeIntervals,
  dhProcess as process,
  dhQa as qa,
  dhQaSummary as qaSummary,
  DH_QA_CHECKS as QA_CHECKS,
};
