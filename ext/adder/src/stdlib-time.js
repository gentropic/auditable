// adder stdlib — time and datetime. datetime follows CPython's pure-Python datetime.py: dates
// as proleptic Gregorian ordinals (_ymd2ord / _ord2ymd), timedelta normalised to (days,
// seconds, microseconds), the same str / repr / isoformat / strftime / strptime text, fixed-offset
// timezones. The clock (now, today, time.time, local time) is the browser's.
// Not here: zoneinfo / named zones, tzinfo subclasses with DST rules, locale-specific names.
//
// Concat-bundled with the rest of adder: top-level names carry a `_tm` prefix.

import {
  AdderError, PyTuple, mkTuple, pyTypeName, pyRepr, pyIter, adderModules, _pyHash, _namedtuple, NotImplemented,
} from './builtins.js';

const _tmIsThen = (v) => v !== null && v !== undefined && typeof v.then === 'function';
const _tmKw = (args) => (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' &&
  args[args.length - 1]._kw === true ? args.pop() : null);
const _tmHas = (kw, k) => !!kw && Object.hasOwn(kw, k) && k !== '_kw';
// positional / keyword arguments by name, as CPython binds them
function _tmArgs(a, names, defaults) {
  const kw = _tmKw(a);
  const out = {};
  names.forEach((n, i) => {
    if (i < a.length) out[n] = a[i];
    else if (_tmHas(kw, n)) out[n] = kw[n];
    else out[n] = defaults[n];
  });
  if (kw) for (const k of Object.keys(kw)) if (k !== '_kw' && !names.includes(k)) throw new AdderError('TypeError', `'${k}' is an invalid keyword argument`);
  return out;
}
const _tmType = (name, Cls, extraName) => {
  const ctor = (...a) => new Cls(...a);
  ctor._pyName = name; ctor._pyClass = true; ctor.__name__ = extraName || name; ctor.__module__ = 'datetime';
  Cls.prototype.__adderClass__ = name;
  Cls.prototype.__adderType__ = ctor;
  ctor._jsClass = Cls;
  return ctor;
};
const _tmPad = (n, w) => { const s = String(Math.abs(n)); return (n < 0 ? '-' : '') + s.padStart(w, '0'); };
const _tmInt = (v, what) => {
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (v && typeof v.__index__ === 'function') return v.__index__();
  throw new AdderError('TypeError', `'${pyTypeName(v)}' object cannot be interpreted as an integer`);
};
const _tmFloorDiv = (a, b) => Math.floor(a / b);
const _tmMod = (a, b) => ((a % b) + b) % b;

