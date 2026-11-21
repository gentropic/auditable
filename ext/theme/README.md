# @gcu/theme

One theme vocabulary for GCU figures. `@gcu/condenser`'s 3D view and `@gcu/plot` read
the same keys, so one theme dresses a chart and the 3D view beside it. Zero dependencies.

```js
import { resolveTheme, themeFromCSS, THEMES } from '@gcu/theme';

resolveTheme('light');                         // a full theme
resolveTheme({ base: 'paper', accent: '#c00' }); // a partial one, filled from its base
themeFromCSS(document.documentElement);        // the host page's design tokens
```

## Keys

| key | |
|---|---|
| `background` | the plot area's, or the 3D scene's, background |
| `figure` | the surface around a chart's plot areas (charts only; the dark theme's is transparent) |
| `foreground` | primary text and marks |
| `muted` | secondary text: tick labels, captions, units |
| `grid` | grid lines |
| `frame` | axis lines, outlines, legend swatch borders |
| `panel` · `panel_border` | the fill and border of floating chrome (legends, readouts, toolbars) |
| `accent` | the action colour: a pressed button, a cut line, a highlight |
| `selection` | what is selected |
| `halo` | the outline that keeps text readable over a busy scene |
| `cycle` | the categorical colours, in order |
| `ramp` | the default colour map's name |
| `font` · `mono` · `font_size` | the sans and monospace stacks, the base size (CSS px) |

## Themes

- `dark`: Switchboard's basalt (the default);
- `light`: Switchboard's equipment gray;
- `paper`: white, for printed figures.

The categorical `cycle` is matplotlib's default (tab10, its C0–C9) in all three.

## From CSS

`themeFromCSS(el, map?)` reads CSS custom properties on `el`: for each theme key, the first
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
