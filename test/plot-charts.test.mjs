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
  assert.equal(_fmtValue('%d t', 2.6), '3 t');
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
