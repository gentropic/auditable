// plot M3 (spec_inbox/plot-world-class-SPEC.md §7 plan views, §9a axes as chrome, §10 export,
// §9 interaction): Node, the recording context, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

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

// ── export (§10) ──

// a PNG's pixels back, through Node's zlib and the PNG row filters
function decodePNG(png) {
  const b = Buffer.from(png);
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const at = b.indexOf('IDAT'), len = b.readUInt32BE(at - 4);
  const raw = zlib.inflateSync(b.subarray(at + 4, at + 4 + len));
  const stride = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], left = x >= 4 ? out[y * stride + x - 4] : 0, up = y ? out[(y - 1) * stride + x] : 0;
      out[y * stride + x] = (f === 0 ? v : f === 1 ? v + left : v + up) & 255;
    }
  }
  return { w, h, rgba: out };
}

test('encodePNG: zlib reads it, the pixels come back exactly, repeats compress', () => {
  for (const [w, h, fill] of [[1, 1, () => 7], [37, 23, (i) => (i * 7 + (i >> 5)) & 255], [300, 200, (i) => ((i >> 2) % 300 >> 4) * 9 & 255]]) {
    const rgba = Uint8Array.from({ length: w * h * 4 }, (_, i) => fill(i));
    const back = decodePNG(P.encodePNG(rgba, w, h));
    assert.equal(back.w, w); assert.equal(back.h, h);
    assert.deepEqual(back.rgba, rgba);
  }
  const flat = new Uint8Array(500 * 500 * 4).fill(128);
  assert.ok(P.encodePNG(flat, 500, 500).length < 10000, 'a flat 1 MB raster is a few KB (fixed Huffman: 13 bits per 258-byte match)');
});

test('toSVG: deterministic, escaped, clipped, the raster embedded as a PNG of its pixels', () => {
  const { fig, ax } = fig1();
  ax.plot([0, 1, 2], [1, 3, 2], '--', { label: 'a & <b>' });
  ax.imshow([[0, 1], [2, 3]], { extent: [0, 2, 0, 3], alpha: 0.5 });
  ax.set_title('"quoted"');
  ax.legend();
  ax.text(1, 2, 'tilted', { rotation: 45 });
  const svg = fig.toSVG();
  assert.equal(svg, fig.toSVG(), 'the same figure, the same bytes');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="400" height="300" viewBox="0 0 400 300">/);
  assert.ok(svg.includes('a &amp; &lt;b&gt;') && svg.includes('&quot;quoted&quot;'));
  assert.ok(!/<text[^>]*>[^<]*[<>&"][^<]*<\/text>/.test(svg.replace(/&(amp|lt|gt|quot);/g, '')), 'nothing raw inside text');
  assert.match(svg, /<clipPath id="pc1"><path d="M[\d. ]+L/);
  assert.match(svg, /<g clip-path="url\(#pc1\)">/);
  assert.match(svg, /stroke-dasharray="[\d. ]+"/);
  assert.match(svg, /transform="rotate\(-45 /, 'rotated text turns about its anchor');
  const m = /<image [^>]*opacity="0.5"[^>]*href="data:image\/png;base64,([^"]+)"/.exec(svg);
  assert.ok(m, 'the raster, with its alpha');
  const png = decodePNG(Buffer.from(m[1], 'base64'));
  assert.equal(png.w * png.h, 4);
  const op = fig.toDrawList().ops.find((o) => o[0] === 'image');
  assert.deepEqual(png.rgba, Uint8Array.from(Buffer.from(op[7], 'base64')));
  // balanced tags (a cheap well-formedness check)
  const open = (svg.match(/<g /g) || []).length, close = (svg.match(/<\/g>/g) || []).length;
  assert.equal(open, close);
  assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length);
});

test('an export paints the theme background under a transparent figure; set_facecolor("none") stays clear', () => {
  const { fig, ax } = fig1();                                   // dark: the figure surface is transparent
  ax.plot([1, 2]);
  const bg = P.resolveTheme('dark').background.toLowerCase();
  assert.ok(fig.toSVG().includes(`<rect width="400" height="300" fill="${bg}"/>`));
  assert.ok(!fig.toSVG({ facecolor: null }).includes('<rect width="400"'));
  fig.set_facecolor('none');
  assert.ok(!fig.toSVG().includes('<rect width="400"'), 'chrome over a renderer: nothing under it');
  const p = fig1({ theme: 'paper' });
  p.ax.plot([1, 2]);
  const svgP = p.fig.toSVG();
  assert.ok(!svgP.includes('<rect width="400"') && svgP.includes('<rect x="0" y="0" width="400" height="300" fill="#ffffff"/>'), 'paper paints its own white face, once');
});

test('savefig: the format from the name or {format}; with no DOM the host gets {name, format, figure}', () => {
  P.close('all');
  const { fig } = fig1();
  fig.savefig('map.svg');
  fig.savefig('map', { format: 'png' });
  fig.savefig({ fname: 'x.SVG' });
  assert.deepEqual(P.pltAdder.saved().map((s) => [s.name, s.format]), [['map.svg', 'svg'], ['map', 'png'], ['x.SVG', 'svg']]);
  assert.throws(() => fig.savefig('a.pdf'), /'pdf' is not supported; use 'png' or 'svg'/);
  P.close('all');
});
