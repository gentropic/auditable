// @gcu/expr — context-aware completion for the filter / calc editors. Given the
// source + caret, it figures out what's expected *here* and offers it:
//   • a VALUE position (after `col =`, `col in (`, `col contains`, …) → the column's
//     distinct values, QUOTED — this is the one that closes the bare-word-vs-quoted
//     footgun: you pick "OXIDE" from a list instead of typing bare ox.
//   • an OPERAND position (start, after and/or/not/`(`) → columns + functions.
//   • an OPERATOR position (an operand just ended) → comparisons + keywords.
//
// Heuristic, token-driven (rides tokenize), not a full grammar — but it covers the
// shapes people actually type. Returns { from, to, options:[{value,kind,detail}] };
// the host replaces src[from..to] with a chosen option.value.

import { tokenize, CALLFNS, AGGREGATES, dialect, quoteIdent } from './parse.js';

// Function signatures + one-line docs, surfaced on completion options as
// { detail: signature, doc } (hosts show detail beside the name, doc as a hint).
export const FNDOC = {
  if: ['if(cond, then, else)', 'then when cond is true, else otherwise (lazy)'],
  round: ['round(x[, n])', 'round to n decimals (default 0)'],
  int: ['int(x)', 'truncate toward zero'],
  abs: ['abs(x)', 'absolute value'],
  floor: ['floor(x)', 'round down'],
  ceil: ['ceil(x)', 'round up'],
  mod: ['mod(x, y)', 'floored remainder (Excel MOD): mod(-7, 3) = 2'],
  year: ['year(date)', 'year of an ISO YYYY-MM-DD date'],
  month: ['month(date)', 'month of an ISO YYYY-MM-DD date'],
  day: ['day(date)', 'day of an ISO YYYY-MM-DD date'],
  log: ['log(x)', 'natural logarithm'],
  log10: ['log10(x)', 'base-10 logarithm'],
  exp: ['exp(x)', 'e to the x'],
  sqrt: ['sqrt(x)', 'square root'],
  pow: ['pow(x, y)', 'x to the y (same as x ^ y)'],
  min: ['min(a, b, …)', 'smallest non-blank argument'],
  max: ['max(a, b, …)', 'largest non-blank argument'],
  clamp: ['clamp(x, lo, hi)', 'x limited to lo…hi'],
  bin: ['bin(x, w[, origin])', "lower edge of x's bin of width w"],
  lerp: ['lerp(a, b, t)', 'a + (b − a)·t — t = 0 gives a, 1 gives b (not clamped)'],
  remap: ['remap(x, a1, b1, a2, b2)', 'x rescaled from a1…b1 onto a2…b2 (not clamped)'],
  interp: ['interp(x, x1, y1, x2, y2, …)', 'piecewise-linear through (xi, yi) pairs; flat beyond the ends'],
  smoothstep: ['smoothstep(a, b, x)', 'smooth 0→1 ramp as x goes a→b (3t² − 2t³, clamped)'],
  ifnum: ['ifnum(x, default)', 'x if numeric, else default'],
  coalesce: ['coalesce(a, b, …)', 'first non-blank argument'],
  nullif: ['nullif(x, v)', 'blank when x = v (scrub −99 sentinels)'],
  isnum: ['isnum(x)', 'true when x is a number'],
  isnan: ['isnan(x)', 'true when x is present but not a number'],
  isblank: ['isblank(x)', 'true when x is blank'],
  isfilled: ['isfilled(x)', 'true when x is not blank'],
  upper: ['upper(s)', 'upper case'],
  lower: ['lower(s)', 'lower case'],
  trim: ['trim(s)', 'strip surrounding spaces'],
  len: ['len(s)', 'number of characters'],
  left: ['left(s, n)', 'first n characters'],
  right: ['right(s, n)', 'last n characters'],
  substr: ['substr(s, start[, len])', 'substring, 1-based start'],
  replace: ['replace(s, find, repl)', 'replace every literal find with repl'],
  concat: ['concat(a, b, …)', 'join as text, skipping blanks'],
};

