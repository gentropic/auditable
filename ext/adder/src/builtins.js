// adder v2 — builtins, modules, format specs
// Python built-in functions, method dispatch, and standard modules.
// All functions are sync unless they need to call user-provided callables
// (which are async since the evaluator is async).

// ── PyRange — lazy range ──

export class AdderRange {
  // range(stop) / range(start, stop[, step]): integers (bool and __index__ objects count), as
  // CPython checks them; a zero step is a ValueError
  constructor(...args) {
    if (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' && args[args.length - 1]._kw) {
      throw new AdderError('TypeError', 'range() takes no keyword arguments');
    }
    while (args.length && args[args.length - 1] === undefined) args.pop();
    if (!args.length) throw new AdderError('TypeError', 'range expected at least 1 argument, got 0');
    if (args.length > 3) throw new AdderError('TypeError', `range expected at most 3 arguments, got ${args.length}`);
    const ints = args.map((v) => {
      if (typeof v === 'boolean') return +v;
      if (typeof v === 'number' && Number.isInteger(v)) return v;
      if (typeof v === 'bigint') return Number(v);
      if (v !== null && typeof v === 'object' && typeof v.__index__ === 'function') return v.__index__();
      throw new AdderError('TypeError', `'${pyTypeName(v)}' object cannot be interpreted as an integer`);
    });
    [this.start, this.stop, this.step] = ints.length === 1 ? [0, ints[0], 1] : ints.length === 2 ? [ints[0], ints[1], 1] : ints;
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
// bytearray: a mutable sequence of byte values — an Array of ints 0..255 (append, extend, item and
// slice assignment are the list's), with bytes' methods, repr and equality
export class PyByteArray extends Array {
  static get [Symbol.species]() { return Array; }
}
const _toBA = (items) => { const b = new PyByteArray(); for (const x of items) b.push(x); return b; };
const _byteCheck = (v) => { if (!Number.isInteger(v) || v < 0 || v > 255) throw new AdderError('ValueError', 'byte must be in range(0, 256)'); return v; };
const _isBytesLike = (v) => v instanceof Uint8Array || v instanceof PyByteArray;
const _asU8 = (v) => (v instanceof Uint8Array ? v : Uint8Array.from(v));
// ── subclasses of str: boxed strings ──
// adder's strings are JS primitives, which can't carry a class — so an instance of a str
// SUBCLASS (markupsafe's Markup, `class Color(str, Enum)`) is a box: an object with the
// subclass's prototype and the string in `_pyStrValue`. Plain strings are untouched. str's
// dunders live on _StrBoxProto (the `str` type's prototype), so every generic path that
// dispatches on __eq__ / __hash__ / __len__ / __getitem__ / __add__ … handles a box, a
// subclass's own methods shadow them, and super() reaches them; str's other methods (upper,
// replace …) come from the value and return plain str, as CPython's do. To JS the box is its
// string (toString / valueOf / Symbol.toPrimitive).
export const strValue = (x) => (typeof x === 'string' ? x : x !== null && typeof x === 'object' && typeof x._pyStrValue === 'string' ? x._pyStrValue : null);
const _strCmp = (op) => function (o) { const v = strValue(o); return v === null ? NotImplemented : op(this._pyStrValue, v); };
export const _StrBoxProto = {
  __str__() { return this._pyStrValue; },
  __repr__() { return pyRepr(this._pyStrValue); },
  __format__(spec) { return pyFormatValue(this._pyStrValue, spec || ''); },
  __len__() { return [...this._pyStrValue].length; },
  __hash__() { return _pyHash(this._pyStrValue); },
  __bool__() { return this._pyStrValue.length > 0; },
  __eq__: _strCmp((a, b) => a === b), __ne__: _strCmp((a, b) => a !== b),
  __lt__: _strCmp((a, b) => a < b), __le__: _strCmp((a, b) => a <= b),
  __gt__: _strCmp((a, b) => a > b), __ge__: _strCmp((a, b) => a >= b),
  __add__(o) { const v = strValue(o); return v === null ? NotImplemented : this._pyStrValue + v; },
  __radd__(o) { const v = strValue(o); return v === null ? NotImplemented : v + this._pyStrValue; },
  __mul__(n) { return pyMul(this._pyStrValue, n); },
  __rmul__(n) { return pyMul(this._pyStrValue, n); },
  __mod__(a) { return pyMod(this._pyStrValue, a); },
  __getitem__(k) { return k !== null && typeof k === 'object' && k._slice ? _strSlice(this._pyStrValue, k.lower, k.upper, k.step) : pyGetItem(this._pyStrValue, k); },
  __contains__(x) {
    const v = strValue(x);
    if (v === null) throw new AdderError('TypeError', `'in <string>' requires string as left operand, not ${pyTypeName(x)}`);
    return this._pyStrValue.includes(v);
  },
  __iter__() { return this._pyStrValue[Symbol.iterator](); },
  __getnewargs__() { return mkTuple([this._pyStrValue]); },
};
const _StrBoxRoot = Object.create(Object.prototype, {
  toString: { value() { return this._pyStrValue; } },
  valueOf: { value() { return this._pyStrValue; } },
  [Symbol.toPrimitive]: { value() { return this._pyStrValue; } },
});
// s[lower:upper:step] (a slice object, as __getitem__ receives one), Python's index rules
function _strSlice(s, lower, upper, step) {
  step = step ?? 1;
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  const n = s.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let a, b;
  if (step > 0) {
    a = lower == null ? 0 : lower < 0 ? clamp(n + lower, 0, n) : clamp(lower, 0, n);
    b = upper == null ? n : upper < 0 ? clamp(n + upper, 0, n) : clamp(upper, 0, n);
    if (step === 1) return a < b ? s.slice(a, b) : '';
  } else {
    a = lower == null ? n - 1 : lower < 0 ? clamp(n + lower, -1, n - 1) : clamp(lower, -1, n - 1);
    b = upper == null ? -1 : upper < 0 ? clamp(n + upper, -1, n - 1) : clamp(upper, -1, n - 1);
  }
  let out = '';
  for (let i = a; step > 0 ? i < b : i > b; i += step) out += s[i];
  return out;
}
// str's other methods on a box: the value's, with boxed arguments read as their strings
function _boxStrMethod(box, attr) {
  const m = _strMethod(box._pyStrValue, attr);
  const f = (...a) => m(...a.map((x) => (x !== null && typeof x === 'object' && typeof x._pyStrValue === 'string' ? x._pyStrValue : x)));
  f._pyName = m._pyName;
  return f;
}

// memoryview: a view of a bytes / bytearray object's bytes (format 'B', one dimension) —
// len, indexing, slicing (another view), tobytes / tolist / hex, iteration, equality
export class PyMemoryView {
  constructor(obj, start = 0, end = null) {
    if (!(obj instanceof Uint8Array || obj instanceof PyByteArray || obj instanceof PyMemoryView)) throw new AdderError('TypeError', `memoryview: a bytes-like object is required, not '${pyTypeName(obj)}'`);
    this.obj = obj instanceof PyMemoryView ? obj.obj : obj;
    const base = obj instanceof PyMemoryView ? obj._start : 0;
    this._start = base + start;
    this._end = end === null ? (obj instanceof PyMemoryView ? obj._end : obj.length) : base + end;
    this.readonly = this.obj instanceof Uint8Array;
    this.format = 'B'; this.itemsize = 1; this.ndim = 1; this.released = false;
  }
  get nbytes() { return this._end - this._start; }
  get shape() { return mkTuple([this.nbytes]); }
  get strides() { return mkTuple([1]); }
  _bytes() { return Uint8Array.from(Array.prototype.slice.call(this.obj, this._start, this._end)); }
  __len__() { return this.nbytes; }
  __getitem__(i) {
    if (i && i._slice) {
      const n = this.nbytes;
      const st = i.step ?? 1;
      if (st !== 1) { const all = [...this._bytes()], out = []; const s0 = i.lower ?? (st > 0 ? 0 : n - 1), s1 = i.upper ?? (st > 0 ? n : -n - 1); for (let k = s0 < 0 ? n + s0 : s0; st > 0 ? k < (s1 < 0 ? n + s1 : Math.min(s1, n)) : k > (s1 < 0 ? n + s1 : s1); k += st) if (k >= 0 && k < n) out.push(all[k]); return new PyMemoryView(Uint8Array.from(out)); }
      let a = i.lower ?? 0, b = i.upper ?? n;
      if (a < 0) a = Math.max(0, n + a); if (b < 0) b = Math.max(0, n + b);
      a = Math.min(a, n); b = Math.min(Math.max(b, a), n);
      return new PyMemoryView(this, a, b);
    }
    const k = i < 0 ? this.nbytes + i : i;
    if (k < 0 || k >= this.nbytes) throw new AdderError('IndexError', 'index out of bounds on dimension 1');
    return this.obj[this._start + k];
  }
  __setitem__(i, v) {
    if (this.readonly) throw new AdderError('TypeError', 'cannot modify read-only memory');
    const k = i < 0 ? this.nbytes + i : i;
    this.obj[this._start + k] = v;
    return null;
  }
  __iter__() { return [...this._bytes()][Symbol.iterator](); }
  __eq__(o) { const a = this._bytes(), b = o instanceof PyMemoryView ? o._bytes() : o instanceof Uint8Array || o instanceof PyByteArray ? o : null; if (!b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  __bytes__() { return this._bytes(); }
  tobytes() { return this._bytes(); }
  tolist() { return [...this._bytes()]; }
  hex(sep) { return [...this._bytes()].map((x) => x.toString(16).padStart(2, '0')).join(typeof sep === 'string' ? sep : ''); }
  toreadonly() { const m = new PyMemoryView(this); m.readonly = true; return m; }
  cast(fmt) { if (fmt !== 'B' && fmt !== 'b' && fmt !== 'c') throw new AdderError('NotImplementedError', `memoryview.cast('${fmt}') is not supported here`); return new PyMemoryView(this); }
  release() { this.released = true; return null; }
  __enter__() { return this; }
  __exit__() { this.released = true; return false; }
  __repr__() { return `<memory at 0x${(0x7f0000000000 + (this._start | 0)).toString(16)}>`; }
}
PyMemoryView.prototype.__adderClass__ = 'memoryview';
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
  if (k !== null && typeof k === 'object' && typeof k._pyStrValue === 'string' && k.__hash__ === _StrBoxProto.__hash__) return k._pyStrValue;
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
  if (k !== null && typeof k === 'object' && typeof k._pyStrValue === 'string' && k.__hash__ === _StrBoxProto.__hash__) return k._pyStrValue;
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
// obj.__dict__ / vars(obj): a LIVE dict over an object's attributes — reads and writes go to the
// object (self.__dict__.update(kw), self.__dict__[k] = v), as CPython's instance dict does. The
// engines' own markers on the object are not attributes.
const _ENGINE_KEYS = new Set(['__adderClass__', '__adderType__', '__adderModule__', '__adderMeta__', '_isExcClass', '_jsClass', '_genName', '_frozen', '_isGenerator', '_sentinel']);
const _attrHidden = (k) => _ENGINE_KEYS.has(k) || k.startsWith('_py');
export class AttrDict extends PyDict {
  constructor(target) { super(); Object.defineProperty(this, '_t', { value: target }); }
  _keys() { return Object.keys(this._t).filter((k) => !_attrHidden(k)); }
  get size() { return this._keys().length; }
  get(k) { return typeof k === 'string' && !_attrHidden(k) && Object.hasOwn(this._t, k) ? this._t[k] : undefined; }
  has(k) { return typeof k === 'string' && !_attrHidden(k) && Object.hasOwn(this._t, k); }
  set(k, v) { this._t[k] = v; return this; }
  delete(k) { if (!this.has(k)) return false; delete this._t[k]; return true; }
  clear() { for (const k of this._keys()) delete this._t[k]; }
  keys() { return this._keys()[Symbol.iterator](); }
  values() { return this._keys().map((k) => this._t[k])[Symbol.iterator](); }
  entries() { return this._keys().map((k) => [k, this._t[k]])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  forEach(fn) { for (const [k, v] of this.entries()) fn(v, k, this); }
}
// Cls.__dict__: the class's own namespace (a read-only snapshot, as CPython's mappingproxy is
// read-only): its methods (the defs), class variables, and its own __module__ / __doc__
function _classDict(cls) {
  const d = new PyDict();
  if (cls.__module__ !== undefined) d.set('__module__', cls.__module__);
  for (const k of Object.getOwnPropertyNames(cls.prototype || {})) {
    if (_attrHidden(k) || k === 'constructor' || !(cls._pyOwnMembers && cls._pyOwnMembers.has(k))) continue;
    const desc = Object.getOwnPropertyDescriptor(cls.prototype, k);
    d.set(k, desc.value && desc.value.__func__ ? desc.value.__func__ : desc.value !== undefined ? desc.value : desc.get);
  }
  for (const k of Object.keys(cls)) {
    if (_attrHidden(k) || k === 'prototype' || d.has(k)) continue;
    if (typeof cls[k] === 'function' && !(cls._pyOwnMembers && cls._pyOwnMembers.has(k)) && !cls[k]._pyClass) continue;   // inherited copies
    d.set(k, cls[k]);
  }
  d.set('__doc__', cls.__doc__ ?? null);
  const ro = () => { throw new AdderError('TypeError', "'mappingproxy' object does not support item assignment"); };
  d.set = ro; d.delete = ro; d.clear = ro;
  d.__adderClass__ = 'mappingproxy';
  return d;
}

// dir(x) as CPython lists it: the object's attributes, its class's and every base's (members and
// class variables), and object's dunders; a user __dir__ decides for itself
const _OBJECT_DUNDERS = ['__class__', '__delattr__', '__dir__', '__doc__', '__eq__', '__format__', '__ge__',
  '__getattribute__', '__getstate__', '__gt__', '__hash__', '__init__', '__init_subclass__', '__le__', '__lt__',
  '__ne__', '__new__', '__reduce__', '__reduce_ex__', '__repr__', '__setattr__', '__sizeof__', '__str__', '__subclasshook__'];
function _pyDir(obj) {
  if (obj === undefined || obj === null) return [];
  if (typeof obj === 'object' && typeof obj.__dir__ === 'function' && !obj.__adderModule__) {
    const r = obj.__dir__();
    return r && typeof r.then === 'function' ? r.then((v) => [...pyIter(v)].sort()) : [...pyIter(r)].sort();
  }
  const names = new Set();
  const addOwn = (o) => { for (const k of Object.keys(o)) if (!_attrHidden(k) && k !== 'prototype') names.add(k); };
  const addClass = (c) => {
    addOwn(c);
    if (c._pyOwnMembers) for (const k of c._pyOwnMembers) names.add(k);
  };
  if (obj.__adderModule__ || (typeof obj === 'object' && !obj.__adderType__)) { addOwn(obj); return [...names].sort(); }
  const cls = typeof obj === 'function' && obj._pyClass ? obj : obj.__adderType__;
  if (typeof obj === 'object') { addOwn(obj); names.add('__dict__'); }
  if (cls && cls._pyMRO) for (const c of cls._pyMRO) addClass(c);
  else if (typeof obj === 'function') addOwn(obj);
  if (cls) { names.add('__module__'); names.add('__dict__'); names.add('__weakref__'); for (const d of _OBJECT_DUNDERS) names.add(d); }
  return [...names].sort();
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
// the builtin type objects adderBuiltins made first: every later table reuses them
const _stableTypes = {};

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
  if (v instanceof PyByteArray) return 'bytearray';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Map) return v.__adderClass__ || 'dict';
  if (v instanceof Set) return v._frozen ? 'frozenset' : 'set';
  if (v instanceof AdderRange) return 'range';
  if (v instanceof Complex) return 'complex';
  if (v instanceof Uint8Array) return 'bytes';
  if (typeof v === 'function') return v._pyClass ? (v.__adderMeta__ ? v.__adderMeta__._pyName : 'type') : v._pyFunc || v._pyDef ? 'function' : 'builtin_function_or_method';
  if (v?.__adderClass__) return v.__adderClass__;
  if (v instanceof AdderError) return v.pyType;
  if (v.__adderModule__) return 'module';
  if (isPlainDict(v)) return 'dict';
  return 'object';
}

// truth, when __bool__ / __len__ may be tree-walked (async): a bool, or a Promise of one
export function pyBoolMaybe(v) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set)) {
    if (typeof v.__bool__ === 'function') { const r = v.__bool__(); return r && typeof r.then === 'function' ? r.then((x) => !!x) : !!r; }
    if (typeof v.__len__ === 'function') { const r = v.__len__(); return r && typeof r.then === 'function' ? r.then((x) => x !== 0) : r !== 0; }
  }
  return pyBool(v);
}
export function pyBool(v) {
  if (v === false || v === null || v === undefined || v === 0 || v === '' || v !== v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (v instanceof AdderRange) return v.length > 0;
  // a plain-object dict (string keys, **kwargs): empty is false
  if (typeof v === 'object' && isPlainDict(v)) return Object.keys(v).length > 0;
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
  if (v instanceof PyByteArray) return `bytearray(${_bytesRepr(Uint8Array.from(v))})`;
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
  if (v instanceof PyByteArray) return pyRepr(v);
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
    else if (_unprintable(ch)) out += _escapeCodePoint(c);
    else out += ch;
  }
  return out + q;
}
// Python's str.isprintable() is false for these: control, format, surrogate, private-use,
// unassigned, and separators other than the space — repr() escapes them
const _UNPRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;
const _unprintable = (ch) => ch !== ' ' && _UNPRINTABLE.test(ch);
const _escapeCodePoint = (c) => (c < 0x100 ? '\\x' + c.toString(16).padStart(2, '0') : c < 0x10000 ? '\\u' + c.toString(16).padStart(4, '0') : '\\U' + c.toString(16).padStart(8, '0'));

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
export function _lazyIter(name, genFn) {
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
const _isAsyncOnly = (v) => v !== null && typeof v === 'object' && typeof v[Symbol.asyncIterator] === 'function' && (typeof v[Symbol.iterator] !== 'function' || v._asyncGen === true);   // (a tree-walked generator's Symbol.iterator only refuses)
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

// ── sync unless something actually is async ──
// A builtin that MIGHT meet an async value (a tree-walked __iter__, an async iterable, an async
// key function) was an `async` function, so it always returned a Promise — and AIR code that
// can't await (a property getter) couldn't call it. maybeSync(genFn) runs a generator whose
// `yield`s mark the possible await points: synchronously while every yielded value is plain,
// switching to a Promise only at the first yielded Promise (and resuming the same generator).
export function maybeSync(genFn) {
  return function (...a) { return _drive(genFn.apply(this, a), undefined, false); };
}
function _drive(g, val, isErr) {
  for (;;) {
    const r = isErr ? g.throw(val) : g.next(val);
    if (r.done) return r.value;
    if (_isThenable(r.value)) return r.value.then((x) => _drive(g, x, false), (e) => _drive(g, e, true));
    val = r.value; isErr = false;
  }
}
// visit each item of anything adder iterates (fn returns true to stop early), one step at a
// time: a user __iter__ / __next__ or __getitem__, an async iterator, or a plain JS iterable
function* _gForEach(obj, fn) {
  const viaAsync = function* (ai) { for (;;) { const r = yield ai.next(); if (r.done || fn(r.value)) return; } };
  if (isUserIterable(obj)) {
    if (typeof obj.__iter__ === 'function' || typeof obj.__next__ === 'function') {
      const it = typeof obj.__iter__ === 'function' ? yield obj.__iter__() : obj;
      if (it !== obj && it && typeof it[Symbol.asyncIterator] === 'function') { yield* viaAsync(it[Symbol.asyncIterator]()); return; }
      if (it !== obj && it && typeof it[Symbol.iterator] === 'function' && typeof it.__next__ !== 'function') { for (const v of pyIter(it)) if (fn(v)) return; return; }
      if (!it || typeof it.__next__ !== 'function') throw new AdderError('TypeError', `iter() returned non-iterator of type '${pyTypeName(it)}'`);
      for (;;) {
        let v;
        try { v = yield it.__next__(); } catch (e) { if (e && e.pyType === 'StopIteration') return; throw e; }
        if (fn(v)) return;
      }
    }
    for (let i = 0; ; i++) {
      let v;
      try { v = yield obj.__getitem__(i); } catch (e) { if (e && (e.pyType === 'IndexError' || e.pyType === 'StopIteration')) return; throw e; }
      if (fn(v)) return;
    }
  }
  if (obj && typeof obj[Symbol.asyncIterator] === 'function') { yield* viaAsync(obj[Symbol.asyncIterator]()); return; }
  for (const v of pyIter(obj)) if (fn(v)) return;
}
function* _gCollect(obj) {
  if (Array.isArray(obj)) return obj.slice();
  if (obj instanceof AdderRange) {
    const out = new Array(obj.length);
    for (let i = 0, v = obj.start; i < out.length; i++, v += obj.step) out[i] = v;
    return out;
  }
  const arr = [];
  yield* _gForEach(obj, (v) => { arr.push(v); });
  return arr;
}
// pyCollect, sync when the source is
export const pyCollectMaybe = maybeSync(_gCollect);
// f(v), now or when v resolves
const _thenMaybe = (v, f) => (_isThenable(v) ? v.then(f) : f(v));
// fn(item) for each item of anything iterable — synchronously unless the source is async (a
// tree-walked generator or __iter__): then a Promise. → None (or a Promise of it)
const _eachMaybe = maybeSync(function* (obj, fn) { yield* _gForEach(obj, (v) => { fn(v); }); return null; });

export async function pyCollect(obj) {
  // the common sources, without a generator step per item: a list or tuple copies (a fresh
  // plain list — PyTuple's species is Array), a range fills by counting
  if (Array.isArray(obj)) return obj.slice();
  if (obj instanceof AdderRange) {
    const out = new Array(obj.length);
    for (let i = 0, v = obj.start; i < out.length; i++, v += obj.step) out[i] = v;
    return out;
  }
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

const _moduleBound = new WeakMap();   // module object → attr → [function, its bound copy]
// list[a:b:c] from a slice object (super().__getitem__(slice) in a list subclass)
function _applySliceRaw(o, k) {
  const n = o.length, step = k.step ?? 1;
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const out = [];
  if (step > 0) {
    const a = k.lower == null ? 0 : k.lower < 0 ? clamp(n + k.lower, 0, n) : clamp(k.lower, 0, n);
    const b = k.upper == null ? n : k.upper < 0 ? clamp(n + k.upper, 0, n) : clamp(k.upper, 0, n);
    for (let i = a; i < b; i += step) out.push(o[i]);
  } else {
    const a = k.lower == null ? n - 1 : k.lower < 0 ? clamp(n + k.lower, -1, n - 1) : clamp(k.lower, -1, n - 1);
    const b = k.upper == null ? -1 : k.upper < 0 ? clamp(n + k.upper, -1, n - 1) : clamp(k.upper, -1, n - 1);
    for (let i = a; i > b; i += step) out.push(o[i]);
  }
  return o instanceof PyTuple ? mkTuple(out) : out;
}
// a builtin value's dunders as attributes ('abc'.__len__(), [].__getitem__, hasattr(x, '__len__')
// — duck typing reads them): the operation itself, bound to the value
const _VALUE_DUNDERS = new Set(['__len__', '__iter__', '__contains__', '__getitem__', '__setitem__', '__delitem__',
  '__eq__', '__ne__', '__lt__', '__le__', '__gt__', '__ge__', '__hash__', '__str__', '__repr__', '__format__',
  '__add__', '__mul__', '__rmul__', '__mod__', '__iadd__', '__reversed__', '__sizeof__']);
function _valueDunder(o, attr) {
  const isStr = typeof o === 'string', isSeq = isStr || Array.isArray(o) || o instanceof Uint8Array;
  const isPlain = !isSeq && isPlainDict(o);
  const isMap = o instanceof Map || isPlain, isSet = o instanceof Set;
  const mutable = (Array.isArray(o) && !(o instanceof PyTuple)) || isMap;
  const has = (k) => (isPlain ? typeof k === 'string' && Object.hasOwn(o, k) : o.has(k));
  const f = (() => {
    switch (attr) {
      case '__len__': return () => (isStr ? [...o].length : isPlain ? Object.keys(o).length : isMap || isSet ? o.size : o.length);
      case '__iter__': return () => pyIter(o);
      case '__contains__': return (x) => (isStr ? o.includes(strValue(x) ?? String(x)) : isMap || isSet ? has(x) : [...o].some((v) => pyEq(v, x) === true));
      case '__getitem__': return isSet ? null : (k) => (k !== null && typeof k === 'object' && k._slice && Array.isArray(o) ? _applySliceRaw(o, k) : pyGetItem(o, k, true));
      case '__setitem__': return mutable ? (k, v) => { if (isPlain) o[k] = v; else if (isMap) o.set(k, v); else o[k < 0 ? o.length + k : k] = v; return null; } : null;
      case '__delitem__': return mutable ? (k) => { if (isMap) { if (!has(k)) throw new AdderError('KeyError', pyRepr(k)); if (isPlain) delete o[k]; else o.delete(k); } else o.splice(k < 0 ? o.length + k : k, 1); return null; } : null;
      case '__eq__': return (x) => pyEq(o, x);
      case '__ne__': return (x) => !pyEq(o, x);
      case '__lt__': return (x) => pyLt(o, x);
      case '__gt__': return (x) => pyLt(x, o);
      case '__le__': return (x) => pyEq(o, x) === true || pyLt(o, x);
      case '__ge__': return (x) => pyEq(o, x) === true || pyLt(x, o);
      case '__hash__': return mutable || isSet && !o._frozen ? null : () => _pyHash(o);
      case '__str__': return () => pyStr(o);
      case '__repr__': return () => pyRepr(o);
      case '__format__': return (spec) => pyFormatValue(o, spec || '');
      case '__add__': return isSeq ? (x) => pyAdd(o, x) : null;
      case '__mul__': case '__rmul__': return isSeq ? (n) => pyMul(o, n) : null;
      case '__mod__': return isStr ? (a) => pyMod(o, a) : null;
      case '__reversed__': return isSeq || isMap ? () => [...pyIter(o)].reverse()[Symbol.iterator]() : null;
      case '__sizeof__': return () => 64;
      default: return null;
    }
  })();
  if (f) f._pyName = attr;
  return f;
}
let _gaBypass = null;                 // the instance object.__getattribute__ is reading plainly
function _plainGetAttr(o, k) { _gaBypass = o; try { return adderGetAttr(o, k); } finally { if (_gaBypass === o) _gaBypass = null; } }
export function adderGetAttr(obj, attr) {
  if (_VALUE_DUNDERS.has(attr) && obj !== null && obj !== undefined && !obj.__adderType__ &&
      (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Map || obj instanceof Set || obj instanceof Uint8Array || isPlainDict(obj))) {
    const d = _valueDunder(obj, attr);
    if (d) return d;
    // an unhashable container's __hash__ is None
    if (attr === '__hash__' && (Array.isArray(obj) && !(obj instanceof PyTuple) || obj instanceof Map || isPlainDict(obj) || (obj instanceof Set && !obj._frozen))) return null;
  }
  if (obj instanceof AdderError) {
    if (attr === 'args') return obj.args || mkTuple(obj.pyMessage === '' || obj.pyMessage == null ? [] : [obj.pyMessage]);
    if (attr === '__cause__' || attr === '__context__') return obj[attr] ?? null;
    if (attr === '__traceback__') return _tracebackOf(obj);
    if (attr === 'with_traceback') return (tb) => { obj._pyTb = tb; return obj; };
    if (attr === '__class__') return excTypeOf(obj);
  }
  // every value has a __class__ (its type) — unless it defines the attribute itself
  if (attr === '__class__' && obj !== null && obj !== undefined && !(typeof obj === 'object' && Object.hasOwn(obj, '__class__'))) return typeOf(obj);
  // an instance's (or module's) attribute dict, live
  if (attr === '__dict__' && obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Map) && !(obj instanceof Set) && !(obj instanceof Uint8Array)) {
    return Object.hasOwn(obj, '__dict__') ? obj.__dict__ : new AttrDict(obj);
  }
  // functions, classes and builtin type objects (all JS functions here)
  if (typeof obj === 'function') {
    if (attr === '__dict__') return obj._pyClass ? _classDict(obj) : new AttrDict(obj);
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
    if (attr === '__code__' && obj._pySig && !obj._pyClass) return _codeObject(obj);
    if (attr === '__module__') return obj.__module__ ?? (obj._pyClass || obj._pyFunc ? '__main__' : 'builtins');
    // a class variable a base defines (Sub.registry where Base has it): along the MRO, as Python
    // looks class attributes up. A function's JS properties (name, length) don't count as the
    // class's own unless the class body set them.
    if (obj._pyClass && obj._pyMRO && obj._pyMRO.length > 1 && !_ownPyClassAttr(obj, attr)) {
      for (let i = 1; i < obj._pyMRO.length; i++) { const c = obj._pyMRO[i]; if (_ownPyClassAttr(c, attr)) return c[attr]; }
    }
    // a member of the class's metaclass (Meta.describe, a property on Meta) — the class's own first
    if (obj._pyClass && obj.__adderMeta__ && !(attr in obj)) { const v = metaAttr(obj, attr); if (v !== undefined) return v; }
    if (attr === '__class__' && obj._pyClass) return obj.__adderMeta__ || pyTypeObj;
    if (attr === '__mro__' && obj._pyClass && obj._pyMRO) return mkTuple(obj === pyObjectObj ? [pyObjectObj] : [...obj._pyMRO, pyObjectObj]);
    if (attr === '__bases__' && obj._pyClass) return mkTuple(obj === pyObjectObj ? [] : obj._pyBases && obj._pyBases.length ? obj._pyBases : [pyObjectObj]);
    // a builtin type's (int, str, dict …): itself and object (bool is an int)
    if (attr === '__mro__' && obj._pyClass) {
      if (obj._jsClass) {   // a JS-backed type: its JS class chain, each link's type
        const chain = [obj];
        for (let p = Object.getPrototypeOf(obj._jsClass.prototype); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, '__adderType__') && !chain.includes(p.__adderType__)) chain.push(p.__adderType__);
        return mkTuple([...chain, pyObjectObj]);
      }
      return mkTuple(obj === pyObjectObj ? [pyObjectObj] : tn === 'bool' ? [obj, _typeObjects.int, pyObjectObj] : [obj, pyObjectObj]);
    }
    // Cls.__new__ where nothing in the class defines one: object's, or the builtin type's
    if (attr === '__new__' && obj._pyClass && !(attr in obj)) return _inheritedNew(obj);
  }
  // string methods
  if (typeof obj === 'string') return _strMethod(obj, attr);
  if (obj instanceof Uint8Array) return _bytesMethod(obj, attr);
  // tuple methods (count, index) — a tuple has none of list's mutators
  // (a namedtuple class adds its fields and _asdict / _replace / _fields on its own prototype)
  if (obj instanceof PyTuple) {
    // a tuple subclass's own members (made by tuple.__new__(cls, …)): its class's, bound
    const tt = obj.__adderType__;
    if (tt && tt.prototype && !(attr in obj) && attr in tt.prototype) {
      const v = Reflect.get(tt.prototype, attr, obj);
      return typeof v === 'function' && !v._pyClass ? v.bind(obj) : v;
    }
    if (attr === 'count' || attr === 'index') return _listMethod(obj, attr);
    if (attr in obj && !(attr in Array.prototype)) {
      const v = obj[attr];
      return typeof v === 'function' && !v._pyClass ? v.bind(obj) : v;
    }
    throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${attr}'`);
  }
  // bytearray: bytes' methods (results as bytearray), and the list's mutators with byte checks
  if (obj instanceof PyByteArray) {
    if (attr === 'append') return (x) => { obj.push(_byteCheck(x)); return null; };
    if (attr === 'extend') return (it) => (it instanceof Uint8Array ? (it.forEach((x) => obj.push(x)), null) : _eachMaybe(it, (x) => obj.push(_byteCheck(x))));
    if (attr === 'insert') return (i, x) => { _byteCheck(x); return _listMethod(obj, 'insert')(i, x); };
    if (attr === 'copy') return () => _toBA(obj);
    if (attr === 'decode' || attr === 'hex') return _bytesMethod(Uint8Array.from(obj), attr);
    if (['pop', 'remove', 'clear', 'reverse', 'count', 'index'].includes(attr)) return _listMethod(obj, attr);
    const m = _bytesMethod(Uint8Array.from(obj), attr);
    if (typeof m !== 'function') return m;
    return (...a) => { const r = m(...a.map((x) => (x instanceof PyByteArray ? Uint8Array.from(x) : x))); return r instanceof Uint8Array ? _toBA(r) : r; };
  }
  // list methods — after a list subclass's own: its instance attributes, its methods and
  // properties, its class variables
  if (Array.isArray(obj)) {
    const lt = obj.__adderType__;
    if (lt && lt._pyMRO) {
      if (Object.hasOwn(obj, attr) && attr !== 'length' && !/^\d+$/.test(attr)) return obj[attr];
      if (lt.prototype && Object.hasOwn(lt.prototype, attr)) {
        const v = Reflect.get(lt.prototype, attr, obj);
        return typeof v === 'function' && !v._pyClass ? v.bind(obj) : v;
      }
      for (const c of lt._pyMRO) if (_ownPyClassAttr(c, attr)) { const cv = c[attr]; return _isDescriptor(cv) ? cv.__get__(obj, lt) : cv; }
    }
    return _listMethod(obj, attr);
  }
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
    // a class's own __getattribute__ sees every attribute read (object.__getattribute__ inside
    // it reads plainly: _gaBypass); its AttributeError falls to __getattr__, as in Python
    if (_gaBypass === obj) _gaBypass = null;
    else if (obj.__adderType__ && attr !== '__getattribute__' && typeof obj.__getattribute__ === 'function' && !Object.hasOwn(obj, '__getattribute__')) {
      const fallback = (e) => { if (e && e.pyType === 'AttributeError' && typeof obj.__getattr__ === 'function') return obj.__getattr__(attr); throw e; };
      let r;
      try { r = obj.__getattribute__(attr); } catch (e) { return fallback(e); }
      return r && typeof r.then === 'function' ? r.then(null, fallback) : r;   // (a tree-walked one is async)
    }
    // read the attribute ONCE: a getter (a @property, a descriptor) runs its body on every read
    const has = attr in obj;
    const v = has ? obj[attr] : undefined;
    if (typeof v === 'function') {
      if (_isNativeClass(v) || v._pyClass) return v;   // a class (binascii.Error, enum.Enum): never bound
      // a module's functions are its attributes as they are: `mod.f is mod.f`, and `from mod
      // import f` is the same object (binding made a fresh copy per access)
      if (obj.__adderModule__ && (v._pyFunc || v._pyDef)) return v;
      // a function stored ON a Python instance is an attribute, not a method: as it is
      if (obj.__adderType__ && Object.hasOwn(obj, attr)) return v;
      // adder functions expect self as first arg — inject it (plain JS objects used as namespaces)
      if (v._pyFunc && !obj.__adderModule__ && !obj.__adderType__) {
        const fn = (...args) => v(obj, ...args);
        fn._pyFunc = true;
        fn._pyName = `${attr}`;
        return fn;
      }
      // a module's function is one object (`os.path.join is os.path.join`, a pickle naming
      // builtins.len): its bound copy is kept, made again only if the attribute changes
      if (obj._pyRawFns) return v;   // a module whose functions don't use `this` (builtins): as they are
      if (obj.__adderModule__) {
        let m = _moduleBound.get(obj);
        if (!m) { m = new Map(); _moduleBound.set(obj, m); }
        const c = m.get(attr);
        if (c && c[0] === v) return c[1];
      }
      const fn = v.bind(obj);
      // Function.prototype.bind drops custom properties off the original
      // (`t.cdf`, `t.pdf` etc. — scipy-style "callable namespace" pattern).
      // Copy them over so dotted access (`stats.t.cdf`) still resolves.
      for (const k of Object.getOwnPropertyNames(v)) {
        if (k === 'length' || k === 'name' || k === 'prototype') continue;
        try { fn[k] = v[k]; } catch {}
      }
      fn._pyName = attr;
      if (obj.__adderModule__) _moduleBound.get(obj).set(attr, [v, fn]);
      return fn;
    }
    // regular property access (before dict-like methods, so getters/own props take priority)
    if (has) return v;
    // an instance attribute it doesn't have: the class's (and its bases'), as Python looks them up
    const ot = obj.__adderType__;
    // (a descriptor set on the class after it was made — six's lazy attributes — goes through __get__)
    if (ot && ot._pyMRO) for (const c of ot._pyMRO) if (_ownPyClassAttr(c, attr)) { const cv = c[attr]; return _isDescriptor(cv) ? cv.__get__(obj, ot) : cv; }
    // a boxed string (a str subclass instance): str's methods, on its value
    if (typeof obj._pyStrValue === 'string') { try { return _boxStrMethod(obj, attr); } catch (e) { if (!(e && e.pyType === 'AttributeError')) throw e; } }
    // dict-like attribute access — keys, values, items, get, etc.
    if (_objDictMethods[attr]) return _objDictMethods[attr](obj);
    // __getattr__ dunder
    if (typeof obj.__getattr__ === 'function') return obj.__getattr__(attr);
    // what every instance inherits from object (dir() lists them, so getattr must find them)
    if (ot && _OBJECT_DUNDER_SET.has(attr)) { const d = _objectDunder(obj, attr); if (d !== undefined) return d; }
    if (ot && attr === '__weakref__') return null;
    throw new AdderError('AttributeError', `'${pyTypeName(obj)}' object has no attribute '${attr}'`);
  }
  // generic
  if (obj !== null && obj !== undefined && attr in obj) {
    const val = obj[attr];
    if (typeof val === 'function') {
      if (_isNativeClass(val) || val._pyClass) return val;
      // a Python function on a class (`Cls.method`) is the function itself — binding made a
      // propertyless copy per access (no signature, no name, `Cls.f is Cls.f` False)
      if (val._pyDef && typeof obj === 'function' && obj._pyClass) return val;
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
        items.forEach((x, i) => { if (strValue(x) === null) throw new AdderError('TypeError', `sequence item ${i}: expected str instance, ${pyTypeName(x)} found`); });
        return items.map(strValue).join(s);
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
    encode: (...a) => {
      const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {};
      return pyEncode(s, a[0] ?? kw.encoding ?? 'utf-8', a[1] ?? kw.errors ?? 'strict');
    },
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
    isprintable: () => { for (const ch of s) if (_unprintable(ch)) return false; return true; },   // the rule repr() escapes by
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
// Can a dict literal with this string key be a plain JS object (the JS-interop form, read as
// d.a from JS cells)? Not for keys a JS object treats specially: `__proto__` (assigning it sets
// the prototype) and array-index-like ones ("0", "10"), which a JS object orders before every
// other key — Python keeps insertion order. A literal with such a key is a PyDict.
export const plainObjectKey = (k) => typeof k === 'string' && k !== '__proto__' && !/^(0|[1-9]\d*)$/.test(k);

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
// ── codecs: text ↔ bytes, as CPython's codecs do ──
// One core for str.encode, bytes.decode, bytes(str, enc), str(b, enc) and the codecs module.
// Encodings: utf-8 (+ utf-8-sig), latin-1, ascii, utf-16 / utf-32 (BOM, -le, -be), cp1252.
// Error handlers: strict, ignore, replace, backslashreplace, xmlcharrefreplace (encode),
// surrogateescape, surrogatepass. Errors raise UnicodeEncodeError / UnicodeDecodeError with
// CPython's messages.
const _CODEC_ALIASES = {
  'utf-8': ['utf8', 'u8', 'utf', 'cp65001', 'utf-8'],
  'utf-8-sig': ['utf-8-sig', 'utf8-sig'],
  'latin-1': ['latin-1', 'latin1', 'latin', 'l1', 'iso-8859-1', 'iso8859-1', '8859', 'cp819', 'iso-ir-100', 'iso-8859-1'],
  'ascii': ['ascii', 'us-ascii', '646', 'us'],
  'utf-16': ['utf-16', 'utf16', 'u16'],
  'utf-16-le': ['utf-16-le', 'utf-16le', 'utf16le'],
  'utf-16-be': ['utf-16-be', 'utf-16be', 'utf16be'],
  'utf-32': ['utf-32', 'utf32', 'u32'],
  'utf-32-le': ['utf-32-le', 'utf-32le', 'utf32le'],
  'utf-32-be': ['utf-32-be', 'utf-32be', 'utf32be'],
  'cp1252': ['cp1252', 'windows-1252', '1252'],
};
const _codecByAlias = new Map();
for (const [canon, names] of Object.entries(_CODEC_ALIASES)) for (const n of names) _codecByAlias.set(n, canon);
// codecs written elsewhere (punycode, in stdlib-sys): { encode(str, errors) → bytes, decode(bytes, errors) → str }
const _extraCodecs = new Map();
export function registerCodec(name, impl, aliases = []) {
  _extraCodecs.set(name, impl);
  for (const n of [name, ...aliases]) _codecByAlias.set(n, name);
}
// the canonical name of an encoding (CPython's normalisation: case, '_' / ' ' as '-'), or null
export function codecName(encoding) {
  const k = String(encoding).trim().toLowerCase().replace(/[_ ]/g, '-');
  return _codecByAlias.get(k) || _webCodec(k);
}

// ── the platform's legacy encodings (TextDecoder): big5, gbk, gb18030, shift_jis, euc-jp,
// iso-2022-jp, euc-kr, koi8-r/u, ibm866, macintosh, windows-125x, iso-8859-x … ──
// Python's names map onto the WHATWG labels; a single-byte encoding gets an exact table both
// ways (precise errors, and it encodes); a multi-byte one decodes (TextDecoder) and refuses to
// encode (TextEncoder is UTF-8 only).
const _PY_TO_WEB = {
  'cp932': 'shift_jis', 'ms932': 'shift_jis', 'mskanji': 'shift_jis', 'ms-kanji': 'shift_jis', 'sjis': 'shift_jis', 's-jis': 'shift_jis', 'shift-jis': 'shift_jis', 'shift-jis-2004': 'shift_jis', 'shift-jisx0213': 'shift_jis',
  'eucjp': 'euc-jp', 'ujis': 'euc-jp', 'euc-jis-2004': 'euc-jp', 'euc-jisx0213': 'euc-jp', 'iso2022-jp': 'iso-2022-jp', 'csiso2022jp': 'iso-2022-jp',
  'big5-tw': 'big5', 'csbig5': 'big5', 'cp950': 'big5', 'big5hkscs': 'big5',
  'gb2312': 'gbk', 'cp936': 'gbk', 'ms936': 'gbk', 'euc-cn': 'gbk', 'euccn': 'gbk', 'gb18030-2000': 'gb18030',
  'euckr': 'euc-kr', 'cp949': 'euc-kr', 'uhc': 'euc-kr', 'ks-c-5601': 'euc-kr', 'ksc5601': 'euc-kr', 'ks-c-5601-1987': 'euc-kr',
  'cp866': 'ibm866', 'mac-roman': 'macintosh', 'macroman': 'macintosh', 'mac-cyrillic': 'x-mac-cyrillic', 'maccyrillic': 'x-mac-cyrillic',
  'tis-620': 'windows-874', 'tis620': 'windows-874', 'cp874': 'windows-874',
  'latin2': 'iso-8859-2', 'latin3': 'iso-8859-3', 'latin4': 'iso-8859-4', 'latin5': 'iso-8859-9', 'latin6': 'iso-8859-10',
  'latin7': 'iso-8859-13', 'latin8': 'iso-8859-14', 'latin9': 'iso-8859-15', 'latin10': 'iso-8859-16', 'l2': 'iso-8859-2', 'cyrillic': 'iso-8859-5',
  'arabic': 'iso-8859-6', 'greek': 'iso-8859-7', 'hebrew': 'iso-8859-8', 'koi8-ru': 'koi8-u',
};
const _webCodecCache = new Map();
function _webCodec(k) {
  if (_webCodecCache.has(k)) return _webCodecCache.get(k);
  let label = _PY_TO_WEB[k] || k;
  let m;
  if ((m = /^cp(125\d)$/.exec(label))) label = `windows-${m[1]}`;
  else if ((m = /^iso-?8859-?(\d+)$/.exec(label))) label = `iso-8859-${m[1]}`;
  let web = null;
  if (typeof TextDecoder === 'function') { try { web = new TextDecoder(label).encoding; } catch { web = null; } }
  // utf-8 / utf-16 are adder's own; a label that resolves to them is an alias we don't claim
  if (!web || web === 'utf-8' || web.startsWith('utf-16') || web === 'replacement') { _webCodecCache.set(k, null); return null; }
  const name = k.replace(/-/g, '_');
  const decodeErr = (b, start, end, why) => _decodeError(name, b, start, end, why);
  const single = /^(ibm866|iso-8859-\d+|koi8-[ru]|macintosh|windows-\d+|x-mac-cyrillic)$/.test(web);
  let impl;
  if (single) {
    const td = new TextDecoder(web);
    const table = [];   // byte → code point (-1: unmapped)
    // (WHATWG fills a windows-125x code page's undefined bytes with the C1 control of the same
    // number; CPython's tables leave them undefined, and so do these)
    const win = web.startsWith('windows-');
    for (let i = 0; i < 256; i++) {
      const ch = td.decode(new Uint8Array([i]));
      const cp = ch.codePointAt(0);
      table.push((ch === '\ufffd' && i >= 0x80) || (win && i >= 0x80 && i <= 0x9f && cp === i) ? -1 : cp);
    }
    const rev = new Map(); table.forEach((cp, i) => { if (cp >= 0 && !rev.has(cp)) rev.set(cp, i); });
    impl = {
      decode(b, errors) {
        let t = '';
        for (let i = 0; i < b.length; i++) {
          const cp = table[b[i]];
          if (cp >= 0) t += String.fromCodePoint(cp);
          else t += _decodeFallback('charmap', b, i, i + 1, 'character maps to <undefined>', errors || 'strict');
        }
        return t;
      },
      encode(str, errors) {
        str = String(str);
        const out = [];
        for (let i = 0; i < str.length; i++) {
          const cp = str.codePointAt(i), len = cp > 0xffff ? 2 : 1;
          const byte = rev.get(cp);
          if (byte !== undefined) out.push(byte);
          else if ((errors || 'strict') === 'surrogateescape' && cp >= 0xdc80 && cp <= 0xdcff) out.push(cp - 0xdc00);
          else _encodeFallback('charmap', str, i, cp, len, errors || 'strict', (t) => { for (const c of t) out.push(rev.get(c.codePointAt(0)) ?? 0x3f); });
          i += len - 1;
        }
        return new Uint8Array(out);
      },
    };
  } else {
    impl = {
      decode(b, errors) {
        errors = errors || 'strict';
        if (errors === 'strict') {
          try { return new TextDecoder(web, { fatal: true }).decode(b); }
          catch { throw decodeErr(b, 0, b.length, 'illegal multibyte sequence'); }
        }
        const t = new TextDecoder(web).decode(b);
        return errors === 'ignore' ? t.replace(/\ufffd/g, '') : t;
      },
      encode(str) {
        throw _encodeError(name, String(str), 0, Math.max(1, String(str).length), `encoding to ${name} is not available here (the browser decodes it only)`);
      },
      _multibyte: true,
    };
  }
  registerCodec(name, impl, [k]);
  _webCodecCache.set(k, name);
  return name;
}
// is this one of the platform's multi-byte encodings? (charset detection asks)
export function isMultibyteCodec(encoding) {
  const n = codecName(encoding);
  return !!n && _extraCodecs.has(n) && !!_extraCodecs.get(n)._multibyte;
}
// CPython's display name for an encoding in error messages ('utf-8' → 'utf-8', 'latin-1' → 'latin-1')
const _codecDisplay = (c) => (c === 'latin-1' ? 'latin-1' : c);
function _lookupCodec(encoding) {
  const c = codecName(encoding === undefined || encoding === null ? 'utf-8' : encoding);
  if (!c) throw new AdderError('LookupError', `unknown encoding: ${encoding}`);
  return c;
}
const _CP1252_HI = [0x20AC, -1, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, -1, 0x017D, -1,
  -1, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, -1, 0x017E, 0x0178];
const _cp1252Enc = new Map(_CP1252_HI.map((u, i) => [u, 0x80 + i]).filter(([u]) => u >= 0));

function _encodeError(codec, s, start, end, reason) {
  // CPython names the character escaped ('\xe9'), whatever its printability
  const what = end - start > 1 ? `characters in position ${start}-${end - 1}` : `character '${_escapeCodePoint(s.codePointAt(start))}' in position ${start}`;
  const e = new AdderError('UnicodeEncodeError', `'${_codecDisplay(codec)}' codec can't encode ${what}: ${reason}`);
  e.encoding = codec; e.object = s; e.start = start; e.end = end; e.reason = reason;
  return e;
}
function _decodeError(codec, b, start, end, reason) {
  const what = end - start > 1 ? `bytes in position ${start}-${end - 1}` : `byte 0x${b[start].toString(16).padStart(2, '0')} in position ${start}`;
  const e = new AdderError('UnicodeDecodeError', `'${_codecDisplay(codec)}' codec can't decode ${what}: ${reason}`);
  e.encoding = codec; e.object = b; e.start = start; e.end = end; e.reason = reason;
  return e;
}

// encode one code point that the codec can't represent, per the error handler → bytes to emit
function _encodeFallback(codec, s, i, cp, len, errors, emitStr) {
  switch (errors) {
    case 'strict': throw _encodeError(codec, s, i, i + len, codec === 'ascii' ? 'ordinal not in range(128)' : codec === 'latin-1' ? 'ordinal not in range(256)' : codec === 'utf-8' ? 'surrogates not allowed' : 'character maps to <undefined>');
    case 'ignore': return;
    case 'replace': emitStr('?'); return;
    case 'backslashreplace': emitStr(cp <= 0xff ? '\\x' + cp.toString(16).padStart(2, '0') : cp <= 0xffff ? '\\u' + cp.toString(16).padStart(4, '0') : '\\U' + cp.toString(16).padStart(8, '0')); return;
    case 'xmlcharrefreplace': emitStr(`&#${cp};`); return;
    case 'namereplace': emitStr('\\N{' + cp.toString(16).toUpperCase() + '}'); return;
    default: throw new AdderError('LookupError', `unknown error handler name '${errors}'`);
  }
}

export function pyEncode(s, encoding, errors) {
  s = String(s);
  errors = errors || 'strict';
  const codec = _lookupCodec(encoding);
  if (_extraCodecs.has(codec)) return _extraCodecs.get(codec).encode(s, errors);
  const out = [];
  const pushStr = (t) => { for (const c of t) out.push(c.charCodeAt(0)); };   // handler output is ASCII
  if (codec === 'utf-16' || codec === 'utf-16-le' || codec === 'utf-16-be' || codec === 'utf-32' || codec === 'utf-32-le' || codec === 'utf-32-be') {
    const is32 = codec.startsWith('utf-32'), be = codec.endsWith('-be');
    const put = (u, n) => { const bytes = []; for (let k = 0; k < n; k++) bytes.push((u >>> (8 * k)) & 0xff); if (be) bytes.reverse(); out.push(...bytes); };
    if (codec === 'utf-16') put(0xfeff, 2);
    if (codec === 'utf-32') put(0xfeff, 4);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
        if (is32) { put(((c - 0xd800) << 10) + (s.charCodeAt(i + 1) - 0xdc00) + 0x10000, 4); }
        else { put(c, 2); put(s.charCodeAt(i + 1), 2); }
        i++;
      } else if (c >= 0xd800 && c <= 0xdfff && errors !== 'surrogatepass') {
        _encodeFallback(codec, s, i, c, 1, errors, (t) => { for (const ch of t) put(ch.charCodeAt(0), is32 ? 4 : 2); });
      } else put(c, is32 ? 4 : 2);
    }
    return new Uint8Array(out);
  }
  if (codec === 'utf-8-sig') out.push(0xef, 0xbb, 0xbf);
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i), len = 1;
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000; len = 2; }
    }
    if (codec === 'utf-8' || codec === 'utf-8-sig') {
      if (cp >= 0xd800 && cp <= 0xdfff) {
        if (errors === 'surrogateescape' && cp >= 0xdc80 && cp <= 0xdcff) { out.push(cp - 0xdc00); continue; }
        if (errors === 'surrogatepass') { out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); continue; }
        _encodeFallback('utf-8', s, i, cp, 1, errors, pushStr);
        continue;
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      const limit = codec === 'ascii' ? 0x80 : 0x100;
      let byte = -1;
      if (codec === 'cp1252') byte = cp < 0x80 || (cp >= 0xa0 && cp <= 0xff) ? cp : (_cp1252Enc.get(cp) ?? -1);
      else if (cp < limit) byte = cp;
      if (byte < 0 && errors === 'surrogateescape' && cp >= 0xdc80 && cp <= 0xdcff) byte = cp - 0xdc00;
      if (byte >= 0) out.push(byte);
      else _encodeFallback(codec, s, i, cp, len, errors, pushStr);
    }
    i += len - 1;
  }
  return new Uint8Array(out);
}

