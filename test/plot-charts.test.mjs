// @gcu/plot M2 (spec_inbox/plot-world-class-SPEC.md): the charts — layout measured from the
// labels, ticks sized to the axis, category axes, inverted / shared / partial limits,
// margins and sticky edges, axis(), the theme objects; then the marks, boxplot, contours and
// norms as they land. Node, recording context, no DOM.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ext/plot/index.js');
const { _resetWarnings } = await import('../ext/plot/src/opts.js');
const { _niceTicks, _fmtStep } = await import('../ext/plot/src/ticks.js');
const plt = P.pltAdder;

let warnings = [];
const realWarn = console.warn;
beforeEach(() => {
  plt.close('all');
  _resetWarnings();
  plt.style.use('dark_background');
  P.rcParams['gcu.strict'] = false;
  warnings = [];
  console.warn = (m) => warnings.push(String(m));
});
process.on('exit', () => { console.warn = realWarn; });

const fig1 = (opts) => P.subplots(1, 1, { figsize: [400, 300], ...opts });
const ops = (fig) => fig.toDrawList().ops;
const texts = (fig) => ops(fig).filter((o) => o[0] === 'fillText').map((o) => o[1]);

// ── ticks ──
test('nice ticks: round steps, as many as fit, never fewer than two while the range allows', () => {
  const T = (...a) => Array.from(_niceTicks(...a));
  assert.deepEqual(T(-1.1, 1.1, 5), [-1, -0.5, 0, 0.5, 1]);
  assert.deepEqual(T(0, 53, 4), [0, 20, 40]);
  assert.deepEqual(T(4100, 4800, 4), [4200, 4400, 4600, 4800]);
  assert.ok(_niceTicks(0.0, 0.0031, 6).every((v) => Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-6));
  assert.equal(_niceTicks(3, 3.0001, 2).length >= 1, true);
  assert.deepEqual(_fmtStep([0, 0.25, 0.5], 0.25), ['0.00', '0.25', '0.50']);
  assert.deepEqual(_fmtStep([8200000, 8200100], 100), ['8200000', '8200100'], 'northings read in plain digits');
  assert.deepEqual(_fmtStep([-0.0001 * 0, 1], 1), ['0', '1']);
});

test('margins are measured: a long y tick label pushes the plot right, a title pushes it down', () => {
  const a = fig1(); a.ax.plot([0, 1], [0, 1]); a.fig.toDrawList();
  const b = fig1(); b.ax.plot([0, 1], [4472000, 4472700]); b.fig.toDrawList();
  assert.ok(b.ax.view.x > a.ax.view.x + 20, `${a.ax.view.x} → ${b.ax.view.x}`);
  const c = fig1(); c.ax.plot([0, 1], [0, 1]); c.ax.set_title('t'); c.fig.toDrawList();
  assert.ok(c.ax.view.y > a.ax.view.y + 10);
  // nothing drawn outside the figure: every tick label's anchor is inside
  for (const o of b.fig.toDrawList().ops) if (o[0] === 'fillText') assert.ok(o[2] >= 0 && o[2] <= 400, `${o[1]} at ${o[2]}`);
});

test('category axes: strings make one, in first-appearance order, for bar, barh, plot and scatter', () => {
  const { fig, ax } = fig1();
  ax.bar(['ox', 'fr', 'tr'], [3, 5, 2]);
  ax.bar(['fr', 'new'], [1, 1]);
  assert.deepEqual(Array.from(ax._traces[1].x), [1, 3]);
  const t = texts(fig);
  for (const lb of ['ox', 'fr', 'tr', 'new']) assert.ok(t.includes(lb), lb);
  const h = fig1(); h.ax.barh(['north pit', 'south pit'], [12, 30]);
  assert.ok(texts(h.fig).includes('south pit'));
  const s = fig1(); s.ax.scatter(['a', 'b', 'a'], [1, 2, 3]);
  assert.deepEqual(Array.from(s.ax._traces[0].x), [0, 1, 0]);
});

test('long category labels rotate rather than collide', () => {
  const { fig, ax } = fig1({ figsize: [300, 240] });
  const names = Array.from({ length: 10 }, (_, i) => `lithology number ${i}`);
  ax.bar(names, names.map((_, i) => i + 1));
  const rot = ops(fig).filter((o) => o[0] === 'rotate');
  assert.ok(rot.length >= 10, 'each label rotated');
});

test('set_xticks with labels and rotation; plt.xticks() reads them back', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1, 2, 3], [1, 2, 3, 4]);
  ax.set_xticks([0, 1, 2, 3], ['Q1', 'Q2', 'Q3', 'Q4'], { rotation: 30 });
  const t = texts(fig);
  assert.ok(['Q1', 'Q2', 'Q3', 'Q4'].every((q) => t.includes(q)));
  assert.ok(ops(fig).some((o) => o[0] === 'rotate' && Math.abs(o[1] + Math.PI / 6) < 1e-9));
  const [locs, labels] = plt.xticks();
  assert.equal(locs.length, labels.length);
  ax.set_yticks([]);
  fig.toDrawList();
  assert.equal(ax.get_yticks().length, 0, 'set_yticks([]): no ticks');
  assert.equal(warnings.length, 0, warnings.join('\n'));
});

