// @gcu/lzma — the liblzma port. What it writes is checked against CPython's lzma.compress (liblzma
// 5.8.1) by length + SHA-256 of the reference bytes — every format, presets 0 / 1 / 3 / 6 / 9e,
// the checks, LZMA2 options and match finders, the delta and branch filters — and ARM64 / RISC-V
// (which CPython's lzma doesn't offer) against the xz tool 5.8.3's; so a different-but-valid
// stream fails. Each is decoded back; decoding is also checked fed 7 bytes at a time, by
// maxLength, with unusedData, across concatenated streams, and against corruption.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as L from '../ext/lzma/src/main.js';

function lcg(seed) { return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296; }
function bytesOf(n, f) { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = f(i); return u; }
const DATA = {
  empty: () => new Uint8Array(0),
  abc: () => new TextEncoder().encode('abc'),
  text: () => new TextEncoder().encode('It was the best of times, it was the worst of times; '.repeat(3000)),
  random: () => { const r = lcg(1); return bytesOf(40000, () => (r() * 256) | 0); },
  acgt: () => { const r = lcg(2); return bytesOf(300000, () => 97 + ((r() * 4) | 0)); },
  zeros: () => new Uint8Array(2500000),
  code: () => { const r = lcg(3); return bytesOf(200000, (i) => { const k = r(); return k < 0.05 ? 0xe8 : k < 0.08 ? 0xeb : k < 0.1 ? 0xf0 : k < 0.12 ? 0xf8 : k < 0.14 ? 0x40 : k < 0.17 ? 0x94 : (i * 13 + ((r() * 8) | 0)) & 0xff; }); },
};
const LZ2 = L.FILTER_LZMA2;
// [data, our options, decode options, [length, sha256] of CPython's (or, marked, the xz tool's)]
const CASES = {
  'empty xz': ['empty', {}, {}, [32, '0040f94d11d0039505328a90b2ff48968db873e9e7967307631bf40ef5679275']],
  'abc xz': ['abc', {}, {}, [60, '02c603276264a4635755deb73337cf24bc561bf65e48a3dd4237cde3ec35143c']],
  'text p0': ['text', { preset: 0 }, {}, [196, '2bd7b4f5794dcfcea941f5ebce5bd493a9d1cc2f0c4b99b7baa4a21f02c7bf57']],
  'text p3': ['text', { preset: 3 }, {}, [196, '6cbe596046447c1333cbb1588d68f1c7235998641ce4c479528bccc1d986415a']],
  'text p6': ['text', { preset: 6 }, {}, [196, '05e68533af3d624cfc2b4718b026073e5a6a1bdeb73bc013f931b069a587804d']],
  'random p6': ['random', { preset: 6 }, {}, [40060, 'eb86cf56dec9708d5cf0527afa67a07623cc011b956e8012a2e03ca97629d6b4']],
  'acgt p1': ['acgt', { preset: 1 }, {}, [90964, '65d3d12996fd4984ffca5d4287f6c1248cf5d1e748e162cd36e7eeeb797cc1c0']],
  'acgt p6': ['acgt', { preset: 6 }, {}, [83444, '51ecfc82aa9be5d993dd68bdd22584f9c1dbcfb60be251694aff893872d97137']],
  'acgt p9e': ['acgt', { preset: (9 | L.PRESET_EXTREME) >>> 0 }, {}, [83572, 'e7cb661822d90d5bdee5d0490a4bb230d5ce5a64349eeee73b17ed9f47c2c498']],
  'zeros p6': ['zeros', {}, {}, [496, 'a4cb7ebd0e7fb5872b69d42c7c470a82f851970663f20ce7aecfe87a13d879d3']],
  'text crc32': ['text', { check: L.CHECK_CRC32 }, {}, [192, 'd3c14aab7ca252b0974cafef4b0c20876a2557c65a38aea2b38a82ca904e96d3']],
  'text sha256': ['text', { check: L.CHECK_SHA256 }, {}, [220, 'de312ca1d3d3df491d60545a92153f6fd4fdd506d238ea56545151ca0d537738']],
  'text nocheck': ['text', { check: L.CHECK_NONE }, {}, [188, '6734407c21c4a013640a0af1cc47592d2db43893caea508d9a2c891bad3a179a']],
  'text alone': ['text', { format: 'alone' }, { format: 'alone' }, [149, '09ace416ed37218a5e1e425f064428d81b325f73d54cf9bc05bfb5fbe66bc93e']],
  'acgt alone p2': ['acgt', { format: 'alone', preset: 2 }, { format: 'alone' }, [89002, '1799e7a7c8341d4f788cd69e50e66d10f65dca5b54b8916614e73c3a8be2ed2d']],
  'text raw lzma2': ['text', { format: 'raw', filters: [{ id: LZ2 }] }, { format: 'raw', filters: [{ id: LZ2 }] }, [137, 'b89d7304cbe303321ed3608bb26134cdac58ba657bd60354de92f3f9b0486d91']],
  'acgt raw lzma1': ['acgt', { format: 'raw', filters: [{ id: L.FILTER_LZMA1, preset: 4 }] }, { format: 'raw', filters: [{ id: L.FILTER_LZMA1, preset: 4 }] }, [83256, '465c7ab639b8a378744551621b6937a55c344c6c03e45c0a691139cedf07c409']],
  'code delta': ['code', { filters: [{ id: L.FILTER_DELTA, dist: 4 }, { id: LZ2, preset: 1 }] }, {}, [161452, '4d8139a71707ebacc1b8bd4d44d6a328779c7b5268f61c4cadf36eb61682d637']],
  'code x86': ['code', { filters: [{ id: L.FILTER_X86 }, { id: LZ2, preset: 0 }] }, {}, [145352, 'ad0dd3cce0eb099a2e8af79d3bc8b1db9399593eab5c5795730dd03aa79b838f']],
  'code arm': ['code', { filters: [{ id: L.FILTER_ARM, start_offset: 64 }, { id: LZ2, preset: 0 }] }, {}, [148348, '92e754ed104a33579e11aec87d661b29f138d66a5464c613efec5a3aa8394f6a']],
  'code armthumb': ['code', { filters: [{ id: L.FILTER_ARMTHUMB }, { id: LZ2, preset: 0 }] }, {}, [145536, '34bc07a82a2dbceefcef9e3c1cf369daa01de11fd68f907199c101acd7561cc4']],
  'code powerpc': ['code', { filters: [{ id: L.FILTER_POWERPC }, { id: LZ2, preset: 0 }] }, {}, [145508, '83570525a95ab895a9cfff36dcfddad70abe7d00672bb9f1f2b4decacb602f04']],
  'code ia64': ['code', { filters: [{ id: L.FILTER_IA64 }, { id: LZ2, preset: 0 }] }, {}, [145524, 'ffd08432aaa285e58410e5baa01c0e2d1be0bf7a74373a6e4ab70a28cad35dcd']],
  'code sparc': ['code', { filters: [{ id: L.FILTER_SPARC }, { id: LZ2, preset: 0 }] }, {}, [145796, '550d28b57099f8e72ab51bd18192966bdb4c809b1f421938ff13cd9b2f9a3c57']],
  'code chain': ['code', { filters: [{ id: L.FILTER_DELTA, dist: 2 }, { id: L.FILTER_X86 }, { id: LZ2, preset: 3 }] }, {}, [157272, '2fd3c33d97328d500fe33133793720259a43dbf36688a81c406036560b83e0a4']],
  'text options': ['text', { filters: [{ id: LZ2, dictSize: 1 << 16, lc: 1, lp: 2, pb: 1, mode: 'fast', niceLen: 40, mf: L.MF_BT2, depth: 10 }] }, {}, [184, 'f09d2395e40ebdc92bf14bc9bb723540748b04b7b4bdf57fe4f0e4727ef017cb']],
  'acgt bt3': ['acgt', { filters: [{ id: LZ2, mf: L.MF_BT3, niceLen: 100 }] }, {}, [83588, 'd10122ee84d8afb7d9280684fa62717b5b71b21aec86f46563a5fe1f2243d4f6']],
  // the xz tool 5.8.3 (xz -T1 --arm64 / --riscv --lzma2=preset=0)
  'code arm64 (xz tool)': ['code', { filters: [{ id: L.FILTER_ARM64 }, { id: LZ2, preset: 0 }] }, {}, [149456, '0d334d0d4b4048c96089f5ab7a580dd65f8dd2062309ca5425d3bc92fef25332']],
  'code riscv (xz tool)': ['code', { filters: [{ id: L.FILTER_RISCV }, { id: LZ2, preset: 0 }] }, {}, [145384, 'e80539c54f61f24d08958bf593f3aef45b2e6bc595c95f73085f8dbe733e95d1']],
};
const sha = (u) => createHash('sha256').update(u).digest('hex');
const eq = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const cat = (ps) => { const n = ps.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of ps) { o.set(p, k); k += p.length; } return o; };
const cache = {};
const data = (name) => cache[name] || (cache[name] = DATA[name]());

