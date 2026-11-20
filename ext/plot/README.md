# @gcu/plot

Matplotlib-style plotting for the browser. Canvas 2D, zero runtime dependencies, no WebGL, no WASM, no workers, no network: it runs under a `connect-src 'none'` page, in a worker, and in Node (as draw lists). If you know matplotlib, you know the API: `subplots`, `plot`, `scatter`, `imshow`, `hist`, `bar`, …

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

## Histograms

`hist(x, { bins, range, weights, density, cumulative })` counts exactly as `numpy.histogram` does (checked against numpy's own output: values on edges, non-representable edges, the inclusive last edge). `plt.hist` returns `[counts, edges, canvas]`, matplotlib's order.

## Themes

`plt.style.use('default')` (light, matplotlib's look) or `'dark_background'` (the default here); an unknown name warns. A figure keeps the palette in force when it was made — matplotlib's rule — so two figures on one page can differ, and a later `style.use` doesn't repaint them. `subplots(..., { theme: { bgcolor, textColor, … } })` overrides keys for one figure.

## Without a DOM: figures as data

With no `document`, `show()` records the figure and returns it; `savefig(name)` records `{ name, figure }` for `plt.saved()`.

`fig.toDrawList()` is the figure as plain JSON: `{ width, height, facecolor, ops }`, the ordered 2D-context calls as `[op, ...args]`, property assignments as `['set', name, value]`, a raster as one `['image', x, y, w, h, cols, rows, rgbaBase64]`. The same figure gives the same list in every host. `replay(ctx, list)` draws it; `fig.draw(ctx, { dpr })` draws straight onto any 2D context; `fig.toPNG()` gives PNG bytes where `OffscreenCanvas` exists.

```js
import { pltAdder, replay } from '@gcu/plot';
registerModule('plt', pltAdder);                 // adder, in a worker or Node
await run('import plt\nplt.plot([1, 2, 3])\nplt.show()');
replay(ctx, pltAdder.shown()[0].toDrawList());   // on the page
```

## Where it differs from matplotlib

Marker sizes are matplotlib's: `scatter`'s `s` is the area in points² (default 36), `markersize` the diameter in points (default 6), marker edge widths in points, all at the figure's `dpi`. Line widths and font sizes are still pixels. Otherwise:

- The single-letter colours in a format string (`'r--'`) are plot's softer palette; colour *names* (`color='r'`, `'tab:blue'`, `'C3'`) are matplotlib's.
- `axhline` / `axvline` default to a neutral grey, not the colour cycle.
- `imshow(data, nx, ny)` takes the grid flat with its size, origin `'lower'`; for a 2D array use `matshow(Z)` (origin `'upper'`).
- Not yet: categorical axes, `boxplot`, `contour`, custom ticks, `sharex`/`sharey`, legend outside the axes. Each warns when asked for.

## Figure layout extras

- `gap` / `wspace` / `hspace` (px, default 10) on `subplots(..., { gap })` — inter-subplot spacing.
- `fig._rowLabels` / `fig._colLabels` render in gutters outside the subplot grid (sadpan's `scatter_matrix`).
- `ax._margins = { left, right, top, bottom }` pins the plot rect, so a grid of cells lines up.

## License

MIT.
