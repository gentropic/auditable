# @gcu/plot changelog

## 0.4.0 — interaction and export (M3, unreleased)

The third milestone of `plot-world-class`: interaction, plan views, axes drawn around another
renderer's picture, SVG export, and a gallery generated from the docs.

**Interaction (`@gcu/plot/interact`).** `interact(fig, [canvas], opts)`: hover readout,
crosshair and ring on an overlay canvas (a pointer move never redraws the figure), with units
and as many decimals as a pixel resolves; wheel zoom about the cursor (shift: x, alt: y), drag
pan, double-click reset — done in pixel space through the axes' own scales, so log and
inverted axes zoom and pan exactly and equal aspect holds; shift-drag brushes (`onBrush`), a
click clears and picks (`onClick`); `onViewChange`; keyboard (arrows, `+` `-`, `0`, `Esc`) with
focus and an aria-label; pinch on touch. `link(axes, {x, y})` ties views across figures.
`ax.highlight(indices | mask | predicate)` dims all but the chosen points (in the draw list
too).

**Plan views.** `ax.add_geometry(geojson)` (polygons with holes even-odd, lines, points; a pick
returns a feature's properties), `ax.fill`, matplotlib's `Polygon` / `Rectangle` / `Circle` and
`add_patch`, `ax.scalebar({units})`, `ax.north_arrow()`.

**Axes as chrome (§9a).** `set_facecolor('none')` on figure and axes, `ax.set_view({xlim,
ylim})` or condenser's view rect (under `interact()` it redraws and fires no `onViewChange`, so
two views follow each other without echo), `ScalarMappable` and `colorbar({cmap, vmin, vmax,
norm})` for a bar with nothing of plot's behind it.

**Export.** `fig.toSVG()` / `toSVG(drawList)` (also `@gcu/plot/svg`): paths, text in the
theme's font, nested clip paths, rasters as embedded PNG; deterministic. `savefig('x.svg')`.
`encodePNG(rgba, w, h)`, a plain-JS PNG encoder (fixed-Huffman deflate). An export paints the
theme's background under the dark theme's transparent figure surface; `'none'` stays clear.

**pyplot is matplotlib's (a breaking change, between M2 and M3).** `plt.plot`, `plt.scatter`,
`plt.bar`, `plt.hist` and `plt.imshow` draw on the current axes and return what the axes method
returns. Before, each made a new figure and returned its canvas, so `plt.plot(a); plt.plot(b);
plt.title('t')` gave two figures and lost the first line. `plt.matshow` still opens a figure
of its own, as matplotlib's does. `plt.subplot(211)` / `(212)` are two axes of one figure.
A Python cell is the inline backend: it starts with no current figure, and when it ends the
figures it opened and didn't show land in its output. `plt.show()` shows them where it is
called, so a loop of plot-and-show gives a chart per pass, and returns None.
`plt.flush_figures()` is the end-of-cell step, for a worker or Node host. A JS cell shows only
what it asks for: `plt.show()` returns the canvas (a `<div>` of canvases for several figures).
It also starts with no current figure, so re-running a cell draws a fresh figure instead of
adding lines to the last one. Python's end-of-cell print reads as matplotlib's (`<Axes: >`,
`<Figure size 640x480 with 1 Axes>`, `(array([…]), array([…]), <BarContainer object of 10
artists>)`). sadpan follows pandas: `df.plot()` / `series.plot()` draw on a new figure (or
`ax=`) and return the axes; `scatter_matrix` returns its grid of axes.

**Packaging.** The package's entry is the bundle (`"."` and `main` → `index.js`): since M2 the
source imports `@gcu/theme` from outside the package, so `src/api.js` could not be an entry
once published. The bundle exports every name `src/api.js` does (derived at build), and
`./axes` / `./figure` map to it; `./svg` and `./interact` are source entries with their own
types. Checked by packing, installing into a scratch project and importing every entry, in
Node and in a strict TypeScript consumer. `subplots()`'s types now follow the grid's shape
(an Axes, Axes[], or Axes[][] with `.flat`) instead of one union.