test('limits: inverted (set_ylim(500, 0) and invert_yaxis), partial (set_ylim(bottom=0)), kept ends', () => {
  const { fig, ax } = fig1();
  ax.plot([1, 2, 3], [10, 200, 450]);
  ax.set_ylim(500, 0);
  fig.toDrawList();
  assert.deepEqual(ax.get_ylim(), [500, 0]);
  const [, top] = ax.toPixel(1, 0), [, bottom] = ax.toPixel(1, 500);
  assert.ok(top < bottom, 'depth 0 at the top');
  const b = fig1(); b.ax.plot([0, 1], [5, 9]); b.ax.invert_yaxis(); b.fig.toDrawList();
  assert.ok(b.ax.yaxis_inverted());
  const c = fig1(); c.ax.plot([0, 1], [5, 9]); c.ax.set_ylim({ bottom: 0, _kw: true }); c.fig.toDrawList();
  assert.equal(c.ax.get_ylim()[0], 0); assert.ok(c.ax.get_ylim()[1] > 9);
  c.ax.set_ylim(undefined, 20); c.fig.toDrawList();
  assert.deepEqual(c.ax.get_ylim(), [0, 20], 'the other end is kept');
});

test('margins: 5% by default, sticky at a bar\'s 0 and an image\'s edges; margins(0) is tight', () => {
  const a = fig1(); a.ax.plot([0, 10], [0, 10]); a.fig.toDrawList();
  assert.deepEqual(a.ax.get_xlim(), [-0.5, 10.5]);
  const b = fig1(); b.ax.bar([1, 2], [3, 4]); b.fig.toDrawList();
  assert.equal(b.ax.get_ylim()[0], 0, 'bars stand on the axis');
  const c = fig1(); c.ax.imshow([1, 2, 3, 4], 2, 2); c.fig.toDrawList();
  assert.deepEqual(c.ax.get_xlim(), [0, 2]);
  const d = fig1(); d.ax.plot([0, 10], [0, 10]); d.ax.margins(0); d.fig.toDrawList();
  assert.deepEqual(d.ax.get_xlim(), [0, 10]);
});

test("axis(): 'off' hides the frame and ticks, a list sets limits, it returns the limits", () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1], [0, 1]);
  assert.deepEqual(ax.axis([0, 2, -1, 1]), [0, 2, -1, 1]);
  ax.axis('off');
  const o = ops(fig);
  assert.ok(!o.some((x) => x[0] === 'strokeRect'), 'no frame');
  assert.ok(!o.some((x) => x[0] === 'fillText'), 'no tick labels');
});

test('subplots(sharex, sharey): one range, one set of categories, labels only on the outer axes', () => {
  const [fig, axes] = P.subplots(2, 2, { figsize: [400, 300], sharex: true, sharey: true });
  axes[0][0].plot([0, 10], [0, 1]);
  axes[1][1].plot([5, 20], [0, 100]);
  fig.toDrawList();
  for (const ax of axes.flat) assert.deepEqual(ax.get_xlim(), axes[0][0].get_xlim());
  assert.ok(axes[0][0].get_xlim()[1] > 20 && axes[0][0].get_ylim()[1] > 100);
  axes[1][0].set_xlim(0, 5);
  fig.toDrawList();
  assert.deepEqual(axes[0][1].get_xlim(), [0, 5], 'one set_xlim moves all');
  assert.ok(axes[0][0]._xtickLabelsOff && !axes[1][0]._xtickLabelsOff);
  assert.ok(axes[0][1]._ytickLabelsOff && !axes[0][0]._ytickLabelsOff);
  const [f2, a2] = P.subplots(1, 2, { sharey: true });
  a2[0].bar(['a', 'b'], [1, 2]);
  assert.equal(a2[0]._xcats === a2[1]._xcats, false, 'sharey does not share x categories');
  assert.throws(() => P.subplots(2, 1, { sharex: 'diagonal' }), /sharex must be/);
  void f2;
});

test('zorder: images under bars under lines under text, unless zorder says otherwise', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1], [0, 1], { color: '#ff0000' });
  ax.bar([0.5], [1], { color: '#00ff00' });
  const o = ops(fig).filter((x) => x[0] === 'set' && x[1] === 'fillStyle' || x[0] === 'set' && x[1] === 'strokeStyle').map((x) => x[2]);
  assert.ok(o.indexOf('#00ff00') < o.indexOf('#ff0000'), 'the bar (1) before the line (2)');
  const b = fig1();
  b.ax.plot([0, 1], [0, 1], { color: '#ff0000', zorder: 0 });
  b.ax.bar([0.5], [1], { color: '#00ff00' });
  const o2 = ops(b.fig).filter((x) => x[0] === 'set' && (x[1] === 'fillStyle' || x[1] === 'strokeStyle')).map((x) => x[2]);
  assert.ok(o2.indexOf('#ff0000') < o2.indexOf('#00ff00'));
});