// ── the proleptic Gregorian calendar (datetime.py) ──
const _TM_DIM = [-1, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const _TM_DBM = [-1]; { let dbm = 0; for (const d of _TM_DIM.slice(1)) { _TM_DBM.push(dbm); dbm += d; } }
const _tmLeap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const _tmDaysBeforeYear = (y) => { y -= 1; return y * 365 + _tmFloorDiv(y, 4) - _tmFloorDiv(y, 100) + _tmFloorDiv(y, 400); };
const _tmDaysInMonth = (y, m) => (m === 2 && _tmLeap(y) ? 29 : _TM_DIM[m]);
const _tmDaysBeforeMonth = (y, m) => _TM_DBM[m] + (m > 2 && _tmLeap(y) ? 1 : 0);
const _tmYmd2ord = (y, m, d) => _tmDaysBeforeYear(y) + _tmDaysBeforeMonth(y, m) + d;
const _TM_DI400Y = _tmDaysBeforeYear(401), _TM_DI100Y = _tmDaysBeforeYear(101), _TM_DI4Y = _tmDaysBeforeYear(5);
function _tmOrd2ymd(n) {
  n -= 1;
  const n400 = _tmFloorDiv(n, _TM_DI400Y); n = _tmMod(n, _TM_DI400Y);
  let year = n400 * 400 + 1;
  const n100 = _tmFloorDiv(n, _TM_DI100Y); n = _tmMod(n, _TM_DI100Y);
  const n4 = _tmFloorDiv(n, _TM_DI4Y); n = _tmMod(n, _TM_DI4Y);
  const n1 = _tmFloorDiv(n, 365); n = _tmMod(n, 365);
  year += n100 * 100 + n4 * 4 + n1;
  if (n1 === 4 || n100 === 4) return [year - 1, 12, 31];
  const leap = n1 === 3 && (n4 !== 24 || n100 === 3);
  let month = (n + 50) >> 5;
  let preceding = _TM_DBM[month] + (month > 2 && leap ? 1 : 0);
  if (preceding > n) { month -= 1; preceding -= _TM_DIM[month] + (month === 2 && leap ? 1 : 0); }
  return [year, month, n - preceding + 1];
}
const _TM_MAXORD = _tmYmd2ord(9999, 12, 31);
function _tmCheckDate(y, m, d) {
  y = _tmInt(y); m = _tmInt(m); d = _tmInt(d);
  if (y < 1 || y > 9999) throw new AdderError('ValueError', `year ${y} is out of range`);
  if (m < 1 || m > 12) throw new AdderError('ValueError', 'month must be in 1..12');
  if (d < 1 || d > _tmDaysInMonth(y, m)) throw new AdderError('ValueError', 'day is out of range for month');
  return [y, m, d];
}
function _tmCheckTime(h, mi, s, us, fold) {
  h = _tmInt(h); mi = _tmInt(mi); s = _tmInt(s); us = _tmInt(us);
  if (h < 0 || h > 23) throw new AdderError('ValueError', 'hour must be in 0..23');
  if (mi < 0 || mi > 59) throw new AdderError('ValueError', 'minute must be in 0..59');
  if (s < 0 || s > 59) throw new AdderError('ValueError', 'second must be in 0..59');
  if (us < 0 || us > 999999) throw new AdderError('ValueError', 'microsecond must be in 0..999999');
  if (fold !== 0 && fold !== 1) throw new AdderError('ValueError', 'fold must be either 0 or 1');
  return [h, mi, s, us];
}
function _tmIsoweek1monday(year) {
  const firstday = _tmYmd2ord(year, 1, 1);
  const firstweekday = (firstday + 6) % 7;
  let w1m = firstday - firstweekday;
  if (firstweekday > 3) w1m += 7;
  return w1m;
}
const _TM_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _TM_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── timedelta ──
const _TM_US_DAY = 86400000000n;
class _TmTimedelta {
  constructor(...a) {
    const p = _tmArgs(a, ['days', 'seconds', 'microseconds', 'milliseconds', 'minutes', 'hours', 'weeks'],
      { days: 0, seconds: 0, microseconds: 0, milliseconds: 0, minutes: 0, hours: 0, weeks: 0 });
    // each unit, exactly, in microseconds; one round-half-even at the end (as CPython)
    const units = [['days', 86400000000], ['seconds', 1000000], ['microseconds', 1], ['milliseconds', 1000], ['minutes', 60000000], ['hours', 3600000000], ['weeks', 604800000000]];
    let whole = 0n, num = 0n, den = 1n;
    for (const [k, mult] of units) {
      const v = p[k];
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint') whole += BigInt(typeof v === 'boolean' ? +v : v) * BigInt(mult);
      else if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw new AdderError(Number.isNaN(v) ? 'ValueError' : 'OverflowError', Number.isNaN(v) ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer');
        const [n, d] = _tmFromFloat(v);
        const nn = n * BigInt(mult);
        num = num * d + nn * den; den *= d;
      } else throw new AdderError('TypeError', `unsupported type for timedelta ${k} component: ${pyTypeName(v)}`);
    }
    // round num/den to an integer, half to even
    let q = num / den, r = num % den;
    if (r < 0n) { r += den; q -= 1n; }
    if (2n * r > den || (2n * r === den && (q & 1n) === 1n)) q += 1n;
    this._set(whole + q);
  }
  _set(total) {
    let days = total / _TM_US_DAY, rest = total % _TM_US_DAY;
    if (rest < 0n) { rest += _TM_US_DAY; days -= 1n; }
    if (days > 999999999n || days < -999999999n) throw new AdderError('OverflowError', `days=${days}; must have magnitude <= 999999999`);
    this._days = Number(days);
    this._seconds = Number(rest / 1000000n);
    this._us = Number(rest % 1000000n);
  }
  _total() { return BigInt(this._days) * _TM_US_DAY + BigInt(this._seconds) * 1000000n + BigInt(this._us); }
  get days() { return this._days; }
  get seconds() { return this._seconds; }
  get microseconds() { return this._us; }
  __reduce__() { return mkTuple([this.__adderType__, mkTuple([this._days, this._seconds, this._us])]); }
  total_seconds() { return Number(this._total()) / 1e6; }
  __repr__() {
    const parts = [];
    if (this._days) parts.push(`days=${this._days}`);
    if (this._seconds) parts.push(`seconds=${this._seconds}`);
    if (this._us) parts.push(`microseconds=${this._us}`);
    return `datetime.timedelta(${parts.length ? parts.join(', ') : '0'})`;
  }
  __str__() {
    const mm = Math.floor(this._seconds / 60), ss = this._seconds % 60, hh = Math.floor(mm / 60);
    let s = `${hh}:${_tmPad(mm % 60, 2)}:${_tmPad(ss, 2)}`;
    if (this._days) s = `${this._days} day${Math.abs(this._days) !== 1 ? 's' : ''}, ${s}`;
    if (this._us) s += `.${_tmPad(this._us, 6)}`;
    return s;
  }
  __bool__() { return this._total() !== 0n; }
  __hash__() { return _pyHash(mkTuple([this._days, this._seconds, this._us])); }
  __neg__() { return _tmTd(-this._total()); }
  __pos__() { return this; }
  __abs__() { return this._days < 0 ? this.__neg__() : this; }
  __add__(o) {
    if (o instanceof _TmTimedelta) return _tmTd(this._total() + o._total());
    if (o instanceof _TmDate) return o.__add__(this);
    return NotImplemented;
  }
  __radd__(o) { return this.__add__(o); }
  __sub__(o) { return o instanceof _TmTimedelta ? _tmTd(this._total() - o._total()) : NotImplemented; }
  __rsub__(o) { return o instanceof _TmTimedelta ? _tmTd(o._total() - this._total()) : NotImplemented; }
  __mul__(o) {
    if (typeof o === 'boolean' || (typeof o === 'number' && Number.isInteger(o))) return _tmTd(this._total() * BigInt(+o));
    if (typeof o === 'number') { const [n, d] = _tmFromFloat(o); return _tmTd(_tmDivRound(this._total() * n, d)); }
    return NotImplemented;
  }
  __rmul__(o) { return this.__mul__(o); }
  __truediv__(o) {
    if (o instanceof _TmTimedelta) { if (o._total() === 0n) throw new AdderError('ZeroDivisionError', 'division by zero'); return Number(this._total()) / Number(o._total()); }
    if (typeof o === 'number' && Number.isInteger(o)) { if (o === 0) throw new AdderError('ZeroDivisionError', 'division by zero'); return _tmTd(_tmDivRound(this._total(), BigInt(o))); }
    if (typeof o === 'number') { if (o === 0) throw new AdderError('ZeroDivisionError', 'division by zero'); const [n, d] = _tmFromFloat(o); return _tmTd(_tmDivRound(this._total() * d, n)); }
    return NotImplemented;
  }
  __floordiv__(o) {
    if (o instanceof _TmTimedelta) { if (o._total() === 0n) throw new AdderError('ZeroDivisionError', 'integer division or modulo by zero'); return Number(_tmBigFloorDiv(this._total(), o._total())); }
    if (typeof o === 'number' && Number.isInteger(o)) { if (o === 0) throw new AdderError('ZeroDivisionError', 'integer division or modulo by zero'); return _tmTd(_tmBigFloorDiv(this._total(), BigInt(o))); }
    return NotImplemented;
  }
  __mod__(o) {
    if (!(o instanceof _TmTimedelta)) return NotImplemented;
    const a = this._total(), b = o._total();
    if (b === 0n) throw new AdderError('ZeroDivisionError', 'integer division or modulo by zero');
    return _tmTd(a - _tmBigFloorDiv(a, b) * b);
  }
  __divmod__(o) {
    if (!(o instanceof _TmTimedelta)) return NotImplemented;
    const a = this._total(), b = o._total(), q = _tmBigFloorDiv(a, b);
    return mkTuple([Number(q), _tmTd(a - q * b)]);
  }
  _cmp(o) { if (!(o instanceof _TmTimedelta)) return null; const a = this._total(), b = o._total(); return a < b ? -1 : a > b ? 1 : 0; }
  __eq__(o) { const c = this._cmp(o); return c === null ? false : c === 0; }
  __lt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<', this, o); return c < 0; }
  __le__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<=', this, o); return c <= 0; }
  __gt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>', this, o); return c > 0; }
  __ge__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>=', this, o); return c >= 0; }
}
const _tmCmpErr = (op, a, b) => new AdderError('TypeError', `'${op}' not supported between instances of '${pyTypeName(a)}' and '${pyTypeName(b)}'`);
function _tmBigFloorDiv(a, b) { let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n; return q; }
function _tmDivRound(a, b) {
  if (b < 0n) { a = -a; b = -b; }
  let q = a / b, r = a % b;
  if (r < 0n) { r += b; q -= 1n; }
  if (2n * r > b || (2n * r === b && (q & 1n) === 1n)) q += 1n;
  return q;
}
function _tmFromFloat(x) {
  if (Number.isInteger(x)) return [BigInt(x), 1n];
  const f = new Float64Array([x]);
  const u = new BigUint64Array(f.buffer)[0];
  const e = Number((u >> 52n) & 0x7ffn);
  let m = u & 0xfffffffffffffn;
  let exp;
  if (e === 0) exp = -1074; else { m |= 1n << 52n; exp = e - 1075; }
  const n = (u >> 63n) ? -m : m;
  return exp >= 0 ? [n << BigInt(exp), 1n] : [n, 1n << BigInt(-exp)];
}
const _tmTd = (total) => { const t = Object.create(_TmTimedelta.prototype); t._set(total); return t; };
const _tmTdType = _tmType('timedelta', _TmTimedelta);

// ── tzinfo / timezone (fixed offsets) ──
class _TmTimezone {
  constructor(offset, name = null) {
    if (offset !== null && typeof offset === 'object' && offset._kw) { name = offset.name ?? null; offset = offset.offset; }
    if (name !== null && typeof name === 'object' && name._kw) name = name.name ?? null;
    if (!(offset instanceof _TmTimedelta)) throw new AdderError('TypeError', 'timezone() argument 1 must be datetime.timedelta, not ' + pyTypeName(offset));
    if (offset._total() <= -_TM_US_DAY || offset._total() >= _TM_US_DAY) throw new AdderError('ValueError', 'offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24).');
    this._offset = offset; this._name = name;
  }
  utcoffset() { return this._offset; }
  __reduce__() { return mkTuple([this.__adderType__, mkTuple(this._name === null ? [this._offset] : [this._offset, this._name])]); }
  dst() { return null; }
  tzname() { return this._name !== null ? this._name : _tmOffsetName(this._offset); }
  fromutc(dt) { return dt.__add__(this._offset); }
  __repr__() {
    if (this === _tmUTC) return 'datetime.timezone.utc';
    return this._name === null ? `datetime.timezone(${this._offset.__repr__()})` : `datetime.timezone(${this._offset.__repr__()}, ${pyRepr(this._name)})`;
  }
  __str__() { return this.tzname(); }
  __eq__(o) { return o instanceof _TmTimezone && o._offset.__eq__(this._offset); }
  __hash__() { return this._offset.__hash__(); }
}
function _tmOffsetName(off) {
  const t = off._total();
  if (t === 0n) return 'UTC';
  const sign = t < 0n ? '-' : '+';
  let us = t < 0n ? -t : t;
  const h = us / 3600000000n; us %= 3600000000n;
  const m = us / 60000000n; us %= 60000000n;
  const s = us / 1000000n; us %= 1000000n;
  let out = `UTC${sign}${_tmPad(Number(h), 2)}:${_tmPad(Number(m), 2)}`;
  if (s || us) out += `:${_tmPad(Number(s), 2)}`;
  if (us) out += `.${_tmPad(Number(us), 6)}`;
  return out;
}
// ±HH:MM[:SS[.ffffff]] for isoformat / %z (with `sep`)
function _tmFormatOffset(off, sep = ':') {
  if (off === null || off === undefined) return '';
  const t = off._total();
  const sign = t < 0n ? '-' : '+';
  let us = t < 0n ? -t : t;
  const h = us / 3600000000n; us %= 3600000000n;
  const m = us / 60000000n; us %= 60000000n;
  const s = us / 1000000n; us %= 1000000n;
  let out = `${sign}${_tmPad(Number(h), 2)}${sep}${_tmPad(Number(m), 2)}`;
  if (s || us) out += `${sep}${_tmPad(Number(s), 2)}`;
  if (us) out += `.${_tmPad(Number(us), 6)}`;
  return out;
}
const _tmTimezoneType = _tmType('timezone', _TmTimezone);
const _tmUTC = new _TmTimezone(new _TmTimedelta(0));
_tmTimezoneType.utc = _tmUTC;
_tmTimezoneType.min = new _TmTimezone(new _TmTimedelta({ _kw: true, hours: -23, minutes: -59 }));
_tmTimezoneType.max = new _TmTimezone(new _TmTimedelta({ _kw: true, hours: 23, minutes: 59 }));
const _tmTzOffset = (tz, dt) => {
  if (tz === null || tz === undefined) return null;
  const o = typeof tz.utcoffset === 'function' ? tz.utcoffset(dt) : null;
  return o;
};

// ── date ──
class _TmDate {
  constructor(...a) {
    const p = _tmArgs(a, ['year', 'month', 'day'], {});
    if (p.year === undefined || p.month === undefined || p.day === undefined) {
      const miss = ['year', 'month', 'day'].find((k) => p[k] === undefined);
      throw new AdderError('TypeError', `function missing required argument '${miss}' (pos ${['year', 'month', 'day'].indexOf(miss) + 1})`);
    }
    [this._y, this._m, this._d] = _tmCheckDate(p.year, p.month, p.day);
  }
  get year() { return this._y; }
  get month() { return this._m; }
  get day() { return this._d; }
  __reduce__() {
    const args = this instanceof _TmDatetime ? [this._y, this._m, this._d, this._h, this._mi, this._s, this._us, this._tz] : [this._y, this._m, this._d];
    return mkTuple([this.__adderType__, mkTuple(args)]);
  }
  toordinal() { return _tmYmd2ord(this._y, this._m, this._d); }
  weekday() { return (this.toordinal() + 6) % 7; }
  isoweekday() { return this.weekday() + 1; }
  isocalendar() {
    let year = this._y;
    let w1m = _tmIsoweek1monday(year);
    const today = this.toordinal();
    let week = _tmFloorDiv(today - w1m, 7), day = _tmMod(today - w1m, 7);
    if (week < 0) { year -= 1; w1m = _tmIsoweek1monday(year); week = _tmFloorDiv(today - w1m, 7); day = _tmMod(today - w1m, 7); }
    else if (week >= 52 && today >= _tmIsoweek1monday(year + 1)) { year += 1; week = 0; }
    return _tmIsoCal(year, week + 1, day + 1);
  }
  isoformat() { return `${_tmPad(this._y, 4)}-${_tmPad(this._m, 2)}-${_tmPad(this._d, 2)}`; }
  __str__() { return this.isoformat(); }
  __repr__() { return `datetime.date(${this._y}, ${this._m}, ${this._d})`; }
  __format__(spec) { return spec ? this.strftime(spec) : this.__str__(); }
  ctime() { return _tmStrftime(this, '%a %b %e %H:%M:%S %Y'); }
  strftime(fmt) { return _tmStrftime(this, fmt); }
  timetuple() { return _tmStructTime([this._y, this._m, this._d, 0, 0, 0, this.weekday(), this.toordinal() - _tmYmd2ord(this._y, 1, 1) + 1, -1]); }
  replace(...a) {
    const p = _tmArgs(a, ['year', 'month', 'day'], { year: this._y, month: this._m, day: this._d });
    return new _TmDate(p.year, p.month, p.day);
  }
  __add__(o) {
    if (!(o instanceof _TmTimedelta)) return NotImplemented;
    const n = this.toordinal() + o._days;
    if (n < 1 || n > _TM_MAXORD) throw new AdderError('OverflowError', 'date value out of range');
    return _tmDateFromOrd(n);
  }
  __radd__(o) { return this.__add__(o); }
  __sub__(o) {
    if (o instanceof _TmTimedelta) return this.__add__(o.__neg__());
    if (o instanceof _TmDate && !(o instanceof _TmDatetime)) return _tmTd(BigInt(this.toordinal() - o.toordinal()) * _TM_US_DAY);
    return NotImplemented;
  }
  _cmp(o) {
    if (!(o instanceof _TmDate) || (o instanceof _TmDatetime) !== (this instanceof _TmDatetime)) return null;
    const a = [this._y, this._m, this._d], b = [o._y, o._m, o._d];
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }
  __eq__(o) { const c = this._cmp(o); return c === null ? false : c === 0; }
  __lt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<', this, o); return c < 0; }
  __le__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<=', this, o); return c <= 0; }
  __gt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>', this, o); return c > 0; }
  __ge__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>=', this, o); return c >= 0; }
  __hash__() { return _pyHash(mkTuple([this._y, this._m, this._d])); }
}
const _tmDateFromOrd = (n) => { const [y, m, d] = _tmOrd2ymd(n); const o = Object.create(_TmDate.prototype); o._y = y; o._m = m; o._d = d; return o; };
const _tmIsoCalType = _namedtuple('IsoCalendarDate', ['year', 'week', 'weekday']);
const _tmIsoCal = (y, w, d) => { const t = _tmIsoCalType(y, w, d); return t; };
Object.getPrototypeOf(_tmIsoCalType(1, 1, 1)).__repr__ = function () { return `datetime.IsoCalendarDate(year=${this[0]}, week=${this[1]}, weekday=${this[2]})`; };
const _tmDateType = _tmType('date', _TmDate);

// ── time ──
class _TmTime {
  constructor(...a) {
    const p = _tmArgs(a, ['hour', 'minute', 'second', 'microsecond', 'tzinfo'], { hour: 0, minute: 0, second: 0, microsecond: 0, tzinfo: null });
    const fold = 0;
    [this._h, this._mi, this._s, this._us] = _tmCheckTime(p.hour, p.minute, p.second, p.microsecond, fold);
    this._tz = p.tzinfo ?? null;
  }
  get hour() { return this._h; }
  get minute() { return this._mi; }
  get second() { return this._s; }
  get microsecond() { return this._us; }
  get tzinfo() { return this._tz; }
  get fold() { return 0; }
  __reduce__() { return mkTuple([this.__adderType__, mkTuple([this._h, this._mi, this._s, this._us, this._tz])]); }
  utcoffset() { return _tmTzOffset(this._tz, null); }
  tzname() { return this._tz ? this._tz.tzname(null) : null; }
  isoformat(...a) {
    const p = _tmArgs(a, ['timespec'], { timespec: 'auto' });
    return _tmIsoTime(this._h, this._mi, this._s, this._us, p.timespec) + _tmFormatOffset(this.utcoffset());
  }
  __str__() { return this.isoformat(); }
  __repr__() {
    let args = `${this._h}, ${this._mi}`;
    if (this._s || this._us) args += `, ${this._s}`;
    if (this._us) args += `, ${this._us}`;
    if (this._tz) args += `, tzinfo=${pyRepr(this._tz)}`;
    return `datetime.time(${args})`;
  }
  __format__(spec) { return spec ? this.strftime(spec) : this.__str__(); }
  strftime(fmt) { return _tmStrftime(this, fmt); }
  replace(...a) {
    const p = _tmArgs(a, ['hour', 'minute', 'second', 'microsecond', 'tzinfo'], { hour: this._h, minute: this._mi, second: this._s, microsecond: this._us, tzinfo: this._tz });
    return new _TmTime(p.hour, p.minute, p.second, p.microsecond, p.tzinfo);
  }
  _key() { return ((this._h * 60 + this._mi) * 60 + this._s) * 1e6 + this._us; }
  _cmp(o) { if (!(o instanceof _TmTime)) return null; const a = this._key(), b = o._key(); return a < b ? -1 : a > b ? 1 : 0; }
  __eq__(o) { const c = this._cmp(o); return c === null ? false : c === 0; }
  __lt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<', this, o); return c < 0; }
  __le__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('<=', this, o); return c <= 0; }
  __gt__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>', this, o); return c > 0; }
  __ge__(o) { const c = this._cmp(o); if (c === null) throw _tmCmpErr('>=', this, o); return c >= 0; }
  __hash__() { return _pyHash(this._key()); }
  __bool__() { return true; }
}
function _tmIsoTime(h, mi, s, us, timespec) {
  const hh = _tmPad(h, 2), mm = _tmPad(mi, 2), ss = _tmPad(s, 2);
  if (timespec === 'auto') timespec = us ? 'microseconds' : 'seconds';
  switch (timespec) {
    case 'hours': return hh;
    case 'minutes': return `${hh}:${mm}`;
    case 'seconds': return `${hh}:${mm}:${ss}`;
    case 'milliseconds': return `${hh}:${mm}:${ss}.${_tmPad(Math.floor(us / 1000), 3)}`;
    case 'microseconds': return `${hh}:${mm}:${ss}.${_tmPad(us, 6)}`;
    default: throw new AdderError('ValueError', 'Unknown timespec value');
  }
}
const _tmTimeType = _tmType('time', _TmTime);

