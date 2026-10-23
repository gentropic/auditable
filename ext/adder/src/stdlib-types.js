// adder stdlib — enum: builds classes, working on the classes either engine makes (a function
// with _pyName / _pyMRO / prototype / _pyOwnMembers) through __init_subclass__ (finishClass calls
// it on Enum's subclasses). (dataclasses is CPython's own dataclasses.py — pylib/.)
//
// Concat-bundled with the rest of adder: top-level names carry an `_st` prefix.

import {
  AdderError, PyTuple, PyDict, PySet, mkTuple, isPlainDict, adderGetAttr, pyTypeName, pyRepr, pyStr, pyReprMaybe,
  pyIter, pyBool, pyEq, pyLt, pyLe, pyGt, pyGe, pyAdd, pySub, pyMul, pyTrueDiv, pyFloorDiv, pyMod, pyPow,
  pyFormatValue, adderModules, makeExcType, finishClass, _typeObjects, _pyHash, setClassAttr, classOnlyAttr,
} from './builtins.js';

const _stIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _stKw = (args) => (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' &&
  args[args.length - 1]._kw === true ? args.pop() : null);
const _stHas = (kw, k) => !!kw && Object.hasOwn(kw, k) && k !== '_kw';
// join a list of maybe-promise strings
const _stJoin = (parts, f) => (parts.some(_stIsThen) ? Promise.all(parts).then(f) : f(parts));

// A class built from JS, in the shape both engines build (so isinstance, MRO walks, attribute
// inheritance and the __init_subclass__ hook all apply): calling it makes an instance and runs
// its __init__, unless the class answers calls itself (_pyNew).
function _stMakeClass(name, bases, attrs) {
  const cls = function (...args) {
    if (cls._pyNew) return cls._pyNew(...args);
    const instance = Object.create(cls.prototype);
    instance.__adderClass__ = name;
    instance.__adderType__ = cls;
    if (typeof cls.prototype.__init__ === 'function') {
      const r = cls.prototype.__init__.call(instance, ...args);
      if (_stIsThen(r)) return r.then(() => instance);
    }
    return instance;
  };
  cls.prototype = {};
  cls._pyName = name; cls._pyClass = true; cls.__name__ = name;
  cls._pyBases = bases.filter((b) => b && b._pyClass);
  const mro = [cls];
  for (const b of cls._pyBases) for (const c of (b._pyMRO || [b])) if (!mro.includes(c)) mro.push(c);
  cls._pyMRO = mro;
  for (let i = mro.length - 1; i >= 1; i--) {
    const base = mro[i];
    if (!base.prototype || !base._pyOwnMembers) continue;
    for (const key of base._pyOwnMembers) {
      const d = Object.getOwnPropertyDescriptor(base.prototype, key);
      if (d) Object.defineProperty(cls.prototype, key, d);
    }
  }
  cls._pyOwnMembers = new PySet();
  if (attrs) for (const [k, v] of attrs) setClassAttr(cls, k, v);
  return cls;
}
// a base class written in JS: its prototype members are inherited the way a Python base's are
function _stBaseClass(name, bases, proto, statics) {
  const cls = _stMakeClass(name, bases);
  for (const key of Reflect.ownKeys(proto)) {
    Object.defineProperty(cls.prototype, key, Object.getOwnPropertyDescriptor(proto, key));
    if (typeof key === 'string') cls._pyOwnMembers.add(key);
  }
  if (statics) Object.assign(cls, statics);
  cls.__module__ = 'enum';
  return cls;
}

// ── enum ──
// Enum, IntEnum, StrEnum, Flag, IntFlag, auto, unique, the functional API (Enum('Color',
// 'RED GREEN')), aliases, _missing_, member __init__ from tuple values, iteration / len /
// `in` / Color['RED'] / Color(1), and 3.12's str / repr / format for each kind. Not here:
// _generate_next_value_ overrides, member __new__, EnumMeta subclassing, Flag boundary modes.
class _StAuto { __repr__() { return 'auto()'; } }
_StAuto.prototype.__adderClass__ = 'auto';
const _stAuto = () => new _StAuto();
_stAuto._pyName = 'auto'; _stAuto._pyClass = true; _stAuto.__name__ = 'auto';

