// plot M4, tier 2 (spec §7): tick formatters and locators, minor ticks, a date axis, violinplot,
// hexbin, hist2d, stackplot. The numbers are checked against matplotlib's own
// (test/fixtures/plot-mpl-tier2.py, matplotlib 3.11.2) and Python's formatting against CPython
// (test/fixtures/plot-pyfmt.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const P = await import('../ext/plot/index.js');
const F = await import('../ext/plot/src/pyfmt.js');
const MPL = JSON.parse(fs.readFileSync(new URL('./fixtures/plot-mpl-tier2.json', import.meta.url), 'utf8'));
const PYF = JSON.parse(fs.readFileSync(new URL('./fixtures/plot-pyfmt.json', import.meta.url), 'utf8'));
const fig1 = (o) => { const [fig, ax] = P.subplots(1, 1, { figsize: [480, 320], ...(o || {}) }); return { fig, ax }; };
const texts = (fig) => fig.toDrawList().ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ── formatting ──

test("Python's format spec, str.format templates and %-formatting are CPython's (56 cases)", () => {
  for (const [v, s, want] of PYF.spec) assert.equal(F._formatSpec(v, s), want, `format(${v}, '${s}')`);
  for (const [t, n, want] of PYF.tpl) assert.equal(F.pyFormat(t, n), want, t);
  for (const [f, v, want] of PYF.pct) assert.equal(F.pctFormat(f, v), want, `'${f}' % ${v}`);
});

test('formatters on an axis: a str, a function, the ticker classes; PercentFormatter and EngFormatter are matplotlib\'s', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 1]);
  ax.xaxis.set_major_formatter('{x:.0f} m');
  ax.yaxis.set_major_formatter(new P.ticker.PercentFormatter(1));
  let t = texts(fig);
  assert.ok(t.includes('10 m') && t.includes('0 m'), t.join(' '));
  assert.ok(t.includes('100%') && t.includes('20%'), t.join(' '));
  ax.xaxis.set_major_formatter((x, pos) => `#${pos}`);
  t = texts(fig);
  assert.ok(t.includes('#0') && t.includes('#1'), t.join(' '));
  ax.xaxis.set_major_formatter(new P.ticker.FormatStrFormatter('%.1f'));
  assert.ok(texts(fig).includes('10.0'));
  ax.xaxis.set_major_formatter(new P.ticker.NullFormatter());
  assert.ok(!texts(fig).some((s) => /^\d+(\.\d+)?$/.test(s) && +s > 1));
  // matplotlib's automatic decimals, and its engineering notation
  for (const c of MPL.percent) {
    const g = fig1();
    g.ax.set_ylim(...c.lim);
    const f = new P.ticker.PercentFormatter(c.xmax);
    const range = c.lim[1] - c.lim[0];
    assert.deepEqual(c.vals.map((v, i) => f.format(v, i, { range })), c.labels, JSON.stringify(c));
  }
  const ef = new P.ticker.EngFormatter('Hz');
  assert.deepEqual(MPL.eng.vals.map((v) => ef.format(v)), MPL.eng.labels);                  // matplotlib's minus, U+2212, exactly
  assert.throws(() => ax.xaxis.set_major_formatter(42), /a Formatter, a function/);
});

test('locators: MultipleLocator, MaxNLocator, FixedLocator; AutoMinorLocator is matplotlib\'s', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 100], [0, 1]);
  ax.xaxis.set_major_locator(new P.ticker.MultipleLocator(25));
  fig.toDrawList();
  assert.deepEqual(ax.get_xticks(), [0, 25, 50, 75, 100]);
  ax.xaxis.set_major_locator(new P.ticker.FixedLocator([10, 42]));
  fig.toDrawList();
  assert.deepEqual(ax.get_xticks(), [10, 42]);
  ax.xaxis.set_major_locator(new P.ticker.MaxNLocator(3));
  fig.toDrawList();
  assert.ok(ax.get_xticks().length <= 4);
  for (const c of MPL.minor) {
    const majors = new P.ticker.MultipleLocator(c.step).tick_values(...c.lim);
    const minors = new P.ticker.AutoMinorLocator().tick_values(...c.lim, { majors }).filter((v) => !majors.includes(v));
    const want = c.minors.filter((v) => v >= c.lim[0] && v <= c.lim[1]);
    assert.equal(minors.length, want.length, JSON.stringify(c));
    minors.forEach((v, i) => assert.ok(close(v, want[i]), `${v} vs ${want[i]}`));
  }
});

