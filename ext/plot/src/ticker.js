// matplotlib.ticker and matplotlib.dates, the parts people reach for (spec tier 2):
//
//   ax.xaxis.set_major_formatter('{x:,.0f} m')             // a str → StrMethodFormatter
//   ax.xaxis.set_major_formatter((x, pos) => …)            // a function → FuncFormatter
//   ax.yaxis.set_major_formatter(new ticker.PercentFormatter(1))
//   ax.xaxis.set_major_locator(new ticker.MultipleLocator(50))
//   ax.minorticks_on() · ax.xaxis.set_minor_locator(new ticker.AutoMinorLocator(4))
//   ax.plot(dates, y)                                       // Date objects: a date axis
//   ax.xaxis.set_major_formatter(new dates.DateFormatter('%b %Y'))
//
// Locators give tick values for a range: tick_values(vmin, vmax, ctx). Formatters give each
// tick its label: format(value, pos, ctx), ctx = { step, values, range }. Both live on the axes'
// Axis objects (ax.xaxis, ax.yaxis); shared axes (subplots(sharex)) share them, as matplotlib's do.
//
// Dates are milliseconds since 1970-01-01 UTC — JavaScript's own number for a Date
// (matplotlib counts days; plot counts what Date.getTime() returns). Calendar ticks and labels
// are computed in UTC, so a figure is the same in every host whatever its time zone.

import { pyFormat, pctFormat, _formatSpec, _pyFormatWith } from './pyfmt.js';
import { _niceTicks, _fmtStep, _minus } from './nice.js';

// ── formatters ──
export class Formatter { format(v) { return String(v); } }
export class ScalarFormatter extends Formatter {
  format(v, pos, ctx) { return _minus(_fmtStep([v], (ctx && ctx.step) || Math.abs(v) || 1)[0]); }
}
export class NullFormatter extends Formatter { format() { return ''; } }
export class FuncFormatter extends Formatter {
  constructor(func) { super(); if (typeof func !== 'function') throw new TypeError('FuncFormatter(func): func(x, pos) → str'); this.func = func; }
  format(v, pos) { const s = this.func(v, pos); return s == null ? '' : String(s); }
}
export class StrMethodFormatter extends Formatter {
  constructor(fmt) { super(); this.fmt = String(fmt); }
  // the minus sign in each field, as matplotlib's (its literal text is left alone)
  format(v, pos) { return _pyFormatWith(this.fmt, { x: v, pos }, [], _minus); }
}
export class FormatStrFormatter extends Formatter {
  constructor(fmt) { super(); this.fmt = String(fmt); }
  format(v) { return pctFormat(this.fmt, v); }
}
export class FixedFormatter extends Formatter {
  constructor(seq) { super(); this.seq = Array.from(seq, String); }
  format(v, pos) { return pos != null && pos < this.seq.length ? this.seq[pos] : ''; }
}
// PercentFormatter(xmax = 100, decimals = null, symbol = '%'): xmax is 100 % (1 for fractions).
// decimals null: as many as the view's range needs (matplotlib's rule)
export class PercentFormatter extends Formatter {
  constructor(xmax = 100, decimals = null, symbol = '%') {
    super();
    if (xmax && typeof xmax === 'object' && !Array.isArray(xmax)) ({ xmax = 100, decimals = null, symbol = '%' } = xmax);
    this.xmax = +xmax; this.decimals = decimals; this.symbol = symbol == null ? '' : String(symbol);
  }
  format(v, pos, ctx) {
    const pct = (v / this.xmax) * 100;
    let d = this.decimals;
    if (d == null) {
      const r = ctx && ctx.range ? (ctx.range / this.xmax) * 100 : 0;
      d = r <= 0 ? 0 : Math.max(0, Math.min(5, Math.ceil(2 - Math.log10(2 * r))));
    }
    return _minus(_formatSpec(pct, `.${d}f`) + this.symbol);
  }
}
// EngFormatter(unit = '', places = null): SI prefixes, 12.3 k
const _SI = { '-24': 'y', '-21': 'z', '-18': 'a', '-15': 'f', '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T', 15: 'P', 18: 'E', 21: 'Z', 24: 'Y' };
export class EngFormatter extends Formatter {
  constructor(unit = '', places = null, sep = ' ') {
    super();
    if (unit && typeof unit === 'object') ({ unit = '', places = null, sep = ' ' } = unit);
    this.unit = unit; this.places = places; this.sep = sep;
  }
  format(v) {
    if (v === 0) return `0${this.unit ? this.sep + this.unit : ''}`;   // (no minus to fix)
    let e = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
    e = Math.max(-24, Math.min(24, e));
    const m = v / Math.pow(10, e);
    const s = this.places == null ? String(+m.toPrecision(6)) : _formatSpec(m, `.${this.places}f`);
    const suf = _SI[e] + this.unit;
    return _minus(suf ? `${s}${this.sep}${suf}` : s);
  }
}