test('text: axes coordinates, rotation, named sizes', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 100]);
  ax.text(0.5, 0.5, 'mid', { transform: 'axes', rotation: 90, fontsize: 'large' });
  fig.toDrawList();
  const tr = ops(fig).find((o, i, a) => o[0] === 'translate' && a[i + 2] && a[i + 2][0] === 'fillText' && a[i + 2][1] === 'mid');
  const v = ax.view;
  assert.ok(tr && Math.abs(tr[1] - (v.x + v.w / 2)) < 1e-9 && Math.abs(tr[2] - (v.y + v.h / 2)) < 1e-9);
  assert.ok(ops(fig).some((o) => o[0] === 'set' && o[1] === 'font' && /^13px/.test(o[2])), 'large = base + 2');
});

test('themes: one figure, its own theme; set_theme re-dresses; themeFromCSS; legacy keys still read', () => {
  const a = fig1({ theme: 'paper' });
  assert.equal(a.fig.facecolor, '#FFFFFF');
  a.ax.plot([0, 1], [0, 1]);
  assert.ok(ops(a.fig).some((o) => o[0] === 'set' && o[1] === 'fillStyle' && o[2] === '#1A1A1A'));
  a.fig.set_theme('dark');
  assert.equal(a.fig.facecolor, 'transparent');
  assert.ok(ops(a.fig).some((o) => o[0] === 'set' && o[1] === 'fillStyle' && o[2] === '#DDDCDA'));
  const b = fig1({ theme: { base: 'light', accent: '#c00', bgcolor: '#123456' } });
  assert.equal(b.fig._theme.background, '#123456', "plot 0.2's bgcolor maps onto background");
  assert.equal(b.fig._theme.cycle[0], '#1f77b4', "the cycle is matplotlib's tab10");
  assert.equal(typeof P.themeFromCSS, 'function');
  assert.equal(typeof plt.themeFromCSS, 'function');
  plt.style.use('light');
  assert.equal(fig1().fig._theme.background, '#E4E3E1');
  const d = fig1().fig.toDrawList();
  assert.equal(d.version, 2);
});

// ── the marks (M2 chunk 2) ──
const numpyBins = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/plot-numpy-bins.json', import.meta.url), 'utf8'));

test("hist bins: numpy's rules (auto, fd, sturges, sqrt, rice, scott) give numpy's bin counts", () => {
  for (const [name, d] of Object.entries(numpyBins.data)) {
    for (const [rule, want] of Object.entries(numpyBins.bins[name])) {
      const { ax } = fig1();
      const [, edges] = ax.hist(d, { bins: rule });
      assert.equal(edges.length - 1, want, `${name} / ${rule}`);
    }
  }
});

test('hist: one set of bins for several datasets; side by side, stacked, step, horizontal; returns [n, bins, patches]', () => {
  const a = [1, 2, 2, 3, 3, 3, 9], b = [5, 6, 6, 7];
  const { fig, ax } = fig1();
  const [n, bins] = ax.hist([a, b], { bins: 4 });
  assert.equal(n.length, 2); assert.deepEqual(Array.from(bins), [1, 3, 5, 7, 9]);
  assert.deepEqual(Array.from(n[0]), [3, 3, 0, 1]); assert.deepEqual(Array.from(n[1]), [0, 0, 3, 1]);
  fig.toDrawList();
  const r0 = ax._traces[0]._cache.hrects, r1 = ax._traces[1]._cache.hrects;
  assert.ok(Math.abs((r0.x1[0] - r0.x0[0]) - 0.8) < 1e-9 && r1.x0[0] >= r0.x1[0] - 1e-9, 'side by side, 0.8 of the bin shared');
  const s = fig1();
  s.ax.hist([a, b], { bins: 4, stacked: true });
  s.fig.toDrawList();
  assert.equal(s.ax._traces[1]._cache.bars.base[1], 3, 'the second stands on the first');
  assert.equal(s.ax.get_ylim()[0], 0);
  const h = fig1(); h.ax.hist(a, { bins: 4, orientation: 'horizontal' }); h.fig.toDrawList();
  assert.ok(h.ax.get_ylim()[0] <= 1 && h.ax.get_ylim()[1] >= 9 && h.ax.get_xlim()[0] === 0, 'bins along y, counts along x from 0');
  const st = fig1(); st.ax.hist(a, { bins: 4, histtype: 'step' });
  const br = fig1(); br.ax.hist(a, { bins: 4 });
  const rects = (f) => ops(f).filter((o) => o[0] === 'fillRect').length;
  assert.equal(rects(br.fig) - rects(st.fig), 4, 'bar draws one rect per bin; step draws none');
  const lg = fig1(); lg.ax.hist(a, { bins: 4, log: true }); assert.equal(lg.ax._yscale, 'log');
  const res = fig1().ax.hist(a, { bins: 4 });
  assert.equal(typeof res.set_title, 'function', 'chains to the axes');
});

