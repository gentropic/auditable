// micro's weighted moments (tools/micro/src/kernels.js): West's weighted Welford +
// Chan's merge. The stats window's page, worker and any chunking must give the same
// mean and std — the old Σwx² − mean² form lost ~1e-10 relative to cancellation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentAdd, momentMerge, momentStd } from '../ext/scan/src/kernels.js';

const rnd = (s) => () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
const fresh = () => ({ sw: 0, mean: 0, m2: 0 });
// the reference: two passes, mean first
function twoPass(x, w) {
  let sw = 0, swx = 0;
  for (let i = 0; i < x.length; i++) { sw += w[i]; swx += w[i] * x[i]; }
  const mean = swx / sw;
  let m2 = 0;
  for (let i = 0; i < x.length; i++) m2 += w[i] * (x[i] - mean) ** 2;
  return { mean, std: Math.sqrt(m2 / sw) };
}
function sample(n, centre, spread, seed) {
  const r = rnd(seed), x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = centre + spread * (r() - 0.5); w[i] = 0.5 + 2 * r(); }
  return { x, w };
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

test('one pass matches the two-pass reference', () => {
  const { x, w } = sample(100000, 2.7, 0.5, 7);
  const a = fresh();
  for (let i = 0; i < x.length; i++) momentAdd(a, x[i], w[i]);
  const ref = twoPass(x, w);
  assert.ok(rel(a.mean, ref.mean) < 1e-14);
  assert.ok(rel(momentStd(a), ref.std) < 1e-12);
});

test('merged chunks agree with one pass, whatever the chunking', () => {
  const { x, w } = sample(60000, 2.7, 0.3, 11);
  const one = fresh();
  for (let i = 0; i < x.length; i++) momentAdd(one, x[i], w[i]);
  for (const size of [1, 7, 1000, 25000]) {
    const m = fresh();
    for (let s = 0; s < x.length; s += size) {
      const p = fresh();
      for (let i = s; i < Math.min(x.length, s + size); i++) momentAdd(p, x[i], w[i]);
      momentMerge(m, p);
    }
    assert.ok(rel(m.mean, one.mean) < 1e-13, `mean, chunk ${size}`);
    assert.ok(rel(momentStd(m), momentStd(one)) < 1e-12, `std, chunk ${size}`);
    assert.ok(rel(m.sw, one.sw) < 1e-13);
  }
});

test('a small spread next to a large mean keeps its digits (Σwx² does not)', () => {
  const { x, w } = sample(50000, 7.5e6, 0.01, 3);    // a northing ± a centimetre
  const a = fresh();
  for (let i = 0; i < x.length; i++) momentAdd(a, x[i], w[i]);
  const ref = twoPass(x, w);
  assert.ok(rel(momentStd(a), ref.std) < 1e-6);
  // the old form, for contrast: it has no correct digits left here
  let sw = 0, swx = 0, swx2 = 0;
  for (let i = 0; i < x.length; i++) { sw += w[i]; swx += w[i] * x[i]; swx2 += w[i] * x[i] * x[i]; }
  const mean = swx / sw, old = Math.sqrt(Math.max(0, swx2 / sw - mean * mean));
  assert.ok(rel(old, ref.std) > 1e-2);
});

test('empty partials merge as nothing; a lone value has zero spread', () => {
  const a = fresh(), b = fresh();
  momentMerge(a, b);
  assert.equal(a.sw, 0);
  assert.ok(Number.isNaN(momentStd(a)));
  momentAdd(b, 3.25, 2);
  momentMerge(a, b);
  assert.equal(a.mean, 3.25);
  assert.equal(momentStd(a), 0);
  momentMerge(a, fresh());
  assert.equal(a.mean, 3.25);
});
