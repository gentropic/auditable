// adder transpile runtime — Python semantics helpers called from AIR-emitted JS.
// Small monomorphic functions that V8 inlines. Reuses builtins.js internals.

import {
  AdderError, adderModules, AdderRange, Complex, mkSlice, PySlice, seqSliceSet, pyInplace,
  pyBool, pyTypeName, pyStr, pyRepr, pyIter, pyCollect, pyCollectMaybe, pyFormatValue,
  adderGetAttr, pyEq, pyNe, pyLt, pyLe, pyGt, pyGe, pySuper, PyCell, ctxEnter, ctxExit, pyAIter, excToThrowable,
  pyAdd, pyIAddBuiltin, pySub, pyMul, pyTrueDiv, pyFloorDiv, pyMod, pyPow, pyAnd, pyOr, pyXor, pyLshift, pyRshift, pyMatmul,
  pyNeg, pyPos, pyInvert, pyGetItem, pyRangeSlice, bytesLit, dictLiteral,
  PyTuple, PyDict, PySet, mkTuple, isPlainDict, finishClass, syncOf, NEEDS_ASYNC, genProto, closeJsGenerator, storeAttr, pyDelItem, pyDelAttr, setClassAttr, excStack, pyMatch, _pyEach, isUserIterable, pyIterAsync, excValue, excMatches, excTypeOf, initExceptionInstance,
  buildClass, classStatement, asCallable, awaitTarget, PyByteArray, AttrDict, subclassDunder, MODULE_REBIND, sliceBound, pyFloatBin, intNorm,
} from './builtins.js';
import { _loadDirectModule, _tickLine, _importRoot, importModule, importNames, importNamesNow, resolveRelativeImport } from './eval.js';

// ── Arithmetic (preserve Python semantics) ──

// In-place add used by `+=`. Python semantics: try __iadd__ first; if the
// LHS is a mutable container (list, set), extend it in-place; otherwise
// fall through to _add (creates a new value, caller rebinds via the
// surrounding assignment). Always returns the value to rebind.
function _iadd(a, b) {
  if (typeof a === 'number' && typeof b === 'number') { const r = a + b; if (r <= 9007199254740991 && r >= -9007199254740991) return r; return pyAdd(a, b); }
  if (a !== null && typeof a === 'object' && typeof a.__iadd__ === 'function') {
    return a.__iadd__(b);
  }
  // a list extends in place; anything else (a tuple too) rebinds to a + b
  return pyIAddBuiltin(a, b);
}

// ── Comparison ──

function _contains(container, value) {
  if (typeof container === 'string') return container.includes(String(value));
  { const f = subclassDunder(container, '__contains__'); if (f) return f.call(container, value); }
  if (Array.isArray(container)) return container.some(v => _eq(v, value));
  if (container instanceof Map) return container.has(value);
  if (container instanceof Set) return container.has(value);
  if (container instanceof AdderRange) return container.includes(value);
  if (container !== null && (typeof container === 'object' || typeof container === 'function' && typeof container.__contains__ === 'function')) {
    if (typeof container.__contains__ === 'function') return container.__contains__(value);
    return value in container;
  }
  throw new AdderError('TypeError', `argument of type '${pyTypeName(container)}' is not iterable`);
}

// ── Subscript ──

// 2D ndarray-shape tuple subscript — accepts any object with
// `data: Float64Array` + `shape: [n, m]`. Returns scalar / row /
// column / sub-matrix depending on the key shape. Used by both
// `_py.getitem` and `_py.setitem` so libraries (learn, scitra) that
// return `{data, shape}` are subscriptable with tuple keys without
// each one having to ship its own `__getitem__`.
function _ndarrayTupleGet(obj, key) {
  const [n, m] = obj.shape;
  const d = _ndarrayData(obj);
  const rk = key[0], ck = key[1];
  // scalar + scalar → value
  if (typeof rk === 'number' && typeof ck === 'number') {
    const i = rk < 0 ? n + rk : rk;
    const j = ck < 0 ? m + ck : ck;
    return d[i * m + j];
  }
  // scalar row + slice col → row vector (m or sub)
  if (typeof rk === 'number' && rk._slice == null && ck && ck._slice) {
    const i = rk < 0 ? n + rk : rk;
    const lo = ck.lower != null ? ck.lower : 0;
    const hi = ck.upper != null ? Math.min(ck.upper, m) : m;
    const out = new Float64Array(hi - lo);
    for (let k = 0; k < hi - lo; k++) out[k] = d[i * m + lo + k];
    out.shape = [out.length];
    return out;
  }
  // slice row + scalar col → column vector
  if (rk && rk._slice && typeof ck === 'number') {
    const lo = rk.lower != null ? rk.lower : 0;
    const hi = rk.upper != null ? Math.min(rk.upper, n) : n;
    const j = ck < 0 ? m + ck : ck;
    const out = new Float64Array(hi - lo);
    for (let i = 0; i < hi - lo; i++) out[i] = d[(lo + i) * m + j];
    out.shape = [out.length];
    return out;
  }
  // slice + slice → 2D sub-matrix
  if (rk && rk._slice && ck && ck._slice) {
    const r0 = rk.lower != null ? rk.lower : 0;
    const r1 = rk.upper != null ? Math.min(rk.upper, n) : n;
    const c0 = ck.lower != null ? ck.lower : 0;
    const c1 = ck.upper != null ? Math.min(ck.upper, m) : m;
    const rows = r1 - r0;
    const cols = c1 - c0;
    const out = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) out[i * cols + j] = d[(r0 + i) * m + (c0 + j)];
    }
    out.shape = [rows, cols];
    return out;
  }
  throw new AdderError('TypeError', `ndarray: unsupported tuple subscript shape`);
}

function _looksLikeNdarray(obj) {
  if (!obj || !Array.isArray(obj.shape) || obj.shape.length !== 2) return false;
  if (obj.data instanceof Float64Array) return true;
  // learn's transformers return a Float64Array directly with `.shape`
  // tacked on as an own property — no wrapping object.
  if (obj instanceof Float64Array) return true;
  return false;
}

function _ndarrayData(obj) {
  return obj instanceof Float64Array ? obj : obj.data;
}

function _getitem(obj, key) {
  // the hot case: a list or tuple at an in-range non-negative int (a user list subclass with its
  // own __getitem__ goes the long way)
  if (Array.isArray(obj) && typeof key === 'number' && key >= 0 && key < obj.length && (key | 0) === key &&
      typeof obj.__getitem__ !== 'function') return obj[key];
  if (obj === null || obj === undefined) {
    throw new AdderError('TypeError', `'NoneType' object is not subscriptable`);
  }
  // 2D ndarray with tuple subscript — handle natively so libraries
  // returning `{data: Float64Array, shape: [n, m]}` (learn's transform
  // outputs, etc.) support `x[i, j]` / `x[:, 0]` without needing their
  // own __getitem__.
  if (Array.isArray(key) && _looksLikeNdarray(obj)) {
    return _ndarrayTupleGet(obj, key);
  }
  return pyGetItem(obj, key);
}

