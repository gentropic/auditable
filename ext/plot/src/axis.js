// ax.xaxis / ax.yaxis — matplotlib's Axis objects, as far as a chart's code reaches for them:
// the tick formatters and locators (major and minor), a date axis, the axis label. They hold
// their settings on the axes they belong to, for every axes sharing that axis.

import { Axes } from './axes.js';
import { _asFormatter, _asLocator } from './ticker.js';

class Axis {
  constructor(ax, name) { this.axes = ax; this.axis_name = name; }
  _set(k, v) {
    for (const a of this.axes._group(this.axis_name)) a._ticker(this.axis_name)[k] = v;
    return this;
  }
  set_major_formatter(f) { return this._set('majorF', f == null ? null : _asFormatter(f)); }
  set_minor_formatter(f) { return this._set('minorF', f == null ? null : _asFormatter(f)); }
  set_major_locator(l) { return this._set('majorL', l == null ? null : _asLocator(l)); }
  set_minor_locator(l) { return this._set('minorL', l == null ? null : _asLocator(l)); }
  get_major_formatter() { return this.axes._ticker(this.axis_name).majorF; }
  get_minor_formatter() { return this.axes._ticker(this.axis_name).minorF; }
  get_major_locator() { return this.axes._ticker(this.axis_name).majorL; }
  get_minor_locator() { return this.axes._ticker(this.axis_name).minorL; }
  // the axis holds dates: numbers on it are ms since 1970 UTC (Date objects say so by themselves)
  axis_date(_tz) { for (const a of this.axes._group(this.axis_name)) a[this.axis_name === 'x' ? '_xdate' : '_ydate'] = true; return this; }
  set_label_text(s, opts) { return this.axes[this.axis_name === 'x' ? 'set_xlabel' : 'set_ylabel'](s, opts); }
  get_label_text() { const l = this.axes[this.axis_name === 'x' ? '_xlabel' : '_ylabel']; return l ? l.text : ''; }
  set_ticks(ticks, labels, opts) { return this.axes[this.axis_name === 'x' ? 'set_xticks' : 'set_yticks'](ticks, labels, opts); }
  get_ticklocs() { return this.axes[this.axis_name === 'x' ? 'get_xticks' : 'get_yticks'](); }
  get_ticklabels() { return this.axes[this.axis_name === 'x' ? 'get_xticklabels' : 'get_yticklabels'](); }
  __repr__() { return `<${this.axis_name.toUpperCase()}Axis>`; }
}

Axes.prototype._ticker = function (axis) {
  const k = axis === 'x' ? '_tkx' : '_tky';
  return this[k] || (this[k] = { majorF: null, minorF: null, majorL: null, minorL: null, minorOn: false });
};
Object.defineProperty(Axes.prototype, 'xaxis', { get() { return this._xaxisObj || (this._xaxisObj = new Axis(this, 'x')); }, configurable: true });
Object.defineProperty(Axes.prototype, 'yaxis', { get() { return this._yaxisObj || (this._yaxisObj = new Axis(this, 'y')); }, configurable: true });
Axes.prototype.xaxis_date = function (tz) { this.xaxis.axis_date(tz); return this; };
Axes.prototype.yaxis_date = function (tz) { this.yaxis.axis_date(tz); return this; };
// minor ticks between the majors (AutoMinorLocator), on both axes
Axes.prototype.minorticks_on = function () { for (const a of ['x', 'y']) for (const g of this._group(a)) g._ticker(a).minorOn = true; return this; };
Axes.prototype.minorticks_off = function () { for (const a of ['x', 'y']) for (const g of this._group(a)) { const t = g._ticker(a); t.minorOn = false; t.minorL = null; } return this; };
