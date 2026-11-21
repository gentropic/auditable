// @gcu/plot: matplotlib's rcParams — the keys plot reads, when it reads them (at creation), the
// calls around them (rc, rcdefaults, rc_context, style.context, cycler), the checks, the
// Python shapes (a dict is a Map; kwargs carry _kw), and the title / label / spine / tick looks
// rc dresses — which their own options override.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ext/plot/index.js');
const { rcParams, rc, rcdefaults, rc_context, cycler, style } = P;

const warnings = [];
const ow = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
afterEach(() => { rcdefaults(); warnings.length = 0; P._resetWarnings?.(); });

const fig1 = (opts) => { const [fig, ax] = P.subplots(1, 1, { figsize: [400, 300], ...opts }); return { fig, ax }; };
// the canvas state in force at a fillText of `text` (the draw list records state as 'set' ops)
function stateAt(fig, text) {
  const st = {};
  for (const op of fig.toDrawList().ops) {
    if (op[0] === 'set') st[op[1]] = op[2];
    if (op[0] === 'fillText' && op[1] === text) return { ...st, x: op[2], y: op[3] };
  }
  return null;
}
const px = (font) => +/([\d.]+)px/.exec(font)[1];

test('rcParams starts at plot\'s defaults; a theme key left unset reads as the theme\'s', () => {
  assert.equal(rcParams['lines.linewidth'], 1.5);
  assert.deepEqual(rcParams['figure.figsize'], [4, 3]);
  assert.equal(rcParams['axes.grid'], false);
  assert.equal(rcParams['font.size'], 11, 'the theme\'s font_size');
  assert.equal(rcParams['image.cmap'], 'viridis');
  assert.equal(rcParams['axes.prop_cycle'].length, 10);
  assert.ok(rcParams.keys().includes('axes.spines.top'));
  assert.equal(rcParams.get('nope', 7), 7);
  assert.deepEqual(P.pltAdder.matplotlib.rcParamsDefault['figure.figsize'], [4, 3]);
});

test('a key is read when a thing is made: a line made before the change keeps its width', () => {
  const { ax } = fig1();
  ax.plot([0, 1], [0, 1]);
  rcParams['lines.linewidth'] = 3;
  rcParams['lines.linestyle'] = '--';
  ax.plot([0, 1], [1, 0]);
  ax.plot([0, 1], [1, 1], { lw: 1 });
  ax.plot([0, 1], [0, 0], ':');
  const t = ax._traces;
  assert.equal(t[0].opts.linewidth, undefined, 'made before: plot\'s 1.5');
  assert.equal(t[1].opts.linewidth, 3); assert.equal(t[1].opts.linestyle, '--');
  assert.equal(t[2].opts.linewidth, 1, 'the call wins');
  assert.equal(t[3].opts.linestyle, ':', 'the format string wins');
  rcParams['lines.marker'] = 'o'; rcParams['lines.markersize'] = 9;
  ax.plot([0, 1], [2, 2]);
  assert.equal(t[4].opts.marker, 'o'); assert.equal(t[4].opts.markersize, 9);
});

test('plt.rc(group, kwargs) with matplotlib\'s aliases, a list of groups, and Python kwargs', () => {
  rc('lines', { lw: 2.5, ls: '-.' });
  assert.equal(rcParams['lines.linewidth'], 2.5); assert.equal(rcParams['lines.linestyle'], '-.');
  rc(['xtick', 'ytick'], { labelsize: 8, _kw: true });
  assert.equal(rcParams['xtick.labelsize'], 8); assert.equal(rcParams['ytick.labelsize'], 8);
  rc('font', { size: 14 });
  assert.equal(rcParams['font.size'], 14);
  assert.equal(fig1().ax._theme.font_size, 14, 'font.size dresses the next figure');
});

test('update() takes a JS object, a Python dict (adder\'s PyDict is a Map), and kwargs', () => {
  rcParams.update({ 'axes.grid': true });
  rcParams.update(new Map([['hist.bins', 4], ['axes.xmargin', 0]]));
  assert.equal(rcParams['axes.grid'], true); assert.equal(rcParams['hist.bins'], 4); assert.equal(rcParams['axes.xmargin'], 0);
  assert.equal(fig1().ax._grid, true);
  assert.equal(fig1().ax.hist([1, 2, 3, 4, 5, 6])[1].length, 5, 'hist.bins');
});

