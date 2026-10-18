// adder stdlib — array: CPython's Modules/arraymodule.c. An array is a typed buffer that grows (a JS
// ArrayBuffer, capacity doubling): what memoryview(a), bytes(a) and a file's write(a) see, and while
// a buffer is exported (an unreleased memoryview) resizing the array is a BufferError, as CPython's.
// The item sizes are an LP64 machine's: 'l' / 'L' are 8 bytes; 'u' and 'w' are 4 (UCS-4).
//
// Concat-bundled with the rest of adder: top-level names carry an `_ar` prefix.

import {
  AdderError, PyByteArray, PyMemoryView, PyTuple, adderGetAttr, adderModules, mkTuple, objectNew, pyCollectMaybe, pyEq,
  pyLt, pyRepr, pyTypeName, syncOf,
} from './builtins.js';

// typecode → item size, typed array, range and the name CPython's overflow message uses
const _AR_CODES = {
  b: { size: 1, T: Int8Array, min: -128, max: 127, name: 'signed char' },
  B: { size: 1, T: Uint8Array, min: 0, max: 255, name: 'unsigned byte integer' },
  u: { size: 4, T: Uint32Array, uni: true },
  w: { size: 4, T: Uint32Array, uni: true },
  h: { size: 2, T: Int16Array, min: -32768, max: 32767, name: 'signed short integer' },
  H: { size: 2, T: Uint16Array, min: 0, max: 65535, name: 'unsigned short' },
  i: { size: 4, T: Int32Array, min: -2147483648, max: 2147483647, name: 'signed integer' },
  I: { size: 4, T: Uint32Array, min: 0, max: 4294967295, name: 'unsigned int' },
  l: { size: 8, T: BigInt64Array, big: true, min: -(2n ** 63n), max: 2n ** 63n - 1n, name: 'signed long' },
  L: { size: 8, T: BigUint64Array, big: true, min: 0n, max: 2n ** 64n - 1n, name: 'unsigned long' },
  q: { size: 8, T: BigInt64Array, big: true, min: -(2n ** 63n), max: 2n ** 63n - 1n, name: 'signed long long' },
  Q: { size: 8, T: BigUint64Array, big: true, min: 0n, max: 2n ** 64n - 1n, name: 'unsigned long long' },
  f: { size: 4, T: Float32Array, flt: true },
  d: { size: 8, T: Float64Array, flt: true },
};
const _AR_TYPECODES = 'bBuwhHiIlLqQfd';
const _AR_BAD_TYPECODE = 'bad typecode (must be b, B, u, w, h, H, i, I, l, L, q, Q, f or d)';
const _arIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _arBigOut = (b) => (b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b);
const _arKw = (a) => (a.length && a[a.length - 1] !== null && typeof a[a.length - 1] === 'object' && a[a.length - 1]._kw === true ? a.pop() : null);
function _arArgs(name, a, min, max) {
  const kw = _arKw(a);
  if (kw && Object.keys(kw).some((k) => k !== '_kw')) throw new AdderError('TypeError', `array.${name}() takes no keyword arguments`);
  if (a.length < min || a.length > max) {
    if (max === 0) throw new AdderError('TypeError', `array.${name}() takes no arguments (${a.length} given)`);
    if (min === max) throw new AdderError('TypeError', `array.${name}() takes exactly one argument (${a.length} given)`);
    throw new AdderError('TypeError', `${name} expected at ${a.length < min ? 'least' : 'most'} ${a.length < min ? min : max} argument${(a.length < min ? min : max) > 1 ? 's' : ''}, got ${a.length}`);
  }
}
// an index: an int, or __index__
function _arIndex(v, what = 'array indices must be integers') {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'bigint') return Number(v);
  if (v !== null && typeof v === 'object' && typeof v.__index__ === 'function') {
    const r = syncOf(v.__index__).call(v);
    if (typeof r === 'number' || typeof r === 'bigint' || typeof r === 'boolean') return Number(r);
    throw new AdderError('TypeError', `__index__ returned non-int (type ${pyTypeName(r)})`);
  }
  throw new AdderError('TypeError', what === null ? `'${pyTypeName(v)}' object cannot be interpreted as an integer` : what);
}
// a slice against a length: [start, stop, step, count], as PySlice_AdjustIndices
function _arSlice(k, n) {
  const big = (v) => (typeof v === 'bigint' ? (v > 0n ? Infinity : -Infinity) : v);
  let step = k.step === null || k.step === undefined ? 1 : big(_arIdxBig(k.step));
  if (step === 0) throw new AdderError('ValueError', 'slice step cannot be zero');
  const def = (v, d) => (v === null || v === undefined ? d : big(_arIdxBig(v)));
  let start = def(k.lower, step < 0 ? Infinity : 0), stop = def(k.upper, step < 0 ? -Infinity : Infinity);
  const adj = (x) => {
    if (x < 0) { x += n; if (x < 0) x = step < 0 ? -1 : 0; }
    else if (x >= n) x = step < 0 ? n - 1 : n;
    return x;
  };
  start = adj(start); stop = adj(stop);
  let count = 0;
  if (step < 0) { if (stop < start) count = Math.floor((start - stop - 1) / -step) + 1; }
  else if (start < stop) count = Math.floor((stop - start - 1) / step) + 1;
  if (!Number.isFinite(step)) step = step > 0 ? n + 1 : -(n + 1);
  return [start, stop, step, count];
}
// a slice bound may be a big int (1 << 333): kept as a BigInt, the slice code saturates it
function _arIdxBig(v) {
  if (typeof v === 'bigint') return v;
  return _arIndex(v, 'slice indices must be integers or None or have an __index__ method');
}

