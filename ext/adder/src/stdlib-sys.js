// adder stdlib — the "plumbing" modules real libraries import at the top of their files:
// types, abc, numbers, errno, atexit, codecs, keyword, calendar, unicodedata, stat, platform,
// locale, fnmatch, shlex, threading, queue, traceback, reprlib, weakref, gettext, getpass,
// linecache, copyreg, asyncio, typing_extensions, inspect; plus string.Formatter, os.PathLike /
// fspath, and a real sys.version_info. subprocess and socket exist because libraries import them
// unconditionally; anything they would do raises (no processes, no sockets in the browser).
//
// Classes Python code subclasses (ABC, Thread, Formatter, SimpleNamespace, …) are built with
// buildClass — the factory the engines use — so inheritance and super() work as for any class.
//
// Concat-bundled with the rest of adder: top-level names carry an `_sy` prefix.

import {
  AdderError, adderModules, makeExcType, buildClass, mkTuple, PyTuple, PyDict, PySet, pyRepr, pyStr,
  pyTypeName, pyIter, pyCollect, pyTypeObj, pyObjectObj, typeOf, _typeObjects, asCallable, excStack, makeFunctionFromCode,
  excTypeOf, excValue, excToThrowable, adderGetAttr, pyEq, pyLt, pyMod, pyFormatValue, pyEncode, pyDecodePartial, codecName, stdoutWrite, _stdio,
  classStatement, GenericAlias, setOsExtrasHook, pyBool, NotImplemented, pyGetItem, _pyHash, _lazyIter, _pyEach,
  registerCodec, adderBuiltins, isMultibyteCodec, pyCollectMaybe, pyIsSubclass, pySubclasses, syncOf, pyGenericAliasType, _collectionsModule,
  isIntNum,
} from './builtins.js';
import { _adderParseExpr, adderParse } from './parse.js';

const _syIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _syIsCoro = (v) => _syIsThen(v) || (v !== null && typeof v === 'object' && v.__adderClass__ === 'coroutine');
const _syKw = (a) => (a.length && a[a.length - 1] !== null && typeof a[a.length - 1] === 'object' && a[a.length - 1]._kw === true ? a.pop() : null);
const _syHas = (kw, k) => !!kw && Object.hasOwn(kw, k) && k !== '_kw';
// positional-or-keyword args: names[i] from a[i], else the keyword, else the default
function _syArgs(a, names, defaults = {}) {
  const kw = _syKw(a);
  const out = {};
  names.forEach((n, i) => { out[n] = i < a.length ? a[i] : _syHas(kw, n) ? kw[n] : defaults[n]; });
  return out;
}
const _syModule = (name, members) => Object.assign({ __adderModule__: true, __name__: name }, members);
const _syClass = (name, bases, members, module) => {
  const c = buildClass(name, bases, members, []);
  if (module) c.__module__ = module;
  return c;
};
// a type object named like CPython's (for isinstance against names the engines report)
const _CODE_ATTRS = ['co_argcount', 'co_cellvars', 'co_code', 'co_consts', 'co_exceptiontable', 'co_filename', 'co_firstlineno', 'co_flags',
  'co_freevars', 'co_kwonlyargcount', 'co_lines', 'co_linetable', 'co_lnotab', 'co_name', 'co_names', 'co_nlocals', 'co_positions',
  'co_posonlyargcount', 'co_qualname', 'co_stacksize', 'co_varnames', 'replace'];
const _syCodeType = () => {
  const t = _syTypeNamed('code');
  for (const k of _CODE_ATTRS) if (!Object.hasOwn(t, k)) t[k] = { __property__: true, fget: (self) => self[k], fset: null, __doc__: null };
  return t;
};
const _syTypeNamed = (name) => {
  if (!_typeObjects[name]) {
    const t = () => { throw new AdderError('TypeError', `cannot create '${name}' instances`); };
    t._pyName = name; t._pyClass = true; t.__name__ = name;
    _typeObjects[name] = t;
  }
  return _typeObjects[name];
};

// ── sys: a real version_info, and the attributes libraries probe ──
{
  const sys = adderModules.sys;
  // a tuple with named fields (version_info >= (3, 8) compares as a tuple)
  const named = Object.assign(new PyTuple(), { major: 3, minor: 12, micro: 0, releaselevel: 'final', serial: 0 });
  for (const v of [3, 12, 0, 'final', 0]) named.push(v);
  named.__adderClass__ = 'sys.version_info';
  sys.version_info = Object.freeze(named);
  sys.hexversion = 0x030c00f0;
  sys.implementation = { __adderClass__: 'types.SimpleNamespace', name: 'adder', version: sys.version_info, cache_tag: null, _multiarch: '' };
  sys.byteorder = 'little';
  sys.maxunicode = 0x10ffff;
  sys.float_info = { __adderClass__: 'sys.float_info', max: Number.MAX_VALUE, min: 2.2250738585072014e-308, epsilon: Number.EPSILON, dig: 15, mant_dig: 53, max_exp: 1024, min_exp: -1021, max_10_exp: 308, min_10_exp: -307, radix: 2, rounds: 1 };
  sys.hash_info = { __adderClass__: 'sys.hash_info', width: 64, modulus: 2305843009213693951n, inf: 314159, nan: 0, imag: 1000003,
    algorithm: 'siphash13', hash_bits: 64, seed_bits: 128, cutoff: 0 };
  sys.int_info = { __adderClass__: 'sys.int_info', bits_per_digit: 30, sizeof_digit: 4, default_max_str_digits: 4300, str_digits_check_threshold: 640 };
  sys.flags = { __adderClass__: 'sys.flags', debug: 0, inspect: 0, interactive: 0, optimize: 0, dont_write_bytecode: 1, no_user_site: 1, no_site: 0, ignore_environment: 1, verbose: 0, bytes_warning: 0, quiet: 0, hash_randomization: 0, isolated: 0, dev_mode: false, utf8_mode: 1, warn_default_encoding: 0, safe_path: false, int_max_str_digits: 4300 };
  sys.dont_write_bytecode = true;
  sys.warnoptions = [];
  sys._xoptions = new PyDict();
  sys.builtin_module_names = mkTuple(['builtins', 'sys']);
  sys.stdlib_module_names = new PySet(Object.keys(adderModules));
  sys.getdefaultencoding = () => 'utf-8';
  sys.getfilesystemencoding = () => 'utf-8';
  sys.getfilesystemencodeerrors = () => 'surrogateescape';
  sys.intern = (s) => s;
  sys.is_finalizing = () => false;
  sys.getrefcount = () => 2;
  sys.audit = () => null;
  sys.addaudithook = () => null;
  sys.settrace = () => null;
  sys.gettrace = () => null;
  sys.setprofile = () => null;
  sys.api_version = 1013;
  sys.copyright = 'adder — a Python dialect for auditable (MIT)';
  // the calling frame: adder keeps no frames, so a stand-in a module-level caller can read
  sys._getframe = (depth = 0) => ({ __adderClass__: 'frame', f_globals: new PyDict([['__name__', '__main__']]), f_locals: new PyDict(), f_back: null, f_lineno: 0, f_code: { __adderClass__: 'code', co_filename: '<adder>', co_name: '<module>', co_firstlineno: 0 } });
  sys.stdin = { __adderClass__: 'TextIOWrapper', read: () => '', readline: () => '', readlines: () => [], isatty: () => false, fileno: () => 0, encoding: 'utf-8', close: () => null };
  sys.__stdout__ = sys.stdout; sys.__stderr__ = sys.stderr; sys.__stdin__ = sys.stdin;
  sys.displayhook = (v) => { if (v !== null && v !== undefined) stdoutWrite(pyRepr(v) + '\n'); return null; };
  sys.excepthook = (t, v) => { if (_stdio.err) _stdio.err(`${t && t._pyName ? t._pyName : 'Exception'}: ${pyStr(v)}\n`); return null; };
  // the originals, kept for restoring (code.InteractiveInterpreter compares against them)
  sys.__excepthook__ = sys.excepthook; sys.__displayhook__ = sys.displayhook;
  sys.unraisablehook = () => null;
  sys.orig_argv = [];
  sys.meta_path = [];
  sys.path_hooks = [];
  sys.path_importer_cache = new PyDict();
  sys.base_prefix = sys.prefix;
  sys.base_exec_prefix = sys.exec_prefix;
  sys.platlibdir = 'lib';
  sys.pycache_prefix = null;
}

// ── types ──
const _sySimpleNamespace = _syClass('SimpleNamespace', [], {
  __init__(self, ...a) {
    const kw = _syKw(a);
    if (a.length > 1) throw new AdderError('TypeError', `SimpleNamespace expected at most 1 positional argument, got ${a.length}`);
    if (a.length) { const m = a[0]; for (const [k, v] of (m instanceof Map ? m : Object.entries(m))) self[k] = v; }
    if (kw) for (const k of Object.keys(kw)) if (k !== '_kw') self[k] = kw[k];
    return null;
  },
  __repr__(self) {
    const parts = Object.keys(self).filter((k) => !k.startsWith('__adder')).map((k) => `${k}=${pyRepr(self[k])}`);
    return `namespace(${parts.join(', ')})`;
  },
  __eq__(self, other) {
    if (!other || other.__adderType__ !== self.__adderType__) return false;
    const ka = Object.keys(self).filter((k) => !k.startsWith('__adder')), kb = Object.keys(other).filter((k) => !k.startsWith('__adder'));
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(other, k) && pyEq(self[k], other[k]));
  },
}, 'types');
_sySimpleNamespace.__hash__ = null;
// types.ModuleType IS the type of every module (type(sys) is types.ModuleType; type(sys)('m')
// makes one), named `module` as CPython's
const _syModuleType = _syClass('module', [], {
  __init__(self, name, doc = null) { self.__name__ = name; self.__doc__ = doc; self.__adderModule__ = true; self.__package__ = null; self.__spec__ = null; self.__loader__ = null; return null; },
  __repr__(self) { return `<module ${pyRepr(self.__name__)}>`; },
}, 'builtins');
_typeObjects.module = _syModuleType;
// a read-only view of a mapping
const _syMappingProxy = (m) => {
  const d = new PyDict(m instanceof Map ? [...m] : Object.entries(m || {}));
  const ro = () => { throw new AdderError('TypeError', "'mappingproxy' object does not support item assignment"); };
  d.set = ro; d.delete = ro; d.clear = ro;
  d.__adderClass__ = 'mappingproxy';
  return d;
};
// the function type constructs: FunctionType(code, globals, name, argdefs, closure, kwdefaults)
if (!_typeObjects.function) {
  const t = (...a) => {
    const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {};
    const at = (i, k) => (i < a.length ? a[i] : kw[k]);
    return makeFunctionFromCode(at(0, 'code'), at(1, 'globals'), at(2, 'name'), at(3, 'argdefs'), at(4, 'closure'), at(5, 'kwdefaults'));
  };
  t._pyName = 'function'; t._pyClass = true; t.__name__ = 'function';
  _typeObjects.function = t;
}
adderModules.types = _syModule('types', {
  FunctionType: _syTypeNamed('function'), LambdaType: _syTypeNamed('function'),
  BuiltinFunctionType: _syTypeNamed('builtin_function_or_method'), BuiltinMethodType: _syTypeNamed('builtin_function_or_method'),
  MethodType: Object.assign((fn, obj) => { const m = (...a) => fn(obj, ...a); m.__self__ = obj; m.__func__ = fn; m._pyName = fn && fn._pyName; return m; }, { _pyName: 'method', _pyClass: true, __name__: 'method' }),
  MethodWrapperType: _syTypeNamed('method-wrapper'), WrapperDescriptorType: _syTypeNamed('wrapper_descriptor'),
  MethodDescriptorType: _syTypeNamed('method_descriptor'), ClassMethodDescriptorType: _syTypeNamed('classmethod_descriptor'),
  GetSetDescriptorType: _syTypeNamed('getset_descriptor'), MemberDescriptorType: _syTypeNamed('member_descriptor'),
  ModuleType: _syModuleType, SimpleNamespace: _sySimpleNamespace, MappingProxyType: Object.assign(_syMappingProxy, { _pyName: 'mappingproxy', _pyClass: true, __name__: 'mappingproxy' }),
  GeneratorType: _syTypeNamed('generator'), CoroutineType: _syTypeNamed('coroutine'), AsyncGeneratorType: _syTypeNamed('async_generator'),
  CodeType: _syCodeType(), FrameType: _syTypeNamed('frame'), TracebackType: _syTypeNamed('traceback'), CellType: _syTypeNamed('cell'),
  NoneType: _syTypeNamed('NoneType'), EllipsisType: _syTypeNamed('ellipsis'), NotImplementedType: _syTypeNamed('NotImplementedType'),
  GenericAlias: pyGenericAliasType, UnionType: _syTypeNamed('types.UnionType'),
  DynamicClassAttribute: (f) => ({ __property__: true, fget: f, fset: null }),
  coroutine: (f) => f,
  // new_class(name, bases=(), kwds=None, exec_body=None): class creation as the statement does it
  new_class: (name, ...a) => {
    const { bases, kwds, exec_body } = _syArgs(a, ['bases', 'kwds', 'exec_body'], { bases: mkTuple([]), kwds: null, exec_body: null });
    const ns = new PyDict();
    const finish = () => classStatement(name, [...pyIter(bases)], Object.fromEntries(ns), [], kwds ? Object.fromEntries(kwds instanceof Map ? kwds : Object.entries(kwds)) : null);
    const r = exec_body ? exec_body(ns) : null;
    return _syIsThen(r) ? r.then(finish) : finish();
  },
  prepare_class: (name, bases = mkTuple([]), kwds = null) => mkTuple([pyTypeObj, new PyDict(), kwds || new PyDict()]),
  resolve_bases: (bases) => bases,
  get_original_bases: (cls) => mkTuple(cls._pyBases || []),
});

// ── abc ──
// ABCMeta: a metaclass that computes __abstractmethods__ and refuses to instantiate a class
// with any left; register() adds virtual subclasses isinstance / issubclass honour.
const _syIsAbstract = (v) => !!v && (v.__isabstractmethod__ === true ||
  (v.__func__ && v.__func__.__isabstractmethod__ === true) ||
  (v.__property__ && v.fget && v.fget.__isabstractmethod__ === true) ||
  ((v.__classmethod__ || v.__staticmethod__) && v.fn && v.fn.__isabstractmethod__ === true));
function _syComputeAbstract(cls) {
  const abstract = new PySet();
  const own = cls._pyAbcNamespace || {};
  for (const [k, v] of Object.entries(own)) if (_syIsAbstract(v)) abstract.add(k);
  for (const base of cls._pyBases || []) {
    for (const name of base.__abstractmethods__ || []) {
      if (Object.hasOwn(own, name)) { if (_syIsAbstract(own[name])) abstract.add(name); continue; }
      // still abstract unless something closer in the MRO defines it concretely
      let resolved = null;
      for (const c of cls._pyMRO.slice(1)) { if (c._pyAbcNamespace && Object.hasOwn(c._pyAbcNamespace, name)) { resolved = c._pyAbcNamespace[name]; break; } }
      if (!resolved || _syIsAbstract(resolved)) abstract.add(name);
    }
  }
  return abstract;
}
// ABCMeta's subclass test is CPython's (_py_abc / _abc.c): a positive and a negative cache per
// class (the negative one dropped whenever anything is registered anywhere), then the class's
// __subclasshook__, its MRO, its registry (virtual subclasses) and — recursively — its own
// subclasses. collections.abc is built on exactly this: list is a Sequence because it's
// registered on MutableSequence, a subclass of Sequence. A __subclasshook__ is Python and may be
// tree-walked, so each step can be a promise; compiled hooks are called through their sync twins.
let _syAbcInvalidation = 0;
const _syThen = (v, f) => (_syIsThen(v) ? v.then(f) : f(v));
// the first item for which test(item) is true (a promise when a test is)
function _syAnyMaybe(items, test, i = 0) {
  for (; i < items.length; i++) {
    const r = test(items[i]);
    if (_syIsThen(r)) return r.then((v) => (v === true || pyBool(v) ? true : _syAnyMaybe(items, test, i + 1)));
    if (r === true) return true;
  }
  return false;
}
function _syAbcState(cls) {
  if (!Object.hasOwn(cls, '_pyAbcCache')) {
    for (const [k, v] of [['_pyAbcCache', new WeakSet()], ['_pyAbcNeg', new WeakSet()], ['_pyAbcNegVer', _syAbcInvalidation]]) {
      Object.defineProperty(cls, k, { value: v, writable: true, configurable: true });
    }
  }
  if (!Object.hasOwn(cls, '_pyAbcRegistry')) Object.defineProperty(cls, '_pyAbcRegistry', { value: new Set(), writable: true, configurable: true });
  return cls;
}
const _syIsClass = (c) => typeof c === 'function' && c._pyClass === true;
const _syIssub = (c, t) => pyIsSubclass(c, t);
function _syAbcSubclassCheck(cls, sub) {
  if (!_syIsClass(sub)) throw new AdderError('TypeError', 'issubclass() arg 1 must be a class');
  const st = _syAbcState(cls);
  if (st._pyAbcCache.has(sub)) return true;
  if (st._pyAbcNegVer < _syAbcInvalidation) { st._pyAbcNeg = new WeakSet(); st._pyAbcNegVer = _syAbcInvalidation; }
  else if (st._pyAbcNeg.has(sub)) return false;
  const yes = () => { st._pyAbcCache.add(sub); return true; };
  const hook = adderGetAttr(cls, '__subclasshook__');
  return _syThen(syncOf(hook)(sub), (ok) => {
    if (ok !== NotImplemented) {
      if (typeof ok !== 'boolean') throw new AdderError('AssertionError', '__subclasshook__ must return either False, True, or NotImplemented');
      if (ok) st._pyAbcCache.add(sub); else st._pyAbcNeg.add(sub);
      return ok;
    }
    // a real base: its MRO says so (a builtin type's MRO is itself and object)
    if (sub._pyMRO && sub._pyMRO.includes(cls)) return yes();
    return _syThen(_syAnyMaybe([...st._pyAbcRegistry], (r) => _syIssub(sub, r)), (inReg) => {
      if (inReg === true) return yes();
      return _syThen(_syAnyMaybe(pySubclasses(cls), (s) => _syIssub(sub, s)), (inSubs) => {
        if (inSubs === true) return yes();
        st._pyAbcNeg.add(sub);
        return false;
      });
    });
  });
}
function _syAbcInstanceCheck(cls, inst) {
  const subtype = typeOf(inst);
  // __class__ may differ from type() (a proxy saying what it stands for): both are asked
  let subclass = subtype;
  if (inst !== null && typeof inst === 'object' && inst.__adderType__) {
    try { const c = adderGetAttr(inst, '__class__'); if (_syIsClass(c)) subclass = c; } catch { /* no __class__ */ }
  }
  const st = _syAbcState(cls);
  if (st._pyAbcCache.has(subclass)) return true;
  if (subtype === subclass) {
    if (st._pyAbcNegVer === _syAbcInvalidation && st._pyAbcNeg.has(subclass)) return false;
    return _syAbcSubclassCheck(cls, subclass);
  }
  return _syAnyMaybe([subclass, subtype], (c) => _syAbcSubclassCheck(cls, c));
}
function _syAbcRegister(cls, sub) {
  if (!_syIsClass(sub)) throw new AdderError('TypeError', 'Can only register classes');
  return _syThen(_syIssub(sub, cls), (already) => {
    if (already === true) return sub;   // already a subclass
    return _syThen(_syIssub(cls, sub), (cycle) => {
      if (cycle === true) throw new AdderError('RuntimeError', 'Refusing to create an inheritance cycle');
      _syAbcState(cls)._pyAbcRegistry.add(sub);
      _syAbcInvalidation++;   // invalidate the negative caches
      return sub;
    });
  });
}
function _syAbcRefuseAbstract(cls) {
  const abs = cls.__abstractmethods__;
  if (abs && abs.size) {
    const names = [...abs].sort();
    throw new AdderError('TypeError', `Can't instantiate abstract class ${cls._pyName} without an implementation for abstract method${names.length > 1 ? 's' : ''} ${names.map((n) => `'${n}'`).join(', ')}`);
  }
}
const _syABCMeta = _syClass('ABCMeta', [pyTypeObj], {
  __init__(cls, name, bases, ns) {
    cls._pyAbcNamespace = ns instanceof Map ? Object.fromEntries(ns) : (ns || {});
    cls.__abstractmethods__ = new PySet(_syComputeAbstract(cls));
    _syAbcState(cls);
    return null;
  },
  __call__(cls, ...args) { _syAbcRefuseAbstract(cls); return pyTypeObj.prototype.__call__.call(cls, ...args); },
  register(cls, sub) { return _syAbcRegister(cls, sub); },
  __instancecheck__(cls, obj) { return _syAbcInstanceCheck(cls, obj); },
  __subclasscheck__(cls, sub) { return _syAbcSubclassCheck(cls, sub); },
  _dump_registry(cls, file = null) {
    const st = _syAbcState(cls);
    const w = (s) => (file ? adderGetAttr(file, 'write')(s + '\n') : stdoutWrite(s + '\n'));
    w(`Class: ${cls.__module__}.${cls.__qualname__ || cls._pyName}`);
    w(`Inv. counter: ${_syAbcInvalidation}`);
    w(`_abc_registry: ${pyRepr(new PySet(st._pyAbcRegistry))}`);
    return null;
  },
  _abc_registry_clear(cls) { _syAbcState(cls)._pyAbcRegistry.clear(); return null; },
  _abc_caches_clear(cls) { const st = _syAbcState(cls); st._pyAbcCache = new WeakSet(); st._pyAbcNeg = new WeakSet(); return null; },
}, 'abc');
// constructing from code that can't wait (Set._from_iterable inside an operator): type's sync path
Object.defineProperty(_syABCMeta.prototype.__call__, '_pySync', {
  value: function (...args) { _syAbcRefuseAbstract(this); return syncOf(pyTypeObj.prototype.__call__).call(this, ...args); },
  configurable: true, writable: true,
});
const _syAbstract = (f) => { if (f && typeof f === 'object' && f.fn) f.fn.__isabstractmethod__ = true; else if (f) f.__isabstractmethod__ = true; return f; };
adderModules.abc = _syModule('abc', {
  ABCMeta: _syABCMeta,
  abstractmethod: _syAbstract,
  abstractclassmethod: (f) => ({ __classmethod__: true, fn: _syAbstract(f) }),
  abstractstaticmethod: (f) => ({ __staticmethod__: true, fn: _syAbstract(f) }),
  abstractproperty: (f) => ({ __property__: true, fget: _syAbstract(f), fset: null }),
  get_cache_token: () => _syAbcInvalidation,
  update_abstractmethods: (cls) => { cls.__abstractmethods__ = new PySet(_syComputeAbstract(cls)); return cls; },
});
// ABC: a class whose metaclass is ABCMeta (what `class ABC(metaclass=ABCMeta)` makes)
adderModules.abc.ABC = _syABCMeta('ABC', mkTuple([]), new PyDict([['__slots__', mkTuple([])]]));
adderModules.abc.ABC.__module__ = 'abc';

// ── numbers: the numeric tower, recognising adder's numbers ──
{
  const isNum = (o) => typeof o === 'number' || typeof o === 'boolean' || typeof o === 'bigint';
  const tower = [
    ['Number', null, (o) => isNum(o) || pyTypeName(o) === 'complex' || pyTypeName(o) === 'Decimal' || pyTypeName(o) === 'Fraction'],
    ['Complex', 'Number', (o) => isNum(o) || pyTypeName(o) === 'complex' || pyTypeName(o) === 'Fraction'],
    ['Real', 'Complex', (o) => isNum(o) || pyTypeName(o) === 'Fraction'],
    ['Rational', 'Real', (o) => (typeof o === 'number' && isIntNum(o)) || typeof o === 'boolean' || typeof o === 'bigint' || pyTypeName(o) === 'Fraction'],
    ['Integral', 'Rational', (o) => (typeof o === 'number' && isIntNum(o)) || typeof o === 'boolean' || typeof o === 'bigint'],
  ];
  const m = _syModule('numbers', {});
  for (const [name, parent, test] of tower) {
    const cls = _syABCMeta(name, mkTuple(parent ? [m[parent]] : []), new PyDict([['__slots__', mkTuple([])]]));
    cls.__module__ = 'numbers';
    const reg = cls._pyAbcRegistry;
    cls.__instancecheck__ = (obj) => test(obj) || [...reg].some((r) => { const t = typeOf(obj); return r === t || ((t && t._pyMRO) || []).includes(r); });
    m[name] = cls;
  }
  adderModules.numbers = m;
}

