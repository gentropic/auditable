// @gcu/condenser — drillhole provider: collar + survey + interval tables →
// desurveyed interval midpoints as an element layer (micro-layers spec §5).
// The math is @gcu/drillhole's (minimum curvature / balanced tangential /
// tangential, dip-convention detection, the non-silent consistency report);
// this module is table intake + the identity plumbing.
//
// THE IDENTITY: record N == interval-table row N. desurveySamples returns
// rows depth-sorted per hole, so a hidden __row column threads the original
// row index through — recIdx survives the sort, and pick/measure/filter all
// join back to the source assay row.
//
// Tables are read FULLY into memory (drillhole files are 10³–10⁶ rows — the
// streaming machinery is for the 10⁸ element tables), which also makes
// fetchRecord O(1) and channel switches free.

import { dhDesurveySamples } from '../../../drillhole/src/samples.js';
import { dhValidate } from '../../../drillhole/src/validate.js';
import { sniffDelimited, lineFields } from './blockmodel.js';
import { coordNum } from './delimited.js';
import { qualifiedNumber, censusQualified, QUALIFIED_DEFAULT } from './qualified.js';

const BHID_RE = /^(bhid|holeid|hole_?id|dhid|dh_?id|hole|collar_?id|id)$/i;
const X_RE = /^(x|xc|xcollar|east(ing)?|utm_?e)$/i;
const Y_RE = /^(y|yc|ycollar|north(ing)?|utm_?n)$/i;
const Z_RE = /^(z|zc|zcollar|elev(ation)?|rl)$/i;
const AT_RE = /^(at|depth|dist(ance)?|md|measured_?depth)$/i;
const AZ_RE = /^(az|azm|azim(uth)?|brg|bearing)$/i;
const DIP_RE = /^(dip|incl(ination)?|plunge)$/i;
const FROM_RE = /^(from|depfrom|depth_?from|de)$/i;
const TO_RE = /^(to|depto|depth_?to|a)$/i;
const EOH_RE = /^(eoh|depth|maxdepth|max_?depth|td|total_?depth|length)$/i;

const find = (header, re) => header.findIndex((h) => re.test(String(h).trim()));

// Classify one delimited header as collar / survey / intervals (or null).
// Survey and intervals are keyed on their unambiguous columns (AZ+DIP / FROM+TO);
// collar is BHID + coordinates. Returns { role, mapping }.
export function classifyDrillholeHeader(header) {
  if (!header) return null;
  const bhid = find(header, BHID_RE);
  if (bhid < 0) return null;
  const from = find(header, FROM_RE), to = find(header, TO_RE);
  if (from >= 0 && to >= 0) return { role: 'intervals', mapping: { bhid, from, to } };
  const az = find(header, AZ_RE), dip = find(header, DIP_RE), at = find(header, AT_RE);
  if (az >= 0 && dip >= 0) return { role: 'survey', mapping: { bhid, at: at >= 0 ? at : -1, az, dip } };
  const x = find(header, X_RE), y = find(header, Y_RE), z = find(header, Z_RE);
  if (x >= 0 && y >= 0 && z >= 0) {
    let eoh = -1;
    header.forEach((h, i) => { if (eoh < 0 && i !== x && i !== y && i !== z && EOH_RE.test(String(h).trim())) eoh = i; });
    return { role: 'collar', mapping: { bhid, x, y, z, eoh } };
  }
  return null;
}

// Read a delimited blob fully: { columns, rows } (field arrays, header skipped).
export async function readDelimited(blob, { sample = 256 * 1024 } = {}) {
  const head = await blob.slice(0, Math.min(sample, blob.size)).text();
  const sniff = sniffDelimited(head);
  if (!sniff.header) throw new Error('drillholes: table has no header row');
  const rows = [];
  for await (const batch of lineFields(blob, sniff.delim, true)) {
    for (const f of batch) rows.push(f);
  }
  return { columns: sniff.header.map((c) => String(c).trim()), rows };
}

