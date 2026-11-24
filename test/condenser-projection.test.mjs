// @gcu/condenser — the projection's pure pieces (gl-mip.js): the decode that says
// what an accumulated pixel holds, and the define injection that builds a program's
// projection twin. The GPU side is guarded end to end in micro-smoke2 §129 (a plan
// view against the brute-force per-column max / min / mean).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeProjection, PROJECTION_MODES } from '../ext/condenser/src/core/gl-mip.js';
import { withDefines } from '../ext/condenser/src/core/gl-util.js';
import * as bundle from '../ext/condenser/index.js';
import * as core from '../ext/condenser/core.js';

test('the modes', () => {
  assert.deepEqual(PROJECTION_MODES, ['max', 'min', 'mean']);
});

test('float max: −1 is nothing hit, 0 is a value', () => {
  assert.equal(decodeProjection(0, -1, 0, 0), null);
  assert.equal(decodeProjection(0, 0, 0, 0), 0);
  assert.equal(decodeProjection(0, 0.75, 0, 0), 0.75);
});

test('float min: 2 is nothing hit, 1 is a value', () => {
  assert.equal(decodeProjection(1, 2, 0, 0), null);
  assert.equal(decodeProjection(1, 1, 0, 0), 1);
  assert.equal(decodeProjection(1, 0.25, 0, 0), 0.25);
});

test('8-bit: alpha is the hit flag, so value 0 and nothing hit differ', () => {
  assert.equal(decodeProjection(2, 0, 0, 0), null);
  assert.equal(decodeProjection(2, 0, 1, 1), 0);
  assert.equal(decodeProjection(2, 0.5, 1, 1), 0.5);
});

test('mean: the sum over the count; no count is nothing hit', () => {
  assert.equal(decodeProjection(3, 0, 0, 0), null);
  assert.equal(decodeProjection(3, 1.5, 3, 0), 0.5);
  assert.equal(decodeProjection(3, 0, 4, 0), 0);
});

test('withDefines puts the defines right after #version, and nothing else changes', () => {
  const src = '#version 300 es\nprecision highp float;\nvoid main() {}';
  assert.equal(withDefines(src, ''), src);
  assert.equal(withDefines(src, '#define MIP 1'), '#version 300 es\n#define MIP 1\nprecision highp float;\nvoid main() {}');
});

test('both bundles export it', () => {
  for (const b of [bundle, core]) {
    assert.equal(typeof b.createMipPipeline, 'function');
    assert.equal(typeof b.decodeProjection, 'function');
    assert.deepEqual(b.PROJECTION_MODES, ['max', 'min', 'mean']);
  }
});
