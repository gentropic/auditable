// adder v2 — builtins, modules, format specs
// Python built-in functions, method dispatch, and standard modules.
// All functions are sync unless they need to call user-provided callables
// (which are async since the evaluator is async).

// ── PyRange — lazy range ──

export class AdderRange {
  constructor(start, stop, step) {
    if (stop === undefined) { this.start = 0; this.stop = start; this.step = 1; }
    else { this.start = start; this.stop = stop; this.step = step || 1; }
    if (this.step === 0) throw new AdderError('ValueError', 'range() arg 3 must not be zero');
    this.length = Math.max(0, Math.ceil((this.stop - this.start) / this.step));
  }
  [Symbol.iterator]() {
    let i = this.start;
    const stop = this.stop, step = this.step;
    return { next() {
      if (step > 0 ? i < stop : i > stop) { const v = i; i += step; return { value: v, done: false }; }
      return { done: true };
    }};
  }
  includes(v) {
    if (typeof v !== 'number' || !Number.isInteger(v)) return false;
    if (this.step > 0) { if (v < this.start || v >= this.stop) return false; }
    else { if (v > this.start || v <= this.stop) return false; }
    return (v - this.start) % this.step === 0;
  }
}

// ── tuples, and dict / set keys ──
// A Python tuple is a frozen PyTuple: an Array (so JS code, unpacking, indexing, numpy-style
// arr[i, j] keys and Array.isArray all keep working) that prints (1, 2), refuses mutation, and
// whose derived arrays (map, filter, slice, concat) are plain lists, never tuples by accident.
export class PyTuple extends Array {
  static get [Symbol.species]() { return Array; }
}
PyTuple.prototype.__adderClass__ = 'tuple';
export function mkTuple(items) {
  const t = new PyTuple();
  if (items) for (const x of items) t.push(x);
  return Object.freeze(t);
}
export const isTuple = (v) => v instanceof PyTuple;

// Dict keys and set members, as Python hashes them: equal tuples are ONE object (interned in a
// weakly held table keyed by their contents), so a JS Map / Set finds them; a user object with
// __hash__ is found through its hash and __eq__; lists, dicts and sets are unhashable.
const _interned = new Map();   // signature → [WeakRef, …] (more than one only on a __hash__ collision)
const _internGC = typeof FinalizationRegistry !== 'undefined'
  ? new FinalizationRegistry((sig) => { const l = _interned.get(sig); if (l) { const live = l.filter((r) => r.deref()); if (live.length) _interned.set(sig, live); else _interned.delete(sig); } })
  : null;
const _objIds = new WeakMap();
let _nextObjId = 1;
function _unhashable(v) { return new AdderError('TypeError', `unhashable type: '${pyTypeName(v)}'`); }
function _needsCanon(k) {
  return k !== null && typeof k === 'object' && (k instanceof PyTuple || (k instanceof Set && k._frozen) ||
    (typeof k.__hash__ === 'function' && !(k instanceof Map) && !Array.isArray(k)));
}
function _isUnhashable(k) {
  if (k !== null && typeof k === 'object' && k.__hash__ === null) return true;   // __hash__ = None (an eq dataclass)
  return k !== null && typeof k === 'object' && !(k instanceof PyTuple) &&
    (Array.isArray(k) || k instanceof Map || (k instanceof Set && !k._frozen) || isPlainDict(k)) &&
    typeof k.__hash__ !== 'function';
}
function _sigOf(v) {
  if (v === null || v === undefined) return 'N';
  switch (typeof v) {
    case 'number': return v === 0 ? 'n0' : 'n' + v;
    case 'boolean': return v ? 'n1' : 'n0';
    case 'bigint': return 'n' + v;
    case 'string': return 's' + v.length + ':' + v;
    default: break;
  }
  if (v instanceof PyTuple) return '(' + v.map(_sigOf).join(',') + ')';
  if (v instanceof Set && v._frozen) return 'f{' + [...v].map(_sigOf).sort().join(',') + '}';
  if (_isUnhashable(v)) throw _unhashable(v);
  if (typeof v.__hash__ === 'function') {
    const h = v.__hash__();
    if (h && typeof h.then === 'function') { h.catch(() => {}); let id = _objIds.get(v); if (!id) { id = _nextObjId++; _objIds.set(v, id); } return 'o' + id; }   // a tree-walked (async) __hash__: identity
    return 'h' + h;
  }
  let id = _objIds.get(v);
  if (!id) { id = _nextObjId++; _objIds.set(v, id); }
  return 'o' + id;
}
// hash(x): ints hash to themselves (so 1 == 1.0 == True agree), strings and tuples by their
// contents, objects by __hash__ or identity; lists, dicts, sets and __hash__ = None refuse
export function _pyHash(v) {
  if (v === null || v === undefined) return 0x5f3759df;
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'number') return Number.isInteger(v) ? v : _strHash(String(v));
  if (typeof v === 'bigint') return Number(BigInt.asIntN(53, v));
  if (typeof v === 'string') return _strHash(v);
  if (_isUnhashable(v)) throw _unhashable(v);
  if (typeof v.__hash__ === 'function') return v.__hash__();
  if (v instanceof PyTuple) { let h = 0x345678; for (const x of v) { const xh = _pyHash(x); h = (Math.imul(h ^ (typeof xh === 'number' ? xh | 0 : 0), 1000003)) | 0; } return h; }
  let id = _objIds.get(v);
  if (!id) { id = _nextObjId++; _objIds.set(v, id); }
  return id;
}
function _strHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
// the canonical object for a key being stored (interning it if new)
export function hk(k) {
  if (!_needsCanon(k)) { if (_isUnhashable(k)) throw _unhashable(k); return k; }
  const sig = _sigOf(k);
  const list = _interned.get(sig);
  if (list) {
    for (const r of list) {
      const c = r.deref();
      if (c !== undefined && (c === k || k instanceof PyTuple || (k instanceof Set) || pyEq(c, k) === true)) return c;
    }
  }
  const ref = new WeakRef(k);
  if (list) list.push(ref); else _interned.set(sig, [ref]);
  if (_internGC) _internGC.register(k, sig);
  return k;
}
// the canonical object for a key being looked up (never interns)
function hkLookup(k) {
  if (!_needsCanon(k)) { if (_isUnhashable(k)) throw _unhashable(k); return k; }
  const list = _interned.get(_sigOf(k));
  if (list) {
    for (const r of list) {
      const c = r.deref();
      if (c !== undefined && (c === k || k instanceof PyTuple || (k instanceof Set) || pyEq(c, k) === true)) return c;
    }
  }
  return k;
}
// Python's dict and set: Map / Set whose keys go through hk, so every get / set / has / delete
// (from either engine, or from JS code holding the object) treats equal tuples as one key
export class PyDict extends Map {
  set(k, v) { return super.set(hk(k), v); }
  get(k) { return super.get(hkLookup(k)); }
  has(k) { return super.has(hkLookup(k)); }
  delete(k) { return super.delete(hkLookup(k)); }
}
export class PySet extends Set {
  add(v) { return super.add(hk(v)); }
  has(v) { return super.has(hkLookup(v)); }
  delete(v) { return super.delete(hkLookup(v)); }
}

// ── AdderError ──

export class AdderError extends Error {
  // args: the Python exception's constructor arguments, when known (str/repr use them)
  constructor(pyType, message, adderLine, args) {
    super(`${pyType}: ${message}${adderLine ? ` (line ${adderLine})` : ''}`);
    this.pyType = pyType;
    this.pyMessage = message;
    this.adderLine = adderLine;
    if (args) this.args = mkTuple(args);
  }
}

// ── Complex number ──

export class Complex {
  constructor(real, imag = 0) {
    this.real = typeof real === 'number' ? real : Number(real);
    this.imag = typeof imag === 'number' ? imag : Number(imag);
  }
  __add__(other) {
    if (other instanceof Complex) return new Complex(this.real + other.real, this.imag + other.imag);
    if (typeof other === 'number') return new Complex(this.real + other, this.imag);
  }
  __radd__(left) {
    if (typeof left === 'number') return new Complex(this.real + left, this.imag);
  }
  __sub__(other) {
    if (other instanceof Complex) return new Complex(this.real - other.real, this.imag - other.imag);
    if (typeof other === 'number') return new Complex(this.real - other, this.imag);
  }
  __rsub__(left) {
    if (typeof left === 'number') return new Complex(left - this.real, -this.imag);
  }
  __mul__(other) {
    if (other instanceof Complex) return new Complex(this.real * other.real - this.imag * other.imag, this.real * other.imag + this.imag * other.real);
    if (typeof other === 'number') return new Complex(this.real * other, this.imag * other);
  }
  __rmul__(left) {
    if (typeof left === 'number') return new Complex(this.real * left, this.imag * left);
  }
  __truediv__(other) {
    let or, oi;
    if (other instanceof Complex) { or = other.real; oi = other.imag; }
    else if (typeof other === 'number') { or = other; oi = 0; }
    else return;
    const denom = or * or + oi * oi;
    if (denom === 0) throw new AdderError('ZeroDivisionError', 'complex division by zero');
    return new Complex((this.real * or + this.imag * oi) / denom, (this.imag * or - this.real * oi) / denom);
  }
  __rtruediv__(left) {
    if (typeof left === 'number') return new Complex(left, 0).__truediv__(this);
  }
  __pow__(other) {
    const r = Math.sqrt(this.real * this.real + this.imag * this.imag);
    const theta = Math.atan2(this.imag, this.real);
    if (typeof other === 'number') {
      const newR = Math.pow(r, other);
      const newTheta = other * theta;
      return new Complex(newR * Math.cos(newTheta), newR * Math.sin(newTheta));
    }
    if (other instanceof Complex) {
      const logR = Math.log(r), a = other.real, b = other.imag;
      const newR = Math.exp(a * logR - b * theta);
      const newTheta = b * logR + a * theta;
      return new Complex(newR * Math.cos(newTheta), newR * Math.sin(newTheta));
    }
  }
  __neg__() { return new Complex(-this.real, -this.imag); }
  __abs__() { return Math.sqrt(this.real * this.real + this.imag * this.imag); }
  __eq__(other) {
    if (other instanceof Complex) return this.real === other.real && this.imag === other.imag;
    if (typeof other === 'number') return this.imag === 0 && this.real === other;
    return false;
  }
  __bool__() { return this.real !== 0 || this.imag !== 0; }
  __repr__() {
    if (this.real === 0) return `${this.imag}j`;
    const sign = this.imag >= 0 ? '+' : '';
    return `(${this.real}${sign}${this.imag}j)`;
  }
  __str__() { return this.__repr__(); }
  get conjugate() { return () => new Complex(this.real, -this.imag); }
}

// ── type helpers ──

// type object registry — populated by adderBuiltins()
export const _typeObjects = {};

// adder has two dict representations: a Map (any keys), and a plain JS object for a dict whose
// keys are all strings (a {"a": 1} literal — kept as an object for JS interop). A plain dict is
// an object whose prototype is Object's (or null): class instances have their own prototype,
// and a keyword-argument bag carries _kw.
export function isPlainDict(v) {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return (p === Object.prototype || p === null) && !v._kw && !('__adderType__' in v) && !('__adderClass__' in v);
}

export function pyTypeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (v instanceof PyTuple) return v.__adderClass__ || 'tuple';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Map) return v.__adderClass__ || 'dict';
  if (v instanceof Set) return v._frozen ? 'frozenset' : 'set';
  if (v instanceof AdderRange) return 'range';
  if (v instanceof Complex) return 'complex';
  if (v instanceof Uint8Array) return 'bytes';
  if (typeof v === 'function') return v._pyClass ? 'type' : v._pyFunc ? 'function' : 'builtin_function_or_method';
  if (v?.__adderClass__) return v.__adderClass__;
  if (v instanceof AdderError) return v.pyType;
  if (isPlainDict(v)) return 'dict';
  return 'object';
}

export function pyBool(v) {
  if (v === false || v === null || v === undefined || v === 0 || v === '' || v !== v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (v instanceof AdderRange) return v.length > 0;
  // check __bool__ dunder
  if (typeof v === 'object' && typeof v.__bool__ === 'function') return !!v.__bool__();
  if (typeof v === 'object' && typeof v.__len__ === 'function') return v.__len__() !== 0;
  return true;
}

// Python spells the non-finite floats inf / -inf / nan, never JS's Infinity / NaN
function _numRepr(v) {
  if (v !== v) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  return String(v);
}

// A typed array prints as the Python list of its elements (learn and friends hand them
// back raw). A float-typed array's integral elements keep their '.0'; a `shape` property
// whose product is the length nests the list row-major. Uint8Array is bytes, not here.
function _isListLikeTyped(v) {
  return ArrayBuffer.isView(v) && !(v instanceof DataView) && !(v instanceof Uint8Array);
}
function _typedRepr(v) {
  const isFloat = v instanceof Float64Array || v instanceof Float32Array;
  const el = (x) => {
    if (typeof x === 'bigint') return String(x);
    if (isFloat && Number.isInteger(x) && Math.abs(x) < 1e16) return Object.is(x, -0) ? '-0.0' : `${x}.0`;
    return _numRepr(x);
  };
  const shape = v.shape;
  const n = v.length;
  if (Array.isArray(shape) && shape.length >= 2 && shape.every((d) => Number.isInteger(d) && d >= 0)
      && shape.reduce((a, b) => a * b, 1) === n) {
    const rec = (axis, off) => {
      if (axis === shape.length - 1) {
        const parts = [];
        for (let i = 0; i < shape[axis]; i++) parts.push(el(v[off + i]));
        return `[${parts.join(', ')}]`;
      }
      const stride = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
      const parts = [];
      for (let i = 0; i < shape[axis]; i++) parts.push(rec(axis + 1, off + i * stride));
      return `[${parts.join(', ')}]`;
    };
    return rec(0, 0);
  }
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(el(v[i]));
  return `[${parts.join(', ')}]`;
}

// <generator object g at 0x...>: a generator / iterator object as CPython shows it (the address
// is a per-object id, as CPython's is its memory address)
const _objAddr = (v) => `0x${(_pyHash(v) >>> 0).toString(16).toUpperCase().padStart(16, '0')}`;
function _iterObjRepr(v) {
  if (v === null || typeof v !== 'object') return null;
  const tag = Object.prototype.toString.call(v);
  if (v.__adderClass__ === 'generator' || tag === '[object Generator]' || tag === '[object AsyncGenerator]') {
    return `<${tag === '[object AsyncGenerator]' && !v.__adderClass__ ? 'async_generator' : 'generator'} object ${v._genName || '<genexpr>'} at ${_objAddr(v)}>`;
  }
  return null;
}

export function pyRepr(v) {
  if (v === null || v === undefined) return 'None';
  { const ir = _iterObjRepr(v); if (ir) return ir; }
  if (v instanceof AdderError) {
    if (v.args) return `${v.pyType}(${v.args.map(pyRepr).join(', ')})`;
    return `${v.pyType}(${v.pyMessage === '' || v.pyMessage == null ? '' : pyRepr(String(v.pyMessage))})`;
  }
  // a user exception instance without its own __repr__: Name(args)
  if (v && typeof v === 'object' && typeof v.__repr__ !== 'function' && isExceptionClass(v.__adderType__)) {
    return `${v.__adderType__._pyName}(${(v.args || []).map(pyRepr).join(', ')})`;
  }
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return _strRepr(v);
  if (typeof v === 'number') return _numRepr(v);
  if (Array.isArray(v) && typeof v.__repr__ === 'function') return v.__repr__();   // namedtuple & co.
  if (v instanceof PyTuple) return v.length === 1 ? `(${pyRepr(v[0])},)` : `(${v.map(pyRepr).join(', ')})`;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (v instanceof Map && typeof v.__repr__ === 'function') return v.__repr__();
  if (_isListLikeTyped(v)) return _typedRepr(v);
  if (v instanceof Uint8Array) return _bytesRepr(v);
  if (v instanceof Map) {
    const items = [...v.entries()].map(([k, val]) => `${pyRepr(k)}: ${pyRepr(val)}`);
    return `{${items.join(', ')}}`;
  }
  if (v instanceof Set) {
    const body = [...v].map(pyRepr).join(', ');
    if (v._frozen) return v.size ? `frozenset({${body}})` : 'frozenset()';
    return v.size ? `{${body}}` : 'set()';
  }
  if (v instanceof AdderRange) {
    if (v.step === 1) return `range(${v.start}, ${v.stop})`;
    return `range(${v.start}, ${v.stop}, ${v.step})`;
  }
  if (v instanceof Complex) return v.__repr__();
  if (typeof v === 'function') {
    if (v._pyClass) return `<class '${v._pyName || v.name}'>`;
    return `<function ${v._pyName || _jsFnName(v) || '<lambda>'}>`;
  }
  if (typeof v === 'object' && typeof v.__repr__ === 'function') return v.__repr__();
  if (typeof v === 'object' && typeof v.__str__ === 'function') return v.__str__();
  if (isPlainDict(v)) return `{${Object.keys(v).map((k) => `${pyRepr(k)}: ${pyRepr(v[k])}`).join(', ')}}`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v instanceof AdderError) return v.args ? _argsStr(v.pyType, v.args) : String(v.pyMessage ?? '');
  if (v && typeof v === 'object' && typeof v.__str__ !== 'function' && isExceptionClass(v.__adderType__)) return _argsStr(v.__adderType__._pyName, v.args);
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (v instanceof Complex) return v.__str__();
  if (typeof v === 'function' && v._pyClass) return `<class '${v._pyName || v.name}'>`;
  if (typeof v === 'object' && typeof v.__str__ === 'function') return v.__str__();
  return pyRepr(v);
}

// pyStr / pyRepr for values whose user dunders may be async (tree-walked methods are):
// a plain string when nothing on the way returned a Promise, else a Promise of the string.
// print, str(), repr() and the tree-walker's f-strings use these; compiled (AIR) methods
// are sync, so they get plain strings and print stays synchronous.
const _isThenable = (x) => x != null && typeof x.then === 'function';
function _joinMaybe(parts, open, sep, close) {
  return parts.some(_isThenable)
    ? Promise.all(parts).then((ps) => open + ps.join(sep) + close)
    : open + parts.join(sep) + close;
}
function _hasUserDunder(v, name) {
  return v !== null && typeof v === 'object' && typeof v[name] === 'function'
    && !(v instanceof Complex) && !ArrayBuffer.isView(v);
}
export function pyReprMaybe(v) {
  { const ir = _iterObjRepr(v); if (ir) return ir; }
  if (Array.isArray(v) && typeof v.__repr__ === 'function') { const r = v.__repr__(); return _isThenable(r) ? r.then(String) : String(r); }
  if (v instanceof PyTuple) return _joinMaybe(v.map(pyReprMaybe), '(', ', ', v.length === 1 ? ',)' : ')');
  if (Array.isArray(v)) return _joinMaybe(v.map(pyReprMaybe), '[', ', ', ']');
  if (v instanceof Map && typeof v.__repr__ === 'function') return v.__repr__();
  if (v instanceof Map) {
    if (v.size === 0) return '{}';
    const parts = [...v.entries()].map(([k, val]) => {
      const a = pyReprMaybe(k), b = pyReprMaybe(val);
      return _isThenable(a) || _isThenable(b) ? Promise.all([a, b]).then(([x, y]) => `${x}: ${y}`) : `${a}: ${b}`;
    });
    return _joinMaybe(parts, '{', ', ', '}');
  }
  if (_hasUserDunder(v, '__repr__')) {
    const r = v.__repr__();
    return _isThenable(r) ? r.then(String) : String(r);
  }
  if (isPlainDict(v)) {
    const parts = Object.keys(v).map((k) => {
      const b = pyReprMaybe(v[k]);
      return _isThenable(b) ? b.then((y) => `${pyRepr(k)}: ${y}`) : `${pyRepr(k)}: ${b}`;
    });
    return _joinMaybe(parts, '{', ', ', '}');
  }
  return pyRepr(v);
}
export function pyStrMaybe(v) {
  if (typeof v === 'string') return v;
  if (v instanceof AdderError) return pyStr(v);
  if (v && typeof v === 'object' && typeof v.__str__ !== 'function' && isExceptionClass(v.__adderType__)) return pyStr(v);
  if (_hasUserDunder(v, '__str__')) {
    const r = v.__str__();
    return _isThenable(r) ? r.then(String) : String(r);
  }
  return pyReprMaybe(v);
}

// repr of a str, as Python writes it: single quotes unless the text has a ' and no ",
// backslash escapes for \\ \n \r \t and the other control characters
function _strRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return out + q;
}

// int(str, base): Python's whole-string rule (JS parseInt stops at the first bad digit and
// accepts "12abc"): optional sign, a 0x/0o/0b prefix (required to match a 16/8/2 base, or
// choosing the base when base is 0), underscores between digits, surrounding whitespace.
function _parseIntStrict(str, base) {
  const bad = () => new AdderError('ValueError', `invalid literal for int() with base ${base}: ${pyRepr(str)}`);
  if (base !== 0 && (base < 2 || base > 36)) throw new AdderError('ValueError', 'int() base must be >= 2 and <= 36, or 0');
  const m = /^\s*([+-]?)(0[xXoObB])?((?:[0-9a-zA-Z]_?)*[0-9a-zA-Z])\s*$/.exec(str);
  if (!m) throw bad();
  const pref = m[2] ? m[2][1].toLowerCase() : null;
  const pbase = pref === 'x' ? 16 : pref === 'o' ? 8 : pref === 'b' ? 2 : null;
  let b = base;
  if (base === 0) {
    b = pbase || 10;
    if (!pbase && /^0+[1-9]/.test(m[3])) throw bad();   // base 0 refuses leading zeros
  } else if (pbase && pbase !== base) {
    throw bad();
  }
  const digits = m[3].replace(/_/g, '').toLowerCase();
  let n = 0n;
  for (const ch of digits) {
    const d = parseInt(ch, 36);
    if (Number.isNaN(d) || d >= b) throw bad();
    n = n * BigInt(b) + BigInt(d);
  }
  if (m[1] === '-') n = -n;
  return Number(n);
}

// ── iteration helper ──