// ── errno ──
{
  const codes = { EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5, ENXIO: 6, E2BIG: 7, ENOEXEC: 8, EBADF: 9, ECHILD: 10, EAGAIN: 11,
    ENOMEM: 12, EACCES: 13, EFAULT: 14, ENOTBLK: 15, EBUSY: 16, EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20, EISDIR: 21, EINVAL: 22,
    ENFILE: 23, EMFILE: 24, ENOTTY: 25, ETXTBSY: 26, EFBIG: 27, ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32, EDOM: 33,
    ERANGE: 34, EDEADLK: 35, ENAMETOOLONG: 36, ENOLCK: 37, ENOSYS: 38, ENOTEMPTY: 39, ELOOP: 40, ENOMSG: 42, EIDRM: 43, ENOSTR: 60,
    ENODATA: 61, ETIME: 62, ENOSR: 63, ENOLINK: 67, EPROTO: 71, EBADMSG: 74, EOVERFLOW: 75, EILSEQ: 84, EUSERS: 87, ENOTSOCK: 88,
    EDESTADDRREQ: 89, EMSGSIZE: 90, EPROTOTYPE: 91, ENOPROTOOPT: 92, EPROTONOSUPPORT: 93, ESOCKTNOSUPPORT: 94, EOPNOTSUPP: 95,
    ENOTSUP: 95, EPFNOSUPPORT: 96, EAFNOSUPPORT: 97, EADDRINUSE: 98, EADDRNOTAVAIL: 99, ENETDOWN: 100, ENETUNREACH: 101,
    ENETRESET: 102, ECONNABORTED: 103, ECONNRESET: 104, ENOBUFS: 105, EISCONN: 106, ENOTCONN: 107, ESHUTDOWN: 108,
    ETOOMANYREFS: 109, ETIMEDOUT: 110, ECONNREFUSED: 111, EHOSTDOWN: 112, EHOSTUNREACH: 113, EALREADY: 114, EINPROGRESS: 115,
    ESTALE: 116, EDQUOT: 122, ECANCELED: 125, EOWNERDEAD: 130, ENOTRECOVERABLE: 131 };
  const errorcode = new PyDict();
  for (const [k, v] of Object.entries(codes)) if (!errorcode.has(v)) errorcode.set(v, k);
  adderModules.errno = _syModule('errno', { ...codes, EWOULDBLOCK: 11, EDEADLOCK: 35, errorcode });
}

// ── atexit: programs here don't "exit"; handlers are kept and run by _run_exitfuncs ──
{
  const handlers = [];
  adderModules.atexit = _syModule('atexit', {
    register: (fn, ...a) => { const kw = _syKw(a); handlers.push([fn, a, kw]); return fn; },
    unregister: (fn) => { for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i][0] === fn) handlers.splice(i, 1); return null; },
    _run_exitfuncs: async () => { while (handlers.length) { const [fn, a, kw] = handlers.pop(); await (kw ? fn(...a, kw) : fn(...a)); } return null; },
    _clear: () => { handlers.length = 0; return null; },
    _ncallbacks: () => handlers.length,
  });
}

// ── keyword ──
{
  const kwlist = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
    'raise', 'return', 'try', 'while', 'with', 'yield'];
  const softkwlist = ['_', 'case', 'match', 'type'];
  const kws = new Set(kwlist), soft = new Set(softkwlist);
  adderModules.keyword = _syModule('keyword', { kwlist, softkwlist, iskeyword: (s) => kws.has(s), issoftkeyword: (s) => soft.has(s) });
}

