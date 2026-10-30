// @gcu/archive zipstream — the ranged reader + streaming Zip64 writer (the large-file path).
// Run against the BUILT bundle too: a concat collision would only show there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as src from '../ext/archive/src/zipstream.js';
import * as bundle from '../ext/archive/index.js';

const memSink = () => { const parts = []; return { write: (b) => { parts.push(b.slice()); }, bytes: () => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; } }; };
const te = new TextEncoder(), td = new TextDecoder();
const big = (n, seed = 7) => { const u = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; u[i] = x >>> 24; } return u; };
const streamOf = (u8, step = 100000) => new ReadableStream({ start(c) { for (let i = 0; i < u8.length; i += step) c.enqueue(u8.subarray(i, i + step)); c.close(); } });
const python = (() => { try { execFileSync('python', ['-c', 'import zipfile'], { stdio: 'ignore' }); return true; } catch { return false; } })();

for (const [label, Z] of [['src', src], ['bundle', bundle]]) {
  test(`${label}: round trip — whole, known-size chunks and streamed members; mtime kept`, async () => {
    const s = memSink(), w = Z.createZipStreamWriter(s);
    await w.add('mimetype', 'application/x-test', { aligned: false });
    const payload = big(300000);
    await w.addChunks('data/a.bin', payload.length, Z.crc32(payload), [payload.subarray(0, 1000), payload.subarray(1000)]);
    const when = new Date(2026, 9, 30, 14, 22, 10).getTime();
    await w.addStream('data/b.bin', streamOf(payload), { mtime: when });
    const res = await w.finish();
    const bytes = s.bytes();
    assert.equal(res.size, bytes.length);
    assert.equal(td.decode(bytes.subarray(30, 38)), 'mimetype');                     // first member, name right after a bare local header
    const z = await Z.openZipRanged(Z.blobSource(new Blob([bytes])));
    assert.deepEqual(z.list().map((e) => e.name), ['mimetype', 'data/a.bin', 'data/b.bin']);
    assert.equal(td.decode(await z.bytes(z.entries.get('mimetype'))), 'application/x-test');
    assert.deepEqual(await z.bytes(z.entries.get('data/a.bin')), payload);
    assert.deepEqual(await z.bytes(z.entries.get('data/b.bin')), payload);
    assert.equal(z.entries.get('data/b.bin').mtime, when);
  });

  test(`${label}: a damaged member fails its CRC check instead of restoring wrong bytes`, async () => {
    const s = memSink(), w = Z.createZipStreamWriter(s);
    await w.add('x.txt', 'hello, world — a sentence long enough to flip');
    await w.finish();
    const bytes = s.bytes(); bytes[40] ^= 1;                                         // inside x.txt's data
    const z = await Z.openZipRanged(Z.bytesSource(bytes));
    await assert.rejects(() => z.bytes(z.entries.get('x.txt')), /CRC/);
  });

  test(`${label}: Zip64 by count — more than 65 535 members`, async () => {
    const s = memSink(), w = Z.createZipStreamWriter(s);
    for (let i = 0; i < 66000; i++) await w.add(`f/${i}`, String(i));
    await w.finish();
    const z = await Z.openZipRanged(Z.bytesSource(s.bytes()));
    assert.equal(z.entries.size, 66000);
    assert.equal(td.decode(await z.bytes(z.entries.get('f/65999'))), '65999');
  });

  test(`${label}: not a zip / truncated → a clear error`, async () => {
    await assert.rejects(() => Z.openZipRanged(Z.bytesSource(te.encode('just some text, no zip here'))), /end-of-central-directory/);
  });
}

// interop, both directions, with an independent implementation
test('python reads what we write (streamed + Zip64) and we read what python writes (deflate + forced Zip64)', { skip: !python && 'no python' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zs-'));
  try {
    const s = memSink(), w = bundle.createZipStreamWriter(s);
    const payload = big(250000, 3);
    await w.add('mimetype', 'application/x-test', { aligned: false });
    await w.addStream('a/b.bin', streamOf(payload));
    for (let i = 0; i < 65600; i++) await w.add(`n/${i}`, 'x');
    await w.finish();
    writeFileSync(join(dir, 'ours.zip'), s.bytes());
    const script = join(dir, 'check.py');
    writeFileSync(script, [
      'import sys, zipfile, hashlib',
      'd = sys.argv[1]',
      'z = zipfile.ZipFile(d + "/ours.zip")',
      'bad = z.testzip()',
      'print("bad", bad)',
      'print("n", len(z.namelist()))',
      'print("sha", hashlib.sha256(z.read("a/b.bin")).hexdigest())',
      'with zipfile.ZipFile(d + "/theirs.zip", "w", zipfile.ZIP_DEFLATED) as o:',
      '    o.writestr("t/hello.txt", "hello " * 5000)',
      '    with o.open("t/big.bin", "w", force_zip64=True) as f: f.write(bytes(range(256)) * 4000)',
      '',
    ].join('\n'));
    const out = execFileSync('python', ['-I', script, dir], { encoding: 'utf8' });
    assert.match(out, /bad None/);
    assert.match(out, /n 65602/);
    const { createHash } = await import('node:crypto');
    assert.match(out, new RegExp('sha ' + createHash('sha256').update(payload).digest('hex')));
    const z = await bundle.openZipRanged(bundle.bytesSource(new Uint8Array(readFileSync(join(dir, 'theirs.zip')))));
    assert.equal(z.entries.get('t/hello.txt').method, 8);
    assert.equal(td.decode(await z.bytes(z.entries.get('t/hello.txt'))), 'hello '.repeat(5000));
    const bb = await z.bytes(z.entries.get('t/big.bin'));
    assert.equal(bb.length, 1024000); assert.equal(bb[256 * 3999 + 255], 255);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