// ── datetime ──
// the local UTC offset at a moment (the browser's time zone)
const _tmLocalOffsetMin = (y, m, d, h, mi, s) => -new Date(y, m - 1, d, h, mi, s).getTimezoneOffset();
class _TmDatetime extends _TmDate {
  constructor(...a) {
    const p = _tmArgs(a, ['year', 'month', 'day', 'hour', 'minute', 'second', 'microsecond', 'tzinfo', 'fold'],
      { hour: 0, minute: 0, second: 0, microsecond: 0, tzinfo: null, fold: 0 });
    if (p.year === undefined || p.month === undefined || p.day === undefined) {
      const miss = ['year', 'month', 'day'].find((k) => p[k] === undefined);
      throw new AdderError('TypeError', `function missing required argument '${miss}' (pos ${['year', 'month', 'day'].indexOf(miss) + 1})`);
    }
    super(p.year, p.month, p.day);
    [this._h, this._mi, this._s, this._us] = _tmCheckTime(p.hour, p.minute, p.second, p.microsecond, p.fold);
    this._tz = p.tzinfo ?? null;
    this._fold = p.fold;
  }
  get hour() { return this._h; }
  get minute() { return this._mi; }
  get second() { return this._s; }
  get microsecond() { return this._us; }
  get tzinfo() { return this._tz; }
  get fold() { return this._fold; }
  date() { return new _TmDate(this._y, this._m, this._d); }
  time() { return new _TmTime(this._h, this._mi, this._s, this._us); }
  timetz() { return new _TmTime(this._h, this._mi, this._s, this._us, this._tz); }
  utcoffset() { return _tmTzOffset(this._tz, this); }
  tzname() { return this._tz ? this._tz.tzname(this) : null; }
  dst() { return this._tz && typeof this._tz.dst === 'function' ? this._tz.dst(this) : null; }
  // microseconds since 0001-01-01T00:00 of the wall clock (BigInt)
  _wall() { return BigInt(this.toordinal()) * _TM_US_DAY + BigInt(((this._h * 60 + this._mi) * 60 + this._s)) * 1000000n + BigInt(this._us); }
  _utc() { const off = this.utcoffset(); return off === null ? null : this._wall() - off._total(); }
  timestamp() {
    if (this._tz) return Number(this._utc() - _TM_EPOCH_US) / 1e6;
    const ms = new Date(this._y, this._m - 1, this._d, this._h, this._mi, this._s).getTime();
    return ms / 1000 + this._us / 1e6;
  }
  isoformat(...a) {
    const p = _tmArgs(a, ['sep', 'timespec'], { sep: 'T', timespec: 'auto' });
    return `${_TmDate.prototype.isoformat.call(this)}${p.sep}${_tmIsoTime(this._h, this._mi, this._s, this._us, p.timespec)}${_tmFormatOffset(this.utcoffset())}`;
  }
  __str__() { return this.isoformat(' '); }
  __repr__() {
    let args = `${this._y}, ${this._m}, ${this._d}, ${this._h}, ${this._mi}`;
    if (this._s || this._us) args += `, ${this._s}`;
    if (this._us) args += `, ${this._us}`;
    if (this._tz) args += `, tzinfo=${pyRepr(this._tz)}`;
    if (this._fold) args += ', fold=1';
    return `datetime.datetime(${args})`;
  }
  ctime() { return _tmStrftime(this, '%a %b %e %H:%M:%S %Y'); }
  timetuple() {
    return _tmStructTime([this._y, this._m, this._d, this._h, this._mi, this._s, this.weekday(), this.toordinal() - _tmYmd2ord(this._y, 1, 1) + 1, -1]);
  }
  utctimetuple() { const u = this._tz ? this.__sub__(this.utcoffset()) : this; return _tmStructTime([u._y, u._m, u._d, u._h, u._mi, u._s, u.weekday(), u.toordinal() - _tmYmd2ord(u._y, 1, 1) + 1, 0]); }
  replace(...a) {
    const p = _tmArgs(a, ['year', 'month', 'day', 'hour', 'minute', 'second', 'microsecond', 'tzinfo', 'fold'],
      { year: this._y, month: this._m, day: this._d, hour: this._h, minute: this._mi, second: this._s, microsecond: this._us, tzinfo: this._tz, fold: this._fold });
    return new _TmDatetime(p.year, p.month, p.day, p.hour, p.minute, p.second, p.microsecond, p.tzinfo, { _kw: true, fold: p.fold });
  }
  astimezone(tz = null) {
    if (tz !== null && typeof tz === 'object' && tz._kw) tz = tz.tz ?? null;
    let utc;
    if (this._tz) utc = this._utc();
    else utc = this._wall() - BigInt(_tmLocalOffsetMin(this._y, this._m, this._d, this._h, this._mi, this._s)) * 60000000n;
    if (tz === null) {
      const ms = Number((utc - _TM_EPOCH_US) / 1000n);
      const off = -new Date(ms).getTimezoneOffset();
      tz = new _TmTimezone(new _TmTimedelta({ _kw: true, minutes: off }));
    }
    const off = tz.utcoffset(null) || new _TmTimedelta(0);
    return _tmDtFromWall(utc + off._total(), tz);
  }
  __add__(o) {
    if (!(o instanceof _TmTimedelta)) return NotImplemented;
    return _tmDtFromWall(this._wall() + o._total(), this._tz);
  }
  __radd__(o) { return this.__add__(o); }
  __sub__(o) {
    if (o instanceof _TmTimedelta) return _tmDtFromWall(this._wall() - o._total(), this._tz);
    if (o instanceof _TmDatetime) {
      const a = this._tz ? this._utc() : null, b = o._tz ? o._utc() : null;
      if ((a === null) !== (b === null)) throw new AdderError('TypeError', "can't subtract offset-naive and offset-aware datetimes");
      return _tmTd(a === null ? this._wall() - o._wall() : a - b);
    }
    return NotImplemented;
  }
  _cmp(o) {
    if (!(o instanceof _TmDatetime)) return null;
    let a, b;
    if (this._tz && o._tz) { a = this._utc(); b = o._utc(); }
    else if (!this._tz && !o._tz) { a = this._wall(); b = o._wall(); }
    else return 'mixed';
    return a < b ? -1 : a > b ? 1 : 0;
  }
  __eq__(o) { const c = this._cmp(o); return c === null || c === 'mixed' ? false : c === 0; }
  __lt__(o) { return this._order('<', o, (c) => c < 0); }
  __le__(o) { return this._order('<=', o, (c) => c <= 0); }
  __gt__(o) { return this._order('>', o, (c) => c > 0); }
  __ge__(o) { return this._order('>=', o, (c) => c >= 0); }
  _order(op, o, f) {
    const c = this._cmp(o);
    if (c === null) throw _tmCmpErr(op, this, o);
    if (c === 'mixed') throw new AdderError('TypeError', "can't compare offset-naive and offset-aware datetimes");
    return f(c);
  }
  __hash__() { const u = this._tz ? this._utc() : this._wall(); return _pyHash(Number(u % 9007199254740991n)); }
}
const _TM_EPOCH_US = BigInt(_tmYmd2ord(1970, 1, 1)) * _TM_US_DAY;
function _tmDtFromWall(us, tz) {
  let days = us / _TM_US_DAY, rest = us % _TM_US_DAY;
  if (rest < 0n) { rest += _TM_US_DAY; days -= 1n; }
  const n = Number(days);
  if (n < 1 || n > _TM_MAXORD) throw new AdderError('OverflowError', 'date value out of range');
  const [y, m, d] = _tmOrd2ymd(n);
  const r = Number(rest);
  const usec = r % 1e6, secs = Math.floor(r / 1e6);
  return new _TmDatetime(y, m, d, Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60, usec, tz);
}
function _tmFromTimestamp(ts, tz) {
  if (typeof ts !== 'number') ts = Number(ts);
  const [n, d] = _tmFromFloat(ts);
  const us = _tmDivRound(n * 1000000n, d);
  if (tz) {
    const off = tz.utcoffset(null) || new _TmTimedelta(0);
    return _tmDtFromWall(_TM_EPOCH_US + us + off._total(), tz);
  }
  const ms = Number(us / 1000n);
  const dt = new Date(ms);
  const usec = Number(((us % 1000000n) + 1000000n) % 1000000n);
  return new _TmDatetime(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds(), usec);
}
const _tmNowUs = () => {
  const p = typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now();
  return p;
};
const _tmDtType = _tmType('datetime', _TmDatetime);