// ── codecs (over the engines' codec core) ──
{
  const enc = (o, ...a) => { const { encoding, errors } = _syArgs(a, ['encoding', 'errors'], { encoding: 'utf-8', errors: 'strict' }); return pyEncode(o, encoding, errors); };
  const dec = (o, ...a) => { const { encoding, errors } = _syArgs(a, ['encoding', 'errors'], { encoding: 'utf-8', errors: 'strict' }); return pyDecodePartial(o instanceof Uint8Array ? o : new Uint8Array([...pyIter(o)]), encoding, errors, true).text; };
  const name = (e) => { const c = codecName(e); if (!c) throw new AdderError('LookupError', `unknown encoding: ${e}`); return c === 'utf-8' ? 'utf-8' : c === 'latin-1' ? 'iso8859-1' : c; };
  // an incremental decoder: bytes may arrive split mid-character
  const IncrementalDecoder = (encoding) => _syClass('IncrementalDecoder', [], {
    __init__(self, errors = 'strict') { self.errors = errors; self._pending = new Uint8Array(0); return null; },
    decode(self, input, final = false) {
      if (final && final._kw) final = final.final;
      const b = input instanceof Uint8Array ? input : new Uint8Array([...pyIter(input || [])]);
      const all = new Uint8Array(self._pending.length + b.length); all.set(self._pending); all.set(b, self._pending.length);
      const r = pyDecodePartial(all, encoding, self.errors, !!final);
      self._pending = all.slice(r.consumed);
      return r.text;
    },
    reset(self) { self._pending = new Uint8Array(0); return null; },
    getstate(self) { return mkTuple([self._pending, 0]); },
    setstate(self, st) { self._pending = st[0]; return null; },
  }, 'codecs');
  const IncrementalEncoder = (encoding) => _syClass('IncrementalEncoder', [], {
    __init__(self, errors = 'strict') { self.errors = errors; return null; },
    encode(self, input, final = false) { return pyEncode(input, encoding, self.errors); },
    reset() { return null; }, getstate() { return 0; }, setstate() { return null; },
  }, 'codecs');
  const CodecInfo = _syClass('CodecInfo', [], {}, 'codecs');
  const lookup = (e) => {
    const n = name(e);
    const info = Object.create(CodecInfo.prototype);
    Object.assign(info, { __adderClass__: 'CodecInfo', __adderType__: CodecInfo, name: n,
      encode: (s, errors = 'strict') => { const b = pyEncode(s, n, errors); return mkTuple([b, String(s).length]); },
      decode: (b, errors = 'strict') => mkTuple([pyDecodePartial(b, n, errors, true).text, b.length]),
      incrementalencoder: IncrementalEncoder(n), incrementaldecoder: IncrementalDecoder(n), streamreader: null, streamwriter: null });
    return info;
  };
  const latin = (b) => new Uint8Array(b);
  adderModules.codecs = _syModule('codecs', {
    encode: enc, decode: dec, lookup, CodecInfo,
    getencoder: (e) => lookup(e).encode, getdecoder: (e) => lookup(e).decode,
    getincrementalencoder: (e) => IncrementalEncoder(name(e)), getincrementaldecoder: (e) => IncrementalDecoder(name(e)),
    getreader: () => { throw new AdderError('LookupError', 'codecs stream readers are not available'); },
    getwriter: () => { throw new AdderError('LookupError', 'codecs stream writers are not available'); },
    iterencode: function* (it, e, errors = 'strict') { for (const s of pyIter(it)) yield pyEncode(s, e, errors); },
    iterdecode: function* (it, e, errors = 'strict') { const d = IncrementalDecoder(name(e))(errors); for (const b of pyIter(it)) { const t = d.decode(b); if (t) yield t; } const t = d.decode(new Uint8Array(0), true); if (t) yield t; },
    register: () => null, unregister: () => null,
    register_error: () => null, lookup_error: (n) => { if (!['strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'surrogateescape', 'surrogatepass', 'namereplace'].includes(n)) throw new AdderError('LookupError', `unknown error handler name '${n}'`); return (e) => { throw e; }; },
    open: (...a) => adderModules.io && adderModules.io.open ? adderModules.io.open(...a) : null,
    utf_8_encode: (s, errors = 'strict') => mkTuple([pyEncode(s, 'utf-8', errors), String(s).length]),
    utf_8_decode: (b, errors = 'strict', final = false) => { const r = pyDecodePartial(b, 'utf-8', errors, !!final); return mkTuple([r.text, r.consumed]); },
    latin_1_encode: (s, errors = 'strict') => mkTuple([pyEncode(s, 'latin-1', errors), String(s).length]),
    latin_1_decode: (b, errors = 'strict') => mkTuple([pyDecodePartial(b, 'latin-1', errors, true).text, b.length]),
    ascii_encode: (s, errors = 'strict') => mkTuple([pyEncode(s, 'ascii', errors), String(s).length]),
    ascii_decode: (b, errors = 'strict') => mkTuple([pyDecodePartial(b, 'ascii', errors, true).text, b.length]),
    BOM_UTF8: latin([0xef, 0xbb, 0xbf]), BOM_UTF16_LE: latin([0xff, 0xfe]), BOM_UTF16_BE: latin([0xfe, 0xff]),
    BOM_UTF32_LE: latin([0xff, 0xfe, 0, 0]), BOM_UTF32_BE: latin([0, 0, 0xfe, 0xff]),
    BOM_LE: latin([0xff, 0xfe]), BOM_BE: latin([0xfe, 0xff]), BOM_UTF16: latin([0xff, 0xfe]), BOM_UTF32: latin([0xff, 0xfe, 0, 0]), BOM: latin([0xff, 0xfe]),
    IncrementalDecoder: IncrementalDecoder('utf-8'), IncrementalEncoder: IncrementalEncoder('utf-8'),
  });
  adderModules.encodings = _syModule('encodings', { normalize_encoding: (e) => String(e).toLowerCase().replace(/[^a-z0-9.]+/g, '_'), search_function: lookup });
  adderModules['encodings.aliases'] = _syModule('encodings.aliases', { aliases: new PyDict([['utf8', 'utf_8'], ['latin1', 'latin_1'], ['ascii', 'ascii'], ['us_ascii', 'ascii'], ['cp65001', 'utf_8'], ['iso_8859_1', 'latin_1'], ['windows_1252', 'cp1252']]) });
  adderModules.encodings.aliases = adderModules['encodings.aliases'];
}

// ── calendar ──
{
  const isleap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const mdays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Monday = 0, as Python's
  const weekday = (y, m, d) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const monthrange = (y, m) => {
    if (m < 1 || m > 12) throw new AdderError('IllegalMonthError', `bad month number ${m}; must be 1-12`);
    return mkTuple([weekday(y, m, 1), mdays[m] + (m === 2 && isleap(y) ? 1 : 0)]);
  };
  let first = 0;
  const monthcalendar = (y, m) => {
    const [start, n] = monthrange(y, m);
    const weeks = []; let week = new Array((start - first + 7) % 7).fill(0);
    for (let d = 1; d <= n; d++) { week.push(d); if (week.length === 7) { weeks.push(week); week = []; } }
    if (week.length) { while (week.length < 7) week.push(0); weeks.push(week); }
    return weeks;
  };
  const names = (arr) => { const a = [...arr]; return a; };
  adderModules.calendar = _syModule('calendar', {
    isleap, leapdays: (y1, y2) => { y1--; y2--; return (Math.floor(y2 / 4) - Math.floor(y1 / 4)) - (Math.floor(y2 / 100) - Math.floor(y1 / 100)) + (Math.floor(y2 / 400) - Math.floor(y1 / 400)); },
    weekday, monthrange, monthcalendar,
    month_name: names(['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']),
    month_abbr: names(['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']),
    day_name: names(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
    day_abbr: names(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
    MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
    JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
    firstweekday: () => first, setfirstweekday: (d) => { first = d; return null; },
    // timegm(struct_time-like tuple): seconds since the epoch, UTC
    timegm: (t) => { const v = [...pyIter(t)]; return Math.floor(Date.UTC(v[0], v[1] - 1, v[2], v[3] || 0, v[4] || 0, v[5] || 0) / 1000); },
    IllegalMonthError: makeExcType('IllegalMonthError', 'ValueError'),
    IllegalWeekdayError: makeExcType('IllegalWeekdayError', 'ValueError'),
  });
}

// ── unicodedata (from JS's Unicode property escapes; no name database) ──
{
  const CATS = ['Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Mc', 'Me', 'Nd', 'Nl', 'No', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
    'Sm', 'Sc', 'Sk', 'So', 'Zs', 'Zl', 'Zp', 'Cc', 'Cf', 'Cs', 'Co', 'Cn'];
  const RX = Object.fromEntries(CATS.map((c) => [c, new RegExp(`^\\p{${c}}$`, 'u')]));
  const one = (ch, fn) => { ch = String(ch); if ([...ch].length !== 1) throw new AdderError('TypeError', `${fn}() argument must be a unicode character, not str`); return ch; };
  const category = (ch) => { ch = one(ch, 'category'); for (const c of CATS) if (RX[c].test(ch)) return c; return 'Cn'; };
  // a decimal digit's value: Nd digits come in runs of ten starting at zero
  const digitValue = (ch) => {
    if (!RX.Nd.test(ch)) return null;
    let cp = ch.codePointAt(0), start = cp;
    while (start > 0 && RX.Nd.test(String.fromCodePoint(start - 1))) start--;
    return (cp - start) % 10;
  };
  const withDefault = (fn, name) => (ch, ...d) => { ch = one(ch, name); const v = fn(ch); if (v !== null) return v; if (d.length) return d[0]; throw new AdderError('ValueError', `not a ${name === 'decimal' ? 'decimal' : name === 'digit' ? 'digit' : 'numeric character'}`); };
  // bidirectional class, from script / category (covers the classes text actually uses)
  const bidi = (ch) => {
    ch = one(ch, 'bidirectional');
    const cp = ch.codePointAt(0);
    if (/^[\u0030-\u0039]$/.test(ch)) return 'EN';
    if (cp >= 0x0660 && cp <= 0x0669) return 'AN';
    if (/^\p{Script=Hebrew}$/u.test(ch) && !RX.Mn.test(ch)) return 'R';
    if (/^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]$/u.test(ch) && !RX.Mn.test(ch)) return RX.Nd.test(ch) ? 'AN' : 'AL';
    if (RX.Mn.test(ch) || RX.Me.test(ch)) return 'NSM';
    if (ch === '\n' || ch === '\r' || cp === 0x1c || cp === 0x1d || cp === 0x1e || cp === 0x85 || cp === 0x2029) return 'B';
    if (ch === '\t' || cp === 0x0b || cp === 0x1f) return 'S';
    if (ch === ' ' || cp === 0x0c || RX.Zs.test(ch) || cp === 0x2028) return 'WS';
    if (ch === '+' || ch === '-') return 'ES';
    if ('#$%'.includes(ch) || RX.Sc.test(ch) || cp === 0xb0 || cp === 0xb1) return 'ET';
    if (',./:'.includes(ch) || cp === 0xa0) return 'CS';
    if (RX.Cc.test(ch) || RX.Cf.test(ch)) return 'BN';
    if (RX.Nd.test(ch) || /^\p{L}$/u.test(ch) || RX.Nl.test(ch) || RX.Mc.test(ch) || RX.Co.test(ch)) return 'L';
    return 'ON';
  };
  // east asian width: wide / fullwidth / halfwidth / narrow / neutral (A, ambiguous, is reported N)
  const eaw = (ch) => {
    ch = one(ch, 'east_asian_width');
    const cp = ch.codePointAt(0);
    if ((cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || cp === 0x3000) return 'F';
    if ((cp >= 0xff61 && cp <= 0xffdc) || (cp >= 0xffe8 && cp <= 0xffee)) return 'H';
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 'W';
    if (cp >= 0x20 && cp <= 0x7e) return 'Na';
    return 'N';
  };
  adderModules.unicodedata = _syModule('unicodedata', {
    unidata_version: '15.0.0',
    normalize: (form, s) => { if (!['NFC', 'NFD', 'NFKC', 'NFKD'].includes(form)) throw new AdderError('ValueError', 'invalid normalization form'); return String(s).normalize(form); },
    is_normalized: (form, s) => String(s).normalize(form) === String(s),
    category, bidirectional: bidi, east_asian_width: eaw,
    // canonical combining class: 0 for a base character; marks report 230 (the commonest class)
    combining: (ch) => { ch = one(ch, 'combining'); return RX.Mn.test(ch) || RX.Me.test(ch) ? 230 : 0; },
    mirrored: (ch) => ('()<>[]{}«»'.includes(one(ch, 'mirrored')) ? 1 : 0),
    decimal: withDefault(digitValue, 'decimal'),
    digit: withDefault(digitValue, 'digit'),
    numeric: withDefault((ch) => { const d = digitValue(ch); if (d !== null) return d; const v = { '½': 0.5, '¼': 0.25, '¾': 0.75, 'Ⅰ': 1, 'Ⅴ': 5, 'Ⅹ': 10 }[ch]; return v ?? null; }, 'numeric'),
    decomposition: (ch) => { ch = one(ch, 'decomposition'); const d = ch.normalize('NFD'); return d === ch ? '' : [...d].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '); },
    name: (ch, ...d) => { if (d.length) return d[0]; throw new AdderError('ValueError', 'no such name (adder has no Unicode name database)'); },
    lookup: (n) => { throw new AdderError('KeyError', `undefined character name '${n}'`); },
  });
}

// ── stat ──
{
  const S_IFMT = 0o170000;
  const m = { S_IFMT_MASK: S_IFMT, S_IFDIR: 0o040000, S_IFCHR: 0o020000, S_IFBLK: 0o060000, S_IFREG: 0o100000, S_IFIFO: 0o010000, S_IFLNK: 0o120000, S_IFSOCK: 0o140000,
    S_ISUID: 0o4000, S_ISGID: 0o2000, S_ISVTX: 0o1000, S_IRWXU: 0o700, S_IRUSR: 0o400, S_IWUSR: 0o200, S_IXUSR: 0o100,
    S_IRWXG: 0o70, S_IRGRP: 0o40, S_IWGRP: 0o20, S_IXGRP: 0o10, S_IRWXO: 0o7, S_IROTH: 0o4, S_IWOTH: 0o2, S_IXOTH: 0o1,
    S_IREAD: 0o400, S_IWRITE: 0o200, S_IEXEC: 0o100,
    ST_MODE: 0, ST_INO: 1, ST_DEV: 2, ST_NLINK: 3, ST_UID: 4, ST_GID: 5, ST_SIZE: 6, ST_ATIME: 7, ST_MTIME: 8, ST_CTIME: 9,
    UF_HIDDEN: 0x8000, FILE_ATTRIBUTE_HIDDEN: 2, FILE_ATTRIBUTE_DIRECTORY: 16 };
  const is = (t) => (mode) => (mode & S_IFMT) === t;
  const filemode = (mode) => {
    const t = { 0o040000: 'd', 0o120000: 'l', 0o020000: 'c', 0o060000: 'b', 0o010000: 'p', 0o140000: 's' }[mode & S_IFMT] || '-';
    const r = (bit, ch) => ((mode & bit) ? ch : '-');
    return t + r(0o400, 'r') + r(0o200, 'w') + ((mode & 0o4000) ? ((mode & 0o100) ? 's' : 'S') : r(0o100, 'x')) +
      r(0o40, 'r') + r(0o20, 'w') + ((mode & 0o2000) ? ((mode & 0o10) ? 's' : 'S') : r(0o10, 'x')) +
      r(0o4, 'r') + r(0o2, 'w') + ((mode & 0o1000) ? ((mode & 0o1) ? 't' : 'T') : r(0o1, 'x'));
  };
  adderModules.stat = _syModule('stat', { ...m, S_IFMT: (mode) => mode & S_IFMT, S_IMODE: (mode) => mode & 0o7777,
    S_ISDIR: is(0o040000), S_ISREG: is(0o100000), S_ISLNK: is(0o120000), S_ISCHR: is(0o020000), S_ISBLK: is(0o060000),
    S_ISFIFO: is(0o010000), S_ISSOCK: is(0o140000), S_ISDOOR: () => false, S_ISPORT: () => false, S_ISWHT: () => false, filemode });
}

// ── platform: describes adder ──
{
  const uname = Object.assign(mkTuple(['Auditable', 'localhost', '', '', '', '']), {});
  adderModules.platform = _syModule('platform', {
    system: () => 'Auditable', node: () => 'localhost', release: () => '', version: () => '', machine: () => '', processor: () => '',
    python_version: () => '3.12.0', python_version_tuple: () => mkTuple(['3', '12', '0']), python_implementation: () => 'adder',
    python_compiler: () => '', python_build: () => mkTuple(['main', '']), python_branch: () => '', python_revision: () => '',
    platform: () => 'Auditable', architecture: () => mkTuple(['64bit', '']), uname: () => uname,
    mac_ver: () => mkTuple(['', mkTuple(['', '', '']), '']), win32_ver: () => mkTuple(['', '', '', '']), win32_edition: () => '',
    win32_is_iot: () => false, libc_ver: () => mkTuple(['', '']), freedesktop_os_release: () => { throw new AdderError('OSError', 'no os-release'); },
  });
}

// ── locale: UTF-8, the C locale's conventions ──
adderModules.locale = _syModule('locale', {
  LC_CTYPE: 0, LC_NUMERIC: 1, LC_TIME: 2, LC_COLLATE: 3, LC_MONETARY: 4, LC_MESSAGES: 5, LC_ALL: 6, CHAR_MAX: 127,
  Error: makeExcType('locale.Error', 'Exception'),
  setlocale: (cat, loc = null) => (loc === null || loc === '' || loc === 'C' || loc === 'POSIX' ? 'C' : (() => { throw new AdderError('locale.Error', 'unsupported locale setting'); })()),
  getlocale: () => mkTuple([null, null]), getdefaultlocale: () => mkTuple([null, 'UTF-8']),
  getpreferredencoding: () => 'UTF-8', getencoding: () => 'UTF-8', normalize: (n) => n,
  localeconv: () => new PyDict([['decimal_point', '.'], ['thousands_sep', ''], ['grouping', []], ['int_curr_symbol', ''], ['currency_symbol', ''],
    ['mon_decimal_point', ''], ['mon_thousands_sep', ''], ['mon_grouping', []], ['positive_sign', ''], ['negative_sign', ''],
    ['int_frac_digits', 127], ['frac_digits', 127], ['p_cs_precedes', 127], ['p_sep_by_space', 127], ['n_cs_precedes', 127],
    ['n_sep_by_space', 127], ['p_sign_posn', 127], ['n_sign_posn', 127]]),
  strcoll: (a, b) => (a < b ? -1 : a > b ? 1 : 0), strxfrm: (s) => s,
  str: (x) => String(x), atof: (s) => Number(s), atoi: (s) => parseInt(s, 10),
  format_string: (fmt, val) => pyMod(fmt, val),
});

// ── fnmatch ──
{
  // fnmatch.translate: the shell pattern as a Python regex source (CPython's shape)
  const translate = (pat) => {
    let i = 0, res = '';
    const n = pat.length;
    while (i < n) {
      const c = pat[i++];
      if (c === '*') { while (pat[i] === '*') i++; res += '.*'; }
      else if (c === '?') res += '.';
      else if (c === '[') {
        let j = i;
        if (pat[j] === '!') j++;
        if (pat[j] === ']') j++;
        while (j < n && pat[j] !== ']') j++;
        if (j >= n) res += '\\[';
        else {
          let stuff = pat.slice(i, j).replace(/\\/g, '\\\\');
          i = j + 1;
          if (stuff[0] === '!') stuff = '^' + stuff.slice(1);
          else if (stuff[0] === '^') stuff = '\\' + stuff;
          res += `[${stuff}]`;
        }
      } else res += c.replace(/[.*+?^${}()|[\]\\\-#&~ ]/g, '\\$&');
    }
    return `(?s:${res})\\Z`;
  };
  const jsRe = new Map();
  const toJs = (pat) => {
    if (!jsRe.has(pat)) {
      const src = translate(pat).replace(/^\(\?s:/, '(?:').replace(/\\Z$/, '$');
      jsRe.set(pat, new RegExp('^' + src, 's'));
    }
    return jsRe.get(pat);
  };
  const fnmatchcase = (name, pat) => toJs(String(pat)).test(String(name));
  adderModules.fnmatch = _syModule('fnmatch', {
    translate, fnmatchcase,
    fnmatch: (name, pat) => fnmatchcase(name, pat),   // posix: case-sensitive (os.path.normcase is the identity)
    filter: (names, pat) => [...pyIter(names)].filter((n) => fnmatchcase(n, pat)),
  });
}

// ── shlex ──
{
  // POSIX shell-like splitting: quotes group, backslash escapes outside single quotes
  const split = (s, ...a) => {
    const { comments, posix } = _syArgs(a, ['comments', 'posix'], { comments: false, posix: true });
    if (s === null || s === undefined) throw new AdderError('ValueError', 'shlex.split(): s must not be None');
    s = String(s);
    const out = [];
    let tok = null, i = 0;
    const push = () => { if (tok !== null) out.push(tok); tok = null; };
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { push(); i++; continue; }
      if (comments && c === '#' && tok === null) { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === "'") {
        const j = s.indexOf("'", i + 1);
        if (j < 0) throw new AdderError('ValueError', 'No closing quotation');
        tok = (tok || '') + s.slice(i + 1, j); i = j + 1; continue;
      }
      if (c === '"') {
        let j = i + 1, t = '';
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && posix && j + 1 < s.length && '\\"$`\n'.includes(s[j + 1])) { t += s[j + 1]; j += 2; continue; }
          t += s[j++];
        }
        if (j >= s.length) throw new AdderError('ValueError', 'No closing quotation');
        tok = (tok || '') + t; i = j + 1; continue;
      }
      if (c === '\\' && posix) {
        if (i + 1 >= s.length) throw new AdderError('ValueError', 'No escaped character');
        tok = (tok || '') + s[i + 1]; i += 2; continue;
      }
      tok = (tok || '') + c; i++;
    }
    push();
    return out;
  };
  const quote = (s) => { s = String(s); if (!s) return "''"; if (!/[^\w@%+=:,./-]/.test(s)) return s; return "'" + s.replace(/'/g, "'\"'\"'") + "'"; };
  adderModules.shlex = _syModule('shlex', { split, quote, join: (parts) => [...pyIter(parts)].map(quote).join(' ') });
}

// ── threading: one thread — a Thread's target runs when it starts; locks never contend ──
{
  const Lock = _syClass('lock', [], {
    __init__(self) { self._locked = false; return null; },
    acquire(self, ...a) { const { blocking } = _syArgs(a, ['blocking', 'timeout'], { blocking: true }); if (self._locked && !self._rlock) { if (!blocking) return false; } self._locked = true; self._count = (self._count || 0) + 1; return true; },
    release(self) { if (!self._locked) throw new AdderError('RuntimeError', 'release unlocked lock'); self._count = (self._count || 1) - 1; if (!self._rlock || self._count === 0) self._locked = false; return null; },
    locked(self) { return !!self._locked; },
    __enter__(self) { self.acquire(); return true; },
    __exit__(self) { self.release(); return false; },
  }, 'threading');
  const RLock = _syClass('RLock', [Lock], { __init__(self) { self._locked = false; self._rlock = true; self._count = 0; return null; } }, 'threading');
  const Event = _syClass('Event', [], {
    __init__(self) { self._flag = false; return null; },
    is_set(self) { return self._flag; }, set(self) { self._flag = true; return null; }, clear(self) { self._flag = false; return null; },
    wait(self) { return self._flag; },
  }, 'threading');
  const Condition = _syClass('Condition', [], {
    __init__(self, lock = null) { self._lock = lock || RLock(); return null; },
    acquire(self, ...a) { return self._lock.acquire(...a); }, release(self) { return self._lock.release(); },
    __enter__(self) { return self._lock.__enter__(); }, __exit__(self, ...a) { return self._lock.__exit__(...a); },
    wait(self) { return true; }, wait_for(self, pred) { return pred(); }, notify(self) { return null; }, notify_all(self) { return null; },
  }, 'threading');
  const Semaphore = _syClass('Semaphore', [], {
    __init__(self, value = 1) { self._value = value; return null; },
    acquire(self, ...a) { const { blocking } = _syArgs(a, ['blocking', 'timeout'], { blocking: true }); if (self._value <= 0) { if (!blocking) return false; throw new AdderError('RuntimeError', 'Semaphore would block forever (one thread)'); } self._value--; return true; },
    release(self, n = 1) { self._value += n; return null; },
    __enter__(self) { self.acquire(); return true; }, __exit__(self) { self.release(); return false; },
  }, 'threading');
  const BoundedSemaphore = _syClass('BoundedSemaphore', [Semaphore], {}, 'threading');
  let ident = 1;
  const Thread = _syClass('Thread', [], {
    __init__(self, ...a) {
      const { group, target, name, args, kwargs, daemon } = _syArgs(a, ['group', 'target', 'name', 'args', 'kwargs', 'daemon'], { group: null, target: null, name: null, args: mkTuple([]), kwargs: null, daemon: null });
      self._target = target; self._args = args; self._kwargs = kwargs; self.name = name || `Thread-${ident}`; self.daemon = !!daemon;
      self.ident = null; self._started = false; self._alive = false; return null;
    },
    // the target runs now: one thread, so start() is the run (join() then has nothing to wait for).
    // Not a daemon: a daemon thread is a background service (a monitor's `while True`) that run
    // inline would never return — it can't start, as in Pyodide, and libraries catch that
    // (tqdm turns its monitor off)
    start(self) {
      if (self._started) throw new AdderError('RuntimeError', 'threads can only be started once');
      if (self.daemon) throw new AdderError('RuntimeError', "can't start new thread");
      self._started = true; self._alive = true; self.ident = ++ident; self.native_id = self.ident;
      const r = self.run();
      const done = () => { self._alive = false; return null; };
      return _syIsThen(r) ? r.then(done, (e) => { done(); throw e; }) : done();
    },
    run(self) { if (!self._target) return null; const kw = self._kwargs; return kw ? self._target(...pyIter(self._args), { _kw: true, ...(kw instanceof Map ? Object.fromEntries(kw) : kw) }) : self._target(...pyIter(self._args)); },
    join(self) { return null; }, is_alive(self) { return self._alive; },
    getName(self) { return self.name; }, setName(self, n) { self.name = n; return null; }, isDaemon(self) { return self.daemon; }, setDaemon(self, d) { self.daemon = d; return null; },
  }, 'threading');
  const main = Thread({ _kw: true, name: 'MainThread' }); main.ident = 1; main.native_id = 1; main._started = true; main._alive = true;
  const local = _syClass('local', [], {}, 'threading');
  const Timer = _syClass('Timer', [Thread], {
    __init__(self, interval, fn, args = null, kwargs = null) { Thread.prototype.__init__.call(self, { _kw: true, target: fn, args: args || mkTuple([]), kwargs }); self.interval = interval; self._cancelled = false; return null; },
    start(self) { self._started = true; self._handle = setTimeout(() => { if (!self._cancelled) self.run(); }, self.interval * 1000); return null; },
    cancel(self) { self._cancelled = true; if (self._handle) clearTimeout(self._handle); return null; },
  }, 'threading');
  adderModules.threading = _syModule('threading', {
    Lock, RLock, Event, Condition, Semaphore, BoundedSemaphore, Thread, Timer, local,
    Barrier: _syClass('Barrier', [], { __init__(self, parties) { self.parties = parties; return null; }, wait() { return 0; } }, 'threading'),
    current_thread: () => main, currentThread: () => main, main_thread: () => main, get_ident: () => 1, get_native_id: () => 1,
    active_count: () => 1, activeCount: () => 1, enumerate: () => [main], settrace: () => null, setprofile: () => null,
    stack_size: () => 0, TIMEOUT_MAX: 9223372036.0, excepthook: () => null, ExceptHookArgs: null,
    BrokenBarrierError: makeExcType('BrokenBarrierError', 'RuntimeError'),
  });
  adderModules._thread = _syModule('_thread', { allocate_lock: () => Lock(), get_ident: () => 1, LockType: Lock, RLock, error: makeExcType('RuntimeError', 'Exception') });
}

// ── queue ──
{
  const Empty = makeExcType('Empty', 'Exception'), Full = makeExcType('Full', 'Exception');
  const mk = (name, popFn, pushFn) => _syClass(name, [], {
    __init__(self, maxsize = 0) { self.maxsize = maxsize; self.queue = []; self.unfinished_tasks = 0; return null; },
    qsize(self) { return self.queue.length; }, empty(self) { return self.queue.length === 0; },
    full(self) { return self.maxsize > 0 && self.queue.length >= self.maxsize; },
    put(self, item, ...a) { if (self.maxsize > 0 && self.queue.length >= self.maxsize) throw new AdderError('Full', ''); pushFn(self.queue, item); self.unfinished_tasks++; return null; },
    put_nowait(self, item) { return self.put(item); },
    // one thread: an empty queue can never fill while we wait, so get() on it raises Empty
    get(self, ...a) { if (!self.queue.length) throw new AdderError('Empty', ''); return popFn(self.queue); },
    get_nowait(self) { return self.get(); },
    task_done(self) { if (self.unfinished_tasks <= 0) throw new AdderError('ValueError', 'task_done() called too many times'); self.unfinished_tasks--; return null; },
    join(self) { return null; },
  }, 'queue');
  // a stable insert keeping the queue sorted (pyLt: the same ordering Python's heapq uses)
  const heapPush = (q, x) => { let i = q.length; while (i > 0 && pyLt(x, q[i - 1])) i--; q.splice(i, 0, x); };
  adderModules.queue = _syModule('queue', {
    Queue: mk('Queue', (q) => q.shift(), (q, x) => q.push(x)),
    LifoQueue: mk('LifoQueue', (q) => q.pop(), (q, x) => q.push(x)),
    PriorityQueue: mk('PriorityQueue', (q) => q.shift(), heapPush),
    SimpleQueue: mk('SimpleQueue', (q) => q.shift(), (q, x) => q.push(x)),
    Empty, Full,
  });
}

// ── traceback (adder keeps no frames: the exception line is all there is) ──
{
  const exOf = (a) => (a.length >= 2 ? a[1] : a[0]);
  const lineOf = (e) => {
    if (e === null || e === undefined) return 'NoneType: None\n';
    const t = excTypeOf(e), v = excValue(e);
    const msg = pyStr(v);
    return `${t && t._pyName ? t._pyName : pyTypeName(v)}${msg ? ': ' + msg : ''}\n`;
  };
  const fmt = (e) => (e === null || e === undefined ? ['NoneType: None\n'] : ['Traceback (most recent call last):\n', lineOf(e)]);
  const cur = () => (excStack.length ? excStack[excStack.length - 1] : null);
  const toErr = (s) => { if (_stdio.err) _stdio.err(s); return null; };
  adderModules.traceback = _syModule('traceback', {
    format_exc: () => fmt(cur()).join(''),
    print_exc: (...a) => { const { file } = _syArgs(a, ['limit', 'file', 'chain'], {}); const s = fmt(cur()).join(''); return file && file.write ? file.write(s) : toErr(s); },
    format_exception: (...a) => { _syKw(a); return fmt(exOf(a)); },
    format_exception_only: (...a) => { _syKw(a); return [lineOf(exOf(a))]; },
    print_exception: (...a) => { const kw = _syKw(a); const s = fmt(exOf(a)).join(''); return kw && kw.file && kw.file.write ? kw.file.write(s) : toErr(s); },
    format_stack: () => [], extract_stack: () => [], extract_tb: () => [], format_tb: () => [], format_list: () => [],
    print_stack: () => null, print_tb: () => null, walk_tb: function* () {}, walk_stack: function* () {}, clear_frames: () => null,
    TracebackException: _syClass('TracebackException', [], {
      __init__(self, t, v) { self.exc_type = t; self._v = v; self.stack = []; return null; },
      format(self) { return fmt(self._v); }, format_exception_only(self) { return [lineOf(self._v)]; },
      __str__(self) { return pyStr(self._v); },
    }, 'traceback'),
    StackSummary: _syClass('StackSummary', [], {}, 'traceback'),
    FrameSummary: _syClass('FrameSummary', [], { __init__(self, filename, lineno, name) { self.filename = filename; self.lineno = lineno; self.name = name; self.line = ''; return null; } }, 'traceback'),
  });
  adderModules.traceback.TracebackException.from_exception = (e) => adderModules.traceback.TracebackException(excTypeOf(e), excValue(e));
}

// ── reprlib ──
{
  const recursive_repr = (fill = '...') => (fn) => {
    const running = new Set();
    const w = (self, ...a) => {
      if (running.has(self)) return fill;
      running.add(self);
      try {
        const r = fn(self, ...a);
        if (_syIsThen(r)) return r.finally(() => running.delete(self));
        running.delete(self);
        return r;
      } catch (e) { running.delete(self); throw e; }
    };
    w._pyFunc = true; w._pyName = fn._pyName; w.__wrapped__ = fn;
    return w;
  };
  const Repr = _syClass('Repr', [], {
    __init__(self) { Object.assign(self, { maxlevel: 6, maxtuple: 6, maxlist: 6, maxarray: 5, maxdict: 4, maxset: 6, maxfrozenset: 6, maxdeque: 6, maxstring: 30, maxlong: 40, maxother: 30, fillvalue: '...' }); return null; },
    repr(self, x) {
      const r = pyRepr(x);
      const lim = typeof x === 'string' ? self.maxstring : self.maxother;
      if (r.length <= lim) return r;
      const i = Math.max(0, Math.floor((lim - 3) / 2)), j = Math.max(0, lim - 3 - i);
      return r.slice(0, i) + self.fillvalue + r.slice(r.length - j);
    },
  }, 'reprlib');
  const aRepr = Repr();
  adderModules.reprlib = _syModule('reprlib', { Repr, aRepr, repr: (x) => aRepr.repr(x), recursive_repr });
}

// ── weakref ──
// No garbage-collection hooks reach Python code here, so the weak containers hold their entries
// strongly (same behaviour while the objects are alive, which is all a running program sees);
// ref() is a real WeakRef where the platform has one, and finalize() fires through
// FinalizationRegistry when it can.
{
  const ref = Object.assign((obj, cb = null) => {
    const wr = (typeof WeakRef !== 'undefined' && obj !== null && (typeof obj === 'object' || typeof obj === 'function')) ? new WeakRef(obj) : { deref: () => obj };
    const r = () => wr.deref() ?? null;
    r._pyName = 'weakref'; r.__callback__ = cb; r.__adderClass__ = 'weakref.ReferenceType';
    r.__eq__ = (o) => typeof o === 'function' && o.__adderClass__ === 'weakref.ReferenceType' && o() === r();
    return r;
  }, { _pyName: 'ReferenceType', __name__: 'ReferenceType', _pyClass: true });
  const registry = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry((f) => { if (f.alive) { f.alive = false; f.fn(...f.args); } }) : null;
  const finalize = _syClass('finalize', [], {
    __init__(self, obj, fn, ...a) { const kw = _syKw(a); self.fn = fn; self.args = a; self.kwargs = kw; self.alive = true; self.atexit = true; if (registry && obj !== null && typeof obj === 'object') registry.register(obj, self); return null; },
    __call__(self) { if (!self.alive) return null; self.alive = false; return self.kwargs ? self.fn(...self.args, self.kwargs) : self.fn(...self.args); },
    detach(self) { if (!self.alive) return null; self.alive = false; return mkTuple([null, self.fn, mkTuple(self.args), self.kwargs || new PyDict()]); },
    peek(self) { return self.alive ? mkTuple([null, self.fn, mkTuple(self.args), self.kwargs || new PyDict()]) : null; },
  }, 'weakref');
  const asDict = (name) => Object.assign((init) => { const d = new PyDict(init ? (init instanceof Map ? [...init] : Object.entries(init)) : []); d.__adderClass__ = name; return d; }, { _pyName: name, __name__: name, _pyClass: true });
  adderModules.weakref = _syModule('weakref', {
    ref, ReferenceType: ref, proxy: (o) => o, ProxyType: _syTypeNamed('weakproxy'), CallableProxyType: _syTypeNamed('weakcallableproxy'),
    ProxyTypes: mkTuple([]), WeakMethod: (m) => ref(m), finalize,
    WeakValueDictionary: asDict('WeakValueDictionary'), WeakKeyDictionary: asDict('WeakKeyDictionary'),
    WeakSet: Object.assign((init) => new PySet(init ? [...pyIter(init)] : []), { _pyName: 'WeakSet', __name__: 'WeakSet', _pyClass: true }),
    getweakrefcount: () => 0, getweakrefs: () => [],
  });
  adderModules._weakrefset = _syModule('_weakrefset', { WeakSet: adderModules.weakref.WeakSet });
  // _weakref: the C primitives weakref.py builds on (collections' OrderedDict links take proxy)
  const w = adderModules.weakref;
  adderModules._weakref = _syModule('_weakref', {
    ref: w.ref, ReferenceType: w.ReferenceType, proxy: w.proxy, ProxyType: w.ProxyType, CallableProxyType: w.CallableProxyType,
    getweakrefcount: w.getweakrefcount, getweakrefs: w.getweakrefs,
  });
}

// ── gettext: no catalogs — messages come back untranslated ──
{
  const NullTranslations = _syClass('NullTranslations', [], {
    __init__(self, fp = null) { self._fallback = null; return null; },
    gettext(self, m) { return m; }, ngettext(self, s, p, n) { return n === 1 ? s : p; },
    pgettext(self, c, m) { return m; }, npgettext(self, c, s, p, n) { return n === 1 ? s : p; },
    info(self) { return new PyDict(); }, charset(self) { return null; }, add_fallback(self, f) { self._fallback = f; return null; },
    install(self) { return null; },
  }, 'gettext');
  adderModules.gettext = _syModule('gettext', {
    NullTranslations, GNUTranslations: NullTranslations,
    gettext: (m) => m, ngettext: (s, p, n) => (n === 1 ? s : p), pgettext: (c, m) => m, npgettext: (c, s, p, n) => (n === 1 ? s : p),
    dgettext: (d, m) => m, dngettext: (d, s, p, n) => (n === 1 ? s : p),
    translation: () => NullTranslations(), install: () => null, textdomain: (d = null) => d || 'messages', bindtextdomain: (d, l = null) => l, find: () => null,
  });
}

// ── getpass ──
adderModules.getpass = _syModule('getpass', {
  getuser: () => 'user',
  getpass: (prompt = 'Password: ') => { throw new AdderError('OSError', 'getpass(): no terminal to read a password from'); },
  GetPassWarning: makeExcType('GetPassWarning', 'UserWarning'),
});

// ── linecache: no source files to cache ──
adderModules.linecache = _syModule('linecache', {
  getline: () => '', getlines: () => [], clearcache: () => null, checkcache: () => null, updatecache: () => [], lazycache: () => false, cache: new PyDict(),
});

// ── copyreg ──
adderModules.copyreg = _syModule('copyreg', {
  dispatch_table: new PyDict(), pickle: (t, fn) => { adderModules.copyreg.dispatch_table.set(t, fn); return null; },
  constructor: () => null, __newobj__: (cls, ...a) => cls.__new__ ? cls.__new__(cls, ...a) : cls(...a),
  add_extension: () => null, remove_extension: () => null, clear_extension_cache: () => null,
});

// ── zipimport: importing from zip archives — the module (and its zipimporter class) exist;
// there are no zip archives on the import path here ──
adderModules.zipimport = _syModule('zipimport', {
  ZipImportError: makeExcType('ZipImportError', 'ImportError'),
  zipimporter: _syClass('zipimporter', [], {
    __init__(self, path) { throw new AdderError('ZipImportError', `not a Zip file: ${pyRepr(path)}`); },
  }, 'zipimport'),
});

// ── subprocess: no processes in a browser — every way of running one raises ──
{
  const SubprocessError = makeExcType('SubprocessError', 'Exception');
  const CalledProcessError = makeExcType('CalledProcessError', 'SubprocessError');
  const noProc = (args) => { const e = new AdderError('FileNotFoundError', `[Errno 2] No such file or directory: ${pyRepr(Array.isArray(args) ? String(args[0]) : String(args))} (no processes here)`); e.errno = 2; return e; };
  const run = (args) => { throw noProc(args); };
  adderModules.subprocess = _syModule('subprocess', {
    PIPE: -1, STDOUT: -2, DEVNULL: -3,
    run, call: run, check_call: run, check_output: run, getoutput: run, getstatusoutput: run,
    Popen: Object.assign((args) => { throw noProc(args); }, { _pyName: 'Popen', __name__: 'Popen', _pyClass: true }),
    CompletedProcess: _syClass('CompletedProcess', [], { __init__(self, args, returncode, stdout = null, stderr = null) { Object.assign(self, { args, returncode, stdout, stderr }); return null; } }, 'subprocess'),
    CalledProcessError, SubprocessError, TimeoutExpired: makeExcType('TimeoutExpired', 'SubprocessError'),
    list2cmdline: (seq) => [...pyIter(seq)].map((s) => (/[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s)).join(' '),
  });
}

// ── socket: no sockets — constants and pure helpers work, connecting raises ──
{
  const gaierror = makeExcType('socket.gaierror', 'OSError');
  const herror = makeExcType('socket.herror', 'OSError');
  const noNet = () => { const e = new AdderError('OSError', '[Errno 97] sockets are not available here'); e.errno = 97; return e; };
  const sock = Object.assign(() => { throw noNet(); }, { _pyName: 'socket', __name__: 'socket', _pyClass: true });
  const ipv4 = (s) => { const p = String(s).split('.'); if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || +x > 255)) throw new AdderError('OSError', 'illegal IP address string passed to inet_aton'); return new Uint8Array(p.map(Number)); };
  adderModules.socket = _syModule('socket', {
    AF_UNSPEC: 0, AF_UNIX: 1, AF_INET: 2, AF_INET6: 10, SOCK_STREAM: 1, SOCK_DGRAM: 2, SOCK_RAW: 3,
    SOL_SOCKET: 1, SO_REUSEADDR: 2, SO_KEEPALIVE: 9, SO_SNDBUF: 7, SO_RCVBUF: 8, SO_BROADCAST: 6, SOL_TCP: 6,
    IPPROTO_TCP: 6, IPPROTO_UDP: 17, IPPROTO_IP: 0, IPPROTO_IPV6: 41, TCP_NODELAY: 1, TCP_KEEPIDLE: 4, TCP_KEEPINTVL: 5, TCP_KEEPCNT: 6,
    AI_PASSIVE: 1, AI_CANONNAME: 2, AI_NUMERICHOST: 4, NI_NUMERICHOST: 1, SHUT_RD: 0, SHUT_WR: 1, SHUT_RDWR: 2, MSG_PEEK: 2,
    has_ipv6: false, socket: sock, SocketType: sock, error: makeExcType('OSError', 'Exception'),
    timeout: makeExcType('TimeoutError', 'OSError'), gaierror, herror,
    _GLOBAL_DEFAULT_TIMEOUT: Object.freeze({ __adderClass__: 'object' }),
    create_connection: () => { throw noNet(); }, create_server: () => { throw noNet(); }, socketpair: () => { throw noNet(); }, fromfd: () => { throw noNet(); },
    getaddrinfo: (host) => { throw new AdderError('socket.gaierror', `[Errno -2] Name or service not known: ${pyRepr(host)}`); },
    gethostbyname: (host) => { if (host === 'localhost') return '127.0.0.1'; throw new AdderError('socket.gaierror', '[Errno -2] Name or service not known'); },
    gethostname: () => 'localhost', getfqdn: (n = '') => n || 'localhost',
    getdefaulttimeout: () => null, setdefaulttimeout: () => null,
    inet_aton: ipv4, inet_ntoa: (b) => [...b].join('.'),
    inet_pton: (fam, s) => (fam === 2 ? ipv4(s) : (() => { throw new AdderError('OSError', 'inet_pton: IPv6 is not supported here'); })()),
    inet_ntop: (fam, b) => (fam === 2 ? [...b].join('.') : (() => { throw new AdderError('OSError', 'inet_ntop: IPv6 is not supported here'); })()),
    htons: (x) => ((x & 0xff) << 8) | ((x >> 8) & 0xff), ntohs: (x) => ((x & 0xff) << 8) | ((x >> 8) & 0xff),
    htonl: (x) => (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >> 8) & 0xff00) | ((x >>> 24) & 0xff)) >>> 0,
    ntohl: (x) => (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >> 8) & 0xff00) | ((x >>> 24) & 0xff)) >>> 0,
  });
}

// ── string.Formatter: str.format as an overridable class (markupsafe, logging subclass it) ──
{
  // the replacement fields of a format string: (literal, field_name, format_spec, conversion) …
  const parse = (s) => {
    const out = [];
    let lit = '', i = 0;
    s = String(s);
    while (i < s.length) {
      const c = s[i];
      if (c === '{' && s[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (c === '}' && s[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (c === '}') throw new AdderError('ValueError', "Single '}' encountered in format string");
      if (c !== '{') { lit += c; i++; continue; }
      let depth = 1, j = i + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; if (depth) j++; }
      if (depth) throw new AdderError('ValueError', "Single '{' encountered in format string");
      const field = s.slice(i + 1, j);
      let name = field, conv = null, spec = '';
      const colon = (() => { let d = 0; for (let k = 0; k < field.length; k++) { if (field[k] === '[') d++; else if (field[k] === ']') d--; else if (field[k] === ':' && !d) return k; } return -1; })();
      if (colon >= 0) { spec = field.slice(colon + 1); name = field.slice(0, colon); }
      const bang = name.lastIndexOf('!');
      if (bang >= 0 && /^[rsa]$/.test(name.slice(bang + 1))) { conv = name.slice(bang + 1); name = name.slice(0, bang); }
      out.push(mkTuple([lit, name, spec, conv]));
      lit = ''; i = j + 1;
    }
    if (lit || !out.length) out.push(mkTuple([lit, null, null, null]));
    return out;
  };
  const call = (self, name, ...a) => { const f = adderGetAttr(self, name); return f(...a); };
  const seq = async (items, f) => { const out = []; for (const x of items) out.push(await f(x)); return out; };
  const Formatter = _syClass('Formatter', [], {
    format(self, fmt, ...a) { const kw = _syKw(a) || {}; const kwargs = new PyDict(Object.entries(kw).filter(([k]) => k !== '_kw')); return call(self, 'vformat', fmt, mkTuple(a), kwargs); },
    async vformat(self, fmt, args, kwargs) {
      const used = new PySet();
      let auto = 0;
      const render = async (s, depth) => {
        if (depth < 0) throw new AdderError('ValueError', 'Max string recursion exceeded');
        let out = '';
        for (const [lit, name, spec0, conv] of await call(self, 'parse', s)) {
          out += lit;
          if (name === null || name === undefined) continue;
          let fname = name;
          if (fname === '') { fname = String(auto++); }
          const [obj, argUsed] = await call(self, 'get_field', fname, args, kwargs);
          used.add(argUsed);
          const conv2 = await call(self, 'convert_field', obj, conv);
          const spec = await render(spec0 || '', depth - 1);
          out += await call(self, 'format_field', conv2, spec);
        }
        return out;
      };
      const result = await render(fmt, 2);
      await call(self, 'check_unused_args', used, args, kwargs);
      return result;
    },
    parse(self, s) { return parse(s); },
    async get_field(self, name, args, kwargs) {
      const m = /^([^.[]*)(.*)$/.exec(name);
      const first = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
      let obj = await call(self, 'get_value', first, args, kwargs);
      const rest = m[2];
      const re = /\.([^.[]+)|\[([^\]]*)\]/g;
      let mm;
      while ((mm = re.exec(rest))) {
        if (mm[1] !== undefined) obj = adderGetAttr(obj, mm[1]);
        else { const k = /^\d+$/.test(mm[2]) ? Number(mm[2]) : mm[2]; obj = obj instanceof Map ? obj.get(k) : obj[k]; }
      }
      return mkTuple([obj, first]);
    },
    get_value(self, key, args, kwargs) {
      if (typeof key === 'number') { if (key >= args.length) throw new AdderError('IndexError', `Replacement index ${key} out of range for positional args tuple`); return args[key]; }
      if (!(kwargs instanceof Map ? kwargs.has(key) : key in kwargs)) throw new AdderError('KeyError', pyRepr(key));
      return kwargs instanceof Map ? kwargs.get(key) : kwargs[key];
    },
    check_unused_args() { return null; },
    format_field(self, value, spec) { return pyFormatValue(value, spec); },
    convert_field(self, value, conv) {
      if (conv === null || conv === undefined) return value;
      if (conv === 's') return pyStr(value);
      if (conv === 'r') return pyRepr(value);
      if (conv === 'a') return pyRepr(value).replace(/[^\x00-\x7f]/g, (c) => { const cp = c.codePointAt(0); return cp < 0x100 ? '\\x' + cp.toString(16).padStart(2, '0') : '\\u' + cp.toString(16).padStart(4, '0'); });
      throw new AdderError('ValueError', `Unknown conversion specifier ${conv}`);
    },
  }, 'string');
  adderModules.string.Formatter = Formatter;
  adderModules.string.Template = adderModules.string.Template || null;
}

// ── calendar.Day / calendar.Month: IntEnums whose members print as calendar.MONDAY (3.12) ──
{
  const cal = adderModules.calendar, en = adderModules.enum;
  if (en && en.IntEnum) {
    const mk = (name, members, start) => {
      const E = en.IntEnum(name, members, { _kw: true, start });
      if (_syIsThen(E)) return null;
      E.__module__ = 'calendar';
      E.prototype.__repr__ = function () { return `calendar.${adderGetAttr(this, 'name')}`; };
      return E;
    };
    const Day = mk('Day', 'MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY SUNDAY', 0);
    const Month = mk('Month', 'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER', 1);
    if (Day && Month) {
      cal.Day = Day; cal.Month = Month;
      for (const n of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']) cal[n] = adderGetAttr(Day, n);
      for (const n of ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']) cal[n] = adderGetAttr(Month, n);
      const plainWeekday = cal.weekday, plainRange = cal.monthrange;
      cal.weekday = (y, m, d) => Day(plainWeekday(y, m, d));
      cal.monthrange = (y, m) => { const r = plainRange(y, m); return mkTuple([Day(r[0]), r[1]]); };
    }
  }
}

// ── inspect (over the signature both engines record on a def: _pySig) ──
{
  const isClass = (o) => typeof o === 'function' && !!o._pyClass;
  const isPyFunction = (o) => typeof o === 'function' && !o._pyClass && !!(o._pyDef || o._pyFunc);
  const isMethod = (o) => typeof o === 'function' && !!o.__func__ && !o._pyClass;
  const isAsyncFn = (f) => typeof f === 'function' && (f._pyCoro === true || (f._pySig && f._pySig.isAsync && !f._isGenerator && !/GeneratorFunction$/.test(f.constructor.name)) || (f.constructor && f.constructor.name === 'AsyncFunction' && !f._pySig) || f._isCoroutineFunction === true);
  const empty = Object.freeze({ __adderClass__: 'inspect._empty', __repr__: () => "<class 'inspect._empty'>" });
  const KINDS = { POSITIONAL_ONLY: 0, POSITIONAL_OR_KEYWORD: 1, VAR_POSITIONAL: 2, KEYWORD_ONLY: 3, VAR_KEYWORD: 4 };
  const kindObj = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, Object.assign(Object.create(null), { __adderClass__: '_ParameterKind', name: k, value: v, __repr__: () => `<_ParameterKind.${k}: ${v}>`, __str__: () => k, __eq__: (o) => o && o.value === v })]));
  const Parameter = _syClass('Parameter', [], {
    __init__(self, name, kind, ...a) {
      const { default: def, annotation } = _syArgs(a, ['default', 'annotation'], { default: empty, annotation: empty });
      self.name = name; self.kind = typeof kind === 'number' ? Object.values(kindObj)[kind] : kind; self.default = def; self.annotation = annotation;
      return null;
    },
    __repr__(self) { return `<Parameter "${self.__str__()}">`; },
    __str__(self) {
      const k = self.kind && self.kind.name;
      const pre = k === 'VAR_POSITIONAL' ? '*' : k === 'VAR_KEYWORD' ? '**' : '';
      return pre + self.name + (self.default !== empty ? `=${pyRepr(self.default)}` : '');
    },
    replace(self, ...a) { const kw = _syKw(a) || {}; return Parameter(kw.name ?? self.name, kw.kind ?? self.kind, { _kw: true, default: Object.hasOwn(kw, 'default') ? kw.default : self.default, annotation: Object.hasOwn(kw, 'annotation') ? kw.annotation : self.annotation }); },
  }, 'inspect');
  Object.assign(Parameter, kindObj, { empty });
  const Signature = _syClass('Signature', [], {
    __init__(self, parameters = null, ...a) {
      const { return_annotation } = _syArgs(a, ['return_annotation'], { return_annotation: empty });
      const params = new PyDict();
      for (const p of parameters ? pyIter(parameters) : []) params.set(p.name, p);
      self.parameters = params; self.return_annotation = return_annotation;
      return null;
    },
    __str__(self) {
      const ps = [...self.parameters.values()];
      const parts = [];
      let sawKwOnly = false, sawPosOnly = false;
      ps.forEach((p, i) => {
        const k = p.kind.name;
        if (k === 'POSITIONAL_ONLY') sawPosOnly = true;
        else if (sawPosOnly) { parts.push('/'); sawPosOnly = false; }
        if (k === 'KEYWORD_ONLY' && !sawKwOnly && !ps.some((q) => q.kind.name === 'VAR_POSITIONAL')) { parts.push('*'); sawKwOnly = true; }
        parts.push(p.__str__());
      });
      if (sawPosOnly) parts.push('/');
      return `(${parts.join(', ')})`;
    },
    __repr__(self) { return `<Signature ${self.__str__()}>`; },
    replace(self, ...a) { const kw = _syKw(a) || {}; return Signature(kw.parameters ?? [...self.parameters.values()], { _kw: true, return_annotation: Object.hasOwn(kw, 'return_annotation') ? kw.return_annotation : self.return_annotation }); },
    bind(self, ...a) { return bindArgs(self, a, false); },
    bind_partial(self, ...a) { return bindArgs(self, a, true); },
  }, 'inspect');
  Signature.empty = empty;
  const BoundArguments = _syClass('BoundArguments', [], {
    __init__(self, sig, args) { self.signature = sig; self.arguments = args; return null; },
    // the arguments in signature order, the missing ones filled from defaults (CPython's order)
    apply_defaults(self) {
      const out = new PyDict();
      for (const p of self.signature.parameters.values()) {
        if (self.arguments.has(p.name)) out.set(p.name, self.arguments.get(p.name));
        else if (p.default !== empty) out.set(p.name, p.default);
        else if (p.kind.name === 'VAR_POSITIONAL') out.set(p.name, mkTuple([]));
        else if (p.kind.name === 'VAR_KEYWORD') out.set(p.name, new PyDict());
      }
      self.arguments = out;
      return null;
    },
  }, 'inspect');
  Object.defineProperty(BoundArguments.prototype, 'args', { get() { const out = []; for (const p of this.signature.parameters.values()) { if (!this.arguments.has(p.name)) continue; const k = p.kind.name; if (k === 'VAR_POSITIONAL') out.push(...this.arguments.get(p.name)); else if (k === 'POSITIONAL_ONLY' || k === 'POSITIONAL_OR_KEYWORD') out.push(this.arguments.get(p.name)); } return mkTuple(out); }, configurable: true });
  Object.defineProperty(BoundArguments.prototype, 'kwargs', { get() { const out = new PyDict(); for (const p of this.signature.parameters.values()) { if (!this.arguments.has(p.name)) continue; if (p.kind.name === 'KEYWORD_ONLY') out.set(p.name, this.arguments.get(p.name)); if (p.kind.name === 'VAR_KEYWORD') for (const [k, v] of this.arguments.get(p.name)) out.set(k, v); } return out; }, configurable: true });
  function bindArgs(sig, a, partial) {
    const kw = _syKw(a) || {};
    const kwargs = Object.fromEntries(Object.entries(kw).filter(([k]) => k !== '_kw'));
    const out = new PyDict();
    const ps = [...sig.parameters.values()];
    let i = 0;
    for (const p of ps) {
      const k = p.kind.name;
      if (k === 'POSITIONAL_ONLY' || k === 'POSITIONAL_OR_KEYWORD') {
        if (i < a.length) { if (Object.hasOwn(kwargs, p.name) && k !== 'POSITIONAL_ONLY') throw new AdderError('TypeError', `multiple values for argument '${p.name}'`); out.set(p.name, a[i++]); }
        else if (k !== 'POSITIONAL_ONLY' && Object.hasOwn(kwargs, p.name)) { out.set(p.name, kwargs[p.name]); delete kwargs[p.name]; }
        else if (p.default === empty && !partial) throw new AdderError('TypeError', `missing a required argument: '${p.name}'`);
      } else if (k === 'VAR_POSITIONAL') { out.set(p.name, mkTuple(a.slice(i))); i = a.length; }
      else if (k === 'KEYWORD_ONLY') {
        if (Object.hasOwn(kwargs, p.name)) { out.set(p.name, kwargs[p.name]); delete kwargs[p.name]; }
        else if (p.default === empty && !partial) throw new AdderError('TypeError', `missing a required argument: '${p.name}'`);
      } else if (k === 'VAR_KEYWORD') { out.set(p.name, new PyDict(Object.entries(kwargs))); for (const n of Object.keys(kwargs)) delete kwargs[n]; }
    }
    if (i < a.length) throw new AdderError('TypeError', 'too many positional arguments');
    const extra = Object.keys(kwargs);
    if (extra.length) throw new AdderError('TypeError', `got an unexpected keyword argument '${extra[0]}'`);
    return BoundArguments(sig, out);
  }
  // follow functools.wraps' __wrapped__ chain
  const unwrap = (f, ...a) => { const { stop } = _syArgs(a, ['stop'], { stop: null }); const seen = new Set(); while (f && f.__wrapped__ && !seen.has(f) && !(stop && stop(f))) { seen.add(f); f = f.__wrapped__; } return f; };
  const signature = (obj, ...a) => {
    const { follow_wrapped } = _syArgs(a, ['follow_wrapped', 'globals', 'locals', 'eval_str'], { follow_wrapped: true });
    if (obj === null || obj === undefined) throw new AdderError('TypeError', `${pyRepr(obj)} is not a callable object`);
    if (follow_wrapped) obj = unwrap(obj);
    if (obj && obj.__signature__) return obj.__signature__;
    let fn = obj, dropFirst = false;
    if (isClass(obj)) {
      // a class: its __init__'s parameters, less self
      const init = obj.prototype && obj.prototype.__init__;
      fn = init && init.__func__ ? init.__func__ : null; dropFirst = true;
      if (!fn) return Signature([]);
    } else if (typeof obj === 'function' && obj.__func__ && !obj._pySig) { fn = obj.__func__; dropFirst = true; }   // a bound method
    else if (obj && typeof obj === 'object' && typeof obj.__call__ === 'function') { const c = obj.__call__; fn = c.__func__ || c; dropFirst = !!c.__func__; }
    const sig = fn && fn._pySig;
    if (!sig) {
      if (typeof obj !== 'function' && !(obj && obj.__call__)) throw new AdderError('TypeError', `${pyRepr(obj)} is not a callable object`);
      throw new AdderError('ValueError', `no signature found for ${pyRepr(obj)}`);
    }
    const params = [];
    const mk = (name, kind, has) => Parameter(name, kindObj[kind], { _kw: true, default: has ? sig.defaults[name] : empty });
    for (const p of sig.params) params.push(mk(p.name, p.kind, p.hasDefault));
    if (sig.vararg) params.push(mk(sig.vararg, 'VAR_POSITIONAL', false));
    for (const p of sig.kwonly) params.push(mk(p.name, p.kind, p.hasDefault));
    if (sig.kwarg) params.push(mk(sig.kwarg, 'VAR_KEYWORD', false));
    if (dropFirst && params.length && (params[0].kind.name === 'POSITIONAL_OR_KEYWORD' || params[0].kind.name === 'POSITIONAL_ONLY')) params.shift();
    return Signature(params);
  };
  const cleandoc = (doc) => {
    const lines = String(doc).replace(/\t/g, '        ').split('\n');
    let margin = Infinity;
    for (const l of lines.slice(1)) { const s = l.replace(/^\s+/, ''); if (s) margin = Math.min(margin, l.length - s.length); }
    const out = [lines[0].replace(/^\s+/, '')];
    for (const l of lines.slice(1)) out.push(margin < Infinity ? l.slice(margin) : l);
    while (out.length && !out[out.length - 1].trim()) out.pop();
    while (out.length && !out[0].trim()) out.shift();
    return out.join('\n');
  };
  const getmembers = (obj, pred = null) => {
    const names = new Set();
    let o = obj;
    if (isClass(obj)) { for (const c of obj._pyMRO || [obj]) { for (const k of Object.keys(c)) names.add(k); if (c.prototype) for (const k of Object.getOwnPropertyNames(c.prototype)) names.add(k); } }
    else for (; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) names.add(k);
    const out = [];
    for (const k of [...names].sort()) {
      if (k.startsWith('_py') || k.startsWith('__adder') || k === 'constructor' || k === 'prototype' || k === 'length' || k === 'name' || k === 'caller' || k === 'arguments') continue;
      let v; try { v = adderGetAttr(obj, k); } catch { continue; }
      if (!pred || pred(v) === true) out.push(mkTuple([k, v]));
    }
    return out;
  };
  adderModules.inspect = _syModule('inspect', {
    Parameter, Signature, BoundArguments, signature, unwrap, cleandoc, getmembers,
    getmembers_static: getmembers,
    isclass: isClass, isfunction: isPyFunction, ismethod: isMethod, ismodule: (o) => !!(o && o.__adderModule__),
    isbuiltin: (o) => typeof o === 'function' && !o._pyClass && !o._pyDef && !o._pyFunc && !o.__func__,
    isroutine: (o) => typeof o === 'function' && !o._pyClass,
    isgeneratorfunction: (o) => typeof o === 'function' && (!!o._isGenerator || (o.constructor && o.constructor.name === 'GeneratorFunction')),
    isasyncgenfunction: (o) => typeof o === 'function' && o.constructor && o.constructor.name === 'AsyncGeneratorFunction',
    iscoroutinefunction: isAsyncFn,
    markcoroutinefunction: (f) => { f._isCoroutineFunction = true; return f; },
    isgenerator: (o) => !!o && typeof o.next === 'function' && typeof o.throw === 'function' && !o[Symbol.asyncIterator],
    isasyncgen: (o) => !!o && typeof o[Symbol.asyncIterator] === 'function' && typeof o.next === 'function',
    iscoroutine: (o) => _syIsCoro(o),
    isawaitable: (o) => _syIsThen(o) || (!!o && typeof o.__await__ === 'function'),
    getcoroutinestate: (o) => (o._p ? 'CORO_CLOSED' : o._closed ? 'CORO_CLOSED' : 'CORO_CREATED'),
    isabstract: (o) => isClass(o) && !!(o.__abstractmethods__ && o.__abstractmethods__.size),
    isdatadescriptor: (o) => !!(o && o.__property__), ismethoddescriptor: () => false, isgetsetdescriptor: () => false, ismemberdescriptor: () => false,
    isframe: () => false, iscode: () => false, istraceback: () => false, ismethodwrapper: () => false,
    getmro: (cls) => mkTuple([...(cls._pyMRO || [cls]), pyObjectObj]),
    getdoc: (o) => { const d = o && (o.__doc__ ?? (o.__func__ && o.__func__.__doc__)); return d ? cleandoc(d) : null; },
    getmodule: (o) => (o && o.__module__ && adderModules.sys.modules[o.__module__]) || null,
    getfile: (o) => { if (o && o.__file__) return o.__file__; throw new AdderError('TypeError', `${pyRepr(o)} is a built-in object`); },
    getsourcefile: (o) => (o && o.__file__) || null,
    getsource: () => { throw new AdderError('OSError', 'could not get source code'); },
    getsourcelines: () => { throw new AdderError('OSError', 'could not get source code'); },
    getcomments: () => null,
    currentframe: () => null, stack: () => [], trace: () => [], getframeinfo: () => { throw new AdderError('TypeError', 'no frames here'); },
    getattr_static: (o, n, d) => { try { return adderGetAttr(o, n); } catch (e) { if (d !== undefined) return d; throw e; } },
    getfullargspec: (f) => {
      const s = signature(f); const ps = [...s.parameters.values()];
      const args = ps.filter((p) => p.kind.value <= 1).map((p) => p.name);
      const varargs = (ps.find((p) => p.kind.value === 2) || {}).name ?? null;
      const varkw = (ps.find((p) => p.kind.value === 4) || {}).name ?? null;
      const kwonlyargs = ps.filter((p) => p.kind.value === 3).map((p) => p.name);
      const defs = ps.filter((p) => p.kind.value <= 1 && p.default !== empty).map((p) => p.default);
      const kwd = ps.filter((p) => p.kind.value === 3 && p.default !== empty);
      return mkTuple([args, varargs, varkw, defs.length ? mkTuple(defs) : null, kwonlyargs, kwd.length ? new PyDict(kwd.map((p) => [p.name, p.default])) : null, new PyDict()]);
    },
    get_annotations: (o) => (o && o.__annotations__) || new PyDict(),
    CO_COROUTINE: 128, CO_GENERATOR: 32, CO_VARARGS: 4, CO_VARKEYWORDS: 8,
  });
}

// ── asyncio, over JS promises (an `async def` call is already a running promise here) ──
{
  const CancelledError = makeExcType('CancelledError', 'BaseException');
  const InvalidStateError = makeExcType('InvalidStateError', 'Exception');
  const TimeoutErr = makeExcType('TimeoutError', 'OSError');
  const sleep = (delay, result = null) => new Promise((r) => setTimeout(() => r(result), Math.max(0, Number(delay) || 0) * 1000));
  // a Future / Task: a thenable with the asyncio surface
  const mkFuture = (promise) => {
    let done = false, result, error = null, cancelled = false;
    const callbacks = [];
    let resolveP, rejectP;
    const p = promise || new Promise((res, rej) => { resolveP = res; rejectP = rej; });
    const fut = {
      __adderClass__: promise ? 'Task' : 'Future',
      // not a thenable (a call returning a Task must not await it): `await task` goes through __await__
      done: () => done, cancelled: () => cancelled,
      result: () => { if (!done) throw new AdderError('InvalidStateError', 'Result is not set.'); if (error) throw error; return result; },
      exception: () => { if (!done) throw new AdderError('InvalidStateError', 'Exception is not set.'); return error; },
      set_result: (v) => { if (done) throw new AdderError('InvalidStateError', 'invalid state'); if (resolveP) resolveP(v); return null; },
      set_exception: (e) => { if (done) throw new AdderError('InvalidStateError', 'invalid state'); if (rejectP) rejectP(e); return null; },
      cancel: () => { if (done) return false; cancelled = true; const e = new AdderError('CancelledError', ''); if (rejectP) rejectP(e); done = true; error = e; return true; },
      add_done_callback: (cb) => { if (done) cb(fut); else callbacks.push(cb); return null; },
      remove_done_callback: (cb) => { const i = callbacks.indexOf(cb); if (i >= 0) callbacks.splice(i, 1); return i >= 0 ? 1 : 0; },
      get_name: () => fut._name || 'Task-1', set_name: (n) => { fut._name = n; return null; },
      get_coro: () => fut._coro || promise || null,
      __await__: () => p,
    };
    p.then((v) => { if (!done) { done = true; result = v; } for (const cb of callbacks.splice(0)) cb(fut); },
      (e) => { if (!done) { done = true; error = e; } for (const cb of callbacks.splice(0)) cb(fut); });
    p.catch(() => {});
    return fut;
  };
  // anything awaitable as a promise: a Task / Future through its __await__
  const asP = (x) => Promise.resolve(x !== null && typeof x === 'object' && typeof x.__await__ === 'function' && typeof x.then !== 'function' ? x.__await__() : x);
  // a Task: its coroutine starts on the loop's next step, not inside create_task — when the task
  // that made it next really waits (a macrotask: every adder call is awaited, so a microtask would
  // run it at the very next statement)
  const nextStep = typeof setImmediate === 'function' ? (f) => setImmediate(f)
    : typeof MessageChannel === 'function' ? (() => { const q = []; const ch = new MessageChannel(); ch.port1.onmessage = () => q.shift()(); return (f) => { q.push(f); ch.port2.postMessage(0); }; })()
      : (f) => setTimeout(f, 0);
  const create_task = (coro, ...a) => {
    const kw = _syKw(a);
    const t = mkFuture(new Promise((res) => nextStep(res)).then(() => (t.cancelled() && coro && typeof coro.close === "function" ? coro.close() : asP(coro))));
    t._coro = coro;
    if (kw && kw.name) t._name = kw.name;
    return t;
  };
  // a coroutine handed to gather / as_completed becomes a Task (ensure_future): started on a later
  // step, it runs until it really waits — started here, every coroutine's await of a sync method
  // call let the next one run (adder 'ababab' where CPython prints 'aaabbb')
  const isFut = (x) => x !== null && typeof x === 'object' && typeof x.add_done_callback === 'function' && typeof x.__await__ === 'function';
  const ensureFut = (x) => (isFut(x) ? x : create_task(x));
  const gather = (...a) => {
    const kw = _syKw(a) || {};
    const ps = a.map((x) => asP(ensureFut(x)));
    if (kw.return_exceptions) return Promise.allSettled(ps).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? r.value : excValue(r.reason))));
    return Promise.all(ps);
  };
  const wait_for = (aw, timeout) => {
    if (timeout === null || timeout === undefined) return asP(aw);
    let h;
    return Promise.race([asP(aw), new Promise((_, rej) => { h = setTimeout(() => rej(new AdderError('TimeoutError', '')), timeout * 1000); })]).finally(() => clearTimeout(h));
  };
  const Loop = _syClass('AbstractEventLoop', [], {
    run_until_complete(self, aw) { return asP(aw); },
    run_forever(self) { throw new AdderError('RuntimeError', 'run_forever(): the page runs the loop'); },
    create_task(self, coro) { return create_task(coro); },
    create_future(self) { return mkFuture(null); },
    call_soon(self, fn, ...a) { _syKw(a); queueMicrotask(() => fn(...a)); return { cancel: () => null }; },
    call_later(self, delay, fn, ...a) { _syKw(a); const h = setTimeout(() => fn(...a), delay * 1000); return { cancel: () => { clearTimeout(h); return null; } }; },
    call_at(self, when, fn, ...a) { _syKw(a); const h = setTimeout(() => fn(...a), Math.max(0, when - performance.now() / 1000) * 1000); return { cancel: () => { clearTimeout(h); return null; } }; },
    time(self) { return performance.now() / 1000; },
    run_in_executor(self, executor, fn, ...a) { return Promise.resolve().then(() => fn(...a)); },
    is_running(self) { return true; }, is_closed(self) { return false; }, close(self) { return null; },
    set_debug(self) { return null; }, get_debug(self) { return false; },
    set_exception_handler(self) { return null; }, default_exception_handler(self) { return null; },
    shutdown_asyncgens(self) { return Promise.resolve(null); },
  }, 'asyncio');
  const loop = Loop();
  const Event = _syClass('Event', [], {
    __init__(self) { self._set = false; self._waiters = []; return null; },
    is_set(self) { return self._set; },
    set(self) { self._set = true; for (const w of self._waiters.splice(0)) w(true); return null; },
    clear(self) { self._set = false; return null; },
    wait(self) { return self._set ? Promise.resolve(true) : new Promise((r) => self._waiters.push(r)); },
  }, 'asyncio');
  const Lock = _syClass('Lock', [], {
    __init__(self) { self._locked = false; self._waiters = []; return null; },
    locked(self) { return self._locked; },
    acquire(self) { if (!self._locked) { self._locked = true; return Promise.resolve(true); } return new Promise((r) => self._waiters.push(() => { self._locked = true; r(true); })); },
    release(self) { if (!self._locked) throw new AdderError('RuntimeError', 'Lock is not acquired.'); self._locked = false; const w = self._waiters.shift(); if (w) w(); return null; },
    __aenter__(self) { return self.acquire().then(() => null); },
    __aexit__(self) { self.release(); return Promise.resolve(false); },
  }, 'asyncio');
  const Semaphore = _syClass('Semaphore', [], {
    __init__(self, value = 1) { self._value = value; self._waiters = []; return null; },
    locked(self) { return self._value === 0; },
    acquire(self) { if (self._value > 0) { self._value--; return Promise.resolve(true); } return new Promise((r) => self._waiters.push(() => r(true))); },
    release(self) { const w = self._waiters.shift(); if (w) w(); else self._value++; return null; },
    __aenter__(self) { return self.acquire().then(() => null); },
    __aexit__(self) { self.release(); return Promise.resolve(false); },
  }, 'asyncio');
  const QueueEmpty = makeExcType('QueueEmpty', 'Exception'), QueueFull = makeExcType('QueueFull', 'Exception');
  const Queue = _syClass('Queue', [], {
    __init__(self, maxsize = 0) { self.maxsize = maxsize; self._q = []; self._getters = []; self._unfinished = 0; self._joiners = []; return null; },
    qsize(self) { return self._q.length; }, empty(self) { return !self._q.length; }, full(self) { return self.maxsize > 0 && self._q.length >= self.maxsize; },
    put_nowait(self, x) { if (self.maxsize > 0 && self._q.length >= self.maxsize) throw new AdderError('QueueFull', ''); self._unfinished++; const g = self._getters.shift(); if (g) g(x); else self._q.push(x); return null; },
    put(self, x) { self.put_nowait(x); return Promise.resolve(null); },
    get_nowait(self) { if (!self._q.length) throw new AdderError('QueueEmpty', ''); return self._q.shift(); },
    get(self) { if (self._q.length) return Promise.resolve(self._q.shift()); return new Promise((r) => self._getters.push(r)); },
    task_done(self) { if (self._unfinished <= 0) throw new AdderError('ValueError', 'task_done() called too many times'); if (--self._unfinished === 0) for (const j of self._joiners.splice(0)) j(null); return null; },
    join(self) { return self._unfinished === 0 ? Promise.resolve(null) : new Promise((r) => self._joiners.push(r)); },
  }, 'asyncio');
  // asyncio.timeout(delay): an async context manager raising TimeoutError if the block runs over
  const timeout = (delay) => ({
    __adderClass__: 'Timeout',
    __aenter__() { this._t0 = performance.now(); return Promise.resolve(this); },
    __aexit__(t, v) { if (delay !== null && delay !== undefined && (performance.now() - this._t0) / 1000 > delay) return Promise.reject(new AdderError('TimeoutError', '')); return Promise.resolve(false); },
    reschedule(d) { delay = d; return null; }, expired() { return false; },
  });
  // asyncio.Runner: run() is asyncio.run on the page's one loop (a Promise the calling code awaits)
  const Runner = _syClass('Runner', [], {
    __init__(self, ...a) { _syArgs(a, ['debug', 'loop_factory'], { debug: null, loop_factory: null }); self._closed = false; return null; },
    run(self, coro, ...a) {
      _syKw(a);
      if (self._closed) throw new AdderError('RuntimeError', 'Runner is closed');
      if (coro === null || typeof coro !== 'object' || !(_syIsCoro(coro) || typeof coro.__await__ === 'function')) throw new AdderError('ValueError', `a coroutine was expected, got ${pyRepr(coro)}`);
      return asP(coro);
    },
    get_loop(self) { return loop; },
    close(self) { self._closed = true; return null; },
    __enter__(self) { return self; },
    __exit__(self) { self._closed = true; return false; },
  }, 'asyncio');
  const isCoroMark = pyObjectObj();
  const iscoroutinefunction = (f) => adderModules.inspect.iscoroutinefunction(f) || (f !== null && f !== undefined && (() => { try { return adderGetAttr(f, '_is_coroutine') === isCoroMark; } catch { return false; } })());
  adderModules.asyncio = _syModule('asyncio', {
    run: (coro, ...a) => { _syKw(a); return asP(coro); }, Runner,
    sleep, gather, wait_for, create_task, ensure_future: create_task, shield: (aw) => aw, timeout,
    wait: (aws, ...a) => { const { timeout: to } = _syArgs(a, ['timeout', 'return_when'], { timeout: null }); const fs = [...pyIter(aws)].map((x) => (x && x.done ? x : create_task(x))); return wait_for(Promise.allSettled(fs.map(asP)), to).then(() => mkTuple([new PySet(fs), new PySet()])); },
    as_completed: (aws) => { const ps = [...pyIter(aws)].map((x) => asP(ensureFut(x))); const order = []; const waiters = ps.map(() => { let r, j; const p = new Promise((a, b) => { r = a; j = b; }); return { p, r, j }; }); let k = 0; ps.forEach((p) => p.then((v) => waiters[k++].r(v), (e) => waiters[k++].j(e))); return waiters.map((w) => w.p); },
    iscoroutine: (o) => _syIsCoro(o), iscoroutinefunction, isfuture: (o) => !!(o && o.__adderClass__ && (o.__adderClass__ === 'Future' || o.__adderClass__ === 'Task')),
    get_event_loop: () => loop, get_running_loop: () => loop, new_event_loop: () => Loop(), set_event_loop: () => null,
    get_event_loop_policy: () => ({ get_event_loop: () => loop, new_event_loop: () => Loop(), set_event_loop: () => null }), set_event_loop_policy: () => null,
    AbstractEventLoop: Loop, BaseEventLoop: Loop,
    current_task: () => null, all_tasks: () => new PySet(),
    to_thread: (fn, ...a) => { const kw = _syKw(a); return Promise.resolve().then(() => (kw ? fn(...a, kw) : fn(...a))); },
    run_coroutine_threadsafe: (coro) => create_task(coro),
    Future: Object.assign(() => mkFuture(null), { _pyName: 'Future', __name__: 'Future', _pyClass: true }), Task: Object.assign((coro) => create_task(coro), { _pyName: 'Task', __name__: 'Task', _pyClass: true }),
    Event, Lock, Semaphore, BoundedSemaphore: Semaphore, Queue, LifoQueue: Queue, PriorityQueue: Queue, QueueEmpty, QueueFull,
    Condition: _syClass('Condition', [], { __init__(self) { self._ev = Event(); return null; }, wait(self) { return self._ev.wait(); }, notify(self) { self._ev.set(); self._ev.clear(); return null; }, notify_all(self) { self._ev.set(); self._ev.clear(); return null; }, __aenter__(self) { return Promise.resolve(null); }, __aexit__(self) { return Promise.resolve(false); } }, 'asyncio'),
    CancelledError, InvalidStateError, TimeoutError: TimeoutErr, IncompleteReadError: makeExcType('IncompleteReadError', 'EOFError'),
    FIRST_COMPLETED: 'FIRST_COMPLETED', FIRST_EXCEPTION: 'FIRST_EXCEPTION', ALL_COMPLETED: 'ALL_COMPLETED',
    coroutines: _syModule('asyncio.coroutines', { iscoroutine: (o) => _syIsCoro(o), iscoroutinefunction, _is_coroutine: isCoroMark }),
  });
}

// ── typing_extensions: typing, and the names it adds ──
{
  const t = adderModules.typing;
  const Form = t.Any && t.Any.constructor;
  const form = (name) => (Form ? new Form(`typing_extensions.${name}`) : t.Any);
  const te = _syModule('typing_extensions', { ...t });
  for (const n of ['TypeIs', 'ReadOnly', 'Doc', 'NoDefault', 'Buffer', 'CapsuleType', 'TypeAliasType', 'NoExtraItems', 'Format', 'Sentinel']) if (!(n in te)) te[n] = form(n);
  Object.assign(te, {
    override: (f) => { if (f) f.__override__ = true; return f; },
    deprecated: (msg, ...a) => (f) => { if (f) f.__deprecated__ = msg; return f; },
    dataclass_transform: (...a) => (c) => c,
    get_original_bases: (c) => mkTuple(c._pyBases || []),
    get_protocol_members: () => new PySet(), is_protocol: () => false, is_typeddict: (c) => !!(c && c.__total__ !== undefined),
    get_annotations: (o) => (o && o.__annotations__) || new PyDict(),
    runtime: (c) => c, runtime_checkable: (c) => c, final: (f) => f, IntVar: t.TypeVar,
    TYPE_CHECKING: false,
  });
  adderModules.typing_extensions = te;
}

// ── pprint: CPython's line-breaking for dicts, lists, tuples and sets ──
{
  const safeRepr = (v, sortDicts) => {
    if (v instanceof Map || (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype)) {
      const entries = v instanceof Map ? [...v] : Object.entries(v);
      const es = sortDicts ? [...entries].sort((a, b) => (pyLt(a[0], b[0]) ? -1 : pyLt(b[0], a[0]) ? 1 : 0)) : entries;
      if (v.__adderClass__ && v.__adderClass__ !== 'dict') return pyRepr(v);
      return '{' + es.map(([k, x]) => `${safeRepr(k, sortDicts)}: ${safeRepr(x, sortDicts)}`).join(', ') + '}';
    }
    if (Array.isArray(v) && !(v instanceof PyTuple) && !v.__adderClass__) return '[' + v.map((x) => safeRepr(x, sortDicts)).join(', ') + ']';
    if (v instanceof PyTuple && !v.__adderClass__) return '(' + v.map((x) => safeRepr(x, sortDicts)).join(', ') + (v.length === 1 ? ',)' : ')');
    return pyRepr(v);
  };
  function pformat(obj, ...a) {
    const { indent, width, depth, compact, sort_dicts } = _syArgs(a, ['indent', 'width', 'depth', 'stream', 'compact', 'sort_dicts', 'underscore_numbers'], { indent: 1, width: 80, depth: null, compact: false, sort_dicts: true });
    const out = [];
    const write = (s) => out.push(s);
    const fmt = (v, ind, allowance, level) => {
      const rep = safeRepr(v, sort_dicts);
      if (rep.length <= width - ind - allowance) { write(rep); return; }
      const isDict = v instanceof Map ? !(v.__adderClass__ && v.__adderClass__ !== 'dict') : (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype);
      if (isDict) {
        const entries = v instanceof Map ? [...v] : Object.entries(v);
        if (!entries.length) { write(rep); return; }
        const es = sort_dicts ? [...entries].sort((x, y) => (pyLt(x[0], y[0]) ? -1 : pyLt(y[0], x[0]) ? 1 : 0)) : entries;
        write('{'); if (indent > 1) write(' '.repeat(indent - 1));
        const ni = ind + indent;
        es.forEach(([k, x], i) => {
          const kr = safeRepr(k, sort_dicts);
          write(kr + ': ');
          fmt(x, ni + kr.length + 2, i === es.length - 1 ? allowance + 1 : 1, level + 1);
          if (i < es.length - 1) write(',\n' + ' '.repeat(ni));
        });
        write('}');
        return;
      }
      const isList = Array.isArray(v) && !(v instanceof PyTuple) && !v.__adderClass__;
      const isTuple = v instanceof PyTuple && !v.__adderClass__;
      const isSet = v instanceof Set;
      if (isList || isTuple || isSet) {
        const items = isSet ? [...v].sort((x, y) => (pyLt(x, y) ? -1 : pyLt(y, x) ? 1 : 0)) : [...v];
        const [open, close] = isList ? ['[', ']'] : isTuple ? ['(', items.length === 1 ? ',)' : ')'] : (v._frozen ? ['frozenset({', '})'] : ['{', '}']);
        if (!items.length) { write(rep); return; }
        write(open); if (indent > 1) write(' '.repeat(indent - 1));
        const ni = ind + open.length + (indent > 1 ? indent - 1 : 0);
        if (compact) {
          let line = '', first = true;
          const w = width - ni;
          items.forEach((x, i) => {
            const r = safeRepr(x, sort_dicts) + (i < items.length - 1 ? ',' : '');
            if (!first && line.length + 1 + r.length > w - (i === items.length - 1 ? allowance + close.length - 1 : 0)) { write(line + '\n' + ' '.repeat(ni)); line = r; }
            else line = first ? r : line + ' ' + r;
            first = false;
          });
          write(line);
        } else {
          items.forEach((x, i) => {
            fmt(x, ni, i === items.length - 1 ? allowance + close.length : 1, level + 1);
            if (i < items.length - 1) write(',\n' + ' '.repeat(ni));
          });
        }
        write(close);
        return;
      }
      write(rep);
    };
    fmt(obj, 0, 0, 1);
    return out.join('');
  }
  const pprint = (obj, ...a) => {
    const kw = _syKw(a) || {};
    const s = pformat(obj, ...a, { _kw: true, ...kw }) + '\n';
    if (kw.stream && kw.stream.write) return kw.stream.write(s);
    stdoutWrite(s);
    return null;
  };
  const PrettyPrinter = _syClass('PrettyPrinter', [], {
    __init__(self, ...a) { self._kw = _syKw(a) || {}; return null; },
    pformat(self, obj) { return pformat(obj, { _kw: true, ...self._kw }); },
    pprint(self, obj) { return pprint(obj, { _kw: true, ...self._kw }); },
    isreadable() { return true; }, isrecursive() { return false; },
  }, 'pprint');
  adderModules.pprint = _syModule('pprint', {
    pformat, pprint, pp: (obj, ...a) => { const kw = _syKw(a) || {}; return pprint(obj, ...a, { _kw: true, sort_dicts: false, ...kw }); },
    saferepr: (o) => safeRepr(o, true), isreadable: () => true, isrecursive: () => false, PrettyPrinter,
  });
}

// ── os: PathLike, fspath (the os module is made per VFS; these attach when it is) ──
function _syOsExtras(os) {
  const PathLike = _syABCMeta('PathLike', mkTuple([]), new PyDict());
  PathLike.__module__ = 'os';
  PathLike.__instancecheck__ = (o) => o !== null && o !== undefined && typeof o === 'object' && typeof o.__fspath__ === 'function' || (o && o.__adderClass__ === 'PosixPath') || (o && typeof o._path === 'string');
  os.PathLike = PathLike;
  if (!os.fspath) os.fspath = (p) => { if (typeof p === 'string' || p instanceof Uint8Array) return p; if (p && typeof p.__fspath__ === 'function') return p.__fspath__(); if (p && typeof p._path === 'string') return p._path; throw new AdderError('TypeError', `expected str, bytes or os.PathLike object, not ${pyTypeName(p)}`); };
  if (!os.fsencode) os.fsencode = (p) => pyEncode(os.fspath(p), 'utf-8', 'surrogateescape');
  if (!os.fsdecode) os.fsdecode = (p) => { p = os.fspath(p); return p instanceof Uint8Array ? pyDecodePartial(p, 'utf-8', 'surrogateescape', true).text : p; };
  if (!os.name) os.name = 'posix';
  if (!os.linesep) os.linesep = '\n';
  if (!os.devnull) os.devnull = '/dev/null';
  if (!os.__adderModule__) { os.__adderModule__ = true; os.__name__ = 'os'; }
  if (!os.pathsep) Object.assign(os, { pathsep: ':', curdir: '.', pardir: '..', extsep: '.', altsep: null, defpath: '/bin:/usr/bin', SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2 });
  // the environment: a mapping a program may read and change (there is no process to inherit one from)
  if (!os.environ) {
    os.environ = new PyDict([['HOME', os.getcwd ? os.getcwd() : '/'], ['PATH', '/usr/bin:/bin'], ['USER', 'user'], ['LANG', 'C.UTF-8'], ['TERM', 'dumb']]);
    os.environ.__adderClass__ = 'os._Environ';
  }
  if (!os.getenv) os.getenv = (k, d = null) => (os.environ.has(k) ? os.environ.get(k) : d);
  if (!os.putenv) os.putenv = (k, v) => { os.environ.set(k, v); return null; };
  if (!os.unsetenv) os.unsetenv = (k) => { os.environ.delete(k); return null; };
  if (!os.environb) os.environb = new PyDict();
  if (!os.get_exec_path) os.get_exec_path = () => os.environ.get('PATH').split(':');
  const P = os.path;
  if (P && !P.__adderModule__) {
    const cwd = () => (os.getcwd ? os.getcwd() : '/');
    const home = () => os.environ.get('HOME') || '/';
    Object.assign(P, { __adderModule__: true, __name__: 'posixpath' });
    adderModules.posixpath = P;   // os.path IS posixpath (jinja2 imports it by that name)
    const add = (k, v) => { if (!P[k]) P[k] = v; };
    add('pathsep', ':'); add('curdir', '.'); add('pardir', '..'); add('extsep', '.'); add('altsep', null); add('devnull', '/dev/null');
    add('abspath', (p) => P.normpath(P.isabs(p) ? p : P.join(cwd(), p)));
    add('realpath', (p, ...a) => P.abspath(p));
    add('expanduser', (p) => (p === '~' ? home() : String(p).startsWith('~/') ? home() + String(p).slice(1) : p));
    add('expandvars', (p) => String(p).replace(/\$(\w+)|\$\{(\w+)\}/g, (m, a, b) => (os.environ.has(a || b) ? os.environ.get(a || b) : m)));
    add('split', (p) => { const i = String(p).lastIndexOf('/') + 1; let head = String(p).slice(0, i); const tail = String(p).slice(i); if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, ''); return mkTuple([head, tail]); });
    add('splitdrive', (p) => mkTuple(['', p]));
    add('normcase', (p) => p);
    add('islink', () => false); add('ismount', (p) => p === '/');
    add('lexists', P.exists);
    add('commonprefix', (ps) => { const a = [...pyIter(ps)]; if (!a.length) return ''; let s = a[0]; for (const x of a) while (!String(x).startsWith(s)) s = s.slice(0, -1); return s; });
    add('commonpath', (ps) => { const parts = [...pyIter(ps)].map((x) => String(x).split('/')); if (!parts.length) throw new AdderError('ValueError', 'commonpath() arg is an empty sequence'); const out = []; for (let i = 0; parts.every((q) => i < q.length && q[i] === parts[0][i]); i++) out.push(parts[0][i]); return out.join('/') || (parts[0][0] === '' ? '/' : ''); });
    add('samefile', (a, b) => P.abspath(a) === P.abspath(b));
  }
  // one process, one user: fixed ids (libraries key caches and temp names on them)
  const fixed = { getpid: 1, getppid: 0, getuid: 1000, geteuid: 1000, getgid: 1000, getegid: 1000, getpgrp: 1 };
  for (const [k, v] of Object.entries(fixed)) if (!os[k]) os[k] = () => v;
  if (!os.cpu_count) os.cpu_count = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1;
  if (!os.process_cpu_count) os.process_cpu_count = os.cpu_count;
  if (!os.urandom) os.urandom = (n) => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; };
  if (!os.getlogin) os.getlogin = () => 'user';
  if (!os.umask) os.umask = () => 0o022;
  if (!os.get_terminal_size) os.get_terminal_size = () => Object.assign(mkTuple([80, 24]), { columns: 80, lines: 24 });
  if (!os.isatty) os.isatty = () => false;
  if (!os.supports_fd) os.supports_fd = new PySet();
  if (!os.supports_follow_symlinks) os.supports_follow_symlinks = new PySet();
  if (!os.supports_dir_fd) os.supports_dir_fd = new PySet();
  return os;
}
setOsExtrasHook(_syOsExtras);

