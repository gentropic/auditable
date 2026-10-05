"""gcu.condenser.stats — streaming statistics over batch sources.

For data that never fits (the :mod:`gcu.condenser.io` readers, a Parquet the
kernel shouldn't hold): mergeable accumulators swept batch-by-batch — sluice's
shapes in numpy. For a resident DataFrame use pandas; these exist for the
files pandas cannot touch.

    from gcu.condenser import io, stats
    src = io.batches("model.dm")
    stats.describe(src, ["FE", "SIO2"])
    stats.grade_tonnage(src, "FE", cutoffs=[30, 40, 50], density=3.2, block_volume=10*10*5)
    stats.swath(src, coord="XC", grade="FE")
"""
from __future__ import annotations

import math
import pathlib

import numpy as np


def _as_batches(src, columns=None):
    """A path or a zero-arg callable → a zero-arg callable (two-pass)."""
    if isinstance(src, (str, pathlib.Path)):
        from . import io as _io
        return _io.batches(src, columns=columns)
    if callable(src):
        return src
    if isinstance(src, (list, tuple)):
        return lambda: iter(src)
    raise TypeError("gcu-condenser: stats take a path, a list of batches, or a callable returning an iterator")


def _finite(batch, name):
    v = np.asarray(batch[name], dtype=np.float64)
    return v[np.isfinite(v)]


class Welford:
    """Mergeable count/mean/variance/extents (Welford + the Pébay merge)."""

    def __init__(self):
        self.n = 0
        self.mean = 0.0
        self.m2 = 0.0
        self.min = math.inf
        self.max = -math.inf

    def add(self, arr):
        v = np.asarray(arr, dtype=np.float64)
        v = v[np.isfinite(v)]
        if not v.size:
            return self
        o = Welford()
        o.n = int(v.size)
        o.mean = float(v.mean())
        o.m2 = float(((v - o.mean) ** 2).sum())
        o.min = float(v.min())
        o.max = float(v.max())
        return self.merge(o)

    def merge(self, o):
        if o.n == 0:
            return self
        if self.n == 0:
            self.__dict__.update(o.__dict__)
            return self
        n = self.n + o.n
        d = o.mean - self.mean
        self.m2 += o.m2 + d * d * self.n * o.n / n
        self.mean += d * o.n / n
        self.n = n
        self.min = min(self.min, o.min)
        self.max = max(self.max, o.max)
        return self

    @property
    def var(self):
        return self.m2 / (self.n - 1) if self.n > 1 else 0.0

    @property
    def std(self):
        return math.sqrt(self.var)

    def as_dict(self):
        return {"count": self.n, "mean": self.mean, "std": self.std,
                "min": None if self.n == 0 else self.min,
                "max": None if self.n == 0 else self.max}


def describe(src, columns, batch_rows: int = 1_048_576) -> dict:
    """One streamed pass → {column: {count, mean, std, min, max}}."""
    bs = _as_batches(src, columns=list(columns))
    accs = {c: Welford() for c in columns}
    for batch in bs():
        for c in columns:
            accs[c].add(batch[c])
    return {c: a.as_dict() for c, a in accs.items()}


def histogram(src, column, bins: int = 50, range=None, batch_rows: int = 1_048_576):
    """A streamed histogram → (counts, edges). ``range`` skips the extent pass
    (the source is read twice without it — why batch sources are two-pass)."""
    bs = _as_batches(src, columns=[column])
    if range is None:
        w = Welford()
        for batch in bs():
            w.add(batch[column])
        if w.n == 0:
            raise ValueError(f"gcu-condenser: {column} has no finite values")
        range = (w.min, w.max)
    edges = np.linspace(range[0], range[1], bins + 1)
    counts = np.zeros(bins, dtype=np.int64)
    for batch in bs():
        v = _finite(batch, column)
        if v.size:
            counts += np.histogram(v, bins=edges)[0]
    return counts, edges


def grade_tonnage(src, grade, cutoffs, density: float = 1.0, block_volume: float = 1.0,
                  density_col=None) -> list[dict]:
    """The grade–tonnage curve, streamed: per cutoff, tonnes above cut and their
    mean grade. ``density_col`` names a per-block density column; otherwise
    ``density`` is constant. Tonnes = Σ volume·density over blocks ≥ cutoff."""
    cuts = np.asarray(sorted(cutoffs), dtype=np.float64)
    cols = [grade] + ([density_col] if density_col else [])
    bs = _as_batches(src, columns=cols)
    tonnes = np.zeros(cuts.size)
    metal = np.zeros(cuts.size)
    for batch in bs():
        g = np.asarray(batch[grade], dtype=np.float64)
        ok = np.isfinite(g)
        g = g[ok]
        if not g.size:
            continue
        d = (np.asarray(batch[density_col], dtype=np.float64)[ok] if density_col
             else np.full(g.size, density))
        t = d * block_volume
        order = np.argsort(g)
        gs, ts = g[order], t[order]
        ct = np.concatenate([np.cumsum(ts[::-1])[::-1], [0.0]])      # tonnes at grade ≥ gs[i]
        cm = np.concatenate([np.cumsum((ts * gs)[::-1])[::-1], [0.0]])
        at = np.searchsorted(gs, cuts, side="left")
        tonnes += ct[at]
        metal += cm[at]
    return [{"cutoff": float(c), "tonnes": float(t),
             "grade": float(m / t) if t > 0 else None}
            for c, t, m in zip(cuts, tonnes, metal)]


def swath(src, coord, grade, band=None, bands: int = 40, batch_rows: int = 1_048_576) -> dict:
    """Mean grade per band along a coordinate (the drift plot): two passes —
    extent, then banded Welfords. Returns {centers, mean, count, band}."""
    bs = _as_batches(src, columns=[coord, grade])
    ext = Welford()
    for batch in bs():
        ext.add(batch[coord])
    if ext.n == 0:
        raise ValueError(f"gcu-condenser: {coord} has no finite values")
    if band is None:
        band = (ext.max - ext.min) / bands or 1.0
    lo = ext.min
    n_bands = max(1, int(math.ceil((ext.max - lo) / band)) or 1)
    sums = np.zeros(n_bands)
    counts = np.zeros(n_bands, dtype=np.int64)
    for batch in bs():
        c = np.asarray(batch[coord], dtype=np.float64)
        g = np.asarray(batch[grade], dtype=np.float64)
        ok = np.isfinite(c) & np.isfinite(g)
        if not ok.any():
            continue
        k = np.minimum(((c[ok] - lo) / band).astype(np.int64), n_bands - 1)
        np.add.at(sums, k, g[ok])
        np.add.at(counts, k, 1)
    with np.errstate(invalid="ignore"):
        mean = np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
    centers = lo + (np.arange(n_bands) + 0.5) * band
    return {"centers": centers, "mean": mean, "count": counts, "band": float(band)}