// decode one undecodable byte run per the error handler → text to emit
function _decodeFallback(codec, b, start, end, reason, errors) {
  switch (errors) {
    case 'strict': throw _decodeError(codec, b, start, end, reason);
    case 'ignore': return '';
    case 'replace': return '�';
    case 'backslashreplace': { let t = ''; for (let k = start; k < end; k++) t += '\\x' + b[k].toString(16).padStart(2, '0'); return t; }
    case 'surrogateescape': { let t = ''; for (let k = start; k < end; k++) t += String.fromCharCode(0xdc00 + b[k]); return t; }
    default: throw new AdderError('LookupError', `unknown error handler name '${errors}'`);
  }
}

// decode bytes. `final` false (an incremental decoder) leaves an incomplete trailing sequence
// undecoded: → { text, consumed }
export function pyDecodePartial(b, encoding, errors, final = true) {
  errors = errors || 'strict';
  const codec = _lookupCodec(encoding);
  if (_extraCodecs.has(codec)) return { text: _extraCodecs.get(codec).decode(b, errors), consumed: b.length };
  let i = 0, text = '';
  const n = b.length;
  if (codec === 'latin-1') { for (; i < n; i++) text += String.fromCharCode(b[i]); return { text, consumed: n }; }
  if (codec === 'ascii' || codec === 'cp1252') {
    for (; i < n; i++) {
      const x = b[i];
      if (x < 0x80) text += String.fromCharCode(x);
      else if (codec === 'cp1252' && (x >= 0xa0 || _CP1252_HI[x - 0x80] >= 0)) text += String.fromCharCode(x >= 0xa0 ? x : _CP1252_HI[x - 0x80]);
      else text += _decodeFallback(codec, b, i, i + 1, codec === 'ascii' ? 'ordinal not in range(128)' : 'character maps to <undefined>', errors);
    }
    return { text, consumed: n };
  }
  if (codec.startsWith('utf-16') || codec.startsWith('utf-32')) {
    const w = codec.startsWith('utf-32') ? 4 : 2;
    let be = codec.endsWith('-be');
    if (codec === 'utf-16' || codec === 'utf-32') {
      if (w === 2 && n >= 2 && b[0] === 0xfe && b[1] === 0xff) { be = true; i = 2; }
      else if (w === 2 && n >= 2 && b[0] === 0xff && b[1] === 0xfe) i = 2;
      else if (w === 4 && n >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) { be = true; i = 4; }
      else if (w === 4 && n >= 4 && b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) i = 4;
    }
    const unit = (k) => { let u = 0; for (let q = 0; q < w; q++) u |= b[k + q] << (8 * (be ? w - 1 - q : q)); return u >>> 0; };
    while (i + w <= n) {
      const u = unit(i);
      if (w === 4) {
        if (u > 0x10ffff || (u >= 0xd800 && u <= 0xdfff && errors !== 'surrogatepass')) text += _decodeFallback(codec, b, i, i + 4, 'code point not in range(0x110000)', errors);
        else text += String.fromCodePoint(u);
        i += 4; continue;
      }
      if (u >= 0xd800 && u <= 0xdbff) {
        if (i + 4 > n) { if (!final) break; text += _decodeFallback(codec, b, i, n, 'unexpected end of data', errors); i = n; break; }
        const lo = unit(i + 2);
        if (lo >= 0xdc00 && lo <= 0xdfff) { text += String.fromCharCode(u, lo); i += 4; continue; }
        text += _decodeFallback(codec, b, i, i + 2, 'illegal UTF-16 surrogate', errors); i += 2; continue;
      }
      if (u >= 0xdc00 && u <= 0xdfff) { text += _decodeFallback(codec, b, i, i + 2, 'illegal encoding', errors); i += 2; continue; }
      text += String.fromCharCode(u); i += 2;
    }
    if (i < n && final) { text += _decodeFallback(codec, b, i, n, 'truncated data', errors); i = n; }
    return { text, consumed: i };
  }
  // utf-8 (and utf-8-sig: a leading BOM is dropped)
  if (codec === 'utf-8-sig' && n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < n) {
    const x = b[i];
    if (x < 0x80) { text += String.fromCharCode(x); i++; continue; }
    let need, cp, lo = 0x80, hi = 0xbf;
    if (x >= 0xc2 && x <= 0xdf) { need = 1; cp = x & 0x1f; }
    else if (x >= 0xe0 && x <= 0xef) { need = 2; cp = x & 0x0f; if (x === 0xe0) lo = 0xa0; if (x === 0xed && errors !== 'surrogatepass') hi = 0x9f; }
    else if (x >= 0xf0 && x <= 0xf4) { need = 3; cp = x & 0x07; if (x === 0xf0) lo = 0x90; if (x === 0xf4) hi = 0x8f; }
    else { text += _decodeFallback('utf-8', b, i, i + 1, 'invalid start byte', errors); i++; continue; }
    let k = 1, ok = true;
    for (; k <= need; k++) {
      if (i + k >= n) break;
      const y = b[i + k];
      if (y < (k === 1 ? lo : 0x80) || y > (k === 1 ? hi : 0xbf)) { ok = false; break; }
      cp = (cp << 6) | (y & 0x3f);
    }
    if (ok && k > need) { text += String.fromCodePoint(cp); i += need + 1; continue; }
    if (ok && i + k >= n) {                                // ran out of input mid-sequence
      if (!final) break;
      text += _decodeFallback('utf-8', b, i, n, 'unexpected end of data', errors); i = n; break;
    }
    text += _decodeFallback('utf-8', b, i, i + k, k === 1 ? 'invalid continuation byte' : 'invalid continuation byte', errors);
    i += k;
  }
  return { text, consumed: i };
}
export const pyDecode = (b, encoding, errors) => pyDecodePartial(b, encoding, errors, true).text;

