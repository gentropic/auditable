# Reference histograms from numpy, for test/plot-engine.test.mjs.
#   python test/fixtures/plot-numpy-hist.py > test/fixtures/plot-numpy-hist.json
# The cases are the ones that break hand-written binning: values exactly on edges, edges that
# are not representable in binary (multiples of 0.1), the inclusive last edge, uneven edges,
# weights with density, and NaN / ±Inf with an explicit range. Data is generated here and
# written out with the counts, so the JS test feeds plot exactly what numpy saw.
import json
import numpy as np

rng = np.random.default_rng(20261120)
cases = []

def case(name, data, **kw):
    data = np.asarray(data, dtype=float)
    hk = {k: v for k, v in kw.items() if k in ('bins', 'range', 'weights', 'density')}
    counts, edges = np.histogram(data, **hk)
    out = {'name': name, 'data': [None if not np.isfinite(v) and np.isnan(v) else (('inf' if v > 0 else '-inf') if np.isinf(v) else float(v)) for v in data],
           'opts': {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in kw.items()},
           'counts': counts.tolist(), 'edges': edges.tolist()}
    cases.append(out)

case('integers on edges', np.tile(np.arange(100), 3), bins=10)
case('tenths on non-representable edges', np.tile(np.round(np.arange(0, 1.0001, 0.1), 10), 7), bins=10, range=[0, 1])
case('last edge inclusive, outside dropped', [0, 1, 2, 2.5, 9.999, 10, 10.5, -1], bins=[0, 1, 2.5, 10])
case('normals, 37 bins', rng.normal(size=5000), bins=37)
w = rng.uniform(0.5, 2, size=2000)
case('weights + density', rng.normal(size=2000), bins=20, weights=w, density=True)
d = rng.normal(size=1000)
d[::17] = np.nan
d[5] = np.inf
d[6] = -np.inf
case('NaN and inf with a range', d, bins=15, range=[-3, 3])
case('constant data', np.full(50, 3.0), bins=5)
json.dump({'numpy': np.__version__, 'cases': cases}, __import__('sys').stdout)
