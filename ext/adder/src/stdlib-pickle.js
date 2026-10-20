// adder stdlib — pickle: CPython's pickle format, both ways. Reads every protocol (0–5); writes
// protocols 0–5 (default 4, as CPython 3.8–3.13), with CPython's opcode choices, memo and
// framing, so plain data round-trips byte for byte with CPython where adder's values allow (an
// integral float is an int here, so 3.0 pickles as 3; ints past 2**53 lose precision).
//
// Values: None, bool, int, float, str, bytes, bytearray, tuple, list, dict, set, frozenset,
// range, complex, and classes / functions by reference (module + qualified name). Instances of
// user classes go through the reduce protocol: __reduce_ex__ / __reduce__, copyreg's
// dispatch_table, __getnewargs__(_ex__), __getstate__ / __setstate__, slots state; the default
// is CPython's (copyreg.__newobj__ + the instance __dict__). Unpickling finds classes by
// importing their module (Unpickler.find_class, overridable — the usual way to restrict what a
// pickle may construct; as in CPython, loads() runs whatever callables the pickle names).
//
// Everything that can call Python code (a reduce method, a constructor, find_class's import)
// may be async in the tree-walker: dumps / loads are generators run through maybeSync, so they
// are synchronous unless one of those really is.
//
// Concat-bundled with the rest of adder: top-level names carry a `_pk` prefix.

import {
  AdderError, adderModules, makeExcType, mkTuple, PyTuple, PyDict, PySet, PyByteArray, AdderRange, Complex,
  pyTypeName, pyIter, pyRepr, adderGetAttr, typeOf, pyObjectObj, maybeSync, isPlainDict, pyEncode, pyDecodePartial,
  buildClass, objectNew, mainClassLookup,
} from './builtins.js';

const _pkPickleError = makeExcType('PickleError', 'Exception');
const _pkPicklingError = makeExcType('PicklingError', 'PickleError');
const _pkUnpicklingError = makeExcType('UnpicklingError', 'PickleError');
const _pkHIGHEST = 5, _pkDEFAULT = 4;
const _pkFRAME_TARGET = 64 * 1024;
const _pkIsThen = (v) => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
const _pkKw = (a) => (a.length && a[a.length - 1] !== null && typeof a[a.length - 1] === 'object' && a[a.length - 1]._kw === true ? a.pop() : {});
const _pkLatin = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };
const _pkUtf8 = (s) => pyEncode(s, 'utf-8', 'surrogatepass');
const _pkOwnFn = (o, k) => { if (o === null || typeof o !== 'object') return null; const v = o[k]; return typeof v === 'function' ? v : null; };

