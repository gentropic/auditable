// adder stdlib — _json: the accelerator under CPython's own json package (pylib/json, verbatim),
// as Modules/_json.c is under CPython's: scanstring, make_scanner, encode_basestring(_ascii) and
// make_encoder, behaving as json/decoder.py's and json/encoder.py's Python versions do — the same
// results, the same errors at the same positions (json.decoder.JSONDecodeError) — at JS speed.
//
// Concat-bundled with the rest of adder: top-level names carry a `_jn` prefix.

import {
  AdderError, PyDict, PyTuple, adderGetAttr, adderModules, asCallable, excToThrowable, isPlainDict, maybeSync, mkTuple, plainObjectKey,
  pyRepr, pySorted, pyTypeName, stopIteration, syncOf,
} from './builtins.js';

// A decoding error is thrown as this, and made the Python exception — json.decoder.JSONDecodeError
// (msg, doc, pos) — where the scan returns to Python (constructing it may have to wait, on the
// tree-walker). json.decoder imports this module, so it is loaded by the time anything decodes.
class _JnFail { constructor(msg, doc, pos) { this.msg = msg; this.doc = doc; this.pos = pos; } }
const _jnError = (msg, doc, pos) => new _JnFail(msg, doc, pos);
function* _jnPyError(f) {
  const mods = adderModules.sys && adderModules.sys.modules;
  const dec = mods && (mods instanceof Map ? mods.get('json.decoder') : mods['json.decoder']);
  const cls = dec && adderGetAttr(dec, 'JSONDecodeError');
  if (typeof cls !== 'function') return new AdderError('ValueError', `${f.msg}: char ${f.pos}`);
  const inst = yield syncOf(cls)(f.msg, f.doc, f.pos);
  return excToThrowable(inst);
}
// run a scan; a _JnFail out of it becomes the JSONDecodeError
function* _jnRun(gen) {
  try { return yield* gen; } catch (e) { if (e instanceof _JnFail) throw yield* _jnPyError(e); throw e; }
}
const _jnStr = (s) => (typeof s === 'string' ? s : s !== null && typeof s === 'object' && typeof s._pyStrValue === 'string' ? s._pyStrValue : null);
const _JN_WS = ' \t\n\r';
const _jnSkipWs = (s, i) => { while (i < s.length && _JN_WS.includes(s[i])) i++; return i; };
const _JN_BACKSLASH = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

// scanstring(s, end, strict=True) -> (str, end): the JSON string whose opening quote is at end - 1
function _jnScanString(s, end, strict = true) {
  const begin = end - 1;
  let out = '', chunkStart = end;
  for (;;) {
    let i = chunkStart;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 34 || c === 92 || c < 0x20) break;
      i++;
    }
    if (i >= s.length) throw _jnError('Unterminated string starting at', s, begin);
    out += s.slice(chunkStart, i);
    const term = s[i];
    end = i + 1;
    if (term === '"') break;
    if (term !== '\\') {
      if (strict) throw _jnError('Invalid control character at', s, i);
      out += term;
      chunkStart = end;
      continue;
    }
    if (end >= s.length) throw _jnError('Unterminated string starting at', s, begin);
    const esc = s[end];
    if (esc !== 'u') {
      const ch = _JN_BACKSLASH[esc];
      if (ch === undefined) throw _jnError('Invalid \\escape', s, end - 1);
      out += ch;
      end += 1;
    } else {
      let uni = _jnHex4(s, end);
      end += 5;
      if (uni >= 0xd800 && uni <= 0xdbff && s.slice(end, end + 2) === '\\u') {
        const uni2 = _jnHex4(s, end + 1);
        if (uni2 >= 0xdc00 && uni2 <= 0xdfff) {
          uni = 0x10000 + (((uni - 0xd800) << 10) | (uni2 - 0xdc00));
          end += 6;
        }
      }
      out += String.fromCodePoint(uni);
    }
    chunkStart = end;
  }
  return [out, end];
}
function _jnHex4(s, pos) {
  const h = s.slice(pos + 1, pos + 5);
  if (h.length === 4 && /^[0-9A-Fa-f]{4}$/.test(h)) return parseInt(h, 16);
  throw _jnError('Invalid \\uXXXX escape', s, pos);
}
const scanstring = maybeSync(function* (s, end, strict = true) {
  const str = _jnStr(s);
  if (str === null) throw new AdderError('TypeError', `first argument must be a string, not ${pyTypeName(s)}`);
  if (typeof end !== 'number' || !Number.isInteger(end)) throw new AdderError('TypeError', `'${pyTypeName(end)}' object cannot be interpreted as an integer`);
  if (end < 0 || end > str.length) throw new AdderError('ValueError', 'end is out of bounds');
  const [v, e] = yield* _jnRun((function* () { return _jnScanString(str, end, strict === undefined || strict === null ? true : !!strict); })());
  return mkTuple([v, e]);
});