// Sniff a set of blobs into drillhole roles. Returns { collar, survey,
// intervals } of { blob, name, columns, mapping } when all three distinct
// roles are present, else null.
export async function sniffDrillholeFiles(files) {
  const out = {};
  for (const f of files) {
    let sniff;
    try { sniff = sniffDelimited(await f.slice(0, 64 * 1024).text()); } catch { continue; }
    const cls = classifyDrillholeHeader(sniff.header);
    if (cls && !out[cls.role]) out[cls.role] = { blob: f, name: f.name || cls.role, columns: sniff.header.map((c) => String(c).trim()), mapping: cls.mapping };
  }
  return out.collar && out.survey && out.intervals ? out : null;
}

/**
 * openDrillholes({ collar, survey, intervals }, opts) — each input is a Blob.
 * opts: mappings { collar: {bhid,x,y,z,eoh}, survey: {bhid,at,az,dip},
 * intervals: {bhid,from,to} } (sniffed when omitted), method
 * ('minimumCurvature' | 'balancedTangential' | 'tangential'), dipConvention
 * ('auto' | 'pos-down' | 'neg-down'), chan (interval column index for the
 * grade channel; default = first numeric non-key column), cat (category
 * column index; default = first all-text non-key column).
 *
 * → { header, streamChunks, fetchRecord }
 *   header = { kind:'drillholes', count (ORIGINAL interval rows), bbox,
 *              columns, mapping {chan, cat}, numericColumns, categories,
 *              attributes, report, method, dipConvention, holes }
 *   RawChunk = { count, x, y, z, chan, cat, recIdx } (blockmodel shape —
 *              the page's centroids-as-points path renders it)
 *   fetchRecord(rec) → the ORIGINAL interval row (O(1), in memory)
 */
