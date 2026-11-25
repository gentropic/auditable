// micro grid ops — the pure grid kernel: lattice cover/alignment, empty-grid /
// empty-block-model builders, mesh→grid rasterization, nodata fills, and the
// bilinear surface sampler. No DOM, no renderer — the app wires these to
// layers/dialogs; test/grid-join.test.mjs-style logic lives at this altitude.
//
// ROTATED GRIDS: a grid's nodes sit on its OWN lattice (x0, y0, dx, dy — axis-aligned in
// the grid's frame) and an optional `place` (a compiled placement { R, s, t },
// src/placement-core.js) takes that frame to world: world = t + s·R·(u, v, value). A grid
// used as a SURFACE takes a rotation about Z only (a heightfield stays z = f(x, y));
// everything that samples one samples in the grid's own frame (gridLocalXY).
import { invertP, zOnlyP, applyP } from './placement-core.js';

// snap an axis to anchor's phase so it covers [lo, hi]; half = half-cell inset
export function alignAxis(anchor, lo, hi, step, half) {
  let o = anchor + Math.round((lo - anchor) / step) * step;   // in-phase, nearest lo
  while (o - half > lo + 1e-6) o -= step;                     // step out until it covers lo
  let n = 1;
  while (o + (n - 1) * step + half < hi - 1e-6) n++;          // grow until it covers hi
  return { min: o, n: Math.max(1, n) };
}
// origin + counts for a grid / block model covering bbox bb, optionally phased
// to d.ax/d.ay/d.az. Shared by the tally and the builder so they never drift.
export function coverGeometry(d, bb) {
  const isBM = d.type === 'block';
  const sx = d.dx, sy = isBM ? d.dy : d.dx, sz = d.dz;
  if (d.align) {
    const hx = isBM ? sx / 2 : 0, hy = isBM ? sy / 2 : 0, hz = sz / 2;
    const X = alignAxis(d.ax, bb[0], bb[3], sx, hx);
    const Y = alignAxis(d.ay, bb[1], bb[4], sy, hy);
    const nx = X.n, ny = Y.n;
    // grid rows descend from y0=top; the node set is the same either way, so
    // y0 = the highest in-phase node (Y.min + (ny−1)·sy)
    const x0 = X.min, y0 = isBM ? Y.min : Y.min + (ny - 1) * sy;
    if (isBM) { const Z = alignAxis(d.az, bb[2], bb[5], sz, hz); return { x0, y0, z0: Z.min, nx, ny, nz: Z.n }; }
    return { x0, y0, z0: 0, nx, ny, nz: 1 };
  }
  const nx = Math.max(1, Math.floor((bb[3] - bb[0]) / sx) + 1);
  const ny = Math.max(1, Math.floor((bb[4] - bb[1]) / sy) + 1);
  const nz = isBM ? Math.max(1, Math.floor((bb[5] - bb[2]) / sz) + 1) : 1;
  return { x0: isBM ? bb[0] + sx / 2 : bb[0], y0: isBM ? bb[1] + sy / 2 : bb[4], z0: bb[2] + sz / 2, nx, ny, nz };
}
export function buildEmptyGrid({ x0, y0, dx, nx, ny, fill = 0 }) {
  return { nx, ny, x0, y0, dx, dy: dx, data: new Float32Array(nx * ny).fill(fill), nodata: -9999, crs: null, form: 'empty' };
}
// an empty regular block model as a CSV blob (XC,YC,ZC + one constant column);
// x0/y0/z0 are the block-0 CENTRE. Chunked so a big lattice keeps the UI alive.
export async function buildEmptyBlockCsv({ x0, y0, z0, dx, dy, dz, nx, ny, nz, fill = 0, valName = 'VAL', onProgress = null }) {
  const parts = [`XC,YC,ZC,${valName}\n`];
  let buf = '';
  const total = nz;
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * dz;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * dy;
      for (let i = 0; i < nx; i++) buf += `${x0 + i * dx},${y},${z},${fill}\n`;
    }
    if (buf.length > (1 << 22)) { parts.push(buf); buf = ''; }
    if (onProgress && (k & 7) === 0) { onProgress((k + 1) / total); await new Promise((r) => setTimeout(r)); }
  }
  if (buf) parts.push(buf);
  return new Blob(parts, { type: 'text/csv' });
}
// rasterize a mesh onto a grid by PLAN projection: each triangle projects onto
// the grid's XY plane, and every node inside its 2D footprint takes the plane's
// barycentric-interpolated Z. Overlaps (overhangs) z-buffer — 'top' keeps the
// upper surface, 'bottom' the lower. O(Σ triangle footprints) ≈ O(nodes) for a
// surface; no BVH, no per-node ray. Yields periodically to keep the UI live.
export async function rasterizeMeshToGrid(V, T, { x0, y0, dx, dy, nx, ny, nodata = -9999, keep = 'top', onProgress = null } = {}) {
  const data = new Float32Array(nx * ny).fill(nodata);
  const better = keep === 'bottom' ? (cur, z) => z < cur : (cur, z) => z > cur;
  const nt = T.length / 3;
  for (let t = 0; t < T.length; t += 3) {
    const i0 = T[t] * 3, i1 = T[t + 1] * 3, i2 = T[t + 2] * 3;
    const az = V[i0 + 2], bz = V[i1 + 2], cz = V[i2 + 2];
    // world → fractional grid index (col = (x−x0)/dx, row = (y0−y)/dy)
    const acol = (V[i0] - x0) / dx, arow = (y0 - V[i0 + 1]) / dy;
    const bcol = (V[i1] - x0) / dx, brow = (y0 - V[i1 + 1]) / dy;
    const ccol = (V[i2] - x0) / dx, crow = (y0 - V[i2 + 1]) / dy;
    const den = (brow - crow) * (acol - ccol) + (ccol - bcol) * (arow - crow);
    if (den === 0) continue;                                // degenerate in plan
    const inv = 1 / den;
    const minc = Math.max(0, Math.floor(Math.min(acol, bcol, ccol)));
    const maxc = Math.min(nx - 1, Math.ceil(Math.max(acol, bcol, ccol)));
    const minr = Math.max(0, Math.floor(Math.min(arow, brow, crow)));
    const maxr = Math.min(ny - 1, Math.ceil(Math.max(arow, brow, crow)));
    for (let r = minr; r <= maxr; r++) {
      for (let c = minc; c <= maxc; c++) {
        const w1 = ((brow - crow) * (c - ccol) + (ccol - bcol) * (r - crow)) * inv;
        const w2 = ((crow - arow) * (c - ccol) + (acol - ccol) * (r - crow)) * inv;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
        const z = w1 * az + w2 * bz + w3 * cz;
        const idx = r * nx + c;
        if (data[idx] === nodata || better(data[idx], z)) data[idx] = z;
      }
    }
    if (onProgress && ((t / 3) & 0x3FFF) === 0) { onProgress((t / 3) / nt); await new Promise((res) => setTimeout(res)); }
  }
  return { nx, ny, data, x0, y0, dx, dy, nodata, crs: null, form: 'rasterized' };
}
// mark EXTERIOR nodata (reachable from the grid border through nodata) so
// "holes only" can leave beyond-the-edge unfilled. 4-connected BFS.
export function markGridExterior(data, nx, ny, isNodata) {
  const ext = new Uint8Array(nx * ny);
  const q = new Int32Array(nx * ny);
  let head = 0, tail = 0;
  const push = (i) => { if (!ext[i] && isNodata(data[i])) { ext[i] = 1; q[tail++] = i; } };
  for (let c = 0; c < nx; c++) { push(c); push((ny - 1) * nx + c); }
  for (let r = 0; r < ny; r++) { push(r * nx); push(r * nx + nx - 1); }
  while (head < tail) {
    const i = q[head++], r = (i / nx) | 0, c = i % nx;
    if (c > 0) push(i - 1); if (c < nx - 1) push(i + 1);
    if (r > 0) push(i - nx); if (r < ny - 1) push(i + nx);
  }
  return ext;
}
// NEAREST fill: multi-source BFS (grassfire) — each empty node inherits its
// nearest filled node's value (flat / Voronoi extension). target restricts.
export function fillGridNearest(grid, isNodata, target) {
  const { nx, ny, data } = grid, N = nx * ny;
  const src = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  for (let i = 0; i < N; i++) if (!isNodata(data[i])) { src[i] = i; q[tail++] = i; }
  const want = (j) => src[j] < 0 && isNodata(data[j]) && (!target || target[j]);
  while (head < tail) {
    const i = q[head++], r = (i / nx) | 0, c = i % nx;
    if (c > 0 && want(i - 1)) { src[i - 1] = src[i]; q[tail++] = i - 1; }
    if (c < nx - 1 && want(i + 1)) { src[i + 1] = src[i]; q[tail++] = i + 1; }
    if (r > 0 && want(i - nx)) { src[i - nx] = src[i]; q[tail++] = i - nx; }
    if (r < ny - 1 && want(i + nx)) { src[i + nx] = src[i]; q[tail++] = i + nx; }
  }
  const out = Float32Array.from(data);
  for (let i = 0; i < N; i++) if (isNodata(data[i]) && src[i] >= 0) out[i] = data[src[i]];
  return out;
}
// PLANAR TREND fill: least-squares plane z = a·x + b·y + c through the filled
// nodes (LOCAL indices, well-conditioned), evaluated at the empties — continues
// the regional dip outward.
export function fillGridTrend(grid, isNodata, target) {
  const { nx, ny, data } = grid;
  let n = 0, Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const v = data[r * nx + c]; if (isNodata(v)) continue;
    n++; Sx += c; Sy += r; Sz += v; Sxx += c * c; Sxy += c * r; Syy += r * r; Sxz += c * v; Syz += r * v;
  }
  if (n < 3) return data;
  const det = Sxx * (Syy * n - Sy * Sy) - Sxy * (Sxy * n - Sy * Sx) + Sx * (Sxy * Sy - Syy * Sx);
  if (Math.abs(det) < 1e-9) return data;
  const a = (Sxz * (Syy * n - Sy * Sy) - Sxy * (Syz * n - Sy * Sz) + Sx * (Syz * Sy - Syy * Sz)) / det;
  const b = (Sxx * (Syz * n - Sy * Sz) - Sxz * (Sxy * n - Sy * Sx) + Sx * (Sxy * Sz - Syz * Sx)) / det;
  const cc = (Sxx * (Syy * Sz - Syz * Sy) - Sxy * (Sxy * Sz - Syz * Sx) + Sxz * (Sxy * Sy - Syy * Sx)) / det;
  const out = Float32Array.from(data);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const i = r * nx + c; if (isNodata(data[i]) && (!target || target[i])) out[i] = a * c + b * r + cc; }
  return out;
}
export function applyGridExtend(grid, method, holesOnly) {
  if (!method || method === 'none') return grid;
  const { nx, ny, data, nodata } = grid;
  const isNodata = (v) => Number.isNaN(v) || v === nodata;
  let target = null;
  if (holesOnly) {
    const ext = markGridExterior(data, nx, ny, isNodata);
    target = new Uint8Array(nx * ny);
    for (let i = 0; i < nx * ny; i++) target[i] = isNodata(data[i]) && !ext[i] ? 1 : 0;
  }
  grid.data = method === 'trend' ? fillGridTrend(grid, isNodata, target) : fillGridNearest(grid, isNodata, target);
  return grid;
}
// WORLD (x,y) → surface Z sampler over a gridDoc grid; NaN off-grid; bilinear,
// degrading to the mean of the valid corners at a nodata edge. A rotated grid
// (g.place) is sampled in its own frame: (x, y) → (u, v), z = t_z + s·value.
export function surfaceFromGrid(g) {
  const nod = g.nodata;
  const isBad = (v) => Number.isNaN(v) || (nod != null && (nod >= 1.7e38 ? v >= 1.7014e38 : v === nod));
  const toLocal = gridLocalXY(g);
  const zs = g.place ? g.place.s : 1, zt = g.place ? g.place.t[2] : 0;
  const sampleLocal = (x, y) => {
    const fc = (x - g.x0) / g.dx, fr = (g.y0 - y) / g.dy;
    if (fc < 0 || fr < 0 || fc > g.nx - 1 || fr > g.ny - 1) return NaN;
    const c0 = Math.floor(fc), r0 = Math.floor(fr);
    const c1 = Math.min(c0 + 1, g.nx - 1), r1 = Math.min(r0 + 1, g.ny - 1);
    const tx = fc - c0, ty = fr - r0;
    const v00 = g.data[r0 * g.nx + c0], v10 = g.data[r0 * g.nx + c1], v01 = g.data[r1 * g.nx + c0], v11 = g.data[r1 * g.nx + c1];
    if (isBad(v00) || isBad(v10) || isBad(v01) || isBad(v11)) {
      let sum = 0, k = 0;
      for (const v of [v00, v10, v01, v11]) if (!isBad(v)) { sum += v; k++; }
      return k ? sum / k : NaN;
    }
    return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
  };
  const q = [0, 0];
  const sampleZ = toLocal ? (x, y) => { toLocal(x, y, q); const v = sampleLocal(q[0], q[1]); return zt + zs * v; } : sampleLocal;
  return { grid: g, sampleZ, sampleLocal };
}
// world (x, y) → the grid's own frame (u, v), or null for an unplaced grid (the identity).
// A grid tilted out of the horizontal is a sheet, not a surface: it has no z = f(x, y).
export function gridLocalXY(g) {
  const M = g && g.place;
  if (!M) return null;
  if (!zOnlyP(M)) throw new Error('this grid is tilted out of the horizontal — a sheet, not a surface: it has no z = f(x, y) to sample');
  const c = M.R[0], sn = M.R[1], si = 1 / M.s, tx = M.t[0], ty = M.t[1];
  return (x, y, out = [0, 0]) => { const dx = x - tx, dy = y - ty; out[0] = si * (c * dx + sn * dy); out[1] = si * (-sn * dx + c * dy); return out; };
}
// a node (row r, column c) in WORLD: [x, y, z]
export function gridNodeWorld(g, r, c, out = [0, 0, 0]) {
  const u = g.x0 + c * g.dx, v = g.y0 - r * g.dy, w = g.data ? g.data[r * g.nx + c] : 0;
  return applyP(g.place || null, u, v, w, out);
}
// the grid's node extent in world, [minX, minY, maxX, maxY] (a rotated grid's AABB)
export function gridWorldBbox4(g) {
  const u0 = g.x0, u1 = g.x0 + (g.nx - 1) * g.dx, v1 = g.y0, v0 = g.y0 - (g.ny - 1) * (g.dy || g.dx);
  if (!g.place) return [u0, v0, u1, v1];
  const o = [0, 0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) { applyP(g.place, u, v, 0, o); if (o[0] < x0) x0 = o[0]; if (o[0] > x1) x1 = o[0]; if (o[1] < y0) y0 = o[1]; if (o[1] > y1) y1 = o[1]; }
  return [x0, y0, x1, y1];
}
// a WORLD bbox4 → the grid's own frame (the AABB of its corners there) — what a windowed
// read of a rotated grid's source asks for
export function worldBbox4ToGridLocal(g, bb) {
  if (!g.place || !bb) return bb;
  const inv = invertP(g.place), o = [0, 0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) { applyP(inv, x, y, 0, o); if (o[0] < x0) x0 = o[0]; if (o[0] > x1) x1 = o[0]; if (o[1] < y0) y0 = o[1]; if (o[1] > y1) y1 = o[1]; }
  return [x0, y0, x1, y1];
}
// a rotated grid resampled onto an AXIS-ALIGNED lattice over its world extent at the same cell —
// for the formats that can't say a rotation (ESRI ASCII, Surfer). Bilinear, through surfaceFromGrid.
export function resampleAxisAligned(g, { nodata = -9999 } = {}) {
  if (!g.place) return g;
  const bb = gridWorldBbox4(g), cell = g.dx * g.place.s;
  const nx = Math.max(1, Math.round((bb[2] - bb[0]) / cell) + 1), ny = Math.max(1, Math.round((bb[3] - bb[1]) / cell) + 1);
  const x0 = bb[0], y0 = bb[1] + (ny - 1) * cell, data = new Float32Array(nx * ny), s = surfaceFromGrid(g);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const z = s.sampleZ(x0 + c * cell, y0 - r * cell); data[r * nx + c] = Number.isFinite(z) ? z : nodata; }
  return { nx, ny, x0, y0, dx: cell, dy: cell, data, nodata, crs: g.crs || null, form: `${g.form || 'grid'} · resampled axis-aligned` };
}
// ── AS-BUILT: point cloud → DEM, and cut / fill between two surfaces ──────────
// A NODE lattice covering the XY bbox [minX, minY, maxX, maxY] at cell `dx`, its
// nodes passing through `anchor` ([ax, ay]; default [0, 0] — nodes at round
// multiples of the cell, so two surveys gridded at one cell share a lattice and
// compare node for node). → { x0, y0 (the TOP row), dx, dy, nx, ny }
export function latticeForBbox(bb, dx, anchor = [0, 0]) {
  const X = alignAxis(+anchor[0] || 0, bb[0], bb[2], dx, dx / 2);   // a node owns the cell ±dx/2 about it
  const Y = alignAxis(+anchor[1] || 0, bb[1], bb[3], dx, dx / 2);
  return { x0: X.min, y0: Y.min + (Y.n - 1) * dx, dx, dy: dx, nx: X.n, ny: Y.n };
}
// The point → node binner: each point lands on its NEAREST node (the cell is
// centred on the node — the ESRI convention micro reads and writes), and the node
// keeps the statistic of the Z that landed there: min (ground under vegetation),
// max (canopy, a stockpile's crest), mean, or count (point density). One pass,
// O(1) per point and O(nodes) memory — the cloud itself is never held.
//   const b = makePointBinner(geom, 'min'); b.add(x, y, z, n); … ; b.finish() → grid
export const PC_STATS = ['min', 'mean', 'max', 'count'];
export function makePointBinner(geom, stat = 'mean', { nodata = -9999 } = {}) {
  if (!PC_STATS.includes(stat)) throw new Error(`statistic: one of ${PC_STATS.join(' / ')}`);
  const { x0, y0, dx, nx, ny } = geom, dy = geom.dy || dx, N = nx * ny;
  const cnt = new Uint32Array(N);
  const acc = stat === 'mean' ? new Float64Array(N) : stat === 'count' ? null : new Float64Array(N).fill(stat === 'min' ? Infinity : -Infinity);
  let points = 0, outside = 0, skipped = 0;
  const ix = 1 / dx, iy = 1 / dy;
  return {
    geom,
    // xs/ys/zs: typed arrays (or plain), n of them; keep(i) — optional, false skips point i
    add(xs, ys, zs, n, keep = null) {
      for (let i = 0; i < n; i++) {
        if (keep && !keep(i)) { skipped++; continue; }
        const x = xs[i], y = ys[i], z = zs[i];
        if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { skipped++; continue; }
        const c = Math.round((x - x0) * ix), r = Math.round((y0 - y) * iy);
        if (c < 0 || c >= nx || r < 0 || r >= ny) { outside++; continue; }
        const k = r * nx + c;
        cnt[k]++; points++;
        if (stat === 'mean') acc[k] += z;
        else if (stat === 'min') { if (z < acc[k]) acc[k] = z; }
        else if (stat === 'max') { if (z > acc[k]) acc[k] = z; }
      }
    },
    finish() {
      const data = new Float32Array(N);
      let filled = 0;
      for (let k = 0; k < N; k++) {
        const m = cnt[k];
        if (!m) { data[k] = stat === 'count' ? 0 : nodata; continue; }
        filled++;
        data[k] = stat === 'count' ? m : stat === 'mean' ? acc[k] / m : acc[k];
      }
      return { grid: { nx, ny, x0, y0, dx, dy, data, nodata, crs: null, form: `points-${stat}` }, points, outside, skipped, filled, empty: N - filled };
    },
  };
}
// a mesh's plan footprint sampled sub × sub times inside each node's cell (the cell centred on
// the node): sub = 4, or 2 / none on big lattices (≤ 16M samples). → { sub, hits } | null
export async function meshCoverSamples(V, T, geom) {
  const N = geom.nx * geom.ny, dy = geom.dy || geom.dx;
  const sub = N * 16 <= 16e6 ? 4 : N * 4 <= 16e6 ? 2 : 0;
  if (!sub) return null;
  const f = await rasterizeMeshToGrid(V, T, {
    x0: geom.x0 - geom.dx / 2 + geom.dx / (2 * sub), y0: geom.y0 + dy / 2 - dy / (2 * sub),
    dx: geom.dx / sub, dy: dy / sub, nx: geom.nx * sub, ny: geom.ny * sub, keep: 'top',
  });
  const hits = new Uint8Array(f.data.length);
  for (let i = 0; i < hits.length; i++) hits[i] = f.data[i] !== f.nodata ? 1 : 0;
  return { sub, hits };
}