const CMP_OPS = ['=', '!=', '<', '>', '<=', '>=', '==', '<>'];
const VALUE_KW = ['in', 'contains', 'like', 'matches'];
const RESET_KW = ['and', 'or', 'not', 'between'];        // crossing one of these ends "this comparison"
const quoteVal = (v) => '"' + String(v).replace(/"/g, '') + '"';

// Is the nearest enclosing `(` an `in (` list (vs a grouping / function paren)?
function insideInList(toks) {
  let depth = 0;
  for (let k = toks.length - 1; k >= 0; k--) {
    const t = toks[k];
    if (t.kind === 'punct' && t.value === ')') depth++;
    else if (t.kind === 'punct' && t.value === '(') {
      if (depth === 0) { const prev = toks[k - 1]; return !!(prev && prev.kind === 'keyword' && prev.value.toLowerCase() === 'in'); }
      depth--;
    }
  }
  return false;
}

// The column being compared = scan back to the nearest column, stopping if we cross
// a boolean/range keyword (that ended the previous comparison).
function compareColumn(toks) {
  for (let k = toks.length - 1; k >= 0; k--) {
    const t = toks[k];
    if (t.kind === 'column') return t.value;
    if (t.kind === 'keyword' && RESET_KW.includes(t.value.toLowerCase())) return null;
  }
  return null;
}

/**
 * @param {string} src
 * @param {number} pos  caret index (default = end)
 * @param {object} ctx  { columns: [{name,type}|name], values?: (col)=>string[] | {col:[…]}, aggregates?, profile? }
 * @returns {{from:number, to:number, options:Array<{value:string,kind:string,detail?:string}>}}
 */
export function complete(src, pos, ctx = {}) {
  src = String(src == null ? '' : src);
  pos = Math.max(0, Math.min(pos == null ? src.length : pos, src.length));
  const columns = (ctx.columns || []).map((c) => (typeof c === 'string' ? { name: c, type: 'string' } : { name: c.name, type: c.type || 'string' }));
  const valFn = typeof ctx.values === 'function' ? ctx.values
    : (ctx.values ? (n) => ctx.values[n] || ctx.values[String(n).toLowerCase()] || [] : () => []);

  const before = src.slice(0, pos);
  // NB the fragment class keeps `-` (and backtick as an open quote) so typing
  // `OK-Ind` still prefix-matches the column OK-Indic even though idents can't
  // contain `-` — this is a UI heuristic, not the grammar.
  const fm = before.match(/(["'`]?)([A-Za-z0-9_-]*)$/) || ['', '', ''];
  const quote = fm[1] || '', frag = fm[2] || '';
  const from = pos - quote.length - frag.length;
  let to = pos;
  if (quote && src[to] === quote) to++;                  // a value typed between quotes → replace the closing one too

  const D = dialect(ctx);                                // the same dialect options parse() takes
  const toks = tokenize(src.slice(0, from), D).filter((t) => t.kind !== 'error');
  const last = toks[toks.length - 1];
  const lastLc = last ? last.value.toLowerCase() : '';
  const lc = frag.toLowerCase();
  const pre = (s) => s.toLowerCase().startsWith(lc);     // prefix match
  const opts = [];

  const valueHere = last && (
    (last.kind === 'operator' && CMP_OPS.includes(last.value)) ||
    (last.kind === 'keyword' && VALUE_KW.includes(lastLc)) ||
    (last.kind === 'punct' && (last.value === '(' || last.value === ',') && insideInList(toks))
  );

  if (valueHere) {
    const col = compareColumn(toks);
    const vals = col ? (valFn(col) || []) : [];
    for (const v of vals) if (pre(String(v))) opts.push({ value: quoteVal(v), kind: 'value', detail: col });
    if (opts.length) return { from, to, options: opts.slice(0, 50) };
    // numeric column (no value list) → fall through to columns/functions
  }

  const operandEnded = last && (last.kind === 'column' || last.kind === 'string' || last.kind === 'number' || (last.kind === 'punct' && last.value === ')'));
  if (operandEnded && !valueHere) {                      // expect an operator / keyword
    for (const o of ['=', '!=', '<', '>', '<=', '>=']) if (pre(o)) opts.push({ value: o, kind: 'operator' });
    for (const kw of ['and', 'or', 'between', 'in', 'contains', 'like', 'matches', 'is blank', 'is filled', 'is not blank', 'not in', 'not contains']) if (pre(kw)) opts.push({ value: kw, kind: 'keyword' });
    return { from, to, options: opts.slice(0, 50) };
  }

  // default: an operand position → columns + functions (+ leading `not`).
  // Non-plain names emit the backtick escape (quoteIdent — the pandas convention).
  for (const c of columns) if (pre(c.name)) opts.push({ value: quoteIdent(c.name), kind: 'column', detail: c.type });
  for (const fn of Object.keys(CALLFNS)) if (pre(fn)) { const d = FNDOC[fn]; opts.push(d ? { value: fn + '(', kind: 'function', detail: d[0], doc: d[1] } : { value: fn + '(', kind: 'function' }); }
  if (D.aggregates) for (const fn of Object.keys(AGGREGATES)) if (!CALLFNS[fn] && pre(fn)) opts.push({ value: fn + '(', kind: 'function', detail: 'repeat aggregate' });
  if (pre('not')) opts.push({ value: 'not', kind: 'keyword' });
  return { from, to, options: opts.slice(0, 50) };
}
