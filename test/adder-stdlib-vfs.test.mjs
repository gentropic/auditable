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
});