const _stEnumName = (m) => m.__adderType__._pyName;
// a class's kind, from the bases it reaches
function _stKind(cls) {
  const mro = cls._pyMRO || [];
  const has = (b) => mro.includes(b);
  return {
    flag: has(_stFlag),
    int: has(_stIntEnum) || has(_stIntFlag),
    str: has(_stStrEnum),
  };
}
function _stMember(cls, name, value) {
  const m = Object.create(cls.prototype);
  m.__adderClass__ = cls._pyName;
  m.__adderType__ = cls;
  m._name_ = name;
  m._value_ = value;
  // a str-mixin enum (`class Color(str, Enum)`, StrEnum): the member IS its string (a boxed str)
  if ((cls._pyStrBase || _stKind(cls).str) && typeof value === 'string') Object.defineProperty(m, '_pyStrValue', { value, enumerable: false, writable: false, configurable: false });
  return m;
}
// Flag value → member (a canonical one, or a composite named by its bits in definition order)
function _stFlagMember(cls, v) {
  const known = cls._value2member_.find(([val]) => val === v);
  if (known) return known[1];
  const cache = cls._stComposite || (cls._stComposite = new Map());
  if (cache.has(v)) return cache.get(v);
  const all = cls._member_names_.reduce((acc, n) => acc | cls._member_map_.get(n)._value_, 0);
  if (v & ~all && !_stKind(cls).int) throw new AdderError('ValueError', `${pyRepr(v)} is not a valid ${cls._pyName}`);
  const names = cls._member_names_.filter((n) => { const b = cls._member_map_.get(n)._value_; return b !== 0 && (v & b) === b; });
  const m = _stMember(cls, v === 0 ? null : names.join('|'), v);
  cache.set(v, m);
  return m;
}
// value → member, for Color(1)
function _stLookup(cls, value) {
  if (value && value.__adderType__ === cls) return value;
  for (const [v, m] of cls._value2member_) if (v === value || pyEq(v, value) === true) return m;
  if (_stKind(cls).flag && Number.isInteger(value)) return _stFlagMember(cls, value);
  if (typeof cls._missing_ === 'function') {
    const r = cls._missing_(value);
    const done = (m) => { if (m === null || m === undefined) throw new AdderError('ValueError', `${pyRepr(value)} is not a valid ${cls._pyName}`); return m; };
    return _stIsThen(r) ? r.then(done) : done(r);
  }
  throw new AdderError('ValueError', `${pyRepr(value)} is not a valid ${cls._pyName}`);
}
function _stEnumHook(cls) {
  const kind = _stKind(cls);
  // an enum with members cannot be extended
  for (const b of cls._pyMRO.slice(1)) {
    if (b._member_names_ && b._member_names_.length) throw new AdderError('TypeError', `<enum '${cls._pyName}'> cannot extend <enum '${b._pyName}'>`);
  }
  const candidates = [];
  for (const k of cls._pyAttrs || []) {
    if (k.startsWith('_')) continue;
    const v = cls[k];
    if (typeof v === 'function') continue;
    if (v !== null && typeof v === 'object' && (v.__property__ || typeof v.__get__ === 'function' || typeof v.__set__ === 'function' || typeof v.__delete__ === 'function')) continue;
    candidates.push([k, v]);
  }
  // the members' data type (CPython's _member_type_): the mixin — int for IntEnum / IntFlag, str for
  // StrEnum, a builtin or JS-backed base (`class C(float, Enum)`, `(date, Enum)`) — else object
  {
    const T = _typeObjects;
    const enumish = (b) => b && (b._stEnumBase || b._member_names_ !== undefined || b === _stEnum || b === _stFlag || b === _stReprEnum);
    let mt = kind.int ? T.int : kind.str ? T.str : null;
    if (!mt) {
      for (const b of cls._pyMRO.slice(1)) {
        if (!b || enumish(b) || b === T.object) continue;
        if (b._jsClass || ['int', 'float', 'str', 'bytes', 'complex', 'tuple', 'list', 'dict', 'set', 'frozenset', 'bool'].includes(b._pyName) && !b._pyMRO) { mt = b; break; }
        if (b._pyJsBase) { mt = b._pyJsBase; break; }
      }
    }
    cls._member_type_ = mt || T.object;
  }
  cls._member_names_ = [];
  cls._member_map_ = new PyDict();
  cls._value2member_ = [];
  cls._stAliases = [];
  const ownInit = cls._pyMRO.some((c) => c._pyOwnMembers && c._pyOwnMembers.has('__init__') && !c._stEnumBase);
  const inits = [];
  let last = null;
  for (let [name, value] of candidates) {
    if (value instanceof _StAuto) {
      if (kind.str) value = name.toLowerCase();
      else if (kind.flag) { const hi = cls._member_names_.reduce((a, n) => Math.max(a, cls._member_map_.get(n)._value_), 0); value = hi ? 2 ** Math.floor(Math.log2(hi) + 1) : 1; }
      else value = typeof last === 'number' ? last + 1 : 1;
    }
    if (kind.str && typeof value !== 'string') throw new AdderError('TypeError', `${pyRepr(value)} is not a string`);
    last = value;
    const canon = cls._value2member_.find(([v]) => v === value || pyEq(v, value) === true);
    if (canon) { setClassAttr(cls, name, canon[1]); classOnlyAttr(cls, name); cls._member_map_.set(name, canon[1]); cls._stAliases.push([name, canon[1]._name_]); continue; }
    const m = _stMember(cls, name, value);
    if (ownInit) inits.push(() => cls.prototype.__init__.call(m, ...(value instanceof PyTuple ? value : [value])));
    setClassAttr(cls, name, m);
    classOnlyAttr(cls, name);   // (an instance reads a base property of the name, not the member)
    // a Flag's canonical members are its single bits: a 0 or multi-bit value is a member (in
    // __members__, by value) but not iterated or counted, as CPython 3.11+
    const bits = kind.flag && typeof value === 'number' && Number.isInteger(value) && value >= 0;
    if (!bits || (value !== 0 && (value & (value - 1)) === 0)) cls._member_names_.push(name);
    cls._member_map_.set(name, m);
    cls._value2member_.push([value, m]);
  }
  // a Flag member iterates its bits (the engines copy only string-keyed members to subclasses)
  if (kind.flag) cls.prototype[Symbol.iterator] = _stFlagProto[Symbol.iterator];
  const members = () => cls._member_names_.map((n) => cls._member_map_.get(n));
  cls[Symbol.iterator] = function* () { yield* members(); };
  cls.__len__ = () => cls._member_names_.length;
  cls.__contains__ = (x) => (x && x.__adderType__ === cls) || cls._value2member_.some(([v]) => v === x || pyEq(v, x) === true);
  // (EnumType.__getitem__: the class's own subscript, Color['RED'] — marked so, as a str-based
  // enum's prototype has str's __getitem__ too)
  cls.__getitem__ = Object.assign((k) => { if (cls._member_map_.has(k)) return cls._member_map_.get(k); throw new AdderError('KeyError', pyRepr(k), undefined, [k]); }, { _pyMetaItem: true });
  cls.__reversed__ = () => members().reverse()[Symbol.iterator]();
  cls.__members__ = cls._member_map_;
  cls._pyNew = (...a) => {
    const kw = _stKw(a);
    if (a.length >= 2 || (kw && ['names', 'type', 'module', 'qualname', 'start', 'boundary'].some((k) => _stHas(kw, k)))) return _stFunctional(cls, a, kw);
    return _stLookup(cls, a[0]);
  };
  let r;
  for (const f of inits) { r = _stIsThen(r) ? r.then(f) : f(); }
  return _stIsThen(r) ? r.then(() => null) : null;
}
// Enum('Color', 'RED GREEN') / Enum('Color', ['RED', 'GREEN']) / (('RED', 1), …) / {'RED': 1}
function _stFunctional(base, a, kw) {
  const name = a[0];
  let names = a.length > 1 ? a[1] : kw && _stHas(kw, 'names') ? kw.names : null;
  const start = kw && _stHas(kw, 'start') ? kw.start : 1;
  let entries;
  if (names === null || names === undefined) names = [];
  if (typeof names === 'string') names = names.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (names instanceof Map) entries = [...names];
  else if (isPlainDict(names)) entries = Object.entries(names);
  else {
    const items = [...pyIter(names)];
    entries = items.map((it, i) => (typeof it === 'string' ? [it, _stKind(base).flag ? 2 ** i : start + i] : [it[0], it[1]]));
  }
  const cls = _stMakeClass(name, [base], entries);
  const r = finishClass(cls, []);
  return _stIsThen(r) ? r.then(() => cls) : cls;
}
const _stIntOps = {
  __int__() { return this._value_; },
  __index__() { return this._value_; },
  __float__() { return this._value_; },
  valueOf() { return this._value_; },
  __bool__() { return this._value_ !== 0; },
  __hash__() { return _pyHash(this._value_); },
  __eq__(o) { return o === this || pyEq(this._value_, o && o._value_ !== undefined && typeof o._value_ === 'number' ? o._value_ : o); },
  __ne__(o) { return !this.__eq__(o); },
  __lt__(o) { return pyLt(this._value_, o && o._value_ !== undefined ? o._value_ : o); },
  __le__(o) { return pyLe(this._value_, o && o._value_ !== undefined ? o._value_ : o); },
  __gt__(o) { return pyGt(this._value_, o && o._value_ !== undefined ? o._value_ : o); },
  __ge__(o) { return pyGe(this._value_, o && o._value_ !== undefined ? o._value_ : o); },
  __add__(o) { return pyAdd(this._value_, o); }, __radd__(o) { return pyAdd(o, this._value_); },
  __sub__(o) { return pySub(this._value_, o); }, __rsub__(o) { return pySub(o, this._value_); },
  __mul__(o) { return pyMul(this._value_, o); }, __rmul__(o) { return pyMul(o, this._value_); },
  __truediv__(o) { return pyTrueDiv(this._value_, o); }, __rtruediv__(o) { return pyTrueDiv(o, this._value_); },
  __floordiv__(o) { return pyFloorDiv(this._value_, o); }, __rfloordiv__(o) { return pyFloorDiv(o, this._value_); },
  __mod__(o) { return pyMod(this._value_, o); }, __rmod__(o) { return pyMod(o, this._value_); },
  __pow__(o) { return pyPow(this._value_, o); }, __rpow__(o) { return pyPow(o, this._value_); },
  __neg__() { return -this._value_; }, __pos__() { return this._value_; }, __abs__() { return Math.abs(this._value_); },
};
const _stEnumProto = {
  get name() { return this._name_; },
  get value() { return this._value_; },
  __repr__() {
    return this._name_ === null ? `<${_stEnumName(this)}: ${pyRepr(this._value_)}>` : `<${_stEnumName(this)}.${this._name_}: ${pyRepr(this._value_)}>`;
  },
  __str__() { return this._name_ === null ? `${_stEnumName(this)}(${pyRepr(this._value_)})` : `${_stEnumName(this)}.${this._name_}`; },
  __format__(spec) { return pyFormatValue(this.__str__(), spec || ''); },
  __reduce_ex__() { return mkTuple([this.__adderType__, mkTuple([this._value_])]); },
};
// IntEnum / StrEnum print as their values (3.11+); IntEnum is an int
const _stReprValueProto = {
  __str__() { return pyStr(this._value_); },
  __format__(spec) { return pyFormatValue(this._value_, spec || ''); },
};
const _stFlagProto = {
  __or__(o) { return _stFlagOp(this, o, (a, b) => a | b); },
  __and__(o) { return _stFlagOp(this, o, (a, b) => a & b); },
  __xor__(o) { return _stFlagOp(this, o, (a, b) => a ^ b); },
  __ror__(o) { return _stFlagOp(this, o, (a, b) => a | b); },
  __rand__(o) { return _stFlagOp(this, o, (a, b) => a & b); },
  __rxor__(o) { return _stFlagOp(this, o, (a, b) => a ^ b); },
  __invert__() {
    const cls = this.__adderType__;
    const all = cls._member_names_.reduce((acc, n) => acc | cls._member_map_.get(n)._value_, 0);
    return _stFlagMember(cls, all & ~this._value_);
  },
  __contains__(o) {
    if (!o || o.__adderType__ !== this.__adderType__) throw new AdderError('TypeError', `unsupported operand type(s) for 'in': '${pyTypeName(o)}' and '${pyTypeName(this)}'`);
    return (this._value_ & o._value_) === o._value_;
  },
  __bool__() { return this._value_ !== 0; },
  __len__() { return [..._stFlagProto[Symbol.iterator].call(this)].length; },
  *[Symbol.iterator]() {
    const cls = this.__adderType__;
    for (const n of cls._member_names_) { const m = cls._member_map_.get(n); if (m._value_ !== 0 && (this._value_ & m._value_) === m._value_ && (m._value_ & (m._value_ - 1)) === 0) yield m; }
  },
  __iter__() { return _stFlagProto[Symbol.iterator].call(this); },
};
function _stFlagOp(self, o, f) {
  const cls = self.__adderType__;
  if (o && o.__adderType__ === cls) return _stFlagMember(cls, f(self._value_, o._value_));
  if (_stKind(cls).int && Number.isInteger(o)) return _stFlagMember(cls, f(self._value_, o));
  throw new AdderError('TypeError', `unsupported operand type(s): '${pyTypeName(self)}' and '${pyTypeName(o)}'`);
}
const _stEnum = _stBaseClass('Enum', [], _stEnumProto, { __init_subclass__: _stEnumHook, _stEnumBase: true });
_stEnum._pyNew = (...a) => { const kw = _stKw(a); return _stFunctional(_stEnum, a, kw); };
const _stReprEnum = _stBaseClass('ReprEnum', [_stEnum], _stReprValueProto, { _stEnumBase: true });
const _stIntProtoAll = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ ..._stIntOps }));
const _stIntEnum = _stBaseClass('IntEnum', [_stReprEnum], _stIntProtoAll, { _stEnumBase: true });
const _stStrEnum = _stBaseClass('StrEnum', [_stReprEnum], {
  __eq__(o) { return o === this || (typeof o === 'string' && o === this._value_); },
  __hash__() { return _pyHash(this._value_); },
  toString() { return this._value_; },
}, { _stEnumBase: true });
const _stFlag = _stBaseClass('Flag', [_stEnum], _stFlagProto, { _stEnumBase: true });
const _stIntFlag = _stBaseClass('IntFlag', [_stFlag, _stReprEnum], _stIntProtoAll, { _stEnumBase: true });
// the bases' own member types and (empty) member tables, as CPython's
for (const [c, t] of [[_stEnum, 'object'], [_stReprEnum, 'object'], [_stFlag, 'object'], [_stIntEnum, 'int'], [_stIntFlag, 'int'], [_stStrEnum, 'str']]) {
  Object.defineProperty(c, '_member_type_', { get: () => _typeObjects[t], configurable: true });
  if (c._member_names_ === undefined) c._member_names_ = [];
  if (c._member_map_ === undefined) c._member_map_ = new PyDict();
}
// int / str as bases too, once the builtins exist (isinstance(Color.RED, int) for an IntEnum)
// (the engines build a subclass's MRO from _pyBases, so the builtin type goes there, first, as
// in CPython's `class IntEnum(int, ReprEnum)`)
for (const [b, t] of [[_stIntEnum, 'int'], [_stStrEnum, 'str'], [_stIntFlag, 'int']]) {
  const ownBases = b._pyBases, ownMro = b._pyMRO;
  Object.defineProperty(b, '_pyBases', { get() { const tt = _typeObjects[t]; return tt ? [tt, ...ownBases] : ownBases; }, configurable: true });
  Object.defineProperty(b, '_pyMRO', { get() { const tt = _typeObjects[t]; return tt ? [ownMro[0], tt, ...ownMro.slice(1)] : ownMro; }, configurable: true });
}
for (const b of [_stReprEnum, _stIntEnum, _stStrEnum, _stFlag, _stIntFlag]) b._pyNew = (...a) => { const kw = _stKw(a); return _stFunctional(b, a, kw); };
function _stUnique(cls) {
  if (cls._stAliases && cls._stAliases.length) {
    throw new AdderError('ValueError', `duplicate values found in <enum '${cls._pyName}'>: ${cls._stAliases.map(([a, c]) => `${a} -> ${c}`).join(', ')}`);
  }
  return cls;
}
adderModules.enum = {
  Enum: _stEnum, IntEnum: _stIntEnum, StrEnum: _stStrEnum, Flag: _stFlag, IntFlag: _stIntFlag, ReprEnum: _stReprEnum,
  auto: _stAuto, unique: _stUnique, EnumMeta: _typeObjects.type || null, EnumType: _typeObjects.type || null,
  member: (v) => v, nonmember: (v) => v,
  global_enum: (cls) => cls, verify: () => (cls) => cls,
  property: (...a) => adderModules.builtins.property(...a),
};
// the rest of CPython's enum surface, as names: FlagBoundary / EnumCheck and their members, the
// global_* helpers, the pickle helpers, EnumDict, and the private hooks the stdlib uses
{
  const E = adderModules.enum;
  E.FlagBoundary = _stStrEnum('FlagBoundary', [['STRICT', 'strict'], ['CONFORM', 'conform'], ['EJECT', 'eject'], ['KEEP', 'keep']].map((p) => mkTuple(p)));
  for (const n of ['STRICT', 'CONFORM', 'EJECT', 'KEEP']) E[n] = adderGetAttr(E.FlagBoundary, n);
  E.EnumCheck = _stStrEnum('EnumCheck', [['CONTINUOUS', 'no skipped integer values'], ['NAMED_FLAGS', 'multi-flag aliases may not contain unnamed flags'], ['UNIQUE', 'one name per value']].map((p) => mkTuple(p)));
  for (const n of ['CONTINUOUS', 'NAMED_FLAGS', 'UNIQUE']) E[n] = adderGetAttr(E.EnumCheck, n);
  // global_enum's reprs: module.NAME for a member, as CPython's global_enum installs
  E.global_enum_repr = (self) => `${self.__module__ || adderGetAttr(adderGetAttr(self, '__class__'), '__module__')}.${adderGetAttr(self, '_name_')}`;
  E.global_flag_repr = E.global_enum_repr;
  E.global_str = (self) => String(adderGetAttr(self, '_name_'));
  E.pickle_by_global_name = (self, proto) => adderGetAttr(self, '_name_');
  E.pickle_by_enum_name = (self, proto) => mkTuple([adderModules.builtins.getattr, mkTuple([adderGetAttr(self, '__class__'), adderGetAttr(self, '_name_')])]);
  E.EnumDict = _typeObjects.dict || null;
  // _iter_bits_lsb(num): each set bit's value, lowest first
  E._iter_bits_lsb = function* (num) {
    const original = num;
    if (num !== null && typeof num === 'object' && num._value_ !== undefined) num = num._value_;
    if (num < 0) throw new AdderError('ValueError', `${pyRepr(original)} is not a positive integer`);
    let n = BigInt(num);
    while (n) { const b = n & -n; yield n <= 9007199254740991n ? Number(b) : b; n ^= b; }
  };
  // _simple_enum(etype=Enum): the stdlib's decorator making a plain class an enum of etype (ast's
  // _Precedence, re's flags) — here, the class made again with etype as its base, from its own
  // namespace: members, methods and docstring (adder's enums are built as their class is)
  E._simple_enum = (etype = _stEnum, ...rest) => (cls) => {
    if (etype !== null && typeof etype === 'object' && etype._kw) etype = _stEnum;
    const d = adderGetAttr(cls, '__dict__');
    const ns = new PyDict();
    for (const k of pyIter(d)) if (k !== '__dict__' && k !== '__weakref__') ns.set(k, adderGetAttr(d, '__getitem__')(k));
    const doc = adderGetAttr(cls, '__doc__');
    if (doc !== null && doc !== undefined) ns.set('__doc__', doc);
    return adderModules.builtins.type(cls._pyName, mkTuple([etype]), ns);
  };
  E._test_simple_enum = () => { throw new AdderError('NotImplementedError', 'enum._test_simple_enum is not available in adder'); };
}