// ── itertools: the rest of the module ──
{
  const it = adderModules.itertools;
  // an iterator object, sync or async (a predicate written in Python may return a Promise)
  const lazy = (name, gen) => _lazyIter(name, gen);
  const each = (x) => _pyEach(x);
  it.filterfalse = (pred, src) => lazy('filterfalse', async function* () { for await (const v of each(src)) { const r = pred === null ? v : await pred(v); if (!_syTruthy(r)) yield v; } });
  it.takewhile = (pred, src) => lazy('takewhile', async function* () { for await (const v of each(src)) { if (!_syTruthy(await pred(v))) return; yield v; } });
  it.dropwhile = (pred, src) => lazy('dropwhile', async function* () { let dropping = true; for await (const v of each(src)) { if (dropping && _syTruthy(await pred(v))) continue; dropping = false; yield v; } });
  it.compress = (data, sel) => lazy('compress', async function* () { const s = [...pyIter(sel)]; let i = 0; for await (const v of each(data)) { if (i >= s.length) return; if (_syTruthy(s[i++])) yield v; } });
  it.batched = (src, n, ...a) => {
    if (!(n >= 1)) throw new AdderError('ValueError', 'n must be at least one');
    return lazy('batched', async function* () { let b = []; for await (const v of each(src)) { b.push(v); if (b.length === n) { yield mkTuple(b); b = []; } } if (b.length) yield mkTuple(b); });
  };
  it.combinations_with_replacement = (src, r) => lazy('combinations_with_replacement', async function* () {
    const pool = [...pyIter(src)]; const n = pool.length;
    if (!n && r) return;
    const idx = new Array(r).fill(0);
    yield mkTuple(idx.map((i) => pool[i]));
    for (;;) {
      let i = r - 1;
      while (i >= 0 && idx[i] === n - 1) i--;
      if (i < 0) return;
      const v = idx[i] + 1;
      for (let j = i; j < r; j++) idx[j] = v;
      yield mkTuple(idx.map((k) => pool[k]));
    }
  });
  // tee(it, n=2): n independent iterators over one source, sharing a buffer of what's been read
  it.tee = (src, n = 2) => {
    const source = each(src);
    const iter = source[Symbol.asyncIterator] ? source[Symbol.asyncIterator]() : source[Symbol.iterator] ? source[Symbol.iterator]() : source;
    const buf = [];
    let done = false, base = 0;
    const pos = new Array(n).fill(0);
    const make = (k) => lazy('_tee', async function* () {
      for (;;) {
        if (pos[k] - base >= buf.length) {
          if (done) return;
          const r = await iter.next();
          if (r.done) { done = true; return; }
          buf.push(r.value);
        }
        const v = buf[pos[k] - base];
        pos[k]++;
        const min = Math.min(...pos);
        while (base < min) { buf.shift(); base++; }
        yield v;
      }
    });
    return mkTuple(Array.from({ length: n }, (_, k) => make(k)));
  };
}
const _syTruthy = (v) => pyBool(v);