function _setitem(obj, key, value) {
  if (obj instanceof PyTuple) throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support item assignment`);
  // (a user __setitem__'s result is returned: a Promise when it is async, which the store waits for)
  { const f = subclassDunder(obj, '__setitem__'); if (f) return f.call(obj, key, value); }
  if (obj instanceof Map) { obj.set(key, value); return; }
  if (Array.isArray(obj)) {
    if (key instanceof PySlice) { seqSliceSet(obj, key, value); return; }
    obj[(typeof key === 'number' && key >= 0 && key < obj.length && (key | 0) === key) ? key : seqStoreIndex(obj, key)] = value;
    return;
  }
  // 2D ndarray with tuple key (`x_trans[:, 1] = 0.0`). Mirrors the
  // getitem path — accepts `{data: Float64Array, shape}` wrappers and
  // bare Float64Arrays-with-shape. Value can be a scalar (broadcast)
  // or an iterable (must match the assigned slice length).
  if (Array.isArray(key) && _looksLikeNdarray(obj)) {
    _ndarrayTupleSet(obj, key, value);
    return;
  }
  if (typeof obj === 'object' && obj !== null) {
    if (typeof obj.__setitem__ === 'function') return obj.__setitem__(key, value);
    obj[key] = value;
    return;
  }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support item assignment`);
}

function _ndarrayTupleSet(obj, key, value) {
  const [n, m] = obj.shape;
  const d = _ndarrayData(obj);
  const rk = key[0], ck = key[1];
  const _broadcast = (write, len) => {
    if (value != null && typeof value !== 'string'
        && typeof value[Symbol.iterator] === 'function') {
      const flat = [...value];
      if (flat.length !== len) {
        throw new AdderError('ValueError', `cannot broadcast ${flat.length} values to ${len} positions`);
      }
      for (let i = 0; i < len; i++) write(i, flat[i]);
    } else {
      for (let i = 0; i < len; i++) write(i, value);
    }
  };

  // scalar + scalar — single cell
  if (typeof rk === 'number' && typeof ck === 'number') {
    const i = rk < 0 ? n + rk : rk;
    const j = ck < 0 ? m + ck : ck;
    d[i * m + j] = value;
    return;
  }
  // slice row + scalar col → column slice
  if (rk && rk._slice && typeof ck === 'number') {
    const lo = rk.lower != null ? rk.lower : 0;
    const hi = rk.upper != null ? Math.min(rk.upper, n) : n;
    const j = ck < 0 ? m + ck : ck;
    _broadcast((i, v) => { d[(lo + i) * m + j] = v; }, hi - lo);
    return;
  }
  // scalar row + slice col → row slice
  if (typeof rk === 'number' && ck && ck._slice) {
    const i = rk < 0 ? n + rk : rk;
    const lo = ck.lower != null ? ck.lower : 0;
    const hi = ck.upper != null ? Math.min(ck.upper, m) : m;
    _broadcast((k, v) => { d[i * m + lo + k] = v; }, hi - lo);
    return;
  }
  // slice + slice → 2D sub-block
  if (rk && rk._slice && ck && ck._slice) {
    const r0 = rk.lower != null ? rk.lower : 0;
    const r1 = rk.upper != null ? Math.min(rk.upper, n) : n;
    const c0 = ck.lower != null ? ck.lower : 0;
    const c1 = ck.upper != null ? Math.min(ck.upper, m) : m;
    const rows = r1 - r0, cols = c1 - c0;
    // Scalar value → fill block
    if (value == null || typeof value === 'number'
        || typeof value === 'string'
        || typeof value[Symbol.iterator] !== 'function') {
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) d[(r0 + i) * m + (c0 + j)] = value;
      }
      return;
    }
    throw new AdderError('TypeError', 'ndarray block assignment from iterable not yet supported');
  }
  throw new AdderError('TypeError', `ndarray: unsupported tuple subscript shape`);
}

function _slice(obj, lower, upper, step) {
  if (obj instanceof AdderRange) return pyRangeSlice(obj, lower, upper, step);   // (exact, any size)
  const rawStep = step;   // (a __getitem__ is handed the slice as written: step None when omitted)
  step = step ?? 1;
  if (step == 0) throw new AdderError('ValueError', 'slice step cannot be zero'); // eslint-disable-line eqeqeq
  if (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Uint8Array) {
    lower = sliceBound(lower); upper = sliceBound(upper); step = sliceBound(step);
    const len = obj.length;
    if (step === 1) {
      const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
      const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
      return obj instanceof PyTuple ? mkTuple(obj.slice(l, u)) : obj instanceof PyByteArray ? PyByteArray.from(obj.slice(l, u)) : obj.slice(l, u);
    }
    const positive = step > 0;
    let l = lower == null ? (positive ? 0 : len - 1) : lower < 0 ? Math.max(positive ? 0 : -1, len + lower) : Math.min(lower, positive ? len : len - 1);
    let u = upper == null ? (positive ? len : -1) : upper < 0 ? Math.max(positive ? 0 : -1, len + upper) : Math.min(upper, positive ? len : len - 1);
    const result = [];
    if (positive) { for (let i = l; i < u; i += step) result.push(obj[i]); }
    else { for (let i = l; i > u; i += step) result.push(obj[i]); }
    return typeof obj === 'string' ? result.join('') : obj instanceof PyTuple ? mkTuple(result)
      : obj instanceof Uint8Array ? Uint8Array.from(result) : obj instanceof PyByteArray ? PyByteArray.from(result) : result;
  }
  if (typeof obj?.__getitem__ === 'function') {
    return obj.__getitem__(mkSlice(lower, upper, rawStep));
  }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object is not subscriptable`);
}

function _rtSliceIndices(len, lower, upper, step) {
  let start, stop;
  if (step > 0) {
    start = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    stop = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
  } else {
    start = lower == null ? len - 1 : lower < 0 ? Math.max(-1, len + lower) : Math.min(lower, len - 1);
    stop = upper == null ? -1 : upper < 0 ? Math.max(-1, len + upper) : upper;
  }
  const out = [];
  if (step > 0) { for (let i = start; i < stop; i += step) out.push(i); }
  else { for (let i = start; i > stop; i += step) out.push(i); }
  return out;
}

function _setslice(obj, lower, upper, step, value) {
  if (typeof obj === 'string') {
    throw new AdderError('TypeError', "'str' object does not support item assignment");
  }
  if (obj instanceof Uint8Array) {
    throw new AdderError('TypeError', "'bytes' object does not support item assignment");
  }
  if (typeof obj?.__setitem__ === 'function') {
    return obj.__setitem__(mkSlice(lower, upper, step), value);
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support slice assignment`);
  }
  const rhs = [...pyIter(value)];
  lower = sliceBound(lower); upper = sliceBound(upper);
  const effectiveStep = sliceBound(step ?? 1);
  if (effectiveStep === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  if (effectiveStep === 1) {
    const len = obj.length;
    const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
    const removeCount = Math.max(0, u - l);
    obj.splice(l, removeCount, ...rhs);
    return;
  }
  const indices = _rtSliceIndices(obj.length, lower, upper, effectiveStep);
  if (rhs.length !== indices.length) {
    throw new AdderError(
      'ValueError',
      `attempt to assign sequence of size ${rhs.length} to extended slice of size ${indices.length}`,
    );
  }
  for (let k = 0; k < indices.length; k++) obj[indices[k]] = rhs[k];
}

