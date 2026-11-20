# @gcu/condenser/view — API

The 3D viewer for block models, drillholes, point clouds and surfaces in any browser page.
It is the twin of the Python `gcu.condenser` Jupyter widget: the same viewer, the same
functions, the same option names (snake_case included), the same defaults. If you know one,
you know the other.

No network, no WASM, no eval, no workers required, no CSS files, nothing fetched at runtime.
One ES module: `ext/condenser/view/index.js`.

```js
import { view, blocks, points, drillholes, mesh, surface } from '@gcu/condenser/view';

const v = view(document.getElementById('map'), [
  blocks({ x: X, y: Y, z: Z, value: FE }, { name: 'model', threshold: [28, 99], ramp: 'viridis' }),
  drillholes(collar, survey, assay, { value: 'AU', labels: true }),
  points({ x: tx, y: ty, z: tz }, { name: 'topo', sectioned: false }),
], { section: { axis: 'z', position: 485, thickness: 10 }, height: 520 });

v.on('pick', (p) => console.log(p.name, p.index, p.value));
v.layer('model').set({ threshold: [30, 99] });
v.cut('z', 470, 10);
v.look('plan', { ortho: true });
```

## Python → JS

| Python | JS |
|---|---|
| `cd.blocks(df, x="XC", y="YC", z="ZC", value="FE", name="m")` | `blocks(df, { x: 'XC', y: 'YC', z: 'ZC', value: 'FE', name: 'm' })` |
| `cd.points(x, y, z, value=g)` | `points({ x, y, z, value: g })` |
| `cd.drillholes(collar, survey, assay, value="AU")` | `drillholes(collar, survey, assay, { value: 'AU' })` |
| `cd.mesh(verts, tris, opacity=0.5)` | `mesh(verts, tris, { opacity: 0.5 })` |
| `cd.surface(dem, origin=(x0, y0), pitch=12.5, drape=g)` | `surface(dem, { origin: [x0, y0], pitch: 12.5, drape: g })` |
| `w = cd.view(a, b, section={...}, height=520)` | `const v = view(el, [a, b], { section: {...}, height: 520 })` |
| `w["model"].threshold = [30, 99]` | `v.layer('model').set({ threshold: [30, 99] })` |
| `w.cut("z", 470, thickness=10)` · `w.cut()` | `v.cut('z', 470, 10)` · `v.cut()` |
| `w.look("plan", ortho=True)` · `w.look(azimuth=135, plunge=30)` | `v.look('plan', { ortho: true })` · `v.look({ azimuth: 135, plunge: 30 })` |
| `w.fit()` · `w.clear_selection()` | `v.fit()` · `v.clear_selection()` |
| `w.snapshot()` then `w.snapshot_png` (next cell) | `await v.snapshot()` → a PNG `Blob` |
| `w.selection` · `w.selected_rows` · `w.measurement` · `w.camera` | `v.selection` · `v.selected_rows` · `v.measurement` · `v.camera` |
| `w.add(layer)` · `w.remove("name")` | `v.add(layer)` · `v.remove('name')` |
| `w.z_exaggeration = 3` | `v.set({ z_exaggeration: 3 })` |
| (no Python equivalent) | `v.on(event, fn)` · `v.off` · `v.state()` · `v.set(state)` · `v.destroy()` · `blocks.stream` / `points.stream` + `append` |

## Columns

Every constructor's first argument is a table or a columns object. A column is a typed
array (used in place, never copied when it is already the wire type), a plain array, or a
column NAME looked up in the table — `t[name]`, `t.get(name)` or `t.getChild(name)` (an
Arrow table). With a columns object you don't have to name anything: `x`, `y`, `z`,
`value`, `category` are picked up by name.

`value` may be one column, or several — a list of names or `{ name: array }` — and the
active one switches with `layer.set({ value: 'SIO2' })`, no re-send. `category` is any
column of labels (≤ 256 distinct; more fold into `(other)`).

## Layers

```js
blocks(src, { x, y, z, value, category, size: [dx, dy, dz], ...style })
```
Real boxes on the lattice inferred from the centroids. A sub-blocked model passes `size`
(column names, arrays or numbers); each block draws at its own size.

```js
points(src, { x, y, z, value, category, rgb, ...style })
```
A point cloud. `rgb`: n × 3 bytes, flat or one `[r, g, b]` per point.

