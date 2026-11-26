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
