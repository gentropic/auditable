// @gcu/stereonet's core: layers → scene (primitives + statistics) → a bearing net, picking; and attitude text.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../ext/bearing/index.js';
import { stereonetCore, nearestPick, formatPlane, formatLine } from '../ext/stereonet/src/main.js';

const core = stereonetCore(B);
const tocher = readFileSync(new URL('../tools/wuffle/samples/tocher.csv', import.meta.url), 'utf8')
  .split('\n').filter((l) => /^\d/.test(l)).map((l, row) => { const [dd, dip] = l.split(',').map(Number); return { row, plane: [dd, dip], pole: B.conversions.planeToDcos(dd, dip) }; });
const layer = (over = {}) => ({ id: 'L1', kind: 'planes', color: '#e07a5f', elements: { poles: { on: true } }, data: tocher, ...over });

describe('the scene', () => {
  it('tocher: 200 poles, each carrying its (layer, row)', () => {
    const s = core.buildScene({ layers: [layer()] });
    const poles = s.primitives.filter((p) => p.type === 'pole');
    assert.equal(poles.length, 200);
    assert.deepEqual(poles[7].ref, { layer: 'L1', row: 7 });
  });
  it('a hidden layer draws nothing; great circles only when asked', () => {
    assert.equal(core.buildScene({ layers: [layer({ visible: false })] }).primitives.length, 0);
    const s = core.buildScene({ layers: [layer({ elements: { poles: { on: false }, greatCircles: { on: true } } })] });
    assert.equal(s.primitives.filter((p) => p.type === 'plane').length, 200);
  });
  it('selected rows wear the selection colour and grow', () => {
    const s = core.buildScene({ layers: [layer({ selected: [3] })], colors: { selected: '#abcdef' } });
    const p = s.primitives.filter((q) => q.type === 'pole');
    assert.equal(p[3].style.fill, '#abcdef');
    assert.ok(p[3].style.r > p[4].style.r);
  });
  it('one contour set per net: the first layer that asks; the second gets a note', () => {
    const c = { poles: { on: true }, contours: { on: true, method: 'kamb', sigma: 3 } };
    const s = core.buildScene({ layers: [layer({ elements: c }), layer({ id: 'L2', elements: c })] });
    const cs = s.primitives.filter((p) => p.type === 'contour');
    assert.equal(cs.length, 1); assert.equal(cs[0].layer, 'L1');
    assert.deepEqual(cs[0].options.levels, [2, 4, 6, 8, 10, 12]);
    assert.match(s.notes[0], /L2/);
  });
  it('statistics: the axial mean and cone are bearing’s, and both appear as primitives', () => {
    const s = core.buildScene({ layers: [layer({ elements: { mean: { on: true, confidence: 0.95 } } })] });
    const f = B.statistics.fisherStats(tocher.map((d) => d.pole), { axial: true });
    assert.ok(Math.abs(s.stats.L1.mean.kappa - f.kappa) < 1e-12);
    assert.ok(s.stats.L1.mean.axial);
    assert.ok(s.primitives.some((p) => p.role === 'mean') && s.primitives.some((p) => p.role === 'cone'));
  });
  it('eigenvectors: V1 pole and V3 great circle when those children are on', () => {
    const s = core.buildScene({ layers: [layer({ elements: { v1Pole: { on: true }, v3Circle: { on: true } } })] });
    assert.deepEqual(s.primitives.filter((p) => p.role).map((p) => `${p.role}:${p.type}`).sort(), ['v1:line', 'v3:plane']);
    assert.equal(s.stats.L1.eigen.values.length, 3);
  });
  it('lines draw as points with their own dcos', () => {
    const s = core.buildScene({ layers: [{ id: 'Ln', kind: 'lines', color: '#000', elements: { points: { on: true } }, data: [{ row: 0, line: [120, 30], dcos: B.conversions.lineToDcos(120, 30) }] }] });
    assert.equal(s.primitives[0].type, 'line');
    assert.equal(s.primitives[0].trend, 120);
  });
});

