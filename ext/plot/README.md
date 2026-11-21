# @gcu/plot

Matplotlib-style plotting for the browser. Canvas 2D, zero runtime dependencies, no WebGL, no WASM, no workers, no network: it runs under a `connect-src 'none'` page, in a worker, and in Node (as draw lists). If you know matplotlib, you know the API: `plot`, `scatter`, `bar`, `hist`, `boxplot`, `imshow`, `contour`/`contourf`, `pcolormesh`, `errorbar`, `fill_between`, norms and colorbars, category axes, shared axes, legends that stay out of the data — plus plan views (GeoJSON, scale bar, north arrow), axes drawn around another renderer's picture, SVG export, and opt-in interaction (hover, zoom, pan, brush, linked views).

**The full reference is [API.md](API.md)** (also `llms.txt`, written for models): every call, its options and defaults, what it returns, how plot differs from matplotlib, and what it doesn't do yet. Types: `index.d.ts`.

Part of [Auditable](https://github.com/gentropic/auditable). Pre-1.0 — APIs may break on minor version bumps.

## Install

```sh
npm install @gcu/plot
```

## Usage

```js
import { subplots } from '@gcu/plot';

const { fig, ax } = subplots(1, 1, { figsize: [6, 4] });   // inches × dpi 100, as matplotlib
ax.scatter(x, y, { c: grade, cmap: 'viridis', s: 4 });     // typed arrays welcome, never copied
ax.set_xlabel('easting'); ax.set_ylabel('northing');
ax.colorbar({ label: 'Fe %' });
document.body.append(fig.show());                          // show() returns the <canvas>
```

Keyword arguments are a trailing options object with matplotlib's names and short aliases (`linewidth`/`lw`, `color`/`c`, `linestyle`/`ls`, `markersize`/`ms`, …). The `plt` module object (`pltAdder`) has the stateful interface too: `plt.plot(y)`, `plt.xlabel(...)`, `plt.colorbar()`, `plt.savefig(...)`.

`subplots(R, C)` with both greater than 1 returns a nested 2D axes array (matplotlib's shape) with a non-enumerable `.flat` (row-major), so `axes.flat[k]` works.

## Fast

Figures of a few million elements draw in about a tenth of a second on Canvas 2D:

| case | first draw | same view again |
|---|---|---|
| scatter, 1M points, colour-mapped | ~100 ms | < 1 ms |
| line, 1M vertices | ~30 ms | ~8 ms |
| hist, 10M values, 100 bins | ~70 ms | ~1 ms |
| imshow, 2,000 × 2,000 | ~60 ms | ~1 ms |
| pick (hover), 1M points | index ~15 ms | ~0.03 ms |

Measured in headless Chromium; the method and every number, with 0.1.1 beside them, are in [`bench/BENCH.md`](bench/BENCH.md) (`node ext/plot/bench/run.mjs`). How:

- **Columns are taken as they come.** A typed array is used in place, never copied; a plain array becomes one `Float64Array`. Ranges, histogram counts, colour indices, image buffers and pixel positions are computed once per trace and cached until the view changes.
- **Big scatters rasterize.** Past a few thousand points each marker is an antialiased stamp (worked out arithmetically — the same bytes in every host), composited in data order into one image: one blit live, one `image` op in a draw list. Alpha and overlaps come out as one canvas fill per marker would make them; positions land within ⅛ px.
- **Long lines decimate** (M4: first, min, max and last vertex per quarter device pixel) when x rises; the stroke matches drawing every vertex.
- **Images are one buffer**, built through a 256-entry colour-map table, blitted once.

**The ceiling.** This is for figures up to a few million elements. Past that, aggregate (`hist`, binning to the view and sending a raster) or use a GPU renderer — [`@gcu/condenser`](../condenser) has orthographic views, sections, level of detail and picking for tens of millions.

## Picking and the view

After a figure is drawn, each axes knows where it went:

```js
ax.view                      // { x, y, w, h, xScale, yScale } in CSS px of the figure
ax.toPixel(x, y); ax.toData(px, py)
fig.axesAt(px, py)           // which axes holds that pixel
ax.pick(px, py, { radius: 8 })
// → { axes, trace, traceIndex, kind, index, x, y, c, s, label, value? } or null
```

`pick` finds the nearest marker, then line vertex, then bar (by column) or histogram bin, then image cell (`col`, `row`, `value`), searching twins too. The first pick after a draw builds a pixel-space index; picks then take microseconds.

## Nothing is silently ignored

An option plot doesn't know warns once (per function and key) with the name you probably meant — `plot() has no option 'colour', did you mean 'color'?`. An option it knows but can't do yet says so and what to use instead. Calls that do nothing yet (`xticks`, `subplots_adjust`, …) warn rather than pass quietly; `tight_layout()` stays silent because layout is always tight. With `plt.rcParams['gcu.strict'] = true` (or `subplots(..., { strict: true })`) every warning throws.

Mismatched inputs are errors that say what came: `scatter: c has 1,000 values but x has 999`.

## Non-finite values

NaN and ±Inf never throw and never reach an axis range. A line breaks at NaN (matplotlib's rule); a NaN colour value draws nothing; NaN image cells are transparent; histograms leave NaN out; a log axis ignores values ≤ 0.

## Charts

- **Lines and points**: `plot` (format strings in any order, `drawstyle`), `step`, `scatter` (sizes in points², colour-mapped or per-point colours, matplotlib's markers), `errorbar`, `fill_between`.
- **Bars and distributions**: `bar` / `barh` (stacked with `bottom`, `bar_label`), `hist` (several datasets side by side or stacked, `histtype`, numpy's bin rules), `boxplot` (matplotlib's own statistics, checked against `cbook.boxplot_stats`).
- **Fields**: `imshow` (2D arrays, origin, extent, NaN transparent), `pcolormesh` (uneven or curvilinear meshes), `contour` / `contourf` (marching triangles: lines and bands from one geometry, no seams).
- **Colour**: `Normalize`, `LogNorm`, `TwoSlopeNorm`, `CenteredNorm`, `BoundaryNorm`, `ListedColormap`; the ColorBrewer and matplotlib colour maps; colorbars that follow their mappable, with ticks, `format`, `extend` and class bands.
- **Axes**: category axes from strings, `set_xticks(ticks, labels, {rotation})`, inverted and partial limits, `margins` with matplotlib's sticky edges, `axis(…)`, `sharex` / `sharey`, `twinx` / `twiny`, `legend(loc='best')` that avoids the data and `bbox_to_anchor` outside the axes, `annotate`, spans.

The layout is measured from the real labels, ticks are sized to the axis so labels never collide, and nothing a chart call doesn't understand passes silently.

## Histograms

`hist(x, { bins, range, weights, density, cumulative })` counts exactly as `numpy.histogram` does (checked against numpy's own output: values on edges, non-representable edges, the inclusive last edge), and `bins='auto' | 'fd' | 'sturges' | 'sqrt' | 'rice' | 'scott'` give numpy 2's bin counts. `ax.hist` and `plt.hist` return `[n, bins, patches]`.

## Plan views

Maps in projected or local coordinates, with no basemap: `ax.add_geometry(geojson)` takes a GeoJSON Geometry, Feature or FeatureCollection (polygons with holes, lines, points — `@gcu/wkt` output drops in), and a pick inside a polygon returns its feature's properties. matplotlib's `fill` and `Polygon` / `Rectangle` / `Circle` patches work too. `ax.scalebar({units: 'm'})` and `ax.north_arrow()` add the map furniture; `imshow(Z, {extent})` puts a georeferenced grid in place; `set_aspect('equal')` holds through zoom and pan.

## Axes around someone else's picture

plot can draw only the frame, ticks, labels, legend and colorbar around a picture another renderer makes — a `@gcu/condenser` plan or section, a map, a stereonet: `fig.set_facecolor('none')`, `ax.set_facecolor('none')`, `ax.set_view({xlim, ylim})` (or condenser's view rect) from the other camera, and a colorbar with nothing behind it (`ScalarMappable`, or `colorbar({cmap, vmin, vmax})`). `ax.view` says where to put the other canvas. Under `interact()` the sync goes both ways without echoing.

## Interaction

```js
import { interact } from '@gcu/plot';      // or '@gcu/plot/interact'
const ui = interact(fig, { units: 'm', onBrush: ({ x, y }) => filter(x, y) });
document.body.append(ui.element);
```

Hover shows a readout, crosshair and ring on an overlay canvas (the figure isn't redrawn); the wheel zooms about the cursor, drag pans, double-click resets — exactly, on log and inverted axes too; shift-drag brushes; the keyboard pans, zooms and resets; two fingers pinch. `link([ax1, ax2])` ties views across figures, and `ax.highlight(predicate)` dims all but the chosen points.

## Export

`fig.toSVG()` (or `toSVG(drawList)` from `@gcu/plot/svg`, for a list made in a worker) writes the figure as SVG from its draw list: paths, text in the theme's font, clip paths, and rasters as embedded PNG (a million-point scatter stays one image — honest and small). `savefig('map.svg')` / `savefig('map.png')`. The same figure gives the same SVG, byte for byte.

## Gallery

[`gallery.html`](gallery.html) draws every example in API.md, in the dark theme and in paper, each under `interact()`. It is generated from API.md by the build, so the two can't drift; open it from a local server.

## Themes

A theme is [`@gcu/theme`](../theme)'s keys, shared with `@gcu/condenser`'s 3D view, so one theme dresses a chart and the view beside it. `plt.style.use('default')` (white, matplotlib's look) or `'dark_background'` (the default here), or a theme by name: `'dark'` · `'light'` · `'paper'`; an unknown name warns. A figure keeps the theme in force when it was made — matplotlib's rule. `subplots(..., { theme })`, `fig.set_theme(...)` and `themeFromCSS(el)` (a page's design tokens) dress one figure. The colour cycle is matplotlib's tab10.

## Without a DOM: figures as data

With no `document`, `show()` records the figure and returns it; `savefig(name)` records `{ name, format, figure }` for `plt.saved()`; a host running Python calls `plt.flush_figures()` after each run, as Jupyter's inline backend does.

`fig.toDrawList()` is the figure as plain JSON: `{ width, height, facecolor, ops }`, the ordered 2D-context calls as `[op, ...args]`, property assignments as `['set', name, value]`, a raster as one `['image', x, y, w, h, cols, rows, rgbaBase64]`. The same figure gives the same list in every host. `replay(ctx, list)` draws it; `fig.draw(ctx, { dpr })` draws straight onto any 2D context; `fig.toPNG()` gives PNG bytes where `OffscreenCanvas` exists.

```js
import { pltAdder, replay } from '@gcu/plot';
registerModule('plt', pltAdder);                 // adder, in a worker or Node
await run('import plt\nplt.plot([1, 2, 3])\nplt.show()');
replay(ctx, pltAdder.shown()[0].toDrawList());   // on the page
```

## Where it differs from matplotlib

Marker sizes are matplotlib's: `scatter`'s `s` is the area in points² (default 36), `markersize` the diameter in points (default 6), marker edge widths in points, all at the figure's `dpi`. Line widths and font sizes are still pixels. Text is the theme's monospace stack. The rest is in [API.md](API.md#differs-from-matplotlib); the main ones:

- pyplot is matplotlib's: `plt.plot` and friends draw on the current axes, and a Python cell shows its figures when it ends, like Jupyter's inline backend. A JS cell shows only what it asks for (`display(plt.show())`). See [API.md](API.md#pyplot-plt).
- `imshow(data, nx, ny)` is plot's flat form (origin `'lower'`); `imshow(Z)` with a 2D array is matplotlib's.

## Figure layout extras

- `gap` / `wspace` / `hspace` (px, default 10) on `subplots(..., { gap })` — inter-subplot spacing.
- `fig._rowLabels` / `fig._colLabels` render in gutters outside the subplot grid (sadpan's `scatter_matrix`).
- `ax._margins = { left, right, top, bottom }` pins the plot rect, so a grid of cells lines up.

## License

MIT.