const _JN_NUMBER = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

// make_scanner(context) -> scan_once(string, idx): (value, end), or StopIteration(idx) when no value
// starts at idx — json/scanner.py's py_make_scanner with decoder.py's JSONObject / JSONArray
function make_scanner(context) {
  const get = (n) => adderGetAttr(context, n);
  const strict = !!get('strict');
  const objectHook = get('object_hook'), pairsHook = get('object_pairs_hook');
  const parseFloat_ = get('parse_float'), parseInt_ = get('parse_int'), parseConstant = get('parse_constant');
  const B = adderModules.builtins;
  const floatFast = parseFloat_ === B.float, intFast = parseInt_ === B.int;
  // a hook, through its sync twin; its answer may be a Promise (a tree-walked function): yielded
  const call = (f, ...a) => syncOf(asCallable(f))(...a);
  const limit = 1000;
  let depth = 0;
  const deeper = (what) => {
    if (++depth > limit) { depth = 0; throw new AdderError('RecursionError', `maximum recursion depth exceeded while decoding a JSON ${what} from a unicode string`); }
  };
  const scan = function* (s, idx) {
    if (idx >= s.length) throw stopIteration(idx);
    const c = s[idx];
    switch (c) {
      case '"': return _jnScanString(s, idx + 1, strict);
      case '{': deeper('object'); try { return yield* parseObject(s, idx + 1); } finally { depth--; }
      case '[': deeper('array'); try { return yield* parseArray(s, idx + 1); } finally { depth--; }
      case 'n': if (s.startsWith('null', idx)) return [null, idx + 4]; break;
      case 't': if (s.startsWith('true', idx)) return [true, idx + 4]; break;
      case 'f': if (s.startsWith('false', idx)) return [false, idx + 5]; break;
      case 'N': if (s.startsWith('NaN', idx)) return [yield call(parseConstant, 'NaN'), idx + 3]; break;
      case 'I': if (s.startsWith('Infinity', idx)) return [yield call(parseConstant, 'Infinity'), idx + 8]; break;
      default: break;
    }
    _JN_NUMBER.lastIndex = idx;
    const m = _JN_NUMBER.exec(s);
    if (m) {
      const [txt, integer, frac, exp] = m;
      let v;
      if (frac || exp) v = floatFast ? Number(txt) : yield call(parseFloat_, txt);
      else if (intFast) { const n = Number(integer); v = Number.isSafeInteger(n) && !Object.is(n, -0) ? n : call(parseInt_, integer); }
      else v = yield call(parseInt_, integer);
      return [v, idx + txt.length];
    }
    if (c === '-' && s.startsWith('-Infinity', idx)) return [yield call(parseConstant, '-Infinity'), idx + 9];
    throw stopIteration(idx);
  };
  // a string, a literal or a number the defaults decode — synchronously; null for anything else
  const scalarAt = (s, idx) => {
    const c = s[idx];
    if (c === '"') return _jnScanString(s, idx + 1, strict);
    if (c === 'n' && s.startsWith('null', idx)) return [null, idx + 4];
    if (c === 't' && s.startsWith('true', idx)) return [true, idx + 4];
    if (c === 'f' && s.startsWith('false', idx)) return [false, idx + 5];
    if ((c >= '0' && c <= '9') || c === '-') {
      _JN_NUMBER.lastIndex = idx;
      const m = _JN_NUMBER.exec(s);
      if (!m) return null;
      if (m[2] || m[3]) return floatFast ? [Number(m[0]), idx + m[0].length] : null;
      if (!intFast) return null;
      const n = Number(m[1]);
      return Number.isSafeInteger(n) && !Object.is(n, -0) ? [n, idx + m[0].length] : null;
    }
    return null;
  };
  const valueAt = function* (s, end) {
    const sc = scalarAt(s, end);
    if (sc !== null) return sc;
    try { return yield* scan(s, end); } catch (e) {
      if (e && e.pyType === 'StopIteration') throw _jnError('Expecting value', s, e.value !== undefined ? e.value : end);
      throw e;
    }
  };
  const finishObject = function* (pairs) {
    if (pairsHook !== null && pairsHook !== undefined) return yield call(pairsHook, pairs.map((p) => mkTuple(p)));
    let d;
    if (pairs.every(([k]) => plainObjectKey(k))) { d = {}; for (const [k, v] of pairs) d[k] = v; }
    else { d = new PyDict(); for (const [k, v] of pairs) d.set(k, v); }
    return objectHook !== null && objectHook !== undefined ? yield call(objectHook, d) : d;
  };
  const parseObject = function* (s, end) {
    const pairs = [];
    let next = s[end];
    if (next !== '"') {
      if (next !== undefined && _JN_WS.includes(next)) { end = _jnSkipWs(s, end); next = s[end]; }
      if (next === '}') return [yield* finishObject(pairs), end + 1];
      if (next !== '"') throw _jnError('Expecting property name enclosed in double quotes', s, end);
    }
    end += 1;
    for (;;) {
      let key;
      [key, end] = _jnScanString(s, end, strict);
      if (s[end] !== ':') {
        end = _jnSkipWs(s, end);
        if (s[end] !== ':') throw _jnError("Expecting ':' delimiter", s, end);
      }
      end = _jnSkipWs(s, end + 1);
      let value;
      [value, end] = yield* valueAt(s, end);
      pairs.push([key, value]);
      end = _jnSkipWs(s, end);
      next = end < s.length ? s[end] : '';
      end += 1;
      if (next === '}') break;
      if (next !== ',') throw _jnError("Expecting ',' delimiter", s, end - 1);
      const comma = end - 1;
      end = _jnSkipWs(s, end);
      next = end < s.length ? s[end] : '';
      end += 1;
      if (next !== '"') {
        if (next === '}') throw _jnError('Illegal trailing comma before end of object', s, comma);
        throw _jnError('Expecting property name enclosed in double quotes', s, end - 1);
      }
    }
    return [yield* finishObject(pairs), end];
  };
  const parseArray = function* (s, end) {
    const values = [];
    end = _jnSkipWs(s, end);
    if (s[end] === ']') return [values, end + 1];
    for (;;) {
      let value;
      [value, end] = yield* valueAt(s, end);
      values.push(value);
      end = _jnSkipWs(s, end);
      const next = end < s.length ? s[end] : '';
      end += 1;
      if (next === ']') break;
      if (next !== ',') throw _jnError("Expecting ',' delimiter", s, end - 1);
      const comma = end - 1;
      end = _jnSkipWs(s, end);
      if (s[end] === ']') throw _jnError('Illegal trailing comma before end of array', s, comma);
    }
    return [values, end];
  };
  const plain = strict && floatFast && intFast && (objectHook === null || objectHook === undefined) && (pairsHook === null || pairsHook === undefined);
  const scanOnce = maybeSync(function* (string, idx) {
    const s = _jnStr(string);
    if (s === null) throw new AdderError('TypeError', `first argument must be a string, not ${pyTypeName(string)}`);
    if (idx < 0) throw new AdderError('ValueError', 'idx cannot be negative');
    if (plain && idx < s.length && (s[idx] === '{' || s[idx] === '[')) { const r = _jnFast(s, idx); if (r) return r; }
    depth = 0;
    const [v, end] = yield* _jnRun(scan(s, idx));
    return mkTuple([v, end]);
  });
  scanOnce._pyName = 'scan_once';
  return scanOnce;
}

