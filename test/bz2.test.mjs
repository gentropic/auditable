// @gcu/bz2 — the libbzip2 port. The streams it writes are checked against CPython's bz2.compress
// (libbzip2 1.0.8) by length + SHA-256 of the reference bytes, so a different-but-valid stream
// fails; decoding is checked on its own output, chunked, by maxLength, with unusedData, across
// concatenated streams, on a randomised block (pre-0.9.5 bzip2 — CPython decodes the fixture to
// the same text), and against corruption.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compress, decompress, Compressor, Decompressor, BzDataError } from '../ext/bz2/src/main.js';
import { BZ2_CRC32_TABLE } from '../ext/bz2/src/tables.js';

function lcg(seed) { return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296; }
function bytesOf(n, f) { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = f(i); return u; }
const CORPUS = {
  empty: [9, () => new Uint8Array(0)],
  abc: [9, () => new TextEncoder().encode('abc')],
  zeros: [9, () => new Uint8Array(200000)],
  runs: [9, () => bytesOf(5000, (i) => (i / 300) | 0)],
  periodic: [9, () => new TextEncoder().encode('ab'.repeat(30000))],
  random: [9, () => { const r = lcg(1); return bytesOf(20000, () => (r() * 256) | 0); }],
  acgt: [9, () => { const r = lcg(2); return bytesOf(150000, () => 97 + ((r() * 4) | 0)); }],
  threeBlocks: [1, () => { const r = lcg(3); return bytesOf(250000, () => 32 + ((r() * 64) | 0)); }],
  ramp: [6, () => bytesOf(120000, (i) => (i * 7) % 251)],
  text: [9, () => new TextEncoder().encode('It was the best of times, it was the worst of times; '.repeat(2000))],
};
// bz2.compress(data, level) from CPython 3.13 (libbzip2 1.0.8): [length, sha256]
const CPYTHON = {
  empty: [14, 'd3dda84eb03b9738d118eb2be78e246106900493c0ae07819ad60815134a8058'],
  abc: [38, '3a4ed82edd21b7c3addc54039dbbc5609b9b1f67fa727eccf7517cad322f6d41'],
  zeros: [47, 'bf3517d5ac4e65b028966c711e7a504cd9a1e9b4d0e6c060817b5fd9b2760dd0'],
  runs: [103, 'f0548eb90e3ad302ce3bedaa212d35249c5ed3d5fb68be08f56b34486742623d'],
  periodic: [43, '356e822bda634b11dd16febd280130c875430bebcd2aebe765f630b34b93d380'],
  random: [20453, '3778371c1edff97bca58d961bfd8d06d510a8af7544a789fb75eb7d8f65fc1f0'],
  acgt: [41105, 'dcab3a74ad7b5f7808d8f4768e61c2311657fe546d09ee21edb36c751cd719f1'],
  threeBlocks: [189229, 'ea8d5de8c61ab70ab479213f812aa8449e370f6a5aaf89db25baf846d5db8cef'],
  ramp: [867, 'df3f0f10a369abae587390f6730b332d2d5389598cc73cee8a50fb951cb3bc2d'],
  text: [138, 'd5a6a769c70c8fec1f86ee4f2ff16a65814cfb3c3f9dcd895cae36fab7f566a0'],
};
const sha = (u) => createHash('sha256').update(u).digest('hex');
const eq = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const cat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };

describe('@gcu/bz2', () => {
  it("crc table is bzip2's", () => {
    assert.equal(BZ2_CRC32_TABLE[1], 0x04c11db7);
    assert.equal(BZ2_CRC32_TABLE[255], 0xb1f740b4);
  });

  for (const [name, [level, gen]] of Object.entries(CORPUS)) {
    it(`compress is libbzip2's, byte for byte: ${name} (level ${level}), and round-trips`, () => {
      const data = gen();
      const z = compress(data, level);
      assert.deepEqual([z.length, sha(z)], CPYTHON[name]);
      assert.ok(eq(decompress(z), data));
    });
  }

  it('compress in pieces writes the same stream', () => {
    const data = CORPUS.threeBlocks[1]();
    const c = new Compressor(1);
    const parts = [];
    for (let i = 0; i < data.length; i += 9999) parts.push(c.compress(data.subarray(i, i + 9999)));
    parts.push(c.flush());
    assert.equal(sha(cat(parts)), CPYTHON.threeBlocks[1]);
    assert.throws(() => c.compress(new Uint8Array(1)));
  });

  it('decompress fed 5 bytes at a time; by maxLength; unusedData after the stream', () => {
    const data = CORPUS.acgt[1]();
    const z = compress(data);
    const d = new Decompressor(), parts = [];
    for (let i = 0; i < z.length; i += 5) parts.push(d.decompress(z.subarray(i, i + 5)));
    assert.ok(d.eof && eq(cat(parts), data));

    const d2 = new Decompressor(), p2 = [];
    p2.push(d2.decompress(cat([z, new TextEncoder().encode('tail')]), 4096));
    assert.equal(p2[0].length, 4096);
    assert.equal(d2.needsInput, false);
    while (!d2.eof) p2.push(d2.decompress(new Uint8Array(0), 4096));
    assert.ok(eq(cat(p2), data));
    assert.equal(new TextDecoder().decode(d2.unusedData), 'tail');
    assert.throws(() => d2.decompress(new Uint8Array(0)), /end of stream/);
  });

  it('needsInput when the input runs out mid-stream', () => {
    const z = compress(CORPUS.text[1]());
    const d = new Decompressor();
    assert.equal(d.decompress(z.subarray(0, 20)).length, 0);
    assert.equal(d.needsInput, true);
    assert.equal(d.eof, false);
  });

  it('concatenated streams decode as one; trailing garbage after a stream is ignored', () => {
    const a = compress(new TextEncoder().encode('hello ')), b = compress(new TextEncoder().encode('world'));
    assert.equal(new TextDecoder().decode(decompress(cat([a, b]))), 'hello world');
    assert.equal(new TextDecoder().decode(decompress(cat([a, new TextEncoder().encode('garbage')]))), 'hello ');
    assert.throws(() => decompress(a.subarray(0, a.length - 3)), /ended before/);
  });

  it('a randomised block (bzip2 < 0.9.5)', () => {
    // built by XOR-ing the block with BZ2_rNums before sorting; CPython decodes it to this text
    const z = Uint8Array.from(Buffer.from('425a683131415926535955ef27f58002e69180c0213ffffff000083000d80500000000280000000052a450034d1ea1b53c53d4e827027c89c09ea26a1ae2a64264a3cea30c777513e84f4134130268c9828dc4cc4ec26ca8dc4c3313ec4c09989c09d84cc4f7135136133137d04d84caa3329fb8a1c09c09d455f973df95c89c8997f8bb9229c28482af793fa8', 'hex'));
    const text = 'the quick brown fox jumps over the lazy dog. '.repeat(40) + 'x'.repeat(300);
    assert.equal(new TextDecoder().decode(decompress(z)), text);
  });

  it('corruption: bad magic, a flipped bit (CRC), truncation', () => {
    const z = compress(CORPUS.text[1]());
    assert.throws(() => new Decompressor().decompress(new TextEncoder().encode('BZx9')), (e) => e instanceof BzDataError && e.magic);
    const bad = z.slice(); bad[60] ^= 0x10;
    assert.throws(() => decompress(bad), BzDataError);
    const d = new Decompressor();
    d.decompress(z.subarray(0, z.length - 1));
    assert.equal(d.eof, false);
  });
});