// ── output: a growable byte buffer, cut into FRAMEs at opcode boundaries (protocol 4+) ──
class _PkOut {
  constructor(proto) { this.proto = proto; this.b = new Uint8Array(256); this.n = 0; this.frames = []; this.frameStart = 0; }
  _room(k) { if (this.n + k > this.b.length) { let m = this.b.length * 2; while (m < this.n + k) m *= 2; const nb = new Uint8Array(m); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
  op(code) { this._room(1); this.b[this.n++] = code; }
  u8(x) { this._room(1); this.b[this.n++] = x & 0xff; }
  u16(x) { this._room(2); this.b[this.n++] = x & 0xff; this.b[this.n++] = (x >>> 8) & 0xff; }
  u32(x) { this._room(4); for (let i = 0; i < 4; i++) this.b[this.n++] = (x >>> (8 * i)) & 0xff; }
  i32(x) { this.u32(x >>> 0); }
  u64(x) { this._room(8); let v = BigInt(x); for (let i = 0; i < 8; i++) { this.b[this.n++] = Number(v & 0xffn); v >>= 8n; } }
  bytes(arr) { this._room(arr.length); this.b.set(arr, this.n); this.n += arr.length; }
  ascii(s) { this.bytes(_pkLatin(s)); }
  f64be(x) { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x, false); this.bytes(new Uint8Array(dv.buffer)); }
  // an opcode is complete: start a new frame once this one is big enough
  boundary() { if (this.proto >= 4 && this.n - this.frameStart >= _PK_FRAME_TARGET_) this._commit(); }
  _commit() { if (this.n > this.frameStart) this.frames.push([this.frameStart, this.n]); this.frameStart = this.n; }
  result() {
    const head = this.proto >= 2 ? [0x80, this.proto] : [];
    if (this.proto < 4) { const r = new Uint8Array(head.length + this.n); r.set(head); r.set(this.b.subarray(0, this.n), head.length); return r; }
    this._commit();
    let total = head.length;
    for (const [s, e] of this.frames) total += (e - s >= 4 ? 9 : 0) + (e - s);
    const r = new Uint8Array(total);
    r.set(head);
    let p = head.length;
    for (const [s, e] of this.frames) {
      const len = e - s;
      if (len >= 4) { r[p++] = 0x95; let v = BigInt(len); for (let i = 0; i < 8; i++) { r[p++] = Number(v & 0xffn); v >>= 8n; } }
      r.set(this.b.subarray(s, e), p); p += len;
    }
    return r;
  }
}
const _PK_FRAME_TARGET_ = _pkFRAME_TARGET;

// ── the pickler ──
// state: { out, proto, memo: Map(obj → index), self (a Pickler instance or null), fixImports }
function _pkModuleOf(obj) {
  if (typeof obj === 'function') {
    const bn = obj._pyName || obj.__name__;
    if (bn && adderModules.builtins[bn] === obj) return 'builtins';   // object, type, len, …
    if (obj.__module__ !== undefined && obj.__module__ !== null) return obj.__module__;   // array.array, fractions.Fraction, …
    if (obj._pyClass && !obj._pyMRO) return 'builtins';            // int, ValueError, …
    if (obj._pyFunc || obj._pyDef || obj._pyClass) return '__main__';
    return 'builtins';
  }
  const m = obj && obj.__module__;
  return m === undefined || m === null ? '__main__' : m;
}
const _pkNameOf = (obj) => (obj && (obj.__qualname__ || obj._pyName || obj.__name__ || obj.name)) || null;

function _pkMemoize(st, obj) {
  // the next index, counted (not the map's size: a str memoised again — a global's module and
  // name both 'array' — replaces its entry, while the unpickler's MEMOIZE counts both)
  const idx = st.memo._pkNext ?? st.memo.size;
  Object.defineProperty(st.memo, '_pkNext', { value: idx + 1, writable: true, configurable: true });
  st.memo.set(obj, idx);
  const o = st.out;
  if (st.proto >= 4) o.op(0x94);
  else if (st.proto >= 1) { if (idx < 256) { o.op(0x71); o.u8(idx); } else { o.op(0x72); o.u32(idx); } }
  else { o.op(0x70); o.ascii(`${idx}\n`); }
  o.boundary();
}
function _pkGet(st, idx) {
  const o = st.out;
  if (st.proto >= 1) { if (idx < 256) { o.op(0x68); o.u8(idx); } else { o.op(0x6a); o.u32(idx); } }
  else { o.op(0x67); o.ascii(`${idx}\n`); }
  o.boundary();
}

function _pkSaveInt(st, n) {
  const o = st.out;
  if (st.proto >= 1) {
    if (n >= 0 && n <= 0xff) { o.op(0x4b); o.u8(n); return o.boundary(); }
    if (n >= 0 && n <= 0xffff) { o.op(0x4d); o.u16(n); return o.boundary(); }
    if (n >= -0x80000000 && n <= 0x7fffffff) { o.op(0x4a); o.i32(n); return o.boundary(); }
  }
  if (st.proto >= 2) {
    // LONG1 / LONG4: little-endian two's complement, as few bytes as hold it
    let v = BigInt(n);
    const bytes = [];
    if (v !== 0n) {
      for (;;) {
        bytes.push(Number(v & 0xffn));
        v >>= 8n;
        if ((v === 0n && !(bytes[bytes.length - 1] & 0x80)) || (v === -1n && (bytes[bytes.length - 1] & 0x80))) break;
      }
    }
    if (bytes.length < 256) { o.op(0x8a); o.u8(bytes.length); } else { o.op(0x8b); o.i32(bytes.length); }
    o.bytes(bytes);
    return o.boundary();
  }
  if (n >= -0x80000000 && n <= 0x7fffffff) o.ascii(`I${n}\n`);
  else o.ascii(`L${BigInt(n)}L\n`);
  o.boundary();
}
function _pkFloatRepr(x) {
  if (x !== x) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (Object.is(x, -0)) return '-0.0';
  return pyRepr(x);
}
function _pkSaveFloat(st, x) {
  const o = st.out;
  if (st.proto >= 1) { o.op(0x47); o.f64be(x); }
  else o.ascii(`F${_pkFloatRepr(x)}\n`);
  o.boundary();
}
function _pkSaveStr(st, s) {
  const o = st.out;
  if (st.proto >= 1) {
    const b = _pkUtf8(s);
    if (b.length < 256 && st.proto >= 4) { o.op(0x8c); o.u8(b.length); }
    else if (b.length > 0xffffffff && st.proto >= 4) { o.op(0x8d); o.u64(b.length); }
    else { o.op(0x58); o.u32(b.length); }
    o.bytes(b);
  } else {
    // raw-unicode-escape of the text, with the characters a line-based opcode can't hold escaped
    let t = '';
    for (const ch of s.replace(/\\/g, '\\u005c').replace(/\0/g, '\\u0000').replace(/\n/g, '\\u000a').replace(/\r/g, '\\u000d').replace(/\x1a/g, '\\u001a')) {
      const cp = ch.codePointAt(0);
      t += cp < 0x100 ? ch : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0') : '\\U' + cp.toString(16).padStart(8, '0');
    }
    o.op(0x56); o.ascii(t + '\n');
  }
  o.boundary();
  _pkMemoize(st, s);
}

function* _pkSave(st, obj, saveAsRef = true) {
  const o = st.out;
  // persistent ids: a Pickler subclass's persistent_id(obj), when it returns something
  if (st.persistentId) {
    const pid = yield st.persistentId(obj);
    if (pid !== null && pid !== undefined) {
      if (st.proto >= 1) { yield* _pkSave(st, pid); o.op(0x51); }
      else { o.op(0x50); o.ascii(`${typeof pid === 'string' ? pid : String(pid)}\n`); }
      return o.boundary();
    }
  }
  if (obj === null || obj === undefined) { o.op(0x4e); return o.boundary(); }
  if (obj === true || obj === false) {
    if (st.proto >= 2) o.op(obj ? 0x88 : 0x89); else o.ascii(obj ? 'I01\n' : 'I00\n');
    return o.boundary();
  }
  if (typeof obj === 'number') {
    if (Number.isInteger(obj) && !Object.is(obj, -0) && Math.abs(obj) <= Number.MAX_SAFE_INTEGER) return _pkSaveInt(st, obj);
    return _pkSaveFloat(st, obj);
  }
  if (typeof obj === 'bigint') return _pkSaveInt(st, obj);
  // memoised: the second reference to anything is a GET
  if (st.memo.has(obj)) return _pkGet(st, st.memo.get(obj));
  if (typeof obj === 'string') return _pkSaveStr(st, obj);
  if (obj instanceof Uint8Array) return yield* _pkSaveBytes(st, obj);
  if (obj instanceof PyByteArray) {
    if (st.proto >= 5) { o.op(0x96); o.u64(obj.length); o.bytes(obj); o.boundary(); return _pkMemoize(st, obj); }
    const b = Uint8Array.from(obj);
    return yield* _pkSaveReduce(st, adderModules.builtins.bytearray, mkTuple([b]), { obj });
  }
  if (obj instanceof PyTuple && !obj.__adderType__) return yield* _pkSaveTuple(st, obj);
  if (Array.isArray(obj) && !obj.__adderType__) {
    if (st.proto >= 1) o.op(0x5d); else o.ascii('(l');
    o.boundary();
    _pkMemoize(st, obj);
    return yield* _pkBatchAppends(st, obj);
  }
  if ((obj instanceof Map && !obj.__adderType__ && !obj.__adderClass__) || isPlainDict(obj)) {
    if (st.proto >= 1) o.op(0x7d); else o.ascii('(d');
    o.boundary();
    _pkMemoize(st, obj);
    return yield* _pkBatchSetitems(st, obj instanceof Map ? [...obj.entries()] : Object.entries(obj));
  }
  if (obj instanceof Set && !obj.__adderType__) {
    const items = [...obj];
    if (st.proto < 4) return yield* _pkSaveReduce(st, obj._frozen ? adderModules.builtins.frozenset : adderModules.builtins.set, mkTuple([items]), { obj });
    if (obj._frozen) {
      o.op(0x28); o.boundary();
      for (const x of items) yield* _pkSave(st, x);
      if (st.memo.has(obj)) { o.op(0x31); o.boundary(); return _pkGet(st, st.memo.get(obj)); }
      o.op(0x91); o.boundary();
      return _pkMemoize(st, obj);
    }
    o.op(0x8f); o.boundary();
    _pkMemoize(st, obj);
    for (let i = 0; i < items.length; i += 1000) {
      o.op(0x28); o.boundary();
      for (const x of items.slice(i, i + 1000)) yield* _pkSave(st, x);
      o.op(0x90); o.boundary();
    }
    return;
  }
  if (obj instanceof AdderRange) return yield* _pkSaveReduce(st, adderModules.builtins.range, mkTuple([obj.start, obj.stop, obj.step]), { obj });
  if (obj instanceof Complex) return yield* _pkSaveReduce(st, adderModules.builtins.complex, mkTuple([obj.real, obj.imag]), { obj });
  // classes and functions: by reference
  if (typeof obj === 'function') return _pkSaveGlobal(st, obj);
  // _collections' dict types (OrderedDict, defaultdict): their class + the items
  if (obj instanceof Map && obj.__adderClass__ && !obj.__adderType__) {
    const cls = adderModules._collections && adderModules._collections[obj.__adderClass__];
    if (!cls) throw new AdderError('PicklingError', `Can't pickle '${obj.__adderClass__}' object`);
    const factory = obj.__adderClass__ === 'defaultdict' ? (obj.default_factory ?? null) : undefined;
    return yield* _pkSaveReduce(st, cls, mkTuple(factory === undefined ? [] : [factory]), { dictitems: [...obj.entries()].map((e) => mkTuple(e)), obj });
  }
  // everything else: the reduce protocol
  const rv = yield* _pkReduceValue(st, obj);
  if (typeof rv === 'string') return _pkSaveGlobal(st, obj, rv);
  if (!(rv instanceof PyTuple) || rv.length < 2 || rv.length > 6) throw new AdderError('PicklingError', `${pyTypeName(obj)}.__reduce__ must return a string or a tuple of 2 to 6 items`);
  return yield* _pkSaveReduce(st, rv[0], rv[1], { state: rv[2], listitems: rv[3], dictitems: rv[4], stateSetter: rv[5], obj });
}

function* _pkSaveBytes(st, b) {
  const o = st.out;
  if (st.proto < 3) {
    if (!b.length) return yield* _pkSaveReduce(st, adderModules.builtins.bytes, mkTuple([]), { obj: b });
    return yield* _pkSaveReduce(st, _pkCodecsEncode, mkTuple([pyDecodePartial(b, 'latin-1', 'strict', true).text, 'latin1']), { obj: b });
  }
  if (b.length < 256) { o.op(0x43); o.u8(b.length); }
  else if (b.length > 0xffffffff && st.proto >= 4) { o.op(0x8e); o.u64(b.length); }
  else { o.op(0x42); o.u32(b.length); }
  o.bytes(b);
  o.boundary();
  _pkMemoize(st, b);
}

function* _pkSaveTuple(st, t) {
  const o = st.out;
  const n = t.length;
  if (n === 0) { if (st.proto >= 1) o.op(0x29); else o.ascii('(t'); return o.boundary(); }
  if (n <= 3 && st.proto >= 2) {
    for (const x of t) yield* _pkSave(st, x);
    if (st.memo.has(t)) { for (let i = 0; i < n; i++) o.op(0x30); o.boundary(); return _pkGet(st, st.memo.get(t)); }
    o.op([0x85, 0x86, 0x87][n - 1]); o.boundary();
    return _pkMemoize(st, t);
  }
  o.op(0x28); o.boundary();
  for (const x of t) yield* _pkSave(st, x);
  if (st.memo.has(t)) {
    if (st.proto >= 1) { o.op(0x31); o.boundary(); } else { for (let i = 0; i <= n; i++) o.op(0x30); o.boundary(); }
    return _pkGet(st, st.memo.get(t));
  }
  o.op(0x74); o.boundary();
  _pkMemoize(st, t);
}

function* _pkBatchAppends(st, items) {
  const o = st.out;
  const arr = Array.isArray(items) ? items : [...pyIter(items)];
  if (st.proto < 1) { for (const x of arr) { yield* _pkSave(st, x); o.op(0x61); o.boundary(); } return; }
  for (let i = 0; i < arr.length; i += 1000) {
    const chunk = arr.slice(i, i + 1000);
    if (chunk.length > 1) { o.op(0x28); o.boundary(); for (const x of chunk) yield* _pkSave(st, x); o.op(0x65); }
    else { yield* _pkSave(st, chunk[0]); o.op(0x61); }
    o.boundary();
  }
}
function* _pkBatchSetitems(st, entries) {
  const o = st.out;
  if (st.proto < 1) { for (const [k, v] of entries) { yield* _pkSave(st, k); yield* _pkSave(st, v); o.op(0x73); o.boundary(); } return; }
  for (let i = 0; i < entries.length; i += 1000) {
    const chunk = entries.slice(i, i + 1000);
    if (chunk.length > 1) { o.op(0x28); o.boundary(); for (const [k, v] of chunk) { yield* _pkSave(st, k); yield* _pkSave(st, v); } o.op(0x75); }
    else { yield* _pkSave(st, chunk[0][0]); yield* _pkSave(st, chunk[0][1]); o.op(0x73); }
    o.boundary();
  }
}

function _pkSaveGlobal(st, obj, name = null) {
  const o = st.out;
  let module = _pkModuleOf(obj);
  name = name || _pkNameOf(obj);
  if (!name) throw new AdderError('PicklingError', `Can't pickle ${pyRepr(obj)}: it has no name`);
  if (st.proto >= 4) {
    _pkSaveStr(st, module); _pkSaveStr(st, name);
    o.op(0x93); o.boundary();
  } else {
    if (st.proto < 3 && st.fixImports && module === 'builtins') module = '__builtin__';
    if (st.proto < 3 && st.fixImports && module === 'copyreg') module = 'copy_reg';
    o.op(0x63); o.bytes(_pkUtf8(`${module}\n${name}\n`)); o.boundary();
  }
  _pkMemoize(st, obj);
}

// the object's reduce value: copyreg's dispatch_table, then __reduce_ex__ / __reduce__ the class
// defines, then object's own (the default below)
function* _pkReduceValue(st, obj) {
  const t = typeOf(obj);
  const dt = st.dispatchTable || adderModules.copyreg.dispatch_table;
  if (dt && dt.has && dt.has(t)) return yield dt.get(t)(obj);
  const rex = _pkOwnFn(obj, '__reduce_ex__');
  if (rex) return yield rex.call(obj, st.proto);
  const r = _pkOwnFn(obj, '__reduce__');
  if (r) return yield r.call(obj);
  return yield* _pkObjectReduceEx(st, obj, t);
}
// object.__reduce_ex__(protocol), as copyreg writes it
function* _pkObjectReduceEx(st, obj, cls) {
  if (typeof obj === 'function' || !obj || !obj.__adderType__) throw new AdderError('TypeError', `cannot pickle '${pyTypeName(obj)}' object`);
  const state = yield* _pkGetState(obj);
  if (st.proto < 2) return mkTuple([adderModules.copyreg._reconstructor, mkTuple([cls, pyObjectObj, null]), state]);
  let args = mkTuple([]), kwargs = null;
  const gnx = _pkOwnFn(obj, '__getnewargs_ex__');
  if (gnx) { const r = yield gnx.call(obj); args = r[0]; kwargs = r[1]; }
  else { const gn = _pkOwnFn(obj, '__getnewargs__'); if (gn) args = yield gn.call(obj); }
  const listitems = Array.isArray(obj) ? obj.slice() : null;
  const dictitems = obj instanceof Map ? [...obj.entries()].map((e) => mkTuple(e)) : null;
  if (kwargs && (kwargs instanceof Map ? kwargs.size : Object.keys(kwargs).length)) {
    return mkTuple([adderModules.copyreg.__newobj_ex__, mkTuple([cls, args, kwargs]), state, listitems, dictitems]);
  }
  return mkTuple([adderModules.copyreg.__newobj__, mkTuple([cls, ...args]), state, listitems, dictitems]);
}
// __getstate__, or the instance's attributes (None when it has none)
function* _pkGetState(obj) {
  const gs = _pkOwnFn(obj, '__getstate__');
  if (gs) return yield gs.call(obj);
  const keys = Object.keys(obj).filter((k) => !k.startsWith('_py') && !['__adderClass__', '__adderType__', '__adderModule__', '__id__'].includes(k));
  if (!keys.length) return null;
  const d = new PyDict();
  for (const k of keys) d.set(k, obj[k]);
  return d;
}

function* _pkSaveReduce(st, func, args, { state = null, listitems = null, dictitems = null, stateSetter = null, obj = null } = {}) {
  const o = st.out;
  if (!(args instanceof PyTuple)) args = mkTuple([...pyIter(args)]);
  const fname = func && (func.__name__ || func._pyName);
  if (st.proto >= 2 && fname === '__newobj_ex__') {
    const [cls, a, kw] = args;
    yield* _pkSave(st, cls); yield* _pkSave(st, a); yield* _pkSave(st, kw);
    o.op(0x92); o.boundary();
  } else if (st.proto >= 2 && fname === '__newobj__') {
    const cls = args[0];
    yield* _pkSave(st, cls);
    yield* _pkSave(st, mkTuple(args.slice(1)));
    o.op(0x81); o.boundary();
  } else {
    yield* _pkSave(st, func);
    yield* _pkSave(st, args);
    o.op(0x52); o.boundary();
  }
  if (obj !== null) {
    if (st.memo.has(obj)) { o.op(0x30); o.boundary(); _pkGet(st, st.memo.get(obj)); }
    else _pkMemoize(st, obj);
  }
  if (listitems !== null && listitems !== undefined) yield* _pkBatchAppends(st, listitems);
  if (dictitems !== null && dictitems !== undefined) yield* _pkBatchSetitems(st, [...pyIter(dictitems)].map((p) => [p[0], p[1]]));
  if (state !== null && state !== undefined) {
    if (stateSetter === null || stateSetter === undefined) { yield* _pkSave(st, state); o.op(0x62); }
    else { yield* _pkSave(st, stateSetter); yield* _pkSave(st, obj); yield* _pkSave(st, state); o.op(0x86); o.op(0x52); o.op(0x30); }
    o.boundary();
  }
}

// the pickling engine: one dump (a Pickler's memo carries over to its next dump)
function* _pkDump(st, obj) {
  yield* _pkSave(st, obj);
  st.out.op(0x2e);
  st.out.boundary();
}
function _pkState(proto, opts = {}) {
  if (proto === null || proto === undefined) proto = _pkDEFAULT;
  if (proto < 0) proto = _pkHIGHEST;
  if (proto > _pkHIGHEST) throw new AdderError('ValueError', `pickle protocol must be <= ${_pkHIGHEST}`);
  return { out: new _PkOut(proto), proto, memo: opts.memo || new Map(), fixImports: opts.fixImports !== false, persistentId: opts.persistentId || null, dispatchTable: opts.dispatchTable || null };
}

// ── the unpickler ──
const _PK_FIX_MODULES = { __builtin__: 'builtins', copy_reg: 'copyreg', Queue: 'queue', SocketServer: 'socketserver', ConfigParser: 'configparser', repr: 'reprlib', _winreg: 'winreg', thread: '_thread', dummy_thread: '_dummy_thread', UserDict: 'collections', UserList: 'collections', UserString: 'collections', urlparse: 'urllib.parse', cPickle: 'pickle', StringIO: 'io', cStringIO: 'io' };
const _PK_FIX_NAMES = { 'builtins.xrange': ['builtins', 'range'], 'builtins.unicode': ['builtins', 'str'], 'builtins.basestring': ['builtins', 'str'], 'builtins.long': ['builtins', 'int'], 'builtins.reduce': ['functools', 'reduce'], 'builtins.intern': ['sys', 'intern'], 'builtins.unichr': ['builtins', 'chr'], 'itertools.izip': ['builtins', 'zip'], 'itertools.imap': ['builtins', 'map'], 'itertools.ifilter': ['builtins', 'filter'], 'collections.UserDict': ['collections', 'UserDict'] };

// the default find_class: import the module, walk the qualified name
function* _pkFindClass(st, module, name) {
  if (st.proto < 3 && st.fixImports) {
    const fixed = _PK_FIX_NAMES[`${_PK_FIX_MODULES[module] || module}.${name}`];
    if (fixed) [module, name] = fixed;
    else if (_PK_FIX_MODULES[module]) module = _PK_FIX_MODULES[module];
  }
  let obj;
  if (module === '__main__') {
    const first = name.split('.')[0];
    obj = mainClassLookup(first);
    if (obj === undefined) throw new AdderError('AttributeError', `Can't get attribute '${name}' on <module '__main__'>`);
    for (const part of name.split('.').slice(1)) obj = adderGetAttr(obj, part);
    return obj;
  }
  obj = module === 'builtins' ? adderModules.builtins : yield adderModules.importlib.import_module(module);
  for (const part of name.split('.')) {
    try { obj = adderGetAttr(obj, part); }
    catch (e) { throw new AdderError('AttributeError', `Can't get attribute '${name}' on <module '${module}'>`); }
  }
  return obj;
}

const _pkMark = Symbol('mark');
function* _pkLoad(st) {
  const data = st.data;
  let pos = st.pos;
  let stack = [];
  const meta = [];
  const memo = st.memo;
  const need = (k) => { if (pos + k > data.length) throw new AdderError('UnpicklingError', 'pickle data was truncated'); };
  const u8 = () => { need(1); return data[pos++]; };
  const u16 = () => { need(2); const v = data[pos] | (data[pos + 1] << 8); pos += 2; return v; };
  const u32 = () => { need(4); const v = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16)) + data[pos + 3] * 0x1000000; pos += 4; return v; };
  const i32 = () => { const v = u32(); return v > 0x7fffffff ? v - 0x100000000 : v; };
  const u64 = () => { need(8); let v = 0; for (let i = 7; i >= 0; i--) v = v * 256 + data[pos + i]; pos += 8; return v; };
  const take = (n) => { need(n); const b = data.slice(pos, pos + n); pos += n; return b; };
  const line = () => { const i = data.indexOf(0x0a, pos); if (i < 0) throw new AdderError('UnpicklingError', 'pickle exhausted before end of frame'); const s = pyDecodePartial(data.subarray(pos, i), 'latin-1', 'strict', true).text; pos = i + 1; return s; };
  const utf8 = (b) => pyDecodePartial(b, 'utf-8', 'surrogatepass', true).text;
  const popMark = () => { const items = stack; stack = meta.pop(); if (!stack) throw new AdderError('UnpicklingError', 'could not find MARK'); return items; };
  const top = () => { if (!stack.length) throw new AdderError('UnpicklingError', 'unpickling stack underflow'); return stack[stack.length - 1]; };
  const pop = () => { if (!stack.length) throw new AdderError('UnpicklingError', 'unpickling stack underflow'); return stack.pop(); };
  // a py2 str (STRING / BINSTRING): text in `encoding`, or bytes when encoding is 'bytes'
  const py2str = (b) => (st.encoding === 'bytes' ? b : pyDecodePartial(b, st.encoding, st.errors, true).text);
  const intLong = (b) => { if (!b.length) return 0; let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); if (b[b.length - 1] & 0x80) v -= 1n << BigInt(8 * b.length); return Number(v); };
  const newobj = function* (cls, args, kw) { const nw = adderGetAttr(cls, '__new__'); return yield (kw ? nw(cls, ...args, { _kw: true, ...kw }) : nw(cls, ...args)); };
  const findClass = (module, name) => (st.findClass ? st.findClass(module, name) : _pkFindClass(st, module, name));

  for (;;) {
    const op = u8();
    switch (op) {
      case 0x28: meta.push(stack); stack = []; break;                                   // MARK
      case 0x2e: st.pos = pos; return pop();                                            // STOP
      case 0x30: if (stack.length) stack.pop(); else popMark(); break;                  // POP
      case 0x31: popMark(); break;                                                      // POP_MARK
      case 0x32: stack.push(top()); break;                                              // DUP
      case 0x46: { const s = line(); stack.push(s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : parseFloat(s)); break; }   // FLOAT
      case 0x49: { const s = line(); stack.push(s === '00' ? false : s === '01' ? true : parseInt(s, 10)); break; }   // INT
      case 0x4a: stack.push(i32()); break;                                              // BININT
      case 0x4b: stack.push(u8()); break;                                               // BININT1
      case 0x4d: stack.push(u16()); break;                                              // BININT2
      case 0x4c: { const s = line().replace(/L$/, ''); stack.push(Number(BigInt(s))); break; }   // LONG
      case 0x50: { const pid = line(); stack.push(yield st.persistentLoad(pid)); break; }        // PERSID
      case 0x51: { const pid = pop(); stack.push(yield st.persistentLoad(pid)); break; }         // BINPERSID
      case 0x52: { const args = pop(); const fn = pop(); stack.push(yield fn(...args)); break; } // REDUCE
      case 0x53: {                                                                       // STRING
        const s = line();
        const q = s[0];
        if (s.length < 2 || (q !== '"' && q !== "'") || s[s.length - 1] !== q) throw new AdderError('UnpicklingError', 'the STRING opcode argument must be quoted');
        const raw = s.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/g, (m, e) => (e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16)) : /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v' })[e] ?? '\\' + e));
        stack.push(py2str(_pkLatin(raw)));
        break;
      }
      case 0x54: { const n = i32(); if (n < 0) throw new AdderError('UnpicklingError', 'BINSTRING pickle has negative byte count'); stack.push(py2str(take(n))); break; }
      case 0x55: stack.push(py2str(take(u8()))); break;                                 // SHORT_BINSTRING
      case 0x56: {                                                                      // UNICODE (raw-unicode-escape)
        stack.push(line().replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (m, a, b) => String.fromCodePoint(parseInt(a || b, 16))));
        break;
      }
      case 0x58: stack.push(utf8(take(u32()))); break;                                  // BINUNICODE
      case 0x8c: stack.push(utf8(take(u8()))); break;                                   // SHORT_BINUNICODE
      case 0x8d: stack.push(utf8(take(u64()))); break;                                  // BINUNICODE8
      case 0x43: stack.push(take(u8())); break;                                         // SHORT_BINBYTES
      case 0x42: stack.push(take(u32())); break;                                        // BINBYTES
      case 0x8e: stack.push(take(u64())); break;                                        // BINBYTES8
      case 0x96: { const b = take(u64()); const ba = new PyByteArray(); for (const x of b) ba.push(x); stack.push(ba); break; }   // BYTEARRAY8
      case 0x97: {                                                                      // NEXT_BUFFER
        const it = st.buffers;
        if (!it) throw new AdderError('UnpicklingError', 'pickle stream refers to out-of-band data but no *buffers* argument was given');
        const r = it.next(); if (r.done) throw new AdderError('UnpicklingError', 'not enough out-of-band buffers');
        stack.push(r.value); break;
      }
      case 0x98: break;                                                                 // READONLY_BUFFER
      case 0x47: { need(8); const dv = new DataView(data.buffer, data.byteOffset + pos, 8); stack.push(dv.getFloat64(0, false)); pos += 8; break; }   // BINFLOAT
      case 0x4e: stack.push(null); break;                                               // NONE
      case 0x88: stack.push(true); break;
      case 0x89: stack.push(false); break;
      case 0x8a: stack.push(intLong(take(u8()))); break;                                // LONG1
      case 0x8b: { const n = i32(); if (n < 0) throw new AdderError('UnpicklingError', 'LONG pickle has negative byte count'); stack.push(intLong(take(n))); break; }
      case 0x29: stack.push(mkTuple([])); break;                                        // EMPTY_TUPLE
      case 0x74: { const items = popMark(); stack.push(mkTuple(items)); break; }        // TUPLE
      case 0x85: stack.push(mkTuple([pop()])); break;                                   // TUPLE1
      case 0x86: { const b = pop(), a = pop(); stack.push(mkTuple([a, b])); break; }    // TUPLE2
      case 0x87: { const c = pop(), b = pop(), a = pop(); stack.push(mkTuple([a, b, c])); break; }
      case 0x5d: stack.push([]); break;                                                 // EMPTY_LIST
      case 0x6c: { const items = popMark(); stack.push(items); break; }                 // LIST
      case 0x7d: stack.push(new PyDict()); break;                                       // EMPTY_DICT
      case 0x64: { const items = popMark(); const d = new PyDict(); for (let i = 0; i < items.length; i += 2) d.set(items[i], items[i + 1]); stack.push(d); break; }   // DICT
      case 0x8f: stack.push(new PySet()); break;                                        // EMPTY_SET
      case 0x91: { const s = new PySet(popMark()); s._frozen = true; stack.push(s); break; }   // FROZENSET
      case 0x61: { const v = pop(); const l = top(); if (Array.isArray(l)) l.push(v); else yield adderGetAttr(l, 'append')(v); break; }   // APPEND
      case 0x65: {                                                                      // APPENDS
        const items = popMark(); const l = top();
        if (Array.isArray(l) && !l.__adderType__) l.push(...items);
        else { const ext = (() => { try { return adderGetAttr(l, 'extend'); } catch { return null; } })(); if (ext) yield ext(items); else for (const v of items) yield adderGetAttr(l, 'append')(v); }
        break;
      }
      case 0x73: { const v = pop(), k = pop(); yield _pkSetItem(top(), k, v); break; }    // SETITEM
      case 0x75: { const items = popMark(); const d = top(); for (let i = 0; i < items.length; i += 2) yield _pkSetItem(d, items[i], items[i + 1]); break; }   // SETITEMS
      case 0x90: { const items = popMark(); const s = top(); if (s instanceof Set) for (const x of items) s.add(x); else for (const x of items) yield adderGetAttr(s, 'add')(x); break; }   // ADDITEMS
      case 0x62: { const state = pop(); yield* _pkBuild(top(), state); break; }       // BUILD
      case 0x63: { const module = line(), name = line(); stack.push(yield* findClass(module, name)); break; }   // GLOBAL
      case 0x93: { const name = pop(), module = pop(); stack.push(yield* findClass(module, name)); break; }    // STACK_GLOBAL
      case 0x69: {                                                                      // INST
        const module = line(), name = line();
        const args = popMark();
        const cls = yield* findClass(module, name);
        stack.push(yield* _pkInstantiate(cls, args));
        break;
      }
      case 0x6f: { const args = popMark(); const cls = args.shift(); stack.push(yield* _pkInstantiate(cls, args)); break; }   // OBJ
      case 0x81: { const args = pop(); const cls = pop(); stack.push(yield* newobj(cls, [...args], null)); break; }   // NEWOBJ
      case 0x92: {                                                                      // NEWOBJ_EX
        const kw = pop(), args = pop(), cls = pop();
        stack.push(yield* newobj(cls, [...args], kw instanceof Map ? Object.fromEntries(kw) : kw)); break;
      }
      case 0x82: case 0x83: case 0x84: throw new AdderError('ValueError', 'unregistered extension code (copyreg extensions are not supported)');
      case 0x67: { const k = parseInt(line(), 10); if (!memo.has(k)) throw new AdderError('UnpicklingError', `Memo value not found at index ${k}`); stack.push(memo.get(k)); break; }   // GET
      case 0x68: { const k = u8(); if (!memo.has(k)) throw new AdderError('UnpicklingError', `Memo value not found at index ${k}`); stack.push(memo.get(k)); break; }   // BINGET
      case 0x6a: { const k = u32(); if (!memo.has(k)) throw new AdderError('UnpicklingError', `Memo value not found at index ${k}`); stack.push(memo.get(k)); break; }  // LONG_BINGET
      case 0x70: { const k = parseInt(line(), 10); if (k < 0) throw new AdderError('ValueError', 'negative PUT argument'); memo.set(k, top()); break; }   // PUT
      case 0x71: memo.set(u8(), top()); break;                                          // BINPUT
      case 0x72: memo.set(u32(), top()); break;                                         // LONG_BINPUT
      case 0x94: memo.set(memo.size, top()); break;                                     // MEMOIZE
      case 0x80: { const p = u8(); if (p > _pkHIGHEST) throw new AdderError('ValueError', `unsupported pickle protocol: ${p}`); st.proto = p; break; }   // PROTO
      case 0x95: u64(); break;                                                          // FRAME (transparent here)
      default: throw new AdderError('UnpicklingError', `invalid load key, ${pyRepr(String.fromCharCode(op))}.`);
    }
  }
}
function _pkSetItem(d, k, v) {
  if (d instanceof Map && !d.__adderType__) { d.set(k, v); return null; }
  if (isPlainDict(d)) { if (typeof k === 'string') d[k] = v; return null; }
  return adderGetAttr(d, '__setitem__')(k, v);
}
function* _pkInstantiate(cls, args) {
  if (args.length || _pkOwnFn(cls.prototype || {}, '__getinitargs__')) return yield cls(...args);
  return yield adderGetAttr(cls, '__new__')(cls);
}
// BUILD: __setstate__(state), or the state into the instance's attributes (a (dict, slots) pair too)
function* _pkBuild(inst, state) {
  const ss = _pkOwnFn(inst, '__setstate__');
  if (ss) { yield ss.call(inst, state); return; }
  let slots = null;
  if (state instanceof PyTuple && state.length === 2) { slots = state[1]; state = state[0]; }
  const each = (m, f) => { if (!m) return; if (m instanceof Map) for (const [k, v] of m) f(k, v); else for (const [k, v] of Object.entries(m)) f(k, v); };
  each(state, (k, v) => { inst[k] = v; });
  each(slots, (k, v) => { inst[k] = v; });
}

