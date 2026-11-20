# The Python packers' output for fixed inputs, for test/condenser-view-api.test.mjs: the JS
# API (ext/condenser/view/src/api.js) must pack the SAME layers the Python gcu.condenser
# does — same header, same wire columns. Run with the package's own venv:
#   ext/condenser/anywidget/.venv/Scripts/python test/fixtures/condenser-view-parity.py > test/fixtures/condenser-view-parity.json
import json
import sys

import numpy as np

sys.path.insert(0, "ext/condenser/anywidget")
import gcu.condenser as cd  # noqa: E402

rng = np.random.default_rng(20261120)
cases = []


def dump(name, layer, inputs, args):
    cols = {}
    for k, a in layer._cols.items():
        a = np.asarray(a)
        f = a.ravel().astype(np.float64)
        w = (np.arange(f.size) % 97 + 1).astype(np.float64)   # position-weighted: a swap between rows shows
        cols[k] = {"dtype": str(a.dtype), "len": int(a.size),
                   "sum": float(np.nansum(f)), "wsum": float(np.nansum(f * w)), "first": float(f[0]) if a.size else None}
    cases.append({"name": name, "kind": layer._kind, "inputs": inputs, "args": args,
                  "extra": json.loads(json.dumps(layer._extra, default=float)),
                  "categories": list(layer.categories or []), "cols": cols,
                  "style": {"color": layer.color, "value": layer.value}})


def L(a):
    return [None if (isinstance(v, float) and np.isnan(v)) else (v.item() if hasattr(v, "item") else v) for v in a]


# a regular block model, two value channels and a category
nx, ny, nz = 6, 5, 4
gx, gy, gz = np.meshgrid(np.arange(nx) * 10 + 500005.0, np.arange(ny) * 10 + 8200005.0, np.arange(nz) * 5 + 302.5, indexing="ij")
X, Y, Z = gx.ravel(), gy.ravel(), gz.ravel()
keep = rng.random(X.size) > 0.2
X, Y, Z = X[keep], Y[keep], Z[keep]
FE = np.round(rng.normal(55, 8, X.size), 3)
SI = np.round(rng.normal(6, 2, X.size), 3)
ROCK = rng.choice(["HEM", "ITA", "CAN"], X.size)
tbl = {"XC": X, "YC": Y, "ZC": Z, "FE": FE, "SIO2": SI, "ROCK": ROCK}
dump("blocks, two channels + category",
     cd.blocks(tbl, x="XC", y="YC", z="ZC", value=["FE", "SIO2"], category="ROCK", name="model"),
     {k: L(v) for k, v in tbl.items()}, {"x": "XC", "y": "YC", "z": "ZC", "value": ["FE", "SIO2"], "category": "ROCK", "name": "model"})

# a sub-blocked model: parents 10 m, children 5 m
px = np.array([5.0, 15.0, 2.5, 7.5, 2.5, 7.5, 25.0])
py = np.array([5.0, 5.0, 12.5, 12.5, 17.5, 17.5, 5.0])
pz = np.array([5.0, 5.0, 2.5, 2.5, 2.5, 2.5, 5.0])
dx = np.array([10, 10, 5, 5, 5, 5, 10.0])
dz = np.array([10, 10, 5, 5, 5, 5, 10.0])
sub = {"x": px, "y": py, "z": pz, "DX": dx, "DY": dx, "DZ": dz, "AU": np.arange(7) * 0.5}
dump("sub-blocked", cd.blocks(sub, value="AU", size=("DX", "DY", "DZ")),
     {k: L(v) for k, v in sub.items()}, {"value": "AU", "size": ["DX", "DY", "DZ"]})

# points with a value and a category
n = 500
P = {"x": rng.uniform(451000, 452000, n), "y": rng.uniform(8205000, 8206000, n), "z": rng.uniform(800, 900, n),
     "CU": rng.lognormal(0, 1, n), "DOM": rng.choice([1, 2, 7], n)}
P["CU"][3] = np.nan
dump("points, value + numeric category", cd.points(P, value="CU", category="DOM"),
     {k: L(v) for k, v in P.items()}, {"value": "CU", "category": "DOM"})

# drillholes
collar = {"BHID": ["DH1", "DH2"], "X": [100.0, 200.0], "Y": [50.0, 60.0], "Z": [400.0, 410.0]}
survey = {"BHID": ["DH1", "DH1", "DH2"], "DEPTH": [0.0, 50.0, 0.0], "AZ": [90.0, 95.0, 180.0], "DIP": [-60.0, -62.0, -90.0]}
assay = {"BHID": ["DH1", "DH1", "DH2", "DH2"], "FROM": [0.0, 10.0, 0.0, 5.0], "TO": [10.0, 30.0, 5.0, 20.0],
         "AU": [0.5, 2.1, 0.0, 1.4], "LITH": ["ox", "fr", "ox", "ox"]}
dump("drillholes", cd.drillholes(collar, survey, assay, value="AU", category="LITH"),
     {"collar": collar, "survey": survey, "assay": assay}, {"value": "AU", "category": "LITH"})

# a mesh and a surface with a drape
verts = [[0, 0, 0], [100, 0, 5], [0, 100, 10], [100, 100, 2]]
tris = [[0, 1, 2], [1, 3, 2]]
dump("mesh", cd.mesh(verts, tris, opacity=0.5), {"verts": verts, "tris": tris}, {"opacity": 0.5})
dem = np.round(rng.normal(900, 20, (4, 5)), 2)
dem[1, 2] = -9999
drape = np.round(rng.random((4, 5)), 3)
dump("surface + drape", cd.surface(dem, origin=(451200, 8205800), pitch=12.5, drape=drape, nodata=-9999),
     {"dem": dem.tolist(), "drape": drape.tolist()}, {"origin": [451200, 8205800], "pitch": 12.5, "nodata": -9999})

json.dump({"python_version": cd.__version__, "cases": cases}, sys.stdout)
