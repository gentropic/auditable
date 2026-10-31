// @gcu/scan tasks — the per-unit jobs a Parquet model's open runs: the discovery
// summary of one row group, and its render decode. ZERO imports: condenser's
// coordNum and dimKey come in as `cd`, so the worker and the page read a
// coordinate and key a block size by ONE definition (they were copies, three
// times over, embedded into the worker with toString()).

// ── discovery: what the open's sweep collects, for one row group ──────────────
// Merged in group order, exactly what a sequential sweep gives: per-axis distinct
// centroids rounded to 10 digits (capped), bbox, the category values (capped at
// 257), the smallest size per axis and the distinct size keys, and the first
// `res` valid centroids.
export function discoverGroup(cd, p, cols, count, res) {
  const cn = cd.coordNum, r10 = (v) => Number(v.toPrecision(10));
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], C = p.catN ? cols[p.catN] : null;
  const DX = p.dN ? cols[p.dN[0]] : null, DY = p.dN ? cols[p.dN[1]] : null, DZ = p.dN ? cols[p.dN[2]] : null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const ax = [new Set(), new Set(), new Set()], seen = [new Set(), new Set(), new Set()];
  const cats = C ? new Set() : null, dims = DX ? new Set() : null, minDim = [Infinity, Infinity, Infinity];
  const out = res > 0 ? new Float64Array(res * 3) : null;
  let nres = 0, valid = 0;
  const add = (a, v) => {
    if (ax[a].size >= p.cap) return;
    const s = seen[a];
    if (s.size < p.cap * 4) { if (s.has(v)) return; s.add(v); }
    ax[a].add(r10(v));
  };
  for (let i = 0; i < count; i++) {
    const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    valid++;
    if (xv < min[0]) min[0] = xv; if (xv > max[0]) max[0] = xv;
    if (yv < min[1]) min[1] = yv; if (yv > max[1]) max[1] = yv;
    if (zv < min[2]) min[2] = zv; if (zv > max[2]) max[2] = zv;
    add(0, xv); add(1, yv); add(2, zv);
    if (nres < res) { out[nres * 3] = xv; out[nres * 3 + 1] = yv; out[nres * 3 + 2] = zv; nres++; }
    if (cats && cats.size <= 256) { const v = C[i]; if (v != null && v !== '') cats.add(String(v)); }
    if (DX) {
      const dx = +DX[i], dy = +DY[i], dz = +DZ[i];
      if (dx > 0 && dy > 0 && dz > 0) {
        if (dx < minDim[0]) minDim[0] = dx; if (dy < minDim[1]) minDim[1] = dy; if (dz < minDim[2]) minDim[2] = dz;
        if (dims.size <= p.dimMax) dims.add(cd.dimKey(dx, dy, dz));
      }
    }
  }
  return {
    valid, min, max, ax: ax.map((s) => [...s]),
    cats: cats ? [...cats] : null, dims: dims ? [...dims] : null, minDim,
    res: out ? out.subarray(0, nres * 3) : null,
  };
}

// ── decode: one row group as the chunk builder's typed arrays ─────────────────
// codes = { cat: Map(value → code) | null, dim: Map(dimKey → palette index) | null }.
// A row without a usable centroid isn't drawn; record numbers stay RAW.
export function decodeGroup(cd, p, cols, start, count, codes) {
  const cn = cd.coordNum;
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], CH = p.chanN ? cols[p.chanN] : null, CA = p.catN ? cols[p.catN] : null;
  const DX = p.sizeN ? cols[p.sizeN[0]] : null, DY = p.sizeN ? cols[p.sizeN[1]] : null, DZ = p.sizeN ? cols[p.sizeN[2]] : null;
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
  const cat = codes.cat ? new Uint8Array(count) : null, dim = codes.dim ? new Uint8Array(count) : null, recIdx = new Uint32Array(count);
  const memo = new Map();
  const dimCode = (dx, dy, dz) => {
    let my = memo.get(dx); if (!my) memo.set(dx, my = new Map());
    let mz = my.get(dy); if (!mz) my.set(dy, mz = new Map());
    let c = mz.get(dz); if (c === undefined) mz.set(dz, c = codes.dim.get(cd.dimKey(dx, dy, dz)) ?? 0);
    return c;
  };
  let m = 0;
  for (let i = 0; i < count; i++) {
    const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    x[m] = xv; y[m] = yv; z[m] = zv;
    chan[m] = CH ? (CH[i] == null ? NaN : +CH[i]) : 0;    // a null grade is missing (NaN), not 0
    if (cat) cat[m] = codes.cat.get(String(CA[i] ?? '')) ?? 0;
    if (dim) dim[m] = dimCode(+DX[i], +DY[i], +DZ[i]);
    recIdx[m++] = start + i;
  }
  // trimmed copies, not views: the transfer list moves whole buffers
  const cut = (a) => (a && m < count ? a.slice(0, m) : a);
  return { count: m, x: cut(x), y: cut(y), z: cut(z), chan: cut(chan), cat: cut(cat), dim: cut(dim), recIdx: cut(recIdx), recStart: start };
}
