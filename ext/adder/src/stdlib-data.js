// adder stdlib — data formats and plumbing: csv, struct, hashlib, hmac, zlib, gzip, zipfile,
// uuid, urllib.parse, warnings, logging, tempfile. CPython's API and output; compression rides
// the platform's CompressionStream (so zlib / gzip / zipfile calls are async — adder awaits
// them like any call), hashing is synchronous pure JS. Files go through adder's VFS.
//
// Concat-bundled with the rest of adder: top-level names carry a `_dt` prefix.

import {
  AdderError, PyTuple, PyDict, mkTuple, isPlainDict, pyTypeName, pyRepr, pyStr, pyIter, pyCollect, pyStrMaybe,
  pyPercentFormat, adderGetAttr, adderModules, makeExcType, _pyHash, _namedtuple, _stdio, excTypeOf, excValue,
  getAdderVFS, _getVfsPath, _resolvePath, _createAdderFile, _mapVFSError, _typeObjects, pyFormatValue, excStack,
} from './builtins.js';

const _dtIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _dtKw = (args) => (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' &&
  args[args.length - 1]._kw === true ? args.pop() : null);
const _dtHas = (kw, k) => !!kw && Object.hasOwn(kw, k) && k !== '_kw';
function _dtArgs(a, names, defaults) {
  const kw = _dtKw(a);
  const out = {};
  names.forEach((n, i) => { out[n] = i < a.length ? a[i] : _dtHas(kw, n) ? kw[n] : defaults[n]; });
  return { args: out, kw };
}
const _dtType = (name, Cls, module) => {
  const ctor = (...a) => new Cls(...a);
  ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = name;
  if (module) ctor.__module__ = module;
  Cls.prototype.__adderClass__ = name;
  Cls.prototype.__adderType__ = ctor;
  ctor._jsClass = Cls;
  return ctor;
};
const _dtBytes = (b, what = 'a bytes-like object') => {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  throw new AdderError('TypeError', `${what} is required, not '${pyTypeName(b)}'`);
};
const _dtEnc = new TextEncoder();
const _dtDec = new TextDecoder();
const _dtConcat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const _dtWrite = (f, s) => adderGetAttr(f, 'write')(s);

// ── csv ──
// reader / writer / DictReader / DictWriter with CPython's quoting rules and dialects (excel,
// excel-tab, unix, registered ones). Not here: Sniffer.
const _dtCsvErr = makeExcType('_csv.Error', 'Exception');
const _DT_QUOTE = { QUOTE_MINIMAL: 0, QUOTE_ALL: 1, QUOTE_NONNUMERIC: 2, QUOTE_NONE: 3, QUOTE_STRINGS: 4, QUOTE_NOTNULL: 5 };
const _DT_DIALECTS = {
  excel: { delimiter: ',', quotechar: '"', escapechar: null, doublequote: true, skipinitialspace: false, lineterminator: '\r\n', quoting: 0, strict: false },
  'excel-tab': { delimiter: '\t', quotechar: '"', escapechar: null, doublequote: true, skipinitialspace: false, lineterminator: '\r\n', quoting: 0, strict: false },
  unix: { delimiter: ',', quotechar: '"', escapechar: null, doublequote: true, skipinitialspace: false, lineterminator: '\n', quoting: 1, strict: false },
};
function _dtDialect(dialect, kw) {
  let base = _DT_DIALECTS.excel;
  if (typeof dialect === 'string') { base = _DT_DIALECTS[dialect]; if (!base) throw new AdderError('_csv.Error', 'unknown dialect'); }
  else if (dialect && typeof dialect === 'object') base = { ..._DT_DIALECTS.excel, ...Object.fromEntries(Object.keys(_DT_DIALECTS.excel).filter((k) => k in dialect).map((k) => [k, dialect[k]])) };
  const d = { ...base };
  if (kw) for (const k of Object.keys(d)) if (_dtHas(kw, k)) d[k] = kw[k];
  if (typeof d.delimiter !== 'string' || d.delimiter.length !== 1) throw new AdderError('TypeError', '"delimiter" must be a 1-character string');
  return d;
}
class _DtCsvReader {
  constructor(src, d) { this._src = src; this._d = d; this.line_num = 0; this.dialect = d; this._it = null; }
  _lines() { return this._it || (this._it = pyIter(this._src)); }
  _nextRow() {
    const d = this._d, it = this._lines();
    const row = [];
    let field = '', state = 'start', quoted = false;
    let first = true;
    for (;;) {
      const nx = it.next();
      if (nx.done) {
        if (first) return null;
        if (state === 'inquote' && d.strict) throw new AdderError('_csv.Error', 'unexpected end of data');
        if (state !== 'start' || row.length) { row.push(this._conv(field, quoted)); }
        return row;
      }
      first = false;
      this.line_num++;
      let line = nx.value;
      if (typeof line !== 'string') throw new AdderError('_csv.Error', `iterator should return strings, not ${pyTypeName(line)} (the file should be opened in text mode)`);
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (state === 'start' || state === 'field') {
          if (state === 'start' && c === d.quotechar && d.quoting !== 3) { state = 'inquote'; quoted = true; continue; }
          if (c === d.delimiter) { row.push(this._conv(field, quoted)); field = ''; quoted = false; state = 'start'; if (d.skipinitialspace) while (line[i + 1] === ' ') i++; continue; }
          if (c === '\n' || c === '\r') {
            if (state === 'start' && !row.length && !quoted) return [];   // a blank line is an empty row
            if (c === '\r' && line[i + 1] === '\n') i++;
            row.push(this._conv(field, quoted)); return row;
          }
          if (d.escapechar && c === d.escapechar && i + 1 < line.length) { field += line[++i]; state = 'field'; continue; }
          if (state === 'start' && d.skipinitialspace && c === ' ' && field === '') continue;
          field += c; state = 'field';
        } else if (state === 'inquote') {
          if (d.escapechar && c === d.escapechar && i + 1 < line.length) { field += line[++i]; continue; }
          if (c === d.quotechar) {
            if (d.doublequote && line[i + 1] === d.quotechar) { field += c; i++; continue; }
            state = 'afterquote'; continue;
          }
          field += c;
        } else if (state === 'afterquote') {
          if (c === d.delimiter) { row.push(this._conv(field, quoted)); field = ''; quoted = false; state = 'start'; if (d.skipinitialspace) while (line[i + 1] === ' ') i++; continue; }
          if (c === '\n' || c === '\r') { if (c === '\r' && line[i + 1] === '\n') i++; row.push(this._conv(field, quoted)); return row; }
          if (d.strict) throw new AdderError('_csv.Error', `'${d.delimiter}' expected after '${d.quotechar}'`);
          field += c; state = 'field';
        }
      }
      if (state !== 'inquote') { if (state !== 'start' || row.length || field !== '' || quoted) row.push(this._conv(field, quoted)); return row; }
      // a quoted field continues on the next line (the newline was consumed with the line)
    }
  }
  _conv(field, quoted) {
    if (this._d.quoting === 2 && !quoted) { if (field === '') return field; const v = Number(field); if (Number.isNaN(v) && field.trim().toLowerCase() !== 'nan') throw new AdderError('ValueError', `could not convert string to float: ${pyRepr(field)}`); return v; }
    return field;
  }
  *[Symbol.iterator]() { for (let r = this._nextRow(); r !== null; r = this._nextRow()) yield r; }
  __next__() { const r = this._nextRow(); if (r === null) throw new AdderError('StopIteration', '', undefined, []); return r; }
}
_DtCsvReader.prototype.__adderClass__ = '_csv.reader';
function _dtCsvField(v, d) {
  if (v === null || v === undefined) return { s: '', num: false, none: true };
  if (typeof v === 'string') return { s: v, num: false };
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return { s: typeof v === 'boolean' ? (v ? 'True' : 'False') : pyStr(v), num: typeof v !== 'boolean' };
  return { s: pyStr(v), num: false };
}
function _dtCsvFormatRow(row, d) {
  const fields = [...pyIter(row)];
  const out = fields.map((v) => {
    const { s, num, none } = _dtCsvField(v, d);
    let quote = false;
    const special = s.includes(d.delimiter) || (d.quotechar && s.includes(d.quotechar)) || /[\r\n]/.test(s) || [...d.lineterminator].some((c) => s.includes(c)) || (d.escapechar && s.includes(d.escapechar));
    if (d.quoting === 1) quote = true;
    else if (d.quoting === 2) quote = !num && !none;
    else if (d.quoting === 4) quote = typeof v === 'string';
    else if (d.quoting === 5) quote = !none;
    else if (d.quoting === 0) quote = special || (fields.length === 1 && s === '');
    let body = s;
    if (d.quoting === 3) {
      if (special) {
        if (!d.escapechar) throw new AdderError('_csv.Error', 'need to escape, but no escapechar set');
        body = s.replace(new RegExp(`[${[d.delimiter, d.quotechar, d.escapechar, '\r', '\n'].filter(Boolean).map((c) => c.replace(/[\]\\^-]/g, '\\$&')).join('')}]`, 'g'), (c) => d.escapechar + c);
      }
      return body;
    }
    if (d.quotechar) {
      if (d.doublequote) body = body.split(d.quotechar).join(d.quotechar + d.quotechar);
      else if (d.escapechar) body = body.split(d.quotechar).join(d.escapechar + d.quotechar);
      else if (body.includes(d.quotechar)) throw new AdderError('_csv.Error', 'need to escape, but no escapechar set');
    }
    return quote ? d.quotechar + body + d.quotechar : body;
  });
  return out.join(d.delimiter) + d.lineterminator;
}
class _DtCsvWriter {
  constructor(f, d) { this._f = f; this._d = d; this.dialect = d; }
  writerow(row) { const r = _dtWrite(this._f, _dtCsvFormatRow(row, this._d)); return _dtIsThen(r) ? r : r; }
  async writerows(rows) { for (const r of pyIter(rows)) { const w = this.writerow(r); if (_dtIsThen(w)) await w; } return null; }
}
_DtCsvWriter.prototype.__adderClass__ = '_csv.writer';
class _DtDictReader {
  constructor(...a) {
    const { args, kw } = _dtArgs(a, ['f', 'fieldnames', 'restkey', 'restval', 'dialect'], { fieldnames: null, restkey: null, restval: null, dialect: 'excel' });
    this._reader = new _DtCsvReader(args.f, _dtDialect(args.dialect, kw));
    this._fieldnames = args.fieldnames === null ? null : [...pyIter(args.fieldnames)];
    this.restkey = args.restkey; this.restval = args.restval;
  }
  get fieldnames() {
    if (this._fieldnames === null) { const r = this._reader._nextRow(); this._fieldnames = r || []; }
    return this._fieldnames;
  }
  get line_num() { return this._reader.line_num; }
  _next() {
    const names = this.fieldnames;
    let row = this._reader._nextRow();
    while (row !== null && row.length === 0) row = this._reader._nextRow();
    if (row === null) return null;
    // a dict of the row; the surplus values go under restkey (None by default, which a plain
    // object cannot hold as a key, so that row is a PyDict)
    const extra = row.length > names.length;
    const d = extra && (this.restkey === null || typeof this.restkey !== 'string') ? new PyDict() : {};
    const put = (k, v) => (d instanceof Map ? d.set(k, v) : (d[k] = v));
    names.forEach((n, i) => put(n, i < row.length ? row[i] : this.restval));
    if (extra) put(this.restkey, row.slice(names.length));
    return d;
  }
  *[Symbol.iterator]() { for (let r = this._next(); r !== null; r = this._next()) yield r; }
  __next__() { const r = this._next(); if (r === null) throw new AdderError('StopIteration', '', undefined, []); return r; }
}
class _DtDictWriter {
  constructor(...a) {
    const { args, kw } = _dtArgs(a, ['f', 'fieldnames', 'restval', 'extrasaction', 'dialect'], { restval: '', extrasaction: 'raise', dialect: 'excel' });
    this.fieldnames = [...pyIter(args.fieldnames)];
    this.restval = args.restval;
    this.extrasaction = String(args.extrasaction).toLowerCase();
    if (this.extrasaction !== 'raise' && this.extrasaction !== 'ignore') throw new AdderError('ValueError', `extrasaction (${args.extrasaction}) must be 'raise' or 'ignore'`);
    this._w = new _DtCsvWriter(args.f, _dtDialect(args.dialect, kw));
  }
  writeheader() { return this._w.writerow(this.fieldnames); }
  _row(d) {
    const get = (k) => (d instanceof Map ? (d.has(k) ? d.get(k) : this.restval) : Object.hasOwn(d, k) ? d[k] : this.restval);
    if (this.extrasaction === 'raise') {
      const keys = d instanceof Map ? [...d.keys()] : Object.keys(d);
      const wrong = keys.filter((k) => !this.fieldnames.includes(k));
      if (wrong.length) throw new AdderError('ValueError', `dict contains fields not in fieldnames: ${wrong.map(pyRepr).join(', ')}`);
    }
    return this.fieldnames.map(get);
  }
  writerow(d) { return this._w.writerow(this._row(d)); }
  async writerows(rows) { for (const d of pyIter(rows)) { const w = this.writerow(d); if (_dtIsThen(w)) await w; } return null; }
}
adderModules.csv = {
  reader: (f, ...a) => { const { args, kw } = _dtArgs(a, ['dialect'], { dialect: 'excel' }); return new _DtCsvReader(f, _dtDialect(args.dialect, kw)); },
  writer: (f, ...a) => { const { args, kw } = _dtArgs(a, ['dialect'], { dialect: 'excel' }); return new _DtCsvWriter(f, _dtDialect(args.dialect, kw)); },
  DictReader: _dtType('DictReader', _DtDictReader, 'csv'),
  DictWriter: _dtType('DictWriter', _DtDictWriter, 'csv'),
  register_dialect: (name, ...a) => { const { args, kw } = _dtArgs(a, ['dialect'], { dialect: null }); _DT_DIALECTS[name] = _dtDialect(args.dialect || 'excel', kw); return null; },
  unregister_dialect: (name) => { if (!_DT_DIALECTS[name]) throw new AdderError('_csv.Error', 'unknown dialect'); delete _DT_DIALECTS[name]; return null; },
  get_dialect: (name) => { if (!_DT_DIALECTS[name]) throw new AdderError('_csv.Error', 'unknown dialect'); return { __adderClass__: 'Dialect', ..._DT_DIALECTS[name] }; },
  list_dialects: () => Object.keys(_DT_DIALECTS),
  field_size_limit: () => 131072,
  excel: 'excel', excel_tab: 'excel-tab', unix_dialect: 'unix',
  Error: _dtCsvErr,
  ..._DT_QUOTE,
};