test('minor ticks draw as short marks; grid(which=minor) at them; tick_params length and direction', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 10], [0, 10]);
  const count = () => fig.toDrawList().ops.filter((o) => o[0] === 'stroke').length;
  const n0 = count();
  ax.minorticks_on();
  const n1 = count();
  assert.ok(n1 > n0 + 20, `${n0} → ${n1} strokes`);
  ax.grid(true, { which: 'both' });
  const n2 = count();
  assert.ok(n2 > n1 + 20);
  ax.minorticks_off();
  assert.ok(count() < n2);
  // ticks inward, longer: the mark goes inside the frame
  const g = fig1();
  g.ax.plot([0, 1], [0, 1]);
  g.ax.tick_params({ direction: 'in', length: 7 });
  const L = g.fig.toDrawList();
  g.fig.toDrawList();
  const v = g.ax.view, bottom = v.y + v.h;
  const ins = L.ops.filter((o) => o[0] === 'moveTo' && Math.abs(o[2] - (bottom - 7)) < 1e-6);
  assert.ok(ins.length >= 2, 'ticks reach 7 px inside the bottom edge');
  assert.throws(() => P.subplots(1, 1, { strict: true })[1].tick_params({ direction: 'up' }), /direction/);
});

// ── dates ──

test('Date objects make a date axis: calendar ticks in UTC, the labels their spacing reads in', () => {
  const day = 864e5, t0 = Date.UTC(2026, 0, 1);
  const { fig, ax } = fig1();
  const d = Array.from({ length: 365 }, (_, i) => new Date(t0 + i * day));
  ax.plot(d, d.map((_, i) => Math.sin(i / 30)));
  const t = texts(fig);
  assert.ok(t.some((s) => /^2026-\d\d$/.test(s)), t.join(' '));          // months
  assert.ok(ax._xdate === true);
  const ticks = ax.get_xticks();
  assert.ok(ticks.every((v) => new Date(v).getUTCDate() === 1 && new Date(v).getUTCHours() === 0), 'ticks on the first of a month, UTC midnight');
  // a few days: day ticks; hours: HH:MM, midnight showing the day
  const g = fig1();
  g.ax.plot([new Date(t0), new Date(t0 + 10 * day)], [0, 1]);
  assert.ok(texts(g.fig).some((s) => /^2026-01-\d\d$/.test(s)));
  const h = fig1();
  h.ax.plot([new Date(t0 - 6 * 36e5), new Date(t0 + 18 * 36e5)], [0, 1]);
  const ht = texts(h.fig);
  assert.ok(ht.some((s) => /^\d\d:00$/.test(s)) && ht.includes('2026-01-01'), ht.join(' '));
  // decades
  const y = fig1();
  y.ax.plot([new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(2020, 0, 1))], [0, 1]);
  assert.ok(texts(y.fig).some((s) => s === '1950' || s === '1960'));
  // xaxis_date for epoch ms; DateFormatter; set_xlim with Dates; bars a day wide
  const z = fig1();
  z.ax.plot([t0, t0 + 30 * day], [0, 1]);
  z.ax.xaxis_date();
  z.ax.xaxis.set_major_formatter(new P.dates.DateFormatter('%d %b'));
  assert.ok(texts(z.fig).some((s) => /^\d\d Jan$/.test(s)), texts(z.fig).join(' '));
  z.ax.set_xlim(new Date(t0), new Date(t0 + 7 * day));
  z.fig.toDrawList();
  assert.deepEqual(z.ax.get_xlim(), [t0, t0 + 7 * day]);
  const b = fig1();
  b.ax.bar([new Date(t0), new Date(t0 + day)], [1, 2]);
  assert.ok(close(b.ax._traces[0].widths ? b.ax._traces[0].widths[0] : b.ax._traces[0].thick, 0.8 * day) || JSON.stringify(b.ax._traces[0]).includes(String(0.8 * day)));
  assert.equal(P.dates.strftime(Date.UTC(2026, 10, 21, 14, 5, 9), '%Y-%m-%d %H:%M:%S %a %b %j'), '2026-11-21 14:05:09 Sat Nov 325');
  assert.deepEqual(P.dates.date2num([new Date(t0)]), [t0]);
});