describe('@gcu/lzma', () => {
  for (const [name, [dname, opts, dopts, want]] of Object.entries(CASES)) {
    it(`compress is liblzma's, byte for byte: ${name}; and decompresses back`, () => {
      const d = data(dname);
      // (fed in pieces: the output doesn't depend on how the input arrives)
      const c = new L.Compressor(opts);
      const third = Math.floor(d.length / 3);
      const z = cat([c.compress(d.subarray(0, third)), c.compress(d.subarray(third)), c.flush()]);
      assert.deepEqual([z.length, sha(z)], want);
      assert.ok(eq(L.decompress(z, dopts), d));
    });
  }

  it('decompress fed 7 bytes at a time, by maxLength, with unusedData; .xz and .lzma', () => {
    for (const fmt of ['xz', 'alone']) {
      const d = data('acgt');
      const z = L.compress(d, { format: fmt, preset: 1 });
      const dec = L.Decompressor({ format: fmt === 'xz' ? 'auto' : 'alone' });
      const parts = [];
      for (let i = 0; i < z.length; i += 7) parts.push(dec.decompress(z.subarray(i, i + 7)));
      assert.ok(dec.eof && eq(cat(parts), d), fmt + ' chunked');
      const d2 = L.Decompressor({ format: 'auto' });
      const p2 = [d2.decompress(cat([z, new TextEncoder().encode('tail')]), 5000)];
      assert.equal(p2[0].length, 5000);
      assert.equal(d2.needsInput, false);
      while (!d2.eof) p2.push(d2.decompress(new Uint8Array(0), 5000));
      assert.ok(eq(cat(p2), d), fmt + ' limited');
      assert.equal(new TextDecoder().decode(d2.unusedData), 'tail');
    }
  });

  it('check: the stream\'s, once its header is read; needsInput while a stream is open', () => {
    const z = L.compress(data('text'), { check: L.CHECK_SHA256 });
    const d = L.Decompressor({ format: 'xz' });
    assert.equal(d.check, L.CHECK_UNKNOWN);
    d.decompress(z.subarray(0, 30));
    assert.equal(d.check, L.CHECK_SHA256);
    assert.equal(d.needsInput, true);
    assert.equal(d.eof, false);
  });

  it('concatenated streams decode as one; trailing garbage after one is ignored; a cut-off stream is an error', () => {
    const a = L.compress(new TextEncoder().encode('hello ')), b = L.compress(new TextEncoder().encode('world'), { format: 'alone' });
    assert.equal(new TextDecoder().decode(L.decompress(cat([a, b]))), 'hello world');
    assert.equal(new TextDecoder().decode(L.decompress(cat([a, new TextEncoder().encode('garbage')]))), 'hello ');
    assert.throws(() => L.decompress(a.subarray(0, a.length - 5)), /ended before/);
  });

  it('corruption: a flipped bit fails the check; not xz at all; memlimit', () => {
    const z = L.compress(data('text'));
    const bad = z.slice(); bad[bad.length - 40] ^= 0x04;
    assert.throws(() => L.decompress(bad), (e) => e instanceof L.LzmaError && /Corrupt input data/.test(e.message));
    assert.throws(() => L.Decompressor({ format: 'xz' }).decompress(new TextEncoder().encode('not an xz stream at all')), /Input format not supported/);
    assert.throws(() => L.Decompressor({ format: 'xz', memlimit: 1024 }).decompress(z), /Memory usage limit/);
  });

  it('mutated streams end in data or an LzmaError — never another exception, never a hang', () => {
    const r = lcg(42);
    const z = L.compress(data('text'), { preset: 1 });
    for (let t = 0; t < 400; t++) {
      const m = Uint8Array.from(z);
      m[(r() * m.length) | 0] ^= 1 << ((r() * 8) | 0);
      try { L.Decompressor({ format: 'auto' }).decompress(m); } catch (e) { assert.ok(e instanceof L.LzmaError, String(e)); }
    }
  });
});