// A BLANK IS NO NUMBER (the CSV coordinate rule, 9f295586): `+''` is 0, which put
// a collar at the origin, bent a survey horizontal at a blank dip (or north at a
// blank azimuth), and started an interval at the collar on a blank FROM. Rows like
// that are DROPPED and REPORTED — a check on header.report, shown with the others:
//   a collar with a blank X/Y/Z      → dropped (its intervals report as no-collar)
//   a survey station with a blank depth/azimuth/dip → dropped (the hole
//                                      interpolates across it)
//   an interval with a blank FROM/TO → not placed (still a record, not drawn)
//   a blank EOH                      → no EOH (the deepest station / interval TO)
// A collar keeps its file ROW (`row`): a trace's record is the collar row.
function blankCheck(checks, id, label, bhids) {
  if (!bhids.length) return;
  checks.push({ id, label, count: bhids.length, bhids: [...new Set(bhids.map((b) => String(b ?? '')))].slice(0, 200) });
}
export function parseCollars(t, mc) {
  const collars = [], blank = [];
  t.rows.forEach((r, row) => {
    const x = coordNum(r[mc.x]), y = coordNum(r[mc.y]), z = coordNum(r[mc.z]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { blank.push(r[mc.bhid]); return; }
    const e = mc.eoh != null && mc.eoh >= 0 ? coordNum(r[mc.eoh]) : NaN;
    collars.push({ bhid: r[mc.bhid], x, y, z, eoh: Number.isFinite(e) ? e : undefined, row });
  });
  return { collars, blank };
}
export function parseSurveys(t, ms) {
  const surveys = [], blank = [];
  for (const r of t.rows) {
    const depth = ms.at != null && ms.at >= 0 ? coordNum(r[ms.at]) : 0, az = coordNum(r[ms.az]), dip = coordNum(r[ms.dip]);
    if (!Number.isFinite(depth) || !Number.isFinite(az) || !Number.isFinite(dip)) { blank.push(r[ms.bhid]); continue; }
    surveys.push({ bhid: r[ms.bhid], depth, az, dip });
  }
  return { surveys, blank };
}
export async function openDrillholes({ collar, survey, intervals }, opts = {}) {
  const tCollar = await readDelimited(collar);
  const tSurvey = await readDelimited(survey);
  const tIv = await readDelimited(intervals);
  const m = {
    collar: (opts.mappings && opts.mappings.collar) || (classifyDrillholeHeader(tCollar.columns) || {}).mapping,
    survey: (opts.mappings && opts.mappings.survey) || (classifyDrillholeHeader(tSurvey.columns) || {}).mapping,
    intervals: (opts.mappings && opts.mappings.intervals) || (classifyDrillholeHeader(tIv.columns) || {}).mapping,
  };
  if (!m.collar || m.collar.x == null) throw new Error('drillholes: collar columns not identified (need BHID + X/Y/Z)');
  if (!m.survey || m.survey.az == null) throw new Error('drillholes: survey columns not identified (need BHID + AZ + DIP)');
  if (!m.intervals || m.intervals.from == null) throw new Error('drillholes: interval columns not identified (need BHID + FROM + TO)');

  // @gcu/drillhole table shapes — blanks dropped and reported (see parseCollars)
  const { collars, blank: blankCollars } = parseCollars(tCollar, m.collar);
  const { surveys, blank: blankSurveys } = parseSurveys(tSurvey, m.survey);
  const collarOfRow = new Map(collars.map((c) => [c.row, c]));

  const n = tIv.rows.length;
  const keyCols = new Set([m.intervals.bhid, m.intervals.from, m.intervals.to]);
  // numeric / categorical detection over a head sample of the interval table
  const probe = tIv.rows.slice(0, 200);
  const numericCols = [], textCols = [], qualifiedCols = [];
  tIv.columns.forEach((name, i) => {
    if (keyCols.has(i)) return;
    const vals = probe.map((r) => (r[i] || '').trim()).filter(Boolean);
    if (!vals.length) return;
    const cq = censusQualified(vals);                     // <0.001, >10 and lab codes count as numeric
    if (cq.numeric) numericCols.push({ i, name });
    else if (cq.num + cq.below + cq.above === 0) textCols.push({ i, name });
    if (cq.qualified) qualifiedCols.push({ i, name, below: cq.below, above: cq.above, code: cq.code });
  });
  const chan = opts.chan != null ? opts.chan : (numericCols[0] ? numericCols[0].i : null);
  const catCol = opts.cat != null ? opts.cat : (textCols[0] ? textCols[0].i : null);
  // opts.qualify = { [column name]: policy } — the channel's <x / >x rule (default <x → x/2)
  const chanPolicy = (chan != null && opts.qualify && opts.qualify[tIv.columns[chan]]) || QUALIFIED_DEFAULT;

  // samples = BOTH interval endpoints (2 per row): the desurveyed FROM and TO
  // positions are the capsule segment, arc-correct via positionAt; the render
  // midpoint derives as (A+B)/2. __row + __end thread the source row and
  // which endpoint through the per-hole depth sort (the identity).
  const fromOf = new Float64Array(n), toOf = new Float64Array(n), blankIv = [];
  for (let i = 0; i < n; i++) {
    const r = tIv.rows[i];
    fromOf[i] = coordNum(r[m.intervals.from]); toOf[i] = coordNum(r[m.intervals.to]);
    if (!Number.isFinite(fromOf[i]) || !Number.isFinite(toOf[i])) blankIv.push(r[m.intervals.bhid]);
  }
  const nS = n - blankIv.length;
  const bhid = new Array(2 * nS), depth = new Float64Array(2 * nS);
  const rowIdx = new Float64Array(2 * nS), endIdx = new Float64Array(2 * nS);
  const chanVals = new Float64Array(n), catVals = catCol != null ? new Array(n) : null;
  const catCounts = new Map();
  const iv = { bhid: [], from: [], to: [], cols: [] };     // ONE entry per placeable row, for validate + the section paths
  for (let i = 0, s2 = 0; i < n; i++) {
    const r = tIv.rows[i];
    chanVals[i] = chan != null ? qualifiedNumber(r[chan], chanPolicy) : 0;
    if (catVals) { const v = (r[catCol] || '').trim(); catVals[i] = v; if (v && catCounts.size <= 256) catCounts.set(v, (catCounts.get(v) || 0) + 1); }
    if (!Number.isFinite(fromOf[i]) || !Number.isFinite(toOf[i])) continue;
    const hb = r[m.intervals.bhid];
    bhid[2 * s2] = hb; bhid[2 * s2 + 1] = hb;
    depth[2 * s2] = fromOf[i]; depth[2 * s2 + 1] = toOf[i];
    rowIdx[2 * s2] = i; rowIdx[2 * s2 + 1] = i;
    endIdx[2 * s2] = 0; endIdx[2 * s2 + 1] = 1;
    iv.bhid.push(hb); iv.from.push(fromOf[i]); iv.to.push(toOf[i]);
    s2++;
  }
  const samples = { bhid, depth, cols: [{ name: '__row', values: rowIdx }, { name: '__end', values: endIdx }] };

  const ds = dhDesurveySamples({ collars, surveys, samples }, { method: opts.method || 'minimumCurvature', dipConvention: opts.dipConvention || 'auto' });

  // the interval-shape checks (overlaps, inverted from/to…) come from validate
  // (iv above: ONE entry per row — the samples' `bhid` has two, FROM and TO ends)
  let report = ds.report;
  try {
    const v = dhValidate({ collars, surveys, intervals: iv }, { dipConvention: opts.dipConvention || 'auto' });
    const seen = new Set(report.checks.map((c) => c.id));
    const extra = Object.values(v.checks || {}).filter((c) => !seen.has(c.id));
    report = { ...report, checks: report.checks.concat(extra) };
  } catch { /* validate's report is a bonus, not a gate */ }
  {
    const blanks = [];
    blankCheck(blanks, 'blank-collar', 'collars with a blank X/Y/Z — dropped', blankCollars);
    blankCheck(blanks, 'blank-survey', 'survey stations with a blank depth / azimuth / dip — dropped (the hole interpolates across)', blankSurveys);
    blankCheck(blanks, 'blank-interval', 'intervals with a blank FROM / TO — not placed', blankIv);
    if (blanks.length) report = { ...report, checks: blanks.concat(report.checks) };
  }

  const categories = catCounts.size > 0 && catCounts.size <= 255 ? [...catCounts.keys()].sort() : null;
  const catCode = categories ? new Map(categories.map((v, i) => [v, i])) : null;

  // pair the placed endpoints back into SEGMENTS keyed by source row
  const endA = new Map(), endB = new Map();               // src row → [x,y,z]
  for (let k = 0; k < ds.rows.length; k++) {
    const row = ds.rows[k];
    const src = row[5] | 0, end = row[6] | 0;             // __row, __end
    (end === 0 ? endA : endB).set(src, [row[1], row[2], row[3]]);
  }
  const placedRows = [];
  for (const [src, a] of endA) if (endB.has(src)) placedRows.push(src);
  placedRows.sort((x, y) => x - y);
  const nP = placedRows.length;
  const ax = new Float64Array(nP), ay = new Float64Array(nP), az = new Float64Array(nP);
  const bx = new Float64Array(nP), by = new Float64Array(nP), bz = new Float64Array(nP);
  const px = new Float64Array(nP), py = new Float64Array(nP), pz = new Float64Array(nP);
  const pChan = new Float64Array(nP), pCat = catCode ? new Uint8Array(nP) : null;
  const pRec = new Uint32Array(nP);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < nP; k++) {
    const src = placedRows[k];
    const A = endA.get(src), B = endB.get(src);
    ax[k] = A[0]; ay[k] = A[1]; az[k] = A[2];
    bx[k] = B[0]; by[k] = B[1]; bz[k] = B[2];
    px[k] = (A[0] + B[0]) / 2; py[k] = (A[1] + B[1]) / 2; pz[k] = (A[2] + B[2]) / 2;
    pChan[k] = chanVals[src];                            // a blank grade is missing (NaN), not 0
    if (pCat) { const c = catCode.get(catVals[src]); pCat[k] = c === undefined ? 0 : c; }
    pRec[k] = src;
    for (let a2 = 0; a2 < 3; a2++) {
      if (A[a2] < min[a2]) min[a2] = A[a2]; if (A[a2] > max[a2]) max[a2] = A[a2];
      if (B[a2] < min[a2]) min[a2] = B[a2]; if (B[a2] > max[a2]) max[a2] = B[a2];
    }
  }

  let cLo = Infinity, cHi = -Infinity;
  for (let k = 0; k < nP; k++) { const v = pChan[k]; if (v < cLo) cLo = v; if (v > cHi) cHi = v; }
  const header = {
    kind: 'drillholes', count: n,
    bbox: { min, max },
    chanRange: [cLo === Infinity ? 0 : cLo, cHi === -Infinity ? 1 : cHi],
    columns: tIv.columns,
    mapping: { x: -1, y: -1, z: -1, chan, cat: categories ? catCol : null },
    intervalMapping: m.intervals,                          // resolved bhid/from/to (role badges + joins)
    // the collar/survey tables, so a host can re-map their columns and
    // re-desurvey — the interval table above is only a third of the mapping
    collarColumns: tCollar.columns, surveyColumns: tSurvey.columns,
    collarMapping: m.collar, surveyMapping: m.survey,
    numericColumns: numericCols,
    qualifiedColumns: qualifiedCols,
    categories,
    attributes: [
      ...(chan != null ? [tIv.columns[chan]] : []),
      ...(categories ? [tIv.columns[catCol]] : []),
    ],
    report, method: opts.method || 'minimumCurvature', dipConvention: report.dipConvention,
    holes: report.nHoles, placed: nP,
  };

  async function* streamChunks({ chunkPoints = 1 << 18 } = {}) {
    for (let at = 0; at < nP; at += chunkPoints) {
      const k = Math.min(chunkPoints, nP - at);
      yield {
        count: k,
        // midpoints (points mode / section center / measure)
        x: px.subarray(at, at + k), y: py.subarray(at, at + k), z: pz.subarray(at, at + k),
        // segment endpoints (sticks mode)
        ax: ax.subarray(at, at + k), ay: ay.subarray(at, at + k), az: az.subarray(at, at + k),
        bx: bx.subarray(at, at + k), by: by.subarray(at, at + k), bz: bz.subarray(at, at + k),
        chan: pChan.subarray(at, at + k), cat: pCat ? pCat.subarray(at, at + k) : null,
        recIdx: pRec.subarray(at, at + k),
      };
    }
  }

  const fetchRecord = (rec) => (rec >= 0 && rec < n ? tIv.rows[rec] : null);
  // the placed midpoint of a source row (measure across layers) — null for
  // rows that never placed (orphans)
  const recToPlaced = new Map();
  for (let k = 0; k < nP; k++) recToPlaced.set(pRec[k], k);
  const recordPosition = (rec) => {
    const k = recToPlaced.get(rec >>> 0);
    return k === undefined ? null : [px[k], py[k], pz[k]];
  };

  // each hole's collar → EOH path (lazy: only a "keep holes that cross the
  // slab" section asks). → Map(bhid → Float64Array [x,y,z, x,y,z, …]) in world
  // coordinates, depth order. The EOH reaches at least the deepest interval TO.
  let _paths = null;
  const holePaths = () => {
    if (_paths) return _paths;
    const deepest = new Map();
    for (let i = 0; i < iv.bhid.length; i++) { const hb = iv.bhid[i], t = iv.to[i]; if (Number.isFinite(t) && !(deepest.get(hb) >= t)) deepest.set(hb, t); }
    const { perHole } = desurveyHolePaths(collars, surveys, opts, deepest);
    _paths = new Map();
    for (const [hi, pts] of perHole) {
      const xyz = new Float64Array(pts.length * 3);
      pts.forEach((pt, k) => { xyz[3 * k] = pt[1]; xyz[3 * k + 1] = pt[2]; xyz[3 * k + 2] = pt[3]; });
      _paths.set(collarOfRow.get(hi).bhid, xyz);
    }
    return _paths;
  };

  return { header, streamChunks, fetchRecord, recordPosition, holePaths };
}