// ── locators ──
export class Locator { tick_values(lo, hi) { return _niceTicks(lo, hi, 6); } }
export class NullLocator extends Locator { tick_values() { return []; } }
export class FixedLocator extends Locator {
  constructor(locs) { super(); this.locs = Array.from(locs, Number); }
  tick_values(lo, hi) { return this.locs.filter((v) => v >= lo && v <= hi); }
}
// every multiple of base (+ offset) in the view
export class MultipleLocator extends Locator {
  constructor(base = 1, offset = 0) { super(); this.base = +base; this.offset = +offset; if (!(this.base > 0)) throw new RangeError('MultipleLocator(base): base > 0'); }
  tick_values(lo, hi) {
    const b = this.base, o = this.offset;
    const a = Math.ceil((lo - o) / b - 1e-9), z = Math.floor((hi - o) / b + 1e-9);
    if (z - a > 2000) return _niceTicks(lo, hi, 10);    // a base far too fine for the view
    const out = [];
    for (let k = a; k <= z; k++) out.push(+(k * b + o).toPrecision(12));
    out.step = b;
    return out;
  }
}
// MaxNLocator(nbins = 'auto' | n, {integer, steps}): at most nbins intervals of a round step
export class MaxNLocator extends Locator {
  constructor(nbins = 'auto', opts) {
    super();
    if (nbins && typeof nbins === 'object') { opts = nbins; nbins = opts.nbins ?? 'auto'; }
    const o = opts || {};
    this.nbins = nbins; this.integer = !!o.integer;
  }
  tick_values(lo, hi, ctx) {
    const n = this.nbins === 'auto' ? (ctx && ctx.count) || 9 : +this.nbins + 1;
    let t = _niceTicks(lo, hi, n);
    if (this.integer && t.step < 1) {
      const out = []; for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) out.push(k);
      out.step = 1;
      t = out.length > n ? new MultipleLocator(Math.ceil((hi - lo) / Math.max(1, n - 1))).tick_values(lo, hi) : out;
    }
    return t;
  }
}
// AutoMinorLocator(n): n intervals between majors (5 for a step of 1, 2.5 or 5 × 10^k, else 4)
export class AutoMinorLocator extends Locator {
  constructor(n = null) { super(); this.n = n; }
  tick_values(lo, hi, ctx) {
    const majors = (ctx && ctx.majors) || [];
    if (ctx && ctx.log) return _logMinors(lo, hi);
    if (majors.length < 2) return [];
    const step = Math.abs(majors[1] - majors[0]);
    let n = this.n;
    if (n == null) { const m = step / Math.pow(10, Math.floor(Math.log10(step))); n = [1, 2.5, 5, 10].some((q) => Math.abs(m - q) < 1e-9) ? 5 : 4; }
    const d = step / n, out = [];
    const first = Math.min(...majors);
    const a = Math.ceil((lo - first) / d - 1e-9), z = Math.floor((hi - first) / d + 1e-9);
    if (z - a > 4000) return [];
    for (let k = a; k <= z; k++) { if (((k % n) + n) % n === 0) continue; out.push(+(first + k * d).toPrecision(12)); }
    return out;
  }
}
// a log axis's minor ticks: 2 … 9 × each decade
function _logMinors(lo, hi) {
  const out = [];
  if (!(lo > 0) || !(hi > lo)) return out;
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)) && out.length < 2000; e++) {
    for (let m = 2; m <= 9; m++) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(+v.toPrecision(12)); }
  }
  return out;
}
// LogLocator(base = 10): the decades
export class LogLocator extends Locator {
  constructor(base = 10) { super(); this.base = +base; }
  tick_values(lo, hi) {
    const b = this.base, out = [];
    if (!(lo > 0)) lo = hi / 1e6;
    for (let e = Math.ceil(Math.log(lo) / Math.log(b) - 1e-9); Math.pow(b, e) <= hi * (1 + 1e-9) && out.length < 400; e++) out.push(+Math.pow(b, e).toPrecision(12));
    return out;
  }
}

