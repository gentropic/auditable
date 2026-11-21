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