export function* pyIter(obj) {
  if (obj === null || obj === undefined) throw new AdderError('TypeError', `'${pyTypeName(obj)}' object is not iterable`);
  if (Array.isArray(obj) || typeof obj === 'string' || obj instanceof Uint8Array) { for (let i = 0; i < obj.length; i++) yield obj[i]; return; }
  if (obj instanceof Map) { for (const k of obj.keys()) yield k; return; }
  if (obj instanceof Set || obj instanceof AdderRange) { yield* obj; return; }
  if (typeof obj[Symbol.iterator] === 'function') { yield* obj; return; }
  // an async iterable (a tree-walked generator) can't be read synchronously: say so, rather
  // than falling through to the plain-object case and yielding nothing
  if (typeof obj[Symbol.asyncIterator] === 'function') throw new AdderError('TypeError', `'${pyTypeName(obj)}' object must be collected asynchronously here (list(...) it first)`);
  if (typeof obj === 'object' && typeof obj.length === 'number') { for (let i = 0; i < obj.length; i++) yield obj[i]; return; }
  // plain object — iterate keys
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) yield k; return; }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object is not iterable`);
}

// a lazy iterator object (map, filter): iterates once, next() works, Python names its type
function _lazyIter(name, genFn) {
  let gen = null;
  const run = () => gen || (gen = genFn());
  return {
    __adderClass__: name,
    [Symbol.asyncIterator]() { return run(); },
    next(v) { return run().next(v); },
    __repr__() { return `<${name} object at ${_objAddr(this)}>`; },
  };
}
// the synchronous twin: a plain JS iterator (for-of reads it lazily), next() works, Python names its type
function _lazySyncIter(name, genFn) {
  let gen = null;
  const run = () => gen || (gen = genFn());
  return {
    __adderClass__: name,
    [Symbol.iterator]() { return run(); },
    next(v) { return run().next(v); },
    __repr__() { return ['count', 'repeat'].includes(name) ? `${name}(...)` : `<${name} object at ${_objAddr(this)}>`; },
  };
}
// can this be read synchronously, item by item? (a list, str, range, dict, set, JS iterator —
// not a user class's __iter__ or a tree-walked generator, which are async)
const _isSyncSource = (v) => v !== null && v !== undefined && !isUserIterable(v) &&
  (typeof v === 'string' || Array.isArray(v) || typeof v[Symbol.iterator] === 'function');
const _isAsyncOnly = (v) => v !== null && typeof v === 'object' && typeof v[Symbol.asyncIterator] === 'function' && typeof v[Symbol.iterator] !== 'function';
// iterate anything adder can loop over, one item at a time (sync, async, or a user __iter__)
export function _pyEach(obj) {
  if (isUserIterable(obj)) return pyIterAsync(obj);
  if (obj && typeof obj[Symbol.asyncIterator] === 'function') return obj;
  return pyIter(obj);
}

// Collect iterable (sync or async) to array
// A user object that iterates the Python way: __iter__ (returning itself or another object
// with __next__, or any JS iterable), or the old __getitem__ protocol (0, 1, 2, … until
// IndexError). Tree-walked dunders are async, so this is an async generator; for-loops and
// list() / sorted() / … go through it.
export function isUserIterable(obj) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Map) &&
    !(obj instanceof Set) && typeof obj[Symbol.iterator] !== 'function' && typeof obj[Symbol.asyncIterator] !== 'function' &&
    (typeof obj.__iter__ === 'function' || typeof obj.__next__ === 'function' || typeof obj.__getitem__ === 'function');
}
const _awaitIf = async (v) => (v && typeof v.then === 'function' ? await v : v);
export async function* pyIterAsync(obj) {
  if (typeof obj.__iter__ === 'function' || typeof obj.__next__ === 'function') {
    const it = typeof obj.__iter__ === 'function' ? await _awaitIf(obj.__iter__()) : obj;
    if (it !== obj && it && typeof it[Symbol.asyncIterator] === 'function') { yield* it; return; }
    if (it !== obj && it && typeof it[Symbol.iterator] === 'function' && typeof it.__next__ !== 'function') { yield* pyIter(it); return; }
    if (!it || typeof it.__next__ !== 'function') throw new AdderError('TypeError', `iter() returned non-iterator of type '${pyTypeName(it)}'`);
    while (true) {
      let v;
      try { v = await _awaitIf(it.__next__()); } catch (e) { if (e && e.pyType === 'StopIteration') return; throw e; }
      yield v;
    }
  }
  for (let i = 0; ; i++) {
    let v;
    try { v = await _awaitIf(obj.__getitem__(i)); } catch (e) { if (e && (e.pyType === 'IndexError' || e.pyType === 'StopIteration')) return; throw e; }
    yield v;
  }
}

export async function pyCollect(obj) {
  if (isUserIterable(obj)) {
    const arr = [];
    for await (const v of pyIterAsync(obj)) arr.push(v);
    return arr;
  }
  if (obj && typeof obj[Symbol.asyncIterator] === 'function') {
    const arr = [];
    for await (const v of obj) arr.push(v);
    return arr;
  }
  return [...pyIter(obj)];
}

// ── format spec ──

export function pyFormatValue(value, spec) {
  // an object that formats itself (Decimal, Fraction, enum members, a user __format__)
  if (value !== null && typeof value === 'object' && typeof value.__format__ === 'function') return value.__format__(spec || '');
  if (!spec) return pyStr(value);
  // parse spec: [[fill]align][sign][z][#][0][width][grouping_option][.precision][type]
  let fill = ' ', align = '', sign = '', width = 0, precision = -1, ftype = '', grouping = '';
  let i = 0;
  // fill + align
  if (i + 1 < spec.length && '<>^='.includes(spec[i + 1])) { fill = spec[i]; align = spec[i + 1]; i += 2; }
  else if (i < spec.length && '<>^='.includes(spec[i])) { align = spec[i]; i++; }
  // sign
  if (i < spec.length && '+-'.includes(spec[i])) { sign = spec[i]; i++; }
  // zero pad
  if (i < spec.length && spec[i] === '0') { if (!align) { fill = '0'; align = '='; } i++; }
  // width
  while (i < spec.length && spec[i] >= '0' && spec[i] <= '9') { width = width * 10 + (+spec[i]); i++; }
  // grouping
  if (i < spec.length && (spec[i] === ',' || spec[i] === '_')) { grouping = spec[i]; i++; }
  // precision
  if (i < spec.length && spec[i] === '.') { i++; precision = 0; while (i < spec.length && spec[i] >= '0' && spec[i] <= '9') { precision = precision * 10 + (+spec[i]); i++; } }
  // type
  if (i < spec.length) ftype = spec[i];

  let result;
  if (typeof value === 'number' && !Number.isFinite(value) && 'fFeEgG%n'.includes(ftype || 'f')) {
    result = value !== value ? 'nan' : 'inf';
    if ('FEG'.includes(ftype) && ftype) result = result.toUpperCase();
    if (value === -Infinity) result = '-' + result;
    else if (sign === '+') result = '+' + result;
    if (ftype === '%') result += '%';
  } else if (ftype === 'd') {
    result = Math.trunc(Number(value)).toString();
    if (sign === '+' && !result.startsWith('-')) result = '+' + result;
  } else if (ftype === 'f' || ftype === 'F') {
    result = Number(value).toFixed(precision >= 0 ? precision : 6);
    if (sign === '+' && !result.startsWith('-')) result = '+' + result;
  } else if (ftype === 'e' || ftype === 'E') {
    const x = Number(value);
    result = (x < 0 || Object.is(x, -0) ? '-' : '') + _fmtExp(Math.abs(x), precision >= 0 ? precision : 6, ftype === 'E', false);
    if (sign === '+' && !result.startsWith('-')) result = '+' + result;
  } else if (ftype === 'g' || ftype === 'G') {
    const x = Number(value);
    result = (x < 0 || Object.is(x, -0) ? '-' : '') + _fmtGeneral(Math.abs(x), precision >= 0 ? precision : 6, ftype === 'G', false);
    if (sign === '+' && !result.startsWith('-')) result = '+' + result;
  } else if (ftype === '%') {
    result = (Number(value) * 100).toFixed(precision >= 0 ? precision : 6) + '%';
    if (sign === '+' && !result.startsWith('-')) result = '+' + result;
  } else if (ftype === 'b') {
    result = Math.trunc(Number(value)).toString(2);
  } else if (ftype === 'o') {
    result = Math.trunc(Number(value)).toString(8);
  } else if (ftype === 'x' || ftype === 'X') {
    result = Math.trunc(Math.abs(Number(value))).toString(16);
    if (ftype === 'X') result = result.toUpperCase();
    if (Number(value) < 0) result = '-' + result;
  } else if (ftype === 'c') {
    result = String.fromCodePoint(Number(value));
  } else if (ftype === 's' || ftype === '') {
    result = typeof value === 'string' ? value : pyStr(value);
    if (precision >= 0) result = result.slice(0, precision);
  } else if (ftype === 'n') {
    result = Number(value).toLocaleString();
  } else {
    // auto: number vs string
    if (typeof value === 'number') {
      result = precision >= 0 ? value.toFixed(precision) : _numRepr(value);
      if (sign === '+' && !result.startsWith('-')) result = '+' + result;
    } else {
      result = pyStr(value);
      if (precision >= 0) result = result.slice(0, precision);
    }
  }

  // grouping
  if (grouping && (ftype === 'd' || ftype === 'f' || ftype === 'F' || ftype === '' || !ftype)) {
    const neg = result.startsWith('-');
    let num = neg ? result.slice(1) : result;
    const dot = num.indexOf('.');
    const intPart = dot >= 0 ? num.slice(0, dot) : num;
    const rest = dot >= 0 ? num.slice(dot) : '';
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, grouping);
    result = (neg ? '-' : '') + grouped + rest;
  }

  // alignment
  if (!align) align = typeof value === 'string' ? '<' : '>';
  if (width > result.length) {
    const pad = width - result.length;
    if (align === '<') result = result + fill.repeat(pad);
    else if (align === '>') result = fill.repeat(pad) + result;
    else if (align === '^') { const left = Math.floor(pad / 2); result = fill.repeat(left) + result + fill.repeat(pad - left); }
    else if (align === '=') {
      // pad after sign
      const signIdx = (result[0] === '-' || result[0] === '+') ? 1 : 0;
      result = result.slice(0, signIdx) + fill.repeat(pad) + result.slice(signIdx);
    }
  }
  return result;
}

// ── method dispatch ──

function _isNativeClass(fn) {
  try { return /^class[\s{]/.test(Function.prototype.toString.call(fn)); } catch { return false; }
}

export function adderGetAttr(obj, attr) {
  if (obj instanceof AdderError) {
    if (attr === 'args') return obj.args || mkTuple(obj.pyMessage === '' || obj.pyMessage == null ? [] : [obj.pyMessage]);
    if (attr === '__cause__' || attr === '__context__') return obj[attr] ?? null;
    if (attr === '__traceback__') return null;
    if (attr === '__class__') return excTypeOf(obj);
  }
  // functions, classes and builtin type objects (all JS functions here)
  if (typeof obj === 'function') {
    const tn = obj._pyClass && !obj._pyMRO ? obj._pyName : null;
    if (tn === 'dict' && attr === 'fromkeys') return (keys, value = null) => { const ks = [...pyIter(keys)]; return ks.every((k) => typeof k === 'string') ? Object.fromEntries(ks.map((k) => [k, value])) : new PyDict(ks.map((k) => [k, value])); };
    if (tn === 'str' && attr === 'maketrans') return _strMaketrans;
    if ((tn === 'str' || tn === 'list' || tn === 'dict' || tn === 'set') && !attr.startsWith('__')) {
      const get = tn === 'str' ? _strMethod : tn === 'list' ? _listMethod : tn === 'set' ? _setMethod : _mapMethod;
      const probe = tn === 'str' ? '' : tn === 'list' ? [] : tn === 'set' ? new PySet() : new PyDict();
      let ok = true;
      try { get(probe, attr); } catch { ok = false; }
      if (ok) { const fn = (self, ...a) => (tn === 'dict' && isPlainDict(self) && _objDictMethods[attr] ? _objDictMethods[attr](self) : get(self, attr))(...a); fn._pyName = `${tn}.${attr}`; return fn; }
    }
    if (attr === '__name__' || attr === '__qualname__') return (typeof obj.__name__ === 'string' && obj.__name__) || obj._pyName || _jsFnName(obj) || '<function>';
    if (attr === '__doc__') return obj.__doc__ ?? null;
    if (attr === '__module__') return obj.__module__ ?? (obj._pyClass || obj._pyFunc ? '__main__' : 'builtins');
  }
  // string methods
  if (typeof obj === 'string') return _strMethod(obj, attr);
  if (obj instanceof Uint8Array) return _bytesMethod(obj, attr);
  // tuple methods (count, index) — a tuple has none of list's mutators
  // (a namedtuple class adds its fields and _asdict / _replace / _fields on its own prototype)
  if (obj instanceof PyTuple) {
    if (attr === 'count' || attr === 'index') return _listMethod(obj, attr);
    if (attr in obj && !(attr in Array.prototype)) {
      const v = obj[attr];
      return typeof v === 'function' && !v._pyClass ? v.bind(obj) : v;
    }
    throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${attr}'`);
  }
  // list methods
  if (Array.isArray(obj)) return _listMethod(obj, attr);
  // dict (Map) methods — a Map subclass (Counter, defaultdict, OrderedDict) answers with its own first
  if (obj instanceof Map) {
    if (Object.getPrototypeOf(obj) !== Map.prototype && Object.getPrototypeOf(obj) !== PyDict.prototype && attr in obj && !(attr in Map.prototype)) {
      const v = obj[attr];
      return typeof v === 'function' ? v.bind(obj) : v;
    }
    return _mapMethod(obj, attr);
  }
  // set methods
  if (obj instanceof Set) return _setMethod(obj, attr);
  // numpy-shape Float64Array — common when learn/scitra return a
  // flat ndarray with `.shape` tacked on. Expose the numpy methods
  // (.mean, .var, .std, .sum, .min, .max) and dunder-like shape/ndim/
  // size properties so `x.mean(axis=0)` works on these without each
  // library having to ship its own wrapper class.
  if (obj instanceof Float64Array && Array.isArray(obj.shape)) {
    const v = _ndarrayProp(obj, attr);
    if (v !== undefined) return v;
  }
  // range
  if (obj instanceof AdderRange) {
    if (attr === 'start') return obj.start;
    if (attr === 'stop') return obj.stop;
    if (attr === 'step') return obj.step;
  }
  // plain object (dict with string keys)
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Array) && !(obj instanceof Map) && !(obj instanceof Set)) {
    // check for adder class method on prototype
    if (typeof obj[attr] === 'function') {
      if (_isNativeClass(obj[attr]) || obj[attr]._pyClass) return obj[attr];   // a class (binascii.Error, enum.Enum): never bound
      // adder functions expect self as first arg — inject it (skip for modules)
      if (obj[attr]._pyFunc && !obj.__adderModule__) {
        const originalFn = obj[attr];
        const fn = (...args) => originalFn(obj, ...args);
        fn._pyFunc = true;
        fn._pyName = `${attr}`;
        return fn;
      }
      const original = obj[attr];
      const fn = original.bind(obj);
      // Function.prototype.bind drops custom properties off the original
      // (`t.cdf`, `t.pdf` etc. — scipy-style "callable namespace" pattern).
      // Copy them over so dotted access (`stats.t.cdf`) still resolves.
      for (const k of Object.getOwnPropertyNames(original)) {
        if (k === 'length' || k === 'name' || k === 'prototype') continue;
        try { fn[k] = original[k]; } catch {}
      }
      fn._pyName = attr;
      return fn;
    }
    // regular property access (before dict-like methods, so getters/own props take priority)
    if (attr in obj) return obj[attr];
    // dict-like attribute access — keys, values, items, get, etc.
    if (_objDictMethods[attr]) return _objDictMethods[attr](obj);
    // __getattr__ dunder
    if (typeof obj.__getattr__ === 'function') return obj.__getattr__(attr);
    throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${attr}'`);
  }
  // generic
  if (obj !== null && obj !== undefined && attr in obj) {
    const val = obj[attr];
    if (typeof val === 'function') {
      if (_isNativeClass(val) || val._pyClass) return val;
      if (val._pyFunc) { const fn = (...args) => val(obj, ...args); fn._pyFunc = true; fn._pyName = attr; return fn; }
      return val.bind(obj);
    }
    return val;
  }
  throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${attr}'`);
}

// Python's str methods. Keyword arguments arrive as a trailing {_kw} bag (_kwSplit).
function _kwSplit(args, names) {
  const a = args.slice();
  const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : null;
  if (kw) names.forEach((n, i) => { if (Object.hasOwn(kw, n)) a[i] = kw[n]; });
  return a;
}
// slice bounds as Python's str methods take them (None, negative, past the end)
function _bounds(len, start, end) {
  let st = start == null ? 0 : start < 0 ? Math.max(0, len + start) : Math.min(start, len);
  let en = end == null ? len : end < 0 ? Math.max(0, len + end) : Math.min(end, len);
  return [st, en];
}
const _LINE_BREAKS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

function _strMethod(s, attr) {
  const m = {
    upper: () => s.toUpperCase(),
    lower: () => s.toLowerCase(),
    casefold: () => s.toLowerCase().replace(/ß/g, 'ss'),
    strip: (chars) => (chars == null ? s.trim() : _stripChars(s, chars)),
    lstrip: (chars) => (chars == null ? s.trimStart() : _lstripChars(s, chars)),
    rstrip: (chars) => (chars == null ? s.trimEnd() : _rstripChars(s, chars)),
    split: (...args) => {
      let [sep, maxsplit] = _kwSplit(args, ['sep', 'maxsplit']);
      if (maxsplit == null || maxsplit < 0) maxsplit = Infinity;
      if (sep == null) {
        const words = [];
        const re = /\S+/g;
        let mm;
        while ((mm = re.exec(s))) {
          if (words.length === maxsplit) { words.push(s.slice(mm.index).trimEnd()); break; }
          words.push(mm[0]);
        }
        return words;
      }
      if (sep === '') throw new AdderError('ValueError', 'empty separator');
      const parts = [];
      let rest = s;
      while (parts.length < maxsplit) { const i = rest.indexOf(sep); if (i < 0) break; parts.push(rest.slice(0, i)); rest = rest.slice(i + sep.length); }
      parts.push(rest);
      return parts;
    },
    rsplit: (...args) => {
      let [sep, maxsplit] = _kwSplit(args, ['sep', 'maxsplit']);
      if (maxsplit == null || maxsplit < 0) return m.split(sep);
      if (sep == null) {
        const words = s.trim().split(/\s+/).filter(Boolean);
        if (words.length <= maxsplit) return words;
        const keep = words.slice(words.length - maxsplit);
        let cut = s.trimEnd();
        for (let i = 0; i < maxsplit; i++) cut = cut.slice(0, cut.lastIndexOf(keep[keep.length - 1 - i])).trimEnd();
        return [cut, ...keep];
      }
      if (sep === '') throw new AdderError('ValueError', 'empty separator');
      const parts = [];
      let rest = s;
      while (parts.length < maxsplit) { const i = rest.lastIndexOf(sep); if (i < 0) break; parts.unshift(rest.slice(i + sep.length)); rest = rest.slice(0, i); }
      parts.unshift(rest);
      return parts;
    },
    join: (iterable) => {
      const finish = (items) => {
        items.forEach((x, i) => { if (typeof x !== 'string') throw new AdderError('TypeError', `sequence item ${i}: expected str instance, ${pyTypeName(x)} found`); });
        return items.join(s);
      };
      // a generator expression / user iterable may be async: collect it first
      if (_isAsyncOnly(iterable) || isUserIterable(iterable)) return pyCollect(iterable).then(finish);
      return finish([...pyIter(iterable)]);
    },
    replace: (old, nw, count) => {
      if (count == null || count < 0) return s.split(old).join(nw);
      let result = '', rest = s, n = 0;
      while (n < count) { const i = rest.indexOf(old); if (i < 0) break; result += rest.slice(0, i) + nw; rest = rest.slice(i + old.length); n++; if (old === '' ) { if (!rest) break; result += rest[0]; rest = rest.slice(1); } }
      return result + rest;
    },
    find: (sub, start, end) => { const [a, b] = _bounds(s.length, start, end); const i = s.slice(a, b).indexOf(sub); return i < 0 ? -1 : i + a; },
    rfind: (sub, start, end) => { const [a, b] = _bounds(s.length, start, end); const i = s.slice(a, b).lastIndexOf(sub); return i < 0 ? -1 : i + a; },
    index: (sub, start, end) => { const i = m.find(sub, start, end); if (i < 0) throw new AdderError('ValueError', 'substring not found'); return i; },
    rindex: (sub, start, end) => { const i = m.rfind(sub, start, end); if (i < 0) throw new AdderError('ValueError', 'substring not found'); return i; },
    count: (sub, start, end) => {
      const [a, b] = _bounds(s.length, start, end);
      const t = s.slice(a, b);
      if (sub === '') return t.length + 1;
      let n = 0, i = 0;
      while ((i = t.indexOf(sub, i)) >= 0) { n++; i += sub.length; }
      return n;
    },
    startswith: (prefix, start, end) => { const [a, b] = _bounds(s.length, start, end); const t = s.slice(a, b); return (Array.isArray(prefix) ? prefix : [prefix]).some((p) => t.startsWith(p)); },
    endswith: (suffix, start, end) => { const [a, b] = _bounds(s.length, start, end); const t = s.slice(a, b); return (Array.isArray(suffix) ? suffix : [suffix]).some((p) => t.endsWith(p)); },
    format: (...args) => _strFormat(s, args),
    format_map: (mapping) => _strFormat(s, [Object.assign({ _kw: true }, mapping instanceof Map ? Object.fromEntries(mapping) : mapping)]),
    encode: () => new TextEncoder().encode(s),
    capitalize: () => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
    title: () => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase()),
    swapcase: () => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''),
    isdigit: () => /^\p{Nd}+$/u.test(s),
    isdecimal: () => /^\p{Nd}+$/u.test(s),
    isnumeric: () => /^\p{N}+$/u.test(s),
    isalpha: () => /^\p{L}+$/u.test(s),
    isalnum: () => /^[\p{L}\p{N}]+$/u.test(s),
    isspace: () => /^\s+$/.test(s),
    isupper: () => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s),
    islower: () => /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s),
    istitle: () => /\p{L}/u.test(s) && s === m.title(),
    isidentifier: () => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s),
    isprintable: () => !/[\x00-\x1f\x7f-\x9f]/.test(s),
    isascii: () => /^[\x00-\x7f]*$/.test(s),
    zfill: (width) => { const sg = s[0] === '-' || s[0] === '+' ? s[0] : ''; const body = sg ? s.slice(1) : s; return sg + body.padStart(width - sg.length, '0'); },
    ljust: (width, fill) => s.padEnd(width, fill || ' '),
    rjust: (width, fill) => s.padStart(width, fill || ' '),
    center: (width, fill) => {
      const f = fill || ' ', pad = width - s.length;
      if (pad <= 0) return s;
      const left = Math.floor(pad / 2) + (pad & width & 1);   // CPython's split of the padding
      return f.repeat(left) + s + f.repeat(pad - left);
    },
    expandtabs: (tabsize) => {
      const ts = tabsize == null ? 8 : tabsize;
      let out = '', col = 0;
      for (const ch of s) {
        if (ch === '\t') { const n = ts > 0 ? ts - (col % ts) : 0; out += ' '.repeat(n); col += n; }
        else { out += ch; col = ch === '\n' || ch === '\r' ? 0 : col + 1; }
      }
      return out;
    },
    partition: (sep) => { const i = s.indexOf(sep); return mkTuple(i < 0 ? [s, '', ''] : [s.slice(0, i), sep, s.slice(i + sep.length)]); },
    rpartition: (sep) => { const i = s.lastIndexOf(sep); return mkTuple(i < 0 ? ['', '', s] : [s.slice(0, i), sep, s.slice(i + sep.length)]); },
    removeprefix: (prefix) => (prefix && s.startsWith(prefix) ? s.slice(prefix.length) : s),
    removesuffix: (suffix) => (suffix && s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s),
    splitlines: (...args) => {
      const [keepends] = _kwSplit(args, ['keepends']);
      const out = [];
      let last = 0, mm;
      _LINE_BREAKS.lastIndex = 0;
      while ((mm = _LINE_BREAKS.exec(s))) { out.push(s.slice(last, keepends ? mm.index + mm[0].length : mm.index)); last = mm.index + mm[0].length; }
      if (last < s.length) out.push(s.slice(last));
      return out;
    },
    maketrans: (...a) => _strMaketrans(...a),
    translate: (table) => {
      let out = '';
      for (const ch of s) {
        const code = ch.codePointAt(0);
        const hit = table instanceof Map ? (table.has(code) ? { v: table.get(code) } : null)
          : table && Object.hasOwn(table, code) ? { v: table[code] } : null;
        if (!hit) out += ch;
        else if (hit.v === null || hit.v === undefined) continue;
        else out += typeof hit.v === 'number' ? String.fromCodePoint(hit.v) : hit.v;
      }
      return out;
    },
  };
  if (attr in m) { const fn = m[attr]; fn._pyName = `str.${attr}`; return fn; }
  throw new AdderError('AttributeError', `'str' object has no attribute '${attr}'`);
}

// str.maketrans(dict) / (from, to[, delete]): a code point → replacement table
function _strMaketrans(x, y, z) {
  const t = new PyDict();
  if (y === undefined) {
    const entries = x instanceof Map ? [...x.entries()] : Object.entries(x);
    for (const [k, v] of entries) t.set(typeof k === 'string' ? k.codePointAt(0) : Number(k), v);
    return t;
  }
  const a = [...x], b = [...y];
  if (a.length !== b.length) throw new AdderError('ValueError', 'the first two maketrans arguments must have equal length');
  a.forEach((ch, i) => t.set(ch.codePointAt(0), b[i].codePointAt(0)));
  if (z) for (const ch of z) t.set(ch.codePointAt(0), null);
  return t;
}

// a dict display with **unpacking: entries in order, later keys win; a plain object when every
// key is a string (as a literal would be), else a Map
export function dictLiteral(keys, values, spreads) {
  const entries = [];
  for (let i = 0; i < keys.length; i++) {
    if (!spreads[i]) { entries.push([keys[i], values[i]]); continue; }
    const src = values[i];
    if (src instanceof Map) entries.push(...src.entries());
    else if (isPlainDict(src)) entries.push(...Object.entries(src));
    else if (src && typeof src.keys === 'function' && typeof src.__getitem__ === 'function') {
      for (const k of pyIter(src.keys())) entries.push([k, src.__getitem__(k)]);
    } else throw new AdderError('TypeError', `'${pyTypeName(src)}' object is not a mapping`);
  }
  const m = new PyDict();
  for (const [k, v] of entries) m.set(k, v);
  return m;
}