// ── dates ──
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const p2 = (n) => String(n).padStart(2, '0');

// strftime, the usual codes, in UTC: %Y %y %m %d %e %H %I %M %S %f %p %b %B %a %A %j %%
export function strftime(ms, fmt) {
  const d = new Date(ms);
  if (!(ms - ms === 0)) return '';
  return String(fmt).replace(/%([YymdeHIMSfpbBaAj%])/g, (_, c) => {
    switch (c) {
      case 'Y': return String(d.getUTCFullYear());
      case 'y': return p2(d.getUTCFullYear() % 100);
      case 'm': return p2(d.getUTCMonth() + 1);
      case 'd': return p2(d.getUTCDate());
      case 'e': return String(d.getUTCDate()).padStart(2, ' ');
      case 'H': return p2(d.getUTCHours());
      case 'I': return p2(((d.getUTCHours() + 11) % 12) + 1);
      case 'M': return p2(d.getUTCMinutes());
      case 'S': return p2(d.getUTCSeconds());
      case 'f': return String(Math.round(((ms % SEC) + SEC) % SEC * 1000)).padStart(6, '0');
      case 'p': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      case 'b': return _MON[d.getUTCMonth()];
      case 'B': return _MONTH[d.getUTCMonth()];
      case 'a': return _DAYN[d.getUTCDay()];
      case 'A': return _DAYNAME[d.getUTCDay()];
      case 'j': return String(Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1).padStart(3, '0');
      default: return '%';
    }
  });
}

// the calendar steps a date axis chooses from, finest first: [unit, step, typical ms]
const _DATE_STEPS = [
  ...[1, 2, 5, 10, 15, 30].map((s) => ['second', s, s * SEC]),
  ...[1, 2, 5, 10, 15, 30].map((s) => ['minute', s, s * MIN]),
  ...[1, 2, 3, 6, 12].map((s) => ['hour', s, s * HOUR]),
  ...[1, 2, 7, 14].map((s) => ['day', s, s * DAY]),
  ...[1, 2, 3, 6].map((s) => ['month', s, s * 30.44 * DAY]),
  ...[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].map((s) => ['year', s, s * 365.25 * DAY]),
];
// ticks for one calendar step (UTC): seconds to hours on multiples since the epoch's midnight;
// days on the month's days 1, 1 + step, … (7 → 1, 8, 15, 22, 29); months on Jan + k·step;
// years on multiples of step
export function _dateTicksAt(unit, step, lo, hi) {
  const out = [];
  if (unit === 'second' || unit === 'minute' || unit === 'hour') {
    const st = step * (unit === 'second' ? SEC : unit === 'minute' ? MIN : HOUR);
    for (let t = Math.ceil(lo / st) * st; t <= hi && out.length < 5000; t += st) out.push(t);
  } else if (unit === 'day') {
    const d0 = new Date(lo);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
    while (out.length < 5000) {
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= dim; d += step) { const t = Date.UTC(y, m, d); if (t > hi) return out; if (t >= lo) out.push(t); }
      if (++m === 12) { m = 0; y++; }
      if (Date.UTC(y, m, 1) > hi) break;
    }
  } else if (unit === 'month') {
    const d0 = new Date(lo);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth() - (d0.getUTCMonth() % step);
    for (let t = Date.UTC(y, m, 1); t <= hi && out.length < 5000; t = Date.UTC(y, m, 1)) { if (t >= lo) out.push(t); m += step; if (m >= 12) { y += Math.floor(m / 12); m %= 12; } }
  } else {
    const y0 = new Date(lo).getUTCFullYear();
    for (let y = Math.ceil(y0 / step) * step; out.length < 5000; y += step) { const t = Date.UTC(y, 0, 1); if (t > hi) break; if (t >= lo) out.push(t); }
  }
  return out;
}
// the label format each unit reads in (matplotlib's AutoDateFormatter scale)
const _DATE_FMT = { year: '%Y', month: '%Y-%m', day: '%Y-%m-%d', hour: '%H:%M', minute: '%H:%M', second: '%H:%M:%S', ms: '%H:%M:%S.%f' };
// at most `count` calendar ticks in [lo, hi]: { values, labels, unit }
export function _dateTicks(lo, hi, count) {
  const span = hi - lo;
  for (const [unit, step, approx] of _DATE_STEPS) {
    if (span / approx > count + 1) continue;
    const values = _dateTicksAt(unit, step, lo, hi);
    if (values.length > count && !(unit === 'year' && step === 1000)) continue;
    if (values.length < 2 && unit !== _DATE_STEPS[0][0]) continue;
    const fmt = _DATE_FMT[unit];
    // hours and minutes across days: midnight says which day
    const labels = values.map((t) => ((unit === 'hour' || unit === 'minute') && t % DAY === 0 ? strftime(t, '%Y-%m-%d') : strftime(t, fmt)));
    values.step = approx;
    return { values, labels, unit };
  }
  // under a second: plain milliseconds, round steps
  const values = _niceTicks(lo, hi, count);
  return { values, labels: values.map((t) => strftime(t, _DATE_FMT.ms).replace(/0{3}$/, '')), unit: 'ms' };
}