test('rc_context: a with-block (enter / exit, __enter__ / __exit__), or a function; a dict or rc= keyword', async () => {
  rcParams['lines.linewidth'] = 2;
  const c = rc_context({ 'lines.linewidth': 4, 'axes.grid': true });
  assert.equal(rcParams['lines.linewidth'], 2, 'applied on entry, not at the call');
  c.__enter__();
  assert.equal(rcParams['lines.linewidth'], 4); assert.equal(fig1().ax._grid, true);
  c.__exit__(null, null, null);
  assert.equal(rcParams['lines.linewidth'], 2); assert.equal(rcParams['axes.grid'], false);
  const got = rc_context({ rc: new Map([['hist.bins', 3]]), _kw: true }).run(() => rcParams['hist.bins']);
  assert.equal(got, 3); assert.equal(rcParams['hist.bins'], 10);
  assert.throws(() => rc_context({ 'axes.grid': true }, () => { throw new Error('inner'); }), /inner/);
  assert.equal(rcParams['axes.grid'], false, 'restored when the body throws');
  await rc_context({ 'lines.linewidth': 5 }, async () => { await null; assert.equal(rcParams['lines.linewidth'], 5); });
  assert.equal(rcParams['lines.linewidth'], 2, 'restored after an async body settles');
});

test('style.context puts the style and rcParams back; style.use(dict) is rcParams; a named style resets theme keys', () => {
  rcParams['axes.facecolor'] = '#123456';
  style.context('default', () => { assert.equal(fig1().ax._theme.background, '#FFFFFF', 'a named style resets theme rc keys'); });
  assert.equal(fig1().ax._theme.background, '#123456', 'back after the context');
  style.use({ 'axes.grid': true });
  assert.equal(rcParams['axes.grid'], true);
  style.use('dark_background');
  assert.equal(rcParams['axes.facecolor'], P.resolveTheme('dark').background, 'reads as the theme again');
});

test('theme keys dress each new figure over the style; an explicit theme: … wins', () => {
  rcParams.update({ 'axes.facecolor': '#fafafa', 'text.color': '#101010', 'axes.edgecolor': '#444444', 'grid.color': '#dddddd', 'figure.facecolor': 'white' });
  rcParams['axes.prop_cycle'] = cycler({ color: ['#e41a1c', '#377eb8'] });
  const th = fig1().ax._theme;
  assert.equal(th.background, '#fafafa'); assert.equal(th.foreground, '#101010'); assert.equal(th.frame, '#444444');
  assert.equal(th.grid, '#dddddd'); assert.equal(th.figure, 'white'); assert.deepEqual(th.cycle, ['#e41a1c', '#377eb8']);
  const { ax } = fig1();
  ax.plot([1], [1]); ax.plot([1], [1]); ax.plot([1], [1]);
  assert.deepEqual(ax._traces.map((t) => t.opts.color), ['#e41a1c', '#377eb8', '#e41a1c']);
  assert.equal(fig1({ theme: 'paper' }).ax._theme.background, '#FFFFFF', 'an explicit theme is not overridden');
  rcParams['axes.prop_cycle'] = ['r', 'g'];
  assert.deepEqual(rcParams['axes.prop_cycle'], ['r', 'g'], 'a plain list works too');
  rcParams['axes.prop_cycle'] = cycler('color', ['k']);
  assert.deepEqual(fig1().ax._theme.cycle, ['k'], "cycler('color', [...])");
  rcParams['axes.prop_cycle'] = cycler({ color: ['r', 'b'], linestyle: ['-', '--'] });
  assert.ok(warnings.some((w) => /cycles colours only/.test(w)), 'other cycled properties say so');
});

