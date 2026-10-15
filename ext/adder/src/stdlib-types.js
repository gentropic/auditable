// adder stdlib — enum and dataclasses: the two modules that build classes. Both work on the
// classes either engine makes (a function with _pyName / _pyMRO / prototype / _pyOwnMembers):
// enum through __init_subclass__ (finishClass calls it on Enum's subclasses), dataclasses as a
// decorator reading __annotations__.
//
// Concat-bundled with the rest of adder: top-level names carry an `_st` prefix.

import {
  AdderError, PyTuple, PyDict, PySet, mkTuple, isPlainDict, pyTypeName, pyRepr, pyStr, pyReprMaybe,
  pyIter, pyBool, pyEq, pyLt, pyLe, pyGt, pyGe, pyAdd, pySub, pyMul, pyTrueDiv, pyFloorDiv, pyMod, pyPow,
  pyFormatValue, adderModules, makeExcType, finishClass, _typeObjects, _pyHash, setClassAttr,
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
    candidates.push([k, v]);
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
    if (canon) { setClassAttr(cls, name, canon[1]); cls._member_map_.set(name, canon[1]); cls._stAliases.push([name, canon[1]._name_]); continue; }
    const m = _stMember(cls, name, value);
    if (ownInit) inits.push(() => cls.prototype.__init__.call(m, ...(value instanceof PyTuple ? value : [value])));
    setClassAttr(cls, name, m);
    cls._member_names_.push(name);
    cls._member_map_.set(name, m);
    cls._value2member_.push([value, m]);
  }
  // a Flag member iterates its bits (the engines copy only string-keyed members to subclasses)
  if (kind.flag) cls.prototype[Symbol.iterator] = _stFlagProto[Symbol.iterator];
  const members = () => cls._member_names_.map((n) => cls._member_map_.get(n));
  cls[Symbol.iterator] = function* () { yield* members(); };
  cls.__len__ = () => cls._member_names_.length;
  cls.__contains__ = (x) => (x && x.__adderType__ === cls) || cls._value2member_.some(([v]) => v === x || pyEq(v, x) === true);
  cls.__getitem__ = (k) => { if (cls._member_map_.has(k)) return cls._member_map_.get(k); throw new AdderError('KeyError', pyRepr(k), undefined, [k]); };
  cls.__reversed__ = () => members().reverse()[Symbol.iterator]();
  cls.__members__ = cls._member_map_;
  cls._pyNew = (...a) => {
    const kw = _stKw(a);
    if (a.length >= 2 || (kw && _stHas(kw, 'names'))) return _stFunctional(cls, a, kw);
    return _stLookup(cls, a[0]);
  };
  let r;
  for (const f of inits) { r = _stIsThen(r) ? r.then(f) : f(); }
  return _stIsThen(r) ? r.then(() => null) : null;
}
// Enum('Color', 'RED GREEN') / Enum('Color', ['RED', 'GREEN']) / (('RED', 1), …) / {'RED': 1}
function _stFunctional(base, a, kw) {
  const name = a[0];
  let names = a.length > 1 ? a[1] : kw.names;
  const start = kw && _stHas(kw, 'start') ? kw.start : 1;
  let entries;
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
  global_enum: (cls) => cls, verify: () => (cls) => cls, property: (f) => ({ __property__: true, fget: f, fset: null }),
};