describe('faults', () => {
  const F = (dd, dip, tr, pl, sense) => ({ pole: B.conversions.planeToDcos(dd, dip), plane: [dd, dip], lineDcos: B.conversions.lineToDcos(tr, pl), line: [tr, pl], sense });
  const fl = (elements, rows) => ({ id: 'F', kind: 'faults', color: '#000', elements, data: rows.map((r, row) => ({ row, ...r })) });
  it('slip: the slickenline as a pickable point, with an arrow (shaft + head) for a defined sense', () => {
    const s = core.buildScene({ layers: [fl({ slip: { on: true } }, [F(90, 60, 90, 60, 'N'), F(90, 60, 90, 60, 'U')])] });
    assert.equal(s.primitives.filter((p) => p.type === 'line' && p.ref).length, 2);
    assert.equal(s.primitives.filter((p) => p.type === 'curve').length, 2, 'one arrow (shaft + head): the unknown sense gets none');
  });
  it('the arrow points away from the centre for a normal fault, toward it for a reverse one', () => {
    const plungeOfTip = (sense) => { const s = core.buildScene({ layers: [fl({ slip: { on: true } }, [F(90, 60, 90, 60, sense)])] }); const shaft = s.primitives.find((p) => p.type === 'curve').points; return [B.conversions.dcosToLine(shaft[0])[1], B.conversions.dcosToLine(shaft[1])[1]]; };
    const [n0, n1] = plungeOfTip('N'), [r0, r1] = plungeOfTip('R');
    assert.ok(n1 < n0, `normal: the tip is shallower, nearer the primitive (${n0} → ${n1})`);
    assert.ok(r1 > r0, `reverse: the tip is steeper, nearer the centre (${r0} → ${r1})`);
  });
  it('a strike-slip arrow shows its sense: dextral and sinistral point opposite ways, and neither is zero length', () => {
    // an E–W fault dipping south (strike 090), slickenline horizontal along strike, plotted at the east rim.
    // Dextral: the hanging wall (south) moves WEST, so the arrow points west (into the net from the point);
    // sinistral: EAST, outward at the rim, so it ends at the point with its head there.
    const net = core.renderScene({ primitives: [] }, { size: 400 }).net;
    const arrow = (sense) => {
      const s = core.buildScene({ layers: [fl({ slip: { on: true } }, [F(180, 60, 90, 0, sense)])] });
      const [a, b] = s.primitives.find((p) => p.type === 'curve').points.map((d) => net.project(d));
      return { dx: b.x - a.x, len: Math.hypot(b.x - a.x, b.y - a.y) };
    };
    const dx = arrow('dextral'), sx = arrow('sinistral');
    assert.ok(dx.len > 5 && sx.len > 5, `both drawn (${dx.len.toFixed(1)}, ${sx.len.toFixed(1)} px)`);
    assert.ok(dx.dx < 0, `dextral points west (dx ${dx.dx.toFixed(1)})`);
    assert.ok(sx.dx > 0, `sinistral points east (dx ${sx.dx.toFixed(1)})`);
  });
  it('P and T axes: P steep for a normal fault; the dihedra primitive carries planes and slips', () => {
    const s = core.buildScene({ layers: [fl({ ptAxes: { on: true }, dihedra: { on: true } }, [F(90, 60, 90, 60, 'N')])] });
    const P = s.primitives.find((p) => p.role === 'P');
    assert.ok(P.plunge > 60, `P plunges ${P.plunge}`);
    assert.equal(s.primitives.find((p) => p.type === 'dihedra').planes.length, 1);
    assert.ok(core.renderScene(s, { size: 300 }).net, 'renders (the dihedra field contoured at 0)');
  });
});

describe('render and pick', () => {
  it('without a DOM: no svg, but a pick per measurement; the nearest pick finds a drawn pole', () => {
    const scene = core.buildScene({ layers: [layer()] });
    const r = core.renderScene(scene, { size: 400 });
    assert.equal(r.svg, null);
    assert.equal(r.picks.length, 200);
    const k = r.picks[42];
    assert.deepEqual(nearestPick(r.picks, k.x + 1, k.y - 1)?.ref.row, 42);
    assert.equal(nearestPick(r.picks, -100, -100), null);
  });
  it('the core refuses to start without bearing (it injects, never imports)', () => {
    assert.throws(() => stereonetCore({}), /pass the @gcu\/bearing module/);
  });
});

