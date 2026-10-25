// @gcu/condenser — delimited RECORDS (RFC 4180 quoting), shared by every
// delimited reader (block models, tables, drillhole trios, the filter sweeps).
//
// A record is usually one line, but a quoted field may hold the delimiter, a
// line break, or a doubled quote (""). Readers split text on '\n' as before and
// hand each line to a RecordJoiner, which glues lines back together while a
// quote is open. A line without a '"' costs one indexOf, so files that never
// quote anything read at the old speed.
//
// A quote opens a field only at the field's start (after optional spaces); a
// '"' inside an unquoted field is a literal character (12" core), as in
// Python's csv module. Field values come back unquoted and un-doubled, but are
// otherwise untrimmed — the callers trim where they always did.

export const WS = 'ws';                                    // whitespace-delimiter sentinel ('\s' in a string is just 's')

const isSpace = (c) => c === 32 || c === 9;
const plainSplit = (delim) => (delim === WS ? (l) => l.trim().split(/\s+/) : (l) => l.split(delim));

/** Split one RECORD (possibly multi-line) into fields. */
export function splitFields(line, delim) {
  if (line.indexOf('"') < 0) return plainSplit(delim)(line);
  const ws = delim === WS, n = line.length, out = [];
  // padding before an opening quote: spaces, and tabs unless tab IS the delimiter
  const isPad = (c) => c === 32 || (c === 9 && delim !== '\t');
  const endOf = (k) => {
    if (ws) { let e = k; while (e < n && !isSpace(line.charCodeAt(e))) e++; return e; }
    const e = line.indexOf(delim, k); return e < 0 ? n : e;
  };
  let i = 0;
  if (ws) { while (i < n && isSpace(line.charCodeAt(i))) i++; if (i >= n) return ['']; }
  for (;;) {
    let j = i;
    if (!ws) while (j < n && isPad(line.charCodeAt(j))) j++;
    let v, e;
    if (j < n && line.charCodeAt(j) === 34) {
      v = ''; let k = j + 1;
      for (;;) {
        const q = line.indexOf('"', k);
        if (q < 0) { v += line.slice(k); k = n; break; }   // unterminated: take the rest
        v += line.slice(k, q);
        if (line.charCodeAt(q + 1) === 34) { v += '"'; k = q + 2; } else { k = q + 1; break; }
      }
      e = endOf(k);
      v += line.slice(k, e);                               // text between the closing quote and the delimiter is kept (lenient)
    } else { e = endOf(i); v = line.slice(i, e); }
    out.push(v);
    if (e >= n) return out;
    i = ws ? e : e + delim.length;
    if (ws) { while (i < n && isSpace(line.charCodeAt(i))) i++; if (i >= n) return out; }
  }
}

/** Does `line` end inside an open quoted field? `open` = the state it started in. */
export function endsInQuote(line, delim, open = false) {
  if (!open && line.indexOf('"') < 0) return false;
  const ws = delim === WS, dc = ws ? -1 : delim.charCodeAt(0);
  const n = line.length;
  let inQ = open, atStart = !open;                         // a continuation line resumes INSIDE a field
  for (let i = 0; i < n; i++) {
    const c = line.charCodeAt(i);
    if (inQ) {
      if (c === 34) { if (line.charCodeAt(i + 1) === 34) i++; else inQ = false; }
      continue;
    }
    if (ws ? isSpace(c) : c === dc) { atStart = true; continue; }
    if (atStart && (c === 32 || c === 9)) continue;
    if (atStart && c === 34) { inQ = true; atStart = false; continue; }
    atStart = false;
  }
  return inQ;
}

/**
 * Line → record assembler. push(line) returns the completed record string, or
 * null while a quoted field is still open. `start` (the caller's line number of
 * the record's first line) is kept so byte-offset readers can locate records.
 */
export class RecordJoiner {
  constructor(delim) { this.delim = delim; this.buf = null; this.start = -1; }
  get pending() { return this.buf !== null; }
  push(line, lineNo = -1) {
    if (this.buf === null) {
      if (!endsInQuote(line, this.delim, false)) { this.start = lineNo; return line; }
      this.buf = line; this.start = lineNo; return null;
    }
    const open = endsInQuote(line, this.delim, true);
    this.buf += '\n' + line;
    if (open) return null;
    const r = this.buf; this.buf = null; return r;
  }
  /** end of input: an unterminated quoted record is returned as-is (lenient). */
  flush() { const r = this.buf; this.buf = null; return r; }
}

/** All complete records of a text sample (the sniff / head-sample path). */
export function sampleRecords(text, delim, { max = Infinity, dropPartial = true } = {}) {
  const lines = text.split('\n'), out = [], j = new RecordJoiner(delim);
  for (let l of lines) {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (!j.pending && (!l.trim() || l[0] === '#')) continue;
    const r = j.push(l);
    if (r != null) { out.push(r); if (out.length >= max) return out; }
  }
  if (!dropPartial) { const r = j.flush(); if (r != null) out.push(r); }
  return out;
}

/** The delimiter of a small table, chosen from its header line (most fields wins; ',' on a tie). */
export function delimiterOfLine(line) {
  return [',', ';', '\t'].reduce((a, b) => (splitFields(line, b).length > splitFields(line, a).length ? b : a), ',');
}
