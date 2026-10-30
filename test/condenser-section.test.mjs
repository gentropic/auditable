// a layer's view of the section — the one function the draw and the pick share
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerSection, meshSection, offsetSection, desurveyHolePaths } from '../ext/condenser/src/main.js';

const slab = { on: true, n: [1, 0, 0], d: 50, half: 5, d0: 50, clip: 'slab' };
const front = { on: true, n: [1, 0, 0], d: 50 + 1e5, half: 1e5, d0: 50, clip: 'front', traceHalf: 5 };

test('layerSection: follow / off / front / behind keep their meaning', () => {
  assert.equal(layerSection(slab, true), slab);
  assert.equal(layerSection(slab, undefined), slab);                     // unset = follow
  assert.equal(layerSection(slab, false), null);
  const f = layerSection(slab, 'front');
  assert.equal(f.clip, 'front'); assert.ok(f.d - f.half === 50);         // near face at the plane
  const b = layerSection(slab, 'behind');
  assert.ok(b.d + b.half === 50);
  assert.equal(layerSection(null, true), null);
});

test('layerSection { half }: the layer\'s own slab around the plane, whatever the section clip', () => {
  const s = layerSection(slab, { half: 20 });
  assert.deepEqual([s.d, s.half, s.clip], [50, 20, 'slab']);
  const s2 = layerSection(front, { half: 20 });                          // a half-space section → still a slab at d0
  assert.deepEqual([s2.d, s2.half, s2.clip], [50, 20, 'slab']);
  assert.equal(layerSection(slab, { whole: true }), null);              // whole holes: the renderer doesn't cut
  assert.equal(layerSection(slab, { whole: true, half: 20 }), null);
});

test('meshSection: a half-space traces at the plane; an own slab keeps its width', () => {
  const m = meshSection(front, true);
  assert.deepEqual([m.d, m.half], [50, 5]);
  const m2 = meshSection(slab, { half: 20 });
  assert.deepEqual([m2.d, m2.half], [50, 20]);
});

test('offsetSection: a moved layer is cut where it is drawn', () => {
  const s = offsetSection(slab, [10, 0, 0]);
  assert.deepEqual([s.d, s.d0], [40, 40]);
  const s2 = layerSection(slab, { half: 3 }, [10, 0, 0]);
  assert.deepEqual([s2.d, s2.half], [40, 3]);
});

test('desurveyHolePaths: collar → EOH, the EOH reaching the deepest interval when deeper', () => {
  const collars = [{ bhid: 'A', x: 0, y: 0, z: 100 }];
  const surveys = [{ bhid: 'A', depth: 0, az: 0, dip: -90 }, { bhid: 'A', depth: 20, az: 0, dip: -90 }];
  const p1 = desurveyHolePaths(collars, surveys).perHole.get(0);
  assert.deepEqual(p1.map((pt) => Math.round(pt[3])), [100, 80]);       // 0 + the deepest station
  const p2 = desurveyHolePaths(collars, surveys, {}, new Map([['A', 50]])).perHole.get(0);
  assert.deepEqual(p2.map((pt) => Math.round(pt[3])), [100, 80, 50]);   // extended to the deepest interval TO
});
