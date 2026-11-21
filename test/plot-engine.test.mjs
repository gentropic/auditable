// @gcu/plot 0.2 engine (spec_inbox/plot-world-class-SPEC.md, milestone M1): the 0.1.1 defects
// D1–D13, columnar ingest, non-finite values, histograms against numpy, warnings and strict
// mode, the view and picking. Node, recording context, no DOM. The pixel-level checks (raster
// scatter vs vector, M4 decimation vs every vertex, imshow live vs recorded) are in
// test/plot-engine-smoke.mjs, in a browser.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const P = await import('../ext/plot/index.js');
const { _resetWarnings } = await import('../ext/plot/src/opts.js');
const { getCmap } = await import('../ext/plot/src/color.js');
const { _col } = await import('../ext/plot/src/data.js');
const { _stamp } = await import('../ext/plot/src/raster.js');
const plt = P.pltAdder;
const pkg = JSON.parse(fs.readFileSync(new URL('../ext/plot/package.json', import.meta.url), 'utf8'));
const numpy = JSON.parse(fs.readFileSync(new URL('./fixtures/plot-numpy-hist.json', import.meta.url), 'utf8'));

// capture console.warn for the "nothing is silently ignored" checks
let warnings = [];
const realWarn = console.warn;
beforeEach(() => {
  plt.close('all');
  _resetWarnings();
  P.rcParams['gcu.strict'] = false;
  warnings = [];
  console.warn = (m) => warnings.push(String(m));
});
process.on('exit', () => { console.warn = realWarn; });

const fig1 = (opts) => P.subplots(1, 1, { figsize: [400, 300], ...opts });
const ops = (fig) => fig.toDrawList().ops;
const imageOps = (fig) => ops(fig).filter((o) => o[0] === 'image');

// ── the 0.1.1 defects ─────────────────────────────────────────────────────────────────────

test('D1 / D13: typed-array c and s are used, and the colorbar follows them', () => {
  const n = 50, x = new Float64Array(n), y = new Float64Array(n), c = new Float32Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = i; y[i] = i * i; c[i] = i / n; s[i] = 4 + i; }
  const { fig, ax } = fig1();
  ax.scatter(x, y, { c, s, cmap: 'viridis' });
  ax.colorbar();
  const t = ax._traces[0];
  assert.equal(t.cvals, c, 'c kept as the caller\'s typed array');
  assert.equal(t.s, s);
  const fills = new Set(ops(fig).filter((o) => o[0] === 'set' && o[1] === 'fillStyle').map((o) => o[2]));
  assert.ok(fills.size > 10, `points colour-mapped (${fills.size} distinct fills)`);
  // the colorbar draws its labelled ticks: round values across 0 … 0.98 (M2: nice ticks)
  assert.ok(ops(fig).filter((o) => o[0] === 'fillText' && /^0\.[2468]$/.test(o[1])).length >= 3, 'colorbar tick labels');
});

test('D2: 300k values through hist, scatter colour range and colorbar — no RangeError', () => {
  const n = 300000, v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.sin(i);
  const a = fig1();
  a.ax.hist(Array.from(v), { bins: 50 });
  assert.doesNotThrow(() => a.fig.toDrawList());
  const b = fig1();
  b.ax.scatter(v, v, { c: v });
  b.ax.colorbar();
  assert.doesNotThrow(() => b.fig.toDrawList());
});

test('D3: a typed array is not copied; a plain array becomes one Float64Array', () => {
  const x = new Float32Array([1, 2, 3]), y = [4, 5, 6];
  const { ax } = fig1();
  ax.plot(x, y);
  assert.equal(ax._traces[0].x, x);
  assert.ok(ax._traces[0].y instanceof Float64Array);
  assert.equal(_col(new BigInt64Array([1n, 2n]))[1], 2, 'BigInt columns convert');
  assert.deepEqual(Array.from(_col([1, null, 3])).map(String), ['1', 'NaN', '3']);
});

test('D4: scatter honours marker — squares draw polygons, not arcs', () => {
  const { fig, ax } = fig1();
  ax.scatter([1, 2, 3], [1, 2, 3], { marker: 's' });
  const o = ops(fig);
  assert.ok(!o.some((x) => x[0] === 'arc'), 'no arcs');
  assert.ok(o.filter((x) => x[0] === 'lineTo').length >= 9, 'three squares of lineTo');
  for (const m of ['^', 'v', '<', '>', 'd', 'D', 'p', 'h', '*', '+', 'x', '.']) {
    const f = fig1(); f.ax.scatter([1], [1], { marker: m });
    assert.doesNotThrow(() => f.fig.toDrawList(), m);
  }
  assert.equal(warnings.length, 0, warnings.join('\n'));
  const f = fig1(); f.ax.scatter([1], [1], { marker: 'Q' });
  assert.match(warnings[0], /marker 'Q' is not supported/);
});

