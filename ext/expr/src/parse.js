// @gcu/expr — parser. A small, *total*, pure expression calculus over the fields
// of one record. Totality is the security boundary: no loops, recursion, I/O, or
// unbounded ops; every expression terminates and (post-parse) never throws at eval
// time. The canonical surface is SQL-WHERE-flavored — the dialect this audience
// already reads ("filter rows") — with a terse `if()` for the value face, and the
// blank model deliberately friendlier than SQL's NULL (blank = blank → true; no
// `= NULL` trap). C-style spellings (&&, ==, ~, <>, single-quoted strings, parenless
// `in`) still parse, silently tolerated, but the documented/highlighted form is one.
//
// Pipeline: lex → parse to an analyzable AST. `evaluate` (tree-walk reference) and
// `compile` (positional closures, hot path) consume the AST; `deps`/`validate`/
// `tokenize` analyze it. Blank is `null`.
//
// Precedence ladder (low→high): or < and < not < comparison < additive <
// multiplicative < unary < power < primary. Power (`^` / `**`) is right-associative
// and binds looser than unary on the left, tighter on the right — Python/pandas
// semantics: -2^2 = -4, 2^-3 = 0.125, 2^3^2 = 512. (Excel disagrees on -2^2; the
// Python convention wins because pandas.query is this audience's muscle memory.)

// Keyword operators / words — matched case-insensitively. A column literally named
// one of these needs the `…` backtick escape.
const RESERVED = new Set(['and', 'or', 'not', 'between', 'contains', 'in', 'like', 'matches', 'is', 'blank', 'filled', 'true', 'false']);

// Pure total functions: name → [minArgs, maxArgs]. `if` is special (lazy branches)
// but listed for arity + call-syntax recognition.
export const CALLFNS = {
  if: [3, 3], round: [1, 2], int: [1, 1], abs: [1, 1], floor: [1, 1], ceil: [1, 1], mod: [2, 2],
  year: [1, 1], month: [1, 1], day: [1, 1],
  log: [1, 1], log10: [1, 1], exp: [1, 1], sqrt: [1, 1], pow: [2, 2], min: [1, Infinity], max: [1, Infinity], clamp: [3, 3], bin: [2, 3],
  ifnum: [2, 2], coalesce: [1, Infinity], nullif: [2, 2], isnum: [1, 1], isnan: [1, 1], isblank: [1, 1], isfilled: [1, 1],
  upper: [1, 1], lower: [1, 1], trim: [1, 1], len: [1, 1], left: [2, 2], right: [2, 2], substr: [2, 3], replace: [3, 3], concat: [1, Infinity],
};

