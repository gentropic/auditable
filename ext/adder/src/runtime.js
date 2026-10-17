// adder transpile runtime — Python semantics helpers called from AIR-emitted JS.
// Small monomorphic functions that V8 inlines. Reuses builtins.js internals.

import {
  AdderError, AdderRange, Complex,
  pyBool, pyTypeName, pyStr, pyRepr, pyIter, pyCollect, pyFormatValue,
  adderGetAttr, pyEq, pyLt, pyLe, pyGt, pyGe, pySuper, excToThrowable,
  pyAdd, pyIAddBuiltin, pySub, pyMul, pyTrueDiv, pyFloorDiv, pyMod, pyPow, pyAnd, pyOr, pyXor, pyLshift, pyRshift,
  pyNeg, pyPos, pyInvert, pyGetItem, pyRangeSlice, bytesLit, dictLiteral,
  PyTuple, PyDict, PySet, mkTuple, isPlainDict, finishClass, guardSetAttr, setClassAttr, excStack, pyMatch, _pyEach, isUserIterable, pyIterAsync, excValue, excMatches, excTypeOf, initExceptionInstance,
  buildClass, classStatement, asCallable, awaitTarget, PyByteArray,
} from './builtins.js';
import { _loadDirectModule, _tickLine, _importRoot, importModule, importNames, resolveRelativeImport } from './eval.js';

// ── Arithmetic (preserve Python semantics) ──

// In-place add used by `+=`. Python semantics: try __iadd__ first; if the
// LHS is a mutable container (list, set), extend it in-place; otherwise
// fall through to _add (creates a new value, caller rebinds via the
// surrounding assignment). Always returns the value to rebind.
function _iadd(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (a !== null && typeof a === 'object' && typeof a.__iadd__ === 'function') {
    return a.__iadd__(b);
  }
  // a list extends in place; anything else (a tuple too) rebinds to a + b
  return pyIAddBuiltin(a, b);
}

// ── Comparison ──

