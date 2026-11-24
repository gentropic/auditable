// @gcu/scan tasks — the per-unit jobs a Parquet model's open runs: the discovery
// summary of one row group, and its render decode. ZERO imports: condenser's
// coordNum, sizeCollector and putDimQ come in as `cd`, so the worker and the page
// read a coordinate and measure a block size by ONE definition (they were copies,
// three times over, embedded into the worker with toString()).

// a category value as its key: a blank (null, '', a NaN number) is the '' category
// of its own (not the first real category's code, which is what a miss falls to)
const catKey = (v) => (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v)) ? '' : String(v));

// ── discovery: what the open's sweep collects, for one row group ──────────────
// Merged in group order, exactly what a sequential sweep gives: per-axis distinct
// centroids rounded to 10 digits (capped), bbox, the category values (capped at
// 257), the block sizes (a sizeCollector snapshot — condenser grid/support.js),
// and the first `res` valid centroids.
export function discoverGroup(cd, p, cols, count, res) {
  const cn = cd.coordNum, r10 = (v) => Number(v.toPrecision(10));
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], C = p.catN ? cols[p.catN] : null;
  const DX = p.dN ? cols[p.dN[0]] : null, DY = p.dN ? cols[p.dN[1]] : null, DZ = p.dN ? cols[p.dN[2]] : null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const ax = [new Set(), new Set(), new Set()], seen = [new Set(), new Set(), new Set()];
  const cats = C ? new Set() : null, sizes = DX ? cd.sizeCollector() : null;
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
    if (cats && cats.size <= 256) cats.add(catKey(C[i]));   // a blank is its own category, ''
    if (sizes) sizes.add(+DX[i], +DY[i], +DZ[i]);
  }
  return {
    valid, min, max, ax: ax.map((s) => [...s]),
    cats: cats ? [...cats] : null, sizes: sizes ? sizes.toJSON() : null,
    res: out ? out.subarray(0, nres * 3) : null,
  };
}

// ── check: the first centroid in one group off a declared lattice ─────────────
// p = { cols: [x, y, z], grid }; records RAW (start + i) → a misfit message or null
export function checkGroup(cd, p, cols, start, count) {
  const X = cols[p.cols[0]], Y = cols[p.cols[1]], Z = cols[p.cols[2]], cn = cd.coordNum;
  let bad = null;
  for (let i = 0; i < count && !bad; i++) { const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]); if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) bad = cd.latticeMisfit(p.grid, xv, yv, zv, start + i); }
  return bad;
}

// ── decode: one row group as the chunk builder's typed arrays ─────────────────
// the code maps a decode job's params name (built once per worker, or per job on the page)
export function decodeCodes(p) {
  return {
    cat: p.categories ? new Map(p.categories.map((v, i) => [v, i])) : null,
  };
}
// codes = { cat: Map(value → code) | null }; p.pitch = the fine lattice's pitch when
// sub-blocked (sizes → dimQ, fine steps). A row without a usable centroid isn't
// drawn; record numbers stay RAW.
export function decodeGroup(cd, p, cols, start, count, codes) {
  const cn = cd.coordNum;
  const X = cols[p.xN], Y = cols[p.yN], Z = cols[p.zN], CH = p.chanN ? cols[p.chanN] : null, CA = p.catN ? cols[p.catN] : null;
  const DX = p.sizeN ? cols[p.sizeN[0]] : null, DY = p.sizeN ? cols[p.sizeN[1]] : null, DZ = p.sizeN ? cols[p.sizeN[2]] : null;
  const x = new Float64Array(count), y = new Float64Array(count), z = new Float64Array(count), chan = new Float64Array(count);
  const cat = codes.cat ? new Uint8Array(count) : null, dimQ = DX && p.pitch ? new Uint8Array(3 * count) : null, recIdx = new Uint32Array(count);
  let m = 0;
  for (let i = 0; i < count; i++) {
    const xv = cn(X[i]), yv = cn(Y[i]), zv = cn(Z[i]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(zv)) continue;
    x[m] = xv; y[m] = yv; z[m] = zv;
    chan[m] = CH ? (CH[i] == null ? NaN : +CH[i]) : 0;    // a null grade is missing (NaN), not 0
    if (cat) cat[m] = codes.cat.get(catKey(CA[i])) ?? 0;
    if (dimQ) cd.putDimQ(dimQ, m, +DX[i], +DY[i], +DZ[i], p.pitch);
    recIdx[m++] = start + i;
  }
  // trimmed copies, not views: the transfer list moves whole buffers
  const cut = (a) => (a && m < count ? a.slice(0, m) : a);
  return { count: m, x: cut(x), y: cut(y), z: cut(z), chan: cut(chan), cat: cut(cat), dimQ: dimQ && m < count ? dimQ.slice(0, 3 * m) : dimQ, recIdx: cut(recIdx), recStart: start };
}