test('D5 / D6: imshow is one image op; NaN cells are transparent, never rgb(NaN)', () => {
  assert.equal(getCmap('viridis')(NaN), 'rgba(0,0,0,0)');
  assert.equal(getCmap('jet')(NaN), 'rgba(0,0,0,0)');
  assert.equal(getCmap(['red', 'blue'])(NaN), 'rgba(0,0,0,0)');
  const { fig, ax } = fig1();
  ax.imshow([0, NaN, 2, 3], 2, 2, { origin: 'upper' });
  const img = imageOps(fig);
  assert.equal(img.length, 1);
  const rgba = Buffer.from(img[0][7], 'base64');
  assert.equal(rgba[1 * 4 + 3], 0, 'the NaN cell (row 0, col 1) is transparent');
  assert.equal(rgba[0 * 4 + 3], 255, 'its neighbour is opaque');
  assert.ok(!JSON.stringify(ops(fig)).includes('NaN'), 'no NaN reaches the draw list');
});

test('D7: hist counts match numpy.histogram exactly', () => {
  for (const c of numpy.cases) {
    const data = Float64Array.from(c.data, (v) => (v === null ? NaN : v === 'inf' ? Infinity : v === '-inf' ? -Infinity : v));
    const { ax } = fig1();
    const opts = { ...c.opts };
    ax.hist(data, opts);
    const { edges, counts } = ax._hist(ax._traces[0]);
    assert.equal(counts.length, c.counts.length, c.name);
    for (let i = 0; i < counts.length; i++) {
      if (c.opts.density) assert.ok(Math.abs(counts[i] - c.counts[i]) < 1e-12, `${c.name}: bin ${i} ${counts[i]} vs ${c.counts[i]}`);
      else assert.equal(counts[i], c.counts[i], `${c.name}: bin ${i}`);
    }
    for (let i = 0; i < edges.length; i++) assert.ok(Math.abs(edges[i] - c.edges[i]) < 1e-12, `${c.name}: edge ${i}`);
  }
});

test('D7: cumulative, and plt.hist returns the counts it drew', () => {
  const r = plt.hist([1, 2, 2, 3, 3, 3], { bins: 3, cumulative: true });
  assert.deepEqual(r.counts, [1, 3, 6]);
  assert.equal(r[0], r.counts);
  assert.equal(r.edges.length, 4);
});

test('D8: twiny shares y and has its own x along the top', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1, 2], [10, 20, 30]);
  const top = ax.twiny();
  top.plot([100, 300], [10, 30]);
  top.set_xlabel('top axis');
  fig.toDrawList();
  assert.ok(top !== ax._twin && ax._twinY === top);
  assert.deepEqual(top.view.yScale, ax.view.yScale, 'the same y-scale');
  assert.ok(top.view.xScale.domain[1] >= 300 && ax.view.xScale.domain[1] < 10, 'its own x-scale');
  const labels = ops(fig).filter((o) => o[0] === 'fillText').map((o) => o[1]);
  assert.ok(labels.includes('top axis'));
});

test('D9 / D10: each figure keeps its own palette; text and reference lines follow it', () => {
  plt.style.use('dark_background');
  const dark = fig1();
  plt.style.use('default');
  const light = fig1();
  plt.style.use('dark_background');                       // after: neither figure changes
  for (const f of [dark, light]) { f.ax.text(0.5, 0.5, 'hi'); f.ax.axhline(0.5); f.ax.plot([0, 1], [0, 1]); }
  const style = (f, name) => ops(f.fig).filter((o) => o[0] === 'set' && o[1] === name).map((o) => o[2]);
  assert.ok(style(dark, 'fillStyle').includes('#DDDCDA'), 'dark text (basalt foreground)');
  assert.ok(style(light, 'fillStyle').includes('#1A1A1A'), 'light text (paper foreground)');
  assert.ok(!style(light, 'fillStyle').includes('#DDDCDA'), 'no dark-theme text on the light figure');
  assert.ok(style(light, 'strokeStyle').includes('#555555'), 'light reference line (muted)');
  assert.equal(light.fig.facecolor, '#FFFFFF');
});

