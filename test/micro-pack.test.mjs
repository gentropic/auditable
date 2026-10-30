// micro project packs (tools/micro/src/backup.js): a .zip.micro read as a directory
// handle — slices for stored members, unpack-on-read for deflated ones, session
// writes in memory beside the pack, writeTree into a real folder with the cache
// sidecars' stamps rebased, and the CRC pass a slice skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBackup, openPack, writeTree, restoreBackup } from '../tools/micro/src/backup.js';

const python = (() => { try { execFileSync('python', ['-c', 'import zipfile'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const T1 = 1_600_000_000_123;                               // an mtime no copy made today can have

// a memory folder in the shape of the File System Access handles (the dest side)
function memDir(name = 'dest') {
  const kids = new Map();
  const h = {
    kind: 'directory', name, kids,
    async getDirectoryHandle(n, { create = false } = {}) {
      let k = kids.get(n);
      if (!k) { if (!create) throw new DOMException(n, 'NotFoundError'); k = memDir(n); kids.set(n, k); }
      if (k.kind !== 'directory') throw new DOMException(n, 'TypeMismatchError');
      return k;
    },
    async getFileHandle(n, { create = false } = {}) {
      let k = kids.get(n);
      if (!k) { if (!create) throw new DOMException(n, 'NotFoundError'); k = memFile(n); kids.set(n, k); }
      if (k.kind !== 'file') throw new DOMException(n, 'TypeMismatchError');
      return k;
    },
    async *entries() { for (const [n, k] of kids) yield [n, k]; },
  };
  return h;
}
function memFile(name, file = new File([], name)) {
  const h = {
    kind: 'file', name, file,
    async getFile() { return h.file; },
    async createWritable() {
      const parts = [];
      return { async write(d) { parts.push(d instanceof Uint8Array ? d.slice() : d); }, async close() { h.file = new File(parts, name, { lastModified: Date.now() }); }, async abort() {} };
    },
  };
  return h;
}
async function put(dir, path, content, lastModified = T1) {
  const parts = path.split('/'), n = parts.pop();
  let d = dir; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(n, { create: true }); fh.file = new File([content], n, { lastModified });
}
async function text(dir, path) {
  const parts = path.split('/'), n = parts.pop();
  let d = dir; for (const p of parts) d = await d.getDirectoryHandle(p);
  return (await (await d.getFileHandle(n)).getFile()).text();
}
async function fileOf(dir, path) {
  const parts = path.split('/'), n = parts.pop();
  let d = dir; for (const p of parts) d = await d.getDirectoryHandle(p);
  return (await d.getFileHandle(n)).getFile();
}
const CSV = 'XC,YC,ZC,FE\n' + Array.from({ length: 200 }, (_, i) => `${i},${i * 2},${i % 7},${(i * 0.37).toFixed(2)}`).join('\n') + '\n';

async function makeProject() {
  const src = memDir('proj');
  await put(src, 'project.json', JSON.stringify({ app: 'micro', layers: [{ source: 'models/bm.csv' }] }));
  await put(src, 'models/bm.csv', CSV);
  await put(src, 'models/bm.csv.meta.json', JSON.stringify({ v: 2, size: new Blob([CSV]).size, mtime: T1, header: {} }));
  await put(src, 'notes.txt', 'field notes');
  return src;
}
async function makePackBytes(src) {
  const parts = [];
  await writeBackup(src, { write: (b) => { parts.push(b.slice()); } }, { name: 'proj' });
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

test('a pack reads as the folder: same tree, same bytes, the exact mtimes', async () => {
  const pack = await openPack(new File([await makePackBytes(await makeProject())], 'proj.zip.micro'));
  const seen = [];
  const walk = async (d, pre) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else seen.push(pre + n); } };
  await walk(pack.dir, '');
  assert.deepEqual(seen.sort(), ['models/bm.csv', 'models/bm.csv.meta.json', 'notes.txt', 'project.json']);
  assert.equal(pack.dir.name, 'proj');
  const f = await fileOf(pack.dir, 'models/bm.csv');
  assert.equal(await f.text(), CSV);
  assert.equal(f.lastModified, T1, 'the recorded mtime, not the zip\'s 2 s DOS time');
  assert.equal(await f.slice(13, 18).text(), CSV.slice(13, 18), 'ranged reads land in the member');
  const m = await pack.dir.getDirectoryHandle('models'), fh = await m.getFileHandle('bm.csv');
  assert.deepEqual(await pack.dir.resolve(fh), ['models', 'bm.csv']);
  assert.equal(await pack.dir.resolve({}), null);
  await assert.rejects(pack.dir.getFileHandle('nope.txt'), { name: 'NotFoundError' });
  await assert.rejects(pack.dir.getDirectoryHandle('notes.txt'), { name: 'TypeMismatchError' });
});

test('writes land beside the pack, never in it', async () => {
  const bytes = await makePackBytes(await makeProject());
  const before = Buffer.from(bytes).toString('base64');
  const blob = new File([bytes], 'proj.zip.micro');
  const pack = await openPack(blob);
  let w = await (await pack.dir.getFileHandle('notes.txt')).createWritable();
  await w.write('rewritten'); await w.close();
  const bm = await pack.dir.getDirectoryHandle('bookmarks', { create: true });
  await new Blob(['{"camera":1}']).stream().pipeTo(await (await bm.getFileHandle('a.json', { create: true })).createWritable());
  w = await (await pack.dir.getFileHandle('gone.txt', { create: true })).createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close();
  await pack.dir.removeEntry('gone.txt');
  assert.equal(await text(pack.dir, 'notes.txt'), 'rewritten');
  assert.equal(await text(pack.dir, 'bookmarks/a.json'), '{"camera":1}');
  await assert.rejects(pack.dir.getFileHandle('gone.txt'), { name: 'NotFoundError' });
  assert.deepEqual([...pack.changed].sort(), ['bookmarks/a.json', 'gone.txt', 'notes.txt']);
  assert.equal(Buffer.from(new Uint8Array(await blob.arrayBuffer())).toString('base64'), before, 'the pack is unchanged');
  assert.equal(await text((await openPack(blob)).dir, 'notes.txt'), 'field notes', 'a fresh open sees the pack as written');
});

test('writeTree: the whole tree, changes included, into an empty folder — cache stamps rebased', async () => {
  const pack = await openPack(new File([await makePackBytes(await makeProject())], 'proj.zip.micro'));
  const w = await (await pack.dir.getFileHandle('notes2.txt', { create: true })).createWritable(); await w.write('more'); await w.close();
  const dest = memDir();
  const res = await writeTree(pack.dir, dest);
  assert.equal(res.files, 5);
  assert.equal(await text(dest, 'models/bm.csv'), CSV);
  assert.equal(await text(dest, 'notes2.txt'), 'more');
  const copy = await fileOf(dest, 'models/bm.csv');
  assert.notEqual(copy.lastModified, T1);
  const meta = JSON.parse(await text(dest, 'models/bm.csv.meta.json'));
  assert.equal(meta.mtime, copy.lastModified, 'the sidecar now describes the copy, so it still matches on open');
  await assert.rejects(writeTree(pack.dir, dest), /already holds a micro project/);
  const half = memDir(); await put(half, 'notes.txt', 'mine');
  await assert.rejects(writeTree(pack.dir, half), /already has notes\.txt/);
  assert.equal(await text(half, 'notes.txt'), 'mine', 'nothing written when one file collides');
  assert.equal(half.kids.size, 1);
});

test('the CRC pass finds a damaged member; a copy from it refuses', async () => {
  const bytes = await makePackBytes(await makeProject());
  const ok = await openPack(new File([bytes], 'p.zip.micro'));
  assert.deepEqual(await ok.verify(), { ok: true, files: 4, bad: [] });
  const at = Buffer.from(bytes).indexOf('XC,YC,ZC,FE\n0,0,0');
  assert.ok(at > 0);
  const bad = bytes.slice(); bad[at + 14] ^= 1;              // one bit in the model
  const pack = await openPack(new File([bad], 'p.zip.micro'));
  const v = await pack.verify();
  assert.equal(v.ok, false);
  assert.deepEqual(v.bad.map((b) => b.path), ['models/bm.csv']);
  assert.match(v.bad[0].message, /CRC/);
  await assert.rejects(writeTree(pack.dir, memDir()), /CRC/);
  await assert.rejects(restoreBackup(new File([bad], 'p.zip.micro'), memDir()), /CRC/);
});

test('a pack re-zipped with deflate by another tool still opens (members unpack on read)', { skip: !python && 'no python' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'micro-pack-'));
  try {
    writeFileSync(join(dir, 'in.zip'), await makePackBytes(await makeProject()));
    const script = join(dir, 'rezip.py');
    writeFileSync(script, [
      'import sys, zipfile, os',
      'd = sys.argv[1]',
      'src = zipfile.ZipFile(os.path.join(d, "in.zip"))',
      'with zipfile.ZipFile(os.path.join(d, "out.zip"), "w") as out:',
      '    for i in src.infolist():',
      '        out.writestr(i, src.read(i.filename), compress_type=zipfile.ZIP_STORED if i.filename == "mimetype" else zipfile.ZIP_DEFLATED)',
    ].join('\n'));
    execFileSync('python', ['-I', script, dir]);
    const pack = await openPack(new File([readFileSync(join(dir, 'out.zip'))], 'out.zip.micro'));
    const f = await fileOf(pack.dir, 'models/bm.csv');
    assert.equal(await f.text(), CSV);
    assert.equal(f.lastModified, T1);
    assert.equal((await pack.verify()).ok, true);
    const dest = memDir();
    await writeTree(pack.dir, dest);
    assert.equal(await text(dest, 'models/bm.csv'), CSV);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
