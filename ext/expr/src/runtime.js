// @gcu/expr — runtime helpers shared by the tree-walk evaluator (eval.js) and the
// closure compiler (compile.js). Keeping the value semantics in ONE place is what
// makes the two paths bit-identical (the compiler's correctness oracle asserts it).
//
// The model: blank ≡ `null`, and a single `absent` notion folds null/undefined/''/
// empty-array AND NaN together (the `x !== x` keystone), so a missing grade and a
// NaN behave identically — and NEVER auto-cast to 0 (that silently corrupts means /
// estimates; the ifnum/coalesce casts are the *explicit* opt-out). Every helper is
// total: bad input → blank, never a throw.
//
// `num` is the single numeric-coercion point; eval/compile pass a decimal-bound
// `N` (= makeNum(decimal)) into the helpers so a comma-decimal file (BR/EU) reads
// numerically. The default is dot-decimal — existing callers are unaffected.

export function isBlank(v) {
  return v === null || v === undefined || v === '' || v !== v || (Array.isArray(v) && v.length === 0);
}
// Coerce to a finite number or null. Booleans/arrays/blank → null. A comma-decimal
// string is honoured only when decimal === ',' (and only for STRING values — an
// actual number is used directly, so 3.5 never becomes 35).
export function num(v, decimal) {
  if (isBlank(v) || typeof v === 'boolean' || Array.isArray(v)) return null;
  if (decimal === ',' && typeof v === 'string') { const n = Number(v.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// A decimal-bound num for the hot path (compile binds it once; the per-row closures
// close over it, no per-call decimal arg).
export function makeNum(decimal) { return decimal === ',' ? (v) => num(v, ',') : num; }

function ord(a, b, o) { return o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : a >= b; }
export function eq(a, b, N = num) {
  if (isBlank(a) && isBlank(b)) return true;       // blank = blank → true
  if (isBlank(a) || isBlank(b)) return false;      // x = blank → false
  const na = N(a), nb = N(b);
  return (na !== null && nb !== null) ? na === nb : String(a) === String(b);
}
export function compare(a, b, o, N = num) {
  if (o === '=') return eq(a, b, N);
  if (o === '!=') return !eq(a, b, N);
  if (isBlank(a) || isBlank(b)) return null;       // ordering on blank → blank
  const na = N(a), nb = N(b);
  return (na !== null && nb !== null) ? ord(na, nb, o) : ord(String(a), String(b), o);
}

const fin = (x) => (Number.isFinite(x) ? x : null);   // ±Inf / NaN → blank (totality)
// String coercion: blank/boolean/object → blank; numbers stringify. The single
// string-coercion point (the S to num's N). NB '' folds to blank in this model, so
// string results that come out empty are returned as blank (|| null below).
const S = (v) => (isBlank(v) || typeof v === 'boolean' || typeof v === 'object' ? null : String(v));

// Eager pure functions: name → (args[], N) => value. Args are already-evaluated
// values; N is the decimal-bound num. `if` is NOT here (lazy branches — handled in
// each path). Every fn returns blank on bad/blank input unless it's an explicit cast.
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const FN = {
  round: (a, N) => { const x = N(a[0]); if (x === null) return null; const d = a.length > 1 ? Math.trunc(N(a[1]) || 0) : 0; const f = Math.pow(10, d); return Math.round(x * f) / f; },
  int: (a, N) => { const x = N(a[0]); return x === null ? null : Math.trunc(x); },
  abs: (a, N) => { const x = N(a[0]); return x === null ? null : Math.abs(x); },
  log: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.log(x)); },
  exp: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.exp(x)); },
  sqrt: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.sqrt(x)); },
  pow: (a, N) => { const x = N(a[0]), y = N(a[1]); return (x === null || y === null) ? null : fin(Math.pow(x, y)); },
  min: (a, N) => { const ns = a.map((v) => N(v)).filter((x) => x !== null); return ns.length ? Math.min(...ns) : null; },
  max: (a, N) => { const ns = a.map((v) => N(v)).filter((x) => x !== null); return ns.length ? Math.max(...ns) : null; },
  clamp: (a, N) => { const x = N(a[0]), lo = N(a[1]), hi = N(a[2]); return (x === null || lo === null || hi === null) ? null : Math.min(Math.max(x, lo), hi); },
  lerp: (a, N) => { const x = N(a[0]), y = N(a[1]), t = N(a[2]); return (x === null || y === null || t === null) ? null : lerpK(x, y, t); },
  remap: (a, N) => { const v = a.map((u) => N(u)); return v.some((u) => u === null) ? null : remapK(v[0], v[1], v[2], v[3], v[4]); },
  smoothstep: (a, N) => { const lo = N(a[0]), hi = N(a[1]), x = N(a[2]); return (lo === null || hi === null || x === null) ? null : smoothK(lo, hi, x); },
  interp: (a, N) => {                                     // piecewise-linear through (xi, yi) pairs; flat beyond the ends
    const x = N(a[0]); if (x === null) return null;
    const k = (a.length - 1) >> 1, xs = new Array(k), ys = new Array(k);
    for (let j = 0; j < k; j++) { const xi = N(a[1 + 2 * j]), yi = N(a[2 + 2 * j]); if (xi === null || yi === null) return null; xs[j] = xi; ys[j] = yi; }
    sortKnots(xs, ys);
    return interpK(x, xs, ys);
  },
  bin: (a, N) => { const x = N(a[0]), w = N(a[1]); if (x === null || w === null || w <= 0) return null; const o = a.length > 2 ? (N(a[2]) || 0) : 0; return Math.floor((x - o) / w) * w + o; },   // lower edge of x's bin (width w, optional origin)
  year: (a) => datePart(a[0], 1),
  month: (a) => datePart(a[0], 2),
  day: (a) => datePart(a[0], 3),
  floor: (a, N) => { const x = N(a[0]); return x === null ? null : Math.floor(x); },   // int() truncates — differs on negatives
  ceil: (a, N) => { const x = N(a[0]); return x === null ? null : Math.ceil(x); },
  mod: (a, N) => { const x = N(a[0]), y = N(a[1]); return (x === null || y === null || y === 0) ? null : ((x % y) + y) % y; },   // FLOORED (Excel MOD): mod(-7,3)=2
  log10: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.log10(x)); },
  // TRIGONOMETRY IN DEGREES — attitudes are degrees, and an expression full of *pi()/180 is a bug waiting
  sin: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.sin(x * D2R)); },
  cos: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.cos(x * D2R)); },
  tan: (a, N) => { const x = N(a[0]); return x === null ? null : fin(Math.tan(x * D2R)); },
  asin: (a, N) => { const x = N(a[0]); return x === null || x < -1 || x > 1 ? null : Math.asin(x) * R2D; },
  acos: (a, N) => { const x = N(a[0]); return x === null || x < -1 || x > 1 ? null : Math.acos(x) * R2D; },
  atan: (a, N) => { const x = N(a[0]); return x === null ? null : Math.atan(x) * R2D; },
  atan2: (a, N) => { const y = N(a[0]), x = N(a[1]); return (y === null || x === null) ? null : Math.atan2(y, x) * R2D; },
  azimuth: (a, N) => { const x = N(a[0]); return x === null ? null : ((x % 360) + 360) % 360; },   // any angle → 0–360
  // the AXIAL angle (0–90) between two directions given as trend/plunge — a line and its opposite are one axis
  angle: (a, N) => {
    const v = a.slice(0, 4).map((u) => N(u)); if (a.length < 4 || v.some((u) => u === null)) return null;
    const d = (t, p) => [Math.cos(p * D2R) * Math.sin(t * D2R), Math.cos(p * D2R) * Math.cos(t * D2R), -Math.sin(p * D2R)];
    const u = d(v[0], v[1]), w = d(v[2], v[3]), c = Math.abs(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]);
    return Math.acos(Math.min(1, c)) * R2D;
  },   // log() is ln; grades are lognormal — log10 is the geochem transform
  ifnum: (a, N) => { const x = N(a[0]); return x === null ? a[1] : x; },          // x if numeric, else the default
  coalesce: (a) => { for (const v of a) if (!isBlank(v)) return v; return null; }, // first non-blank
  nullif: (a, N) => (eq(a[0], a[1], N) ? null : a[0]),    // sentinel scrub: nullif(AU, -99)
  isnum: (a, N) => N(a[0]) !== null,
  isnan: (a, N) => !isBlank(a[0]) && N(a[0]) === null,    // present but not a number (junk cell)
  isblank: (a) => isBlank(a[0]),
  isfilled: (a) => !isBlank(a[0]),
  // ── strings (hole-ID munging, join-key cleanup). Blank in → blank out, except
  // where noted; empty results fold to blank ('' ≡ blank in this model).
  upper: (a) => { const s = S(a[0]); return s === null ? null : s.toUpperCase(); },
  lower: (a) => { const s = S(a[0]); return s === null ? null : s.toLowerCase(); },
  trim: (a) => { const s = S(a[0]); return s === null ? null : (s.trim() || null); },
  len: (a) => { const s = S(a[0]); return s === null ? null : s.length; },        // len(blank) = blank, not 0
  left: (a, N) => { const s = S(a[0]), n = N(a[1]); return (s === null || n === null) ? null : (s.slice(0, Math.max(0, Math.trunc(n))) || null); },
  right: (a, N) => { const s = S(a[0]), n = N(a[1]); return (s === null || n === null || n <= 0) ? null : (s.slice(-Math.trunc(n)) || null); },
  substr: (a, N) => {                                     // 1-BASED start (SQL/Excel MID), optional length
    const s = S(a[0]), st = N(a[1]); if (s === null || st === null) return null;
    const b = Math.max(0, Math.trunc(st) - 1); const ln = a.length > 2 ? N(a[2]) : null;
    return (ln === null ? s.slice(b) : s.slice(b, b + Math.max(0, Math.trunc(ln)))) || null;
  },
  replace: (a) => {                                       // literal replace-ALL. find blank → unchanged; repl blank → delete
    const s = S(a[0]); if (s === null) return null;
    const f = S(a[1]); if (f === null) return s;
    return s.split(f).join(S(a[2]) ?? '') || null;
  },
  concat: (a) => a.map((v) => S(v) ?? '').join('') || null,   // blanks skipped (join-key building); all-blank → blank
};