// ── struct ──
// pack / unpack / calcsize / pack_into / unpack_from / iter_unpack / Struct: byte orders
// @ = < > !, codes x c b B ? h H i I l L q Q n N e f d s p P. '@' uses the LP64 sizes (Linux,
// macOS: long is 8 bytes) with native alignment.
const _dtStructErr = makeExcType('struct.error', 'Exception');
const _DT_STD = { x: 1, c: 1, b: 1, B: 1, '?': 1, h: 2, H: 2, i: 4, I: 4, l: 4, L: 4, q: 8, Q: 8, e: 2, f: 4, d: 8, s: 1, p: 1 };
const _DT_NATIVE = { ..._DT_STD, l: 8, L: 8, n: 8, N: 8, P: 8 };
function _dtParseFmt(fmt) {
  if (fmt instanceof Uint8Array) fmt = _dtDec.decode(fmt);
  if (typeof fmt !== 'string') throw new AdderError('TypeError', `Struct() argument 1 must be a str or bytes object, not ${pyTypeName(fmt)}`);
  let i = 0, order = '@';
  if ('@=<>!'.includes(fmt[0])) { order = fmt[0]; i = 1; }
  const native = order === '@';
  const little = order === '<' || ((order === '@' || order === '=') && true);
  const sizes = native ? _DT_NATIVE : _DT_STD;
  const items = [];
  let size = 0;
  while (i < fmt.length) {
    const c0 = fmt[i];
    if (/\s/.test(c0)) { i++; continue; }
    let num = '';
    while (i < fmt.length && /\d/.test(fmt[i])) num += fmt[i++];
    const code = fmt[i++];
    if (code === undefined) throw new AdderError('struct.error', 'repeat count given without format specifier');
    if (!(code in sizes)) throw new AdderError('struct.error', 'bad char in struct format');
    const count = num === '' ? 1 : Number(num);
    const s = sizes[code];
    if (native && s > 1 && code !== 's' && code !== 'p') size = Math.ceil(size / s) * s;
    if (code === 's' || code === 'p') { items.push({ code, count, offset: size, size: count }); size += count; }
    else if (code === 'x') size += count;
    else for (let k = 0; k < count; k++) { items.push({ code, offset: size, size: s }); size += s; }
  }
  return { items, size, little: order === '<' || order === '@' || order === '=' ? true : false, fmt };
}
const _dtIntRange = { b: [-128n, 127n], B: [0n, 255n], h: [-32768n, 32767n], H: [0n, 65535n], i: [-2147483648n, 2147483647n], I: [0n, 4294967295n],
  l: [-9223372036854775808n, 9223372036854775807n], L: [0n, 18446744073709551615n], q: [-9223372036854775808n, 9223372036854775807n], Q: [0n, 18446744073709551615n],
  n: [-9223372036854775808n, 9223372036854775807n], N: [0n, 18446744073709551615n], P: [0n, 18446744073709551615n] };
function _dtHalf(v) {
  const f32 = new Float32Array([v]), u = new Uint32Array(f32.buffer)[0];
  const sign = (u >>> 16) & 0x8000;
  let e = ((u >>> 23) & 0xff) - 127 + 15, m = u & 0x7fffff;
  if (Number.isNaN(v)) return sign | 0x7e00;
  if (e >= 31) { if (Number.isFinite(v)) throw new AdderError('OverflowError', 'float too large to pack with e format'); return sign | 0x7c00; }
  if (e <= 0) { if (e < -10) return sign; m |= 0x800000; const shift = 14 - e; let h = m >> shift; const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1); if (rem > half || (rem === half && (h & 1))) h++; return sign | h; }
  let h = (e << 10) | (m >> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++;
  if ((h & 0x7c00) === 0x7c00 && Number.isFinite(v)) throw new AdderError('OverflowError', 'float too large to pack with e format');
  return sign | h;
}
function _dtUnhalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
function _dtPackInto(st, buf, off, values) {
  if (values.length !== st.items.length) throw new AdderError('struct.error', `pack expected ${st.items.length} items for packing (got ${values.length})`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  st.items.forEach((it, k) => {
    const v = values[k], o = off + it.offset, le = st.little;
    switch (it.code) {
      case 'c': {
        const b = v instanceof Uint8Array ? v : null;
        if (!b || b.length !== 1) throw new AdderError('struct.error', 'char format requires a bytes object of length 1');
        dv.setUint8(o, b[0]); break;
      }
      case '?': dv.setUint8(o, v ? 1 : 0); break;
      case 'e': dv.setUint16(o, _dtHalf(Number(v)), le); break;
      case 'f': {
        const x = Number(v);
        if (Number.isFinite(x) && Math.abs(x) > 3.4028234663852886e38 && Math.fround(x) === (x > 0 ? Infinity : -Infinity)) throw new AdderError('OverflowError', 'float too large to pack with f format');
        dv.setFloat32(o, x, le); break;
      }
      case 'd': dv.setFloat64(o, Number(v), le); break;
      case 's': case 'p': {
        const b = v instanceof Uint8Array ? v : null;
        if (!b) throw new AdderError('struct.error', `argument for '${it.code}' must be a bytes object`);
        if (it.code === 's') { for (let j = 0; j < it.count; j++) dv.setUint8(o + j, j < b.length ? b[j] : 0); }
        else { const n = Math.min(b.length, it.count - 1, 255); if (it.count > 0) dv.setUint8(o, n); for (let j = 1; j < it.count; j++) dv.setUint8(o + j, j - 1 < n ? b[j - 1] : 0); }
        break;
      }
      default: {
        let bi;
        if (typeof v === 'boolean') bi = BigInt(+v);
        else if (typeof v === 'number' && Number.isInteger(v)) bi = BigInt(v);
        else if (typeof v === 'bigint') bi = v;
        else if (v && typeof v.__index__ === 'function') bi = BigInt(v.__index__());
        else throw new AdderError('struct.error', 'required argument is not an integer');
        const [lo, hi] = _dtIntRange[it.code];
        if (bi < lo || bi > hi) {
          const c = it.code;
          const what = `'${c}' format`;
          throw new AdderError('struct.error', 'qQnNP'.includes(c) ? 'argument out of range' : `${what} requires ${lo} <= number <= ${hi}`);
        }
        if (it.size === 1) dv.setUint8(o, Number(bi & 0xffn));
        else if (it.size === 2) dv.setUint16(o, Number(bi & 0xffffn), le);
        else if (it.size === 4) dv.setUint32(o, Number(bi & 0xffffffffn), le);
        else dv.setBigUint64(o, BigInt.asUintN(64, bi), le);
      }
    }
  });
}
function _dtUnpackFrom(st, buf, off) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const asInt = (b) => (b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b);
  return mkTuple(st.items.map((it) => {
    const o = off + it.offset, le = st.little;
    switch (it.code) {
      case 'c': return buf.slice(o, o + 1);
      case '?': return dv.getUint8(o) !== 0;
      case 'b': return dv.getInt8(o);
      case 'B': return dv.getUint8(o);
      case 'h': return dv.getInt16(o, le);
      case 'H': return dv.getUint16(o, le);
      case 'i': case 'l': return it.size === 4 ? dv.getInt32(o, le) : asInt(dv.getBigInt64(o, le));
      case 'I': case 'L': return it.size === 4 ? dv.getUint32(o, le) : asInt(dv.getBigUint64(o, le));
      case 'q': case 'n': return asInt(dv.getBigInt64(o, le));
      case 'Q': case 'N': case 'P': return asInt(dv.getBigUint64(o, le));
      case 'e': return _dtUnhalf(dv.getUint16(o, le));
      case 'f': return dv.getFloat32(o, le);
      case 'd': return dv.getFloat64(o, le);
      case 's': return buf.slice(o, o + it.count);
      case 'p': { const n = Math.min(dv.getUint8(o), it.count - 1); return buf.slice(o + 1, o + 1 + n); }
      default: return null;
    }
  }));
}
const _dtStructCache = new Map();
const _dtStruct = (fmt) => { const k = fmt instanceof Uint8Array ? _dtDec.decode(fmt) : fmt; if (!_dtStructCache.has(k)) _dtStructCache.set(k, _dtParseFmt(k)); return _dtStructCache.get(k); };
function _dtPack(fmt, ...values) { const st = _dtStruct(fmt); const out = new Uint8Array(st.size); _dtPackInto(st, out, 0, values); return out; }
function _dtUnpack(fmt, buffer) {
  const st = _dtStruct(fmt), b = _dtBytes(buffer);
  if (b.length !== st.size) throw new AdderError('struct.error', `unpack requires a buffer of ${st.size} bytes`);
  return _dtUnpackFrom(st, b, 0);
}
function _dtUnpackFromFn(fmt, buffer, offset = 0) {
  if (offset && typeof offset === 'object' && offset._kw) offset = offset.offset ?? 0;
  const st = _dtStruct(fmt), b = _dtBytes(buffer);
  if (offset < 0) offset += b.length;
  if (b.length - offset < st.size) throw new AdderError('struct.error', `unpack_from requires a buffer of at least ${st.size + offset} bytes for unpacking ${st.size} bytes at offset ${offset} (actual buffer size is ${b.length})`);
  return _dtUnpackFrom(st, b, offset);
}
class _DtStruct {
  constructor(fmt) { this._st = _dtStruct(fmt); this.format = typeof fmt === 'string' ? fmt : _dtDec.decode(fmt); this.size = this._st.size; }
  pack(...v) { const out = new Uint8Array(this.size); _dtPackInto(this._st, out, 0, v); return out; }
  unpack(b) { return _dtUnpack(this.format, b); }
  unpack_from(b, off = 0) { return _dtUnpackFromFn(this.format, b, off); }
  pack_into(buf, off, ...v) { _dtPackInto(this._st, _dtBytes(buf), off, v); return null; }
  iter_unpack(b) { return adderModules.struct.iter_unpack(this.format, b); }
  __repr__() { return `Struct(${pyRepr(this.format)})`; }
}
adderModules.struct = {
  pack: _dtPack, unpack: _dtUnpack, unpack_from: _dtUnpackFromFn,
  pack_into: (fmt, buf, off, ...v) => { const st = _dtStruct(fmt); const b = _dtBytes(buf); if (off < 0) off += b.length; if (off + st.size > b.length) throw new AdderError('struct.error', `pack_into requires a buffer of at least ${st.size + off} bytes for packing ${st.size} bytes at offset ${off} (actual buffer size is ${b.length})`); _dtPackInto(st, b, off, v); return null; },
  calcsize: (fmt) => _dtStruct(fmt).size,
  iter_unpack: (fmt, buffer) => {
    const st = _dtStruct(fmt), b = _dtBytes(buffer);
    if (st.size === 0) throw new AdderError('struct.error', 'cannot iteratively unpack with a struct of length 0');
    if (b.length % st.size) throw new AdderError('struct.error', `iterative unpacking requires a buffer of a multiple of ${st.size} bytes`);
    const out = [];
    for (let o = 0; o < b.length; o += st.size) out.push(_dtUnpackFrom(st, b, o));
    return out[Symbol.iterator]();
  },
  Struct: _dtType('Struct', _DtStruct, 'struct'),
  error: _dtStructErr,
};