function _delslice(obj, lower, upper, step) {
  if (typeof obj === 'string') {
    throw new AdderError('TypeError', "'str' object doesn't support item deletion");
  }
  if (obj instanceof Uint8Array) {
    throw new AdderError('TypeError', "'bytes' object doesn't support item deletion");
  }
  if (typeof obj?.__delitem__ === 'function') {
    return obj.__delitem__(mkSlice(lower, upper, step));
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object doesn't support slice deletion`);
  }
  lower = sliceBound(lower); upper = sliceBound(upper);
  const effectiveStep = sliceBound(step ?? 1);
  if (effectiveStep === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  if (effectiveStep === 1) {
    const len = obj.length;
    const l = lower == null ? 0 : lower < 0 ? Math.max(0, len + lower) : Math.min(lower, len);
    const u = upper == null ? len : upper < 0 ? Math.max(0, len + upper) : Math.min(upper, len);
    if (u > l) obj.splice(l, u - l);
    return;
  }
  const indices = _rtSliceIndices(obj.length, lower, upper, effectiveStep);
  indices.sort((a, b) => b - a);
  for (const i of indices) obj.splice(i, 1);
}

// ── Method-call PIC (polymorphic inline cache) ──
//
// `obj.method(args)` in adder lowers to `await _py.callMethod(obj, name,
// $pic[k], ...args)`: the k-th call site of the compiled unit (a module, a
// cell, an exec'd string) passes its own slot from the table the unit makes
// when it runs (`const $pic = _py.pics(n)`). The helper keeps a tiny
// (type → unbound_method) cache in the slot. On hit, skip adderGetAttr's
// type-dispatch chain entirely and skip the bound-method closure allocation.
// Slots numbered per unit keep the emitted code independent of what was
// compiled before it (a compiled module can be cached and reused), and a
// unit's slots go when it does.
//
// Slot layout: { name, types, vers, methods, next } — arrays of length
// 0..PIC_SIZE. FIFO eviction once full so a 5-way polymorphic site
// (e.g. richards' task-table) cycles instead of going megamorphic.
//
// Class-instance fast path only. Primitives (string, array, Map, …) and
// modules fall through to adderGetAttr because their per-type method
// tables (`_strMethod`, `_listMethod`, etc.) build a fresh closure per
// call — caching one would alias the receiver across instances. The
// adderGetAttr slow path already returns the right closure for these.
//
// An entry holds while its type's version (_pyVer, bumped whenever the class or a base changes —
// a method patched, deleted, __bases__ reassigned: builtins.js classMemberChanged) is the one it
// was cached at, and the instance doesn't shadow the name with its own attribute.

const _PIC_SIZE = 4;
// a compiled unit's call-site slots
function _pics(n) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = { name: null, types: [], vers: [], methods: [], next: 0 };
  return a;
}
// record t → its method for the site (a type seen again — its version moved on — is updated in place).
// Only a method a Python class in t's MRO defines: on a dict / list / set subclass, one it inherits
// from the builtin is the JS base's prototype method (Map's get, Array's pop) — not dict.get's or
// list.pop's Python semantics, which the slow path's lookup gives
function _picStore(c, t, obj, name) {
  if (t === undefined || !t.prototype || typeof t.prototype[name] !== 'function' || Object.hasOwn(obj, name)) return;
  if (!t._pyMRO || !t._pyMRO.some((k) => k._pyOwnMembers && k._pyOwnMembers.has(name))) return;
  if (c.name !== name) { c.name = name; c.types.length = 0; c.vers.length = 0; c.methods.length = 0; c.next = 0; }
  let idx = c.types.indexOf(t);
  if (idx < 0) {
    if (c.types.length < _PIC_SIZE) idx = c.types.length;
    else { idx = c.next; c.next = (idx + 1) % _PIC_SIZE; }   // FIFO: a 5-way polymorphic site cycles
  }
  c.types[idx] = t; c.vers[idx] = t._pyVer; c.methods[idx] = t.prototype[name];
}

// A module's own attribute called (`math.sqrt(x)`, `random.random()`): read straight off the
// module. adderGetAttr ends at the same value for one, after a long dispatch on the receiver's
// type that cost ~130 ns a call — most of a compiled loop's time when it calls a module function.
// (__class__ and __dict__ are computed, not stored.)
function _isModuleAttr(obj, name) {
  return obj !== null && typeof obj === 'object' && obj.__adderModule__ === true &&
    name !== '__class__' && name !== '__dict__' && Object.hasOwn(obj, name);
}
// a module function adderGetAttr hands out as it is (a Python def, a class, one already bound, a
// module of `this`-free functions) — the rest it binds to the module, and a call through .call is
// the same call
function _modPlain(obj, v) {
  return v._pyFunc || v._pyDef || v._pyModBound || v._pyClass || obj._pyRawFns;
}

// Sync function — the underlying method may be sync OR async, and JS
// `return` preserves that polarity. Wrapping this helper in `async`
// would wrap every return in `Promise.resolve()` even when the method
// is sync, paying the Promise allocation on every method call.
// The caller's `await _py.callMethod(...)` handles both shapes.
function _callMethod(obj, name, cache, ...args) {
  // Fast path: scan the cache for a matching __adderType__.
  const t = (obj !== null && obj !== undefined) ? obj.__adderType__ : undefined;
  if (t !== undefined && cache.name === name) {
    const types = cache.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === t && cache.vers[i] === t._pyVer && !Object.hasOwn(obj, name)) { const m = cache.methods[i]; return m._pyCoro === true ? new PyCoroutine(m, obj, args) : m.call(obj, ...args); }
    }
  }
  if (t === undefined && _isModuleAttr(obj, name)) {
    const v = obj[name];   // (read once: a getter runs on every read)
    if (typeof v !== 'function') return pyCallable(v)(...args);
    if (v._pyCoro === true) return new PyCoroutine(v, _modPlain(obj, v) ? undefined : obj, args);
    return _modPlain(obj, v) ? v(...args) : v.call(obj, ...args);
  }
  // Slow path: full adderGetAttr lookup + call.
  const fn = pyCallable(adderGetAttr(obj, name));
  const result = fn(...args);

  // Populate the cache for class-instance receivers. We cache the
  // wrapper on `t.prototype[name]` (a non-_pyFunc function whose `this`
  // gets bound to the receiver at call time via `.call(obj, ...)`).
  // Skip caching for primitives / dicts / modules — adderGetAttr there
  // returns receiver-bound closures whose identity changes per call.
  _picStore(cache, t, obj, name);
  return result;
}

// a method call from code that can't wait (sync mode): the method's sync twin when it has one —
// the same lookup and inline cache as _callMethod
function _callMethodSync(obj, name, cache, ...args) {
  const t = (obj !== null && obj !== undefined) ? obj.__adderType__ : undefined;
  if (t !== undefined && cache.name === name) {
    const types = cache.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === t && cache.vers[i] === t._pyVer && !Object.hasOwn(obj, name)) { const m = cache.methods[i]; return m._pyCoro === true ? new PyCoroutine(m, obj, args) : syncOf(m).call(obj, ...args); }
    }
  }
  if (t === undefined && _isModuleAttr(obj, name)) {
    const v = obj[name];
    if (typeof v !== 'function') return _fnOfSync(v)(...args);
    if (v._pyCoro === true) return new PyCoroutine(v, _modPlain(obj, v) ? undefined : obj, args);
    return _modPlain(obj, v) ? syncOf(v)(...args) : syncOf(v).call(obj, ...args);
  }
  const result = _fnOfSync(adderGetAttr(obj, name))(...args);
  _picStore(cache, t, obj, name);
  return result;
}
// a value called from sync mode: a function's twin, a class's synchronous construction, an
// object's __call__ twin
function _fnOfSync(x) {
  if (typeof x === 'function') return x._pyCoro === true ? lazyCoro(x) : syncOf(x);
  if (x !== null && typeof x === 'object') {
    const c = x.__call__;
    if (typeof c === 'function' && c._pySync) { const s = syncOf(c); return (...a) => s.call(x, ...a); }
  }
  return asCallable(x);
}