function _contains(container, value) {
  if (typeof container === 'string') return container.includes(String(value));
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
  if (obj instanceof Map) { obj.set(key, value); return; }
  if (Array.isArray(obj)) {
    const idx = key < 0 ? obj.length + key : key;
    obj[idx] = value;
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
    if (typeof obj.__setitem__ === 'function') { obj.__setitem__(key, value); return; }
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
  if (obj instanceof AdderRange) return pyRangeSlice(obj, lower, upper, step);
  step = step ?? 1;
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  if (typeof obj === 'string' || Array.isArray(obj) || obj instanceof Uint8Array) {
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
    return obj.__getitem__({ _slice: true, lower, upper, step });
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
    obj.__setitem__({ _slice: true, lower, upper, step }, value);
    return;
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support slice assignment`);
  }
  const rhs = [...pyIter(value)];
  const effectiveStep = step ?? 1;
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
    obj.__delitem__({ _slice: true, lower, upper, step });
    return;
  }
  if (!Array.isArray(obj)) {
    throw new AdderError('TypeError', `'${pyTypeName(obj)}' object doesn't support slice deletion`);
  }
  const effectiveStep = step ?? 1;
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
// siteId, ...args)`. Each call site has a unique siteId allocated by the
// lowerer; the helper keeps a tiny (type → unbound_method) cache keyed
// off siteId. On hit, skip adderGetAttr's type-dispatch chain entirely
// and skip the bound-method closure allocation.
//
// Layout: _PIC[siteId] = { types, methods, next } — arrays of length
// 0..PIC_SIZE. FIFO eviction once full so a 5-way polymorphic site
// (e.g. richards' task-table) cycles instead of going megamorphic.
//
// Class-instance fast path only. Primitives (string, array, Map, …) and
// modules fall through to adderGetAttr because their per-type method
// tables (`_strMethod`, `_listMethod`, etc.) build a fresh closure per
// call — caching one would alias the receiver across instances. The
// adderGetAttr slow path already returns the right closure for these.

const _PIC_SIZE = 4;
const _PIC = [];

// Sync function — the underlying method may be sync OR async, and JS
// `return` preserves that polarity. Wrapping this helper in `async`
// would wrap every return in `Promise.resolve()` even when the method
// is sync, paying the Promise allocation on every method call.
// The caller's `await _py.callMethod(...)` handles both shapes.
function _callMethod(obj, name, siteId, ...args) {
  // Fast path: scan the cache for a matching __adderType__.
  const t = (obj !== null && obj !== undefined) ? obj.__adderType__ : undefined;
  const cache = _PIC[siteId];
  if (cache && t !== undefined) {
    const types = cache.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === t) return cache.methods[i].call(obj, ...args);
    }
  }
  // Slow path: full adderGetAttr lookup + call.
  const fn = asCallable(adderGetAttr(obj, name));
  const result = fn(...args);

  // Populate the cache for class-instance receivers. We cache the
  // wrapper on `t.prototype[name]` (a non-_pyFunc function whose `this`
  // gets bound to the receiver at call time via `.call(obj, ...)`).
  // Skip caching for primitives / dicts / modules — adderGetAttr there
  // returns receiver-bound closures whose identity changes per call.
  if (t !== undefined && t.prototype && typeof t.prototype[name] === 'function') {
    let c = cache;
    if (!c) {
      c = { types: [], methods: [], next: 0 };
      _PIC[siteId] = c;
    }
    if (c.types.length < _PIC_SIZE) {
      c.types.push(t);
      c.methods.push(t.prototype[name]);
    } else {
      // FIFO eviction so a 5-way polymorphic site cycles instead of
      // pinning to the first 4 types it ever saw.
      const idx = c.next;
      c.types[idx] = t;
      c.methods[idx] = t.prototype[name];
      c.next = (idx + 1) % _PIC_SIZE;
    }
  }
  return result;
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
async function _exitWith(mgr, exc) {
  if (mgr === null || mgr === undefined || typeof mgr.__exit__ !== 'function') {
    throw new AdderError(
      'AttributeError',
      `'${pyTypeName(mgr)}' object has no attribute '__exit__'`,
    );
  }
  if (exc === null || exc === undefined) {
    // Normal-exit path: discard return; CPython does likewise here.
    await mgr.__exit__(null, null, null);
    return false;
  }
  // Exception path: pass (type, value, None) and return suppression flag.
  if (exc && exc.pyType === 'BudgetExceeded') { await mgr.__exit__(null, null, null); return false; }
  return await mgr.__exit__(excTypeOf(exc), excValue(exc), null);
}

// ── Attribute access ──

function _getattr(obj, name) {
  return adderGetAttr(obj, name);
}

function _setattr(obj, name, value) {
  // typeof check accepts both 'object' (instances) and 'function' (adder
  // classes — class-attribute assignment patterns like
  // `Strength.REQUIRED = Strength(0)` deltablue uses for module-level
  // singletons set after the class body has evaluated).
  if (obj !== null && (typeof obj === 'object' || typeof obj === 'function')) {
    guardSetAttr(obj, name);
    obj[name] = value;
  }
}

function _delitem(obj, key) {
  if (obj instanceof Map) { obj.delete(key); return; }
  if (Array.isArray(obj)) {
    const idx = key < 0 ? obj.length + key : key;
    obj.splice(idx, 1);
    return;
  }
  if (obj instanceof Set) { obj.delete(key); return; }
  if (obj !== null && typeof obj === 'object') {
    if (typeof obj.__delitem__ === 'function') { obj.__delitem__(key); return; }
    delete obj[key];
    return;
  }
  throw new AdderError('TypeError', `'${pyTypeName(obj)}' object does not support item deletion`);
}

function _delattr(obj, name) {
  if (obj !== null && typeof obj === 'object') delete obj[name];
}

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
async function _import(name) {
  return importModule(name);
}

async function _importPath(path) {
  const mod = await _loadDirectModule(path);
  if (mod) return mod;
  throw new AdderError('ModuleNotFoundError', `cannot load module from '${path}'`);
}

// names: array of { name, alias } (or "*"); → { boundName: value }
async function _importFrom(moduleName, names) {
  // a cell is not in a package: a relative import there raises, as at CPython's top level
  const abs = resolveRelativeImport(moduleName, null);
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
function _createClass(name, bases, members, annotations, kw) {
  const ann = [];
  for (let k = 0; annotations && k < annotations.length; k += 2) ann.push([annotations[k], annotations[k + 1]]);
  return classStatement(name, bases, members, ann, kw);
}

// ── Exception matching (for try/except) ──

// _excParents comes from builtins.js
import { _excParents } from './builtins.js';

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
  return [...pyIter(obj)];
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

function _bindArgs(fname, names, args) {
  const a = Array.prototype.slice.call(args);
  while (a.length && a[a.length - 1] === undefined) a.pop();
  const kw = a.length && _isKwBag(a[a.length - 1]) ? a.pop() : null;
  // extra positionals are dropped, not refused: JS calls Python callbacks with more
  // arguments than they declare (Array.map passes index and array)
  if (a.length > names.length) a.length = names.length;
  if (kw) _checkKw(fname, names, a.length, kw, false);
  for (let i = a.length; i < names.length; i++) {
    if (kw && Object.hasOwn(kw, names[i])) a.push(kw[names[i]]);
    else _argError(`${fname}() missing 1 required positional argument: '${names[i]}'`);
  }
  return a;
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
const _add = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a + b : pyAdd(a, b));
const _sub = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : pySub(a, b));
const _mul = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a * b : pyMul(a, b));
const _div = pyTrueDiv, _floordiv = pyFloorDiv, _mod = pyMod, _pow = pyPow;
const _and_ = pyAnd, _or_ = pyOr, _xor = pyXor, _neg = pyNeg, _pos = pyPos, _invert = pyInvert;