// The whole rest of a document by JSON.parse, at native speed — used only when the result is
// exactly what the scanner would make: it must parse (an error, extra data, NaN / Infinity go to
// the scanner for CPython's messages and values), and nothing in it may differ: no key a JS object
// can't hold as given (integer-like keys reorder, __proto__, dunders → PyDict), no integer past
// 2**53 or -0 (Python decodes them exactly), no nesting past the recursion limit. → (value, end), or null.
function _jnFast(s, idx) {
  let v;
  try { v = JSON.parse(idx === 0 ? s : s.slice(idx)); } catch { return null; }
  const ok = (x, d) => {
    if (typeof x === 'number') return !Object.is(x, -0) && (!Number.isInteger(x) || Number.isSafeInteger(x));
    if (x === null || typeof x !== 'object') return true;
    if (d > 1000) return false;
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (!ok(x[i], d + 1)) return false; return true; }
    for (const k in x) if (!plainObjectKey(k) || !ok(x[k], d + 1)) return false;
    return true;
  };
  if (!ok(v, 0)) return null;
  let end = s.length;
  while (end > idx && _JN_WS.includes(s[end - 1])) end--;
  return mkTuple([v, end]);
}

// encode_basestring / encode_basestring_ascii: a str as a JSON string literal
const _JN_ESC = { '\\': '\\\\', '"': '\\"', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const _jnHex = (n) => '\\u' + n.toString(16).padStart(4, '0');
const _JN_PLAIN_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/, _JN_PLAIN = /^[^\x00-\x1f\x22\x5c]*$/;
function _jnEncode(s, ascii) {
  // (nothing to escape — the common case — is the string in quotes)
  if ((ascii ? _JN_PLAIN_ASCII : _JN_PLAIN).test(s)) return '"' + s + '"';
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e && ch !== '\\' && ch !== '"') { out += ch; continue; }
    if (Object.hasOwn(_JN_ESC, ch)) { out += _JN_ESC[ch]; continue; }
    if (c < 0x20 || (ascii && c > 0x7e)) { out += _jnHex(c); continue; }   // (a surrogate pair is two code units: two escapes)
    out += ch;
  }
  return out + '"';
}
const encode_basestring = (s) => {
  const str = _jnStr(s);
  if (str === null) throw new AdderError('TypeError', `first argument must be a string, not ${pyTypeName(s)}`);
  return _jnEncode(str, false);
};
const encode_basestring_ascii = (s) => {
  const str = _jnStr(s);
  if (str === null) throw new AdderError('TypeError', `first argument must be a string, not ${pyTypeName(s)}`);
  return _jnEncode(str, true);
};

