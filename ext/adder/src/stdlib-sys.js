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
  pyTypeName, pyIter, pyCollect, pyTypeObj, pyObjectObj, typeOf, _typeObjects, asCallable, excStack,
  excTypeOf, excValue, adderGetAttr, pyEq, pyLt, pyMod, pyFormatValue, pyEncode, pyDecodePartial, codecName, stdoutWrite, _stdio,
  classStatement, GenericAlias, setOsExtrasHook,
} from './builtins.js';

const _syIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
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
const _syModuleType = _syClass('ModuleType', [], {
  __init__(self, name, doc = null) { self.__name__ = name; self.__doc__ = doc; self.__adderModule__ = true; self.__package__ = null; self.__spec__ = null; self.__loader__ = null; return null; },
  __repr__(self) { return `<module ${pyRepr(self.__name__)}>`; },
}, 'types');
// a read-only view of a mapping
const _syMappingProxy = (m) => {
  const d = new PyDict(m instanceof Map ? [...m] : Object.entries(m || {}));
  const ro = () => { throw new AdderError('TypeError', "'mappingproxy' object does not support item assignment"); };
  d.set = ro; d.delete = ro; d.clear = ro;
  d.__adderClass__ = 'mappingproxy';
  return d;
};
adderModules.types = _syModule('types', {
  FunctionType: _syTypeNamed('function'), LambdaType: _syTypeNamed('function'),
  BuiltinFunctionType: _syTypeNamed('builtin_function_or_method'), BuiltinMethodType: _syTypeNamed('builtin_function_or_method'),
  MethodType: Object.assign((fn, obj) => { const m = (...a) => fn(obj, ...a); m.__self__ = obj; m.__func__ = fn; m._pyName = fn && fn._pyName; return m; }, { _pyName: 'method', _pyClass: true, __name__: 'method' }),
  MethodWrapperType: _syTypeNamed('method-wrapper'), WrapperDescriptorType: _syTypeNamed('wrapper_descriptor'),
  MethodDescriptorType: _syTypeNamed('method_descriptor'), ClassMethodDescriptorType: _syTypeNamed('classmethod_descriptor'),
  GetSetDescriptorType: _syTypeNamed('getset_descriptor'), MemberDescriptorType: _syTypeNamed('member_descriptor'),
  ModuleType: _syModuleType, SimpleNamespace: _sySimpleNamespace, MappingProxyType: Object.assign(_syMappingProxy, { _pyName: 'mappingproxy', _pyClass: true, __name__: 'mappingproxy' }),
  GeneratorType: _syTypeNamed('generator'), CoroutineType: _syTypeNamed('coroutine'), AsyncGeneratorType: _syTypeNamed('async_generator'),
  CodeType: _syTypeNamed('code'), FrameType: _syTypeNamed('frame'), TracebackType: _syTypeNamed('traceback'), CellType: _syTypeNamed('cell'),
  NoneType: _syTypeNamed('NoneType'), EllipsisType: _syTypeNamed('ellipsis'), NotImplementedType: _syTypeNamed('NotImplementedType'),
  GenericAlias, UnionType: _syTypeNamed('types.UnionType'),
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
const _syABCMeta = _syClass('ABCMeta', [pyTypeObj], {
  __init__(cls, name, bases, ns) {
    cls._pyAbcNamespace = ns instanceof Map ? Object.fromEntries(ns) : (ns || {});
    cls.__abstractmethods__ = new PySet(_syComputeAbstract(cls));
    cls._pyAbcRegistry = new Set();
    return null;
  },
  __call__(cls, ...args) {
    const abs = cls.__abstractmethods__;
    if (abs && abs.size) {
      const names = [...abs].sort();
      throw new AdderError('TypeError', `Can't instantiate abstract class ${cls._pyName} without an implementation for abstract method${names.length > 1 ? 's' : ''} ${names.map((n) => `'${n}'`).join(', ')}`);
    }
    return pyTypeObj.prototype.__call__.call(cls, ...args);
  },
  register(cls, sub) { cls._pyAbcRegistry.add(sub); return sub; },
  __instancecheck__(cls, obj) {
    const t = typeOf(obj);
    return [...cls._pyAbcRegistry].some((r) => r === t || ((t && t._pyMRO) || []).includes(r)) ||
      (typeof cls.__subclasshook__ === 'function' && t && cls.__subclasshook__(t) === true);
  },
  __subclasscheck__(cls, sub) {
    if (sub === cls || ((sub && sub._pyMRO) || []).includes(cls)) return true;
    return [...cls._pyAbcRegistry].some((r) => r === sub || ((sub && sub._pyMRO) || []).includes(r));
  },
}, 'abc');
const _syAbstract = (f) => { if (f && typeof f === 'object' && f.fn) f.fn.__isabstractmethod__ = true; else if (f) f.__isabstractmethod__ = true; return f; };
adderModules.abc = _syModule('abc', {
  ABCMeta: _syABCMeta,
  abstractmethod: _syAbstract,
  abstractclassmethod: (f) => ({ __classmethod__: true, fn: _syAbstract(f) }),
  abstractstaticmethod: (f) => ({ __staticmethod__: true, fn: _syAbstract(f) }),
  abstractproperty: (f) => ({ __property__: true, fget: _syAbstract(f), fset: null }),
  get_cache_token: () => 0,
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
    ['Rational', 'Real', (o) => (typeof o === 'number' && Number.isInteger(o)) || typeof o === 'boolean' || typeof o === 'bigint' || pyTypeName(o) === 'Fraction'],
    ['Integral', 'Rational', (o) => (typeof o === 'number' && Number.isInteger(o)) || typeof o === 'boolean' || typeof o === 'bigint'],
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
    // the target runs now: one thread, so start() is the run (join() then has nothing to wait for)
    start(self) {
      if (self._started) throw new AdderError('RuntimeError', 'threads can only be started once');
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
  const isAsyncFn = (f) => typeof f === 'function' && ((f._pySig && f._pySig.isAsync) || (f.constructor && f.constructor.name === 'AsyncFunction' && !f._pySig) || f._isCoroutineFunction === true);
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
    iscoroutine: (o) => _syIsThen(o),
    isawaitable: (o) => _syIsThen(o) || (!!o && typeof o.__await__ === 'function'),
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
      get_coro: () => promise || null,
      __await__: () => p,
    };
    p.then((v) => { if (!done) { done = true; result = v; } for (const cb of callbacks.splice(0)) cb(fut); },
      (e) => { if (!done) { done = true; error = e; } for (const cb of callbacks.splice(0)) cb(fut); });
    p.catch(() => {});
    return fut;
  };
  // anything awaitable as a promise: a Task / Future through its __await__
  const asP = (x) => Promise.resolve(x !== null && typeof x === 'object' && typeof x.__await__ === 'function' && typeof x.then !== 'function' ? x.__await__() : x);
  const create_task = (coro, ...a) => { const kw = _syKw(a); const t = mkFuture(asP(coro)); if (kw && kw.name) t._name = kw.name; return t; };
  const gather = (...a) => {
    const kw = _syKw(a) || {};
    const ps = a.map(asP);
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
  adderModules.asyncio = _syModule('asyncio', {
    run: (coro, ...a) => { _syKw(a); return asP(coro); },
    sleep, gather, wait_for, create_task, ensure_future: create_task, shield: (aw) => aw, timeout,
    wait: (aws, ...a) => { const { timeout: to } = _syArgs(a, ['timeout', 'return_when'], { timeout: null }); const fs = [...pyIter(aws)].map((x) => (x && x.done ? x : create_task(x))); return wait_for(Promise.allSettled(fs.map(asP)), to).then(() => mkTuple([new PySet(fs), new PySet()])); },
    as_completed: (aws) => { const ps = [...pyIter(aws)].map(asP); const order = []; const waiters = ps.map(() => { let r, j; const p = new Promise((a, b) => { r = a; j = b; }); return { p, r, j }; }); let k = 0; ps.forEach((p) => p.then((v) => waiters[k++].r(v), (e) => waiters[k++].j(e))); return waiters.map((w) => w.p); },
    iscoroutine: (o) => _syIsThen(o), iscoroutinefunction: adderModules.inspect.iscoroutinefunction, isfuture: (o) => !!(o && o.__adderClass__ && (o.__adderClass__ === 'Future' || o.__adderClass__ === 'Task')),
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
    coroutines: _syModule('asyncio.coroutines', { iscoroutine: (o) => _syIsThen(o) }),
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
  return os;
}
setOsExtrasHook(_syOsExtras);