// ── the charts ──

test("hexbin: matplotlib's hexagons and counts exactly (gridsize, (nx, ny), mincnt, C, extent)", () => {
  const H = MPL.hexbin;
  for (const c of H.cases) {
    const { ax } = fig1();
    const opts = { ...c.kw };
    if (c.C) opts.C = H.C;
    const r = ax.hexbin(H.x, H.y, opts);
    const t = r._trace, keep = [];
    for (let k = 0; k < t.accum.length; k++) if (t.accum[k] === t.accum[k]) keep.push(k);
    assert.equal(keep.length, c.offsets.length, `${JSON.stringify(c.kw)}: ${keep.length} hexagons vs matplotlib's ${c.offsets.length}`);
    keep.forEach((k, i) => {
      assert.ok(close(t.cx[k], c.offsets[i][0]) && close(t.cy[k], c.offsets[i][1]), `${JSON.stringify(c.kw)} hexagon ${i}`);
      assert.ok(close(t.accum[k], c.values[i]), `${JSON.stringify(c.kw)} value ${i}: ${t.accum[k]} vs ${c.values[i]}`);
    });
  }
});

test('hexbin draws one fill per colour, picks a hexagon, feeds a colorbar; bins=log', () => {
  const H = MPL.hexbin;
  const { fig, ax } = fig1();
  const hb = ax.hexbin(H.x, H.y, { gridsize: 20, cmap: 'magma' });
  fig.colorbar(hb, { ax, label: 'count' });
  const L = fig.toDrawList();
  const fills = L.ops.filter((o) => o[0] === 'fill').length;
  assert.ok(fills > 5 && fills <= 260, `${fills} fills`);
  assert.ok(texts(fig).includes('count'));
  const [px, py] = ax.toPixel(0, 0);
  const p = ax.pick(px, py);
  assert.ok(p && p.kind === 'hexbin' && p.count >= 0, JSON.stringify(p && { k: p.kind, c: p.count }));
  const g = fig1();
  const lg = g.ax.hexbin(H.x, H.y, { gridsize: 20, bins: 'log' });
  g.fig.toDrawList();
  assert.ok(lg._trace.opts.norm === 'log');
});

test("violinplot: matplotlib's KDE (Scott), lines across, the bodies restyled through what it returns", () => {
  const V = MPL.violin;
  const { fig, ax } = fig1();
  const parts = ax.violinplot(V.sets, { showmeans: true, showmedians: true, quantiles: [0.25, 0.75] });
  V.stats.forEach((want, i) => {
    const s = parts.stats[i];
    assert.ok(close(s.mean, want.mean) && close(s.median, want.median) && close(s.min, want.min) && close(s.max, want.max), `set ${i} stats`);
    assert.equal(s.coords.length, want.coords.length);
    s.coords.forEach((c, k) => { assert.ok(close(c, want.coords[k], 1e-9), `coords ${i}/${k}`); assert.ok(close(s.vals[k], want.vals[k], 1e-9), `kde ${i}/${k}: ${s.vals[k]} vs ${want.vals[k]}`); });
  });
  assert.equal(parts.bodies.length, 3);
  assert.ok(parts.cmeans && parts.cmedians && parts.cbars && parts.cquantiles);
  parts.bodies[0].set_facecolor('#d43f3a'); parts.bodies[0].set_alpha(1);
  parts.cbars.set_color('k');
  const L = fig.toDrawList();
  assert.ok(L.ops.some((o) => o[0] === 'set' && o[1] === 'fillStyle' && o[2] === '#d43f3a'));
  assert.ok(L.ops.some((o) => o[0] === 'set' && o[1] === 'strokeStyle' && o[2] === '#000000'));
  // a mapping labels the positions; horizontal; constant data draws lines, no body
  const g = fig1();
  g.ax.violinplot({ oxide: V.sets[0], fresh: V.sets[1] }, { vert: false });
  assert.deepEqual(g.ax.get_yticklabels(), ['oxide', 'fresh']);
  const h = fig1();
  assert.doesNotThrow(() => { h.ax.violinplot([[3, 3, 3, 3]]); h.fig.toDrawList(); });
});