// bytes methods: through the latin-1 string view, results back to bytes where Python gives bytes
const _b2s = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
const _s2b = (s) => bytesLit(s);
function _bytesMethod(b, attr) {
  const bytesArg = (x) => (x instanceof Uint8Array ? _b2s(x) : Array.isArray(x) ? x.map(bytesArg) : x);
  const back = (r) => (typeof r === 'string' ? _s2b(r) : Array.isArray(r) ? r.map(back) : r);
  const m = {
    decode: (encoding, errors) => {
      if (encoding && encoding._kw) encoding = encoding.encoding;
      const enc = (encoding || 'utf-8').toLowerCase().replace('_', '-');
      if (enc === 'latin-1' || enc === 'latin1' || enc === 'iso-8859-1' || enc === 'ascii') return _b2s(b);
      try { return new TextDecoder(enc, { fatal: errors !== 'replace' && errors !== 'ignore' }).decode(b); }
      catch { throw new AdderError('UnicodeDecodeError', `'${enc}' codec can't decode bytes`); }
    },
    hex: (sep) => [...b].map((c) => c.toString(16).padStart(2, '0')).join(sep || ''),
  };
  if (attr in m) return m[attr];
  const STR_LIKE = ['startswith', 'endswith', 'find', 'rfind', 'index', 'rindex', 'count', 'replace', 'split', 'rsplit',
    'strip', 'lstrip', 'rstrip', 'upper', 'lower', 'join', 'partition', 'rpartition', 'isdigit', 'isalpha', 'isalnum',
    'isspace', 'isupper', 'islower', 'startswith', 'removeprefix', 'removesuffix', 'center', 'ljust', 'rjust', 'zfill', 'title', 'capitalize', 'splitlines'];
  if (STR_LIKE.includes(attr)) {
    const f = _strMethod(_b2s(b), attr);
    return (...a) => back(f(...a.map(bytesArg)));
  }
  throw new AdderError('AttributeError', `'bytes' object has no attribute '${attr}'`);
}

// a bytes literal's value (latin-1 text from the parser) as bytes
export function bytesLit(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

// repr of bytes: b'…' with Python's quoting and \xNN for the unprintable
function _bytesRepr(b) {
  let hasSq = false, hasDq = false;
  for (const c of b) { if (c === 0x27) hasSq = true; if (c === 0x22) hasDq = true; }
  const q = hasSq && !hasDq ? '"' : "'";
  let out = 'b' + q;
  for (const c of b) {
    if (c === 0x5c) out += '\\\\';
    else if (c === q.charCodeAt(0)) out += '\\' + q;
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
    else out += '\\x' + c.toString(16).padStart(2, '0');
  }
  return out + q;
}

function _stripChars(s, chars) { const cs = new PySet(chars); let l = 0, r = s.length; while (l < r && cs.has(s[l])) l++; while (r > l && cs.has(s[r - 1])) r--; return s.slice(l, r); }
function _lstripChars(s, chars) { const cs = new PySet(chars); let l = 0; while (l < s.length && cs.has(s[l])) l++; return s.slice(l); }
function _rstripChars(s, chars) { const cs = new PySet(chars); let r = s.length; while (r > 0 && cs.has(s[r - 1])) r--; return s.slice(0, r); }

function _strFormat(s, args) {
  let ai = 0;
  return s.replace(/\{([^}]*)\}/g, (_, spec) => {
    let key, fmt;
    const ci = spec.indexOf(':');
    if (ci >= 0) { key = spec.slice(0, ci); fmt = spec.slice(ci + 1); }
    else { key = spec; fmt = ''; }
    let val;
    if (key === '' || key === undefined) val = args[ai++];
    else if (/^\d+$/.test(key)) val = args[parseInt(key)];
    else val = args[0]?.[key];
    return fmt ? pyFormatValue(val, fmt) : pyStr(val);
  });
}

// 2D ndarray-shape methods (Float64Array + .shape). Each axis-aware
// reduction returns either a scalar (axis=None) or a Float64Array
// per-column (axis=0) / per-row (axis=1) with `.shape` attached.
function _ndarrayProp(obj, attr) {
  // Properties
  if (attr === 'shape') return obj.shape.slice();
  if (attr === 'ndim') return obj.shape.length;
  if (attr === 'size') return obj.length;
  if (attr === 'dtype') return 'float64';
  if (attr === 'T') return _ndarrayTranspose(obj);
  if (attr === 'tolist') {
    const fn = () => _ndarrayToList(obj);
    fn._pyName = 'tolist';
    return fn;
  }
  // Reductions
  const _reduce = (axisRedScalar) => {
    const fn = (axisOrKw) => {
      let axis = axisOrKw;
      if (axisOrKw && typeof axisOrKw === 'object' && axisOrKw._kw) {
        axis = axisOrKw.axis;
      }
      return _ndarrayReduce(obj, axis, axisRedScalar);
    };
    fn._pyName = `ndarray.${attr}`;
    return fn;
  };
  switch (attr) {
    case 'mean':
      return _reduce(_R_MEAN);
    case 'sum':
      return _reduce(_R_SUM);
    case 'var':
      return _reduce(_R_VAR);
    case 'std':
      return _reduce(_R_STD);
    case 'min':
      return _reduce(_R_MIN);
    case 'max':
      return _reduce(_R_MAX);
  }
  return undefined;
}

// Reduction "kinds" — small closures (init, step, finalize).
const _R_SUM  = { init: 0,         step: (s, v) => s + v,                                  fin: (s, n) => s };
const _R_MEAN = { init: 0,         step: (s, v) => s + v,                                  fin: (s, n) => n ? s / n : NaN };
const _R_MIN  = { init: Infinity,  step: (s, v) => v < s ? v : s,                          fin: (s, n) => n ? s : NaN };
const _R_MAX  = { init: -Infinity, step: (s, v) => v > s ? v : s,                          fin: (s, n) => n ? s : NaN };
const _R_VAR  = { mean: true,      step: (m, v) => (v - m) * (v - m),                      fin: (s, n) => n ? s / n : NaN };
const _R_STD  = { mean: true,      step: (m, v) => (v - m) * (v - m),                      fin: (s, n) => n ? Math.sqrt(s / n) : NaN };

function _ndarrayReduce(arr, axis, kind) {
  if (arr.shape.length === 1) {
    return _reduce1D(arr, 0, arr.length, kind);
  }
  const [n, m] = arr.shape;
  if (axis == null) {
    // Reduce over everything → scalar
    return _reduce1D(arr, 0, n * m, kind);
  }
  if (axis === 0) {
    // Per-column (m results)
    const out = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const slice = new Float64Array(n);
      for (let i = 0; i < n; i++) slice[i] = arr[i * m + j];
      out[j] = _reduce1D(slice, 0, n, kind);
    }
    out.shape = [m];
    return out;
  }
  if (axis === 1) {
    // Per-row (n results)
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = _reduce1D(arr, i * m, m, kind);
    }
    out.shape = [n];
    return out;
  }
  throw new AdderError('ValueError', `unsupported axis ${axis}`);
}

function _reduce1D(data, start, len, kind) {
  if (kind.mean) {
    // Two-pass for variance / std — need the mean first.
    let s = 0;
    for (let i = 0; i < len; i++) s += data[start + i];
    const m = len ? s / len : 0;
    let v = 0;
    for (let i = 0; i < len; i++) v += kind.step(m, data[start + i]);
    return kind.fin(v, len);
  }
  let acc = kind.init;
  for (let i = 0; i < len; i++) acc = kind.step(acc, data[start + i]);
  return kind.fin(acc, len);
}

function _ndarrayTranspose(arr) {
  if (arr.shape.length === 1) return arr;
  const [n, m] = arr.shape;
  const out = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) out[j * n + i] = arr[i * m + j];
  }
  out.shape = [m, n];
  return out;
}

function _ndarrayToList(arr) {
  if (arr.shape.length === 1) return Array.from(arr);
  const [n, m] = arr.shape;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array(m);
    for (let j = 0; j < m; j++) row[j] = arr[i * m + j];
    out[i] = row;
  }
  return out;
}

function _listMethod(arr, attr) {
  const m = {
    append: (v) => { arr.push(v); return null; },
    extend: (iterable) => { for (const v of pyIter(iterable)) arr.push(v); return null; },
    insert: (i, v) => { arr.splice(i < 0 ? Math.max(0, arr.length + i) : i, 0, v); return null; },
    remove: (v) => { const i = arr.indexOf(v); if (i < 0) throw new AdderError('ValueError', 'list.remove(x): x not in list'); arr.splice(i, 1); return null; },
    pop: (i) => { if (arr.length === 0) throw new AdderError('IndexError', 'pop from empty list'); return i === undefined ? arr.pop() : arr.splice(i < 0 ? arr.length + i : i, 1)[0]; },
    clear: () => { arr.length = 0; return null; },
    index: (v, start, end) => { const i = arr.indexOf(v, start || 0); if (i < 0 || (end !== undefined && i >= end)) throw new AdderError('ValueError', `${pyRepr(v)} is not in list`); return i; },
    count: (v) => arr.filter(x => x === v).length,
    sort: async (key, reverse) => { if (key && key._kw) { reverse = key.reverse; key = key.key; } else if (reverse && reverse._kw) reverse = reverse.reverse; const sorted = await pySorted(arr, key || null, !!reverse); arr.length = 0; arr.push(...sorted); return null; },
    reverse: () => { arr.reverse(); return null; },
    copy: () => [...arr],
  };
  if (attr in m) { const fn = m[attr]; fn._pyName = `list.${attr}`; return fn; }
  throw new AdderError('AttributeError', `'list' object has no attribute '${attr}'`);
}

function _mapMethod(map, attr) {
  const m = {
    keys: () => [...map.keys()],
    values: () => [...map.values()],
    items: () => [...map.entries()].map(mkTuple),
    get: (k, def) => map.has(k) ? map.get(k) : (def !== undefined ? def : null),
    pop: (k, def) => { if (map.has(k)) { const v = map.get(k); map.delete(k); return v; } if (def !== undefined) return def; throw new AdderError('KeyError', pyRepr(k), undefined, [k]); },
    setdefault: (k, def) => { if (map.has(k)) return map.get(k); const v = def !== undefined ? def : null; map.set(k, v); return v; },
    update: (...args) => { for (const other of args) { if (other instanceof Map) { for (const [k, v] of other) map.set(k, v); } else if (Array.isArray(other)) { for (const [k, v] of other) map.set(k, v); } else if (typeof other === 'object' && other !== null) { for (const k of Object.keys(other)) if (k !== '_kw') map.set(k, other[k]); } } return null; },
    popitem: () => { if (!map.size) throw new AdderError('KeyError', "'popitem(): dictionary is empty'"); const k = [...map.keys()].pop(), v = map.get(k); map.delete(k); return mkTuple([k, v]); },
    clear: () => { map.clear(); return null; },
    copy: () => new PyDict(map),
  };
  if (attr in m) { const fn = m[attr]; fn._pyName = `dict.${attr}`; return fn; }
  if (attr === 'size') return map.size;
  throw new AdderError('AttributeError', `'dict' object has no attribute '${attr}'`);
}

const _objDictMethods = {
  keys: (obj) => { const fn = () => Object.keys(obj); fn._pyName = 'dict.keys'; return fn; },
  values: (obj) => { const fn = () => Object.values(obj); fn._pyName = 'dict.values'; return fn; },
  items: (obj) => { const fn = () => Object.entries(obj).map(mkTuple); fn._pyName = 'dict.items'; return fn; },
  get: (obj) => { const fn = (k, def) => (Object.hasOwn(obj, k) ? obj[k] : (def !== undefined ? def : null)); fn._pyName = 'dict.get'; return fn; },
  pop: (obj) => { const fn = (k, def) => { if (Object.hasOwn(obj, k)) { const v = obj[k]; delete obj[k]; return v; } if (def !== undefined) return def; throw new AdderError('KeyError', pyRepr(k), undefined, [k]); }; fn._pyName = 'dict.pop'; return fn; },
  popitem: (obj) => { const fn = () => { const ks = Object.keys(obj); if (!ks.length) throw new AdderError('KeyError', "'popitem(): dictionary is empty'"); const k = ks[ks.length - 1], v = obj[k]; delete obj[k]; return mkTuple([k, v]); }; fn._pyName = 'dict.popitem'; return fn; },
  setdefault: (obj) => { const fn = (k, def) => { if (Object.hasOwn(obj, k)) return obj[k]; obj[k] = def !== undefined ? def : null; return obj[k]; }; fn._pyName = 'dict.setdefault'; return fn; },
  update: (obj) => { const fn = (...args) => { for (const other of args) { if (other instanceof Map) { for (const [k, v] of other) obj[k] = v; } else if (other && other._kw) { for (const k of Object.keys(other)) if (k !== '_kw') obj[k] = other[k]; } else if (Array.isArray(other)) { for (const [k, v] of other) obj[k] = v; } else if (typeof other === 'object' && other !== null) Object.assign(obj, other); } return null; }; fn._pyName = 'dict.update'; return fn; },
  clear: (obj) => { const fn = () => { for (const k of Object.keys(obj)) delete obj[k]; return null; }; fn._pyName = 'dict.clear'; return fn; },
  copy: (obj) => { const fn = () => ({ ...obj }); fn._pyName = 'dict.copy'; return fn; },
};

function _setMethod(set, attr) {
  const m = {
    add: (v) => { set.add(v); return null; },
    remove: (v) => { if (!set.has(v)) throw new AdderError('KeyError', pyRepr(v)); set.delete(v); return null; },
    discard: (v) => { set.delete(v); return null; },
    pop: () => { if (set.size === 0) throw new AdderError('KeyError', 'pop from an empty set'); const v = set.values().next().value; set.delete(v); return v; },
    clear: () => { set.clear(); return null; },
    union: (...others) => { const r = new PySet(set); for (const o of others) for (const v of pyIter(o)) r.add(v); return r; },
    intersection: (...others) => { const r = new PySet(); for (const v of set) { if (others.every(o => { const s = o instanceof Set ? o : new PySet(pyIter(o)); return s.has(v); })) r.add(v); } return r; },
    difference: (...others) => { const r = new PySet(set); for (const o of others) for (const v of pyIter(o)) r.delete(v); return r; },
    symmetric_difference: (other) => { const r = new PySet(set); for (const v of pyIter(other)) { if (r.has(v)) r.delete(v); else r.add(v); } return r; },
    update: (...others) => { for (const o of others) for (const v of pyIter(o)) set.add(v); return null; },
    issubset: (other) => { const o = other instanceof Set ? other : new PySet(pyIter(other)); for (const v of set) if (!o.has(v)) return false; return true; },
    issuperset: (other) => { for (const v of pyIter(other)) if (!set.has(v)) return false; return true; },
    copy: () => new PySet(set),
  };
  if (attr in m) { const fn = m[attr]; fn._pyName = `set.${attr}`; return fn; }
  throw new AdderError('AttributeError', `'set' object has no attribute '${attr}'`);
}

// ── arithmetic: one set of rules for both engines ──
// The tree-walker's _binOp and AIR's _py.add / _py.sub / … are these. A dunder on the left,
// then the reflected one on the right; bools are ints (True + True == 2); sets take | & - ^;
// dicts merge with |; bitwise and shifts stay exact past 32 bits (JS's operators wrap);
// a negative number to a fractional power is complex, as in Python.
const _obj = (v) => v !== null && typeof v === 'object';
const _asInt = (v) => (typeof v === 'boolean' ? +v : v);
function _binErr(sym, a, b) {
  return new AdderError('TypeError', `unsupported operand type(s) for ${sym}: '${pyTypeName(a)}' and '${pyTypeName(b)}'`);
}
function _viaDunder(a, b, d, rd) {
  const refl = () => (_obj(b) && typeof b[rd] === 'function' && b[rd] !== a[d] ? b[rd](a) : NotImplemented);
  const fail = (r) => {
    if (r !== NotImplemented) return r;
    throw new AdderError('TypeError', `unsupported operand type(s) for ${_DUNDER_SYM[d] || d}: '${pyTypeName(a)}' and '${pyTypeName(b)}'`);
  };
  if (_obj(a) && typeof a[d] === 'function') {
    const r = a[d](b);
    if (r && typeof r.then === 'function') return { r: r.then((v) => (v === NotImplemented ? Promise.resolve(refl()).then(fail) : v)) };
    if (r !== NotImplemented) return { r };
    const r2 = refl();
    return { r: r2 && typeof r2.then === 'function' ? r2.then(fail) : fail(r2) };
  }
  if (_obj(b) && typeof b[rd] === 'function') {
    const r = b[rd](a);
    if (r && typeof r.then === 'function') return { r: r.then(fail) };
    return { r: fail(r) };
  }
  return null;
}
const _DUNDER_SYM = { __add__: '+', __sub__: '-', __mul__: '*', __truediv__: '/', __floordiv__: '//', __mod__: '%', __pow__: '** or pow()',
  __matmul__: '@', __and__: '&', __or__: '|', __xor__: '^', __lshift__: '<<', __rshift__: '>>' };
