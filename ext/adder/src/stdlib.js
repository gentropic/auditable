// adder stdlib — the modules beyond builtins.js's core (math, json, re, itertools, collections,
// …): __future__, typing, copy, operator, heapq, bisect, base64, binascii, html, textwrap,
// contextlib, io, enum and dataclasses. CPython's API and behaviour, values as JS values; what a
// module leaves out is said at the module. Each registers itself into adderModules at load.
//
// This file is concat-bundled with the rest of adder (one shared scope), so every top-level
// name here carries an `_sl` prefix.

import {
  AdderError, PyTuple, PyDict, PySet, mkTuple, isPlainDict, pyTypeName, pyRepr, pyStr, pyReprMaybe,
  pyIter, pyCollect, pyBool, pyEq, pyLt, pyLe, pyGt, pyGe, pyAdd, pySub, pyMul, pyTrueDiv, pyFloorDiv,
  pyMod, pyPow, pyAnd, pyOr, pyXor, pyLshift, pyRshift, pyMatmul, pyNeg, pyPos, pyInvert, pyGetItem, pyInplace, pyDelItem, PySlice, seqSliceSet,
  pySorted, adderGetAttr, adderModules, excValue, excToThrowable, excTypeOf, excMatches, makeExcType, finishClass,
  GenericAlias, UnionType, makeUnion, _namedtuple, _typeObjects, _stdio, isUserIterable, pyIterAsync, pyAbs, _arityErr, _kwBagEmpty, pyTypeObj, frozenModuleHooks, intNorm, asCallable,
} from './builtins.js';

// ── shared helpers ──

const _slIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _slThen = (v, f) => (_slIsThen(v) ? v.then(f) : f(v));
// the trailing keyword bag of a call from adder code (f(x, key=1) → [x, {_kw: true, key: 1}])
const _slKw = (args) => (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' &&
  args[args.length - 1]._kw === true ? args.pop() : null);
const _slOpt = (kw, k, d) => (kw && Object.hasOwn(kw, k) && kw[k] !== undefined ? kw[k] : d);
// a JS class presented as a Python type: callable without `new`, named for type() / isinstance
function _slType(name, Cls, module) {
  const ctor = (...a) => new Cls(...a);
  ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name;
  if (module) ctor.__module__ = module;
  Cls.prototype.__adderClass__ = name;
  Cls.prototype.__adderType__ = ctor;
  ctor._jsClass = Cls;
  return ctor;
}
// call fns in order, synchronously until one returns a promise (a tree-walked Python callable)
function _slChain(fns, i = 0) {
  for (; i < fns.length; i++) {
    const r = fns[i]();
    if (_slIsThen(r)) return r.then(() => _slChain(fns, i + 1));
  }
  return undefined;
}
const _slTruthy = async (v) => pyBool(_slIsThen(v) ? await v : v);
// a Python callable called from JS (f(x)), keyword bag appended when there is one
const _slCall = (f, args, kw) => (kw ? f(...args, { _kw: true, ...kw }) : f(...args));
// FNV-1a over a string, as a 32-bit int: __hash__ for values hashed by their contents
function _slHashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}
const _slIsBytes = (b) => b instanceof Uint8Array;
const _slBytesLike = (b, fn) => {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  throw new AdderError('TypeError', `a bytes-like object is required, not '${pyTypeName(b)}'`);
};
const _slUtf8 = new TextEncoder();
const _slUtf8d = new TextDecoder();

// ── typing ──
// The runtime objects of annotations: List[int], Optional[str], Union[...], Callable[...],
// TypeVar, Generic, Protocol, cast, overload — subscriptable, printable, and ignored by
// execution, as at CPython's run time. NamedTuple and TypedDict make real classes. Not here:
// get_type_hints beyond the annotation strings, runtime_checkable protocols' isinstance.
class _SlTypingForm {
  constructor(name, origin) { this._name = name; this.__origin__ = origin || null; }
  __getitem__(k) {
    const args = k instanceof PyTuple ? [...k] : [k];
    // ClassVar[int].__origin__ is ClassVar (a form with no class behind it is its own origin)
    return new GenericAlias(this.__origin__ || this, args, this._name);
  }
  __repr__() { return this._name; }
  __or__(o) { return makeUnion(this, o); }
  __ror__(o) { return makeUnion(o, this); }
  __call__() { throw new AdderError('TypeError', `Cannot instantiate ${this._name}`); }
}
_SlTypingForm.prototype.__adderClass__ = '_SpecialForm';
class _SlTypeVar {
  constructor(name, ...rest) {
    const kw = _slKw(rest);
    this.__name__ = name;
    this.__constraints__ = mkTuple(rest);
    this.__bound__ = _slOpt(kw, 'bound', null);
    this.__covariant__ = !!_slOpt(kw, 'covariant', false);
    this.__contravariant__ = !!_slOpt(kw, 'contravariant', false);
    // (a PEP 695 type parameter infers its variance: no +/-/~ in its repr)
    this.__infer_variance__ = !!_slOpt(kw, 'infer_variance', false);
    this.__default__ = _slOpt(kw, 'default', null);
  }
  __repr__() { return (this.__infer_variance__ ? '' : this.__covariant__ ? '+' : this.__contravariant__ ? '-' : '~') + this.__name__; }
  __or__(o) { return makeUnion(this, o); }
  __ror__(o) { return makeUnion(o, this); }
}
const _slTypeVar = _slType('TypeVar', _SlTypeVar, 'typing');
const _slForm = (name, origin) => new _SlTypingForm(`typing.${name}`, origin);
// a class whose subclasses typing turns into something else (NamedTuple → tuple, TypedDict → dict)
function _slHookBase(name, hook, call) {
  const base = function (...a) { return call(...a); };
  base._pyName = name; base._pyClass = true; base.__name__ = name; base.__module__ = 'typing';
  base.prototype = {}; base._pyBases = []; base._pyMRO = [base]; base._pyOwnMembers = new PySet();
  base.__init_subclass__ = hook;
  return base;
}
// class P(NamedTuple): x: int; y: int = 0  → a namedtuple, with the class's methods
const _slNamedTupleBase = _slHookBase('NamedTuple', (cls) => {
  const fields = cls.__annotations__ ? [...cls.__annotations__.keys()] : [];
  const defaults = [];
  for (const f of fields) if (cls._pyAttrs && cls._pyAttrs.has(f)) defaults.push(cls[f]);
  const nt = _namedtuple(cls._pyName, fields, { _kw: true, defaults });
  const proto = nt._ntProto;
  for (const key of cls._pyOwnMembers || []) {
    const d = Object.getOwnPropertyDescriptor(cls.prototype, key);
    if (d) Object.defineProperty(proto, key, d);
  }
  proto.__adderType__ = cls;
  cls._pyNew = (...a) => nt(...a);
  cls._fields = nt._fields;
  cls.__match_args__ = nt._fields;
  cls._make = nt._make;
  cls._field_defaults = Object.fromEntries(fields.slice(fields.length - defaults.length).map((f, i) => [f, defaults[i]]));
  cls._pyMRO = [cls, _typeObjects.tuple].filter(Boolean);
  for (const f of fields) delete cls[f];
}, (name, fields) => _namedtuple(name, [...pyIter(fields)].map((f) => (Array.isArray(f) ? f[0] : f))));
// class Movie(TypedDict): title: str  → Movie(title='x') is a dict
const _slTypedDictBase = _slHookBase('TypedDict', (cls) => {
  cls._pyNew = (...a) => {
    const kw = _slKw(a);
    const d = a.length ? { ...(a[0] instanceof Map ? Object.fromEntries(a[0]) : a[0]) } : {};
    if (kw) for (const k of Object.keys(kw)) if (k !== '_kw') d[k] = kw[k];
    return d;
  };
  cls._pyMRO = [cls, _typeObjects.dict].filter(Boolean);
}, (name) => { throw new AdderError('TypeError', `TypedDict('${name}', …) is not supported; use the class form`); });
adderModules.typing = {
  // the type of a subscripted typing form (typing.List[int], ClassVar[int]): dataclasses tests with it
  get _GenericAlias() { return pyTypeObj(new GenericAlias(null, [])); },
  Any: _slForm('Any'), Optional: _slForm('Optional'), Union: _slForm('Union'), Callable: _slForm('Callable'),
  List: _slForm('List'), Dict: _slForm('Dict'), Tuple: _slForm('Tuple'), Set: _slForm('Set'), FrozenSet: _slForm('FrozenSet'),
  Type: _slForm('Type'), Iterable: _slForm('Iterable'), Iterator: _slForm('Iterator'), Generator: _slForm('Generator'),
  Sequence: _slForm('Sequence'), MutableSequence: _slForm('MutableSequence'), Mapping: _slForm('Mapping'),
  MutableMapping: _slForm('MutableMapping'), Collection: _slForm('Collection'), Container: _slForm('Container'),
  AbstractSet: _slForm('AbstractSet'), Hashable: _slForm('Hashable'), Sized: _slForm('Sized'),
  Awaitable: _slForm('Awaitable'), Coroutine: _slForm('Coroutine'), AsyncIterator: _slForm('AsyncIterator'),
  AsyncIterable: _slForm('AsyncIterable'), AsyncGenerator: _slForm('AsyncGenerator'), Deque: _slForm('Deque'),
  DefaultDict: _slForm('DefaultDict'), OrderedDict: _slForm('OrderedDict'), Counter: _slForm('Counter'),
  ChainMap: _slForm('ChainMap'), Pattern: _slForm('Pattern'), Match: _slForm('Match'), IO: _slForm('IO'),
  TextIO: _slForm('TextIO'), BinaryIO: _slForm('BinaryIO'), ClassVar: _slForm('ClassVar'), Final: _slForm('Final'),
  Literal: _slForm('Literal'), Annotated: _slForm('Annotated'), Generic: _slForm('Generic'), Protocol: _slForm('Protocol'),
  NoReturn: _slForm('NoReturn'), Never: _slForm('Never'), Self: _slForm('Self'), LiteralString: _slForm('LiteralString'),
  TypeAlias: _slForm('TypeAlias'), TypeGuard: _slForm('TypeGuard'), Concatenate: _slForm('Concatenate'),
  Required: _slForm('Required'), NotRequired: _slForm('NotRequired'), Unpack: _slForm('Unpack'),
  SupportsInt: _slForm('SupportsInt'), SupportsFloat: _slForm('SupportsFloat'), SupportsIndex: _slForm('SupportsIndex'),
  SupportsAbs: _slForm('SupportsAbs'), Text: _typeObjects.str || _slForm('Text'), AnyStr: new _SlTypeVar('AnyStr'),
  TypeVar: _slTypeVar, ParamSpec: _slType('ParamSpec', class extends _SlTypeVar {}, 'typing'),
  // *Ts (in Generic[*Ts], tuple[int, *Ts]) iterates it: one Unpack[Ts], as CPython's does
  TypeVarTuple: _slType('TypeVarTuple', class extends _SlTypeVar {
    __repr__() { return this.__name__; }
    *[Symbol.iterator]() { const U = adderModules.typing.Unpack; yield U && typeof U.__getitem__ === "function" ? U.__getitem__(this) : this; }
    __iter__() { return this[Symbol.iterator](); }
  }, 'typing'),
  NamedTuple: _slNamedTupleBase, TypedDict: _slTypedDictBase,
  TYPE_CHECKING: false,
  cast: (_t, v) => v,
  overload: (f) => f, final: (f) => f, no_type_check: (f) => f, runtime_checkable: (c) => c,
  assert_type: (v) => v, assert_never: (v) => { throw new AdderError('AssertionError', `Expected code to be unreachable, but got: ${pyRepr(v)}`); },
  reveal_type: (v) => v,
  NewType: (name, _tp) => { const f = (x) => x; f._pyName = name; f.__name__ = name; return f; },
  get_type_hints: (obj) => {
    const d = new PyDict();
    for (const c of [...(obj && obj._pyMRO ? obj._pyMRO : [obj])].reverse()) if (c && c.__annotations__) for (const [k, v] of c.__annotations__) d.set(k, v);
    return d;
  },
  get_origin: (t) => (t instanceof GenericAlias ? t.__origin__ : null),
  get_args: (t) => (t instanceof GenericAlias || t instanceof UnionType ? t.__args__ : mkTuple([])),
};