// ── functools: cached_property, total_ordering, singledispatch, partialmethod, update_wrapper ──
{
  const ft = adderModules.functools;
  const WRAPPER_ASSIGNMENTS = mkTuple(['__module__', '__name__', '__qualname__', '__doc__', '__dict__']);
  const WRAPPER_UPDATES = mkTuple(['__dict__']);
  ft.WRAPPER_ASSIGNMENTS = WRAPPER_ASSIGNMENTS; ft.WRAPPER_UPDATES = WRAPPER_UPDATES;
  ft.update_wrapper = (wrapper, wrapped, ...a) => {
    for (const k of ['__module__', '__doc__', '__qualname__']) if (wrapped && wrapped[k] !== undefined) { try { wrapper[k] = wrapped[k]; } catch {} }
    if (wrapped) { wrapper._pyName = wrapped._pyName || wrapped.__name__; wrapper.__name__ = wrapper._pyName; wrapper.__wrapped__ = wrapped; if (wrapped._pySig) wrapper._pySig = wrapped._pySig; }
    return wrapper;
  };
  // @cached_property: computed on first read, then stored on the instance (it shadows the descriptor)
  ft.cached_property = Object.assign((fn) => {
    const d = {
      _pyDescriptor: true, __adderClass__: 'functools.cached_property', func: fn, attrname: null, __doc__: fn && fn.__doc__,
      __set_name__(owner, name) { if (this.attrname === null) this.attrname = name; else if (this.attrname !== name) throw new AdderError('TypeError', `Cannot assign the same cached_property to two different names ('${this.attrname}' and '${name}').`); return null; },
      __get__(obj) {
        if (obj === null || obj === undefined) return d;
        const name = d.attrname;
        const store = (v) => { Object.defineProperty(obj, name, { value: v, writable: true, enumerable: true, configurable: true }); return v; };
        const v = fn(obj);
        return _syIsThen(v) ? v.then(store) : store(v);
      },
    };
    return d;
  }, { _pyName: 'cached_property', __name__: 'cached_property', _pyClass: true });
  // @total_ordering: from __eq__ and one of __lt__ / __le__ / __gt__ / __ge__, the other three
  const call = (o, m, x) => adderGetAttr(o, m)(x);
  const not = (r) => (_syIsThen(r) ? r.then((v) => (v === NotImplemented ? v : !_syTruthy(v))) : !_syTruthy(r));
  const and = (a, b) => (_syIsThen(a) ? a.then((x) => (_syTruthy(x) ? b() : x)) : _syTruthy(a) ? b() : a);
  const or = (a, b) => (_syIsThen(a) ? a.then((x) => (_syTruthy(x) ? x : b())) : _syTruthy(a) ? a : b());
  ft.total_ordering = (cls) => {
    const own = (m) => cls.prototype && typeof cls.prototype[m] === 'function' && (cls._pyOwnMembers?.has(m) || (cls._pyMRO || []).slice(1).some((c) => c._pyOwnMembers?.has(m)));
    const root = ['__lt__', '__le__', '__gt__', '__ge__'].find(own);
    if (!root) throw new AdderError('ValueError', 'must define at least one ordering operation: < > <= >=');
    const derive = {
      __lt__: { __gt__: (s, o) => and(not(call(s, '__lt__', o)), () => not(call(s, '__eq__', o))), __le__: (s, o) => or(call(s, '__lt__', o), () => call(s, '__eq__', o)), __ge__: (s, o) => not(call(s, '__lt__', o)) },
      __le__: { __ge__: (s, o) => or(not(call(s, '__le__', o)), () => call(s, '__eq__', o)), __lt__: (s, o) => and(call(s, '__le__', o), () => not(call(s, '__eq__', o))), __gt__: (s, o) => not(call(s, '__le__', o)) },
      __gt__: { __lt__: (s, o) => and(not(call(s, '__gt__', o)), () => not(call(s, '__eq__', o))), __ge__: (s, o) => or(call(s, '__gt__', o), () => call(s, '__eq__', o)), __le__: (s, o) => not(call(s, '__gt__', o)) },
      __ge__: { __le__: (s, o) => or(not(call(s, '__ge__', o)), () => call(s, '__eq__', o)), __gt__: (s, o) => and(call(s, '__ge__', o), () => not(call(s, '__eq__', o))), __lt__: (s, o) => not(call(s, '__ge__', o)) },
    }[root];
    for (const [m, f] of Object.entries(derive)) {
      if (own(m)) continue;
      cls.prototype[m] = function (o) { return f(this, o); };
      cls[m] = (s, o) => f(s, o);
      cls._pyOwnMembers.add(m);
    }
    return cls;
  };
  // @singledispatch: dispatch on the first argument's type (its MRO, then builtin names)
  const dispatchOn = (registry, dflt) => (x) => {
    const t = typeOf(x);
    for (const c of (t && t._pyMRO) || [t]) if (registry.has(c)) return registry.get(c);
    const name = pyTypeName(x);
    for (const [k, f] of registry) if (k && k._pyName === name) return f;
    if (typeof x === 'boolean') for (const [k, f] of registry) if (k && k._pyName === 'int') return f;
    if (typeof x === 'number' || typeof x === 'boolean') for (const [k, f] of registry) if (k && (k._pyName === 'Number' || k._pyName === 'Real' || (k._pyName === 'Integral' && isIntNum(x)))) return f;
    return dflt;
  };
  const registerOn = (registry) => (cls, func) => {
    if (typeof cls === 'function' && !cls._pyClass && func === undefined) throw new AdderError('TypeError', 'register(func) with an annotation is not supported here: use register(cls)');
    if (func === undefined || func === null) return (f) => { registry.set(cls, f); return f; };
    registry.set(cls, func);
    return func;
  };
  ft.singledispatch = (func) => {
    const registry = new Map([[pyObjectObj, func]]);
    const find = dispatchOn(registry, func);
    const w = (...a) => { if (!a.length) throw new AdderError('TypeError', `${func._pyName || 'singledispatch function'} requires at least 1 positional argument`); return find(a[0])(...a); };
    ft.update_wrapper(w, func);
    w.register = registerOn(registry); w.dispatch = (cls) => { for (const c of cls._pyMRO || [cls]) if (registry.has(c)) return registry.get(c); return func; };
    w.registry = registry; w._pyFunc = true;
    return w;
  };
  ft.singledispatchmethod = (func) => {
    const registry = new Map([[pyObjectObj, func]]);
    const find = dispatchOn(registry, func);
    const d = {
      _pyDescriptor: true, __adderClass__: 'functools.singledispatchmethod', func,
      register: registerOn(registry),
      __get__(obj, cls) { const f = (...a) => find(a[0])(obj, ...a); f._pyName = func._pyName; return f; },
    };
    return d;
  };
  // partialmethod(func, *args, **kw): a method with leading arguments filled in
  ft.partialmethod = (func, ...a) => {
    const kw = _syKw(a);
    return {
      _pyDescriptor: true, __adderClass__: 'functools.partialmethod', func, args: mkTuple(a),
      __get__(obj) { const f = (...b) => { const k = _syKw(b); const all = kw || k ? { _kw: true, ...(kw || {}), ...(k || {}) } : null; return all ? func(obj, ...a, ...b, all) : func(obj, ...a, ...b); }; f._pyName = func._pyName; return f; },
    };
  };
}