// Each hole's PATH, collar → end of hole: desurveyed at depth 0, every survey
// station, and the EOH (the collar's, else the deepest survey station, else
// `extraEoh` — the deepest interval TO, so a path always covers its samples).
// → { perHole: Map(collar row → [[seq, x, y, z], …] in depth order), report }.
// Shared by openDrillholeTraces (the path layer) and openDrillholes' holePaths
// (a section's "keep holes that cross the slab").
export function desurveyHolePaths(collars, surveys, opts = {}, extraEoh = null) {
  const depthsOf = new Map(), holeIdx = new Map(), maxSurvey = new Map();
  collars.forEach((c, i) => { if (!depthsOf.has(c.bhid)) { depthsOf.set(c.bhid, new Set([0])); holeIdx.set(c.bhid, c.row ?? i); } });   // a hole is its collar ROW
  for (const s of surveys) { if (depthsOf.has(s.bhid)) { depthsOf.get(s.bhid).add(s.depth); maxSurvey.set(s.bhid, Math.max(maxSurvey.get(s.bhid) || 0, s.depth)); } }
  for (const c of collars) {
    if (!depthsOf.has(c.bhid)) continue;
    let eoh = c.eoh != null && Number.isFinite(c.eoh) ? c.eoh : maxSurvey.get(c.bhid);
    const deep = extraEoh ? extraEoh.get(c.bhid) : null;
    if (deep != null && Number.isFinite(deep) && !(eoh >= deep)) eoh = deep;
    if (eoh) depthsOf.get(c.bhid).add(eoh);
  }
  const sBhid = [], sDepth = [], sRow = [], sSeq = [];
  for (const [hb, ds] of depthsOf) {
    const sorted = [...ds].filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
    sorted.forEach((d, k) => { sBhid.push(hb); sDepth.push(d); sRow.push(holeIdx.get(hb)); sSeq.push(k); });
  }
  const samples = { bhid: sBhid, depth: Float64Array.from(sDepth), cols: [{ name: '__row', values: Float64Array.from(sRow) }, { name: '__seq', values: Float64Array.from(sSeq) }] };
  const ds = dhDesurveySamples({ collars, surveys, samples }, { method: opts.method || 'minimumCurvature', dipConvention: opts.dipConvention || 'auto' });
  const perHole = new Map();
  for (const row of ds.rows) { const hi = row[5] | 0, sq = row[6] | 0; if (!perHole.has(hi)) perHole.set(hi, []); perHole.get(hi).push([sq, row[1], row[2], row[3]]); }
  for (const pts of perHole.values()) pts.sort((a, b) => a[0] - b[0]);
  return { perHole, report: ds.report };
}