```js
drillholes(collar, survey, intervals, { bhid: 'BHID', x: 'X', y: 'Y', z: 'Z', eoh, depth: 'DEPTH',
  az: 'AZ', dip: 'DIP', from: 'FROM', to: 'TO', value, category, method: 'minimumCurvature', dip_convention: 'auto', ...style })
```
Desurveyed in the browser (@gcu/drillhole, the same code micro uses). A pick returns the
INTERVAL row.

```js
mesh(vertices, triangles, { color: '#9aa4ab', opacity, ...style })
```
Scenery: drawn whole, sectioned as a trace, no records. Vertices and triangles flat or as
triples.

```js
surface(grid, { origin: [x0, y0], pitch, drape, nodata, flat_z, stride, nx, ny, ...style })
```
A 2D grid as shaded relief, row 0 the NORTHERNMOST. `grid` as rows, or flat with `nx`, `ny`.
`drape` colours it by a second grid of the same shape.

## Style (per layer, all live)

| option | default | |
|---|---|---|
| `name` | `kind-N` | |
| `visible` | `true` | |
| `color` | `'value'` if a value, else `'category'` if one, else `'z'` | `'z'` · `'value'` · `'category'` · `'rgb'` · `'flat'` · a hex tint (mesh, surface) |
| `value` | the first channel | the active value channel |
| `ramp` | `'viridis'` | `viridis` · `magma` · `turbo` · `greys` · `spectral` · `fire` |
| `clip` | `[]` | `[lo, hi]` for the colour scale |
| `threshold` | `[]` | `[lo, hi]` cutoff on the value: how you see inside a solid model |
| `filter_mode` | `'isolate'` | `'dim'` greys what is outside the threshold |
| `opacity` | `1` | screen-door see-through |
| `point_size` | `2.5` | |
| `as_points` | `false` | draw a block model as points |
| `block_edges` | `false` | |
| `radius` | `1.5` | drillhole capsule radius, world units |
| `labels` | `false` | drillholes: the BHID at each collar |
| `categories_hidden` | `[]` | category labels to hide |
| `sectioned` | `true` | `false` keeps the layer whole under a section; `'front'` · `'behind'` |

## View options

`section` (`{axis, position, thickness}` or `{normal: [x, y, z], position, thickness}`;
`null` = off) · `height` (460) · `background` (`'#121212'`) · `toolbar` (true) · `edl` (true) ·
`edl_strength` (1) · `z_exaggeration` (1) · `decorations` (true: north arrow + scale bar) ·
`camera` (`{azimuth, plunge, distance, target, ortho}`) · `hover` (false) · `select_through`
(false) · `budget` (3,000,000 elements per frame) · `workers` (true; JS only — `false` when
the page's CSP allows no workers).

An option nobody reads warns once with the nearest real name:
`condenser: points() has no option 'colour', did you mean 'color'?`.

## Events

`v.on(name, fn)` / `v.off(name, fn)`:

| event | data |
|---|---|
| `pick` | a click: `{ layer, name, index, x, y, z, value, channel, category }` (+ `hole`, `from`, `to` for drillholes), or `null` |
| `hover` | the same as `pick`, under the cursor, when `hover: true` |
| `select` | a rectangle / lasso selection: `[{ layer, name, rows: Uint32Array }]` — row indices into the table you passed |
| `measure` | `{ from, to, distance, dx, dy, dz, bearing, plunge }` |
| `section` | the section, whenever it changes (code, scrub bar or knife) |
| `camera` | the camera, when it is set |
| `style` | every layer's style, after a toolbar edit or `layer().set()` |

## State

`v.state()` is JSON: the view options and every layer's style. `v.set(state)` puts them
back — on the same view or a new one over the same data.

## Streams

The view draws rows as they arrive, but it needs the shape before the first row. Declare
it:

```js
const m = blocks.stream({ axes: [[x0, dx, nx], [y0, dy, ny], [z0, dz, nz]], capacity: 2_000_000,
                          value_range: [0, 70], categories: ['ox', 'fr'] }, { name: 'model' });
const p = points.stream({ bbox: [xmin, ymin, zmin, xmax, ymax, zmax], capacity: 5_000_000, value_range: [0, 1] });
const v = view(el, [m, p]);
m.append({ x, y, z, value, category });   // any number of times — drawn as they land
m.end();
```

`append` refuses a block off the declared lattice, a category not declared, and rows past
the capacity, each with a message saying which. A stream survives `add` / `remove`: the
view reloads and every appended row is replayed.

## Not yet

The orientation lock, the `view` event with the view rectangle, the chrome plugin
contract, themes, per-layer legends in snapshots and the keyboard arrive in the next
steps of `condenser-view-api`.
