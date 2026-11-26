// wuffle's readers: delimited text → dataset specs for model.addDataset, and a dataset → orientations.
//
// Never refuses at read time. A row it can't read is counted and reported (`skipped`), a column
// mapping it had to guess says so (`guessed` + `why`), so the app can show what it did and offer
// to change it. Sniffs the delimiter (, ; tab | or whitespace), a decimal comma, a header, comment
// lines (# or //) and RFC 4180 quotes. Recognises dip direction / dip, right-hand-rule strike / dip,
// trend / plunge, faults (plane + line + sense), a single attitude column ("045/30", "N30E 40SE"),
// and wuffle's own field log (planes and lines in one file → two datasets).

import { conversions, io as bio } from '../../../ext/bearing/index.js';

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const NUM_COMMA = /^[-+]?\d+,\d+$/;
// an attitude written as one field: "045/30", "310→70", "N30E 40SE". It must carry an attitude mark
// (a slash, an arrow or quadrant letters), so a plain "147.7,64.8" or "147.7 64.8" stays two numbers.
const ATTITUDE_SHAPE = /^\s*[NSEW]?\s*\d+(\.\d+)?\s*[NSEW]?\s*[/\\,; →>]+\s*\d+(\.\d+)?\s*[NSEW]{0,2}\s*$/i;
const ATTITUDE = { test: (s) => ATTITUDE_SHAPE.test(s) && /[/\\→>]|[NSEW]/i.test(s) };

/** split one record on a delimiter, honouring "quoted, fields" with "" escapes */
function splitRecord(line, delim) {
  if (delim === 'ws') return line.trim().split(/\s+/);
  if (delim === 'line') return [line.trim()];
  const out = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === '') q = true;
    else if (c === delim) { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out.map((s) => s.trim());
}

/**
 * Delimited text → { columns, rows, delimiter, decimalComma, header, skipped }.
 * rows are objects keyed by column name; numbers are numbers.
 */
