// matplotlib's positional arguments, everywhere. A matplotlib user writes hist(data, 20),
// errorbar(x, y, yerr), bar(x, h, 0.5), scatter(x, y, sizes, {color}) — arguments plot's methods
// took only by name, so they were dropped without a word (the model eval found scatter's; an
// audit found the rest). Each chart method is wrapped here: the arguments after its fixed ones are
// matched to matplotlib's own order and folded into the options; a trailing plain object is always
// the options, whatever comes before it; a positional given by name too, or past the known ones,
// warns (strict: throws). Loaded after the chart modules, so it wraps their methods as defined.

import { Axes, _plainOpts } from './axes.js';
import { _warn } from './opts.js';

// [method, fixed arguments, matplotlib's next positionals in order]
const SIGS = [
  ['bar', 2, ['width', 'bottom']],
  ['barh', 2, ['height', 'left']],
  ['hist', 1, ['bins', 'range', 'density', 'weights', 'cumulative', 'bottom', 'histtype', 'align', 'orientation', 'rwidth', 'log', 'color', 'label', 'stacked']],
  ['errorbar', 2, ['yerr', 'xerr', 'fmt', 'ecolor', 'elinewidth', 'capsize']],
  ['scatter', 2, ['s', 'c', 'marker', 'cmap', 'norm', 'vmin', 'vmax', 'alpha', 'linewidths', 'edgecolors']],
  ['hexbin', 2, ['C', 'gridsize', 'bins', 'xscale', 'yscale', 'extent', 'cmap', 'norm', 'vmin', 'vmax', 'alpha', 'linewidths', 'edgecolors', 'reduce_C_function', 'mincnt', 'marginals']],
  ['hist2d', 2, ['bins', 'range', 'density', 'weights', 'cmin', 'cmax']],
  ['violinplot', 1, ['positions', 'vert', 'widths', 'showmeans', 'showextrema', 'showmedians', 'quantiles', 'points', 'bw_method']],
  // boxplot's positional order shifted across matplotlib versions after `vert`: only the stable head
  ['boxplot', 1, ['notch', 'sym', 'vert']],
  ['axhline', 1, ['xmin', 'xmax']],
  ['axvline', 1, ['ymin', 'ymax']],
  ['axhspan', 2, ['xmin', 'xmax']],
  ['axvspan', 2, ['ymin', 'ymax']],
  ['hlines', 3, ['colors', 'linestyles', 'label']],
  ['vlines', 3, ['colors', 'linestyles', 'label']],
  ['fill_between', 2, ['y2', 'where', 'interpolate', 'step']],
  ['fill_betweenx', 2, ['x2', 'where', 'step']],
  ['annotate', 2, ['xytext', 'xycoords', 'textcoords', 'arrowprops']],
  ['grid', 1, ['which', 'axis']],
];

// the arguments after the fixed ones → one options object
export function _positional(fn, rest, names, strictFlag) {
  let opts = {};
  if (rest.length && _plainOpts(rest[rest.length - 1])) { opts = { ...rest[rest.length - 1] }; rest = rest.slice(0, -1); }
  rest.forEach((v, i) => {
    if (v === undefined || v === null) return;              // Python's None: the default
    if (i >= names.length) {
      _warn(`${fn}.positional.${i}`, `${fn}(): ${rest.length} positional arguments after the first ones, but plot reads ${names.length} (${names.join(', ')}); pass the rest by name`, strictFlag);
      return;
    }
    const k = names[i];
    if (opts[k] !== undefined) _warn(`${fn}.${k}.twice`, `${fn}(): '${k}' given both by position and by name; the name wins`, strictFlag);
    else opts[k] = v;
  });
  return opts;
}

for (const [name, fixed, names] of SIGS) {
  const orig = Axes.prototype[name];
  if (typeof orig !== 'function') continue;
  Axes.prototype[name] = function (...args) {
    // already the method's own shape (fixed arguments, then nothing or the options)
    if (args.length <= fixed || (args.length === fixed + 1 && (_plainOpts(args[fixed]) || args[fixed] === undefined))) return orig.apply(this, args);
    const head = args.slice(0, fixed);
    while (head.length < fixed) head.push(undefined);
    return orig.call(this, ...head, _positional(name, args.slice(fixed), names, this._strict));
  };
}

// imshow: plot's flat form imshow(data, nx, ny, opts) keeps its numbers; otherwise matplotlib's
// imshow(X, cmap, norm, aspect, interpolation, alpha, vmin, vmax, origin, extent)
{
  const orig = Axes.prototype.imshow;
  const NAMES = ['cmap', 'norm', 'aspect', 'interpolation', 'alpha', 'vmin', 'vmax', 'origin', 'extent'];
  Axes.prototype.imshow = function (data, ...rest) {
    if (typeof rest[0] === 'number' && typeof rest[1] === 'number') return orig.call(this, data, ...rest);
    if (!rest.length || (rest.length === 1 && _plainOpts(rest[0]))) return orig.call(this, data, ...rest);
    return orig.call(this, data, _positional('imshow', rest, NAMES, this._strict));
  };
}