test("hist2d: numpy's histogram2d counts and edges, density, cmin; drawn as a pcolormesh", () => {
  const H = MPL.hexbin, R = MPL.hist2d;
  const { fig, ax } = fig1();
  const r = ax.hist2d(H.x, H.y, { bins: [7, 5] });
  const [h, xe, ye, image] = r;
  assert.deepEqual(h.map((row) => Array.from(row)), R.h);
  Array.from(xe).forEach((v, i) => assert.ok(close(v, R.xe[i])));
  Array.from(ye).forEach((v, i) => assert.ok(close(v, R.ye[i])));
  assert.ok(image && image._trace && ['pcolormesh', 'imshow'].includes(image._trace.type));   // an even mesh is one image
  fig.colorbar(image, { ax });
  fig.toDrawList();
  const d = fig1().ax.hist2d(H.x, H.y, { bins: 6, range: [[-1, 1], [-1.5, 1.5]], density: true });
  d[0].forEach((row, i) => Array.from(row).forEach((v, j) => assert.ok(close(v, R.h_density[i][j]), `density ${i},${j}`)));
  const m = fig1().ax.hist2d(H.x, H.y, { bins: 4, cmin: 50 });
  const mt = m.image._trace;
  assert.ok(Array.from(mt.C || mt.data).some((v) => v !== v), 'cells under cmin are masked');
});

test("stackplot: each layer between matplotlib's lines, every baseline; labels reach the legend", () => {
  const S = MPL.stackplot;
  for (const base of ['zero', 'sym', 'wiggle', 'weighted_wiggle']) {
    const { ax } = fig1();
    const layers = ax.stackplot(S.x, ...S.ys, { baseline: base, labels: ['a', 'b', 'c'] });
    assert.equal(layers.length, 3);
    S.layers[base].forEach((want, k) => {
      const t = layers[k]._trace;
      for (let j = 0; j < S.x.length; j++) {
        const lo = Math.min(t.a[j], t.b[j]), hi = Math.max(t.a[j], t.b[j]);
        assert.ok(close(lo, want.lo[j], 1e-9) && close(hi, want.hi[j], 1e-9), `${base} layer ${k} at ${j}: [${lo}, ${hi}] vs [${want.lo[j]}, ${want.hi[j]}]`);
      }
    });
  }
  const { fig, ax } = fig1();
  ax.stackplot(S.x, S.ys, { labels: ['ore', 'waste', 'low grade'], colors: ['C1', 'C7', 'C2'] });
  ax.legend();
  assert.ok(['ore', 'waste', 'low grade'].every((s) => texts(fig).includes(s)));
});

test("the minus sign is matplotlib's U+2212 where matplotlib uses it, and rcParams['axes.unicode_minus'] turns it off", () => {
  const { fig, ax } = fig1();
  ax.plot([-3, 3], [-2, 2]);
  assert.ok(texts(fig).includes('−2') && !texts(fig).includes('-2'), texts(fig).join(' '));
  // a {} template: the minus inside each field, its literal text left alone; %-style and
  // functions print what they're given (matplotlib's FormatStrFormatter / FuncFormatter)
  ax.xaxis.set_major_formatter('{x:.0f} m-ish');
  assert.ok(texts(fig).includes('−2 m-ish'), texts(fig).join(' '));
  ax.xaxis.set_major_formatter(new P.ticker.FormatStrFormatter('%.0f'));
  assert.ok(texts(fig).includes('-2'));
  ax.xaxis.set_major_formatter((x) => `${x}`);
  assert.ok(texts(fig).includes('-2'));
  // a colorbar's labels too; format= is matplotlib's (a {} string, a %-string)
  const g = fig1();
  const im = g.ax.imshow([[-1, 0], [1, 2]]);
  const cb = g.fig.colorbar(im, { ax: g.ax });
  assert.ok(texts(g.fig).includes('−1.0') || texts(g.fig).includes('−1'), texts(g.fig).join(' '));
  g.ax.colorbar(im, { format: '%.1f t' });
  assert.ok(texts(g.fig).includes('-1.0 t'));
  g.ax.colorbar(im, { format: '{x:.2f}' });
  assert.ok(texts(g.fig).includes('−1.00'));
  void cb;
  P.rcParams['axes.unicode_minus'] = false;
  try { assert.ok(texts(fig1().fig).length >= 0 && texts((() => { const h = fig1(); h.ax.plot([-3, 3]); return h.fig; })()).includes('-2')); }
  finally { P.rcParams['axes.unicode_minus'] = true; }
});