// ── dataclasses ──
// @dataclass (and @dataclass(init=, repr=, eq=, order=, frozen=, unsafe_hash=, kw_only=,
// match_args=)), field(), fields(), asdict(), astuple(), replace(), is_dataclass(),
// make_dataclass(), KW_ONLY, InitVar, __post_init__, inherited fields, frozen instances
// (FrozenInstanceError), eq dataclasses unhashable as in CPython. The field list comes from the
// class body's annotations, kept as their source text (fields()[i].type is a string, as under
// `from __future__ import annotations`). Not here: slots=True's __slots__, weakref_slot.
const _stFrozenErr = makeExcType('FrozenInstanceError', 'AttributeError');
const _ST_MISSING = Object.freeze({ __adderClass__: '_MISSING_TYPE', __repr__: () => '<dataclasses._MISSING_TYPE object>' });
const _ST_KW_ONLY = Object.freeze({ __adderClass__: '_KW_ONLY_TYPE', __repr__: () => '<dataclasses._KW_ONLY_TYPE object>' });
class _StField {
  constructor(o) {
    this.name = null; this.type = null;
    this.default = o.default; this.default_factory = o.default_factory;
    this.init = o.init; this.repr = o.repr; this.hash = o.hash; this.compare = o.compare;
    this.metadata = o.metadata; this.kw_only = o.kw_only; this._ftype = 'field';
  }
  __repr__() {
    const d = (v) => (v === _ST_MISSING ? '<dataclasses._MISSING_TYPE object>' : pyRepr(v));
    return `Field(name=${pyRepr(this.name)},type=${pyRepr(this.type)},default=${d(this.default)},default_factory=${d(this.default_factory)},init=${pyRepr(this.init)},repr=${pyRepr(this.repr)},hash=${pyRepr(this.hash)},compare=${pyRepr(this.compare)},metadata=${pyRepr(this.metadata)},kw_only=${d(this.kw_only)},_field_type=_FIELD)`;
  }
}
_StField.prototype.__adderClass__ = 'Field';
function _stFieldFn(...a) {
  const kw = _stKw(a) || {};
  const g = (k, d) => (_stHas(kw, k) ? kw[k] : d);
  if (_stHas(kw, 'default') && _stHas(kw, 'default_factory')) throw new AdderError('ValueError', 'cannot specify both default and default_factory');
  return new _StField({ default: g('default', _ST_MISSING), default_factory: g('default_factory', _ST_MISSING), init: g('init', true),
    repr: g('repr', true), hash: g('hash', null), compare: g('compare', true), metadata: g('metadata', new PyDict()), kw_only: g('kw_only', _ST_MISSING) });
}
const _stIsMutableDefault = (v) => (Array.isArray(v) && !(v instanceof PyTuple)) || v instanceof Map || isPlainDict(v) || (v instanceof Set && !v._frozen);
const _stTypeName = (v) => (Array.isArray(v) ? 'list' : v instanceof Set ? 'set' : 'dict');
// "'a'" / "'a' and 'b'" / "'a', 'b', and 'c'" — CPython's missing-argument list
const _stNameList = (ns) => (ns.length === 1 ? `'${ns[0]}'` : ns.length === 2 ? `'${ns[0]}' and '${ns[1]}'` : `${ns.slice(0, -1).map((n) => `'${n}'`).join(', ')}, and '${ns[ns.length - 1]}'`);
const _stDcOf = (x) => (typeof x === 'function' && x._pyClass ? x : x && x.__adderType__);
function _stProcess(cls, p) {
  const fields = new Map();
  for (const b of [...cls._pyMRO.slice(1)].reverse()) if (b.__dataclass_fields__) for (const [k, f] of b.__dataclass_fields__) fields.set(k, f);
  let kwOnlyFromHere = false;
  const ann = Object.hasOwn(cls, '__annotations__') && cls.__annotations__ ? [...cls.__annotations__] : [];
  for (const [name, type] of ann) {
    const t = String(type);
    if (/^(typing\.|dataclasses\.)?KW_ONLY$/.test(t)) { kwOnlyFromHere = true; continue; }
    if (/^(typing\.)?ClassVar(\[|$)/.test(t)) continue;
    let f;
    const dflt = cls._pyAttrs && cls._pyAttrs.has(name) ? cls[name] : _ST_MISSING;
    if (dflt instanceof _StField) f = dflt;
    else f = _stFieldFn({ _kw: true, ...(dflt === _ST_MISSING ? {} : { default: dflt }) });
    f.name = name; f.type = t;
    f._ftype = /^(dataclasses\.)?InitVar(\[|$)/.test(t) ? 'initvar' : 'field';
    if (f.kw_only === _ST_MISSING) f.kw_only = kwOnlyFromHere || !!p.kw_only;
    if (f.default !== _ST_MISSING && _stIsMutableDefault(f.default)) {
      throw new AdderError('ValueError', `mutable default <class '${_stTypeName(f.default)}'> for field ${name} is not allowed: use default_factory`);
    }
    if (f._ftype === 'field' && f.default !== _ST_MISSING) setClassAttr(cls, name, f.default);
    else if (cls._pyAttrs && cls._pyAttrs.has(name)) { delete cls[name]; cls._pyAttrs.delete(name); }
    fields.set(name, f);
  }
  const all = [...fields.values()];
  const real = all.filter((f) => f._ftype === 'field');
  const initFields = all.filter((f) => f.init);
  const positional = initFields.filter((f) => !f.kw_only);
  const kwonly = initFields.filter((f) => f.kw_only);
  const hasDefault = (f) => f.default !== _ST_MISSING || f.default_factory !== _ST_MISSING;
  let seenDefault = null;
  for (const f of positional) {
    if (hasDefault(f)) seenDefault = f;
    else if (seenDefault) throw new AdderError('TypeError', `non-default argument '${f.name}' follows default argument '${seenDefault.name}'`);
  }
  const fieldMap = new PyDict(); for (const f of all) fieldMap.set(f.name, f);
  cls.__dataclass_fields__ = fieldMap;
  cls.__dataclass_params__ = { __adderClass__: '_DataclassParams', ...p };
  const own = (k) => cls._pyOwnMembers.has(k);
  const set = (k, fn) => { cls.prototype[k] = fn; cls._pyOwnMembers.add(k); };
  const qual = cls._pyName;
  if (p.init && !own('__init__')) {
    set('__init__', function (...args) {
      const kw = _stKw(args);
      if (args.length > positional.length) {
        const req = positional.filter((f) => !hasDefault(f)).length + 1, max = positional.length + 1;
        const takes = req === max ? `${max} positional argument${max > 1 ? 's' : ''}` : `from ${req} to ${max} positional arguments`;
        throw new AdderError('TypeError', `${qual}.__init__() takes ${takes} but ${args.length + 1} were given`);
      }
      if (kw) {
        for (const k of Object.keys(kw)) {
          if (k === '_kw') continue;
          const f = fields.get(k);
          if (!f || !f.init) throw new AdderError('TypeError', `${qual}.__init__() got an unexpected keyword argument '${k}'`);
          const pi = positional.indexOf(f);
          if (pi >= 0 && pi < args.length) throw new AdderError('TypeError', `${qual}.__init__() got multiple values for argument '${k}'`);
        }
      }
      const vals = new Map();
      const missPos = [], missKw = [];
      positional.forEach((f, i) => {
        if (i < args.length) vals.set(f, args[i]);
        else if (_stHas(kw, f.name)) vals.set(f, kw[f.name]);
        else if (!hasDefault(f)) missPos.push(f.name);
      });
      for (const f of kwonly) { if (_stHas(kw, f.name)) vals.set(f, kw[f.name]); else if (!hasDefault(f)) missKw.push(f.name); }
      if (missPos.length) throw new AdderError('TypeError', `${qual}.__init__() missing ${missPos.length} required positional argument${missPos.length > 1 ? 's' : ''}: ${_stNameList(missPos)}`);
      if (missKw.length) throw new AdderError('TypeError', `${qual}.__init__() missing ${missKw.length} required keyword-only argument${missKw.length > 1 ? 's' : ''}: ${_stNameList(missKw)}`);
      const self = this;
      const initvars = [];
      const steps = [];
      for (const f of all) {
        if (vals.has(f)) {
          const v = vals.get(f);
          if (f._ftype === 'initvar') initvars.push(v); else self[f.name] = v;
        } else if (f.default !== _ST_MISSING) {
          if (f._ftype === 'initvar') initvars.push(f.default); else self[f.name] = f.default;
        } else if (f.default_factory !== _ST_MISSING && f._ftype === 'field') {
          steps.push(() => { const r = f.default_factory(); if (_stIsThen(r)) return r.then((v) => { self[f.name] = v; }); self[f.name] = r; return null; });
        }
      }
      if (typeof self.__post_init__ === 'function') steps.push(() => self.__post_init__(...initvars));
      let r = null;
      for (const s of steps) r = _stIsThen(r) ? r.then(s) : s();
      return _stIsThen(r) ? r.then(() => null) : null;
    });
  }
  if (p.repr && !own('__repr__')) {
    set('__repr__', function () {
      const parts = real.filter((f) => f.repr).map((f) => {
        const r = pyReprMaybe(this[f.name]);
        return _stIsThen(r) ? r.then((s) => `${f.name}=${s}`) : `${f.name}=${r}`;
      });
      return _stJoin(parts, (ps) => `${qual}(${ps.join(', ')})`);
    });
  }
  const cmpFields = real.filter((f) => f.compare);
  const tupleOf = (o) => mkTuple(cmpFields.map((f) => o[f.name]));
  if (p.eq && !own('__eq__')) {
    set('__eq__', function (o) { return o === this || (!!o && o.__adderType__ === this.__adderType__ && pyEq(tupleOf(this), tupleOf(o))); });
  }
  if (p.order) {
    for (const [k, op, f] of [['__lt__', '<', pyLt], ['__le__', '<=', pyLe], ['__gt__', '>', pyGt], ['__ge__', '>=', pyGe]]) {
      if (own(k)) throw new AdderError('TypeError', `Cannot overwrite attribute ${k} in class ${qual}. Consider using functools.total_ordering`);
      set(k, function (o) {
        if (!o || o.__adderType__ !== this.__adderType__) throw new AdderError('TypeError', `'${op}' not supported between instances of '${pyTypeName(this)}' and '${pyTypeName(o)}'`);
        return f(tupleOf(this), tupleOf(o));
      });
    }
  }
  const hashFields = real.filter((f) => (f.hash === null ? f.compare : f.hash));
  if (p.unsafe_hash || (p.eq && p.frozen)) {
    if (!own('__hash__') || p.unsafe_hash) set('__hash__', function () { return _pyHash(mkTuple(hashFields.map((f) => this[f.name]))); });
  } else if (p.eq && !own('__hash__')) {
    cls.prototype.__hash__ = null;   // unhashable, as CPython makes an eq dataclass that isn't frozen
  }
  if (p.frozen) { cls.prototype.__dataclass_frozen__ = true; }
  if (p.match_args) cls.__match_args__ = mkTuple(positional.map((f) => f.name));
  set('__replace__', function (...a) { return _stReplace(this, ...a); });
  return cls;
}
const _ST_DEFAULTS = { init: true, repr: true, eq: true, order: false, unsafe_hash: false, frozen: false, match_args: true, kw_only: false, slots: false, weakref_slot: false };
function _stDataclass(...a) {
  if (a.length === 1 && typeof a[0] === 'function' && a[0]._pyClass) return _stProcess(a[0], { ..._ST_DEFAULTS });
  const kw = _stKw(a) || {};
  const p = { ..._ST_DEFAULTS };
  for (const k of Object.keys(kw)) if (k !== '_kw') p[k] = !!kw[k];
  if (p.order && !p.eq) throw new AdderError('ValueError', 'eq must be true if order is true');
  return (cls) => _stProcess(cls, p);
}
function _stFields(x) {
  const cls = _stDcOf(x);
  if (!cls || !cls.__dataclass_fields__) throw new AdderError('TypeError', 'must be called with a dataclass type or instance');
  return mkTuple([...cls.__dataclass_fields__.values()].filter((f) => f._ftype === 'field'));
}
const _stIsDcInstance = (x) => x !== null && typeof x === 'object' && !!x.__adderType__ && !!x.__adderType__.__dataclass_fields__;
function _stAsInner(x, mk, tupleMode) {
  if (_stIsDcInstance(x)) {
    const pairs = _stFields(x).map((f) => [f.name, _stAsInner(x[f.name], mk, tupleMode)]);
    return tupleMode ? mkTuple(pairs.map((p) => p[1])) : mk(pairs);
  }
  if (x instanceof PyTuple) {
    const items = x.map((v) => _stAsInner(v, mk, tupleMode));
    return x._fields && x.__adderType__ ? x.__adderType__(...items) : mkTuple(items);
  }
  if (Array.isArray(x)) return x.map((v) => _stAsInner(v, mk, tupleMode));
  if (x instanceof Map) { const m = new PyDict(); for (const [k, v] of x) m.set(_stAsInner(k, mk, tupleMode), _stAsInner(v, mk, tupleMode)); return m; }
  if (isPlainDict(x)) { const o = {}; for (const k of Object.keys(x)) o[k] = _stAsInner(x[k], mk, tupleMode); return o; }
  return adderModules.copy.deepcopy(x);
}
function _stAsdict(obj, ...a) {
  if (!_stIsDcInstance(obj)) throw new AdderError('TypeError', 'asdict() should be called on dataclass instances');
  const kw = _stKw(a);
  const factory = kw && _stHas(kw, 'dict_factory') ? kw.dict_factory : null;
  const mk = factory ? (pairs) => factory(pairs.map((p) => mkTuple(p))) : (pairs) => Object.fromEntries(pairs);
  return _stAsInner(obj, mk, false);
}
function _stAstuple(obj) {
  if (!_stIsDcInstance(obj)) throw new AdderError('TypeError', 'astuple() should be called on dataclass instances');
  return _stAsInner(obj, null, true);
}
function _stReplace(obj, ...a) {
  if (!_stIsDcInstance(obj)) throw new AdderError('TypeError', 'replace() should be called on dataclass instances');
  const kw = _stKw(a) || {};
  const cls = obj.__adderType__;
  const args = { _kw: true };
  for (const f of cls.__dataclass_fields__.values()) {
    if (f._ftype === 'initvar') {
      if (!f.init) continue;
      if (!_stHas(kw, f.name) && f.default === _ST_MISSING) throw new AdderError('TypeError', `InitVar '${f.name}' must be specified with replace()`);
      if (_stHas(kw, f.name)) args[f.name] = kw[f.name];
      continue;
    }
    if (!f.init) { if (_stHas(kw, f.name)) throw new AdderError('TypeError', `field ${f.name} is declared with init=False, it cannot be specified with replace()`); continue; }
    args[f.name] = _stHas(kw, f.name) ? kw[f.name] : obj[f.name];
  }
  for (const k of Object.keys(kw)) if (k !== '_kw' && !cls.__dataclass_fields__.has(k)) throw new AdderError('TypeError', `${cls._pyName}.__init__() got an unexpected keyword argument '${k}'`);
  return cls(args);
}
function _stMakeDataclass(name, fieldsIn, ...a) {
  const kw = _stKw(a) || {};
  const bases = _stHas(kw, 'bases') ? [...pyIter(kw.bases)] : a[0] ? [...pyIter(a[0])] : [];
  const cls = _stMakeClass(name, bases);
  const ann = [];
  for (const spec of pyIter(fieldsIn)) {
    if (typeof spec === 'string') { ann.push([spec, 'typing.Any']); continue; }
    const [n, t, f] = spec;
    ann.push([n, t === undefined ? 'typing.Any' : typeof t === 'string' ? t : (t && t._pyName) || pyRepr(t)]);
    if (f !== undefined) setClassAttr(cls, n, f);
  }
  if (_stHas(kw, 'namespace') && kw.namespace) {
    const ns = kw.namespace instanceof Map ? [...kw.namespace] : Object.entries(kw.namespace);
    for (const [k, v] of ns) {
      if (typeof v === 'function') { cls.prototype[k] = function (...args) { return v(this, ...args); }; cls._pyOwnMembers.add(k); } else setClassAttr(cls, k, v);
    }
  }
  const p = { ..._ST_DEFAULTS };
  for (const k of Object.keys(kw)) if (k !== '_kw' && k in _ST_DEFAULTS) p[k] = !!kw[k];
  const r = finishClass(cls, ann);
  return _stIsThen(r) ? r.then(() => _stProcess(cls, p)) : _stProcess(cls, p);
}
const _stInitVar = { __adderClass__: 'InitVar', __getitem__: (t) => ({ __adderClass__: 'InitVar', type: t, __repr__: () => `dataclasses.InitVar[${pyRepr(t)}]` }), __repr__: () => "<class 'dataclasses.InitVar'>" };
adderModules.dataclasses = {
  dataclass: _stDataclass, field: _stFieldFn, Field: _StField, fields: _stFields, asdict: _stAsdict, astuple: _stAstuple,
  replace: _stReplace, is_dataclass: (x) => !!(_stDcOf(x) && _stDcOf(x).__dataclass_fields__),
  make_dataclass: _stMakeDataclass, MISSING: _ST_MISSING, KW_ONLY: _ST_KW_ONLY, InitVar: _stInitVar,
  FrozenInstanceError: _stFrozenErr,
};
