# @gcu/plot — API

matplotlib for the browser. **If you know matplotlib, write matplotlib**: the same function
names, positional arguments, defaults and meanings. In JavaScript the keyword arguments are a
trailing options object with matplotlib's names (`{ linewidth: 2, color: 'C1' }`) and its short
aliases (`lw`, `c`, `ls`, `ms`, `ec`, `fc`). In adder (Python) cells it is matplotlib verbatim.

Canvas 2D, no WebGL, no WASM, no workers, no network; the same figure gives the same draw list
in a browser, a worker and Node. Nothing is silently ignored: an option plot doesn't know warns
once (`plot() has no option 'colour', did you mean 'color'?`), and `{ strict: true }` or
`rcParams['gcu.strict'] = true` makes every warning an error.

```js
import { subplots } from '@gcu/plot';
const [fig, ax] = subplots(1, 1, { figsize: [6, 4] });       // or: const { fig, ax } = subplots()
ax.plot(x, y, { label: 'Fe', lw: 2 });
ax.set_xlabel('depth (m)'); ax.legend();
document.body.append(fig.show());                            // show() returns the <canvas>
```

```python
import matplotlib.pyplot as plt                               # adder: the same plot, as plt
fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, y, label="Fe", lw=2)
ax.set_xlabel("depth (m)"); ax.legend()
plt.show()
```

Columns are anything array-like: `Array`, every typed array (used in place, never copied),
ndarrays, iterables. NaN and ±Inf never throw: lines break at NaN, NaN cells are transparent,
histograms leave NaN out, log axes ignore values ≤ 0. Errors name the argument:
`scatter: c has 1,000 values but x has 999`.

## Figures

| call | |
|---|---|
| `subplots(nrows = 1, ncols = 1, {figsize = [4, 3], dpi = 100, sharex, sharey, theme, facecolor, wspace, hspace, strict})` | → `[fig, ax]` for 1 × 1, `[fig, axes]` otherwise (a 2D array for R × C, with `.flat`); also `.fig` / `.ax` / `.axes`. figsize in inches (× dpi) or pixels if > 50 |
| `sharex` / `sharey` | `true` · `'all'` · `'row'` · `'col'`: one range (and one set of categories); tick labels only on the outer axes |
| `figure({figsize, dpi, theme})` | a 1 × 1 figure |
| `fig.suptitle(text)` · `fig.colorbar(mappable, {ax, …})` · `fig.set_theme(theme)` | |
| `fig.show()` | → a `<canvas>` (in Node: records the figure; see `plt.shown()`) |
| `fig.draw(ctx, {dpr})` · `fig.toDrawList()` · `replay(ctx, list)` · `await fig.toPNG({dpr})` · `fig.savefig(name)` | draw anywhere; a draw list is JSON (`version: 2`) |
| `fig.axesAt(px, py)` | the axes under a pixel |

## Charts

Every chart takes `label`, `alpha`, `zorder` and `color` as well as what is listed. The ones
that colour-map (`scatter` with `c`, `imshow`, `pcolormesh`, `contour(f)`) take `cmap`, `norm`,
`vmin`, `vmax`, and return a **mappable** for `colorbar(…)`. Results chain to the axes:
`ax.bar(…).set_title(…)` works.