test('bar: bottom stacks, align edge, per-bar widths and colours, a container with datavalues; bar_label', () => {
  const { fig, ax } = fig1();
  const c1 = ax.bar(['a', 'b'], [3, 4], { label: 'ore' });
  const c2 = ax.bar(['a', 'b'], [1, 2], { bottom: [3, 4], color: ['#ff0000', '#00ff00'] });
  assert.deepEqual(Array.from(c2.datavalues), [1, 2]);
  assert.equal(c2.length, 2); assert.equal(c2[1].get_y(), 4); assert.equal(c2[1].get_height(), 2);
  ax.bar_label(c2, { fmt: '%.1f' });
  ax.bar_label(c1, ['x', 'y'], { label_type: 'center' });
  const t = texts(fig);
  for (const s of ['1.0', '2.0', 'x', 'y']) assert.ok(t.includes(s), s);
  fig.toDrawList();
  assert.ok(ax.get_ylim()[1] >= 6, 'the stacked top counts');
  const e = fig1(); e.ax.bar([0, 1], [1, 1], { width: [0.5, 1], align: 'edge' }); e.fig.toDrawList();
  assert.ok(e.ax.get_xlim()[1] >= 2 && e.ax.get_xlim()[0] <= 0);
  const h = fig1(); const ch = h.ax.barh(['p', 'q'], [2, -1], { left: 1 });
  assert.equal(ch[1].get_x(), 1); assert.equal(ch[1].get_width(), -1);
  assert.throws(() => ax.bar_label({}), /what bar\(\) or barh\(\) returned/);
  assert.equal(typeof c1.set_title, 'function');
});

test('bar_label formats: %-style, {}-style, functions', async () => {
  const { _fmtValue } = await import('../ext/plot/src/bars.js');
  assert.equal(_fmtValue(null, 2.5), '2.5');
  assert.equal(_fmtValue('%.2f', 2.5), '2.50');
  assert.equal(_fmtValue('%d t', 2.6), '2 t');                  // Python's %d truncates: '%d' % 2.6 is '2'
  assert.equal(_fmtValue('{:,.0f}', 1234567.8), '1,234,568');
  assert.equal(_fmtValue('{:.1%}', 0.256), '25.6%');
  assert.equal(_fmtValue((v) => `~${v}`, 3), '~3');
});

test('fill_between: NaN and where split the band; step; fill_betweenx', () => {
  const { fig, ax } = fig1();
  ax.fill_between([0, 1, 2, 3, 4, 5], [1, 2, NaN, 2, 1, 1], 0);
  ax.fill_between([0, 1, 2, 3], [1, 1, 1, 1], [0, 0, 0, 0], { where: [true, true, false, true] });
  const o = ops(fig);
  assert.ok(o.filter((x) => x[0] === 'closePath').length >= 3, 'two pieces, then the where piece');
  fig.toDrawList();
  assert.equal(ax.get_ylim()[0] <= 0, true);
  const s = fig1(); s.ax.fill_between([0, 1, 2], [1, 2, 3], 0, { step: 'post' });
  assert.ok(ops(s.fig).filter((x) => x[0] === 'lineTo').length >= 8, 'stepped vertices');
  const h = fig1(); h.ax.fill_betweenx([0, 10], [1, 2], 5); h.fig.toDrawList();
  assert.ok(h.ax.get_xlim()[1] >= 5 && h.ax.get_ylim()[1] >= 10);
  assert.throws(() => fig1().ax.fill_between([0, 1], [1, 2, 3]), /y1 has 3 values but x has 2/);
});

test('step and drawstyle: pre, post, mid vertices', () => {
  const { ax } = fig1();
  ax.step([0, 1, 2], [1, 2, 3]);
  assert.deepEqual(Array.from(ax._traces[0].x), [0, 0, 1, 1, 2]);
  assert.deepEqual(Array.from(ax._traces[0].y), [1, 2, 2, 3, 3]);
  ax.step([0, 1, 2], [1, 2, 3], { where: 'post' });
  assert.deepEqual(Array.from(ax._traces[1].x), [0, 1, 1, 2, 2]);
  assert.deepEqual(Array.from(ax._traces[1].y), [1, 1, 2, 2, 3]);
  ax.plot([0, 2], [1, 3], { drawstyle: 'steps-mid' });
  assert.deepEqual(Array.from(ax._traces[2].x), [0, 1, 1, 2]);
  assert.equal(warnings.length, 0, warnings.join('\n'));
});

test('errorbar: symmetric and [lower, upper] errors widen the range; fmt none draws only bars; caps', () => {
  const { fig, ax } = fig1();
  const eb = ax.errorbar([1, 2, 3], [5, 6, 7], { yerr: [[1, 1, 1], [3, 3, 3]], capsize: 4, fmt: 'o' });
  fig.toDrawList();
  assert.ok(ax.get_ylim()[0] < 4.01 && ax.get_ylim()[1] > 9.99);
  assert.ok(eb.lines[0] && eb.lines[0].opts.marker === 'o');
  const b = fig1(); b.ax.errorbar([1, 2], [1, 2], { yerr: 0.5, xerr: 0.25, fmt: 'none' });
  assert.equal(b.ax._traces.length, 1, 'no data line');
  assert.ok(ops(b.fig).filter((x) => x[0] === 'moveTo').length >= 4);
});

