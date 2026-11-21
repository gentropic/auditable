# matplotlib's own boxplot statistics (cbook.boxplot_stats) on fixed data, for
# test/plot-charts.test.mjs. Needs matplotlib (any venv with it):
#   python test/fixtures/plot-mpl-boxplot.py
import json, math, pathlib
from matplotlib import cbook

def lcg(seed, n):
    out = []
    for _ in range(n):
        seed = (seed * 16807) % 2147483647
        out.append(seed / 2147483647)
    return out

u = lcg(5, 1200)
data = {
    "normal": [math.sqrt(-2 * math.log(a or 1e-12)) * math.cos(2 * math.pi * b) for a, b in zip(u[:400:2], u[1:400:2])],
    "skewed": [math.exp(v * 5) for v in u[400:700]],
    "outliers": [10, 11, 11.5, 12, 12, 12.5, 13, 14, 30, -5, 12.2, 11.8],
    "tiny": [3.0, 1.0, 2.0],
    "ties": [1, 1, 1, 1, 2, 2, 2, 50],
}
out = {"data": data, "stats": {}}
for name, d in data.items():
    for whis in (1.5, 0.5, [5, 95]):
        s = cbook.boxplot_stats(d, whis=whis)[0]
        key = f"{name}|{whis}"
        out["stats"][key] = {k: (float(v) if k != "fliers" else sorted(float(f) for f in v)) for k, v in s.items() if k != "label"}
pathlib.Path(__file__).with_suffix(".json").write_text(json.dumps(out))
print(len(out["stats"]), "cases")