const _b2s = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return s; };
const _s2b = (s) => bytesLit(s);
function _bytesMethod(b, attr) {
  const bytesArg = (x) => (x instanceof Uint8Array ? _b2s(x) : Array.isArray(x) ? x.map(bytesArg) : x);
  const back = (r) => (typeof r === 'string' ? _s2b(r) : Array.isArray(r) ? r.map(back) : r);
  const m = {
    decode: (...a) => {
      const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {};
      return pyDecode(b, a[0] ?? kw.encoding ?? 'utf-8', a[1] ?? kw.errors ?? 'strict');
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
    extend: (iterable) => (Array.isArray(iterable) ? (arr.push(...(iterable === arr ? iterable.slice() : iterable)), null) : _eachMaybe(iterable, (v) => arr.push(v))),
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
    update: maybeSync(function* (...others) { for (const o of others) yield _eachMaybe(o, (v) => set.add(v)); return null; }),
    issubset: (other) => { const o = other instanceof Set ? other : new PySet(pyIter(other)); for (const v of set) if (!o.has(v)) return false; return true; },
    issuperset: (other) => { for (const v of pyIter(other)) if (!set.has(v)) return false; return true; },
    isdisjoint: (other) => { for (const v of pyIter(other)) if (set.has(v)) return false; return true; },
    difference_update: (...others) => { for (const o of others) for (const v of [...pyIter(o)]) set.delete(v); return null; },
    intersection_update: (...others) => {
      const keep = others.map((o) => (o instanceof Set ? o : new PySet(pyIter(o))));
      for (const v of [...set]) if (!keep.every((s) => s.has(v))) set.delete(v);
      return null;
    },
    symmetric_difference_update: (other) => { for (const v of new PySet(pyIter(other))) { if (set.has(v)) set.delete(v); else set.add(v); } return null; },
    copy: () => { const c = new PySet(set); if (set._frozen) c._frozen = true; return c; },
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
  if (!_obj(a) && !_obj(b)) return null;   // numbers, strings, …: no dunders, and no closures allocated per call
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
  if (typeof a === 'number' && typeof b === 'number') return a + b;   // the hot case, first
  // bytes + bytearray: the left operand's type
  if ((a instanceof PyByteArray || b instanceof PyByteArray) && _isBytesLike(a) && _isBytesLike(b)) {
    const r = new Uint8Array(a.length + b.length); r.set(_asU8(a)); r.set(_asU8(b), a.length);
    return a instanceof PyByteArray ? _toBA(r) : r;
  }
  const d = _viaDunder(a, b, '__add__', '__radd__'); if (d) return d.r;
  if (_isNum(a) && _isNum(b)) return _asInt(a) + _asInt(b);
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  // a boxed str (a StrEnum member, a str subclass without __add__) is a str
  { const sa = strValue(a), sb = strValue(b); if (sa !== null && sb !== null) return sa + sb; }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ta = a instanceof PyTuple, tb = b instanceof PyTuple;
    if (ta !== tb) throw new AdderError('TypeError', `can only concatenate ${ta ? 'tuple' : 'list'} (not "${pyTypeName(b)}") to ${ta ? 'tuple' : 'list'}`);
    return ta ? mkTuple([...a, ...b]) : [...a, ...b];
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
  throw _binErr('+', a, b);
}
// `a += b` without an __iadd__: a list extends IN PLACE from any iterable (list.__iadd__ is
// list.extend, so aliases see the change); everything else — tuples included, which are arrays
// here but immutable — rebinds to `a + b`. Shared by both engines (the caller has already tried
// a user __iadd__).
export function pyIAddBuiltin(a, b) {
  if (Array.isArray(a) && !(a instanceof PyTuple)) {
    if (Array.isArray(b)) { if (b === a) b = b.slice(); for (const x of b) a.push(x); }
    else for (const x of pyIter(b)) a.push(x);
    return a;
  }
  return pyAdd(a, b);
}
export function pySub(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
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
  if (typeof a === 'number' && typeof b === 'number') return a * b;
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
// (a %s / %r whose __str__ / __repr__ is tree-walked answers with a Promise: they are resolved,
// in order, and the format runs again with the strings — `pre`, one per %s / %r)
export function pyPercentFormat(fmt, args, pre = null) {
  const isMap = _dictLike(args);
  const list = args instanceof PyTuple ? args : [args];
  let i = 0, usedMap = false, slot = 0;
  const pending = [];
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
        case 'r': case 'a': case 's': {
          numeric = false;
          const k = slot++;
          body = pre ? pre[k] : type === 's' ? pyStrMaybe(v) : pyReprMaybe(v);
          if (body && typeof body.then === 'function') { pending[k] = body; body = ''; }
          else if (!pre) pending[k] = body;
          if (p !== undefined) body = body.slice(0, p);
          break;
        }
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
  if (!pre && pending.some((x) => x && typeof x.then === 'function')) return Promise.all(pending).then((strs) => pyPercentFormat(fmt, args, strs));
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
// a list / dict / set subclass's own dunder, if it defines one (the builtin's paths below are the
// raw operation, which super().__getitem__ & co. read)
export function subclassDunder(obj, name) {
  const t = obj !== null && typeof obj === 'object' ? obj.__adderType__ : undefined;
  if (!t || !t._pyMRO || !t.prototype || !(Array.isArray(obj) || obj instanceof Map || obj instanceof Set)) return null;
  const f = t.prototype[name];
  return typeof f === 'function' && t._pyMRO.some((c) => c._pyOwnMembers && c._pyOwnMembers.has(name)) ? f : null;
}
export function pyGetItem(obj, key, raw = false) {
  if (obj === null || obj === undefined) throw new AdderError('TypeError', `'NoneType' object is not subscriptable`);
  if (!raw) { const f = subclassDunder(obj, '__getitem__'); if (f) return f.call(obj, key); }
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
      if (key !== null && typeof key === 'object' && typeof key._pyStrValue === 'string') key = key._pyStrValue;   // a boxed str subclass instance
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
  // bytes and bytearray compare by content, either way round
  if ((a instanceof PyByteArray || b instanceof PyByteArray) && _isBytesLike(a) && _isBytesLike(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
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
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (_hasDunder(a, '__lt__')) return a.__lt__(b);
  if (_hasDunder(b, '__gt__')) return b.__gt__(a);
  return _ltPlain('<', a, b);
}
export function pyGt(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  if (_hasDunder(a, '__gt__')) return a.__gt__(b);
  if (_hasDunder(b, '__lt__')) return b.__lt__(a);
  return _ltPlain('>', b, a);
}
export function pyLe(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a <= b;
  if (_hasDunder(a, '__le__')) return a.__le__(b);
  if (_hasDunder(b, '__ge__')) return b.__ge__(a);
  if (_numLike(a) && _numLike(b)) return a <= b;
  if (typeof a === 'string' && typeof b === 'string') return a <= b;
  if (a instanceof Set && b instanceof Set) { for (const v of a) if (!b.has(v)) return false; return true; }
  return _ltPlain('<=', a, b) || pyEq(a, b);
}
export function pyGe(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a >= b;
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
function* _gSortKeys(arr, key) {
  if (!key) return arr.slice();
  const keys = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) keys[i] = yield key(arr[i]);
  return keys;
}
function* _gSorted(arr, key, reverse) {
  const keys = yield* _gSortKeys(arr, key);
  const order = arr.map((_, i) => i);
  const less = (i, j) => (reverse ? pyLt(keys[j], keys[i]) : pyLt(keys[i], keys[j]));
  let pending = false;
  order.sort((i, j) => {
    if (pending) return 0;
    const lt = less(i, j);
    if (_isThenable(lt)) { pending = true; return 0; }
    if (lt) return -1;
    const gt = less(j, i);
    if (_isThenable(gt)) { pending = true; return 0; }
    return gt ? 1 : 0;
  });
  if (!pending) return order.map((i) => arr[i]);
  // async comparisons: stable merge sort, waiting on each `<`
  const ms = function* (idx) {
    if (idx.length < 2) return idx;
    const mid = idx.length >> 1;
    const l = yield* ms(idx.slice(0, mid)), r = yield* ms(idx.slice(mid));
    const out = [];
    let i = 0, j = 0;
    while (i < l.length && j < r.length) {
      if (yield less(r[j], l[i])) out.push(r[j++]); else out.push(l[i++]);
    }
    return out.concat(l.slice(i), r.slice(j));
  };
  return (yield* ms(arr.map((_, i) => i))).map((i) => arr[i]);
}
export const pySorted = maybeSync(_gSorted);
// min / max: the first extreme item, by key, through `<`
export const pyExtreme = maybeSync(function* (which, args) {
  let key = null, dflt, hasDefault = false;
  if (args.length > 0 && args[args.length - 1]?._kw) {
    const kw = args.pop();
    key = kw.key || null;
    if ('default' in kw) { dflt = kw.default; hasDefault = true; }
  }
  const items = args.length === 1 ? yield* _gCollect(args[0]) : args;
  if (items.length === 0) {
    if (hasDefault) return dflt;
    throw new AdderError('ValueError', `${which}() iterable argument is empty`);
  }
  const keys = yield* _gSortKeys(items, key);
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    const better = yield (which === 'max' ? pyLt(keys[best], keys[i]) : pyLt(keys[i], keys[best]));
    if (better) best = i;
  }
  return items[best];
});

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
  extend(it) { return _eachMaybe(it, (x) => this.append(x)); }
  extendleft(it) { return _eachMaybe(it, (x) => this.appendleft(x)); }
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
    if (v !== null && typeof v === 'object' && typeof v._pyStrValue === 'string') v = v._pyStrValue;   // a str subclass is a str
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
// Python regex syntax → a JS RegExp source meaning the same, in one pass over the pattern
// (escapes and character classes need context a chain of replaces can't see):
//   \A \Z → start / end of input; $ (no MULTILINE) also matches before a final newline;
//   . (no DOTALL) excludes only \n (JS's also excludes \r and the line separators);
//   \d \w \b are Unicode in Python str patterns (JS's are ASCII even with the u flag);
//   (?P<n>…) (?P=n) named groups; (?#…) comments; a lone { or } is a literal; {,n} is {0,n};
//   []…] has a literal ] first; escapes JS's unicode mode rejects (\: \- \' …) are characters;
//   \uXXXX \UXXXXXXXX \xXX and octal escapes; possessive quantifiers (*+ ++ ?+ {m,n}+) and
//   atomic groups (?>…) become their plain forms (JS has neither: only which patterns FAIL to
//   match after backtracking can differ).
function _reError(msg, pos) { return new AdderError('re.error', pos === undefined ? msg : `${msg} at position ${pos}`); }
function _reToJs(p, f) {
  const ascii = !!(f & 256), dotall = !!(f & 16), multiline = !!(f & 8);
  const W = ascii ? 'A-Za-z0-9_' : '\\p{L}\\p{N}\\p{Mn}\\p{Pc}';
  let out = '', i = 0, inClass = false, lastClassEscape = false, lastAtom = false;
  const n = p.length;
  const hex = (k, what) => {
    const h = p.slice(i, i + k);
    if (h.length !== k || !/^[0-9a-fA-F]+$/.test(h)) throw _reError(`incomplete escape \\${what}${h}`, i - 2);
    i += k;
    return h;
  };
  while (i < n) {
    const c = p[i];
    if (c === '\\') {
      const e = p[i + 1];
      if (e === undefined) throw _reError('bad escape (end of pattern)', i);
      const at = i;
      i += 2;
      lastClassEscape = false; lastAtom = true;
      if (e === 'A') { out += inClass ? (() => { throw _reError('bad escape \\A', at); })() : '(?<![\\s\\S])'; continue; }
      if (e === 'Z') { if (inClass) throw _reError('bad escape \\Z', at); out += '(?![\\s\\S])'; continue; }
      if (e === 'd') { out += ascii ? '\\d' : (inClass ? '\\p{Nd}' : '\\p{Nd}'); lastClassEscape = true; continue; }
      if (e === 'D') { out += ascii ? '\\D' : (inClass ? '\\P{Nd}' : '\\P{Nd}'); lastClassEscape = true; continue; }
      if (e === 'w') { out += ascii ? '\\w' : (inClass ? W : `[${W}]`); lastClassEscape = true; continue; }
      if (e === 'W') { out += ascii ? '\\W' : (inClass ? '\\W' : `[^${W}]`); lastClassEscape = true; continue; }
      if (e === 's' || e === 'S') { out += '\\' + e; lastClassEscape = true; continue; }
      if (e === 'b') {
        if (inClass) { out += '\\x08'; continue; }
        out += ascii ? '\\b' : `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`; lastAtom = false; continue;
      }
      if (e === 'B') { if (inClass) throw _reError('bad escape \\B', at); out += ascii ? '\\B' : `(?:(?<=[${W}])(?=[${W}])|(?<![${W}])(?![${W}]))`; lastAtom = false; continue; }
      if ('nrtfv'.includes(e)) { out += '\\' + e; continue; }
      if (e === 'a') { out += '\\x07'; continue; }
      if (e === 'x') { out += '\\x' + hex(2, 'x'); continue; }
      if (e === 'u') { out += '\\u' + hex(4, 'u'); continue; }
      if (e === 'U') { const h = hex(8, 'U'); if (parseInt(h, 16) > 0x10ffff) throw _reError(`bad escape \\U${h}`, at); out += `\\u{${h}}`; continue; }
      if (e === 'N') throw _reError('\\N{...} character names are not supported (no Unicode name database)', at);
      if (e === '0' || (inClass && /[1-7]/.test(e))) {
        let oct = e;
        while (oct.length < 3 && /[0-7]/.test(p[i] || '')) oct += p[i++];
        out += '\\x' + parseInt(oct, 8).toString(16).padStart(2, '0');
        continue;
      }
      if (/[1-9]/.test(e)) {
        // a 3-digit octal escape, else a backreference (1-99)
        if (/[0-7]/.test(e) && /[0-7]/.test(p[i] || '') && /[0-7]/.test(p[i + 1] || '')) {
          const oct = e + p[i] + p[i + 1]; i += 2;
          out += '\\x' + (parseInt(oct, 8) & 0xff).toString(16).padStart(2, '0');
          continue;
        }
        let num = e;
        if (/\d/.test(p[i] || '')) num += p[i++];
        out += `(?:\\${num})`;
        continue;
      }
      if (/[A-Za-z]/.test(e)) throw _reError(`bad escape \\${e}`, at);
      // any other escaped character is that character (JS's unicode mode only lets syntax be escaped)
      const syntax = inClass ? /[\^\\\]\[\-]/ : /[\^$\\.*+?()[\]{}|\/]/;
      out += syntax.test(e) ? '\\' + e : e;
      continue;
    }
    if (inClass) {
      if (c === ']') { out += ']'; inClass = false; i++; lastAtom = true; continue; }
      if (c === '[') { out += '\\['; i++; lastClassEscape = false; continue; }
      // a '-' right after a class escape (\w-.) is a literal, as in Python
      if (c === '-' && lastClassEscape) { out += '\\-'; i++; lastClassEscape = false; continue; }
      lastClassEscape = false;
      out += c; i++;
      continue;
    }
    if (c === '[') {
      inClass = true; lastClassEscape = false; out += '['; i++;
      if (p[i] === '^') { out += '^'; i++; }
      if (p[i] === ']') { out += '\\]'; i++; }      // a ] first is a literal in Python
      continue;
    }
    if (c === '(') {
      if (p.startsWith('(?#', i)) {                  // a comment
        const j = p.indexOf(')', i);
        if (j < 0) throw _reError('missing ), unterminated comment', i);
        i = j + 1; continue;
      }
      if (p.startsWith('(?P<', i)) { out += '(?<'; i += 4; lastAtom = false; continue; }
      if (p.startsWith('(?P=', i)) {
        const j = p.indexOf(')', i);
        out += `\\k<${p.slice(i + 4, j)}>`; i = j + 1; lastAtom = true; continue;
      }
      if (p.startsWith('(?>', i)) { out += '(?:'; i += 3; lastAtom = false; continue; }   // atomic → plain group
      if (p.startsWith('(?(', i)) throw _reError('conditional groups (?(…)…) are not supported', i);
      const g = /^\(\?([aiLmsux]+)\)/.exec(p.slice(i));
      if (g) throw _reError('global flags not at the start of the expression', i);
      out += c; i++; lastAtom = false; continue;
    }
    if (c === ')') { out += c; i++; lastAtom = true; continue; }
    if (c === '{') {
      const q = /^\{(\d*)(,(\d*))?\}/.exec(p.slice(i));
      if (q && lastAtom && (q[1] !== '' || (q[2] && q[3] !== ''))) {
        out += `{${q[1] === '' ? '0' : q[1]}${q[2] !== undefined ? ',' + (q[3] || '') : ''}}`;
        i += q[0].length;
        if (p[i] === '+') i++;                       // possessive {m,n}+ → greedy
        lastAtom = false;
        continue;
      }
      out += '\\{'; i++; lastAtom = true; continue;  // not a quantifier: a literal brace
    }
    if (c === '}') { out += '\\}'; i++; lastAtom = true; continue; }
    if (c === ']') { out += '\\]'; i++; lastAtom = true; continue; }   // outside a class: a literal (JS's u-mode refuses it bare)
    if (c === '*' || c === '+' || c === '?') {
      out += c; i++;
      if (p[i] === '+') i++;                         // possessive → greedy
      else if (p[i] === '?') { out += '?'; i++; }    // lazy
      lastAtom = false;
      continue;
    }
    if (c === '.') { out += dotall ? '.' : '[^\\n]'; i++; lastAtom = true; continue; }
    if (c === '$') { out += multiline ? '$' : '(?=\\n?(?![\\s\\S]))'; i++; lastAtom = false; continue; }
    if (c === '|' || c === '^') { out += c; i++; lastAtom = false; continue; }
    out += c; i++; lastAtom = true;
  }
  if (inClass) throw _reError('unterminated character set', p.lastIndexOf('['));
  return out;
}

// Python pattern + flags → { source, flags } for RegExp
function _reTranslate(pattern, flags) {
  let p = pattern instanceof Uint8Array ? String.fromCharCode(...pattern) : String(pattern);
  let f = flags | 0;
  if (pattern instanceof Uint8Array) f |= 256;      // a bytes pattern has ASCII semantics
  const lead = /^\(\?([aiLmsux]+)\)/.exec(p);
  if (lead) {
    for (const ch of lead[1]) f |= { a: 256, i: 2, L: 4, m: 8, s: 16, u: 32, x: 64 }[ch];
    p = p.slice(lead[0].length);
  }
  if (f & 64) p = _reVerbose(p);
  p = _reToJs(p, f);
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
  const B = string instanceof Uint8Array;            // a bytes subject: groups come back as bytes
  const resolve = (g) => {
    if (g === undefined) return 0;
    if (typeof g === 'string') {
      if (!(g in groupIndex)) throw new AdderError('IndexError', 'no such group');
      return groupIndex[g];
    }
    if (typeof g !== 'number' || g < 0 || g > pattern.groups) throw new AdderError('IndexError', 'no such group');
    return g;
  };
  const val = (i) => (m[i] === undefined ? null : B ? _s2b(m[i]) : m[i]);
  const span = (g) => { const i = resolve(g); const ix = m.indices && m.indices[i]; return mkTuple(ix ? [ix[0], ix[1]] : [-1, -1]); };
  let lastindex = null;
  for (let i = 1; i <= pattern.groups; i++) if (m[i] !== undefined) lastindex = i;
  const obj = {
    __adderClass__: 're.Match',
    string, re: pattern, pos, endpos, lastindex,
    lastgroup: lastindex === null ? null : (Object.keys(groupIndex).find((k) => groupIndex[k] === lastindex) || null),
    group: (...gs) => (gs.length <= 1 ? val(resolve(gs[0])) : mkTuple(gs.map((g) => val(resolve(g))))),
    groups: (dflt) => { const out = []; for (let i = 1; i <= pattern.groups; i++) out.push(m[i] === undefined ? (dflt === undefined ? null : dflt) : val(i)); return mkTuple(out); },
    groupdict: (dflt) => { const o = {}; for (const [k, i] of Object.entries(groupIndex)) o[k] = m[i] === undefined ? (dflt === undefined ? null : dflt) : val(i); return o; },
    start: (g) => span(g)[0],
    end: (g) => span(g)[1],
    span,
    expand: (template) => _reExpand(template, (i) => val(resolve(i))),
    __getitem__: (g) => val(resolve(g)),
    __bool__: () => true,
    __repr__: () => `<re.Match object; span=(${span(0).join(', ')}), match=${pyRepr(val(0))}>`,
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
  // a bytes subject is matched as its latin-1 string (each byte one char), results go back to bytes
  const isB = pattern instanceof Uint8Array;
  const str = (s) => {
    if (s instanceof Uint8Array) { if (!isB) throw new AdderError('TypeError', 'cannot use a string pattern on a bytes-like object'); return _b2s(s); }
    if (isB && typeof s === 'string') throw new AdderError('TypeError', 'cannot use a bytes pattern on a string-like object');
    return String(s);
  };
  const back = (x) => (isB && typeof x === 'string' ? _s2b(x) : x);
  const at = (s0, pos, endpos, sticky) => {
    const s = str(s0);
    const end = endpos == null ? s.length : Math.min(endpos, s.length);
    const re = make(sticky ? 'y' : 'g');
    re.lastIndex = pos || 0;
    const m = re.exec(s.slice(0, end));
    return m ? _reMatchObject(m, P, s0, pos || 0, end) : null;
  };
  P.search = (s, pos, endpos) => at(s, pos, endpos, false);
  P.match = (s, pos, endpos) => at(s, pos, endpos, true);
  P.fullmatch = (s0, pos, endpos) => {
    const s = str(s0);
    const end = endpos == null ? s.length : Math.min(endpos, s.length);
    const re = new RegExp(`(?:${t.source})(?![\\s\\S])`, t.flags + 'dy');
    re.lastIndex = pos || 0;
    const m = re.exec(s.slice(0, end));
    return m ? _reMatchObject(m, P, s0, pos || 0, end) : null;
  };
  const allMatches = (s) => {
    s = str(s);
    const re = make('g');
    const out = [];
    let m;
    while ((m = re.exec(s))) { out.push(m); if (m[0] === '') re.lastIndex++; }
    return out;
  };
  P.findall = (s) => allMatches(s).map((m) => (count === 0 ? back(m[0]) : count === 1 ? back(m[1] ?? '') : mkTuple(m.slice(1).map((g) => back(g ?? '')))));
  P.finditer = (s) => allMatches(s).map((m) => _reMatchObject(m, P, s, 0, s.length));
  P.split = (s0, maxsplit) => {
    const s = str(s0);
    if (maxsplit && maxsplit._kw) maxsplit = maxsplit.maxsplit;
    const out = [];
    let last = 0, n = 0;
    for (const m of allMatches(s)) {
      if (maxsplit && n >= maxsplit) break;
      out.push(back(s.slice(last, m.index)), ...m.slice(1).map((g) => (g === undefined ? null : back(g))));
      last = m.index + m[0].length;
      n++;
    }
    out.push(back(s.slice(last)));
    return out;
  };
  P.subn = (repl, s0, count = 0) => {
    if (count && count._kw) count = count.count;
    const s = str(s0);
    const ms = allMatches(s).slice(0, count > 0 ? count : undefined);
    // a template's group reference: \1 / \g<1> by number, \g<name> through the group index
    const groupOf = (m) => (g) => {
      const i = typeof g === 'number' ? g : names[g];
      if (i === undefined) throw new AdderError('IndexError', `unknown group name '${g}'`);
      return m[i] === undefined ? '' : m[i];
    };
    const unB = (x) => (x instanceof Uint8Array ? _b2s(x) : x);
    const tmpl = unB(repl);
    const pieces = ms.map((m) => {
      if (typeof repl === 'function') { const r = repl(_reMatchObject(m, P, s0, 0, s.length)); return r && typeof r.then === 'function' ? r.then(unB) : unB(r); }
      return _reExpand(String(tmpl), groupOf(m));
    });
    const build = (ps) => {
      let out = '', last = 0;
      ms.forEach((m, i) => { out += s.slice(last, m.index) + (ps[i] ?? ''); last = m.index + m[0].length; });
      return mkTuple([back(out + s.slice(last)), ms.length]);
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
  // error / PatternError: set below, once the exception tables exist
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
  exc_info: () => (excStack.length ? mkTuple([excTypeOf(excStack[excStack.length - 1]), excValue(excStack[excStack.length - 1]), _tracebackOf(excStack[excStack.length - 1])]) : mkTuple([null, null, null])),
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
// (re.error is assigned after this function's tables are initialised — see the end of the file)
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
const _JS_FN_PROPS = new Set(['name', 'length', 'prototype', 'caller', 'arguments']);
// does class c itself hold attribute k (a class variable, a method, or one set on it later)?
function _ownPyClassAttr(c, k) {
  if (!Object.hasOwn(c, k)) return false;
  return !_JS_FN_PROPS.has(k) || !!(c._pyAttrs && c._pyAttrs.has(k));
}
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

// os additions defined elsewhere (stdlib-sys.js: PathLike, fspath) — applied to each os module made
let _osExtrasHook = null;
export function setOsExtrasHook(fn) { _osExtrasHook = fn; if (adderModules.os) fn(adderModules.os); }

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
  if (_osExtrasHook) _osExtrasHook(adderModules.os);
  adderModules['os.path'] = adderModules.os.path;
  adderModules.pathlib = { Path: _createPathClass(getVfs, pth) };
  adderModules.shutil = _createShutilModule(getVfs);
  adderModules.glob = _createGlobModule(getVfs);
}

// dict(mapping | pairs, **kw)
const _dictFrom = maybeSync(function* (args) {
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
    for (const k of yield* _gCollect(yield x.keys())) entries.push([k, yield x.__getitem__(k)]);
  } else {
    const items = Array.isArray(x) ? x : yield* _gCollect(x);
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
});

// ── stdout / stderr ──
// The host's writers for the program running now: run() sets them from its options, a notebook
// cell from its output. sys.stdout / sys.stderr and print(file=sys.stderr) write through here.
export const _stdio = { out: null, err: null, redirect: null };
// the exceptions being handled, innermost last: both engines push on entering an except body and
// pop on leaving it (a bare `raise`, sys.exc_info(), sys.exception(), logging.exception read it)
export const excStack = [];
// an imported module's print writes where the running program's does (it used to be dropped)
export const stdoutWrite = (s) => _stdioWrite('out', s);
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
export function computeMRO(cls) {
  if (!cls._pyBases || cls._pyBases.length === 0) return [cls];
  const baseMROs = cls._pyBases.map(b => [...computeMRO(b)]);
  const result = [cls];
  const lists = [...baseMROs, [...cls._pyBases]];
  while (lists.some(l => l.length > 0)) {
    let head = null;
    for (const list of lists) {
      if (list.length === 0) continue;
      const candidate = list[0];
      if (lists.every(l => { const idx = l.indexOf(candidate); return idx <= 0; })) { head = candidate; break; }
    }
    if (!head) throw new AdderError('TypeError', 'Cannot create a consistent method resolution order');
    result.push(head);
    for (const list of lists) { const idx = list.indexOf(head); if (idx !== -1) list.splice(idx, 1); }
  }
  return result;
}

// f as a JS function to call: a function as is; an object with __call__ (a callable instance) its
// bound __call__; anything else is not callable, as CPython says
// what `await x` waits on: x's __await__() when it has one (an asyncio Task / Future, a user
// awaitable) — such objects are not JS thenables, so returning one from a call doesn't await it
export function awaitTarget(x) {
  if (x !== null && x !== undefined && typeof x === 'object' && typeof x.then !== 'function' && typeof x.__await__ === 'function') return x.__await__();
  return x;
}

export function asCallable(f) {
  if (typeof f === 'function') return f;
  if (f !== null && typeof f === 'object' && typeof f.__call__ === 'function') return (...a) => f.__call__(...a);
  throw new AdderError('TypeError', `'${pyTypeName(f)}' object is not callable`);
}

// ── the object model: classes, __new__, type, metaclasses ──
//
// A class is a JS function (calling it makes an instance) with _pyName / _pyMRO / prototype /
// _pyOwnMembers. Both engines build them here: buildClass is type.__new__'s work, typeCall is
// type.__call__'s (run __new__, then __init__ when __new__ returned an instance of the class).
// A metaclass is a class whose MRO contains `type` (pyTypeObj below); a class it builds carries it
// as __adderMeta__, which type(), isinstance(), attribute lookup and calling the class consult.

// is `x` an instance of class `cls`? (an instance through its __adderType__; a class through its metaclass)
function _isInstanceOfClass(x, cls) {
  if (x === null || x === undefined) return false;
  const t = x.__adderType__ || (typeof x === 'function' && x._pyClass ? (x.__adderMeta__ || pyTypeObj) : null);
  if (!t) return false;
  return t === cls || (t._pyMRO || [t]).includes(cls);
}
const _isSubclass = (a, b) => a === b || ((a && a._pyMRO) || []).includes(b);

// object.__new__(cls): a bare instance of cls
export function objectNew(cls, args = []) {
  if (cls._pyStrBase) {
    // str(object='') / str(bytes, encoding[, errors]): the string the box holds
    const a = args.filter((x) => !(x && x._kw));
    const kw = args.find((x) => x && x._kw) || {};
    let v;
    if (a.length === 0) v = '';
    else if (a.length >= 2 || kw.encoding !== undefined) v = pyDecodePartial(a[0] instanceof Uint8Array ? a[0] : Uint8Array.from(a[0]), a[1] ?? kw.encoding, a[2] ?? kw.errors ?? 'strict', true).text;
    else v = strValue(a[0]) ?? pyStr(a[0]);
    const box = Object.create(cls.prototype);
    box.__adderClass__ = cls._pyName;
    box.__adderType__ = cls;
    Object.defineProperty(box, '_pyStrValue', { value: String(v), enumerable: false, writable: false, configurable: false });
    return box;
  }
  const instance = cls._pyListBase
    ? Object.assign(Object.setPrototypeOf(args.length > 0 && !(args[0] && args[0]._kw) ? [...pyIter(args[0])] : [], cls.prototype), { __adderClass__: cls._pyName, __adderType__: cls })
    : Object.create(cls.prototype);
  if (!cls._pyListBase) {
    instance.__adderClass__ = cls._pyName;
    instance.__adderType__ = cls;
  }
  initExceptionInstance(cls, instance, args);
  return instance;
}

// the class's __new__: the nearest one in its MRO (a user `def __new__`, or type's for a metaclass)
function _findNew(cls) {
  for (const c of cls._pyMRO || [cls]) if (Object.hasOwn(c, '_pyNewFn')) return c._pyNewFn;
  return null;
}

// type.__call__(cls, *args): __new__, then __init__ when __new__ gave back an instance of cls
export function typeCall(cls, args) {
  const finish = (inst) => {
    if (!_isInstanceOfClass(inst, cls)) return inst;
    const init = cls.prototype.__init__;
    if (typeof init === 'function') {
      const r = init.call(inst, ...args);
      if (r && typeof r.then === 'function') return r.then(() => inst);
    }
    return inst;
  };
  const nf = _findNew(cls);
  if (!nf) return finish(objectNew(cls, args));       // the common case: no __new__ anywhere
  const inst = nf(cls, ...args);
  return inst && typeof inst.then === 'function' ? inst.then(finish) : finish(inst);
}

// a classmethod, as a class attribute: bound to the class it's looked up on (a subclass too)
function _classMethodDescriptor(fn, qual) {
  return {
    get() { const c = this; const m = (...a) => fn(c, ...a); m._pyName = qual; m.__func__ = fn; return m; },
    configurable: true, enumerable: true,
  };
}

// The class factory both engines use (the tree-walker's ClassDef, AIR's _py.createClass, and
// type(name, bases, ns)): `members` the class body's namespace (an object), `annotations`
// [[name, text], …].
//   opts.meta         — the metaclass building it (absent for plain `type`)
//   opts.kw           — class keywords other than metaclass=, passed to __init_subclass__
//   opts.beforeFinish — runs before __init_subclass__ fires (the tree-walker binds the class's
//                       `__class__` cell there, so super() works in a hook that calls a method)
// a class-body function that becomes a method (bound to the instance). In a class written in
// Python (opts.pyBody), only Python functions are: a builtin stored on a class (`concat =
// "".join`, a functools.partial) is a plain attribute, as in CPython. Classes adder builds in JS
// pass their methods as JS functions taking self, and all of those bind.
function _isMethodFn(v, opts) {
  return typeof v === 'function' && !v._pyClass && (!opts.pyBody || !!v._pyDef || !!v._pyFunc || v.__wrapped__ !== undefined);   // (a decorator's wrapper of a Python function — contextmanager, lru_cache — is one)
}
export function buildClass(name, bases, members, annotations, opts = {}) {
  const cls = function (...args) {
    if (cls._pyNew) return cls._pyNew(...args);   // a class that answers calls itself (enum lookup)
    // a metaclass with its own __call__ decides what calling the class does
    const meta = cls.__adderMeta__;
    if (meta) { const call = meta.prototype.__call__; if (typeof call === 'function') return call.call(cls, ...args); }
    return typeCall(cls, args);
  };

  cls.prototype = {};
  cls._pyName = name;
  cls._pyClass = true;
  cls._pyBases = (bases || []).filter(b => b?._pyClass && b !== pyObjectObj);   // object is every class's implicit root
  // `class X(list): …` — instances must BE Arrays so native list methods dispatch
  cls._pyListBase = (bases || []).some(b => b && (b._pyContainerType === 'list' || b._pyListBase));
  // `class X(str): …` — instances are boxed strings (see _StrBoxProto)
  cls._pyStrBase = (bases || []).some(b => b && (b === _stableTypes.str || b._pyStrBase));
  if (cls._pyStrBase) Object.setPrototypeOf(cls.prototype, _StrBoxRoot);
  // a list subclass's instances are arrays with the class's prototype (over Array's): its own
  // __getitem__ / __len__ / methods are what the generic paths find
  if (cls._pyListBase) Object.setPrototypeOf(cls.prototype, Array.prototype);
  if (opts.meta) cls.__adderMeta__ = opts.meta;

  const mro = computeMRO(cls);
  cls._pyMRO = mro;

  // Inherit methods from MRO
  const enumMixin = cls._pyStrBase && mro.some((c) => c && c._stEnumBase);
  for (let i = mro.length - 1; i >= 1; i--) {
    const base = mro[i];
    if (!base.prototype || !base._pyOwnMembers) continue;
    // str's dunders are a box's: only a real str subclass takes them (StrEnum's MRO names str too)
    if (base === _stableTypes.str && !cls._pyStrBase) continue;
    for (const key of base._pyOwnMembers) {
      // `class Color(str, Enum)`: Enum's repr / str / format win over str's (as CPython's EnumType sees to)
      if (base === _stableTypes.str && enumMixin && (key === '__repr__' || key === '__str__' || key === '__format__')) continue;
      const desc = Object.getOwnPropertyDescriptor(base.prototype, key);
      if (desc) Object.defineProperty(cls.prototype, key, desc);
    }
  }

  for (const [mName, value] of Object.entries(members)) {
    if (mName === '__new__' && typeof (value && value.__staticmethod__ ? value.fn : value) === 'function') {
      // __new__ is implicitly static: called as __new__(cls, *args)
      const fn = value.__staticmethod__ ? value.fn : value;
      cls._pyNewFn = fn;
      cls.__new__ = fn;
    } else if (_isDescriptor(value)) {
      // the descriptor protocol: reads go through __get__(instance, owner) (owner-level reads
      // through __get__(None, owner)); with __set__ / __delete__ it's a data descriptor and writes
      // go through it, else an instance attribute of the same name shadows it, as in Python
      const d = value;
      const data = typeof d.__set__ === 'function' || typeof d.__delete__ === 'function';
      const shadow = function (v) { Object.defineProperty(this, mName, { value: v, writable: true, enumerable: true, configurable: true }); };
      const dataSet = function (v) { if (typeof d.__set__ !== 'function') throw new AdderError('AttributeError', `can't set attribute '${mName}'`); return d.__set__(this, v); };
      // the tree-walker's assignment calls this itself, so an async __set__ is awaited (a JS setter's
      // return value is dropped) — the same hook @property setters use
      dataSet._pyFset = (o, v) => dataSet.call(o, v);
      Object.defineProperty(cls.prototype, mName, {
        get() { return d.__get__(this, typeOf(this)); },
        set: data ? dataSet : shadow,
        configurable: true, enumerable: false,
      });
      Object.defineProperty(cls, mName, { get() { return d.__get__(null, this); }, set: shadow, configurable: true, enumerable: true });
      (cls._pyAttrs || (cls._pyAttrs = new Set())).add(mName);
    } else if (value && value.__property__) {
      const fget = value.fget;
      const fset = value.fset;
      const desc = { get() { return fget(this); }, configurable: true, enumerable: true };
      if (fset) {
        const setFn = function(v) { fset(this, v); };
        setFn._pyFset = fset;
        desc.set = setFn;
      }
      Object.defineProperty(cls.prototype, mName, desc);
    } else if (value && value.__staticmethod__) {
      const rawFn = value.fn;
      const sm = (...args) => rawFn(...args);
      sm._pyName = `${name}.${mName}`;
      cls.prototype[mName] = sm;
      cls[mName] = sm;
    } else if (value && value.__classmethod__) {
      // bound to the class it's called on: an instance's own class, a subclass when inherited
      const fn = value.fn, qual = `${name}.${mName}`;
      const cm = function (...args) { return fn(this.__adderType__ || cls, ...args); };
      cm._pyName = qual;
      cls.prototype[mName] = cm;
      Object.defineProperty(cls, mName, _classMethodDescriptor(fn, qual));
    } else if (_isMethodFn(value, opts)) {
      const originalFn = value;
      cls.prototype[mName] = function (...args) { return originalFn(this, ...args); };
      cls.prototype[mName]._pyName = `${name}.${mName}`;
      cls.prototype[mName].__func__ = originalFn;          // the def itself (inspect, abstract methods)
      if (originalFn.__isabstractmethod__) cls.prototype[mName].__isabstractmethod__ = true;
      // Python unbound-method access (`ClassName.method(instance, ...)`).
      // Arrow form so adderGetAttr's `.bind(obj)` doesn't pin `this` to
      // the class.
      cls[mName] = (...args) => originalFn(...args);
      // `Cls.method` is the plain function: its name, signature, docstring, abstractness
      Object.assign(cls[mName], { _pyName: originalFn._pyName || mName, _pyDef: true, _pySig: originalFn._pySig, __doc__: originalFn.__doc__ ?? null });
      if (originalFn.__isabstractmethod__) cls[mName].__isabstractmethod__ = true;
    }
  }

  // class variables (instances read them through the class: no per-instance copies); a class
  // nested in the body is a class variable too, not a method
  for (const [k, v] of Object.entries(members)) {
    if (k === '__new__') continue;
    if (!_isMethodFn(v, opts) && !(v && (v.__property__ || v.__staticmethod__ || v.__classmethod__)) && !_isDescriptor(v)) {
      setClassAttr(cls, k, v);
    }
  }

  // Inherit class-level members from MRO bases (as descriptors: an inherited classmethod binds
  // to this class). Furthest first so closer bases win; keys this class owns are kept.
  for (let i = mro.length - 1; i >= 1; i--) {
    const base = mro[i];
    if (!base._pyOwnMembers) continue;
    for (const key of base._pyOwnMembers) {
      // the class body's own members win; a closer base overrides a farther one (furthest first)
      if (Object.hasOwn(members, key)) continue;
      const d = Object.getOwnPropertyDescriptor(base, key);
      if (d && (d.get || typeof d.value === 'function')) Object.defineProperty(cls, key, d);
    }
  }

  cls._pyOwnMembers = new PySet();
  for (const [mName, value] of Object.entries(members)) {
    if (mName === '__new__') continue;
    if (_isMethodFn(value, opts) || (value && (value.__property__ || value.__staticmethod__ || value.__classmethod__)) || _isDescriptor(value)) {
      cls._pyOwnMembers.add(mName);
    }
  }

  // a metaclass's dunders answer for the class itself (len(Cls), iter(Cls), Cls[k], …) where the
  // class doesn't define the name for its instances
  if (opts.meta) {
    for (const m of opts.meta._pyMRO || [opts.meta]) {
      if (m === pyTypeObj || !m.prototype) continue;
      for (const key of Object.getOwnPropertyNames(m.prototype)) {
        if (!/^__\w+__$/.test(key) || key === '__init__' || key === '__call__' || key === '__new__' || key in cls) continue;
        const d = Object.getOwnPropertyDescriptor(m.prototype, key);
        if (typeof d.value === 'function') { const f = d.value; cls[key] = (...a) => f.call(cls, ...a); }
      }
    }
  }

  if (opts.beforeFinish) opts.beforeFinish(cls);
  if (_pendingClassCell && _pendingClassCell.name === name) { const p = _pendingClassCell; _pendingClassCell = null; p.fn(cls); }
  // __set_name__(owner, name) on each member that has one (descriptors learn their attribute
  // name), before __init_subclass__ — CPython's order
  const named = [];
  for (const [k, v] of Object.entries(members)) {
    if (v !== null && typeof v === 'object' && typeof v.__set_name__ === 'function') {
      const r = v.__set_name__(cls, k);
      if (r && typeof r.then === 'function') named.push(r);
    }
  }
  const finish = () => finishClass(cls, annotations || [], opts.kw);
  // the main program's classes, by name: how pickle (and anything else that names a class by
  // module + qualname) finds one defined in '__main__', which has no module object to import
  if (members.__module__ === '__main__') _mainClasses.set(String(members.__qualname__ || name), cls);
  return named.length ? Promise.all(named).then(finish) : finish();
}
const _mainClasses = new Map();
export function mainClassLookup(name) { return _mainClasses.get(name); }
// a Python descriptor: an instance (of a Python class, or a JS-built one marked _pyDescriptor)
// with __get__ — not a function, container or the engine's own property / method wrappers
function _isDescriptor(v) {
  return v !== null && typeof v === 'object' && typeof v.__get__ === 'function' && !Array.isArray(v) &&
    !(v instanceof Map) && !(v instanceof Set) && !v.__property__ && (!!v.__adderType__ || v._pyDescriptor === true);
}

// A class statement whose metaclass is not `type` hands the namespace to the metaclass; the
// statement's `__class__` cell binder rides here until type.__new__ builds the class.
let _pendingClassCell = null;

// `class Name(*bases, **kw): body` — both engines. Picks the metaclass (an explicit
// metaclass=, else the most derived of the bases' — CPython's rule), and either builds the class
// directly (plain `type`) or calls Meta(name, bases, namespace, **kw).
export function classStatement(name, bases, members, annotations, kwObj, opts = {}) {
  const kw = {};
  let explicit = null;
  if (kwObj) for (const [k, v] of Object.entries(kwObj)) { if (k === '_kw') continue; if (k === 'metaclass') explicit = v; else kw[k] = v; }
  const kwOrNull = Object.keys(kw).length ? kw : null;
  // a metaclass that's a plain callable (not a class) is just called
  if (explicit && !(explicit._pyClass)) {
    const ns = new PyDict(Object.entries(members));
    Object.defineProperty(ns, '_pyBody', { value: true });
    if (annotations && annotations.length) ns.set('__annotations__', new PyDict(annotations));
    return explicit(name, mkTuple(bases), ns, ...(kwOrNull ? [{ _kw: true, ...kwOrNull }] : []));
  }
  const meta = _winningMeta(explicit || pyTypeObj, bases);
  if (meta === pyTypeObj) return buildClass(name, bases, members, annotations, { ...opts, kw: kwOrNull, pyBody: true });
  const ns = new PyDict(Object.entries(members));
  Object.defineProperty(ns, '_pyBody', { value: true });   // a Python class body: only its Python functions are methods
  if (annotations && annotations.length) ns.set('__annotations__', new PyDict(annotations));
  // `__class__` (zero-argument super()) is bound when the metaclass builds the class — or, if the
  // metaclass is async (tree-walked) and the build happens after this returns, once it arrives
  const bind = opts.beforeFinish;
  let bound = false;
  _pendingClassCell = bind ? { name, fn: (c) => { bound = true; bind(c); } } : null;
  let r;
  try {
    r = meta(name, mkTuple(bases), ns, ...(kwOrNull ? [{ _kw: true, ...kwOrNull }] : []));
  } finally { _pendingClassCell = null; }
  if (bind && !bound) return _thenMaybe(r, (c) => { if (!bound && c && c._pyClass) bind(c); return c; });
  return r;
}

// the metaclass a class gets: the most derived of `start` and its bases' metaclasses (CPython's rule)
function _winningMeta(start, bases) {
  let meta = start;
  for (const b of bases) {
    if (typeof b !== 'function' || !b._pyClass) continue;
    const bm = b.__adderMeta__ || pyTypeObj;
    if (_isSubclass(bm, meta)) meta = bm;
    else if (!_isSubclass(meta, bm)) throw new AdderError('TypeError', 'metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases');
  }
  return meta;
}

// type.__new__(mcs, name, bases, namespace, **kw)
export function typeNew(mcs, name, bases, ns, ...rest) {
  const kw = rest.length && rest[rest.length - 1] && rest[rest.length - 1]._kw ? (({ _kw, ...o }) => o)(rest.pop()) : null;
  const members = ns instanceof Map ? Object.fromEntries(ns) : { ...(ns || {}) };
  let ann = [];
  if (members.__annotations__ instanceof Map) { ann = [...members.__annotations__]; delete members.__annotations__; }
  const bl = bases === undefined || bases === null ? [] : [...pyIter(bases)];
  return buildClass(String(name), bl, members, ann, {
    pyBody: !!(ns && ns._pyBody),
    meta: mcs && mcs !== pyTypeObj ? mcs : null,
    kw: kw && Object.keys(kw).length ? kw : null,
  });
}

// `type`: the class of classes. type(x) is x's class; type(name, bases, ns) makes a class;
// `class Meta(type)` makes a metaclass. One object for the whole program (it used to be made
// afresh per builtins table, so `type(x) is type` failed across modules).
export const pyTypeObj = function (...args) {   // (no JS name: `type` trips the TS-aware parser @gcu/build uses)
  const kw = args.length && args[args.length - 1] && args[args.length - 1]._kw ? args.pop() : null;
  if (args.length === 1 && !kw) return typeOf(args[0]);
  if (args.length === 3) {
    // type(name, bases, ns) with a base whose metaclass is more derived: that metaclass builds it
    const meta = _winningMeta(pyTypeObj, [...pyIter(args[1])]);
    if (meta !== pyTypeObj) return meta(...args, ...(kw ? [kw] : []));
    return typeNew(pyTypeObj, ...args, ...(kw ? [kw] : []));
  }
  throw new AdderError('TypeError', 'type() takes 1 or 3 arguments');
};
// `object`: the root class. object() is a bare instance (a sentinel: `_MISSING = object()`); it is
// every class's implicit base, so it is never stored in _pyBases — __mro__ / __bases__ show it.
export const pyObjectObj = function object() {
  const o = Object.create(pyObjectObj.prototype);
  o.__adderClass__ = 'object';
  o.__adderType__ = pyObjectObj;
  return o;
};
pyObjectObj._pyName = 'object'; pyObjectObj.__name__ = 'object'; pyObjectObj._pyClass = true;
pyObjectObj.prototype = {};
pyObjectObj._pyMRO = [pyObjectObj];
pyObjectObj._pyOwnMembers = new PySet();
_typeObjects.object = pyObjectObj;
for (const k of ['__init__', '__setattr__', '__delattr__', '__getattribute__', '__eq__', '__ne__', '__hash__', '__repr__', '__str__', '__format__', '__dir__', '__sizeof__', '__reduce__', '__reduce_ex__', '__getstate__']) {
  const f = (self, ...a) => _objectDunder(self, k)(...a);
  f._pyName = k;
  pyObjectObj[k] = f;
}
pyObjectObj.__new__ = (c, ...a) => objectNew(c);
pyObjectObj.__init_subclass__ = () => null;
pyObjectObj.__subclasshook__ = () => NotImplemented;

pyTypeObj._pyName = 'type'; pyTypeObj.__name__ = 'type'; pyTypeObj._pyClass = true;
pyTypeObj.prototype = {
  __init__() { return null; },
  __call__(...a) { return typeCall(this, a); },
};
pyTypeObj._pyMRO = [pyTypeObj];
pyTypeObj._pyOwnMembers = new PySet();
pyTypeObj._pyNewFn = typeNew;
pyTypeObj.__new__ = typeNew;
_typeObjects.type = pyTypeObj;

// X.__new__ when X's MRO defines none. A user class gets object.__new__ (a bare instance; a
// list-based class a list). A builtin type gives a plain value for itself; for a subclass, a
// tuple is made as the subclass (namedtuple-style `tuple.__new__(cls, items)`), the others
// stay plain values until subclassed builtins are boxed (see the str-subclass design note).
function _inheritedNew(T) {
  if (T._pyMRO || T === pyObjectObj) {
    const f = (c, ...a) => objectNew(c);
    f._pyName = '__new__';
    return f;
  }
  const f = (c, ...a) => {
    if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
    if (T === _stableTypes.str && c && c !== T && c._pyStrBase) return objectNew(c, a);
    if (T._pyName === 'tuple' && c && c !== T) {
      const t = new PyTuple();
      for (const x of a.length ? pyIter(a[0]) : []) t.push(x);
      t.__adderType__ = c; t.__adderClass__ = c._pyName;
      return t;
    }
    return T(...a);
  };
  f._pyName = '__new__';
  return f;
}
const _OBJECT_DUNDER_SET = new Set(_OBJECT_DUNDERS);
// object's own methods, bound to a Python instance
function _objectDunder(o, attr) {
  switch (attr) {
    case '__init__': return () => null;
    case '__new__': return (c) => objectNew(c);
    case '__setattr__': return (k, v) => { o[k] = v; return null; };   // object's: a plain store (it bypasses a frozen dataclass's guard, as in CPython)
    case '__delattr__': return (k) => { if (!(k in o)) throw new AdderError('AttributeError', `'${pyTypeName(o)}' object has no attribute '${k}'`); delete o[k]; return null; };
    case '__getattribute__': return (k) => _plainGetAttr(o, k);
    case '__eq__': return (x) => (x === o ? true : NotImplemented);
    case '__ne__': return (x) => (x === o ? false : NotImplemented);
    case '__lt__': case '__le__': case '__gt__': case '__ge__': return () => NotImplemented;
    case '__hash__': return () => _pyHash(o);
    case '__repr__': return () => pyRepr(o);
    case '__str__': return () => pyStr(o);
    case '__format__': return (spec) => { if (spec) throw new AdderError('TypeError', `unsupported format string passed to ${pyTypeName(o)}.__format__`); return pyStr(o); };
    case '__dir__': return () => _pyDir(o);
    case '__sizeof__': return () => 32;
    case '__init_subclass__': return () => null;
    case '__subclasshook__': return () => NotImplemented;
    case '__getstate__': return () => null;
    case '__reduce__': case '__reduce_ex__': return () => { throw new AdderError('TypeError', `cannot pickle '${pyTypeName(o)}' object`); };
    case '__doc__': return null;
    default: return undefined;
  }
}

// fn.__code__: what a code object says about a Python function — its name, file and first line
// (ply orders lexer rules by co_firstlineno), its arguments and flags. No bytecode: co_code is
// empty. One object per function (a set of code objects keeps working).
const _codeObjects = new WeakMap();
function _codeObject(fn) {
  let c = _codeObjects.get(fn);
  if (c) return c;
  const sig = fn._pySig;
  const pos = (sig.params || []).map((p) => p.name);
  const kwonly = (sig.kwonly || []).map((p) => p.name);
  const varnames = [...pos, ...kwonly, ...(sig.vararg ? [sig.vararg.name || sig.vararg] : []), ...(sig.kwarg ? [sig.kwarg.name || sig.kwarg] : [])];
  const gen = fn._isGenerator || /GeneratorFunction$/.test((fn.constructor && fn.constructor.name) || '');
  const flags = 0x3 | (sig.vararg ? 0x4 : 0) | (sig.kwarg ? 0x8 : 0) | (gen ? 0x20 : 0) | (sig.isAsync ? 0x80 : 0);
  const name = fn._pyName || fn.__name__ || fn.name || '<lambda>';
  c = {
    __adderClass__: 'code', co_name: name, co_qualname: fn.__qualname__ || name,
    co_filename: sig.file || '<string>', co_firstlineno: sig.line || 0,
    co_argcount: pos.length, co_posonlyargcount: (sig.params || []).filter((p) => p.kind === 'POSITIONAL_ONLY').length,
    co_kwonlyargcount: kwonly.length, co_nlocals: varnames.length, co_varnames: mkTuple(varnames),
    co_flags: flags, co_code: new Uint8Array(0), co_consts: mkTuple([]), co_names: mkTuple([]),
    co_freevars: mkTuple([]), co_cellvars: mkTuple([]), co_stacksize: 0, co_lnotab: new Uint8Array(0),
    __repr__() { return `<code object ${name} at 0x${(0x7f0000000000 + (_pyHash(this) & 0xffffff)).toString(16)}, file "${this.co_filename}", line ${this.co_firstlineno}>`; },
  };
  _codeObjects.set(fn, c);
  return c;
}

// e.__traceback__: a chain of traceback objects (outermost first, tb_next going in), one per
// Python frame the error passed through — from the call stack the engine recorded when it was
// raised (name and line; no live frames: f_globals / f_locals are empty). Built once per error;
// with_traceback(tb) replaces it.
export function _tracebackOf(e) {
  if (e === null || typeof e !== 'object') return null;
  if (e._pyTb !== undefined) return e._pyTb;
  const frames = e._traceback && e._traceback.length ? e._traceback : [{ name: '<module>', line: e.adderLine || 0 }];
  let next = null, inner = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    const line = f.line || 0;
    const code = { __adderClass__: 'code', co_name: f.name || '<module>', co_qualname: f.name || '<module>', co_filename: f.file || '<string>', co_firstlineno: line };
    const frame = { __adderClass__: 'frame', f_code: code, f_lineno: line, f_lasti: 0, f_globals: new PyDict(), f_locals: new PyDict(), f_builtins: new PyDict(), f_back: null, clear() { return null; } };
    if (inner) inner.f_back = frame;
    inner = frame;
    next = { __adderClass__: 'traceback', tb_frame: frame, tb_lineno: line, tb_lasti: 0, tb_next: next };
  }
  Object.defineProperty(e, '_pyTb', { value: next, writable: true, configurable: true, enumerable: false });
  return next;
}

// type(x)
export function typeOf(obj) {
  if (obj !== null && obj !== undefined && obj.__adderType__) return obj.__adderType__;
  if (typeof obj === 'function' && obj._pyClass) return obj.__adderMeta__ || pyTypeObj;
  const name = pyTypeName(obj);
  if (!_typeObjects[name]) {
    const t = () => { throw new AdderError('TypeError', `cannot create '${name}' instances`); };
    t._pyName = name; t._pyClass = true; t.__name__ = name;
    _typeObjects[name] = t;
  }
  return _typeObjects[name];
}

// a metaclass's members, looked up on a class it built (after the class's own): methods bind to
// the class, properties read with it
export function metaAttr(cls, attr) {
  const meta = cls.__adderMeta__;
  if (!meta) return undefined;
  for (const m of meta._pyMRO || [meta]) {
    if (m === pyTypeObj || !m.prototype) continue;
    const d = Object.getOwnPropertyDescriptor(m.prototype, attr);
    if (!d) continue;
    if (d.get) return d.get.call(cls);
    if (typeof d.value === 'function') return (...a) => d.value.call(cls, ...a);
    return d.value;
  }
  return undefined;
}

export function finishClass(cls, annotations, kw) {
  if (annotations && annotations.length) {
    const d = new PyDict();
    for (const [k, t] of annotations) d.set(k, t);
    cls.__annotations__ = d;
  }
  const mro = cls._pyMRO || [cls];
  for (let i = 1; i < mro.length; i++) {
    const hook = mro[i].__init_subclass__;
    if (typeof hook === 'function') {
      const r = kw ? hook(cls, { _kw: true, ...kw }) : hook(cls);
      return r && typeof r.then === 'function' ? r.then(() => cls) : cls;
    }
  }
  if (kw) throw new AdderError('TypeError', `${cls._pyName}.__init_subclass__() takes no keyword arguments`);
  return cls;
}

// ── builtins ──

// ── importlib / __import__ ──
// The import machinery lives in eval.js (it runs module code); it registers itself here at init,
// so `importlib.import_module`, `__import__` and the import statement share one algorithm.
const _imp = { find: null, importModule: null, resolveRelative: null };
export function _registerImportMachinery(m) { Object.assign(_imp, m); }
const _kwOf = (args) => (args.length && args[args.length - 1] && args[args.length - 1]._kw ? args.pop() : {});
const _PackageNotFoundError = makeExcType('PackageNotFoundError', 'ModuleNotFoundError');
// importlib.resources.files(pkg): the package's directory, as a VFS-backed pathlib.Path
async function _resourceFiles(anchor) {
  const mod = typeof anchor === 'string' ? await _imp.importModule(anchor) : anchor;
  const file = mod && mod.__file__;
  if (!file || !_vfsPath) throw new AdderError('TypeError', `cannot locate resources for ${pyRepr(anchor)}`);
  return adderModules.pathlib.Path(_vfsPath.dirname(file));
}
adderModules.importlib = {
  __adderModule__: true, __name__: 'importlib',
  // import_module(name, package=None): the module itself (the leaf of a dotted name)
  import_module: (name, ...args) => {
    const kw = _kwOf(args);
    const pkg = args.length ? args[0] : kw.package;
    const abs = String(name).startsWith('.') ? _imp.resolveRelative(name, pkg || null) : name;
    return _loadedModule(abs) || _imp.importModule(abs);
  },
  reload: async (mod) => {
    const name = mod && mod.__name__;
    if (!name) throw new AdderError('TypeError', 'reload() argument must be a module');
    delete adderModules.sys.modules[name];
    return _imp.importModule(name);
  },
  invalidate_caches: () => null,
  util: {
    __adderModule__: true, __name__: 'importlib.util',
    // a spec when the module can be found, else None (it is imported to find out)
    find_spec: async (name) => {
      try { const m = await _imp.find(name); return m ? (m.__spec__ || { __adderClass__: 'ModuleSpec', name, origin: m.__file__ || null }) : null; }
      catch (e) { if (e && e.pyType === 'ModuleNotFoundError') return null; throw e; }
    },
    resolve_name: (name, pkg) => _imp.resolveRelative(name, pkg),
  },
  metadata: {
    __adderModule__: true, __name__: 'importlib.metadata',
    // no installed-distribution metadata in the VFS: every lookup says so, as for an uninstalled package
    version: (dist) => { throw new AdderError('PackageNotFoundError', `No package metadata was found for ${dist}`); },
    metadata: (dist) => { throw new AdderError('PackageNotFoundError', `No package metadata was found for ${dist}`); },
    PackageNotFoundError: _PackageNotFoundError,
    entry_points: () => [],
  },
  resources: {
    __adderModule__: true, __name__: 'importlib.resources',
    files: _resourceFiles,
    read_text: async (pkg, resource) => (await _resourceFiles(pkg)).joinpath(resource).read_text(),
    read_binary: async (pkg, resource) => (await _resourceFiles(pkg)).joinpath(resource).read_bytes(),
  },
};
// __import__(name, globals=None, locals=None, fromlist=(), level=0): the top-level package,
// unless a fromlist is given — then the module named
// a module already loaded (sys.modules, or one of adder's own): importing it needs no wait, so
// __import__ / import_module answer synchronously — code that can't wait (a lazy descriptor's
// __get__, six.moves) imports what's there
function _loadedModule(n) {
  const m = _sysModule.modules[n];
  if (m) return m;
  const a = adderModules[n];
  if (a && typeof a === 'object' && a.__adderModule__ && n !== 'js') { _sysModule.modules[n] = a; return a; }   // in sys.modules once imported, as findModule does
  return undefined;
}
function _builtinImport(name, ...args) {
  const kw = _kwOf(args);
  const [globals = kw.globals, , fromlist = kw.fromlist, level = kw.level || 0] = args;
  let abs = name;
  if (level > 0) {
    const pkg = globals && (globals instanceof Map ? globals.get('__package__') : globals.__package__);
    abs = _imp.resolveRelative('.'.repeat(level) + name, pkg || null);
  }
  const have = _loadedModule(abs);
  if (have) {
    if ((fromlist && fromlist.length) || !abs.includes('.')) return have;
    const top = _loadedModule(abs.split('.')[0]);
    if (top) return top;
  }
  return (async () => {
    const mod = await _imp.importModule(abs);
    if (fromlist && fromlist.length) return mod;
    return abs.includes('.') ? _imp.importModule(abs.split('.')[0]) : mod;
  })();
}

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
      { const f = subclassDunder(obj, '__len__'); if (f) return f.call(obj); }
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
    // a tree-walked __index__ is async: resolve the arguments first, then build the range
    range: (...a) => {
      const vals = a.map((v) => (v !== null && typeof v === 'object' && !v._kw && typeof v.__index__ === 'function' ? v.__index__() : v));
      return vals.some(_isThenable) ? Promise.all(vals).then((r) => new AdderRange(...r)) : new AdderRange(...vals);
    },
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
    // str(x); str(b, encoding[, errors]) decodes bytes
    str: (x, ...a) => {
      if (x === undefined) return '';
      const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {};
      const enc = a[0] ?? kw.encoding, errors = a[1] ?? kw.errors;
      if (enc !== undefined || errors !== undefined) {
        if (!(x instanceof Uint8Array)) throw new AdderError('TypeError', 'decoding str is not supported');
        return pyDecode(x, enc ?? 'utf-8', errors ?? 'strict');
      }
      return pyStrMaybe(x);
    },
    // (a tree-walked __bool__ / __len__ answers with a Promise: judge what it resolves to)
    bool: (x) => {
      if (x === undefined) return false;
      if (x !== null && typeof x === 'object') {
        if (typeof x.__bool__ === 'function') return _thenMaybe(x.__bool__(), (v) => !!v);
        if (typeof x.__len__ === 'function') return _thenMaybe(x.__len__(), (v) => v !== 0);
      }
      return pyBool(x);
    },
    list: Object.assign(
      (x) => x === undefined ? [] : pyCollectMaybe(x),
      { _pyContainerType: 'list' },
    ),
    // a call with no argument answers synchronously, so defaultdict(list) & co. store a value
    tuple: (x) => (x === undefined ? mkTuple([]) : x instanceof PyTuple ? x : _thenMaybe(pyCollectMaybe(x), mkTuple)),
    dict: (...args) => (args.length === 0 ? new PyDict() : _dictFrom(args)),
    set: (x) => x === undefined ? new PySet() : _thenMaybe(pyCollectMaybe(x), (xs) => new PySet(xs)),
    // bytes(): b'', bytes(n) zeros, bytes(ints), bytes(str, encoding)
    bytes: (x, encoding) => {
      if (x === undefined) return new Uint8Array(0);
      if (typeof x === 'number') return new Uint8Array(x);
      if (typeof x === 'string') {
        if (encoding && encoding._kw) encoding = encoding.encoding;
        if (encoding === undefined) throw new AdderError('TypeError', 'string argument without an encoding');
        return pyEncode(x, encoding);
      }
      if (x instanceof Uint8Array) return new Uint8Array(x);
      if (x instanceof PyMemoryView) return x.tobytes();
      if (x !== null && typeof x === 'object' && typeof x.__bytes__ === 'function') return x.__bytes__();
      const items = [...pyIter(x)];   // sync: AIR calls bytes() without an await
      for (const v of items) if (!Number.isInteger(v) || v < 0 || v > 255) throw new AdderError('ValueError', 'bytes must be in range(0, 256)');
      return Uint8Array.from(items);
    },
    memoryview: Object.assign((obj) => new PyMemoryView(obj), { _pyName: 'memoryview', __name__: 'memoryview', _pyClass: true }),
    // bytearray(), bytearray(n) zeros, bytearray(ints / bytes), bytearray(str, encoding[, errors])
    bytearray: Object.assign((x, ...a) => {
      const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {};
      if (x === undefined) return new PyByteArray();
      if (typeof x === 'number') { if (x < 0) throw new AdderError('ValueError', 'negative count'); return _toBA(new Uint8Array(x)); }
      if (typeof x === 'string') {
        const enc = a[0] ?? kw.encoding;
        if (enc === undefined) throw new AdderError('TypeError', 'string argument without an encoding');
        return _toBA(pyEncode(x, enc, a[1] ?? kw.errors ?? 'strict'));
      }
      if (x instanceof Uint8Array) return _toBA(x);
      return _toBA([...pyIter(x)].map(_byteCheck));
    }, { _pyName: 'bytearray', __name__: 'bytearray', _pyClass: true }),
    frozenset: maybeSync(function* (x) { const s = x === undefined ? new PySet() : new PySet(yield* _gCollect(x)); s._frozen = true; return s; }),
    abs: (x) => (typeof x === 'object' && x !== null && typeof x.__abs__ === 'function') ? x.__abs__() : Math.abs(x),
    round: (x, n) => pyRound(x, n),
    max: (...args) => pyExtreme('max', args),
    min: (...args) => pyExtreme('min', args),
    // sum: numbers with compensated (Neumaier) summation, as CPython 3.12+ does for floats;
    // lists concatenate; anything else through its __add__; strings are refused, as in Python
    sum: maybeSync(function* (iterable, start) {
      if (start && start._kw) start = start.start;
      const items = Array.isArray(iterable) ? iterable : yield* _gCollect(iterable);   // read, never kept: no copy
      let s = start !== undefined ? start : 0;
      if (typeof s === 'string') throw new AdderError('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
      if (_numLike(s)) {
        // one pass; the first non-number abandons it for the general path below, from the start
        let total = Number(s), c = 0, i = 0;
        const n = items.length;
        for (; i < n; i++) {
          const v = items[i];
          const x = typeof v === 'number' ? v : _numLike(v) ? Number(v) : NaN;
          if (x !== x && !(typeof v === 'number')) break;
          const t = total + x;
          c += Math.abs(total) >= Math.abs(x) ? (total - t) + x : (x - t) + total;
          total = t;
        }
        if (i === n) return total + c;
      }
      for (const v of items) {
        if (Array.isArray(s) && Array.isArray(v)) s = s.concat(v);
        else if (_hasDunder(s, '__add__')) s = yield s.__add__(v);
        else if (_hasDunder(v, '__radd__')) s = yield v.__radd__(s);
        else if (_numLike(s) && _numLike(v)) s = s + v;
        else throw new AdderError('TypeError', `unsupported operand type(s) for +: '${pyTypeName(s)}' and '${pyTypeName(v)}'`);
      }
      return s;
    }),
    sorted: maybeSync(function* (iterable, key, reverse) {
      if (key?._kw) { reverse = key.reverse; key = key.key; }
      else if (reverse?._kw) reverse = reverse.reverse;
      return yield* _gSorted(yield* _gCollect(iterable), key || null, !!reverse);
    }),
    reversed: maybeSync(function* (iterable) { const arr = yield* _gCollect(iterable); arr.reverse(); return arr; }),
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
    any: maybeSync(function* (iterable) { let r = false; yield* _gForEach(iterable, (v) => (r = pyBool(v))); return r; }),
    all: maybeSync(function* (iterable) { let r = true; yield* _gForEach(iterable, (v) => !(r = pyBool(v))); return r; }),
    isinstance: (obj, typeOrTuple) => _pyIsInstance(obj, typeOrTuple),
    type: pyTypeObj,
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
    callable: (obj) => typeof obj === 'function' || (obj !== null && typeof obj === 'object' && typeof obj.__call__ === 'function'),
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
    // iter(x): an iterator is its own (a generator — the tree-walker's are async — map, filter …);
    // an object with __iter__ gives what that returns; the rest iterate as JS sequences
    iter: (obj) => {
      if (obj !== null && typeof obj === 'object' && typeof obj[Symbol.asyncIterator] === 'function' && (typeof obj.__next__ === 'function' || typeof obj.next === 'function')) return obj;
      if (isUserIterable(obj) && typeof obj.__iter__ === 'function') return obj.__iter__();
      return pyIter(obj);
    },
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
      if (c._jsClass && t && t._jsClass && c._jsClass.prototype instanceof t._jsClass) return true;   // JS-backed types (datetime ⊂ date)
      // an ABC's own say (a registered virtual subclass, a __subclasshook__)
      if (t && t._pyClass && t._pyMRO) {
        let sc = null;
        try { sc = adderGetAttr(t, '__subclasscheck__'); } catch { sc = null; }
        if (typeof sc === 'function') { const r = sc(c); if (r === true) return true; }
      }
      return false;
    },
    vars: (obj) => (obj === undefined ? new PyDict() : adderGetAttr(obj, '__dict__')),
    dir: (obj) => _pyDir(obj),
    object: pyObjectObj,
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
    __import__: _builtinImport,
    // compile(source, filename, mode): a code object exec() / eval() run (parsed when they do)
    compile: (source, filename = '<string>', mode = 'exec', ...a) => {
      if (filename && filename._kw) { const kw = filename; filename = kw.filename ?? '<string>'; mode = kw.mode ?? mode; }
      if (!['exec', 'eval', 'single'].includes(mode)) throw new AdderError('ValueError', "compile() mode must be 'exec', 'eval' or 'single'");
      const src = source instanceof Uint8Array ? new TextDecoder().decode(source) : source && typeof source._pySource === 'string' ? source._pySource : String(source);
      return { __adderClass__: 'code', _pySource: src, _pyMode: mode, co_filename: String(filename), co_name: '<module>', co_qualname: '<module>',
        co_firstlineno: 1, co_argcount: 0, co_posonlyargcount: 0, co_kwonlyargcount: 0, co_flags: 0, co_varnames: mkTuple([]), co_names: mkTuple([]),
        co_consts: mkTuple([]), co_code: new Uint8Array(0),
        __repr__() { return `<code object <module> at 0x7f00000000, file "${this.co_filename}", line 1>`; } };
    },
    eval: _builtinEval,
    exec: _builtinExec,
    super: _builtinSuper,
    globals: _builtinGlobals,
    locals: _builtinLocals,
  };
  // Mark conversion builtins as type objects for isinstance()/type()
  // ONE object per type for the whole program: every module gets its own builtins table, and a
  // fresh `int` per table made `type(1) is int` false in a module once another had been imported
  for (const name of ['int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set', 'range', 'object', 'complex', 'bytes', 'frozenset', 'bytearray']) {
    if (_stableTypes[name]) { builtins[name] = _stableTypes[name]; continue; }
    if (builtins[name]) { builtins[name]._pyName = name; builtins[name]._pyClass = true; builtins[name].__name__ = name; _typeObjects[name] = _stableTypes[name] = builtins[name]; }
    if (name === 'str' && builtins.str) { builtins.str.prototype = _StrBoxProto; builtins.str._pyOwnMembers = new PySet(Object.keys(_StrBoxProto)); }
  }
  for (const name of _EXC_NAMES) {
    if (_stableTypes[name]) { builtins[name] = _stableTypes[name]; continue; }
    if (_typeObjects[name] && _typeObjects[name]._pyClass) { builtins[name] = _stableTypes[name] = _typeObjects[name]; continue; }
    const ctor = (...a) => {
      if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
      return new AdderError(name, _argsStr(name, a), undefined, a);
    };
    ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name;
    builtins[name] = ctor;
    _typeObjects[name] = _stableTypes[name] = ctor;
  }
  // and the builtin functions too: `len` is one object everywhere (a module's table, the builtins
  // module, a pickle naming builtins.len). Only print is per table — it writes to its run's output.
  if (!_stableBuiltins) _stableBuiltins = { ...builtins };
  else for (const k of Object.keys(builtins)) if (k !== 'print' && Object.hasOwn(_stableBuiltins, k)) builtins[k] = _stableBuiltins[k];
  return builtins;
}
let _stableBuiltins = null;

// super(): the next class after `cls` in self's MRO, as a proxy whose attributes are bound to
// self. Both engines use it (the tree-walker finds cls and self in the method's scope; AIR
// passes them). A builtin exception base supplies __init__ (it keeps the args, as
// BaseException does) and __str__; `object` supplies a no-op __init__.
// super() — `cls` the class whose method is running (its __class__ cell), `self` the method's first
// argument. As in CPython the search runs along the MRO of self's type (not cls's own MRO — in a
// diamond, B's super() from a D instance is C, not A), starting after cls:
//   self a class that is a subclass of cls (a classmethod, __new__, __init_subclass__): its own MRO,
//     class-level members bound to self;
//   self an instance — of a class, or a class that is an instance of a metaclass: its type's MRO,
//     prototype members bound to self.
export function pySuper(cls, self) {
  const isClass = typeof self === 'function' && self._pyClass;
  const viaClass = isClass && self._pyMRO && self._pyMRO.includes(cls);
  const owner = viaClass ? self : isClass ? (self.__adderMeta__ || pyTypeObj) : (self && self.__adderType__);
  let mro = owner && owner._pyMRO;
  if (!mro || !mro.includes(cls)) mro = (cls && cls._pyMRO) || [cls];
  const start = mro.indexOf(cls) + 1;
  const bindProto = (d) => {
    if (d.get) return d.get.call(self);
    if (typeof d.value === 'function') return (...a) => d.value.call(self, ...a);
    return d.value;
  };
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
        if (!base) continue;
        // a builtin base (str, tuple …): its __new__ makes the subclass's instance
        if (name === '__new__' && base._pyClass && !base._pyMRO && base !== pyObjectObj && base !== pyTypeObj && !isBuiltinExcType(base)) return _inheritedNew(base);
        // list / tuple / dict / set under a subclass: the builtin's methods and dunders, on self
        if (base._pyClass && !base._pyMRO && self && (Array.isArray(self) || self instanceof Map || self instanceof Set) && ['list', 'tuple', 'dict', 'set', 'frozenset'].includes(base._pyName)) {
          if (name === '__init__') return (...a) => {
            if (a.length && a[a.length - 1] && a[a.length - 1]._kw) a.pop();
            if (Array.isArray(self) && a.length) { self.length = 0; for (const v of pyIter(a[0])) self.push(v); }
            return null;
          };
          const d = _VALUE_DUNDERS.has(name) ? _valueDunder(self, name) : null;
          if (d) return d;
          try { return Array.isArray(self) ? _listMethod(self, name) : self instanceof Map ? _mapMethod(self, name) : _setMethod(self, name); } catch { continue; }
        }
        // str under a str subclass: its dunders and methods, on the box's value
        if (base === _stableTypes.str && self && typeof self._pyStrValue === 'string') {
          if (Object.hasOwn(_StrBoxProto, name)) return _StrBoxProto[name].bind(self);
          try { return _boxStrMethod(self, name); } catch { continue; }
        }
        // __new__ is static: the function itself, called with the class explicitly
        if (name === '__new__') { if (Object.hasOwn(base, '_pyNewFn')) return base._pyNewFn; continue; }
        if (viaClass) {
          const sd = Object.getOwnPropertyDescriptor(base, name);
          if (sd && sd.get) return sd.get.call(self);                 // a classmethod, bound to self
          if (sd && typeof sd.value === 'function' && base._pyOwnMembers && base._pyOwnMembers.has(name)) return sd.value;
        }
        if (!base.prototype) continue;
        const desc = Object.getOwnPropertyDescriptor(base.prototype, name);
        if (desc && (!viaClass || base === pyTypeObj)) return bindProto(desc);
      }
      // object's defaults
      if (name === '__init__') return () => null;
      if (name === '__new__') return (c, ...a) => objectNew(c);
      if (name === '__init_subclass__') return (...a) => {
        const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : null;
        if (kw && Object.keys(kw).some((k) => k !== '_kw')) throw new AdderError('TypeError', 'object.__init_subclass__() takes no keyword arguments');
        return null;
      };
      // the rest of object's (super().__getattribute__(name), super().__setattr__(k, v) …)
      if (_OBJECT_DUNDER_SET.has(name) && self && typeof self === 'object') return _objectDunder(self, name);
      return undefined;
    },
    has(_, name) { return this.get(_, name) !== undefined; },
  });
}

// Sentinel functions for eval/exec/super — handled specially by the evaluator
export const _builtinEval = Object.assign(() => {}, { _pyName: 'eval', _sentinel: 'eval' });
export const _builtinExec = Object.assign(() => {}, { _pyName: 'exec', _sentinel: 'exec' });
export const _builtinSuper = Object.assign(() => {}, { _pyName: 'super', _sentinel: 'super' });
// globals() / locals(): the caller's namespaces, which only the tree-walker has (AIR lowering
// refuses them, so the module falls back)
export const _builtinGlobals = Object.assign(() => {}, { _pyName: 'globals', _sentinel: 'globals' });
export const _builtinLocals = Object.assign(() => {}, { _pyName: 'locals', _sentinel: 'locals' });

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
        // a class is an instance of its metaclass (and of everything in the metaclass's MRO)
        if (typeof obj === 'function' && obj._pyClass && obj.__adderMeta__ && _isSubclass(obj.__adderMeta__, t)) return true;
        // walk MRO of the object's adder type
        const objType = obj?.__adderType__;
        if (objType?._pyMRO) {
          for (const mroClass of objType._pyMRO) {
            if (mroClass === t || mroClass._pyName === t._pyName) return true;
          }
        }
        // walk exception parent chain
        if (obj instanceof AdderError && _excChain(obj.pyType).includes(t._pyName)) return true;
        // a JS-backed type (datetime is a date): its JS class's inheritance
        if (t._jsClass && obj !== null && typeof obj === 'object' && obj instanceof t._jsClass) return true;
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

// re.error: an exception type, so `except re.error` catches what compile() raises (3.13: PatternError)
_reModule.error = makeExcType('re.error', 'Exception');
_reModule.PatternError = _reModule.error;