| call | returns |
|---|---|
| `plot([x,] y, [fmt], {linestyle, linewidth, marker, markersize, markerfacecolor, markeredgecolor, drawstyle})` | `[line]` (`line, = ax.plot(…)`; `line.get_xdata()`) |
| `scatter(x, y, [s], [c], {s, c, marker, cmap, norm, vmin, vmax, edgecolors, linewidths})` | a mappable. `s` in points² (36), `c` values (mapped) or colours (one per point); markers `o s ^ v < > d D p h * + x .` |
| `bar(x, height, {width = 0.8, bottom, align = 'center' \| 'edge', color, edgecolor, tick_label})` · `barh(y, width, {height, left, …})` | a BarContainer: the bars (`get_height()` …), `.datavalues` |
| `bar_label(container, [labels], {fmt = '%g', padding, label_type = 'edge' \| 'center'})` | fmt: `'%.1f'`, `'{:,.0f}'`, or a function |
| `hist(x, {bins = 10, range, weights, density, cumulative, histtype, orientation, stacked, bottom, log, rwidth, align})` | `[n, bins, patches]`. x one array or a list (one set of bins for all; side by side or `stacked`). `bins`: a count, edges, or numpy's rules `'auto' 'fd' 'sturges' 'sqrt' 'rice' 'scott'`. `histtype`: `'bar' 'barstacked' 'step' 'stepfilled'` |
| `boxplot(x, {whis = 1.5, labels, vert, showfliers, showmeans, meanline, widths, positions, patch_artist, *props})` | `{medians, boxes, whiskers, caps, fliers, means, stats}`; x one array, a list, or a mapping `{label: array}` (keys label) |
| `imshow(Z, {cmap, norm, vmin, vmax, extent, origin = 'upper', interpolation = 'nearest' \| 'bilinear', alpha, aspect})` | a mappable. Z 2D (nested arrays, an ndarray, a DataFrame); NaN transparent |
| `imshow(data, nx, ny, {…})` | plot's flat form: row-major, `origin = 'lower'`, extent `[0, nx, 0, ny]` |
| `matshow(Z)` | imshow with origin upper and equal aspect |
| `pcolormesh([X, Y,] C, {shading = 'auto' \| 'flat' \| 'nearest', edgecolors, cmap, norm})` | a mappable. X, Y: edges (n+1), centres (n), or 2D corner grids (curvilinear) |
| `contour([X, Y,] Z, [levels], {colors, cmap, norm, linewidths, linestyles, extent})` · `contourf(…, {extend})` | a ContourSet: `.levels`, `.allsegs`. levels an int (≈ that many nice levels) or values; a single-colour contour dashes negative levels |
| `fill_between(x, y1, y2 = 0, {where, step, color, alpha})` · `fill_betweenx(y, x1, x2 = 0, …)` | |
| `step([x,] y, [fmt], {where = 'pre' \| 'post' \| 'mid'})` | as plot |
| `errorbar(x, y, {yerr, xerr, fmt = '', ecolor, elinewidth, capsize = 0})` | `[line, caps, bars]`; errors a number, one per point, or `[lower, upper]`; `fmt: 'none'` draws only the bars |
| `axhline(y, {xmin = 0, xmax = 1})` · `axvline(x, {ymin, ymax})` · `hlines(y, x0, x1)` · `vlines(x, y0, y1)` | |
| `axhspan(y0, y1, {xmin, xmax})` · `axvspan(x0, x1, {ymin, ymax})` | a band across the axes |
| `text(x, y, s, {transform: 'axes', ha, va, fontsize, rotation, fontweight})` | `transform: 'axes'` = matplotlib's `ax.transAxes` (0–1 from the lower left) |
| `annotate(text, xy, {xytext, xycoords, textcoords, arrowprops: {arrowstyle: '->'}})` | coords: `'data'`, `'axes fraction'`, `'offset points'` |

Strings as `x` (bar, scatter, plot, boxplot positions) or `y` (barh) make a **category axis**,
in first-appearance order; long labels rotate rather than collide.

## Axes

| call | |
|---|---|
| `set_title` · `set_xlabel` · `set_ylabel` | |
| `set_xlim(left, right)` · `set_xlim([l, r])` · `set_xlim({left: 0})` | a missing end keeps its value; `null` = from the data; left > right inverts |
| `get_xlim()` · `invert_xaxis()` · `invert_yaxis()` · `xaxis_inverted()` | |
| `set_xscale('linear' \| 'log')` · `set_yscale` | |
| `set_xticks(ticks, [labels], {rotation})` · `set_xticklabels(labels, {rotation})` · `get_xticks()` · `tick_params({axis, labelrotation})` | `set_xticks([])`: none |
| `margins(m)` · `margins(x, y)` | 0.05 by default; bars and histograms stand on 0, images and contours fit tight |
| `axis('off' \| 'on' \| 'equal' \| 'scaled' \| 'image' \| 'tight' \| [x0, x1, y0, y1])` · `set_aspect('equal')` | returns the limits |
| `grid(true, {color, linestyle, linewidth, alpha, axis})` | at the ticks |
| `legend()` · `legend(labels)` · `legend(handles, labels)` · `{loc = 'best', bbox_to_anchor, ncols, title, fontsize, frameon, framealpha}` | `'best'` avoids the data; `{bbox_to_anchor: [1.01, 1], loc: 'upper left'}` puts it outside, and the layout makes room |
| `colorbar([mappable], {label, ticks, format, extend})` | follows the mappable (else the last colour-mapped chart) and its norm; `extend` arrows; class bands for a BoundaryNorm or contourf |
| `twinx()` · `twiny()` | a second y (x) axis |
| `pick(px, py, {radius = 8})` · `toPixel(x, y)` · `toData(px, py)` · `ax.view` | after a draw: what is under a pixel |

Ticks are sized to the axis (no overlapping labels), labels carry the decimals the step needs,
and the margins are measured from the real tick labels, titles and colorbar.

## Colour

Colours: matplotlib's names (`'C0'`–`'C9'`, `'tab:blue'`, `'r'`, `'k'`, CSS names, `'#rrggbb'`).
Colour maps: `viridis plasma inferno magma cividis turbo coolwarm jet gray Greys hot cool spring
summer autumn winter RdBu RdYlBu RdYlGn Spectral PiYG BrBG Blues Reds Greens Oranges Purples
YlOrRd YlOrBr YlGnBu YlGn bwr seismic terrain tab10 tab20 Set1 Set2 Set3 Paired Dark2`, each with
`_r`; an unknown name warns.