// ── hashlib / hmac ──
// md5, sha1, sha224, sha256, sha384, sha512 (+ new, pbkdf2_hmac), synchronous pure JS; the SHA-2
// round constants are derived exactly (integer roots of the primes), not typed in. hmac.new /
// digest / compare_digest. Not here: blake2, sha3, shake.
const _dtPrimes = (n) => { const ps = []; for (let k = 2; ps.length < n; k++) if (ps.every((p) => k % p)) ps.push(k); return ps; };
const _dtIroot = (n, k) => {
  // floor(n ** (1/k)) for BigInt n, by Newton from above
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  for (;;) { const y = ((BigInt(k) - 1n) * x + n / x ** BigInt(k - 1)) / BigInt(k); if (y >= x) break; x = y; }
  while (x ** BigInt(k) > n) x -= 1n;
  return x;
};
const _dtFrac = (p, root, bits) => { const v = _dtIroot(BigInt(p) << BigInt(root * bits), root); return v & ((1n << BigInt(bits)) - 1n); };
const _DT_P80 = _dtPrimes(80);
const _DT_K256 = Uint32Array.from(_DT_P80.slice(0, 64).map((p) => Number(_dtFrac(p, 3, 32))));
const _DT_H256 = Uint32Array.from(_DT_P80.slice(0, 8).map((p) => Number(_dtFrac(p, 2, 32))));
const _DT_H224 = Uint32Array.from([0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4]);
const _DT_K512 = _DT_P80.map((p) => _dtFrac(p, 3, 64));
const _DT_H512 = _DT_P80.slice(0, 8).map((p) => _dtFrac(p, 2, 64));
const _DT_H384 = _DT_P80.slice(8, 16).map((p) => _dtFrac(p, 2, 64));
const _dtPad = (msg, block, lenBytes, littleEndian) => {
  const bitLen = BigInt(msg.length) * 8n;
  const total = Math.ceil((msg.length + 1 + lenBytes) / block) * block;
  const out = new Uint8Array(total);
  out.set(msg); out[msg.length] = 0x80;
  for (let i = 0; i < 16 && i < lenBytes; i++) {
    const byte = Number((bitLen >> BigInt(8 * i)) & 0xffn);
    if (littleEndian) out[msg.length + 1 + (total - msg.length - 1 - lenBytes) + i] = byte;
    else out[total - 1 - i] = byte;
  }
  return out;
};
const _dtRotr = (x, n) => (x >>> n) | (x << (32 - n));
function _dtSha256(msg, init, outWords) {
  const m = _dtPad(msg, 64, 8, false);
  const H = Uint32Array.from(init), W = new Uint32Array(64);
  const dv = new DataView(m.buffer);
  for (let off = 0; off < m.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + 4 * t);
    for (let t = 16; t < 64; t++) {
      const s0 = _dtRotr(W[t - 15], 7) ^ _dtRotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = _dtRotr(W[t - 2], 17) ^ _dtRotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = _dtRotr(e, 6) ^ _dtRotr(e, 11) ^ _dtRotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + _DT_K256[t] + W[t]) | 0;
      const S0 = _dtRotr(a, 2) ^ _dtRotr(a, 13) ^ _dtRotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(outWords * 4), odv = new DataView(out.buffer);
  for (let i = 0; i < outWords; i++) odv.setUint32(4 * i, H[i]);
  return out;
}
function _dtSha512(msg, init, outBytes) {
  const M64 = (1n << 64n) - 1n;
  const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;
  const m = _dtPad(msg, 128, 16, false);
  const H = [...init], W = new Array(80);
  const dv = new DataView(m.buffer);
  for (let off = 0; off < m.length; off += 128) {
    for (let t = 0; t < 16; t++) W[t] = dv.getBigUint64(off + 8 * t);
    for (let t = 16; t < 80; t++) {
      const s0 = rotr(W[t - 15], 1) ^ rotr(W[t - 15], 8) ^ (W[t - 15] >> 7n);
      const s1 = rotr(W[t - 2], 19) ^ rotr(W[t - 2], 61) ^ (W[t - 2] >> 6n);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) & M64;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 80; t++) {
      const S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41);
      const ch = (e & f) ^ (~e & M64 & g);
      const t1 = (h + S1 + ch + _DT_K512[t] + W[t]) & M64;
      const S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M64;
      h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
    }
    H[0] = (H[0] + a) & M64; H[1] = (H[1] + b) & M64; H[2] = (H[2] + c) & M64; H[3] = (H[3] + d) & M64;
    H[4] = (H[4] + e) & M64; H[5] = (H[5] + f) & M64; H[6] = (H[6] + g) & M64; H[7] = (H[7] + h) & M64;
  }
  const out = new Uint8Array(64), odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setBigUint64(8 * i, H[i]);
  return out.slice(0, outBytes);
}
function _dtSha1(msg) {
  const m = _dtPad(msg, 64, 8, false);
  const H = Uint32Array.from([0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]), W = new Uint32Array(80);
  const dv = new DataView(m.buffer);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < m.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + 4 * t);
    for (let t = 16; t < 80; t++) W[t] = rotl(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);
    let [a, b, c, d, e] = H;
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5A827999] : t < 40 ? [b ^ c ^ d, 0x6ED9EBA1] : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8F1BBCDC] : [b ^ c ^ d, 0xCA62C1D6];
      const tmp = (rotl(a, 5) + f + e + k + W[t]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e;
  }
  const out = new Uint8Array(20), odv = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) odv.setUint32(4 * i, H[i]);
  return out;
}
const _DT_MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const _DT_MD5_K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
function _dtMd5(msg) {
  const m = _dtPad(msg, 64, 8, true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const dv = new DataView(m.buffer);
  const M = new Int32Array(16);
  for (let off = 0; off < m.length; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + 4 * j, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + _DT_MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      const s = _DT_MD5_S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16), odv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => odv.setInt32(4 * i, v, true));
  return out;
}
const _DT_HASHES = {
  md5: { fn: _dtMd5, size: 16, block: 64 },
  sha1: { fn: _dtSha1, size: 20, block: 64 },
  sha224: { fn: (m) => _dtSha256(m, _DT_H224, 7), size: 28, block: 64 },
  sha256: { fn: (m) => _dtSha256(m, _DT_H256, 8), size: 32, block: 64 },
  sha384: { fn: (m) => _dtSha512(m, _DT_H384, 48), size: 48, block: 128 },
  sha512: { fn: (m) => _dtSha512(m, _DT_H512, 64), size: 64, block: 128 },
};
const _dtHashInput = (data) => {
  if (typeof data === 'string') throw new AdderError('TypeError', 'Strings must be encoded before hashing');
  return _dtBytes(data, 'object supporting the buffer API');
};
const _dtHexOf = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
class _DtHash {
  constructor(name, data) { this.name = name; this._alg = _DT_HASHES[name]; this._parts = []; this.digest_size = this._alg.size; this.block_size = this._alg.block; if (data !== undefined && data !== null) this.update(data); }
  update(data) { this._parts.push(Uint8Array.from(_dtHashInput(data))); return null; }
  digest() { return this._alg.fn(_dtConcat(this._parts)); }
  hexdigest() { return _dtHexOf(this.digest()); }
  copy() { const h = new _DtHash(this.name); h._parts = [...this._parts]; return h; }
  __repr__() { return `<${this.name} _hashlib.HASH object>`; }
}
_DtHash.prototype.__adderClass__ = 'HASH';
const _dtHashCtor = (name) => {
  const f = (...a) => { const { args } = _dtArgs(a, ['data'], { data: undefined }); return new _DtHash(name, args.data ?? (a.length ? a[0] : undefined)); };
  f._pyName = `openssl_${name}`; f.__name__ = f._pyName;
  return f;
};
function _dtHashName(d) {
  if (typeof d === 'string') { const n = d.toLowerCase().replace('-', ''); if (!_DT_HASHES[n]) throw new AdderError('ValueError', `unsupported hash type ${d}`); return n; }
  if (typeof d === 'function') { const h = d(); return h.name; }
  if (d && d.name) return d.name;
  throw new AdderError('TypeError', 'Missing required parameter \'digestmod\'.');
}
class _DtHmac {
  constructor(key, msg, digestmod) {
    const name = _dtHashName(digestmod);
    this._name = name; this._alg = _DT_HASHES[name];
    let k = _dtHashInput(key);
    if (k.length > this._alg.block) k = this._alg.fn(k);
    const kp = new Uint8Array(this._alg.block); kp.set(k);
    this._ipad = kp.map((b) => b ^ 0x36); this._opad = kp.map((b) => b ^ 0x5c);
    this._inner = [this._ipad];
    this.digest_size = this._alg.size; this.block_size = this._alg.block; this.name = `hmac-${name}`;
    if (msg !== null && msg !== undefined) this.update(msg);
  }
  update(m) { this._inner.push(Uint8Array.from(_dtHashInput(m))); return null; }
  digest() { const ih = this._alg.fn(_dtConcat(this._inner)); return this._alg.fn(_dtConcat([this._opad, ih])); }
  hexdigest() { return _dtHexOf(this.digest()); }
  copy() { const c = Object.create(_DtHmac.prototype); Object.assign(c, this); c._inner = [...this._inner]; return c; }
}
_DtHmac.prototype.__adderClass__ = 'HMAC';
const _dtHmacNew = (key, ...a) => { const { args } = _dtArgs(a, ['msg', 'digestmod'], { msg: null, digestmod: null }); return new _DtHmac(key, args.msg, args.digestmod); };
adderModules.hashlib = {
  ...Object.fromEntries(Object.keys(_DT_HASHES).map((n) => [n, _dtHashCtor(n)])),
  new: (name, data) => { const n = _dtHashName(name); return new _DtHash(n, data && data._kw ? data.data : data); },
  algorithms_guaranteed: new Set(Object.keys(_DT_HASHES)),
  algorithms_available: new Set(Object.keys(_DT_HASHES)),
  pbkdf2_hmac: (hash_name, password, salt, iterations, dklen = null) => {
    const name = _dtHashName(hash_name), size = _DT_HASHES[name].size;
    const len = dklen === null || dklen === undefined ? size : dklen;
    const out = new Uint8Array(len);
    const s = _dtHashInput(salt);
    for (let block = 1, pos = 0; pos < len; block++) {
      const ib = new Uint8Array(4); new DataView(ib.buffer).setUint32(0, block);
      let u = new _DtHmac(password, _dtConcat([s, ib]), name).digest();
      const t = Uint8Array.from(u);
      for (let i = 1; i < iterations; i++) { u = new _DtHmac(password, u, name).digest(); for (let j = 0; j < t.length; j++) t[j] ^= u[j]; }
      out.set(t.subarray(0, Math.min(t.length, len - pos)), pos);
      pos += t.length;
    }
    return out;
  },
  file_digest: async (f, digest) => { const h = typeof digest === 'string' ? new _DtHash(_dtHashName(digest)) : digest(); h.update(await adderGetAttr(f, 'read')()); return h; },
};
adderModules.hmac = {
  new: _dtHmacNew, HMAC: _dtHmacNew,
  digest: (key, msg, digest) => new _DtHmac(key, msg, digest).digest(),
  compare_digest: (a, b) => {
    const x = typeof a === 'string' ? _dtEnc.encode(a) : _dtBytes(a), y = typeof b === 'string' ? _dtEnc.encode(b) : _dtBytes(b);
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
    return diff === 0;
  },
};