describe('figures: drawScene and the compo frame kind', () => {
  // a recording context: every call is a [name, …args] entry — enough to see the net was drawn, scaled and placed
  const recorder = () => {
    const ops = []; const handler = { get: (t, k) => (k === 'ops' ? ops : (...a) => { ops.push([k, ...a]); }), set: (t, k, v) => { ops.push(['set', k, v]); return true; } };
    return new Proxy({}, handler);
  };
  it('drawScene draws the net (its contours and poles too) scaled into the given box', () => {
    const scene = core.buildScene({ layers: [layer({ elements: { poles: { on: true }, contours: { on: true } } })] });
    const ctx = recorder();
    core.drawScene(ctx, scene, { x: 10, y: 20, size: 60 });
    const ops = ctx.ops;
    assert.deepEqual(ops.find((o) => o[0] === 'translate'), ['translate', 10, 20]);
    assert.deepEqual(ops.find((o) => o[0] === 'scale'), ['scale', 60 / 400, 60 / 400]);
    assert.ok(ops.filter((o) => o[0] === 'arc').length >= 200, 'a circle per pole (+ the primitive)');
    assert.ok(ops.filter((o) => o[0] === 'stroke').length > 20, 'grid, contours, rim');
  });
  it('the compo kind centres a square net in its frame and draws on paper colours', () => {
    const k = core.compoKind(), ctx = recorder();
    k.draw(ctx, [0, 0, 100, 60], { content: { scene: core.buildScene({ layers: [layer()] }), net: { projection: 'equal-area' } } });
    assert.deepEqual(ctx.ops.find((o) => o[0] === 'translate'), ['translate', 20, 0]);
    assert.ok(ctx.ops.some((o) => o[0] === 'set' && o[1] === 'fillStyle' && String(o[2]).toUpperCase() === '#FFFFFF'), 'the paper ground');
    assert.equal(k.label, 'stereonet');
  });
});

describe('attitudes as text', () => {
  it('planes as dip direction/dip, lines as trend→plunge, zero-padded and wrapped', () => {
    assert.equal(formatPlane([45.4, 7.6]), '045/08');
    assert.equal(formatLine([359.7, 32]), '000→32');
    assert.equal(formatLine([-15, 5]), '345→05');
  });
});

describe('labels', () => {
  it('a label per measurement, at its pole: d.label, else the row number; selected rows in the selection colour', () => {
    const data = tocher.slice(0, 3).map((d, i) => ({ ...d, label: i === 1 ? 'S2' : undefined }));
    const s = core.buildScene({ layers: [layer({ data, selected: [2], elements: { poles: { on: false }, labels: { on: true } } })], colors: { selected: '#abcdef' } });
    const t = s.primitives.filter((p) => p.type === 'text');
    assert.deepEqual(t.map((x) => x.content), ['1', 'S2', '3']);
    assert.equal(t[2].style.fill, '#abcdef');
    const [tr, pl] = B.conversions.dcosToLine(tocher[0].pole);
    assert.ok(Math.abs(t[0].trend - tr) < 1e-9 && Math.abs(t[0].plunge - pl) < 1e-9);
    assert.match(core.renderScene(s, { size: 300 }).net.svg(), />S2</);
  });
});

describe('contours: filled, your levels, weights; the graticule off', () => {
  it('filled contours: a banded fill UNDER the lines, at the same levels, light to the layer colour', () => {
    const s = core.buildScene({ layers: [layer({ elements: { contours: { on: true, method: 'kamb', filled: true, levels: [6, 2, 4] } } })] });
    const k = s.primitives.findIndex((p) => p.type === 'fill'), c = s.primitives.findIndex((p) => p.type === 'contour');
    assert.ok(k >= 0 && k < c, 'the fill first, the lines over it');
    assert.deepEqual(s.primitives[c].options.levels, [2, 4, 6], 'your levels, sorted');
    assert.deepEqual(s.primitives[k].options.levels, [2, 4, 6]);
    assert.equal(s.primitives[k].options.colors.length, 3); assert.equal(s.primitives[k].options.colors[2], '#e07a5f');
    const net = core.renderScene(s, { size: 300 }).net.svg();
    assert.ok((net.match(/<rect/g) || []).length > 50, 'the bands are drawn (cells)');
  });
  it('a datum with a weight weights the contours (a Terzaghi correction)', () => {
    const w = tocher.map((d, i) => ({ ...d, weight: i < 20 ? 5 : 1 }));
    const s = core.buildScene({ layers: [layer({ data: w, elements: { contours: { on: true } } })] });
    const c = s.primitives.find((p) => p.type === 'contour');
    assert.equal(c.options.weights.length, 200); assert.equal(c.options.weights[0], 5);
    const plain = core.buildScene({ layers: [layer({ elements: { contours: { on: true } } })] }).primitives.find((p) => p.type === 'contour');
    assert.equal(plain.options.weights, undefined, 'no weights, none passed');
  });
  it('graticule 0: a net with no graticule', () => {
    const s = core.buildScene({ layers: [layer()] });
    const on = core.renderScene(s, { size: 300 }).net.svg(), off = core.renderScene(s, { size: 300, graticule: 0 }).net.svg();
    assert.ok(off.length < on.length, `${off.length} < ${on.length}`);
  });
});

