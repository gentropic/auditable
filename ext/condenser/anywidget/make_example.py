"""Regenerate example.ipynb — the runnable tour.

The notebook is GENERATED so its JSON is right by construction, and committed
CLEAN (no outputs, no widget state: executed-and-saved it balloons 19 KB →
80+ MB). Verify + regenerate:

    .venv/Scripts/python make_example.py          # writes example.ipynb
    .venv/Scripts/python make_example.py --check  # also executes it (nbclient)
"""
import json
import sys

MD = lambda s: {"cell_type": "markdown", "metadata": {}, "source": s}
CODE = lambda s: {"cell_type": "code", "metadata": {}, "source": s, "outputs": [], "execution_count": None}

cells = [
    MD("""# gcu.condenser — mine-scale 3D in a notebook

Block models as **real boxes** (ray-traced impostors, exact silhouettes), drillholes as
desurveyed capsules, clouds as EDL-lit splats — co-registered, progressive, straight from
numpy columns. The renderer is [@gcu/condenser](https://github.com/gentropic/auditable/tree/main/ext/condenser),
the same engine behind [micro](https://gentropic.org/micro).

```
pip install gcu-condenser
```"""),
    CODE("""import numpy as np
import gcu.condenser as cd

rng = np.random.default_rng(7)

# ── a synthetic deposit ──────────────────────────────────────────────────────
# a 40×40×12 block model: two domains, two grades
gi, gj, gk = np.meshgrid(np.arange(40), np.arange(40), np.arange(12), indexing="ij")
X = gi.ravel()*10.0 + 5; Y = gj.ravel()*10.0 + 5; Z = gk.ravel()*10.0 + 5
ore = np.exp(-(((X-200)/120)**2 + ((Y-180)/90)**2 + ((Z-45)/35)**2) * 3)
FE = 15 + 45*ore + rng.normal(0, 2.5, X.size)
SIO2 = 55 - 40*ore + rng.normal(0, 3, X.size)
DOM = np.where(Z > 70, "SAPROLITE", np.where(ore > 0.35, "ITABIRITE", "WASTE"))
model = dict(X=X, Y=Y, Z=Z, FE=FE, SIO2=SIO2, DOM=DOM)

# drillholes: collars on a grid, dipping south-east, assays tracking the ore
hid = [f"DH{n:02d}" for n in range(12)]
collar = dict(BHID=hid, X=[60+n%4*90.0 for n in range(12)], Y=[80+n//4*110.0 for n in range(12)], Z=[150.0]*12)
survey = dict(BHID=np.repeat(hid, 3), DEPTH=np.tile([0.0, 60, 120], 12),
              AZ=np.tile([135.0, 135, 137], 12), DIP=np.tile([-62.0, -64, -67], 12))
frm = np.tile(np.arange(0, 120, 2.0), 12)
assay = dict(BHID=np.repeat(hid, 60), FROM=frm, TO=frm+2,
             AU=np.clip(rng.gamma(2, 0.4, 720) * (1 + 2*rng.random(720)), 0, 9))

# topography, draped with a geochem grid
ty, tx = np.mgrid[0:45, 0:45]
dem = 150 + 18*np.sin(tx/7) + 14*np.cos(ty/6) + rng.normal(0, .6, (45, 45))
geochem = np.hypot(tx-22, ty-18)"""),
    MD("""## The one-liner

A table (or bare arrays) in, a live view out. Drag orbits, right-drag pans, wheel dollies.
`threshold` is how you look at an ore body at all — a block model is *solid*, so from
outside you only ever see waste."""),
    CODE("""cd.blocks(model, x="X", y="Y", z="Z", value="FE", threshold=[35, 99], ramp="turbo")"""),
    MD("""## A stacked scene

Layers share one frame, so they co-register. `value=[...]` ships several grade channels
at ~4 B/block each; `labels=True` writes the BHIDs at the collars; the surface drapes a
geochem grid over the DEM. Bottom-center: the north arrow + scale bar (they land in
snapshots too — `w.decorations = False` for a bare canvas)."""),
    CODE("""w = cd.view(
    cd.blocks(model, x="X", y="Y", z="Z", value=["FE", "SIO2"], category="DOM",
              name="model", threshold=[35, 99], ramp="turbo"),
    cd.drillholes(collar, survey, assay, value="AU", radius=2.5, name="holes", labels=True),
    cd.surface(dem, origin=(0.0, 440.0), pitch=10.0, drape=geochem, nodata=None,
               name="topo", opacity=0.85, sectioned=False),
    height=520,
)
w"""),
    MD("""## Seeing inside

Cut a section (world coordinates), look along it in parallel projection, scrub it with
the slider that appears — or drag the **knife** tool across the view for a free-normal
cut. `z_exaggeration` stretches the *display* only: picks, measures and selections stay
in real coordinates."""),
    CODE("""w.cut(axis="y", position=180, thickness=20)
w.look("north", ortho=True)
w.z_exaggeration = 1.5"""),
    MD("""## Channels, classes, hover

Switching the live value channel is client-side — no re-send, and the threshold, legend
and pick readout follow. Colored by category, the legend becomes clickable swatches:
each row is an eye (`categories_hidden` round-trips what you click). `hover=True` makes
the pick readout follow the cursor."""),
    CODE("""w["model"].value = "SIO2"          # …and back: w["model"].value = "FE"
w["model"].color = "category"      # the legend becomes class eyes — click one
w["model"].categories_hidden = ["WASTE"]
w.hover = True"""),
    MD("""## Picks and selections round-trip

Click an element: `w.selection` is `{'layer', 'name', 'row'}` and the row indexes the
table you passed. Rectangle/lasso (shift adds; **through** sweeps the volume behind the
visible surface): `w["model"].selected_rows` comes back as numpy indices — `df.iloc`
away from pandas."""),
    CODE("""w.selection, w["model"].selected_rows[:10]"""),
    MD("""## The camera is Python state

`w.camera` reads back in geologist terms; a partial set reproduces a shot. Put a
`look(...)` in the cell that takes the figure and the notebook renders the same view
every run — and navigating marks the camera as *yours*: data changes never re-fit over
a framed shot (`w.fit()` reclaims)."""),
    CODE("""w.look(azimuth=140, plunge=28, ortho=False)
w.camera"""),
    MD("""## Streaming: `cd.open` — never resident

The payload carries only the header; rows follow as ~11 B/block chunks, rendering
progressively. Any two-pass batch source works (shown here); a Parquet path streams via
pyarrow, column-projected, one row group resident at a time:

```python
cd.open("model.parquet", x="XC", y="YC", z="ZC", value="FE")
cd.open("model.parquet", ..., size=("DX", "DY", "DZ"))     # sub-blocked, true box sizes
cd.open("cloud.parquet", kind="points", x="X", y="Y", z="Z", value="Z")
```

And on jupyter-server, `via='files'` skips the kernel entirely — the **browser** fetches
the file over `/files/` byte ranges and reads it with the engine's own providers:

```python
cd.open("model.dm", via="files")                           # yes, Datamine, kernel-free
cd.open("blocks.csv", via="files", value="FE")
cd.drillholes("collar.csv", "survey.csv", "assay.csv", via="files", value="AU")
```"""),
    CODE("""half = X.size // 2
batches = [dict(X=X[:half], Y=Y[:half], Z=Z[:half], FE=FE[:half]),
           dict(X=X[half:], Y=Y[half:], Z=Z[half:], FE=FE[half:])]
cd.open(lambda: iter(batches), x="X", y="Y", z="Z", value="FE", ramp="turbo")"""),
    MD("""## Exporting

An exported view keeps working with **no kernel** — all interaction is client-side.
Whole notebook: JupyterLab's *Save Widget State Automatically* + `jupyter nbconvert
--to html`. One view standalone: `cd.export_html(w, "view.html")` (it pins
`drop_defaults=False`; the stock embed silently writes a blank widget)."""),
]

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
# nbformat wants source as a list of lines in some tools; a plain string is valid JSON per the schema
with open("example.ipynb", "w", encoding="utf8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print(f"wrote example.ipynb ({len(cells)} cells)")

if "--check" in sys.argv:
    import nbformat
    from nbclient import NotebookClient
    node = nbformat.read("example.ipynb", as_version=4)
    NotebookClient(node, timeout=120).execute()
    errs = [o for c in node.cells if c.cell_type == "code" for o in c.get("outputs", []) if o.get("output_type") == "error"]
    print("EXECUTED:", "0 errors" if not errs else f"{len(errs)} ERRORS: {errs[0].get('ename')}")
    sys.exit(1 if errs else 0)
