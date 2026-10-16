# @gcu/expr

A small, **total**, **CSP-safe** expression calculus over the fields of one record.
The shared "small tier" of the GCU expression stack — `@gcu/over` is the heavy
cross-record DSL; this is the single-record calculus that powers lamina's
calc-columns and filters (and, in time, strata derived columns, BMA calcols, and
`@gcu/sift`).

Carried from [hopper](https://github.com/gentropic/hopper)'s rule engine
(`SPEC-hopper-rules`), then adapted for the GCU data stack.

## Why

- **Total** — no expression *ever throws* at eval time. Bad math / wrong types /
  `÷0` / a malformed regex → **blank** (`null`), never an exception. *Totality is
  the security boundary*: a stranger's expression is as safe to open as a menu.
- **CSP-safe** — no `eval`, no `new Function` anywhere. Runs under
  `script-src 'self'`.
- **Two faces** — `evaluate` → a value (calc-columns), `evalBool` → a boolean
  (filters / predicates).
- **Two paths, one semantics** — a tree-walk reference evaluator and a compiled
  positional-closure path that agree bit-for-bit (asserted by a correctness oracle
  over every test vector).
- **Analyzable** — `deps` (the columns an expression touches, for reactive wiring
  + column-pushdown) and `validate` (parse + unknown-column check).

## Language

The canonical surface is **SQL `WHERE`-flavored** — the dialect the data audience
already reads — with a terse `if()` for the value face. C-style spellings still
parse (silently tolerated) so nobody's muscle memory is punished, but the one
documented/highlighted form is SQL.

```
arithmetic     a + b - c * d / e        (unary -, parens; * / bind tighter than + -)
power          au^2   2**10             (right-assoc; -2^2 = -4, 2^-3 = 0.125 — Python/pandas)
compare        =  !=  <  >  <=  >=       (blank-aware: blank = blank → true; NO SQL NULL trap)
boolean        and  or  not             (case-insensitive; short-circuit)
range          grade between 1 and 5
set            lito in ("OXIDE", "SULF")
text           code contains "DDH"  ·  code like "DDH%"  ·  code matches "^DDH"
negate         is not blank · not in (…) · not contains · not like
blank tests    x is blank   x is filled
literals       42   3.14   .5   1.5e-3   "text"   true   false   blank
comments       # to end of line (pandas-style) — expressions can span LINES,
               so a long filter can be formatted and annotated
columns        bare ident (case-insensitive): AU, fe_pct  —  [A-Za-z_][A-Za-z0-9_]*
               backtick escape for anything else: `Assay Au ppm`, `OK-Indic`, `in`
               (\` for a literal backtick, \\ for a backslash — the pandas
               df.query() convention)
               ${name} — XLSForm's reference form, any of [A-Za-z0-9_.-] inside:
               ${site_id}, ${1st_pass}, ${fe-pct}

tolerated (parse, not the canonical form):  ==  <>  &&  ||  ~  !~  'single quotes'  in "a","b"
                                            ["…"] (the legacy bracket escape)
```

> A **bare word is a column**, a **quoted word is text** — like SQL — so `fe > cu`
> compares two columns, while `lito = "OXIDE"` tests a literal. (This is also what
> makes calc-columns like `au * density` work.) Blanks are friendlier than SQL:
> `blank = blank → true` and there's no `= NULL`-returns-nothing trap; use
> `is blank` / `is filled`.

> **`-` is always subtraction** (v0.2): `AU-CU` is arithmetic, as SQL/pandas
> fingers expect. A hyphenated column name takes backticks — `` `OK-Indic` `` —
> and `validate` suggests exactly that when you type it bare.

> **`matches` patterns are checked at parse.** A pattern that could backtrack
> catastrophically on a crafted value — an unbounded or ranged quantifier on a group
> that contains a quantifier or `|` (`(a+)+`, `(x|xx)+`, `(a|b)*`), or a
> backreference — is a parse error, as is an invalid pattern: every expression must
> terminate, and a frozen tab is not termination. Rewrite without the nesting
> (`[ab]*` for `(a|b)*`). `like` never trips it (it builds no groups).

### The form profile (repeat aggregates)

`parse(src, { profile: 'form' })` (or `{ aggregates: true }`) adds aggregates over a
**repeat** — a field whose value is a list of instance objects, as an XLSForm repeat
is. Every function taking `src` takes the same option (`evaluate`, `compile`,
`deps`, `validate`, `canMatch`, `tokenize`; `complete` reads it off its `ctx`).

```
count(samples)            number of instances (blank / non-list → 0)
total(samples.fe_pct)     sum over instances (alias sum); none → 0
mean(samples.fe_pct)      over instances; none → blank
min(samples.fe_pct)       — also max; none → blank
```

The argument is one name split at its first dot into repeat · field —
`samples.fe_pct`, or `${samples.fe-pct}` for any name characters; a backticked name
never splits. Non-numeric instance values are skipped (the blank model).
`min`/`max` are aggregates only for exactly one dotted name: `min(a, b)` and
`min(x)` stay the scalar functions. `deps` reports the repeat. `compileChunk`
declines an aggregate (a list-valued cell is not a column vector) — use `compile`.

**With the option off nothing changes**: `min(samples.fe_pct)` is the scalar `min`
of a column named `samples.fe_pct`, and `count(…)` is not a function. The contract
is `test/fixtures/expr-form-profile.json` — Hopper's own vectors verbatim plus the
profile's additions; Hopper's stored form definitions depend on those meanings.

### Functions (all total — blank/bad input → blank)

| group | functions |
|---|---|
| control | `if(cond, then, else)` — the `blank` literal makes `if(AU = -99, blank, AU)` work |
| rounding | `round(x[, n])` · `int(x)` (truncates) · `floor(x)` · `ceil(x)` · `abs(x)` · `mod(x, y)` (floored, Excel: `mod(-7,3)=2`) |
| binning | `bin(x, w[, origin])` · `clamp(x, lo, hi)` |
| dates | `year(s)` · `month(s)` · `day(s)` — off an ISO `YYYY-MM-DD` string |
| math | `log` (ln) · `log10` (the geochem transform) · `exp` · `sqrt` · `pow(x, y)` · `min(…)` · `max(…)` |
| casts | `ifnum(x, default)` · `coalesce(a, b, …)` — the **only** way a blank becomes a value |
| sentinels | `nullif(x, v)` — `nullif(AU, -99)` scrubs the −99/−999 missing-value convention to blank |
| tests | `isnum(x)` · `isnan(x)` (present but non-numeric) · `isblank(x)` · `isfilled(x)` |
| strings | `upper` · `lower` · `trim` · `len` · `left(s,n)` · `right(s,n)` · `substr(s,start[,len])` (1-based, SQL MID) · `replace(s,find,repl)` (literal, all) · `concat(…)` (skips blanks) |

String semantics: blank in → blank out (`len(blank)` is blank, not 0); results
that come out empty fold to blank (`''` ≡ blank in this model); numbers stringify
(`concat("DDH-", 23)` → `"DDH-23"`). Join-key cleanup is the intended use:
`upper(trim(HOLEID))`.

### The blank model (load-bearing)

Blank ≡ `null`, and a single `absent` notion folds null / `''` / empty-array **and
NaN** together. **Blank propagates by default and never auto-casts to 0** — a
missing grade silently becoming 0 corrupts means and estimates. To opt out
explicitly, use `ifnum`/`coalesce`. `=`/`!=` already do sane missing-equality
(`blank = blank → true`).

**The boolean truth table (deliberate, not SQL 3VL).** `not` is a **set
complement**: a filter and its negation always partition all rows — blanks land
on the `not` side instead of vanishing from both (SQL's most confusing habit).

| where AU is blank | result | note |
|---|---|---|
| `AU > 5` | false | a blank never satisfies an ordering |
| `not (AU > 5)` | **true** | the complement picks it up |
| `AU <= 5` | false | ⇒ `not (AU > 5)` ≠ `AU <= 5` **on blanks** — by design |
| `(AU > 5) and true` | false | `and`/`or` are boolean-strict |
| `(AU > 5) or true` | true | |
| `AU = blank` | true | the friendly non-SQL choice; `is blank` is the idiomatic spelling |

## API

```js
import { parse, evaluate, evalBool, compile, compileBool, deps, validate } from '@gcu/expr';

parse(src, opts?)                // → analyzable AST (throws ExprParseError on bad syntax)
//   opts: { profile: 'form' } / { aggregates: true } — the form profile (above)

evaluate(srcOrAst, valuesObj)    // tree-walk reference path; name-keyed record → value | null
evalBool(srcOrAst, valuesObj)    // → boolean (blank → false)

compileChunk(srcOrAst, columns, opts)     // → (cols, n) => { t, buf } — the COLUMNAR path
compileChunkBool(srcOrAst, columns, opts) // → (cols, n) => Uint8Array 0/1 mask
//   cols: array of column arrays (typed or plain) aligned to `columns`; evaluates the
//   whole chunk per node in tight loops (typed sources pass through zero-copy).
//   ~40× the per-row path on numeric filters (≈600–800 M rows/s), ~7–14× on mixed/calc
//   shapes. Buffers are REUSED across calls — consume before the next call. Semantics
//   are oracle-identical to the row path (chunk ≡ row ≡ tree-walk over every vector).

compile(srcOrAst, columns, opts) // → (fields[]) => value   — the per-row hot path
compileBool(srcOrAst, columns, opts) // → (fields[]) => boolean
//   columns: ['AU','FROM','TO',…]; names bound to ARRAY INDICES at compile time,
//   so the per-row closure takes the positional fields[] with NO per-row object
//   allocation — built for a scan over a 500M-row file.
//   opts.decimal: ',' reads comma-decimal field strings numerically (BR/EU files);
//   evaluate(src, values, {decimal:','}) does the same on the tree-walk path.

deps(srcOrAst)                   // → ['AU','Assay Au ppm',…]  (free column refs)
validate(srcOrAst, columns?)     // → { ok, errors: [{kind, message, name?, suggestion?}] }
//   unknown columns get a did-you-mean: nearest known name (edit distance ≤ 2), or
//   the backticked form when you typed a hyphenated name bare (`OK-Indic`).
canMatch(srcOrAst, ranges)       // → false ONLY if provably no row can match — chunk /
//   row-group push-down over per-column stats: { name: {min, max, hasBlank?} }.
//   Conservative (unknown shapes → true). `!=` prunes only under hasBlank:false —
//   a blank row matches `!=`, and min/max stats say nothing about blanks.
quoteIdent(name)                 // → the name as an expression: plain idents pass,
//   anything else backticked. REQUIRED when treating a column NAME as an expression.
tokenize(src)                    // → [{kind, value, start, end}] — classified, positioned, tolerant
//   kinds: column · string · number · operator · punct · keyword · function · boolean · error.
//   For syntax highlighting + autocomplete; works on a half-typed expression.
complete(src, pos, {columns, values})   // → { from, to, options:[{value, kind, detail}] }
//   context-aware suggestions: columns / functions / keywords / operators, and — in
//   a value position (after `col =`, `col in (`, …) — the column's VALUES, quoted.
//   values: (col)=>string[] | {col:[…]}. The quoted-value suggestions are what close
//   the bare-word-vs-quoted footgun (you pick "OXIDE" instead of typing bare ox).
```

`evaluate` resolves columns by exact case; `compile` resolves **case-insensitively**
against `columns` (so `AU` in the expression finds the `au` column). They agree on
any record whose keys match the column list.

## Build / test

```
node ext/expr/build.js     # → ext/expr/index.js (via @gcu/build)
node --test test/expr.test.mjs
```

The tests are the executable spec: `test/fixtures/expr.json` (carried core +
GCU additions) run through the tree-walk path, then a **`compiled ≡ tree-walk`
oracle** over every vector. `test/fixtures/expr-form-profile.json` does the same
with the form profile on.
