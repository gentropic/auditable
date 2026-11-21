# numpy's bin-count rules on fixed data, for test/plot-charts.test.mjs.
# Regenerate: ext/condenser/anywidget/.venv/Scripts/python.exe test/fixtures/plot-numpy-bins.py
import json, math, pathlib
import numpy as np

def lcg(seed, n):
    out = []
    for _ in range(n):
        seed = (seed * 16807) % 2147483647
        out.append(seed / 2147483647)
    return out

u = lcg(11, 2000)
data = {
    "uniform": [v * 100 for v in u[:500]],
    "normal": [math.sqrt(-2 * math.log(a or 1e-12)) * math.cos(2 * math.pi * b) for a, b in zip(u[:1000:2], u[1:1000:2])],
    "skewed": [math.exp(v * 6) for v in u[1000:1700]],
    "small": [1.0, 2.0, 2.5, 3.0, 7.0],
}
out = {"data": data, "bins": {}}
for name, d in data.items():
    a = np.asarray(d)
    out["bins"][name] = {rule: int(len(np.histogram_bin_edges(a, bins=rule)) - 1) for rule in ["auto", "fd", "sturges", "sqrt", "rice", "scott"]}
pathlib.Path(__file__).with_suffix(".json").write_text(json.dumps(out))
print(json.dumps(out["bins"]))