export function parseDelimited(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*(#|\/\/)/.test(l));
  if (!lines.length) return { columns: [], rows: [], delimiter: ',', decimalComma: false, header: false, skipped: 0 };
  const probe = lines.slice(0, 20);
  // a file of attitudes ("045/30", "N30E 40SE"), one per line, is ONE column — its spaces aren't delimiters
  let delimiter = probe.filter((l) => ATTITUDE.test(l)).length >= Math.max(1, probe.length - 1) ? 'line' : 'ws';
  // otherwise the delimiter most lines agree on (the most common field count, > 1, on ≥ 80 % of lines):
  // one odd line doesn't make the whole file unreadable
  let best = 0;
  if (delimiter === 'ws') for (const d of [',', ';', '\t', '|']) {
    const counts = probe.map((l) => splitRecord(l, d).length), freq = new Map();
    for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
    const [mode, k] = [...freq].sort((a, b) => b[1] - a[1])[0];
    const share = k / counts.length;
    if (mode > 1 && share >= 0.8 && share > best) { best = share; delimiter = d; }
  }
  const recs = lines.map((l) => splitRecord(l, delimiter));
  // a decimal comma: only possible when the comma isn't the delimiter
  const decimalComma = delimiter !== ',' && recs.slice(0, 20).some((r) => r.some((v) => NUM_COMMA.test(v)));
  const toVal = (v) => {
    if (decimalComma && NUM_COMMA.test(v)) return +v.replace(',', '.');
    return NUM.test(v) ? +v : v;
  };
  const first = recs[0];
  // a header: the first record has a word in it (not a number, not an attitude like 045/30)
  const header = first.some((v) => v !== '' && !NUM.test(v) && !(decimalComma && NUM_COMMA.test(v)) && !ATTITUDE.test(v));
  let columns = header ? first.map((h, i) => h || `c${i + 1}`) : first.map((_, i) => `c${i + 1}`);
  const seen = new Map(); columns = columns.map((c) => { const n = (seen.get(c) || 0) + 1; seen.set(c, n); return n > 1 ? `${c}_${n}` : c; });
  const rows = []; let skipped = 0;
  for (const r of header ? recs.slice(1) : recs) {
    if (r.length < 2 && !(r.length === 1 && ATTITUDE.test(r[0]))) { skipped++; continue; }
    const o = {}; columns.forEach((c, i) => { o[c] = toVal(r[i] ?? ''); });
    rows.push(o);
  }
  return { columns, rows, delimiter, decimalComma, header, skipped };
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const ROLE_PATTERNS = {
  dipDir: /^(dipdir|dipdirection|dipazimuth|dipaz|ddir|dd|dipdirn|azimuthofdip|dipdirectiontrend)$/,
  strike: /^(strike|str|rhr|strikerhr|strikedir)$/,
  dip: /^(dip|dipangle|inclination|incl)$/,
  trend: /^(trend|tr|trd|lineationtrend|azimuth|az|bearing)$/,
  plunge: /^(plunge|pl|plg|lineationplunge)$/,
  sense: /^(sense|slipsense|kinematics|kin|movement)$/,
  angle: /^(angle|opening|semiangle|cone|halfangle)$/,
  set: /^(set|family|group|class|domain)$/,
};
function findRole(columns, role) { return columns.find((c) => ROLE_PATTERNS[role].test(norm(c))) || null; }

/**
 * Which columns mean what. → { kind, roles, notation, guessed, why }.
 * kind: 'planes' | 'lines' | 'faults' | 'smallcircles' | 'fieldlog'
 */
const LINE_TEXT = /^\s*(\d+(?:\.\d+)?)\s*[→>]\s*(\d+(?:\.\d+)?)\s*$/;
const isLineText = (v) => LINE_TEXT.test(v);

export function sniffRoles(columns, rows) {
  const n = (c) => norm(c);
  if (columns.some((c) => n(c) === 'type') && columns.some((c) => n(c) === 'dipdirortrend')) {
    return { kind: 'fieldlog', roles: { type: columns.find((c) => n(c) === 'type'), a: columns.find((c) => n(c) === 'dipdirortrend'), b: columns.find((c) => n(c) === 'diporplunge') }, notation: 'dd', guessed: false, why: 'wuffle field log' };
  }
  const r = Object.fromEntries(Object.keys(ROLE_PATTERNS).map((k) => [k, findRole(columns, k)]));
  const set = r.set ? { set: r.set } : {};
  if ((r.dipDir || r.strike) && r.dip && r.trend && r.plunge) {
    return { kind: 'faults', roles: { ...(r.dipDir ? { dipDir: r.dipDir } : { strike: r.strike }), dip: r.dip, trend: r.trend, plunge: r.plunge, ...(r.sense ? { sense: r.sense } : {}), ...set }, notation: r.dipDir ? 'dd' : 'rhr', guessed: false, why: 'plane, line and sense columns' };
  }
  if (r.trend && r.plunge && r.angle) return { kind: 'smallcircles', roles: { trend: r.trend, plunge: r.plunge, angle: r.angle, ...set }, notation: 'dd', guessed: false, why: 'axis and angle columns' };
  if (r.dipDir && r.dip) return { kind: 'planes', roles: { dipDir: r.dipDir, dip: r.dip, ...set }, notation: 'dd', guessed: false, why: `${r.dipDir} / ${r.dip}` };
  if (r.strike && r.dip) return { kind: 'planes', roles: { strike: r.strike, dip: r.dip, ...set }, notation: 'rhr', guessed: false, why: `${r.strike} / ${r.dip} (right-hand rule)` };
  if (r.trend && r.plunge) return { kind: 'lines', roles: { trend: r.trend, plunge: r.plunge, ...set }, notation: 'dd', guessed: false, why: `${r.trend} → ${r.plunge}` };
  // a single attitude-string column
  const att = columns.find((c) => rows.slice(0, 20).filter((o) => typeof o[c] === 'string' && ATTITUDE.test(o[c])).length >= Math.min(3, rows.length));
  if (att) {
    // an arrow makes a line (045→30, or 045>30 typed); a column of only lines is lines, a mix splits in readTable
    const vals = rows.map((o) => String(o[att] ?? '')).filter((v) => v.trim());
    const lines = vals.filter(isLineText).length;
    if (lines && lines === vals.length) return { kind: 'lines', roles: { attitude: att, ...set }, notation: 'text', guessed: true, why: `“${att}” read as trend → plunge` };
    return { kind: 'planes', roles: { attitude: att, ...set }, notation: 'text', guessed: true, mixed: lines > 0, why: `“${att}” read as dip direction / dip (quadrant letters honoured)${lines ? '; the rows with an arrow as trend → plunge' : ''}` };
  }
  // the first two numeric columns, as dip direction / dip — unless the second runs past 90
  const numeric = columns.filter((c) => rows.slice(0, 50).every((o) => typeof o[c] === 'number' || o[c] === ''));
  if (numeric.length >= 2) {
    const [a, b] = numeric, past = rows.some((o) => o[b] > 90), aOk = !rows.some((o) => o[a] > 90);
    const [dd, dip] = past && aOk ? [b, a] : [a, b];
    const named = columns.some((c) => !/^c\d+$/.test(c));   // c1, c2… are the names parseDelimited makes up
    return { kind: 'planes', roles: { dipDir: dd, dip, ...set }, notation: 'dd', guessed: true, why: `${named ? 'no column names wuffle knows' : 'no named columns'}: ${dd} / ${dip} read as dip direction / dip${past && aOk ? ' (swapped — the second column passes 90)' : ''}` };
  }
  return { kind: 'planes', roles: {}, notation: 'dd', guessed: true, why: 'no orientation columns found' };
}

/**
 * Text → dataset specs (usually one; a field log with planes and lines gives two).
 * Each spec: { name, kind, rows, columns, roles, notation, meta: { read: {…} } }
 */
export function readTable(text, name = 'data') {
  const t = parseDelimited(text);
  const s = sniffRoles(t.columns, t.rows);
  const read = { delimiter: t.delimiter, decimalComma: t.decimalComma, header: t.header, skipped: t.skipped, guessed: s.guessed, why: s.why };
  if (s.kind === 'fieldlog') {
    const out = [];
    for (const [type, kind, roles] of [['plane', 'planes', { dipDir: s.roles.a, dip: s.roles.b }], ['line', 'lines', { trend: s.roles.a, plunge: s.roles.b }]]) {
      const rows = t.rows.filter((o) => String(o[s.roles.type]).toLowerCase().startsWith(type));
      if (rows.length) out.push({ name: `${name} · ${kind}`, kind, rows, columns: t.columns, roles, notation: 'dd', meta: { read } });
    }
    return out;
  }
  if (s.mixed) {                                          // one attitude column holding planes AND lines → two datasets
    const isLine = (o) => isLineText(String(o[s.roles.attitude] ?? ''));
    return [['planes', t.rows.filter((o) => !isLine(o))], ['lines', t.rows.filter(isLine)]]
      .map(([kind, rows]) => ({ name: `${name} · ${kind}`, kind, rows, columns: t.columns, roles: s.roles, notation: 'text', meta: { read } }));
  }
  return [{ name, kind: s.kind, rows: t.rows, columns: t.columns, roles: s.roles, notation: s.notation, meta: { read } }];
}

/** one row's plane as [dipDirection, dip], or null */
function planeOf(row, roles, notation) {
  if (roles.attitude) {
    const v = String(row[roles.attitude] ?? '');
    const m = v.match(/^\s*([NSEW]?\s*\d+(?:\.\d+)?\s*[NSEW]?)\s*[/\\,; →>]+\s*(\d+(?:\.\d+)?\s*[NSEW]{0,2})\s*$/i);
    if (!m) return null;
    try {
      const dirTxt = m[1].replace(/\s+/g, ''), quad = /[NS]/i.test(dirTxt[0]);
      const { dip, quadrant } = bio.parseDip(m[2]);
      return bio.translateAttitude(bio.parseDirection(dirTxt), dip, quadrant, quad);   // quadrant notation is a strike
    } catch { return null; }
  }
  const dip = +row[roles.dip];
  const a = roles.dipDir ? +row[roles.dipDir] : roles.strike ? +row[roles.strike] + 90 : NaN;
  if (row[roles.dip] === '' || !Number.isFinite(dip) || !Number.isFinite(a) || dip < 0 || dip > 90) return null;
  return [((a % 360) + 360) % 360, dip];
}

/**
 * A dataset's orientations, aligned with its rows (null where a row can't be read):
 *   planes / faults → { pole, plane: [dd, dip] (, line: [tr, pl], slip?) } ; lines → { line: [tr, pl], dcos }
 */
export function orientations(ds) {
  const { roles, notation } = ds;
  return ds.rows.map((row) => {
    if (ds.kind === 'lines' && roles.attitude) {          // "045→30" in one column
      const m = String(row[roles.attitude] ?? '').match(LINE_TEXT);
      if (!m) return null;
      const tr = +m[1], pl = +m[2];
      if (pl > 90) return null;
      return { line: [((tr % 360) + 360) % 360, pl], dcos: conversions.lineToDcos(tr, pl) };
    }
    if (ds.kind === 'lines' || ds.kind === 'smallcircles') {
      const tr = +row[roles.trend], pl = +row[roles.plunge];
      if (row[roles.trend] === '' || !Number.isFinite(tr) || !Number.isFinite(pl) || pl < -90 || pl > 90) return null;
      const out = { line: [((tr % 360) + 360) % 360, pl], dcos: conversions.lineToDcos(tr, pl) };
      if (ds.kind === 'smallcircles') out.angle = +row[roles.angle];
      return out;
    }
    const plane = planeOf(row, roles, notation);
    if (!plane) return null;
    const out = { plane, pole: conversions.planeToDcos(plane[0], plane[1]) };
    if (ds.kind === 'faults') {
      const tr = +row[roles.trend], pl = +row[roles.plunge];
      if (Number.isFinite(tr) && Number.isFinite(pl)) { out.line = [tr, pl]; out.lineDcos = conversions.lineToDcos(tr, pl); }
      if (roles.sense) out.sense = row[roles.sense];
    }
    return out;
  });
}