// ── zlib / gzip ──
// compress / decompress (zlib, raw and gzip framing through wbits) on CompressionStream; crc32
// and adler32 are binascii's. Output bytes are the platform's deflate, not CPython's zlib —
// they decompress to the same data. Not here: compressobj / decompressobj streaming objects.
const _dtZlibErr = makeExcType('zlib.error', 'Exception');
const _dtCrc = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function _dtCrc32(bytes, start = 0) {
  let c = (start ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = _dtCrc[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function _dtAdler32(bytes, start = 1) {
  let a = start & 0xffff, b = (start >>> 16) & 0xffff;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
async function _dtStream(bytes, Ctor, format) {
  if (typeof Ctor !== 'function') throw new AdderError('RuntimeError', 'CompressionStream is not available in this environment');
  const s = new Blob([bytes]).stream().pipeThrough(new Ctor(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const _dtFormat = (wbits) => (wbits >= 25 ? 'gzip' : wbits < 0 ? 'deflate-raw' : 'deflate');
async function _dtCompress(data, ...a) {
  const { args } = _dtArgs(a, ['level', 'wbits'], { level: -1, wbits: 15 });
  return _dtStream(_dtBytes(data), globalThis.CompressionStream, _dtFormat(args.wbits));
}
async function _dtDecompress(data, ...a) {
  const { args } = _dtArgs(a, ['wbits', 'bufsize'], { wbits: 15, bufsize: 16384 });
  let fmt = _dtFormat(args.wbits);
  const b = _dtBytes(data);
  if (args.wbits >= 40) fmt = b[0] === 0x1f && b[1] === 0x8b ? 'gzip' : 'deflate';
  try { return await _dtStream(b, globalThis.DecompressionStream, fmt); }
  catch (e) { if (e instanceof AdderError) throw e; throw new AdderError('zlib.error', `Error -3 while decompressing data: ${fmt === 'gzip' ? 'incorrect header check' : 'invalid stored block lengths'}`); }
}
adderModules.zlib = {
  compress: _dtCompress, decompress: _dtDecompress,
  crc32: (data, value = 0) => _dtCrc32(_dtBytes(data), value),
  adler32: (data, value = 1) => _dtAdler32(_dtBytes(data), value),
  MAX_WBITS: 15, DEFLATED: 8, DEF_MEM_LEVEL: 8, DEF_BUF_SIZE: 16384, Z_DEFAULT_COMPRESSION: -1, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9,
  Z_NO_COMPRESSION: 0, Z_DEFAULT_STRATEGY: 0, Z_FINISH: 4, Z_SYNC_FLUSH: 2, ZLIB_VERSION: '1.3', ZLIB_RUNTIME_VERSION: '1.3',
  error: _dtZlibErr,
};
const _dtBadGzip = makeExcType('gzip.BadGzipFile', 'OSError');
adderModules.gzip = {
  compress: async (data) => _dtStream(_dtBytes(data), globalThis.CompressionStream, 'gzip'),
  decompress: async (data) => {
    const b = _dtBytes(data);
    if (b[0] !== 0x1f || b[1] !== 0x8b) throw new AdderError('gzip.BadGzipFile', `Not a gzipped file (${pyRepr(b.slice(0, 2))})`);
    return _dtStream(b, globalThis.DecompressionStream, 'gzip');
  },
  BadGzipFile: _dtBadGzip,
};
// GzipFile: a gzip stream over a file object (or a path) — read mode decompresses on first read,
// write mode collects and compresses on close (the platform's CompressionStream is one-shot)
class _DtGzipFile {
  constructor(...a) {
    const { args } = _dtArgs(a, ['filename', 'mode', 'compresslevel', 'fileobj', 'mtime'], { filename: null, mode: null, compresslevel: 9, fileobj: null, mtime: null });
    this._mode = String(args.mode || (args.fileobj && args.fileobj.mode) || 'rb');
    this.mode = this._mode.startsWith('r') ? 1 : 2;   // READ / WRITE, as CPython's GzipFile.mode
    this.fileobj = args.fileobj;
    this.name = args.filename !== null ? String(args.filename) : (args.fileobj && typeof args.fileobj.name === 'string' ? args.fileobj.name : '');
    this._path = args.fileobj ? null : args.filename;
    this._buf = null; this._pos = 0; this._out = []; this.closed = false;
  }
  async _src() {
    if (!this.fileobj) this.fileobj = await adderModules.builtins.open(this._path, this._mode.replace('t', '').replace(/b?$/, 'b'));
    return this.fileobj;
  }
  async _load() {
    if (this._buf) return;
    const f = await this._src();
    const raw = _dtBytes(await adderGetAttr(f, 'read')());
    this._buf = raw.length ? await adderModules.gzip.decompress(raw) : new Uint8Array(0);
  }
  async read(size = -1) {
    if (this.mode !== 1) throw new AdderError('OSError', 'read() on write-only GzipFile object');
    await this._load();
    const end = size === null || size < 0 ? this._buf.length : Math.min(this._buf.length, this._pos + size);
    const r = this._buf.slice(this._pos, end);
    this._pos = end;
    return r;
  }
  async read1(size = -1) { return this.read(size); }
  async peek(n = 1) { await this._load(); return this._buf.slice(this._pos, this._pos + Math.max(1, n)); }
  async readline(size = -1) {
    await this._load();
    let end = this._buf.indexOf(0x0a, this._pos);
    end = end < 0 ? this._buf.length : end + 1;
    if (size !== null && size >= 0) end = Math.min(end, this._pos + size);
    const r = this._buf.slice(this._pos, end);
    this._pos = end;
    return r;
  }
  async readlines() { const out = []; for (;;) { const l = await this.readline(); if (!l.length) return out; out.push(l); } }
  write(data) {
    if (this.mode !== 2) throw new AdderError('OSError', 'write() on read-only GzipFile object');
    const b = _dtBytes(data);
    this._out.push(b);
    return b.length;
  }
  seek(offset, whence = 0) { this._pos = whence === 0 ? offset : whence === 1 ? this._pos + offset : (this._buf ? this._buf.length : 0) + offset; return this._pos; }
  tell() { return this._pos; }
  readable() { return this.mode === 1; } writable() { return this.mode === 2; } seekable() { return true; }
  flush() { return null; }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    if (this.mode === 2) {
      let n = 0; for (const b of this._out) n += b.length;
      const all = new Uint8Array(n); let p = 0; for (const b of this._out) { all.set(b, p); p += b.length; }
      const f = await this._src();
      await adderGetAttr(f, 'write')(await adderModules.gzip.compress(all));
      if (this._path !== null) await adderGetAttr(f, 'close')();
    } else if (this._path !== null && this.fileobj) await adderGetAttr(this.fileobj, 'close')();
    return null;
  }
  __enter__() { return this; }
  async __exit__() { await this.close(); return false; }
  async __iter__() { return (await this.readlines())[Symbol.iterator](); }
}
adderModules.gzip.GzipFile = _dtType('GzipFile', _DtGzipFile, 'gzip');
adderModules.gzip.READ = 1; adderModules.gzip.WRITE = 2;
// gzip.open: binary → GzipFile; text ('rt' / 'wt') → a TextIOWrapper around it
adderModules.gzip.open = (filename, mode = 'rb', ...a) => {
  const { args } = _dtArgs(a, ['compresslevel', 'encoding', 'errors', 'newline'], { compresslevel: 9, encoding: null, errors: null, newline: null });
  const binMode = String(mode).replace('t', '');
  const isObj = filename && typeof filename === 'object';
  const g = adderModules.gzip.GzipFile(isObj ? null : filename, binMode, args.compresslevel, isObj ? filename : null);
  return String(mode).includes('t') ? adderModules.io.TextIOWrapper(g, { _kw: true, encoding: args.encoding || 'utf-8', errors: args.errors || 'strict' }) : g;
};

// bz2 / lzma: no bzip2 or xz codec in the platform — the modules are there (libraries import
// them to offer .bz2 / .xz files as an option), and using one says so
{
  const no = (what) => () => { throw new AdderError('NotImplementedError', `${what} compression is not available here (no bzip2 / xz codec in the browser)`); };
  const cls = (name, what, module) => { const c = no(what); c._pyName = name; c.__name__ = name; c._pyClass = true; c.__module__ = module; return c; };
  adderModules.bz2 = { __adderModule__: true, __name__: 'bz2', compress: no('bz2'), decompress: no('bz2'), open: no('bz2'),
    BZ2File: cls('BZ2File', 'bz2', 'bz2'), BZ2Compressor: cls('BZ2Compressor', 'bz2', 'bz2'), BZ2Decompressor: cls('BZ2Decompressor', 'bz2', 'bz2') };
  const LZMAError = makeExcType('LZMAError', 'Exception');
  adderModules.lzma = { __adderModule__: true, __name__: 'lzma', compress: no('xz'), decompress: no('xz'), open: no('xz'), is_check_supported: () => false,
    LZMAFile: cls('LZMAFile', 'xz', 'lzma'), LZMACompressor: cls('LZMACompressor', 'xz', 'lzma'), LZMADecompressor: cls('LZMADecompressor', 'xz', 'lzma'), LZMAError,
    FORMAT_AUTO: 0, FORMAT_XZ: 1, FORMAT_ALONE: 2, FORMAT_RAW: 3, CHECK_NONE: 0, CHECK_CRC32: 1, CHECK_CRC64: 4, CHECK_SHA256: 10, CHECK_ID_MAX: 15, CHECK_UNKNOWN: 16,
    FILTER_LZMA1: 0x4000000000000001, FILTER_LZMA2: 0x21, FILTER_DELTA: 3, FILTER_X86: 4, PRESET_DEFAULT: 6, PRESET_EXTREME: 0x80000000, MODE_FAST: 1, MODE_NORMAL: 2 };
}

// ── zipfile ──
// ZipFile over a VFS path or a file object (BytesIO): read ('r'), write ('w', 'x') and append
// ('a'); ZIP_STORED and ZIP_DEFLATED; namelist / infolist / getinfo / read / open / writestr /
// write / extract / extractall / testzip; ZipInfo; is_zipfile. Not here: ZIP64, encryption,
// bzip2 / lzma, a streamed ZipFile.open for writing.
const _dtBadZip = makeExcType('zipfile.BadZipFile', 'Exception');
const _dtLargeZip = makeExcType('zipfile.LargeZipFile', 'Exception');
class _DtZipInfo {
  constructor(filename = 'NoName', date_time = mkTuple([1980, 1, 1, 0, 0, 0])) {
    if (filename && typeof filename === 'object' && filename._kw) { const kw = filename; filename = kw.filename ?? 'NoName'; date_time = kw.date_time ?? date_time; }
    this.filename = String(filename).replace(/\\/g, '/');
    this.date_time = mkTuple([...pyIter(date_time)]);
    this.compress_type = 0; this.compress_level = null; this.comment = new Uint8Array(0); this.extra = new Uint8Array(0);
    this.create_system = 3; this.create_version = 20; this.extract_version = 20; this.reserved = 0; this.flag_bits = 0;
    this.volume = 0; this.internal_attr = 0; this.external_attr = this.filename.endsWith('/') ? (0o40775 << 16) | 0x10 : 0o600 << 16;
    this.header_offset = 0; this.CRC = 0; this.compress_size = 0; this.file_size = 0;
  }
  is_dir() { return this.filename.endsWith('/'); }
  __repr__() {
    const parts = [`filename=${pyRepr(this.filename)}`];
    if (this.compress_type) parts.push(`compress_type=${this.compress_type === 8 ? 'deflate' : this.compress_type}`);
    const mode = this.external_attr >>> 16;
    if (mode) parts.push(`filemode=${pyRepr(_dtFilemode(mode))}`);
    if (this.is_dir()) parts.push('external_attr=0x10');
    if (!this.is_dir() || this.file_size) parts.push(`file_size=${this.file_size}`);
    if ((!this.is_dir() || this.compress_size) && (this.compress_type !== 0 || this.file_size !== this.compress_size)) parts.push(`compress_size=${this.compress_size}`);
    return `<ZipInfo ${parts.join(' ')}>`;
  }
}
function _dtFilemode(mode) {
  const t = (mode & 0o170000) === 0o040000 ? 'd' : '-';
  const perms = ['r', 'w', 'x'];
  let s = t;
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? perms[(8 - i) % 3] : '-';
  return s;
}
const _dtDosTime = (dt) => { const [y, mo, d, h, mi, s] = dt; return [((y - 1980) << 9) | (mo << 5) | d, (h << 11) | (mi << 5) | (s >> 1)]; };
const _dtNowTuple = () => { const t = new Date(); return mkTuple([t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()]); };
async function _dtVfsRead(path) {
  const vfs = getAdderVFS();
  if (!vfs) throw new AdderError('RuntimeError', 'filesystem not available');
  try { return await vfs.readFile(_resolvePath(String(path), _getVfsPath()), 'bytes'); }
  catch (e) { throw _mapVFSError(e); }
}
async function _dtVfsWrite(path, bytes) {
  const vfs = getAdderVFS();
  if (!vfs) throw new AdderError('RuntimeError', 'filesystem not available');
  const p = _resolvePath(String(path), _getVfsPath());
  const dir = p.slice(0, p.lastIndexOf('/'));
  if (dir) { try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ } }
  try { await vfs.writeFile(p, bytes); } catch (e) { throw _mapVFSError(e); }
}
class _DtZipFile {
  async _init(file, mode, compression, compresslevel) {
    if (!['r', 'w', 'x', 'a'].includes(mode)) throw new AdderError('ValueError', "ZipFile requires mode 'r', 'w', 'x', or 'a'");
    if (![0, 8].includes(compression)) throw new AdderError('NotImplementedError', 'That compression method is not supported');
    this.mode = mode; this.compression = compression; this.compresslevel = compresslevel;
    this._file = file; this.filename = typeof file === 'string' ? file : (file && file.name) || null;
    this._entries = []; this._data = new Map(); this._closed = false; this.comment = new Uint8Array(0); this.debug = 0;
    if (mode === 'r' || mode === 'a') {
      let bytes;
      if (typeof file === 'string' || (file && file._path && !file.read)) {
        try { bytes = await _dtVfsRead(typeof file === 'string' ? file : file._path); }
        catch (e) { if (mode === 'a' && e && e.pyType === 'FileNotFoundError') bytes = null; else throw e; }
      } else {
        const fseek = file.seek ? adderGetAttr(file, 'seek') : null;
        if (fseek) await fseek(0);
        bytes = _dtBytes(await adderGetAttr(file, 'read')());
      }
      if (bytes && bytes.length) this._parse(bytes);
      else if (mode === 'r') throw new AdderError('zipfile.BadZipFile', 'File is not a zip file');
    }
    return this;
  }
  _parse(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new AdderError('zipfile.BadZipFile', 'File is not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const clen = dv.getUint16(eocd + 20, true);
    this.comment = b.slice(eocd + 22, eocd + 22 + clen);
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new AdderError('zipfile.BadZipFile', 'Bad magic number for central directory');
      const flags = dv.getUint16(off + 8, true), method = dv.getUint16(off + 10, true);
      const time = dv.getUint16(off + 12, true), date = dv.getUint16(off + 14, true);
      const crc = dv.getUint32(off + 16, true), csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
      const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), cmlen = dv.getUint16(off + 32, true);
      const ext = dv.getUint32(off + 38, true), lho = dv.getUint32(off + 42, true);
      const nameBytes = b.slice(off + 46, off + 46 + nlen);
      const name = flags & 0x800 ? _dtDec.decode(nameBytes) : String.fromCharCode(...nameBytes);
      const zi = new _DtZipInfo(name, mkTuple([(date >> 9) + 1980, (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2]));
      Object.assign(zi, { compress_type: method, CRC: crc, compress_size: csize, file_size: usize, external_attr: ext, header_offset: lho, flag_bits: flags, create_system: b[off + 5] });
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      this._data.set(zi, { raw: b.slice(start, start + csize) });
      this._entries.push(zi);
      off += 46 + nlen + elen + cmlen;
    }
  }
  _check(mode) {
    if (this._closed) throw new AdderError('ValueError', 'Attempt to use ZIP archive that was already closed');
    if (mode === 'r' && this.mode !== 'r' && this.mode !== 'a') throw new AdderError('ValueError', 'read() requires mode "r"');
    if (mode === 'w' && this.mode === 'r') throw new AdderError('ValueError', 'write() requires mode "w", "x", or "a"');
  }
  namelist() { return this._entries.map((z) => z.filename); }
  infolist() { return [...this._entries]; }
  getinfo(name) {
    const z = this._entries.slice().reverse().find((e) => e.filename === (name instanceof _DtZipInfo ? name.filename : name));
    if (!z) throw new AdderError('KeyError', `"There is no item named ${pyRepr(name)} in the archive"`, undefined, [`There is no item named ${pyRepr(name)} in the archive`]);
    return z;
  }
  async read(name) {
    this._check('r');
    const zi = name instanceof _DtZipInfo ? name : this.getinfo(name);
    const ent = this._data.get(zi);
    let out;
    if (ent.plain) out = ent.plain;
    else if (zi.compress_type === 0) out = ent.raw;
    else if (zi.compress_type === 8) out = await _dtStream(ent.raw, globalThis.DecompressionStream, 'deflate-raw');
    else throw new AdderError('NotImplementedError', 'That compression method is not supported');
    if (_dtCrc32(out) !== zi.CRC) throw new AdderError('zipfile.BadZipFile', `Bad CRC-32 for file ${pyRepr(zi.filename)}`);
    return out;
  }
  async open(name, mode = 'r') {
    if (mode !== 'r' && !(mode && mode._kw && (mode.mode ?? 'r') === 'r')) throw new AdderError('NotImplementedError', "ZipFile.open() supports mode 'r' only here; use writestr() to add a member");
    const data = await this.read(name);
    return adderModules.io.BytesIO(data);
  }
  async writestr(zinfo, data, ...a) {
    this._check('w');
    const { args } = _dtArgs(a, ['compress_type', 'compresslevel'], { compress_type: null, compresslevel: null });
    const zi = zinfo instanceof _DtZipInfo ? zinfo : new _DtZipInfo(String(zinfo), _dtNowTuple());
    if (!(zinfo instanceof _DtZipInfo)) zi.compress_type = this.compression;
    if (args.compress_type !== null) zi.compress_type = args.compress_type;
    const bytes = typeof data === 'string' ? _dtEnc.encode(data) : _dtBytes(data);
    zi.file_size = bytes.length; zi.CRC = _dtCrc32(bytes);
    const raw = zi.compress_type === 8 ? await _dtStream(bytes, globalThis.CompressionStream, 'deflate-raw') : bytes;
    zi.compress_size = raw.length;
    if (zi.filename.endsWith('/')) zi.external_attr = (0o40775 << 16) | 0x10;
    this._entries.push(zi);
    this._data.set(zi, { raw, plain: bytes });
    return null;
  }
  async write(filename, arcname = null, ...a) {
    const { args } = _dtArgs(a, ['compress_type', 'compresslevel'], { compress_type: null, compresslevel: null });
    if (arcname && arcname._kw) { args.compress_type = arcname.compress_type ?? null; arcname = arcname.arcname ?? null; }
    const bytes = await _dtVfsRead(filename);
    const name = String(arcname ?? filename).replace(/^\/+/, '');
    const zi = new _DtZipInfo(name, _dtNowTuple());
    zi.compress_type = args.compress_type ?? this.compression;
    return this.writestr(zi, bytes);
  }
  async extract(member, path = null) {
    const zi = member instanceof _DtZipInfo ? member : this.getinfo(member);
    const base = path === null ? _getVfsPath() || '/' : String(path);
    const target = `${base.replace(/\/$/, '')}/${zi.filename}`;
    if (zi.is_dir()) { const vfs = getAdderVFS(); try { await vfs.mkdir(_resolvePath(target, _getVfsPath()), { recursive: true }); } catch { /* exists */ } return target; }
    await _dtVfsWrite(target, await this.read(zi));
    return target;
  }
  async extractall(path = null, members = null) {
    if (path && path._kw) { members = path.members ?? null; path = path.path ?? null; }
    const list = members === null ? this._entries : [...pyIter(members)].map((m) => (m instanceof _DtZipInfo ? m : this.getinfo(m)));
    for (const zi of list) await this.extract(zi, path);
    return null;
  }
  async testzip() { for (const zi of this._entries) { try { await this.read(zi); } catch { return zi.filename; } } return null; }
  printdir() { _stdio.out && _stdio.out(this._entries.map((z) => `${z.filename.padEnd(46)} ${z.date_time.slice(0, 3).map((v, i) => String(v).padStart(i ? 2 : 4, '0')).join('-')} ${z.date_time.slice(3).map((v) => String(v).padStart(2, '0')).join(':')} ${String(z.file_size).padStart(12)}`).join('\n') + '\n'); return null; }
  _build() {
    const parts = [], central = [];
    let off = 0;
    for (const zi of this._entries) {
      const { raw } = this._data.get(zi);
      const nameB = _dtEnc.encode(zi.filename);
      const utf8 = [...zi.filename].some((c) => c.charCodeAt(0) > 127);
      const flags = utf8 ? 0x800 : 0;
      const [date, time] = _dtDosTime(zi.date_time);
      const lh = new Uint8Array(30 + nameB.length), l = new DataView(lh.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, flags, true); l.setUint16(8, zi.compress_type, true);
      l.setUint16(10, time, true); l.setUint16(12, date, true); l.setUint32(14, zi.CRC, true); l.setUint32(18, raw.length, true);
      l.setUint32(22, zi.file_size, true); l.setUint16(26, nameB.length, true); l.setUint16(28, 0, true); lh.set(nameB, 30);
      const ch = new Uint8Array(46 + nameB.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, (3 << 8) | 20, true); c.setUint16(6, 20, true); c.setUint16(8, flags, true);
      c.setUint16(10, zi.compress_type, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, zi.CRC, true);
      c.setUint32(20, raw.length, true); c.setUint32(24, zi.file_size, true); c.setUint16(28, nameB.length, true);
      c.setUint32(38, zi.external_attr >>> 0, true); c.setUint32(42, off, true); ch.set(nameB, 46);
      zi.header_offset = off;
      parts.push(lh, raw); central.push(ch);
      off += lh.length + raw.length;
    }
    const cd = _dtConcat(central);
    const end = new Uint8Array(22 + this.comment.length), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this._entries.length, true); e.setUint16(10, this._entries.length, true);
    e.setUint32(12, cd.length, true); e.setUint32(16, off, true); e.setUint16(20, this.comment.length, true); end.set(this.comment, 22);
    return _dtConcat([...parts, cd, end]);
  }
  async close() {
    if (this._closed) return null;
    if (this.mode !== 'r') {
      const bytes = this._build();
      if (typeof this._file === 'string') await _dtVfsWrite(this._file, bytes);
      else {
        const f = this._file;
        if (f.seek) { await adderGetAttr(f, 'seek')(0); }
        await adderGetAttr(f, 'write')(bytes);
        if (f.truncate) { try { await adderGetAttr(f, 'truncate')(); } catch { /* not truncatable */ } }
      }
    }
    this._closed = true;
    return null;
  }
  __enter__() { return this; }
  async __exit__() { await this.close(); return false; }
  __repr__() { return `<zipfile.ZipFile ${this.filename ? `filename=${pyRepr(this.filename)} ` : ''}mode=${pyRepr(this.mode)}${this._closed ? ' [closed]' : ''}>`; }
}
_DtZipFile.prototype.__adderClass__ = 'ZipFile';
const _dtZipFileCtor = (file, ...a) => {
  const { args } = _dtArgs(a, ['mode', 'compression', 'allowZip64', 'compresslevel'], { mode: 'r', compression: 0, allowZip64: true, compresslevel: null });
  return new _DtZipFile()._init(file, args.mode, args.compression, args.compresslevel);
};
_dtZipFileCtor._pyName = 'ZipFile'; _dtZipFileCtor._pyClass = true; _dtZipFileCtor.__name__ = 'ZipFile';
_DtZipFile.prototype.__adderType__ = _dtZipFileCtor;
adderModules.zipfile = {
  ZipFile: _dtZipFileCtor, ZipInfo: _dtType('ZipInfo', _DtZipInfo, 'zipfile'),
  is_zipfile: async (f) => {
    try {
      const b = typeof f === 'string' ? await _dtVfsRead(f) : _dtBytes(await (async () => { if (f.seek) await adderGetAttr(f, 'seek')(0); return adderGetAttr(f, 'read')(); })());
      for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) return true;
      return false;
    } catch { return false; }
  },
  ZIP_STORED: 0, ZIP_DEFLATED: 8, ZIP_BZIP2: 12, ZIP_LZMA: 14,
  BadZipFile: _dtBadZip, BadZipfile: _dtBadZip, LargeZipFile: _dtLargeZip, error: _dtBadZip,
};

// ── uuid ──
// UUID (from hex / bytes / bytes_le / fields / int), uuid1 (random node), uuid3, uuid4, uuid5,
// the NAMESPACE_* constants, CPython's str / repr / urn / version / variant.
const _dtRandBytes = (n) => { const b = new Uint8Array(n); if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); return b; };
class _DtUUID {
  constructor(...a) {
    const { args } = _dtArgs(a, ['hex', 'bytes', 'bytes_le', 'fields', 'int', 'version'], { hex: null, bytes: null, bytes_le: null, fields: null, int: null, version: null });
    const given = ['hex', 'bytes', 'bytes_le', 'fields', 'int'].filter((k) => args[k] !== null);
    if (given.length !== 1) throw new AdderError('TypeError', 'one of the hex, bytes, bytes_le, fields, or int arguments must be given');
    let n;
    if (args.hex !== null) {
      const h = String(args.hex).replace(/^urn:/, '').replace(/^uuid:/, '').replace(/[{}-]/g, '').trim();
      if (!/^[0-9a-fA-F]{32}$/.test(h)) throw new AdderError('ValueError', 'badly formed hexadecimal UUID string');
      n = BigInt('0x' + h);
    } else if (args.bytes !== null) {
      const b = _dtBytes(args.bytes);
      if (b.length !== 16) throw new AdderError('ValueError', 'bytes is not a 16-char string');
      n = BigInt('0x' + _dtHexOf(b));
    } else if (args.bytes_le !== null) {
      const b = _dtBytes(args.bytes_le);
      if (b.length !== 16) throw new AdderError('ValueError', 'bytes_le is not a 16-char string');
      const r = Uint8Array.from([b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6], ...b.slice(8)]);
      n = BigInt('0x' + _dtHexOf(r));
    } else if (args.fields !== null) {
      const [tl, tm, th, csh, csl, node] = [...pyIter(args.fields)].map(BigInt);
      n = (tl << 96n) | (tm << 80n) | (th << 64n) | (((csh << 8n) | csl) << 48n) | node;
    } else {
      n = BigInt(args.int);
      if (n < 0n || n >= 1n << 128n) throw new AdderError('ValueError', 'int is out of range (need a 128-bit value)');
    }
    if (args.version !== null) {
      n &= ~(0xc000n << 48n); n |= 0x8000n << 48n;
      n &= ~(0xf000n << 64n); n |= BigInt(args.version) << 76n;
    }
    this._n = n;
  }
  get int() { return this._n <= 9007199254740991n ? Number(this._n) : this._n; }
  get hex() { return this._n.toString(16).padStart(32, '0'); }
  get bytes() { const h = this.hex; return Uint8Array.from({ length: 16 }, (_, i) => parseInt(h.substr(2 * i, 2), 16)); }
  get bytes_le() { const b = this.bytes; return Uint8Array.from([b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6], ...b.slice(8)]); }
  get urn() { return `urn:uuid:${this.__str__()}`; }
  get variant() {
    const v = Number((this._n >> 61n) & 7n);
    if (!(v & 4)) return 'reserved for NCS compatibility';
    if (!(v & 2)) return 'specified in RFC 4122';
    if (!(v & 1)) return 'reserved for Microsoft compatibility';
    return 'reserved for future definition';
  }
  get version() { return this.variant === 'specified in RFC 4122' ? Number((this._n >> 76n) & 0xfn) : null; }
  get time_low() { return Number(this._n >> 96n); }
  get time_mid() { return Number((this._n >> 80n) & 0xffffn); }
  get time_hi_version() { return Number((this._n >> 64n) & 0xffffn); }
  get clock_seq_hi_variant() { return Number((this._n >> 56n) & 0xffn); }
  get clock_seq_low() { return Number((this._n >> 48n) & 0xffn); }
  get node() { return Number(this._n & 0xffffffffffffn); }
  get fields() { return mkTuple([this.time_low, this.time_mid, this.time_hi_version, this.clock_seq_hi_variant, this.clock_seq_low, this.node]); }
  __str__() { const h = this.hex; return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
  __repr__() { return `UUID('${this.__str__()}')`; }
  __eq__(o) { return o instanceof _DtUUID && o._n === this._n; }
  __lt__(o) { if (!(o instanceof _DtUUID)) throw new AdderError('TypeError', `'<' not supported between instances of 'UUID' and '${pyTypeName(o)}'`); return this._n < o._n; }
  __gt__(o) { if (!(o instanceof _DtUUID)) throw new AdderError('TypeError', `'>' not supported between instances of 'UUID' and '${pyTypeName(o)}'`); return this._n > o._n; }
  __le__(o) { return this._n <= o._n; }
  __ge__(o) { return this._n >= o._n; }
  __hash__() { return _pyHash(Number(this._n % 9007199254740991n)); }
  __int__() { return this.int; }
}
const _dtUuidType = _dtType('UUID', _DtUUID, 'uuid');
const _dtUuidName = (alg, ns, name) => {
  const data = _dtConcat([ns.bytes, typeof name === 'string' ? _dtEnc.encode(name) : _dtBytes(name)]);
  const h = _DT_HASHES[alg].fn(data).slice(0, 16);
  return new _DtUUID({ _kw: true, bytes: h, version: alg === 'md5' ? 3 : 5 });
};
let _dtClockSeq = null;
adderModules.uuid = {
  UUID: _dtUuidType,
  uuid4: () => new _DtUUID({ _kw: true, bytes: _dtRandBytes(16), version: 4 }),
  uuid3: (ns, name) => _dtUuidName('md5', ns, name),
  uuid5: (ns, name) => _dtUuidName('sha1', ns, name),
  uuid1: (node = null, clock_seq = null) => {
    const ns100 = BigInt(Date.now()) * 10000n + 0x01b21dd213814000n;
    if (clock_seq === null) { if (_dtClockSeq === null) _dtClockSeq = (_dtRandBytes(2)[0] << 6 | _dtRandBytes(1)[0]) & 0x3fff; clock_seq = _dtClockSeq; }
    if (node === null) { const r = _dtRandBytes(6); r[0] |= 1; node = Number(BigInt('0x' + _dtHexOf(r))); }
    const tl = ns100 & 0xffffffffn, tm = (ns100 >> 32n) & 0xffffn, th = (ns100 >> 48n) & 0x0fffn;
    return new _DtUUID({ _kw: true, fields: mkTuple([tl, tm, th, (clock_seq >> 8) & 0x3f, clock_seq & 0xff, node]), version: 1 });
  },
  NAMESPACE_DNS: new _DtUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
  NAMESPACE_URL: new _DtUUID('6ba7b811-9dad-11d1-80b4-00c04fd430c8'),
  NAMESPACE_OID: new _DtUUID('6ba7b812-9dad-11d1-80b4-00c04fd430c8'),
  NAMESPACE_X500: new _DtUUID('6ba7b814-9dad-11d1-80b4-00c04fd430c8'),
  RESERVED_NCS: 'reserved for NCS compatibility', RFC_4122: 'specified in RFC 4122',
  RESERVED_MICROSOFT: 'reserved for Microsoft compatibility', RESERVED_FUTURE: 'reserved for future definition',
};

// ── urllib.parse ──
// urlparse / urlsplit / urlunparse / urlunsplit / urljoin / urldefrag, quote / quote_plus /
// unquote / unquote_plus / urlencode / parse_qs / parse_qsl, written after CPython's
// urllib/parse.py (its scheme tables, its RFC 3986 dot-segment resolution).
const _DT_USES_RELATIVE = ['', 'ftp', 'http', 'gopher', 'nntp', 'imap', 'wais', 'file', 'https', 'shttp', 'mms', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'sftp', 'svn', 'svn+ssh', 'ws', 'wss'];
const _DT_USES_NETLOC = ['', 'ftp', 'http', 'gopher', 'nntp', 'telnet', 'imap', 'wais', 'file', 'mms', 'https', 'shttp', 'snews', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'rsync', 'svn', 'svn+ssh', 'sftp', 'nfs', 'git', 'git+ssh', 'ws', 'wss', 'itms-services'];
const _DT_USES_PARAMS = ['', 'ftp', 'hdl', 'prospero', 'http', 'imap', 'https', 'shttp', 'rtsp', 'rtsps', 'rtspu', 'sip', 'sips', 'mms', 'sftp', 'tel'];
const _DT_SCHEME_CHARS = /^[A-Za-z0-9+\-.]+$/;
function _dtNetlocParts(netloc) {
  let userinfo = null, hostport = netloc;
  const at = netloc.lastIndexOf('@');
  if (at >= 0) { userinfo = netloc.slice(0, at); hostport = netloc.slice(at + 1); }
  let username = null, password = null;
  if (userinfo !== null) { const c = userinfo.indexOf(':'); if (c >= 0) { username = userinfo.slice(0, c); password = userinfo.slice(c + 1); } else username = userinfo; }
  let hostname, port = null;
  if (hostport.startsWith('[')) { const e = hostport.indexOf(']'); hostname = hostport.slice(1, e); const rest = hostport.slice(e + 1); if (rest.startsWith(':')) port = rest.slice(1); }
  else { const c = hostport.indexOf(':'); if (c >= 0) { hostname = hostport.slice(0, c); port = hostport.slice(c + 1); } else hostname = hostport; }
  return { username, password, hostname: hostname ? hostname.toLowerCase() : null, port };
}
function _dtResultType(name, fields, geturl) {
  const T = _namedtuple(name, fields);
  const proto = Object.getPrototypeOf(T(...fields.map(() => '')));
  for (const k of ['username', 'password', 'hostname']) Object.defineProperty(proto, k, { get() { return _dtNetlocParts(this.netloc)[k]; }, configurable: true });
  Object.defineProperty(proto, 'port', {
    get() {
      const p = _dtNetlocParts(this.netloc).port;
      if (p === null || p === '') return null;
      if (!/^\d+$/.test(p)) throw new AdderError('ValueError', `Port could not be cast to integer value as ${pyRepr(p)}`);
      const n = Number(p);
      if (n > 65535) throw new AdderError('ValueError', 'Port out of range 0-65535');
      return n;
    }, configurable: true,
  });
  proto.geturl = function () { return geturl(this); };
  proto.encode = function () { return this; };
  return T;
}
const _dtSplitResult = _dtResultType('SplitResult', ['scheme', 'netloc', 'path', 'query', 'fragment'], (r) => _dtUrlunsplit(r));
const _dtParseResult = _dtResultType('ParseResult', ['scheme', 'netloc', 'path', 'params', 'query', 'fragment'], (r) => _dtUrlunparse(r));
const _dtDefragResult = _namedtuple('DefragResult', ['url', 'fragment']);
Object.getPrototypeOf(_dtDefragResult('', '')).geturl = function () { return this.fragment ? `${this.url}#${this.fragment}` : this.url; };
function _dtUrlsplit(url, scheme = '', allowFragments = true) {
  url = String(url).replace(/^[\x00-\x20]+/, '').replace(/[\t\r\n]/g, '');
  scheme = String(scheme).replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\r\n]/g, '');
  let netloc = '', query = '', fragment = '';
  const i = url.indexOf(':');
  if (i > 0 && /^[A-Za-z]/.test(url[0]) && _DT_SCHEME_CHARS.test(url.slice(0, i))) { scheme = url.slice(0, i).toLowerCase(); url = url.slice(i + 1); }
  if (url.slice(0, 2) === '//') {
    let delim = url.length;
    for (const c of '/?#') { const w = url.indexOf(c, 2); if (w >= 0) delim = Math.min(delim, w); }
    netloc = url.slice(2, delim); url = url.slice(delim);
    if ((netloc.includes('[') && !netloc.includes(']')) || (netloc.includes(']') && !netloc.includes('['))) throw new AdderError('ValueError', 'Invalid IPv6 URL');
  }
  if (allowFragments && url.includes('#')) { const k = url.indexOf('#'); fragment = url.slice(k + 1); url = url.slice(0, k); }
  if (url.includes('?')) { const k = url.indexOf('?'); query = url.slice(k + 1); url = url.slice(0, k); }
  return _dtSplitResult(scheme, netloc, url, query, fragment);
}
function _dtUrlparse(url, scheme = '', allowFragments = true) {
  const [sch, netloc, path0, query, fragment] = _dtUrlsplit(url, scheme, allowFragments);
  let path = path0, params = '';
  if (_DT_USES_PARAMS.includes(sch) && path.includes(';')) {
    let i;
    if (path.includes('/')) { i = path.indexOf(';', path.lastIndexOf('/')); if (i < 0) i = null; }
    else i = path.indexOf(';');
    if (i !== null) { params = path.slice(i + 1); path = path.slice(0, i); }
  }
  return _dtParseResult(sch, netloc, path, params, query, fragment);
}
function _dtUrlunsplit(parts) {
  let [scheme, netloc, url, query, fragment] = [...pyIter(parts)].map((x) => x ?? '');
  if (netloc) { if (url && url[0] !== '/') url = '/' + url; url = '//' + netloc + url; }
  else if (url.slice(0, 2) === '//') url = '//' + url;
  else if (scheme && _DT_USES_NETLOC.includes(scheme) && (!url || url[0] === '/')) url = '//' + url;
  if (scheme) url = scheme + ':' + url;
  if (query) url = url + '?' + query;
  if (fragment) url = url + '#' + fragment;
  return url;
}
function _dtUrlunparse(parts) {
  let [scheme, netloc, url, params, query, fragment] = [...pyIter(parts)].map((x) => x ?? '');
  if (params) url = `${url};${params}`;
  return _dtUrlunsplit([scheme, netloc, url, query, fragment]);
}
function _dtUrljoin(base, url, allowFragments = true) {
  if (!base) return url;
  if (!url) return base;
  const [bscheme, bnetloc, bpath, bparams, bquery] = _dtUrlparse(base, '', allowFragments);
  let [scheme, netloc, path, params, query, fragment] = _dtUrlparse(url, bscheme, allowFragments);
  if (scheme !== bscheme || !_DT_USES_RELATIVE.includes(scheme)) return url;
  if (_DT_USES_NETLOC.includes(scheme)) {
    if (netloc) return _dtUrlunparse([scheme, netloc, path, params, query, fragment]);
    netloc = bnetloc;
  }
  if (!path && !params) {
    path = bpath; params = bparams;
    if (!query) query = bquery;
    return _dtUrlunparse([scheme, netloc, path, params, query, fragment]);
  }
  const baseParts = bpath.split('/');
  if (baseParts[baseParts.length - 1] !== '') baseParts.pop();
  let segments;
  if (path[0] === '/') segments = path.split('/');
  else {
    segments = [...baseParts, ...path.split('/')];
    segments = [segments[0], ...segments.slice(1, -1).filter(Boolean), ...(segments.length > 1 ? [segments[segments.length - 1]] : [])];
  }
  const resolved = [];
  for (const seg of segments) {
    if (seg === '..') { if (resolved.length) resolved.pop(); }
    else if (seg === '.') continue;
    else resolved.push(seg);
  }
  if (segments[segments.length - 1] === '.' || segments[segments.length - 1] === '..') resolved.push('');
  return _dtUrlunparse([scheme, netloc, resolved.join('/') || '/', params, query, fragment]);
}
const _DT_ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;
function _dtQuote(s, safe = '/', encoding = null, errors = null) {
  if (safe && typeof safe === 'object' && safe._kw) { const kw = safe; safe = kw.safe ?? '/'; }
  const bytes = typeof s === 'string' ? _dtEnc.encode(s) : _dtBytes(s);
  const safeSet = typeof safe === 'string' ? safe : _dtDec.decode(safe);
  let out = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (b < 128 && (_DT_ALWAYS_SAFE.test(c) || safeSet.includes(c))) out += c;
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
function _dtQuotePlus(s, safe = '', encoding = null, errors = null) {
  if (safe && typeof safe === 'object' && safe._kw) safe = safe.safe ?? '';
  const str = typeof s === 'string' ? s : _dtDec.decode(_dtBytes(s));
  if (str.includes(' ')) return _dtQuote(str, safe + ' ').replace(/ /g, '+');
  return _dtQuote(s, safe);
}
function _dtUnquote(s) {
  if (s instanceof Uint8Array) s = _dtDec.decode(s);
  if (!String(s).includes('%')) return String(s);
  return String(s).replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Uint8Array.from(run.match(/%([0-9A-Fa-f]{2})/g).map((h) => parseInt(h.slice(1), 16)));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  });
}
function _dtParseQsl(qs, ...a) {
  const { args } = _dtArgs(a, ['keep_blank_values', 'strict_parsing', 'encoding', 'errors', 'max_num_fields', 'separator'],
    { keep_blank_values: false, strict_parsing: false, encoding: 'utf-8', errors: 'replace', max_num_fields: null, separator: '&' });
  const r = [];
  const fields = qs ? String(qs).split(args.separator) : [];
  if (args.max_num_fields !== null && fields.length > args.max_num_fields) throw new AdderError('ValueError', 'Max number of fields exceeded');
  for (const nv0 of fields) {
    if (!nv0 && !args.strict_parsing) continue;
    const k = nv0.indexOf('=');
    const nv = k >= 0 ? [nv0.slice(0, k), nv0.slice(k + 1)] : [nv0];
    if (nv.length !== 2) {
      if (args.strict_parsing) throw new AdderError('ValueError', `bad query field: ${pyRepr(nv0)}`);
      if (args.keep_blank_values) nv.push(''); else continue;
    }
    if (nv[1].length || args.keep_blank_values) r.push(mkTuple([_dtUnquote(nv[0].replace(/\+/g, ' ')), _dtUnquote(nv[1].replace(/\+/g, ' '))]));
  }
  return r;
}
function _dtUrlencode(query, ...a) {
  const { args } = _dtArgs(a, ['doseq', 'safe', 'encoding', 'errors', 'quote_via'], { doseq: false, safe: '', encoding: null, errors: null, quote_via: null });
  const q = args.quote_via || _dtQuotePlus;
  const pairs = query instanceof Map ? [...query] : isPlainDict(query) ? Object.entries(query) : [...pyIter(query)].map((p) => [...pyIter(p)]);
  const enc = (v) => (v instanceof Uint8Array ? q(v, args.safe) : q(pyStr(v), args.safe));
  const out = [];
  for (const [k, v] of pairs) {
    if (!args.doseq || typeof v === 'string' || v instanceof Uint8Array || !(Array.isArray(v) || v instanceof Set || (v && typeof v[Symbol.iterator] === 'function'))) out.push(`${enc(k)}=${enc(v)}`);
    else for (const x of pyIter(v)) out.push(`${enc(k)}=${enc(x)}`);
  }
  return out.join('&');
}
const _dtUrlParseMod = {
  urlparse: (url, ...a) => { const { args } = _dtArgs(a, ['scheme', 'allow_fragments'], { scheme: '', allow_fragments: true }); return _dtUrlparse(url, args.scheme, args.allow_fragments); },
  urlsplit: (url, ...a) => { const { args } = _dtArgs(a, ['scheme', 'allow_fragments'], { scheme: '', allow_fragments: true }); return _dtUrlsplit(url, args.scheme, args.allow_fragments); },
  urlunparse: _dtUrlunparse, urlunsplit: _dtUrlunsplit,
  urljoin: (base, url, ...a) => { const { args } = _dtArgs(a, ['allow_fragments'], { allow_fragments: true }); return _dtUrljoin(base, url, args.allow_fragments); },
  urldefrag: (url) => {
    if (String(url).includes('#')) { const [s, n, p, pa, q, frag] = _dtUrlparse(url); return _dtDefragResult(_dtUrlunparse([s, n, p, pa, q, '']), frag); }
    return _dtDefragResult(String(url), '');
  },
  quote: _dtQuote, quote_plus: _dtQuotePlus,
  quote_from_bytes: (b, safe = '/') => _dtQuote(_dtBytes(b), safe),
  unquote: _dtUnquote, unquote_plus: (s) => _dtUnquote(String(s).replace(/\+/g, ' ')),
  unquote_to_bytes: (s) => _dtEnc.encode(_dtUnquote(s)),
  urlencode: _dtUrlencode, parse_qsl: _dtParseQsl,
  parse_qs: (qs, ...a) => {
    const d = {};
    for (const [k, v] of _dtParseQsl(qs, ...a)) (d[k] || (d[k] = [])).push(v);
    return d;
  },
  SplitResult: _dtSplitResult, ParseResult: _dtParseResult, DefragResult: _dtDefragResult,
  uses_relative: _DT_USES_RELATIVE, uses_netloc: _DT_USES_NETLOC, uses_params: _DT_USES_PARAMS,
};
adderModules['urllib.parse'] = _dtUrlParseMod;
adderModules.urllib = Object.assign(adderModules.urllib || {}, { parse: _dtUrlParseMod });