// ── module API ──
const _pkCodecsEncode = Object.assign((s, enc = 'utf-8', errors = 'strict') => pyEncode(s, enc, errors), { __name__: 'encode', _pyName: 'encode', __module__: '_codecs' });
if (!adderModules._codecs) adderModules._codecs = { __adderModule__: true, __name__: '_codecs', encode: _pkCodecsEncode, decode: (b, enc = 'utf-8', errors = 'strict') => pyDecodePartial(b, enc, errors, true).text };

const _pkToBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof PyByteArray || Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === 'string') throw new AdderError('TypeError', "a bytes-like object is required, not 'str'");
  throw new AdderError('TypeError', `a bytes-like object is required, not '${pyTypeName(data)}'`);
};

const _pkDumps = maybeSync(function* (obj, ...a) {
  const kw = _pkKw(a);
  const st = _pkState(a.length ? a[0] : kw.protocol, { fixImports: kw.fix_imports });
  yield* _pkDump(st, obj);
  return st.out.result();
});
// loads from bytes at `pos`; returns [value, end]
function* _pkLoadsAt(data, pos, opts = {}) {
  const st = { data, pos, memo: new Map(), proto: 0, encoding: opts.encoding || 'ASCII', errors: opts.errors || 'strict', fixImports: opts.fix_imports !== false,
    buffers: opts.buffers ? pyIter(opts.buffers)[Symbol.iterator]() : null, findClass: opts.findClass || null,
    persistentLoad: opts.persistentLoad || (() => { throw new AdderError('UnpicklingError', 'A load persistent id instruction was encountered, but no persistent_load function was specified.'); }) };
  const v = yield* _pkLoad(st);
  return [v, st.pos];
}
const _pkLoads = maybeSync(function* (data, ...a) {
  const kw = _pkKw(a);
  const [v] = yield* _pkLoadsAt(_pkToBytes(data), 0, kw);
  return v;
});
// a file: read it all, unpickle the first pickle, and leave the file just after it (so dump /
// dump / load / load works) when it can seek
function* _pkLoadFile(file, opts, findClass, persistentLoad) {
  const tell = (() => { try { return adderGetAttr(file, 'tell'); } catch { return null; } })();
  const start = tell ? yield tell() : 0;
  const data = _pkToBytes(yield adderGetAttr(file, 'read')());
  if (!data.length) throw new AdderError('EOFError', 'Ran out of input');
  const [v, end] = yield* _pkLoadsAt(data, 0, { ...opts, findClass, persistentLoad });
  if (end < data.length) { try { yield adderGetAttr(file, 'seek')(start + end); } catch { /* not seekable: the rest is consumed */ } }
  return v;
}