// ── copy ──
// copy / deepcopy, honouring __copy__ / __deepcopy__(memo). Containers keep their type
// (tuple, set, dict and its subclasses); other objects get a fresh instance of the same class
// with their attributes copied.
// a Python subclass of list / dict / set: the copy r (its items) made an instance of x's class with
// x's instance attributes (each through `each`) — object.__reduce_ex__'s shape, which is what
// CPython's copy uses for a class that doesn't define its own (Counter → a Counter, not a dict)
const _SL_ENGINE_KEYS = new Set(['__adderType__', '__adderClass__']);
function _slAsSubclass(x, r, each = (v) => v) {
  Object.setPrototypeOf(r, Object.getPrototypeOf(x));
  for (const k of Object.getOwnPropertyNames(x)) {
    if (Array.isArray(x) && (k === 'length' || /^\d+$/.test(k))) continue;
    const d = Object.getOwnPropertyDescriptor(x, k);
    if ('value' in d && !_SL_ENGINE_KEYS.has(k)) d.value = each(d.value);
    Object.defineProperty(r, k, d);
  }
  return r;
}
const _slPySub = (x) => x.__adderType__ !== undefined && x.__adderType__._pyMRO !== undefined && Object.getPrototypeOf(x) === x.__adderType__.prototype;
function _slShallow(x) {
  if (x === null || typeof x !== 'object') return x;
  if (typeof x.__copy__ === 'function') return x.__copy__();
  if (x instanceof PyTuple) return x;
  if ((Array.isArray(x) || x instanceof PyDict || x instanceof Set) && _slPySub(x)) {
    return _slAsSubclass(x, Array.isArray(x) ? [...x] : x instanceof PyDict ? new PyDict(x) : new PySet(x));
  }
  if (Array.isArray(x)) return Array.prototype.slice.call(x);
  if (x instanceof Uint8Array) return x;
  if (ArrayBuffer.isView(x)) return x.slice();
  if (x instanceof Map) {
    if (typeof x.copy === 'function' && !(x.constructor === PyDict || x.constructor === Map)) return x.copy();
    return new (x instanceof PyDict ? PyDict : Map)(x);
  }
  if (x instanceof Set) { if (x._frozen) return x; return new PySet(x); }
  if (isPlainDict(x)) return { ...x };
  const c = Object.create(Object.getPrototypeOf(x));
  for (const k of Object.keys(x)) c[k] = x[k];
  return c;
}
function _slDeep(x, memo) {
  if (x === null || typeof x !== 'object') return x;
  if (memo.has(x)) return memo.get(x);
  if (typeof x.__deepcopy__ === 'function') { const r = x.__deepcopy__(memo); memo.set(x, r); return r; }
  if (x instanceof PyTuple) {
    const items = x.map((v) => _slDeep(v, memo));
    const r = items.every((v, i) => v === x[i]) ? x : (x.constructor !== PyTuple && x._replace ? Object.freeze(Object.setPrototypeOf(Object.assign([], items), Object.getPrototypeOf(x))) : mkTuple(items));
    memo.set(x, r);
    return r;
  }
  if ((Array.isArray(x) || x instanceof PyDict || x instanceof Set) && _slPySub(x)) {
    const r = _slAsSubclass(x, Array.isArray(x) ? [] : x instanceof PyDict ? new PyDict() : new PySet());
    memo.set(x, r);
    for (const k of Object.getOwnPropertyNames(r)) {
      const d = Object.getOwnPropertyDescriptor(r, k);
      if ('value' in d && d.writable && !_SL_ENGINE_KEYS.has(k)) r[k] = _slDeep(d.value, memo);
    }
    if (Array.isArray(x)) for (const v of x) r.push(_slDeep(v, memo));
    else if (x instanceof PyDict) for (const [k, v] of x) r.set(_slDeep(k, memo), _slDeep(v, memo));
    else for (const v of x) r.add(_slDeep(v, memo));
    return r;
  }
  if (Array.isArray(x)) { const r = []; memo.set(x, r); for (const v of x) r.push(_slDeep(v, memo)); return r; }
  if (ArrayBuffer.isView(x)) { const r = x.slice(); memo.set(x, r); return r; }
  if (x instanceof Map) {
    let r;
    if (x.constructor !== PyDict && x.constructor !== Map && typeof x.copy === 'function') { r = x.copy(); r.clear(); }
    else r = new (x instanceof PyDict ? PyDict : Map)();
    memo.set(x, r);
    for (const [k, v] of x) r.set(_slDeep(k, memo), _slDeep(v, memo));
    return r;
  }
  if (x instanceof Set) {
    if (x._frozen) return x;
    const r = new PySet(); memo.set(x, r);
    for (const v of x) r.add(_slDeep(v, memo));
    return r;
  }
  if (isPlainDict(x)) { const r = {}; memo.set(x, r); for (const k of Object.keys(x)) r[k] = _slDeep(x[k], memo); return r; }
  const c = Object.create(Object.getPrototypeOf(x));
  memo.set(x, c);
  for (const k of Object.keys(x)) {
    const d = Object.getOwnPropertyDescriptor(x, k);
    if (d && 'value' in d) c[k] = _slDeep(d.value, memo);
  }
  return c;
}
adderModules.copy = {
  copy: _slShallow,
  deepcopy: (x, memo) => _slDeep(x, memo instanceof Map ? memo : new Map()),
  replace: (obj, ...a) => {
    const kw = _slKw(a) || {};
    if (typeof obj.__replace__ === 'function') return obj.__replace__({ ...kw, _kw: true });
    throw new AdderError('TypeError', `replace() does not support ${pyTypeName(obj)} objects`);
  },
  Error: makeExcType('copy.Error', 'Exception'),
};