**Docs and tests.** API.md gains Plan views, Axes as chrome, Export, Interaction, and an
Examples section (one per chart type); `gallery.html` is generated from those examples and
draws each in dark and paper under `interact()`. `test/plot-m3.test.mjs` (Node: plan views,
chrome, the colorbar without data, PNG round trips through zlib, SVG determinism / escaping /
clipping / faces, savefig formats); `test/plot-interact-smoke.mjs` (Chromium, real input
events: 35 checks, the gallery included).

## 0.3.0 — the charts (M2, unreleased)

The second milestone of `plot-world-class`: the charts models reached for and hand-wrote
around, a layout measured from its labels, the theme shared with `@gcu/condenser`, and a
reference written for models ([API.md](API.md), also `llms.txt`; types in `index.d.ts`).

**Charts.** `boxplot` (matplotlib's own statistics — checked against `cbook.boxplot_stats`),
`contour` / `contourf` (marching triangles about each cell's centre: lines and bands from one
geometry, saddles by the centre average, bands drawn bottom-up so no seams), `pcolormesh`
(even meshes as one image, uneven and curvilinear ones by cell), `imshow(Z)` with matplotlib's
defaults, `errorbar`, `fill_between` / `fill_betweenx`, `step` and `drawstyle`, `axhspan` /
`axvspan`, `annotate`, `bar_label`, stacked bars (`bottom`), `align`, per-bar widths and
colours; `hist` with several datasets (side by side or stacked), `histtype`, `orientation`,
`bottom`, `log`, and numpy 2's bin rules (`'auto'`, `'fd'`, …) to numpy's counts.

**Colour.** `Normalize`, `LogNorm`, `TwoSlopeNorm`, `CenteredNorm`, `BoundaryNorm`,
`ListedColormap`, `LinearSegmentedColormap.from_list`; one norm per render, drawn by the
colorbar too. Colorbars follow their mappable, with ticks from the norm, `ticks`, `format`,
`extend` triangles and class bands. The ColorBrewer and matplotlib colour maps by name, `_r`
for any; an unknown name warns (it drew viridis silently).

**Axes.** Margins measured from the real tick labels, titles, twin axes, colorbar and an
outside legend; ticks sized to the axis's pixel length with the decimals the step needs.
Category axes from strings. `set_xticks(ticks, labels, {rotation})` and friends, `plt.xticks`.
Inverted and partial limits (`set_ylim(500, 0)`, `set_xlim(left=0)`), `invert_yaxis`,
`margins` with matplotlib's sticky edges (bars on 0, images tight), `axis(…)`,
`subplots(sharex, sharey)`, `zorder`. `legend(loc='best')` avoids the data;
`bbox_to_anchor` outside the axes; `ncols`, `title`, `frameon`, `legend(labels)`,
`legend(handles, labels)`. Text in axes coordinates, rotated, named sizes; text, annotations
and bar labels aren't clipped (matplotlib's `clip_on=False`).

**Themes.** `@gcu/theme`'s keys (shared with `@gcu/condenser`'s view): per-figure themes
(`subplots({theme})`, `fig.set_theme`, `themeFromCSS(el)`), `style.use` the default.
matplotlib's light styles are `paper` (white); the dark default is Switchboard basalt. The
cycle and the format-string letters (`'r--'`) are matplotlib's own now. Text is the theme's
monospace stack, measured at 0.6 em a character everywhere, so a figure lays out identically
live, recorded and replayed.