// ── strftime / strptime ──
function _tmStrftime(o, fmt) {
  const has = (k) => k in o;
  const y = has('_y') ? o._y : 1900, mo = has('_m') ? o._m : 1, d = has('_d') ? o._d : 1;
  const h = o._h || 0, mi = o._mi || 0, s = o._s || 0, us = o._us || 0;
  const isDate = typeof o.weekday === 'function';   // a date / datetime, or time's struct_time view
  const wd = isDate ? o.weekday() : (_tmYmd2ord(1900, 1, 1) + 6) % 7;
  const yday = isDate ? o.toordinal() - _tmYmd2ord(y, 1, 1) + 1 : 1;
  const sundayWd = (wd + 1) % 7;
  const off = typeof o.utcoffset === 'function' ? o.utcoffset() : null;
  return String(fmt).replace(/%([-#]?)([a-zA-Z%:])/g, (m, flag, c) => {
    const p2 = (n) => (flag === '-' ? String(n) : _tmPad(n, 2));
    switch (c) {
      case 'a': return _TM_DAYS[wd].slice(0, 3);
      case 'A': return _TM_DAYS[wd];
      case 'w': return String(sundayWd);
      case 'u': return String(wd + 1);
      case 'd': return p2(d);
      case 'e': return String(d).padStart(2, ' ');
      case 'b': case 'h': return _TM_MONTHS[mo - 1].slice(0, 3);
      case 'B': return _TM_MONTHS[mo - 1];
      case 'm': return p2(mo);
      case 'y': return _tmPad(y % 100, 2);
      case 'Y': return String(y);
      case 'C': return _tmPad(Math.floor(y / 100), 2);
      case 'H': return p2(h);
      case 'I': return p2(h % 12 === 0 ? 12 : h % 12);
      case 'p': return h < 12 ? 'AM' : 'PM';
      case 'M': return p2(mi);
      case 'S': return p2(s);
      case 'f': return _tmPad(us, 6);
      case 'j': return flag === '-' ? String(yday) : _tmPad(yday, 3);
      case 'U': return _tmPad(Math.floor((yday - 1 + 7 - sundayWd) / 7), 2);
      case 'W': return _tmPad(Math.floor((yday - 1 + 7 - wd) / 7), 2);
      case 'G': return String(isDate ? o.isocalendar()[0] : y);
      case 'V': return _tmPad(isDate ? o.isocalendar()[1] : 1, 2);
      case 'z': return off ? _tmFormatOffset(off, '') : '';
      case ':': return m;
      case 'Z': return o._tz ? o._tz.tzname(o) ?? '' : '';
      case 'c': return _tmStrftime(o, '%a %b %e %H:%M:%S %Y');
      case 'x': return _tmStrftime(o, '%m/%d/%y');
      case 'X': return _tmStrftime(o, '%H:%M:%S');
      case 'D': return _tmStrftime(o, '%m/%d/%y');
      case 'F': return _tmStrftime(o, '%Y-%m-%d');
      case 'T': return _tmStrftime(o, '%H:%M:%S');
      case 'R': return _tmStrftime(o, '%H:%M');
      case 'n': return '\n';
      case 't': return '\t';
      case '%': return '%';
      default: return m;
    }
  }).replace(/%:z/g, () => (off ? _tmFormatOffset(off, ':') : ''));
}
const _tmRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// strptime's directive patterns (the C locale)
const _TM_PT = {
  d: '(?<d>3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])', f: '(?<f>[0-9]{1,6})', H: '(?<H>2[0-3]|[0-1]\\d|\\d)', I: '(?<I>1[0-2]|0[1-9]|[1-9])',
  j: '(?<j>36[0-6]|3[0-5]\\d|[12]\\d\\d|0[1-9]\\d|00[1-9]|[1-9]\\d|0[1-9]|[1-9])', m: '(?<m>1[0-2]|0[1-9]|[1-9])', M: '(?<M>[0-5]\\d|\\d)',
  S: '(?<S>6[0-1]|[0-5]\\d|\\d)', y: '(?<y>\\d\\d)', Y: '(?<Y>\\d\\d\\d\\d)', p: '(?<p>am|pm)', b: `(?<b>${_TM_MONTHS.map((x) => x.slice(0, 3)).join('|')})`,
  B: `(?<B>${_TM_MONTHS.join('|')})`, a: `(?<a>${_TM_DAYS.map((x) => x.slice(0, 3)).join('|')})`, A: `(?<A>${_TM_DAYS.join('|')})`,
  w: '(?<w>[0-6])', u: '(?<u>[1-7])', z: '(?<z>[+-]\\d\\d:?[0-5]\\d(:?[0-5]\\d(\\.\\d{1,6})?)?|(?-i:Z))', Z: '(?<Z>utc|gmt)', '%': '%',
};
function _tmStrptimeParts(str, fmt) {
  if (typeof str !== 'string') throw new AdderError('TypeError', `strptime() argument 1 must be str, not ${pyTypeName(str)}`);
  let pat = '';
  const seen = new Set();
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === '%' && i + 1 < fmt.length) {
      const dch = fmt[++i];
      if (!(dch in _TM_PT)) throw new AdderError('ValueError', `'${dch}' is a bad directive in format '${fmt}'`);
      if (seen.has(dch) && dch !== '%') pat += `\\k<${dch}>`; else pat += _TM_PT[dch];
      seen.add(dch);
    } else if (/\s/.test(c)) { pat += '\\s+'; while (i + 1 < fmt.length && /\s/.test(fmt[i + 1])) i++; }
    else pat += _tmRe(c);
  }
  const re = new RegExp(`^${pat}`, 'i');
  const m = re.exec(str);
  if (!m) throw new AdderError('ValueError', `time data ${pyRepr(str)} does not match format ${pyRepr(fmt)}`);
  if (m[0].length !== str.length) throw new AdderError('ValueError', `unconverted data remains: ${str.slice(m[0].length)}`);
  const g = m.groups || {};
  let year = 1900, month = 1, day = 1, hour = 0, minute = 0, second = 0, us = 0, tz = null, yday = null;
  const ix = (arr, v) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase());
  if (g.Y) year = Number(g.Y);
  else if (g.y) { const yy = Number(g.y); year = yy <= 68 ? 2000 + yy : 1900 + yy; }
  if (g.m) month = Number(g.m);
  else if (g.B) month = ix(_TM_MONTHS, g.B) + 1;
  else if (g.b) month = ix(_TM_MONTHS.map((x) => x.slice(0, 3)), g.b) + 1;
  if (g.d) day = Number(g.d);
  if (g.H) hour = Number(g.H);
  else if (g.I) { hour = Number(g.I) % 12; if (g.p && g.p.toLowerCase() === 'pm') hour += 12; }
  if (g.M) minute = Number(g.M);
  if (g.S) second = Number(g.S);
  if (g.f) us = Number(g.f.padEnd(6, '0'));
  if (g.j) yday = Number(g.j);
  if (g.z) {
    if (/^z$/i.test(g.z)) tz = _tmUTC;
    else {
      const zm = /^([+-])(\d\d):?(\d\d)(?::?(\d\d)(?:\.(\d{1,6}))?)?$/.exec(g.z);
      const sign = zm[1] === '-' ? -1 : 1;
      tz = new _TmTimezone(new _TmTimedelta({ _kw: true, hours: sign * Number(zm[2]), minutes: sign * Number(zm[3]), seconds: sign * Number(zm[4] || 0), microseconds: sign * Number((zm[5] || '0').padEnd(6, '0')) }));
    }
  } else if (g.Z) tz = null;
  if (yday !== null && !g.m && !g.b && !g.B && !g.d) { const [, mm, dd] = _tmOrd2ymd(_tmYmd2ord(year, 1, 1) + yday - 1); month = mm; day = dd; }
  return { year, month, day, hour, minute, second, us, tz };
}