// ── operator ──
// The operators as functions, plus itemgetter / attrgetter / methodcaller.
function _slItemgetter(...items) {
  const f = items.length === 1 ? (o) => pyGetItem(o, items[0]) : (o) => mkTuple(items.map((k) => pyGetItem(o, k)));
  f._pyName = 'itemgetter';
  f.__repr__ = () => `operator.itemgetter(${items.map(pyRepr).join(', ')})`;
  return f;
}
function _slAttrgetter(...names) {
  const get = (o, n) => n.split('.').reduce((v, part) => adderGetAttr(v, part), o);
  const f = names.length === 1 ? (o) => get(o, names[0]) : (o) => mkTuple(names.map((n) => get(o, n)));
  f._pyName = 'attrgetter';
  f.__repr__ = () => `operator.attrgetter(${names.map(pyRepr).join(', ')})`;
  return f;
}
function _slMethodcaller(name, ...args) {
  const kw = _slKw(args);
  const f = (o) => _slCall(adderGetAttr(o, name), args, kw ? Object.fromEntries(Object.entries(kw).filter(([k]) => k !== '_kw')) : null);
  f._pyName = 'methodcaller';
  return f;
}
const _slContains = (a, b) => {
  if (typeof a === 'string') return a.includes(b);
  if (Array.isArray(a)) return a.some((v) => pyEq(v, b) === true);
  if (a instanceof Map || a instanceof Set) return a.has(b);
  if (a && typeof a.__contains__ === 'function') return a.__contains__(b);
  return [...pyIter(a)].some((v) => pyEq(v, b) === true);
};
adderModules.operator = {
  add: pyAdd, sub: pySub, mul: pyMul, truediv: pyTrueDiv, floordiv: pyFloorDiv, mod: pyMod, pow: pyPow,
  matmul: pyMatmul, neg: pyNeg, pos: pyPos, invert: pyInvert, inv: pyInvert, abs: (a) => pyAbs(a),
  and_: pyAnd, or_: pyOr, xor: pyXor, lshift: pyLshift, rshift: pyRshift,
  eq: pyEq, ne: (a, b) => _slThen(pyEq(a, b), (r) => !r), lt: pyLt, le: pyLe, gt: pyGt, ge: pyGe,
  not_: (a) => !pyBool(a), truth: (a) => pyBool(a), is_: (a, b) => a === b, is_not: (a, b) => a !== b,
  is_none: (a) => a === null, is_not_none: (a) => a !== null,
  contains: _slContains, countOf: (a, b) => [...pyIter(a)].filter((v) => pyEq(v, b) === true).length,
  indexOf: (a, b) => { let i = 0; for (const v of pyIter(a)) { if (pyEq(v, b) === true) return i; i++; } throw new AdderError('ValueError', 'sequence.index(x): x not in sequence'); },
  getitem: pyGetItem,
  setitem: (o, k, v) => { if (o instanceof Map) o.set(k, v); else if (typeof o.__setitem__ === 'function') return _slThen(o.__setitem__(k, v), () => null); else if (Array.isArray(o) && k instanceof PySlice) seqSliceSet(o, k, v); else o[Array.isArray(o) && k < 0 ? o.length + k : k] = v; return null; },
  delitem: (o, k) => _slThen(pyDelItem(o, k), () => null),
  concat: (a, b) => pyAdd(a, b), index: (a) => (typeof a === 'number' && Number.isInteger(a) ? a : typeof a === 'bigint' ? a : typeof a === 'boolean' ? +a : a && typeof a.__index__ === 'function' ? a.__index__() : (() => { throw new AdderError('TypeError', `'${pyTypeName(a)}' object cannot be interpreted as an integer`); })()),
  iadd: (a, b) => pyInplace('+', a, b), isub: (a, b) => pyInplace('-', a, b), imul: (a, b) => pyInplace('*', a, b),
  itruediv: (a, b) => pyInplace('/', a, b), ifloordiv: (a, b) => pyInplace('//', a, b), imod: (a, b) => pyInplace('%', a, b),
  ipow: (a, b) => pyInplace('**', a, b), imatmul: (a, b) => pyInplace('@', a, b),
  iand: (a, b) => pyInplace('&', a, b), ior: (a, b) => pyInplace('|', a, b), ixor: (a, b) => pyInplace('^', a, b),
  ilshift: (a, b) => pyInplace('<<', a, b), irshift: (a, b) => pyInplace('>>', a, b),
  length_hint: (o, d = 0) => { try { return o.length ?? o.size ?? d; } catch { return d; } },
  call: (f, ...a) => f(...a),
  itemgetter: _slItemgetter, attrgetter: _slAttrgetter, methodcaller: _slMethodcaller,
};
// concat / iconcat: sequences only (CPython's "'int' object can't be concatenated")
const _slSeq = (a) => typeof a === 'string' || Array.isArray(a) || a instanceof Uint8Array
  || (a !== null && typeof a === 'object' && !(a instanceof Map) && !(a instanceof Set) && typeof a.__getitem__ === 'function');