// combine surfaces' covers (AND per sample — the part of each node's cell where EVERY surface
// exists) into per-node weights 0..1; null when no surface brought a cover (all grids)
export function coverWeights(covers, nx, ny) {
  const cs = covers.filter(Boolean);
  if (!cs.length) return null;
  const sub = cs[0].sub;
  if (cs.some((c) => c.sub !== sub)) return null;
  const w = new Float32Array(nx * ny), fnx = nx * sub, s2 = sub * sub;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    let n = 0;
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      const k = (r * sub + i) * fnx + c * sub + j;
      let all = 1; for (const cv of cs) if (!cv.hits[k]) { all = 0; break; }
      n += all;
    }
    w[r * nx + c] = n / s2;
  }
  return w;
}

// The common lattice of two surfaces for a cut / fill: over the OVERLAP of their XY
// extents, at the finer one's cell and node phase (so the finer grid is sampled at
// its own nodes, never re-interpolated), or at a stated cell (phase still the finer
// grid's). a, b: { x0, y0, dx, nx, ny } (a mesh passes its bbox-derived pseudo
// lattice). → geom | null (the extents don't overlap)
export function commonSurfaceLattice(a, b, cell = null) {
  // a rotated surface contributes its world extent and its world cell (it is sampled, never
  // node-for-node: the common lattice is axis-aligned, on the unrotated one's phase if any)
  const bbOf = (g) => (g.place ? gridWorldBbox4(g) : [g.x0, g.y0 - (g.ny - 1) * (g.dy || g.dx), g.x0 + (g.nx - 1) * g.dx, g.y0]);
  const A = bbOf(a), B = bbOf(b);
  const bb = [Math.max(A[0], B[0]), Math.max(A[1], B[1]), Math.min(A[2], B[2]), Math.min(A[3], B[3])];
  if (!(bb[2] >= bb[0] && bb[3] >= bb[1])) return null;
  const cellOf = (g) => (g.place ? g.dx * g.place.s : g.dx);
  const fine0 = cellOf(a) <= cellOf(b) ? a : b;
  const fine = fine0.place ? { x0: (a.place ? b : a).place ? bb[0] : (a.place ? b : a).x0, y0: (a.place ? b : a).place ? bb[3] : (a.place ? b : a).y0, dx: cellOf(fine0) } : fine0;
  const dx = cell && cell > 0 ? cell : fine.dx;
  // nodes INSIDE the overlap (a node outside one grid's extent has no value there)
  const inward = (anchor, lo, hi) => {
    let o = anchor + Math.ceil((lo - anchor) / dx - 1e-9) * dx;
    let n = Math.floor((hi - o) / dx + 1e-9) + 1;
    if (n < 1) { o = lo; n = 1; }
    return { o, n };
  };
  const X = inward(fine.x0, bb[0], bb[2]), Y = inward(fine.y0, bb[1], bb[3]);
  return { x0: X.o, y0: Y.o + (Y.n - 1) * dx, dx, dy: dx, nx: X.n, ny: Y.n };
}
// Cut / fill: two height grids ON ONE LATTICE (before, after) → the Δz grid
// (after − before; negative = cut, material removed; positive = fill) and the
// volumes, each node standing for a dx × dy cell (the midpoint rule — exact for a
// Δz that is linear across each cell). Nodes where either surface is empty sit out.
// weights (optional, per node, 0..1): the share of each node's cell that counts — a polygon
// PERIMETER's coverage (src/coverage.js); a node with weight 0 sits out, a cut cell counts in part.
// → { dz: grid, cut, fill, net (fill − cut), area, cutArea, fillArea, nodes, hist }
export function cutFillGrids(before, after, { bins = 40, nodata = -9999, weights = null } = {}) {
  const { nx, ny, dx } = before, dy = before.dy || dx, N = nx * ny, cellA = dx * dy;
  if (after.nx !== nx || after.ny !== ny) throw new Error('cut / fill: the two grids are on different lattices');
  const bad = (g) => { const nd = g.nodata; return (v) => Number.isNaN(v) || (nd != null && v === nd); };
  const badA = bad(before), badB = bad(after);
  const data = new Float32Array(N).fill(nodata);
  let cut = 0, fill = 0, n = 0, nCut = 0, nFill = 0, lo = Infinity, hi = -Infinity;
  for (let k = 0; k < N; k++) {
    const a = before.data[k], b = after.data[k];
    if (badA(a) || badB(b)) continue;
    const wk = weights ? weights[k] : 1;
    if (!(wk > 0)) continue;
    const d = b - a;
    data[k] = d; n += wk;
    if (d < 0) { cut -= d * wk; nCut += wk; } else if (d > 0) { fill += d * wk; nFill += wk; }
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  cut *= cellA; fill *= cellA;
  // a histogram of Δz by VOLUME (what each Δz band moved) — symmetric about 0, so cut and fill read
  // on one axis
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1, w = (2 * m) / bins;
  const vol = new Float64Array(bins);
  if (n) for (let k = 0; k < N; k++) { if (badA(before.data[k]) || badB(after.data[k])) continue; const wk = weights ? weights[k] : 1; if (!(wk > 0)) continue; const d = data[k], i = Math.min(bins - 1, Math.max(0, Math.floor((d + m) / w))); vol[i] += Math.abs(d) * cellA * wk; }
  return {
    dz: { nx, ny, x0: before.x0, y0: before.y0, dx, dy, data, nodata, crs: null, form: 'cutfill' },
    cut, fill, net: fill - cut, area: n * cellA, cutArea: nCut * cellA, fillArea: nFill * cellA, nodes: weights ? (() => { let c = 0; for (let k = 0; k < N; k++) if (data[k] !== nodata) c++; return c; })() : n,
    range: n ? [lo, hi] : [0, 0], hist: { lo: -m, w, vol: Array.from(vol) },
  };
}

// a BLOCK MODEL's regular lattice (origin/pitch/count per axis), when it has one.
// A ROTATED model's axes are LATTICE coordinates and carry rot + anchor
// (condenser grid/basis.js) — the grid-join engine compares two such grids
// only when they share a basis, and anything mapping world points onto the
// axes goes through latticeMapOf.
export function gridAxesOf(L) {
  const g = L && L.docs && L.docs.blockDoc && L.docs.blockDoc.header && L.docs.blockDoc.header.grid;
  if (!g || !g.x || g.x.pitch == null) return null;
  const out = { x: { origin: g.x.origin, pitch: g.x.pitch, count: g.x.count }, y: { origin: g.y.origin, pitch: g.y.pitch, count: g.y.count }, z: { origin: g.z.origin, pitch: g.z.pitch, count: g.z.count } };
  if (g.rot) { out.rot = g.rot; out.anchor = g.anchor; }
  return out;
}