// ── warnings ──
// warn / warn_explicit / simplefilter / filterwarnings / resetwarnings / catch_warnings(record=)
// with the actions default, error, ignore, always, module, once. Shown warnings go to stderr as
// "<adder>:1: UserWarning: message" (adder has no frame line to show).
let _dtFilters = [];
let _dtOnceSeen = new Set();
let _dtShowTarget = null;
const _dtWarningMessage = (message, category, filename, lineno) => ({
  __adderClass__: 'WarningMessage', message, category, filename, lineno, file: null, line: null, source: null,
  __str__() { return `{message : ${pyRepr(message)}, category : ${pyRepr(category && category.__name__)}, filename : ${pyRepr(filename)}, lineno : ${lineno}, line : None}`; },
});
const _dtCatName = (c) => (c && (c.__name__ || c._pyName)) || 'UserWarning';
const _dtIsSubcat = (cat, filt) => {
  if (!filt) return true;
  const a = _dtCatName(cat), b = _dtCatName(filt);
  if (a === b || b === 'Warning' || b === 'Exception' || b === 'BaseException') return true;
  if (typeof cat === 'function' && cat._pyMRO) return cat._pyMRO.some((c) => c === filt || _dtCatName(c) === b);
  return false;
};
function _dtWarn(message, ...a) {
  const { args } = _dtArgs(a, ['category', 'stacklevel', 'source', 'skip_file_prefixes'], { category: null, stacklevel: 1, source: null, skip_file_prefixes: null });
  let category = args.category;
  let text;
  if (message instanceof AdderError || (message && message.__adderType__)) { category = excTypeOf(message) || message.__adderType__; text = pyStr(message); }
  else { text = pyStr(message); if (!category) category = _typeObjects.UserWarning || null; }
  const catName = category ? _dtCatName(category) : 'UserWarning';
  let action = 'default';
  for (const f of _dtFilters) {
    if (f.message && !new RegExp(`^(?:${f.message})`, 'i').test(text)) continue;
    if (!_dtIsSubcat(category, f.category)) continue;
    action = f.action; break;
  }
  if (action === 'ignore') return null;
  if (action === 'error') {
    if (message instanceof AdderError) throw message;
    if (category && typeof category === 'function') { const e = category(text); throw e instanceof AdderError ? e : new AdderError(catName, text); }
    throw new AdderError(catName, text);
  }
  const key = `${catName}:${text}`;
  if ((action === 'default' || action === 'module' || action === 'once') && _dtOnceSeen.has(key)) return null;
  _dtOnceSeen.add(key);
  const msg = _dtWarningMessage(message instanceof AdderError ? message : (category ? category(text) : text), category, '<adder>', 1);
  if (_dtShowTarget) { _dtShowTarget.push(msg); return null; }
  const line = `<adder>:1: ${catName}: ${text}\n`;
  if (_stdio.err) _stdio.err(line); else if (typeof console !== 'undefined') console.warn(line.trimEnd());
  return null;
}
class _DtCatchWarnings {
  constructor(...a) { const { args } = _dtArgs(a, ['record', 'module', 'action', 'category'], { record: false, module: null, action: null, category: null }); this._record = !!args.record; this._action = args.action; this._category = args.category; }
  __enter__() {
    this._saved = [_dtFilters, _dtShowTarget, _dtOnceSeen];
    _dtFilters = [..._dtFilters];
    _dtOnceSeen = new Set(_dtOnceSeen);
    if (this._action) _dtFilters.unshift({ action: this._action, category: this._category, message: '' });
    if (this._record) { _dtShowTarget = []; return _dtShowTarget; }
    return null;
  }
  __exit__() { [_dtFilters, _dtShowTarget, _dtOnceSeen] = this._saved; return false; }
}
adderModules.warnings = {
  warn: _dtWarn,
  warn_explicit: (message, category, filename, lineno) => _dtWarn(message, { _kw: true, category }),
  simplefilter: (action, ...a) => { const { args } = _dtArgs(a, ['category', 'lineno', 'append'], { category: null, lineno: 0, append: false }); const f = { action, category: args.category, message: '' }; if (args.append) _dtFilters.push(f); else _dtFilters.unshift(f); return null; },
  filterwarnings: (action, ...a) => { const { args } = _dtArgs(a, ['message', 'category', 'module', 'lineno', 'append'], { message: '', category: null, module: '', lineno: 0, append: false }); const f = { action, category: args.category, message: args.message }; if (args.append) _dtFilters.push(f); else _dtFilters.unshift(f); return null; },
  resetwarnings: () => { _dtFilters = []; _dtOnceSeen = new Set(); return null; },
  catch_warnings: _dtType('catch_warnings', _DtCatchWarnings, 'warnings'),
  showwarning: (message, category, filename, lineno) => { const line = `${filename}:${lineno}: ${_dtCatName(category)}: ${pyStr(message)}\n`; if (_stdio.err) _stdio.err(line); return null; },
  formatwarning: (message, category, filename, lineno) => `${filename}:${lineno}: ${_dtCatName(category)}: ${pyStr(message)}\n`,
  get filters() { return _dtFilters.map((f) => mkTuple([f.action, f.message || null, f.category, null, 0])); },
};