test("legend(loc='best') avoids filled areas too: a fill_between band, a polygon, a span", () => {
  const corner = (fig, ax, label) => {
    const op = fig.toDrawList().ops.find((o) => o[0] === 'fillText' && o[1] === label);
    const v = ax.view;
    return `${op[3] < v.y + v.h / 2 ? 'upper' : 'lower'} ${op[2] < v.x + v.w / 2 ? 'left' : 'right'}`;
  };
  // the gallery's errorbar case: the band fills the lower right and the middle
  const x = [1, 2, 3, 4, 5, 6], y = [2.1, 2.9, 3.4, 4.8, 5.1, 6.3], e = [0.3, 0.4, 0.2, 0.6, 0.4, 0.5];
  const a = fig1();
  a.ax.fill_between(x, y.map((v, i) => v - 2 * e[i]), y.map((v, i) => v + 2 * e[i]), { label: 'band' });
  a.ax.legend();
  assert.equal(corner(a.fig, a.ax, 'band'), 'upper left');
  // a polygon filling the upper half
  const b = fig1();
  b.ax.fill([0, 10, 10, 0], [5, 5, 10, 10], { label: 'poly' });
  b.ax.plot([0, 10], [0, 10], { alpha: 0 });
  b.ax.legend();
  assert.ok(corner(b.fig, b.ax, 'poly').startsWith('lower'), corner(b.fig, b.ax, 'poly'));
  // a span down the left
  const c = fig1();
  c.ax.plot([0, 10], [0, 10], 'w', { label: 'line' });
  c.ax.axvspan(0, 4, { label: 'span' });
  c.ax.legend();
  assert.equal(corner(c.fig, c.ax, 'span'), 'lower right');            // the only corner with neither the line nor the span
});

test('the model eval\'s B1: every subplots axes array has its own .flat (1-D too), ravel(), flatten(), shape', () => {
  const [, col] = P.subplots(2, 1);
  assert.ok(Array.isArray(col.flat), 'a 1-D array\'s .flat is the axes, not Array.prototype.flat');
  const [a1, a2] = col.flat ? col.flat : col;                     // the swath pages' idiom
  assert.ok(a1 && a2 && a1 !== a2);
  assert.deepEqual(col.shape, [2]);
  const [, grid] = P.subplots(2, 3);
  assert.equal(grid.flat.length, 6); assert.equal(grid.ravel().length, 6); assert.equal(grid.flatten()[5], grid[1][2]);
  assert.deepEqual(grid.shape, [2, 3]);
  assert.equal(JSON.stringify(col.map(() => 1)), '[1,1]', 'not enumerable');
});