test('D11: plot(y) draws against 0 … n-1, at the axes level and plt level', () => {
  const { fig, ax } = fig1();
  ax.plot([5, 6, 7]);
  assert.deepEqual(Array.from(ax._traces[0].x), [0, 1, 2]);
  ax.plot([1, 2, 3], 'r--');
  assert.equal(ax._traces[1].opts.linestyle, '--');
  assert.ok(ops(fig).filter((o) => o[0] === 'lineTo').length >= 4);
  plt.plot([3, 1, 2]);
  assert.equal(plt.gca()._traces[0].x.length, 3);
});

test('D12: one version everywhere', () => {
  assert.equal(P.VERSION, pkg.version);
});

// ── matplotlib semantics ──────────────────────────────────────────────────────────────────

test("format strings in any order; a marker without a line style draws markers only", () => {
  const { fig, ax } = fig1();
  ax.plot([1, 2, 3], [1, 2, 3], 'o');
  ax.plot([1, 2, 3], [1, 2, 3], 'o-r');
  assert.equal(ax._traces[0].opts.linestyle, 'None');
  assert.equal(ax._traces[1].opts.linestyle, '-');
  assert.equal(ax._traces[1].opts.marker, 'o');
  const o = ops(fig);
  assert.equal(o.filter((x) => x[0] === 'stroke').length >= 1, true);
});

test("marker sizes are matplotlib's: s in points², markersize in points, at the figure's dpi", () => {
  const radii = (fig) => fig.toDrawList().ops.filter((o) => o[0] === 'arc').map((o) => o[3]);
  const a = P.subplots(1, 1, { figsize: [4, 3] });               // dpi 100
  a.ax.scatter([1], [1]);                                        // default s = 36: 6 pt across
  a.ax.scatter([2], [2], { s: 144 });                            // 12 pt across
  a.ax.plot([3], [3], 'o');                                      // markersize 6 pt
  const [r1, r2, r3] = radii(a.fig);
  assert.ok(Math.abs(r1 - (6 * 100 / 72) / 2) < 1e-9, `default scatter radius ${r1}`);
  assert.ok(Math.abs(r2 - 2 * r1) < 1e-9, 'area ×4 → diameter ×2');
  assert.ok(Math.abs(r3 - r1) < 1e-9, "plot's default markersize matches scatter's default s");
  const b = P.subplots(1, 1, { figsize: [4, 3], dpi: 200 });
  b.ax.scatter([1], [1]);
  assert.ok(Math.abs(radii(b.fig)[0] - 2 * r1) < 1e-9, 'points scale with dpi');
});

test('scatter takes matplotlib\'s positional s and c', () => {
  const { ax } = fig1();
  ax.scatter([1, 2, 3], [1, 2, 3], 30, [0.1, 0.5, 0.9]);
  assert.equal(ax._traces[0].opts.s, 30);
  assert.ok(ax._traces[0].cvals instanceof Float64Array);
});

test('per-point colour strings, and colour names the canvas would not know', () => {
  const { fig, ax } = fig1();
  ax.scatter([1, 2], [1, 2], { color: ['tab:orange', 'C2'] });
  ax.plot([1, 2], [2, 1], { color: 'r' });
  const fills = ops(fig).filter((o) => o[0] === 'set' && (o[1] === 'fillStyle' || o[1] === 'strokeStyle')).map((o) => o[2]);
  assert.ok(fills.includes('#ff7f0e') && fills.includes('#2ca02c'), 'tab colours resolved');
  assert.ok(fills.includes('#ff0000'), "color='r' is matplotlib's red, not an invalid 'r'");
});

test('errors name the argument, what was expected and what came', () => {
  const { ax } = fig1();
  assert.throws(() => ax.scatter([1, 2, 3], [1, 2]), /scatter: x has 3 values but y has 2/);
  assert.throws(() => ax.scatter([1, 2], [1, 2], { c: [1, 2, 3] }), /scatter: c has 3 values but x has 2/);
  assert.throws(() => ax.plot([1, 2], [1, 2, 3]), /plot: x has 2 values but y has 3/);
  assert.throws(() => ax.imshow([1, 2, 3], 2, 2), /imshow: data has 3 values but nx × ny is 4/);
  assert.throws(() => ax.imshow('not a grid'), /give a 2D array/);
  assert.throws(() => ax.imshow([[1, 2], [3]]), /rows of one length: row 0 has 2, row 1 has 1/);
});

// ── non-finite values never throw and never poison ────────────────────────────────────────

