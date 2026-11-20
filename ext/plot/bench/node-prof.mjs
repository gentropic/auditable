// Quick Node timings of plot's hot paths on the recording context (no browser) — for tuning.
//   node ext/plot/bench/node-prof.mjs
import { subplots } from '../src/api.js';
import { _rasterPoints } from '../src/raster.js';

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normals(n, seed) { const r = rng(seed), o = new Float64Array(n); for (let i = 0; i < n; i++) { const u = Math.max(r(), 1e-12), v = r(); o[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } return o; }
const t = (label, fn, reps = 3) => { const ms = []; for (let k = 0; k < reps; k++) { const t0 = performance.now(); fn(); ms.push(performance.now() - t0); } ms.sort((a, b) => a - b); console.log(label.padEnd(34), ms[reps >> 1].toFixed(1), 'ms'); };

const n = 1e6, x = normals(n, 1), y = normals(n, 2), c = new Float64Array(n);
for (let i = 0; i < n; i++) c[i] = x[i] * x[i] + y[i] * y[i];
const W = 734, H = 555;
const px = new Float32Array(n), py = new Float32Array(n), idx = new Int16Array(n);
for (let i = 0; i < n; i++) { px[i] = (x[i] + 4) / 8 * W; py[i] = (y[i] + 4) / 8 * H; idx[i] = Math.min(255, (c[i] * 20) | 0); }
const lut = new Uint8ClampedArray(1024).fill(200);
t('rasterPoints 1M r=1 lut', () => _rasterPoints(W, H, px, py, 0, 0, 1, 1, 'o', { lut, vals: c, vmin: 0, vk: 20 }, 1, null));
t('rasterPoints 1M r=1 uniform', () => _rasterPoints(W, H, px, py, 0, 0, 1, 1, 'o', { uniform: [10, 20, 30, 255] }, 1, null));
t('rasterPoints 1M r=3 alpha .3', () => _rasterPoints(W, H, px, py, 0, 0, 1, 3, 'o', { uniform: [10, 20, 30, 255] }, 0.3, null));
t('scatter 1M figure (record)', () => { const { fig, ax } = subplots(1, 1, { figsize: [800, 600] }); ax.scatter(x, y, { c, s: 1 }); fig.toDrawList(); });
const big = normals(1e7, 6);
t('hist 10M (record)', () => { const { fig, ax } = subplots(1, 1, { figsize: [800, 600] }); ax.hist(big, { bins: 100 }); fig.toDrawList(); });
const nx = 2000, z = new Float64Array(nx * nx);
for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = Math.sin(i / 97) * Math.cos(j / 61);
t('imshow 2000² (record)', () => { const { fig, ax } = subplots(1, 1, { figsize: [800, 600] }); ax.imshow(z, nx, nx); fig.toDrawList(); });
