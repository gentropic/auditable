// Columnar ingest — every place plot takes a column (x, y, c, s, weights, bins, data) goes
// through _col, so every array-like works everywhere and big columns are never copied twice.
//
//   typed array          → kept AS IS (no copy; plot never writes into a caller's array)
//   plain Array, numbers → one Float64Array (null / undefined / non-numbers become NaN)
//   plain Array, strings → kept as an Array (category labels, per-point colour names)
//   natra / vec ndarrays → a typed view or copy of their data (natra's lives in Wasm memory,
//                          which can grow and detach a view, so that one is copied)
//   any other iterable   → read once, then as a plain Array
//
// Traces are immutable once added, so anything derived from a column (its finite range, a
// histogram, a raster) is cached ON THE TRACE, never on the caller's array: a caller who
// mutates an array and plots it again gets a fresh trace and fresh numbers.

export function _isArrayLike(v) {
  if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return false;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return true;
  if (typeof v !== 'object' && typeof v !== 'function') return false;
  if (v._nd && v._arr) return true;
  if (v.data && (ArrayBuffer.isView(v.data) || Array.isArray(v.data))) return true;
  return typeof v[Symbol.iterator] === 'function';
}

function _fromPlainArray(a) {
  // numeric → Float64Array; anything holding a string (or a Date, an object) stays an Array
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const v = a[i];
    if (v != null && typeof v !== 'number' && typeof v !== 'boolean') return a;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = a[i]; out[i] = v == null ? NaN : +v; }
  return out;
}

export function _col(x) {
  if (x == null) return new Float64Array(0);
  if (ArrayBuffer.isView(x) && !(x instanceof DataView)) {
    // BigInt columns can't mix with Number arithmetic: those (only those) are converted once
    if ((typeof BigInt64Array !== 'undefined' && x instanceof BigInt64Array) || (typeof BigUint64Array !== 'undefined' && x instanceof BigUint64Array)) return Float64Array.from(x, Number);
    return x;
  }
  if (Array.isArray(x)) return _fromPlainArray(x);
  if (typeof x === 'number' || typeof x === 'boolean') return Float64Array.of(+x);
  if (typeof x === 'string') return [x];
  // natra adder wrapper: {_nd: true, _arr: <descriptor>}
  if (x._nd && x._arr) {
    const a = x._arr;
    if (a.memory && a.memory.buffer && a.dtype === 'f64' && typeof a.ptr === 'number') {
      return new Float64Array(a.memory.buffer, a.ptr, a.length).slice();
    }
    if (a.data) return _col(a.data.subarray ? a.data.subarray(0, a.length) : a.data);
  }
  // data-backed ndarray (vec / numpy-like): a view on its data, not a copy
  if (x.data && (ArrayBuffer.isView(x.data) || Array.isArray(x.data))) {
    const d = x.data, n = x.length != null ? x.length : d.length;
    if (ArrayBuffer.isView(d)) return n === d.length ? d : d.subarray(0, n);
    return _fromPlainArray(n === d.length ? d : d.slice(0, n));
  }
  if (typeof x[Symbol.iterator] === 'function') return _fromPlainArray(Array.from(x));
  return Float64Array.of(+x);
}

// Is this column numbers (a typed array, or a Float64Array we made)?
export function _isNumericCol(a) {
  return ArrayBuffer.isView(a);
}

// A column's finite min and max: { lo, hi, n } with n = 1 when there is any finite value
// (0 when none). NaN and ±Inf never reach a range.
//
// Fast because NaN fails every comparison: the plain min/max loop already skips it. Only an
// infinity can sneak in, and only then does a second, checked pass run.
export function _finiteRange(a) {
  let lo = Infinity, hi = -Infinity;
  if (!_isNumericCol(a)) return { lo, hi, n: 0 };
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === -Infinity || hi === Infinity) {
    lo = Infinity; hi = -Infinity;
    for (let i = 0; i < len; i++) {
      const v = a[i];
      if (v - v !== 0) continue;        // NaN or ±Inf (v - v is NaN for both)
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, hi, n: lo <= hi ? 1 : 0 };
}

// the smallest positive finite value — what a log axis can show (Infinity when none)
export function _minPositive(a) {
  let m = Infinity;
  if (!_isNumericCol(a)) return m;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v > 0 && v < m) m = v; }
  return m;
}

// cached per trace: `trace._cache.range_<key>`; `.minPos` is filled in when a log axis asks
export function _traceRange(trace, key, arr, log = false) {
  const c = trace._cache || (trace._cache = {});
  const k = 'range_' + key;
  const r = c[k] || (c[k] = _finiteRange(arr));
  if (log && r.minPos === undefined) r.minPos = _minPositive(arr);
  return r;
}

// Is a numeric column non-decreasing (ignoring NaN)? Line decimation needs it.
export function _isMonotonic(a) {
  let prev = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) continue;
    if (v < prev) return false;
    prev = v;
  }
  return true;
}

// 0, 1, …, n-1 — the x of plot(y)
export function _arange(n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

// Format a count the way an error message should: 1,000 not 1000
export function _fmtCount(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