describe('the layer look (all optional; absent draws as before)', () => {
  const B2 = B, P = (dd, dip, row, extra = {}) => ({ row, plane: [dd, dip], pole: B2.conversions.planeToDcos(dd, dip), ...extra });
  const base = { id: 'a', kind: 'planes', color: '#123456', elements: { poles: { on: true }, greatCircles: { on: true }, labels: { on: true } } };
  it('symbol, hollow and opacity reach the points; a datum colour and size win; selected stays violet', () => {
    const sc = core.buildScene({ layers: [{ ...base, symbol: 'triangle', hollow: true, opacity: 0.6, selected: [1], data: [P(10, 20, 0, { color: '#ff0000', size: 10 }), P(100, 40, 1)] }] });
    const poles = sc.primitives.filter((q) => q.type === 'pole');
    assert.equal(poles[0].style.symbol, 'triangle'); assert.equal(poles[0].style.fill, 'none'); assert.equal(poles[0].style.stroke, '#ff0000');
    assert.equal(poles[0].style.opacity, 0.6); assert.equal(poles[0].style.r, 5.5);
    assert.equal(poles[1].style.fill, '#EC9FFF');
  });
  it('lines: colour, width and dash on the great circles; a selected circle stays solid violet', () => {
    const sc = core.buildScene({ layers: [{ ...base, lines: { color: '#00aa00', width: 1.4, dash: 'dashed' }, selected: [1], data: [P(10, 20, 0), P(100, 40, 1)] }] });
    const gc = sc.primitives.filter((q) => q.type === 'plane');
    assert.deepEqual([gc[0].style.stroke, gc[0].style.strokeWidth, gc[0].style.strokeDasharray], ['#00aa00', 1.4, '6,4']);
    assert.equal(gc[1].style.strokeDasharray, 'none');
  });
  it("contours: 'percent' and 'cosine' with their parameters and default levels; a contour width", () => {
    const data = Array.from({ length: 30 }, (_, i) => P((i * 37) % 360, 20 + (i % 50), i));
    for (const [method, key, val] of [['percent', 'areaPercent', 2], ['cosine', 'cosinePower', 40], ['fisher', 'sigma', 12]]) {
      const contours = { on: true, method, ...(method === 'percent' ? { area: val } : method === 'cosine' ? { power: val } : { kernel: val }) };
      const sc = core.buildScene({ layers: [{ ...base, contourWidth: 1.5, elements: { contours }, data }] });
      const c = sc.primitives.find((q) => q.type === 'contour');
      assert.equal(c.options.method, method); assert.equal(c.options[key], val); assert.equal(c.options.strokeWidth, 1.5);
      if (method === 'percent') assert.deepEqual(c.options.levels, [1, 2, 4, 6, 8, 10]);
    }
  });
  it('labels: their size, and only the selected rows when asked', () => {
    const sc = core.buildScene({ layers: [{ ...base, labelSize: 12, labelsSelectedOnly: true, selected: [1], data: [P(10, 20, 0), P(100, 40, 1)] }] });
    const t = sc.primitives.filter((q) => q.type === 'text');
    assert.equal(t.length, 1); assert.equal(t[0].content, '2'); assert.equal(t[0].style.fontSize, 12);
  });
});