test('extents skip NaN and ±Inf; lines break at NaN; a NaN colour value draws nothing', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1, 2, 3, 4], [1, NaN, 3, Infinity, 5]);
  fig.toDrawList();
  const [ylo, yhi] = ax.view.yScale.domain;
  assert.ok(Number.isFinite(ylo) && Number.isFinite(yhi) && yhi < 6, `y extent ${ylo}…${yhi}`);
  const o = ops(fig);
  const moves = o.filter((x) => x[0] === 'moveTo').length;
  assert.ok(moves >= 3, `the line restarts after each break (${moves} moveTo)`);
  const g = fig1();
  g.ax.scatter([1, 2, 3], [1, 2, 3], { c: [0, NaN, 1] });
  const arcs = ops(g.fig).filter((x) => x[0] === 'arc').length;
  assert.equal(arcs, 2, 'the NaN-coloured point is not drawn');
});

test('a log axis ignores values ≤ 0', () => {
  const { fig, ax } = fig1();
  ax.plot([1, 2, 3, 4], [-1, 0, 10, 1000]);
  ax.set_yscale('log');
  fig.toDrawList();
  const [lo, hi] = ax.view.yScale.domain;
  assert.ok(lo > 1 && lo <= 10 && hi >= 1000, `${lo}…${hi}`);
});

test('every typed-array kind is a column', () => {
  for (const T of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) {
    const { fig, ax } = fig1();
    ax.scatter(new T([1, 2, 3]), new T([3, 2, 1]), { c: new T([1, 2, 3]) });
    ax.hist(new T([1, 2, 2, 3]));
    assert.doesNotThrow(() => fig.toDrawList(), T.name);
  }
});

// ── nothing is silently ignored ───────────────────────────────────────────────────────────

test('an unknown option warns once, with the name it probably meant', () => {
  const { ax } = fig1();
  ax.plot([1, 2], [1, 2], { colour: 'red' });
  ax.plot([1, 2], [1, 2], { colour: 'red' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /plot\(\) has no option 'colour', did you mean 'color'\?/);
  ax.bar([1], [1], { hatch: '//' });
  assert.match(warnings[1], /bar\(\): 'hatch' — not supported yet/);
  ax.plot([1], [1], { lw: 2, ls: '--', c: 'k' });              // aliases are real options
  assert.equal(warnings.length, 2);
});

test('the silent no-ops of 0.1.1 now say so; tight_layout stays quiet by design', () => {
  plt.rc('font'); plt.subplots_adjust({ wspace: 0.3 });
  plt.gca().set_zorder(3);
  plt.tight_layout();
  assert.equal(warnings.length, 3, warnings.join('\n'));
  assert.ok(warnings.every((w) => /does nothing yet/.test(w)));
});

test("strict mode turns every warning into an error (rcParams['gcu.strict'] or {strict})", () => {
  P.rcParams['gcu.strict'] = true;
  assert.throws(() => fig1().ax.plot([1], [1], { colour: 'r' }), /did you mean 'color'/);
  P.rcParams['gcu.strict'] = false;
  const { ax } = fig1({ strict: true });
  assert.throws(() => ax.scatter([1], [1], { sizes: 3 }), /has no option 'sizes'/);
  P.rcParams['gcu.strict'] = true;
  assert.throws(() => plt.style.use('fivethirtyeight-ish'), /not a style/, 'unknown styles warn (here: throw)');
  P.rcParams['gcu.strict'] = false;
});

// ── the view and picking ──────────────────────────────────────────────────────────────────

test('after a draw: ax.view, toPixel / toData round-trip, fig.axesAt', () => {
  const { fig, axes } = P.subplots(1, 2, { figsize: [600, 300] });
  axes[0].plot([0, 10], [0, 100]);
  axes[1].plot([0, 1], [0, 1]);
  assert.throws(() => axes[0].toPixel(1, 1), /needs a drawn figure/);
  fig.toDrawList();
  const v = axes[0].view;
  assert.ok(v.w > 0 && v.h > 0 && v.xScale && v.yScale);
  const [px, py] = axes[0].toPixel(5, 50);
  const [x, y] = axes[0].toData(px, py);
  assert.ok(Math.abs(x - 5) < 1e-9 && Math.abs(y - 50) < 1e-9);
  assert.equal(fig.axesAt(px, py), axes[0]);
  assert.equal(fig.axesAt(axes[1].view.x + 5, axes[1].view.y + 5), axes[1]);
  assert.equal(fig.axesAt(1, 1), null);
});

test('pick: nearest marker, then line vertices, then bars by column, then image cells', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 5, 10], [0, 5, 10], { label: 'line' });
  ax.scatter([5.1], [5.1], { label: 'pts', c: [0.7] });
  fig.toDrawList();
  const [px, py] = ax.toPixel(5, 5);
  const p = ax.pick(px, py);
  assert.equal(p.label, 'pts', 'the marker wins over a nearer line vertex');
  assert.equal(p.kind, 'marker');
  assert.equal(p.c, 0.7);
  const [lx, ly] = ax.toPixel(10, 10);
  assert.equal(ax.pick(lx, ly).label, 'line');
  assert.equal(ax.pick(lx, ly).index, 2);
  assert.equal(ax.pick(1, 1), null);

  const b = fig1();
  b.ax.bar([1, 2, 3], [5, 6, 7]);
  b.fig.toDrawList();
  const [bx] = b.ax.toPixel(2.3, 0);
  const hit = b.ax.pick(bx, b.ax.view.y + 5);                  // above the bar's top: still its column
  assert.equal(hit.kind, 'bar'); assert.equal(hit.index, 1); assert.equal(hit.y, 6);

  const im = fig1();
  im.ax.imshow([1, 2, 3, 4, 5, 6], 3, 2);                       // origin 'lower': row 0 at the bottom
  im.fig.toDrawList();
  const [cx, cy] = im.ax.toPixel(2.5, 0.5);
  const cell = im.ax.pick(cx, cy);
  assert.equal(cell.kind, 'cell'); assert.equal(cell.col, 2); assert.equal(cell.row, 0); assert.equal(cell.value, 3);
});