export class DateFormatter extends Formatter {
  constructor(fmt, tz) { super(); this.fmt = String(fmt); if (tz != null && tz !== 'UTC') this._tzWarn = true; }
  format(v) { return strftime(v, this.fmt); }
}
// the automatic calendar locator (what a date axis uses with no locator set)
export class AutoDateLocator extends Locator {
  constructor(opts) { super(); const o = opts || {}; this.maxticks = o.maxticks || null; }
  tick_values(lo, hi, ctx) { return _dateTicks(lo, hi, this.maxticks || (ctx && ctx.count) || 7).values; }
}
class _CalLocator extends Locator {
  constructor(unit, interval) { super(); this.unit = unit; this.interval = Math.max(1, Math.round(+interval || 1)); }
  tick_values(lo, hi) { return _dateTicksAt(this.unit, this.interval, lo, hi); }
}
export class YearLocator extends _CalLocator { constructor(base = 1) { super('year', base); } }
export class MonthLocator extends _CalLocator { constructor(bymonth = null, bymonthday = 1, interval = 1) { super('month', typeof bymonth === 'object' && bymonth && !Array.isArray(bymonth) ? bymonth.interval || 1 : interval); } }
export class DayLocator extends _CalLocator { constructor(bymonthday = null, interval = 1) { super('day', typeof bymonthday === 'object' && bymonthday && !Array.isArray(bymonthday) ? bymonthday.interval || 1 : interval); } }
export class HourLocator extends _CalLocator { constructor(byhour = null, interval = 1) { super('hour', typeof byhour === 'object' && byhour && !Array.isArray(byhour) ? byhour.interval || 1 : interval); } }
export class MinuteLocator extends _CalLocator { constructor(byminute = null, interval = 1) { super('minute', typeof byminute === 'object' && byminute && !Array.isArray(byminute) ? byminute.interval || 1 : interval); } }

// a Date, an ISO string, or ms → ms; date2num / num2date in plot's units (ms, UTC)
export const _toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : +v);
export function date2num(d) { return Array.isArray(d) || ArrayBuffer.isView(d) ? Array.from(d, _toMs) : _toMs(d); }
export function num2date(n) { return Array.isArray(n) || ArrayBuffer.isView(n) ? Array.from(n, (v) => new Date(v)) : new Date(n); }

// the namespaces, as matplotlib's modules (plt.ticker, plt.dates)
export const ticker = {
  Formatter, ScalarFormatter, NullFormatter, FuncFormatter, StrMethodFormatter, FormatStrFormatter, FixedFormatter, PercentFormatter, EngFormatter,
  Locator, NullLocator, FixedLocator, MultipleLocator, MaxNLocator, AutoMinorLocator, LogLocator,
};
export const dates = {
  DateFormatter, AutoDateLocator, YearLocator, MonthLocator, DayLocator, HourLocator, MinuteLocator, date2num, num2date, strftime,
};

// what set_major_formatter takes: a Formatter, a function (x, pos), or a str (a {}-template)
export function _asFormatter(f, strictFlag) {
  if (f instanceof Formatter) return f;
  if (typeof f === 'function') return new FuncFormatter(f);
  if (typeof f === 'string') return new StrMethodFormatter(f);
  if (f && typeof f.format === 'function') return f;
  throw new TypeError('set_major_formatter: give a Formatter, a function (x, pos) → str, or a format string like "{x:,.0f}"');
}
export function _asLocator(l) {
  if (l instanceof Locator || (l && typeof l.tick_values === 'function')) return l;
  if (Array.isArray(l) || ArrayBuffer.isView(l)) return new FixedLocator(l);
  throw new TypeError('set_major_locator: give a Locator (MultipleLocator(5), MaxNLocator(6), FixedLocator([...]), …)');
}