const _slConcat = (a, b) => { if (!_slSeq(a)) throw new AdderError('TypeError', `'${pyTypeName(a)}' object can't be concatenated`); return pyAdd(a, b); };
adderModules.operator.concat = _slConcat;
adderModules.operator.iconcat = (a, b) => { if (!_slSeq(a)) throw new AdderError('TypeError', `'${pyTypeName(a)}' object can't be concatenated`); return pyInplace('+', a, b); };
// the operator functions take their arguments by position, exactly so many (operator.add(1) is a
// TypeError, as CPython's C functions are)
{
  const op = adderModules.operator;
  const counts = {
    1: ['neg', 'pos', 'invert', 'inv', 'abs', 'not_', 'truth', 'is_none', 'is_not_none', 'index'],
    2: ['add', 'sub', 'mul', 'truediv', 'floordiv', 'mod', 'pow', 'matmul', 'and_', 'or_', 'xor', 'lshift', 'rshift',
      'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'is_', 'is_not', 'contains', 'countOf', 'indexOf', 'getitem', 'concat',
      'iadd', 'isub', 'imul', 'itruediv', 'ifloordiv', 'imod', 'ipow', 'imatmul', 'iand', 'ior', 'ixor', 'ilshift', 'irshift', 'iconcat', 'delitem'],
    3: ['setitem'],
  };
  for (const [k, names] of Object.entries(counts)) {
    const n = +k;
    for (const name of names) {
      const f = op[name];
      if (typeof f !== 'function') continue;
      const w = function (...a) {
        const last = a.length ? a[a.length - 1] : undefined;
        if (last !== null && typeof last === 'object' && last._kw === true) {
          if (_kwBagEmpty(last)) a.pop(); else throw new AdderError('TypeError', `${name}() takes no keyword arguments`);
        }
        if (a.length !== n) throw _arityErr(name, n, n, a.length);
        return f(...a);
      };
      Object.defineProperty(w, 'name', { value: name });
      w._pyName = name;
      op[name] = w;
    }
  }
  const lh = op.length_hint;
  op.length_hint = function (...a) { if (a.length < 1 || a.length > 2) throw _arityErr('length_hint', 1, 2, a.length); return lh(...a); };
}
for (const n of ['add', 'sub', 'mul', 'truediv', 'floordiv', 'mod', 'pow', 'neg', 'pos', 'abs', 'and_', 'or_', 'xor',
  'invert', 'lshift', 'rshift', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'not_', 'truth', 'contains', 'getitem', 'index']) {
  adderModules.operator[`__${n.replace(/_$/, '')}__`] = adderModules.operator[n];
}

// ── heapq ──
// CPython's pure-Python heapq, line for line, so a heap's layout matches CPython's.
async function _slSiftdown(heap, startpos, pos) {
  const newitem = heap[pos];
  while (pos > startpos) {
    const parentpos = (pos - 1) >> 1;
    const parent = heap[parentpos];
    if (await _slTruthy(pyLt(newitem, parent))) { heap[pos] = parent; pos = parentpos; continue; }
    break;
  }
  heap[pos] = newitem;
}
async function _slSiftup(heap, pos) {
  const endpos = heap.length, startpos = pos, newitem = heap[pos];
  let childpos = 2 * pos + 1;
  while (childpos < endpos) {
    const rightpos = childpos + 1;
    if (rightpos < endpos && !(await _slTruthy(pyLt(heap[childpos], heap[rightpos])))) childpos = rightpos;
    heap[pos] = heap[childpos];
    pos = childpos;
    childpos = 2 * pos + 1;
  }
  heap[pos] = newitem;
  await _slSiftdown(heap, startpos, pos);
}
const _slHeapList = (h) => { if (!Array.isArray(h) || h instanceof PyTuple) throw new AdderError('TypeError', 'heap argument must be a list'); return h; };
// _heapq: the accelerator CPython's heapq.py imports over its own (pylib/heapq.py) — the C
// module's functions; merge / nlargest / nsmallest are heapq.py's
adderModules._heapq = {
  heappush: async (heap, item) => { _slHeapList(heap).push(item); await _slSiftdown(heap, 0, heap.length - 1); return null; },
  heappop: async (heap) => {
    if (!_slHeapList(heap).length) throw new AdderError('IndexError', 'index out of range');
    const last = heap.pop();
    if (heap.length) { const ret = heap[0]; heap[0] = last; await _slSiftup(heap, 0); return ret; }
    return last;
  },
  heapreplace: async (heap, item) => {
    if (!_slHeapList(heap).length) throw new AdderError('IndexError', 'index out of range');
    const ret = heap[0]; heap[0] = item; await _slSiftup(heap, 0); return ret;
  },
  heappushpop: async (heap, item) => {
    if (_slHeapList(heap).length && await _slTruthy(pyLt(heap[0], item))) { const t = heap[0]; heap[0] = item; item = t; await _slSiftup(heap, 0); }
    return item;
  },
  heapify: async (x) => { _slHeapList(x); for (let i = (x.length >> 1) - 1; i >= 0; i--) await _slSiftup(x, i); return null; },
};

// ── bisect ──
// _bisectmodule.c: (a, x, lo=0, hi=None, *, key=None) — a and x may come by keyword; lo and hi
// are indexes (__index__); hi defaults to len(a); items read by a[mid]. Indexes past 2**53 (a
// range of sys.maxsize) are BigInts, and the midpoint is computed exactly.
async function _slIndexArg(v) {
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v))) return v;
  if (v !== null && typeof v === 'object' && typeof v.__index__ === 'function') return _slIndexArg(await v.__index__());
  throw new AdderError('TypeError', `'${pyTypeName(v)}' object cannot be interpreted as an integer`);
}
function _slBisectArgs(name, raw) {
  const args = [...raw];
  const kw = _slKw(args) || {};
  const names = ['a', 'x', 'lo', 'hi'];
  const vals = [];
  for (let i = 0; i < names.length; i++) {
    const has = Object.hasOwn(kw, names[i]);
    if (i < args.length && has) throw new AdderError('TypeError', `argument for ${name}() given by name ('${names[i]}') and position (${i + 1})`);
    vals.push(i < args.length ? args[i] : has ? kw[names[i]] : undefined);
  }
  if (args.length > 4) throw new AdderError('TypeError', `${name}() takes at most 4 arguments (${args.length} given)`);
  for (const k of Object.keys(kw)) {
    if (k !== '_kw' && !names.includes(k) && k !== 'key') throw new AdderError('TypeError', `${name}() got an unexpected keyword argument '${k}'`);
  }
  if (vals[0] === undefined) throw new AdderError('TypeError', `${name}() missing required argument 'a' (pos 1)`);
  if (vals[1] === undefined) throw new AdderError('TypeError', `${name}() missing required argument 'x' (pos 2)`);
  // (a key that isn't callable fails where it's called, as in C — bisect of [] never calls it)
  const k = kw.key ?? null;
  return { a: vals[0], x: vals[1], lo: vals[2] ?? 0, hi: vals[3] ?? null, key: k === null ? null : (v) => asCallable(k)(v) };
}
async function _slBisect(right, name, raw, forInsort) {
  const p = _slBisectArgs(name, raw);
  const { a, key } = p;
  let x = p.x;
  if (forInsort && key !== null) x = await key(x);
  let lo = await _slIndexArg(p.lo);
  if (lo < 0) throw new AdderError('ValueError', 'lo must be non-negative');
  let hi = p.hi === null ? adderModules.builtins.len(a) : await _slIndexArg(p.hi);
  if (_slIsThen(hi)) hi = await hi;
  if (typeof lo === 'bigint' || typeof hi === 'bigint') {
    lo = BigInt(lo); hi = BigInt(hi);
    while (lo < hi) {
      const mid = lo + (hi - lo) / 2n;
      let v = pyGetItem(a, intNorm(mid));
      if (_slIsThen(v)) v = await v;
      if (key !== null) v = await key(v);
      if (right ? await _slTruthy(pyLt(x, v)) : !(await _slTruthy(pyLt(v, x)))) hi = mid; else lo = mid + 1n;
    }
    return { p, i: intNorm(lo) };
  }
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);   // (not (lo + hi) / 2: past 2**52 the sum rounds, and mid can land on hi)
    let v = pyGetItem(a, mid);
    if (_slIsThen(v)) v = await v;
    if (key !== null) v = await key(v);
    if (right ? await _slTruthy(pyLt(x, v)) : !(await _slTruthy(pyLt(v, x)))) hi = mid; else lo = mid + 1;
  }
  return { p, i: lo };
}
// insort: the index of x's key, then a list (exactly) gets x spliced in; anything else — a list
// subclass included — its own insert(i, x)
async function _slInsort(right, name, raw) {
  const { p, i } = await _slBisect(right, name, raw, true);
  const a = p.a;
  if (Array.isArray(a) && !(a instanceof PyTuple) && a.__adderType__ === undefined) { a.splice(i, 0, p.x); return null; }
  const r = adderGetAttr(a, 'insert')(i, p.x);
  if (_slIsThen(r)) await r;
  return null;
}
// _bisect: the accelerator CPython's bisect.py imports (pylib/bisect.py makes the aliases)
adderModules._bisect = {
  bisect_left: async (...r) => (await _slBisect(false, 'bisect_left', r, false)).i,
  bisect_right: async (...r) => (await _slBisect(true, 'bisect_right', r, false)).i,
  insort_left: (...r) => _slInsort(false, 'insort_left', r),
  insort_right: (...r) => _slInsort(true, 'insort_right', r),
};

