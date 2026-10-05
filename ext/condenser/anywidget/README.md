# gcu-condenser

**Block models, drillholes and big point clouds — in a Jupyter notebook.**

![a thresholded block model under a draped topo surface, labeled drillholes through it, scale bar and legend](https://raw.githubusercontent.com/gentropic/auditable/main/ext/condenser/anywidget/docs/hero.png)

```python
import numpy as np, gcu.condenser as cd

cd.blocks(df, x="XC", y="YC", z="ZC", value="FE")        # on its own
w = cd.view(                                              # …or stacked, co-registered
    cd.blocks(df, value="FE", name="model", threshold=[28, 99]),
    cd.drillholes(collar, survey, assay, value="AU"),
    cd.points(tx, ty, tz, name="topo", sectioned=False),
    section={"axis": "y", "position": 8200500, "thickness": 40},
)
w
```

The renderer is [`@gcu/condenser`](../) — the same streaming engine behind
[micro](https://gentropic.org/micro). Columns go in; the widget quantizes them,
Morton-orders them, and draws a shuffled prefix that refines progressively, so a
few million elements come up in a fraction of a second and sharpen from there.
No decimation pass, no mesh conversion, no kernel round trip while you navigate.

Start with **[`example.ipynb`](example.ipynb)** — a runnable tour, no data files needed.

## Why this and not pyvista / k3d

pyvista is excellent and this does not replace it. The honest comparison, from
a bench of the shapes a resource geologist actually has (128×128×80 lattice;
build time and the bytes that must reach the browser):

| | condenser | pyvista |
|---|---|---|
| **full** regular lattice, 1.3M cells | 56 ms · 14 MiB | **1 ms · 41 MiB** (`ImageData`) |
| **sparse** model (a deposit, 150k of those cells) | **7 ms · 1.6 MiB** | 74 ms · 17.7 MiB |
| **sub-blocked**, 90k blocks, 2 sizes | **47 ms · 1.1 MiB** | 73 ms · 30.2 MiB (glyph) |
| point cloud, 5M | 187 ms · 90 MiB | 134 ms · 153 MiB |

Read that honestly:

- **For a full regular lattice, pyvista wins outright.** `ImageData` is
  *implicit* — VTK materializes no geometry at all. If your model is a complete
  box and you are happy in a VTK pipeline, use pyvista.
- **A real model is not a box.** The moment you keep only the cells that exist,
  `threshold` materializes explicit hexahedra — 547k points for 150k cells —
  and it is 10× slower to build and ~11× more to ship.
- **Sub-blocked models cannot be `ImageData` at all**, so the only route is
  glyphing cubes: 540k cells and 720k points for 90k blocks, ~11× the bytes.
  That is the case that scales worst, and it is common.
- **Point clouds are a wash** on construction. Nothing to claim here.

The advantage that does *not* show in that table is **rendering**, which is what
the engine is actually for: one instanced quad per block with a ray-traced
impostor rather than 12 triangles, and progressive prefix-LOD as the default
path — so a model paints early and sharpens, instead of stalling until it can
draw everything. VTK renders all-or-nothing. Measuring that fairly needs a GPU
on both sides, so it is stated here as a design difference, not a benchmark.

Plus the posture the same audience tends to care about: **no network, no WASM,
no runtime downloads**; the ES module is bundled into the wheel.

Short version: general meshes, volumes, streamlines, a full VTK pipeline, or a
complete regular lattice → pyvista. A sparse or sub-blocked mine-scale model
with its drillholes, that you want to click on → this.

## Requirements

**Python 3.10+**, and two dependencies: **anywidget** and **numpy**. That is the
whole list — no VTK, no WASM, no CDN.

| | | |
|---|---|---|
| Python | `>=3.10` | verified on 3.10 · 3.11 · 3.12 · 3.13 |
| `anywidget` | `>=0.9` | developed against 0.11 |
| `numpy` | `>=1.21` | verified on 1.21 · 1.23 · 1.26 · 2.x |

3.10 is a *support* decision rather than a syntax one — the code runs fine on
3.9, but on 3.9 pip resolves anywidget back to 0.9.x, a different frontend
generation whose JS contract isn't tested here. One anywidget to support beats
two supported blind. (3.9 is also EOL as of October 2025.)

Both numpy majors work: `np.unique(..., axis=0, return_inverse=True)` — used by
the sub-blocking path — changed its result shape across the 2.0 boundary, and
that path is covered on each side.

`pandas` is *not* required: every constructor takes plain arrays, and a "table"
is anything indexable by column name (a DataFrame, a polars frame, or a dict of
arrays). It's a `[dev]` extra only because the example notebook uses it.

## Install

Not on PyPI yet. From the repo, with [uv](https://docs.astral.sh/uv/):

```bash
uv venv ext/condenser/anywidget/.venv
uv pip install --python ext/condenser/anywidget/.venv -e "ext/condenser/anywidget[dev]"
```

`[dev]` adds jupyterlab + pandas so `example.ipynb` runs. If you changed the JS,
rebuild first: `node ext/condenser/anywidget/build.js`.

## The three kinds

```python
cd.points(x, y, z, value=..., category=..., rgb=...)     # a cloud
cd.blocks(x, y, z, value=..., size=(dx, dy, dz))         # a model (sub-blocking optional)
cd.drillholes(collar, survey, intervals, value="AU")     # desurveyed capsules
cd.mesh(vertices, triangles, color="#b87333")            # context: a pit shell, a domain
cd.surface(dem, origin=(x0, y0), pitch=12.5)             # a 2D grid as shaded relief
```

`value` may be **several columns** — `value=["FE", "SIO2", "AL2O3"]` (or a dict
`{name: array}`) ships every channel once, and `w["model"].value = "SIO2"`
switches the live one client-side: no re-send, the threshold, legend and pick
readout all follow. At wire-v3 cost an extra channel is ~4 B/block.

Each takes arrays *or* a table plus column names, and returns a **Layer**.
Display a Layer directly, or stack several with `cd.view(...)` — they share one
frame, so they co-register (and a local origin keeps mine-grid coordinates off
the float32 wall on the GPU).

A **mesh** is scenery, not data: it draws whole, its `color` is a hex tint
(flat-shaded, not value-colored), it sections as a trace on the cut wall, and
it carries no records — `opacity` and `visible` are its knobs. Hand it `(n,3)`
vertices and `(m,3)` triangle indices, straight from trimesh / PyVista /
anything that reads your wireframe format.

A **surface** is a regular 2D grid (a DEM, a modeled horizon) triangulated in
the browser with smooth normals and clean holes at `nodata`. Row 0 is the
NORTHERNMOST row (the GeoTIFF convention) and `origin` is the top-left node.
It colors by its own elevation through `ramp`/`clip`, by a **`drape=`** grid of
the same shape (grade over topo), or — given a hex `color` — renders as a
plain tinted relief. `flat_z=` makes a flat colored sheet instead (a geochem
grid with no DEM). Like a mesh, it is recordless scenery.

Drillholes desurvey in the browser through **@gcu/drillhole**, the same
minimum-curvature code micro uses, so a hole lands in the same place in both.

## Streaming: `cd.open` — never resident, no comm ceiling

```python
cd.open("model.parquet", x="XC", y="YC", z="ZC", value="FE", category="DOMAIN")
cd.open("model.parquet", ..., size=("DX", "DY", "DZ"))           # sub-blocked
cd.open("cloud.parquet", kind="points", x="X", y="Y", z="Z", value="Z")
cd.open(lambda: my_batches(), x="X", y="Y", z="Z", value="AU")   # any batch source
```

A dataset streamed from disk: the widget's payload carries only the
**header** (the inferred lattice or bbox, count, value range, category
labels), and the rows follow as wire-v3 chunks over Jupyter custom messages
once the view is up — **rendering progressively**, batch by batch, exactly
like the engine streaming a file in micro. The kernel never holds more than
one batch. Blocks ride as u16 lattice indices (~11 B/block kept browser-side,
coordinates reconstructed lazily); `size=` names the block-size columns of a
**sub-blocked** model (fine lattice + a ≤256-size palette, +1 B/block, true
box sizes); `kind='points'` ships f32 local positions (~17 B/point). Pick,
measure, select-through and `threshold` all work as on a resident layer.

A Parquet path streams via **pyarrow** (row-group-aligned, column-projected —
only the mapped columns are ever decoded); any other source is a list of
table-like batches or a zero-arg callable returning an iterator (the source is
read twice: once for the lattice and ranges, once for the data, which is why a
bare generator is refused). Each extra view of the same Viewer requests its own
epoch-tagged stream, so views never interleave.

### `via='files'` — the kernel never reads a byte

```python
cd.open("model.dm", via="files")                           # yes, Datamine, in a notebook
cd.open("blocks.csv", via="files")
cd.open("cloud.las", via="files")
```

On **jupyter-server** (Lab, Notebook — not Colab/VS Code), the `/files/`
endpoint serves **byte ranges** on the session cookie. `via='files'` exploits
that: the kernel only *names* the file (the payload is a few hundred bytes of
candidate paths), and the **browser** fetches it directly, reading it through
the engine's own providers — the same CSV / Datamine `.dm` / LAS / PLY readers
micro ships, column roles auto-sniffed the way micro sniffs a dropped file.
Zero Python reading code, zero kernel memory, zero comm traffic for the data.
A `.dm` opens in a notebook without anything in Python knowing the format.
The layer's `count` / ranges / categories sync back to the kernel after
discovery; when `/files` isn't reachable the view says so and the kernel paths
(`via='kernel'`, resident constructors) remain.

## The toolbar

| | |
|---|---|
| **fit** | reframe on the data |
| **views** | plan · looking north · looking east · isometric |
| **ortho** | parallel projection — sections are unreadable in perspective |
| **pick** | click an element to inspect it (on by default) |
| **rectangle** | drag a box to select — shift adds to the selection |
| **lasso** | draw around elements to select — shift adds |
| **through** | toggle: select the swept *volume* instead of the visible surface |
| **measure** | click two elements for distance, bearing and plunge |
| **knife** | drag a line across the view to cut a section along it |
| **layers** | show/hide each layer |
| **snapshot** | save the view as a PNG |

Plus a **color legend** bottom-right (a ramp, or clickable category swatches —
see the knobs), a **pick readout** top-right, a **scrub bar** whenever a
section exists, and bottom-center the **figure chrome**: a north arrow and a
scale bar (true at the camera-target depth), both drawn into snapshots.
`w.decorations = False` for a bare canvas. Drillhole layers can write their
**BHIDs at the collars** with `holes.labels = True` (capped at 400 on screen).

It is deliberately small. The toolbar carries what is awkward from Python
(mouse-driven geometry) and what you need *while looking* (the readout, the
legend); everything a line of Python does well stays in Python. Anything you do
here **round-trips**: hide a layer with the toolbar and `w["topo"].visible` is
`False` in the kernel, and a knife cut lands in `w.section`. Pass
`toolbar=False` for a clean figure.

## The knobs

Per **layer** — every one is live, set it and the view updates with no re-send:

| trait | |
|---|---|
| `color` | `'z'` · `'value'` · `'category'` · `'rgb'` · `'flat'` (mesh/surface: a hex tint) |
| `value` | the ACTIVE value channel, when the layer ships several |
| `ramp` | `viridis` · `magma` · `turbo` · `grays` · `spectral` · `fire` |
| `clip` | `[lo, hi]` — clamp the color scale |
| `threshold` | `[lo, hi]` — **cutoff on the value column** |
| `filter_mode` | `'isolate'` (hide the rest) or `'dim'` |
| `categories_hidden` | labels to hide (per-class eyes; the legend swatches toggle these) |
| `opacity` | screen-door see-through, `1.0` = solid |
| `visible`, `point_size`, `as_points`, `block_edges`, `radius` | |
| `sectioned` | `True` · `False` (exempt) · `'front'` · `'behind'` |
| `selected` | read back: the row picked on this layer |
| `selected_rows` | read back: rows caught by the rectangle/lasso tools |

Per **view**: `section` (or `w.cut(...)`), `background`, `height`, `toolbar`, `edl`,
`edl_strength`, `budget`, `z_exaggeration` (display-only — picks and measures stay in
real coordinates), `hover` (the pick readout follows the cursor), `selection`,
`selected_rows`, `measurement`, `w.fit()`, `w.clear_selection()`, `w.copy()`,
`w["name"]`, `w.add(layer)`.

### The camera is Python state

`w.camera` reads back in geologist terms — `{'azimuth': ° from north clockwise,
'plunge': ° downward, 'distance', 'target': [x, y, z] world, 'ortho'}` — and a
set (full or partial) reproduces it. `w.look('plan' | 'north' | … )` keeps the
presets; `w.look(azimuth=132, plunge=25)` is the numeric form. This is the
**reproducible-figure knob**: put the `look(...)` in the cell, and the notebook
renders the same shot every run. Navigating marks the camera as yours — a data
change (`w.add`, a re-pack, a stream completing) never re-fits over a framed
shot; `w.fit()` reclaims it explicitly.

Colored by **category**, the legend becomes a swatch list and each row is an
eye: click to hide that class (GPU-side, composes with `threshold`, and hidden
classes don't pick). It round-trips — `w["model"].categories_hidden` names
what you clicked off.

### Seeing inside a model

A block model is *solid* — from outside you see waste. `threshold` is how you
look at an ore body at all:

```python
w = cd.blocks(x, y, z, value=fe, ramp="turbo")
w.threshold = [30, 99]        # the grade shell appears
w.threshold = []              # back to the full model
```

Dragging a cutoff never re-sends data; the mask is rebuilt in the browser from
the value column it already has.

### Sections

```python
w.cut(axis="y", position=8200500, thickness=40)
w.cut(normal=[1, 1, 0], position=0, thickness=25)   # any orientation
w.cut()                                              # clear
w.look("north", ortho=True)                          # …and look ALONG it
```

A section is only readable when you look **along** it in parallel projection, so
`look()` is the usual companion — `'plan'`, `'north'`, `'south'`, `'east'`,
`'west'`, `'iso'`. The toolbar's *views* and *ortho* buttons do the same.

A layer built with `sectioned=False` stays whole while the rest is cut — the
usual way you keep topography for context. `'front'` / `'behind'` give you a
half-space instead of a slab.

`cut()`, `look()`, `fit()` and `add()` return `None` on purpose: a notebook
displays a cell's value, so returning `self` would build a *second* live view of
the same widget every time you adjusted it.

### Clicking round-trips into pandas

The pick uses the engine's ID buffer, and a record index *is* the row you passed:

```python
w = cd.view(cd.blocks(df, value="FE", name="model"), holes)
# …click something…
w.selection            # {'layer': 0, 'name': 'model', 'row': 12874}
df.iloc[w.selected_row]
```

For drillholes the row is the **interval** row of the assay table.

### Selecting, and measuring

The rectangle and lasso tools hand their result straight back as row indices:

```python
w.selected_rows                  # {'model': array([...]), 'holes': array([...])}
w["model"].selected_rows         # just this layer's rows
df.iloc[w["model"].selected_rows]        # …which is a DataFrame slice
df.iloc[w["model"].selected_rows].FE.mean()
w.clear_selection()
```

Two modes, like micro's:

- **surface** (default) — uses the same ID buffer as a click, so *what you
  select is what you can see*; occluded elements are not caught.
- **through** (`w.select_through = True`, or the toolbar toggle) — sweeps the
  whole volume behind the shape, so a solid block model gives up its interior.
  On the same box over a solid model that is typically ~10× more rows.

Through-mode defeats *occlusion*, which is the point, but not display state: a
hidden layer, an isolate-filtered element, or a block outside the section slab
is not merely behind something, so the tube leaves it alone.

The two modes disagree slightly at the marquee's edge — through tests an
element's **center**, surface tests its rendered **pixels**, so a wide splat or a
long drillhole interval can paint inside a box its center falls outside of
(measured: the tube contains ~96% of a surface selection, with the difference
entirely in points and holes, none in blocks).

Rows ride back as packed binary rather than JSON, because a marquee over a big
model can easily select a million of them.

Measure takes two clicks and reports what you actually want off two points:

```python
w.measurement
# {'from': [...], 'to': [...], 'distance': 84.9, 'dx':…, 'dy':…, 'dz':…,
#  'bearing': 41.2, 'plunge': 63.5}
```

Bearing is degrees from north, clockwise; plunge is positive downward.

### Two panels at once

Views of one Viewer **share its state** — that is what makes `w.cut(...)` update
a cell further up, and it also means two displays of `w` can never differ. For
genuinely independent panels, take a copy:

```python
plan = w.copy()
plan.look("plan", ortho=True)
section = w.copy()
section.cut(axis="y", position=8200500, thickness=40)
section.look("north", ortho=True)     # …two panels, one dataset
```

`copy()` reuses the payload bytes, so it costs a widget, not a re-pack.

## Exporting: it keeps working without a kernel

Everything interactive here runs in the browser, so an exported view stays live
— orbit, pick, knife, section scrub, layers, selection, snapshot all work with
the kernel gone. Only the write-backs (`selection`, `selected_rows`,
`measurement`) have nowhere to land.

**Exporting a whole notebook — no function call needed.** This is the normal
Jupyter path:

1. JupyterLab → **Settings → Save Widget State Automatically**
2. Save the notebook
3. `jupyter nbconvert --to html nb.ipynb`

The widget state (including the widget's own JavaScript) rides in the notebook's
metadata, so the exported page carries both the code and the data. Verified end
to end: a notebook exported this way opens in a browser with no kernel and the
3D is fully interactive.

**Exporting one view on its own** — a single widget as a standalone file, no
notebook involved:

```python
cd.export_html(w, "model.html")
```

This exists because the stock `embed_minimal_html(...)` **silently produces a
blank widget**: ipywidgets drops any trait equal to its default, and anywidget's
`_esm` — the widget's own JavaScript — *is* its default, so the file comes out
with no code in it and no error. `export_html` pins `drop_defaults=False`.

Two things to know either way:

- **Viewing needs network**, even though the data is embedded: the page pulls
  the ipywidgets html-manager from a CDN (unpkg for nbconvert, jsdelivr for the
  standalone). nbconvert can be pointed at a local copy
  (`--HTMLExporter.jupyter_widgets_base_url=./vendor/`), which is the route to a
  genuinely offline export.
- Size: the payload is base64 in the state, so budget about **+33%** over the
  figures above.

One thing not verified here: whether JupyterLab's own *Save Widget State* keeps
`_esm` (it is the same drop-defaults trap). If an export ever comes out blank,
that is the first thing to check — `grep -c _esm nb.ipynb` on the saved
notebook should be `1`, not `0`.

## Honest notes

- `filter_mode='dim'` suits **point clouds** — on a solid block model the dimmed
  blocks still occlude, so use `'isolate'` there.
- `opacity` is a screen-door dither (real depth, no sorting), so it sees a few
  blocks deep, not through a whole model.
- `point_size` and `as_points` are view-wide in the engine, so they fold across
  visible layers rather than applying per layer.
- Sub-blocked models must share a common fine lattice (a whole-number
  subdivision). When they don't, the error says so and points at `cd.points(...)`
  rather than drawing a subtly wrong grid.
- The payload crosses the Jupyter comm channel as one blob, so a layer is
  bounded by your deployment's message limit. Wire v3 ships blocks as u16
  lattice indices + f32 values (11 B/block — exact: coordinates are
  reconstructed in f64 from the inferred axes) and points as f32 about the
  layer's own center (18 B/point with a value) — roughly 5.5M blocks or 3.4M
  points per 62 MB. Past that, stream the model with `cd.open(...)` — the
  payload stays header-sized and the rows ride custom messages instead.

## Testing

```bash
node test/condenser-widget.mjs
```

Cross-language by construction: the real Python packer runs in this venv, its
bytes cross into a real browser, and the real built module renders them — the
only shape that catches a wire-format drift between the two halves.