const _isIntish = (v) => (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'boolean' || typeof v === 'bigint';
const _isNum = (v) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint';
const _dictLike = (v) => v instanceof Map || isPlainDict(v);
// exact integer bit operations (BigInt only when a value leaves the 32-bit range)
function _bitOp(op, a, b) {
  a = _asInt(a); b = _asInt(b);
  const fits = (x) => typeof x === 'number' && x >= -2147483648 && x <= 2147483647;
  if (fits(a) && fits(b) && op !== '<<') {
    return op === '&' ? a & b : op === '|' ? a | b : op === '^' ? a ^ b : a >> b;
  }
  const A = BigInt(a), B = BigInt(b);
  const r = op === '&' ? A & B : op === '|' ? A | B : op === '^' ? A ^ B : op === '<<' ? A << B : A >> B;
  return Number(r);
}

export function pyAdd(a, b) {
  const d = _viaDunder(a, b, '__add__', '__radd__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) return _asInt(a) + _asInt(b);
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const ta = a instanceof PyTuple, tb = b instanceof PyTuple;
    if (ta !== tb) throw new AdderError('TypeError', `can only concatenate ${ta ? 'tuple' : 'list'} (not "${pyTypeName(b)}") to ${ta ? 'tuple' : 'list'}`);
    return ta ? mkTuple([...a, ...b]) : [...a, ...b];
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
  throw _binErr('+', a, b);
}
export function pySub(a, b) {
  const d = _viaDunder(a, b, '__sub__', '__rsub__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) return _asInt(a) - _asInt(b);
  if (a instanceof Set && b instanceof Set) return _setLike(a, [...a].filter((x) => !b.has(x)));
  throw _binErr('-', a, b);
}
function _repeat(seq, n) {
  if (!_isIntish(n)) return null;
  n = Number(_asInt(n));
  if (typeof seq === 'string') return n > 0 ? seq.repeat(n) : '';
  if (seq instanceof Uint8Array) { const r = new Uint8Array(Math.max(0, n) * seq.length); for (let i = 0; i < n; i++) r.set(seq, i * seq.length); return r; }
  const r = [];
  for (let i = 0; i < n; i++) r.push(...seq);
  return seq instanceof PyTuple ? mkTuple(r) : r;
}
export function pyMul(a, b) {
  const d = _viaDunder(a, b, '__mul__', '__rmul__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) return _asInt(a) * _asInt(b);
  if (typeof a === 'string' || Array.isArray(a) || a instanceof Uint8Array) { const r = _repeat(a, b); if (r !== null) return r; }
  if (typeof b === 'string' || Array.isArray(b) || b instanceof Uint8Array) { const r = _repeat(b, a); if (r !== null) return r; }
  throw _binErr('*', a, b);
}
export function pyTrueDiv(a, b) {
  const d = _viaDunder(a, b, '__truediv__', '__rtruediv__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) {
    if (Number(b) === 0) throw new AdderError('ZeroDivisionError', 'division by zero');
    return Number(_asInt(a)) / Number(_asInt(b));
  }
  throw _binErr('/', a, b);
}
export function pyFloorDiv(a, b) {
  const d = _viaDunder(a, b, '__floordiv__', '__rfloordiv__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) {
    if (Number(b) === 0) throw new AdderError('ZeroDivisionError', 'integer division or modulo by zero');
    return Math.floor(_asInt(a) / _asInt(b));
  }
  throw _binErr('//', a, b);
}
export function pyMod(a, b) {
  if (typeof a === 'string') return pyPercentFormat(a, b);
  const d = _viaDunder(a, b, '__mod__', '__rmod__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) {
    a = _asInt(a); b = _asInt(b);
    if (Number(b) === 0) throw new AdderError('ZeroDivisionError', 'integer division or modulo by zero');
    let r = a % b;
    if (r !== 0 && (r < 0) !== (b < 0)) r += b;   // the result takes the divisor's sign
    return r;
  }
  throw _binErr('%', a, b);
}
export function pyPow(a, b, mod) {
  if (mod !== undefined && mod !== null) return _modPow(a, b, mod);
  const d = _viaDunder(a, b, '__pow__', '__rpow__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) {
    a = Number(_asInt(a)); b = Number(_asInt(b));
    if (a === 0 && b < 0) throw new AdderError('ZeroDivisionError', '0.0 cannot be raised to a negative power');
    if (a < 0 && !Number.isInteger(b)) {   // complex, as Python: polar form
      const r = Math.pow(-a, b), th = Math.PI * b;
      return new Complex(r * Math.cos(th), r * Math.sin(th));
    }
    return Math.pow(a, b);
  }
  throw _binErr('**', a, b);
}
function _setLike(proto, items) {
  const s = new PySet(items);
  if (proto && proto._frozen) s._frozen = true;
  return s;
}
function _bitwise(sym, a, b, d, rd) {
  const dd = _viaDunder(a, b, d, rd); if (dd) return dd.r;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return sym === '&' ? a && b : sym === '|' ? a || b : a !== b;   // bool & bool is a bool
  }
  if (_isIntish(a) && _isIntish(b)) return _bitOp(sym, a, b);
  if (a instanceof Set && b instanceof Set) {
    if (sym === '|') return _setLike(a, [...a, ...b]);
    if (sym === '&') return _setLike(a, [...a].filter((x) => b.has(x)));
    return _setLike(a, [...[...a].filter((x) => !b.has(x)), ...[...b].filter((x) => !a.has(x))]);
  }
  if (sym === '|' && _dictLike(a) && _dictLike(b)) {
    const entries = [..._dictEntries(a), ..._dictEntries(b)];
    if (!(a instanceof Map) && !(b instanceof Map)) return Object.assign({}, a, b);
    return new PyDict(entries);
  }
  throw _binErr(sym, a, b);
}
export const pyAnd = (a, b) => _bitwise('&', a, b, '__and__', '__rand__');
export const pyOr = (a, b) => (_isTypeLike(a) && _isTypeLike(b) && !(a === null && b === null) ? makeUnion(a, b) : _bitwise('|', a, b, '__or__', '__ror__'));
export const pyXor = (a, b) => _bitwise('^', a, b, '__xor__', '__rxor__');
export function pyLshift(a, b) {
  const d = _viaDunder(a, b, '__lshift__', '__rlshift__'); if (d) return d.r;
  if (_isIntish(a) && _isIntish(b)) { if (_asInt(b) < 0) throw new AdderError('ValueError', 'negative shift count'); return _bitOp('<<', a, b); }
  throw _binErr('<<', a, b);
}
export function pyRshift(a, b) {
  const d = _viaDunder(a, b, '__rshift__', '__rrshift__'); if (d) return d.r;
  if (_isIntish(a) && _isIntish(b)) { if (_asInt(b) < 0) throw new AdderError('ValueError', 'negative shift count'); return _bitOp('>>', a, b); }
  throw _binErr('>>', a, b);
}
export function pyMatmul(a, b) {
  const d = _viaDunder(a, b, '__matmul__', '__rmatmul__'); if (d) return d.r;
  throw _binErr('@', a, b);
}
export function pyNeg(a) {
  if (_isNum(a)) return -_asInt(a);
  if (_obj(a) && typeof a.__neg__ === 'function') return a.__neg__();
  throw new AdderError('TypeError', `bad operand type for unary -: '${pyTypeName(a)}'`);
}
export function pyPos(a) {
  if (_isNum(a)) return +_asInt(a);
  if (_obj(a) && typeof a.__pos__ === 'function') return a.__pos__();
  throw new AdderError('TypeError', `bad operand type for unary +: '${pyTypeName(a)}'`);
}
export function pyInvert(a) {
  if (_isIntish(a)) return -_asInt(a) - 1;
  if (_obj(a) && typeof a.__invert__ === 'function') return a.__invert__();
  throw new AdderError('TypeError', `bad operand type for unary ~: '${pyTypeName(a)}'`);
}
// the binary operators by their Python symbol (the tree-walker dispatches through this)
export const pyBinOps = {
  '+': pyAdd, '-': pySub, '*': pyMul, '/': pyTrueDiv, '//': pyFloorDiv, '%': pyMod, '**': pyPow,
  '&': pyAnd, '|': pyOr, '^': pyXor, '<<': pyLshift, '>>': pyRshift, '@': pyMatmul,
};

// ── printf-style formatting: str % args ──
// %[(key)][flags][width][.precision][length]type, flags - + space 0 #, * for width/precision
export function pyPercentFormat(fmt, args) {
  const isMap = _dictLike(args);
  const list = args instanceof PyTuple ? args : [args];
  let i = 0, usedMap = false;
  const next = () => {
    if (i >= list.length) throw new AdderError('TypeError', 'not enough arguments for format string');
    return list[i++];
  };
  const out = fmt.replace(/%(?:\(([^)]*)\))?([#0\- +]*)(\*|\d+)?(?:\.(\*|\d+))?[hlL]?([diouxXeEfFgGcrsa%])/g,
    (m, key, flags, width, prec, type) => {
      if (type === '%' && key === undefined && !flags && !width && prec === undefined) return '%';
      if (width === '*') width = String(next());
      if (prec === '*') prec = String(next());
      let v;
      if (key !== undefined) {
        if (!isMap) throw new AdderError('TypeError', 'format requires a mapping');
        usedMap = true;
        const o = _dictGet(args, key);
        if (!o) throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
        v = o.v;
      } else if (type !== '%') v = next();
      const left = flags.includes('-'), zero = flags.includes('0') && !left, alt = flags.includes('#');
      const sign = flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
      const p = prec === undefined ? undefined : +prec;
      let body, numeric = true, neg = false;
      const num = () => {
        const n = _asInt(v);
        if (!_isNum(n)) throw new AdderError('TypeError', `%${type} format: a real number is required, not ${pyTypeName(v)}`);
        neg = n < 0 || Object.is(n, -0);
        return Math.abs(Number(n));
      };
      switch (type) {
        case 'd': case 'i': case 'u': body = String(Math.trunc(num())); break;
        case 'o': body = Math.trunc(num()).toString(8); if (alt) body = '0o' + body; break;
        case 'x': body = Math.trunc(num()).toString(16); if (alt) body = '0x' + body; break;
        case 'X': body = Math.trunc(num()).toString(16).toUpperCase(); if (alt) body = '0X' + body; break;
        case 'e': case 'E': body = _fmtExp(num(), p ?? 6, type === 'E', alt); break;
        case 'f': case 'F': { const x = num(); body = Number.isFinite(x) ? x.toFixed(p ?? 6) : (Number.isNaN(x) ? 'nan' : 'inf'); if (type === 'F') body = body.toUpperCase(); break; }
        case 'g': case 'G': body = _fmtGeneral(num(), p ?? 6, type === 'G', alt); break;
        case 'c': numeric = false; body = typeof v === 'string' ? v : String.fromCodePoint(Number(v)); break;
        case 'r': case 'a': numeric = false; body = pyRepr(v); if (p !== undefined) body = body.slice(0, p); break;
        case 's': numeric = false; body = pyStr(v); if (p !== undefined) body = body.slice(0, p); break;
        default: numeric = false; body = '%';
      }
      if (numeric) {
        const sg = neg ? '-' : sign;
        const w = width === undefined ? 0 : +width;
        if (zero && sg.length + body.length < w) body = body.padStart(w - sg.length, '0');
        body = sg + body;
      }
      const w = width === undefined ? 0 : +width;
      return left ? body.padEnd(w) : body.padStart(w);
    });
  if (!isMap && i < list.length) throw new AdderError('TypeError', 'not all arguments converted during string formatting');
  return out;
}

// exponent notation as Python writes it: at least two exponent digits (1.5e+06)
function _fmtExp(x, prec, upper, alt) {
  if (!Number.isFinite(x)) { const s = Number.isNaN(x) ? 'nan' : 'inf'; return upper ? s.toUpperCase() : s; }
  let [m, e] = x.toExponential(prec).split('e');
  if (alt && prec === 0) m += '.';
  const n = +e;
  const s = `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  return upper ? s.toUpperCase() : s;
}
// the 'g' format: precision significant digits, fixed or exponent by the exponent, zeros trimmed
function _fmtGeneral(x, prec, upper, alt) {
  if (!Number.isFinite(x)) { const s = Number.isNaN(x) ? 'nan' : 'inf'; return upper ? s.toUpperCase() : s; }
  const p = prec === 0 ? 1 : prec;
  if (x === 0) return alt ? (0).toFixed(p - 1) : '0';
  const exp = +x.toExponential(p - 1).split('e')[1];
  let s;
  if (exp >= -4 && exp < p) {
    s = x.toFixed(p - 1 - exp);
    if (!alt && s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  } else {
    s = _fmtExp(x, p - 1, false, alt);
    if (!alt) s = s.replace(/\.?0+e/, 'e');
  }
  return upper ? s.toUpperCase() : s;
}

// ── indexing: one set of rules for both engines ──
// obj[key] for a non-slice key. Sequences (str, list, tuple, bytes, typed arrays, range) take
// integers (bools count) with negative indexing and IndexError; dicts raise KeyError (a plain
// object dict only has its own string keys — never its prototype's); __getitem__ wins otherwise.
const _SEQ_NAMES = (obj) => (typeof obj === 'string' ? 'string' : obj instanceof AdderRange ? 'range object' : pyTypeName(obj));
export function pyGetItem(obj, key) {
  if (obj === null || obj === undefined) throw new AdderError('TypeError', `'NoneType' object is not subscriptable`);
  if (obj instanceof Map) {
    if (!obj.has(key)) {
      if (typeof obj.__missing__ === 'function') return obj.__missing__(key);
      throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
    }
    return obj.get(key);
  }
  const isSeq = typeof obj === 'string' || Array.isArray(obj) || obj instanceof AdderRange ||
    (ArrayBuffer.isView(obj) && !(obj instanceof DataView));
  if (isSeq) {
    if (typeof key === 'boolean') key = +key;
    if (typeof key !== 'number' || !Number.isInteger(key)) {
      if (_obj(key) && typeof key.__index__ === 'function') key = key.__index__();
      else throw new AdderError('TypeError', `${pyTypeName(obj)} indices must be integers or slices, not ${pyTypeName(key)}`);
    }
    const n = obj.length;
    const i = key < 0 ? n + key : key;
    if (i < 0 || i >= n) throw new AdderError('IndexError', `${_SEQ_NAMES(obj)} index out of range`);
    return obj instanceof AdderRange ? obj.start + i * obj.step : obj[i];
  }
  if (typeof obj === 'object' || typeof obj === 'function') {
    if (typeof obj.__getitem__ === 'function') return obj.__getitem__(key);
    if (typeof obj === 'function' && obj._pyClass) {
      if (typeof obj.__class_getitem__ === 'function') return obj.__class_getitem__(key);
      return new GenericAlias(obj, key instanceof PyTuple ? [...key] : [key]);
    }
    if (isPlainDict(obj)) {
      if (typeof key === 'string' && Object.hasOwn(obj, key)) return obj[key];
      if (typeof key === 'number' && Object.hasOwn(obj, String(key))) return obj[key];
      throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
    }
    if (key in obj) return obj[key];
    throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
  }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object is not subscriptable`);
}
// range(...)[a:b:c] is a range, as in Python (never materialised)
export function pyRangeSlice(r, lower, upper, step) {
  step = step == null ? 1 : step;
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  const n = r.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let start, stop;
  if (step > 0) {
    start = lower == null ? 0 : clamp(lower < 0 ? n + lower : lower, 0, n);
    stop = upper == null ? n : clamp(upper < 0 ? n + upper : upper, 0, n);
  } else {
    start = lower == null ? n - 1 : clamp(lower < 0 ? n + lower : lower, -1, n - 1);
    stop = upper == null ? -1 : clamp(upper < 0 ? n + upper : upper, -1, n - 1);
  }
  return new AdderRange(r.start + start * r.step, r.start + stop * r.step, r.step * step);
}

// round(x[, ndigits]): half to even on the exact value of x (so round(2.5) == 2 and
// round(2.675, 2) == 2.67, as in CPython); no ndigits gives an int
export function pyRound(x, nd) {
  if (nd && nd._kw) nd = nd.ndigits;
  if (_obj(x) && typeof x.__round__ === 'function') return nd == null ? x.__round__() : x.__round__(nd);
  x = _asInt(x);
  if (typeof x !== 'number') throw new AdderError('TypeError', `type ${pyTypeName(x)} doesn't define __round__ method`);
  if (!Number.isFinite(x)) {
    if (nd == null) throw new AdderError(Number.isNaN(x) ? 'ValueError' : 'OverflowError', Number.isNaN(x) ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer');
    return x;
  }
  const n = nd == null ? 0 : nd;
  if (Number.isInteger(x) && n >= 0) return x;
  if (n < 0) {
    const p = 10 ** -n, q = x / p, f = Math.floor(q), d = q - f;
    const r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    return r * p;
  }
  // the exact decimal expansion of x decides ties (toFixed is exact for |x| < 1e21)
  if (Math.abs(x) >= 1e21) return x;
  const neg = x < 0, ax = Math.abs(x);
  const full = ax.toFixed(Math.min(100, n + 40));
  const [ip, fp] = full.split('.');
  const keep = ip + (fp || '').slice(0, n), rest = (fp || '').slice(n);
  let digits = BigInt(keep || '0');
  const first = rest[0] || '0';
  const tail = rest.slice(1).replace(/0+$/, '');
  if (first > '5' || (first === '5' && tail) || (first === '5' && !tail && (digits % 2n === 1n))) digits += 1n;
  let r = Number(digits) / 10 ** n;
  if (n > 0) r = parseFloat((Number(digits) / 10 ** n).toFixed(n));
  r = neg ? -r : r;
  return nd == null ? (r === 0 ? 0 : r) : r;
}

// ── comparison: one set of rules for both engines ──
// Python's ==, <, <=, >, >= (the tree-walker and AIR both call these). A dunder wins, then its
// reflection on the right operand; numbers and bools compare as numbers (True == 1); lists
// and tuples lexicographically; dicts and sets by content; anything else that Python would
// refuse raises TypeError instead of letting JS coerce (1 < "a" was false, [10] < [9] true).
const _numLike = (v) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint';
const _hasDunder = (v, name) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v[name] === 'function';

function _dictEntries(d) { return d instanceof Map ? [...d.entries()] : Object.keys(d).map((k) => [k, d[k]]); }
function _dictGet(d, k) { return d instanceof Map ? (d.has(k) ? { v: d.get(k) } : null) : (typeof k === 'string' && Object.hasOwn(d, k) ? { v: d[k] } : null); }
function _dictSize(d) { return d instanceof Map ? d.size : Object.keys(d).length; }

export function pyEq(a, b) {
  if (a === b) return true;
  if (_hasDunder(a, '__eq__') || _hasDunder(b, '__eq__')) {
    // a's __eq__, then b's (reflected) when a's says NotImplemented, then identity
    const refl = () => (_hasDunder(b, '__eq__') && b.__eq__ !== a.__eq__ ? b.__eq__(a) : false);
    const last = (v) => (v === NotImplemented ? false : v);
    if (!_hasDunder(a, '__eq__')) { const r = b.__eq__(a); return r && typeof r.then === 'function' ? r.then(last) : last(r); }
    const r = a.__eq__(b);
    if (r && typeof r.then === 'function') return r.then((v) => (v === NotImplemented ? Promise.resolve(refl()).then(last) : v));
    if (r !== NotImplemented) return r;
    const r2 = refl();
    return r2 && typeof r2.then === 'function' ? r2.then(last) : last(r2);
  }
  if (_numLike(a) && _numLike(b)) return Number(a) === Number(b) || (typeof a === 'bigint' || typeof b === 'bigint') && a == b; // eslint-disable-line eqeqeq
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((a instanceof PyTuple) !== (b instanceof PyTuple)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!pyEq(a[i], b[i])) return false;
    return true;
  }
  const da = a instanceof Map || isPlainDict(a), db = b instanceof Map || isPlainDict(b);
  if (da && db) {
    if (_dictSize(a) !== _dictSize(b)) return false;
    for (const [k, v] of _dictEntries(a)) { const o = _dictGet(b, k); if (!o || !pyEq(v, o.v)) return false; }
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a instanceof AdderRange && b instanceof AdderRange) return pyEq([...a], [...b]);
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (a instanceof Complex || b instanceof Complex) return typeof a?.__eq__ === 'function' ? a.__eq__(b) : false;
  return false;
}

function _orderError(op, a, b) {
  return new AdderError('TypeError', `'${op}' not supported between instances of '${pyTypeName(a)}' and '${pyTypeName(b)}'`);
}
// the built-in ordering (no dunders): strict less-than
function _ltPlain(op, a, b) {
  if (_numLike(a) && _numLike(b)) return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  if (a instanceof Uint8Array && b instanceof Uint8Array) return _ltPlain(op, [...a], [...b]);
  if (Array.isArray(a) && Array.isArray(b) && (a instanceof PyTuple) === (b instanceof PyTuple)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const e = pyEq(a[i], b[i]);
      if (!e) return pyLt(a[i], b[i]);
    }
    return a.length < b.length;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size >= b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  // two JS objects of the same class (Date, …) keep JS's ordering
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' &&
      Object.getPrototypeOf(a) === Object.getPrototypeOf(b) && !isPlainDict(a) && !Array.isArray(a)) return a < b;
  throw _orderError(op, a, b);
}
export function pyLt(a, b) {
  if (_hasDunder(a, '__lt__')) return a.__lt__(b);
  if (_hasDunder(b, '__gt__')) return b.__gt__(a);
  return _ltPlain('<', a, b);
}
export function pyGt(a, b) {
  if (_hasDunder(a, '__gt__')) return a.__gt__(b);
  if (_hasDunder(b, '__lt__')) return b.__lt__(a);
  return _ltPlain('>', b, a);
}
export function pyLe(a, b) {
  if (_hasDunder(a, '__le__')) return a.__le__(b);
  if (_hasDunder(b, '__ge__')) return b.__ge__(a);
  if (_numLike(a) && _numLike(b)) return a <= b;
  if (typeof a === 'string' && typeof b === 'string') return a <= b;
  if (a instanceof Set && b instanceof Set) { for (const v of a) if (!b.has(v)) return false; return true; }
  return _ltPlain('<=', a, b) || pyEq(a, b);
}
export function pyGe(a, b) {
  if (_hasDunder(a, '__ge__')) return a.__ge__(b);
  if (_hasDunder(b, '__le__')) return b.__le__(a);
  if (_numLike(a) && _numLike(b)) return a >= b;
  if (typeof a === 'string' && typeof b === 'string') return a >= b;
  if (a instanceof Set && b instanceof Set) return pyLe(b, a);
  return _ltPlain('>=', b, a) || pyEq(a, b);
}

// Python's sort: stable, only `<`, reverse=True keeps equal items in their original order.
// Keys are computed once (a tree-walked key function is async); comparisons that return a
// Promise (an async __lt__) switch to an awaited merge sort.
async function _sortKeys(arr, key) {
  if (!key) return arr.slice();
  const keys = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const k = key(arr[i]);
    keys[i] = k && typeof k.then === 'function' ? await k : k;
  }
  return keys;
}
export async function pySorted(arr, key, reverse) {
  const keys = await _sortKeys(arr, key);
  const order = arr.map((_, i) => i);
  const less = (i, j) => (reverse ? pyLt(keys[j], keys[i]) : pyLt(keys[i], keys[j]));
  let pending = false;
  order.sort((i, j) => {
    if (pending) return 0;
    const lt = less(i, j);
    if (lt && typeof lt.then === 'function') { pending = true; return 0; }
    if (lt) return -1;
    const gt = less(j, i);
    if (gt && typeof gt.then === 'function') { pending = true; return 0; }
    return gt ? 1 : 0;
  });
  if (!pending) return order.map((i) => arr[i]);
  // async comparisons: stable merge sort, awaiting each `<`
  const ms = async (idx) => {
    if (idx.length < 2) return idx;
    const mid = idx.length >> 1;
    const l = await ms(idx.slice(0, mid)), r = await ms(idx.slice(mid));
    const out = [];
    let i = 0, j = 0;
    while (i < l.length && j < r.length) {
      if (await less(r[j], l[i])) out.push(r[j++]); else out.push(l[i++]);
    }
    return out.concat(l.slice(i), r.slice(j));
  };
  return (await ms(arr.map((_, i) => i))).map((i) => arr[i]);
}
// min / max: the first extreme item, by key, through `<`
export async function pyExtreme(which, args) {
  let key = null, dflt, hasDefault = false;
  if (args.length > 0 && args[args.length - 1]?._kw) {
    const kw = args.pop();
    key = kw.key || null;
    if ('default' in kw) { dflt = kw.default; hasDefault = true; }
  }
  const items = args.length === 1 ? await pyCollect(args[0]) : args;
  if (items.length === 0) {
    if (hasDefault) return dflt;
    throw new AdderError('ValueError', `${which}() iterable argument is empty`);
  }
  const keys = await _sortKeys(items, key);
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    let better = which === 'max' ? pyLt(keys[best], keys[i]) : pyLt(keys[i], keys[best]);
    if (better && typeof better.then === 'function') better = await better;
    if (better) best = i;
  }
  return items[best];
}

// ── modules ──

const _mathModule = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, inf: Infinity, nan: NaN,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  pow: Math.pow, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
  fabs: Math.abs, copysign: (x, y) => Math.sign(y) * Math.abs(x),
  isnan: Number.isNaN, isinf: (x) => !isFinite(x) && !isNaN(x), isfinite: Number.isFinite,
  radians: (d) => d * Math.PI / 180, degrees: (r) => r * 180 / Math.PI,
  factorial: (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; },
  gcd: (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; },
  comb: (n, k) => { if (k < 0 || k > n) return 0; if (k === 0 || k === n) return 1; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); },
  perm: (n, k) => { if (k === undefined) k = n; let r = 1; for (let i = 0; i < k; i++) r *= (n - i); return r; },
  hypot: Math.hypot,
  fsum: (iterable) => { let s = 0; for (const v of pyIter(iterable)) s += v; return s; },
  prod: (iterable, start) => { let r = start !== undefined ? start : 1; for (const v of pyIter(iterable)) r *= v; return r; },
  fmod: (x, y) => x % y,
  remainder: (x, y) => x - Math.round(x / y) * y,
  ldexp: (x, i) => x * Math.pow(2, i),
  frexp: (x) => { if (x === 0) return [0, 0]; const e = Math.ceil(Math.log2(Math.abs(x))); return [x / Math.pow(2, e), e]; },
  modf: (x) => { const i = Math.trunc(x); return mkTuple([x - i, i]); },
};