// yield from x (PEP 380) in compiled code: delegation through x's Python methods — next() while
// None is sent, send() otherwise, throw() for a thrown exception, close() on GeneratorExit — and
// the result is its StopIteration's value. A compiled generator, a list or a string is handed to
// JS yield* as it is (native delegation is exactly this for them); anything else gets both a
// sync and an async reading, and yield* takes the one its generator can use.
const _isJsGen = (v) => { const t = Object.prototype.toString.call(v); return t === '[object Generator]' || t === '[object AsyncGenerator]'; };
const _stopVal = (e) => (e.value !== undefined ? e.value : e.args && e.args.length ? e.args[0] : null);
const _isGenExit = (e) => !!e && (e.pyType === 'GeneratorExit' || (excValue(e) && excValue(e).pyType === 'GeneratorExit'));
function* _pep380Sync(x) {
  const B = adderModules.builtins;
  // (an instance's __iter__ through its sync twin: the compiled one may be async — ChainMap's,
  // read by _collections_abc's KeysView.__iter__ `yield from self._mapping`)
  let it = x !== null && typeof x === 'object' && x.__adderType__ !== undefined && typeof x.__iter__ === 'function'
    ? syncOf(x.__iter__).call(x) : B.iter(x);
  if (it !== null && typeof it === 'object' && typeof it.then === 'function') throw NEEDS_ASYNC;
  // (read synchronously: a compiled iterator's methods through their sync twins)
  const method = (n) => { try { return syncOf(adderGetAttr(it, n)); } catch (e) { if (e && e.pyType === 'AttributeError') return null; throw e; } };
  const nextOf = () => { const nx = it !== null && typeof it === 'object' && typeof it.__next__ === 'function' ? method('__next__') : null; return nx ? nx() : B.next(it); };
  let y;
  try { y = nextOf(); } catch (e) { if (e && e.pyType === 'StopIteration') return _stopVal(e); throw e; }
  for (;;) {
    let sent, thrown = null;
    try { sent = yield y; } catch (e) { thrown = e; }
    try {
      if (thrown !== null) {
        if (_isGenExit(thrown)) { const c = method('close'); if (typeof c === 'function') c(); throw thrown; }
        const th = method('throw');
        if (typeof th !== 'function') throw thrown;
        y = th(excValue(thrown));
      } else if (sent === null || sent === undefined) y = nextOf();
      else { const sd = method('send'); if (typeof sd !== 'function') throw new AdderError('AttributeError', `'${pyTypeName(it)}' object has no attribute 'send'`); y = sd(sent); }
    } catch (e) {
      if (e && e.pyType === 'StopIteration' && e !== thrown) return _stopVal(e);
      throw e;
    }
  }
}
async function* _pep380Async(x) {
  const B = adderModules.builtins;
  const it = await B.iter(x);
  const method = (n) => { try { return adderGetAttr(it, n); } catch (e) { if (e && e.pyType === 'AttributeError') return null; throw e; } };
  let y;
  try { y = await B.next(it); } catch (e) { if (e && e.pyType === 'StopIteration') return _stopVal(e); throw e; }
  for (;;) {
    let sent, thrown = null;
    try { sent = yield y; } catch (e) { thrown = e; }
    try {
      if (thrown !== null) {
        if (_isGenExit(thrown)) { const c = method('close'); if (typeof c === 'function') await c(); throw thrown; }
        const th = method('throw');
        if (typeof th !== 'function') throw thrown;
        y = await th(excValue(thrown));
      } else if (sent === null || sent === undefined) y = await B.next(it);
      else { const sd = method('send'); if (typeof sd !== 'function') throw new AdderError('AttributeError', `'${pyTypeName(it)}' object has no attribute 'send'`); y = await sd(sent); }
    } catch (e) {
      if (e && e.pyType === 'StopIteration' && e !== thrown) return _stopVal(e);
      throw e;
    }
  }
}
function _yieldFromOf(x) {
  if (Array.isArray(x) || typeof x === 'string' || _isJsGen(x)) return x;
  return { [Symbol.iterator]: () => _pep380Sync(x), [Symbol.asyncIterator]: () => _pep380Async(x) };
}

// ── Context manager __exit__ ──

// Called by `with` lowering. When the body completes normally, `exc` is
// null and __exit__ is called with (None, None, None); the return value
// is ignored. When the body raised, `exc` is the error and __exit__ is
// called with (type, exc, None); a truthy return value indicates the
// exception is suppressed (the lowerer checks and only re-raises on
// falsy). __exit__ may be async — we must AWAIT it so the lowered call
// site's `await _py.exitWith(...)` actually waits for side effects
// (e.g. a file open(..., "w") that flushes to the VFS on close).
// Synchronous when __exit__ is; a Promise only when __exit__ returns one (a file closing a write
// handle awaits the VFS) — the lowered call site awaits it, except in sync mode, where a Promise
// suppression flag would be truthy and swallow the exception.
function _exitWith(mgr, exc, isAsync) { return ctxExit(mgr, exc, !!isAsync); }

// ── Attribute access ──

function _getattr(obj, name) {
  return adderGetAttr(obj, name);
}

// obj.name = value from sync mode: a class's own __setattr__ through its twin; one that would have
// to wait gives up (the call falls back to the async function)
function _setattrSync(obj, name, value) {
  if (obj !== null && typeof obj === 'object' && obj.__adderType__ !== undefined && typeof obj.__setattr__ === 'function' && !Object.hasOwn(obj, '__setattr__')) {
    const r = syncOf(obj.__setattr__).call(obj, name, value);
    if (r !== null && r !== undefined && typeof r.then === 'function') throw NEEDS_ASYNC;
    return r;
  }
  return _setattr(obj, name, value);
}
function _setattr(obj, name, value) {
  // typeof check accepts both 'object' (instances) and 'function' (adder
  // classes — class-attribute assignment patterns like
  // `Strength.REQUIRED = Strength(0)` deltablue uses for module-level
  // singletons set after the class body has evaluated).
  if (obj !== null && (typeof obj === 'object' || typeof obj === 'function')) {
    return storeAttr(obj, name, value);
  }
}

// sync mode (air-lower AWAITED_DUNDERS): where Python calls code implicitly — a property, a
// descriptor, len(), hash() — nothing can wait, so a possibly-async value is taken as it is.
// A Promise passes through, the way CPython hands back a coroutine object from a property that
// calls an `async def` (`await obj.prop` then works); it is not awaited here.
function _noAwait(v) { return v; }