| | |
|---|---|
| `colors.Normalize(vmin, vmax)` · `colors.LogNorm(vmin, vmax)` · `norm: 'log'` | |
| `colors.TwoSlopeNorm(vcenter, vmin, vmax)` · `colors.CenteredNorm(vcenter, halfrange)` | diverging about a centre |
| `colors.BoundaryNorm(boundaries, ncolors)` | discrete classes; with `ListedColormap(colors)` (ncolors = its N), one colour per class |
| `colors.ListedColormap(colors)` · `colors.LinearSegmentedColormap.from_list(name, colors)` | |

## Themes

A theme is `@gcu/theme`'s keys (shared with `@gcu/condenser`'s 3D view): `background`,
`figure`, `foreground`, `muted`, `grid`, `frame`, `panel`, `panel_border`, `accent`,
`selection`, `halo`, `cycle`, `ramp`, `font`, `mono`, `font_size`.

- `plt.style.use('default')` (and matplotlib's other light styles): white (`paper`);
  `'dark_background'`: the dark theme (the default in auditable); also `'dark'`, `'light'`,
  `'paper'`. It sets the default a figure copies when it is made.
- `subplots({theme: 'paper'})` · `fig.set_theme({base: 'light', accent: '#c00'})` · `themeFromCSS(el)` (a page's design tokens).
- The colour cycle is matplotlib's tab10. Text is the theme's monospace stack, which is what
  keeps a figure's layout identical live, recorded and replayed.

## pyplot (`plt`)

`plt.subplots`, `plt.figure`, `plt.gca`, `plt.gcf`, `plt.xlabel`, `ylabel`, `title`, `xlim`,
`ylim`, `xscale`, `yscale`, `xticks(ticks, labels, {rotation})`, `yticks`, `axis`, `margins`,
`legend`, `grid`, `colorbar`, `suptitle`, `text`, `annotate`, `axhline`, `axvline`, `hlines`,
`vlines`, `axhspan`, `axvspan`, `fill_between`, `fill_betweenx`, `step`, `errorbar`, `barh`,
`bar_label`, `boxplot`, `contour`, `contourf`, `pcolormesh` act on the current axes;
`plt.show()`, `plt.savefig()`, `plt.close()`, `plt.style.use()`, `plt.rcParams`, `plt.cm`,
`plt.colors`.

## Differs from matplotlib

| | matplotlib | plot |
|---|---|---|
| keyword arguments | `ax.plot(x, y, lw=2)` | JS: `ax.plot(x, y, { lw: 2 })` (adder: as matplotlib) |
| `plt.plot`, `plt.scatter`, `plt.bar`, `plt.hist`, `plt.imshow`, `plt.matshow` | draw on the current axes | each makes a new figure and returns its `<canvas>` (use `subplots()` and `ax.…` to put several on one axes) |
| `imshow(data, nx, ny)` | — | plot's flat form, origin `'lower'`; `imshow(Z)` is matplotlib's |
| fonts | DejaVu Sans | the theme's monospace stack |
| contourf | antialiased off | bands overlap bottom-up, so no seams either way |
| `tight_layout()` | rearranges | layout is always measured; the call does nothing, by design |

## Unsupported

What plot knows of but doesn't do yet; each one warns when used, with what to do instead.

<!-- unsupported:begin -->
| | instead |
|---|---|
| `plot(…, {dashes})` | use linestyle ('--', '-.', ':') |
| `bar(…, {hatch})` | not supported yet |
| `bar(…, {yerr})` | use errorbar() on the bar positions |
| `bar(…, {xerr})` | use errorbar() on the bar positions |
| `barh(…, {hatch})` | not supported yet |
| `barh(…, {xerr})` | use errorbar() on the bar positions |
| `hist(…, {hatch})` | not supported yet |
| `text(…, {bbox})` | not supported yet |
| `legend(…, {shadow})` | not supported yet |
| `legend(…, {fancybox})` | not supported yet |
| `legend(…, {mode})` | not supported yet |
| `legend(…, {handlelength})` | not supported yet |
| `legend(…, {columnspacing})` | not supported yet |
| `colorbar(…, {shrink})` | not supported yet |
| `colorbar(…, {orientation})` | only vertical colorbars for now |
| `colorbar(…, {fraction})` | not supported yet |
| `colorbar(…, {pad})` | not supported yet |
| `subplots(…, {squeeze})` | not supported yet |
| `subplots(…, {constrained_layout})` | layout is always tight |
| `subplots(…, {layout})` | layout is always tight |
| `rc()` | plt.rc is not supported yet; use plt.style.use('default' \| 'dark_background') |
| `set_zorder()` | axes are drawn in creation order |
| `subplots_adjust()` | not supported yet; use subplots(..., {gap}) for the space between axes |
<!-- unsupported:end -->