// make_encoder(markers, default, encoder, indent, key_separator, item_separator, sort_keys,
// skipkeys, allow_nan) -> encode(obj, _current_indent_level): json/encoder.py's _make_iterencode,
// all at once (a 1-tuple of the text). Plain recursion: a hook (default=, a custom str encoder) that
// answers with a Promise (a tree-walked function) is waited for, its answer kept for that value,
// and the encoding run again — each value's hook is waited for once.
class _JnWait { constructor(key, kind, p) { this.key = key; this.kind = kind; this.p = p; } }
function make_encoder(markers, dflt, encoder, indent, keySep, itemSep, sortKeys, skipKeys, allowNan) {
  const B = adderModules.builtins;
  const encSync = encoder === encode_basestring || encoder === encode_basestring_ascii;
  const ascii = encoder === encode_basestring_ascii;
  const floatStr = (x) => {
    if (x !== x || x === Infinity || x === -Infinity) {
      const text = x !== x ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity';
      if (!allowNan) throw new AdderError('ValueError', `Out of range float values are not JSON compliant: ${pyRepr(x)}`);
      return text;
    }
    return pyRepr(x);
  };
  const isInt = (v) => B.isinstance(v, B.int);
  const isFloat = (v) => B.isinstance(v, B.float);
  // an int / float subclass instance (an IntEnum member) as its value — only a Python object can be one
  const numberish = (v) => {
    if (v !== null && typeof v === 'object' && v.__adderType__ !== undefined && !Array.isArray(v) && !(v instanceof Map)) {
      if (isInt(v)) return String(B.int(v));
      if (isFloat(v)) return floatStr(B.float(v));
    }
    return undefined;
  };
  const isList = (v) => Array.isArray(v) && v._pyView === undefined &&
    (v.__adderType__ === undefined || B.isinstance(v, B.list) || B.isinstance(v, B.tuple));
  const isDict = (v) => (v instanceof Map && v.__adderType__ === undefined) || isPlainDict(v) ||
    (v !== null && typeof v === 'object' && v.__adderType__ !== undefined && !Array.isArray(v) && B.isinstance(v, B.dict));
  const ind = indent === null || indent === undefined ? null : _jnStr(indent) ?? String(indent);

  const run = (o, level, cache) => {
    let out = '';
    const seen = markers === null || markers === undefined ? null : new Set();
    const hook = (kind, f, x) => {
      const key = kind === 'str' ? 's:' + x : x;
      if (cache.has(key)) return cache.get(key);
      const r = syncOf(asCallable(f))(x);
      if (r !== null && r !== undefined && typeof r.then === 'function') throw new _JnWait(key, kind, r);
      return r;
    };
    const str = (t) => (encSync ? _jnEncode(t, ascii) : hook('str', encoder, t));
    const value = (v, lvl) => {
      if (typeof v === 'string') { out += str(v); return; }
      if (typeof v === 'number') { out += Number.isInteger(v) ? String(v) : floatStr(v); return; }
      if (v === null || v === undefined) { out += 'null'; return; }
      if (v === true) { out += 'true'; return; }
      if (v === false) { out += 'false'; return; }
      if (typeof v === 'bigint') { out += String(v); return; }
      const t = _jnStr(v);
      if (t !== null) { out += str(t); return; }
      const nb = numberish(v);
      if (nb !== undefined) { out += nb; return; }
      if (isList(v)) { list(v, lvl); return; }
      if (isDict(v)) { dict(v, lvl); return; }
      if (seen) { if (seen.has(v)) throw new AdderError('ValueError', 'Circular reference detected'); seen.add(v); }
      value(hook('default', dflt, v), lvl);
      if (seen) seen.delete(v);
    };
    const list = (lst, lvl) => {
      if (!lst.length) { out += '[]'; return; }
      if (seen) { if (seen.has(lst)) throw new AdderError('ValueError', 'Circular reference detected'); seen.add(lst); }
      out += '[';
      let sep = itemSep, nl = null;
      if (ind !== null) { lvl += 1; nl = '\n' + ind.repeat(lvl); sep = itemSep + nl; out += nl; }
      for (let i = 0; i < lst.length; i++) { if (i) out += sep; value(lst[i], lvl); }
      if (nl !== null) { lvl -= 1; out += '\n' + ind.repeat(lvl); }
      out += ']';
      if (seen) seen.delete(lst);
    };
    const dict = (d, lvl) => {
      const plainObj = !(d instanceof Map);
      const keys = plainObj ? Object.keys(d) : null;
      if (plainObj ? !keys.length : !d.size) { out += '{}'; return; }
      let items = null;
      if (sortKeys || !plainObj) {
        items = plainObj ? keys.map((k) => [k, d[k]]) : [...d.entries()];
        if (sortKeys) {
          // all-str keys sort as JS strings do — the same order as Python's, unless a surrogate
          // pair is involved (JS compares UTF-16 units, Python code points)
          if (items.every(([k]) => typeof k === 'string' && !/[\ud800-\udfff]/.test(k))) items.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
          else items = pySorted(items.map((pr) => mkTuple(pr)));
        }
      }
      if (seen) { if (seen.has(d)) throw new AdderError('ValueError', 'Circular reference detected'); seen.add(d); }
      out += '{';
      let sep = itemSep, nl = null;
      if (ind !== null) { lvl += 1; nl = '\n' + ind.repeat(lvl); sep = itemSep + nl; }
      let first = true;
      const n = items ? items.length : keys.length;
      for (let i = 0; i < n; i++) {
        const k0 = items ? items[i][0] : keys[i], v = items ? items[i][1] : d[k0];
        let k = k0;
        const ks = _jnStr(k);
        if (ks !== null) k = ks;
        else if (typeof k === 'number' && !Number.isInteger(k)) k = floatStr(k);
        else if (k === true) k = 'true';
        else if (k === false) k = 'false';
        else if (k === null || k === undefined) k = 'null';
        else if (typeof k === 'number' || typeof k === 'bigint') k = String(k);
        else if (k !== null && typeof k === 'object' && isInt(k)) k = String(B.int(k));
        else if (k !== null && typeof k === 'object' && isFloat(k)) k = floatStr(B.float(k));
        else if (skipKeys) continue;
        else throw new AdderError('TypeError', `keys must be str, int, float, bool or None, not ${pyTypeName(k0)}`);
        if (first) { first = false; if (nl !== null) out += nl; } else out += sep;
        out += str(k) + keySep;
        value(v, lvl);
      }
      if (!first && nl !== null) { lvl -= 1; out += '\n' + ind.repeat(lvl); }
      out += '}';
      if (seen) seen.delete(d);
    };
    value(o, level);
    return mkTuple([out]);
  };
  const encodeObj = (o, level = 0) => {
    const cache = new Map();
    const attempt = () => {
      try { return run(o, Number(level) || 0, cache); } catch (e) {
        if (e instanceof _JnWait) return e.p.then((v) => { cache.set(e.key, v); return attempt(); });
        throw e;
      }
    };
    return attempt();
  };
  encodeObj._pyName = 'make_encoder';
  return encodeObj;
}

const _jnModule = { __name__: '_json', scanstring, make_scanner, encode_basestring, encode_basestring_ascii, make_encoder };
for (const [k, v] of Object.entries(_jnModule)) {
  if (typeof v === 'function') { Object.defineProperty(v, 'name', { value: k }); v._pyName = k; v.__module__ = '_json'; }
}
adderModules._json = _jnModule;
