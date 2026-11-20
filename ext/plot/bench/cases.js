// @gcu/plot bench cases — run in a browser page by bench/run.mjs, one case per fresh page.
// Each case builds its data first (untimed, seeded so every run draws the same thing), then
// times the figure work. `mode` is 'canvas' (fig.draw on a real 2D context) or 'record'
// (fig.toDrawList(), the no-DOM path). The spec's targets are in BENCH.md.

// mulberry32: a small seeded PRNG, so a case's data is identical run to run
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(n, seed) {
  const r = rng(seed), out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(r(), 1e-12), v = r(), m = Math.sqrt(-2 * Math.log(u));
    out[i] = m * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  return out;
}

const W = 800, H = 600;
// s = 2.07 points² is a 2 px marker at the figure's dpi 100 (diameter √s · 100/72 px)
const now = () => performance.now();

// time one draw of `fig` in the given mode; returns ms (and ops for recording)
function drawOnce(fig, mode) {
  if (mode === 'record') {
    const t0 = now(); const list = fig.toDrawList(); const ms = now() - t0;
    return { ms, ops: list.ops.length };
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const t0 = now(); fig.draw(ctx); ctx.getImageData(0, 0, 1, 1); const ms = now() - t0;   // the read forces the raster to finish
  return { ms };
}

// draw twice on the same figure: the first draw, then the same view again
function firstAndAgain(fig, mode) {
  const a = drawOnce(fig, mode);
  const b = drawOnce(fig, mode);
  return { first: a.ms, again: b.ms, ops: a.ops };
}

export const CASES = {
  async trivial(P, mode) {
    const t0 = now();
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.plot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 3, 2, 5, 4, 6, 5, 8, 7, 9]);
    ax.set_title('trivial');
    const d = drawOnce(fig, mode);
    return { first: now() - t0, ops: d.ops };
  },
  async scatter_1M(P, mode) {
    const n = 1e6, x = normals(n, 1), y = normals(n, 2), c = new Float64Array(n);
    for (let i = 0; i < n; i++) c[i] = x[i] * x[i] + y[i] * y[i];
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.scatter(x, y, { c, s: 2.07, cmap: 'viridis' });
    return firstAndAgain(fig, mode);
  },
  async scatter_500k(P, mode) {
    const n = 5e5, x = normals(n, 3), y = normals(n, 4), c = new Float64Array(n);
    for (let i = 0; i < n; i++) c[i] = x[i] - y[i];
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.scatter(x, y, { c, s: 2.07, cmap: 'viridis' });
    return firstAndAgain(fig, mode);
  },
  async line_1M(P, mode) {
    const n = 1e6, x = new Float64Array(n), y = new Float64Array(n), e = normals(n, 5);
    let acc = 0;
    for (let i = 0; i < n; i++) { x[i] = i; acc += e[i]; y[i] = acc; }
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.plot(x, y);
    return firstAndAgain(fig, mode);
  },
  async hist_10M(P, mode) {
    const data = normals(1e7, 6);
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.hist(data, { bins: 100 });
    return firstAndAgain(fig, mode);
  },
  async imshow_2000(P, mode) {
    const nx = 2000, ny = 2000, z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = Math.sin(i / 97) * Math.cos(j / 61) + (i + j) / 4000;
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.imshow(z, nx, ny, { cmap: 'viridis' });
    return firstAndAgain(fig, mode);
  },
  async contourf_500(P, mode) {
    const n = 500, z = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = Math.sin(i / 37) * Math.cos(j / 23);
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    if (typeof ax.contourf !== 'function') return { na: 'no contourf' };
    ax.contourf(z, { levels: 10 });
    return firstAndAgain(fig, mode);
  },
  async pick_1M(P, mode) {
    if (mode === 'record') return { na: 'canvas only' };
    const n = 1e6, x = normals(n, 7), y = normals(n, 8);
    const { fig, ax } = P.subplots(1, 1, { figsize: [W, H] });
    ax.scatter(x, y, { s: 2.07 });
    if (typeof ax.pick !== 'function') return { na: 'no pick' };
    drawOnce(fig, 'canvas');
    const r = rng(9);
    const t0 = now(); ax.pick(W * r(), H * r()); const build = now() - t0;      // first pick builds the index
    const t1 = now(); for (let i = 0; i < 1000; i++) ax.pick(W * r(), H * r()); const per = (now() - t1) / 1000;
    return { first: build, again: per };
  },
};