**Returns.** Chart calls return matplotlib's containers (`[line]`, a BarContainer, `[n, bins,
patches]`, the boxplot dict, a ContourSet, mappables) with `.axes`; every other name reads the
axes, so chaining still works.

**Tests.** `test/plot-charts.test.mjs` (31): the layout, ticks, categories, limits, sharing,
themes, every mark, numpy's bin counts, matplotlib's boxplot statistics, contours on analytic
fields, the norms and colorbars, an edge-case matrix (13 chart kinds × empty / one / constant /
NaN / ±Inf / negative-on-log / 1e9 / 1e-9 / typed arrays) and golden draw lists per chart type.

## 0.2.0 — the engine (2026-11-20)

The first milestone of `plot-world-class` (a spec from the MineMind seat, whose model-written
chart tests put plot ahead of Plotly, Observable Plot, ECharts and Vega-Lite): make the engine
fast, and stop it ignoring things quietly. Numbers in [`bench/BENCH.md`](bench/BENCH.md).

**Fast.** Columnar ingest — a typed array is used as is, never copied; ranges, histograms,
colour indices, image buffers and positions are cached per trace. Big scatters rasterize
(antialiased stamps at quarter-pixel positions, composited in data order: the same picture as a
fill per marker, in one blit or one draw-list op). Long lines decimate (M4 per quarter device
pixel). Images build one RGBA buffer through a colour-map LUT. A 1M-point colour-mapped scatter
went from minutes (0.1.1 timed out) to ~100 ms; a 2,000² image from ~6 s to ~60 ms; a redraw of
the same view to about a millisecond.

**Fixed (0.1.1's defects D1–D13).**
- D1/D13 typed-array `c` and `s` were silently dropped, so was the colorbar that follows them.
- D2 `Math.min(...arr)` overflowed the call stack at ~100k values (colorbar, scatter, hist).
- D3 typed arrays were copied into JS arrays.
- D4 `scatter` ignored `marker`; all of `o . s ^ v < > d D p h * + x` now draw.
- D5 live `imshow` was one `fillRect` per cell.
- D6 a colour map at NaN returned `rgb(NaN,…)`; NaN is transparent now.
- D7 hist was O(n × bins), computed several times per render; now one pass, cached, and equal to
  `numpy.histogram` (tested against numpy's output).
- D8 `twiny()` was `twinx()`; it now shares y with its own x along the top.
- D9 legend, `text` and `axhline` defaults ignored the light palette.
- D10 the palette was module-global; each figure now keeps the one in force when it was made.
- D11 `plot(y)` with one argument drew nothing.
- D12 the registered extension version lagged the package; one `VERSION` now.

**New.**
- `ax.view`, `ax.toPixel`, `ax.toData`, `fig.axesAt`, and `ax.pick(px, py, {radius})`
  (markers, line vertices, bars by column, histogram bins, image cells; twins included).
- Nothing is silently ignored: unknown options warn once with a did-you-mean, known-but-not-yet
  options say what to use instead, the old silent no-ops (`xticks`, `yticks`, `rc`,
  `subplots_adjust`, `set_zorder`) warn. `rcParams['gcu.strict']` or `{strict: true}` makes
  them throw. Errors name the argument: `scatter: c has 3 values but x has 2`.
- Non-finite values: extents skip NaN/±Inf, lines break at NaN, NaN colours draw nothing, a log
  axis ignores values ≤ 0.
- Format strings in any order (`'o-'`, `'ro'`, `'--r'`, `'C2'`); a marker with no line style
  draws markers only (`plot(x, y, 'o')`), as matplotlib.
- `scatter(x, y, s, c)` positional; per-point colour lists; matplotlib's colour names, `'C0'`–`'C9'`
  and `'tab:…'` (a bare `'r'` used to reach the canvas as an invalid colour); RGB tuples.
- `hist`: `weights`, `density`, `cumulative`. `imshow`: `extent`, `alpha`, `interpolation`
  (`'nearest'` / `'bilinear'`). `bar`: per-bar `color` and `width` arrays. `grid(axis=…)`,
  legend `loc` codes, `get_xlim` / `get_ylim`.
- `subplots(..., { theme })` overrides palette keys for one figure.

**Changed.**
- Marker sizes are matplotlib's now: `s` is the area in points² (default 36), `markersize` the
  diameter in points (default 6), marker edge widths in points, at the figure's dpi. 0.1.1 read
  `s` as a radius of √s px (default 20), so markers were ~1.4× matplotlib's; small explicit
  `s` values now draw smaller, as they would in matplotlib.
- Trace columns are typed arrays now (internal; `_traces[i].x` was a JS array).
- `bar` includes the bar width in the x extent (0.1.1 clipped the outer bars in half).
- Draw lists of big scatters carry one `image` op instead of one `arc` per point.