// a method a Python subclass defines (find_class, persistent_id, …) — found in its MRO before the
// pickle class itself: bound, else null
function _pkOverride(self, name, baseCls) {
  for (const c of (typeOf(self)._pyMRO || [])) {
    if (c === baseCls) return null;
    if (c.prototype && Object.hasOwn(c.prototype, name)) return adderGetAttr(self, name);
  }
  return null;
}

const _pkPicklerMembers = {
  __init__(self, file, ...a) {
    const kw = _pkKw(a);
    self._file = file;
    self._protocol = a.length ? a[0] : kw.protocol ?? null;
    self._fix = kw.fix_imports !== false;
    self._memo = new Map();
    self.bin = (self._protocol === null ? _pkDEFAULT : self._protocol) >= 1;
    self.fast = 0;
    return null;
  },
  dump: maybeSync(function* (self, obj) {
    const pid = _pkOverride(self, 'persistent_id', _pkPickler);
    const dt = (() => { try { const v = adderGetAttr(self, 'dispatch_table'); return v instanceof Map ? v : null; } catch { return null; } })();
    const st = _pkState(self._protocol, { memo: self._memo, fixImports: self._fix, persistentId: pid, dispatchTable: dt });
    yield* _pkDump(st, obj);
    yield adderGetAttr(self._file, 'write')(st.out.result());
    return null;
  }),
  clear_memo(self) { self._memo = new Map(); return null; },
};
const _pkUnpicklerMembers = {
  __init__(self, file, ...a) {
    const kw = _pkKw(a);
    self._file = file;
    self._opts = { encoding: kw.encoding || 'ASCII', errors: kw.errors || 'strict', fix_imports: kw.fix_imports !== false, buffers: kw.buffers };
    return null;
  },
  load: maybeSync(function* (self) {
    const fc = _pkOverride(self, 'find_class', _pkUnpickler);
    const pl = _pkOverride(self, 'persistent_load', _pkUnpickler);
    return yield* _pkLoadFile(self._file, self._opts, fc ? function* (m, n) { return yield fc(m, n); } : null, pl);
  }),
  find_class: maybeSync(function* (self, module, name) { return yield* _pkFindClass({ proto: 4, fixImports: true }, module, name); }),
  persistent_load(self, pid) { throw new AdderError('UnpicklingError', 'A load persistent id instruction was encountered, but no persistent_load function was specified.'); },
};
const _pkPickler = buildClass('Pickler', [], _pkPicklerMembers, []);
const _pkUnpickler = buildClass('Unpickler', [], _pkUnpicklerMembers, []);
_pkPickler.__module__ = 'pickle'; _pkUnpickler.__module__ = 'pickle';

