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
], { lock: 'plan', section: { axis: 'z', position: 485, thickness: 10 }, height: 520 });

v.on('pick', (p) => console.log(p.name, p.index, p.value));
v.on('view', (r) => console.log(r.axes, r.rect));     // the world rectangle on screen
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
| `w.look("iso")` · `w.look("3/4-nw")` | `v.look('iso')` · `v.look('3/4-nw')` |
| `w.fit()` · `w.clear_selection()` | `v.fit()` · `v.clear_selection()` |
| `w.snapshot()` then `w.snapshot_png` (next cell) | `await v.snapshot()` → a PNG `Blob` |
| `w.selection` · `w.selected_rows` · `w.measurement` · `w.camera` | `v.selection` · `v.selected_rows` · `v.measurement` · `v.camera` |
| `w.add(layer)` · `w.remove("name")` | `v.add(layer)` · `v.remove('name')` |
| `w.z_exaggeration = 3` | `v.set({ z_exaggeration: 3 })` |
| `w.lock = 'plan'` · `w.lock = {'azimuth': 30, 'plunge': 0}` | `v.set({ lock: 'plan' })` · `v.set({ lock: { azimuth: 30, plunge: 0 } })` |
| (no Python equivalent) | `v.on(event, fn)` · `v.off` · `v.state()` · `v.set(state)` · `v.set({ view: { rect } })` · `v.destroy()` · `blocks.stream` / `points.stream` + `append` |

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
`camera` (`{azimuth, plunge, distance, target, ortho}`) · `lock` (`'free'`) · `lock_toggle` (true) ·
`twist` (false) — see *Orientation lock* · `hover` (false) · `select_through`
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
| `lock` | the lock, whenever it changes (code, the lock button, `L`): `'free'`, a name, or `{ azimuth, plunge }` |
| `view` | after every camera change, at most once a frame — see *The view event* |

## Views by name

`look(name)` names where you LOOK: `'north'` looks north, `'iso-ne'` looks north-east (CAD
calls that "SW Isometric", after where the viewer stands).

| name | | |
|---|---|---|
| `'plan'` · `'north'` · `'south'` · `'east'` · `'west'` | straight down (north up), or horizontal | keeps the projection |
| `'iso'` = `'iso-ne'` · `'iso-nw'` · `'iso-se'` · `'iso-sw'` | true isometric: 35.264° down, orthographic — E, N and up foreshorten alike (until `z_exaggeration` isn't 1) | lockable |
| `'three-quarter'` = `'three-quarter-ne'` (or `'3/4'`, `'3/4-ne'` …) · `-nw` · `-se` · `-sw` | 30° down, perspective: the figure view, and the opening shot; `look()` alone gives it | not lockable |

## Orientation lock

A locked view is orthographic, a drag PANS, the wheel and a pinch zoom, and nothing turns it.

| `lock` | |
|---|---|
| `'free'` | orbit as usual (the default) |
| `'plan'` | straight down, north up |
| `'section'` | along the section's normal, never looking up (a z section is plan, a y section looks north); it follows the section when it is scrubbed, cut or knifed to a new plane. With no section, plan |
| `'north'` · `'south'` · `'east'` · `'west'` | horizontal, looking that way |
| `'iso'` = `'iso-ne'` · `'iso-nw'` · `'iso-se'` · `'iso-sw'` | true isometric (35.264° down), looking that way |
| `{ azimuth, plunge }` | any fixed direction, in degrees (azimuth of the VIEW from north, plunge down) |

- `lock_toggle: true` (default): the toolbar shows a lock button and the `L` key (on the focused view) frees the view and locks it back to the same orientation; on a free view, `L` locks where you are looking. `false`: no unlock control — the button, the views menu and the projection toggle are hidden, and the view stays what the code locked it to.
- `twist: true`: a locked PLAN view may still turn about the vertical (ctrl-drag, pinch twist) — map rotation. The north arrow follows. Default `false`.
- While locked, the lock owns the direction: `look('north')` moves the lock to north, `look('three-quarter')` (perspective, so not lockable) frees it, and `look({ azimuth, plunge })` locks that direction.
- `state()` carries the lock.

## The view event

`v.on('view', fn)` fires after every camera change (coalesced to one per frame, and only when something changed):

```js
{ camera: { azimuth, plunge, distance, target, ortho, z_exaggeration }, lock,
  // in a locked view only:
  rect: { u0, u1, v0, v1 }, axes: ['E', 'N'], basis: { u: [1, 0, 0], v: [0, 1, 0] },
  px: { x, y, w, h } }
```

`rect` is the world extent the canvas shows: `u0` at its LEFT edge, `u1` at the right, `v0` at
the bottom, `v1` at the top. `px` is the pixel box it covers, relative to the element you passed
to `view()`. The axes are named for the world coordinate they measure:

| view | `axes` |
|---|---|
| plan, north up | `['E', 'N']` |
| looking north or south | `['E', 'RL']` — looking south E runs right to left, so `u0 > u1` |
| looking east or west | `['N', 'RL']` |
| any other horizontal look | `['along', 'RL']` — along = p·`basis.u` |
| a twisted plan | `['u', 'v']` |
| an oblique look | `['along', 'v']` |

RL is real elevation: vertical exaggeration is already taken out. `basis` gives the unit
vectors, so any coordinate is p·`basis.u` and p·`basis.v`. This is what overlaid axes or a
linked 2D chart needs, and it works the other way too:

```js
v.set({ view: { rect: { u0: 500100, u1: 500400, v0: 8200050, v1: 8200250 } } });
```

frames that rectangle in a locked view — centred, the whole of it shown, the canvas keeping
its aspect.

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

The chrome plugin contract, themes, per-layer legends in snapshots, the cursor readout and
the rest of the keyboard arrive in the next steps of `condenser-view-api`; axes in locked
views after that.
