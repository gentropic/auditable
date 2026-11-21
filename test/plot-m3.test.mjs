// plot M3 (spec_inbox/plot-world-class-SPEC.md §7 plan views, §9a axes as chrome, §10 export,
// §9 interaction): Node, the recording context, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = await import('../ext/plot/index.js');
const fig1 = (o) => { const [fig, ax] = P.subplots(1, 1, { figsize: [400, 300], ...(o || {}) }); return { fig, ax }; };
const ops = (fig) => fig.toDrawList().ops;
const texts = (fig) => ops(fig).filter((o) => o[0] === 'fillText').map((o) => o[1]);

const LEASES = {
  type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 80], [0, 80], [0, 0]], [[30, 20], [60, 20], [60, 50], [30, 50], [30, 20]]] } },
    { type: 'Feature', properties: { name: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[200, 0], [260, 0], [260, 40], [200, 0]]]] } },
    { type: 'Feature', properties: { name: 'road' }, geometry: { type: 'LineString', coordinates: [[-10, 90], [120, 40]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[10, 10], [90, 70]] } },
  ],
};

// ── plan views ──

test('add_geometry: polygons with holes fill even-odd, lines and points join them, the extent covers all', () => {
  const { fig, ax } = fig1();
  const arts = ax.add_geometry(LEASES, { facecolor: 'tab:green', edgecolor: 'k', alpha: 0.5, label: 'leases' });
  assert.equal(arts.length, 3, 'one polygon artist, one line, one scatter');
  const types = ax._traces.map((t) => t.type);
  assert.deepEqual(types, ['polygon', 'line', 'scatter']);
  assert.equal(ax._traces[0].parts.length, 2);
  assert.equal(ax._traces[0].parts[0].rings.length, 2, 'outline + hole');
  const L = ops(fig);
  assert.equal(L.filter((o) => o[0] === 'fill' && o[1] === 'evenodd').length, 1);
  const [x0, x1] = ax.get_xlim(), [y0, y1] = ax.get_ylim();
  assert.ok(x0 <= -10 && x1 >= 260 && y0 <= 0 && y1 >= 90, `${x0} ${x1} ${y0} ${y1}`);
  ax.legend();
  assert.ok(texts(fig).includes('leases'));
});

test('a pick inside a polygon returns its feature; inside the hole, nothing', () => {
  const { fig, ax } = fig1();
  ax.add_geometry(LEASES);
  fig.toDrawList();
  assert.deepEqual(ax.pick(...ax.toPixel(10, 60)).properties, { name: 'A' });
  assert.deepEqual(ax.pick(...ax.toPixel(240, 10)).properties, { name: 'B' });
  assert.equal(ax.pick(...ax.toPixel(45, 35)), null, 'the hole is not the lease');
});

test('fill(x, y, fmt) and the patches: Polygon, Rectangle (rotated about its corner), Circle', () => {
  const { fig, ax } = fig1();
  const [p] = ax.fill([0, 2, 1], [0, 0, 1], 'r');
  assert.equal(p.get_facecolor(), '#ff0000');
  const r = ax.add_patch(new P.Rectangle([0, 0], 2, 1, { angle: 90, facecolor: 'none', edgecolor: 'b' }));
  const xy = r.get_xy().map(([a, b]) => [Math.round(a * 1e9) / 1e9, Math.round(b * 1e9) / 1e9]);
  assert.deepEqual(xy, [[0, 0], [0, 2], [-1, 2], [-1, 0]]);
  const c = ax.add_patch(new P.Circle([5, 5], 2));
  assert.equal(c.axes, ax);
  const xs = c.get_xy().map((q) => q[0]);
  assert.ok(Math.abs(Math.max(...xs) - 7) < 1e-9 && Math.abs(Math.min(...xs) - 3) < 1e-3);
  ax.add_patch(new P.Polygon([[10, 0], [11, 0], [11, 1]], { closed: false, fill: false }));
  const L = ops(fig);
  assert.ok(L.some((o) => o[0] === 'set' && o[1] === 'strokeStyle' && o[2] === '#0000ff'));
  assert.throws(() => ax.add_patch({}), /Polygon, Rectangle or Circle/);
});