// Is `name` writable as a bare identifier? (Used by quoteIdent + complete.)
const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/;   // dots allowed: a name, not member access
// Quote a column name for use in an expression: plain idents pass through, anything
// else (spaces, hyphens, reserved words) gets the backtick escape with \` / \\.
// Consumers that treat a column NAME as an expression (stats pickers, materialize)
// MUST route through this — `OK-Indic` bare is subtraction now.
export function quoteIdent(name) {
  const s = String(name);
  return PLAIN_IDENT.test(s) && !RESERVED.has(s.toLowerCase()) ? s : '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

export class ExprParseError extends Error {
  constructor(msg) { super('expr parse error: ' + msg); this.name = 'ExprParseError'; }
}
function fail(msg) { throw new ExprParseError(msg); }

// ── lexer ──────────────────────────────────────────────────────────────────
// Bare field refs are case-insensitive idents of [A-Za-z_][A-Za-z0-9_]*, and a
// name MAY CONTAIN DOTS — `Fe.pct`, `g.cutoff` (v0.3). A dot is part of the NAME,
// not an operator: there is no member access, values stay scalars, and the data
// model is unchanged. Dotted names are how callers spell namespaces BY CONVENTION
// (a routine's `$g.cutoff`, an assay table's `au.ppm`) without the language
// growing objects. Unambiguous because numbers lex first and expression literals
// are always dot-decimal (opts.decimal only affects reading DATA strings), so a
// dot after a letter can never be part of a number. Strictly additive: `Fe.pct`
// used to be a parse error unless backticked.
// `-` is ALWAYS subtraction (v0.2; `AU-CU` is arithmetic, as pandas/SQL fingers expect).
// Any other column name takes the BACKTICK escape — `Assay Au ppm` — the pandas
// df.query() convention; \` escapes a literal backtick, \\ a backslash. The legacy
// `["…"]` bracket form still parses (shipped lenses) but is undocumented. `${name}` —
// XLSForm's own reference syntax — is a field ref in every dialect (`$` was an illegal
// character before, so it's additive); inside the braces any of [A-Za-z0-9_.-], so
// digit-leading and hyphenated names work: `${1st_pass}`, `${fe-pct}`.
// Strings: "double" (canonical) or 'single' (tolerated). Numbers: ints, decimals,
// leading-dot (.5) and scientific (1e4, 2.5e-3). `^` and `**` are power.
const TOKEN_RE = /(\s+)|(#[^\n]*)|(\[\s*"[^"]*"\s*\]|`(?:[^`\\]|\\.)*`|\$\{[A-Za-z0-9_.-]+\})|("[^"]*"|'[^']*')|(&&|\|\||\*\*|==|<>|<=|>=|!=|!~|<|>|=|~)|([-+*/(),^])|((?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)/y;

// Lex into tokens carrying source positions. `tolerant` (for highlighting) emits a
// 1-char 'err' token on an unexpected character instead of throwing.
function lexAll(src, tolerant) {
  const toks = [];
  let last = 0;
  while (last < src.length) {
    TOKEN_RE.lastIndex = last;
    const m = TOKEN_RE.exec(src);
    if (!m) {
      if (tolerant) { toks.push({ k: 'err', v: src[last], start: last, end: last + 1 }); last++; continue; }
      fail(`unexpected character at ${last}: "${src.slice(last, last + 8)}"`);
    }
    const start = last; last = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) continue;                                        // whitespace
    if (m[2] !== undefined) {                                                // # comment → end of line (pandas-style;
      if (tolerant) toks.push({ k: 'comment', v: m[2], start, end: last }); //  '#' was an illegal char pre-v0.2, so
      continue;                                                              //  this is purely additive). parse skips;
    }                                                                        //  tokenize keeps them for highlighting.
    let k, v;
    let q;                                                                   // how a field was written (see aggPath)
    if (m[3] !== undefined) {
      k = 'field';
      if (m[3][0] === '$') { v = m[3].slice(2, -1); q = 'brace'; }           // ${name} — XLSForm's reference form
      else if (m[3][0] === '`') { v = m[3].slice(1, -1).replace(/\\([`\\])/g, '$1'); q = 'tick'; }   // `…` backtick escape (canonical)
      else { v = m[3].replace(/^\[\s*"/, '').replace(/"\s*\]$/, ''); q = 'tick'; }                   // ["…"] legacy bracket form
    }
    else if (m[4] !== undefined) { k = 'str'; v = m[4].slice(1, -1); }       // "double" or 'single'
    else if (m[5] !== undefined) { k = 'op'; v = m[5]; }
    else if (m[6] !== undefined) { k = 'op'; v = m[6]; }
    else if (m[7] !== undefined) { k = 'num'; v = parseFloat(m[7]); }
    else { k = 'word'; v = m[8]; }
    toks.push(q ? { k, v, q, start, end: last } : { k, v, start, end: last });
  }
  return toks;
}

// ── dialect options ──────────────────────────────────────────────────────────
// The default dialect is the record calculus above. Options switch on additions a
// host asks for; with every option off, nothing parses differently.
//   aggregates: true  — repeat aggregates over a field holding a LIST OF INSTANCE
//                       OBJECTS (an XLSForm repeat): count(r), total(r.f) (alias
//                       sum), mean / min / max (r.f). See aggPath for the syntax.
//   profile: 'form'   — the bundle for form engines (Hopper): aggregates on.
// An explicit flag beats the profile's default.
const PROFILES = { form: { aggregates: true } };
export function dialect(opts) {
  const base = (opts && PROFILES[opts.profile]) || {};
  return { aggregates: !!(opts && opts.aggregates !== undefined ? opts.aggregates : base.aggregates) };
}
// Aggregate name → canonical fn. `sum` is an alias of `total` (empty → 0, as in Hopper).
export const AGGREGATES = { count: 'count', total: 'total', sum: 'total', mean: 'mean', min: 'min', max: 'max' };

// ── pattern guard ────────────────────────────────────────────────────────────
// `matches "…"` hands a pattern to a backtracking regex engine, and a pattern like
// `(a+)+$` or `(x|xx)+y` takes exponential time on a crafted value — a frozen tab,
// which breaks the totality promise (every expression terminates). Rejected at parse,
// conservatively: an unbounded or ranged quantifier (`*`, `+`, `{n,}`, `{n,m}`) on a
// group that itself contains a quantifier or an alternation, and backreferences
// (`\1`, `\k<name>`). `?` and `{n}` on such a group are fine (bounded repetition).
// An invalid pattern is a parse error too (it used to match nothing, silently).
// Residual: several `.*` in sequence are polynomial, not exponential — slow only on
// long values.
function checkPattern(src) {
  try { new RegExp(src); } catch (e) { fail(`invalid pattern "${src}": ${e.message}`); }
  const groups = [];                       // open groups: { inner: has quantifier or alternation }
  let lastGroup = null;                    // the group that just closed, if the next token may quantify it
  const unsafe = () => fail(`pattern "${src}" can backtrack catastrophically (a repeated group containing a quantifier or '|') — rewrite it without nesting`);
  const mark = () => { if (groups.length) groups[groups.length - 1].inner = true; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const d = src[i + 1];
      if (/[1-9]/.test(d) || (d === 'k' && src[i + 2] === '<')) fail(`pattern "${src}" uses a backreference — not supported (it can backtrack catastrophically)`);
      i++; lastGroup = null; continue;
    }
    if (c === '[') {                       // character class: skip to its unescaped ']'
      let j = i + 1; if (src[j] === '^') j++; if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') { if (src[j] === '\\') j++; j++; }
      i = j; lastGroup = null; continue;
    }
    if (c === '(') {
      groups.push({ inner: false }); lastGroup = null;
      if (src[i + 1] === '?') {            // group modifier, not a quantifier: (?: (?= (?! (?<= (?<! (?<name>
        if (src[i + 2] === '<' && src[i + 3] !== '=' && src[i + 3] !== '!') { const e = src.indexOf('>', i); i = e < 0 ? src.length : e; }
        else i += src[i + 2] === '<' ? 3 : 2;
      }
      continue;
    }
    if (c === ')') { lastGroup = groups.pop() || null; if (lastGroup && lastGroup.inner) mark(); continue; }
    if (c === '|') { mark(); lastGroup = null; continue; }
    let q = null;                          // quantifier at i: '?', 'n' (exact {n}), or 'many'
    if (c === '*' || c === '+') q = 'many';
    else if (c === '?') q = '?';
    else if (c === '{') { const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i)); if (m) { q = m[2] ? 'many' : 'n'; i += m[0].length - 1; } }
    if (q) {
      if (q === 'many' && lastGroup && lastGroup.inner) unsafe();
      mark();
      if (src[i + 1] === '?') i++;         // lazy suffix
      lastGroup = null; continue;
    }
    lastGroup = null;
  }
}

// SQL LIKE pattern → an anchored RegExp source (% = any run, _ = one char).
function likeToRegex(pat) {
  const esc = String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');   // escape regex specials (NOT % or _)
  return '^' + esc.replace(/%/g, '.*').replace(/_/g, '.') + '$';
}

// ── parser ───────────────────────────────────────────────────────────────────
// The argument of a repeat aggregate is ONE field token naming a path `r` or `r.f`:
// `samples`, `samples.fe_pct`, or `${samples.fe-pct}` (the brace form allows any name
// characters). It splits at the first dot — `r` is the repeat (a field whose value is
// a list of instance objects), `f` the field read off each instance. A backticked
// name is never split (that's the escape for a repeat whose name has a dot).
function aggPath(tok) {
  if (!tok || (tok.k !== 'word' && tok.k !== 'field')) return null;
  if (tok.q === 'tick') return [tok.v];
  const d = tok.v.indexOf('.');
  return d < 0 ? [tok.v] : [tok.v.slice(0, d), tok.v.slice(d + 1)];
}

export function parse(src, opts) {
  const D = dialect(opts);
  const toks = lexAll(src, false);
  let i = 0;
  const op = (v) => toks[i] && toks[i].k === 'op' && toks[i].v === v;
  const word = (v) => toks[i] && toks[i].k === 'word' && toks[i].v.toLowerCase() === v;       // keywords are case-insensitive
  const peekWord = (v) => toks[i + 1] && toks[i + 1].k === 'word' && toks[i + 1].v.toLowerCase() === v;
  const eatOp = (v) => { if (!op(v)) fail(`expected '${v}'`); i++; };
  const eatStr = () => { if (!toks[i] || toks[i].k !== 'str') fail('expected a quoted string'); const v = toks[i].v; i++; return v; };
  // `in (a, b, …)` — parens optional (SQL canonical with; tolerated without).
  const inList = () => { const paren = op('('); if (paren) i++; const set = [add()]; while (op(',')) { i++; set.push(add()); } if (paren) eatOp(')'); return set; };

  function primary() {
    const t = toks[i];
    if (!t) fail('unexpected end of expression');
    if (t.k === 'op' && t.v === '(') { i++; const e = expr(); eatOp(')'); if (e && typeof e === 'object') { e.gStart = t.start; e.gEnd = toks[i - 1].end; } return e; }   // paren-group extent → grouping UIs
    if (t.k === 'num') { i++; return { t: 'num', v: t.v, start: t.start, end: t.end }; }   // literals carry SOURCE SPANS
    if (t.k === 'str') { i++; return { t: 'str', v: t.v, start: t.start, end: t.end }; }   // (widget UIs rewrite them surgically)
    if (t.k === 'field') { i++; return { t: 'field', name: t.v }; }     // ["…"] bracket escape
    if (t.k === 'word') {
      const lw = t.v.toLowerCase();
      const opens = toks[i + 1] && toks[i + 1].k === 'op' && toks[i + 1].v === '(';
      // repeat aggregate (dialect option): count(r) · total|sum|mean|min|max(r.f).
      // min/max are aggregates only for exactly one DOTTED path — `min(a, b)` and
      // `min(x)` stay the scalar functions.
      if (D.aggregates && opens && AGGREGATES[lw]) {
        const fn = AGGREGATES[lw], arg = toks[i + 2], close = toks[i + 3];
        const path = aggPath(arg), single = !!(path && close && close.k === 'op' && close.v === ')');
        if (fn === 'min' || fn === 'max' ? (single && path.length === 2) : true) {
          if (!single) fail(`${lw}() expects ${fn === 'count' ? 'a repeat name, e.g. count(samples)' : `a repeat field, e.g. ${lw}(samples.fe_pct)`}`);
          if (fn !== 'count' && path.length < 2) fail(`${lw}() expects a repeat field r.f, e.g. ${lw}(${path[0]}.fe_pct) — got '${path[0]}'`);
          i += 4;
          return { t: 'agg', fn, path, start: t.start, end: close.end };
        }
      }
      if (CALLFNS[lw] && opens) {
        i += 2;
        const args = [];
        if (!op(')')) { args.push(expr()); while (op(',')) { i++; args.push(expr()); } }
        eatOp(')');
        const [lo, hi] = CALLFNS[lw];
        if (args.length < lo || args.length > hi) fail(`${lw}() expects ${lo === hi ? lo : (hi === Infinity ? `${lo}+` : `${lo}–${hi}`)} argument(s), got ${args.length}`);
        return { t: 'call', fn: lw, args, start: t.start, end: toks[i - 1].end };   // full call extent
      }
      i++;
      if (lw === 'true') return { t: 'bool', v: true };
      if (lw === 'false') return { t: 'bool', v: false };
      if (lw === 'blank') return { t: 'blank' };                        // the blank LITERAL: if(AU = -99, blank, AU)
      if (RESERVED.has(lw)) fail(`unexpected keyword '${t.v}'`);
      return { t: 'field', name: t.v };                                 // bare ident → column (original case kept)
    }
    fail(`unexpected '${t.v}'`);
  }
  // power: right-assoc, desugars to the existing pow() call (zero new eval code).
  // The exponent re-enters unary so 2^-3 works; -2^2 = -(2^2) (Python/pandas).
  function power() {
    const l = primary();
    if (op('^') || op('**')) { i++; return { t: 'call', fn: 'pow', args: [l, unary()] }; }
    return l;
  }
  function unary() {
    if (op('-') || op('+')) {
      const neg = op('-'), at = toks[i].start; i++; const e = unary();
      if (!neg) return e;
      const n2 = { t: 'neg', e };
      if (e.end != null) { n2.start = at; n2.end = e.end; }              // span covers the sign (surgical rewrites)
      return n2;
    }
    return power();
  }
  function mul() {
    let l = unary();
    while (op('*') || op('/')) { const o = toks[i].v; i++; l = { t: o, l, r: unary() }; }
    return l;
  }
  function add() {
    let l = mul();
    while (op('+') || op('-')) { const o = toks[i].v; i++; l = { t: o, l, r: mul() }; }
    return l;
  }
  function comparison() {
    const st = toks[i] ? toks[i].start : 0;                               // clause EXTENT: widget UIs rewrite whole
    const fin = (n) => { if (n && n.start == null) { n.start = st; n.end = toks[i - 1] ? toks[i - 1].end : st; } return n; };   // leaves (op conversions, grouping)
    const l = add();
    if (op('<') || op('>') || op('<=') || op('>=') || op('=') || op('==') || op('!=') || op('<>')) {
      const ot = toks[i]; let o = ot.v; i++; if (o === '==') o = '='; if (o === '<>') o = '!=';     // tolerate C / SQL not-equal
      return fin({ t: 'cmp', op: o, l, r: add(), opStart: ot.start, opEnd: ot.end });   // op token span → op dropdowns
    }
    if (op('~')) { i++; return fin({ t: 'contains', l, r: add() }); }
    if (op('!~')) { i++; return fin({ t: 'not', e: { t: 'contains', l, r: add() } }); }
    if (word('between')) { const kt = toks[i]; i++; const lo = add(); if (!(word('and') || op('&&'))) fail("expected 'and' in between"); i++; return fin({ t: 'between', e: l, lo, hi: add(), opStart: kt.start, opEnd: kt.end }); }
    if (word('contains')) { const kt = toks[i]; i++; return fin({ t: 'contains', l, r: add(), opStart: kt.start, opEnd: kt.end }); }
    if (word('in')) { const kt = toks[i]; i++; return fin({ t: 'in', e: l, set: inList(), opStart: kt.start, opEnd: kt.end }); }
    if (word('like')) { const kt = toks[i]; i++; return fin({ t: 'matches', e: l, re: likeToRegex(eatStr()), opStart: kt.start, opEnd: kt.end }); }
    if (word('matches')) { const kt = toks[i]; i++; const re = eatStr(); checkPattern(re); return fin({ t: 'matches', e: l, re, opStart: kt.start, opEnd: kt.end }); }
    if (word('not')) {                                                    // postfix negation: `x not in/contains/like …`
      if (peekWord('in')) { i += 2; return fin({ t: 'not', e: { t: 'in', e: l, set: inList() } }); }
      if (peekWord('contains')) { i += 2; return fin({ t: 'not', e: { t: 'contains', l, r: add() } }); }
      if (peekWord('like')) { i += 2; return fin({ t: 'not', e: { t: 'matches', e: l, re: likeToRegex(eatStr()) } }); }
    }
    if (word('is')) {
      i++;
      let neg = false; if (word('not')) { neg = true; i++; }              // `is not blank` / `is not filled`
      if (word('blank')) { i++; return fin(neg ? { t: 'isfilled', e: l } : { t: 'isblank', e: l }); }
      if (word('filled')) { i++; return fin(neg ? { t: 'isblank', e: l } : { t: 'isfilled', e: l }); }
      fail("'is' must be followed by 'blank' or 'filled'");
    }
    return l;
  }
  function notE() { if (word('not')) { i++; return { t: 'not', e: comparison() }; } return comparison(); }
  function andE() { let l = notE(); while (word('and') || op('&&')) { const jt = toks[i]; i++; l = { t: 'and', l, r: notE(), jStart: jt.start, jEnd: jt.end }; } return l; }
  function orE() { let l = andE(); while (word('or') || op('||')) { const jt = toks[i]; i++; l = { t: 'or', l, r: andE(), jStart: jt.start, jEnd: jt.end }; } return l; }
  function expr() { const st = toks[i] ? toks[i].start : 0; const n = orE(); if (n && typeof n === 'object' && n.start == null) { n.start = st; n.end = toks[i - 1] ? toks[i - 1].end : st; } return n; }   // extent on anything span-less (args, and/or)

  const ast = expr();
  if (i < toks.length) fail(`trailing input near '${toks[i].v}'`);
  return ast;
}

export const asAst = (x, opts) => (typeof x === 'string' ? parse(x, opts) : x);

// ── tokenize: classified, positioned tokens for syntax highlighting + completion.
// Best-effort (tolerant lexer) so it works on a half-typed expression. kinds:
// column · string · number · operator · punct · keyword · function · boolean · error.
export function tokenize(src, opts) {
  const D = dialect(opts);
  const raw = lexAll(String(src == null ? '' : src), true);
  // one-token lookaround (skipping comments) so classification matches the PARSER:
  // a CALLFNS word is a 'function' only when a '(' follows (else it's a column,
  // e.g. a column literally named `round`); `blank` is a 'keyword' only inside
  // `is [not] blank` — elsewhere it's the value LITERAL (painted like true/false).
  const prevAt = (j) => { for (let q = j - 1; q >= 0; q--) if (raw[q].k !== 'comment') return q; return -1; };
  const nextAt = (j) => { for (let q = j + 1; q < raw.length; q++) if (raw[q].k !== 'comment') return q; return -1; };
  const wordAt = (q) => (q >= 0 && raw[q].k === 'word' ? String(raw[q].v).toLowerCase() : null);
  return raw.map((t, i) => {
    let kind;
    if (t.k === 'err') kind = 'error';
    else if (t.k === 'comment') kind = 'comment';
    else if (t.k === 'str') kind = 'string';
    else if (t.k === 'num') kind = 'number';
    else if (t.k === 'field') kind = 'column';
    else if (t.k === 'op') kind = (t.v === '(' || t.v === ')' || t.v === ',') ? 'punct' : 'operator';
    else {
      const lw = String(t.v).toLowerCase();
      if (lw === 'true' || lw === 'false') kind = 'boolean';
      else if (lw === 'blank') {
        const p1 = prevAt(i), w1 = wordAt(p1);
        kind = (w1 === 'is' || (w1 === 'not' && wordAt(prevAt(p1)) === 'is')) ? 'keyword' : 'boolean';
      }
      else if (CALLFNS[lw] || (D.aggregates && AGGREGATES[lw])) { const n = nextAt(i); kind = (n >= 0 && raw[n].k === 'op' && raw[n].v === '(') ? 'function' : 'column'; }
      else kind = RESERVED.has(lw) ? 'keyword' : 'column';
    }
    return { kind, value: src.slice(t.start, t.end), start: t.start, end: t.end };
  });
}