// a value for an item of `code` (as the typed array stores it), or a CPython error
function _arItem(code, v) {
  const c = _AR_CODES[code];
  if (c.uni) {
    if (typeof v !== 'string' && !(v !== null && typeof v === 'object' && typeof v._pyStrValue === 'string')) throw new AdderError('TypeError', `array item must be a unicode character, not ${pyTypeName(v)}`);
    const s = typeof v === 'string' ? v : v._pyStrValue;
    const cp = s.codePointAt(0);
    if (s.length === 0 || [...s].length !== 1) throw new AdderError('TypeError', `array item must be a unicode character, not a string of length ${[...s].length}`);
    return cp;
  }
  if (c.flt) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return +v;
    if (typeof v === 'bigint') { const n = Number(v); if (!Number.isFinite(n)) throw new AdderError('OverflowError', 'int too large to convert to float'); return n; }
    if (v !== null && typeof v === 'object') {
      for (const m of ['__float__', '__index__']) if (typeof v[m] === 'function') return Number(syncOf(v[m]).call(v));
    }
    throw new AdderError('TypeError', `must be real number, not ${pyTypeName(v)}`);
  }
  let n;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new AdderError('TypeError', `'float' object cannot be interpreted as an integer`);
    n = v;
  } else if (typeof v === 'boolean') n = +v;
  else if (typeof v === 'bigint') n = v;
  else if (v !== null && typeof v === 'object' && typeof v.__index__ === 'function') n = _arIndexBig(v);
  else throw new AdderError('TypeError', `'${pyTypeName(v)}' object cannot be interpreted as an integer`);
  if (c.big) {
    const b = BigInt(n);
    if (b < c.min || b > c.max) throw _arOverflow(c, b < c.min);
    return b;
  }
  if (typeof n === 'bigint') { if (n < BigInt(c.min) || n > BigInt(c.max)) throw _arOverflow(c, n < BigInt(c.min)); return Number(n); }
  if (n < c.min || n > c.max) throw _arOverflow(c, n < c.min);
  return n;
}
function _arIndexBig(v) {
  const r = syncOf(v.__index__).call(v);
  if (typeof r === 'number' || typeof r === 'bigint' || typeof r === 'boolean') return typeof r === 'boolean' ? +r : r;
  throw new AdderError('TypeError', `__index__ returned non-int (type ${pyTypeName(r)})`);
}
const _arOverflow = (c, low) => new AdderError('OverflowError', c.big
  ? (low && c.min === 0n ? `can't convert negative int to unsigned` : `Python int too large to convert to C ${c.name.replace(/^signed /, '')}`)
  : `${c.name} is ${low ? 'less than minimum' : 'greater than maximum'}`);
// a stored item as a Python value
const _arOut = (code, x) => (_AR_CODES[code].uni ? String.fromCodePoint(x) : _AR_CODES[code].big ? _arBigOut(x) : x);
// the bytes of a bytes-like object (bytes, bytearray, memoryview, an array), or null
export function _arBytesOf(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof PyByteArray) return Uint8Array.from(x);
  if (x instanceof PyMemoryView) return x.tobytes();
  if (x instanceof _ArArray) return x._bytes().slice();
  return null;
}