// globals() / locals() in compiled code (air-lower: _callsScopeBuiltin)
function _mainModule() { return { __adderModule__: true, __name__: '__main__' }; }
const _globalsViews = new WeakMap();
function _globalsOf(mod) {   // one live view per module: globals() is globals()
  let d = _globalsViews.get(mod);
  if (!d) { d = new AttrDict(mod); _globalsViews.set(mod, d); }
  return d;
}
// a module-level name, read through the module object: what globals() set wins over the
// compiled binding (and a builtin is the binding when the module has no such name)
// a compiled module installs its write-back (builtins.js MODULE_REBIND) on its module object
// (names: the ones it rebinds — an exec namespace that is a plain object watches those)
function _moduleRebind(mod, fn, names) { fn._pyNames = names; Object.defineProperty(mod, MODULE_REBIND, { value: fn, configurable: true }); }
// a value written over a name the module's code calls directly (a module-level def, an unshadowed
// builtin): it must be a function there — mock.patch's MagicMock is an object with __call__ —
// answering synchronously when it can (its twin). sync: some call site of the name doesn't wait
// (compiled when the name was a provably sync def): a value that can only answer later (an async
// function with no twin — a tree-walked one) raises there instead of handing it a Promise
function _rebindCallable(v, name, sync) {
  // (deleted: a call raises NameError, as reading the name does in CPython)
  if (v === undefined) return () => { throw new AdderError('NameError', `name '${name}' is not defined`); };
  if (v === null) return v;
  const f = _fnOfSync(v);
  if (!sync || f[Symbol.toStringTag] !== 'AsyncFunction') return f;
  return function (...a) { return _py.needSync(f.apply(this, a)); };
}
function _globalLoad(mod, name, v) { return Object.hasOwn(mod, name) && mod[name] !== undefined ? mod[name] : v; }
// a free name an imported module reads that is no builtin: bound by the importing machinery only
// when something supplies it (a module dunder, a star import, globals()) — otherwise NameError,
// where compiled code would see undefined
function _freeName(v, name) {
  if (v === undefined) throw new AdderError('NameError', `name '${name}' is not defined`);
  return v;
}
// a module-level name read where the module's code can't have bound it yet: the module's own
// attribute (a reload runs the code again in the module — `try: count += 1 except NameError:`),
// else NameError
function _unboundGlobal(mod, name) {
  if (Object.hasOwn(mod, name)) return mod[name];
  throw new AdderError('NameError', `name '${name}' is not defined`);
}
function _localsOf(names, values) {
  const o = {};
  for (let i = 0; i < names.length; i++) if (values[i] !== undefined) o[names[i]] = values[i];
  return o;
}

const _delitem = pyDelItem;
const _delattr = pyDelAttr;

function _makeDict(keys, values) {
  const m = new PyDict();
  for (let i = 0; i < keys.length; i++) m.set(keys[i], values[i]);
  return m;
}

function _makeSet(arr) {
  return new PySet(arr);
}

// ── Imports ──

// the same import algorithm as the tree-walker (eval.js): dotted names load their parents,
// packages search their __path__, `from M import sub` falls back to the submodule M.sub
// (a module already in sys.modules is answered now — see eval.js importNamesNow; the lowered
// `await` on these is a `maybe` one, so code that can't wait can import a loaded module)
function _import(name) {
  return adderModules.sys.modules[name] || importModule(name);
}

async function _importPath(path) {
  const mod = await _loadDirectModule(path);
  if (mod) return mod;
  throw new AdderError('ModuleNotFoundError', `cannot load module from '${path}'`);
}

// names: array of { name, alias } (or "*"); → { boundName: value }
function _importFrom(moduleName, names) {
  // a cell is not in a package: a relative import there raises, as at CPython's top level
  const abs = resolveRelativeImport(moduleName, null);
  return importNamesNow(abs, names) || _importFromAsync(abs, names);
}
async function _importFromAsync(abs, names) {
  const mod = await importModule(abs);
  return Object.fromEntries(await importNames(mod, abs, names));
}

async function _importFromPath(path, names) {
  const mod = await _loadDirectModule(path);
  if (!mod) throw new AdderError('ModuleNotFoundError', `cannot load module from '${path}'`);
  return Object.fromEntries(await importNames(mod, path, names));
}

// ── Class creation ──
// Mirrors _evalClass in eval.js, but takes pre-evaluated bases and members.

// annotations arrive flattened from the lowerer: [name, text, name, text, …]
function _createClass(name, bases, members, annotations, kw, moduleName) {
  // __module__ / __qualname__, as CPython's class namespace starts with them (unless the body set them)
  if (moduleName !== undefined && !Object.hasOwn(members, '__module__')) members.__module__ = moduleName;
  if (!Object.hasOwn(members, '__qualname__')) members.__qualname__ = name;
  const ann = [];
  for (let k = 0; annotations && k < annotations.length; k += 2) ann.push([annotations[k], annotations[k + 1]]);
  return classStatement(name, bases, members, ann, kw);
}

// ── Exception matching (for try/except) ──

// _excParents comes from builtins.js
import { _excParents, seqStoreIndex, PyCoroutine, pyCallable, lazyCoro, pyUnpack, NO_DEFAULT, LiveDefaults } from "./builtins.js";

function _rtMatchException(error, excTypeVal) {
  return excMatches(error, excTypeVal);
}
// ── Unary ──

// ── Bitwise (with dunder fallback) ──
// Lowered from `&`, `|`, `^` between values whose types AIR can't prove
// are ints. Fast-path real ints to native bitwise; fall through to
// __and__/__or__/__xor__ so libraries like sadpan can overload (their
// BooleanMask combines via these). The constant-fold pass in passes.js
// can short-circuit back to native bitwise once both operands are typed.

// ── Function call with kwargs ──

function _call(fn, args, kwargs) {
  if (typeof fn !== 'function') {
    if (fn !== null && typeof fn === 'object' && typeof fn.__call__ === 'function') {
      return fn.__call__(...(args || []));
    }
    throw new AdderError('TypeError', `'${pyTypeName(fn)}' object is not callable`);
  }
  if (fn._pyCoro === true) fn = lazyCoro(fn);
  if (kwargs) {
    const kw = { _kw: true, ...kwargs };
    return fn(...(args || []), kw);
  }
  return fn(...(args || []));
}

const _matchDescs = new Map();

// ── Iteration helpers ──

