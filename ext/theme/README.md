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
| `background` | the figure's or scene's background |
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

The categorical `cycle` is Tableau 10 in all three.

## From CSS

`themeFromCSS(el, map?)` reads CSS custom properties on `el`. By default it reads
Switchboard's semantic tokens (`--au-surface`, `--au-fg`, `--au-action`, …; see
`CSS_MAP`); pass your own `{ key: '--your-token' }` map for other design systems. Unset
properties keep the base theme's value, and the base is light or dark by the background
it finds. Call it again when the page switches mode.
