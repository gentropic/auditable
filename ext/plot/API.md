# @gcu/plot — API

matplotlib for the browser. **If you know matplotlib, write matplotlib**: the same function
names, positional arguments, defaults and meanings. In JavaScript the keyword arguments are a
trailing options object with matplotlib's names (`{ linewidth: 2, color: 'C1' }`) and its short
aliases (`lw`, `c`, `ls`, `ms`, `ec`, `fc`). Positional arguments follow matplotlib's order —
`hist(x, 20)`, `errorbar(x, y, yerr)`, `bar(x, h, 0.5)`, `scatter(x, y, s, c)` — and a trailing
object is always the options. In adder (Python) cells it is matplotlib verbatim.

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
| `figure({figsize, dpi, theme})` | a 1 × 1 figure, made current (pyplot) |
| `ax.figure` · `ax.get_figure()` | the figure an axes belongs to |
| `fig.suptitle(text)` · `fig.colorbar(mappable, {ax, …})` · `fig.set_theme(theme)` | |
| `fig.show()` | → a `<canvas>` (in Node: records the figure; see `plt.shown()`) |
| `fig.draw(ctx, {dpr})` · `fig.toDrawList()` · `replay(ctx, list)` · `await fig.toPNG({dpr})` | draw anywhere; a draw list is JSON (`version: 2`) |
| `fig.toSVG({facecolor})` · `toSVG(drawList)` | an SVG string (see [Export](#export)) |
| `fig.savefig('x.png' \| 'x.svg')` · `savefig(name, {format})` | a download; with no DOM, `{name, format, figure}` in `plt.saved()` |
| `fig.set_facecolor(c)` · `ax.set_facecolor(c)` | `'none'`: nothing painted, for axes over another picture |
| `fig.axesAt(px, py)` | the axes under a pixel |

## Charts

Every chart takes `label`, `alpha`, `zorder` and `color` as well as what is listed. The ones
that colour-map (`scatter` with `c`, `imshow`, `pcolormesh`, `contour(f)`) take `cmap`, `norm`,
`vmin`, `vmax`, and return a **mappable** for `colorbar(…)`. Results chain to the axes:
`ax.bar(…).set_title(…)` works. What a call returns (and each line, patch or bar container in it) has matplotlib's
`set_visible(bool)`, `get_visible()` and `remove()`: a hidden artist doesn't draw, pick or show in the legend.

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
| `violinplot(dataset, {positions, vert, widths = 0.5, showmeans, showextrema = true, showmedians, quantiles, points = 100, bw_method = 'scott', side})` | `{bodies, cmins, cmaxes, cbars, cmeans, cmedians, cquantiles, stats}`: matplotlib's KDE (Scott: n^-1/5 × std); restyle with `bodies[i].set_facecolor` / `set_alpha`, `cbars.set_color` |
| `hexbin(x, y, {C, gridsize = 100 \| [nx, ny], extent, mincnt, reduce_C_function, bins: 'log', cmap, norm})` | a mappable: matplotlib's lattice and counts exactly; with no `C` every hexagon of the extent is drawn (empty ones at the bottom of the map; `bins: 'log'` clears them) |
| `hist2d(x, y, {bins = 10 \| [nx, ny] \| edges, range, density, weights, cmin, cmax, cmap, norm})` | `[h, xedges, yedges, image]`: numpy's histogram2d, `h[i][j]` x bin i, y bin j; drawn as a pcolormesh |
| `stackplot(x, y1, y2, … \| ys, {labels, colors, baseline = 'zero' \| 'sym' \| 'wiggle' \| 'weighted_wiggle'})` | the layers (fill_between each); matplotlib's baselines |

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
| `pick(px, py, {radius = 8})` · `toPixel(x, y)` · `toData(px, py)` · `ax.view` | after a draw: what is under a pixel. `pick` → `{axes, trace, kind, index, x, y, c, s, label, value}`; markers win over line vertices, then bars and bins, polygons (`properties`), image cells (`value`) |
| `highlight(indices \| mask \| predicate, {trace, dim = 0.65})` · `highlight(null)` | dims everything but the chosen points of a scatter (a predicate `(i, x, y) → bool` runs over every scatter) |

Ticks are sized to the axis (no overlapping labels), labels carry the decimals the step needs,
and the margins are measured from the real tick labels, titles and colorbar.

## Ticks, formatters and dates

| | |
|---|---|
| `ax.xaxis.set_major_formatter(f)` · `set_minor_formatter` · `ax.yaxis…` | `f`: a format string (`'{x:,.0f} m'`, `'{x:.0%}'`), a function `(x, pos) → str`, or a formatter below |
| `ticker.StrMethodFormatter(fmt)` · `FormatStrFormatter('%.1f')` · `FuncFormatter(fn)` · `PercentFormatter(xmax = 100, decimals)` · `EngFormatter(unit)` · `FixedFormatter(labels)` · `NullFormatter()` · `ScalarFormatter()` | `plt.ticker` = `matplotlib.ticker` |
| `ax.xaxis.set_major_locator(l)` · `set_minor_locator` | `ticker.MultipleLocator(base)` · `MaxNLocator(nbins, {integer})` · `FixedLocator(locs)` · `AutoMinorLocator(n)` · `LogLocator()` · `NullLocator()` |
| `ax.minorticks_on()` · `minorticks_off()` | minor ticks between the majors (5 for a step of 1, 2.5 or 5 × 10ⁿ, else 4, as matplotlib); `grid(true, {which: 'minor' \| 'both'})` |
| `tick_params({axis, which, length, width, direction: 'out' \| 'in' \| 'inout', color, labelrotation})` | |
| Date objects as x or y | a date axis: calendar ticks (years, months, days, hours …) and labels by spacing (`2026`, `2026-03`, `2026-03-14`, `14:30`) |
| `ax.xaxis_date()` | epoch milliseconds on x are dates |
| `dates.DateFormatter('%b %Y')` · `AutoDateLocator()` · `YearLocator(n)` · `MonthLocator(…, {interval})` · `DayLocator` · `HourLocator` · `MinuteLocator` · `date2num` · `num2date` · `strftime(ms, fmt)` | `plt.dates` = `matplotlib.dates`; strftime codes `%Y %y %m %d %e %H %I %M %S %f %p %b %B %a %A %j` |

Format strings are Python's, checked against CPython: `[[fill]align][sign][#][0][width][,|_][.precision][type]`
with types `d f e g % s x o b` (an exact binary tie rounds to even, as Python), in `{}` templates
(`{x}`, `{pos}`, `{:.2f}`) and `%`-style (`%.2f`, `%d` truncating). bar_label's `fmt` reads them too.
Tick labels use matplotlib's minus sign, U+2212 (−), where matplotlib does: the default labels, a `{}`
template's fields, PercentFormatter, EngFormatter, colorbars; `%`-style and functions print what they
make. `rcParams['axes.unicode_minus'] = false` gives the ASCII hyphen everywhere.

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
| `new ScalarMappable({cmap, norm, vmin, vmax})` (`plt.cm.ScalarMappable`) · `colorbar({cmap, vmin, vmax, norm})` | a colour scale with nothing of plot's behind it: its colorbar alone |

## Plan views

Maps in projected or local coordinates, no basemap. Use `set_aspect('equal')`; it survives
zoom and pan.

| call | |
|---|---|
| `add_geometry(geojson, {facecolor, edgecolor, linewidth, linestyle, alpha, label, color, marker, s})` | a GeoJSON Geometry, Feature or FeatureCollection, `[x, y]` in data units. Polygons (holes too, either winding) fill even-odd; a pick inside one returns its `properties` |
| `fill(x, y, [fmt], …, {facecolor, edgecolor, closed})` | matplotlib's filled polygon(s) → `[Polygon]` |
| `add_patch(new Polygon(xy, {closed, fill}))` · `Rectangle([x, y], w, h, {angle})` · `Circle([x, y], r)` | matplotlib.patches (also `plt.Polygon` …) |
| `scalebar({units = 'm', length, loc = 'lower right', color, label})` | the x axis's scale: a nice length about a fifth of the view; metres read as km from 1,000 |
| `north_arrow({loc = 'upper right', rotation = 0, size = 28, color})` | north is +y (flipped on an inverted y); `rotation` (° clockwise) for a grid that isn't north-up |
| `imshow(Z, {extent: [x0, x1, y0, y1]})` | a georeferenced grid lands in place |

## Axes as chrome over another renderer

plot draws the frame, ticks, labels, legend and colorbar around a picture it doesn't draw (a
3D view's plan or section, a map, a stereonet): a transparent face, the other camera's
limits, the plot rect to fit the other canvas to.

```js
fig.set_facecolor('none'); ax.set_facecolor('none');
ax.set_aspect('equal');
ax.set_view({ xlim: [e0, e1], ylim: [n0, n1] });   // or condenser's view rect {u0, u1, v0, v1}
ax.colorbar(new ScalarMappable({ cmap: 'magma', norm: new colors.Normalize(0, 3.5) }), { label: 'Cu (%)' });
fig.draw(ctx);                     // then: ax.view {x, y, w, h} is where the picture goes, and
const [x0, x1] = ax.get_xlim();    // get_xlim / get_ylim what it must show (equal aspect may widen one)
```

Under `interact()`, `ax.set_view()` redraws by itself and fires no `onViewChange`; the user's own
zoom and pan fire it. That's the two-way sync, with no echo.

## Export

| | |
|---|---|
| `fig.toSVG({facecolor})` | from the draw list: paths, `<text>` in the theme's font, clip paths, and rasters (imshow, big scatters) as embedded PNG. Same figure, same bytes |
| `toSVG(fig.toDrawList())` · `import { toSVG } from '@gcu/plot/svg'` | the same from a list made elsewhere (a worker, Node) |
| `encodePNG(rgba, w, h)` | PNG bytes in plain JS (no canvas) |

A large scatter stays one embedded raster in the SVG, which is honest and small. The dark theme's
figure surface is transparent (a chart blends into the page); a file has no page, so an export
paints the theme's background under it unless the face was set (`set_facecolor('none')` stays
clear) or `{facecolor}` is given.

## Interaction (`@gcu/plot/interact`)

```js
import { interact, link } from '@gcu/plot';          // or '@gcu/plot/interact'
const ui = interact(fig, { units: 'm', onBrush: ({ axes, x, y }) => filter(x, y) });
document.body.append(ui.element);                    // the canvas, with its overlay
```

| | |
|---|---|
| `interact(fig, [canvas], {readout, crosshair, units, format, extra, brush, radius, label, onBrush, onClick, onViewChange, onHover})` | → `{element, canvas, on, off, reset, redraw, setSelection, selection, destroy}` |
| hover | readout, crosshair and ring on an overlay (the figure isn't redrawn). `format(pick)` → lines replaces the readout; `extra(trace, index)` adds lines; `units: 'm'` or `{x, y}` |
| wheel · drag · double-click | zoom about the cursor (shift: x only, alt: y only) · pan · reset. Log and inverted axes too; equal aspect is kept |
| shift-drag (or drag with `brush: 'x' \| 'y' \| 'xy'`) | a brush: `onBrush({axes, x: [lo, hi], y})`; a click clears it |
| `onClick(pick)` · `onViewChange({axes, xlim, ylim})` · `ui.on('brush' \| 'click' \| 'view' \| 'hover', fn)` | |
| keys | focusable, aria-labelled: arrows pan, `+` / `-` zoom, `0` resets, `Esc` clears |
| touch | pointer events; two fingers pinch-zoom and pan |
| `link([ax1, ax2], {x = true, y = true})` | one view for several axes, across figures; returns an unlink function |

## Themes

A theme is `@gcu/theme`'s keys (shared with `@gcu/condenser`'s 3D view): `background`,
`figure`, `foreground`, `muted`, `grid`, `frame`, `panel`, `panel_border`, `accent`,
`selection`, `halo`, `cycle`, `ramp`, `font`, `mono`, `font_size`.

- `plt.style.use('default')` (and matplotlib's other light styles): white (`paper`);
  `'dark_background'`: the dark theme (the default in auditable); also `'dark'`, `'light'`,
  `'paper'`. It sets the default a figure copies when it is made.
- `subplots({theme: 'paper'})` · `fig.set_theme({base: 'light', accent: '#c00'})` · `themeFromCSS(el, map?)` (a page's design tokens, below).

- `themeFromCSS(el, map?)` reads CSS custom properties on `el`: for each theme key, the first
  of its candidate tokens that is set (`CSS_MAP`):

  | key | tokens tried, in order |
  |---|---|
  | background | `--au-surface` `--bg-primary` `--background` `--bg` `--color-background` `--color-bg` `--surface` `--bg-color` |
  | foreground | `--au-fg` `--text-primary` `--foreground` `--fg` `--text` `--color-text` `--text-color` `--color-foreground` |
  | muted | `--au-fg-soft` `--text-secondary` `--text-muted` `--muted-foreground` `--muted` `--fg-muted` |
  | grid · frame · panel_border | `--au-border-soft` … · `--au-rule` `--border` … · `--au-border` `--border` … |
  | panel · accent · selection | `--au-surface-raised` `--bg-secondary` `--card` … · `--au-action` `--accent` `--primary` … · `--au-selected` `--selection` `--ring` … |
  | font · mono | `--au-font-sans` `--font-sans` `--font-family` · `--au-font-mono` `--font-mono` |
  | cycle | numbered tokens: `--au-series-1…`, `--series-1…`, `--chart-1…` (the first prefix that has a 1) |

  Other names: pass a map, merged over these — `themeFromCSS(el, { background: '--page-bg',
  foreground: ['--ink', '--text'] })`. When no background token is set (or it's in a form the
  theme can't read, e.g. `oklch()`), the element's own computed background and text colour
  decide, so a light page never gets a dark chart. The figure surface comes out transparent: the
  chart sits on the page, its plot area the page's background (an export still paints a face). Call
  it again when the page switches mode.
- The colour cycle is matplotlib's tab10. Text is the theme's monospace stack, which is what
  keeps a figure's layout identical live, recorded and replayed.

## pyplot (`plt`)

`plt.subplots`, `plt.figure`, `plt.gca`, `plt.gcf`, `plt.xlabel`, `ylabel`, `title`, `xlim`,
`ylim`, `xscale`, `yscale`, `xticks(ticks, labels, {rotation})`, `yticks`, `axis`, `margins`,
`legend`, `grid`, `colorbar`, `suptitle`, `text`, `annotate`, `axhline`, `axvline`, `hlines`,
`vlines`, `axhspan`, `axvspan`, `fill_between`, `fill_betweenx`, `step`, `errorbar`, `barh`,
`bar_label`, `boxplot`, `contour`, `contourf`, `pcolormesh`, `fill`, `add_geometry` act on the
current axes; `plt.show()`, `plt.flush_figures()`, `plt.savefig()`, `plt.close()`,
`plt.style.use()`, `plt.rcParams`, `plt.cm` (with `plt.cm.ScalarMappable`), `plt.colors`,
`plt.Polygon`, `plt.Rectangle`, `plt.Circle`.

`plt.plot`, `plt.scatter`, `plt.bar`, `plt.hist`, `plt.imshow` draw on the current axes too,
opening a figure when there is none, and return what the `ax.` call returns:
`plt.plot(a); plt.plot(b); plt.title('t')` is one figure with two lines. `plt.matshow` and
`plt.figure` open a new figure; `plt.subplot(211)`, `plt.subplot(212)` are two axes of one.

When a figure appears:

| where | how |
|---|---|
| a Python (adder) cell | Jupyter's inline backend. The cell starts with no current figure; when it ends, the figures it opened and didn't show appear in its output, then close. `plt.show()` shows them where it is called (a loop of plot-and-show gives one per pass) and returns None. `fig.show()` returns the canvas, and that figure isn't shown again at the end. |
| a JS cell | only what the cell asks for: `display(plt.show())` (one canvas, or a `<div>` of them) or `display(fig.show())`. The cell starts with no current figure, so a re-run draws a fresh one. |
| a worker or Node host | after each run, `plt.flush_figures()` (IPython's name) shows what's open; `plt.shown()` lists the figures as Figure objects to replay. |

## Examples

One per chart type. Each builds `fig` from `@gcu/plot`'s names; `gallery.html` draws them all,
in the dark theme and in paper, each under `interact()` (it is generated from these blocks).

```js example plot
const x = Array.from({ length: 100 }, (_, i) => i / 10);
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.plot(x, x.map(Math.sin), { label: 'sin' });
ax.plot(x, x.map(Math.cos), '--', { label: 'cos' });
ax.set_xlabel('t (s)'); ax.set_title('plot'); ax.legend();
```

```js example scatter
const x = [], y = [], r = [];
for (let i = 1; i < 400; i++) { const a = i * 2.39996, d = Math.sqrt(i) / 2; x.push(d * Math.cos(a)); y.push(d * Math.sin(a)); r.push(d); }
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.6] });
const sc = ax.scatter(x, y, { c: r, s: 16, cmap: 'viridis' });
fig.colorbar(sc, { ax, label: 'radius' });
ax.set_aspect('equal'); ax.set_title('scatter');
```

```js example bar
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
const bars = ax.bar(['oxide', 'transition', 'fresh'], [12.4, 30.1, 57.5], { color: ['C1', 'C2', 'C0'] });
ax.bar_label(bars, { fmt: '%.1f Mt' });
ax.set_ylabel('tonnes (Mt)'); ax.set_title('bar');
```

```js example hist
const u = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;   // a deterministic uniform
const a = [], b = [];
for (let i = 0; i < 3000; i++) { a.push(u(i) + u(i + 1e4) + u(i + 2e4)); b.push(1 + u(i + 3e4) + u(i + 4e4)); }
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.hist([a, b], { bins: 30, histtype: 'stepfilled', alpha: 0.6 });
ax.legend(['A', 'B']); ax.set_title('hist');
```

```js example boxplot
const u = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;
const groups = { oxide: [], transition: [], fresh: [] };
Object.keys(groups).forEach((k, j) => { for (let i = 0; i < 200; i++) groups[k].push(30 + 8 * j + 12 * (u(i + 1e3 * j) + u(i + 5e3 + 1e3 * j) - 1)); });
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.boxplot(groups, { showmeans: true });
ax.set_ylabel('Fe (%)'); ax.set_title('boxplot');
```

```js example imshow
const Z = Array.from({ length: 60 }, (_, j) => Array.from({ length: 80 }, (_, i) => Math.sin(i / 9) * Math.cos(j / 7)));
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.4] });
const im = ax.imshow(Z, { cmap: 'RdBu_r', extent: [0, 800, 0, 600], origin: 'lower' });
fig.colorbar(im, { ax }); ax.set_title('imshow');
```

```js example contourf
const Z = Array.from({ length: 50 }, (_, j) => Array.from({ length: 70 }, (_, i) => Math.sin(i / 8) * Math.cos(j / 6) + j / 60));
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.4] });
const cs = ax.contourf(Z, 12, { cmap: 'terrain' });
ax.contour(Z, 12, { colors: 'k', linewidths: 0.5 });
fig.colorbar(cs, { ax }); ax.set_title('contourf + contour');
```

```js example pcolormesh
const xe = [0, 1, 2, 4, 7, 11, 16], ye = [0, 2, 3, 6, 10];
const C = ye.slice(1).map((_, j) => xe.slice(1).map((_, i) => i * j + i));
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
const m = ax.pcolormesh(xe, ye, C, { cmap: 'magma', edgecolors: 'w' });
fig.colorbar(m, { ax }); ax.set_title('pcolormesh');
```

```js example errorbar
const x = [1, 2, 3, 4, 5, 6], y = [2.1, 2.9, 3.4, 4.8, 5.1, 6.3], e = [0.3, 0.4, 0.2, 0.6, 0.4, 0.5];
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.fill_between(x, y.map((v, i) => v - 2 * e[i]), y.map((v, i) => v + 2 * e[i]), { alpha: 0.2, label: '±2σ' });
ax.errorbar(x, y, { yerr: e, fmt: 'o', capsize: 3, label: 'assays' });
ax.legend(); ax.set_title('errorbar, fill_between');
```

```js example marks
const x = [0, 1, 2, 3, 4, 5, 6, 7], y = [1, 3, 2, 5, 4, 6, 5, 7];
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.step(x, y, { where: 'mid', label: 'step' });
ax.axvspan(2.5, 4.5, { alpha: 0.15, color: 'C3' });
ax.axhline(4, { ls: ':', color: 'C7' });
ax.annotate('peak', [7, 7], { xytext: [4.6, 6.6], arrowprops: { arrowstyle: '->' } });
ax.set_title('step, spans, annotate');
```

```js example log
const t = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.plot(t, t.map((v) => 3 * v ** 0.6), 'o-', { label: 'γ(h)' });
ax.set_xscale('log'); ax.set_yscale('log');
const ax2 = ax.twinx();
ax2.plot(t, t.map((v) => 100 / (1 + v / 50)), 'C1--');
ax.set_xlabel('lag (m)'); ax.set_title('log axes, twinx');
```

```js example downhole
const d = Array.from({ length: 120 }, (_, i) => i), g = d.map((v) => 30 + 20 * Math.sin(v / 9) + 8 * Math.sin(v / 2.3));
const [fig, ax] = subplots(1, 1, { figsize: [3, 4.2] });
ax.axhspan(40, 70, { color: 'C1', alpha: 0.2 });
ax.plot(g, d);
ax.invert_yaxis(); ax.set_xlabel('Fe (%)'); ax.set_ylabel('depth (m)'); ax.set_title('downhole');
```

```js example plan
const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const lease = { type: 'Feature', properties: { name: 'EL 1234' }, geometry: { type: 'Polygon', coordinates: [ring(500000, 7000000, 503000, 7002200), ring(501200, 7000800, 501900, 7001400)] } };
const ex = [], ny = [];
for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) { ex.push(500300 + i * 400); ny.push(7000250 + j * 420); }
const [fig, ax] = subplots(1, 1, { figsize: [5, 4] });
ax.add_geometry(lease, { facecolor: 'C2', edgecolor: 'C2', alpha: 0.35, label: 'licence' });
ax.scatter(ex, ny, { marker: 's', s: 14, color: 'C3', label: 'collars' });
ax.set_aspect('equal'); ax.scalebar(); ax.north_arrow();
ax.set_xlabel('E'); ax.set_ylabel('N'); ax.legend({ loc: 'upper left' }); ax.set_title('plan view');
```

```js example chrome
// the frame around a picture another renderer draws (here: none, so the page shows through)
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.6] });
fig.set_facecolor('none'); ax.set_facecolor('none');
ax.set_aspect('equal');
ax.set_view({ xlim: [500000, 501000], ylim: [7000000, 7000700] });
ax.colorbar(new ScalarMappable({ cmap: 'magma', norm: new colors.Normalize(0, 3.5) }), { label: 'Cu (%)' });
ax.set_xlabel('E'); ax.set_ylabel('N'); ax.set_title('axes as chrome');
```

```js example shared
const x = Array.from({ length: 80 }, (_, i) => i / 8);
const [fig, axs] = subplots(2, 2, { figsize: [6, 4.2], sharex: true, sharey: true });
axs.flat.forEach((a, k) => { a.plot(x, x.map((v) => Math.sin(v * (k + 1) / 2)), `C${k}`); a.set_title(`f = ${(k + 1) / 2}`); });
fig.suptitle('subplots(sharex, sharey)');
```

```js example highlight
const x = [], y = [];
for (let i = 0; i < 2000; i++) { x.push(Math.cos(i * 2.39996) * Math.sqrt(i)); y.push(Math.sin(i * 2.39996) * Math.sqrt(i)); }
const [fig, ax] = subplots(1, 1, { figsize: [4, 3.6] });
ax.scatter(x, y, { c: x, s: 6, cmap: 'plasma' });
ax.highlight((i, px, py) => px * px + py * py < 300);
ax.set_aspect('equal'); ax.set_title('highlight');
```

```js example violin
const u = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;
const sets = [0, 1, 2].map((j) => Array.from({ length: 300 }, (_, i) => 20 + 6 * j + 8 * (u(i + 1e3 * j) + u(i + 7e3 + 1e3 * j) - 1)));
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
const parts = ax.violinplot(sets, { showmedians: true });
parts.bodies[2].set_facecolor('C3');
ax.set_xticks([1, 2, 3], ['oxide', 'transition', 'fresh']); ax.set_ylabel('Fe (%)'); ax.set_title('violinplot');
```

```js example hexbin
const u = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;
const x = [], y = [];
for (let i = 0; i < 20000; i++) { const a = u(i) + u(i + 3e4) + u(i + 6e4) - 1.5; x.push(a); y.push(0.6 * a + 0.4 * (u(i + 9e4) + u(i + 12e4) - 1)); }
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.6] });
const hb = ax.hexbin(x, y, { gridsize: 30, cmap: 'inferno', bins: 'log' });
fig.colorbar(hb, { ax, label: 'count' }); ax.set_title('hexbin');
```

```js example hist2d
const u = (k) => (((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1;
const x = Array.from({ length: 5000 }, (_, i) => u(i) + u(i + 1e4)), y = x.map((v, i) => v + u(i + 2e4) - 0.5);
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.4] });
const [h, xe, ye, im] = ax.hist2d(x, y, { bins: 24, cmap: 'viridis' });
fig.colorbar(im, { ax }); ax.set_title('hist2d');
```

```js example stackplot
const yr = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.stackplot(yr, [3, 4, 4.5, 5, 6, 6.2, 7], [1, 1.5, 2, 2.2, 2, 2.8, 3], [0.5, 0.6, 1, 1.4, 1.8, 2, 2.6], { labels: ['ore', 'low grade', 'waste'], alpha: 0.85 });
ax.legend({ loc: 'upper left' }); ax.set_ylabel('Mt'); ax.set_title('stackplot');
```

```js example dates
const day = 864e5, t0 = Date.UTC(2026, 0, 1);
const d = Array.from({ length: 200 }, (_, i) => new Date(t0 + i * day));
const [fig, ax] = subplots(1, 1, { figsize: [5, 3.2] });
ax.plot(d, d.map((_, i) => 0.6 + 0.25 * Math.sin(i / 18) + 0.05 * Math.sin(i * 1.3)));
ax.yaxis.set_major_formatter(new ticker.PercentFormatter(1));
ax.minorticks_on(); ax.grid(true, { which: 'both' });
ax.set_title('a date axis, percent ticks, minor grid');
```

## Differs from matplotlib

| | matplotlib | plot |
|---|---|---|
| date numbers | days since 1970 | milliseconds since 1970 (`Date.getTime()`), so bar widths on a date axis default to 0.8 × a day; ticks and labels in UTC, so every host draws the same |
| keyword arguments | `ax.plot(x, y, lw=2)` | JS: `ax.plot(x, y, { lw: 2 })` (adder: as matplotlib) |
| `imshow(data, nx, ny)` | — | plot's flat form, origin `'lower'`; `imshow(Z)` is matplotlib's |
| fonts | DejaVu Sans | the theme's monospace stack |
| contourf | antialiased off | bands overlap bottom-up, so no seams either way |
| `tight_layout()` | rearranges | layout is always measured; the call does nothing, by design |

## Unsupported

What plot knows of but doesn't do yet; each one warns when used, with what to do instead.

<!-- unsupported:begin -->
| | instead |
|---|---|
| `hexbin(…, {marginals})` | not supported yet; draw hist() on twin axes |
| `stackplot(…, {hatch})` | not supported yet |
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