test('spines: axes.spines.* and ax.spines (one, a list, values()); the frame rect stays when all four match', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1], [0, 1]);
  assert.ok(fig.toDrawList().ops.some((o) => o[0] === 'strokeRect'), 'default: the one rect (unchanged draw lists)');
  ax.spines[['top', 'right']].set_visible(false);
  assert.equal(ax.spines.top.get_visible(), false); assert.equal(ax.spines['right'].get_visible(), false); assert.equal(ax.spines.left.get_visible(), true);
  const ops = fig.toDrawList().ops;
  assert.ok(!ops.some((o) => o[0] === 'strokeRect'), 'no rect once sides differ');
  const v = ax.view, top = ops.filter((o) => o[0] === 'moveTo' && Math.abs(o[2] - v.y) < 0.01 && Math.abs(o[1] - v.x) < 0.01);
  const lines = ops.filter((o, i) => o[0] === 'lineTo' && ops[i - 1][0] === 'moveTo' && Math.abs(ops[i - 1][1] - v.x) < 0.01 && Math.abs(ops[i - 1][2] - v.y) < 0.01 && Math.abs(o[2] - v.y) < 0.01);
  assert.equal(lines.length, 0, 'no top edge'); assert.ok(top.length >= 1, 'the left spine starts at the top-left corner');
  ax.spines.bottom.set_color('red').set_linewidth(2);
  assert.ok(fig.toDrawList().ops.some((o) => o[0] === 'set' && o[1] === 'strokeStyle' && o[2] === '#ff0000'));
  assert.deepEqual(ax.spines.keys(), ['left', 'right', 'top', 'bottom']);
  assert.equal(ax.spines.values().length, 4);
  rcParams['axes.spines.top'] = false; rcParams['axes.spines.right'] = false;
  const b = fig1().ax;
  assert.equal(b.spines.top.get_visible(), false); assert.equal(b.spines.right.get_visible(), false);
  assert.throws(() => b.spines.__getitem__('middle'), /no spine 'middle'/);
});

test('title and label looks: rcParams sizes / weight / location / pad / colour, and the call\'s own options win (they were ignored before)', () => {
  rcParams.update({ 'axes.titlesize': 'x-large', 'axes.titleweight': 'bold', 'axes.titlelocation': 'left', 'axes.labelsize': 14, 'axes.labelcolor': '#0000aa' });
  const { fig, ax } = fig1();
  ax.plot([0, 1], [0, 1]); ax.set_title('T'); ax.set_xlabel('X'); ax.set_ylabel('Y', { fontsize: 9, color: 'green', loc: 'top' });
  const T = stateAt(fig, 'T'), X = stateAt(fig, 'X'), Y = stateAt(fig, 'Y');
  assert.equal(px(T.font), Math.round(11 * 1.44 * 10) / 10); assert.match(T.font, /^bold /); assert.equal(T.textAlign, 'left');
  assert.equal(T.x, ax.view.x, 'loc left sits at the plot\'s left edge');
  assert.equal(px(X.font), 14); assert.equal(X.fillStyle, '#0000aa');
  assert.equal(px(Y.font), 9); assert.equal(Y.fillStyle, '#008000'); assert.equal(Y.textAlign, 'right', "ylabel loc 'top'");
  // a bigger title gets more room above the plot
  rcdefaults();
  const a = fig1(), b = fig1();
  a.ax.plot([0, 1], [0, 1]); a.ax.set_title('t'); a.fig.toDrawList();
  b.ax.plot([0, 1], [0, 1]); b.ax.set_title('t', { fontsize: 24, pad: 12 }); b.fig.toDrawList();
  assert.ok(b.ax.view.y > a.ax.view.y + 15, `${b.ax.view.y} vs ${a.ax.view.y}`);
});

test('ticks: x/ytick.labelsize, colour, direction, sizes, minor.visible; tick_params(labelsize, labelcolor, colors) per axis', () => {
  rcParams.update({ 'xtick.labelsize': 8, 'ytick.labelsize': 13, 'xtick.color': '#aa0000', 'ytick.direction': 'in', 'xtick.minor.visible': true });
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 10]);
  const ops = fig.toDrawList();
  const xs = stateAt(fig, '0'), ys = stateAt(fig, '10');
  assert.equal(px(xs.font), 8, 'x tick labels');
  assert.equal(xs.fillStyle, '#aa0000', 'xtick.color colours the labels too (labelcolor inherit)');
  assert.ok([8, 13].includes(px(ys.font)));
  assert.equal(ax._tickParams.y.major.direction, 'in');
  assert.ok(ax._tkx.minorOn, 'minor ticks on');
  const b = fig1().ax;
  b.plot([0, 10], [0, 10]);
  b.tick_params({ axis: 'y', labelsize: 6, labelcolor: 'blue' });
  b.figure.toDrawList();
  assert.equal(b._tickParams.y.major.labelsize, 6); assert.equal(b._tickParams.y.major.labelcolor, '#0000ff');
  b.tick_params({ colors: 'red' });
  assert.equal(b._tickParams.x.major.color, '#ff0000'); assert.equal(b._tickParams.x.major.labelcolor, '#ff0000');
});

