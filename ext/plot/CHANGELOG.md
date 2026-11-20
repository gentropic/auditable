# @gcu/plot changelog

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
- Trace columns are typed arrays now (internal; `_traces[i].x` was a JS array).
- `bar` includes the bar width in the x extent (0.1.1 clipped the outer bars in half).
- Draw lists of big scatters carry one `image` op instead of one `arc` per point.
