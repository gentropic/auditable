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

import { dhTangent, dhDetectDipConvention } from './desurvey.js';

export const DH_QA_CHECKS = {
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
export function dhQaSummary(findings) {
  let by = new Map();
  for (let fi = 0; fi < findings.length; fi++) {
    let f = findings[fi], s = by.get(f.check);
    if (!s) by.set(f.check, s = { check: f.check, label: DH_QA_CHECKS[f.check][1], severity: DH_QA_CHECKS[f.check][0], count: 0, holes: new Set() });
    s.count++;
    if (f.bhid) s.holes.add(f.bhid);
  }
  return Object.keys(DH_QA_CHECKS).filter(function(k) { return by.has(k); }).map(function(k) { let s = by.get(k); return { check: s.check, label: s.label, severity: s.severity, count: s.count, holes: s.holes.size }; });
}

export function dhQa(tables, opts) {
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