test('spans, axhline xmin / xmax, annotate', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 10]);
  ax.axhspan(2, 4, { alpha: 0.3 });
  ax.axvspan(6, 8, { ymin: 0.5 });
  ax.axhline(5, { xmin: 0.25, xmax: 0.75 });
  ax.annotate('here', [5, 5], { xytext: [20, 20], textcoords: 'offset points', arrowprops: { arrowstyle: '->' } });
  const o = ops(fig);
  fig.toDrawList();
  const v = ax.view, [, y5] = ax.toPixel(0, 5);
  const seg = o.filter((x) => x[0] === 'moveTo' && Math.abs(x[2] - y5) < 1e-6);
  assert.ok(seg.some((x) => Math.abs(x[1] - (v.x + 0.25 * v.w)) < 1e-6), 'axhline starts a quarter in');
  assert.ok(texts(fig).includes('here'));
  assert.ok(ax.get_ylim()[0] < 0.01, 'spans do not move the other axis');
});

// ── colour-mapped charts (M2 chunk 3) ──
const mplBox = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/plot-mpl-boxplot.json', import.meta.url), 'utf8'));
const { _boxStats } = await import('../ext/plot/src/box.js');

test("boxplot statistics are matplotlib's own (cbook.boxplot_stats), whis 1.5, 0.5 and [5, 95]", () => {
  for (const [key, want] of Object.entries(mplBox.stats)) {
    const [name, w] = key.split('|');
    const whis = w.startsWith('[') ? JSON.parse(w) : +w;
    const got = _boxStats(mplBox.data[name], whis);
    for (const k of ['mean', 'med', 'q1', 'q3', 'iqr', 'whislo', 'whishi', 'cilo', 'cihi']) {
      assert.ok(Math.abs(got[k] - want[k]) <= 1e-9 * Math.max(1, Math.abs(want[k])), `${key} ${k}: ${got[k]} vs ${want[k]}`);
    }
    assert.deepEqual(got.fliers.slice().sort((a, b) => a - b), want.fliers, `${key} fliers`);
  }
});

test('boxplot: a list, a mapping (keys label), positions and ticks, horizontal; returns the stats with get_ydata', () => {
  const { fig, ax } = fig1();
  const bp = ax.boxplot({ ITA: [1, 2, 3, 4, 100], HEM: [5, 6, 7] });
  assert.equal(bp.medians.length, 2);
  assert.equal(bp.medians[0].get_ydata()[0], 3);
  assert.deepEqual(bp.fliers[0].get_ydata(), [100]);
  assert.ok(texts(fig).includes('ITA') && texts(fig).includes('HEM'));
  fig.toDrawList();
  assert.ok(ax.get_ylim()[1] >= 100, 'fliers in the range');
  const h = fig1(); const b2 = h.ax.boxplot([[1, 2, 3], [4, 5, 6]], { vert: false, showmeans: true });
  assert.deepEqual(b2.medians[1].get_xdata(), [5, 5]);
  h.fig.toDrawList();
  assert.ok(h.ax.get_xlim()[1] >= 6 && h.ax.get_ylim()[1] >= 2);
});

test('contour on a cone: every level is a circle of that radius; contourf bands meet the lines', () => {
  const n = 41, X = [], Y = [], Z = [];
  for (let i = 0; i < n; i++) X.push(-2 + (4 * i) / (n - 1));
  for (let j = 0; j < n; j++) { Y.push(-2 + (4 * j) / (n - 1)); Z.push(X.map((x) => Math.hypot(x, Y[j]))); }
  const { fig, ax } = fig1();
  const cs = ax.contour(X, Y, Z, [0.5, 1, 1.5]);
  const segs = cs.allsegs;
  assert.equal(segs.length, 3);
  segs.forEach((lev, k) => {
    assert.ok(lev.length > 20, 'a full ring');
    for (const s of lev) for (const p of s) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - cs.levels[k]) < 0.01, `on the circle r=${cs.levels[k]}`);
  });
  const cf = ax.contourf(X, Y, Z, [0, 1, 2]);
  assert.deepEqual(cf.levels, [0, 1, 2]);
  fig.toDrawList();
  assert.deepEqual(ax.get_xlim(), [-2, 2], 'contours autoscale tight');
});

test('contour on a saddle: level 0 is the two axes; NaN cells are left out; nice default levels', () => {
  const n = 21, Z = [];
  for (let j = 0; j < n; j++) { const y = -1 + (2 * j) / (n - 1); Z.push(Array.from({ length: n }, (_, i) => (-1 + (2 * i) / (n - 1)) * y)); }
  const { ax } = fig1();
  const cs = ax.contour(Z, [0], { extent: [-1, 1, -1, 1] });
  for (const s of cs.allsegs[0]) for (const p of s) assert.ok(Math.abs(p[0]) < 1e-9 || Math.abs(p[1]) < 1e-9, `on an axis: ${p}`);
  Z[10][10] = NaN;
  const c2 = fig1().ax.contour(Z, [0.1]);
  assert.ok(c2.allsegs[0].length > 0);
  const c3 = fig1().ax.contour(Z);
  assert.ok(c3.levels.length >= 4 && c3.levels.every((v) => v > -1 && v < 1), `levels inside the data: ${c3.levels}`);
  const c4 = fig1().ax.contourf(Z);
  assert.ok(c4.levels[0] <= -1 && c4.levels[c4.levels.length - 1] >= 1, `filled levels cover the data: ${c4.levels}`);
  assert.throws(() => fig1().ax.contour([1, 2, 3]), /Z must be a 2D array/);
  assert.throws(() => fig1().ax.contour([0, 1], [0, 1, 2], [[1, 2], [3, 4]]), /X has 2 values and Y 3/);
});

