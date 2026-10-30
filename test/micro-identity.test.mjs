// micro source identity (tools/micro/src/identity.js): a sampled content hash that
// holds across a byte-identical copy (new mtime) and catches a same-size edit in
// the sampled bytes, plus the compatibility rules for identities and sidecars
// written before hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceHash, sourceHashSync, sampleRanges, sameSource, sidecarMatches } from '../tools/micro/src/identity.js';

const bytes = (n, seed = 1) => { const u = new Uint8Array(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; u[i] = s >>> 24; } return u; };
const flip = (u, at) => { const c = u.slice(); c[at] ^= 1; return c; };

test('sampled ranges: whole when small; head, eight interior blocks, tail when large', () => {
  assert.deepEqual(sampleRanges(1000), [[0, 1000]]);
  const r = sampleRanges(50_000_000);
  assert.equal(r.length, 10);
  assert.deepEqual(r[0], [0, 65536]);
  assert.deepEqual(r[9], [50_000_000 - 65536, 50_000_000]);
  for (let i = 1; i < r.length; i++) assert.ok(r[i][0] >= r[i - 1][1], 'in order, not overlapping');
  assert.equal(r.reduce((t, [a, b]) => t + b - a, 0), 2 * 65536 + 8 * 4096);
});

test('a byte-identical copy has the same hash, whatever its name or mtime', async () => {
  const u = bytes(3_000_000);
  const a = new File([u], 'bm.csv', { lastModified: 1 }), b = new File([u.slice()], 'copy.csv', { lastModified: 2 });
  assert.equal(sourceHashSync(a), null);
  const ha = await sourceHash(a);
  assert.match(ha, /^[0-9a-f]{16}$/);
  assert.equal(sourceHashSync(a), ha, 'cached on the blob');
  assert.equal(await sourceHash(b), ha);
  assert.equal(await sourceHash(new Blob([u])), ha);
});

test('a same-size edit in any sampled region changes the hash; the size alone does too', async () => {
  const u = bytes(3_000_000), h = await sourceHash(new Blob([u]));
  for (const [a, b] of sampleRanges(u.length)) {
    assert.notEqual(await sourceHash(new Blob([flip(u, a)])), h, `edit at ${a}`);
    assert.notEqual(await sourceHash(new Blob([flip(u, b - 1)])), h, `edit at ${b - 1}`);
  }
  assert.notEqual(await sourceHash(new Blob([u.subarray(0, u.length - 1)])), h);
  const small = bytes(5000);
  assert.notEqual(await sourceHash(new Blob([flip(small, 2500)])), await sourceHash(new Blob([small])), 'small files are hashed whole');
});

test('the price of sampling: an edit wholly between samples, same size, goes unseen', async () => {
  const u = bytes(3_000_000), r = sampleRanges(u.length);
  const gap = r[1][1] + 10;                                 // just past the first interior block
  assert.ok(gap < r[2][0]);
  assert.equal(await sourceHash(new Blob([flip(u, gap)])), await sourceHash(new Blob([u])));
});

test('sameSource: size and rows always; the hash when both carry one', () => {
  assert.equal(sameSource('100:10:aaaa', '100:10:aaaa'), true);
  assert.equal(sameSource('100:10:aaaa', '100:10:bbbb'), false);
  assert.equal(sameSource('100:10', '100:10:bbbb'), true, 'written before hashes');
  assert.equal(sameSource('100:10:aaaa', '100:10'), true, 'hash not computed yet');
  assert.equal(sameSource('100:10', '101:10:aaaa'), false);
  assert.equal(sameSource('100:10:aaaa', '100:11:aaaa'), false);
  assert.equal(sameSource(null, '1:1:a'), true);
});

test('sidecarMatches: the hash decides when both have one, else the mtime, else the size', () => {
  const f = { size: 10, lastModified: 5 };
  assert.equal(sidecarMatches({ size: 10, mtime: 4, hash: 'h' }, f, 'h'), true, 'a copy: new mtime, same bytes');
  assert.equal(sidecarMatches({ size: 10, mtime: 5, hash: 'h' }, f, 'x'), false, 'an edit keeping size and mtime');
  assert.equal(sidecarMatches({ size: 10, mtime: 5 }, f, null), true);
  assert.equal(sidecarMatches({ size: 10, mtime: 4 }, f, null), false);
  assert.equal(sidecarMatches({ size: 10 }, f, null), true);
  assert.equal(sidecarMatches({ size: 11, hash: 'h' }, f, 'h'), false);
});
