// adder's stdlib modules that touch files — tempfile, zipfile on paths, open() keywords, csv
// through real files, logging to a file — run through both engines over an in-memory VFS. (The
// CPython parity corpus covers the rest of the stdlib; it runs without a filesystem.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../ext/adder/src/index.js');
A.attachAir(await import('../ext/air/index.js'));
const B = await import('../ext/adder/src/builtins.js');
const { VFS } = await import('../ext/vfs/src/vfs.js');
const { path: vfsPath } = await import('../ext/vfs/src/path.js');

async function runBoth(code) {
  const outs = [];
  for (const engine of ['tree', 'auto']) {
    const vfs = await VFS.create();
    await vfs.mkdir('/tmp', { recursive: true });
    B.setAdderVFS(vfs, vfsPath);
    const out = [];
    let used = null;
    await A.run(code, { engine, vfs, stdout: (s) => out.push(s), stderr: () => {}, onEngine: (e) => { used = e; } });
    outs.push({ engine, used, text: out.join(''), vfs });
  }
  assert.equal(outs[0].text, outs[1].text, 'both engines print the same');
  return outs[1];
}

describe('adder stdlib over a VFS', () => {
  it('tempfile: mkdtemp, TemporaryDirectory cleanup, NamedTemporaryFile', async () => {
    const r = await runBoth(`
import tempfile, os
d = tempfile.mkdtemp(prefix="run_")
print(d.startswith("/tmp/run_"), os.path.isdir(d))
with tempfile.TemporaryDirectory() as t:
    with open(os.path.join(t, "a.txt"), "w") as f:
        f.write("hello")
    print(os.listdir(t))
print(os.path.exists(t))
with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as nt:
    nt.write("named")
print(nt.name.endswith(".txt"), open(nt.name).read())
`);
    assert.equal(r.used, 'air');
    assert.equal(r.text, "True True\n['a.txt']\nFalse\nTrue named\n");
  });

  it('zipfile: write, append, extract on VFS paths', async () => {
    const r = await runBoth(`
import zipfile, os
os.makedirs("/tmp/src")
with open("/tmp/src/a.txt", "w") as f:
    f.write("alpha " * 10)
with zipfile.ZipFile("/tmp/arch.zip", "w", compression=zipfile.ZIP_DEFLATED) as z:
    z.write("/tmp/src/a.txt", "copied.txt")
    z.writestr("dir/b.bin", b"\\x00\\x01")
with zipfile.ZipFile("/tmp/arch.zip", "a") as z:
    z.writestr("more.txt", "x")
with zipfile.ZipFile("/tmp/arch.zip") as z:
    print(z.namelist(), z.read("copied.txt")[:6], z.testzip())
    z.extractall("/tmp/out")
print(sorted(os.listdir("/tmp/out")), open("/tmp/out/copied.txt").read()[:5], zipfile.is_zipfile("/tmp/arch.zip"))
`);
    assert.equal(r.text, "['copied.txt', 'dir/b.bin', 'more.txt'] b'alpha ' None\n['copied.txt', 'dir', 'more.txt'] alpha True\n");
  });

  it('open() takes keyword arguments; csv reads and writes real files', async () => {
    const r = await runBoth(`
import csv
with open("/tmp/data.csv", mode="w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["x", "y"])
    w.writerows([[1, 2], ["a,b", 'say "hi"']])
with open(file="/tmp/data.csv", newline="") as f:
    print(list(csv.DictReader(f)))
`);
    assert.equal(r.text, `[{'x': '1', 'y': '2'}, {'x': 'a,b', 'y': 'say "hi"'}]\n`);
  });

  it('logging.basicConfig(filename=...) appends to a VFS file', async () => {
    const r = await runBoth(`
import logging
logging.basicConfig(filename="/tmp/app.log", level=logging.INFO, format="%(levelname)s %(message)s", force=True)
logging.info("to file")
logging.debug("dropped")
logging.warning("again")
`);
    assert.equal(await r.vfs.readFile('/tmp/app.log'), 'INFO to file\nWARNING again\n');
  });

  it("files as CPython's: binary readline / iteration, seek / tell, read(-1); os.stat's file type", async () => {
    const r = await runBoth(`
import os, stat
with open("/tmp/b.bin", "wb") as f:
    f.write(b"ab\\ncd\\nef")
    n = f.tell()
with open("/tmp/b.bin", "rb") as f:
    one = f.readline(); f.seek(-2, 2); end = f.read(-1); f.seek(0); lines = list(f)
with open("/tmp/b.bin") as f:
    first = f.readline(); rest = [l for l in f]
print(n, one, end, lines, repr(first), rest)
print(stat.S_ISREG(os.stat("/tmp/b.bin").st_mode), stat.S_ISDIR(os.stat("/tmp").st_mode))
`);
    assert.equal(r.text, "8 b'ab\\n' b'ef' [b'ab\\n', b'cd\\n', b'ef'] 'ab\\n' ['cd\\n', 'ef']\nTrue True\n");
  });

  it("open's update modes: r+ / w+ / a+ / x, writes at the position, truncate", async () => {
    const r = await runBoth(`
import io
P = "/tmp/u.bin"
with open(P, "wb") as f: f.write(b"hello world")
with open(P, "r+b") as f:
    c = bytearray(f.read(1)); c[0] += 1; f.seek(0); f.write(c); f.seek(6); f.write(b"W")
with open(P, "ab") as f: f.write(b"!")
with open(P, "a+b") as f: f.seek(0); f.write(b"?"); f.seek(0); a = f.read()
with open(P, "w+b") as f: f.write(b"abcdef"); f.seek(2); f.write(b"Z"); f.truncate(4); f.seek(0); w = f.read()
try:
    open(P, "x"); x = None
except FileExistsError: x = "exists"
with open(P, "r") as f:
    try: f.write("x"); u = None
    except io.UnsupportedOperation: u = "unsupported"
print(a, w, x, u)
`);
    assert.equal(r.text, "b'iello World!?' b'abZd' exists unsupported\n");
  });

  it('shutil: rmtree(path, True) ignores a missing tree; copyfile, copystat, copyfileobj', async () => {
    const r = await runBoth(`
import shutil, os, io
shutil.rmtree("/tmp/none", True)
with open("/tmp/a.txt", "w") as f: f.write("hi")
shutil.copyfile("/tmp/a.txt", "/tmp/b.txt")
shutil.copystat("/tmp/a.txt", "/tmp/b.txt")
b = io.StringIO()
shutil.copyfileobj(io.StringIO("abc"), b)
print(open("/tmp/b.txt").read(), b.getvalue())
`);
    assert.equal(r.text, 'hi abc\n');
  });

  it('a file never closed is on the VFS by the next filesystem call, and when the run ends', async () => {
    const r = await runBoth(`
import os
open("/tmp/a.txt", "w").write("dropped")
print(open("/tmp/a.txt").read())
f = open("/tmp/b.txt", "w")
print(os.path.exists("/tmp/b.txt"))
f.write("one")
f.flush()
print(os.path.getsize("/tmp/b.txt"))
f.write("two")
open("/tmp/c.txt", "w").write("left open")
`);
    assert.equal(r.text, 'dropped\nTrue\n3\n');
    assert.equal(await r.vfs.readFile('/tmp/b.txt'), 'onetwo');
    assert.equal(await r.vfs.readFile('/tmp/c.txt'), 'left open');
  });

  it('file descriptors: os.open / read / write / lseek / fstat / dup / close, open(fd), mkstemp, fileno', async () => {
    const r = await runBoth(`
import os, tempfile, errno
fd, name = tempfile.mkstemp(suffix=".txt")
print(fd >= 3, os.path.exists(name))
with open(fd, "w") as f:
    f.write("A\\nB\\nC")
print(open(name).read().split("\\n"))
fd = os.open(name, os.O_RDWR)
print(os.read(fd, 2), os.lseek(fd, 0, os.SEEK_CUR), os.lseek(fd, 0, os.SEEK_END))
os.lseek(fd, 0, os.SEEK_SET)
print(os.write(fd, b"Z"), os.fstat(fd).st_size)
fd2 = os.dup(fd)
os.close(fd)
print(os.read(fd2, 10))
os.close(fd2)
try:
    os.close(fd2)
except OSError as e:
    print(e.errno == errno.EBADF, str(e))
fd = os.open(name, os.O_WRONLY | os.O_TRUNC)
os.write(fd, b"new")
os.close(fd)
print(open(name, "rb").read())
try:
    os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
except FileExistsError as e:
    print(e.errno, e.filename == name)
d = os.open(os.path.dirname(name), os.O_RDONLY)
print(os.path.basename(name) in os.listdir(d), os.stat(os.path.basename(name), dir_fd=d).st_size)
os.close(d)
with open(name, "rb") as f:
    print(os.fstat(f.fileno()).st_size, os.read(f.fileno(), 1))
`);
    assert.equal(r.text, [
      'True True', "['A', 'B', 'C']", "b'A\\n' 2 5", '1 5', "b'\\nB\\nC'", 'True [Errno 9] Bad file descriptor',
      "b'new'", '17 True', 'True 3', "3 b'n'", '',
    ].join('\n'));
  });

  it("glob is CPython's glob.py over os.scandir; os.utime, and shutil.copy2 / copystat carry times and mode", async () => {
    const r = await runBoth(`
import os, glob, shutil
os.makedirs("/tmp/g/sub/deep")
for n in ["a.txt", "b.py", "sub/c.txt", "sub/deep/d.txt", ".h.txt"]:
    open("/tmp/g/" + n, "w").write(n)
os.chdir("/tmp/g")
print(sorted(glob.glob("*.txt")), sorted(glob.glob("**/*.txt", recursive=True)), glob.escape("a[b]*"))
with os.scandir(".") as it:
    print(sorted((e.name, e.is_dir(), e.path) for e in it))
os.utime("a.txt", (1000, 2000))
os.chmod("a.txt", 0o600)
print(os.stat("a.txt").st_mtime, os.stat("a.txt").st_atime)
print(shutil.copy2("a.txt", "sub"), os.stat("sub/a.txt").st_mtime, oct(os.stat("sub/a.txt").st_mode & 0o777))
`);
    assert.equal(r.text, [
      "['a.txt'] ['a.txt', 'sub/c.txt', 'sub/deep/d.txt'] a[[]b][*]",
      "[('.h.txt', False, './.h.txt'), ('a.txt', False, './a.txt'), ('b.py', False, './b.py'), ('sub', True, './sub')]",
      '2000 1000', 'sub/a.txt 2000 0o600', '',
    ].join('\n'));
  });

  it("lzma: CPython's lzma.py over _lzma (liblzma's bytes); LZMAFile on a path, text mode; filters, errors", async () => {
    const r = await runBoth(`
import lzma, hashlib
data = b"xz in adder " * 3000 + bytes(range(256))
z = lzma.compress(data)
print(len(z), hashlib.sha256(z).hexdigest()[:16], lzma.decompress(z) == data)
f = [{"id": lzma.FILTER_DELTA, "dist": 2}, {"id": lzma.FILTER_X86}, {"id": lzma.FILTER_LZMA2, "preset": 3 | lzma.PRESET_EXTREME}]
z3 = lzma.compress(data, filters=f, check=lzma.CHECK_SHA256)
print(len(z3), hashlib.sha256(z3).hexdigest()[:16], lzma.decompress(z3) == data)
with lzma.open("/tmp/t.xz", "wt") as fh:
    fh.write("one\\ntwo\\n")
with lzma.open("/tmp/t.xz", "rt") as fh:
    print(fh.readlines())
d = lzma.LZMADecompressor()
part = d.decompress(z + b"??", max_length=100)
rest = d.decompress(b"")
print(len(part), d.check, len(part + rest), d.eof, d.unused_data)
print(lzma._encode_filter_properties({"id": lzma.FILTER_LZMA2, "preset": 6}), sorted(lzma._decode_filter_properties(lzma.FILTER_DELTA, b"\\x03").items()))
for bad in [dict(format=lzma.FORMAT_ALONE, check=lzma.CHECK_CRC32), dict(preset=6, filters=[])]:
    try:
        lzma.LZMACompressor(**bad)
    except ValueError as e:
        print(e)
try:
    lzma.compress(b"x", filters=[{"id": 99}])
except ValueError as e:
    print(e)
`);
    // (376 bytes and those hashes are CPython 3.13's lzma.compress of the same data)
    assert.equal(r.text, [
      '376 8044fc5cd11e8d0b True',
      '184 d80087667a315262 True',
      "['one\\n', 'two\\n']",
      '100 4 36256 True b\'??\'',
      "b'\\x16' [('dist', 4), ('id', 3)]",
      'Integrity checks are only supported by FORMAT_XZ',
      'Cannot specify both preset and filter chain',
      'Invalid filter ID: 99',
      '',
    ].join('\n'));
  });

  it("bz2: CPython's bz2.py over _bz2 (libbzip2's bytes); BZ2File on a path, text mode", async () => {
    const r = await runBoth(`
import bz2, hashlib
data = b"bzip2 " * 2000 + bytes(range(256))
z = bz2.compress(data)
print(len(z), hashlib.sha256(z).hexdigest()[:16], bz2.decompress(z) == data)
with bz2.open("/tmp/a.bz2", "wt") as f:
    f.write("alpha\\nbeta\\ngamma\\n")
with bz2.BZ2File("/tmp/a.bz2") as f:
    print(f.readline(), f.peek(1)[:1], f.read())
with bz2.open("/tmp/a.bz2", "rt") as f:
    print(f.readlines())
d = bz2.BZ2Decompressor()
part = d.decompress(z + b"!!", max_length=10)
print(len(part), d.needs_input, d.eof)
rest = d.decompress(b"")
print(len(part + rest), d.eof, d.unused_data)
try:
    bz2.BZ2Decompressor().decompress(b"BZh9" + bytes(20))
except OSError as e:
    print(e)
`);
    // (490 bytes and that hash are CPython 3.13's bz2.compress of the same data)
    assert.equal(r.text, [
      '490 c03114d1e8878a53 True',
      "b'alpha\\n' b'b' b'beta\\ngamma\\n'",
      "['alpha\\n', 'beta\\n', 'gamma\\n']",
      '10 False False',
      "12256 True b'!!'",
      'Invalid data stream',
      '',
    ].join('\n'));
  });
});