test('grid: axes.grid + grid.* style; ax.grid(True, {alpha}) keeps the rc linestyle', () => {
  rcParams.update({ 'axes.grid': true, 'axes.grid.axis': 'y', 'grid.linestyle': '--', 'grid.alpha': 0.3 });
  const { ax } = fig1();
  assert.equal(ax._grid, true); assert.equal(ax._gridOpts.axis, 'y'); assert.equal(ax._gridOpts.linestyle, '--');
  ax.grid(true, { alpha: 0.6 });
  assert.equal(ax._gridOpts.linestyle, '--'); assert.equal(ax._gridOpts.alpha, 0.6);
});

test('hist.bins, errorbar.capsize, image.origin / interpolation, axes.x/ymargin, legend.*', () => {
  rcParams.update({ 'hist.bins': 'sqrt', 'errorbar.capsize': 4, 'image.origin': 'lower', 'image.interpolation': 'nearest', 'axes.ymargin': 0, 'legend.frameon': false, 'legend.loc': 'upper left', 'legend.fontsize': 'small' });
  const { ax } = fig1();
  assert.equal(ax.hist(Array.from({ length: 16 }, (_, i) => i))[1].length, 5, 'sqrt(16) = 4 bins');
  const b = fig1().ax; b.errorbar([0, 1], [0, 1], { yerr: 0.1 });
  assert.equal(b._traces.find((t) => t.type === 'errorbar').opts.capsize, 4, 'errorbar.capsize');
  const b2 = fig1().ax; b2.errorbar([0, 1], [0, 1], { yerr: 0.1, capsize: 0 });
  assert.equal(b2._traces.find((t) => t.type === 'errorbar').opts.capsize, 0, 'the call wins (0 too)');
  const c = fig1().ax; c.imshow([[1, 2], [3, 4]]);
  assert.equal(c._traces[0].opts.origin, 'lower'); assert.equal(c._traces[0].opts.interpolation, 'nearest');
  assert.equal(fig1().ax._ymargin, 0);
  const d = fig1().ax; d.plot([0, 1], [0, 1], { label: 'a' }); d.legend();
  assert.equal(d._legendOpts.frameon, false); assert.equal(d._legendOpts.loc, 'upper left'); assert.equal(d._legendOpts.fontsize, 'small');
  const e = fig1().ax; e.plot([0, 1], [0, 1], { label: 'a' }); e.legend({ frameon: true });
  assert.equal(e._legendOpts.frameon, true, 'the call wins');
});

test('figure.figsize / figure.dpi / figure.titlesize; the suptitle\'s own fontsize', () => {
  rcParams['figure.figsize'] = [5, 2];
  rcParams['figure.dpi'] = 80;
  const [f] = P.subplots(1, 1);
  assert.equal(f.width, 400); assert.equal(f.height, 160);
  rcdefaults();
  rcParams['figure.titlesize'] = 20;
  const [g] = P.subplots(1, 1, { figsize: [300, 200] });
  g.suptitle('S');
  assert.equal(px(stateAt(g, 'S').font), 20);
  g.suptitle('S', { fontsize: 9, fontweight: 'bold' });
  assert.match(stateAt(g, 'S').font, /^bold 9px/);
});