test('norms: Normalize, LogNorm, TwoSlopeNorm, CenteredNorm, BoundaryNorm', () => {
  const n = new P.Normalize(0, 10); assert.equal(n.call(5), 0.5);
  const l = new P.LogNorm(1, 100); assert.equal(l.call(10), 0.5); assert.ok(Number.isNaN(l.call(0)));
  const t = new P.TwoSlopeNorm(0, -1, 4); assert.equal(t.call(-1), 0); assert.equal(t.call(0), 0.5); assert.equal(t.call(2), 0.75);
  const c = new P.CenteredNorm(0)._resolved(-2, 5); assert.equal(c.vmin, -5); assert.equal(c.vmax, 5);
  const b = new P.BoundaryNorm([0, 1, 2, 5], 3);
  assert.equal(b.call(0.5), 0.5 / 3); assert.equal(b.call(3), 2.5 / 3); assert.equal(b.call(-1), 0.5 / 3, 'below: the first class');
  assert.equal(P.colors.LogNorm, P.LogNorm);
});

test('colorbars follow their mappable and norm: log decades, boundaries, extend, ticks, format', () => {
  const a = fig1(); const sc = a.ax.scatter([1, 2, 3], [1, 2, 3], { c: [1, 10, 1000], norm: 'log' }); a.ax.colorbar(sc);
  const ta = texts(a.fig); assert.ok(ta.includes('1') && ta.includes('10') && ta.includes('100') && ta.includes('1000'), ta.join(' '));
  const b = fig1(); const sb = b.ax.scatter([1, 2], [1, 2], { c: [0.2, 3], norm: new P.BoundaryNorm([0, 1, 2, 5], 256) }); b.ax.colorbar(sb, { ticks: [0, 2, 5], format: '%.1f' });
  const tb = texts(b.fig); assert.ok(tb.includes('0.0') && tb.includes('5.0') && tb.filter((s) => s === '2.0').length >= 2, tb.join(' '));   // 2.0: an axis tick and the bar's
  const c = fig1(); const im = c.ax.imshow([[1, 2], [3, 4]]); c.fig.colorbar(im, { extend: 'both', label: 'v' });
  assert.ok(texts(c.fig).includes('v'));
  assert.ok(ops(c.fig).filter((o) => o[0] === 'closePath').length >= 2, 'two extend triangles');
});

test("imshow(Z): matplotlib's defaults — origin upper, cells centred on their index, y running down", () => {
  const { fig, ax } = fig1();
  ax.imshow([[1, 2, 3], [4, 5, 6]]);
  fig.toDrawList();
  assert.deepEqual(ax.get_xlim(), [-0.5, 2.5]);
  assert.deepEqual(ax.get_ylim(), [1.5, -0.5], 'inverted');
  const [, top] = ax.toPixel(0, 0), [, bottom] = ax.toPixel(0, 1);
  assert.ok(top < bottom, 'row 0 at the top');
  const flat = fig1(); flat.ax.imshow([1, 2, 3, 4], 2, 2); flat.fig.toDrawList();
  assert.deepEqual(flat.ax.get_ylim(), [0, 2], 'the flat form keeps its own defaults');
});

test('pcolormesh: an even mesh is one image; uneven edges draw cells; curvilinear corners; shading', () => {
  const C = [[1, 2], [3, 4]];
  const a = fig1(); a.ax.pcolormesh([0, 1, 2], [0, 10, 20], C);
  assert.equal(ops(a.fig).filter((o) => o[0] === 'image').length, 1);
  const b = fig1(); b.ax.pcolormesh([0, 1, 5], [0, 1, 2], C);
  assert.equal(ops(b.fig).filter((o) => o[0] === 'image').length, 0);
  b.fig.toDrawList(); assert.deepEqual(b.ax.get_xlim(), [0, 5]);
  const c = fig1(); c.ax.pcolormesh([0, 1], [0, 1], C, { shading: 'nearest' }); c.fig.toDrawList();
  assert.deepEqual(c.ax.get_xlim(), [-0.5, 1.5]);
  const d = fig1(); d.ax.pcolormesh([[0, 1, 2], [0, 1, 2], [0, 1, 2]], [[0, 0, 0], [1, 1, 1], [2, 2.5, 3]], C); d.fig.toDrawList();
  assert.ok(d.ax.get_ylim()[1] >= 3);
  assert.throws(() => fig1().ax.pcolormesh([0, 1, 2, 3], [0, 1], C), /give the 3 and 3 cell edges/);
});

test("colour maps: ColorBrewer and matplotlib names, '_r' for any, listed maps; an unknown name warns", async () => {
  const { getCmap } = await import('../ext/plot/src/color.js');
  assert.equal(getCmap('RdBu')(0), 'rgb(103,0,31)');
  assert.equal(getCmap('RdBu_r')(0), 'rgb(5,48,97)');
  assert.equal(getCmap('tab10')(0.05), '#1f77b4');
  assert.equal(getCmap(new P.ListedColormap(['red', 'blue']))(0.9), '#0000ff');
  getCmap('nope');
  assert.ok(warnings.some((w) => /no colour map 'nope'/.test(w)));
});