/**
 * openDrillholeTraces({ collar, survey }, opts) — the bare hole PATHS: each
 * hole's collar→EOH trace desurveyed at its survey stations (+ 0 and EOH),
 * rendered as consecutive stick SEGMENTS. recIdx = the collar row (a hole), so
 * pick → the collar record. No interval data — this is the geometry a set owns,
 * so a drillhole set shows full coverage even where an assay table has gaps.
 * → { header, streamChunks, fetchRecord } — RawChunk in the sticks shape.
 */
export async function openDrillholeTraces({ collar, survey }, opts = {}) {
  const tCollar = await readDelimited(collar);
  const tSurvey = await readDelimited(survey);
  const mc = (opts.mappings && opts.mappings.collar) || (classifyDrillholeHeader(tCollar.columns) || {}).mapping;
  const ms = (opts.mappings && opts.mappings.survey) || (classifyDrillholeHeader(tSurvey.columns) || {}).mapping;
  if (!mc || mc.x == null) throw new Error('drillhole traces: collar columns not identified (need BHID + X/Y/Z)');
  if (!ms || ms.az == null) throw new Error('drillhole traces: survey columns not identified (need BHID + AZ + DIP)');
  const { collars } = parseCollars(tCollar, mc);          // blanks dropped (openDrillholes reports them)
  const { surveys } = parseSurveys(tSurvey, ms);
  const collarOfRow = new Map(collars.map((c) => [c.row, c]));

  const { perHole, report: pathReport } = desurveyHolePaths(collars, surveys, opts);
  let nSeg = 0;
  for (const pts of perHole.values()) { pts.sort((a, b) => a[0] - b[0]); nSeg += Math.max(0, pts.length - 1); }
  const ax = new Float64Array(nSeg), ay = new Float64Array(nSeg), az = new Float64Array(nSeg);
  const bx = new Float64Array(nSeg), by = new Float64Array(nSeg), bz = new Float64Array(nSeg);
  const px = new Float64Array(nSeg), py = new Float64Array(nSeg), pz = new Float64Array(nSeg);
  const pChan = new Float64Array(nSeg), pRec = new Uint32Array(nSeg);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let si = 0;
  for (const [hi, pts] of perHole) {
    for (let k = 0; k + 1 < pts.length; k++, si++) {
      const a = pts[k], b = pts[k + 1];
      ax[si] = a[1]; ay[si] = a[2]; az[si] = a[3]; bx[si] = b[1]; by[si] = b[2]; bz[si] = b[3];
      px[si] = (a[1] + b[1]) / 2; py[si] = (a[2] + b[2]) / 2; pz[si] = (a[3] + b[3]) / 2;
      pRec[si] = hi; pChan[si] = 0;
      for (const pt of [a, b]) for (let d = 0; d < 3; d++) { const v = pt[d + 1]; if (v < min[d]) min[d] = v; if (v > max[d]) max[d] = v; }
    }
  }
  const header = {
    kind: 'drillholeTraces', count: nSeg, holes: perHole.size,
    bbox: { min, max }, chanRange: [0, 1],
    columns: tCollar.columns, collarMapping: mc, surveyMapping: ms,
    method: opts.method || 'minimumCurvature', dipConvention: pathReport ? pathReport.dipConvention : (opts.dipConvention || 'auto'),
  };
  async function* streamChunks({ chunkPoints = 1 << 16 } = {}) {
    for (let at = 0; at < nSeg; at += chunkPoints) {
      const k = Math.min(chunkPoints, nSeg - at);
      yield {
        count: k,
        x: px.subarray(at, at + k), y: py.subarray(at, at + k), z: pz.subarray(at, at + k),
        ax: ax.subarray(at, at + k), ay: ay.subarray(at, at + k), az: az.subarray(at, at + k),
        bx: bx.subarray(at, at + k), by: by.subarray(at, at + k), bz: bz.subarray(at, at + k),
        chan: pChan.subarray(at, at + k), cat: null, recIdx: pRec.subarray(at, at + k),
      };
    }
  }
  const fetchRecord = (rec) => (rec >= 0 && rec < tCollar.rows.length ? tCollar.rows[rec] : null);
  // a trace record is a hole; its position is the collar (endpoint 0). Coarse
  // but correct — the same "fall back to the centroid" the picker uses when a hit
  // has no face. Was a hard `() => null`, which made Measure silently no-op on a
  // trace segment.
  const recordPosition = (rec) => {
    const c = collarOfRow.get(rec);
    return c ? [c.x, c.y, c.z] : null;
  };
  return { header, streamChunks, fetchRecord, recordPosition };
}