// ── logging ──
// Loggers in a dotted hierarchy (propagation to the parents' handlers), the root logger and the
// last-resort handler, basicConfig, Formatter with %-style / {-style / $-style formats,
// StreamHandler / NullHandler / FileHandler (VFS), Filters, the level table. exception() adds
// the exception's "Type: message" line in place of a traceback.
const _DT_LEVELS = { CRITICAL: 50, FATAL: 50, ERROR: 40, WARNING: 30, WARN: 30, INFO: 20, DEBUG: 10, NOTSET: 0 };
const _dtLevelNames = { 50: 'CRITICAL', 40: 'ERROR', 30: 'WARNING', 20: 'INFO', 10: 'DEBUG', 0: 'NOTSET' };
const _dtLevelOf = (l) => {
  if (typeof l === 'number') return l;
  if (typeof l === 'string') { if (!(l.toUpperCase() in _DT_LEVELS) && !Object.values(_dtLevelNames).includes(l)) throw new AdderError('ValueError', `Unknown level: ${pyRepr(l)}`); return _DT_LEVELS[l.toUpperCase()] ?? Number(Object.keys(_dtLevelNames).find((k) => _dtLevelNames[k] === l)); }
  throw new AdderError('TypeError', `Level not an integer or a valid string: ${pyRepr(l)}`);
};
const _dtT0 = Date.now();
class _DtLogRecord {
  constructor(name, level, msg, args, exc) {
    this.name = name; this.levelno = level; this.levelname = _dtLevelNames[level] ?? `Level ${level}`;
    this.msg = msg; this.args = args; this.exc_info = exc || null; this.exc_text = null;
    this.created = Date.now() / 1000; this.msecs = Math.floor((Date.now() % 1000)); this.relativeCreated = Date.now() - _dtT0;
    this.pathname = '<adder>'; this.filename = '<adder>'; this.module = '<adder>'; this.lineno = 1; this.funcName = '<module>';
    this.process = 1; this.processName = 'MainProcess'; this.thread = 1; this.threadName = 'MainThread'; this.taskName = null; this.stack_info = null;
  }
  getMessage() {
    let m = pyStr(this.msg);
    if (this.args && (!Array.isArray(this.args) || this.args.length)) {
      const a = Array.isArray(this.args) && this.args.length === 1 && (isPlainDict(this.args[0]) || this.args[0] instanceof Map) ? this.args[0] : Array.isArray(this.args) ? mkTuple(this.args) : this.args;
      m = pyPercentFormat(m, a);
    }
    return m;
  }
}
_DtLogRecord.prototype.__adderClass__ = 'LogRecord';
class _DtFormatter {
  constructor(...a) {
    const { args } = _dtArgs(a, ['fmt', 'datefmt', 'style', 'validate', 'defaults'], { fmt: null, datefmt: null, style: '%', validate: true, defaults: null });
    this._style = args.style;
    this._fmt = args.fmt ?? (args.style === '{' ? '{message}' : args.style === '$' ? '${message}' : '%(message)s');
    this.datefmt = args.datefmt;
    this.default_time_format = '%Y-%m-%d %H:%M:%S'; this.default_msec_format = '%s,%03d';
  }
  usesTime() { return /asctime/.test(this._fmt); }
  formatTime(record, datefmt = null) {
    const t = new Date(record.created * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const base = (datefmt || this.default_time_format).replace(/%([YmdHMSyb%jpIAaBf])/g, (_, c) => ({
      Y: t.getFullYear(), m: pad(t.getMonth() + 1), d: pad(t.getDate()), H: pad(t.getHours()), M: pad(t.getMinutes()), S: pad(t.getSeconds()),
      y: pad(t.getFullYear() % 100), j: pad(Math.floor((t - new Date(t.getFullYear(), 0, 0)) / 864e5), 3), p: t.getHours() < 12 ? 'AM' : 'PM',
      I: pad(t.getHours() % 12 || 12), '%': '%', b: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][t.getMonth()],
      B: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][t.getMonth()],
      a: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()], A: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][t.getDay()],
      f: pad(record.msecs * 1000, 6),
    })[c]);
    return datefmt ? base : `${base},${pad(record.msecs, 3)}`;
  }
  formatException(exc) {
    const v = Array.isArray(exc) ? exc[1] : exc;
    if (!v) return '';
    const t = excTypeOf(v);
    return `Traceback (most recent call last):\n${t ? t.__name__ || t._pyName : 'Exception'}: ${pyStr(excValue(v) ?? v)}`;
  }
  formatMessage(record) {
    const fields = { ...record, message: record.message, asctime: record.asctime };
    if (this._style === '{') return this._fmt.replace(/\{(\w+)(?::([^}]*))?\}/g, (_, k, spec) => (spec ? pyFormatValue(fields[k], spec) : pyStr(fields[k])));
    if (this._style === '$') return this._fmt.replace(/\$\{?(\w+)\}?/g, (_, k) => pyStr(fields[k]));
    return pyPercentFormat(this._fmt, fields);
  }
  format(record) {
    record.message = record.getMessage();
    if (this.usesTime()) record.asctime = this.formatTime(record, this.datefmt);
    let s = this.formatMessage(record);
    if (record.exc_info) { if (!record.exc_text) record.exc_text = this.formatException(record.exc_info); }
    if (record.exc_text) s = s + (s.endsWith('\n') ? '' : '\n') + record.exc_text;
    return s;
  }
}
const _dtFormatterType = _dtType('Formatter', _DtFormatter, 'logging');
class _DtFilter {
  constructor(name = '') { this.name = name; }
  filter(record) { return !this.name || record.name === this.name || record.name.startsWith(this.name + '.'); }
}
class _DtHandler {
  constructor(level = 0) { this.level = _dtLevelOf(level && level._kw ? level.level ?? 0 : level); this.formatter = null; this.filters = []; this.name = null; }
  setLevel(l) { this.level = _dtLevelOf(l); return null; }
  setFormatter(f) { this.formatter = f; return null; }
  addFilter(f) { this.filters.push(f); return null; }
  removeFilter(f) { this.filters = this.filters.filter((x) => x !== f); return null; }
  filter(record) { return this.filters.every((f) => (typeof f === 'function' ? f(record) : f.filter(record))); }
  format(record) { return (this.formatter || _dtDefaultFormatter).format(record); }
  handle(record) { if (!this.filter(record)) return false; return _dtThenTrue(this.emit(record)); }
  emit() { return null; }
  flush() { return null; }
  close() { return null; }
}
const _dtThenTrue = (r) => (_dtIsThen(r) ? r.then(() => true) : true);
const _dtDefaultFormatter = new _DtFormatter();
class _DtStreamHandler extends _DtHandler {
  constructor(stream = null) { super(); this.stream = stream && stream._kw ? stream.stream ?? null : stream; this.terminator = '\n'; }
  emit(record) {
    const msg = this.format(record) + this.terminator;
    if (this.stream === null) { if (_stdio.err) _stdio.err(msg); else if (typeof console !== 'undefined') console.error(msg.trimEnd()); return null; }
    return adderGetAttr(this.stream, 'write')(msg);
  }
  setStream(s) { const old = this.stream; this.stream = s; return old; }
}
class _DtFileHandler extends _DtStreamHandler {
  constructor(...a) {
    super();
    const { args } = _dtArgs(a, ['filename', 'mode', 'encoding', 'delay'], { mode: 'a', encoding: null, delay: false });
    this.baseFilename = String(args.filename); this.mode = args.mode; this._pending = Promise.resolve();
    this._first = args.mode === 'w';
  }
  emit(record) {
    const msg = this.format(record) + this.terminator;
    const vfs = getAdderVFS();
    if (!vfs) throw new AdderError('RuntimeError', 'filesystem not available');
    const p = _resolvePath(this.baseFilename, _getVfsPath());
    this._pending = this._pending.then(async () => {
      let prev = '';
      if (!this._first) { try { prev = await vfs.readFile(p); } catch { prev = ''; } }
      this._first = false;
      await vfs.writeFile(p, (typeof prev === 'string' ? prev : _dtDec.decode(prev)) + msg);
    });
    return this._pending;
  }
}
class _DtNullHandler extends _DtHandler { emit() { return null; } handle() { return null; } }
const _dtLoggers = new Map();
class _DtLogger {
  constructor(name, level = 0) { this.name = name; this.level = _dtLevelOf(level); this.parent = null; this.propagate = true; this.handlers = []; this.disabled = false; this.filters = []; }
  setLevel(l) { this.level = _dtLevelOf(l); return null; }
  getEffectiveLevel() { for (let l = this; l; l = l.parent) if (l.level) return l.level; return 0; }
  isEnabledFor(level) { return !this.disabled && level >= _dtManagerDisable + 1 && level >= this.getEffectiveLevel(); }
  addHandler(h) { if (!this.handlers.includes(h)) this.handlers.push(h); return null; }
  removeHandler(h) { this.handlers = this.handlers.filter((x) => x !== h); return null; }
  hasHandlers() { for (let l = this; l; l = l.propagate ? l.parent : null) if (l.handlers.length) return true; return false; }
  addFilter(f) { this.filters.push(f); return null; }
  removeFilter(f) { this.filters = this.filters.filter((x) => x !== f); return null; }
  getChild(suffix) { return _dtGetLogger(this === _dtRoot ? suffix : `${this.name}.${suffix}`); }
  _log(level, msg, args, kw) {
    if (!this.isEnabledFor(level)) return null;
    let exc = kw && _dtHas(kw, 'exc_info') ? kw.exc_info : null;
    if (exc === true) exc = excStack.length ? excStack[excStack.length - 1] : null;
    const rec = new _DtLogRecord(this.name, level, msg, args, exc || null);
    if (kw && _dtHas(kw, 'extra') && kw.extra) Object.assign(rec, kw.extra instanceof Map ? Object.fromEntries(kw.extra) : kw.extra);
    if (!this.filters.every((f) => (typeof f === 'function' ? f(rec) : f.filter(rec)))) return null;
    const pend = [];
    let found = 0;
    for (let l = this; l; l = l.propagate ? l.parent : null) {
      for (const h of l.handlers) { found++; if (level >= h.level) { const r = h.handle(rec); if (_dtIsThen(r)) pend.push(r); } }
      if (!l.propagate) break;
    }
    if (!found && level >= _dtLastResort.level) { const r = _dtLastResort.handle(rec); if (_dtIsThen(r)) pend.push(r); }
    return pend.length ? Promise.all(pend).then(() => null) : null;
  }
  debug(msg, ...a) { const kw = _dtKw(a); return this._log(10, msg, a, kw); }
  info(msg, ...a) { const kw = _dtKw(a); return this._log(20, msg, a, kw); }
  warning(msg, ...a) { const kw = _dtKw(a); return this._log(30, msg, a, kw); }
  warn(msg, ...a) { return this.warning(msg, ...a); }
  error(msg, ...a) { const kw = _dtKw(a); return this._log(40, msg, a, kw); }
  exception(msg, ...a) { const kw = _dtKw(a) || {}; return this._log(40, msg, a, { exc_info: true, ...kw }); }
  critical(msg, ...a) { const kw = _dtKw(a); return this._log(50, msg, a, kw); }
  fatal(msg, ...a) { return this.critical(msg, ...a); }
  log(level, msg, ...a) { const kw = _dtKw(a); return this._log(_dtLevelOf(level), msg, a, kw); }
  __repr__() { return `<${this === _dtRoot ? 'RootLogger' : 'Logger'} ${this.name} (${_dtLevelNames[this.getEffectiveLevel()] ?? `Level ${this.getEffectiveLevel()}`})>`; }
}
_DtLogger.prototype.__adderClass__ = 'Logger';
let _dtManagerDisable = -1;
const _dtRoot = new _DtLogger('root', 30);
const _dtLastResort = new _DtStreamHandler(null); _dtLastResort.level = 30;
function _dtGetLogger(name = null) {
  if (name === null || name === undefined || name === '' || name === 'root') return _dtRoot;
  if (_dtLoggers.has(name)) return _dtLoggers.get(name);
  const lg = new _DtLogger(name);
  _dtLoggers.set(name, lg);
  // parent: the nearest existing ancestor; re-parent existing children
  const parts = name.split('.');
  lg.parent = _dtRoot;
  for (let i = parts.length - 1; i > 0; i--) { const p = parts.slice(0, i).join('.'); if (_dtLoggers.has(p)) { lg.parent = _dtLoggers.get(p); break; } }
  for (const [n, child] of _dtLoggers) if (n !== name && n.startsWith(name + '.') && (child.parent === lg.parent || !child.parent.name.startsWith(name))) child.parent = lg;
  return lg;
}
const _dtRootCall = (m) => (msg, ...a) => { if (!_dtRoot.handlers.length) _dtBasicConfig(); return _dtRoot[m](msg, ...a); };
function _dtBasicConfig(...a) {
  const kw = _dtKw(a) || {};
  if (_dtHas(kw, 'force') && kw.force) _dtRoot.handlers = [];
  if (_dtRoot.handlers.length) return null;
  let h;
  if (_dtHas(kw, 'handlers') && kw.handlers) { for (const x of pyIter(kw.handlers)) _dtRoot.addHandler(x); }
  else {
    h = _dtHas(kw, 'filename') ? new _DtFileHandler(kw.filename, _dtHas(kw, 'filemode') ? kw.filemode : 'a') : new _DtStreamHandler(_dtHas(kw, 'stream') ? kw.stream : null);
    h.setFormatter(new _DtFormatter(_dtHas(kw, 'format') ? kw.format : '%(levelname)s:%(name)s:%(message)s', _dtHas(kw, 'datefmt') ? kw.datefmt : null, _dtHas(kw, 'style') ? kw.style : '%'));
    _dtRoot.addHandler(h);
  }
  if (_dtHas(kw, 'level')) _dtRoot.setLevel(kw.level);
  return null;
}
adderModules.logging = {
  ..._DT_LEVELS,
  getLogger: _dtGetLogger, root: _dtRoot, basicConfig: _dtBasicConfig,
  debug: _dtRootCall('debug'), info: _dtRootCall('info'), warning: _dtRootCall('warning'), warn: _dtRootCall('warning'),
  error: _dtRootCall('error'), exception: _dtRootCall('exception'), critical: _dtRootCall('critical'), fatal: _dtRootCall('critical'),
  log: (level, msg, ...a) => { if (!_dtRoot.handlers.length) _dtBasicConfig(); return _dtRoot.log(level, msg, ...a); },
  disable: (level = 50) => { _dtManagerDisable = _dtLevelOf(level); return null; },
  getLevelName: (l) => (typeof l === 'number' ? _dtLevelNames[l] ?? `Level ${l}` : _DT_LEVELS[l] ?? `Level ${l}`),
  getLevelNamesMapping: () => ({ ..._DT_LEVELS }),
  addLevelName: (level, name) => { _dtLevelNames[level] = name; _DT_LEVELS[name] = level; return null; },
  shutdown: () => null, captureWarnings: () => null, lastResort: _dtLastResort,
  Logger: _dtType('Logger', _DtLogger, 'logging'), LogRecord: _dtType('LogRecord', _DtLogRecord, 'logging'),
  Formatter: _dtFormatterType, Filter: _dtType('Filter', _DtFilter, 'logging'),
  Handler: _dtType('Handler', _DtHandler, 'logging'), StreamHandler: _dtType('StreamHandler', _DtStreamHandler, 'logging'),
  FileHandler: _dtType('FileHandler', _DtFileHandler, 'logging'), NullHandler: _dtType('NullHandler', _DtNullHandler, 'logging'),
  BASIC_FORMAT: '%(levelname)s:%(name)s:%(message)s',
};