// Convert any iterable to an array (for for-of compatibility)
function _iterArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (typeof obj === 'string') return obj;  // strings iterate char-by-char in JS for...of
  // an iterator or generator (itertools.count, a generator expression) is read lazily, one item
  // per step, so an infinite one can be broken out of; dicts and sets are snapshotted below
  if (obj && typeof obj.next === 'function' && typeof obj[Symbol.iterator] === 'function') return obj;
  if (obj && typeof obj._maybeNext === 'function') return _maybeIterSync(obj);
  // Async iterables can't be materialised synchronously — return a Promise
  // and let the call site `await` it. Returning a sync iterable on the
  // common path keeps that fast path free of microtasks.
  if (obj && typeof obj[Symbol.asyncIterator] === 'function') {
    return (async () => {
      const out = [];
      for await (const v of obj) out.push(v);
      return out;
    })();
  }
  if (isUserIterable(obj)) return _userIterSync(obj);
  return [...pyIter(obj)];
}
// a maybe-async iterator (map / filter over synchronous sources) read synchronously: lazily while
// its steps are synchronous; when the first one waits, a Promise of the collected items
function _maybeIterSync(obj) {
  const first = obj._maybeNext();
  if (first !== null && typeof first === 'object' && typeof first.then === 'function') {
    return first.then(async (r0) => { const out = []; for (let r = r0; !r.done; r = await obj._maybeNext()) out.push(r.value); return out; });
  }
  return (function* () {
    for (let r = first; ; r = obj._maybeNext()) {
      if (r !== null && typeof r === 'object' && typeof r.then === 'function') throw new AdderError('TypeError', `'${obj.__adderClass__}' object must be collected asynchronously here (list(...) it first)`);
      if (r.done) return;
      yield r.value;
    }
  })();
}
// a user __iter__ / __next__ (or __getitem__) object read synchronously where it can be: stepped
// lazily (an endless iterator can still be broken out of); an async (tree-walked) dunder makes it
// a Promise of the collected items instead, as for the async sources above
function _userIterSync(obj) {
  if (typeof obj.__iter__ !== 'function' && typeof obj.__next__ !== 'function') return pyCollectMaybe(obj);
  // (read synchronously: through their sync twins when they have them)
  const it = typeof obj.__iter__ === 'function' ? syncOf(obj.__iter__).call(obj) : obj;
  if (it !== null && typeof it === 'object' && typeof it.then === 'function') return it.then((x) => pyCollect(x));
  if (Array.isArray(it) || typeof it === 'string') return it;
  if (it !== null && typeof it === 'object' && typeof it.__next__ === 'function' && typeof it[Symbol.iterator] !== 'function') {
    // the first step tells: an async __next__ (a compiled one with an await in it is async on
    // every call) → collect behind a Promise; else step lazily
    const next = syncOf(it.__next__);
    let first;
    try { first = next.call(it); } catch (e) { if (e && e.pyType === 'StopIteration') return []; throw e; }
    if (first !== null && typeof first === 'object' && typeof first.then === 'function') {
      return first.then(async (v0) => {
        const out = [v0];
        for (;;) {
          try { out.push(await it.__next__()); } catch (e) { if (e && e.pyType === 'StopIteration') return out; throw e; }
        }
      }, (e) => { if (e && e.pyType === 'StopIteration') return []; throw e; });
    }
    return (function* () {
      yield first;
      for (;;) {
        let v;
        try { v = next.call(it); } catch (e) { if (e && e.pyType === 'StopIteration') return; throw e; }
        yield v;
      }
    })();
  }
  return _iterArray(it);
}

// ── Exceptions ──

// raise exc [from cause]: the same conversion as the tree-walker (excToThrowable); a class
// whose construction is async cannot be awaited here, so it raises by name without args
function _raise(exc, cause) {
  let err = excToThrowable(exc);
  if (err && typeof err.then === 'function') err = new AdderError((exc && exc._pyName) || 'Exception', '');
  if (arguments.length > 1) {
    const c = cause === null ? null : excValue(excToThrowable(cause));
    err.__cause__ = c;
    if (err.pyValue && typeof err.pyValue === 'object') err.pyValue.__cause__ = c;
  }
  throw err;
}
function _reraise() { throw new AdderError('RuntimeError', 'No active exception to reraise'); }

// ── Argument binding (compiled functions) ──
// The simple path keeps native JS params and calls this only when a call does not fit them
// (keywords, too few, too many); the general path checks with _checkKw / _argError.

const _isKwBag = (v) => v !== null && typeof v === 'object' && v._kw === true;

function _argError(msg) { throw new AdderError('TypeError', msg); }

function _checkKw(fname, names, nPositional, kw, allowExtra) {
  for (const k of Object.keys(kw)) {
    if (k === '_kw') continue;
    const i = names.indexOf(k);
    if (i >= 0 && i < nPositional) _argError(`${fname}() got multiple values for argument '${k}'`);
    if (i < 0 && !allowExtra) _argError(`${fname}() got an unexpected keyword argument '${k}'`);
  }
}

// (defs: the def's live defaults — a parameter given one by `f.__defaults__ = …` after the def)
function _bindArgs(fname, names, args, defs) {
  const a = Array.prototype.slice.call(args);
  while (a.length && a[a.length - 1] === undefined) a.pop();
  const kw = a.length && _isKwBag(a[a.length - 1]) ? a.pop() : null;
  // extra positionals are dropped, not refused: JS calls Python callbacks with more
  // arguments than they declare (Array.map passes index and array)
  if (a.length > names.length) a.length = names.length;
  if (kw) _checkKw(fname, names, a.length, kw, false);
  for (let i = a.length; i < names.length; i++) {
    if (kw && Object.hasOwn(kw, names[i])) a.push(kw[names[i]]);
    else a.push(_dflt(defs, names[i], fname, false));
  }
  return a;
}
// a parameter no argument filled: its default, read from the def's defaults object at call time
// (so `f.__defaults__ = …` / `f.__kwdefaults__[k] = …` made after the def reach the next call)
function _dflt(defs, k, fname, kwonly) {
  if (defs && Object.hasOwn(defs, k)) { const v = defs[k]; if (v !== NO_DEFAULT) return v; }
  return _argError(`${fname}() missing 1 required ${kwonly ? 'keyword-only' : 'positional'} argument: '${k}'`);
}

// assert test, msg → AssertionError (an empty message when there is none, as Python)
function _assertFail(msg) {
  throw new AdderError('AssertionError', msg === undefined ? '' : pyStr(msg));
}

// arithmetic: the shared rules (builtins.js)
// The operators AIR calls per iteration are small wrappers: two numbers take the JS operator, all
// else the full helper. Kept tiny on purpose, so V8 inlines them into the loop — the full helpers
// (dunders, sequences, bytes, errors) are too big to inline, and a call per `s = s + x` costs
// more than the addition (measured: 11 ms → 4 ms over a million items).
// A result past 2**53 takes the full helper too: two ints there are a BigInt (builtins.js intNorm)
const _S = 9007199254740991;
const _add = (a, b) => { if (typeof a === 'number' && typeof b === 'number') { const r = a + b; if (r <= _S && r >= -_S) return r; } return pyAdd(a, b); };
const _sub = (a, b) => { if (typeof a === 'number' && typeof b === 'number') { const r = a - b; if (r <= _S && r >= -_S) return r; } return pySub(a, b); };
const _mul = (a, b) => { if (typeof a === 'number' && typeof b === 'number') { const r = a * b; if (r <= _S && r >= -_S) return r; } return pyMul(a, b); };
const _div = pyTrueDiv, _floordiv = pyFloorDiv, _mod = pyMod, _pow = pyPow;
// an operator with an integer-valued float literal operand: a float op (two numbers: the JS one)
const _fadd = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : pyFloatBin('+', a, b));
const _fsub = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : pyFloatBin('-', a, b));
const _fmul = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : pyFloatBin('*', a, b));
const _fpow = (a, b) => pyFloatBin('**', a, b), _ffloordiv = (a, b) => pyFloatBin('//', a, b), _fmod = (a, b) => pyFloatBin('%', a, b);
const _and_ = pyAnd, _or_ = pyOr, _xor = pyXor, _neg = pyNeg, _pos = pyPos, _invert = pyInvert;
// the in-place operators but +=: two numbers as the plain operator does them (tiny, as above, so
// `t -= x` inlines); anything else CPython's way — __iop__, the builtin mutables in place
const _objOp = (a) => a !== null && typeof a === 'object';
const _isub = (a, b) => { if (typeof a === 'number' && typeof b === 'number') { const r = a - b; if (r <= _S && r >= -_S) return r; } return pyInplace('-', a, b, true); };
const _imul = (a, b) => { if (typeof a === 'number' && typeof b === 'number') { const r = a * b; if (r <= _S && r >= -_S) return r; } return pyInplace('*', a, b, true); };
const _iop = (op, bin) => (a, b) => (_objOp(a) ? pyInplace(op, a, b, true) : bin(a, b));