// ── the edge-case matrix and golden draw lists (M2 chunk 4) ──
// Every chart kind against empty, one point, constant, NaN, ±Inf, negatives on a log axis,
// 1e9 and 1e-9 magnitudes, and the typed-array kinds: it draws (or refuses with a named
// 'plot:' error), its limits are finite, and no op carries a non-finite number.
const CASES = {
  empty: [], one: [3], constant: [2, 2, 2, 2], nan: [1, NaN, 3, 4], inf: [1, Infinity, -Infinity, 4],
  negative: [-5, -1, 0, 2], big: [1e9, 1e9 + 5, 1e9 + 9, 1e9 + 2], tiny: [1e-9, 3e-9, 2e-9, 5e-9],
  f32: Float32Array.of(1, 2, 3, 4), i16: Int16Array.of(-3, 0, 7, 2), u8: Uint8Array.of(0, 128, 255, 3),
};
const KINDS = {
  plot: (ax, v) => ax.plot(v),
  scatter: (ax, v) => ax.scatter(Array.from(v, (_, i) => i), v, { c: v }),
  bar: (ax, v) => ax.bar(Array.from(v, (_, i) => i), v),
  barh: (ax, v) => ax.barh(Array.from(v, (_, i) => i), v),
  hist: (ax, v) => ax.hist(v),
  boxplot: (ax, v) => ax.boxplot(v),
  step: (ax, v) => ax.step(Array.from(v, (_, i) => i), v),
  fill_between: (ax, v) => ax.fill_between(Array.from(v, (_, i) => i), v),
  errorbar: (ax, v) => ax.errorbar(Array.from(v, (_, i) => i), v, { yerr: 0.5 }),
  imshow: (ax, v) => ax.imshow([Array.from(v), Array.from(v)]),
  pcolormesh: (ax, v) => ax.pcolormesh([Array.from(v), Array.from(v)]),
  contour: (ax, v) => ax.contour([Array.from(v), Array.from(v).reverse(), Array.from(v)]),
  contourf: (ax, v) => ax.contourf([Array.from(v), Array.from(v).reverse(), Array.from(v)]),
  // tier 2 (M4)
  violinplot: (ax, v) => ax.violinplot([v]),
  hexbin: (ax, v) => ax.hexbin(Array.from(v, (_, i) => i), v, { gridsize: 6 }),
  hist2d: (ax, v) => ax.hist2d(Array.from(v, (_, i) => i), v, { bins: 4 }),
  stackplot: (ax, v) => ax.stackplot(Array.from(v, (_, i) => i), v, v),
};
test('the edge-case matrix: every chart kind × empty / one / constant / NaN / ±Inf / negative-on-log / 1e9 / 1e-9 / typed arrays', () => {
  const problems = [];
  for (const [kind, make] of Object.entries(KINDS)) {
    for (const [name, v] of Object.entries(CASES)) {
      for (const log of name === 'negative' ? [false, true] : [false]) {
        const { fig, ax } = fig1();
        if (log) ax.set_yscale('log');
        try { make(ax, v); }
        catch (e) { if (!/^plot: /.test(e.message)) problems.push(`${kind}/${name}: threw ${e.message}`); continue; }
        let list;
        try { list = fig.toDrawList(); } catch (e) { problems.push(`${kind}/${name}${log ? '/log' : ''}: draw threw ${e.message}`); continue; }
        const lim = [...ax.get_xlim(), ...ax.get_ylim()];
        if (!lim.every(Number.isFinite)) problems.push(`${kind}/${name}${log ? '/log' : ''}: limits ${lim}`);
        if (log && !(ax.get_ylim()[0] > 0)) problems.push(`${kind}/${name}/log: the log axis starts at ${ax.get_ylim()[0]}`);
        for (const op of list.ops) for (const a of op) if (typeof a === 'number' && !Number.isFinite(a)) { problems.push(`${kind}/${name}: op ${op[0]} has ${a}`); break; }
      }
    }
  }
  assert.deepEqual(problems, []);
});

