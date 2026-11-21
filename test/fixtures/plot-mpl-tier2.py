# matplotlib's own numbers for plot M4 (tier 2), for test/plot-tier2.test.mjs. Needs matplotlib
# (any venv with it):   python test/fixtures/plot-mpl-tier2.py
import json, math, pathlib
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import cbook, mlab, ticker

def lcg(seed, n):
    out, s = [], seed
    for _ in range(n):
        s = (s * 1103515245 + 12345) % 2147483648
        out.append(s / 2147483648)
    return out

def normalish(seed, n):
    u = lcg(seed, 3 * n)
    return [u[3 * i] + u[3 * i + 1] + u[3 * i + 2] - 1.5 for i in range(n)]

out = {'matplotlib': matplotlib.__version__}

# hexbin: the drawn hexagons (offsets) and their values, with and without C
x = normalish(1, 2000); y = [0.5 * a + b for a, b in zip(x, normalish(2, 2000))]
c = lcg(3, 2000)
hb = []
for kw in [dict(gridsize=15), dict(gridsize=(8, 5)), dict(gridsize=10, mincnt=1), dict(gridsize=12, C=c), dict(gridsize=10, extent=(-1, 1, -1, 1))]:
    fig, ax = plt.subplots()
    pc = ax.hexbin(x, y, **kw)
    off = pc.get_offsets()
    arr = np.asarray(pc.get_array(), float)
    hb.append({'kw': {k: (list(v) if isinstance(v, tuple) else v) for k, v in kw.items() if k != 'C'}, 'C': 'C' in kw,
               'offsets': [[float(a), float(b)] for a, b in off], 'values': [None if math.isnan(v) else float(v) for v in arr]})
    plt.close(fig)
out['hexbin'] = {'x': x, 'y': y, 'C': c, 'cases': hb}

# violin: matplotlib's KDE (mlab.GaussianKDE, Scott), at 100 points from min to max
sets = [normalish(4, 300), [v * 2 + 1 for v in normalish(5, 120)], normalish(6, 40)]
def kde(X, coords):
    return mlab.GaussianKDE(X, 'scott').evaluate(coords)
vs = cbook.violin_stats([np.asarray(s) for s in sets], kde, points=100)
out['violin'] = {'sets': sets, 'stats': [{'coords': list(map(float, s['coords'])), 'vals': list(map(float, s['vals'])), 'mean': float(s['mean']), 'median': float(s['median']), 'min': float(s['min']), 'max': float(s['max'])} for s in vs]}

# hist2d: numpy's histogram2d
h, xe, ye = np.histogram2d(x, y, bins=[7, 5])
h2, _, _ = np.histogram2d(x, y, bins=6, range=[[-1, 1], [-1.5, 1.5]], density=True)
out['hist2d'] = {'h': h.tolist(), 'xe': xe.tolist(), 'ye': ye.tolist(), 'h_density': h2.tolist()}

# stackplot: each layer's lower and upper line, for every baseline
xs = list(range(8)); ys = [[1, 2, 3, 2, 4, 5, 3, 2], [2, 2, 1, 3, 1, 2, 4, 3], [0.5, 1, 1.5, 1, 0.5, 2, 1, 1]]
sp = {}
for base in ['zero', 'sym', 'wiggle', 'weighted_wiggle']:
    fig, ax = plt.subplots()
    colls = ax.stackplot(xs, *ys, baseline=base)
    layers = []
    for coll in colls:
        v = coll.get_paths()[0].vertices
        lo, hi = [], []
        for xv in xs:
            at = v[np.isclose(v[:, 0], xv)][:, 1]
            lo.append(float(at.min())); hi.append(float(at.max()))
        layers.append({'lo': lo, 'hi': hi})
    sp[base] = layers
    plt.close(fig)
out['stackplot'] = {'x': xs, 'ys': ys, 'layers': sp}

# formatters: PercentFormatter's automatic decimals, EngFormatter
fig, ax = plt.subplots()
pf = []
for xmax, lim, vals in [(1, (0, 1), [0, 0.25, 0.5, 0.75, 1]), (100, (0, 3), [0, 1, 2, 3]), (1, (0.1, 0.12), [0.1, 0.105, 0.11]), (100, (0, 500), [0, 250, 500])]:
    ax.set_ylim(*lim)
    f = ticker.PercentFormatter(xmax)
    f.set_axis(ax.yaxis)
    pf.append({'xmax': xmax, 'lim': list(lim), 'vals': vals, 'labels': f.format_ticks(vals)})
ef = ticker.EngFormatter(unit='Hz')
eng = {'vals': [0, 1, 12.5, 1500, 2.2e6, 0.0035, -47000], 'labels': [ef(v) for v in [0, 1, 12.5, 1500, 2.2e6, 0.0035, -47000]]}
plt.close(fig)
out['percent'] = pf
out['eng'] = eng

# minor ticks: AutoMinorLocator between given majors
mn = []
for step, lim in [(1, (0, 5)), (2, (0, 10)), (0.5, (-1, 1)), (25, (0, 100))]:
    fig, ax = plt.subplots()
    ax.set_xlim(*lim)
    ax.xaxis.set_major_locator(ticker.MultipleLocator(step))
    ax.xaxis.set_minor_locator(ticker.AutoMinorLocator())
    fig.canvas.draw()
    mn.append({'step': step, 'lim': list(lim), 'majors': [float(v) for v in ax.xaxis.get_majorticklocs()], 'minors': [float(v) for v in ax.xaxis.get_minorticklocs()]})
    plt.close(fig)
out['minor'] = mn

pathlib.Path(__file__).with_name('plot-mpl-tier2.json').write_text(json.dumps(out))
print('wrote plot-mpl-tier2.json, matplotlib', matplotlib.__version__)