// comparisons: the shared rules (builtins.js), so both engines compare alike
const _eq = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a === b : pyEq(a, b));
const _lt = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a < b : pyLt(a, b));
const _lte = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a <= b : pyLe(a, b));
const _gt = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a > b : pyGt(a, b));
const _gte = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a >= b : pyGe(a, b));
const _neq = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a !== b : pyNe(a, b));

// ── Export as single namespace ──

export const _py = {
  // arithmetic
  add: _add, sub: _sub, mul: _mul, div: _div,
  fadd: _fadd, fsub: _fsub, fmul: _fmul, fpow: _fpow, ffloordiv: _ffloordiv, fmod: _fmod,
  floordiv: _floordiv, mod: _mod, pow: _pow,
  // in-place: __iadd__ dispatch + list extend semantics for `+=` (async-aware: an __iadd__ may
  // be tree-walked); the other in-place operators through the method's sync twin
  iadd: _iadd,
  isub: _isub, imul: _imul,
  itruediv: _iop('/', pyTrueDiv), ifloordiv: _iop('//', pyFloorDiv), imod: _iop('%', pyMod), ipow: _iop('**', pyPow),
  iand: _iop('&', pyAnd), ior: _iop('|', pyOr), ixor: _iop('^', pyXor), ilshift: _iop('<<', pyLshift),
  irshift: _iop('>>', pyRshift), imatmul: _iop('@', pyMatmul),
  // bitwise (with dunder fallback for masks/sets/etc.)
  and_: _and_, or_: _or_, xor: _xor, lshift: pyLshift, rshift: pyRshift,
  // unary
  neg: _neg, pos: _pos, invert: _invert,
  // comparison
  eq: _eq, neq: _neq, lt: _lt, lte: _lte, gt: _gt, gte: _gte,
  contains: _contains,
  // subscript
  getitem: _getitem, setitem: _setitem, slice: _slice,
  setslice: _setslice, delslice: _delslice,
  // Marker object for slice elements inside a tuple subscript
  // (`arr[i:j, k]` lowers to `getitem(obj, [makeSlice(i,j,null), k])`
  // — the consumer's __getitem__ destructures via `_slice` flag).
  makeSlice: mkSlice,
  // context manager __exit__ (with statement)
  exitWith: _exitWith,
  enterWith: ctxEnter,
  aiter: pyAIter,
  // `from m import *` at a module's top level: its names onto the module object
  starInto: (mod, names) => { for (const k of Object.keys(names)) mod[k] = names[k]; return null; },
  // the defining module's __name__, for a class's __module__ — absent from exec(code, {})'s globals
  // a generator lambda: its generator objects carry the name <lambda>
  genLambda: (f) => { genProto(f, '<lambda>'); return f; },
  // an imaginary literal: 2j
  imag: (y) => new Complex(0, y),
  moduleName: (m) => {
    if (m === null || m === undefined) return undefined;
    if (m instanceof Map) return m.has('__name__') ? m.get('__name__') : undefined;
    try { return m.__name__; } catch { return undefined; }
  },
  // attribute
  getattr: _getattr, setattr: _setattr,
  callMethod: _callMethod,
  pics: _pics,
  noAwait: _noAwait,
  lam: (f, twin) => { f._pyDef = true; if (twin) Object.defineProperty(f, '_pySync', { value: twin, configurable: true, writable: true }); return f; },
  mainModule: _mainModule, globalsOf: _globalsOf, globalLoad: _globalLoad, moduleRebind: _moduleRebind, rebindCallable: _rebindCallable, freeName: _freeName, unboundGlobal: _unboundGlobal, localsOf: _localsOf,
  delitem: _delitem, delattr: _delattr,
  // dict/set construction
  makeDict: _makeDict, makeSet: _makeSet,
  // call
  call: _call,
  // iteration
  iter: _iterArray,
  unpack: pyUnpack,
  // truthiness
  truthy: pyBool,
  // string formatting
  fmt: pyFormatValue,
  str: pyStr,
  repr: pyRepr,
  // exception
  raise: _raise,
  reraise: _reraise,
  excValue,
  matchException: _rtMatchException,
  // imports
  import: _import,
  importPath: _importPath,
  importFrom: _importFrom,
  importFromPath: _importFromPath,
  // class
  createClass: _createClass,
  fnOf: pyCallable,
  fnOfSync: _fnOfSync, callMethodSync: _callMethodSync, syncOf,
  isNone: (v) => v === null || v === undefined,
  yieldFrom: _yieldFromOf,
  genProto,
  // a loop's own iterator, left before it ran out (emit-js release_temp): a generator is closed —
  // GeneratorExit at its yield, so its finally runs now, as when CPython drops the last reference
  releaseIter: (src, it) => {
    if (src !== null && typeof src === 'object' && src.__adderClass__ === 'generator' && typeof src.close === 'function') return src.close();
    if (it !== null && typeof it === 'object' && (Object.prototype.toString.call(it) === '[object Generator]' || Object.prototype.toString.call(it) === '[object AsyncGenerator]')) return closeJsGenerator(it);
    return null;
  },
  // a sync-mode dunder / property: its sync version, falling back to its async one when it gives up
  bailable: (s, a) => {
    const f = function (...args) {
      try { return s.apply(this, args); } catch (e) { if (e === NEEDS_ASYNC) return a.apply(this, args); throw e; }
    };
    Object.defineProperty(f, 'name', { value: s.name, configurable: true });
    return f;
  },
  // a twin's await point: the value, or — when it is a Promise — give up (syncOf falls back)
  setattrSync: _setattrSync,
  // **kwargs: the keyword bag's entries no named parameter took
  kwRest: (kw, used) => { const out = {}; if (kw) for (const k in kw) if (!used.includes(k)) out[k] = kw[k]; return out; },
  needSync: (v) => { if (v !== null && v !== undefined && typeof v.then === "function") throw NEEDS_ASYNC; return v; },
  aw: awaitTarget,
  // a def's metadata (both engines record the same: the tree-walker in eval.js _attachSignature)
  defSig: (fn, shape, defaults, mod = null) => {
    if (typeof fn !== 'function') return null;
    fn._pyDef = true;
    // (defaults: the object the def's calls bind from — assigning __defaults__ rewrites it. One
    // fixed shape, not a spread: a lambda made in a loop pays this per iteration)
    fn._pySig = { params: shape.params, vararg: shape.vararg, kwonly: shape.kwonly, kwarg: shape.kwarg, isAsync: shape.isAsync, line: shape.line,
      defaults, file: mod && typeof mod.__file__ === 'string' ? mod.__file__ : '<string>' };
    fn._pyLiveDefaults = true;
    if (shape.isAsync && !fn._isGenerator && !/GeneratorFunction$/.test((fn.constructor && fn.constructor.name) || '')) fn._pyCoro = true;   // (not an async generator)
    if (mod) Object.defineProperty(fn, '_pyGlobals', { value: _globalsOf(mod), configurable: true });
    let pos = null, kwd = null;
    for (const p of shape.params) if (p.hasDefault) (pos || (pos = [])).push(defaults[p.name]);
    for (const p of shape.kwonly) if (p.hasDefault) (kwd || (kwd = [])).push([p.name, defaults[p.name]]);
    fn.__defaults__ = pos ? mkTuple(pos) : null;
    fn.__kwdefaults__ = kwd ? new LiveDefaults(defaults, kwd) : null;
    return null;
  },
  // the run budget (emitted only when lowering with ticks: true)
  tick: _tickLine,
  // argument binding
  bindArgs: _bindArgs, dflt: _dflt, NO_DEFAULT, checkKw: _checkKw, argError: _argError, isKwBag: _isKwBag,
  assertFail: _assertFail,
  super: pySuper,
  // a class statement's `__class__` cell (see lowerClassDef)
  newCell: () => new PyCell(),
  raiseRuntime: (msg) => { throw new AdderError('RuntimeError', msg); },
  cellGet: (c) => {
    if (c._v === undefined) throw new AdderError('NameError', "cannot access free variable '__class__' where it is not associated with a value in enclosing scope");
    return c._v;
  },
  cellSet: (c, v) => { c._v = v; return null; },
  // zero-argument super(): the method's class, from its cell, and its first argument
  superCell: (c, self) => {
    if (self === undefined) throw new AdderError('RuntimeError', 'super(): arg[0] deleted');
    if (!c) throw new AdderError('RuntimeError', 'super(): __class__ cell not found');
    if (c._v === undefined) throw new AdderError('RuntimeError', 'super(): empty __class__ cell');
    if (!(typeof c._v === 'function' && c._v._pyClass)) throw new AdderError('RuntimeError', `super(): __class__ is not a type (${pyTypeName(c._v)})`);
    return pySuper(c._v, self);
  },
  bytesLit, dictLiteral,
  tuple: mkTuple,
  isThen: (v) => v !== null && v !== undefined && typeof v.then === 'function',
  // range(...) arguments for a counted loop: [start, stop, step, sign(step)], validated as range()
  // does. A range whose values or counter run past 2**53 counts in BigInts (the loop's raw `<`, `+`
  // and `(k - stop) * dir < 0` hold for them too); rangeVar hands each value to the loop variable
  // canonical. In a speculative region's fast body (air-lower _lowerSpecRegion) the loop variable
  // is a number, its arithmetic raw: there rangeArgsFast gives null for such a range, which the
  // body's okRange guard bails at, before the loop.
  rangeArgs: (args) => {
    const r = new AdderRange(...args);   // the same validation as range()
    if (r.big) { const [s, e, t] = r.big; return [s, e, t, t > 0n ? 1n : -1n]; }
    return [r.start, r.stop, r.step, r.step > 0 ? 1 : -1];
  },
  rangeArgsFast: (args) => {
    const r = new AdderRange(...args);
    return r.big ? null : [r.start, r.stop, r.step, r.step > 0 ? 1 : -1];
  },
  okRange: (rng) => rng,   // (only ever reached as its guard: see air-lower's okRange spec)
  rangeVar: (k) => (typeof k === 'bigint' ? intNorm(k) : k),
  // a generator expression (see lowerGeneratorExp): the sync variant over a synchronous source
  // when there is one, else the async variant
  genExpr: (src, syncGen, asyncGen) => {
    const sync = syncGen && src !== null && src !== undefined && !isUserIterable(src) &&
      (Array.isArray(src) || typeof src === 'string' || typeof src[Symbol.iterator] === 'function');
    const g = sync ? syncGen(_iterArray(src)) : asyncGen(_pyEach(src));
    g.__adderClass__ = 'generator';
    return g;
  },
  // the same from code that can't wait (a sync twin, a sync dunder): a user iterable's source is
  // read through its __iter__'s sync twin (Set.__and__'s `(v for v in other if v in self)` over
  // a user Set), where genExpr would take the async variant
  genExprSync: (src, syncGen, asyncGen) => {
    if (syncGen && src !== null && src !== undefined && isUserIterable(src)) {
      const it = _iterArray(src);
      if (it !== null && typeof it === 'object' && typeof it.then !== 'function' && typeof it[Symbol.asyncIterator] !== 'function') {
        const g = syncGen(it);
        g.__adderClass__ = 'generator';
        return g;
      }
    }
    return _py.genExpr(src, syncGen, asyncGen);
  },
  each: (src) => _pyEach(src),
  // the source of a hybrid for loop (emitForOfHybrid): arrays and typed arrays as they are
  // (indexed, live), dicts / sets / plain dicts snapshotted as a list (as before), and anything
  // else — strings, ranges, iterators, generators, async sources, user __iter__ — as an
  // iterable stepped lazily
  iterLazy: (obj) => {
    if (obj === null || obj === undefined) throw new AdderError('TypeError', `'NoneType' object is not iterable`);
    if (Array.isArray(obj) || (ArrayBuffer.isView(obj) && !(obj instanceof DataView))) return obj;
    if (obj instanceof Map || obj instanceof Set || isPlainDict(obj)) return [...pyIter(obj)];
    if (isUserIterable(obj)) return pyIterAsync(obj);
    if (typeof obj === 'string' || typeof obj[Symbol.iterator] === 'function' || typeof obj[Symbol.asyncIterator] === 'function') return obj;
    return pyIter(obj);
  },
  // match: [true, ...captures in `names` order] when the pattern fits, else null
  match: async (subject, descJson, vals, names) => {
    let desc = _matchDescs.get(descJson);
    if (!desc) { desc = JSON.parse(descJson); _matchDescs.set(descJson, desc); }
    const binds = new Map();
    if (!(await pyMatch(subject, desc, vals, binds))) return null;
    return [true, ...names.map((n) => binds.get(n))];
  },
  genIter: (arr) => { const it = arr[Symbol.iterator](); it.__adderClass__ = 'generator'; return it; },
  importRoot: _importRoot,
  excPush: (e) => { excStack.push(e); },
  excPop: () => { excStack.pop(); },
  // f(**m): a dict (PyDict, plain object, or a mapping with keys/__getitem__) → a plain object
  // the call's keyword bag can spread
  kwSplat(m) {
    if (m instanceof Map) {
      const o = {};
      for (const [k, v] of m) {
        if (typeof k !== 'string') throw new AdderError('TypeError', 'keywords must be strings');
        o[k] = v;
      }
      return o;
    }
    if (m && typeof m.keys === 'function' && typeof m.__getitem__ === 'function' && !isPlainDict(m)) {
      const o = {};
      for (const k of pyIter(m.keys())) o[k] = m.__getitem__(k);
      return o;
    }
    if (m === null || typeof m !== 'object') throw new AdderError('TypeError', `argument after ** must be a mapping, not ${pyTypeName(m)}`);
    return m;
  },
};