// ── the datetime module ──
Object.assign(_tmDateType, {
  today: () => { const t = new Date(); return new _TmDate(t.getFullYear(), t.getMonth() + 1, t.getDate()); },
  fromordinal: (n) => { n = _tmInt(n); if (n < 1 || n > _TM_MAXORD) throw new AdderError('ValueError', `ordinal must be >= 1`); return _tmDateFromOrd(n); },
  fromtimestamp: (ts) => _tmFromTimestamp(ts, null).date(),
  fromisoformat: (s) => {
    const m = /^(\d{4})-?(\d\d)-?(\d\d)$/.exec(String(s)) || /^(\d{4})-?W(\d\d)-?(\d)$/.exec(String(s));
    if (!m) throw new AdderError('ValueError', `Invalid isoformat string: ${pyRepr(s)}`);
    if (String(s).includes('W')) return _tmDateType.fromisocalendar(Number(m[1]), Number(m[2]), Number(m[3]));
    return new _TmDate(Number(m[1]), Number(m[2]), Number(m[3]));
  },
  fromisocalendar: (year, week, day) => {
    if (week < 1 || week > 53) throw new AdderError('ValueError', `Invalid week: ${week}`);
    if (day < 1 || day > 7) throw new AdderError('ValueError', `Invalid weekday: ${day} (range is [1, 7])`);
    return _tmDateFromOrd(_tmIsoweek1monday(year) + (week - 1) * 7 + (day - 1));
  },
  min: new _TmDate(1, 1, 1), max: new _TmDate(9999, 12, 31), resolution: new _TmTimedelta(1),
});
Object.assign(_tmTimeType, {
  fromisoformat: (s) => {
    const m = /^(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,6})\d*)?)?)?(Z|[+-]\d\d(?::?\d\d(?::?\d\d(?:\.\d{1,6})?)?)?)?$/.exec(String(s));
    if (!m) throw new AdderError('ValueError', `Invalid isoformat string: ${pyRepr(s)}`);
    return new _TmTime(Number(m[1]), Number(m[2] || 0), Number(m[3] || 0), Number((m[4] || '0').padEnd(6, '0')), _tmParseIsoTz(m[5]));
  },
  min: new _TmTime(0, 0), max: new _TmTime(23, 59, 59, 999999), resolution: new _TmTimedelta(0, 0, 1),
});
function _tmParseIsoTz(t) {
  if (!t) return null;
  if (t === 'Z') return _tmUTC;
  const zm = /^([+-])(\d\d)(?::?(\d\d)(?::?(\d\d)(?:\.(\d{1,6}))?)?)?$/.exec(t);
  const sign = zm[1] === '-' ? -1 : 1;
  return new _TmTimezone(new _TmTimedelta({ _kw: true, hours: sign * Number(zm[2]), minutes: sign * Number(zm[3] || 0), seconds: sign * Number(zm[4] || 0), microseconds: sign * Number((zm[5] || '0').padEnd(6, '0')) }));
}
Object.assign(_tmDtType, {
  now: (...a) => {
    const p = _tmArgs(a, ['tz'], { tz: null });
    const ms = _tmNowUs();
    return _tmFromTimestamp(ms / 1000, p.tz);
  },
  today: () => _tmFromTimestamp(_tmNowUs() / 1000, null),
  utcnow: () => _tmFromTimestamp(_tmNowUs() / 1000, _tmUTC).replace({ _kw: true, tzinfo: null }),
  fromtimestamp: (...a) => { const p = _tmArgs(a, ['timestamp', 'tz'], { tz: null }); return _tmFromTimestamp(p.timestamp, p.tz); },
  utcfromtimestamp: (ts) => _tmFromTimestamp(ts, _tmUTC).replace({ _kw: true, tzinfo: null }),
  fromordinal: (n) => { const d = _tmDateType.fromordinal(n); return new _TmDatetime(d._y, d._m, d._d); },
  combine: (...a) => {
    const p = _tmArgs(a, ['date', 'time', 'tzinfo'], { tzinfo: undefined });
    const t = p.time;
    return new _TmDatetime(p.date._y, p.date._m, p.date._d, t._h, t._mi, t._s, t._us, p.tzinfo === undefined ? t._tz : p.tzinfo);
  },
  fromisoformat: (s) => {
    s = String(s);
    const m = /^(\d{4})-?(\d\d)-?(\d\d)(?:[T ](.+))?$/.exec(s);
    if (!m) throw new AdderError('ValueError', `Invalid isoformat string: ${pyRepr(s)}`);
    let t = new _TmTime();
    if (m[4]) { try { t = _tmTimeType.fromisoformat(m[4]); } catch { throw new AdderError('ValueError', `Invalid isoformat string: ${pyRepr(s)}`); } }
    return new _TmDatetime(Number(m[1]), Number(m[2]), Number(m[3]), t._h, t._mi, t._s, t._us, t._tz);
  },
  fromisocalendar: (y, w, d) => { const dd = _tmDateType.fromisocalendar(y, w, d); return new _TmDatetime(dd._y, dd._m, dd._d); },
  strptime: (s, fmt) => {
    const p = _tmStrptimeParts(s, String(fmt));
    return new _TmDatetime(p.year, p.month, p.day, p.hour, p.minute, p.second, p.us, p.tz);
  },
  min: new _TmDatetime(1, 1, 1), max: new _TmDatetime(9999, 12, 31, 23, 59, 59, 999999), resolution: new _TmTimedelta(0, 0, 1),
});
Object.assign(_tmTdType, {
  min: _tmTd(-999999999n * _TM_US_DAY), max: _tmTd(999999999n * _TM_US_DAY + 86399999999n), resolution: new _TmTimedelta(0, 0, 1),
});
const _tmTzinfoType = (() => { const t = function () { return Object.create(_tmTzinfoType.prototype); }; t._pyName = 'tzinfo'; t._pyClass = true; t.__name__ = 'tzinfo'; t.prototype = {}; t._pyBases = []; t._pyMRO = [t]; t._pyOwnMembers = new Set(); return t; })();
adderModules.datetime = {
  date: _tmDateType, time: _tmTimeType, datetime: _tmDtType, timedelta: _tmTdType, timezone: _tmTimezoneType,
  tzinfo: _tmTzinfoType, MINYEAR: 1, MAXYEAR: 9999, UTC: _tmUTC,
};