test('pick searches the twin too, with its own scale', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 1]);
  const t = ax.twinx();
  t.scatter([5], [500], { label: 'right' });
  fig.toDrawList();
  const [px, py] = t.toPixel(5, 500);
  assert.equal(ax.pick(px, py).label, 'right');
  assert.equal(ax.pick(px, py).axes, t);
});

// ── the fast paths keep their promises ────────────────────────────────────────────────────

test('a big scatter is one image op, the same draw list every time', () => {
  const n = 20000, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = Math.cos(i * 0.37) * (i % 97); y[i] = Math.sin(i * 0.37) * (i % 89); c[i] = i % 13; }
  const { fig, ax } = fig1();
  ax.scatter(x, y, { c, s: 2 });
  const a = fig.toDrawList(), b = fig.toDrawList();
  assert.deepEqual(a, b);
  assert.equal(a.ops.filter((o) => o[0] === 'image').length, 1);
  assert.ok(a.ops.length < 200, `${a.ops.length} ops, not one per point`);
  // and the same figure built again gives the same list (determinism across builds)
  const again = fig1(); again.ax.scatter(x, y, { c, s: 2 });
  assert.deepEqual(again.fig.toDrawList(), a);
});

test('marker stamps are symmetric and cover about the marker\'s area', () => {
  const st = _stamp('o', 3, 0);
  let cov = 0;
  for (let j = 0; j < st.size; j++) for (let i = 0; i < st.size; i++) {
    cov += st.fill[j * st.size + i];
    assert.equal(st.fill[j * st.size + i], st.fill[j * st.size + (st.size - 1 - i)], 'mirror symmetric');
  }
  const area = cov / 255, want = Math.PI * 9;
  assert.ok(Math.abs(area - want) / want < 0.03, `coverage ${area.toFixed(2)} vs πr² ${want.toFixed(2)}`);
});

test('a long line with rising x is decimated (M4), a short one is not', () => {
  const n = 100000, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = i; y[i] = Math.sin(i / 50) + (i % 7) * 0.01; }
  const { fig, ax } = fig1();
  ax.plot(x, y);
  const lines = ops(fig).filter((o) => o[0] === 'lineTo').length;
  // at most 4 vertices per quarter device pixel (axes.js _M4_SUB), i.e. ≤ 16 per pixel of width
  assert.ok(lines < 16 * 400 && lines > 400, `${lines} vertices for a ~${Math.round(fig.width)} px figure`);
  // a short line keeps every vertex: 4 points are 2 more lineTo than 2 points (ticks aside)
  const lineTos = (k) => { const f = fig1(); f.ax.plot(Array.from({ length: k }, (_, i) => i), Array.from({ length: k }, (_, i) => i % 2)); f.ax.set_xlim(0, 3); f.ax.set_ylim(0, 1); return ops(f.fig).filter((o) => o[0] === 'lineTo').length; };
  assert.equal(lineTos(4) - lineTos(2), 2);
});