test("matplotlib's positional arguments are read, not dropped (the eval's B2 and its kin)", () => {
  const ax = () => fig1().ax;
  let a = ax(); a.scatter([1, 2], [1, 2], [10, 20], { color: 'r' });              // B2: sizes, then the options
  assert.deepEqual(Array.from(a._traces[0].s), [10, 20]); assert.equal(a._traces[0].opts.color, '#ff0000');
  assert.equal(ax().hist([1, 2, 3, 4, 5, 6, 7, 8], 4)[1].length, 5, 'hist(x, bins)');
  assert.equal(P.close('all') ?? P.hist([1, 2, 3, 4], 2)[1].length, 3, 'plt.hist(x, bins)');
  a = ax(); a.errorbar([1, 2], [1, 2], [0.5, 0.5]); assert.ok(a._traces.some((t) => t.yerr), 'errorbar(x, y, yerr)');
  assert.equal(ax().bar([1, 2], [1, 2], 0.5)[0].width, 0.5, 'bar(x, h, width)');
  assert.equal(ax().hist2d([1, 2, 3], [1, 2, 3], 5)[1].length, 6, 'hist2d(x, y, bins)');
  assert.ok(ax().hexbin([1, 2, 3], [1, 2, 3], [5, 6, 7])._trace.opts.C, 'hexbin(x, y, C)');
  a = ax(); a.imshow([[1, 2], [3, 4]], 'magma'); assert.equal(a._traces[0].opts.cmap, 'magma', 'imshow(Z, cmap)');
  a = ax(); a.imshow([1, 2, 3, 4], 2, 2); assert.equal(a._traces[0].nx, 2, 'the flat form keeps its numbers');
  a = ax(); a.axhline(1, 0.2, 0.8); assert.equal(a._traces[0].opts.xmin, 0.2, 'axhline(y, xmin, xmax)');
  a = ax(); a.grid(true, 'minor'); assert.equal(a._gridOpts.which, 'minor', 'grid(b, which)');
  a = ax(); a.fill_between([1, 2, 3], [1, 2, 3], 0, [true, false, true]); assert.deepEqual(a._traces[0].where, [true, false, true]);
  // given twice: the name wins, with a word; past the known ones: a word (strict: throws)
  assert.throws(() => P.subplots(1, 1, { strict: true })[1].bar([1, 2], [1, 2], 0.5, { width: 0.3 }), /given both by position and by name/);
  assert.throws(() => P.subplots(1, 1, { strict: true })[1].axhline(1, 0.1, 0.2, 0.3), /pass the rest by name/);
});

test("artists: set_visible / get_visible / remove on what calls return (lines, mappables, geometry, patches)", () => {
  const { fig, ax } = fig1();
  const [l] = ax.plot([1, 2, 3], { label: 'L' });
  const sc = ax.scatter([1, 2], [2, 1], { label: 'S' });
  const g = ax.add_geometry({ type: 'Point', coordinates: [1, 1] }, { label: 'G' });
  ax.legend();
  const leg = () => texts(fig).filter((s) => /^[LSG]$/.test(s)).join('');
  assert.equal(leg(), 'LSG');
  l.set_visible(false);
  assert.equal(leg(), 'SG');
  assert.equal(l.get_visible(), false);
  sc.set_visible(false);
  assert.equal(leg(), 'G');
  fig.toDrawList();
  assert.equal(ax.pick(...ax.toPixel(1, 2)), null, 'a hidden scatter does not pick');
  g.remove();
  assert.equal(ax._traces.length, 2);
  l.set_visible(true);
  assert.equal(leg(), 'L');
  const p = ax.add_patch(new P.Rectangle([0, 0], 1, 1));
  assert.equal(p.get_visible(), true);
  p.remove();
  assert.equal(ax._traces.length, 2);
});

test('pyplot: plt.violinplot / hexbin / hist2d / stackplot / minorticks_on / ticker / dates; adder imports matplotlib.ticker', async () => {
  P.close('all');
  P.pltAdder.hexbin([1, 2, 3], [1, 2, 3], { gridsize: 5 });
  P.pltAdder.minorticks_on();
  assert.ok(P.gca()._traces.some((t) => t.type === 'hexbin') && P.gca()._ticker('x').minorOn);
  assert.equal(P.pltAdder.ticker.PercentFormatter, P.ticker.PercentFormatter);
  P.close('all');
  const S = await import('../ext/ipynb/src/substitutions.js');
  const src = S.rewriteImports('import matplotlib.ticker as mticker\nfrom matplotlib.dates import DateFormatter').source;
  assert.ok(src.includes('import plt.ticker as mticker') && src.includes('from plt.dates import DateFormatter'), src);
});