// ── time ──
// time / time_ns / perf_counter / monotonic / process_time / sleep (async), gmtime / localtime
// as struct_time, mktime, strftime / strptime, asctime / ctime, timezone / altzone / tzname.
const _tmStructType = _namedtuple('struct_time', ['tm_year', 'tm_mon', 'tm_mday', 'tm_hour', 'tm_min', 'tm_sec', 'tm_wday', 'tm_yday', 'tm_isdst']);
Object.getPrototypeOf(_tmStructType(0, 0, 0, 0, 0, 0, 0, 0, 0)).__repr__ = function () {
  return `time.struct_time(${['tm_year', 'tm_mon', 'tm_mday', 'tm_hour', 'tm_min', 'tm_sec', 'tm_wday', 'tm_yday', 'tm_isdst'].map((f, i) => `${f}=${this[i]}`).join(', ')})`;
};
const _tmStructTime = (v) => _tmStructType(...v);
const _tmSecsToStruct = (secs, utc) => {
  const dt = new Date(secs * 1000);
  const g = (n, u) => (utc ? dt[`getUTC${n}`]() : dt[`get${n}`]());
  const y = g('FullYear'), mo = g('Month') + 1, d = g('Date');
  const wd = (g('Day') + 6) % 7, yd = _tmYmd2ord(y, mo, d) - _tmYmd2ord(y, 1, 1) + 1;
  return _tmStructTime([y, mo, d, g('Hours'), g('Minutes'), g('Seconds'), wd, yd, utc ? 0 : -1]);
};
const _tmT0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
const _tmStructToObj = (t) => {
  const v = [...t];
  return { _y: v[0], _m: v[1], _d: v[2], _h: v[3], _mi: v[4], _s: v[5], _us: 0, weekday: () => v[6], toordinal: () => _tmYmd2ord(v[0], v[1], v[2]), isocalendar: () => new _TmDate(v[0], v[1], v[2]).isocalendar(), utcoffset: () => null };
};
adderModules.time = {
  time: () => _tmNowUs() / 1000,
  time_ns: () => BigInt(Math.round(_tmNowUs() * 1e6)),
  perf_counter: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  perf_counter_ns: () => BigInt(Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1e6)),
  monotonic: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  monotonic_ns: () => BigInt(Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1e6)),
  process_time: () => ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - _tmT0) / 1000,
  thread_time: () => ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - _tmT0) / 1000,
  sleep: (secs) => {
    if (typeof secs !== 'number' || secs < 0) throw new AdderError('ValueError', 'sleep length must be non-negative');
    return new Promise((res) => setTimeout(() => res(null), secs * 1000));
  },
  gmtime: (secs = null) => _tmSecsToStruct(secs === null ? Date.now() / 1000 : Number(secs), true),
  localtime: (secs = null) => _tmSecsToStruct(secs === null ? Date.now() / 1000 : Number(secs), false),
  mktime: (t) => { const v = [...t]; return new Date(v[0], v[1] - 1, v[2], v[3], v[4], v[5]).getTime() / 1000; },
  strftime: (fmt, t = null) => _tmStrftime(_tmStructToObj(t === null ? _tmSecsToStruct(Date.now() / 1000, false) : t), String(fmt)),
  strptime: (s, fmt = '%a %b %d %H:%M:%S %Y') => {
    const p = _tmStrptimeParts(s, String(fmt));
    const d = new _TmDate(p.year, p.month, p.day);
    return _tmStructTime([p.year, p.month, p.day, p.hour, p.minute, p.second, d.weekday(), d.toordinal() - _tmYmd2ord(p.year, 1, 1) + 1, -1]);
  },
  asctime: (t = null) => _tmStrftime(_tmStructToObj(t === null ? _tmSecsToStruct(Date.now() / 1000, false) : t), '%a %b %e %H:%M:%S %Y'),
  ctime: (secs = null) => _tmStrftime(_tmStructToObj(_tmSecsToStruct(secs === null ? Date.now() / 1000 : Number(secs), false)), '%a %b %e %H:%M:%S %Y'),
  get timezone() { return new Date(2024, 0, 1).getTimezoneOffset() * 60; },
  get altzone() { return new Date(2024, 6, 1).getTimezoneOffset() * 60; },
  get daylight() { return new Date(2024, 0, 1).getTimezoneOffset() !== new Date(2024, 6, 1).getTimezoneOffset() ? 1 : 0; },
  tzname: mkTuple(['UTC', 'UTC']),
  struct_time: _tmStructType,
};
