// @gcu/vfs NodeBackend — a real directory via node:fs. Conformance against the memory backend's
// semantics + the node-specific guarantees: atomic writes (no half-written file, no tmp litter),
// the root-escape refusal, seekable ranges, recursive remove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import { VFS } from '../ext/vfs/src/vfs.js';
import { NodeBackend } from '../ext/vfs/src/node.js';

async function tmpRoot() { return fsp.mkdtemp(nodePath.join(os.tmpdir(), 'gcu-vfs-node-')); }

test('node backend: registered type + basic file/dir round-trip', async () => {
  const root = await tmpRoot();
  const vfs = await VFS.create({ type: 'node', root });
  assert.ok(vfs.resolve('/').backend instanceof NodeBackend, 'type "node" resolves to NodeBackend');
  await vfs.mkdir('/items', { recursive: true });
  await vfs.writeFile('/items/a.ndjson', '{"id":1}\n{"id":2}');
  assert.equal(await vfs.readFile('/items/a.ndjson', 'utf8'), '{"id":1}\n{"id":2}', 'utf8 round-trip');
  const bytes = await vfs.readFile('/items/a.ndjson', 'bytes');
  assert.ok(bytes instanceof Uint8Array && bytes.length === 17, 'bytes round-trip');
  await vfs.writeFile('/items/b.bin', new Uint8Array([1, 2, 3, 250]));
  assert.deepEqual([...await vfs.readFile('/items/b.bin', 'bytes')], [1, 2, 3, 250], 'binary content preserved');
  assert.deepEqual(await vfs.readdir('/items'), ['a.ndjson', 'b.bin'], 'readdir sorted');
  const st = await vfs.stat('/items/a.ndjson');
  assert.equal(st.type, 'file'); assert.equal(st.size, 17); assert.ok(st.modified instanceof Date, 'stat shape (type/size/modified)');
  assert.equal((await vfs.stat('/items')).type, 'directory');
  assert.equal(await vfs.exists('/items/zzz'), false, 'exists → false for missing');
  await fsp.rm(root, { recursive: true, force: true });
});

test('node backend: error codes match the VFS contract', async () => {
  const root = await tmpRoot();
  const vfs = await VFS.create({ type: 'node', root });
  await assert.rejects(vfs.readFile('/nope.txt'), (e) => e.code === 'ENOENT', 'missing file → ENOENT');
  await assert.rejects(vfs.writeFile('/no/parent/x.txt', 'x'), (e) => e.code === 'ENOENT', 'missing parent → ENOENT');
  await vfs.mkdir('/d');
  await assert.rejects(vfs.mkdir('/d'), (e) => e.code === 'EEXIST', 'mkdir existing → EEXIST');
  await assert.rejects(vfs.writeFile('/d', 'x'), (e) => e.code === 'EISDIR', 'write onto a dir → EISDIR');
  await assert.rejects(vfs.unlink('/d'), (e) => e.code === 'EISDIR', 'unlink a dir → EISDIR');
  await vfs.writeFile('/d/f.txt', 'f');
  await assert.rejects(vfs.rmdir('/d'), (e) => e.code === 'ENOTEMPTY', 'rmdir non-empty → ENOTEMPTY');
  await assert.rejects(vfs.rmdir('/d/f.txt'), (e) => e.code === 'ENOTDIR', 'rmdir a file → ENOTDIR');
  await fsp.rm(root, { recursive: true, force: true });
});

test('node backend: paths that escape the root are refused', async () => {
  const root = await tmpRoot();
  const be = new NodeBackend({ root });
  await be.init();
  // VFS paths are normalized first: `..` above `/` collapses to `/`, so these can only ever land INSIDE root
  await be.writeFile('/../outside.txt', 'in');
  assert.equal(await fsp.readFile(nodePath.join(root, 'outside.txt'), 'utf8'), 'in', '/../x normalizes to /x — stays inside root');
  await be.writeFile('/a/../../b.txt', 'x');
  assert.equal(await fsp.readFile(nodePath.join(root, 'b.txt'), 'utf8'), 'x', 'nested .. collapses inside root');
  let above = false; try { await fsp.access(nodePath.join(root, '..', 'outside.txt')); above = true; } catch { /* good */ }
  assert.equal(above, false, 'nothing was written above the root');
  // defense in depth: a segment the VFS normalizer leaves alone but the host OS treats as a separator
  if (process.platform === 'win32') {
    await assert.rejects(be.readFile('/a\\..\\..\\escape.txt'), (e) => e.code === 'EACCES', 'backslash escape (win32) → EACCES');
  }
  await be.writeFile('/a/../inside.txt', 'ok');   // normalizes to /inside.txt — inside root
  assert.equal(await be.readFile('/inside.txt'), 'ok');
  await fsp.rm(root, { recursive: true, force: true });
});

test('node backend: writes are atomic and leave no temp litter', async () => {
  const root = await tmpRoot();
  const vfs = await VFS.create({ type: 'node', root });
  await vfs.writeFile('/shard.ndjson', 'v1');
  // overwrite many times; the directory must only ever show the target
  for (let i = 0; i < 20; i++) await vfs.writeFile('/shard.ndjson', 'v' + i);
  const raw = await fsp.readdir(root);
  assert.deepEqual(raw, ['shard.ndjson'], 'no *.vfstmp left behind');
  assert.equal(await vfs.readFile('/shard.ndjson'), 'v19');
  // a stray temp file (a crashed write) is hidden from readdir
  await fsp.writeFile(nodePath.join(root, 'shard.ndjson.deadbeef.vfstmp'), 'half');
  assert.deepEqual(await vfs.readdir('/'), ['shard.ndjson'], 'readdir hides temp litter');
  await fsp.rm(root, { recursive: true, force: true });
});

test('node backend: rename, recursive remove, touch, readRange, stream', async () => {
  const root = await tmpRoot();
  const vfs = await VFS.create({ type: 'node', root });
  await vfs.mkdir('/t/deep/er', { recursive: true });
  await vfs.writeFile('/t/deep/er/x.txt', '0123456789');
  await vfs.rename('/t/deep/er/x.txt', '/t/y.txt');
  assert.equal(await vfs.exists('/t/deep/er/x.txt'), false, 'rename moved the file');
  assert.equal(await vfs.readFile('/t/y.txt'), '0123456789');
  const be = vfs.resolve('/').backend;
  const range = await be.readRange('/t/y.txt', 3, 4);
  assert.equal(new TextDecoder().decode(range), '3456', 'readRange seeks without the whole file');
  let streamed = '';
  for await (const chunk of be.createReadStream('/t/y.txt')) streamed += new TextDecoder().decode(chunk);
  assert.equal(streamed, '0123456789', 'async-iterable read stream');
  await be.touch('/t/new.txt');
  assert.equal(await vfs.readFile('/t/new.txt'), '', 'touch creates an empty file');
  await vfs.rm('/t', { recursive: true });
  assert.equal(await vfs.exists('/t'), false, 'recursive remove');
  const est = await be.estimate();
  assert.ok(typeof est.used === 'number' && typeof est.available === 'number', 'estimate shape');
  assert.deepEqual(be.toConfig(), { type: 'node', root: nodePath.resolve(root) }, 'serializable config');
  await fsp.rm(root, { recursive: true, force: true });
});