// golden draw lists: a fixed figure per chart type, its draw list hashed. A change here means
// the drawing changed — intended (regenerate: UPDATE_GOLDEN=1 node --test test/plot-charts.test.mjs)
// or not (a bug).
const { createHash } = await import('node:crypto');
const goldenPath = new URL('./fixtures/plot-golden.json', import.meta.url);
const fsg = await import('node:fs');
const GOLDEN_FIGS = {
  line: (ax) => { ax.plot([0, 1, 2, 3], [1, 3, 2, 4], { label: 'a' }); ax.plot([0, 3], [2, 2], '--', { label: 'b' }); ax.legend(); ax.set_title('t'); },
  scatter: (ax) => { const sc = ax.scatter([1, 2, 3, 4], [4, 1, 3, 2], { c: [0.1, 0.5, 0.7, 1], s: [10, 40, 90, 160] }); ax.colorbar(sc); },
  bars: (ax) => { const c = ax.bar(['a', 'b', 'c'], [3, 5, 2]); ax.bar(['a', 'b', 'c'], [1, 1, 1], { bottom: [3, 5, 2] }); ax.bar_label(c); },
  hist: (ax) => ax.hist([[1, 2, 2, 3, 3, 3, 4], [2, 3, 4, 4, 5]], { bins: 5, stacked: true }),
  box: (ax) => ax.boxplot({ x: [1, 2, 3, 4, 10], y: [2, 3, 3, 4] }),
  image: (ax) => { const im = ax.imshow([[1, 2, 3], [4, 5, 6]], { cmap: 'RdBu' }); ax.colorbar(im, { extend: 'both' }); },
  contours: (ax) => { const Z = Array.from({ length: 8 }, (_, j) => Array.from({ length: 8 }, (_, i) => Math.hypot(i - 3.5, j - 3.5))); const cf = ax.contourf(Z, 5); ax.contour(Z, 5, { colors: 'k' }); ax.colorbar(cf); },
  marks: (ax) => { ax.fill_between([0, 1, 2], [1, 2, 1], 0, { alpha: 0.4 }); ax.errorbar([0, 1, 2], [1, 2, 1], { yerr: 0.2, capsize: 3 }); ax.axhspan(0.5, 0.8); ax.annotate('p', [1, 2], { xytext: [1.5, 2.5], arrowprops: {} }); },
  axes: (ax) => { ax.plot([1, 10, 100], [5, 50, 500]); ax.set_xscale('log'); ax.invert_yaxis(); ax.set_xticks([1, 10, 100], ['one', 'ten', 'hundred'], { rotation: 30 }); ax.grid(true); },
  // tier 2 (M4)
  tier2: (ax) => { ax.violinplot([[1, 2, 2, 3, 3, 3, 4, 5], [2, 4, 4, 5, 6]], { showmedians: true }); ax.stackplot([0, 1, 2], [1, 2, 1], [1, 1, 2], { alpha: 0.4 }); },
  dists: (ax) => { const x = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 3), y = x.map((v, i) => v * 0.5 + Math.cos(i * 2.3)); ax.hexbin(x, y, { gridsize: 6 }); },
  ticks: (ax) => { ax.plot([new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 6, 1))], [0, 0.5]); ax.yaxis.set_major_formatter('{x:.0%}'); ax.minorticks_on(); ax.grid(true, { which: 'both' }); },
};
test('golden draw lists: one per chart type, the same every run', () => {
  const got = {};
  for (const [name, make] of Object.entries(GOLDEN_FIGS)) {
    const { fig, ax } = fig1({ theme: 'paper' });
    make(ax);
    const json = JSON.stringify(fig.toDrawList());
    got[name] = createHash('sha256').update(json).digest('hex').slice(0, 16);
    assert.equal(createHash('sha256').update(JSON.stringify(fig.toDrawList())).digest('hex').slice(0, 16), got[name], `${name}: deterministic`);
  }
  if (process.env.UPDATE_GOLDEN || !fsg.existsSync(goldenPath)) fsg.writeFileSync(goldenPath, JSON.stringify(got, null, 2) + '\n');
  assert.deepEqual(got, JSON.parse(fsg.readFileSync(goldenPath, 'utf8')));
});

test('contourf on a big grid rasterizes: one image op, each pixel in the band of the field at its centre', () => {
  // a ramp z = x over a 300 × 300 grid (89,401 cells: the raster path)
  const n = 300, Z = [];
  for (let j = 0; j < n; j++) Z.push(Array.from({ length: n }, (_, i) => i));
  const { fig, ax } = fig1({ theme: 'paper' });
  const levels = [0, 50, 100, 150, 200, 250, 299];
  ax.contourf(Z, levels, { colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'] });
  const list = fig.toDrawList();
  const img = list.ops.filter((o) => o[0] === 'image');
  assert.equal(img.length, 1, 'one image');
  const [, x, , w, , cols, rows, b64] = img[0];
  const bytes = Buffer.from(b64, 'base64');
  const want = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  let bad = 0, checked = 0;
  const row = Math.floor(rows / 2);
  for (let px = 0; px < cols; px++) {
    const xv = ax.view.xScale.inverse(x + ((px + 0.5) * w) / cols);
    if (xv < 0.5 || xv > n - 1.5) continue;
    const k = levels.findIndex((L, q) => xv >= L && xv < levels[q + 1]);
    if (k < 0 || Math.abs(xv - levels[k]) < 0.6 || Math.abs(xv - levels[k + 1]) < 0.6) continue;   // skip pixels on an edge
    const o = (row * cols + px) * 4;
    checked++;
    if (bytes[o] !== want[k][0] || bytes[o + 1] !== want[k][1] || bytes[o + 2] !== want[k][2]) bad++;
  }
  assert.ok(checked > 200, `checked ${checked}`);
  assert.equal(bad, 0);
  // the vector path draws the same bands on request
  const v = fig1(); v.ax.contourf(Z, levels, { vector: true });
  assert.equal(ops(v.fig).filter((o) => o[0] === 'image').length, 0);
});