test('bad values warn and leave the key; unknown keys are stored and warned about once; strict throws', () => {
  rcParams['lines.linewidth'] = 'thick';
  assert.equal(rcParams['lines.linewidth'], 1.5);
  assert.ok(warnings.some((w) => /lines\.linewidth.*'thick'.*a positive number/.test(w)), warnings.join('\n'));
  rcParams['axes.titlelocation'] = 'middle';
  assert.ok(warnings.some((w) => /'left', 'center', 'right'/.test(w)));
  rcParams['savefig.bbox'] = 'tight'; rcParams['savefig.bbox'] = 'tight';
  assert.equal(rcParams['savefig.bbox'], 'tight');
  assert.equal(warnings.filter((w) => /savefig\.bbox.*doesn't read/.test(w)).length, 1);
  rcParams['axes.grid'] = 'True';
  assert.equal(rcParams['axes.grid'], true, "matplotlib's string booleans");
  rcParams['axes.facecolor'] = null;
  assert.equal(rcParams['axes.facecolor'], P.resolveTheme('dark').background, 'None: back to the theme');
  rcParams['gcu.strict'] = true;
  assert.throws(() => { rcParams['lines.markersize'] = -1; }, /lines\.markersize/);
  rcParams['gcu.strict'] = false;
});

test('font.family: a monospace face goes to the front of the stack; a proportional one warns (layout stays monospace)', () => {
  rcParams['font.family'] = 'monospace';
  rcParams['font.monospace'] = ['Fira Code'];
  assert.match(fig1().ax._theme.mono, /^'Fira Code', /);
  rcdefaults(); warnings.length = 0;
  rcParams['font.family'] = 'serif';
  assert.ok(warnings.some((w) => /monospace face/.test(w)));
  assert.match(fig1().ax._theme.mono, /^'Space Mono'/, 'chart text unchanged');
});

test('rcdefaults() puts every key back; matplotlib\'s module object and cycler for an .ipynb', () => {
  rcParams.update({ 'lines.linewidth': 4, 'axes.facecolor': 'red', 'foo.bar': 1 });
  rcdefaults();
  assert.equal(rcParams['lines.linewidth'], 1.5); assert.equal(rcParams['foo.bar'], undefined);
  assert.equal(rcParams['axes.facecolor'], P.resolveTheme('dark').background);
  const mpl = P.pltAdder.matplotlib;
  assert.equal(mpl.rcParams, rcParams); assert.equal(typeof mpl.rc_context, 'function'); mpl.use('Agg');
  assert.equal(P.pltAdder.cycler.cycler, P.pltAdder.cycler, '`from cycler import cycler`');
  assert.deepEqual(cycler({ color: ['r'] }).by_key(), { color: ['r'] });
});


// ── from Python (adder): the shapes a notebook writes, and an .ipynb's rewritten imports ──
const { run, registerModule, unregisterModule } = await import('../ext/adder/src/index.js');
async function py(code) {
  const out = [];
  registerModule('plt', P.pltAdder);
  try { await run(code, { print: (...a) => out.push(a.map(String).join(' ')) }); } finally { P.pltAdder.flush_figures(); unregisterModule('plt'); P.close('all'); }
  return out;
}

test('from Python: rcParams[k] = v, rc(group, **kw), update(dict), with rc_context / style.context, spines, cycler', async () => {
  assert.deepEqual(await py(`import plt
plt.rcParams['lines.linewidth'] = 3
fig, ax = plt.subplots()
ax.plot([1, 2])
print(ax._traces[0].opts.linewidth, 'lines.linewidth' in plt.rcParams, 'nope.nope' in plt.rcParams)`), ['3 true false']);
  assert.deepEqual(await py(`import plt
plt.rc('font', size=14)
plt.rc('axes', titlesize='x-large', labelsize=12)
plt.rcParams.update({'axes.grid': True, 'hist.bins': 5})
print(plt.rcParams['font.size'], plt.rcParams['axes.titlesize'], plt.rcParams['axes.grid'], plt.rcParams['hist.bins'])`), ['14 x-large true 5']);
  assert.deepEqual(await py(`import plt
with plt.rc_context({'lines.linewidth': 7}):
    print(plt.rcParams['lines.linewidth'])
print(plt.rcParams['lines.linewidth'])
with plt.rc_context(rc={'axes.grid': True}):
    fig, ax = plt.subplots()
    print(ax._grid)
with plt.style.context('default'):
    fig, ax = plt.subplots()
    print(ax._theme['background'])`), ['7', '3', 'true', '#FFFFFF']);
  assert.deepEqual(await py(`import plt
fig, ax = plt.subplots()
ax.spines[['top', 'right']].set_visible(False)
for s in ax.spines.values():
    s.set_linewidth(2)
print(ax.spines['top'].get_visible(), ax.spines.right.get_visible(), ax.spines['left'].get_visible(), ax.spines.left.get_linewidth())`), ['false false true 2']);
});

test("from Python: an .ipynb's matplotlib and cycler imports, as @gcu/ipynb rewrites them", async () => {
  const { rewriteImports } = await import('../ext/ipynb/src/substitutions.js');
  const src = rewriteImports(`import matplotlib as mpl
import matplotlib.pyplot as plt
from cycler import cycler
from matplotlib.colors import LogNorm
mpl.rcParams['axes.prop_cycle'] = cycler(color=['r', 'g'])
mpl.rcParams['axes.spines.top'] = False
mpl.use('Agg')
fig, ax = plt.subplots()
print(ax._theme['cycle'], ax.spines['top'].get_visible(), LogNorm is mpl.colors.LogNorm)`).source;
  assert.deepEqual(await py(src), ['r,g false true']);
});

process.on('exit', () => { console.warn = ow; });