// ── tempfile ──
// gettempdir / mkdtemp / mkstemp / TemporaryDirectory / NamedTemporaryFile / TemporaryFile /
// SpooledTemporaryFile, all under the VFS's /tmp.
const _dtTmpName = () => { const c = 'abcdefghijklmnopqrstuvwxyz0123456789_'; const r = _dtRandBytes(8); return [...r].map((b) => c[b % c.length]).join(''); };
const _dtVfsOr = () => { const v = getAdderVFS(); if (!v) throw new AdderError('RuntimeError', 'filesystem not available — tempfile needs a VFS'); return v; };
async function _dtMkdtemp(...a) {
  const { args } = _dtArgs(a, ['suffix', 'prefix', 'dir'], { suffix: '', prefix: 'tmp', dir: null });
  const vfs = _dtVfsOr();
  const dir = args.dir ?? '/tmp';
  try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  const p = `${dir.replace(/\/$/, '')}/${args.prefix ?? 'tmp'}${_dtTmpName()}${args.suffix ?? ''}`;
  await vfs.mkdir(p);
  return p;
}
class _DtTempDir {
  async _init(...a) { this.name = await _dtMkdtemp(...a); return this; }
  __enter__() { return this.name; }
  async cleanup() { try { await _dtVfsOr().rm(this.name, { recursive: true }); } catch { /* gone */ } return null; }
  async __exit__() { await this.cleanup(); return false; }
  __repr__() { return `<TemporaryDirectory ${pyRepr(this.name)}>`; }
}
_DtTempDir.prototype.__adderClass__ = 'TemporaryDirectory';
async function _dtNamedTemp(...a) {
  const { args } = _dtArgs(a, ['mode', 'buffering', 'encoding', 'newline', 'suffix', 'prefix', 'dir', 'delete'],
    { mode: 'w+b', buffering: -1, encoding: null, newline: null, suffix: '', prefix: 'tmp', dir: null, delete: true });
  const vfs = _dtVfsOr();
  const dir = args.dir ?? '/tmp';
  try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  const p = `${dir.replace(/\/$/, '')}/${args.prefix ?? 'tmp'}${_dtTmpName()}${args.suffix ?? ''}`;
  await vfs.writeFile(p, '');
  const mode = String(args.mode).replace('+', '').replace('x', 'w');
  const f = await _createAdderFile(vfs, p, mode.startsWith('r') ? mode : mode);
  const close = f.close ? f.close.bind(f) : null;
  if (args.delete) {
    f.close = async () => { if (close) await close(); try { await vfs.unlink(p); } catch { /* gone */ } return null; };
    const exit = f.__exit__ ? f.__exit__.bind(f) : null;
    f.__exit__ = async (...e) => { if (exit) await exit(...e); try { await vfs.unlink(p); } catch { /* gone */ } return false; };
  }
  return f;
}
const _dtTempDirCtor = (...a) => new _DtTempDir()._init(...a);
_dtTempDirCtor._pyName = 'TemporaryDirectory'; _dtTempDirCtor._pyClass = true; _dtTempDirCtor.__name__ = 'TemporaryDirectory';
_DtTempDir.prototype.__adderType__ = _dtTempDirCtor;
adderModules.tempfile = {
  gettempdir: () => '/tmp', gettempdirb: () => _dtEnc.encode('/tmp'), gettempprefix: () => 'tmp', tempdir: null,
  mkdtemp: _dtMkdtemp,
  mkstemp: async (...a) => {
    const { args } = _dtArgs(a, ['suffix', 'prefix', 'dir', 'text'], { suffix: '', prefix: 'tmp', dir: null, text: false });
    const vfs = _dtVfsOr();
    const dir = args.dir ?? '/tmp';
    try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
    const p = `${dir.replace(/\/$/, '')}/${args.prefix ?? 'tmp'}${_dtTmpName()}${args.suffix ?? ''}`;
    await vfs.writeFile(p, '');
    return mkTuple([3, p]);
  },
  mktemp: (suffix = '', prefix = 'tmp', dir = null) => `${(dir ?? '/tmp').replace(/\/$/, '')}/${prefix}${_dtTmpName()}${suffix}`,
  TemporaryDirectory: _dtTempDirCtor,
  NamedTemporaryFile: _dtNamedTemp, TemporaryFile: _dtNamedTemp,
  SpooledTemporaryFile: (...a) => (String((_dtArgs([...a], ['max_size', 'mode'], { max_size: 0, mode: 'w+b' }).args.mode)).includes('b') ? adderModules.io.BytesIO() : adderModules.io.StringIO()),
};
