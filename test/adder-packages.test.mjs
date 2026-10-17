// adder's import system over a VFS: packages, submodules, relative imports, circular imports,
// importlib / __import__ — run through both engines (a cell's code may be AIR-compiled; the
// imported library modules always run on the tree-walker).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../ext/adder/src/index.js');
A.attachAir(await import('../ext/air/index.js'));
const B = await import('../ext/adder/src/builtins.js');
const { VFS } = await import('../ext/vfs/src/vfs.js');
const { path: vfsPath } = await import('../ext/vfs/src/path.js');

// a small package tree on /site
const FILES = {
  '/site/pkg/__init__.py': [
    '"""pkg docstring"""',
    'from .core import add, VERSION',
    'from . import util',
    'from .sub.deep import deep_value',
    '__all__ = ["add", "VERSION"]',
    'loaded_order = ["pkg"]',
  ].join('\n'),
  '/site/pkg/core.py': [
    'VERSION = (1, 2)',
    'def add(a, b):',
    '    return a + b',
  ].join('\n'),
  '/site/pkg/util.py': [
    'from .core import add',
    'from pkg import core as c2',   // absolute import of its own package, mid-initialisation
    'def twice(x):',
    '    return add(x, x)',
    'same = c2.add is add',
  ].join('\n'),
  '/site/pkg/sub/__init__.py': '',
  '/site/pkg/sub/deep.py': [
    'from ..core import VERSION',
    'from .. import core',
    'deep_value = VERSION[0] + core.add(1, 1)',
  ].join('\n'),
  // circular: a imports b, b imports a (reads what a has bound so far)
  '/site/circ/__init__.py': '',
  '/site/circ/a.py': [
    'early = 1',
    'from . import b',
    'late = b.seen_early',
  ].join('\n'),
  '/site/circ/b.py': [
    'from . import a',
    'seen_early = a.early',
  ].join('\n'),
  '/site/broken.py': 'x = 1\nraise ValueError("boom")\n',
  '/site/data_pkg/__init__.py': '',
  // a library class with a property, dunders and methods (AIR-compiled on import under AIR)
  '/site/money.py': [
    'class M:',
    '    def __init__(self, c):',
    '        self.c = c',
    '    @property',
    '    def dollars(self):',
    '        return self.c / 100',
    '    def __add__(self, o):',
    '        return M(self.c + o.c)',
    '    def __eq__(self, o):',
    '        return isinstance(o, M) and self.c == o.c',
    '    def __repr__(self):',
    '        return f"M({self.c})"',
    '    def __len__(self):',
    '        return self.c',
    'done = None',
    'def finish():',
    '    global done, later',
    '    done = True',
    '    later = "set"',
  ].join('\n'),
  // a re-export module: `import *` (the tree-walker's: AIR declines it)
  '/site/reexport.py': 'from money import *\nfrom pkg.core import *\n',
  '/site/data_pkg/table.txt': 'hello resources',
};

async function runBoth(code) {
  const outs = [];
  for (const engine of ['tree', 'auto']) {
    const vfs = await VFS.create();
    for (const [p, src] of Object.entries(FILES)) {
      await vfs.mkdir(vfsPath.dirname(p), { recursive: true });
      await vfs.writeFile(p, src);
    }
    B.setAdderVFS(vfs, vfsPath);
    const out = [];
    await A.run('import sys\nsys.path.insert(0, "/site")\n' + code, { engine, vfs, stdout: (s) => out.push(s), stderr: () => {} });
    outs.push(out.join(''));
  }
  assert.equal(outs[0], outs[1], 'both engines print the same');
  return outs[1];
}

describe('adder packages over a VFS', () => {
  it('a library used from a cell: properties, dunders, module globals set from functions', async () => {
    const out = await runBoth([
      'import money',
      'from money import M',
      'a = M(150)',
      'print(a.dollars, a + M(50), a == M(150), len(a), repr(a), a.dollars + 1)',
      'def f(x):',
      '    return x.dollars * 2',
      'print(f(a), money.done)',
      'money.finish()',
      'print(money.done, money.later)',
      'import reexport',
      'print(reexport.M(1), reexport.add(2, 2))',
    ].join('\n'));
    assert.equal(out, ['1.5 M(200) True 150 M(150) 2.5', '3 None', 'True set', 'M(1) 4', ''].join('\n'));
  });

  it('packages, submodules, relative imports, module attributes', async () => {
    const out = await runBoth([
      'import pkg',
      'print(pkg.add(2, 3), pkg.VERSION, pkg.util.twice(4), pkg.util.same, pkg.deep_value)',
      'print(pkg.__name__, pkg.__package__, pkg.__path__, pkg.__doc__)',
      'print(pkg.core.__name__, pkg.core.__package__, pkg.sub.deep.__package__, pkg.core.__file__)',
      'import pkg.sub.deep',
      'print(pkg.sub.deep.deep_value, "pkg.sub.deep" in sys.modules)',
      'import pkg.sub.deep as d',
      'print(d.deep_value)',
      'from pkg.sub import deep',
      'print(deep is d)',
      'from pkg import *',
      'print(add(1, 1), VERSION)',
    ].join('\n'));
    assert.equal(out, [
      '5 (1, 2) 8 True 3',
      "pkg pkg ['/site/pkg'] pkg docstring",
      'pkg.core pkg pkg.sub /site/pkg/core.py',
      '3 True',
      '3',
      'True',
      '2 (1, 2)',
      '',
    ].join('\n'));
  });

  it('circular imports see the names bound so far', async () => {
    const out = await runBoth('from circ import a\nprint(a.early, a.late, a.b.seen_early)\n');
    assert.equal(out, '1 1 1\n');
  });

  it('errors: missing modules and names, relative imports outside a package, failed modules', async () => {
    const out = await runBoth([
      'try:',
      '    import nope.deeper',
      'except ModuleNotFoundError as e:',
      '    print("MNF", e)',
      'try:',
      '    from pkg import missing_name',
      'except ImportError as e:',
      '    print("IE", e)',
      'for _ in range(2):',      // a module that raised is not left half-imported in sys.modules
      '    try:',
      '        import broken',
      '    except ValueError as e:',
      '        print("VE", e, "broken" in sys.modules)',
    ].join('\n'));
    assert.equal(out, [
      "MNF No module named 'nope'",
      "IE cannot import name 'missing_name' from 'pkg'",
      'VE boom False',
      'VE boom False',
      '',
    ].join('\n'));
  });

  it('importlib and __import__', async () => {
    const out = await runBoth([
      'import importlib',
      'm = importlib.import_module("pkg.sub.deep")',
      'print(m.deep_value, importlib.import_module(".core", "pkg").VERSION)',
      'print(__import__("pkg.sub.deep").__name__, __import__("pkg.sub.deep", fromlist=["x"]).__name__)',
      'print(importlib.util.find_spec("pkg").name, importlib.util.find_spec("nothere"))',
      'from importlib import resources',
      'print(resources.files("data_pkg").joinpath("table.txt").read_text())',
      'try:',
      '    importlib.metadata.version("pkg")',
      'except importlib.metadata.PackageNotFoundError:',
      '    print("no metadata")',
    ].join('\n'));
    assert.equal(out, ['3 (1, 2)', 'pkg pkg.sub.deep', 'pkg None', 'hello resources', 'no metadata', ''].join('\n'));
  });
});