// comparisons: the shared rules (builtins.js), so both engines compare alike
const _eq = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a === b : pyEq(a, b));
const _lt = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a < b : pyLt(a, b));
const _lte = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a <= b : pyLe(a, b));
const _gt = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a > b : pyGt(a, b));
const _gte = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a >= b : pyGe(a, b));
function _neq(a, b) {
  if (a !== null && typeof a === 'object' && typeof a.__ne__ === 'function') return a.__ne__(b);
  const r = pyEq(a, b);
  return r && typeof r.then === 'function' ? r.then((x) => !x) : !r;
}

// ── Export as single namespace ──

export const _py = {
  // arithmetic
  add: _add, sub: _sub, mul: _mul, div: _div,
  floordiv: _floordiv, mod: _mod, pow: _pow,
  // in-place: __iadd__ dispatch + list extend semantics for `+=`
  iadd: _iadd,
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
  makeSlice: (lower, upper, step) => ({ _slice: true, lower, upper, step }),
  // context manager __exit__ (with statement)
  exitWith: _exitWith,
  // attribute
  getattr: _getattr, setattr: _setattr,
  callMethod: _callMethod,
  delitem: _delitem, delattr: _delattr,
  // dict/set construction
  makeDict: _makeDict, makeSet: _makeSet,
  // call
  call: _call,
  // iteration
  iter: _iterArray,
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
  fnOf: asCallable,
  aw: awaitTarget,
  // a def's metadata (both engines record the same: the tree-walker in eval.js _attachSignature)
  defSig: (fn, shape, defaults) => {
    if (typeof fn !== 'function') return null;
    fn._pyDef = true;
    fn._pySig = { ...shape, defaults };
    const pos = shape.params.filter((p) => p.hasDefault).map((p) => defaults[p.name]);
    fn.__defaults__ = pos.length ? mkTuple(pos) : null;
    const kwd = shape.kwonly.filter((p) => p.hasDefault);
    fn.__kwdefaults__ = kwd.length ? new PyDict(kwd.map((p) => [p.name, defaults[p.name]])) : null;
    return null;
  },
  // the run budget (emitted only when lowering with ticks: true)
  tick: _tickLine,
  // argument binding
  bindArgs: _bindArgs, checkKw: _checkKw, argError: _argError, isKwBag: _isKwBag,
  assertFail: _assertFail,
  super: pySuper,
  bytesLit, dictLiteral,
  tuple: mkTuple,
  isThen: (v) => v !== null && v !== undefined && typeof v.then === 'function',
  // range(...) arguments for a counted loop: [start, stop, step, sign(step)], validated as range() does
  rangeArgs: (args) => {
    const r = new AdderRange(...args);   // the same validation as range()
    return [r.start, r.stop, r.step, r.step > 0 ? 1 : -1];
  },
  // a generator expression (see lowerGeneratorExp): the sync variant over a synchronous source
  // when there is one, else the async variant
  genExpr: (src, syncGen, asyncGen) => {
    const sync = syncGen && src !== null && src !== undefined && !isUserIterable(src) &&
      (Array.isArray(src) || typeof src === 'string' || typeof src[Symbol.iterator] === 'function');
    const g = sync ? syncGen(_iterArray(src)) : asyncGen(_pyEach(src));
    g.__adderClass__ = 'generator';
    return g;
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