// ── contextlib: the abstract bases, asynccontextmanager, ContextDecorator, chdir, aclosing ──
{
  const cl = adderModules.contextlib;
  // contextlib._GeneratorContextManager: a real class (test code subclasses it), as CPython's —
  // __init__(func, args, kwds) makes the generator, __enter__ / __exit__ drive it, and calling the
  // object decorates a function: each call runs inside a fresh manager (_recreate_cm)
  const isThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
  const stepGen = (gen) => { const r = gen.next(); return isThen(r) ? r : r; };
  const splitKw = (a) => (a.length && a[a.length - 1] && a[a.length - 1]._kw === true ? [a.slice(0, -1), a[a.length - 1]] : [a, null]);
  const GCM = _syClass('_GeneratorContextManager', [], {
    __init__(self, func, args, kwds) {
      const pos = args ? [...pyIter(args)] : [];
      const kw = kwds && (kwds instanceof Map ? kwds.size : Object.keys(kwds).length) ? Object.assign({ _kw: true }, kwds instanceof Map ? Object.fromEntries(kwds) : kwds) : null;
      const gen = kw ? func(...pos, kw) : func(...pos);
      const set = (g) => { self.gen = g; self.func = func; self.args = mkTuple(pos); self.kwds = kwds || new PyDict(); self.__doc__ = func && func.__doc__ !== undefined ? func.__doc__ : null; return null; };
      return isThen(gen) ? gen.then(set) : set(gen);
    },
    _recreate_cm(self) { return typeOf(self)(self.func, self.args, self.kwds); },
    __enter__(self) {
      const done = (r) => { if (r.done) throw new AdderError('RuntimeError', "generator didn't yield"); return r.value; };
      const r = stepGen(self.gen);
      return isThen(r) ? r.then(done) : done(r);
    },
    __exit__(self, typ, value) {
      if (typ === null || typ === undefined) {
        const fin = (r) => { if (!r.done) throw new AdderError('RuntimeError', "generator didn't stop"); return false; };
        const r = stepGen(self.gen);
        return isThen(r) ? r.then(fin) : fin(r);
      }
      const fail = (e) => {
        if (excValue(e) === value) return false;   // re-raised: the with statement raises the original
        if (e && e.pyType === 'StopIteration') return true;
        // a StopIteration thrown in comes back wrapped in RuntimeError (PEP 479): that is the
        // original propagating, not something to raise in its place (CPython's issue 29692)
        if (e && e.pyType === 'RuntimeError' && e.__cause__ !== undefined && e.__cause__ === value) return false;
        throw e;
      };
      const after = (r) => { if (!r.done) throw new AdderError('RuntimeError', "generator didn't stop after throw()"); return true; };
      let r;
      try { r = self.gen._jsThrow ? self.gen._jsThrow(excToThrowable(value)) : self.gen.throw(excToThrowable(value)); } catch (e) { return fail(e); }
      return isThen(r) ? r.then(after, fail) : after(r);
    },
    __call__(self, func) {
      const inner = async (...a) => {
        const cm = await adderGetAttr(self, '_recreate_cm')();
        await adderGetAttr(cm, '__enter__')();
        let res;
        try { res = await func(...a); } catch (e) {
          if (!(await adderGetAttr(cm, '__exit__')(excTypeOf(e), excValue(e), null))) throw e;
          return null;
        }
        await adderGetAttr(cm, '__exit__')(null, null, null);
        return res;
      };
      inner._pyName = func && func._pyName; inner.__name__ = func && (func.__name__ ?? func._pyName); inner.__wrapped__ = func;
      inner.__doc__ = func && func.__doc__ !== undefined ? func.__doc__ : null;
      return inner;
    },
  }, 'contextlib');
  cl._GeneratorContextManager = GCM;
  cl.contextmanager = (fn) => {
    const helper = (...a) => { const [pos, kw] = splitKw(a); return GCM(fn, mkTuple(pos), kw ? new PyDict(Object.entries(kw).filter(([k]) => k !== '_kw')) : new PyDict()); };
    helper._pyName = fn._pyName || fn.name; helper.__name__ = helper._pyName; helper.__wrapped__ = fn;
    helper.__doc__ = fn.__doc__ !== undefined ? fn.__doc__ : null; helper.__qualname__ = fn.__qualname__ ?? helper._pyName;
    return helper;
  };
  const hasAll = (o, names) => o !== null && o !== undefined && names.every((n) => { try { return typeof adderGetAttr(o, n) === 'function'; } catch { return false; } });
  const ACM = _syABCMeta('AbstractContextManager', mkTuple([]), new PyDict([['__enter__', (self) => self]]));
  ACM.__instancecheck__ = (o) => hasAll(o, ['__enter__', '__exit__']);
  const AACM = _syABCMeta('AbstractAsyncContextManager', mkTuple([]), new PyDict([['__aenter__', (self) => Promise.resolve(self)]]));
  AACM.__instancecheck__ = (o) => hasAll(o, ['__aenter__', '__aexit__']);
  cl.AbstractContextManager = ACM; cl.AbstractAsyncContextManager = AACM;
  // @asynccontextmanager: the generator-based context manager, entered with `async with`
  cl.asynccontextmanager = (fn) => {
    const sync = cl.contextmanager(fn);
    const w = (...a) => {
      const wrap = (cm) => ({ __adderClass__: '_AsyncGeneratorContextManager',
        __aenter__: () => Promise.resolve(cm.__enter__()), __aexit__: (...x) => Promise.resolve(cm.__exit__(...x)) });
      const r = sync(...a);
      return _syIsThen(r) ? r.then(wrap) : wrap(r);
    };
    w._pyName = fn._pyName; w.__wrapped__ = fn;
    return w;
  };
  cl.aclosing = (thing) => ({ __adderClass__: 'aclosing', __aenter__: () => Promise.resolve(thing), __aexit__: () => Promise.resolve(adderGetAttr(thing, 'aclose')()).then(() => false) });
  // ContextDecorator: a context manager usable as a decorator (__call__ wraps a function in `with self`)
  cl.ContextDecorator = _syClass('ContextDecorator', [], {
    _recreate_cm(self) { return self; },
    __call__(self, func) {
      const w = async (...a) => {
        const cm = adderGetAttr(self, '_recreate_cm')();
        await adderGetAttr(cm, '__enter__')();
        try { const r = await func(...a); await adderGetAttr(cm, '__exit__')(null, null, null); return r; }
        catch (e) { const sup = await adderGetAttr(cm, '__exit__')(excTypeOf(e), excValue(e), null); if (!_syTruthy(sup)) throw e; return null; }
      };
      w._pyName = func._pyName; w.__wrapped__ = func;
      return w;
    },
  }, 'contextlib');
  cl.AsyncContextDecorator = cl.ContextDecorator;
  cl.chdir = (path) => {
    let prev = null;
    return { __adderClass__: 'chdir', __enter__: () => { prev = adderModules.os.getcwd(); adderModules.os.chdir(path); return null; }, __exit__: () => { adderModules.os.chdir(prev); return false; } };
  };
  cl.AsyncExitStack = cl.ExitStack;
}