// math: CPython's integer functions are exact (BigInt where the result can leave 2**53)
const _bigToNum = (b) => Number(b);
const _isqrtBig = (n) => {
  if (n < 0n) throw new AdderError('ValueError', 'isqrt() argument must be nonnegative');
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
};
const _needInt = (name, ...vs) => {
  for (const v of vs) if (!(typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint')) {
    throw new AdderError('TypeError', `'${pyTypeName(v)}' object cannot be interpreted as an integer`);
  }
};
Object.assign(_mathModule, {
  isclose: (a, b, kw) => {
    const rel = kw && kw._kw && kw.rel_tol != null ? kw.rel_tol : 1e-9;
    const abs = kw && kw._kw && kw.abs_tol != null ? kw.abs_tol : 0;
    if (a === b) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const d = Math.abs(a - b);
    return d <= Math.abs(rel * b) || d <= Math.abs(rel * a) || d <= abs;
  },
  isqrt: (n) => { _needInt('isqrt', n); return _bigToNum(_isqrtBig(BigInt(Number(n)))); },
  factorial: (n) => {
    _needInt('factorial', n);
    if (n < 0) throw new AdderError('ValueError', 'factorial() not defined for negative values');
    let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; return _bigToNum(r);
  },
  comb: (n, k) => {
    _needInt('comb', n, k);
    if (n < 0 || k < 0) throw new AdderError('ValueError', 'n must be a non-negative integer');
    if (k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1n; for (let i = 0n; i < BigInt(k); i++) r = (r * (BigInt(n) - i)) / (i + 1n); return _bigToNum(r);
  },
  perm: (n, k) => {
    if (k === undefined || k === null) k = n;
    _needInt('perm', n, k);
    if (n < 0 || k < 0) throw new AdderError('ValueError', 'n must be a non-negative integer');
    if (k > n) return 0;
    let r = 1n; for (let i = 0n; i < BigInt(k); i++) r *= BigInt(n) - i; return _bigToNum(r);
  },
  gcd: (...xs) => { _needInt('gcd', ...xs); let g = 0n; for (const x of xs) { let a = BigInt(Math.abs(Number(x))), b = g; while (b) [a, b] = [b, a % b]; g = a; } return _bigToNum(g); },
  lcm: (...xs) => {
    _needInt('lcm', ...xs);
    let l = 1n;
    for (const x of xs) {
      const v = BigInt(Math.abs(Number(x)));
      if (v === 0n) return 0;
      let a = l, b = v; while (b) [a, b] = [b, a % b];
      l = (l / a) * v;
    }
    return _bigToNum(l);
  },
  dist: (p, q) => { const a = [...pyIter(p)], b = [...pyIter(q)]; if (a.length !== b.length) throw new AdderError('ValueError', 'both points must have the same number of dimensions'); return Math.hypot(...a.map((x, i) => x - b[i])); },
  log: (x, base) => {
    if (x <= 0) throw new AdderError('ValueError', 'math domain error');
    return base === undefined ? Math.log(x) : Math.log(x) / Math.log(base);
  },
  sqrt: (x) => { if (x < 0) throw new AdderError('ValueError', 'math domain error'); return Math.sqrt(x); },
  log1p: Math.log1p, expm1: Math.expm1, cbrt: Math.cbrt, exp2: (x) => 2 ** x,
  fmod: (x, y) => { if (y === 0) throw new AdderError('ValueError', 'math domain error'); return x % y; },
  modf: (x) => { const i = Math.trunc(x); return mkTuple([x - i, i]); },
  frexp: (x) => { if (x === 0 || !Number.isFinite(x)) return mkTuple([x, 0]); let e = Math.ceil(Math.log2(Math.abs(x))); let m = x / 2 ** e; if (Math.abs(m) >= 1) { m /= 2; e++; } if (Math.abs(m) < 0.5) { m *= 2; e--; } return mkTuple([m, e]); },
  ldexp: (x, i) => x * 2 ** i,
  fsum: (iterable) => {
    // Shewchuk / Neumaier: exactly rounded like CPython's fsum for ordinary inputs
    const partials = [];
    for (const v of pyIter(iterable)) {
      let x = Number(v);
      let i = 0;
      for (let y of partials) {
        if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
        const hi = x + y, lo = y - (hi - x);
        if (lo) partials[i++] = lo;
        x = hi;
      }
      partials.length = i;
      partials.push(x);
    }
    return partials.reduce((a, b) => a + b, 0);
  },
  prod: (iterable, start) => {
    if (start && start._kw) start = start.start;
    let r = start !== undefined ? start : 1;
    for (const v of pyIter(iterable)) r = pyMul(r, v);
    return r;
  },
  sumprod: (p, q) => { const a = [...pyIter(p)], b = [...pyIter(q)]; return a.reduce((s, x, i) => s + x * b[i], 0); },
  nextafter: (x, y) => { if (x === y) return y; const f = new Float64Array([x]), u = new BigInt64Array(f.buffer); if (x === 0) { f[0] = y > 0 ? 5e-324 : -5e-324; return f[0]; } u[0] += (y > x) === (x > 0) ? 1n : -1n; return f[0]; },
  ulp: (x) => { x = Math.abs(x); if (!Number.isFinite(x)) return x; const f = new Float64Array([x]), u = new BigInt64Array(f.buffer); u[0] += 1n; return f[0] - x; },
});



const _jsModule = new Proxy({}, {
  get(_, prop) { return typeof globalThis !== 'undefined' ? globalThis[prop] : undefined; },
  has(_, prop) { return typeof globalThis !== 'undefined' && prop in globalThis; },
});

const _randomState = { s: [1, 2, 3, 4] };
function _xoshiro128() {
  const s = _randomState.s;
  const result = (s[0] + s[3]) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
  s[2] ^= t; s[3] = (s[3] << 11) | (s[3] >>> 21);
  return result / 4294967296;
}

const _randomModule = {
  random: () => _xoshiro128(),
  seed: (n) => { n = n >>> 0; _randomState.s = [n, n ^ 0x12345678, n ^ 0x9ABCDEF0, n ^ 0xFEDCBA98]; },
  randint: (a, b) => a + Math.floor(_xoshiro128() * (b - a + 1)),
  uniform: (a, b) => a + _xoshiro128() * (b - a),
  choice: (seq) => { const arr = Array.isArray(seq) ? seq : [...pyIter(seq)]; return arr[Math.floor(_xoshiro128() * arr.length)]; },
  shuffle: (lst) => { for (let i = lst.length - 1; i > 0; i--) { const j = Math.floor(_xoshiro128() * (i + 1)); [lst[i], lst[j]] = [lst[j], lst[i]]; } return null; },
  gauss: (mu, sigma) => {
    let u, v, s;
    do { u = 2 * _xoshiro128() - 1; v = 2 * _xoshiro128() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    return mu + sigma * u * Math.sqrt(-2 * Math.log(s) / s);
  },
  sample: (population, k) => {
    const arr = Array.isArray(population) ? [...population] : [...pyIter(population)];
    const result = [];
    for (let i = 0; i < k; i++) { const j = Math.floor(_xoshiro128() * arr.length); result.push(arr.splice(j, 1)[0]); }
    return result;
  },
};

// ── itertools (lazy async iterables) ──

function _aiter(obj) {
  if (obj && typeof obj[Symbol.asyncIterator] === 'function') return obj;
  return pyIter(obj);
}

const _itertoolsModule = {
  chain: (...iterables) => _lazyIter('chain', async function*() {
        for (const it of iterables) for await (const v of _aiter(it)) yield v;
  }),
  product: (...iterables) => _lazyIter('product', async function*() {
        // product(*its, repeat=n): the keyword bag is not an iterable
        const kw = iterables.length && iterables[iterables.length - 1]?._kw ? iterables.pop() : null;
        const repeat = kw && kw.repeat != null ? kw.repeat : 1;
        const base = [];
        for (const it of iterables) base.push(await pyCollect(it));
        const arrs = [];
        for (let r = 0; r < repeat; r++) arrs.push(...base);
        if (arrs.length === 0) { yield mkTuple([]); return; }
        const indices = arrs.map(() => 0);
        while (true) {
          yield mkTuple(indices.map((idx, i) => arrs[i][idx]));
          let i = arrs.length - 1;
          while (i >= 0) { indices[i]++; if (indices[i] < arrs[i].length) break; indices[i] = 0; i--; }
          if (i < 0) break;
        }
  }),
  combinations: (iterable, r) => _lazyIter('combinations', async function*() {
        const pool = await pyCollect(iterable);
        const n = pool.length;
        if (r > n) return;
        const indices = Array.from({ length: r }, (_, i) => i);
        yield mkTuple(indices.map(i => pool[i]));
        while (true) {
          let i = r - 1;
          while (i >= 0 && indices[i] === i + n - r) i--;
          if (i < 0) break;
          indices[i]++;
          for (let j = i + 1; j < r; j++) indices[j] = indices[j - 1] + 1;
          yield mkTuple(indices.map(i => pool[i]));
        }
  }),
  permutations: (iterable, r) => _lazyIter('permutations', async function*() {
        const pool = await pyCollect(iterable);
        const n = pool.length;
        r = r !== undefined ? r : n;
        if (r > n) return;
        const indices = Array.from({ length: n }, (_, i) => i);
        const cycles = Array.from({ length: r }, (_, i) => n - i);
        yield mkTuple(indices.slice(0, r).map(i => pool[i]));
        while (true) {
          let found = false;
          for (let i = r - 1; i >= 0; i--) {
            cycles[i]--;
            if (cycles[i] === 0) { indices.push(indices.splice(i, 1)[0]); cycles[i] = n - i; }
            else { const j = indices.length - cycles[i]; [indices[i], indices[j]] = [indices[j], indices[i]]; yield mkTuple(indices.slice(0, r).map(i => pool[i])); found = true; break; }
          }
          if (!found) break;
        }
  }),
  repeat: (value, times) => _lazySyncIter('repeat', function*() {
        if (times === undefined) { while (true) yield value; }
        else { for (let i = 0; i < times; i++) yield value; }
  }),
  accumulate: (iterable, func) => _lazyIter('accumulate', async function*() {
        let acc, first = true;
        for await (const v of _aiter(iterable)) {
          if (first) { acc = v; first = true; yield acc; first = false; }
          else { acc = func ? func(acc, v) : acc + v; yield acc; }
        }
  }),
  starmap: (func, iterable) => _lazyIter('starmap', async function*() {
        for await (const args of _aiter(iterable)) yield await func(...args);
  }),
  islice: (iterable, ...args) => _lazyIter('islice', async function*() {
        let start = 0, stop, step = 1;
        if (args.length === 1) { stop = args[0]; }
        else if (args.length === 2) { start = args[0]; stop = args[1]; }
        else { start = args[0]; stop = args[1]; step = args[2] || 1; }
        let i = 0;
        for await (const v of _aiter(iterable)) {
          if (stop !== undefined && i >= stop) break;
          if (i >= start && (i - start) % step === 0) yield v;
          i++;
        }
  }),
  zip_longest: (...args) => {
    let fillvalue = null;
    if (args.length > 0 && args[args.length - 1]?._kw) { fillvalue = args.pop().fillvalue ?? null; }
    return _lazyIter('zip_longest', async function*() {
      const arrs = [];
      for (const it of args) arrs.push(await pyCollect(it));
      const maxLen = Math.max(...arrs.map(a => a.length));
      for (let i = 0; i < maxLen; i++) yield mkTuple(arrs.map(a => i < a.length ? a[i] : fillvalue));
    });
  },
  groupby: (iterable, key) => _lazyIter('groupby', async function*() {
        let currentKey, currentGroup = [], first = true;
        if (key && key._kw) key = key.key;
        for await (const item of _aiter(iterable)) {
          let k = key ? key(item) : item;
          if (k && typeof k.then === 'function') k = await k;
          if (first || !pyEq(k, currentKey)) {
            if (currentGroup.length > 0) yield mkTuple([currentKey, currentGroup]);
            currentKey = k; currentGroup = [item]; first = false;
          } else { currentGroup.push(item); }
        }
        if (currentGroup.length > 0) yield mkTuple([currentKey, currentGroup]);
  }),
  count: (start, step) => _lazySyncIter('count', function*() {
        let n = start ?? 0;
        const s = step ?? 1;
        while (true) { yield n; n += s; }
  }),
  cycle: (iterable) => _lazyIter('cycle', async function*() {
        const saved = [];
        for await (const v of _aiter(iterable)) { saved.push(v); yield v; }
        while (saved.length > 0) { for (const v of saved) yield v; }
  }),
  pairwise: (iterable) => _lazyIter('pairwise', async function*() {
        let prev, hasPrev = false;
        for await (const v of _aiter(iterable)) {
          if (hasPrev) yield mkTuple([prev, v]);
          prev = v; hasPrev = true;
        }
  }),
};

// ── functools ──

const _functoolsModule = {
  // reduce awaits each step: a tree-walked function returns a Promise
  reduce: async (func, iterable, initial) => {
    const arr = await pyCollect(iterable);
    let i = 0, acc;
    if (initial !== undefined) acc = initial;
    else {
      if (arr.length === 0) throw new AdderError('TypeError', 'reduce() of empty iterable with no initial value');
      acc = arr[0]; i = 1;
    }
    for (; i < arr.length; i++) { acc = func(acc, arr[i]); if (acc && typeof acc.then === 'function') acc = await acc; }
    return acc;
  },
  partial: (func, ...partialArgs) => {
    let pkw = null;
    if (partialArgs.length && partialArgs[partialArgs.length - 1]?._kw) pkw = partialArgs.pop();
    const wrapped = (...args) => {
      let kw = args.length && args[args.length - 1]?._kw ? args.pop() : null;
      if (pkw) kw = { ...pkw, ...(kw || {}), _kw: true };
      return kw ? func(...partialArgs, ...args, kw) : func(...partialArgs, ...args);
    };
    wrapped._pyName = `partial(${func._pyName || func.name || '?'})`;
    wrapped.func = func; wrapped.args = partialArgs; wrapped.keywords = pkw ? Object.fromEntries(Object.entries(pkw).filter(([k]) => k !== '_kw')) : {};
    return wrapped;
  },
  // lru_cache / cache: as a decorator (@lru_cache) or a factory (@lru_cache(maxsize=…))
  lru_cache: (arg) => {
    const wrap = (fn, maxsize) => {
      const cache = new PyDict();
      let hits = 0, misses = 0;
      const keyOf = (args) => JSON.stringify(args, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
      const wrapped = (...args) => {
        const key = keyOf(args);
        if (cache.has(key)) { hits++; const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
        misses++;
        const result = fn(...args);
        cache.set(key, result);
        if (maxsize != null && cache.size > maxsize) cache.delete(cache.keys().next().value);
        if (result && typeof result.then === 'function') result.catch(() => cache.delete(key));
        return result;
      };
      wrapped.cache_clear = () => { cache.clear(); hits = misses = 0; return null; };
      wrapped.cache_info = () => `CacheInfo(hits=${hits}, misses=${misses}, maxsize=${maxsize ?? 'None'}, currsize=${cache.size})`;
      wrapped._pyName = fn._pyName || fn.name;
      wrapped.__wrapped__ = fn;
      return wrapped;
    };
    if (typeof arg === 'function') return wrap(arg, 128);
    const maxsize = arg && arg._kw ? arg.maxsize : arg;
    return (fn) => wrap(fn, maxsize === undefined ? 128 : maxsize);
  },
  cache: (fn) => _functoolsModule.lru_cache({ _kw: true, maxsize: null })(fn),
  wraps: (wrapped) => (fn) => { fn._pyName = wrapped._pyName || wrapped.name; fn.__doc__ = wrapped.__doc__ ?? null; fn.__wrapped__ = wrapped; return fn; },
  cmp_to_key: (cmp) => (x) => ({
    __adderClass__: 'K', obj: x,
    __lt__: (o) => { const r = cmp(x, o.obj); return r && typeof r.then === 'function' ? r.then((v) => v < 0) : r < 0; },
    __gt__: (o) => { const r = cmp(x, o.obj); return r && typeof r.then === 'function' ? r.then((v) => v > 0) : r > 0; },
    __eq__: (o) => { const r = cmp(x, o.obj); return r && typeof r.then === 'function' ? r.then((v) => v === 0) : r === 0; },
  }),
};

// ── collections ──
// Counter / defaultdict / OrderedDict are Maps (dict-shaped everywhere: printing, indexing,
// iteration, len, in) with their extra behaviour; deque is a list-backed class; namedtuple
// makes classes whose instances index, unpack and print like Python's.

function _counterAdd(map, iterable) {
  if (iterable instanceof Map) { for (const [k, v] of iterable) map.set(k, (map.get(k) || 0) + v); return; }
  if (isPlainDict(iterable)) { for (const k of Object.keys(iterable)) map.set(k, (map.get(k) || 0) + iterable[k]); return; }
  for (const v of pyIter(iterable)) map.set(v, (map.get(v) || 0) + 1);
}
class AdderCounter extends PyDict {
  constructor(iterable) { super(); if (iterable != null && !iterable._kw) _counterAdd(this, iterable); if (iterable && iterable._kw) for (const k of Object.keys(iterable)) if (k !== '_kw') this.set(k, iterable[k]); }
  __missing__() { return 0; }
  most_common(n) {
    const e = [...this.entries()].sort((a, b) => b[1] - a[1]).map(mkTuple);   // stable: ties keep insertion order
    return n == null ? e : e.slice(0, n);
  }
  elements() { const out = []; for (const [k, v] of this) for (let i = 0; i < v; i++) out.push(k); return out; }
  update(iterable) { if (iterable != null) _counterAdd(this, iterable); return null; }
  subtract(iterable) { const tmp = new AdderCounter(iterable); for (const [k, v] of tmp) this.set(k, (this.get(k) || 0) - v); return null; }
  total() { let t = 0; for (const v of this.values()) t += v; return t; }
  __repr__() { return this.size ? `Counter({${this.most_common().map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}})` : 'Counter()'; }
}
AdderCounter.prototype.__adderClass__ = 'Counter';

class AdderDefaultDict extends PyDict {
  constructor(factory, items) { super(); this.default_factory = factory ?? null; if (items) for (const [k, v] of (items instanceof Map ? items : Array.isArray(items) ? items : Object.entries(items))) this.set(k, v); }
  __missing__(key) {
    if (this.default_factory == null) throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
    const v = this.default_factory();
    if (v && typeof v.then === 'function') return v.then((x) => { this.set(key, x); return x; });
    this.set(key, v);
    return v;
  }
  __repr__() { return `defaultdict(${this.default_factory ? pyRepr(this.default_factory) : 'None'}, {${[...this].map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}})`; }
}
AdderDefaultDict.prototype.__adderClass__ = 'defaultdict';

class AdderOrderedDict extends PyDict {
  constructor(items) { super(); if (items) for (const [k, v] of (items instanceof Map ? items : Array.isArray(items) ? items : Object.entries(items).filter(([k]) => k !== '_kw'))) this.set(k, v); }
  move_to_end(key, last = true) {
    if (last && last._kw) last = last.last;
    if (!this.has(key)) throw new AdderError('KeyError', pyRepr(key), undefined, [key]);
    const v = this.get(key); this.delete(key);
    if (last === false) { const rest = [...this]; this.clear(); this.set(key, v); for (const [k, x] of rest) this.set(k, x); }
    else this.set(key, v);
    return null;
  }
  popitem(last = true) {
    if (last && last._kw) last = last.last;
    if (!this.size) throw new AdderError('KeyError', "'dictionary is empty'");
    const keys = [...this.keys()], k = last === false ? keys[0] : keys[keys.length - 1], v = this.get(k);
    this.delete(k);
    return mkTuple([k, v]);
  }
  __repr__() { return this.size ? `OrderedDict({${[...this].map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}})` : 'OrderedDict()'; }
}
AdderOrderedDict.prototype.__adderClass__ = 'OrderedDict';

class AdderDeque {
  constructor(iterable, maxlen) {
    if (iterable && iterable._kw) { maxlen = iterable.maxlen; iterable = iterable.iterable; }
    if (maxlen && maxlen._kw) maxlen = maxlen.maxlen;
    this.maxlen = maxlen ?? null;
    this._a = iterable == null ? [] : [...pyIter(iterable)];
    this._trim(true);
  }
  _trim(fromLeft) { if (this.maxlen != null) while (this._a.length > this.maxlen) (fromLeft ? this._a.shift() : this._a.pop()); }
  append(x) { this._a.push(x); this._trim(true); return null; }
  appendleft(x) { this._a.unshift(x); this._trim(false); return null; }
  pop() { if (!this._a.length) throw new AdderError('IndexError', 'pop from an empty deque'); return this._a.pop(); }
  popleft() { if (!this._a.length) throw new AdderError('IndexError', 'pop from an empty deque'); return this._a.shift(); }
  extend(it) { for (const x of pyIter(it)) this.append(x); return null; }
  extendleft(it) { for (const x of pyIter(it)) this.appendleft(x); return null; }
  rotate(n = 1) { const len = this._a.length; if (!len) return null; n = ((n % len) + len) % len; if (n) this._a.unshift(...this._a.splice(len - n, n)); return null; }
  clear() { this._a.length = 0; return null; }
  count(x) { return this._a.filter((v) => pyEq(v, x)).length; }
  remove(x) { const i = this._a.findIndex((v) => pyEq(v, x)); if (i < 0) throw new AdderError('ValueError', 'deque.remove(x): x not in deque'); this._a.splice(i, 1); return null; }
  reverse() { this._a.reverse(); return null; }
  copy() { return new AdderDeque(this._a, this.maxlen); }
  __len__() { return this._a.length; }
  __getitem__(i) { return pyGetItem(this._a, i); }
  __setitem__(i, v) { const n = this._a.length, j = i < 0 ? n + i : i; if (j < 0 || j >= n) throw new AdderError('IndexError', 'deque index out of range'); this._a[j] = v; return null; }
  __contains__(x) { return this._a.some((v) => pyEq(v, x)); }
  __eq__(o) { return o instanceof AdderDeque && pyEq(this._a, o._a); }
  __iter__() { return this._a[Symbol.iterator](); }
  [Symbol.iterator]() { return this._a[Symbol.iterator](); }
  __repr__() { return this.maxlen == null ? `deque(${pyRepr(this._a)})` : `deque(${pyRepr(this._a)}, maxlen=${this.maxlen})`; }
}
AdderDeque.prototype.__adderClass__ = 'deque';

export function _namedtuple(name, fields, opts) {
  let defaults = [];
  if (fields && fields._kw) { opts = fields; fields = opts.field_names; }
  if (opts && opts._kw && opts.defaults) defaults = [...pyIter(opts.defaults)];
  const names = typeof fields === 'string' ? fields.replace(/,/g, ' ').split(/\s+/).filter(Boolean) : [...pyIter(fields)];
  class NT extends PyTuple {}
  const cls = function (...args) {
    const kw = args.length && args[args.length - 1]?._kw ? args.pop() : null;
    const vals = names.map((f, i) => {
      if (i < args.length) return args[i];
      if (kw && Object.hasOwn(kw, f)) return kw[f];
      const d = i - (names.length - defaults.length);
      if (d >= 0) return defaults[d];
      throw new AdderError('TypeError', `${name}.__new__() missing 1 required positional argument: '${f}'`);
    });
    const t = new NT();
    for (const v of vals) t.push(v);
    return Object.freeze(t);
  };
  cls._pyName = name; cls._pyClass = true; cls._fields = mkTuple(names);
  cls._pyMRO = [cls, _typeObjects.tuple].filter(Boolean);
  NT.prototype.__adderClass__ = name;
  NT.prototype.__adderType__ = cls;
  NT.prototype._fields = cls._fields;
  cls.__match_args__ = cls._fields;
  cls._ntProto = NT.prototype;   // typing.NamedTuple re-homes it onto the user's class
  names.forEach((f, i) => Object.defineProperty(NT.prototype, f, { get() { return this[i]; }, configurable: true }));
  NT.prototype.__repr__ = function () { return `${name}(${names.map((f, i) => `${f}=${pyRepr(this[i])}`).join(', ')})`; };
  NT.prototype._asdict = function () { const o = {}; names.forEach((f, i) => { o[f] = this[i]; }); return o; };
  NT.prototype._replace = function (kw) { return cls(...names.map((f, i) => (kw && Object.hasOwn(kw, f) ? kw[f] : this[i]))); };
  cls._make = (it) => cls(...pyIter(it));
  return cls;
}

const _ctor = (C, name) => Object.assign((...a) => new C(...a), { _pyName: name, _pyClass: true });
const _collectionsModule = {
  Counter: _ctor(AdderCounter, 'Counter'),
  defaultdict: _ctor(AdderDefaultDict, 'defaultdict'),
  OrderedDict: _ctor(AdderOrderedDict, 'OrderedDict'),
  deque: _ctor(AdderDeque, 'deque'),
  namedtuple: _namedtuple,
  ChainMap: (...maps) => { const m = new PyDict(); for (const src of maps.slice().reverse()) for (const [k, v] of (src instanceof Map ? src : Object.entries(src))) m.set(k, v); return m; },
};

// ── json ──
// Python's json.dumps: separators (', ', ': ') — (',', ': ') with indent —, ensure_ascii,
// sort_keys, NaN / Infinity, default=; loads returns dicts (plain objects) and lists.
function _jsonEsc(s, ascii) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || (ascii && c > 0x7e)) {
      if (c > 0xffff) { const h = Math.floor((c - 0x10000) / 0x400) + 0xd800, l = ((c - 0x10000) % 0x400) + 0xdc00; out += `\\u${h.toString(16).padStart(4, '0')}\\u${l.toString(16).padStart(4, '0')}`; }
      else out += `\\u${c.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return out + '"';
}
function _jsonDumps(obj, opts) {
  const indent = opts.indent == null ? null : typeof opts.indent === 'number' ? ' '.repeat(opts.indent) : String(opts.indent);
  const [itemSep, keySep] = opts.separators ? [...opts.separators] : indent === null ? [', ', ': '] : [',', ': '];
  const ascii = opts.ensure_ascii !== false;
  const enc = (v, depth) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : String(v);
    if (typeof v === 'string') return _jsonEsc(v, ascii);
    const nl = indent === null ? '' : '\n' + indent.repeat(depth + 1), end = indent === null ? '' : '\n' + indent.repeat(depth);
    if (Array.isArray(v)) return v.length ? `[${nl}${v.map((x) => enc(x, depth + 1)).join(itemSep + nl)}${end}]` : '[]';
    if (v instanceof Map || isPlainDict(v)) {
      let entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
      entries = entries.map(([k, x]) => [typeof k === 'string' ? k : typeof k === 'number' ? String(k) : k === true ? 'true' : k === false ? 'false' : k === null ? 'null' : (() => { throw new AdderError('TypeError', `keys must be str, int, float, bool or None, not ${pyTypeName(k)}`); })(), x]);
      if (opts.sort_keys) entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return entries.length ? `{${nl}${entries.map(([k, x]) => _jsonEsc(k, ascii) + keySep + enc(x, depth + 1)).join(itemSep + nl)}${end}}` : '{}';
    }
    if (v instanceof Set || v instanceof AdderDeque) { if (opts.default) return enc(opts.default(v), depth); throw new AdderError('TypeError', `Object of type ${pyTypeName(v)} is not JSON serializable`); }
    if (opts.default) return enc(opts.default(v), depth);
    throw new AdderError('TypeError', `Object of type ${pyTypeName(v)} is not JSON serializable`);
  };
  return enc(obj, 0);
}
const _jsonModule = {
  dumps: (obj, ...rest) => {
    const kw = rest.length && rest[rest.length - 1]?._kw ? rest.pop() : {};
    return _jsonDumps(obj, kw);
  },
  loads: (s) => {
    if (s instanceof Uint8Array) s = new TextDecoder().decode(s);
    try { return JSON.parse(String(s)); } catch (e0) {
      try { return JSON.parse(String(s).replace(/(?<=[:\[,]\s*)(-?)Infinity|(?<=[:\[,]\s*)NaN/g, (m) => `"__py_${m}__"`), (k, v) => (v === '__py_Infinity__' ? Infinity : v === '__py_-Infinity__' ? -Infinity : v === '__py_NaN__' ? NaN : v)); }
      catch (e) { throw new AdderError('JSONDecodeError', String(e0.message || e0)); }
    }
  },
};

// ── re (regex) ──
// Python's re over JS RegExp. Patterns are translated ((?P<n>…), (?P=n), \A, \Z, leading inline
// flags, verbose mode); Pattern and Match objects follow Python's API (group/groups/groupdict/
// span/start/end/expand, match is anchored at pos, fullmatch, finditer, sub with \1 / \g<name>
// templates or a function — awaited when it is async, as tree-walked functions are).

const RE_FLAGS = { I: 2, IGNORECASE: 2, L: 4, LOCALE: 4, M: 8, MULTILINE: 8, S: 16, DOTALL: 16, U: 32, UNICODE: 32, X: 64, VERBOSE: 64, A: 256, ASCII: 256 };

function _reVerbose(p) {
  let out = '', inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') { out += c + (p[i + 1] ?? ''); i++; continue; }
    if (inClass) { if (c === ']') inClass = false; out += c; continue; }
    if (c === '[') { inClass = true; out += c; continue; }
    if (/\s/.test(c)) continue;
    if (c === '#') { while (i < p.length && p[i] !== '\n') i++; continue; }
    out += c;
  }
  return out;
}
// Python pattern + flags → { source, flags } for RegExp
function _reTranslate(pattern, flags) {
  let p = pattern instanceof Uint8Array ? String.fromCharCode(...pattern) : String(pattern);
  let f = flags | 0;
  const lead = /^\(\?([aiLmsux]+)\)/.exec(p);
  if (lead) {
    for (const ch of lead[1]) f |= { a: 256, i: 2, L: 4, m: 8, s: 16, u: 32, x: 64 }[ch];
    p = p.slice(lead[0].length);
  }
  if (f & 64) p = _reVerbose(p);
  p = p.replace(/\(\?P<([^>]+)>/g, '(?<$1>').replace(/\(\?P=([A-Za-z_]\w*)\)/g, '\\k<$1>')
    .replace(/(^|[^\\])\\A/g, '$1(?<![\\s\\S])').replace(/(^|[^\\])\\Z/g, '$1(?![\\s\\S])');
  let js = '';
  if (f & 2) js += 'i';
  if (f & 8) js += 'm';
  if (f & 16) js += 's';
  if (!(f & 256)) js += 'u';
  return { source: p, flags: js, pyFlags: f };
}

function _reGroupNames(source) {
  const names = {};
  let idx = 0;
  const re = /\\.|\[(?:\\.|[^\]])*\]|\((\?<([A-Za-z_]\w*)>|\?)?/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[0][0] !== '(') continue;
    if (m[1] === '?') continue;           // (?: (?= (?! (?<= (?<! — not capturing
    idx++;
    if (m[2]) names[m[2]] = idx;
  }
  return { count: idx, names };
}

function _reMatchObject(m, pattern, string, pos, endpos) {
  const groupIndex = pattern.groupindex;
  const resolve = (g) => {
    if (g === undefined) return 0;
    if (typeof g === 'string') {
      if (!(g in groupIndex)) throw new AdderError('IndexError', 'no such group');
      return groupIndex[g];
    }
    if (typeof g !== 'number' || g < 0 || g > pattern.groups) throw new AdderError('IndexError', 'no such group');
    return g;
  };
  const val = (i) => (m[i] === undefined ? null : m[i]);
  const span = (g) => { const i = resolve(g); const ix = m.indices && m.indices[i]; return mkTuple(ix ? [ix[0], ix[1]] : [-1, -1]); };
  let lastindex = null;
  for (let i = 1; i <= pattern.groups; i++) if (m[i] !== undefined) lastindex = i;
  const obj = {
    __adderClass__: 're.Match',
    string, re: pattern, pos, endpos, lastindex,
    lastgroup: lastindex === null ? null : (Object.keys(groupIndex).find((k) => groupIndex[k] === lastindex) || null),
    group: (...gs) => (gs.length <= 1 ? val(resolve(gs[0])) : mkTuple(gs.map((g) => val(resolve(g))))),
    groups: (dflt) => { const out = []; for (let i = 1; i <= pattern.groups; i++) out.push(m[i] === undefined ? (dflt === undefined ? null : dflt) : m[i]); return mkTuple(out); },
    groupdict: (dflt) => { const o = {}; for (const [k, i] of Object.entries(groupIndex)) o[k] = m[i] === undefined ? (dflt === undefined ? null : dflt) : m[i]; return o; },
    start: (g) => span(g)[0],
    end: (g) => span(g)[1],
    span,
    expand: (template) => _reExpand(template, (i) => val(resolve(i))),
    __getitem__: (g) => val(resolve(g)),
    __bool__: () => true,
    __repr__: () => `<re.Match object; span=(${span(0).join(', ')}), match=${pyRepr(m[0])}>`,
  };
  return obj;
}

// a replacement template: \1 … \99, \g<name>, \g<1>, and the usual escapes
function _reExpand(template, group) {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c !== '\\') { out += c; continue; }
    const n = template[i + 1];
    if (n === 'g' && template[i + 2] === '<') {
      const close = template.indexOf('>', i + 3);
      const ref = template.slice(i + 3, close);
      out += group(/^\d+$/.test(ref) ? +ref : ref) ?? '';
      i = close;
    } else if (/\d/.test(n)) {
      let num = n;
      if (/\d/.test(template[i + 2] || '')) { num += template[i + 2]; i++; }
      out += group(+num) ?? '';
      i++;
    } else {
      out += { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: '\x07', b: '\b', '\\': '\\' }[n] ?? ('\\' + n);
      i++;
    }
  }
  return out;
}

function _reCompile(pattern, flags) {
  if (pattern && pattern.__adderClass__ === 're.Pattern') return pattern;
  const t = _reTranslate(pattern, flags);
  let probe;
  try { probe = new RegExp(t.source, t.flags); } catch (e) { throw new AdderError('re.error', String(e.message || e)); }
  void probe;
  const { count, names } = _reGroupNames(t.source);
  const make = (extra) => new RegExp(t.source, t.flags + 'd' + extra);
  const P = {
    __adderClass__: 're.Pattern',
    pattern, flags: t.pyFlags, groups: count, groupindex: names,
    __repr__: () => `re.compile(${pyRepr(pattern)})`,
  };
  const at = (s, pos, endpos, sticky) => {
    const end = endpos == null ? s.length : Math.min(endpos, s.length);
    const re = make(sticky ? 'y' : 'g');
    re.lastIndex = pos || 0;
    const m = re.exec(s.slice(0, end));
    return m ? _reMatchObject(m, P, s, pos || 0, end) : null;
  };
  P.search = (s, pos, endpos) => at(s, pos, endpos, false);
  P.match = (s, pos, endpos) => at(s, pos, endpos, true);
  P.fullmatch = (s, pos, endpos) => {
    const end = endpos == null ? s.length : Math.min(endpos, s.length);
    const re = new RegExp(`(?:${t.source})(?![\\s\\S])`, t.flags + 'dy');
    re.lastIndex = pos || 0;
    const m = re.exec(s.slice(0, end));
    return m ? _reMatchObject(m, P, s, pos || 0, end) : null;
  };
  const allMatches = (s) => {
    const re = make('g');
    const out = [];
    let m;
    while ((m = re.exec(s))) { out.push(m); if (m[0] === '') re.lastIndex++; }
    return out;
  };
  P.findall = (s) => allMatches(s).map((m) => (count === 0 ? m[0] : count === 1 ? (m[1] ?? '') : mkTuple(m.slice(1).map((g) => g ?? ''))));
  P.finditer = (s) => allMatches(s).map((m) => _reMatchObject(m, P, s, 0, s.length));
  P.split = (s, maxsplit) => {
    if (maxsplit && maxsplit._kw) maxsplit = maxsplit.maxsplit;
    const out = [];
    let last = 0, n = 0;
    for (const m of allMatches(s)) {
      if (maxsplit && n >= maxsplit) break;
      out.push(s.slice(last, m.index), ...m.slice(1).map((g) => (g === undefined ? null : g)));
      last = m.index + m[0].length;
      n++;
    }
    out.push(s.slice(last));
    return out;
  };
  P.subn = (repl, s, count = 0) => {
    if (count && count._kw) count = count.count;
    const ms = allMatches(s).slice(0, count > 0 ? count : undefined);
    const pieces = ms.map((m) => {
      if (typeof repl === 'function') return repl(_reMatchObject(m, P, s, 0, s.length));
      return _reExpand(String(repl), (i) => (m[i] === undefined ? '' : m[i]));
    });
    const build = (ps) => {
      let out = '', last = 0;
      ms.forEach((m, i) => { out += s.slice(last, m.index) + (ps[i] ?? ''); last = m.index + m[0].length; });
      return mkTuple([out + s.slice(last), ms.length]);
    };
    return pieces.some((x) => x && typeof x.then === 'function') ? Promise.all(pieces).then(build) : build(pieces);
  };
  P.sub = (repl, s, count = 0) => {
    const r = P.subn(repl, s, count);
    return r && typeof r.then === 'function' ? r.then((x) => x[0]) : r[0];
  };
  return P;
}

const _reModule = {
  ...RE_FLAGS,
  compile: (pattern, flags) => _reCompile(pattern, flags),
  search: (pattern, string, flags) => _reCompile(pattern, flags).search(string),
  match: (pattern, string, flags) => _reCompile(pattern, flags).match(string),
  fullmatch: (pattern, string, flags) => _reCompile(pattern, flags).fullmatch(string),
  findall: (pattern, string, flags) => _reCompile(pattern, flags).findall(string),
  finditer: (pattern, string, flags) => _reCompile(pattern, flags).finditer(string),
  split: (pattern, string, maxsplit, flags) => {
    if (maxsplit && maxsplit._kw) { flags = maxsplit.flags; maxsplit = maxsplit.maxsplit; }
    return _reCompile(pattern, flags).split(string, maxsplit);
  },
  sub: (pattern, repl, string, count, flags) => {
    if (count && count._kw) { flags = count.flags; count = count.count; }
    return _reCompile(pattern, flags).sub(repl, string, count || 0);
  },
  subn: (pattern, repl, string, count, flags) => {
    if (count && count._kw) { flags = count.flags; count = count.count; }
    return _reCompile(pattern, flags).subn(repl, string, count || 0);
  },
  escape: (s) => String(s).replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, '\\$&'),
  error: Object.assign((msg) => new AdderError('re.error', msg), { _pyName: 'error', _pyClass: true }),
};


// ── string module ──

const _stringModule = {
  ascii_lowercase: 'abcdefghijklmnopqrstuvwxyz',
  ascii_uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ascii_letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  hexdigits: '0123456789abcdefABCDEF',
  octdigits: '01234567',
  punctuation: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  whitespace: ' \t\n\r\x0b\x0c',
};

// ── this ──

const _thisModule = {
  s: `The Zen of Python, by Tim Peters

Beautiful is better than ugly.
Explicit is better than implicit.
Simple is better than complex.
Complex is better than complicated.
Flat is better than nested.
Sparse is better than dense.
Readability counts.
Special cases aren't special enough to break the rules.
Although practicality beats purity.
Errors should never pass silently.
Unless explicitly silenced.
In the face of ambiguity, refuse the temptation to guess.
There should be one-- and preferably only one --obvious way to do it.
Although that way may not be obvious at first unless you're Dutch.
Now is better than never.
Although never is often better than *right* now.
If the implementation is hard to explain, it's a bad idea.
If the implementation is easy to explain, it may be a good idea.
Namespaces are one honking great idea -- let's do more of those!`,
};
_thisModule.print = () => _thisModule.s;
_thisModule.gcu = `We set sail on this new stack because there is new knowledge to be gained, and new tools to be built, and they must be built and shared for the progress of all practitioners. For computational science, like geostatistics and all technology, has no conscience of its own. Whether it will become a force for good or ill depends on us, and only if we occupy a position of independence can we help decide whether this new ocean will be a sea of openness or a new terrifying theater of languages that forgot what they were for.

I do not say that we should or will go without the tools that others have built, any more than we go without the knowledge that others have shared, but I do say that geostatistics can be explored and mastered without feeding the fires of flamewar, without repeating the mistakes that man has made in extending his writ around this globe of ours.

There is no strife, no prejudice, no conflict of interest in a file that contains its own source. Its hazards are hostile to us all. Its conquest deserves the best of all practitioners, and its opportunity for open cooperation may never come again.

But why, some say, JavaScript? Why choose this as our language? And they may well ask, why climb the highest mountain? Why, thirty-four years after Deutsch and Journel, rewrite the FORTRAN? Why does Rice play Texas?

We choose to write JavaScript. We choose to write JavaScript... We choose to write JavaScript in this decade and do the other things, not because it is good, but because it is bad; because that goal will serve to organize and measure the best of our energies and skills, because that challenge is one that we are willing to accept, one we are unwilling to postpone, and one we intend to ship, and the others, too.`;

// ── shared cwd + path resolution ──

const _cwd = { value: '/projects/self' };
const _HOME = '/projects/self';

// Expand ~ and resolve relative paths against cwd. Used by open(), Path(), os._resolve().
export function _resolvePath(p, pth) {
  if (!p || p === '.') return _cwd.value;
  // ~ expansion
  if (p === '~') return _HOME;
  if (p.startsWith('~/')) p = _HOME + p.slice(1);
  if (pth && !pth.isAbsolute(p)) return pth.join(_cwd.value, p);
  if (pth) return pth.normalize(p);
  // fallback without path utils: just basic join
  if (p.startsWith('/')) return p;
  return _cwd.value + ((_cwd.value === '/') ? '' : '/') + p;
}

// ── sys module ──

const _sysModule = {
  version: '3.12.0 (adder)',
  version_info: [3, 12, 0, 'adder', 0],
  platform: 'auditable',
  maxsize: Number.MAX_SAFE_INTEGER,
  path: ['.', 'lib', '/usr/lib/python'],
  modules: {},
  argv: [''],
  exit: (code) => { throw new AdderError('SystemExit', String(code ?? 0)); },
  exc_info: () => (excStack.length ? mkTuple([excTypeOf(excStack[excStack.length - 1]), excValue(excStack[excStack.length - 1]), null]) : mkTuple([null, null, null])),
  exception: () => (excStack.length ? excValue(excStack[excStack.length - 1]) : null),
  // write to the running program's stdout / stderr (run()'s opts, or the notebook cell)
  stdout: { write(s) { s = String(s); _stdioWrite('out', s); return s.length; }, flush() { return null; }, encoding: 'utf-8', isatty: () => false, __adderClass__: 'TextIOWrapper' },
  stderr: { write(s) { s = String(s); _stdioWrite('err', s); return s.length; }, flush() { return null; }, encoding: 'utf-8', isatty: () => false, __adderClass__: 'TextIOWrapper' },
  getsizeof: () => 0,
  getrecursionlimit: () => 1000,
  setrecursionlimit: () => null,
  executable: '',
  prefix: '/usr',
  exec_prefix: '/usr',
  get home() { return _HOME; },
};

export const adderModules = {
  math: _mathModule, json: _jsonModule, js: _jsModule, random: _randomModule,
  itertools: _itertoolsModule, functools: _functoolsModule,
  collections: _collectionsModule, re: _reModule, string: _stringModule,
  this: _thisModule, sys: _sysModule,
};

// ── filesystem exception hierarchy ──


// ── exceptions: one model for both engines ──
// Builtin exceptions are AdderErrors (pyType = the class name, args = the constructor's
// arguments). A user class deriving from a builtin exception makes ordinary instances (with
// `args`); raising one throws a wrapper AdderError whose pyValue is the instance, so `except
// ValueError as e` binds the instance (type(e), e.args, isinstance work) while the error still
// carries Python's message. excMatches is THE except-matcher (tree-walker and AIR); BudgetExceeded
// is never caught, by any clause.

// Python 3.13's hierarchy (the parts adder can raise or a program can name)
export const _excParents = {
  Exception: 'BaseException', SystemExit: 'BaseException', KeyboardInterrupt: 'BaseException', GeneratorExit: 'BaseException',
  ArithmeticError: 'Exception', AssertionError: 'Exception', AttributeError: 'Exception', BufferError: 'Exception',
  EOFError: 'Exception', ImportError: 'Exception', LookupError: 'Exception', MemoryError: 'Exception',
  NameError: 'Exception', OSError: 'Exception', ReferenceError: 'Exception', RuntimeError: 'Exception',
  StopIteration: 'Exception', StopAsyncIteration: 'Exception', SyntaxError: 'Exception', SystemError: 'Exception',
  TypeError: 'Exception', ValueError: 'Exception', Warning: 'Exception',
  FloatingPointError: 'ArithmeticError', OverflowError: 'ArithmeticError', ZeroDivisionError: 'ArithmeticError',
  ModuleNotFoundError: 'ImportError', IndexError: 'LookupError', KeyError: 'LookupError',
  UnboundLocalError: 'NameError', NotImplementedError: 'RuntimeError', RecursionError: 'RuntimeError',
  IndentationError: 'SyntaxError', TabError: 'IndentationError',
  UnicodeError: 'ValueError', UnicodeDecodeError: 'UnicodeError', UnicodeEncodeError: 'UnicodeError',
  BlockingIOError: 'OSError', ChildProcessError: 'OSError', ConnectionError: 'OSError', FileExistsError: 'OSError',
  FileNotFoundError: 'OSError', InterruptedError: 'OSError', IsADirectoryError: 'OSError', NotADirectoryError: 'OSError',
  PermissionError: 'OSError', ProcessLookupError: 'OSError', TimeoutError: 'OSError', IOError: 'OSError',
  BrokenPipeError: 'ConnectionError', ConnectionAbortedError: 'ConnectionError',
  ConnectionRefusedError: 'ConnectionError', ConnectionResetError: 'ConnectionError',
  UserWarning: 'Warning', DeprecationWarning: 'Warning', RuntimeWarning: 'Warning', SyntaxWarning: 'Warning',
  FutureWarning: 'Warning', ImportWarning: 'Warning', UnicodeWarning: 'Warning', BytesWarning: 'Warning', ResourceWarning: 'Warning',
};
const _EXC_NAMES = ['BaseException', ...Object.keys(_excParents)];
// A module's own exception type (dataclasses.FrozenInstanceError, statistics.StatisticsError,
// binascii.Error, ...): a builtin-style type under `parent`, raised and caught like ValueError.
export function makeExcType(name, parent, ...moreParents) {
  if (!_excParents[name]) { _excParents[name] = parent; _EXC_NAMES.push(name); }
  if (moreParents.length) _excExtraParents[name] = moreParents;
  if (_typeObjects[name]) return _typeObjects[name];
  const ctor = (...a) => {
    if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
    return new AdderError(name, _argsStr(name, a), undefined, a);
  };
  ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name.split('.').pop();
  _typeObjects[name] = ctor;
  return ctor;
}
// A class-body attribute onto the class object (a JS function): defined, not assigned, so
// `name` / `length` (read-only on functions) work; recorded in _pyAttrs, which is how
// dataclasses and enum tell the body's attributes from the function's own properties.
export function setClassAttr(cls, k, v) {
  Object.defineProperty(cls, k, { value: v, writable: true, enumerable: true, configurable: true });
  (cls._pyAttrs || (cls._pyAttrs = new Set())).add(k);
}
// obj.name = value, from either engine: a frozen dataclass instance refuses every assignment
export function guardSetAttr(obj, name) {
  if (obj !== null && typeof obj === 'object' && obj.__dataclass_frozen__ === true) {
    throw new AdderError('FrozenInstanceError', `cannot assign to field '${name}'`);
  }
}
// JS errors surfacing through compiled code or a JS library
const _JS_EXC = { TypeError: 'TypeError', RangeError: 'ValueError', ReferenceError: 'NameError', SyntaxError: 'SyntaxError', URIError: 'ValueError' };

function _excChain(name) {
  if (name === 'BudgetExceeded') return [name];
  const out = [name];
  let p = _excParents[name] || (name === 'BaseException' ? null : 'Exception');
  while (p) { out.push(p); p = _excParents[p] || (p === 'BaseException' ? null : 'Exception'); }
  // a type with more than one exception base (decimal.DivisionByZero is a ZeroDivisionError too)
  for (const n of [...out]) for (const extra of _excExtraParents[n] || []) for (const x of _excChain(extra)) if (!out.includes(x)) out.push(x);
  return out;
}
const _excExtraParents = {};

// a builtin exception type object (ValueError, ...): a type with no MRO of its own
export function isBuiltinExcType(t) {
  return typeof t === 'function' && !!t._pyClass && !t._pyMRO && _EXC_NAMES.includes(t._pyName);
}
// a user class whose MRO reaches a builtin exception
export function isExceptionClass(cls) {
  if (typeof cls !== 'function' || !cls._pyMRO) return false;
  if (cls._isExcClass === undefined) cls._isExcClass = cls._pyMRO.some((c) => c !== cls && isBuiltinExcType(c));
  return cls._isExcClass;
}
// class construction calls this: an exception instance keeps its constructor arguments
export function initExceptionInstance(cls, instance, args) {
  if (!isExceptionClass(cls)) return;
  const a = args.length && args[args.length - 1] && args[args.length - 1]._kw ? args.slice(0, -1) : args.slice();
  instance.args = mkTuple(a);
}
function _argsStr(name, args) {
  if (!args || args.length === 0) return '';
  if (args.length === 1) return name === 'KeyError' ? pyRepr(args[0]) : pyStr(args[0]);
  return `(${args.map(pyRepr).join(', ')})`;
}
// what a raise throws, for whatever was raised (an AdderError, a JS Error, a builtin or user
// exception class or instance); may be a Promise when constructing a class is async
export function excToThrowable(exc, line) {
  if (exc instanceof AdderError || exc instanceof Error) return exc;
  if (typeof exc === 'function' && (isBuiltinExcType(exc) || isExceptionClass(exc))) {
    const inst = exc();
    return inst && typeof inst.then === 'function' ? inst.then((i) => excToThrowable(i, line)) : excToThrowable(inst, line);
  }
  if (exc && typeof exc === 'object' && isExceptionClass(exc.__adderType__)) {
    const cls = exc.__adderType__;
    let msg = _argsStr(cls._pyName, exc.args);
    if (typeof exc.__str__ === 'function') { try { const s = exc.__str__(); if (typeof s === 'string') msg = s; } catch { /* keep args */ } }
    const err = new AdderError(cls._pyName, msg, line, exc.args || []);
    err.pyValue = exc;
    err.pyClass = cls;
    return err;
  }
  return new AdderError('TypeError', 'exceptions must derive from BaseException', line);
}
// what `except ... as e` binds
export function excValue(err) {
  return err && err.pyValue !== undefined ? err.pyValue : err;
}
// the exception's names, most specific first, for matching
function _excNames(err) {
  if (err && err.pyValue && err.pyClass) {
    const names = [];
    for (const c of err.pyClass._pyMRO) {
      if (isBuiltinExcType(c)) { names.push(..._excChain(c._pyName)); return names; }
      names.push(c._pyName);
    }
    return names;
  }
  if (err instanceof AdderError) return _excChain(err.pyType);
  if (err instanceof Error) return _excChain(/call stack/i.test(err.message || '') ? 'RecursionError' : (_JS_EXC[err.name] || 'Exception'));
  return [];
}
export function excMatches(err, t) {
  if (err && err.pyType === 'BudgetExceeded') return false;
  if (t === null || t === undefined) return true;
  if (Array.isArray(t)) return t.some((x) => excMatches(err, x));
  if (typeof t === 'function' && t._pyMRO && !isBuiltinExcType(t)) {
    const v = err && err.pyValue;
    return !!(v && v.__adderType__ && v.__adderType__._pyMRO && v.__adderType__._pyMRO.includes(t));
  }
  if (typeof t === 'function' && !t._pyClass) { try { if (err instanceof t) return true; } catch { /* arrow */ } }
  const name = typeof t === 'function' ? (t._pyName || t.name) : (typeof t === 'string' ? t : null);
  return !!name && _excNames(err).includes(name);
}
// the type object of a caught exception (for __exit__ and type())
export function excTypeOf(err) {
  if (err && err.pyClass) return err.pyClass;
  if (err instanceof AdderError) return _typeObjects[err.pyType] || null;
  if (err instanceof Error) return _typeObjects[_JS_EXC[err.name] || 'Exception'] || null;
  return null;
}

export function _mapVFSError(e) {
  const map = { ENOENT: 'FileNotFoundError', EEXIST: 'FileExistsError',
    EISDIR: 'IsADirectoryError', ENOTDIR: 'NotADirectoryError', EACCES: 'PermissionError' };
  return new AdderError(map[e?.code] || 'OSError', e?.message || String(e));
}

// ── file object ──

export async function _createAdderFile(vfs, filePath, mode) {
  const isBinary = mode.includes('b');
  const isRead = mode[0] === 'r';
  const isAppend = mode[0] === 'a';

  let _content = null, _buffer = isBinary ? [] : '', _pos = 0, _closed = false;

  if (isRead || isAppend) {
    try {
      _content = await vfs.readFile(filePath, isBinary ? 'bytes' : undefined);
      if (isAppend) _buffer = isBinary ? [_content] : _content;
    } catch (e) {
      if (isRead) throw _mapVFSError(e);
      _content = isBinary ? new Uint8Array(0) : '';
    }
  }

  const f = {
    _path: filePath, _mode: mode,
    __adderClass__: isBinary ? 'BufferedIOBase' : 'TextIOWrapper',

    read(size) {
      if (_closed) throw new AdderError('ValueError', 'I/O operation on closed file');
      if (!isRead) throw new AdderError('IOError', 'not readable');
      if (size != null) { const chunk = _content.slice(_pos, _pos + size); _pos += size; return chunk; }
      const rest = _content.slice(_pos);
      _pos = typeof _content === 'string' ? _content.length : _content.byteLength;
      return rest;
    },

    readline() {
      if (_closed) throw new AdderError('ValueError', 'I/O operation on closed file');
      if (!isRead) throw new AdderError('IOError', 'not readable');
      if (typeof _content !== 'string') throw new AdderError('IOError', 'readline on binary file');
      const nl = _content.indexOf('\n', _pos);
      if (nl === -1) { const line = _content.slice(_pos); _pos = _content.length; return line; }
      const line = _content.slice(_pos, nl + 1);
      _pos = nl + 1;
      return line;
    },

    readlines() {
      if (_closed) throw new AdderError('ValueError', 'I/O operation on closed file');
      if (!isRead) throw new AdderError('IOError', 'not readable');
      const lines = [];
      const len = typeof _content === 'string' ? _content.length : _content.byteLength;
      while (_pos < len) lines.push(f.readline());
      return lines;
    },

    write(data) {
      if (_closed) throw new AdderError('ValueError', 'I/O operation on closed file');
      if (isRead) throw new AdderError('IOError', 'not writable');
      if (isBinary) {
        const chunk = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
        _buffer.push(chunk);
        return chunk.byteLength;
      }
      const s = String(data);
      _buffer += s;
      return s.length;
    },

    writelines(lines) { for (const line of pyIter(lines)) f.write(line); return null; },

    async close() {
      if (_closed) return;
      _closed = true;
      if (!isRead) {
        try {
          if (isBinary) {
            const total = _buffer.reduce((s, b) => s + b.byteLength, 0);
            const result = new Uint8Array(total);
            let off = 0;
            for (const b of _buffer) { result.set(b, off); off += b.byteLength; }
            await vfs.writeFile(filePath, result);
          } else {
            await vfs.writeFile(filePath, _buffer);
          }
        } catch (e) { throw _mapVFSError(e); }
      }
    },

    __enter__() { return f; },
    async __exit__() { await f.close(); return false; },
    __repr__() { return `<_io.${isBinary ? 'BufferedWriter' : 'TextIOWrapper'} name='${filePath}' mode='${mode}'>`; },
    __str__() { return f.__repr__(); },
    __bool__() { return true; },

    [Symbol.iterator]() {
      if (!isRead) throw new AdderError('IOError', 'not readable');
      let iterPos = _pos;
      const content = _content;
      return {
        next() {
          const len = typeof content === 'string' ? content.length : content.byteLength;
          if (iterPos >= len) return { done: true };
          if (typeof content !== 'string') {
            const rest = content.slice(iterPos);
            iterPos = content.byteLength;
            return { value: rest, done: false };
          }
          const nl = content.indexOf('\n', iterPos);
          if (nl === -1) {
            const line = content.slice(iterPos);
            iterPos = content.length;
            return line ? { value: line, done: false } : { done: true };
          }
          const line = content.slice(iterPos, nl + 1);
          iterPos = nl + 1;
          return { value: line, done: false };
        }
      };
    },

    get name() { return filePath; },
    get closed() { return _closed; },
  };

  return f;
}

// ── os module ──

function _createOsModule(getVfs, pth) {
  const _resolve = (p) => _resolvePath(p, pth);

  const osPath = {
    join: (...parts) => pth.join(...parts),
    dirname: (p) => pth.dirname(p),
    basename: (p) => pth.basename(p),
    splitext: (p) => { const ext = pth.extname(p); return mkTuple(ext ? [p.slice(0, -ext.length), ext] : [p, '']); },
    normpath: (p) => pth.normalize(p),
    relpath: (p, start) => pth.relative(start || _cwd.value, p),
    isabs: (p) => pth.isAbsolute(p),
    exists: async (p) => { try { await getVfs().stat(_resolve(p)); return true; } catch { return false; } },
    isfile: async (p) => { try { return (await getVfs().stat(_resolve(p))).type === 'file'; } catch { return false; } },
    isdir: async (p) => { try { return (await getVfs().stat(_resolve(p))).type === 'directory'; } catch { return false; } },
    getsize: async (p) => { try { return (await getVfs().stat(_resolve(p))).size; } catch (e) { throw _mapVFSError(e); } },
    sep: '/',
  };

  const os = {
    sep: '/', linesep: '\n', name: 'posix',
    path: osPath,

    listdir: async (p) => {
      try { return await getVfs().readdir(_resolve(p || '.')); }
      catch (e) { throw _mapVFSError(e); }
    },
    mkdir: async (p) => {
      try { await getVfs().mkdir(_resolve(p)); }
      catch (e) { throw _mapVFSError(e); }
    },
    makedirs: async (p, exist_ok) => {
      if (exist_ok != null && typeof exist_ok === 'object' && exist_ok._kw) exist_ok = exist_ok.exist_ok;
      const resolved = _resolve(p);
      const vfs = getVfs();
      let exists = false;
      try { await vfs.stat(resolved); exists = true; } catch {}
      if (exists && !exist_ok) throw new AdderError('FileExistsError', resolved);
      if (!exists) {
        try { await vfs.mkdir(resolved, { recursive: true }); }
        catch (e) { throw _mapVFSError(e); }
      }
    },
    remove: async (p) => {
      try { await getVfs().unlink(_resolve(p)); }
      catch (e) { throw _mapVFSError(e); }
    },
    unlink: async (p) => {
      try { await getVfs().unlink(_resolve(p)); }
      catch (e) { throw _mapVFSError(e); }
    },
    rmdir: async (p) => {
      try { await getVfs().rmdir(_resolve(p)); }
      catch (e) { throw _mapVFSError(e); }
    },
    rename: async (src, dst) => {
      try { await getVfs().rename(_resolve(src), _resolve(dst)); }
      catch (e) { throw _mapVFSError(e); }
    },
    stat: async (p) => {
      try {
        const info = await getVfs().stat(_resolve(p));
        return { st_size: info.size, st_mtime: info.modified?.getTime() / 1000 || 0,
                 st_mode: info.mode || 0, st_type: info.type };
      } catch (e) { throw _mapVFSError(e); }
    },
    getcwd: () => _cwd.value,
    chdir: (p) => { _cwd.value = _resolve(p); },

    walk: (top) => {
      const resolved = _resolve(top || '.');
      const vfs = getVfs();
      async function* gen(dir) {
        let entries;
        try { entries = await vfs.readdir(dir); } catch { return; }
        const dirs = [], files = [];
        for (const name of entries) {
          const full = dir === '/' ? '/' + name : dir + '/' + name;
          try {
            const info = await vfs.stat(full);
            if (info.type === 'directory') dirs.push(name);
            else files.push(name);
          } catch { files.push(name); }
        }
        yield [dir, dirs, files];
        for (const d of dirs) {
          yield* gen(dir === '/' ? '/' + d : dir + '/' + d);
        }
      }
      return { [Symbol.asyncIterator]() { return gen(resolved); } };
    },
  };

  return os;
}

// ── pathlib module ──

function _createPathClass(getVfs, pth) {
  function _Path(p) {
    if (typeof p === 'object' && p?._path) return p;
    let raw = String(p || '.');
    // expand ~ but don't resolve relative paths (pathlib keeps them relative)
    if (raw === '~') raw = _HOME;
    else if (raw.startsWith('~/')) raw = _HOME + raw.slice(1);
    const _p = pth.normalize(raw);
    // resolve for I/O — relative paths against cwd
    const _abs = () => pth.isAbsolute(_p) ? _p : pth.join(_cwd.value, _p);
    return {
      _path: _p,
      __adderClass__: 'PosixPath',
      get name() { return pth.basename(_p); },
      get stem() { const b = pth.basename(_p); const ext = pth.extname(_p); return ext ? b.slice(0, -ext.length) : b; },
      get suffix() { return pth.extname(_p); },
      get parent() { return _Path(pth.dirname(_p)); },
      get parts() { return _p === '/' ? ['/'] : ['/', ..._p.split('/').filter(Boolean)]; },

      __truediv__(other) { return _Path(pth.join(_p, String(other?._path || other))); },
      __str__() { return _p; },
      __repr__() { return `PosixPath('${_p}')`; },
      __eq__(other) { return _p === (other?._path || String(other)); },
      __hash__() { let h = 0; for (let i = 0; i < _p.length; i++) h = (h * 31 + _p.charCodeAt(i)) | 0; return h; },

      joinpath(...parts) { return _Path(pth.join(_p, ...parts.map(x => x?._path || String(x)))); },
      with_suffix(s) { const ext = pth.extname(_p); const base = ext ? _p.slice(0, -ext.length) : _p; return _Path(base + s); },
      with_name(n) { return _Path(pth.join(pth.dirname(_p), n)); },

      async read_text() { try { return await getVfs().readFile(_abs()); } catch (e) { throw _mapVFSError(e); } },
      async read_bytes() { try { return await getVfs().readFile(_abs(), 'bytes'); } catch (e) { throw _mapVFSError(e); } },
      async write_text(data) { try { await getVfs().writeFile(_abs(), String(data)); } catch (e) { throw _mapVFSError(e); } },
      async write_bytes(data) { try { await getVfs().writeFile(_abs(), data); } catch (e) { throw _mapVFSError(e); } },
      async exists() { return getVfs().exists(_abs()); },
      async is_file() { try { return (await getVfs().stat(_abs())).type === 'file'; } catch { return false; } },
      async is_dir() { try { return (await getVfs().stat(_abs())).type === 'directory'; } catch { return false; } },
      async mkdir(parents, exist_ok) {
        if (parents != null && typeof parents === 'object' && parents._kw) { exist_ok = parents.exist_ok; parents = parents.parents; }
        try { await getVfs().mkdir(_abs(), { recursive: !!parents }); }
        catch (e) { if (exist_ok && e?.code === 'EEXIST') return; throw _mapVFSError(e); }
      },
      async unlink() { try { await getVfs().unlink(_abs()); } catch (e) { throw _mapVFSError(e); } },
      async rename(target) { const t = target?._path || String(target); const ta = pth.isAbsolute(t) ? t : pth.join(_cwd.value, t); try { await getVfs().rename(_abs(), ta); return _Path(t); } catch (e) { throw _mapVFSError(e); } },
      async iterdir() {
        try {
          const entries = await getVfs().readdir(_abs());
          return entries.map(name => _Path(pth.join(_p, name)));
        } catch (e) { throw _mapVFSError(e); }
      },
      async glob(pattern) {
        try { return await getVfs().glob(pth.join(_abs(), pattern)); }
        catch (e) { throw _mapVFSError(e); }
      },
      async touch() { try { await getVfs().touch(_abs()); } catch (e) { throw _mapVFSError(e); } },
      async stat() {
        try {
          const info = await getVfs().stat(_abs());
          return { st_size: info.size, st_mtime: info.modified?.getTime() / 1000 || 0, st_mode: info.mode || 0, st_type: info.type };
        } catch (e) { throw _mapVFSError(e); }
      },
    };
  }
  return _Path;
}

// ── shutil module ──

function _createShutilModule(getVfs) {
  // Resolve user-facing paths (relative-to-cwd, ~ expansion) before
  // passing to VFS — `os` and `os.path` already do this via _resolve;
  // shutil/glob used to skip that step and the raw `data/foo.csv`
  // hit `vfs.resolve` which has no mount for non-absolute paths.
  const r = (p) => _resolvePath(p, _vfsPath);
  return {
    copy: async (src, dst) => { try { await getVfs().cp(r(src), r(dst)); } catch (e) { throw _mapVFSError(e); } },
    copy2: async (src, dst) => { try { await getVfs().cp(r(src), r(dst)); } catch (e) { throw _mapVFSError(e); } },
    copytree: async (src, dst) => { try { await getVfs().cp(r(src), r(dst), { recursive: true }); } catch (e) { throw _mapVFSError(e); } },
    rmtree: async (p) => { try { await getVfs().rm(r(p), { recursive: true }); } catch (e) { throw _mapVFSError(e); } },
    move: async (src, dst) => { try { await getVfs().rename(r(src), r(dst)); } catch (e) { throw _mapVFSError(e); } },
  };
}

// ── glob module ──

function _createGlobModule(getVfs) {
  return {
    glob: async (pattern) => {
      try { return await getVfs().glob(_resolvePath(pattern, _vfsPath)); }
      catch (e) { throw _mapVFSError(e); }
    },
  };
}

// ── fs module registration ──

let _adderVFS = null;
let _vfsPath = null;

export function getAdderVFS() { return _adderVFS; }
export function _getVfsPath() { return _vfsPath; }

export function setAdderVFS(vfsInstance, pathUtils) {
  _adderVFS = vfsInstance;
  if (pathUtils) _vfsPath = pathUtils;
  // reset cwd and module cache for the new VFS
  _cwd.value = _HOME;
  for (const k of Object.keys(_sysModule.modules)) delete _sysModule.modules[k];
  // re-register modules if path available (allows calling setAdderVFS after initial load)
  if (_vfsPath) {
    delete adderModules.os;
    _ensureFsModules();
  }
}

export function _ensureFsModules(pathUtils) {
  if (adderModules.os) return;
  if (pathUtils) _vfsPath = pathUtils;
  if (!_vfsPath) {
    try { if (typeof path !== 'undefined' && path.join) _vfsPath = path; } catch {}
  }
  if (!_vfsPath) return;

  const pth = _vfsPath;
  const getVfs = () => {
    if (!_adderVFS) throw new AdderError('RuntimeError', 'filesystem not available — call adder.setVFS(vfsInstance, pathUtils) first');
    return _adderVFS;
  };

  adderModules.os = _createOsModule(getVfs, pth);
  adderModules['os.path'] = adderModules.os.path;
  adderModules.pathlib = { Path: _createPathClass(getVfs, pth) };
  adderModules.shutil = _createShutilModule(getVfs);
  adderModules.glob = _createGlobModule(getVfs);
}

// dict(mapping | pairs, **kw)
async function _dictFrom(args) {
  const kw = args.length && args[args.length - 1]?._kw ? args.pop() : null;
  if (args.length > 1) throw new AdderError('TypeError', `dict expected at most 1 argument, got ${args.length}`);
  const entries = [];
  const x = args[0];
  if (args.length === 0) { /* empty */ }
  else if (x === null || x === undefined || typeof x !== 'object' && typeof x !== 'string') throw new AdderError('TypeError', `'${pyTypeName(x)}' object is not iterable`);
  else if (x instanceof Map) entries.push(...x.entries());
  else if (isPlainDict(x)) for (const k of Object.keys(x)) entries.push([k, x[k]]);
  else if (typeof x.keys === 'function' && typeof x.__getitem__ === 'function') {
    // a mapping (anything with keys() and __getitem__), as CPython's dict() reads it
    for (const k of await pyCollect(await x.keys())) entries.push([k, await x.__getitem__(k)]);
  } else {
    const items = Array.isArray(x) ? x : await pyCollect(x);
    items.forEach((it, i) => {
      const pair = Array.isArray(it) ? it : typeof it === 'string' ? [...it] : null;
      if (!pair || pair.length !== 2) throw new AdderError('ValueError', `dictionary update sequence element #${i} has length ${pair ? pair.length : 1}; 2 is required`);
      entries.push(pair);
    });
  }
  if (kw) for (const k of Object.keys(kw)) if (k !== '_kw') entries.push([k, kw[k]]);
  // string keys only → a plain object (JS cells read d.a), as a literal; empty → PyDict
  if (entries.length && entries.every(([k]) => typeof k === 'string')) {
    const o = {};
    for (const [k, v] of entries) o[k] = v;
    return o;
  }
  return new PyDict(entries);
}

// ── stdout / stderr ──
// The host's writers for the program running now: run() sets them from its options, a notebook
// cell from its output. sys.stdout / sys.stderr and print(file=sys.stderr) write through here.
export const _stdio = { out: null, err: null, redirect: null };
// the exceptions being handled, innermost last: both engines push on entering an except body and
// pop on leaving it (a bare `raise`, sys.exc_info(), sys.exception(), logging.exception read it)
export const excStack = [];
function _stdioWrite(which, s) {
  const w = _stdio[which];
  if (w) { w(s); return; }
  if (typeof process !== 'undefined' && process[which === 'out' ? 'stdout' : 'stderr']) process[which === 'out' ? 'stdout' : 'stderr'].write(s);
  else if (typeof console !== 'undefined') console[which === 'out' ? 'log' : 'error'](s.replace(/\n$/, ''));
}
// print(..., file=f): f.write(text), awaited when the file's write is async (a VFS file)
export function printToFile(file, text) {
  const w = adderGetAttr(file, 'write');
  return w(text);
}

// ── list[int], dict[str, int], int | None ──
// The runtime objects annotations evaluate to: printable, comparable, and usable in isinstance
// (a union); typing's Optional / List / … are the same objects under their typing names.
// a compiled function's JS name, as Python names it: AIR emits a JS-reserved Python name with a
// trailing `$` (function new$ for `def new`), and no Python identifier contains a `$`
const _jsFnName = (f) => (typeof f.name === 'string' && f.name.endsWith('$') ? f.name.slice(0, -1) : f.name);
export const Ellipsis = Object.freeze({ __adderClass__: 'ellipsis', __repr__: () => 'Ellipsis', __str__: () => 'Ellipsis' });
// a binary dunder's "not mine": Python then tries the reflected method (_viaDunder, pyEq)
export const NotImplemented = Object.freeze({ __adderClass__: 'NotImplementedType', __repr__: () => 'NotImplemented', __bool__: () => true });
function _typeArgText(t) {
  if (t === Ellipsis) return '...';
  if (t === null || t === undefined) return 'None';
  if (typeof t === 'function') return t._pyName || t.name || '?';
  if (typeof t === 'string') return pyRepr(t);
  if (Array.isArray(t) && !(t instanceof PyTuple)) return `[${t.map(_typeArgText).join(', ')}]`;
  return pyRepr(t);
}
export class GenericAlias {
  constructor(origin, args, name) {
    this.__origin__ = origin;
    this.__args__ = mkTuple(args);
    this._name = name || null;
  }
  __repr__() { return `${this._name || _typeArgText(this.__origin__)}[${this.__args__.length ? this.__args__.map(_typeArgText).join(', ') : '()'}]`; }
  __eq__(o) { return o instanceof GenericAlias && o.__origin__ === this.__origin__ && o._name === this._name && pyEq(this.__args__, o.__args__); }
  __hash__() { return `ga:${this.__repr__()}`; }
  __getitem__(k) { return new GenericAlias(this.__origin__, k instanceof PyTuple ? [...k] : [k], this._name); }
  __or__(o) { return makeUnion(this, o); }
  __ror__(o) { return makeUnion(o, this); }
}
GenericAlias.prototype.__adderClass__ = 'GenericAlias';
export class UnionType {
  constructor(args) { this.__args__ = mkTuple(args); }
  __repr__() { return this.__args__.map(_typeArgText).join(' | '); }
  __eq__(o) { return o instanceof UnionType && this.__args__.length === o.__args__.length && this.__args__.every((a) => o.__args__.some((b) => a === b || pyEq(a, b) === true)); }
  __hash__() { return `ut:${this.__repr__()}`; }
  __or__(o) { return makeUnion(this, o); }
  __ror__(o) { return makeUnion(o, this); }
}
UnionType.prototype.__adderClass__ = 'UnionType';
function _isTypeLike(t) {
  return t === null || (typeof t === 'function' && !!t._pyClass) || t instanceof GenericAlias || t instanceof UnionType;
}
// A | B: flattened, without repeats (int | int is int)
export function makeUnion(a, b) {
  const out = [];
  for (const t of [a, b]) for (const x of (t instanceof UnionType ? t.__args__ : [t])) if (!out.some((y) => y === x || (x instanceof GenericAlias && pyEq(x, y) === true))) out.push(x);
  return out.length === 1 ? out[0] : new UnionType(out);
}

// ── match / case: one matcher for both engines ──
// pyMatch(subject, descriptor, values, binds): does the subject fit the pattern? Captures go
// into `binds` (a Map). The descriptor comes from compileMatchPattern (parse.js); `values`
// holds the evaluated literals / dotted names / mapping keys / classes it refers to.
const _MATCH_SELF_TYPES = new Set(['bool', 'bytearray', 'bytes', 'dict', 'float', 'frozenset', 'int', 'list', 'set', 'str', 'tuple']);
const _mroNamed = (x, names) => !!(x && x.__adderType__ && x.__adderType__._pyMRO && x.__adderType__._pyMRO.some((c) => names.includes(c._pyName)));
// a sequence pattern matches lists, tuples, ranges, deques and Sequence subclasses — never
// str / bytes, and not a dict
function _matchSeqItems(x) {
  if (Array.isArray(x)) return x;
  if (x instanceof AdderRange) return [...x];
  if (x !== null && typeof x === 'object' && (x.__adderClass__ === 'deque' || _mroNamed(x, ['Sequence', 'MutableSequence']))) return null;   // collected below
  return undefined;
}
const _isMatchMapping = (x) => x instanceof Map || isPlainDict(x) || _mroNamed(x, ['Mapping', 'MutableMapping']);
async function _matchGetattr(obj, name) {
  try { const v = adderGetAttr(obj, name); return { ok: true, v: v && typeof v.then === 'function' ? await v : v }; }
  catch (e) { if (e && e.pyType === 'AttributeError') return { ok: false }; throw e; }
}
export async function pyMatch(subject, d, vals, binds) {
  switch (d.k) {
    case 'any': return true;
    case 'cap': binds.set(d.name, subject); return true;
    case 'as':
      if (!(await pyMatch(subject, d.p, vals, binds))) return false;
      binds.set(d.name, subject);
      return true;
    case 'val': { const r = pyEq(subject, vals[d.i]); return pyBool(r && typeof r.then === 'function' ? await r : r); }
    case 'single': return subject === d.v || (d.v === null && subject === undefined);
    case 'or':
      for (const alt of d.ps) {
        const b = new Map(binds);
        if (await pyMatch(subject, alt, vals, b)) { for (const [k, v] of b) binds.set(k, v); return true; }
      }
      return false;
    case 'seq': {
      let items = _matchSeqItems(subject);
      if (items === undefined) return false;
      if (items === null) items = await pyCollect(subject);
      const star = d.ps.findIndex((q) => q.k === 'star');
      if (star < 0) {
        if (items.length !== d.ps.length) return false;
        for (let i = 0; i < items.length; i++) if (!(await pyMatch(items[i], d.ps[i], vals, binds))) return false;
        return true;
      }
      const after = d.ps.length - star - 1;
      if (items.length < star + after) return false;
      for (let i = 0; i < star; i++) if (!(await pyMatch(items[i], d.ps[i], vals, binds))) return false;
      for (let i = 0; i < after; i++) if (!(await pyMatch(items[items.length - after + i], d.ps[star + 1 + i], vals, binds))) return false;
      if (d.ps[star].name) binds.set(d.ps[star].name, items.slice(star, items.length - after));
      return true;
    }
    case 'map': {
      if (!_isMatchMapping(subject)) return false;
      const keys = d.keys.map((i) => vals[i]);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        let v;
        if (subject instanceof Map) { if (!subject.has(k)) return false; v = subject.get(k); }
        else if (isPlainDict(subject)) { if (typeof k !== 'string' || !Object.hasOwn(subject, k)) return false; v = subject[k]; }
        else {
          const has = await subject.__contains__(k);
          if (!pyBool(has)) return false;
          v = await subject.__getitem__(k);
        }
        if (!(await pyMatch(v, d.ps[i], vals, binds))) return false;
      }
      if (d.rest) {
        if (isPlainDict(subject)) { const o = {}; for (const kk of Object.keys(subject)) if (!keys.includes(kk)) o[kk] = subject[kk]; binds.set(d.rest, o); }
        else {
          const out = new PyDict();
          const entries = subject instanceof Map ? [...subject] : await Promise.all((await pyCollect(subject)).map(async (kk) => [kk, await subject.__getitem__(kk)]));
          for (const [kk, vv] of entries) if (!keys.some((x) => x === kk || pyEq(x, kk) === true)) out.set(kk, vv);
          binds.set(d.rest, out);
        }
      }
      return true;
    }
    case 'cls': {
      const cls = vals[d.c];
      if (typeof cls !== 'function' || !cls._pyClass) throw new AdderError('TypeError', 'called match pattern must be a class');
      if (!_pyIsInstance(subject, cls)) return false;
      const name = cls.__name__ || cls._pyName;
      if (d.ps.length) {
        if (!cls._pyMRO && _MATCH_SELF_TYPES.has(cls._pyName)) {
          if (d.ps.length > 1) throw new AdderError('TypeError', `${name}() accepts 1 positional sub-pattern (${d.ps.length} given)`);
          if (!(await pyMatch(subject, d.ps[0], vals, binds))) return false;
        } else {
          const ma = cls.__match_args__;
          const args = ma === undefined || ma === null ? [] : [...pyIter(ma)];
          if (d.ps.length > args.length) throw new AdderError('TypeError', `${name}() accepts ${args.length} positional sub-pattern${args.length === 1 ? '' : 's'} (${d.ps.length} given)`);
          for (let i = 0; i < d.ps.length; i++) {
            const a = await _matchGetattr(subject, args[i]);
            if (!a.ok || !(await pyMatch(a.v, d.ps[i], vals, binds))) return false;
          }
        }
      }
      for (let i = 0; i < d.kw.length; i++) {
        const a = await _matchGetattr(subject, d.kw[i]);
        if (!a.ok || !(await pyMatch(a.v, d.kps[i], vals, binds))) return false;
      }
      return true;
    }
    default: throw new AdderError('SystemError', `unknown match pattern ${d.k}`);
  }
}

// ── class hooks shared by both engines ──
// An annotation's source text: what __annotations__ holds (as under `from __future__ import
// annotations`), and what dataclasses reads the field list from.
const _BINOP_TEXT = new Set(['|', '+', '-', '*', '/', '&']);
export function annotationText(n) {
  if (!n) return '';
  switch (n.type) {
    case 'Name': return n.ellipsis ? '...' : n.id;
    case 'Attribute': return `${annotationText(n.value)}.${n.attr}`;
    case 'Subscript': return `${annotationText(n.value)}[${n.slice && n.slice.type === 'Tuple' ? n.slice.elts.map(annotationText).join(', ') : annotationText(n.slice)}]`;
    case 'Constant': return typeof n.value === 'string' ? n.value : n.value === null ? 'None' : String(n.value);
    case 'Tuple': return n.elts.map(annotationText).join(', ');
    case 'List': return `[${n.elts.map(annotationText).join(', ')}]`;
    case 'BinOp': return _BINOP_TEXT.has(n.op) ? `${annotationText(n.left)} ${n.op} ${annotationText(n.right)}` : '...';
    default: return '...';
  }
}
// the class body's `name: annotation [= value]` lines, in order
export function classAnnotations(body) {
  const out = [];
  for (const s of body || []) if (s.type === 'AnnAssign' && s.target && s.target.type === 'Name') out.push([s.target.id, annotationText(s.annotation)]);
  return out;
}
// The last step of building a class, after its members and MRO and before its decorators:
// record __annotations__, then run the nearest base's __init_subclass__ (Python calls it
// implicitly as a classmethod; enum.Enum is built on it). May return a promise.
export function finishClass(cls, annotations) {
  if (annotations && annotations.length) {
    const d = new PyDict();
    for (const [k, t] of annotations) d.set(k, t);
    cls.__annotations__ = d;
  }
  const mro = cls._pyMRO || [cls];
  for (let i = 1; i < mro.length; i++) {
    const hook = mro[i].__init_subclass__;
    if (typeof hook === 'function') {
      const r = hook(cls);
      return r && typeof r.then === 'function' ? r.then(() => cls) : cls;
    }
  }
  return cls;
}

// ── builtins ──

export function adderBuiltins(printFn) {
  const builtins = {
    print: (...args) => {
      let sep = ' ', end = '\n';
      // handle keyword args passed as last object with _kw marker
      let file = null;
      if (args.length > 0 && args[args.length - 1]?._kw) {
        const kw = args.pop();
        if (kw.sep != null) sep = kw.sep;
        if (kw.end != null) end = kw.end;
        if (kw.file != null && kw.file !== _sysModule.stdout) file = kw.file;
      }
      if (!file && _stdio.redirect) file = _stdio.redirect;   // contextlib.redirect_stdout
      const out = file ? (t) => printToFile(file, t) : printFn;
      const parts = args.map(pyStrMaybe);
      if (parts.some(_isThenable)) return Promise.all(parts).then((ps) => out(ps.join(sep) + end)).then(() => null);
      const r = out(parts.join(sep) + end);
      return _isThenable(r) ? r.then(() => null) : null;
    },
    len: (obj) => {
      if (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Uint8Array) return obj.length;
      if (obj instanceof Map || obj instanceof Set) return obj.size;
      if (obj instanceof AdderRange) return obj.length;
      if (typeof obj === 'function' && typeof obj.__len__ === 'function') return obj.__len__();   // a class (an Enum)
      if (typeof obj === 'object' && obj !== null) {
        if (typeof obj.__len__ === 'function') return obj.__len__();
        if (typeof obj.length === 'number') return obj.length;
        return Object.keys(obj).length;
      }
      throw new AdderError('TypeError', `object of type '${pyTypeName(obj)}' has no len()`);
    },
    range: (a, b, c) => new AdderRange(a, b, c),
    int: (x, base) => {
      if (base && base._kw) base = base.base;
      if (x && x._kw) { base = x.base; x = undefined; }
      if (x === undefined) return 0;
      if (base !== undefined && base !== null) {
        if (typeof x !== 'string') throw new AdderError('TypeError', "int() can't convert non-string with explicit base");
        return _parseIntStrict(x, base);
      }
      if (typeof x === 'string') return _parseIntStrict(x, 10);
      if (typeof x === 'boolean') return x ? 1 : 0;
      if (typeof x === 'number') {
        if (Number.isNaN(x)) throw new AdderError('ValueError', 'cannot convert float NaN to integer');
        if (!Number.isFinite(x)) throw new AdderError('OverflowError', 'cannot convert float infinity to integer');
        return Math.trunc(x) || 0;
      }
      if (typeof x === 'bigint') return x;
      if (x && typeof x.__int__ === 'function') return x.__int__();
      if (x && typeof x.__index__ === 'function') return x.__index__();
      throw new AdderError('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${pyTypeName(x)}'`);
    },
    float: (x) => { if (x === undefined) return 0.0; if (typeof x === 'string') { const s = x.trim().toLowerCase(); if (s === 'inf' || s === '+inf' || s === 'infinity') return Infinity; if (s === '-inf' || s === '-infinity') return -Infinity; if (s === 'nan') return NaN; if (s === '') throw new AdderError('ValueError', `could not convert string to float: ${pyRepr(x)}`); const n = Number(x); if (isNaN(n)) throw new AdderError('ValueError', `could not convert string to float: ${pyRepr(x)}`); return n; } return Number(x); },
    str: (x) => x === undefined ? '' : pyStrMaybe(x),
    bool: (x) => x === undefined ? false : pyBool(x),
    list: Object.assign(
      (x) => x === undefined ? [] : pyCollect(x),
      { _pyContainerType: 'list' },
    ),
    // a call with no argument answers synchronously, so defaultdict(list) & co. store a value
    tuple: (x) => (x === undefined ? mkTuple([]) : x instanceof PyTuple ? x : pyCollect(x).then(mkTuple)),
    dict: (...args) => (args.length === 0 ? new PyDict() : _dictFrom(args)),
    set: (x) => x === undefined ? new PySet() : pyCollect(x).then((xs) => new PySet(xs)),
    // bytes(): b'', bytes(n) zeros, bytes(ints), bytes(str, encoding)
    bytes: (x, encoding) => {
      if (x === undefined) return new Uint8Array(0);
      if (typeof x === 'number') return new Uint8Array(x);
      if (typeof x === 'string') {
        if (encoding === undefined) throw new AdderError('TypeError', 'string argument without an encoding');
        return _strMethod(x, 'encode')(encoding);
      }
      if (x instanceof Uint8Array) return new Uint8Array(x);
      const items = [...pyIter(x)];   // sync: AIR calls bytes() without an await
      for (const v of items) if (!Number.isInteger(v) || v < 0 || v > 255) throw new AdderError('ValueError', 'bytes must be in range(0, 256)');
      return Uint8Array.from(items);
    },
    frozenset: async (x) => { const s = x === undefined ? new PySet() : new PySet(await pyCollect(x)); s._frozen = true; return s; },
    abs: (x) => (typeof x === 'object' && x !== null && typeof x.__abs__ === 'function') ? x.__abs__() : Math.abs(x),
    round: (x, n) => pyRound(x, n),
    max: async (...args) => pyExtreme('max', args),
    min: async (...args) => pyExtreme('min', args),
    // sum: numbers with compensated (Neumaier) summation, as CPython 3.12+ does for floats;
    // lists concatenate; anything else through its __add__; strings are refused, as in Python
    sum: async (iterable, start) => {
      if (start && start._kw) start = start.start;
      const items = await pyCollect(iterable);
      let s = start !== undefined ? start : 0;
      if (typeof s === 'string') throw new AdderError('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
      if (_numLike(s) && items.every(_numLike)) {
        let total = Number(s), c = 0;
        for (const v of items) {
          const x = Number(v), t = total + x;
          c += Math.abs(total) >= Math.abs(x) ? (total - t) + x : (x - t) + total;
          total = t;
        }
        return total + c;
      }
      for (const v of items) {
        if (Array.isArray(s) && Array.isArray(v)) s = s.concat(v);
        else if (_hasDunder(s, '__add__')) { const r = s.__add__(v); s = r && typeof r.then === 'function' ? await r : r; }
        else if (_hasDunder(v, '__radd__')) { const r = v.__radd__(s); s = r && typeof r.then === 'function' ? await r : r; }
        else if (_numLike(s) && _numLike(v)) s = s + v;
        else throw new AdderError('TypeError', `unsupported operand type(s) for +: '${pyTypeName(s)}' and '${pyTypeName(v)}'`);
      }
      return s;
    },
    sorted: async (iterable, key, reverse) => {
      if (key?._kw) { reverse = key.reverse; key = key.key; }
      else if (reverse?._kw) reverse = reverse.reverse;
      return pySorted(await pyCollect(iterable), key || null, !!reverse);
    },
    reversed: async (iterable) => { const arr = await pyCollect(iterable); arr.reverse(); return arr; },
    // lazy iterators, as in Python 3 (zip(count(), xs) works); synchronous when every input is
    enumerate: (iterable, start) => {
      if (start && start._kw) start = start.start;
      let i = start || 0;
      if (_isSyncSource(iterable)) return _lazySyncIter('enumerate', function* () { for (const v of pyIter(iterable)) yield mkTuple([i++, v]); });
      return _lazyIter('enumerate', async function* () { for await (const v of _pyEach(iterable)) yield mkTuple([i++, v]); });
    },
    zip: (...iterables) => {
      const kw = iterables.length && iterables[iterables.length - 1] && iterables[iterables.length - 1]._kw ? iterables.pop() : null;
      const strict = !!(kw && kw.strict);
      const shortErr = (i) => new AdderError('ValueError', `zip() argument ${i + 1} is shorter than argument${i > 1 ? 's 1-' + i : ' 1'}`);
      const longErr = (i) => new AdderError('ValueError', `zip() argument ${i + 1} is longer than argument${i > 1 ? 's 1-' + i : ' 1'}`);
      if (iterables.every(_isSyncSource)) {
        return _lazySyncIter('zip', function* () {
          if (!iterables.length) return;
          const its = iterables.map((x) => pyIter(x));
          for (;;) {
            const vals = [];
            for (let i = 0; i < its.length; i++) {
              const r = its[i].next();
              if (r.done) {
                if (strict) { if (i > 0) throw shortErr(i); for (let k = 1; k < its.length; k++) if (!its[k].next().done) throw longErr(k); }
                return;
              }
              vals.push(r.value);
            }
            yield mkTuple(vals);
          }
        });
      }
      return _lazyIter('zip', async function* () {
        if (!iterables.length) return;
        const its = iterables.map((x) => { const e = _pyEach(x); return e[Symbol.asyncIterator] ? e[Symbol.asyncIterator]() : e[Symbol.iterator](); });
        for (;;) {
          const vals = [];
          for (let i = 0; i < its.length; i++) {
            const r = await its[i].next();
            if (r.done) {
              if (strict) { if (i > 0) throw shortErr(i); for (let k = 1; k < its.length; k++) if (!(await its[k].next()).done) throw longErr(k); }
              return;
            }
            vals.push(r.value);
          }
          yield mkTuple(vals);
        }
      });
    },
    // lazy iterators, as in Python 3: the function runs per item as the result is consumed
    map: (fn, ...iterables) => {
      if (!iterables.length) throw new AdderError('TypeError', 'map() must have at least two arguments.');
      return _lazyIter('map', async function* () {
        const its = iterables.map((it) => { const e = _pyEach(it); return e[Symbol.asyncIterator] ? e[Symbol.asyncIterator]() : e[Symbol.iterator](); });
        for (;;) {
          const vals = [];
          for (const it of its) { const r = await it.next(); if (r.done) return; vals.push(r.value); }
          yield await fn(...vals);
        }
      });
    },
    filter: (fn, iterable) => _lazyIter('filter', async function* () {
      for await (const v of _pyEach(iterable)) if (fn ? pyBool(await fn(v)) : pyBool(v)) yield v;
    }),
    // lazy, as in CPython: they stop at the first deciding item (a generator is not drained)
    any: async (iterable) => { for await (const v of _pyEach(iterable)) if (pyBool(v)) return true; return false; },
    all: async (iterable) => { for await (const v of _pyEach(iterable)) if (!pyBool(v)) return false; return true; },
    isinstance: (obj, typeOrTuple) => _pyIsInstance(obj, typeOrTuple),
    type: (obj) => {
      if (obj !== null && obj !== undefined && obj.__adderType__) return obj.__adderType__;
      const name = pyTypeName(obj);
      if (!_typeObjects[name]) {
        const t = () => { throw new AdderError('TypeError', `cannot create '${name}' instances`); };
        t._pyName = name; t._pyClass = true; t.__name__ = name;
        _typeObjects[name] = t;
      }
      return _typeObjects[name];
    },
    hasattr: (obj, name) => { try { adderGetAttr(obj, name); return true; } catch { return false; } },
    getattr: (obj, name, def) => { try { return adderGetAttr(obj, name); } catch { if (def !== undefined) return def; throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${name}'`); } },
    setattr: (obj, name, value) => { guardSetAttr(obj, name); obj[name] = value; return null; },
    delattr: (obj, name) => { delete obj[name]; return null; },
    property: (fget) => {
      const prop = { __property__: true, fget, fset: null };
      prop.setter = (fset) => { prop.fset = fset; return prop; };
      return prop;
    },
    staticmethod: (fn) => ({ __staticmethod__: true, fn }),
    classmethod: (fn) => ({ __classmethod__: true, fn }),
    complex: (real, imag) => new Complex(real ?? 0, imag ?? 0),
    callable: (obj) => typeof obj === 'function',
    chr: (n) => String.fromCodePoint(n),
    ord: (c) => { if (typeof c !== 'string' || c.length !== 1) throw new AdderError('TypeError', 'ord() expected a character'); return c.codePointAt(0); },
    hex: (n) => { const v = Math.trunc(n); return v < 0 ? '-0x' + (-v).toString(16) : '0x' + v.toString(16); },
    oct: (n) => { const v = Math.trunc(n); return v < 0 ? '-0o' + (-v).toString(8) : '0o' + v.toString(8); },
    bin: (n) => { const v = Math.trunc(n); return v < 0 ? '-0b' + (-v).toString(2) : '0b' + v.toString(2); },
    repr: pyReprMaybe,
    Ellipsis, NotImplemented,
    format: (value, spec) => pyFormatValue(value, spec || ''),
    pow: (x, y, mod) => mod !== undefined ? _modPow(x, y, mod) : Math.pow(x, y),
    divmod: (a, b) => mkTuple([pyFloorDiv(a, b), pyMod(a, b)]),
    id: (obj) => { if (typeof obj === 'object' && obj !== null) { if (!obj.__id__) obj.__id__ = ++_idCounter; return obj.__id__; } return 0; },
    hash: (obj) => _pyHash(obj),
    iter: (obj) => pyIter(obj),
    next: (iter, def) => {
      const done = () => { if (def !== undefined) return def; throw new AdderError('StopIteration', '', undefined, []); };
      if (iter && typeof iter.__next__ === 'function') {
        if (def === undefined) return iter.__next__();
        try { const v = iter.__next__(); return v && typeof v.then === 'function' ? v.catch((e) => { if (e && e.pyType === 'StopIteration') return def; throw e; }) : v; }
        catch (e) { if (e && e.pyType === 'StopIteration') return def; throw e; }
      }
      if (!iter || typeof iter.next !== 'function') throw new AdderError('TypeError', `'${pyTypeName(iter)}' object is not an iterator`);
      const r = iter.next();
      if (r && typeof r.then === 'function') return r.then((x) => (x.done ? done() : x.value));
      return r.done ? done() : r.value;
    },
    input: () => { throw new AdderError('NotImplementedError', 'input() is not supported in the browser'); },
    issubclass: (c, t) => {
      if (Array.isArray(t)) return t.some((x) => builtins.issubclass(c, x));
      if (typeof c !== 'function') throw new AdderError('TypeError', 'issubclass() arg 1 must be a class');
      if (c === t || (t && t._pyName === 'object')) return true;
      if (c._pyMRO && c._pyMRO.includes(t)) return true;
      const cn = c._pyName, tn = t && t._pyName;
      if (cn === 'bool' && tn === 'int') return true;
      if (cn && tn && _EXC_NAMES.includes(cn)) return _excChain(cn).includes(tn);
      if (c._pyMRO && tn) for (const b of c._pyMRO) if (isBuiltinExcType(b) && _excChain(b._pyName).includes(tn)) return true;
      return false;
    },
    vars: (obj) => obj ? { ...obj } : {},
    dir: (obj) => obj ? Object.keys(obj).sort() : [],
    object: () => ({}),
    super: () => { throw new AdderError('RuntimeError', 'super() is handled by the evaluator'); },
    ValueError: (msg) => new AdderError('ValueError', msg),
    TypeError: (msg) => new AdderError('TypeError', msg),
    KeyError: (msg) => new AdderError('KeyError', msg),
    IndexError: (msg) => new AdderError('IndexError', msg),
    AttributeError: (msg) => new AdderError('AttributeError', msg),
    RuntimeError: (msg) => new AdderError('RuntimeError', msg),
    StopIteration: (msg) => new AdderError('StopIteration', msg || ''),
    ZeroDivisionError: (msg) => new AdderError('ZeroDivisionError', msg),
    NotImplementedError: (msg) => new AdderError('NotImplementedError', msg),
    AssertionError: (msg) => new AdderError('AssertionError', msg),
    Exception: (msg) => new AdderError('Exception', msg),
    FileNotFoundError: (msg) => new AdderError('FileNotFoundError', msg),
    FileExistsError: (msg) => new AdderError('FileExistsError', msg),
    IsADirectoryError: (msg) => new AdderError('IsADirectoryError', msg),
    NotADirectoryError: (msg) => new AdderError('NotADirectoryError', msg),
    PermissionError: (msg) => new AdderError('PermissionError', msg),
    OSError: (msg) => new AdderError('OSError', msg),
    IOError: (msg) => new AdderError('IOError', msg),
    // open(file, mode='r', buffering=-1, encoding=None, errors=None, newline=None, ...): the VFS
    // stores text as UTF-8, so encoding / newline / buffering are accepted and need no work here
    open: async (pathOrObj, ...rest) => {
      const kw = rest.length && rest[rest.length - 1] && rest[rest.length - 1]._kw ? rest.pop() : null;
      if (pathOrObj && pathOrObj._kw) { const k = pathOrObj; pathOrObj = k.file; if (k.mode !== undefined) rest[0] = k.mode; }
      let mode = rest[0] ?? (kw && kw.mode !== undefined ? kw.mode : 'r');
      if (typeof mode !== 'string') throw new AdderError('TypeError', `open() argument 'mode' must be str, not ${pyTypeName(mode)}`);
      if (mode.includes('x')) mode = mode.replace('x', 'w');
      if (!_adderVFS) throw new AdderError('RuntimeError', 'filesystem not available — call adder.setVFS(vfsInstance, pathUtils) first');
      const raw = pathOrObj?._path ? pathOrObj._path : String(pathOrObj);
      const p = _resolvePath(raw, _vfsPath);
      return _createAdderFile(_adderVFS, p, mode || 'r');
    },
    eval: _builtinEval,
    exec: _builtinExec,
    super: _builtinSuper,
  };
  // Mark conversion builtins as type objects for isinstance()/type()
  for (const name of ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'range', 'object', 'complex']) {
    if (builtins[name]) { builtins[name]._pyName = name; builtins[name]._pyClass = true; builtins[name].__name__ = name; _typeObjects[name] = builtins[name]; }
  }
  for (const name of _EXC_NAMES) {
    const ctor = (...a) => {
      if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
      return new AdderError(name, _argsStr(name, a), undefined, a);
    };
    ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name;
    builtins[name] = ctor;
    _typeObjects[name] = ctor;
  }
  return builtins;
}

// super(): the next class after `cls` in self's MRO, as a proxy whose attributes are bound to
// self. Both engines use it (the tree-walker finds cls and self in the method's scope; AIR
// passes them). A builtin exception base supplies __init__ (it keeps the args, as
// BaseException does) and __str__; `object` supplies a no-op __init__.
export function pySuper(cls, self) {
  const mro = (cls && cls._pyMRO) || [cls];
  const start = mro.indexOf(cls) + 1;
  return new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      for (let i = start; i < mro.length; i++) {
        const base = mro[i];
        if (isBuiltinExcType(base)) {
          if (name === '__init__') return (...a) => {
            if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
            self.args = mkTuple(a);
            return null;
          };
          if (name === '__str__') return () => _argsStr(base._pyName, self.args);
          continue;
        }
        if (!base || !base.prototype) continue;
        const desc = Object.getOwnPropertyDescriptor(base.prototype, name);
        if (desc) {
          if (desc.get) return desc.get.call(self);
          if (typeof desc.value === 'function') return (...a) => desc.value.call(self, ...a);
          return desc.value;
        }
      }
      if (name === '__init__') return () => null;   // object.__init__
      return undefined;
    },
    has(_, name) { return this.get(_, name) !== undefined; },
  });
}