// ── interpolation kernels: plain finite numbers in (callers have already turned
// blanks away), number-or-blank out. Shared by FN (the row paths) and compile-chunk's
// f64 fast loops, so the columnar engine can't drift from the reference.
export function lerpK(a, b, t) { return fin(a + (b - a) * t); }
export function remapK(x, a1, b1, a2, b2) { return a1 === b1 ? null : fin(a2 + (x - a1) * (b2 - a2) / (b1 - a1)); }
// GLSL smoothstep: t = clamp((x − a)/(b − a), 0, 1) → 3t² − 2t³. a = b is a STEP
// (0 below a, 1 at/above) — GLSL leaves it undefined; a step is what it tends to.
export function smoothK(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
// Knots in increasing x (stable — equal xi keep their order). Cheap when already sorted.
export function sortKnots(xs, ys) {
  let sorted = true;
  for (let j = 1; j < xs.length; j++) if (xs[j] < xs[j - 1]) { sorted = false; break; }
  if (sorted) return;
  const ord = xs.map((_, j) => j).sort((p, q) => xs[p] - xs[q] || p - q);
  const X = ord.map((j) => xs[j]), Y = ord.map((j) => ys[j]);
  for (let j = 0; j < xs.length; j++) { xs[j] = X[j]; ys[j] = Y[j]; }
}
// xs sorted ascending. Below the first knot → y1, above the last → yN; between, the
// segment with the LARGEST xk <= x (so a duplicated knot is right-continuous and no
// segment ever has zero width). x exactly on a knot returns that knot's y exactly.
export function interpK(x, xs, ys) {
  const last = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[last]) return ys[last];
  let lo = 0, hi = last;                                  // invariant: xs[lo] <= x < xs[hi]
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return fin(ys[lo] + (x - xs[lo]) * (ys[hi] - ys[lo]) / (xs[hi] - xs[lo]));
}