// io.BufferedReader(raw, buffer_size): a read-ahead buffer over a raw stream, as _pyio's — read,
// read1, peek, readline, readinto, seek / tell through it. Async: the raw stream's methods may be
// tree-walked Python (bz2.BZ2File's DecompressReader).
function _syBufferedReader(BufferedIOBase) {
  const call = async (obj, name, ...a) => adderGetAttr(obj, name)(...a);
  const EMPTY = new Uint8Array(0);
  const avail = (self) => self._rbuf.length - self._rpos;
  const bytesOf = (b) => (b === null || b === undefined ? null : b instanceof Uint8Array ? b : Uint8Array.from(b));
  const checkClosed = (self, what) => { if (self._closed) throw new AdderError('ValueError', `${what} of closed file`); };
  // at most n bytes, reading the raw stream as needed (n < 0: all of it)
  const readUnlocked = async (self, n) => {
    if (n < 0) {
      const parts = [self._rbuf.subarray(self._rpos)];
      self._rbuf = EMPTY; self._rpos = 0;
      let none = false;
      for (;;) {
        const chunk = bytesOf(await call(self.raw, 'read'));
        if (chunk === null) { none = true; break; }
        if (!chunk.length) break;
        parts.push(chunk);
      }
      const out = _syConcat(parts);
      return none && !out.length ? null : out;
    }
    if (n <= avail(self)) {
      const out = self._rbuf.slice(self._rpos, self._rpos + n);
      self._rpos += n;
      return out;
    }
    const parts = [self._rbuf.subarray(self._rpos)];
    let have = avail(self);
    const wanted = Math.max(self.buffer_size, n);
    let none = false;
    while (have < n) {
      const chunk = bytesOf(await call(self.raw, 'read', wanted));
      if (chunk === null) { none = true; break; }
      if (!chunk.length) break;
      parts.push(chunk);
      have += chunk.length;
    }
    const all = _syConcat(parts);
    const out = all.slice(0, Math.min(n, all.length));
    self._rbuf = all.subarray(out.length); self._rpos = 0;
    return none && !out.length ? null : out;
  };
  // fill the buffer to want bytes (one raw read at most); its contents
  const peekUnlocked = async (self, n = 0) => {
    const want = Math.min(n, self.buffer_size);
    const have = avail(self);
    if (have < want || have <= 0) {
      const current = bytesOf(await call(self.raw, 'read', self.buffer_size - have));
      if (current && current.length) {
        self._rbuf = _syConcat([self._rbuf.subarray(self._rpos), current]);
        self._rpos = 0;
      }
    }
    return self._rbuf.slice(self._rpos);
  };
  const sizeArg = (a, name = 'size') => { const v = _syArgs(a, [name], { [name]: -1 })[name]; return v === null || v === undefined ? -1 : Number(v); };
  return _syClass('BufferedReader', [BufferedIOBase], {
    __init__(self, raw, ...a) {
      const { buffer_size } = _syArgs(a, ['buffer_size'], { buffer_size: 8192 });
      if (Number(buffer_size) <= 0) throw new AdderError('ValueError', 'invalid buffer size');
      self.raw = raw; self.buffer_size = Number(buffer_size);
      self._rbuf = EMPTY; self._rpos = 0; self._closed = false;
      return null;
    },
    closed: { __property__: true, fget: (self) => self._closed || !!(self.raw && self.raw.closed), fset: null, __doc__: null },
    name: { __property__: true, fget: (self) => adderGetAttr(self.raw, 'name'), fset: null, __doc__: null },
    mode: { __property__: true, fget: (self) => adderGetAttr(self.raw, 'mode'), fset: null, __doc__: null },
    async read(self, ...a) {
      const n = sizeArg(a);
      if (n < -1) throw new AdderError('ValueError', 'read length must be non-negative or -1');
      checkClosed(self, 'read');
      return readUnlocked(self, n);
    },
    async read1(self, ...a) {
      let n = sizeArg(a);
      checkClosed(self, 'read');
      if (n < 0) n = self.buffer_size;
      if (n === 0) return EMPTY;
      await peekUnlocked(self, 1);
      return readUnlocked(self, Math.min(n, avail(self)));
    },
    async peek(self, size = 0) { checkClosed(self, 'peek'); return peekUnlocked(self, Number(size)); },
    async readinto(self, b) {
      const data = await adderGetAttr(self, 'read')(b.length ?? b.byteLength);
      const d = data || EMPTY;
      for (let i = 0; i < d.length; i++) b[i] = d[i];
      return d.length;
    },
    async readinto1(self, b) {
      const data = await adderGetAttr(self, 'read1')(b.length ?? b.byteLength);
      for (let i = 0; i < data.length; i++) b[i] = data[i];
      return data.length;
    },
    // IOBase.readline, over peek: one line, its newline kept; at most size bytes
    async readline(self, ...a) {
      const size = sizeArg(a);
      checkClosed(self, 'readline');
      const parts = [];
      let len = 0;
      while (size < 0 || len < size) {
        const ahead = await peekUnlocked(self, 1);
        let n = ahead.length ? (ahead.indexOf(10) + 1 || ahead.length) : 1;
        if (size >= 0) n = Math.min(n, size - len);
        const b = await readUnlocked(self, n);
        if (!b || !b.length) break;
        parts.push(b); len += b.length;
        if (b[b.length - 1] === 10) break;
      }
      return _syConcat(parts);
    },
    async readlines(self, hint = -1) {
      const out = [];
      let total = 0;
      for (;;) {
        const l = await adderGetAttr(self, 'readline')();
        if (!l.length) return out;
        out.push(l); total += l.length;
        if (hint !== null && hint > 0 && total >= hint) return out;
      }
    },
    async seek(self, pos, whence = 0) {
      if (![0, 1, 2].includes(Number(whence))) throw new AdderError('ValueError', 'invalid whence value');
      checkClosed(self, 'seek');
      let p = Number(pos);
      if (Number(whence) === 1) p -= avail(self);
      const r = await call(self.raw, 'seek', p, whence);
      if (r < 0) throw new AdderError('OSError', 'seek() returned an invalid position');
      self._rbuf = EMPTY; self._rpos = 0;
      return r;
    },
    async tell(self) {
      const p = (await call(self.raw, 'tell')) - avail(self);
      return p < 0 ? 0 : p;
    },
    async close(self) {
      if (self.raw && !self._closed) {
        self._closed = true;
        await call(self.raw, 'close');
      }
      return null;
    },
    detach(self) { const r = self.raw; self.raw = null; return r; },
    readable(self) { return adderGetAttr(self.raw, 'readable')(); },
    seekable(self) { return adderGetAttr(self.raw, 'seekable')(); },
    writable() { return false; },
    fileno(self) { return adderGetAttr(self.raw, 'fileno')(); },
    isatty(self) { return adderGetAttr(self.raw, 'isatty')(); },
    __iter__(self) { return self; },
    async __next__(self) {
      const l = await adderGetAttr(self, 'readline')();
      if (!l.length) throw new AdderError('StopIteration', '');
      return l;
    },
  }, 'io');
}
function _syConcat(parts) {
  if (parts.length === 1) return parts[0].slice();
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ── io: the class hierarchy (isinstance checks and subclassing), open, text_encoding ──
{
  const io = adderModules.io;
  const IOBase = _syClass('IOBase', [], {
    __enter__(self) { return self; }, __exit__(self) { const c = adderGetAttr(self, 'close'); const r = c(); return _syIsThen(r) ? r.then(() => false) : false; },
    close(self) { self.closed = true; return null; }, flush() { return null; },
    readable() { return false; }, writable() { return false; }, seekable() { return false; }, isatty() { return false; },
    fileno() { throw new AdderError('UnsupportedOperation', 'fileno'); },
    readline(self) { throw new AdderError('UnsupportedOperation', 'readline'); },
    // (sync while readline is; a readline that returns a promise — over an async buffer — waits)
    readlines(self, hint = -1) {
      const out = [];
      let total = 0;
      const rl = adderGetAttr(self, 'readline');
      const step = (l) => {
        for (;;) {
          if (_syIsThen(l)) return l.then(step);
          if (!l || !l.length) return out;
          out.push(l); total += l.length;
          if (hint !== null && hint > 0 && total >= hint) return out;
          l = rl();
        }
      };
      return step(rl());
    },
    writelines(self, lines) { for (const l of pyIter(lines)) adderGetAttr(self, 'write')(l); return null; },
  }, 'io');
  const RawIOBase = _syClass('RawIOBase', [IOBase], {}, 'io');
  const BufferedIOBase = _syClass('BufferedIOBase', [IOBase], {}, 'io');
  const TextIOBase = _syClass('TextIOBase', [IOBase], { encoding: 'utf-8' }, 'io');
  // TextIOWrapper(buffer, encoding): text over a binary stream with read() / write()
  const TextIOWrapper = _syClass('TextIOWrapper', [TextIOBase], {
    __init__(self, buffer, ...a) {
      const { encoding, errors, newline } = _syArgs(a, ['encoding', 'errors', 'newline', 'line_buffering', 'write_through'], { encoding: 'utf-8', errors: 'strict', newline: null });
      self.buffer = buffer; self.encoding = encoding || 'utf-8'; self.errors = errors || 'strict'; self.closed = false; self._pending = '';
      return null;
    },
    read(self, n = -1) { const b = adderGetAttr(self.buffer, 'read')(); const t = (x) => pyDecodePartial(x instanceof Uint8Array ? x : new Uint8Array(0), self.encoding, self.errors, true).text; const all = _syIsThen(b) ? b.then(t) : t(b); return all; },
    readline(self) {
      const fill = (txt) => { self._pending += txt; const i = self._pending.indexOf('\n'); if (i < 0) { const r = self._pending; self._pending = ''; return r; } const r = self._pending.slice(0, i + 1); self._pending = self._pending.slice(i + 1); return r; };
      if (self._pending.includes('\n')) return fill('');
      const t = adderGetAttr(self, 'read')(); return _syIsThen(t) ? t.then(fill) : fill(t);
    },
    write(self, s) { const r = adderGetAttr(self.buffer, 'write')(pyEncode(s, self.encoding, self.errors)); return _syIsThen(r) ? r.then(() => String(s).length) : String(s).length; },
    readable(self) { return true; }, writable(self) { return true; },
    detach(self) { const b = self.buffer; self.buffer = null; return b; },
    flush(self) { const f = self.buffer && adderGetAttr(self.buffer, 'flush'); return f ? f() : null; },
    // flush, then close the stream under it (a BZ2File writes its last block on close)
    close(self) {
      if (self.closed || !self.buffer) { self.closed = true; return null; }
      self.closed = true;
      const after = () => adderGetAttr(self.buffer, 'close')();
      const f = adderGetAttr(self, 'flush')();
      return _syIsThen(f) ? f.then(after) : after();
    },
  }, 'io');
  Object.assign(io, {
    IOBase, RawIOBase, BufferedIOBase, TextIOBase, TextIOWrapper,
    BufferedReader: _syBufferedReader(BufferedIOBase),
    BufferedWriter: _syClass('BufferedWriter', [BufferedIOBase], { __init__(self, raw) { self.raw = raw; return null; }, write(self, b) { return adderGetAttr(self.raw, 'write')(b); }, writable() { return true; } }, 'io'),
    BufferedRandom: _syClass('BufferedRandom', [BufferedIOBase], {}, 'io'),
    BufferedRWPair: _syClass('BufferedRWPair', [BufferedIOBase], {}, 'io'),
    FileIO: _syClass('FileIO', [RawIOBase], {}, 'io'),
    text_encoding: (enc, stacklevel = 2) => enc ?? 'utf-8',
    IncrementalNewlineDecoder: _syClass('IncrementalNewlineDecoder', [], { __init__(self, decoder, translate) { self.decoder = decoder; self.translate = translate; return null; }, decode(self, input, final = false) { const t = self.decoder ? self.decoder.decode(input, final) : String(input); return self.translate ? t.replace(/\r\n?/g, '\n') : t; } }, 'io'),
  });
}

// ── _collections: the C half of CPython's collections — deque, defaultdict, OrderedDict and the
// _count_elements helper, adder's JS ones (builtins.js) ──
{
  const c = _collectionsModule;
  adderModules._collections = _syModule('_collections', {
    deque: c.deque, defaultdict: c.defaultdict, OrderedDict: c.OrderedDict, _count_elements: c._count_elements,
  });
}

// ── importlib: specs, loaders, machinery ──
{
  const il = adderModules.importlib;
  const ModuleSpec = _syClass('ModuleSpec', [], {
    __init__(self, name, loader, ...a) {
      const { origin, loader_state, is_package } = _syArgs(a, ['origin', 'loader_state', 'is_package'], { origin: null, loader_state: null, is_package: null });
      Object.assign(self, { name, loader, origin, loader_state, submodule_search_locations: is_package ? [] : null, cached: null, has_location: !!origin });
      self.parent = is_package ? name : String(name).includes('.') ? String(name).slice(0, String(name).lastIndexOf('.')) : '';
      return null;
    },
    __repr__(self) { return `ModuleSpec(name=${pyRepr(self.name)}, loader=${pyRepr(self.loader)}, origin=${pyRepr(self.origin)})`; },
  }, 'importlib.machinery');
  const Loader = _syClass('Loader', [], {
    create_module(self, spec) { return null; },
    exec_module(self, module) { throw new AdderError('ImportError', 'exec_module() not implemented'); },
    load_module(self, fullname) { throw new AdderError('ImportError', 'load_module() not implemented'); },
  }, 'importlib.abc');
  const Finder = _syClass('MetaPathFinder', [], { find_spec() { return null; }, invalidate_caches() { return null; } }, 'importlib.abc');
  const SourceFileLoader = _syClass('SourceFileLoader', [Loader], {
    __init__(self, fullname, path) { self.name = fullname; self.path = path; return null; },
    get_filename(self) { return self.path; },
  }, 'importlib.machinery');
  Object.assign(il.util, {
    spec_from_loader: (name, loader, ...a) => { const { origin, is_package } = _syArgs(a, ['origin', 'is_package'], { origin: null, is_package: null }); return ModuleSpec(name, loader, { _kw: true, origin, is_package }); },
    spec_from_file_location: (name, location = null, ...a) => ModuleSpec(name, SourceFileLoader(name, location), { _kw: true, origin: location }),
    // module_from_spec: a fresh module object for the spec (its loader may build one itself)
    module_from_spec: (spec) => {
      const made = spec.loader && typeof adderGetAttr(spec.loader, 'create_module') === 'function' ? adderGetAttr(spec.loader, 'create_module')(spec) : null;
      const finish = (m) => { m = m || { __adderModule__: true }; Object.assign(m, { __name__: spec.name, __spec__: spec, __loader__: spec.loader, __package__: spec.parent, __file__: spec.origin }); return m; };
      return _syIsThen(made) ? made.then(finish) : finish(made);
    },
    LazyLoader: _syClass('LazyLoader', [Loader], { __init__(self, loader) { self.loader = loader; return null; } }, 'importlib.util'),
    MAGIC_NUMBER: new Uint8Array([0xcb, 0x0d, 0x0d, 0x0a]),
    cache_from_source: (p) => String(p) + 'c', source_from_cache: (p) => String(p).replace(/c$/, ''),
  });
  il.machinery = _syModule('importlib.machinery', {
    ModuleSpec, SourceFileLoader, SourcelessFileLoader: SourceFileLoader, ExtensionFileLoader: SourceFileLoader,
    FileFinder: Finder, PathFinder: Finder, BuiltinImporter: Finder, FrozenImporter: Finder,
    SOURCE_SUFFIXES: ['.py'], BYTECODE_SUFFIXES: ['.pyc'], EXTENSION_SUFFIXES: [], all_suffixes: () => ['.py'],
  });
  il.abc = _syModule('importlib.abc', { Loader, MetaPathFinder: Finder, PathEntryFinder: Finder, Finder, ResourceReader: _syClass('ResourceReader', [], {}, 'importlib.abc'), Traversable: _syClass('Traversable', [], {}, 'importlib.abc'), InspectLoader: Loader, ExecutionLoader: Loader, FileLoader: SourceFileLoader, SourceLoader: SourceFileLoader });
  adderModules['importlib.machinery'] = il.machinery;
  adderModules['importlib.abc'] = il.abc;
  adderModules['importlib.util'] = il.util;
  adderModules['importlib.resources'] = il.resources;
  adderModules['importlib.metadata'] = il.metadata;
}

// ── sysconfig, marshal ──
adderModules.sysconfig = _syModule('sysconfig', {
  get_config_var: (n) => ({ EXT_SUFFIX: '.so', SOABI: null, Py_GIL_DISABLED: 0, Py_DEBUG: 0, SIZEOF_VOID_P: 8, py_version_nodot: '312', VERSION: '3.12', prefix: '/usr', exec_prefix: '/usr', LIBDIR: '/usr/lib' })[n] ?? null,
  get_config_vars: (...n) => (n.length ? n.map((k) => adderModules.sysconfig.get_config_var(k)) : new PyDict([['VERSION', '3.12'], ['EXT_SUFFIX', '.so']])),
  get_platform: () => 'auditable', get_python_version: () => '3.12', get_default_scheme: () => 'posix_prefix', get_scheme_names: () => mkTuple(['posix_prefix']),
  get_path: (n) => ({ stdlib: '/usr/lib/python', purelib: '/lib', platlib: '/lib', scripts: '/usr/bin', data: '/usr' })[n] ?? null,
  get_paths: () => new PyDict([['stdlib', '/usr/lib/python'], ['purelib', '/lib'], ['platlib', '/lib'], ['scripts', '/usr/bin'], ['data', '/usr']]),
  is_python_build: () => false,
});
// marshal: there's no bytecode here to serialise — the module exists (jinja2's bytecode cache
// imports it); using it raises
adderModules.marshal = _syModule('marshal', {
  version: 4,
  dumps: () => { throw new AdderError('ValueError', 'marshal is not supported (no bytecode here)'); },
  loads: () => { throw new AdderError('ValueError', 'marshal is not supported (no bytecode here)'); },
  dump: () => { throw new AdderError('ValueError', 'marshal is not supported (no bytecode here)'); },
  load: () => { throw new AdderError('ValueError', 'marshal is not supported (no bytecode here)'); },
});

// ── ast: literal_eval (a safe evaluator for Python literals over adder's own parser) ──
{
  // the literal forms ast.literal_eval accepts — strings, bytes, numbers, tuples, lists, dicts,
  // sets, booleans, None, and unary +/- on numbers / a complex sum — evaluated from the parse tree
  const parseExpr = _adderParseExpr;
  const bad = () => new AdderError('ValueError', 'malformed node or string');
  const lit = (n) => {
    switch (n && n.type) {
      case 'Constant': return n.value;
      case 'Bytes': { const b = new Uint8Array(n.value.length); for (let i = 0; i < n.value.length; i++) b[i] = n.value.charCodeAt(i); return b; }
      case 'Name': if (n.id === 'True') return true; if (n.id === 'False') return false; if (n.id === 'None') return null; if (n.id === 'Ellipsis') throw bad(); throw bad();
      case 'Tuple': return mkTuple(n.elts.map(lit));
      case 'List': return n.elts.map(lit);
      case 'Set': return new PySet(n.elts.map(lit));
      case 'Dict': { const d = new PyDict(); n.keys.forEach((k, i) => { if (k === null) throw bad(); d.set(lit(k), lit(n.values[i])); }); return d; }
      case 'UnaryOp': { const v = lit(n.operand); if (typeof v !== 'number') throw bad(); if (n.op === '-' || n.op === 'USub') return -v; if (n.op === '+' || n.op === 'UAdd') return v; throw bad(); }
      case 'Call': if (n.func && n.func.type === 'Name' && n.func.id === 'set' && !n.args.length) return new PySet(); throw bad();
      default: throw bad();
    }
  };
  adderModules.ast = _syModule('ast', {
    literal_eval: (node) => {
      if (typeof node === 'string') {
        let tree;
        try { tree = parseExpr(node.trim()); } catch (e) { throw new AdderError('SyntaxError', String(e && e.message || e)); }
        return lit(tree);
      }
      return lit(node);
    },
    parse: () => { throw new AdderError('NotImplementedError', 'ast.parse: adder does not expose CPython AST nodes'); },
    PyCF_ONLY_AST: 1024, PyCF_TYPE_COMMENTS: 4096,
  });
}

// ── configparser ──
{
  const Error_ = makeExcType('configparser.Error', 'Exception');
  for (const n of ['NoSectionError', 'NoOptionError', 'DuplicateSectionError', 'ParsingError', 'InterpolationError']) makeExcType(n, 'configparser.Error');
  makeExcType('MissingSectionHeaderError', 'ParsingError');
  const BOOL = { '1': true, yes: true, true: true, on: true, '0': false, no: false, false: false, off: false };
  const interp = (self, sec, val, depth = 0) => {
    if (self._interp === false || typeof val !== 'string' || depth > 10) return val;
    return val.replace(/%\((\w+)\)s|%%/g, (m, k) => (m === '%%' ? '%' : interp(self, sec, self._get(sec, k.toLowerCase()), depth + 1)));
  };
  const ConfigParser = _syClass('ConfigParser', [], {
    __init__(self, ...a) {
      const { defaults, interpolation } = _syArgs(a, ['defaults', 'dict_type', 'allow_no_value'], { defaults: null });
      const kw = a.length && a[a.length - 1] && a[a.length - 1]._kw ? a[a.length - 1] : {};
      self._sections = new Map(); self._defaults = new Map();
      self._interp = kw.interpolation === null ? false : true;
      if (defaults) for (const [k, v] of (defaults instanceof Map ? defaults : Object.entries(defaults))) self._defaults.set(String(k).toLowerCase(), v);
      return null;
    },
    _get(self, sec, opt) { const s = self._sections.get(sec); if (s && s.has(opt)) return s.get(opt); if (self._defaults.has(opt)) return self._defaults.get(opt); throw new AdderError('NoOptionError', `No option ${pyRepr(opt)} in section: ${pyRepr(sec)}`); },
    read_string(self, text, source = '<string>') {
      let sec = null, last = null;
      for (const raw of String(text).split(/\r?\n/)) {
        if (/^\s*([#;].*)?$/.test(raw)) continue;
        if (/^\s/.test(raw) && last) { const s = sec === 'DEFAULT' ? self._defaults : self._sections.get(sec); s.set(last, s.get(last) + '\n' + raw.trim()); continue; }
        const h = /^\[([^\]]+)\]\s*$/.exec(raw);
        if (h) { sec = h[1]; if (sec !== 'DEFAULT' && !self._sections.has(sec)) self._sections.set(sec, new Map()); last = null; continue; }
        if (sec === null) throw new AdderError('MissingSectionHeaderError', `File contains no section headers.\nfile: ${pyRepr(source)}, line: 1\n${pyRepr(raw)}`);
        const m = /^\s*([^=:]+?)\s*[=:]\s*(.*)$/.exec(raw);
        if (!m) continue;
        const key = m[1].toLowerCase();
        (sec === 'DEFAULT' ? self._defaults : self._sections.get(sec)).set(key, m[2].trim());
        last = key;
      }
      return null;
    },
    read(self, filenames) { return [...(typeof filenames === 'string' ? [filenames] : pyIter(filenames))].filter(() => false); },
    read_dict(self, d) { for (const [s, opts] of (d instanceof Map ? d : Object.entries(d))) { if (!self._sections.has(s)) self._sections.set(s, new Map()); for (const [k, v] of (opts instanceof Map ? opts : Object.entries(opts))) self._sections.get(s).set(String(k).toLowerCase(), String(v)); } return null; },
    sections(self) { return [...self._sections.keys()]; },
    has_section(self, s) { return self._sections.has(s); },
    add_section(self, s) { if (self._sections.has(s)) throw new AdderError('DuplicateSectionError', `Section ${pyRepr(s)} already exists`); self._sections.set(s, new Map()); return null; },
    has_option(self, s, o) { const sec = self._sections.get(s); return !!(sec && sec.has(String(o).toLowerCase())) || self._defaults.has(String(o).toLowerCase()); },
    options(self, s) { const sec = self._sections.get(s); if (!sec) throw new AdderError('NoSectionError', `No section: ${pyRepr(s)}`); return [...new Set([...sec.keys(), ...self._defaults.keys()])]; },
    get(self, s, o, ...a) {
      const kw = _syKw(a) || {};
      const opt = String(o).toLowerCase();
      if (!self._sections.has(s) && s !== 'DEFAULT') { if (Object.hasOwn(kw, 'fallback')) return kw.fallback; throw new AdderError('NoSectionError', `No section: ${pyRepr(s)}`); }
      try { const v = self._get(s, opt); return kw.raw ? v : interp(self, s, v); } catch (e) { if (Object.hasOwn(kw, 'fallback')) return kw.fallback; throw e; }
    },
    getint(self, s, o, ...a) { const v = adderGetAttr(self, 'get')(s, o, ...a); return v === null || v === undefined || typeof v === 'number' ? v : parseInt(v, 10); },
    getfloat(self, s, o, ...a) { const v = adderGetAttr(self, 'get')(s, o, ...a); return v === null || v === undefined || typeof v === 'number' ? v : parseFloat(v); },
    getboolean(self, s, o, ...a) { const v = adderGetAttr(self, 'get')(s, o, ...a); if (typeof v === 'boolean' || v === null || v === undefined) return v; const b = BOOL[String(v).toLowerCase()]; if (b === undefined) throw new AdderError('ValueError', `Not a boolean: ${v}`); return b; },
    set(self, s, o, v = null) { const sec = s === 'DEFAULT' ? self._defaults : self._sections.get(s); if (!sec) throw new AdderError('NoSectionError', `No section: ${pyRepr(s)}`); sec.set(String(o).toLowerCase(), v); return null; },
    remove_option(self, s, o) { const sec = self._sections.get(s); return !!(sec && sec.delete(String(o).toLowerCase())); },
    remove_section(self, s) { return self._sections.delete(s); },
    items(self, s = undefined) {
      if (s === undefined) return [...self._sections.keys()].map((k) => mkTuple([k, k]));
      const sec = self._sections.get(s); if (!sec) throw new AdderError('NoSectionError', `No section: ${pyRepr(s)}`);
      return [...new Map([...self._defaults, ...sec])].map(([k]) => mkTuple([k, adderGetAttr(self, 'get')(s, k)]));
    },
    defaults(self) { return new PyDict(self._defaults); },
    __contains__(self, s) { return s === 'DEFAULT' || self._sections.has(s); },
    __getitem__(self, s) {
      if (s !== 'DEFAULT' && !self._sections.has(s)) throw new AdderError('KeyError', pyRepr(s));
      const cp = self;
      return { __adderClass__: 'SectionProxy', name: s,
        __getitem__: (k) => { try { return adderGetAttr(cp, 'get')(s, k); } catch { throw new AdderError('KeyError', pyRepr(k)); } },
        __setitem__: (k, v) => adderGetAttr(cp, 'set')(s, k, v), __contains__: (k) => adderGetAttr(cp, 'has_option')(s, k),
        get: (k, fb = null) => adderGetAttr(cp, 'get')(s, k, { _kw: true, fallback: fb }),
        getint: (k, fb = null) => adderGetAttr(cp, 'getint')(s, k, { _kw: true, fallback: fb }),
        getboolean: (k, fb = null) => adderGetAttr(cp, 'getboolean')(s, k, { _kw: true, fallback: fb }),
        keys: () => adderGetAttr(cp, 'options')(s), __iter__: () => adderGetAttr(cp, 'options')(s)[Symbol.iterator]() };
    },
    write(self, fp) {
      let out = '';
      if (self._defaults.size) { out += '[DEFAULT]\n'; for (const [k, v] of self._defaults) out += `${k} = ${v}\n`; out += '\n'; }
      for (const [s, sec] of self._sections) { out += `[${s}]\n`; for (const [k, v] of sec) out += v === null ? `${k}\n` : `${k} = ${String(v).replace(/\n/g, '\n\t')}\n`; out += '\n'; }
      return adderGetAttr(fp, 'write')(out);
    },
  }, 'configparser');
  adderModules.configparser = _syModule('configparser', {
    ConfigParser, RawConfigParser: ConfigParser, SafeConfigParser: ConfigParser,
    Error: Error_, NoSectionError: _typeObjects.NoSectionError, NoOptionError: _typeObjects.NoOptionError,
    DuplicateSectionError: _typeObjects.DuplicateSectionError, ParsingError: _typeObjects.ParsingError,
    MissingSectionHeaderError: _typeObjects.MissingSectionHeaderError, InterpolationError: _typeObjects.InterpolationError,
    BasicInterpolation: () => ({}), ExtendedInterpolation: () => ({}), Interpolation: () => ({}),
    DEFAULTSECT: 'DEFAULT', MAX_INTERPOLATION_DEPTH: 10,
  });
}

// ── email: errors, utils, message, parser — what HTTP and packaging metadata code uses ──
{
  const errNames = [['MessageError', 'Exception'], ['MessageParseError', 'MessageError'], ['HeaderParseError', 'MessageParseError'],
    ['BoundaryError', 'MessageParseError'], ['MultipartConversionError', 'MessageError'], ['CharsetError', 'MessageError'],
    ['MessageDefect', 'ValueError'], ['NoBoundaryInMultipartDefect', 'MessageDefect'], ['StartBoundaryNotFoundDefect', 'MessageDefect'],
    ['CloseBoundaryNotFoundDefect', 'MessageDefect'], ['FirstHeaderLineIsContinuationDefect', 'MessageDefect'],
    ['MisplacedEnvelopeHeaderDefect', 'MessageDefect'], ['MissingHeaderBodySeparatorDefect', 'MessageDefect'],
    ['MultipartInvariantViolationDefect', 'MessageDefect'], ['InvalidMultipartContentTransferEncodingDefect', 'MessageDefect'],
    ['UndecodableBytesDefect', 'MessageDefect'], ['InvalidBase64PaddingDefect', 'MessageDefect'],
    ['InvalidBase64CharactersDefect', 'MessageDefect'], ['HeaderDefect', 'MessageDefect'], ['InvalidHeaderDefect', 'HeaderDefect'],
    ['HeaderMissingRequiredValue', 'HeaderDefect'], ['NonPrintableDefect', 'HeaderDefect'], ['ObsoleteHeaderDefect', 'HeaderDefect'],
    ['NonASCIILocalPartDefect', 'HeaderDefect']];
  const errors = _syModule('email.errors', {});
  for (const [n, p] of errNames) errors[n] = makeExcType(n, p);
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatdate = (...a) => {
    const { timeval, usegmt } = _syArgs(a, ['timeval', 'localtime', 'usegmt'], { timeval: null, localtime: false, usegmt: false });
    const d = new Date(timeval === null ? Date.now() : timeval * 1000);
    const p2 = (x) => String(x).padStart(2, '0');
    return `${DAYS[(d.getUTCDay() + 6) % 7]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${usegmt ? 'GMT' : '-0000'}`;
  };
  const parsedateTz = (s) => {
    const m = /(\d{1,2})\s+(\w{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|GMT|UT|UTC|Z)?/i.exec(String(s));
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
    const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1;
    if (!mon) return null;
    const tz = !m[7] || /^(GMT|UT|UTC|Z)$/i.test(m[7]) ? 0 : (m[7][0] === '-' ? -1 : 1) * (parseInt(m[7].slice(1, 3), 10) * 3600 + parseInt(m[7].slice(3), 10) * 60);
    return mkTuple([y, mon, +m[1], +m[4], +m[5], +(m[6] || 0), 0, 1, -1, tz]);
  };
  const utils = _syModule('email.utils', {
    formatdate, format_datetime: (dt) => formatdate(adderGetAttr(dt, 'timestamp')(), false, true),
    parsedate_tz: parsedateTz, parsedate: (s) => { const t = parsedateTz(s); return t ? mkTuple(t.slice(0, 9)) : null; },
    mktime_tz: (t) => Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5]) / 1000 - (t[9] || 0),
    parseaddr: (a) => { const m = /^\s*(?:"?([^"<]*?)"?\s*<([^>]+)>|(\S+@\S+))\s*$/.exec(String(a)); return m ? mkTuple([m[1] ? m[1].trim() : '', m[2] || m[3]]) : mkTuple(['', '']); },
    formataddr: (pair) => { const [name, addr] = [...pyIter(pair)]; return name ? `${/[(),.:;<>@[\]"]/.test(name) ? `"${name}"` : name} <${addr}>` : addr; },
    quote: (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'), unquote: (s) => (/^".*"$/.test(s) || /^<.*>$/.test(s) ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s),
    make_msgid: () => `<${Date.now()}.${Math.random().toString(36).slice(2)}@localhost>`,
    getaddresses: (vals) => [...pyIter(vals)].flatMap((v) => String(v).split(',')).map((x) => utils.parseaddr(x)),
    collapse_rfc2231_value: (v) => (Array.isArray(v) ? v[2] : v), decode_rfc2231: (s) => mkTuple([null, null, s]), encode_rfc2231: (s) => s,
  });
  // Message: case-insensitive, ordered, repeatable headers + a payload
  const Message = _syClass('Message', [], {
    __init__(self, policy = null) { self._headers = []; self._payload = null; self.policy = policy; self.defects = []; self.preamble = null; self.epilogue = null; self._unixfrom = null; return null; },
    __getitem__(self, k) { const h = self._headers.find(([n]) => n.toLowerCase() === String(k).toLowerCase()); return h ? h[1] : null; },
    __setitem__(self, k, v) { self._headers.push([String(k), v]); return null; },
    __delitem__(self, k) { self._headers = self._headers.filter(([n]) => n.toLowerCase() !== String(k).toLowerCase()); return null; },
    __contains__(self, k) { return self._headers.some(([n]) => n.toLowerCase() === String(k).toLowerCase()); },
    __len__(self) { return self._headers.length; },
    __iter__(self) { return self._headers.map(([n]) => n)[Symbol.iterator](); },
    __str__(self) { return adderGetAttr(self, 'as_string')(); },
    keys(self) { return self._headers.map(([n]) => n); }, values(self) { return self._headers.map(([, v]) => v); },
    items(self) { return self._headers.map(([n, v]) => mkTuple([n, v])); },
    get(self, k, failobj = null) { const v = adderGetAttr(self, '__getitem__')(k); return v === null ? failobj : v; },
    get_all(self, k, failobj = null) { const vs = self._headers.filter(([n]) => n.toLowerCase() === String(k).toLowerCase()).map(([, v]) => v); return vs.length ? vs : failobj; },
    add_header(self, name, value, ...a) { const kw = _syKw(a) || {}; const params = Object.entries(kw).filter(([k]) => k !== '_kw').map(([k, v]) => `; ${k.replace(/_/g, '-')}="${v}"`).join(''); self._headers.push([name, value + params]); return null; },
    replace_header(self, name, value) { const i = self._headers.findIndex(([n]) => n.toLowerCase() === String(name).toLowerCase()); if (i < 0) throw new AdderError('KeyError', pyRepr(name)); self._headers[i] = [self._headers[i][0], value]; return null; },
    get_payload(self, i = null, decode = false) { return self._payload; },
    set_payload(self, p, charset = null) { self._payload = p; return null; },
    is_multipart(self) { return Array.isArray(self._payload); },
    get_content_type(self) { const v = adderGetAttr(self, 'get')('content-type'); return v ? String(v).split(';')[0].trim().toLowerCase() : 'text/plain'; },
    get_content_maintype(self) { return adderGetAttr(self, 'get_content_type')().split('/')[0]; },
    get_content_subtype(self) { return adderGetAttr(self, 'get_content_type')().split('/')[1]; },
    get_param(self, param, failobj = null, header = 'content-type') {
      const v = adderGetAttr(self, 'get')(header); if (!v) return failobj;
      for (const part of String(v).split(';').slice(1)) { const m = /^\s*([^=\s]+)\s*=\s*"?([^"]*)"?\s*$/.exec(part); if (m && m[1].toLowerCase() === String(param).toLowerCase()) return m[2]; }
      return failobj;
    },
    get_params(self, failobj = null, header = 'content-type') { const v = adderGetAttr(self, 'get')(header); if (!v) return failobj; return String(v).split(';').map((p, i) => { const m = /^\s*([^=]+?)\s*(?:=\s*"?([^"]*)"?)?\s*$/.exec(p); return mkTuple([m ? m[1] : p, i === 0 ? '' : (m && m[2]) || '']); }); },
    get_content_charset(self, failobj = null) { const c = adderGetAttr(self, 'get_param')('charset'); return c ? String(c).toLowerCase() : failobj; },
    get_filename(self, failobj = null) { return adderGetAttr(self, 'get_param')('filename', failobj, 'content-disposition'); },
    get_boundary(self, failobj = null) { return adderGetAttr(self, 'get_param')('boundary', failobj); },
    walk: function* (self) { yield self; if (Array.isArray(self._payload)) for (const p of self._payload) yield* adderGetAttr(p, 'walk')(); },
    as_string(self) { return self._headers.map(([n, v]) => `${n}: ${v}`).join('\n') + '\n\n' + (typeof self._payload === 'string' ? self._payload : ''); },
    get_unixfrom(self) { return self._unixfrom; }, set_unixfrom(self, u) { self._unixfrom = u; return null; },
  }, 'email.message');
  const parseHeaders = (text, msg) => {
    const lines = String(text).split(/\r?\n/);
    let i = 0;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (l === '') { i++; break; }
      if (/^[ \t]/.test(l) && msg._headers.length) { const last = msg._headers[msg._headers.length - 1]; last[1] += ' ' + l.trim(); continue; }
      const m = /^([^:\s][^:]*):\s?(.*)$/.exec(l);
      if (m) msg._headers.push([m[1], m[2]]);
      else { i++; break; }
    }
    return lines.slice(i).join('\n');
  };
  const Parser = _syClass('Parser', [], {
    __init__(self, _class = null, ...a) { self._class = _class || Message; return null; },
    parsestr(self, text, headersonly = false) { const msg = self._class(); const body = parseHeaders(text, msg); msg._payload = headersonly ? null : body; return msg; },
    parse(self, fp, headersonly = false) { const t = adderGetAttr(fp, 'read')(); return _syIsThen(t) ? t.then((x) => adderGetAttr(self, 'parsestr')(x, headersonly)) : adderGetAttr(self, 'parsestr')(t, headersonly); },
  }, 'email.parser');
  const BytesParser = _syClass('BytesParser', [Parser], { parsebytes(self, b, headersonly = false) { return adderGetAttr(self, 'parsestr')(pyDecodePartial(b, 'latin-1', 'strict', true).text, headersonly); } }, 'email.parser');
  const FeedParser = _syClass('FeedParser', [], {
    __init__(self, _factory = null, ...a) { self._buf = ''; self._factory = _factory || Message; return null; },
    feed(self, data) { self._buf += String(data); return null; },
    close(self) { return Parser(self._factory).parsestr(self._buf); },
  }, 'email.feedparser');
  const policyObj = (name) => ({ __adderClass__: 'Policy', name, max_line_length: 78, linesep: '\n', raise_on_defect: false, clone: function (...a) { const kw = _syKw(a) || {}; return Object.assign({ ...this }, Object.fromEntries(Object.entries(kw).filter(([k]) => k !== '_kw'))); } });
  const policy = _syModule('email.policy', { default: policyObj('default'), compat32: policyObj('compat32'), SMTP: policyObj('SMTP'), SMTPUTF8: policyObj('SMTPUTF8'), HTTP: policyObj('HTTP'), strict: policyObj('strict'), Policy: Object, EmailPolicy: Object, Compat32: Object });
  const Header = _syClass('Header', [], {
    __init__(self, s = null, charset = null) { self._chunks = s === null ? [] : [[s, charset]]; return null; },
    append(self, s, charset = null) { self._chunks.push([s, charset]); return null; },
    encode(self) { return self._chunks.map(([s]) => s).join(' '); }, __str__(self) { return adderGetAttr(self, 'encode')(); },
  }, 'email.header');
  const decode_header = (h) => {
    const out = [];
    const re = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
    let last = 0, m, plain = true;
    while ((m = re.exec(h))) {
      plain = false;
      if (m.index > last && h.slice(last, m.index).trim()) out.push(mkTuple([pyEncode(h.slice(last, m.index), 'latin-1'), null]));
      let bytes;
      if (m[2].toLowerCase() === 'b') { const bin = atob(m[3]); bytes = new Uint8Array([...bin].map((c) => c.charCodeAt(0))); }
      else { const t = m[3].replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, hx) => String.fromCharCode(parseInt(hx, 16))); bytes = pyEncode(t, 'latin-1'); }
      out.push(mkTuple([bytes, m[1].toLowerCase()]));
      last = re.lastIndex;
    }
    if (plain) return [mkTuple([h, null])];
    if (h.slice(last).trim()) out.push(mkTuple([pyEncode(h.slice(last), 'latin-1'), null]));
    return out;
  };
  const header = _syModule('email.header', { Header, decode_header, make_header: (parts) => { const h = Header(); for (const [b, cs] of pyIter(parts)) adderGetAttr(h, 'append')(b instanceof Uint8Array ? pyDecodePartial(b, cs || 'latin-1', 'replace', true).text : b, cs); return h; } });
  const email = _syModule('email', {
    errors, utils, message: _syModule('email.message', { Message, EmailMessage: Message }),
    parser: _syModule('email.parser', { Parser, BytesParser, HeaderParser: Parser, BytesHeaderParser: BytesParser }),
    feedparser: _syModule('email.feedparser', { FeedParser, BytesFeedParser: FeedParser }), policy, header,
    message_from_string: (s, ...a) => Parser().parsestr(s), message_from_bytes: (b, ...a) => BytesParser().parsebytes(b),
    charset: _syModule('email.charset', { Charset: (name = 'us-ascii') => ({ __adderClass__: 'Charset', input_charset: name, output_charset: name, __str__: () => name }) }),
  });
  adderModules.email = email;
  for (const k of ['errors', 'utils', 'message', 'parser', 'feedparser', 'policy', 'header', 'charset']) adderModules[`email.${k}`] = email[k];
}

// ── punycode (RFC 3492): the codec idna uses for xn-- labels ──
{
  const base = 36, tmin = 1, tmax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
  const adapt = (delta, numPoints, first) => { delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / numPoints); let k = 0; while (delta > ((base - tmin) * tmax) >> 1) { delta = Math.floor(delta / (base - tmin)); k += base; } return k + Math.floor(((base - tmin + 1) * delta) / (delta + skew)); };
  const digit = (d) => String.fromCharCode(d + 22 + 75 * (d < 26));
  const encode = (input) => {
    const cps = [...String(input)].map((c) => c.codePointAt(0));
    let out = cps.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
    const b = out.length; let h = b;
    if (b) out += '-';
    let n = initialN, delta = 0, bias = initialBias;
    while (h < cps.length) {
      const m = Math.min(...cps.filter((c) => c >= n));
      delta += (m - n) * (h + 1); n = m;
      for (const c of cps) {
        if (c < n) delta++;
        if (c === n) {
          let q = delta;
          for (let k = base; ; k += base) { const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias; if (q < t) break; out += digit(t + ((q - t) % (base - t))); q = Math.floor((q - t) / (base - t)); }
          out += digit(q); bias = adapt(delta, h + 1, h === b); delta = 0; h++;
        }
      }
      delta++; n++;
    }
    return out;
  };
  const decode = (input) => {
    input = String(input);
    const out = [];
    const bpos = input.lastIndexOf('-');
    for (let j = 0; j < (bpos > 0 ? bpos : 0); j++) out.push(input.charCodeAt(j));
    let n = initialN, bias = initialBias, i = 0;
    for (let idx = bpos > 0 ? bpos + 1 : 0; idx < input.length;) {
      const oldi = i; let w = 1;
      for (let k = base; ; k += base) {
        if (idx >= input.length) throw new AdderError('UnicodeDecodeError', 'punycode: truncated input');
        const c = input.charCodeAt(idx++);
        const dg = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
        if (dg >= base) throw new AdderError('UnicodeDecodeError', 'punycode: invalid input');
        i += dg * w;
        const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
        if (dg < t) break;
        w *= base - t;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1)); i %= out.length + 1;
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  };
  registerCodec('punycode', {
    encode: (s) => pyEncode(encode(s), 'ascii'),
    decode: (b) => decode(pyDecodePartial(b, 'ascii', 'strict', true).text),
  });
  // idna (RFC 3490): host names — a non-ASCII label is punycoded behind 'xn--' (nameprep reduced
  // to lowercasing); ASCII labels pass through
  const labelErr = (why) => new AdderError('UnicodeError', `encoding with 'idna' codec failed (UnicodeError: ${why})`);
  registerCodec('idna', {
    encode: (s) => {
      const labels = String(s).split(/[.\u3002\uff0e\uff61]/);
      const out = labels.map((l, i) => {
        if (!l) { if (i === labels.length - 1 && i > 0) return ''; throw labelErr('label empty or too long'); }
        const a = /^[\x00-\x7f]*$/.test(l) ? l : 'xn--' + encode(l.toLowerCase());
        if (a.length > 63) throw labelErr('label empty or too long');
        return a;
      });
      return pyEncode(out.join('.'), 'ascii');
    },
    decode: (b) => pyDecodePartial(b, 'ascii', 'strict', true).text.split('.').map((l) => (l.toLowerCase().startsWith('xn--') ? decode(l.slice(4)) : l.toLowerCase())).join('.'),
  }, ['idna']);
}