class _ArArray {
  constructor(...a) {
    _arKw(a);   // (a subclass's keyword arguments are its own __init__'s; array() itself refuses them)
    if (a.length < 1) throw new AdderError('TypeError', "array() missing required argument 'typecode' (pos 1)");
    if (a.length > 2) throw new AdderError('TypeError', `array() takes at most 2 arguments (${a.length} given)`);
    let [code, init] = a;
    if (code !== null && typeof code === 'object' && typeof code._pyStrValue === 'string') code = code._pyStrValue;
    if (typeof code !== 'string' || [...code].length !== 1) {
      throw new AdderError('TypeError', typeof code === 'string' ? `array() argument 1 must be a unicode character, not a string of length ${[...code].length}` : `array() argument 1 must be a unicode character, not ${pyTypeName(code)}`);
    }
    if (!Object.hasOwn(_AR_CODES, code)) throw new AdderError('ValueError', _AR_BAD_TYPECODE);
    const c = _AR_CODES[code];
    Object.defineProperty(this, '_code', { value: code, enumerable: false });
    Object.defineProperty(this, '_c', { value: c, enumerable: false });
    Object.defineProperty(this, '_n', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(this, '_exports', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(this, '_v', { value: new c.T(0), writable: true, enumerable: false });
    if (init === undefined) return;
    if (typeof init === 'string' || (init !== null && typeof init === 'object' && typeof init._pyStrValue === 'string')) {
      if (!c.uni) throw new AdderError('TypeError', `cannot use a str to initialize an array with typecode '${code}'`);
      this._fromUnicode(typeof init === 'string' ? init : init._pyStrValue);
      return;
    }
    if (init instanceof _ArArray && init._c.uni && !c.uni) throw new AdderError('TypeError', `cannot use a unicode array to initialize an array with typecode '${code}'`);
    if (init instanceof Uint8Array || init instanceof PyByteArray) { this._fromBytes(Uint8Array.from(init)); return; }
    if (init instanceof _ArArray) { this._appendValues(init.tolist()); return; }
    if (!Array.isArray(init)) throw new AdderError('TypeError', `'${pyTypeName(init)}' object is not iterable`);
    this._appendValues(init);
  }
  get typecode() { return this._code; }
  get itemsize() { return this._c.size; }
  // the live elements
  _arr() { return this._v.subarray(0, this._n); }
  _bytes() { return new Uint8Array(this._v.buffer, 0, this._n * this._c.size); }
  _resizeCheck() { if (this._exports > 0) throw new AdderError('BufferError', 'cannot resize an array that is exporting buffers'); }
  // room for `n` items (capacity grows by doubling)
  _reserve(n) {
    if (n <= this._v.length) return;
    if (n * this._c.size > 2 ** 31) throw new AdderError('MemoryError', '');
    const nv = new this._c.T(Math.max(n, this._v.length * 2, 4));
    nv.set(this._arr());
    this._v = nv;
  }
  _setLen(n) {
    if (n === this._n) return;
    this._resizeCheck();
    this._reserve(n);
    if (n < this._n) this._v.fill(this._c.big ? 0n : 0, n, this._n);
    this._n = n;
  }
  // append converted values, all or nothing
  _appendValues(vals) {
    const conv = vals.map((v) => _arItem(this._code, v));
    if (!conv.length) return;
    const n = this._n;
    this._setLen(n + conv.length);
    this._v.set(conv, n);
  }
  _fromBytes(b) {
    const sz = this._c.size;
    if (b.length % sz) throw new AdderError('ValueError', 'bytes length not a multiple of item size');
    if (!b.length) return;
    const n = this._n, k = b.length / sz;
    this._setLen(n + k);
    new Uint8Array(this._v.buffer, n * sz, b.length).set(b);
  }
  _fromUnicode(s) {
    const cps = [...s].map((ch) => ch.codePointAt(0));
    if (!cps.length) return;
    const n = this._n;
    this._setLen(n + cps.length);
    this._v.set(cps, n);
  }
  _new(vals) { const r = new _ArArray(this._code); r._appendValues(vals); return r; }
  _newRaw(arr) {
    const r = new _ArArray(this._code);
    r._setLen(arr.length);
    r._v.set(arr);
    return r;
  }
  // a buffer export: memoryview(a) — the array's bytes, live, until released
  _pyBufferExport() { this._exports++; return this._bytes(); }
  _pyBufferRelease() { if (this._exports > 0) this._exports--; }
  _pyBuffer() { return this._bytes(); }

  // ── the sequence ──
  __len__() { return this._n; }
  __getitem__(k) {
    if (k !== null && typeof k === 'object' && k._slice) {
      const [start, , step, count] = _arSlice(k, this._n);
      if (step === 1) return this._newRaw(this._arr().slice(start, start + count));
      const out = new this._c.T(count);
      for (let i = 0, j = start; i < count; i++, j += step) out[i] = this._v[j];
      return this._newRaw(out);
    }
    let i = _arIndex(k);
    if (i < 0) i += this._n;
    if (i < 0 || i >= this._n) throw new AdderError('IndexError', 'array index out of range');
    return _arOut(this._code, this._v[i]);
  }
  __setitem__(k, v) {
    if (k !== null && typeof k === 'object' && k._slice) {
      if (!(v instanceof _ArArray)) throw new AdderError('TypeError', `can only assign array (not "${pyTypeName(v)}") to array slice`);
      if (v._code !== this._code) throw new AdderError('TypeError', 'bad argument type for built-in operation');
      const src = v._arr().slice();
      const [start, stop, step, count] = _arSlice(k, this._n);
      if (step === 1) {
        const hi = Math.max(start, stop);
        const tail = this._arr().slice(hi);
        if (src.length !== hi - start) this._resizeCheck();
        this._setLen(start + src.length + tail.length);
        this._v.set(src, start);
        this._v.set(tail, start + src.length);
        return null;
      }
      if (src.length !== count) throw new AdderError('ValueError', `attempt to assign array of size ${src.length} to extended slice of size ${count}`);
      for (let i = 0, j = start; i < count; i++, j += step) this._v[j] = src[i];
      return null;
    }
    let i = _arIndex(k);
    const x = _arItem(this._code, v);
    if (i < 0) i += this._n;
    if (i < 0 || i >= this._n) throw new AdderError('IndexError', 'array assignment index out of range');
    this._v[i] = x;
    return null;
  }
  __delitem__(k) {
    if (k !== null && typeof k === 'object' && k._slice) {
      const [start, , step, count] = _arSlice(k, this._n);
      if (!count) return null;
      this._resizeCheck();
      const drop = new Set();
      for (let i = 0, j = start; i < count; i++, j += step) drop.add(j);
      const keep = this._arr().filter((_, i) => !drop.has(i));
      this._setLen(keep.length);
      this._v.set(keep);
      return null;
    }
    let i = _arIndex(k);
    if (i < 0) i += this._n;
    if (i < 0 || i >= this._n) throw new AdderError('IndexError', 'array assignment index out of range');
    this._resizeCheck();
    this._v.copyWithin(i, i + 1, this._n);
    this._setLen(this._n - 1);
    return null;
  }
  __contains__(x) { for (let i = 0; i < this._n; i++) if (pyEq(_arOut(this._code, this._v[i]), x) === true) return true; return false; }
  __iter__() { return new _ArIter(this); }
  __reversed__() { return new _ArRevIter(this); }
  __add__(o) {
    if (!(o instanceof _ArArray)) throw new AdderError('TypeError', `can only append array (not "${pyTypeName(o)}") to array`);
    if (o._code !== this._code) throw new AdderError('TypeError', 'bad argument type for built-in operation');
    const out = new this._c.T(this._n + o._n);
    out.set(this._arr()); out.set(o._arr(), this._n);
    return this._newRaw(out);
  }
  __iadd__(o) {
    if (!(o instanceof _ArArray)) throw new AdderError('TypeError', `can only extend array with array (not "${pyTypeName(o)}")`);
    if (o._code !== this._code) throw new AdderError('TypeError', 'can only extend with array of same kind');
    const src = o._arr().slice(), n = this._n;
    this._setLen(n + src.length);
    this._v.set(src, n);
    return this;
  }
  __mul__(k) {
    if (!(typeof k === 'number' || typeof k === 'bigint' || typeof k === 'boolean' || (k !== null && typeof k === 'object' && typeof k.__index__ === 'function'))) {
      throw new AdderError('TypeError', `can't multiply sequence by non-int of type '${pyTypeName(k)}'`);
    }
    const t = Math.max(0, _arIndex(k, null));
    if (this._n && t * this._n * this._c.size > 2 ** 31) throw new AdderError('MemoryError', '');
    const src = this._arr(), out = new this._c.T(src.length * t);
    for (let i = 0; i < t; i++) out.set(src, i * src.length);
    return this._newRaw(out);
  }
  __rmul__(k) { return this.__mul__(k); }
  __imul__(k) {
    if (!(typeof k === 'number' || typeof k === 'bigint' || typeof k === 'boolean' || (k !== null && typeof k === 'object' && typeof k.__index__ === 'function'))) {
      throw new AdderError('TypeError', `can't multiply sequence by non-int of type '${pyTypeName(k)}'`);
    }
    const t = Math.max(0, _arIndex(k, null));
    if (this._n && t * this._n * this._c.size > 2 ** 31) throw new AdderError('MemoryError', '');
    const src = this._arr().slice(), n = src.length;
    this._setLen(n * t);
    for (let i = 1; i < t; i++) this._v.set(src, i * n);
    return this;
  }
  // rich comparison: the first differing item decides; then the lengths
  _cmp(o, op) {
    if (!(o instanceof _ArArray)) return _arNotImpl();
    if ((op === 'eq' || op === 'ne') && this._n !== o._n) return op === 'ne';
    const n = Math.min(this._n, o._n);
    let i = 0;
    for (; i < n; i++) if (pyEq(_arOut(this._code, this._v[i]), _arOut(o._code, o._v[i])) !== true) break;
    if (i >= n) {
      const a = this._n, b = o._n;
      return op === 'eq' ? a === b : op === 'ne' ? a !== b : op === 'lt' ? a < b : op === 'le' ? a <= b : op === 'gt' ? a > b : a >= b;
    }
    if (op === 'eq') return false;
    if (op === 'ne') return true;
    const x = _arOut(this._code, this._v[i]), y = _arOut(o._code, o._v[i]);
    return op === 'lt' ? pyLt(x, y) : op === 'le' ? !pyLt(y, x) && (pyLt(x, y) || pyEq(x, y) === true) : op === 'gt' ? pyLt(y, x) : !pyLt(x, y) && (pyLt(y, x) || pyEq(x, y) === true);
  }
  __eq__(o) { return this._cmp(o, 'eq'); }
  __ne__(o) { return this._cmp(o, 'ne'); }
  __lt__(o) { return this._cmp(o, 'lt'); }
  __le__(o) { return this._cmp(o, 'le'); }
  __gt__(o) { return this._cmp(o, 'gt'); }
  __ge__(o) { return this._cmp(o, 'ge'); }
  __repr__() {
    const name = this.__adderClass__ && this.__adderClass__ !== 'array' ? this.__adderClass__ : 'array';
    if (!this._n) return `${name}('${this._code}')`;
    if (this._c.uni) return `${name}('${this._code}', ${pyRepr(this.tounicode())})`;
    return `${name}('${this._code}', ${pyRepr(this.tolist())})`;
  }
  __str__() { return this.__repr__(); }
  __copy__() { return this._newRaw(this._arr().slice()); }
  __deepcopy__(memo) { return this._newRaw(this._arr().slice()); }
  // pickling: (type, (typecode, list), state) under protocol 3, else the reconstructor and the bytes
  // in their machine format
  __reduce_ex__(protocol = 0) {
    const t = this.__adderType__ || _arArrayType;
    const st = this.__dict__ !== undefined ? this.__dict__ : _arInstanceDict(this);
    if (_arIndex(protocol, null) < 3) return mkTuple([t, mkTuple([this._code, this._c.uni ? this.tounicode() : this.tolist()]), st]);
    return mkTuple([adderGetAttr(adderModules.array, '_array_reconstructor'), mkTuple([t, this._code, _AR_NATIVE[this._code], this._bytes().slice()]), st]);
  }
  __reduce__() { return this.__reduce_ex__(0); }
  __class_getitem__(x) { return _arArrayType; }

  // ── methods ──
  append(...a) { _arArgs('append', a, 1, 1); this._appendValues([a[0]]); return null; }
  extend(...a) {
    _arArgs('extend', a, 1, 1);
    const it = a[0];
    if (it instanceof _ArArray) {
      if (it._code !== this._code) throw new AdderError('TypeError', 'can only extend with array of same kind');
      const src = it._arr().slice(), n = this._n;
      this._setLen(n + src.length);
      this._v.set(src, n);
      return null;
    }
    const items = pyCollectMaybe(it);
    if (_arIsThen(items)) return items.then((l) => { this._appendValues(l); return null; });
    this._appendValues(items);
    return null;
  }
  insert(...a) {
    _arArgs('insert', a, 2, 2);
    let i = _arIndex(a[0], null);
    const v = _arItem(this._code, a[1]);
    const n = this._n;
    if (i < 0) { i += n; if (i < 0) i = 0; }
    if (i > n) i = n;
    this._setLen(n + 1);
    this._v.copyWithin(i + 1, i, n);
    this._v[i] = v;
    return null;
  }
  pop(...a) {
    _arArgs('pop', a, 0, 1);
    let i = a.length ? _arIndex(a[0], null) : -1;
    if (!this._n) throw new AdderError('IndexError', 'pop from empty array');
    if (i < 0) i += this._n;
    if (i < 0 || i >= this._n) throw new AdderError('IndexError', 'pop index out of range');
    const v = _arOut(this._code, this._v[i]);
    this._resizeCheck();
    this._v.copyWithin(i, i + 1, this._n);
    this._setLen(this._n - 1);
    return v;
  }
  remove(...a) {
    _arArgs('remove', a, 1, 1);
    for (let i = 0; i < this._n; i++) {
      if (pyEq(_arOut(this._code, this._v[i]), a[0]) === true) {
        this._resizeCheck();
        this._v.copyWithin(i, i + 1, this._n);
        this._setLen(this._n - 1);
        return null;
      }
    }
    throw new AdderError('ValueError', 'array.remove(x): x not in array');
  }
  index(...a) {
    _arArgs('index', a, 1, 3);
    const n = this._n;
    const norm = (v, d) => { if (v === undefined) return d; let x = typeof v === 'bigint' ? (v > 0n ? n : -n - 1) : _arIndex(v, null); if (x < 0) { x += n; if (x < 0) x = 0; } return Math.min(x, n); };
    const start = norm(a[1], 0), stop = norm(a[2], n);
    for (let i = start; i < stop; i++) if (pyEq(_arOut(this._code, this._v[i]), a[0]) === true) return i;
    throw new AdderError('ValueError', 'array.index(x): x not in array');
  }
  count(...a) {
    _arArgs('count', a, 1, 1);
    let c = 0;
    for (let i = 0; i < this._n; i++) if (pyEq(_arOut(this._code, this._v[i]), a[0]) === true) c++;
    return c;
  }
  reverse(...a) { _arArgs('reverse', a, 0, 0); this._arr().reverse(); return null; }
  clear(...a) { _arArgs('clear', a, 0, 0); this._setLen(0); return null; }
  buffer_info(...a) { _arArgs('buffer_info', a, 0, 0); return mkTuple([_arAddress(this), this._n]); }
  byteswap(...a) {
    _arArgs('byteswap', a, 0, 0);
    const sz = this._c.size, b = this._bytes();
    if (sz > 1) for (let i = 0; i < b.length; i += sz) b.subarray(i, i + sz).reverse();
    return null;
  }
  tobytes(...a) { _arArgs('tobytes', a, 0, 0); return this._bytes().slice(); }
  frombytes(...a) {
    _arArgs('frombytes', a, 1, 1);
    const b = _arBytesOf(a[0]);
    if (!b) throw new AdderError('TypeError', `a bytes-like object is required, not '${pyTypeName(a[0])}'`);
    this._fromBytes(b instanceof Uint8Array && b.buffer === this._v.buffer ? b.slice() : b);
    return null;
  }
  tolist(...a) {
    _arArgs('tolist', a, 0, 0);
    const out = new Array(this._n);
    for (let i = 0; i < this._n; i++) out[i] = _arOut(this._code, this._v[i]);
    return out;
  }
  fromlist(...a) {
    _arArgs('fromlist', a, 1, 1);
    if (!Array.isArray(a[0]) || a[0] instanceof PyTuple) throw new AdderError('TypeError', 'arg must be list');
    this._appendValues([...a[0]]);
    return null;
  }
  tounicode(...a) {
    _arArgs('tounicode', a, 0, 0);
    if (!this._c.uni) throw new AdderError('ValueError', 'tounicode() may only be called on unicode type arrays');
    let s = '';
    for (let i = 0; i < this._n; i++) {
      const cp = this._v[i];
      if (cp > 0x10ffff) throw new AdderError('ValueError', `character U+${cp.toString(16)} is not in range [U+0000; U+10ffff]`);
      s += String.fromCodePoint(cp);
    }
    return s;
  }
  fromunicode(...a) {
    _arArgs('fromunicode', a, 1, 1);
    const s = a[0];
    if (typeof s !== 'string' && !(s !== null && typeof s === 'object' && typeof s._pyStrValue === 'string')) throw new AdderError('TypeError', `fromunicode() argument must be str, not ${pyTypeName(s)}`);
    if (!this._c.uni) throw new AdderError('ValueError', 'fromunicode() may only be called on unicode type arrays');
    this._fromUnicode(typeof s === 'string' ? s : s._pyStrValue);
    return null;
  }
  tofile(...a) {
    _arArgs('tofile', a, 1, 1);
    const f = a[0];
    const r = syncOf(_arMethod(f, 'write'))(this._bytes().slice());
    return _arIsThen(r) ? r.then(() => null) : null;
  }
  fromfile(...a) {
    _arArgs('fromfile', a, 2, 2);
    const [f, nArg] = a;
    const n = _arIndex(nArg, null);
    if (n < 0) throw new AdderError('ValueError', 'negative count');
    const nbytes = n * this._c.size;
    const done = (b) => {
      if (!(b instanceof Uint8Array)) throw new AdderError('TypeError', 'read() didn\'t return bytes');
      const whole = b.length - (b.length % this._c.size);
      this._fromBytes(b.subarray(0, whole));
      if (b.length !== nbytes) throw new AdderError('EOFError', 'read() didn\'t return enough bytes');
      return null;
    };
    const r = syncOf(_arMethod(f, 'read'))(nbytes);
    return _arIsThen(r) ? r.then(done) : done(r);
  }
}
const _arNotImpl = () => adderModules.builtins.NotImplemented;
// the instance's attribute dict for pickling (a subclass instance's attributes), or None
function _arInstanceDict(a) {
  const keys = Object.keys(a).filter((k) => k !== '__adderClass__' && k !== '__adderType__');
  if (!keys.length) return null;
  const d = new Map();
  for (const k of keys) d.set(k, a[k]);
  return d;
}
const _arIds = new WeakMap();
let _arNextId = 0x10000;
function _arAddress(a) { let id = _arIds.get(a); if (!id) { id = _arNextId += 0x1000; _arIds.set(a, id); } return id; }
function _arMethod(obj, name) {
  const m = adderModules.builtins.getattr(obj, name);
  if (typeof m !== 'function') throw new AdderError('TypeError', `'${pyTypeName(obj)}' object has no attribute '${name}'`);
  return m;
}

// the array's iterator: live (it sees items appended while it runs) until it is exhausted, then
// exhausted for good; picklable as (iter, (array,)) plus its position
class _ArIter {
  constructor(a) { this._a = a; this._i = 0; }
  __iter__() { return this; }
  __next__() {
    if (this._a && this._i < this._a._n) return _arOut(this._a._code, this._a._v[this._i++]);
    this._a = null;
    throw new AdderError('StopIteration', '');
  }
  next() {
    if (this._a && this._i < this._a._n) return { value: _arOut(this._a._code, this._a._v[this._i++]), done: false };
    this._a = null;
    return { value: undefined, done: true };
  }
  [Symbol.iterator]() { return this; }
  __reduce__() {
    const it = adderModules.builtins.iter;
    if (!this._a) return mkTuple([it, mkTuple([mkTuple([])])]);
    return mkTuple([it, mkTuple([this._a]), this._i]);
  }
  __setstate__(i) { const n = _arIndex(i, null); this._i = Math.max(0, this._a ? Math.min(n, this._a._n) : n); return null; }
  __length_hint__() { return this._a ? Math.max(0, this._a._n - this._i) : 0; }
}
_ArIter.prototype.__adderClass__ = 'arrayiterator';
// reversed(array): from the last item down; an item inserted before its position isn't seen, and
// once exhausted it stays so. Picklable as (reversed, (array,)) plus its position.
class _ArRevIter {
  constructor(a) { this._a = a; this._i = a._n - 1; }
  __iter__() { return this; }
  __next__() {
    if (this._a && this._i >= 0 && this._i < this._a._n) return _arOut(this._a._code, this._a._v[this._i--]);
    this._a = null;
    throw new AdderError('StopIteration', '');
  }
  next() {
    if (this._a && this._i >= 0 && this._i < this._a._n) return { value: _arOut(this._a._code, this._a._v[this._i--]), done: false };
    this._a = null;
    return { value: undefined, done: true };
  }
  [Symbol.iterator]() { return this; }
  __reduce__() {
    if (!this._a) return mkTuple([adderModules.builtins.iter, mkTuple([mkTuple([])])]);
    return mkTuple([adderModules.builtins.reversed, mkTuple([this._a]), this._i]);
  }
  __setstate__(i) { const n = _arIndex(i, null); if (this._a) this._i = n < -1 ? -1 : Math.min(n, this._a._n - 1); return null; }
  __length_hint__() { return this._a ? Math.max(0, this._i + 1) : 0; }
}
_ArRevIter.prototype.__adderClass__ = 'reversed';

// array(typecode[, initializer]): the type — keyword arguments are refused (a subclass's go to
// its __init__)
const _arArrayType = function (...a) {
  const kw = a.length && a[a.length - 1] !== null && typeof a[a.length - 1] === 'object' && a[a.length - 1]._kw === true ? a[a.length - 1] : null;
  if (kw && Object.keys(kw).some((k) => k !== '_kw')) throw new AdderError('TypeError', 'array.array() takes no keyword arguments');
  return _arMake(a);
};
// array(typecode, initializer): the initializer, unless it is a str / bytes-like / array / list,
// collected first (a Promise when the iterable is async); then the constructor
function _arMake(args) {
  const a = args.slice();
  _arKw(a);
  const init = a[1];
  if (a.length >= 1 && typeof a[0] === 'string' && a[0] === 'u') {
    const w = adderModules.warnings && adderModules.warnings.warn;
    if (w) w("The 'u' type code is deprecated and will be removed in Python 3.16", adderModules.builtins.DeprecationWarning, 2);
  }
  if (a.length < 2 || init === undefined || typeof init === 'string' || Array.isArray(init) || init instanceof Uint8Array ||
      init instanceof _ArArray || (init !== null && typeof init === 'object' && typeof init._pyStrValue === 'string')) {
    return new _ArArray(...a);
  }
  if (a.length >= 1) new _ArArray(a[0]);   // the typecode's errors come first
  if (init === null || (typeof init !== 'object' && typeof init !== 'function')) throw new AdderError('TypeError', `'${pyTypeName(init)}' object is not iterable`);
  const items = pyCollectMaybe(init);
  return _arIsThen(items) ? items.then((l) => new _ArArray(a[0], l)) : new _ArArray(a[0], items);
}
Object.assign(_arArrayType, { _pyName: 'array', __name__: 'array', __qualname__: 'array', _pyClass: true, __module__: 'array', _jsClass: _ArArray, _pyMake: _arMake });
_ArArray.prototype.__adderClass__ = 'array';
_ArArray.prototype.__adderType__ = _arArrayType;
_ArArray.prototype.__hash__ = null;
// array.__new__(cls, typecode, init): a subclass's instance; array.__init__ is object's
_arArrayType.__new__ = (cls, ...a) => (cls === _arArrayType ? new _ArArray(...a) : objectNew(cls, a));
_arArrayType.__init__ = () => null;
for (const name of Object.getOwnPropertyNames(_ArArray.prototype)) {
  if (name === 'constructor' || name.startsWith('_') && !/^__\w+__$/.test(name) || Object.hasOwn(_arArrayType, name)) continue;
  const d = Object.getOwnPropertyDescriptor(_ArArray.prototype, name);
  if (typeof d.value !== 'function') continue;
  // array.append(a, x), array.__getitem__(a, i): unbound
  const fn = (self, ...rest) => {
    if (!(self instanceof _ArArray)) throw new AdderError('TypeError', `descriptor '${name}' for 'array.array' objects doesn't apply to a '${pyTypeName(self)}' object`);
    return d.value.apply(self, rest);
  };
  fn._pyName = `array.${name}`;
  _arArrayType[name] = fn;
}

// the machine format codes (arraymodule.c's enum machine_format_code) and each typecode's own
const _AR_MFORMATS = [
  [1, false, false, 'int'], [1, true, false, 'int'],    // UNSIGNED_INT8, SIGNED_INT8
  [2, false, false, 'int'], [2, false, true, 'int'], [2, true, false, 'int'], [2, true, true, 'int'],
  [4, false, false, 'int'], [4, false, true, 'int'], [4, true, false, 'int'], [4, true, true, 'int'],
  [8, false, false, 'int'], [8, false, true, 'int'], [8, true, false, 'int'], [8, true, true, 'int'],
  [4, true, false, 'float'], [4, true, true, 'float'], [8, true, false, 'float'], [8, true, true, 'float'],
  [2, false, false, 'utf-16-le'], [2, false, true, 'utf-16-be'], [4, false, false, 'utf-32-le'], [4, false, true, 'utf-32-be'],
];
const _AR_NATIVE = { b: 1, B: 0, u: 20, w: 20, h: 4, H: 2, i: 8, I: 6, l: 12, L: 10, q: 12, Q: 10, f: 14, d: 16 };
// array._array_reconstructor(arraytype, typecode, mformat_code, items): unpickling
function _arReconstructor(...a) {
  _arKw(a);
  if (a.length !== 4) throw new AdderError('TypeError', `_array_reconstructor expected 4 arguments, got ${a.length}`);
  const [t, code, mfmt, items] = a;
  if (typeof t !== 'function' || !t._pyClass) throw new AdderError('TypeError', `first argument must be a type object, not ${pyTypeName(t)}`);
  if (t !== _arArrayType && !(t._pyMRO || []).includes(_arArrayType)) throw new AdderError('TypeError', `${t._pyName} is not a subtype of array.array`);
  if (typeof code !== 'string' || [...code].length !== 1) throw new AdderError('TypeError', `_array_reconstructor() argument 2 must be a unicode character, not ${pyTypeName(code)}`);
  if (typeof mfmt !== 'number' && typeof mfmt !== 'bigint' && typeof mfmt !== 'boolean') throw new AdderError('TypeError', `'${pyTypeName(mfmt)}' object cannot be interpreted as an integer`);
  if (!(items instanceof Uint8Array)) throw new AdderError('TypeError', `fourth argument should be bytes, not ${pyTypeName(items)}`);
  if (!Object.hasOwn(_AR_CODES, code)) throw new AdderError('ValueError', 'second argument must be a valid type code');
  const m = Number(mfmt);
  if (!Number.isInteger(m) || m < 0 || m >= _AR_MFORMATS.length) throw new AdderError('ValueError', 'third argument must be a valid machine format code.');
  const make = (init) => (t === _arArrayType ? new _ArArray(code, init) : objectNew(t, [code, init]));
  if (m === _AR_NATIVE[code]) return make(items.slice());
  const [size, signed, be, kind] = _AR_MFORMATS[m];
  if (items.length % size) throw new AdderError('ValueError', 'string length not a multiple of item size');
  if (kind.startsWith('utf')) {
    const s = adderModules.builtins.str(items, kind);
    return make(s);
  }
  const dv = new DataView(items.buffer, items.byteOffset, items.length);
  const vals = [];
  for (let o = 0; o < items.length; o += size) {
    if (kind === 'float') vals.push(size === 4 ? dv.getFloat32(o, !be) : dv.getFloat64(o, !be));
    else if (size === 1) vals.push(signed ? dv.getInt8(o) : dv.getUint8(o));
    else if (size === 2) vals.push(signed ? dv.getInt16(o, !be) : dv.getUint16(o, !be));
    else if (size === 4) vals.push(signed ? dv.getInt32(o, !be) : dv.getUint32(o, !be));
    else vals.push(_arBigOut(signed ? dv.getBigInt64(o, !be) : dv.getBigUint64(o, !be)));
  }
  return make(vals);
}
_arReconstructor._pyName = '_array_reconstructor';
_arReconstructor.__module__ = 'array';

adderModules.array = {
  __name__: 'array',
  array: _arArrayType,
  ArrayType: _arArrayType,
  typecodes: _AR_TYPECODES,
  _array_reconstructor: _arReconstructor,
};
// an array is a MutableSequence (arraymodule.c registers it)
{
  const abc = adderModules['collections.abc'] || (adderModules.collections && adderModules.collections.abc);
  if (abc && abc.MutableSequence && typeof abc.MutableSequence.register === 'function') abc.MutableSequence.register(_arArrayType);
}