// Sentinel functions for eval/exec/super — handled specially by the evaluator
export const _builtinEval = Object.assign(() => {}, { _pyName: 'eval', _sentinel: 'eval' });
export const _builtinExec = Object.assign(() => {}, { _pyName: 'exec', _sentinel: 'exec' });
export const _builtinSuper = Object.assign(() => {}, { _pyName: 'super', _sentinel: 'super' });

function _pyIsInstance(obj, typeOrTuple) {
  const types = Array.isArray(typeOrTuple) ? typeOrTuple : [typeOrTuple];
  const name = pyTypeName(obj);
  for (const t of types) {
    if (t instanceof UnionType) { if (_pyIsInstance(obj, [...t.__args__])) return true; continue; }
    // an abstract type that recognises its instances structurally (collections.abc.Mapping, ...)
    if (typeof t === 'function' && typeof t.__instancecheck__ === 'function' && t.__instancecheck__(obj)) return true;
    if (typeof t === 'string') {
      if (name === t) return true;
    } else if (typeof t === 'function') {
      if (t._pyClass && t._pyName) {
        // type object — match by name
        if (name === t._pyName) return true;
        if (t._pyName === 'object') return true;
        if (t._pyName === 'dict' && (obj instanceof Map || isPlainDict(obj))) return true;
        if (t._pyName === 'int' && typeof obj === 'boolean') return true;
        // walk MRO of the object's adder type
        const objType = obj?.__adderType__;
        if (objType?._pyMRO) {
          for (const mroClass of objType._pyMRO) {
            if (mroClass === t || mroClass._pyName === t._pyName) return true;
          }
        }
        // walk exception parent chain
        if (obj instanceof AdderError && _excChain(obj.pyType).includes(t._pyName)) return true;
      } else {
        try { if (obj instanceof t) return true; } catch { /* arrow fn without prototype */ }
      }
    } else if (t === null) {
      if (obj === null) return true;
    }
  }
  return false;
}

function _modPow(base, exp, mod) {
  let b = BigInt(_asInt(base)), e = BigInt(_asInt(exp)), m = BigInt(_asInt(mod));
  if (m === 0n) throw new AdderError('ValueError', 'pow() 3rd argument cannot be 0');
  const norm = (x) => ((x % m) + m) % m;
  b = norm(b);
  if (e < 0n) {
    // modular inverse by the extended Euclid algorithm
    let [r0, r1, s0, s1] = [b, m < 0n ? -m : m, 1n, 0n];
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    if (r0 !== 1n) throw new AdderError('ValueError', 'base is not invertible for the given modulus');
    b = norm(s0);
    e = -e;
  }
  let result = 1n;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    e >>= 1n;
    b = (b * b) % m;
  }
  return Number(norm(result));
}

let _idCounter = 0;