test('scalebar: a nice length, metres as km from 1,000; north arrow up, down on an inverted y', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 5000], [0, 3000]);
  ax.set_aspect('equal');
  ax.scalebar();
  ax.north_arrow();
  const t = texts(fig);
  assert.ok(t.includes('1 km'), t.join(' '));
  assert.ok(t.includes('N'));
  const g = fig1();
  g.ax.plot([0, 140], [0, 1]);
  g.ax.scalebar({ units: 'ft', loc: 'upper left' });
  assert.ok(texts(g.fig).includes('20 ft'));
  const h = fig1();
  h.ax.plot([0, 140], [0, 100]);
  h.ax.scalebar({ length: 50, label: 'fifty' });
  assert.ok(texts(h.fig).includes('fifty'));
  assert.throws(() => P.subplots(1, 1, { strict: true })[1].scalebar({ loc: 'middle' }), /loc must be/);
});

// ── axes as chrome (§9a) ──

test('chrome only: no face, the limits from another renderer, equal aspect widens one range', () => {
  const { fig, ax } = fig1();
  fig.set_facecolor('none');
  ax.set_facecolor('none');
  ax.set_view({ rect: { u0: 500000, u1: 501000, v0: 7000000, v1: 7000600 } });
  ax.set_aspect('equal');
  ax.set_xlabel('E'); ax.set_ylabel('N');
  const L = ops(fig);
  assert.equal(L.filter((o) => o[0] === 'fillRect').length, 0, 'nothing filled: the canvas under it shows through');
  const [x0, x1] = ax.get_xlim(), [y0, y1] = ax.get_ylim();
  assert.deepEqual([x0, x1], [500000, 501000]);
  const v = ax.view;
  assert.ok(Math.abs((x1 - x0) / v.w - (y1 - y0) / v.h) < 1e-9, 'one data unit per pixel both ways');
  assert.ok(y0 < 7000000 && y1 > 7000600);
  assert.ok(texts(fig).includes('500,000') || texts(fig).some((s) => /^500/.test(s)), texts(fig).join(' '));
  ax.set_view({ xlim: [0, 10], ylim: [0, 5] });
  ax.set_aspect('auto');
  fig.toDrawList();
  assert.deepEqual(ax.get_ylim(), [0, 5]);
  assert.throws(() => ax.set_view(null), /set_view/);
});

test('a colorbar with nothing behind it: colorbar({cmap, vmin, vmax}) and ScalarMappable(norm)', () => {
  const { fig, ax } = fig1();
  ax.set_facecolor('none');
  ax.colorbar({ cmap: 'magma', vmin: 0, vmax: 3.5, label: 'Fe %' });
  const t = texts(fig);
  assert.ok(t.includes('Fe %') && t.includes('3') && !t.includes('4'), t.join(' '));
  const g = fig1();
  const sm = new P.ScalarMappable({ norm: new P.LogNorm(1, 1000), cmap: 'viridis' });
  sm.set_array([]);
  g.fig.colorbar(sm, { ax: g.ax, label: 'ppm' });
  const t2 = texts(g.fig);
  for (const s of ['1', '10', '100', '1000', 'ppm']) assert.ok(t2.includes(s), `${s} in ${t2.join(' ')}`);
  assert.equal(P.pltAdder.cm.ScalarMappable, P.ScalarMappable);
  // classes: a BoundaryNorm gives a banded bar
  const h = fig1();
  h.ax.colorbar(new P.ScalarMappable({ norm: new P.BoundaryNorm([0, 1, 2, 5], 256), cmap: 'viridis' }));
  assert.ok(texts(h.fig).includes('5'));
});