// ── _random: CPython's Mersenne Twister (Modules/_randommodule.c), exactly ──
// `random` is CPython's own random.py (pylib), which builds every distribution — randrange,
// shuffle, sample, choices, gauss, seeding a str by SHA-512 — over this base class, as CPython's
// does over the C one: so a seed gives CPython's sequence, value for value. The state (624 words
// and an index) lives under symbols, out of Python's sight as the C struct's is.
{
  const N = 624, M = 397, MT = Symbol('mt'), MTI = Symbol('mti');
  // a C method's argument count, CPython's messages (keywords: none taken)
  // (an empty keyword bag — f(*args, **{}) — is no keywords: unittest's assertRaises calls so)
  const arity = (name, a, lo, hi) => {
    const last = a.length ? a[a.length - 1] : null;
    if (last !== null && typeof last === 'object' && last._kw) {
      if (Object.keys(last).some((k) => k !== '_kw')) throw new AdderError('TypeError', `${name}() takes no keyword arguments`);
      a.pop();
    }
    if (a.length >= lo && a.length <= hi) return;
    throw new AdderError('TypeError', hi === 0 ? `${name}() takes no arguments (${a.length} given)`
      : lo === hi ? `${name}() takes exactly one argument (${a.length} given)`
      : `${name} expected at most ${hi} argument${hi > 1 ? 's' : ''}, got ${a.length}`);
  };
  const initGenrand = (mt, s) => {
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
  };
  // init_by_array: (x ^ y) is an int32 and the sums stay below 2**53, so `>>> 0` is the C
  // uint32 wrap-around
  const initByArray = (self, key) => {
    const mt = new Uint32Array(N);
    initGenrand(mt, 19650218);
    let i = 1, j = 0;
    for (let k = Math.max(N, key.length); k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
    self[MT] = mt;
    self[MTI] = N;
  };
  // random_seed: None from the OS's entropy; an int by its absolute value (a bool as one); anything
  // else by its hash, as an unsigned 64-bit number — split into 32-bit words, least significant first
  const seed = (self, arg) => {
    if (arg === null || arg === undefined) {
      const key = new Uint32Array(N);
      globalThis.crypto.getRandomValues(key);
      return initByArray(self, key);
    }
    let n;
    if (typeof arg === 'boolean') n = BigInt(+arg);
    else if (typeof arg === 'bigint' || (typeof arg === 'number' && isIntNum(arg))) n = BigInt(arg);
    else { const h = _pyHash(arg); n = BigInt.asUintN(64, BigInt(h)); }
    if (n < 0n) n = -n;
    const key = [];
    if (n === 0n) key.push(0);
    for (; n > 0n; n >>= 32n) key.push(Number(n & 0xffffffffn));
    initByArray(self, key);
  };
  const genrand = (self) => {
    if (!self[MT]) seed(self, null);
    const mt = self[MT];
    if (self[MTI] >= N) {
      let kk = 0, y;
      for (; kk < N - M; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      self[MTI] = 0;
    }
    let y = mt[self[MTI]++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };
  const Random = _syClass('Random', [], {
    // (random_new: a Random made directly is seeded from its argument; random.py's subclass
    // seeds through its own __init__ → seed() → super().seed())
    __init__(self, ...a) { arity('Random', a, 0, 1); seed(self, a[0] ?? null); return null; },
    seed(self, ...a) {
      if (a.length > 1) throw new AdderError('TypeError', `seed expected at most 1 argument, got ${a.length}`);
      seed(self, a[0] ?? null);
      return null;
    },
    // genrand_res53: 27 + 26 bits into a double in [0, 1)
    random(self, ...a) {
      arity('Random.random', a, 0, 0);
      const x = genrand(self) >>> 5, y = genrand(self) >>> 6;
      return (x * 67108864 + y) * (1 / 9007199254740992);
    },
    // k random bits as an int, filled 32-bit word by word from the least significant, the last
    // word's high bits dropped
    getrandbits(self, ...a) {
      arity('Random.getrandbits', a, 1, 1);
      let k = a[0];
      if (typeof k === 'boolean') k = +k;
      else if (k !== null && typeof k === 'object' && typeof k.__index__ === 'function') k = k.__index__();
      if (typeof k !== 'bigint' && !(typeof k === 'number' && isIntNum(k))) throw new AdderError('TypeError', `'${pyTypeName(k)}' object cannot be interpreted as an integer`);
      if (k < 0) throw new AdderError('ValueError', 'number of bits must be non-negative');
      // (k is a Py_ssize_t: past it CPython's OverflowError; V8's BigInts stop at 2**30 bits, and
      // past that a MemoryError — not a long hang first)
      if (BigInt(k) > 9223372036854775807n) throw new AdderError('OverflowError', 'Python int too large to convert to C ssize_t');
      if (k > 2 ** 30) throw new AdderError('MemoryError', '');
      k = Number(k);
      if (k === 0) return 0;
      if (k <= 32) return genrand(self) >>> (32 - k);
      // words from the least significant up, as CPython's; joined as hex, most significant first
      const words = Math.ceil(k / 32), hex = new Array(words);
      for (let i = 0; i < words; i++, k -= 32) {
        let w = genrand(self);
        if (k < 32) w >>>= 32 - k;
        hex[words - 1 - i] = w.toString(16).padStart(8, '0');
      }
      const r = BigInt('0x' + hex.join(''));
      return r <= 9007199254740991n ? Number(r) : r;
    },
    getstate(self, ...a) {
      arity('Random.getstate', a, 0, 0);
      if (!self[MT]) seed(self, null);
      return mkTuple([...self[MT], self[MTI]]);
    },
    setstate(self, ...a) {
      arity('Random.setstate', a, 1, 1);
      const state = a[0];
      if (!(state instanceof PyTuple)) throw new AdderError('TypeError', 'state vector must be a tuple');
      if (state.length !== N + 1) throw new AdderError('ValueError', 'state vector is the wrong size');
      const mt = new Uint32Array(N);
      for (let i = 0; i < N; i++) {
        const v = state[i];
        if (typeof v === 'bigint' || v < 0 || v > 0xffffffff) throw new AdderError('OverflowError', 'Python int too large to convert to C unsigned long');
        mt[i] = v;
      }
      const index = state[N];
      if (index < 0 || index > N) throw new AdderError('ValueError', 'invalid state');
      self[MT] = mt;
      self[MTI] = Number(index);
      return null;
    },
  }, '_random');
  adderModules._random = _syModule('_random', { Random });
}

// every module in the registry is a module: type(m) is module, inspect.ismodule(m), and its
// functions are its attributes as they are (the last stdlib file, so all are registered)
for (const [k, m] of Object.entries(adderModules)) {
  if (k === 'js' || !m || typeof m !== 'object' || m.__adderModule__) continue;
  m.__adderModule__ = true;
  if (!m.__name__) m.__name__ = k;
}

// builtins: the builtin namespace as a module (`import builtins`, `builtins.open`, six's
// `builtins.exec`). Made on first import — one table, shared by every importer.
{
  let mod = null;
  Object.defineProperty(adderModules, 'builtins', {
    configurable: true, enumerable: false,
    get() {
      if (!mod) mod = Object.assign(adderBuiltins(stdoutWrite), { __adderModule__: true, _pyRawFns: true, __name__: 'builtins', __doc__: 'Built-in functions, types, exceptions, and other objects.' });
      return mod;
    },
  });
}

// _multibytecodec + encodings.<name>: a codec's module, made when imported (charset detection
// asks `issubclass(encodings.big5.IncrementalDecoder, MultibyteIncrementalDecoder)`; requests
// imports encodings.idna) — any encoding codecs knows, including the platform's legacy ones
{
  const decodeWith = (n) => function (self, input, final = false) {
    if (final && final._kw) final = final.final;
    const b = input instanceof Uint8Array ? input : new Uint8Array([...pyIter(input || [])]);
    return pyDecodePartial(b, n, self.errors, true).text;
  };
  const MBD = _syClass('MultibyteIncrementalDecoder', [], {
    __init__(self, errors = 'strict') { self.errors = errors; return null; },
    decode(self, input, final = false) { return decodeWith(self.codec_name || 'utf-8')(self, input, final); },
    reset() { return null; }, getstate() { return mkTuple([new Uint8Array(0), 0]); }, setstate() { return null; },
  }, '_multibytecodec');
  const MBE = _syClass('MultibyteIncrementalEncoder', [], {
    __init__(self, errors = 'strict') { self.errors = errors; return null; },
    encode(self, input, final = false) { return pyEncode(input, self.codec_name || 'utf-8', self.errors); },
    reset() { return null; }, getstate() { return 0; }, setstate() { return null; },
  }, '_multibytecodec');
  adderModules._multibytecodec = _syModule('_multibytecodec', {
    MultibyteIncrementalDecoder: MBD, MultibyteIncrementalEncoder: MBE,
    MultibyteStreamReader: _syClass('MultibyteStreamReader', [], {}, '_multibytecodec'),
    MultibyteStreamWriter: _syClass('MultibyteStreamWriter', [], {}, '_multibytecodec'),
    MultibyteCodec: _syClass('MultibyteCodec', [], {}, '_multibytecodec'),
    __create_codec: () => { throw new AdderError('LookupError', 'no multibyte codec tables here'); },
  });
  const made = new Map();
  const codecModule = (leaf) => {
    let n;
    try { n = codecName(leaf); } catch { n = null; }
    if (!n) return undefined;
    if (made.has(leaf)) return made.get(leaf);
    const multi = isMultibyteCodec(n);
    const C = adderModules.codecs;
    const mod = `encodings.${leaf}`;
    const IncrementalDecoder = multi ? _syClass('IncrementalDecoder', [MBD], { codec_name: n, decode: decodeWith(n) }, mod) : C.getincrementaldecoder(n);
    const IncrementalEncoder = multi ? _syClass('IncrementalEncoder', [MBE], { codec_name: n }, mod) : C.getincrementalencoder(n);
    const Codec = _syClass('Codec', [], {
      encode(self, input, errors = 'strict') { return mkTuple([pyEncode(input, n, errors), String(input).length]); },
      decode(self, input, errors = 'strict') { return mkTuple([pyDecodePartial(input, n, errors, true).text, input.length]); },
    }, mod);
    const m = _syModule(mod, { Codec, IncrementalDecoder, IncrementalEncoder, getregentry: () => C.lookup(n),
      StreamReader: _syClass('StreamReader', [Codec], {}, mod), StreamWriter: _syClass('StreamWriter', [Codec], {}, mod) });
    made.set(leaf, m);
    return m;
  };
  const base = adderModules.encodings;
  adderModules.encodings = new Proxy(base, {
    get(t, k, r) {
      if (typeof k !== 'string' || k in t || k.startsWith('_') || k === 'then') return Reflect.get(t, k, r);
      return codecModule(k);
    },
  });
}

// ── gc, signal, faulthandler, tracemalloc, contextvars: the interpreter-level modules code
// imports to probe or configure the runtime. The engine's memory is the JS heap: gc reports
// nothing to collect; there are no OS signals (handlers are recorded, never called);
// faulthandler / tracemalloc are off. contextvars is real: one context (no threads or task
// switches to separate), with tokens and copy_context().run. ──
{
  let gcEnabled = true;
  let threshold = mkTuple([2000, 10, 10]);
  adderModules.gc = _syModule('gc', {
    enable: () => { gcEnabled = true; return null; },
    disable: () => { gcEnabled = false; return null; },
    isenabled: () => gcEnabled,
    collect: () => 0,
    get_count: () => mkTuple([0, 0, 0]),
    get_threshold: () => threshold,
    set_threshold: (...a) => { threshold = mkTuple(a.slice(0, 3)); return null; },
    get_objects: () => [], get_referrers: () => [], get_referents: () => [],
    is_tracked: () => false, is_finalized: () => false,
    freeze: () => null, unfreeze: () => null, get_freeze_count: () => 0,
    get_stats: () => [], set_debug: () => null, get_debug: () => 0,
    garbage: [], callbacks: [],
    DEBUG_STATS: 1, DEBUG_COLLECTABLE: 2, DEBUG_UNCOLLECTABLE: 4, DEBUG_SAVEALL: 32, DEBUG_LEAK: 38,
  });

  const SIG = { SIGABRT: 22, SIGFPE: 8, SIGILL: 4, SIGINT: 2, SIGSEGV: 11, SIGTERM: 15, SIGBREAK: 21 };
  const handlers = new Map();
  const defaultIntHandler = Object.assign(() => { throw new AdderError('KeyboardInterrupt', ''); }, { _pyName: 'default_int_handler' });
  const sigCheck = (n) => { if (!Object.values(SIG).includes(n)) throw new AdderError('ValueError', 'invalid signal value'); };
  adderModules.signal = _syModule('signal', {
    ...SIG, SIG_DFL: 0, SIG_IGN: 1, NSIG: 23,
    default_int_handler: defaultIntHandler,
    signal: (n, h) => { sigCheck(n); const prev = handlers.has(n) ? handlers.get(n) : n === SIG.SIGINT ? defaultIntHandler : 0; handlers.set(n, h); return prev; },
    getsignal: (n) => { sigCheck(n); return handlers.has(n) ? handlers.get(n) : n === SIG.SIGINT ? defaultIntHandler : 0; },
    raise_signal: (n) => { sigCheck(n); const h = handlers.has(n) ? handlers.get(n) : n === SIG.SIGINT ? defaultIntHandler : 0; if (typeof h === 'function') return h(n, null); return null; },
    valid_signals: () => new PySet(Object.values(SIG)),
    strsignal: (n) => ({ 2: 'Interrupt', 15: 'Terminated', 22: 'Aborted', 8: 'Floating-point exception', 4: 'Illegal instruction', 11: 'Segmentation fault', 21: 'Break' })[n] ?? null,
    set_wakeup_fd: () => -1,
  });

  let fhEnabled = false;
  adderModules.faulthandler = _syModule('faulthandler', {
    enable: () => { fhEnabled = true; return null; },
    disable: () => { fhEnabled = false; return null; },
    is_enabled: () => fhEnabled,
    dump_traceback: () => null, dump_traceback_later: () => null, cancel_dump_traceback_later: () => null,
    register: () => null, unregister: () => false, dump_c_stack: () => null,
  });

  let tmTracing = false;
  adderModules.tracemalloc = _syModule('tracemalloc', {
    is_tracing: () => tmTracing,
    start: () => { tmTracing = true; return null; },
    stop: () => { tmTracing = false; return null; },
    clear_traces: () => null,
    get_traced_memory: () => mkTuple([0, 0]), reset_peak: () => null,
    get_traceback_limit: () => 1, get_tracemalloc_memory: () => 0, get_object_traceback: () => null,
    take_snapshot: () => { throw new AdderError('RuntimeError', 'the tracemalloc module must be tracing memory allocations to take a snapshot'); },
  });

  // contextvars
  const MISSING = { __adderClass__: 'Token.MISSING', __repr__: () => '<Token.MISSING>' };
  let current = new Map();   // ContextVar → value
  const kwOf = (a) => (a.length && a[a.length - 1] && a[a.length - 1]._kw ? a.pop() : {});
  const Token = _syClass('Token', [], {
    __init__: (self, ctx, v, old) => { self._ctx = ctx; self.var = v; self.old_value = old; self._used = false; return null; },
    __repr__: (self) => `<Token${self._used ? ' used' : ''} var=${pyRepr(self.var)} at 0x${(0x7f0000000000 + (_pyHash(self) & 0xffffff)).toString(16)}>`,
  }, 'contextvars');
  Token.MISSING = MISSING;
  const ContextVar = _syClass('ContextVar', [], {
    __init__: (self, name, ...a) => {
      const kw = kwOf(a);
      self.name = name;
      self._default = a.length ? a[0] : Object.hasOwn(kw, 'default') ? kw.default : MISSING;
      return null;
    },
    get: (self, ...a) => {
      if (current.has(self)) return current.get(self);
      if (a.length) return a[0];
      if (self._default !== MISSING) return self._default;
      throw new AdderError('LookupError', pyRepr(self), undefined, [self]);
    },
    set: (self, value) => {
      const old = current.has(self) ? current.get(self) : MISSING;
      current = new Map(current); current.set(self, value);
      return Token(current, self, old);
    },
    reset: (self, token) => {
      if (token._used) throw new AdderError('RuntimeError', 'Token has already been used once');
      if (token.var !== self) throw new AdderError('ValueError', 'Token was created by a different ContextVar');
      current = new Map(current);
      if (token.old_value === MISSING) current.delete(self); else current.set(self, token.old_value);
      token._used = true;
      return null;
    },
    __repr__: (self) => `<ContextVar name=${pyRepr(self.name)}${self._default !== MISSING ? ` default=${pyRepr(self._default)}` : ''} at 0x${(0x7f0000000000 + (_pyHash(self) & 0xffffff)).toString(16)}>`,
  }, 'contextvars');
  // a Context: a snapshot mapping; run(fn) makes it current for the call, then restores
  const Context = _syClass('Context', [], {
    __init__: (self) => { self._vars = new Map(); return null; },
    run: (self, fn, ...args) => {
      const saved = current;
      current = self._vars;
      const done = () => { self._vars = current; current = saved; };
      let r;
      try { r = fn(...args); } catch (e) { done(); throw e; }
      if (r && typeof r.then === 'function') return r.then((v) => { done(); return v; }, (e) => { done(); throw e; });
      done();
      return r;
    },
    copy: (self) => { const c = Context(); c._vars = new Map(self._vars); return c; },
    get: (self, v, d = null) => (self._vars.has(v) ? self._vars.get(v) : d),
    keys: (self) => [...self._vars.keys()], values: (self) => [...self._vars.values()],
    items: (self) => [...self._vars.entries()].map(mkTuple),
    __getitem__: (self, v) => { if (!self._vars.has(v)) throw new AdderError('KeyError', pyRepr(v), undefined, [v]); return self._vars.get(v); },
    __contains__: (self, v) => self._vars.has(v),
    __len__: (self) => self._vars.size,
    __iter__: (self) => [...self._vars.keys()][Symbol.iterator](),
  }, 'contextvars');
  // _imp: the import machinery's internals — no C extensions, no frozen modules in CPython's
  // sense (adder's own stdlib is built in), one interpreter, so no import lock to speak of
  let impLock = 0;
  adderModules._imp = _syModule('_imp', {
    extension_suffixes: () => [],
    is_builtin: (name) => (adderModules[name] && adderModules[name].__adderModule__ ? 1 : 0),
    is_frozen: () => false, is_frozen_package: () => false, find_frozen: () => null,
    acquire_lock: () => { impLock++; return null; }, release_lock: () => { if (!impLock) throw new AdderError('RuntimeError', 'not holding the import lock'); impLock--; return null; },
    lock_held: () => impLock > 0,
    _fix_co_filename: () => null, check_hash_based_pycs: 'default', pyc_magic_number_token: 3571,
    source_hash: () => new Uint8Array(8),
    create_builtin: (spec) => { const m = adderModules[spec && spec.name]; if (!m) throw new AdderError('ImportError', `no built-in module named ${spec && spec.name}`); return m; },
    exec_builtin: () => 0, exec_dynamic: () => 0, _override_multi_interp_extensions_check: () => -1,
    _override_frozen_modules_for_tests: () => null, _frozen_module_names: () => mkTuple([]),
  });
  // py_compile: there is no bytecode to write; compile() checks the source parses (what callers
  // use it for) and answers with the would-be .pyc path; PyCompileError for a syntax error
  const PyCompileError = makeExcType('py_compile.PyCompileError', 'Exception');
  adderModules.py_compile = _syModule('py_compile', {
    PyCompileError,
    PycInvalidationMode: _syModule('PycInvalidationMode', { TIMESTAMP: 1, CHECKED_HASH: 2, UNCHECKED_HASH: 3 }),
    compile: async (file, ...a) => {
      const kw = _syKw(a) || {};
      const cfile = a.length > 0 ? a[0] : kw.cfile ?? null;
      const doraise = a.length > 2 ? a[2] : !!kw.doraise;
      const src = await adderGetAttr(adderGetAttr(adderModules.io, 'open')(file, 'r'), 'read')();
      try { adderParse(String(src)); } catch (e) {
        const err = PyCompileError(`Sorry: ${e.message}`);
        if (doraise) throw err;
        stdoutWrite(String(err.pyMessage || e.message) + String.fromCharCode(10));
        return null;
      }
      return cfile ?? String(file).replace(/[.]py$/, '') + '.cpython-313.pyc';
    },
    main: () => 0,
  });
  // _io: io's C half — the same objects here
  if (adderModules.io) adderModules._io = adderModules.io;
  // pdb: there is no interactive debugger (no frames to stop in, no terminal to read); the module
  // and its Pdb class exist for code that imports them — doctest subclasses Pdb at import time
  const noDebugger = () => { throw new AdderError('RuntimeError', 'pdb: adder has no interactive debugger'); };
  const Pdb = _syClass('Pdb', [], {
    __init__(self, ...a) { self.args = a; return null; },
    set_trace: noDebugger, set_continue: () => null, set_step: noDebugger, run: noDebugger, runcall: noDebugger,
  }, 'pdb');
  adderModules.pdb = _syModule('pdb', {
    Pdb, set_trace: noDebugger, post_mortem: noDebugger, pm: noDebugger, run: noDebugger, runeval: noDebugger, runcall: noDebugger,
    Restart: makeExcType('pdb.Restart', 'Exception'),
  });
  // typing.TypeAliasType — what `type X[T] = value` makes (PEP 695): its value is evaluated on
  // first use (__value__), so an alias can refer to names defined after it
  {
    const ty = adderModules.typing;
    const TAT = _syClass('TypeAliasType', [], {
      __init__(self, name, value, ...a) {
        const kw = _syKw(a) || {};
        self.__name__ = name; self.__qualname__ = name;
        self._value = value; self._thunk = null;
        self.__type_params__ = kw.type_params !== undefined ? kw.type_params : mkTuple([]);
        return null;
      },
      __repr__(self) { return self.__name__; },
      __getitem__(self, params) { return new GenericAlias(self, Array.isArray(params) ? [...params] : [params]); },
      __or__(self, other) { return adderGetAttr(ty, 'Union')[Symbol.for('getitem')] ? null : pyGetItem(ty.Union, mkTuple([self, other])); },
    }, 'typing');
    Object.defineProperty(TAT.prototype, '__value__', {
      get() { if (this._thunk) { const t = this._thunk; this._thunk = null; this._value = t(); } return this._value; },
      configurable: true,
    });
    ty.TypeAliasType = TAT;
    ty._lazy_alias = (name, thunk, params) => { const a = TAT(name, null, { _kw: true, type_params: params }); a._thunk = thunk; return a; };
  }
  // _opcode: there is no bytecode here, so no specializing interpreter and no opcodes
  adderModules._opcode = _syModule('_opcode', {
    ENABLE_SPECIALIZATION: false, ENABLE_SPECIALIZATION_FT: false,
    stack_effect: () => { throw new AdderError('ValueError', 'adder has no bytecode'); },
    has_arg: () => false, has_const: () => false, has_name: () => false, has_jump: () => false,
    has_free: () => false, has_local: () => false, has_exc: () => false,
    get_intrinsic1_descs: () => [], get_intrinsic2_descs: () => [], get_specialization_stats: () => null,
    get_nb_ops: () => [], get_executor: () => { throw new AdderError('ValueError', 'no executor'); },
  });
  adderModules.contextvars = _syModule('contextvars', {
    ContextVar, Token, Context,
    copy_context: () => { const c = Context(); c._vars = new Map(current); return c; },
  });
}