adderModules.pickle = {
  __adderModule__: true, __name__: 'pickle',
  HIGHEST_PROTOCOL: _pkHIGHEST, DEFAULT_PROTOCOL: _pkDEFAULT, format_version: '5.0',
  compatible_formats: ['1.0', '1.1', '1.2', '1.3', '2.0', '3.0', '4.0', '5.0'],
  PickleError: _pkPickleError, PicklingError: _pkPicklingError, UnpicklingError: _pkUnpicklingError,
  dumps: _pkDumps, loads: _pkLoads,
  dump: maybeSync(function* (obj, file, ...a) {
    const kw = _pkKw(a);
    const st = _pkState(a.length ? a[0] : kw.protocol, { fixImports: kw.fix_imports });
    yield* _pkDump(st, obj);
    yield adderGetAttr(file, 'write')(st.out.result());
    return null;
  }),
  load: maybeSync(function* (file, ...a) { return yield* _pkLoadFile(file, _pkKw(a), null, null); }),
  Pickler: _pkPickler, Unpickler: _pkUnpickler,
  PickleBuffer: Object.assign((b) => b, { _pyName: 'PickleBuffer', __name__: 'PickleBuffer' }),
};
// cPickle is pickle (py2 code imports it), and _pickle the accelerator CPython would have
adderModules._pickle = adderModules.pickle;

// copyreg's half of the protocol: what default reduce values name
{
  const cr = adderModules.copyreg;
  const nw = (cls, ...a) => adderGetAttr(cls, '__new__')(cls, ...a);
  cr.__newobj__ = Object.assign(nw, { __name__: '__newobj__', _pyName: '__newobj__', __module__: 'copyreg' });
  cr.__newobj_ex__ = Object.assign((cls, args, kw) => adderGetAttr(cls, '__new__')(cls, ...pyIter(args), { _kw: true, ...(kw instanceof Map ? Object.fromEntries(kw) : kw || {}) }), { __name__: '__newobj_ex__', _pyName: '__newobj_ex__', __module__: 'copyreg' });
  cr._reconstructor = Object.assign((cls, base, state) => {
    if (base === pyObjectObj || base === null || base === undefined) return objectNew(cls);
    return adderGetAttr(base, '__new__')(cls, state);
  }, { __name__: '_reconstructor', _pyName: '_reconstructor', __module__: 'copyreg' });
  cr.__reduce_ex__ = (self, proto) => maybeSync(_pkObjectReduceEx)({ proto }, self, typeOf(self));
}