for (const m of ['_heapq', '_bisect']) for (const f of Object.values(adderModules[m])) f.__module__ = m;

// ── base64 / binascii ──
// base64, urlsafe, base32, base16 and encodebytes; binascii's hexlify / crc32. Not here: a85,
// b85, z85.
const _slBinErr = makeExcType('binascii.Error', 'ValueError');
const _SL_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _slB64enc(bytes, alt) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += _SL_B64[(n >> 18) & 63] + _SL_B64[(n >> 12) & 63] + (i + 1 < bytes.length ? _SL_B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? _SL_B64[n & 63] : '=');
  }
  if (alt) out = out.replace(/[+/]/g, (c) => (c === '+' ? alt[0] : alt[1]));
  return out;
}
function _slB64dec(input, alt, validate) {
  let s = typeof input === 'string' ? input : _slUtf8d.decode(_slBytesLike(input));
  if (typeof input === 'string' && /[^\x00-\x7f]/.test(s)) throw new AdderError('ValueError', 'string argument should contain only ASCII characters');
  if (alt) s = s.replace(/[-_]/g, (c) => (c === alt[0] ? '+' : c === alt[1] ? '/' : c));
  if (validate) { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new AdderError('binascii.Error', 'Non-base64 digit found'); }
  else s = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const body = s.replace(/=+$/, '');
  const pad = s.length - body.length;
  if (body.includes('=')) throw new AdderError('binascii.Error', 'Incorrect padding');
  if (body.length % 4 === 1) throw new AdderError('binascii.Error', `Invalid base64-encoded string: number of data characters (${body.length}) cannot be 1 more than a multiple of 4`);
  if ((body.length + pad) % 4 !== 0) throw new AdderError('binascii.Error', 'Incorrect padding');
  const out = [];
  let buf = 0, bits = 0;
  for (const c of body) {
    buf = (buf << 6) | _SL_B64.indexOf(c); bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return Uint8Array.from(out);
}
const _SL_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function _slB32enc(b) {
  let out = '', buf = 0, bits = 0;
  for (const x of b) { buf = (buf << 8) | x; bits += 8; while (bits >= 5) { bits -= 5; out += _SL_B32[(buf >> bits) & 31]; } }
  if (bits) out += _SL_B32[(buf << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
}
function _slB32dec(input, casefold) {
  let s = typeof input === 'string' ? input : _slUtf8d.decode(_slBytesLike(input));
  if (casefold) s = s.toUpperCase();
  if (s.length % 8) throw new AdderError('binascii.Error', 'Incorrect padding');
  const body = s.replace(/=+$/, '');
  const out = [];
  let buf = 0, bits = 0;
  for (const c of body) {
    const v = _SL_B32.indexOf(c);
    if (v < 0) throw new AdderError('binascii.Error', 'Non-base32 digit found');
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return Uint8Array.from(out);
}
const _slAscii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const _slHex = (b, sep) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(sep || '');
function _slUnhex(input, upperOnly) {
  const s = typeof input === 'string' ? input : _slUtf8d.decode(_slBytesLike(input));
  if (s.length % 2) throw new AdderError('binascii.Error', upperOnly ? 'Incorrect padding' : 'Odd-length string');
  if (upperOnly ? /[^0-9A-F]/.test(s) : /[^0-9A-Fa-f]/.test(s)) throw new AdderError('binascii.Error', upperOnly ? 'Non-base16 digit found' : 'Non-hexadecimal digit found');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
  return out;
}
adderModules.base64 = {
  b64encode: (b, altchars) => _slAscii(_slB64enc(_slBytesLike(b), altchars ? _slUtf8d.decode(_slBytesLike(altchars)) : null)),
  b64decode: (s, ...a) => { const kw = _slKw(a); const alt = _slOpt(kw, 'altchars', a[0] ?? null); return _slB64dec(s, alt ? (typeof alt === 'string' ? alt : _slUtf8d.decode(alt)) : null, _slOpt(kw, 'validate', a[1] ?? false)); },
  standard_b64encode: (b) => _slAscii(_slB64enc(_slBytesLike(b))),
  standard_b64decode: (s) => _slB64dec(s),
  urlsafe_b64encode: (b) => _slAscii(_slB64enc(_slBytesLike(b), '-_')),
  urlsafe_b64decode: (s) => _slB64dec(s, '-_'),
  b32encode: (b) => _slAscii(_slB32enc(_slBytesLike(b))),
  b32decode: (s, ...a) => { const kw = _slKw(a); return _slB32dec(s, _slOpt(kw, 'casefold', a[0] ?? false)); },
  b16encode: (b) => _slAscii(_slHex(_slBytesLike(b)).toUpperCase()),
  b16decode: (s, ...a) => { const kw = _slKw(a); const cf = _slOpt(kw, 'casefold', a[0] ?? false); const t = typeof s === 'string' ? s : _slUtf8d.decode(s); return _slUnhex(cf ? t.toUpperCase() : t, true); },
  encodebytes: (b) => { const e = _slB64enc(_slBytesLike(b)); let o = ''; for (let i = 0; i < e.length; i += 76) o += e.slice(i, i + 76) + '\n'; return _slAscii(o); },
  decodebytes: (b) => _slB64dec(b),
};
adderModules.binascii = {
  hexlify: (b, sep) => _slAscii(_slHex(_slBytesLike(b), sep ? (typeof sep === 'string' ? sep : _slUtf8d.decode(sep)) : '')),
  b2a_hex: (b, sep) => _slAscii(_slHex(_slBytesLike(b), sep ? (typeof sep === 'string' ? sep : _slUtf8d.decode(sep)) : '')),
  unhexlify: (s) => _slUnhex(s, false),
  a2b_hex: (s) => _slUnhex(s, false),
  b2a_base64: (b, ...a) => { const kw = _slKw(a); return _slAscii(_slB64enc(_slBytesLike(b)) + (_slOpt(kw, 'newline', true) ? '\n' : '')); },
  a2b_base64: (s) => _slB64dec(s),
  crc32: (b, v = 0) => _slCrc32(_slBytesLike(b), v),
  Error: _slBinErr,
};

// crc32 / adler32 (zlib, binascii, zipfile)
const _SL_CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function _slCrc32(bytes, start = 0) {
  let c = (start ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = _SL_CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function _slAdler32(bytes, start = 1) {
  let a = start & 0xffff, b = (start >>> 16) & 0xffff;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

// ── html ──
// escape and unescape. unescape knows the common named entities (the Latin-1 set, typography,
// Greek letters) and every numeric one; CPython's table is the full HTML5 list.
const _SL_ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', iexcl: '¡', cent: '¢', pound: '£', curren: '¤',
  yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©', ordf: 'ª', laquo: '«', not: '¬', shy: '\u00ad', reg: '®',
  macr: '¯', deg: '°', plusmn: '±', sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸',
  sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾', iquest: '¿', times: '×', divide: '÷',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ',
  Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û',
  Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä',
  aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í',
  icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†',
  Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', euro: '€',
  trade: '™', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', minus: '−', infin: '∞', ne: '≠', le: '≤', ge: '≥',
  asymp: '≈', sum: '∑', prod: '∏', radic: '√', part: '∂', int: '∫', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
// CPython's invalid-codepoint replacements for numeric references (the Windows-1252 block)
const _SL_INVALID_CHARREFS = { 0x00: '�', 0x0d: '\r', 0x80: '€', 0x81: '\x81', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†',
  0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8d: '\x8d', 0x8e: 'Ž', 0x8f: '\x8f', 0x90: '\x90',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š',
  0x9b: '›', 0x9c: 'œ', 0x9d: '\x9d', 0x9e: 'ž', 0x9f: 'Ÿ' };
adderModules.html = {
  escape: (s, ...a) => {
    const kw = _slKw(a);
    const quote = _slOpt(kw, 'quote', a[0] ?? true);
    s = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return quote ? s.replace(/"/g, '&quot;').replace(/'/g, '&#x27;') : s;
  },
  unescape: (s) => String(s).replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/g, (m, body) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (n in _SL_INVALID_CHARREFS) return _SL_INVALID_CHARREFS[n];
      if ((n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return '�';
      return String.fromCodePoint(n);
    }
    const name = body.replace(/;$/, '');
    return Object.hasOwn(_SL_ENT, name) ? _SL_ENT[name] : m;
  }),
};

// html.entities: the tables over the same entity set as unescape (CPython's are the full
// HTML 4 list in name2codepoint and the HTML5 list in html5)
{
  const n2c = [], c2n = [], defs = [], h5 = [];
  for (const [name, ch] of Object.entries(_SL_ENT)) {
    const cp = ch.codePointAt(0);
    if (name !== 'apos') { n2c.push([name, cp]); if (!c2n.some((e) => e[0] === cp)) c2n.push([cp, name]); defs.push([name, cp < 256 ? ch : `&#${cp};`]); }
    h5.push([name + ';', ch]);
    if (cp < 256) h5.push([name, ch]);
  }
  const entities = { __adderModule__: true, __name__: 'html.entities',
    name2codepoint: new PyDict(n2c), codepoint2name: new PyDict(c2n), entitydefs: new PyDict(defs), html5: new PyDict(h5) };
  adderModules.html.entities = entities;
  adderModules['html.entities'] = entities;
}

// ── textwrap ──
// CPython's TextWrapper algorithm: the same chunking regex (word / hyphen / em-dash
// boundaries), the same line filling and placeholder truncation, so wrap() splits where
// CPython's does. dedent / indent / shorten as in CPython.
const _SL_WS = '[\\t\\n\\x0b\\x0c\\r ]';
const _SL_NWS = '[^\\t\\n\\x0b\\x0c\\r ]';
const _SL_WP = '[\\p{L}\\p{N}\\p{M}_!"\'&.,?]';
const _SL_LT = '[\\p{L}\\p{M}_]';
const _SL_W = '[\\p{L}\\p{N}\\p{M}_]';
const _slWordsep = new RegExp(`(${_SL_WS}+|(?<=${_SL_WP})-{2,}(?=${_SL_W})|${_SL_NWS}+?(?:-(?:(?<=${_SL_LT}{2}-)|(?<=${_SL_LT}-${_SL_LT}-))(?=${_SL_LT}-?${_SL_LT})|(?=${_SL_WS}|$)|(?<=${_SL_WP})(?=-{2,}${_SL_W})))`, 'u');
const _slWordsepSimple = new RegExp(`(${_SL_WS}+)`);
const _slSentenceEnd = /[a-z][.!?]["']?$/;
const _slExpandTabs = (s, ts) => {
  let out = '', col = 0;
  for (const c of s) {
    if (c === '\t') { if (ts > 0) { const n = ts - (col % ts); out += ' '.repeat(n); col += n; } }
    else if (c === '\n' || c === '\r') { out += c; col = 0; }
    else { out += c; col++; }
  }
  return out;
};
class _SlTextWrapper {
  constructor(...a) {
    const kw = _slKw(a) || {};
    const names = ['width', 'initial_indent', 'subsequent_indent', 'expand_tabs', 'replace_whitespace', 'fix_sentence_endings',
      'break_long_words', 'drop_whitespace', 'break_on_hyphens', 'tabsize'];
    const d = { width: 70, initial_indent: '', subsequent_indent: '', expand_tabs: true, replace_whitespace: true,
      fix_sentence_endings: false, break_long_words: true, drop_whitespace: true, break_on_hyphens: true, tabsize: 8,
      max_lines: null, placeholder: ' [...]' };
    names.forEach((n, i) => { if (i < a.length) d[n] = a[i]; });
    for (const k of Object.keys(kw)) if (k !== '_kw') d[k] = kw[k];
    Object.assign(this, d);
  }
  _munge(text) {
    if (this.expand_tabs) text = _slExpandTabs(text, this.tabsize);
    if (this.replace_whitespace) text = text.replace(/[\t\n\x0b\x0c\r]/g, ' ');
    return text;
  }
  _split(text) {
    return text.split(this.break_on_hyphens ? _slWordsep : _slWordsepSimple).filter((c) => c);
  }
  _handleLongWord(chunks, cur, curLen, width) {
    const spaceLeft = width < 1 ? 1 : width - curLen;
    if (this.break_long_words) {
      let end = spaceLeft;
      const chunk = chunks[chunks.length - 1];
      if (this.break_on_hyphens && chunk.length > spaceLeft) {
        const hyphen = chunk.lastIndexOf('-', spaceLeft - 1);
        if (hyphen > 0 && [...chunk.slice(0, hyphen)].some((c) => c !== '-')) end = hyphen + 1;
      }
      cur.push(chunk.slice(0, end));
      chunks[chunks.length - 1] = chunk.slice(end);
    } else if (!cur.length) cur.push(chunks.pop());
  }
  _wrapChunks(chunks) {
    const lines = [];
    if (typeof this.width !== 'number' || !(this.width > 0)) throw new AdderError('ValueError', `invalid width ${pyRepr(this.width)} (must be > 0)`);
    if (this.max_lines !== null) {
      const indent = this.max_lines > 1 ? this.subsequent_indent : this.initial_indent;
      if (indent.length + this.placeholder.replace(/^\s+/, '').length > this.width) throw new AdderError('ValueError', 'placeholder too large for max width');
    }
    chunks.reverse();
    const strip = (s) => s.trim() === '';
    while (chunks.length) {
      let cur = [], curLen = 0;
      const indent = lines.length ? this.subsequent_indent : this.initial_indent;
      const width = this.width - indent.length;
      if (this.drop_whitespace && strip(chunks[chunks.length - 1]) && lines.length) chunks.pop();
      while (chunks.length) {
        const l = chunks[chunks.length - 1].length;
        if (curLen + l <= width) { cur.push(chunks.pop()); curLen += l; } else break;
      }
      if (chunks.length && chunks[chunks.length - 1].length > width) {
        this._handleLongWord(chunks, cur, curLen, width);
        curLen = cur.reduce((n, c) => n + c.length, 0);
      }
      if (this.drop_whitespace && cur.length && strip(cur[cur.length - 1])) { curLen -= cur[cur.length - 1].length; cur.pop(); }
      if (cur.length) {
        if (this.max_lines === null || lines.length + 1 < this.max_lines ||
            ((!chunks.length || (this.drop_whitespace && chunks.length === 1 && strip(chunks[0]))) && curLen <= width)) {
          lines.push(indent + cur.join(''));
        } else {
          let placed = false;
          while (cur.length) {
            if (!strip(cur[cur.length - 1]) && curLen + this.placeholder.length <= width) {
              cur.push(this.placeholder);
              lines.push(indent + cur.join(''));
              placed = true;
              break;
            }
            curLen -= cur[cur.length - 1].length;
            cur.pop();
          }
          if (!placed) {
            if (lines.length) {
              const prev = lines[lines.length - 1].replace(/\s+$/, '');
              if (prev.length + this.placeholder.length <= this.width) { lines[lines.length - 1] = prev + this.placeholder; break; }
            }
            lines.push(indent + this.placeholder.replace(/^\s+/, ''));
          }
          break;
        }
      }
    }
    return lines;
  }
  wrap(text) {
    const chunks = this._split(this._munge(String(text)));
    if (this.fix_sentence_endings) {
      let i = 0;
      while (i < chunks.length - 1) {
        if (chunks[i + 1] === ' ' && _slSentenceEnd.test(chunks[i])) { chunks[i + 1] = '  '; i += 2; } else i += 1;
      }
    }
    return this._wrapChunks(chunks);
  }
  fill(text) { return this.wrap(text).join('\n'); }
}
const _slTextWrapperType = _slType('TextWrapper', _SlTextWrapper, 'textwrap');
// wrap(text, width=70, **kw) / fill / shorten: the width may come positionally or by keyword
const _slWrapper = (a, extra) => { const kw = _slKw(a) || {}; return new _SlTextWrapper({ ...kw, width: a[0] ?? kw.width ?? 70, ...extra, _kw: true }); };
function _slDedent(text) {
  text = text.replace(/^[ \t]+$/gm, '');
  let margin = null;
  for (const m of text.matchAll(/^([ \t]*)(?:[^ \t\n])/gm)) {
    const ind = m[1];
    if (margin === null) margin = ind;
    else if (ind.startsWith(margin)) { /* deeper */ }
    else if (margin.startsWith(ind)) margin = ind;
    else { let i = 0; while (i < margin.length && i < ind.length && margin[i] === ind[i]) i++; margin = margin.slice(0, i); }
  }
  if (margin) text = text.split('\n').map((l) => (l.startsWith(margin) ? l.slice(margin.length) : l)).join('\n');
  return text;
}
const _slSplitlinesKeep = (s) => s.match(/[^\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]|$)/g).filter((l) => l !== '');
adderModules.textwrap = {
  TextWrapper: _slTextWrapperType,
  wrap: (text, ...a) => _slWrapper(a).wrap(text),
  fill: (text, ...a) => _slWrapper(a).fill(text),
  shorten: (text, ...a) => _slWrapper(a, { max_lines: 1 }).fill(String(text).trim().split(/\s+/).filter(Boolean).join(' ')),
  dedent: (t) => _slDedent(String(t)),
  indent: async (text, prefix, predicate) => {
    let out = '';
    for (const line of _slSplitlinesKeep(String(text))) {
      const keep = predicate == null ? line.trim() !== '' : await _slTruthy(predicate(line));
      out += (keep ? prefix : '') + line;
    }
    return out;
  },
};

// ── contextlib ──
// contextmanager (generator-based, either engine's generators), suppress, nullcontext,
// closing, ExitStack, redirect_stdout / redirect_stderr, AbstractContextManager. Not here:
// the async variants (asynccontextmanager, AsyncExitStack).
const _slNext = async (gen) => { const r = gen.next(); return _slIsThen(r) ? await r : r; };
class _SlGenCM {
  constructor(gen) { this._gen = gen; }
  async __enter__() {
    const r = await _slNext(this._gen);
    if (r.done) throw new AdderError('RuntimeError', "generator didn't yield");
    return r.value;
  }
  async __exit__(type, value) {
    if (type === null || type === undefined) {
      const r = await _slNext(this._gen);
      if (!r.done) throw new AdderError('RuntimeError', "generator didn't stop");
      return false;
    }
    let r;
    try {
      r = this._gen._jsThrow ? this._gen._jsThrow(excToThrowable(value)) : this._gen.throw(excToThrowable(value));
      if (_slIsThen(r)) r = await r;
    } catch (e) {
      if (excValue(e) === value) return false;   // re-raised: the with statement raises the original
      if (e && e.pyType === 'StopIteration') return true;
      throw e;
    }
    if (!r.done) throw new AdderError('RuntimeError', "generator didn't stop after throw()");
    return true;
  }
}
_SlGenCM.prototype.__adderClass__ = '_GeneratorContextManager';
function _slContextmanager(fn) {
  const wrapped = (...a) => _slThen(fn(...a), (gen) => new _SlGenCM(gen));
  wrapped._pyName = fn._pyName || fn.name; wrapped.__name__ = wrapped._pyName; wrapped.__wrapped__ = fn;
  return wrapped;
}
class _SlSuppress {
  constructor(...excs) { this._excs = excs; }
  __enter__() { return null; }
  __exit__(type, value) {
    if (type === null || type === undefined) return false;
    const thrown = excToThrowable(value);
    return this._excs.some((t) => excMatches(thrown, t));
  }
}
class _SlNullContext {
  constructor(enter = null) { this.enter_result = enter; }
  __enter__() { return this.enter_result; }
  __exit__() { return false; }
}
class _SlClosing {
  constructor(thing) { this.thing = thing; }
  __enter__() { return this.thing; }
  __exit__() { return _slThen(adderGetAttr(this.thing, 'close')(), () => false); }
}
class _SlExitStack {
  constructor() { this._cbs = []; }
  __enter__() { return this; }
  async enter_context(cm) {
    const v = await adderGetAttr(cm, '__enter__')();
    this._cbs.push({ cm });
    return v;
  }
  push(exit) { this._cbs.push({ exit }); return exit; }
  callback(fn, ...a) { const kw = _slKw(a); this._cbs.push({ fn: () => _slCall(fn, a, kw ? Object.fromEntries(Object.entries(kw).filter(([k]) => k !== '_kw')) : null) }); return fn; }
  pop_all() { const n = new _SlExitStack(); n._cbs = this._cbs; this._cbs = []; return n; }
  async close() { await this.__exit__(null, null, null); return null; }
  async __exit__(type, value, tb) {
    let pending = type == null ? null : value;
    let suppressed = false;
    while (this._cbs.length) {
      const cb = this._cbs.pop();
      try {
        if (cb.fn) await cb.fn();
        else {
          const exit = cb.cm ? adderGetAttr(cb.cm, '__exit__') : cb.exit;
          const r = await (pending === null ? exit(null, null, null) : exit(excTypeOf(excToThrowable(pending)), pending, tb));
          if (pending !== null && pyBool(r)) { pending = null; suppressed = true; }
        }
      } catch (e) { pending = excValue(e); suppressed = false; }
    }
    if (pending !== null && pending !== value) throw excToThrowable(pending);
    return type != null && (suppressed || pending === null);
  }
}
class _SlRedirect {
  constructor(target, which) { this._target = target; this._which = which; this._prev = []; }
  __enter__() {
    if (this._which === 'out') { this._prev.push(_stdio.redirect); _stdio.redirect = this._target; }
    else { this._prev.push(_stdio.err); _stdio.err = (s) => { adderGetAttr(this._target, 'write')(s); }; }
    return this._target;
  }
  __exit__() {
    if (this._which === 'out') _stdio.redirect = this._prev.pop(); else _stdio.err = this._prev.pop();
    return false;
  }
}
adderModules.contextlib = {
  contextmanager: _slContextmanager,
  suppress: _slType('suppress', _SlSuppress, 'contextlib'),
  nullcontext: _slType('nullcontext', _SlNullContext, 'contextlib'),
  closing: _slType('closing', _SlClosing, 'contextlib'),
  ExitStack: _slType('ExitStack', _SlExitStack, 'contextlib'),
  redirect_stdout: (t) => new _SlRedirect(t, 'out'),
  redirect_stderr: (t) => new _SlRedirect(t, 'err'),
};
_SlRedirect.prototype.__adderClass__ = 'redirect_stdout';

// ── io ──
// StringIO and BytesIO: in-memory files with CPython's read / write / seek semantics. Not
// here: TextIOWrapper over raw streams, buffered readers.
const _slIoErr = (closed) => { if (closed) throw new AdderError('ValueError', 'I/O operation on closed file.'); };
class _SlStringIO {
  constructor(initial = '', ...a) {
    _slKw(a);
    if (initial !== null && initial !== undefined && typeof initial === 'object' && initial._kw) initial = initial.initial_value ?? '';
    if (initial === null || initial === undefined) initial = '';
    if (typeof initial !== 'string') throw new AdderError('TypeError', `initial_value must be str or None, not ${pyTypeName(initial)}`);
    this._buf = initial; this._pos = 0; this.closed = false;
  }
  write(s) {
    _slIoErr(this.closed);
    if (typeof s !== 'string') throw new AdderError('TypeError', `string argument expected, got '${pyTypeName(s)}'`);
    if (this._pos > this._buf.length) this._buf += '\0'.repeat(this._pos - this._buf.length);
    this._buf = this._buf.slice(0, this._pos) + s + this._buf.slice(this._pos + s.length);
    this._pos += s.length;
    return s.length;
  }
  writelines(lines) { for (const l of pyIter(lines)) this.write(l); return null; }
  read(n = -1) {
    _slIoErr(this.closed);
    const end = n === null || n < 0 ? this._buf.length : Math.min(this._buf.length, this._pos + n);
    const r = this._buf.slice(this._pos, end);
    this._pos = Math.max(this._pos, end);
    return r;
  }
  readline(n = -1) {
    _slIoErr(this.closed);
    let end = this._buf.indexOf('\n', this._pos);
    end = end < 0 ? this._buf.length : end + 1;
    if (n !== null && n >= 0) end = Math.min(end, this._pos + n);
    const r = this._buf.slice(this._pos, end);
    this._pos = Math.max(this._pos, end);
    return r;
  }
  readlines() { const out = []; for (let l = this.readline(); l; l = this.readline()) out.push(l); return out; }
  getvalue() { _slIoErr(this.closed); return this._buf; }
  seek(pos, whence = 0) {
    _slIoErr(this.closed);
    if (whence === 0) { if (pos < 0) throw new AdderError('ValueError', `Negative seek position ${pos}`); this._pos = pos; }
    else if (whence === 1) { if (pos !== 0) throw new AdderError('OSError', "Can't do nonzero cur-relative seeks"); }
    else if (whence === 2) { if (pos !== 0) throw new AdderError('OSError', "Can't do nonzero end-relative seeks"); this._pos = this._buf.length; }
    else throw new AdderError('ValueError', `Invalid whence (${whence}, should be 0, 1 or 2)`);
    return this._pos;
  }
  tell() { _slIoErr(this.closed); return this._pos; }
  truncate(size = null) { _slIoErr(this.closed); if (size === null) size = this._pos; this._buf = this._buf.slice(0, size); return size; }
  close() { this.closed = true; return null; }
  flush() { return null; }
  readable() { return true; } writable() { return true; } seekable() { return true; } isatty() { return false; }
  __enter__() { return this; }
  __exit__() { this.close(); return false; }
  *[Symbol.iterator]() { for (let l = this.readline(); l; l = this.readline()) yield l; }
  __iter__() { return this[Symbol.iterator](); }
}
class _SlBytesIO {
  constructor(initial = null) {
    if (initial !== null && typeof initial === 'object' && initial._kw) initial = initial.initial_bytes ?? null;
    this._buf = initial === null || initial === undefined ? new Uint8Array(0) : Uint8Array.from(_slBytesLike(initial));
    this._len = this._buf.length; this._pos = 0; this.closed = false;
  }
  _grow(n) {
    if (n <= this._buf.length) return;
    const b = new Uint8Array(Math.max(n, this._buf.length * 2, 64));
    b.set(this._buf.subarray(0, this._len));
    this._buf = b;
  }
  write(b) {
    _slIoErr(this.closed);
    const src = _slBytesLike(b);
    this._grow(this._pos + src.length);
    this._buf.set(src, this._pos);
    this._pos += src.length;
    this._len = Math.max(this._len, this._pos);
    return src.length;
  }
  writelines(lines) { for (const l of pyIter(lines)) this.write(l); return null; }
  read(n = -1) {
    _slIoErr(this.closed);
    const end = n === null || n < 0 ? this._len : Math.min(this._len, this._pos + n);
    const r = this._buf.slice(Math.min(this._pos, this._len), end);
    this._pos = Math.max(this._pos, end);
    return r;
  }
  read1(n = -1) { return this.read(n); }
  readline(n = -1) {
    _slIoErr(this.closed);
    let end = this._buf.subarray(0, this._len).indexOf(10, this._pos);
    end = end < 0 ? this._len : end + 1;
    if (n !== null && n >= 0) end = Math.min(end, this._pos + n);
    const r = this._buf.slice(this._pos, end);
    this._pos = Math.max(this._pos, end);
    return r;
  }
  readlines() { const out = []; for (let l = this.readline(); l.length; l = this.readline()) out.push(l); return out; }
  getvalue() { _slIoErr(this.closed); return this._buf.slice(0, this._len); }
  getbuffer() { return this._buf.subarray(0, this._len); }
  seek(pos, whence = 0) {
    _slIoErr(this.closed);
    const base = whence === 0 ? 0 : whence === 1 ? this._pos : this._len;
    const p = base + pos;
    if (p < 0) throw new AdderError('ValueError', `negative seek value ${p}`);
    this._pos = p;
    return p;
  }
  tell() { _slIoErr(this.closed); return this._pos; }
  truncate(size = null) { if (size === null) size = this._pos; this._len = Math.min(this._len, size); return size; }
  close() { this.closed = true; return null; }
  flush() { return null; }
  readable() { return true; } writable() { return true; } seekable() { return true; } isatty() { return false; }
  __enter__() { return this; }
  __exit__() { this.close(); return false; }
  *[Symbol.iterator]() { for (let l = this.readline(); l.length; l = this.readline()) yield l; }
  __iter__() { return this[Symbol.iterator](); }
}
adderModules.io = {
  StringIO: _slType('StringIO', _SlStringIO, 'io'),
  BytesIO: _slType('BytesIO', _SlBytesIO, 'io'),
  SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2, DEFAULT_BUFFER_SIZE: 8192,
  UnsupportedOperation: makeExcType('UnsupportedOperation', 'OSError'),
};

// ── collections.abc ──
// CPython's own _collections_abc.py (frozen, vendored verbatim), over adder's ABCMeta: loaded when
// a program imports it — collections.abc is that same module, as in CPython. Then what CPython's C
// types and collections/__init__.py register, adder's JS types register (a deque is a
// MutableSequence), and typing's aliases point at the real classes (typing.Mapping[str, int]'s
// origin). It isn't loaded by `import collections` / `import typing`: compiling it costs a first
// import ~0.1 s, which a program that never asks for an ABC shouldn't pay.
frozenModuleHooks._collections_abc = async (abc) => {
  const c = adderModules._collections;
  const arr = adderModules.array;
  const registrations = [
    ['MutableSequence', [c.deque, arr && arr.array]],
    ['MutableMapping', [c.OrderedDict, c.defaultdict]],
  ];
  for (const [name, types] of registrations) {
    for (const t of types) if (typeof t === 'function' && t._pyClass) await adderGetAttr(abc[name], 'register')(t);
  }
  const forms = { AbstractSet: 'Set' };
  for (const k of ['Iterable', 'Iterator', 'Reversible', 'Generator', 'Sequence', 'MutableSequence', 'Mapping', 'MutableMapping',
    'Collection', 'Container', 'Hashable', 'Sized', 'Callable', 'Awaitable', 'Coroutine', 'AsyncIterator', 'AsyncIterable',
    'AsyncGenerator', 'MutableSet', 'MappingView', 'KeysView', 'ItemsView', 'ValuesView', 'ByteString']) forms[k] = k;
  for (const [k, a] of Object.entries(forms)) {
    const form = adderModules.typing[k];
    if (form && abc[a]) form.__origin__ = abc[a];
  }
};