function datePart(v, g) {
  const m = isBlank(v) ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? Number(m[g]) : null;
}

// Shared non-function node ops (used by both paths so semantics can't drift).
export function arith(t, a, b) {
  if (a === null || b === null) return null;
  if (t === '+') return a + b;
  if (t === '-') return a - b;
  if (t === '*') return a * b;
  return b === 0 ? null : a / b;                  // ÷0 → blank, never throws
}
export function contains(a, b) {
  if (isBlank(a)) return false;
  const s = String(b);
  return Array.isArray(a) ? a.map(String).includes(s) : String(a).includes(s);
}
// Set membership: the value (stringified) is one of the listed members (stringified).
export function inSet(a, members) {
  if (isBlank(a)) return false;
  const s = String(a);
  return members.some((m) => !isBlank(m) && String(m) === s);
}
export function matches(a, re) {       // re = a precompiled RegExp or null (invalid pattern)
  if (isBlank(a) || !re) return false;
  return re.test(String(a));
}
export function makeRegExp(src) { try { return new RegExp(src); } catch { return null; } }

// Repeat aggregate (dialect option `aggregates`): `list` is the value of the repeat
// field — an array of instance objects; `field` the instance field to read (absent for
// count). A blank or non-list repeat has no instances. Non-numeric values are skipped
// (the blank model: a missing grade is not a 0). count/total of nothing → 0; mean/min/
// max of nothing → blank. Loops, not Math.min(...xs): a long repeat can't blow the stack.
export function aggregate(fn, list, field, N = num) {
  const insts = Array.isArray(list) ? list : [];
  if (fn === 'count') return insts.length;
  let n = 0, sum = 0, lo = Infinity, hi = -Infinity;
  for (const inst of insts) {
    const x = N(inst !== null && typeof inst === 'object' ? inst[field] : undefined);
    if (x === null) continue;
    n++; sum += x; if (x < lo) lo = x; if (x > hi) hi = x;
  }
  if (fn === 'total') return sum;
  if (n === 0) return null;
  return fn === 'min' ? lo : fn === 'max' ? hi : sum / n;
}
